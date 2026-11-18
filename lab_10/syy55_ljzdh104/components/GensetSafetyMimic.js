import Konva from 'konva';
import { BaseComponent } from './BaseComponent.js';
import { GensetSafetySolver, PROTECTION_SP } from '../tools/GensetSafetySolver.js';

const FONT = 'Arial, "Microsoft YaHei", sans-serif';

/** 管路 / 设备配色 */
const COL = {
    ht: '#7fd4ee',        // 高温淡水（浅蓝）
    htHot: '#ff9ec4',     // 高温淡水（热，粉）
    lo: '#e0a81a',        // 滑油（黄）
    air: '#9ad2f2',
    on: '#2ecc40',
    off: '#ffffff',
    red: '#e33b32',
    steel: '#5c7688',
    ink: '#1b2a35',
};

/** 12 只报警 / 状态灯（左上机旁面板） */
const LAMP_DEFS = [
    { id: 'led-manu-stop', en: "EM'CY STOP", cn: '手动紧急停车', kind: 'red' },
    { id: 'led-htfw-trip', en: 'HTFW H/T TRIP', cn: '水高温跳闸', kind: 'red' },
    { id: 'led-start-fail', en: 'START FAIL.', cn: '起动失败', kind: 'red' },
    { id: 'led-ready', en: 'READY TO START', cn: '准备起动', kind: 'green' },
    { id: 'led-remote', en: 'REMOTE', cn: '遥控位置', kind: 'green' },
    { id: 'led-lo-lp-trip', en: 'LO. L/P TRIP', cn: '滑油低压跳闸', kind: 'red' },
    { id: 'led-overspeed', en: 'OVER SPEED TRIP', cn: '超速跳闸', kind: 'red' },
    { id: 'led-running', en: 'ENG. RUNNING', cn: '机组运行', kind: 'green' },
    { id: 'led-local', en: 'LOCAL', cn: '机旁位置', kind: 'green' },
    { id: 'led-dc24', en: 'POWER DC24V', cn: '直流电源', kind: 'green' },
];

/** 5 只操作按钮 */
const BTN_DEFS = [
    { id: 'lamp-test', en: 'LAMP TEST', cn: '灯测试', color: '#1e6fb8' },
    { id: 'reset', en: 'RESET', cn: '复位', color: '#1e6fb8' },
    { id: 'eng-start', en: 'ENG. START', cn: '起动', color: '#1b8f2e' },
    { id: 'eng-stop', en: 'ENG. STOP', cn: '停车', color: '#c62828' },
    { id: 'emu-stop', en: "EM'CY STOP", cn: '紧急停车', color: '#8e1b1b' },
];

/** 安保测试工具箱：四台试验设备 */
const TOOL_DEFS = [
    { id: 'pump', cn: '手动泵压模块', en: 'HAND PRESSURE PUMP', use: '测试滑油低压', color: '#e6a417' },
    { id: 'freq', cn: '频率发生器', en: 'FREQUENCY GENERATOR', use: '测试超速保护', color: '#2f8fe0' },
    { id: 'res', cn: '电阻箱', en: 'RESISTANCE BOX', use: '代替传感器测高温', color: '#8e5cc9' },
    { id: 'oven', cn: '干式温度校验炉', en: 'DRY BLOCK CALIBRATOR', use: '放入传感器测高温', color: '#d9534f' },
];

/**
 * GensetSafetyMimic — 船舶柴油发电机组（副机）安全保护 MIMIC
 * ═══════════════════════════════════════════════════════════════════════════
 *  1700 × 900，上中下三大块、每块左右两区：
 *    左上 柴油发电机组机旁控制面板（ENGINE CONTROL UNIT）
 *    右上 安保测试工具箱（手动泵压 / 频率发生器 / 电阻箱 / 干式温度校验炉）
 *    左中 柴油发电机组模型（柴油机 + 发电机 + 盘车机构 + 磁电式转速传感器）
 *    右中 安全保护模块（超速 / 滑油低压 / 冷却水高温 → 停机执行链）
 *    左下 滑油系统（滑油柜、机带泵 / 预润滑泵、滤器、三通调温阀、冷却器）
 *    右下 高温淡水冷却系统（HTFW 泵、冷却器、三通调温阀、膨胀水柜）
 * ═══════════════════════════════════════════════════════════════════════════
 */
export class GensetSafetyMimic extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.W = Math.max(1400, config.width || 1620);
        this.H = Math.max(780, config.height || 840);
        this.type = 'genset_safety_mimic';
        this.special = 'genset_mimic';
        this.cache = 'fixed';

        this._animT = 0;

        this._initGroups();
        this._recalcGeometry();
        this._init();
        this._syncVisuals();

        this.config = { id: this.id, width: this.W, height: this.H };
    }

    _solver() {
        return this.sys && this.sys.gensetSolver ? this.sys.gensetSolver : null;
    }

    _tip(msg) {
        if (this.sys && typeof this.sys._tipPurifier === 'function') this.sys._tipPurifier(msg);
    }

    // ═══════════════════════════════════════════════════════════
    //  几何
    // ═══════════════════════════════════════════════════════════
    _recalcGeometry() {
        this._B = {
            panel: { x: 6, y: 40, w: 775, h: 216 },
            tools: { x: 789, y: 40, w: 795, h: 216 },
            genset: { x: 6, y: 262, w: 775, h: 298 },
            safety: { x: 789, y: 262, w: 795, h: 298 },
            lo: { x: 6, y: 566, w: 775, h: 268 },
            ht: { x: 789, y: 566, w: 795, h: 268 },
        };

        // ── 左上：机旁控制面板 ──
        const P = this._B.panel;
        this._panel = {
            lamps: LAMP_DEFS.map((d, i) => ({
                ...d,
                x: P.x + 14 + (i % 5) * 112,
                y: P.y + 40 + Math.floor(i / 5) * 54,
                w: 108, h: 46,
            })),
            buttons: BTN_DEFS.map((d, i) => ({
                ...d,
                x: P.x + 14 + i * 112,
                y: P.y + 150, w: 108, h: 42,
            })),
            knob: { cx: P.x + 666, cy: P.y + 112, r: 29 },
            knobBox: { x: P.x + 580, y: P.y + 40, w: 172, h: 158 },
        };

        // ── 右上：安保测试工具箱 ──
        const TB = this._B.tools;
        this._tools = {
            cards: TOOL_DEFS.map((d, i) => ({
                ...d, x: TB.x + 14 + i * 192, y: TB.y + 32, w: 184, h: 178,
            })),
        };

        // ── 左中：柴油发电机组模型 ──
        const GS = this._B.genset;
        this._genset = {
            turning: { x: GS.x + 24, y: GS.y + 26, w: 176, h: 60 },
            block: { x: GS.x + 210, y: GS.y + 26, w: 176, h: 60 },
            head: { x: GS.x + 60, y: GS.y + 84, w: 356, h: 50 },
            engine: { x: GS.x + 40, y: GS.y + 132, w: 396, h: 118 },
            loadKnob: { cx: GS.x + 78, cy: GS.y + 166, r: 20 },
            turbo: { cx: GS.x + 404, cy: GS.y + 108, r: 22 },
            flywheel: { cx: GS.x + 470, cy: GS.y + 192, r: 32 },
            sensor: { cx: GS.x + 470, cy: GS.y + 136, w: 20, h: 36 },
            gen: { cx: GS.x + 650, cy: GS.y + 192, r: 60 },
            skid: { x: GS.x + 26, y: GS.y + 262, w: 742, h: 24 },
            exh: { x: GS.x + 430, y: GS.y + 26 },
            airBottle: { x: GS.x + 620, y: GS.y + 26, w: 52, h: 66 },
            airComp: { x: GS.x + 700, y: GS.y + 26, w: 62, h: 40 },
            airValve: { cx: GS.x + 540, cy: GS.y + 60 },
        };

        // ── 右中：安全保护模块 ──
        const S = this._B.safety;
        this._safety = {
            cards: [0, 1, 2].map(i => ({ x: S.x + 14, y: S.y + 44 + i * 80, w: 322, h: 74 })),
            relay: { x: S.x + 348, y: S.y + 44, w: 125, h: 56 },
            solenoid: { x: S.x + 506, y: S.y + 44, w: 125, h: 56 },
            fuelCut: { x: S.x + 662, y: S.y + 44, w: 101, h: 56 },
            cmd: { x: S.x + 348, y: S.y + 150, w: 115, h: 32 },
            stopBox: { x: S.x + 500, y: S.y + 146, w: 225, h: 62 },
            resetBtn: { x: S.x + 656, y: S.y + 214, w: 122, h: 32 },
        };

        // ── 左下：滑油系统 ──
        const L = this._B.lo;
        this._lo = {
            tank: { x: L.x + 24, y: L.y + 49, w: 150, h: 96 },
            engine: { x: L.x + 250, y: L.y + 6, w: 120, h: 48 },
            filter: { x: L.x + 420, y: L.y + 14, w: 48, h: 32 },
            rv3: { cx: L.x + 520, cy: L.y + 113 },
            cooler: { x: L.x + 590, y: L.y + 146, w: 33, h: 67 },
            pumpAtt: { cx: L.x + 250, cy: L.y + 170, r: 17 },
            pumpPrim: { cx: L.x + 250, cy: L.y + 228, r: 17 },
            primPanel: { x: L.x + 546, y: L.y + 4, w: 224, h: 96 },
        };

        // ── 右下：高温淡水冷却系统 ──
        const H = this._B.ht;
        this._ht = {
            eng: { x: H.x + 20, y: H.y + 50, w: 110, h: 120 },
            tt: { cx: H.x + 200, cy: H.y + 74 },
            cooler: { x: H.x + 413, y: H.y + 56, w: 70, h: 36 },
            rv3: { cx: H.x + 580, cy: H.y + 145 },
            pump: { cx: H.x + 280, cy: H.y + 230, r: 17 },
        };

        // 手动阀几何：{ key, x, y, ang, part }
        this._valveDefs = [
        ];
    }

    // ═══════════════════════════════════════════════════════════
    //  绘制工具
    // ═══════════════════════════════════════════════════════════
    _label(g, x, y, text, size = 11, fill = '#333333', bold = false, align = 'left', width = 0) {
        const o = { x, y, text, fontSize: size, fontStyle: bold ? 'bold' : 'normal', fill, align, fontFamily: FONT };
        if (width) o.width = width;
        g.add(new Konva.Text(o));
        return g;
    }

    _pipe(g, pts, color = COL.ht, w = 3.4, dash = null) {
        const o = { points: pts, stroke: color, strokeWidth: w, lineCap: 'round', lineJoin: 'round' };
        if (dash) o.dash = dash;
        g.add(new Konva.Line(o));
    }

    /** 管路流向箭头（ang: 0=右 90=下 180=左 270=上） */
    _flowArrow(g, x, y, ang, s = 6, color = '#8a5a00') {
        const r = ang * Math.PI / 180;
        const ux = Math.cos(r), uy = Math.sin(r);
        const px = -uy, py = ux;
        g.add(new Konva.Line({
            points: [x - ux * s * 1.6 + px * s, y - uy * s * 1.6 + py * s, x, y,
                x - ux * s * 1.6 - px * s, y - uy * s * 1.6 - py * s],
            closed: true, fill: color, listening: false,
        }));
    }

    /** 截止阀（手轮）：返回左右两片三角，供动态着色 */
    _gateValve(g, cx, cy, ang = 0, w = 13, h = 9) {
        const grp = new Konva.Group({ x: cx, y: cy, rotation: ang });
        const a = new Konva.Line({ points: [-w, -h, -w, h, 0, 0], closed: true, fill: COL.off, stroke: '#3d4a54', strokeWidth: 1.4 });
        const b = new Konva.Line({ points: [w, -h, w, h, 0, 0], closed: true, fill: COL.off, stroke: '#3d4a54', strokeWidth: 1.4 });
        grp.add(a, b);
        grp.add(new Konva.Line({ points: [0, 0, 0, -15], stroke: '#3d4a54', strokeWidth: 2 }));
        grp.add(new Konva.Line({ points: [-7, -15, 7, -15], stroke: '#3d4a54', strokeWidth: 3, lineCap: 'round' }));
        g.add(grp);
        return { a, b, grp };
    }

    /** 三通调节阀底座（静态：阀体圆 + 电动执行器） */
    _threeWayBase(g, cx, cy, r = 16) {
        g.add(new Konva.Circle({ x: cx, y: cy, radius: r, fill: '#f2f6f8', stroke: '#3d4a54', strokeWidth: 1.6 }));
        g.add(new Konva.Rect({
            x: cx - 11, y: cy - r - 13, width: 22, height: 12, cornerRadius: 2,
            fill: '#9fb3c2', stroke: '#3d4a54', strokeWidth: 1,
        }));
        g.add(new Konva.Line({ points: [cx, cy - r, cx, cy - r - 1], stroke: '#3d4a54', strokeWidth: 2 }));
    }

    /** 三通调节阀阀芯（动态：三片三角随开度着色） */
    _threeWayCore(cx, cy, r = 16) {
        const grp = new Konva.Group({ x: cx, y: cy });
        const a = new Konva.Line({ points: [-r * 0.82, -r * 0.45, -r * 0.82, r * 0.45, 0, 0], closed: true, fill: COL.off, stroke: '#3d4a54', strokeWidth: 1.1 });
        const b = new Konva.Line({ points: [r * 0.82, -r * 0.45, r * 0.82, r * 0.45, 0, 0], closed: true, fill: COL.off, stroke: '#3d4a54', strokeWidth: 1.1 });
        const c = new Konva.Line({ points: [0, 0, -r * 0.5, r * 0.82, r * 0.5, r * 0.82], closed: true, fill: COL.off, stroke: '#3d4a54', strokeWidth: 1.1 });
        grp.add(a, b, c);
        this._dynamicGroup.add(grp);
        return { a, b, c };
    }

    /** 泵：圆壳 + 电机（叶轮在动态层） */
    /** 泵：圆壳 + 顶部驱动（box=电机方块 / motor=电动机符号 / coupling=机带联轴器符号） */
    _pumpBase(g, cx, cy, r, top = 'box') {
        g.add(new Konva.Circle({ x: cx, y: cy, radius: r, fill: '#f4f6f7', stroke: '#4a5560', strokeWidth: 2 }));
        if (top === 'motor') {
            const mr = 8;
            g.add(new Konva.Line({ points: [cx, cy - r, cx, cy - r - 3], stroke: '#4a5560', strokeWidth: 2 }));
            g.add(new Konva.Circle({ x: cx, y: cy - r - 3 - mr, radius: mr, fill: '#dfe9f2', stroke: '#4a5560', strokeWidth: 1.4 }));
            this._label(g, cx - mr, cy - r - 3 - mr - 5, 'M', 11, '#1b2a35', true, 'center', mr * 2);
        } else if (top === 'coupling') {
            g.add(new Konva.Line({ points: [cx, cy - r, cx, cy - r - 3], stroke: '#4a5560', strokeWidth: 2 }));
            this._couplingSymbol(g, cx, cy - r - 13, 10);
        } else {
            g.add(new Konva.Rect({ x: cx - r * 0.5, y: cy - r - 13, width: r, height: 11, cornerRadius: 2, fill: '#b9c4cc', stroke: '#4a5560', strokeWidth: 1 }));
            g.add(new Konva.Line({ points: [cx, cy - r, cx, cy - r - 4], stroke: '#4a5560', strokeWidth: 2 }));
        }
    }

    /** 机带联轴器符号（两条交叉的圆角条 + 圆点） */
    _couplingSymbol(g, cx, cy, s = 9) {
        [45, -45].forEach(ang => {
            const grp = new Konva.Group({ x: cx, y: cy, rotation: ang });
            grp.add(new Konva.Rect({
                x: -s * 0.33, y: -s, width: s * 0.66, height: s * 2,
                cornerRadius: s * 0.3, fill: '#c3ccd3', stroke: '#4a5560', strokeWidth: 1,
            }));
            [-0.62, -0.2, 0.2, 0.62].forEach(k => {
                grp.add(new Konva.Circle({ x: 0, y: k * s, radius: 1.4, fill: '#3d4a54' }));
            });
            g.add(grp);
        });
    }

    /** 动态数值文本 */
    _tagValue(x, y, size = 12, color = '#0b3d91', align = 'left', width = 0) {
        const t = new Konva.Text({
            x, y, text: '', fontSize: size, fontStyle: 'bold', fill: color, align, fontFamily: FONT,
            listening: false,
        });
        if (width) t.width(width);
        this._dynamicGroup.add(t);
        return t;
    }

    // ═══════════════════════════════════════════════════════════
    //  初始化
    // ═══════════════════════════════════════════════════════════
    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
    }

    _drawStaticParts() {
        const g = this._staticGroup;

        g.add(new Konva.Rect({ x: 0, y: 0, width: this.W, height: this.H, cornerRadius: 8, fill: '#eef2f5', stroke: '#c3ccd3', strokeWidth: 2 }));
        this._label(g, 14, 8, '船舶柴油发电机组（副机）安全保护系统 — 功能测试', 20, '#0b3d91', true);
        this._label(g, this.W - 500, 13, 'MIMIC ｜ 机旁面板 + 安保测试工具箱 + 机组 / 安全保护模块 / 滑油 / 高温淡水', 13, '#5a6b78');

        this._drawPanel(g);
        this._drawToolbox(g);
        this._drawGenset(g);
        this._drawSafety(g);
        this._drawLo(g);
        this._drawHt(g);
    }

    // ─────────────────────────────────────────────
    //  左上：机旁控制面板
    // ─────────────────────────────────────────────
    _drawPanel(g) {
        const P = this._B.panel, PN = this._panel;

        g.add(new Konva.Rect({ x: P.x, y: P.y, width: P.w, height: P.h, cornerRadius: 10, fill: '#2b333b', stroke: '#0d1216', strokeWidth: 2.5 }));
        g.add(new Konva.Rect({
            x: P.x + 6, y: P.y + 6, width: P.w - 12, height: P.h - 12, cornerRadius: 8,
            fillEnabled: false, stroke: '#5b6874', strokeWidth: 1,
        }));

        this._label(g, P.x + 16, P.y + 10, '柴油发电机组机旁控制面板', 16, '#ffffff', true);
        this._label(g, P.x + 220, P.y + 12, 'ENGINE CONTROL UNIT', 13, '#cfdae2');

        PN.lamps.forEach(L => {
            g.add(new Konva.Rect({
                x: L.x, y: L.y, width: L.w, height: L.h, cornerRadius: 6, fill: '#1a2128', stroke: '#4b5762', strokeWidth: 1.2,
            }));
            this._label(g, L.x + 24, L.y + 10, L.cn, 13, '#ffffff', true, 'left', L.w - 28);
            this._label(g, L.x + 24, L.y + 32, L.en, 8.5, '#e2e9ee', false, 'left', L.w - 28);
        });

        PN.buttons.forEach(Bt => {
            g.add(new Konva.Rect({
                x: Bt.x, y: Bt.y, width: Bt.w, height: Bt.h, cornerRadius: 5, fill: Bt.color, stroke: '#0b0f12', strokeWidth: 1.5,
            }));
            g.add(new Konva.Rect({
                x: Bt.x + 3, y: Bt.y + 3, width: Bt.w - 6, height: Bt.h - 6, cornerRadius: 3,
                fillEnabled: false, stroke: 'rgba(255,255,255,0.35)', strokeWidth: 1,
            }));
            this._label(g, Bt.x, Bt.y + 8, Bt.cn, 13, '#ffffff', true, 'center', Bt.w);
            this._label(g, Bt.x, Bt.y + 28, Bt.en, 8.5, '#dfe7ec', false, 'center', Bt.w);
        });

        const K = PN.knobBox, KB = PN.knob;
        g.add(new Konva.Rect({
            x: K.x, y: K.y, width: K.w, height: K.h, cornerRadius: 6, fill: '#20272e', stroke: '#59656f', strokeWidth: 1.2,
        }));
        this._drawKnobBase(g, KB.cx, KB.cy, KB.r);
        // 档位标注：BLOCK 左、LOCAL 上、REM 右
        this._label(g, KB.cx - 30, K.y + 20, 'LOCAL', 15, '#9be3a4', true, 'center', 60);
        this._label(g, K.x + 2, KB.cy - 6, 'BLOCK', 15, '#ffd27a', true, 'left', 54);
        this._label(g, K.x + K.w - 54, KB.cy - 6, 'REM', 15, '#9be3a4', true, 'left', 50);
        // 名称标注放在旋钮下方
        this._label(g, K.x, K.y + 112, '控制方式 CONTROL MODE', 13, '#cfdae2', true, 'center', K.w);
        this._label(g, KB.cx - 40, K.y + 132, '闭锁 / 机旁 / 遥控', 12, '#93a2ae', false, 'center', 100);
    }

    _drawKnobBase(g, cx, cy, R = 33) {
        g.add(new Konva.Circle({ x: cx, y: cy, radius: R, fill: '#ffffff', stroke: '#9aa0a0', strokeWidth: 1.2 }));
        g.add(new Konva.Circle({ x: cx, y: cy, radius: R - 7, fill: '#141414', stroke: '#000000', strokeWidth: 1 }));
    }

    // ─────────────────────────────────────────────
    //  右上：安保测试工具箱
    // ─────────────────────────────────────────────
    _drawToolbox(g) {
        const TB = this._B.tools, T = this._tools;

        g.add(new Konva.Rect({ x: TB.x, y: TB.y, width: TB.w, height: TB.h, cornerRadius: 10, fill: '#f3f7fa', stroke: '#c3ccd3', strokeWidth: 1.6 }));
        this._label(g, TB.x + 12, TB.y + 8, '安保测试工具箱   SAFETY TEST TOOLBOX', 15, '#0b3d91', true);
        this._label(g, TB.x + 330, TB.y + 10, '模拟三路保护信号（转速 / 滑油压力 / 冷却水温度），验证保护定值与停机链', 12, '#5a6b78');

        T.cards.forEach((c, i) => {
            const D = TOOL_DEFS[i];
            g.add(new Konva.Rect({ x: c.x, y: c.y, width: c.w, height: c.h, cornerRadius: 7, fill: '#ffffff', stroke: '#b9c4cc', strokeWidth: 1.4 }));
            g.add(new Konva.Rect({ x: c.x, y: c.y, width: 5, height: c.h, cornerRadius: 2, fill: D.color }));
            this._label(g, c.x + 12, c.y + 6, D.cn, 18, '#1b2a35', true);

            // 设备示意图（整体下移 5px）
            if (i === 0) this._drawHandPump(g, c.x, c.y + 5);
            else if (i === 1) this._drawFreqGen(g, c.x, c.y + 5);
            else if (i === 2) this._drawResBox(g, c.x, c.y + 5);
            else this._drawOven(g, c.x, c.y + 5);

            // 三个按钮：接入 / − / +（下移 20px）
            const by = c.y + 150;
            g.add(new Konva.Rect({ x: c.x + 6, y: by, width: 72, height: 24, cornerRadius: 4, fill: '#1e6fb8', stroke: '#0b2b45', strokeWidth: 1.2 }));
            this._label(g, c.x + 6, by + 4, '接入', 13, '#ffffff', true, 'center', 72);
            [['dec', c.x + 84], ['inc', c.x + 128]].forEach(([k, bx]) => {
                g.add(new Konva.Rect({ x: bx, y: by, width: 40, height: 24, cornerRadius: 4, fill: '#e8ecef', stroke: '#8a949c', strokeWidth: 1.2 }));
                this._label(g, bx, by + 2, k === 'inc' ? '+' : '−', 16, '#1b2a35', true, 'center', 40);
            });
        });
    }

    _drawHandPump(g, cx, cy) {
        // 手压泵：缸体 + 手柄（缸体顶部向右上）+ 输出软管（缸体右边缘中间引出）+ 压力表
        // 输出软管先画，压力表压在上面
        g.add(new Konva.Line({ points: [cx + 60, cy + 74, cx + 144, cy + 74, cx + 156, cy + 86], stroke: '#c9a227', strokeWidth: 3, lineCap: 'round', lineJoin: 'round' }));
        // 缸体
        g.add(new Konva.Rect({ x: cx + 16, y: cy + 66, width: 44, height: 17, cornerRadius: 3, fill: '#cfd8de', stroke: '#4a5560', strokeWidth: 1.4 }));
        // 手柄（还原：缸体顶部向右上斜伸）
        g.add(new Konva.Line({ points: [cx + 38, cy + 66, cx + 38, cy + 52], stroke: '#6b757a', strokeWidth: 4 }));
        g.add(new Konva.Line({ points: [cx + 38, cy + 52, cx + 82, cy + 38], stroke: '#8a949c', strokeWidth: 5, lineCap: 'round' }));
        g.add(new Konva.Circle({ x: cx + 82, y: cy + 38, radius: 5, fill: '#4a5560' }));
        // 压力表（串在输出管路上）
        g.add(new Konva.Circle({ x: cx + 106, y: cy + 62, radius: 16, fill: '#ffffff', stroke: '#4a5560', strokeWidth: 1.6 }));
        for (let k = 0; k <= 4; k++) {
            const a = (-135 + k * 67.5) * Math.PI / 180;
            g.add(new Konva.Line({
                points: [cx + 106 + Math.sin(a) * 12, cy + 62 - Math.cos(a) * 12, cx + 106 + Math.sin(a) * 7, cy + 62 - Math.cos(a) * 7],
                stroke: '#5a6670', strokeWidth: 1.2,
            }));
        }
        this._label(g, cx + 6, cy + 86, '→→ 滑油压力传感器', 11.5, '#8a5a00', true);
    }

    _drawFreqGen(g, cx, cy) {
        g.add(new Konva.Rect({ x: cx + 14, y: cy + 34, width: 96, height: 48, cornerRadius: 5, fill: '#e8ecef', stroke: '#4a5560', strokeWidth: 1.5 }));
        g.add(new Konva.Rect({ x: cx + 20, y: cy + 40, width: 84, height: 20, cornerRadius: 2, fill: '#0d1b14', stroke: '#2f4a3a', strokeWidth: 1 }));
        // 正弦波
        const pts = [];
        for (let i = 0; i <= 20; i++) {
            const x = cx + 24 + i * 4;
            pts.push(x, cy + 50 - Math.sin(i / 20 * Math.PI * 2) * 6);
        }
        g.add(new Konva.Line({ points: pts, stroke: '#39e75f', strokeWidth: 1.4 }));
        g.add(new Konva.Circle({ x: cx + 34, y: cy + 74, radius: 5.5, fill: '#9aa4a9', stroke: '#4a5560', strokeWidth: 1 }));
        g.add(new Konva.Circle({ x: cx + 56, y: cy + 74, radius: 3.5, fill: '#39e75f', stroke: '#1b4a26', strokeWidth: 1 }));
        // BNC 输出
        g.add(new Konva.Circle({ x: cx + 128, y: cy + 58, radius: 8, fill: '#cfd8de', stroke: '#4a5560', strokeWidth: 1.4 }));
        g.add(new Konva.Circle({ x: cx + 128, y: cy + 58, radius: 3, fill: '#8a949c' }));
        g.add(new Konva.Line({ points: [cx + 110, cy + 58, cx + 120, cy + 58], stroke: '#4a5560', strokeWidth: 2 }));
        this._label(g, cx + 18, cy + 88, '60 齿', 11.5, '#5a6b78');
        this._label(g, cx + 56, cy + 86, '→→ 代替转速传感器', 11.5, '#0d47a1', true);
    }

    _drawResBox(g, cx, cy) {
        g.add(new Konva.Rect({ x: cx + 12, y: cy + 34, width: 112, height: 50, cornerRadius: 4, fill: '#eef1f3', stroke: '#4a5560', strokeWidth: 1.5 }));
        [0, 1, 2].forEach(k => {
            const dx = cx + 34 + k * 28;
            g.add(new Konva.Circle({ x: dx, y: cy + 54, radius: 9, fill: '#ffffff', stroke: '#5a6670', strokeWidth: 1.2 }));
            g.add(new Konva.Line({ points: [dx, cy + 54, dx, cy + 47], stroke: '#8e5cc9', strokeWidth: 2 }));
            this._label(g, dx - 8, cy + 64, `${k + 1}`, 7, '#5a6b78', false, 'center', 16);
        });
        // 接线柱
        g.add(new Konva.Circle({ x: cx + 24, y: cy + 78, radius: 4, fill: '#b23b3b', stroke: '#5a1a16', strokeWidth: 1 }));
        g.add(new Konva.Circle({ x: cx + 112, y: cy + 78, radius: 4, fill: '#1b2a35', stroke: '#000000', strokeWidth: 1 }));
        this._label(g, cx + 12, cy + 88, '100~180 Ω', 11.5, '#5a6b78');
        this._label(g, cx + 76, cy + 88, '→→ 代替 PT100', 11.5, '#5b2d8e', true);
    }

    _drawOven(g, cx, cy) {
        // 炉体
        g.add(new Konva.Rect({ x: cx + 20, y: cy + 42, width: 58, height: 46, cornerRadius: 6, fill: '#cfd8de', stroke: '#4a5560', strokeWidth: 1.5 }));
        g.add(new Konva.Rect({ x: cx + 32, y: cy + 36, width: 34, height: 9, cornerRadius: 3, fill: '#9aa4a9', stroke: '#4a5560', strokeWidth: 1.2 }));
        // 炉膛插孔
        g.add(new Konva.Rect({ x: cx + 42, y: cy + 34, width: 16, height: 18, cornerRadius: 2, fill: '#3a4046' }));
        // 插入的 PT100
        g.add(new Konva.Line({ points: [cx + 50, cy + 24, cx + 50, cy + 54], stroke: '#b0b8bf', strokeWidth: 3 }));
        g.add(new Konva.Circle({ x: cx + 50, y: cy + 56, radius: 4, fill: '#b0b8bf', stroke: '#4a5560', strokeWidth: 1 }));
        this._label(g, cx + 10, cy + 24, 'PT100', 11.5, '#1b2a35', true);
        // 显示窗
        g.add(new Konva.Rect({ x: cx + 88, y: cy + 40, width: 76, height: 22, cornerRadius: 2, fill: '#241212', stroke: '#6b3a34', strokeWidth: 1 }));
        g.add(new Konva.Rect({ x: cx + 88, y: cy + 68, width: 76, height: 16, cornerRadius: 3, fill: '#e8ecef', stroke: '#8a949c', strokeWidth: 1 }));
        this._label(g, cx + 88, cy + 71, 'DRY BLOCK', 10.5, '#5a6b78', false, 'center', 76);
        this._label(g, cx + 88, cy + 92, '0 ~ 200 ℃', 11.5, '#5a6b78');
    }

    // ─────────────────────────────────────────────
    //  左中：柴油发电机组模型
    // ─────────────────────────────────────────────
    _drawGenset(g) {
        const GS = this._B.genset, G = this._genset;

        g.add(new Konva.Rect({ x: GS.x, y: GS.y, width: GS.w, height: GS.h, cornerRadius: 10, fill: '#f7f9fa', stroke: '#c3ccd3', strokeWidth: 1.6 }));
        this._label(g, GS.x + 12, GS.y + 3, '柴油发电机组模型  DIESEL GENERATOR SET', 15, '#0b3d91', true);

        // 机座
        g.add(new Konva.Rect({ x: G.skid.x, y: G.skid.y, width: G.skid.w, height: G.skid.h, cornerRadius: 3, fill: '#b9c0c6', stroke: '#6d767d', strokeWidth: 1.4 }));
        for (let i = 0; i < 6; i++) {
            g.add(new Konva.Rect({ x: G.skid.x + 24 + i * 128, y: G.skid.y + G.skid.h, width: 20, height: 8, fill: '#8d959b', stroke: '#6d767d', strokeWidth: 1 }));
        }

        // 柴油机机体
        g.add(new Konva.Rect({ x: G.engine.x, y: G.engine.y, width: G.engine.w, height: G.engine.h, cornerRadius: 7, fill: '#2a5fa8', stroke: '#173b6b', strokeWidth: 2 }));
        g.add(new Konva.Rect({ x: G.engine.x + 9, y: G.engine.y + 10, width: G.engine.w - 18, height: G.engine.h - 20, cornerRadius: 5, fillEnabled: false, stroke: '#5c8fd0', strokeWidth: 1.2 }));
        // 缸头 / 凸轮轴罩
        g.add(new Konva.Rect({ x: G.head.x, y: G.head.y, width: G.head.w, height: G.head.h, cornerRadius: 5, fill: '#9fb0bd', stroke: '#4a5560', strokeWidth: 1.7 }));
        for (let i = 0; i < 8; i++) {
            const cx = G.head.x + 26 + i * 43;
            g.add(new Konva.Rect({ x: cx - 14, y: G.head.y + 7, width: 28, height: G.head.h - 14, cornerRadius: 5, fill: '#e4eaee', stroke: '#5a6670', strokeWidth: 1.3 }));
            g.add(new Konva.Circle({ x: cx, y: G.head.y + 14, radius: 6, fill: '#c9d3da', stroke: '#5a6670', strokeWidth: 1 }));
            g.add(new Konva.Line({ points: [cx, G.head.y + 22, cx, G.head.y + G.head.h - 10], stroke: '#7b8792', strokeWidth: 3.5 }));
        }
        // 曲轴箱视窗
        for (let i = 0; i < 4; i++) {
            g.add(new Konva.Rect({ x: G.engine.x + 30 + i * 92, y: G.engine.y + 58, width: 62, height: 40, cornerRadius: 5, fill: '#4c82c4', stroke: '#173b6b', strokeWidth: 1.2 }));
        }
        // 负荷调节旋钮（曲轴箱左上角）：0~100 %，默认 50 %
        {
            const K = G.loadKnob;
            this._drawKnobBase(g, K.cx, K.cy, K.r);
            this._label(g, K.cx + K.r + 10, K.cy - 23, '负荷调节', 11.5, '#d7e8ff', true);
            this._label(g, K.cx + K.r + 10, K.cy + 14, '0 ~ 100 %', 9.5, '#bcd6f5');
        }

        // 增压器
        g.add(new Konva.Circle({ x: G.turbo.cx, y: G.turbo.cy, radius: G.turbo.r, fill: '#cfd8de', stroke: '#4a5560', strokeWidth: 1.8 }));
        g.add(new Konva.Circle({ x: G.turbo.cx, y: G.turbo.cy, radius: G.turbo.r * 0.45, fill: '#8fa0ad', stroke: '#4a5560', strokeWidth: 1.2 }));

        // 飞轮 + 磁电式转速传感器
        g.add(new Konva.Circle({ x: G.flywheel.cx, y: G.flywheel.cy, radius: G.flywheel.r, fill: '#dfe5e9', stroke: '#4a5560', strokeWidth: 1.8 }));
        g.add(new Konva.Circle({ x: G.flywheel.cx, y: G.flywheel.cy, radius: G.flywheel.r * 0.5, fill: '#b6c2cb', stroke: '#4a5560', strokeWidth: 1.2 }));
        g.add(new Konva.Rect({ x: G.sensor.cx - G.sensor.w / 2, y: G.sensor.cy - G.sensor.h / 2, width: G.sensor.w, height: G.sensor.h, cornerRadius: 4, fill: '#9fb0bd', stroke: '#4a5560', strokeWidth: 1.4 }));
        this._pipe(g, [G.sensor.cx, G.sensor.cy + G.sensor.h / 2, G.sensor.cx, G.flywheel.cy - G.flywheel.r], '#4a5560', 2, [5, 4]);
        this._label(g, G.sensor.cx - 56, G.sensor.cy - 35, '磁电式转速传感器', 12.5, '#1b2a35', true, 'center', 132);

        // 联轴器
        g.add(new Konva.Rect({ x: G.flywheel.cx + G.flywheel.r, y: G.flywheel.cy - 10, width: G.gen.cx - G.gen.r - (G.flywheel.cx + G.flywheel.r), height: 20, fill: '#aeb9c2', stroke: '#4a5560', strokeWidth: 1.4 }));

        // 发电机
        g.add(new Konva.Circle({ x: G.gen.cx, y: G.gen.cy, radius: G.gen.r, fill: '#dde4e9', stroke: '#4a5560', strokeWidth: 2.2 }));
        g.add(new Konva.Circle({ x: G.gen.cx, y: G.gen.cy, radius: G.gen.r - 12, fill: '#eef3f6', stroke: '#9aa8b3', strokeWidth: 1.2 }));
        for (let i = 0; i < 12; i++) {
            const a = i * 30 * Math.PI / 180;
            g.add(new Konva.Line({
                points: [G.gen.cx + Math.cos(a) * (G.gen.r - 14), G.gen.cy + Math.sin(a) * (G.gen.r - 14),
                    G.gen.cx + Math.cos(a) * (G.gen.r - 2), G.gen.cy + Math.sin(a) * (G.gen.r - 2)],
                stroke: '#8fa0ad', strokeWidth: 1.8,
            }));
        }
        this._label(g, G.flywheel.cx + G.flywheel.r + 4, G.flywheel.cy + 12, '同步发电机', 13, '#1b2a35', true);

        // 盘车机构
        const TG = G.turning;
        g.add(new Konva.Rect({ x: TG.x, y: TG.y, width: TG.w, height: TG.h, cornerRadius: 5, fill: '#ffffff', stroke: '#4a5560', strokeWidth: 1.5 }));
        this._label(g, TG.x + 8, TG.y + 33, 'Turning Gear', 12, '#1b2a35', true);
        this._label(g, TG.x + 8, TG.y + 16, '盘车机构', 13, '#5a6b78');
        this._label(g, TG.x + 68, TG.y, 'ENGAGE', 11, '#8a5a00', true, 'center', 50);
        this._label(g, TG.x + 120, TG.y, 'DISENG', 11, '#1b6b2e', true, 'center', 50);
        this._drawKnobBase(g, TG.x + TG.w - 60, TG.y + 36, 22);
        this._pipe(g, [TG.x + 22, TG.y + TG.h, TG.x + 22, G.engine.y + 18, G.head.x + 30, G.engine.y + 18], '#7b8792', 1.4, [5, 4]);

        // 闭锁手柄
        const BH = G.block;
        g.add(new Konva.Rect({ x: BH.x, y: BH.y, width: BH.w, height: BH.h, cornerRadius: 5, fill: '#ffffff', stroke: '#4a5560', strokeWidth: 1.5 }));
        this._label(g, BH.x + 8, BH.y + 33, 'Block Handle', 12, '#1b2a35', true);
        this._label(g, BH.x + 8, BH.y + 16, '闭锁手柄', 13, '#5a6b78');
        this._label(g, BH.x + 68, BH.y, 'WORK', 11, '#8a5a00', true, 'center', 50);
        this._label(g, BH.x + 120, BH.y, 'STOP', 11, '#c62828', true, 'center', 50);
        this._drawKnobBase(g, BH.x + BH.w - 60, BH.y + 36, 22);

        // ── 起动空气系统（压缩空气起动）──
        const AB = G.airBottle, AC = G.airComp, AV = G.airValve;
        // 空气瓶
        g.add(new Konva.Rect({ x: AB.x, y: AB.y, width: AB.w, height: AB.h, cornerRadius: 12, fill: '#dfe9f2', stroke: '#4a5560', strokeWidth: 1.8 }));
        g.add(new Konva.Rect({ x: AB.x + AB.w / 2 - 9, y: AB.y - 8, width: 18, height: 9, cornerRadius: 2, fill: '#9fb0bd', stroke: '#4a5560', strokeWidth: 1.2 }));
        g.add(new Konva.Circle({ x: AB.x + AB.w / 2, y: AB.y + 22, radius: 13, fill: '#ffffff', stroke: '#4a5560', strokeWidth: 1.4 }));
        g.add(new Konva.Line({ points: [AB.x + AB.w / 2, AB.y + 22, AB.x + AB.w / 2, AB.y + 13], stroke: '#c62828', strokeWidth: 1.6 }));
        this._label(g, AB.x - 3, AB.y + AB.h + 4, '起动空气瓶', 11.5, '#1b2a35', true);
        // 空压机
        g.add(new Konva.Rect({ x: AC.x, y: AC.y, width: AC.w, height: AC.h, cornerRadius: 4, fill: '#cfd8de', stroke: '#4a5560', strokeWidth: 1.5 }));
        g.add(new Konva.Circle({ x: AC.x + 18, y: AC.y + AC.h / 2, radius: 10, fill: '#eef2f5', stroke: '#4a5560', strokeWidth: 1.2 }));
        this._label(g, AC.x + 12, AC.y + AC.h + 6, '空压机', 12.5, '#1b2a35');
        // 管路：空压机 → 空气瓶 → 起动空气阀 → 各缸起动阀
        this._pipe(g, [AC.x, AC.y + 18, AB.x + AB.w, AB.y + 18], COL.air, 2.6);
        this._pipe(g, [AB.x, AV.cy, AV.cx + 14, AV.cy], COL.air, 3.2);
        this._pipe(g, [AV.cx - 14, AV.cy, GS.x + 500, AV.cy, GS.x + 500, G.head.y - 2, G.head.x + G.head.w, G.head.y - 2], COL.air, 3.2);
        this._label(g, AV.cx - 30, AV.cy - 36, '起动空气阀', 11.5, '#1b2a35', true);
        // 起动空气阀（电磁阀符号）
        g.add(new Konva.Line({ points: [AV.cx - 8, AV.cy - 7, AV.cx - 8, AV.cy + 7, AV.cx, AV.cy], closed: true, fill: '#ffffff', stroke: '#3d4a54', strokeWidth: 1.2 }));
        g.add(new Konva.Line({ points: [AV.cx + 8, AV.cy - 7, AV.cx + 8, AV.cy + 7, AV.cx, AV.cy], closed: true, fill: '#ffffff', stroke: '#3d4a54', strokeWidth: 1.2 }));
        g.add(new Konva.Rect({ x: AV.cx - 9, y: AV.cy - 18, width: 18, height: 8, cornerRadius: 2, fill: '#9fb3c2', stroke: '#3d4a54', strokeWidth: 1 }));
    }

    // ─────────────────────────────────────────────
    //  右中：安全保护模块
    // ─────────────────────────────────────────────
    _drawSafety(g) {
        const S = this._B.safety, SF = this._safety;

        g.add(new Konva.Rect({ x: S.x, y: S.y, width: S.w, height: S.h, cornerRadius: 10, fill: '#12212e', stroke: '#08131c', strokeWidth: 2.5 }));
        g.add(new Konva.Rect({
            x: S.x + 6, y: S.y + 6, width: S.w - 12, height: S.h - 12, cornerRadius: 8,
            fillEnabled: false, stroke: '#2f4a60', strokeWidth: 1,
        }));
        this._label(g, S.x + 16, S.y + 8, '安全保护模块', 16, '#ffffff', true);
        this._label(g, S.x + 148, S.y + 12, 'SAFETY PROTECTION MODULE', 13, '#66b6f0');
        this._label(g, S.x + 470, S.y + 12, '停机链：停机继电器 → 电磁阀 → 断油', 12, '#86c5f8');

        const CARDS = [
            { title: '超速保护', en: 'OVERSPEED', sp: '定值 1725 r/min', color: '#e33b32' },
            { title: '滑油低压保护', en: 'LOW L.O. PRESS. (PT)', sp: '定值 1.5 bar', color: '#e6a417' },
            { title: '冷却水高温保护', en: 'HIGH COOLANT TEMP.', sp: '定值 95 ℃', color: '#2f8fe0' },
        ];
        SF.cards.forEach((c, i) => {
            const D = CARDS[i];
            g.add(new Konva.Rect({ x: c.x, y: c.y, width: c.w, height: c.h, cornerRadius: 6, fill: '#1b2c3b', stroke: '#3d5c74', strokeWidth: 1.2 }));
            g.add(new Konva.Rect({ x: c.x, y: c.y, width: 5, height: c.h, cornerRadius: 2, fill: D.color }));
            this._label(g, c.x + 12, c.y + 10, D.title, 15, '#ffffff', true);
            this._label(g, c.x + 12, c.y + 31, D.en, 10.5, '#9db9cd');
            this._label(g, c.x + 12, c.y + 49, D.sp, 12, '#ffd27a');
            this._label(g, c.x + 150, c.y + 15, '实测', 11.5, '#9db9cd');
            this._label(g, c.x + 244, c.y + 29, 'TRIP', 11.5, '#9db9cd', true, 'center', 34);
        });

        const CHAIN = [
            { box: SF.relay, en: 'Shutdown Relay', cn: '停机继电器' },
            { box: SF.solenoid, en: 'Stop Solenoid', cn: '停机电磁阀' },
            { box: SF.fuelCut, en: 'Fuel Shutoff', cn: '燃油切断' },
        ];
        CHAIN.forEach(c => {
            g.add(new Konva.Rect({
                x: c.box.x, y: c.box.y, width: c.box.w, height: c.box.h, cornerRadius: 7,
                fill: '#22405a', stroke: '#5d87a6', strokeWidth: 1.6,
            }));
            this._label(g, c.box.x, c.box.y + 11, c.cn, 15.5, '#ffffff', true, 'center', c.box.w);
            this._label(g, c.box.x, c.box.y + 32, c.en, 10.5, '#a9c6da', false, 'center', c.box.w);
        });

        g.add(new Konva.Rect({ x: SF.cmd.x, y: SF.cmd.y, width: SF.cmd.w, height: SF.cmd.h, cornerRadius: 4, fill: '#2a1a1a', stroke: '#7a3b36', strokeWidth: 1 }));
        this._label(g, SF.cmd.x, SF.cmd.y + 9, '停机指令', 16, '#ff8f86', true, 'center', SF.cmd.w);

        g.add(new Konva.Rect({ x: SF.stopBox.x, y: SF.stopBox.y, width: SF.stopBox.w, height: SF.stopBox.h, cornerRadius: 8, fill: '#19364f', stroke: '#0e263b', strokeWidth: 2 }));
        this._label(g, SF.stopBox.x + 42, SF.stopBox.y + 11, '柴油机停止', 16, '#ffffff', true, 'center', SF.stopBox.w - 54);
        this._label(g, SF.stopBox.x + 42, SF.stopBox.y + 34, 'ENGINE STOP', 11, '#dceaf4', false, 'center', SF.stopBox.w - 54);

        g.add(new Konva.Rect({
            x: SF.resetBtn.x, y: SF.resetBtn.y, width: SF.resetBtn.w, height: SF.resetBtn.h, cornerRadius: 5,
            fill: '#1e6fb8', stroke: '#0b2b45', strokeWidth: 1.4,
        }));
        this._label(g, SF.resetBtn.x, SF.resetBtn.y + 8, '保护复位 RESET', 13.5, '#ffffff', true, 'center', SF.resetBtn.w);
    }

    // ─────────────────────────────────────────────
    //  左下：滑油系统
    // ─────────────────────────────────────────────
    _drawLo(g) {
        const B = this._B.lo, L = this._lo;

        g.add(new Konva.Rect({ x: B.x, y: B.y, width: B.w, height: B.h, cornerRadius: 10, fill: '#fffdf5', stroke: '#c3ccd3', strokeWidth: 1.6 }));
        this._label(g, B.x + 12, B.y + 7, '滑油系统     L.O. SYSTEM', 15, '#8a5a00', true);

        // ── 管路 ──
        // ① 滤器 → 柴油机右侧入口（入口在右）
        this._pipe(g, [L.engine.x + L.engine.w, B.y + 30, L.filter.x, B.y + 30], COL.lo, 4);
        this._flowArrow(g, L.engine.x + L.engine.w + 22, B.y + 30, 180, 6, COL.lo);
        this._label(g, L.engine.x + L.engine.w + 4, B.y + 18, '入口', 9, '#8a5a00', true);
        // ①c 柴油机 → 滤器 管路中间向下引出压力变送器 PT
        this._pipe(g, [B.x + 395, B.y + 30, B.x + 395, B.y + 59], '#555555', 2);
        this._label(g, B.x + 365, B.y + 92, '滑油压力', 11.5, '#1b2a35', false, 'center', 60);
        // ①b 柴油机底部（出口）→ 向下、向左回滑油柜
        this._pipe(g, [L.engine.x + L.engine.w / 2, L.engine.y + L.engine.h, L.engine.x + L.engine.w / 2, B.y + 80,
            L.tank.x + L.tank.w, B.y + 80], COL.lo, 4);
        this._flowArrow(g, L.engine.x + L.engine.w / 2, L.engine.y + L.engine.h + 14, 90, 6, COL.lo);
        this._label(g, L.engine.x + L.engine.w / 2 + 6, L.engine.y + L.engine.h + 2, '出口', 9, '#8a5a00', true);
        // ② 滤器 → 三通阀（顶口）
        this._pipe(g, [L.filter.x + L.filter.w, B.y + 30, L.rv3.cx, B.y + 30, L.rv3.cx, L.rv3.cy - 18], COL.lo, 4);
        // ③ 三通阀（右口）→ 滑油冷却器
        this._pipe(g, [L.rv3.cx + 18, L.rv3.cy, L.cooler.x + L.cooler.w / 2, L.rv3.cy, L.cooler.x + L.cooler.w / 2, L.cooler.y - 10], COL.lo, 4);
        // ④ 三通阀（底口）→ 底部总管
        this._pipe(g, [L.rv3.cx, L.rv3.cy + 18, L.rv3.cx, B.y + 252], COL.lo, 4);
        // ⑤ 冷却器出口 → 底部总管
        this._pipe(g, [L.cooler.x + L.cooler.w / 2, L.cooler.y + L.cooler.h, L.cooler.x + L.cooler.w / 2, B.y + 252], COL.lo, 4);
        // ⑥ 底部总管（泵排出 → 三通阀 / 冷却器）
        this._pipe(g, [B.x + 330, B.y + 252, L.cooler.x + L.cooler.w / 2, B.y + 252], COL.lo, 4);
        // ⑦ 两泵排出总管（浅蓝）
        this._pipe(g, [B.x + 330, L.pumpAtt.cy, B.x + 330, B.y + 252], COL.ht, 4);
        this._pipe(g, [L.pumpAtt.cx + L.pumpAtt.r, L.pumpAtt.cy, B.x + 330, L.pumpAtt.cy], COL.ht, 4);
        this._pipe(g, [L.pumpPrim.cx + L.pumpPrim.r, L.pumpPrim.cy, B.x + 330, L.pumpPrim.cy], COL.ht, 4);
        // ⑧ 滑油柜 → 两泵吸入
        // 柜底 2/3 处 → 机带泵；柜底 1/3 处 → 预润滑泵
        this._pipe(g, [L.tank.x + L.tank.w * 2 / 3, L.tank.y + L.tank.h, L.tank.x + L.tank.w * 2 / 3, L.pumpAtt.cy, L.pumpAtt.cx - L.pumpAtt.r, L.pumpAtt.cy], COL.lo, 4);
        this._pipe(g, [L.tank.x + L.tank.w / 3, L.tank.y + L.tank.h, L.tank.x + L.tank.w / 3, L.pumpPrim.cy, L.pumpPrim.cx - L.pumpPrim.r, L.pumpPrim.cy], COL.lo, 4);

        // ── 滑油柜 ──
        g.add(new Konva.Rect({ x: L.tank.x, y: L.tank.y, width: L.tank.w, height: L.tank.h, cornerRadius: 4, fill: '#fdf6e3', stroke: '#8a5a00', strokeWidth: 2 }));
        g.add(new Konva.Rect({ x: L.tank.x - 14, y: L.tank.y, width: 12, height: L.tank.h, fill: '#ffffff', stroke: '#8a5a00', strokeWidth: 1.2 }));
        this._label(g, L.tank.x - 6, L.tank.y - 15, 'LO Sump Tank 滑油柜', 11.5, '#5d3d00', true, 'center', L.tank.w + 12);

        // ── 柴油机 ──
        g.add(new Konva.Rect({ x: L.engine.x, y: L.engine.y, width: L.engine.w, height: L.engine.h, cornerRadius: 6, fill: '#2a5fa8', stroke: '#173b6b', strokeWidth: 1.8 }));
        this._label(g, L.engine.x, L.engine.y + 10, '柴油机', 13.5, '#ffffff', true, 'center', L.engine.w);
        this._label(g, L.engine.x, L.engine.y + 28, 'ENGINE', 9, '#cfe0f2', false, 'center', L.engine.w);

        // ── 滤器（横向褶片式）──
        g.add(new Konva.Rect({ x: L.filter.x, y: L.filter.y, width: L.filter.w, height: L.filter.h, cornerRadius: 4, fill: '#f0c75e', stroke: '#8a5a00', strokeWidth: 1.6 }));
        for (let i = 1; i < 6; i++) {
            const lx = L.filter.x + L.filter.w * i / 6;
            g.add(new Konva.Line({ points: [lx, L.filter.y + 4, lx, L.filter.y + L.filter.h - 4], stroke: '#8a5a00', strokeWidth: 2 }));
        }
        g.add(new Konva.Rect({ x: L.filter.x - 6, y: L.filter.y + 10, width: 6, height: L.filter.h - 20, fill: '#c9a227', stroke: '#8a5a00', strokeWidth: 1 }));
        this._label(g, L.filter.x + 12, L.filter.y + L.filter.h + 3, '滤器', 12.5, '#5d3d00', true);

        // ── 三通阀（三片三角阀芯 + 左侧半圆执行器）──
        const V = L.rv3;
        const TA = 17, TB = 11;
        // 上口 ▽（顶点在中心）
        g.add(new Konva.Line({ points: [V.cx - TB, V.cy - TA, V.cx + TB, V.cy - TA, V.cx, V.cy], closed: true, fill: '#ffffff', stroke: '#1b2a35', strokeWidth: 2.2, lineJoin: 'round' }));
        // 下口 △（顶点在中心）
        g.add(new Konva.Line({ points: [V.cx, V.cy, V.cx - TB, V.cy + TA, V.cx + TB, V.cy + TA], closed: true, fill: '#ffffff', stroke: '#1b2a35', strokeWidth: 2.2, lineJoin: 'round' }));
        // 右口 ◁（顶点在中心）
        g.add(new Konva.Line({ points: [V.cx, V.cy, V.cx + TA, V.cy - TB, V.cx + TA, V.cy + TB], closed: true, fill: '#ffffff', stroke: '#1b2a35', strokeWidth: 2.2, lineJoin: 'round' }));
        // 执行器：竖挡板 + 半圆 + 连杆
        g.add(new Konva.Line({ points: [V.cx - 25, V.cy - 15, V.cx - 25, V.cy + 15], stroke: '#1b2a35', strokeWidth: 2.6 }));
        g.add(new Konva.Arc({ x: V.cx - 25, y: V.cy, innerRadius: 15, outerRadius: 15, angle: 180, rotation: 90, stroke: '#1b2a35', strokeWidth: 2.6 }));
        g.add(new Konva.Line({ points: [V.cx - 25, V.cy, V.cx, V.cy], stroke: '#1b2a35', strokeWidth: 2.2 }));
        this._label(g, V.cx - 82, V.cy - 10, '三通阀', 13, '#1b2a35', true);

        // ── 滑油冷却器（立式，低温淡水在壳侧）──
        const C = L.cooler;
        g.add(new Konva.Rect({ x: C.x, y: C.y, width: C.w, height: C.h, cornerRadius: 3, fill: '#eaf3fa', stroke: '#8a5a00', strokeWidth: 1.6 }));
        for (let i = 1; i <= 4; i++) {
            const lx = C.x + C.w * i / 5;
            g.add(new Konva.Line({ points: [lx, C.y + 10, lx, C.y + C.h - 10], stroke: '#3a8ee6', strokeWidth: 5 }));
        }
        g.add(new Konva.Rect({ x: C.x - 6, y: C.y - 10, width: C.w + 12, height: 14, cornerRadius: 3, fill: '#c9a227', stroke: '#8a5a00', strokeWidth: 1.4 }));
        g.add(new Konva.Rect({ x: C.x - 6, y: C.y + C.h - 4, width: C.w + 12, height: 14, cornerRadius: 3, fill: '#c9a227', stroke: '#8a5a00', strokeWidth: 1.4 }));
        // 低温淡水进出
        this._pipe(g, [C.x + C.w, C.y + 21, C.x + C.w + 30, C.y + 21], COL.lt, 4);
        this._pipe(g, [C.x + C.w, C.y + C.h - 21, C.x + C.w + 30, C.y + C.h - 21], COL.lt, 4);
        this._label(g, C.x + C.w + 16, C.y + 2, '低温淡水入口', 12, '#0d47a1', true);
        this._label(g, C.x + C.w / 2 - 8, C.y + C.h + 16, '滑油冷却器', 13, '#5d3d00', true, 'center', 88);

        // ── 泵 ──
        this._pumpBase(g, L.pumpAtt.cx, L.pumpAtt.cy, L.pumpAtt.r, 'coupling');
        this._pumpBase(g, L.pumpPrim.cx, L.pumpPrim.cy, L.pumpPrim.r, 'motor');
        this._label(g, L.pumpAtt.cx - 68, L.pumpAtt.cy - L.pumpAtt.r - 36, '机带泵', 12.5, '#5d3d00', true, 'center', 140);
        this._label(g, L.pumpPrim.cx - 64, L.pumpPrim.cy + L.pumpPrim.r + 5, '预润滑泵', 12.5, '#5d3d00', true, 'center', 140);

        // ── 预润滑泵控制面板（指示灯 + 圆形起停按钮 + 手自动旋钮）──
        const PP = L.primPanel;
        g.add(new Konva.Rect({ x: PP.x, y: PP.y, width: PP.w, height: PP.h, cornerRadius: 4, fill: '#eef1f3', stroke: '#6d767d', strokeWidth: 1.6 }));
        // START / STOP 圆形按钮（金属环）
        const mkRoundBtn = (cx, cy, color) => {
            g.add(new Konva.Circle({
                x: cx, y: cy, radius: 22,
                fillLinearGradientStartPoint: { x: cx - 22, y: cy - 22 },
                fillLinearGradientEndPoint: { x: cx + 22, y: cy + 22 },
                fillLinearGradientColorStops: [0, '#f4f6f7', 0.5, '#bcc3c8', 1, '#8d959b'],
                stroke: '#5a6670', strokeWidth: 1.2,
            }));
            g.add(new Konva.Circle({ x: cx, y: cy, radius: 17, fill: color, stroke: '#2b3033', strokeWidth: 1.2 }));
        };
        mkRoundBtn(PP.x + 37, PP.y + 56, '#1b7a24');
        this._label(g, PP.x + 15, PP.y + 82, 'START', 12, '#1b2a35', true, 'center', 40);
        mkRoundBtn(PP.x + 101, PP.y + 56, '#a01c1c');
        this._label(g, PP.x + 84, PP.y + 82, 'STOP', 12, '#1b2a35', true, 'center', 40);
        // MAN. AUT. + 居中大旋钮
        this._label(g, PP.x + 150, PP.y +16, 'MAN   AUT', 12, '#1b2a35', true);
        this._drawKnobBase(g, PP.x + 184, PP.y + 54, 26);

        // 参数标签（柜温 / 柜位）
        this._label(g, L.tank.x + 6, L.tank.y + 8, 'T', 10, '#c62828', true);
        this._label(g, L.tank.x + 6, L.tank.y + 40, 'L', 10, '#1b5e20', true);
    }

    // ─────────────────────────────────────────────
    //  右下：高温淡水冷却系统
    // ─────────────────────────────────────────────
    _drawHt(g) {
        const B = this._B.ht, H = this._ht;

        g.add(new Konva.Rect({ x: B.x, y: B.y, width: B.w, height: B.h, cornerRadius: 10, fill: '#f7fbfd', stroke: '#c3ccd3', strokeWidth: 1.6 }));
        this._label(g, B.x + 12, B.y + 7, '高温淡水冷却系统  HTFW COOLING', 13, '#0b3d91', true);

        // 柴油机
        g.add(new Konva.Rect({ x: H.eng.x, y: H.eng.y, width: H.eng.w, height: H.eng.h, cornerRadius: 6, fill: '#2a5fa8', stroke: '#173b6b', strokeWidth: 1.8 }));
        this._label(g, H.eng.x, H.eng.y + 42, '柴油机', 12, '#ffffff', true, 'center', H.eng.w);
        this._label(g, H.eng.x, H.eng.y + 60, 'ENGINE', 9, '#cfe0f2', false, 'center', H.eng.w);

        const C = H.cooler, V = H.rv3, P = H.pump;

        // ── 管路 ──
        // ① 出口 → 温度传感器 → 分支点
        this._pipe(g, [H.eng.x + H.eng.w, H.tt.cy, H.tt.cx - 17, H.tt.cy], COL.ht, 4);
        this._flowArrow(g, H.eng.x + H.eng.w + 22, H.tt.cy, 0, 6, '#1b7fb5');
        this._label(g, H.eng.x + H.eng.w + 4, H.tt.cy - 22, '出口', 9, '#0b3d91', true);
        this._pipe(g, [H.tt.cx + 17, H.tt.cy, B.x + 300, H.tt.cy], COL.ht, 4);
        // ② 冷却器支路：横向直接进入冷却器左端
        this._pipe(g, [B.x + 300, H.tt.cy, C.x - 10, H.tt.cy], COL.ht, 4);
        // ③ 冷却器右端 → 三通阀顶口
        this._pipe(g, [C.x + C.w + 10, H.tt.cy, V.cx, H.tt.cy, V.cx, V.cy - 18], COL.ht, 4);
        // ④ 旁通支路
        this._pipe(g, [B.x + 320, H.tt.cy, B.x + 320, B.y + 200, V.cx, B.y + 200, V.cx, V.cy + 18], COL.ht, 4);
        // ⑤ 三通阀出口：向右 → 向下 → 向左 → 机带泵 → 向左 → 向上 → 柴油机入口
        this._pipe(g, [V.cx + 18, V.cy, B.x + 660, V.cy, B.x + 660, B.y + 230, P.cx + P.r, B.y + 230], COL.ht, 4);
        this._pipe(g, [P.cx - P.r, B.y + 230, B.x + 170, B.y + 230, B.x + 170, B.y + 146, H.eng.x + H.eng.w, B.y + 146], COL.ht, 4);
        this._flowArrow(g, B.x + 150, B.y + 146, 180, 6, '#1b7fb5');
        this._label(g, B.x + 138, B.y + 130, '入口', 9, '#0b3d91', true);

        // 温度传感器（柴油机出口）

        this._label(g, H.tt.cx - 28, H.tt.cy + 23, '出口温度', 12.5, '#1b2a35', false, 'center', 56);

        // 高温淡水冷却器（水平放置：左右棕色管箱、蓝色管束，低温淡水接口朝上）
        g.add(new Konva.Rect({ x: C.x, y: C.y, width: C.w, height: C.h, cornerRadius: 3, fill: '#eaf3fa', stroke: '#8a5a00', strokeWidth: 1.6 }));
        for (let i = 1; i <= 4; i++) {
            const ly = C.y + C.h * i / 5;
            g.add(new Konva.Line({ points: [C.x + 10, ly, C.x + C.w - 10, ly], stroke: '#3a8ee6', strokeWidth: 5 }));
        }
        g.add(new Konva.Rect({ x: C.x - 10, y: C.y - 6, width: 14, height: C.h + 12, cornerRadius: 3, fill: '#c9a227', stroke: '#8a5a00', strokeWidth: 1.4 }));
        g.add(new Konva.Rect({ x: C.x + C.w - 4, y: C.y - 6, width: 14, height: C.h + 12, cornerRadius: 3, fill: '#c9a227', stroke: '#8a5a00', strokeWidth: 1.4 }));
        this._pipe(g, [C.x + 21, C.y - 6, C.x + 21, C.y - 30], COL.lt, 4);
        this._pipe(g, [C.x + C.w - 21, C.y - 6, C.x + C.w - 21, C.y - 30], COL.lt, 4);
        this._label(g, C.x + C.w / 2 - 42, C.y - 48, '低温淡水入口', 10, '#0d47a1', true, 'center', 84);
        this._label(g, C.x + C.w / 2 - 54, C.y + C.h + 14, '高温淡水冷却器', 14, '#1b2a35', true, 'center', 108);

        // 三通阀（与滑油系统同款：三片三角阀芯 + 左侧半圆执行器）
        const TA = 17, TB = 11;
        g.add(new Konva.Line({ points: [V.cx - TB, V.cy - TA, V.cx + TB, V.cy - TA, V.cx, V.cy], closed: true, fill: '#ffffff', stroke: '#1b2a35', strokeWidth: 2.2, lineJoin: 'round' }));
        g.add(new Konva.Line({ points: [V.cx, V.cy, V.cx - TB, V.cy + TA, V.cx + TB, V.cy + TA], closed: true, fill: '#ffffff', stroke: '#1b2a35', strokeWidth: 2.2, lineJoin: 'round' }));
        g.add(new Konva.Line({ points: [V.cx, V.cy, V.cx + TA, V.cy - TB, V.cx + TA, V.cy + TB], closed: true, fill: '#ffffff', stroke: '#1b2a35', strokeWidth: 2.2, lineJoin: 'round' }));
        g.add(new Konva.Line({ points: [V.cx - 25, V.cy - 15, V.cx - 25, V.cy + 15], stroke: '#1b2a35', strokeWidth: 2.6 }));
        g.add(new Konva.Arc({ x: V.cx - 25, y: V.cy, innerRadius: 15, outerRadius: 15, angle: 180, rotation: 90, stroke: '#1b2a35', strokeWidth: 2.6 }));
        g.add(new Konva.Line({ points: [V.cx - 25, V.cy, V.cx, V.cy], stroke: '#1b2a35', strokeWidth: 2.2 }));
        this._label(g, V.cx - 64, V.cy - 36, '三通阀', 14, '#1b2a35', true);

        // 机带泵（与滑油机带泵同款：泵壳 + 顶部联轴器符号）
        this._pumpBase(g, P.cx, P.cy, P.r, 'coupling');
        this._label(g, P.cx - 32, P.cy + P.r + 5, '机带泵', 13, '#1b2a35', true, 'center', 64);
    }

    // ═══════════════════════════════════════════════════════════
    //  动态节点
    // ═══════════════════════════════════════════════════════════
    _createDynamicNodes() {
        const d = this._dynamicGroup;
        const PN = this._panel, SF = this._safety, G = this._genset;
        const H = this._ht, L = this._lo, TB = this._tools;

        // ── 阀门 ──
        this._valves = {};
        this._valveDefs.forEach(v => {
            this._valves[v.key] = this._gateValve(d, v.x, v.y, v.ang);
        });

        // ── 泵叶轮 ──
        this._pumps = {};
        const mkFan = (key, cx, cy, r) => {
            const face = new Konva.Circle({ x: cx, y: cy, radius: r - 1, fill: '#f4f6f7' });
            d.add(face);
            const fan = new Konva.Group({ x: cx, y: cy, rotation: 0 });
            const R = r * 0.7;
            for (let i = 0; i < 3; i++) {
                const a = (i * 120 - 90) * Math.PI / 180;
                const tip = [Math.cos(a) * R, Math.sin(a) * R];
                const c1 = a - 0.62, c2 = a + 0.52;
                const p1 = [Math.cos(c1) * R * 0.55, Math.sin(c1) * R * 0.55];
                const p2 = [Math.cos(c2) * R * 0.64, Math.sin(c2) * R * 0.64];
                fan.add(new Konva.Path({
                    data: `M 0 0 Q ${p1[0].toFixed(1)} ${p1[1].toFixed(1)} ${tip[0].toFixed(1)} ${tip[1].toFixed(1)} Q ${p2[0].toFixed(1)} ${p2[1].toFixed(1)} 0 0 Z`,
                    fill: '#9aa4a9', stroke: '#6b757a', strokeWidth: 0.8, lineJoin: 'round',
                }));
            }
            fan.add(new Konva.Circle({ x: 0, y: 0, radius: r * 0.16, fill: '#6b757a' }));
            d.add(fan);
            this._pumps[key] = { face, fan };
        };
        mkFan('htP', H.pump.cx, H.pump.cy, H.pump.r);
        mkFan('loAtt', L.pumpAtt.cx, L.pumpAtt.cy, L.pumpAtt.r);
        mkFan('loPrim', L.pumpPrim.cx, L.pumpPrim.cy, L.pumpPrim.r);

        // ── 三通调温阀阀芯 ──

        // ── 面板灯 ──
        this._lampDots = {};
        PN.lamps.forEach(Ld => {
            const dot = new Konva.Circle({
                x: Ld.x + 12, y: Ld.y + 18, radius: 6,
                fill: Ld.kind === 'red' ? '#5a1a16' : '#14521a',
                stroke: '#0b0f12', strokeWidth: 1,
            });
            d.add(dot);
            this._lampDots[Ld.id] = dot;
        });
        {
            const KB = PN.knob, R = KB.r;
            const handle = new Konva.Group({ x: KB.cx, y: KB.cy, rotation: -90 });
            handle.add(new Konva.Rect({
                x: -4, y: -(R - 6), width: 8, height: (R - 6) * 2, cornerRadius: 4,
                fill: 'rgba(0,0,0,0)', stroke: '#ffffff', strokeWidth: 2,
            }));
            handle.add(new Konva.Rect({ x: -2, y: -(R - 12), width: 4, height: 10, cornerRadius: 1, fill: '#ffffff' }));
            d.add(handle);
            this._modeKnob = handle;
        }
        {
            const K = G.loadKnob, R = K.r;
            const h = new Konva.Group({ x: K.cx, y: K.cy, rotation: -135 });
            h.add(new Konva.Rect({
                x: -3.5, y: -(R - 5), width: 7, height: (R - 5) * 2, cornerRadius: 3.5,
                fill: 'rgba(0,0,0,0)', stroke: '#ffffff', strokeWidth: 2,
            }));
            h.add(new Konva.Rect({ x: -2, y: -(R - 9), width: 4, height: 9, cornerRadius: 1, fill: '#ffffff' }));
            d.add(h);
            this._loadKnob = h;
            this._loadVal = new Konva.Text({
                x: K.cx + R + 10, y: K.cy - 8, width: 84, align: 'left', text: '50 %',
                fontSize: 16, fontStyle: 'bold', fill: '#ffe14d', fontFamily: FONT,
            });
            d.add(this._loadVal);
        }
        {
            const TG = G.turning;
            const h = new Konva.Group({ x: TG.x + TG.w - 60, y: TG.y + 36, rotation: 45 });
            h.add(new Konva.Rect({ x: -3, y: -16, width: 6, height: 32, cornerRadius: 3, fill: 'rgba(0,0,0,0)', stroke: '#ffffff', strokeWidth: 1.8 }));
            h.add(new Konva.Rect({ x: -2, y: -15, width: 4, height: 8, cornerRadius: 1, fill: '#ffffff' }));
            d.add(h);
            this._tgKnob = h;
        }
        {
            const BH = G.block;
            const h = new Konva.Group({ x: BH.x + BH.w - 60, y: BH.y + 36, rotation: -45 });
            h.add(new Konva.Rect({ x: -3, y: -16, width: 6, height: 32, cornerRadius: 3, fill: 'rgba(0,0,0,0)', stroke: '#ffffff', strokeWidth: 1.8 }));
            h.add(new Konva.Rect({ x: -2, y: -15, width: 4, height: 8, cornerRadius: 1, fill: '#ffffff' }));
            d.add(h);
            this._bhKnob = h;
        }

        // ── 安全保护卡片：实测值 / 跳闸灯 ──
        this._protVal = [];
        this._protLamp = [];
        SF.cards.forEach(c => {
            const val = new Konva.Text({
                x: c.x + 159, y: c.y + 33, width: 110, align: 'left', text: '--',
                fontSize: 17, fontStyle: 'bold', fill: '#00e83c', fontFamily: FONT,
            });
            d.add(val);
            this._protVal.push(val);
            const lamp = new Konva.Circle({ x: c.x + 292, y: c.y + 39, radius: 9, fill: '#5a1a16', stroke: '#0b0f12', strokeWidth: 1.2 });
            d.add(lamp);
            this._protLamp.push(lamp);
        });

        // ── 停机链箭头 + 状态灯 ──
        this._chainArrows = [];
        const mkArrow = (x1, x2, y) => {
            const ln = new Konva.Line({ points: [x1, y, x2, y], stroke: '#4a5c6b', strokeWidth: 5, lineCap: 'round' });
            const tri = new Konva.Line({ points: [x2 - 9, y - 6, x2 + 2, y, x2 - 9, y + 6], closed: true, fill: '#4a5c6b' });
            d.add(ln, tri);
            this._chainArrows.push({ ln, tri });
        };
        mkArrow(SF.relay.x + SF.relay.w, SF.solenoid.x - 2, SF.relay.y + SF.relay.h / 2);
        mkArrow(SF.solenoid.x + SF.solenoid.w, SF.fuelCut.x - 2, SF.solenoid.y + SF.solenoid.h / 2);
        // 燃油切断 → 柴油机停止（向下）
        this._chainArrows.push((() => {
            const x0 = SF.fuelCut.x + SF.fuelCut.w / 2;
            const ln = new Konva.Line({
                points: [x0, SF.fuelCut.y + SF.fuelCut.h, x0, SF.stopBox.y + 10],
                stroke: '#4a5c6b', strokeWidth: 5, lineJoin: 'round',
            });
            const tri = new Konva.Line({
                points: [x0 - 6, SF.stopBox.y + 12, x0, SF.stopBox.y + 1, x0 + 6, SF.stopBox.y + 12],
                closed: true, fill: '#4a5c6b',
            });
            d.add(ln, tri);
            return { ln, tri };
        })());

        // 保护卡片 → 停机命令灯 → 继电器
        const CMD_MY = SF.cmd.y + SF.cmd.h / 2;
        this._cmdLine = new Konva.Line({
            points: [SF.cards[0].x + SF.cards[0].w, CMD_MY, SF.cmd.x - 12, CMD_MY],
            stroke: '#4a5c6b', strokeWidth: 5, lineCap: 'round',
        });
        this._cmdTri = new Konva.Line({
            points: [SF.cmd.x - 14, CMD_MY - 6, SF.cmd.x - 2, CMD_MY, SF.cmd.x - 14, CMD_MY + 6],
            closed: true, fill: '#4a5c6b',
        });
        d.add(this._cmdLine, this._cmdTri);
        const CMD_MX = SF.cmd.x + SF.cmd.w / 2;
        this._cmdLine2 = new Konva.Line({
            points: [CMD_MX, SF.cmd.y, CMD_MX, SF.relay.y + SF.relay.h + 14],
            stroke: '#4a5c6b', strokeWidth: 5, lineCap: 'round',
        });
        this._cmdTri2 = new Konva.Line({
            points: [CMD_MX - 6, SF.relay.y + SF.relay.h + 14, CMD_MX, SF.relay.y + SF.relay.h + 2, CMD_MX + 6, SF.relay.y + SF.relay.h + 14],
            closed: true, fill: '#4a5c6b',
        });
        d.add(this._cmdLine2, this._cmdTri2);

        this._cmdLamp = new Konva.Circle({ x: SF.cmd.x + 12, y: SF.cmd.y + 16, radius: 6, fill: '#5a1a16', stroke: '#0b0f12', strokeWidth: 1 });
        d.add(this._cmdLamp);
        this._stopLamp = new Konva.Circle({ x: SF.stopBox.x + 22, y: SF.stopBox.y + SF.stopBox.h / 2, radius: 11, fill: '#5a1a16', stroke: '#ffffff', strokeWidth: 1.6 });
        d.add(this._stopLamp);

        // ── 机组转动件 ──
        {
            const fw = G.flywheel;
            this._flywheel = new Konva.Group({ x: fw.cx, y: fw.cy });
            for (let i = 0; i < 6; i++) {
                const a = i * 60 * Math.PI / 180;
                this._flywheel.add(new Konva.Line({
                    points: [Math.cos(a) * fw.r * 0.25, Math.sin(a) * fw.r * 0.25, Math.cos(a) * fw.r * 0.92, Math.sin(a) * fw.r * 0.92],
                    stroke: '#8b98a2', strokeWidth: 3.5, lineCap: 'round',
                }));
            }
            d.add(this._flywheel);
        }
        {
            // 转子：两对磁极（N 红 / S 黑），随主机转动
            const gn = G.gen;
            this._rotor = new Konva.Group({ x: gn.cx, y: gn.cy });
            const R = gn.r - 18;
            for (let i = 0; i < 4; i++) {
                const isN = i % 2 === 0;
                const pg = new Konva.Group({ x: 0, y: 0, rotation: i * 90 });
                pg.add(new Konva.Line({ points: [0, 0, 0, -R + 10], stroke: '#7b8792', strokeWidth: 9, lineCap: 'round' }));
                pg.add(new Konva.Rect({
                    x: -6.5, y: -R, width: 13, height: 26, cornerRadius: 3,
                    fill: isN ? '#e33b32' : '#1b1b1b', stroke: isN ? '#8e1b16' : '#000000', strokeWidth: 1.2,
                }));
                pg.add(new Konva.Text({
                    x: -6.5, y: -R + 6, width: 13, align: 'center',
                    text: isN ? 'N' : 'S', fontSize: 10, fontStyle: 'bold',
                    fill: '#ffffff', fontFamily: FONT,
                }));
                this._rotor.add(pg);
            }
            this._rotor.add(new Konva.Circle({ x: 0, y: 0, radius: 9, fill: '#8fa0ad', stroke: '#4a5560', strokeWidth: 1.2 }));
            d.add(this._rotor);
        }
        this._flames = [];
        for (let i = 0; i < 8; i++) {
            const cx = G.engine.x + 61 + Math.floor(i / 2) * 92 + (i % 2 === 0 ? -16 : 16);
            const fg = new Konva.Group({ x: cx, y: G.engine.y + 96, visible: false });
            fg.add(new Konva.Line({
                points: [0, 0, -6.4, -6.4, -4.5, -12.6, 0, -17.5, 4.5, -12.6, 6.4, -6.4],
                closed: true, fill: '#ff7a00', stroke: '#c94200', strokeWidth: 0.6, lineJoin: 'round',
            }));
            fg.add(new Konva.Line({ points: [0, -2.8, -3.4, -7.6, 0, -12, 3.4, -7.6], closed: true, fill: '#ffd93b' }));
            d.add(fg);
            this._flames.push(fg);
        }

        // ── 参数数值（动态文本）──
        this._tags = {};
        const B_ht = this._B.ht, B_lo = this._B.lo;
        this._tags.htTemp = this._tagValue(this._ht.tt.cx - 30, this._ht.tt.cy - 44, 15, '#c62828');

        this._tags.loSumpT = this._tagValue(L.tank.x + 22, L.tank.y + 8, 12, '#8a5a00');
        this._tags.loSumpL = this._tagValue(L.tank.x + 22, L.tank.y + 40, 12, '#8a5a00');

        this._tags.speed = this._tagValue(G.skid.x + 452, G.skid.y + 5, 12, '#0b3d91');
        // 电压 / 频率 / 功率：显示在发电机右侧（自上而下）
        this._tags.genU = this._tagValue(G.gen.cx + G.gen.r + 4, G.gen.cy - 26, 13, '#1b2a35');
        this._tags.genF = this._tagValue(G.gen.cx + G.gen.r + 4, G.gen.cy - 2, 13, '#1b2a35');
        this._tags.genP = this._tagValue(G.gen.cx + G.gen.r + 4, G.gen.cy + 22, 13, '#1b2a35');
        this._tags.engineState = this._tagValue(G.engine.x + 12, G.engine.y + G.engine.h - 22, 11, '#ffffff');

        // 起动空气系统
        const AB = G.airBottle, AC = G.airComp, AV = G.airValve;
        this._airP = this._tagValue(AB.x + 5, AB.y + 44, 9.5, '#0b3d91');
        this._airCompLed = new Konva.Circle({ x: AC.x + 50, y: AC.y + AC.h / 2, radius: 4, fill: '#5a1a16', stroke: '#0b0f12', strokeWidth: 1 });
        d.add(this._airCompLed);
        this._airValveLed = new Konva.Circle({ x: AV.cx, y: AV.cy - 14, radius: 3.5, fill: '#39434d', stroke: '#0b0f12', strokeWidth: 1 });
        d.add(this._airValveLed);

        // ── 工具箱：接入按钮 / 指示灯 / 数值 / 状态 ──
        this._toolBtns = [];
        this._toolLeds = [];
        this._toolVals = [];
        this._toolSubs = [];
        TB.cards.forEach(c => {
            const btn = new Konva.Rect({
                x: c.x + 6, y: c.y + 150, width: 72, height: 24, cornerRadius: 4,
                fill: '#1e6fb8', stroke: '#0b2b45', strokeWidth: 1.2,
            });
            d.add(btn);
            this._toolBtns.push(btn);
            const led = new Konva.Circle({ x: c.x + 164, y: c.y + 42, radius: 5, fill: '#5a1a16', stroke: '#0b0f12', strokeWidth: 1 });
            d.add(led);
            this._toolLeds.push(led);
            this._toolVals.push(this._tagValue(c.x + 12, c.y + 108, 15.5, '#0b3d91'));
            this._toolSubs.push(this._tagValue(c.x + 12, c.y + 131, 14.5, '#5a6b78'));
        });
        // 手压泵表针
        {
            const c0 = TB.cards[0];
            this._pumpNeedle = new Konva.Group({ x: c0.x + 106, y: c0.y + 67, rotation: -135 });
            this._pumpNeedle.add(new Konva.Line({ points: [0, 0, 0, -12], stroke: '#c62828', strokeWidth: 2, lineCap: 'round' }));
            d.add(this._pumpNeedle);
        }

        // 磁电式转速传感器（转速 > 500 r/min 时绿色填充）
        {
            this._spdSensor = new Konva.Rect({
                x: G.sensor.cx - G.sensor.w / 2, y: G.sensor.cy - G.sensor.h / 2,
                width: G.sensor.w, height: G.sensor.h, cornerRadius: 4,
                fill: '#9fb0bd', stroke: '#4a5560', strokeWidth: 1.4,
            });
            d.add(this._spdSensor);
        }

        // 滑油压力变送器 PT（颜色随压力）
        {
            const B_lo = this._B.lo;
            this._ptCircle = new Konva.Circle({ x: B_lo.x + 395, y: B_lo.y + 73, radius: 14, fill: '#e33b32', stroke: '#555555', strokeWidth: 1.8 });
            this._ptText = new Konva.Text({ x: B_lo.x + 381, y: B_lo.y + 66, width: 28, align: 'center', text: 'PT', fontSize: 12, fontStyle: 'bold', fill: '#ffffff', fontFamily: FONT });
            d.add(this._ptCircle, this._ptText);
        }
        // 高温淡水出口温度传感器 TT（颜色随温度）
        {
            this._ttCircle = new Konva.Circle({ x: H.tt.cx, y: H.tt.cy, radius: 17, fill: '#2ecc40', stroke: '#555555', strokeWidth: 1.8 });
            this._ttText = new Konva.Text({ x: H.tt.cx - 17, y: H.tt.cy - 8, width: 34, align: 'center', text: 'TT', fontSize: 13, fontStyle: 'bold', fill: '#ffffff', fontFamily: FONT });
            d.add(this._ttCircle, this._ttText);
        }

        // 预润滑泵控制面板：指示灯 + 转换旋钮
        {
            const PP = L.primPanel;
            this._primRun = new Konva.Rect({ x: PP.x + 4, y: PP.y + 4, width: 66, height: 26, fill: '#1b4a1e', stroke: '#0b1f0c', strokeWidth: 1.2 });
            this._primPwr = new Konva.Rect({ x: PP.x + 70, y: PP.y + 4, width: 62, height: 26, fill: '#14521a', stroke: '#0b1f0c', strokeWidth: 1.2 });
            this._primRunTxt = new Konva.Text({ x: PP.x + 4, y: PP.y + 9, width: 66, align: 'center', text: 'RUNNING', fontSize: 12, fontStyle: 'bold', fill: '#9be3a4', fontFamily: FONT });
            this._primPwrTxt = new Konva.Text({ x: PP.x + 70, y: PP.y + 8, width: 62, align: 'center', text: 'POWER', fontSize: 11, fontStyle: 'bold', fill: '#1b2a35', fontFamily: FONT });
            d.add(this._primRun, this._primPwr, this._primRunTxt, this._primPwrTxt);
            const kx = PP.x + 184, ky = PP.y + 54, R = 26;
            const h = new Konva.Group({ x: kx, y: ky, rotation: -45 });
            h.add(new Konva.Rect({ x: -4, y: -(R - 6), width: 8, height: (R - 6) * 2, cornerRadius: 4, fill: 'rgba(0,0,0,0)', stroke: '#ffffff', strokeWidth: 2 }));
            h.add(new Konva.Rect({ x: -2, y: -(R - 12), width: 4, height: 11, cornerRadius: 1, fill: '#ffffff' }));
            d.add(h);
            this._primKnob = h;
        }

        // 滑油柜液位
        this._sumpLvl = new Konva.Rect({ x: L.tank.x + 3, y: L.tank.y + 4, width: L.tank.w - 6, height: L.tank.h - 8, fill: '#e8c96a', opacity: 0.9 });
        d.add(this._sumpLvl);
        this._sumpLvl.moveToBottom();
        this._sumpGlass = new Konva.Rect({ x: L.tank.x - 12, y: L.tank.y + 4, width: 8, height: L.tank.h - 8, fill: '#e8c96a' });
        d.add(this._sumpGlass);
    }

    // ═══════════════════════════════════════════════════════════
    //  交互
    // ═══════════════════════════════════════════════════════════
    _bindInteraction() {
        const s = this;
        const clearBg = (hit) => {
            try {
                const bg = hit.getParent().getChildren()[0];
                if (bg && bg.fill) bg.fill('rgba(0,0,0,0)');
            } catch (e) { /* ignore */ }
        };
        const add = (id, x, y, w, h, fn) => {
            const hit = this.addClickablePart(id, x, y, w, h, true);
            hit.on('click tap', () => { if (fn) fn(); s._syncVisuals(); });
            clearBg(hit);
            return hit;
        };
        const sv = () => s._solver();

        const PN = this._panel, SF = this._safety, G = this._genset, H = this._ht, L = this._lo, TB = this._tools;

        // ── 机旁面板 ──
        PN.buttons.forEach(Bt => {
            add(Bt.id, Bt.x, Bt.y, Bt.w, Bt.h, () => {
                const v = sv();
                if (Bt.id === 'eng-start') { if (v) v.startEngine(); return; }
                if (Bt.id === 'eng-stop') { if (v) v.stopEngine(); return; }
                if (Bt.id === 'emu-stop') { if (v) v.emergencyStop(); return; }
                if (Bt.id === 'reset') { if (!v) return; v.resetTrips(); v.ackAlarms(); return; }
                if (Bt.id === 'lamp-test') { if (v) v.lampTest(); }
            });
        });
        PN.lamps.forEach(Ld => add(Ld.id, Ld.x, Ld.y, Ld.w, Ld.h, () => s._tipLamp(Ld.id)));

        const KB = PN.knob;
        add('mode-knob', KB.cx - KB.r, KB.cy - KB.r, KB.r * 2, KB.r * 2, () => { if (sv()) sv().cycleMode(1); });
        add('mode-knob-ccw', KB.cx - KB.r, KB.cy - KB.r, KB.r, KB.r * 2, () => { if (sv()) sv().cycleMode(-1); });

        // ── 安保测试工具箱 ──
        TB.cards.forEach(c => {
            const key = c.id;
            add('tool-' + key, c.x + 6, c.y + 30, c.w - 12, 96, () => s._tipTool(key));
            add('tb-' + key + '-on', c.x + 6, c.y + 150, 72, 24, () => {
                const v = sv(); if (!v) return;
                const t = v.m.test;
                const cur = key === 'pump' ? t.pumpOn : key === 'freq' ? t.freqOn : key === 'res' ? t.resOn : t.ovenOn;
                if (key === 'pump') v.setTestPump(!cur);
                else if (key === 'freq') v.setTestFreq(!cur);
                else if (key === 'res') v.setTestRes(!cur);
                else v.setTestOven(!cur);
            });
            add('tb-' + key + '-dec', c.x + 84, c.y + 150, 40, 24, () => {
                const v = sv(); if (!v) return;
                if (key === 'pump') v.stepTestPump(-1);
                else if (key === 'freq') v.stepTestFreq(-1);
                else if (key === 'res') v.stepTestRes(-1);
                else v.stepTestOven(-1);
            });
            add('tb-' + key + '-inc', c.x + 128, c.y + 150, 40, 24, () => {
                const v = sv(); if (!v) return;
                if (key === 'pump') v.stepTestPump(1);
                else if (key === 'freq') v.stepTestFreq(1);
                else if (key === 'res') v.stepTestRes(1);
                else v.stepTestOven(1);
            });
        });

        // ── 安全保护模块 ──
        SF.cards.forEach((c, i) => {
            const ids = ['prot-overspeed', 'prot-lo-press', 'prot-ht-temp'];
            add(ids[i], c.x, c.y, c.w, c.h, () => s._tipProtection(i));
        });
        add('shutdown-relay', SF.relay.x, SF.relay.y, SF.relay.w, SF.relay.h, () => s._tipPart('shutdown-relay'));
        add('stop-solenoid', SF.solenoid.x, SF.solenoid.y, SF.solenoid.w, SF.solenoid.h, () => s._tipPart('stop-solenoid'));
        add('fuel-rack', SF.fuelCut.x, SF.fuelCut.y, SF.fuelCut.w, SF.fuelCut.h, () => s._tipPart('fuel-rack'));
        add('shutdown-reset', SF.resetBtn.x, SF.resetBtn.y, SF.resetBtn.w, SF.resetBtn.h, () => {
            const v = sv();
            if (v) { v.resetTrips(); v.ackAlarms(); }
        });

        // ── 机组 ──
        add('engine', G.engine.x, G.engine.y, G.engine.w, G.engine.h, () => s._tipPart('engine'));
        add('generator', G.gen.cx - G.gen.r, G.gen.cy - G.gen.r, G.gen.r * 2, G.gen.r * 2, () => s._tipPart('generator'));
        add('turning-gear', G.turning.x, G.turning.y, G.turning.w, G.turning.h, () => { if (sv()) sv().toggleTurningGear(); });
        add('block-handle', G.block.x, G.block.y, G.block.w, G.block.h, () => { if (sv()) sv().toggleBlockHandle(); });
        add('speed-sensor', G.sensor.cx - 30, G.sensor.cy - 24, 60, 48, () => s._tipPart('speed-sensor'));
        add('turbo', G.turbo.cx - G.turbo.r, G.turbo.cy - G.turbo.r, G.turbo.r * 2, G.turbo.r * 2, () => s._tipPart('turbo'));
        // 起动空气系统
        add('air-bottle', G.airBottle.x, G.airBottle.y - 8, G.airBottle.w, G.airBottle.h + 14, () => s._tipPart('air-bottle'));
        add('air-compressor', G.airComp.x, G.airComp.y, G.airComp.w, G.airComp.h, () => { if (sv()) sv().toggleAirComp(); });
        add('start-air-valve', G.airValve.cx - 14, G.airValve.cy - 20, 28, 34, () => s._tipPart('start-air-valve'));

        // 负荷调节旋钮（左半区 −5 %，右半区 +5 %）
        // 必须在 engine 等大热区之后登记（onTop 会移到交互层最上），否则被发动机热区吞掉点击
        {
            const K = G.loadKnob;
            add('load-knob-dec', K.cx - K.r, K.cy - K.r, K.r, K.r * 2, () => { if (sv()) sv().stepLoad(-1); });
            add('load-knob-inc', K.cx, K.cy - K.r, K.r, K.r * 2, () => { if (sv()) sv().stepLoad(1); });
        }

        // ── 滑油 ──
        add('lo-sump', L.tank.x, L.tank.y, L.tank.w, L.tank.h, () => s._tipPart('lo-sump'));
        {
            const B_lo = this._B.lo;
            add('pt-lo', B_lo.x + 381, B_lo.y + 59, 28, 28, () => s._tipPart('pt-lo'));
        }
        add('lo-filter', L.filter.x, L.filter.y, L.filter.w, L.filter.h, () => s._tipPart('lo-filter'));
        add('lo-cooler', L.cooler.x, L.cooler.y, L.cooler.w, L.cooler.h, () => s._tipPart('lo-cooler'));
        add('rv-lo', L.rv3.cx - 18, L.rv3.cy - 18, 36, 36, () => s._tipPart('rv-lo'));
        add('lo-att-pump', L.pumpAtt.cx - L.pumpAtt.r, L.pumpAtt.cy - L.pumpAtt.r, L.pumpAtt.r * 2, L.pumpAtt.r * 2, () => { if (sv()) sv().togglePump('lo', 'att'); });
        add('lo-priming-pump', L.pumpPrim.cx - L.pumpPrim.r, L.pumpPrim.cy - L.pumpPrim.r, L.pumpPrim.r * 2, L.pumpPrim.r * 2, () => { if (sv()) sv().togglePump('lo', 'prim'); });
        // 预润滑泵控制面板
        {
            const PP = L.primPanel;
            add('prim-panel', PP.x, PP.y, PP.w, PP.h, () => s._tipPart('prim-panel'));
            add('prim-start', PP.x + 15, PP.y + 34, 44, 44, () => { if (sv()) sv().startPrimPump(); });
            add('prim-stop', PP.x + 79, PP.y + 34, 44, 44, () => { if (sv()) sv().stopPrimPump(); });
            add('prim-mode', PP.x + 154, PP.y + 24, 60, 60, () => { if (sv()) sv().togglePrimMode(); });
        }

        // ── 高温淡水 ──
        add('ht-engine', H.eng.x, H.eng.y, H.eng.w, H.eng.h, () => s._tipPart('ht-engine'));
        add('tt-ht', H.tt.cx - 14, H.tt.cy - 14, 28, 28, () => s._tipPart('tt-ht'));
        add('ht-cooler', H.cooler.x, H.cooler.y, H.cooler.w, H.cooler.h, () => s._tipPart('ht-cooler'));
        add('rv-ht', H.rv3.cx - 18, H.rv3.cy - 18, 36, 36, () => s._tipPart('rv-ht'));
        add('ht-pump', H.pump.cx - H.pump.r, H.pump.cy - H.pump.r, H.pump.r * 2, H.pump.r * 2, () => s._tipPart('ht-pump'));

        // ── 手动阀 ──
        this._valveDefs.forEach(v => {
            add(v.part, v.x - 15, v.y - 15, 30, 30, () => { if (sv()) sv().toggleValve(v.key); });
        });
    }

    _tipLamp(id) {
        const v = this._solver();
        if (!v) return;
        const m = v.m;
        const T = {
            'led-manu-stop': `手动紧急停车灯：${m.trips.estop ? '亮（机旁已紧急停车）' : '灭'}`,
            'led-htfw-trip': `高温淡水高温跳闸灯：${m.trips.htTemp ? '亮（保护已动作）' : '灭'}`,
            'led-start-fail': `起动失败灯：${m.engine.startFail ? '亮（上次起动失败）' : '灭'}`,
            'led-ready': `准备起动灯：${m.ready ? '亮（盘车脱开、油压正常、无跳闸）' : '灭'}`,
            'led-remote': `遥控位置灯：${m.mode === 'REMOTE' ? '亮' : '灭'}`,
            'led-lo-lp-trip': `滑油低压跳闸灯：${m.trips.loPress ? '亮（保护已动作）' : '灭'}`,
            'led-overspeed': `超速跳闸灯：${m.trips.overspeed ? '亮（保护已动作）' : '灭'}`,
            'led-running': `机组运行灯：${m.engine.running ? '亮' : '灭'}`,
            'led-local': `机旁位置灯：${m.mode === 'LOCAL' ? '亮' : '灭'}`,
            'led-dc24': '直流 24 V 电源指示灯（常亮）',
        };
        this._tip(T[id] || id);
    }

    _tipTool(key) {
        const v = this._solver();
        if (!v) return;
        const t = v.m.test;
        const T = {
            pump: `手动泵压模块：输出 ${t.pumpPress.toFixed(2)} bar，${t.pumpOn ? '已接入' : '未接入'}滑油压力传感器回路。`
                + '试验时先升到 5 bar 再缓慢泄压，低于 1.5 bar 保持 4 s 应跳闸停机。',
            freq: `频率发生器：${t.freq.toFixed(0)} Hz（60 齿飞轮，f ≈ n），${t.freqOn ? '已接入' : '未接入'}转速传感器回路。`
                + '升到 1725 Hz（≈1725 r/min）以上应无延时立即超速跳闸。',
            res: `电阻箱：${t.res.toFixed(1)} Ω（≈ ${((t.res - 100) / 0.385).toFixed(1)} ℃），${t.resOn ? '已接入' : '未接入'}，`
                + '用来代替 PT100 做高温试验：调到约 140 Ω（≈104 ℃）保持 6 s 应高温跳闸。',
            oven: `干式温度校验炉：炉温 ${t.oven.toFixed(0)} ℃，${t.ovenOn ? 'PT100 已放入炉膛' : 'PT100 未放入'}。`
                + '升温到 95 ℃ 以上保持 6 s 应高温跳闸。',
        };
        this._tip(T[key] || key);
    }

    _tipProtection(i) {
        const v = this._solver();
        if (!v) return;
        const m = v.m;
        const txt = [
            `超速保护：定值 ${PROTECTION_SP.overspeed} r/min，转速信号 ${m.speedSig.toFixed(0)} r/min`
                + (m.trips.overspeed ? '；已跳闸' : '；无延时，立即跳闸'),
            `滑油低压保护：定值 ${PROTECTION_SP.loPress} bar，滑油压力 ${m.pressSig.toFixed(2)} bar`
                + (m.trips.loPress ? '；已跳闸' : '；机组运行且压力低 4 s 动作'),
            `冷却水高温保护：定值 ${PROTECTION_SP.htTemp} ℃，冷却水温度 ${m.htSig.toFixed(1)} ℃`
                + (m.trips.htTemp ? '；已跳闸' : `；机组运行且温度高 ${PROTECTION_SP.delayHt} s 动作`),
        ];
        this._tip(txt[i] || '');
    }

    _tipPart(id) {
        const v = this._solver();
        if (!v) return;
        const m = v.m;
        const E = m.engine, HT = m.ht, LO = m.lo;
        const tips = {
            engine: `柴油机：${E.running ? '运转' : (E.cranking > 0 ? '起动中' : '停车')}，转速 ${E.speed.toFixed(0)} r/min，`
                + `负荷 ${E.load.toFixed(0)} %，燃油齿条 ${E.fuel.toFixed(0)} %`,
            generator: `同步发电机：${m.gen.breaker ? `${m.gen.volt.toFixed(0)} V / ${m.gen.freq.toFixed(1)} Hz / ${m.gen.kw.toFixed(0)} kW` : '未并网（停机或转速不足）'}`,
            'speed-sensor': `磁电式转速传感器：检测飞轮齿圈，输出转速信号 ${m.speedSig.toFixed(0)} r/min`
                + (m.test.freqOn ? '（现由频率发生器模拟）' : (m.faults.speedSensor ? '（信号失真！）' : '')),
            turbo: '废气涡轮增压器：利用排气能量驱动压气机，增压空气经空冷器冷却后进入扫气箱',
            'ht-engine': `柴油机：高温淡水出口温度 ${HT.tempOut.toFixed(1)} ℃`,
            'tt-ht': `TT 温度传感器（柴油机出口）：${HT.tempOut.toFixed(1)} ℃`,
            'ht-cooler': `高温淡水冷却器（横向）：冷却后进机水温 ${HT.tempIn.toFixed(1)} ℃`,
            'rv-ht': `三通调温阀：开度 ${HT.valve.toFixed(0)} %（0 % 全旁通，100 % 全经冷却器），给定 ${HT.setpoint.toFixed(0)} ℃`,
            'ht-pump': `高温淡水机带泵：${E.running ? '随机组运转' : '停机（机组未运行）'}，流量 ${HT.flow.toFixed(1)} m³/h`,
            'lo-sump': `滑油柜：油温 ${LO.temp.toFixed(1)} ℃，液位 L ${LO.level.toFixed(1)} %`,
            'pt-lo': `滑油压力传感器 PT：${LO.press.toFixed(2)} bar（> 1.5 bar 绿色填充，低于则不填充）`,
            'lo-filter': `滑油滤器：滤后压力 ${LO.pressFilter.toFixed(2)} bar，油温 ${LO.tempFilter.toFixed(1)} ℃`,
            'lo-cooler': `滑油冷却器：出口油温 ${LO.tempOut.toFixed(1)} ℃，流量 ${LO.flow.toFixed(2)} m³/h`,
            'rv-lo': `滑油三通调温阀：开度 ${LO.valve.toFixed(0)} %，给定 ${LO.setpoint.toFixed(1)} ℃`,
            'prim-panel': `预润滑泵控制面板：${LO.primMode === 'AUT' ? 'AUT 自动（停机 / 油压低自起）' : 'MAN 手动'}，`
                + `泵${LO.pumpPrim ? '运行' : '停止'}${m.faults.loPump ? '；泵故障' : ''}`, 
            'shutdown-relay': `停机继电器：${m.shutdown.relay ? '已得电（保护动作）' : '未得电'}`,
            'stop-solenoid': `停机电磁阀：${m.shutdown.solenoid ? '已动作（断油）' : '未动作'}`,
            'fuel-rack': `燃油切断机构：齿条 ${E.fuel.toFixed(0)} %${m.shutdown.fuelCut ? '（已切断）' : ''}`,
            'air-bottle': `起动空气瓶：${m.air.press.toFixed(1)} bar（${(m.air.press / 10).toFixed(2)} MPa），`
                + `最低起动压力 ${m.air.min} bar；空压机${m.air.comp ? '补气中' : '停止'}`
                + (m.air.press < m.air.min ? ' —— 压力低，不能起动！' : ''),
            'air-compressor': `电动空压机：${m.air.compOn ? '自动' : '已切除'}，${m.air.comp ? '运行补气中' : '停止'}`
                + '（24 bar 自动起动、30 bar 停机）；点击可切换自动 / 切除',
            'start-air-valve': `起动空气阀：${m.air.valve ? '开启（起动中，压缩空气进入各缸起动阀）' : '关闭'}`
                + '；柴油机由压缩空气起动，不用起动马达',
        };
        this._tip(tips[id] || id);
    }

    // ═══════════════════════════════════════════════════════════
    //  显示同步
    // ═══════════════════════════════════════════════════════════
    _syncVisuals() {
        const svReal = this._solver();
        const sv = svReal || (this._fallbackSolver = this._fallbackSolver || new GensetSafetySolver(this.sys));
        const m = sv.m;
        const E = m.engine, HT = m.ht, LO = m.lo;

        this._animT += 1;
        const blink = (this._animT % 20) < 12;

        // ── 阀门 ──
        Object.keys(this._valves).forEach(k => {
            const V = this._valves[k];
            const on = !!m.sw[k];
            if (V._on === on) return;
            V._on = on;
            const c = on ? COL.on : COL.off;
            V.a.fill(c); V.b.fill(c);
        });

        // ── 泵 ──
        const setPump = (key, run) => {
            const P = this._pumps[key];
            if (!P) return;
            P.face.fill(run ? '#d8f5d0' : '#f4f6f7');
            if (run) P.fan.rotation((P.fan.rotation() + 14) % 360);
        };
        setPump('htP', !!E.running && HT.pump1 && !m.faults.htPump1);   // 高温淡水机带泵随机组运转
        setPump('loAtt', LO.pumpAtt && !m.faults.loPump && !!E.running);   // 机带泵随机组运转
        setPump('loPrim', LO.pumpPrim && !m.faults.loPump);

        // ── 三通阀阀芯着色 ──
        const tint3 = (V, frac) => {
            if (!V) return;
            const k = Math.round(Math.max(0, Math.min(1, frac)) * 10) / 10;
            if (V._k === k) return;
            V._k = k;
            const c = k >= 0.5 ? COL.on : '#ffffff';
            V.a.fill(c); V.b.fill(c); V.c.fill(c);
        };

        // ── 面板灯 ──
        const anyTrip = m.trips.overspeed || m.trips.loPress || m.trips.htTemp || m.trips.estop;
        const lit = {
            'led-manu-stop': m.trips.estop,
            'led-htfw-trip': m.trips.htTemp,
            'led-start-fail': m.engine.startFail,
            'led-ready': m.ready,
            'led-remote': m.mode === 'REMOTE',
            'led-lo-lp-trip': m.trips.loPress,
            'led-overspeed': m.trips.overspeed,
            'led-running': m.engine.running,
            'led-local': m.mode === 'LOCAL',
            'led-dc24': true,
        };
        const DEF = {};
        LAMP_DEFS.forEach(L => { DEF[L.id] = L.kind; });
        Object.keys(this._lampDots).forEach(id => {
            const dot = this._lampDots[id];
            const kind = DEF[id];
            const on = m.lampTest ? blink : !!lit[id];
            const color = kind === 'red'
                ? (on ? '#ff3b30' : '#5a1a16')
                : (on ? '#39e75f' : '#14521a');
            if (dot._c !== color) { dot._c = color; dot.fill(color); }
        });

        if (this._modeKnob) {
            const rot = m.mode === 'BLOCK' ? -90 : (m.mode === 'LOCAL' ? 0 : 90);
            if (this._modeKnob.rotation() !== rot) this._modeKnob.rotation(rot);
        }
        if (this._loadKnob) {
            const pct = Math.max(0, Math.min(100, m.loadTarget));
            const rot = -135 + pct * 2.7;                 // 0 % → −135°，100 % → +135°
            if (Math.abs(this._loadKnob.rotation() - rot) > 0.05) this._loadKnob.rotation(rot);
            const txt = `${pct.toFixed(0)} %`;
            if (this._loadVal && this._loadVal.text() !== txt) this._loadVal.text(txt);
        }
        if (this._tgKnob) this._tgKnob.rotation(m.turningGear ? -45 : 45);
        if (this._bhKnob) this._bhKnob.rotation(m.blockHandle ? 45 : -45);

        // ── 安全保护卡片 ──
        const vals = [
            `${m.speedSig.toFixed(0)} r/min`,
            `${m.pressSig.toFixed(2)} bar`,
            `${m.htSig.toFixed(1)} ℃`,
        ];
        const trips = [m.trips.overspeed, m.trips.loPress, m.trips.htTemp];
        const conds = [
            m.speedSig > PROTECTION_SP.overspeed,
            E.speed > 700 && m.pressSig < PROTECTION_SP.loPress,
            E.speed > 700 && m.htSig > PROTECTION_SP.htTemp,
        ];
        this._protVal.forEach((t, i) => {
            if (t.text() !== vals[i]) t.text(vals[i]);
            const color = (trips[i] || conds[i]) ? '#ff8a80' : '#00e83c';
            if (t._c !== color) { t._c = color; t.fill(color); }
        });
        this._protLamp.forEach((lamp, i) => {
            const color = (trips[i] || (conds[i] && blink)) ? '#ff3b30' : '#5a1a16';
            if (lamp._c !== color) { lamp._c = color; lamp.fill(color); }
        });

        // ── 停机执行链 ──
        const active = m.shutdown.relay;
        const chainColor = active ? '#e53935' : '#4a5c6b';
        this._chainArrows.forEach(A => {
            if (A.ln._c !== chainColor) {
                A.ln._c = chainColor; A.ln.stroke(chainColor); A.tri.fill(chainColor);
            }
        });
        if (this._cmdLine._c !== chainColor) {
            this._cmdLine._c = chainColor;
            this._cmdLine.stroke(chainColor);
            this._cmdLine2.stroke(chainColor);
            this._cmdTri.fill(chainColor);
            this._cmdTri2.fill(chainColor);
        }
        const cmdColor = active ? '#ff3b30' : '#5a1a16';
        if (this._cmdLamp._c !== cmdColor) { this._cmdLamp._c = cmdColor; this._cmdLamp.fill(cmdColor); }
        const stopColor = m.shutdown.fuelCut ? '#ff3b30' : '#5a1a16';
        if (this._stopLamp._c !== stopColor) { this._stopLamp._c = stopColor; this._stopLamp.fill(stopColor); }

        // ── 机组转动件 ──
        const running = !!E.running;
        const spin = running ? Math.max(1, E.speed / 150) : 0;
        if (this._flywheel) this._flywheel.rotation((this._flywheel.rotation() + spin * 3) % 360);
        if (this._rotor) this._rotor.rotation((this._rotor.rotation() + spin * 2) % 360);
        this._flames.forEach((fg, i) => {
            const burn = running && !m.trips.estop;
            fg.visible(burn);
            if (!burn) return;
            fg.scaleY(0.82 + 0.26 * Math.sin((this._animT + i * 7) * 0.5));
            fg.scaleX(0.95 + 0.12 * Math.sin((this._animT + i * 4) * 0.8));
        });

        // ── 数值标签 ──
        const setTag = (key, txt) => {
            const t = this._tags[key];
            if (t && t.text() !== txt) t.text(txt);
        };
        setTag('htTemp', `T ${HT.tempOut.toFixed(2)} ℃`);

        setTag('loSumpT', `${LO.temp.toFixed(2)} ℃`);
        setTag('loSumpL', `${LO.level.toFixed(2)} %`);

        setTag('speed', `n ${E.speed.toFixed(0)} r/min`);
        setTag('genU', `U ${m.gen.volt.toFixed(0)}V`);
        setTag('genF', `f ${m.gen.freq.toFixed(1)}Hz`);
        setTag('genP', `P ${m.gen.kw.toFixed(0)}kW`);
        setTag('engineState', m.trips.estop ? '保护/紧急停车' : (running ? '运行 RUNNING' : (E.cranking > 0 ? '起动中' : '停车 STOPPED')));

        // ── 起动空气系统 ──
        if (this._airP) {
            const txt = `${(m.air.press / 10).toFixed(2)} MPa`;
            if (this._airP.text() !== txt) this._airP.text(txt);
            const c = m.air.press < m.air.min ? '#c62828' : '#0b3d91';
            if (this._airP._c !== c) { this._airP._c = c; this._airP.fill(c); }
        }
        if (this._airCompLed) {
            const c = m.air.comp ? '#39e75f' : '#5a1a16';
            if (this._airCompLed._c !== c) { this._airCompLed._c = c; this._airCompLed.fill(c); }
        }
        if (this._airValveLed) {
            const c = m.air.valve ? '#39e75f' : '#39434d';
            if (this._airValveLed._c !== c) { this._airValveLed._c = c; this._airValveLed.fill(c); }
        }

        // ── PT / TT 颜色 ──
        if (this._ptCircle) {
            const ok = LO.press > 1.5;
            const c = ok ? '#2ecc40' : '#ffffff';        // 低于 1.5 bar 不填充
            if (this._ptCircle._c !== c) { this._ptCircle._c = c; this._ptCircle.fill(c); }
            const tc = ok ? '#ffffff' : '#c62828';
            if (this._ptText._c !== tc) { this._ptText._c = tc; this._ptText.fill(tc); }
        }
        if (this._spdSensor) {
            const c = E.speed > 500 ? '#2ecc40' : '#9fb0bd';   // 转速 > 500 r/min 绿色填充
            if (this._spdSensor._c !== c) { this._spdSensor._c = c; this._spdSensor.fill(c); }
        }
        if (this._ttCircle) {
            const t = HT.tempOut;
            const c = t > 90 ? '#e33b32' : (t < 45 ? '#2f8fe0' : '#2ecc40');
            if (this._ttCircle._c !== c) { this._ttCircle._c = c; this._ttCircle.fill(c); }
        }

        // ── 预润滑泵控制面板 ──
        if (this._primRun) {
            const on = !!LO.pumpPrim;
            const c = on ? '#00e83c' : '#1b4a1e';      // 工作时亮绿色
            if (this._primRun._c !== c) { this._primRun._c = c; this._primRun.fill(c); }
            const tc = on ? '#0b2b0d' : '#9be3a4';
            if (this._primRunTxt._c !== tc) { this._primRunTxt._c = tc; this._primRunTxt.fill(tc); }
        }
        if (this._primPwr) {
            const c = '#ffffff';   // 电源指示灯：有电时亮白色
            if (this._primPwr._c !== c) { this._primPwr._c = c; this._primPwr.fill(c); }
        }
        if (this._primKnob) {
            const rot = LO.primMode === 'AUT' ? 45 : -45;
            if (this._primKnob.rotation() !== rot) this._primKnob.rotation(rot);
        }

        // ── 工具箱 ──
        const t = m.test;
        const toolState = [
            { on: t.pumpOn, v: `${t.pumpPress.toFixed(2)} bar`, s: t.pumpOn ? '已接入滑油压力传感器' : '未接入（真实油压）' },
            { on: t.freqOn, v: `${t.freq.toFixed(0)} Hz`, s: `${t.freqOn ? '已接入' : '未接入'} · ≈ ${t.freq.toFixed(0)} r/min` },
            { on: t.resOn, v: `${t.res.toFixed(1)} Ω`, s: `${t.resOn ? '已接入' : '未接入'} · ≈ ${((t.res - 100) / 0.385).toFixed(1)} ℃` },
            { on: t.ovenOn, v: `${t.oven.toFixed(0)} ℃`, s: t.ovenOn ? 'PT100 已放入炉膛' : 'PT100 未放入' },
        ];
        toolState.forEach((st, i) => {
            const btn = this._toolBtns[i];
            if (btn) {
                const c = st.on ? '#1b8f2e' : '#1e6fb8';
                if (btn._c !== c) { btn._c = c; btn.fill(c); }
            }
            const led = this._toolLeds[i];
            if (led) {
                const c = st.on ? '#39e75f' : '#5a1a16';
                if (led._c !== c) { led._c = c; led.fill(c); }
            }
            const vt = this._toolVals[i];
            if (vt && vt.text() !== st.v) vt.text(st.v);
            const stx = this._toolSubs[i];
            if (stx) {
                if (stx.text() !== st.s) stx.text(st.s);
                const c = st.on ? '#1b7a2e' : '#5a6b78';
                if (stx._c !== c) { stx._c = c; stx.fill(c); }
            }
        });
        if (this._pumpNeedle) {
            const ang = -135 + Math.max(0, Math.min(8, t.pumpPress)) / 8 * 270;
            this._pumpNeedle.rotation(ang);
        }

        // 滑油柜液位
        if (this._sumpLvl) {
            const T2 = this._lo.tank;
            const hh = Math.max(4, (T2.h - 8) * Math.max(0, Math.min(100, LO.level)) / 100);
            this._sumpLvl.height(hh);
            this._sumpLvl.y(T2.y + T2.h - 4 - hh);
        }
        if (this._sumpGlass) {
            const T2 = this._lo.tank;
            const hh = Math.max(4, (T2.h - 8) * Math.max(0, Math.min(100, LO.level)) / 100);
            this._sumpGlass.height(hh);
            this._sumpGlass.y(T2.y + T2.h - 4 - hh);
        }

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

export default GensetSafetyMimic;
