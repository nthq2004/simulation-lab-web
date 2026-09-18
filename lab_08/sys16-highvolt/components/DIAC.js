/**
 * DIAC 双向触发二极管组件。
 *
 * 作用：这个元件用于模拟双向触发二极管（DIAC）在交流电路中的击穿和维持导通特性。
 * 它本质上是一种具有双向导通阈值的半导体器件：当两端电压达到转折电压时，器件会迅速进入导通状态，
 * 之后在较低电压下仍可维持导通，直到电流减小到一定程度后恢复截止。
 *
 * 设计特点：
 * 1. 使用双极结构图形表示 DIAC 的对称特性；
 * 2. 具有 vBreakover（转折电压）和 vHold（维持电压）两个关键参数；
 * 3. 可以在配置界面中修改器件标识和电压参数；
 * 4. 通过方向属性支持正向或反向装配姿态。
 */
import { BaseComponent } from './BaseComponent.js';

export class DIAC extends BaseComponent {
    constructor(config, sys) {
        // 调用父类构造函数，初始化通用组件能力，包括基本图形层和系统引用。
        super(config, sys);
        // 记录器件方向，允许在需要时进行翻转显示以匹配电路方向。
        this.direction = config.direction;
        // 组件类型用于系统识别，它属于双向触发二极管器件类别。
        this.type = 'diac';
        // 启用固定缓存，减少静态图形重绘压力。
        this.cache = 'fixed';
        // 初始化公共图层，区分静态绘制层与交互层。
        this._initGroups();

        // 设置 DIAC 的关键参数：转折电压是器件开始导通的阈值，维持电压则是导通后保持导通的较低门槛。
        this.vBreakover = config.vBreakover || 30;
        this.vHold = config.vHold || 10;
        this.rOn = 5;
        this.rOff = 1e12;
        this._diacActive = false;

        // 保存配置对象，方便后续读取或恢复器件参数。
        this.config = {id:this.id, vBreakover:this.vBreakover, vHold:this.vHold};

        // 调用初始化方法生成视觉和端口，确保组件在构造完成后可直接显示和连接。
        this.initVisuals();
        this.initPorts();

        // 若设置为 reverse，则整组组件旋转 180°，表现出反向安装状态。
        if (this.direction === 'reverse') this.group.rotate(180);
    }

    initPorts() {
        // 端口位于左右两侧，分别表示两个极性接点。
        this.addPort(-40, 0, 'l', 'wire', 'p');
        this.addPort(40, 0, 'r', 'wire');
    }

    initVisuals() {
        // 设定统一的线条颜色，保证器件图形的主体视觉风格一致。
        const stroke = '#000000';
        // 绘制左右两侧的连接线，作为器件主体的引线部分。
        this._staticGroup.add(new Konva.Line({ points: [-40, 0, -14, 0], stroke, strokeWidth: 2 }));
        this._staticGroup.add(new Konva.Line({ points: [12, 0, 40, 0], stroke, strokeWidth: 2 }));

        // 左侧三角形部分代表一方向触发结构，通常用于形成双向对称的器件轮廓。
        const triLeft = new Konva.Line({
            points: [-14, -22, -14, 2, 11, -10],
            closed: true,
            fill: '#000000',
            stroke: stroke,
            strokeWidth: 2
        });
        const lineLeft = new Konva.Line({
            points: [-14, -24, -14, 24],
            closed: false,
            fill: '#000000',
            stroke: stroke,
            strokeWidth: 4
        });
        // 右侧三角形与竖直线部分形成另一侧的对称结构，模拟 DIAC 的双向特性。
        const triRight = new Konva.Line({
            points: [12, -4, 12, 20, -11, 8],
            closed: true,
            fill: '#000000',
            stroke: stroke,
            strokeWidth: 2
        });
        const lineright = new Konva.Line({
            points: [12, -24, 12, 24],
            closed: false,
            fill: '#000000',
            stroke: stroke,
            strokeWidth: 4
        });
        this._staticGroup.add(triLeft,lineLeft, triRight,lineright);

        // 参数标签显示当前转折电压值，方便在界面上快速查看器件设定。
        this.paramLabel = new Konva.Text({
            x: -35, y: -40, width: 80,
            text: this.vBreakover.toFixed(0) + 'V',
            fontSize: 12, fill: '#e74c3c', fontStyle: 'bold',
            align: 'center', listening: false,
        });
    }

    getConfigFields() {
        // 返回配置面板中需要展示的字段，便于用户动态修改该器件参数。
        return [
            { label: '器件名称', key: 'id', type: 'text' },
            { label: '转折电压 (V)', key: 'vBreakover', type: 'number' },
            { label: '导通维持电压 (V)', key: 'vHold', type: 'number' },
        ];
    }
    onConfigUpdate(cfg) {
        // 当配置面板更新参数时，逐项同步到当前组件实例中。
        if (cfg.id !== undefined) {
            this.id = cfg.id;
        }
        if (cfg.vBreakover !== undefined) {
            this.vBreakover = cfg.vBreakover;
            this._updateLabel();
        }
        if (cfg.vHold !== undefined) this.vHold = cfg.vHold;
        this.config = cfg;
        this._refreshCache();
    }

    _updateLabel() {
        // 当前实现中标签更新入口为空，说明当前版本未对参数标签进行实时刷新处理。
    }

    destroy() {
        // 调用父类的销毁逻辑，保持对象生命周期和系统清理的一致性。
        super.destroy?.();
    }
}
