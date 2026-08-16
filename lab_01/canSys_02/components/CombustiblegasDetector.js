import { BaseComponent } from './BaseComponent.js';

/**
 * 可燃气体探测器仿真组件
 * （Catalytic Bead / Pellistor Combustible Gas Detector）
 *
 * ── 工作原理（催化燃烧 + 惠斯顿电桥）────────────────────────
 *
 *  催化珠（Pellistor）传感器由两个铂丝线圈组成：
 *
 *  ① 探测珠（Detector / Active bead）：
 *     铂线圈缠绕在氧化铝载体上，表面涂覆催化剂（Pd、Pt）
 *     工作温度约 500°C，可燃气体在表面无焰燃烧（氧化）
 *     燃烧放热 → 珠温升高 → 铂阻值增大 ΔR_d
 *
 *  ② 补偿珠（Compensator / Reference bead）：
 *     结构相同但无催化剂涂层
 *     补偿温度、湿度等环境变化
 *
 *  惠斯顿电桥输出：
 *     V_bridge = V_s × [ΔR_d / (2×R₀ + ΔR_d)]
 *     ≈ V_s × ΔR_d / (2×R₀)
 *
 *  ΔR 与气体浓度的关系：
 *     ΔR_d = α × C_gas × R₀
 *     α  — 气体灵敏度系数（与气体种类有关）
 *     C_gas — 气体浓度 (%LEL)
 *
 *  因此桥路输出：
 *     V_bridge ≈ V_s × α × C_gas / 2
 *     → 4-20mA 电流输出（0~100% LEL）
 *
 *  常用可燃气体爆炸下限（LEL）：
 *     甲烷 CH₄   5.0%  体积分数（vol%）
 *     丙烷 C₃H₈  2.1%  vol%
 *     氢气 H₂    4.0%  vol%
 *     乙醇 C₂H₅OH 3.3%  vol%
 *
 * ── 报警等级 ─────────────────────────────────────────────────
 *  LEVEL 1（低报）  ≥ 20% LEL  → 黄色预警
 *  LEVEL 2（高报）  ≥ 50% LEL  → 红色报警 + 联锁
 *  LEVEL 3（危险）  ≥ 100% LEL → 深红色危险 + 紧急停机
 *
 * ── 组件结构 ─────────────────────────────────────────────────
 *  ① 探头外壳（防爆型 Ex d/Ex ia）
 *  ② 催化燃烧腔（双珠剖面动画）
 *     - 探测珠（高温红色辉光，随浓度增强）
 *     - 补偿珠（稳定蓝白辉光）
 *     - 气体扩散示意（颗粒云）
 *  ③ 惠斯顿电桥等效电路（动态阻值变化）
 *  ④ 双通道传感器波形（V_detect + V_compensate + V_bridge）
 *  ⑤ 多级报警指示面板（LED + 文字状态）
 *  ⑥ 仪表 LCD（%LEL + 气体种类 + 4-20mA）
 *  ⑦ 底部数据面板（完整状态字）
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  wire_vcc  — 电源 24VDC
 *  wire_gnd  — 接地
 *  wire_out  — 4-20mA 模拟量输出
 *  wire_alm1 — 报警继电器 1（低报）
 *  wire_alm2 — 报警继电器 2（高报）
 *
 * ── 气路求解器集成 ────────────────────────────────────────────
 *  special = 'none'
 *  update(conc_pct_lel) — 外部注入浓度 %LEL
 */
export class CombustibleGasDetector extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width = Math.max(360, config.width || 400);
        this.height = Math.max(360, config.height || 400);

        this.type = 'combustible_gas';
        this.special = 'none';
        this.cache = 'fixed';

        // ── 传感器参数 ──
        this.gasType = config.gasType || 'CH4';   // 气体类型
        this.R0 = config.R0 || 100;     // 珠片基准电阻 Ω
        this.alpha = config.alpha || 0.006;   // 灵敏度系数
        this.Vs = config.Vs || 2.0;     // 桥路供电电压 V
        this.workTemp = config.workTemp || 500;     // 工作温度 °C
        this.alm1LEL = config.alm1LEL || 20;     // 低报 %LEL
        this.alm2LEL = config.alm2LEL || 50;     // 高报 %LEL
        this.alm3LEL = config.alm3LEL || 100;    // 危险 %LEL
        this.maxLEL = config.maxLEL || 100;    // 量程 %LEL
        this.failSafe = config.failSafe || true;   // 故障安全型

        // 气体 LEL 对照表
        this._gasDB = {
            CH4: { name: '甲烷', lel: 5.0, uel: 15.0, color: '#42a5f5', alpha: 0.006 },
            C3H8: { name: '丙烷', lel: 2.1, uel: 9.5, color: '#ffa726', alpha: 0.007 },
            H2: { name: '氢气', lel: 4.0, uel: 75.0, color: '#26c6da', alpha: 0.008 },
            C2H5OH: { name: '乙醇', lel: 3.3, uel: 19.0, color: '#ef9a9a', alpha: 0.006 },
            C4H10: { name: '丁烷', lel: 1.8, uel: 8.5, color: '#a5d6a7', alpha: 0.007 },
        };

        // ── 状态 ──
        this.concentration = config.initConc || 0;   // %LEL
        this._manualConc = config.initConc || 0;
        this.vBridge = 0;      // 电桥输出电压 V
        this.vDetect = 0;      // 探测珠电压 V
        this.vCompen = 0;      // 补偿珠电压 V
        this.rDetect = this.R0;
        this.rCompen = this.R0;
        this.outCurrent = 4;      // 4-20mA
        this.detectTemp = 500;    // 探测珠温度 °C
        this.powered = true;
        this.isBreak = false;
        this.isPoison = false;  // 传感器中毒（硅化物等）
        this.alm1 = false;
        this.alm2 = false;
        this.alm3 = false;

        // ── 动画 ──
        this._phase = 0;
        this._gasParticles = [];
        this._heatGlow = 0;       // 探测珠热辉光

        // ── 波形缓冲 ──
        this._wavLen = 240;
        this._wavConc = new Float32Array(this._wavLen).fill(0);
        this._wavBridge = new Float32Array(this._wavLen).fill(0);
        this._wavDet = new Float32Array(this._wavLen).fill(0);
        this._wavAcc = 0;

        // ── 拖拽 ──
        this._dragActive = false;
        this._dragStartY = 0;
        this._dragStartC = 0;

        // ── 几何布局 ──
        // 探头腔体（左侧主区）
        this._sensorX = 10;
        this._sensorY = 36;
        this._sensorW = Math.round(this.width * 0.46);
        this._sensorH = Math.round(this.height * 0.52);

        // 双珠位置（腔体内）
        this._detCX = this._sensorX + this._sensorW * 0.32;
        this._detCY = this._sensorY + this._sensorH * 0.50;
        this._comCX = this._sensorX + this._sensorW * 0.68;
        this._comCY = this._detCY;
        this._beadR = Math.round(this._sensorH * 0.13);

        // 惠斯顿电桥图（左下）
        this._bridgeX = this._sensorX;
        this._bridgeY = this._sensorY + this._sensorH + 10;
        this._bridgeW = this._sensorW;
        this._bridgeH = Math.round(this.height * 0.26);

        // 仪表头（右侧）
        this._headX = this._sensorX + this._sensorW + 10;
        this._headY = this._sensorY;
        this._headW = this.width - this._headX - 8;
        this._headH = Math.round(this.height * 0.44);

        // 波形区（右下）
        this._wavX = this._headX;
        this._wavY = this._headY + this._headH + 10;
        this._wavW = this._headW;
        this._wavH = this.height - this._wavY - 6;

        this._lastTs = null;
        this._animId = null;
        this.knobs = {};

        this.config = {
            id: this.id, gasType: this.gasType,
            alm1LEL: this.alm1LEL, alm2LEL: this.alm2LEL,
            maxLEL: this.maxLEL, R0: this.R0,
        };

        this._init();

        this.addPort(this.width, this._headY + 14, 'vcc', 'wire', 'V+');
        this.addPort(this.width, this._headY + 34, 'gnd', 'wire', 'GND');
        this.addPort(this.width, this._headY + 58, 'out', 'wire', '4-20');
        this.addPort(this.width, this._headY + 78, 'alm1', 'wire', 'ALM1');
        this.addPort(this.width, this._headY + 98, 'alm2', 'wire', 'ALM2');
    }

    // ═══════════════════════════════════════════
    //  初始化
    // ═══════════════════════════════════════════
    _init() {
        this._drawLabel();
        this._drawSensorHousing();
        this._drawDiffusionMesh();
        this._drawBeadCavity();
        this._drawBeadElements();
        this._drawGasParticleLayer();
        this._drawBridgeCircuit();
        this._drawInstrHead();
        this._drawLCD();
        this._drawAlarmPanel();
        this._drawWaveforms();
        this._drawBottomPanel();
        this._setupDrag();
        this._startAnimation();
    }

    _drawLabel() {
        this.group.add(new Konva.Text({
            x: 0, y: -22, width: this.width,
            text: '可燃气体探测器（催化燃烧型 · 惠斯顿电桥）',
            fontSize: 13, fontStyle: 'bold', fill: '#1a2634', align: 'center',
        }));
    }

    // ── 传感器防爆外壳 ───────────────────────
    _drawSensorHousing() {
        const { _sensorX: sx, _sensorY: sy, _sensorW: sw, _sensorH: sh } = this;

        // 防爆外壳（工业黄色涂装）
        const body = new Konva.Rect({
            x: sx, y: sy, width: sw, height: sh,
            fill: '#2a2a2a', stroke: '#1a1a1a', strokeWidth: 2, cornerRadius: 6,
        });
        // 内腔
        this._sensInner = new Konva.Rect({
            x: sx + 8, y: sy + 8, width: sw - 16, height: sh - 16,
            fill: '#0d1018', cornerRadius: 4,
        });
        // 顶部黄色标牌
        const nameBar = new Konva.Rect({
            x: sx, y: sy, width: sw, height: 22,
            fill: '#f9a825', stroke: '#f57f17', strokeWidth: 1, cornerRadius: [6, 6, 0, 0],
        });
        this.group.add(new Konva.Text({
            x: sx + 4, y: sy + 5, width: sw - 8,
            text: '可燃气体探测器  COMBUSTIBLE GAS',
            fontSize: 8.5, fontStyle: 'bold', fill: '#1a1a1a', align: 'center',
        }));
        // 防爆标记
        this.group.add(new Konva.Text({ x: sx + sw - 44, y: sy + sh - 14, text: 'Ex d II CT4', fontSize: 7.5, fill: 'rgba(249,168,37,0.6)' }));
        // 安装孔
        [[sx + 10, sy + 10], [sx + sw - 10, sy + 10], [sx + 10, sy + sh - 10], [sx + sw - 10, sy + sh - 10]].forEach(([bx, by]) => {
            this.group.add(new Konva.Circle({ x: bx, y: by, radius: 4.5, fill: '#1a1a1a', stroke: '#333', strokeWidth: 0.5 }));
            this.group.add(new Konva.Circle({ x: bx - 1, y: by - 1, radius: 1.2, fill: 'rgba(255,255,255,0.2)' }));
        });
        this.group.add(body, this._sensInner, nameBar);
    }

    // ── 扩散网（防爆铜网）────────────────────
    _drawDiffusionMesh() {
        const sx = this._sensorX, sy = this._sensorY;
        const sw = this._sensorW, sh = this._sensorH;

        // 扩散网外框
        const meshFrame = new Konva.Rect({
            x: sx - 18, y: sy + sh / 2 - 30,
            width: 18, height: 60,
            fill: '#7a5c00', stroke: '#5a4000', strokeWidth: 1, cornerRadius: [3, 0, 0, 3],
        });
        // 网格纹理（铜色）
        for (let i = 0; i < 10; i++) {
            this.group.add(new Konva.Line({
                points: [sx - 18, sy + sh / 2 - 30 + i * 6, sx - 2, sy + sh / 2 - 30 + i * 6],
                stroke: '#5a4000', strokeWidth: 0.6,
            }));
        }
        for (let i = 0; i < 4; i++) {
            this.group.add(new Konva.Line({
                points: [sx - 18 + i * 5, sy + sh / 2 - 30, sx - 18 + i * 5, sy + sh / 2 + 30],
                stroke: '#5a4000', strokeWidth: 0.6,
            }));
        }
        // 标注
        this.group.add(new Konva.Text({ x: sx - 32, y: sy + sh / 2 - 40, text: '扩散\n铜网', fontSize: 7.5, fill: '#bf8c00', lineHeight: 1.4 }));
        // 进气箭头
        this.group.add(new Konva.Line({ points: [sx - 38, sy + sh / 2 - 10, sx - 20, sy + sh / 2 - 10], stroke: '#ffa726', strokeWidth: 1.8, lineCap: 'round' }));
        this.group.add(new Konva.Line({ points: [sx - 24, sy + sh / 2 - 14, sx - 18, sy + sh / 2 - 10, sx - 24, sy + sh / 2 - 6], stroke: '#ffa726', strokeWidth: 1.8, lineJoin: 'round' }));
        this.group.add(new Konva.Line({ points: [sx - 38, sy + sh / 2 + 10, sx - 20, sy + sh / 2 + 10], stroke: '#546e7a', strokeWidth: 1.5, lineCap: 'round', dash: [3, 2] }));
        this.group.add(new Konva.Text({ x: sx - 52, y: sy + sh / 2 - 14, text: '气体\n进入', fontSize: 7, fill: '#ffa726', lineHeight: 1.3 }));
        this.group.add(meshFrame);
    }

    // ── 催化燃烧腔 ──────────────────────────
    _drawBeadCavity() {
        const cx1 = this._detCX, cx2 = this._comCX, cy = this._detCY;
        const R = this._beadR + 12;

        // 双珠腔体
        const cavity = new Konva.Rect({
            x: this._sensorX + 18, y: cy - R - 8,
            width: this._sensorW - 28, height: (R + 8) * 2,
            fill: '#0a0c12', stroke: '#1a2030', strokeWidth: 1.5, cornerRadius: 4,
        });
        // 中央分隔线
        const divider = new Konva.Line({
            points: [this._sensorX + this._sensorW / 2, cy - R, this._sensorX + this._sensorW / 2, cy + R],
            stroke: '#1a3040', strokeWidth: 1, dash: [4, 3],
        });
        // 标注
        this.group.add(new Konva.Text({ x: cx1 - 18, y: cy - R - 18, text: '探测珠 (Active)', fontSize: 8, fontStyle: 'bold', fill: '#ef9a9a' }));
        this.group.add(new Konva.Text({ x: cx2 - 20, y: cy - R - 18, text: '补偿珠 (Ref.)', fontSize: 8, fontStyle: 'bold', fill: '#90caf9' }));
        this.group.add(cavity, divider);
    }

    // ── 催化珠元件 ──────────────────────────
    _drawBeadElements() {
        const cx1 = this._detCX, cx2 = this._comCX, cy = this._detCY;
        const R = this._beadR;

        // ── 探测珠（Active Bead）──
        // 热辉光（动态）
        this._detGlow = new Konva.Circle({ x: cx1, y: cy, radius: R + 8, fill: 'rgba(255,80,0,0.15)' });
        // 铂线圈载体
        this._detBead = new Konva.Circle({ x: cx1, y: cy, radius: R, fill: '#8b0000', stroke: '#c62828', strokeWidth: 1.5 });
        // 铂线圈（螺旋示意）
        for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2;
            const r2 = R * 0.62;
            this.group.add(new Konva.Arc({ x: cx1, y: cy, innerRadius: r2 - 2, outerRadius: r2 + 2, angle: 50, rotation: a * 180 / Math.PI, fill: 'rgba(200,180,100,0.5)' }));
        }
        // 催化剂涂层标识
        this.group.add(new Konva.Circle({ x: cx1, y: cy, radius: R * 0.45, fill: 'none', stroke: 'rgba(255,215,0,0.35)', strokeWidth: 1.5 }));
        // 高温标注
        this._detTempText = new Konva.Text({ x: cx1 - 14, y: cy - R - 22, text: '500°C', fontSize: 8.5, fontFamily: 'Courier New, monospace', fill: '#ef9a9a' });

        // ── 补偿珠（Reference Bead）──
        this._comGlow = new Konva.Circle({ x: cx2, y: cy, radius: R + 6, fill: 'rgba(33,150,243,0.1)' });
        this._comBead = new Konva.Circle({ x: cx2, y: cy, radius: R, fill: '#0d2a4a', stroke: '#1565c0', strokeWidth: 1.5 });
        for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2;
            const r2 = R * 0.62;
            this.group.add(new Konva.Arc({ x: cx2, y: cy, innerRadius: r2 - 2, outerRadius: r2 + 2, angle: 50, rotation: a * 180 / Math.PI, fill: 'rgba(100,150,200,0.45)' }));
        }
        this.group.add(new Konva.Text({ x: cx2 - 14, y: cy - R - 22, text: '500°C', fontSize: 8.5, fontFamily: 'Courier New, monospace', fill: '#90caf9' }));

        // 铂电阻连接线（到电桥）
        const pY = cy + R + 8;
        this._rdLine = new Konva.Line({ points: [cx1, pY, cx1, pY + 14], stroke: '#ef9a9a', strokeWidth: 1.5, dash: [3, 2] });
        this._rcLine = new Konva.Line({ points: [cx2, pY, cx2, pY + 14], stroke: '#90caf9', strokeWidth: 1.5, dash: [3, 2] });
        this._rdLabel = new Konva.Text({ x: cx1 + R + 2, y: cy - 6, text: `Rd=${this.rDetect.toFixed(1)}Ω`, fontSize: 7.5, fontFamily: 'Courier New, monospace', fill: '#ef9a9a' });
        this._rcLabel = new Konva.Text({ x: cx2 + R + 2, y: cy - 6, text: `Rc=${this.rCompen.toFixed(1)}Ω`, fontSize: 7.5, fontFamily: 'Courier New, monospace', fill: '#90caf9' });

        this.group.add(this._detGlow, this._detBead, this._detTempText);
        this.group.add(this._comGlow, this._comBead);
        this.group.add(this._rdLine, this._rcLine, this._rdLabel, this._rcLabel);
    }

    // ── 气体粒子层（动态）─────────────────────
    _drawGasParticleLayer() {
        this._gasGroup = new Konva.Group();
        this._reactionGroup = new Konva.Group();
        this.group.add(this._gasGroup, this._reactionGroup);
    }

    // ── 惠斯顿电桥电路图（左下）─────────────
    _drawBridgeCircuit() {
        const { _bridgeX: bx, _bridgeY: by, _bridgeW: bw, _bridgeH: bh } = this;

        const bg = new Konva.Rect({ x: bx, y: by, width: bw, height: bh, fill: '#020c14', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 4 });
        const titleBg = new Konva.Rect({ x: bx, y: by, width: bw, height: 14, fill: '#0a1a28', cornerRadius: [4, 4, 0, 0] });
        this.group.add(new Konva.Text({ x: bx + 4, y: by + 2, width: bw - 8, text: '惠斯顿电桥  Wheatstone Bridge', fontSize: 8, fontStyle: 'bold', fill: '#80cbc4', align: 'center' }));

        // 菱形电桥
        const midX = bx + bw / 2;
        const topY = by + 22;
        const botY = by + bh - 12;
        const midY = (topY + botY) / 2;
        const halfW = bw * 0.28;

        // Vs 供电（顶）和地（底）
        this.group.add(new Konva.Line({ points: [midX, topY, midX - 2, topY + 6, midX + 2, topY + 6, midX, topY], closed: true, fill: '#ef9a9a', stroke: 'none' }));
        this.group.add(new Konva.Text({ x: midX - 8, y: topY - 8, text: 'Vs', fontSize: 8.5, fontStyle: 'bold', fill: '#ef9a9a' }));
        this.group.add(new Konva.Line({ points: [midX - 6, botY + 2, midX + 6, botY + 2, midX - 3, botY + 7, midX + 3, botY + 7], stroke: '#607d8b', strokeWidth: 1 }));
        this.group.add(new Konva.Text({ x: midX - 4, y: botY + 9, text: '⏚', fontSize: 9, fill: '#607d8b' }));

        // 菱形四边
        const nodes = {
            top: [midX, topY + 8],
            left: [midX - halfW, midY],
            right: [midX + halfW, midY],
            bot: [midX, botY],
        };
        // 连线
        this.group.add(new Konva.Line({ points: [nodes.top[0], nodes.top[1], nodes.left[0], nodes.left[1]], stroke: '#546e7a', strokeWidth: 1.5 }));
        this.group.add(new Konva.Line({ points: [nodes.top[0], nodes.top[1], nodes.right[0], nodes.right[1]], stroke: '#546e7a', strokeWidth: 1.5 }));
        this.group.add(new Konva.Line({ points: [nodes.left[0], nodes.left[1], nodes.bot[0], nodes.bot[1]], stroke: '#546e7a', strokeWidth: 1.5 }));
        this.group.add(new Konva.Line({ points: [nodes.right[0], nodes.right[1], nodes.bot[0], nodes.bot[1]], stroke: '#546e7a', strokeWidth: 1.5 }));
        // 中桥（差分输出）
        this.group.add(new Konva.Line({ points: [nodes.left[0] + 5, nodes.left[1], nodes.right[0] - 5, nodes.right[1]], stroke: '#ffd54f', strokeWidth: 1.2, dash: [3, 2] }));
        this._vBridgeLine = new Konva.Line({ points: [nodes.left[0] + 5, nodes.left[1], nodes.right[0] - 5, nodes.right[1]], stroke: '#ffd54f', strokeWidth: 2 });

        // 电阻标注
        this._rdBox = new Konva.Rect({ x: nodes.left[0] - 14, y: midY - 22, width: 28, height: 12, fill: '#1a0a0a', stroke: '#ef9a9a', strokeWidth: 1, cornerRadius: 2 });
        this._rdTxt = new Konva.Text({ x: nodes.left[0] - 13, y: midY - 20, width: 26, text: `Rd`, fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#ef9a9a', align: 'center' });
        this._rcBox = new Konva.Rect({ x: nodes.right[0] - 14, y: midY - 22, width: 28, height: 12, fill: '#0a0a1a', stroke: '#90caf9', strokeWidth: 1, cornerRadius: 2 });
        this._rcTxt = new Konva.Text({ x: nodes.right[0] - 13, y: midY - 20, width: 26, text: `Rc`, fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#90caf9', align: 'center' });
        // R1 R2（固定平衡电阻）
        this.group.add(new Konva.Rect({ x: nodes.left[0] - 14, y: midY + 10, width: 28, height: 12, fill: '#1a1a1a', stroke: '#546e7a', strokeWidth: 1, cornerRadius: 2 }));
        this.group.add(new Konva.Text({ x: nodes.left[0] - 12, y: midY + 12, width: 24, text: 'R1', fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#78909c', align: 'center' }));
        this.group.add(new Konva.Rect({ x: nodes.right[0] - 14, y: midY + 10, width: 28, height: 12, fill: '#1a1a1a', stroke: '#546e7a', strokeWidth: 1, cornerRadius: 2 }));
        this.group.add(new Konva.Text({ x: nodes.right[0] - 12, y: midY + 12, width: 24, text: 'R2', fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#78909c', align: 'center' }));

        // V_bridge 输出标注
        this._vBridgeLabel = new Konva.Text({ x: midX - 18, y: midY - 8, text: 'Vout=0.0V', fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#ffd54f' });

        this._bridgeNodes = nodes;
        this.group.add(bg, titleBg, this._vBridgeLine, this._rdBox, this._rdTxt, this._rcBox, this._rcTxt, this._vBridgeLabel);
    }

    // ── 仪表头（右侧）────────────────────────
    _drawInstrHead() {
        const hx = this._headX, hy = this._headY;
        const hw = this._headW, hh = this._headH;

        const jBox = new Konva.Rect({ x: hx, y: hy, width: hw, height: 46, fill: '#cfd8dc', stroke: '#90a4ae', strokeWidth: 1.5, cornerRadius: [5, 5, 0, 0] });
        for (let i = 0; i < 4; i++) this.group.add(new Konva.Line({ points: [hx, hy + 6 + i * 10, hx + hw, hy + 6 + i * 10], stroke: 'rgba(255,255,255,0.12)', strokeWidth: 0.7 }));
        const plate = new Konva.Rect({ x: hx + 8, y: hy + 4, width: hw - 16, height: 28, fill: '#eceff1', stroke: '#b0bec5', strokeWidth: 0.5, cornerRadius: 2 });
        this._idText = new Konva.Text({ x: hx + 8, y: hy + 7, width: hw - 16, text: this.id || 'GD-CAT-01', fontSize: 9, fontStyle: 'bold', fill: '#263238', align: 'center' });
        this.group.add(new Konva.Text({ x: hx + 8, y: hy + 17, width: hw - 16, text: 'COMBUSTIBLE GAS', fontSize: 7, fill: '#78909c', align: 'center' }));
        const gasInfo = this._gasDB[this.gasType] || this._gasDB['CH4'];
        this.group.add(new Konva.Text({ x: hx + 8, y: hy + 27, width: hw - 16, text: `${gasInfo.name}  LEL=${gasInfo.lel}%vol`, fontSize: 7, fill: '#90a4ae', align: 'center' }));
        const lcap = new Konva.Rect({ x: hx, y: hy + 3, width: 10, height: 42, fill: '#b0bec5', cornerRadius: [2, 0, 0, 2] });
        const rcap = new Konva.Rect({ x: hx + hw - 10, y: hy + 3, width: 10, height: 42, fill: '#b0bec5', cornerRadius: [0, 2, 2, 0] });
        const body = new Konva.Rect({ x: hx, y: hy + 46, width: hw, height: hh - 46, fill: '#1a1f2a', stroke: '#0d1020', strokeWidth: 1.5, cornerRadius: [0, 0, 4, 4] });
        [['V+', '#ef5350', 14], ['GND', '#607d8b', 34], ['4-20', '#ffd54f', 58], ['ALM1', '#ffa726', 78], ['ALM2', '#ef5350', 98]].forEach(([lbl, col, ty]) => {
            this.group.add(new Konva.Rect({ x: hx + 4, y: hy + ty - 7, width: hw - 8, height: 13, fill: 'rgba(255,255,255,0.02)', cornerRadius: 2 }));
            this.group.add(new Konva.Text({ x: hx + 7, y: hy + ty - 3, text: lbl, fontSize: 9, fontStyle: 'bold', fill: col }));
        });
        this.group.add(jBox, plate, lcap, rcap, this._idText, body);
    }

    // ── 圆形 LCD ────────────────────────────
    _drawLCD() {
        const hx = this._headX, hw = this._headW;
        const lcy = this._headY + 46 + (this._headH - 46) * 0.50;
        const lcx = hx + hw / 2;
        const R = Math.min(hw * 0.38, 40);
        this._lcCX = lcx; this._lcCY = lcy; this._lcR = R;

        this.group.add(new Konva.Circle({ x: lcx, y: lcy, radius: R + 4, fill: '#0d1020', stroke: '#1a1f30', strokeWidth: 1 }));
        const gasInfo = this._gasDB[this.gasType] || this._gasDB['CH4'];
        const ring = new Konva.Circle({ x: lcx, y: lcy, radius: R + 2, fill: '#1a1500', stroke: '#f9a825', strokeWidth: 2.5 });
        this._lcdBg = new Konva.Circle({ x: lcx, y: lcy, radius: R, fill: '#040408' });

        this._concArc = new Konva.Arc({ x: lcx, y: lcy, innerRadius: R - 5, outerRadius: R - 3, angle: 0, fill: '#ffd54f', rotation: -90 });
        this._lcdMain = new Konva.Text({ x: lcx - R + 4, y: lcy - R * .40, width: (R - 4) * 2, text: '0.0', fontSize: R * .43, fontFamily: 'Courier New, monospace', fontStyle: 'bold', fill: '#ffd54f', align: 'center' });
        this._lcdUnit = new Konva.Text({ x: lcx - R + 4, y: lcy + R * .08, width: (R - 4) * 2, text: '%LEL', fontSize: R * .15, fill: '#1a1500', align: 'center' });
        this._lcdGasLbl = new Konva.Text({ x: lcx - R + 4, y: lcy + R * .28, width: (R - 4) * 2, text: gasInfo.name, fontSize: R * .14, fontFamily: 'Courier New, monospace', fill: '#37474f', align: 'center' });
        this._lcdCurr = new Konva.Text({ x: lcx - R + 4, y: lcy - R * .62, width: (R - 4) * 2, text: '4.0 mA', fontSize: R * .13, fontFamily: 'Courier New, monospace', fill: '#80cbc4', align: 'center' });
        this._lcdTemp = new Konva.Text({ x: lcx - R + 4, y: lcy + R * .47, width: (R - 4) * 2, text: '500°C', fontSize: R * .12, fontFamily: 'Courier New, monospace', fill: '#263238', align: 'center' });

        this.group.add(ring, this._lcdBg, this._concArc, this._lcdMain, this._lcdUnit, this._lcdGasLbl, this._lcdCurr, this._lcdTemp);
    }

    // ── 报警指示面板 ─────────────────────────
    _drawAlarmPanel() {
        const hx = this._headX, hw = this._headW;
        const panY = this._lcCY + this._lcR + 14;

        this._almLeds = [];
        const almDefs = [
            { label: 'NORMAL', col: '#4caf50', x: hx + hw * 0.17 },
            { label: 'LEVEL1', col: '#ffd54f', x: hx + hw * 0.50 },
            { label: 'LEVEL2', col: '#f44336', x: hx + hw * 0.83 },
        ];
        almDefs.forEach(({ label, col, x }) => {
            const led = new Konva.Circle({ x, y: panY, radius: 7, fill: '#1a1a1a', stroke: '#333', strokeWidth: 1 });
            const lbl = new Konva.Text({ x: x - 22, y: panY + 10, width: 44, text: label, fontSize: 7, fill: '#37474f', align: 'center' });
            this._almLeds.push({ led, col });
            this.group.add(led, lbl);
        });
    }

    // ── 波形区（右下）────────────────────────
    _drawWaveforms() {
        const { _wavX: wx, _wavY: wy, _wavW: ww, _wavH: wh } = this;

        const bg = new Konva.Rect({ x: wx, y: wy, width: ww, height: wh, fill: '#010d18', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 4 });
        const titleBg = new Konva.Rect({ x: wx, y: wy, width: ww, height: 14, fill: '#0a1a28', cornerRadius: [4, 4, 0, 0] });
        this.group.add(new Konva.Text({ x: wx + 4, y: wy + 2, width: ww - 8, text: '浓度 %LEL  电桥输出 V_bridge', fontSize: 8, fontStyle: 'bold', fill: '#ffd54f', align: 'center' }));

        for (let i = 1; i < 3; i++) this.group.add(new Konva.Line({ points: [wx, wy + wh * i / 3, wx + ww, wy + wh * i / 3], stroke: 'rgba(255,213,79,0.06)', strokeWidth: 0.5 }));

        this._wavMidConc = wy + wh * 0.26;
        this._wavMidBridge = wy + wh * 0.74;
        [this._wavMidConc, this._wavMidBridge].forEach(my => {
            this.group.add(new Konva.Line({ points: [wx + 2, my, wx + ww - 2, my], stroke: 'rgba(200,200,200,0.1)', strokeWidth: 0.5, dash: [4, 3] }));
        });

        // 报警阈值虚线
        const amp = wh * 0.22;
        [this.alm1LEL, this.alm2LEL].forEach((lel, i) => {
            const ratio = lel / this.maxLEL;
            const col = i === 0 ? 'rgba(255,213,79,0.35)' : 'rgba(244,67,54,0.35)';
            this.group.add(new Konva.Line({ points: [wx + 2, this._wavMidConc - ratio * amp, wx + ww - 2, this._wavMidConc - ratio * amp], stroke: col, strokeWidth: 0.8, dash: [3, 3] }));
            this.group.add(new Konva.Text({ x: wx + ww - 26, y: this._wavMidConc - ratio * amp - 9, text: `L${i + 1}`, fontSize: 7, fill: col.replace('0.35', '0.7') }));
        });

        this._wLineConc = new Konva.Line({ points: [], stroke: '#ffd54f', strokeWidth: 1.8, lineJoin: 'round' });
        this._wLineBridge = new Konva.Line({ points: [], stroke: '#ef9a9a', strokeWidth: 1.5, lineJoin: 'round' });

        this.group.add(new Konva.Text({ x: wx + 4, y: wy + 16, text: '浓度 %LEL', fontSize: 8, fill: '#ffd54f' }));
        this.group.add(new Konva.Text({ x: wx + 4, y: wy + wh / 2 + 4, text: 'V_bridge', fontSize: 8, fill: '#ef9a9a' }));

        this._wConcLbl = new Konva.Text({ x: wx + ww - 84, y: wy + 16, width: 80, text: '-- %LEL', fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#ffd54f', align: 'right' });
        this._wBridgeLbl = new Konva.Text({ x: wx + ww - 84, y: wy + wh / 2 + 4, width: 80, text: '-- mV', fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#ef9a9a', align: 'right' });

        this.group.add(bg, titleBg, this._wLineConc, this._wLineBridge, this._wConcLbl, this._wBridgeLbl);
    }

    // ── 底部面板 ─────────────────────────────
    _drawBottomPanel() {
        // pass — 由 _tickDisplay 动态更新
    }

    // ── 拖拽 ─────────────────────────────────
    _setupDrag() {
        const hit = new Konva.Rect({ x: this._sensorX, y: this._sensorY, width: this._sensorW, height: this._sensorH, fill: 'transparent', listening: true });
        hit.on('mousedown touchstart', e => {
            e.cancelBubble = true;
            this._dragStartY = e.evt.clientY ?? e.evt.touches?.[0]?.clientY ?? 0;
            this._dragStartC = this._manualConc;
            this._dragActive = true;
        });
        const mv = e => {
            if (!this._dragActive) return;
            const cy = e.clientY ?? e.touches?.[0]?.clientY ?? 0;
            this._manualConc = Math.max(0, Math.min(this.maxLEL, this._dragStartC + (this._dragStartY - cy) * 0.15));
        };
        const up = () => { this._dragActive = false; };
        window.addEventListener('mousemove', mv);
        window.addEventListener('touchmove', mv, { passive: true });
        window.addEventListener('mouseup', up);
        window.addEventListener('touchend', up);
        this.group.add(hit);
    }

    // ═══════════════════════════════════════════
    //  动画主循环
    // ═══════════════════════════════════════════
    _startAnimation() {
        const tick = ts => {
            if (this._lastTs !== null) {
                const dt = Math.min((ts - this._lastTs) / 1000, 0.05);
                this._tickPhysics(dt);
                this._tickBeadViz();
                this._tickGasParticles(dt);
                this._tickBridgeViz();
                this._tickWaveforms(dt);
                this._tickDisplay();
            }
            this._lastTs = ts;
            this._refreshCache();
            this._animId = requestAnimationFrame(tick);
        };
        this._animId = requestAnimationFrame(tick);
    }

    _stopAnimation() {
        if (this._animId) { cancelAnimationFrame(this._animId); this._animId = null; }
    }

    // ── 物理计算 ────────────────────────────
    _tickPhysics(dt) {
        this.concentration = this._manualConc;
        const C = this.concentration / 100;  // 归一化 0~1
        const gas = this._gasDB[this.gasType] || this._gasDB['CH4'];

        // 电阻变化（催化燃烧放热 → 铂阻增大）
        const dR = this.alpha * C * this.R0 * (this.isPoison ? 0.2 : 1);
        this.rDetect = this.R0 + dR + (Math.random() - 0.5) * 0.05;
        this.rCompen = this.R0 + (Math.random() - 0.5) * 0.05;

        // 惠斯顿电桥输出
        this.vBridge = this.Vs * dR / (2 * this.R0 + dR);
        this.vDetect = this.Vs * this.rDetect / (this.rDetect + this.R0);
        this.vCompen = this.Vs * this.rCompen / (this.rCompen + this.R0);

        // 探测珠温度（燃烧升温）
        this.detectTemp = 500 + C * 80;

        // 电流输出
        this.outCurrent = this.isBreak ? 1.8 : 4 + C * 16;

        // 报警
        this.alm1 = this.concentration >= this.alm1LEL;
        this.alm2 = this.concentration >= this.alm2LEL;
        this.alm3 = this.concentration >= this.alm3LEL;

        // 相位
        this._phase += dt * 4;
        this._heatGlow = 0.3 + C * 0.6 + 0.15 * Math.abs(Math.sin(this._phase * 2));

        // 电容弧
        if (this._concArc) {
            const ratio = Math.min(1, this.concentration / this.maxLEL);
            this._concArc.angle(ratio * 360);
            this._concArc.fill(this.alm3 ? '#ef5350' : this.alm2 ? '#ff5722' : this.alm1 ? '#ffa726' : '#ffd54f');
        }

        // 报警 LED
        if (this._almLeds && this._almLeds.length === 3) {
            const pulse = 0.5 + 0.5 * Math.abs(Math.sin(this._phase * 3));
            this._almLeds[0].led.fill(!this.alm1 && !this.isBreak ? '#4caf50' : '#1a1a1a');
            this._almLeds[1].led.fill(this.alm1 && !this.alm2 ? `rgba(255,213,79,${pulse})` : '#1a1a1a');
            this._almLeds[2].led.fill(this.alm2 ? `rgba(244,67,54,${pulse})` : '#1a1a1a');
        }

        // 更新电桥阻值标注
        if (this._rdLabel) this._rdLabel.text(`Rd=${this.rDetect.toFixed(1)}Ω`);
        if (this._rcLabel) this._rcLabel.text(`Rc=${this.rCompen.toFixed(1)}Ω`);
        if (this._rdTxt) this._rdTxt.text(`Rd\n${this.rDetect.toFixed(0)}Ω`);
        if (this._rcTxt) this._rcTxt.text(`Rc\n${this.rCompen.toFixed(0)}Ω`);
        if (this._detTempText) this._detTempText.text(`${Math.round(this.detectTemp)}°C`);
        if (this._vBridgeLabel) this._vBridgeLabel.text(`Vout=${(this.vBridge * 1000).toFixed(1)}mV`);
    }

    // ── 催化珠可视化 ─────────────────────────
    _tickBeadViz() {
        const g = this._heatGlow;
        const C = this.concentration / 100;

        // 探测珠热辉光（随浓度和燃烧放热增强）
        if (this._detGlow) {
            const R = this._beadR + 8 + C * 12;
            const r2 = Math.round(255);
            const g2 = Math.round(50 + C * 100);
            this._detGlow.radius(R);
            this._detGlow.fill(`rgba(${r2},${g2},0,${g * 0.5})`);
        }
        if (this._detBead) {
            const r2 = Math.round(100 + C * 100);
            const g2 = Math.round(C * 40);
            this._detBead.fill(`rgb(${r2},${g2},0)`);
            this._detBead.stroke(`rgb(${Math.round(150 + C * 80)},${Math.round(C * 60)},0)`);
        }

        // 补偿珠（稳定蓝白色）
        if (this._comGlow) {
            const pulse = 0.08 + 0.04 * Math.abs(Math.sin(this._phase));
            this._comGlow.fill(`rgba(33,150,243,${pulse})`);
        }
    }

    // ── 气体颗粒动画 ─────────────────────────
    _tickGasParticles(dt) {
        this._gasGroup.destroyChildren();
        this._reactionGroup.destroyChildren();

        const C = this.concentration / 100;
        const cx1 = this._detCX, cy1 = this._detCY;
        const R = this._beadR;

        if (C < 0.01) return;

        // 生成气体分子（从左侧扩散网进入）
        const numMol = Math.floor(C * 16);
        for (let i = 0; i < numMol; i++) {
            const angle = (this._phase * 0.6 + i * 0.6) % (Math.PI * 2);
            const dist = R * 1.3 + R * 0.8 * Math.abs(Math.sin(this._phase + i * 1.2));
            const mx = cx1 + dist * Math.cos(angle);
            const my = cy1 + dist * Math.sin(angle);
            const gas = this._gasDB[this.gasType] || this._gasDB['CH4'];
            const mr = 1.5 + (i % 4) * 0.7;
            const alpha = 0.4 + C * 0.5;
            const hex = gas.color.replace('#', '');
            const r = parseInt(hex.substring(0, 2), 16);
            const g = parseInt(hex.substring(2, 4), 16);
            const b = parseInt(hex.substring(4, 6), 16);
            this._gasGroup.add(
                new Konva.Circle({
                    x: mx,
                    y: my,
                    radius: mr,
                    fill: `rgba(${r}, ${g}, ${b}, ${alpha})`
                })
            );

        }

        // 燃烧反应火花（接近珠表面时）
        const numSparks = Math.floor(C * 8);
        for (let i = 0; i < numSparks; i++) {
            const a = (this._phase * 2 + i * 0.78) % (Math.PI * 2);
            const sr = R * 0.88;
            const sx2 = cx1 + sr * Math.cos(a);
            const sy2 = cy1 + sr * Math.sin(a);
            const sparkAlpha = C * 0.85;
            const sparkR = 1 + C * 2;
            this._reactionGroup.add(new Konva.Circle({ x: sx2, y: sy2, radius: sparkR, fill: `rgba(255, 255, ${Math.round(150 - C * 150)}, ${sparkAlpha})` }));
        }
    }

    // ── 电桥可视化 ───────────────────────────
    _tickBridgeViz() {
        // 探测珠框颜色随阻值变化
        if (this._rdBox) {
            const intensity = Math.min(1, this.concentration / this.maxLEL);
            const r = Math.round(26 + intensity * 80);
            const g2 = Math.round(10 + intensity * 20);
            this._rdBox.fill(`rgb(${r}, ${g2}, ${g2})`);
        }
        // V_bridge 连线颜色随电压变化
        if (this._vBridgeLine) {
            const v = Math.min(1, this.vBridge / 0.1);
            this._vBridgeLine.stroke(`rgba(255, ${Math.round(213 - v * 150)}, ${Math.round(79 - v * 79)}, ${0.5 + v * 0.5})`);
        }
    }

    // ── 波形缓冲 ─────────────────────────────
    _tickWaveforms(dt) {
        this._wavAcc += 1.4 * dt * this._wavLen;
        const steps = Math.floor(this._wavAcc);
        this._wavAcc -= steps;

        for (let i = 0; i < steps; i++) {
            this._wavConc = new Float32Array([...this._wavConc.slice(1), this.concentration]);
            this._wavBridge = new Float32Array([...this._wavBridge.slice(1), this.vBridge * 1000]);  // mV
        }

        const wx = this._wavX + 3, wy2 = this._wavY;
        const ww = this._wavW - 6, wh = this._wavH;
        const n = this._wavLen, dx = ww / n;
        const concAmp = wh * 0.22;
        const bridgeAmp = wh * 0.18;

        const cPts = [], bPts = [];
        for (let i = 0; i < n; i++) {
            const x = wx + i * dx;
            cPts.push(x, this._wavMidConc - (this._wavConc[i] / this.maxLEL) * concAmp);
            const bNorm = this._wavBridge[i] / (this.Vs * this.alpha * 1000);
            bPts.push(x, this._wavMidBridge - bNorm * bridgeAmp);
        }
        if (this._wLineConc) this._wLineConc.points(cPts);
        if (this._wLineBridge) this._wLineBridge.points(bPts);

        if (this._wConcLbl) this._wConcLbl.text(`${this.concentration.toFixed(1)} % LEL`);
        if (this._wBridgeLbl) this._wBridgeLbl.text(`${(this.vBridge * 1000).toFixed(2)} mV`);
    }

    // ── 显示刷新 ─────────────────────────────
    _tickDisplay() {
        const br = this.isBreak;
        const C = this.concentration;
        const gas = this._gasDB[this.gasType] || this._gasDB['CH4'];

        if (br) {
            if (this._lcdMain) { this._lcdMain.text('FAIL'); this._lcdMain.fill('#ef5350'); }
            return;
        }

        const mc = this.alm3 ? '#ef5350' : this.alm2 ? '#ff5722' : this.alm1 ? '#ffa726' : '#ffd54f';

        if (this._lcdBg) this._lcdBg.fill('#040408');
        if (this._lcdMain) { this._lcdMain.text(C.toFixed(1)); this._lcdMain.fill(mc); }
        if (this._lcdCurr) this._lcdCurr.text(`${this.outCurrent.toFixed(2)} mA`);
        if (this._lcdTemp) this._lcdTemp.text(`${Math.round(this.detectTemp)}°C`);
        if (this._lcdGasLbl) this._lcdGasLbl.text(`${C.toFixed(2)}/${gas.lel.toFixed(1)}%vol`);
    }

    // ═══════════════════════════════════════════
    //  外部接口
    // ═══════════════════════════════════════════
    update(concPctLEL) {
        if (typeof concPctLEL === 'number') {
            this._manualConc = Math.max(0, Math.min(this.maxLEL, concPctLEL));
        }
        this._refreshCache();
    }

    setGasType(gasType) {
        if (this._gasDB[gasType]) {
            this.gasType = gasType;
            this.alpha = this._gasDB[gasType].alpha;
            this._refreshCache();
        }
    }

    getConfigFields() {
        return [
            { label: '位号/名称', key: 'id', type: 'text' },
            {
                label: '气体类型', key: 'gasType', type: 'select',
                options: Object.entries(this._gasDB).map(([k, v]) => ({ label: `${k} ${v.name}`, value: k }))
            },
            { label: '低报阈值 (%LEL)', key: 'alm1LEL', type: 'number' },
            { label: '高报阈值 (%LEL)', key: 'alm2LEL', type: 'number' },
            { label: '量程 (%LEL)', key: 'maxLEL', type: 'number' },
            { label: '桥路电压 Vs (V)', key: 'Vs', type: 'number' },
            { label: '基准阻值 R0 (Ω)', key: 'R0', type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        this.id = cfg.id || this.id;
        this.gasType = cfg.gasType || this.gasType;
        this.alm1LEL = parseFloat(cfg.alm1LEL) || this.alm1LEL;
        this.alm2LEL = parseFloat(cfg.alm2LEL) || this.alm2LEL;
        this.maxLEL = parseFloat(cfg.maxLEL) || this.maxLEL;
        this.Vs = parseFloat(cfg.Vs) || this.Vs;
        this.R0 = parseFloat(cfg.R0) || this.R0;
        if (this._gasDB[this.gasType]) this.alpha = this._gasDB[this.gasType].alpha;
        this.config = { ...this.config, ...cfg };
        if (this._idText) this._idText.text(this.id);
        this._refreshCache();
    }

    destroy() { this._stopAnimation(); super.destroy?.(); }
}