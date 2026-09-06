import { BaseComponent } from './BaseComponent.js';

/**
 * 应变式压力传感器（StrainCylinderSensor）
 *
 * 功能概述：
 * - 模拟一个基于膜片＋双梁＋应变片的压力传感器外观与响应：随着腔内压力变化，膜片凸起带动梁变形，导致应变片的电阻（r1/r2）发生变化；
 * - 提供 `update(pressure)` 接口以 MPa 为单位更新仿真值，并在画布上以 Konva 展示膜片、梁与应变片的动态形变；
 * - 内部以 `baseR` 作为参考电阻，使用灵敏度系数 `gf` 将应变映射为电阻变化（r1 减小，r2 增大），供上层电路读取。
 *
 * 设计说明：
 * - 视觉元素添加到组件的 `_staticGroup`，通过 `this._refreshCache()` 刷新缓存；
 * - 参数 `maxP`、`baseR` 可由编辑器通过 `getConfigFields()` / `onConfigUpdate()` 修改；
 * - 注释仅用于增强可维护性，未改变原有实现逻辑。
 */
export class StrainCylinderSensor extends BaseComponent {
    /**
     * 构造器
     * @param {Object} config - 配置项（支持 baseR, maxP 等）
     * @param {Object} sys - 全局系统对象（用于触发重绘或配置回调）
     */
    constructor(config, sys) {
        super(config, sys);

        this.type = 'pressure_sensor';
        this.cache = 'fixed';
        this._initGroups();
        this.scale = 1.2;
        // 核心物理参数
        this.baseR = config.baseR || 120;         // 基准电阻 (Ω)
        this.maxP = config.maxP || 1;             // 最大量程 (MPa)
        this.gf = 2.0;                             // 灵敏度系数（用于将应变映射为电阻变化）

        // 动态状态
        this.currentP = 0;
        this.r1 = this.baseR;
        this.r2 = this.baseR;

        this.config = { id: this.id, baseR: this.baseR, maxP: this.maxP };

        // 构建视觉与端口
        this.initVisuals();
        this.initPorts();
    }

    initPorts() {
        // 初始化并注册外部端口
        this.ports = [];
        const s = this.scale;

        // 接线柱：左侧为 r1，右侧为 r2，使用 `addPort` 将端口放置在外壳边缘，便于连线
        this.addPort(-32 * s, -30 * s, 'r1l', 'wire', 'p');
        this.addPort(-32 * s, 10 * s, 'r1r', 'wire');
        this.addPort(32 * s, 10 * s, 'r2l', 'wire', 'p');
        this.addPort(32 * s, 50 * s, 'r2r', 'wire');

        // 底部气路入口（管道端口）
        this.addPort(0, 85 * s, 'i', 'pipe', 'in');
    }

    initVisuals() {
        // 清理组并重建视觉元素
        this.group.destroyChildren();
        const s = this.scale;
        const stroke = '#2c3e50';
        const sw = 2 * s;

        // 1) 外部气室（开放上端）：用线条表现左右与底部边界，内部用半透明矩形填充
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
        const chamberBG = new Konva.Rect({
            x: -30 * s, y: 60 * s, width: 60 * s, height: 25 * s,
            fill: '#bdc3c7', opacity: 0.3
        });

        // 2) 传感器外壳与支架：采用折线勾勒轮廓
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

        // 3) 内部双梁（左右两根），用于承受膜片的力并传递给应变片
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

        // 4) 弹性膜片（初始为直线）：根据压力值使用 `tension` 产生弧形变形
        this.diaphragm = new Konva.Line({
            points: [-30 * s, 60 * s, 0, 60 * s, 30 * s, 60 * s],
            stroke: '#2980b9',
            strokeWidth: 3 * s,
            tension: 0.5,
            lineCap: 'round'
        });

        // 5) 应变片视觉表示：左侧 r1、右侧 r2，随梁与膜片变形进行缩放以提示电阻变化
        this.visualR1 = new Konva.Rect({
            x: -18 * s, y: -30 * s,
            width: 6 * s, height: 36 * s,
            fill: '#e74c3c', stroke: '#c0392b', strokeWidth: 0.5 * s
        });
        this.visualR2 = new Konva.Rect({
            x: 12 * s, y: 20 * s,
            width: 12 * s, height: 16 * s,
            fill: '#fd2c08', stroke: '#f30808', strokeWidth: 0.5 * s
        });

        const labelR1 = new Konva.Text({ x: -24 * s, y: -40 * s, text: 'r1', fontSize: 10 * s });
        const labelR2 = new Konva.Text({ x: 17 * s, y: -2 * s, text: 'r2', fontSize: 10 * s });

        this._staticGroup.add(housing, chamberBG, chamberPath, this.beamL, this.beamR, this.diaphragm, this.visualR1, this.visualR2, labelR1, labelR2);
    }

    update(pressure) {
        // 1) 参数保护与归一化：避免除 0 或负值导致异常
        const s = this.scale || 1.2;
        const maxP = this.maxP || 1;
        this.currentP = Math.max(0, pressure);
        let ratio = this.currentP / maxP;
        ratio = Math.max(0, Math.min(1, ratio));

        // 2) 物理映射：将压力（归一化后）转换为应变，再映射为电阻变化
        const strain = ratio * 0.005; // 经验性缩放因子以控制变化幅度
        // r1 随梁缩短而减小，r2 随压扁而增大
        this.r1 = this.baseR * (1 - this.gf * strain);
        this.r2 = this.baseR * (1 + this.gf * strain);

        // 3) 视觉反馈：膜片上凸、梁高度变化与应变片形变
        const flexHeight = ratio * 15 * s;
        this.diaphragm.points([-30 * s, 60 * s, 0, (60 * s) - flexHeight, 30 * s, 60 * s]);
        this.beamL.height(120 * s - flexHeight);
        this.beamR.height(120 * s - flexHeight);

        // 应变片视觉缩放以提示电阻变化（非精确到像素的物理仿真，仅用于展示）
        this.visualR1.scaleY(1 - ratio * 0.3);
        this.visualR2.scaleY(1 - ratio * 0.5);
        this.visualR2.scaleX(1 + ratio * 0.1);

        // 4) 刷新缓存使 Konva 更新显示
        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label: '器件名称', key: 'id', type: 'text' },
            { label: '基准电阻 (Ω)', key: 'baseR', type: 'number' },
            { label: '最大量程 (MPa)', key: 'maxP', type: 'number' }
        ];
    }

    onConfigUpdate(newConfig) {
        // 接收编辑器配置并解析为内部数值
        this.id = newConfig.id;
        this.baseR = parseFloat(newConfig.baseR);
        this.maxP = parseFloat(newConfig.maxP);
        this.config = newConfig;
    }


    destroy() {
        super.destroy?.();
    }
}
