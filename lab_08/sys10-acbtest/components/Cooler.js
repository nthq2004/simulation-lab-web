import { BaseComponent } from './BaseComponent.js';

/**
 * 淡水冷却器（Cooler）仿真组件
 *
 * 概述：在可视化面板上渲染一个淡水式换热器的示意图，包含外壳、换热管束与
 * 入口/出口法兰，并提供简单的流动动画（依赖外部泵与阀门状态）。
 *
 * 行为要点：
 *  - 组件静态部分（外壳与管束）放在 `_staticGroup`，以减少不必要的重绘
 *  - 动态流动虚线放在 `tubeFlows` 组，根据系统中泵/阀状态显示或隐藏并产生移动效果
 *  - 提供两个气/水端口：`i`（入口）和 `o`（出口），以与系统连线
 */
export class Cooler extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        this._initGroups();
        this.type = 'Cooler';
        this.cache = 'fixed'; // 使用固定缓存，提升性能

        // 组件总体尺寸（像素）——可根据需要从 config 中覆盖
        this.w = 300;
        this.h = 120;

        // ========== 绘制静态视觉元素 ==========
        // 1. 大外壳（主体矩形 + 两端半球端盖）
        const body = new Konva.Rect({ x: 30, y: 10, width: this.w - 60, height: this.h - 20, fill: '#f6f6f4', stroke: '#91aecb', strokeWidth: 3, cornerRadius: 8, opacity: 0.4 });
        const leftCap = new Konva.Ellipse({ x: 30, y: this.h / 2, radius: { x: 30, y: this.h / 2 - 6 }, fill: '#7a7e82' });
        const rightCap = new Konva.Ellipse({ x: this.w - 30, y: this.h / 2, radius: { x: 28, y: this.h / 2 - 6 }, fill: '#8a8d8f', opacity: 0.7 });
        const shellFace = new Konva.Rect({ x: 34, y: 14, width: this.w - 90, height: this.h - 28, fill: '#ffffff', stroke: null, cornerRadius: 6 });

        // 2. 侧面进出法兰与箭头（指示流向）
        const flangeL = new Konva.Rect({ x: 10, y: this.h / 2 + 10, width: 20, height: 20, fill: '#95a5a6', stroke: '#2c3e50', strokeWidth: 1 });
        const flangeR = new Konva.Rect({ x: this.w - 36, y: this.h / 2 + 10, width: 20, height: 20, fill: '#95a5a6', stroke: '#2c3e50', strokeWidth: 1, opacity: 0.2 });
        const seaIn = new Konva.Arrow({ points: [16, this.h / 2 + 20, -16, this.h / 2 + 20], stroke: '#e74c3c', fill: '#e74c3c', strokeWidth: 4, pointerLength: 10, pointerWidth: 8 });
        const seaOut = new Konva.Arrow({ points: [this.w + 16, this.h / 2 + 20, this.w - 16, this.h / 2 + 20], stroke: '#3498db', fill: '#3498db', strokeWidth: 4, pointerLength: 10, pointerWidth: 8, opacity: 0.15 });

        // 标题文本（静态）
        const title = new Konva.Text({ x: 0, y: -10, width: this.w, text: '淡水冷却器', fontSize: 18, align: 'center', fill: '#2c3e50', fontStyle: 'bold' });

        this._staticGroup.add(body, rightCap, shellFace, leftCap, flangeL, flangeR, seaIn, seaOut, title);

        // 3. 绘制内部蛇形换热管 (黄色)，按行绘制并交替方向以模拟真实管束走向
        const pipePoints = [];
        const startX = 62;
        const endX = this.w - 40;
        const rows = 6;
        const gapY = (this.h - 40) / (rows - 1);
        for (let i = 0; i < rows; i++) {
            const y = 20 + i * gapY;
            if (i % 2 === 0) {
                pipePoints.push(startX, y, endX, y);
            } else {
                pipePoints.push(endX, y, startX, y);
            }
        }
        // 将换热管绘制为多段黄色线（带圆头）
        for (let i = 0; i < pipePoints.length; i += 4) {
            const line = new Konva.Line({ points: [pipePoints[i], pipePoints[i + 1], pipePoints[i + 2], pipePoints[i + 3]], stroke: '#f1c40f', strokeWidth: 6, lineCap: 'round', lineJoin: 'round', visible: true });
            this._staticGroup.add(line);
        }

        // 4. 被冷却淡水管束 (黄色 S 型流道效果)，带一个可见/不可见的虚线流动轨迹
        this.tubeFlows = new Konva.Group();
        const rowCount = 6;
        const startX2 = 70, endX2 = this.w - 50;
        for (let i = 0; i < rowCount; i++) {
            const y = 20 + i * gapY;
            const tube = new Konva.Line({ points: [startX2, y, endX2, y], stroke: '#f1c40f', strokeWidth: 4, opacity: 0.6 });
            // 内部流动的淡水虚线（向右流），初始隐藏，动态通过 update 控制
            const flow = new Konva.Line({ points: [startX2, y, endX2, y], stroke: '#0840f8', strokeWidth: 2, dash: [10, 15], name: 'fw_flow', visible: false });
            this.tubeFlows.add(tube, flow);
        }

        this._staticGroup.add(this.tubeFlows);

        // 定义端口（与系统匹配）。位置放在左右法兰中心
        this.addPort(22, this.h / 2 - 20, 'i', 'pipe', 'in');   // 入口
        this.addPort(this.w - 24, this.h / 2 - 20, 'o', 'pipe', 'out', 0.1); // 出口
    }

    /**
     * 集中化 tick 动画（20fps）
     */
    tick(dt) {
        this.update();

        this._refreshIfDirty();
    }

    destroy() {
        super.destroy?.();
    }

    /**
         * @param {number} load 流量系数 (0-1)
         */
    update() {
        // 读取系统中与流量相关的设备状态（阀门、泵），决定是否显示流动动画
        const valve = this.sys.comps.elecValve || this.sys.comps.valve;
        this.fluence = valve ? valve.currentPos : 0; // 当前流量系数（0..1）

        // 判断泵是否开启并且流量系数足够大时视为存在流动
        const pump = this.sys.comps['pump-01'] || this.sys.comps.pump;
        const isFlowing = pump && pump.pumpOn && this.fluence > 0.02;

        const wasFlowing = this._coolerWasFlowing;
        this._coolerWasFlowing = isFlowing;

        if (isFlowing) {
            // 显示虚线流动轨迹，并根据流量调整虚线偏移与透明度
            this.tubeFlows.find('.fw_flow').forEach(line => {
                line.visible(true);
                // 虚线偏移产生“流动”视觉效果，偏移速度与流量相关
                line.dashOffset(line.dashOffset() - (1 + this.fluence * 5));
                line.opacity(0.1 + this.fluence * 0.9);
            });
            this.markDirty(); // 标记需要刷新缓存
        } else if (wasFlowing) {
            // 刚停止流动：隐藏流动轨迹并刷新
            this.tubeFlows.find('.fw_flow').forEach(line => line.visible(false));
            this.markDirty();
        }
    }

}