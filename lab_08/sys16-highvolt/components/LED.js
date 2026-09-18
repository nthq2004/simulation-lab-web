/**
 * LED 发光二极管组件。
 *
 * 该组件用于在电路仿真图中表示发光二极管，包含阳极端、阴极端、发光三角形、
 * 阴极竖线和表示发光效果的箭头。组件通过电流状态控制三角形的填充颜色，
 * 从而直观显示 LED 是否导通发光。
 *
 * 主要功能：
 * 1. 使用左右两个电气端口接入电路；
 * 2. 使用正向导通压降参数参与电路模型配置；
 * 3. 支持 reverse 方向配置，用于旋转显示 LED 符号；
 * 4. 根据物理电流实时切换发光和熄灭状态；
 * 5. 提供器件名称和导通压降配置项。
 */
import { BaseComponent } from './BaseComponent.js';

export class LED extends BaseComponent {
    constructor(config, sys) {
        // 调用父类构造函数，初始化组件通用属性和系统引用。
        super(config, sys);
        // 保存发光二极管的显示方向配置。
        this.direction = config.direction;
        // 设置组件类型，供仿真系统识别为 LED 元件。
        this.type = 'led';
        // 创建静态图层、动态图层和交互图层容器。
        this._initGroups();

        // 读取正向导通压降，未配置时使用 2.0V 的默认值。
        this.vForward = config.vForward || 2.0;
        // 设置 LED 导通状态下的等效电阻。
        this.rOn = 0.5;
        // 设置 LED 截止状态下的高等效电阻。
        this.rOff = 1e8;

        // 保存组件的基础配置，供配置管理和序列化使用。
        this.config = {id:this.id, vForward:this.vForward};

        // 创建 LED 图形并建立左右两个电气端口。
        this.initVisuals();
        this.initPorts();

        // 反向配置时旋转整个组件，使 LED 的导通方向与接线方向一致。
        if (this.direction === 'reverse') this.group.rotate(180);
    }

    initPorts() {
        // 左端作为带正极标记的端口，右端作为另一侧回路端口。
        this.addPort(-40, 0, 'l', 'wire', 'p');
        this.addPort(40, 0, 'r', 'wire');
    }

    initVisuals() {
        // 所有基础图形统一使用黑色线条，保持电路符号清晰易辨。
        const stroke = '#000000';
        // 绘制 LED 左右两侧的引线，并将端口连接到符号主体。
        this._staticGroup.add(new Konva.Line({ points: [-40, 0, -15, 0], stroke, strokeWidth: 2 }));
        this._staticGroup.add(new Konva.Line({ points: [15, 0, 40, 0], stroke, strokeWidth: 2 }));

        // 三角形是 LED 的动态主体，导通时填充绿色，截止时恢复白色。
        this._triangle = new Konva.Line({
            points: [-15, -15, -15, 15, 15, 0],
            closed: true,
            fill: '#ffffff',
            stroke: stroke,
            strokeWidth: 2
        });
        this._dynamicGroup.add(this._triangle);

        // 绘制表示二极管阴极的竖直线。
        const bar = new Konva.Line({
            points: [15, -15, 15, 15],
            stroke: stroke,
            strokeWidth: 3
        });

        // 绘制第一条向外发散的发光箭头。
        const arrow1 = new Konva.Line({
            points: [30, -6, 38, -14, 30, -14],
            closed: true,
            fill: '#2ecc71',
            stroke: stroke,
            strokeWidth: 1.5
        });

        // 绘制第二条向外发散的发光箭头，增强 LED 的发光识别效果。
        const arrow2 = new Konva.Line({
            points: [28, 0, 36, -8, 28, -8],
            closed: true,
            fill: '#2ecc71',
            stroke: stroke,
            strokeWidth: 1.5
        });

        // 将阴极线和发光箭头放入静态图层，避免随电流状态反复重建。
        this._staticGroup.add(bar, arrow1, arrow2);

        // 创建显示正向压降的参数标签，便于在图面上直接查看器件参数。
        this.paramLabel = new Konva.Text({
            x: -35, y: -40, width: 80,
            text: this.vForward.toFixed(1) + 'V',
            fontSize: 12, fill: '#e74c3c', fontStyle: 'bold',
            align: 'center', listening: false,
        });
    }

    tick(dt) {
        // 以物理电流是否超过微小阈值判断 LED 当前是否发光。
        const lit = (this.physCurrent || 0) > 1e-4;
        // 导通时将三角形填充为绿色，截止时使用白色填充。
        this._triangle.fill(lit ? '#2ecc71' : '#ffffff');
        // 标记组件需要刷新，并按系统策略执行必要的缓存更新。
        this.markDirty();
        this._refreshIfDirty();
    }

    getConfigFields() {
        // 暴露器件名称和正向导通压降两个可编辑配置项。
        return [
            { label: '器件名称', key: 'id', type: 'text' },
            { label: '导通压降 (V)', key: 'vForward', type: 'number' }
        ];
    }
    onConfigUpdate(cfg) {
        // 配置包含器件名称时同步更新组件标识。
        if (cfg.id !== undefined) {
            this.id = cfg.id;
        }
        // 配置包含正向压降时更新模型参数并刷新标签显示。
        if (cfg.vForward !== undefined) {
            this.vForward = cfg.vForward;
            this._updateLabel();
        }
        // 保存新的配置对象，并刷新静态缓存以应用配置变化。
        this.config = cfg;
        this._refreshCache();
    }

    _updateLabel() {
        // 预留参数标签更新入口，供后续配置变更时刷新界面文字。
    }

    destroy() {
        // 调用父类销毁逻辑，释放组件持有的图形和交互资源。
        super.destroy?.();
    }
}
