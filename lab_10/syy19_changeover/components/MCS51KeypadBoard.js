import { BaseComponent } from './BaseComponent.js';

/**
 * MCS51KeypadBoard — 8051 开关板（LCD1602 液晶 + 4×4 矩阵键盘）
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  绑定画布上的某个 8051 组件（config.target，默认 'mcu1'）。
 *
 *  I/O 约定：
 *    · LCD1602（8 位模式，只写，RW 可悬空）：
 *        数据 P0.0~P0.7；RS = P2.0；E = P2.1（RW = P2.2，可忽略）
 *    · 4×4 矩阵键盘：
 *        行 P1.0~P1.3（输出，低有效）；列 P1.4~P1.7（输入，低有效）
 *
 *  实现要点：
 *    · 键盘：向求解器注册"实时输入提供者"，按键按下时把对应列拉低（可真实扫描）
 *    · 液晶：读取求解器的端口写日志，捕捉帧内 E 脉冲，按 HD44780 命令/数据解析并显示
 */
export class MCS51KeypadBoard extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        this.width = 640;
        this.height = 400;
        this.type = 'mcs51_board';
        this.cache = 'fixed';

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        this.config = { id: this.id, target: this.target, title: this.title };
    }

    _recalcGeometry() { /* 固定版图 */ }

    _initParameters(config) {
        this.target = config.target || 'mcu1';
        this.title = config.title || '8051 开关板';

        // LCD 状态
        this._ddram = new Uint8Array(128).fill(0x20);
        this._addr = 0;
        this._prevE = 0;
        this._lastData = 0;

        // 键盘状态
        this._pressed = new Set();       // 0..15
        this._keys = null;               // Konva 节点
        this._ctx = null;                // 已注册提供者的上下文
        this._keyDown = false;
    }

    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
    }

    _drawStaticParts() {
        const g = this._staticGroup;
        // PCB
        g.add(new Konva.Rect({ x: -320, y: -200, width: 640, height: 400, cornerRadius: 12, fill: '#123a2a', stroke: '#0a2419', strokeWidth: 2 }));
        g.add(new Konva.Rect({ x: -308, y: -188, width: 616, height: 376, cornerRadius: 10, fill: '#164e37', stroke: '#0d3223', strokeWidth: 1 }));
        g.add(new Konva.Text({ x: -300, y: -182, width: 600, text: this.title, fontFamily: 'Microsoft YaHei', fontSize: 15, fontStyle: 'bold', fill: '#d1fae5' }));
        // 安装孔
        [[-308, -188], [308, -188], [-308, 188], [308, 188]].forEach(([x, y]) =>
            g.add(new Konva.Circle({ x, y, radius: 6, fill: '#0a1f16', stroke: '#2f6b50', strokeWidth: 1 })));

        // LCD 外框
        g.add(new Konva.Rect({ x: -290, y: -150, width: 340, height: 120, cornerRadius: 6, fill: '#1b2b33', stroke: '#0b1418', strokeWidth: 2 }));
        g.add(new Konva.Rect({ x: -276, y: -136, width: 312, height: 92, cornerRadius: 3, fill: '#0f3d1e', stroke: '#0a2914', strokeWidth: 1 }));
        g.add(new Konva.Text({ x: -290, y: -24, width: 340, text: 'LCD1602  数据P0  RS=P2.0  E=P2.1', fontFamily: 'Consolas', fontSize: 11, fill: '#86efac' }));

        // 键盘外框
        g.add(new Konva.Rect({ x: 70, y: -150, width: 236, height: 236, cornerRadius: 8, fill: '#0f3d2a', stroke: '#0a2419', strokeWidth: 2 }));
        g.add(new Konva.Text({ x: 70, y: -172, width: 236, align: 'center', text: '4×4 矩阵键盘（行 P1.0-3 / 列 P1.4-7）', fontFamily: 'Microsoft YaHei', fontSize: 11, fill: '#a7f3d0' }));
    }

    _createDynamicNodes() {
        const d = this._dynamicGroup;
        // LCD 两行文本
        this._lcd0 = new Konva.Text({ x: -268, y: -122, width: 300, text: ' '.repeat(16), fontFamily: 'Consolas,monospace', fontSize: 22, fill: '#6ee7a8' });
        this._lcd1 = new Konva.Text({ x: -268, y: -92, width: 300, text: ' '.repeat(16), fontFamily: 'Consolas,monospace', fontSize: 22, fill: '#6ee7a8' });
        d.add(this._lcd0); d.add(this._lcd1);

        // 键盘 4×4
        const labels = [
            ['7', '8', '9', '+'],
            ['4', '5', '6', '-'],
            ['1', '2', '3', '*'],
            ['0', '/', '=', 'C'],
        ];
        this._keys = [];
        const x0 = 70, y0 = -150, w = 236, h = 236, cw = w / 4, chh = h / 4;
        for (let r = 0; r < 4; r++) {
            for (let c = 0; c < 4; c++) {
                const x = x0 + c * cw + 4, y = y0 + r * chh + 4, bw = cw - 8, bh = chh - 8;
                const rect = new Konva.Rect({ x, y, width: bw, height: bh, cornerRadius: 6, fill: '#1f7a55', stroke: '#0a2419', strokeWidth: 1.5 });
                const txt = new Konva.Text({ x, y: y + bh / 2 - 10, width: bw, align: 'center', text: labels[r][c], fontFamily: 'Consolas', fontSize: 16, fontStyle: 'bold', fill: '#ecfdf5' });
                d.add(rect); d.add(txt);
                const idx = r * 4 + c;
                rect.on('mousedown touchstart', (e) => { e.cancelBubble = true; this._pressed.add(idx); this._keyDown = true; rect.fill('#0ea56b'); this.sys.requestRedraw && this.sys.requestRedraw(); });
                const up = () => { if (!this._pressed.has(idx)) return; this._pressed.delete(idx); this._keyDown = this._pressed.size > 0; rect.fill('#1f7a55'); this.sys.requestRedraw && this.sys.requestRedraw(); };
                rect.on('mouseup touchend mouseleave', up);
                this._keys.push({ rect, idx });
            }
        }

        this._status = new Konva.Text({ x: -308, y: 120, width: 616, text: '', fontFamily: 'Consolas', fontSize: 12, fill: '#d1fae5' });
        d.add(this._status);
    }

    _bindInteraction() { /* 按键事件已在节点上绑定 */ }

    _resolveTargetId() {
        if (this.sys.comps && this.sys.comps[this.target] && this.sys.comps[this.target].type === 'd_mcs51') return this.target;
        const any = Object.values(this.sys.comps || {}).find(c => c && c.type === 'd_mcs51');
        return any ? any.id : null;
    }

    // ── LCD（HD44780 子集）──
    _lcdLatch(data, rs) {
        data &= 0xFF;
        if (rs) {
            this._ddram[this._addr & 0x7F] = data;
            this._addr = (this._addr + 1) & 0x7F;
            return;
        }
        if (data & 0x80) { this._addr = data & 0x7F; return; }          // Set DDRAM addr
        if (data === 0x01) { this._ddram.fill(0x20); this._addr = 0; return; } // Clear
        if (data === 0x02) { this._addr = 0; return; }                  // Home
        if (data & 0x04) return;                                        // Entry mode
        if (data & 0x08) return;                                        // Display on/off
        if (data & 0x10) return;                                        // Cursor/display shift
        if (data & 0x20) return;                                        // Function set
        if (data & 0x40) return;                                        // Set CGRAM
    }

    _lcdLine(base) {
        let s = '';
        for (let i = 0; i < 16; i++) {
            const c = this._ddram[(base + i) & 0x7F];
            s += (c >= 32 && c < 127) ? String.fromCharCode(c) : ' ';
        }
        return s;
    }

    tick(dt) {
        const solver = this.sys.mcs51Solver;
        const id = this._resolveTargetId();
        const ctx = (solver && id && solver.getContext) ? solver.getContext(id) : null;

        // 目标（重新）连接：注册实时键盘输入
        if (ctx && ctx !== this._ctx) {
            this._ctx = ctx;
            this._prevE = 0;
            if (typeof solver.setPortInputProvider === 'function') {
                solver.setPortInputProvider(id, (name, sfrVal) => {
                    if (name !== 'p1') return null;
                    const rows = sfrVal & 0x0F;
                    let cols = 0xF0;
                    for (let r = 0; r < 4; r++) {
                        if ((rows >> r) & 1) continue;      // 该行未被拉低
                        for (let c = 0; c < 4; c++) if (this._pressed.has(r * 4 + c)) cols &= (0xFF ^ (0x10 << c));
                    }
                    return (rows & 0x0F) | (cols & 0xF0);
                });
            }
            this._ddram.fill(0x20); this._addr = 0;
        }

        // 处理端口写日志（捕捉 E 脉冲）
        if (solver && id && typeof solver.drainPortLog === 'function') {
            const evs = solver.drainPortLog(id) || [];
            for (const ev of evs) {
                if (ev.a === 0x80) { this._lastData = ev.v; }
                else if (ev.a === 0xA0) {
                    const rs = ev.v & 1, e = (ev.v >> 1) & 1;
                    if (this._prevE === 1 && e === 0) this._lcdLatch(this._lastData, rs);
                    this._prevE = e;
                }
            }
        }

        // 刷新显示
        this._lcd0.text(this._lcdLine(0x00));
        this._lcd1.text(this._lcdLine(0x40));
        if (this._status) {
            if (!ctx) this._status.text('目标：未找到 8051 组件（请检查配置 target）');
            else {
                const state = ctx.halted ? 'HLT' : (ctx.debug && ctx.debug.paused ? 'PAUSE' : 'RUN');
                this._status.text(`目标 ${id}　PC=0x${ctx.pc.toString(16).toUpperCase().padStart(4, '0')}　P1=0x${(ctx.sfr[0x10] || 0).toString(16).toUpperCase().padStart(2, '0')}　状态=${state}　按下的键：${[...this._pressed].map(i => i + 1).join(',') || '—'}`);
            }
        }
        this.markDirty();
        this._refreshIfDirty();
    }

    /** 供上位机读取液晶两行文本 */
    getLcdText() { return [this._lcdLine(0x00), this._lcdLine(0x40)]; }

    getConfigFields() {
        return [
            { label: '名称', key: 'title', type: 'text' },
            { label: '绑定 MCU（组件 id）', key: 'target', type: 'text' },
        ];
    }

    onConfigUpdate(cfg = {}) {
        if (cfg.title !== undefined) this.title = cfg.title;
        if (cfg.target !== undefined) this.target = cfg.target;
        this.config = { id: this.id, target: this.target, title: this.title };
        this.sys.requestRedraw && this.sys.requestRedraw();
    }
}

export default MCS51KeypadBoard;
