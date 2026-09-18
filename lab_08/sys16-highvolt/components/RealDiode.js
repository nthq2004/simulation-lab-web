/**
 * RealDiode 真实二极管组件。
 *
 * 该组件用于在电路仿真画布中表示具有实体封装外观的二极管。它保存正向导通压降、
 * 导通电阻和截止电阻等基础电气参数，并通过左侧引线、黑色器件本体和右侧阴极环
 * 体现二极管的方向性。组件还提供测试标志：在考核或测试场景下，可以隐藏正向压降
 * 标签，避免用户直接看到器件提示信息。
 *
 * 主要功能：
 * 1. 创建带正极标记的左端口和阴极侧右端口；
 * 2. 使用 vForward、rOn 和 rOff 描述二极管的等效电气特性；
 * 3. 绘制实体二极管封装、引线、阴极环和正向压降标签；
 * 4. 支持通过 testFlag 显示或隐藏正向压降提示；
 * 5. 正向压降更新时通过事件总线通知其他系统模块。
 */
import { BaseComponent } from './BaseComponent.js';

export class RealDiode extends BaseComponent {
    constructor(config, sys) {
        // 调用父类构造函数，初始化组件公共属性和系统引用。
        super(config, sys);
        // 设置组件类型，供仿真系统识别为二极管。
        this.type = 'diode';
        // 实体外观主要为静态内容，因此启用固定缓存。
        this.cache = 'fixed';
        // 初始化静态、动态和交互图层容器。
        this._initGroups();

        // 读取二极管正向导通压降，默认值为 0.68V。
        this.vForward = config.vForward || 0.68;
        // 设置二极管导通时的等效电阻。
        this.rOn = 0.5;
        // 设置二极管截止时的高等效电阻。
        this.rOff = 1e8;
        // 测试标志：为真时隐藏管压降标签，供考核/测试使用
        this.testFlag = config.testFlag || false;

        // 保存器件标识、正向压降和测试标志配置。
        this.config = { id: this.id, vForward: this.vForward, testFlag: this.testFlag };

        // 绘制二极管实体外观和正向压降标签。
        this.initVisuals();
        // 创建左右两个电气端口。
        this.initPorts();
    }

    initPorts() {
        // 左侧端口作为二极管正极，并使用 p 标识其极性。
        this.addPort(-40, 0, 'l', 'wire', 'p');
        // 右侧端口作为阴极侧连接端。
        this.addPort(40, 0, 'r', 'wire');
    }

    initVisuals() {
        // 定义二极管外壳、阴极环、引线和标记的显示颜色。
        const colors = {
            body: '#1a1a1a',
            ring: '#e8e8e8',
            lead: '#aeb6bf',
            marking: '#ccc',
        };

        // 绘制左侧金属引线。
        const leadL = new Konva.Line({
            points: [-40, 0, -25, 0],
            stroke: colors.lead, strokeWidth: 3, lineCap: 'round'
        });
        // 绘制右侧金属引线。
        const leadR = new Konva.Line({
            points: [25, 0, 40, 0],
            stroke: colors.lead, strokeWidth: 3, lineCap: 'round'
        });

        // 绘制黑色实体封装外壳。
        this.body = new Konva.Rect({
            x: -25, y: -9,
            width: 50, height: 18,
            fill: colors.body,
            cornerRadius: 3,
            stroke: '#333',
            strokeWidth: 1
        });

        // 在右侧绘制浅色阴极环，表示二极管阴极位置。
        this.cathodeRing = new Konva.Rect({
            x: 17, y: -9,
            width: 8, height: 18,
            fill: colors.ring,
            cornerRadius: [0, 3, 3, 0],
            opacity: 0.9
        });

        // 在阴极环上叠加竖线标记，进一步突出二极管方向。
        const cathodeMark = new Konva.Text({
            x: 17, y: -10,
            text: '|',
            fontSize: 18,
            fontStyle: 'bold',
            fill: '#1a1a1a',
            width: 8,
            align: 'center',
            listening: false
        });

        // 创建显示当前正向导通压降的标签。
        this.vfLabel = new Konva.Text({
            x: -25, y: -30, width: 50,
            text: this.vForward.toFixed(3) + 'V',
            fontSize: 10,
            fill: '#e74c3c',
            fontStyle: 'bold',
            align: 'center',
            listening: false
        });

        // 将实体外观和参数标签加入静态图层。
        this._staticGroup.add(leadL, leadR, this.body, this.cathodeRing, cathodeMark, this.vfLabel);

        // 保存需要受测试标志控制的标签节点。
        this._testLabels = [this.vfLabel];
        // 根据初始测试标志决定标签是否可见。
        this._applyTestFlag();
    }

    getConfigFields() {
        // 配置面板开放器件名称和正向导通压降。
        return [
            { label: '器件名称', key: 'id', type: 'text' },
            { label: '导通压降 (V)', key: 'vForward', type: 'number' }
        ];
    }

    onConfigUpdate(cfg) {
        // 如果配置包含新 ID，则同步更新组件标识。
        if (cfg.id !== undefined) {
            this.id = cfg.id;
        }
        // 更新正向压降、标签，并向事件总线发送变化通知。
        if (cfg.vForward !== undefined) {
            this.vForward = cfg.vForward;
            this._updateVfLabel();
            if (this.sys && this.sys.eventBus) {
                this.sys.eventBus.emit('diode:vfChanged', { id: this.id, vForward: cfg.vForward });
            }
        }
        // 更新测试标志并重新应用标签可见性。
        if (cfg.testFlag !== undefined) this.testFlag = !!cfg.testFlag;
        this._applyTestFlag();
        // 保存最新配置并刷新静态缓存。
        this.config = cfg;
        this._refreshCache();
    }

    _applyTestFlag() {
        // 测试模式下隐藏所有受控标签，普通模式下恢复显示。
        const nodes = this._testLabels || [];
        nodes.forEach(n => { if (n) n.visible(!this.testFlag); });
    }

    setTestFlag(v) {
        // 将外部传入值转换为布尔值，避免重复设置相同状态。
        v = !!v;
        if (this.testFlag === v) return;
        this.testFlag = v;
        // 更新标签可见性并刷新静态缓存。
        this._applyTestFlag();
        this._refreshCache();
    }

    _updateVfLabel() {
        // 根据最新正向压降更新标签文字，并标记组件需要重绘。
        if (this.vfLabel) {
            this.vfLabel.text(this.vForward.toFixed(3) + 'V');
            this.markDirty();
        }
    }

    destroy() {
        // 调用父类销毁逻辑，释放二极管图形和相关资源。
        super.destroy?.();
    }
}
