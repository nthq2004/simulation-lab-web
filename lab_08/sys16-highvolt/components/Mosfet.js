/**
 * MOSFET 场效应晶体管组件。
 *
 * 该组件用于表示具有漏极 D、源极 S 和栅极 G 三个端子的 MOSFET 器件，
 * 同时保存阈值电压、导通电阻和截止电阻等基础电气参数，供电路求解器建立
 * MOSFET 的开关等效模型。图形部分使用标准化的三端晶体管符号，并在符号中
 * 标出端子名称和当前导通电阻，方便进行电力电子和开关控制教学。
 *
 * 主要功能：
 * 1. 创建 D、S、G 三个电气端口，并标记漏极和栅极的端口极性；
 * 2. 使用 vth、rOn 和 rOff 参数描述 MOSFET 的导通条件和等效电阻；
 * 3. 保存开关状态、故障状态以及求解器使用的工作模式；
 * 4. 绘制 MOSFET 符号、端子标签和导通电阻显示文字；
 * 5. 支持通过配置面板更新器件参数。
 */
import { BaseComponent } from './BaseComponent.js';

export class Mosfet extends BaseComponent {
    constructor(config, sys) {
        // 调用父类构造函数，初始化组件的公共属性和系统引用。
        super(config, sys);
        // MOSFET 图形主要为静态内容，因此启用固定缓存。
        this.cache = 'fixed';
        // 创建静态图层、动态图层和交互图层等基础容器。
        this._initGroups();
        // 设置组件类型，供电路求解器识别为 MOSFET 器件。
        this.type = 'mosfet';

        // 设置栅极控制 MOSFET 导通所需的默认阈值电压。
        this.vth = 3.0;
        // 设置 MOSFET 导通时的漏源等效电阻。
        this.rOn = 0.2;
        // 设置用于图形显示的导通电阻值，保留给显示或扩展逻辑使用。
        this.rOnDisp = 30;
        // 设置 MOSFET 截止时的高等效电阻。
        this.rOff = 1e6;
        // 记录 MOSFET 当前采用的求解器盖章/等效模型工作模式。
        this._mosfetStampMode = 'off';
        // 记录 MOSFET 当前是否处于导通状态。
        this._isOn = false;
        // 记录漏极与源极短路故障状态。
        this._faultDSShort = false;
        // 记录漏极与源极开路故障状态。
        this._faultDSOpen = false;

        // 保存器件标识和电气参数，供配置系统和状态序列化使用。
        this.config = { id: this.id, vth: this.vth, rOn: this.rOn, rOff: this.rOff };

        // 创建漏极、源极和栅极三个电气端口。
        this.initPorts();
        // 绘制 MOSFET 的静态电路符号和参数标签。
        this.initVisuals();
    }

    initPorts() {
        // 漏极端口位于符号左侧，并标记为正向电气端口。
        this.addPort(-40, 0, 'd', 'wire', 'p');
        // 源极端口位于符号右侧，作为漏源通道的另一端。
        this.addPort(50, 0, 's', 'wire');
        // 栅极端口位于符号下方，并使用 g 标识其控制端属性。
        this.addPort(0, 30, 'g', 'wire', 'g');
    }

    initVisuals() {
        // 统一设置电路符号线条颜色。
        const s = '#000';
        // 绘制漏极侧引线，将左侧端口连接到 MOSFET 主体。
        this._staticGroup.add(new Konva.Line({ points: [-40, 0, -15, 0], stroke: s, strokeWidth: 2 }));
        // 绘制源极侧引线，将右侧端口连接到 MOSFET 主体。
        this._staticGroup.add(new Konva.Line({ points: [15, 0, 50, 0], stroke: s, strokeWidth: 2 }));

        // 绘制栅极引线，将下方控制端连接到 MOSFET 符号主体。
        this._staticGroup.add(new Konva.Line({ points: [0, 15, 0, 30], stroke: s, strokeWidth: 2 }));

        // 使用三角形表示 MOSFET 的主体区域，作为符号的核心图形。
        const tri = new Konva.Line({
            points: [-15, -15, -15, 15, 15, 0],
            closed: true, fill: '#fff', stroke: s, strokeWidth: 2,
        });
        this._staticGroup.add(tri);

        // 绘制漏源通道旁的竖直挡板，表示半导体开关通道。
        const bar = new Konva.Line({
            points: [15, -15, 15, 15],
            stroke: s, strokeWidth: 3,
        });
        this._staticGroup.add(bar);

        // 绘制栅极与通道之间的间隙，突出 MOSFET 的绝缘栅控制特征。
        const gap = new Konva.Line({
            points: [-15, -4, -15, 4],
            stroke: '#fff', strokeWidth: 3,
        });
        this._staticGroup.add(gap);

        // 统一设置端子标签的字号、颜色和字体样式。
        const lbl = { fontSize: 12, fill: '#333', fontFamily: 'Arial', fontStyle: 'bold' };
        // 标注漏极 D。
        this._staticGroup.add(new Konva.Text({ x: -48, y: -20, text: 'D', ...lbl }));
        // 标注源极 S。
        this._staticGroup.add(new Konva.Text({ x: 38, y: -20, text: 'S', ...lbl }));
        // 标注栅极 G。
        this._staticGroup.add(new Konva.Text({ x: -10, y: 34, text: 'G', ...lbl }));

        // 创建导通电阻显示标签，帮助用户直接查看当前设置的 Rds(on) 参数。
        this._valueLabel = new Konva.Text({
            x: -22, y: 10, text: `${this.rOn}Ω`, fontSize: 9,
            fill: '#555', fontFamily: 'Arial', align: 'center', width: 44,
        });
        // 将导通电阻标签放入静态图层。
        this._staticGroup.add(this._valueLabel);
    }

    getConfigFields() {
        // 配置面板开放器件名称、阈值电压、导通电阻和截止电阻四项参数。
        return [
            { label: '器件名称', key: 'id', type: 'text' },
            { label: '阈值电压 Vth (V)', key: 'vth', type: 'number' },
            { label: '导通电阻 Rds(on) (Ω)', key: 'rOn', type: 'number' },
            { label: '截止电阻 Roff (Ω)', key: 'rOff', type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        // 配置包含新 ID 时，同步更新组件标识。
        if (cfg.id !== undefined) this.id = cfg.id;
        // 更新栅极控制 MOSFET 导通所需的阈值电压。
        if (cfg.vth !== undefined) this.vth = cfg.vth;
        // 更新 MOSFET 导通状态下的等效电阻。
        if (cfg.rOn !== undefined) this.rOn = cfg.rOn;
        // 更新 MOSFET 截止状态下的等效电阻。
        if (cfg.rOff !== undefined) this.rOff = cfg.rOff;
        // 保存最新配置对象，供外部配置系统继续使用。
        this.config = cfg;
        // 如果电阻标签已经创建，则同步显示新的导通电阻值。
        if (this._valueLabel) this._valueLabel.text(`${this.rOn}Ω`);
        // 刷新静态缓存，使更新后的参数显示立即生效。
        this._refreshCache();
    }

    destroy() {
        // 调用父类销毁逻辑，释放组件图形和相关资源。
        super.destroy?.();
    }
}
