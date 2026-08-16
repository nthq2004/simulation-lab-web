import { BaseComponent } from './BaseComponent.js';

/**
 * VT20 船用燃油黏度传感器仿真组件
 * （VT20 Marine Fuel Oil Viscosity Sensor）
 *
 * ── 工作原理（旋转钟摆法）───────────────────────────────────
 *  VT20 采用旋转振动式（Torsional Oscillating）测量原理：
 *
 *  驱动压电元件（逆压电效应）：
 *    输入交变电压 V_in = V₀ · sin(ω·t)
 *    → 晶片产生扭转变形
 *    → 驱动中央钟摆（Pendulum）以固定频率 f₀ 作旋转振动
 *
 *  感测压电元件（正压电效应）：
 *    钟摆在燃油中旋转振动
 *    → 燃油黏性阻力产生相位滞后
 *    → 感测晶片受扭转产生输出交变电压 V_out
 *
 *  相位差关系：
 *    φ = φ_out - φ_in    (输出相位 - 输入相位)
 *    η = k · tan(|φ|)    (黏度正比于相位差正切)
 *
 *  更精确的关系（VT20 技术规格）：
 *    φ² ∝ η    （相位差的平方正比于黏度）
 *    即：η = K · φ²
 *
 *  钟摆振动方程（阻尼谐振）：
 *    I·θ̈ + b·η·θ̇ + k·θ = M₀·sin(ω·t)
 *    I   — 惯量矩
 *    b   — 黏性阻力系数
 *    η   — 动力黏度 (mPa·s)
 *    k   — 弹性恢复系数
 *    M₀  — 驱动力矩幅值
 *
 *  稳态解：
 *    θ(t) = A · sin(ω·t - φ)
 *    A = M₀ / √[(k-Iω²)² + (bηω)²]
 *    φ = arctan(bηω / (k-Iω²))
 *
 * ── 组件结构 ─────────────────────────────────────────────────
 *  ① 传感器外壳（浸入燃油管道的探头）
 *  ② 旋转钟摆（中央振子，顶视图）
 *  ③ 驱动压电元件（左侧，输入 V_in，蓝色高亮）
 *  ④ 感测压电元件（右侧，输出 V_out，橙色高亮）
 *  ⑤ 电荷变形动画（两侧晶片交替膨胀/收缩）
 *  ⑥ 双通道波形示波器（V_in + V_out + 相位差标注）
 *  ⑦ 李萨如图（相位差可视化椭圆）
 *  ⑧ 仪表显示（黏度 + 相位差 + 温度修正）
 *  ⑨ 燃油管路（进/出两个流体接口）
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  pipe_in   — 燃油进口
 *  pipe_out  — 燃油出口
 *  wire_drv+ — 驱动电压正极 V_in+
 *  wire_drv- — 驱动电压负极 V_in-
 *  wire_sns+ — 感测电压正极 V_out+
 *  wire_sns- — 感测电压负极 V_out-
 *
 * ── 气路求解器集成 ───────────────────────────────────────────
 *  special = 'none'
 *  update(viscosity) — 外部注入黏度 mPa·s
 */
export class VT20ViscositySensor extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(360, config.width  || 400);
        this.height = Math.max(340, config.height || 380);

        this.type    = 'vt20_viscosity';
        this.special = 'none';
        this.cache   = 'fixed';

        // ── VT20 技术参数 ──
        this.driveFreq    = config.driveFreq    || 200;    // 驱动频率 Hz
        this.driveVoltage = config.driveVoltage || 5.0;    // 驱动电压幅值 V
        this.sensorVoltage= config.sensorVoltage|| 3.0;    // 传感器满量程输出 V
        this.maxViscosity = config.maxViscosity  || 1000;  // 最大黏度 mPa·s
        this.minViscosity = config.minViscosity  || 2;     // 最小黏度 mPa·s
        this.tempC        = config.tempC         || 80;    // 燃油温度 °C

        // 振动方程参数（归一化）
        this._I  = 1.0;    // 惯量矩（归一化）
        this._b  = 0.08;   // 黏性阻力系数
        this._k  = 1.0;    // 弹性系数
        this._M0 = 1.0;    // 驱动力矩幅值

        // ── 状态 ──
        this.viscosity    = config.initViscosity || 50;    // mPa·s
        this._manualVisc  = config.initViscosity || 50;
        this.phaseShift   = 0;   // rad
        this.phaseDeg     = 0;   // °
        this.pendulumAngle= 0;   // rad（当前钟摆角度）
        this.pendulumAmp  = 0;   // 振幅

        // ── 电信号 ──
        this._time        = 0;
        this._omega       = 2 * Math.PI * this.driveFreq;
        this.vIn          = 0;   // 驱动电压（当前瞬时值）
        this.vOut         = 0;   // 感测电压（当前瞬时值）

        // ── 压电元件动画状态 ──
        this._driveDeform = 0;   // 驱动晶片形变量 -1~+1
        this._senseDeform = 0;   // 感测晶片形变量 -1~+1
        this._driveCharge = 0;   // 驱动晶片激励强度
        this._senseCharge = 0;   // 感测晶片感应强度

        // ── 波形缓冲 ──
        this._wavLen      = 240;
        this._wavIn       = new Float32Array(this._wavLen).fill(0);
        this._wavOut      = new Float32Array(this._wavLen).fill(0);
        this._wavAcc      = 0;

        // ── 李萨如缓冲 ──
        this._lissLen     = 300;
        this._lissX       = new Float32Array(this._lissLen).fill(0);
        this._lissY       = new Float32Array(this._lissLen).fill(0);
        this._lissPtr     = 0;

        // ── 拖拽 ──
        this._dragActive  = false;
        this._dragStartY  = 0;
        this._dragStartV  = 0;

        // ── 几何布局 ──
        // 传感器探头区（上方主体）
        this._probeX  = 10;
        this._probeY  = 36;
        this._probeW  = Math.round(this.width * 0.60);
        this._probeH  = Math.round(this.height * 0.50);

        // 钟摆视图中心
        this._pendCX  = this._probeX + this._probeW / 2;
        this._pendCY  = this._probeY + this._probeH / 2 + 8;
        this._pendR   = Math.round(this._probeH * 0.28);  // 钟摆旋转半径

        // 压电元件位置
        this._pzDriveX = this._probeX + this._probeW * 0.14;
        this._pzSenseX = this._probeX + this._probeW * 0.86;
        this._pzY      = this._pendCY;
        this._pzW      = Math.round(this._probeW * 0.12);
        this._pzH      = 50;

        // 仪表头（右侧）
        this._headX   = this._probeX + this._probeW + 10;
        this._headY   = this._probeY;
        this._headW   = this.width - this._headX - 8;
        this._headH   = this._probeH;

        // 波形区（左下）
        this._wavX    = this._probeX;
        this._wavY    = this._probeY + this._probeH + 10;
        this._wavW    = Math.round(this.width * 0.60);
        this._wavH    = Math.round(this.height * 0.32);

        // 李萨如图（右下）
        this._lissX   = this._headX;
        this._lissY   = this._headY + this._headH + 10;
        this._lissW   = this._headW;
        this._lissH   = this._wavH;

        this._lastTs  = null;
        this._animId  = null;
        this.knobs    = {};
        this.isBreak  = false;

        this.config = {
            id: this.id, driveFreq: this.driveFreq,
            maxViscosity: this.maxViscosity, tempC: this.tempC,
        };

        this._init();

        // 端口
        const midY = this._pendCY;
        this.addPort(0,           midY - 16, 'in',   'pipe', 'OIL IN');
        this.addPort(0,           midY + 16, 'out',  'pipe', 'OIL OUT');
        this.addPort(this.width,  this._headY + 14,  'dp',  'wire', 'DRV+');
        this.addPort(this.width,  this._headY + 34,  'dn',  'wire', 'DRV−');
        this.addPort(this.width,  this._headY + 58,  'sp',  'wire', 'SNS+');
        this.addPort(this.width,  this._headY + 78,  'sn',  'wire', 'SNS−');
    }

    // ═══════════════════════════════════════════
    //  初始化
    // ═══════════════════════════════════════════
    _init() {
        this._drawLabel();
        this._drawOilChamber();
        this._drawFuelPorts();
        this._drawPiezoElements();
        this._drawPendulumBase();
        this._drawPendulumDynamic();
        this._drawWireConnections();
        this._drawInstrHead();
        this._drawLCD();
        this._drawKnobs();
        this._drawWaveformArea();
        this._drawLissajous();
        this._setupDrag();
        this._startAnimation();
    }

    _drawLabel() {
        this.group.add(new Konva.Text({
            x: 0, y: -22, width: this.width,
            text: 'VT20 船用燃油黏度传感器（旋转钟摆 + 双压电元件）',
            fontSize: 12, fontStyle: 'bold', fill: '#1a2634', align: 'center',
        }));
    }

    // ── 燃油腔（探头浸入区）─────────────────
    _drawOilChamber() {
        const { _probeX: px, _probeY: py, _probeW: pw, _probeH: ph } = this;
        const wall = 10;

        // 外壳（不锈钢工业感）
        const outer = new Konva.Rect({
            x: px, y: py, width: pw, height: ph,
            fill: '#37474f', stroke: '#263238', strokeWidth: 2, cornerRadius: 6,
        });
        // 燃油腔（深琥珀色）
        this._oilCav = new Konva.Rect({
            x: px + wall, y: py + wall,
            width: pw - wall*2, height: ph - wall*2,
            fill: '#2a1800',
        });
        // 高光
        this.group.add(new Konva.Rect({
            x: px, y: py, width: pw, height: 5,
            fill: 'rgba(255,255,255,0.09)', cornerRadius: [6,6,0,0],
        }));
        // 螺孔
        [[px+8,py+8],[px+pw-8,py+8],[px+8,py+ph-8],[px+pw-8,py+ph-8]].forEach(([bx,by]) => {
            this.group.add(new Konva.Circle({ x: bx, y: by, radius: 4.5, fill: '#263238', stroke: '#1a252f', strokeWidth: 0.5 }));
            this.group.add(new Konva.Circle({ x: bx-1, y: by-1, radius: 1.3, fill: 'rgba(255,255,255,0.25)' }));
        });

        // 探头铭牌
        this.group.add(new Konva.Text({
            x: px + 8, y: py + 5,
            text: 'VT20  VISCOSITY SENSOR', fontSize: 8.5, fontStyle: 'bold', fill: 'rgba(255,255,255,0.25)',
        }));

        this.group.add(outer, this._oilCav);
    }

    // ── 燃油进出管口 ─────────────────────────
    _drawFuelPorts() {
        const px = this._probeX;
        const cy = this._pendCY;

        // 进口
        const portIn = new Konva.Rect({
            x: px - 30, y: cy - 24, width: 30, height: 16,
            fill: '#bf6a00', stroke: '#8a4a00', strokeWidth: 1.5, cornerRadius: [3,0,0,3],
        });
        const portOut = new Konva.Rect({
            x: px - 30, y: cy + 8, width: 30, height: 16,
            fill: '#6a3500', stroke: '#4a2200', strokeWidth: 1.5, cornerRadius: [3,0,0,3],
        });
        // 箭头
        this.group.add(new Konva.Line({ points: [px-30, cy-16, px-4, cy-16], stroke: '#ffa726', strokeWidth: 1.5 }));
        this.group.add(new Konva.Line({ points: [px-8, cy-20, px-2, cy-16, px-8, cy-12], stroke: '#ffa726', strokeWidth: 1.5, lineJoin: 'round' }));
        this.group.add(new Konva.Line({ points: [px-4, cy+16, px-30, cy+16], stroke: '#795548', strokeWidth: 1.5 }));
        this.group.add(new Konva.Line({ points: [px-24, cy+12, px-30, cy+16, px-24, cy+20], stroke: '#795548', strokeWidth: 1.5, lineJoin: 'round' }));

        this.group.add(new Konva.Text({ x: px-46, y: cy-28, text: '燃油\n进口', fontSize: 8, fill: '#ffa726', lineHeight: 1.3 }));
        this.group.add(new Konva.Text({ x: px-46, y: cy+10, text: '燃油\n出口', fontSize: 8, fill: '#a1887f', lineHeight: 1.3 }));

        this.group.add(portIn, portOut);
    }

    // ── 双压电元件（外观骨架）───────────────
    _drawPiezoElements() {
        const py = this._pzY;
        const pzH = this._pzH;
        const pzW = this._pzW;

        // 驱动压电元件（左侧，蓝色系）
        this._pzDriveGroup = new Konva.Group({ x: this._pzDriveX, y: py });

        // 绝缘外壳
        this._pzDriveGroup.add(new Konva.Rect({
            x: -pzW/2 - 4, y: -pzH/2 - 4,
            width: pzW + 8, height: pzH + 8,
            fill: '#1a2634', stroke: '#37474f', strokeWidth: 1, cornerRadius: 3,
        }));
        // 晶片主体（动态颜色）
        this._pzDriveRect = new Konva.Rect({
            x: -pzW/2, y: -pzH/2,
            width: pzW, height: pzH,
            fill: '#1565c0', stroke: '#0d47a1', strokeWidth: 1, cornerRadius: 2,
        });
        // 顶底电极
        const mkElec = (yOff) => new Konva.Rect({ x: -pzW/2-2, y: yOff, width: pzW+4, height: 3, fill: '#ffd54f', stroke: '#f9a825', strokeWidth: 0.5, cornerRadius: 1 });
        this._pzDriveTopElec = mkElec(-pzH/2 - 3);
        this._pzDriveBotElec = mkElec(pzH/2);
        // 极化方向标注
        this._pzDriveLabel = new Konva.Text({ x: -pzW/2, y: -pzH/2, width: pzW, text: '驱动', fontSize: 8, fontStyle: 'bold', fill: '#90caf9', align: 'center' });
        this._pzDriveSubLabel = new Konva.Text({ x: -pzW/2, y: pzH/2 - 14, width: pzW, text: 'V_in', fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#42a5f5', align: 'center' });
        // 电荷符号组
        this._pzDriveChargeGroup = new Konva.Group();
        this._pzDriveGroup.add(this._pzDriveRect, this._pzDriveTopElec, this._pzDriveBotElec, this._pzDriveLabel, this._pzDriveSubLabel, this._pzDriveChargeGroup);

        // 感测压电元件（右侧，橙色系）
        this._pzSenseGroup = new Konva.Group({ x: this._pzSenseX, y: py });
        this._pzSenseGroup.add(new Konva.Rect({
            x: -pzW/2 - 4, y: -pzH/2 - 4,
            width: pzW + 8, height: pzH + 8,
            fill: '#1a2634', stroke: '#37474f', strokeWidth: 1, cornerRadius: 3,
        }));
        this._pzSenseRect = new Konva.Rect({
            x: -pzW/2, y: -pzH/2,
            width: pzW, height: pzH,
            fill: '#bf6a00', stroke: '#8a4a00', strokeWidth: 1, cornerRadius: 2,
        });
        this._pzSenseTopElec = mkElec(-pzH/2 - 3);
        this._pzSenseBotElec = mkElec(pzH/2);
        this._pzSenseLabel    = new Konva.Text({ x: -pzW/2, y: -pzH/2, width: pzW, text: '感测', fontSize: 8, fontStyle: 'bold', fill: '#ffcc80', align: 'center' });
        this._pzSenseSubLabel = new Konva.Text({ x: -pzW/2, y: pzH/2 - 14, width: pzW, text: 'V_out', fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#ffa726', align: 'center' });
        this._pzSenseChargeGroup = new Konva.Group();
        this._pzSenseGroup.add(this._pzSenseRect, this._pzSenseTopElec, this._pzSenseBotElec, this._pzSenseLabel, this._pzSenseSubLabel, this._pzSenseChargeGroup);

        this.group.add(this._pzDriveGroup, this._pzSenseGroup);

        // 扭矩传递杆
        this._torsionGroup = new Konva.Group();
        this.group.add(this._torsionGroup);
    }

    // ── 钟摆底座（静态）─────────────────────
    _drawPendulumBase() {
        const cx = this._pendCX, cy = this._pendCY;
        const R  = this._pendR;

        // 旋转腔圆形边框
        const ring = new Konva.Ring({
            x: cx, y: cy,
            innerRadius: R + 4, outerRadius: R + 12,
            fill: '#455a64', stroke: '#37474f', strokeWidth: 1,
        });
        // 旋转腔内底
        const innerBase = new Konva.Circle({
            x: cx, y: cy, radius: R + 4, fill: '#1a2f3f',
        });
        // 中心轴承
        const shaft = new Konva.Circle({ x: cx, y: cy, radius: 5, fill: '#37474f', stroke: '#263238', strokeWidth: 1 });

        this.group.add(innerBase, ring, shaft);

        // 参考刻度
        for (let i = 0; i < 12; i++) {
            const a = (i / 12) * Math.PI * 2 - Math.PI/2;
            this.group.add(new Konva.Line({
                points: [
                    cx + (R+5) * Math.cos(a), cy + (R+5) * Math.sin(a),
                    cx + (R+10)* Math.cos(a), cy + (R+10)* Math.sin(a),
                ],
                stroke: '#546e7a', strokeWidth: i % 3 === 0 ? 1.5 : 0.8,
            }));
        }
        this.group.add(new Konva.Text({ x: cx - 24, y: cy - R - 20, text: '旋转钟摆', fontSize: 8.5, fontStyle: 'bold', fill: '#80cbc4' }));
    }

    // ── 钟摆动态层 ───────────────────────────
    _drawPendulumDynamic() {
        this._pendulumGroup = new Konva.Group({ x: this._pendCX, y: this._pendCY });

        const R = this._pendR;
        // 摆臂
        const arm1 = new Konva.Line({ points: [0, 0, R * 0.9, 0], stroke: '#90cac4', strokeWidth: 4, lineCap: 'round' });
        const arm2 = new Konva.Line({ points: [0, 0, -R * 0.9, 0], stroke: '#90cac4', strokeWidth: 4, lineCap: 'round' });
        // 摆锤
        this._pendBob1 = new Konva.Rect({ x: R * 0.85 - 8, y: -7, width: 16, height: 14, fill: '#26a69a', stroke: '#00796b', strokeWidth: 1.5, cornerRadius: 2 });
        this._pendBob2 = new Konva.Rect({ x: -R * 0.85 - 8, y: -7, width: 16, height: 14, fill: '#26a69a', stroke: '#00796b', strokeWidth: 1.5, cornerRadius: 2 });
        // 中心盘
        const centerDisk = new Konva.Circle({ radius: 6, fill: '#80cbc4', stroke: '#37474f', strokeWidth: 1.5 });
        const centerDot  = new Konva.Circle({ radius: 2.5, fill: '#1a252f' });

        this._pendulumGroup.add(arm1, arm2, this._pendBob1, this._pendBob2, centerDisk, centerDot);
        this.group.add(this._pendulumGroup);
    }

    // ── 连接导线 ─────────────────────────────
    _drawWireConnections() {
        const cx  = this._pendCX, cy = this._pendCY;
        const hx  = this._headX;

        // 驱动连线（压电→钟摆，蓝色）
        this.group.add(new Konva.Line({
            points: [this._pzDriveX + this._pzW/2, cy, cx - this._pendR * 0.6, cy],
            stroke: 'rgba(66,165,245,0.25)', strokeWidth: 1.5, dash: [4, 3],
        }));
        // 感测连线（钟摆→压电，橙色）
        this.group.add(new Konva.Line({
            points: [cx + this._pendR * 0.6, cy, this._pzSenseX - this._pzW/2, cy],
            stroke: 'rgba(255,167,38,0.25)', strokeWidth: 1.5, dash: [4, 3],
        }));

        // 压电到仪表头的引线
        this.group.add(new Konva.Line({
            points: [this._pzDriveX, cy - this._pzH/2 - 8, this._pzDriveX, this._probeY - 2, hx, this._probeY - 2, hx, this._headY + 14],
            stroke: '#42a5f5', strokeWidth: 1.2, dash: [3,2],
        }));
        this.group.add(new Konva.Line({
            points: [this._pzSenseX, cy - this._pzH/2 - 8, this._pzSenseX, this._probeY - 10, hx + 2, this._probeY - 10, hx + 2, this._headY + 58],
            stroke: '#ffa726', strokeWidth: 1.2, dash: [3,2],
        }));
    }

    // ── 仪表头 ───────────────────────────────
    _drawInstrHead() {
        const hx = this._headX, hy = this._headY;
        const hw = this._headW, hh = this._headH;

        const jBox = new Konva.Rect({ x: hx, y: hy, width: hw, height: 50, fill: '#cfd8dc', stroke: '#90a4ae', strokeWidth: 1.5, cornerRadius: [5,5,0,0] });
        for (let i = 0; i < 4; i++) this.group.add(new Konva.Line({ points: [hx, hy+7+i*10, hx+hw, hy+7+i*10], stroke: 'rgba(255,255,255,0.14)', strokeWidth: 0.8 }));
        const plate = new Konva.Rect({ x: hx+8, y: hy+4, width: hw-16, height: 28, fill: '#eceff1', stroke: '#b0bec5', strokeWidth: 0.5, cornerRadius: 2 });
        this._idText = new Konva.Text({ x: hx+8, y: hy+7, width: hw-16, text: this.id || 'VT20-01', fontSize: 9, fontStyle: 'bold', fill: '#263238', align: 'center' });
        this.group.add(new Konva.Text({ x: hx+8, y: hy+18, width: hw-16, text: 'VISCOSITY SENSOR', fontSize: 7, fill: '#78909c', align: 'center' }));
        this.group.add(new Konva.Text({ x: hx+8, y: hy+27, width: hw-16, text: `f=${this.driveFreq}Hz  Torsional`, fontSize: 7, fill: '#90a4ae', align: 'center' }));
        const lcap = new Konva.Rect({ x: hx,    y: hy+4, width: 10, height: 44, fill: '#b0bec5', cornerRadius: [2,0,0,2] });
        const rcap = new Konva.Rect({ x: hx+hw-10, y: hy+4, width: 10, height: 44, fill: '#b0bec5', cornerRadius: [0,2,2,0] });
        const body = new Konva.Rect({ x: hx, y: hy+50, width: hw, height: hh-50, fill: '#1e2a36', stroke: '#0d1520', strokeWidth: 1.5, cornerRadius: [0,0,4,4] });

        // 端子标签（4个）
        [['DRV+','#42a5f5',14],['DRV−','#1565c0',34],['SNS+','#ffa726',58],['SNS−','#e65100',78]].forEach(([lbl,col,ty]) => {
            this.group.add(new Konva.Rect({ x: hx+4, y: hy+ty-7, width: hw-8, height: 13, fill: 'rgba(255,255,255,0.025)', cornerRadius: 2 }));
            this.group.add(new Konva.Text({ x: hx+7, y: hy+ty-4, text: lbl, fontSize: 9, fontStyle: 'bold', fill: col }));
        });

        this.group.add(jBox, plate, lcap, rcap, this._idText, body);
    }

    // ── 圆形 LCD ────────────────────────────
    _drawLCD() {
        const hx = this._headX, hw = this._headW;
        const lcy = this._headY + 50 + (this._headH - 50) * 0.50;
        const lcx = hx + hw / 2;
        const R   = Math.min(hw * 0.40, 42);
        this._lcCX = lcx; this._lcCY = lcy; this._lcR = R;

        this.group.add(new Konva.Circle({ x: lcx, y: lcy, radius: R+4, fill: '#0d1520', stroke: '#1a252f', strokeWidth: 1 }));
        // 琥珀色（燃油黏度传感器特色外环）
        const ring = new Konva.Circle({ x: lcx, y: lcy, radius: R+2, fill: '#4e2000', stroke: '#bf6a00', strokeWidth: 2.5 });
        this._lcdBg = new Konva.Circle({ x: lcx, y: lcy, radius: R, fill: '#020c14' });

        // 相位差弧（核心输出）
        this._phaseArc = new Konva.Arc({ x: lcx, y: lcy, innerRadius: R-5, outerRadius: R-3, angle: 0, fill: '#ffa726', rotation: -90 });

        this._lcdMain   = new Konva.Text({ x: lcx-R+4, y: lcy-R*.36, width:(R-4)*2, text:'0',    fontSize:R*.42, fontFamily:'Courier New, monospace', fontStyle:'bold', fill:'#ffa726', align:'center' });
        this._lcdUnit   = new Konva.Text({ x: lcx-R+4, y: lcy+R*.11, width:(R-4)*2, text:'mPa·s', fontSize:R*.15, fill:'#4e2000', align:'center' });
        this._lcdPhase  = new Konva.Text({ x: lcx-R+4, y: lcy+R*.30, width:(R-4)*2, text:'φ=0°', fontSize:R*.14, fontFamily:'Courier New, monospace', fill:'#37474f', align:'center' });
        this._lcdFreq   = new Konva.Text({ x: lcx-R+4, y: lcy-R*.60, width:(R-4)*2, text:`${this.driveFreq}Hz`, fontSize:R*.13, fontFamily:'Courier New, monospace', fill:'#80cbc4', align:'center' });
        this._lcdTemp   = new Konva.Text({ x: lcx-R+4, y: lcy+R*.47, width:(R-4)*2, text:`${this.tempC}°C`, fontSize:R*.12, fontFamily:'Courier New, monospace', fill:'#263238', align:'center' });

        this.group.add(ring, this._lcdBg, this._phaseArc, this._lcdMain, this._lcdUnit, this._lcdPhase, this._lcdFreq, this._lcdTemp);
    }

    // ── 旋钮 ─────────────────────────────────
    _drawKnobs() {
        const hx = this._headX, hw = this._headW;
        const kx = hx + hw/2, ky = this._lcCY + this._lcR + 16;

        const base = new Konva.Circle({ x: kx, y: ky, radius: 18, fill: '#263238', stroke: '#1a252f', strokeWidth: 1.5 });
        this._knobRotor = new Konva.Group({ x: kx, y: ky });
        this._knobRotor.add(
            new Konva.Circle({ radius: 14, fill: '#37474f', stroke: '#263238', strokeWidth: 1 }),
            new Konva.Line({ points: [0,-12,0,-4], stroke: '#ffa726', strokeWidth: 3, lineCap: 'round' }),
        );
        this._knobRotor.on('mousedown touchstart', e => {
            e.cancelBubble = true;
            const sy = e.evt.clientY ?? e.evt.touches?.[0]?.clientY ?? 0;
            const sv = this._manualVisc;
            const sa = this._knobAngle || 0;
            const mv = me => {
                const cy2 = me.clientY ?? me.touches?.[0]?.clientY ?? 0;
                const newA = Math.max(-150, Math.min(150, sa + (sy - cy2) * 1.5));
                this._knobAngle = newA;
                this._knobRotor.rotation(newA);
                this._manualVisc = Math.max(2, Math.min(1000, sv + (sy - cy2) * 3));
            };
            const up = () => { window.removeEventListener('mousemove', mv); window.removeEventListener('touchmove', mv); window.removeEventListener('mouseup', up); window.removeEventListener('touchend', up); };
            window.addEventListener('mousemove', mv); window.addEventListener('touchmove', mv);
            window.addEventListener('mouseup', up); window.addEventListener('touchend', up);
        });
        this.group.add(base, this._knobRotor, new Konva.Text({ x: kx-18, y: ky+20, width: 36, text: '黏度旋钮', fontSize: 8.5, fill: '#546e7a', align: 'center' }));
    }

    // ── 双通道波形区 ─────────────────────────
    _drawWaveformArea() {
        const { _wavX: wx, _wavY: wy, _wavW: ww, _wavH: wh } = this;

        const bg = new Konva.Rect({ x: wx, y: wy, width: ww, height: wh, fill: '#010d18', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 4 });
        const titleBg = new Konva.Rect({ x: wx, y: wy, width: ww, height: 14, fill: '#0a1a28', cornerRadius: [4,4,0,0] });
        this.group.add(new Konva.Text({ x: wx+4, y: wy+2, width: ww-8, text: '电压波形  ── V_in (驱动)  ── V_out (感测)  ← 相位差 φ', fontSize: 8, fontStyle: 'bold', fill: '#ffa726', align: 'center' }));

        // 网格
        for (let i = 1; i < 4; i++) this.group.add(new Konva.Line({ points: [wx, wy+wh*i/4, wx+ww, wy+wh*i/4], stroke: 'rgba(255,167,38,0.07)', strokeWidth: 0.5 }));
        for (let i = 1; i < 5; i++) this.group.add(new Konva.Line({ points: [wx+ww*i/5, wy, wx+ww*i/5, wy+wh], stroke: 'rgba(255,167,38,0.05)', strokeWidth: 0.5 }));

        this._wavMidIn  = wy + wh * 0.25;
        this._wavMidOut = wy + wh * 0.75;

        [this._wavMidIn, this._wavMidOut].forEach(my => {
            this.group.add(new Konva.Line({ points: [wx+2, my, wx+ww-2, my], stroke: 'rgba(200,200,200,0.1)', strokeWidth: 0.5, dash: [4,3] }));
        });

        this._wLineIn  = new Konva.Line({ points: [], stroke: '#42a5f5', strokeWidth: 1.6, lineJoin: 'round' });
        this._wLineOut = new Konva.Line({ points: [], stroke: '#ffa726', strokeWidth: 1.8, lineJoin: 'round' });
        // 相位差标注线
        this._phaseMarker = new Konva.Line({ points: [], stroke: '#ef5350', strokeWidth: 1, dash: [3,2] });

        this.group.add(new Konva.Text({ x: wx+4, y: wy+16, text: 'V_in  驱动', fontSize: 8, fill: '#42a5f5' }));
        this.group.add(new Konva.Text({ x: wx+4, y: wy+wh/2+4, text: 'V_out 感测', fontSize: 8, fill: '#ffa726' }));

        this._wInLbl    = new Konva.Text({ x: wx+ww-90, y: wy+16, width: 86, text: '-- V', fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#42a5f5', align: 'right' });
        this._wOutLbl   = new Konva.Text({ x: wx+ww-90, y: wy+wh/2+4, width: 86, text: '-- V', fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#ffa726', align: 'right' });
        this._wPhaseLbl = new Konva.Text({ x: wx+ww-90, y: wy+wh-14, width: 86, text: 'φ=0.0°', fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#ef5350', align: 'right' });

        this.group.add(bg, titleBg, this._wLineIn, this._wLineOut, this._phaseMarker, this._wInLbl, this._wOutLbl, this._wPhaseLbl);
    }

    // ── 李萨如图 ─────────────────────────────
    _drawLissajous() {
        const { _lissX: lx, _lissY: ly, _lissW: lw, _lissH: lh } = this;

        const bg = new Konva.Rect({ x: lx, y: ly, width: lw, height: lh, fill: '#010d18', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 4 });
        const titleBg = new Konva.Rect({ x: lx, y: ly, width: lw, height: 14, fill: '#0a1a28', cornerRadius: [4,4,0,0] });
        this.group.add(new Konva.Text({ x: lx+2, y: ly+2, width: lw-4, text: 'V_in vs V_out', fontSize: 8, fontStyle: 'bold', fill: '#ffd54f', align: 'center' }));

        const lmx = lx + lw/2, lmy = ly + lh/2;
        this.group.add(new Konva.Line({ points: [lx+2, lmy, lx+lw-2, lmy], stroke: 'rgba(200,200,200,0.1)', strokeWidth: 0.5 }));
        this.group.add(new Konva.Line({ points: [lmx, ly+14, lmx, ly+lh-2], stroke: 'rgba(200,200,200,0.1)', strokeWidth: 0.5 }));
        this.group.add(new Konva.Text({ x: lx+2, y: lmy+2, text: 'X:V_in', fontSize: 7, fill: '#546e7a' }));
        this.group.add(new Konva.Text({ x: lmx+2, y: ly+16, text: 'Y:V_out', fontSize: 7, fill: '#546e7a' }));

        this._lissLine   = new Konva.Line({ points: [], stroke: '#ffd54f', strokeWidth: 1.2, lineJoin: 'round', opacity: 0.85 });
        this._lissPhiLbl = new Konva.Text({ x: lx+3, y: ly+lh-14, text: 'φ=0°  η=0', fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#ffd54f' });

        this.group.add(bg, titleBg, this._lissLine, this._lissPhiLbl);
    }

    // ── 黏度调节（拖拽）───────────────────
    _setupDrag() {
        // 探头区拖拽调节黏度
        const hit = new Konva.Rect({
            x: this._probeX, y: this._probeY,
            width: this._probeW, height: this._probeH,
            fill: 'transparent', listening: true,
        });
        hit.on('mousedown touchstart', e => {
            e.cancelBubble = true;
            this._dragStartY = e.evt.clientY ?? e.evt.touches?.[0]?.clientY ?? 0;
            this._dragStartV = this._manualVisc;
            this._dragActive = true;
        });
        const mv = e => {
            if (!this._dragActive) return;
            const cy = e.clientY ?? e.touches?.[0]?.clientY ?? 0;
            this._manualVisc = Math.max(2, Math.min(1000, this._dragStartV + (this._dragStartY - cy) * 3));
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
                this._tickPendulum(dt);
                this._tickPiezoAnimation();
                this._tickOilViz();
                this._tickWaveforms(dt);
                this._tickLissajous();
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

    // ── 物理计算 ──────────────────────────────
    _tickPhysics(dt) {
        this.viscosity = this._manualVisc;
        this._time    += dt;

        const eta = this.viscosity;  // mPa·s
        const omega = this._omega;

        // 振动方程稳态解
        // I·θ̈ + b·η·θ̇ + k·θ = M₀·sin(ω·t)
        const I = this._I, b = this._b, k = this._k, M0 = this._M0;
        const damp = b * eta * 0.001;  // 阻尼（黏度归一化）

        // 稳态相位差
        // φ = arctan(damp·ω / (k - I·ω²))
        // 对于接近共振频率（k ≈ I·ω²），φ ≈ arctan(damp·ω / small)
        // 简化模型：φ² ∝ η → φ = sqrt(η / K_cal)
        const K_cal = 1000;  // 标定系数（mPa·s / rad²）
        this.phaseShift = Math.sqrt(Math.min(1, eta / K_cal)) * Math.PI * 0.45;  // 最大45% of π
        this.phaseDeg   = this.phaseShift * 180 / Math.PI;

        // 振幅（阻尼越大，振幅越小）
        const denomSq = Math.pow(k - I*omega*omega, 2) + Math.pow(damp * omega, 2);
        this.pendulumAmp = M0 / Math.sqrt(denomSq + 0.001) * 8; // 视觉放大

        // 驱动信号（输入）
        this.vIn  = this.driveVoltage * Math.sin(omega * this._time);
        // 感测信号（输出，有相位滞后 + 幅度随黏度衰减）
        const ampRatio = Math.max(0.1, 1 - eta / (this.maxViscosity * 1.5));
        this.vOut = this.driveVoltage * ampRatio * Math.sin(omega * this._time - this.phaseShift);

        // 钟摆角度
        this.pendulumAngle = this.pendulumAmp * Math.sin(omega * this._time) * 0.06;

        // 驱动晶片形变（逆压电，随 V_in）
        this._driveDeform = Math.sin(omega * this._time);
        // 感测晶片形变（正压电，随钟摆，有相位滞后）
        this._senseDeform = ampRatio * Math.sin(omega * this._time - this.phaseShift);

        // 相位弧更新
        if (this._phaseArc) {
            const ratio = Math.min(1, eta / this.maxViscosity);
            this._phaseArc.angle(ratio * 360);
        }

        // LCD 更新
        if (this._lcdMain) this._lcdMain.text(Math.round(eta).toString());
    }

    // ── 钟摆动画 ──────────────────────────────
    _tickPendulum(dt) {
        if (this._pendulumGroup) {
            this._pendulumGroup.rotation(this.pendulumAngle * 180 / Math.PI);
        }

        // 扭矩传递动画（振动波纹）
        this._torsionGroup.destroyChildren();
        const cx = this._pendCX, cy = this._pendCY;
        const R  = this._pendR;

        // 从驱动晶片到钟摆的扭矩指示
        const phase = this._time * this._omega;
        for (let i = 0; i < 3; i++) {
            const t     = ((phase * 0.1 + i/3) % 1 + 1) % 1;
            const alpha = (1 - t) * 0.4;
            const wx2   = this._pzDriveX + this._pzW/2 + t * (cx - R*0.6 - this._pzDriveX - this._pzW/2);
            const col   = `rgba(66,165,245,${alpha})`;
            this._torsionGroup.add(new Konva.Circle({ x: wx2, y: cy, radius: 4, fill: col }));
        }
        // 从钟摆到感测晶片
        for (let i = 0; i < 3; i++) {
            const t     = ((phase * 0.1 + i/3 + this.phaseShift/(2*Math.PI) * 0.3) % 1 + 1) % 1;
            const alpha = (1 - t) * 0.4;
            const wx2   = cx + R*0.6 + t * (this._pzSenseX - this._pzW/2 - cx - R*0.6);
            this._torsionGroup.add(new Konva.Circle({ x: wx2, y: cy, radius: 4, fill: `rgba(255,167,38,${alpha})` }));
        }
    }

    // ── 压电元件动画 ─────────────────────────
    _tickPiezoAnimation() {
        const pzW = this._pzW, pzH = this._pzH;
        const def_drive = this._driveDeform;
        const def_sense = this._senseDeform;

        // ── 驱动晶片（逆压电：V→形变）──
        // 颜色随激励变化（高压=亮蓝，低压=暗蓝）
        const driveIntensity = (def_drive + 1) / 2;  // 0~1
        const dr = Math.round(21 + driveIntensity * 33);
        const dg = Math.round(101 + driveIntensity * 64);
        const db = Math.round(192 + driveIntensity * 63);
        if (this._pzDriveRect) {
            this._pzDriveRect.fill(`rgb(${dr},${dg},${db})`);
            // 形变（宽度变化）
            const wDelta = def_drive * pzW * 0.25;
            this._pzDriveRect.width(pzW + wDelta);
            this._pzDriveRect.height(pzH - def_drive * pzH * 0.1);
            this._pzDriveRect.x(-pzW/2 - wDelta/2);
        }
        // 电荷符号
        this._pzDriveChargeGroup.destroyChildren();
        if (Math.abs(def_drive) > 0.1) {
            const topSign = def_drive > 0 ? '+' : '−';
            const botSign = def_drive > 0 ? '−' : '+';
            const col     = def_drive > 0 ? '#90caf9' : '#ef9a9a';
            const glow    = Math.abs(def_drive) * 0.5;
            this._pzDriveChargeGroup.add(new Konva.Text({ x: -5, y: -pzH/2 - 16, text: topSign, fontSize: 14, fontStyle: 'bold', fill: col, opacity: Math.abs(def_drive) * 0.85 }));
            this._pzDriveChargeGroup.add(new Konva.Text({ x: -5, y: pzH/2 + 4,   text: botSign, fontSize: 14, fontStyle: 'bold', fill: def_drive > 0 ? '#ef9a9a' : '#90caf9', opacity: Math.abs(def_drive) * 0.85 }));
            // 辉光
            this._pzDriveChargeGroup.add(new Konva.Rect({ x: -pzW/2-2, y: -pzH/2-4, width: pzW+4, height: pzH+8, fill: `rgba(66,165,245,${glow*0.18})`, cornerRadius: 3 }));
        }

        // ── 感测晶片（正压电：形变→V）──
        const senseIntensity = (def_sense + 1) / 2;
        const sr2 = Math.round(191 + senseIntensity * 44);
        const sg2 = Math.round(106 + senseIntensity * 49);
        const sb2 = Math.round(0);
        if (this._pzSenseRect) {
            this._pzSenseRect.fill(`rgb(${sr2},${sg2},${sb2})`);
            const wDelta2 = def_sense * pzW * 0.25;
            this._pzSenseRect.width(pzW + wDelta2);
            this._pzSenseRect.height(pzH - def_sense * pzH * 0.1);
            this._pzSenseRect.x(-pzW/2 - wDelta2/2);
        }
        this._pzSenseChargeGroup.destroyChildren();
        if (Math.abs(def_sense) > 0.1) {
            const topSign = def_sense > 0 ? '+' : '−';
            const botSign = def_sense > 0 ? '−' : '+';
            const col     = def_sense > 0 ? '#ffcc80' : '#ef9a9a';
            const glow    = Math.abs(def_sense) * 0.5;
            this._pzSenseChargeGroup.add(new Konva.Text({ x: -5, y: -pzH/2 - 16, text: topSign, fontSize: 14, fontStyle: 'bold', fill: col, opacity: Math.abs(def_sense) * 0.85 }));
            this._pzSenseChargeGroup.add(new Konva.Text({ x: -5, y: pzH/2 + 4,   text: botSign, fontSize: 14, fontStyle: 'bold', fill: def_sense > 0 ? '#ef9a9a' : '#ffcc80', opacity: Math.abs(def_sense) * 0.85 }));
            this._pzSenseChargeGroup.add(new Konva.Rect({ x: -pzW/2-2, y: -pzH/2-4, width: pzW+4, height: pzH+8, fill: `rgba(255,167,38,${glow*0.18})`, cornerRadius: 3 }));
        }
    }

    // ── 燃油腔可视化 ─────────────────────────
    _tickOilViz() {
        if (this._oilCav) {
            const eta  = this.viscosity;
            const norm = Math.min(1, eta / this.maxViscosity);
            const r    = Math.round(42 + norm * 60);
            const g    = Math.round(24 + norm * 20);
            const b    = Math.round(0  + norm * 5);
            this._oilCav.fill(`rgb(${r},${g},${b})`);
        }
    }

    // ── 波形缓冲 ──────────────────────────────
    _tickWaveforms(dt) {
        const scrollSpeed = 1.5;
        this._wavAcc += scrollSpeed * dt * this._wavLen;
        const steps = Math.floor(this._wavAcc);
        this._wavAcc -= steps;

        for (let i = 0; i < steps; i++) {
            this._wavIn  = new Float32Array([...this._wavIn.slice(1),  this.vIn]);
            this._wavOut = new Float32Array([...this._wavOut.slice(1), this.vOut]);
        }

        const wx = this._wavX + 3, wy2 = this._wavY;
        const ww = this._wavW - 6, wh = this._wavH;
        const n  = this._wavLen, dx = ww / n;
        const inAmp  = wh * 0.20;
        const outAmp = wh * 0.20;

        const inPts = [], outPts = [];
        for (let i = 0; i < n; i++) {
            const x = wx + i * dx;
            inPts.push(x,  this._wavMidIn  - (this._wavIn[i]  / this.driveVoltage) * inAmp);
            outPts.push(x, this._wavMidOut - (this._wavOut[i] / this.driveVoltage) * outAmp);
        }

        if (this._wLineIn)  this._wLineIn.points(inPts);
        if (this._wLineOut) this._wLineOut.points(outPts);

        // 相位差标注箭头（在波形中标出相位偏移）
        if (this._phaseMarker) {
            // 找到 V_in 的零交叉点和 V_out 的零交叉点
            const midX = wx + ww * 0.65;
            const phiPx = this.phaseShift / (2 * Math.PI) * (ww / (scrollSpeed));
            this._phaseMarker.points([midX - phiPx, this._wavMidIn, midX - phiPx, this._wavMidOut + wh*0.1]);
        }

        if (this._wInLbl)    this._wInLbl.text(`${this.vIn.toFixed(2)} V`);
        if (this._wOutLbl)   this._wOutLbl.text(`${this.vOut.toFixed(2)} V`);
        if (this._wPhaseLbl) this._wPhaseLbl.text(`φ=${this.phaseDeg.toFixed(1)}°  η²∝φ`);
    }

    // ── 李萨如图 ──────────────────────────────
    _tickLissajous() {
        this._lissX[this._lissPtr] = this.vIn;
        this._lissY[this._lissPtr] = this.vOut;
        this._lissPtr = (this._lissPtr + 1) % this._lissLen;

        const lx = this._lissX, ly = this._lissY;
        const scaleX = this._lissW * 0.40 / (this.driveVoltage + 0.01);
        const scaleY = this._lissH * 0.38 / (this.driveVoltage + 0.01);
        const lmx = this._lissX_center ?? (this._headX + this._headW/2);
        const lmy = this._lissY_center ?? (this._lissY + this._lissH/2);

        const pts = [];
        for (let i = 0; i < this._lissLen; i++) {
            const idx = (this._lissPtr + i) % this._lissLen;
            pts.push(lmx + lx[idx] * scaleX, lmy - ly[idx] * scaleY);
        }
        if (this._lissLine) this._lissLine.points(pts);

        const lx2 = this._lissX, ly2 = this._lissY;
        const cx3  = this._headX + this._headW / 2;
        const cy3  = this._lissY + this._lissH / 2;
        this._lissX_center = cx3; this._lissY_center = cy3;

        if (this._lissPhiLbl) {
            this._lissPhiLbl.text(`φ=${this.phaseDeg.toFixed(1)}°  η=${Math.round(this.viscosity)}mPa·s`);
        }
    }

    // ── 显示刷新 ──────────────────────────────
    _tickDisplay() {
        if (this.isBreak) {
            if (this._lcdMain) { this._lcdMain.text('FAIL'); this._lcdMain.fill('#ef5350'); }
            return;
        }

        const eta   = this.viscosity;
        const ratio = Math.min(1, eta / this.maxViscosity);
        const mc    = ratio > 0.9 ? '#ff5722' : eta > 100 ? '#ffb300' : '#ffa726';

        if (this._lcdBg)   this._lcdBg.fill('#020c14');
        if (this._lcdMain) { this._lcdMain.text(Math.round(eta).toString()); this._lcdMain.fill(mc); }
        if (this._lcdPhase) {
            this._lcdPhase.text(`φ=${this.phaseDeg.toFixed(1)}°`);
            this._lcdPhase.fill(this.phaseDeg > 0 ? '#ffa726' : '#37474f');
        }
        if (this._lcdFreq) this._lcdFreq.text(`${this.driveFreq} Hz`);
        if (this._lcdTemp) this._lcdTemp.text(`${this.tempC}°C`);
    }

    // ═══════════════════════════════════════════
    //  外部接口
    // ═══════════════════════════════════════════
    update(viscosity) {
        if (typeof viscosity === 'number') {
            this._manualVisc = Math.max(2, Math.min(1000, viscosity));
        }
        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label: '位号/名称',         key: 'id',           type: 'text'   },
            { label: '驱动频率 (Hz)',      key: 'driveFreq',    type: 'number' },
            { label: '驱动电压 (V)',       key: 'driveVoltage', type: 'number' },
            { label: '最大黏度 (mPa·s)', key: 'maxViscosity', type: 'number' },
            { label: '温度 (°C)',          key: 'tempC',        type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        this.id           = cfg.id           || this.id;
        this.driveFreq    = parseFloat(cfg.driveFreq)    || this.driveFreq;
        this.driveVoltage = parseFloat(cfg.driveVoltage) || this.driveVoltage;
        this.maxViscosity = parseFloat(cfg.maxViscosity) || this.maxViscosity;
        this.tempC        = parseFloat(cfg.tempC)        ?? this.tempC;
        this._omega       = 2 * Math.PI * this.driveFreq;
        this.config       = { ...this.config, ...cfg };
        if (this._idText) this._idText.text(this.id);
        this._refreshCache();
    }

    destroy() { this._stopAnimation(); super.destroy?.(); }
}