import { BaseComponent } from './BaseComponent.js';

/**
 * 三阀组组件 (Three-valve Manifold)
 * 提取了 updateUI 方法，支持外部脚本控制
 */
export class ThreeValve extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        this.width = 180;
        this.height = 160;

        // 阀门状态
        this.vE = false; // 平衡阀
        this.vL = false; // 低压截止阀
        this.vH = false; // 高压截止阀

        this.type = '3valve';

        // 端口定义
        this.addPort(45, 140, 'inl', 'pipe', 'in');
        this.addPort(135, 140, 'inh', 'pipe', 'in');
        this.addPort(45, 20, 'outl', 'pipe');
        this.addPort(135, 20, 'outh', 'pipe');

        // 用于存放阀门 Konva 对象的引用，方便 updateUI 访问
        this.valveElements = {};

        this._init();
    }

    _init() {
        this.mainGroup = new Konva.Group();

        // 1. 绘制主体
        const body = new Konva.Rect({
            x: 20, y: 30,
            width: 140, height: 100,
            fill: '#c9cdce', stroke: '#95a5a6', strokeWidth: 2, cornerRadius: 5
        });

        // 2. 绘制超粗管路
        const pipeStyle = { stroke: '#7f8c8d', strokeWidth: 16, lineCap: 'round' };
        const pipes = new Konva.Group();
        pipes.add(new Konva.Line({ points: [45, 30, 45, 130], ...pipeStyle }));
        pipes.add(new Konva.Line({ points: [135, 30, 135, 130], ...pipeStyle }));
        pipes.add(new Konva.Line({ points: [45, 50, 135, 50], ...pipeStyle }));

        this.mainGroup.add(body, pipes);

        // 3. 绘制手柄式阀门
        this._drawHandleValve(90, 50, 'vE', '平衡阀', true);
        this._drawHandleValve(45, 90, 'vL', '低压阀', false);
        this._drawHandleValve(135, 90, 'vH', '高压阀', false);

        this.group.add(this.mainGroup);

        // 初始刷新 UI
        this.updateUI();
    }

    /**
     * 核心更新函数：外部脚本可以直接调用 this.updateUI()
     * 它会根据当前的 this.vE, this.vL, this.vH 同步所有手柄位置
     */
    updateUI() {
        for (let key in this.valveElements) {
            const { handle, isPipeHorizontal } = this.valveElements[key];
            const state = this[key];

            let targetRotation = 0;
            if (isPipeHorizontal) {
                // 水平管路：导通(true) 90度，截止(false) 0度
                targetRotation = state ? 90 : 0;
            } else {
                // 垂直管路：导通(true) 0度，截止(false) 90度
                targetRotation = state ? 0 : 90;
            }

            handle.rotation(targetRotation);
            handle.fill(state ? '#2ecc71' : '#e74c3c');
        }

        if (this.sys && typeof this.sys.requestRedraw === 'function') this.sys.requestRedraw();

    }

    _drawHandleValve(x, y, key, label, isPipeHorizontal) {
        const valveGroup = new Konva.Group({ x, y });

        const base = new Konva.Circle({
            radius: 10, fill: '#34495e', stroke: '#2c3e50'
        });

        const hW = 12;
        const hH = 36;
        const handle = new Konva.Rect({
            x: 0, y: 0,
            width: hW, height: hH,
            stroke: '#2c3e50',
            strokeWidth: 1.5,
            cornerRadius: 6,
            offsetX: hW / 2,
            offsetY: hH / 2
        });

        const textLabel = new Konva.Text({
            x: -25,
            y: isPipeHorizontal ? -40 : 22, // 如果是平衡阀，文字放上面避免挡住手柄旋转
            width: 50,
            text: label,
            fontSize: 12,
            fill: '#0580fa',
            align: 'center',
            fontStyle: 'bold'
        });

        // 关键：保存引用到 valveElements
        this.valveElements[key] = { handle, isPipeHorizontal };

        valveGroup.add(base, handle, textLabel);

        valveGroup.on('click tap', (e) => {
            e.cancelBubble = true;
            this[key] = !this[key];
            this.updateUI(); // 点击后调用独立的更新函数

            // 如果有拓扑更新需求
            if (this.sys && this.sys.updateTopology) {
                this.sys.updateTopology();
            }
        });

        this.mainGroup.add(valveGroup);
    }
}