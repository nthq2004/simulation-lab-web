import { BaseComponent } from './BaseComponent.js';

/**
 * 淡水冷却器（Cooler）仿真组件
 *
 * 概述：在可视化面板上渲染一个淡水式换热器的示意图，包含外壳、换热管束与
 * 入口/出口法兰，并提供简单的流动动画（依赖外部泵与阀门状态）。
 *
 * 遵循新组件模板：
 *   构造函数 `_initGroups → _recalcGeometry → _initParameters → _init`，
 *   `_init` 内 `_drawStaticParts` + `_createDynamicNodes` + `_bindInteraction`，最后 `addPort`。
 *   · 静态外壳/管束绘入 `_staticGroup`（init 时缓存一次，运行时不刷新）；
 *   · 流动虚线圈 `tubeFlows` 绘入 `_dynamicGroup`，tick 中 in-place 更新；
 *   · 无 shadow 三件套。
 */
export class Cooler extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.type = 'Cooler';
        this.cache = 'fixed';

        this._initGroups();
        this._recalcGeometry(config);
        this._initParameters(config);
        this._init();

        this.config = { id: this.id };

        // 端口位置放在左右法兰中心
        this.addPort(22, this.h / 2 - 20, 'i', 'pipe', 'in');            // 入口
        this.addPort(this.w - 24, this.h / 2 - 20, 'o', 'pipe', 'out', 0.1); // 出口
    }

    // ═══════════════════════════════════════════════════════
    // 几何 / 参数
    // ═══════════════════════════════════════════════════════

    _recalcGeometry(config) {
        this.w = config.width || 300;
        this.h = config.height || 120;
        this._gapY = (this.h - 40) / 5;   // 管束 6 行间距
    }

    _initParameters() {
        this.fluence = 0;             // 当前流量系数（0..1）
        this._coolerWasFlowing = false;
    }

    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
    }

    // ═══════════════════════════════════════════════════════
    // 静态部件（外壳、管束、法兰、标题）
    // ═══════════════════════════════════════════════════════

    _drawStaticParts() {
        const g = this._staticGroup;
        const w = this.w, h = this.h;

        // 1. 大外壳（主体矩形 + 两端半球端盖）
        const body = new Konva.Rect({ x: 30, y: 10, width: w - 60, height: h - 20, fill: '#f6f6f4', stroke: '#91aecb', strokeWidth: 3, cornerRadius: 8, opacity: 0.4 });
        const leftCap = new Konva.Ellipse({ x: 30, y: h / 2, radius: { x: 30, y: h / 2 - 6 }, fill: '#7a7e82' });
        const rightCap = new Konva.Ellipse({ x: w - 30, y: h / 2, radius: { x: 28, y: h / 2 - 6 }, fill: '#8a8d8f', opacity: 0.7 });
        const shellFace = new Konva.Rect({ x: 34, y: 14, width: w - 90, height: h - 28, fill: '#ffffff', stroke: null, cornerRadius: 6 });

        // 2. 侧面进出法兰与箭头（指示流向）
        const flangeL = new Konva.Rect({ x: 10, y: h / 2 + 10, width: 20, height: 20, fill: '#95a5a6', stroke: '#2c3e50', strokeWidth: 1 });
        const flangeR = new Konva.Rect({ x: w - 36, y: h / 2 + 10, width: 20, height: 20, fill: '#95a5a6', stroke: '#2c3e50', strokeWidth: 1, opacity: 0.2 });
        const seaIn = new Konva.Arrow({ points: [16, h / 2 + 20, -16, h / 2 + 20], stroke: '#e74c3c', fill: '#e74c3c', strokeWidth: 4, pointerLength: 10, pointerWidth: 8 });
        const seaOut = new Konva.Arrow({ points: [w + 16, h / 2 + 20, w - 16, h / 2 + 20], stroke: '#3498db', fill: '#3498db', strokeWidth: 4, pointerLength: 10, pointerWidth: 8, opacity: 0.15 });

        // 标题文本
        const title = new Konva.Text({ x: 0, y: -10, width: w, text: '淡水冷却器', fontSize: 18, align: 'center', fill: '#2c3e50', fontStyle: 'bold' });

        g.add(body, rightCap, shellFace, leftCap, flangeL, flangeR, seaIn, seaOut, title);

        // 3. 内部蛇形换热管（黄色，按行交替方向）
        const pipePoints = [];
        const startX = 62;
        const endX = w - 40;
        const rows = 6;
        const gapY = (h - 40) / (rows - 1);
        for (let i = 0; i < rows; i++) {
            const y = 20 + i * gapY;
            if (i % 2 === 0) pipePoints.push(startX, y, endX, y);
            else pipePoints.push(endX, y, startX, y);
        }
        for (let i = 0; i < pipePoints.length; i += 4) {
            g.add(new Konva.Line({ points: [pipePoints[i], pipePoints[i + 1], pipePoints[i + 2], pipePoints[i + 3]], stroke: '#f1c40f', strokeWidth: 6, lineCap: 'round', lineJoin: 'round' }));
        }
    }

    // ═══════════════════════════════════════════════════════
    // 动态节点（流动虚线）
    // ═══════════════════════════════════════════════════════

    _createDynamicNodes() {
        const d = this._dynamicGroup;
        this.tubeFlows = new Konva.Group();
        const rowCount = 6;
        const startX2 = 70, endX2 = this.w - 50;
        for (let i = 0; i < rowCount; i++) {
            const y = 20 + i * this._gapY;
            const tube = new Konva.Line({ points: [startX2, y, endX2, y], stroke: '#f1c40f', strokeWidth: 4, opacity: 0.6 });
            const flow = new Konva.Line({ points: [startX2, y, endX2, y], stroke: '#0840f8', strokeWidth: 2, dash: [10, 15], name: 'fw_flow', visible: false, listening: false });
            this.tubeFlows.add(tube, flow);
        }
        d.add(this.tubeFlows);
    }

    _bindInteraction() { /* 冷却器为被动部件，无交互 */ }

    // ═══════════════════════════════════════════════════════
    // 主循环
    // ═══════════════════════════════════════════════════════

    tick(dt) {
        this.update();
        this._refreshIfDirty();
    }

    /** @param {number} load 流量系数 (0-1) */
    update() {
        // 读取系统中与流量相关的设备状态（阀门、泵），决定是否显示流动动画
        const valve = this.sys.comps.elecValve || this.sys.comps.valve;
        this.fluence = valve ? valve.currentPos : 0;

        const pump = this.sys.comps['pump-01'] || this.sys.comps.pump;
        const isFlowing = !!(pump && pump.pumpOn && this.fluence > 0.02);

        const wasFlowing = this._coolerWasFlowing;
        this._coolerWasFlowing = isFlowing;

        if (isFlowing) {
            // in-place 更新虚线流动轨迹（动态组，无需刷新静态缓存）
            this.tubeFlows.find('.fw_flow').forEach(line => {
                line.visible(true);
                // 流速与管路一致，整体取原来的 2/3
                line.dashOffset(line.dashOffset() - (1 + this.fluence * 5) * (2 / 3));
                line.opacity(0.1 + this.fluence * 0.9);
            });
        } else if (wasFlowing) {
            this.tubeFlows.find('.fw_flow').forEach(line => line.visible(false));
        }
    }

    // ═══════════════════════════════════════════════════════
    // 部件识别（供自动演示箭头定位）
    // ═══════════════════════════════════════════════════════

    getClickablePartCenter(partId) {
        const node = { tubes: this.tubeFlows }[partId];
        if (node) { const c = this.getNodeCenter(node); if (c) return c; }
        return super.getClickablePartCenter(partId);
    }

    // ═══════════════════════════════════════════════════════
    // 配置
    // ═══════════════════════════════════════════════════════

    getConfigFields() {
        return [{ label: '器件名称 (ID)', key: 'id', type: 'text' }];
    }

    onConfigUpdate(cfg) {
        if (cfg.id) this.id = cfg.id;
        this.config = { ...this.config, id: this.id };
    }

    destroy() {
        super.destroy?.();
    }
}

export default Cooler;
