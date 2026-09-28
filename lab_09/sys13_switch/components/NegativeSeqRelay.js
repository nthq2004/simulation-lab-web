import { BaseComponent } from './BaseComponent.js';

/**
 * NegativeSeqRelay - 负序继电器仿真组件
 *
 * 布局：右 = 三根进线接线柱 L1/L2/L3；左 = 常闭触点输出 nc1/nc2。
 * 面板：小绿指示灯（正相序）+ 小红指示灯（负相序）。
 *
 * 功能：
 *   正相序 → 绿指示灯亮、红指示灭、常闭触点闭合（保持导通）
 *   负相序 → 红指示灯亮、绿指示灭、常闭触点断开（切断回路）
 *   无电   → 两指示灭（相序检测保持上次结果）
 *
 * 电气：type='NegSeqRelay'，常闭触点由 stampNegSeqRelays 注入
 *   （isNCClosed() 为真时 nc1↔nc2 注入 0.001Ω，断开时不注入）。
 * 相序检测：与岸电箱相同 —— 线电压 v12=L1−L2、v23=L2−L3 的
 *   李萨如叉积符号（累计 20 帧），无需精确过零。
 */
export class NegativeSeqRelay extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        this.width  = Math.max(140, config.width  || 170);
        this.height = Math.max(104, config.height || 128);
        this.type    = 'NegSeqRelay';
        this.special = 'NegSeqRelay';
        this.cache   = 'fixed';
        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();
        this.config = { id: this.id, label: this.label, initPhase: this._phase };
        // ── 右侧三根进线（电气端口与右侧端子重合）──
        this.addPort(this._linPorts[0].x, this._linPorts[0].y, 'l1', 'wire');
        this.addPort(this._linPorts[1].x, this._linPorts[1].y, 'l2', 'wire');
        this.addPort(this._linPorts[2].x, this._linPorts[2].y, 'l3', 'wire');
        // ── 左侧常闭触点 ──
        this.addPort(0, this._ncPorts[0], 'nc1', 'wire', 'p');
        this.addPort(0, this._ncPorts[1], 'nc2', 'wire');
    }

    _recalcGeometry() {
        const W = this.width, H = this.height;
        // 右侧三线（垂直等距，进线接线柱）
        const x0 = 34, x1 = 70, x2 = 106;
        // 进线端子位于组件右半区竖直方向
        this._linXs = [-1, 0, 1].map(i => Math.round(x0 + i * 36));
        // 进线接线柱（右侧竖排，下标0在最上）
        this._linPorts = [0, 1, 2].map(i => ({ x: W - 3, y: 42 + i * 30 }));
        // 保留 linXs 供内部示意线用（指向进线端子列）—— 直接改为与端子对齐
        this._linXs = this._linPorts.map(p => p.x - 22);
        // 左侧常闭触点（竖直上下两端口，与上下静触点同 y → 引线水平）；刀片绕下静触点竖直向上
        this._ncPorts = [60, 100];
        this._ncSx = 26;   // 内部静触点示意 x（刀片轴）
    }

    _initParameters(config) {
        this.label = config.label || '负序继电器';
        this.function = '负序继电器';
        // 默认负序；_confirmed=false 表示相序尚未确认（未上电/刚通电检测窗口未满）
        this._phase = (config.initPhase || 'neg').toLowerCase() === 'pos' ? 'pos' : 'neg';
        this._confirmed = false;
        this._iBuf = new Array(40).fill(0);
        this._iBufSum = 0; this._iBufIdx = 0; this._iBufCount = 0;
        this._inRms = 0;
        this._p12 = 0; this._p23 = 0;
        this._seqAcc = 0; this._seqN = 0;
        this._animDur = 0.1;
    }

    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
    }

    _drawStaticParts() {
        const s = this._staticGroup;
        // 机箱
        s.add(new Konva.Rect({ x: 2, y: 2, width: this.width - 4, height: this.height - 4,
            fill: '#eceff4', stroke: '#7a8596', strokeWidth: 1.5, cornerRadius: 5 }));
        // 标题
        s.add(new Konva.Rect({ x: 2, y: 2, width: this.width - 4, height: 20,
            fill: '#3a4a5a', cornerRadius: [5, 5, 0, 0] }));
        s.add(new Konva.Text({ x: 2, y: 5, width: this.width - 4, align: 'center',
            text: this.label, fontSize: 13, fontStyle: 'bold', fill: '#f0f4f8', listening: false }));
        // 指示灯标签（面板中部）
        s.add(new Konva.Text({ x: 54, y: 92, text: '正序', fontSize: 12, fontStyle: 'bold',
            fill: '#1a7a24', width: 40, align: 'center', listening: false }));
        s.add(new Konva.Text({ x: 94, y: 92, text: '负序', fontSize: 12, fontStyle: 'bold',
            fill: '#c02020', width: 40, align: 'center', listening: false }));
        // 右侧进线接线柱（圆 + 标签）
        ['L1', 'L2', 'L3'].forEach((t, i) => {
            const p = this._linPorts[i];
            s.add(new Konva.Circle({ x: p.x, y: p.y, radius: 5, fill: '#d4aa52',
                stroke: '#6a5a28', strokeWidth: 1, listening: false }));
            s.add(new Konva.Text({ x: p.x - 24, y: p.y - 13, text: t, fontSize: 12,
                fontStyle: 'bold', fill: ['#e03030', '#20a030', '#2050e0'][i], listening: false }));
            // 内部示意线：端子 → 中央
            s.add(new Konva.Line({ points: [p.x - 6, p.y, this._linXs[i], p.y],
                stroke: ['#e03030', '#20a030', '#2050e0'][i], strokeWidth: 1.5, listening: false }));
        });
        // 左侧常闭触点（竖直上下两端口 + 上下静触点，刀片由动态层覆盖）
        ['NC1', 'NC2'].forEach((t, i) => {
            const y = this._ncPorts[i];
            s.add(new Konva.Circle({ x: 0, y, radius: 5, fill: '#d4aa52', stroke: '#6a5a28', strokeWidth: 1, listening: false }));
            s.add(new Konva.Text({ x: 5, y: y - 11, text: t, fontSize: 11, fontStyle: 'bold',
                fill: '#3a3e44', listening: false }));
        });
        // 内部上下静触点（与端口同 y，引线水平；下静触点为刀片轴）
        s.add(new Konva.Circle({ x: this._ncSx, y: this._ncPorts[0], radius: 3.5, fill: '#e8c86a',
            stroke: '#6a5a28', strokeWidth: 0.8, listening: false }));
        s.add(new Konva.Circle({ x: this._ncSx, y: this._ncPorts[1], radius: 3.5, fill: '#e8c86a',
            stroke: '#6a5a28', strokeWidth: 0.8, listening: false }));
        // 端口 → 静触点 引线（水平）
        s.add(new Konva.Line({ points: [4, this._ncPorts[0], this._ncSx, this._ncPorts[0]],
            stroke: '#8a8f98', strokeWidth: 1.2, listening: false }));
        s.add(new Konva.Line({ points: [4, this._ncPorts[1], this._ncSx, this._ncPorts[1]],
            stroke: '#8a8f98', strokeWidth: 1.2, listening: false }));
        s.add(new Konva.Text({ x: 4, y: 112, text: '常闭触点', fontSize: 12, fill: '#5a6470', listening: false }));
    }

    _createDynamicNodes() {
        this._leds = [];
        // 绿（正序）/ 红（负序）指示灯
        [['#35c94a', 74], ['#ff5040', 114]].forEach(([color, cx]) => {
            const base = new Konva.Circle({ x: cx, y: 80, radius: 8, fill: '#39404c',
                stroke: '#9aa2ac', strokeWidth: 1.2, listening: false });
            const led = new Konva.Circle({ x: cx, y: 80, radius: 6, fill: color,
                opacity: 0.9, visible: false, listening: false });
            this._dynamicGroup.add(base);
            this._dynamicGroup.add(led);
            this._leds.push(led);
        });
        // 常闭触点动态刀片（参照岸电主开关常闭触点）：绕下静触点竖直向上，
        // 正序闭合（竖直，顶端触上静触点）、负序断开（向上偏转 25°）
        const ncX = this._ncSx, baseY = this._ncPorts[1];
        const len = (this._ncPorts[1]) - (this._ncPorts[0]) + 2;
        const ncG = new Konva.Group({ x: ncX, y: baseY, rotation: 0, listening: false });
        ncG.add(new Konva.Line({ points: [0, 0, 0, -len], stroke: '#38404f', strokeWidth: 3,
            lineCap: 'round' }));
        ncG.add(new Konva.Circle({ x: 0, y: -len, radius: 3.5, fill: '#e8c86a', stroke: '#6a5a28', strokeWidth: 0.8 }));
        this._dynamicGroup.add(ncG);
        this._ncBridgeG = ncG;
        this._updateNC();
    }

    _bindInteraction() {
        this._interactGroup.add(new Konva.Rect({ x: 0, y: 0, width: this.width, height: this.height,
            fill: 'transparent' }));
    }

    tick() {
        this._updateSeqPhase();
        this._updateLEDs();
        this._updateNC();
        this._refreshIfDirty();
    }

    /** 实时进线相序检测（李萨如叉积） */
    _updateSeqPhase() {
        if (!this.sys || typeof this.sys.getVoltageBetween !== 'function') return;
        const v12 = this.sys.getVoltageBetween(`${this.id}_wire_l1`, `${this.id}_wire_l2`) || 0;
        const v23 = this.sys.getVoltageBetween(`${this.id}_wire_l2`, `${this.id}_wire_l3`) || 0;
        const d = this._p12 * v23 - this._p23 * v12;
        this._p12 = v12; this._p23 = v23;
        // RMS（v12）判定有电
        const i2 = v12 * v12;
        const old = this._iBuf[this._iBufIdx];
        this._iBuf[this._iBufIdx] = i2;
        this._iBufSum = this._iBufSum - old + i2;
        this._iBufIdx = (this._iBufIdx + 1) % 40;
        if (this._iBufCount < 40) this._iBufCount++;
        this._inRms = this._iBufCount >= 5 ? Math.sqrt(this._iBufSum / Math.min(this._iBufCount, 40)) : 0;
        if (!this._powered()) return;
        if (Math.abs(d) < 5) return;
        this._seqAcc += d;
        this._seqN++;
        if (this._seqN >= 20) {
            this._phase = this._seqAcc < 0 ? 'pos' : 'neg';
            this._confirmed = true;   // 完成一次有效相序确认
            this._seqAcc = 0; this._seqN = 0;
        }
    }

    _powered() { return this._inRms > 40; }

    _updateLEDs() {
        // 未确认相序前视为无电状态：指示灯全灭；确认后按相序亮相应指示灯
        const on = this._confirmed && this._powered();
        if (this._leds[0]) this._leds[0].visible(on && this._phase === 'pos');
        if (this._leds[1]) this._leds[1].visible(on && this._phase === 'neg');
    }

_updateNC() {
        if (!this._ncBridgeG) return;
        // 仅“已确认且正序”时闭合；未确认（无电/刚通电/窗口未满）与负序均断开
        this._ncBridgeG.rotation(this.isNCClosed() ? 0 : 25);
    }

    /**
     * 常闭触点闭合条件（必须同时满足）：
     *   ① 已确认相序；② 已确认正序；③ 端口有电
     *   任一不满足（含端口无电）→ 常闭触点断开
     */
    isNCClosed() { return this._confirmed && this._phase === 'pos' && this._powered(); }
    getPhase()   { return this._phase; }

    getConfigFields() {
        return [
            { label: '位号/名称',        key: 'label',     type: 'text' },
            { label: '初始相序 (pos/neg)', key: 'initPhase', type: 'text' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label !== undefined) this.label = cfg.label;
        this.config = { ...this.config, ...cfg };
        this._refreshCache();
    }

    destroy() { super.destroy?.(); }
}
