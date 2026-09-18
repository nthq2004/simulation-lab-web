/**
 * DCCurrent 直流电流源组件。
 *
 * 作用：这是一个用于仿真平台中的直流电流源设备，具备电源开关、量程切换、旋钮调节和数显显示等基本功能。
 * 它通常用来模拟实验台或教学场景中的稳定直流电流源，允许用户在界面上调节输出大小，并把结果反馈给系统中其他电路模块。
 *
 * 设计特点：
 * 1. 通过旋钮和量程选择控制输出电流大小；
 * 2. 通过电源键开关启用/禁用输出；
 * 3. 通过 LCD 数字显示当前电流值；
 * 4. 通过 getValue() 对外暴露输出值，供上层电路仿真求值。
 */
import { BaseComponent } from './BaseComponent.js';

export class DCCurrent extends BaseComponent {
    constructor(config, sys) {
        // 调用父类构造函数，初始化通用组件能力，如 group、交互层和系统引用。
        super(config, sys);
        // 创建静态/动态/交互两个常用图层，分离固定图形与可更新状态。
        this._initGroups();

        // 组件整体按比例放大，确保在画布上有更明显的仪表尺寸。
        this.scale = 1.2;
        this.width = 145 * this.scale;
        this.height = 135 * this.scale;

        // 组件类型标识为通用电源对象，方便系统在求解器、连接、布局中识别该器件。
        this.type = 'source';
        // 静态外观使用 fixed 缓存，减少重绘压力。
        this.cache = 'fixed';

        // 设备状态：电源是否开启、是否故障断开、当前电流值和量程范围。
        this.isOn = false;
        this.isBreak = false;
        this.currentValue = config.currentValue || 0;
        this.maxValue = 1000;
        this.rOn = 10000000;
        this.range = 'mA';

        // 按顺序执行初始化绘制过程。
        this._init();

        // 左右端口位于底部，分别作为负极和正极，供电路连接使用。
        this.addPort(45 * this.scale, 135 * this.scale, 'n', 'wire');
        this.addPort(100 * this.scale, 135 * this.scale, 'p', 'wire', 'p');
    }

    _init() {
        // 组件初始化分四部分：底盘、铭牌、LCD 显示屏、控制区。
        this._drawChassis();
        this._drawNameplate();
        this._drawLCD();
        this._drawControls();
    }

    _drawChassis() {
        // 绘制底盘主体，为设备提供稳定的外壳和边框。
        this.chassis = new Konva.Rect({
            width: this.width,
            height: this.height,
            fill: '#ecf0f1',
            stroke: '#2c3e50',
            strokeWidth: 3 * this.scale,
            cornerRadius: 5 * this.scale
        });
        this._staticGroup.add(this.chassis);
    }

    _drawNameplate() {
        // 添加设备名称和厂家标识，增强仪器的真实感。
        const title = new Konva.Text({
            x: 10 * this.scale, y: 5 * this.scale,
            text: `DC 电流源`,
            fontSize: 12 * this.scale,
            fontStyle: 'bold'
        });
        const school = new Konva.Text({
            x: this.width - 60 * this.scale, y: 5 * this.scale,
            text: '江苏航院',
            fontSize: 11 * this.scale
        });
        this._staticGroup.add(title, school);
    }

    _drawLCD() {
        // 定义液晶显示区域，营造传统测试仪器的界面感。
        const lcdHeight = 30 * this.scale;
        const lcdBg = new Konva.Rect({
            x: 10 * this.scale, y: 18 * this.scale,
            width: this.width - 20 * this.scale,
            height: lcdHeight,
            fill: '#000',
            cornerRadius: 3 * this.scale
        });

        // 创建显示当前电流值的文本节点，后续在 update() 中动态更新内容。
        this.currentText = new Konva.Text({
            x: 10 * this.scale, y: 22 * this.scale,
            width: this.width - 20 * this.scale,
            text: '',
            fontSize: 22 * this.scale,
            fontFamily: 'monospace',
            fill: '#00ff00',
            align: 'center'
        });

        this._staticGroup.add(lcdBg, this.currentText);
    }

    _drawControls() {
        // 控制区位于电源仪表后半部分，汇总电源键、量程切换和旋钮调节。
        const ctrlY = 78 * this.scale;

        this._drawPowerButton(ctrlY);
        this._drawRangeSelector(ctrlY);
        this._drawKnob(ctrlY);
    }

    _drawPowerButton(ctrlY) {
        // 创建电源按键组，用于开关电流源输出。
        this.powerBtnGroup = new Konva.Group({ x: 12 * this.scale, y: ctrlY });

        this.powerBtnBase = new Konva.Rect({
            width: 33 * this.scale, height: 20 * this.scale,
            fill: '#bdc3c7',
            stroke: '#7f8c8d',
            strokeWidth: 1 * this.scale,
            shadowColor: '#000',
            shadowBlur: 5 * this.scale,
            shadowOffset: { x: 2 * this.scale, y: 2 * this.scale },
            cornerRadius: 2 * this.scale
        });

        const btnText = new Konva.Text({
            x: 0, y: 25 * this.scale,
            text: '电源键',
            fontSize: 12 * this.scale,
            fontStyle: 'bold',
            fill: '#34495e'
        });

        this.powerBtnGroup.add(this.powerBtnBase, btnText);
        this.powerBtnGroup.on('mousedown touchstart', () => {
            // 点击电源键时切换开关状态，并立即同步刷新显示。
            this.isOn = !this.isOn;
            this.update();
        });
        this.powerBtnGroup.on('dblclick', (e) => {
            // 双击事件用于阻止冒泡，避免误触发外部事件。
            e.cancelBubble = true;
        });
        this._interactGroup.add(this.powerBtnGroup);
    }

    _drawRangeSelector(ctrlY) {
        // 量程选择框用于在 µA 与 mA 两个量程之间切换。
        const rx = 12 * this.scale;
        const ry = ctrlY - 22 * this.scale;
        const ranges = ['uA', 'mA'];
        this._rangeTexts = [];

        this.rangeGroup = new Konva.Group({ x: rx, y: ry });
        this.rangeBg = new Konva.Rect({
            width: 52 * this.scale, height: 16 * this.scale,
            fill: '#2c3e50',
            cornerRadius: 2 * this.scale,
        });
        this.rangeGroup.add(this.rangeBg);

        ranges.forEach((label, i) => {
            // 为每个量程文本创建独立点击区域，并在当前量程时高亮显示。
            const tx = 4 * this.scale + i * 26 * this.scale;
            const txt = new Konva.Text({
                x: tx, y: 2 * this.scale,
                width: 22 * this.scale,
                text: label,
                fontSize: 10 * this.scale,
                fontStyle: 'bold',
                align: 'center',
                fill: label === this.range ? '#00ff00' : '#7f8c8d',
            });
            txt.on('mousedown touchstart', (e) => {
                e.cancelBubble = true;
                this.range = label;
                this._updateRangeHighlight();
                this.update();
            });
            this.rangeGroup.add(txt);
            this._rangeTexts.push(txt);
        });
        this._interactGroup.add(this.rangeGroup);
    }

    _drawKnob(ctrlY) {
        // 旋钮用于调节输出电流大小，类似常见直流电源的调压旋钮。
        const knobX = this.width - 50 * this.scale;
        const knobY = ctrlY + 10 * this.scale;
        this.knobGroup = new Konva.Group({ x: knobX, y: knobY });

        const scaleValues = [0, 200, 400, 600, 800, 1000];
        scaleValues.forEach(v => {
            // 依次绘制刻度值，模拟真实仪表的刻度盘。
            const angle = (v / 1000) * 300 - 150;
            const rad = (angle - 90) * Math.PI / 180;
            const r = 32 * this.scale;

            const txt = new Konva.Text({
                x: r * Math.cos(rad) - 10 * this.scale,
                y: r * Math.sin(rad) - 5 * this.scale,
                text: v.toString(),
                fontSize: 10 * this.scale,
                fontStyle: 'bold',
                width: 20 * this.scale,
                align: 'center',
                fill: '#0a1314'
            });
            this.knobGroup.add(txt);
        });

        const knobCircle = new Konva.Circle({
            radius: 26 * this.scale,
            fill: '#e3e8e9',
            stroke: '#34495e',
            cursor: 'hand'
        });

        this.knobPointer = new Konva.Line({
            points: [0, 0, 0, -24 * this.scale],
            stroke: '#e74c3c',
            strokeWidth: 2 * this.scale,
            lineCap: 'round',
            rotation: 135
        });

        this.knobGroup.add(knobCircle, this.knobPointer);

        knobCircle.on('mousedown touchstart', (e) => {
            // 拖动旋钮时通过鼠标移动更新 currentValue，并实时刷新输出值。
            e.cancelBubble = true;
            const startY = e.evt.clientY || e.evt.touches[0].clientY;
            const startV = this.currentValue;
            const onMove = (me) => {
                const cy = me.clientY || (me.touches ? me.touches[0].clientY : me.clientY);
                this.currentValue = Math.max(0, Math.min(1000, startV + (startY - cy) * 0.5));
                this.update();
            };
            const onUp = () => {
                this.update();
                window.removeEventListener('mousemove', onMove);
                window.removeEventListener('touchmove', onMove);
                window.removeEventListener('mouseup', onUp);
                window.removeEventListener('touchend', onUp);
            };
            window.addEventListener('mousemove', onMove);
            window.addEventListener('touchmove', onMove);
            window.addEventListener('mouseup', onUp);
            window.addEventListener('touchend', onUp);
        });
        knobCircle.on('dblclick', (e) => {
            // 防止双击时触发额外冒泡事件造成误操作。
            e.cancelBubble = true;
        });

        this._interactGroup.add(this.knobGroup);
    }

    _updateRangeHighlight() {
        // 根据当前量程高亮对应文本，给出清晰的用户反馈。
        const ranges = ['uA', 'mA'];
        ranges.forEach((label, i) => {
            this._rangeTexts[i].fill(label === this.range ? '#00ff00' : '#7f8c8d');
        });
    }

    _getCurrentInAmps() {
        // 如果电源关闭或故障断开，则返回 0，避免输出错误电流。
        if (!this.isOn || this.isBreak) return 0;
        return this.range === 'uA' ? this.currentValue * 1e-6 : this.currentValue * 1e-3;
    }

    _updateBtnStyle() {
        // 根据电源状态调整按键样式，模拟真正的按下/释放状态。
        if (this.isOn) {
            this.powerBtnBase.setAttrs({
                shadowBlur: 0,
                shadowOffset: { x: 0, y: 0 },
                x: 1 * this.scale, y: 1 * this.scale,
                fill: '#bdc3c7'
            });
        } else {
            this.powerBtnBase.setAttrs({
                shadowBlur: 5 * this.scale,
                shadowOffset: { x: 2 * this.scale, y: 2 * this.scale },
                x: 0, y: 0,
                fill: '#bdc3c7'
            });
        }
    }

    getValue() {
        // 对外暴露电流源输出值，供外部电路求解器读取。
        if (!this.isOn || this.isBreak) return 0;
        const currentA = this._getCurrentInAmps();
        return currentA * this.rOn;
    }

    update() {
        // 该方法是整个组件的状态同步入口，负责更新电阻、旋钮角度和显示文本。
        this.rOn = (this.isOn && !this.isBreak) ? 10000000 : 1e9;

        this._updateBtnStyle();
        const angle = (this.currentValue / 1000) * 300 - 150;
        this.knobPointer.rotation(angle);
        if (this.sys.onComponentStateChange)
            this.sys.onComponentStateChange(this);

        // 如果电源关闭，LCD 显示 OFF；否则按量程和数值输出对应文本。
        if (!this.isOn) {
            this.currentText.text('OFF');
            this.currentText.fill('#333');
        } else {
            const val = this.currentValue;
            let display, unit;
            if (this.range === 'uA') {
                display = val.toFixed(1);
                unit = ' uA';
            } else {
                display = val.toFixed(1);
                unit = ' mA';
            }
            this.currentText.text(display + unit);
            this.currentText.fill('#00ff00');
        }
        this._refreshCache();
    }

    destroy() {
        // 调用父类销毁逻辑，保持生命周期管理的一致性。
        super.destroy?.();
    }
}
