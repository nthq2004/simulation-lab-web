/**
 * RealDIAC 双向触发二极管组件。
 *
 * 该组件用于表示 DIAC 双向触发器件，常用于双向晶闸管或调光控制电路的触发部分。
 * DIAC 在正向或反向电压达到转折电压后进入导通状态，因此组件保存转折电压、
 * 导通电阻和截止电阻等基本参数。图形采用 DB3 器件标识、左右引线和两侧不同颜色
 * 的条带，帮助用户识别其双向触发特性。
 *
 * 主要功能：
 * 1. 创建左右两个电气端口，表示 DIAC 的双向连接端；
 * 2. 使用 vBreakover 保存正反向共用的转折电压；
 * 3. 使用 rOn 和 rOff 表示导通与截止时的等效电阻；
 * 4. 绘制带 DB3 标识和双色条带的 DIAC 外观；
 * 5. 支持通过配置面板更新器件名称和转折电压。
 */
import { BaseComponent } from './BaseComponent.js';

export class RealDIAC extends BaseComponent {
    constructor(config, sys) {
        // 调用父类构造函数，初始化组件公共属性和系统引用。
        super(config, sys);
        // 设置组件类型，供仿真系统识别为 DIAC 器件。
        this.type = 'diac';
        // 静态器件图形启用固定缓存，减少重复绘制开销。
        this.cache = 'fixed';
        // 初始化静态、动态和交互图层容器。
        this._initGroups();

        // 读取 DIAC 转折电压，未配置时使用 30V 默认值。
        this.vBreakover = config.vBreakover || 30;
        // 设置 DIAC 导通时的等效电阻。
        this.rOn = 5;
        // 设置 DIAC 截止时的高等效电阻。
        this.rOff = 1e8;

        // 保存组件标识和转折电压配置。
        this.config = { id: this.id, vBreakover: this.vBreakover };

        // 绘制 DIAC 静态符号、颜色条带和参数标签。
        this.initVisuals();
        // 创建左右两个电气端口。
        this.initPorts();
    }

    initPorts() {
        // 左侧端口作为带正极标记的连接端。
        this.addPort(-40, 0, 'l', 'wire', 'p');
        // 右侧端口作为另一侧双向连接端。
        this.addPort(40, 0, 'r', 'wire');
    }

    initVisuals() {
        // 定义器件主体、双色条带和引线的显示颜色。
        const colors = {
            body: '#2c3e50',
            stripe1: '#e74c3c',
            stripe2: '#3498db',
            lead: '#aeb6bf',
        };

        // 绘制左侧金属引线。
        const leadL = new Konva.Line({
            points: [-40, 0, -20, 0],
            stroke: colors.lead, strokeWidth: 3, lineCap: 'round'
        });
        // 绘制右侧金属引线。
        const leadR = new Konva.Line({
            points: [20, 0, 40, 0],
            stroke: colors.lead, strokeWidth: 3, lineCap: 'round'
        });

        // 绘制 DIAC 深色主体外壳。
        this.body = new Konva.Rect({
            x: -20, y: -6,
            width: 40, height: 12,
            fill: colors.body,
            cornerRadius: 2,
            stroke: '#222',
            strokeWidth: 1
        });

        // 绘制主体左侧红色条带，表示器件的一侧触发标识。
        this.stripe1 = new Konva.Rect({
            x: -20, y: -6,
            width: 8, height: 12,
            fill: colors.stripe1,
            cornerRadius: [2, 0, 0, 2],
            listening: false
        });

        // 绘制主体右侧蓝色条带，与左侧形成双向器件的双色标识。
        this.stripe2 = new Konva.Rect({
            x: 12, y: -6,
            width: 8, height: 12,
            fill: colors.stripe2,
            cornerRadius: [0, 2, 2, 0],
            listening: false
        });

        // 在器件主体中标注常见的 DB3 型号。
        const modelText = new Konva.Text({
            x: -10, y: -4,
            text: 'DB3',
            fontSize: 10,
            fill: '#fff',
            listening: false
        });

        // 在器件上方显示当前转折电压。
        this.paramLabel = new Konva.Text({
            x: -25, y: -25, width: 50,
            text: this.vBreakover.toFixed(0) + 'V',
            fontSize: 10,
            fill: '#e74c3c',
            fontStyle: 'bold',
            align: 'center',
            listening: false
        });

        // 将引线、主体、双色条带、型号文字和参数标签加入静态图层。
        this._staticGroup.add(leadL, leadR, this.body, this.stripe1, this.stripe2, modelText, this.paramLabel);
    }

    getConfigFields() {
        // 配置面板开放器件名称和转折电压两个参数。
        return [
            { label: '器件名称', key: 'id', type: 'text' },
            { label: '转折电压 (V)', key: 'vBreakover', type: 'number' }
        ];
    }

    onConfigUpdate(cfg) {
        // 如果配置包含新 ID，则同步更新组件标识。
        if (cfg.id !== undefined) {
            this.id = cfg.id;
        }
        // 更新转折电压，并同步参数标签。
        if (cfg.vBreakover !== undefined) {
            this.vBreakover = cfg.vBreakover;
            this._updateLabel();
        }
        // 保存最新配置对象并刷新静态缓存。
        this.config = cfg;
        this._refreshCache();
    }

    _updateLabel() {
        // 配置改变后更新标签文字，并标记组件需要重绘。
        if (this.paramLabel) {
            this.paramLabel.text(this.vBreakover.toFixed(0) + 'V');
            this.markDirty();
        }
    }

    destroy() {
        // 调用父类销毁逻辑，释放组件图形和相关资源。
        super.destroy?.();
    }
}
