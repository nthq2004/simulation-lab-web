import Konva from 'konva';
import { BaseComponent } from './BaseComponent.js';

/**
 * EPC50BController — Alfa Laval EPC-50B 燃油供油单元控制器
 *
 *   左右结构：
 *     左 = OP 操作面板（FCM 流程小图、INFO、液晶与 −/+/ENTER、右侧功能卡）
 *     右 = 电机与加热控制箱：**完全按参考图《电机控制和加热控制.svg》的版式**，
 *          坐标以参考图 1579×996 为基准等比映射（sx = 0.5、sy = 0.55）：
 *            ① 顶部 5 个白色标牌 + 白色旋钮框（STOP / MAN / CFC(或 AUT) / REM / DRAIN）
 *            ② 左侧 2×2 油泵盒：标题条 + Auxiliary Voltage On 标牌与大灯 +
 *               MAIN SWITCH 标牌与黑色旋转开关（ON 标牌、通风格栅、绿色 OFF 区）
 *            ③ 右侧第一排：REGULATING VALVE MAN/EPC、DECR/INCR、HEATING TRACING 0/1
 *            ④ 右侧第二排：AutoFilter 盒（Auxiliary Overload 橙灯 + Auxiliary Voltage On 灰灯
 *               + MAIN SWITCH）
 *
 * 部件 id（工作流 subTarget / op.part 用）：
 *   lcd / info / key-minus / key-plus / key-enter
 *   fn-start / btn-oil / fn-process / fn-op / fn-alarm
 *   led-start / led-hfo / led-do / led-op / led-alarm
 *   cv / sp / af / ft / ps1 / tank / cp / sh / ps2 / tt / vt
 *   led-sp led-af led-ft led-ps1 led-ls led-cp led-sh led-ps2 led-tt led-vt led-epc-pump
 *   sp1-sel(-ccw) sp2-sel(-ccw) cp1-sel(-ccw) cp2-sel(-ccw) af-sel(-ccw)
 *   sp1-main(-ccw) sp2-main(-ccw) cp1-main(-ccw) cp2-main(-ccw) af-main(-ccw)
 *   aux-sp1 aux-sp2 aux-cp1 aux-cp2 aux-af af-overload
 *   rv-man rv-epc heat-decr heat-incr ht ht-ccw
 */
export class EPC50BController extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.W = Math.max(1510, config.width || 1510);
        this.H = Math.max(400, config.height || 470);
        this.type = 'epc50b_controller';
        this.cache = 'fixed';

        this._ui = {
            page: 'main',        // main / menu / params / alarms
            mainPage: 0,         // 主画面 +/− 翻页：0 主显 / 1 PT1 / 2 PT2 / 3 SRV / 4 TT / 5 VT / 6 OIL
            alarmIdx: 0,         // 报警页面当前显示的报警序号（多故障时 +/- 切换）
            menu: 0,
            param: 0,
            editing: false,
            editVal: 0,
            infoPage: 0,
            heatKnob: 'UP',     // 调节阀增减旋钮：UP（自复位中位）/ INCR / DECR
            heatHold: 0,        // 按住方向：0 未按 / +1 INCR / -1 DECR
        };

        this._initGroups();
        this._recalcGeometry();
        this._init();
        this._syncVisuals();

        this.config = { id: this.id, width: this.W, height: this.H };
    }

    _solver() {
        return this.sys && this.sys.fuelSolver ? this.sys.fuelSolver : null;
    }

    _tip(msg) {
        if (this.sys && typeof this.sys._tipPurifier === 'function') this.sys._tipPurifier(msg);
    }

    // ═══════════════════════════════════════════════════════════
    //  几何
    // ═══════════════════════════════════════════════════════════
    _recalcGeometry() {
        const G = {
            // ── 左：OP 操作面板（模拟区加宽 50）──
            op: { x: 8, y: 8, w: 540, h: 454 },
            mimic: { x: 18, y: 30, w: 520, h: 300 },
            info: { x: 18, y: 340, w: 176, h: 114 },
            lcd: { x: 202, y: 340, w: 336, h: 64 },
            keys: { x: 202, y: 412, w: 104, h: 40, gap: 12 },
            cards: { x: 556, y: 8, w: 186, h: 454 },

            // ── 右：电机与加热控制箱（参考图映射基准，宽度 740 / 高度 454）──
            ctrl: { x: 762, y: 8, w: 740, h: 454 },
            ref: { ox: 768, oy: 14, sx: 0.462, sy: 0.4437 },
        };
        this._geo = G;

        // ── OP 流程图：元件沿主流程等距排布（纵向按参考图 0.32 映射）──
        const ky = 0.32;
        const oY = G.mimic.y + 34;         // 64
        const ry = (v) => oY + v * ky;
        const LY = ry(495);                // 主管路

        // 主流程元件横坐标（等距：相邻约 42~46px）
        const PX = {
            inlet: 34, cv: 62, sp: 104, filt: 150, ft: 186, ps1: 221,
            tankL: 244, tankR: 270, cp: 304, shL: 352, shR: 376,
            ps2: 420, tt: 452, vt: 484, srv: 450, end: 528,
        };
        this._mimic = {
            ky, oy: oY, lineY: LY, lampR: 10.5, PX,
            lamps: [
                { id: 'led-hfo', x: PX.cv, y: ry(395), text: 'HFO 指示灯：HFO 位常亮；转换到 HFO 过程中闪烁', anchor: [PX.cv, ry(440)] },
                { id: 'led-do', x: PX.cv - 14, y: ry(615), text: 'DO 指示灯：DO 位常亮；转换到 DO 过程中闪烁', anchor: [PX.cv - 14, ry(555)] },
                { id: 'led-sp2', x: PX.sp, y: ry(150), text: 'SP2 运行指示灯', anchor: [PX.sp, ry(240)] },
                { id: 'led-sp1', x: PX.sp, y: ry(390), text: 'SP1 运行指示灯', anchor: [PX.sp, LY] },
                { id: 'led-mf', x: PX.filt, y: ry(150), text: '手动滤器 M/F 指示灯：有油流动且三通阀在上位时点亮', anchor: [PX.filt, ry(240)] },
                { id: 'led-af', x: PX.filt, y: ry(390), text: '自动滤器 A/F 指示灯：有油流动且三通阀在下位时点亮', anchor: [PX.filt, LY] },
                { id: 'led-drain', x: PX.filt - 32, y: ry(620), text: '滤器放残（冲洗）指示灯',
                  path: [[PX.filt - 21.5, ry(620)], [PX.filt, ry(620)]] },
                { id: 'led-ft', x: PX.ft, y: ry(390), text: 'FT 流量指示灯：流过 FT 的流量大于 0.05 时点亮', anchor: [PX.ft, LY] },
                { id: 'led-ps1', x: PX.ps1, y: ry(390), text: 'PS 供油压力：泵运行且 PT1>0.2MPa 亮绿，<0.2 亮红，泵停熄灭', anchor: [PX.ps1, LY] },
                { id: 'led-ls', x: PX.ps1 - 24, y: ry(150), text: 'LS 液位低（气体多）指示灯', anchor: [PX.ps1 - 24, ry(268)] },
                { id: 'led-dea', x: (PX.tankL + PX.tankR) / 2 - 30, y: ry(100), text: '脱气阀工作指示灯（脱气阀接通回气时亮）',
                  path: [[(PX.tankL + PX.tankR) / 2 - 30, ry(100) + 10.5], [(PX.tankL + PX.tankR) / 2 - 30, ry(160)], [(PX.tankL + PX.tankR) / 2, ry(160)]] },
                { id: 'led-cp2', x: PX.cp, y: ry(150), text: 'CP2 运行指示灯', anchor: [PX.cp, ry(240)] },
                { id: 'led-cp1', x: PX.cp, y: ry(390), text: 'CP1 运行指示灯', anchor: [PX.cp, LY] },
                { id: 'led-sh', x: (PX.shL + PX.shR) / 2, y: ry(150), text: 'S/H 蒸汽供应指示灯：始终亮绿灯', anchor: [(PX.shL + PX.shR) / 2, ry(210)] },
                { id: 'led-srv-dec', x: PX.srv - 32, y: ry(150), text: 'SRV 关小指示（调节阀开度较小）',
                  path: [[PX.srv - 32, ry(150) + 10.5], [PX.srv - 32, (ry(220) - 5 + ry(258) - 5) / 2], [PX.srv - 14, (ry(220) - 5 + ry(258) - 5) / 2]] },
                { id: 'led-srv-inc', x: PX.srv + 32, y: ry(150), text: 'SRV 开大指示（蒸汽调节阀开大时亮）',
                  path: [[PX.srv + 32, ry(150) + 10.5], [PX.srv + 32, (ry(220) - 5 + ry(258) - 5) / 2], [PX.srv + 14, (ry(220) - 5 + ry(258) - 5) / 2]] },
                { id: 'led-ps2', x: PX.ps2, y: ry(390), text: 'PS 主机进油压力：循环泵运行且 PT2>0.4MPa 亮绿，<0.4 亮红，泵停熄灭', anchor: [PX.ps2, LY] },
                { id: 'led-tt', x: PX.tt, y: ry(390), text: 'TT 温度指示灯：温度定值控制时常亮；转换期间闪亮', anchor: [PX.tt, LY] },
                { id: 'led-vt', x: PX.vt, y: ry(390), text: 'VT 黏度指示灯：黏度定值控制时常亮；转换期间闪亮', anchor: [PX.vt, LY] },
                { id: 'led-epc-pump', x: PX.vt, y: ry(610), text: 'EPC PUMP CONTROL：任一油泵已送电且选择开关在 EPC 位时点亮' },
            ],
            devices: [
                { id: 'cv', x: PX.cv - 16, y: LY - 24, w: 32, h: 48, text: '三通转换阀（DO/HFO）：上位 HFO→右通，下位 DO→右通' },
                { id: 'sp', x: PX.sp - 24, y: ry(215), w: 48, h: ry(540) - ry(215), text: '供油泵 SP1 / SP2（并联，SP2 在上支路）' },
                { id: 'af', x: PX.filt - 26, y: ry(215), w: 52, h: ry(540) - ry(215), text: '自动滤器 A/F（下）与手动滤器 M/F（上），下方为放残阀' },
                { id: 'ft', x: PX.ft - 11, y: LY - 11, w: 22, h: 22, text: '流量变送器 FT' },
                { id: 'ps1', x: PX.ps1 - 11, y: LY - 11, w: 22, h: 22, text: '压力开关 PS（供油压力）' },
                { id: 'tank', x: PX.tankL, y: ry(225), w: PX.tankR - PX.tankL, h: ry(535) - ry(225), text: '带脱气的混合筒（液位低时 LS 动作、脱气阀放气）' },
                { id: 'cp', x: PX.cp - 24, y: ry(215), w: 48, h: ry(540) - ry(215), text: '循环泵 CP1 / CP2（并联，CP2 在上支路）' },
                { id: 'sh', x: PX.shL - 8, y: ry(200), w: (PX.shR - PX.shL) + 16, h: ry(520) - ry(200), text: '蒸汽加热器 S/H（两台并联，进汽由 SRV 调节）' },
                { id: 'ps2', x: PX.ps2 - 11, y: LY - 11, w: 22, h: 22, text: '压力变送器 PS（主机进油压力）' },
                { id: 'tt', x: PX.tt - 11, y: LY - 11, w: 22, h: 22, text: '温度传感器 TT（PT100）' },
                { id: 'vt', x: PX.vt - 11, y: LY - 11, w: 22, h: 22, text: '黏度传感器 VT（EVT20）' },
            ],
        };
    }

    // ═══════════════════════════════════════════════════════════
    //  参考图坐标映射（1579 × 996 → 控制箱内）
    // ═══════════════════════════════════════════════════════════
    _X(rx) { return this._geo.ref.ox + rx * this._geo.ref.sx; }
    _Y(ry) { return this._geo.ref.oy + ry * this._geo.ref.sy; }
    _WX(w) { return w * this._geo.ref.sx; }
    _HY(h) { return h * this._geo.ref.sy; }

    /** 控制箱内所有可交互元素的位置表（参考图版式） */
    _ctrlLayout() {
        const X = (v) => this._X(v), Y = (v) => this._Y(v);
        const WX = (v) => this._WX(v), HY = (v) => this._HY(v);

        // ① 顶部 5 个选择开关（旋钮居于白框中央）
        const sels = [
            { key: 'sp1', title: 'SUPPLY PUMP 1', px: 58, pw: 222, filter: false },
            { key: 'sp2', title: 'SUPPLY PUMP 2', px: 368, pw: 222, filter: false },
            { key: 'cp1', title: 'CIRC. PUMP 1', px: 688, pw: 212, filter: false },
            { key: 'cp2', title: 'CIRC. PUMP 2', px: 990, pw: 225, filter: false },
            { key: 'af', title: 'AUTO FILTER', px: 1310, pw: 200, filter: true },
        ].map(s => {
            // 白框与上方标注栏左右各加宽 5px（合计 +10），旋钮仍居中
            const bx = X(s.px) - 5, by = Y(100), bw = WX(s.pw) + 10, bh = HY(210);
            return {
                key: s.key, title: s.title, filter: s.filter,
                plate: { x: X(s.px) - 5, y: Y(22), w: WX(s.pw) + 10, h: HY(56) },
                box: { x: bx, y: by, w: bw, h: bh },
                cx: bx + bw / 2, cy: by + bh / 2, R: WX(48) + 3,
            };
        });

        // ② 左侧 2×2 油泵盒（四只等高）
        const PBOX_H = 137;
        const PBOX_X = [X(15), X(500)];
        const PBOX_W = [WX(455), WX(450)];
        const pumps = [
            { key: 'sp1', title: 'SUPPLY PUMP 1', col: 0, row: 0 },
            { key: 'sp2', title: 'SUPPLY PUMP 2', col: 1, row: 0 },
            { key: 'cp1', title: 'CIRC. PUMP 1', col: 0, row: 1 },
            { key: 'cp2', title: 'CIRC. PUMP 2', col: 1, row: 1 },
        ].map(b => {
            const x = PBOX_X[b.col], y = b.row === 0 ? 163 : 310;
            return {
                key: b.key, title: b.title,
                x, y, w: PBOX_W[b.col], h: PBOX_H,
                aux: { x: x + 15, y: y + 32, w: 92, h: 35 },
                lamp: { x: x + 59, y: y + 95, r: WX(45) - 2 },
                ms: { x: x + 108, y: y + 30, w: 98, h: 22 },
                sw: { x: x + 104, y: y + 56, w: 97, h: 72 },
                knob: { x: x + 104 + 49, y: y + 56 + 33, r: WX(52) },
            };
        });

        // ③ 右侧第一排：调节阀 / 增减 / 伴行加热
        const rvs = [
            { key: 'rv', x: 965, w: 190, lines: ['REGULATING VALVE', 'MAN        EPC'], cx: 1060 },
            { key: 'heat', x: 1160, w: 190, lines: ['REGULATING VALVE', 'DECR      INCR'], cx: 1255 },
            { key: 'ht', x: 1355, w: 145, lines: ['HEATING TRACING', '0          1'], cx: 1437 },
        ].map(r => ({
            key: r.key, lines: r.lines,
            plate: { x: X(r.x), y: Y(335), w: WX(r.w), h: HY(135) },
            cx: X(r.cx), cy: Y(545), R: WX(78),
        }));

        // ④ 右侧第二排：AutoFilter 盒（与泵盒等高；仅多一只过载灯，宽度略增）
        const x0 = X(990) - 6, y0 = 310;
        const af = {
            x: x0, y: y0, w: 272, h: PBOX_H,
            over: { x: x0 + 8, y: y0 + 32, w: 78, h: 35 },
            overLamp: { x: x0 + 47, y: y0 + 96, r: WX(45) - 2 },
            aux: { x: x0 + 90, y: y0 + 32, w: 78, h: 35 },
            auxLamp: { x: x0 + 129, y: y0 + 96, r: WX(45) - 2 },
            ms: { x: x0 + 172, y: y0 + 30, w: 96, h: 22 },
            sw: { x: x0 + 170, y: y0 + 56, w: 96, h: 72 },
            knob: { x: x0 + 170 + 48, y: y0 + 56 + 33, r: WX(52) },
        };

        return { sels, pumps, rvs, af };
    }

    // ═══════════════════════════════════════════════════════════
    //  绘制工具
    // ═══════════════════════════════════════════════════════════
    _label(g, x, y, text, size = 12, fill = '#1b2a38', bold = false, align = 'left', width = 0) {
        const o = {
            x, y, text, fontSize: size, fontStyle: bold ? 'bold' : 'normal', fill, align,
            fontFamily: 'Arial, "Microsoft YaHei", sans-serif',
        };
        if (width) o.width = width;
        g.add(new Konva.Text(o));
    }

    _plate(g, x, y, w, h, text, size = 9) {
        g.add(new Konva.Rect({
            x, y, width: w, height: h, cornerRadius: 2,
            fill: '#ffffff', stroke: '#0b3d91', strokeWidth: 1,
        }));
        this._label(g, x + 1, y + (h - size) / 2 - 1, text, size, '#0b1a2b', true, 'center', w - 2);
    }

    _plate2(g, x, y, w, h, lines, size = 7) {
        g.add(new Konva.Rect({
            x, y, width: w, height: h, cornerRadius: 2,
            fill: '#ffffff', stroke: '#0b3d91', strokeWidth: 1,
        }));
        const n = lines.length, lh = size + 2;
        const top = y + (h - n * lh) / 2 + 1;
        lines.forEach((t, i) => this._label(g, x + 1, top + i * lh, t, size, '#0b1a2b', true, 'center', w - 2));
    }

    /** 大旋钮底座：银色外圈 + 黑色盘面 + 中心轮毂 */
    _knobBig(g, cx, cy, R) {
        g.add(new Konva.Circle({ x: cx, y: cy, radius: R + 3, fill: '#c3c8cd', stroke: '#949ba1', strokeWidth: 1 }));
        g.add(new Konva.Circle({ x: cx, y: cy, radius: R, fill: '#111111', stroke: '#000000', strokeWidth: 1 }));
        g.add(new Konva.Circle({ x: cx, y: cy, radius: Math.max(6, R * 0.24), fill: '#1c1c1c', stroke: '#b9bfc4', strokeWidth: 1.2 }));
        g.add(new Konva.Line({ points: [cx - 4, cy, cx + 4, cy], stroke: '#d8dde1', strokeWidth: 1.2 }));
        g.add(new Konva.Line({ points: [cx, cy - 4, cx, cy + 4], stroke: '#d8dde1', strokeWidth: 1.2 }));
    }

    _knobPointer(cx, cy, R, rot = 0) {
        const grp = new Konva.Group({ x: cx, y: cy, rotation: rot });
        grp.add(new Konva.Rect({
            x: -R * 0.17, y: -(R - 4), width: R * 0.34, height: (R - 4) * 2,
            cornerRadius: 2, fill: '#0a0a0a', stroke: '#6a7076', strokeWidth: 1,
        }));
        grp.add(new Konva.Rect({
            x: -R * 0.13, y: -(R - 4), width: R * 0.26, height: 9,
            fill: '#e8ecef',
        }));
        this._dynamicGroup.add(grp);
        return grp;
    }

    /** MAIN SWITCH 黑色旋转开关 */
    _drawSwitch(g, box, knob) {
        const { x, y, w, h } = box;
        g.add(new Konva.Rect({
            x, y, width: w, height: h, cornerRadius: 2,
            fill: '#161616', stroke: '#3d4247', strokeWidth: 1.2,
        }));
        // 通风格栅
        for (let i = 0; i < 3; i++) {
            g.add(new Konva.Line({
                points: [x + w - 28, y + 6 + i * 5, x + w - 5, y + 6 + i * 5],
                stroke: '#4a4f54', strokeWidth: 2,
            }));
        }
        // ON 标牌
        g.add(new Konva.Rect({ x: x + 4, y: y + 4, width: 26, height: 13, fill: '#f2f4f6' }));
        this._label(g, x + 4, y + 5, 'ON', 10, '#111111', true, 'center', 26);
        // 绿色 OFF 区（左下角标注 OFF，右下角不标注）
        g.add(new Konva.Rect({ x: x + 4, y: y + h - 22, width: Math.min(46, w - 10), height: 17, fill: '#1f8f34' }));
        this._label(g, x + 5, y + h - 20, 'OFF', 10, '#eafff0', true, 'center', 22);
        this._knobBig(g, knob.x, knob.y, knob.r);
    }

    _valveData(cx, cy, hw = 9, hh = 6) {
        return `M ${cx - hw} ${cy - hh} L ${cx} ${cy} L ${cx - hw} ${cy + hh} Z `
            + `M ${cx + hw} ${cy - hh} L ${cx} ${cy} L ${cx + hw} ${cy + hh} Z`;
    }

    // ═══════════════════════════════════════════════════════════
    //  静态绘制
    // ═══════════════════════════════════════════════════════════
    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
    }

    _drawStaticParts() {
        const g = this._staticGroup, W = this.W, H = this.H;

        g.add(new Konva.Rect({
            x: 0, y: 0, width: W, height: H, cornerRadius: 12,
            fill: '#dfe3e7', stroke: '#8b959d', strokeWidth: 2,
        }));

        this._drawOpPanel(g);
        this._drawCards(g);
        this._drawControlBox(g);
    }

    _drawOpPanel(g) {
        const G = this._geo, op = G.op;
        g.add(new Konva.Rect({
            x: op.x, y: op.y, width: op.w, height: op.h, cornerRadius: 8,
            fill: '#0d47a1', stroke: '#07306e', strokeWidth: 2,
        }));
        this._label(g, op.x + 12, op.y + 6, 'EPC50B', 15, '#ffffff', true);

        const M = G.mimic;
        g.add(new Konva.Rect({
            x: M.x, y: M.y, width: M.w, height: M.h,
            fill: '#ffffff', stroke: '#b8c3cd', strokeWidth: 1.4,
        }));
        this._drawOpMimic(g);

        const I = G.info;
        g.add(new Konva.Rect({ x: I.x, y: I.y, width: I.w, height: I.h, fill: '#ffffff', stroke: '#b8c3cd', strokeWidth: 1.4 }));
        g.add(new Konva.Rect({ x: I.x, y: I.y, width: I.w, height: 20, fill: '#cfe0f2' }));
        this._label(g, I.x + 6, I.y + 2, 'INFO', 14, '#0b3d91', true);
        for (let i = 1; i <= 4; i++) {
            const y = I.y + 20 + i * 22;
            g.add(new Konva.Line({ points: [I.x + 4, y, I.x + I.w - 4, y], stroke: '#e0e6ea', strokeWidth: 1 }));
        }

        const L = G.lcd;
        g.add(new Konva.Rect({
            x: L.x, y: L.y, width: L.w, height: L.h, cornerRadius: 3,
            fill: '#0b0b0b', stroke: '#3a3a3a', strokeWidth: 2,
        }));

        const K = G.keys;
        [['key-minus', '−', 0], ['key-plus', '+', 1], ['key-enter', 'ENTER', 2]].forEach(([id, txt, i]) => {
            const x = K.x + i * (K.w + K.gap);
            g.add(new Konva.Rect({
                x, y: K.y, width: K.w, height: K.h, cornerRadius: 6,
                fill: '#3f3f3f', stroke: '#9aa3ab', strokeWidth: 1.4,
            }));
            this._label(g, x, K.y + (id === 'key-enter' ? 13 : 7), txt,
                id === 'key-enter' ? 12 : 22, '#ffffff', true, 'center', K.w);
        });
    }

    _drawCards(g) {
        const G = this._geo, C = G.cards;
        g.add(new Konva.Rect({
            x: C.x, y: C.y, width: C.w, height: C.h, cornerRadius: 8,
            fill: '#ffffff', stroke: '#b8c3cd', strokeWidth: 1.6,
        }));
        const rows = this._cardRows();
        rows.forEach(r => {
            g.add(new Konva.Rect({
                x: C.x + 6, y: r.y, width: C.w - 12, height: r.h,
                fill: '#ffffff', stroke: '#c8d2da', strokeWidth: 1,
            }));
            if (r.btn) {
                g.add(new Konva.Rect({
                    x: r.btn.x, y: r.btn.y, width: r.btn.w, height: r.btn.h, cornerRadius: 2,
                    fill: '#2b2f33', stroke: '#111111', strokeWidth: 1.2,
                }));
            }
            r.labels.forEach(l => this._label(g, l.x, l.y, l.text, 12, '#111111', true));
        });
        {
            const cx = C.x + 160, cy = 360;
            g.add(new Konva.Line({
                points: [cx - 12, cy + 10, cx, cy - 12, cx + 12, cy + 10],
                closed: true, fill: '#ffffff', stroke: '#111111', strokeWidth: 1.6, lineJoin: 'round',
            }));
            g.add(new Konva.Line({ points: [cx, cy - 3, cx, cy + 4], stroke: '#111111', strokeWidth: 1.6 }));
            g.add(new Konva.Circle({ x: cx, y: cy + 7, radius: 1.1, fill: '#111111' }));
        }
        this._label(g, C.x + 14, 402, 'EPC-50B', 16, '#8b959d', true);
        this._label(g, C.x + 14, 424, 'FCM FUEL SUPPLY', 13, '#a8b0b8', false);
    }

    /** 右：电机与加热控制箱（按参考图版式） */
    _drawControlBox(g) {
        const G = this._geo, C = G.ctrl;
        g.add(new Konva.Rect({
            x: C.x, y: C.y, width: C.w, height: C.h, cornerRadius: 8,
            fill: '#0d47a1', stroke: '#07306e', strokeWidth: 2,
        }));

        const L = this._ctrlLayout();
        L.sels.forEach(s => this._drawSelector(g, s));
        L.pumps.forEach(b => this._drawPumpBox(g, b));
        L.rvs.forEach(r => this._drawRvCell(g, r));
        this._drawFilterBox(g, L.af);
    }

    /** 顶部选择开关（标牌 + 白框 + 大旋钮 + 档位标注） */
    _drawSelector(g, s) {
        // 标牌
        g.add(new Konva.Rect({
            x: s.plate.x, y: s.plate.y, width: s.plate.w, height: s.plate.h,
            fill: '#ffffff', stroke: '#0b3d91', strokeWidth: 1.2,
        }));
        this._label(g, s.plate.x + 2, s.plate.y + (s.plate.h - 11) / 2 - 1, s.title, 13, '#0b1a2b', true, 'center', s.plate.w - 4);

        // 白色旋钮框
        g.add(new Konva.Rect({
            x: s.box.x, y: s.box.y, width: s.box.w, height: s.box.h, cornerRadius: 2,
            fill: '#e9edf1', stroke: '#2b6cb0', strokeWidth: 1.4,
        }));
        this._knobBig(g, s.cx, s.cy, s.R);

        // 档位标注：按 60° 角度布置；MAN 左 60°、STOP 上、EPC 右 60°、REM 右 120°；
        // 自动滤器：DRAIN 左 120°、MAN 左 60°、STOP 上、AUT 右 60°
        const cx = s.cx, cy = s.cy, R = s.R;
        const d = R + 9;
        const dx = d * 0.866, dy = d * 0.5;
        const FS = 9.5;
        this._label(g, cx - 20, cy - d - 11, 'STOP', FS, '#1b2a38', true, 'center', 40);
        this._label(g, cx - dx - 26, cy - dy - 6, 'MAN', FS, '#1b2a38', true, 'right', 26);
        if (s.filter) {
            this._label(g, cx - dx - 44, cy + dy - 6, 'DRAIN', FS - 0.5, '#1b2a38', true, 'right', 44);
            this._label(g, cx + dx, cy - dy - 6, 'AUT', FS, '#1b2a38', true, 'left', 26);
        } else {
            this._label(g, cx + dx, cy - dy - 6, 'EPC', FS, '#1b2a38', true, 'left', 26);
            this._label(g, cx + dx, cy + dy - 6, 'REM', FS, '#1b2a38', true, 'left', 28);
        }
    }

    /** 油泵盒：标题条 + Auxiliary Voltage On 灯 + MAIN SWITCH */
    _drawPumpBox(g, b) {
        g.add(new Konva.Rect({
            x: b.x, y: b.y, width: b.w, height: b.h, cornerRadius: 5,
            fill: '#f6f8fa', stroke: '#0b3d91', strokeWidth: 1.4,
        }));
        // 标题条（浅蓝高亮 + 分隔线）
        g.add(new Konva.Rect({
            x: b.x + 8, y: b.y + 4, width: b.w - 16, height: 15,
            fill: '#bcd7f0', opacity: 0.55,
        }));
        this._label(g, b.x + 12, b.y + 4, b.title, 12, '#0b1a2b', true);
        g.add(new Konva.Line({
            points: [b.x + 8, b.y + 22, b.x + b.w - 8, b.y + 22],
            stroke: '#0b3d91', strokeWidth: 1.2,
        }));

        // Auxiliary Voltage On 标牌 + 大灯
        this._plate2(g, b.aux.x-8, b.aux.y, b.aux.w, b.aux.h, ['Auxiliary', 'Voltage On'], 11);
        g.add(new Konva.Circle({ x: b.lamp.x, y: b.lamp.y, radius: b.lamp.r + 3, fill: '#c8ccd0', stroke: '#8f979d', strokeWidth: 1.4 }));
        g.add(new Konva.Circle({ x: b.lamp.x, y: b.lamp.y, radius: b.lamp.r, fill: '#d5d9dc', stroke: '#a7aeb4', strokeWidth: 1 }));

        // MAIN SWITCH 标牌 + 开关
        this._plate(g, b.ms.x, b.ms.y, b.ms.w, b.ms.h, 'MAIN SWITCH', 12);
        this._drawSwitch(g, b.sw, b.knob);
    }

    /** 右侧第一排：调节阀 / 增减 / 伴行加热 */
    _drawRvCell(g, r) {
        g.add(new Konva.Rect({
            x: r.plate.x, y: r.plate.y, width: r.plate.w, height: r.plate.h-10,
            fill: '#ffffff', stroke: '#0b3d91', strokeWidth: 1.2,
        }));
        const cx = r.plate.x + r.plate.w / 2;
        this._label(g, r.plate.x + 2, r.plate.y + 1, r.lines[0], 11, '#0b1a2b', true, 'center', r.plate.w - 4);
        this._label(g, r.plate.x + 2, r.plate.y + 35, r.lines[1], 12, '#0b1a2b', true, 'center', r.plate.w - 4);
        this._knobBig(g, r.cx, r.cy, r.R-8);
    }

    /** AutoFilter 盒 */
    _drawFilterBox(g, a) {
        g.add(new Konva.Rect({
            x: a.x, y: a.y, width: a.w, height: a.h, cornerRadius: 5,
            fill: '#f6f8fa', stroke: '#0b3d91', strokeWidth: 1.4,
        }));
        g.add(new Konva.Rect({
            x: a.x + 8, y: a.y + 4, width: a.w - 16, height: 15,
            fill: '#bcd7f0', opacity: 0.55,
        }));
        this._label(g, a.x + 12, a.y + 4, 'AutoFilter', 12, '#0b1a2b', true);
        g.add(new Konva.Line({
            points: [a.x + 8, a.y + 22, a.x + a.w - 8, a.y + 22],
            stroke: '#0b3d91', strokeWidth: 1.2,
        }));

        this._plate2(g, a.over.x, a.over.y, a.over.w, a.over.h, ['Auxiliary', 'Overload'], 11);
        g.add(new Konva.Circle({ x: a.overLamp.x, y: a.overLamp.y, radius: a.overLamp.r + 3, fill: '#c8ccd0', stroke: '#8f979d', strokeWidth: 1.2 }));
        g.add(new Konva.Circle({ x: a.overLamp.x, y: a.overLamp.y, radius: a.overLamp.r, fill: '#e08a1e', stroke: '#8d5306', strokeWidth: 1 }));

        this._plate2(g, a.aux.x, a.aux.y, a.aux.w, a.aux.h, ['Auxiliary', 'Voltage On'], 11);
        g.add(new Konva.Circle({ x: a.auxLamp.x, y: a.auxLamp.y, radius: a.auxLamp.r + 3, fill: '#c8ccd0', stroke: '#8f979d', strokeWidth: 1.2 }));
        g.add(new Konva.Circle({ x: a.auxLamp.x, y: a.auxLamp.y, radius: a.auxLamp.r, fill: '#d5d9dc', stroke: '#a7aeb4', strokeWidth: 1 }));

        this._plate(g, a.ms.x, a.ms.y, a.ms.w, a.ms.h, 'MAIN SWITCH', 12);
        this._drawSwitch(g, a.sw, a.knob);
    }

    /** 右侧功能卡行（与参考面板白卡一致） */
    _cardRows() {
        const C = this._geo.cards, X = C.x;
        return [
            {
                id: 'row-start', y: 14, h: 72,
                leds: [{ id: 'led-start', x: X + 28, y: 36 }],
                btn: { id: 'fn-start', x: X + 14, y: 50, w: 58, h: 32 },
                labels: [{ text: 'START/STOP', x: X + 82, y: 56 }],
            },
            {
                id: 'row-oil', y: 92, h: 110,
                leds: [{ id: 'led-hfo', x: X + 28, y: 106 }, { id: 'led-do', x: X + 28, y: 184 }],
                btn: { id: 'btn-oil', x: X + 14, y: 122, w: 58, h: 44 },
                labels: [{ text: 'HFO', x: X + 82, y: 100 }, { text: 'DO', x: X + 82, y: 178 }],
            },
            {
                id: 'row-proc', y: 208, h: 54,
                leds: [],
                btn: { id: 'fn-process', x: X + 14, y: 218, w: 58, h: 32 },
                labels: [{ text: 'PROCESS INFO', x: X + 82, y: 226 }],
            },
            {
                id: 'row-op', y: 268, h: 44,
                leds: [{ id: 'led-op', x: X + 28, y: 286 }],
                btn: null,
                labels: [{ text: 'OP ACTIVE', x: X + 82, y: 279 }],
            },
            {
                id: 'row-alarm', y: 318, h: 64,
                leds: [{ id: 'led-alarm', x: X + 28, y: 334 }],
                btn: { id: 'fn-alarm', x: X + 14, y: 346, w: 58, h: 30 },
                labels: [{ text: 'ALARM', x: X + 82, y: 354 }],
            },
        ];
    }

    /** OP 面板流程图（元件沿主流程等距排布，状态灯按设备状态点亮） */
    _drawOpMimic(g) {
        const M = this._mimic, PX = M.PX;
        const ry = (v) => M.oy + v * M.ky;
        const rs = (v) => v * 0.27;
        const LY = M.lineY;
        const L = (pts, w = 2.4, c = '#111111') => g.add(new Konva.Line({
            points: pts, stroke: c, strokeWidth: w, lineJoin: 'round', lineCap: 'round',
        }));
        const A = (x1, y1, x2, y2, w = 2.4) => g.add(new Konva.Arrow({
            points: [x1, y1, x2, y2], stroke: '#111111', fill: '#111111',
            strokeWidth: w, pointerLength: 7, pointerWidth: 7,
        }));

        // 状态灯引线（灯 → 所属设备；带 path 的走折线）
        M.lamps.forEach(l => {
            if (l.path) { L(l.path.reduce((a, p) => a.concat(p), []), 1.4); return; }
            if (!l.anchor) return;
            L([l.x, l.y + M.lampR, l.anchor[0], l.anchor[1]], 1.4);
        });

        // ══ 管路 ══
        L([PX.cv + 10, LY, PX.end - 8, LY], 2.6);
        A(PX.end - 22, LY, PX.end, LY, 2.6);
        // HFO / DO 进口（向左返回）
        L([PX.cv, LY - 10, PX.cv, ry(440), PX.inlet, ry(440)], 2.4);
        A(PX.inlet + 8, ry(440), PX.inlet - 6, ry(440), 2.4);
        L([PX.cv, LY + 10, PX.cv, ry(555), PX.inlet, ry(555)], 2.4);
        A(PX.inlet + 8, ry(555), PX.inlet - 6, ry(555), 2.4);
        // 供油泵并联支路
        L([PX.sp - 16, LY, PX.sp - 16, ry(240), PX.sp - 12, ry(240)], 2.2);
        L([PX.sp + 12, ry(240), PX.sp + 16, ry(240), PX.sp + 16, LY], 2.2);
        // 滤器并联支路
        L([PX.filt - 16, LY, PX.filt - 16, ry(240), PX.filt - 9, ry(240)], 2.2);
        L([PX.filt + 9, ry(240), PX.filt + 16, ry(240), PX.filt + 16, LY], 2.2);
        // 滤器卸放阀（截止阀符号：上下两三角对顶，无手柄；出口由下边缘引出）
        L([PX.filt, ry(523), PX.filt, ry(620) - 9], 2.2);
        {
            const vx = PX.filt, vy = ry(620), vh = 9, vw = 8;
            g.add(new Konva.Line({
                points: [vx - vw, vy - vh, vx + vw, vy - vh, vx, vy], closed: true,
                fill: '#ffffff', stroke: '#111111', strokeWidth: 2, lineJoin: 'round',
            }));
            g.add(new Konva.Line({
                points: [vx - vw, vy + vh, vx + vw, vy + vh, vx, vy], closed: true,
                fill: '#ffffff', stroke: '#111111', strokeWidth: 2, lineJoin: 'round',
            }));
            L([vx, vy + vh, vx, ry(640)], 2.2);      // 出口管：从下边缘引出
        }
        A(PX.filt, ry(640), PX.filt, ry(716), 2.2);
        // LS 取样管
        L([PX.ps1 - 24, ry(268), PX.ps1 - 12, ry(268)], 2);
        L([PX.ps1 + 12, ry(268), PX.tankL, ry(268)], 2);
        // 脱气：罐顶 → 上行 → 向左回 HFO 日用柜
        L([(PX.tankL + PX.tankR) / 2, ry(225), (PX.tankL + PX.tankR) / 2, ry(65), PX.inlet - 2, ry(65)], 2);
        A(PX.inlet + 12, ry(65), PX.inlet - 8, ry(65), 2);
        // 循环泵并联
        L([PX.cp - 16, LY, PX.cp - 16, ry(240), PX.cp - 12, ry(240)], 2.2);
        L([PX.cp + 12, ry(240), PX.cp + 16, ry(240), PX.cp + 16, LY], 2.2);
        // 加热器并联
        L([PX.shL - 8, LY, PX.shL - 8, ry(240), PX.shL, ry(240)], 2.2);
        L([PX.shR, ry(240), PX.shR + 14, ry(240), PX.shR + 14, LY], 2.2);
        // 蒸汽管路（SRV 调节阀）
        L([PX.shR, ry(290), PX.srv - 9, ry(290)], 2);
        L([PX.srv + 9, ry(290), PX.end - 10, ry(290)], 2);
        A(PX.end - 24, ry(290), PX.end - 4, ry(290), 2);

        // ══ 设备符号 ══
        // 三通转换阀（三个顶点相交的三角形）
        {
            const cx = PX.cv, cy = LY, a = 10, b = 8;
            const tri = (pts) => g.add(new Konva.Line({
                points: pts, closed: true, fill: '#ffffff', stroke: '#111111',
                strokeWidth: 2, lineJoin: 'round',
            }));
            tri([cx - b, cy - a, cx + b, cy - a, cx, cy]);   // 上：HFO
            tri([cx - b, cy + a, cx + b, cy + a, cx, cy]);   // 下：DO
            tri([cx + a, cy - b, cx + a, cy + b, cx, cy]);   // 右：出口
        }

        // 泵（圆 + 实心三角）
        const pump = (cx, cy) => {
            const r = rs(45);
            g.add(new Konva.Circle({ x: cx, y: cy, radius: r, fill: '#ffffff', stroke: '#111111', strokeWidth: 2.6 }));
            g.add(new Konva.Line({
                points: [cx - r * 0.45, cy - r * 0.55, cx + r * 0.55, cy, cx - r * 0.45, cy + r * 0.55],
                closed: true, fill: '#111111',
            }));
        };
        pump(PX.sp, ry(240));
        pump(PX.sp, LY);
        pump(PX.cp, ry(240));
        pump(PX.cp, LY - 5);

        // 滤器（方框 + 虚线对角）
        const filter = (cx, cy) => {
            const s = rs(60);
            g.add(new Konva.Rect({ x: cx - s / 2, y: cy - s / 2, width: s, height: s, fill: '#ffffff', stroke: '#111111', strokeWidth: 2.2 }));
            g.add(new Konva.Line({ points: [cx - s * 0.3, cy - s * 0.3, cx + s * 0.3, cy + s * 0.3], stroke: '#111111', strokeWidth: 1.6, dash: [3, 3] }));
        };
        filter(PX.filt, ry(240));
        filter(PX.filt, LY);

        // 加热器 S/H
        const heater = (x, y, w, h) => {
            g.add(new Konva.Rect({ x, y, width: w, height: h, fill: '#ffffff', stroke: '#111111', strokeWidth: 2.2 }));
            g.add(new Konva.Line({
                points: [x + w * 0.22, y + h * 0.15, x + w * 0.75, y + h * 0.85],
                stroke: '#111111', strokeWidth: 2.4, lineCap: 'round',
            }));
            g.add(new Konva.Line({
                points: [x + w * 0.2, y + h * 0.55, x + w * 0.45, y + h * 0.15],
                stroke: '#111111', strokeWidth: 1.4, dash: [3, 3],
            }));
        };
        const shW = PX.shR - PX.shL;
        heater(PX.shL, ry(210), shW, ry(285) - ry(210));
        heater(PX.shL, ry(435), shW, ry(510) - ry(435));

        // 脱气阀（竖置双三角）
        const dvx = (PX.tankL + PX.tankR) / 2, dvy = ry(160), dvr = rs(26);
        g.add(new Konva.Line({
            points: [dvx - dvr, dvy - dvr * 0.8, dvx + dvr, dvy - dvr * 0.8, dvx, dvy], closed: true,
            fill: '#ffffff', stroke: '#111111', strokeWidth: 2,
        }));
        g.add(new Konva.Line({
            points: [dvx - dvr, dvy + dvr * 0.8, dvx + dvr, dvy + dvr * 0.8, dvx, dvy], closed: true,
            fill: '#ffffff', stroke: '#111111', strokeWidth: 2,
        }));

        // 混合筒
        g.add(new Konva.Rect({
            x: PX.tankL, y: ry(225), width: PX.tankR - PX.tankL, height: ry(535) - ry(225),
            fill: '#ffffff', stroke: '#111111', strokeWidth: 2.6,
        }));

        // 蒸汽调节阀 SRV（方框整体上移 5px → 阀芯连线 → 放大阀体）
        g.add(new Konva.Rect({
            x: PX.srv - 14, y: ry(220) - 5, width: 28, height: ry(258) - ry(220),
            fill: '#ffffff', stroke: '#111111', strokeWidth: 2,
        }));
        this._label(g, PX.srv - 14, ry(226) - 5, 'SRV', 7, '#111111', true, 'center', 28);
        L([PX.srv, ry(258) - 5, PX.srv, ry(290)], 1.8);
        this._valveSymbol(g, PX.srv, ry(290), rs(42));
        this._label(g, PX.srv - 48, ry(150) + 2, '−', 11, '#111111', true);
        this._label(g, PX.srv + 44, ry(150) + 2, '+', 11, '#111111', true);

        // 测量圆环
        const circle = (cx, cy, tag) => {
            const r = rs(42);
            g.add(new Konva.Circle({ x: cx, y: cy, radius: r, fill: '#ffffff', stroke: '#111111', strokeWidth: 2.4 }));
            this._label(g, cx - r, cy - 5, tag, 8, '#111111', true, 'center', r * 2);
        };
        circle(PX.ft, LY, 'FT');
        circle(PX.ps1, LY, 'PS');
        circle(PX.ps2, LY, 'PS');
        circle(PX.tt, LY, 'TT');
        circle(PX.vt, LY, 'VT');

        // 设备代号
        const tag = (txt, x, y, w = 30) => this._label(g, x - w / 2, y, txt, 9, '#111111', true, 'center', w);
        tag('SP2', PX.sp, ry(300));
        tag('SP1', PX.sp, ry(555));
        tag('M/F', PX.filt, ry(300));
        tag('A/F', PX.filt - 17, ry(560) - 10);
        tag('CP2', PX.cp, ry(300));
        tag('CP1', PX.cp, ry(545));
        tag('S/H', (PX.shL + PX.shR) / 2, ry(300));
        tag('S/H', (PX.shL + PX.shR) / 2, ry(585));

        // 进出口标注
        this._label(g, PX.inlet - 18, ry(368), 'HFO', 10, '#111111', true);
        this._label(g, PX.inlet - 18, ry(575), 'DO', 10, '#111111', true);

        // 右下 EPC PUMP CONTROL
        this._label(g, PX.vt - 42, ry(660), 'EPC PUMP', 9, '#111111', true, 'center', 84);
        this._label(g, PX.vt - 42, ry(706), 'CONTROL', 9, '#111111', true, 'center', 84);
    }

    /** 蝶形阀符号 */
    _valveSymbol(g, cx, cy, r) {
        g.add(new Konva.Line({
            points: [cx - r, cy - r * 0.55, cx - r, cy + r * 0.55, cx, cy], closed: true,
            fill: '#ffffff', stroke: '#111111', strokeWidth: 2, lineJoin: 'round',
        }));
        g.add(new Konva.Line({
            points: [cx + r, cy - r * 0.55, cx + r, cy + r * 0.55, cx, cy], closed: true,
            fill: '#ffffff', stroke: '#111111', strokeWidth: 2, lineJoin: 'round',
        }));
        g.add(new Konva.Line({ points: [cx, cy - r * 0.55, cx, cy - r * 1.6], stroke: '#111111', strokeWidth: 1.6 }));
    }

    // ═══════════════════════════════════════════════════════════
    //  动态节点
    // ═══════════════════════════════════════════════════════════
    _createDynamicNodes() {
        const d = this._dynamicGroup, G = this._geo, MI = this._mimic;

        this._bubbles = {};
        MI.lamps.forEach(l => {
            const c = new Konva.Circle({
                x: l.x, y: l.y, radius: MI.lampR,
                fill: '#eef1f4', stroke: '#111111', strokeWidth: 2,
            });
            d.add(c);
            this._bubbles[l.id] = c;
        });

        // LS 液位开关（与 MIMIC 同步：动作时红色）
        {
            const ry = (v) => MI.oy + v * MI.ky;
            const rs = (v) => v * 0.27;
            const r = rs(42);
            this._lsCircle = new Konva.Circle({
                x: MI.PX.ps1, y: ry(268), radius: r,
                fill: '#ffffff', stroke: '#111111', strokeWidth: 2.4,
            });
            this._lsTxt = new Konva.Text({
                x: MI.PX.ps1 - r, y: ry(268) - 7, width: r * 2, align: 'center', text: 'LS',
                fontSize: 12, fontStyle: 'bold', fill: '#111111',
                fontFamily: 'Arial, "Microsoft YaHei", sans-serif',
            });
            d.add(this._lsCircle);
            d.add(this._lsTxt);
        }

        this._lcdMain = new Konva.Text({
            x: G.lcd.x + 8, y: G.lcd.y + 6, width: G.lcd.w - 16, height: 34, wrap: 'none',
            text: '', fontSize: 22, fontStyle: 'bold', fill: '#ffcc33',
            fontFamily: 'Consolas, "Courier New", monospace', listening: false,
        });
        this._lcdSub = new Konva.Text({
            x: G.lcd.x + 8, y: G.lcd.y + G.lcd.h - 32, width: G.lcd.w - 16, height: 26, wrap: 'none',
            text: '', fontSize: 14, fill: '#ffbb33', align: 'right',
            fontFamily: 'Consolas, "Courier New", monospace', listening: false,
        });
        d.add(this._lcdMain, this._lcdSub);

        this._infoRows = [];
        for (let i = 0; i < 4; i++) {
            const t = new Konva.Text({
                x: G.info.x + 5, y: G.info.y + 21 + i * 22, width: G.info.w - 10, height: 19, wrap: 'none',
                text: '', fontSize: 13, fill: '#1b2a38',
                fontFamily: 'Consolas, "Microsoft YaHei", monospace', listening: false,
            });
            d.add(t);
            this._infoRows.push(t);
        }

        this._cardLeds = {};
        this._cardRows().forEach(r => r.leds.forEach(l => {
            const c = new Konva.Circle({ x: l.x, y: l.y, radius: 8, fill: '#c9ccce', stroke: '#2b2f2f', strokeWidth: 1 });
            d.add(c);
            this._cardLeds[l.id] = c;
        }));

        // 旋钮指针
        const L = this._ctrlLayout();
        this._knobs = {};
        L.sels.forEach(s => {
            this._knobs[s.key + '-sel'] = this._knobPointer(s.cx, s.cy, s.R, 0);
        });
        L.pumps.forEach(b => {
            this._knobs[b.key + '-main'] = this._knobPointer(b.knob.x, b.knob.y, b.knob.r, -135);
        });
        L.rvs.forEach(r => {
            this._knobs[r.key === 'rv' ? 'rv' : (r.key === 'heat' ? 'heat' : 'ht')] =
                this._knobPointer(r.cx, r.cy, r.R, r.key === 'heat' ? 0 : -45);
        });
        this._knobs['af-main'] = this._knobPointer(L.af.knob.x, L.af.knob.y, L.af.knob.r, -135);

        // 辅助电压灯
        this._auxLeds = {};
        L.pumps.forEach(b => {
            const c = new Konva.Circle({ x: b.lamp.x, y: b.lamp.y, radius: b.lamp.r, fill: '#d5d9dc', stroke: '#a7aeb4', strokeWidth: 1 });
            d.add(c);
            this._auxLeds['aux-' + b.key] = c;
        });
        {
            const c = new Konva.Circle({ x: L.af.auxLamp.x, y: L.af.auxLamp.y, radius: L.af.auxLamp.r, fill: '#d5d9dc', stroke: '#a7aeb4', strokeWidth: 1 });
            d.add(c);
            this._auxLeds['aux-af'] = c;
            const o = new Konva.Circle({ x: L.af.overLamp.x, y: L.af.overLamp.y, radius: L.af.overLamp.r, fill: '#e08a1e', stroke: '#8d5306', strokeWidth: 1 });
            d.add(o);
            this._afOverload = o;
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  交互
    // ═══════════════════════════════════════════════════════════
    _clearPartBg(hit) {
        try {
            const p = hit && hit.getParent && hit.getParent();
            const bg = p && p.getChildren && p.getChildren()[0];
            if (bg && typeof bg.fill === 'function') bg.fill('rgba(0,0,0,0)');
        } catch (e) { /* ignore */ }
    }

    _bindInteraction() {
        const G = this._geo, MI = this._mimic, C = G.cards;

        const hl = this.addClickablePart('lcd', G.lcd.x, G.lcd.y, G.lcd.w, G.lcd.h, true);
        hl.on('click tap', () => this._tipPart('lcd'));
        this._clearPartBg(hl);
        const hi = this.addClickablePart('info', G.info.x, G.info.y, G.info.w, G.info.h, true);
        hi.on('click tap', () => this._tipPart('info'));
        this._clearPartBg(hi);

        const K = G.keys;
        [['key-minus', 0], ['key-plus', 1], ['key-enter', 2]].forEach(([id, i]) => {
            const x = K.x + i * (K.w + K.gap);
            const h = this.addClickablePart(id, x, K.y, K.w, K.h, true);
            h.on('click tap', () => this._onPart(id));
            this._clearPartBg(h);
        });

        const rows = this._cardRows();
        rows.forEach(r => r.leds.forEach(l => {
            const h = this.addClickablePart(l.id, l.x - 9, l.y - 9, 18, 18, true);
            h.on('click tap', () => this._tipPart(l.id));
            this._clearPartBg(h);
        }));
        rows.forEach(r => {
            if (!r.btn) return;
            const h = this.addClickablePart(r.btn.id, r.btn.x, r.btn.y, r.btn.w, r.btn.h, true);
            h.on('click tap', () => this._onPart(r.btn.id));
            this._clearPartBg(h);
        });

        MI.devices.forEach(dv => {
            const h = this.addClickablePart(dv.id, dv.x, dv.y, dv.w, dv.h, true);
            h.on('click tap', () => this._tipPart(dv.id));
            this._clearPartBg(h);
        });
        MI.lamps.forEach(l => {
            const r = MI.lampR;
            const h = this.addClickablePart(l.id, l.x - r, l.y - r, r * 2, r * 2, true);
            h.on('click tap', () => this._tipPart(l.id));
            this._clearPartBg(h);
        });

        // 旋钮左右半区
        const half = (idL, idR, cx, cy, R) => {
            const a = this.addClickablePart(idL, cx - R, cy - R, R, R * 2, true);
            a.on('click tap', () => this._onPart(idL));
            this._clearPartBg(a);
            const b = this.addClickablePart(idR, cx, cy - R, R, R * 2, true);
            b.on('click tap', () => this._onPart(idR));
            this._clearPartBg(b);
        };

        const L = this._ctrlLayout();
        L.sels.forEach(s => {
            half(s.key + '-sel-ccw', s.key + '-sel', s.cx, s.cy, s.R);
        });
        L.pumps.forEach(b => {
            half(b.key + '-main-ccw', b.key + '-main', b.knob.x, b.knob.y, b.knob.r);
            const h = this.addClickablePart('aux-' + b.key, b.lamp.x - b.lamp.r, b.lamp.y - b.lamp.r, b.lamp.r * 2, b.lamp.r * 2, true);
            h.on('click tap', () => this._tipPart('aux-' + b.key));
            this._clearPartBg(h);
        });
        // 调节阀 / DECR-INCR / TRACING
        const rv = L.rvs.find(r => r.key === 'rv');
        const heat = L.rvs.find(r => r.key === 'heat');
        const ht = L.rvs.find(r => r.key === 'ht');
        half('rv-man', 'rv-epc', rv.cx, rv.cy, rv.R);
        // DECR/INCR：按住连续调节，松手复位（开度保持）；单击（自动演示）为步进调节
        {
            const mkHeat = (id, dir) => {
                const h = this.addClickablePart(id,
                    dir < 0 ? heat.cx - heat.R : heat.cx, heat.cy - heat.R, heat.R, heat.R * 2, true);
                h.on('mousedown touchstart', () => {
                    const sv = this._solver();
                    if (sv && sv.beginHeat(dir)) { this._ui.heatHold = dir; this._heatSkipClick = true; }
                    this._syncVisuals();
                });
                h.on('mouseup touchend mouseleave', () => {
                    const sv = this._solver();
                    if (sv) sv.endHeat();
                    if (this._ui.heatHold) this._ui.heatHold = 0;
                    // 真实鼠标事件会紧跟一次 click，需要忽略；稍后自动清除，避免吞掉后续程序点击
                    setTimeout(() => { this._heatSkipClick = false; }, 300);
                    this._syncVisuals();
                });
                h.on('click tap', () => {
                    if (this._heatSkipClick) { this._heatSkipClick = false; return; }
                    const sv = this._solver();
                    if (!sv) return;
                    sv.nudgeHeat(dir);
                    this._ui.heatKnob = dir > 0 ? 'INCR' : 'DECR';
                    this._heatResetAt = performance.now() + 450;
                    this._syncVisuals();
                });
                this._clearPartBg(h);
            };
            mkHeat('heat-decr', -1);
            mkHeat('heat-incr', 1);
        }
        half('ht-ccw', 'ht', ht.cx, ht.cy, ht.R);
        {
            const h = this.addClickablePart('aux-af', L.af.auxLamp.x - L.af.auxLamp.r, L.af.auxLamp.y - L.af.auxLamp.r,
                L.af.auxLamp.r * 2, L.af.auxLamp.r * 2, true);
            h.on('click tap', () => this._tipPart('aux-af'));
            this._clearPartBg(h);
            const h2 = this.addClickablePart('af-overload', L.af.overLamp.x - L.af.overLamp.r, L.af.overLamp.y - L.af.overLamp.r,
                L.af.overLamp.r * 2, L.af.overLamp.r * 2, true);
            h2.on('click tap', () => this._tipPart('af-overload'));
            this._clearPartBg(h2);
            // 自动滤器主开关（左右半区）
            half('af-main-ccw', 'af-main', L.af.knob.x, L.af.knob.y, L.af.knob.r);
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  部件说明
    // ═══════════════════════════════════════════════════════════
    _tipPart(id) {
        const s = this._solver();
        const m = s ? s.m : null;
        if (!m) return;
        const dev = this._mimic.devices.find(d => d.id === id);
        if (dev) { this._tip(dev.text); return; }
        const lamp = this._mimic.lamps.find(l => l.id === id);
        if (lamp) {
            const st = this._lampState(lamp.id, m);
            this._tip(`${lamp.text}：${st === 'on' ? '点亮（绿）' : st === 'alarm' ? '报警（红）' : '熄灭'}`);
            return;
        }
        if (id === 'lcd') { this._tip('EPC-50B 液晶显示器：显示运行状态、参数与报警；用 − / + / ENTER 键翻看与修改参数'); return; }
        if (id === 'info') { this._tip('INFO 信息区：显示运行状态、油温、黏度与流量；PROCESS INFO 键可翻页'); return; }
        if (id === 'led-hfo') { this._tip(`HFO 指示灯：${m.cv === 'HFO' ? '亮——三通转换阀在上位' : '灭'}`); return; }
        if (id === 'led-do') { this._tip(`DO 指示灯：${m.cv === 'DO' ? '亮——三通转换阀在下位' : '灭'}`); return; }
        if (id === 'fn-op') { this._tip('OP ACTIVE 指示灯：面板激活（主电源合上、无未确认报警）时点亮'); return; }
        if (id === 'af-overload') { this._tip(`AutoFilter Overload 过载指示：${m.filter.overload ? '过载报警' : '正常'}`); return; }
        if (id && id.startsWith('aux-')) {
            const map = { 'aux-sp1': 'sp1', 'aux-sp2': 'sp2', 'aux-cp1': 'cp1', 'aux-cp2': 'cp2', 'aux-af': null };
            if (map[id] === null) { this._tip(`自动滤器辅助电压：${m.filter.mainSwitch && m.mainPower ? '已建立（绿色）' : '无电压'}`); return; }
            const p = m.pumps[map[id]];
            this._tip(`${p.name} 辅助电压：${p.aux ? '已建立（绿色）' : '无电压'}`);
            return;
        }
        this._tip(id);
    }

    /** 指示灯：'on' 常亮 / 'blink' 400ms 闪烁 / 'off' 灭 */
    _lampBlink(st) {
        if (st === 'on') return true;
        if (st !== 'blink') return false;
        return Math.floor(Date.now() / 400) % 2 === 0;
    }

    /** 三态指示灯状态：'on' 绿 / 'alarm' 红 / 'off' 灭 */
    _lampState(id, m) {
        const spRun = m.pumps.sp1.on || m.pumps.sp2.on;
        const cpRun = m.pumps.cp1.on || m.pumps.cp2.on;
        const oilFlow = (m.oil.flow || 0) > 0.05;          // 管路中确有油流动
        switch (id) {
            case 'led-mf': return (oilFlow && m.strainerSel === 'mf') ? 'on' : 'off';   // 走手动滤器
            case 'led-af': return (oilFlow && m.strainerSel === 'af') ? 'on' : 'off';   // 走自动滤器
            case 'led-ft': return (m.oil.ftFlow || 0) > 0.05 ? 'on' : 'off';            // 流过 FT 才有流量
            case 'led-ps1':
                if (!spRun) return 'off';
                return (m.oil.supplyPress || 0) > 0.2 ? 'on' : 'alarm';                 // PT1 压力开关
            case 'led-ps2':
                if (!cpRun) return 'off';
                return (m.oil.circPress || 0) > 0.4 ? 'on' : 'alarm';                   // PT2 压力开关
            case 'led-sh': return 'on';                                                 // 蒸汽供应正常：常亮
            default: return this._lampOn(id, m) ? 'on' : 'off';
        }
    }

    /** 状态灯逻辑（按设备实际状态） */
    _lampOn(id, m) {
        const spRun = m.pumps.sp1.on || m.pumps.sp2.on;
        const cpRun = m.pumps.cp1.on || m.pumps.cp2.on;
        const supplyOk = spRun && m.oil.supplyPress > 0.1;
        const heatOn = (m.heater.effPower || 0) > 2;
        switch (id) {
            case 'led-hfo': return this._lampBlink((m.lamp && m.lamp.hfo) || (m.cv === 'HFO' ? 'on' : 'off'));
            case 'led-do': return this._lampBlink((m.lamp && m.lamp.do) || (m.cv === 'DO' ? 'on' : 'off'));
            case 'led-sp1': return m.pumps.sp1.on;
            case 'led-sp2': return m.pumps.sp2.on;
            case 'led-mf': return !!(m.filter.mainSwitch && m.mainPower && m.filter.mode === 'MAN');
            case 'led-af': return !!(m.filter.mainSwitch && m.mainPower && m.filter.mode === 'AUTO');
            case 'led-drain': return m.filter.flushing;
            case 'led-ft': return supplyOk;                         // 泵运行且压力/流量建立
            case 'led-ps1': return supplyOk;
            case 'led-ls': return m.dea.level < 30;                 // 液位低（气体多）
            case 'led-dea': return m.dea.valve;                     // 脱气阀接通回气
            case 'led-cp1': return m.pumps.cp1.on;
            case 'led-cp2': return m.pumps.cp2.on;
            case 'led-sh': return heatOn;                           // 蒸汽/加热投入
            case 'led-srv-dec': return !!(this._srv && this._srv.dec);   // 阀开度减少（DECR）
            case 'led-srv-inc': return !!(this._srv && this._srv.inc);   // 阀开度增加（INCR）
            case 'led-ps2': return cpRun;
            case 'led-tt': return this._lampBlink(m.lamp && m.lamp.tt);
            case 'led-vt': return this._lampBlink(m.lamp && m.lamp.vt);
            case 'led-epc-pump': {
                const anyPower = Object.values(m.pumps).some(p => p.mainSwitch);
                const anyEpc = Object.values(m.pumps).some(p => p.mode === 'EPC');
                return anyPower && anyEpc;
            }
            default: return false;
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  操作处理
    // ═══════════════════════════════════════════════════════════
    _onPart(id) {
        const s = this._solver();
        if (!s) return;
        const m = s.m, u = this._ui;

        if (id === 'key-enter') { this._onEnter(); this._syncVisuals(); return; }
        if (id === 'key-plus' || id === 'key-minus') {
            const yes = id === 'key-plus';
            if (m.pendingProc !== null) { s.answerProcToggle(yes); this._syncVisuals(); return; }
            this._onAdjust(yes ? 1 : -1);
            this._syncVisuals();
            return;
        }

        if (id === 'fn-start') {
            if (!m.mainPower) { this._tip('请先合上控制箱电源（各泵 MAIN SWITCH 与 OP 电源）'); return; }
            s.requestProcToggle();          // 弹 START? / STOP? 确认（+=yes  -=no）
            this._syncVisuals();
            return;
        }
        if (id === 'btn-oil') {
            if (m.pendingMode) s.cancelModeChange();
            else s.requestModeChange();
            this._syncVisuals();
            return;
        }
        if (id === 'fn-process') {
            u.infoPage = (u.infoPage + 1) % s.infoPageCount();
            this._tip(`INFO 翻页：第 ${u.infoPage + 1} 页`);
            this._syncVisuals();
            return;
        }
        if (id === 'fn-alarm') { s.pressAlarmReset(); this._syncVisuals(); return; }

        const selMap = { 'sp1-sel': 'sp1', 'sp2-sel': 'sp2', 'cp1-sel': 'cp1', 'cp2-sel': 'cp2' };
        const pid = selMap[id] || selMap[id.replace('-ccw', '')];
        if (pid) {
            s.cyclePumpMode(pid, id.endsWith('-ccw') ? -1 : 1);
            this._syncVisuals();
            return;
        }
        if (id === 'af-sel' || id === 'af-sel-ccw') {
            s.cycleFilterMode(id.endsWith('-ccw') ? -1 : 1);
            this._syncVisuals();
            return;
        }

        const mainMap = { 'sp1-main': 'sp1', 'sp2-main': 'sp2', 'cp1-main': 'cp1', 'cp2-main': 'cp2' };
        const mk = mainMap[id] || mainMap[id.replace('-ccw', '')];
        if (mk) {
            const cur = m.pumps[mk].mainSwitch;
            s.setPumpMainSwitch(mk, !cur);
            this._tip(`${m.pumps[mk].name} MAIN SWITCH ${!cur ? 'ON（辅助电压建立）' : 'OFF'}`);
            this._syncVisuals();
            return;
        }
        if (id === 'af-main' || id === 'af-main-ccw') {
            const cur = m.filter.mainSwitch;
            s.setFilterMainSwitch(!cur);
            this._tip(`自动滤器 MAIN SWITCH ${!cur ? 'ON' : 'OFF'}`);
            this._syncVisuals();
            return;
        }

        if (id === 'rv-man') { s.setRegValveMode('MAN'); this._syncVisuals(); return; }
        if (id === 'rv-epc') { s.setRegValveMode('EPC'); this._syncVisuals(); return; }
        if (id === 'heat-decr') { s.nudgeHeat(-1); u.heatKnob = 'DECR'; this._heatResetAt = performance.now() + 450; this._syncVisuals(); return; }
        if (id === 'heat-incr') { s.nudgeHeat(+1); u.heatKnob = 'INCR'; this._heatResetAt = performance.now() + 450; this._syncVisuals(); return; }
        if (id === 'ht' || id === 'ht-ccw') {
            s.setHeatTracing(id === 'ht' ? 1 : 0);
            this._syncVisuals();
            return;
        }
    }

    // ── 菜单 ──
    _onEnter() {
        const u = this._ui, s = this._solver();
        if (!s) return;
        const m = s.m;
        if (m.pendingMode) { s.answerModeChange(true); return; }
        if (u.page === 'main') { u.mainPage = 0; u.page = 'menu'; u.menu = 0; return; }
        if (u.page === 'menu') {
            const item = this._menuItems()[u.menu];
            if (!item) return;
            if (item[0] === 'main') { u.page = 'main'; return; }
            u.page = item[0];
            if (u.page === 'params') u.param = 0;
            if (u.page === 'alarms') u.alarmIdx = 0;
            return;
        }
        if (u.page === 'params') {
            if (u.editing) {
                const key = this._paramItems()[u.param][0];
                s.setParam(key, u.editVal);
                u.editing = false;
                u.page = 'menu';
                this._tip(`${key} 已修改并保存`);
            } else {
                const it = this._paramItems()[u.param];
                if (it) { u.editing = true; u.editVal = s.getParam(it[0]); }
            }
            return;
        }
        u.page = 'menu';
    }

    _onAdjust(dir) {
        const u = this._ui, s = this._solver();
        if (!s) return;
        const m = s.m;
        if (m.pendingMode) { s.answerModeChange(dir > 0); return; }
        if (u.page === 'menu') {
            u.menu = clampInt(u.menu + dir, 0, this._menuItems().length - 1);
        } else if (u.page === 'main') {
            u.mainPage = ((u.mainPage || 0) + dir + 7) % 7;   // 0 主显 → 1 PT1 → 2 PT2 → 3 SRV → 4 TT → 5 VT → 6 OIL（循环）
        } else if (u.page === 'alarms') {
            const n = (m.alarms || []).filter(a => a.active).length;
            if (n > 0) u.alarmIdx = (((u.alarmIdx || 0) + dir) % n + n) % n;   // 多故障循环切换
        } else if (u.page === 'params') {
            const items = this._paramItems();
            if (u.editing) {
                const it = items[u.param];
                if (!it) return;
                if (it[0] === 'Pr1' || it[0] === 'Pr2') {
                    const order = [1, 2, 12, 21];
                    const i = Math.max(0, order.indexOf(Number(u.editVal)));
                    u.editVal = order[clampInt(i + dir, 0, order.length - 1)];
                } else if (it[0] === 'Pr19') {
                    u.editVal = (u.editVal === 'VISC') ? 'TEMP' : 'VISC';
                } else if (it[0] === 'Pr24') {
                    u.editVal = clampInt(Number(u.editVal) + dir, 1, 3);
                } else {
                    const step = it[3] || 1, dec = it[4] || 0;
                    u.editVal = Number((Number(u.editVal) + dir * step).toFixed(dec));
                }
            } else {
                u.param = clampInt(u.param + dir, 0, items.length - 1);
            }
        }
    }

    _menuItems() {
        return [
            ['params', '参数设置'],
            ['alarms', '报警记录'],
            ['info', '操作信息'],
            ['main', '返回主画面'],
        ];
    }

    _paramItems() {
        return [
            ['Pr1', '供油泵方式', '', 1, 0],
            ['Pr2', '循环泵方式', '', 1, 0],
            ['Pr10', '泵起动间隔', 's', 1, 0],
            ['Pr11', '出口压力下限', 'MPa', 0.01, 2],
            ['Pr19', '控制方式', '', 0, 0],
            ['Pr20', '黏度设定值', 'cSt', 1, 0],
            ['Pr23', '密度设定', 'kg/L', 0.01, 2],
            ['Pr24', 'HFO 油品等级', '', 1, 0],
            ['Pr30', 'HFO 目标温度', 'C', 1, 0],
            ['Pr32', 'HFO 低温限制', 'C', 1, 0],
            ['Pr35', 'DO 温控设定值', 'C', 1, 0],
            ['Fa8', '报警延时', 's', 1, 0],
            ['Fa9', '压力确认延时', 's', 5, 0],
            ['Fa14', '自动转 DO 低温值', 'C', 1, 0],
            ['Fa16', '消耗百分比', '%', 5, 0],
            ['Fa21', '滤器冲洗间隔', 'min', 1, 0],
            ['Fa22', '冲洗时间', 's', 1, 0],
            ['Fa25', '蒸汽比例带', 'C', 2, 0],
            ['Fa26', '蒸汽积分时间', 's', 5, 0],
            ['Fa30', 'HFO 温升速率', 'C/min', 1, 0],
            ['Fa31', 'DO 温升速率', 'C/min', 1, 0],
        ];
    }

    // ═══════════════════════════════════════════════════════════
    //  显示同步
    // ═══════════════════════════════════════════════════════════
    _lcdScreen(m) {
        const u = this._ui, s = this._solver();
        if (m.pendingMode) return { main: 'Change oil?', sub: '+=yes  -=no' };
        if (m.pendingProc !== null) return { main: m.pendingProc ? 'START?' : 'STOP?', sub: '+=yes  -=no', size: 18 };
        if (u.page === 'menu') {
            const items = this._menuItems();
            return { main: 'MENU', sub: `${u.menu + 1}/${items.length}  ${items[u.menu][1]}` };
        }
        if (u.page === 'params') {
            const items = this._paramItems();
            const it = items[u.param];
            if (!it) return { main: 'PARAMS', sub: '' };
            const raw = u.editing ? u.editVal : s.getParam(it[0]);
            const v = (it[0] === 'Pr1' || it[0] === 'Pr2')
                ? ({ '1': '1', '2': '2', '12': '1(2)', '21': '2(1)' }[String(raw)] || raw)
                : raw;
            // 参数名与参数号（如 Pr1）一起显示
            return { main: `${it[0]}  ${it[1]}`, sub: `${v} ${it[2]}${u.editing ? '  *' : ''}`, size: 15 };
        }
        if (u.page === 'alarms') {
            const list = (m.alarms || []).filter(a => a.active);
            if (!list.length) return { main: 'ALARM', sub: 'NO ACTIVE ALARM' };
            const i = Math.min(Math.max(0, u.alarmIdx || 0), list.length - 1);
            const a = list[i];
            return {
                main: list.length > 1 ? `${a.code}  ${i + 1}/${list.length}` : a.code,
                sub: `${a.text}${list.length > 1 ? '   +/- 切换' : ''}`,
                size: 14,
            };
        }
        if (u.page === 'info') return { main: 'EPC-50B', sub: 'FCM FUEL SUPPLY UNIT' };

        const st = s.stateText();
        // 有未确认报警：液晶显示报警号 + 报警文字
        const alarm = (m.alarms || []).find(a => a.active && !a.ack);
        if (alarm) return { main: alarm.code, sub: alarm.text, size: 13 };

        // ── 主画面 +/− 翻页：PT1 / PT2 / SRV / TT / VT / OIL ──
        const mp = u.mainPage || 0;
        if (mp > 0) {
            const ttTxt2 = m.oil.ttBad ? '***' : (m.oil.ttVal || 0).toFixed(1);
            const vtTxt2 = m.oil.vtBad ? '***' : (m.oil.vtVal || 0).toFixed(1);
            const pages = [
                null,
                { main: 'PT1 供油压力', sub: `${(m.oil.supplyPress || 0).toFixed(2)} MPa`, size: 15 },
                { main: 'PT2 进机压力', sub: `${(m.oil.circPress || 0).toFixed(2)} MPa`, size: 15 },
                { main: 'SRV 开度', sub: `${(m.heater.shs || 0).toFixed(1)} %`, size: 15 },
                { main: 'TT 温度', sub: `${ttTxt2} C`, size: 15 },
                { main: 'VT 黏度', sub: `${vtTxt2} cSt`, size: 15 },
                { main: 'OIL 油品', sub: m.oilMode === 'DO' ? 'DO' : `HFO G${m.params.Pr24}`, size: 15 },
            ];
            if (pages[mp]) return pages[mp];
        }
        // 显示 VT / TT 实测值（无流动时测不到显示 0；传感器故障显示 ***）
        const vtTxt = m.oil.vtBad ? '***' : (m.oil.vtVal || 0).toFixed(1);
        const ttTxt = m.oil.ttBad ? '***' : (m.oil.ttVal || 0).toFixed(1);
        const sub = (m.ctrl.kind === 'VISC')
            ? `${vtTxt} cSt  ${m.oil.ttBad ? '***' : (m.oil.ttVal || 0).toFixed(0)} C`
            : `${ttTxt} C  ${(m.oil.ftFlow || 0).toFixed(1)} m3/h`;
        return { main: st, sub };
    }

    _syncVisuals() {
        const s = this._solver();
        const m = s ? s.m : null;
        if (!m) return;
        const u = this._ui;
        const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        const blink = Math.floor(now / 450) % 2 === 0;

        const sc = this._lcdScreen(m);
        this._lcdMain.fontSize(sc.size || 22);
        this._lcdMain.text(sc.main);
        this._lcdSub.text(u.editing ? (blink ? sc.sub : '') : sc.sub);
        this._lcdMain.fill(m.epcPower ? '#ffcc33' : '#6b5a20');
        this._lcdSub.fill(m.epcPower ? '#ffbb33' : '#6b5a20');

        const lines = s.infoLines(u.infoPage);
        this._infoRows.forEach((t, i) => t.text(lines[i] || ''));

        // 调节阀增减旋钮：自复位到中位（向上），并按方向点亮 SRV 左/右指示灯
        if (!u.heatHold && u.heatKnob !== 'UP' && now > (this._heatResetAt || 0)) u.heatKnob = 'UP';
        let srvInc = false, srvDec = false;
        if (u.heatHold > 0 || u.heatKnob === 'INCR') srvInc = true;
        else if (u.heatHold < 0 || u.heatKnob === 'DECR') srvDec = true;
        else {
            const shsNow = m.heater.shs || 0;
            const prev = (this._lastShs === undefined) ? shsNow : this._lastShs;
            // 开度按 0.5% 脉冲步进：出现 ≥0.4% 的变化即记录方向，并保持 600ms 不闪
            if (shsNow > prev + 0.4) { this._srvDir = 1; this._srvT = now; }
            else if (shsNow < prev - 0.4) { this._srvDir = -1; this._srvT = now; }
            srvInc = this._srvDir === 1 && (now - (this._srvT || 0)) < 600;
            srvDec = this._srvDir === -1 && (now - (this._srvT || 0)) < 600;
            this._lastShs = shsNow;
        }
        this._srv = { inc: srvInc, dec: srvDec };

        // ── 流程图状态灯（按设备实际状态点亮）──
        const ONC = '#2ecc40', OFFC = '#eef1f4';
        // LS 液位开关：与 MIMIC 图一致（液位低／脱气动作时红色）
        if (this._lsCircle && m.dea) {
            const on = !!m.dea.valve;
            this._lsCircle.fill(on ? '#e53935' : '#ffffff');
            this._lsTxt.fill(on ? '#ffffff' : '#111111');
        }

        this._mimic.lamps.forEach(l => {
            const c = this._bubbles[l.id];
            if (c) {
                const st = this._lampState(l.id, m);
                c.fill(st === 'on' ? ONC : st === 'alarm' ? '#e53935' : OFFC);
            }
        });

        const cardLed = (id, on, color = '#28e05a', phase = true) => {
            const c = this._cardLeds[id];
            if (!c) return;
            c.fill(on ? (phase ? color : '#c9ccce') : '#c9ccce');
        };
        const procPend = (m.pendingProc !== null);
        cardLed('led-start', procPend || m.procOn, '#28e05a', procPend ? blink : true);
        cardLed('led-hfo', m.cv === 'HFO', '#8b3a1a');   // 红褐色
        cardLed('led-do', m.cv === 'DO', '#f2c200');   // 黄色
        cardLed('led-op', !!(m.mainPower && m.epcPower && !m.alarmActive), '#28e05a');
        // 报警灯：未确认（含故障已消失但未复位）→ 闪烁；已复位但故障仍在 → 常亮；无报警 → 灭
        const alamp = m.alarmLamp || 'off';
        cardLed('led-alarm', alamp !== 'off', '#ff2d2d', alamp === 'blink' ? blink : alamp === 'on');

        // ── 选择开关旋钮角度（与档位标注重合：左 60° = MAN，上 = STOP，右 60° = 自动，右 120° = REM / 左 120° = DRAIN）──
        const setRot = (id, rot) => { const k = this._knobs[id]; if (k) k.rotation(rot); };
        const modeRot = { MAN: -60, STOP: 0, EPC: 60, REM: 120 };
        ['sp1', 'sp2', 'cp1', 'cp2'].forEach(k => setRot(k + '-sel', modeRot[m.pumps[k].mode] ?? 0));
        // ── 主开关：ON = 左 45°，OFF = 左 135° ──
        ['sp1', 'sp2', 'cp1', 'cp2'].forEach(k => setRot(k + '-main', m.pumps[k].mainSwitch ? -45 : -135));
        setRot('af-sel', { DRAIN: -120, MAN: -60, STOP: 0, AUTO: 60 }[m.filter.mode] ?? 0);
        setRot('af-main', m.filter.mainSwitch ? -45 : -135);
        setRot('rv', m.heater.regMode === 'MAN' ? -45 : 45);
        setRot('heat', { UP: 0, INCR: 45, DECR: -45 }[
            u.heatHold > 0 ? 'INCR' : (u.heatHold < 0 ? 'DECR' : u.heatKnob)] ?? 0);
        setRot('ht', m.heater.tracing ? 45 : -45);

        const aux = (id, on) => { const c = this._auxLeds[id]; if (c) c.fill(on ? '#28e05a' : '#d5d9dc'); };
        ['sp1', 'sp2', 'cp1', 'cp2'].forEach(k => aux('aux-' + k, m.pumps[k].aux));
        aux('aux-af', m.filter.mainSwitch && m.mainPower);
        if (this._afOverload) this._afOverload.fill(m.filter.overload ? (blink ? '#ff9d2e' : '#e08a1e') : '#e08a1e');

        if (!m.epcPower && u.page !== 'main') { u.page = 'main'; u.editing = false; }

        if (this.sys && this.sys.requestRedraw) this.sys.requestRedraw();
    }

    tick() {
        this._syncVisuals();
        this._refreshIfDirty();
    }

    getConfigFields() {
        return [
            { label: '器件名称 (ID)', key: 'id', type: 'text' },
            { label: '宽度', key: 'width', type: 'number' },
            { label: '高度', key: 'height', type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.id) this.id = cfg.id;
        this.config = { ...this.config, ...cfg };
        if (this.sys && this.sys.requestRedraw) this.sys.requestRedraw();
    }
}

const clampInt = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export default EPC50BController;
