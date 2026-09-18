/**
 * DCVoltage 直流电压源组件。
 *
 * 作用：用于在仿真平台中模拟一个可调直流电压源，具备电源开关、旋钮调节、数显显示和对外输出电压值等功能。
 * 它通常在实验教学场景中作为电压源设备出现，用户可通过界面调节输出电压，并由系统读取该数值参与后续电路求解。
 *
 * 设计特点：
 * 1. 使用旋钮控制输出电压大小；
 * 2. 开关控制输出启用/禁用；
 * 3. LCD 显示当前设定值，便于观测；
 * 4. getValue() 对外提供输出电压，供电路求解器使用。
 */
import { BaseComponent } from './BaseComponent.js';

export class DCVoltage extends BaseComponent {
    constructor(config, sys) {
        // 调用父类构造函数，初始化通用组件基础能力，例如布局、交互层和系统引用。
        super(config, sys);
        // 创建静态图层和交互图层，便于分离固定显示内容与动态可交互控件。
        this._initGroups();

        // 设置组件的缩放比例和物理尺寸，保证仪表整体在画布中比例协调。
        this.scale = 1.2;
        this.width = 145 * this.scale;
        this.height = 135 * this.scale;

        // 组件类型标记为 source，便于求解器和系统识别它作为电源设备。
        this.type = 'source';
        // 启用固定缓存以提高静态外观渲染性能。
        this.cache = 'fixed';

        // 电源状态变量：开关状态、短路/故障状态、当前设定电压和内部电阻。
        this.isOn = false;
        this.isBreak = false;
        this.voltageValue = config.voltageValue || 0;
        this.maxValue = 200;
        this.rOn = 1;

        // 按顺序执行初始化绘制流程，生成面板、铭牌、显示屏和控制区。
        this._init();

        // 在底部左右两端添加电气端口，用于与其他电路器件相连。
        this.addPort(45 * this.scale, 135 * this.scale, 'n', 'wire');
        this.addPort(100 * this.scale, 135 * this.scale, 'p', 'wire', 'p');
    }

    _init() {
        // 把组件的视觉结构分成四个部分：底盘、铭牌、显示屏、控制区。
        this._drawChassis();
        this._drawNameplate();
        this._drawLCD();
        this._drawControls();
    }

    _drawChassis() {
        // 绘制外壳主体，为设备提供矩形仪表底盘和边框。
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
        // 添加设备名称和编号说明，让组件看起来更像实际测试仪器。
        const title = new Konva.Text({
            x: 10 * this.scale, y: 5 * this.scale,
            text: 'DC 电压源',
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
        // 创建显示屏背景和文本节点，后续动态更新当前电压值。
        const lcdHeight = 30 * this.scale;
        const lcdBg = new Konva.Rect({
            x: 10 * this.scale, y: 18 * this.scale,
            width: this.width - 20 * this.scale,
            height: lcdHeight,
            fill: '#000',
            cornerRadius: 3 * this.scale
        });

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
        // 控制区域集中放置电源按键和调压旋钮。
        const ctrlY = 78 * this.scale;

        this._drawPowerButton(ctrlY);
        this._drawKnob(ctrlY);
    }

    _drawPowerButton(ctrlY) {
        // 构建电源开关按键，用于切换电压源的启停状态。
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
            // 点击后切换电源开关状态，并立即刷新显示和系统状态。
            this.isOn = !this.isOn;
            this.update();
        });
        this.powerBtnGroup.on('dblclick', (e) => {
            // 为避免双击时触发外部冒泡事件，手动阻止事件继续上传。
            e.cancelBubble = true;
        });
        this._interactGroup.add(this.powerBtnGroup);
    }

    _drawKnob(ctrlY) {
        // 创建旋钮，用于模拟调节输出电压大小的真实控制手柄。
        const knobX = this.width - 50 * this.scale;
        const knobY = ctrlY + 10 * this.scale;
        this.knobGroup = new Konva.Group({ x: knobX, y: knobY });

        const scaleValues = [0, 40, 80, 120, 160, 200];
        scaleValues.forEach(v => {
            // 依据设置范围绘制刻度值，并围绕旋钮中心形成环状刻度布局。
            const angle = (v / 200) * 300 - 150;
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
            // 通过拖拽旋钮实时修改电压值，同时更新指针角度与显示文本。
            e.cancelBubble = true;
            const startY = e.evt.clientY || e.evt.touches[0].clientY;
            const startV = this.voltageValue;
            const onMove = (me) => {
                const cy = me.clientY || (me.touches ? me.touches[0].clientY : me.clientY);
                this.voltageValue = Math.max(0, Math.min(200, startV + (startY - cy) * 0.5));
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
            // 双击时不进行额外操作，避免干扰旋钮控制。
            e.cancelBubble = true;
        });

        this._interactGroup.add(this.knobGroup);
    }

    _getVoltage() {
        // 在电源未开启或设备故障时返回 0，确保输出稳定且安全。
        if (!this.isOn || this.isBreak) return 0;
        return this.voltageValue;
    }

    _updateBtnStyle() {
        // 根据开关状态更新按键视觉状态，模拟按下和抬起的真实反馈。
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
        // 对外暴露输出电压值，供电路仿真引擎读取并参与计算。
        return this._getVoltage();
    }

    update() {
        // 组件状态刷新入口，负责同步旋钮角度、按键样式和LCD显示。
        this._updateBtnStyle();
        const angle = (this.voltageValue / 200) * 300 - 150;
        this.knobPointer.rotation(angle);
        if (this.sys.onComponentStateChange)
            this.sys.onComponentStateChange(this);

        // 当电源关闭时显示 OFF，打开后则显示当前电压值，单位可切换到 mV/V。
        if (!this.isOn) {
            this.currentText.text('OFF');
            this.currentText.fill('#333');
        } else {
            const val = this.voltageValue;
            let display;
            if (val < 1) {
                display = (val * 1000).toFixed(1) + ' mV';
            } else {
                display = val.toFixed(3) + ' V';
            }
            this.currentText.text(display);
            this.currentText.fill('#00ff00');
        }
        this._refreshCache();
    }

    destroy() {
        // 调用父类销毁逻辑，保证组件整体生命周期管理一致。
        super.destroy?.();
    }
}
