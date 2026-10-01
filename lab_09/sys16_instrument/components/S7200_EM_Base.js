import { BaseComponent } from './BaseComponent.js';

/**
 * S7_200_EM_Base — 西门子 S7-200 SMART 扩展模块（EM）公共基类
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  外观（参照实物）：
 *    - 高度与 CPU SR40 相同、宽度约为其 1/4 的窄长条形深灰塑料壳体
 *    - 左侧为**凸口**（公插头，伸出本体 10px，不计入 width），用于插入 CPU
 *      或上一级模块右侧的**凹口**
 *    - 右侧同样含一个**凹口**（母座），可级联下一块扩展模块
 *    - 中部铭牌 + 通道地址列表，底部**两排**接线端子（避免单排拥挤）
 *
 *  扩展链模型（与 SR40 协同）：
 *    - 每块模块通过 `_parentExp` 记录父级（CPU 或上一级模块）id
 *    - CPU 依据 `_parentExp` 关系重算级联链与槽位号 `_expSlot`
 *    - `onExpansionMounted(cpu, slot)` 在槽位变化时回调（刷新地址/指示灯）
 */
export class S7_200_EM_Base extends BaseComponent {
    constructor(config, sys, opts = {}) {
        super(config, sys);

        this.width  = Math.max(60,  config.width  || 115);
        this.height = Math.max(300, config.height || 470);

        this.type    = opts.type || 's7200_em';
        this.cache   = 'fixed';
        this.special = 'expansion';
        this._model  = opts.model || 'EM';
        this._chCount = opts.channels || 4;

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._initState();
        this._draw();
        this._registerPorts();

        // 扩展链状态
        this._parentExp = config.attachTo || null;   // 父组件 id（CPU 或模块）
        this._expSlot   = (config.slot !== undefined) ? config.slot : -1;
        this._cpu       = null;
        this._mounted   = false;
        this._ioKind    = null;   // 数字量模块地址类型 'I'/'Q'（未挂接为 null）
        this._ioBase    = -1;     // 数字量模块位索引基址（未挂接为 -1）

        this.config = Object.assign({ id: this.id, label: this.label }, this._configExtra || {});
    }

    // ── 子类可覆盖 ─────────────────────────────────────────────
    getModelName() { return this._model; }
    getOrderNo()   { return ''; }
    /** 底部端子定义：[{ id, label, row, pwr? }]（row: 0/1 两排） */
    buildTerminals() { return []; }
    /** 通道地址列表（如 ['AIW0','AIW2',...]），供中部显示 */
    getChannelAddressList() { return []; }
    /** 额外配置字段（子类追加） */
    getExtraConfigFields() { return []; }
    _configExtra() { return {}; }

    // ── 几何 ───────────────────────────────────────────────────
    _recalcGeometry() {
        const W = this.width, H = this.height;

        // 左侧凸口（伸出本体 10px，不计入宽度）
        this._busPlug   = { x: -10, y: H * 0.13, w: 10, h: H * 0.20 };
        // 右侧凹口（母座，可级联）
        this._busSocket = { x: W - 10, y: H * 0.13, w: 10, h: H * 0.20 };

        // 铭牌
        this._nameplate = { x: W * 0.06, y: H * 0.09, w: W * 0.88, h: H * 0.15 };

        // 中部通道地址列表
        this._addrArea = { x: W * 0.08, y: H * 0.285, w: W * 0.84, h: H * 0.16 };

        // 底部端子排（行数自适应 buildTerminals 的 row 最大值）
        this._termSpec = this.buildTerminals();
        this._termRowH = 48;
        let maxRow = 0;
        (this._termSpec || []).forEach(t => { maxRow = Math.max(maxRow, t.row || 0); });
        this._termRows = Math.max(1, maxRow + 1);
        const th = this._termRows * this._termRowH + 10;
        this._termArea = { x: 0, y: H - th, w: W, h: th };
    }

    _initParameters(config) {
        this.label = config.label || this._model;
    }

    _initState() {
        this._values = new Array(this._chCount).fill(0);
    }

    // ═══════════════════════════════════════════════════════════
    // 绘制
    // ═══════════════════════════════════════════════════════════
    _draw() {
        this._drawBody();
        this._drawBusPlug();
        this._drawBusSocket();
        this._drawNameplate();
        this._drawHitArea();
        this._drawTerminalStrip();
        this._createDynamicNodes();
    }

    _drawBody() {
        const W = this.width, H = this.height;
        this._staticGroup.add(new Konva.Rect({
            x: 0, y: 0, width: W, height: H, cornerRadius: 4,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint: { x: 0, y: H },
            fillLinearGradientColorStops: [0, '#5a6069', 0.5, '#464d55', 1, '#31373e'],
            stroke: '#1c2126', strokeWidth: 1.4, listening: false,
        }));
        this._staticGroup.add(new Konva.Rect({
            x: 0, y: 0, width: W, height: H * 0.06,
            fill: '#2b3137', listening: false,
        }));
    }

    /** 整机透明命中层：使模块本体任意位置可拖动（放在交互层，不参与静态缓存） */
    _drawHitArea() {
        const hit = new Konva.Rect({
            x: -this._busPlug.w, y: 0,
            width: this.width + this._busPlug.w + this._busSocket.w,
            height: this.height,
            fill: 'rgba(0,0,0,0)', listening: true,
        });
        this._interactGroup.add(hit);
    }

    /** 左侧凸口（公插头）：伸出本体 10px，金色触片示意 */
    _drawBusPlug() {
        const p = this._busPlug;
        this._staticGroup.add(new Konva.Rect({
            x: p.x, y: p.y, width: p.w, height: p.h,
            fill: '#2a2a30', stroke: '#555', strokeWidth: 1,
            cornerRadius: [2, 0, 0, 2], listening: false,
        }));
        for (let i = 0; i < 5; i++) {
            this._staticGroup.add(new Konva.Circle({
                x: p.x + p.w * 0.30,
                y: p.y + p.h * (0.16 + i * 0.17),
                radius: Math.max(1.2, this.width * 0.011),
                fill: '#c8b040', listening: false,
            }));
        }
    }

    /** 右侧凹口（母座） */
    _drawBusSocket() {
        const s = this._busSocket;
        this._staticGroup.add(new Konva.Rect({
            x: s.x, y: s.y, width: s.w, height: s.h,
            fill: '#0c1013', stroke: '#1c2126', strokeWidth: 1,
            cornerRadius: [3, 0, 0, 3], listening: false,
        }));
        for (let i = 0; i < 5; i++) {
            this._staticGroup.add(new Konva.Circle({
                x: s.x + s.w * 0.40,
                y: s.y + s.h * (0.16 + i * 0.17),
                radius: Math.max(1.2, this.width * 0.011),
                fill: '#c8b040', listening: false,
            }));
        }
    }

    _drawNameplate() {
        const n = this._nameplate, W = this.width;
        this._staticGroup.add(new Konva.Rect({
            x: n.x, y: n.y, width: n.w, height: n.h, cornerRadius: 2,
            fill: '#e9e6dc', stroke: '#9aa0a6', strokeWidth: 0.8, listening: false,
        }));
        this._staticGroup.add(new Konva.Text({
            x: n.x + 3, y: n.y + 3, width: n.w - 6,
            text: 'SIEMENS', fontSize: Math.max(11, W * 0.055), fontStyle: 'bold',
            fontFamily: 'Arial, sans-serif', fill: '#069734', listening: false,
        }));
        this._staticGroup.add(new Konva.Text({
            x: n.x + 3, y: n.y + n.h * 0.30, width: n.w - 6,
            text: 'S7-200 SMART', fontSize: Math.max(11, W * 0.058), fontStyle: 'bold',
            fontFamily: 'Arial, sans-serif', fill: '#1a1a1a', listening: false,
        }));
        this._staticGroup.add(new Konva.Text({
            x: n.x + 3, y: n.y + n.h * 0.56, width: n.w - 6,
            text: this.getModelName(), fontSize: Math.max(13, W * 0.075), fontStyle: 'bold',
            fontFamily: 'Arial, sans-serif', fill: '#0a5a5a', listening: false,
        }));
        this._staticGroup.add(new Konva.Text({
            x: n.x + 1, y: n.y + n.h * 0.85, width: n.w - 1,
            text: this.getOrderNo(), fontSize: Math.max(9, W * 0.042),
            fontFamily: 'Arial, sans-serif', fill: '#333', listening: false,
        }));
    }

    /** 底部端子排（按 termSpec 的 row 分行绘制，行数自适应） */
    _drawTerminalStrip() {
        const W = this.width;
        const a = this._termArea;
        const rowH = this._termRowH;
        this._staticGroup.add(new Konva.Rect({
            x: a.x, y: a.y, width: a.w, height: a.h,
            fill: '#1b2024', stroke: '#0e1216', strokeWidth: 1, listening: false,
        }));

        const terms = this._termSpec || [];
        for (let ri = 0; ri < this._termRows; ri++) {
            const rowTerms = terms.filter(t => (t.row || 0) === ri);
            if (!rowTerms.length) continue;
            const n = rowTerms.length;
            const pad = W * 0.17;
            const span = W - pad * 2;
            const ty = a.y + 6 + rowH * ri + rowH * 0.60;
            rowTerms.forEach((t, i) => {
                const x = (n === 1) ? W / 2 : pad + (span / (n - 1)) * i;
                t.ax = x; t.ay = ty;
                // 端子方块
                this._staticGroup.add(new Konva.Rect({
                    x: x - 5, y: ty - 5, width: 10, height: 10, cornerRadius: 1,
                    fill: t.pwr ? '#c9a227' : '#8a929a', stroke: '#5a6168', strokeWidth: 0.6,
                    listening: false,
                }));
                // 端子标签（端子正上方，与端子/指示灯留出间距）
                this._staticGroup.add(new Konva.Text({
                    x: x - 14, y: ty - rowH * 0.68, width: 28, text: t.label,
                    fontSize: Math.max(13, W * 0.058), fontFamily: 'Arial, sans-serif',
                    fill: '#dbe2e8', align: 'center', listening: false,
                }));
            });
        }
    }

    _createDynamicNodes() {
        // 状态指示灯（挂接且 CPU 运行 → 绿色）
        this._statusLed = new Konva.Circle({
            x: this.width * 0.5, y: this.height * 0.072,
            radius: Math.max(3, this.width * 0.035),
            fill: '#26303a', stroke: '#12161a', strokeWidth: 0.8, listening: false,
        });
        this._dynamicGroup.add(this._statusLed);

        // 槽位标注
        this._ioText = new Konva.Text({
            x: 2, y: this.height * 0.255, width: this.width - 4, text: '',
            fontSize: Math.max(14, this.width * 0.058), fontFamily: 'Microsoft YaHei',
            fill: '#cfd6dd', align: 'center', listening: false,
        });
        this._dynamicGroup.add(this._ioText);

        // 通道地址列表
        this._addrText = new Konva.Text({
            x: this._addrArea.x, y: this._addrArea.y, width: this._addrArea.w, text: '',
            fontSize: Math.max(13, this.width * 0.062), fontFamily: 'Consolas, monospace',
            fill: '#7fe0c0', align: 'center', lineHeight: 1.5, listening: false,
        });
        this._dynamicGroup.add(this._addrText);
    }

    // ═══════════════════════════════════════════════════════════
    // 端口
    // ═══════════════════════════════════════════════════════════
    _registerPorts() {
        (this._termSpec || []).forEach(t => {
            if (!t.id) return;
            // 端子热区（供工作流自动演示箭头精确定位；标签/指示灯/端子一并覆盖）
            this.addClickablePart('term-' + t.id, t.ax - 10, t.ay - 32, 20, 38);
            this.addPort(t.ax, t.ay, t.id, 'wire', t.pwr ? 'p' : null);
        });
    }

    // ═══════════════════════════════════════════════════════════
    // 扩展接口（与 SR40 一致的对接坐标约定）
    // ═══════════════════════════════════════════════════════════

    /** 左侧凸口对接锚点（本地坐标）：左边缘、凸口纵向中心 */
    extensionPlugAnchor() {
        const p = this._busPlug;
        return { x: 0, y: p.y + p.h / 2 };
    }

    /** 右侧凹口对接锚点（本地坐标）：右边缘、凹口纵向中心 */
    expansionSocket() {
        const s = this._busSocket;
        return { x: this.width, y: s.y + s.h / 2 };
    }

    getExpansionSocketRect() { return { ...this._busSocket }; }

    /**
     * 槽位/地址变化回调（由 CPU.recomputeExpansionChain 调用）
     * @param cpu  所属 CPU（null 表示已脱离）
     * @param slot 槽位号（-1 表示未挂接）
     * @param addr 数字量模块的地址信息 { kind:'I'|'Q', base:位索引 }（模拟量模块为 undefined）
     */
    onExpansionMounted(cpu, slot, addr) {
        this._cpu = cpu;
        this._mounted = !!cpu;
        this._expSlot = slot;
        if (addr) {
            this._ioKind = addr.kind;
            this._ioBase = addr.base;
        } else if (!cpu) {
            this._ioKind = null;
            this._ioBase = -1;
        }
        this._refreshAddressLabels();
    }

    _refreshAddressLabels() {
        if (this._ioText) this._ioText.text(this._expSlot >= 0 ? `槽 ${this._expSlot}` : '未挂接');
        if (this._addrText) {
            const list = (typeof this.getChannelAddressList === 'function') ? this.getChannelAddressList() : [];
            this._addrText.text((list && list.length) ? list.join('\n') : '未挂接');
        }
        this.markDirty();
        this._refreshIfDirty();
    }

    // ═══════════════════════════════════════════════════════════
    // 配置
    // ═══════════════════════════════════════════════════════════
    getConfigFields() {
        return [
            { label: '位号/名称', key: 'label', type: 'text' },
        ].concat(this.getExtraConfigFields());
    }

    onConfigUpdate(cfg = {}) {
        if (cfg.label !== undefined) this.label = cfg.label;
        this._applyExtraConfig(cfg);
        this.config = Object.assign({}, this.config, cfg);
        this._refreshAddressLabels();
    }

    _applyExtraConfig() { /* 子类实现 */ }

    tick(dt) {
        // 指示灯：仅当已接入扩展接口（挂接到 CPU 或上一级模块）时点亮
        this._statusLed.fill(this._mounted ? '#2ecc71' : '#26303a');
        this._updateValues(dt);
        this.markDirty();
        this._refreshIfDirty();
    }

    _updateValues(dt) { /* 子类实现 */ }

    destroy() { super.destroy?.(); }
}
