import { BaseComponent } from './BaseComponent.js';

/**
 * CoolingSystem —— 柴油机冷却水温度测点（集成 PT100 测温元件与温度 LCD）
 *
 * 布局：
 *   整体尺寸 W×H（默认 130×140）
 *   · 上部：PT100 测温探棒（嵌入组件内）
 *   · 中部：温度 LCD（显示传感器测得温度）
 *   · 顶边：两个外部接线端（左→右）：PT100 的 l / r
 *
 * 模拟：
 *   · 温度物理模型：柴油机产热、水泵+三通调节阀带走热量、被动散热；
 *   · PT100 测温延迟 + 传感器惯性；
 *   · `_pt100Fault` 模拟 PT100 短路（阻值 0）与断路（阻值 ∞）。
 *
 * 遵循新组件模板：
 *   构造函数 `_initGroups → _recalcGeometry → _initParameters → _init`，
 *   `_init` 内 `_drawStaticParts` + `_createDynamicNodes` + `_bindInteraction`，最后 `addPort`。
 *   · 外壳/PT100 探棒/LCD 外框/接线端底座入 `_staticGroup`（缓存一次）；
 *   · LCD 数值与单位入 `_dynamicGroup`，tick 中 in-place 更新；
 *   · 部件识别 `pt100` / `lcd` 供自动演示箭头定位；
 *   · 无 shadow 三件套，运行时不再刷新静态缓存。
 */
export class CoolingSystem extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.type = 'resistor';
        this.special = 'cooling'; // 特殊标记，供系统区分对待
        this.cache = 'fixed';

        this._initGroups();
        this._recalcGeometry(config);
        this._initParameters(config);
        this._init();

        this.config = { id: this.id, W: this.W, H: this.H };

        // 顶边两个 PT100 接线端（位于 group 坐标系）
        const pt100cx = this.W / 2;
        this.addPort(pt100cx - 20, -7, 'l', 'wire', 'p');
        this.addPort(pt100cx + 20, -7, 'r', 'wire');
    }

    // ═══════════════════════════════════════════════════════
    // 几何 / 参数
    // ═══════════════════════════════════════════════════════

    _recalcGeometry(config) {
        this.W = config.W || 130;
        this.H = config.H || 140;
        this.title = config.title || '冷却水系统';
        // 目标宽 = 115，原宽 160 → scale ≈ 0.72
        this._subScale = (125 - 10) / 160;
    }

    _initParameters() {
        this._pt100Fault = null;    // PT100 故障：null=正常，'open'=断路，'short'=短路
        this.ambientT = 20;
        this.temp = this.ambientT;
        this.sensorTemp = this.ambientT; // 传感器读数，初始等于环境温度
        this.tempBuffer = [];            // 模拟测温延迟的温度缓冲队列
        this.currentResistance = 107.7;
        this._tickAcc = 0;
    }

    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
    }

    // ═══════════════════════════════════════════════════════
    // 静态部件
    // ═══════════════════════════════════════════════════════

    _drawStaticParts() {
        const g = this._staticGroup;
        const W = this.W, H = this.H;

        // 1. 外壳
        g.add(new Konva.Rect({ x: 0, y: 0, width: W, height: H, fill: '#f4f0e6', stroke: '#444', strokeWidth: 3, cornerRadius: 8 }));

        // 2. PT100 测温探棒（竖向）
        this._embedPT100(g);

        // 3. LCD 外框与标签
        const lw = 88, lh = 52;
        const lx = W / 2 - lw / 2;
        const ly = H / 2;
        g.add(new Konva.Rect({ x: lx - 4, y: ly, width: lw + 8, height: lh + 8, fill: '#222', stroke: '#111', strokeWidth: 2, cornerRadius: 5 }));
        g.add(new Konva.Rect({ x: lx, y: ly, width: lw, height: lh, fill: '#1a3a1a', stroke: '#0d2e0d', strokeWidth: 1, cornerRadius: 2 }));
        g.add(new Konva.Text({ x: lx, y: ly, width: lw, text: '温度', fontSize: 12, fill: '#4db84d', align: 'center', fontFamily: 'monospace' }));

        // 4. 顶边接线端底座（引线 + 小方块）
        this._drawTopPortBase(g, W / 2 - 20);
        this._drawTopPortBase(g, W / 2 + 20);

        // 5. 可识别部件
        this.addClickablePart('pt100', 15, 10, 100, 32);
        this.addClickablePart('lcd', lx, ly, lw, lh);
    }

    _embedPT100(g) {
        const cy = 38;
        const rawPts = [-10, 20, 10, 20, 20, 10, 30, 30, 40, 10, 50, 30, 60, 10, 70, 20, 90, 20];
        const grp = new Konva.Group({ x: 25, y: 20 });

        grp.add(new Konva.Line({ points: rawPts, stroke: '#2c3e50', strokeWidth: 2, lineJoin: 'round', lineCap: 'round' }));
        grp.add(new Konva.Line({ points: [-10, 20, -10, -10], stroke: '#f10000', strokeWidth: 2, lineJoin: 'round', lineCap: 'round' }));
        grp.add(new Konva.Line({ points: [-10, -10, 19, -10], stroke: '#f10000', strokeWidth: 2, lineJoin: 'round', lineCap: 'round' }));
        grp.add(new Konva.Line({ points: [90, 20, 90, -10], stroke: '#2c3e50', strokeWidth: 2, lineJoin: 'round', lineCap: 'round' }));
        grp.add(new Konva.Line({ points: [90, -10, 60, -10], stroke: '#020000', strokeWidth: 2, lineJoin: 'round', lineCap: 'round' }));
        grp.add(new Konva.Text({ x: this.W / 2 - 45 - 10, y: cy - 4, width: 56, text: 'PT100', fontSize: 13, fontStyle: 'bold', fill: '#2c3e50', align: 'center' }));

        g.add(grp);
        this._pt100Group = grp;
    }

    _drawTopPortBase(g, x) {
        g.add(new Konva.Line({ points: [x, 10, x, 0], stroke: '#666', strokeWidth: 1.5 }));
        g.add(new Konva.Rect({ x: x - 7, y: -14, width: 14, height: 14, fill: '#ddd6c0', stroke: '#555', strokeWidth: 1.5, cornerRadius: 2 }));
    }

    // ═══════════════════════════════════════════════════════
    // 动态节点（LCD 数值/单位）
    // ═══════════════════════════════════════════════════════

    _createDynamicNodes() {
        const d = this._dynamicGroup;
        const lw = 88, lh = 52;
        const lx = this.W / 2 - lw / 2;
        const ly = this.H / 2;

        this._lcdTemp = new Konva.Text({ x: lx, y: ly + 16, width: lw, text: '---.-', fontSize: 17, fontStyle: 'bold', fill: '#39ff39', align: 'center', fontFamily: 'monospace', listening: false });
        this._lcdUnit = new Konva.Text({ x: lx, y: ly + 40, width: lw, text: '°C', fontSize: 12, fill: '#2db32d', align: 'center', fontFamily: 'monospace', listening: false });
        d.add(this._lcdTemp, this._lcdUnit);
    }

    _bindInteraction() { /* 冷却水测点为被动部件，无交互 */ }

    // ═══════════════════════════════════════════════════════
    // 主循环
    // ═══════════════════════════════════════════════════════

    /** 集中化 tick 动画（20fps）：原始 100ms 节拍用累加器保持 */
    tick(dt) {
        this._tickAcc = (this._tickAcc || 0) + dt;
        if (this._tickAcc < 0.1) { this._refreshIfDirty(); return; }
        this._tickAcc = 0;
        this.update();
        this._refreshIfDirty();
    }

    update() {
        const dt = 0.1; // 物理更新步长固定为 100ms

        // 1. 温度物理模型：加热产生热量，阀门冷却与被动散热带走热量
        const heatGen = this.sys.comps.engine.engOn ? this.sys.comps.engine.fuelRate * 72 : 0;
        const activeCool = this.sys.comps.pump.pumpOn ? this.sys.comps.valve.currentPos * (this.temp - this.ambientT) * 1.2 : 0;
        const passiveCool = this.sys.comps.pump.pumpOn ? (this.temp - this.ambientT) * 0.1 : (this.temp - this.ambientT) * 0.01;
        const coreInertia = 15;
        const coolGen = activeCool + passiveCool;
        const netHeat = heatGen - coolGen;
        this.temp += netHeat * dt / coreInertia;
        this.temp = Math.min(this.temp, 120);

        // 2. 模拟 PT100 测温延迟（缓冲队列）
        const delaySteps = 20; // 20 × 100ms = 2s
        this.tempBuffer.push(this.temp);
        let delayedTemp;
        if (this.tempBuffer.length > delaySteps) delayedTemp = this.tempBuffer.shift();
        else delayedTemp = this.temp;

        // 3. 传感器读数平滑（惯性响应）
        const sensorTau = 3;
        this.sensorTemp += (delayedTemp - this.sensorTemp) * dt / sensorTau;

        this.updatePT100Resistance();

        // 动态文本 in-place 更新
        this._lcdTemp.text(this.sensorTemp.toFixed(1));
        this.renerPipesFlow();
    }

    updatePT100Resistance() {
        if (this._pt100Fault === 'open') this.currentResistance = 1e9;
        else if (this._pt100Fault === 'short') this.currentResistance = 0;
        else this.currentResistance = 100 + 0.3851 * this.sensorTemp;
    }

    // ═══════════════════════════════════════════════════════
    // 冷却水管路检查与流动动画
    // ═══════════════════════════════════════════════════════

    checkPipesReady() {
        const requiredPipes = [
            { from: 'engine_pipe_o', to: 'pump_pipe_i', type: 'pipe' },
            { from: 'pump_pipe_o', to: 'tconn_pipe_l', type: 'pipe' },
            { from: 'tconn_pipe_u', to: 'valve_pipe_u', type: 'pipe' },
            { from: 'tconn_pipe_r', to: 'cooler_pipe_i', type: 'pipe' },
            { from: 'cooler_pipe_o', to: 'valve_pipe_l', type: 'pipe' },
            { from: 'valve_pipe_r', to: 'engine_pipe_i', type: 'pipe' },
        ];
        const currentConns = this.sys.conns;
        const isConnected = (req) => currentConns.some(curr =>
            curr.type === 'pipe' && this.sys._connEqual(curr, req));
        return requiredPipes.every(req => isConnected(req));
    }

    renerPipesFlow() {
        const FLOW_SCALE = 2 / 3; // 水流动画整体速度系数（比原速慢 1/3）
        if (this.sys.comps.pump.pumpOn) {
            this.sys.lineLayer.find('.flow').forEach(flowLine => {
                const key = flowLine.getAttr('connKey');
                let speed = 3;
                let volume = 1;
                if (key.includes('cooler') || key.includes('tconn_pipe_r') || key.includes('valve_pipe_l')) {
                    volume = this.sys.comps.valve.currentPos;
                    speed = volume * 8;
                } else if (key.includes('tconn_pipe_u') && key.includes('valve_pipe_u')) {
                    volume = 1 - this.sys.comps.valve.currentPos;
                    speed = volume * 8;
                } else {
                    volume = 1;
                    speed = 5;
                }
                flowLine.dashOffset(flowLine.dashOffset() - speed * FLOW_SCALE);
                flowLine.strokeWidth(1 + volume * 5);
                if (volume < 0.05) {
                    flowLine.visible(false);
                } else {
                    flowLine.visible(true);
                    flowLine.dash([volume * 15, 10]);
                }
            });
        } else {
            this.sys.lineLayer.find('.flow').forEach(flowLine => flowLine.visible(false));
        }
    }

    // ═══════════════════════════════════════════════════════
    // 部件识别（供自动演示箭头定位）
    // ═══════════════════════════════════════════════════════

    getClickablePartCenter(partId) {
        const node = { pt100: this._pt100Group, lcd: this._lcdTemp }[partId];
        if (node) { const c = this.getNodeCenter(node); if (c) return c; }
        return super.getClickablePartCenter(partId);
    }

    // ═══════════════════════════════════════════════════════
    // 配置
    // ═══════════════════════════════════════════════════════

    getConfigFields() {
        return [
            { label: '器件名称 (ID)', key: 'id', type: 'text' },
            { label: '环境温度 (℃)', key: 'ambientT', type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.id) this.id = cfg.id;
        if (cfg.ambientT !== undefined) this.ambientT = parseFloat(cfg.ambientT);
        this.config = { ...this.config, id: this.id, ambientT: this.ambientT };
    }

    destroy() {
        super.destroy?.();
    }
}

export default CoolingSystem;
