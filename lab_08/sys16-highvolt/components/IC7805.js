/**
 * IC7805 线性稳压器组件。
 *
 * 作用：这是一个简化版的 5V 三端稳压器图元，主要用于教学仿真中展示直流稳压芯片的基本外观和接线方式。
 * 它不实现复杂的电压调节算法，而是通过结构化的器件外观和端口定义，让系统能够在电路图中识别并连接 7805 稳压芯片。
 *
 * 设计特点：
 * 1. 采用标准的 7805 封装视觉标识，便于直观看出输入、输出和地端；
 * 2. 提供 in/out/gnd 三个端口，适合在仿真电路中接到电源和负载；
 * 3. 只保留配置项和基础生命周期方法，适合作为教学型稳定器原型。
 */
import { BaseComponent } from './BaseComponent.js';

export class IC7805 extends BaseComponent {
    constructor(config, sys) {
        // 调用父类构造函数，完成组件基础状态和系统引用的初始化。
        super(config, sys);
        // 通过类型标识以便仿真系统识别这是一个 7805 稳压器器件。
        this.type = 'regulator_7805';
        // fixed 缓存允许静态外观在重绘时复用，减少不必要的绘制开销。
        this.cache = 'fixed';
        // 初始化 Konva 图层容器，用于放置静态和动态节点。
        this._initGroups();

        // 这些状态变量保留用于稳压器的运行状态跟踪和后续扩展，尽管当前实现中并未进行复杂处理。
        this.physCurrent = 0;
        this._regMode = 'normal';
        this._lastVi = 0;
        this._lastVt = 0;

        // 组件外观和端口是在构造函数中一次性创建，因此实例化后即可直接展示在电路图中。
        this._drawVisuals();
        this._addPorts();
    }

    _drawVisuals() {
        // 组件的主体是一个短方框，外形类似三端稳压块，用于在电路图中快速识别。
        const w = 80, h = 50;
        const rect = new Konva.Rect({
            x: -w / 2, y: -h / 2,
            width: w, height: h,
            fill: '#d9d9d9',
            stroke: '#000',
            strokeWidth: 2,
            cornerRadius: 4,
        });
        // 中间文本为 7805，表示该器件对应的稳压输出标准值 5V。
        const label = new Konva.Text({
            x: -w / 2, y: -h / 2,
            width: w, height: h,
            text: '7805',
            fontSize: 28,
            fontStyle: 'bold',
            fill: '#1a1a2e',
            align: 'center',
            verticalAlign: 'middle',
            listening: false,
        });
        // 静态元素加入静态图层，保证该器件外观在更新中保持稳定。
        this._staticGroup.add(rect, label);
    }

    _addPorts() {
        // 输入端位于左侧，输出端位于右侧，地端位于下方；这与常见 7805 引脚排列一致。
        this.addPort(-45, 0, 'in', 'wire');
        this.addPort(45, 0, 'out', 'wire', 'p');
        this.addPort(0, 30, 'gnd', 'wire');
    }

    getConfigFields() {
        // 配置面板只暴露器件名称这一类基础属性，符合该组件目前的精简实现方式。
        return [
            { label: '器件名称', key: 'id', type: 'text' },
        ];
    }
    onConfigUpdate(cfg) {
        // 配置更新时同步设备 ID，并保留新配置对象用于后续状态复现或编辑器显示。
        if (cfg.id !== undefined) this.id = cfg.id;
        this.config = cfg;
        this._refreshCache();
    }

    tick(dt) {
        // 当前稳压器仅作为示意器件，未设置实际的动态电压/电流计算，因此此处留空。
    }

    destroy() {
        // 调用父类销毁逻辑完成资源清理和节点移除。
        super.destroy?.();
    }
}
