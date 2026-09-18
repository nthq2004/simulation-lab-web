/**
 * Zener 稳压二极管组件。
 *
 * 该组件用于在电路仿真图中表示稳压二极管，保存正向导通压降、反向稳压值、
 * 导通电阻和截止电阻等基础电气参数。图形采用二极管主体、带折线翼形的阴极
 * 标记和稳压值标签，用于突出稳压二极管在反向击穿区维持近似恒定电压的特性。
 * 组件还支持 reverse 方向配置，以适配不同电路图中的安装方向。
 *
 * 主要功能：
 * 1. 创建左右两个电气端口，表示稳压二极管的两端；
 * 2. 使用 vForward 描述正向导通压降，使用 vZener 描述反向稳压值；
 * 3. 使用 rOn 和 rOff 表示导通与截止状态下的等效电阻；
 * 4. 绘制带稳压二极管专用阴极标记的电路符号；
 * 5. 支持通过配置面板更新器件名称、正向压降和稳压值。
 */
import { BaseComponent } from './BaseComponent.js';

export class Zener extends BaseComponent {
    constructor(config, sys) {
        // 调用父类构造函数，初始化组件公共属性和系统引用。
        super(config, sys);
        // 保存器件方向配置，reverse 时旋转整个图形。
        this.direction = config.direction;
        // 设置组件类型，供仿真系统识别为稳压二极管。
        this.type = 'zener';
        // 静态符号启用固定缓存，减少重复绘制开销。
        this.cache = 'fixed';
        // 初始化静态、动态和交互图层容器。
        this._initGroups();

        // 读取正向导通压降，默认值为 0.7V。
        this.vForward = config.vForward !== undefined ? config.vForward : 0.7;
        // 读取反向稳压值，默认值为 5.1V。
        this.vZener = config.vZener !== undefined ? config.vZener : 5.1;
        // 设置稳压二极管导通状态下的等效电阻。
        this.rOn = 0.5;
        // 设置截止状态下的高等效电阻。
        this.rOff = 1e8;

        // 保存器件标识、正向压降和稳压值配置。
        this.config = {id:this.id, vForward:this.vForward, vZener:this.vZener};

        // 绘制稳压二极管符号和稳压值标签。
        this.initVisuals();
        // 创建左右两个电气端口。
        this.initPorts();

        // 反向安装时旋转组件，使符号方向与电路连接方向一致。
        if (this.direction === 'reverse') this.group.rotate(180);
    }

    initPorts() {
        // 左侧端口作为正向连接端，并使用 p 标记其极性。
        this.addPort(-40, 0, 'l', 'wire', 'p');
        // 右侧端口作为阴极侧连接端。
        this.addPort(40, 0, 'r', 'wire');
    }

    initVisuals() {
        // 设置稳压二极管符号的基础线条颜色。
        const stroke = '#000000';
        // 绘制左侧引线。
        this._staticGroup.add(new Konva.Line({ points: [-40, 0, -15, 0], stroke, strokeWidth: 2 }));

        // 绘制二极管主体三角形。
        const triangle = new Konva.Line({
            points: [-15, -13, -15, 13, 12, 0],
            closed: true,
            fill: '#ffffff',
            stroke: stroke,
            strokeWidth: 2
        });

        // 绘制稳压二极管阴极的竖直主线。
        const bar = new Konva.Line({
            points: [14, -19, 14, 19],
            stroke: stroke,
            strokeWidth: 3
        });

        // 绘制阴极上方的折线翼，形成稳压二极管特有的折线标记。
        const topWing = new Konva.Line({
            points: [14, -18, 26, -18],
            stroke: stroke,
            strokeWidth: 3
        });

        // 绘制阴极下方的折线翼，与上方翼共同表示稳压特性。
        const bottomWing = new Konva.Line({
            points: [2, 18, 14, 18],
            stroke: stroke,
            strokeWidth: 3
        });

        // 绘制右侧引线，将阴极标记连接到右侧电气端口。
        const rightLead = new Konva.Line({
            points: [17, 0, 40, 0],
            stroke: stroke,
            strokeWidth: 2
        });

        // 将主体、阴极标记和两侧引线加入静态图层。
        this._staticGroup.add(triangle,  bar, topWing, bottomWing, rightLead);

        // 创建显示当前反向稳压值的参数标签。
        this.paramLabel = new Konva.Text({
            x: -35, y: -40, width: 80,
            text: this.vZener.toFixed(1) + 'V',
            fontSize: 12, fill: '#e74c3c', fontStyle: 'bold',
            align: 'center', listening: false,
        });
    }

    getConfigFields() {
        // 配置面板开放器件名称、正向压降和反向稳压值。
        return [
            { label: '器件名称', key: 'id', type: 'text' },
            { label: '导通压降 (V)', key: 'vForward', type: 'number' },
            { label: '稳压值 (V)', key: 'vZener', type: 'number' }
        ];
    }
    onConfigUpdate(cfg) {
        // 更新器件标识。
        if (cfg.id !== undefined) {
            this.id = cfg.id;
        }
        // 更新正向导通压降。
        if (cfg.vForward !== undefined) {
            this.vForward = cfg.vForward;
        }
        // 更新稳压值并同步参数标签。
        if (cfg.vZener !== undefined) {
            this.vZener = cfg.vZener;
            this._updateLabel();
        }
        // 保存最新配置并刷新静态缓存。
        this.config = cfg;
        this._refreshCache();
    }

    _updateLabel() {
        // 预留稳压值标签更新入口，供运行时配置变更时同步界面显示。
    }

    destroy() {
        // 调用父类销毁逻辑，释放稳压二极管图形和相关资源。
        super.destroy?.();
    }
}
