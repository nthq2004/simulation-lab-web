import { BaseComponent } from './BaseComponent.js';

/**
 * Ballast 镇流器组件。
 *
 * 作用：该组件用于模拟电磁镇流器/电感型负载，它本质上是一个带有电感与内阻的串联 RL 元件。
 * 设计目标：
 * 1. 在电路图中以一个独立器件出现，支持拖拽、端口连接、配置编辑；
 * 2. 提供稳定的电感参数和内阻参数，供仿真引擎求解电流与电压；
 * 3. 兼容旧版伴随模型接口，保证与更高层的求解器或配置系统协同工作；
 * 4. 支持故障状态下的开路处理，用于教学仿真中的异常场景。
 *
 * 代码结构：
 * - 构造函数：初始化尺寸、类型、缓存和端口；
 * - _initParameters：设置电感/内阻等关键物理参数；
 * - _drawStaticParts：绘制镇流器的静态外观（壳体、线圈、铁芯、文字标签）；
 * - getConfigFields / onConfigUpdate：提供参数面板与动态更新逻辑；
 * - tick：在仿真循环中更新故障状态引起的电阻变化。
 */
export class Ballast extends BaseComponent {
    constructor(config, sys) {
        // 先调用父类构造函数，完成 BaseComponent 的基础初始化，
        // 包括图层管理、ID 生成、交互组和缓存组等关键状态。
        super(config, sys);

        // 设置组件的默认几何尺寸，决定设备在画布中的占比和布局。
        this.width = 120;
        this.height = 70;

        // 设置器件类型，用于系统识别该组件属于哪一类电气元件。
        this.type = 'ballast';
        // 启用固定缓存，使静态图像在首次绘制后缓存，减少重复渲染开销。
        this.cache = 'fixed';

        // 初始化 Konva 图层相关的分组容器，确保组件能够拥有交互层和静态渲染层。
        this._initGroups();
        // 根据缩放比例和组件尺寸重新计算内部几何变量，供绘制和端口定位使用。
        this._recalcGeometry();
        // 读取配置参数并初始化电感、电阻、故障标志等使用状态。
        this._initParameters(config);
        // 执行组件具体绘制逻辑，创建静态外观元素。
        this._init();

        // 保存组件配置快照，供外部读取和重置时使用。
        this.config = {
            id: this.id,
            inductance: this.inductance,
            resistance: this.resistance,
        };

        // 左右两个端口分别对应输入和输出，使用 wire 类型表示这是电气连接端口。
        this.addPort(-61, 0, 'l', 'wire');
        this.addPort(61, 0, 'r', 'wire');
    }

    _recalcGeometry() {
        // 读取当前缩放系数，默认值为 1，意味着未缩放状态。
        const s = this.scale || 1;
        // 计算在当前缩放下的实际宽高，后续用于绘制和端口位置计算。
        this._W = this.width * s;
        this._H = this.height * s;
    }

    _initParameters(config) {
        // 电感值单位为亨利（H），如果配置中未提供则使用默认 2.2 H。
        this.inductance = config.inductance || 2.2;
        // 内阻值单位为欧姆（Ω），默认 30 Ω，表示电感绕组的导线损耗。
        this.resistance = config.resistance || 30;
        // 保存当前物理电流值，供求解器读取或更新。
        this.physCurrent = 0;
        // 标记这是一个串联 RL 元件，方便上层求解器按 RL 结构处理。
        this._useRLSeries = true;
        // 定义串联 RL 的两个端口名，分别对应左端口和右端口。
        this._rlPort1 = 'l';
        this._rlPort2 = 'r';
        // 当前实际计算使用的线圈电阻值，可在故障状态下被覆盖。
        this._coilResistance = this.resistance;
        // 当前实际参与仿真的电感值，可在配置更新时同步刷新。
        this._coilInductance = this.inductance;
        // 记录上一时刻的电流，用于状态更新和可能的历史比较。
        this._coilPrevCurrent = 0;
        // 故障状态标志：为 true 时表示该镇流器开路，电阻极大以模拟断路。
        this._faultOpen = false;
    }

    _init() {
        // 仅执行静态绘制，动态状态在 tick 中更新，不在每帧重建节点。
        this._drawStaticParts();
    }

    tick(dt) {
        // 如果发生开路故障，则将等效电阻设为极高值，近似表示断路状态。
        if (this._faultOpen) this._coilResistance = 10e6;
        // 否则恢复为正常配置中的内阻值，保证器件恢复正常工作状态。
        else this._coilResistance = this.resistance;
    }

    _drawStaticParts() {
        // 获取当前缩放因子，便于调整导线和图形尺寸。
        const s = this.scale || 1;
        // 获取实际绘制宽度与高度。
        const W = this._W;
        const H = this._H;

        // 透明点击区域用于承载拖拽和交互事件，保证用户可以直接选中组件。
        this._interactGroup.add(new Konva.Rect({
            x: -W / 2, y: -H / 2, width: W, height: H, fill: 'transparent',
        }));

        // 绘制外壳主体框体，作为镇流器的基本轮廓，灰色底色突出机械构造感。
        const box = new Konva.Rect({
            x: -W / 2, y: -H / 2, width: W, height: H,
            fill: '#95a5a6', stroke: '#7f8c8d', strokeWidth: 1.5,
            cornerRadius: 3, listening: false,
        });
        this._staticGroup.add(box);

        // 画出箱体内部的三条横向脊线，模拟装置内部分隔或结构纹理。
        const ridgeY = [-H / 4, 0, H / 4];
        ridgeY.forEach(ry => {
            const ridge = new Konva.Line({
                points: [-W / 2 + 5, ry, W / 2 - 5, ry],
                stroke: '#7f8c8d', strokeWidth: 0.8, listening: false,
            });
            this._staticGroup.add(ridge);
        });

        // 左右端子导线延伸，模拟从器件主体伸出的接线引出。
        const leadL = new Konva.Line({
            points: [-W / 2, 0, -W / 2 - 15 * s, 0],
            stroke: '#bdc3c7', strokeWidth: 2.5, lineCap: 'round', listening: false,
        });
        const leadR = new Konva.Line({
            points: [W / 2, 0, W / 2 + 15 * s, 0],
            stroke: '#bdc3c7', strokeWidth: 2.5, lineCap: 'round', listening: false,
        });

        // 绘制线圈路径，使用一串弧线模拟电感绕组的结构。
        const coilPath = new Konva.Path({
            data: 'M -30 5 A 7 7 0 0 1 -16 5 A 7 7 0 0 1 -2 5 A 7 7 0 0 1 12 5 A 7 7 0 0 1 26 5 A 7 7 0 0 1 40 5',
            stroke: '#2c3e50', strokeWidth: 2.5, lineCap: 'round', fill: null, listening: false,
        });
        this._staticGroup.add(coilPath);

        // 铁芯顶端和底端的细线，表示线圈内部的磁芯结构。
        const coreTop = new Konva.Line({
            points: [-28, -8, 38, -8],
            stroke: '#2c3e50', strokeWidth: 3, lineCap: 'round', listening: false,
        });
        const coreBot = new Konva.Line({
            points: [-28, -4, 38, -4],
            stroke: '#2c3e50', strokeWidth: 1, lineCap: 'round', listening: false,
        });
        this._staticGroup.add(coreTop, coreBot);

        // 显示电感值标签，帮助用户在画面中即时识别当前镇流器参数。
        this._inductanceLabel = new Konva.Text({
            x: -35, y: 12, width: 70,
            text: this._formatInductance(this.inductance),
            fontSize: 11, fontStyle: 'bold', fontFamily: 'Arial',
            fill: '#2c3e50', align: 'center', listening: false,
        });
        this._staticGroup.add(this._inductanceLabel);
    }

    _formatInductance(h) {
        // 当电感值大于等于 1 H 时，使用“H”单位直接显示，便于读数。
        if (h >= 1) return h.toFixed(1) + 'H';
        // 当电感值位于毫亨范围时，转换为 mH 形式，更符合实际工程习惯。
        if (h >= 1e-3) return (h * 1e3).toFixed(1) + 'mH';
        // 极小电感值用科学计数法显示，避免数值过小导致界面难以识别。
        return h.toExponential(1) + 'H';
    }

    // 伴随模型已弃用，改用 stampRLSeries（电压源方程法）。
    // 这段注释说明当前实现不再依赖老的伴随模型，而是采用更适合 RL 串联元件的电压源方程化方法。
    // 保留 getCompanionModel 供引擎兼容，返回零值，避免已有调用链因接口缺失而出错。
    getCompanionModel() { return { gEq: 0, iEq: 0 }; }
    // 旧接口保留但不做处理，说明该组件没有额外的状态机更新逻辑需要执行。
    updateState() {}
    // 物理电流计算由求解器或更高层逻辑处理，这里空实现保持兼容。
    calculatePhysicalCurrent() {}

    getConfigFields() {
        // 返回配置面板中可编辑的字段列表，供界面动态生成输入框。
        return [
            { label: '器件名称', key: 'id', type: 'text' },
            { label: '电感量 (H)', key: 'inductance', type: 'number' },
            { label: '内阻 (Ω)', key: 'resistance', type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        // 如果传入了新名称，则更新组件的标识符，确保界面和系统状态一致。
        if (cfg.id !== undefined) this.id = cfg.id;
        // 若电感值被更新，则同步修改组件参数和线圈真实电感值。
        if (cfg.inductance !== undefined) { this.inductance = cfg.inductance; this._coilInductance = cfg.inductance; }
        // 若内阻值被更新，则同步修改实际线圈电阻。
        if (cfg.resistance !== undefined) { this.resistance = cfg.resistance; this._coilResistance = cfg.resistance; }
        // 更新标签文字，确保屏幕上的显示值与配置值保持一致。
        if (this._inductanceLabel) this._inductanceLabel.text(this._formatInductance(this.inductance));
        // 合并新配置到已有配置快照中，保留原有字段并覆盖更新的字段。
        this.config = { ...this.config, ...cfg };
        // 标记组件需要重绘，避免界面状态与模型状态不一致。
        this.markDirty();
        // 如果当前组件已被标记为脏状态，则执行一次刷新。
        this._refreshIfDirty();
    }

    destroy() {
        // 调用父类的 destroy 生命周期钩子，确保组件释放时正确清理资源。
        super.destroy?.();
    }
}