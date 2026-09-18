/**
 * IGBT 绝缘栅双极型晶体管组件。
 *
 * 作用：该组件用于在教学仿真电路中表示一个 IGBT 开关器件，能够用图符和端口方式展示集电极、发射极、门极三端结构。
 * 它适合用于功率电子和开关控制教学场景，让学生直观看到器件的通断状态、门极驱动和导通参数特征。
 *
 * 设计特点：
 * 1. 使用简单的符号化图形表示 IGBT 的内部晶体管结构；
 * 2. 定义 C / E / G 三个端口，便于接线和电路求解；
 * 3. 配置项包含阈值电压、导通压降和导通/截止电阻，便于模拟不同器件特性；
 * 4. 组件绘制和参数更新都遵循基础组件的通用模式，方便在仿真平台中复用。
 */
import { BaseComponent } from './BaseComponent.js';

export class IGBT extends BaseComponent {
    constructor(config, sys) {
        // 调用父类构造函数，为组件绑定系统对象并完成基础状态初始化。
        super(config, sys);
        // fixed 缓存可以让静态符号在重绘时复用，减少不必要的图形重绘开销。
        this.cache = 'fixed';
        // 初始化 Konva 图层容器，后续静态符号和动态状态都挂在这里。
        this._initGroups();
        // 器件类型用于系统识别和求解器的设备分派。
        this.type = 'igbt';

        // 一组典型参数描述了器件的门极阈值、通态压降和导通/截止状态阻抗。
        this.vth = 4.5;
        this.vOn = 1.8;
        this.rOn = 0.1;
        this.rOnDisp = 50;
        this.rOff = 1e6;
        this._igbtStampMode = 'off';
        this._isOn = false;
        this._faultCEShort = false;
        this._faultCEOpen = false;

        // 配置对象保存组件当前的关键参数，方便对话框、状态回放和后续更新同步。
        this.config = { id: this.id, vth: this.vth, vOn: this.vOn, rOn: this.rOn, rOff: this.rOff };

        // 初始化端口和可视化外观，保证实例一生成即可接线和显示。
        this.initPorts();
        this.initVisuals();
    }

    initPorts() {
        // 集电极位于左侧，发射极位于右侧，门极位于上方，符合 IGBT 的常用三端方向示意。
        this.addPort(-40, 0, 'c', 'wire', 'p');
        this.addPort(50, 0, 'e', 'wire');
        this.addPort(0, 30, 'g', 'wire', 'g');
    }

    initVisuals() {
        // 黑色基线和三角形图形共同构成了 IGBT 的简化符号，这种视图适合教学和电路示意。
        const s = '#000';
        this._staticGroup.add(new Konva.Line({ points: [-40, 0, -15, 0], stroke: s, strokeWidth: 2 }));
        this._staticGroup.add(new Konva.Line({ points: [15, 0, 50, 0], stroke: s, strokeWidth: 2 }));

        // 典型的三角形通道代表晶体管主通路，形成 IGBT 的核心半导体结构。
        const tri = new Konva.Line({
            points: [-15, -15, -15, 15, 15, 0],
            closed: true, fill: '#fff', stroke: s, strokeWidth: 2,
        });
        this._staticGroup.add(tri);

        // 竖直的实心杆用于示意器件导通通道的结构边界。
        const bar = new Konva.Line({
            points: [15, -15, 15, 15],
            stroke: s, strokeWidth: 3,
        });
        this._staticGroup.add(bar);

        // 门极引线从顶部向下延伸，表示需要门极驱动信号来控制开关状态。
        const gate = new Konva.Line({
            points: [0, 15, 0, 30],
            stroke: s, strokeWidth: 2,
        });
        this._staticGroup.add(gate);

        // 字母标识说明各端口含义，方便读图和教学说明。
        const lbl = { fontSize: 12, fill: '#333', fontFamily: 'Arial', fontStyle: 'bold' };
        this._staticGroup.add(new Konva.Text({ x: -48, y: -20, text: 'C', ...lbl }));
        this._staticGroup.add(new Konva.Text({ x: 38, y: -20, text: 'E', ...lbl }));
        this._staticGroup.add(new Konva.Text({ x: -10, y: 34, text: 'G', ...lbl }));

        // 右侧显示的电阻值用于提示器件的导通电阻特征，便于观察状态参数。
        this._valueLabel = new Konva.Text({
            x: -22, y: 10, text: `${this.rOn}Ω`, fontSize: 9,
            fill: '#555', fontFamily: 'Arial', align: 'center', width: 44,
        });
        this._staticGroup.add(this._valueLabel);
    }

    getConfigFields() {
        // 配置面板公开器件的关键参数，让用户可以在仿真中调节阈值、压降和导通特性。
        return [
            { label: '器件名称', key: 'id', type: 'text' },
            { label: '阈值电压 Vth (V)', key: 'vth', type: 'number' },
            { label: '导通压降 Vce(on) (V)', key: 'vOn', type: 'number' },
            { label: '导通电阻 Ron (Ω)', key: 'rOn', type: 'number' },
            { label: '截止电阻 Roff (Ω)', key: 'rOff', type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        // 配置更新时按字段同步参数，并刷新器件显示值，确保视觉和内部状态一致。
        if (cfg.id !== undefined) this.id = cfg.id;
        if (cfg.vth !== undefined) this.vth = cfg.vth;
        if (cfg.vOn !== undefined) this.vOn = cfg.vOn;
        if (cfg.rOn !== undefined) this.rOn = cfg.rOn;
        if (cfg.rOff !== undefined) this.rOff = cfg.rOff;
        this.config = cfg;
        if (this._valueLabel) this._valueLabel.text(`${this.rOn}Ω`);
        this._refreshCache();
    }

    destroy() {
        // 调用父类的销毁逻辑以清理资源并移除 Konva 节点。
        super.destroy?.();
    }
}
