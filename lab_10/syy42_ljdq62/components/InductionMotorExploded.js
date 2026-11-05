import { BaseComponent } from './BaseComponent.js';

/**
 * 三相异步电动机（2D 侧视爆炸图 · 可拆装）
 *
 * ── 功能 ────────────────────────────────────────────────────
 *  1. 二维侧视剖视造型：机座（剖视窗口可见转子）、前端盖、后端盖、
 *     前/后轴承盖、转轴/转子、前/后轴承、风扇、风扇罩、联轴器、
 *     接线盒、底座。
 *  2. 右侧"工具箱"：拉具、螺丝刀、铜管、铜棒、木棒、手锤、木板。
 *     拆卸某部件前必须勾选其所需工具，否则拆不动；拆下后工具自动取消勾选。
 *  3. 拆卸工艺顺序（强制）：
 *       打标记 → 拆联轴器 → 拆风扇罩 → 拆风扇 →
 *       拆前轴承盖（松开后端盖）→ 转子/前后轴承/后端盖/后轴承盖整体拆下 →
 *       拆前端盖 → 从转子上拆后轴承盖 → 拆后端盖 → 拆前轴承 → 拆后轴承
 *     顺序错误或工具未勾选均弹出提示且不执行。
 *  4. 拆下的零件落入下方"拆解零件摆放区"；转子总成先落于中部"转子总成"区，
 *     再逐个分离零件。支持"重新装配"复位。
 *
 * ── 端口 ────────────────────────────────────────────────────
 *  无电气端口（纯拆装演示组件）。
 */
export class InductionMotorExploded extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width = Math.max(1000, config.width || 1200);
        this.height = Math.max(500, config.height || 620);

        this.type = 'motor_exploded';

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        this.config = { id: this.id, label: this.label };
    }

    // ═══════════════════════════════════════════
    // 参数与几何
    // ═══════════════════════════════════════════

    _initParameters(config) {
        this.label = (config && config.label) || '三相异步电动机拆装';

        // 零件：cx/cy 为该零件在"组装态"下的视觉中心，slot 为摆放区槽位序号（-1 表示不占槽）
        this._partMeta = {
            coupling:          { name: '联轴器',   cx: 205, cy: 210, w: 70,  h: 70,  slot: 0, req: [['puller']] },
            fanCover:          { name: '风扇罩',   cx: 780, cy: 210, w: 120, h: 120, slot: 1, req: [['screwdriver']] },
            fan:               { name: '风扇',     cx: 770, cy: 210, w: 104, h: 104, slot: 2, req: [['copperRod', 'hammer']] },
            frontBearingCover: { name: '前轴承盖', cx: 320, cy: 210, w: 28,  h: 104, slot: 3, req: [['screwdriver']] },
            rotor:             { name: '转子总成', cx: 460, cy: 210, w: 580, h: 100, slot: -1, req: [['woodBoard', 'hammer']] },
            frontCover:        { name: '前端盖',   cx: 350, cy: 210, w: 32,  h: 190, slot: 4, req: [['screwdriver', 'woodRod', 'hammer']] },
            rearBearingCover:  { name: '后轴承盖', cx: 700, cy: 210, w: 28,  h: 104, slot: 5, req: [['screwdriver']] },
            rearCover:         { name: '后端盖',   cx: 670, cy: 210, w: 32,  h: 190, slot: 6, req: [] },
            frontBearing:      { name: '前轴承',   cx: 392, cy: 210, w: 32,  h: 64,  slot: 7, req: [['puller'], ['copperRod', 'hammer']] },
            rearBearing:       { name: '后轴承',   cx: 628, cy: 210, w: 32,  h: 64,  slot: 8, req: [['puller'], ['copperRod', 'hammer']] },
        };

        // 拆卸顺序（前一项为后一项的前置）
        this._order = ['coupling', 'fanCover', 'fan', 'frontBearingCover', 'rotor',
            'frontCover', 'rearBearingCover', 'rearCover', 'frontBearing', 'rearBearing'];

        // 随转子整体拆下的零件
        this._assemblyParts = ['rotor', 'frontBearing', 'rearBearing', 'rearCover', 'rearBearingCover'];

        this._tools = {};
        this._toolList = [
            { key: 'puller', name: '拉具' },
            { key: 'screwdriver', name: '螺丝刀' },
            { key: 'copperTube', name: '铜管' },
            { key: 'copperRod', name: '铜棒' },
            { key: 'woodRod', name: '木棒' },
            { key: 'hammer', name: '手锤' },
            { key: 'woodBoard', name: '木板' },
        ];
        this._toolName = {};
        this._toolList.forEach(t => { this._toolName[t.key] = t.name; });

        this._removed = {};
        this._marked = false;
        this._loosened = false;
        this._tx = {};
        this._hitTL = {};
        this._hotspotGroups = {};
        this._partLabelNodes = {};
        this._animTimers = {};
    }

    _recalcGeometry() {
        this._axisY = 210;
        // 机座（剖视：四边矩形 + 中间窗口露出转子）
        this._frame = { x1: 350, x2: 670, y1: 115, y2: 305 };
        this._win = { x1: 400, x2: 620, y1: 135, y2: 285 };

        // 中部"转子总成"落位（缩放 s、位移）
        this._asm = { x: 177, y: 294.5, s: 0.55, cxx: 430, cyy: 410 };
        // 工具箱
        this._toolX0 = 910;
        this._toolW = 180;

        // 下部"拆解零件摆放区"
        this._trayY = 535;
        this._slotStep = 108;
        this._slot0 = 66;
    }

    _slotX(i) { return this._slot0 + i * this._slotStep; }

    _trayScale(meta) {
        return Math.min(96 / meta.w, 92 / meta.h, 1);
    }

    // ═══════════════════════════════════════════
    // 绘制
    // ═══════════════════════════════════════════

    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
    }

    _drawStaticParts() {
        const s = this._staticGroup;

        // 重新装配按钮（最左）
        s.add(new Konva.Rect({
            x: 16, y: 20, width: 104, height: 36, fill: '#e8eef7',
            stroke: '#93a6c6', strokeWidth: 1.2, cornerRadius: 6, listening: false,
        }));
        s.add(new Konva.Text({
            x: 16, y: 29, width: 104, align: 'center', text: '重新装配',
            fontSize: 14, fill: '#1f3a5f', listening: false,
        }));

        // 标题
        s.add(new Konva.Text({
            x: 136, y: 22, text: this.label, fontSize: 20, fontStyle: 'bold',
            fill: '#1f3a5f', listening: false,
        }));
        s.add(new Konva.Text({
            x: 136, y: 48, text: '先勾选所需工具，再按工艺顺序点击部件拆卸', fontSize: 12,
            fill: '#6b7280', listening: false,
        }));

        this._drawToolboxPanel(s);
        this._drawFrame(s);
        this._drawBase(s);
        this._drawTerminalBox(s);

        // 零件（z 顺序：后面的覆盖前面的）
        this._partGroups = {};
        this._partGroups.rotor = this._buildRotor();
        s.add(this._partGroups.rotor);

        this._partGroups.frontCover = this._buildCover(350);
        s.add(this._partGroups.frontCover);

        this._partGroups.rearCover = this._buildCover(670);
        s.add(this._partGroups.rearCover);

        this._partGroups.frontBearingCover = this._buildBearingCover(320);
        s.add(this._partGroups.frontBearingCover);

        this._partGroups.rearBearingCover = this._buildBearingCover(700);
        s.add(this._partGroups.rearBearingCover);

        this._partGroups.frontBearing = this._buildBearing(376);
        s.add(this._partGroups.frontBearing);

        this._partGroups.rearBearing = this._buildBearing(612);
        s.add(this._partGroups.rearBearing);

        this._partGroups.fan = this._buildFan();
        s.add(this._partGroups.fan);

        this._partGroups.fanCover = this._buildFanCover();
        s.add(this._partGroups.fanCover);

        this._partGroups.coupling = this._buildCoupling();
        s.add(this._partGroups.coupling);

        this._drawTray(s);
        this._drawPartLabels(s);
    }

    _drawToolboxPanel(s) {
        const x0 = this._toolX0, w = this._toolW;
        s.add(new Konva.Rect({
            x: x0, y: 62, width: w, height: 420, fill: '#f4f7fb',
            stroke: '#c7d3e3', strokeWidth: 1.2, cornerRadius: 8, listening: false,
        }));
        s.add(new Konva.Text({
            x: x0 + 12, y: 72, text: '工具箱', fontSize: 15, fontStyle: 'bold',
            fill: '#1f3a5f', listening: false,
        }));
        this._toolCheckNodes = {};
        this._toolList.forEach((t, i) => {
            const y = 100 + i * 56;
            s.add(new Konva.Rect({
                x: x0 + 6, y, width: w - 12, height: 46, fill: '#ffffff',
                stroke: '#dbe4f0', strokeWidth: 1, cornerRadius: 6, listening: false,
            }));
            const box = new Konva.Rect({
                x: x0 + 14, y: y + 14, width: 18, height: 18, fill: '#ffffff',
                stroke: '#94a3b8', strokeWidth: 1.5, cornerRadius: 3, listening: false,
            });
            const check = new Konva.Line({
                points: [x0 + 17, y + 23, x0 + 21, y + 28, x0 + 30, y + 17],
                stroke: '#16a34a', strokeWidth: 3, lineCap: 'round', lineJoin: 'round',
                visible: false, listening: false,
            });
            s.add(box, check);
            this._drawToolIcon(s, t.key, x0 + 40, y + 10);
            s.add(new Konva.Text({
                x: x0 + 72, y: y + 14, text: t.name, fontSize: 14, fill: '#334155', listening: false,
            }));
            this._toolCheckNodes[t.key] = { box, check };
        });
    }

    _drawToolIcon(s, key, x, y) {
        const add = (node) => { node.listening(false); s.add(node); };
        switch (key) {
            case 'puller': // 拉具：两根拉爪 + 横梁
                add(new Konva.Rect({ x, y: y + 6, width: 26, height: 5, fill: '#64748b' }));
                add(new Konva.Line({ points: [x + 5, y + 11, x + 2, y + 24], stroke: '#64748b', strokeWidth: 3 }));
                add(new Konva.Line({ points: [x + 21, y + 11, x + 24, y + 24], stroke: '#64748b', strokeWidth: 3 }));
                add(new Konva.Rect({ x: x + 11, y, width: 4, height: 8, fill: '#94a3b8' }));
                break;
            case 'screwdriver': // 螺丝刀
                add(new Konva.Rect({ x: x + 9, y, width: 8, height: 14, fill: '#dc2626', cornerRadius: 2 }));
                add(new Konva.Rect({ x: x + 11, y: y + 14, width: 4, height: 12, fill: '#94a3b8' }));
                break;
            case 'copperTube': // 铜管（空心）
                add(new Konva.Rect({ x, y: y + 6, width: 26, height: 12, fill: '#c47a3a', stroke: '#8a5522', strokeWidth: 1 }));
                add(new Konva.Rect({ x: x + 4, y: y + 9, width: 18, height: 6, fill: '#f4f7fb' }));
                break;
            case 'copperRod': // 铜棒
                add(new Konva.Rect({ x, y: y + 8, width: 26, height: 8, fill: '#c47a3a', stroke: '#8a5522', strokeWidth: 1, cornerRadius: 3 }));
                break;
            case 'woodRod': // 木棒
                add(new Konva.Rect({ x, y: y + 8, width: 26, height: 8, fill: '#c8a06a', stroke: '#8a6a3a', strokeWidth: 1, cornerRadius: 3 }));
                break;
            case 'hammer': // 手锤
                add(new Konva.Rect({ x: x + 2, y, width: 16, height: 8, fill: '#64748b', cornerRadius: 2 }));
                add(new Konva.Rect({ x: x + 8, y: y + 8, width: 4, height: 18, fill: '#c8a06a' }));
                break;
            case 'woodBoard': // 木板
                add(new Konva.Rect({ x, y: y + 4, width: 26, height: 16, fill: '#c8a06a', stroke: '#8a6a3a', strokeWidth: 1, cornerRadius: 2 }));
                break;
        }
    }

    _drawFrame(s) {
        const f = this._frame, w = this._win;
        const fill = '#5b78a8', stroke = '#33475f';
        const mk = (x, y, ww, hh) => new Konva.Rect({
            x, y, width: ww, height: hh, fill, stroke, strokeWidth: 1.5, cornerRadius: 2, listening: false,
        });
        s.add(mk(f.x1, f.y1, f.x2 - f.x1, w.y1 - f.y1));
        s.add(mk(f.x1, w.y2, f.x2 - f.x1, f.y2 - w.y2));
        s.add(mk(f.x1, f.y1, w.x1 - f.x1, f.y2 - f.y1));
        s.add(mk(w.x2, f.y1, f.x2 - w.x2, f.y2 - f.y1));

        for (let i = 0; i < 4; i++) {
            const x = f.x1 + 8 + i * ((w.x1 - f.x1 - 14) / 3);
            s.add(new Konva.Line({ points: [x, f.y1 + 6, x, f.y2 - 6], stroke: '#41597e', strokeWidth: 2, listening: false }));
        }
        for (let i = 0; i < 4; i++) {
            const x = w.x2 + 8 + i * ((f.x2 - w.x2 - 14) / 3);
            s.add(new Konva.Line({ points: [x, f.y1 + 6, x, f.y2 - 6], stroke: '#41597e', strokeWidth: 2, listening: false }));
        }
        s.add(new Konva.Rect({
            x: w.x1, y: w.y1, width: w.x2 - w.x1, height: w.y2 - w.y1,
            fill: '#e9edf3', stroke: '#9aa8bd', strokeWidth: 1, listening: false,
        }));
    }

    _drawBase(s) {
        const f = this._frame;
        s.add(new Konva.Rect({
            x: f.x1 - 10, y: f.y2, width: (f.x2 - f.x1) + 20, height: 30,
            fill: '#55606e', stroke: '#37414d', strokeWidth: 1.5, cornerRadius: 4, listening: false,
        }));
        [f.x1 + 20, f.x2 - 20].forEach(x => {
            s.add(new Konva.Circle({ x, y: f.y2 + 15, radius: 6, fill: '#2f3844', listening: false }));
        });
    }

    _drawTerminalBox(s) {
        const cx = 510;
        s.add(new Konva.Rect({
            x: cx - 50, y: 78, width: 100, height: 38,
            fill: '#4a5568', stroke: '#2d3748', strokeWidth: 1.5, cornerRadius: 4, listening: false,
        }));
        s.add(new Konva.Line({ points: [cx - 50, 96, cx + 50, 96], stroke: '#2d3748', strokeWidth: 1, listening: false }));
        ['#e03030', '#20a030', '#2050e0'].forEach((c, i) => {
            s.add(new Konva.Circle({ x: cx - 26 + i * 26, y: 108, radius: 5, fill: c, listening: false }));
        });
    }

    _buildRotor() {
        const g = new Konva.Group({ listening: true });
        g.add(new Konva.Rect({ x: 170, y: 201, width: 580, height: 18, fill: '#9aa4b0', stroke: '#6b7480', strokeWidth: 1, cornerRadius: 4 }));
        g.add(new Konva.Rect({ x: 410, y: 160, width: 200, height: 100, fill: '#cfd5de', stroke: '#8b95a3', strokeWidth: 1.5, cornerRadius: 6 }));
        for (let i = 1; i < 7; i++) {
            const x = 410 + i * 28;
            g.add(new Konva.Line({ points: [x, 162, x, 258], stroke: '#aeb7c3', strokeWidth: 1, listening: false }));
        }
        [[440, 185], [500, 235], [560, 185], [590, 235]].forEach(([x, y]) => {
            g.add(new Konva.Circle({ x, y, radius: 7, fill: '#e9edf3', stroke: '#8b95a3', strokeWidth: 1, listening: false }));
        });
        g.add(new Konva.Rect({ x: 188, y: 208, width: 40, height: 6, fill: '#5b6570', listening: false }));
        return g;
    }

    _buildCoupling() {
        const g = new Konva.Group({ listening: true });
        g.add(new Konva.Rect({ x: 170, y: 175, width: 70, height: 70, fill: '#b0713a', stroke: '#7d4c22', strokeWidth: 1.5, cornerRadius: 8 }));
        g.add(new Konva.Rect({ x: 178, y: 182, width: 16, height: 56, fill: '#c98a4f', stroke: '#7d4c22', strokeWidth: 1 }));
        g.add(new Konva.Rect({ x: 216, y: 182, width: 16, height: 56, fill: '#c98a4f', stroke: '#7d4c22', strokeWidth: 1 }));
        g.add(new Konva.Circle({ x: 205, y: 210, radius: 10, fill: '#d8b089', stroke: '#7d4c22', strokeWidth: 1, listening: false }));
        return g;
    }

    _buildCover(cx) {
        const g = new Konva.Group({ listening: true });
        g.add(new Konva.Ellipse({ x: cx, y: 210, radiusX: 16, radiusY: 95, fill: '#7f93b5', stroke: '#41597e', strokeWidth: 1.5 }));
        g.add(new Konva.Ellipse({ x: cx, y: 210, radiusX: 8, radiusY: 60, fill: '#93a6c6', stroke: '#41597e', strokeWidth: 1 }));
        for (let i = 0; i < 6; i++) {
            const a = Math.PI * (0.16 + i * 0.136);
            g.add(new Konva.Circle({ x: cx + Math.cos(a) * 11, y: 210 + Math.sin(a) * 78, radius: 3.5, fill: '#41597e', listening: false }));
        }
        return g;
    }

    _buildBearingCover(cx) {
        const g = new Konva.Group({ listening: true });
        // 外圆盘
        g.add(new Konva.Ellipse({ x: cx, y: 210, radiusX: 14, radiusY: 52, fill: '#6f83a6', stroke: '#41597e', strokeWidth: 1.5 }));
        // 内圆凸台
        g.add(new Konva.Ellipse({ x: cx, y: 210, radiusX: 8, radiusY: 30, fill: '#8fa2bd', stroke: '#41597e', strokeWidth: 1 }));
        // 轴孔
        g.add(new Konva.Ellipse({ x: cx, y: 210, radiusX: 5, radiusY: 15, fill: '#e9edf3', stroke: '#41597e', strokeWidth: 1 }));
        // 螺栓孔
        [[-7, -38], [7, -38], [-7, 38], [7, 38]].forEach(([dx, dy]) => {
            g.add(new Konva.Circle({ x: cx + dx, y: 210 + dy, radius: 2.5, fill: '#41597e', listening: false }));
        });
        return g;
    }

    _buildBearing(baseX) {
        const g = new Konva.Group({ listening: true });
        g.add(new Konva.Rect({ x: baseX, y: 178, width: 32, height: 64, fill: '#c9a227', stroke: '#8a6d13', strokeWidth: 1.5, cornerRadius: 4 }));
        for (let i = 0; i < 4; i++) {
            g.add(new Konva.Line({ points: [baseX + 3, 186 + i * 14, baseX + 29, 186 + i * 14], stroke: '#8a6d13', strokeWidth: 1, listening: false }));
        }
        return g;
    }

    _buildFan() {
        const g = new Konva.Group({ listening: true });
        g.add(new Konva.Circle({ x: 770, y: 210, radius: 52, fill: '#cfd8e3', stroke: '#8391a5', strokeWidth: 1.5 }));
        for (let i = 0; i < 6; i++) {
            g.add(new Konva.Ellipse({ x: 770, y: 210, radiusX: 11, radiusY: 40, fill: '#b9c4d4', stroke: '#8391a5', strokeWidth: 1, rotation: i * 30 + 90, listening: false }));
        }
        g.add(new Konva.Circle({ x: 770, y: 210, radius: 14, fill: '#93a1b6', stroke: '#6d7a8d', strokeWidth: 1, listening: false }));
        return g;
    }

    _buildFanCover() {
        const g = new Konva.Group({ listening: true });
        g.add(new Konva.Rect({ x: 720, y: 150, width: 120, height: 120, fill: '#8fa2bd', stroke: '#5b6d88', strokeWidth: 1.5, cornerRadius: 10 }));
        for (let i = 0; i < 4; i++) {
            g.add(new Konva.Line({ points: [730, 168 + i * 22, 830, 168 + i * 22], stroke: '#6d8098', strokeWidth: 3, lineCap: 'round', listening: false }));
        }
        g.add(new Konva.Line({ points: [780, 132, 780, 150], stroke: '#5b6d88', strokeWidth: 4, listening: false }));
        return g;
    }

    _drawTray(s) {
        s.add(new Konva.Text({
            x: 24, y: 352, text: '转子总成（转子 + 前后轴承 + 后端盖 + 后轴承盖）', fontSize: 12,
            fontStyle: 'bold', fill: '#374151', listening: false,
        }));
        s.add(new Konva.Text({
            x: 24, y: 474, text: '拆解零件摆放区（按拆卸顺序）', fontSize: 13,
            fontStyle: 'bold', fill: '#374151', listening: false,
        }));
        s.add(new Konva.Line({ points: [24, 492, 986, 492], stroke: '#d1d5db', strokeWidth: 1, listening: false }));

        Object.keys(this._partMeta).forEach(id => {
            const meta = this._partMeta[id];
            if (meta.slot < 0) return;
            const cx = this._slotX(meta.slot);
            s.add(new Konva.Rect({
                x: cx - 48, y: this._trayY - 52, width: 96, height: 104,
                stroke: '#cbd5e1', strokeWidth: 1, dash: [6, 4], cornerRadius: 8, listening: false,
            }));
            s.add(new Konva.Text({
                x: cx - 48, y: this._trayY + 58, width: 96, align: 'center',
                text: meta.name, fontSize: 12, fill: '#6b7280', listening: false,
            }));
        });

        // 转子总成落位区
        s.add(new Konva.Rect({
            x: 150, y: 362, width: 560, height: 100, stroke: '#cbd5e1',
            strokeWidth: 1, dash: [6, 4], cornerRadius: 8, listening: false,
        }));
    }

    _drawPartLabels(s) {
        const label = (partId, x, y, t) => {
            const node = new Konva.Text({ x, y, width: 80, align: 'center', text: t, fontSize: 12, fill: '#475569', listening: false });
            s.add(node);
            if (partId) this._partLabelNodes[partId] = node;
        };
        label('coupling', 165, 150, '联轴器');
        label('fanCover', 740, 128, '风扇罩');
        label('rotor', 470, 262, '转子');
        label(null, 330, 70, '打标记');
    }

    _createDynamicNodes() {
        // 对位标记（打标记后显示）：前端盖/后端盖与机座接合处
        this._markGroup = new Konva.Group({ visible: false, listening: false });
        [350, 670].forEach(x => {
            this._markGroup.add(new Konva.Line({ points: [x, 104, x, 140], stroke: '#e11d48', strokeWidth: 2.5, listening: false }));
            this._markGroup.add(new Konva.Line({ points: [x - 8, 122, x + 8, 122], stroke: '#e11d48', strokeWidth: 2.5, listening: false }));
        });
        this._markGroup.add(new Konva.Text({ x: 700, y: 96, text: '对位标记', fontSize: 11, fill: '#e11d48', listening: false }));
        this._staticGroup.add(this._markGroup);
    }

    _bindInteraction() {
        // 打标记
        this.addClickablePart('mark', 330, 58, 80, 40).on('click tap', () => this._onMark());

        // 拆卸部件（插入顺序决定命中优先级：后插入者在上）
        this._addPartHotspot('coupling', 170, 175, 70, 70);
        this._addPartHotspot('frontBearingCover', 306, 158, 28, 104);
        this._addPartHotspot('frontCover', 334, 115, 32, 190);
        this._addPartHotspot('frontBearing', 376, 178, 32, 64);
        this._addPartHotspot('rearBearing', 612, 178, 32, 64);
        this._addPartHotspot('rearBearingCover', 686, 158, 28, 104);
        this._addPartHotspot('rearCover', 654, 115, 32, 190);
        this._addPartHotspot('rotor', 415, 165, 190, 90);
        this._addPartHotspot('fan', 718, 158, 104, 104);
        this._addPartHotspot('fanCover', 720, 150, 120, 120);

        // 工具箱按钮
        this._toolList.forEach((t, i) => {
            const y = 100 + i * 56;
            this.addClickablePart('tool-' + t.key, this._toolX0 + 6, y, this._toolW - 12, 46)
                .on('click tap', () => this.toggleTool(t.key));
        });

        // 重新装配
        this.addClickablePart('reset', 16, 20, 104, 36, true).on('click tap', () => this.reset());

        // 记录各部件初始热区位置与变换
        Object.keys(this._partMeta).forEach(id => { this._tx[id] = { x: 0, y: 0, s: 1 }; });
    }

    _addPartHotspot(partId, x, y, w, h) {
        const hit = this.addClickablePart(partId, x, y, w, h);
        hit.on('click tap', () => this._onPartClick(partId));
        this._hitTL[partId] = { x, y };
        this._hotspotGroups[partId] = hit.getParent();
        return hit;
    }

    // ═══════════════════════════════════════════
    // 变换同步
    // ═══════════════════════════════════════════

    /**
     * 零件平移/缩放动画：不使用 Konva.Tween 的自动重绘（本项目由自身渲染循环控制绘制），
     * 改为自驱动定时器 + 显式 layer.draw()，确保每一帧都真正刷新到画布。
     */
    _applyTransform(partId, x, y, s, duration = 0.7) {
        const g = this._partGroups[partId];
        if (!g) return;

        if (this._animTimers && this._animTimers[partId]) {
            clearTimeout(this._animTimers[partId]);
            this._animTimers[partId] = null;
        }

        const hg = this._hotspotGroups[partId];
        const tl = this._hitTL[partId];
        this._tx[partId] = { x, y, s };

        const sg = { x: g.x(), y: g.y(), sc: g.scaleX() };
        const sh = hg ? { x: hg.x(), y: hg.y(), sc: hg.scaleX() } : null;
        const th = (hg && tl) ? { x: x + tl.x * s, y: y + tl.y * s, sc: s } : null;
        const dur = Math.max(1, Math.round(duration * 1000));
        const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
        const t0 = now();

        const redraw = () => this._render();

        const tick = () => {
            let t = (now() - t0) / dur;
            if (t > 1) t = 1;
            const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;   // easeInOutQuad
            g.x(sg.x + (x - sg.x) * e);
            g.y(sg.y + (y - sg.y) * e);
            const sc = sg.sc + (s - sg.sc) * e;
            g.scaleX(sc); g.scaleY(sc);
            if (hg && sh && th) {
                hg.x(sh.x + (th.x - sh.x) * e);
                hg.y(sh.y + (th.y - sh.y) * e);
                const hsc = sh.sc + (th.sc - sh.sc) * e;
                hg.scaleX(hsc); hg.scaleY(hsc);
            }
            redraw();
            if (t < 1) {
                this._animTimers[partId] = setTimeout(tick, 30);
            } else {
                this._animTimers[partId] = null;
            }
        };
        tick();
    }

    // ═══════════════════════════════════════════
    // 工具箱
    // ═══════════════════════════════════════════

    /** 立即刷新画布：本项目自动演示期间仅靠 requestRedraw 未必即时重绘，这里直接同步 draw */
    _render() {
        if (!this.sys) return;
        if (this.sys.layer) {
            try { this.sys.layer.draw(); }
            catch (e) { if (typeof this.sys.layer.batchDraw === 'function') this.sys.layer.batchDraw(); }
        }
        if (typeof this.sys.requestRedraw === 'function') this.sys.requestRedraw();
    }

    toggleTool(key) { this.setTool(key, !this._tools[key]); }

    setTool(key, on) {
        if (!(key in this._toolName)) return;
        this._tools[key] = !!on;
        const nodes = this._toolCheckNodes && this._toolCheckNodes[key];
        if (nodes) { nodes.box.fill(on ? '#dcfce7' : '#ffffff'); nodes.check.visible(!!on); }
        this._render();
    }

    _clearTools() {
        Object.keys(this._toolName).forEach(k => this.setTool(k, false));
    }

    _toolsSatisfied(partId) {
        const req = this._partMeta[partId].req;
        if (!req || !req.length) return true;
        return req.some(opt => opt.every(k => this._tools[k]));
    }

    _toolsText(partId) {
        const req = this._partMeta[partId].req;
        if (!req || !req.length) return '无需工具';
        return req.map(opt => opt.map(k => this._toolName[k]).join(' + ')).join(' 或 ');
    }

    // ═══════════════════════════════════════════
    // 交互逻辑
    // ═══════════════════════════════════════════

    _tip(msg) {
        if (this.sys && typeof this.sys.showFloatingTip === 'function') this.sys.showFloatingTip(msg, 2800);
    }

    _onMark() {
        if (this._marked) { this._tip('已做好对位标记'); return; }
        this.mark();
    }

    mark() {
        this._marked = true;
        this._markGroup.visible(true);
        this._render();
        this._tip('已在前、后端盖与机座接合处做好对位标记');
        return true;
    }

    _onPartClick(partId) {
        if (this._removed[partId]) { this._tip(`${this._partMeta[partId].name} 已拆下`); return; }
        if (!this._marked) { this._tip('拆卸前请先做好对位标记'); return; }
        const missing = this._missingPrereq(partId);
        if (missing) { this._tip(`拆卸顺序不正确：请先拆下${missing}`); return; }
        if (!this._toolsSatisfied(partId)) { this._tip(`需先勾选工具：${this._toolsText(partId)}`); return; }
        this.removePart(partId);
    }

    _missingPrereq(partId) {
        const idx = this._order.indexOf(partId);
        if (idx <= 0) return null;
        const prev = this._order[idx - 1];
        if (!this._removed[prev]) return this._partMeta[prev].name;
        return null;
    }

    /**
     * 拆下指定零件（程序调用，供工作流使用）
     * 顺序/工具正确时执行动画并返回 true；否则返回 false
     */
    removePart(partId, force = false) {
        const meta = this._partMeta[partId];
        if (!meta || !this._partGroups[partId]) return false;
        if (this._removed[partId]) return true;
        if (!force && !this._marked) return false;
        if (!force && this._missingPrereq(partId)) return false;
        if (!force && !this._toolsSatisfied(partId)) return false;

        if (partId === 'rotor') {
            // 转子 + 前后轴承 + 后端盖 + 后轴承盖 整体拆下
            const a = this._asm;
            this._assemblyParts.forEach(id => {
                this._removed[id] = (id === 'rotor');
                this._applyTransform(id, a.x, a.y, a.s);
                const h = this.getClickablePartNode(id);
                if (h) h.listening(false);
                const lb = this._partLabelNodes[id];
                if (lb) lb.visible(false);
            });
            // 整体拆下后，分离步骤用的部件热区需恢复可点（转子热区保持关闭）
            ['frontBearing', 'rearBearing', 'rearCover', 'rearBearingCover'].forEach(id => {
                const h = this.getClickablePartNode(id);
                if (h) h.listening(true);
            });
        } else {
            this._removed[partId] = true;
            const s = this._trayScale(meta);
            this._applyTransform(partId, this._slotX(meta.slot) - meta.cx * s, this._trayY - meta.cy * s, s);
            const h = this.getClickablePartNode(partId);
            if (h) h.listening(false);
            const lb = this._partLabelNodes[partId];
            if (lb) lb.visible(false);
        }

        // "拆掉前轴承盖，松开后端盖"
        if (partId === 'frontBearingCover' && !this._loosened) {
            this._loosened = true;
            this._applyTransform('rearCover', 10, 0, 1);
        }

        this._clearTools();
        return true;
    }

    /** 重新装配（复位全部零件、工具与标记） */
    reset() {
        if (!this._partGroups) return;
        Object.keys(this._partGroups).forEach(id => {
            this._applyTransform(id, 0, 0, 1, 0.5);
            const h = this.getClickablePartNode(id);
            if (h) h.listening(true);
        });
        Object.values(this._partLabelNodes).forEach(n => n.visible(true));
        this._removed = {};
        this._marked = false;
        this._loosened = false;
        this._markGroup.visible(false);
        this._clearTools();
        this._render();
        this._tip('已重新装配');
    }

    // ═══════════════════════════════════════════
    // 查询接口
    // ═══════════════════════════════════════════

    isMarked() { return this._marked; }
    isRemoved(partId) { return !!this._removed[partId]; }
    isToolOn(key) { return !!this._tools[key]; }
    getRemovedParts() { return { ...this._removed }; }

    /** 覆盖：计入零件当前平移/缩放，供工作流箭头精确定位 */
    getClickablePartCenter(partId) {
        const p = this._parts && this._parts[partId];
        if (!p) return null;
        const tx = this._tx[partId] || { x: 0, y: 0, s: 1 };
        const abs = this.group && this.group.getAbsolutePosition ? this.group.getAbsolutePosition() : { x: 0, y: 0 };
        return {
            x: abs.x + tx.x + (p.x + p.w / 2) * tx.s,
            y: abs.y + tx.y + (p.y + p.h / 2) * tx.s,
        };
    }

    getConfigFields() {
        return [{ label: '标签', key: 'label', type: 'text' }];
    }

    onConfigUpdate(cfg) {
        if (cfg.label) this.label = cfg.label;
        if (typeof this.sys.requestRedraw === 'function') this.sys.requestRedraw();
    }
}
