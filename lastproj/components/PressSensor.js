import { BaseComponent } from './BaseComponent.js';

export class StrainCylinderSensor extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.type = 'pressure_sensor';
        this.cache = 'fixed';
        this.scale = 1.2;
        // 核心物理参数
        this.baseR = config.baseR || 120;         // 基础电阻 (Ω)
        this.maxP = config.maxP || 1;      // 最大量程 (1MPa)
        this.gf = 2.0;                           // 灵敏度系数

        this.currentP = 0;
        this.r1 = this.baseR;
        this.r2 = this.baseR;

        this.config = { id: this.id, baseR: this.baseR, maxP: this.maxP };

        this.initVisuals();
        this.initPorts();
    }

    initPorts() {
        this.ports = [];
        const s = this.scale;

        // --- 接线柱贴边处理 ---
        // 左侧接线柱 (r1) 贴在左外壳边缘
        this.addPort(-32 * s, -30 * s, 'r1l', 'wire', 'p');
        this.addPort(-32 * s, 10 * s, 'r1r', 'wire');

        // 右侧接线柱 (r2) 贴在右外壳边缘
        this.addPort(32 * s, 10 * s, 'r2l', 'wire', 'p');
        this.addPort(32 * s, 50 * s, 'r2r', 'wire');

        // 底部气路端口
        this.addPort(0, 85 * s, 'i', 'pipe', 'in');
    }

    initVisuals() {
        this.group.destroyChildren();
        const s = this.scale;
        const stroke = '#2c3e50';
        const sw = 2 * s;

        // --- 1. 外部气室 (开放式上端) ---
        // 矩形只画左右和底边，上端留空给膜片
        const chamberPath = new Konva.Line({
            points: [
                -30 * s, 60 * s,
                -30 * s, 85 * s,
                30 * s, 85 * s,
                30 * s, 60 * s
            ],
            stroke: stroke,
            strokeWidth: sw,
            closed: false
        });
        // 气室背景
        const chamberBG = new Konva.Rect({
            x: -30 * s, y: 60 * s, width: 60 * s, height: 25 * s,
            fill: '#bdc3c7', opacity: 0.3
        });

        // --- 2. 传感器外壳 (两侧固定架) ---
        const housing = new Konva.Line({
            points: [
                -30 * s, 60 * s,
                -30 * s, -40 * s, -40 * s, -40 * s,
                -40 * s, -60 * s, 40 * s, -60 * s,
                40 * s, -40 * s, 30 * s, -40 * s,
                30 * s, 60 * s,

            ],
            fill: '#ecf0f1',
            stroke: stroke,
            strokeWidth: sw,
            closed: false
        });

        // --- 3. 内部双梁 ---
        const createBeam = (offsetX) => new Konva.Rect({
            x: offsetX * s - 4 * s, y: -60 * s,
            width: 8 * s, height: 120 * s,
            fillLinearGradientStartPoint: { x: -4 * s, y: 0 },
            fillLinearGradientEndPoint: { x: 4 * s, y: 0 },
            fillLinearGradientColorStops: [0, '#3498db', 0.5, '#85c1e9', 1, '#3498db'],
            stroke: '#2980b9',
            strokeWidth: 0.5 * s
        });
        this.beamL = createBeam(-8);
        this.beamR = createBeam(8);

        // --- 4. 弹性膜片 (初始水平) ---
        // 使用 Line 的弯曲功能模拟受压变形
        this.diaphragm = new Konva.Line({
            points: [-30 * s, 60 * s, 0, 60 * s, 30 * s, 60 * s],
            stroke: '#2980b9',
            strokeWidth: 3 * s,
            tension: 0.5, // 关键：产生平滑弧度
            lineCap: 'round'
        });

        // --- 5. 应变片 ---
        // r1: 竖贴在左梁侧面 (随梁压缩变短 -> 电阻变小)
        this.visualR1 = new Konva.Rect({
            x: -18 * s, y: -30 * s,
            width: 6 * s, height: 36 * s,
            fill: '#e74c3c', stroke: '#c0392b', strokeWidth: 0.5 * s
        });

        // r2: 横贴在右梁 (扁平状，压缩时截面变小 -> 电阻变大)
        this.visualR2 = new Konva.Rect({
            x: 12 * s, y: 20 * s,
            width: 12 * s, height: 16 * s,
            fill: '#fd2c08', stroke: '#f30808', strokeWidth: 0.5 * s
        });

        const labelR1 = new Konva.Text({ x: -24 * s, y: -40 * s, text: 'r1', fontSize: 10 * s });
        const labelR2 = new Konva.Text({ x: 17 * s, y: -2 * s, text: 'r2', fontSize: 10 * s });

        this.group.add(housing, chamberBG, chamberPath, this.beamL, this.beamR, this.diaphragm, this.visualR1, this.visualR2, labelR1, labelR2);
    }

    update(pressure) {
        // 保护 1: 确保 scale 有效
        const s = this.scale || 1.2;

        // 保护 2: 确保 maxP 不为 0，防止除以 0 得到 NaN
        const maxP = this.maxP || 1;
        this.currentP = Math.max(0, pressure);
        let ratio = this.currentP / maxP;

        // 限制 ratio 在 0-1 之间，防止过度变形
        ratio = Math.max(0, Math.min(1, ratio));

        // --- 物理计算 ---
        const strain = ratio * 0.005;
        // r1: 长度缩短，电阻变小
        this.r1 = this.baseR * (1 - this.gf * strain);
        // r2: 截面受压变扁，电阻增大
        this.r2 = this.baseR * (1 + this.gf * strain);
        // console.log(this.r1, this.r2);

        // --- 动态视觉反馈 ---

        // 1. 膜片向上变形
        const flexHeight = ratio * 15 * s;
        this.diaphragm.points([-30 * s, 60 * s, 0, (60 * s) - flexHeight, 30 * s, 60 * s]);

        // 2. 双梁联动压缩
        this.beamL.height(120 * s - flexHeight);
        this.beamR.height(120 * s - flexHeight);

        // 3. 应变片形变
        // r1: 跟着梁一起缩短
        this.visualR1.scaleY(1 - ratio * 0.3);
        // r2: 变扁 (高度缩短，宽度微扩)
        this.visualR2.scaleY(1 - ratio * 0.5);
        this.visualR2.scaleX(1 + ratio * 0.1);

        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label: '器件名称', key: 'id', type: 'text' },
            { label: '基准电阻 (Ω)', key: 'baseR', type: 'number' },
            { label: '最大量程 (Pa)', key: 'maxP', type: 'number' }
        ];
    }

    onConfigUpdate(newConfig) {
        this.id = newConfig.id;
        this.baseR = parseFloat(newConfig.baseR);
        this.maxP = parseFloat(newConfig.maxP);
        this.config = newConfig;
    }
}