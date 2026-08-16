import { BaseComponent } from './BaseComponent.js';

export class DiffTransmitter extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        // 差压变送器通常比普通压力变送器更宽，以容纳双室结构和中间连接件
        this.width = Math.max(180, Math.min(config.width || 180, 240));
        this.height = Math.max(200, Math.min(config.height || 200, 260));

        this.type = 'transmitter_2wire';
        this.special = 'diff'; // 类型标记为差压
        this.zeroAdj = 0;
        this.spanAdj = 1.0;
        this.press = 0;
        this.min = 0;   // 差压下限
        this.max = 1;   // 差压上限
        this.unit = 'MPa';

        this.config ={id:this.id,min:this.min,max:this.max,press:this.press,unit:this.unit};

        this.isOpened = false; 

        this.knobs = [];
        this._init();

        // --- 接口布局修改 ---
        // 底部双接口：H端(高压室) 和 L端(低压室)
        // 位置分别靠近左侧和右侧压力室的中心
        this.addPort(this.width / 2 - 50, 183, 'l', 'pipe'); // 高压侧
        this.addPort(this.width / 2 + 50, 183, 'h', 'pipe'); // 低压侧
        
        // 电力/信号接口 (2线制)
        this.addPort(this.width - 22, 15, 'p', 'wire', 'p');
        this.addPort(this.width - 22, 50, 'n', 'wire', );

        this.group.on('dblclick', (e) => {
            e.cancelBubble = true;
            if (this.isOpened) this.isOpened = false;
            if (this.sys && typeof this.sys.updateLinePositions === 'function') this.sys.updateLinePositions();
            if (this.sys && typeof this.sys.requestRedraw === 'function') this.sys.requestRedraw();
        });
    }

    _init() {
        this._drawEnclosure();
        this._drawLCD();
        this._drawKnobs();
    }

    _drawEnclosure() {
        const centerX = this.width / 2;

        // 1. 顶部接线盒 (Junction Box)
        const labelText = new Konva.Text({ 
            x: 0, y: 12, width: this.width, 
            text: '差压变送器', fontSize: 13, align: 'center', fill: '#2c3e50', fontStyle: 'bold' 
        });

        const tBar = new Konva.Rect({
            x: 25, y: 10,
            width: this.width - 50, height: 45,
            fill: '#f1f2f6', stroke: '#a4b0be', strokeWidth: 1, cornerRadius: 5
        });

        // 2. 主表头 (深绿色圆形)
        const greenCover = new Konva.Circle({
            x: centerX, y: 90, radius: 55,
            fill: '#27ae60', stroke: '#1e8449', strokeWidth: 4,
            shadowBlur: 5, shadowColor: 'black', shadowOpacity: 0.2
        });

        // 3. 底部差压测量室 (法兰体与连接件)
        // 模拟图片中下方的双室夹紧结构
        
        // 3.1 左侧 H 压力室 (法兰)
        const flangeH = new Konva.Rect({
            x: centerX - 80, y: 145,
            width: 65, height: 45,
            fill: '#bdc3c7', stroke: '#7f8c8d', cornerRadius: 2
        });

        // 3.2 右侧 L 压力室 (法兰)
        const flangeL = new Konva.Rect({
            x: centerX + 15, y: 145,
            width: 65, height: 45,
            fill: '#bdc3c7', stroke: '#7f8c8d', cornerRadius: 2
        });

        // 3.3 中央敏感元件连接件 (夹在两个法兰中间)
        const centralChamber = new Konva.Rect({
            x: centerX - 15, y: 140,
            width: 30, height: 55,
            fill: '#2f3542', // 深色，模拟核心部件
            stroke: '#1e272e', strokeWidth: 1, cornerRadius: 2
        });

        // 3.4 核心隔断：正负压室之间的竖线
        // 在中央连接件正中间绘制一条红色的垂直线，象征核心膜片
        const diaphragmLine = new Konva.Line({
            points: [centerX, 142, centerX, 193],
            stroke: '#c0392b', // 红色，突出显示
            strokeWidth: 3,
            lineCap: 'round'
        });

        // H/L 物理标识 (标注在各自法兰上)
        const labelH = new Konva.Text({ x: centerX - 60, y: 155, text: 'L', fontSize: 18, fill: '#c0392b', fontStyle: 'bold' });
        const labelL = new Konva.Text({ x: centerX + 40, y: 155, text: 'H', fontSize: 18, fill: '#2980b9', fontStyle: 'bold' });

        this.group.add(tBar, greenCover, flangeH, flangeL, centralChamber, diaphragmLine, labelH, labelL, labelText);
        this.lcdCenterY = 90;
    }

    _drawLCD() {
        const centerX = this.width / 2;
        this.lcdBg = new Konva.Circle({
            x: centerX, y: this.lcdCenterY, radius: 40, fill: '#000'
        });

        this.lcdText = new Konva.Text({
            x: centerX - 35, y: this.lcdCenterY - 10, width: 70,
            text: '0.000', fontSize: 20, fontFamily: 'Digital-7, monospace',
            fill: '#00ff00', align: 'center'
        });

        this.unitText = new Konva.Text({
            x: centerX - 20, y: this.lcdCenterY + 15,
            text: this.unit, fontSize: 10, fill: '#00ff00', opacity: 0.8
        });

        this.group.add(this.lcdBg, this.lcdText, this.unitText);
    }

    _drawKnobs() {
        // 保持零点和量程调节旋钮
        const knobConfigs = [
            { id: 'zero', x: 50, label: 'Z' },
            { id: 'span', x: this.width - 50, label: 'S' }
        ];

        knobConfigs.forEach(k => {
            const knobGroup = new Konva.Group({ x: k.x, y: 32 });
            const base = new Konva.Circle({ radius: 10, fill: '#dfe4ea', stroke: '#747d8c' });
            const rotor = new Konva.Group();
            rotor.add(new Konva.Circle({ radius: 7, fill: '#f1f2f6', stroke: '#2f3542' }));
            rotor.add(new Konva.Line({ points: [0, -5, 0, 5], stroke: '#c0392b', strokeWidth: 2 }));

            knobGroup.add(base, rotor);
            this.knobs[k.id] = rotor;

            // 交互逻辑：旋转改变 zeroAdj 和 spanAdj
            rotor.on('mousedown touchstart', (e) => {
                e.cancelBubble = true;
                const startY = e.evt.clientY || e.evt.touches[0].clientY;
                const startRot = rotor.rotation();
                const onMove = (me) => {
                    const cy = me.clientY || (me.touches ? me.touches[0].clientY : me.clientY);
                    const delta = (startY - cy) * 2;
                    rotor.rotation(startRot + delta);
                    if (k.id === 'zero') this.zeroAdj = (rotor.rotation() / 360) * 0.8;
                    else this.spanAdj = 1.0 + (rotor.rotation() / 360) * 0.2;
                };
                const onUp = () => {
                    window.removeEventListener('mousemove', onMove);
                    window.removeEventListener('mouseup', onUp);
                };
                window.addEventListener('mousemove', onMove);
                window.addEventListener('mouseup', onUp);
            });
            this.group.add(knobGroup);
        });
    }

    /**
     * @param state { powered: bool, transCurrent：电流 }
     */
    update(state) {
        // state: { powered: bool, transCurrent: number }
        // --- 核心修改：开路故障检查 ---
        // 如果开路被设置，或者 state 明确表示断电
        if (this.isOpened || !state || !state.powered) {
            try {
                this.lcdText.text('');
                this.unitText.text('');
                this.lcdBg.fill('#000'); // 黑屏
                this.unitText.opacity(0);
            } catch (e) { }

            if (this.sys && typeof this.sys.requestRedraw === 'function') this.sys.requestRedraw();
            return;
        }

        // 1. 获取输入电流值
        const inCurrent = (typeof state.transCurrent === 'number') ? state.transCurrent : 0;
        // const iFix = inCurrent * this.spanAdj+this.zeroAdj;产生电流的时候修正，这里不处理。

        // 2. 根据电流推算原始温度 (4-20mA -> 0-rangeMax)

        const press =((inCurrent - 4 - this.zeroAdj) / (16 * this.spanAdj)) * (this.max - this.min) + this.min;
        const pressDisp =this.unit==='MPa'?press:press*10;
        const pricision =this.unit==='MPa'?3:2;


        // 4. 处理显示逻辑与输出电流
        let displayText = "";
        let isFault = false;

        if (inCurrent < 3.8) {
            // 小于 4mA 显示 LLLL
            displayText = "LLLL";
            isFault = true;
        } else if (inCurrent > 20.5) {
            // 大于 20mA 显示 HHHH
            displayText = "HHHH";
            isFault = true;
        } else {
            // 正常量程内：显示数值
            displayText = pressDisp.toFixed(pricision);
            // 变送器输出跟随输入电流（或根据修正后的温度重新映射）
            isFault = false;
        }

        // 5. 更新 UI 表现
        if (isFault) {
            this.lcdText.fill('#ff4757'); // 故障显示红色
            this.lcdText.text(displayText);
            this.unitText.opacity(0);      // 故障时不显示单位
            this.lcdBg.fill('#2f3542');    // 背景变暗
        } else {
            this.lcdText.fill('#1a1a1a');  // 正常显示黑色
            this.lcdText.text(displayText);
            this.unitText.opacity(1);
            this.unitText.text(this.unit);
            this.lcdBg.fill('#2ed573');    // 正常显示翠绿色
        }

        if (this.sys && typeof this.sys.requestRedraw === 'function') this.sys.requestRedraw();
    }

    getConfigFields() {
        return [
            { label: '位号', key: 'id', type: 'text' },
            { label: '下限值', key: 'min', type: 'number' },
            { label: '上限值', key: 'max', type: 'number' },
            { label: '压力值', key: 'press', type: 'number' },
            {
                label: '单位', key: 'unit', type: 'select',
                options: [
                    { label: 'MPa', value: 'MPa' },
                    { label: 'Bar', value: 'Bar' }
                ]
            }
        ];
    }
}