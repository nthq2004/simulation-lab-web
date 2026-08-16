import { BaseComponent } from './BaseComponent.js';

/**
 * 旋转变压器（Resolver）仿真组件
 * 带气压驱动转子 + RDC（Resolver-to-Digital Converter）集成
 *
 * ── 工作原理 ──────────────────────────────────────────────────
 *  旋转变压器是一种精密角位置传感器，基于电磁耦合原理：
 *
 *  1. 激励绕组（Excitation / Reference Winding）：
 *     定子上安装单相激励绕组，通入交流激励电压：
 *       V_ref = V₀ × sin(ω_c × t)     （载波频率 ω_c，通常 400~10000 Hz）
 *
 *  2. 输出绕组（Output Windings）：
 *     定子上安装两组空间正交（相差90°）的输出绕组。
 *     转子角位移 θ 通过电磁耦合改变输出：
 *
 *       V_sin = K × V₀ × sin(ω_c × t) × sin(θ)
 *       V_cos = K × V₀ × sin(ω_c × t) × cos(θ)
 *
 *     其中 K 为变压器系数（通常 0.5~1.0）
 *
 *  3. 角度解算：
 *     arctan(V_sin / V_cos) = θ     （解调后）
 *
 * ── 气压驱动 ─────────────────────────────────────────────────
 *  气压输入 P（kPa）→ 气缸/气动执行机构 → 机械角位移 θ：
 *       θ = θ_min + (P - P_min) / (P_max - P_min) × (θ_max - θ_min)
 *  典型量程：P = 20~100 kPa → θ = 0~360°（或 0~±180°）
 *
 * ── RDC 集成（Resolver-to-Digital Converter）─────────────────
 *  RDC 将模拟正余弦信号转换为数字角度值：
 *  内部采用跟踪型二阶环路（Type II tracking loop）：
 *    1. 将输入 V_sin、V_cos 乘以本地数字角 Φ
 *    2. 形成误差信号：e = V_sin × cos(Φ) - V_cos × sin(Φ)
 *                        = K × V₀ × sin(θ - Φ) × sin(ω_c t)
 *    3. 相敏解调 → e_dc = K × V₀ × sin(θ - Φ)
 *    4. 驱动积分器调整 Φ → θ（跟踪收敛）
 *    5. 输出：12/14/16 位二进制角度码
 *
 * ── 组件结构 ──────────────────────────────────────────────────
 *  ① 气压驱动腔（左侧，膜片/活塞示意）
 *  ② 旋转变压器截面（定子+转子+绕组）
 *     - 定子激励绕组（橙色，水平）
 *     - 定子正弦输出绕组（蓝色，垂直）
 *     - 定子余弦输出绕组（绿色，水平）
 *     - 转子绕组（随气压旋转）
 *  ③ 旋转角度指示（指针+刻度盘）
 *  ④ RDC 模块（数字解算输出）
 *  ⑤ 波形示波器（激励/正弦/余弦三路波形）
 *  ⑥ 各绕组磁耦合动画
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  pipe_p_in    — 气压输入（驱动转子）
 *  wire_ref_p   — 激励电压正极 V_ref+
 *  wire_ref_n   — 激励电压负极 V_ref−
 *  wire_sin_p   — 正弦输出正极 V_sin+
 *  wire_sin_n   — 正弦输出负极 V_sin−
 *  wire_cos_p   — 余弦输出正极 V_cos+
 *  wire_cos_n   — 余弦输出负极 V_cos−
 *  wire_rdc_a   — RDC 数字输出 A（MSB）
 *  wire_rdc_b   — RDC 数字输出 B（LSB）
 */
export class ResolverTransducer extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(480, config.width  || 560);
        this.height = Math.max(340, config.height || 400);

        this.type    = 'resolver_transducer';
        this.special = 'press';
        this.cache   = 'fixed';

        // ── 参数 ──
        this.excFreq       = config.excFreq       || 400;   // 激励载波频率 Hz
        this.excAmplitude  = config.excAmplitude  || 5.0;   // 激励电压幅值 V（峰值）
        this.transformRatio= config.transformRatio|| 0.8;   // 变压器系数 K
        this.pressMin      = config.pressMin      || 20;    // 最小气压 kPa
        this.pressMax      = config.pressMax      || 100;   // 最大气压 kPa
        this.angleMin      = config.angleMin      || 0;     // 最小角度 °
        this.angleMax      = config.angleMax      || 360;   // 最大角度 °
        this.rdcBits       = config.rdcBits       || 14;    // RDC 分辨率 bit
        this.mechTimeConst = config.mechTimeConst || 0.3;   // 机械时间常数 s（气动响应）

        // ── 状态 ──
        this.pressure      = config.initPressure  || this.pressMin;  // 当前气压 kPa
        this._manualPress  = config.initPressure  || this.pressMin;
        this.theta         = 0;   // 当前角位移 rad
        this._thetaSmooth  = 0;   // 平滑角度（跟随气压）
        this._thetaDeg     = 0;   // 角度（°）

        this.vRef          = 0;   // 瞬时激励电压
        this.vSin          = 0;   // 瞬时正弦输出
        this.vCos          = 0;   // 瞬时余弦输出
        this.sinAmplitude  = 0;   // 正弦包络幅值
        this.cosAmplitude  = 0;   // 余弦包络幅值

        // RDC 输出
        this.rdcAngle      = 0;   // RDC 解算角度 °
        this._rdcTracking  = 0;   // RDC 跟踪角（内部）
        this.rdcCode       = 0;   // RDC 数字码
        this.rdcError      = 0;   // 跟踪误差

        this.powered       = true;
        this.isBreak       = false;

        // ── 动画 ──
        this._time         = 0;
        this._phase        = 0;
        this._couplingPhase= 0;
        this._rdcConvergePhase = 0;

        // ── 波形缓冲 ──
        this._wavLen       = 240;
        this._wavRef       = new Float32Array(this._wavLen).fill(0);
        this._wavSin       = new Float32Array(this._wavLen).fill(0);
        this._wavCos       = new Float32Array(this._wavLen).fill(0);
        this._wavTheta     = new Float32Array(this._wavLen).fill(0);
        this._wavAcc       = 0;

        // ── 拖拽 ──
        this._dragActive   = false;
        this._dragStartY   = 0;
        this._dragStartP   = 0;

        // ── 几何布局 ──
        // 气压驱动腔（最左）
        this._cylX    = 6;
        this._cylY    = Math.round(this.height * 0.28);
        this._cylW    = Math.round(this.width  * 0.11);
        this._cylH    = Math.round(this.height * 0.48);

        // 旋转变压器主体（中左）
        this._resCX   = Math.round(this.width  * 0.34);
        this._resCY   = Math.round(this.height * 0.42);
        this._resRo   = Math.round(Math.min(this.width * 0.16, this.height * 0.32));  // 定子外径
        this._resRi   = Math.round(this._resRo * 0.62);  // 转子半径

        // 角度刻度盘（变压器右侧）
        this._dialCX  = this._resCX;
        this._dialCY  = this._resCY;

        // RDC 模块（右侧）
        this._rdcX    = Math.round(this.width  * 0.60);
        this._rdcY    = Math.round(this.height * 0.06);
        this._rdcW    = Math.round(this.width  * 0.18);
        this._rdcH    = Math.round(this.height * 0.60);

        // LCD 仪表（最右）
        this._lcdX    = this._rdcX + this._rdcW + 8;
        this._lcdY    = this._rdcY;
        this._lcdW    = this.width - this._lcdX - 8;
        this._lcdH    = Math.round(this.height * 0.50);

        // 波形示波器（底部）
        this._wavX    = 8;
        this._wavY    = Math.round(this.height * 0.72);
        this._wavW    = this.width - 16;
        this._wavH    = this.height - this._wavY - 6;

        this._lastTs  = null;
        this._animId  = null;
        this.knobs    = {};

        this.config = {
            id: this.id, excFreq: this.excFreq,
            pressMin: this.pressMin, pressMax: this.pressMax,
            angleMin: this.angleMin, angleMax: this.angleMax,
        };

        this._init();

        // 端口
        this.addPort(0,           this._cylY + this._cylH/2, 'p_in',   'pipe', '气压');
        this.addPort(0,           this._resCY - 24,           'ref_p',  'wire', 'REF+');
        this.addPort(0,           this._resCY - 6,            'ref_n',  'wire', 'REF−');
        this.addPort(0,           this._resCY + 12,           'sin_p',  'wire', 'SIN+');
        this.addPort(0,           this._resCY + 30,           'sin_n',  'wire', 'SIN−');
        this.addPort(this.width,  this._resCY + 12,           'cos_p',  'wire', 'COS+');
        this.addPort(this.width,  this._resCY + 30,           'cos_n',  'wire', 'COS−');
        this.addPort(this.width,  this._rdcY + this._rdcH/2 - 10, 'rdc_a', 'wire', 'RDC-A');
        this.addPort(this.width,  this._rdcY + this._rdcH/2 + 10, 'rdc_b', 'wire', 'RDC-B');
    }

    // ═══════════════════════════════════════════
    _init() {
        this._drawLabel();
        this._drawPneumaticCylinder();
        this._drawPushRod();
        this._drawResolverHousing();
        this._drawStatorWindings();
        this._drawRotorGroup();
        this._drawAngleDial();
        this._drawCouplingFieldLayer();
        this._drawInstrHead();
        this._drawLCD();
        this._drawRDCModule();
        this._drawWaveform();
        this._drawBottomPanel();
        this._setupDrag();
        this._startAnimation();
    }

    _drawLabel() {
        this.group.add(new Konva.Text({
            x: 0, y: -22, width: this.width,
            text: '旋转变压器（Resolver）— 气压驱动 · 正余弦输出 · RDC 集成',
            fontSize: 12, fontStyle: 'bold', fill: '#1a2634', align: 'center',
        }));
    }

    // ── 气压驱动腔 ────────────────────────────
    _drawPneumaticCylinder() {
        const cx2 = this._cylX, cy2 = this._cylY, cw = this._cylW, ch = this._cylH;

        // 气缸外壳
        const body = new Konva.Rect({ x: cx2, y: cy2, width: cw, height: ch, fill: '#37474f', stroke: '#263238', strokeWidth: 2, cornerRadius: 4 });
        // 气腔背景
        this._cylCav = new Konva.Rect({ x: cx2+4, y: cy2+4, width: cw-8, height: ch-8, fill: '#0a1a28', cornerRadius: 2 });
        // 顶底端盖
        const topCap = new Konva.Rect({ x: cx2-3, y: cy2-6, width: cw+6, height: 8, fill: '#546e7a', stroke: '#37474f', strokeWidth: 1, cornerRadius: 2 });
        const botCap = new Konva.Rect({ x: cx2-3, y: cy2+ch-2, width: cw+6, height: 8, fill: '#546e7a', stroke: '#37474f', strokeWidth: 1, cornerRadius: 2 });

        // 气压进口（左侧）
        this.group.add(new Konva.Rect({ x: cx2-14, y: cy2+ch/2-6, width: 14, height: 12, fill: '#607d8b', stroke: '#455a64', strokeWidth: 1 }));
        this.group.add(new Konva.Text({ x: cx2-28, y: cy2+ch/2-14, text: '气压\n进口', fontSize: 7.5, fill: '#80cbc4', lineHeight: 1.3 }));

        // 活塞（动态位置）
        this._piston = new Konva.Rect({ x: cx2+4, y: cy2+4, width: cw-8, height: 18, fill: '#78909c', stroke: '#546e7a', strokeWidth: 1, cornerRadius: 2 });
        // 活塞高压区（活塞下方压缩气体，动态颜色）
        this._pressureZone = new Konva.Rect({ x: cx2+4, y: cy2+22, width: cw-8, height: 0, fill: 'rgba(79,195,247,0.18)', cornerRadius: 1 });

        // 气压数值标注
        this._pressLabel = new Konva.Text({ x: cx2, y: cy2+ch+10, width: cw, text: `${this.pressMin}kPa`, fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#4fc3f7', align: 'center' });

        // 标注
        this.group.add(new Konva.Text({ x: cx2, y: cy2-20, width: cw, text: '气动\n驱动', fontSize: 8, fontStyle: 'bold', fill: '#80cbc4', align: 'center', lineHeight: 1.3 }));

        this.group.add(body, topCap, botCap, this._cylCav, this._pressureZone, this._piston, this._pressLabel);
    }

    // ── 推杆（气缸→变压器转子）───────────────
    _drawPushRod() {
        // 传动杆（水平，连接气缸输出与变压器输入）
        this._pushRod = new Konva.Line({
            points: [this._cylX + this._cylW, this._resCY,
                     this._resCX - this._resRo - 6, this._resCY],
            stroke: '#90a4ae', strokeWidth: 3, lineCap: 'round',
        });
        // 连杆标注
        this.group.add(new Konva.Text({
            x: this._cylX + this._cylW + 2, y: this._resCY - 14,
            text: '机械传动', fontSize: 7.5, fill: '#78909c',
        }));
        this.group.add(this._pushRod);
    }

    // ── 旋转变压器外壳 ────────────────────────
    _drawResolverHousing() {
        const cx2 = this._resCX, cy2 = this._resCY, Ro = this._resRo;

        // 外壳圆环
        this.group.add(new Konva.Circle({ x: cx2, y: cy2, radius: Ro + 12, fill: '#455a64', stroke: '#263238', strokeWidth: 2.5 }));
        // 内壁
        this.group.add(new Konva.Circle({ x: cx2, y: cy2, radius: Ro, fill: '#0d1a28' }));
        // 外壳高光
        this.group.add(new Konva.Arc({ x: cx2, y: cy2, innerRadius: Ro+4, outerRadius: Ro+10, angle: 70, rotation: -150, fill: 'rgba(255,255,255,0.08)' }));
        // 安装耳
        for (let i = 0; i < 4; i++) {
            const a = (i/4)*Math.PI*2 + Math.PI/4;
            this.group.add(new Konva.Circle({ x: cx2+(Ro+9)*Math.cos(a), y: cy2+(Ro+9)*Math.sin(a), radius: 5, fill: '#37474f', stroke: '#263238', strokeWidth: 0.5 }));
        }
        // 铭牌
        this.group.add(new Konva.Rect({ x: cx2-22, y: cy2+Ro*0.6, width: 44, height: 14, fill: '#1e2a36', cornerRadius: 2 }));
        this.group.add(new Konva.Text({ x: cx2-22, y: cy2+Ro*0.6+2, width: 44, text: 'RESOLVER', fontSize: 7.5, fill: 'rgba(255,255,255,0.35)', align: 'center' }));

        // 标注
        this.group.add(new Konva.Text({ x: cx2-Ro, y: cy2-Ro-22, width: Ro*2, text: '旋转变压器', fontSize: 9, fontStyle: 'bold', fill: '#80cbc4', align: 'center' }));
    }

    // ── 定子绕组（三组）──────────────────────
    _drawStatorWindings() {
        const cx2 = this._resCX, cy2 = this._resCY, Ro = this._resRo, Ri = this._resRi;
        const midR = (Ro + Ri) / 2 + 2;

        // ── 激励绕组（橙色，水平方向 0°/180°）──
        for (let side of [-1, 1]) {
            const baseAngle = side > 0 ? 0 : Math.PI;
            for (let t = 0; t < 4; t++) {
                const a1 = baseAngle - 0.25 + t * 0.13;
                this.group.add(new Konva.Arc({
                    x: cx2, y: cy2, innerRadius: midR-4, outerRadius: midR+4,
                    angle: 12, rotation: a1*180/Math.PI - 90,
                    fill: 'none', stroke: '#ff8f00', strokeWidth: 2.5, opacity: 0.8,
                }));
            }
        }
        this.group.add(new Konva.Text({ x: cx2+Ro+14, y: cy2-6, text: 'REF\n激励', fontSize: 7.5, fill: '#ff8f00', lineHeight: 1.3 }));

        // ── 正弦输出绕组（蓝色，垂直方向 90°/270°）──
        for (let side of [-1, 1]) {
            const baseAngle = side > 0 ? Math.PI/2 : -Math.PI/2;
            for (let t = 0; t < 4; t++) {
                const a1 = baseAngle - 0.25 + t * 0.13;
                this.group.add(new Konva.Arc({
                    x: cx2, y: cy2, innerRadius: midR-4, outerRadius: midR+4,
                    angle: 12, rotation: a1*180/Math.PI - 90,
                    fill: 'none', stroke: '#42a5f5', strokeWidth: 2.5, opacity: 0.8,
                }));
            }
        }
        this.group.add(new Konva.Text({ x: cx2-Ro-42, y: cy2-6, text: 'SIN\n正弦', fontSize: 7.5, fill: '#42a5f5', lineHeight: 1.3 }));

        // ── 余弦输出绕组（绿色，水平方向，与激励正交90°）──
        // 余弦绕组与正弦绕组空间相差90°（位于45°处）
        for (let side of [-1, 1]) {
            const baseAngle = side > 0 ? Math.PI/4 : -Math.PI*3/4;
            for (let t = 0; t < 4; t++) {
                const a1 = baseAngle - 0.22 + t * 0.12;
                this.group.add(new Konva.Arc({
                    x: cx2, y: cy2, innerRadius: midR-3, outerRadius: midR+3,
                    angle: 10, rotation: a1*180/Math.PI - 90,
                    fill: 'none', stroke: '#66bb6a', strokeWidth: 2, opacity: 0.7,
                }));
            }
        }
        this.group.add(new Konva.Text({ x: cx2+Ro+14, y: cy2+10, text: 'COS\n余弦', fontSize: 7.5, fill: '#66bb6a', lineHeight: 1.3 }));
    }

    // ── 转子组（随气压旋转）────────────────
    _drawRotorGroup() {
        const cx2 = this._resCX, cy2 = this._resCY, Ri = this._resRi;

        this._rotorGroup = new Konva.Group({ x: cx2, y: cy2 });

        // 转子铁芯
        const core = new Konva.Circle({ radius: Ri, fill: '#546e7a', stroke: '#37474f', strokeWidth: 1.5 });
        // 转子绕组（两极，耦合线圈）
        for (let i = 0; i < 2; i++) {
            const a = i * Math.PI;
            const winding = new Konva.Arc({
                innerRadius: Ri*0.45, outerRadius: Ri*0.88,
                angle: 70, rotation: a*180/Math.PI - 35,
                fill: 'none', stroke: '#ffd54f', strokeWidth: 3, opacity: 0.85,
            });
            this._rotorGroup.add(winding);
        }
        // 转子轴（中心圆点）
        this._rotorGroup.add(new Konva.Circle({ radius: Ri*0.10, fill: '#263238', stroke: '#1a2634', strokeWidth: 1.5 }));
        // 转子参考线（指示当前角度）
        this._rotorRef = new Konva.Line({ points: [0, 0, Ri*0.78, 0], stroke: '#ffd54f', strokeWidth: 2.5, lineCap: 'round' });
        this._rotorGroup.add(core, this._rotorRef);

        this.group.add(this._rotorGroup);
    }

    // ── 角度刻度盘 ───────────────────────────
    _drawAngleDial() {
        const cx2 = this._resCX, cy2 = this._resCY, R = this._resRo;
        const dialR = R + 6;

        // 刻度线
        for (let deg = 0; deg < 360; deg += 10) {
            const isMaj = deg % 30 === 0;
            const rad   = (deg - 90) * Math.PI / 180;
            const r1 = dialR, r2 = dialR + (isMaj ? 7 : 4);
            this.group.add(new Konva.Line({
                points: [cx2+r1*Math.cos(rad), cy2+r1*Math.sin(rad), cx2+r2*Math.cos(rad), cy2+r2*Math.sin(rad)],
                stroke: '#546e7a', strokeWidth: isMaj ? 1.5 : 0.8,
            }));
            if (isMaj) {
                const lr = r2 + 8;
                this.group.add(new Konva.Text({ x: cx2+lr*Math.cos(rad)-8, y: cy2+lr*Math.sin(rad)-5, width: 16, text: deg.toString(), fontSize: 7, fill: '#607d8b', align: 'center' }));
            }
        }

        // 指针（随转子转动）
        this._dialPointer = new Konva.Arrow({
            points: [cx2, cy2, cx2 + dialR, cy2],
            stroke: '#ef5350', fill: '#ef5350',
            strokeWidth: 1.5, pointerLength: 5, pointerWidth: 4,
        });
        // 角度标注
        this._dialAngleLbl = new Konva.Text({ x: cx2-20, y: cy2+dialR+12, width: 40, text: '0.0°', fontSize: 9.5, fontFamily: 'Courier New, monospace', fontStyle: 'bold', fill: '#ef5350', align: 'center' });

        this.group.add(this._dialPointer, this._dialAngleLbl);
    }

    // ── 磁耦合场动画层 ───────────────────────
    _drawCouplingFieldLayer() {
        this._coupGroup = new Konva.Group();
        this.group.add(this._coupGroup);
    }

    // ── 仪表头（右上）────────────────────────
    _drawInstrHead() {
        const hx = this._lcdX, hy = this._lcdY;
        const hw = this._lcdW, hh = Math.round(this._lcdH * 0.38);

        const jBox = new Konva.Rect({ x: hx, y: hy, width: hw, height: 44, fill: '#cfd8dc', stroke: '#90a4ae', strokeWidth: 1.5, cornerRadius: [5,5,0,0] });
        for (let i = 0; i < 3; i++) this.group.add(new Konva.Line({ points: [hx, hy+7+i*10, hx+hw, hy+7+i*10], stroke: 'rgba(255,255,255,0.14)', strokeWidth: 0.8 }));
        const plate = new Konva.Rect({ x: hx+7, y: hy+4, width: hw-14, height: 27, fill: '#eceff1', stroke: '#b0bec5', strokeWidth: 0.5, cornerRadius: 2 });
        this._idText = new Konva.Text({ x: hx+7, y: hy+7, width: hw-14, text: this.id || 'RSVR-01', fontSize: 9, fontStyle: 'bold', fill: '#263238', align: 'center' });
        this.group.add(new Konva.Text({ x: hx+7, y: hy+17, width: hw-14, text: `${this.excFreq}Hz  ${this.rdcBits}bit`, fontSize: 7, fill: '#78909c', align: 'center' }));
        this.group.add(new Konva.Text({ x: hx+7, y: hy+27, width: hw-14, text: 'RESOLVER', fontSize: 7, fill: '#90a4ae', align: 'center' }));
        const body = new Konva.Rect({ x: hx, y: hy+44, width: hw, height: this._lcdH-44, fill: '#1e2a36', stroke: '#0d1520', strokeWidth: 1.5, cornerRadius: [0,0,4,4] });

        // 端子标签
        [['COS+','#66bb6a',18],['COS−','#388e3c',38]].forEach(([lbl,col,ty]) => {
            this.group.add(new Konva.Text({ x: hx+6, y: hy+ty+44-7+2, text: lbl, fontSize: 9, fontStyle: 'bold', fill: col }));
        });
        [['RDC-A','#ffd54f',18],['RDC-B','#ffd54f',38]].forEach(([lbl,col,ty]) => {
            this.group.add(new Konva.Text({ x: hx+6, y: hy+ty+44+20, text: lbl, fontSize: 9, fontStyle: 'bold', fill: col }));
        });

        this.group.add(jBox, plate, this._idText, body);
    }

    // ── 圆形 LCD ─────────────────────────────
    _drawLCD() {
        const hx = this._lcdX, hw = this._lcdW;
        const lcy = this._lcdY + 44 + (this._lcdH - 44) * 0.52;
        const lcx = hx + hw / 2;
        const R   = Math.min(hw * 0.40, 38);
        this._lcCX = lcx; this._lcCY = lcy; this._lcR = R;

        this.group.add(new Konva.Circle({ x: lcx, y: lcy, radius: R+4, fill: '#0d1520', stroke: '#1a252f', strokeWidth: 1 }));
        const ring = new Konva.Circle({ x: lcx, y: lcy, radius: R+2, fill: '#001a00', stroke: '#1b5e20', strokeWidth: 2.5 });
        this._lcdBg = new Konva.Circle({ x: lcx, y: lcy, radius: R, fill: '#020c14' });

        this._angleArc = new Konva.Arc({ x: lcx, y: lcy, innerRadius: R-5, outerRadius: R-3, angle: 0, fill: '#4dd0e1', rotation: -90 });
        this._lcdMain  = new Konva.Text({ x: lcx-R+4, y: lcy-R*.40, width:(R-4)*2, text:'0.0',   fontSize:R*.40, fontFamily:'Courier New, monospace', fontStyle:'bold', fill:'#4dd0e1', align:'center' });
        this._lcdUnit  = new Konva.Text({ x: lcx-R+4, y: lcy+R*.08, width:(R-4)*2, text:'°',     fontSize:R*.20, fill:'#001a00', align:'center' });
        this._lcdPress = new Konva.Text({ x: lcx-R+4, y: lcy+R*.28, width:(R-4)*2, text:'P=--',  fontSize:R*.13, fontFamily:'Courier New, monospace', fill:'#37474f', align:'center' });
        this._lcdFreq  = new Konva.Text({ x: lcx-R+4, y: lcy-R*.62, width:(R-4)*2, text:'--Hz',  fontSize:R*.13, fontFamily:'Courier New, monospace', fill:'#80cbc4', align:'center' });
        this._lcdRDC   = new Konva.Text({ x: lcx-R+4, y: lcy+R*.46, width:(R-4)*2, text:'RDC:0', fontSize:R*.12, fontFamily:'Courier New, monospace', fill:'#263238', align:'center' });

        this.group.add(ring, this._lcdBg, this._angleArc, this._lcdMain, this._lcdUnit, this._lcdPress, this._lcdFreq, this._lcdRDC);
    }

    // ── RDC 模块 ─────────────────────────────
    _drawRDCModule() {
        const rx = this._rdcX, ry = this._rdcY, rw = this._rdcW, rh = this._rdcH;

        const bg = new Konva.Rect({ x: rx, y: ry, width: rw, height: rh, fill: '#0a1520', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 4 });
        const titleBg = new Konva.Rect({ x: rx, y: ry, width: rw, height: 16, fill: '#0c2040', cornerRadius: [4,4,0,0] });
        this.group.add(new Konva.Text({ x: rx+2, y: ry+3, width: rw-4, text: 'RDC 解算器', fontSize: 8.5, fontStyle: 'bold', fill: '#4fc3f7', align: 'center' }));
        this.group.add(new Konva.Text({ x: rx+2, y: ry+11, width: rw-4, text: `${this.rdcBits}-bit`, fontSize: 7, fill: '#37474f', align: 'center' }));

        // 输入端（SIN/COS 信号输入）
        const inY = ry + 24;
        ['SIN 输入', 'COS 输入'].forEach((lbl, i) => {
            this.group.add(new Konva.Rect({ x: rx+4, y: inY+i*16, width: rw-8, height: 13, fill: '#0d2030', cornerRadius: 2 }));
            this.group.add(new Konva.Text({ x: rx+5, y: inY+i*16+2, text: lbl, fontSize: 8, fill: '#4fc3f7' }));
        });
        this._rdcSinVal = new Konva.Text({ x: rx+4, y: inY+2, width: rw-8, text: '', fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#42a5f5', align: 'right' });
        this._rdcCosVal = new Konva.Text({ x: rx+4, y: inY+18, width: rw-8, text: '', fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#66bb6a', align: 'right' });

        // 跟踪环路可视化
        const trackY = ry + 62;
        this.group.add(new Konva.Rect({ x: rx+4, y: trackY, width: rw-8, height: 30, fill: '#020c14', stroke: '#1a3040', strokeWidth: 0.8, cornerRadius: 2 }));
        this.group.add(new Konva.Text({ x: rx+5, y: trackY+2, text: '跟踪环路', fontSize: 7, fill: '#546e7a' }));
        // 跟踪误差条
        this.group.add(new Konva.Rect({ x: rx+5, y: trackY+12, width: rw-10, height: 8, fill: '#0d2030', cornerRadius: 2 }));
        this._rdcErrorBar = new Konva.Rect({ x: rx + rw/2, y: trackY+13, width: 0, height: 6, fill: '#ef5350', cornerRadius: 1 });
        this._rdcErrorBarNeg = new Konva.Rect({ x: rx + rw/2, y: trackY+13, width: 0, height: 6, fill: '#ef5350', cornerRadius: 1 });
        this.group.add(new Konva.Line({ points: [rx+rw/2, trackY+12, rx+rw/2, trackY+20], stroke: '#37474f', strokeWidth: 1 }));  // 零点线

        // 输出显示
        const outY = trackY + 36;
        this.group.add(new Konva.Rect({ x: rx+4, y: outY, width: rw-8, height: 40, fill: '#020c14', stroke: '#1a3040', strokeWidth: 0.8, cornerRadius: 2 }));
        this.group.add(new Konva.Text({ x: rx+5, y: outY+2, text: '数字输出', fontSize: 7, fill: '#ffd54f' }));
        this._rdcAngleDisp  = new Konva.Text({ x: rx+4, y: outY+12, width: rw-8, text: '0000H', fontSize: 10, fontFamily: 'Courier New, monospace', fontStyle: 'bold', fill: '#ffd54f', align: 'center' });
        this._rdcAngleDeg   = new Konva.Text({ x: rx+4, y: outY+26, width: rw-8, text: '0.000°', fontSize: 9, fontFamily: 'Courier New, monospace', fill: '#ffd54f', align: 'center' });

        // 精度标注
        const resolutionDeg = 360 / Math.pow(2, this.rdcBits);
        this.group.add(new Konva.Text({ x: rx+4, y: outY+40, width: rw-8, text: `分辨率: ${resolutionDeg.toFixed(3)}°`, fontSize: 7, fill: '#546e7a', align: 'center' }));

        // 速度输出（d/dt）
        const velY = outY + 54;
        this.group.add(new Konva.Rect({ x: rx+4, y: velY, width: rw-8, height: 22, fill: '#020c14', stroke: '#1a3040', strokeWidth: 0.8, cornerRadius: 2 }));
        this.group.add(new Konva.Text({ x: rx+5, y: velY+2, text: 'dθ/dt', fontSize: 7, fill: '#80cbc4' }));
        this._rdcVelDisp = new Konva.Text({ x: rx+4, y: velY+10, width: rw-8, text: '0 rpm', fontSize: 8.5, fontFamily: 'Courier New, monospace', fill: '#80cbc4', align: 'center' });

        this.group.add(bg, titleBg, this._rdcSinVal, this._rdcCosVal, this._rdcErrorBar, this._rdcErrorBarNeg, this._rdcAngleDisp, this._rdcAngleDeg, this._rdcVelDisp);
    }

    // ── 波形示波器（底部，四路）───────────────
    _drawWaveform() {
        const { _wavX: wx, _wavY: wy, _wavW: ww, _wavH: wh } = this;
        if (wh < 16) return;

        const bg = new Konva.Rect({ x: wx, y: wy, width: ww, height: wh, fill: '#010d18', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 4 });
        const titleBg = new Konva.Rect({ x: wx, y: wy, width: ww, height: 13, fill: '#0a1a28', cornerRadius: [4,4,0,0] });
        this.group.add(new Konva.Text({ x: wx+4, y: wy+2, width: ww-8, text: 'REF(载波)  SIN输出  COS输出  θ(t)角度', fontSize: 8, fontStyle: 'bold', fill: '#4dd0e1', align: 'center' }));

        const h4 = (wh-13) / 4;
        this._wavMids = [wy+13+h4*0.5, wy+13+h4*1.5, wy+13+h4*2.5, wy+13+h4*3.5];
        this._wavMids.forEach(my => {
            this.group.add(new Konva.Line({ points: [wx+2, my, wx+ww-2, my], stroke: 'rgba(200,200,200,0.08)', strokeWidth: 0.5, dash: [4,3] }));
        });

        this._wLineRef   = new Konva.Line({ points: [], stroke: '#ff8f00', strokeWidth: 1.5, lineJoin: 'round' });
        this._wLineSin   = new Konva.Line({ points: [], stroke: '#42a5f5', strokeWidth: 1.6, lineJoin: 'round' });
        this._wLineCos   = new Konva.Line({ points: [], stroke: '#66bb6a', strokeWidth: 1.6, lineJoin: 'round' });
        this._wLineTheta = new Konva.Line({ points: [], stroke: '#4dd0e1', strokeWidth: 1.8, lineJoin: 'round' });

        const cols = ['#ff8f00','#42a5f5','#66bb6a','#4dd0e1'];
        const lbls = ['REF','SIN','COS','θ'];
        lbls.forEach((lbl, i) => {
            this.group.add(new Konva.Text({ x: wx+4, y: wy+13+h4*i+4, text: lbl, fontSize: 8, fill: cols[i] }));
        });

        this._wRefLbl   = new Konva.Text({ x: wx+ww-80, y: wy+13+4, width: 76, text: '0.0V', fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#ff8f00', align: 'right' });
        this._wSinLbl   = new Konva.Text({ x: wx+ww-80, y: wy+13+h4+4, width: 76, text: '0.0V', fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#42a5f5', align: 'right' });
        this._wCosLbl   = new Konva.Text({ x: wx+ww-80, y: wy+13+h4*2+4, width: 76, text: '0.0V', fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#66bb6a', align: 'right' });
        this._wThetaLbl = new Konva.Text({ x: wx+ww-80, y: wy+13+h4*3+4, width: 76, text: '0.0°', fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#4dd0e1', align: 'right' });

        this.group.add(bg, titleBg, this._wLineRef, this._wLineSin, this._wLineCos, this._wLineTheta, this._wRefLbl, this._wSinLbl, this._wCosLbl, this._wThetaLbl);
        this._wavH4 = h4;
    }

    // ── 底部状态面板 ─────────────────────────
    _drawBottomPanel() {
        // pass — 状态信息在LCD中显示
    }

    // ── 拖拽（气缸区域调节气压）──────────────
    _setupDrag() {
        const hit = new Konva.Rect({ x: this._cylX-14, y: this._cylY, width: this._cylW+20, height: this._cylH, fill: 'transparent', listening: true });
        hit.on('mousedown touchstart', e => {
            e.cancelBubble = true;
            this._dragStartY = e.evt.clientY ?? e.evt.touches?.[0]?.clientY ?? 0;
            this._dragStartP = this._manualPress;
            this._dragActive = true;
        });
        const mv = e => {
            if (!this._dragActive) return;
            const cy2 = e.clientY ?? e.touches?.[0]?.clientY ?? 0;
            const range = this.pressMax - this.pressMin;
            this._manualPress = Math.max(this.pressMin, Math.min(this.pressMax, this._dragStartP + (this._dragStartY - cy2) * (range / this._cylH)));
        };
        const up = () => { this._dragActive = false; };
        window.addEventListener('mousemove', mv);
        window.addEventListener('touchmove', mv, { passive: true });
        window.addEventListener('mouseup', up);
        window.addEventListener('touchend', up);
        this.group.add(hit);
    }

    // ═══════════════════════════════════════════
    _startAnimation() {
        const tick = ts => {
            if (this._lastTs !== null) {
                const dt = Math.min((ts - this._lastTs) / 1000, 0.05);
                this._tickPhysics(dt);
                this._tickPneumaticViz();
                this._tickRotorViz();
                this._tickCouplingField();
                this._tickRDC(dt);
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

    // ── 物理计算 ─────────────────────────────
    _tickPhysics(dt) {
        this.pressure = this._manualPress;

        // 气压→角度映射（一阶滞后，模拟气动响应延迟）
        const pressNorm = (this.pressure - this.pressMin) / (this.pressMax - this.pressMin);
        const thetaTarget = (this.angleMin + pressNorm * (this.angleMax - this.angleMin)) * Math.PI / 180;
        this._thetaSmooth += (thetaTarget - this._thetaSmooth) * Math.min(1, dt / this.mechTimeConst);
        this.theta    = this._thetaSmooth;
        this._thetaDeg= this.theta * 180 / Math.PI;

        // 激励信号
        const omega_c = 2 * Math.PI * this.excFreq;
        this.vRef = this.excAmplitude * Math.sin(omega_c * this._time);

        // 输出信号（调幅）
        const K = this.transformRatio;
        this.sinAmplitude = K * this.excAmplitude * Math.sin(this.theta);
        this.cosAmplitude = K * this.excAmplitude * Math.cos(this.theta);
        this.vSin = this.sinAmplitude * Math.sin(omega_c * this._time);
        this.vCos = this.cosAmplitude * Math.sin(omega_c * this._time);

        this._time      += dt;
        this._phase     += dt * 4;
        this._couplingPhase += dt * 6;

        // 角度弧（LCD）
        if (this._angleArc) {
            const ratio = Math.min(1, Math.abs(this._thetaDeg) / 360);
            this._angleArc.angle(ratio * 360);
        }
    }

    // ── 气缸可视化 ───────────────────────────
    _tickPneumaticViz() {
        const pressNorm = (this.pressure - this.pressMin) / (this.pressMax - this.pressMin);
        const pistonTravel = this._cylH - 26;  // 活塞行程
        const pistonY = this._cylY + 4 + pistonTravel * (1 - pressNorm);

        if (this._piston) this._piston.y(pistonY);
        if (this._pressureZone) {
            const zoneTop = pistonY + 18;
            const zoneBot = this._cylY + this._cylH - 4;
            const zH = Math.max(0, zoneBot - zoneTop);
            this._pressureZone.y(zoneTop);
            this._pressureZone.height(zH);
            const r = Math.round(20 + pressNorm*40), b = Math.round(150 + pressNorm*100);
            this._pressureZone.fill(`rgba(${r},${Math.round(100+pressNorm*95)},${b},${0.12+pressNorm*0.25})`);
        }
        if (this._pressLabel) this._pressLabel.text(`${this.pressure.toFixed(1)}kPa`);

        // 推杆跟随气缸位置
        if (this._pushRod) {
            const pressNorm2 = (this.pressure - this.pressMin) / (this.pressMax - this.pressMin);
            const rodY = this._cylY + 4 + 9 + (1 - pressNorm2) * (this._cylH - 26) + 9;  // 推杆在活塞中心高度
            // 气缸→变压器的推杆（视觉上固定水平，轴向位移通过活塞内联机构传递旋转）
            // 此处仅高亮推杆
            const intensity = 0.3 + pressNorm2 * 0.4;
            this._pushRod.stroke(`rgba(144,164,174,${intensity})`);
        }
    }

    // ── 转子旋转 ─────────────────────────────
    _tickRotorViz() {
        if (this._rotorGroup) this._rotorGroup.rotation(this._thetaDeg);

        // 拨针
        const r = this._resRo + 6;
        const needleAngle = (this._thetaDeg - 90) * Math.PI / 180;
        if (this._dialPointer) {
            const cx2 = this._resCX, cy2 = this._resCY;
            this._dialPointer.points([cx2, cy2, cx2 + r * Math.cos(needleAngle), cy2 + r * Math.sin(needleAngle)]);
        }
        if (this._dialAngleLbl) this._dialAngleLbl.text(`${this._thetaDeg.toFixed(1)}°`);
    }

    // ── 耦合磁场可视化 ───────────────────────
    _tickCouplingField() {
        this._coupGroup.destroyChildren();
        const cx2 = this._resCX, cy2 = this._resCY, Ri = this._resRi;

        // 交变磁通（调幅波的强度，随正余弦分量变化）
        const refPhase = Math.abs(Math.sin(this._couplingPhase));
        const sinComp  = Math.abs(this.sinAmplitude / this.excAmplitude);
        const cosComp  = Math.abs(this.cosAmplitude / this.excAmplitude);

        // 正弦分量（垂直方向磁通线）
        for (let i = -2; i <= 2; i++) {
            const alpha = sinComp * refPhase * 0.5;
            this._coupGroup.add(new Konva.Line({
                points: [cx2 + i * Ri*0.18, cy2 - Ri*0.7, cx2 + i * Ri*0.18, cy2 + Ri*0.7],
                stroke: `rgba(66,165,245,${alpha * 0.7})`, strokeWidth: 1.5, dash: [3,3],
            }));
        }
        // 余弦分量（水平方向磁通线）
        for (let i = -2; i <= 2; i++) {
            const alpha = cosComp * refPhase * 0.5;
            this._coupGroup.add(new Konva.Line({
                points: [cx2 - Ri*0.7, cy2 + i * Ri*0.18, cx2 + Ri*0.7, cy2 + i * Ri*0.18],
                stroke: `rgba(102,187,106,${alpha * 0.7})`, strokeWidth: 1.5, dash: [3,3],
            }));
        }
    }

    // ── RDC 跟踪解算 ─────────────────────────
    _tickRDC(dt) {
        // RDC 跟踪型二阶环路
        const error = this.theta - this._rdcTracking;
        // 归一化误差（避免2π跳变）
        const eNorm = Math.atan2(Math.sin(error), Math.cos(error));
        this._rdcTracking += eNorm * Math.min(1, dt * 20);  // 跟踪带宽约20 rad/s

        this.rdcAngle = this._rdcTracking * 180 / Math.PI;
        this.rdcError = eNorm * 180 / Math.PI;

        // 数字码（14bit，0~16383对应0~360°）
        const normalizedAngle = ((this.rdcAngle % 360) + 360) % 360;
        this.rdcCode = Math.round(normalizedAngle / 360 * (Math.pow(2, this.rdcBits) - 1));

        // 速度（数字微分）
        this._rdcPrevAngle = this._rdcPrevAngle ?? this.rdcAngle;
        const rdcVelDeg = (this.rdcAngle - this._rdcPrevAngle) / dt;
        this._rdcPrevAngle = this.rdcAngle;
        this._rdcVelRPM = rdcVelDeg / 6;  // °/s → rpm

        // 更新 RDC 面板
        if (this._rdcSinVal) this._rdcSinVal.text(`${this.sinAmplitude.toFixed(3)}V`);
        if (this._rdcCosVal) this._rdcCosVal.text(`${this.cosAmplitude.toFixed(3)}V`);

        if (this._rdcErrorBar) {
            const errPx = Math.min(this._rdcW/2 - 6, Math.abs(this.rdcError) * 0.5);
            if (this.rdcError >= 0) {
                this._rdcErrorBar.width(errPx);
                this._rdcErrorBarNeg.width(0);
            } else {
                this._rdcErrorBar.width(0);
                this._rdcErrorBarNeg.width(errPx);
                this._rdcErrorBarNeg.x(this._rdcX + this._rdcW/2 - errPx);
            }
        }

        if (this._rdcAngleDisp) this._rdcAngleDisp.text(`${this.rdcCode.toString(16).toUpperCase().padStart(4,'0')}H`);
        if (this._rdcAngleDeg)  this._rdcAngleDeg.text(`${this.rdcAngle.toFixed(3)}°`);
        if (this._rdcVelDisp)   this._rdcVelDisp.text(`${Math.abs(this._rdcVelRPM).toFixed(1)} rpm`);
    }

    // ── 波形缓冲 ─────────────────────────────
    _tickWaveform(dt) {
        if (!this._wavH4) return;
        this._wavAcc += 1.5 * dt * this._wavLen;
        const steps = Math.floor(this._wavAcc);
        this._wavAcc -= steps;
        for (let i = 0; i < steps; i++) {
            this._wavRef   = new Float32Array([...this._wavRef.slice(1),   this.vRef]);
            this._wavSin   = new Float32Array([...this._wavSin.slice(1),   this.vSin]);
            this._wavCos   = new Float32Array([...this._wavCos.slice(1),   this.vCos]);
            this._wavTheta = new Float32Array([...this._wavTheta.slice(1), this._thetaDeg]);
        }

        const wx = this._wavX+3, ww = this._wavW-6;
        const n  = this._wavLen, dx = ww / n;
        const h4 = this._wavH4;
        const [mRef, mSin, mCos, mTheta] = this._wavMids;
        const aRef = h4*0.42, aSin = h4*0.42, aCos = h4*0.42, aTheta = h4*0.40;

        const rPts=[], sPts=[], cPts=[], tPts=[];
        for (let i = 0; i < n; i++) {
            const x = wx + i * dx;
            rPts.push(x, mRef   - (this._wavRef[i]   / this.excAmplitude) * aRef);
            sPts.push(x, mSin   - (this._wavSin[i]   / this.excAmplitude) * aSin);
            cPts.push(x, mCos   - (this._wavCos[i]   / this.excAmplitude) * aCos);
            tPts.push(x, mTheta - ((this._wavTheta[i] / 360) * 2 - 1) * aTheta);
        }
        if (this._wLineRef)   this._wLineRef.points(rPts);
        if (this._wLineSin)   this._wLineSin.points(sPts);
        if (this._wLineCos)   this._wLineCos.points(cPts);
        if (this._wLineTheta) this._wLineTheta.points(tPts);

        if (this._wRefLbl)   this._wRefLbl.text(`${this.vRef.toFixed(3)}V`);
        if (this._wSinLbl)   this._wSinLbl.text(`${this.vSin.toFixed(3)}V`);
        if (this._wCosLbl)   this._wCosLbl.text(`${this.vCos.toFixed(3)}V`);
        if (this._wThetaLbl) this._wThetaLbl.text(`${this._thetaDeg.toFixed(2)}°`);
    }

    // ── LCD 刷新 ─────────────────────────────
    _tickDisplay() {
        if (this._lcdMain) this._lcdMain.text(this._thetaDeg.toFixed(1));
        if (this._lcdPress) this._lcdPress.text(`P=${this.pressure.toFixed(1)}kPa`);
        if (this._lcdFreq) this._lcdFreq.text(`${this.excFreq}Hz`);
        if (this._lcdRDC) this._lcdRDC.text(`RDC:${this.rdcCode}`);
    }

    // ═══════════════════════════════════════════
    update(press, flow) {
        if (typeof press === 'number') {
            this._manualPress = Math.max(this.pressMin, Math.min(this.pressMax, press));
        }
        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label: '位号/名称',            key: 'id',            type: 'text'   },
            { label: '激励频率 (Hz)',          key: 'excFreq',       type: 'number' },
            { label: '激励幅值 (V)',           key: 'excAmplitude',  type: 'number' },
            { label: '变压器系数 K',           key: 'transformRatio',type: 'number' },
            { label: '气压下限 (kPa)',         key: 'pressMin',      type: 'number' },
            { label: '气压上限 (kPa)',         key: 'pressMax',      type: 'number' },
            { label: '角度下限 (°)',           key: 'angleMin',      type: 'number' },
            { label: '角度上限 (°)',           key: 'angleMax',      type: 'number' },
            { label: 'RDC 分辨率 (bit)',       key: 'rdcBits',       type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        this.id             = cfg.id             || this.id;
        this.excFreq        = parseFloat(cfg.excFreq)        || this.excFreq;
        this.excAmplitude   = parseFloat(cfg.excAmplitude)   || this.excAmplitude;
        this.transformRatio = parseFloat(cfg.transformRatio) || this.transformRatio;
        this.pressMin       = parseFloat(cfg.pressMin)       ?? this.pressMin;
        this.pressMax       = parseFloat(cfg.pressMax)       || this.pressMax;
        this.angleMin       = parseFloat(cfg.angleMin)       ?? this.angleMin;
        this.angleMax       = parseFloat(cfg.angleMax)       || this.angleMax;
        this.rdcBits        = parseInt(cfg.rdcBits)          || this.rdcBits;
        this.config         = { ...this.config, ...cfg };
        if (this._idText) this._idText.text(this.id);
        this._refreshCache();
    }

    destroy() { this._stopAnimation(); super.destroy?.(); }
}