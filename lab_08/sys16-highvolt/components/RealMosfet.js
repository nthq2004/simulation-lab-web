/**
 * RealMosfet 实体 MOSFET 组件。
 *
 * 该组件用于表示具有实际功率器件封装外观的 MOSFET，提供漏极 D、源极 S 和栅极 G
 * 三个电气端口，并保存阈值电压、导通电阻和截止电阻等开关模型参数。组件还预留
 * 了求解器工作模式、导通状态以及漏极-源极短路/开路故障字段，便于接入功率电子
 * 仿真和故障教学流程。图形使用 MOSFET 实体外壳、安装凸台、安装孔和 IRF840 铭牌。
 *
 * 主要功能：
 * 1. 创建 D、S、G 三个电气端口，分别表示主电流通道和栅极控制端；
 * 2. 使用 vth、rOn 和 rOff 描述 MOSFET 的开关等效参数；
 * 3. 绘制带引脚、封装轮廓、安装结构、型号文字和电阻标签的实体外观；
 * 4. 保存 MOSFET 的开关状态以及 D-S 短路/开路故障状态；
 * 5. 支持通过配置面板更新器件名称、阈值电压和等效电阻。
 */
import { BaseComponent } from './BaseComponent.js';

export class RealMosfet extends BaseComponent {
    constructor(config, sys) {
        // 调用父类构造函数，初始化组件公共属性和系统引用。
        super(config, sys);
        // 实体封装图形主要为静态内容，因此启用固定缓存。
        this.cache = 'fixed';
        // 创建静态、动态和交互图层容器。
        this._initGroups();
        // 设置组件类型，供仿真系统识别为 MOSFET。
        this.type = 'mosfet';

        // 设置栅极控制阈值电压。
        this.vth = 3.0;
        // 设置 MOSFET 导通状态下的漏源等效电阻。
        this.rOn = 0.2;
        // 保存用于显示或扩展逻辑的导通电阻值。
        this.rOnDisp = 30;
        // 设置 MOSFET 截止状态下的高等效电阻。
        this.rOff = 1e6;
        // 保存求解器使用的 MOSFET 等效模型工作模式。
        this._mosfetStampMode = 'off';
        // 记录 MOSFET 当前是否处于导通状态。
        this._isOn = false;
        // 记录漏极和源极之间的短路故障状态。
        this._faultDSShort = false;
        // 记录漏极和源极之间的开路故障状态。
        this._faultDSOpen = false;

        // 保存组件标识和主要电气参数。
        this.config = { id: this.id, vth: this.vth, rOn: this.rOn, rOff: this.rOff };

        // 创建漏极、源极和栅极三个电气端口。
        this.initPorts();
        // 绘制 MOSFET 实体封装和端子标识。
        this.initVisuals();
    }

    initPorts() {
        // 漏极位于左侧，并标记为主通道正端。
        this.addPort(-50, 0, 'd', 'wire', 'p');
        // 源极位于右侧，作为主通道另一端。
        this.addPort(50, 0, 's', 'wire');
        // 栅极位于器件下方，用于接收开关控制信号。
        this.addPort(0, 30, 'g', 'wire', 'g');
    }

    initVisuals() {
        // 定义金属引脚、封装主体、识别条和印刷文字的显示颜色。
        const c = {
            pin: '#bcc6cf',
            pinDark: '#8a9299',
            bodyHi: '#2c3e50',
            bodyLo: '#1a252f',
            accent: '#c0a060',
            printed: '#e8ecf0',
        };

        // 创建漏极、源极和栅极三条实体引脚。
        const pins = [
            new Konva.Line({ points: [-30, 0, -50, 0], stroke: c.pin, strokeWidth: 4.5, lineCap: 'round' }),
            new Konva.Line({ points: [30, 0, 50, 0], stroke: c.pin, strokeWidth: 4.5, lineCap: 'round' }),
            new Konva.Line({ points: [0, 18, 0, 30], stroke: c.pin, strokeWidth: 3, lineCap: 'round' }),
        ];
        // 将引脚加入静态图层。
        pins.forEach(p => this._staticGroup.add(p));

        // 绘制带渐变和阴影的 MOSFET 封装主体。
        const bodyPath = new Konva.Path({
            data: 'M-30,-18 L18,-18 L30,-10 L30,18 L-30,18 Z',
            fillLinearGradientStartPoint: { x: -30, y: -18 },
            fillLinearGradientEndPoint: { x: 30, y: 18 },
            fillLinearGradientColorStops: [0, c.bodyHi, 0.5, c.bodyLo, 1, c.bodyHi],
            stroke: '#555',
            strokeWidth: 1.5,
            shadowColor: '#000',
            shadowBlur: 6,
            shadowOffset: { x: 2, y: 2 },
            shadowOpacity: 0.3,
        });
        this._staticGroup.add(bodyPath);

        // 绘制封装外轮廓，增强器件主体边界。
        const bodyOutline = new Konva.Line({
            points: [-30, 18, 18, 18, 30, 10, 30, -18, -30, -18],
            closed: true, stroke: '#666', strokeWidth: 1, listening: false,
        });
        this._staticGroup.add(bodyOutline);

        // 绘制顶部安装凸台或散热片结构。
        const tab = new Konva.Rect({
            x: -8, y: -26,
            width: 16, height: 8,
            fillLinearGradientStartPoint: { x: -8, y: -26 },
            fillLinearGradientEndPoint: { x: 8, y: -18 },
            fillLinearGradientColorStops: [0, '#3a4a5a', 0.5, '#1a252f', 1, '#3a4a5a'],
            stroke: '#666', strokeWidth: 1,
        });
        this._staticGroup.add(tab);

        // 绘制顶部安装孔。
        const hole = new Konva.Circle({
            x: 0, y: -22, radius: 2.5, fill: '#555', stroke: '#777', strokeWidth: 0.5,
        });
        this._staticGroup.add(hole);

        // 设置器件内部型号和规格文字样式。
        const textStyle = { fontSize: 8, fill: c.printed, fontFamily: 'Arial', fontStyle: 'bold', listening: false };
        // 标注 MOSFET 器件类型。
        this._staticGroup.add(new Konva.Text({ x: -26, y: -14, text: 'MOSFET', ...textStyle }));
        // 标注典型器件型号 IRF840。
        this._staticGroup.add(new Konva.Text({ x: -26, y: -4, text: 'IRF840', ...textStyle }));

        // 绘制封装上的金色识别条。
        const mark = new Konva.Rect({
            x: 18, y: -18, width: 12, height: 4,
            fill: c.accent, cornerRadius: 1, opacity: 0.85,
        });
        this._staticGroup.add(mark);

        // 设置 D、S、G 端子标签的统一显示样式。
        const lbl = { fontSize: 11, fill: '#e74c3c', fontFamily: 'Arial', fontStyle: 'bold' };
        // 标注漏极 D。
        this._staticGroup.add(new Konva.Text({ x: -46, y: -28, text: 'D', ...lbl }));
        // 标注源极 S。
        this._staticGroup.add(new Konva.Text({ x: 42, y: -28, text: 'S', ...lbl }));
        // 标注栅极 G。
        this._staticGroup.add(new Konva.Text({ x: -8, y: 34, text: 'G', ...lbl }));

        // 创建显示漏源导通电阻的参数标签。
        const ts = { fontSize: 8, fill: '#e8ecf0', fontFamily: 'Arial', listening: false };
        this._valueLabel = new Konva.Text({
            x: -26, y: 6, text: `${this.rOn}Ω`, ...ts, fontStyle: 'bold',
        });
        // 将导通电阻标签加入静态图层。
        this._staticGroup.add(this._valueLabel);
    }

    getConfigFields() {
        // 配置面板开放器件名称、阈值电压、导通电阻和截止电阻。
        return [
            { label: '器件名称', key: 'id', type: 'text' },
            { label: '阈值电压 Vth (V)', key: 'vth', type: 'number' },
            { label: '导通电阻 Rds(on) (Ω)', key: 'rOn', type: 'number' },
            { label: '截止电阻 Roff (Ω)', key: 'rOff', type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        // 更新器件标识。
        if (cfg.id !== undefined) this.id = cfg.id;
        // 更新 MOSFET 栅极阈值电压。
        if (cfg.vth !== undefined) this.vth = cfg.vth;
        // 更新导通状态下的漏源电阻。
        if (cfg.rOn !== undefined) this.rOn = cfg.rOn;
        // 更新截止状态下的等效电阻。
        if (cfg.rOff !== undefined) this.rOff = cfg.rOff;
        // 保存最新配置对象。
        this.config = cfg;
        // 同步更新封装上的导通电阻文字。
        if (this._valueLabel) this._valueLabel.text(`${this.rOn}Ω`);
        // 刷新固定缓存，使新的参数显示立即生效。
        this._refreshCache();
    }

    destroy() {
        // 调用父类销毁逻辑，释放 MOSFET 图形和相关资源。
        super.destroy?.();
    }
}
