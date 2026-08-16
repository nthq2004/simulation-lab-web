import { BaseComponent } from './BaseComponent.js';

/**
 * DiffTransmitter - 差压变送器组件（4-20mA 二线制）
 *
 * 说明：
 * - 本组件模拟常见的差压变送器外观与显示逻辑，采用二线制供电/信号（4-20mA）。
 * - 输入：两端过程连接 H / L（高/低压室）；信号/供电端为 p(+)、n(-)。
 * - 输出显示：LCD 显示根据输入电流映射到差压量程的数值或故障码（LLLL/HHHH）。
 * - 量程映射公式（内部实现）：
 *     press = ((I_mA - 4 - zeroAdj) / (16 * spanAdj)) * (max - min) + min
 *   其中 I_mA 为输入电流（mA），zeroAdj/spanAdj 为旋钮修正项。
 * - 故障判定：输入电流 < 3.8mA 显示 LLLL；>20.5mA 显示 HHHH。
 *
 * 注意：本文件为视图 + 少量映射逻辑，不包含复杂物理求解器，仅用于教学与演示。
 */

export class DiffTransmitter extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        // 外观尺寸：差压变送器通常更宽以容纳左右双室
        this.width = Math.max(180, Math.min(config.width || 180, 240));
        this.height = Math.max(200, Math.min(config.height || 200, 260));

        // 类型与缓存策略
        this.type = 'transmitter_2wire';
        this.special = 'diff'; // 差压设备标识
        this.cache = 'fixed';

        // 初始化图层组（来自 BaseComponent）
        this._initGroups();

        // 校零与量程微调：通过面板上的两个旋钮调整
        // zeroAdj: 零点偏移（以 mA 等效偏移表示在映射中），spanAdj: 量程放大因子
        this.zeroAdj = 0;
        this.spanAdj = 1.0;

        // 当前测量值与标定范围
        this.press = 0;
        this.min = 0;   // 量程下限（物理单位）
        this.max = 1;   // 量程上限（物理单位）
        this.unit = 'MPa';

        this.config = { id: this.id, min: this.min, max: this.max, press: this.press, unit: this.unit };

        // 故障标志：开路/断线等
        this.isBreak = false;

        this.knobs = [];
        // 构建视图元素（静态/动态/交互组）
        this._init();

        // --- 端口布局 ---
        // 两侧为过程端口（H/L），靠近对应的法兰位置；右上为二线制供电/信号端
        this.addPort(this.width / 2 - 50, 183, 'l', 'pipe'); // 低压侧 (L)
        this.addPort(this.width / 2 + 50, 183, 'h', 'pipe'); // 高压侧 (H)

        // 二线制供电/信号 p(+)、n(-)
        this.addPort(this.width - 22, 15, 'p', 'wire', 'p');
        this.addPort(this.width - 22, 50, 'n', 'wire');

        // 双击 LCD 可清除开路故障（用于教学快速恢复）
        this.lcdBg.on('dblclick', (e) => {
            e.cancelBubble = true;
            if (this.isBreak) this.isBreak = false;
        });
    }

    _init() {
        // 依次绘制外壳、显示与控制旋钮（静态图形）
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

        this._staticGroup.add(tBar, greenCover, flangeH, flangeL, centralChamber, diaphragmLine, labelH, labelL, labelText);
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

        this._staticGroup.add(this.lcdBg, this.lcdText, this.unitText);
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
                    // this._refreshCache();
                };
                const onUp = () => {
                    window.removeEventListener('mousemove', onMove);
                    window.removeEventListener('mouseup', onUp);
                };
                window.addEventListener('mousemove', onMove);
                window.addEventListener('mouseup', onUp);
            });
            this._staticGroup.add(knobGroup);
        });
    }

    /**
     * 更新显示逻辑
     * @param state { powered: boolean, transCurrent: number }
     *
     * 行为说明：
     * - 输入为二线制电流 `transCurrent`（单位 mA），组件根据 4-20mA 标准映射到物理量程。
     * - 通过 `zeroAdj` 与 `spanAdj` 两个面板旋钮对映射进行微调。
     * - 当输入电流超出安全阈值时，显示故障码：低于 3.8mA -> `LLLL`，高于 20.5mA -> `HHHH`。
     * - 若 `this.isBreak` 或 `state.powered` 为 false，则 LCD 进入黑屏状态（模拟开路/断电）。
     */
    update(state) {
        // 输入检查：开路或断电时显示黑屏
        if (this.isBreak || !state || !state.powered) {
            try {
                this.lcdText.text('');
                this.unitText.text('');
                this.lcdBg.fill('#000'); // 黑屏
                this.unitText.opacity(0);
            } catch (e) { }

            this._refreshCache();
            return;
        }

        // 1) 获取输入电流（mA）
        const inCurrent = (typeof state.transCurrent === 'number') ? state.transCurrent : 0;

        // 2) 使用映射公式将电流转换为差压值（物理单位，由 this.min/this.max 定义）
        //    press = ((I_mA - 4 - zeroAdj) / (16 * spanAdj)) * (max - min) + min
        const press = ((inCurrent - 4 - this.zeroAdj) / (16 * this.spanAdj)) * (this.max - this.min) + this.min;

        // 展示单位：内部使用 MPa，若选择 Bar 则乘以 10（教学近似）
        const pressDisp = this.unit === 'MPa' ? press : press * 10;
        const pricision = this.unit === 'MPa' ? 3 : 2;

        // 3) 故障判定与显示文本准备
        let displayText = '';
        let isFault = false;

        if (inCurrent < 3.8) {
            // 明显低于 4mA，认为回路开路或断电：显示低限故障
            displayText = 'LLLL';
            isFault = true;
        } else if (inCurrent > 20.5) {
            // 超过上限，显示高限故障
            displayText = 'HHHH';
            isFault = true;
        } else {
            // 正常范围内：根据映射显示数值
            displayText = pressDisp.toFixed(pricision);
            isFault = false;
        }

        // 4) 根据故障/正常状态更新 LCD 外观
        if (isFault) {
            this.lcdText.fill('#ff4757'); // 故障显示红色
            this.lcdText.text(displayText);
            this.unitText.opacity(0);      // 故障时隐藏单位
            this.lcdBg.fill('#2f3542');    // 背景变暗
        } else {
            this.lcdText.fill('#1a1a1a');  // 正常显示深色字体
            this.lcdText.text(displayText);
            this.unitText.opacity(1);
            this.unitText.text(this.unit);
            this.lcdBg.fill('#2ed573');    // 正常显示绿色背景
        }

        this._refreshCache();
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


    destroy() {
        super.destroy?.();
    }
}
