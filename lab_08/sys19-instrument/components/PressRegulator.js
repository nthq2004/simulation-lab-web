import { BaseComponent } from './BaseComponent.js';

/**
 * 减压/稳压器组件（PressRegulator）
 *
 * 功能概述：
 * - 模拟一个简单的气压减压阀/稳压器：输出压力等于输入压力与设定压力之间的较小值（output = min(input, set)）；
 * - 提供手轮交互用于微调设定压力（单位内部统一为 MPa），支持鼠标滚轮与触摸滑动；
 * - 在界面上绘制输/出管道、手轮和两个工业风格的 LCD 数显（显示输入/输出及单位）；
 * - 支持单位切换（`MPa` / `BAR`），编辑器通过 `getConfigFields()` / `onConfigUpdate()` 调整属性。
 *
 * 设计说明：
 * - 视觉元素基于 Konva 构建，静态元素使用组件缓存（`this.cache = 'fixed'`）以提升渲染性能；
 * - 交互修改会调用 `sys.onConfigChange`（如果存在）以通知宿主保存配置；
 * - 所有内部压力以 MPa 存储，显示层负责单位换算。
 */
export class PressRegulator extends BaseComponent {
    /**
     * 构造器：初始化尺寸、状态与端口
     * @param {Object} config - 组件配置（可包含 setPressure, unit, reverse 等）
     * @param {Object} sys - 全局系统对象（用于配置回调与重绘）
     */
    constructor(config, sys) {
        super(config, sys);

        this.scale = 1.2;
        this.w = 140 * this.scale;
        this.h = 100 * this.scale;

        // 核心仿真属性
        this.type = 'regulator';
        this.cache = 'fixed';
        this._initGroups();
        this.inputPressure = 0;   // 输入气压 (内部统一单位：MPa)
        this.setPressure = config.setPressure || 0; // 设定压力值 (内部统一单位：MPa)
        this.outputPressure = 0;
        this.displayUnit = config.unit || 'MPa';

        // 初始配置对象同步
        this.config = { id: this.id, setPressure: this.setPressure, unit: this.displayUnit };

        this.initVisuals();

        // --- 端口设置 ---
        const reverse = config.reverse || false;
        const portY = this.h / 2 + 20 * this.scale;
        if (reverse) {
            this.leftDisplay = this._drawIndustrialLCD(25, -40 - 10, 'INPUT');
            this.rightDisplay = this._drawIndustrialLCD(-70, -40 - 10, 'OUTPUT');
            this.addPort(this.w - 10 * this.scale, portY, 'o', 'pipe');
            this.addPort(10 * this.scale, portY, 'i', 'pipe', 'in');
        } else {
            this.leftDisplay = this._drawIndustrialLCD(-70, -40 - 10, 'OUTPUT');
            this.rightDisplay = this._drawIndustrialLCD(25, -40 - 10, 'INPUT');
            this.addPort(10 * this.scale, portY, 'o', 'pipe');
            this.addPort(this.w - 10 * this.scale, portY, 'i', 'pipe', 'in');
        }

    }

    initVisuals() {
        /**
         * 构建静态视觉元素：管道、机体、手轮与 LCD 显示
         * 将整体放入 `this._staticGroup` 以便使用组件缓存
         */
        this.viewGroup = new Konva.Group({
            x: this.w / 2,
            y: this.h / 2 + 20 * this.scale,
            scaleX: this.scale,
            scaleY: this.scale
        });
        this._staticGroup.add(this.viewGroup);

        const bodyW = 40, bodyH = 40, pipeW = 120, pipeH = 40;

        // 1. 横向管道（表示气体流向的外观）
        const pipe = new Konva.Rect({
            x: -pipeW / 2, y: -pipeH / 2,
            width: pipeW, height: pipeH,
            fillLinearGradientStartPoint: { x: 0, y: -pipeH / 2 },
            fillLinearGradientEndPoint: { x: 0, y: pipeH / 2 },
            fillLinearGradientColorStops: [0, '#7f8c8d', 0.5, '#bdc3c7', 1, '#7f8c8d'],
            cornerRadius: 2,
            stroke: '#7f8c8d', strokeWidth: 1
        });

        // 2. 主框体（包含手轮轴与外壳）
        const body = new Konva.Rect({
            x: -bodyW / 2, y: -bodyH + 10,
            width: bodyW, height: bodyH,
            fillLinearGradientStartPoint: { x: -bodyW / 2, y: 0 },
            fillLinearGradientEndPoint: { x: bodyW / 2, y: 0 },
            fillLinearGradientColorStops: [0, '#95a5a6', 0.4, '#f5f5f5', 1, '#95a5a6'],
            cornerRadius: 3,
            stroke: '#7f8c8d', strokeWidth: 1
        });

        // 绘制手轮并加入视图
        this._drawHandWheel(0, -bodyH + 10);
        this.viewGroup.add(pipe, body);

        // 初始显示一次以同步 LCD 文本
        this.update();
    }

    _drawHandWheel(centerX, centerY) {
        /**
         * 绘制并绑定手轮交互：
         * - 鼠标滚轮改变设定压力（微调）
         * - 触摸滑动支持移动修改
         */
        const wheelCenterY = centerY - 32;
        this.wheelVisual = new Konva.Group({ x: centerX, y: wheelCenterY });

        const shaft = new Konva.Rect({
            x: -4, y: -40, width: 8, height: 12,
            fill: '#7f8c8d', stroke: '#333', strokeWidth: 0.5
        });

        const ring = new Konva.Ring({
            innerRadius: 18, outerRadius: 25,
            fill: '#2980b9', stroke: '#1c5982', strokeWidth: 2
        });

        for (let i = 0; i < 3; i++) {
            const spoke = new Konva.Rect({
                x: 0, y: 0, width: 4, height: 42,
                fill: '#1c5982', offsetX: 2, offsetY: 21,
                rotation: i * 60
            });
            this.wheelVisual.add(spoke);
        }

        this.wheelVisual.add(ring);
        this.viewGroup.add(shaft, this.wheelVisual);

        // 鼠标滚轮微调设定压力（delta 单位为 MPa 级别）
        this.wheelVisual.on('wheel', (e) => {
            e.cancelBubble = true;
            const delta = e.evt.deltaY > 0 ? -0.01 : 0.01;
            this.applyDelta(delta);
        });

        let lastY = null;
        // 触摸滑动支持连续微调：基于触摸位移计算 delta
        this.wheelVisual.on('touchstart', (e) => {
            e.cancelBubble = true;
            lastY = e.evt.touches[0].clientY;
        });
        this.wheelVisual.on('touchmove', (e) => {
            e.cancelBubble = true;
            const y = e.evt.touches[0].clientY;
            const dy = (lastY - y) * 0.001;
            lastY = y;
            this.applyDelta(dy);
        });
    }

    applyDelta(delta) {
        // 将 delta 应用到内部设定压力（MPa），并做范围限制
        // 乘以系数是为了将用户交互动作映射为合理的压力变化量
        this.setPressure = Math.max(0, Math.min(10, this.setPressure + (delta * 0.5)));
        // 视觉上旋转手轮以反馈用户操作
        this.wheelVisual.rotation(this.wheelVisual.rotation() + delta * 600);
        this.update();

        // 通知宿主系统配置变更（如果存在回调）
        if (this.sys && this.sys.onConfigChange) {
            this.sys.onConfigChange(this.config.id, { setPressure: this.setPressure });
        }
    }

    _drawIndustrialLCD(x, y, label) {
        // 工业风格的 LCD 数显：返回文本对象供外部更新
        const lcdGroup = new Konva.Group({ x, y });
        lcdGroup.add(new Konva.Rect({
            width: 45, height: 30, fill: '#34495e', cornerRadius: 1
        }));
        lcdGroup.add(new Konva.Rect({
            x: 2, y: 2, width: 41, height: 26, fill: '#1a1a1a'
        }));

        const valText = new Konva.Text({
            x: 0, y: 4, width: 45, text: '0.0',
            fontSize: 11, fontFamily: 'Courier New',
            fill: '#00ff00', align: 'center', fontStyle: 'bold'
        });

        lcdGroup.add(new Konva.Text({
            text: label, fontSize: 7, fill: '#ecf0f1', y: -8, x: 0
        }));

        lcdGroup.add(valText);
        this.viewGroup.add(lcdGroup);
        return valText;
    }

    setValue(pIn) {
        // 外部输入接口：传入 MPa 单位的压力并触发更新显示
        this.inputPressure = pIn; // pIn 必须是 MPa
        this.update();
    }

    update() {
        // 1) 计算输出：减压阀行为等于 min(输入, 设定)
        this.outputPressure = Math.min(this.inputPressure, this.setPressure);

        // 2) 格式化显示值：内部以 MPa 存储，若用户选择 BAR，则乘以 10
        const formatDisplay = (val) => {
            const v = (this.displayUnit === 'BAR') ? val * 10 : val;
            return v.toFixed(this.displayUnit === 'MPa' ? 3 : 2);
        };

        // 3) 更新左右 LCD：右侧显示输入，左侧显示输出（或反转，取决于 reverse）
        if (this.rightDisplay) this.rightDisplay.text(`${formatDisplay(this.inputPressure)}\n${this.displayUnit}`);
        if (this.leftDisplay) this.leftDisplay.text(`${formatDisplay(this.outputPressure)}\n${this.displayUnit}`);

        // 4) 指示灯颜色：当输出接近设定或达到设定时使用警示色
        const ledColor = this.outputPressure >= this.setPressure ? '#f1c40f' : '#00ff00';
        if (this.leftDisplay) this.leftDisplay.fill(ledColor);

        // 5) 刷新缓存以便重绘
        this._refreshCache();

    }

    getConfigFields() {
        return [
            { label: '器件名称 (ID)', key: 'id', type: 'text' },
            { label: '设定压力', key: 'setPressure', type: 'number' },
            {
                label: '压力单位',
                key: 'unit',
                type: 'select',
                options: [
                    { label: 'MPa (兆帕)', value: 'MPa' },
                    { label: 'BAR (公斤)', value: 'BAR' }
                ]
            }
        ];
    }

    onConfigUpdate(newConfig) {
        // 接收配置更新：支持 id、单位与设定压力
        if (newConfig.id) this.id = newConfig.id;
        this.displayUnit = newConfig.unit || 'MPa';

        if (newConfig.setPressure !== undefined) {
            let p = parseFloat(newConfig.setPressure);
            // 如果当前显示单位为 BAR，编辑器传入 BAR 值时需除以 10 转为 MPa 存储
            this.setPressure = (this.displayUnit === 'BAR') ? p / 10 : p;
        }
        // 重新计算并更新显示
        this.update();
    }


    destroy() {
        super.destroy?.();
    }
}
