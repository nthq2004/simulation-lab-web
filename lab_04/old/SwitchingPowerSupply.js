import { BaseComponent } from './BaseComponent.js';

/**
 * 开关稳压电源（SMPS — Switching Mode Power Supply）仿真组件
 *
 * ── 拓扑结构（反激式 Flyback，隔离型）─────────────────────────────
 *
 *  AC 输入  →  整流滤波  →  高频开关  →  高频变压器  →  输出整流滤波  →  稳定直流
 *                                                                ↑
 *                                               ← 光耦反馈 ← PWM控制器 ← 采样分压
 *
 * ── 七大环节详解 ──────────────────────────────────────────────────
 *
 *  ① 交流输入（AC Input）
 *     - 市电 220V / 50Hz（或 110V / 60Hz）
 *     - 通过保险丝（F）和 NTC 热敏电阻（RT）限制浪涌电流
 *     - EMI 滤波器（共模扼流圈 + X/Y 电容）抑制传导干扰
 *
 *  ② 整流滤波（Rectifier & Filter）
 *     - 桥式整流：4 个二极管组成全波整流桥（D1~D4）
 *     - 将 220V AC 整流为约 310V 脉动直流（峰值 = 220√2 ≈ 311V）
 *     - 大容量电解电容 C_bulk（通常 100~470μF/400V）滤波，得到相对平滑的直流
 *
 *  ③ 高频开关电路（HF Switch）
 *     - 功率 MOSFET（Q_sw）工作于高频（20kHz ~ 1MHz）
 *     - 受 PWM 控制器驱动，通过调节占空比（Duty Cycle D）控制能量传输
 *     - 导通时：电感/变压器储能；关断时：能量释放到输出
 *     - MOSFET 并联钳位电路（RCD Snubber）吸收关断尖峰
 *
 *  ④ 高频变压器（HF Transformer）
 *     - 隔离初、次级（安全隔离）
 *     - 铁氧体磁芯（EE/EI型），工作于高频以减小体积（频率越高，变压器越小）
 *     - 匝比 n = Np/Ns 决定输出电压关系：Vout ≈ Vin×D/n
 *     - 漏感产生的能量由初级 RCD 钳位电路吸收
 *
 *  ⑤ 输出整流滤波（Output Rectifier & Filter）
 *     - 肖特基二极管 D_out 整流（正向压降低 ≈ 0.3V，适合低压大电流）
 *     - 或同步整流 MOSFET（高效率场合）
 *     - 输出电感 L_out + 输出电容 C_out 构成 LC 滤波
 *     - 消除高频纹波，得到稳定直流
 *
 *  ⑥ 稳定直流输出（DC Output）
 *     - 标称输出：12V / 5A（或按配置）
 *     - 输出纹波：< 50mV（p-p）
 *     - 负载调整率：< 1%
 *
 *  ⑦ 反馈控制电路（Feedback Control）
 *     - 输出采样：R_fb1/R_fb2 分压得到 Vsample
 *     - TL431 精密基准比较器：比较 Vsample 与内部 2.5V 基准
 *     - 光电耦合器（PC817）：跨越隔离边界传递误差信号
 *     - PWM 控制芯片（UC3842/NCP1380 等）：
 *       接收光耦信号 → 调节占空比 D → 调整开关管导通时间
 *       Vout 升高 → TL431 拉高 → 光耦 LED 变亮 → PWM 减小 D → Vout 回落
 *       Vout 降低 → TL431 拉低 → 光耦 LED 变暗 → PWM 增大 D → Vout 回升
 *
 * ── 布局（从左到右，7 列）──────────────────────────────────────────
 *
 *  [① AC输入] → [② 整流滤波] → [③ 开关管] → [④ 变压器] →
 *               → [⑤ 输出整流] → [⑥ 直流输出]
 *                       ↑__________________________|
 *                    [⑦ 反馈控制（底部跨越）]
 *
 * ── 端口 ─────────────────────────────────────────────────────────
 *  terminal_acl   — 交流火线（L）
 *  terminal_acn   — 交流零线（N）
 *  terminal_vout  — 直流输出正极
 *  terminal_gnd   — 直流输出负极
 */
export class SwitchingPowerSupply extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        // ── 尺寸（宽大于高，7段横向排列）──
        this.width  = Math.max(700, config.width  || 820);
        this.height = Math.max(340, config.height || 420);

        this.type    = 'smps';
        this.special = 'none';
        this.cache   = 'fixed';

        this._initGroups();
        // ── 电气参数 ──
        this.label       = config.label       || 'PSU1';
        this.Vac         = config.Vac         || 220;    // V AC 输入
        this.Freq        = config.Freq        || 50;     // Hz
        this.Vout        = config.Vout        || 12;     // V DC 输出
        this.Iout        = config.Iout        || 5;      // A
        this.swFreq      = config.swFreq      || 65;     // kHz 开关频率
        this.duty        = config.duty        || 0.42;   // 占空比 0~1
        this.turnRatio   = config.turnRatio   || 10;     // 匝比 Np/Ns
        this.Vbulk       = Math.round(this.Vac * Math.SQRT2); // 整流后直流电压 ≈311V
        this.Vref_fb     = config.Vref_fb     || 2.5;   // TL431 基准 V
        this.Rfb1        = config.Rfb1        || 10000; // Ω
        this.Rfb2        = config.Rfb2        || 3000;  // Ω

        // ── 状态 ──
        this._enabled    = config.initEnabled !== false;
        this._phase      = 0;    // 全局相位（驱动所有动画）
        this._swPhase    = 0;    // 开关管 PWM 相位
        this._acPhase    = 0;    // 交流波形相位

        // ── 布局：将宽度分成 7 个区段 ──
        const W = this.width, H = this.height;
        const PAD  = 16;
        const innerW = W - PAD * 2;
        const innerH = H - PAD * 2;

        // 7段宽度比例：AC:Rect:Switch:XFMR:OutRect:OutDC:Footer
        const colRatios = [0.11, 0.13, 0.13, 0.15, 0.13, 0.11, 1.0];
        // 修正为绝对X坐标
        const cols = [];
        let cx = PAD;
        const ratios = [0.11, 0.13, 0.13, 0.15, 0.13, 0.11];
        ratios.forEach(r => {
            cols.push(cx + innerW * r / 2);
            cx += innerW * r;
        });
        // 各段中心X
        this._colX = cols;
        // 各段起始X和宽度
        this._colBounds = [];
        let bx = PAD;
        ratios.forEach(r => {
            const bw = innerW * r;
            this._colBounds.push({ x: bx, w: bw });
            bx += bw;
        });
        // 主信号线 Y
        this._signalY  = H * 0.32;  // 主路电流线
        this._gndY     = H * 0.70;  // 地线
        this._fbY      = H * 0.84;  // 反馈线
        // 反馈控制区域
        this._fbBlock  = {
            x: PAD + innerW * 0.30,
            y: H * 0.76,
            w: innerW * 0.52,
            h: H * 0.18,
        };

        this._init();

        // 端口
        this.addPort(PAD - 4,     this._signalY - 12, 'terminal_acl',  'wire', 'L');
        this.addPort(PAD - 4,     this._signalY + 12, 'terminal_acn',  'wire', 'N');
        this.addPort(W - PAD + 4, this._signalY,      'terminal_vout', 'wire', '+Vout');
        this.addPort(W - PAD + 4, this._gndY,         'terminal_gnd',  'wire', 'GND');
    }

    // ═══════════════════════════════════════════════════════════════
    _init() {
        this._drawBackground();
        this._drawMainBus();
        this._drawStage0_ACInput();
        this._drawStage1_Rectifier();
        this._drawStage2_Switch();
        this._drawStage3_Transformer();
        this._drawStage4_OutRectifier();
        this._drawStage5_DCOutput();
        this._drawStage6_Feedback();
        this._drawIsolationBarrier();
        this._drawTopLabels();
        this._drawStatusBar();
        this._createAnimLayers();
        
    }

    // ── 背景及网格 ────────────────────────────────────────────────
    _drawBackground() {
        const W = this.width, H = this.height;
        // 主背景
        this._staticGroup.add(new Konva.Rect({
            x:0, y:0, width:W, height:H,
            fillLinearGradientStartPoint:{x:0,y:0},
            fillLinearGradientEndPoint:{x:W,y:H},
            fillLinearGradientColorStops:[0,'#0d1218',0.5,'#101820',1,'#0d1218'],
            stroke:'#1e3050', strokeWidth:1.5, cornerRadius:10,
            shadowColor:'#000', shadowBlur:16, shadowOpacity:0.7,
        }));
        // 网格
        for (let gx=28; gx<W-14; gx+=24) {
            this._staticGroup.add(new Konva.Line({
                points:[gx,10,gx,H-10],
                stroke:'rgba(40,70,110,0.09)', strokeWidth:0.5,
            }));
        }
        for (let gy=28; gy<H-14; gy+=24) {
            this._staticGroup.add(new Konva.Line({
                points:[10,gy,W-10,gy],
                stroke:'rgba(40,70,110,0.09)', strokeWidth:0.5,
            }));
        }
        // 各段区域背景（交替深浅）
        const bgColors = [
            'rgba(160,60,60,0.06)',   // ①AC
            'rgba(200,100,50,0.07)',   // ②整流
            'rgba(80,80,200,0.07)',    // ③开关
            'rgba(120,60,180,0.07)',   // ④变压器
            'rgba(50,150,100,0.07)',   // ⑤输出整流
            'rgba(60,180,60,0.07)',    // ⑥DC输出
        ];
        const H2 = H * 0.72; // 主电路高度
        this._colBounds.forEach((b, i) => {
            this._staticGroup.add(new Konva.Rect({
                x:b.x+1, y:10, width:b.w-2, height:H2-6,
                fill:bgColors[i], cornerRadius:4,
            }));
            // 区段分隔线
            if (i>0) {
                this._staticGroup.add(new Konva.Line({
                    points:[b.x,12,b.x,H2-4],
                    stroke:'rgba(60,100,140,0.18)', strokeWidth:0.8,
                }));
            }
        });
    }

    // ── 主总线（水平信号线 & 地线）──────────────────────────────
    _drawMainBus() {
        const W = this.width, PAD = 16;
        const sy = this._signalY, gy = this._gndY;

        // 主路总线（分初级/次级，变压器处中断）
        const xfmrBound = this._colBounds[3];
        const xfmrMidX  = xfmrBound.x + xfmrBound.w / 2;

        // 初级侧主路（火线侧）
        this._staticGroup.add(new Konva.Line({
            points:[PAD, sy-12, xfmrBound.x+4, sy-12],
            stroke:'#c84040', strokeWidth:1.6, lineCap:'round',
        }));
        // 初级侧零线/地
        this._staticGroup.add(new Konva.Line({
            points:[PAD, sy+12, xfmrBound.x+4, gy],
            stroke:'#4060a0', strokeWidth:1.2, lineCap:'round',
        }));
        this._staticGroup.add(new Konva.Line({
            points:[PAD+40, gy, xfmrBound.x+4, gy],
            stroke:'#4060a0', strokeWidth:1.2, lineCap:'round',
        }));

        // 次级侧主路（输出+）
        this._staticGroup.add(new Konva.Line({
            points:[xfmrBound.x+xfmrBound.w-4, sy, W-PAD, sy],
            stroke:'#40c060', strokeWidth:1.6, lineCap:'round',
        }));
        // 次级侧 GND
        this._staticGroup.add(new Konva.Line({
            points:[xfmrBound.x+xfmrBound.w-4, gy, W-PAD, gy],
            stroke:'#408060', strokeWidth:1.2, lineCap:'round',
        }));

        // GND 符号（初级）
        this._drawGNDSymbol(this._colBounds[1].x + this._colBounds[1].w*0.5, gy + 12, '#4060a0');
        // GND 符号（次级）
        this._drawGNDSymbol(W - PAD - 20, gy + 12, '#408060');
    }

    _drawGNDSymbol(cx, y, color) {
        [14,9,5].forEach((hw, i) => {
            this._staticGroup.add(new Konva.Line({
                points:[cx-hw, y+i*4, cx+hw, y+i*4],
                stroke:color, strokeWidth:1.2, lineCap:'round',
            }));
        });
    }

    // ════════════════════════════════════════════════════════════════
    // ① 交流输入
    // ════════════════════════════════════════════════════════════════
    _drawStage0_ACInput() {
        const b   = this._colBounds[0];
        const cx  = b.x + b.w / 2;
        const sy  = this._signalY;
        const H   = this.height;

        // 保险丝 F（火线）
        const fy = sy - 12;
        this._drawFuse(cx, fy);

        // NTC热敏电阻 RT（串联在保险丝后）
        // 画在保险丝右侧一点（共用此段）
        this._drawNTC(b.x + b.w * 0.78, fy);

        // EMI 滤波器标注框
        this._staticGroup.add(new Konva.Rect({
            x:b.x+3, y:sy-32, width:b.w-6, height:50,
            stroke:'rgba(200,80,80,0.3)', strokeWidth:0.8,
            dash:[3,3], cornerRadius:3,
        }));
        this._staticGroup.add(new Konva.Text({
            x:b.x+4, y:sy-40, width:b.w-8,
            text:'EMI Filter', fontSize:7, fill:'#a05050',
            align:'center', fontFamily:'monospace',
        }));

        // X电容（跨火零线）
        const xcx = b.x + b.w * 0.6;
        const xcy = sy;
        this._drawCapacitor(xcx, xcy, true, 'Cx');

        // AC波形（动态，下方小区域）
        this._acWaveBox = { x:b.x+4, y:sy+28, w:b.w-8, h:36 };
        this._staticGroup.add(new Konva.Rect({
            x:this._acWaveBox.x, y:this._acWaveBox.y,
            width:this._acWaveBox.w, height:this._acWaveBox.h,
            fill:'rgba(0,0,0,0.35)', stroke:'rgba(200,80,80,0.4)',
            strokeWidth:0.8, cornerRadius:3,
        }));
        // AC输入端子标注
        this._staticGroup.add(new Konva.Text({
            x:b.x+2, y:sy-16, text:'L', fontSize:9,
            fill:'#f06060', fontStyle:'bold', fontFamily:'monospace',
        }));
        this._staticGroup.add(new Konva.Text({
            x:b.x+2, y:sy+6,  text:'N', fontSize:9,
            fill:'#6080f0', fontStyle:'bold', fontFamily:'monospace',
        }));
    }

    _drawFuse(cx, y) {
        // 保险丝矩形体
        this._staticGroup.add(new Konva.Rect({
            x:cx-10, y:y-4, width:20, height:8,
            fill:'rgba(80,80,80,0.6)', stroke:'#a0a0a0', strokeWidth:1, cornerRadius:2,
        }));
        // 引线
        this._staticGroup.add(new Konva.Line({
            points:[cx-16,y, cx-10,y], stroke:'#c84040', strokeWidth:1.5,
        }));
        this._staticGroup.add(new Konva.Line({
            points:[cx+10,y, cx+16,y], stroke:'#c84040', strokeWidth:1.5,
        }));
        // 内丝
        this._staticGroup.add(new Konva.Line({
            points:[cx-8,y, cx+8,y], stroke:'#f0c080', strokeWidth:1.2, lineCap:'round',
        }));
        this._staticGroup.add(new Konva.Text({
            x:cx-10, y:y-14, text:'F', fontSize:7, fill:'#909090', fontFamily:'monospace',
        }));
    }

    _drawNTC(cx, y) {
        this._staticGroup.add(new Konva.Rect({
            x:cx-7, y:y-5, width:14, height:10,
            fill:'rgba(40,20,20,0.8)', stroke:'#904020', strokeWidth:1, cornerRadius:2,
        }));
        this._staticGroup.add(new Konva.Text({
            x:cx-7, y:y+6, text:'NTC', fontSize:5.5, fill:'#a06040', fontFamily:'monospace',
        }));
    }

    _drawCapacitor(cx, cy, vertical, label) {
        const len = 10;
        if (vertical) {
            // 跨接在两线之间（垂直）
            this._staticGroup.add(new Konva.Line({
                points:[cx, cy-3, cx, cy-len], stroke:'#c0c0c0', strokeWidth:1,
            }));
            this._staticGroup.add(new Konva.Line({
                points:[cx, cy+3, cx, cy+len], stroke:'#c0c0c0', strokeWidth:1,
            }));
            this._staticGroup.add(new Konva.Line({
                points:[cx-6, cy-3, cx+6, cy-3], stroke:'#80c0e0', strokeWidth:2,
            }));
            this._staticGroup.add(new Konva.Line({
                points:[cx-6, cy+3, cx+6, cy+3], stroke:'#80c0e0', strokeWidth:2,
            }));
        }
        if (label) {
            this._staticGroup.add(new Konva.Text({
                x:cx+4, y:cy-6, text:label, fontSize:6.5, fill:'#5090b0', fontFamily:'monospace',
            }));
        }
    }

    // ════════════════════════════════════════════════════════════════
    // ② 整流桥 + 滤波电容
    // ════════════════════════════════════════════════════════════════
    _drawStage1_Rectifier() {
        const b   = this._colBounds[1];
        const cx  = b.x + b.w / 2;
        const sy  = this._signalY;
        const gy  = this._gndY;
        const midY = (sy + gy) / 2 - 10;

        // 整流桥菱形（4个二极管）
        const r = Math.min(b.w * 0.32, 28);
        this._drawBridge(cx - b.w*0.18, midY, r);

        // 滤波大电容 C_bulk
        const capX = b.x + b.w * 0.72;
        const capTopY = midY - r * 0.7;
        const capBotY = midY + r * 0.7;
        this._drawElectrolyticCap(capX, (capTopY + capBotY)/2, capTopY, capBotY);

        // 连线：桥右侧 → 电容正
        this._staticGroup.add(new Konva.Line({
            points:[cx - b.w*0.18 + r + 2, midY, capX - 6, (capTopY+capBotY)/2 - 4],
            stroke:'#e08040', strokeWidth:1.3,
        }));
        // 电容正极 → 主路
        this._staticGroup.add(new Konva.Line({
            points:[capX, capTopY - 4, capX, sy - 12, this._colBounds[2].x, sy-12],
            stroke:'#e08040', strokeWidth:1.3,
        }));
        // 电容负 → GND
        this._staticGroup.add(new Konva.Line({
            points:[capX, capBotY + 4, capX, gy],
            stroke:'#4060a0', strokeWidth:1.2,
        }));

        // 标注电压
        this._staticGroup.add(new Konva.Text({
            x:capX+8, y:midY-10, text:`~${this.Vbulk}V`, fontSize:7.5,
            fill:'#e09050', fontFamily:'monospace', fontStyle:'bold',
        }));
        // 波形动画框（整流后脉动直流）
        this._rectWaveBox = { x:b.x+3, y:sy+28, w:b.w-6, h:36 };
        this._staticGroup.add(new Konva.Rect({
            x:this._rectWaveBox.x, y:this._rectWaveBox.y,
            width:this._rectWaveBox.w, height:this._rectWaveBox.h,
            fill:'rgba(0,0,0,0.35)', stroke:'rgba(220,120,50,0.4)',
            strokeWidth:0.8, cornerRadius:3,
        }));
    }

    _drawBridge(cx, cy, r) {
        // 菱形四顶点：上(AC1), 右(DC+), 下(AC2), 左(DC-)
        const pts = {
            top:   { x:cx,   y:cy-r },
            right: { x:cx+r, y:cy   },
            bot:   { x:cx,   y:cy+r },
            left:  { x:cx-r, y:cy   },
        };
        // 四条臂（每条含二极管箭头）
        [
            [pts.top,   pts.right, 'D1'],
            [pts.right, pts.bot,   'D2'],
            [pts.left,  pts.top,   'D3'],
            [pts.bot,   pts.left,  'D4'],
        ].forEach(([from, to, lbl]) => {
            const mx = (from.x + to.x)/2, my = (from.y + to.y)/2;
            this._staticGroup.add(new Konva.Line({
                points:[from.x,from.y, to.x,to.y],
                stroke:'#b07030', strokeWidth:1.4,
            }));
            // 二极管三角（简化）
            this._staticGroup.add(new Konva.Circle({
                x:mx, y:my, radius:3.5,
                fill:'#3a2810', stroke:'#c08040', strokeWidth:1,
            }));
            this._staticGroup.add(new Konva.Text({
                x:mx+4, y:my-5, text:lbl, fontSize:5.5,
                fill:'#907040', fontFamily:'monospace',
            }));
        });
        // 顶底节点（AC输入）
        this._staticGroup.add(new Konva.Circle({ x:pts.top.x, y:pts.top.y, radius:3, fill:'#c84040' }));
        this._staticGroup.add(new Konva.Circle({ x:pts.bot.x, y:pts.bot.y, radius:3, fill:'#6080c0' }));
        // 左右节点（DC±）
        this._staticGroup.add(new Konva.Circle({ x:pts.right.x, y:pts.right.y, radius:3.5, fill:'#e08040' }));
        this._staticGroup.add(new Konva.Circle({ x:pts.left.x,  y:pts.left.y,  radius:3.5, fill:'#4060a0' }));
        // 标注
        this._staticGroup.add(new Konva.Text({
            x:cx-12, y:cy-r-12, text:'整流桥', fontSize:7, fill:'#b07030',
            align:'center', fontFamily:'monospace',
        }));
    }

    _drawElectrolyticCap(cx, cy, topY, botY) {
        const capH = Math.abs(botY - topY);
        const capW = 14;
        // 电容圆柱体
        this._staticGroup.add(new Konva.Rect({
            x:cx - capW/2, y:topY, width:capW, height:capH,
            fillLinearGradientStartPoint:{x:-capW/2,y:0},
            fillLinearGradientEndPoint:{x:capW/2,y:0},
            fillLinearGradientColorStops:[0,'#1a2a10',0.4,'#3a5a20',0.6,'#3a5a20',1,'#1a2a10'],
            stroke:'#4a8030', strokeWidth:1, cornerRadius:3,
        }));
        // 正极标记
        this._staticGroup.add(new Konva.Line({
            points:[cx-3, topY+5, cx+3, topY+5], stroke:'#80e040', strokeWidth:1.5,
        }));
        this._staticGroup.add(new Konva.Line({
            points:[cx, topY+2, cx, topY+8], stroke:'#80e040', strokeWidth:1.5,
        }));
        // 负极标记
        this._staticGroup.add(new Konva.Line({
            points:[cx-3, botY-5, cx+3, botY-5], stroke:'#a0a0a0', strokeWidth:1.5,
        }));
        this._staticGroup.add(new Konva.Text({
            x:cx-7, y:cy-5, text:'Cbulk', fontSize:5.5, fill:'#60a030',
            fontFamily:'monospace',
        }));
        // 引线
        this._staticGroup.add(new Konva.Line({ points:[cx,topY-2,cx,topY-6], stroke:'#e08040', strokeWidth:1.2 }));
        this._staticGroup.add(new Konva.Line({ points:[cx,botY+2,cx,botY+6], stroke:'#4060a0', strokeWidth:1.2 }));
    }

    // ════════════════════════════════════════════════════════════════
    // ③ 高频开关电路（MOSFET + 驱动 + RCD Snubber）
    // ════════════════════════════════════════════════════════════════
    _drawStage2_Switch() {
        const b   = this._colBounds[2];
        const cx  = b.x + b.w / 2;
        const sy  = this._signalY;
        const gy  = this._gndY;

        // MOSFET 符号
        const mosfetY = (sy + gy) / 2 - 8;
        this._mosfetPos = { x: cx, y: mosfetY };
        this._drawMOSFET(cx, mosfetY);

        // RCD Snubber（MOSFET漏极并联）
        this._drawSnubber(cx + b.w*0.32, mosfetY - 18);

        // 连线：主路 → MOSFET D极
        this._staticGroup.add(new Konva.Line({
            points:[b.x, sy-12, cx, sy-12, cx, mosfetY - 20],
            stroke:'#e08040', strokeWidth:1.4,
        }));
        // MOSFET S极 → GND
        this._staticGroup.add(new Konva.Line({
            points:[cx, mosfetY+22, cx, gy],
            stroke:'#4060a0', strokeWidth:1.3,
        }));

        // PWM 波形框（开关管门极波形）
        this._swWaveBox = { x:b.x+3, y:sy+28, w:b.w-6, h:36 };
        this._staticGroup.add(new Konva.Rect({
            x:this._swWaveBox.x, y:this._swWaveBox.y,
            width:this._swWaveBox.w, height:this._swWaveBox.h,
            fill:'rgba(0,0,0,0.35)', stroke:'rgba(100,100,220,0.4)',
            strokeWidth:0.8, cornerRadius:3,
        }));
        // 栅极连线（来自PWM控制器）
        this._gateLineStart = { x:cx - 22, y:mosfetY };
    }

    _drawMOSFET(cx, cy) {
        // 封装轮廓
        this._staticGroup.add(new Konva.Rect({
            x:cx-16, y:cy-24, width:32, height:48,
            fillLinearGradientStartPoint:{x:-16,y:0},
            fillLinearGradientEndPoint:{x:16,y:0},
            fillLinearGradientColorStops:[0,'#182030',0.5,'#2a3850',1,'#182030'],
            stroke:'#3a6090', strokeWidth:1.2, cornerRadius:4,
        }));
        // 栅极(G) 引线
        this._staticGroup.add(new Konva.Line({ points:[cx-16,cy, cx-24,cy], stroke:'#90c0ff', strokeWidth:1.5 }));
        // 栅极绝缘层
        this._staticGroup.add(new Konva.Line({ points:[cx-10,cy-14, cx-10,cy+14], stroke:'#5090d0', strokeWidth:2.5 }));
        // 沟道线
        this._staticGroup.add(new Konva.Line({ points:[cx-6,cy-14, cx-6,cy-4],  stroke:'#80b0e0', strokeWidth:1.5 }));
        this._staticGroup.add(new Konva.Line({ points:[cx-6,cy+4,  cx-6,cy+14], stroke:'#80b0e0', strokeWidth:1.5 }));
        // D/S引线
        this._staticGroup.add(new Konva.Line({ points:[cx-6,cy-14, cx+16,cy-14, cx+16,cy-24], stroke:'#80b0e0', strokeWidth:1.5 }));
        this._staticGroup.add(new Konva.Line({ points:[cx-6,cy+14, cx+16,cy+14, cx+16,cy+24], stroke:'#80b0e0', strokeWidth:1.5 }));
        // 体二极管
        this._staticGroup.add(new Konva.Line({ points:[cx+8,cy-10, cx+8,cy+10], stroke:'#f08040', strokeWidth:1 }));
        this._staticGroup.add(new Konva.Line({ points:[cx+5,cy-6,  cx+11,cy-6, cx+8,cy+8], stroke:'#f08040', strokeWidth:1, closed:true, fill:'rgba(240,120,50,0.3)' }));
        // 标注
        this._staticGroup.add(new Konva.Text({ x:cx-8, y:cy-24, text:'D', fontSize:7, fill:'#a0c0e0', fontFamily:'monospace' }));
        this._staticGroup.add(new Konva.Text({ x:cx-8, y:cy+16, text:'S', fontSize:7, fill:'#a0c0e0', fontFamily:'monospace' }));
        this._staticGroup.add(new Konva.Text({ x:cx-24, y:cy-4,  text:'G', fontSize:7, fill:'#a0c0e0', fontFamily:'monospace' }));
        this._staticGroup.add(new Konva.Text({
            x:cx-16, y:cy+26, width:32, text:'Q_sw\nMOSFET',
            fontSize:6.5, fill:'#5090c0', align:'center', fontFamily:'monospace', lineHeight:1.3,
        }));
    }

    _drawSnubber(cx, cy) {
        // RCD缓冲：R+C+D 串联
        this._staticGroup.add(new Konva.Rect({ x:cx-5, y:cy-8, width:10, height:16, fill:'#2a1810', stroke:'#804020', strokeWidth:1, cornerRadius:2 }));
        this._staticGroup.add(new Konva.Text({ x:cx-5, y:cy+10, text:'RCD', fontSize:5.5, fill:'#7a5030', fontFamily:'monospace' }));
        this._staticGroup.add(new Konva.Text({ x:cx-5, y:cy-18, text:'Snubber', fontSize:5.5, fill:'#5a4020', fontFamily:'monospace' }));
    }

    // ════════════════════════════════════════════════════════════════
    // ④ 高频变压器（EE磁芯，初次级绕组，隔离）
    // ════════════════════════════════════════════════════════════════
    _drawStage3_Transformer() {
        const b   = this._colBounds[3];
        const cx  = b.x + b.w / 2;
        const sy  = this._signalY;
        const gy  = this._gndY;
        const midY = (sy + gy) / 2 - 5;
        const H   = this.height;

        // 变压器外框
        const tw = b.w * 0.72, th = (gy - sy) * 0.72;
        const tx = cx - tw/2, ty = midY - th/2;
        this._xfmrRect = { x:tx, y:ty, w:tw, h:th };

        // EE 磁芯（两个E字对扣）
        this._staticGroup.add(new Konva.Rect({
            x:tx, y:ty, width:tw, height:th,
            fillLinearGradientStartPoint:{x:0,y:0},
            fillLinearGradientEndPoint:{x:tw,y:0},
            fillLinearGradientColorStops:[0,'#1a1020',0.15,'#2a1c38',0.5,'#221530',0.85,'#2a1c38',1,'#1a1020'],
            stroke:'#5a3080', strokeWidth:1.5, cornerRadius:6,
            shadowColor:'#6030a0', shadowBlur:8, shadowOpacity:0.3,
        }));

        // 初级绕组（左侧线圈）
        const coilX1 = tx + tw*0.22;
        this._drawCoil(coilX1, midY, th*0.55, '#e08040', 'Np', true);

        // 次级绕组（右侧线圈）
        const coilX2 = tx + tw*0.78;
        this._drawCoil(coilX2, midY, th*0.55, '#40c080', 'Ns', false);

        // 磁芯中柱（高亮）
        this._staticGroup.add(new Konva.Rect({
            x:cx-4, y:ty+6, width:8, height:th-12,
            fillLinearGradientStartPoint:{x:-4,y:0},
            fillLinearGradientEndPoint:{x:4,y:0},
            fillLinearGradientColorStops:[0,'#3a2050',0.5,'#7a50b0',1,'#3a2050'],
            cornerRadius:2,
        }));

        // 匝比标注
        this._staticGroup.add(new Konva.Text({
            x:cx-18, y:ty-14, width:36,
            text:`n=${this.turnRatio}:1`,
            fontSize:8, fill:'#a080d0', align:'center', fontStyle:'bold', fontFamily:'monospace',
        }));
        // 高频标注
        this._staticGroup.add(new Konva.Text({
            x:tx, y:ty+th+4, width:tw,
            text:`${this.swFreq}kHz 铁氧体磁芯`,
            fontSize:6.5, fill:'#6a50a0', align:'center', fontFamily:'monospace',
        }));

        // 初级端连线
        this._staticGroup.add(new Konva.Line({
            points:[b.x, sy-12, coilX1, sy-12, coilX1, midY-th*0.28],
            stroke:'#e08040', strokeWidth:1.4,
        }));
        this._staticGroup.add(new Konva.Line({
            points:[coilX1, midY+th*0.28, coilX1, gy],
            stroke:'#4060a0', strokeWidth:1.2,
        }));
        // 次级端连线
        this._staticGroup.add(new Konva.Line({
            points:[coilX2, midY-th*0.28, coilX2, sy, b.x+b.w, sy],
            stroke:'#40c080', strokeWidth:1.4,
        }));
        this._staticGroup.add(new Konva.Line({
            points:[coilX2, midY+th*0.28, coilX2, gy, b.x+b.w, gy],
            stroke:'#408060', strokeWidth:1.2,
        }));

        // 磁通动画粒子存储位置
        this._xfmrCenter = { x:cx, y:midY };
    }

    _drawCoil(cx, cy, height, color, label, isPrimary) {
        const turns = isPrimary ? 6 : 4;
        const coilW = 12;
        const segH  = height / turns;
        // 画螺旋线圈（左右弧线交替）
        for (let i = 0; i < turns; i++) {
            const y0 = cy - height/2 + i*segH;
            const y1 = y0 + segH;
            // 用半圆弧近似（Line拟合）
            const pts = [];
            const segs = 8;
            for (let s = 0; s <= segs; s++) {
                const t = s / segs;
                const angle = Math.PI * t; // 0 → π
                const side  = isPrimary ? 1 : -1;
                pts.push(cx + side * coilW * 0.5 * Math.sin(angle));
                pts.push(y0 + segH * t);
            }
            this._staticGroup.add(new Konva.Line({
                points:pts, stroke:color, strokeWidth:2, lineCap:'round', lineJoin:'round',
            }));
        }
        // 引线
        this._staticGroup.add(new Konva.Line({
            points:[cx, cy-height/2, cx, cy-height/2-8], stroke:color, strokeWidth:1.5,
        }));
        this._staticGroup.add(new Konva.Line({
            points:[cx, cy+height/2, cx, cy+height/2+8], stroke:color, strokeWidth:1.5,
        }));
        // 同名端（·）
        this._staticGroup.add(new Konva.Circle({
            x:cx + (isPrimary ? -8 : 8), y:cy - height/2 + 5,
            radius:2.5, fill:color,
        }));
        this._staticGroup.add(new Konva.Text({
            x:cx-6, y:cy-height/2-20, width:12, text:label,
            fontSize:7, fill:color, align:'center', fontFamily:'monospace', fontStyle:'bold',
        }));
    }

    // ════════════════════════════════════════════════════════════════
    // ⑤ 输出整流滤波（肖特基 + LC 滤波）
    // ════════════════════════════════════════════════════════════════
    _drawStage4_OutRectifier() {
        const b   = this._colBounds[4];
        const cx  = b.x + b.w / 2;
        const sy  = this._signalY;
        const gy  = this._gndY;
        const midY = (sy + gy) / 2 - 5;

        // 肖特基二极管 D_out
        const dy = sy + 8;
        this._drawSchottkyDiode(b.x + b.w*0.28, dy);

        // 输出电感 L_out
        const lx = b.x + b.w*0.58;
        this._drawInductor(lx, dy, 'Lo');

        // 输出滤波电容 C_out
        const capX = b.x + b.w * 0.82;
        this._drawOutputCap(capX, midY + 10);

        // 连线
        this._staticGroup.add(new Konva.Line({
            points:[b.x, sy, b.x+b.w*0.14, sy],
            stroke:'#40c080', strokeWidth:1.4,
        }));
        this._staticGroup.add(new Konva.Line({
            points:[b.x+b.w*0.42, sy, lx - 12, sy],
            stroke:'#40d090', strokeWidth:1.4,
        }));
        this._staticGroup.add(new Konva.Line({
            points:[lx+12, sy, capX, sy, capX, midY+4],
            stroke:'#40e090', strokeWidth:1.4,
        }));
        this._staticGroup.add(new Konva.Line({
            points:[capX, midY+22, capX, gy],
            stroke:'#408060', strokeWidth:1.2,
        }));
        // 续流二极管（D_fw，阴极到+，阳极到GND）
        this._staticGroup.add(new Konva.Line({
            points:[b.x+b.w*0.28, sy+18, b.x+b.w*0.28, gy],
            stroke:'#408060', strokeWidth:1,
        }));

        // 输出纹波波形框
        this._outWaveBox = { x:b.x+3, y:sy+28, w:b.w-6, h:36 };
        this._staticGroup.add(new Konva.Rect({
            x:this._outWaveBox.x, y:this._outWaveBox.y,
            width:this._outWaveBox.w, height:this._outWaveBox.h,
            fill:'rgba(0,0,0,0.35)', stroke:'rgba(50,200,120,0.4)',
            strokeWidth:0.8, cornerRadius:3,
        }));
    }

    _drawSchottkyDiode(cx, cy) {
        // 二极管体
        this._staticGroup.add(new Konva.Line({
            points:[cx-10,cy, cx-4,cy], stroke:'#40c080', strokeWidth:1.5,
        }));
        this._staticGroup.add(new Konva.Line({
            points:[cx-4,cy-7, cx-4,cy+7, cx+4,cy, cx-4,cy-7],
            stroke:'#40c080', strokeWidth:1.5, closed:true, fill:'rgba(50,180,100,0.25)',
        }));
        // 肖特基弯折阴极
        this._staticGroup.add(new Konva.Line({
            points:[cx+4,cy-7, cx+4,cy+7], stroke:'#40c080', strokeWidth:2, lineCap:'round',
        }));
        this._staticGroup.add(new Konva.Line({
            points:[cx+4,cy-7, cx+7,cy-10], stroke:'#40c080', strokeWidth:1.5, lineCap:'round',
        }));
        this._staticGroup.add(new Konva.Line({
            points:[cx+4,cy+7, cx+1,cy+10], stroke:'#40c080', strokeWidth:1.5, lineCap:'round',
        }));
        this._staticGroup.add(new Konva.Line({
            points:[cx+4,cy, cx+10,cy], stroke:'#40d090', strokeWidth:1.5,
        }));
        this._staticGroup.add(new Konva.Text({
            x:cx-10, y:cy+12, text:'D_out\n肖特基', fontSize:6, fill:'#40a070',
            fontFamily:'monospace', align:'center',
        }));
    }

    _drawInductor(cx, cy, label) {
        const turns = 4, w = 9, spacing = 9;
        const totalW = turns * spacing;
        // 引线
        this._staticGroup.add(new Konva.Line({ points:[cx-totalW/2-8,cy, cx-totalW/2,cy], stroke:'#40d090', strokeWidth:1.5 }));
        this._staticGroup.add(new Konva.Line({ points:[cx+totalW/2,cy, cx+totalW/2+8,cy], stroke:'#40e090', strokeWidth:1.5 }));
        // 螺旋弧
        for (let i=0; i<turns; i++) {
            const ax = cx - totalW/2 + i*spacing + spacing/2;
            const pts = [];
            const segs = 10;
            for (let s=0; s<=segs; s++) {
                const a = Math.PI * s / segs;
                pts.push(ax - (spacing/2)*Math.cos(a));
                pts.push(cy - w*0.5*Math.sin(a));
            }
            this._staticGroup.add(new Konva.Line({ points:pts, stroke:'#60c090', strokeWidth:2, lineCap:'round', lineJoin:'round' }));
        }
        this._staticGroup.add(new Konva.Text({ x:cx-12, y:cy-18, text:label, fontSize:7, fill:'#50b080', fontFamily:'monospace' }));
    }

    _drawOutputCap(cx, cy) {
        const capH = 28, capW = 12;
        this._staticGroup.add(new Konva.Rect({
            x:cx-capW/2, y:cy-capH/2, width:capW, height:capH,
            fillLinearGradientStartPoint:{x:-capW/2,y:0},
            fillLinearGradientEndPoint:{x:capW/2,y:0},
            fillLinearGradientColorStops:[0,'#102810',0.5,'#205020',1,'#102810'],
            stroke:'#3a8040', strokeWidth:1, cornerRadius:2,
        }));
        this._staticGroup.add(new Konva.Text({ x:cx-7, y:cy+capH/2+2, text:'Cout', fontSize:6, fill:'#50a050', fontFamily:'monospace' }));
        this._staticGroup.add(new Konva.Line({ points:[cx,cy-capH/2, cx,cy-capH/2-5], stroke:'#40e090', strokeWidth:1.2 }));
        this._staticGroup.add(new Konva.Line({ points:[cx,cy+capH/2, cx,cy+capH/2+5], stroke:'#408060', strokeWidth:1.2 }));
    }

    // ════════════════════════════════════════════════════════════════
    // ⑥ 直流输出
    // ════════════════════════════════════════════════════════════════
    _drawStage5_DCOutput() {
        const b   = this._colBounds[5];
        const cx  = b.x + b.w / 2;
        const sy  = this._signalY;
        const gy  = this._gndY;
        const W   = this.width, PAD = 16;

        // 输出端子（+/-）
        this._staticGroup.add(new Konva.Rect({
            x:b.x+4, y:sy-20, width:b.w-8, height:40,
            fill:'rgba(30,60,30,0.5)', stroke:'#3a8040', strokeWidth:1, cornerRadius:5,
        }));
        // + 端子
        this._staticGroup.add(new Konva.Circle({
            x:cx, y:sy, radius:7,
            fillRadialGradientStartPoint:{x:0,y:0}, fillRadialGradientStartRadius:0,
            fillRadialGradientEndPoint:{x:0,y:0},   fillRadialGradientEndRadius:7,
            fillRadialGradientColorStops:[0,'#60e080',0.6,'#20a040',1,'#104020'],
            stroke:'#40c060', strokeWidth:1.2,
            shadowColor:'#40ff80', shadowBlur:8, shadowOpacity:0.6,
        }));
        this._staticGroup.add(new Konva.Text({
            x:cx-4, y:sy-5, text:'+', fontSize:10, fill:'#c0ffc0', fontStyle:'bold',
        }));
        // - 端子
        this._staticGroup.add(new Konva.Circle({
            x:cx, y:gy, radius:5,
            fill:'#204030', stroke:'#408060', strokeWidth:1,
        }));
        this._staticGroup.add(new Konva.Line({
            points:[cx-3, gy, cx+3, gy], stroke:'#80c090', strokeWidth:1.5,
        }));

        // 电压数值（动态）
        this._voutDisplay = new Konva.Text({
            x:b.x+2, y:sy+14, width:b.w-4,
            text:`${this.Vout.toFixed(2)}V`,
            fontSize:13, fill:'#40ff80', fontStyle:'bold',
            align:'center', fontFamily:'monospace',
            shadowColor:'#40ff80', shadowBlur:6, shadowOpacity:0.8,
        });
        this._staticGroup.add(this._voutDisplay);
        this._staticGroup.add(new Konva.Text({
            x:b.x+2, y:sy+30, width:b.w-4,
            text:`${this.Iout.toFixed(1)}A`,
            fontSize:9, fill:'#30c060', align:'center', fontFamily:'monospace',
        }));

        // 波形框（稳定直流）
        this._dcWaveBox = { x:b.x+3, y:sy+40, w:b.w-6, h:36 };
        this._staticGroup.add(new Konva.Rect({
            x:this._dcWaveBox.x, y:this._dcWaveBox.y,
            width:this._dcWaveBox.w, height:this._dcWaveBox.h,
            fill:'rgba(0,0,0,0.35)', stroke:'rgba(40,220,100,0.4)',
            strokeWidth:0.8, cornerRadius:3,
        }));
    }

    // ════════════════════════════════════════════════════════════════
    // ⑦ 反馈控制电路（TL431 + 光耦 + PWM控制器）
    // ════════════════════════════════════════════════════════════════
    _drawStage6_Feedback() {
        const fb  = this._fbBlock;
        const W   = this.width, H = this.height, PAD = 16;
        const sy  = this._signalY;
        const gy  = this._gndY;

        // 反馈区域背景
        this._staticGroup.add(new Konva.Rect({
            x:fb.x, y:fb.y, width:fb.w, height:fb.h,
            fill:'rgba(10,20,40,0.7)', stroke:'#2a4878', strokeWidth:1, cornerRadius:6,
            dash:[4,2],
        }));
        this._staticGroup.add(new Konva.Text({
            x:fb.x+4, y:fb.y+3, width:fb.w-8,
            text:'⑦  反馈控制电路  Feedback Control',
            fontSize:8, fill:'#4a80c0', align:'center', fontFamily:'monospace', fontStyle:'bold',
        }));

        const bcy = fb.y + fb.h * 0.54;

        // 采样分压 Rfb1/Rfb2
        const rfbX = fb.x + fb.w * 0.06;
        this._drawMiniResistor(rfbX, bcy - 10, 'Rfb1');
        this._drawMiniResistor(rfbX, bcy + 14, 'Rfb2');
        this._staticGroup.add(new Konva.Text({
            x:rfbX-4, y:bcy+28, text:'采样', fontSize:6.5, fill:'#5080a0', fontFamily:'monospace',
        }));

        // TL431 精密基准
        const tl431X = fb.x + fb.w * 0.28;
        this._drawTL431(tl431X, bcy);

        // 光电耦合器
        const optoCX = fb.x + fb.w * 0.55;
        this._drawOptocoupler(optoCX, bcy);

        // PWM 控制器
        const pwmX = fb.x + fb.w * 0.80;
        this._drawPWMController(pwmX, bcy);

        // 反馈连线（次级→采样→TL431→光耦→PWM→开关管栅极）
        // 采样点从Vout引下
        const voutCol = this._colBounds[5];
        const voutFbX = voutCol.x + voutCol.w * 0.5;
        this._staticGroup.add(new Konva.Line({
            points:[voutFbX, sy+14, voutFbX, fb.y, rfbX, fb.y, rfbX, bcy-20],
            stroke:'#f0a040', strokeWidth:1, dash:[3,2],
        }));
        // 采样 → TL431
        this._staticGroup.add(new Konva.Line({
            points:[rfbX+16, bcy, tl431X-12, bcy],
            stroke:'#f0a040', strokeWidth:1, dash:[3,2],
        }));
        // TL431 → 光耦 LED
        this._staticGroup.add(new Konva.Line({
            points:[tl431X+12, bcy, optoCX-14, bcy],
            stroke:'#f06060', strokeWidth:1.2, dash:[3,2],
        }));
        // 光耦 → PWM（跨越隔离边界）
        this._staticGroup.add(new Konva.Line({
            points:[optoCX+14, bcy, pwmX-14, bcy],
            stroke:'#60a0f0', strokeWidth:1.2, dash:[3,2],
        }));
        // PWM → MOSFET 栅极（向上连线）
        const swCol = this._colBounds[2];
        const swCX  = swCol.x + swCol.w / 2;
        this._staticGroup.add(new Konva.Line({
            points:[pwmX, bcy-14, pwmX, fb.y-4, swCX-22, fb.y-4, swCX-22, this._signalY + 30],
            stroke:'#60a0f0', strokeWidth:1.2, dash:[3,2],
        }));
        // 箭头（方向指示）
        this._drawArrow(tl431X-12, bcy, 'left', '#f06060');
        this._drawArrow(optoCX-14, bcy, 'left', '#f06060');
        this._drawArrow(pwmX-14, bcy, 'left', '#60a0f0');
    }

    _drawMiniResistor(cx, cy, label) {
        this._staticGroup.add(new Konva.Rect({ x:cx-8,y:cy-5, width:16,height:10, fill:'#2a1810', stroke:'#806030', strokeWidth:1, cornerRadius:2 }));
        this._staticGroup.add(new Konva.Text({ x:cx+10,y:cy-5, text:label, fontSize:6, fill:'#806040', fontFamily:'monospace' }));
    }

    _drawTL431(cx, cy) {
        // 三端精密基准（类似BJT符号+外圈）
        this._staticGroup.add(new Konva.Circle({
            x:cx, y:cy, radius:12,
            fill:'#101820', stroke:'#4080c0', strokeWidth:1.3,
        }));
        // 内部基准符号
        this._staticGroup.add(new Konva.Line({ points:[cx-5,cy-5, cx+5,cy+5], stroke:'#60a0f0', strokeWidth:1.2 }));
        this._staticGroup.add(new Konva.Line({ points:[cx-5,cy+5, cx+5,cy-5], stroke:'#60a0f0', strokeWidth:1.2 }));
        this._staticGroup.add(new Konva.Text({
            x:cx-12, y:cy+14, text:'TL431', fontSize:6.5,
            fill:'#4080c0', fontFamily:'monospace',
        }));
        this._staticGroup.add(new Konva.Text({
            x:cx-12, y:cy+22, text:'精密基准', fontSize:6,
            fill:'#305070', fontFamily:'monospace',
        }));
    }

    _drawOptocoupler(cx, cy) {
        // 光耦外框
        this._staticGroup.add(new Konva.Rect({
            x:cx-13, y:cy-16, width:26, height:32,
            fill:'#101818', stroke:'#308070', strokeWidth:1.2, cornerRadius:3,
        }));
        // LED侧（左）
        this._staticGroup.add(new Konva.Line({ points:[cx-8,cy-8, cx-8,cy+8, cx-2,cy, cx-8,cy-8], stroke:'#f06040', strokeWidth:1.2, closed:true, fill:'rgba(240,80,40,0.2)' }));
        this._staticGroup.add(new Konva.Line({ points:[cx-2,cy-8, cx-2,cy+8], stroke:'#f06040', strokeWidth:1.5 }));
        // 光线箭头
        this._staticGroup.add(new Konva.Line({ points:[cx-1,cy-4, cx+3,cy-8], stroke:'#ffcc40', strokeWidth:1, dash:[2,1] }));
        this._staticGroup.add(new Konva.Line({ points:[cx-1,cy+4, cx+3,cy-0], stroke:'#ffcc40', strokeWidth:1, dash:[2,1] }));
        // 光敏三极管侧（右）
        this._staticGroup.add(new Konva.Circle({ x:cx+7, y:cy, radius:5, fill:'#101818', stroke:'#40a080', strokeWidth:1 }));
        this._staticGroup.add(new Konva.Text({
            x:cx-13, y:cy+18, text:'PC817 光耦', fontSize:6,
            fill:'#308060', fontFamily:'monospace',
        }));
        // 隔离符号
        this._staticGroup.add(new Konva.Line({
            points:[cx,cy-16, cx,cy+16], stroke:'rgba(255,200,50,0.4)', strokeWidth:0.8, dash:[2,2],
        }));
    }

    _drawPWMController(cx, cy) {
        this._staticGroup.add(new Konva.Rect({
            x:cx-14, y:cy-18, width:28, height:36,
            fillLinearGradientStartPoint:{x:-14,y:0},
            fillLinearGradientEndPoint:{x:14,y:0},
            fillLinearGradientColorStops:[0,'#101828',0.5,'#182840',1,'#101828'],
            stroke:'#3a6090', strokeWidth:1.3, cornerRadius:4,
        }));
        this._staticGroup.add(new Konva.Text({
            x:cx-12, y:cy-14, text:'PWM\nCtrl', fontSize:7,
            fill:'#5090d0', fontFamily:'monospace', align:'center', lineHeight:1.4,
        }));
        this._staticGroup.add(new Konva.Text({
            x:cx-14, y:cy+20, text:'UC3842', fontSize:6,
            fill:'#305070', fontFamily:'monospace',
        }));
        // PWM 输出小符号
        const pts = [];
        for (let i=0; i<8; i++) {
            const x = cx-8 + i*2;
            const h = (i%3===0) ? -5 : 0;
            pts.push(x, cy+h, x+2, cy+h);
        }
    }

    _drawArrow(x, y, dir, color) {
        const s = 5;
        if (dir === 'left') {
            this._staticGroup.add(new Konva.Line({
                points:[x+s,y-s, x,y, x+s,y+s],
                stroke:color, strokeWidth:1.2, lineCap:'round', lineJoin:'round',
            }));
        } else if (dir === 'right') {
            this._staticGroup.add(new Konva.Line({
                points:[x-s,y-s, x,y, x-s,y+s],
                stroke:color, strokeWidth:1.2, lineCap:'round', lineJoin:'round',
            }));
        }
    }

    // ── 隔离屏障（变压器处）─────────────────────────────────────
    _drawIsolationBarrier() {
        const b    = this._colBounds[3];
        const cx   = b.x + b.w / 2;
        const H    = this.height;
        const fbY  = this._fbBlock.y;

        // 虚线隔离墙
        this._staticGroup.add(new Konva.Line({
            points:[cx, 8, cx, fbY - 2],
            stroke:'rgba(255,200,50,0.35)', strokeWidth:1,
            dash:[4,4],
        }));
        this._staticGroup.add(new Konva.Text({
            x:cx-16, y:H*0.60, text:'⚡\n隔离', fontSize:8,
            fill:'rgba(255,200,50,0.5)', align:'center', fontFamily:'monospace',
        }));
        // 初/次级标注
        this._staticGroup.add(new Konva.Text({
            x:this._colBounds[2].x, y:8, width:b.x-this._colBounds[2].x,
            text:'初级  Primary', fontSize:7, fill:'rgba(220,100,50,0.6)',
            align:'center', fontFamily:'monospace',
        }));
        this._staticGroup.add(new Konva.Text({
            x:b.x+b.w, y:8, width:this._colBounds[4].w+this._colBounds[5].w,
            text:'次级  Secondary', fontSize:7, fill:'rgba(50,200,100,0.6)',
            align:'center', fontFamily:'monospace',
        }));
    }

    // ── 顶部区段标签 ─────────────────────────────────────────────
    _drawTopLabels() {
        const labels = [
            { i:0, text:'① 交流输入\nAC Input',       color:'#c06060' },
            { i:1, text:'② 整流滤波\nRectifier',       color:'#c08040' },
            { i:2, text:'③ 高频开关\nHF Switch',       color:'#6060d0' },
            { i:3, text:'④ 高频变压器\nHF Transformer',color:'#a060d0' },
            { i:4, text:'⑤ 输出整流\nOut Rectifier',   color:'#40b070' },
            { i:5, text:'⑥ 直流输出\nDC Output',       color:'#40d060' },
        ];
        labels.forEach(({ i, text, color }) => {
            const b = this._colBounds[i];
            this._staticGroup.add(new Konva.Text({
                x:b.x+1, y:12, width:b.w-2, text,
                fontSize:7, fill:color, align:'center',
                fontFamily:'monospace', lineHeight:1.35,
            }));
        });
    }

    // ── 底部状态栏 ───────────────────────────────────────────────
    _drawStatusBar() {
        const W = this.width, H = this.height, PAD = 16;
        const by = H - 18;

        this._staticGroup.add(new Konva.Text({
            x:PAD, y:by-2, text:`${this.label}  |  ${this.Vac}VAC/${this.Freq}Hz → ${this.Vout}VDC / ${this.Iout}A  |  开关频率: ${this.swFreq}kHz  |  效率: ~${(this._calcEta()*100).toFixed(0)}%`,
            fontSize:7.5, fill:'#3a6080', fontFamily:'monospace',
        }));

        this._statusDot = new Konva.Circle({
            x:W-PAD-6, y:by+2, radius:4.5,
            fill: this._enabled ? '#44dd66' : '#dd4444',
            stroke: this._enabled ? '#22882a' : '#882222',
            strokeWidth:0.8,
            shadowColor: this._enabled ? '#44dd66' : '#dd4444',
            shadowBlur:5, shadowOpacity:0.9,
        });
        this._staticGroup.add(this._statusDot);
    }

    _calcEta() {
        // SMPS 典型效率估算（简化）
        const Pout = this.Vout * this.Iout;
        const Psw  = 0.5 * this.Vin * this.Iout * 0.02;  // 开关损耗
        const Pcond = (this.Vbulk - this.Vout * this.turnRatio) * this.Iout * this.duty * 0.005;
        const Pin  = Pout + 5 + Psw;  // 粗略
        return Math.min(0.92, Pout / Pin);
    }

    // ════════════════════════════════════════════════════════════════
    // 动画层
    // ════════════════════════════════════════════════════════════════
    _createAnimLayers() {
        this._animGroup = new Konva.Group({ listening:false });
        this._staticGroup.add(this._animGroup);

        // 动态波形曲线（每个波形框一条线）
        this._waveLines = {};
        const waveBoxes = {
            ac:   { box: null, color:'#f06060', type:'sine' },   // AC正弦波
            rect: { box: null, color:'#e08040', type:'rectify' }, // 整流脉动
            sw:   { box: null, color:'#8080ff', type:'pwm' },     // PWM方波
            out:  { box: null, color:'#40e090', type:'ripple' },  // 输出纹波
            dc:   { box: null, color:'#40ff80', type:'dc' },      // 稳定直流
        };
        Object.keys(waveBoxes).forEach(key => {
            const line = new Konva.Line({
                points:[0,0], stroke:waveBoxes[key].color,
                strokeWidth:1.5, lineCap:'round', lineJoin:'round',
            });
            this._animGroup.add(line);
            this._waveLines[key] = { line, type:waveBoxes[key].type };
        });

        // 主路电流粒子（蓝/橙，初级）
        this._primaryParticles = this._makeParticles(14, '#ff8040', 2.5, 0.9);
        // 次级电流粒子（绿）
        this._secondaryParticles = this._makeParticles(10, '#40f090', 2.5, 0.9);
        // 反馈信号粒子（黄）
        this._fbParticles = this._makeParticles(8, '#ffcc40', 2, 0.8);
        // 磁通动画（变压器内部旋转环）
        this._fluxDots = [];
        for (let i=0; i<6; i++) {
            const d = new Konva.Circle({ x:0,y:0, radius:2, fill:'#c080ff', opacity:0, listening:false });
            this._animGroup.add(d);
            this._fluxDots.push({ dot:d, t:i/6 });
        }
        // 开关管 PWM 光晕
        this._swGlow = new Konva.Rect({
            x:0, y:0, width:0, height:0, fill:'rgba(80,100,255,0)', cornerRadius:3, listening:false,
        });
        this._animGroup.add(this._swGlow);
        if (this._mosfetPos) {
            const m = this._mosfetPos;
            this._swGlow.x(m.x - 18);
            this._swGlow.y(m.y - 26);
            this._swGlow.width(36);
            this._swGlow.height(52);
        }
    }

    _makeParticles(count, color, radius, maxOpacity) {
        const arr = [];
        for (let i=0; i<count; i++) {
            const dot = new Konva.Circle({
                x:0, y:0, radius,
                fill:color, opacity:0,
                shadowColor:color, shadowBlur:5, shadowOpacity:0.8,
                listening:false,
            });
            this._animGroup.add(dot);
            arr.push({ dot, t:i/count });
        }
        return arr;
    }

    // ── 路径定义 ────────────────────────────────────────────────
    _getPrimaryPath() {
        // Vin → 整流 → 大电容 → 开关管 → 变压器初级
        const c0 = this._colBounds[0], c1 = this._colBounds[1], c2 = this._colBounds[2], c3 = this._colBounds[3];
        const sy = this._signalY, gy = this._gndY;
        const xfmrLx = c3.x + c3.w * 0.22;
        return [
            { x:16,                    y:sy-12 },
            { x:c1.x + c1.w*0.75,     y:sy-12 },
            { x:c2.x,                  y:sy-12 },
            { x:c2.x + c2.w*0.5,      y:sy-12 },
            { x:c2.x + c2.w*0.5,      y:(sy+gy)/2-8-22 },
            { x:c2.x + c2.w*0.5,      y:(sy+gy)/2-8+22 },
            { x:c2.x + c2.w*0.5,      y:gy },
            { x:xfmrLx,                y:gy },
            { x:xfmrLx,                y:(sy+gy)/2-5 },
        ];
    }

    _getSecondaryPath() {
        const c3 = this._colBounds[3], c4 = this._colBounds[4], c5 = this._colBounds[5];
        const sy = this._signalY, gy = this._gndY;
        const xfmrRx = c3.x + c3.w * 0.78;
        return [
            { x:xfmrRx,             y:(sy+gy)/2-5 },
            { x:xfmrRx,             y:sy },
            { x:c4.x,               y:sy },
            { x:c4.x + c4.w*0.42,  y:sy },
            { x:c4.x + c4.w*0.70,  y:sy },
            { x:c5.x + c5.w*0.5,   y:sy },
            { x:this.width-16,      y:sy },
        ];
    }

    _getFeedbackPath() {
        const c5 = this._colBounds[5], fb = this._fbBlock;
        const sy = this._signalY;
        const fbCY = fb.y + fb.h * 0.54;
        const rfbX = fb.x + fb.w * 0.06;
        const pwmX = fb.x + fb.w * 0.80;
        const swCX = this._colBounds[2].x + this._colBounds[2].w/2;
        return [
            { x:c5.x + c5.w*0.5, y:sy+14 },
            { x:c5.x + c5.w*0.5, y:fb.y },
            { x:rfbX,             y:fb.y },
            { x:rfbX,             y:fbCY },
            { x:fb.x+fb.w*0.28,  y:fbCY },
            { x:fb.x+fb.w*0.55,  y:fbCY },
            { x:pwmX,             y:fbCY },
            { x:pwmX,             y:fb.y-4 },
            { x:swCX-22,          y:fb.y-4 },
            { x:swCX-22,          y:sy+30 },
        ];
    }

    _interpPath(path, t) {
        const segs = [];
        let total = 0;
        for (let i=1; i<path.length; i++) {
            const dx = path[i].x-path[i-1].x, dy = path[i].y-path[i-1].y;
            const l  = Math.sqrt(dx*dx+dy*dy);
            segs.push(l);
            total += l;
        }
        if (total === 0) return path[0];
        let target = ((t % 1) + 1) % 1 * total;
        for (let i=0; i<segs.length; i++) {
            if (target <= segs[i]) {
                const f = target / segs[i];
                return {
                    x: path[i].x + (path[i+1].x - path[i].x) * f,
                    y: path[i].y + (path[i+1].y - path[i].y) * f,
                };
            }
            target -= segs[i];
        }
        return path[path.length-1];
    }

    // ── 波形渲染 ────────────────────────────────────────────────
    _renderWaveform(box, type, phase, lineObj) {
        if (!box) return;
        const { x, y, w, h } = box;
        const pts = [];
        const steps = Math.floor(w / 2);
        const my = y + h/2;
        const amp = h * 0.38;
        for (let i=0; i<=steps; i++) {
            const px = x + i*(w/steps);
            const t  = i/steps;
            let py;
            switch (type) {
                case 'sine':
                    py = my - amp * Math.sin(t * Math.PI*4 + phase);
                    break;
                case 'rectify':
                    py = my - amp * Math.abs(Math.sin(t * Math.PI*4 + phase));
                    break;
                case 'pwm': {
                    const period = w / 6;
                    const pos    = (px - x + phase * 8) % period;
                    py = my + (pos < period * this.duty ? -amp*0.85 : amp*0.2);
                    break;
                }
                case 'ripple':
                    py = my - amp*0.72 - amp*0.14 * Math.sin(t * Math.PI*12 + phase*3);
                    break;
                case 'dc':
                    py = my - amp*0.80;
                    break;
                default:
                    py = my;
            }
            pts.push(px, py);
        }
        lineObj.points(pts);
    }

    // ── 主帧更新 ────────────────────────────────────────────────
    _tickAnimation(dt) {
        if (!this._enabled) {
            [...this._primaryParticles, ...this._secondaryParticles, ...this._fbParticles]
                .forEach(p => p.dot.opacity(0));
            this._fluxDots.forEach(f => f.dot.opacity(0));
            this._swGlow.fill('rgba(80,100,255,0)');
            return;
        }

        this._phase   += dt * 0.9;
        this._swPhase += dt * this.swFreq * 0.008; // PWM 视觉速度
        this._acPhase += dt * this.Freq * 0.04;

        // 渲染五路波形
        const waveData = [
            { key:'ac',   box:this._acWaveBox,   type:'sine',    phase:this._acPhase },
            { key:'rect', box:this._rectWaveBox, type:'rectify', phase:this._acPhase },
            { key:'sw',   box:this._swWaveBox,   type:'pwm',     phase:this._swPhase },
            { key:'out',  box:this._outWaveBox,  type:'ripple',  phase:this._swPhase },
            { key:'dc',   box:this._dcWaveBox,   type:'dc',      phase:0 },
        ];
        waveData.forEach(({ key, box, type, phase }) => {
            if (this._waveLines[key]) {
                this._renderWaveform(box, type, phase, this._waveLines[key].line);
            }
        });

        // 初级电流粒子
        const pPath = this._getPrimaryPath();
        this._primaryParticles.forEach(p => {
            p.t = ((p.t + dt*0.28) % 1);
            const pos = this._interpPath(pPath, p.t);
            p.dot.x(pos.x); p.dot.y(pos.y);
            const a = p.t < 0.06 ? p.t/0.06 : p.t > 0.94 ? (1-p.t)/0.06 : 1;
            p.dot.opacity(a * 0.85);
        });

        // 次级电流粒子
        const sPath = this._getSecondaryPath();
        this._secondaryParticles.forEach(p => {
            p.t = ((p.t + dt*0.42) % 1);
            const pos = this._interpPath(sPath, p.t);
            p.dot.x(pos.x); p.dot.y(pos.y);
            const a = p.t < 0.06 ? p.t/0.06 : p.t > 0.94 ? (1-p.t)/0.06 : 1;
            p.dot.opacity(a * 0.80);
        });

        // 反馈信号粒子
        const fbPath = this._getFeedbackPath();
        this._fbParticles.forEach(p => {
            p.t = ((p.t + dt*0.22) % 1);
            const pos = this._interpPath(fbPath, p.t);
            p.dot.x(pos.x); p.dot.y(pos.y);
            const a = p.t < 0.05 ? p.t/0.05 : p.t > 0.95 ? (1-p.t)/0.05 : 1;
            p.dot.opacity(a * 0.72);
        });

        // 变压器磁通环
        const xc = this._xfmrCenter;
        if (xc) {
            this._fluxDots.forEach(f => {
                f.t = ((f.t + dt*0.55) % 1);
                const angle = f.t * Math.PI * 2;
                f.dot.x(xc.x + 5 * Math.cos(angle));
                f.dot.y(xc.y + 18 * Math.sin(angle));
                f.dot.opacity(0.65 * Math.abs(Math.sin(angle)));
            });
        }

        // 开关管 PWM 光晕（脉冲闪烁）
        const swPulse = 0.5 + 0.5 * Math.sin(this._swPhase * Math.PI * 2);
        const onFrac  = swPulse > (1 - this.duty) ? 1 : 0; // 简化方波
        const glowA   = onFrac * (0.18 + 0.08 * swPulse);
        this._swGlow.fill(`rgba(80,120,255,${glowA.toFixed(3)})`);

        this._animGroup.getLayer()?.batchDraw();
    }

    // 集中化 tick（由 consys._tickAll 在 20fps 调用）
    tick(dt) {
        this._tickAnimation(dt);
    
        this._refreshCache();
    }
    _bindInteraction() {
        // 点击直流输出区域切换使能
        if (this._voutDisplay) {
            this._voutDisplay.on('click tap', () => this.toggle());
            this._voutDisplay.listening(true);
        }
    }

    // ════════════════════════════════════════════════════════════════
    // 公共 API
    // ════════════════════════════════════════════════════════════════
    toggle() {
        this._enabled = !this._enabled;
        if (this._statusDot) {
            this._statusDot.fill(this._enabled ? '#44dd66' : '#dd4444');
            this._statusDot.stroke(this._enabled ? '#22882a' : '#882222');
            this._statusDot.shadowColor(this._enabled ? '#44dd66' : '#dd4444');
            this._statusDot.shadowBlur(this._enabled ? 5 : 2);
        }
        this._refreshCache();
    }

    setDuty(d) {
        this.duty = Math.max(0.05, Math.min(0.95, d));
        this._refreshCache();
    }

    setVout(v) {
        this.Vout = v;
        if (this._voutDisplay) this._voutDisplay.text(`${v.toFixed(2)}V`);
        this._refreshCache();
    }

    getState() {
        return {
            enabled:  this._enabled,
            Vac:      this.Vac,
            Vout:     this.Vout,
            Iout:     this.Iout,
            duty:     this.duty,
            swFreq:   this.swFreq,
            Vbulk:    this.Vbulk,
            Pout:     this.Vout * this.Iout,
            eta:      this._calcEta(),
        };
    }

    update(state) {
        if (typeof state === 'boolean') {
            if (state !== this._enabled) this.toggle();
        } else if (state && typeof state === 'object') {
            if (state.duty  !== undefined) this.setDuty(state.duty);
            if (state.Vout  !== undefined) this.setVout(state.Vout);
            if (state.Iout  !== undefined) { this.Iout = state.Iout; }
        }
        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label:'位号/名称',          key:'label',    type:'text'   },
            { label:'交流输入电压 (V)',    key:'Vac',      type:'number' },
            { label:'交流频率 (Hz)',       key:'Freq',     type:'number' },
            { label:'直流输出电压 (V)',    key:'Vout',     type:'number' },
            { label:'额定输出电流 (A)',    key:'Iout',     type:'number' },
            { label:'开关频率 (kHz)',      key:'swFreq',   type:'number' },
            { label:'初始占空比 (0~1)',    key:'duty',     type:'number' },
            { label:'变压器匝比 Np/Ns',   key:'turnRatio',type:'number' },
            { label:'初始使能 (1=开)',     key:'initEnabled', type:'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label)      this.label      = cfg.label;
        if (cfg.Vac)        { this.Vac = parseFloat(cfg.Vac); this.Vbulk = Math.round(this.Vac * Math.SQRT2); }
        if (cfg.Freq)       this.Freq       = parseFloat(cfg.Freq)    || this.Freq;
        if (cfg.Vout)       this.setVout(parseFloat(cfg.Vout)         || this.Vout);
        if (cfg.Iout)       this.Iout       = parseFloat(cfg.Iout)    || this.Iout;
        if (cfg.swFreq)     this.swFreq     = parseFloat(cfg.swFreq)  || this.swFreq;
        if (cfg.duty)       this.setDuty(parseFloat(cfg.duty));
        if (cfg.turnRatio)  this.turnRatio  = parseFloat(cfg.turnRatio)||this.turnRatio;
        if (cfg.initEnabled !== undefined) {
            const want = !!parseInt(cfg.initEnabled);
            if (want !== this._enabled) this.toggle();
        }
        this.config = { ...this.config, ...cfg };
        this._refreshCache();
    }

    destroy() {
        super.destroy?.();
    }
}