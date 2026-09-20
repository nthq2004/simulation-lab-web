import { BaseComponent } from './BaseComponent.js';

/**
 * 气瓶（Air Bottle）仿真组件
 *
 * 概述：模拟一个气瓶的视觉与简单物理行为，用于气源储能与放气消耗仿真。
 * 内部以 MPa 为压力存储单位，支持以 BAR 为显示单位的转换。
 *
 * 主要特性：
 *  - 可配置初始压力、容积与显示单位
 *  - 支持消耗模式（isConsuming）以模拟气体放空
 *  - 提供气路端口（输入 i，输出 o）供仿真网络连线
 *  - 面板嵌入简易 LCD 显示当前压力
 */
export class AirBottle extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        // 视觉与布局尺寸（方便后续缩放）
        this.scale = 1;
        this.w = 160 * this.scale;
        this.h = 220 * this.scale;

        this.type = 'airBottle';
        this.cache = 'fixed';

        // 初始化绘图分组（BaseComponent 提供）
        this._initGroups();

        // --- 物理参数（内部统一使用 MPa） ---
        this.maxPressure = 20.0; // 最大压力上限（MPa），约等于 200 bar

        // 显示单位（可以为 'MPa' 或 'BAR'），若未提供则默认 MPa
        this.displayUnit = (config && config.unit) ? config.unit : 'MPa';
        let initP = (config && config.initialPressure !== undefined) ? config.initialPressure : 2;
        // 若用户以 BAR 输入初始压力，则转换为 MPa 存储（1 MPa = 10 bar）
        this.pressure = (this.displayUnit === 'BAR') ? initP / 10 : initP;

        // 容积（升，L）——用于简单的消耗速率映射
        this.volume = (config && config.volume) ? config.volume : 50;

        // 消耗状态与速率（用于 tick 中的压力衰减模拟）
        this.isConsuming = false;         // 是否处于放气/消耗状态
        this.consumptionRate = 0.5;       // 消耗速率基准（MPa/s），可由外部调节

        // 将关键信息保存在 config 结构中，便于外部读取或编辑器显示
        this.config = { id: this.id, pressure: this.pressure, volume: this.volume, unit: this.displayUnit };

        // 构建视觉元素并添加端口
        this.initVisuals();

        // 添加气路端口：o 为输出端，i 为输入端（标记为 'in'）
        this.addPort(-13 * this.scale, 80 * this.scale, 'o', 'pipe');
        this.addPort(83 * this.scale, 0 * this.scale, 'i', 'pipe', 'in');
    }

    initVisuals() {
        // 创建用于绘制气瓶的局部视图组，便于控制位置与缩放
        this.viewGroup = new Konva.Group({ x: 35 * this.scale, y: 40 * this.scale, scaleX: this.scale, scaleY: this.scale });
        this._staticGroup.add(this.viewGroup);

        const tankW = 90, tankH = 130;

        // 主体（矩形）及上下半球头（Arc）用于模拟气瓶外观
        const body = new Konva.Rect({ x: -tankW / 2, y: -tankH / 2, width: tankW, height: tankH, fillLinearGradientStartPoint: { x: -tankW / 2, y: 0 }, fillLinearGradientEndPoint: { x: tankW / 2, y: 0 }, fillLinearGradientColorStops: [0, '#1a5276', 0.4, '#3498db', 1, '#1a5276'], stroke: '#154360', strokeWidth: 2 });

        const topDome = new Konva.Arc({ x: 0, y: -tankH / 2, innerRadius: 0, outerRadius: tankW / 2, angle: 180, rotation: 180, fill: '#3498db', stroke: '#154360', strokeWidth: 2 });

        const bottomDome = new Konva.Arc({ x: 0, y: tankH / 2, innerRadius: 0, outerRadius: tankW / 2, angle: 180, rotation: 0, fill: '#2691d3', stroke: '#154360', strokeWidth: 2 });

        this.viewGroup.add(bottomDome, topDome, body);

        // 嵌入式 LCD（显示当前压力），返回值对象用于后续更新文本
        this.pressureDisplay = this._drawEmbeddedLCD(0, 0);
        // 初始一次更新以刷新显示
        this.update();
    }

    _drawEmbeddedLCD(x, y) {
        const lcdGroup = new Konva.Group({ x, y });
        lcdGroup.add(new Konva.Rect({
            x: -30, y: -20, width: 60, height: 40,
            fill: '#2c3e50', stroke: '#bdc3c7', strokeWidth: 2, cornerRadius: 3
        }));
        lcdGroup.add(new Konva.Rect({ x: -25, y: -12, width: 50, height: 24, fill: '#000' }));

        const valText = new Konva.Text({
            x: -25, y: -8, width: 50, text: '0.0',
            fontSize: 11, fontFamily: 'Courier New', fontStyle: 'bold',
            fill: '#00ff00', align: 'center'
        });

        lcdGroup.add(valText);
        this.viewGroup.add(lcdGroup);
        return valText;
    }

    // tick 用于按固定间隔累加执行物理更新（dt 单位为秒）
    tick(dt) {
        if (this.isConsuming && this.pressure > 0) {
            // 简化的消耗模型：压降速率与消耗速率成正比，与容积成反比
            // drop 单位为 MPa（dt 为秒），因此 consumptionRate 的单位可视为 MPa/s 基准
            const drop = (this.consumptionRate / this.volume) * dt;
            this.pressure = Math.max(0, this.pressure - drop);
            this.update();
        }
        // 刷新缓存以便界面更新（仅在视觉上）
        this._refreshCache();
    }

    // 外部获取当前压力 (求解器调用)
    getValue() {
        return this.pressure; // 直接返回内部 MPa 
    }

    refill(amount) {
        // amount 需为 MPa
        this.pressure = Math.min(this.maxPressure, this.pressure + amount);
        this.update();
    }

    getConfigFields() {
        return [
            { label: '器件名称 (ID)', key: 'id', type: 'text' },
            { label: '初始压力', key: 'pressure', type: 'number' },
            {
                label: '压力单位',
                key: 'unit',
                type: 'select',
                options: [
                    { label: 'MPa (兆帕)', value: 'MPa' },
                    { label: 'BAR (公斤)', value: 'BAR' }
                ]
            },
            { label: '气瓶容积 (L)', key: 'volume', type: 'number' }
        ];
    }

    onConfigUpdate(newConfig) {
        if (newConfig.id) this.id = newConfig.id;
        if (newConfig.volume) this.volume = parseFloat(newConfig.volume);

        this.displayUnit = newConfig.unit || 'MPa';

        if (newConfig.pressure !== undefined) {
            let inputP = parseFloat(newConfig.pressure);
            // 修正：内部存 MPa。如果输入的是 BAR，则除以 10
            this.pressure = (this.displayUnit === 'BAR') ? inputP / 10 : inputP;
        }
        this.update();
    }

    destroy() {
        super.destroy?.();
    }

    update() {
        if (this.pressureDisplay) {
            // 显示换算：内部 MPa -> 界面显示
            const displayValue = (this.displayUnit === 'BAR')
                ? (this.pressure * 10).toFixed(1)
                : this.pressure.toFixed(2);

            this.pressureDisplay.text(`${displayValue}\n${this.displayUnit}`);

            // 报警逻辑修正：0.15 MPa 约为原先的 1.5 BAR
            const isLow = this.pressure < 0.15;
            const blink = Math.sin(Date.now() / 200) > 0;
            const color = isLow ? (blink ? '#ff0000' : '#330000') : '#00ff00';

            this.pressureDisplay.fill(color);
            this.pressureDisplay.shadowColor(color);
            this._refreshCache();
        }
    }
}