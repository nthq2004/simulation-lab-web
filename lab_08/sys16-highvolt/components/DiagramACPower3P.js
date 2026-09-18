/**
 * DiagramACPower3P 三相交流电源示意组件。
 *
 * 作用：这是一个用于仿真平台中的三相交流电源示意图对象，主要用于表示三相供电网络中的 U、V、W 三相和中性线 N。
 * 它负责显示电源参数、提供三相输出电压的相位关系，并把运行状态反馈给系统，以便后续电路求解器按三相电源口读取电压。
 *
 * 设计特点：
 * 1. 以极简示意图形式展示三相源头，不依赖复杂器件渲染；
 * 2. 允许配置相电压有效值、频率、相序和开关状态；
 * 3. 通过 getPhaseVoltage() 计算各相瞬时电压；
 * 4. 通过 update() 同步显示文本与系统状态事件。
 */
import { BaseComponent } from './BaseComponent.js';

export class DiagramACPower3P extends BaseComponent {
    constructor(config, sys) {
        // 调用父类构造函数，初始化通用组件能力，如图形层、缓存和系统引用。
        super(config, sys);

        // 组件的尺寸被设计得很窄，适合做示意性的三相电源端子模块。
        this.width  = 160;
        this.height = 25;

        // type 用于在系统中识别该组件是三相交流源。
        this.type  = 'source_3p';
        // 静态图形使用固定缓存，减少无意义重绘。
        this.cache = 'fixed';

        // 初始化图层，区分静态渲染部分和交互部分。
        this._initGroups();

        // 电源参数从配置中读取，默认开启且输出 220V、50Hz、正序相序。
        this.isOn     = config.isOn     !== undefined ? config.isOn     : true;
        this.vRms     = config.vRms     !== undefined ? config.vRms     : 220;
        this.freq     = config.freq     !== undefined ? config.freq     : 50;
        this.phaseSeq = config.phaseSeq || 'pos';
        this.rOn      = 0.01;

        // 先执行通用图形初始化，再添加端口，然后更新配置和显示状态。
        this._init();

        this.addPort(30,  25, 'u', 'wire', 'p');
        this.addPort(65,  25, 'v', 'wire', 'p');
        this.addPort(100, 25, 'w', 'wire', 'p');
        this.addPort(135, 25, 'n', 'wire');

        this.config = {
            id: this.id,
            vRms: this.vRms,
            freq: this.freq,
            phaseSeq: this.phaseSeq,
            isOn: this.isOn,
        };

        // 首次调用 update() 将显示当前供电状态和电压值。
        this.update();
    }

    _init() {
        // 组件初始化分三部分：外框、端子标签和数值显示。
        this._drawFrame();
        this._drawTerminals();
        this._drawDisplay();
    }

    _drawFrame() {
        // 绘制底部的矩形边框，用来表示一个简洁的三相电源模块。
        this._staticGroup.add(new Konva.Rect({
            width: this.width, height: this.height,
            fill: '#f8f9fa',
            stroke: '#1a252f',
            strokeWidth: 1.5,
            dash: [6, 4],
            cornerRadius: 4,
        }));
    }

    _drawTerminals() {
        // 定义四个端子位置：U、V、W、N，分别表示三相源和中性线。
        const pts = [
            { x: 30,  label: 'U' },
            { x: 65,  label: 'V' },
            { x: 100, label: 'W' },
            { x: 135, label: 'N' },
        ];
        const ty = this.height - 18;

        pts.forEach(p => {
            // 逐个绘制端子文字标签，标明对应相位或中性线。
            this._staticGroup.add(new Konva.Text({
                x: p.x - 5, y: ty-2 ,
                text: p.label,
                fontSize: 12, fontStyle: 'bold', fill: '#222',
            }));
        });
    }

    _drawDisplay() {
        // 这里的文本用于显示当前三相线电压值，通常出现在组件上方。
        this._vText = new Konva.Text({
            x: 0, y: -20,
            width: this.width,
            text: '',
            fontSize: 18,
            fontFamily: 'monospace',
            fill: '#e03030',
            align: 'center',
        });
        this._staticGroup.add(this._vText);
    }

    getPhaseVoltage(phase, time) {
        // 如果电源关闭，则不产生任何输出电压，返回 0。
        if (!this.isOn) return 0;

        // 根据有效值计算峰值，并根据频率生成角速度。
        const peak = this.vRms * Math.sqrt(2);
        const omega = 2 * Math.PI * this.freq;

        // 设定不同相别间的相位偏移，形成三相系统的相位差。
        let offset = 0;
        if (phase === 'v') {
            offset = this.phaseSeq === 'pos' ? -4 * Math.PI / 3 : -2 * Math.PI / 3;
        } else if (phase === 'w') {
            offset = this.phaseSeq === 'pos' ? -2 * Math.PI / 3 : -4 * Math.PI / 3;
        }

        // 使用正弦函数生成瞬时相电压值，代表三相交流电源的动态输出。
        return peak * Math.sin(omega * time + offset);
    }

    update() {
        // 计算当前线电压，若关闭则显示为 0，否则显示有效值对应的线电压。
        const lineV = this.isOn ? this.vRms * Math.sqrt(3) : 0;
        this._vText.text(this.isOn ? `${lineV.toFixed(0)} V` : '');

        // 通知系统组件状态已更新，供上层逻辑响应。
        if (this.sys && this.sys.onComponentStateChange) this.sys.onComponentStateChange(this);
        this._refreshCache();
    }

    getConfigFields() {
        // 返回配置面板中所需的字段，便于用户在运行中调整电源参数。
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

    onConfigUpdate(cfg) {
        // 当外部配置更新时，逐项更新状态，并重新同步显示和缓存。
        if (cfg.vRms !== undefined) this.vRms = parseFloat(cfg.vRms) || 220;
        if (cfg.freq !== undefined) this.freq = parseFloat(cfg.freq) || 50;
        if (cfg.phaseSeq !== undefined) this.phaseSeq = cfg.phaseSeq;
        if (cfg.isOn !== undefined) this.isOn = cfg.isOn === true || cfg.isOn === 'true';
        this.config = { ...this.config, ...cfg };
        this.update();
        this._refreshCache();
    }

    destroy() {
        // 调用父类销毁逻辑，确保组件销毁时保持统一的生命周期处理方式。
        super.destroy?.();
    }
}
