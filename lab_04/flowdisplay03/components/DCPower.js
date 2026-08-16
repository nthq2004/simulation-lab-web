import { BaseComponent } from './BaseComponent.js';

/**
 * 直流电源组件（DCPower）
 *
 * 概述：一个简单的面板式直流电源仿真组件，提供开关、可调电压旋钮与面板显示。
 * 该组件输出直流电压（getValue），并提供一个小的输出内阻 `rOn` 以参与电路仿真。
 *
 * 主要行为：
 *  - `isOn` 控制电源通断；`isBreak` 用于模拟开路/断开状态
 *  - `voltage` 为面板设置的目标电压（0..maxVoltage）
 *  - `rOn` 根据开关/开路状态调整（开时为小内阻，关或开路时为很大值）
 *
 * 视觉结构：
 *  - `_staticGroup`：机箱、铭牌、LCD 等静态元素
 *  - `_interactGroup`：电源键与旋钮（交互元素）
 */
export class DCPower extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        // 初始化三层次绘图分组
        this._initGroups();

        // 视觉缩放与尺寸（可按需通过 config 修改）
        this.scale = 1.2;
        this.width = 145 * this.scale;
        this.height = 135 * this.scale;

        this.type = 'source';
        this.cache = 'fixed'; // 静态层缓存标记

        // 运行状态
        this.isOn = false;          // 电源开关状态
        this.isBreak = false;       // 模拟线路开路（断开）
        this.voltage = (config && config.voltage) ? config.voltage : 24; // 面板电压设定（V）
        this.maxVoltage = 24;      // 额定最大电压
        this.rOn = 0.1;            // 输出内阻（Ω）用于仿真

        // 构建视觉元素与交互
        this._init();

        // 添加电气端口（负端 n，正端 p），位置基于组件尺寸与缩放
        this.addPort(45 * this.scale, 135 * this.scale, 'n', 'wire');
        this.addPort(100 * this.scale, 135 * this.scale, 'p', 'wire', 'p');
    }

    _init() {
        // 初始化并绘制各个静态/交互部分
        this._drawChassis();      // 机箱外壳
        this._drawNameplate();    // 铭牌（型号/学校信息）
        this._drawLCD();          // LCD 显示区域
        this._drawControls();     // 控制区（电源键与电压旋钮）
    }

        // 1. 矩形外框
    _drawChassis() {
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
    // 2. 铭牌
    _drawNameplate() {
        const title = new Konva.Text({
            x: 10 * this.scale, y: 5 * this.scale,
            text: `DC 24V`,
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
    // 3. 液晶显示屏
    _drawLCD() {
        // 液晶屏高度固定，宽度随设备调整
        const lcdHeight = 30 * this.scale;
        const lcdBg = new Konva.Rect({
            x: 10 * this.scale, y: 18 * this.scale,
            width: this.width - 20 * this.scale,
            height: lcdHeight,
            fill: '#000',
            cornerRadius: 3 * this.scale
        });

        this.voltageText = new Konva.Text({
            x: 10 * this.scale, y: 22 * this.scale,
            width: this.width - 20 * this.scale,
            text: '',
            fontSize: 22 * this.scale,
            fontFamily: 'monospace',
            fill: '#00ff00',
            align: 'center'
        });

        this._staticGroup.add(lcdBg, this.voltageText);
    }

    // 4. 控制面板（开关、旋钮、指示灯）
    _drawControls() {
        const ctrlY = 78 * this.scale; // 控制区起始高度

        // --- 凹陷式电源键 ---
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
        //每次点击切换状态，都要报告给上层，以便更新显示和逻辑。上层通过传入的 update 方法处理。所有产生输出信号的设备都应如此设计。
        this.powerBtnGroup.on('mousedown touchstart', () => {
            this.isOn = !this.isOn;
            this.update();
        });
        this.powerBtnGroup.on('dblclick', (e) => {
            e.cancelBubble = true;
        });
        // --- 带刻度的旋钮 ---
        const knobX = this.width - 50 * this.scale;
        const knobY = ctrlY + 10 * this.scale;
        this.knobGroup = new Konva.Group({ x: knobX, y: knobY });

        // 绘制刻度线和数字
        const scaleValues = [0, 4, 8, 12, 16, 20, 24];
        scaleValues.forEach(v => {
            // 映射 0-24V 到旋钮的角度（-150° 到 150°）
            const angle = (v / 24) * 300 - 150;
            const rad = (angle - 90) * Math.PI / 180;
            const r = 32 * this.scale; // 刻度半径

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
            rotation:135
        });

        this.knobGroup.add(knobCircle, this.knobPointer);

        // 旋钮逻辑
        knobCircle.on('mousedown touchstart', (e) => {
            e.cancelBubble = true;
            const startY = e.evt.clientY || e.evt.touches[0].clientY;
            const startV = this.voltage;
            const onMove = (me) => {
                const cy = me.clientY || (me.touches ? me.touches[0].clientY : me.clientY);
                this.voltage = Math.max(0, Math.min(24, startV + (startY - cy) * 0.1));
                this.update();
            };
            const onUp = () => {
                this.update();
                // 报告状态变化
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
            e.cancelBubble = true;
            });

        this._interactGroup.add(this.powerBtnGroup, this.knobGroup);
    }
    // 更新电源键样式
    _updateBtnStyle() {
        if (this.isOn) {
            // 压下效果：阴影消失，位置微移
            this.powerBtnBase.setAttrs({
                shadowBlur: 0,
                shadowOffset: { x: 0, y: 0 },
                x: 1 * this.scale, y: 1 * this.scale,
                fill: '#bdc3c7'
            });
        } else {
            // 凸起效果
            this.powerBtnBase.setAttrs({
                shadowBlur: 5 * this.scale,
                shadowOffset: { x: 2 * this.scale, y: 2 * this.scale },
                x: 0, y: 0,
                fill: '#bdc3c7'
            });
        }
    }

    getValue(){
        return this.isOn&&!this.isBreak?this.voltage:0;
    }
    // 更新显示逻辑
    update() {
        // 关键：关机/开路时将内阻置为极大值，防止电容通过电源内阻反向放电加热NTC
        this.rOn = (this.isOn && !this.isBreak) ? 0.1 : 1e9;

        this._updateBtnStyle();
        const angle = (this.voltage / 24) * 300 - 150;
        this.knobPointer.rotation(angle);
        if (this.sys.onComponentStateChange)
            this.sys.onComponentStateChange(this);
        if (!this.isOn) {
            this.voltageText.text('OFF');
            this.voltageText.fill('#333');
        } else {
            this.voltageText.text(this.voltage.toFixed(1) + ' V');
            this.voltageText.fill('#00ff00');
        }
                // 如果该组件开启了离屏缓存，需要刷新缓存以反映新的文字
        this._refreshCache();
    }



    destroy() {
        super.destroy?.();
    }
}
