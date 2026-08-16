import { BaseComponent } from './BaseComponent.js';

/**
 * 直流接触器仿真组件
 * （DC Electromagnetic Contactor）
 *
 * ── 与交流接触器的核心区别 ────────────────────────────────────
 *
 *  1. 电磁系统差异：
 *     直流接触器线圈通入直流电，铁芯中磁通恒定（无 100Hz 脉动），
 *     因此：
 *     - 无需分磁环（短路铜环），铁芯端面无槽
 *     - 铁芯可采用整块软钢（非叠片），结构更简单
 *     - 线圈电阻 R 主导（纯阻性），无感抗影响（稳态）
 *     - 合闸涌流 = U/R（无交流感抗限制），远大于稳态电流
 *       I_rush = U / R_coil（暂态）→ I_steady = U / R_coil（一阶 RL）
 *     - 电磁吸力恒定（F = Φ²/(2μ₀A)），无脉动，触点稳定无振动
 *
 *  2. 灭弧方式差异（直流灭弧难度远高于交流）：
 *     交流电弧每半周期自然过零，易于熄弧；
 *     直流电弧无过零点，必须强制拉伸熄弧：
 *     - 磁吹弧：在触点旁设置磁吹线圈（串联在主回路），
 *       电弧电流产生磁场，洛伦兹力 F = BIl 将电弧吹入灭弧栅
 *     - 灭弧栅（陶瓷栅片）：将长弧切割为多段短弧，
 *       每段弧压降约 25~50V，总弧压超过电源电压则电弧熄灭
 *     - 去游离：活性气体（SF₆）或真空灭弧
 *
 *  3. 线圈参数差异：
 *     直流线圈匝数多、导线细、电阻大（数十～数百 Ω）
 *     以保证稳态电流不过大（P = I²R 不超过热容量）
 *     线圈时间常数 τ = L/R（典型 10~50ms）
 *
 *  4. 触点系统：
 *     直流接触器通常为单极或两极（无需三相平衡），
 *     触点需更强的灭弧能力，触头材料多用银钨合金（AgW）
 *     主触点：1P / 2P（常开，接通直流主回路）
 *     辅助触点：常开（NO）+ 常闭（NC）
 *
 *  5. 典型应用：
 *     直流电机起停（蓄电池车、叉车、电动汽车 BMS）、
 *     直流配电柜、蓄电池组切换、直流牵引系统
 *
 * ── 电磁吸力分析 ──────────────────────────────────────────────
 *
 *  稳态线圈电流：I_ss = U_c / R_coil
 *  暂态电流（合闸后 RL 响应）：
 *    i(t) = I_ss × (1 - e^(-t/τ))，τ = L_coil / R_coil
 *  气隙磁通：Φ = N × i(t) / (R_iron + R_gap)
 *    R_gap = δ / (μ₀ × A_pole)（气隙磁阻，随衔铁位移变化）
 *  电磁吸力：F_em = Φ² / (2μ₀A_pole)（稳定，无脉动）
 *  触点合闸条件：F_em > F_spring + F_contact_spring + F_friction
 *
 * ── 磁吹弧仿真模型 ────────────────────────────────────────────
 *
 *  磁吹力：F_arc = B_blow × I_arc × L_arc
 *    B_blow ∝ I_main（串联磁吹线圈产生的磁场）
 *    L_arc：电弧长度（随时间增长）
 *  电弧电压：U_arc = U_arc0 + E_arc × L_arc
 *    U_arc0：阴极压降（约 15~20V）
 *    E_arc：弧柱电场强度（约 10~20 V/mm）
 *  熄弧条件：U_arc ≥ U_source（电弧电压超过电源电压）
 *  仿真中：电弧持续时间 ∝ 主回路电流，最大约 80ms
 *
 * ── 组件结构 ──────────────────────────────────────────────────
 *  ① 电磁铁截面图（U形静铁芯 + E形动铁芯，整块软钢）
 *  ② 直流线圈（整块铁芯，无叠片纹，线圈更密）
 *  ③ 电磁吸力曲线（F-δ，气隙特性 + 弹簧特性对比）
 *  ④ 主触点（1P/2P，含磁吹线圈标示）
 *  ⑤ 磁吹弧动画（电弧被吹入灭弧栅，弧形轨迹）
 *  ⑥ 辅助触点（NO + NC）
 *  ⑦ 线圈 RL 暂态波形（i(t) = I_ss(1-e^-t/τ)）
 *  ⑧ 气隙 δ - 吸力 F 特性曲线（随衔铁位移变化）
 *  ⑨ LCD 仪表（线圈电压/电流、吸力、气隙、触点状态、寿命）
 *  ⑩ 控制面板（合/分闸按钮 + 线圈电压/主回路电流调节）
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  coil_pos  — 线圈正极（+）
 *  coil_neg  — 线圈负极（-）
 *  main_p1   — 主触点进线（+）
 *  main_p2   — 主触点进线（2极时）
 *  main_n1   — 主触点出线（-）
 *  main_n2   — 主触点出线（2极时）
 *  aux_no13  — 辅助常开 13
 *  aux_no14  — 辅助常开 14
 *  aux_nc21  — 辅助常闭 21
 *  aux_nc22  — 辅助常闭 22
 */
export class DCContactor extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(520, config.width  || 620);
        this.height = Math.max(400, config.height || 500);

        this.type    = 'dc_contactor';
        this.special = 'none';
        this.cache   = 'fixed';

        // ── 额定参数 ──
        this.ratedVoltageCoil = config.ratedVoltageCoil || 24;    // V（线圈额定电压，直流常见 12/24/48/110V）
        this.ratedVoltagePole = config.ratedVoltagePole || 600;   // V（主触点额定电压，直流）
        this.ratedCurrent     = config.ratedCurrent     || 100;   // A（额定工作电流）
        this.polePairs        = config.polePairs        || 2;     // 主触点极数（直流多为 1P 或 2P）

        // ── 线圈等效参数（直流，纯 RL） ──
        this.coilR   = config.coilR   || 12;    // Ω（直流线圈电阻，较大）
        this.coilL   = config.coilL   || 0.45;  // H（线圈电感）
        this.coilTau = this.coilL / this.coilR; // 时间常数 τ（s）
        this.coilIss = this.ratedVoltageCoil / this.coilR; // 稳态电流 A

        // ── 磁路参数 ──
        this.poleArea    = config.poleArea    || 8e-4;   // m²（极面积 8cm²）
        this.coilTurns   = config.coilTurns   || 1200;   // 匝数
        this.ironRelPerm = config.ironRelPerm || 2000;   // 相对磁导率
        this.maxAirGap   = config.maxAirGap   || 6e-3;   // 最大气隙 6mm（释放位置）
        this.minAirGap   = config.minAirGap   || 0.1e-3; // 最小气隙 0.1mm（吸合位置）
        this.mu0         = 4 * Math.PI * 1e-7;

        // ── 机械参数 ──
        this.springForce    = config.springForce    || 8;    // N（反力弹簧）
        this.contactForce   = config.contactForce   || 5;    // N（触点弹簧压力）
        this.closeTime      = config.closeTime      || 0.025;// s（合闸时间，比AC快）
        this.openTime       = config.openTime       || 0.015;// s（分闸时间）
        this.bounceTime     = config.bounceTime     || 0.003;// s（触点弹跳时间）

        // ── 磁吹弧参数 ──
        this.blowCoilTurns  = config.blowCoilTurns  || 5;    // 磁吹线圈匝数（少匝，串联）
        this.arcVolt0       = config.arcVolt0       || 18;   // V（阴极压降）
        this.arcField       = config.arcField       || 12;   // V/mm（弧柱电场强度）
        this.arcTimeBase    = config.arcTimeBase    || 0.08; // s（额定电流下最大弧时间）
        this.ratedArcCurr   = config.ratedArcCurr  || this.ratedCurrent;

        // ── 灭弧室参数 ──
        this.arcGridCount   = config.arcGridCount   || 12;   // 灭弧栅片数

        // ── 寿命参数 ──
        this.mechLife = config.mechLife || 5000000;
        this.elecLife = config.elecLife || 500000;

        // ── 运行状态机 ──
        // phase: 'open' | 'closing' | 'bounce' | 'closed' | 'opening'
        this._phase       = 'open';
        this._phaseTimer  = 0;
        this._coilEnergized= false;
        this._armaturePos = 0;       // 0=完全释放，1=完全吸合（归一化）
        this._bounceDir   = 1;
        this._bounceAmp   = 0;

        // 电气量（稳态）
        this._coilVoltSet = this.ratedVoltageCoil;
        this.coilVoltage  = 0;
        this.coilCurrent  = 0;       // 线圈电流（RL暂态）
        this._coilCurrentSS = 0;     // 稳态电流目标
        this._coilIEnergy = 0;       // 线圈起始电流（用于断电衰减）
        this._closeStartT = 0;       // 合闸起始时刻
        this._openStartI  = 0;       // 分闸起始电流

        // 磁路量
        this.airGap       = this.maxAirGap; // 当前气隙 m
        this.fluxDensity  = 0;              // 气隙磁通密度 T
        this.forceEM      = 0;              // 电磁吸力 N

        // 主回路（仿真负载电流）
        this.mainCurrent  = config.mainCurrent || 50;  // A（主回路电流，用于电弧计算）

        // 电弧状态
        this._arcActive   = false;
        this._arcTimer    = 0;
        this._arcMaxTime  = 0;
        this._arcLength   = 0;       // mm（电弧长度）
        this._arcType     = 'open';

        // 接触状态
        this.contactState = 'open';

        // 统计
        this.opsCount  = config.initOps     || 0;
        this.elecOps   = config.initElecOps || 0;

        // ── 波形缓冲区 ──
        this._wavLen     = 200;
        this._wavCoilI   = new Float32Array(this._wavLen).fill(0);
        this._wavForce   = new Float32Array(this._wavLen).fill(0);
        this._wavGap     = new Float32Array(this._wavLen).fill(this.maxAirGap * 1000);
        this._wavArcV    = new Float32Array(this._wavLen).fill(0);
        this._wavAcc     = 0;

        // ── 几何布局 ──
        // 电磁铁截面（左上）
        this._emX   = Math.round(this.width * 0.03);
        this._emY   = Math.round(this.height * 0.05);
        this._emW   = Math.round(this.width * 0.33);
        this._emH   = Math.round(this.height * 0.50);
        this._emCX  = this._emX + this._emW / 2;
        this._emCY  = this._emY + this._emH / 2;

        // F-δ 特性曲线（中上）
        this._fdX   = Math.round(this.width * 0.38);
        this._fdY   = this._emY;
        this._fdW   = Math.round(this.width * 0.28);
        this._fdH   = Math.round(this.height * 0.32);

        // 主触点 + 磁吹弧（右上）
        this._ctX   = Math.round(this.width * 0.68);
        this._ctY   = this._emY;
        this._ctW   = Math.round(this.width * 0.30);
        this._ctH   = Math.round(this.height * 0.46);

        // 辅助触点（中下）
        this._auxX  = this._fdX;
        this._auxY  = this._fdY + this._fdH + 8;
        this._auxW  = this._fdW;
        this._auxH  = Math.round(this.height * 0.22);

        // LCD（左下）
        this._lcdX  = this._emX;
        this._lcdY  = this._emY + this._emH + 8;
        this._lcdW  = this._emW;
        this._lcdH  = Math.round(this.height * 0.25);

        // 控制面板（中下下）
        this._panX  = this._fdX;
        this._panY  = this._auxY + this._auxH + 8;
        this._panW  = this._fdW + this._ctW + 6;
        this._panH  = Math.round(this.height * 0.14);

        // 波形（底部全宽）
        this._wavX  = this._emX;
        this._wavY  = this._lcdY + this._lcdH + 6;
        this._wavW  = this.width - this._emX * 2;
        this._wavH  = this.height - this._wavY - 6;

        this._lastTs = null;
        this._animId = null;

        this.config = {
            id: this.id,
            ratedVoltageCoil: this.ratedVoltageCoil,
            ratedCurrent: this.ratedCurrent,
            polePairs: this.polePairs,
        };

        this._init();

        // 端口
        const emL = this._emX - 6;
        this.addPort(emL, this._emCY - 18, 'coil_pos', 'wire', '+');
        this.addPort(emL, this._emCY + 18, 'coil_neg', 'wire', '−');

        const step = this._ctW / (this.polePairs + 1);
        for (let i = 1; i <= this.polePairs; i++) {
            const px = this._ctX + step * i;
            this.addPort(px, this._ctY - 8,              `main_p${i}`, 'wire', `P${i}`);
            this.addPort(px, this._ctY + this._ctH + 8,  `main_n${i}`, 'wire', `N${i}`);
        }

        const auxCX = this._auxX + this._auxW / 2;
        this.addPort(auxCX - 14, this._auxY - 8,              'aux_no13', 'wire', '13');
        this.addPort(auxCX + 14, this._auxY - 8,              'aux_no14', 'wire', '14');
        this.addPort(auxCX - 14, this._auxY + this._auxH + 8, 'aux_nc21', 'wire', '21');
        this.addPort(auxCX + 14, this._auxY + this._auxH + 8, 'aux_nc22', 'wire', '22');
    }

    // ═══════════════════════════════════════════
    _init() {
        this._drawLabel();
        this._drawElectromagnet();
        this._drawCoilWinding();
        this._drawFluxLayer();
        this._drawArmatureLayer();
        this._drawFdCurve();
        this._drawMainContacts();
        this._drawArcLayer();
        this._drawAuxContacts();
        this._drawLCDPanel();
        this._drawControlPanel();
        this._drawWaveform();
        this._startAnimation();
    }

    _drawLabel() {
        this.group.add(new Konva.Text({
            x: 0, y: -22, width: this.width,
            text: `直流接触器  线圈 ${this.ratedVoltageCoil}V DC  主触点 ${this.ratedVoltagePole}V / ${this.ratedCurrent}A  ${this.polePairs}P+辅  磁吹弧灭弧`,
            fontSize: 11, fontStyle: 'bold', fill: '#1a2634', align: 'center',
        }));
    }

    // ── 电磁铁（U形静铁芯，整块软钢）──────
    _drawElectromagnet() {
        const { _emX: ex, _emY: ey, _emW: ew, _emH: eh, _emCX: ecx, _emCY: ecy } = this;

        // 外壳
        this.group.add(new Konva.Rect({
            x: ex, y: ey, width: ew, height: eh,
            fill: '#1c2b38', stroke: '#263238', strokeWidth: 2, cornerRadius: 5,
        }));
        this.group.add(new Konva.Text({
            x: ex, y: ey - 14, width: ew,
            text: '电磁系统截面图（直流，整块软钢铁芯）', fontSize: 9, fontStyle: 'bold',
            fill: '#546e7a', align: 'center',
        }));

        // ── U形静铁芯（底部 U 形） ──
        // 直流铁芯无叠片纹（整块软钢，填充实色）
        const coreCol  = '#455a64';
        const coreEdge = '#263238';
        const yoke     = Math.round(eh * 0.12);
        const limb     = Math.round(ew * 0.20);
        const limbH    = Math.round(eh * 0.38);
        const coreX    = ex + Math.round(ew * 0.10);
        const coreW    = Math.round(ew * 0.80);
        const yokeY    = ey + eh - Math.round(eh * 0.12) - yoke;

        // 底轭
        this.group.add(new Konva.Rect({ x: coreX, y: yokeY, width: coreW, height: yoke, fill: coreCol, stroke: coreEdge, strokeWidth: 1.5 }));
        // 左右柱（整块，无叠片纹）
        [coreX, coreX + coreW - limb].forEach(lx => {
            this.group.add(new Konva.Rect({ x: lx, y: yokeY - limbH, width: limb, height: limbH, fill: '#546e7a', stroke: coreEdge, strokeWidth: 1.5 }));
        });
        // 极面标注
        this.group.add(new Konva.Text({ x: coreX, y: yokeY - limbH + 4, text: 'N', fontSize: 11, fontStyle: 'bold', fill: '#ef9a9a' }));
        this.group.add(new Konva.Text({ x: coreX + coreW - limb, y: yokeY - limbH + 4, text: 'S', fontSize: 11, fontStyle: 'bold', fill: '#90caf9' }));
        this.group.add(new Konva.Text({ x: coreX, y: yokeY + yoke*0.35, width: coreW, text: '静铁芯（U形，整块软钢）', fontSize: 8, fill: '#78909c', align: 'center' }));

        // 无叠片纹说明
        this.group.add(new Konva.Text({ x: ex + 4, y: yokeY - 12, width: ew - 8, text: '⚡ 直流：无需叠片铁芯', fontSize: 7.5, fill: '#ffd54f', align: 'left' }));

        // 气隙
        const gapY  = yokeY - limbH - Math.round(eh * 0.06);
        const gapH  = Math.round(eh * 0.06);
        this.group.add(new Konva.Rect({ x: coreX, y: gapY, width: coreW, height: gapH, fill: '#06101a' }));
        this.group.add(new Konva.Text({ x: coreX, y: gapY + 1, width: coreW, text: '─ 气隙 δ ─', fontSize: 7, fill: '#37474f', align: 'center' }));

        this._coreX    = coreX;
        this._coreW    = coreW;
        this._limb     = limb;
        this._limbH    = limbH;
        this._yokeY    = yokeY;
        this._yoke     = yoke;
        this._gapY     = gapY;
        this._gapH     = gapH;
        this._limbLeft  = coreX;
        this._limbRight = coreX + coreW - limb;
        this._armatureHomeY = ey + Math.round(eh * 0.05);
        this._armatureSealY = gapY - Math.round(eh * 0.10);
    }

    // ── 直流线圈（密绕，高匝数，无叠片铁芯可视） ──
    _drawCoilWinding() {
        const { _emX: ex, _emY: ey, _emW: ew, _emH: eh, _emCX: ecx } = this;
        const coilCX  = this._coreX + this._coreW / 2;
        const coilY1  = this._gapY - this._limbH + Math.round(this._limbH * 0.08);
        const coilY2  = this._yokeY - Math.round(this._limbH * 0.06);
        const coilH   = coilY2 - coilY1;
        const coilInR = (this._coreW - 2 * this._limb) / 2 - 2;  // 线圈内侧紧贴铁芯柱
        const coilOutR= coilInR + Math.round(ew * 0.14);

        // 线圈骨架（示意中间矩形区域）
        this._coilBobbin = new Konva.Rect({
            x: coilCX - coilOutR, y: coilY1,
            width: coilOutR * 2, height: coilH,
            fill: '#1a0505', stroke: '#37474f', strokeWidth: 1, cornerRadius: 2,
        });

        // 密绕线圈（细线多匝，颜色交替）
        const turnN  = 18;
        const turnH  = coilH / turnN;
        const cols   = ['#d84315', '#e64a19', '#bf360c'];  // 红色系（直流线圈，漆包线）
        this._coilGroup = new Konva.Group();
        for (let i = 0; i < turnN; i++) {
            const ty  = coilY1 + i * turnH;
            const col = cols[i % 3];
            this._coilGroup.add(new Konva.Line({
                points: [coilCX - coilOutR, ty, coilCX + coilOutR, ty,
                         coilCX + coilOutR, ty + turnH * 0.88,
                         coilCX - coilOutR, ty + turnH * 0.88,
                         coilCX - coilOutR, ty + turnH],
                stroke: col, strokeWidth: 1.8, lineCap: 'round', lineJoin: 'round', opacity: 0.85,
            }));
        }

        // 接线端（+/-）
        const termX = ex + 10;
        this.group.add(new Konva.Line({ points: [coilCX - coilOutR, coilY1 + 4, termX, coilY1 + 4, termX, this._emCY - 18], stroke: '#e53935', strokeWidth: 2, lineCap: 'round' }));
        this.group.add(new Konva.Line({ points: [coilCX - coilOutR, coilY2 - 4, termX, coilY2 - 4, termX, this._emCY + 18], stroke: '#1565c0', strokeWidth: 2, lineCap: 'round' }));
        this.group.add(new Konva.Circle({ x: termX, y: this._emCY - 18, radius: 3, fill: '#e53935', stroke: '#b71c1c', strokeWidth: 0.8 }));
        this.group.add(new Konva.Circle({ x: termX, y: this._emCY + 18, radius: 3, fill: '#1565c0', stroke: '#0d47a1', strokeWidth: 0.8 }));
        this.group.add(new Konva.Text({ x: termX - 12, y: this._emCY - 24, text: '+  A1', fontSize: 8, fill: '#ef9a9a' }));
        this.group.add(new Konva.Text({ x: termX - 12, y: this._emCY + 22, text: '−  A2', fontSize: 8, fill: '#90caf9' }));

        // 线圈发光背景
        this._coilGlow = new Konva.Rect({
            x: coilCX - coilOutR - 4, y: coilY1 - 3,
            width: coilOutR * 2 + 8, height: coilH + 6,
            fill: 'rgba(213,0,0,0)', cornerRadius: 3,
        });
        // 参数标注
        this.group.add(new Konva.Text({ x: coilCX + coilOutR + 3, y: coilY1 + coilH*0.2, text: `N=${this.coilTurns}\nR=${this.coilR}Ω\nτ=${(this.coilTau*1000).toFixed(0)}ms`, fontSize: 7.5, fill: '#ef9a9a', lineHeight: 1.5 }));
        // 时间常数说明
        this.group.add(new Konva.Text({ x: ex + 4, y: coilY2 + 4, width: ew - 8, text: `i(t)=I_ss(1−e^{−t/τ})  τ=${(this.coilTau*1000).toFixed(0)}ms`, fontSize: 7, fill: '#80cbc4', align: 'center' }));

        this._coilY1   = coilY1;
        this._coilY2   = coilY2;
        this._coilCX   = coilCX;
        this._coilOutR = coilOutR;
        this.group.add(this._coilBobbin, this._coilGlow, this._coilGroup);
    }

    // ── 动态磁通流动层 ──────────────────────
    _drawFluxLayer() {
        this._fluxGroup = new Konva.Group();
        this.group.add(this._fluxGroup);
    }

    // ── 动铁芯（E形衔铁，整块软钢，向下吸合） ──
    _drawArmatureLayer() {
        const { _emX: ex, _emY: ey, _emW: ew, _coreX: cx, _coreW: cw, _limb: limb } = this;
        const aYokeH = Math.round(this._limbH * 0.16);
        const aLimbH = Math.round(this._limbH * 0.26);
        const aMiddleH= Math.round(this._limbH * 0.18);

        this._armatureGroup = new Konva.Group({ y: 0 });

        // 顶部轭铁（整块）
        this._armatureGroup.add(new Konva.Rect({
            x: cx, y: this._armatureHomeY, width: cw, height: aYokeH,
            fill: '#546e7a', stroke: '#263238', strokeWidth: 1.5,
        }));
        // E形三个极柱（左/中/右向下突出）
        const ePositions = [cx, cx + (cw - limb)/2, cx + cw - limb];
        ePositions.forEach(lx => {
            const lh = (lx === cx || lx === cx + cw - limb) ? aLimbH : aMiddleH;
            this._armatureGroup.add(new Konva.Rect({
                x: lx, y: this._armatureHomeY + aYokeH, width: limb, height: lh,
                fill: '#607d8b', stroke: '#263238', strokeWidth: 1.5,
            }));
        });
        // 整块标注（无叠片纹）
        this._armatureGroup.add(new Konva.Text({
            x: cx, y: this._armatureHomeY + aYokeH * 0.28, width: cw,
            text: '动铁芯（E形，整块软钢）', fontSize: 8, fill: '#78909c', align: 'center',
        }));

        this._aYokeH   = aYokeH;
        this._aLimbH   = aLimbH;
        this._armatureTravelPx = this._armatureSealY - this._armatureHomeY;
        this.group.add(this._armatureGroup);
    }

    // ── F-δ 气隙特性曲线 ─────────────────────
    _drawFdCurve() {
        const { _fdX: fx, _fdY: fy, _fdW: fw, _fdH: fh } = this;

        this.group.add(new Konva.Rect({ x: fx, y: fy, width: fw, height: fh, fill: '#010d18', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 4 }));
        this.group.add(new Konva.Rect({ x: fx, y: fy, width: fw, height: 13, fill: '#0a1a28', cornerRadius: [4,4,0,0] }));
        this.group.add(new Konva.Text({ x: fx+4, y: fy+2, width: fw-8, text: 'F-δ 气隙特性曲线', fontSize: 8, fontStyle: 'bold', fill: '#80cbc4', align: 'center' }));

        const ox = fx+18, oy = fy+fh-14, aw = fw-24, ah = fh-28;
        this.group.add(new Konva.Line({ points: [ox, oy-ah, ox, oy, ox+aw, oy], stroke: '#37474f', strokeWidth: 0.8 }));
        this.group.add(new Konva.Text({ x: ox-16, y: oy-ah, text: 'F(N)', fontSize: 7, fill: '#80cbc4' }));
        this.group.add(new Konva.Text({ x: ox+aw+2, y: oy+2, text: 'δ(mm)', fontSize: 7, fill: '#80cbc4' }));

        // 刻度
        [1,2,3,4,5,6].forEach(d => {
            const nx = ox + (d/6.5) * aw;
            this.group.add(new Konva.Line({ points: [nx, oy, nx, oy+3], stroke: '#37474f', strokeWidth: 0.7 }));
            this.group.add(new Konva.Text({ x: nx-5, y: oy+4, text: d+'', fontSize: 6, fill: '#37474f', align: 'center' }));
        });

        // 电磁吸力曲线（F ∝ 1/δ²，稳态电流）
        const fPts = [], fPtsHalf = [];
        const I_ss = this.coilIss;
        for (let di = 0.1; di <= 6.5; di += 0.05) {
            const delta = di * 1e-3;
            const F     = this._calcForce(I_ss, delta);
            const x     = ox + (di/6.5) * aw;
            const Fmax  = this._calcForce(I_ss, 0.1e-3);
            const y     = oy - Math.min(ah-2, (F/Fmax) * (ah-2));
            fPts.push(x, y);
            const F2    = this._calcForce(I_ss * 0.65, delta);
            const y2    = oy - Math.min(ah-2, (F2/Fmax) * (ah-2));
            fPtsHalf.push(x, y2);
        }
        this.group.add(new Konva.Line({ points: fPts,      stroke: '#66bb6a', strokeWidth: 1.8, lineJoin: 'round', opacity: 0.7 }));
        this.group.add(new Konva.Line({ points: fPtsHalf,  stroke: '#4fc3f7', strokeWidth: 1.2, lineJoin: 'round', opacity: 0.5, dash: [4,3] }));

        // 弹簧特性（线性，从 0 到 δmax）
        const springPts = [ox, oy - (this.springForce/this._calcForce(I_ss,0.1e-3))*(ah-2)*0.15, ox+aw, oy - 0];
        this.group.add(new Konva.Line({ points: springPts, stroke: '#ef5350', strokeWidth: 1.2, lineJoin: 'round', opacity: 0.6, dash: [3,3] }));

        // 图例
        const lgY = fy + 16;
        [[fw*0.55,'#66bb6a','F(I_ss)'], [fw*0.55,'#4fc3f7','F(0.65×I_ss)'], [fw*0.55,'#ef5350','弹簧反力']].forEach(([xr, col, lbl], i) => {
            this.group.add(new Konva.Line({ points: [fx+xr, lgY+i*10+3, fx+xr+14, lgY+i*10+3], stroke: col, strokeWidth: i===2?1.2:i===1?1.2:1.8, dash: i>0?[3,3]:[] }));
            this.group.add(new Konva.Text({ x: fx+xr+16, y: lgY+i*10-1, text: lbl, fontSize: 6.5, fill: col }));
        });

        // 动态工作点
        this._fdPoint  = new Konva.Circle({ x: ox, y: oy, radius: 4.5, fill: '#ffd54f', stroke: '#f9a825', strokeWidth: 1.5 });
        this.group.add(this._fdPoint);
        this._fdOX = ox; this._fdOY = oy; this._fdAW = aw; this._fdAH = ah;
        this._fdFmax = this._calcForce(I_ss, 0.1e-3);
    }

    // ── 主触点 + 磁吹弧系统 ─────────────────
    _drawMainContacts() {
        const { _ctX: cx, _ctY: cy, _ctW: cw, _ctH: ch } = this;

        this.group.add(new Konva.Rect({ x: cx, y: cy, width: cw, height: ch, fill: '#0d1520', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 4 }));
        this.group.add(new Konva.Rect({ x: cx, y: cy, width: cw, height: 13, fill: '#0a1a28', cornerRadius: [4,4,0,0] }));
        this.group.add(new Konva.Text({ x: cx+4, y: cy+2, width: cw-8, text: `主触点（${this.polePairs}P  ${this.ratedCurrent}A DC）磁吹弧`, fontSize: 8, fontStyle: 'bold', fill: '#80cbc4', align: 'center' }));

        const step   = cw / (this.polePairs + 1);
        const busCol = '#78909c', busEdge = '#455a64';
        const fixH   = 10, bridgeH = 8;

        this.group.add(new Konva.Rect({ x: cx+4, y: cy+16, width: cw-8, height: 7, fill: busCol, stroke: busEdge, strokeWidth: 1 }));
        this.group.add(new Konva.Rect({ x: cx+4, y: cy+ch-16, width: cw-8, height: 7, fill: busCol, stroke: busEdge, strokeWidth: 1 }));

        this._mainBridgeGroups = [];

        for (let i = 1; i <= this.polePairs; i++) {
            const px = cx + step * i;

            // 上固定触头（银钨合金）
            this.group.add(new Konva.Rect({ x: px-10, y: cy+23, width: 20, height: fixH, fill: '#cfd8dc', stroke: '#546e7a', strokeWidth: 0.8, cornerRadius: 2 }));
            this.group.add(new Konva.Text({ x: px-9, y: cy+25, text: 'AgW', fontSize: 6, fill: '#607d8b' }));
            // 下固定触头
            this.group.add(new Konva.Rect({ x: px-10, y: cy+ch-26, width: 20, height: fixH, fill: '#cfd8dc', stroke: '#546e7a', strokeWidth: 0.8, cornerRadius: 2 }));
            this.group.add(new Konva.Text({ x: px-9, y: cy+ch-24, text: 'AgW', fontSize: 6, fill: '#607d8b' }));

            this.group.add(new Konva.Line({ points: [px, cy+16, px, cy+23], stroke: '#78909c', strokeWidth: 4 }));
            this.group.add(new Konva.Line({ points: [px, cy+ch-16, px, cy+ch-26], stroke: '#78909c', strokeWidth: 4 }));

            const bridgeGroup = new Konva.Group();
            const bridgeMidY  = (cy + 33 + cy + ch - 26 - bridgeH) / 2;
            bridgeGroup.add(new Konva.Rect({ x: px-13, y: 0, width: 26, height: bridgeH, fill: '#90a4ae', stroke: '#546e7a', strokeWidth: 0.8, cornerRadius: 2 }));
            // 银钨触头
            bridgeGroup.add(new Konva.Circle({ x: px-7, y: bridgeH/2, radius: 4, fill: '#eceff1', stroke: '#9e9e9e', strokeWidth: 0.5 }));
            bridgeGroup.add(new Konva.Circle({ x: px+7, y: bridgeH/2, radius: 4, fill: '#eceff1', stroke: '#9e9e9e', strokeWidth: 0.5 }));

            bridgeGroup.y(bridgeMidY - cy);
            this._mainBridgeGroups.push({ group: bridgeGroup, midY: bridgeMidY });
            this.group.add(bridgeGroup);

            this.group.add(new Konva.Text({ x: px-6, y: cy+14, text: `P${i}`, fontSize: 7, fill: '#ef9a9a' }));
            this.group.add(new Konva.Text({ x: px-6, y: cy+ch-12, text: `N${i}`, fontSize: 7, fill: '#90caf9' }));
        }

        // 磁吹弧线圈（绕在触点旁，串联于主回路）
        const blowX = cx + 6, blowW = cw - 12;
        this.group.add(new Konva.Rect({ x: blowX, y: cy+ch-52, width: blowW, height: 14, fill: '#0a1520', stroke: '#1e3a5f', strokeWidth: 0.8, dash: [4,3], cornerRadius: 2 }));
        this.group.add(new Konva.Text({ x: blowX+2, y: cy+ch-50, text: `磁吹线圈（${this.blowCoilTurns}匝，串联）→ 磁场 B ↑`, fontSize: 7, fill: '#4fc3f7' }));

        // 灭弧栅示意
        const gridY  = cy + 33;
        const gridH  = ch - 66;
        const gridSX = cx + 4, gridEX = cx + cw - 4;
        for (let g = 0; g < this.arcGridCount; g++) {
            const gy = gridY + (g / this.arcGridCount) * gridH;
            this.group.add(new Konva.Line({ points: [gridSX, gy, gridEX, gy], stroke: '#1e3a5f', strokeWidth: 0.7, opacity: 0.5 }));
        }
        this.group.add(new Konva.Text({ x: cx + 4, y: cy + 34, text: `灭弧栅（${this.arcGridCount}片）`, fontSize: 7, fill: '#1e3a5f' }));
        this.group.add(new Konva.Rect({ x: gridSX, y: gridY, width: gridEX-gridSX, height: gridH, fill: 'rgba(0,0,0,0)', stroke: '#1e3a5f', strokeWidth: 0.6, dash: [3,3] }));

        // 行程条
        this.group.add(new Konva.Text({ x: cx+4, y: cy+ch-62, text: '行程:', fontSize: 7, fill: '#37474f' }));
        this.group.add(new Konva.Rect({ x: cx+30, y: cy+ch-63, width: cw-38, height: 7, fill: '#0a0a18', cornerRadius: 2 }));
        this._travelBar  = new Konva.Rect({ x: cx+30, y: cy+ch-63, width: 0, height: 7, fill: '#66bb6a', cornerRadius: 2 });
        this._travelBarW = cw - 38;
        this.group.add(this._travelBar);

        this._mainBridgeOpenY    = cy + 33;
        this._mainBridgeCloseYBot= cy + ch - 26 - bridgeH;
    }

    // ── 直流电弧动画层（磁吹，弧形轨迹） ───
    _drawArcLayer() {
        this._arcGroup = new Konva.Group({ opacity: 0 });
        this.group.add(this._arcGroup);
    }

    // ── 辅助触点 ─────────────────────────────
    _drawAuxContacts() {
        const { _auxX: ax, _auxY: ay, _auxW: aw, _auxH: ah } = this;

        this.group.add(new Konva.Rect({ x: ax, y: ay, width: aw, height: ah, fill: '#0d1520', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 4 }));
        this.group.add(new Konva.Rect({ x: ax, y: ay, width: aw, height: 13, fill: '#0a1a28', cornerRadius: [4,4,0,0] }));
        this.group.add(new Konva.Text({ x: ax+4, y: ay+2, width: aw-8, text: '辅助触点', fontSize: 8, fontStyle: 'bold', fill: '#80cbc4', align: 'center' }));

        const drawAux = (label, t1, t2, isNO, xOff, yOff) => {
            const tx = ax + xOff, ty = ay + yOff;
            const hw = aw * 0.40, hcx = tx + hw / 2 + 6;
            this.group.add(new Konva.Rect({ x: tx, y: ty, width: hw + 12, height: ah / 2 - 4, fill: '#0a1020', stroke: '#1a2540', strokeWidth: 0.8, cornerRadius: 2 }));
            this.group.add(new Konva.Text({ x: tx + 2, y: ty + 2, text: label, fontSize: 7, fill: '#546e7a' }));
            this.group.add(new Konva.Rect({ x: hcx - 12, y: ty + 13, width: 24, height: 5, fill: '#607d8b', stroke: '#37474f', strokeWidth: 0.5, cornerRadius: 1 }));
            this.group.add(new Konva.Rect({ x: hcx - 12, y: ty + ah/2 - 14, width: 24, height: 5, fill: '#607d8b', stroke: '#37474f', strokeWidth: 0.5, cornerRadius: 1 }));
            this.group.add(new Konva.Text({ x: tx + 2, y: ty + 11, text: t1, fontSize: 6.5, fill: '#4fc3f7' }));
            this.group.add(new Konva.Text({ x: tx + 2, y: ty + ah/2 - 15, text: t2, fontSize: 6.5, fill: '#4fc3f7' }));

            const bridge = new Konva.Rect({ x: hcx - 10, y: isNO ? ty + 25 : ty + 18, width: 20, height: 5, fill: '#b0bec5', stroke: '#546e7a', strokeWidth: 0.5, cornerRadius: 1 });
            const dot    = new Konva.Circle({ x: tx + hw + 8, y: ty + 6, radius: 4, fill: '#263238', stroke: '#1a252f', strokeWidth: 0.5 });
            this.group.add(bridge, dot);
            return { bridge, dot, isNO, openY: isNO ? ty + 25 : ty + 18, closeY: isNO ? ty + 18 : ty + 25 };
        };

        this._auxNO = drawAux('NO  13-14', '13', '14', true,  4,       16);
        this._auxNC = drawAux('NC  21-22', '21', '22', false, aw/2+4,  16);
    }

    // ── LCD 仪表 ─────────────────────────────
    _drawLCDPanel() {
        const { _lcdX: lx, _lcdY: ly, _lcdW: lw, _lcdH: lh } = this;

        this.group.add(new Konva.Rect({ x: lx, y: ly, width: lw, height: lh, fill: '#020c14', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 4 }));
        this.group.add(new Konva.Rect({ x: lx, y: ly, width: lw, height: 13, fill: '#0a1a28', cornerRadius: [4,4,0,0] }));
        this.group.add(new Konva.Text({ x: lx+4, y: ly+2, width: lw-8, text: '运行仪表', fontSize: 8, fontStyle: 'bold', fill: '#80cbc4', align: 'center' }));

        const cells = [
            { label: 'Uc',    id: 'uc',    unit: 'V DC', color: '#ef9a9a' },
            { label: 'Ic(线圈)',id: 'ic',  unit: 'A',    color: '#ffd54f' },
            { label: 'F_em',  id: 'fem',   unit: 'N',    color: '#66bb6a' },
            { label: 'δ(气隙)', id: 'gap', unit: 'mm',  color: '#4fc3f7' },
            { label: '状态',  id: 'state', unit: '',     color: '#80cbc4' },
            { label: '操作次数', id: 'ops', unit: '次',  color: '#ffa726' },
            { label: 'I_main',id: 'imain', unit: 'A',    color: '#90caf9' },
            { label: 'U_arc', id: 'uarc',  unit: 'V',    color: '#ff8a65' },
            { label: '电寿命', id: 'life',  unit: '%',   color: '#ef9a9a' },
        ];

        const cellW = (lw - 8) / 3, cellH = 22, gap = 2;
        this._lcdCells = {};
        cells.forEach(({ label, id, unit, color }, i) => {
            const col = i % 3, row = Math.floor(i / 3);
            const cx3 = lx + 4 + col * (cellW + gap);
            const cy3 = ly + 16 + row * (cellH + gap);
            this.group.add(new Konva.Rect({ x: cx3, y: cy3, width: cellW, height: cellH, fill: '#0d1520', cornerRadius: 2 }));
            this.group.add(new Konva.Text({ x: cx3+2, y: cy3+2, text: label, fontSize: 6.5, fill: '#37474f' }));
            const val = new Konva.Text({ x: cx3+2, y: cy3+9, width: cellW-4, text: '--', fontSize: 9, fontFamily: 'Courier New, monospace', fontStyle: 'bold', fill: color, align: 'right' });
            this.group.add(new Konva.Text({ x: cx3+2, y: cy3+14, width: cellW-4, text: unit, fontSize: 6, fill: '#1a252f', align: 'right' }));
            this._lcdCells[id] = val;
            this.group.add(val);
        });

        const indY = ly + 16 + 22 * 3 + gap * 3 + 4;
        const indH = lh - (indY - ly) - 6;
        if (indH > 16) {
            this._stateText = new Konva.Text({ x: lx + 4, y: indY + indH * 0.2, width: lw - 8, text: '◉  断  开（释放）', fontSize: 11, fontStyle: 'bold', fill: '#ef5350', align: 'center' });
            this.group.add(new Konva.Rect({ x: lx+4, y: indY, width: lw-8, height: indH, fill: '#0d1520', cornerRadius: 3 }));
            this.group.add(this._stateText);
        }
    }

    // ── 控制面板 ─────────────────────────────
    _drawControlPanel() {
        const { _panX: px, _panY: py, _panW: pw, _panH: ph } = this;

        this.group.add(new Konva.Rect({ x: px, y: py, width: pw, height: ph, fill: '#0d1520', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 4 }));
        this.group.add(new Konva.Rect({ x: px, y: py, width: pw, height: 13, fill: '#0a1a28', cornerRadius: [4,4,0,0] }));
        this.group.add(new Konva.Text({ x: px+4, y: py+2, width: pw-8, text: '控制操作', fontSize: 8, fontStyle: 'bold', fill: '#80cbc4', align: 'center' }));

        const bW = (pw - 16) / 2, bH = 20, bY = py + 16;
        [[px+4,     '⬛ 合  闸', '#1a3a1a', '#2e7d32', '#66bb6a', () => this.close()],
         [px+8+bW,  '⬜ 分  闸', '#3a1a1a', '#c62828', '#ef5350', () => this.open()]].forEach(([bx, lbl, fill, stroke, col, cb]) => {
            const btn = new Konva.Rect({ x: bx, y: bY, width: bW, height: bH, fill, stroke, strokeWidth: 1.5, cornerRadius: 3 });
            const t   = new Konva.Text({ x: bx, y: bY+5, width: bW, text: lbl, fontSize: 10, fontStyle: 'bold', fill: col, align: 'center' });
            btn.on('click tap', cb);
            btn.on('mouseenter', () => btn.opacity(0.75));
            btn.on('mouseleave', () => btn.opacity(1));
            this.group.add(btn, t);
        });

        // 线圈电压调节
        const slY = py + 44;
        this.group.add(new Konva.Text({ x: px+4, y: slY - 11, text: `线圈电压 Uc (额定 ${this.ratedVoltageCoil}V DC):`, fontSize: 8, fill: '#546e7a' }));
        this.group.add(new Konva.Rect({ x: px+4, y: slY, width: (pw-16)/2, height: 8, fill: '#0a0a18', cornerRadius: 2 }));
        this._voltBar    = new Konva.Rect({ x: px+4, y: slY, width: 0, height: 8, fill: '#ef9a9a', cornerRadius: 2 });
        this._voltValTxt = new Konva.Text({ x: px+4 + (pw-16)/2 + 3, y: slY-2, width: 36, text: '0V', fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#ef9a9a' });
        this._voltBarW   = (pw - 16) / 2;
        this._voltBarX   = px + 4;
        const hitV = new Konva.Rect({ x: px+4, y: slY-2, width: (pw-16)/2, height: 13, fill: 'transparent' });
        hitV.on('click tap mousedown', e => {
            const stage = this.group.getStage?.();
            const pos   = stage?.getPointerPosition?.() ?? { x: e.evt?.clientX ?? 0 };
            const ratio = Math.max(0, Math.min(1, (pos.x - (this.group.x?.() ?? 0) - (px+4)) / ((pw-16)/2)));
            this._coilVoltSet = ratio * this.ratedVoltageCoil * 1.2;
        });

        // 主回路电流调节（影响电弧持续时间）
        const slY2 = py + 44;
        const slX2 = px + 4 + (pw-16)/2 + 48;
        this.group.add(new Konva.Text({ x: slX2, y: slY2 - 11, text: `主回路电流 I_main:`, fontSize: 8, fill: '#546e7a' }));
        this.group.add(new Konva.Rect({ x: slX2, y: slY2, width: (pw-16)/2 - 12, height: 8, fill: '#0a0a18', cornerRadius: 2 }));
        this._iMainBar    = new Konva.Rect({ x: slX2, y: slY2, width: 0, height: 8, fill: '#90caf9', cornerRadius: 2 });
        this._iMainValTxt = new Konva.Text({ x: slX2 + (pw-16)/2 - 8, y: slY2-2, width: 36, text: '50A', fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#90caf9' });
        this._iMainBarW   = (pw - 16) / 2 - 12;
        this._iMainBarX   = slX2;
        const hitI = new Konva.Rect({ x: slX2, y: slY2-2, width: (pw-16)/2 - 12, height: 13, fill: 'transparent' });
        hitI.on('click tap mousedown', e => {
            const stage = this.group.getStage?.();
            const pos   = stage?.getPointerPosition?.() ?? { x: e.evt?.clientX ?? 0 };
            const ratio = Math.max(0, Math.min(1, (pos.x - (this.group.x?.() ?? 0) - slX2) / ((pw-16)/2 - 12)));
            this.mainCurrent = ratio * this.ratedCurrent * 1.2;
        });

        this.group.add(this._voltBar, this._voltValTxt, hitV, this._iMainBar, this._iMainValTxt, hitI);
    }

    // ── 波形区（4 通道）────────────────────
    _drawWaveform() {
        const { _wavX: wx, _wavY: wy, _wavW: ww, _wavH: wh } = this;
        if (wh < 14) return;

        this.group.add(new Konva.Rect({ x: wx, y: wy, width: ww, height: wh, fill: '#010d18', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 4 }));
        this.group.add(new Konva.Rect({ x: wx, y: wy, width: ww, height: 12, fill: '#0a1a28', cornerRadius: [4,4,0,0] }));
        this.group.add(new Konva.Text({ x: wx+4, y: wy+1, width: ww-8, text: 'Ic 线圈电流(RL暂态)   F_em 吸力   δ 气隙   U_arc 弧压', fontSize: 8, fill: '#80cbc4', align: 'center' }));

        const h4 = (wh - 12) / 4;
        this._wavMids = [wy+12+h4*0.5, wy+12+h4*1.5, wy+12+h4*2.5, wy+12+h4*3.5];
        this._wavMids.forEach(my => this.group.add(new Konva.Line({ points: [wx+2, my, wx+ww-2, my], stroke: 'rgba(200,200,200,0.06)', strokeWidth: 0.5, dash: [4,3] })));

        this._wLineI    = new Konva.Line({ points: [], stroke: '#ffd54f', strokeWidth: 1.5, lineJoin: 'round' });
        this._wLineF    = new Konva.Line({ points: [], stroke: '#66bb6a', strokeWidth: 1.5, lineJoin: 'round' });
        this._wLineGap  = new Konva.Line({ points: [], stroke: '#4fc3f7', strokeWidth: 1.5, lineJoin: 'round' });
        this._wLineArc  = new Konva.Line({ points: [], stroke: '#ff8a65', strokeWidth: 1.5, lineJoin: 'round' });

        ['Ic', 'F', 'δ', 'Uarc'].forEach((l, i) => {
            this.group.add(new Konva.Text({ x: wx+4, y: wy+12+h4*i+3, text: l, fontSize: 8, fill: ['#ffd54f','#66bb6a','#4fc3f7','#ff8a65'][i] }));
        });
        this.group.add(this._wLineI, this._wLineF, this._wLineGap, this._wLineArc);
        this._wavH4 = h4;
    }

    // ═══════════════════════════════════════════
    _startAnimation() {
        const tick = ts => {
            if (this._lastTs !== null) {
                const dt = Math.min((ts - this._lastTs) / 1000, 0.05);
                this._tickStateMachine(dt);
                this._tickPhysics(dt);
                this._tickFluxViz(dt);
                this._tickArmatureViz();
                this._tickContactsViz();
                this._tickArcViz(dt);
                this._tickFdPoint();
                this._tickWaveform(dt);
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

    // ── 状态机 ──────────────────────────────
    _tickStateMachine(dt) {
        switch (this._phase) {
            case 'closing':
                this._phaseTimer += dt;
                // 吸合条件：电磁力 > 弹簧力（依赖线圈电流建立）
                const closeProg = Math.min(1, this._phaseTimer / this.closeTime);
                this._armaturePos = closeProg;
                if (closeProg >= 1) {
                    this._phase      = 'bounce';
                    this._phaseTimer = 0;
                    this._bounceAmp  = 0.15;
                    this._triggerArc('close');
                    this.opsCount++;
                    this.elecOps++;
                }
                break;
            case 'bounce':
                // 触点弹跳（直流接触器弹跳更明显，无过零熄弧，需靠弹跳幅度衰减）
                this._phaseTimer += dt;
                const bProg = this._phaseTimer / this.bounceTime;
                this._bounceAmp *= Math.exp(-dt * 18);
                this._armaturePos = 1 - this._bounceAmp * Math.abs(Math.sin(bProg * Math.PI * 6));
                if (this._bounceAmp < 0.005) {
                    this._armaturePos = 1;
                    this._phase       = 'closed';
                    this.contactState = 'closed';
                }
                break;
            case 'opening':
                this._phaseTimer += dt;
                const openProg = Math.min(1, this._phaseTimer / this.openTime);
                this._armaturePos = 1 - openProg;
                if (openProg >= 1) {
                    this._armaturePos = 0;
                    this._phase       = 'open';
                    this.contactState = 'open';
                    this._triggerArc('open');
                    this.opsCount++;
                    this.elecOps++;
                }
                break;
        }
    }

    // ── 物理量计算 ───────────────────────────
    _tickPhysics(dt) {
        // 线圈电流（直流 RL 一阶响应）
        if (this._coilEnergized) {
            this.coilVoltage = this._coilVoltSet;
            const I_ss = this._coilVoltSet / this.coilR;
            // 增长（合闸暂态）
            this.coilCurrent += (I_ss - this.coilCurrent) * (1 - Math.exp(-dt / this.coilTau));
        } else {
            this.coilVoltage = 0;
            // 衰减（断电，电感续流）
            this.coilCurrent *= Math.exp(-dt / this.coilTau);
        }
        this.coilCurrent = Math.max(0, this.coilCurrent);

        // 当前气隙（由衔铁位置线性插值）
        this.airGap = this.maxAirGap * (1 - this._armaturePos) + this.minAirGap * this._armaturePos;

        // 电磁吸力
        this.forceEM = this._calcForce(this.coilCurrent, this.airGap);

        // 磁通密度（用于可视化）
        const Rgap  = this.airGap / (this.mu0 * this.poleArea);
        const Riron = 0.1 * Rgap; // 简化：铁芯磁阻约为气隙的 10%
        const Rtot  = Rgap + Riron;
        const flux  = (Rtot > 0) ? (this.coilTurns * this.coilCurrent) / Rtot : 0;
        this.fluxDensity = (this.poleArea > 0) ? Math.min(2.0, flux / this.poleArea) : 0;

        // 电弧电压（仅电弧激活时）
        if (this._arcActive) {
            this._arcVoltage = this.arcVolt0 + this.arcField * this._arcLength;
        } else {
            this._arcVoltage = 0;
        }

        // 波形数据
        this._wavCoilI  = new Float32Array([...this._wavCoilI.slice(1),  this.coilCurrent]);
        this._wavForce  = new Float32Array([...this._wavForce.slice(1),  this.forceEM]);
        this._wavGap    = new Float32Array([...this._wavGap.slice(1),    this.airGap * 1000]);
        this._wavArcV   = new Float32Array([...this._wavArcV.slice(1),   this._arcVoltage || 0]);
    }

    // ── 吸力计算（考虑气隙变化） ─────────────
    _calcForce(I, delta) {
        if (delta <= 0 || I <= 0) return 0;
        const NI   = this.coilTurns * I;
        const Rgap = delta / (this.mu0 * this.poleArea);
        const flux = NI / (Rgap * 1.1);          // 1.1 铁芯磁阻系数
        const B    = Math.min(2.2, flux / this.poleArea);
        return (B * B * this.poleArea) / (2 * this.mu0); // 两个极面
    }

    // ── 磁通可视化 ───────────────────────────
    _tickFluxViz(dt) {
        this._fluxGroup.destroyChildren();
        if (this.coilCurrent < 0.02) return;

        const B     = Math.min(1, this.fluxDensity / 1.8);
        const alpha = B * 0.7;
        // 磁路闭合：U形铁芯 + E形动铁芯，磁通绕行
        // 用粒子沿磁路轨迹流动示意
        const cx  = this._coreX;
        const cw  = this._coreW;
        const lim = this._limb;
        const yokeY = this._yokeY;
        const gapY  = this._gapY;

        // 模拟磁通路径：矩形回路（顺时针）
        const pathNodes = [
            [cx + lim/2,        gapY],
            [cx + lim/2,        yokeY - this._limbH * 0.5],
            [cx + cw/2,         yokeY + this._yoke * 0.5],
            [cx + cw - lim/2,   yokeY - this._limbH * 0.5],
            [cx + cw - lim/2,   gapY],
        ];
        const nPart = 8;
        const totalSeg = pathNodes.length;
        for (let i = 0; i < nPart; i++) {
            const t    = ((this._fluxPhase + i / nPart) % 1 + 1) % 1;
            const seg  = Math.floor(t * totalSeg);
            const frac = (t * totalSeg) % 1;
            const p0   = pathNodes[seg % totalSeg];
            const p1   = pathNodes[(seg + 1) % totalSeg];
            const px   = p0[0] + (p1[0] - p0[0]) * frac;
            const py   = p0[1] + (p1[1] - p0[1]) * frac;
            this._fluxGroup.add(new Konva.Circle({ x: px, y: py, radius: 2.5 + B, fill: `rgba(255,213,79,${alpha * (0.5 + 0.5 * B)})` }));
        }

        // 线圈发光
        const glowAlpha = Math.min(0.35, B * 0.35);
        if (this._coilGlow) this._coilGlow.fill(`rgba(213,0,0,${glowAlpha})`);
        if (this._coilGroup) this._coilGroup.opacity(0.45 + B * 0.55);
    }

    // ── 衔铁位置动画 ─────────────────────────
    _tickArmatureViz() {
        if (!this._armatureGroup) return;
        const dy = this._armaturePos * this._armatureTravelPx;
        this._armatureGroup.y(dy);
        if (this._travelBar) this._travelBar.width(this._armaturePos * this._travelBarW);
    }

    // ── 主触点 + 辅助触点动画 ────────────────
    _tickContactsViz() {
        const pos = this._armaturePos;
        this._mainBridgeGroups.forEach(({ group }) => {
            const openY  = this._mainBridgeOpenY;
            const closeY = this._mainBridgeCloseYBot;
            group.y(openY + pos * (closeY - openY) - this._ctY);
        });
        if (this._auxNO) {
            const closed = pos > 0.88;
            this._auxNO.bridge.y(closed ? this._auxNO.closeY : this._auxNO.openY);
            this._auxNO.dot.fill(closed ? '#66bb6a' : '#263238');
        }
        if (this._auxNC) {
            const closed = pos < 0.12;
            this._auxNC.bridge.y(closed ? this._auxNC.closeY : this._auxNC.openY);
            this._auxNC.dot.fill(closed ? '#ef5350' : '#263238');
        }
    }

    // ── 直流电弧动画（磁吹弧，弧形轨迹） ───
    _triggerArc(type) {
        this._arcActive  = true;
        this._arcTimer   = 0;
        this._arcType    = type;
        // 电弧持续时间正比于主回路电流
        this._arcMaxTime = this.arcTimeBase * (this.mainCurrent / this.ratedArcCurr);
        this._arcLength  = 0;
    }

    _tickArcViz(dt) {
        if (!this._arcActive) { this._arcGroup.opacity(0); return; }
        this._arcTimer  += dt;
        this._arcLength += dt * 40;  // mm/s，电弧被磁场拉伸

        if (this._arcTimer > this._arcMaxTime || this._arcVoltage > this.ratedVoltagePole * 0.8) {
            this._arcActive = false;
            this._arcGroup.opacity(0);
            return;
        }

        const prog  = this._arcTimer / this._arcMaxTime;
        const alpha = (1 - prog * 0.7) * 0.9;
        this._arcGroup.destroyChildren();
        this._arcGroup.opacity(alpha);

        const step = this._ctW / (this.polePairs + 1);
        for (let i = 1; i <= this.polePairs; i++) {
            const ax    = this._ctX + step * i;
            const arcY0 = this._ctY + this._ctH * 0.40;
            const arcH  = Math.min(this._ctH * 0.35, this._arcLength * 2.5);

            // 磁吹弧路径（S形弯曲向灭弧栅方向移动）
            const midX  = ax + (Math.sin(this._arcTimer * 25) * 8);
            this._arcGroup.add(new Konva.Line({
                points: [ax, arcY0, midX, arcY0 - arcH * 0.5, ax + 6, arcY0 - arcH],
                stroke: `rgba(255,200,60,${alpha * 0.9})`, strokeWidth: 2.5 + prog * 2,
                lineJoin: 'round', bezier: true,
            }));
            // 弧柱发光晕
            this._arcGroup.add(new Konva.Ellipse({ x: ax + 3, y: arcY0 - arcH * 0.5, radiusX: 8 + arcH * 0.15, radiusY: 4, fill: `rgba(255,255,150,${alpha * 0.4})` }));
            // 弧根（阴极/阳极亮斑）
            this._arcGroup.add(new Konva.Circle({ x: ax, y: arcY0, radius: 4, fill: `rgba(255,255,255,${alpha * 0.8})` }));
            this._arcGroup.add(new Konva.Circle({ x: ax + 6, y: arcY0 - arcH, radius: 3, fill: `rgba(255,220,100,${alpha * 0.7})` }));
        }
    }

    // ── F-δ 工作点 ───────────────────────────
    _tickFdPoint() {
        if (!this._fdPoint) return;
        const deltaM = this.airGap * 1000;  // mm
        const x      = this._fdOX + (deltaM / 6.5) * this._fdAW;
        const fNorm  = Math.min(1, this.forceEM / (this._fdFmax || 1));
        this._fdPoint.x(Math.max(this._fdOX, Math.min(this._fdOX + this._fdAW, x)));
        this._fdPoint.y(this._fdOY - fNorm * (this._fdAH - 2));
    }

    // ── 波形 ─────────────────────────────────
    _tickWaveform() {
        if (!this._wavH4 || !this._wavMids) return;

        const wx = this._wavX + 3, ww = this._wavW - 6, n = this._wavLen;
        const dx = ww / n, h4 = this._wavH4;
        const [mI, mF, mG, mA] = this._wavMids;

        const iMax  = Math.max(0.001, this.coilIss * 1.2);
        const fMax  = Math.max(0.1, this._fdFmax || 1);
        const gMax  = this.maxAirGap * 1000;
        const aMax  = Math.max(1, this.ratedVoltagePole * 0.5);

        const ptI=[], ptF=[], ptG=[], ptA=[];
        for (let i = 0; i < n; i++) {
            const x = wx + i * dx;
            ptI.push(x, mI - (this._wavCoilI[i] / iMax)  * h4 * 0.40);
            ptF.push(x, mF - (this._wavForce[i] / fMax)  * h4 * 0.40);
            ptG.push(x, mG - (1 - this._wavGap[i] / gMax)* h4 * 0.40);
            ptA.push(x, mA - (this._wavArcV[i] / aMax)   * h4 * 0.40);
        }
        if (this._wLineI)   this._wLineI.points(ptI);
        if (this._wLineF)   this._wLineF.points(ptF);
        if (this._wLineGap) this._wLineGap.points(ptG);
        if (this._wLineArc) this._wLineArc.points(ptA);
    }

    // ── 仪表显示 ─────────────────────────────
    _tickDisplay() {
        const c = this._lcdCells;
        if (!c) return;

        // 相位推进（磁通粒子用）
        this._fluxPhase = ((this._fluxPhase || 0) + 0.004) % 1;

        if (c.uc)    c.uc.text(this.coilVoltage.toFixed(1));
        if (c.ic)    c.ic.text(this.coilCurrent.toFixed(3));
        if (c.fem)   c.fem.text(this.forceEM.toFixed(2));
        if (c.gap)   c.gap.text((this.airGap * 1000).toFixed(2));
        if (c.state) c.state.text(this._phase === 'closed' ? '吸合' : this._phase === 'closing' ? '合闸中' : this._phase === 'bounce' ? '弹跳' : '断开');
        if (c.ops)   c.ops.text(this.opsCount.toLocaleString());
        if (c.imain) c.imain.text(this.mainCurrent.toFixed(0));
        if (c.uarc)  c.uarc.text((this._arcVoltage || 0).toFixed(1));
        if (c.life)  c.life.text(Math.min(100, this.elecOps / this.elecLife * 100).toFixed(2));

        if (this._stateText) {
            const closed  = this._phase === 'closed';
            const closing = this._phase === 'closing';
            const bounce  = this._phase === 'bounce';
            this._stateText.text(
                closed  ? '◉  吸  合（通电）' :
                closing ? '◎  合  闸  中…'    :
                bounce  ? '◌  触点弹跳中…'    :
                          '◉  断  开（释放）'
            );
            this._stateText.fill(closed ? '#66bb6a' : (closing || bounce) ? '#ffa726' : '#ef5350');
        }

        if (this._voltBar)    this._voltBar.width((this._coilVoltSet / (this.ratedVoltageCoil * 1.2)) * this._voltBarW);
        if (this._voltValTxt) this._voltValTxt.text(`${this._coilVoltSet.toFixed(0)}V`);
        if (this._iMainBar)   this._iMainBar.width((this.mainCurrent / (this.ratedCurrent * 1.2)) * this._iMainBarW);
        if (this._iMainValTxt) this._iMainValTxt.text(`${this.mainCurrent.toFixed(0)}A`);
    }

    // ═══════════════════════════════════════════
    /** 合闸指令 */
    close() {
        if (this._phase === 'open') {
            this._coilEnergized = true;
            this._phase         = 'closing';
            this._phaseTimer    = 0;
        }
    }

    /** 分闸指令 */
    open() {
        if (this._phase === 'closed' || this._phase === 'bounce') {
            this._coilEnergized = false;
            this._phase         = 'opening';
            this._phaseTimer    = 0;
            this.contactState   = 'opening';
        }
    }

    /** 欠压脱扣（线圈电压低于 60% 额定时自动释放） */
    undervoltageRelease() {
        if (this._coilEnergized && this._coilVoltSet < this.ratedVoltageCoil * 0.60) {
            this.open();
        }
    }

    setCoilVoltage(v) {
        this._coilVoltSet = Math.max(0, Math.min(this.ratedVoltageCoil * 1.2, v));
        this._refreshCache();
    }

    setMainCurrent(I) {
        this.mainCurrent = Math.max(0, Math.min(this.ratedCurrent * 1.5, I));
        this._refreshCache();
    }

    getAuxNO() { return this._phase === 'closed'; }
    getAuxNC() { return this._phase !== 'closed' && this._phase !== 'bounce'; }

    update(coilVoltage) {
        if (typeof coilVoltage === 'number') this.setCoilVoltage(coilVoltage);
        this.undervoltageRelease();
        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label: '位号/名称',             key: 'id',               type: 'text'   },
            { label: '线圈额定电压 (V DC)',    key: 'ratedVoltageCoil', type: 'number' },
            { label: '主触点额定电压 (V DC)',  key: 'ratedVoltagePole', type: 'number' },
            { label: '额定电流 (A)',           key: 'ratedCurrent',     type: 'number' },
            { label: '极数',                  key: 'polePairs',        type: 'number' },
            { label: '线圈电阻 (Ω)',           key: 'coilR',            type: 'number' },
            { label: '线圈电感 (H)',           key: 'coilL',            type: 'number' },
            { label: '线圈匝数',               key: 'coilTurns',        type: 'number' },
            { label: '弹簧反力 (N)',           key: 'springForce',      type: 'number' },
            { label: '合闸时间 (s)',           key: 'closeTime',        type: 'number' },
            { label: '分闸时间 (s)',           key: 'openTime',         type: 'number' },
            { label: '磁吹线圈匝数',           key: 'blowCoilTurns',    type: 'number' },
            { label: '灭弧栅片数',             key: 'arcGridCount',     type: 'number' },
            { label: '电寿命 (次)',            key: 'elecLife',         type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        this.id               = cfg.id               || this.id;
        this.ratedVoltageCoil = parseFloat(cfg.ratedVoltageCoil) || this.ratedVoltageCoil;
        this.ratedVoltagePole = parseFloat(cfg.ratedVoltagePole) || this.ratedVoltagePole;
        this.ratedCurrent     = parseFloat(cfg.ratedCurrent)     || this.ratedCurrent;
        this.polePairs        = parseInt(cfg.polePairs)          || this.polePairs;
        this.coilR            = parseFloat(cfg.coilR)            || this.coilR;
        this.coilL            = parseFloat(cfg.coilL)            || this.coilL;
        this.coilTurns        = parseInt(cfg.coilTurns)          || this.coilTurns;
        this.coilTau          = this.coilL / this.coilR;
        this.coilIss          = this.ratedVoltageCoil / this.coilR;
        this.springForce      = parseFloat(cfg.springForce)      || this.springForce;
        this.closeTime        = parseFloat(cfg.closeTime)        || this.closeTime;
        this.openTime         = parseFloat(cfg.openTime)         || this.openTime;
        this.blowCoilTurns    = parseInt(cfg.blowCoilTurns)      || this.blowCoilTurns;
        this.arcGridCount     = parseInt(cfg.arcGridCount)        || this.arcGridCount;
        this.elecLife         = parseFloat(cfg.elecLife)         || this.elecLife;
        this.config           = { ...this.config, ...cfg };
        this._refreshCache();
    }

    destroy() { this._stopAnimation(); super.destroy?.(); }
}