/**
 * NtctempTransmitter.js
 * 温度变送器（NTC 传感器 + 4-20mA 两线制变送器）组件（注释版）
 *
 * 说明：
 * - 该组件模拟一个带 NTC 传感器输入的温度变送器，接受 4-20mA 回路电流并在 LCD 上显示
 *   对应的温度值（范围由 `min`/`max` 指定）。
 * - 采用“分压+NTC B 参数”方法计算温度（若需要更精确可改用 Steinhart–Hart 公式）。
 * - 变送器将 4-20mA 映射为设定的温度区间：4mA -> min，20mA -> max；支持零点/量程微调旋钮。
 * - 当输入电流低于 ~3.8mA 或高于 ~20.5mA 时视为故障并在屏幕显示 LLLL/HHHH。
 *
 * 关键公式（实现说明）：
 * - NTC 电阻随温度变化：R(T) = Rref * exp(B*(1/T - 1/Tref))，T 以开尔文计。
 * - 电流 -> 温度 映射（在本实现中直接按电流线性映射到 min-max）：
 *     temp = ((I_mA - 4 - zeroAdj) / (16 * spanAdj)) * (max - min) + min
 *   其中 zeroAdj/spanAdj 为旋钮微调引入的修正项。
 */
import { BaseComponent } from './BaseComponent.js';

export class NTCtempTransmitter extends BaseComponent {
    /**
     * 构造函数
     * @param {object} config - 配置对象（可含 width/height/min/max 等）
     * @param {object} sys - 系统上下文（用于读取全局温度等）
     */
    constructor(config, sys) {
        super(config, sys);
        // 动态尺寸设置：最小宽140, 最小高180
        this.width = Math.max(140, Math.min(config.width || 140, 200));
        this.height = Math.max(180, Math.min(config.height || 180, 240));

        this.type = 'transmitter_2wire';
        this.special = 'ntc';
        this.cache = 'fixed';
        this._initGroups();

        // 校准旋钮引起的修正参数（通过 UI 旋钮实时调整）
        this.zeroAdj = 0;    // 零点微调（mA 基准偏移）
        this.spanAdj = 1.0;  // 量程微调（倍率）

        this.voltage = 0; // 当前映射的温度值（显示用）
        this.min = config.min ?? -20; // 温度显示下限
        this.max = config.max ?? 120; // 温度显示上限

        // NTC 参数（用于分压/反推温度，当前实现主要展示结构）
        this.Vcc = 3.3;        // 激励电压 (V)
        this.Rseries = 10000;  // 分压电阻 (Ω)
        this.Rref = 10000;     // NTC 标称电阻 (Ω) @25°C
        this.B = 3950;         // B 参数 (K)

        this.config = { id: this.id, min: this.min, max: this.max, voltage: this.voltage };
        this.isBreak = false; // 电路是否开路（模拟故障）

        this.knobs = [];
        this._init();

        // 端子说明：
        // - 左侧为 NTC 传感器输入（l/r），用于视觉上展示传感器接线
        // - 右侧为 4-20mA 回路输出（p/n），用于与回路连接
        this.addPort(40, 168, 'l', 'wire', 'p');
        this.addPort(100, 168, 'r', 'wire');
        this.addPort(this.width, 18, 'p', 'wire', 'p');
        this.addPort(this.width, 48, 'n', 'wire');

        // 双击 LCD 背景可清除“开路故障”标志（便于演示）
        this.lcdBg.on('dblclick', (e) => {
            e.cancelBubble = true;
            if (this.isBreak) this.isBreak = false;
        });
    }

    _init() {
        // 绘制外壳、LCD 与旋钮（UI 初始化）
        this._drawEnclosure();
        this._drawLCD();
        this._drawKnobs();
    }

    // 绘制器件外壳与装饰
    _drawEnclosure() {
        const centerX = this.width / 2;
        const labelText = new Konva.Text({ x: 22, y: -6, width: this.width, text: '温度变送器(NTC)', fontSize: 12, align: 'left', fill: '#2c3e50', fontStyle: 'bold' });
        const tBar = new Konva.Rect({ x: 20, y: 10, width: this.width - 40, height: 45, fill: '#f1f2f6', stroke: '#a4b0be', strokeWidth: 1, cornerRadius: 5 });
        const leftCap = new Konva.Rect({ x: 0, y: 15, width: 20, height: 35, fill: '#ced6e0', stroke: '#747d8c', cornerRadius: 2 });
        const rightCap = new Konva.Rect({ x: this.width - 20, y: 15, width: 20, height: 35, fill: '#ced6e0', stroke: '#747d8c', cornerRadius: 2 });

        const outerRadius = 55;
        const outerCover = new Konva.Circle({ x: centerX, y: 85, radius: outerRadius, fill: '#2f3542', stroke: '#1e272e', strokeWidth: 1 });
        const greenCover = new Konva.Circle({ x: centerX, y: 85, radius: 52, fill: '#27ae60', stroke: '#1e8449', strokeWidth: 4 });

        const stem = new Konva.Rect({ x: centerX - 10, y: 140, width: 20, height: 10, fill: '#ced6e0', stroke: '#747d8c' });
        const bolt = new Konva.Rect({ x: centerX - 45, y: 150, width: 90, height: 20, fill: '#747d8c', cornerRadius: 2 });

        this._staticGroup.add(tBar, leftCap, rightCap, outerCover, greenCover, stem, bolt, labelText);
        this.lcdCenterY = 85;
    }

    // 绘制 LCD 显示区域（动态更新）
    _drawLCD() {
        const centerX = this.width / 2;
        const lcdRadius = 38;
        this.lcdBg = new Konva.Circle({ x: centerX, y: this.lcdCenterY, radius: lcdRadius, fill: '#000' });
        this.lcdText = new Konva.Text({ x: centerX - 30, y: this.lcdCenterY - 10, width: 60, text: '', fontSize: 18, fontFamily: 'Digital-7, monospace', fill: '#00ff00', align: 'center', fontStyle: 'bold' });
        const unit = new Konva.Text({ x: centerX - 8, y: this.lcdCenterY + 12, text: '°C', fontSize: 14, fill: '#1a1a1a', opacity: 0 });
        this.unitText = unit;
        this._interactGroup.add(this.lcdBg, this.lcdText, unit);
    }

    // 绘制并绑定零点/量程旋钮（用于演示微调 zero/span）
    _drawKnobs() {
        const knobConfigs = [ { id: 'zero', x: 50, label: 'Z' }, { id: 'span', x: this.width - 50, label: 'S' } ];
        knobConfigs.forEach(k => {
            const knobGroup = new Konva.Group({ x: k.x, y: 32 });
            const base = new Konva.Circle({ radius: 11, fill: '#dfe4ea', stroke: '#747d8c' });
            const rotor = new Konva.Group();
            rotor.add(new Konva.Circle({ radius: 8, fill: '#f1f2f6', stroke: '#2f3542' }));
            rotor.add(new Konva.Line({ points: [0, -7, 0, 7], stroke: '#2f3542', strokeWidth: 3 }));
            knobGroup.add(base, rotor);
            this.knobs[k.id] = rotor; // 存储旋钮对象以便外部或配置读取

            // 旋钮拖动绑定：通过改变旋转角度驱动 zeroAdj/spanAdj 的实时更新
            rotor.on('mousedown touchstart', (e) => {
                e.cancelBubble = true;
                const startY = e.evt.clientY || e.evt.touches[0].clientY;
                const startRot = rotor.rotation();
                const onMove = (me) => {
                    const cy = me.clientY || (me.touches ? me.touches[0].clientY : me.clientY);
                    const delta = (startY - cy) * 2;
                    rotor.rotation(startRot + delta);
                    if (k.id === 'zero') this.zeroAdj = (rotor.rotation() / 360) * 0.8;
                    else this.spanAdj = 1.0 + (rotor.rotation() / 360) * 0.5;
                };
                const onUp = () => {
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
            this._staticGroup.add(knobGroup);
        });
    }

    /**
     * 更新显示（由系统传入当前回路状态）
     * @param {object} state - { powered: boolean, transCurrent: number }
     * - 当未供电或处于开路故障时，清空显示并返回。
     * - 正常时将 4-20mA 线性映射到 [min, max] 温度区间；并依据阈值判断 LLLL/HHHH 故障。
     */
    update(state) {
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

        // 1. 获取输入回路电流（单位：mA）
        const inCurrent = (typeof state.transCurrent === 'number') ? state.transCurrent : 0;

        // 2. 将 4-20mA -> min/max 的线性映射（包含旋钮引入的零点/量程修正）
        //    注意：公式中 16 = 20-4（mA 范围）
        const voltageDisp = ((inCurrent - 4 - this.zeroAdj) / (16 * this.spanAdj)) * (this.max - this.min) + this.min;
        this.voltage = voltageDisp;
        let isFault = false;
        let displayText = '';

        // 3. 故障判定：低于 ~3.8mA 或高于 ~20.5mA 视为回路异常
        if (inCurrent < 3.8) {
            displayText = "LLLL"; // 低量程报警
            isFault = true;
        } else if (inCurrent > 20.5) {
            displayText = "HHHH"; // 高量程报警
            isFault = true;
        } else {
            displayText = voltageDisp.toFixed(1);
            isFault = false;
        }

        // 4. 更新 UI：故障时显示红色报警，正常时显示温度与单位
        if (isFault) {
            this.lcdText.fill('#ff4757');
            this.lcdText.text(displayText);
            this.unitText.opacity(0);
            this.lcdBg.fill('#2f3542');
        } else {
            this.lcdText.fill('#1a1a1a');
            this.lcdText.text(displayText);
            this.unitText.opacity(1);
            this.unitText.text('°C');
            this.lcdBg.fill('#2ed573');
        }

        this._refreshCache();
    }

    // 配置面板字段
    getConfigFields() {
        return [
            { label: '位号', key: 'id', type: 'text' },
            { label: '下限值', key: 'min', type: 'number' },
            { label: '上限值', key: 'max', type: 'number' },
            { label: '温度值', key: 'voltage', type: 'number' },
        ];
    }

    // 用户通过配置界面提交后的回调：应用新配置并刷新显示
    onConfigUpdate(newConfig) {
        this.id = newConfig.id;
        this.min = parseFloat(newConfig.min);
        this.max = parseFloat(newConfig.max);
        this.config = newConfig;
    }

    tick(dt) {
        const s = this.sys?.voltageSolver;
        if (!s) return;
        this.update({
            powered: (this._lastVDiff || 0) > 10,
            transCurrent: (this.physCurrent || 0) * 1000
        });
    }

    destroy() {
        super.destroy?.();
    }
}
