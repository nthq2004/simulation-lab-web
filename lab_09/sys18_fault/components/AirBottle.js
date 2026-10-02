import { BaseComponent } from './BaseComponent.js';

/**
 * 气瓶（Air Bottle）仿真组件
 *
 * 概述：模拟气瓶的视觉与简单物理行为，用于气源储能与放气消耗仿真。
 * 内部以 MPa 为压力存储单位，支持以 BAR 为显示单位的转换。
 *
 * 主要特性：
 *  - 可配置初始压力、容积与显示单位；支持 `isConsuming` 消耗/泄漏模式
 *  - 提供气路端口（输入 i，输出 o）供气路网络连线
 *  - 面板嵌入简易 LCD 显示当前压力（动态节点，in-place 更新）
 *
 * 遵循新组件模板：构造函数 `_initGroups → _recalcGeometry → _initParameters → _init`
 * （`_init` 内 `_drawStaticParts` + `_createDynamicNodes`），最后 `addPort`。
 */
export class AirBottle extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(120, config.width  || 160);
        this.height = Math.max(160, config.height || 220);

        this.type  = 'airBottle';
        this.cache = 'fixed';

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        // config 副本：便于外部读取或编辑器显示
        this.config = { id: this.id, pressure: this.pressure, volume: this.volume, unit: this.displayUnit };

        // 气路端口：o 输出端，i 输入端（标记 'in'）
        this.addPort(-13, 80, 'o', 'pipe');
        this.addPort(83, 0, 'i', 'pipe', 'in');
    }

    // ═══════════════════════════════════════════════════════
    // 几何尺寸
    // ═══════════════════════════════════════════════════════

    _recalcGeometry() {
        this.w = this.width;
        this.h = this.height;
        this._tankW = 90;
        this._tankH = 130;
        this._viewX = 35;
        this._viewY = 40;
    }

    // ═══════════════════════════════════════════════════════
    // 参数初始化
    // ═══════════════════════════════════════════════════════

    _initParameters(config) {
        this.maxPressure = 20.0;  // 最大压力上限 MPa（约 200 bar）
        this.displayUnit = (config && config.unit) ? config.unit : 'MPa';

        let initP = (config && config.initialPressure !== undefined) ? config.initialPressure : 2;
        // 以 BAR 输入则换算为 MPa 存储（1 MPa = 10 bar）
        this.pressure = (this.displayUnit === 'BAR') ? initP / 10 : initP;

        this.volume = (config && config.volume) ? config.volume : 50;  // 容积 L

        this.isConsuming = !!config.isConsuming;      // 是否处于放气/消耗状态（可配置）
        this.consumptionRate = config.consumptionRate !== undefined ? parseFloat(config.consumptionRate) : 0.5; // 消耗速率基准 MPa/s
    }

    // ═══════════════════════════════════════════════════════
    // 主初始化
    // ═══════════════════════════════════════════════════════

    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
        this.update();   // 初始刷新一次显示
    }

    // ═══════════════════════════════════════════════════════
    // 静态部件
    // ═══════════════════════════════════════════════════════

    _drawStaticParts() {
        const { _tankW: tankW, _tankH: tankH } = this;

        this.viewGroup = new Konva.Group({ x: this._viewX, y: this._viewY });
        this._staticGroup.add(this.viewGroup);

        // 主体矩形
        this.viewGroup.add(new Konva.Rect({
            x: -tankW / 2, y: -tankH / 2, width: tankW, height: tankH,
            fillLinearGradientStartPoint: { x: -tankW / 2, y: 0 },
            fillLinearGradientEndPoint: { x: tankW / 2, y: 0 },
            fillLinearGradientColorStops: [0, '#1a5276', 0.4, '#3498db', 1, '#1a5276'],
            stroke: '#154360', strokeWidth: 2,
        }));
        // 上下半球头
        this.viewGroup.add(new Konva.Arc({
            x: 0, y: -tankH / 2, innerRadius: 0, outerRadius: tankW / 2,
            angle: 180, rotation: 180, fill: '#3498db', stroke: '#154360', strokeWidth: 2,
        }));
        this.viewGroup.add(new Konva.Arc({
            x: 0, y: tankH / 2, innerRadius: 0, outerRadius: tankW / 2,
            angle: 180, rotation: 0, fill: '#2691d3', stroke: '#154360', strokeWidth: 2,
        }));

        // 嵌入式 LCD 外壳（显示板）
        this.viewGroup.add(new Konva.Rect({
            x: -30, y: -20, width: 60, height: 40,
            fill: '#2c3e50', stroke: '#bdc3c7', strokeWidth: 2, cornerRadius: 3,
        }));
        this.viewGroup.add(new Konva.Rect({ x: -25, y: -12, width: 50, height: 24, fill: '#000' }));
    }

    // ═══════════════════════════════════════════════════════
    // 动态节点
    // ═══════════════════════════════════════════════════════

    _createDynamicNodes() {
        // 与 viewGroup 同变换的动态组，保证坐标一致
        this._dynView = new Konva.Group({ x: this._viewX, y: this._viewY });
        this._dynamicGroup.add(this._dynView);

        this.pressureDisplay = new Konva.Text({
            x: -25, y: -8, width: 50, text: '0.0',
            fontSize: 11, fontFamily: 'Courier New', fontStyle: 'bold',
            fill: '#00ff00', align: 'center',
        });
        this._dynView.add(this.pressureDisplay);
    }

    // ═══════════════════════════════════════════════════════
    // 动态更新（in-place）
    // ═══════════════════════════════════════════════════════

    /** 刷新 LCD 压力显示（含低压报警文字闪烁） */
    update() {
        if (!this.pressureDisplay) return;

        const displayValue = (this.displayUnit === 'BAR')
            ? (this.pressure * 10).toFixed(1)
            : this.pressure.toFixed(2);

        this.pressureDisplay.text(`${displayValue}\n${this.displayUnit}`);

        // 低压报警：0.1 MPa 以下 LCD 闪红，否则常绿
        const isLow = this.pressure < 0.1;
        const blink = Math.sin(Date.now() / 200) > 0;
        this.pressureDisplay.fill(isLow ? (blink ? '#ff0000' : '#330000') : '#00ff00');

        this.markDirty();
        this._refreshIfDirty();
    }

    /** tick：消耗/泄漏模型 + 低压报警闪烁动画 */
    tick(dt) {
        if (this.isConsuming && this.pressure > 0) {
            const drop = (this.consumptionRate / this.volume) * dt;
            this.pressure = Math.max(0, this.pressure - drop);
            this.update();
        } else if (this.pressure < 0.1) {
            // 无消耗时 LCD 低压闪烁仍需刷新
            this.update();
        }
    }

    // ═══════════════════════════════════════════════════════
    // 公开 API
    // ═══════════════════════════════════════════════════════

    /** 供求解器读取当前压力（MPa） */
    getValue() {
        return this.pressure;
    }

    getPressure() { return this.pressure; }

    /** 设定当前压力（MPa） */
    setPressure(p) {
        this.pressure = Math.max(0, Math.min(this.maxPressure, parseFloat(p) || 0));
        this.update();
    }

    /** 充气（amount 单位 MPa） */
    refill(amount) {
        this.pressure = Math.min(this.maxPressure, this.pressure + amount);
        this.update();
    }

    /** 局部坐标 → 舞台绝对坐标 */
    _toAbs(x, y) {
        try { return this.group.getAbsoluteTransform().point({ x, y }); }
        catch (e) { return { x: this.group.x() + x, y: this.group.y() + y }; }
    }

    /** 返回部件中心的世界坐标（供工作流箭头定位） */
    getClickablePartCenter(partId) {
        switch (partId) {
            case 'lcd':   // 压力数显
            case 'tank':  // 瓶体
                return this._toAbs(this._viewX, this._viewY);
            case 'o':     // 出气口
                return this._toAbs(-13, 80);
            case 'i':     // 进气口
                return this._toAbs(83, 0);
            default:
                return null;
        }
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
                    { label: 'BAR (公斤)', value: 'BAR' },
                ],
            },
            { label: '气瓶容积 (L)', key: 'volume', type: 'number' },
            { label: '是否耗气 (true/false)', key: 'isConsuming', type: 'text' },
            { label: '耗气速率 (MPa/s)', key: 'consumptionRate', type: 'number' },
        ];
    }

    onConfigUpdate(newConfig) {
        if (newConfig.id) this.id = newConfig.id;
        if (newConfig.volume) this.volume = parseFloat(newConfig.volume);

        this.displayUnit = newConfig.unit || 'MPa';

        if (newConfig.pressure !== undefined) {
            const inputP = parseFloat(newConfig.pressure);
            // 内部存 MPa：BAR 输入则除以 10
            this.pressure = (this.displayUnit === 'BAR') ? inputP / 10 : inputP;
        }
        if (newConfig.isConsuming !== undefined) {
            this.isConsuming = newConfig.isConsuming === true || newConfig.isConsuming === 'true';
        }
        if (newConfig.consumptionRate !== undefined) {
            this.consumptionRate = parseFloat(newConfig.consumptionRate) || 0;
        }
        this.config = { ...this.config, pressure: this.pressure, volume: this.volume, unit: this.displayUnit,
            isConsuming: this.isConsuming, consumptionRate: this.consumptionRate };
        this.update();
    }

    destroy() {
        super.destroy?.();
    }
}
