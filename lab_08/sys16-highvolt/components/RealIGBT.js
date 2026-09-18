/**
 * RealIGBT 实体绝缘栅双极型晶体管组件。
 *
 * 该组件用于表示具有实际封装外观的 IGBT 功率开关器件，提供集电极 C、发射极 E
 * 和栅极 G 三个电气端口，并保存阈值电压、导通压降、导通电阻和截止电阻等参数。
 * 组件还预留了求解器工作模式、导通状态以及集电极-发射极短路/开路故障字段，
 * 方便接入电力电子开关模型和故障教学流程。
 *
 * 主要功能：
 * 1. 创建 C、E、G 三个电气端口，分别表示主电流通道和栅极控制端；
 * 2. 使用 vth、vOn、rOn 和 rOff 描述 IGBT 的开关等效参数；
 * 3. 绘制带引脚、散热安装孔、型号铭牌和电气端子标识的实体封装；
 * 4. 保存 IGBT 开关状态和 C-E 故障状态，供求解器或故障系统使用；
 * 5. 支持通过配置面板更新器件参数。
 */
import { BaseComponent } from './BaseComponent.js';

export class RealIGBT extends BaseComponent {
    constructor(config, sys) {
        // 调用父类构造函数，初始化组件公共属性和系统引用。
        super(config, sys);
        // 实体封装图形以静态内容为主，因此启用固定缓存。
        this.cache = 'fixed';
        // 创建静态、动态和交互图层容器。
        this._initGroups();
        // 设置组件类型，供仿真系统识别为 IGBT。
        this.type = 'igbt';

        // 设置栅极控制阈值电压。
        this.vth = 4.5;
        // 设置 IGBT 导通时的集电极-发射极压降。
        this.vOn = 1.8;
        // 设置 IGBT 导通状态下的等效电阻。
        this.rOn = 0.1;
        // 保存用于显示或扩展逻辑的导通电阻数值。
        this.rOnDisp = 50;
        // 设置 IGBT 截止状态下的高等效电阻。
        this.rOff = 1e6;
        // 保存求解器使用的 IGBT 等效模型工作模式。
        this._igbtStampMode = 'off';
        // 记录 IGBT 当前是否导通。
        this._isOn = false;
        // 记录集电极与发射极之间的短路故障。
        this._faultCEShort = false;
        // 记录集电极与发射极之间的开路故障。
        this._faultCEOpen = false;

        // 保存器件标识和主要电气参数。
        this.config = { id: this.id, vth: this.vth, vOn: this.vOn, rOn: this.rOn, rOff: this.rOff };

        // 创建集电极、发射极和栅极三个电气端口。
        this.initPorts();
        // 绘制 IGBT 实体封装和端子标识。
        this.initVisuals();
    }

    initPorts() {
        // 集电极位于左侧，并标记为主电流通道的正端。
        this.addPort(-50, 0, 'c', 'wire', 'p');
        // 发射极位于右侧，是主电流通道的另一端。
        this.addPort(50, 0, 'e', 'wire');
        // 栅极位于器件下方，用于接收开关控制信号。
        this.addPort(0, 30, 'g', 'wire', 'g');
    }

    initVisuals() {
        // 定义引脚、封装主体、金属标识和印刷文字的配色。
        const c = {
            pin: '#bcc6cf',
            pinDark: '#8a9299',
            bodyHi: '#2c3e50',
            bodyLo: '#1a252f',
            accent: '#c0a060',
            printed: '#e8ecf0',
        };

        // 绘制集电极、发射极和栅极三条金属引脚。
        const pins = [
            new Konva.Line({ points: [-30, 0, -50, 0], stroke: c.pin, strokeWidth: 4.5, lineCap: 'round' }),
            new Konva.Line({ points: [30, 0, 50, 0], stroke: c.pin, strokeWidth: 4.5, lineCap: 'round' }),
            new Konva.Line({ points: [0, 18, 0, 30], stroke: c.pin, strokeWidth: 3, lineCap: 'round' }),
        ];
        // 将三条引脚加入静态图层。
        pins.forEach(p => this._staticGroup.add(p));

        // 绘制带渐变效果的 IGBT 黑色封装主体。
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

        // 绘制封装边缘轮廓，使主体外形更加清晰。
        const bodyOutline = new Konva.Line({
            points: [-30, 18, 18, 18, 30, 10, 30, -18, -30, -18],
            closed: true, stroke: '#666', strokeWidth: 1, listening: false,
        });
        this._staticGroup.add(bodyOutline);

        // 绘制顶部散热片或安装凸台。
        const tab = new Konva.Rect({
            x: -8, y: -26,
            width: 16, height: 8,
            fillLinearGradientStartPoint: { x: -8, y: -26 },
            fillLinearGradientEndPoint: { x: 8, y: -18 },
            fillLinearGradientColorStops: [0, '#3a4a5a', 0.5, '#1a252f', 1, '#3a4a5a'],
            stroke: '#666', strokeWidth: 1,
        });
        this._staticGroup.add(tab);

        // 绘制安装孔，用于表现功率器件的机械固定结构。
        const hole = new Konva.Circle({
            x: 0, y: -22, radius: 2.5, fill: '#555', stroke: '#777', strokeWidth: 0.5,
        });
        this._staticGroup.add(hole);

        // 设置器件内部印刷文字样式。
        const textStyle = { fontSize: 8, fill: c.printed, fontFamily: 'Arial', fontStyle: 'bold', listening: false };
        // 标注 IGBT 型号。
        this._staticGroup.add(new Konva.Text({ x: -26, y: -14, text: 'IGBT', ...textStyle }));
        // 标注耐压和额定电流信息。
        this._staticGroup.add(new Konva.Text({ x: -26, y: -4, text: '1200V/50A', ...textStyle }));

        // 绘制封装上的金色识别条。
        const mark = new Konva.Rect({
            x: 18, y: -18, width: 12, height: 4,
            fill: c.accent, cornerRadius: 1, opacity: 0.85,
        });
        this._staticGroup.add(mark);

        // 设置 C、E、G 端子标签的显示样式。
        const lbl = { fontSize: 11, fill: '#e74c3c', fontFamily: 'Arial', fontStyle: 'bold' };
        // 标注集电极 C。
        this._staticGroup.add(new Konva.Text({ x: -46, y: -28, text: 'C', ...lbl }));
        // 标注发射极 E。
        this._staticGroup.add(new Konva.Text({ x: 42, y: -28, text: 'E', ...lbl }));
        // 标注栅极 G。
        this._staticGroup.add(new Konva.Text({ x: -8, y: 34, text: 'G', ...lbl }));

        // 创建显示导通电阻的参数标签。
        const ts = { fontSize: 8, fill: c.printed, fontFamily: 'Arial', listening: false };
        this._valueLabel = new Konva.Text({
            x: -26, y: 6, text: `${this.rOn}Ω`, ...ts, fontStyle: 'bold',
        });
        // 将导通电阻标签加入静态图层。
        this._staticGroup.add(this._valueLabel);
    }

    getConfigFields() {
        // 配置面板开放器件名称、阈值电压、导通压降和两种等效电阻。
        return [
            { label: '器件名称', key: 'id', type: 'text' },
            { label: '阈值电压 Vth (V)', key: 'vth', type: 'number' },
            { label: '导通压降 Vce(on) (V)', key: 'vOn', type: 'number' },
            { label: '导通电阻 Ron (Ω)', key: 'rOn', type: 'number' },
            { label: '截止电阻 Roff (Ω)', key: 'rOff', type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        // 更新器件标识。
        if (cfg.id !== undefined) this.id = cfg.id;
        // 更新栅极阈值电压。
        if (cfg.vth !== undefined) this.vth = cfg.vth;
        // 更新导通状态下的集电极-发射极压降。
        if (cfg.vOn !== undefined) this.vOn = cfg.vOn;
        // 更新导通电阻。
        if (cfg.rOn !== undefined) this.rOn = cfg.rOn;
        // 更新截止电阻。
        if (cfg.rOff !== undefined) this.rOff = cfg.rOff;
        // 保存最新配置对象。
        this.config = cfg;
        // 同步更新图形中的导通电阻文字。
        if (this._valueLabel) this._valueLabel.text(`${this.rOn}Ω`);
        // 刷新固定缓存，使参数显示及时生效。
        this._refreshCache();
    }

    destroy() {
        // 调用父类销毁逻辑，释放 IGBT 图形和相关资源。
        super.destroy?.();
    }
}
