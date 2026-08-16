import { BaseComponent } from './BaseComponent.js';

/**
 * 三相交流电源（仿真组件）
 *
 * 概述：提供三相交流电压输出（U、V、W 三相 + 中性线 N），
 * 可通过旋钮调节相电压（0~500V），并支持开关控制。
 * 视觉上采用方形机箱设计，顶部为 LCD 显示电压与频率，下部为电源按钮与调压旋钮。
 *
 * 结构说明：
 *  - 机箱（chassis）：矩形面板，包含显示与控制部位（静态）
 *  - LCD 显示区：两行文本，分别显示相电压（绿色）和频率（黄色）
 *  - 控制区：电源按钮 + 调压旋钮（通过垂直拖动调节）
 *  - 端口：4 个接线柱（U、V、W、N），用于与三相电路连接
 *
 * 三相电压关系（平衡三相）：
 *  - U 相：参考相（ϕ = 0°）
 *  - V 相：相位滞后 120°（ϕ = -120°）
 *  - W 相：相位滞后 240°（ϕ = -240°）
 *  - N 端：中性线
 *  所有相均以相电压 vRms（有效值）表示，频率固定 50Hz。
 *
 * 端口坐标（相对于组件左上角）：
 *  - addPort(30, 125, 'u', 'wire', 'p')  // U 相
 *  - addPort(65, 125, 'v', 'wire', 'p')  // V 相
 *  - addPort(100, 125, 'w', 'wire', 'p') // W 相
 *  - addPort(135, 125, 'n', 'wire')      // N 中性线
 *
 * 可配置参数（通过构造参数可覆盖）：
 *  - vRms: 相电压有效值（默认 220V，范围 0~500V）
 *  - freq: 工作频率（固定 50Hz）
 *  - isOn: 是否开启（默认 false）
 */
export class ACPower3P extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        // 默认尺寸（宽度容纳 4 个接线柱，高度为标准面板高）
        this.width = 160;
        this.height = 125;

        this.type = 'source_3p';
        this.cache = 'fixed';  // 静态内容可缓存

        // 初始化三个绘图分组（BaseComponent 提供）
        this._initGroups();

        // 物理参数与状态
        this.isOn = config.isOn !== undefined ? config.isOn : false;      // 电源开关状态
        this.vRms = config.vRms !== undefined ? config.vRms : (config.vRms || 220);   // 相电压有效值（V）
        this.freq = config.freq !== undefined ? config.freq : (config.freq || 50);      // 工作频率（Hz）
        this.phaseSeq = config.phaseSeq || 'pos';   // 相序：'pos' 正序 UVW, 'neg' 负序 UWV
        this.rOn = 0.1;         // 内阻（仿真用）

        // 构建静态与交互 UI
        this._init();

        // 添加外部电气端口（4 个接线柱，从左到右：U V W N）
        this.addPort(30, 125, 'u', 'wire', 'p');
        this.addPort(65, 125, 'v', 'wire', 'p');
        this.addPort(100, 125, 'w', 'wire', 'p');
        this.addPort(135, 125, 'n', 'wire');
        this.update();
    }

    // 初始化面板与控件
    _init() {
        this._drawChassis();    // 机箱外壳
        this._drawNameplate();  // 名牌标签
        this._drawLCD();        // 显示屏（电压与频率）
        this._drawControls();   // 交互控件（电源键与调压旋钮）
    }

    // 绘制机箱主体（静态背景）
    _drawChassis() {
        this.chassis = new Konva.Rect({
            width: this.width, height: this.height,
            fill: '#e3e9ef', stroke: '#1a252f',
            strokeWidth: 3, cornerRadius: 5
        });
        this._staticGroup.add(this.chassis);
    }

    // 绘制名牌与标题（静态）
    _drawNameplate() {
        const title = new Konva.Text({
            x: 10, y: 5, text: '三相电源',
            fontSize: 12, fill: '#060606', fontStyle: 'bold'
        });
        this._staticGroup.add(title);
    }

    // 绘制 LCD 显示区（两行显示：电压与频率）
    _drawLCD() {
        // LCD 屏幕背景（黑色）
        const lcdBg = new Konva.Rect({
            x: 10, y: 18, width: this.width - 20, height: 40,
            fill: '#000', cornerRadius: 3
        });
        // 相电压显示（绿色，较大字体）
        this.vText = new Konva.Text({
            x: 10, y: 22, width: this.width - 20, text: '',
            fontSize: 18, fontFamily: 'monospace', fill: '#00ff00', align: 'center'
        });
        // 频率显示（黄色，较小字体）
        this.fText = new Konva.Text({
            x: 10, y: 42, width: this.width - 20, text: '',
            fontSize: 11, fontFamily: 'monospace', fill: '#eef207', align: 'center'
        });
        this._staticGroup.add(lcdBg, this.vText, this.fText);
    }

    // 绘制控制区：包含电源按钮与调压旋钮
    _drawControls() {
        const ctrlY = 75;

        // 1) 电源按钮（点击切换开/关状态）
        this.powerBtn = new Konva.Rect({
            x: 10, y: ctrlY + 3, width: 35, height: 25,
            fill: '#95a5a6', cornerRadius: 3, cursor: 'pointer'
        });
        this.powerBtn.on('mousedown touchstart', () => {
            this.isOn = !this.isOn;
            this.update();
        });

        // 2) 调压旋钮（灰色圆盘，通过垂直拖动调节电压 0~500V）
        this.knob = new Konva.Circle({
            x: 110, y: ctrlY + 15, radius: 25,
            fill: '#7f8c8d', stroke: '#bdc3c7', cursor: 'pointer'
        });
        // 旋钮指针（红色线条，旋转角度表示当前电压值）
        this.pointer = new Konva.Line({
            x: 110, y: ctrlY + 15, points: [0, 0, 0, -20],
            stroke: '#e74c3c', strokeWidth: 3
        });
        // 初始化指针角度（根据默认电压映射）
        const angle = (this.vRms / 500) * 260 - 130;
        this.pointer.rotation(angle);

        // 旋钮交互：鼠标按下拖动调节电压
        this.knob.on('mousedown touchstart', (e) => {
            e.cancelBubble = true;
            const startY = e.evt.clientY || e.evt.touches[0].clientY;
            const startV = this.vRms;

            // 鼠标移动：根据纵向位移计算新电压值
            const onMove = (me) => {
                const cy = me.clientY || (me.touches ? me.touches[0].clientY : me.clientY);
                this.vRms = Math.max(0, Math.min(500, startV + (startY - cy) * 2));
                this.update();
            };
            // 鼠标释放：清理事件监听
            const onUp = () => {
                window.removeEventListener('mousemove', onMove);
                window.removeEventListener('mouseup', onUp);
            };
            window.addEventListener('mousemove', onMove);
            window.addEventListener('mouseup', onUp);
        });

        // 将交互控件添加到交互分组
        this._interactGroup.add(this.powerBtn, this.knob, this.pointer);
    }

    /**
     * 获取指定相位的瞬时电压值（供求解器或电路仿真网格调用）
     * 
     * 三相电压表达式：
     *   U相（参考相）：V(t) = V_peak * sin(ωt)
     *   V相（滞后120°）：V(t) = V_peak * sin(ωt - 120°)
     *   W相（滞后240°）：V(t) = V_peak * sin(ωt - 240°)
     *
     * 参数：
     *   phase - 相位标识 ('u'|'v'|'w')，默认为 'u'
     *   time  - 时间（秒），从 0 开始计时
     *
     * 返回值：
     *   当组件开启时，返回对应相的瞬时电压（伏特）
     *   当组件关闭时，返回 0
     */
    getPhaseVoltage(phase, time) {
        if (!this.isOn) return 0;

        const peak = this.vRms * Math.sqrt(2);
        const omega = 2 * Math.PI * this.freq;

        let offset = 0;
        if (phase === 'v') {
            offset = this.phaseSeq === 'pos' ? -4 * Math.PI / 3 : -2 * Math.PI / 3;
        } else if (phase === 'w') {
            offset = this.phaseSeq === 'pos' ? -2 * Math.PI / 3 : -4 * Math.PI / 3;
        }

        return peak * Math.sin(omega * time + offset);
    }

    // 更新面板显示与状态（状态改变时调用）
    update() {
        // 根据当前电压值更新旋钮指针角度
        const angle = (this.vRms / 500) * 260 - 130;
        this.pointer.rotation(angle);

        // 电源按钮色彩反馈：开启时为绿色，关闭时为灰色
        this.powerBtn.fill(this.isOn ? '#2ecc71' : '#95a5a6');

        // LCD 显示：开启时显示电压和频率，关闭时为空白
        this.vText.text(this.isOn ? `${this.vRms.toFixed(0)} V` : '');
        const seqLabel = this.phaseSeq === 'pos' ? '正序' : '负序';
        this.fText.text(this.isOn ? `${this.freq.toFixed(0)} Hz  ${seqLabel}` : '');

        // 触发系统回调（通知其他组件或求解器状态已改变）
        if (this.sys.onComponentStateChange) this.sys.onComponentStateChange(this);

        // 刷新静态缓存，以便界面重绘（BaseComponent 提供）
        this._refreshCache();
    }

    /**
     * 返回配置对话框的字段定义
     * @returns {Array<{label:string, key:string, type:string, options?:Array}>}
     */
    getConfigFields() {
        return [
            { label: '相电压有效值 (V)', key: 'vRms', type: 'number' },
            { label: '频率 (Hz)', key: 'freq', type: 'number' },
            { label: '相序', key: 'phaseSeq', type: 'select', options: [
                { label: '正序 (UVW)', value: 'pos' },
                { label: '负序 (UWV)', value: 'neg' },
            ]},
            { label: '电源开关', key: 'isOn', type: 'select', options: [
                { label: '关闭', value: false },
                { label: '开启', value: true },
            ]},
        ];
    }

    /**
     * 接收配置对话框的更新并立即生效
     * @param {Object} cfg - 新配置（key→value 映射）
     */
    onConfigUpdate(cfg) {
        if (cfg.vRms !== undefined) this.vRms = parseFloat(cfg.vRms) || 220;
        if (cfg.freq !== undefined) this.freq = parseFloat(cfg.freq) || 50;
        if (cfg.phaseSeq !== undefined) this.phaseSeq = cfg.phaseSeq;
        if (cfg.isOn !== undefined) this.isOn = Boolean(cfg.isOn);
        this.config = { ...this.config, ...cfg };
        this.update();
        this._refreshCache();
    }

    // 清理资源（继承自 BaseComponent）
    destroy() {
        super.destroy?.();
    }
}
