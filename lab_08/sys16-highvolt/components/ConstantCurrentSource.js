/**
 * ConstantCurrentSource 恒流源组件。
 *
 * 作用：这是一个用于教学或仿真场景中的恒流源设备，能够在界面上显示当前设定的输出电流值，并提供
 * 接口给上层电路求解器读取该器件的输出参数。它本质上是一个带有显示屏和两个端子的电气组件，
 * 其中一个端子为 COM，另一个端子为 OUT，通常用于向外部负载提供稳定的电流输出。
 *
 * 设计特点：
 * 1. 使用 BaseComponent 提供的统一基类能力，包括缓存、端口、交互、配置对话框等；
 * 2. 通过文本显示当前流值，便于用户在仿真画面中直接观察；
 * 3. 支持电流数值和单位的配置更新，适合不同教学场景的参数展示；
 * 4. 在仿真循环中实时刷新显示值，确保画面和器件状态保持一致。
 */
import { BaseComponent } from './BaseComponent.js';

export class ConstantCurrentSource extends BaseComponent {
    constructor(config, sys) {
        // 调用父类构造函数，完成组件公共初始化，例如系统引用、group、draggable 等基础能力。
        super(config, sys);
        // 初始化组件的三层图形分组：静态层、动态层、交互层。
        this._initGroups();

        // 设置恒流源的默认外观尺寸，宽度和高度决定了设备在画布中的占位和布局。
        this.width = 200;
        this.height = 80;
        // 组件类型用于系统识别其功能类别，便于后续求解器或工作流识别器识别该器件。
        this.type = 'cc_source';
        // 固定缓存模式表示该器件的静态部分采用缓存提升性能，减少不必要的重绘。
        this.cache = 'fixed';

        // 从配置对象中读取设定的电流值，若无值则使用默认 0.001 A（1 mA）。
        this.currentValue = parseFloat(config.currentValue) || 0.001;
        // 单位字典默认使用 mA，表示显示时按毫安显示。
        this.unitLabel = config.unitLabel || 'mA';
        // 根据当前单位换算实际显示值：mA 时乘 1000，µA 时乘 1000000，以保证显示数值具有可读性。
        this.displayValue = this.currentValue * (this.unitLabel === 'mA' ? 1000 : 1000000);
        // 依次绘制主体外壳和端子部分。
        this._drawBody();
        this._drawTerminals();

        // 添加两个输入/输出端口：COM 作为公共端，OUT 作为输出端，且输出端极性标记为正极。
        this.addPort(30, this.height, 'com', 'wire');
        this.addPort(170, this.height, 'i1', 'wire', 'p');

        // 保存组件配置快照，便于后续更新和恢复。
        this.config = { id: this.id, currentValue: this.currentValue, unitLabel: this.unitLabel };
    }

    _drawBody() {
        // 绘制恒流源外壳，形成一个矩形的设备主体，供用户识别该模块为稳定电流源。
        this._staticGroup.add(new Konva.Rect({
            x: 0, y: 0, width: this.width, height: this.height,
            fill: '#ecf0f1', stroke: '#2c3e50', strokeWidth: 2, cornerRadius: 6,
        }));

        // 在面板顶部绘制标签“恒流源”，用于说明该模块的功能语义。
        this._staticGroup.add(new Konva.Text({
            x: 10, y: 6, text: '恒流源', fontSize: 16,
            fill: '#333', fontStyle: 'bold',
        }));

        // 创建动态文本对象，用于显示当前设定电流值，放到动态层中便于运行时更新。
        this._valueText = new Konva.Text({
            x: 10, y: 30, text: this.displayValue.toFixed(1) + ' ' + this.unitLabel,
            fontSize: 20, fill: '#2980b9', fontStyle: 'bold', fontFamily: 'Courier New',
        });
        this._dynamicGroup.add(this._valueText);

        // 在右上角添加厂商或机构标识，增加设备真实感，但不影响主功能。
        this._staticGroup.add(new Konva.Text({
            x: this.width - 60, y: 6, text: '江苏航院',
            fontSize: 12, fill: '#999',
        }));
    }

    _drawTerminals() {
        // 左侧 COM 端子：圆形端口主体，表示公共端，可作为回路参考点。
        this._staticGroup.add(new Konva.Circle({
            x: 30, y: this.height, radius: 6,
            fill: '#bbb', stroke: '#333', strokeWidth: 1,
        }));
        // 在端子中间增加白色小圆点，形成“孔位”或“连接点”的视觉效果。
        this._staticGroup.add(new Konva.Circle({
            x: 30, y: this.height, radius: 2.5, fill: '#fff',
        }));
        // 在端口上方添加 COM 字样，方便用户识别端子的功能。
        this._staticGroup.add(new Konva.Text({
            x: 15, y: this.height - 16, width: 30, text: 'COM',
            fontSize: 10, fill: '#e74c3c', align: 'center', fontStyle: 'bold',
        }));

        // 右侧 OUT 端子：表示输出端，通常连接到负载端或电路输出节点。
        this._staticGroup.add(new Konva.Circle({
            x: 170, y: this.height, radius: 6,
            fill: '#bbb', stroke: '#333', strokeWidth: 1,
        }));
        this._staticGroup.add(new Konva.Circle({
            x: 170, y: this.height, radius: 2.5, fill: '#fff',
        }));
        this._staticGroup.add(new Konva.Text({
            x: 155, y: this.height - 16, width: 30, text: 'OUT',
            fontSize: 10, fill: '#2980b9', align: 'center', fontStyle: 'bold',
        }));
    }

    tick(dt) {
        // 在仿真循环中，若动态文本对象存在，则根据当前设置值重新计算显示值。
        if (this._valueText) {
            this.displayValue = this.currentValue * (this.unitLabel === 'mA' ? 1000 : 1000000);
            this._valueText.text(this.displayValue.toFixed(1) + ' ' + this.unitLabel);
        }
        // 标记组件已脏，通知渲染层刷新缓存或重绘。
        this.markDirty();
        // 仅在确实脏时刷新缓存，避免无效重复操作。
        this._refreshIfDirty();
    }

    getConfigFields() {
        // 返回配置对话框中需要展示的字段列表，供通用配置面板生成输入控件。
        return [
            { label: '名称', key: 'id', type: 'text' },
            { label: '电流值 (A)', key: 'currentValue', type: 'number' },
            { label: '单位', key: 'unitLabel', type: 'select',
              options: [{ label: 'mA', value: 'mA' }, { label: 'µA', value: 'µA' }] },
        ];
    }

    onConfigUpdate(cfg) {
        // 当配置中传入新电流值时，转为浮点数并更新器件状态。
        if (cfg.currentValue !== undefined) this.currentValue = parseFloat(cfg.currentValue);
        // 当单位变化时，同步更新显示格式。
        if (cfg.unitLabel !== undefined) this.unitLabel = cfg.unitLabel;
        // 合并本次配置到组件配置快照中，保留已有字段并覆盖新增字段。
        this.config = { ...this.config, ...cfg };
        // 刷新缓存，确保新的参数能反映到图像上。
        this._refreshCache();
    }

    // 对外公开当前设定的电流值，便于系统或求解器读取该组件的参数。
    getValue() { return this.currentValue; }

    // 销毁组件时调用父类释放逻辑，保证生命周期一致。
    destroy() { super.destroy?.(); }
}
