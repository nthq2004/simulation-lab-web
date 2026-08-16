import { BaseComponent } from './BaseComponent.js';

/**
 * 交流接触器仿真组件
 * （AC Electromagnetic Contactor）
 *
 * ── 工作原理 ──────────────────────────────────────────────────
 *
 *  交流接触器是一种利用电磁力自动开关主电路的控制电器，
 *  广泛用于电动机起停、电热设备及照明回路的频繁接通与分断。
 *
 *  1. 电磁系统（驱动机构）：
 *     线圈通入交流电 u = U_m × sin(ωt)
 *     → 铁芯产生交变磁通 Φ = Φ_m × sin(ωt)
 *     → 电磁吸力 F_em = Φ²/(2μ₀A) ∝ (1 - cos2ωt)
 *       其中 100Hz 脉动分量由分磁环（短路环）抵消，
 *       确保衔铁不振动。
 *
 *  2. 分磁环（短路环）：
 *     嵌在铁芯端面槽中的铜短路环，将铁芯端面磁通分成两部分：
 *       Φ_a：未被分磁环覆盖区（直接由主磁通决定）
 *       Φ_b：被分磁环覆盖区（环内感应电流使 Φ_b 滞后 Φ_a 约 60~80°）
 *     F_em_total = F_a + F_b = k(Φ_a² + Φ_b²)
 *     由于 Φ_a 与 Φ_b 相位相差约 70°，合力始终 > 0，消除振动噪声。
 *
 *  3. 触点系统：
 *     主触点（Main Contact）：3 极，额定电流大（10~800A），分断主电路
 *     辅助触点（Auxiliary Contact）：
 *       - 常开（NO，13-14）：线圈通电后闭合，用于自锁/联锁
 *       - 常闭（NC，21-22）：线圈通电后断开，用于联锁保护
 *
 *  4. 动作过程：
 *     合闸（Closing）：线圈通电 → 磁通建立 → 电磁力 > 弹簧反力
 *       → 衔铁吸合（行程约 3~8mm）→ 触点闭合 → 电弧熄弧
 *     分闸（Opening）：线圈断电 → 磁通消失 → 弹簧反力 > 剩磁力
 *       → 衔铁释放 → 触点断开 → 电弧产生与熄弧
 *
 *  5. 电弧与灭弧：
 *     触点分断大电流时产生电弧，弧温可达 6000K。
 *     灭弧方式：磁吹弧（利用电弧电流磁场力拉伸电弧）+灭弧栅。
 *     仿真中以电弧亮斑动画表示，持续 ~30ms。
 *
 *  6. 关键参数：
 *     额定工作电压（Ue）、额定电流（Ie）、线圈电压（Uc）、
 *     操作频率（次/h）、机械寿命（次）、电寿命（次）
 *
 * ── 组件结构 ──────────────────────────────────────────────────
 *  ① 电磁铁截面图（E 形静铁芯 + U 形动铁芯 + 分磁环）
 *  ② 主触点桥（3 极，含触点弹簧、灭弧罩示意）
 *  ③ 辅助触点（NO×1 + NC×1，显示动作状态）
 *  ④ 主绕组线圈（动态发光，随电流变化）
 *  ⑤ 电磁吸力曲线（F-t，含分磁环效果对比）
 *  ⑥ 电弧动画（合/分闸瞬间）
 *  ⑦ 线圈电流与磁通波形（实时波形）
 *  ⑧ 操作次数/寿命累计仪表
 *  ⑨ LCD 仪表（线圈电压、电流、吸力、触点状态）
 *  ⑩ 控制面板（合闸/分闸按钮 + 线圈电压调节）
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  coil_a1   — 线圈端 A1（进）
 *  coil_a2   — 线圈端 A2（出）
 *  main_l1   — 主触点 L1（进线）
 *  main_l2   — 主触点 L2（进线）
 *  main_l3   — 主触点 L3（进线）
 *  main_t1   — 主触点 T1（出线）
 *  main_t2   — 主触点 T2（出线）
 *  main_t3   — 主触点 T3（出线）
 *  aux_no13  — 辅助常开 13
 *  aux_no14  — 辅助常开 14
 *  aux_nc21  — 辅助常闭 21
 *  aux_nc22  — 辅助常闭 22
 */
export class ACContactor extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(520, config.width  || 600);
        this.height = Math.max(400, config.height || 480);

        this.type    = 'ac_contactor';
        this.special = 'none';
        this.cache   = 'fixed';

        // ── 额定参数 ──
        this.ratedVoltageCoil = config.ratedVoltageCoil || 220;  // V（线圈额定电压）
        this.ratedVoltagePole = config.ratedVoltagePole || 380;  // V（主触点额定电压）
        this.ratedCurrent     = config.ratedCurrent     || 25;   // A（额定工作电流）
        this.frequency        = config.frequency        || 50;   // Hz
        this.polePairs        = config.polePairs        || 3;    // 主触点极数

        // 线圈等效参数
        this.coilR  = config.coilR  || 80;    // Ω（线圈电阻，AC 线圈较小）
        this.coilL  = config.coilL  || 2.5;   // H（线圈电感）
        this.coilZ  = Math.sqrt(this.coilR**2 + (2*Math.PI*this.frequency*this.coilL)**2);
        this.coilIm = this.ratedVoltageCoil / this.coilZ;  // 线圈额定电流 A

        // 分磁环参数
        this.shadeAngle  = config.shadeAngle || 68;   // 分磁环磁通相位差 °
        this.shadeArea   = config.shadeArea  || 0.35; // 分磁环覆盖面积比

        // 机械参数
        this.springForce   = config.springForce   || 12;   // N（弹簧反力）
        this.armatureTravel= config.armatureTravel|| 6;    // mm（衔铁行程）
        this.J             = config.J             || 0.0002;// kg·m²（等效转动惯量）
        this.closeTime     = config.closeTime     || 0.04; // s（合闸时间约 40ms）
        this.openTime      = config.openTime      || 0.02; // s（分闸时间约 20ms）
        this.arcTime       = config.arcTime       || 0.015;// s（电弧持续时间）

        // 寿命参数
        this.mechLife = config.mechLife || 10000000; // 机械寿命（次）
        this.elecLife = config.elecLife || 1000000;  // 电寿命（次）

        // ── 运行状态机 ──
        // phase: 'open' | 'closing' | 'closed' | 'opening'
        this._phase        = 'open';
        this._phaseTimer   = 0;
        this._coilEnergized= false;
        this._armaturePos  = 0;       // 0=完全释放，1=完全吸合（归一化）
        this._arcPhase     = 0;
        this._arcActive    = false;
        this._arcTimer     = 0;

        // 电气量
        this._wavePhase    = 0;       // 工频相位 rad
        this.coilVoltage   = 0;       // 线圈瞬时电压
        this.coilCurrent   = 0;       // 线圈瞬时电流 A
        this.fluxA         = 0;       // 非分磁环区磁通（标幺值）
        this.fluxB         = 0;       // 分磁环区磁通（标幺值，滞后）
        this.forceA        = 0;       // Φ_a² 产生的吸力分量（N）
        this.forceB        = 0;       // Φ_b² 产生的吸力分量（N）
        this.forceTotal    = 0;       // 合力（N）
        this.contactState  = 'open';  // 'open' | 'closed'

        // 统计
        this.opsCount      = config.initOps || 0;   // 已操作次数
        this.elecOps       = config.initElecOps || 0;

        // ── 波形缓冲区 ──
        this._wavLen    = 200;
        this._wavCoilU  = new Float32Array(this._wavLen).fill(0);
        this._wavCoilI  = new Float32Array(this._wavLen).fill(0);
        this._wavFluxA  = new Float32Array(this._wavLen).fill(0);
        this._wavFluxB  = new Float32Array(this._wavLen).fill(0);
        this._wavForce  = new Float32Array(this._wavLen).fill(0);
        this._wavAcc    = 0;

        // ── 几何布局 ──
        // 左：电磁铁截面（凸极 E-U 型）
        this._emX   = Math.round(this.width * 0.04);
        this._emY   = Math.round(this.height * 0.06);
        this._emW   = Math.round(this.width * 0.35);
        this._emH   = Math.round(this.height * 0.52);
        this._emCX  = this._emX + this._emW / 2;
        this._emCY  = this._emY + this._emH / 2;

        // 主触点（电磁铁右侧）
        this._ctX   = Math.round(this.width * 0.42);
        this._ctY   = Math.round(this.height * 0.06);
        this._ctW   = Math.round(this.width * 0.26);
        this._ctH   = Math.round(this.height * 0.46);

        // 辅助触点（主触点右侧）
        this._auxX  = Math.round(this.width * 0.70);
        this._auxY  = this._ctY;
        this._auxW  = Math.round(this.width * 0.27);
        this._auxH  = Math.round(this._ctH * 0.50);

        // 吸力曲线（辅助触点下方）
        this._fctX  = this._auxX;
        this._fctY  = this._auxY + this._auxH + 8;
        this._fctW  = this._auxW;
        this._fctH  = Math.round(this.height * 0.28);

        // LCD（左下）
        this._lcdX  = this._emX;
        this._lcdY  = this._emY + this._emH + 8;
        this._lcdW  = this._emW;
        this._lcdH  = Math.round(this.height * 0.24);

        // 控制面板（中下）
        this._panX  = this._ctX;
        this._panY  = this._ctY + this._ctH + 8;
        this._panW  = this._ctW + this._auxW + 8;
        this._panH  = Math.round(this.height * 0.16);

        // 波形（底部）
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
            shadeAngle: this.shadeAngle,
        };

        this._init();

        // 端口定义
        const emL = this._emX - 6;
        this.addPort(emL, this._emCY - 20, 'coil_a1', 'wire', 'A1');
        this.addPort(emL, this._emCY + 20, 'coil_a2', 'wire', 'A2');

        const ctTop = this._ctY - 8;
        const ctBot = this._ctY + this._ctH + 8;
        const step  = this._ctW / (this.polePairs + 1);
        for (let i = 1; i <= this.polePairs; i++) {
            const px = this._ctX + step * i;
            this.addPort(px, ctTop, `main_l${i}`, 'wire', `L${i}`);
            this.addPort(px, ctBot, `main_t${i}`, 'wire', `T${i}`);
        }

        const auxCX = this._auxX + this._auxW / 2;
        this.addPort(auxCX - 14, this._auxY - 8, 'aux_no13', 'wire', '13');
        this.addPort(auxCX + 14, this._auxY - 8, 'aux_no14', 'wire', '14');
        this.addPort(auxCX - 14, this._auxY + this._auxH + 8, 'aux_nc21', 'wire', '21');
        this.addPort(auxCX + 14, this._auxY + this._auxH + 8, 'aux_nc22', 'wire', '22');
    }

    // ═══════════════════════════════════════════
    _init() {
        this._drawLabel();
        this._drawElectromagnet();
        this._drawCoilWinding();
        this._drawShadeRings();
        this._drawFluxLayer();
        this._drawArmatureLayer();
        this._drawMainContacts();
        this._drawArcLayer();
        this._drawAuxContacts();
        this._drawForceGraph();
        this._drawLCDPanel();
        this._drawControlPanel();
        this._drawWaveform();
        this._startAnimation();
    }

    _drawLabel() {
        this.group.add(new Konva.Text({
            x: 0, y: -22, width: this.width,
            text: `交流接触器  线圈 ${this.ratedVoltageCoil}V AC  主触点 ${this.ratedVoltagePole}V / ${this.ratedCurrent}A  ${this.polePairs}P+辅  分磁环消振`,
            fontSize: 11, fontStyle: 'bold', fill: '#1a2634', align: 'center',
        }));
    }

    // ── 电磁铁静铁芯（E形）──────────────────
    _drawElectromagnet() {
        const { _emX: ex, _emY: ey, _emW: ew, _emH: eh, _emCX: ecx, _emCY: ecy } = this;

        // 外壳背板
        this.group.add(new Konva.Rect({
            x: ex, y: ey, width: ew, height: eh,
            fill: '#1c2b38', stroke: '#263238', strokeWidth: 2, cornerRadius: 5,
        }));
        this.group.add(new Konva.Text({
            x: ex, y: ey - 14, width: ew,
            text: '电磁系统截面图（E-U型铁芯）', fontSize: 9, fontStyle: 'bold',
            fill: '#546e7a', align: 'center',
        }));

        // ── E形静铁芯 ──
        const coreCol = '#546e7a', coreEdge = '#37474f';
        const yoke    = Math.round(eh * 0.12);   // 轭铁厚度
        const limb    = Math.round(eh * 0.10);   // 极柱宽
        const limbH   = Math.round(eh * 0.35);   // 极柱高
        const coreX   = ex + Math.round(ew * 0.14);
        const coreW   = Math.round(ew * 0.72);

        // 底部轭铁
        this.group.add(new Konva.Rect({
            x: coreX, y: ey + eh - Math.round(eh * 0.14) - yoke,
            width: coreW, height: yoke,
            fill: coreCol, stroke: coreEdge, strokeWidth: 1.5,
        }));
        // 叠片纹
        for (let i = 2; i < yoke; i += 3) {
            this.group.add(new Konva.Line({
                points: [coreX+2, ey+eh-Math.round(eh*0.14)-yoke+i, coreX+coreW-2, ey+eh-Math.round(eh*0.14)-yoke+i],
                stroke: 'rgba(0,0,0,0.12)', strokeWidth: 0.6,
            }));
        }

        // 三个极柱（左/中/右）
        const limbY = ey + eh - Math.round(eh * 0.14) - yoke - limbH;
        const limbPositions = [coreX, coreX+(coreW-limb)/2, coreX+coreW-limb];
        limbPositions.forEach(lx => {
            this.group.add(new Konva.Rect({
                x: lx, y: limbY, width: limb, height: limbH,
                fill: '#607d8b', stroke: coreEdge, strokeWidth: 1.5,
            }));
            for (let i = 2; i < limbH; i += 3) {
                this.group.add(new Konva.Line({
                    points: [lx+1, limbY+i, lx+limb-1, limbY+i],
                    stroke: 'rgba(0,0,0,0.12)', strokeWidth: 0.6,
                }));
            }
        });

        // 气隙区域（静铁芯上方）
        const gapTop    = limbY - Math.round(eh * 0.06);
        const gapBot    = limbY;
        const gapH      = gapBot - gapTop;
        this.group.add(new Konva.Rect({
            x: coreX, y: gapTop, width: coreW, height: gapH,
            fill: '#08111a',
        }));

        // 标注
        this.group.add(new Konva.Text({ x: coreX, y: limbY + limbH * 0.4, width: coreW, text: '静铁芯（E形）', fontSize: 8, fill: '#78909c', align: 'center' }));
        this.group.add(new Konva.Text({ x: coreX, y: gapTop + 1, width: coreW, text: '─── 气隙 δ ───', fontSize: 7, fill: '#37474f', align: 'center' }));
        this.group.add(new Konva.Text({ x: ex + 4, y: limbY + yoke/2 - 6, text: 'E', fontSize: 11, fontStyle: 'bold', fill: '#ef9a9a' }));

        // 保存几何关键 Y 坐标
        this._coreX   = coreX;
        this._coreW   = coreW;
        this._coreY   = limbY;         // 静铁芯顶面（气隙下边界）
        this._gapTop  = gapTop;        // 气隙上边界（动铁芯下面）
        this._gapH    = gapH;
        this._limbY   = limbY;
        this._limbH   = limbH;
        this._yoke    = yoke;
        this._limb    = limb;
        this._limbPositions = limbPositions;
        this._coreBottom = ey + eh - Math.round(eh * 0.14);
    }

    // ── 线圈绕组（绕在中间极柱上）──────────
    _drawCoilWinding() {
        const { _emX: ex, _emY: ey, _emW: ew, _limb: limb, _limbY: limbY, _limbH: limbH, _emCX: ecx } = this;
        const midLimbX = this._limbPositions[1];
        const coilY1   = limbY + Math.round(limbH * 0.10);
        const coilY2   = limbY + Math.round(limbH * 0.88);
        const coilH    = coilY2 - coilY1;
        const coilX1   = midLimbX - 18;
        const coilX2   = midLimbX + limb + 18;

        const turnN = 12;
        const turnH = coilH / turnN;
        const coilColors = ['#ff8f00', '#ffa726', '#ffb74d'];

        this._coilGroup = new Konva.Group();
        for (let i = 0; i < turnN; i++) {
            const ty  = coilY1 + i * turnH;
            const col = coilColors[i % 3];
            this._coilGroup.add(new Konva.Line({
                points: [coilX1, ty, coilX2, ty, coilX2, ty + turnH*0.85, coilX1, ty + turnH*0.85, coilX1, ty + turnH],
                stroke: col, strokeWidth: 2, lineCap: 'round', lineJoin: 'round', opacity: 0.8,
            }));
        }

        // 线圈接线端（A1/A2）
        const termX = ex + 10;
        this.group.add(new Konva.Line({ points: [coilX1, coilY1+4, termX, coilY1+4, termX, this._emCY - 20], stroke: '#ff8f00', strokeWidth: 2, lineCap: 'round' }));
        this.group.add(new Konva.Line({ points: [coilX1, coilY2-4, termX, coilY2-4, termX, this._emCY + 20], stroke: '#ff8f00', strokeWidth: 2, lineCap: 'round' }));
        this.group.add(new Konva.Circle({ x: termX, y: this._emCY - 20, radius: 3, fill: '#37474f', stroke: '#546e7a', strokeWidth: 0.5 }));
        this.group.add(new Konva.Circle({ x: termX, y: this._emCY + 20, radius: 3, fill: '#37474f', stroke: '#546e7a', strokeWidth: 0.5 }));
        this.group.add(new Konva.Text({ x: termX - 14, y: this._emCY - 26, text: 'A1', fontSize: 8, fill: '#ff8f00' }));
        this.group.add(new Konva.Text({ x: termX - 14, y: this._emCY + 22, text: 'A2', fontSize: 8, fill: '#ff8f00' }));

        // 线圈发光背景（随电流动态）
        this._coilGlow = new Konva.Rect({
            x: coilX1 - 4, y: coilY1 - 3,
            width: coilX2 - coilX1 + 8, height: coilH + 6,
            fill: 'rgba(255,143,0,0)', cornerRadius: 3,
        });
        this.group.add(new Konva.Text({ x: coilX2 + 3, y: coilY1 + coilH/2 - 14, text: '主线圈\nN匝', fontSize: 8, fill: '#ff8f00', lineHeight: 1.4 }));

        this._coilY1 = coilY1; this._coilY2 = coilY2;
        this._coilX1 = coilX1; this._coilX2 = coilX2;
        this.group.add(this._coilGlow, this._coilGroup);
    }

    // ── 分磁环（短路铜环，嵌于静铁芯端面）──
    _drawShadeRings() {
        const { _coreX: cx, _coreW: cw, _limb: limb, _gapTop: gapTop, _gapH: gapH, _limbPositions: lps } = this;

        // 左极柱和右极柱各嵌一个分磁环（中间极柱不嵌，实物也常如此）
        [lps[0], lps[2]].forEach(lx => {
            const slotX  = lx + Math.round(limb * 0.28);
            const slotW  = Math.round(limb * 0.44);
            const slotY  = gapTop;
            const slotH  = Math.round(gapH * 0.85);

            // 铜环本体
            this.group.add(new Konva.Rect({
                x: slotX, y: slotY + 1, width: slotW, height: slotH - 2,
                fill: '#c87832', stroke: '#a06020', strokeWidth: 0.8, cornerRadius: 1,
            }));
            // 铜环中空（示意环状）
            this.group.add(new Konva.Rect({
                x: slotX + 2, y: slotY + 3, width: slotW - 4, height: slotH - 8,
                fill: '#0d1520',
            }));
        });

        // 分磁环标注
        this.group.add(new Konva.Text({
            x: cx, y: gapTop - 12, width: cw,
            text: '← 分磁环（铜短路环）→', fontSize: 7.5, fill: '#c87832', align: 'center',
        }));

        // 磁通分区标注
        this.group.add(new Konva.Text({ x: lps[0] + 1, y: gapTop + 2, width: limb - 2, text: 'Φb', fontSize: 7, fill: '#ef9a9a', align: 'center' }));
        this.group.add(new Konva.Text({ x: lps[2] + 1, y: gapTop + 2, width: limb - 2, text: 'Φb', fontSize: 7, fill: '#ef9a9a', align: 'center' }));
        this.group.add(new Konva.Text({ x: lps[1] + 1, y: gapTop + 2, width: limb - 2, text: 'Φa', fontSize: 7, fill: '#ffd54f', align: 'center' }));
    }

    // ── 动态磁通流动层 ──────────────────────
    _drawFluxLayer() {
        this._fluxGroup = new Konva.Group();
        this.group.add(this._fluxGroup);
    }

    // ── 动铁芯（U形衔铁，随状态移动）────────
    _drawArmatureLayer() {
        const { _emX: ex, _emY: ey, _emW: ew, _emH: eh, _coreX: cx, _coreW: cw, _limb: limb,
                _gapTop: gapTop, _gapH: gapH, _limbPositions: lps } = this;

        // 动铁芯基础 Y 位置（完全释放时在 gapTop 上方，gapH 处）
        this._armatureHomeY = ey + Math.round(eh * 0.04);  // 释放位置（顶部）
        this._armatureSealY = gapTop - Math.round(eh * 0.09); // 吸合位置（贴近气隙）

        this._armatureGroup = new Konva.Group({ y: 0 });

        // U形动铁芯：顶部轭铁 + 两侧极柱（向下突出）
        const aYokeH = Math.round(eh * 0.08);
        const aLimbH = Math.round(eh * 0.14);

        // 顶部轭铁
        this._armatureGroup.add(new Konva.Rect({
            x: cx, y: this._armatureHomeY, width: cw, height: aYokeH,
            fill: '#546e7a', stroke: '#37474f', strokeWidth: 1.5,
        }));
        for (let i = 2; i < aYokeH; i += 3) {
            this._armatureGroup.add(new Konva.Line({
                points: [cx+2, this._armatureHomeY+i, cx+cw-2, this._armatureHomeY+i],
                stroke: 'rgba(0,0,0,0.12)', strokeWidth: 0.6,
            }));
        }

        // U形两侧极柱（对应静铁芯左右极柱）
        [lps[0], lps[2]].forEach(lx => {
            this._armatureGroup.add(new Konva.Rect({
                x: lx, y: this._armatureHomeY + aYokeH, width: limb, height: aLimbH,
                fill: '#607d8b', stroke: '#37474f', strokeWidth: 1.5,
            }));
            for (let i = 2; i < aLimbH; i += 3) {
                this._armatureGroup.add(new Konva.Line({
                    points: [lx+1, this._armatureHomeY+aYokeH+i, lx+limb-1, this._armatureHomeY+aYokeH+i],
                    stroke: 'rgba(0,0,0,0.12)', strokeWidth: 0.6,
                }));
            }
        });
        // 极面标注
        this._armatureGroup.add(new Konva.Text({
            x: cx, y: this._armatureHomeY + aYokeH * 0.3, width: cw,
            text: '动铁芯（U形衔铁）', fontSize: 8, fill: '#78909c', align: 'center',
        }));

        this._aYokeH = aYokeH;
        this._aLimbH = aLimbH;
        this._armatureTravelPx = this._armatureSealY - this._armatureHomeY; // 负值（向下为正）

        this.group.add(this._armatureGroup);
    }

    // ── 主触点（3P）─────────────────────────
    _drawMainContacts() {
        const { _ctX: cx, _ctY: cy, _ctW: cw, _ctH: ch } = this;

        // 背板
        this.group.add(new Konva.Rect({ x: cx, y: cy, width: cw, height: ch, fill: '#0d1520', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 4 }));
        this.group.add(new Konva.Rect({ x: cx, y: cy, width: cw, height: 13, fill: '#0a1a28', cornerRadius: [4,4,0,0] }));
        this.group.add(new Konva.Text({ x: cx+4, y: cy+2, width: cw-8, text: `主触点（${this.polePairs}P  ${this.ratedCurrent}A）`, fontSize: 8, fontStyle: 'bold', fill: '#80cbc4', align: 'center' }));

        const step   = cw / (this.polePairs + 1);
        const busCol = '#78909c', busEdge = '#455a64';
        const fixH   = 10, bridgeH = 8;

        // 上母排（进线 L1/L2/L3）
        this.group.add(new Konva.Rect({ x: cx+4, y: cy+16, width: cw-8, height: 7, fill: busCol, stroke: busEdge, strokeWidth: 1 }));

        // 下母排（出线 T1/T2/T3）
        this.group.add(new Konva.Rect({ x: cx+4, y: cy+ch-16, width: cw-8, height: 7, fill: busCol, stroke: busEdge, strokeWidth: 1 }));

        this._mainBridgeGroups = [];
        this._mainArcGroups    = [];
        this._contactSpring    = [];

        for (let i = 1; i <= this.polePairs; i++) {
            const px = cx + step * i;

            // 上固定触点
            this.group.add(new Konva.Rect({ x: px-10, y: cy+23, width: 20, height: fixH, fill: '#90a4ae', stroke: '#546e7a', strokeWidth: 0.8, cornerRadius: 2 }));
            // 下固定触点
            this.group.add(new Konva.Rect({ x: px-10, y: cy+ch-26, width: 20, height: fixH, fill: '#90a4ae', stroke: '#546e7a', strokeWidth: 0.8, cornerRadius: 2 }));

            // 触点导线（进/出）
            this.group.add(new Konva.Line({ points: [px, cy+16, px, cy+23], stroke: '#78909c', strokeWidth: 4 }));
            this.group.add(new Konva.Line({ points: [px, cy+ch-16, px, cy+ch-26], stroke: '#78909c', strokeWidth: 4 }));

            // 可动触桥（含弹簧）
            const bridgeGroup = new Konva.Group();
            const bridgeMidY  = (cy+33+cy+ch-26-bridgeH) / 2;

            bridgeGroup.add(new Konva.Rect({ x: px-12, y: 0, width: 24, height: bridgeH, fill: '#b0bec5', stroke: '#546e7a', strokeWidth: 0.8, cornerRadius: 2 }));
            // 触头
            bridgeGroup.add(new Konva.Circle({ x: px-6, y: bridgeH/2, radius: 3.5, fill: '#e0e0e0', stroke: '#9e9e9e', strokeWidth: 0.5 }));
            bridgeGroup.add(new Konva.Circle({ x: px+6, y: bridgeH/2, radius: 3.5, fill: '#e0e0e0', stroke: '#9e9e9e', strokeWidth: 0.5 }));

            // 弹簧（连接触桥与衔铁推杆）
            const spring = new Konva.Line({ points: [], stroke: '#546e7a', strokeWidth: 1, lineCap: 'round' });
            bridgeGroup.add(spring);
            this._contactSpring.push(spring);

            bridgeGroup.y(bridgeMidY - cy);
            this._mainBridgeGroups.push({ group: bridgeGroup, midY: bridgeMidY, step: step * i });
            this.group.add(bridgeGroup);

            // 极标注
            this.group.add(new Konva.Text({ x: px-6, y: cy+14, text: `L${i}`, fontSize: 7, fill: '#4fc3f7' }));
            this.group.add(new Konva.Text({ x: px-6, y: cy+ch-12, text: `T${i}`, fontSize: 7, fill: '#4fc3f7' }));
        }

        // 行程指示条
        this.group.add(new Konva.Text({ x: cx+2, y: cy+ch-50, text: '行程:', fontSize: 7, fill: '#37474f' }));
        this.group.add(new Konva.Rect({ x: cx+28, y: cy+ch-50, width: cw-36, height: 7, fill: '#0a0a18', cornerRadius: 2 }));
        this._travelBar = new Konva.Rect({ x: cx+28, y: cy+ch-50, width: 0, height: 7, fill: '#66bb6a', cornerRadius: 2 });
        this._travelBarW = cw - 36;
        this.group.add(this._travelBar);

        // 灭弧罩（示意框）
        this.group.add(new Konva.Rect({ x: cx+4, y: cy+36, width: cw-8, height: ch-72, fill: 'rgba(0,0,0,0)', stroke: '#263238', strokeWidth: 0.8, dash: [4,3] }));
        this.group.add(new Konva.Text({ x: cx+4, y: cy+36, text: '灭弧罩', fontSize: 7, fill: '#263238' }));

        this._ctCX = cx + cw / 2;
        this._mainBridgeOpenY  = cy + 33;
        this._mainBridgeCloseYTop = cy + 33;
        this._mainBridgeCloseYBot = cy + ch - 26 - bridgeH;
    }

    // ── 电弧动画层 ───────────────────────────
    _drawArcLayer() {
        this._arcGroup = new Konva.Group({ opacity: 0 });
        this.group.add(this._arcGroup);
    }

    // ── 辅助触点（NO + NC）──────────────────
    _drawAuxContacts() {
        const { _auxX: ax, _auxY: ay, _auxW: aw, _auxH: ah } = this;

        const drawAux = (label, termTop, termBot, isNO, yOffset) => {
            const ty = ay + yOffset;
            const hw = aw * 0.42;
            const hcx = ax + aw / 2;

            this.group.add(new Konva.Rect({ x: ax, y: ty, width: aw, height: ah/2, fill: '#0d1520', stroke: '#1a3040', strokeWidth: 1, cornerRadius: 3 }));
            this.group.add(new Konva.Text({ x: ax+2, y: ty+2, width: aw-4, text: label, fontSize: 7.5, fontStyle: 'bold', fill: '#80cbc4', align: 'center' }));

            // 上固定触点
            this.group.add(new Konva.Rect({ x: hcx-hw/2, y: ty+13, width: hw, height: 6, fill: '#78909c', stroke: '#455a64', strokeWidth: 0.6, cornerRadius: 1 }));
            // 下固定触点
            this.group.add(new Konva.Rect({ x: hcx-hw/2, y: ty+ah/2-10, width: hw, height: 6, fill: '#78909c', stroke: '#455a64', strokeWidth: 0.6, cornerRadius: 1 }));
            // 端子标注
            this.group.add(new Konva.Text({ x: hcx-hw/2-2, y: ty+10, text: termTop, fontSize: 7, fill: '#4fc3f7' }));
            this.group.add(new Konva.Text({ x: hcx-hw/2-2, y: ty+ah/2-10, text: termBot, fontSize: 7, fill: '#4fc3f7' }));

            // 可动触桥
            const bridge = new Konva.Rect({
                x: hcx-hw/2+2, y: isNO ? ty+26 : ty+19,
                width: hw-4, height: 5, fill: '#b0bec5', stroke: '#546e7a', strokeWidth: 0.6, cornerRadius: 1,
            });

            // 状态灯
            const statusDot = new Konva.Circle({ x: ax+aw-8, y: ty+6, radius: 4, fill: '#263238', stroke: '#1a252f', strokeWidth: 0.5 });

            this.group.add(bridge, statusDot);
            return { bridge, statusDot, isNO,
                     openY: isNO ? ty+26 : ty+19,
                     closeY: isNO ? ty+19 : ty+26 };
        };

        this._auxNO = drawAux('辅助常开 NO  13-14', '13', '14', true,  0);
        this._auxNC = drawAux('辅助常闭 NC  21-22', '21', '22', false, ah/2 + 4);
    }

    // ── 吸力-时间特性曲线 ──────────────────
    _drawForceGraph() {
        const { _fctX: fx, _fctY: fy, _fctW: fw, _fctH: fh } = this;

        this.group.add(new Konva.Rect({ x: fx, y: fy, width: fw, height: fh, fill: '#010d18', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 4 }));
        this.group.add(new Konva.Rect({ x: fx, y: fy, width: fw, height: 13, fill: '#0a1a28', cornerRadius: [4,4,0,0] }));
        this.group.add(new Konva.Text({ x: fx+4, y: fy+2, width: fw-8, text: 'F_em 吸力波形（分磁环消振）', fontSize: 8, fontStyle: 'bold', fill: '#80cbc4', align: 'center' }));

        const ox = fx+12, oy = fy+fh-10, aw = fw-18, ah = fh-24;
        this.group.add(new Konva.Line({ points: [ox, oy-ah, ox, oy, ox+aw, oy], stroke: '#37474f', strokeWidth: 0.8 }));
        this.group.add(new Konva.Text({ x: ox-10, y: oy-ah, text: 'F', fontSize: 7, fill: '#80cbc4' }));
        this.group.add(new Konva.Text({ x: ox+aw+2, y: oy+2, text: 't', fontSize: 7, fill: '#80cbc4' }));

        // 弹簧反力水平线
        const springY = oy - ah * (this.springForce / (this.springForce * 2.5));
        this.group.add(new Konva.Line({ points: [ox, springY, ox+aw, springY], stroke: '#ef5350', strokeWidth: 0.8, dash: [4,3] }));
        this.group.add(new Konva.Text({ x: ox+2, y: springY-9, text: 'F_spring', fontSize: 6.5, fill: '#ef5350' }));

        // 预绘无分磁环吸力曲线（脉动，用于对比）
        const ptsNoShade = [], ptsWithShade = [];
        const nPts = 100;
        for (let i = 0; i <= nPts; i++) {
            const t   = i/nPts * 2 * Math.PI * 2; // 两个周期
            const x   = ox + (i/nPts) * aw;
            const fa  = 1 - Math.cos(2*t);         // F_a ∝ Φ_a²
            const dlt = this.shadeAngle * Math.PI / 180;
            const fb  = (1 - Math.cos(2*(t - dlt))) * this.shadeArea; // F_b
            const fNo = fa * (1 - this.shadeArea);
            const fW  = fNo + fb;
            ptsNoShade.push(x, oy - (fNo/2)*ah*0.38);
            ptsWithShade.push(x, oy - (fW/2)*ah*0.38);
        }
        this.group.add(new Konva.Line({ points: ptsNoShade,    stroke: '#ef5350', strokeWidth: 1.2, lineJoin: 'round', opacity: 0.45, dash: [3,3] }));
        this.group.add(new Konva.Line({ points: ptsWithShade,  stroke: '#66bb6a', strokeWidth: 1.5, lineJoin: 'round', opacity: 0.55 }));

        // 图例
        this.group.add(new Konva.Line({ points: [ox+aw*0.55, oy-ah+8,  ox+aw*0.72, oy-ah+8],  stroke: '#66bb6a', strokeWidth: 1.5 }));
        this.group.add(new Konva.Text({ x: ox+aw*0.73, y: oy-ah+4, text: '有分磁环', fontSize: 6.5, fill: '#66bb6a' }));
        this.group.add(new Konva.Line({ points: [ox+aw*0.55, oy-ah+18, ox+aw*0.72, oy-ah+18], stroke: '#ef5350', strokeWidth: 1.2, dash: [3,3] }));
        this.group.add(new Konva.Text({ x: ox+aw*0.73, y: oy-ah+14, text: '无分磁环', fontSize: 6.5, fill: '#ef5350' }));

        // 动态工作点
        this._forcePoint = new Konva.Circle({ x: ox, y: oy, radius: 4, fill: '#ffd54f', stroke: '#f9a825', strokeWidth: 1.5 });
        this.group.add(this._forcePoint);
        this._fgOX = ox; this._fgOY = oy; this._fgAW = aw; this._fgAH = ah;
    }

    // ── LCD 仪表 ─────────────────────────────
    _drawLCDPanel() {
        const { _lcdX: lx, _lcdY: ly, _lcdW: lw, _lcdH: lh } = this;

        this.group.add(new Konva.Rect({ x: lx, y: ly, width: lw, height: lh, fill: '#020c14', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 4 }));
        this.group.add(new Konva.Rect({ x: lx, y: ly, width: lw, height: 13, fill: '#0a1a28', cornerRadius: [4,4,0,0] }));
        this.group.add(new Konva.Text({ x: lx+4, y: ly+2, width: lw-8, text: '运行仪表', fontSize: 8, fontStyle: 'bold', fill: '#80cbc4', align: 'center' }));

        const cells = [
            { label: 'Uc',    id: 'uc',    unit: 'V',  color: '#ff8f00' },
            { label: 'Ic',    id: 'ic',    unit: 'A',  color: '#ffd54f' },
            { label: 'F_em',  id: 'fem',   unit: 'N',  color: '#66bb6a' },
            { label: '状态',  id: 'state', unit: '',   color: '#4fc3f7' },
            { label: '动作次数', id: 'ops', unit: '次', color: '#ef9a9a' },
            { label: '电寿命', id: 'life',  unit: '%',  color: '#80cbc4' },
        ];

        const cellW = (lw - 8) / 3, cellH = 22, gap = 2;
        this._lcdCells = {};
        cells.forEach(({ label, id, unit, color }, i) => {
            const col = i % 3, row = Math.floor(i / 3);
            const cx3 = lx + 4 + col * (cellW + gap);
            const cy3 = ly + 16 + row * (cellH + gap);
            this.group.add(new Konva.Rect({ x: cx3, y: cy3, width: cellW, height: cellH, fill: '#0d1520', cornerRadius: 2 }));
            this.group.add(new Konva.Text({ x: cx3+2, y: cy3+2, text: label, fontSize: 7, fill: '#37474f' }));
            const val = new Konva.Text({ x: cx3+2, y: cy3+9, width: cellW-4, text: '--', fontSize: 9, fontFamily: 'Courier New, monospace', fontStyle: 'bold', fill: color, align: 'right' });
            this.group.add(new Konva.Text({ x: cx3+2, y: cy3+14, width: cellW-4, text: unit, fontSize: 7, fill: '#1a252f', align: 'right' }));
            this._lcdCells[id] = val;
            this.group.add(val);
        });

        // 吸合/释放状态大指示
        const indY = ly + 16 + 22*2 + gap*2 + 6;
        const indH = lh - (indY - ly) - 6;
        if (indH > 18) {
            this._stateIndicator = new Konva.Rect({ x: lx+4, y: indY, width: lw-8, height: indH, fill: '#0d1520', cornerRadius: 3 });
            this._stateText = new Konva.Text({ x: lx+4, y: indY + indH*0.25, width: lw-8, text: '◉  断  开', fontSize: 12, fontStyle: 'bold', fill: '#ef5350', align: 'center' });
            this.group.add(this._stateIndicator, this._stateText);
        }
    }

    // ── 控制面板 ─────────────────────────────
    _drawControlPanel() {
        const { _panX: px, _panY: py, _panW: pw, _panH: ph } = this;

        this.group.add(new Konva.Rect({ x: px, y: py, width: pw, height: ph, fill: '#0d1520', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 4 }));
        this.group.add(new Konva.Rect({ x: px, y: py, width: pw, height: 13, fill: '#0a1a28', cornerRadius: [4,4,0,0] }));
        this.group.add(new Konva.Text({ x: px+4, y: py+2, width: pw-8, text: '控制操作', fontSize: 8, fontStyle: 'bold', fill: '#80cbc4', align: 'center' }));

        const bW = (pw - 16) / 2, bH = 20, bY = py + 16;

        [[px+4,       '⬛ 合  闸', '#1a3a1a', '#2e7d32', '#66bb6a', () => this.close()],
         [px+8+bW,    '⬜ 分  闸', '#3a1a1a', '#c62828', '#ef5350', () => this.open()]].forEach(([bx, lbl, fill, stroke, col, cb]) => {
            const btn = new Konva.Rect({ x: bx, y: bY, width: bW, height: bH, fill, stroke, strokeWidth: 1.5, cornerRadius: 3 });
            const t   = new Konva.Text({ x: bx, y: bY + 5, width: bW, text: lbl, fontSize: 10, fontStyle: 'bold', fill: col, align: 'center' });
            btn.on('click tap', cb);
            btn.on('mouseenter', () => btn.opacity(0.75));
            btn.on('mouseleave', () => btn.opacity(1));
            this.group.add(btn, t);
        });

        // 线圈电压调节
        const slY = py + 44;
        this.group.add(new Konva.Text({ x: px+4, y: slY-11, text: `线圈电压 Uc (额定 ${this.ratedVoltageCoil}V):`, fontSize: 8, fill: '#546e7a' }));
        this.group.add(new Konva.Rect({ x: px+4, y: slY, width: pw-32, height: 9, fill: '#0a0a18', cornerRadius: 2 }));
        this._voltBar    = new Konva.Rect({ x: px+4, y: slY, width: 0, height: 9, fill: '#ffa726', cornerRadius: 2 });
        this._voltValTxt = new Konva.Text({ x: px+pw-28, y: slY-2, width: 28, text: '0V', fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#ffa726' });
        this._voltBarW   = pw - 32;
        this._voltBarX   = px + 4;
        this._coilVoltSet= this.ratedVoltageCoil;

        const hitVolt = new Konva.Rect({ x: px+4, y: slY-2, width: pw-32, height: 14, fill: 'transparent', listening: true });
        hitVolt.on('click tap mousedown touchstart', e => {
            const stage = this.group.getStage?.();
            const pos   = stage?.getPointerPosition?.() ?? { x: e.evt?.clientX ?? 0 };
            const ratio = Math.max(0, Math.min(1, (pos.x - (this.group.x?.() ?? 0) - (px+4)) / (pw-32)));
            this._coilVoltSet = ratio * this.ratedVoltageCoil * 1.2;
        });
        this.group.add(this._voltBar, this._voltValTxt, hitVolt);
    }

    // ── 波形区 ───────────────────────────────
    _drawWaveform() {
        const { _wavX: wx, _wavY: wy, _wavW: ww, _wavH: wh } = this;
        if (wh < 14) return;

        this.group.add(new Konva.Rect({ x: wx, y: wy, width: ww, height: wh, fill: '#010d18', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 4 }));
        this.group.add(new Konva.Rect({ x: wx, y: wy, width: ww, height: 12, fill: '#0a1a28', cornerRadius: [4,4,0,0] }));
        this.group.add(new Konva.Text({ x: wx+4, y: wy+1, width: ww-8, text: 'Uc 线圈电压   Ic 线圈电流   Φa/Φb 磁通   F_em 吸力', fontSize: 8, fill: '#80cbc4', align: 'center' }));

        const h4 = (wh - 12) / 4;
        this._wavMids = [wy+12+h4*0.5, wy+12+h4*1.5, wy+12+h4*2.5, wy+12+h4*3.5];
        this._wavMids.forEach(my => this.group.add(new Konva.Line({ points: [wx+2, my, wx+ww-2, my], stroke: 'rgba(200,200,200,0.06)', strokeWidth: 0.5, dash: [4,3] })));

        this._wLineU   = new Konva.Line({ points: [], stroke: '#ff8f00', strokeWidth: 1.5, lineJoin: 'round' });
        this._wLineI   = new Konva.Line({ points: [], stroke: '#ffd54f', strokeWidth: 1.5, lineJoin: 'round' });
        this._wLineFlux= new Konva.Line({ points: [], stroke: '#ef9a9a', strokeWidth: 1.5, lineJoin: 'round' });
        this._wLineF   = new Konva.Line({ points: [], stroke: '#66bb6a', strokeWidth: 1.5, lineJoin: 'round' });

        ['Uc', 'Ic', 'Φb', 'F'].forEach((l, i) => {
            this.group.add(new Konva.Text({ x: wx+4, y: wy+12+h4*i+3, text: l, fontSize: 8, fill: ['#ff8f00','#ffd54f','#ef9a9a','#66bb6a'][i] }));
        });

        this.group.add(this._wLineU, this._wLineI, this._wLineFlux, this._wLineF);
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
                this._tickForcePoint();
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
                this._armaturePos = Math.min(1, this._phaseTimer / this.closeTime);
                if (this._armaturePos >= 1) {
                    this._phase       = 'closed';
                    this.contactState = 'closed';
                    this._triggerArc('close');
                    this.opsCount++;
                    this.elecOps++;
                }
                break;
            case 'opening':
                this._phaseTimer += dt;
                this._armaturePos = Math.max(0, 1 - this._phaseTimer / this.openTime);
                if (this._armaturePos <= 0) {
                    this._phase       = 'open';
                    this.contactState = 'open';
                    this._triggerArc('open');
                    this.opsCount++;
                    this.elecOps++;
                }
                break;
        }
    }

    // ── 物理计算 ─────────────────────────────
    _tickPhysics(dt) {
        const omega_e = 2 * Math.PI * this.frequency;
        this._wavePhase += omega_e * dt;

        // 线圈电压（通电时取设定值，断电时衰减）
        if (this._coilEnergized) {
            this.coilVoltage = this._coilVoltSet * Math.sin(this._wavePhase);
        } else {
            this.coilVoltage *= Math.exp(-dt * 20);
        }

        // 线圈电流（一阶 RL 响应）
        const phi_ZL = Math.atan(2*Math.PI*this.frequency*this.coilL / this.coilR);
        this.coilCurrent = (this._coilEnergized ? this._coilVoltSet : 0) / this.coilZ * Math.sin(this._wavePhase - phi_ZL);
        if (!this._coilEnergized) this.coilCurrent *= Math.exp(-dt * (this.coilR / this.coilL));

        // 磁通（与电流成正比，有相位差）
        this.fluxA = Math.sin(this._wavePhase - phi_ZL);
        const dlt  = this.shadeAngle * Math.PI / 180;
        this.fluxB = Math.sin(this._wavePhase - phi_ZL - dlt);

        // 吸力（F ∝ Φ²，两区叠加）
        const kA = 1 - this.shadeArea;
        const kB = this.shadeArea;
        this.forceA = kA * this.fluxA * this.fluxA;
        this.forceB = kB * this.fluxB * this.fluxB;
        this.forceTotal = (this.forceA + this.forceB) * this.springForce * 2.2;

        // 缓冲波形数据
        this._wavCoilU = new Float32Array([...this._wavCoilU.slice(1), this.coilVoltage]);
        this._wavCoilI = new Float32Array([...this._wavCoilI.slice(1), this.coilCurrent * 10]);
        this._wavFluxB = new Float32Array([...this._wavFluxB.slice(1), this.fluxB]);
        this._wavForce = new Float32Array([...this._wavForce.slice(1), this.forceTotal]);
    }

    // ── 磁通动画 ─────────────────────────────
    _tickFluxViz(dt) {
        this._fluxGroup.destroyChildren();
        if (!this._coilEnergized && Math.abs(this.coilCurrent) < 0.005) return;

        const { _coreX: cx, _coreW: cw, _limbPositions: lps, _limb: limb, _limbY: limbY, _limbH: limbH } = this;
        const alpha = Math.min(0.7, Math.abs(this.fluxA) * 0.7);

        // 中间极柱（Φa）磁通粒子（黄色，无相位差）
        const nA = 5;
        for (let i = 0; i < nA; i++) {
            const t   = ((this._wavePhase * 0.04 + i/nA) % 1 + 1) % 1;
            const py2 = this._coreY - limbH*0.6 + t * limbH*1.2;
            this._fluxGroup.add(new Konva.Circle({ x: lps[1] + limb/2, y: py2, radius: 2.5, fill: `rgba(255,213,79,${alpha})` }));
        }
        // 左右极柱（Φb）磁通粒子（红，相位滞后）
        const alphaB = Math.min(0.5, Math.abs(this.fluxB) * 0.6);
        [lps[0], lps[2]].forEach(lx => {
            const nB = 3;
            for (let i = 0; i < nB; i++) {
                const dlt = this.shadeAngle / (2 * Math.PI * 360);
                const t   = ((this._wavePhase * 0.04 + dlt + i/nB) % 1 + 1) % 1;
                const py2 = this._coreY - limbH*0.6 + t * limbH*1.2;
                this._fluxGroup.add(new Konva.Circle({ x: lx + limb/2, y: py2, radius: 2, fill: `rgba(239,154,154,${alphaB})` }));
            }
        });

        // 线圈磁化发光
        const glow = Math.abs(this.coilCurrent) / this.coilIm;
        if (this._coilGlow) this._coilGlow.fill(`rgba(255,143,0,${Math.min(0.3, glow * 0.3)})`);
        if (this._coilGroup) this._coilGroup.opacity(0.4 + glow * 0.6);
    }

    // ── 衔铁位置动画 ─────────────────────────
    _tickArmatureViz() {
        if (!this._armatureGroup) return;
        const dy = this._armaturePos * (this._armatureSealY - this._armatureHomeY);
        this._armatureGroup.y(dy);

        // 行程指示条
        if (this._travelBar) this._travelBar.width(this._armaturePos * this._travelBarW);
    }

    // ── 主触点 + 辅助触点可视化 ─────────────
    _tickContactsViz() {
        const pos = this._armaturePos;

        // 主触桥：线性插值
        this._mainBridgeGroups.forEach(({ group }) => {
            const openY  = this._mainBridgeOpenY;
            const closeY = this._mainBridgeCloseYBot;
            group.y(openY + pos * (closeY - openY) - this._ctY);
        });

        // 辅助常开（NO）：pos>0.9 时闭合
        if (this._auxNO) {
            const closed = pos > 0.90;
            this._auxNO.bridge.y(closed ? this._auxNO.closeY : this._auxNO.openY);
            this._auxNO.statusDot.fill(closed ? '#66bb6a' : '#263238');
        }
        // 辅助常闭（NC）：pos<0.10 时闭合
        if (this._auxNC) {
            const closed = pos < 0.10;
            this._auxNC.bridge.y(closed ? this._auxNC.closeY : this._auxNC.openY);
            this._auxNC.statusDot.fill(closed ? '#ef5350' : '#263238');
        }
    }

    // ── 电弧动画 ─────────────────────────────
    _triggerArc(type) {
        this._arcActive = true;
        this._arcTimer  = 0;
        this._arcType   = type;
    }

    _tickArcViz(dt) {
        if (!this._arcActive) { this._arcGroup.opacity(0); return; }
        this._arcTimer += dt;
        if (this._arcTimer > this.arcTime) { this._arcActive = false; this._arcGroup.opacity(0); return; }

        const prog  = this._arcTimer / this.arcTime;
        const alpha = (1 - prog) * 0.85;
        this._arcGroup.destroyChildren();
        this._arcGroup.opacity(alpha);

        const step = this._ctW / (this.polePairs + 1);
        for (let i = 1; i <= this.polePairs; i++) {
            const ax = this._ctX + step * i;
            const ay = this._ctY + this._ctH * 0.46;
            // 电弧核心
            this._arcGroup.add(new Konva.Ellipse({ x: ax, y: ay, radiusX: 6 + prog*8, radiusY: 3, fill: `rgba(255,255,180,${alpha})` }));
            // 电弧丝
            for (let j = 0; j < 3; j++) {
                const ox2 = (Math.random()-0.5)*10, oy2 = (Math.random()-0.5)*4;
                this._arcGroup.add(new Konva.Line({ points: [ax-4, ay, ax+ox2, ay+oy2, ax+4, ay], stroke: `rgba(255,200,80,${alpha*0.7})`, strokeWidth: 1, lineJoin: 'round' }));
            }
        }
    }

    // ── 吸力曲线工作点 ────────────────────────
    _tickForcePoint() {
        if (!this._forcePoint) return;
        const t    = (this._wavePhase % (2*Math.PI)) / (2*Math.PI);
        const px   = this._fgOX + t * this._fgAW;
        const fNorm= this.forceTotal / (this.springForce * 2.5);
        this._forcePoint.x(px);
        this._forcePoint.y(this._fgOY - fNorm * this._fgAH * 0.38);
    }

    // ── 波形更新 ─────────────────────────────
    _tickWaveform(dt) {
        if (!this._wavH4 || !this._wavMids) return;

        const wx = this._wavX + 3, ww = this._wavW - 6, n = this._wavLen;
        const dx = ww / n, h4 = this._wavH4;
        const [mU, mI, mFlux, mF] = this._wavMids;
        const aU = h4 * 0.40, aI = h4 * 0.38, aFlux = h4 * 0.38, aF = h4 * 0.38;
        const uMax  = Math.max(1, this._coilVoltSet * Math.sqrt(2));
        const iMax  = Math.max(0.001, this.coilIm * Math.sqrt(2) * 10);

        const ptU=[], ptI=[], ptFlux=[], ptF=[];
        for (let i = 0; i < n; i++) {
            const x = wx + i * dx;
            ptU.push(x,    mU    - (this._wavCoilU[i] / uMax)  * aU);
            ptI.push(x,    mI    - (this._wavCoilI[i] / iMax)  * aI);
            ptFlux.push(x, mFlux - this._wavFluxB[i]           * aFlux);
            ptF.push(x,    mF    - (this._wavForce[i] / (this.springForce * 2.5)) * aF * 0.8);
        }
        if (this._wLineU)    this._wLineU.points(ptU);
        if (this._wLineI)    this._wLineI.points(ptI);
        if (this._wLineFlux) this._wLineFlux.points(ptFlux);
        if (this._wLineF)    this._wLineF.points(ptF);
    }

    // ── 仪表显示 ─────────────────────────────
    _tickDisplay() {
        const cells = this._lcdCells;
        if (!cells) return;

        const uc  = (this._coilEnergized ? this._coilVoltSet : 0).toFixed(0);
        const ic  = (Math.abs(this.coilCurrent)).toFixed(3);
        const fem = this.forceTotal.toFixed(1);
        const st  = this.contactState === 'closed' ? '吸合' : (this._phase === 'closing' ? '合闸中' : '断开');
        const ops = this.opsCount.toLocaleString();
        const life= Math.min(100, (this.elecOps / this.elecLife * 100)).toFixed(2);

        if (cells.uc)    cells.uc.text(uc);
        if (cells.ic)    cells.ic.text(ic);
        if (cells.fem)   cells.fem.text(fem);
        if (cells.state) cells.state.text(st);
        if (cells.ops)   cells.ops.text(ops);
        if (cells.life)  cells.life.text(life);

        if (this._stateText) {
            const closed = this.contactState === 'closed';
            const closing= this._phase === 'closing';
            this._stateText.text(closed ? '◉  吸  合' : closing ? '◎  合闸中…' : '◉  断  开');
            this._stateText.fill(closed ? '#66bb6a' : closing ? '#ffa726' : '#ef5350');
        }

        if (this._voltBar)    this._voltBar.width((this._coilVoltSet / (this.ratedVoltageCoil * 1.2)) * this._voltBarW);
        if (this._voltValTxt) this._voltValTxt.text(`${this._coilVoltSet.toFixed(0)}V`);
    }

    // ═══════════════════════════════════════════
    /** 合闸指令（线圈通电） */
    close() {
        if (this._phase === 'open') {
            this._coilEnergized = true;
            this._phase         = 'closing';
            this._phaseTimer    = 0;
        }
    }

    /** 分闸指令（线圈断电） */
    open() {
        if (this._phase === 'closed') {
            this._coilEnergized = false;
            this._phase         = 'opening';
            this._phaseTimer    = 0;
        }
    }

    /** 线圈欠压释放（模拟欠压脱扣） */
    undervoltageRelease() {
        if (this.contactState === 'closed' && this._coilVoltSet < this.ratedVoltageCoil * 0.65) {
            this.open();
        }
    }

    /** 外部设置负载状态（用于联锁逻辑） */
    setCoilVoltage(v) {
        this._coilVoltSet = Math.max(0, Math.min(this.ratedVoltageCoil * 1.2, v));
        this._refreshCache();
    }

    /** 查询辅助触点状态 */
    getAuxNO() { return this.contactState === 'closed'; }
    getAuxNC() { return this.contactState !== 'closed'; }

    update(coilVoltage) {
        if (typeof coilVoltage === 'number') this.setCoilVoltage(coilVoltage);
        this.undervoltageRelease();
        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label: '位号/名称',          key: 'id',               type: 'text'   },
            { label: '线圈额定电压 (V)',    key: 'ratedVoltageCoil', type: 'number' },
            { label: '主触点额定电压 (V)',  key: 'ratedVoltagePole', type: 'number' },
            { label: '额定电流 (A)',        key: 'ratedCurrent',     type: 'number' },
            { label: '极数',               key: 'polePairs',        type: 'number' },
            { label: '分磁环相位差 (°)',   key: 'shadeAngle',       type: 'number' },
            { label: '分磁环面积比',        key: 'shadeArea',        type: 'number' },
            { label: '弹簧反力 (N)',        key: 'springForce',      type: 'number' },
            { label: '合闸时间 (s)',        key: 'closeTime',        type: 'number' },
            { label: '分闸时间 (s)',        key: 'openTime',         type: 'number' },
            { label: '电寿命 (次)',         key: 'elecLife',         type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        this.id               = cfg.id               || this.id;
        this.ratedVoltageCoil = parseFloat(cfg.ratedVoltageCoil) || this.ratedVoltageCoil;
        this.ratedVoltagePole = parseFloat(cfg.ratedVoltagePole) || this.ratedVoltagePole;
        this.ratedCurrent     = parseFloat(cfg.ratedCurrent)     || this.ratedCurrent;
        this.polePairs        = parseInt(cfg.polePairs)          || this.polePairs;
        this.shadeAngle       = parseFloat(cfg.shadeAngle)       || this.shadeAngle;
        this.shadeArea        = parseFloat(cfg.shadeArea)        || this.shadeArea;
        this.springForce      = parseFloat(cfg.springForce)      || this.springForce;
        this.closeTime        = parseFloat(cfg.closeTime)        || this.closeTime;
        this.openTime         = parseFloat(cfg.openTime)         || this.openTime;
        this.elecLife         = parseFloat(cfg.elecLife)         || this.elecLife;
        this.config = { ...this.config, ...cfg };
        this._refreshCache();
    }

    destroy() { this._stopAnimation(); super.destroy?.(); }
}