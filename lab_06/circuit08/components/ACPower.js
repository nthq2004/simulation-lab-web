import { BaseComponent } from './BaseComponent.js';

/**
 * 交流电源（仿真组件）
 *
 * 概述：一个简单的可调交流信号源，带面板显示与两个旋钮（电压、频率）及电源开关。
 * 视觉上采用方形机箱，顶部为 LCD 显示电压与频率，底部为控制区。
 *
 * 结构说明：
 *  - 机箱（chassis）：矩形面板，包含显示与控制部位（静态）
 *  - LCD 显示区：两行文本，分别显示电压（绿色）和频率（红色）
 *  - 控制区：电源按钮 + 两个旋钮（电压、频率）用于用户交互
 *  - 端口：'n'（负端）和 'p'（正端），用于与电路连线
 *
 * 端口坐标（相对于组件左上角）：
 *  - addPort(45, 145, 'n', 'wire')  // 负端
 *  - addPort(100, 145, 'p', 'wire', 'p') // 正端（优先端口）
 *
 * 可配置参数（通过构造参数可覆盖）：
 *  - voltageRMS: 显示的有效值电压（默认 24 V）
 *  - frequency: 工作频率（默认 50 Hz）
 *  - phase: 初始相位（弧度，默认 0）
 *  - isOn: 是否开启（默认 false）
 *
 * 行为说明：
 *  - 当组件开启（isOn=true）时，getValue(t) 返回瞬时电压值：V(t) = V_rms * sqrt(2) * sin(2π f t + phase)
 *  - 当组件关闭时，getValue 返回 undefined（表示无电压输出）
 */
export class ACPower extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        // 初始化三个绘图分组（BaseComponent 提供）
        this._initGroups();

        // 默认尺寸（可通过 config.width/height 覆盖）
        this.width = 145;
        this.height = 145; // 稍高一些以容纳面板与旋钮

        this.type = 'ac_source';
        this.cache = 'fixed'; // 静态内容可缓存，避免每帧重绘

        // 物理/运行状态
        this.isOn = config.isOn !== undefined ? config.isOn : false;
        this.rOn = 0.1;

        // 可调参数（默认值）
        this.vRms = config.vRms || 24;
        this.freq = config.freq || 50;
        this.phase = config.phase || 0;
        this.label = config.label || '江苏航院';   // 右上角标注（母线/发电机等）

        // 构建静态与交互 UI
        this._init();

        this.config = { vRms: this.vRms, freq: this.freq, isOn: this.isOn, label: this.label };

        // 添加外部电气端口（用于连线）
        this.addPort(45, 145, 'n', 'wire');
        this.addPort(100, 145, 'p', 'wire', 'p');
    }

    // 初始化面板与控件（只设置元素，不在此处进行动态刷新）
    _init() {
        this._drawChassis();    // 机箱面板
        this._drawNameplate();  // 名牌（型号/学校等信息）
        this._drawLCD();        // 显示电压与频率
        this._drawControls();   // 电源键与旋钮（交互层）
    }

    // 绘制机箱（静态背景）
    _drawChassis() {
        this.chassis = new Konva.Rect({
            width: this.width, height: this.height,
            fill: '#dfe6e9', stroke: '#2d3436',
            strokeWidth: 3, cornerRadius: 5
        });
        this._staticGroup.add(this.chassis);
    }

    // 名牌与厂商信息（静态）
    _drawNameplate() {
        const title = new Konva.Text({ x: 10, y: 5, text: `AC ${this.vRms}V`, fontSize: 12, fontStyle: 'bold' });
        this._nameplateText = new Konva.Text({
            x: this.width - 60, y: 5,
            text: this.label,
            fontSize: 12
        });
        this._staticGroup.add(title, this._nameplateText);
    }

    // LCD 显示区（使用两行文本分别表示电压与频率）
    _drawLCD() {
        const lcdBg = new Konva.Rect({
            x: 10, y: 18, width: this.width - 20, height: 40,
            fill: '#000', cornerRadius: 3
        });
        // 电压行（绿色，较大字体）
        this.displayV = new Konva.Text({
            x: 10, y: 22, width: this.width - 20, text: '',
            fontSize: 18, fontFamily: 'monospace', fill: '#00ff00', align: 'center'
        });
        // 频率行（红色，较小字体）
        this.displayF = new Konva.Text({
            x: 10, y: 44, width: this.width - 20, text: '',
            fontSize: 12, fontFamily: 'monospace', fill: '#ed0606', align: 'center'
        });
        this._staticGroup.add(lcdBg, this.displayV, this.displayF);
    }

    // 绘制控制区：包含电源按钮与两个旋钮（电压、频率）
    _drawControls() {
        const ctrlY = 75;

        // 1) 电源按钮（点击切换开/关）
        this.powerBtnGroup = new Konva.Group({ x: 12, y: ctrlY + 10 });
        this.powerBtnBase = new Konva.Rect({ width: 30, height: 20, fill: '#bdc3c7', cornerRadius: 4 });
        this.powerBtnGroup.add(this.powerBtnBase, new Konva.Text({ x: 4, y: 25, text: '电源', fontSize: 11 }));

        // 切换状态并更新显示
        this.powerBtnGroup.on('mousedown touchstart', () => {
            this.isOn = !this.isOn;
            this.update();
        });
        // 防止双击事件冒泡影响其他组件
        this.powerBtnGroup.on('dblclick', (e) => { e.cancelBubble = true; });

        // 2) 电压旋钮（V-RMS，可左右点击调节）
        const vKnob = this._createKnob(72, ctrlY + 20, '电压', 0, 300, (val) => {
            this.vRms = val;
        }, () => this.vRms);

        // 3) 频率旋钮（Hz）
        const fKnob = this._createKnob(116, ctrlY + 20, '频率', 0, 100, (val) => {
            this.freq = val;
        }, () => this.freq);

        // 将交互控件添加到交互分组（不会被缓存）
        this._interactGroup.add(this.powerBtnGroup, vKnob, fKnob);
    }

    // 通用旋钮构造器（以简洁交互为主：左右点击调整）
    // 参数：x,y - 位置；label - 显示文本；min,max - 范围；onChange - 值变化回调；getValue - 当前值（数值或返回数值的函数）
    _createKnob(x, y, label, min, max, onChange, getValue) {
        const group = new Konva.Group({ x, y });
        const circle = new Konva.Circle({ radius: 18, fill: '#c7dae1', stroke: '#2d3436' });
        const pointer = new Konva.Line({ points: [0, 0, 0, -16], stroke: '#d63031', strokeWidth: 2 });

        const readVal = typeof getValue === 'function' ? getValue : () => getValue;

        // 根据数值映射到指针角度（范围约 260°）
        const updatePointer = (val) => {
            const angle = ((val - min) / (max - min)) * 260 - 130;
            pointer.rotation(angle);
        };
        updatePointer(readVal());

        if (label === '电压') {
            this._vUpdatePointer = updatePointer;
        }

        // 点击旋钮左半侧减小，右半侧增大（步长为总量的 5%）
        circle.on('mousedown touchstart', (e) => {
            e.cancelBubble = true;
            const pos = circle.getRelativePointerPosition();
            const step = (max - min) * 0.05;
            let currentVal = readVal();
            if (pos.x < 0) {
                currentVal = Math.max(min, currentVal - step);
            } else {
                currentVal = Math.min(max, currentVal + step);
            }
            onChange(currentVal);    // 将新值回调到宿主
            updatePointer(currentVal);
            this.update();           // 更新显示（LCD / 状态灯）
        });
        circle.on('dblclick', (e) => { e.cancelBubble = true; });

        group.add(circle, pointer, new Konva.Text({ x: -10, y: 22, text: label, fontSize: 10 }));
        return group;
    }

    /**
     * 获取瞬时电压值（供求解器或仿真网格调用）
     * 返回值单位为伏特（V），基于设定的有效值与频率。
     * 公式：V(t) = V_rms * sqrt(2) * sin(2π f t + phase)
     * 如果组件关闭（isOn=false），函数返回 0（或不输出电压）。
     *
     * 注意：currentTime 的单位应与 frequency 的 Hz 对应（秒）。
     */
    getValue(currentTime) {
        if (!this.isOn) return 0; // 关闭时不提供电压
        const peak = this.vRms * Math.sqrt(2);
        if (this.freq === 0) return peak * Math.sin(this.phase);
        return peak * Math.sin(2 * Math.PI * this.freq * currentTime + this.phase);
    }

    // 更新面板显示与触发系统回调（状态改变时调用）
    update() {
        if (this.sys.onComponentStateChange) this.sys.onComponentStateChange(this);

        if (!this.isOn) {
            // 关闭时清除显示并将电源按钮置灰
            this.displayV.text('');
            this.displayF.text('');
            this.powerBtnBase.fill('#bdc3c7');
        } else {
            // 开启时显示电压与频率，电源按钮高亮为绿色
            this.displayV.text(this.vRms.toFixed(1) + ' V～');
            this.displayF.text(this.freq.toFixed(1) + ' Hz');
            this.powerBtnBase.fill('#078d67'); // 显示为绿色
        }
        this._vUpdatePointer?.(this.vRms);
        // 刷新静态缓存，以便界面重绘（BaseComponent 提供）
        this._refreshCache();
    }

    // ═══════════════════════════════════════════════════
    // 配置对话框
    // ═══════════════════════════════════════════════════

    getConfigFields() {
        return [
            { label: '电压有效值 V', key: 'vRms', type: 'number' },
            { label: '频率 Hz', key: 'freq', type: 'number' },
            { label: '初相位 °', key: 'phaseDeg', type: 'number' },
            { label: '右上角标注', key: 'label', type: 'text' },
            { label: '电源开关', key: 'isOn', type: 'select', options: [
                { label: '关闭', value: false },
                { label: '开启', value: true },
            ]},
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.vRms !== undefined) this.vRms = parseFloat(cfg.vRms) || 24;
        if (cfg.freq !== undefined) this.freq = parseFloat(cfg.freq) || 50;
        if (cfg.phaseDeg !== undefined) {
            const deg = parseFloat(cfg.phaseDeg) || 0;
            this.phase = deg * Math.PI / 180;
        }
        if (cfg.isOn !== undefined) this.isOn = cfg.isOn === true || cfg.isOn === 'true';
        if (cfg.label !== undefined && cfg.label !== '') this.label = String(cfg.label);
        if (this._nameplateText) this._nameplateText.text(this.label);
        this.config = { ...this.config, vRms: this.vRms, freq: this.freq, phase: this.phase, phaseDeg: this.phaseDeg ?? this.phase * 180 / Math.PI, isOn: this.isOn, label: this.label };
        this.update();
        this._refreshCache?.();
    }

    // 清理资源（继承自 BaseComponent）
    destroy() {
        super.destroy?.();
    }
}
