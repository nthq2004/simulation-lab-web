/**
 * GensetStartMimic — 船舶柴油发电机组（副机）起动和调速系统 — 功能测试
 * ═══════════════════════════════════════════════════════════════════════════
 *  1590 × 840，上中下三大块、每块左右两区：
 *    左上 柴油发电机组机旁控制面板（ENGINE CONTROL UNIT）—— 与原安保测试组件完全一致
 *    右上 发电机遥控操作模块（起动 / 停止 / 调速 / 合闸 / 分闸 / 负荷测试 MCCB）
 *    左中 柴油发电机组模型（柴油机 + 发电机 + 盘车机构 + 起动空气）—— 与原组件完全一致
 *    右中 起动时序与监控模块（9 个互斥时序灯 + 燃油量趋势 + 转速趋势，各保留 3 min）
 *    左下 起动联锁和执行模块（8 输入与门 + 起动电磁阀 → 主起动阀 → 空气分配器 → 各缸）
 *    右下 燃油和调速系统（日用柜 / 燃油泵 / 速闭阀 / 高压油泵 / 刺破阀 / 调速器与油门拉杆）
 * ═══════════════════════════════════════════════════════════════════════════
 */
import Konva from 'konva';
import { BaseComponent } from './BaseComponent.js';
import {
    GensetStartSolver, START_CONDITIONS, SEQ_STEPS, SEQ_CN, SEQ_EN, TREND_WINDOW, FIRE_SPEED,
} from '../tools/GensetStartSolver.js';

const FONT = 'Arial, "Microsoft YaHei", sans-serif';

/** 管路 / 设备配色 */
const COL = {
    fuel: '#d97706',      // 燃油（橙）
    fuelHot: '#f59e0b',
    air: '#9ad2f2',
    airOn: '#2f8fe0',
    on: '#2ecc40',
    off: '#ffffff',
    red: '#e33b32',
    steel: '#5c7688',
    ink: '#1b2a35',
};

/** 10 只报警 / 状态灯（左上机旁面板，与原安保组件一致） */
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

export class GensetStartMimic extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.W = Math.max(1400, config.width || 1590);
        this.H = Math.max(780, config.height || 840);
        this.type = 'genset_start_mimic';
        this.special = 'genset_start_mimic';
        this.cache = 'fixed';

        this._animT = 0;

        this._initGroups();
        this._recalcGeometry();
        this._init();
        this._syncVisuals();

        this.config = { id: this.id, width: this.W, height: this.H };
    }

    _solver() {
        return this.sys && this.sys.gensetStartSolver ? this.sys.gensetStartSolver : null;
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
            remote: { x: 789, y: 40, w: 795, h: 216 },
            genset: { x: 6, y: 262, w: 775, h: 298 },
            seq: { x: 789, y: 262, w: 795, h: 298 },
            inter: { x: 6, y: 566, w: 775, h: 268 },
            fuel: { x: 789, y: 566, w: 795, h: 268 },
        };

        // ── 左上：机旁控制面板（与原组件一致）──
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

        // ── 左中：柴油发电机组模型（与原组件一致）──
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

        // ── 右上：发电机遥控操作模块 ──
        const R = this._B.remote;
        this._remote = {
            start: { x: R.x + 20, y: R.y + 42, w: 116, h: 46 },
            stop: { x: R.x + 148, y: R.y + 42, w: 116, h: 46 },
            ready: { x: R.x + 20, y: R.y + 98, w: 244, h: 32 },
            run: { x: R.x + 20, y: R.y + 138, w: 244, h: 32 },
            knob: { cx: R.x + 340, cy: R.y + 106, r: 32 },
            close: { x: R.x + 416, y: R.y + 42, w: 152, h: 46 },
            open: { x: R.x + 416, y: R.y + 96, w: 152, h: 46 },
            mccb: { x: R.x + 596, y: R.y + 34, w: 180, h: 160 },
        };

        // ── 右中：起动时序与监控模块 ──
        const S = this._B.seq;
        this._seq = {
            lamps: SEQ_STEPS.map((k, i) => ({ key: k, x: S.x + 16, y: S.y + 42 + i * 27, w: 176, h: 24 })),
            fuelChart: { x: S.x + 204, y: S.y + 48, w: 268, h: 224 },
            speedChart: { x: S.x + 486, y: S.y + 48, w: 292, h: 224 },
        };

        // ── 左下：起动联锁和执行模块 ──
        const I = this._B.inter;
        this._inter = {
            conds: START_CONDITIONS.map((c, i) => ({
                ...c, x: I.x + 16, y: I.y + 46 + i * 26, w: 340, h: 24,
            })),
            gate: { x: I.x + 392, y: I.y + 46, w: 176, h: 184 },
            chain: [
                { key: 'solenoid', cn: '起动电磁阀', en: 'START SOLENOID', x: I.x + 620, y: I.y + 40, w: 150, h: 36 },
                { key: 'mainValve', cn: '主起动阀', en: 'MAIN START VALVE', x: I.x + 620, y: I.y + 90, w: 150, h: 36 },
                { key: 'distributor', cn: '空气分配器', en: 'AIR DISTRIBUTOR', x: I.x + 620, y: I.y + 140, w: 150, h: 36 },
                { key: 'cylinders', cn: '各缸进气', en: 'CYL. 1~8', x: I.x + 620, y: I.y + 190, w: 150, h: 58 },
            ],
        };

        // ── 右下：燃油和调速系统 ──
        const FU = this._B.fuel;
        this._fuel = {
            tank: { x: FU.x + 18, y: FU.y + 56, w: 110, h: 96 },
            pump: { cx: FU.x + 180, cy: FU.y + 104, r: 16 },
            qcv: { cx: FU.x + 240, cy: FU.y + 104 },
            hpp: { x: FU.x + 300, y: FU.y + 64, w: 96, h: 102 },
            pv: { cx: FU.x + 442, cy: FU.y + 104 },
            setBox: { x: FU.x + 18, y: FU.y + 186, w: 112, h: 50 },
            govBox: { x: FU.x + 150, y: FU.y + 186, w: 130, h: 50 },
        };
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

    _pipe(g, pts, color = COL.fuel, w = 3.4, dash = null) {
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

    /** 泵：圆壳 + 顶部驱动 */
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

    _drawKnobBase(g, cx, cy, R = 33) {
        g.add(new Konva.Circle({ x: cx, y: cy, radius: R, fill: '#ffffff', stroke: '#9aa0a0', strokeWidth: 1.2 }));
        g.add(new Konva.Circle({ x: cx, y: cy, radius: R - 7, fill: '#141414', stroke: '#000000', strokeWidth: 1 }));
    }

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

        g.add(new Konva.Rect({
            x: 0, y: 0, width: this.W, height: this.H, cornerRadius: 8,
            fill: '#eef2f5', stroke: '#c3ccd3', strokeWidth: 2,
        }));
        this._label(g, 14, 8, '船舶柴油发电机组（副机）起动和调速系统-功能测试', 20, '#0b3d91', true);
        this._label(g, this.W - 460, 13, 'MIMIC ｜ 机旁面板 + 遥控操作 + 机组 / 起动联锁 / 起动时序 / 燃油与调速', 12.5, '#5a6b78');

        this._drawPanel(g);
        this._drawGenset(g);
        this._drawRemote(g);
        this._drawSeq(g);
        this._drawInterlock(g);
        this._drawFuel(g);
    }

    // ─────────────────────────────────────────────
    //  左上：机旁控制面板（与原组件一致）
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
        this._label(g, KB.cx - 30, K.y + 20, 'LOCAL', 15, '#9be3a4', true, 'center', 60);
        this._label(g, K.x + 2, KB.cy - 6, 'BLOCK', 15, '#ffd27a', true, 'left', 54);
        this._label(g, K.x + K.w - 54, KB.cy - 6, 'REM', 15, '#9be3a4', true, 'left', 50);
        this._label(g, K.x, K.y + 112, '控制方式 CONTROL MODE', 13, '#cfdae2', true, 'center', K.w);
        this._label(g, KB.cx - 40, K.y + 132, '闭锁 / 机旁 / 遥控', 12, '#93a2ae', false, 'center', 100);
    }

    // ─────────────────────────────────────────────
    //  左中：柴油发电机组模型（与原组件一致）
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
        // 负荷调节旋钮
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
        g.add(new Konva.Rect({ x: AB.x, y: AB.y, width: AB.w, height: AB.h, cornerRadius: 12, fill: '#dfe9f2', stroke: '#4a5560', strokeWidth: 1.8 }));
        g.add(new Konva.Rect({ x: AB.x + AB.w / 2 - 9, y: AB.y - 8, width: 18, height: 9, cornerRadius: 2, fill: '#9fb0bd', stroke: '#4a5560', strokeWidth: 1.2 }));
        g.add(new Konva.Circle({ x: AB.x + AB.w / 2, y: AB.y + 22, radius: 13, fill: '#ffffff', stroke: '#4a5560', strokeWidth: 1.4 }));
        g.add(new Konva.Line({ points: [AB.x + AB.w / 2, AB.y + 22, AB.x + AB.w / 2, AB.y + 13], stroke: '#c62828', strokeWidth: 1.6 }));
        this._label(g, AB.x - 3, AB.y + AB.h + 4, '起动空气瓶', 11.5, '#1b2a35', true);
        g.add(new Konva.Rect({ x: AC.x, y: AC.y, width: AC.w, height: AC.h, cornerRadius: 4, fill: '#cfd8de', stroke: '#4a5560', strokeWidth: 1.5 }));
        g.add(new Konva.Circle({ x: AC.x + 18, y: AC.y + AC.h / 2, radius: 10, fill: '#eef2f5', stroke: '#4a5560', strokeWidth: 1.2 }));
        this._label(g, AC.x + 12, AC.y + AC.h + 6, '空压机', 12.5, '#1b2a35');
        this._pipe(g, [AC.x, AC.y + 18, AB.x + AB.w, AB.y + 18], COL.air, 2.6);
        this._pipe(g, [AB.x, AV.cy, AV.cx + 14, AV.cy], COL.air, 3.2);
        this._pipe(g, [AV.cx - 14, AV.cy, GS.x + 500, AV.cy, GS.x + 500, G.head.y - 2, G.head.x + G.head.w, G.head.y - 2], COL.air, 3.2);
        this._label(g, AV.cx - 30, AV.cy - 36, '起动空气阀', 11.5, '#1b2a35', true);
        g.add(new Konva.Line({ points: [AV.cx - 8, AV.cy - 7, AV.cx - 8, AV.cy + 7, AV.cx, AV.cy], closed: true, fill: '#ffffff', stroke: '#3d4a54', strokeWidth: 1.2 }));
        g.add(new Konva.Line({ points: [AV.cx + 8, AV.cy - 7, AV.cx + 8, AV.cy + 7, AV.cx, AV.cy], closed: true, fill: '#ffffff', stroke: '#3d4a54', strokeWidth: 1.2 }));
        g.add(new Konva.Rect({ x: AV.cx - 9, y: AV.cy - 18, width: 18, height: 8, cornerRadius: 2, fill: '#9fb3c2', stroke: '#3d4a54', strokeWidth: 1 }));
    }

    // ─────────────────────────────────────────────
    //  右上：发电机遥控操作模块
    // ─────────────────────────────────────────────
    _drawRemote(g) {
        const B = this._B.remote, RM = this._remote;

        g.add(new Konva.Rect({ x: B.x, y: B.y, width: B.w, height: B.h, cornerRadius: 10, fill: '#f3f7fa', stroke: '#c3ccd3', strokeWidth: 1.6 }));
        this._label(g, B.x + 12, B.y + 8, '发电机遥控操作模块   GENERATOR REMOTE CONTROL', 15, '#0b3d91', true);
        this._label(g, B.x + 420, B.y + 10, '起动 / 停止 · 调速 · 合闸 / 分闸 · 负荷测试', 12, '#5a6b78');

        const mkBtn = (bx, color, cn, en) => {
            g.add(new Konva.Rect({ x: bx.x, y: bx.y, width: bx.w, height: bx.h, cornerRadius: 5, fill: color, stroke: '#0b0f12', strokeWidth: 1.5 }));
            g.add(new Konva.Rect({
                x: bx.x + 3, y: bx.y + 3, width: bx.w - 6, height: bx.h - 6, cornerRadius: 3,
                fillEnabled: false, stroke: 'rgba(255,255,255,0.35)', strokeWidth: 1,
            }));
            this._label(g, bx.x, bx.y + 7, cn, 14, '#ffffff', true, 'center', bx.w);
            this._label(g, bx.x, bx.y + 27, en, 9, '#dfe7ec', false, 'center', bx.w);
        };
        mkBtn(RM.start, '#1b8f2e', '起动', 'START');
        mkBtn(RM.stop, '#c62828', '停止', 'STOP');
        mkBtn(RM.close, '#1e6fb8', '合闸', 'BREAKER CLOSE');
        mkBtn(RM.open, '#1e6fb8', '分闸', 'BREAKER OPEN');

        // Ready For Start / Running 指示灯条
        [RM.ready, RM.run].forEach((bx, i) => {
            g.add(new Konva.Rect({ x: bx.x, y: bx.y, width: bx.w, height: bx.h, cornerRadius: 6, fill: '#1a2128', stroke: '#4b5762', strokeWidth: 1.2 }));
            this._label(g, bx.x + 24, bx.y + 8, i === 0 ? 'READY FOR START' : 'RUNNING', 12.5, '#ffffff', true, 'left', bx.w - 30);
            this._label(g, bx.x + 150, bx.y + 10, i === 0 ? '准备好' : '运行中', 11, '#9db9cd', false, 'left', 90);
        });

        // 调速旋钮
        const K = RM.knob;
        this._drawKnobBase(g, K.cx, K.cy, K.r);
        this._label(g, K.cx - 54, B.y + 48, '调速旋钮', 12.5, '#0b3d91', true, 'center', 108);
        this._label(g, K.cx - 54, B.y + 64, 'SPEED SET', 9.5, '#5a6b78', false, 'center', 108);
        this._label(g, K.cx - K.r - 26, K.cy - 9, '−', 18, '#1b2a35', true, 'center', 20);
        this._label(g, K.cx + K.r + 6, K.cy - 9, '+', 18, '#1b2a35', true, 'center', 20);

        // 负荷测试 MCCB
        this._drawMccb(g, RM.mccb);
    }

    /** 负荷测试塑壳断路器（MCCB） */
    _drawMccb(g, B) {
        g.add(new Konva.Rect({ x: B.x, y: B.y, width: B.w, height: B.h, cornerRadius: 6, fill: '#e8ecef', stroke: '#4a5560', strokeWidth: 1.8 }));
        // 三相接线端
        for (let i = 0; i < 3; i++) {
            const x = B.x + 34 + i * 56;
            g.add(new Konva.Rect({ x, y: B.y - 8, width: 18, height: 10, fill: '#c9a227', stroke: '#6b5510', strokeWidth: 1 }));
            g.add(new Konva.Rect({ x, y: B.y + B.h - 2, width: 18, height: 10, fill: '#c9a227', stroke: '#6b5510', strokeWidth: 1 }));
        }
        g.add(new Konva.Rect({ x: B.x + 8, y: B.y + 8, width: B.w - 16, height: B.h - 16, cornerRadius: 4, fill: '#2b333b' }));
        this._label(g, B.x + 8, B.y + 12, '负荷测试', 13.5, '#ffffff', true, 'center', B.w - 16);
        this._label(g, B.x + 8, B.y + 29, 'LOAD TEST MCCB', 9, '#9db9cd', false, 'center', B.w - 16);
        // 手柄槽
        g.add(new Konva.Rect({ x: B.x + 56, y: B.y + 44, width: 68, height: 58, cornerRadius: 4, fill: '#151b20', stroke: '#5b6874', strokeWidth: 1 }));
        this._label(g, B.x + 26, B.y + 42, 'ON', 10, '#9be3a4', true, 'center', 26);
        this._label(g, B.x + 26, B.y + 88, 'OFF', 10, '#ff9d94', true, 'center', 26);
        this._label(g, B.x + 8, B.y + 104, '推上加载 · 双击设负载', 9.5, '#cfdae2', false, 'center', B.w - 16);
    }

    // ─────────────────────────────────────────────
    //  右中：起动时序与监控模块
    // ─────────────────────────────────────────────
    _drawSeq(g) {
        const B = this._B.seq, S = this._seq;

        g.add(new Konva.Rect({ x: B.x, y: B.y, width: B.w, height: B.h, cornerRadius: 10, fill: '#12212e', stroke: '#08131c', strokeWidth: 2.5 }));
        g.add(new Konva.Rect({
            x: B.x + 6, y: B.y + 6, width: B.w - 12, height: B.h - 12, cornerRadius: 8,
            fillEnabled: false, stroke: '#2f4a60', strokeWidth: 1,
        }));
        this._label(g, B.x + 16, B.y + 8, '起动时序与监控', 16, '#ffffff', true);
        this._label(g, B.x + 146, B.y + 12, 'START SEQUENCE & TREND', 12.5, '#66b6f0');

        // 9 个时序灯框
        S.lamps.forEach(L => {
            g.add(new Konva.Rect({ x: L.x, y: L.y, width: L.w, height: L.h, cornerRadius: 4, fill: '#101a24', stroke: '#3d5c74', strokeWidth: 1 }));
            this._label(g, L.x + 24, L.y + 5, SEQ_CN[L.key], 12.5, '#cfe0f2', true, 'left', 78);
            this._label(g, L.x + 102, L.y + 7, SEQ_EN[L.key], 8.5, '#7f9bb0', false, 'left', 70);
        });

        this._seqPlots = {
            fuel: this._drawChart(g, S.fuelChart, '燃油量 – 时间（最近 3 min）', 100, [0, 50, 100], '%'),
            speed: this._drawChart(g, S.speedChart, '转速 – 时间（最近 3 min）', 2000, [0, 1000, 2000], 'r/min'),
        };
    }

    /** 趋势图框（静态），返回绘图区 */
    _drawChart(g, box, title, yMax, ticks, unit) {
        this._label(g, box.x, box.y - 16, title, 11, '#86c5f8', true);
        g.add(new Konva.Rect({ x: box.x, y: box.y, width: box.w, height: box.h, cornerRadius: 4, fill: '#0b1622', stroke: '#3d5c74', strokeWidth: 1.2 }));
        const px = box.x + 34, py = box.y + 14, pw = box.w - 46, ph = box.h - 36;

        ticks.forEach(v => {
            const y = py + ph - v / yMax * ph;
            g.add(new Konva.Line({ points: [px, y, px + pw, y], stroke: '#1e2c38', strokeWidth: 1 }));
            this._label(g, box.x + 3, y - 6, String(v), 8.5, '#7f9bb0', false, 'right', 28);
        });
        [-180, -120, -60, 0].forEach(sec => {
            const x = px + (sec + TREND_WINDOW) / TREND_WINDOW * pw;
            g.add(new Konva.Line({ points: [x, py, x, py + ph], stroke: '#1a2632', strokeWidth: 1 }));
            this._label(g, x - 15, py + ph + 3, sec === 0 ? '0s' : `${sec}s`, 8.5, '#7f9bb0', false, 'center', 30);
        });
        g.add(new Konva.Line({ points: [px, py, px, py + ph, px + pw, py + ph], stroke: '#4a6a84', strokeWidth: 1.2 }));
        return { px, py, pw, ph };
    }

    // ─────────────────────────────────────────────
    //  左下：起动联锁和执行模块
    // ─────────────────────────────────────────────
    _drawInterlock(g) {
        const B = this._B.inter, I = this._inter;

        g.add(new Konva.Rect({ x: B.x, y: B.y, width: B.w, height: B.h, cornerRadius: 10, fill: '#f4f8fb', stroke: '#c3ccd3', strokeWidth: 1.6 }));
        this._label(g, B.x + 12, B.y + 7, '起动联锁和执行模块', 15, '#0b3d91', true);
        this._label(g, B.x + 178, B.y + 9, 'START INTERLOCK & EXECUTION', 11.5, '#5a6b78');
        this._label(g, B.x + 400, B.y + 9, '8 个条件全部满足 → 起动允许', 11, '#8a5a00', true);

        // 8 个联锁条件
        I.conds.forEach(c => {
            g.add(new Konva.Rect({ x: c.x, y: c.y, width: c.w, height: c.h, cornerRadius: 3, fill: '#ffffff', stroke: '#c3ccd3', strokeWidth: 1 }));
            this._label(g, c.x + 20, c.y + 4, c.cn, 12, '#1b2a35', true, 'left', 180);
            this._label(g, c.x + 202, c.y + 6, c.en, 8.5, '#5a6b78', false, 'left', 132);
        });

        // 与门（矩形 + 8 个输入端 + 输出）
        const GT = I.gate;
        GT.inputs = [];
        for (let i = 0; i < 8; i++) {
            const y = GT.y + 16 + i * 22;
            GT.inputs.push(y);
            g.add(new Konva.Line({ points: [GT.x - 24, y, GT.x, y], stroke: '#4a5560', strokeWidth: 2 }));
            g.add(new Konva.Circle({ x: GT.x - 24, y, radius: 3, fill: '#4a5560' }));
        }
        g.add(new Konva.Line({ points: [GT.x + GT.w, GT.y + GT.h / 2, GT.x + GT.w + 16, GT.y + GT.h / 2], stroke: '#4a5560', strokeWidth: 2.5 }));
        this._label(g, GT.x + GT.w + 20, GT.y + GT.h / 2 - 6, '→', 16, '#1b6b2e', true);

        // 执行链（4 个框）
        I.chain.forEach((c, i) => {
            g.add(new Konva.Rect({ x: c.x, y: c.y, width: c.w, height: c.h, cornerRadius: 5, fill: '#22405a', stroke: '#5d87a6', strokeWidth: 1.4 }));
            this._label(g, c.x + 22, c.y + (i === 3 ? 6 : 4), c.cn, 12, '#ffffff', true, 'left', c.w - 26);
            this._label(g, c.x + 22, c.y + (i === 3 ? 22 : 21), c.en, 8.5, '#a9c6da', false, 'left', c.w - 26);
            if (i < 3) {
                g.add(new Konva.Line({
                    points: [c.x + c.w / 2, c.y + c.h, c.x + c.w / 2, c.y + c.h + 14],
                    stroke: '#5d87a6', strokeWidth: 2.5,
                }));
                g.add(new Konva.Line({
                    points: [c.x + c.w / 2 - 5, c.y + c.h + 10, c.x + c.w / 2, c.y + c.h + 15, c.x + c.w / 2 + 5, c.y + c.h + 10],
                    stroke: '#5d87a6', strokeWidth: 2.5, lineCap: 'round', lineJoin: 'round',
                }));
            }
        });

        // 各缸（8 个小方块由动态层绘制）
    }

    // ─────────────────────────────────────────────
    //  右下：燃油和调速系统
    // ─────────────────────────────────────────────
    _drawFuel(g) {
        const B = this._B.fuel, FU = this._fuel;

        g.add(new Konva.Rect({ x: B.x, y: B.y, width: B.w, height: B.h, cornerRadius: 10, fill: '#fffaf3', stroke: '#c3ccd3', strokeWidth: 1.6 }));
        this._label(g, B.x + 12, B.y + 7, '燃油和调速系统', 15, '#8a5a00', true);
        this._label(g, B.x + 148, B.y + 9, 'FUEL OIL & GOVERNING SYSTEM', 11.5, '#5a6b78');
        this._label(g, B.x + 470, B.y + 9, '转速设定 → 电子调速器 → 油门拉杆 → 高压油泵齿条', 11, '#5d3d00');

        const T = FU.tank, P = FU.pump, Q = FU.qcv, H = FU.hpp, PV = FU.pv;

        // ── 管路（燃油：柜 → 泵 → 速闭阀 → 高压油泵 → 刺破阀）──
        this._pipe(g, [T.x + T.w, T.y + 48, P.cx - P.r, T.y + 48], COL.fuel, 4);
        this._flowArrow(g, P.cx - P.r - 16, T.y + 48, 0, 5, COL.fuel);
        this._pipe(g, [P.cx + P.r, T.y + 48, Q.cx - 14, T.y + 48], COL.fuel, 4);
        this._pipe(g, [Q.cx + 14, T.y + 48, H.x, T.y + 48], COL.fuel, 4);
        this._pipe(g, [H.x + H.w, T.y + 48, PV.cx - 14, T.y + 48], COL.fuel, 4);
        this._flowArrow(g, PV.cx - 30, T.y + 48, 0, 5, COL.fuel);

        // 回油管道（上方回：高压油泵顶部 → 上翻 → 回日用柜）
        const retY = B.y + 32;
        this._pipe(g, [H.x + H.w / 2, H.y, H.x + H.w / 2, retY, T.x + T.w / 2, retY, T.x + T.w / 2, T.y], '#f0a03c', 3.2, [8, 5]);
        this._flowArrow(g, T.x + T.w / 2, retY + 16, 90, 5, '#f0a03c');
        this._label(g, H.x - 100, retY + 4, '回油管道（上方回）', 10.5, '#b45309', true);

        // ── 燃油日用柜 ──
        g.add(new Konva.Rect({ x: T.x, y: T.y, width: T.w, height: T.h, cornerRadius: 4, fill: '#fdf6e3', stroke: '#8a5a00', strokeWidth: 2 }));
        g.add(new Konva.Rect({ x: T.x - 12, y: T.y + 8, width: 10, height: T.h - 16, fill: '#ffffff', stroke: '#8a5a00', strokeWidth: 1.2 }));
        this._label(g, T.x - 8, T.y - 14, '燃油日用柜  F.O. TANK', 11.5, '#5d3d00', true, 'center', T.w + 16);

        // ── 燃油泵 ──
        this._pumpBase(g, P.cx, P.cy, P.r, 'motor');
        this._label(g, P.cx - 34, P.cy + P.r + 16, '燃油泵', 11.5, '#5d3d00', true, 'center', 68);

        // ── 燃油速闭阀（阀芯在动态层绘制，随开关着色）──
        this._label(g, Q.cx - 34, Q.cy - 34, '燃油速闭阀', 11.5, '#5d3d00', true, 'center', 68);

        // ── 高压油泵（上部 + 齿条）──
        g.add(new Konva.Rect({ x: H.x, y: H.y, width: H.w, height: H.h, cornerRadius: 4, fill: '#cfd8de', stroke: '#4a5560', strokeWidth: 1.6 }));
        for (let i = 0; i < 4; i++) {
            g.add(new Konva.Rect({ x: H.x + 8 + i * 22, y: H.y - 12, width: 12, height: 13, cornerRadius: 2, fill: '#9fb0bd', stroke: '#4a5560', strokeWidth: 1 }));
        }
        this._label(g, H.x, H.y + 6, '高压油泵（上部）', 10.5, '#1b2a35', true, 'center', H.w);
        // 齿条槽
        g.add(new Konva.Rect({ x: H.x + 6, y: H.y + H.h - 26, width: H.w - 12, height: 10, cornerRadius: 2, fill: '#8fa0ad', stroke: '#4a5560', strokeWidth: 1 }));

        // ── 刺破阀（PUNCTURE VALVE，有气停油）──
        g.add(new Konva.Rect({ x: PV.cx - 16, y: PV.cy - 16, width: 32, height: 32, cornerRadius: 3, fill: '#ffffff', stroke: '#3d4a54', strokeWidth: 1.6 }));
        g.add(new Konva.Line({ points: [PV.cx - 9, PV.cy - 8, PV.cx + 9, PV.cy + 8], stroke: '#3d4a54', strokeWidth: 2.4 }));
        g.add(new Konva.Line({ points: [PV.cx - 9, PV.cy + 8, PV.cx + 9, PV.cy - 8], stroke: '#3d4a54', strokeWidth: 2.4 }));
        this._pipe(g, [PV.cx, PV.cy - 16, PV.cx, PV.cy - 40], COL.airOn, 2.6);
        this._label(g, PV.cx - 34, PV.cy - 58, '控制空气', 9.5, '#0d47a1', true, 'center', 68);
        this._label(g, PV.cx - 25, PV.cy + 26, '刺破阀', 10.5, '#8e1b1b', true, 'center', 140);
        this._label(g, PV.cx - 25, PV.cy + 40, 'PUNCTURE V/V · 有气停油', 9, '#8e1b1b', false, 'center', 140);

        // ── 转速设定值 / 电子调速器 ──
        const SB = FU.setBox, GB = FU.govBox;
        g.add(new Konva.Rect({ x: SB.x, y: SB.y, width: SB.w, height: SB.h, cornerRadius: 4, fill: '#eef4f8', stroke: '#6d767d', strokeWidth: 1.4 }));
        this._label(g, SB.x, SB.y + 5, '转速设定值', 11.5, '#0b3d91', true, 'center', SB.w);
        this._label(g, SB.x, SB.y + 20, 'SPEED SET', 8.5, '#5a6b78', false, 'center', SB.w);

        g.add(new Konva.Rect({ x: GB.x, y: GB.y, width: GB.w, height: GB.h, cornerRadius: 4, fill: '#eef4f8', stroke: '#6d767d', strokeWidth: 1.4 }));
        this._label(g, GB.x, GB.y + 5, '电子调速器', 11.5, '#0b3d91', true, 'center', GB.w);
        this._label(g, GB.x, GB.y + 20, 'ELECTRONIC GOVERNOR', 8, '#5a6b78', false, 'center', GB.w);

        // 油门拉杆：调速器 → 高压油泵下边
        this._pipe(g, [GB.x + GB.w, GB.y + 26, H.x + H.w - 24, GB.y + 26, H.x + H.w - 24, H.y + H.h], '#c62828', 3);
        this._flowArrow(g, H.x + H.w - 24, H.y + H.h + 20, 270, 5, '#c62828');
        this._label(g, GB.x + GB.w + 6, GB.y + 10, '油门拉杆', 10.5, '#c62828', true);
    }

    // ═══════════════════════════════════════════════════════════
    //  动态节点
    // ═══════════════════════════════════════════════════════════
    _createDynamicNodes() {
        const d = this._dynamicGroup;
        const PN = this._panel, G = this._genset, RM = this._remote, S = this._seq, I = this._inter, FU = this._fuel;

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

        // 控制方式旋钮手柄
        {
            const KB = PN.knob, R = KB.r;
            const handle = new Konva.Group({ x: KB.cx, y: KB.cy, rotation: 0 });
            handle.add(new Konva.Rect({
                x: -4, y: -(R - 6), width: 8, height: (R - 6) * 2, cornerRadius: 4,
                fill: 'rgba(0,0,0,0)', stroke: '#ffffff', strokeWidth: 2,
            }));
            handle.add(new Konva.Rect({ x: -2, y: -(R - 12), width: 4, height: 10, cornerRadius: 1, fill: '#ffffff' }));
            d.add(handle);
            this._modeKnob = handle;
        }
        // 负荷调节旋钮（机组上）
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
        // 盘车机构 / 闭锁手柄旋钮
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

        // ── 机组数值 ──
        this._tags = {};
        this._tags.speed = this._tagValue(G.skid.x + 452, G.skid.y + 5, 12, '#0b3d91');
        this._tags.genU = this._tagValue(G.gen.cx + G.gen.r + 4, G.gen.cy - 26, 13, '#1b2a35');
        this._tags.genF = this._tagValue(G.gen.cx + G.gen.r + 4, G.gen.cy - 2, 13, '#1b2a35');
        this._tags.genP = this._tagValue(G.gen.cx + G.gen.r + 4, G.gen.cy + 22, 13, '#1b2a35');
        this._tags.engineState = this._tagValue(G.engine.x + 12, G.engine.y + G.engine.h - 22, 11, '#ffffff');
        this._airP = this._tagValue(G.airBottle.x + 5, G.airBottle.y + 44, 9.5, '#0b3d91');
        this._airCompLed = new Konva.Circle({ x: G.airComp.x + 50, y: G.airComp.y + G.airComp.h / 2, radius: 4, fill: '#5a1a16', stroke: '#0b0f12', strokeWidth: 1 });
        d.add(this._airCompLed);
        this._airValveLed = new Konva.Circle({ x: G.airValve.cx, y: G.airValve.cy - 14, radius: 3.5, fill: '#39434d', stroke: '#0b0f12', strokeWidth: 1 });
        d.add(this._airValveLed);
        this._spdSensor = new Konva.Rect({
            x: G.sensor.cx - G.sensor.w / 2, y: G.sensor.cy - G.sensor.h / 2,
            width: G.sensor.w, height: G.sensor.h, cornerRadius: 4,
            fill: '#9fb0bd', stroke: '#4a5560', strokeWidth: 1.4,
        });
        d.add(this._spdSensor);

        // ── 遥控模块：指示灯 / 旋钮 / 合分闸灯 / MCCB 手柄 ──
        const mkLampBar = (bx) => {
            const dot = new Konva.Circle({ x: bx.x + 13, y: bx.y + 16, radius: 6, fill: '#14521a', stroke: '#0b0f12', strokeWidth: 1 });
            d.add(dot);
            return dot;
        };
        this._readyDot = mkLampBar(RM.ready);
        this._runDot = mkLampBar(RM.run);

        {
            const K = RM.knob, R = K.r;
            const handle = new Konva.Group({ x: K.cx, y: K.cy, rotation: -135 });
            handle.add(new Konva.Rect({
                x: -4, y: -(R - 6), width: 8, height: (R - 6) * 2, cornerRadius: 4,
                fill: 'rgba(0,0,0,0)', stroke: '#ffffff', strokeWidth: 2,
            }));
            handle.add(new Konva.Rect({ x: -2, y: -(R - 12), width: 4, height: 10, cornerRadius: 1, fill: '#ffffff' }));
            d.add(handle);
            this._setKnob = handle;
            this._setVal = this._tagValue(K.cx - 54, K.cy + 42, 14, '#0b3d91', 'center', 108);
        }
        // 合闸 / 分闸 状态灯（按钮左上角）
        this._closeLamp = new Konva.Circle({ x: RM.close.x + 12, y: RM.close.y + 12, radius: 5.5, fill: '#39434d', stroke: '#0b0f12', strokeWidth: 1 });
        this._openLamp = new Konva.Circle({ x: RM.open.x + 12, y: RM.open.y + 12, radius: 5.5, fill: '#39434d', stroke: '#0b0f12', strokeWidth: 1 });
        d.add(this._closeLamp, this._openLamp);

        {
            const MB = RM.mccb;
            this._mccbHandle = new Konva.Group({ x: MB.x + 90, y: MB.y + 74, rotation: 22 });
            this._mccbHandle.add(new Konva.Rect({
                x: -13, y: -22, width: 26, height: 44, cornerRadius: 4,
                fill: '#c62828', stroke: '#4a0f0f', strokeWidth: 1.5,
            }));
            this._mccbHandle.add(new Konva.Rect({ x: -9, y: -6, width: 18, height: 5, cornerRadius: 2, fill: '#ffd7d3' }));
            d.add(this._mccbHandle);
            this._mccbVal = this._tagValue(MB.x + 8, MB.y + 122, 12.5, '#ffe14d', 'center', MB.w - 16);
        }

        // ── 时序灯 ──
        this._seqLamps = S.lamps.map(L => {
            const dot = new Konva.Circle({ x: L.x + 12, y: L.y + 12, radius: 6, fill: '#1b2a35', stroke: '#0b0f12', strokeWidth: 1 });
            d.add(dot);
            return dot;
        });
        // 趋势曲线
        this._fuelCurve = new Konva.Line({ points: [], stroke: '#ffd24a', strokeWidth: 1.8, lineJoin: 'round', listening: false });
        this._speedCurve = new Konva.Line({ points: [], stroke: '#39e75f', strokeWidth: 1.8, lineJoin: 'round', listening: false });
        d.add(this._fuelCurve, this._speedCurve);
        this._fuelNow = this._tagValue(S.fuelChart.x + S.fuelChart.w - 96, S.fuelChart.y + 6, 12, '#ffd24a', 'right', 92);
        this._speedNow = this._tagValue(S.speedChart.x + S.speedChart.w - 96, S.speedChart.y + 6, 12, '#39e75f', 'right', 92);

        // ── 联锁：8 个条件灯 + 与门 + 执行链 ──
        this._condLeds = I.conds.map(c => {
            const led = new Konva.Circle({ x: c.x + 11, y: c.y + c.h / 2, radius: 5.5, fill: '#5a1a16', stroke: '#0b0f12', strokeWidth: 1 });
            d.add(led);
            return led;
        });
        {
            const GT = I.gate;
            this._gateRect = new Konva.Rect({
                x: GT.x, y: GT.y, width: GT.w, height: GT.h,
                cornerRadius: [4, 60, 60, 4], fill: '#ffffff', stroke: '#4a5560', strokeWidth: 2.2,
            });
            d.add(this._gateRect);
            this._gateTxt = new Konva.Text({
                x: GT.x, y: GT.y + GT.h / 2 - 26, width: GT.w, align: 'center',
                text: 'AND', fontSize: 34, fontStyle: 'bold', fill: '#4a5560', fontFamily: FONT, listening: false,
            });
            this._gateSub = new Konva.Text({
                x: GT.x, y: GT.y + GT.h / 2 + 12, width: GT.w, align: 'center',
                text: '起动联锁 → 起动允许', fontSize: 12, fontStyle: 'bold', fill: '#4a5560', fontFamily: FONT, listening: false,
            });
            d.add(this._gateTxt, this._gateSub);
            this._gateOut = new Konva.Circle({ x: GT.x + GT.w + 30, y: GT.y + GT.h / 2, radius: 7, fill: '#5a1a16', stroke: '#0b0f12', strokeWidth: 1.2 });
            d.add(this._gateOut);
        }
        this._chainLeds = I.chain.slice(0, 3).map(c => {
            const led = new Konva.Circle({ x: c.x + 12, y: c.y + c.h / 2, radius: 4.5, fill: '#1b2a35', stroke: '#0b0f12', strokeWidth: 1 });
            d.add(led);
            return led;
        });
        this._cylDots = [];
        {
            const CY = I.chain[3];
            for (let i = 0; i < 8; i++) {
                const w = 13, gap = 2;
                const x = CY.x + 12 + i * (w + gap);
                const r = new Konva.Rect({ x, y: CY.y + 36, width: w, height: 14, cornerRadius: 2, fill: '#3d5c74', stroke: '#1b2a35', strokeWidth: 1 });
                d.add(r);
                this._cylDots.push(r);
            }
        }

        // ── 燃油与调速：液位 / 泵叶轮 / 阀芯 / 齿条 / 状态 ──
        {
            const Q = FU.qcv;
            this._qcvValve = this._gateValve(d, Q.cx, Q.cy, 0, 13, 9);
        }
        {
            const T = FU.tank;
            this._tankLvl = new Konva.Rect({ x: T.x + 3, y: T.y + 40, width: T.w - 6, height: T.h - 44, fill: '#f0b429', opacity: 0.85 });
            d.add(this._tankLvl);
            this._tankLvl.moveToBottom();
            this._tankLvlTxt = this._tagValue(T.x + 6, T.y + 10, 11, '#5d3d00');
        }
        {
            const P = FU.pump;
            const face = new Konva.Circle({ x: P.cx, y: P.cy, radius: P.r - 1, fill: '#f4f6f7' });
            d.add(face);
            const fan = new Konva.Group({ x: P.cx, y: P.cy, rotation: 0 });
            const R = P.r * 0.7;
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
            fan.add(new Konva.Circle({ x: 0, y: 0, radius: P.r * 0.16, fill: '#6b757a' }));
            d.add(fan);
            this._fuelPumpFan = fan;
            this._fuelPumpFace = face;
        }
        // 高压油泵齿条滑块
        {
            const H = FU.hpp;
            this._rack = new Konva.Rect({
                x: H.x + 10, y: H.y + H.h - 24, width: 14, height: 7, cornerRadius: 2,
                fill: '#e33b32', stroke: '#5a1a16', strokeWidth: 1,
            });
            d.add(this._rack);
            this._fuelQty = this._tagValue(H.x, H.y + H.h + 6, 11.5, '#8a5a00', 'center', H.w);
        }
        // 刺破阀状态灯
        this._pvLamp = new Konva.Circle({ x: FU.pv.cx, y: FU.pv.cy + 26, radius: 5, fill: '#1b2a35', stroke: '#0b0f12', strokeWidth: 1 });
        d.add(this._pvLamp);
        // 调速器状态灯
        {
            const GB = FU.govBox;
            this._govLamp = new Konva.Circle({ x: GB.x + GB.w - 10, y: GB.y + 10, radius: 5, fill: '#1b4a1e', stroke: '#0b0f12', strokeWidth: 1 });
            d.add(this._govLamp);
            this._setBoxVal = this._tagValue(FU.setBox.x, FU.setBox.y + 32, 13, '#0b3d91', 'center', FU.setBox.w);
        }
        this._fuelPressTxt = this._tagValue(FU.tank.x - 8, FU.tank.y + FU.tank.h + 4, 11, '#8a5a00');
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

        const PN = this._panel, G = this._genset, RM = this._remote, I = this._inter, FU = this._fuel;

        // ── 机旁面板 ──
        PN.buttons.forEach(Bt => {
            add(Bt.id, Bt.x, Bt.y, Bt.w, Bt.h, () => {
                const v = sv();
                if (!v) return;
                if (Bt.id === 'eng-start') { v.startEngine('LOCAL'); return; }
                if (Bt.id === 'eng-stop') { v.stopEngine(); return; }
                if (Bt.id === 'emu-stop') { v.emergencyStop(); return; }
                if (Bt.id === 'reset') { v.resetTrips(); return; }
                if (Bt.id === 'lamp-test') { v.lampTest(); }
            });
        });
        PN.lamps.forEach(Ld => add(Ld.id, Ld.x, Ld.y, Ld.w, Ld.h, () => s._tipLamp(Ld.id)));

        const KB = PN.knob;
        add('mode-knob', KB.cx - KB.r, KB.cy - KB.r, KB.r * 2, KB.r * 2, () => { if (sv()) sv().cycleMode(1); });
        add('mode-knob-ccw', KB.cx - KB.r, KB.cy - KB.r, KB.r, KB.r * 2, () => { if (sv()) sv().cycleMode(-1); });

        // ── 机组 ──
        add('engine', G.engine.x, G.engine.y, G.engine.w, G.engine.h, () => s._tipPart('engine'));
        add('generator', G.gen.cx - G.gen.r, G.gen.cy - G.gen.r, G.gen.r * 2, G.gen.r * 2, () => s._tipPart('generator'));
        add('turning-gear', G.turning.x, G.turning.y, G.turning.w, G.turning.h, () => { if (sv()) sv().toggleTurningGear(); });
        add('block-handle', G.block.x, G.block.y, G.block.w, G.block.h, () => { if (sv()) sv().toggleBlockHandle(); });
        add('speed-sensor', G.sensor.cx - 30, G.sensor.cy - 24, 60, 48, () => s._tipPart('speed-sensor'));
        add('turbo', G.turbo.cx - G.turbo.r, G.turbo.cy - G.turbo.r, G.turbo.r * 2, G.turbo.r * 2, () => s._tipPart('turbo'));
        add('air-bottle', G.airBottle.x, G.airBottle.y - 8, G.airBottle.w, G.airBottle.h + 14, () => s._tipPart('air-bottle'));
        add('air-compressor', G.airComp.x, G.airComp.y, G.airComp.w, G.airComp.h, () => s._tipPart('air-compressor'));
        add('start-air-valve', G.airValve.cx - 14, G.airValve.cy - 20, 28, 34, () => s._tipPart('start-air-valve'));
        {
            const K = G.loadKnob;
            add('load-knob-dec', K.cx - K.r, K.cy - K.r, K.r, K.r * 2, () => { if (sv()) sv().stepLoad(-1); });
            add('load-knob-inc', K.cx, K.cy - K.r, K.r, K.r * 2, () => { if (sv()) sv().stepLoad(1); });
        }

        // ── 遥控操作模块 ──
        add('rc-start', RM.start.x, RM.start.y, RM.start.w, RM.start.h, () => { if (sv()) sv().startEngine('REMOTE'); });
        add('rc-stop', RM.stop.x, RM.stop.y, RM.stop.w, RM.stop.h, () => { if (sv()) sv().stopEngine(); });
        add('rc-ready', RM.ready.x, RM.ready.y, RM.ready.w, RM.ready.h, () => s._tipPart('rc-ready'));
        add('rc-running', RM.run.x, RM.run.y, RM.run.w, RM.run.h, () => s._tipPart('rc-running'));
        {
            const K = RM.knob;
            add('speed-dec', K.cx - K.r, K.cy - K.r, K.r, K.r * 2, () => { if (sv()) sv().stepSetpoint(-1); });
            add('speed-inc', K.cx, K.cy - K.r, K.r, K.r * 2, () => { if (sv()) sv().stepSetpoint(1); });
        }
        add('breaker-close', RM.close.x, RM.close.y, RM.close.w, RM.close.h, () => { if (sv()) sv().closeBreaker(); });
        add('breaker-open', RM.open.x, RM.open.y, RM.open.w, RM.open.h, () => { if (sv()) sv().openBreaker(); });
        {
            const MB = RM.mccb;
            const hit = add('load-mccb', MB.x, MB.y, MB.w, MB.h, () => { if (sv()) sv().toggleLoadTest(); });
            hit.on('dblclick', () => s._editLoadKw());
        }

        // ── 起动时序与监控 ──
        add('seq-monitor', this._B.seq.x + 12, this._B.seq.y + 36, 184, 248, () => s._tipPart('seq-monitor'));
        add('fuel-chart', this._seq.fuelChart.x, this._seq.fuelChart.y, this._seq.fuelChart.w, this._seq.fuelChart.h, () => s._tipPart('fuel-chart'));
        add('speed-chart', this._seq.speedChart.x, this._seq.speedChart.y, this._seq.speedChart.w, this._seq.speedChart.h, () => s._tipPart('speed-chart'));

        // ── 起动联锁和执行模块 ──
        I.conds.forEach((c, i) => add('cond-' + c.key, c.x, c.y, c.w, c.h, () => s._tipCond(i)));
        add('interlock-gate', I.gate.x, I.gate.y, I.gate.w, I.gate.h, () => s._tipPart('interlock-gate'));
        add('exec-solenoid', I.chain[0].x, I.chain[0].y, I.chain[0].w, I.chain[0].h, () => s._tipPart('exec-solenoid'));
        add('exec-main-valve', I.chain[1].x, I.chain[1].y, I.chain[1].w, I.chain[1].h, () => {
            const v = sv(); if (v) v.togglePneuFault();
        });
        add('exec-distributor', I.chain[2].x, I.chain[2].y, I.chain[2].w, I.chain[2].h, () => {
            const v = sv(); if (v) v.toggleDistributorFault();
        });
        add('exec-cylinders', I.chain[3].x, I.chain[3].y, I.chain[3].w, I.chain[3].h, () => s._tipPart('exec-cylinders'));

        // ── 燃油和调速系统 ──
        add('fuel-tank', FU.tank.x, FU.tank.y, FU.tank.w, FU.tank.h, () => s._tipPart('fuel-tank'));
        add('fuel-pump', FU.pump.cx - FU.pump.r, FU.pump.cy - FU.pump.r, FU.pump.r * 2, FU.pump.r * 2, () => {
            const v = sv(); if (v) v.toggleFuelPump();
        });
        add('fuel-quickclose', FU.qcv.cx - 16, FU.qcv.cy - 16, 32, 32, () => {
            const v = sv(); if (v) v.toggleQuickClose();
        });
        add('hp-pump', FU.hpp.x, FU.hpp.y, FU.hpp.w, FU.hpp.h, () => s._tipPart('hp-pump'));
        add('puncture-valve', FU.pv.cx - 20, FU.pv.cy - 22, 40, 48, () => {
            const v = sv(); if (v) v.togglePunctureAir();
        });
        add('gov-box', FU.govBox.x, FU.govBox.y, FU.govBox.w, FU.govBox.h, () => {
            const v = sv(); if (v) v.toggleGovFault();
        });
        add('speed-set', FU.setBox.x, FU.setBox.y, FU.setBox.w, FU.setBox.h, () => s._tipPart('speed-set'));
    }

    /** 双击负荷测试开关 → 编辑负载值（kW） */
    _editLoadKw() {
        const v = this._solver();
        if (!v || !this.sys || !this.sys.container) return;
        const MB = this._remote.mccb;
        const node = this._mccbVal;
        let box;
        try {
            box = node.getClientRect({ relativeTo: this.sys.stage });
        } catch (e) {
            const p = this.group.getAbsoluteTransform().point({ x: MB.x + 8, y: MB.y + 122 });
            box = { x: p.x, y: p.y, width: MB.w - 16, height: 16 };
        }
        const input = document.createElement('input');
        input.type = 'number';
        input.step = '10';
        input.value = String(v.m.loadTest.kw);
        Object.assign(input.style, {
            position: 'absolute', left: box.x + 'px', top: box.y - 2 + 'px',
            width: Math.max(60, box.width) + 'px', height: (box.height + 6) + 'px',
            zIndex: '9999', boxSizing: 'border-box', textAlign: 'center', fontSize: '13px',
            fontFamily: 'sans-serif', border: '2px solid #1395eb', borderRadius: '2px',
            outline: 'none', background: '#ffffff', padding: '0 2px',
        });
        let finished = false;
        const done = (commit) => {
            if (finished) return;
            finished = true;
            if (input.parentNode) input.parentNode.removeChild(input);
            if (!commit) return;
            const val = parseFloat(input.value);
            if (!isNaN(val)) v.setLoadKw(val);
            this._syncVisuals();
        };
        input.addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.key === 'Enter') { e.preventDefault(); done(true); }
            else if (e.key === 'Escape') { e.preventDefault(); done(false); }
        });
        input.addEventListener('blur', () => done(true));
        input.addEventListener('mousedown', (e) => e.stopPropagation());
        input.addEventListener('click', (e) => e.stopPropagation());
        this.sys.container.appendChild(input);
        requestAnimationFrame(() => { input.focus(); input.select(); });
    }

    // ═══════════════════════════════════════════════════════════
    //  提示
    // ═══════════════════════════════════════════════════════════
    _tipLamp(id) {
        const v = this._solver();
        if (!v) return;
        const m = v.m;
        const T = {
            'led-manu-stop': `手动紧急停车灯：${m.trips.estop ? '亮（已紧急停车）' : '灭'}`,
            'led-htfw-trip': `水高温跳闸灯：${m.trips.htTemp ? '亮' : '灭'}`,
            'led-start-fail': `起动失败灯：${m.engine.startFail ? '亮（上次起动失败）' : '灭'}`,
            'led-ready': `准备起动灯：${v.readyForStart() ? '亮（8 个起动条件全部满足）' : '灭'}`,
            'led-remote': `遥控位置灯：${m.mode === 'REMOTE' ? '亮' : '灭'}`,
            'led-lo-lp-trip': `滑油低压跳闸灯：${m.trips.loPress ? '亮' : '灭'}`,
            'led-overspeed': `超速跳闸灯：${m.trips.overspeed ? '亮（保护已动作）' : '灭'}`,
            'led-running': `机组运行灯：${m.engine.running ? '亮' : '灭'}`,
            'led-local': `机旁位置灯：${m.mode === 'LOCAL' ? '亮' : '灭'}`,
            'led-dc24': '直流 24 V 电源指示灯（常亮）',
        };
        this._tip(T[id] || id);
    }

    _tipCond(i) {
        const v = this._solver();
        if (!v) return;
        const c = v.conditions()[i];
        if (!c) return;
        const m = v.m;
        const val = {
            turningGear: m.turningGear ? '啮合' : '脱开',
            blockHandle: m.blockHandle ? 'STOP 位' : 'WORK 位',
            safety: m.trips.estop ? '紧急停车未复位' : '已复位',
            airPress: `${(m.air.press / 10).toFixed(2)} MPa`,
            fuelPress: `${(m.fuel.press / 10).toFixed(2)} MPa`,
            governor: m.gov.fault ? '故障' : '正常',
            breaker: m.breaker.closed ? '合闸' : '分闸',
            engineSpeed: `${m.engine.speed.toFixed(0)} r/min`,
        }[c.key];
        this._tip(`起动联锁条件：${c.cn} —— 当前 ${val}，${c.ok ? '满足（绿灯亮）' : '不满足'}`);
    }

    _tipPart(id) {
        const v = this._solver();
        if (!v) return;
        const m = v.m, E = m.engine;
        const tips = {
            engine: `柴油机：${E.running ? '运转' : (E.cranking ? '起动中' : '停车')}，转速 ${E.speed.toFixed(0)} r/min，`
                + `燃油量 ${E.fuel.toFixed(0)} %，负荷 ${E.load.toFixed(0)} %`,
            generator: `同步发电机：${m.gen.volt > 0 ? `${m.gen.volt.toFixed(0)} V / ${m.gen.freq.toFixed(1)} Hz / ${m.gen.kw.toFixed(0)} kW` : '未建压'}`,
            'speed-sensor': `磁电式转速传感器：输出转速信号 ${E.speed.toFixed(0)} r/min`,
            turbo: '废气涡轮增压器：利用排气能量驱动压气机',
            'air-bottle': `起动空气瓶：${(m.air.press / 10).toFixed(2)} MPa（最低起动压力 ${(m.air.min / 10).toFixed(1)} MPa）`
                + (m.air.press < m.air.min ? ' —— 压力低，不能起动！' : ''),
            'air-compressor': `电动空压机：${m.air.compOn ? '自动' : '已切除'}，${m.air.comp ? '补气中' : '停止'}`,
            'start-air-valve': `起动空气阀（主起动阀）：${m.exec.mainValve ? '打开（起动空气进入各缸）' : '关闭'}`,
            'rc-ready': `Ready For Start：${v.readyForStart() ? '亮（8 个起动条件全部满足）' : '灭'}`,
            'rc-running': `Running：${E.running ? '亮（机组运行）' : '灭'}`,
            'seq-monitor': `起动时序：当前「${v.seqText()}」，起动指令后 ${m.seqT.toFixed(1)} s`,
            'fuel-chart': `燃油量趋势：当前 ${E.fuel.toFixed(0)} %，保留最近 3 min`,
            'speed-chart': `转速趋势：当前 ${E.speed.toFixed(0)} r/min，保留最近 3 min`,
            'interlock-gate': `起动联锁与门：8 个条件${m.condOk ? '全部满足（绿色填充），允许起动' : '未全部满足，禁止起动'}`
                + (m.condOk ? '' : `；未满足：${v.conditions().filter(c => !c.ok).map(c => c.cn).join('、')}`),
            'exec-solenoid': `起动电磁阀：${m.exec.solenoid ? '得电（起动指令有效）' : '失电'}`,
            'exec-main-valve': `主起动阀：${m.exec.mainValve ? '打开' : '关闭'}；点击可模拟气动控制阀故障（当前${m.faults.pneu ? '故障' : '正常'}）`,
            'exec-distributor': `空气分配器：${m.exec.distributor ? '按发火顺序送气' : '未工作'}；点击可模拟分配器故障（当前${m.faults.distributor ? '故障' : '正常'}）`,
            'exec-cylinders': '各缸起动阀：起动空气按发火顺序依次进入 1~8 缸',
            'fuel-tank': `燃油日用柜：液位 ${m.fuel.tankLevel.toFixed(0)} %，燃油压力 ${(m.fuel.press / 10).toFixed(2)} MPa`,
            'hp-pump': `高压油泵（上部）：齿条位置 ${m.gov.rack.toFixed(0)} %，燃油量 ${E.fuel.toFixed(0)} %`,
            'speed-set': `转速设定值：${m.gov.setpoint.toFixed(0)} r/min（在遥控模块调速旋钮上调整）`,
        };
        this._tip(tips[id] || id);
    }

    // ═══════════════════════════════════════════════════════════
    //  显示同步
    // ═══════════════════════════════════════════════════════════
    _syncVisuals() {
        const svReal = this._solver();
        const sv = svReal || (this._fallbackSolver = this._fallbackSolver || new GensetStartSolver(this.sys));
        const m = sv.m;
        const E = m.engine;

        this._animT += 1;
        const blink = (this._animT % 20) < 12;

        // ── 面板灯 ──
        const lit = {
            'led-manu-stop': m.trips.estop,
            'led-htfw-trip': m.trips.htTemp,
            'led-start-fail': E.startFail,
            'led-ready': sv.readyForStart(),
            'led-remote': m.mode === 'REMOTE',
            'led-lo-lp-trip': m.trips.loPress,
            'led-overspeed': m.trips.overspeed,
            'led-running': E.running,
            'led-local': m.mode === 'LOCAL',
            'led-dc24': true,
        };
        const DEF = {};
        LAMP_DEFS.forEach(L => { DEF[L.id] = L.kind; });
        Object.keys(this._lampDots).forEach(id => {
            const dot = this._lampDots[id];
            const kind = DEF[id];
            const on = m.lampTest ? blink : !!lit[id];
            const color = kind === 'red' ? (on ? '#ff3b30' : '#5a1a16') : (on ? '#39e75f' : '#14521a');
            if (dot._c !== color) { dot._c = color; dot.fill(color); }
        });

        if (this._modeKnob) {
            const rot = m.mode === 'BLOCK' ? -90 : (m.mode === 'LOCAL' ? 0 : 90);
            if (this._modeKnob.rotation() !== rot) this._modeKnob.rotation(rot);
        }
        if (this._loadKnob) {
            const pct = Math.max(0, Math.min(100, m.engine.load));
            const rot = -135 + pct * 2.7;
            if (Math.abs(this._loadKnob.rotation() - rot) > 0.05) this._loadKnob.rotation(rot);
            const txt = `${pct.toFixed(0)} %`;
            if (this._loadVal && this._loadVal.text() !== txt) this._loadVal.text(txt);
        }
        if (this._tgKnob) this._tgKnob.rotation(m.turningGear ? -45 : 45);
        if (this._bhKnob) this._bhKnob.rotation(m.blockHandle ? 45 : -45);

        // ── 机组转动件 ──
        const running = !!E.running;
        const spin = E.speed > 0 ? Math.max(0.6, E.speed / 300) : 0;
        if (this._flywheel) this._flywheel.rotation((this._flywheel.rotation() + spin * 3) % 360);
        if (this._rotor) this._rotor.rotation((this._rotor.rotation() + spin * 2) % 360);
        this._flames.forEach((fg, i) => {
            const burn = running && !m.fuelCut && !m.trips.estop;
            fg.visible(burn);
            if (!burn) return;
            fg.scaleY(0.82 + 0.26 * Math.sin((this._animT + i * 7) * 0.5));
            fg.scaleX(0.95 + 0.12 * Math.sin((this._animT + i * 4) * 0.8));
        });

        // ── 机组数值 ──
        const setTag = (key, txt) => {
            const t = this._tags[key];
            if (t && t.text() !== txt) t.text(txt);
        };
        setTag('speed', `n ${E.speed.toFixed(0)} r/min`);
        setTag('genU', `U ${m.gen.volt.toFixed(0)}V`);
        setTag('genF', `f ${m.gen.freq.toFixed(1)}Hz`);
        setTag('genP', `P ${m.gen.kw.toFixed(0)}kW`);
        setTag('engineState', m.trips.estop ? '紧急停车' : (running ? '运行 RUNNING' : (E.cranking ? '起动中 STARTING' : '停车 STOPPED')));

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
            const c = m.exec.mainValve ? '#39e75f' : '#39434d';
            if (this._airValveLed._c !== c) { this._airValveLed._c = c; this._airValveLed.fill(c); }
        }
        if (this._spdSensor) {
            const c = E.speed > 500 ? '#2ecc40' : '#9fb0bd';
            if (this._spdSensor._c !== c) { this._spdSensor._c = c; this._spdSensor.fill(c); }
        }

        // ── 遥控模块 ──
        if (this._readyDot) {
            const c = sv.readyForStart() ? '#39e75f' : '#14521a';
            if (this._readyDot._c !== c) { this._readyDot._c = c; this._readyDot.fill(c); }
        }
        if (this._runDot) {
            const c = E.running ? '#39e75f' : '#14521a';
            if (this._runDot._c !== c) { this._runDot._c = c; this._runDot.fill(c); }
        }
        if (this._setKnob) {
            const rot = -135 + (m.gov.setpoint - 1500) / 400 * 270;
            if (Math.abs(this._setKnob.rotation() - rot) > 0.05) this._setKnob.rotation(rot);
            const txt = `${m.gov.setpoint.toFixed(0)} r/min`;
            if (this._setVal && this._setVal.text() !== txt) this._setVal.text(txt);
        }
        if (this._closeLamp) {
            const c = m.breaker.closed ? '#39e75f' : '#39434d';
            if (this._closeLamp._c !== c) { this._closeLamp._c = c; this._closeLamp.fill(c); }
        }
        if (this._openLamp) {
            const c = m.breaker.closed ? '#39434d' : '#39e75f';
            if (this._openLamp._c !== c) { this._openLamp._c = c; this._openLamp.fill(c); }
        }
        if (this._mccbHandle) {
            const rot = m.loadTest.on ? -24 : 24;
            if (Math.abs(this._mccbHandle.rotation() - rot) > 0.05) this._mccbHandle.rotation(rot);
        }
        if (this._mccbVal) {
            const txt = `负载 ${m.loadTest.kw.toFixed(0)} kW`;
            if (this._mccbVal.text() !== txt) this._mccbVal.text(txt);
        }

        // ── 起动时序灯（9 个互斥）──
        this._seqLamps.forEach((dot, i) => {
            const on = SEQ_STEPS[i] === m.seq;
            const c = on ? (m.seq === 'STABLE' ? '#39e75f' : m.seq === 'STOP' ? '#ff3b30' : '#ffd24a') : '#1b2a35';
            if (dot._c !== c) { dot._c = c; dot.fill(c); }
        });

        // ── 趋势曲线 ──
        const updCurve = (curve, plot, key, max) => {
            const h = m.hist;
            const base = m.clock - TREND_WINDOW;
            const pts = [];
            for (let i = 0; i < h.t.length; i++) {
                const t = h.t[i] - base;
                if (t < 0) continue;
                const x = plot.px + t / TREND_WINDOW * plot.pw;
                const y = plot.py + plot.ph - Math.max(0, Math.min(max, h[key][i])) / max * plot.ph;
                pts.push(x, y);
            }
            curve.points(pts);
        };
        if (this._seqPlots) {
            updCurve(this._fuelCurve, this._seqPlots.fuel, 'fuel', 100);
            updCurve(this._speedCurve, this._seqPlots.speed, 'speed', 2000);
        }
        if (this._fuelNow) {
            const txt = `${E.fuel.toFixed(0)} %`;
            if (this._fuelNow.text() !== txt) this._fuelNow.text(txt);
        }
        if (this._speedNow) {
            const txt = `${E.speed.toFixed(0)} r/min`;
            if (this._speedNow.text() !== txt) this._speedNow.text(txt);
        }

        // ── 联锁条件灯 / 与门 / 执行链 ──
        const conds = sv.conditions();
        this._condLeds.forEach((led, i) => {
            const ok = conds[i] && conds[i].ok;
            const c = ok ? '#39e75f' : '#ff3b30';
            if (led._c !== c) { led._c = c; led.fill(c); }
        });
        if (this._gateRect) {
            const ok = m.condOk;
            const fill = ok ? '#c8e6c9' : '#ffffff';
            const stroke = ok ? '#1b6b2e' : '#4a5560';
            if (this._gateRect._f !== fill) { this._gateRect._f = fill; this._gateRect.fill(fill); }
            if (this._gateRect._s !== stroke) { this._gateRect._s = stroke; this._gateRect.stroke(stroke); }
            const tc = ok ? '#1b6b2e' : '#4a5560';
            if (this._gateTxt.fill() !== tc) { this._gateTxt.fill(tc); this._gateSub.fill(tc); }
        }
        if (this._gateOut) {
            const c = m.condOk ? '#39e75f' : '#5a1a16';
            if (this._gateOut._c !== c) { this._gateOut._c = c; this._gateOut.fill(c); }
        }
        if (this._chainLeds) {
            const states = [m.exec.solenoid, m.exec.mainValve, m.exec.distributor];
            this._chainLeds.forEach((led, i) => {
                const c = states[i] ? '#39e75f' : (i === 1 && m.faults.pneu ? '#ff3b30' : i === 2 && m.faults.distributor ? '#ff3b30' : '#1b2a35');
                if (led._c !== c) { led._c = c; led.fill(c); }
            });
        }
        if (this._cylDots) {
            this._cylDots.forEach((r, i) => {
                const c = (m.exec.cyl === i) ? '#39e75f' : (m.exec.distributor ? '#2f8fe0' : '#3d5c74');
                if (r._c !== c) { r._c = c; r.fill(c); }
            });
        }

        // ── 燃油与调速 ──
        if (this._tankLvl) {
            const T = this._fuel.tank;
            const hh = Math.max(6, (T.h - 44) * Math.max(0, Math.min(100, m.fuel.tankLevel)) / 100);
            this._tankLvl.height(hh);
            this._tankLvl.y(T.y + T.h - 4 - hh);
        }
        if (this._tankLvlTxt) {
            const txt = `L ${m.fuel.tankLevel.toFixed(0)} %`;
            if (this._tankLvlTxt.text() !== txt) this._tankLvlTxt.text(txt);
        }
        if (this._fuelPumpFan) {
            const run = !!m.fuel.pumpRun;
            this._fuelPumpFace.fill(run ? '#d8f5d0' : '#f4f6f7');
            if (run) this._fuelPumpFan.rotation((this._fuelPumpFan.rotation() + 14) % 360);
        }
        if (this._qcvValve) {
            const open = !m.fuel.quickClose;
            const c = open ? COL.on : COL.off;
            if (this._qcvValve.a._c !== c) {
                this._qcvValve.a._c = c; this._qcvValve.b._c = c;
                this._qcvValve.a.fill(c); this._qcvValve.b.fill(c);
            }
        }
        if (this._rack) {
            const H = this._fuel.hpp;
            const w = H.w - 12;
            const x = H.x + 6 + (H.w - 12 - 14) * Math.max(0, Math.min(100, m.gov.rack)) / 100;
            if (Math.abs(this._rack.x() - x) > 0.3) this._rack.x(x);
        }
        if (this._fuelQty) {
            const txt = `燃油量 ${E.fuel.toFixed(0)} %`;
            if (this._fuelQty.text() !== txt) this._fuelQty.text(txt);
        }
        if (this._pvLamp) {
            const c = m.fuel.punctureAir ? '#ff3b30' : '#1b2a35';
            if (this._pvLamp._c !== c) { this._pvLamp._c = c; this._pvLamp.fill(c); }
        }
        if (this._govLamp) {
            const c = m.gov.fault ? '#ff3b30' : '#39e75f';
            if (this._govLamp._c !== c) { this._govLamp._c = c; this._govLamp.fill(c); }
        }
        if (this._setBoxVal) {
            const txt = `${m.gov.setpoint.toFixed(0)} r/min`;
            if (this._setBoxVal.text() !== txt) this._setBoxVal.text(txt);
        }
        if (this._fuelPressTxt) {
            const txt = `P ${(m.fuel.press / 10).toFixed(2)} MPa`;
            if (this._fuelPressTxt.text() !== txt) this._fuelPressTxt.text(txt);
            const c = m.fuel.press >= m.fuel.minPress ? '#1b6b2e' : '#c62828';
            if (this._fuelPressTxt._c !== c) { this._fuelPressTxt._c = c; this._fuelPressTxt.fill(c); }
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

export default GensetStartMimic;
