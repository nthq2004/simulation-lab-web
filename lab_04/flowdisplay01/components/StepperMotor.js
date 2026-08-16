import { BaseComponent } from './BaseComponent.js';

/**
 * 步进电动机仿真组件
 * （Stepper Motor / Step Motor）
 *
 * ── 与其他电机的核心区别 ──────────────────────────────────────
 *
 *  步进电机 = 开环数字控制 + 固定步距角 + 无需传感器反馈
 *
 *  ┌──────────────┬──────────────────────┬──────────────────────┐
 *  │              │  伺服电机（PMSM）     │  步进电机            │
 *  ├──────────────┼──────────────────────┼──────────────────────┤
 *  │ 控制方式     │ 闭环（编码器反馈）   │ 开环（脉冲计数）     │
 *  │ 位置精度     │ 极高（< 0.01°）      │ 固定步距（0.9°~1.8°）│
 *  │ 失步         │ 无（闭环纠正）       │ 可能失步（开环限制） │
 *  │ 低速转矩     │ 恒转矩              │ 高（保持转矩大）     │
 *  │ 高速性能     │ 优（弱磁扩速）       │ 差（转矩随速度急降） │
 *  │ 成本         │ 高                  │ 低                   │
 *  │ 应用         │ 高精度伺服           │ 打印机/3D打印/CNC     │
 *  └──────────────┴──────────────────────┴──────────────────────┘
 *
 * ── 步进电机工作原理 ──────────────────────────────────────────
 *
 *  1. 基本结构：
 *     定子：多相励磁绕组（两相/三相/五相），产生旋转磁场
 *     转子：齿状永磁体或软磁材料（多齿结构）
 *     常见类型：
 *       永磁式（PM）：转子为永磁体，步距角大（7.5°~15°）
 *       可变磁阻式（VR）：转子为软磁钢，不能保持，步距角小
 *       混合式（HB）：结合 PM + VR，最常见，步距角 0.9°/1.8°
 *
 *  2. 两相混合式步进电机（最主流）：
 *     定子：8 个极，每极有小齿，共 A+/A-/B+/B- 四个绕组
 *     转子：50 齿（常见），步距角 = 360°/(4×50) = 1.8°（整步）
 *     电步数/转 = 200步（整步），400步（半步），最高 51200步（微步256细分）
 *
 *  3. 励磁方式：
 *     ① 整步（Full Step）：每次切换一相或两相，步距角 = 基本步距角
 *        单相励磁：每次只有一相通电（A → B → /A → /B → A）
 *        双相励磁：每次两相同时通电（AB → /AB → /A/B → A/B → AB）
 *     ② 半步（Half Step）：单相和双相交替，步距角 = 基本步距角/2
 *        序列：A → AB → B → /AB → /A → /A/B → /B → A/B → A
 *     ③ 微步（Micro Step）：正弦/余弦电流控制，步距角 = 基本/N（N=2~256）
 *        i_A = I_max × cos(n×Δθ)
 *        i_B = I_max × sin(n×Δθ)
 *        极大减小振动和噪声，提高平滑度，但不增加静态精度
 *
 *  4. 转矩特性：
 *     保持转矩（Holding Torque）：线圈通电时静止保持的最大转矩
 *     失步转矩（Pull-Out Torque）：运动时能维持同步的最大转矩
 *     启动转矩（Pull-In Torque）：能直接启动的最大转矩
 *     转矩-频率特性：转矩随脉冲频率（步速）升高而急剧下降
 *       T(f) ≈ T_hold × exp(-f/f_corner)（近似指数衰减）
 *       转角频率 f_corner ≈ R/(2πL)（电气截止频率）
 *
 *  5. 失步现象（Out of Step / Step Loss）：
 *     当负载转矩 > 当前频率下的失步转矩时，转子无法跟随磁场
 *     → 转子位置与指令位置出现永久偏差
 *     失步条件：T_load > T_pullout(f)
 *     仿真中：实时计算电磁转矩，当转子滞后超过 90°（电角度）时触发失步警告
 *
 *  6. 振动与共振：
 *     步进电机在某些频率下会发生机械共振（通常 100~300Hz）
 *     固有频率：f_n = (1/2π)×√(K_s/J)，K_s 为同步力矩刚度
 *     共振导致噪声增大、转矩损失甚至失步
 *     阻尼措施：微步细分、阻尼器、变频加速
 *
 *  7. 驱动方式：
 *     L/R 驱动：简单，但高速时电流建立慢（时间常数 τ=L/R 大）
 *     恒流斩波（Chopper）：维持恒定电流幅值，高速性能好
 *     细分驱动：通过 DAC 精确控制每相电流，实现微步
 *
 * ── 组件结构 ──────────────────────────────────────────────────
 *  ① 电机横截面图（定子8极小齿 + 转子50齿 + 四相绕组）
 *  ② 励磁序列表（整步/半步/微步切换，动态高亮当前步）
 *  ③ 绕组电流波形（A相/B相，整步方波 / 半步梯形 / 微步正弦）
 *  ④ 转矩-频率特性曲线（T-f，失步区/安全区，工作点）
 *  ⑤ 相量图（磁场矢量，定子磁场 + 转子磁极，磁力线）
 *  ⑥ 位置跟踪曲线（指令脉冲数 vs 实际步数，失步检测）
 *  ⑦ 失步检测指示（电角度偏差，红色警告动画）
 *  ⑧ LCD 仪表（步数/位置/速度/转矩/失步状态/细分/绕组电流）
 *  ⑨ 控制面板（励磁方式/细分数/脉冲频率/正反转/使能/单步）
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  pul       — 脉冲输入（STEP）
 *  dir       — 方向输入（DIR）
 *  en        — 使能输入（ENA，低有效）
 *  phase_a   — A 相绕组（驱动器输出）
 *  phase_b   — B 相绕组（驱动器输出）
 *  shaft     — 输出轴
 */
export class StepperMotor extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(580, config.width  || 720);
        this.height = Math.max(440, config.height || 560);

        this.type    = 'stepper_motor';
        this.special = 'none';
        this.cache   = 'fixed';

        this._initGroups();
        // ── 额定参数 ──
        this.ratedVoltage   = config.ratedVoltage   || 24;     // V（供电电压）
        this.ratedCurrent   = config.ratedCurrent   || 2.0;    // A（每相额定电流）
        this.holdingTorque  = config.holdingTorque  || 0.65;   // N·m（保持转矩）
        this.detentTorque   = config.detentTorque   || 0.04;   // N·m（制齿转矩，断电时）
        this.stepAngle      = config.stepAngle      || 1.8;    // °（整步步距角）
        this.stepsPerRev    = Math.round(360 / this.stepAngle); // 步/转 = 200

        // ── 电机电气参数 ──
        this.phaseR    = config.phaseR    || 1.5;    // Ω（每相电阻）
        this.phaseL    = config.phaseL    || 3.5e-3; // H（每相电感）
        this.tauE      = this.phaseL / this.phaseR;  // 电气时间常数
        this.Ke        = config.Ke        || 0.18;   // V·s/rad（反电动势系数）
        this.Kt        = config.Kt        || this.holdingTorque / this.ratedCurrent; // N·m/A

        // 转子齿数（混合式标准：50齿）
        this.rotorTeeth = config.rotorTeeth || 50;
        // 定子齿数（每极8小齿，共4极对×8 = 实际齿距）
        this.statorTeeth= config.statorTeeth|| 8;

        // ── 机械参数 ──
        this.J       = config.J       || 6e-5;    // kg·m²
        this.B       = config.B       || 5e-4;    // N·m·s/rad（粘性阻尼）
        this.maxSpeed= config.maxSpeed|| 1500;    // rpm（最高转速）

        // 共振频率
        this.Ks      = this.holdingTorque * this.rotorTeeth; // 同步力矩刚度 N·m/rad
        this.resonFreq = (1/(2*Math.PI)) * Math.sqrt(this.Ks/this.J); // Hz

        // ── 驱动与细分参数 ──
        this.microSteps  = config.microSteps  || 1;    // 细分数（1=整步，2=半步，16/32/64/128/256）
        this.driveMode   = config.driveMode   || 'full'; // 'full'|'half'|'micro'
        this.chopFreq    = config.chopFreq    || 20000; // Hz（斩波频率）

        // ── 励磁序列（整步双相激励，最常用）──
        // 格式：[iA, iB]（归一化，±1）
        this._seqFull = [
            [ 1,  0], [ 0,  1], [-1,  0], [ 0, -1],  // 单相
        ];
        this._seqFullDual = [
            [ 1,  1], [-1,  1], [-1, -1], [ 1, -1],  // 双相
        ];
        this._seqHalf = [
            [ 1,  0], [ 1,  1], [ 0,  1], [-1,  1],
            [-1,  0], [-1, -1], [ 0, -1], [ 1, -1],
        ];

        // ── 运行状态 ──
        this._enabled      = false;     // 使能（ENA）
        this._direction    = 1;         // +1=正转，-1=反转
        this._running      = false;     // 连续运行标志
        this._cmdPulses    = 0;         // 指令脉冲总数（整步等效）
        this._cmdSteps     = 0;         // 指令步数（含细分）
        this._microIdx     = 0;         // 当前微步索引（0~microSteps*4-1）
        this._microIdxPrev = 0;
        this._stepFreq     = config.initFreq || 400;  // Hz（脉冲频率）
        this._stepTimer    = 0;         // 脉冲计时
        this._singleStep   = false;     // 单步触发标志

        // 实际转子
        this._thetaE       = 0;         // 转子电角度（rad），每整步 = 2π/(stepsPerRev×polePairs×... / rotorTeeth)
        // 对混合式：电角度步距 = π/2（每步90°电角）
        this._thetaMech    = 0;         // 机械角度（rad）
        this._omegaMech    = 0;         // 机械角速度（rad/s）
        this._thetaETarget = 0;         // 目标电角度（跟随励磁序列）
        this._lostSteps    = 0;         // 失步数
        this._outOfStep    = false;     // 失步标志

        // 励磁量
        this._iA    = 0;  this._iB    = 0;  // 实际相电流
        this._iAref = 0;  this._iBref = 0;  // 给定相电流
        this._uA    = 0;  this._uB    = 0;  // 相电压

        // 转矩与功率
        this.torqueEM    = 0;
        this.powerIn     = 0;
        this.efficiency  = 0;
        this._loadTorque = config.initLoad || 0;

        // 振动（共振效应）
        this._vibration  = 0;
        this._vibPhase   = 0;

        // ── 波形缓冲 ──
        this._wavLen   = 300;
        this._wavIA    = new Float32Array(this._wavLen).fill(0);
        this._wavIB    = new Float32Array(this._wavLen).fill(0);
        this._wavTq    = new Float32Array(this._wavLen).fill(0);
        this._wavPos   = new Float32Array(this._wavLen).fill(0);
        this._wavPosCmd= new Float32Array(this._wavLen).fill(0);
        this._wavVib   = new Float32Array(this._wavLen).fill(0);

        // ── 几何布局 ──
        // 电机截面（左上）
        this._motX  = Math.round(this.width * 0.02);
        this._motY  = Math.round(this.height * 0.04);
        this._motW  = Math.round(this.width * 0.28);
        this._motH  = Math.round(this.height * 0.46);
        this._motCX = this._motX + this._motW / 2;
        this._motCY = this._motY + this._motH / 2;

        // 励磁序列表（右上左）
        this._seqX  = Math.round(this.width * 0.32);
        this._seqY  = this._motY;
        this._seqW  = Math.round(this.width * 0.20);
        this._seqH  = Math.round(this.height * 0.24);

        // 转矩-频率曲线（右上右）
        this._tfX   = this._seqX + this._seqW + 8;
        this._tfY   = this._motY;
        this._tfW   = Math.round(this.width * 0.24);
        this._tfH   = this._seqH;

        // 相量图（最右上）
        this._pvX   = this._tfX + this._tfW + 8;
        this._pvY   = this._motY;
        this._pvW   = this.width - this._pvX - Math.round(this.width * 0.02);
        this._pvH   = this._seqH;

        // 位置跟踪（中下左）
        this._ptX   = this._seqX;
        this._ptY   = this._seqY + this._seqH + 8;
        this._ptW   = this._seqW + this._tfW + 8;
        this._ptH   = Math.round(this.height * 0.24);

        // 失步指示（中下右）
        this._osX   = this._pvX;
        this._osY   = this._ptY;
        this._osW   = this._pvW;
        this._osH   = this._ptH;

        // LCD（左下）
        this._lcdX  = this._motX;
        this._lcdY  = this._motY + this._motH + 8;
        this._lcdW  = this._motW;
        this._lcdH  = Math.round(this.height * 0.26);

        // 控制面板（中下）
        this._panX  = this._seqX;
        this._panY  = this._ptY + this._ptH + 8;
        this._panW  = this.width - this._seqX - Math.round(this.width * 0.02);
        this._panH  = Math.round(this.height * 0.16);

        // 波形（底部全宽）
        this._wavX  = this._motX;
        this._wavY  = Math.max(this._lcdY + this._lcdH, this._panY + this._panH) + 6;
        this._wavW  = this.width - this._motX * 2;
        this._wavH  = this.height - this._wavY - 6;

        this._animPhase = 0;  // 全局动画相位（用于磁场粒子等）

        this.config = {
            id: this.id,
            ratedVoltage: this.ratedVoltage,
            ratedCurrent: this.ratedCurrent,
            holdingTorque: this.holdingTorque,
            stepAngle: this.stepAngle,
        };

        this._init();

        // 端口
        const mL = this._motX - 6;
        this.addPort(mL, this._motCY - 28, 'pul',    'wire', 'PUL');
        this.addPort(mL, this._motCY - 8,  'dir',    'wire', 'DIR');
        this.addPort(mL, this._motCY + 12, 'en',     'wire', 'ENA');
        const mR = this._motX + this._motW + 6;
        this.addPort(mR, this._motCY - 20, 'phase_a','wire', 'A');
        this.addPort(mR, this._motCY + 20, 'phase_b','wire', 'B');
        this.addPort(this._motCX, this._motY + this._motH + 6, 'shaft', 'pipe', '轴');
    }

    // ═══════════════════════════════════════════
    _init() {
        this._drawLabel();
        this._drawMotorSection();
        this._drawRotorTeethLayer();
        this._drawFieldLayer();
        this._drawExcitationTable();
        this._drawTFCurve();
        this._drawPhasorViz();
        this._drawPositionTrace();
        this._drawOutOfStepPanel();
        this._drawLCDPanel();
        this._drawControlPanel();
        this._drawWaveform();
        
    }

    _drawLabel() {
        const modeStr = `${this.stepsPerRev}步/转（整步）/ ${this.stepsPerRev*2}步/转（半步）/ 最高${this.stepsPerRev*256}步/转（256细分）`;
        this._staticGroup.add(new Konva.Text({
            x: 0, y: -22, width: this.width,
            text: `两相混合式步进电机  ${this.holdingTorque}N·m  ${this.ratedCurrent}A  ${this.stepAngle}°/步  ${modeStr}`,
            fontSize: 10, fontStyle: 'bold', fill: '#1a2634', align: 'center',
        }));
    }

    // ── 电机横截面（定子+转子小齿） ──────────
    _drawMotorSection() {
        const { _motX: ex, _motY: ey, _motW: ew, _motH: eh,
                _motCX: ecx, _motCY: ecy } = this;

        this._staticGroup.add(new Konva.Rect({
            x: ex, y: ey, width: ew, height: eh,
            fill: '#0d1a24', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 5,
        }));
        this._staticGroup.add(new Konva.Text({
            x: ex, y: ey - 14, width: ew,
            text: `两相混合式步进电机截面（${this.rotorTeeth}齿转子）`,
            fontSize: 9, fontStyle: 'bold', fill: '#546e7a', align: 'center',
        }));

        // ── 机座 ──
        const frameR = Math.round(Math.min(ew, eh) * 0.46);
        this._staticGroup.add(new Konva.Circle({ x: ecx, y: ecy, radius: frameR, fill: '#1c2b38', stroke: '#37474f', strokeWidth: 3 }));

        // ── 定子铁芯 ──
        const sOuter = Math.round(frameR * 0.90);
        const sInner = Math.round(frameR * 0.55);
        this._staticGroup.add(new Konva.Ring({ x: ecx, y: ecy, innerRadius: sInner, outerRadius: sOuter, fill: '#455a64', stroke: '#263238', strokeWidth: 1 }));

        // 叠片纹
        for (let i = 0; i < 48; i++) {
            const a = (i / 48) * Math.PI * 2;
            this._staticGroup.add(new Konva.Line({
                points: [ecx+sInner*Math.cos(a), ecy+sInner*Math.sin(a),
                         ecx+sOuter*Math.cos(a), ecy+sOuter*Math.sin(a)],
                stroke: 'rgba(0,0,0,0.12)', strokeWidth: 0.5,
            }));
        }

        // ── 定子 8 极（混合式典型）──
        const nPoles = 8;
        const poleW  = Math.round(sInner * 0.28);
        const poleH  = Math.round((sOuter - sInner) * 0.55);
        const poleR  = sInner * 1.02;
        const phColors = ['#e53935','#e53935','#43a047','#43a047',
                          '#e53935','#e53935','#43a047','#43a047'];
        const phNames  = ['A+','A+','B+','B+','A-','A-','B-','B-'];

        this._statorPoles = [];
        for (let i = 0; i < nPoles; i++) {
            const a   = (i / nPoles) * Math.PI * 2 - Math.PI / 2;
            const cx2 = ecx + poleR * Math.cos(a);
            const cy2 = ecy + poleR * Math.sin(a);
            const rect= new Konva.Rect({
                x: cx2 - poleW/2, y: cy2 - poleH/2,
                width: poleW, height: poleH,
                fill: '#546e7a', stroke: '#263238', strokeWidth: 1,
                rotation: a * 180 / Math.PI,
                offsetX: 0, offsetY: 0,
            });

            // 极靴小齿（每极 2~3 个小齿，示意）
            for (let t = -1; t <= 1; t++) {
                const ta = a + t * 0.08;
                const tr0= sInner + poleH * 0.1;
                const tr1= sInner - 3;
                this._staticGroup.add(new Konva.Line({
                    points: [ecx+tr0*Math.cos(ta), ecy+tr0*Math.sin(ta),
                             ecx+tr1*Math.cos(ta), ecy+tr1*Math.sin(ta)],
                    stroke: '#263238', strokeWidth: 4, lineCap: 'square',
                }));
            }

            // 绕组（着色矩形）
            const wRect = new Konva.Rect({
                x: cx2 - poleW * 0.7, y: cy2 - poleH * 0.2,
                width: poleW * 1.4, height: poleH * 0.65,
                fill: phColors[i], opacity: 0.5,
                rotation: a * 180 / Math.PI,
                offsetX: 0,
            });

            // 极标注
            this._staticGroup.add(new Konva.Text({
                x: ecx + (sInner + (sOuter-sInner)*0.65) * Math.cos(a) - 8,
                y: ecy + (sInner + (sOuter-sInner)*0.65) * Math.sin(a) - 5,
                text: phNames[i], fontSize: 7, fill: phColors[i], fontStyle: 'bold',
            }));

            this._statorPoles.push({ rect, wRect, angle: a, col: phColors[i] });
            this._staticGroup.add(rect, wRect);
        }

        // ── 气隙 ──
        this._airGapR = Math.round(sInner * 0.97);
        this._staticGroup.add(new Konva.Circle({ x: ecx, y: ecy, radius: this._airGapR, fill: '#05101a', stroke: '#1a3040', strokeWidth: 0.5 }));

        // ── 转子外圆（静态轮廓）──
        const rotorR = Math.round(this._airGapR * 0.86);
        this._staticGroup.add(new Konva.Circle({ x: ecx, y: ecy, radius: rotorR, fill: '#2e3f4f', stroke: '#37474f', strokeWidth: 1.2 }));
        this._rotorR    = rotorR;
        this._sInner    = sInner;
        this._sOuter    = sOuter;
        this._frameR    = frameR;

        // 转子永磁层（N/S 交替着色环，模拟轴向磁化）
        this._staticGroup.add(new Konva.Ring({ x: ecx, y: ecy, innerRadius: rotorR*0.55, outerRadius: rotorR*0.78, fill: '#3e2723', stroke: '#5d4037', strokeWidth: 0.8 }));
        this._staticGroup.add(new Konva.Text({ x: ecx - 12, y: ecy - 6, text: '转子\n永磁', fontSize: 7, fill: '#a1887f', lineHeight: 1.3 }));

        // 轴孔
        this._staticGroup.add(new Konva.Circle({ x: ecx, y: ecy, radius: 8, fill: '#1a252f', stroke: '#37474f', strokeWidth: 1.5 }));
        // 参考标记点
        this._rotorRefDot = new Konva.Circle({ x: ecx + rotorR*0.60, y: ecy, radius: 3, fill: '#ffd54f' });
        this._staticGroup.add(this._rotorRefDot);

        // 三相接线端子（右侧）
        const termX = ex + ew + 10;
        [['A','#e53935',-20],['B','#43a047',20]].forEach(([l,c,dy]) => {
            this._staticGroup.add(new Konva.Line({ points: [ecx+sOuter*0.65, ecy+dy, termX, ecy+dy], stroke: c, strokeWidth: 2 }));
            this._staticGroup.add(new Konva.Circle({ x: termX, y: ecy+dy, radius: 3.5, fill: c }));
            this._staticGroup.add(new Konva.Text({ x: termX+5, y: ecy+dy-6, text: l, fontSize: 9, fill: c, fontStyle: 'bold' }));
        });

        // 控制信号端子（左侧）
        const ctrlX = ex - 10;
        [['PUL','#ffd54f',-28],['DIR','#80cbc4',-8],['ENA','#66bb6a',12]].forEach(([l,c,dy]) => {
            this._staticGroup.add(new Konva.Line({ points: [ctrlX, ecy+dy, ex, ecy+dy], stroke: c, strokeWidth: 1.5, dash: [3,3] }));
            this._staticGroup.add(new Konva.Circle({ x: ctrlX, y: ecy+dy, radius: 3, fill: c }));
            this._staticGroup.add(new Konva.Text({ x: ex-28, y: ecy+dy-5, text: l, fontSize: 7, fill: c }));
        });

        // 输出轴
        this._staticGroup.add(new Konva.Rect({ x: ecx-5, y: ey+eh, width: 10, height: 10, fill: '#78909c', stroke: '#546e7a', strokeWidth: 1 }));
    }

    // ── 转子小齿动画层 ──────────────────────
    _drawRotorTeethLayer() {
        this._teethGroup = new Konva.Group();
        this._staticGroup.add(this._teethGroup);
    }

    // ── 磁场动画层 ───────────────────────────
    _drawFieldLayer() {
        this._fieldGroup = new Konva.Group();
        this._staticGroup.add(this._fieldGroup);
    }

    // ── 励磁序列表 ───────────────────────────
    _drawExcitationTable() {
        const { _seqX: sx, _seqY: sy, _seqW: sw, _seqH: sh } = this;

        this._staticGroup.add(new Konva.Rect({ x:sx, y:sy, width:sw, height:sh, fill:'#010d18', stroke:'#1a3040', strokeWidth:1.5, cornerRadius:4 }));
        this._staticGroup.add(new Konva.Rect({ x:sx, y:sy, width:sw, height:13, fill:'#0a1a28', cornerRadius:[4,4,0,0] }));
        this._staticGroup.add(new Konva.Text({ x:sx+4, y:sy+2, width:sw-8, text:'励磁序列（当前模式）', fontSize:8, fontStyle:'bold', fill:'#80cbc4', align:'center' }));

        // 表头
        const hY = sy + 16;
        [['步#',0.08],['iA',0.30],['iB',0.56],['磁场↗',0.75]].forEach(([h,xr]) => {
            this._staticGroup.add(new Konva.Text({ x:sx+sw*xr, y:hY, text:h, fontSize:7.5, fill:'#546e7a', fontStyle:'bold' }));
        });
        this._staticGroup.add(new Konva.Line({ points:[sx+4, hY+10, sx+sw-4, hY+10], stroke:'#1a3040', strokeWidth:0.8 }));

        // 序列行（最多显示 8 行）
        this._seqRows  = [];
        this._seqRowsY = sy + 28;
        this._seqRowH  = (sh - 30) / 8;
        for (let i = 0; i < 8; i++) {
            const ry  = sy + 28 + i * this._seqRowH;
            const rowBg = new Konva.Rect({ x:sx+3, y:ry, width:sw-6, height:this._seqRowH-1, fill:'rgba(0,0,0,0)', cornerRadius:2 });
            const tStep = new Konva.Text({ x:sx+sw*0.06, y:ry+2, text:`${i+1}`, fontSize:8, fontStyle:'bold', fill:'#546e7a' });
            const tIA   = new Konva.Text({ x:sx+sw*0.24, y:ry+2, text:'0', fontSize:8, fill:'#ef9a9a', fontFamily:'Courier New, monospace', width:sw*0.22, align:'right' });
            const tIB   = new Konva.Text({ x:sx+sw*0.50, y:ry+2, text:'0', fontSize:8, fill:'#90caf9', fontFamily:'Courier New, monospace', width:sw*0.22, align:'right' });
            const dot   = new Konva.Circle({ x:sx+sw*0.85, y:ry+this._seqRowH/2-1, radius:5, fill:'#263238', stroke:'#37474f', strokeWidth:1 });
            this._staticGroup.add(rowBg, tStep, tIA, tIB, dot);
            this._seqRows.push({ bg:rowBg, tIA, tIB, dot });
        }
        // 当前步指针
        this._seqPointer = new Konva.Text({ x:sx+3, y:this._seqRowsY, text:'▶', fontSize:10, fill:'#ffd54f' });
        this._staticGroup.add(this._seqPointer);
    }

    // ── 转矩-频率特性曲线 ───────────────────
    _drawTFCurve() {
        const { _tfX: tx, _tfY: ty, _tfW: tw, _tfH: th } = this;

        this._staticGroup.add(new Konva.Rect({ x:tx, y:ty, width:tw, height:th, fill:'#010d18', stroke:'#1a3040', strokeWidth:1.5, cornerRadius:4 }));
        this._staticGroup.add(new Konva.Rect({ x:tx, y:ty, width:tw, height:13, fill:'#0a1a28', cornerRadius:[4,4,0,0] }));
        this._staticGroup.add(new Konva.Text({ x:tx+4, y:ty+2, width:tw-8, text:'T-f 转矩-频率特性', fontSize:8, fontStyle:'bold', fill:'#80cbc4', align:'center' }));

        const ox=tx+16, oy=ty+th-12, aw=tw-22, ah=th-26;
        this._staticGroup.add(new Konva.Line({ points:[ox,oy-ah,ox,oy,ox+aw,oy], stroke:'#37474f', strokeWidth:0.8 }));
        this._staticGroup.add(new Konva.Text({ x:ox-14, y:oy-ah, text:'T', fontSize:7, fill:'#80cbc4' }));
        this._staticGroup.add(new Konva.Text({ x:ox+aw+2, y:oy+2, text:'f', fontSize:7, fill:'#80cbc4' }));

        const fMax = this.maxSpeed * this.stepsPerRev / 60;  // 最高脉冲频率 Hz

        // 频率刻度
        [500,1000,2000,4000,fMax].forEach(f => {
            const x = ox+(f/fMax)*aw;
            this._staticGroup.add(new Konva.Line({ points:[x,oy,x,oy+3], stroke:'#37474f', strokeWidth:0.7 }));
            this._staticGroup.add(new Konva.Text({ x:x-8, y:oy+4, text:`${f>=1000?(f/1000)+'k':f}`, fontSize:6, fill:'#37474f', width:16, align:'center' }));
        });

        // 保持转矩水平线
        const holdY = oy - (1.0)*(ah-4);
        this._staticGroup.add(new Konva.Line({ points:[ox,holdY,ox+aw,holdY], stroke:'#546e7a', strokeWidth:0.8, dash:[4,3] }));
        this._staticGroup.add(new Konva.Text({ x:ox+2, y:holdY-9, text:'T_hold', fontSize:6.5, fill:'#546e7a' }));

        // Pull-out（失步）曲线
        const pullOutPts = [];
        for (let f = 0; f <= fMax; f += fMax/60) {
            const T = this._calcPullOutTorque(f);
            const x = ox+(f/fMax)*aw;
            const y = oy-(T/this.holdingTorque)*(ah-4);
            if (x<=ox+aw && y>=ty+14) pullOutPts.push(x,y);
        }
        this._staticGroup.add(new Konva.Line({ points:pullOutPts, stroke:'#ef5350', strokeWidth:2, lineJoin:'round', opacity:0.85 }));

        // Pull-in（起动）曲线（低于 pull-out）
        const pullInPts = [];
        for (let f = 0; f <= fMax; f += fMax/60) {
            const T = this._calcPullOutTorque(f) * 0.55;
            const x = ox+(f/fMax)*aw;
            const y = oy-(T/this.holdingTorque)*(ah-4);
            if (x<=ox+aw && y>=ty+14) pullInPts.push(x,y);
        }
        this._staticGroup.add(new Konva.Line({ points:pullInPts, stroke:'#ffa726', strokeWidth:1.5, lineJoin:'round', opacity:0.7 }));

        // 共振频率标线
        const fResX = ox+(this.resonFreq/fMax)*aw;
        if (fResX > ox && fResX < ox+aw) {
            this._staticGroup.add(new Konva.Line({ points:[fResX,ty+14,fResX,oy], stroke:'#ffd54f', strokeWidth:0.8, dash:[3,3] }));
            this._staticGroup.add(new Konva.Text({ x:fResX-3, y:ty+14, text:'f_res', fontSize:6.5, fill:'#ffd54f' }));
        }

        // 区域填色（稳定运行区）
        if (pullInPts.length>4)
            this._staticGroup.add(new Konva.Line({ points:[...pullInPts, ox+aw,oy, ox,oy], closed:true, fill:'rgba(102,187,106,0.06)', stroke:'none' }));

        // 图例
        [[tx+6,'#ef5350','失步转矩（Pull-out）'],[tx+6,'#ffa726','起动转矩（Pull-in）']].forEach(([x,col,lbl],i)=>{
            this._staticGroup.add(new Konva.Line({ points:[x,ty+14+i*9+3,x+12,ty+14+i*9+3], stroke:col, strokeWidth:1.8 }));
            this._staticGroup.add(new Konva.Text({ x:x+14, y:ty+14+i*9-1, text:lbl, fontSize:6.5, fill:col }));
        });

        // 动态工作点
        this._tfPoint = new Konva.Circle({ x:ox, y:oy, radius:5, fill:'#66bb6a', stroke:'#2e7d32', strokeWidth:1.5 });
        this._staticGroup.add(this._tfPoint);
        this._tfOX=ox; this._tfOY=oy; this._tfAW=aw; this._tfAH=ah; this._tfFMax=fMax;
    }

    // 失步转矩计算（指数衰减 + L/R 时间常数）
    _calcPullOutTorque(f) {
        if (f <= 0) return this.holdingTorque;
        const omega_e = f * 2 * Math.PI * (1/this.stepsPerRev * 4); // 电角速度
        const Zbw  = Math.sqrt(this.phaseR**2 + (omega_e*this.phaseL)**2);
        const iMax = this.ratedVoltage / Zbw;
        const ratio= Math.min(1, iMax / this.ratedCurrent);
        return this.holdingTorque * ratio * (1/(1 + (f/this.resonFreq*0.3)**2)**0.5);
    }

    // ── 磁场相量可视化 ──────────────────────
    _drawPhasorViz() {
        const { _pvX: px, _pvY: py, _pvW: pw, _pvH: ph } = this;

        this._staticGroup.add(new Konva.Rect({ x:px, y:py, width:pw, height:ph, fill:'#010d18', stroke:'#1a3040', strokeWidth:1.5, cornerRadius:4 }));
        this._staticGroup.add(new Konva.Rect({ x:px, y:py, width:pw, height:13, fill:'#0a1a28', cornerRadius:[4,4,0,0] }));
        this._staticGroup.add(new Konva.Text({ x:px+4, y:py+2, width:pw-8, text:'定子磁场相量（A/B 相合成）', fontSize:8, fontStyle:'bold', fill:'#80cbc4', align:'center' }));

        const ocx=px+pw*0.50, ocy=py+ph*0.58;
        const R  =Math.min(pw,ph)*0.30;

        // 坐标轴（A/B 方向）
        this._staticGroup.add(new Konva.Line({ points:[px+6,ocy,px+pw-6,ocy], stroke:'#37474f', strokeWidth:0.8 }));
        this._staticGroup.add(new Konva.Line({ points:[ocx,py+14,ocx,py+ph-6], stroke:'#37474f', strokeWidth:0.8 }));
        this._staticGroup.add(new Konva.Text({ x:px+pw-14,y:ocy+3, text:'A', fontSize:8, fill:'#e53935' }));
        this._staticGroup.add(new Konva.Text({ x:ocx+3,y:py+14, text:'B', fontSize:8, fill:'#43a047' }));

        // 电流极限圆
        this._staticGroup.add(new Konva.Circle({ x:ocx, y:ocy, radius:R, fill:'rgba(255,255,255,0.03)', stroke:'#37474f', strokeWidth:0.8, dash:[4,3] }));

        // 整步 4 个稳定位置点
        const stepPts = [[1,0],[0,1],[-1,0],[0,-1]];
        stepPts.forEach(([a,b]) => {
            this._staticGroup.add(new Konva.Circle({ x:ocx+a*R, y:ocy-b*R, radius:4, fill:'#263238', stroke:'#37474f', strokeWidth:1 }));
        });
        // 双相激励 4 点
        [[1,1],[-1,1],[-1,-1],[1,-1]].forEach(([a,b]) => {
            this._staticGroup.add(new Konva.Circle({ x:ocx+a*R/Math.sqrt(2), y:ocy-b*R/Math.sqrt(2), radius:3, fill:'#1a2a3a', stroke:'#37474f', strokeWidth:0.8 }));
        });

        // 动态磁场矢量
        this._pvIA  = new Konva.Arrow({ points:[ocx,ocy,ocx+R,ocy],   stroke:'#e53935',fill:'#e53935',strokeWidth:2,pointerLength:6,pointerWidth:5 });
        this._pvIB  = new Konva.Arrow({ points:[ocx,ocy,ocx,ocy-R],   stroke:'#43a047',fill:'#43a047',strokeWidth:2,pointerLength:6,pointerWidth:5 });
        this._pvIs  = new Konva.Arrow({ points:[ocx,ocy,ocx+R,ocy-R], stroke:'#ffd54f',fill:'#ffd54f',strokeWidth:2.5,pointerLength:7,pointerWidth:6 });
        this._pvRotor=new Konva.Arrow({ points:[ocx,ocy,ocx+R*0.7,ocy],stroke:'#ef9a9a',fill:'#ef9a9a',strokeWidth:2,pointerLength:5,pointerWidth:4,dash:[4,2] });

        // 图例
        const lgX=px+6, lgY=py+14;
        [['#e53935','iA（A相）'],['#43a047','iB（B相）'],
         ['#ffd54f','Is（合成）'],['#ef9a9a','转子磁极']].forEach(([col,lbl],i)=>{
            this._staticGroup.add(new Konva.Line({ points:[lgX,lgY+i*9+3,lgX+10,lgY+i*9+3], stroke:col, strokeWidth:1.8 }));
            this._staticGroup.add(new Konva.Text({ x:lgX+12, y:lgY+i*9-1, text:lbl, fontSize:7, fill:col }));
        });

        this._pvOCX=ocx; this._pvOCY=ocy; this._pvR=R;
        this._staticGroup.add(this._pvIA, this._pvIB, this._pvIs, this._pvRotor);
    }

    // ── 位置跟踪曲线 ─────────────────────────
    _drawPositionTrace() {
        const { _ptX: tx, _ptY: ty, _ptW: tw, _ptH: th } = this;

        this._staticGroup.add(new Konva.Rect({ x:tx, y:ty, width:tw, height:th, fill:'#010d18', stroke:'#1a3040', strokeWidth:1.5, cornerRadius:4 }));
        this._staticGroup.add(new Konva.Rect({ x:tx, y:ty, width:tw, height:13, fill:'#0a1a28', cornerRadius:[4,4,0,0] }));
        this._staticGroup.add(new Konva.Text({ x:tx+4, y:ty+2, width:tw-8, text:'位置跟踪（指令步数 vs 实际位置）', fontSize:8, fontStyle:'bold', fill:'#80cbc4', align:'center' }));

        const ox=tx+14, oy=ty+th-12, aw=tw-20, ah=th-26;
        this._staticGroup.add(new Konva.Line({ points:[ox,oy-ah,ox,oy,ox+aw,oy], stroke:'#37474f', strokeWidth:0.8 }));
        this._staticGroup.add(new Konva.Text({ x:ox-12, y:oy-ah, text:'steps', fontSize:7, fill:'#80cbc4' }));
        this._staticGroup.add(new Konva.Text({ x:ox+aw+2, y:oy+2, text:'t', fontSize:7, fill:'#80cbc4' }));

        this._ptCmdLine  = new Konva.Line({ points:[], stroke:'#ffd54f', strokeWidth:1.5, lineJoin:'round', dash:[4,3] });
        this._ptActLine  = new Konva.Line({ points:[], stroke:'#66bb6a', strokeWidth:1.8, lineJoin:'round' });
        this._ptErrLine  = new Konva.Line({ points:[], stroke:'#ef5350', strokeWidth:1.2, lineJoin:'round' });

        const lgX=tx+6, lgY=ty+14;
        [['#ffd54f','指令步数'],['#66bb6a','实际位置'],['#ef5350','误差（失步）']].forEach(([col,lbl],i)=>{
            this._staticGroup.add(new Konva.Line({ points:[lgX,lgY+i*9+3,lgX+10,lgY+i*9+3], stroke:col, strokeWidth:1.8 }));
            this._staticGroup.add(new Konva.Text({ x:lgX+12, y:lgY+i*9-1, text:lbl, fontSize:7, fill:col }));
        });
        this._staticGroup.add(this._ptCmdLine, this._ptActLine, this._ptErrLine);
        this._ptOX=ox; this._ptOY=oy; this._ptAW=aw; this._ptAH=ah;
    }

    // ── 失步检测面板 ─────────────────────────
    _drawOutOfStepPanel() {
        const { _osX: ox, _osY: oy, _osW: ow, _osH: oh } = this;

        this._staticGroup.add(new Konva.Rect({ x:ox, y:oy, width:ow, height:oh, fill:'#010d18', stroke:'#1a3040', strokeWidth:1.5, cornerRadius:4 }));
        this._staticGroup.add(new Konva.Rect({ x:ox, y:oy, width:ow, height:13, fill:'#0a1a28', cornerRadius:[4,4,0,0] }));
        this._staticGroup.add(new Konva.Text({ x:ox+4, y:oy+2, width:ow-8, text:'失步检测与振动分析', fontSize:8, fontStyle:'bold', fill:'#80cbc4', align:'center' }));

        // 电角度偏差仪表（圆形）
        const cx2=ox+ow*0.35, cy2=oy+oh*0.52;
        const R2 =Math.round(Math.min(ow,oh)*0.22);
        // 圆弧背景（0~180°区）
        this._staticGroup.add(new Konva.Arc({ x:cx2, y:cy2, innerRadius:R2-6, outerRadius:R2+6, angle:180, rotation:-180, fill:'rgba(102,187,106,0.15)', stroke:'#66bb6a', strokeWidth:0.8 }));
        // 90°~180° 危险区
        this._staticGroup.add(new Konva.Arc({ x:cx2, y:cy2, innerRadius:R2-6, outerRadius:R2+6, angle:90, rotation:-180, fill:'rgba(255,167,38,0.20)' }));
        // >90° 失步区
        this._staticGroup.add(new Konva.Arc({ x:cx2, y:cy2, innerRadius:R2-6, outerRadius:R2+6, angle:90, rotation:-90, fill:'rgba(239,83,80,0.25)' }));
        this._staticGroup.add(new Konva.Text({ x:cx2-R2, y:cy2+R2+3, width:R2*2, text:'电角偏差', fontSize:7, fill:'#546e7a', align:'center' }));
        this._staticGroup.add(new Konva.Text({ x:cx2+R2*0.5, y:cy2-R2*0.25, text:'90°', fontSize:6.5, fill:'#ffa726' }));
        this._staticGroup.add(new Konva.Text({ x:cx2-R2-14, y:cy2-8, text:'180°', fontSize:6.5, fill:'#ef5350' }));

        // 电角度指针
        this._osNeedle = new Konva.Line({ points:[cx2,cy2, cx2+R2*0.85,cy2], stroke:'#ffd54f', strokeWidth:2, lineCap:'round' });
        this._osAngleLabel = new Konva.Text({ x:cx2-18, y:cy2-R2*0.5, text:'0°', fontSize:9, fontStyle:'bold', fill:'#ffd54f', width:36, align:'center' });
        this._staticGroup.add(this._osNeedle, this._osAngleLabel);
        this._osCX=cx2; this._osCY=cy2; this._osR=R2;

        // 失步计数器 + 状态指示
        this._osStatusBg  = new Konva.Rect({ x:ox+ow*0.60, y:oy+oh*0.28, width:ow*0.36, height:oh*0.36, fill:'#0d1520', cornerRadius:4 });
        this._osStatusText= new Konva.Text({ x:ox+ow*0.60, y:oy+oh*0.33, width:ow*0.36, text:'✓ 正常', fontSize:12, fontStyle:'bold', fill:'#66bb6a', align:'center' });
        this._osLostLabel = new Konva.Text({ x:ox+ow*0.60, y:oy+oh*0.50, width:ow*0.36, text:'失步:0步', fontSize:8, fill:'#ef5350', align:'center', fontFamily:'Courier New, monospace' });
        this._staticGroup.add(this._osStatusBg, this._osStatusText, this._osLostLabel);

        // 振动指示条
        const vibY=oy+oh*0.78;
        this._staticGroup.add(new Konva.Text({ x:ox+6, y:vibY-10, text:'振动幅度:', fontSize:7.5, fill:'#546e7a' }));
        this._staticGroup.add(new Konva.Rect({ x:ox+6, y:vibY, width:ow-12, height:8, fill:'#0a0a18', cornerRadius:2 }));
        this._osVibBar  = new Konva.Rect({ x:ox+6, y:vibY, width:0, height:8, fill:'#ffd54f', cornerRadius:2 });
        this._osVibBarW = ow-12;
        this._staticGroup.add(this._osVibBar);

        // 共振警告
        this._osResWarn = new Konva.Text({ x:ox+6, y:vibY+11, text:'', fontSize:7, fill:'#ffa726' });
        this._staticGroup.add(this._osResWarn);
    }

    // ── LCD 仪表 ─────────────────────────────
    _drawLCDPanel() {
        const { _lcdX: lx, _lcdY: ly, _lcdW: lw, _lcdH: lh } = this;

        this._staticGroup.add(new Konva.Rect({ x:lx, y:ly, width:lw, height:lh, fill:'#020c14', stroke:'#1a3040', strokeWidth:1.5, cornerRadius:4 }));
        this._staticGroup.add(new Konva.Rect({ x:lx, y:ly, width:lw, height:13, fill:'#0a1a28', cornerRadius:[4,4,0,0] }));
        this._staticGroup.add(new Konva.Text({ x:lx+4, y:ly+2, width:lw-8, text:'运行仪表', fontSize:8, fontStyle:'bold', fill:'#80cbc4', align:'center' }));

        const cells=[
            {label:'指令步数', id:'cmdStep', unit:'步',  color:'#ffd54f'},
            {label:'实际步数', id:'actStep', unit:'步',  color:'#66bb6a'},
            {label:'位置角',   id:'posDeg',  unit:'°',   color:'#4fc3f7'},
            {label:'转速',     id:'spd',     unit:'rpm', color:'#80cbc4'},
            {label:'脉冲频率', id:'freq',    unit:'Hz',  color:'#ffa726'},
            {label:'转矩',     id:'tq',      unit:'N·m', color:'#ef9a9a'},
            {label:'A相电流',  id:'ia',      unit:'A',   color:'#e53935'},
            {label:'B相电流',  id:'ib',      unit:'A',   color:'#43a047'},
            {label:'失步数',   id:'lost',    unit:'步',  color:'#ef5350'},
            {label:'励磁步序', id:'step',    unit:'/N',  color:'#ce93d8'},
            {label:'细分数',   id:'micro',   unit:'细分',color:'#ffd54f'},
            {label:'使能',     id:'en',      unit:'',    color:'#66bb6a'},
        ];

        const cellW=(lw-8)/3, cellH=22, gap=2;
        this._lcdCells={};
        cells.forEach(({label,id,unit,color},i)=>{
            const col=i%3, row=Math.floor(i/3);
            const cx3=lx+4+col*(cellW+gap), cy3=ly+16+row*(cellH+gap);
            this._staticGroup.add(new Konva.Rect({x:cx3,y:cy3,width:cellW,height:cellH,fill:'#0d1520',cornerRadius:2}));
            this._staticGroup.add(new Konva.Text({x:cx3+2,y:cy3+2,text:label,fontSize:6.5,fill:'#37474f'}));
            const val=new Konva.Text({x:cx3+2,y:cy3+9,width:cellW-4,text:'--',fontSize:9,fontFamily:'Courier New, monospace',fontStyle:'bold',fill:color,align:'right'});
            this._staticGroup.add(new Konva.Text({x:cx3+2,y:cy3+14,width:cellW-4,text:unit,fontSize:6,fill:'#1a252f',align:'right'}));
            this._lcdCells[id]=val;
            this._staticGroup.add(val);
        });
    }

    // ── 控制面板 ─────────────────────────────
    _drawControlPanel() {
        const { _panX: px, _panY: py, _panW: pw, _panH: ph } = this;

        this._staticGroup.add(new Konva.Rect({x:px,y:py,width:pw,height:ph,fill:'#0d1520',stroke:'#1a3040',strokeWidth:1.5,cornerRadius:4}));
        this._staticGroup.add(new Konva.Rect({x:px,y:py,width:pw,height:13,fill:'#0a1a28',cornerRadius:[4,4,0,0]}));
        this._staticGroup.add(new Konva.Text({x:px+4,y:py+2,width:pw-8,text:'驱动控制',fontSize:8,fontStyle:'bold',fill:'#80cbc4',align:'center'}));

        const bW=(pw-24)/7, bH=18, bY=py+16;
        [['▶ 使能', '#1a3a1a','#2e7d32','#66bb6a',()=>this.enable()],
         ['■ 禁能', '#3a1a1a','#c62828','#ef5350',()=>this.disable()],
         ['↺ 正转', '#0a1a3a','#1565c0','#64b5f6',()=>{ this._direction=1; this.startRun(); }],
         ['↻ 反转', '#1a0a3a','#6a1b9a','#ce93d8',()=>{ this._direction=-1; this.startRun(); }],
         ['■ 停止', '#1a1a1a','#455a64','#78909c',()=>this.stopRun()],
         ['→| 单步', '#1a1a0a','#f57f17','#ffd54f',()=>this.singleStep()],
         ['↺ 清零', '#001a1a','#006064','#80cbc4',()=>this.resetPosition()],
        ].forEach(([lbl,fill,stroke,col,cb],i)=>{
            const bx=px+4+i*(bW+2);
            const btn=new Konva.Rect({x:bx,y:bY,width:bW,height:bH,fill,stroke,strokeWidth:1.5,cornerRadius:3});
            const t=new Konva.Text({x:bx,y:bY+4,width:bW,text:lbl,fontSize:8,fontStyle:'bold',fill:col,align:'center'});
            btn.on('click tap',cb);
            btn.on('mouseenter',()=>btn.opacity(0.75));
            btn.on('mouseleave',()=>btn.opacity(1));
            this._interactGroup.add(btn,t);
        });

        // 励磁模式选择
        const modeBtns=[
            {lbl:'整步单相',mode:'full_single'},
            {lbl:'整步双相',mode:'full_dual'},
            {lbl:'半步',    mode:'half'},
            {lbl:'微步',    mode:'micro'},
        ];
        const mbW=(pw-24)/5, mbY=bY+bH+6;
        this._staticGroup.add(new Konva.Text({x:px+4,y:mbY-10,text:'励磁方式：',fontSize:7.5,fill:'#546e7a'}));
        this._modeBtns={};
        modeBtns.forEach(({lbl,mode},i)=>{
            const bx=px+80+i*(mbW+3);
            const active=this.driveMode===mode;
            const btn=new Konva.Rect({x:bx,y:mbY,width:mbW,height:15,fill:active?'#1a3a1a':'#0d1520',stroke:active?'#66bb6a':'#1a3040',strokeWidth:1,cornerRadius:3});
            const t=new Konva.Text({x:bx,y:mbY+3,width:mbW,text:lbl,fontSize:8,fill:active?'#66bb6a':'#37474f',align:'center'});
            btn.on('click tap',()=>this.setDriveMode(mode));
            this._modeBtns[mode]={btn,t};
            this._interactGroup.add(btn,t);
        });

        // 细分选择
        const micros=[1,2,4,8,16,32,64,128,256];
        const mW=(pw-24)/9-1, mY=mbY+22;
        this._staticGroup.add(new Konva.Text({x:px+4,y:mY-10,text:'细分数：',fontSize:7.5,fill:'#546e7a'}));
        this._microBtns={};
        micros.forEach((m,i)=>{
            const bx=px+56+i*(mW+2);
            const active=this.microSteps===m;
            const btn=new Konva.Rect({x:bx,y:mY,width:mW,height:14,fill:active?'#1a1a0a':'#0d1520',stroke:active?'#ffa726':'#1a3040',strokeWidth:1,cornerRadius:2});
            const t=new Konva.Text({x:bx,y:mY+2,width:mW,text:`${m}`,fontSize:7.5,fill:active?'#ffa726':'#37474f',align:'center'});
            btn.on('click tap',()=>this.setMicroSteps(m));
            this._microBtns[m]={btn,t};
            this._interactGroup.add(btn,t);
        });

        // 脉冲频率 + 负载滑块
        const sliders=[
            {label:`脉冲频率 f（当前 ${this._stepFreq}Hz）`, key:'freq', color:'#ffa726',
             getR:()=>this._stepFreq/(this.maxSpeed*this.stepsPerRev/60),
             set:r=>{this._stepFreq=Math.max(1,r*this.maxSpeed*this.stepsPerRev/60);}, disp:()=>`${Math.round(this._stepFreq)}Hz`},
            {label:`负载转矩（保持 ${this.holdingTorque}N·m）`, key:'load', color:'#ef9a9a',
             getR:()=>this._loadTorque/this.holdingTorque,
             set:r=>{this._loadTorque=r*this.holdingTorque;}, disp:()=>`${this._loadTorque.toFixed(3)}N·m`},
        ];
        const slW=(pw-24)/2-28;
        this._sliderBars={};
        sliders.forEach(({label,key,color,getR,set,disp},si)=>{
            const slX=px+4+si*(slW+40), slY=py+ph-18;
            this._staticGroup.add(new Konva.Text({x:slX,y:slY-11,text:label,fontSize:7,fill:'#546e7a'}));
            this._staticGroup.add(new Konva.Rect({x:slX,y:slY,width:slW,height:8,fill:'#0a0a18',cornerRadius:2}));
            const bar=new Konva.Rect({x:slX,y:slY,width:0,height:8,fill:color,cornerRadius:2});
            const txt=new Konva.Text({x:slX+slW+4,y:slY-2,width:44,text:'--',fontSize:8,fontFamily:'Courier New, monospace',fill:color});
            const hit=new Konva.Rect({x:slX,y:slY-2,width:slW,height:12,fill:'transparent'});
            hit.on('click tap mousedown',e=>{
                const stage=this.group.getStage?.();
                const pos=stage?.getPointerPosition?.()??{x:e.evt?.clientX??0};
                set(Math.max(0,Math.min(1,(pos.x-(this.group.x?.()??0)-slX)/slW)));
            });
            this._interactGroup.add(bar,txt,hit);
            this._sliderBars[key]={bar,txt,slW,getR,disp};
        });
    }

    // ── 波形区 ─────────────────────────────
    _drawWaveform() {
        const { _wavX: wx, _wavY: wy, _wavW: ww, _wavH: wh } = this;
        if (wh < 14) return;

        this._staticGroup.add(new Konva.Rect({x:wx,y:wy,width:ww,height:wh,fill:'#010d18',stroke:'#1a3040',strokeWidth:1.5,cornerRadius:4}));
        this._staticGroup.add(new Konva.Rect({x:wx,y:wy,width:ww,height:12,fill:'#0a1a28',cornerRadius:[4,4,0,0]}));
        this._staticGroup.add(new Konva.Text({x:wx+4,y:wy+1,width:ww-8,text:'A相电流 iA   B相电流 iB   电磁转矩 T   位置误差（失步检测）',fontSize:8,fill:'#80cbc4',align:'center'}));

        const nCh=4, hCh=(wh-12)/nCh;
        this._wavMids=Array.from({length:nCh},(_,i)=>wy+12+hCh*(i+0.5));
        this._wavMids.forEach(my=>this._staticGroup.add(new Konva.Line({points:[wx+2,my,wx+ww-2,my],stroke:'rgba(200,200,200,0.06)',strokeWidth:0.5,dash:[4,3]})));

        this._wLIA  =new Konva.Line({points:[],stroke:'#e53935',strokeWidth:1.8,lineJoin:'round'});
        this._wLIB  =new Konva.Line({points:[],stroke:'#43a047',strokeWidth:1.8,lineJoin:'round'});
        this._wLTq  =new Konva.Line({points:[],stroke:'#ffd54f',strokeWidth:1.5,lineJoin:'round'});
        this._wLErr =new Konva.Line({points:[],stroke:'#ef5350',strokeWidth:1.5,lineJoin:'round'});

        ['iA','iB','T(N·m)','误差'].forEach((l,i)=>{
            this._staticGroup.add(new Konva.Text({x:wx+4,y:wy+12+hCh*i+3,text:l,fontSize:8,fill:['#e53935','#43a047','#ffd54f','#ef5350'][i]}));
        });
        this._staticGroup.add(this._wLIA, this._wLIB, this._wLTq, this._wLErr);
        this._wavHCh=hCh;
    }

    // ═══════════════════════════════════════════
    // 集中化 tick（由 consys._tickAll 在 20fps 调用）
    tick(dt) {
        this._tickPulseGen(dt);
        this._tickPhysics(dt);
        this._tickRotorViz();
        this._tickFieldViz(dt);
        this._tickExcitationTable();
        this._tickTFPoint();
        this._tickPhasorViz();
        this._tickPositionTrace();
        this._tickOutOfStep();
        this._tickWaveform();
        this._tickDisplay();
        this._refreshCache();
    }

    // ── 脉冲发生器（连续运行时）────────────
    _tickPulseGen(dt) {
        if (!this._enabled) return;
        if (!this._running && !this._singleStep) return;

        if (this._singleStep) {
            this._advanceStep(this._direction);
            this._singleStep = false;
            return;
        }

        this._stepTimer += dt;
        const stepPeriod = 1.0 / this._stepFreq;
        while (this._stepTimer >= stepPeriod) {
            this._stepTimer -= stepPeriod;
            this._advanceStep(this._direction);
        }
    }

    // 推进一个微步
    _advanceStep(dir) {
        const totalSteps = this._getSeqLength() * this.microSteps;
        this._microIdx = ((this._microIdx + dir + totalSteps*100) % totalSteps);
        this._cmdSteps += dir;
        this._cmdPulses = Math.round(this._cmdSteps / this.microSteps); // 等效整步数
        // 目标电角度（每整步 90°电角）
        this._thetaETarget = this._cmdSteps * (Math.PI / 2) / this.microSteps;
    }

    _getSeqLength() {
        if (this.driveMode === 'half') return 8;
        return 4;
    }

    // 获取当前微步的 iA/iB 给定（归一化 ±1）
    _getCurrentIref() {
        const totalSteps = this._getSeqLength() * this.microSteps;
        const idx = ((this._microIdx % totalSteps) + totalSteps) % totalSteps;

        if (this.driveMode === 'micro') {
            // 正弦/余弦微步
            const angle = (idx / totalSteps) * Math.PI * 2;
            return { iA: Math.cos(angle), iB: Math.sin(angle) };
        }

        const seqLen = this._getSeqLength();
        const seqIdx = Math.floor(idx / this.microSteps) % seqLen;
        const fracIdx= (idx % this.microSteps) / this.microSteps;

        let seq;
        if      (this.driveMode === 'full_single') seq = this._seqFull;
        else if (this.driveMode === 'full_dual')   seq = this._seqFullDual;
        else                                       seq = this._seqHalf;

        const cur  = seq[seqIdx];
        const next = seq[(seqIdx + 1) % seqLen];

        if (this.microSteps > 1) {
            // 在相邻步之间线性插值（近似微步）
            return {
                iA: cur[0] + (next[0]-cur[0]) * fracIdx,
                iB: cur[1] + (next[1]-cur[1]) * fracIdx,
            };
        }
        return { iA: cur[0], iB: cur[1] };
    }

    // ── 物理仿真（转子动力学 + 电流响应）───
    _tickPhysics(dt) {
        this._animPhase += dt * 4;

        if (!this._enabled) {
            // 断电：制齿转矩（微小保持）+ 粘性阻尼
            const detentSign = -Math.sin(this._thetaMech * this.rotorTeeth) * this.detentTorque;
            const drag = this.B * this._omegaMech + detentSign;
            this._omegaMech *= Math.exp(-drag/this.J*dt*5);
            this._thetaMech += this._omegaMech * dt;
            this._iA = this._iB = 0;
            this.torqueEM = 0;
            this._vibration = 0;
            this._updateWavBufs();
            return;
        }

        // 获取给定电流
        const ref = this._getCurrentIref();
        this._iAref = ref.iA * this.ratedCurrent;
        this._iBref = ref.iB * this.ratedCurrent;

        // 相电压（恒流斩波：简化为直接给定电流，含 L/R 动态）
        const omegaE = this._omegaMech * this.rotorTeeth;  // 电角速度
        const bemfA  = this.Ke * omegaE * Math.cos(this._thetaE);
        const bemfB  = this.Ke * omegaE * Math.sin(this._thetaE);
        this._uA     = this._iAref * this.phaseR + bemfA;
        this._uB     = this._iBref * this.phaseR + bemfB;

        // 电流一阶响应（斩波驱动时间常数比 L/R 短得多）
        const tauChop = Math.min(this.tauE, 1.0/this.chopFreq*10);
        this._iA += (this._iAref - this._iA) * (1 - Math.exp(-dt/tauChop));
        this._iB += (this._iBref - this._iB) * (1 - Math.exp(-dt/tauChop));

        // 电磁转矩（T = Kt × is × sin(θe_target - θe_actual)）
        // θe_actual = thetaMech × rotorTeeth（转子电角度）
        this._thetaE  = this._thetaMech * this.rotorTeeth;
        const deltaTheta = this._thetaETarget - this._thetaE;
        this.torqueEM = this.Kt * this.ratedCurrent * Math.sin(deltaTheta);

        // 失步判断：电角偏差 > π/2 时可能失步
        const absErr = Math.abs(deltaTheta % (Math.PI * 2));
        const normErr= absErr > Math.PI ? 2*Math.PI - absErr : absErr;
        this._elecAngleErr = normErr;
        this._outOfStep    = normErr > Math.PI * 0.85;
        if (this._outOfStep) this._lostSteps++;

        // 共振（接近共振频率时振动增大）
        const freqRatio = this._stepFreq / (this.resonFreq || 1);
        const resonAmp  = 1.0 / Math.sqrt((1 - freqRatio*freqRatio)**2 + (0.15*freqRatio)**2);
        this._vibration = Math.min(1, resonAmp * 0.05) * Math.abs(this.torqueEM);
        this._vibPhase += dt * this.resonFreq * 2 * Math.PI;

        // 机械方程
        const vibrateT = this._vibration * Math.sin(this._vibPhase) * this.holdingTorque * 0.15;
        const netTorque= this.torqueEM - this._loadTorque - this.B*this._omegaMech + vibrateT;
        this._omegaMech += netTorque / this.J * dt;
        this._omegaMech  = Math.max(-this.maxSpeed*2*Math.PI/60, Math.min(this.maxSpeed*2*Math.PI/60, this._omegaMech));
        this._thetaMech += this._omegaMech * dt;

        this._updateWavBufs();
    }

    _updateWavBufs() {
        const actSteps = this._thetaMech / (2*Math.PI) * this.stepsPerRev;
        this._wavIA    = new Float32Array([...this._wavIA.slice(1), this._iA]);
        this._wavIB    = new Float32Array([...this._wavIB.slice(1), this._iB]);
        this._wavTq    = new Float32Array([...this._wavTq.slice(1), this.torqueEM]);
        this._wavPos   = new Float32Array([...this._wavPos.slice(1), actSteps]);
        this._wavPosCmd= new Float32Array([...this._wavPosCmd.slice(1), this._cmdPulses]);
        this._wavVib   = new Float32Array([...this._wavVib.slice(1), this._vibration]);
    }

    // ── 转子旋转（小齿动画）────────────────
    _tickRotorViz() {
        const ecx = this._motCX, ecy = this._motCY;
        const th   = this._thetaMech;

        // 参考点旋转
        if (this._rotorRefDot) {
            const rR = this._rotorR;
            this._rotorRefDot.x(ecx + rR*0.60*Math.cos(th));
            this._rotorRefDot.y(ecy + rR*0.60*Math.sin(th));
        }

        // 转子小齿（动态绘制）
        this._teethGroup.destroyChildren();
        const nTeeth  = this.rotorTeeth;
        const rInner  = this._rotorR * 0.86;
        const rOuter  = this._rotorR * 0.97;
        const toothW  = 0.5 * Math.PI / nTeeth * 0.55;

        for (let i = 0; i < nTeeth; i++) {
            const a    = th + (i/nTeeth)*Math.PI*2;
            const cos1 = Math.cos(a-toothW), sin1 = Math.sin(a-toothW);
            const cos2 = Math.cos(a+toothW), sin2 = Math.sin(a+toothW);
            this._teethGroup.add(new Konva.Line({
                points: [
                    ecx+rInner*cos1, ecy+rInner*sin1,
                    ecx+rOuter*cos1, ecy+rOuter*sin1,
                    ecx+rOuter*cos2, ecy+rOuter*sin2,
                    ecx+rInner*cos2, ecy+rInner*sin2,
                ],
                closed: true,
                fill: '#78909c', stroke: '#37474f', strokeWidth: 0.5,
            }));
        }
    }

    // ── 磁场动画 ─────────────────────────────
    _tickFieldViz(dt) {
        this._fieldGroup.destroyChildren();
        if (!this._enabled || (Math.abs(this._iA) < 0.05 && Math.abs(this._iB) < 0.05)) return;

        const ecx = this._motCX, ecy = this._motCY;
        const r0  = this._rotorR * 0.97;
        const r1  = this._sInner * 0.95;

        // 合成磁场方向
        const isMag = Math.sqrt(this._iA**2 + this._iB**2);
        if (isMag < 0.01) return;
        const fieldAngle = Math.atan2(this._iB, this._iA);

        // 磁力线（从 N 极流向 S 极，沿磁场方向）
        const nLines = 6;
        for (let i = 0; i < nLines; i++) {
            const spread = (i - nLines/2 + 0.5) / nLines * Math.PI * 0.5;
            const a      = fieldAngle + spread;
            const alpha  = Math.max(0.04, 0.35*(1-Math.abs(spread)*2/Math.PI)*(isMag/this.ratedCurrent));
            const col    = spread < 0 ? `rgba(239,154,154,${alpha})` : `rgba(144,202,249,${alpha})`;
            this._fieldGroup.add(new Konva.Line({
                points: [ecx+r0*Math.cos(a), ecy+r0*Math.sin(a),
                         ecx+r1*Math.cos(a), ecy+r1*Math.sin(a)],
                stroke: col, strokeWidth: 1.5, lineCap: 'round',
            }));
        }

        // 磁通粒子（沿合成磁场方向流动）
        const nPart = 8;
        for (let i = 0; i < nPart; i++) {
            const t     = ((this._animPhase*0.06 + i/nPart) % 1 + 1) % 1;
            const rPart = r0 + t*(r1-r0);
            const aOff  = (Math.random()-0.5)*0.25;
            this._fieldGroup.add(new Konva.Circle({
                x: ecx + rPart*Math.cos(fieldAngle+aOff),
                y: ecy + rPart*Math.sin(fieldAngle+aOff),
                radius: 2 + (isMag/this.ratedCurrent)*1.5,
                fill: `rgba(255,213,79,${0.2+isMag/this.ratedCurrent*0.35})`,
            }));
        }

        // 绕组高亮（随通电状态）
        this._statorPoles.forEach(({ wRect, angle }) => {
            // 判断该极是否在磁场方向上
            const dotProd = Math.cos(angle - fieldAngle);
            const alpha   = Math.max(0.1, dotProd * 0.6 * isMag/this.ratedCurrent);
            wRect.opacity(alpha);
        });
    }

    // ── 励磁序列表更新 ──────────────────────
    _tickExcitationTable() {
        const seqLen   = this._getSeqLength();
        const totalSt  = seqLen * this.microSteps;
        const curSeqIdx= Math.floor(((this._microIdx % totalSt)+totalSt)%totalSt / this.microSteps) % seqLen;

        let seq;
        if      (this.driveMode==='full_single') seq=this._seqFull;
        else if (this.driveMode==='full_dual')   seq=this._seqFullDual;
        else if (this.driveMode==='half')        seq=this._seqHalf;
        else {
            // 微步：显示当前角度对应的 cos/sin 值
            seq = Array.from({length:8},(_,i)=>{
                const a=(i/8)*Math.PI*2;
                return [+(Math.cos(a).toFixed(2)), +(Math.sin(a).toFixed(2))];
            });
        }

        const displayLen = Math.min(8, seq.length);
        for (let i = 0; i < 8; i++) {
            const row = this._seqRows[i];
            if (!row) continue;
            if (i < displayLen) {
                const [iA, iB] = seq[i];
                row.tIA.text((iA >= 0 ? '+' : '') + iA.toFixed(2));
                row.tIB.text((iB >= 0 ? '+' : '') + iB.toFixed(2));
                const active = (i === curSeqIdx);
                row.bg.fill(active ? 'rgba(255,213,79,0.12)' : 'rgba(0,0,0,0)');
                row.dot.fill(active ? '#ffd54f' : '#263238');
                row.dot.radius(active ? 6 : 5);
                row.tIA.fill(iA > 0 ? '#ef9a9a' : iA < 0 ? '#90caf9' : '#546e7a');
                row.tIB.fill(iB > 0 ? '#a5d6a7' : iB < 0 ? '#ce93d8' : '#546e7a');
            } else {
                row.bg.fill('rgba(0,0,0,0)');
                row.dot.fill('#0d1520');
                row.tIA.text('--'); row.tIB.text('--');
            }
        }
        if (this._seqPointer) {
            this._seqPointer.y(this._seqRowsY + curSeqIdx * this._seqRowH + 2);
        }
    }

    // ── T-F 工作点 ───────────────────────────
    _tickTFPoint() {
        if (!this._tfPoint) return;
        const T_pullout = this._calcPullOutTorque(this._stepFreq);
        const fx = this._tfOX + (this._stepFreq/this._tfFMax)*this._tfAW;
        const ty = this._tfOY - (Math.abs(this.torqueEM)/this.holdingTorque)*(this._tfAH-4);
        this._tfPoint.x(Math.max(this._tfOX, Math.min(this._tfOX+this._tfAW, fx)));
        this._tfPoint.y(Math.max(this._tfY+14, Math.min(this._tfOY, ty)));
        // 颜色：接近失步线=橙，超过=红
        const margin = T_pullout - Math.abs(this.torqueEM);
        this._tfPoint.fill(margin<0?'#ef5350':margin<T_pullout*0.2?'#ffa726':'#66bb6a');
    }

    // ── 相量图更新 ────────────────────────────
    _tickPhasorViz() {
        if (!this._pvIA) return;
        const ocx=this._pvOCX, ocy=this._pvOCY, R=this._pvR;
        const scl = R / this.ratedCurrent;

        this._pvIA.points([ocx,ocy, ocx+this._iA*scl, ocy]);
        this._pvIB.points([ocx,ocy, ocx, ocy-this._iB*scl]);
        this._pvIs.points([ocx,ocy, ocx+this._iA*scl, ocy-this._iB*scl]);

        // 转子磁极方向（电角度）
        const rA = this._thetaE % (Math.PI*2);
        this._pvRotor.points([ocx,ocy, ocx+R*0.65*Math.cos(rA), ocy-R*0.65*Math.sin(rA)]);
    }

    // ── 位置跟踪更新 ─────────────────────────
    _tickPositionTrace() {
        if (!this._ptCmdLine) return;
        const n=this._wavLen, aw=this._ptAW, ah=this._ptAH;
        const ox=this._ptOX, oy=this._ptOY;
        const wx=ox+1, dx=aw/n;

        const maxSteps = Math.max(10, Math.abs(this._cmdPulses)*1.2, 200);
        const ptCmd=[], ptAct=[], ptErr=[];
        for (let i=0;i<n;i++) {
            const x=wx+i*dx;
            ptCmd.push(x, oy-(this._wavPosCmd[i]/maxSteps)*(ah-4));
            ptAct.push(x, oy-(this._wavPos[i]  /maxSteps)*(ah-4));
            const err=this._wavPosCmd[i]-this._wavPos[i];
            ptErr.push(x, oy-(err/maxSteps)*(ah-4)*2);
        }
        this._ptCmdLine.points(ptCmd);
        this._ptActLine.points(ptAct);
        this._ptErrLine.points(ptErr);
    }

    // ── 失步检测面板更新 ─────────────────────
    _tickOutOfStep() {
        if (!this._osNeedle) return;

        // 电角度偏差指针（半圆量表，0=正常，180°=完全失步）
        const errDeg = (this._elecAngleErr || 0) * 180/Math.PI;
        const needleAngle = Math.PI - (errDeg/180)*Math.PI; // 从右到左转动
        const R = this._osR;
        this._osNeedle.points([
            this._osCX, this._osCY,
            this._osCX + R*0.85*Math.cos(needleAngle),
            this._osCY - R*0.85*Math.sin(needleAngle),
        ]);
        this._osAngleLabel?.text(`${errDeg.toFixed(1)}°`);
        this._osAngleLabel?.fill(errDeg>90?'#ef5350':errDeg>45?'#ffa726':'#66bb6a');

        // 状态文字
        if (this._osStatusText) {
            this._osStatusText.text(this._outOfStep ? '✗ 失步!' : '✓ 正常');
            this._osStatusText.fill(this._outOfStep ? '#ef5350' : '#66bb6a');
        }
        if (this._osStatusBg) {
            this._osStatusBg.fill(this._outOfStep ? '#2d0505' : '#0d1520');
            this._osStatusBg.stroke(this._outOfStep ? '#ef5350' : '#1a3040');
        }
        if (this._osLostLabel) this._osLostLabel.text(`失步:${this._lostSteps}次`);

        // 振动指示条
        const vibNorm = Math.min(1, this._vibration / (this.holdingTorque * 0.3));
        if (this._osVibBar) this._osVibBar.width(vibNorm * this._osVibBarW);
        if (this._osVibBar) this._osVibBar.fill(vibNorm>0.7?'#ef5350':vibNorm>0.4?'#ffa726':'#ffd54f');

        // 共振警告
        const fRatio = this._stepFreq / (this.resonFreq||1);
        const nearRes = fRatio > 0.8 && fRatio < 1.2;
        if (this._osResWarn) {
            this._osResWarn.text(nearRes ? `⚠ 接近共振频率 ${this.resonFreq.toFixed(0)}Hz！` : '');
        }
    }

    // ── 波形更新 ─────────────────────────────
    _tickWaveform() {
        if (!this._wavHCh || !this._wavMids) return;
        const wx=this._wavX+3, ww=this._wavW-6, n=this._wavLen;
        const dx=ww/n, hCh=this._wavHCh;
        const [mIA,mIB,mT,mE]=this._wavMids;

        const iPk = this.ratedCurrent*1.2;
        const tPk = this.holdingTorque*1.1;
        const ePk = this.stepsPerRev*2;

        const ptIA=[], ptIB=[], ptTq=[], ptErr=[];
        for (let i=0;i<n;i++) {
            const x=wx+i*dx;
            ptIA.push(x, mIA-(this._wavIA[i]/iPk)*hCh*0.38);
            ptIB.push(x, mIB-(this._wavIB[i]/iPk)*hCh*0.38);
            ptTq.push(x, mT -(this._wavTq[i]/tPk)*hCh*0.38);
            const err=this._wavPosCmd[i]-this._wavPos[i];
            ptErr.push(x, mE -(Math.max(-ePk,Math.min(ePk,err))/ePk)*hCh*0.38);
        }
        this._wLIA.points(ptIA); this._wLIB.points(ptIB);
        this._wLTq.points(ptTq); this._wLErr.points(ptErr);
    }

    // ── 仪表更新 ─────────────────────────────
    _tickDisplay() {
        const c=this._lcdCells;
        if (!c) return;

        const actSteps = Math.round(this._thetaMech/(2*Math.PI)*this.stepsPerRev);
        const posDeg   = this._thetaMech*180/Math.PI;
        const spd      = this._omegaMech*60/(2*Math.PI);
        const seqLen   = this._getSeqLength()*this.microSteps;

        if (c.cmdStep) c.cmdStep.text(this._cmdPulses.toString());
        if (c.actStep) c.actStep.text(actSteps.toString());
        if (c.posDeg)  c.posDeg.text(posDeg.toFixed(2));
        if (c.spd)     c.spd.text(Math.abs(spd).toFixed(1));
        if (c.freq)    c.freq.text(Math.round(this._stepFreq).toString());
        if (c.tq) {
            c.tq.text(this.torqueEM.toFixed(3));
            c.tq.fill(Math.abs(this.torqueEM)>this.holdingTorque*0.9?'#ef5350':'#ef9a9a');
        }
        if (c.ia)      c.ia.text(this._iA.toFixed(3));
        if (c.ib)      c.ib.text(this._iB.toFixed(3));
        if (c.lost) {
            c.lost.text(this._lostSteps.toString());
            c.lost.fill(this._lostSteps>0?'#ef5350':'#66bb6a');
        }
        if (c.step)    c.step.text(`${((this._microIdx%seqLen)+seqLen)%seqLen+1}/${seqLen}`);
        if (c.micro)   c.micro.text(this.microSteps.toString());
        if (c.en)  {
            c.en.text(this._enabled?'✓ 使能':'✗ 禁能');
            c.en.fill(this._enabled?'#66bb6a':'#ef5350');
        }

        if (this._sliderBars) {
            Object.values(this._sliderBars).forEach(({bar,txt,slW,getR,disp})=>{
                bar.width(Math.min(slW,Math.max(0,getR())*slW));
                txt.text(disp());
            });
        }
    }

    // ═══════════════════════════════════════════
    enable() {
        this._enabled = true;
    }

    disable() {
        this._enabled  = false;
        this._running  = false;
        this._iA = this._iB = 0;
    }

    startRun() {
        if (this._enabled) { this._running=true; this._stepTimer=0; }
    }

    stopRun() {
        this._running = false;
    }

    singleStep() {
        if (this._enabled) this._singleStep = true;
    }

    resetPosition() {
        this._cmdPulses  = 0;
        this._cmdSteps   = 0;
        this._microIdx   = 0;
        this._thetaMech  = 0;
        this._thetaE     = 0;
        this._thetaETarget=0;
        this._lostSteps  = 0;
        this._omegaMech  = 0;
    }

    setDriveMode(mode) {
        this.driveMode = mode;
        if (mode==='half')  this.microSteps=1;
        if (mode==='micro') this.microSteps=Math.max(4, this.microSteps);
        this._microIdx=0;
        // 更新按钮样式
        Object.entries(this._modeBtns||{}).forEach(([m,{btn,t}])=>{
            const on=m===mode;
            btn.fill(on?'#1a3a1a':'#0d1520');
            btn.stroke(on?'#66bb6a':'#1a3040');
            t.fill(on?'#66bb6a':'#37474f');
        });
        this._refreshCache();
    }

    setMicroSteps(n) {
        this.microSteps = n;
        if (n>1) this.driveMode='micro';
        this._microIdx=0;
        Object.entries(this._microBtns||{}).forEach(([m,{btn,t}])=>{
            const on=parseInt(m)===n;
            btn.fill(on?'#1a1a0a':'#0d1520');
            btn.stroke(on?'#ffa726':'#1a3040');
            t.fill(on?'#ffa726':'#37474f');
        });
        this._refreshCache();
    }

    setFrequency(hz) {
        this._stepFreq = Math.max(1, Math.min(this.maxSpeed*this.stepsPerRev/60, hz));
        this._refreshCache();
    }

    setLoad(T) {
        this._loadTorque = Math.max(0, Math.min(this.holdingTorque*1.5, T));
        this._refreshCache();
    }

    setDirection(dir) {
        this._direction = dir >= 0 ? 1 : -1;
    }

    pulse(n=1) {
        for (let i=0;i<n;i++) this._advanceStep(this._direction);
    }

    getPosition()  { return this._thetaMech*180/Math.PI; }
    getStepCount() { return this._cmdPulses; }
    isOutOfStep()  { return this._outOfStep; }

    update(cfg={}) {
        if (cfg.freq !==undefined) this.setFrequency(cfg.freq);
        if (cfg.load !==undefined) this.setLoad(cfg.load);
        if (cfg.micro!==undefined) this.setMicroSteps(cfg.micro);
        this._refreshCache();
    }

    getConfigFields() {
        return [
            {label:'位号/名称',          key:'id',            type:'text'},
            {label:'供电电压 (V)',        key:'ratedVoltage',  type:'number'},
            {label:'额定电流/相 (A)',     key:'ratedCurrent',  type:'number'},
            {label:'保持转矩 (N·m)',      key:'holdingTorque', type:'number'},
            {label:'步距角 (°)',          key:'stepAngle',     type:'number'},
            {label:'相电阻 R (Ω)',        key:'phaseR',        type:'number'},
            {label:'相电感 L (mH)',       key:'phaseL',        type:'number'},
            {label:'转子齿数',           key:'rotorTeeth',    type:'number'},
            {label:'转动惯量 J (kg·m²)', key:'J',             type:'number'},
            {label:'最高转速 (rpm)',      key:'maxSpeed',      type:'number'},
            {label:'细分数',             key:'microSteps',    type:'number'},
            {label:'初始频率 (Hz)',       key:'initFreq',      type:'number'},
        ];
    }

    onConfigUpdate(cfg) {
        this.id           = cfg.id           || this.id;
        this.ratedVoltage = parseFloat(cfg.ratedVoltage) || this.ratedVoltage;
        this.ratedCurrent = parseFloat(cfg.ratedCurrent) || this.ratedCurrent;
        this.holdingTorque= parseFloat(cfg.holdingTorque)|| this.holdingTorque;
        this.stepAngle    = parseFloat(cfg.stepAngle)    || this.stepAngle;
        this.phaseR       = parseFloat(cfg.phaseR)       || this.phaseR;
        this.phaseL       = (parseFloat(cfg.phaseL)||this.phaseL*1000)*1e-3;
        this.rotorTeeth   = parseInt(cfg.rotorTeeth)     || this.rotorTeeth;
        this.J            = parseFloat(cfg.J)            || this.J;
        this.maxSpeed     = parseFloat(cfg.maxSpeed)     || this.maxSpeed;
        this.microSteps   = parseInt(cfg.microSteps)     || this.microSteps;
        this._stepFreq    = parseFloat(cfg.initFreq)     || this._stepFreq;
        this.stepsPerRev  = Math.round(360/this.stepAngle);
        this.tauE         = this.phaseL/this.phaseR;
        this.Kt           = this.holdingTorque/this.ratedCurrent;
        this.Ks           = this.holdingTorque*this.rotorTeeth;
        this.resonFreq    = (1/(2*Math.PI))*Math.sqrt(this.Ks/this.J);
        this.config       = {...this.config,...cfg};
        this._refreshCache();
    }

    destroy() {
        super.destroy?.();
    }
}