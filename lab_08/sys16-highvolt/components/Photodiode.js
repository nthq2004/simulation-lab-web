/**
 * Photodiode 光电二极管组件。
 *
 * 该组件用于在电路仿真图中表示光电二极管，除了具有普通二极管的正向压降、
 * 导通电阻和截止电阻参数外，还保存光生电流参数，用于描述光照作用下产生的
 * 反向光电流。图形使用二极管三角形、阴极挡板以及射入符号表示器件的光敏特性。
 *
 * 主要功能：
 * 1. 创建左右两个电气端口，分别表示光电二极管的正向和反向连接端；
 * 2. 支持 direction 参数控制器件符号的显示方向；
 * 3. 保存正向压降、光生电流、导通电阻和截止电阻等电气参数；
 * 4. 绘制带入射光箭头的光电二极管标准化符号；
 * 5. 提供器件名称、导通压降和光生电流配置项。
 */
import { BaseComponent } from './BaseComponent.js';

export class Photodiode extends BaseComponent {
    constructor(config, sys) {
        // 调用父类构造函数，初始化组件公共属性和系统引用。
        super(config, sys);
        // 保存器件方向，reverse 配置会将图形旋转 180 度。
        this.direction = config.direction;
        // 设置组件类型，供仿真系统识别为光电二极管。
        this.type = 'photodiode';
        // 静态符号采用固定缓存，减少重复绘制开销。
        this.cache = 'fixed';
        // 初始化静态、动态和交互图层。
        this._initGroups();

        // 读取正向导通压降，未配置时使用 0.7V 默认值。
        this.vForward = config.vForward !== undefined ? config.vForward : 0.7;
        // 读取光生电流，未配置时默认为 0μA。
        this.photoCurrent = config.photoCurrent || 0;
        // 设置二极管导通时的等效电阻。
        this.rOn = 0.5;
        // 设置二极管截止时的高等效电阻。
        this.rOff = 1e8;

        // 保存组件 ID、正向压降和光生电流配置。
        this.config = {id:this.id, vForward:this.vForward, photoCurrent:this.photoCurrent};

        // 绘制光电二极管符号及参数标签。
        this.initVisuals();
        // 创建左右两个电气端口。
        this.initPorts();

        // 反向安装时旋转整个组件，保持符号方向与接线方向一致。
        if (this.direction === 'reverse') this.group.rotate(180);
    }

    initPorts() {
        // 左侧端口作为正向端，并标记为正极连接端。
        this.addPort(-40, 0, 'l', 'wire', 'p');
        // 右侧端口作为另一侧电气连接端。
        this.addPort(40, 0, 'r', 'wire');
    }

    initVisuals() {
        // 统一设置光电二极管电路符号的线条颜色。
        const stroke = '#000000';
        // 绘制器件左侧引线。
        this._staticGroup.add(new Konva.Line({ points: [-40, 0, -15, 0], stroke, strokeWidth: 2 }));
        // 绘制器件右侧引线。
        this._staticGroup.add(new Konva.Line({ points: [15, 0, 40, 0], stroke, strokeWidth: 2 }));

        // 绘制光电二极管主体的三角形区域。
        const triangle = new Konva.Line({
            points: [-15, -15, -15, 15, 15, 0],
            closed: true,
            fill: '#ffffff',
            stroke: stroke,
            strokeWidth: 2
        });

        // 绘制二极管阴极挡板。
        const bar = new Konva.Line({
            points: [15, -15, 15, 15],
            stroke: stroke,
            strokeWidth: 3
        });

        // 绘制指向二极管主体的入射光线。
        const arrowIn = new Konva.Line({
            points: [28, -8, 35, -15, 42, -8],
            closed: false,
            stroke: stroke,
            strokeWidth: 2,
            tension: 0
        });

        // 绘制入射光线末端的箭头，使光照方向更加明确。
        const arrowHead = new Konva.Line({
            points: [35, -15, 38, -10, 35, -12, 32, -10],
            closed: true,
            fill: stroke,
            stroke: stroke,
            strokeWidth: 1
        });

        // 将二极管主体、阴极挡板和光照箭头加入静态图层。
        this._staticGroup.add(triangle, bar, arrowIn, arrowHead);

        // 创建光生电流参数标签，仅在光生电流大于零时显示数值。
        this.paramLabel = new Konva.Text({
            x: -35, y: -40, width: 80,
            text: this.photoCurrent > 0 ? this.photoCurrent.toFixed(0) + 'μA' : '',
            fontSize: 12, fill: '#e74c3c', fontStyle: 'bold',
            align: 'center', listening: false,
        });
    }

    getConfigFields() {
        // 配置面板开放器件名称、正向压降和光生电流三个参数。
        return [
            { label: '器件名称', key: 'id', type: 'text' },
            { label: '导通压降 (V)', key: 'vForward', type: 'number' },
            { label: '光生电流 (μA)', key: 'photoCurrent', type: 'number' }
        ];
    }
    onConfigUpdate(cfg) {
        // 如果配置包含新 ID，则同步更新组件标识。
        if (cfg.id !== undefined) {
            this.id = cfg.id;
        }
        // 更新二极管的正向导通压降。
        if (cfg.vForward !== undefined) {
            this.vForward = cfg.vForward;
        }
        // 更新光生电流，并刷新对应的参数标签。
        if (cfg.photoCurrent !== undefined) {
            this.photoCurrent = cfg.photoCurrent;
            this._updateLabel();
        }
        // 保存最新配置并刷新静态缓存。
        this.config = cfg;
        this._refreshCache();
    }

    _updateLabel() {
        // 预留光生电流标签更新入口，供运行时参数变化时同步界面显示。
    }

    destroy() {
        // 调用父类销毁逻辑，释放组件图形和相关资源。
        super.destroy?.();
    }
}
