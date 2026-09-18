/**
 * TsCurveDisplay 异步电机转矩-转速特性曲线显示组件。
 *
 * 该组件用于在画布上显示异步电机的机械特性曲线，包括参考转矩-转速曲线、不同
 * 参数下的对比曲线、实际电机曲线和负载转矩曲线。组件从系统中的 im01 电机读取
 * 参数与实时状态，将转矩和转速转换为图表坐标，并使用动态圆点标记当前工作点。
 *
 * 主要功能：
 * 1. 计算异步电机同步转速、最大转矩和转矩-转速特性；
 * 2. 支持恒定转矩负载和风机平方转矩负载曲线；
 * 3. 绘制坐标轴、网格、刻度、单位和多条参考曲线；
 * 4. 实时显示电机转速、转矩和负载转矩工作点；
 * 5. 根据电机是否运行切换实际曲线和负载曲线的实线/虚线样式。
 */
import { BaseComponent } from './BaseComponent.js';

// 图表默认尺寸和允许的最小尺寸。
const defaultW = 570;
const defaultH = 420;
const minW = 280;
const minH = 280;

export class TsCurveDisplay extends BaseComponent {
    constructor(config, sys) {
        // 调用父类构造函数，初始化组件公共属性和系统引用。
        super(config, sys);

        // 限制图表尺寸，保证坐标轴、刻度和曲线有足够显示空间。
        this.width  = Math.max(minW, config.width  || defaultW);
        this.height = Math.max(minH, config.height || defaultH);

        // 设置组件类型，供系统识别为转矩-转速曲线显示器。
        this.type  = 'ts-curve';
        // 静态坐标框架和网格启用固定缓存。
        this.cache = 'fixed';

        // 按统一生命周期初始化图层、几何参数、运行参数和图形节点。
        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        // 保存组件标识配置。
        this.config = { id: this.id};
    }

    _recalcGeometry() {
        // 设置图表四周留白，并计算实际绘图区宽高。
        const m = { top: 30, right: 30, bottom: 40, left: 50 };
        this._margin = m;
        this._plotW = this.width - m.left - m.right;
        this._plotH = this.height - m.top - m.bottom;
    }

    _initParameters(config) {
        // 读取象限模式，并初始化电机工作点和负载曲线状态。
        this.quadrants = config.quadrants || 1;
        this.sMax = 1.0;
        this._currentSlip = 0;
        this._currentTe = 0;
        this._currentLoadT = 0;
        this._motorRunning = false;
        this._loadType = 'constant';
    }

    _init() {
        // 先绘制静态图表框架，再创建动态曲线和工作点节点。
        this._drawStaticParts();
        this._createDynamicNodes();
    }

    _getMotor() {
        // 获取系统中约定 ID 为 im01 的异步电机组件。
        return this.sys?.comps?.['im01'] || null;
    }

    _calcTMax() {
        // 根据电机等效参数估算图表的最大转矩坐标范围。
        const motor = this._getMotor();
        if (!motor) return 200;
        // 使用额定相电压和系统频率建立参考计算条件。
        const f = 50;
        const V_ph = 220;
        const R1 = motor.R1 || 0.5;
        const X_total = 2 * Math.PI * f * ((motor.Lsigma1 || 0) + (motor.Lsigma2 || 0));
        const sqrt_term = Math.sqrt(R1 * R1 + X_total * X_total);
        const omega_sync = 2 * Math.PI * f / (motor.polePairs || 2);
        const T_max = (3 * V_ph * V_ph) / (2 * omega_sync * (R1 + sqrt_term));
        // 将最大转矩向上取整到 50N·m 的刻度倍数。
        const rounded = Math.ceil(T_max / 50) * 50;
        return Math.max(rounded, 50);
    }

    _calcNSync(f) {
        // 根据频率和电机极对数计算同步转速。
        const motor = this._getMotor();
        if (!motor) return 1500;
        return 60 * f / (motor.polePairs || 2);
    }

    _nMax() {
        // 计算转速坐标轴上限，使其略高于同步转速。
        const motor = this._getMotor();
        if (!motor) return 1600;
        const f = this.sys?.voltageSolver?._systemFreq || 50;
        const nSync = 60 * f / (motor.polePairs || 2);
        return Math.ceil((nSync + 100) / 100) * 100;
    }

    _nToY(n) {
        // 将机械转速映射为画布 Y 坐标；转速越高，位置越靠近图表顶部。
        const nMax = this._nMax();
        const ratio = Math.max(0, Math.min(1, 1 - n / nMax));
        return this._margin.top + ratio * this._plotH;
    }

    _calcCurve(V_ph, f, R2) {
        // 根据给定相电压、频率和转子电阻计算一条转矩-转速曲线。
        const motor = this._getMotor();
        if (!motor) return [];
        const R1 = motor.R1 || 0.5;
        const X_total = 2 * Math.PI * f * ((motor.Lsigma1 || 0) + (motor.Lsigma2 || 0));
        const omega_sync = 2 * Math.PI * f / (motor.polePairs || 2);
        const nSync = this._calcNSync(f);
        const steps = 200;
        const pts = [];
        // 沿转差率 0~sMax 采样，生成曲线坐标点。
        for (let i = 0; i <= steps; i++) {
            const s = this.sMax * i / steps;
            const sc = Math.max(0.001, s);
            const R_load = R1 + R2 / sc;
            const Z_sq = R_load * R_load + X_total * X_total;
            const Te = (3 * V_ph * V_ph * (R2 / sc)) / (omega_sync * Z_sq);
            const n = nSync * (1 - s);
            pts.push(this._tToX(Te), this._nToY(n));
        }
        return pts;
    }

    _calcTsCurve() {
        // 使用实际电机电压、系统频率和转子电阻计算当前电机特性曲线。
        const motor = this._getMotor();
        if (!motor) return [];
        const f = this.sys?.voltageSolver?._systemFreq || 50;
        const V_ph = (motor._Vrms && motor._Vrms > 1) ? motor._Vrms : 220;
        const R2 = motor.R2 || 0.46;
        return this._calcCurve(V_ph, f, R2);
    }

    _calcRefCurve() {
        // 使用标准参考参数生成基准特性曲线。
        return this._calcCurve(220, 50, 0.46);
    }

    _calcLoadCurve() {
        // 根据电机当前负载类型生成负载转矩曲线。
        const motor = this._getMotor();
        if (!motor) return [];
        const loadTorque = motor.loadTorque || 0;
        const loadType = motor.loadType || 'constant';
        const f = this.sys?.voltageSolver?._systemFreq || 50;
        const nSync = this._calcNSync(f);
        const steps = 200;
        const pts = [];
        for (let i = 0; i <= steps; i++) {
            const s = this.sMax * i / steps;
            const n = nSync * (1 - s);
            let T_load;
            // 风机负载转矩随机械角速度平方变化，其他负载采用恒定转矩。
            if (loadType === 'fan') {
                const omega_sync = 2 * Math.PI * f / (motor.polePairs || 2);
                const omega_m = omega_sync * (1 - s);
                const fanK = motor.fanK || 0;
                T_load = fanK * omega_m * Math.abs(omega_m);
            } else {
                T_load = loadTorque;
            }
            pts.push(this._tToX(Math.abs(T_load)), this._nToY(n));
        }
        return pts;
    }

    _tToX(T) {
        // 将转矩限制在图表范围内，并映射到画布 X 坐标。
        const tMax = this._calcTMax();
        return this._margin.left + (Math.min(tMax, Math.max(0, T)) / tMax) * this._plotW;
    }

    _drawStaticParts() {
        // 绘制图表背景、绘图区、网格、坐标轴、转速单位和转矩刻度线。
        const g = this._staticGroup;
        const m = this._margin;
        const pW = this._plotW;
        const pH = this._plotH;
        const w = this.width;
        const h = this.height;
        g.add(new Konva.Rect({ x: 0, y: 0, width: w, height: h, fill: '#f9f9f9', stroke: '#888', strokeWidth: 1 }));
        g.add(new Konva.Rect({ x: m.left, y: m.top, width: pW, height: pH, fill: '#fff', stroke: '#ccc', strokeWidth: 1 }));

        // 绘制水平网格线。
        for (let i = 0; i <= 5; i++) {
            const y = m.top + pH * i / 5;
            g.add(new Konva.Line({ points: [m.left, y, m.left + pW, y], stroke: '#e0e0e0', strokeWidth: 0.5 }));
        }
        // 绘制垂直网格线。
        for (let i = 0; i <= 4; i++) {
            const x = m.left + pW * i / 4;
            g.add(new Konva.Line({ points: [x, m.top, x, m.top + pH], stroke: '#e0e0e0', strokeWidth: 0.5 }));
        }

        // 绘制纵轴和横轴。
        g.add(new Konva.Line({ points: [m.left, m.top, m.left, m.top + pH], stroke: '#333', strokeWidth: 1.5 }));
        g.add(new Konva.Line({ points: [m.left, m.top + pH, m.left + pW, m.top + pH], stroke: '#333', strokeWidth: 1.5 }));

        // 标注转速轴单位。
        g.add(new Konva.Text({ x: 6, y: m.top-25, width: m.left+20, height: 18,
            text: 'n (r/min)', fontSize: 14, fill: '#333', align: 'center', fontFamily: 'Arial' }));
        for (let i = 0; i <= 4; i++) {
            const x = m.left + pW * i / 4;
            g.add(new Konva.Line({ points: [x, m.top + pH, x, m.top + pH + 4], stroke: '#333', strokeWidth: 1 }));
        }
    }

    _createDynamicNodes() {
        // 创建参考曲线、实际曲线、负载曲线、工作点、刻度文字和信息文字节点。
        const g = this._dynamicGroup;
        const m = this._margin;

        this._refLine  = new Konva.Line({ points: [], stroke: '#99bbdd', strokeWidth: 1.5, dash: [6, 4], lineCap: 'round', lineJoin: 'round' });
        this._ref2Line = new Konva.Line({ points: [], stroke: '#dd9988', strokeWidth: 1.5, dash: [6, 4], lineCap: 'round', lineJoin: 'round' });
        this._ref3Line = new Konva.Line({ points: [], stroke: '#88bb99', strokeWidth: 1.5, dash: [6, 4], lineCap: 'round', lineJoin: 'round' });
        this._tsLine = new Konva.Line({ points: [], stroke: '#0066cc', strokeWidth: 2, dash: [8, 4], lineCap: 'round', lineJoin: 'round' });
        this._loadLine = new Konva.Line({ points: [], stroke: '#cc6600', strokeWidth: 2, dash: [8, 4], lineCap: 'round', lineJoin: 'round' });
        this._motorDot = new Konva.Circle({ x: 0, y: 0, radius: 6, fill: '#ff0000', stroke: '#fff', strokeWidth: 1.5, visible: false });
        this._loadDot = new Konva.Circle({ x: 0, y: 0, radius: 6, fill: '#0066ff', stroke: '#fff', strokeWidth: 1.5, visible: false });
        this._infoText = new Konva.Text({ x: m.left + 5, y: this.height - 20, fontSize: 16, fill: '#022506', fontFamily: 'Arial', visible: false });

        // 创建横轴转矩刻度标签。
        this._xTickLabels = [];
        for (let i = 0; i <= 4; i++) {
            const x = m.left + this._plotW * i / 4;
            const label = new Konva.Text({ x: x - 12, y: m.top + this._plotH + 4, width: 24, text: '',
                fontSize: 10, fill: '#666', align: 'center', fontFamily: 'Arial' });
            this._xTickLabels.push(label);
            g.add(label);
        }
        // 创建纵轴转速刻度线和标签，数量固定以便运行时复用。
        this._yTickMarks = [];
        this._yTickLabels = [];
        for (let i = 0; i < 20; i++) {
            const mark = new Konva.Line({ points: [0,0,0,0], stroke: '#333', strokeWidth: 1, visible: false });
            const label = new Konva.Text({ x: 0, y: 0, width: m.left - 6, text: '',
                fontSize: 10, fill: '#666', align: 'right', fontFamily: 'Arial', visible: false });
            this._yTickMarks.push(mark);
            this._yTickLabels.push(label);
            g.add(mark, label);
        }
        // 标注横轴转矩单位。
        this._tAxisTitle = new Konva.Text({ x: m.left + this._plotW - 55, y: m.top + this._plotH + 2,
            text: 'T (N·m)', fontSize: 11, fill: '#333', fontFamily: 'Arial' });
        g.add(this._tAxisTitle);

        g.add(this._refLine, this._ref2Line, this._ref3Line, this._tsLine, this._loadLine, this._motorDot, this._loadDot, this._infoText);
    }

    _updateDynamic() {
        // 从电机组件读取实时转差率、转矩、负载和运行状态。
        const motor = this._getMotor();
        if (!motor) return;

        this._currentSlip = motor.slip !== undefined ? motor.slip : 0;
        this._currentTe = motor._Te || 0;
        this._currentLoadT = Math.abs(motor._appliedLoadTorque || 0);
        this._motorRunning = motor._phaseSeq !== 0 || (motor._omega_m && Math.abs(motor._omega_m) > 0.5);
        this._loadType = motor.loadType || 'constant';

        // 根据当前电机参数更新横轴转矩刻度。
        const tMax = this._calcTMax();
        for (let i = 0; i <= 4; i++) {
            const val = (tMax * i / 4).toFixed(0);
            this._xTickLabels[i].text(val);
        }
        // 根据同步转速更新纵轴转速刻度。
        const nMax = this._nMax();
        const nSteps = Math.floor(nMax / 200);
        for (let i = 0; i < 20; i++) {
            if (i <= nSteps) {
                const nv = i * 200;
                const y = this._margin.top + (1 - nv / nMax) * this._plotH;
                this._yTickMarks[i].points([this._margin.left - 4, y, this._margin.left, y]);
                this._yTickMarks[i].visible(true);
                this._yTickLabels[i].text(String(nv));
                this._yTickLabels[i].position({ x: 0, y: y - 7 });
                this._yTickLabels[i].visible(true);
            } else {
                this._yTickMarks[i].visible(false);
                this._yTickLabels[i].visible(false);
            }
        }

        // 更新基准曲线、对比曲线、实际电机曲线和负载曲线。
        this._refLine.points(this._calcRefCurve());
        this._ref2Line.points(this._calcCurve(110, 25, 0.46));
        this._ref3Line.points(this._calcCurve(220, 50, 1.38));
        this._tsLine.points(this._calcTsCurve());
        this._loadLine.points(this._calcLoadCurve());

        // 电机运行时使用实线显示实际曲线和负载曲线，停止时使用虚线。
        if (this._motorRunning) {
            this._tsLine.dash([]);
            this._loadLine.dash([]);
        } else {
            this._tsLine.dash([8, 4]);
            this._loadLine.dash([8, 4]);
        }

        // 根据当前频率和转差率计算实际机械转速。
        const freq = this.sys?.voltageSolver?._systemFreq || 50;
        const nSync = this._calcNSync(freq);
        const s = this._currentSlip;
        const n = nSync * (1 - s);
        // 只有电机正在运行且转差率有效时才显示两个工作点和信息文字。
        if (this._motorRunning && s >= 0 && s <= this.sMax && tMax > 0) {
            const sx = this._tToX(Math.abs(this._currentTe));
            const sy = this._nToY(n);
            this._motorDot.position({ x: sx, y: sy });
            this._motorDot.visible(true);

            this._loadDot.position({ x: this._tToX(Math.min(tMax * 1.2, this._currentLoadT)), y: sy });
            this._loadDot.visible(true);

            this._infoText.text(`n = ${n.toFixed(0)} r/min  Te = ${Math.abs(this._currentTe).toFixed(1)} N·m  负载 = ${this._currentLoadT.toFixed(1)} N·m`);
            this._infoText.visible(true);
        } else {
            this._motorDot.visible(false);
            this._loadDot.visible(false);
            this._infoText.visible(false);
        }
    }

    tick(dt) {
        // 每个仿真步更新曲线数据并刷新图表显示。
        this._updateDynamic();
        this.markDirty();
        this._refreshIfDirty();
    }

    getConfigFields() {
        // 配置面板当前开放象限模式选项。
        return [
            { label: '象限模式', key: 'quadrants', type: 'select', options: [
                { value: 1, label: '第 1 象限' },
            ]},
        ];
    }
}
