import { BaseComponent } from './BaseComponent.js';

/**
 * 线性稳压电源（Linear Voltage Regulator / LDO）仿真组件
 *
 * ── 工作原理 ──────────────────────────────────────────────────
 *
 *  线性稳压电源通过负反馈环路维持输出电压稳定，核心由四个部分组成：
 *
 *  1. 参考电压源（Vref）
 *     产生精确、稳定的基准电压（通常由带隙基准或齐纳稳压管实现）。
 *     本组件默认 Vref = 1.25 V（类 LM317 结构）。
 *
 *  2. 误差放大器（Error Amplifier / EA）
 *     差分放大器，正输入接 Vref，负输入接反馈电压 Vfb。
 *     当 Vout 升高 → Vfb > Vref → EA 输出降低 → 调整管导通减弱 → Vout 回落。
 *     当 Vout 降低 → Vfb < Vref → EA 输出升高 → 调整管导通增强 → Vout 回升。
 *
 *  3. 调整管（Pass Element）
 *     串联在输入与输出之间的功率晶体管（NPN BJT 或 PMOS）。
 *     受 EA 输出控制，相当于一个受控可变电阻，消耗 (Vin−Vout)×Iout 的功率（热损耗）。
 *
 *  4. 反馈网络（Feedback Network）
 *     由 R1、R2 分压，将 Vout 按比例采样送回 EA 的反相输入端：
 *       Vfb = Vout × R2 / (R1 + R2)
 *       Vout = Vref × (1 + R1/R2)
 *
 * ── 稳压过程（负反馈环路）────────────────────────────────────
 *
 *  Vin ──► [调整管 Q] ──► Vout ──► [负载 RL]
 *              ▲                  │
 *              │   [误差放大器 EA]◄──[R1]─┤
 *              └──────────────────     [R2]─┘
 *                           ▲              │
 *                        [Vref]          GND
 *
 * ── 组件内部可视化布局 ───────────────────────────────────────
 *
 *  ┌─────────────────────────────────────────┐
 *  │  [Vin]──[调整管 NPN]──────────[Vout]   │
 *  │              │                    │      │
 *  │         [EA误差放大器]◄──[R1]─────┤     │
 *  │              ▲              [R2]  │      │
 *  │           [Vref]             │   GND     │
 *  │                             GND          │
 *  └─────────────────────────────────────────┘
 *
 * ── 仿真参数 ─────────────────────────────────────────────────
 *
 *  Vin    = 输入电压（默认 12 V）
 *  Vout   = 输出电压（默认 5 V，由 R1/R2 决定）
 *  Vref   = 基准电压（默认 1.25 V）
 *  R1     = 上分压电阻（默认 3 kΩ，影响 Vout）
 *  R2     = 下分压电阻（默认 1 kΩ）
 *  Iout   = 输出电流（默认 0.5 A）
 *  Pdiss  = 调整管耗散功率 = (Vin - Vout) × Iout
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  terminal_vin  — 输入端（左侧）
 *  terminal_vout — 输出端（右侧）
 *  terminal_gnd  — 公共地（底部）
 */
export class LinearRegulator extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(320, config.width  || 380);
        this.height = Math.max(240, config.height || 300);

        this.type    = 'linear_regulator';
        this.special = 'none';
        this.cache   = 'fixed';

        // ── 电气参数 ──
        this.label   = config.label   || 'VR1';
        this.Vin     = config.Vin     || 12;       // V
        this.Vref    = config.Vref    || 1.25;     // V（带隙基准）
        this.R1      = config.R1      || 3000;     // Ω
        this.R2      = config.R2      || 1000;     // Ω
        this.Iout    = config.Iout    || 0.5;      // A
        this.Iref    = config.Iref    || 0.0001;   // A（EA 静态电流，约100μA）

        // 计算输出电压：Vout = Vref × (1 + R1/R2)
        this.Vout    = this.Vref * (1 + this.R1 / this.R2);

        // ── 状态 ──
        this._enabled      = config.initEnabled !== false; // 默认开启
        this._animating    = false;
        this._pulsePhase   = 0;   // 电流流动动画相位
        this._heatLevel    = 0;   // 热量积累 0~1（调整管散热动画）

        // ── 噪声扰动仿真（输出波动）──
        this._noiseAmp     = 0.0;  // 仿真噪声幅度（相对值，0~1）
        this._currentNoise = 0.0;

        // ── 布局常量 ──
        const W = this.width, H = this.height;
        const PAD = 24;

        // 芯片外框
        this._chipBox = { x: PAD, y: PAD, w: W - PAD*2, h: H - PAD*2 };

        // 各功能块的中心坐标
        const cx = W / 2;
        const topY   = PAD + 50;
        const midY   = H  / 2;
        const botY   = H  - PAD - 55;

        // 调整管（NPN BJT）—— 顶部中偏左
        this._pass = {
            cx: cx - W*0.05,
            cy: topY + 15,
            rx: W * 0.075,
            ry: H * 0.075,
        };

        // 误差放大器 —— 中部
        this._ea = {
            cx: cx - W*0.20,
            cy: midY,
            w:  W * 0.18,
            h:  H * 0.18,
        };

        // 参考电压源（Vref）—— 左下
        this._vrefBlock = {
            cx: cx - W*0.35,
            cy: midY + H*0.14,
            r:  Math.min(W, H) * 0.068,
        };

        // 反馈电阻 R1（上）
        this._r1 = {
            cx: cx + W*0.20,
            cy: midY - H*0.10,
            w:  W * 0.065,
            h:  H * 0.115,
        };

        // 反馈电阻 R2（下）
        this._r2 = {
            cx: cx + W*0.20,
            cy: midY + H*0.10,
            w:  W * 0.065,
            h:  H * 0.115,
        };

        // Vin 节点（左边框）
        this._vinNode  = { x: PAD,     y: topY + 15 };
        // Vout 节点（右边框）
        this._voutNode = { x: W - PAD, y: topY + 15 };
        // GND 节点（底部中间）
        this._gndNode  = { x: cx,      y: H - PAD - 8 };

        this._init();

        // ── 端口 ──
        this.addPort(PAD - 4,     topY + 15,  'terminal_vin',  'wire', 'Vin');
        this.addPort(W - PAD + 4, topY + 15,  'terminal_vout', 'wire', 'Vout');
        this.addPort(cx,          H - PAD + 4,'terminal_gnd',  'wire', 'GND');
    }

    // ═══════════════════════════════════════════════════════
    _init() {
        this._drawChipPackage();
        this._drawTitle();
        this._drawStaticWiring();
        this._drawPassElement();
        this._drawErrorAmplifier();
        this._drawVrefSource();
        this._drawFeedbackResistors();
        this._drawPortLabels();
        this._drawStatusPanel();
        this._createAnimLayers();
        
    }

    // ── 芯片外壳 ─────────────────────────────────────────
    _drawChipPackage() {
        const b = this._chipBox;
        // 外壳主体
        this.group.add(new Konva.Rect({
            x: b.x, y: b.y, width: b.w, height: b.h,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: b.w, y: b.h },
            fillLinearGradientColorStops: [0,'#1a1f2e', 0.5,'#1e2538', 1,'#1a1f2e'],
            stroke: '#2e4060', strokeWidth: 1.5,
            cornerRadius: 10,
            shadowColor: '#0a0f1e', shadowBlur: 12,
            shadowOffsetY: 4, shadowOpacity: 0.6,
        }));
        // 顶部高光
        this.group.add(new Konva.Rect({
            x: b.x+2, y: b.y+2, width: b.w-4, height: b.h*0.12,
            fill: 'rgba(100,160,255,0.06)',
            cornerRadius: [10,10,0,0],
        }));
        // 内部背景格栅（PCB感）
        for (let gx = b.x+12; gx < b.x+b.w-12; gx += 20) {
            this.group.add(new Konva.Line({
                points: [gx, b.y+8, gx, b.y+b.h-8],
                stroke: 'rgba(60,90,140,0.12)', strokeWidth: 0.5,
            }));
        }
        for (let gy = b.y+12; gy < b.y+b.h-12; gy += 20) {
            this.group.add(new Konva.Line({
                points: [b.x+8, gy, b.x+b.w-8, gy],
                stroke: 'rgba(60,90,140,0.12)', strokeWidth: 0.5,
            }));
        }
    }

    // ── 顶部标题 ────────────────────────────────────────
    _drawTitle() {
        const W = this.width;
        this.group.add(new Konva.Text({
            x: 0, y: 6, width: W,
            text: `${this.label}  线性稳压器  LDO`,
            fontSize: 10, fontStyle: 'bold',
            fill: '#5a8fc0', align: 'center', fontFamily: 'monospace',
        }));
        // 下划线
        this.group.add(new Konva.Line({
            points: [this._chipBox.x+20, 20, this._chipBox.x+this._chipBox.w-20, 20],
            stroke: '#2e4060', strokeWidth: 0.8,
        }));
    }

    // ── 静态走线（芯片内部连线）───────────────────────────
    _drawStaticWiring() {
        const lineStyle = { stroke:'#2e5080', strokeWidth:1.5, lineCap:'round', lineJoin:'round' };
        const W = this.width, H = this.height, PAD = 24;
        const cx = W/2;

        const pass   = this._pass;
        const ea     = this._ea;
        const vref   = this._vrefBlock;
        const r1     = this._r1;
        const r2     = this._r2;
        const vinN   = this._vinNode;
        const voutN  = this._voutNode;
        const gndN   = this._gndNode;

        const wires = [
            // Vin → 调整管集电极（左→上）
            [vinN.x, vinN.y,  pass.cx - pass.rx, vinN.y],

            // 调整管发射极 → Vout（右走线）
            [pass.cx + pass.rx, pass.cy,  voutN.x, pass.cy],

            // Vout节点 → R1顶端（向下）
            [voutN.x - 8, pass.cy,  r1.cx, pass.cy,  r1.cx, r1.cy - r1.h/2],

            // R1底 → R2顶（直连）
            [r1.cx, r1.cy + r1.h/2,  r1.cx, r2.cy - r2.h/2],

            // R2底 → GND
            [r2.cx, r2.cy + r2.h/2,  r2.cx, gndN.y,  gndN.x, gndN.y],

            // R1/R2 节点（Vfb）→ EA 负输入
            [r1.cx, r1.cy + r1.h/2 + (r2.cy - r2.h/2 - r1.cy - r1.h/2)/2,
             ea.cx + ea.w/2, r1.cy + r1.h/2 + (r2.cy - r2.h/2 - r1.cy - r1.h/2)/2,
             ea.cx + ea.w/2, ea.cy + ea.h*0.22],

            // Vref → EA 正输入
            [vref.cx + vref.r, vref.cy,  ea.cx - ea.w/2, ea.cy - ea.h*0.22],

            // Vref → GND（参考地）
            [vref.cx, vref.cy + vref.r,  vref.cx, gndN.y],

            // EA 输出 → 调整管基极
            [ea.cx, ea.cy - ea.h/2,
             ea.cx, pass.cy + pass.ry*0.6,
             pass.cx - pass.rx*0.5, pass.cy + pass.ry*0.6],

            // GND 主线
            [gndN.x, gndN.y, gndN.x, H - PAD - 8],
        ];

        wires.forEach(pts => {
            this.group.add(new Konva.Line({ points: pts, ...lineStyle }));
        });

        // GND 符号（三横线）
        const gx = gndN.x, gy = H - PAD - 2;
        [16, 11, 6].forEach((hw, i) => {
            this.group.add(new Konva.Line({
                points: [gx-hw, gy+i*4, gx+hw, gy+i*4],
                stroke: '#3a6090', strokeWidth: 1.2, lineCap: 'round',
            }));
        });

        // 节点圆点（重要连接点）
        const nodes = [
            [voutN.x - 8,  pass.cy],   // Vout 分叉点
            [r1.cx, r1.cy + r1.h/2 + (r2.cy - r2.h/2 - r1.cy - r1.h/2)/2],  // Vfb 节点
        ];
        nodes.forEach(([nx, ny]) => {
            this.group.add(new Konva.Circle({
                x: nx, y: ny, radius: 3.5,
                fill: '#4a8fc0', stroke: '#2a6090', strokeWidth: 0.8,
            }));
        });
    }

    // ── 调整管（NPN BJT）────────────────────────────────
    _drawPassElement() {
        const p  = this._pass;
        const cx = p.cx, cy = p.cy;
        const rx = p.rx, ry = p.ry;

        // 散热块背景（TO-220封装感）
        this.group.add(new Konva.Rect({
            x: cx - rx*1.4, y: cy - ry*1.3,
            width: rx*2.8, height: ry*2.6,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: rx*2.8, y: 0 },
            fillLinearGradientColorStops: [0,'#2a3550',0.4,'#3a4a70',0.6,'#3a4a70',1,'#2a3550'],
            stroke: '#4a6090', strokeWidth: 1,
            cornerRadius: 4,
        }));

        // 圆形芯片
        this._passBody = new Konva.Ellipse({
            x: cx, y: cy, radiusX: rx, radiusY: ry,
            fillRadialGradientStartPoint: { x: -rx*0.2, y: -ry*0.2 },
            fillRadialGradientStartRadius: 0,
            fillRadialGradientEndPoint: { x: 0, y: 0 },
            fillRadialGradientEndRadius: rx*1.2,
            fillRadialGradientColorStops: [0,'#5a8fc0',0.5,'#2a5080',1,'#1a3060'],
            stroke: '#4a80b0', strokeWidth: 1.5,
        });
        this.group.add(this._passBody);

        // BJT 内部符号（NPN）
        const bx = cx - rx*0.15, by = cy;
        // 基极线
        this.group.add(new Konva.Line({
            points:[bx-rx*0.5, by-ry*0.45, bx-rx*0.5, by+ry*0.45],
            stroke:'#90c0e8', strokeWidth:2, lineCap:'round',
        }));
        // 集电极斜线（到C）
        this.group.add(new Konva.Line({
            points:[bx-rx*0.5, by-ry*0.22, bx+rx*0.55, by-ry*0.55],
            stroke:'#90c0e8', strokeWidth:1.8, lineCap:'round',
        }));
        // 发射极斜线（到E）+ 箭头
        this.group.add(new Konva.Line({
            points:[bx-rx*0.5, by+ry*0.22, bx+rx*0.55, by+ry*0.55],
            stroke:'#90c0e8', strokeWidth:1.8, lineCap:'round',
        }));
        // 发射极箭头（NPN 向外）
        const ex = bx+rx*0.55, ey = by+ry*0.55;
        this.group.add(new Konva.Line({
            points:[ex,ey, ex-rx*0.15,ey-rx*0.06, ex-rx*0.06,ey-rx*0.18],
            stroke:'#90c0e8', strokeWidth:1.5, closed:true,
            fill:'#90c0e8', lineJoin:'round',
        }));

        // 标注
        this.group.add(new Konva.Text({
            x: cx-rx, y: cy+ry*1.45,
            width: rx*2, text: 'Q（调整管）',
            fontSize: 7.5, fill: '#6aabe0', align:'center', fontFamily:'monospace',
        }));
        // 引脚标注 C/B/E
        this.group.add(new Konva.Text({ x: cx-rx*1.5, y: cy-ry*1.1, text:'C', fontSize:8, fill:'#aed0f0', fontStyle:'bold' }));
        this.group.add(new Konva.Text({ x: cx-rx*1.5, y: cy+ry*0.8, text:'E', fontSize:8, fill:'#aed0f0', fontStyle:'bold' }));
        this.group.add(new Konva.Text({ x: cx-rx*0.6,  y: cy+ry*1.05,text:'B', fontSize:8, fill:'#aed0f0', fontStyle:'bold' }));

        // 热量指示（动态，后续通过 _passHeatGlow 更新）
        this._passHeatGlow = new Konva.Ellipse({
            x: cx, y: cy, radiusX: rx*1.1, radiusY: ry*1.1,
            fill: 'rgba(255,80,20,0)',
            listening: false,
        });
        this.group.add(this._passHeatGlow);
    }

    // ── 误差放大器（三角符号）───────────────────────────
    _drawErrorAmplifier() {
        const e  = this._ea;
        const cx = e.cx, cy = e.cy;
        const w  = e.w,  h  = e.h;

        // 背景块
        this.group.add(new Konva.Rect({
            x: cx-w/2-4, y: cy-h/2-4, width:w+8, height:h+8,
            fill:'#1e2d42', stroke:'#3a5878', strokeWidth:1,
            cornerRadius:5,
        }));

        // 运放三角形
        this.group.add(new Konva.Line({
            points:[
                cx-w/2, cy-h/2,
                cx+w/2, cy,
                cx-w/2, cy+h/2,
                cx-w/2, cy-h/2,
            ],
            closed: true,
            fillLinearGradientStartPoint:{ x:-w/2, y:0 },
            fillLinearGradientEndPoint:  { x: w/2, y:0 },
            fillLinearGradientColorStops:[0,'#1e3a5a',0.7,'#2a5080',1,'#1e3a5a'],
            stroke:'#4a90c0', strokeWidth:1.5,
        }));

        // "+" 正输入标注（连接Vref）
        this.group.add(new Konva.Text({
            x: cx-w/2+3, y: cy-h*0.38, text:'+',
            fontSize:11, fill:'#60d080', fontStyle:'bold',
        }));
        // "−" 负输入标注（连接Vfb）
        this.group.add(new Konva.Text({
            x: cx-w/2+3, y: cy+h*0.14, text:'−',
            fontSize:11, fill:'#f06060', fontStyle:'bold',
        }));

        // 标注文字
        this.group.add(new Konva.Text({
            x: cx-w/2, y: cy+h/2+6, width:w,
            text:'EA', fontSize:8, fill:'#5ab0e0', align:'center', fontFamily:'monospace',
        }));
        this.group.add(new Konva.Text({
            x: cx-w/2-4, y: cy+h/2+16, width:w+8,
            text:'误差放大器', fontSize:7, fill:'#3a6a90', align:'center',
        }));
    }

    // ── 参考电压源（Vref / 带隙基准）────────────────────
    _drawVrefSource() {
        const v  = this._vrefBlock;
        const cx = v.cx, cy = v.cy;
        const r  = v.r;

        // 圆形基准符号
        this.group.add(new Konva.Circle({
            x: cx, y: cy, radius: r,
            fillRadialGradientStartPoint:{ x:0, y:0 },
            fillRadialGradientStartRadius:0,
            fillRadialGradientEndPoint:  { x:0, y:0 },
            fillRadialGradientEndRadius: r,
            fillRadialGradientColorStops:[0,'#2a4a20',0.6,'#1e3818',1,'#142810'],
            stroke:'#4a8040', strokeWidth:1.5,
        }));

        // 内部稳压管符号（Z字）
        const zx = cx, zy = cy;
        this.group.add(new Konva.Line({
            points:[
                zx, zy-r*0.55,
                zx, zy+r*0.55,
            ],
            stroke:'#80d060', strokeWidth:2, lineCap:'round',
        }));
        this.group.add(new Konva.Line({
            points:[
                zx-r*0.35, zy-r*0.55,
                zx+r*0.35, zy-r*0.55,
                zx-r*0.35, zy+r*0.55,
                zx+r*0.35, zy+r*0.55,
            ],
            stroke:'#80d060', strokeWidth:1.5, lineCap:'round', lineJoin:'round',
        }));

        // 电压标注
        this.group.add(new Konva.Text({
            x: cx-r, y: cy+r+4, width:r*2,
            text:`Vref`, fontSize:8, fill:'#70c050', align:'center', fontStyle:'bold', fontFamily:'monospace',
        }));
        this.group.add(new Konva.Text({
            x: cx-r-4, y: cy+r+14, width:r*2+8,
            text:`${this.Vref.toFixed(2)}V`, fontSize:9, fill:'#a0e080', align:'center', fontFamily:'monospace',
        }));
        this.group.add(new Konva.Text({
            x: cx-r, y: cy+r+24, width:r*2,
            text:'带隙基准', fontSize:7, fill:'#4a7a30', align:'center',
        }));
    }

    // ── 反馈电阻 R1/R2 ────────────────────────────────
    _drawFeedbackResistors() {
        this._drawResistor(this._r1, 'R1', `${(this.R1/1000).toFixed(1)}kΩ`);
        this._drawResistor(this._r2, 'R2', `${(this.R2/1000).toFixed(1)}kΩ`);

        // Vfb 节点标注（R1/R2中间）
        const midY = this._r1.cy + this._r1.h/2 +
                    (this._r2.cy - this._r2.h/2 - this._r1.cy - this._r1.h/2)/2;
        this.group.add(new Konva.Text({
            x: this._r1.cx + this._r1.w/2 + 3,
            y: midY - 6,
            text: 'Vfb', fontSize: 8, fill: '#f0a060', fontStyle:'bold', fontFamily:'monospace',
        }));
    }

    _drawResistor(r, name, value) {
        const cx = r.cx, cy = r.cy;
        const w  = r.w,  h  = r.h;

        // 电阻体（锯齿形 IEC 风格——矩形）
        this.group.add(new Konva.Rect({
            x: cx-w/2, y: cy-h/2, width:w, height:h,
            fillLinearGradientStartPoint:{ x:-w/2, y:0 },
            fillLinearGradientEndPoint:  { x: w/2, y:0 },
            fillLinearGradientColorStops:[0,'#3a2a10',0.5,'#6a4a20',1,'#3a2a10'],
            stroke:'#b07030', strokeWidth:1.2,
            cornerRadius:3,
        }));
        // 锯齿纹路（内部纹理线）
        const stripeCount = 5;
        for (let i = 1; i < stripeCount; i++) {
            this.group.add(new Konva.Line({
                points:[cx-w/2, cy-h/2 + h*i/stripeCount, cx+w/2, cy-h/2 + h*i/stripeCount],
                stroke:'rgba(200,140,50,0.25)', strokeWidth:0.8,
            }));
        }

        // 标注
        this.group.add(new Konva.Text({
            x: cx-w/2-2, y: cy-h/2-14,
            text: name, fontSize:8, fill:'#c09050', fontStyle:'bold', fontFamily:'monospace',
        }));
        this.group.add(new Konva.Text({
            x: cx+w/2+3, y: cy-5,
            text: value, fontSize:7.5, fill:'#908060', fontFamily:'monospace',
        }));
    }

    // ── 端口标签 ─────────────────────────────────────────
    _drawPortLabels() {
        const W = this.width, H = this.height, PAD = 24;
        const cx = W/2;
        const voutV = this.Vout.toFixed(2);
        const vinV  = this.Vin.toFixed(1);

        // Vin 标签
        this.group.add(new Konva.Text({
            x: 0, y: this._vinNode.y - 18, width: PAD + 40,
            text: `Vin\n${vinV}V`, fontSize:9, fill:'#80aacc',
            align:'center', fontFamily:'monospace', lineHeight:1.4,
        }));

        // Vout 标签
        this.group.add(new Konva.Text({
            x: W - PAD - 40, y: this._voutNode.y - 18, width: PAD + 40,
            text: `Vout\n${voutV}V`, fontSize:9, fill:'#80e0a0',
            align:'center', fontFamily:'monospace', lineHeight:1.4,
        }));

        // GND 已由GND符号表示
        this.group.add(new Konva.Text({
            x: cx - 15, y: H - PAD - 2,
            text: 'GND', fontSize:8, fill:'#4a7090',
            fontFamily:'monospace',
        }));

        // 公式标注
        const formulaX = this._chipBox.x + 8;
        const formulaY = this._chipBox.y + this._chipBox.h - 30;
        this.group.add(new Konva.Text({
            x: formulaX, y: formulaY, width: this._chipBox.w - 16,
            text: `Vout = Vref×(1+R1/R2) = ${this.Vref}×(1+${(this.R1/1000).toFixed(1)}k/${(this.R2/1000).toFixed(1)}k) = ${voutV}V`,
            fontSize: 7.5, fill:'#3a5a7a', fontFamily:'monospace',
        }));
    }

    // ── 状态面板 ─────────────────────────────────────────
    _drawStatusPanel() {
        const W = this.width;
        const panelX = this._chipBox.x + this._chipBox.w - 95;
        const panelY = this._chipBox.y + this._chipBox.h - 90;
        const panelW = 88, panelH = 62;

        // 面板背景
        this.group.add(new Konva.Rect({
            x: panelX, y: panelY, width: panelW, height: panelH,
            fill: '#0d1520', stroke: '#2a4060', strokeWidth: 1,
            cornerRadius: 4,
        }));

        // 标题
        this.group.add(new Konva.Text({
            x: panelX+2, y: panelY+3, width: panelW-4,
            text:'─ 参数监控 ─', fontSize:7, fill:'#2a5080', align:'center', fontFamily:'monospace',
        }));

        const Pdiss  = (this.Vin - this.Vout) * this.Iout;
        const eta    = (this.Vout * this.Iout / (this.Vin * this.Iout) * 100).toFixed(1);

        const lines = [
            { label:'Pdiss', val:`${Pdiss.toFixed(2)} W`, color:'#ff8060' },
            { label:'Iout',  val:`${this.Iout.toFixed(3)} A`,color:'#80d0a0' },
            { label:'η',     val:`${eta}%`,                 color:'#f0c060' },
        ];

        this._statusLines = {};
        lines.forEach(({ label, val, color }, i) => {
            const ly = panelY + 16 + i*15;
            this.group.add(new Konva.Text({
                x: panelX+5, y: ly, text:`${label}:`,
                fontSize:8, fill:'#4a7090', fontFamily:'monospace',
            }));
            const t = new Konva.Text({
                x: panelX+36, y: ly, text: val,
                fontSize:8, fill: color, fontFamily:'monospace', fontStyle:'bold',
            });
            this._statusLines[label] = t;
            this.group.add(t);
        });

        // 状态指示灯
        this._statusDot = new Konva.Circle({
            x: panelX+8, y: panelY+panelH-8, radius:4,
            fill: this._enabled ? '#44dd66' : '#dd4444',
            stroke: this._enabled ? '#22882a' : '#882222',
            strokeWidth:0.8,
            shadowColor: this._enabled ? '#44dd66' : '#dd4444',
            shadowBlur: 6, shadowOpacity:0.8,
        });
        this._statusText = new Konva.Text({
            x: panelX+16, y: panelY+panelH-13,
            text: this._enabled ? 'REGULATING' : 'OFF',
            fontSize:7.5, fill: this._enabled ? '#44dd66' : '#dd4444',
            fontFamily:'monospace', fontStyle:'bold',
        });
        this.group.add(this._statusDot, this._statusText);
    }

    // ── 动画层（电流粒子 + 热量）──────────────────────
    _createAnimLayers() {
        this._animGroup = new Konva.Group({ listening: false });
        this.group.add(this._animGroup);

        // 电流粒子池（预建，重复利用）
        this._particles = [];
        const count = 18;
        for (let i = 0; i < count; i++) {
            const dot = new Konva.Circle({
                x: 0, y: 0, radius: 2.5,
                fill: '#40b0ff', opacity: 0,
                shadowColor: '#40b0ff', shadowBlur: 5, shadowOpacity: 0.8,
            });
            this._animGroup.add(dot);
            this._particles.push({ dot, t: i/count, path: 0 });
        }

        // 反馈信号粒子（橙色）
        this._fbParticles = [];
        const fbCount = 8;
        for (let i = 0; i < fbCount; i++) {
            const dot = new Konva.Circle({
                x: 0, y: 0, radius: 2,
                fill: '#ffa040', opacity: 0,
                shadowColor: '#ffa040', shadowBlur: 4, shadowOpacity: 0.7,
            });
            this._animGroup.add(dot);
            this._fbParticles.push({ dot, t: i/fbCount });
        }
    }

    // ── 主路径：各段路径点 ──────────────────────────────
    _getMainPath() {
        // Vin → 调整管C → 调整管E → Vout 主路径
        const pass   = this._pass;
        const vinN   = this._vinNode;
        const voutN  = this._voutNode;
        return [
            { x: vinN.x + 4,            y: vinN.y },
            { x: pass.cx - pass.rx,     y: vinN.y },
            { x: pass.cx + pass.rx,     y: pass.cy },
            { x: voutN.x - 4,           y: pass.cy },
        ];
    }

    _getFeedbackPath() {
        // Vout节点 → R1 → R2 → GND
        const pass   = this._pass;
        const r1     = this._r1;
        const r2     = this._r2;
        const voutN  = this._voutNode;
        const gndN   = this._gndNode;
        const fbMidY = r1.cy + r1.h/2 + (r2.cy - r2.h/2 - r1.cy - r1.h/2)/2;
        const W      = this.width, PAD = 24;
        return [
            { x: voutN.x - 8,  y: pass.cy },
            { x: r1.cx,        y: pass.cy },
            { x: r1.cx,        y: r1.cy - r1.h/2 },
            { x: r1.cx,        y: r1.cy + r1.h/2 },
            { x: r1.cx,        y: fbMidY },
            { x: r1.cx,        y: r2.cy - r2.h/2 },
            { x: r1.cx,        y: r2.cy + r2.h/2 },
            { x: r1.cx,        y: gndN.y },
            { x: gndN.x,       y: gndN.y },
        ];
    }

    // ── 路径插值 ────────────────────────────────────────
    _interpPath(path, t) {
        const totalLen = path.reduce((acc, p, i) => {
            if (i === 0) return acc;
            const dx = p.x - path[i-1].x, dy = p.y - path[i-1].y;
            return acc + Math.sqrt(dx*dx + dy*dy);
        }, 0);

        let target = t * totalLen;
        for (let i = 1; i < path.length; i++) {
            const dx = path[i].x - path[i-1].x, dy = path[i].y - path[i-1].y;
            const segLen = Math.sqrt(dx*dx + dy*dy);
            if (target <= segLen) {
                return { x: path[i-1].x + dx*(target/segLen), y: path[i-1].y + dy*(target/segLen) };
            }
            target -= segLen;
        }
        return path[path.length-1];
    }

    // ── 帧动画更新 ──────────────────────────────────────
    _tickAnimation(dt) {
        if (!this._enabled) {
            this._particles.forEach(p => p.dot.opacity(0));
            this._fbParticles.forEach(p => p.dot.opacity(0));
            this._passHeatGlow.fill('rgba(255,80,20,0)');
            return;
        }

        this._pulsePhase += dt * 0.65; // 流动速度

        const mainPath = this._getMainPath();
        const fbPath   = this._getFeedbackPath();

        // 主路电流粒子（蓝色，Vin→Vout）
        this._particles.forEach(p => {
            p.t = ((p.t + dt * 0.55) % 1);
            const noisy = p.t;
            const pos = this._interpPath(mainPath, noisy);
            p.dot.x(pos.x);
            p.dot.y(pos.y);
            // 淡入淡出两端
            const alpha = noisy < 0.08 ? noisy/0.08 : noisy > 0.92 ? (1-noisy)/0.08 : 1;
            p.dot.opacity(alpha * 0.85);
        });

        // 反馈路径粒子（橙色，Vout→Vfb→GND）
        this._fbParticles.forEach(p => {
            p.t = ((p.t + dt * 0.38) % 1);
            const pos = this._interpPath(fbPath, p.t);
            p.dot.x(pos.x);
            p.dot.y(pos.y);
            const alpha = p.t < 0.06 ? p.t/0.06 : p.t > 0.94 ? (1-p.t)/0.06 : 1;
            p.dot.opacity(alpha * 0.75);
        });

        // 调整管热量效果
        const Pdiss = (this.Vin - this.Vout) * this.Iout;
        const maxPdiss = 15; // W
        const heatFrac = Math.min(Pdiss / maxPdiss, 1);
        const pulse    = 0.5 + 0.5 * Math.sin(this._pulsePhase * 2.5);
        const heatAlpha = heatFrac * (0.12 + 0.10 * pulse);
        const r = Math.round(255);
        const g = Math.round(80 * (1 - heatFrac));
        this._passHeatGlow.fill(`rgba(${r},${g},20,${heatAlpha.toFixed(3)})`);

        this._animGroup.getLayer()?.batchDraw();
    }

    // ── 动画循环 ─────────────────────────────────────────
    // 集中化 tick（由 consys._tickAll 在 20fps 调用）
    tick(dt) {
        this._tickAnimation(dt);
    }
    // ── 交互（点击调整管切换使能）───────────────────────
    _bindInteraction() {
        this._passBody.on('click tap', () => this.toggle());
        this._passBody.listening(true);
    }

    // ═══════════════════════════════════════════════════════
    // 公共 API
    // ═══════════════════════════════════════════════════════

    /** 切换启用/禁用 */
    toggle() {
        this._enabled = !this._enabled;
        this._updateStatusUI();
        this._refreshCache();
    }

    /** 设置输出电压（通过调整 R1）*/
    setVout(newVout) {
        if (newVout <= this.Vref || newVout >= this.Vin) return;
        this.Vout = newVout;
        // 反算 R1：R1 = R2×(Vout/Vref − 1)
        this.R1 = this.R2 * (newVout / this.Vref - 1);
        this._updateStatusUI();
        this._refreshCache();
    }

    /** 设置输入电压 */
    setVin(newVin) {
        if (newVin <= this.Vout) return;
        this.Vin = newVin;
        this._updateStatusUI();
        this._refreshCache();
    }

    /** 设置输出电流 */
    setIout(newIout) {
        this.Iout = Math.max(0, newIout);
        this._updateStatusUI();
        this._refreshCache();
    }

    _updateStatusUI() {
        if (!this._statusDot) return;
        const on = this._enabled;
        this._statusDot.fill(on ? '#44dd66' : '#dd4444');
        this._statusDot.stroke(on ? '#22882a' : '#882222');
        this._statusDot.shadowColor(on ? '#44dd66' : '#dd4444');
        this._statusDot.shadowBlur(on ? 6 : 2);
        this._statusText.text(on ? 'REGULATING' : 'OFF');
        this._statusText.fill(on ? '#44dd66' : '#dd4444');

        // 更新面板数值
        const Pdiss = (this.Vin - this.Vout) * this.Iout;
        const eta   = (this.Vout / this.Vin * 100).toFixed(1);
        if (this._statusLines) {
            this._statusLines['Pdiss']?.text(`${Pdiss.toFixed(2)} W`);
            this._statusLines['Iout']?.text(`${this.Iout.toFixed(3)} A`);
            this._statusLines['η']?.text(`${eta}%`);
        }
    }

    isEnabled() { return this._enabled; }

    getState() {
        return {
            enabled: this._enabled,
            Vin:  this.Vin,
            Vout: this.Vout,
            Iout: this.Iout,
            Pdiss: (this.Vin - this.Vout) * this.Iout,
            R1:   this.R1,
            R2:   this.R2,
            Vref: this.Vref,
            eta:  this.Vout / this.Vin,
        };
    }

    update(state) {
        if (typeof state === 'boolean') {
            if (state !== this._enabled) this.toggle();
        } else if (typeof state === 'object') {
            if (state.Vin   !== undefined) this.Vin   = state.Vin;
            if (state.Iout  !== undefined) this.Iout  = state.Iout;
            if (state.Vout  !== undefined) this.setVout(state.Vout);
        }
        this._updateStatusUI();
        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label:'位号/名称',         key:'label',   type:'text'   },
            { label:'输入电压 Vin (V)',   key:'Vin',     type:'number' },
            { label:'基准电压 Vref (V)', key:'Vref',    type:'number' },
            { label:'上分压 R1 (Ω)',      key:'R1',      type:'number' },
            { label:'下分压 R2 (Ω)',      key:'R2',      type:'number' },
            { label:'输出电流 Iout (A)', key:'Iout',    type:'number' },
            { label:'初始使能 (1=开)',   key:'initEnabled', type:'number' },
        ];
    }

    onConfigUpdate(cfg) {
        this.label = cfg.label  || this.label;
        if (cfg.Vin  !== undefined) this.Vin  = parseFloat(cfg.Vin)  || this.Vin;
        if (cfg.Vref !== undefined) this.Vref = parseFloat(cfg.Vref) || this.Vref;
        if (cfg.R1   !== undefined) this.R1   = parseFloat(cfg.R1)   || this.R1;
        if (cfg.R2   !== undefined) this.R2   = parseFloat(cfg.R2)   || this.R2;
        if (cfg.Iout !== undefined) this.Iout = parseFloat(cfg.Iout) || this.Iout;
        this.Vout = this.Vref * (1 + this.R1 / this.R2);
        if (cfg.initEnabled !== undefined) {
            const want = !!parseInt(cfg.initEnabled);
            if (want !== this._enabled) this.toggle();
        }
        this.config = { ...this.config, ...cfg };
        this._updateStatusUI();
        this._refreshCache();
    }

    destroy() {
        super.destroy?.();
    }
}