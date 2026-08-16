import { BaseComponent } from './BaseComponent.js';

export class LVDTPressureSensor extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.type = 'pressure_transducer'; // 更改类型以区分阻性传感器
        this.cache = 'fixed';
        this.scale = 1.6;

        // --- 核心物理与电气参数 ---
        this.maxP = config.maxP || 1;         // 最大量程 (kPa)
        // this.bellowsK = config.bellowsK || 10;   // 波纹管弹性系数 (mm/100kPa, 用于视觉和计算)
        this.nominalOutput = 0.5;                // 标定满量程输出系数 (Vout/Vin per mm)

        // --- 实时物理状态 ---
        this.currentP = 0;                       // 当前输入压力
        this.displacement = 0;                   // 铁芯位移 (mm, 向上为正)

        // --- 实时电气状态 (用于电路仿真) ---
        // 差动变压器输出的是动态互感 $M$，而不是电阻。
        // 为了兼容 NMA，我们可以将其简化为一个阻抗（例如受控电感），
        // 但最精确的方法是将其抽象为一个“受控电压源” (针对交流求解)。
        // 这里的 M 用于描述 Vin 对 Vout 的耦合比例。
        this.m1 = 0;                             // 上线圈互感耦合系数
        this.m2 = 0;                             // 下线圈互感耦合系数
        this.outputRatio = 0;                    // 总调幅比例 (Vout = Vin * outputRatio)
        this.polority = 1;

        this.config = { id: this.id, maxP: this.maxP, polority: this.polority };

        this.initVisuals();
        this.initPorts();


    }

    initPorts() {
        this.ports = [];
        const s = this.scale;

        // 4个电气端口：

        // 1. 输入交流激励源端口 (Uin / UE) - 放在右侧
        this.addPort(-30 * s, -50 * s, 'p', 'wire', 'p');
        this.addPort(-30 * s, 20 * s, 'n', 'wire');

        // 2. 输出差动信号端口 (Uout) - 放在左侧
        this.addPort(30 * s, -50 * s, 'outp', 'wire', 'p');
        this.addPort(30 * s, -10 * s, 'outn', 'wire');

        // 1个底部气路端口 (Pressure In)
        this.addPort(0, 100 * s, 'i', 'pipe', 'in');
    }

    initVisuals() {
        this.group.destroyChildren(); // 清除旧视觉
        const s = this.scale;
        const stroke = '#2c3e50';
        const sw = 2 * s;
        const wireColor = '#555';


        // 1. 传感器主外壳线条
        const housingFrame = new Konva.Line({
            points: [
                -30 * s, -65 * s, 30 * s, -65 * s,
                30 * s, 45 * s, -30 * s, 45 * s
            ],
            stroke: stroke,
            strokeWidth: sw,
            closed: true
        });

        // --- 2. 绘制螺旋线圈 (视觉强化) ---
        const createCoilWinding = (x, y, w, h, color) => {
            const g = new Konva.Group();
            // 线圈背景（骨架）
            g.add(new Konva.Rect({ x, y, width: w, height: h, fill: '#ecf0f1', stroke: '#bdc3c7', strokeWidth: 0.5 * s }));
            // 绘制螺旋纹理
            const turns = 10;
            for (let i = 0; i < turns; i++) {
                g.add(new Konva.Line({
                    points: [x, y + (i / turns) * h, x + w, y + ((i + 0.5) / turns) * h],
                    stroke: color, strokeWidth: 1.5 * s
                }));
            }
            return g;
        };

        // 初级输入线圈 (右侧，一个整体)
        const primaryCoil = createCoilWinding(-20 * s, -50 * s, 10 * s, 70 * s, '#d35400');

        // 次级差动输出线圈 (左侧，分为上下两段)
        const secondaryCoilTop = createCoilWinding(12 * s, -50 * s, 10 * s, 32 * s, '#d35400');

        const secondaryCoilBottom = createCoilWinding(12 * s, -12 * s, 10 * s, 32 * s, '#d35400');

        // 3. 内部连线 (线圈 -> 端口)
        const internalWires = new Konva.Group();

        // 原边 L1 连线 -> 左侧端口
        internalWires.add(new Konva.Line({ points: [-20 * s, -50 * s, -30 * s, -50 * s, -30 * s, -40 * s], stroke: wireColor, strokeWidth: 2 * s }));
        internalWires.add(new Konva.Line({ points: [-20 * s, 20 * s, -30 * s, 20 * s, -30 * s, 10 * s], stroke: wireColor, strokeWidth: 2 * s }));

        // 副边差动连线：底部相连 (中点)
        internalWires.add(new Konva.Line({
            points: [22 * s, -18 * s, 10 * s, -18 * s, 10 * s, 21 * s, 22 * s, 21 * s],
            stroke: wireColor, strokeWidth: 2 * s
        }));

        // 副边上端引出 -> 右侧端口
        internalWires.add(new Konva.Line({ points: [22 * s, -48 * s, 30 * s, -48 * s, 30 * s, -40 * s], stroke: wireColor, strokeWidth: 2 * s }));
        internalWires.add(new Konva.Line({ points: [22 * s, -10 * s, 30 * s, -10 * s, 30 * s, 10 * s], stroke: wireColor, strokeWidth: 2 * s }));
        // --- 4. 动态移动部分 (连杆 + 铁芯) ---
        // 连杆：细长条
        this.visualRod = new Konva.Line({
            points: [0, -25 * s, 0, 75 * s], // 穿过铁芯中心
            stroke: '#7f8c8d', strokeWidth: 3 * s,
            lineCap: 'round'
        });

        // 铁芯：中间的矩形
        this.visualCore = new Konva.Rect({
            x: -6 * s, y: -30 * s, // 初始位置在中点
            width: 12 * s, height: 30 * s,
            fill: '#34495e', stroke: '#2c3e50', strokeWidth: sw,
            cornerRadius: 2 * s
        });

        // 创建铁芯和连杆的组合，方便一起移动
        this.coreGroup = new Konva.Group();
        this.coreGroup.add(this.visualRod, this.visualCore);

        // --- 5. 底部波纹管 (Bellows) ---
        // 使用多条横向弧线模拟波纹效果
        this.visualBellows = new Konva.Group({ y: 45 * s });
        // 波纹管外罩 (固定)
        this.bellowsCover = new Konva.Rect({ x: -48, y: 0, width: 96, height: 80, stroke: '#444', strokeWidth: 4, fill: '#eee' });
        this.bellowsBody = new Konva.Path({
            data: 'M -25 0 L 25 0 L 20 5 L 25 10 L 20 15 L 25 20 L 20 25 L 25 30 L 20 35 L 25 40 L 20 45 L 25 50 L -25 50 L -20 45 L -25 40 L -20 35 L -25 30 L -20 25 L -25 20 L -20 15 L -25 10 L -20 5 Z',
            fill: '#90caf9', stroke: '#1565c0', strokeWidth: 1.5
        });
        this.visualBellows.add(this.bellowsCover, this.bellowsBody);




        this.group.add(housingFrame, primaryCoil, secondaryCoilTop, secondaryCoilBottom, internalWires, this.visualBellows, this.coreGroup);
    }

    // --- 物理与电气求解逻辑 ---
    update(pressure) {
        this.currentP = Math.max(0, pressure);
        const s = this.scale;

        // 1. 物理计算：压力 P 越大，向上位移 displacement 越大
        const strainRatio = this.polority * Math.min(1, this.currentP / this.maxP);
        const maxTravel = 15; // 最大行程 (单位: 像素比例)
        this.displacement = strainRatio * maxTravel;

        // 2. 运动部件同步：连杆、铁芯
        // 铁芯组整体向上偏移
        this.coreGroup.y(-this.displacement * s);

        // 3. 波纹管变形补偿逻辑
        // 关键：波纹管的顶端（与气室隔板接触处）必须固定不动，底端随连杆移动
        const initialHeight = 30; // 初始设计高度
        const currentHeight = initialHeight - this.displacement; // 压缩后的高度
        const bellowsScale = currentHeight / initialHeight; // 计算缩放比例

        if (this.bellowsBody) {
            // 设置缩放
            this.bellowsBody.scaleY(Math.max(0.1, bellowsScale));

            // 补偿：因为 Konva 缩放默认基于 (0,0)，
            // 如果波纹管 group 的 y 定位在隔板处，缩放后底端会往上缩。
            // 我们不需要额外移动 visualBellows 的 y，前提是它的 initVisuals 定位在 65*s (隔板位置)。
        }

        // 4. 电气逻辑：位移影响互感耦合
        // 铁芯向上移动，L2(上)耦合变强，L3(下)耦合变弱
        const m1 = 0.5 + (strainRatio * 0.4);
        const m2 = 0.5 - (strainRatio * 0.4);
        this.outputRatio = this.nominalOutput * (m1 - m2);

        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label: '器件名称', key: 'id', type: 'text' },
            // { label: '弹性系数 (mm/100kPa)', key: 'bellowsK', type: 'number' },
            { label: '最大量程 (MPa)', key: 'maxP', type: 'number' },
            {
                label: '压力入口',
                key: 'polority',
                type: 'select',
                options: [
                    { label: '入口在下，向上移动', value: 1 },
                    { label: '入口在上，向下移动', value: -1 }
                ]
            },
        ];
    }

    onConfigUpdate(newConfig) {
        this.id = newConfig.id;
        // this.bellowsK = parseFloat(newConfig.bellowsK);
        this.maxP = parseFloat(newConfig.maxP);
        this.polority = parseInt(newConfig.polority);
        this.update(this.currentP);
        this.config = newConfig;
    }
}