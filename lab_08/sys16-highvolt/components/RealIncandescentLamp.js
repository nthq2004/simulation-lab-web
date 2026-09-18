/**
 * RealIncandescentLamp 实际白炽灯组件。
 *
 * 该组件用于仿真带灯丝、玻璃泡和金属灯座的白炽灯。它通过一段滑动采样窗口计算
 * 灯两端电压的 RMS 值，再根据额定电压、允许最大电压和烧毁电压计算亮度。当电压
 * 达到烧毁阈值时，组件进入不可恢复的烧毁状态，显示烧毁标记并将等效电阻提高到
 * 极大值；正常运行时则通过发光叠加层表现灯丝亮度。
 *
 * 主要功能：
 * 1. 创建 L、N 两个电气端口，表示灯具的火线和零线连接端；
 * 2. 保存冷态电阻、额定电压、最大允许电压和烧毁电压；
 * 3. 使用滑动 RMS 窗口平滑测量灯端交流电压；
 * 4. 根据 RMS 电压动态计算发光亮度，并使用颜色和透明度表现灯光变化；
 * 5. 在过压达到烧毁阈值时显示故障状态并改变等效电阻。
 */
import { BaseComponent } from './BaseComponent.js';

export class RealIncandescentLamp extends BaseComponent {
    constructor(config, sys) {
        // 调用父类构造函数，初始化组件公共属性和系统引用。
        super(config, sys);
        // 将组件类型标记为电阻性负载，便于电路求解器处理。
        this.type = 'resistor';
        // 静态灯具外观启用固定缓存。
        this.cache = 'fixed';
        // 创建静态、动态和交互图层容器。
        this._initGroups();

        // 读取冷态灯丝电阻，未配置时使用默认值 484Ω。
        this.coldResistance = config.coldResistance || 484;
        // 当前工作电阻初始等于冷态电阻。
        this.currentResistance = this.coldResistance;
        // 设置灯具额定电压、允许最大电压和烧毁阈值。
        this.vRated = 220;
        this.vMax = 240;
        this.vBurn = 270;
        // 记录灯丝是否已经烧毁。
        this._burnedOut = false;
        // 保存最近一段时间的电压平方采样值，用于计算 RMS。
        this._rmsBuffer = [];
        // 设置 RMS 滑动窗口长度。
        this._rmsWindow = 200;
        // 初始化 RMS 电压和显示亮度。
        this._rmsVoltage = 0;
        this._brightness = 0;

        // 保存器件标识和冷态电阻配置。
        this.config = { id: this.id, coldResistance: this.coldResistance };

        // 绘制灯具外观、灯丝、动态发光层和状态标签。
        this.initVisuals();
        // 创建火线 L 和零线 N 两个电气端口。
        this.initPorts();
    }

    initPorts() {
        // 左上端口作为火线 L，并标记为正向连接端。
        this.addPort(-30, -26, 'l', 'wire', 'p');
        // 右上端口作为零线 N。
        this.addPort(30, -26, 'r', 'wire');
    }

    initVisuals() {
        // 定义灯泡、灯座和灯丝等部分的基础颜色。
        const colors = {
            bulb: '#f5f0e8',
            base: '#bdc3c7',
            baseDark: '#95a5a6',
            filament: '#999',
        };

        // 绘制金属灯座，并用渐变表现圆柱形质感。
        const base = new Konva.Rect({
            x: -13, y: -10,
            width: 26, height: 31,
            fillLinearGradientStartPoint: { x: -13, y: -10 },
            fillLinearGradientEndPoint: { x: 13, y: 21 },
            fillLinearGradientColorStops: [0, colors.base, 0.5, colors.baseDark, 1, colors.base],
            stroke: '#777',
            strokeWidth: 1,
            cornerRadius: 2,
        });
        this._staticGroup.add(base);

        // 绘制灯座上的两道结构纹理。
        const ridge1 = new Konva.Line({
            points: [-13, 0, 13, 0],
            stroke: '#999',
            strokeWidth: 0.8,
            listening: false,
        });
        const ridge2 = new Konva.Line({
            points: [-13, 10, 13, 10],
            stroke: '#999',
            strokeWidth: 0.8,
            listening: false,
        });
        this._staticGroup.add(ridge1, ridge2);

        // 绘制半透明玻璃灯泡外壳。
        const glass = new Konva.Circle({
            x: 0, y: -23,
            radius: 23,
            fill: colors.bulb,
            stroke: '#aaa',
            strokeWidth: 1.2,
            opacity: 0.7,
        });
        this._staticGroup.add(glass);

        // 绘制灯泡内部灯丝和支撑引线。
        this._drawFilament();

        // 绘制从两个端口连接到灯座的金属引线。
        const leadL = new Konva.Line({
            points: [-30, -26, -13, 10],
            stroke: '#aeb6bf', strokeWidth: 3, lineCap: 'round',
        });
        const leadR = new Konva.Line({
            points: [30, -26, 13, 10],
            stroke: '#aeb6bf', strokeWidth: 3, lineCap: 'round',
        });
        this._staticGroup.add(leadL, leadR);

        // 创建动态发光叠加层，通过填充色和透明度表示亮度。
        this.glowOverlay = new Konva.Circle({
            x: 0, y: -23, radius: 28,
            fill: '#000000',
            opacity: 0,
            listening: false,
        });
        this._dynamicGroup.add(this.glowOverlay);

        // 创建烧毁斜线标记，正常状态下通过线宽为零隐藏。
        this.burnMark = new Konva.Line({
            points: [-8, -31, 8, -16],
            stroke: '#000', strokeWidth: 0, lineCap: 'round', listening: false,
        });
        this._dynamicGroup.add(this.burnMark);

        // 创建显示 RMS 电压或“已烧毁”状态的动态标签。
        this.rmsLabel = new Konva.Text({
            x: -50, y: -66, width: 100,
            text: '',
            fontSize: 12, fill: '#2c3e50', fontFamily: 'Arial', fontStyle: 'bold',
            align: 'center', listening: false,
        });
        this._dynamicGroup.add(this.rmsLabel);

        // 在两个接线端口附近标注火线 L 和零线 N。
        const lbl = { fontSize: 10, fill: '#c0392b', fontFamily: 'Arial', fontStyle: 'bold' };
        this._staticGroup.add(new Konva.Text({ x: -30, y: -38, text: 'L', ...lbl }));
        this._staticGroup.add(new Konva.Text({ x: 26, y: -38, text: 'N', ...lbl }));
    }

    _drawFilament() {
        // 用折线绘制灯丝本体，表现灯泡内部的发热丝形状。
        const filament = new Konva.Line({
            points: [-5, -23, -3, -31, 0, -21, 3, -31, 5, -23],
            stroke: '#888',
            strokeWidth: 1.2,
            tension: 0.4,
            listening: false,
        });
        this._staticGroup.add(filament);

        // 绘制左侧灯丝支撑引线。
        const wireL = new Konva.Line({
            points: [-13, 10, -5, -23],
            stroke: '#999',
            strokeWidth: 1,
            listening: false,
        });
        // 绘制右侧灯丝支撑引线。
        const wireR = new Konva.Line({
            points: [13, 10, 5, -23],
            stroke: '#999',
            strokeWidth: 1,
            listening: false,
        });
        // 将两条支撑引线加入静态图层。
        this._staticGroup.add(wireL, wireR);
    }

    getConfigFields() {
        // 配置面板开放器件名称和冷态电阻。
        return [
            { label: '器件名称', key: 'id', type: 'text' },
            { label: '冷态电阻 (Ω)', key: 'coldResistance', type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        // 更新器件标识。
        if (cfg.id !== undefined) this.id = cfg.id;
        // 更新冷态电阻，并同步当前工作电阻。
        if (cfg.coldResistance !== undefined) {
            this.coldResistance = cfg.coldResistance;
            this.currentResistance = this.coldResistance;
        }
        // 保存最新配置并刷新静态缓存。
        this.config = cfg;
        this._refreshCache();
    }

    tick(dt) {
        // 已烧毁的灯丝保持高阻、熄灭和故障标记，不再继续计算正常亮度。
        if (this._burnedOut) {
            this.currentResistance = 1e9;
            this.glowOverlay.opacity(0);
            this.burnMark.strokeWidth(2);
            this.rmsLabel.text('已烧毁');
            this.rmsLabel.fill('#c0392b');
            return;
        }
        // 正常运行时将当前工作电阻保持为冷态电阻模型值。
        this.currentResistance = this.coldResistance;

        // 读取灯具两端的瞬时电压。
        const vInstant = this.sys.getVoltageBetween(`${this.id}_wire_l`, `${this.id}_wire_r`) || 0;

        // 将瞬时电压平方加入 RMS 滑动窗口。
        this._rmsBuffer.push(vInstant * vInstant);
        // 超出窗口长度时移除最早的采样值。
        if (this._rmsBuffer.length > this._rmsWindow) {
            this._rmsBuffer.shift();
        }
        // 对窗口内的电压平方求平均并开平方，得到平滑 RMS 电压。
        const sumSq = this._rmsBuffer.reduce((a, b) => a + b, 0);
        this._rmsVoltage = Math.sqrt(sumSq / this._rmsBuffer.length);

        // RMS 电压达到烧毁阈值后锁定为烧毁状态。
        if (this._rmsVoltage >= this.vBurn) {
            this._burnedOut = true;
            return;
        }

        // 根据 RMS 电压分段计算目标亮度：低压逐步变亮，额定以上允许过亮显示。
        let targetBrightness;
        if (this._rmsVoltage <= 10) {
            targetBrightness = 0;
        } else if (this._rmsVoltage <= this.vRated) {
            targetBrightness = this._rmsVoltage / this.vRated;
        } else if (this._rmsVoltage <= this.vMax) {
            const ratio = (this._rmsVoltage - this.vRated) / (this.vMax - this.vRated);
            targetBrightness = 1.0 + ratio * 0.4;
        } else {
            targetBrightness = 1.4;
        }
        // 将目标亮度限制在 0~1.4 范围内。
        targetBrightness = Math.min(1.4, Math.max(0, targetBrightness));

        // 使用插值平滑亮度变化，避免灯光随采样瞬间跳变。
        this._brightness += (targetBrightness - this._brightness) * 0.1;

        // 亮度极低时隐藏发光层。
        if (this._brightness < 0.01) {
            this.glowOverlay.opacity(0);
        } else {
            // 根据亮度计算 RGB 颜色和透明度，模拟灯丝从暗红到明亮的变化。
            const t = Math.min(1, this._brightness);
            const r = Math.min(255, 70 + Math.round(185 * t));
            const g = Math.min(255, 35 + Math.round(220 * t));
            const bl = Math.min(255, Math.round(200 * Math.max(0, this._brightness - 0.2) / 1.2));
            this.glowOverlay.fill(`rgb(${r},${g},${bl})`);
            this.glowOverlay.opacity(0.25 + 0.75 * t);
        }

        // 显示当前 RMS 电压，并在达到额定电压后使用橙色提示。
        this.rmsLabel.text(this._rmsVoltage.toFixed(1) + 'V');
        this.rmsLabel.fill(this._rmsVoltage >= this.vRated ? '#e67e22' : '#7f8c8d');
    }

    destroy() {
        // 调用父类销毁逻辑，释放灯具图形和相关资源。
        super.destroy?.();
    }
}
