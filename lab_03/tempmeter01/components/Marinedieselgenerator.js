import { BaseComponent } from './BaseComponent.js';

/**
 * 船舶柴油发电机组仿真组件
 * （Marine Diesel Generator Set — YANMAR Style）
 *
 * ── 机组组成 ──────────────────────────────────────────────────
 *
 *  左侧：交流发电机（同步发电机，Synchronous Alternator）
 *    - 定子铁心 + 三相绕组
 *    - 转子（永磁或励磁绕组）
 *    - 前后端盖 + 轴承
 *    - 冷却风扇（轴流风冷）
 *
 *  中间连接：弹性联轴器（Flexible Coupling）
 *    - 隔振减振，补偿角位移
 *
 *  右侧：柴油发动机（Diesel Engine）
 *    - 缸体 + 缸盖（6缸直列，4冲程）
 *    - 进排气系统（顶部进气管 + 排气管）
 *    - 涡轮增压器（右侧）
 *    - 燃油系统（喷油泵 + 喷油器）
 *    - 冷却水系统
 *    - 机油润滑系统
 *    - 起动电机（右端底部）
 *    - 飞轮（右端大圆盘）
 *
 *  公共底座：减振安装底架
 *
 * ── 运行参数 ──────────────────────────────────────────────────
 *  额定功率    ：xxx kW
 *  额定转速    ：1500 rpm（50Hz）/ 1800 rpm（60Hz）
 *  额定电压    ：400 V / 440 V（三相）
 *  额定频率    ：50 Hz / 60 Hz
 *  功率因数    ：0.8 滞后
 *  燃油消耗    ：xxx g/kWh
 *  冷却方式    ：闭式循环水冷
 *
 * ── 监测参数 ──────────────────────────────────────────────────
 *  发动机端：转速、机油压力、冷却水温、排气温度、增压压力
 *  发电机端：三相电压、三相电流、频率、功率因数、输出功率
 *  公共：运行小时、故障代码、蓄电池电压
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  pipe_fuel_in   — 燃油进口
 *  pipe_cw_in     — 冷却水进口
 *  pipe_cw_out    — 冷却水出口
 *  pipe_exhaust   — 排气出口
 *  wire_u         — 输出 U 相
 *  wire_v         — 输出 V 相
 *  wire_w         — 输出 W 相
 *  wire_n         — 中性线 N
 *  wire_ctrl_p    — 控制信号正极
 *  wire_ctrl_n    — 控制信号负极
 */
export class MarineDieselGenerator extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(560, config.width  || 640);
        this.height = Math.max(280, config.height || 320);

        this.type    = 'marine_diesel_gen';
        this.special = 'none';
        this.cache   = 'fixed';

        // ── 额定参数 ──
        this.ratedPower   = config.ratedPower   || 500;    // kW
        this.ratedRPM     = config.ratedRPM     || 1500;   // rpm
        this.ratedVoltage = config.ratedVoltage || 400;    // V（线电压）
        this.ratedHz      = config.ratedHz      || 50;     // Hz
        this.cylinders    = config.cylinders    || 6;      // 缸数

        // ── 运行状态 ──
        this.running       = false;
        this.faultCode     = 0;
        this._startPhase   = 0;     // 0=停机 1=起动 2=运行 3=停机降速
        this._startTimer   = 0;
        this.powered       = true;

        // ── 实时参数（目标值，平滑过渡到实际值）──
        this._rpm          = 0;
        this._targetRPM    = 0;
        this.rpm           = 0;
        this.voltage       = 0;
        this.frequency     = 0;
        this.loadPct       = config.initLoad || 0;   // 负载 %（0~100）
        this._targetLoad   = config.initLoad || 0;
        this.current       = 0;
        this.power         = 0;
        this.pf            = 0.8;

        this.oilPressure   = 0;     // bar
        this.coolantTemp   = 25;    // °C
        this.exhaustTemp   = 25;    // °C
        this.boostPressure = 0;     // bar（增压压力）
        this.fuelRate      = 0;     // L/h
        this.battVoltage   = 24.0;  // V（起动蓄电池）
        this.runHours      = config.runHours || 0;   // 运行小时数

        // ── 报警阈值 ──
        this.alarmOilLow   = 2.0;   // bar
        this.alarmTempHigh = 95;    // °C
        this.alarmExhHigh  = 450;   // °C

        // ── 动画 ──
        this._phase        = 0;     // 通用动画相位
        this._crankAngle   = 0;     // 曲轴转角 rad
        this._fanAngle     = 0;     // 风扇转角 rad
        this._tcAngle      = 0;     // 涡轮增压器转角 rad
        this._exhaustPuff  = 0;     // 排气脉冲相位
        this._loadSmooth   = 0;     // 负载平滑值
        this._firePhase    = new Array(this.cylinders).fill(0); // 各缸点火相位
        this._vibPhase     = 0;     // 振动相位

        // ── 几何布局 ──
        // 底座
        this._baseX   = 0;
        this._baseY   = Math.round(this.height * 0.84);
        this._baseH   = this.height - this._baseY;

        // 发电机（左侧）
        this._altX    = 6;
        this._altY    = Math.round(this.height * 0.08);
        this._altW    = Math.round(this.width  * 0.28);
        this._altH    = Math.round(this.height * 0.70);

        // 联轴器
        this._coupX   = this._altX + this._altW;
        this._coupW   = Math.round(this.width  * 0.04);
        this._coupCY  = this._altY + this._altH / 2;

        // 发动机（右侧主体）
        this._engX    = this._coupX + this._coupW + 2;
        this._engY    = Math.round(this.height * 0.04);
        this._engW    = Math.round(this.width  * 0.54);
        this._engH    = Math.round(this.height * 0.78);

        // 缸体区（发动机内部）
        this._cylW    = Math.round(this._engW * 0.60);
        this._cylX    = this._engX + Math.round(this._engW * 0.10);
        this._cylY    = this._engY + Math.round(this._engH * 0.16);
        this._cylH    = Math.round(this._engH * 0.60);

        // 控制面板（发动机前左）
        this._panelX  = this._engX + Math.round(this._engW * 0.04);
        this._panelY  = this._engY + 8;
        this._panelW  = Math.round(this._engW * 0.14);
        this._panelH  = Math.round(this._engH * 0.26);

        // 涡轮增压器（右端）
        this._tcX     = this._engX + this._engW - 10;
        this._tcY     = Math.round(this.height * 0.12);
        this._tcR     = Math.round(this.height * 0.18);

        this.knobs    = {};

        this.config = {
            id: this.id, ratedPower: this.ratedPower,
            ratedRPM: this.ratedRPM, cylinders: this.cylinders,
        };

        this._init();

        // 端口
        this.addPort(this.width, this._engY + 10,   'exhaust',   'pipe', '排气');
        this.addPort(this.width, this._engY + 28,   'fuel_in',   'pipe', '燃油');
        this.addPort(this.width, this._engY + 48,   'cw_out',    'pipe', '冷水出');
        this.addPort(0,          this._altY + 12,   'u',         'wire', 'U');
        this.addPort(0,          this._altY + 28,   'v',         'wire', 'V');
        this.addPort(0,          this._altY + 44,   'w',         'wire', 'W');
        this.addPort(0,          this._altY + 62,   'n',         'wire', 'N');
        this.addPort(this.width, this._baseY - 20,  'ctrl_p',    'wire', 'CTRL+');
        this.addPort(this.width, this._baseY - 4,   'ctrl_n',    'wire', 'CTRL−');
    }

    // ═══════════════════════════════════════════
    _init() {
        this._drawLabel();
        this._drawBase();
        this._drawAlternator();
        this._drawCoupling();
        this._drawEngineBody();
        this._drawCylinderHeads();
        this._drawInletManifold();
        this._drawExhaustPipes();
        this._drawTurbocharger();
        this._drawFuelSystem();
        this._drawFlywheel();
        this._drawStarterMotor();
        this._drawControlPanel();
        this._drawAltFan();
        this._drawDynamicLayers();
        this._drawParamDisplays();
        
    }

    _drawLabel() {
        // YANMAR 铭牌在发动机体上（由 _drawEngineBody 处理）
        this.group.add(new Konva.Text({
            x: 0, y: -22, width: this.width,
            text: '船舶柴油发电机组（Marine Diesel Generator Set）',
            fontSize: 12, fontStyle: 'bold', fill: '#1a2634', align: 'center',
        }));
    }

    // ── 公共底座 ─────────────────────────────
    _drawBase() {
        const bx = this._baseX, by = this._baseY;
        const bw = this.width,  bh = this._baseH;

        // 主底架（钢制，银灰色）
        const base = new Konva.Rect({ x: bx, y: by, width: bw, height: bh, fill: '#8a9ba8', stroke: '#6a7f8c', strokeWidth: 1.5, cornerRadius: [0,0,3,3] });
        // 底架高光（顶面）
        this.group.add(new Konva.Rect({ x: bx, y: by, width: bw, height: 5, fill: 'rgba(255,255,255,0.22)', cornerRadius: [0,0,0,0] }));
        // 减振器（底部，圆形）
        const vibPts = [bw*0.12, bw*0.38, bw*0.62, bw*0.88];
        vibPts.forEach(vx => {
            // 减振垫
            this.group.add(new Konva.Ellipse({ x: vx, y: by+bh-4, radiusX: 18, radiusY: 8, fill: '#4a4a4a', stroke: '#2a2a2a', strokeWidth: 1 }));
            this.group.add(new Konva.Ellipse({ x: vx, y: by+bh-8, radiusX: 18, radiusY: 6, fill: '#2a2a2a' }));
        });
        // 横向加强筋
        for (let i = 1; i < 4; i++) {
            this.group.add(new Konva.Line({ points: [bw*i/4, by+5, bw*i/4, by+bh-8], stroke: '#6a7f8c', strokeWidth: 2 }));
        }
        this.group.add(base);
    }

    // ── 交流发电机 ────────────────────────────
    _drawAlternator() {
        const ax = this._altX, ay = this._altY;
        const aw = this._altW, ah = this._altH;
        const cx = ax + aw/2, cy = ay + ah/2;

        // 发电机主体（浅蓝灰色，仿 YANMAR 配色）
        const altBody = new Konva.Rect({ x: ax, y: ay, width: aw, height: ah, fill: '#7bb3c4', stroke: '#5a8fa0', strokeWidth: 2, cornerRadius: 4 });
        // 发电机前端盖（左端盖，圆弧形）
        const frontEndCap = new Konva.Ellipse({ x: ax+4, y: cy, radiusX: 14, radiusY: ah/2-4, fill: '#6aa3b4', stroke: '#5a8fa0', strokeWidth: 1.5 });
        // 后端盖（右侧，连接联轴器）
        const rearEndCap  = new Konva.Ellipse({ x: ax+aw-4, y: cy, radiusX: 14, radiusY: ah/2-4, fill: '#6aa3b4', stroke: '#5a8fa0', strokeWidth: 1.5 });

        // 冷却槽（竖向散热槽，仿图中发电机外观）
        for (let i = 0; i < 8; i++) {
            const sx = ax + 14 + i * (aw-28) / 8;
            this.group.add(new Konva.Line({ points: [sx, ay+4, sx, ay+ah-4], stroke: '#5a8fa0', strokeWidth: 1.5, opacity: 0.5 }));
        }
        // 顶部接线盒
        const jbW = Math.round(aw * 0.36), jbH = Math.round(ah * 0.14);
        const jbX = ax + (aw - jbW)/2;
        this.group.add(new Konva.Rect({ x: jbX, y: ay-jbH+4, width: jbW, height: jbH, fill: '#3a4a54', stroke: '#263238', strokeWidth: 1.5, cornerRadius: [3,3,0,0] }));
        this.group.add(new Konva.Text({ x: jbX+2, y: ay-jbH+6, width: jbW-4, text: 'ALTERNATOR', fontSize: 7, fill: 'rgba(255,255,255,0.5)', align: 'center' }));

        // 出线孔（左侧，三相 + N）
        for (let i = 0; i < 4; i++) {
            this.group.add(new Konva.Circle({ x: ax+6, y: ay+12+i*16, radius: 3.5, fill: '#1a1a1a', stroke: '#333', strokeWidth: 0.8 }));
        }

        // 铭牌
        const npX = ax+aw/2-22, npY = ay+ah/2+8;
        this.group.add(new Konva.Rect({ x: npX, y: npY, width: 44, height: 20, fill: '#2a3a44', cornerRadius: 1 }));
        this.group.add(new Konva.Text({ x: npX+2, y: npY+3, width: 40, text: `${this.ratedPower}kW\n${this.ratedVoltage}V`, fontSize: 7, fill: '#90caf9', align: 'center', lineHeight: 1.3 }));

        // 标注
        this.group.add(new Konva.Text({ x: ax, y: ay-18, width: aw, text: '同步发电机', fontSize: 8.5, fontStyle: 'bold', fill: '#37474f', align: 'center' }));

        this.group.add(altBody, frontEndCap, rearEndCap);
    }

    // ── 风冷风扇（发电机端）─────────────────
    _drawAltFan() {
        const ax = this._altX, ay = this._altY, ah = this._altH;
        const cy = ay + ah/2;
        const fanR = Math.round(ah * 0.25);

        // 风扇罩
        this.group.add(new Konva.Circle({ x: ax+8, y: cy, radius: fanR+4, fill: 'none', stroke: '#4a6a7a', strokeWidth: 2 }));
        // 风扇叶片（动态旋转组）
        this._fanGroup = new Konva.Group({ x: ax+8, y: cy });
        const bladeCount = 6;
        for (let i = 0; i < bladeCount; i++) {
            const a = (i / bladeCount) * Math.PI * 2;
            const blade = new Konva.Line({
                points: [
                    fanR * 0.2 * Math.cos(a), fanR * 0.2 * Math.sin(a),
                    fanR * 0.85 * Math.cos(a + 0.35), fanR * 0.85 * Math.sin(a + 0.35),
                ],
                stroke: '#607d8b', strokeWidth: 4, lineCap: 'round',
            });
            this._fanGroup.add(blade);
        }
        this._fanGroup.add(new Konva.Circle({ radius: fanR*0.18, fill: '#37474f', stroke: '#263238', strokeWidth: 1.5 }));
        this.group.add(this._fanGroup);
    }

    // ── 弹性联轴器 ────────────────────────────
    _drawCoupling() {
        const cx2 = this._coupX + this._coupW/2, cy = this._coupCY;
        const r1 = Math.round(this._altH * 0.15), r2 = Math.round(this._altH * 0.20);

        // 联轴器外形（哑铃形）
        const leftFlange  = new Konva.Ellipse({ x: this._coupX, y: cy, radiusX: 6, radiusY: r1, fill: '#607d8b', stroke: '#37474f', strokeWidth: 1.5 });
        const rightFlange = new Konva.Ellipse({ x: this._coupX + this._coupW, y: cy, radiusX: 6, radiusY: r2, fill: '#607d8b', stroke: '#37474f', strokeWidth: 1.5 });
        const midBody     = new Konva.Rect({ x: this._coupX, y: cy-8, width: this._coupW, height: 16, fill: '#546e7a', stroke: '#37474f', strokeWidth: 0.5 });
        // 螺栓
        for (let i = -1; i <= 1; i += 2) {
            this.group.add(new Konva.Circle({ x: this._coupX + this._coupW/2, y: cy + i*r1*0.5, radius: 2.5, fill: '#37474f' }));
        }
        this.group.add(leftFlange, midBody, rightFlange);
    }

    // ── 发动机主体 ───────────────────────────
    _drawEngineBody() {
        const ex = this._engX, ey = this._engY;
        const ew = this._engW, eh = this._engH;

        // 发动机主色（浅蓝绿色，YANMAR 特色色）
        const engBody = new Konva.Rect({ x: ex, y: ey, width: ew, height: eh, fill: '#7bbdc8', stroke: '#5a9aaa', strokeWidth: 2, cornerRadius: [4,6,3,3] });
        // 顶部深色带（进气管安装区）
        this.group.add(new Konva.Rect({ x: ex, y: ey, width: ew, height: Math.round(eh*0.14), fill: '#5a9aaa', stroke: '#4a8a9a', strokeWidth: 0, cornerRadius: [4,6,0,0] }));
        // 顶面高光
        this.group.add(new Konva.Rect({ x: ex+4, y: ey+2, width: ew-8, height: 4, fill: 'rgba(255,255,255,0.18)', cornerRadius: [2,2,0,0] }));

        // YANMAR 品牌文字
        this.group.add(new Konva.Text({
            x: ex + Math.round(ew * 0.35), y: ey + Math.round(eh * 0.20),
            text: 'YANMAR', fontSize: 18, fontStyle: 'bold',
            fill: 'rgba(255,255,255,0.30)', letterSpacing: 3,
        }));

        // 油底壳（底部深色加厚区）
        this.group.add(new Konva.Rect({ x: ex+6, y: ey+eh-Math.round(eh*0.22), width: ew-12, height: Math.round(eh*0.22), fill: '#4a8090', stroke: '#3a6070', strokeWidth: 1, cornerRadius: [0,0,3,3] }));
        // 机油底壳螺栓
        for (let i = 0; i < 4; i++) {
            this.group.add(new Konva.Circle({ x: ex+20+i*(ew-30)/4, y: ey+eh-8, radius: 3.5, fill: '#2a3a44', stroke: '#1a2a34', strokeWidth: 0.5 }));
        }

        // 侧面检查盖（仿图中矩形盖板）
        const coverY = ey + Math.round(eh * 0.42);
        const coverH = Math.round(eh * 0.36);
        const N      = this.cylinders;
        const coverW = Math.round((this._cylW - 10) / N);
        for (let i = 0; i < N; i++) {
            const cvX = this._cylX + 5 + i * coverW;
            const cover = new Konva.Rect({ x: cvX+2, y: coverY, width: coverW-4, height: coverH, fill: '#9acdd8', stroke: '#6aaab8', strokeWidth: 1, cornerRadius: 4 });
            const coverInner = new Konva.Rect({ x: cvX+5, y: coverY+4, width: coverW-10, height: coverH-8, fill: '#b0d8e0', cornerRadius: 3 });
            // 盖板螺栓
            [[cvX+5, coverY+5],[cvX+coverW-7, coverY+5],[cvX+5, coverY+coverH-5],[cvX+coverW-7, coverY+coverH-5]].forEach(([bx,by]) => {
                this.group.add(new Konva.Circle({ x: bx, y: by, radius: 2.5, fill: '#4a8090' }));
            });
            this.group.add(cover, coverInner);
        }
        this.group.add(engBody);
    }

    // ── 气缸盖 ────────────────────────────────
    _drawCylinderHeads() {
        const N   = this.cylinders;
        const topY= this._engY;
        const headH = Math.round(this._engH * 0.16);
        const cylW  = Math.round((this._cylW) / N);

        this._injectorDots = [];
        for (let i = 0; i < N; i++) {
            const hx = this._cylX + i * cylW;
            // 气缸盖体
            const head = new Konva.Rect({ x: hx+2, y: topY+Math.round(this._engH*0.14), width: cylW-4, height: headH, fill: '#6aacb8', stroke: '#5a9aaa', strokeWidth: 1, cornerRadius: [2,2,0,0] });
            // 摇臂室盖
            const rockerCover = new Konva.Rect({ x: hx+4, y: topY+Math.round(this._engH*0.01), width: cylW-8, height: Math.round(headH*0.7), fill: '#5a9aaa', stroke: '#4a8a9a', strokeWidth: 1, cornerRadius: [3,3,1,1] });
            // 喷油器（发光点，动态）
            const injDot = new Konva.Circle({ x: hx+cylW/2, y: topY+Math.round(this._engH*0.14)+headH/2, radius: 3.5, fill: '#1a2634', stroke: '#37474f', strokeWidth: 0.5 });
            this._injectorDots.push(injDot);
            this.group.add(head, rockerCover, injDot);
        }
    }

    // ── 进气管组 ─────────────────────────────
    _drawInletManifold() {
        const ex = this._engX, ey = this._engY, ew = this._engW;
        const topArea = Math.round(this._engH * 0.03);

        // 进气管总管（顶部）
        const manifoldX = this._cylX - 4;
        const manifoldW = this._cylW + 8;
        const manifoldH = Math.round(this._engH * 0.08);
        const manifoldY = ey + topArea;

        // 进气滤清器组（圆柱形，顶部突出）
        const filterR = Math.round(this._engH * 0.07);
        const filterSpacing = manifoldW / (this.cylinders + 1);
        for (let i = 0; i < this.cylinders; i++) {
            const fx = manifoldX + filterSpacing * (i+1);
            const fTopY = ey - filterR * 0.6;
            // 空滤外壳
            this.group.add(new Konva.Ellipse({ x: fx, y: fTopY + filterR*0.5, radiusX: filterR*0.45, radiusY: filterR*0.5, fill: '#4a6a7a', stroke: '#3a5a6a', strokeWidth: 1 }));
            this.group.add(new Konva.Rect({ x: fx-filterR*0.45, y: fTopY+filterR*0.5, width: filterR*0.9, height: filterR*0.8, fill: '#4a6a7a', stroke: '#3a5a6a', strokeWidth: 1 }));
            this.group.add(new Konva.Ellipse({ x: fx, y: fTopY + filterR*1.3, radiusX: filterR*0.45, radiusY: filterR*0.3, fill: '#3a5a6a', stroke: '#2a4a5a', strokeWidth: 1 }));
        }
        // 进气总管
        this.group.add(new Konva.Rect({ x: manifoldX, y: manifoldY, width: manifoldW, height: manifoldH, fill: '#5a9aaa', stroke: '#4a8a9a', strokeWidth: 1.5, cornerRadius: 2 }));
    }

    // ── 排气管组 ─────────────────────────────
    _drawExhaustPipes() {
        const ex = this._engX, ey = this._engY, ew = this._engW, eh = this._engH;

        // 排气总管（靠近顶部，深色钢管）
        const exhX = this._cylX + this._cylW;
        const exhY = ey + Math.round(eh*0.10);
        const exhH = Math.round(eh*0.18);

        // 排气集管（水平钢管）
        this.group.add(new Konva.Rect({ x: exhX, y: exhY, width: 12, height: exhH, fill: '#3a3a3a', stroke: '#1a1a1a', strokeWidth: 1.5, cornerRadius: 2 }));
        // 绝热包扎（浅灰色）
        this.group.add(new Konva.Rect({ x: exhX-1, y: exhY-1, width: 14, height: exhH+2, fill: 'rgba(200,200,200,0.3)', cornerRadius: 2 }));

        // 出口管（连接到涡轮增压器）
        this.group.add(new Konva.Rect({ x: exhX+10, y: exhY+exhH/2-5, width: this._tcX-exhX-10, height: 10, fill: '#3a3a3a', stroke: '#1a1a1a', strokeWidth: 1 }));

        // 动态排气烟雾层
        this._exhaustGroup = new Konva.Group();
        this.group.add(this._exhaustGroup);
    }

    // ── 涡轮增压器 ────────────────────────────
    _drawTurbocharger() {
        const tx = this._tcX, ty = this._tcY;
        const R  = this._tcR;
        const cx2 = tx + R, cy2 = ty + R;

        // 压气机壳（蜗牛形，大圆）
        const compressor = new Konva.Circle({ x: cx2, y: cy2, radius: R, fill: '#3a5a6a', stroke: '#2a4a5a', strokeWidth: 2 });
        // 压气机蜗壳（内圈）
        this.group.add(new Konva.Circle({ x: cx2, y: cy2, radius: R*0.7, fill: '#2a4a5a', stroke: '#1a3a4a', strokeWidth: 1 }));

        // 涡轮叶轮（动态旋转）
        this._tcGroup = new Konva.Group({ x: cx2, y: cy2 });
        const bladeN = 8;
        for (let i = 0; i < bladeN; i++) {
            const a = (i / bladeN) * Math.PI * 2;
            const tBlade = new Konva.Line({
                points: [R*0.15*Math.cos(a), R*0.15*Math.sin(a), R*0.55*Math.cos(a+0.4), R*0.55*Math.sin(a+0.4)],
                stroke: '#6a9aaa', strokeWidth: 3.5, lineCap: 'round',
            });
            this._tcGroup.add(tBlade);
        }
        this._tcGroup.add(new Konva.Circle({ radius: R*0.12, fill: '#1a3a4a', stroke: '#0a2a3a', strokeWidth: 1.5 }));

        // 进排气管接口
        const inletPipe  = new Konva.Rect({ x: cx2-5, y: ty-14, width: 10, height: 14, fill: '#2a4a5a', stroke: '#1a3a4a', strokeWidth: 1 });
        const outletPipe = new Konva.Rect({ x: cx2+R-2, y: cy2-5, width: 14, height: 10, fill: '#2a4a5a', stroke: '#1a3a4a', strokeWidth: 1 });

        // 发光点（涡轮高温指示）
        this._tcGlow = new Konva.Circle({ x: cx2, y: cy2, radius: R*0.65, fill: 'rgba(255,100,0,0)', stroke: 'none' });

        this.group.add(compressor, this._tcGlow, this._tcGroup, inletPipe, outletPipe);
        this.group.add(new Konva.Text({ x: cx2-20, y: ty+R*2+4, text: '涡轮增压器', fontSize: 8.5, fill: '#37474f' }));
    }

    // ── 喷油泵 / 燃油系统 ────────────────────
    _drawFuelSystem() {
        const ex = this._engX, ey = this._engY, eh = this._engH;

        // 喷油泵（发动机后侧中部）
        const fpX = this._cylX + this._cylW + 4;
        const fpY = ey + Math.round(eh * 0.35);
        const fpH = Math.round(eh * 0.28);
        this.group.add(new Konva.Rect({ x: fpX, y: fpY, width: 14, height: fpH, fill: '#3a5a6a', stroke: '#2a4a5a', strokeWidth: 1, cornerRadius: 2 }));
        this.group.add(new Konva.Text({ x: fpX-2, y: fpY+fpH+2, text: '油泵', fontSize: 7.5, fill: '#546e7a' }));

        // 高压油管（细线，从油泵到各缸）
        const N = this.cylinders;
        const cylW = Math.round(this._cylW / N);
        for (let i = 0; i < N; i++) {
            const cx2 = this._cylX + (i + 0.5) * cylW;
            const headY = this._engY + Math.round(this._engH * 0.14);
            this.group.add(new Konva.Line({ points: [fpX + 7, fpY + i * fpH/N, cx2, headY], stroke: '#2a4a5a', strokeWidth: 1, opacity: 0.5 }));
        }
    }

    // ── 飞轮（最右端大圆盘）─────────────────
    _drawFlywheel() {
        const ex = this._engX, ew = this._engW, ey = this._engY, eh = this._engH;
        const fwX = ex + ew - 18;
        const fwCY = ey + eh / 2;
        const fwR  = Math.round(eh * 0.30);

        // 飞轮罩壳（轮廓）
        this.group.add(new Konva.Ellipse({ x: fwX, y: fwCY, radiusX: 18, radiusY: fwR+8, fill: '#3a4a54', stroke: '#263238', strokeWidth: 2 }));
        // 飞轮盘面
        this._flywheelGroup = new Konva.Group({ x: fwX, y: fwCY });
        this._flywheelGroup.add(new Konva.Circle({ radius: fwR, fill: '#263238', stroke: '#1a2634', strokeWidth: 1.5 }));
        // 飞轮圆孔（减重孔）
        for (let i = 0; i < 6; i++) {
            const a = (i/6) * Math.PI * 2;
            this._flywheelGroup.add(new Konva.Circle({ x: fwR*0.6*Math.cos(a), y: fwR*0.6*Math.sin(a), radius: fwR*0.12, fill: '#3a4a54', stroke: '#2a3a44', strokeWidth: 0.5 }));
        }
        this._flywheelGroup.add(new Konva.Circle({ radius: fwR*0.2, fill: '#1a2634', stroke: '#0d1520', strokeWidth: 1.5 }));
        this.group.add(this._flywheelGroup);
        this.group.add(new Konva.Text({ x: fwX-16, y: fwCY + fwR + 6, text: '飞轮', fontSize: 7.5, fill: '#546e7a' }));
    }

    // ── 起动电机 ─────────────────────────────
    _drawStarterMotor() {
        const ex = this._engX, ew = this._engW, ey = this._engY, eh = this._engH;
        const smX = ex + ew - 40;
        const smY = ey + eh - Math.round(eh*0.24);
        const smH = Math.round(eh * 0.20);

        this.group.add(new Konva.Rect({ x: smX, y: smY, width: 28, height: smH, fill: '#2a3a44', stroke: '#1a2634', strokeWidth: 1.5, cornerRadius: 3 }));
        this.group.add(new Konva.Ellipse({ x: smX, y: smY+smH/2, radiusX: 10, radiusY: smH/2-2, fill: '#1a2634', stroke: '#0d1520', strokeWidth: 1 }));
        this.group.add(new Konva.Text({ x: smX-2, y: smY+smH+2, text: '起动电机', fontSize: 7, fill: '#546e7a' }));
    }

    // ── 控制面板（仿图中绿色小屏）──────────
    _drawControlPanel() {
        const px = this._panelX, py = this._panelY;
        const pw = this._panelW, ph = this._panelH;

        // 面板外壳
        const panel = new Konva.Rect({ x: px, y: py, width: pw, height: ph, fill: '#2a3a44', stroke: '#1a2634', strokeWidth: 1.5, cornerRadius: 3 });
        // 显示屏（绿色 LCD）
        const screenH = Math.round(ph * 0.40);
        this._screen = new Konva.Rect({ x: px+3, y: py+3, width: pw-6, height: screenH, fill: '#0a2010', stroke: '#1a4020', strokeWidth: 1, cornerRadius: 2 });
        // 屏幕字符（动态）
        this._screenLine1 = new Konva.Text({ x: px+4, y: py+5, width: pw-8, text: '1500RPM', fontSize: 7.5, fontFamily: 'Courier New, monospace', fill: '#33ff66', align: 'center' });
        this._screenLine2 = new Konva.Text({ x: px+4, y: py+14, width: pw-8, text: '400V 50Hz', fontSize: 7, fontFamily: 'Courier New, monospace', fill: '#33ff66', align: 'center' });

        // 指示灯行
        const ledY = py + screenH + 8;
        const ledCols = ['#4caf50', '#ffd54f', '#ef5350'];
        this._panelLeds = [];
        ledCols.forEach((col, i) => {
            const led = new Konva.Circle({ x: px+5+i*10, y: ledY, radius: 3.5, fill: '#1a1a1a', stroke: '#333', strokeWidth: 0.8 });
            this._panelLeds.push({ led, col });
            this.group.add(led);
        });

        // 按钮（START / STOP）
        const btnY = py + ph - 10;
        this._btnStart = new Konva.Circle({ x: px+pw*0.3, y: btnY, radius: 5.5, fill: '#1a3a1a', stroke: '#2a5a2a', strokeWidth: 1 });
        this._btnStop  = new Konva.Circle({ x: px+pw*0.7, y: btnY, radius: 5.5, fill: '#3a1a1a', stroke: '#5a2a2a', strokeWidth: 1 });
        this.group.add(new Konva.Text({ x: px+pw*0.3-7, y: btnY+7, text: 'START', fontSize: 5.5, fill: '#4caf50' }));
        this.group.add(new Konva.Text({ x: px+pw*0.7-6, y: btnY+7, text: 'STOP', fontSize: 5.5, fill: '#ef5350' }));

        // 点击事件
        this._btnStart.on('click tap', () => this.start());
        this._btnStop.on('click tap',  () => this.stop());

        this.group.add(panel, this._screen, this._screenLine1, this._screenLine2, this._btnStart, this._btnStop);
    }

    // ── 动态图层（各种实时动画用）──────────
    _drawDynamicLayers() {
        this._pistonFireGroup = new Konva.Group();
        this._vibGroup        = new Konva.Group();
        this.group.add(this._pistonFireGroup, this._vibGroup);
    }

    // ── 参数显示（机组底部）─────────────────
    _drawParamDisplays() {
        const py = this._baseY + 3;
        const wPerCell = Math.round(this.width / 6);
        const params = [
            { label: 'rpm',   id: 'prpm',  color: '#4dd0e1' },
            { label: 'V',     id: 'pvolt', color: '#a5d6a7' },
            { label: 'Hz',    id: 'pfreq', color: '#fff59d' },
            { label: 'kW',    id: 'ppow',  color: '#ffcc80' },
            { label: '°C水温', id: 'pct',  color: '#ef9a9a' },
            { label: 'kPa油压', id: 'poil', color: '#ce93d8' },
        ];
        this._paramTexts = {};
        params.forEach(({ label, id, color }, i) => {
            const px2 = i * wPerCell + 4;
            this.group.add(new Konva.Rect({ x: px2, y: py, width: wPerCell-2, height: this._baseH-4, fill: 'rgba(0,0,0,0.18)', cornerRadius: 2 }));
            const val = new Konva.Text({ x: px2+2, y: py+1, width: wPerCell-6, text: '---', fontSize: 8.5, fontFamily: 'Courier New, monospace', fontStyle: 'bold', fill: color, align: 'center' });
            this.group.add(new Konva.Text({ x: px2+2, y: py+11, width: wPerCell-6, text: label, fontSize: 7, fill: 'rgba(255,255,255,0.3)', align: 'center' }));
            this._paramTexts[id] = val;
            this.group.add(val);
        });
    }

    // ═══════════════════════════════════════════
    // 集中化 tick（由 consys._tickAll 在 20fps 调用）
    tick(dt) {
        this._tickControl(dt);
        this._tickMechanical(dt);
        this._tickElectrical(dt);
        this._tickViz(dt);
        this._tickDisplay();
        this._refreshCache();
    }
    // ── 控制逻辑 ─────────────────────────────
    _tickControl(dt) {
        switch (this._startPhase) {
            case 0: // 停机
                this._targetRPM  = 0;
                this._targetLoad = 0;
                break;
            case 1: // 起动（6秒爬速）
                this._startTimer += dt;
                this._targetRPM = Math.min(this.ratedRPM, this._startTimer / 6 * this.ratedRPM);
                if (this._startTimer > 6) { this._startPhase = 2; this.running = true; }
                break;
            case 2: // 正常运行
                this._targetRPM  = this.ratedRPM;
                this._targetLoad = this.loadPct;
                break;
            case 3: // 降速停机
                this._startTimer -= dt * 2;
                this._targetRPM = Math.max(0, this._startTimer / 6 * this.ratedRPM);
                this._targetLoad = 0;
                if (this._startTimer <= 0) { this._startPhase = 0; this.running = false; }
                break;
        }
    }

    // ── 机械参数 ─────────────────────────────
    _tickMechanical(dt) {
        const tau = 0.5;
        this._rpm += (this._targetRPM - this._rpm) / Math.max(1, tau / dt);
        this._rpm  = Math.max(0, this._rpm);
        this.rpm   = Math.round(this._rpm);

        this._loadSmooth += (this._targetLoad - this._loadSmooth) * Math.min(1, dt * 3);

        // 角速度
        const omega = this._rpm / 60 * 2 * Math.PI;
        this._crankAngle += omega * dt;
        this._fanAngle   += omega * 0.8 * dt;
        this._tcAngle    += omega * 20 * dt;  // 涡轮转速极高
        this._phase      += dt * 3;
        this._vibPhase   += dt * (4 + this._loadSmooth * 6);

        // 发动机温度（随负载升高）
        const rpmNorm = this._rpm / this.ratedRPM;
        const loadNorm = this._loadSmooth / 100;
        this.oilPressure   = rpmNorm > 0.05 ? 2.0 + loadNorm * 3.5 + (Math.random()-0.5)*0.05 : 0;
        this.coolantTemp   = 25 + rpmNorm * 65 + loadNorm * 5 + (Math.random()-0.5)*0.3;
        this.exhaustTemp   = 25 + rpmNorm * 300 + loadNorm * 150 + (Math.random()-0.5)*2;
        this.boostPressure = rpmNorm > 0.3 ? loadNorm * 2.5 + (Math.random()-0.5)*0.05 : 0;
        this.fuelRate      = rpmNorm > 0 ? (loadNorm * this.ratedPower / 200 + 5) * rpmNorm : 0;
        this.runHours     += rpmNorm > 0.1 ? dt / 3600 : 0;
    }

    // ── 电气参数 ─────────────────────────────
    _tickElectrical(dt) {
        const rpmNorm = this._rpm / this.ratedRPM;
        this.frequency = rpmNorm * this.ratedHz;
        this.voltage   = rpmNorm > 0.5 ? this.ratedVoltage * (0.95 + rpmNorm * 0.05 + (Math.random()-0.5)*0.002) : rpmNorm * this.ratedVoltage * 2;
        const loadNorm = this._loadSmooth / 100;
        this.power     = rpmNorm > 0.95 ? this.ratedPower * loadNorm : 0;
        this.current   = this.voltage > 10 ? this.power * 1000 / (Math.sqrt(3) * this.voltage * this.pf) : 0;

        // 报警
        this.alarmHigh = this.coolantTemp > this.alarmTempHigh || this.exhaustTemp > this.alarmExhHigh;
        this.alarmOil  = this.running && this.oilPressure < this.alarmOilLow;
    }

    // ── 可视化动画 ───────────────────────────
    _tickViz(dt) {
        const rpmNorm  = this._rpm / this.ratedRPM;
        const loadNorm = this._loadSmooth / 100;
        const running  = rpmNorm > 0.05;

        // 飞轮旋转
        if (this._flywheelGroup) this._flywheelGroup.rotation(this._crankAngle * 180 / Math.PI);

        // 风扇旋转
        if (this._fanGroup) this._fanGroup.rotation(this._fanAngle * 180 / Math.PI);

        // 涡轮增压器旋转
        if (this._tcGroup) this._tcGroup.rotation(this._tcAngle * 180 / Math.PI);

        // 涡轮高温辉光
        if (this._tcGlow) {
            const tGlow = Math.min(0.35, loadNorm * 0.35);
            this._tcGlow.fill(`rgba(255,${Math.round(100-loadNorm*80)},0,${tGlow})`);
        }

        // 喷油器点火闪光
        this._pistonFireGroup.destroyChildren();
        if (running) {
            for (let i = 0; i < this.cylinders; i++) {
                const fireAngle = this._crankAngle + (i / this.cylinders) * Math.PI * 2;
                const firing    = (Math.sin(fireAngle * 2) > 0.85);
                if (this._injectorDots[i]) {
                    this._injectorDots[i].fill(firing ? `rgba(255,${Math.round(180-loadNorm*100)},0,0.9)` : '#1a2634');
                }
                if (firing && loadNorm > 0.05) {
                    const N   = this.cylinders;
                    const cylW = Math.round(this._cylW / N);
                    const fy  = this._engY + Math.round(this._engH * 0.15);
                    const fx  = this._cylX + (i + 0.5) * cylW;
                    this._pistonFireGroup.add(new Konva.Circle({ x: fx, y: fy, radius: 4, fill: `rgba(255,150,0,${0.4 + loadNorm * 0.4})` }));
                }
            }
        } else {
            if (this._injectorDots) this._injectorDots.forEach(d => d.fill('#1a2634'));
        }

        // 排气烟雾
        this._exhaustGroup.destroyChildren();
        if (running) {
            const exhX = this._engX + this._engW - 10;
            for (let i = 0; i < 4; i++) {
                const t = ((this._phase * 0.2 + i * 0.25) % 1 + 1) % 1;
                const smokeAlpha = (1-t) * 0.22 * (1 + loadNorm);
                const smokeR = 4 + t * 8;
                this._exhaustGroup.add(new Konva.Circle({
                    x: exhX + t * 14, y: this._engY - 8 - t * 20,
                    radius: smokeR, fill: `rgba(${Math.round(120+loadNorm*80)},${Math.round(100+loadNorm*60)},${Math.round(80+loadNorm*40)},${smokeAlpha})`,
                }));
            }
        }

        // 控制面板 LED 状态
        if (this._panelLeds) {
            const pulse = 0.5 + 0.5 * Math.abs(Math.sin(this._phase * 3));
            this._panelLeds[0].led.fill(running ? `rgba(76,175,80,${0.5+pulse*0.5})` : '#1a1a1a');
            this._panelLeds[1].led.fill(this.alarmOil || this.alarmHigh ? `rgba(255,213,79,${pulse})` : '#1a1a1a');
            this._panelLeds[2].led.fill(this.alarmHigh ? `rgba(239,83,80,${pulse})` : '#1a1a1a');
        }

        // START/STOP 按钮辉光
        if (this._btnStart) this._btnStart.fill(this._startPhase === 0 ? '#1a3a1a' : '#2a5a2a');
        if (this._btnStop)  this._btnStop.fill(this._startPhase > 0 ? '#4a1a1a' : '#3a1a1a');
    }

    // ── 显示刷新 ─────────────────────────────
    _tickDisplay() {
        const rpmNorm = this._rpm / this.ratedRPM;

        // 控制面板屏
        if (this._screenLine1) this._screenLine1.text(`${this.rpm} RPM`);
        if (this._screenLine2) this._screenLine2.text(this.running ? `${Math.round(this.voltage)}V ${this.frequency.toFixed(1)}Hz` : 'STANDBY');
        if (this._screen)      this._screen.fill(this.running ? '#0a2010' : '#081218');

        // 底部参数格
        const pt = this._paramTexts;
        if (pt.prpm)  pt.prpm.text(`${this.rpm}`);
        if (pt.pvolt) pt.pvolt.text(`${Math.round(this.voltage)}`);
        if (pt.pfreq) pt.pfreq.text(`${this.frequency.toFixed(1)}`);
        if (pt.ppow)  pt.ppow.text(`${Math.round(this.power)}`);
        if (pt.pct)   pt.pct.text(`${Math.round(this.coolantTemp)}`);
        if (pt.poil)  pt.poil.text(`${(this.oilPressure * 100).toFixed(0)}`);

        // 颜色告警
        if (pt.pct)  pt.pct.fill(this.coolantTemp > 90 ? '#ef5350' : this.coolantTemp > 80 ? '#ffa726' : '#ef9a9a');
        if (pt.poil) pt.poil.fill(this.alarmOil ? '#ef5350' : '#ce93d8');
    }

    // ═══════════════════════════════════════════
    start() {
        if (this._startPhase === 0) {
            this._startPhase  = 1;
            this._startTimer  = 0;
            this.running      = false;
            this._refreshCache();
        }
    }

    stop() {
        if (this._startPhase > 0) {
            this._startPhase = 3;
            this.running     = false;
            this._refreshCache();
        }
    }

    setLoad(pct) {
        this.loadPct = Math.max(0, Math.min(100, pct));
        this._refreshCache();
    }

    update(loadPct) {
        if (typeof loadPct === 'number') this.setLoad(loadPct);
        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label: '位号/名称',         key: 'id',           type: 'text'   },
            { label: '额定功率 (kW)',      key: 'ratedPower',   type: 'number' },
            { label: '额定转速 (rpm)',     key: 'ratedRPM',     type: 'number' },
            { label: '额定电压 (V)',       key: 'ratedVoltage', type: 'number' },
            { label: '额定频率 (Hz)',      key: 'ratedHz',      type: 'number' },
            { label: '缸数',              key: 'cylinders',    type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        this.id           = cfg.id           || this.id;
        this.ratedPower   = parseFloat(cfg.ratedPower)   || this.ratedPower;
        this.ratedRPM     = parseFloat(cfg.ratedRPM)     || this.ratedRPM;
        this.ratedVoltage = parseFloat(cfg.ratedVoltage) || this.ratedVoltage;
        this.ratedHz      = parseFloat(cfg.ratedHz)      || this.ratedHz;
        this.config       = { ...this.config, ...cfg };
        this._refreshCache();
    }

    destroy() {
        super.destroy?.();
    }
}