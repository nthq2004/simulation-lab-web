import { BaseComponent } from './BaseComponent.js';

/**
 * MCS51DemoBoard — 8051 目标板（示范外设）
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  绑定画布上的某个 8051 组件（config.target，默认 'mcu1'）：
 *    · 8 个 LED 指示 P1.0~P1.7（读 MCU 的 SFR P1 锁存值）
 *    · 4 个按键 INT0/INT1/T0/T1 → 写 P3.2/P3.3/P3.4/P3.5 外部输入
 *    · 底部显示目标、PC 与运行状态
 *
 *  与 MCU 通过 MCS51Solver 的 getContext()/setInputPin() 交互。
 */
export class MCS51DemoBoard extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        this.width = 460;
        this.height = 220;
        this.type = 'mcs51_board';
        this.cache = 'fixed';

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        this.config = { id: this.id, target: this.target, title: this.title };
    }

    _recalcGeometry() { /* 版图坐标固定 */ }

    _initParameters(config) {
        this.target = config.target || 'mcu1';
        this.title = config.title || '8051 目标板';
        this._leds = [];
        this._keyDown = {};
    }

    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
    }

    _drawStaticParts() {
        const g = this._staticGroup;
        // 线路板底
        g.add(new Konva.Rect({
            x: -220, y: -104, width: 440, height: 208, cornerRadius: 10,
            fill: '#123a2a', stroke: '#0a2419', strokeWidth: 2,
        }));
        g.add(new Konva.Rect({
            x: -210, y: -94, width: 420, height: 188, cornerRadius: 8,
            fill: '#164e37', stroke: '#0d3223', strokeWidth: 1,
        }));
        g.add(new Konva.Text({
            x: -205, y: -88, width: 410, text: this.title,
            fontFamily: 'Microsoft YaHei', fontSize: 14, fontStyle: 'bold', fill: '#d1fae5',
        }));
        // 固定安装孔
        [[-205, -89], [205, -89], [-205, 89], [205, 89]].forEach(([x, y]) => {
            g.add(new Konva.Circle({ x, y, radius: 5, fill: '#0a1f16', stroke: '#2f6b50', strokeWidth: 1 }));
        });
        // LED 引脚走线
        g.add(new Konva.Line({ points: [-180, -40, 180, -40], stroke: '#1f7a55', strokeWidth: 2 }));
        // 标签
        g.add(new Konva.Text({
            x: -200, y: -56, width: 400, text: 'P1 输出指示灯（连接 MCU 的 P1.0~P1.7）',
            fontFamily: 'Microsoft YaHei', fontSize: 11, fill: '#a7f3d0',
        }));
        g.add(new Konva.Text({
            x: -200, y: 8, width: 400, text: 'P3 输入按键（按下 = 低电平）：',
            fontFamily: 'Microsoft YaHei', fontSize: 11, fill: '#a7f3d0',
        }));
    }

    _createDynamicNodes() {
        const d = this._dynamicGroup;
        // 8 个 LED
        for (let i = 0; i < 8; i++) {
            const x = -180 + i * 52;
            const led = new Konva.Circle({ x, y: -40, radius: 12, fill: '#243b30', stroke: '#0a2419', strokeWidth: 1.5 });
            d.add(led);
            const lbl = new Konva.Text({ x: x - 16, y: -22, width: 32, align: 'center', text: `P1.${i}`, fontFamily: 'Consolas', fontSize: 10, fill: '#86efac' });
            d.add(lbl);
            this._leds.push(led);
        }
        // 4 个按键
        this._keyNodes = {};
        const keys = [['p3_2', 'INT0', 'P3.2'], ['p3_3', 'INT1', 'P3.3'], ['p3_4', 'T0', 'P3.4'], ['p3_5', 'T1', 'P3.5']];
        keys.forEach(([id, name, port], i) => {
            const x = -160 + i * 100;
            const rect = new Konva.Rect({
                x: x - 36, y: 26, width: 72, height: 34, cornerRadius: 6,
                fill: '#1f7a55', stroke: '#0a2419', strokeWidth: 1.5,
            });
            d.add(rect);
            const t = new Konva.Text({ x: x - 36, y: 34, width: 72, align: 'center', text: name, fontFamily: 'Microsoft YaHei', fontSize: 12, fontStyle: 'bold', fill: '#ecfdf5' });
            d.add(t);
            const p = new Konva.Text({ x: x - 36, y: 48, width: 72, align: 'center', text: port, fontFamily: 'Consolas', fontSize: 9, fill: '#bbf7d0' });
            d.add(p);
            this._keyNodes[id] = { rect, bit: parseInt(port.slice(3), 10) };
        });
        // 状态
        this._statusText = new Konva.Text({
            x: -205, y: 76, width: 410, text: '', fontFamily: 'Consolas', fontSize: 11, fill: '#d1fae5',
        });
        d.add(this._statusText);
    }

    _bindInteraction() {
        Object.entries(this._keyNodes).forEach(([id, k]) => {
            const press = (e) => {
                e.cancelBubble = true;
                this._keyDown[id] = true;
                this._apply(id, k.bit, 0);
                k.rect.fill('#0ea56b');
                this.sys.requestRedraw && this.sys.requestRedraw();
            };
            const release = () => {
                if (!this._keyDown[id]) return;
                this._keyDown[id] = false;
                this._apply(id, k.bit, 1);
                k.rect.fill('#1f7a55');
                this.sys.requestRedraw && this.sys.requestRedraw();
            };
            k.rect.on('mousedown touchstart', press);
            k.rect.on('mouseup touchend mouseleave', release);
        });
    }

    _apply(keyId, bit, val) {
        const solver = this.sys.mcs51Solver;
        const id = this._resolveTargetId();
        if (solver && id && typeof solver.setInputPin === 'function') solver.setInputPin(id, 'p3', bit, val);
    }

    _resolveTargetId() {
        if (this.sys.comps && this.sys.comps[this.target] && this.sys.comps[this.target].type === 'd_mcs51') return this.target;
        const any = Object.values(this.sys.comps || {}).find(c => c && c.type === 'd_mcs51');
        return any ? any.id : null;
    }

    tick(dt) {
        const solver = this.sys.mcs51Solver;
        const id = this._resolveTargetId();
        const ctx = (solver && id && solver.getContext) ? solver.getContext(id) : null;
        const p1 = ctx ? (ctx.sfr[0x10] || 0) : 0;
        for (let i = 0; i < 8; i++) {
            const on = (p1 >> i) & 1;
            this._leds[i].fill(on ? '#facc15' : '#243b30');
        }
        if (this._statusText) {
            if (!id) this._statusText.text('目标：未找到 8051 组件（请在配置里指定 target）');
            else {
                const state = ctx ? (ctx.halted ? 'HLT' : (ctx.debug && ctx.debug.paused ? 'PAUSE' : 'RUN')) : 'OFF';
                const pc = ctx ? ctx.pc : 0;
                this._statusText.text(`目标 ${id}　PC=0x${pc.toString(16).toUpperCase().padStart(4, '0')}　P1=0x${p1.toString(16).toUpperCase().padStart(2, '0')}　状态=${state}`);
            }
        }
        this.markDirty();
        this._refreshIfDirty();
    }

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

export default MCS51DemoBoard;
