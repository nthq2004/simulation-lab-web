/**
 * IncandescentLamp 白炽灯组件。
 *
 * 作用：这是一个模拟白炽灯泡的组件，用于展示灯丝发热、亮度变化和烧毁状态在电路仿真中的表现。
 * 它通过检测两端电压并计算有效值，进而更新亮度和状态，适合用于照明、负荷特性和过压损坏的教学演示。
 *
 * 设计特点：
 * 1. 采用球形灯泡的简单图形表示，附带灯丝和支撑结构；
 * 2. 通过电压的 RMS 和亮度关系模拟灯丝温度升高与光输出变化；
 * 3. 存在过压烧毁阈值，超过后灯泡会进入已烧毁状态；
 * 4. 由冷态电阻参数驱动灯丝特性，便于在不同仿真场景中调整负载行为。
 */
import { BaseComponent } from './BaseComponent.js';

export class IncandescentLamp extends BaseComponent {
    constructor(config, sys) {
        // 调用父类构造函数，以建立组件与仿真系统之间的基础关联。
        super(config, sys);
        // 该器件在系统中被识别为一个通用电阻型负载，便于被电路求解器按负载处理。
        this.type = 'resistor';
        // fixed 缓存让灯泡主体的静态图形只在初始化时生成并复用，避免重复绘制。
        this.cache = 'fixed';
        // 初始化 Konva 图层容器，供静态和动态节点挂载。
        this._initGroups();

        // 关键参数控制灯丝的冷态电阻、额定电压、最大耐压和烧毁阈值。
        this.coldResistance = config.coldResistance || 484;
        this.currentResistance = this.coldResistance;
        this.vRated = 220;
        this.vMax = 240;
        this.vBurn = 270;
        this._burnedOut = false;
        this._rmsBuffer = [];
        this._rmsWindow = 200;
        this._rmsVoltage = 0;
        this._brightness = 0;

        // 配置快照用于编辑器显示和状态恢复。
        this.config = { id: this.id, coldResistance: this.coldResistance };

        // 初始化灯泡图形和端口，保证灯泡实例可被直接放置在电路图中。
        this.initVisuals();
        this.initPorts();
    }

    initPorts() {
        // 左右两端负责连接电路的两端电压，命名为 l 和 r，便于读取端间电压。
        this.addPort(-40, 0, 'l', 'wire', 'p');
        this.addPort(40, 0, 'r', 'wire');
    }

    initVisuals() {
        // 灯泡的主体由供电引线、圆形玻壳和灯丝结构构成，便于在电路图中识别为照明负载。
        const stroke = '#000000';
        this._staticGroup.add(new Konva.Line({ points: [-40, 0, -20, 0], stroke, strokeWidth: 2 }));
        this._staticGroup.add(new Konva.Line({ points: [20, 0, 40, 0], stroke, strokeWidth: 2 }));

        // 球形玻壳代表灯泡本体，不同的亮度和损坏状态将体现在其内部发光和烧毁标记上。
        const circle = new Konva.Circle({
            x: 0, y: 0, radius: 20,
            stroke, strokeWidth: 2,
            fill: '#fff',
        });
        this._staticGroup.add(circle);

        // 灯丝用弧线型线段表示，代表灯丝的热辐射和发光特性。
        const filament = new Konva.Line({
            points: [-10, 0, -5, -8, 0, 0, 5, -8, 10, 0],
            stroke: '#888',
            strokeWidth: 1.5,
            tension: 0.3,
            listening: false,
        });
        this._staticGroup.add(filament);

        // 两个竖向支撑杆用于表现灯丝固定在玻壳内的结构。
        const supportL = new Konva.Line({
            points: [-10, 0, -10, -16],
            stroke: '#666',
            strokeWidth: 1,
            listening: false,
        });
        const supportR = new Konva.Line({
            points: [10, 0, 10, -16],
            stroke: '#666',
            strokeWidth: 1,
            listening: false,
        });
        this._staticGroup.add(supportL, supportR);

        // 发光层覆盖在灯泡外圈，用于在不同亮度下显示热发光效果。
        this.glowOverlay = new Konva.Circle({
            x: 0, y: 0, radius: 23,
            fill: '#000000',
            opacity: 0,
            listening: false,
        });
        this._dynamicGroup.add(this.glowOverlay);

        // 烧毁标记在故障时显示为一条十字线，提示灯丝已经断裂或熔断。
        this.burnMark = new Konva.Line({
            points: [-8, -8, 8, 8],
            stroke: '#000', strokeWidth: 0, lineCap: 'round', listening: false,
        });
        this._dynamicGroup.add(this.burnMark);

        // RMS 电压标签用于在示意图中显示当前施加到灯泡的有效值。
        this.rmsLabel = new Konva.Text({
            x: -50, y: -43, width: 100,
            text: '',
            fontSize: 15, fill: '#2c3e50', fontFamily: 'Arial', fontStyle: 'bold',
            align: 'center', listening: false,
        });
        this._dynamicGroup.add(this.rmsLabel);

        // L 和 N 标记用于说明灯泡的两端连接对应相线和中性线的教学意义。
        const lbl = { fontSize: 11, fill: '#e67e22', fontFamily: 'Arial', fontStyle: 'bold' };
        this._staticGroup.add(new Konva.Text({ x: -36, y: -32, text: 'L', ...lbl }));
        this._staticGroup.add(new Konva.Text({ x: 32, y: -32, text: 'N', ...lbl }));
    }

    getConfigFields() {
        // 配置字段只保留器件名称和灯丝的冷态电阻，足以影响电流和发光行为。
        return [
            { label: '器件名称', key: 'id', type: 'text' },
            { label: '冷态电阻 (Ω)', key: 'coldResistance', type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        // 配置更新时同步器件名和灯丝参数，并刷新缓存以保证画面与逻辑一致。
        if (cfg.id !== undefined) this.id = cfg.id;
        if (cfg.coldResistance !== undefined) {
            this.coldResistance = cfg.coldResistance;
            this.currentResistance = this.coldResistance;
        }
        this.config = cfg;
        this._refreshCache();
    }

    tick(dt) {
        // 如果灯泡已经烧毁，则直接停留在故障状态，保持发光渲染关闭并显示故障标志。
        if (this._burnedOut) {
            this.currentResistance = 1e9;
            this.glowOverlay.opacity(0);
            this.burnMark.strokeWidth(2);
            this.rmsLabel.text('已烧毁');
            this.rmsLabel.fill('#c0392b');
            return;
        }
        // 未烧毁时灯丝的等效电阻为冷态值，模拟白炽灯在常温下的低阻抗特征。
        this.currentResistance = this.coldResistance;

        // 从系统中读取灯泡两端瞬时电压，并据此更新 RMS 统计窗口以反映灯丝实际受到的电压水平。
        const vInstant = this.sys.getVoltageBetween(`${this.id}_wire_l`, `${this.id}_wire_r`) || 0;

        this._rmsBuffer.push(vInstant * vInstant);
        if (this._rmsBuffer.length > this._rmsWindow) {
            this._rmsBuffer.shift();
        }
        const sumSq = this._rmsBuffer.reduce((a, b) => a + b, 0);
        this._rmsVoltage = Math.sqrt(sumSq / this._rmsBuffer.length);

        // 当有效值超过烧毁阈值时，灯泡直接转入失效状态，表示灯丝已被过压损坏。
        if (this._rmsVoltage >= this.vBurn) {
            this._burnedOut = true;
            return;
        }

        // 根据电压大小划分不同亮度区间，从熄灭到额定亮度再到过压发光增强。
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
        targetBrightness = Math.min(1.4, Math.max(0, targetBrightness));

        // 用平滑递推方式让亮度变化更自然，避免直接跳变造成视觉突兀。
        this._brightness += (targetBrightness - this._brightness) * 0.1;

        // 亮度低于阈值时保持关闭；否则更新发光色温和透明度，形成真实的灯泡发光效果。
        if (this._brightness < 0.01) {
            this.glowOverlay.opacity(0);
        } else {
            const t = Math.min(1, this._brightness);
            const r = Math.min(255, 70 + Math.round(185 * t));
            const g = Math.min(255, 35 + Math.round(220 * t));
            const bl = Math.min(255, Math.round(200 * Math.max(0, this._brightness - 0.2) / 1.2));
            this.glowOverlay.fill(`rgb(${r},${g},${bl})`);
            this.glowOverlay.opacity(0.25 + 0.75 * t);
        }

        // 显示当前时刻的有效值，并用颜色区分正常灯光和高压警戒状态。
        this.rmsLabel.text(this._rmsVoltage.toFixed(1) + 'V');
        this.rmsLabel.fill(this._rmsVoltage >= this.vRated ? '#e67e22' : '#7f8c8d');
    }

    destroy() {
        super.destroy?.();
    }
}
