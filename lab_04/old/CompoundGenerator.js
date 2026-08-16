// CompoundWiredDCGeneratorWithPrimeMover.js
import { BaseComponent } from '../BaseComponent.js';

/**
 * 复励直流发电机 + 可调速原动机仿真组件
 * （Compound DC Generator with Adjustable Speed Prime Mover）
 *
 * ── 系统组成 ──────────────────────────────────────────────────
 *  ┌─────────────────────────────────────────────────────────────┐
 *  │  原动机（柴油机/汽轮机）─── 复励直流发电机 ─── 负载        │
 *  │                                                             │
 *  │  调速器     │  励磁系统    │  电压调节器                   │
 *  │  转速控制   │  积/差复励   │  负载调节                     │
 *  └─────────────────────────────────────────────────────────────┘
 *
 * ── 原动机模型（柴油机仿真）────────────────────────────────────
 *  ① 调速器 PID 控制
 *  ② 燃油限制/转矩限制
 *  ③ 机械惯性 J_prime
 *  ④ 调速器设定值 n_ref
 *  ⑤ 油门位置 α（0-100%）
 *
 * ── 复励发电机模型 ────────────────────────────────────────────
 *  ① 并励绕组（提供基础磁场）
 *  ② 串励绕组（补偿电压降）
 *  ③ 积复励/差复励可切换
 *  ④ 电枢反应考虑
 *  ⑤ 饱和效应
 *
 * ── 控制功能 ──────────────────────────────────────────────────
 *  ① 原动机转速调节（滑条 + 数值输入）
 *  ② 复励方式切换（积复励/差复励）
 *  ③ 负载电阻调节
 *  ④ 励磁电流微调
 *
 * ── 监测参数 ──────────────────────────────────────────────────
 *  ① 转速 n (rpm) / 频率关系
 *  ② 输出电压 Vt
 *  ③ 负载电流 IL
 *  ④ 功率 P = Vt * IL
 *  ⑤ 效率 η
 *  ⑥ 电压调整率 ΔV%
 *  ⑦ 燃油消耗率（估算）
 *
 * ── 动态波形 ──────────────────────────────────────────────────
 *  Vt(t), IL(t), n(t), P(t), η(t)
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  wire_Vout_p   — 输出正极
 *  wire_Vout_n   — 输出负极
 *  pipe_shaft    — 原动机轴（输入）
 *  wire_speed    — 转速控制信号（4-20mA）
 *  wire_fuel     — 燃油输入
 *  wire_starter  — 启动信号
 */
export class CompoundGenerator extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(520, config.width  || 580);
        this.height = Math.max(420, config.height || 480);

        this.type    = 'compound_generator';
        this.special = 'none';
        this.cache   = 'fixed';

        this._initGroups();
        // ──────────────────────────────────────────
        //  发电机额定参数
        // ──────────────────────────────────────────
        this.Vn        = config.Vn        || 440;     // 额定电压 V
        this.In        = config.In        || 200;     // 额定电流 A
        this.Pn        = this.Vn * this.In / 1000;    // 额定功率 kW
        this.n_rated   = config.n_rated   || 1800;    // 额定转速 rpm
        this.f_rated   = this.n_rated / 60;           // 频率 Hz（4极）
        
        // 发电机电气参数
        this.Ra        = config.Ra        || 0.045;   // 电枢电阻 Ω
        this.Rse       = config.Rse       || 0.018;   // 串励绕组电阻 Ω
        this.Rsh       = config.Rsh       || 180;     // 并励绕组电阻 Ω
        this.Ke        = config.Ke        || 1.2;     // 电动势系数
        this.Kt        = config.Kt        || 1.2;     // 转矩系数
        
        // 励磁参数
        this.K_sh      = config.K_sh      || 0.0085;  // 并励磁通系数
        this.K_se      = config.K_se      || 0.0015;  // 串励磁通系数
        this.compoundType = config.compoundType || 'cumulative';
        this.armatureReaction = config.armatureReaction || 0.08;  // 电枢反应系数
        
        // 饱和参数
        this.saturationFactor = config.saturationFactor || 0.90;
        this.remnantFlux      = config.remnantFlux || 0.04;
        
        // ──────────────────────────────────────────
        //  原动机参数（柴油机模型）
        // ──────────────────────────────────────────
        this.J_prime    = config.J_prime    || 0.35;   // 总转动惯量 kg·m²
        this.B_prime    = config.B_prime    || 0.015;  // 阻尼系数
        this.maxTorque  = config.maxTorque  || 350;    // 最大输出扭矩 N·m
        this.minTorque  = config.minTorque  || 5;      // 最小怠速扭矩
        
        // 调速器 PID 参数
        this.Kp_speed   = config.Kp_speed   || 2.5;    // 比例增益
        this.Ki_speed   = config.Ki_speed   || 1.2;    // 积分增益
        this.Kd_speed   = config.Kd_speed   || 0.3;    // 微分增益
        
        // 燃油系统
        this.fuelEfficiency = config.fuelEfficiency || 0.28;  // 燃油效率 kg/kWh
        this.fuelRate       = 0;          // 瞬时油耗 kg/h
        this.totalFuel      = 0;          // 累计油耗 kg
        
        // 转速范围
        this.minSpeed    = config.minSpeed  || 600;    // 最低转速 rpm
        this.maxSpeed    = config.maxSpeed  || 2200;   // 最高转速 rpm
        this.speedSetpoint = config.speedSetpoint || this.n_rated;
        this.targetSpeed = this.speedSetpoint;
        
        // 调速器状态
        this._speedError   = 0;
        this._speedIntegral = 0;
        this._prevSpeedError = 0;
        this.throttlePos   = 0.6;          // 油门位置 0-1
        this.throttleCmd   = 0.6;
        
        // 启动系统
        self.isStarting    = false;
        self.isRunning     = true;
        self.startingTimer = 0;
        self.starterEngaged = false;
        
        // ──────────────────────────────────────────
        //  发电机状态变量
        // ──────────────────────────────────────────
        this.omega       = this.n_rated * 2 * Math.PI / 60;
        this.speed_rpm   = this.n_rated;
        
        this.Vt          = 0;             // 端电压 V
        this.Ia          = 0;             // 电枢电流 A
        this.IL          = 0;             // 负载电流 A
        this.If          = 0;             // 并励电流 A
        this.Ise         = 0;             // 串励电流 A
        this.Ea          = 0;             // 电动势 V
        
        this.phi_sh      = 0;
        this.phi_se      = 0;
        this.phi_total   = 0;
        
        this.torque_em   = 0;             // 电磁制动转矩 N·m
        this.torque_prime = 0;            // 原动机输出转矩 N·m
        
        this.mechPower   = 0;
        this.elecPower   = 0;
        this.efficiency  = 0;
        
        // 电压调整率
        this.voltageRegulation = 0;
        
        // 负载电阻
        this.loadResistance = config.loadResistance || this.Vn / this.In;
        this.targetResistance = this.loadResistance;
        
        // 状态标志
        this.isOverload     = false;
        self.isFieldLoss    = false;
        this.isOverspeed    = false;
        this.isUnderspeed   = false;
        
        // ──────────────────────────────────────────
        //  动画/显示
        // ──────────────────────────────────────────
        this._rotorAngle   = 0;
        this._phase        = 0;
        this._flywheelPhase = 0;
        
        // 波形缓冲
        this._wavLen   = 200;
        this._wavVt    = new Float32Array(this._wavLen).fill(0);
        this._wavIL    = new Float32Array(this._wavLen).fill(0);
        this._wavSpeed = new Float32Array(this._wavLen).fill(this.n_rated);
        this._wavPower = new Float32Array(this._wavLen).fill(0);
        this._wavAcc   = 0;
        
        // 燃油经济性历史
        this._fuelHistory = new Array(60).fill(0);
        
        // ──────────────────────────────────────────
        //  几何布局
        // ──────────────────────────────────────────
        this._genCX       = Math.round(this.width * 0.30);
        this._genCY       = Math.round(this.height * 0.42);
        this._statorR     = Math.round(Math.min(this.width * 0.16, this.height * 0.30));
        this._rotorR      = Math.round(this._statorR * 0.58);
        
        this._primeCX     = this._genCX - this._statorR - 50;
        this._primeCY     = this._genCY;
        this._primeW      = 70;
        this._primeH      = 60;
        
        this._headX       = Math.round(this.width * 0.52);
        this._headY       = 28;
        this._headW       = this.width - this._headX - 10;
        this._headH       = Math.round(this.height * 0.44);
        
        this._charX       = this._headX;
        this._charY       = this._headY + this._headH + 8;
        this._charW       = this._headW;
        this._charH       = Math.round(this.height * 0.20);
        
        this._controlX    = 8;
        this._controlY    = this._genCY + this._statorR + 20;
        this._controlW    = Math.round(this.width * 0.47);
        this._controlH    = this.height - this._controlY - 12;
        
        this._wavX        = this._controlX + this._controlW + 8;
        this._wavY        = this._controlY;
        this._wavW        = Math.round(this.width - this._wavX - 10);
        this._wavH        = this._controlH;
        
        this.knobs    = {};
        
        this.config = {
            id: this.id, Vn: this.Vn, In: this.In,
            n_rated: this.n_rated, compoundType: this.compoundType,
        };
        
        this._init();
        
        // ── 端口 ──
        this.addPort(this._genCX + this._statorR + 15, this._genCY - 18, 'vout_p', 'wire', 'V+');
        this.addPort(this._genCX + this._statorR + 15, this._genCY + 18, 'vout_n', 'wire', 'V-');
        this.addPort(this._primeCX - 15, this._primeCY, 'shaft', 'pipe', '输入轴');
        this.addPort(this._headX + this._headW - 15, this._headY + 40, 'speed', 'wire', '转速控制');
        this.addPort(this._primeCX, this._primeCY - 25, 'fuel', 'pipe', '燃油');
    }
    
    // ═══════════════════════════════════════════════
    //  初始化
    // ═══════════════════════════════════════════════
    _init() {
        this._drawLabel();
        this._drawPrimeMover();          // 原动机
        this._drawCoupling();             // 联轴器
        this._drawGeneratorStator();
        this._drawFieldWindings();
        this._drawRotorAssembly();
        this._drawInstrumentHead();
        this._drawLCD();
        this._drawSpeedControlPanel();
        this._drawGeneratorControlPanel();
        this._drawExternalCharacteristic();
        this._drawWaveform();
        
    }
    
    _drawLabel() {
        this._staticGroup.add(new Konva.Text({
            x: 0, y: -26, width: this.width,
            text: '复励直流发电机组（带可调速原动机）',
            fontSize: 13, fontStyle: 'bold', fill: '#1a2634', align: 'center',
        }));
        this._staticGroup.add(new Konva.Text({
            x: 0, y: -12, width: this.width,
            text: '柴油机模型 | PID调速器 | 积复励/差复励 | 负载调节',
            fontSize: 8.5, fill: '#607d8b', align: 'center',
        }));
    }
    
    // ── 原动机（柴油机/汽轮机）可视化 ─────────
    _drawPrimeMover() {
        const cx = this._primeCX, cy = this._primeCY;
        const w = this._primeW, h = this._primeH;
        
        // 机体
        const body = new Konva.Rect({
            x: cx - w/2, y: cy - h/2, width: w, height: h,
            fill: '#2e3b2e', stroke: '#1a2a1a', strokeWidth: 2, cornerRadius: 8,
        });
        
        // 气缸示意（4缸）
        for (let i = 0; i < 4; i++) {
            const cylX = cx - w/2 + 10 + i * 15;
            const cyl = new Konva.Rect({
                x: cylX, y: cy - h/2 + 8, width: 10, height: 25,
                fill: '#3e4e3e', stroke: '#2a3a2a', strokeWidth: 1, cornerRadius: 3,
            });
            this._staticGroup.add(cyl);
        }
        
        // 飞轮
        this._flywheel = new Konva.Group({ x: cx + w/2 + 12, y: cy });
        this._flywheel.add(new Konva.Circle({ radius: 18, fill: '#78909c', stroke: '#546e7a', strokeWidth: 2 }));
        this._flywheel.add(new Konva.Circle({ radius: 12, fill: '#607d8b' }));
        this._flywheel.add(new Konva.Line({ points: [0, -10, 0, 10], stroke: '#ffa726', strokeWidth: 2 }));
        this._staticGroup.add(this._flywheel);
        
        // 排气管
        const exhaust = new Konva.Rect({
            x: cx + w/2 - 8, y: cy - h/2 - 15, width: 16, height: 20,
            fill: '#6d4c41', stroke: '#4e342e', strokeWidth: 1.5, cornerRadius: 2,
        });
        // 烟雾效果（动态）
        this._exhaustSmoke = new Konva.Circle({
            x: cx + w/2, y: cy - h/2 - 25, radius: 0,
            fill: 'rgba(120,120,120,0.4)',
        });
        
        // 燃油入口
        const fuelIn = new Konva.Rect({
            x: cx - w/2 - 8, y: cy - 8, width: 10, height: 16,
            fill: '#ffa726', stroke: '#e65100', strokeWidth: 1, cornerRadius: 2,
        });
        
        // 转速标牌
        const rpmLabel = new Konva.Text({
            x: cx - 25, y: cy + h/2 + 2, width: 50,
            text: '调速器', fontSize: 7, fill: '#ffa726', align: 'center',
        });
        
        this._throttleIndicator = new Konva.Rect({
            x: cx - w/2 + 5, y: cy + h/2 - 15, width: 0, height: 5,
            fill: '#ffa726', cornerRadius: 2,
        });
        
        this._staticGroup.add(body, exhaust, this._exhaustSmoke, fuelIn, rpmLabel, this._throttleIndicator);
    }
    
    // ── 联轴器 ────────────────────────────────
    _drawCoupling() {
        const cx1 = this._primeCX + this._primeW/2 + 12;
        const cx2 = this._genCX - this._statorR - 8;
        
        const shaft = new Konva.Line({
            points: [cx1 + 18, this._primeCY, cx2, this._primeCY],
            stroke: '#78909c', strokeWidth: 6, lineCap: 'round',
        });
        
        const coupling1 = new Konva.Circle({ x: cx1 + 18, y: this._primeCY, radius: 8, fill: '#90a4ae', stroke: '#546e7a', strokeWidth: 1 });
        const coupling2 = new Konva.Circle({ x: cx2, y: this._primeCY, radius: 8, fill: '#90a4ae', stroke: '#546e7a', strokeWidth: 1 });
        
        this._staticGroup.add(shaft, coupling1, coupling2);
    }
    
    // ── 发电机定子 ────────────────────────────
    _drawGeneratorStator() {
        const cx = this._genCX, cy = this._genCY, R = this._statorR;
        
        this._staticGroup.add(new Konva.Circle({ x: cx, y: cy, radius: R+12, fill: '#37474f', stroke: '#263238', strokeWidth: 2.5 }));
        for (let i = 0; i < 4; i++) {
            const a = (i/4)*Math.PI*2 + Math.PI/4;
            this._staticGroup.add(new Konva.Circle({ x: cx+(R+9)*Math.cos(a), y: cy+(R+9)*Math.sin(a), radius: 5, fill: '#263238' }));
        }
        this._staticGroup.add(new Konva.Circle({ x: cx, y: cy, radius: R, fill: '#0a1520' }));
        this._staticGroup.add(new Konva.Text({ x: cx-R, y: cy-R-22, width: R*2, text: '复励发电机', fontSize: 8, fontStyle: 'bold', fill: '#4fc3f7', align: 'center' }));
    }
    
    // ── 励磁绕组（并励+串励）─────────────────
    _drawFieldWindings() {
        const cx = this._genCX, cy = this._genCY, R = this._statorR;
        const poleCount = 4;
        
        for (let i = 0; i < poleCount; i++) {
            const poleAngle = (i/poleCount) * Math.PI * 2;
            const ir = R - 24, or = R - 6;
            const isN = i % 2 === 0;
            
            // 并励（蓝色细线）
            for (let t = 0; t < 5; t++) {
                this._staticGroup.add(new Konva.Arc({
                    x: cx, y: cy, innerRadius: ir + t*2, outerRadius: ir + 4 + t*2,
                    angle: 32, rotation: (poleAngle - 16) * 180 / Math.PI - 90,
                    fill: 'none', stroke: '#42a5f5', strokeWidth: 1.2, opacity: 0.6,
                }));
            }
            
            // 串励（橙色粗线，叠加）
            for (let t = 0; t < 3; t++) {
                this._staticGroup.add(new Konva.Arc({
                    x: cx, y: cy, innerRadius: ir - 2 + t*3, outerRadius: ir + 2 + t*3,
                    angle: 38, rotation: (poleAngle - 19) * 180 / Math.PI - 90,
                    fill: 'none', stroke: '#ffa726', strokeWidth: 2.2, opacity: 0.85,
                }));
            }
            
            // 极靴
            this._staticGroup.add(new Konva.Arc({
                x: cx, y: cy, innerRadius: ir-6, outerRadius: ir+2,
                angle: 48, rotation: (poleAngle - 24) * 180 / Math.PI - 90,
                fill: '#455a64', stroke: '#2a3a44', strokeWidth: 0.8,
            }));
            
            const mr = (ir + or) / 2;
            this._staticGroup.add(new Konva.Text({
                x: cx + mr * Math.cos(poleAngle - Math.PI/2) - 4,
                y: cy + mr * Math.sin(poleAngle - Math.PI/2) - 5,
                width: 8, text: isN ? 'N' : 'S',
                fontSize: 7, fontStyle: 'bold', fill: '#fff', align: 'center',
            }));
        }
    }
    
    _drawRotorAssembly() {
        const cx = this._genCX, cy = this._genCY;
        this._rotorGroup = new Konva.Group({ x: cx, y: cy });
        const R = this._rotorR;
        
        this._rotorGroup.add(new Konva.Circle({ radius: R, fill: '#546e7a', stroke: '#37474f', strokeWidth: 1.5 }));
        this._rotorGroup.add(new Konva.Circle({ radius: R*0.85, fill: '#455a64' }));
        
        // 电枢线圈示意
        this._armCoils = [];
        for (let i = 0; i < 12; i++) {
            const a = (i/12) * Math.PI * 2;
            const coil = new Konva.Line({
                points: [R*0.5 * Math.cos(a), R*0.5 * Math.sin(a), R*0.82 * Math.cos(a), R*0.82 * Math.sin(a)],
                stroke: '#ffcc80', strokeWidth: 1.5, lineCap: 'round',
            });
            this._armCoils.push(coil);
            this._rotorGroup.add(coil);
        }
        
        this._staticGroup.add(this._rotorGroup);
    }
    
    // ── 仪表头 ────────────────────────────────
    _drawInstrumentHead() {
        const hx = this._headX, hy = this._headY, hw = this._headW, hh = this._headH;
        
        const jbox = new Konva.Rect({ x: hx, y: hy, width: hw, height: 44, fill: '#cfd8dc', stroke: '#90a4ae', strokeWidth: 1.5, cornerRadius: [5,5,0,0] });
        const plate = new Konva.Rect({ x: hx+6, y: hy+4, width: hw-12, height: 28, fill: '#eceff1', stroke: '#b0bec5', strokeWidth: 0.5, cornerRadius: 2 });
        
        this._idText = new Konva.Text({ x: hx+6, y: hy+7, width: hw-12, text: this.id || 'GENSET-01', fontSize: 9, fontStyle: 'bold', fill: '#263238', align: 'center' });
        this._staticGroup.add(new Konva.Text({ x: hx+6, y: hy+17, width: hw-12, text: `${this.Vn}V  ${this.Pn.toFixed(1)}kW  ${this.n_rated}rpm`, fontSize: 7.5, fill: '#78909c', align: 'center' }));
        
        const body = new Konva.Rect({ x: hx, y: hy+44, width: hw, height: hh-44, fill: '#1e2a36', stroke: '#0d1520', strokeWidth: 1.5, cornerRadius: [0,0,4,4] });
        this._staticGroup.add(jbox, plate, this._idText, body);
    }
    
    // ── LCD 显示 ──────────────────────────────
    _drawLCD() {
        const hx = this._headX, hw = this._headW;
        const lcy = this._headY + 44 + (this._headH-44)*0.45;
        const lcx = hx + hw/2;
        const R = Math.min(hw*0.35, 52);
        
        this._staticGroup.add(new Konva.Circle({ x: lcx, y: lcy, radius: R+4, fill: '#0d1520', stroke: '#1a252f', strokeWidth: 1 }));
        const ring = new Konva.Circle({ x: lcx, y: lcy, radius: R+2, fill: '#0a2040', stroke: '#4fc3f7', strokeWidth: 2.5 });
        this._lcdBg = new Konva.Circle({ x: lcx, y: lcy, radius: R, fill: '#020c14' });
        
        this._lcdMain = new Konva.Text({ x: lcx-R+4, y: lcy-R*0.42, width:(R-4)*2, text:'0.0', fontSize:R*0.42, fontFamily:'Courier New, monospace', fontStyle:'bold', fill:'#4fc3f7', align:'center' });
        this._lcdUnit = new Konva.Text({ x: lcx-R+4, y: lcy+R*0.10, width:(R-4)*2, text:'V', fontSize:R*0.16, fill:'#0a2040', align:'center' });
        this._lcdkW = new Konva.Text({ x: lcx-R+4, y: lcy+R*0.28, width:(R-4)*2, text:'0.0kW', fontSize:R*0.12, fontFamily:'Courier New, monospace', fill:'#fff59d', align:'center' });
        this._lcdEta = new Konva.Text({ x: lcx-R+4, y: lcy-R*0.62, width:(R-4)*2, text:'η=0%', fontSize:R*0.11, fontFamily:'Courier New, monospace', fill:'#ffcc80', align:'center' });
        
        this._rpmArc = new Konva.Arc({ x: lcx, y: lcy, innerRadius: R-5, outerRadius: R-3, angle: 0, fill: '#ffa726', rotation: -90 });
        
        this._staticGroup.add(ring, this._lcdBg, this._rpmArc, this._lcdMain, this._lcdUnit, this._lcdkW, this._lcdEta);
    }
    
    // ── 转速控制面板（原动机调速）─────────────
    _drawSpeedControlPanel() {
        const px = this._controlX, py = this._controlY;
        const pw = this._controlW, ph = this._controlH;
        
        const bg = new Konva.Rect({ x: px, y: py, width: pw, height: ph, fill: '#020c14', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 4 });
        const titleBg = new Konva.Rect({ x: px, y: py, width: pw, height: 16, fill: '#0a1a28', cornerRadius: [4,4,0,0] });
        this._staticGroup.add(new Konva.Text({ x: px+4, y: py+2, width: pw-8, text: '● 原动机控制（PID调速器）', fontSize: 8, fontStyle: 'bold', fill: '#ffa726', align: 'center' }));
        
        this._staticGroup.add(bg, titleBg);
        
        // 转速设定滑块
        const sliderY = py + 24;
        const barX = px + 6, barW = pw - 50;
        this._staticGroup.add(new Konva.Rect({ x: barX, y: sliderY, width: barW, height: 8, fill: '#0d2030', cornerRadius: 4 }));
        this._speedBar = new Konva.Rect({ x: barX, y: sliderY, width: 0, height: 8, fill: '#ffa726', cornerRadius: 4 });
        this._staticGroup.add(this._speedBar);
        
        // 转速数值显示
        this._speedValText = new Konva.Text({ x: barX + barW + 6, y: sliderY-2, width: 36, text: '0rpm', fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#ffa726' });
        this._staticGroup.add(this._speedValText);
        
        // 转速设定滑条
        const sliderHit = new Konva.Rect({ x: barX, y: sliderY-6, width: barW, height: 20, fill: 'transparent', listening: true });
        sliderHit.on('mousedown touchstart', e => {
            e.cancelBubble = true;
            this._speedDrag = true;
            this._updateSpeed(e, barX, barW);
        });
        const sm = e => { if (this._speedDrag) this._updateSpeed(e, barX, barW); };
        const su = () => { this._speedDrag = false; };
        window.addEventListener('mousemove', sm);
        window.addEventListener('touchmove', sm, { passive: true });
        window.addEventListener('mouseup', su);
        window.addEventListener('touchend', su);
        this._interactGroup.add(sliderHit);
        
        this._speedBarX = barX; this._speedBarW = barW;
        
        // 启动/停止按钮
        const btnY = py + 46;
        const startBtn = new Konva.Rect({ x: px + 6, y: btnY, width: 52, height: 20, fill: '#2e7d32', stroke: '#1b5e20', strokeWidth: 1, cornerRadius: 3 });
        const startLabel = new Konva.Text({ x: px + 6, y: btnY + 4, width: 52, text: '启动', fontSize: 9, fill: '#fff', align: 'center' });
        startBtn.on('click tap', () => { this._startEngine(); });
        
        const stopBtn = new Konva.Rect({ x: px + 64, y: btnY, width: 52, height: 20, fill: '#c62828', stroke: '#b71c1c', strokeWidth: 1, cornerRadius: 3 });
        const stopLabel = new Konva.Text({ x: px + 64, y: btnY + 4, width: 52, text: '停机', fontSize: 9, fill: '#fff', align: 'center' });
        stopBtn.on('click tap', () => { this._stopEngine(); });
        
        this._interactGroup.add(startBtn, startLabel, stopBtn, stopLabel);
        
        // 调速器参数显示
        const paramY = py + 80;
        this._throttleText = new Konva.Text({ x: px + 6, y: paramY, width: pw-12, text: '油门: 0%', fontSize: 7.5, fontFamily: 'Courier New, monospace', fill: '#78909c' });
        this._fuelText = new Konva.Text({ x: px + 6, y: paramY + 16, width: pw-12, text: '油耗: 0 L/h', fontSize: 7.5, fontFamily: 'Courier New, monospace', fill: '#78909c' });
        this._totalFuelText = new Konva.Text({ x: px + 6, y: paramY + 32, width: pw-12, text: '累计: 0 L', fontSize: 7.5, fontFamily: 'Courier New, monospace', fill: '#546e7a' });
        
        this._staticGroup.add(this._throttleText, this._fuelText, this._totalFuelText);
        
        // 复励方式切换
        const modeY = py + ph - 28;
        this._staticGroup.add(new Konva.Text({ x: px + 6, y: modeY - 16, text: '励磁方式:', fontSize: 7.5, fill: '#78909c' }));
        
        const cumBtn = new Konva.Rect({ x: px + 6, y: modeY, width: 58, height: 18, fill: '#0d2030', stroke: '#4fc3f7', strokeWidth: 1, cornerRadius: 2 });
        const cumLabel = new Konva.Text({ x: px + 6, y: modeY + 3, width: 58, text: '积复励', fontSize: 8, fill: '#4fc3f7', align: 'center' });
        cumBtn.on('click tap', () => { this.compoundType = 'cumulative'; this._updateModeDisplay(); });
        
        const diffBtn = new Konva.Rect({ x: px + 70, y: modeY, width: 58, height: 18, fill: '#0d2030', stroke: '#ef5350', strokeWidth: 1, cornerRadius: 2 });
        const diffLabel = new Konva.Text({ x: px + 70, y: modeY + 3, width: 58, text: '差复励', fontSize: 8, fill: '#ef5350', align: 'center' });
        diffBtn.on('click tap', () => { this.compoundType = 'differential'; this._updateModeDisplay(); });
        
        this._modeIndicator = new Konva.Text({ x: px + 140, y: modeY + 3, width: 60, text: '积复励', fontSize: 7.5, fill: '#4fc3f7' });
        
        this._interactGroup.add(cumBtn, cumLabel, diffBtn, diffLabel, this._modeIndicator);
        
        this._speedBarY = sliderY;
    }
    
    _drawGeneratorControlPanel() {
        const px = this._controlX + this._controlW + 8;
        // 负载控制面板放在波形区左侧，实际已在波形区处理
        // 这里添加负载调节
        const py = this._controlY + this._controlH + 8;
    }
    
    _drawExternalCharacteristic() {
        const { _charX: cx, _charY: cy, _charW: cw, _charH: ch } = this;
        
        const bg = new Konva.Rect({ x: cx, y: cy, width: cw, height: ch, fill: '#010d18', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 4 });
        const titleBg = new Konva.Rect({ x: cx, y: cy, width: cw, height: 14, fill: '#0a1a28', cornerRadius: [4,4,0,0] });
        this._staticGroup.add(new Konva.Text({ x: cx+4, y: cy+2, width: cw-8, text: '外特性 Vt-IL（工作点追踪）', fontSize: 8, fontStyle: 'bold', fill: '#4fc3f7', align: 'center' }));
        
        const ox = cx + 12, oy = cy + ch - 12, aw = cw - 22, ah = ch - 20;
        
        this._staticGroup.add(new Konva.Line({ points: [ox, oy-ah, ox, oy, ox+aw, oy], stroke: '#37474f', strokeWidth: 1 }));
        this._staticGroup.add(new Konva.Text({ x: ox-10, y: cy+12, text: 'Vt', fontSize: 7.5, fill: '#4fc3f7' }));
        this._staticGroup.add(new Konva.Text({ x: cx+cw-12, y: oy+2, text: 'IL', fontSize: 7.5, fill: '#4fc3f7' }));
        
        // 积复励和差复励两条参考曲线
        const cumPts = [], diffPts = [];
        for (let i = 0; i <= 100; i++) {
            const il_norm = i / 100;
            const vt_cum = 1 - il_norm * 0.02;  // 硬特性
            const vt_diff = 1 - il_norm * 0.25; // 软特性
            cumPts.push(ox + il_norm * aw, oy - vt_cum * ah);
            diffPts.push(ox + il_norm * aw, oy - vt_diff * ah);
        }
        this._staticGroup.add(new Konva.Line({ points: cumPts, stroke: '#4fc3f7', strokeWidth: 1.5, dash: [6, 3], opacity: 0.6 }));
        this._staticGroup.add(new Konva.Line({ points: diffPts, stroke: '#ef5350', strokeWidth: 1.5, dash: [6, 3], opacity: 0.6 }));
        
        this._workPoint = new Konva.Circle({ x: ox + aw*0.5, y: oy - ah*0.5, radius: 5, fill: '#ffa726', stroke: '#e65100', strokeWidth: 1 });
        
        this._charOX = ox; this._charOY = oy; this._charAW = aw; this._charAH = ah;
        this._staticGroup.add(bg, titleBg, this._workPoint);
    }
    
    _drawWaveform() {
        const { _wavX: wx, _wavY: wy, _wavW: ww, _wavH: wh } = this;
        
        const bg = new Konva.Rect({ x: wx, y: wy, width: ww, height: wh, fill: '#010d18', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 4 });
        const titleBg = new Konva.Rect({ x: wx, y: wy, width: ww, height: 14, fill: '#0a1a28', cornerRadius: [4,4,0,0] });
        this._staticGroup.add(new Konva.Text({ x: wx+4, y: wy+2, width: ww-8, text: 'Vt(V)  IL(A)  n(rpm)  P(kW)', fontSize: 8, fontStyle: 'bold', fill: '#4fc3f7', align: 'center' }));
        
        const h4 = (wh - 16) / 4;
        this._wavMids = [wy + 16 + h4*0.5, wy + 16 + h4*1.5, wy + 16 + h4*2.5, wy + 16 + h4*3.5];
        
        this._wLineVt = new Konva.Line({ points: [], stroke: '#4fc3f7', strokeWidth: 1.5 });
        this._wLineIL = new Konva.Line({ points: [], stroke: '#fff59d', strokeWidth: 1.5 });
        this._wLineSpeed = new Konva.Line({ points: [], stroke: '#ffa726', strokeWidth: 1.5 });
        this._wLinePower = new Konva.Line({ points: [], stroke: '#ffcc80', strokeWidth: 1.5 });
        
        this._staticGroup.add(bg, titleBg, this._wLineVt, this._wLineIL, this._wLineSpeed, this._wLinePower);
        
        this._wavW = ww; this._wavH = wh; this._wavX = wx;
    }
    
    // ═══════════════════════════════════════════════
    //  辅助方法
    // ═══════════════════════════════════════════════
    _updateSpeed(e, barX, barW) {
        const stage = this.group.getStage?.();
        const pos = stage?.getPointerPosition?.() ?? { x: (e.evt?.clientX ?? e.clientX ?? 0) };
        const relX = pos.x - (this.group.x?.() ?? 0) - barX;
        const ratio = Math.max(0, Math.min(1, relX / barW));
        this.speedSetpoint = this.minSpeed + ratio * (this.maxSpeed - this.minSpeed);
        this.targetSpeed = this.speedSetpoint;
        this._speedIntegral = 0;
    }
    
    _updateModeDisplay() {
        if (this._modeIndicator) {
            this._modeIndicator.text(this.compoundType === 'cumulative' ? '积复励' : '差复励');
            this._modeIndicator.fill(this.compoundType === 'cumulative' ? '#4fc3f7' : '#ef5350');
        }
    }
    
    _startEngine() {
        self.isStarting = true;
        self.isRunning = true;
        this.startingTimer = 2.0;
        this.starterEngaged = true;
        this.throttleCmd = 0.3;
    }
    
    _stopEngine() {
        self.isRunning = false;
        this.throttleCmd = 0;
        this.torque_prime = 0;
    }
    
    // ═══════════════════════════════════════════════
    //  动画主循环
    // ═══════════════════════════════════════════════
    // 集中化 tick（由 consys._tickAll 在 20fps 调用）
    tick(dt) {
        this._tickMechanical(dt);
        this._tickElectrical(dt);
        this._tickViz(dt);
        this._tickWaveform(dt);
        this._tickDisplay();
        this._refreshCache();
    }
    
    // ── 原动机机械动态 ────────────────────────
    _tickMechanical(dt) {
        if (!self.isRunning) {
            // 停机：摩擦制动
            const friction = this.B_prime * this.omega;
            this.omega -= (friction / this.J_prime) * dt;
            this.omega = Math.max(0, this.omega);
            this.speed_rpm = this.omega * 60 / (2 * Math.PI);
            this.throttlePos = 0;
            return;
        }
        
        // 启动过程
        if (self.isStarting) {
            this.startingTimer -= dt;
            if (this.startingTimer <= 0) {
                self.isStarting = false;
                this.starterEngaged = false;
            }
            // 启动时额外扭矩
            this.throttleCmd = Math.min(0.5, this.throttleCmd + dt * 0.5);
        }
        
        // 滤波器平滑油门指令
        this.throttlePos += (this.throttleCmd - this.throttlePos) * Math.min(1, dt * 3);
        
        // PID 调速器
        const targetOmega = this.targetSpeed * 2 * Math.PI / 60;
        this._speedError = targetOmega - this.omega;
        this._speedIntegral += this._speedError * dt;
        this._speedIntegral = Math.max(-1, Math.min(1, this._speedIntegral));
        const speedDeriv = (this._speedError - this._prevSpeedError) / (dt + 0.001);
        this._prevSpeedError = this._speedError;
        
        let throttleDelta = this.Kp_speed * this._speedError + this.Ki_speed * this._speedIntegral + this.Kd_speed * speedDeriv;
        this.throttleCmd += throttleDelta * dt * 2;
        this.throttleCmd = Math.max(0.08, Math.min(1, this.throttleCmd));
        
        // 原动机输出扭矩（柴油机特性曲线）
        const maxTqAtSpeed = this.maxTorque * (1 - Math.pow((this.speed_rpm - this.n_rated) / this.n_rated, 2) * 0.3);
        this.torque_prime = this.throttleCmd * Math.max(10, maxTqAtSpeed);
        
        // 运动方程
        const netTorque = this.torque_prime - this.torque_em - this.B_prime * this.omega;
        this.omega += (netTorque / this.J_prime) * dt;
        this.omega = Math.max(0, Math.min(this.omega, this.maxSpeed * 2 * Math.PI / 60 * 1.1));
        
        this.speed_rpm = this.omega * 60 / (2 * Math.PI);
        
        // 转速状态标志
        this.isOverspeed = this.speed_rpm > this.maxSpeed * 1.05;
        this.isUnderspeed = this.speed_rpm < this.minSpeed * 0.9 && this.throttleCmd > 0.1;
        
        // 油耗计算
        const fuelPerHour = this.torque_prime * this.omega * this.fuelEfficiency / 1000;
        this.fuelRate = fuelPerHour;
        this.totalFuel += fuelPerHour * dt / 3600;
    }
    
    // ── 电气动态（复励发电机）─────────────────
    _tickElectrical(dt) {
        if (this.speed_rpm < 100) {
            this.Vt = 0;
            this.Ia = 0;
            this.IL = 0;
            this.Ea = 0;
            return;
        }
        
        // 并励电流
        if (this.Vt > 5) {
            this.If = this.Vt / this.Rsh;
        } else {
            // 自励起压过程
            this.If = this.remnantFlux * this.Ke * this.omega / this.Rsh;
        }
        this.If = Math.min(15, Math.max(0, this.If));
        
        // 负载电流
        if (this.loadResistance > 0) {
            this.IL = this.Vt / this.loadResistance;
        } else {
            this.IL = 0;
        }
        this.IL = Math.max(0, Math.min(this.In * 2, this.IL));
        this.Ise = this.IL;
        this.Ia = this.IL + this.If;
        
        // 磁通计算（考虑饱和）
        let phi_sh_raw = this.K_sh * this.If;
        let phi_se_raw = this.K_se * this.Ise * (this.compoundType === 'cumulative' ? 1 : -1);
        let phi_total_raw = phi_sh_raw + phi_se_raw + this.remnantFlux;
        
        // 饱和效应
        const phi_sat = phi_total_raw < this.saturationFactor ? phi_total_raw : 
                        this.saturationFactor + (phi_total_raw - this.saturationFactor) * 0.3;
        this.phi_total = Math.max(0.01, phi_sat);
        
        this.phi_sh = phi_sh_raw;
        this.phi_se = phi_se_raw;
        
        // 电动势
        this.Ea = this.Ke * this.phi_total * this.omega;
        
        // 电枢反应压降
        const armReactionDrop = this.armatureReaction * this.Ia;
        
        // 端电压
        this.Vt = this.Ea - this.Ia * (this.Ra + this.Rse) - armReactionDrop;
        this.Vt = Math.max(0, this.Vt);
        
        // 电磁制动转矩
        this.torque_em = this.Kt * this.phi_total * this.Ia;
        
        // 功率和效率
        this.elecPower = this.Vt * this.IL / 1000;  // kW
        this.mechPower = this.torque_prime * this.omega / 1000;  // kW
        this.efficiency = this.mechPower > 0.1 ? (this.elecPower / this.mechPower) * 100 : 0;
        
        // 电压调整率
        const V_noLoad = this.Vt > 0 ? this.Vt / (1 - this.IL / this.In * 0.1) : this.Vn;
        this.voltageRegulation = ((V_noLoad - this.Vt) / this.Vt) * 100;
        
        // 过载检测
        this.isOverload = this.IL > this.In * 1.1;
    }
    
    // ── 可视化更新 ────────────────────────────
    _tickViz(dt) {
        // 转子旋转
        this._rotorAngle += this.omega * dt;
        if (this._rotorGroup) this._rotorGroup.rotation(this._rotorAngle * 180 / Math.PI);
        
        // 飞轮旋转
        if (this._flywheel) this._flywheel.rotation(this._rotorAngle * 180 / Math.PI);
        
        // 线圈颜色（反映电流）
        const iNorm = Math.min(1, this.Ia / this.In);
        if (this._armCoils) {
            this._armCoils.forEach(coil => {
                coil.stroke(`rgba(255, ${120 + iNorm * 100}, 50, ${0.4 + iNorm * 0.6})`);
                coil.strokeWidth(1.5 + iNorm * 1.5);
            });
        }
        
        // 油门指示器
        if (this._throttleIndicator) {
            const maxW = this._primeW - 10;
            this._throttleIndicator.width(this.throttleCmd * maxW);
        }
        
        // 烟雾效果
        if (this._exhaustSmoke && this.throttleCmd > 0.2 && self.isRunning) {
            const smokeSize = 5 + this.throttleCmd * 12;
            this._exhaustSmoke.radius(smokeSize * (0.5 + 0.5 * Math.sin(Date.now() * 0.008)));
            this._exhaustSmoke.fill(`rgba(${70 + this.throttleCmd * 50},${60 + this.throttleCmd * 40},${50},${0.3 + this.throttleCmd * 0.3})`);
        } else if (this._exhaustSmoke) {
            this._exhaustSmoke.radius(0);
        }
        
        // 转速条
        if (this._speedBar) {
            const ratio = (this.speed_rpm - this.minSpeed) / (this.maxSpeed - this.minSpeed);
            this._speedBar.width(Math.max(0, Math.min(this._speedBarW, ratio * this._speedBarW)));
            this._speedValText.text(`${Math.round(this.speed_rpm)}rpm`);
        }
        
        // 转速圆弧
        if (this._rpmArc) {
            const rpmRatio = this.speed_rpm / this.maxSpeed;
            this._rpmArc.angle(Math.min(360, rpmRatio * 360));
            this._rpmArc.fill(this.isOverspeed ? '#ef5350' : '#ffa726');
        }
        
        // 工作点
        if (this._workPoint) {
            const il_norm = Math.min(1, this.IL / this.In);
            const vt_norm = Math.min(1, this.Vt / this.Vn);
            this._workPoint.x(this._charOX + il_norm * this._charAW);
            this._workPoint.y(this._charOY - vt_norm * this._charAH);
            this._workPoint.fill(this.isOverload ? '#ef5350' : '#ffa726');
        }
    }
    
    // ── 波形更新 ─────────────────────────────
    _tickWaveform(dt) {
        if (!this._wavH) return;
        
        this._wavAcc += 1.2 * dt * this._wavLen;
        const steps = Math.floor(this._wavAcc);
        this._wavAcc -= steps;
        
        const maxVt = this.Vn, maxIL = this.In, maxSpeed = this.maxSpeed, maxPower = this.Pn;
        
        for (let i = 0; i < steps; i++) {
            this._wavVt = new Float32Array([...this._wavVt.slice(1), this.Vt]);
            this._wavIL = new Float32Array([...this._wavIL.slice(1), this.IL]);
            this._wavSpeed = new Float32Array([...this._wavSpeed.slice(1), this.speed_rpm]);
            this._wavPower = new Float32Array([...this._wavPower.slice(1), this.elecPower]);
        }
        
        const wx = this._wavX + 3, ww = this._wavW - 6, n = this._wavLen, dx = ww / n;
        const [mid1, mid2, mid3, mid4] = this._wavMids;
        const h3 = (this._wavH - 16) / 4;
        const aVt = h3 * 0.42, aIL = h3 * 0.40, aSpeed = h3 * 0.38, aPower = h3 * 0.36;
        
        const vtPts = [], ilPts = [], spPts = [], pwPts = [];
        for (let i = 0; i < n; i++) {
            const x = wx + i * dx;
            vtPts.push(x, mid1 - (this._wavVt[i] / maxVt) * aVt);
            ilPts.push(x, mid2 - (this._wavIL[i] / maxIL) * aIL);
            spPts.push(x, mid3 - (this._wavSpeed[i] / maxSpeed) * aSpeed);
            pwPts.push(x, mid4 - (this._wavPower[i] / maxPower) * aPower);
        }
        
        if (this._wLineVt) this._wLineVt.points(vtPts);
        if (this._wLineIL) this._wLineIL.points(ilPts);
        if (this._wLineSpeed) this._wLineSpeed.points(spPts);
        if (this._wLinePower) this._wLinePower.points(pwPts);
    }
    
    // ── 显示刷新 ─────────────────────────────
    _tickDisplay() {
        const running = self.isRunning && this.speed_rpm > 50;
        
        if (!running) {
            this._lcdMain.text('0.0');
            this._lcdMain.fill('#0d2030');
            this._lcdkW.text('0.0kW');
            this._lcdEta.text('η=0%');
            return;
        }
        
        const isOverloadColor = this.isOverload ? '#ef5350' : '#4fc3f7';
        const warningColor = this.isOverspeed ? '#ef5350' : (this.isUnderspeed ? '#ff9800' : '#ffa726');
        
        this._lcdMain.text(this.Vt.toFixed(1));
        this._lcdMain.fill(isOverloadColor);
        this._lcdkW.text(`${this.elecPower.toFixed(1)}kW`);
        this._lcdEta.text(`η=${this.efficiency.toFixed(1)}%`);
        this._lcdEta.fill(this.efficiency > 85 ? '#66bb6a' : '#ffcc80');
        
        // 面板数据显示
        if (this._throttleText) {
            this._throttleText.text(`油门: ${(this.throttlePos * 100).toFixed(1)}%`);
            this._throttleText.fill(this.isOverspeed ? '#ef5350' : '#ffa726');
        }
        if (this._fuelText) this._fuelText.text(`油耗: ${this.fuelRate.toFixed(1)} L/h`);
        if (this._totalFuelText) this._totalFuelText.text(`累计: ${this.totalFuel.toFixed(1)} L`);
        
        // 转速条颜色
        if (this._speedBar) {
            this._speedBar.fill(warningColor);
        }
    }
    
    // ═══════════════════════════════════════════════
    //  外部接口
    // ═══════════════════════════════════════════════
    update(loadResistance, speedSetpoint) {
        if (typeof loadResistance === 'number' && loadResistance > 0) {
            this.loadResistance = loadResistance;
        }
        if (typeof speedSetpoint === 'number') {
            this.speedSetpoint = Math.max(this.minSpeed, Math.min(this.maxSpeed, speedSetpoint));
            this.targetSpeed = this.speedSetpoint;
        }
        this._refreshCache();
    }
    
    getGeneratorData() {
        return {
            Vt: this.Vt,
            IL: this.IL,
            Ia: this.Ia,
            If: this.If,
            speed: this.speed_rpm,
            power: this.elecPower,
            efficiency: this.efficiency,
            voltageRegulation: this.voltageRegulation,
            compoundType: this.compoundType,
        };
    }
    
    getPrimeMoverData() {
        return {
            torque: this.torque_prime,
            throttle: this.throttlePos,
            fuelRate: this.fuelRate,
            totalFuel: this.totalFuel,
            speedError: this._speedError,
        };
    }
    
    getConfigFields() {
        return [
            { label: '位号/名称', key: 'id', type: 'text' },
            { label: '额定电压 (V)', key: 'Vn', type: 'number' },
            { label: '额定电流 (A)', key: 'In', type: 'number' },
            { label: '额定转速 (rpm)', key: 'n_rated', type: 'number' },
            { label: '电枢电阻 (Ω)', key: 'Ra', type: 'number' },
            { label: '串励电阻 (Ω)', key: 'Rse', type: 'number' },
            { label: '并励电阻 (Ω)', key: 'Rsh', type: 'number' },
            { label: '转动惯量 (kg·m²)', key: 'J_prime', type: 'number' },
            { label: '调速器比例增益', key: 'Kp_speed', type: 'number' },
            { label: '调速器积分增益', key: 'Ki_speed', type: 'number' },
        ];
    }
    
    onConfigUpdate(cfg) {
        this.id = cfg.id || this.id;
        this.Vn = parseFloat(cfg.Vn) || this.Vn;
        this.In = parseFloat(cfg.In) || this.In;
        this.n_rated = parseFloat(cfg.n_rated) || this.n_rated;
        this.Ra = parseFloat(cfg.Ra) || this.Ra;
        this.Rse = parseFloat(cfg.Rse) || this.Rse;
        this.Rsh = parseFloat(cfg.Rsh) || this.Rsh;
        this.J_prime = parseFloat(cfg.J_prime) || this.J_prime;
        this.Kp_speed = parseFloat(cfg.Kp_speed) || this.Kp_speed;
        this.Ki_speed = parseFloat(cfg.Ki_speed) || this.Ki_speed;
        
        this.Pn = this.Vn * this.In / 1000;
        this.config = { ...this.config, ...cfg };
        if (this._idText) this._idText.text(this.id);
        
        this._refreshCache();
    }
    
    destroy() {
        super.destroy?.();
    }
}