import { BaseComponent } from './BaseComponent.js';

/**
 * 控制式自整角机接收机（Control Type Synchro Receiver）
 *（Synchro Control Receiver）
 *
 * ── 工作原理 ─────────────────────────────────────────────────
 *
 *  自整角机接收机是角度位置传感器，接收发送机传来的三相电压
 *  当接收机转子与发送机转子角度不一致时，输出误差电压：
 *  
 *  三相励磁电源（发送机侧）：
 *    U_s1s3 = U_m · cos(ωt)
 *    U_s2s4 = U_m · cos(ωt - 120°)
 *    U_s3s5 = U_m · cos(ωt - 240°)
 *
 *  接收机输出电压（Z1Z2 端）：
 *    U_error = K · U_m · sin(θ_sender - θ_receiver) · cos(ωt + φ)
 *
 *  经过相敏整流后得到直流误差信号：
 *    U_dc = K_d · sin(Δθ)
 *
 * ── 自整角机类型 ─────────────────────────────────────────────
 *
 *  控制式自整角机（Control Type Synchro）：
 *    - 力矩式：接收机转子直接驱动负载（小扭矩）
 *    - 控制式：接收机输出电信号给伺服放大器（本组件）
 *  
 *  特点：
 *    ① 输出电压与转角差的正弦成正比
 *    ② 零位误差：±3~10 角分
 *    ③ 精度：6~15 角分（取决于等级）
 *    ④ 励磁电压：110V 或 220V @ 50/400Hz
 *    ⑤ 输出阻抗：几十到几百 Ω
 *
 * ── 技术规格（典型 5 号自整角机）──
 *  励磁电压       110 V / 400 Hz（航空）或 220V / 50Hz（工业）
 *  励磁电流       0.2~0.5 A
 *  输出电压       30~90 V（最大误差角时）
 *  精度           6~20 角分
 *  零位电压       10~50 mV（残余电压）
 *  输出阻抗       50~200 Ω
 *  最大转速       500 rpm（连续）
 *
 * ── 自整角机与其它位置传感器的比较 ──────────────────────────
 *
 *  优势：
 *    - 无电刷，可靠性高
 *    - 可在恶劣环境（高温、震动、油污）工作
 *    - 长距离传输（几百米）
 *    - 无需编码器、电池
 *
 *  劣势：
 *    - 精度较低（角分级）
 *    - 需要交流励磁
 *    - 静态误差（零位电压）
 *    - 体积较大
 *
 * ── 应用场景 ─────────────────────────────────────────────────
 *
 *  ① 雷达天线角度指示
 *  ② 火炮随动系统
 *  ③ 数控机床任意角度定位
 *  ④ 远距离角度同步传输
 *  ⑤ 模拟计算机函数发生器（求解反正弦）
 *
 * ── 组件功能 ─────────────────────────────────────────────────
 *
 *  ① 自整角机结构图（定子三相绕组 + 转子励磁绕组）
 *  ② 误差特性曲线 Uout = f(Δθ)
 *  ③ 三相电压波形显示（U_s1s3, U_s2s4, U_s3s5）
 *  ④ 误差输出电压显示
 *  ⑤ 相敏整流后直流误差信号
 *  ⑥ 角度指示表盘（发送角 vs 接收角）
 *  ⑦ 零位电压、精度参数显示
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *
 *  s1, s2, s3  — 定子三相输入端（来自发送机）
 *  z1, z2      — 误差电压输出端（接伺服放大器）
 *  shaft_in    — 输入轴（接收机转子位置）
 *  shaft_out   — 输出轴（可选，直接输出角度）
 */
export class SynchroReceiver extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(520, config.width  || 620);
        this.height = Math.max(420, config.height || 520);

        this.type    = 'synchro_receiver';
        this.special = 'none';
        this.cache   = 'fixed';

        // ── 自整角机额定参数 ──
        this.excitationVoltage = config.excitationVoltage || 110;   // V（励磁有效值）
        this.excitationFreq    = config.excitationFreq    || 400;   // Hz（航空常用400Hz）
        this.outputVoltageMax  = config.outputVoltageMax  || 60;    // V（最大误差角时输出）
        this.accuracy          = config.accuracy          || 10;    // 角分（精度）
        this.residualVoltage   = config.residualVoltage   || 0.020; // V（零位剩余电压）
        this.outputImpedance   = config.outputImpedance   || 100;   // Ω（输出阻抗）
        
        // ── 角度状态 ──
        this._thetaSender      = 0;          // 发送机角度（输入）
        this._thetaReceiver    = 0;          // 接收机角度（初始）
        this._deltaTheta       = 0;          // 角度差（deg）
        
        // ── 输出信号 ──
        this._errorVoltageAC   = 0;          // 交流误差电压（V 瞬时值）
        this._errorVoltageRMS  = 0;          // 交流误差电压（V 有效值）
        this._dcError          = 0;          // 相敏整流后直流误差（V）
        this._outputCurrent    = 0;          // 输出电流（mA）
        
        // ── 三相输入电压（从发送机接收）──
        this._uS1s3 = 0;        // U_s1s3 瞬时值
        this._uS2s4 = 0;        // U_s2s4 瞬时值
        this._uS3s5 = 0;        // U_s3s5 瞬时值
        
        // ── 负载 ──
        this.loadResistance = config.loadResistance || 10000;   // Ω（伺服放大器输入阻抗）
        
        // ── 温度特性 ──
        this.tempCoef       = config.tempCoef       || -0.03;   // %/°C
        this._temp          = config.temp           || 25;       // °C
        
        // ── 励磁电源（模拟内部参考）──
        this._phaseRef       = 0;          // 励磁参考相位（用于相敏整流）
        this._excitation     = 0;          // 励磁电压瞬时值
        
        // ── 历史数据（波形显示）──
        this._wavLen    = 300;
        this._wavThetaS = new Float32Array(this._wavLen).fill(0);   // 发送角
        this._wavThetaR = new Float32Array(this._wavLen).fill(0);   // 接收角
        this._wavErrAC  = new Float32Array(this._wavLen).fill(0);   // 交流误差
        this._wavErrDC  = new Float32Array(this._wavLen).fill(0);   // 直流误差
        this._wavU1     = new Float32Array(this._wavLen).fill(0);   // 三相电压 U1
        this._wavU2     = new Float32Array(this._wavLen).fill(0);
        this._wavU3     = new Float32Array(this._wavLen).fill(0);
        
        // ── 控制状态 ──
        this._enabled       = true;
        this._manualMode    = false;       // 手动模式（模拟发送角）
        this._manualSender  = 0;           // 手动发送角（deg）
        
        // ── 配置 ──
        this.config = {
            id: this.id,
            excitationVoltage: this.excitationVoltage,
            excitationFreq: this.excitationFreq,
            outputVoltageMax: this.outputVoltageMax,
            accuracy: this.accuracy,
        };
        
        // ── 几何布局 ──
        this._csX  = Math.round(this.width * 0.03);
        this._csY  = Math.round(this.height * 0.04);
        this._csW  = Math.round(this.width * 0.38);
        this._csH  = Math.round(this.height * 0.48);
        this._csCX = this._csX + this._csW / 2;
        this._csCY = this._csY + this._csH / 2;
        
        this._charX = this._csX + this._csW + 8;
        this._charY = this._csY;
        this._charW = this.width - this._charX - 12;
        this._charH = Math.round(this.height * 0.28);
        
        this._meterX = this._charX;
        this._meterY = this._charY + this._charH + 6;
        this._meterW = this._charW;
        this._meterH = Math.round(this.height * 0.18);
        
        this._wavX   = this._csX;
        this._wavY   = this._meterY + this._meterH + 8;
        this._wavW   = this.width - this._csX * 2;
        this._wavH   = this.height - this._wavY - 12;
        
        this._time    = 0;
        
        this._init();
        
        // 端口
        const termX = this._csX + this._csW + 2;
        const termY = this._csY + this._csH * 0.5;
        
        // 定子输入端（接发送机）
        this.addPort(termX, termY - 40, 's1', 'wire', 'S1');
        this.addPort(termX, termY - 20, 's2', 'wire', 'S2');
        this.addPort(termX, termY,      's3', 'wire', 'S3');
        
        // 误差电压输出端（接伺服放大器）
        this.addPort(termX + 25, termY + 30, 'z1', 'wire', 'Z1');
        this.addPort(termX + 25, termY + 50, 'z2', 'wire', 'Z2');
        
        // 输入轴（接收机转子位置）
        const shaftX = this._csCX;
        const shaftY = this._csY + this._csH + 6;
        this.addPort(shaftX, shaftY, 'shaft_in', 'pipe', '转子输入轴');
    }
    
    // ═══════════════════════════════════════════
    _init() {
        this._drawLabel();
        this._drawCrossSection();
        this._drawErrorCharacteristic();
        this._drawMeterPanel();
        this._drawWaveform();
        
    }
    
    _drawLabel() {
        this.group.add(new Konva.Text({
            x: 0, y: -22, width: this.width,
            text: `控制式自整角机接收机  ${this.excitationVoltage}V/${this.excitationFreq}Hz  ` +
                  `最大输出${this.outputVoltageMax}V 精度${this.accuracy}'  零位电压${(this.residualVoltage*1000).toFixed(0)}mV`,
            fontSize: 10, fontStyle: 'bold', fill: '#1a2634', align: 'center',
        }));
    }
    
    // ── 自整角机结构图（定子三相绕组 + 转子励磁绕组）──
    _drawCrossSection() {
        const { _csX: ex, _csY: ey, _csW: ew, _csH: eh, _csCX: ecx, _csCY: ecy } = this;
        
        this.group.add(new Konva.Rect({
            x: ex, y: ey, width: ew, height: eh,
            fill: '#0d1a24', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 5,
        }));
        this.group.add(new Konva.Text({
            x: ex, y: ey - 14, width: ew,
            text: '自整角机接收机 结构图', fontSize: 9, fontStyle: 'bold',
            fill: '#546e7a', align: 'center',
        }));
        
        // 外壳
        const mLeft  = ex + Math.round(ew * 0.10);
        const mRight = ex + ew - Math.round(ew * 0.10);
        const mTop   = ey + Math.round(eh * 0.12);
        const mBot   = ey + eh - Math.round(eh * 0.12);
        const mW     = mRight - mLeft;
        const mH     = mBot - mTop;
        const mCX    = (mLeft + mRight) / 2;
        const mCY    = (mTop + mBot) / 2;
        
        this.group.add(new Konva.Rect({ x: mLeft, y: mTop, width: mW, height: mH, fill: '#1c2b38', stroke: '#37474f', strokeWidth: 1.5, cornerRadius: 3 }));
        
        // 定子铁芯（圆环形）
        const statorR = Math.min(mW, mH) * 0.42;
        const statorW = statorR * 1.8;
        const statorH = statorR * 0.9;
        this.group.add(new Konva.Ellipse({ x: mCX, y: mCY, radiusX: statorW, radiusY: statorH, fill: '#455a64', stroke: '#263238', strokeWidth: 1 }));
        
        // 定子三相绕组（星形连接示意）
        const windingColors = ['#ef5350', '#4caf50', '#2196f3'];
        const windingAngles = [-90, 30, 150];  // 机械角度对应 0°, 120°, 240°
        this._statorWindings = [];
        windingAngles.forEach((angle, idx) => {
            const rad = angle * Math.PI / 180;
            const wx = mCX + statorW * 0.65 * Math.cos(rad);
            const wy = mCY + statorH * 0.65 * Math.sin(rad);
            const wdg = new Konva.Ellipse({
                x: wx, y: wy,
                radiusX: 12, radiusY: 7,
                fill: windingColors[idx], stroke: '#1a1a1a', strokeWidth: 0.8, opacity: 0.7,
                rotation: angle - 90,
            });
            this.group.add(wdg);
            this._statorWindings.push(wdg);
            
            // 接线端子
            const termX = mRight + 8;
            const termY = ecy - 40 + idx * 20;
            this.group.add(new Konva.Line({ points: [wx+8, wy, termX, termY], stroke: windingColors[idx], strokeWidth: 1, dash: [3,2] }));
            this.group.add(new Konva.Circle({ x: termX, y: termY, radius: 3.5, fill: windingColors[idx] }));
            this.group.add(new Konva.Text({ x: termX+5, y: termY-4, text: `S${idx+1}`, fontSize: 7, fill: windingColors[idx], fontStyle: 'bold' }));
        });
        
        // 转子铁芯（凸极或隐极）
        const rotorR = statorR * 0.55;
        this.group.add(new Konva.Ellipse({ x: mCX, y: mCY, radiusX: rotorR, radiusY: rotorR * 0.55, fill: '#607d8b', stroke: '#37474f', strokeWidth: 0.8 }));
        
        // 转子励磁绕组（单相，轴式）
        const rotorCoilW = rotorR * 1.1;
        const rotorCoilH = rotorR * 0.45;
        this._rotorCoil = new Konva.Rect({
            x: mCX - rotorCoilW/2, y: mCY - rotorCoilH/2,
            width: rotorCoilW, height: rotorCoilH,
            fill: '#ffb74d', stroke: '#e65100', strokeWidth: 1, cornerRadius: 3, opacity: 0.8,
        });
        this.group.add(this._rotorCoil);
        
        // 滑环（转子励磁输入）
        const slipRingY = mBot - 15;
        this.group.add(new Konva.Rect({ x: mCX-8, y: slipRingY-3, width: 16, height: 6, fill: '#d4a017', stroke: '#8d6e63', strokeWidth: 0.8, cornerRadius: 2 }));
        this.group.add(new Konva.Line({ points: [mCX-8, slipRingY, mLeft-8, slipRingY], stroke: '#ffa726', strokeWidth: 1, dash: [3,2] }));
        this.group.add(new Konva.Text({ x: mLeft-25, y: slipRingY-5, text: '励磁输入', fontSize: 6.5, fill: '#ffa726' }));
        
        // 输出轴（转角输入）
        this.group.add(new Konva.Rect({ x: mCX-3, y: mBot, width: 6, height: 12, fill: '#78909c', stroke: '#546e7a', strokeWidth: 0.8 }));
        
        // 误差电压输出端子（转子输出）
        const outX = mRight + 8;
        const outY = ecy + 30;
        this.group.add(new Konva.Line({ points: [mCX+rotorR*0.6, mCY+rotorH*0.3, outX, outY], stroke: '#ce93d8', strokeWidth: 1, dash: [3,2] }));
        this.group.add(new Konva.Circle({ x: outX, y: outY, radius: 3.5, fill: '#ce93d8' }));
        this.group.add(new Konva.Text({ x: outX+5, y: outY-4, text: 'Z1', fontSize: 7, fill: '#ce93d8', fontStyle: 'bold' }));
        this.group.add(new Konva.Line({ points: [mCX+rotorR*0.6, mCY+rotorH*0.3+15, outX, outY+20], stroke: '#ce93d8', strokeWidth: 1, dash: [3,2] }));
        this.group.add(new Konva.Circle({ x: outX, y: outY+20, radius: 3.5, fill: '#ce93d8' }));
        this.group.add(new Konva.Text({ x: outX+5, y: outY+16, text: 'Z2', fontSize: 7, fill: '#ce93d8', fontStyle: 'bold' }));
        
        this._mCX = mCX; this._mCY = mCY;
        this._rotorR = rotorR;
    }
    
    // ── 误差特性曲线 Uout = f(Δθ) ──
    _drawErrorCharacteristic() {
        const { _charX: cx, _charY: cy, _charW: cw, _charH: ch } = this;
        
        this.group.add(new Konva.Rect({ x: cx, y: cy, width: cw, height: ch, fill: '#010d18', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 4 }));
        this.group.add(new Konva.Rect({ x: cx, y: cy, width: cw, height: 13, fill: '#0a1a28', cornerRadius: [4,4,0,0] }));
        this.group.add(new Konva.Text({ x: cx+4, y: cy+2, width: cw-8, text: '误差特性曲线 U_out = K·sin(Δθ)', fontSize: 8, fontStyle: 'bold', fill: '#80cbc4', align: 'center' }));
        
        const ox = cx + 40, oy = cy + ch - 20, aw = cw - 60, ah = ch - 40;
        
        // 坐标轴
        this.group.add(new Konva.Line({ points: [ox, oy-ah, ox, oy, ox+aw, oy], stroke: '#37474f', strokeWidth: 0.8 }));
        this.group.add(new Konva.Text({ x: ox-20, y: oy-ah+10, text: 'U_out', fontSize: 7, fill: '#80cbc4', rotation: -90 }));
        this.group.add(new Konva.Text({ x: ox+aw-15, y: oy+5, text: 'Δθ (°)', fontSize: 7, fill: '#80cbc4' }));
        
        // 刻度
        for (let deg = -180; deg <= 180; deg += 45) {
            const x = ox + (deg + 180) / 360 * aw;
            const y0 = oy;
            this.group.add(new Konva.Line({ points: [x, y0-3, x, y0+3], stroke: '#546e7a', strokeWidth: 0.5 }));
            if (Math.abs(deg) % 90 === 0) {
                this.group.add(new Konva.Text({ x: x-6, y: y0+5, text: `${deg}`, fontSize: 6, fill: '#546e7a' }));
            }
        }
        
        // 正弦曲线
        const sinPts = [];
        for (let deg = -180; deg <= 180; deg += 2) {
            const rad = deg * Math.PI / 180;
            const uNorm = Math.sin(rad);
            const x = ox + (deg + 180) / 360 * aw;
            const y = oy - uNorm * (ah - 8);
            sinPts.push(x, y);
        }
        this._sinCurve = new Konva.Line({ points: sinPts, stroke: '#4fc3f7', strokeWidth: 2 });
        this.group.add(this._sinCurve);
        
        // 工作点标记
        this._workPoint = new Konva.Circle({ x: ox + aw/2, y: oy, radius: 6, fill: '#ff7043', stroke: '#fff', strokeWidth: 1.5 });
        this.group.add(this._workPoint);
        
        // 零位电压指示线（水平虚线）
        this._nullLine = new Konva.Line({ points: [ox, oy-2, ox+aw, oy-2], stroke: '#ffa726', strokeWidth: 1, dash: [5,5] });
        this.group.add(this._nullLine);
        
        // 精度区域（±精度线）
        const accDeg = this.accuracy / 60;  // 角分转度
        const accX1 = ox + (accDeg + 180) / 360 * aw;
        const accX2 = ox + (-accDeg + 180) / 360 * aw;
        this.group.add(new Konva.Line({ points: [accX1, oy-ah, accX1, oy+5], stroke: '#ef5350', strokeWidth: 0.8, dash: [4,3] }));
        this.group.add(new Konva.Line({ points: [accX2, oy-ah, accX2, oy+5], stroke: '#ef5350', strokeWidth: 0.8, dash: [4,3] }));
        
        this._charOx = ox; this._charOy = oy; this._charAw = aw; this._charAh = ah;
    }
    
    // ── 仪表面板 ──
    _drawMeterPanel() {
        const { _meterX: mx, _meterY: my, _meterW: mw, _meterH: mh } = this;
        
        this.group.add(new Konva.Rect({ x: mx, y: my, width: mw, height: mh, fill: '#020c14', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 4 }));
        this.group.add(new Konva.Rect({ x: mx, y: my, width: mw, height: 13, fill: '#0a1a28', cornerRadius: [4,4,0,0] }));
        this.group.add(new Konva.Text({ x: mx+4, y: my+2, width: mw-8, text: '运行数据', fontSize: 8, fontStyle: 'bold', fill: '#80cbc4', align: 'center' }));
        
        const cellW = (mw - 16) / 4;
        const cells = [
            { label: '发送角', id: 'send', unit: '°', color: '#4fc3f7', formatter: v => v.toFixed(1) },
            { label: '接收角', id: 'recv', unit: '°', color: '#66bb6a', formatter: v => v.toFixed(1) },
            { label: '角度差', id: 'delta', unit: '°', color: '#ffa726', formatter: v => v.toFixed(2) },
            { label: '误差(AC)', id: 'errAc', unit: 'V', color: '#ef5350', formatter: v => v.toFixed(2) },
            { label: '误差(DC)', id: 'errDc', unit: 'V', color: '#ce93d8', formatter: v => v.toFixed(3) },
            { label: '输出电流', id: 'curr', unit: 'mA', color: '#80cbc4', formatter: v => (v*1000).toFixed(1) },
            { label: '励磁电压', id: 'exc', unit: 'V', color: '#ffd54f', formatter: v => v.toFixed(0) },
            { label: '温度', id: 'temp', unit: '°C', color: '#ff7043', formatter: v => v.toFixed(0) },
        ];
        
        this._meterCells = {};
        cells.forEach(({ label, id, unit, color, formatter }, i) => {
            const col = i % 4;
            const row = Math.floor(i / 4);
            const x = mx + 8 + col * cellW;
            const y = my + 18 + row * 38;
            
            this.group.add(new Konva.Rect({ x, y, width: cellW-6, height: 32, fill: '#0d1520', stroke: '#1a3040', strokeWidth: 0.6, cornerRadius: 2 }));
            this.group.add(new Konva.Text({ x, y: y+3, width: cellW-6, text: label, fontSize: 7, fill: '#546e7a', align: 'center' }));
            
            const valText = new Konva.Text({
                x, y: y+14, width: cellW-6,
                text: '0', fontSize: 12, fontFamily: 'Courier New, monospace',
                fontStyle: 'bold', fill: color, align: 'center',
            });
            this.group.add(valText);
            this.group.add(new Konva.Text({ x, y: y+26, width: cellW-6, text: unit, fontSize: 6, fill: '#37474f', align: 'center' }));
            
            this._meterCells[id] = { text: valText, formatter };
        });
        
        // 状态指示
        this._syncIndicator = new Konva.Circle({ x: mx+mw-15, y: my+15, radius: 5, fill: '#c62828' });
        this._syncText = new Konva.Text({ x: mx+mw-45, y: my+10, text: '失同步', fontSize: 7, fill: '#ef5350' });
        this.group.add(this._syncIndicator, this._syncText);
    }
    
    // ── 波形显示区 ──
    _drawWaveform() {
        const { _wavX: wx, _wavY: wy, _wavW: ww, _wavH: wh } = this;
        if (wh < 40) return;
        
        this.group.add(new Konva.Rect({ x: wx, y: wy, width: ww, height: wh, fill: '#010d18', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 4 }));
        this.group.add(new Konva.Rect({ x: wx, y: wy, width: ww, height: 14, fill: '#0a1a28', cornerRadius: [4,4,0,0] }));
        this.group.add(new Konva.Text({ x: wx+4, y: wy+2, width: ww-8, text: '三相输入电压 (S1-S3, S2-S4, S3-S5)    误差电压波形', fontSize: 8, fontStyle: 'bold', fill: '#80cbc4', align: 'center' }));
        
        const ox = wx + 20, oy = wy + wh - 20, aw = ww - 40, ah = wh - 58;
        
        // 坐标轴
        this.group.add(new Konva.Line({ points: [ox, oy-ah, ox, oy, ox+aw, oy], stroke: '#37474f', strokeWidth: 0.8 }));
        
        // 三相电压波形（小三行）
        const h3 = ah * 0.28;
        for (let i = 0; i < 3; i++) {
            const yOff = (i - 1) * h3;
            this.group.add(new Konva.Line({ points: [ox, oy+yOff, ox+aw, oy+yOff], stroke: 'rgba(100,100,100,0.3)', strokeWidth: 0.5 }));
        }
        
        this._waveU1 = new Konva.Line({ points: [], stroke: '#ef5350', strokeWidth: 1.2 });
        this._waveU2 = new Konva.Line({ points: [], stroke: '#4caf50', strokeWidth: 1.2 });
        this._waveU3 = new Konva.Line({ points: [], stroke: '#2196f3', strokeWidth: 1.2 });
        this._waveErr = new Konva.Line({ points: [], stroke: '#ffd54f', strokeWidth: 1.5 });
        
        this.group.add(this._waveU1, this._waveU2, this._waveU3, this._waveErr);
        
        // 图例
        const legX = wx + 10, legY = wy + 20;
        [['U_S1S3', '#ef5350'], ['U_S2S4', '#4caf50'], ['U_S3S5', '#2196f3'], ['U_error', '#ffd54f']].forEach(([lbl, col], i) => {
            this.group.add(new Konva.Line({ points: [legX + i*70, legY, legX + i*70 + 12, legY], stroke: col, strokeWidth: 1.5 }));
            this.group.add(new Konva.Text({ x: legX + i*70 + 14, y: legY-4, text: lbl, fontSize: 6, fill: col }));
        });
        
        this._wavOx = ox; this._wavOy = oy; this._wavAw = aw; this._wavAh = ah;
        this._wavH3 = h3;
    }
    
    // ═══════════════════════════════════════════ 物理仿真
    // 集中化 tick（由 consys._tickAll 在 20fps 调用）
    tick(dt) {
        this._time += dt;
        this._tickPhysics(dt);
        this._tickVisuals();
        this._refreshCache();
    }
    
    _stopAnimation() {
        if (this._animId) {
            cancelAnimationFrame(this._animId);
        }
    }
    
    // ── 物理仿真 ──
    _tickPhysics(dt) {
        // 获取发送机角度（外部或手动）
        if (this._manualMode) {
            this._thetaSender = this._manualSender;
        } else {
            // 从 S1, S2, S3 端口解码角度
            const portS1 = this.getPort('s1');
            const portS2 = this.getPort('s2');
            const portS3 = this.getPort('s3');
            
            if (portS1 && portS1.connectedComponent && portS1.connectedComponent.getTheta) {
                // 如果连接的是发送机，直接获取角度
                this._thetaSender = portS1.connectedComponent.getTheta?.() || 0;
            } else if (portS1 && portS1.voltage !== undefined) {
                // 模拟：从三相电压解算角度
                this._thetaSender = this._decodeAngleFromVoltage(portS1.voltage, portS2.voltage, portS3.voltage);
            }
        }
        
        // 获取接收机转子角度（从输入轴）
        const shaftPort = this.getPort('shaft_in');
        if (shaftPort && shaftPort.connectedComponent) {
            const extTheta = shaftPort.connectedComponent.getPosition?.() || 
                            shaftPort.connectedComponent.getTheta?.() || 0;
            this._thetaReceiver = extTheta;
        }
        
        // 角度差（度）
        this._deltaTheta = this._thetaSender - this._thetaReceiver;
        // 归一化到 -180 到 180 度
        while (this._deltaTheta > 180) this._deltaTheta -= 360;
        while (this._deltaTheta < -180) this._deltaTheta += 360;
        
        const deltaRad = this._deltaTheta * Math.PI / 180;
        
        // 励磁电压瞬时值
        const omega = 2 * Math.PI * this.excitationFreq;
        this._excitation = this.excitationVoltage * Math.sqrt(2) * Math.sin(omega * this._time);
        this._phaseRef = omega * this._time;
        
        // 计算三相输入电压（理论值，基于发送机角度）
        // U_s1s3 = Um·cos(ωt)·cos(θ_sender)
        // U_s2s4 = Um·cos(ωt)·cos(θ_sender - 120°)
        // U_s3s5 = Um·cos(ωt)·cos(θ_sender - 240°)
        const Um = this.excitationVoltage * Math.sqrt(2);  // 峰值
        const cosWt = Math.cos(omega * this._time);
        const thetaRad = this._thetaSender * Math.PI / 180;
        
        this._uS1s3 = Um * cosWt * Math.cos(thetaRad);
        this._uS2s4 = Um * cosWt * Math.cos(thetaRad - 2*Math.PI/3);
        this._uS3s5 = Um * cosWt * Math.cos(thetaRad - 4*Math.PI/3);
        
        // 接收机输出电压（误差电压）
        // U_error = K·Um·sin(Δθ)·cos(ωt + φ)
        // 简化模型：K 由输出最大电压决定
        const K = this.outputVoltageMax / this.excitationVoltage;
        const errorPeak = K * this.excitationVoltage * Math.sin(deltaRad);
        
        this._errorVoltageAC = errorPeak * Math.sin(omega * this._time + Math.PI/2);
        this._errorVoltageRMS = Math.abs(errorPeak / Math.sqrt(2));
        
        // 零位电压（残余电压）
        const nullVoltage = this.residualVoltage * Math.sin(2 * deltaRad);
        this._errorVoltageAC += nullVoltage * Math.sin(omega * this._time);
        
        // 温度补偿
        const tempFactor = 1 + this.tempCoef / 100 * (this._temp - 25);
        this._errorVoltageAC *= tempFactor;
        this._errorVoltageRMS *= tempFactor;
        
        // 相敏整流（得到直流误差信号）
        // 与励磁参考相位同步解调
        const refSignal = Math.sin(omega * this._time);
        const rawDC = this._errorVoltageAC * refSignal * 2;
        // 低通滤波
        const tau = 0.01;  // 10ms 滤波
        const alpha = dt / (tau + dt);
        this._dcError = this._dcError * (1 - alpha) + rawDC * alpha;
        
        // 输出电流
        this._outputCurrent = this._errorVoltageRMS / this.loadResistance;
        
        // 更新波形缓冲
        this._wavThetaS = new Float32Array([...this._wavThetaS.slice(1), this._thetaSender]);
        this._wavThetaR = new Float32Array([...this._wavThetaR.slice(1), this._thetaReceiver]);
        this._wavErrAC  = new Float32Array([...this._wavErrAC.slice(1), this._errorVoltageAC]);
        this._wavErrDC  = new Float32Array([...this._wavErrDC.slice(1), this._dcError]);
        this._wavU1     = new Float32Array([...this._wavU1.slice(1), this._uS1s3]);
        this._wavU2     = new Float32Array([...this._wavU2.slice(1), this._uS2s4]);
        this._wavU3     = new Float32Array([...this._wavU3.slice(1), this._uS3s5]);
    }
    
    // 从三相电压解算角度（用于外部输入模拟）
    _decodeAngleFromVoltage(u1, u2, u3) {
        // 简化解码：基于电压幅值比
        const Um = Math.sqrt(2) * this.excitationVoltage;
        const cosTheta = u1 / (Um * Math.cos(this._phaseRef) + 1e-9);
        const cosTheta120 = u2 / (Um * Math.cos(this._phaseRef) + 1e-9);
        
        let theta = Math.acos(Math.min(1, Math.max(-1, cosTheta))) * 180 / Math.PI;
        // 根据符号判断象限
        if (cosTheta120 < -0.5) theta = 360 - theta;
        return theta;
    }
    
    // ── 可视化更新 ──
    _tickVisuals() {
        // 更新仪表
        if (this._meterCells) {
            this._meterCells.send.text.text(this._meterCells.send.formatter(this._thetaSender));
            this._meterCells.recv.text.text(this._meterCells.recv.formatter(this._thetaReceiver));
            this._meterCells.delta.text.text(this._meterCells.delta.formatter(this._deltaTheta));
            this._meterCells.errAc.text.text(this._meterCells.errAc.formatter(this._errorVoltageRMS));
            this._meterCells.errDc.text.text(this._meterCells.errDc.formatter(this._dcError));
            this._meterCells.curr.text.text(this._meterCells.curr.formatter(this._outputCurrent));
            this._meterCells.exc.text.text(this._meterCells.exc.formatter(this.excitationVoltage));
            this._meterCells.temp.text.text(this._meterCells.temp.formatter(this._temp));
        }
        
        // 同步指示
        if (this._syncIndicator && Math.abs(this._deltaTheta) < this.accuracy / 60 + 0.1) {
            this._syncIndicator.fill('#2e7d32');
            this._syncText.text('同步');
            this._syncText.fill('#66bb6a');
        } else {
            this._syncIndicator.fill('#c62828');
            this._syncText.text('失同步');
            this._syncText.fill('#ef5350');
        }
        
        // 转子动画（根据接收角旋转）
        if (this._rotorCoil) {
            const rotAngle = this._thetaReceiver;
            this._rotorCoil.rotation(rotAngle);
        }
        
        // 工作点更新
        if (this._workPoint && this._charOx) {
            const deltaNorm = Math.min(1, Math.max(-1, this._deltaTheta / 180));
            const uNorm = Math.sin(this._deltaTheta * Math.PI / 180);
            const x = this._charOx + (deltaNorm + 1) / 2 * this._charAw;
            const y = this._charOy - uNorm * (this._charAh - 8);
            this._workPoint.x(x);
            this._workPoint.y(y);
        }
        
        // 更新波形
        if (this._wavOx) {
            const n = this._wavLen;
            const dx = this._wavAw / n;
            const maxU = this.excitationVoltage * 1.5;
            const maxErr = this.outputVoltageMax * 1.2;
            
            const ptsU1 = [], ptsU2 = [], ptsU3 = [], ptsErr = [];
            for (let i = 0; i < n; i++) {
                const x = this._wavOx + i * dx;
                const u1Norm = Math.min(1, Math.abs(this._wavU1[i]) / maxU);
                const u2Norm = Math.min(1, Math.abs(this._wavU2[i]) / maxU);
                const u3Norm = Math.min(1, Math.abs(this._wavU3[i]) / maxU);
                const errNorm = Math.min(1, Math.abs(this._wavErrAC[i]) / maxErr);
                
                ptsU1.push(x, this._wavOy - u1Norm * this._wavH3 - this._wavH3);
                ptsU2.push(x, this._wavOy - u2Norm * this._wavH3);
                ptsU3.push(x, this._wavOy - u3Norm * this._wavH3 + this._wavH3);
                ptsErr.push(x, this._wavOy - errNorm * (this._wavAh - 4));
            }
            this._waveU1.points(ptsU1);
            this._waveU2.points(ptsU2);
            this._waveU3.points(ptsU3);
            this._waveErr.points(ptsErr);
        }
    }
    
    // ── 角度解码（核心功能）──
    /**
     * 根据三相输入电压计算发送机角度
     * @returns {number} 发送机角度（度）
     */
    decodeAngle() {
        // 峰值检测（简化：使用有效值）
        const u1rms = this._uS1s3 / Math.sqrt(2);
        const u2rms = this._uS2s4 / Math.sqrt(2);
        const u3rms = this._uS3s5 / Math.sqrt(2);
        
        // 基于电压比例计算角度
        // 理论上：U1 ∝ cosθ, U2 ∝ cos(θ-120°), U3 ∝ cos(θ-240°)
        let theta = Math.atan2((u2rms - u3rms) / Math.sqrt(3), u1rms) * 180 / Math.PI;
        if (theta < 0) theta += 360;
        return theta;
    }
    
    /**
     * 获取误差电压（交流有效值）
     * @returns {number} 误差电压（V RMS）
     */
    getErrorVoltage() {
        return this._errorVoltageRMS;
    }
    
    /**
     * 获取直流误差信号（相敏整流后）
     * @returns {number} 直流误差电压（V）
     */
    getDCError() {
        return this._dcError;
    }
    
    /**
     * 获取角度差
     * @returns {number} 角度差（度）
     */
    getDeltaTheta() {
        return this._deltaTheta;
    }
    
    /**
     * 获取发送机角度
     * @returns {number} 发送机角度（度）
     */
    getSenderTheta() {
        return this._thetaSender;
    }
    
    /**
     * 获取接收机角度
     * @returns {number} 接收机角度（度）
     */
    getReceiverTheta() {
        return this._thetaReceiver;
    }
    
    /**
     * 设置接收机角度（模拟转子位置）
     * @param {number} theta - 角度（度）
     */
    setReceiverTheta(theta) {
        this._thetaReceiver = theta;
    }
    
    /**
     * 设置发送机角度（手动模式）
     * @param {number} theta - 发送机角度（度）
     */
    setSenderTheta(theta) {
        this._manualSender = theta;
        this._manualMode = true;
    }
    
    /**
     * 设置工作模式
     * @param {boolean} manual - 是否手动模式
     */
    setManualMode(manual) {
        this._manualMode = manual;
    }
    
    /**
     * 设置励磁电压
     * @param {number} voltage - 励磁电压（V RMS）
     */
    setExcitationVoltage(voltage) {
        this.excitationVoltage = voltage;
    }
    
    /**
     * 设置温度
     * @param {number} temp - 温度（°C）
     */
    setTemperature(temp) {
        this._temp = temp;
    }
    
    /**
     * 更新配置
     */
    update(cfg = {}) {
        if (cfg.senderTheta !== undefined) this.setSenderTheta(cfg.senderTheta);
        if (cfg.receiverTheta !== undefined) this.setReceiverTheta(cfg.receiverTheta);
        if (cfg.excitationVoltage !== undefined) this.setExcitationVoltage(cfg.excitationVoltage);
        if (cfg.temp !== undefined) this.setTemperature(cfg.temp);
        this._refreshCache();
    }
    
    /**
     * 获取配置字段
     */
    getConfigFields() {
        return [
            { label: '位号/名称', key: 'id', type: 'text' },
            { label: '励磁电压 (V)', key: 'excitationVoltage', type: 'number', step: 10, min: 50, max: 250 },
            { label: '励磁频率 (Hz)', key: 'excitationFreq', type: 'number', step: 50, min: 50, max: 400 },
            { label: '最大输出 (V)', key: 'outputVoltageMax', type: 'number', step: 5, min: 20, max: 120 },
            { label: '精度 (角分)', key: 'accuracy', type: 'number', step: 1, min: 3, max: 30 },
            { label: '零位电压 (mV)', key: 'residualVoltage', type: 'number', step: 5, min: 5, max: 100 },
            { label: '输出阻抗 (Ω)', key: 'outputImpedance', type: 'number', step: 10, min: 20, max: 500 },
            { label: '负载电阻 (kΩ)', key: 'loadResistance', type: 'number', step: 1, min: 1, max: 100 },
            { label: '温度系数 (%/°C)', key: 'tempCoef', type: 'number', step: 0.01, min: -0.05, max: 0.05 },
        ];
    }
    
    onConfigUpdate(cfg) {
        const n = k => parseFloat(cfg[k]);
        if (cfg.id) this.id = cfg.id;
        if (cfg.excitationVoltage) this.excitationVoltage = n('excitationVoltage');
        if (cfg.excitationFreq) this.excitationFreq = n('excitationFreq');
        if (cfg.outputVoltageMax) this.outputVoltageMax = n('outputVoltageMax');
        if (cfg.accuracy) this.accuracy = n('accuracy');
        if (cfg.residualVoltage) this.residualVoltage = n('residualVoltage') / 1000;
        if (cfg.outputImpedance) this.outputImpedance = n('outputImpedance');
        if (cfg.loadResistance) this.loadResistance = n('loadResistance') * 1000;
        if (cfg.tempCoef) this.tempCoef = n('tempCoef');
        
        this.config = { ...this.config, ...cfg };
        this._refreshCache();
    }
    
    destroy() {
        super.destroy?.();
    }
}