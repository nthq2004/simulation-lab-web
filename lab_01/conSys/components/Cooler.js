import { BaseComponent } from './BaseComponent.js';

export class Cooler extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        this.type = 'Cooler';
        this.cache = 'fixed'; // 使用固定缓存，提升性能


        this.w = 300;
        this.h = 120;

        // 1. 大外壳（主体矩形 + 两端半球端盖）
        const body = new Konva.Rect({ x: 30, y: 10, width: this.w - 60, height: this.h - 20, fill: '#f6f6f4', stroke: '#91aecb', strokeWidth: 3, cornerRadius: 8, opacity: 0.4 });
        const leftCap = new Konva.Ellipse({ x: 30, y: this.h / 2, radius: { x: 30, y: this.h / 2 - 6 }, fill: '#7a7e82' });
        const rightCap = new Konva.Ellipse({ x: this.w - 30, y: this.h / 2, radius: { x: 28, y: this.h / 2 - 6 }, fill: '#8a8d8f', opacity: 0.7 });
        const shellFace = new Konva.Rect({ x: 34, y: 14, width: this.w - 90, height: this.h - 28, fill: '#ffffff', stroke: null, cornerRadius: 6 });

        // 2. 侧面进出法兰与箭头
        const flangeL = new Konva.Rect({ x: 10, y: this.h / 2 + 10, width: 20, height: 20, fill: '#95a5a6', stroke: '#2c3e50', strokeWidth: 1 });
        const flangeR = new Konva.Rect({ x: this.w - 36, y: this.h / 2 + 10, width: 20, height: 20, fill: '#95a5a6', stroke: '#2c3e50', strokeWidth: 1, opacity: 0.2 });
        const seaIn = new Konva.Arrow({ points: [16, this.h / 2 + 20, -16, this.h / 2 + 20], stroke: '#e74c3c', fill: '#e74c3c', strokeWidth: 4, pointerLength: 10, pointerWidth: 8 });
        const seaOut = new Konva.Arrow({ points: [this.w + 16, this.h / 2 + 20, this.w - 16, this.h / 2 + 20], stroke: '#3498db', fill: '#3498db', strokeWidth: 4, pointerLength: 10, pointerWidth: 8, opacity: 0.15 });

        // 标题文本
        const title = new Konva.Text({ x: 0, y: -10, width: this.w, text: '淡水冷却器', fontSize: 18, align: 'center', fill: '#2c3e50', fontStyle: 'bold' });

        this.group.add(body, rightCap, shellFace, leftCap, flangeL, flangeR, seaIn, seaOut, title);

        // 3. 绘制内部蛇形换热管 (黄色)
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
        // 绘制为多段黄色线（带圆头）
        for (let i = 0; i < pipePoints.length; i += 4) {
            const line = new Konva.Line({ points: [pipePoints[i], pipePoints[i + 1], pipePoints[i + 2], pipePoints[i + 3]], stroke: '#f1c40f', strokeWidth: 6, lineCap: 'round', lineJoin: 'round', visible: true });
            this.group.add(line);
        }

        // 4. 被冷却淡水管束 (黄色 S 型流道效果)
        this.tubeFlows = new Konva.Group();
        const rowCount = 6;
        const startX2 = 70, endX2 = this.w - 50;
        for (let i = 0; i < rowCount; i++) {
            const y = 20 + i * gapY;
            const tube = new Konva.Line({
                points: [startX2, y, endX2, y],
                stroke: '#f1c40f', strokeWidth: 4,
                opacity: 0.6
            });
            // 内部流动的淡水虚线（向右流）
            const flow = new Konva.Line({
                points: [startX2, y, endX2, y],
                stroke: '#0840f8', strokeWidth: 2,
                dash: [10, 15],
                name: 'fw_flow', visible: false
            });
            this.tubeFlows.add(tube, flow);
        }


        this.group.add(this.tubeFlows);

        //  定义端口（保持与系统匹配）。位置放在左右法兰中心
        this.addPort(22, this.h / 2 - 20, 'i', 'pipe', 'in');   // 入口
        this.addPort(this.w - 24, this.h / 2 - 20, 'o', 'pipe', 'out', 0.1); // 出口
        this._physicsTimer = setInterval(() => this.update(), 50);
    }

    /**
         * @param {number} load 流量系数 (0-1)
         */
    update() {
        this.fluence = this.sys.comps.valve.currentPos; // 获取当前流量系数
        // 淡水流动动画 (根据系统状态移动)
        const isFlowing = this.sys.comps.pump.pumpOn && this.fluence > 0.02;
        if (isFlowing) {
            this.tubeFlows.find('.fw_flow').forEach(line => {
                line.visible(true);
                // 向右流动，速度与 load 相关
                line.dashOffset(line.dashOffset() - (1 + this.fluence * 5));
                line.opacity(0.1 + this.fluence * 0.9);
                this._refreshCache();
            });
        }

    }

}