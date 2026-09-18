/**
 * ContactCurveDisplay 接触器特性曲线显示组件。
 *
 * 作用：它不是普通电气元件，而是一个用于展示接触器吸力/电流随气隙变化关系的图形面板。
 * 其核心功能是把接触器当前状态（如动铁心位置、线圈参数、通电状态）转化为二维曲线，并在画布中
 * 动态显示“电流特性曲线”和“吸力特性曲线”，帮助用户理解接触器在不同气隙下的性能表现。
 *
 * 设计要点：
 * 1. 通过坐标系可视化气隙、吸力和电流三者之间的关系；
 * 2. 读取系统中的接触器组件 km1 的参数与状态；
 * 3. 在仿真循环中动态更新当前工作点，并绘制辅助竖线与数值标签；
 * 4. 使用缓存与静态/动态层分离，避免每帧重新构造大量图形对象，提升渲染效率。
 */
import { BaseComponent } from './BaseComponent.js';

// 面板的默认尺寸与最小尺寸，确保组件在较小画布中也不会失真。
const defaultW = 480;
const defaultH = 360;
const minW = 300;
const minH = 280;

export class ContactCurveDisplay extends BaseComponent {
    constructor(config, sys) {
        // 调用父类构造函数，完成组件公共的 group、交互、系统引用等初始化。
        super(config, sys);

        // 根据配置或默认值设置面板宽高，并保留最小尺寸约束。
        this.width  = Math.max(minW, config.width  || defaultW);
        this.height = Math.max(minH, config.height || defaultH);

        // 设置组件类型，便于系统识别该组件是一个展示仪表，而不是实际触点设备。
        this.type  = 'contact-curve';
        // 固定缓存用于静态外观，加快渲染。
        this.cache = 'fixed';

        // 初始化分组和图形几何，再执行参数初始化与初始化绘制。
        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        // 当前组件只保留基础配置中的 id，其他信息由动态状态或系统对象实时计算。
        this.config = { id: this.id};
    }

    _recalcGeometry() {
        // 定义坐标系边距：上、右、下、左分别偏移一定距离，避免图表贴边。
        const m = { top: 30, right: 45, bottom: 45, left: 45 };
        this._margin = m;
        // 图表绘图区的实际宽高，去掉左右上下留白后剩余区域用于绘制曲线。
        this._plotW = this.width - m.left - m.right;
        this._plotH = this.height - m.top - m.bottom;
    }

    _initParameters(config) {
        // 最大气隙值，单位毫米，控制横坐标范围。
        this._gapMax = 14;
        // 线圈等效电阻，影响电流计算结果。
        this._R = 1000;
        // 线圈在开路和闭合状态下的电感值，决定电流随气隙变化的敏感程度。
        this._L_open = 0.5;
        this._L_closed = 15;
        // 供电电压和频率，构成交流电流的基本计算条件。
        this._V = 220;
        this._f = 50;
        // 缓存计算结果，避免每一帧重复扫描 200 个样本带来的性能损耗。
        this._cached = null;
    }

    _init() {
        // 先绘制静态背景和轴线，再创建动态元素，便于后续更新曲线和工作点。
        this._drawStaticParts();
        this._createDynamicNodes();
    }

    _getContactor() {
        // 该面板主要跟踪系统中的接触器 km1，例如用于演示吸合/释放过程。
        return this.sys?.comps?.['km1'] || null;
    }

    _calcInductance(gapRatio) {
        // 线圈电感随气隙增大而减小，采用二次项衰减模拟真实接触器特性。
        return this._L_open + (this._L_closed - this._L_open) * (1 - gapRatio) * (1 - gapRatio);
    }

    _calcCurrent(gapRatio) {
        // 根据电感值计算感抗 X = 2πfL，并进而得到交流电流幅值 I = V / sqrt(R² + X²)。
        const L = this._calcInductance(gapRatio);
        const X = 2 * Math.PI * this._f * L;
        return this._V / Math.sqrt(this._R * this._R + X * X);
    }

    _calcForce(gapRatio) {
        // 吸力近似由基底吸力与气隙影响系数叠加，气隙越小，吸力越强。
        const F_base = 40;
        const F_boost = 10 * (1 - gapRatio) * (1 - gapRatio);
        return F_base + F_boost;
    }

    _ensureCache() {
        // 初次计算时遍历一组采样点，找出电流与吸力的最大值，用于归一化绘图坐标。
        if (this._cached) return;
        let imax = 0, fmax = 0;
        for (let i = 0; i <= 200; i++) {
            const r = i / 200;
            const I = this._calcCurrent(r);
            const F = this._calcForce(r);
            if (I > imax) imax = I;
            if (F > fmax) fmax = F;
        }
        // 给最大值加上 15% 余量，防止曲线贴边导致显示不完整。
        this._cached = { imax: imax * 1.15, fmax: fmax * 1.15 };
    }

    _gapX(ratio) {
        // 将气隙比例映射到坐标系横轴位置：左边缘对应最大气隙，右边缘对应最小气隙。
        return this._margin.left + ratio * this._plotW;
    }

    _valY(val, maxVal) {
        // 把数值映射到纵轴：数值越大，越靠近顶部；数值越小，越靠近底部。
        return this._margin.top + (1 - Math.min(val, maxVal) / maxVal) * this._plotH;
    }

    _calcCurvePoints(fn, maxVal) {
        // 生成某个特性的所有采样点，返回 [x1, y1, x2, y2, ...] 的形式，供 Konva.Line 使用。
        const pts = [];
        for (let i = 0; i <= 200; i++) {
            const r = i / 200;
            pts.push(this._gapX(r), this._valY(fn(r), maxVal));
        }
        return pts;
    }

    _drawStaticParts() {
        // 获取静态分组与图表区域参数，之后统一向该组添加所有固定背景和坐标轴。
        const g = this._staticGroup;
        const m = this._margin;
        const pW = this._plotW;
        const pH = this._plotH;
        const w = this.width;
        const h = this.height;

        // 整个组件背景使用浅灰色，突出这是一个图表展示窗口。
        g.add(new Konva.Rect({ x: 0, y: 0, width: w, height: h, fill: '#f9f9f9', stroke: '#888', strokeWidth: 1 }));
        // 绘制图表主区域，白底加边框，便于观察曲线与坐标系。
        g.add(new Konva.Rect({ x: m.left, y: m.top, width: pW, height: pH, fill: '#fff', stroke: '#ccc', strokeWidth: 1 }));

        // 画出网格线，便于读取曲线数值和趋势。
        for (let i = 0; i <= 5; i++) {
            const y = m.top + pH * i / 5;
            g.add(new Konva.Line({ points: [m.left, y, m.left + pW, y], stroke: '#e0e0e0', strokeWidth: 0.5 }));
        }
        for (let i = 0; i <= 4; i++) {
            const x = m.left + pW * i / 4;
            g.add(new Konva.Line({ points: [x, m.top, x, m.top + pH], stroke: '#e0e0e0', strokeWidth: 0.5 }));
        }

        // 画出坐标轴，确保图表具有明确的参考框架。
        g.add(new Konva.Line({ points: [m.left, m.top, m.left, m.top + pH], stroke: '#333', strokeWidth: 1.5 }));
        g.add(new Konva.Line({ points: [m.left, m.top + pH, m.left + pW, m.top + pH], stroke: '#333', strokeWidth: 1.5 }));

        // 坐标轴下方和左侧添加文字说明，标识横轴与纵轴含义。
        g.add(new Konva.Text({ x: m.left + pW / 2 - 45, y: m.top + pH - 20, width: 80, height: 18,
            text: '气隙 δ (mm)', fontSize: 15, fill: '#333', align: 'center', fontFamily: 'Arial' }));
        g.add(new Konva.Text({ x: 6, y: m.top + pH / 2 + 60, width: 40, height: 80,
            text: '电流 (A)', fontSize: 15, fill: '#0066cc', align: 'center', fontFamily: 'Arial' }));
        g.add(new Konva.Text({ x: w - 48, y: m.top + pH / 2 - 60, width: 40, height: 80,
            text: '吸力 (N)', fontSize: 15, fill: '#cc3300', align: 'center', fontFamily: 'Arial' }));

        // 添加横轴刻度：气隙从 0 到最大值的一半范围。
        for (let i = 0; i <= 4; i++) {
            const x = m.left + pW * i / 4;
            const gap = (this._gapMax / 2) * i / 4;
            g.add(new Konva.Line({ points: [x, m.top + pH, x, m.top + pH + 4], stroke: '#333', strokeWidth: 1 }));
            g.add(new Konva.Text({ x: x - 12, y: m.top + pH + 6, width: 24, height: 14,
                text: gap.toFixed(1), fontSize: 12, fill: '#666', align: 'center', fontFamily: 'Arial' }));
        }

        // 为两条曲线添加图例：蓝色为电流特性，橙色为吸力特性。
        g.add(new Konva.Line({ points: [m.left + 10, m.top + 12, m.left + 35, m.top + 12], stroke: '#0066cc', strokeWidth: 2 }));
        g.add(new Konva.Text({ x: m.left + 38, y: m.top + 5, width: 70, height: 14,
            text: '电流特性', fontSize: 13, fill: '#0066cc', fontFamily: 'Arial' }));
        g.add(new Konva.Line({ points: [m.left + 110, m.top + 12, m.left + 135, m.top + 12], stroke: '#cc3300', strokeWidth: 2 }));
        g.add(new Konva.Text({ x: m.left + 138, y: m.top + 5, width: 70, height: 14,
            text: '吸力特性', fontSize: 13, fill: '#cc3300', fontFamily: 'Arial' }));
    }

    _createDynamicNodes() {
        // 动态层用于曲线和工作点，这些内容会随仿真状态持续更新。
        const g = this._dynamicGroup;
        this._currentLine = new Konva.Line({ points: [], stroke: '#0066cc', strokeWidth: 2, lineCap: 'round', lineJoin: 'round' });
        this._forceLine = new Konva.Line({ points: [], stroke: '#cc3300', strokeWidth: 2, lineCap: 'round', lineJoin: 'round' });
        this._currentDot = new Konva.Circle({ x: 0, y: 0, radius: 5, fill: '#0066cc', stroke: '#fff', strokeWidth: 1.5, visible: false });
        this._forceDot = new Konva.Circle({ x: 0, y: 0, radius: 5, fill: '#cc3300', stroke: '#fff', strokeWidth: 1.5, visible: false });
        this._gapLine = new Konva.Line({ points: [], stroke: '#999', strokeWidth: 1, dash: [4, 3], visible: false });
        this._infoText = new Konva.Text({ x: this._margin.left + 5, y: this.height - 20, fontSize: 14, fill: '#000602', fontFamily: 'Arial', fontstyle: 'bold', visible: false });
        g.add(this._currentLine, this._forceLine, this._currentDot, this._forceDot, this._gapLine, this._infoText);
    }

    _syncParams() {
        // 根据接触器状态同步其线圈电阻和电感参数，以保证曲线与实际接触器一致。
        const km = this._getContactor();
        if (!km) return;
        const R = km._coilResistance || 1000;
        const Lo = km._coilInductanceOpen || 0.5;
        const Lc = km._coilInductanceClosed || 15;
        if (R !== this._R || Lo !== this._L_open || Lc !== this._L_closed) {
            this._R = R;
            this._L_open = Lo;
            this._L_closed = Lc;
            this._cached = null;
        }
    }

    _updateDynamic() {
        // 首先同步接触器参数，再计算曲线归一化最大值，确保绘制范围稳定。
        this._syncParams();
        this._ensureCache();
        const c = this._cached;

        // 用采样点生成两条完整特性曲线：蓝色为电流曲线，橙色为吸力曲线。
        this._currentLine.points(this._calcCurvePoints((r) => this._calcCurrent(r), c.imax));
        this._forceLine.points(this._calcCurvePoints((r) => this._calcForce(r), c.fmax));

        // 获取当前接触器实例，判断其是否吸合并获取当前气隙值。
        const km = this._getContactor();
        if (!km) return;

        const curGap = km._armOffsetCur !== undefined ? Math.min(km._armOffsetCur, this._gapMax) : this._gapMax;
        const ratio = curGap / this._gapMax;
        const energized = km.getState() === 'on' || !!km._faultStuck;

        // 只有在接触器处于通电/吸合状态时才显示当前工作点和辅助线。
        if (energized) {
            const x = this._gapX(ratio);
            const curVal = this._calcCurrent(ratio);
            const forceVal = this._calcForce(ratio);
            this._currentDot.position({ x, y: this._valY(curVal, c.imax) });
            this._currentDot.visible(true);
            this._forceDot.position({ x, y: this._valY(forceVal, c.fmax) });
            this._forceDot.visible(true);
            this._gapLine.points([x, this._margin.top, x, this._margin.top + this._plotH]);
            this._gapLine.visible(true);
            const gapMM = curGap / 2;
            this._infoText.text(`I = ${curVal.toFixed(3)} A  |  F = ${forceVal.toFixed(1)} N  |  δ = ${gapMM.toFixed(1)} mm`);
            this._infoText.visible(true);
        } else {
            // 未通电时不显示工作点与文本，保留图表背景和曲线，方便对比静态特性。
            this._currentDot.visible(false);
            this._forceDot.visible(false);
            this._gapLine.visible(false);
            this._infoText.visible(false);
        }
    }

    tick(dt) {
        // 在每个仿真步中更新动态曲线和工作点，然后标记为脏状态并按需刷新缓存。
        this._updateDynamic();
        this.markDirty();
        this._refreshIfDirty();
    }

    getConfigFields() {
        // 该组件暂时不需要外部可配置字段，返回空数组即可。
        return [];
    }
}
