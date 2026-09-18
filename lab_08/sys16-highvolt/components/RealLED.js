/**
 * RealLED 真实发光二极管组件。
 *
 * 该组件用于仿真带实体透镜外观的 LED，支持红、绿、黄、蓝、白、橙六种颜色。
 * LED 根据物理电流的大小逐步调整光晕、透镜透明度和高光效果；当过大电流持续
 * 若干个仿真帧后，组件进入烧毁状态，关闭光晕并显示故障标记。组件同时保存
 * 正向导通压降、导通电阻和截止电阻等电气参数。
 *
 * 主要功能：
 * 1. 通过颜色映射表统一管理透镜、光晕、高光和标签颜色；
 * 2. 创建左右两个电气端口，表示 LED 的正负连接端；
 * 3. 根据物理电流平滑计算亮度，并更新动态发光外观；
 * 4. 根据持续过流帧数判断 LED 是否烧毁；
 * 5. 支持运行时修改正向压降和 LED 颜色。
 */
import { BaseComponent } from './BaseComponent.js';

// 每种 LED 颜色对应透镜、光晕、高光、标签以及中文名称。
const COLOR_MAP = {
    red:    { lens: '#e74c3c', glow: '#e74c3c', highlight: '#ffcccc', label: '#e74c3c', name: '红色' },
    green:  { lens: '#2ecc71', glow: '#2ecc71', highlight: '#a8e6cf', label: '#2ecc71', name: '绿色' },
    yellow: { lens: '#f1c40f', glow: '#f1c40f', highlight: '#f9e79f', label: '#d4ac0d', name: '黄色' },
    blue:   { lens: '#3498db', glow: '#3498db', highlight: '#aed6f1', label: '#3498db', name: '蓝色' },
    white:  { lens: '#f0f0f0', glow: '#ffffff', highlight: '#ffffff', label: '#888',     name: '白色' },
    orange: { lens: '#e67e22', glow: '#e67e22', highlight: '#f5b07c', label: '#e67e22', name: '橙色' },
};

export class RealLED extends BaseComponent {
    constructor(config, sys) {
        // 调用父类构造函数，初始化组件公共属性和系统引用。
        super(config, sys);
        // 设置组件类型，供仿真系统识别为 LED。
        this.type = 'led';
        // 静态引线和外壳图形启用固定缓存。
        this.cache = 'fixed';
        // 初始化静态、动态和交互图层。
        this._initGroups();

        // 读取 LED 正向导通压降，默认值为 2.0V。
        this.vForward = config.vForward || 2.0;
        // 设置 LED 导通时的等效电阻。
        this.rOn = 0.5;
        // 设置 LED 截止时的高等效电阻。
        this.rOff = 1e8;
        // 读取 LED 颜色，未配置或无效时由颜色访问器回退到红色。
        this.ledColor = config.ledColor || 'red';
        // 初始化显示亮度。
        this._brightness = 0;
        // 记录 LED 是否已经烧毁。
        this._burnedOut = false;
        // 记录持续过流的仿真帧数。
        this._burnOutFrames = 0;

        // 保存器件标识、正向压降和颜色配置。
        this.config = { id: this.id, vForward: this.vForward, ledColor: this.ledColor };

        // 绘制静态引线、动态透镜和参数标签。
        this.initVisuals();
        // 创建左右两个电气端口。
        this.initPorts();
    }

    initPorts() {
        // 左端作为 LED 正极，并使用 p 标记其极性。
        this.addPort(-40, 0, 'l', 'wire', 'p');
        // 右端作为 LED 另一侧连接端。
        this.addPort(40, 0, 'r', 'wire');
    }

    get _color() {
        // 返回当前颜色配置；找不到对应颜色时默认使用红色配置。
        return COLOR_MAP[this.ledColor] || COLOR_MAP.red;
    }

    initVisuals() {
        // 读取当前 LED 颜色，用于创建参数标签和动态发光节点。
        const c = this._color;

        // 绘制左侧金属引线。
        this._staticGroup.add(new Konva.Line({
            points: [-40, 0, -14, 0],
            stroke: '#aeb6bf', strokeWidth: 3, lineCap: 'round'
        }));
        // 绘制右侧金属引线。
        this._staticGroup.add(new Konva.Line({
            points: [14, 0, 40, 0],
            stroke: '#aeb6bf', strokeWidth: 3, lineCap: 'round'
        }));

        // 创建会随电流变化的光晕、透镜和高光节点。
        this._buildDynamicParts();

        // 创建烧毁斜线标记，正常状态下通过零线宽隐藏。
        this.burnMark = new Konva.Line({
            points: [-6, -6, 6, 6],
            stroke: '#000', strokeWidth: 0, lineCap: 'round', listening: false
        });
        this._dynamicGroup.add(this.burnMark);

        // 绘制 LED 实体封装底座。
        this._staticGroup.add(new Konva.Rect({
            x: -14, y: -6, width: 28, height: 12,
            fill: '#888', cornerRadius: 2, stroke: '#555', strokeWidth: 0.5, listening: false
        }));
        // 绘制封装左侧的反光或结构高光线。
        this._staticGroup.add(new Konva.Line({
            points: [-14, -6, -14, 6],
            stroke: '#ddd', strokeWidth: 2, listening: false
        }));

        // 创建显示 LED 正向压降的参数标签。
        this.paramLabel = new Konva.Text({
            x: -30, y: -35, width: 60,
            text: this.vForward.toFixed(1) + 'V',
            fontSize: 10, fill: c.label, fontStyle: 'bold',
            align: 'center', listening: false
        });
        // 将参数标签加入静态图层。
        this._staticGroup.add(this.paramLabel);
    }

    _buildDynamicParts() {
        // 重建动态节点，使颜色配置变化后透镜和光晕使用新颜色。
        this._dynamicGroup.destroyChildren();

        // 读取当前颜色对应的动态显示配色。
        const c = this._color;

        // 创建外围光晕，亮度越高时透明度越大。
        this.glowCircle = new Konva.Circle({
            x: 0, y: 0, radius: 22,
            fill: c.glow,
            opacity: 0,
            listening: false
        });

        // 创建 LED 彩色透镜主体。
        this.ledLens = new Konva.Circle({
            x: 0, y: 0, radius: 14,
            fill: c.lens,
            stroke: '#333', strokeWidth: 1.5,
            opacity: 0.35,
            listening: false
        });

        // 创建透镜表面的椭圆形高光。
        this.lensHighlight = new Konva.Ellipse({
            x: -4, y: -5, radiusX: 6, radiusY: 4,
            fill: c.highlight, opacity: 0.15, listening: false
        });

        // 将三个动态节点加入动态层。
        this._dynamicGroup.add(this.glowCircle, this.ledLens, this.lensHighlight);
    }

    getConfigFields() {
        // 配置面板开放器件名称、正向压降和 LED 颜色。
        return [
            { label: '器件名称', key: 'id', type: 'text' },
            { label: '导通压降 (V)', key: 'vForward', type: 'number' },
            {
                label: 'LED 颜色', key: 'ledColor', type: 'select',
                options: [
                    { value: 'red', label: '红色' },
                    { value: 'green', label: '绿色' },
                    { value: 'yellow', label: '黄色' },
                    { value: 'blue', label: '蓝色' },
                    { value: 'white', label: '白色' },
                    { value: 'orange', label: '橙色' },
                ]
            },
        ];
    }

    onConfigUpdate(cfg) {
        // 更新器件标识。
        if (cfg.id !== undefined) this.id = cfg.id;
        // 更新正向压降并同步参数标签。
        if (cfg.vForward !== undefined) {
            this.vForward = cfg.vForward;
            this._updateLabel();
        }
        // 颜色变化时重建动态节点，并更新参数标签颜色。
        if (cfg.ledColor !== undefined && cfg.ledColor !== this.ledColor) {
            this.ledColor = cfg.ledColor;
            this._buildDynamicParts();
            this._updateLabel();
        }
        // 保存最新配置并刷新静态缓存。
        this.config = cfg;
        this._refreshCache();
    }

    tick(dt) {
        // 烧毁状态保持熄灭、灰色透镜和故障斜线，不再进行正常亮度计算。
        if (this._burnedOut) {
            this.glowCircle.opacity(0);
            this.ledLens.fill('#555');
            this.ledLens.opacity(0.6);
            this.lensHighlight.opacity(0);
            this.burnMark.strokeWidth(2);
            return;
        }

        // 读取物理电流绝对值，只使用电流大小决定 LED 发光强度。
        const current = Math.abs(this.physCurrent || 0);

        // 电流超过 0.05A 时累计过流帧数。
        if (current > 0.05) {
            this._burnOutFrames++;
            // 过流持续超过 10 帧后锁定为烧毁状态。
            if (this._burnOutFrames > 10) {
                this._burnedOut = true;
                return;
            }
        } else {
            // 电流恢复正常时清除连续过流计数。
            this._burnOutFrames = 0;
        }

        // 将电流从点亮阈值到额定范围映射为目标亮度。
        const targetBrightness = current < 0.001 ? 0 : Math.min(1, (current - 0.001) / 0.009);
        // 使用插值平滑亮度，避免发光效果突然跳变。
        this._brightness += (targetBrightness - this._brightness) * 0.15;

        // 低亮度状态隐藏光晕并保持透镜半透明。
        if (this._brightness < 0.01) {
            this.glowCircle.opacity(0);
            this.ledLens.fill(this._color.lens);
            this.ledLens.opacity(0.35);
            this.lensHighlight.opacity(0.15);
        } else {
            // 正常发光时同步调整光晕、透镜和高光透明度。
            this.glowCircle.opacity(0.15 * this._brightness);
            this.ledLens.fill(this._color.lens);
            this.ledLens.opacity(0.35 + 0.65 * this._brightness);
            this.lensHighlight.opacity(0.15 + 0.55 * this._brightness);
        }
    }

    _updateLabel() {
        // 更新正向压降文字和标签颜色，并标记组件需要重绘。
        if (this.paramLabel) {
            this.paramLabel.text(this.vForward.toFixed(1) + 'V');
            this.paramLabel.fill(this._color.label);
            this.markDirty();
        }
    }

    destroy() {
        // 调用父类销毁逻辑，释放 LED 图形和相关资源。
        super.destroy?.();
    }
}
