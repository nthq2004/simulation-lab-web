/**
 * Phototransistor 光电晶体管组件。
 *
 * 该组件用于在电路仿真图中表示光电晶体管，提供集电极 C、发射极 E 和基极 B
 * 三个电气端口，并保存电流放大倍数、光生电流、饱和压降以及导通/截止电阻等
 * 基础参数。图形采用晶体管圆形外框和入射光箭头，直观表达光照对晶体管导通
 * 能力的影响，适合用于光电转换和传感器原理教学。
 *
 * 主要功能：
 * 1. 创建 C、E、B 三个带有端子属性标识的电气端口；
 * 2. 使用 beta 保存晶体管电流放大倍数；
 * 3. 使用 photoCurrent 保存光照产生的附加电流；
 * 4. 绘制集电极、发射极、基极、发射极箭头和入射光箭头；
 * 5. 支持通过配置面板更新器件名称、放大倍数和光生电流。
 */
import { BaseComponent } from './BaseComponent.js';

export class Phototransistor extends BaseComponent {
    constructor(config, sys) {
        // 调用父类构造函数，初始化组件公共属性和系统引用。
        super(config, sys);
        // 光电晶体管的主要图形为静态内容，因此启用固定缓存。
        this.cache = 'fixed';
        // 创建静态图层、动态图层和交互图层容器。
        this._initGroups();
        // 设置组件类型，供仿真系统识别为光电晶体管。
        this.type = 'phototransistor';

        // 读取晶体管电流放大倍数，未配置时使用 200 倍。
        this.beta = config.beta || 200;
        // 读取光生电流，未配置时默认为 0μA。
        this.photoCurrent = config.photoCurrent || 0;
        // 设置晶体管进入饱和区时的集电极-发射极电压。
        this.vceSat = 0.3;
        // 设置器件导通状态下的等效电阻。
        this.rOn = 50;
        // 设置器件截止状态下的高等效电阻。
        this.rOff = 1e8;

        // 保存器件标识、放大倍数和光生电流配置。
        this.config = { id: this.id, beta: this.beta, photoCurrent: this.photoCurrent };

        // 绘制光电晶体管静态符号。
        this.initVisuals();
        // 创建集电极、发射极和基极三个电气端口。
        this.initPorts();
    }

    initPorts() {
        // 创建位于左上方的集电极端口，并标记其端子属性。
        this.addPort(-30, -40, 'c', 'wire', 'c');
        // 创建位于左下方的发射极端口，并标记其端子属性。
        this.addPort(-30, 40, 'e', 'wire', 'e');
        // 创建位于右侧的基极端口，并标记其端子属性。
        this.addPort(30, 0, 'b', 'wire', 'b');
    }

    initVisuals() {
        // 统一设置晶体管符号的基础线条颜色。
        const s = '#000000';

        // 绘制光电晶体管的圆形外框。
        const circle = new Konva.Circle({
            x: 0, y: 0, radius: 28,
            stroke: s, strokeWidth: 2, fill: '#ffffff'
        });

        // 绘制晶体管基极竖线。
        const baseBar = new Konva.Line({
            points: [8, -14, 8, 14],
            stroke: s, strokeWidth: 3
        });

        // 绘制从基极区域连接到集电极端子的引线。
        const cLine = new Konva.Line({
            points: [8, -8, -18, -25, -30, -40],
            stroke: s, strokeWidth: 2
        });
        // 绘制从基极区域连接到发射极端子的引线。
        const eLine = new Konva.Line({
            points: [8, 8, -18, 25, -30, 40],
            stroke: s, strokeWidth: 2
        });
        // 绘制右侧基极引线。
        const bLine = new Konva.Line({
            points: [8, 0, 30, 0],
            stroke: s, strokeWidth: 2
        });

        // 绘制晶体管发射极箭头，表示传统晶体管的电流方向特征。
        const arrow = new Konva.Arrow({
            points: [-2, 16, -14, 22],
            pointerLength: 6,
            pointerWidth: 5,
            fill: s,
            stroke: s,
            strokeWidth: 1
        });

        // 绘制第一条橙色入射光箭头，表示光照作用方向。
        const lightArrow1 = new Konva.Arrow({
            points: [24, -18, 16, -10],
            pointerLength: 5,
            pointerWidth: 4,
            fill: '#e67e22',
            stroke: '#e67e22',
            strokeWidth: 1.5
        });
        // 绘制第二条橙色入射光箭头，增强光敏器件的视觉识别效果。
        const lightArrow2 = new Konva.Arrow({
            points: [26, -12, 16, -6],
            pointerLength: 5,
            pointerWidth: 4,
            fill: '#e67e22',
            stroke: '#e67e22',
            strokeWidth: 1.5
        });

        // 将外框、端子引线、发射极箭头和入射光箭头加入静态图层。
        this._staticGroup.add(circle, baseBar, cLine, eLine, bLine, arrow, lightArrow1, lightArrow2);

        // 统一设置 C、E、B 端子标签的显示样式。
        const lbl = { fontSize: 11, fill: '#c0392b', fontFamily: 'Arial', fontStyle: 'bold' };
        // 标注集电极 C。
        this._staticGroup.add(new Konva.Text({ x: -44, y: -56, text: 'C', ...lbl }));
        // 标注发射极 E。
        this._staticGroup.add(new Konva.Text({ x: -44, y: 36, text: 'E', ...lbl }));
        // 标注基极 B。
        this._staticGroup.add(new Konva.Text({ x: 20, y: -14, text: 'B', ...lbl }));
    }

    getConfigFields() {
        // 配置面板开放器件名称、电流放大倍数和光生电流三个参数。
        return [
            { label: '器件名称', key: 'id', type: 'text' },
            { label: '放大倍数 β', key: 'beta', type: 'number' },
            { label: '光生电流 (μA)', key: 'photoCurrent', type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        // 配置包含新 ID 时，同步更新组件标识。
        if (cfg.id !== undefined) this.id = cfg.id;
        // 更新晶体管的电流放大倍数。
        if (cfg.beta !== undefined) this.beta = cfg.beta;
        // 更新光照产生的附加电流参数。
        if (cfg.photoCurrent !== undefined) this.photoCurrent = cfg.photoCurrent;
        // 保存最新配置对象。
        this.config = cfg;
        // 刷新固定缓存，使配置相关显示及时生效。
        this._refreshCache();
    }

    destroy() {
        // 调用父类销毁逻辑，释放组件图形和相关资源。
        super.destroy?.();
    }
}
