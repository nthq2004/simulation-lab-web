import { BaseComponent } from './BaseComponent.js';

/**
 * LVDTPressureSensor - 基于差动变压器原理的压力位移传感器视觉组件
 *
 * 说明：
 * - 该组件将压力输入（气路）转换为机械位移（铁芯位移），再通过差动次级线圈的耦合差
 *   形成差分电压输出（Vout = Vin * outputRatio）。为教学用途，电气部分用简单比例系数表示。
 * - 端口：右侧为原边激励输入（`p`/`n`），左侧为差动输出（`outp`/`outn`），底部为压力入口（`i`）。
 * - 关键映射：pressure -> displacement -> 上/下线圈耦合系数(m1/m2) -> outputRatio
 * - 可配置项：`maxP`（量程），`polority` 表示位移方向（1 表示正向移动，-1 表示反向）。
 *
 * 注意：本组件为可视化与教学抽象，电气耦合使用经验性系数而非精确电磁场求解。
 */

export class LVDTPressureSensor extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        // 类型与缓存设置
        this.type = 'pressure_transducer';
        this.cache = 'fixed';
        this._initGroups();

        // 可视缩放倍率
        this.scale = 1.6;

        // --- 核心物理与电气参数 ---
        // maxP: 量程（与 UI 中单位一致，见 getConfigFields），用于将输入压力归一化
        this.maxP = config.maxP || 1;
        // nominalOutput: 标定常数，用于把位移转为差分输出比例（Vout = Vin * outputRatio）
        this.nominalOutput = 0.5;

        // --- 实时物理状态 ---
        this.currentP = 0;      // 当前输入压力（用户/系统传入）
        this.displacement = 0;  // 铁芯位移（像素或约定单位，用于视觉）

        // --- 电气抽象状态 ---
        // 使用两个互感耦合系数 m1/m2 描述次级上、下线圈与原边的耦合强度
        this.m1 = 0;
        this.m2 = 0;
        // outputRatio: 最终的输出缩放系数，外部电路可根据此系数将 Vin 映射为 Vout
        this.outputRatio = 0;
        // polority: 位移方向，1 表示入口在下（向上移动），-1 表示入口相反
        this.polority = 1;

        this.config = { id: this.id, maxP: this.maxP, polority: this.polority };

        this.initVisuals();
        this.initPorts();

    }

    initPorts() {
        this.ports = [];
        const s = this.scale;
        // 电气端口说明：
        // - 右侧为原边输入（交流激励），p/n 为正负端
        // - 左侧为差动输出（outp/outn），上/下输出端对应次级上/下部分
        this.addPort(-30 * s, -50 * s, 'p', 'wire', 'p');
        this.addPort(-30 * s, 20 * s, 'n', 'wire');
        this.addPort(30 * s, -50 * s, 'outp', 'wire', 'p');
        this.addPort(30 * s, -10 * s, 'outn', 'wire');

        // 底部气路端口：用于接入被测压力（Pressure In）
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

        // 3. 内部连线 (线圈 -> 端口)，用于视觉上表现各线圈与端口的连接关系
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
        // 这些元素将在 update() 中随压力位移，用于可视化铁芯的运动
        // 连杆：细长条，穿过铁芯中心
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
        // 波纹管用于视觉上表示由压力引起的压缩/伸长
        // 使用多条横向弧线模拟波纹效果
        this.visualBellows = new Konva.Group({ y: 45 * s });
        // 波纹管外罩 (固定)
        this.bellowsCover = new Konva.Rect({ x: -48, y: 0, width: 96, height: 80, stroke: '#444', strokeWidth: 4, fill: '#eee' });
        this.bellowsBody = new Konva.Path({
            data: 'M -25 0 L 25 0 L 20 5 L 25 10 L 20 15 L 25 20 L 20 25 L 25 30 L 20 35 L 25 40 L 20 45 L 25 50 L -25 50 L -20 45 L -25 40 L -20 35 L -25 30 L -20 25 L -25 20 L -20 15 L -25 10 L -20 5 Z',
            fill: '#90caf9', stroke: '#1565c0', strokeWidth: 1.5
        });
        this.visualBellows.add(this.bellowsCover, this.bellowsBody);




        this._staticGroup.add(housingFrame, primaryCoil, secondaryCoilTop, secondaryCoilBottom, internalWires, this.visualBellows, this.coreGroup);
    }

    // --- 物理与电气求解逻辑 ---
    update(pressure) {
        // 入口压力（单位同配置）并限制非负
        this.currentP = Math.max(0, pressure);
        const s = this.scale;

        // 1) 将压力映射为归一化比例（strainRatio in [-1,1] 取决于 polority）
        //    当 currentP >= maxP 时，strainRatio 为 polority * 1（满量程）
        const strainRatio = this.polority * Math.min(1, this.currentP / this.maxP);

        // 2) 位移映射：strainRatio -> displacement（视觉像素值），maxTravel 为设计的最大像素行程
        const maxTravel = 15; // 最大行程（像素量，影响视觉移动幅度）
        this.displacement = strainRatio * maxTravel;

        // 同步移动视觉部件：铁芯组整体沿 y 方向偏移（向上移动为负）
        this.coreGroup.y(-this.displacement * s);

        // 3) 波纹管视觉缩放：根据实际位移调整波纹管的纵向缩放比例
        const initialHeight = 30;
        const currentHeight = initialHeight - this.displacement;
        const bellowsScale = currentHeight / initialHeight;
        if (this.bellowsBody) {
            this.bellowsBody.scaleY(Math.max(0.1, bellowsScale));
        }

        // 4) 电气/耦合逻辑：位移改变上/下次级的耦合系数 m1/m2
        //    我们用线性近似：m1 = 0.5 + 0.4*strainRatio, m2 = 0.5 - 0.4*strainRatio
        //    最终 outputRatio 由 nominalOutput 与两个次级耦合差决定：Vout = Vin * outputRatio
        const m1 = 0.5 + (strainRatio * 0.4);
        const m2 = 0.5 - (strainRatio * 0.4);
        this.outputRatio = this.nominalOutput * (m1 - m2);

        // 标记为需要重绘以更新静态缓存
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


    destroy() {
        super.destroy?.();
    }
}
