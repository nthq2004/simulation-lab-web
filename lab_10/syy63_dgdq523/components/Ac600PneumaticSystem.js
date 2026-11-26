import Konva from 'konva';
import { BaseComponent } from './BaseComponent.js';
import { ac600Of } from '../tools/AC600Solver.js';

/**
 * Ac600PneumaticSystem — 主机气动操纵系统图
 * ═══════════════════════════════════════════════════════════════
 *  1600 × 800，照 MAN B&W AC 600 气动操纵系统参考图逐块绘制。
 *
 *  ┌──────────────────────────────────────────────────────────────┐
 *  │ 左上 空气干燥器组(虚线框)：截止阀 + 两条并联支路(止回阀/滤器/   │
 *  │      干燥器) + 中竖支 + 右立管 + 出口截止阀                     │
 *  │ 上中 起动空气 29.8 Bar ──→ 主起动阀（「工作」绿 / 「阻塞」灰）   │
 *  │ 右上 慢转起动阀、PS 压力开关、1 号气缸起动阀 / …2               │
 *  ├──────────────────────────────────────────────────────────────┤
 *  │ 中   气缸起动阀组 A / B / C ──→ 两只两位五通换向阀               │
 *  │ 左中 1 号气缸排气阀 / …2                                        │
 *  ├──────────────────────────────────────────────────────────────┤
 *  │ 下   盘车机（Engaged / Disengaged）、控制空气 7.0 Bar、40 L 气瓶 │
 *  │ 左下 两只手动操纵阀；右下 主机转速                               │
 *  └──────────────────────────────────────────────────────────────┘
 *
 *  全部管线为正交折线，端点只落在「设备端口 / 母管 / 圆阀圆周」上。
 *  几何常量集中在文件头，新增管件一律引用常量。
 *
 *  部件 id：bottle main-valve slow-valve cyl-valve distributor
 *          turning-gear ctrl-air rpm-tag dryer ps
 * ═══════════════════════════════════════════════════════════════
 */

const W = 1600, H = 870;

const _rect = (o) => new Konva.Rect(Object.assign({ listening: false }, o));
const _text = (o) => new Konva.Text(Object.assign({ listening: false, fontFamily: 'Arial, Microsoft YaHei' }, o));
const _line = (o) => new Konva.Line(Object.assign({ listening: false }, o));
const _circle = (o) => new Konva.Circle(Object.assign({ listening: false }, o));

// ── 阀门三角形统一尺寸（mimic-valve-symbols：TRI_A=13.5, TRI_B=9.5）──
const TRI_A = 13.5, TRI_B = 9.5;

/** 顶点在阀芯中心 (cx,cy)、基边距中心 a、基边半宽 b、指向角度 ang(度) */
function triPts(cx, cy, ang, a = TRI_A, b = TRI_B) {
    const r = ang * Math.PI / 180;
    const ux = Math.cos(r), uy = Math.sin(r);
    const px = -uy, py = ux;
    const bx = cx + ux * a, by = cy + uy * a;
    return [bx + px * b, by + py * b, bx - px * b, by - py * b, cx, cy];
}

const C_BG = '#fbfcfd';
const C_PIPE = '#1c56d6';       // 气动管路（起动空气）
const C_PIPE_LP = '#5aa0e0';    // 细管路（控制空气），线宽 3.5
const C_EDGE = '#1b2430';
const C_BOX = '#0b3fa0';
const C_VALBAR = '#3b4d9e';      // 数值框蓝条
const C_OPEN = '#2ecc40';        // 截止阀导通（两三角填充）
const C_AIR_ON = '#3fa3e8';      // 气动控制接口有先导气体（蓝色填充）
const START_VALVE_TRAVEL_S = 1;                          // 活塞最左 ⇄ 最右行程时间（s），即主起动阀开/关时间

// ── 机旁操纵复刻件（从机旁面板原样复制：三档起动开关 + 调速手柄大表盘）──
//   放在「主机转速」框下方的空白区，方便在气动系统页直接操车，不必来回切页
const LCP_K = 2 / 3;                       // 复刻件整体缩到机旁面板原尺寸的 2/3
const LCP = {
    boxX: 1205, boxY: 700,                 // 三档开关外框左上角（与调速表盘并列，居中于主机转速框下方）
    boxW: 176 * LCP_K, boxH: 154 * LCP_K,  // 缩放后的外框尺寸（117.3 × 102.7）
    knobX: 1205 + 88 * LCP_K,              // 旋钮圆心（框内居中）
    knobY: 700 + 88 * LCP_K,
    dialX: 1450, dialY: 750, dialMax: 135, // 调速手柄大表盘圆心（半径绘制时 96 × 2/3）
};
const CHK_TH = (26.9 * Math.PI) / 180;                 // 止回阀斜线与水平夹角（原 ≈16.9° + 10°）
const CHK_TIP = (cx, r, dir = 1) => cx + dir * (r / Math.sin(CHK_TH));   // 球与斜线相切时的尖端 x

// ── 版面关键坐标 ───────────────────────────────────────────────
const DRY = { x: 78, y: 4, w: 362, h: 218 };        // 干燥器组虚线框
const DRY_Y1 = 46, DRY_Y2 = 176;                     // 两条并联支路
const DRY_RISER = 412;                               // 右立管
const DRY_MID = 113;                                 // 中线（出口）
const VAL_IN = { x: 108, y: 113, r: TRI_A };            // 左截止阀
const VAL_OUT = { x: 472, y: 113, r: TRI_A };           // 出口截止阀
const AIR = { x: 640, y: 10, w: 190, h: 90 };        // 起动空气数值框
const MSV = { x: 936.5, y: 55, r: 26 };              // 主起动阀（右移 1.5）
const STV = { x: 1085, y: 145, r: 26 };              // 慢转起动阀（右移 30）
const PS = { x: 1330, y: 73, r: 13 };                // PS 压力开关
const TOP_Y = 55;                                    // 顶部总管
const TOP_X2 = 1460;                                  // 顶部总管右端＝2 号进气管所在 x（不留间隙）
const GRP = { x: 790, y: 140, w: 66, h: 380 };       // A/B/C 分组框
const CYL_L = 780, CYL_R = 866;                      // A/B/C 左右母线
const CYL_YS = [227, 432, 632];                      // A/B/C 阀中心
const SV = { x: 823.5, y: 292, w: 32.5, h: 75 };     // 双座止回阀（梭阀）：上下入口管等长（各 65 px 竖直段）
const V5A = { x: 900, y: 309, w: 135, h: 44 };       // 上两位五通阀（起动控制阀，接口中心与梭阀出口同为 329.5）
const V5B = { x: 1060, y: 612, w: 135, h: 44 };      // 慢转控制阀（接口中心 y ≈ 632，与 C 出口等高；右移 25）
const CV1 = { x: 1230, y: 260, w: 170, h: 200 };     // 1 号气缸起动阀（再下移 5）
const EV1 = { x: 220, y: 285, w: 210, h: 140 };      // 1 号气缸排气阀（右移 50）
const TG = { x: 790, y: 725, w: 130, h: 60 };        // 盘车机
const CA = { x: 505, y: 780, w: 130, h: 50 };        // 控制空气（40 L 气瓶之后）
const BOT_Y = 840;                                   // 底部总管
const BOT_X2 = V5B.x + V5B.w * 0.75;                 // 底部总管右端＝慢转控制阀引线处（不再外伸）
const BTL = { x: 365, y: 822, w: 140, h: 36 };       // 40 L 气瓶
const RPM = { x: 1265, y: 500, w: 175, h: 75 };      // 主机转速（下移 100）

export class Ac600PneumaticSystem extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.W = W;
        this.H = H;
        this.width = W;
        this.height = H;
        this.type = 'ac600_pneumatic';
        this.cache = 'fixed';

        this.model = ac600Of(sys);

        // 手动截止阀状态（true = 导通，两三角绿色）
        this._valves = { vin: true, vout: true, riser1: true, riser2: true };
        this._mainAirValve = true;                     // 主空气瓶出口截止阀（true=开启）

        this._initGroups();
        this._init();

        this.config = { id: this.id };
    }

    getConfigFields() {
        return [
            { label: '器件名称 (ID)', key: 'id', type: 'text' },
            {
                label: '主空气瓶出口截止阀', key: 'mainAirValve', type: 'select',
                options: [
                    { value: 'on', label: '开启' },
                    { value: 'off', label: '关闭' },
                ],
                get: () => (this._mainAirValve !== false ? 'on' : 'off'),
            },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.id) this.id = cfg.id;
        if (cfg.mainAirValve !== undefined) {
            this._mainAirValve = cfg.mainAirValve !== 'off';
        }
        this.config = { ...this.config, ...cfg };
        this._syncPipes();
        if (this.sys && this.sys.requestRedraw) this.sys.requestRedraw();
    }

    /** 本组件点击不弹浮动提示（反馈只靠阀位切换 / 指示灯 / 数值变化） */
    _tip() { /* 空实现：气动操纵系统图不显示浮动提示 */ }

    _redraw() {
        if (this.sys && this.sys.requestRedraw) this.sys.requestRedraw();
    }

    _init() {
        // 背景（最底）
        this._bgNode = new Konva.Rect({ x: 0, y: 0, width: W, height: H, fill: C_BG, listening: false });
        // 管路层：不缓存，便于按「有气 / 无气」动态改色（位于静态图形之下）
        this._pipeGroup = new Konva.Group({ listening: false });
        this.group.add(this._bgNode);
        this.group.add(this._pipeGroup);
        // 层序：背景 0、管路 1（其余静态 / 动态层自动后移）
        this._bgNode.zIndex(0);
        this._pipeGroup.zIndex(1);

        this._drawStatic();
        this._drawLocalControls(this._staticGroup);
        this._createDynamic();
        this._bindInteraction();
        this._addDragPlate();
    }

    _addDragPlate() {
        const plate = new Konva.Rect({ x: 0, y: 0, width: W, height: H, fill: 'rgba(0,0,0,0.001)', listening: true });
        this._interactGroup.add(plate);
        plate.moveToBottom();
    }

    /**
     * 机旁操纵复刻件：三档起动开关（冲车 / 自动 / 慢转起动）+ 主机机旁调速手柄大表盘。
     * 外观与行为完全照机旁面板（`Ac600LocalPanel`），二者通过模型状态（`startKnob` / `localSpeed`）同步。
     */
    _drawLocalControls(s) {
        const K = LCP_K;
        // ── 三档转换开关（整体缩到 2/3：组内仍按原始尺寸绘制，由组 scale 缩放）──
        const kn = new Konva.Group({ x: LCP.boxX, y: LCP.boxY, scaleX: K, scaleY: K });
        s.add(kn);
        kn.add(_rect({ x: 0, y: 0, width: 176, height: 154, fill: '#cfe3e4', stroke: '#5f7a7c', strokeWidth: 2 }));
        kn.add(_text({ x: 54, y: 7, width: 68, align: 'center', fontSize: 14, fill: '#12324a', text: '自动' }));
        kn.add(_text({ x: 120, y: 16, width: 56, align: 'center', fontSize: 13.5, fill: '#12324a', text: '慢转' }));
        kn.add(_text({ x: 120, y: 32, width: 56, align: 'center', fontSize: 13.5, fill: '#12324a', text: '起动' }));
        kn.add(_text({ x: -4, y: 32, width: 56, align: 'center', fontSize: 14, fill: '#12324a', text: '冲车' }));
        kn.add(_circle({ x: 88, y: 88, radius: 52, fill: '#2a2d30', stroke: '#0f1112', strokeWidth: 2 }));
        kn.add(_circle({ x: 88, y: 88, radius: 22, fill: '#4a4f53', stroke: '#0f1112', strokeWidth: 2 }));
        [-60, 0, 60].forEach((deg) => {
            const a = (deg - 90) * Math.PI / 180;
            kn.add(_line({
                points: [88 + Math.cos(a) * 56, 88 + Math.sin(a) * 56, 88 + Math.cos(a) * 66, 88 + Math.sin(a) * 66],
                stroke: '#12324a', strokeWidth: 2,
            }));
        });
        s.add(_text({
            x: LCP.boxX, y: LCP.boxY + 154 * K + 4, width: 210, fontSize: 11, fill: '#12324a',
            text: '机旁操纵（与机旁面板同步）',
        }));

        // ── 调速手柄大表盘（同样缩到 2/3：STOP 正上 / AHEAD 最右 / ASTERN 最左）──
        const dl = new Konva.Group({ x: LCP.dialX, y: LCP.dialY, scaleX: K, scaleY: K });
        s.add(dl);
        const R = 96;
        dl.add(_circle({ x: 0, y: 0, radius: R + 12, fill: '#f7f7f7', stroke: '#2a2d30', strokeWidth: 4 }));
        dl.add(_circle({ x: 0, y: 0, radius: R, fill: '#ffffff', stroke: '#8d9498', strokeWidth: 1 }));
        dl.add(_text({ x: -40, y: -R - 29, width: 80, align: 'center', fontSize: 13, fontStyle: 'bold', fill: '#c40000', text: 'STOP' }));
        dl.add(_text({ x: 78, y: R - 28, width: 92, align: 'center', fontSize: 12.5, fontStyle: 'bold', fill: '#12324a', text: 'AHEAD' }));
        dl.add(_text({ x: -170, y: R - 28, width: 92, align: 'center', fontSize: 12.5, fontStyle: 'bold', fill: '#12324a', text: 'ASTERN' }));
        for (let i = 0; i <= 10; i++) {
            const deg = (i / 10) * LCP.dialMax;
            [deg, -deg].forEach((dg) => {
                const a = (dg - 90) * Math.PI / 180;
                dl.add(_line({
                    points: [Math.cos(a) * (R - 12), Math.sin(a) * (R - 12), Math.cos(a) * (R - 2), Math.sin(a) * (R - 2)],
                    stroke: '#2a2d30', strokeWidth: i % 5 === 0 ? 2 : 1.2,
                }));
                if (i % 2 === 0) {
                    const rn = R - 24;
                    dl.add(_text({
                        x: Math.cos(a) * rn - 9, y: Math.sin(a) * rn - 9, width: 18, height: 18,
                        align: 'center', verticalAlign: 'middle', fontSize: 13, fill: '#2a2d30', text: String(i),
                    }));
                }
            });
        }
        dl.add(_circle({ x: 0, y: 0, radius: 30, fill: '#141618', stroke: '#000000', strokeWidth: 2 }));
        dl.add(_circle({ x: 0, y: 0, radius: 26, fill: '#2b2f33', stroke: '#7d8488', strokeWidth: 1.5 }));
    }

    // ═══════════════════════════════════════════════════════
    //  图元
    // ═══════════════════════════════════════════════════════

    _pipe(s, pts, w = 6, color = C_PIPE, airKey = null) {
        const node = _line({ points: pts, stroke: color, strokeWidth: w, lineCap: 'round', lineJoin: 'round' });
        s.add(node);
        if (airKey) {
            this._pipes = this._pipes || [];
            this._pipes.push({ node, key: airKey, color });
        }
        return node;
    }

    /** 各管段是否有气（用于「有气＝原色 / 无气＝灰」） */
    _airTest(key) {
        const M = this.model || {};
        const v = this._valves;
        const A = (this._mv3Parts || {}).abc0;
        const B = (this._mv3Parts || {}).abc1;
        const C = (this._mv3Parts || {}).abc2;
        const mech = !this._mechShift;                  // 机械阀阀位（入口条件在 case 'mech' 里加）
        const mainAir = this._mainAirValve !== false;                    // 主空气瓶
        const dryRiser = mainAir && v.vout;                              // 右立管（出口阀左侧出口）
        const dry1 = dryRiser && v.riser1;                               // 上分支（角侧）
        const dry2 = dryRiser && v.riser2;                               // 下分支（角侧）
        switch (key) {
            case 'ctrl': return this._airTest('dryFinal');  // 控制空气总管：气源来自干燥器出口（左干管）
            case 'dryUp': return v.vin;                     // 干燥器上游
            case 'dry1': return dry1;
            case 'dry2': return dry2;
            case 'dryOut': return dryRiser;                  // 右立管（出口手动截止阀左侧出口）
            case 'dryUp': return dry1 || dry2;               // 两分支汇合（→ 入口手动截止阀右入口）
            case 'dryFinal': return (dry1 || dry2) && v.vin; // 入口手动截止阀左侧出口 → 左干管
            case 'airMain': return this._mainAirValve !== false;   // 主空气瓶出口截止阀开启才有气
            case 'airAfter': {                                 // 顶部总管：任一阀活塞在 2/10 即导通
                const Pm = this._svParts && this._svParts.msv;
                const Ps = this._svParts && this._svParts.stv;
                const mOn = Pm ? Pm.pos > 0.98 : !!M.mainStartValveOpen;
                const sOn = Ps ? Ps.pos > 0.98 : false;
                return !this._blocked && (mOn || sOn);
            }
            case 'slowOut': {                                  // 慢转起动阀出口：自身活塞在 2/10
                const P = this._svParts && this._svParts.stv;
                return !this._blocked && !!P && P.pos > 0.98;
            }
            case 'mech': return mech && this._airTest('ctrlB');   // 机械阀出口：阀导通且入口有气
            case 'abA': return mech && !!(A && A.shift);
            case 'abB': return mech && !!(B && B.shift);
            case 'abC': return mech && !!(C && C.shift);
            case 'dryIn1': return v.vin || dry1;              // 止回阀圆侧：上游通 或 角侧有气
            case 'dryIn2': return v.vin || dry2;
            case 'ctrlB':                                     // 控制气源出口：入口有气 + 下位（shift=false）
                return this._airTest('ctrl') && !(this._mv3Parts && this._mv3Parts.b && this._mv3Parts.b.shift);
            case 'exhSrc':                                    // 排气阀气源：下入口有气 + 右位 → 出口有气
                return this._airTest('ctrl') && !(this._mv3Parts && this._mv3Parts.a && this._mv3Parts.a.shift);
            case 'mv2aOut':                                   // 空气分配器：上方入口有气 + 左位 → 下方出口有气
                return this._airTest('airAfter')
                    && !(this._mv2Parts && this._mv2Parts.mv2a && this._mv2Parts.mv2a.shift);
            default: return true;
        }
    }

    /** 刷新所有管路颜色：有气＝原色，无气＝灰 */
    _syncPipes() {
        const GREY = '#c3ccd4';
        (this._pipes || []).forEach((it) => {
            const has = this._airTest(it.key);
            const c = has ? it.color : GREY;
            it.node.stroke(c);
            if (it.alsoFill) it.node.fill(c);
        });
    }

    _cap(s, x, y, w, t, size, color) {
        s.add(_text({ x, y, width: w, align: 'center', fontSize: size || 14, fill: color || '#10222b', text: t }));
    }

    /** 白框 + 蓝色数值条（标签在上，读数动态刷新） */
    _valBox(s, b, label, key) {
        s.add(_rect({ x: b.x, y: b.y, width: b.w, height: b.h, fill: '#dfe1e6', stroke: '#b9bcc6', strokeWidth: 1.6, cornerRadius: 8 }));
        // 标签区高度随框高自适应，避免小尺寸时数值条溢出
        const lh = Math.min(26, Math.max(17, b.h * 0.34));
        s.add(_text({
            x: b.x + 6, y: b.y + (lh - 16) / 2, width: b.w - 12,
            align: 'center', fontSize: 15, fill: '#39404f', text: label,
        }));
        const bh = b.h - lh - 6;
        s.add(_rect({ x: b.x + 8, y: b.y + lh, width: b.w - 16, height: bh, fill: C_VALBAR, stroke: '#2c3c7d', strokeWidth: 1.2, cornerRadius: 5 }));
        const fs = Math.min(18, Math.max(13, bh - 10));
        const t = _text({
            x: b.x + 10, y: b.y + lh + (bh - fs * 1.15) / 2, width: b.w - 20,
            align: 'center', fontSize: fs, fontStyle: 'bold', fill: '#ffffff', text: '—',
        });
        this._dynamicGroup.add(t);
        this._val = this._val || {};
        this._val[key] = t;
    }

    /**
     * 手动截止阀（mimic-valve-symbols 规范）
     *   阀体：两个三角形顶点相交于阀芯中心，沿轴向 angAxis 摆放
     *   阀杆：自中心沿手轮方向 angHandle 伸出 TRI_B + 9
     *   手轮：杆端短棒 ±6，始终垂直于杆
     * @param {number} angAxis   阀体轴向：180=横置、270=竖置
     * @param {number} angHandle 手轮方向：默认 angAxis+90（竖置时朝右、横置时朝上）
     */
    _valveMan(cx, cy, angAxis = 270, angHandle = angAxis + 90, id = null) {
        const d = this._dynamicGroup;               // 变色节点必须在动态层（静态层已烘焙）
        const mk = (ang) => {
            const n = _line({
                points: triPts(cx, cy, ang), closed: true,
                fill: '#ffffff', stroke: C_EDGE, strokeWidth: 1.9, lineJoin: 'round',
            });
            d.add(n);
            return n;
        };
        const a = mk(angAxis);
        const b = mk(angAxis + 180);
        // 阀杆
        const rad = angHandle * Math.PI / 180;
        const ux = Math.cos(rad), uy = Math.sin(rad);
        const ex = cx + ux * (TRI_B + 9), ey = cy + uy * (TRI_B + 9);
        d.add(_line({ points: [cx, cy, ex, ey], stroke: C_EDGE, strokeWidth: 1.9 }));
        // 手轮（垂直短棒）
        const px = -uy, py = ux;
        d.add(_line({
            points: [ex + px * 6, ey + py * 6, ex - px * 6, ey - py * 6],
            stroke: C_EDGE, strokeWidth: 2.4,
        }));
        if (id) { this._vv = this._vv || {}; this._vv[id] = { a, b }; }
    }

    /** 按开/关状态刷新截止阀着色：导通两三角绿，关闭白 */
    _syncValves() {
        Object.keys(this._vv || {}).forEach((id) => {
            const open = this._valves[id] !== false;
            const col = open ? C_OPEN : '#ffffff';
            this._vv[id].a.fill(col);
            this._vv[id].b.fill(col);
        });
    }

    /** 手动切换截止阀（公开方法，工作流可直接调用） */
    toggleValve(id) {
        const NAMES = {
            vin: '干燥器左截止阀', vout: '干燥器出口截止阀',
            riser1: '右立管上截止阀', riser2: '右立管下截止阀',
        };
        if (!this._valves || !(id in this._valves)) return false;
        this._valves[id] = !this._valves[id];
        this._syncValves();
        this._tip(`${NAMES[id] || id}：${this._valves[id] ? '导通' : '关闭'}（点击切换）`);
        this._redraw();
        return this._valves[id];
    }

    /**
     * 手动两位三通阀（照参考图，支持任意朝向）
     *   两格方框（每格宽 W、高 H）+ 手柄；管路对准「当前格 3/4 位置」的上下边缘
     *   · 右格（直通位）：3/4 处竖直箭头，上下顶到边缘
     *   · 左格（卸放位）：斜箭头自「上边 3/4」→「下边 1/4」（箭柄画到尖端）、
     *     3/4 处 T 形阀座连到底边、1/4 处 ▽ 卸放口
     *   · 当前工作位所在格绿色填充
     * @param {number} rot 0＝横置（管路竖直进出）；90＝竖置（管路水平进出，顺时针旋转）
     * @param {string} key 状态键（多只阀各自独立切换）
     */
    _threeWayManual(cx, cy, W = 52, H = 42, rot = 0, key = 'a', opt = {}) {
        const { swap = false, coil = false, spring = false, initShift = false, fillOnLeft = false, flipCS = false, upShift = false } = opt;
        const rad = (rot * Math.PI) / 180;
        const k = (3 * W) / 4;
        const outer = new Konva.Group({
            x: cx - k * Math.cos(rad),
            y: cy - k * Math.sin(rad),
            rotation: rot,
            listening: false,
        });
        this._dynamicGroup.add(outer);
        const g = new Konva.Group();
        outer.add(g);

        this._mv3Parts = this._mv3Parts || {};
        this._mv3Parts[key] = { outer, g, W, H, cx, cy, rot, shift: initShift, fillOnLeft, flipCS, upShift };

        const cellL = _rect({ x: -W, y: -H / 2, width: W, height: H, fill: '#ffffff', stroke: C_EDGE, strokeWidth: 2 });
        const cellR = _rect({ x: 0, y: -H / 2, width: W, height: H, fill: '#ffffff', stroke: C_EDGE, strokeWidth: 2 });
        g.add(cellL); g.add(cellR);
        this._mv3Parts[key].cells = { left: cellL, right: cellR };

        // 两格内容：默认「左＝卸放 / 右＝直通」；swap 时两块图形整体平移 W 互换
        const reliefBase = swap ? 0 : -W;
        const throughBase = swap ? -W : 0;

        // 卸放格：斜箭头（格内上边 3/4 → 下边 1/4）+ T 形阀座（3/4）+ ▽（1/4 下方）
        {
            const L2 = reliefBase + (W * 3) / 4;
            const L1 = reliefBase + W / 4;
            const ax = L2, ay = -H / 2, tx = L1, ty = H / 2;
            const vx = tx - ax, vy = ty - ay;
            const vlen = Math.hypot(vx, vy) || 1;
            const ux = vx / vlen, uy = vy / vlen;
            const head = 11, halfW = 5;
            const hx = tx - ux * head, hy = ty - uy * head;
            const nx = -uy, ny = ux;
            g.add(_line({ points: [ax, ay, tx, ty], stroke: C_EDGE, strokeWidth: 1.8 }));
            g.add(_line({
                points: [hx + nx * halfW, hy + ny * halfW, tx, ty, hx - nx * halfW, hy - ny * halfW],
                stroke: C_EDGE, strokeWidth: 1.8, lineJoin: 'round',
            }));
            const tw = W * 0.11, ty2 = H * 0.04 + 7;
            g.add(_line({ points: [L2, ty2, L2, H / 2], stroke: C_EDGE, strokeWidth: 1.8 }));
            g.add(_line({ points: [L2 - tw, ty2, L2 + tw, ty2], stroke: C_EDGE, strokeWidth: 1.8 }));
            g.add(_line({
                points: [L1 - W * 0.15, H / 2, L1 + W * 0.15, H / 2, L1, H / 2 + 14],
                closed: true, fill: '#ffffff', stroke: C_EDGE, strokeWidth: 1.8,
            }));
        }

        // 直通格：3/4 处竖直箭头，上下顶到边缘
        {
            const R2 = throughBase + (W * 3) / 4;
            g.add(_line({ points: [R2, H / 2, R2, -H / 2], stroke: C_EDGE, strokeWidth: 2 }));
            g.add(_line({
                points: [R2 - W * 0.11, -H / 2 + H * 0.18, R2, -H / 2, R2 + W * 0.11, -H / 2 + H * 0.18],
                stroke: C_EDGE, strokeWidth: 2, lineJoin: 'round',
            }));
        }

        // 左端：线圈（opt.coil）或手柄
        if (coil) {
            // 线圈直接与阀体接触（无短连线）；工作在上位（shift=true）时通电 → 红色填充
            const ox = flipCS ? W : -W - 18;            // flipCS：线圈放到另一端（旋转后在下方）
            const cr = _rect({
                x: ox, y: -9, width: 18, height: 18,
                fill: initShift ? '#e53935' : '#ffffff', stroke: C_EDGE, strokeWidth: 2,
            });
            g.add(cr);
            g.add(_line({ points: [ox, -9, ox + 18, 9], stroke: C_EDGE, strokeWidth: 1.8 }));
            this._mv3Parts[key].coil = cr;
        } else {
            const hg = new Konva.Group({ listening: false });
            g.add(hg);
            this._mv3Parts[key].handle = hg;
            this._paintHandle(key);
        }

        // 右端：弹簧（opt.spring）——切换阀位时压缩
        if (spring) {
            const s0 = flipCS ? -W : W;                 // flipCS：弹簧放到另一端（旋转后在上方）
            const sl = initShift ? 14 : 27;
            const sp = _line({
                points: this._springPts(s0, flipCS ? -sl : sl),
                stroke: C_EDGE, strokeWidth: 1.6, lineJoin: 'round',
            });
            g.add(sp);
            this._mv3Parts[key].spring = sp;
        }

        return outer;
    }

    /**
     * 盘车机联锁的**机械控制二位三通阀**（横置）：
     *   左端弹簧、右端机械控制头；左格＝直通（上→下），右格＝上部堵死 + 下方 ▽ 卸放。
     *   初始工作在**左位**（管路通，弹簧舒展）；盘车机 engaged 后工作在**右位**
     *   （阀体左移一格、弹簧压缩，下方气路堵死，上方气从 ▽ 卸放）。
     */
    _mech3Way() {
        const g = this._mvGroup;
        if (!g) return;
        g.destroyChildren();

        const W = 52, H = 42, cy = 750;              // 与手动两位三通阀同尺寸
        const shifted = !!this._mechShift;
        const bx = shifted ? 589 : 641;
        const L = bx, R = bx + 2 * W, T = cy - H / 2, B = cy + H / 2, mid = bx + W;

        // 阀体：当前工作位所在格绿色填充
        const ON = '#c8e6c9';
        g.add(_rect({ x: L, y: T, width: W, height: H, fill: shifted ? 'rgba(0,0,0,0)' : ON, stroke: C_EDGE, strokeWidth: 2 }));
        g.add(_rect({ x: mid, y: T, width: W, height: H, fill: shifted ? ON : 'rgba(0,0,0,0)', stroke: C_EDGE, strokeWidth: 2 }));

        // 左格：直通竖线 + 向上箭头（参照手动阀的画法）
        const lx = L + (W * 3) / 4;
        g.add(_line({ points: [lx, B, lx, T], stroke: C_EDGE, strokeWidth: 2 }));
        g.add(_line({
            points: [lx - W * 0.11, T + H * 0.18, lx, T, lx + W * 0.11, T + H * 0.18],
            stroke: C_EDGE, strokeWidth: 2, lineJoin: 'round',
        }));

        // 右格：斜箭头（右上 3/4 → 左下 1/4）＋ T 形（横线下移 6px，只向下接）＋ ▽ 卸放
        const rx = mid + (W * 3) / 4;
        const rx2 = mid + W / 4;
        const ty = cy + 9;
        g.add(_line({ points: [rx - 7, ty, rx + 7, ty], stroke: C_EDGE, strokeWidth: 2 }));
        g.add(_line({ points: [rx, ty, rx, B], stroke: C_EDGE, strokeWidth: 2 }));
        {
            const ax = rx, ay = T, tx = rx2, ty2 = B;
            const vx = tx - ax, vy = ty2 - ay;
            const vlen = Math.hypot(vx, vy) || 1;
            const ux = vx / vlen, uy = vy / vlen;
            const head = 11, halfW = 5;
            const hx = tx - ux * head, hy = ty2 - uy * head;
            const nx = -uy, ny = ux;
            g.add(_line({ points: [ax, ay, tx, ty2], stroke: C_EDGE, strokeWidth: 1.8 }));
            g.add(_line({
                points: [hx + nx * halfW, hy + ny * halfW, tx, ty2, hx - nx * halfW, hy - ny * halfW],
                stroke: C_EDGE, strokeWidth: 1.8, lineJoin: 'round',
            }));
        }
        g.add(_line({
            points: [rx2 - 8, B, rx2 + 8, B, rx2, B + 12],
            closed: true, fill: 'rgba(0,0,0,0)', stroke: C_EDGE, strokeWidth: 1.8,
        }));

        // 左端弹簧（8 折，切换后压缩）
        const sl = shifted ? 28 : 48, s0 = L - sl, n = 12;   // 宽度 ×2、12 折，压缩更明显
        const pts = [s0, cy];
        for (let i = 1; i <= n; i++) pts.push(s0 + (sl * i) / n, cy + (i % 2 ? -8 : 8));   // 波高 ×2
        g.add(_line({ points: pts, stroke: C_EDGE, strokeWidth: 1.6, lineJoin: 'round' }));

        // 盘车机侧的蓝色推杆：贴住右侧小圆，切换时向左增长顶动阀芯
        {
            const rodL = R + 25;                 // 与小圆同位置
            g.add(_rect({
                x: rodL, y: cy - 6, width: TG.x - rodL, height: 12,
                fill: '#3fa3e8', stroke: '#2b7fbf', strokeWidth: 1.4,
            }));
        }

        // 右端机械碰触柄：3/8、5/8 两根横线收拢到一个小圆
        const h1 = cy - H / 16, h2 = cy + H / 16, hx = R + 16;   // 两线间距 = 边长的 1/8
        g.add(_line({ points: [R, h1, hx, h1, hx + 5, cy], stroke: C_EDGE, strokeWidth: 1.8, lineJoin: 'round' }));
        g.add(_line({ points: [R, h2, hx, h2, hx + 5, cy], stroke: C_EDGE, strokeWidth: 1.8, lineJoin: 'round' }));
        g.add(_circle({ x: hx + 9, y: cy, radius: 3.6, fill: 'rgba(0,0,0,0)', stroke: C_EDGE, strokeWidth: 1.6 }));
    }

    /**
     * A/B/C 气缸起动阀（竖置）：
     *   上格＝卸放位（斜箭头 + T 形阀座 + ▽），下格＝直通位（默认工作，绿色填充）；
     *   上方为**线圈**（方框 + 左上→右下对角线），下方为**弹簧**（12 折）。
     */
    /** 弹簧折线点（沿 +x 方向伸展） */
    _springPts(s0, sl, n = 8) {
        const pts = [s0, 0];
        const amp = 5.3;                       // 波高 ±8 → ±5.3（2/3）
        for (let i = 1; i <= n; i++) pts.push(s0 + (sl * i) / n, i % 2 ? -amp : amp);
        return pts;
    }

    /** 画手柄：右格工作时第二根横杆在 1/2 处；左格工作时手柄垂直向下、第二根与第一根等长 */
    _paintHandle(key = 'a') {
        const P = (this._mv3Parts || {})[key];
        if (!P || !P.handle) return;
        const h = P.handle;
        h.destroyChildren();
        const { W, H } = P;
        const y1 = -H / 2 + H / 8;
        const y2 = 0;
        const L = (pts, w = 1.8) => h.add(_line({ points: pts, stroke: C_EDGE, strokeWidth: w }));
        const dot = (x, y) => h.add(_circle({ x, y, radius: 3.6, fill: '#ffffff', stroke: C_EDGE, strokeWidth: 1.6 }));

        L([-W, y1, -W - 20, y1]);
        if (!P.shift) {
            L([-W, y2, -W - 23, y2]);
            L([-W - 20, y1, -W - 27, H / 2]);
            dot(-W - 27, H / 2);
        } else {
            L([-W, y2, -W - 20, y2]);
            L([-W - 20, y1, -W - 20, H / 2]);
            dot(-W - 20, H / 2);
        }
    }

    /**
     * **手动两位两通阀**（横置，管路竖直穿过）：左格＝直通（竖箭头）、右格＝切断（上下两个 T）；
     * 右端**手动控制手柄**（斜置），点击后手柄转垂直、阀体平移一格 → 右格对准管路（不通）。
     * @param {number} cx 管路中心 x（**左格中心**，阀体向右半格）
     */
    _twoWayManual(cx, cy, W = 52, H = 42, key = 'mv2') {
        const g = this._dynamicGroup;
        const outer = new Konva.Group({ x: cx, y: cy, listening: false });
        g.add(outer);
        this._mv2Parts = this._mv2Parts || {};
        const P = { outer, W, H, cx, cy, shift: false };
        this._mv2Parts[key] = P;

        // 两格
        P.cellL = _rect({ x: -W, y: -H / 2, width: W, height: H, fill: '#c8e6c9', stroke: C_EDGE, strokeWidth: 2 });
        P.cellR = _rect({ x: 0, y: -H / 2, width: W, height: H, fill: '#ffffff', stroke: C_EDGE, strokeWidth: 2 });
        outer.add(P.cellL); outer.add(P.cellR);

        // 左格：竖直直通箭头（从上边到下边）
        outer.add(_line({ points: [-W / 2, -H / 2, -W / 2, H / 2], stroke: C_EDGE, strokeWidth: 2 }));
        outer.add(_line({ points: [-W / 2 - 6, H / 2 - 9, -W / 2, H / 2, -W / 2 + 6, H / 2 - 9], stroke: C_EDGE, strokeWidth: 2, lineJoin: 'round' }));

        // 右格：上下两个 T（切断）
        outer.add(_line({ points: [W / 2 - 11, -H / 2 + 9, W / 2 + 11, -H / 2 + 9], stroke: C_EDGE, strokeWidth: 2 }));
        outer.add(_line({ points: [W / 2, -H / 2, W / 2, -H / 2 + 9], stroke: C_EDGE, strokeWidth: 2 }));
        outer.add(_line({ points: [W / 2 - 11, H / 2 - 9, W / 2 + 11, H / 2 - 9], stroke: C_EDGE, strokeWidth: 2 }));
        outer.add(_line({ points: [W / 2, H / 2 - 9, W / 2, H / 2], stroke: C_EDGE, strokeWidth: 2 }));

        // 手柄
        P.handle = new Konva.Group({ listening: false });
        outer.add(P.handle);
        this._paintTwoWayHandle(key);
    }

    /** 手柄：与左下角两位三通阀同一套画法（镜像到右端）；未按＝斜置、按下＝垂直向下 */
    _paintTwoWayHandle(key) {
        const P = (this._mv2Parts || {})[key];
        if (!P || !P.handle) return;
        const { W, H } = P;
        const h = P.handle;
        h.destroyChildren();
        const y1 = -H / 2 + H / 8;
        const y2 = 0;
        const L = (pts, w = 1.8) => h.add(_line({ points: pts, stroke: C_EDGE, strokeWidth: w }));
        const dot = (x, y) => h.add(_circle({ x, y, radius: 3.6, fill: '#ffffff', stroke: C_EDGE, strokeWidth: 1.6 }));

        L([W, y1, W + 20, y1]);
        if (!P.shift) {
            L([W, y2, W + 23, y2]);
            L([W + 20, y1, W + 27, H / 2]);
            dot(W + 27, H / 2);
        } else {
            L([W, y2, W + 20, y2]);
            L([W + 20, y1, W + 20, H / 2]);
            dot(W + 20, H / 2);
        }
    }

    /** 切换手动两位两通阀：阀体平移一格 + 手柄转向 + 工作格换色 */
    toggleTwoWay(key = 'mv2') {
        const P = (this._mv2Parts || {})[key];
        if (!P) return false;
        this.setTwoWay(key, !P.shift);
        return P.shift;
    }

    /**
     * 程序化设定手动两位两通阀的工作位（与点击切换同一套画面变化，不弹提示）
     * @param {string} key 'mv2' / 'mv2a'
     * @param {boolean} shift true = 右格（切断）/ false = 左格（直通）
     */
    setTwoWay(key = 'mv2', shift = false) {
        const P = (this._mv2Parts || {})[key];
        if (!P) return false;
        const want = !!shift;
        if (P.shift === want) return false;
        P.shift = want;
        P.outer.x(P.cx - (P.shift ? P.W : 0));
        P.cellL.fill(P.shift ? '#ffffff' : '#c8e6c9');
        P.cellR.fill(P.shift ? '#c8e6c9' : '#ffffff');
        this._paintTwoWayHandle(key);
        this._redraw();
        return true;
    }

    /** 切换任意一只两位三通阀（阀体沿格排列方向平移一格，弹簧压缩） */
    toggleThreeWay(key = 'a') {
        const P = (this._mv3Parts || {})[key];
        if (!P) return false;
        return this.setThreeWay(key, !P.shift, false);
    }

    /**
     * 程序化设定两位三通阀的工作位（不改提示）
     * @param {string} key 'a' / 'b' / 'abc0' / 'abc1' / 'abc2'
     * @param {boolean} shift true = 上位（线圈得电 / 关闭），false = 下位（相通）
     * @param {boolean} silent true = 不弹提示
     */
    setThreeWay(key = 'a', shift = false, silent = true) {
        const P = (this._mv3Parts || {})[key];
        if (!P) return false;
        const want = !!shift;
        if (P.shift === want) return want;
        P.shift = want;
        this._placeThreeWay(key);
        this._syncThreeWay(key);
        if (P.handle) this._paintHandle(key);
        if (P.spring) {
            const s0 = P.flipCS ? -P.W : P.W;
            const sl = P.shift ? 14 : 27;
            P.spring.points(this._springPts(s0, P.flipCS ? -sl : sl));
        }
        if (P.coil) P.coil.fill(P.shift ? '#e53935' : '#ffffff');   // 上位＝通电
        if (!silent) {
            this._tip(P.shift
                ? '两位三通阀：切断（气体从卸放口排出）'
                : '两位三通阀：管路相通');
        }
        this._updateShuttle();                 // A / B 的输出变化 → 梭阀钢球与三角、起动控制阀
        this._redraw();
        return P.shift;
    }

    _syncThreeWay(key = 'a') {
        const P = (this._mv3Parts || {})[key];
        if (!P || !P.cells) return;
        const ON = '#c8e6c9', OFF = '#ffffff';
        // fillOnLeft：该阀的工作位映射到左格（A/B/C 旋转后即“下格”，靠近弹簧）
        const leftOn = P.fillOnLeft ? !P.shift : P.shift;
        P.cells.left.fill(leftOn ? ON : OFF);
        P.cells.right.fill(leftOn ? OFF : ON);
    }

    /** 按当前 shift 重新定位（沿格排列方向平移一格） */
    _placeThreeWay(key = 'a') {
        const P = (this._mv3Parts || {})[key];
        if (!P) return;
        const rad = (P.rot * Math.PI) / 180;
        const k = (3 * P.W) / 4;
        const off = P.shift ? (P.upShift ? -P.W : P.W) : 0;
        P.outer.position({
            x: P.cx - k * Math.cos(rad) + off * Math.cos(rad),
            y: P.cy - k * Math.sin(rad) + off * Math.sin(rad),
        });
    }

    /**
     * 单向止回阀（照参考图）：球（圆）+ 尖朝右的 V 形流向标志
     * 先画 V 形线，再用白色圆形压住中段，形成「球在管内、箭头指出流向」的符号
     */
    _check(s, cx, cy, r, dir = 1) {
        // 两条斜线相交于尖端（与下游管路相连），并在**与球相切的切点处再延伸 10px**
        const tipX = CHK_TIP(cx, r, dir);
        const tanLen = r / Math.tan(CHK_TH);        // 尖端 → 切点
        const ext = 10;                              // 切点处继续延伸
        const cosT = Math.cos(CHK_TH), sinT = Math.sin(CHK_TH);

        // 球先画（斜线的延伸段要压在其上，才能看出「切点再延伸」）
        s.add(_circle({ x: cx, y: cy, radius: r, fill: '#ffffff', stroke: C_EDGE, strokeWidth: 2 }));

        [1, -1].forEach((sy) => {
            s.add(_line({
                points: [
                    tipX, cy,                                                    // 尖端（与管路相接）
                    tipX - dir * cosT * (tanLen + ext), cy - sy * sinT * (tanLen + ext),
                ],
                stroke: C_EDGE, strokeWidth: 2, lineCap: 'round',
            }));
        });
        return tipX;
    }

    /**
     * 减压阀（弹簧式，照参考图）：
     *   矩形阀体 + 阀座竖线 + 水平流道（带流向箭头）+ 阀杆
     *   上方：调节弹簧；下方：虚线取压反馈接回上游管路
     * 位置在滤器（菱形）左侧，干燥后的高压空气经此减压后送控制空气系统
     */
    _reduceValve(s, cx, cy, w = 42, h = 42, dir = 1, fb = 67) {
        const L = cx - w / 2, T = cy - h / 2, R = cx + w / 2, B = cy + h / 2;
        // 阀体（方框）
        s.add(_rect({ x: L, y: T, width: w, height: h, fill: '#ffffff', stroke: C_EDGE, strokeWidth: 2 }));

        // 阀座竖线 + 主流箭头（dir>0 朝右，dir<0 朝左）
        const sx = dir > 0 ? cx - 9 : cx + 9;
        const tipX = dir > 0 ? R : L;
        const tailX = tipX - dir * 6;
        s.add(_line({ points: [sx, cy - 8, sx, cy + 8], stroke: C_EDGE, strokeWidth: 1.8 }));
        s.add(_line({ points: [sx, cy, tipX, cy], stroke: C_EDGE, strokeWidth: 1.8 }));
        s.add(_line({
            points: [tailX, cy - 4, tipX, cy, tailX, cy + 4],
            closed: true, fill: C_EDGE, stroke: C_EDGE, strokeWidth: 0.8,
        }));
        s.add(_line({
            points: [sx + dir * 6, cy - 4, sx, cy, sx + dir * 6, cy + 4],
            closed: true, fill: C_EDGE, stroke: C_EDGE, strokeWidth: 0.8,
        }));

        // 出口侧上角的先导口小三角（尖朝出口方向）
        if (dir > 0) {
            s.add(_line({ points: [R, T + 3, R + 9, T + 9, R, T + 15], closed: true, fill: '#ffffff', stroke: C_EDGE, strokeWidth: 1.6 }));
            s.add(_line({ points: [R + 22, cy - 4.5, R + 15, cy, R + 22, cy + 4.5], closed: true, fill: C_EDGE, stroke: C_EDGE, strokeWidth: 0.8 }));
        } else {
            s.add(_line({ points: [L, T + 3, L - 9, T + 9, L, T + 15], closed: true, fill: '#ffffff', stroke: C_EDGE, strokeWidth: 1.6 }));
        }

        // 阀杆 + 斜置调节弹簧
        s.add(_line({ points: [cx, T, cx, T - 4], stroke: C_EDGE, strokeWidth: 1.8 }));
        this._coilSpring(s, cx, T - 4, 21);

        // 下方虚线取压反馈
        s.add(_line({
            points: [cx, B, cx, B + 14, cx - dir * fb, B + 14, cx - dir * fb, cy],
            stroke: C_EDGE, strokeWidth: 1.5, dash: [4, 4],
        }));
    }

    /** 竖直调节弹簧 + 一条自右下向左上穿过弹簧的调节箭头 */
    _coilSpring(s, x, y, hgt = 16) {
        // 竖直锯齿：左右交替，整体不偏
        const pts = [x, y];
        const n = 6;
        for (let i = 1; i <= n; i++) pts.push(x + (i % 2 ? 6 : -6), y - (hgt / n) * i);
        pts.push(x, y - hgt);
        s.add(_line({ points: pts, stroke: C_EDGE, strokeWidth: 1.6, lineJoin: 'round' }));

        // 调节箭头：自右下穿到左上，整体逆时针偏转 15°；箭头头为实心三角
        const c0x = x, c0y = y - hgt / 2 - 2;
        const th = 25 * Math.PI / 180;
        const bx0 = -0.647, by0 = -0.765;               // 基准方向（指向左上）
        const ux = bx0 * Math.cos(th) + by0 * Math.sin(th);
        const uy = -bx0 * Math.sin(th) + by0 * Math.cos(th);
        const L = 29, k = 7, w = 4.2;
        const sx = c0x - ux * L / 2, sy = c0y - uy * L / 2;
        const ex = c0x + ux * L / 2, ey = c0y + uy * L / 2;
        // 箭杆（止于三角底边）
        const tx = ex - ux * k, ty = ey - uy * k;
        s.add(_line({ points: [sx, sy, tx, ty], stroke: C_EDGE, strokeWidth: 1.7 }));
        // 实心三角箭头头
        const px = -uy, py = ux;
        s.add(_line({
            points: [ex, ey, tx + px * w, ty + py * w, tx - px * w, ty - py * w],
            closed: true, fill: C_EDGE, stroke: C_EDGE, strokeWidth: 0.8, lineJoin: 'round',
        }));
    }

    /** 滤器（菱形，上下顶点之间画虚线表示过滤网） */
    _dryerSym(s, cx, cy, r = 14.5) {
        s.add(_line({
            points: [cx, cy - r, cx + r, cy, cx, cy + r, cx - r, cy],
            closed: true, fill: '#ffffff', stroke: C_EDGE, strokeWidth: 2,
        }));
        // 过滤网：上顶点 → 下顶点 的虚线
        s.add(_line({
            points: [cx, cy - r, cx, cy + r],
            stroke: C_EDGE, strokeWidth: 1.4, dash: [3.5, 3],
        }));
    }

    /** 弹簧锯齿（横向） */
    _spring(s, cx, cy, len) {
        s.add(_line({
            points: [
                cx - len / 2, cy + 6, cx - len / 4, cy, cx, cy + 6,
                cx + len / 4, cy, cx + len / 2, cy + 6,
            ],
            stroke: C_EDGE, strokeWidth: 1.6, lineJoin: 'round',
        }));
    }

    /** 竖直两位阀（A / B / C），下方带弹簧 */
    _twoWayV(s, x, y, w, h) {
        s.add(_rect({ x, y, width: w, height: h, fill: '#ffffff', stroke: C_EDGE, strokeWidth: 2 }));
        const my = y + h / 2;
        s.add(_line({ points: [x, my, x + w, my], stroke: C_EDGE, strokeWidth: 1.2, dash: [4, 3] }));
        // 上工位：↘
        s.add(_line({ points: [x + w * 0.22, y + h * 0.18, x + w * 0.78, y + h * 0.18], stroke: C_EDGE, strokeWidth: 1.8 }));
        s.add(_line({ points: [x + w * 0.62, y + h * 0.1, x + w * 0.78, y + h * 0.18], stroke: C_EDGE, strokeWidth: 1.8 }));
        // 下工位：↗
        s.add(_line({ points: [x + w * 0.22, y + h * 0.82, x + w * 0.78, y + h * 0.82], stroke: C_EDGE, strokeWidth: 1.8 }));
        s.add(_line({ points: [x + w * 0.38, y + h * 0.74, x + w * 0.22, y + h * 0.82], stroke: C_EDGE, strokeWidth: 1.8 }));
        // 弹簧（下方）
        s.add(_line({
            points: [x + w * 0.5, y + h, x + w * 0.5 - 8, y + h + 7, x + w * 0.5 + 8, y + h + 13, x + w * 0.5 - 8, y + h + 19, x + w * 0.5, y + h + 25],
            stroke: C_EDGE, strokeWidth: 1.6, lineJoin: 'round',
        }));
    }

    /**
     * 气动控制的**横向两位五通换向阀**（照结构图重绘）
     *   · 左端：**气动先导控制接口**（矩形 + 框内右向空心三角，三角左边缘与矩形左边缘重合）
     *   · 阀体：矩形，中间**竖直实线（3 px）**把阀体分成左右两格
     *   · **左格**：T 形在**下边缘 1/4**；箭头「下边缘 1/2 → 上边缘 1/4」；箭头「上边缘 3/4 → 下边缘 3/4」
     *   · **右格（镜像）**：T 形在**下边缘 3/4**；箭头「下边缘 1/2 → 上边缘 3/4」；箭头「上边缘 1/4 → 下边缘 1/4」
     *   · **管路接口（世界坐标固定，不随阀体平移）**：
     *       入口在**右边矩形下边缘的 1/2**（`0.75w`）；出口在**右边矩形上边缘的 1/4、3/4**（`0.625w` / `0.875w`）
     *   · 右端复位弹簧：与两位三通阀同画法（8 折、波高 ±5.3，27 ⇄ 14）
     *   · **切换阀位时整个阀体（两格 + 符号 + 控制接口 + 弹簧）向右平移一格（`w/2`）**，
     *     管路保持原位 → 接口自动对应到另一工位的相同位置
     *
     * @param {Konva.Group} g 绘制容器（交互阀必须画在动态层）
     * @param {object} b 位置尺寸
     * @param {string|null} label 顶部标注
     * @param {string|undefined} key 状态键（'V5A' / 'V5B' 可点击切换；省略则纯静态）
     */
    _fiveTwo(g, b, label, key) {
        const { x, y, w, h } = b;
        const X = (r) => x + w * r;
        const Y = (r) => y + h * r;
        const iy = 1.5;                                  // 箭头终点与上下边框的留白
        const on = key ? !!(this._v5State && this._v5State[key]) : false;

        // ⓐ 阀体组（可整体平移）
        const inner = new Konva.Group({ listening: false, x: on ? w / 2 : 0 });
        g.add(inner);

        // ① 阀体（白底 + 描边）
        inner.add(_rect({ x, y, width: w, height: h, fill: '#ffffff', stroke: C_EDGE, strokeWidth: 2.2 }));

        // ② 两个工位的底色（工作位绿色）
        const cellL = _rect({ x: x + 1.1, y: y + 1.1, width: w / 2 - 1.6, height: h - 2.2, fill: on ? '#c8e6c9' : '#ffffff' });
        const cellR = _rect({ x: X(0.5) + 0.5, y: y + 1.1, width: w / 2 - 1.6, height: h - 2.2, fill: on ? '#ffffff' : '#c8e6c9' });
        inner.add(cellL); inner.add(cellR);

        // ③ 工位分界：居中竖直实线（3 px，贯通阀体高度）
        inner.add(_line({ points: [X(0.5), Y(0), X(0.5), Y(1)], stroke: C_EDGE, strokeWidth: 3 }));

        // 带箭头的直线（对称双翼，指向终点）
        const arrow = (px0, py0, px1, py1) => {
            inner.add(_line({ points: [px0, py0, px1, py1], stroke: C_EDGE, strokeWidth: 1.8, lineCap: 'round' }));
            const ang = Math.atan2(py1 - py0, px1 - px0);
            const hl = 8, hw2 = 3.8;
            const bx = px1 - hl * Math.cos(ang), by = py1 - hl * Math.sin(ang);
            const nx = -Math.sin(ang), ny = Math.cos(ang);
            inner.add(_line({
                points: [bx + nx * hw2, by + ny * hw2, px1, py1, bx - nx * hw2, by - ny * hw2],
                stroke: C_EDGE, strokeWidth: 1.8, lineJoin: 'round', lineCap: 'round',
            }));
        };

        // T 形封闭符号：竖杆自底边向上 + 顶部横线
        const tee = (xc, half) => {
            const ty = y + h * 0.76;
            inner.add(_line({ points: [xc - half, ty, xc + half, ty], stroke: C_EDGE, strokeWidth: 1.8 }));
            inner.add(_line({ points: [xc, ty, xc, y + h], stroke: C_EDGE, strokeWidth: 1.8 }));
        };

        // ④ 左格 / ⑤ 右格（镜像）
        tee(X(0.125), w * 0.055);
        arrow(X(0.250), Y(1) - iy, X(0.125), Y(0) + iy);
        arrow(X(0.375), Y(0) + iy, X(0.375), Y(1) - iy);
        tee(X(0.875), w * 0.055);
        arrow(X(0.750), Y(1) - iy, X(0.875), Y(0) + iy);
        arrow(X(0.625), Y(0) + iy, X(0.625), Y(1) - iy);

        // ⑥ 左端气动先导控制接口：矩形（18×20）+ 三角（左边缘贴矩形左边缘）
        const cw = w * 0.111 + 3, ch = h * 0.34 + 5, cy0 = y + h * 0.465;
        const airOn = on ? C_AIR_ON : '#ffffff';
        const coil = _rect({
            x: x - cw, y: cy0 - ch / 2, width: cw, height: ch,
            fill: airOn, stroke: C_EDGE, strokeWidth: 2,
        });
        inner.add(coil);
        const th = (h * 0.34) * 0.56 + 5;                // 三角高
        const tw2 = (w * 0.111) * 0.52 + 2;              // 三角宽
        const tx0 = x - cw;                              // 三角左边缘 = 矩形左边缘
        const coilTri = _line({
            points: [tx0, cy0 - th / 2, tx0, cy0 + th / 2, tx0 + tw2, cy0],
            closed: true, fill: airOn, stroke: C_EDGE, strokeWidth: 1.6, lineJoin: 'round',
        });
        inner.add(coilTri);

        // ⑦ 右端复位弹簧（8 折、波高 ±5.3；左位工作时压缩 27 → 14）
        const sl = on ? 14 : 27;
        const sp = this._springPts(w, sl);
        const pts = [];
        for (let i = 0; i < sp.length; i += 2) pts.push(x + sp[i], y + h / 2 + sp[i + 1]);
        const spring = _line({ points: pts, stroke: C_EDGE, strokeWidth: 1.6, lineJoin: 'round', lineCap: 'round' });
        inner.add(spring);

        if (key) {
            this._v5Parts = this._v5Parts || {};
            this._v5Parts[key] = { W: w, x, y, h, inner, cellL, cellR, coil, coilTri, spring };
        }
        if (label) this._cap(inner, x, y - 20, w, label, 12, '#3a4756');
    }

    /** 按给定状态设置两位五通阀（左位 on=true / 右位 on=false） */
    _applyFiveWay(key, on) {
        const P = (this._v5Parts || {})[key];
        if (!P) return;
        this._v5State = this._v5State || {};
        this._v5State[key] = !!on;
        // 阀位：整体向右平移一格
        P.inner.x(on ? P.W / 2 : 0);
        // 慢转控制阀：左侧来气管随气动接口一起移动
        if (key === 'V5B' && this._cPipe) {
            this._cPipe.points([769, CYL_YS[2], V5B.x - 18 + P.inner.x(), CYL_YS[2]]);
        }
        // 起动控制阀：梭阀来气管随气动接口一起移动
        if (key === 'V5A' && this._aPipe) {
            this._aPipe.points([SV.x + SV.w, SV.y + SV.h / 2,
                V5A.x - 18 + P.inner.x(), V5A.y + V5A.h * 0.465]);
        }
        // 工作格
        P.cellL.fill(on ? '#c8e6c9' : '#ffffff');
        P.cellR.fill(on ? '#ffffff' : '#c8e6c9');
        // 弹簧：左位＝压缩到 14
        const sp = this._springPts(P.W, on ? 14 : 27);
        const pts = [];
        for (let i = 0; i < sp.length; i += 2) pts.push(P.x + sp[i], P.y + P.h / 2 + sp[i + 1]);
        P.spring.points(pts);
        // 控制接口：左位＝有先导气体 → 蓝色填充
        const c = on ? C_AIR_ON : '#ffffff';
        P.coil.fill(c);
        P.coilTri.fill(c);
    }

    /**
     * 「工作 / 阻塞」工况切换：
     *   · 默认**工作**（工作键绿、阻塞键暗）；
     *   · 按**阻塞** → 工作键还原、阻塞键**红**，主起动阀**固定在断开状态**（无法转动开启）；
     *   · 再按**工作** → 回到工作状态；
     *   · ⚠ **主起动阀开启（`mainStartValveOpen`）时按阻塞无效**。
     */
    setBlock(on) {
        const M = this.model || {};
        if (on) {
            if (M.mainStartValveOpen) return false;      // 已开启：阻塞无效
            this._blocked = true;
        } else {
            this._blocked = false;
        }
        this._syncStartBlock();
        return true;
    }

    /**
     * 统一的「起动阻塞」联动画：**主起动阀阻塞** 与 **空气分配器右位（不导通）** 产生同样的故障——
     * `startBlocked = true`、`engineReady = false`、报警栏 `START FAIL/BLOCK, ACTIVE`；
     * 解除后 `engineReady` 恢复、报警转 `NORMAL`（未应答）或直接清除（已应答）。
     */
    _syncStartBlock() {
        const M = this.model || {};
        const mv2Off = !!(this._mv2Parts && this._mv2Parts.mv2a && this._mv2Parts.mv2a.shift);
        const ctrlAirOff = !!(this._mv3Parts && this._mv3Parts.b && this._mv3Parts.b.shift);
        const gearIn = !M.turningGearOut;              // 盘车机合上
        M.airDistributorOk = !mv2Off;                  // 空气分配器右位 → 不在工作位
        M.controlAirVented = ctrlAirOff;               // 控制气源被切断
        const blk = !!this._blocked || mv2Off || ctrlAirOff || gearIn;

        // 只有「主起动阀阻塞」按钮本身才把主起动阀锁死在断开/非工作位；
        // 盘车机、空气分配器、控制气源等其它原因不改主起动阀状态（Engine State 灯要区分）
        if (this._blocked) { M.mainStartValveOpen = false; M.mainStartValveOk = false; }
        else M.mainStartValveOk = true;

        M.startBlocked = blk || !!(M.shutDown && !M.cancelSHD) || !!M.emStopped || !!M.overspeedTripped;
        M.engineReady = blk ? false
            : (!!M.turningGearOut && !!M.airDistributorOk && !M.startFail && !M.shutDown && !M.emStopped);

        // ⚠ **主机运行中阻塞不产生报警**（只显示 Engine State 指示 + Eng. Not Ready）
        const running = !!M.running || !!M.starting;
        const wantAlarm = blk && !running;
        if (wantAlarm !== this._blkAlarm) {
            const rest = (M.messages || []).filter((t) => !String(t).startsWith('START FAIL/BLOCK'));
            if (wantAlarm) {
                M.acked = false;                       // 新故障：未确认（红）
                M.messages = ['START FAIL/BLOCK, ACTIVE', ...rest];
                M.alarm = true;
            } else {
                if (!M.acked) M.messages = ['START FAIL/BLOCK, NORMAL', ...rest];   // 未应答：红色记忆
                else M.messages = rest;                                              // 已应答：直接清除
                if (!(M.messages || []).length) M.alarm = false;
            }
            this._blkAlarm = wantAlarm;
        }

        if (this._workLamp) this._workLamp.fill(this._blocked ? '#c9ccce' : '#16c60c');
        if (this._blockLamp) this._blockLamp.fill(this._blocked ? '#e53935' : '#d8dcdd');
        this._redraw();
    }

    /** 点击两位五通阀：右位（默认）⇄ 左位（阀体向右平移一格） */
    toggleFiveWay(key) {
        if (!(this._v5State || {})[key] && !this._v5Parts[key]) return false;
        const on = !this._v5State[key];
        this._applyFiveWay(key, on);
        this._redraw();
        return on;
    }

    /**
     * **起动阀**（阀芯通道 + 齿轮齿条 + 执行气缸，照参考图）
     *   · **圆（阀体）** + 圆内**粗黑竖条**＝起动空气通道（初始**竖直**，左右进出口不通）；
     *   · 圆下方**齿条**（三角齿朝上）→ 横杆 → 右侧**执行气缸**（矩形）；
     *   · 气缸内**活塞**默认在 **2/10** 处（最左）；
     *     左进气 → 活塞右移到 **8/10**，齿条带动阀芯**逆时针转 90°**，通道变**水平** → 进出口接通；
     *     两入口都没气 或 右进气 → 活塞回最左，通道竖直；
     *   · 气缸下边缘 **1/10** / **9/10** 两个入口 → 接所控两位五通阀顶部两个出口。
     */
    _startValve(g, cx, cy, r, v5, key) {
        const CE = '#1b2430';

        // ① 阀体圆
        g.add(_circle({ x: cx, y: cy, radius: r, fill: '#ffffff', stroke: CE, strokeWidth: 2.4 }));

        // ② 起动空气通道（粗黑条，初始竖直）
        const chan = new Konva.Group({ x: cx, y: cy, rotation: 0, listening: false });
        chan.add(_rect({
            x: -r * 0.15, y: -r * 0.96, width: r * 0.30, height: r * 1.92,
            fill: CE, cornerRadius: 2,
        }));
        g.add(chan);

        // ③ 齿条高度（先定，用于把气缸对中到活塞中央）
        const rackY = cy + r * 1.26;

        // ③ 执行气缸：下移，使其**活塞中央**正好在齿条高度上
        const cylH = r * 1.13;
        const cylX = cx + r * 2.03 - 10, cylY = rackY - cylH / 2, cylW = r * 2.56 - 10;
        g.add(_rect({ x: cylX, y: cylY, width: cylW, height: cylH, fill: '#ffffff', stroke: CE, strokeWidth: 2 }));

        // ③b 气缸左右两半的进气着色（哪边入口有气，哪半边蓝）
        const p0 = cylX + cylW * 0.2;                       // 初始活塞位置（2/10）
        const fillL = _rect({
            x: cylX + 2, y: cylY + 2, width: Math.max(0, p0 - (cylX + 2)), height: cylH - 4,
            fill: C_AIR_ON, listening: false, visible: false,
        });
        const fillR = _rect({
            x: p0, y: cylY + 2, width: Math.max(0, (cylX + cylW - 2) - p0), height: cylH - 4,
            fill: C_AIR_ON, listening: false, visible: false,
        });
        g.add(fillL); g.add(fillR);

        // ④ 齿条 + 横杆 + 活塞（整体随活塞平移）
        const rackG = new Konva.Group({ listening: false });
        const rackX0 = cx - r * 1.4, rackX1 = cx + r * 1.72 - 20;
        const pistonX = cylX + cylW * 0.2;
        rackG.add(_line({ points: [rackX1, rackY, pistonX, rackY], stroke: CE, strokeWidth: 2 }));   // 横杆
        rackG.add(_line({ points: [rackX0, rackY, rackX1, rackY], stroke: CE, strokeWidth: 2 }));   // 齿条底线
        const nTeeth = 11;
        for (let i = 0; i < nTeeth; i++) {
            const tx = rackX0 + ((rackX1 - rackX0) * (i + 0.5)) / nTeeth;
            rackG.add(_line({
                points: [tx - r * 0.10, rackY, tx, rackY - r * 0.20, tx + r * 0.10, rackY],
                closed: true, fill: '#ffffff', stroke: CE, strokeWidth: 1.4, lineJoin: 'round',
            }));
        }
        rackG.add(_line({ points: [pistonX, cylY + 2, pistonX, cylY + cylH - 2], stroke: CE, strokeWidth: 4 }));
        rackG.x(0);                    // 默认活塞在 2/10（左，右入口进气），通道竖直＝不导通
        g.add(rackG);

        // ⑤ 气缸下边缘 1/10、9/10 两根入口 → 五通阀顶部两个出口
        const bot = cylY + cylH;
        const mkPipe = (sx, tx) => {
            const pts = Math.abs(sx - tx) < 0.6
                ? [sx, bot, sx, v5.y]
                : [sx, bot, sx, bot + 14, tx, bot + 14, tx, v5.y];
            const ln = _line({ points: pts, stroke: C_PIPE_LP, strokeWidth: 3.5, lineJoin: 'round', lineCap: 'round' });
            g.add(ln);
            return ln;
        };
        const pipeL = mkPipe(cylX + cylW * 0.1, v5.x + v5.w * 0.625);   // 左入口 ← 五通阀左出口
        const pipeR = mkPipe(cylX + cylW * 0.9, v5.x + v5.w * 0.875);   // 右入口 ← 五通阀右出口

        this._svParts = this._svParts || {};
        this._svParts[key] = {
            chan, rackG, travel: cylW * 0.6, pos: 0, target: null, pipeL, pipeR, fillL, fillR,
            cylX, cylW, pistonX,   // 用于按活塞位置动态裁剪填充
        };
    }

    /**
     * 设定起动阀目标位（气路状态立即生效），活塞位置由 `_stepStartValve()` 在 **3 s** 内渐变
     * @param {boolean} open true = 气缸**左**入口有气（五通阀左位）→ 活塞移向右、通道转水平
     */
    _syncStartValve(key, open) {
        const P = (this._svParts || {})[key];
        const inAir = this._airTest('ctrlB');         // 入口（40 L 之后的控制空气总管）是否有气
        if (!P || (P.target === open && P.inAir === inAir)) return;
        P.target = open;
        P.inAir = inAir;
        // 五通阀工作位决定哪一侧出口与入口相通：
        //   左位（气动接口有气）→ 左出口通入口、右出口通大气；
        //   右位（气动接口无气）→ 右出口通入口、左出口通大气。
        // ⚠ 入口没气时两侧出口都无气。
        const lAir = open && inAir;                   // 左出口有气
        const rAir = !open && inAir;                  // 右出口有气
        if (P.fillL) P.fillL.visible(lAir);           // 左入口进气 → 气缸左半蓝
        if (P.fillR) P.fillR.visible(rAir);           // 右入口进气 → 气缸右半蓝
        if (P.pipeL) P.pipeL.stroke(lAir ? C_PIPE_LP : '#c3ccd4');
        if (P.pipeR) P.pipeR.stroke(rAir ? C_PIPE_LP : '#c3ccd4');
    }

    /** 活塞 2/10 ⇄ 8/10 全程 **3 s** 匀速移动，同步带动阀芯旋转 */
    _stepStartValve(key, dt) {
        const P = (this._svParts || {})[key];
        if (!P) return;
        const tgt = P.target ? 1 : 0;
        if (Math.abs(P.pos - tgt) < 1e-4) return;
        const step = (dt || 0.05) / START_VALVE_TRAVEL_S;
        P.pos += Math.sign(tgt - P.pos) * step;
        P.pos = Math.max(0, Math.min(1, P.pos));
        P.rackG.x(P.travel * P.pos);           // pos=0 → 活塞在 2/10（左）；pos=1 → 右移到 8/10（导通）
        P.chan.rotation(-90 * P.pos);          // 逆时针 90°：竖直 → 水平
        // 填充始终贴到活塞边缘
        if (P.fillL && P.fillR) {
            const px = P.pistonX + P.rackG.x();
            const leftEdge = P.cylX + 2;
            const rightEdge = P.cylX + P.cylW - 2;
            P.fillL.width(Math.max(0, px - leftEdge));
            P.fillR.x(px).width(Math.max(0, rightEdge - px));
        }
    }

    /**
     * **双座止回阀（梭阀）**：竖置矩形 + 上下两个人字形阀座 + 中间球，
     * 顶部入口（来自起动电磁阀A）、底部入口（来自起动电磁阀B）、右侧出口（去起动控制阀气动接口）。
     */
    _shuttle(g, b) {
        const { x, y, w, h } = b;
        const cx = x + w / 2;
        g.add(_rect({ x, y, width: w, height: h, fill: '#ffffff', stroke: C_EDGE, strokeWidth: 2.2 }));

        // 上阀座 ∧：顶点直接落在**顶边**。填充层闭合但**不描边**（底边无线），斜边单独描黑
        const triTop = _line({
            points: [cx, y, x + w * 0.06, y + h * 0.28, x + w * 0.94, y + h * 0.28],
            closed: true, fill: '#ffffff', strokeEnabled: false,
        });
        g.add(triTop);
        g.add(_line({ points: [cx, y, x + w * 0.06, y + h * 0.28], stroke: C_EDGE, strokeWidth: 2, lineCap: 'round' }));
        g.add(_line({ points: [cx, y, x + w * 0.94, y + h * 0.28], stroke: C_EDGE, strokeWidth: 2, lineCap: 'round' }));

        // 下阀座 ∨：顶点直接落在**底边**（同上：填充不描边，只描两条斜边）
        const triBot = _line({
            points: [cx, y + h, x + w * 0.06, y + h * 0.72, x + w * 0.94, y + h * 0.72],
            closed: true, fill: '#ffffff', strokeEnabled: false,
        });
        g.add(triBot);
        g.add(_line({ points: [cx, y + h, x + w * 0.06, y + h * 0.72], stroke: C_EDGE, strokeWidth: 2, lineCap: 'round' }));
        g.add(_line({ points: [cx, y + h, x + w * 0.94, y + h * 0.72], stroke: C_EDGE, strokeWidth: 2, lineCap: 'round' }));

        // 中间球（随哪一路有气而上下移动）
        const ball = _circle({ x: cx, y: y + h / 2, radius: w * 0.30, fill: '#ffffff', stroke: C_EDGE, strokeWidth: 2 });
        g.add(ball);

        this._svBall = ball;
        this._svTriTop = triTop;
        this._svTriBot = triBot;
    }

    /**
     * 双座止回阀（梭阀）动态特性：
     *   · 上下同时有气 / 都没气 → 球停在中间（同时有气时两三角绿色）
     *   · 只有上边有气 → 球被推到**下方与下三角两边相切**，上三角绿
     *   · 只有下边有气 → 球被推到**上方与上三角两边相切**，下三角绿
     *   · 任一路有气 → 输出有气 → 起动控制阀工作在**左位**（接口蓝色）
     */
    _updateShuttle() {
        if (!this._svBall) return;
        const A = (this._mv3Parts || {}).abc0;
        const B = (this._mv3Parts || {}).abc1;
        const C = (this._mv3Parts || {}).abc2;
        // 两位三通阀逻辑：下位＝出口卸放（无气）；上位且入口有气 → 出口有气
        // 入口的气来自盘车机左侧的机械两位三通阀（左位导通＝有气）
        const supply = this._airTest('mech');
        const topOn = supply && !!(A && A.shift);   // 起动电磁阀 A 有输出
        const botOn = supply && !!(B && B.shift);   // 起动电磁阀 B 有输出

        const r = SV.w * 0.30;
        const halfW = SV.w * 0.44, rise = SV.h * 0.28;
        const d = r / Math.sin(Math.atan2(halfW, rise));   // 球心到阀座顶点的距离（相切）
        const midX = SV.x + SV.w / 2;

        let cy;
        if (topOn && botOn) cy = SV.y + SV.h / 2;          // 平衡：居中
        else if (topOn) cy = SV.y + SV.h - d;              // 上进气 → 球压向下三角
        else if (botOn) cy = SV.y + d;                     // 下进气 → 球顶向上三角
        else cy = SV.y + SV.h / 2;                         // 无气：居中

        this._svBall.position({ x: midX, y: cy });
        this._svTriTop.fill(topOn ? '#2ecc40' : '#ffffff');
        this._svTriBot.fill(botOn ? '#2ecc40' : '#ffffff');

        const out = topOn || botOn;
        if (this._v5State && this._v5State.V5A !== out) this._applyFiveWay('V5A', out);
        if (this._aPipe) this._aPipe.stroke(out ? C_PIPE_LP : '#c3ccd4');   // 梭阀出口 → 起动控制阀
        // 慢转电磁阀 C：线圈得电（手动切到上位）且左侧入口有气 → 出口才有气
        const cOn = supply && !!(C && C.shift);
        if (this._cPipe) this._cPipe.stroke(cOn ? C_PIPE_LP : '#c3ccd4');   // C → 慢转控制阀
        if (this._v5State && this._v5State.V5B !== cOn) this._applyFiveWay('V5B', cOn);
        this._redraw();
    }

    /** 1 号气缸起动阀：先导两位阀 + 气缸执行器 */
    /**
     * **1 号气缸起动阀**（照参考图重绘）：虚线框内 = 带弹簧的先导两位三通阀 + 右侧执行器
     *   （T 形柱塞 + 半圆膜片）；框外上方另有一只带**手动柄**的两位三通阀与顶部总管上的球阀。
     */
    /**
     * **1 号气缸起动阀**（照参考图重绘）：虚线框内只有一只**单作用气缸执行器**——
     * 顶部矩形（下缘一条粗横条＝活塞）+ 中部粗竖线（活塞杆）+ 下部**拱形缸体**（两侧竖边 + 底部粗横条）。
     * 左上接口接**1 号起动电磁阀的出口**；右下接口接**上方下来的粗管路**。
     */
    /**
     * **1 号气缸起动阀**（照参考图）：虚线框内一只**单作用气缸执行器**——
     * 顶部矩形（下缘粗横条＝活塞）+ 中部粗竖线（活塞杆）+ 下部**拱形缸体**（两侧竖边 + 底部粗横条）。
     * 宽度取原尺寸的 **2/3**。左上接口接**1 号起动电磁阀出口**；右下接口接**上方下来的粗管路**。
     */
    _cylStartValve(g, b) {
        const { x, y, w, h } = b;
        const CE = '#5b6b7c';
        const DARK = '#1b2430';
        const cx = x + 118;
        const BW = (76 * 2) / 3 - 6;        // 顶部矩形宽
        const HW = BW / 2;
        const AR = (44 * 2) / 3;            // 拱形半径
        const topY = y + 70;
        const ACY = y + 138;

        // ① 虚线框
        g.add(_rect({ x, y, width: w, height: h, fill: 'rgba(0,0,0,0)', stroke: CE, strokeWidth: 1.8, dash: [7, 5] }));

        // ② 左上接口（电磁阀出口 → 缸盖），有气时变蓝
        this._cv1Inlet = _line({ points: [x + 67, y + 84, cx - HW, y + 84], stroke: '#c3ccd4', strokeWidth: 2 });
        g.add(this._cv1Inlet);

        // ③ 缸体（拱形，固定）：半圆 + 两侧竖边 + 底部粗横条
        const arc = [];
        for (let i = 0; i <= 24; i++) {
            const a = Math.PI * (i / 24);
            arc.push(cx - AR * Math.cos(a), ACY - AR * Math.sin(a));
        }
        g.add(_line({ points: arc, stroke: CE, strokeWidth: 2 }));
        // 两侧竖边延长到工字下横线两端（初始 pist.y = 5，故到 y+169）
        g.add(_line({ points: [cx - AR, ACY, cx - AR, y + 169], stroke: CE, strokeWidth: 2 }));
        g.add(_line({ points: [cx + AR, ACY, cx + AR, y + 169], stroke: CE, strokeWidth: 2 }));

        // ④ 顶部矩形轮廓（**固定**）：三条边，左右边延长止于拱弧
        const yJoin = ACY - Math.sqrt(Math.max(0, AR * AR - HW * HW));
        g.add(_line({ points: [cx - HW, topY, cx + HW, topY], stroke: CE, strokeWidth: 2 }));
        g.add(_line({ points: [cx - HW, topY, cx - HW, yJoin], stroke: CE, strokeWidth: 2 }));
        g.add(_line({ points: [cx + HW, topY, cx + HW, yJoin], stroke: CE, strokeWidth: 2 }));

        // ④b 有气时：工字上横**上方**的矩形内区域绿色填充（表示上方受压）
        this._cv1Charge = _rect({
            x: cx - HW + 2, y: topY + 2, width: BW - 4, height: 19,
            fill: '#c8e6c9', listening: false, visible: false,
        });
        g.add(this._cv1Charge);
        this._cv1ChargeTop = topY + 2;        // 填充顶端（固定）
        this._cv1PistTop = y + 86;            // 活塞上横基准 y（不含 pist.y 偏移）

        // ⑤ **黑色工字结构**（活塞粗条 + 活塞杆）—— 动作时只有它下移，其余不动
        const pist = new Konva.Group({ listening: false, y: 5 });     // 初始再下移 5
        pist.add(_rect({ x: cx - HW, y: y + 86, width: BW, height: 7, fill: DARK }));   // 上横（活塞）
        pist.add(_line({ points: [cx, y + 93, cx, y + 164], stroke: DARK, strokeWidth: 5 }));  // 竖杆
        pist.add(_rect({ x: cx - AR, y: y + 164, width: AR * 2, height: 6, fill: DARK }));     // 下横（底条）
        g.add(pist);
        this._cv1Piston = pist;
        this._cv1Stroke = Math.max(2, (ACY - AR) - (y + 93) - 5);      // 活塞粗条下缘 → 拱弧上端（已扣初始 5）

        // ⑥ 工字下移后，缸体左右两侧开口处的进气流动效果（默认隐藏）
        // 开口 = 拱形两侧竖边下端（y+169）与下移后的工字下横之间的缝隙，气流由此斜向外下流出
        this._cv1Flows = [
            _line({
                points: [cx - AR + 2, y + 172, cx - AR - 22, y + 192],
                stroke: C_PIPE_LP, strokeWidth: 6, dash: [10, 8], lineCap: 'round', visible: false,
            }),
            _line({
                points: [cx + AR - 2, y + 172, cx + AR + 22, y + 192],
                stroke: C_PIPE_LP, strokeWidth: 6, dash: [10, 8], lineCap: 'round', visible: false,
            }),
        ];
        this._cv1Flows.forEach((f) => g.add(f));
        this._cv1FlowPhase = 0;

        this._cap(g, x, y + h + 6, w, '1号气缸起动阀', 13.5, '#10222b');
    }

    /** 缸头起动阀：入口有气 → 工字结构下移到顶住拱弧；无气 → 复位 */
    _syncCylPiston(hasAir) {
        if (this._cv1Piston) this._cv1Piston.y(hasAir ? 5 + this._cv1Stroke : 5);
        if (this._cv1Inlet) this._cv1Inlet.stroke(hasAir ? C_PIPE_LP : '#c3ccd4');
        if (this._cv1Charge && this._cv1Piston) {
            const h = (this._cv1PistTop + this._cv1Piston.y()) - this._cv1ChargeTop;
            this._cv1Charge.height(Math.max(4, h));   // 填充始终贴到活塞上横的上缘
            this._cv1Charge.visible(!!hasAir);
        }
        (this._cv1Flows || []).forEach((f) => f.visible(!!hasAir));
    }

    /**
     * 1 号气缸排气阀（照参考图）
     *   入口：**单向止回阀**（球 + 尖朝右 V，同减压阀后面那只）→ 波纹软管 → 气动执行器
     *        （上小杆头 + 中杆 + 下大腔体）→ 右侧两位阀（方框内 ↙↘）→ 虚线框 + 弹簧
     */
    _cylExhValve(s, b) {
        const { x, y, w, h } = b;
        // 框内需透出供气管路，故不填充
        s.add(_rect({ x, y, width: w, height: h, fill: 'rgba(0,0,0,0)', stroke: '#5b6b7c', strokeWidth: 2 }));

        const cy = y + h * 0.42;                       // 主气路高度

        // ① 入口单向止回阀（方向反向：尖朝左）
        this._check(s, x + w * 0.15, cy, 7, -1);

        // ② 止回阀右端 → 气缸左侧（细管）
        const checkR = x + w * 0.15 + 8;              // 止回阀球右缘
        const axC = x + w * 0.45;                      // 气缸中心

        // ③ 气动执行器（整体下移 10px）：上杆头 + 中环 + 中杆 + 下大腔
        {
            const ax = x + w * 0.45, dy = 10;
            s.add(_rect({ x: ax - 9, y: cy - 44 + dy, width: 18, height: 13, fill: '#ffffff', stroke: C_EDGE, strokeWidth: 1.8 }));
            s.add(_rect({ x: ax - 7, y: cy - 31 + dy, width: 14, height: 9, fill: '#ffffff', stroke: C_EDGE, strokeWidth: 1.8 }));
            s.add(_rect({ x: ax - 6, y: cy - 22 + dy, width: 12, height: 24, fill: '#ffffff', stroke: C_EDGE, strokeWidth: 1.8 }));
            s.add(_rect({
                x: ax - 19, y: cy + 2 + dy, width: 38, height: 50,
                fill: '#ffffff', stroke: C_EDGE, strokeWidth: 1.8, cornerRadius: 4,
            }));
        }

        // ④ 气缸右侧 → 减压阀入口（细管）
        {
            const rvCx = x + w * 0.76;
            s.add(_line({ points: [checkR, cy, axC - 6, cy], stroke: C_PIPE_LP, strokeWidth: 3.5 }));
            s.add(_line({ points: [axC + 6, cy, rvCx - 23, cy], stroke: C_PIPE_LP, strokeWidth: 3.5 }));
        }
        // ⑤ 出口侧：减压阀（镜像，左进右出）
        this._reduceValve(s, x + w * 0.76, cy, 46, 42, -1, 40);

        // ⑥ 标注移到部件框下方
        this._cap(s, x, y + h + 6, w, '1号气缸排气阀', 13.5, '#10222b');
    }

    // ═══════════════════════════════════════════════════════
    //  管路（先画，设备压其上）
    // ═══════════════════════════════════════════════════════

    _drawPipes(s) {
        const dryOut = VAL_OUT.x - VAL_OUT.r;   // 459
        const airIn = AIR.x;                    // 640
        const airOut = AIR.x + AIR.w;           // 830
        const msvL = MSV.x - MSV.r, msvR = MSV.x + MSV.r;
        const stvL = STV.x - STV.r, stvR = STV.x + STV.r;

        // ① 左干管（通底部）—— 自截止阀起向左、向下均为细管路
        this._pipe(s, [10, DRY_MID, 10, BOT_Y], 3.5, C_PIPE_LP, 'dryFinal');
        // ② 左干管 → 左截止阀
        this._pipe(s, [10, DRY_MID, VAL_IN.x - VAL_IN.r, DRY_MID], 3.5, C_PIPE_LP, 'dryFinal');
        // ③ 左截止阀 → 两条并联支路
        this._pipe(s, [VAL_IN.x + VAL_IN.r, DRY_MID, 150, DRY_MID], 3.5, C_PIPE_LP, 'dryUp');
        this._pipe(s, [150, DRY_MID, 150, DRY_Y1], 3.5, C_PIPE_LP, 'dryUp');
        this._pipe(s, [150, DRY_MID, 150, DRY_Y2], 3.5, C_PIPE_LP, 'dryUp');
        [DRY_Y1, DRY_Y2].forEach((cy) => {
            this._pipe(s, [150, cy, 185 - 8, cy], 3.5, C_PIPE_LP, cy === DRY_Y1 ? 'dryIn1' : 'dryIn2');   // → 止回阀球左缘（圆侧）
            this._pipe(s, [CHK_TIP(185, 8), cy, DRY_RISER, cy], 3.5, C_PIPE_LP, cy === DRY_Y1 ? 'dry1' : 'dry2'); // 尖端 → 下游
        });
        // ⑤ 右立管：两条支路经两只截止阀后汇合，再经出口截止阀送出
        //    自出口截止阀起（向左、向上向下）一律细管路，与起动空气框出口的细管一致
        this._pipe(s, [DRY_RISER, DRY_Y1, DRY_RISER, 72 - TRI_A], 3.5, C_PIPE_LP, 'dry1');
        this._pipe(s, [DRY_RISER, 72 + TRI_A, DRY_RISER, 154 - TRI_A], 3.5, C_PIPE_LP, 'dryOut');
        this._pipe(s, [DRY_RISER, 154 + TRI_A, DRY_RISER, DRY_Y2], 3.5, C_PIPE_LP, 'dry2');
        // ⑥ 出口 → 出口截止阀（阀后直接接细管）
        this._pipe(s, [DRY_RISER, DRY_MID, dryOut, DRY_MID], 3.5, C_PIPE_LP, 'dryOut');
        // ⑦ 数值框 → 主起动阀（起动空气总管）
        this._pipe(s, [airOut, TOP_Y, msvL, TOP_Y], 7, C_PIPE, 'airMain');
        // ⑦b 控制空气细管：自起动空气主管走 25px → 向下 → 向左 → 引入出口截止阀右端
        this._pipe(s, [
            airOut + 25, TOP_Y, airOut + 25, DRY_MID, VAL_OUT.x + TRI_A, DRY_MID,
        ], 3.5, C_PIPE_LP, 'airMain');
        // ⑧ 主起动阀 → 顶部总管
        this._pipe(s, [msvR, TOP_Y, TOP_X2, TOP_Y], 7, C_PIPE, 'airAfter');
        // ⑨ 慢转起动阀：与主起动阀**并联**（左端接主起动阀上游，右端接其下游总管）
        this._pipe(s, [890, TOP_Y, 890, STV.y, stvL, STV.y], 6, C_PIPE, 'airMain');
        this._pipe(s, [stvR, STV.y, stvR + 40, STV.y, stvR + 40, TOP_Y], 6, C_PIPE, 'slowOut');
        // ⑪ A/B/C 三只阀的出入口管路全部删除（母线 / 短接 / 接五通阀的连线均不画）
        // ⑯ 上五通阀（底边引出）→ 下引至底部总管（控制空气，细管）
        this._pipe(s, [V5A.x + V5A.w * 0.75, V5A.y + V5A.h, V5A.x + V5A.w * 0.75, BOT_Y], 3.5, C_PIPE_LP, 'ctrlB');
        // ⑰ 下五通阀（底边引出）→ 下引至底部总管（控制空气，细管）
        this._pipe(s, [V5B.x + V5B.w * 0.75, V5B.y + V5B.h, V5B.x + V5B.w * 0.75, BOT_Y], 3.5, C_PIPE_LP, 'ctrlB');
        // ⑱ 1 号气缸起动阀 / …2 自顶部总管取气
        this._pipe(s, [1386, TOP_Y, 1386, CV1.y + 152, CV1.x + 118 + (44 * 2 / 3), CV1.y + 152], 6, C_PIPE, 'airAfter');
        // 手动两位两通阀：入口（顶部总管）→ 阀顶；阀底 → 1 号框上边缘 1/10 入口（细管）
        this._pipe(s, [CV1.x + CV1.w * 0.1, TOP_Y, CV1.x + CV1.w * 0.1, 98], 3.5, C_PIPE_LP, 'airAfter');
        this._pipe(s, [CV1.x + CV1.w * 0.1, 132, CV1.x + CV1.w * 0.1, CV1.y + 84, CV1.x + 33, CV1.y + 84], 3.5, C_PIPE_LP, 'mv2aOut');
        // 出口管中途分支 → 向右 → 向下 → 2 号上边缘（1/3 处）
        this._pipe(s, [CV1.x + CV1.w * 0.1, 190, 1428 + 48 / 3, 190, 1428 + 48 / 3, 250], 3.5, C_PIPE_LP, 'mv2aOut');
        this._pipe(s, [1428 + 48 * (2 / 3), TOP_Y, 1428 + 48 * (2 / 3), 250], 6, C_PIPE, 'airAfter');   // 2 号：上边缘 2/3
        // ⑲ PS 压力开关管路已删除
        // ⑳ 排气阀供气：自左下手动阀**上端**引出 → 上 → 右行 → 从顶部进入 1 号排气阀 / …2（细管）
        this._pipe(s, [140, 760 - 21, 140, 265, 512, 265], 3.5, C_PIPE_LP, 'exhSrc');
        this._pipe(s, [230, 265, 230, 344, CHK_TIP(251.5, 7, -1), 344], 3.5, C_PIPE_LP, 'exhSrc');   // → 下引接止回阀 V 尖（不穿过角）
        this._pipe(s, [512, 265, 512, 275], 3.5, C_PIPE_LP, 'exhSrc');     // → …2 顶部入口
        // ㉑b 机械两位三通阀出口 → 竖直上行；在每只阀「上格 3/4」处右转并接到阀口
        this._pipe(s, [680, 729, 680, CYL_YS[0]], 3.5, C_PIPE_LP, 'mech');
        CYL_YS.forEach((cy) => {
            this._pipe(s, [680, cy, 727, cy], 3.5, C_PIPE_LP, 'mech');
        });

        // ㉑c 起动电磁阀 A / B 的输出管 → 双座止回阀的上 / 下入口
        this._pipe(s, [769, CYL_YS[0], SV.x + SV.w / 2, CYL_YS[0], SV.x + SV.w / 2, SV.y], 3.5, C_PIPE_LP, 'abA');
        this._pipe(s, [769, CYL_YS[1], SV.x + SV.w / 2, CYL_YS[1], SV.x + SV.w / 2, SV.y + SV.h], 3.5, C_PIPE_LP, 'abB');

        // ㉑a 慢转电磁阀（C）→ 慢转控制阀气动接口的**水平管**改在 _createDynamic() 中绘制
        //     （需随慢转控制阀换位伸缩，静态层已烘焙不能改）

        // ㉑ 盘车机联锁机械二位三通阀：下口接底部总管，上口绕到盘车机顶部
        this._pipe(s, [680, 771, 680, BOT_Y], 3.5, C_PIPE_LP, 'ctrlB');
        // ㉒ 底部控制空气总管（细管）
        this._pipe(s, [10, BOT_Y, 305, BOT_Y], 4.5, C_PIPE_LP, 'ctrl');        // 阀 b 左侧（常通）
        this._pipe(s, [305, BOT_Y, BOT_X2, BOT_Y], 4.5, C_PIPE_LP, 'ctrlB');   // 阀 b 右侧（受控制气源控制）
        // ㉓ 控制空气框下端中心 → 底部总管（框底已不贴总线，需一段短管）
        this._pipe(s, [CA.x + CA.w / 2, CA.y + CA.h, CA.x + CA.w / 2, BOT_Y], 3.5, C_PIPE_LP, 'ctrlB');
        // ㉔ 左下手动两位三通阀：下口接底部总管、上口接排气阀（竖直穿过阀体）
        this._pipe(s, [140, BOT_Y, 140, 760 + 21], 3.5, C_PIPE_LP, 'ctrl');
    }

    // ═══════════════════════════════════════════════════════
    //  静态图
    // ═══════════════════════════════════════════════════════

    _drawStatic() {
        const s = this._staticGroup;
        this._drawPipes(this._pipeGroup);

        // ── ① 空气干燥器 / 滤器组 ──
        s.add(_rect({
            x: DRY.x, y: DRY.y, width: DRY.w, height: DRY.h,
            fill: 'rgba(0,0,0,0)', stroke: '#5a6675', strokeWidth: 1.8, dash: [9, 6], cornerRadius: 5,
        }));
        [DRY_Y1, DRY_Y2].forEach((cy) => {
            this._check(s, 185, cy, 8);
            this._reduceValve(s, 285, cy);
            this._dryerSym(s, 365, cy, 14.5);
        });
        // 四只手动截止阀改在 _createDynamic() 中绘制（需随开/关变色）

        // ── ② 起动空气数值框（左侧：气源说明 + 短箭头）──
        this._valBox(s, AIR, '起动空气', 'startAir');
        // 气源说明（原「83」号牌已取消）
        s.add(_text({
            x: 512, y: TOP_Y - 24, width: 104, align: 'right',
            fontSize: 12.5, fill: '#3a4756', text: '来自主空气瓶',
        }));
        // 短箭头（气源流入）：主空气瓶出口截止阀关闭时一并变灰
        {
            const ar1 = _line({ points: [610, TOP_Y, 622, TOP_Y], stroke: C_PIPE, strokeWidth: 8, lineCap: 'round' });
            const ar2 = _line({ points: [618, TOP_Y - 11, 638, TOP_Y, 618, TOP_Y + 11], closed: true, fill: C_PIPE, stroke: C_PIPE, strokeWidth: 1 });
            this._pipeGroup.add(ar1); this._pipeGroup.add(ar2);   // 不缓存的层，才能动态改色
            this._pipes = this._pipes || [];
            this._pipes.push({ node: ar1, key: 'airMain', color: C_PIPE });
            this._pipes.push({ node: ar2, key: 'airMain', color: C_PIPE, alsoFill: true });
        }

        // ── ③ 主起动阀 + 工作 / 阻塞 指示灯 ──
        // 主起动阀改在 _createDynamic() 中绘制（阀芯可转、活塞可动）
        this._cap(s, MSV.x - 70, 10, 140, '主起动阀', 14.5);
        this._cap(s, 1026, 2, 46, '工作', 13);
        this._cap(s, 1090, 2, 46, '阻塞', 13);
        s.add(_rect({ x: 1032, y: 22, width: 30, height: 18, fill: '#d8dcdd', stroke: '#8b939a', strokeWidth: 1.2 }));
        s.add(_rect({ x: 1096, y: 22, width: 30, height: 18, fill: '#d8dcdd', stroke: '#8b939a', strokeWidth: 1.2 }));

        // ── ④ 慢转起动阀 ──
        // 慢转起动阀同上，改在 _createDynamic() 中绘制
        this._cap(s, 1032, 202, 130, '慢转起动阀', 14);

        // ── ⑤ PS 压力开关及其附带小阀已按要求删除 ──
        // 1 号起动电磁阀：名称标注在右上角
        this._cap(s, 1286, 278, 100, '1号起动电磁阀', 12.5, '#10222b');
        // 手动两位两通阀（1 号气缸起动阀上游）的名称标注：右上角
        this._cap(s, 1282, 79, 88, '空气分配器', 13, '#10222b');

        // ── ⑥ 气缸起动阀组 A / B / C（名称标注：A 在左边、B 在右下角、C 在右边）──
        this._cap(s, 575, CYL_YS[0] - 9, 100, '起动电磁阀A', 13.5, '#10222b');
        this._cap(s, 775, CYL_YS[1] + 14, 100, '起动电磁阀B', 13.5, '#10222b');
        this._cap(s, 775, CYL_YS[2] + 14, 100, '慢转电磁阀', 13.5, '#10222b');
        // 阀体在 _createDynamic() 中绘制（可点击线圈切换阀位）

        // ── ⑦ 两只两位五通换向阀 ──
        // 两只交互五通阀在 _createDynamic() 中绘制（需随点击切换工作位、弹簧与先导气指示）
        // 梭阀改在 _createDynamic() 中绘制（球要随气源移动、三角要变色）
        this._cap(s, V5A.x - 8, V5A.y + V5A.h + 8, 84, '起动控制阀', 13.5, '#10222b');
        this._cap(s, V5B.x - 8, V5B.y + V5B.h + 8, 84, '慢转控制阀', 13.5, '#10222b');   // 标注移到左下角（与起动控制阀同版式）

        // ── ⑧ 1 号气缸起动阀 / …2 ──
        // 1 号气缸起动阀（框内工字活塞需随气路移动）改在 _createDynamic() 中绘制
        s.add(_rect({ x: 1428, y: 250, width: 48, height: 200, fill: '#dfe3e8', stroke: '#5b6b7c', strokeWidth: 1.8 }));
        this._cap(s, 1428, 458, 48, '2号', 12);

        // ── ⑨ 1 号气缸排气阀 / …2 ──
        this._cylExhValve(s, EV1);
        s.add(_rect({ x: 488, y: 275, width: 48, height: 150, fill: '#dfe3e8', stroke: '#5b6b7c', strokeWidth: 1.8 }));
        this._cap(s, 488, 432, 48, '2号', 12);

        // ── ⑨b 两只手动两位三通阀的名称标注 ──
        this._cap(s, 19, 715, 92, '排气阀气源', 13, '#10222b');      // 左下阀：左上方
        this._cap(s, 334, 760, 82, '控制气源', 13, '#10222b');      // 40 L 前阀：右边

        // ── ⑩ 盘车机 ──
        s.add(_rect({ x: TG.x, y: TG.y, width: TG.w, height: TG.h, fill: '#ffffff', stroke: '#6f7c8a', strokeWidth: 1.8, cornerRadius: 6 }));
        this._cap(s, TG.x, TG.y + 6, TG.w, '盘车机', 14.5);
        s.add(_rect({ x: TG.x + 10, y: TG.y + 28, width: TG.w - 20, height: 26, fill: C_BOX, stroke: '#08307c', strokeWidth: 1.2, cornerRadius: 4 }));
        // 盘车机联锁的机械二位三通阀改在 _createDynamic() 中绘制（随盘车机状态切换）

        // ── ⑪ 控制空气 ──
        this._valBox(s, CA, '控制空气', 'ctrlAir');

        // ── ⑫ 40 L 气瓶 ──
        s.add(_rect({ x: BTL.x, y: BTL.y, width: BTL.w, height: BTL.h, fill: '#eef1f4', stroke: '#5b6b7c', strokeWidth: 1.8, cornerRadius: BTL.h / 2 }));
        this._cap(s, BTL.x, BTL.y + 10, BTL.w, '40 L', 16);

        // ── ⑬ 左下两只手动操纵阀 ──
        // 左下手动两位三通阀在 _createDynamic() 中绘制（阀芯随切换平移）

        // ── ⑭ 主机转速 ──
        this._valBox(s, RPM, '主机转速', 'rpm');
    }

    // ═══════════════════════════════════════════════════════
    //  动态
    // ═══════════════════════════════════════════════════════

    _createDynamic() {
        const d = this._dynamicGroup;

        // ── 四只手动截止阀（横管：轴向 180、杆朝上；竖管：轴向 270、杆朝右）──
        this._valveMan(VAL_IN.x, VAL_IN.y, 180, 270, 'vin');
        this._valveMan(VAL_OUT.x, VAL_OUT.y, 180, 270, 'vout');
        this._valveMan(DRY_RISER, 72, 270, 0, 'riser1');
        this._valveMan(DRY_RISER, 154, 270, 0, 'riser2');

        // ── 左下手动两位三通阀（横置，管路竖直进出）──
        this._threeWayManual(140, 760, 52, 42, 0, 'a');
        this._syncThreeWay('a');
        // ── A / B / C 三只气缸起动阀：竖置，上格卸放 / 下格直通，上方线圈、下方弹簧 ──
        CYL_YS.forEach((cy, i) => {
            const k = 'abc' + i;
            this._threeWayManual(GRP.x + GRP.w / 2 - 75, cy, 47, 42, 90, k, {
                swap: true, coil: true, spring: true, initShift: false, fillOnLeft: false,
            });
            this._placeThreeWay(k);
            this._syncThreeWay(k);
        });

        // ── 两只气动控制的两位五通换向阀（可点击：右位 ⇄ 左位）──
        this._v5Group = new Konva.Group({ listening: false });
        this._dynamicGroup.add(this._v5Group);
        this._v5State = { V5A: false, V5B: false };     // false = 右位（弹簧侧，默认）
        this._v5Parts = {};
        this._fiveTwo(this._v5Group, V5A, null, 'V5A');
        this._fiveTwo(this._v5Group, V5B, null, 'V5B');
        this._shuttle(this._v5Group, SV);

        // 1 号气缸起动阀（虚线框 + 缸体 + 可动工字活塞）
        this._cv1Group = new Konva.Group({ listening: false });
        this._dynamicGroup.add(this._cv1Group);
        this._cylStartValve(this._cv1Group, CV1);

        // 1 号气缸起动阀的先导两位三通阀（电磁控制：上弹簧、下线圈，默认工作在上位）
        this._threeWayManual(CV1.x + 50, CV1.y + 124, 40, 34, 90, 'cv1-pilot', {
            swap: false, coil: true, spring: true,
            initShift: false, fillOnLeft: true, flipCS: true, upShift: true,
        });
        this._placeThreeWay('cv1-pilot');
        this._syncThreeWay('cv1-pilot');

        // 1 号气缸起动阀上游的手动两位两通阀（默认左位＝通）
        this._twoWayManual(CV1.x + CV1.w * 0.1 + 22, 115, 44, 34, 'mv2a');
        this.setTwoWay('mv2a', true);                 // 空气分配器默认锁闭（右位＝切断，不在工作位）

        // 主起动阀 / 慢转起动阀（阀芯通道 + 齿条 + 执行气缸）
        this._svGroup = new Konva.Group({ listening: false });
        this._dynamicGroup.add(this._svGroup);
        this._svParts = {};
        this._startValve(this._svGroup, MSV.x, MSV.y, MSV.r, V5A, 'msv');
        this._startValve(this._svGroup, STV.x, STV.y, STV.r, V5B, 'stv');

        // 慢转电磁阀 C（下格右缘 3/4）→ 慢转控制阀气动接口的水平管：换位时随接口伸缩
        this._cPipe = _line({
            points: [769, CYL_YS[2], V5B.x - 18, CYL_YS[2]],
            stroke: C_PIPE_LP, strokeWidth: 3.5, lineCap: 'round',
        });
        this._dynamicGroup.add(this._cPipe);

        // 双座止回阀右出口 → 起动控制阀气动接口：换位时随接口伸缩
        this._aPipe = _line({
            points: [SV.x + SV.w, SV.y + SV.h / 2, V5A.x - 18, V5A.y + V5A.h * 0.465],
            stroke: C_PIPE_LP, strokeWidth: 3.5, lineCap: 'round',
        });
        this._dynamicGroup.add(this._aPipe);

        this._updateShuttle();                 // 管路就绪后初始化：梭阀、控制阀、两根来气管颜色

        // ── 盘车机联锁的机械二位三通阀（初始左位＝通）──
        this._mechShift = false;
        this._mvGroup = new Konva.Group({ listening: false });
        this._dynamicGroup.add(this._mvGroup);
        this._mech3Way();

        // ── 40 L 气瓶前的手动两位三通阀（竖置：顺时针旋转 90°，管路水平进出）──
        //    默认工作在**上位（卸放）**：控制气源被切断 → 控制空气不导通（0.0 Bar）
        this._threeWayManual(305, BOT_Y, 52, 42, 90, 'b', { initShift: true });
        this._placeThreeWay('b');
        this._syncThreeWay('b');
        this._syncValves();

        // 主起动阀「工作」灯（绿）/「阻塞」灯（红）—— 默认**阻塞**（冷态未备车）
        this._blocked = true;                           // true = 阻塞位（默认）；false = 工作位
        this._blkAlarm = true;                          // 初值即"已处理"：冷态起动阻塞不弹报警栏（只显示状态灯）
        this._workLamp = _rect({ x: 1032, y: 22, width: 30, height: 18, fill: '#c9ccce', stroke: '#8b939a', strokeWidth: 1.2 });
        d.add(this._workLamp);

        // 主起动阀「阻塞」灯（灰）
        this._blockLamp = _rect({ x: 1096, y: 22, width: 30, height: 18, fill: '#e53935', stroke: '#8b939a', strokeWidth: 1.2 });
        d.add(this._blockLamp);

        // 盘车机状态文字
        this._tgTxt = _text({
            x: TG.x + 10, y: TG.y + 32, width: TG.w - 20,
            align: 'center', fontSize: 15, fontStyle: 'bold', fill: '#ffffff', text: 'Disengaged',
        });
        d.add(this._tgTxt);

        // 机旁操纵复刻件：三档开关手柄（左 −60 = 冲车 / 0 = 自动 / 右 +60 = 慢转起动）
        this._lcpKnob = new Konva.Group({
            x: LCP.knobX, y: LCP.knobY, scaleX: LCP_K, scaleY: LCP_K, listening: false,
        });
        this._lcpKnob.add(new Konva.Rect({
            x: -7, y: -42, width: 14, height: 84, cornerRadius: 7,
            fill: 'rgba(0,0,0,0)', stroke: '#f2f2f2', strokeWidth: 2.5, listening: false,
        }));
        this._lcpKnob.add(new Konva.Rect({ x: -4, y: -40, width: 8, height: 16, fill: '#f2f2f2', listening: false }));
        d.add(this._lcpKnob);

        // 调速手柄指针（0° = 正上 STOP，端点半径 59 不遮刻度数字）
        this._lcpNeedle = new Konva.Group({
            x: LCP.dialX, y: LCP.dialY, rotation: 0, scaleX: LCP_K, scaleY: LCP_K, listening: false,
        });
        this._lcpNeedle.add(new Konva.Line({ points: [0, -14, 0, -52], stroke: '#20242a', strokeWidth: 9, lineCap: 'round', listening: false }));
        this._lcpNeedle.add(new Konva.Line({ points: [0, -14, 0, -52], stroke: '#f2c14e', strokeWidth: 5, lineCap: 'round', listening: false }));
        this._lcpNeedle.add(new Konva.Circle({ x: 0, y: -52, radius: 7, fill: '#f2c14e', stroke: '#20242a', strokeWidth: 2, listening: false }));
        d.add(this._lcpNeedle);

        // 起动时顶部总管加压色带
        this._busGlow = _line({
            points: [MSV.x + MSV.r, TOP_Y, TOP_X2, TOP_Y],
            stroke: '#3fbf4a', strokeWidth: 7, lineCap: 'round', opacity: 0,
        });
        d.add(this._busGlow);
    }

    // ═══════════════════════════════════════════════════════
    //  交互
    // ═══════════════════════════════════════════════════════

    _bindInteraction() {
        const M = this.model;
        const mk = (id, x, y, w, h, onClick) => {
            const hit = this.addClickablePart(id, x, y, w, h);
            if (onClick) hit.on('click tap', (e) => { e.cancelBubble = true; onClick(); this._redraw(); });
            return hit;
        };

        // ⚠ 干燥器组的大热区必须先注册：后注册的热区在上层，否则会吞掉组内阀门的点击
        mk('dryer', DRY.x, DRY.y, DRY.w, DRY.h,
            () => this._tip('空气干燥器 / 滤器组：两路并联除水除尘，止回阀防止倒流'));
        mk('valve-vin', VAL_IN.x - 18, VAL_IN.y - 28, 36, 44, () => this.toggleValve('vin'));
        mk('valve-vout', VAL_OUT.x - 18, VAL_OUT.y - 28, 36, 44, () => this.toggleValve('vout'));
        mk('valve-riser1', DRY_RISER - 16, 72 - 18, 44, 36, () => this.toggleValve('riser1'));
        mk('valve-riser2', DRY_RISER - 16, 154 - 18, 44, 36, () => this.toggleValve('riser2'));
        CYL_YS.forEach((cy, i) => {
            // 整只阀（阀体 + 线圈）都可点击切换
            mk(`abc-valve-${i}`, GRP.x + GRP.w / 2 - 75 - 26, cy - 72, 52, 122, () => this.toggleThreeWay('abc' + i));
        });
        mk('valve-mv3', 20, 716, 190, 90, () => this.toggleThreeWay('a'));
        mk('valve-mv3b', 260, 728, 96, 178, () => this.toggleThreeWay('b'));

        mk('bottle', AIR.x, AIR.y, AIR.w, AIR.h,
            () => this._tip(`起动空气：${(Number(M.startAir) || 0).toFixed(1)} Bar`));

        // 「工作 / 阻塞」两个按键
        // ── 机旁操纵复刻件 ──
        // 三档起动开关：与机旁面板 start-knob 同一套逻辑（只有控制权在机旁才生效）
        mk('start-knob', LCP.knobX - 65 * LCP_K, LCP.knobY - 65 * LCP_K, 130 * LCP_K, 130 * LCP_K, () => {
            const stage = this.sys && this.sys.stage;
            const ptr = stage && stage.getPointerPosition ? stage.getPointerPosition() : null;
            let dir = 1;
            if (ptr) {
                const lo = this.group.getAbsoluteTransform().copy().invert().point(ptr);
                dir = lo.x >= LCP.knobX ? 1 : -1;
            }
            const order = ['BLOW', 'AUTO', 'SLOW'];
            const i = order.indexOf(String(M.startKnob || 'AUTO'));
            const n = Math.max(0, Math.min(order.length - 1, i + (dir > 0 ? 1 : -1)));
            if (n === i) return;
            const sel = order[n];
            M.setStartKnob(sel, 'LOCAL');
            const off = (M.controlPos !== 'LOCAL') ? '（控制权不在机旁，不输出）' : '';
            if (sel === 'BLOW') this._tip(`冲车：起动电磁阀A得电，主机加速到 20 rpm 并保持${off}`);
            else if (sel === 'SLOW') this._tip(`慢转：慢转电磁阀得电，主机以很低转速正转${off}`);
            else this._tip(`自动：撤除冲车 / 慢转${off}`);
        });

        // 调速手柄大表盘：按住手柄拖动 → 机旁调速手柄给定（与机旁面板 local-dial 同一行为）
        const dialHit = this.addClickablePart('local-dial',
            LCP.dialX - 108 * LCP_K, LCP.dialY - 108 * LCP_K, 216 * LCP_K, 216 * LCP_K);
        this._lcpApplyDial = () => {
            const stage = this.sys && this.sys.stage;
            const ptr = stage && stage.getPointerPosition ? stage.getPointerPosition() : null;
            if (!ptr) return;
            const lo = this.group.getAbsoluteTransform().copy().invert().point(ptr);
            const dx = lo.x - LCP.dialX, dy = lo.y - LCP.dialY;
            let deg = Math.atan2(dx, -dy) * 180 / Math.PI;
            deg = Math.max(-LCP.dialMax, Math.min(LCP.dialMax, deg));
            const rpm = deg >= 0 ? (deg / LCP.dialMax) * 68 : (deg / LCP.dialMax) * 55;
            M.setLocalSpeed(rpm);          // 只给转速；控制权在机旁时才改写主机给定
            this._redraw();
        };
        this._lcpDialDrag = false;
        dialHit.on('mousedown touchstart', (e) => {
            e.cancelBubble = true;
            const st0 = this.sys && this.sys.stage;
            const p0 = st0 && st0.getPointerPosition ? st0.getPointerPosition() : null;
            if (p0) {
                const l0 = this.group.getAbsoluteTransform().copy().invert().point(p0);
                if (Math.hypot(l0.x - LCP.dialX, l0.y - LCP.dialY) > 64 * LCP_K) return;   // 只有按在手柄上才起拖
            }
            this._lcpDialDrag = true;
            if (this.group.draggable) this.group.draggable(false);
            this._lcpApplyDial();
        });
        if (this.sys && this.sys.stage && !this._lcpDialBound) {
            this._lcpDialBound = true;
            this.sys.stage.on('mousemove.lcp touchmove.lcp', () => { if (this._lcpDialDrag) this._lcpApplyDial(); });
            this.sys.stage.on('mouseup.lcp touchend.lcp', () => {
                if (!this._lcpDialDrag) return;
                this._lcpDialDrag = false;
                if (this.group.draggable) this.group.draggable(true);
            });
        }

        mk('work-btn', 1032, 22, 30, 18, () => this.setBlock(false));
        mk('block-btn', 1096, 22, 30, 18, () => this.setBlock(true));

        mk('main-valve', MSV.x - MSV.r - 6, MSV.y - MSV.r - 10, MSV.r * 2 + 12, MSV.r * 2 + 46, () => {
            this._tip(M.mainStartValveOpen
                ? '主起动阀：工作中（起动空气送向各缸起动阀）'
                : '主起动阀：阻塞（切断起动空气）');
        });

        mk('mv2a', CV1.x + CV1.w * 0.1 - 28, 95, 130, 46, () => this.toggleTwoWay('mv2a'));
        mk('cv1-pilot', CV1.x + 30, CV1.y + 60, 60, 130, () => this.toggleThreeWay('cv1-pilot'));

        mk('slow-valve', STV.x - STV.r - 52, STV.y - STV.r, STV.r * 2 + 60, STV.r * 2 + 50,
            () => this._tip('慢转起动阀：慢转时小流量供气，检查各缸起动阀动作'));

        // 两只控制阀的阀位**只由左侧气动接口的气压决定**，不提供手动切换（热区仅作部件标识）
        mk('distributor', V5A.x - 6, V5A.y - 12, V5A.w + 40, V5A.h + 24, null);
        mk('v5-b', V5B.x - 6, V5B.y - 12, V5B.w + 40, V5B.h + 24, null);

        mk('turning-gear', TG.x, TG.y, TG.w, TG.h, () => {
            if (M.running || M.starting) return;          // 运行中：盘车机不切换、不反应
            M.toggleTurningGear();
            this._tip(M.turningGearOut ? '盘车机脱开（允许起动）' : '盘车机合上（禁止起动）');
        });

        mk('ctrl-air', CA.x, CA.y, CA.w, CA.h,
            () => this._tip(`控制空气：${(Number(M.controlAir) || 0).toFixed(1)} Bar`));

        mk('rpm-tag', RPM.x, RPM.y, RPM.w, RPM.h,
            () => this._tip(`主机转速：${(Number(M.rpm) || 0).toFixed(1)} rpm`));
    }

    // ═══════════════════════════════════════════════════════
    //  每帧刷新
    // ═══════════════════════════════════════════════════════

    tick() {
        const M = this.model;
        if (!M) return;
        const dt = 1 / 20;                       // 仿真步长（20 fps，由 consys 驱动）

        // 机旁起动旋钮（冲车 / 自动 / 慢转）：只有控制权在机旁时才驱动电磁阀
        //   · 冲车 BLOW → 起动电磁阀 A（abc0）得电
        //   · 慢转 SLOW → 慢转电磁阀 C（abc2）得电
        const knob = M.startKnob || 'AUTO';
        const knobLocal = M.controlPos === 'LOCAL';
        // 起动电磁阀 A：任何起动（冲车 / 机旁 / 集控 / 驾驶台）都先得电，转速升到发火转速以上才失电
        this.setThreeWay('abc0', !!M.startValveA);
        this.setThreeWay('abc2', knobLocal && knob === 'SLOW');

        // 1 号起动电磁阀：主起动阀（或慢转起动阀）开启期间**间歇得电** —— 每次得电 0.5 s、断电 1.5 s
        const airOpen = !!M.airValveOpen;
        this._pilotT = airOpen ? ((this._pilotT || 0) + dt) % 2.0 : 0;
        this.setThreeWay('cv1-pilot', airOpen && this._pilotT < 0.5);

        const startAir = Number(M.startAir) || 0;
        const ctrlAir = Number(M.controlAir) || 0;
        const rpm = Number(M.rpm) || 0;

        if (this._val) {
            if (this._val.startAir) this._val.startAir.text(`${startAir.toFixed(1)} Bar`);
            // 控制气源（40 L 前的手动两位三通阀）：左入口有气 + 工作于下位 → 出口才有气
            const caVal = this._airTest('ctrlB') ? ctrlAir : 0;   // 总管无气或控制气源阀断开 → 0.0 Bar
            if (this._val.ctrlAir) this._val.ctrlAir.text(`${caVal.toFixed(1)} Bar`);
            if (this._val.rpm) this._val.rpm.text(`${rpm.toFixed(0)} rpm`);
        }

        this._syncStartBlock();
        this._syncPipes();
        // 控制气源消失/恢复时，A/B/C 的供气与中间环节要跟着重算
        const _sup = this._airTest('mech');
        if (_sup !== this._lastSupply) { this._lastSupply = _sup; this._updateShuttle(); }
        // 缸头进气流动效果：虚线滚动
        if (this._cv1Flows && this._cv1Flows[0] && this._cv1Flows[0].visible()) {
            this._cv1FlowPhase = (this._cv1FlowPhase + 1.5) % 11;
            this._cv1Flows.forEach((f) => f.dashOffset(-this._cv1FlowPhase));
        }
        // 1 号起动电磁阀：入口有气 + 线圈得电（下位）→ 出口有气 → 缸头工字下移
        const pilotDown = !!(this._mv3Parts && this._mv3Parts['cv1-pilot'] && this._mv3Parts['cv1-pilot'].shift);
        this._syncCylPiston(this._airTest('mv2aOut') && pilotDown);
        this._syncStartValve('msv', !!(this._v5State || {}).V5A && !this._blocked);
        this._syncStartValve('stv', !!(this._v5State || {}).V5B);
        this._stepStartValve('msv', dt);
        this._stepStartValve('stv', dt);
        if (this._workLamp) this._workLamp.fill(this._blocked ? '#c9ccce' : '#16c60c');
        if (this._blockLamp) this._blockLamp.fill(this._blocked ? '#e53935' : '#d8dcdd');
        const working = !!M.mainStartValveOpen;

        if (this._busGlow) {
            const on = working || !!M.starting;
            const cur = this._busGlow.opacity();
            const next = on ? Math.min(1, cur + 0.08) : Math.max(0, cur - 0.08);
            if (Math.abs(next - cur) > 0.001) this._busGlow.opacity(next);
        }

        if (this._tgTxt) this._tgTxt.text(M.turningGearOut ? 'Disengaged' : 'Engaged');

        // 机旁操纵复刻件：三档开关手柄角度 + 调速手柄指针（跟随模型，与机旁面板同步）
        if (this._lcpKnob) {
            const kn = String(M.startKnob || 'AUTO');
            this._lcpKnob.rotation(kn === 'BLOW' ? -60 : (kn === 'SLOW' ? 60 : 0));
        }
        if (this._lcpNeedle) {
            const lr = Number(M.localSpeed) || 0;
            const deg = lr >= 0 ? (lr / 68) * LCP.dialMax : (lr / 55) * LCP.dialMax;
            this._lcpNeedle.rotation(Math.max(-LCP.dialMax, Math.min(LCP.dialMax, deg)));
        }
        // 盘车机合上（engaged）→ 机械阀切到右位（断开并卸放）
        const mech = !M.turningGearOut;
        if (mech !== this._mechShift) { this._mechShift = mech; this._mech3Way(); this._updateShuttle(); }

        this.markDirty();
        this._refreshIfDirty();
        this._redraw();
    }
}
