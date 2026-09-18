/**
 * UJT 单结晶体管组件。
 *
 * 该组件用于表示单结晶体管（Unijunction Transistor），提供基极 1（B1）、基极 2（B2）
 * 和发射极（E）三个电气端口，并保存基极间电阻、内部分压比、发射极导通压降、
 * 导通/截止电阻以及维持电流等参数。图形使用横向基区、斜向发射极引线和箭头，
 * 适合用于松弛振荡器、触发电路和晶闸管控制原理教学。
 *
 * 主要功能：
 * 1. 创建 B1、B2 和 E 三个电气端口；
 * 2. 使用 rBB 和 eta 描述基区电阻及内部电位分布；
 * 3. 使用 vD、vOn、rOn、rOff 和 holdCurrent 保存发射极触发模型参数；
 * 4. 绘制带端子标签和发射极箭头的 UJT 电路符号；
 * 5. 支持通过配置面板更新器件名称和 UJT 等效参数。
 */
import { BaseComponent } from './BaseComponent.js';

export class UJT extends BaseComponent {
    constructor(config, sys) {
        // 调用父类构造函数，初始化组件公共属性和系统引用。
        super(config, sys);
        // 静态器件符号启用固定缓存。
        this.cache = 'fixed';
        // 创建静态、动态和交互图层容器。
        this._initGroups();
        // 设置组件类型，供仿真系统识别为单结晶体管。
        this.type = 'ujt';

        // 设置基极间电阻 RBB。
        this.rBB = 5000;
        // 设置内部电位分压比 eta。
        this.eta = 0.63;
        // 设置发射极二极管的正向压降。
        this.vD = 0.6;
        // 设置发射极导通状态下的等效电阻。
        this.rOn = 15;
        // 设置发射极截止状态下的高等效电阻。
        this.rOff = 1e8;
        // 设置发射极导通压降或触发后的等效压降。
        this.vOn = 1.5;
        // 设置维持电流，用于判断发射极导通状态保持条件。
        this.holdCurrent = 0.005;
        // 记录 UJT 当前是否已经触发。
        this._triggered = false;

        // 保存器件标识、分压比和基极间电阻配置。
        this.config = { id: this.id, eta: this.eta, rBB: this.rBB };

        // 创建 B1、B2 和 E 三个电气端口。
        this.initPorts();
        // 绘制 UJT 静态符号。
        this.initVisuals();
    }

    initPorts() {
        // 创建左侧基极 1 端口。
        this.addPort(-40, 0, 'b1', 'wire');
        // 创建右侧基极 2 端口，并标记为正向连接端。
        this.addPort(40, 0, 'b2', 'wire', 'p');
        // 创建下方发射极端口。
        this.addPort(0, 35, 'e', 'wire');
    }

    initVisuals() {
        // 统一设置 UJT 符号的线条颜色。
        const s = '#000000';

        // 绘制基极 1 侧引线。
        this._staticGroup.add(new Konva.Line({ points: [-40, 0, -25, 0], stroke: s, strokeWidth: 2 }));
        // 绘制基极 2 侧引线。
        this._staticGroup.add(new Konva.Line({ points: [25, 0, 40, 0], stroke: s, strokeWidth: 2 }));

        // 绘制横向基区，表示 B1 与 B2 之间的内部电阻通道。
        const bar = new Konva.Line({
            points: [-25, 0, 25, 0],
            stroke: s,
            strokeWidth: 3,
        });

        // 绘制从基区斜向引出的发射极导线。
        const emitterLead = new Konva.Line({
            points: [0, 0, -10, 20, 0, 35],
            stroke: s,
            strokeWidth: 2,
        });

        // 绘制发射极箭头，表示 UJT 的单向发射极特征。
        const arrow = new Konva.Line({
            points: [-10, 10, -4, 14, -10, 18],
            closed: true,
            fill: s,
            stroke: s,
            strokeWidth: 1,
        });

        // 将基极、发射极和箭头图形加入静态图层。
        this._staticGroup.add(bar, emitterLead, arrow);

        // 设置 B1、B2、E 端子标签的统一样式。
        const lbl = { fontSize: 12, fill: '#333333', fontFamily: 'Arial', fontStyle: 'bold' };
        // 标注基极 1。
        this._staticGroup.add(new Konva.Text({ x: -50, y: -16, text: 'B1', ...lbl }));
        // 标注基极 2。
        this._staticGroup.add(new Konva.Text({ x: 32, y: -16, text: 'B2', ...lbl }));
        // 标注发射极。
        this._staticGroup.add(new Konva.Text({ x: -22, y: 26, text: 'E', ...lbl }));
    }

    getConfigFields() {
        // 配置面板开放 UJT 的名称、基区参数、发射极参数和维持电流。
        return [
            { label: '器件名称', key: 'id', type: 'text' },
            { label: '分压比 η', key: 'eta', type: 'number' },
            { label: '基极电阻 RBB (Ω)', key: 'rBB', type: 'number' },
            { label: '发射极导通电阻 (Ω)', key: 'rOn', type: 'number' },
            { label: '发射极关断电阻 (Ω)', key: 'rOff', type: 'number' },
            { label: '发射极导通压降 (V)', key: 'vOn', type: 'number' },
            { label: '维持电流 (A)', key: 'holdCurrent', type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        // 更新器件标识。
        if (cfg.id !== undefined) this.id = cfg.id;
        // 更新基区内部分压比。
        if (cfg.eta !== undefined) this.eta = cfg.eta;
        // 更新基极间电阻。
        if (cfg.rBB !== undefined) this.rBB = cfg.rBB;
        // 更新发射极导通电阻。
        if (cfg.rOn !== undefined) this.rOn = cfg.rOn;
        // 更新发射极截止电阻。
        if (cfg.rOff !== undefined) this.rOff = cfg.rOff;
        // 更新发射极导通压降。
        if (cfg.vOn !== undefined) this.vOn = cfg.vOn;
        // 更新维持电流参数。
        if (cfg.holdCurrent !== undefined) this.holdCurrent = cfg.holdCurrent;
        // 保存最新配置并刷新固定缓存。
        this.config = cfg;
        this._refreshCache();
    }

    destroy() {
        // 调用父类销毁逻辑，释放 UJT 图形和相关资源。
        super.destroy?.();
    }
}
