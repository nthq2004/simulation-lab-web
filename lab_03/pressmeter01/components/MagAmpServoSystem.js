import { BaseComponent } from './BaseComponent.js';

/**
 * 磁放大器伺服系统（修正版）仿真组件
 * Magnetic Amplifier Servo System — AC Electronic Switch Edition
 *
 * ── 系统结构纠正说明 ──────────────────────────────────────────
 *
 *  本版本针对图纸的正确理解重新建模：
 *
 *  【纠正1】SCR₁/SCR₂ 桥路：
 *    - 四个二极管 + 晶闸管（SCR）构成"交流电子开关"，
 *      而非整流电路。
 *    - 作用：二极管反并联提供双向通路，SCR 控制通断，
 *      使交流电选通地施加到电机对应绕组。
 *    - SCR₁ 通：交流正半周→电机控制绕组（正转方向）
 *    - SCR₂ 通：交流负半周→电机控制绕组（反转方向）
 *    - 两路不能同时导通（互锁）。
 *
 *  【纠正2】执行机构输出端：
 *    - 电机→减速器（齿轮减速，降速增矩）
 *    - 减速器输出轴→凸轮
 *    - 凸轮→压紧弹簧→差动变压器（LVDT）铁心
 *    - 差动变压器产生与输出轴位置成比例的位置反馈电压
 *    - 反馈电压→磁放大器，构成闭环
 *
 *  【纠正3】差动变压器（LVDT）：
 *    - 由初级绕组 W₁ + 两个次级绕组 W₂（反向串联）组成
 *    - 铁心（衔铁）随凸轮/弹簧移动
 *    - 铁心居中：两次级感应电压相等，输出 = 0
 *    - 铁心偏离：输出电压正比于位移，相位反映方向
 *
 * ── 完整信号流 ────────────────────────────────────────────────
 *
 *  给定位置θ_ref
 *       │
 *       ▼
 *  ┌─────────────────────────────────────────────────────────┐
 *  │  磁放大器（Mag-Amp）前置放大器                           │
 *  │  ε = θ_ref - V_lvdt（误差）                             │
 *  │  饱和特性：|ε|>死区 → a/b 端差动输出                    │
 *  └────┬──────────────────────────┬────────────────────────┘
 *       │a端 (+)                   │b端 (-)
 *       ▼                          ▼
 *  ┌──────────┐              ┌──────────┐
 *  │触发电路1  │              │触发电路2  │
 *  │相控触发  │              │相控触发  │
 *  └────┬─────┘              └────┬─────┘
 *       │                         │
 *       ▼                         ▼
 *  ┌──────────────────┐    ┌──────────────────┐
 *  │  交流电子开关1    │    │  交流电子开关2    │
 *  │  D₁D₂ + SCR₁    │    │  D₃D₄ + SCR₂    │
 *  │  （正向通路）     │    │  （反向通路）     │
 *  └────┬─────────────┘    └────┬─────────────┘
 *       │                       │
 *       └──────────┬────────────┘
 *                  ▼
 *           ┌─────────────┐
 *           │  两相电机    │
 *           │  励磁绕组 Ⅰ │← ~ 220V 固定励磁
 *           │  控制绕组 Ⅱ │← 交流电子开关输出（可正可反）
 *           └──────┬───────┘
 *                  ▼
 *           ┌─────────────┐
 *           │  减速器      │（齿轮组，减速比 i）
 *           └──────┬───────┘
 *                  ▼
 *           ┌─────────────┐
 *           │  凸轮        │（将旋转→线位移）
 *           └──────┬───────┘
 *                  ▼
 *           ┌─────────────┐   输出轴（角位移输出）
 *           │  压紧弹簧    │→ 外部负载
 *           └──────┬───────┘
 *                  ▼
 *           ┌──────────────────────────────┐
 *           │  差动变压器（LVDT）            │
 *           │  W₂——W₁——W₂（三绕组结构）    │
 *           │  铁心随弹簧压缩量移动          │
 *           │  输出：V_lvdt（位置反馈电压）  │
 *           └──────┬───────────────────────┘
 *                  │ V_lvdt（反馈）
 *                  └──────────────────────→ 磁放大器（闭环）
 *
 * ── 交流电子开关原理 ──────────────────────────────────────────
 *
 *  每路开关由两个反并联二极管 + 一个 SCR 组成：
 *
 *    AC线路─┬─D₁(正向)─┬─SCR─┬→ 电机绕组
 *            └─D₂(反向)─┘     │
 *    中性线───────────────────┘
 *
 *  - SCR 触发：当触发脉冲到来时，SCR 在下一个过零点后导通
 *  - D₁ 允许正半周电流通过（此时 SCR 顺向偏置）
 *  - D₂ 允许负半周通过（提供续流/反向路径）
 *  - 实质：移相控制施加到电机绕组的交流有效值
 *
 * ── 差动变压器（LVDT）仿真模型 ──────────────────────────────
 *
 *  V_lvdt = K_lvdt × x_core（x_core 为铁心相对中心的位移，mm）
 *  x_core = f(cam_angle)（凸轮角→铁心位移的非线性关系）
 *  cam_angle = motor_position / gear_ratio
 *
 *  当铁心居中（x=0）：V_lvdt = 0 → ε = θ_ref → 电机继续运转
 *  当 V_lvdt = θ_ref：ε = 0 → 系统稳定
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  port_ref_in      — 位置给定输入（V 或 °等比例量）
 *  port_ac_l        — 220V 交流 L 端
 *  port_ac_n        — 220V 交流 N 端
 *  port_motor_i     — 励磁绕组 I
 *  port_motor_ii    — 控制绕组 II
 *  port_lvdt_out    — LVDT 输出（反馈信号）
 *  port_output_shaft— 输出轴（机械接口）
 */
export class MagAmpServoSystem extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(780, config.width  || 980);
        this.height = Math.max(300, config.height || 400);

        this.type    = 'mag_amp_servo';
        this.special = 'none';
        this.cache   = 'fixed';

        // ── 铭牌参数 ──
        this.label         = config.label         || 'SRV-02';
        this.supplyVoltage = config.supplyVoltage || 220;    // V AC
        this.supplyFreq    = config.supplyFreq    || 50;     // Hz
        this.gearRatio     = config.gearRatio     || 20;     // 减速比
        this.ratedSpeed    = config.ratedSpeed    || 1500;   // r/min（电机同步转速）

        // ── 磁放大器参数 ──
        this.magAmpGain    = config.magAmpGain    || 6.0;
        this.magAmpSat     = config.magAmpSat     || 10.0;   // V 饱和输出
        this.deadband      = config.deadband      || 0.5;    // V 死区

        // ── LVDT 参数 ──
        this.lvdtGain      = config.lvdtGain      || 1.0;    // V/mm
        this.lvdtRange     = config.lvdtRange     || 25;     // mm 铁心最大行程
        this.camLift       = config.camLift       || 20;     // mm 凸轮最大升程

        // ── 电机参数 ──
        this.motorInertia  = config.motorInertia  || 0.003;
        this.motorFriction = config.motorFriction || 0.002;
        this.motorTorqueK  = config.motorTorqueK  || 0.15;   // N·m/V

        // ── 状态变量 ──
        this._refSignal      = config.initRef  !== undefined ? parseFloat(config.initRef)  : 0.0;  // V 给定
        this._motorPosition  = 0.0;    // ° 电机转角
        this._motorSpeed     = 0.0;    // rad/s
        this._camAngle       = 0.0;    // ° 凸轮角（= motorPosition / gearRatio）
        this._coreDisp       = 0.0;    // mm LVDT 铁心位移
        this._lvdtOutput     = 0.0;    // V LVDT 输出（反馈信号）
        this._springForce    = 0.0;    // N 弹簧力（归一化）

        this._epsilon        = 0.0;
        this._magAmpOutA     = 0.0;
        this._magAmpOutB     = 0.0;
        this._alpha1         = 90.0;
        this._alpha2         = 90.0;
        this._switch1On      = false;  // 交流开关1导通状态
        this._switch2On      = false;  // 交流开关2导通状态
        this._acVoltage      = 0.0;    // 当前交流瞬时值

        this._state          = 'STEADY';
        this.opsCount        = config.initOps || 0;

        // ── 动画 ──
        this._acPhase        = 0;
        this._flowPhase      = 0;
        this._motorAngle     = 0;      // 动画角（不受减速器影响）
        this._springAnim     = 0;      // 弹簧压缩动画

        // ── 布局 ──────────────────────────────
        const W = this.width, H = this.height;
        const padT = H * 0.16, padB = H * 0.10;
        const usableH = H - padT - padB;
        const midY    = padT + usableH / 2;

        // 各模块 X 分区（从左到右）
        const col = [
            W*0.01,  // 0: 磁放大器左边
            W*0.14,  // 1: 触发电路左边
            W*0.26,  // 2: 交流开关左边
            W*0.40,  // 3: 电机左边
            W*0.54,  // 4: 减速器左边
            W*0.64,  // 5: 凸轮左边
            W*0.74,  // 6: 弹簧左边
            W*0.86,  // 7: LVDT左边
        ];
        const bw = [
            W*0.12,  // 磁放大器宽
            W*0.10,  // 触发电路宽
            W*0.12,  // 交流开关宽
            W*0.12,  // 电机宽
            W*0.08,  // 减速器宽
            W*0.08,  // 凸轮宽
            W*0.10,  // 弹簧宽
            W*0.12,  // LVDT宽
        ];

        this._col = col; this._bw = bw;
        this._usableH = usableH; this._padT = padT; this._midY = midY;

        // 磁放大器
        this._magBox = { x:col[0], y:padT, w:bw[0], h:usableH };
        // 触发电路（上下两个）
        this._trig1 = { x:col[1], y:padT,                 w:bw[1], h:usableH*0.42 };
        this._trig2 = { x:col[1], y:padT+usableH*0.58,    w:bw[1], h:usableH*0.42 };
        // 交流开关（上下两组）
        this._sw1 = { x:col[2], y:padT,                   w:bw[2], h:usableH*0.42 };
        this._sw2 = { x:col[2], y:padT+usableH*0.58,      w:bw[2], h:usableH*0.42 };
        // 电机
        this._motorBox = { x:col[3], y:padT, w:bw[3], h:usableH };
        // 减速器
        this._gearBox  = { x:col[4], y:padT+usableH*0.20, w:bw[4], h:usableH*0.60 };
        // 凸轮
        this._camBox   = { x:col[5], y:padT+usableH*0.15, w:bw[5], h:usableH*0.70 };
        // 弹簧
        this._springBox = { x:col[6], y:midY-8, w:bw[6], h:16 };
        // LVDT
        this._lvdtBox  = { x:col[7], y:padT, w:bw[7], h:usableH };

        // 220V 母线 Y 坐标
        this._acLineY  = padT * 0.40;


        this._init();

        // ── 端口 ──
        this.addPort(col[0],                   midY - usableH*0.15, 'port_ref_in',       'wire', '给定');
        this.addPort(W*0.30,                   this._acLineY,        'port_ac_l',         'wire', 'L');
        this.addPort(W*0.35,                   this._acLineY,        'port_ac_n',         'wire', 'N');
        this.addPort(col[3]+bw[3],             midY - usableH*0.20, 'port_motor_i',      'wire', 'Ⅰ');
        this.addPort(col[3]+bw[3],             midY + usableH*0.20, 'port_motor_ii',     'wire', 'Ⅱ');
        this.addPort(col[7]+bw[7],             midY,                 'port_lvdt_out',     'wire', 'LVDT');
        this.addPort(col[7]+bw[7],             padT+usableH,         'port_output_shaft', 'mech', '输出轴');
    }

    // ═══════════════════════════════════════════
    _init() {
        this._drawACBus();
        this._drawMagAmp();
        this._drawTrigger(this._trig1, '触发电路1', '#60c080');
        this._drawTrigger(this._trig2, '触发电路2', '#c08060');
        this._drawACSwitch(this._sw1, 'SCR₁', 'D₁D₂', '#5090d0', 'c');
        this._drawACSwitch(this._sw2, 'SCR₂', 'D₃D₄', '#d07050', 'e');
        this._drawMotor();
        this._drawGearBox();
        this._drawCam();
        this._drawLVDT();
        this._drawFeedbackLoop();
        this._drawLabel();

        this._dynAC     = new Konva.Group();
        this._dynMotor  = new Konva.Group();
        this._dynMech   = new Konva.Group();
        this._dynSignal = new Konva.Group();
        this.group.add(this._dynAC, this._dynMech, this._dynMotor, this._dynSignal);

        this._rebuildACSwitch();
        this._rebuildMotor();
        this._rebuildMech();
        this._rebuildSignal();
        this._drawControlPanel();
        
    }

    // ── 220V 交流母线 ────────────────────────
    _drawACBus() {
        const W = this.width, y = this._acLineY;
        this.group.add(new Konva.Line({
            points: [W*0.26, y, W*0.99, y],
            stroke: '#d03030', strokeWidth: 2.5,
        }));
        this.group.add(new Konva.Text({
            x: W*0.26, y: y-14,
            text: '~ 220V', fontSize: 9, fontStyle: 'bold', fill: '#c02020',
        }));
    }

    // ── 磁放大器 ─────────────────────────────
    _drawMagAmp() {
        const b = this._magBox;
        this.group.add(new Konva.Rect({ x:b.x+2,y:b.y+2,width:b.w,height:b.h, fill:'rgba(0,0,0,0.14)', cornerRadius:5 }));
        this.group.add(new Konva.Rect({
            x:b.x, y:b.y, width:b.w, height:b.h,
            fillLinearGradientStartPoint:{x:0,y:0}, fillLinearGradientEndPoint:{x:b.w,y:b.h},
            fillLinearGradientColorStops:[0,'#1e2d3e',0.5,'#2e3d4e',1,'#1e2c3a'],
            stroke:'#0e1c2e', strokeWidth:2, cornerRadius:5,
        }));
        this.group.add(new Konva.Rect({
            x:b.x+3, y:b.y+3, width:b.w-6, height:b.h-6,
            fill:'#121c28', stroke:'#2a3a4a', strokeWidth:1, cornerRadius:3,
        }));

        // 磁放大器标题
        this.group.add(new Konva.Text({ x:b.x+4, y:b.y+5, text:'磁放大器', fontSize:8, fontStyle:'bold', fill:'#70b0d8' }));
        this.group.add(new Konva.Text({ x:b.x+4, y:b.y+15, text:'Mag-Amp', fontSize:7, fill:'#406080' }));

        // 两个铁心环绕组（W₁ 控制绕组示意）
        const cx = b.x + b.w/2;
        [b.y+b.h*0.28, b.y+b.h*0.65].forEach((cy, idx) => {
            const r = b.w*0.20;
            // 铁心矩形框
            this.group.add(new Konva.Rect({
                x:cx-r, y:cy-r*0.55, width:r*2, height:r*1.1,
                fill:'transparent', stroke:'#5080a8', strokeWidth:3, cornerRadius:r*0.25,
            }));
            // 控制绕组（横向线圈）
            for (let i=0; i<4; i++) {
                const lx = cx - r*0.9 + r*0.45*i;
                this.group.add(new Konva.Arc({
                    x:lx+r*0.22, y:cy, innerRadius:0, outerRadius:r*0.20,
                    angle:180, rotation:i%2===0?0:180,
                    stroke:'#b09030', strokeWidth:1.8, fill:'transparent',
                }));
            }
            // 标注
            this.group.add(new Konva.Text({ x:cx-8, y:cy-r*0.55-11, text:'W₁', fontSize:7, fill:'#7090a0' }));
        });

        // 输入输出端子标注
        this.group.add(new Konva.Text({ x:b.x-36, y:b.y+b.h*0.26, text:'给定', fontSize:8, fill:'#80a0c0' }));
        this.group.add(new Konva.Arrow({ x:b.x-2,y:b.y+b.h*0.28, points:[0,0,6,0], pointerLength:4,pointerWidth:3, fill:'#6090c0',stroke:'#6090c0',strokeWidth:1.2 }));
        this.group.add(new Konva.Text({ x:b.x-36, y:b.y+b.h*0.60, text:'反馈', fontSize:8, fill:'#c09030' }));
        this.group.add(new Konva.Arrow({ x:b.x-2,y:b.y+b.h*0.62, points:[0,0,6,0], pointerLength:4,pointerWidth:3, fill:'#c09030',stroke:'#c09030',strokeWidth:1.2 }));

        this.group.add(new Konva.Text({ x:b.x+b.w-14, y:b.y+b.h*0.24, text:'a', fontSize:9, fontStyle:'bold', fill:'#60d080' }));
        this.group.add(new Konva.Text({ x:b.x+b.w-14, y:b.y+b.h*0.60, text:'b', fontSize:9, fontStyle:'bold', fill:'#d06060' }));
    }

    // ── 触发电路 ─────────────────────────────
    _drawTrigger(t, label, color) {
        this.group.add(new Konva.Rect({ x:t.x+1,y:t.y+1,width:t.w,height:t.h, fill:'rgba(0,0,0,0.12)', cornerRadius:4 }));
        this.group.add(new Konva.Rect({
            x:t.x, y:t.y, width:t.w, height:t.h,
            fill:'#1e2e20', stroke:'#2e4030', strokeWidth:1.5, cornerRadius:4,
        }));
        this.group.add(new Konva.Text({ x:t.x+3, y:t.y+3, text:label, fontSize:7, fontStyle:'bold', fill:color }));
        // 锯齿脉冲示意
        const wy = t.y + t.h*0.60, wx0=t.x+3, wx1=t.x+t.w-3;
        const pts=[wx0,wy];
        for (let i=0;i<5;i++) {
            const x0=wx0+(wx1-wx0)*i/5, x1=wx0+(wx1-wx0)*(i+0.65)/5, x2=wx0+(wx1-wx0)*(i+0.66)/5;
            pts.push(x1,wy-t.h*0.3,x2,wy);
        }
        pts.push(wx1,wy);
        this.group.add(new Konva.Line({ points:pts, stroke:color, strokeWidth:1.2, lineCap:'round', lineJoin:'round' }));
        this.group.add(new Konva.Text({ x:t.x+3, y:t.y+t.h*0.78, text:'α相控', fontSize:7, fill:color }));
    }

    // ── 交流电子开关（二极管+晶闸管，非整流桥）──
    _drawACSwitch(s, scrLabel, dLabel, color, nodeLabel) {
        this.group.add(new Konva.Rect({ x:s.x+1,y:s.y+1,width:s.w,height:s.h, fill:'rgba(0,0,0,0.12)', cornerRadius:4 }));
        this.group.add(new Konva.Rect({
            x:s.x, y:s.y, width:s.w, height:s.h,
            fill:'#221a10', stroke:'#3a2e18', strokeWidth:1.5, cornerRadius:4,
        }));
        this.group.add(new Konva.Text({ x:s.x+3, y:s.y+3, text:scrLabel, fontSize:8, fontStyle:'bold', fill:color }));

        const cx = s.x + s.w/2;
        const cy = s.y + s.h*0.46;
        const r  = s.h*0.14;

        // SCR 符号（左侧）
        const sx = s.x + s.w*0.28;
        // 三角形（SCR 主体）
        this.group.add(new Konva.Line({
            points:[sx-r*0.7,cy-r*0.7, sx-r*0.7,cy+r*0.7, sx+r*0.7,cy, sx-r*0.7,cy-r*0.7],
            fill:'#c87030', stroke:'#e09040', strokeWidth:1, closed:true,
        }));
        // 阻断线
        this.group.add(new Konva.Line({ points:[sx+r*0.7,cy-r*0.7,sx+r*0.7,cy+r*0.7], stroke:'#e09040', strokeWidth:1.2 }));
        // 门极
        this.group.add(new Konva.Line({ points:[sx+r*0.7,cy+r*0.4,sx+r*1.4,cy+r*0.9], stroke:'#e0e040', strokeWidth:1 }));
        this.group.add(new Konva.Circle({ x:sx+r*1.4,y:cy+r*0.9, radius:2, fill:'#e0e040' }));

        // 两个反并联二极管（右侧）
        const dx = s.x + s.w*0.72;
        [cy-r*0.9, cy+r*0.9].forEach((dy, idx) => {
            const rot = idx === 0 ? 0 : 180;
            this.group.add(new Konva.Line({
                points:[dx-r*0.5,dy-(idx===0?r*0.5:-r*0.5), dx-r*0.5,dy+(idx===0?r*0.5:-r*0.5), dx+r*0.5,dy, dx-r*0.5,dy-(idx===0?r*0.5:-r*0.5)],
                fill:'#4060c0', stroke:'#6080e0', strokeWidth:0.9, closed:true,
            }));
            this.group.add(new Konva.Line({
                points:[dx+r*0.5,dy-(idx===0?r*0.5:-r*0.5), dx+r*0.5,dy+(idx===0?r*0.5:-r*0.5)],
                stroke:'#6080e0', strokeWidth:1,
            }));
        });

        // 节点标注
        this.group.add(new Konva.Text({ x:cx-4, y:s.y-12, text:nodeLabel, fontSize:9, fontStyle:'bold', fill:'#d0b060' }));
        this.group.add(new Konva.Text({ x:s.x+3, y:s.y+s.h-12, text:dLabel, fontSize:7, fill:'#6080c0' }));
    }

    // ── 两相电机 ─────────────────────────────
    _drawMotor() {
        const m = this._motorBox;
        // 外圆
        this.group.add(new Konva.Rect({ x:m.x+2,y:m.y+2,width:m.w,height:m.h, fill:'rgba(0,0,0,0.12)', cornerRadius:m.w/2 }));
        this.group.add(new Konva.Rect({
            x:m.x, y:m.y, width:m.w, height:m.h,
            fill:'#3a4858', stroke:'#2a3848', strokeWidth:2, cornerRadius:m.w/2,
        }));
        this.group.add(new Konva.Rect({
            x:m.x+m.w*0.08, y:m.y+m.h*0.08, width:m.w*0.84, height:m.h*0.84,
            fillLinearGradientStartPoint:{x:0,y:0}, fillLinearGradientEndPoint:{x:m.w*0.84,y:m.h*0.84},
            fillLinearGradientColorStops:[0,'#c8d4dc',0.5,'#e8f0f4',1,'#b0c4d4'],
            cornerRadius:m.w/2,
        }));
        // 定子绕组标注（上下）
        this.group.add(new Konva.Text({ x:m.x+m.w*0.12, y:m.y+m.h*0.14, text:'Ⅰ', fontSize:9, fontStyle:'bold', fill:'#3060a0' }));
        this.group.add(new Konva.Text({ x:m.x+m.w*0.12, y:m.y+m.h*0.72, text:'Ⅱ', fontSize:9, fontStyle:'bold', fill:'#a04030' }));
        // 电机标注
        this.group.add(new Konva.Text({ x:m.x+m.w*0.18, y:m.y+m.h*0.43, text:'M', fontSize:11, fontStyle:'bold', fill:'#3a5068' }));
        this.group.add(new Konva.Text({ x:m.x, y:m.y+m.h+4, text:'两相电机', fontSize:7.5, fill:'#506070' }));

        // 保存转子中心
        this._rotorCX = m.x + m.w/2;
        this._rotorCY = m.y + m.h/2;
        this._rotorR  = m.w * 0.28;
    }

    // ── 减速器（齿轮组）─────────────────────
    _drawGearBox() {
        const g = this._gearBox;
        this.group.add(new Konva.Rect({ x:g.x+1,y:g.y+1,width:g.w,height:g.h, fill:'rgba(0,0,0,0.14)', cornerRadius:3 }));
        this.group.add(new Konva.Rect({
            x:g.x, y:g.y, width:g.w, height:g.h,
            fill:'#4a5060', stroke:'#3a4050', strokeWidth:1.5, cornerRadius:3,
        }));
        // 大小齿轮（剖面示意）
        const gcx = g.x + g.w/2, gcy = g.y + g.h/2;
        const r1 = g.w*0.32, r2 = g.w*0.18;
        // 大齿轮
        this.group.add(new Konva.Circle({ x:gcx, y:gcy-g.h*0.20, radius:r1, fill:'#7888a0', stroke:'#5a6878', strokeWidth:1.5 }));
        for (let i=0;i<10;i++) {
            const a=(i*36)*Math.PI/180;
            this.group.add(new Konva.Line({
                points:[gcx+(r1-2)*Math.cos(a),gcy-g.h*0.20+(r1-2)*Math.sin(a), gcx+(r1+4)*Math.cos(a),gcy-g.h*0.20+(r1+4)*Math.sin(a)],
                stroke:'#9aabb8', strokeWidth:2.5, lineCap:'round',
            }));
        }
        // 小齿轮（输出轴侧）
        this.group.add(new Konva.Circle({ x:gcx, y:gcy+g.h*0.20, radius:r2, fill:'#8898b0', stroke:'#5a6878', strokeWidth:1.2 }));
        for (let i=0;i<6;i++) {
            const a=(i*60)*Math.PI/180;
            this.group.add(new Konva.Line({
                points:[gcx+(r2-1)*Math.cos(a),gcy+g.h*0.20+(r2-1)*Math.sin(a), gcx+(r2+3)*Math.cos(a),gcy+g.h*0.20+(r2+3)*Math.sin(a)],
                stroke:'#a0b0c8', strokeWidth:2, lineCap:'round',
            }));
        }
        // 减速比标注
        this.group.add(new Konva.Text({ x:g.x+2, y:g.y+g.h-14, text:`i=${this.gearRatio}`, fontSize:7.5, fill:'#8090a8' }));
        this.group.add(new Konva.Text({ x:g.x, y:g.y-12, text:'减速器', fontSize:7.5, fill:'#708090' }));
        // 轴连线（电机→减速器，减速器→凸轮）
        const mx = this._motorBox.x + this._motorBox.w;
        const my = this._motorBox.y + this._motorBox.h/2;
        this.group.add(new Konva.Line({ points:[mx,my,g.x,gcy], stroke:'#8090a0', strokeWidth:3 }));
        this.group.add(new Konva.Line({ points:[g.x+g.w,gcy, this._camBox.x, this._camBox.y+this._camBox.h/2], stroke:'#8090a0', strokeWidth:2.5 }));
    }

    // ── 凸轮 ──────────────────────────────────
    _drawCam() {
        const c = this._camBox;
        const cx = c.x + c.w/2;
        const cy = c.y + c.h/2;
        const r  = Math.min(c.w, c.h) * 0.35;

        // 凸轮外廓（偏心椭圆）
        this.group.add(new Konva.Ellipse({
            x:cx-3, y:cy,
            radiusX:r*1.50, radiusY:r,
            fill:'#7888a0', stroke:'#5a6878', strokeWidth:1.5,
        }));
        this.group.add(new Konva.Circle({ x:cx, y:cy, radius:r*0.20, fill:'#4a5868', stroke:'#3a4858', strokeWidth:1 }));
        this.group.add(new Konva.Text({ x:c.x, y:c.y+c.h+3, text:'凸轮', fontSize:8, fill:'#708090' }));

        // 保存凸轮几何用于动态更新
        this._camCX = cx; this._camCY = cy; this._camR = r;
    }

    // ── 差动变压器（LVDT）────────────────────
    _drawLVDT() {
        const l = this._lvdtBox;
        const W = this.width;

        // 外壳
        this.group.add(new Konva.Rect({ x:l.x+1,y:l.y+1,width:l.w,height:l.h, fill:'rgba(0,0,0,0.14)', cornerRadius:4 }));
        this.group.add(new Konva.Rect({
            x:l.x, y:l.y, width:l.w, height:l.h,
            fill:'#2a3040', stroke:'#1a2030', strokeWidth:2, cornerRadius:4,
        }));
        this.group.add(new Konva.Rect({
            x:l.x+3, y:l.y+3, width:l.w-6, height:l.h-6,
            fill:'#1a2030', stroke:'#304050', strokeWidth:1, cornerRadius:2,
        }));

        // 三绕组示意（W₂-W₁-W₂，从上到下）
        const coilH = l.h * 0.22;
        const coilGap = l.h * 0.04;
        const coilColors = ['#c09030', '#5090c0', '#c09030']; // W₂, W₁, W₂
        const coilLabels = ['W₂', 'W₁', 'W₂'];
        [0,1,2].forEach(i => {
            const cy = l.y + l.h*0.10 + i*(coilH + coilGap);
            const cx = l.x + l.w/2;
            // 绕组方框（带剖面线）
            this.group.add(new Konva.Rect({
                x:l.x+4, y:cy, width:l.w-8, height:coilH,
                fill: i===1 ? '#182830' : '#201810',
                stroke:coilColors[i], strokeWidth:1.2, cornerRadius:2,
            }));
            // 绕组线圈波纹
            for (let j=0;j<5;j++) {
                const lx = l.x+6 + j*(l.w-12)/5;
                this.group.add(new Konva.Arc({
                    x:lx+(l.w-12)/10, y:cy+coilH/2,
                    innerRadius:0, outerRadius:(l.w-12)/10,
                    angle:180, rotation:j%2===0?0:180,
                    stroke:coilColors[i], strokeWidth:1.5, fill:'transparent',
                }));
            }
            // 标注
            this.group.add(new Konva.Text({
                x:l.x+l.w-18, y:cy+coilH*0.35,
                text:coilLabels[i], fontSize:7.5, fontStyle:'bold', fill:coilColors[i],
            }));
        });

        // 铁心槽（纵向贯穿三绕组）
        const slotW = l.w * 0.18;
        const slotX = l.x + (l.w-slotW)/2;
        this.group.add(new Konva.Rect({
            x:slotX, y:l.y+l.h*0.08, width:slotW, height:l.h*0.80,
            fill:'#1a2030', stroke:'#304050', strokeWidth:0.8,
        }));

        // 铁心导轨
        this.group.add(new Konva.Line({
            points:[slotX+slotW/2, l.y+l.h*0.06, slotX+slotW/2, l.y+l.h*0.95],
            stroke:'#304050', strokeWidth:1, dash:[3,2],
        }));

        // LVDT 标注
        this.group.add(new Konva.Text({ x:l.x+4, y:l.y+l.h*0.88, text:'LVDT', fontSize:8, fontStyle:'bold', fill:'#5090c0' }));
        this.group.add(new Konva.Text({ x:l.x+4, y:l.y+l.h*0.94, text:'差动变压器', fontSize:7, fill:'#406080' }));

        // 保存铁心位置参数
        this._lvdtSlotX  = slotX + slotW/2;
        this._lvdtCoreH  = l.h * 0.14;
        this._lvdtCenterY = l.y + l.h * 0.47; // 铁心居中位置
        this._lvdtRange_px = l.h * 0.28;       // 铁心最大移动 px

        // 弹簧连线（凸轮→铁心）
        this.group.add(new Konva.Text({ x:this._springBox.x, y:this._springBox.y-14, text:'压紧弹簧', fontSize:8, fill:'#7a8890' }));

        // 输出轴标注
        this.group.add(new Konva.Text({ x:l.x, y:l.y+l.h+4, text:'输出轴', fontSize:8, fill:'#6080a0' }));
    }

    // ── 反馈环路线 ────────────────────────────
    _drawFeedbackLoop() {
        const W = this.width, H = this.height;
        const padB = H * 0.08;
        // 反馈线（LVDT输出→底部→磁放大器）
        const fbY = H - padB;
        const lvdtMidX = this._lvdtBox.x + this._lvdtBox.w/2;
        const magMidX  = this._magBox.x  + this._magBox.w/2;
        this.group.add(new Konva.Line({
            points:[lvdtMidX, this._lvdtBox.y+this._lvdtBox.h, lvdtMidX, fbY, magMidX, fbY, magMidX, this._magBox.y+this._magBox.h],
            stroke:'#c09030', strokeWidth:1.5, dash:[6,3],
        }));
        this.group.add(new Konva.Arrow({
            x:magMidX, y:this._magBox.y+this._magBox.h,
            points:[0,0, 0,-8], pointerLength:5, pointerWidth:4,
            fill:'#c09030', stroke:'#c09030', strokeWidth:1.5,
        }));
        this.group.add(new Konva.Text({ x:magMidX+4, y:fbY-10, text:'V_lvdt（反馈）', fontSize:7.5, fill:'#b08020' }));
    }

    // ── 顶部标题 ─────────────────────────────
    _drawLabel() {
        this.group.add(new Konva.Text({
            x:0, y:-22, width:this.width,
            text:`${this.label}  磁放大器伺服系统（交流电子开关+减速器+LVDT反馈）  ~ ${this.supplyVoltage}V/${this.supplyFreq}Hz  减速比 i=${this.gearRatio}`,
            fontSize:9, fontStyle:'bold', fill:'#3a5060', align:'center',
        }));
    }

    // ── 控制面板（底部）─────────────────────
    _drawControlPanel() {
        const W = this.width, H = this.height;
        const panY = H*0.89;
        this.group.add(new Konva.Rect({ x:0,y:panY,width:W,height:H*0.11, fill:'#0c1420',stroke:'#1c2840',strokeWidth:1,cornerRadius:3 }));

        const btnY = panY + H*0.015;
        [
            { x:W*0.02, label:'给定+10', color:'#204080', delta:+10, type:'ref'   },
            { x:W*0.11, label:'给定-10', color:'#204080', delta:-10, type:'ref'   },
            { x:W*0.21, label:'给定+1',  color:'#1a3060', delta:+1,  type:'ref'   },
            { x:W*0.29, label:'给定-1',  color:'#1a3060', delta:-1,  type:'ref'   },
            { x:W*0.39, label:'清零',    color:'#402010', delta:0,   type:'reset' },
        ].forEach(({ x, label, color, delta, type }) => {
            const btn = new Konva.Rect({ x, y:btnY, width:W*0.08, height:H*0.055, fill:color, cornerRadius:3, listening:true });
            const txt = new Konva.Text({ x:x+2, y:btnY+H*0.015, text:label, fontSize:8, fill:'#c8d8f0', listening:false });
            btn.on('click tap', () => {
                if (type==='ref') this.setReference(this._refSignal+delta);
                else { this.setReference(0); this._motorPosition=0; this._motorSpeed=0; this._camAngle=0; this._coreDisp=0; this._lvdtOutput=0; }
            });
            this.group.add(btn, txt);
        });

        this._statusText = new Konva.Text({ x:W*0.50, y:panY+H*0.015, text:'', fontSize:8, fill:'#60b0e0', width:W*0.48 });
        this.group.add(this._statusText);
    }

    // ─────────────────────────────────────────
    // ── 动态：交流开关导通状态 ────────────────
    _rebuildACSwitch() {
        this._dynAC.destroyChildren();

        // 绘制 SCR 导通辉光
        [[this._sw1, this._switch1On, '#4080d0'], [this._sw2, this._switch2On, '#d06040']].forEach(([s, on, c]) => {
            if (!on) return;
            this._dynAC.add(new Konva.Rect({
                x:s.x+2, y:s.y+2, width:s.w-4, height:s.h-4,
                fill:`rgba(${c.match(/\d+/g).join(',')},0.28)`, cornerRadius:3,
            }));
            this._dynAC.add(new Konva.Text({
                x:s.x+3, y:s.y+s.h-12, text:'导通', fontSize:7, fontStyle:'bold',
                fill: c,
            }));
        });

        // 触发角显示
        [[this._trig1, this._alpha1, '#60c080'],[this._trig2, this._alpha2, '#c08060']].forEach(([t,alpha,color]) => {
            const frac = 1-alpha/180;
            this._dynAC.add(new Konva.Rect({ x:t.x+3,y:t.y+t.h*0.82,width:t.w*0.80*frac,height:t.h*0.08, fill:color,cornerRadius:1,opacity:0.8 }));
            this._dynAC.add(new Konva.Text({ x:t.x+3,y:t.y+t.h*0.70, text:`α=${alpha.toFixed(0)}°`,fontSize:7,fill:color }));
        }); 

        // 磁放大器输出条（a/b端）
        const b = this._magBox;
        const aH = (this._magAmpOutA/this.magAmpSat) * b.h*0.12;
        const bH = (this._magAmpOutB/this.magAmpSat) * b.h*0.12;
        if (aH>1) {
            this._dynAC.add(new Konva.Rect({ x:b.x+b.w-7,y:b.y+b.h*0.28-aH,width:5,height:aH, fill:'#40e060',cornerRadius:1 }));
            this._dynAC.add(new Konva.Text({ x:b.x+b.w-30,y:b.y+b.h*0.28-aH-9, text:`${this._magAmpOutA.toFixed(1)}V`,fontSize:7,fill:'#40d060' }));
        }
        if (bH>1) {
            this._dynAC.add(new Konva.Rect({ x:b.x+b.w-7,y:b.y+b.h*0.62,width:5,height:bH, fill:'#e04040',cornerRadius:1 }));
            this._dynAC.add(new Konva.Text({ x:b.x+b.w-30,y:b.y+b.h*0.62+bH+1, text:`${this._magAmpOutB.toFixed(1)}V`,fontSize:7,fill:'#d04040' }));
        }
        // ε 显示
        const epColor = Math.abs(this._epsilon)<this.deadband?'#40d060':Math.abs(this._epsilon)<5?'#d0c040':'#e04040';
        this._dynAC.add(new Konva.Text({ x:b.x+4,y:b.y+b.h*0.46, text:`ε=${this._epsilon.toFixed(2)}V`,fontSize:8,fontStyle:'bold',fill:epColor }));
    }

    // ── 动态：电机转子动画 ────────────────────
    _rebuildMotor() {
        this._dynMotor.destroyChildren();
        const cx=this._rotorCX, cy=this._rotorCY, r=this._rotorR;
        const spd=this._motorSpeed;

        // 转子（随速度旋转）
        const rotG = new Konva.Group({ x:cx, y:cy, rotation:this._motorAngle });
        rotG.add(new Konva.Circle({ x:0,y:0,radius:r, fill:'#b0c4d4',stroke:'#6080a0',strokeWidth:1.2 }));
        // 转子条（鼠笼）
        for (let i=0;i<6;i++) {
            const a=(i*60)*Math.PI/180;
            rotG.add(new Konva.Line({ points:[0,0,r*0.85*Math.cos(a),r*0.85*Math.sin(a)], stroke:spd!==0?'#6090d0':'#6878a0',strokeWidth:2,lineCap:'round' }));
        }
        rotG.add(new Konva.Circle({ x:0,y:0,radius:r*0.15, fill:'#5070a0' }));
        this._dynMotor.add(rotG);

        // 转速/方向
        this._dynMotor.add(new Konva.Text({
            x:cx-22, y:cy+r+6,
            text:`${Math.abs(this._motorSpeed*30/Math.PI).toFixed(0)}rpm`,
            fontSize:7.5, fontStyle:'bold', fill:Math.abs(this._motorSpeed)>0.1?'#70c0f0':'#607080',
        }));
        const dir=this._motorSpeed>0.1?'↻正转':this._motorSpeed<-0.1?'↺反转':'■停止';
        this._dynMotor.add(new Konva.Text({ x:cx-14,y:cy+r+16,text:dir,fontSize:7.5,fill:this._motorSpeed>0.1?'#50e080':this._motorSpeed<-0.1?'#e05040':'#708090' }));
    }

    // ── 动态：机械传动（凸轮、弹簧、LVDT铁心）──
    _rebuildMech() {
        this._dynMech.destroyChildren();

        // 凸轮旋转显示
        const camAngleRad = this._camAngle * Math.PI/180;
        const cx=this._camCX, cy=this._camCY, cr=this._camR;
        // 凸轮升程方向箭头
        const liftX = cx + cr*1.4*Math.cos(camAngleRad);
        const liftY = cy + cr*Math.sin(camAngleRad);
        this._dynMech.add(new Konva.Line({
            points:[cx,cy,liftX,liftY],
            stroke:'#e05030',strokeWidth:2,lineCap:'round',
        }));
        this._dynMech.add(new Konva.Circle({ x:liftX,y:liftY,radius:3,fill:'#e05030' }));

        // 弹簧（连接凸轮与LVDT铁心）
        const sp = this._springBox;
        const coils=12, coilW=sp.w;
        const compression = this._coreDisp / this.camLift; // 0~1
        const springLen = sp.w * (0.85 + 0.15*(1-Math.abs(compression)));
        const pts=[sp.x, sp.y];
        for (let i=0;i<coils;i++) {
            const fx=sp.x+springLen*i/coils;
            const amplitude=sp.h*0.55*(1-Math.abs(compression)*0.4);
            pts.push(fx+springLen/(2*coils),sp.y+(i%2===0?-amplitude:amplitude));
        }
        pts.push(sp.x+springLen, sp.y);
        this._dynMech.add(new Konva.Line({ points:pts,stroke:'#8898a8',strokeWidth:1.8,lineCap:'round',lineJoin:'round' }));

        // LVDT 铁心（可动）
        const coreY = this._lvdtCenterY + (this._coreDisp/this.lvdtRange)*this._lvdtRange_px;
        this._dynMech.add(new Konva.Rect({
            x:this._lvdtSlotX-6, y:coreY-this._lvdtCoreH/2,
            width:12, height:this._lvdtCoreH,
            fillLinearGradientStartPoint:{x:0,y:0}, fillLinearGradientEndPoint:{x:12,y:0},
            fillLinearGradientColorStops:[0,'#6a7888',0.5,'#c0ccd8',1,'#6a7888'],
            stroke:'#4a5868',strokeWidth:1,cornerRadius:2,
        }));
        // 铁心偏移量标注
        this._dynMech.add(new Konva.Text({
            x:this._lvdtBox.x+4, y:coreY+this._lvdtCoreH/2+3,
            text:`x=${this._coreDisp.toFixed(1)}mm`,
            fontSize:7.5,fill:'#5090b0',
        }));

        // LVDT 输出电压显示
        const lvColor = Math.abs(this._lvdtOutput)<0.2?'#50d070':Math.abs(this._lvdtOutput)<2?'#d0c040':'#e04040';
        this._dynMech.add(new Konva.Text({
            x:this._lvdtBox.x+2, y:this._lvdtBox.y+this._lvdtBox.h*0.82,
            text:`V_fb=${this._lvdtOutput.toFixed(3)}V`,
            fontSize:8,fontStyle:'bold',fill:lvColor,
        }));

        // 减速器转速显示
        const g = this._gearBox;
        const outSpeed = this._motorSpeed*30/Math.PI / this.gearRatio;
        this._dynMech.add(new Konva.Text({
            x:g.x+2, y:g.y-12,
            text:`${Math.abs(outSpeed).toFixed(1)}rpm`, fontSize:7.5, fill:'#8090a8',
        }));
    }

    // ── 动态：信号流动 & 状态文字 ────────────
    _rebuildSignal() {
        this._dynSignal.destroyChildren();
        const fp = this._flowPhase;

        // 活跃通路流动点
        const activeSwitch = this._switch1On ? 1 : this._switch2On ? 2 : 0;
        if (activeSwitch !== 0) {
            const sw   = activeSwitch===1 ? this._sw1 : this._sw2;
            const trig = activeSwitch===1 ? this._trig1 : this._trig2;
            const mag  = this._magBox;
            const color= activeSwitch===1 ? 'rgba(80,200,100,0.85)' : 'rgba(220,80,80,0.85)';
            const pathPts=[
                mag.x+mag.w, activeSwitch===1?mag.y+mag.h*0.28:mag.y+mag.h*0.62,
                trig.x, trig.y+trig.h/2,
                trig.x+trig.w, trig.y+trig.h/2,
                sw.x+sw.w*0.5, sw.y+sw.h/2,
            ];
            for (let j=0;j<3;j++) {
                const prog=(fp+j/3)%1;
                const segs=pathPts.length/2-1;
                const si=Math.min(segs-1,Math.floor(prog*segs));
                const sp2=(prog*segs)-si;
                const x0=pathPts[si*2],y0=pathPts[si*2+1],x1=pathPts[si*2+2],y1=pathPts[si*2+3];
                this._dynSignal.add(new Konva.Circle({ x:x0+(x1-x0)*sp2,y:y0+(y1-y0)*sp2,radius:3.5,fill:color }));
            }
        }

        if (this._statusText) {
            this._statusText.text(
                `给定: ${this._refSignal.toFixed(2)}V  ε: ${this._epsilon.toFixed(3)}V  ` +
                `α₁: ${this._alpha1.toFixed(0)}°  α₂: ${this._alpha2.toFixed(0)}°  ` +
                `SW1: ${this._switch1On?'通':'断'}  SW2: ${this._switch2On?'通':'断'}  ` +
                `n: ${(this._motorSpeed*30/Math.PI).toFixed(0)}rpm  ` +
                `凸轮: ${this._camAngle.toFixed(1)}°  铁心: ${this._coreDisp.toFixed(2)}mm  ` +
                `V_lvdt: ${this._lvdtOutput.toFixed(3)}V  [${this._state}]`
            );
        }
    }

    // ── 主循环 ────────────────────────────────
    // 集中化 tick（由 consys._tickAll 在 20fps 调用）
    tick(dt) {
        this._tick(dt);
    }


    _tick(dt) {
        this._acPhase   = (this._acPhase   + dt*2*Math.PI*this.supplyFreq) % (2*Math.PI);
        this._flowPhase = (this._flowPhase  + dt*2.0) % 1;
        this._acVoltage = this.supplyVoltage * Math.sqrt(2) * Math.sin(this._acPhase);

        // ── 1. 误差 & 磁放大器 ──
        this._epsilon = this._refSignal - this._lvdtOutput;
        const eps = this._epsilon, Km=this.magAmpGain, Vsat=this.magAmpSat, db=this.deadband;
        if (Math.abs(eps)<=db) {
            this._magAmpOutA=0; this._magAmpOutB=0;
        } else if (eps>db) {
            this._magAmpOutA=Math.min(Vsat,Km*(eps-db)); this._magAmpOutB=0;
        } else {
            this._magAmpOutA=0; this._magAmpOutB=Math.min(Vsat,Km*(-eps-db));
        }

        // ── 2. 触发角（相控） ──
        const normA=this._magAmpOutA/Vsat, normB=this._magAmpOutB/Vsat;
        this._alpha1 = normA>0.01 ? Math.max(5,  90-normA*(90-5))  : 175;
        this._alpha2 = normB>0.01 ? Math.max(5,  90-normB*(90-5))  : 175;

        // ── 3. 交流电子开关导通判断 ──
        //   过零点后延迟 α/360 × T 导通，简化为概率模型
        const cyclePhase = (this._acPhase % (2*Math.PI)) / (2*Math.PI); // 0~1
        const trigPhase1 = this._alpha1/360;
        const trigPhase2 = this._alpha2/360;
        this._switch1On = normA>0.01 && cyclePhase > trigPhase1 && cyclePhase < 0.5;
        this._switch2On = normB>0.01 && cyclePhase > 0.5+trigPhase2 && cyclePhase < 1.0;
        // 互锁：不能同时导通
        if (this._switch1On && this._switch2On) this._switch2On=false;

        // ── 4. 电机有效控制电压（均方根近似）──
        const Veff1 = normA>0.01 ? this.supplyVoltage*Math.sqrt(1-(this._alpha1/180)+(Math.sin(2*this._alpha1*Math.PI/180))/(2*Math.PI)) : 0;
        const Veff2 = normB>0.01 ? this.supplyVoltage*Math.sqrt(1-(this._alpha2/180)+(Math.sin(2*this._alpha2*Math.PI/180))/(2*Math.PI)) : 0;
        const Vc = Veff1 - Veff2;

        // ── 5. 电机动力学 ──
        const omega=this._motorSpeed;
        const Ke=0.9*this.supplyVoltage/((this.ratedSpeed*Math.PI/30)||1);
        const Bemf=Ke*Math.abs(omega);
        const Vnet=Vc-Math.sign(omega)*Bemf;
        const Torq=this.motorTorqueK*Vnet;
        const alpha_mech=(Torq-this.motorFriction*omega)/this.motorInertia;
        this._motorSpeed=Math.max(-this.ratedSpeed*Math.PI/30*1.1, Math.min(this.ratedSpeed*Math.PI/30*1.1, this._motorSpeed+alpha_mech*dt));
        this._motorPosition=(this._motorPosition+this._motorSpeed*dt*180/Math.PI)%360;
        this._motorAngle   =(this._motorAngle   +this._motorSpeed*dt*180/Math.PI)%360;

        // ── 6. 减速器 → 凸轮 ──
        this._camAngle=(this._motorPosition/this.gearRatio)%360;

        // ── 7. 凸轮升程（正弦凸轮特性）→ 铁心位移 ──
        //   x = L/2 × (1 - cos(θ_cam))   （等加速凸轮近似）
        this._coreDisp = this.camLift/2*(1-Math.cos(this._camAngle*Math.PI/180));

        // ── 8. LVDT 输出电压 ──
        //   铁心从中性位移 x，输出 V = K×(x - x_center)
        const xCenter = this.camLift/2;
        this._lvdtOutput = this.lvdtGain*(this._coreDisp - xCenter);

        // ── 9. 状态 ──
        if (Math.abs(eps)<this.deadband) this._state='STEADY';
        else if (Math.abs(omega)>1 && Math.sign(Vc)!==Math.sign(eps)) this._state='BRAKING';
        else this._state='TRACKING';

        this._rebuildACSwitch();
        this._rebuildMotor();
        this._rebuildMech();
        this._rebuildSignal();
        this._refreshCache();
    }

    // ═══════════════════════════════════════════
    /** 设置给定位置信号（V） */
    setReference(val) {
        this._refSignal = val;
        this.opsCount++;
        this._refreshCache();
    }

    /** 查询 */
    getState()         { return this._state; }
    getEpsilon()       { return this._epsilon; }
    getMotorSpeed()    { return this._motorSpeed*30/Math.PI; }
    getCamAngle()      { return this._camAngle; }
    getCoreDisp()      { return this._coreDisp; }
    getLVDTOutput()    { return this._lvdtOutput; }
    getAlpha1()        { return this._alpha1; }
    getAlpha2()        { return this._alpha2; }
    getOpsCount()      { return this.opsCount; }

    update(state) {
        if (!state||typeof state!=='object') return;
        if (state.reference!==undefined) this.setReference(state.reference);
        if (state.gearRatio!==undefined) this.gearRatio=Math.max(1,state.gearRatio);
        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label:'位号/名称',           key:'label',          type:'text'   },
            { label:'电源电压 (V)',         key:'supplyVoltage',  type:'number' },
            { label:'电源频率 (Hz)',        key:'supplyFreq',     type:'number' },
            { label:'减速比 i',            key:'gearRatio',      type:'number' },
            { label:'电机额定转速(r/min)',  key:'ratedSpeed',     type:'number' },
            { label:'磁放大器增益 Km',     key:'magAmpGain',     type:'number' },
            { label:'磁放大器饱和电压(V)', key:'magAmpSat',      type:'number' },
            { label:'死区 (V)',            key:'deadband',       type:'number' },
            { label:'凸轮最大升程 (mm)',   key:'camLift',        type:'number' },
            { label:'LVDT 灵敏度 (V/mm)',  key:'lvdtGain',       type:'number' },
            { label:'电机转动惯量(kg·m²)', key:'motorInertia',   type:'number' },
            { label:'初始给定信号 (V)',    key:'initRef',        type:'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label)         this.label         = cfg.label;
        if (cfg.supplyVoltage) this.supplyVoltage = parseFloat(cfg.supplyVoltage)||this.supplyVoltage;
        if (cfg.supplyFreq)    this.supplyFreq    = parseFloat(cfg.supplyFreq)   ||this.supplyFreq;
        if (cfg.gearRatio)     this.gearRatio     = parseFloat(cfg.gearRatio)    ||this.gearRatio;
        if (cfg.ratedSpeed)    this.ratedSpeed    = parseFloat(cfg.ratedSpeed)   ||this.ratedSpeed;
        if (cfg.magAmpGain)    this.magAmpGain    = parseFloat(cfg.magAmpGain)   ||this.magAmpGain;
        if (cfg.magAmpSat)     this.magAmpSat     = parseFloat(cfg.magAmpSat)    ||this.magAmpSat;
        if (cfg.deadband)      this.deadband      = parseFloat(cfg.deadband)     ||this.deadband;
        if (cfg.camLift)       this.camLift       = parseFloat(cfg.camLift)      ||this.camLift;
        if (cfg.lvdtGain)      this.lvdtGain      = parseFloat(cfg.lvdtGain)     ||this.lvdtGain;
        if (cfg.motorInertia)  this.motorInertia  = parseFloat(cfg.motorInertia) ||this.motorInertia;
        if (cfg.initRef!==undefined) this.setReference(parseFloat(cfg.initRef));
        this.config={...this.config,...cfg};
        this._refreshCache();
    }

    destroy() {
        super.destroy?.();
    }
}