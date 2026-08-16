import { BaseComponent } from './BaseComponent.js';

/**
 * 锁相环（PLL — Phase-Locked Loop）仿真组件
 *
 * ── 拓扑结构 ─────────────────────────────────────────────────────────
 *
 *                   ┌─────────────────────────────────────┐
 *                   │           PLL 反馈环路               │
 *  Fref ──►[PFD]──►[CP]──►[LF]──►[VCO]──► Fout
 *           ▲                              │
 *           │         ÷N 分频器            │
 *           └──────────[÷N]◄──────────────┘
 *
 * ── 四大核心模块详解 ──────────────────────────────────────────────────
 *
 *  ① PFD — 鉴相/鉴频器（Phase/Frequency Detector）
 *    ┌─────────────────────────────────────────────────────────────────
 *    │  输入：参考时钟 Fref（来自晶振）和反馈时钟 Fdiv（VCO输出经÷N）
 *    │
 *    │  内部结构：两个 D 触发器 + 与门（复位逻辑）
 *    │    - D触发器A：Fref 的上升沿置位 → QA = 1（UP 脉冲）
 *    │    - D触发器B：Fdiv 的上升沿置位 → QB = 1（DN 脉冲）
 *    │    - 与门：QA & QB → 异步复位两个触发器（短暂延迟后清零）
 *    │
 *    │  输出逻辑：
 *    │    • UP 脉冲（QA=1, QB=0）：Fref 超前于 Fdiv → VCO 需要加速
 *    │    • DN 脉冲（QA=0, QB=1）：Fref 滞后于 Fdiv → VCO 需要减速
 *    │    • 锁定状态（QA=QB≈0）：两路同相同频 → 无净电荷泵出
 *    │
 *    │  死区（Dead Zone）：两路同时为高时的微小窗口，实际电路
 *    │  通过加入延迟单元消除死区，避免锁定时相位噪声恶化
 *    └─────────────────────────────────────────────────────────────────
 *
 *  ② CP — 电荷泵（Charge Pump）
 *    ┌─────────────────────────────────────────────────────────────────
 *    │  受 PFD 的 UP/DN 信号控制的两个电流源：
 *    │    • UP=1 时：上方 PMOS 电流源导通，向 LF 注入电荷 +Icp
 *    │    • DN=1 时：下方 NMOS 电流源导通，从 LF 抽取电荷 -Icp
 *    │    • 两者均关闭：LF 保持电压（高阻状态）
 *    │
 *    │  净输出：ΔQ ∝ (TUP − TDN) × Icp
 *    │  转换为控制电压 Vctrl 送给 VCO
 *    │
 *    │  关键参数：
 *    │    - 电荷泵电流 Icp（典型值 50μA ~ 5mA）
 *    │    - 电流失配（Mismatch）→ 参考杂散（Reference Spur）
 *    └─────────────────────────────────────────────────────────────────
 *
 *  ③ LF — 环路滤波器（Loop Filter）
 *    ┌─────────────────────────────────────────────────────────────────
 *    │  将 CP 输出的电流脉冲积分为平滑的控制电压 Vctrl
 *    │
 *    │  典型结构（二阶无源滤波器）：
 *    │    R1 + C1（串联，产生零点，改善相位裕度）
 *    │    C2（并联，抑制参考杂散，构成极点）
 *    │
 *    │  传递函数：Z(s) = (1 + s·R1·C1) / (s·(C1+C2)·(1 + s·R1·C1C2/(C1+C2)))
 *    │
 *    │  环路带宽 ωc ≈ Icp·Kvco·R1 / (2π·N)
 *    │    • 带宽宽 → 快速锁定，相位噪声差
 *    │    • 带宽窄 → 慢速锁定，相位噪声好
 *    │
 *    │  相位裕度（Phase Margin）典型设计为 50°~60°
 *    └─────────────────────────────────────────────────────────────────
 *
 *  ④ VCO — 压控振荡器（Voltage-Controlled Oscillator）
 *    ┌─────────────────────────────────────────────────────────────────
 *    │  将输入控制电压 Vctrl 线性转换为输出频率 Fout：
 *    │    Fout = Fvco_center + Kvco × (Vctrl − Vctrl_center)
 *    │
 *    │  关键参数：
 *    │    - Kvco：VCO 增益（Hz/V），典型值 50MHz/V ~ 2GHz/V
 *    │    - 调谐范围：Vctrl_min ~ Vctrl_max 对应的频率范围
 *    │    - 相位噪声：VCO 是 PLL 系统相噪的主要贡献者（带外）
 *    │
 *    │  实现形式：
 *    │    • LC VCO：变容二极管（Varactor）改变谐振频率，低相噪
 *    │    • Ring VCO：反相器环形振荡器，易于集成，相噪较差
 *    └─────────────────────────────────────────────────────────────────
 *
 *  ⑤ 分频器（÷N Divider）— 反馈路径
 *    ┌─────────────────────────────────────────────────────────────────
 *    │  将 VCO 输出 Fout 除以整数 N，得到 Fdiv = Fout/N
 *    │  锁定时：Fdiv = Fref → Fout = N × Fref
 *    │  通过改变 N 可以步进式改变输出频率，步进量 = Fref
 *    │  小数分频（Fractional-N）：使用 ΔΣ 调制实现非整数分频比
 *    └─────────────────────────────────────────────────────────────────
 *
 * ── 锁定过程动态演示 ───────────────────────────────────────────────
 *
 *  组件支持三种工作状态，通过点击交互切换：
 *
 *  [ACQUIRING]  捕获过程：Fvco ≠ N·Fref，PFD持续输出UP/DN脉冲，
 *               Vctrl 缓慢收敛，频率向目标靠近
 *
 *  [LOCKED]     锁定状态：Fvco = N·Fref，PFD仅输出极短对齐脉冲，
 *               Vctrl 稳定，相位连续跟踪
 *
 *  [UNLOCKED]   失锁状态：外部扰动 or N改变，重新进入捕获
 *
 * ── 布局 ────────────────────────────────────────────────────────────
 *
 *  ┌──────────────────────────────────────────────────────────────┐
 *  │  [Fref]          信号路径（上部横排）                         │
 *  │     └──►[① PFD]──►[② CP]──►[③ LF]──►[④ VCO]──► Fout      │
 *  │              ▲                                   │            │
 *  │              └──────────── [÷N] ◄────────────────┘            │
 *  │                                                               │
 *  │  ┌─────────────┬──────────────┬─────────────┬─────────────┐  │
 *  │  │ PFD波形区   │ CP电流区     │ LF Vctrl区  │ VCO输出区   │  │
 *  │  │（Fref/Fdiv）│（UP/DN/净值）│（控制电压）  │（输出频谱）  │  │
 *  │  └─────────────┴──────────────┴─────────────┴─────────────┘  │
 *  └──────────────────────────────────────────────────────────────┘
 *
 * ── 端口 ─────────────────────────────────────────────────────────
 *  terminal_fref  — 参考时钟输入（左侧）
 *  terminal_fout  — VCO 输出（右侧）
 *  terminal_vctrl — 控制电压监测点（LF 输出，底部）
 */
export class PhaseLockLoop extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(660, config.width  || 740);
        this.height = Math.max(360, config.height || 430);

        this.type    = 'pll';
        this.special = 'none';
        this.cache   = 'fixed';

        // ── 电气参数 ──
        this.label    = config.label    || 'PLL1';
        this.Fref     = config.Fref     || 10e6;      // Hz，参考频率 10MHz
        this.N        = config.N        || 100;        // 分频比 → Fout=1GHz
        this.Kvco     = config.Kvco     || 200e6;      // Hz/V，VCO 增益
        this.Icp      = config.Icp      || 500e-6;     // A，电荷泵电流
        this.R1       = config.R1       || 2000;       // Ω，LF 电阻
        this.C1       = config.C1       || 100e-12;    // F，LF 主电容
        this.C2       = config.C2       || 10e-12;     // F，LF 并联电容
        this.Vctrl_center = config.Vctrl_center || 1.2; // V，VCO 中心控制电压
        this.Fout_nom = this.Fref * this.N;             // 标称输出频率

        // ── 动态仿真状态 ──
        this._lockState   = 'ACQUIRING';  // 'ACQUIRING' | 'LOCKED' | 'UNLOCKED'
        this._lockProgress = 0;    // 0~1，锁定收敛进度
        this._lockTime     = 0;    // s，已用时间
        this._lockDuration = 2.5;  // s，模拟捕获时长

        // 信号相位（驱动波形动画）
        this._phaseRef  = 0;   // 参考时钟累积相位
        this._phaseVco  = 0;   // VCO 相位（捕获时偏离）
        this._phaseErr  = 0;   // 相位误差（rad）
        this._vctrl     = this.Vctrl_center;  // 当前控制电压
        this._vctrlTarget = this.Vctrl_center;

        // PFD 状态
        this._upPulse = 0;   // 0~1，UP 脉冲强度
        this._dnPulse = 0;   // 0~1，DN 脉冲强度
        this._upDecay = 0;
        this._dnDecay = 0;

        // 全局相位时钟
        this._phase    = 0;

        // Vctrl 历史记录（用于绘制收敛曲线）
        this._vctrlHistory = [];
        this._maxHistory   = 120;

        // ── 布局 ──
        const W = this.width, H = this.height;
        const PAD = 18;
        const innerW = W - PAD * 2;

        // 主信号线 Y
        this._topY  = H * 0.22;   // 顶部信号总线
        this._botY  = H * 0.48;   // 反馈总线
        this._waveY = H * 0.56;   // 波形显示区起始 Y
        this._waveH = H * 0.30;   // 波形显示区高度

        // 4个模块均分横向（Fref占左端，Fout占右端）
        const blockCount = 4;
        const blockW = innerW * 0.205;
        const blockH = this._topY * 1.4;
        const gaps   = (innerW - blockW * blockCount) / (blockCount + 1);

        this._blocks = [];
        for (let i = 0; i < blockCount; i++) {
            const bx = PAD + gaps + i * (blockW + gaps);
            this._blocks.push({
                x: bx,
                y: PAD,
                w: blockW,
                h: blockH,
                cx: bx + blockW / 2,
                cy: PAD + blockH / 2,
            });
        }

        this._init();

        // 端口
        this.addPort(PAD - 4,     this._topY,    'terminal_fref',  'wire', 'Fref');
        this.addPort(W - PAD + 4, this._topY,    'terminal_fout',  'wire', 'Fout');
        this.addPort(this._blocks[2].cx, H - PAD + 4, 'terminal_vctrl', 'wire', 'Vctrl');
    }

    // ═══════════════════════════════════════════════════════════════
    _init() {
        this._drawBackground();
        this._drawSignalBus();
        this._drawFeedbackPath();
        this._drawBlock_PFD();
        this._drawBlock_CP();
        this._drawBlock_LF();
        this._drawBlock_VCO();
        this._drawDivider();
        this._drawWaveBoxes();
        this._drawTopLabels();
        this._drawStatusPanel();
        this._createAnimLayers();
        
    }

    // ── 背景 ──────────────────────────────────────────────────────
    _drawBackground() {
        const W = this.width, H = this.height;
        this.group.add(new Konva.Rect({
            x:0, y:0, width:W, height:H,
            fillLinearGradientStartPoint:{x:0,y:0},
            fillLinearGradientEndPoint:{x:W,y:H},
            fillLinearGradientColorStops:[0,'#0a0f1a',0.5,'#0d1525',1,'#0a0f1a'],
            stroke:'#1a2d4a', strokeWidth:1.5, cornerRadius:10,
            shadowColor:'#000', shadowBlur:18, shadowOpacity:0.7,
        }));
        // 网格
        for (let gx=20;gx<W-10;gx+=22) this.group.add(new Konva.Line({
            points:[gx,8,gx,H-8], stroke:'rgba(30,60,100,0.08)', strokeWidth:0.5,
        }));
        for (let gy=20;gy<H-10;gy+=22) this.group.add(new Konva.Line({
            points:[8,gy,W-8,gy], stroke:'rgba(30,60,100,0.08)', strokeWidth:0.5,
        }));
        // 顶部标题栏
        const W2=this.width;
        this.group.add(new Konva.Rect({
            x:10, y:4, width:W2-20, height:12,
            fill:'rgba(20,50,90,0.3)', cornerRadius:4,
        }));
        this.group.add(new Konva.Text({
            x:0, y:5, width:W2,
            text:`${this.label}  ·  锁相环  Phase-Locked Loop  ·  Fref=${this._fmtHz(this.Fref)}  N=${this.N}  Fout=${this._fmtHz(this.Fout_nom)}`,
            fontSize:8, fill:'#3a6898', align:'center', fontFamily:'monospace',
        }));
    }

    _fmtHz(f) {
        if (f >= 1e9) return `${(f/1e9).toFixed(2)}GHz`;
        if (f >= 1e6) return `${(f/1e6).toFixed(1)}MHz`;
        if (f >= 1e3) return `${(f/1e3).toFixed(0)}kHz`;
        return `${f}Hz`;
    }

    // ── 主信号总线（顶部横向连接四模块）──────────────────────────
    _drawSignalBus() {
        const W = this.width, PAD = 18;
        const sy = this._topY;
        const blocks = this._blocks;

        // Fref → PFD 左端
        this.group.add(new Konva.Line({
            points:[PAD, sy, blocks[0].x, sy],
            stroke:'#40a0ff', strokeWidth:1.8, lineCap:'round',
        }));
        // Fref 标注
        this.group.add(new Konva.Text({
            x:PAD, y:sy-14, text:'Fref', fontSize:9, fill:'#40a0ff',
            fontStyle:'bold', fontFamily:'monospace',
        }));

        // 模块间连接线
        for (let i=0; i<3; i++) {
            this.group.add(new Konva.Line({
                points:[blocks[i].x+blocks[i].w, sy, blocks[i+1].x, sy],
                stroke:'#50b8ff', strokeWidth:1.8, lineCap:'round',
            }));
            // 箭头
            const ax = blocks[i+1].x - 2;
            this._drawArrowHead(ax, sy, 'right', '#50b8ff');
        }

        // VCO → Fout 右端
        this.group.add(new Konva.Line({
            points:[blocks[3].x+blocks[3].w, sy, W-PAD, sy],
            stroke:'#40ffb0', strokeWidth:1.8, lineCap:'round',
        }));
        this._drawArrowHead(W-PAD, sy, 'right', '#40ffb0');
        this.group.add(new Konva.Text({
            x:W-PAD-10, y:sy-14, text:'Fout', fontSize:9, fill:'#40ffb0',
            fontStyle:'bold', fontFamily:'monospace', align:'right', width:50,
        }));
    }

    _drawArrowHead(x, y, dir, color) {
        const s = 6;
        if (dir==='right') {
            this.group.add(new Konva.Line({
                points:[x-s,y-s*0.6, x,y, x-s,y+s*0.6],
                stroke:color, strokeWidth:1.5, lineCap:'round', lineJoin:'round',
            }));
        } else if (dir==='down') {
            this.group.add(new Konva.Line({
                points:[x-s*0.6,y-s, x,y, x+s*0.6,y-s],
                stroke:color, strokeWidth:1.5, lineCap:'round', lineJoin:'round',
            }));
        } else if (dir==='left') {
            this.group.add(new Konva.Line({
                points:[x+s,y-s*0.6, x,y, x+s,y+s*0.6],
                stroke:color, strokeWidth:1.5, lineCap:'round', lineJoin:'round',
            }));
        } else if (dir==='up') {
            this.group.add(new Konva.Line({
                points:[x-s*0.6,y+s, x,y, x+s*0.6,y+s],
                stroke:color, strokeWidth:1.5, lineCap:'round', lineJoin:'round',
            }));
        }
    }

    // ── 反馈路径（底部：VCO输出 → ÷N → PFD）──────────────────────
    _drawFeedbackPath() {
        const W = this.width, PAD = 18;
        const topY = this._topY, botY = this._botY;
        const blocks = this._blocks;
        const divX = blocks[1].cx + blocks[1].w * 0.4;

        // VCO 输出点向下折
        const vcoRx = blocks[3].x + blocks[3].w;
        this.group.add(new Konva.Line({
            points:[vcoRx, topY, vcoRx+14, topY, vcoRx+14, botY, divX+32, botY],
            stroke:'rgba(60,255,150,0.55)', strokeWidth:1.3, dash:[4,3],
            lineCap:'round', lineJoin:'round',
        }));

        // ÷N 分频器图标
        this._drawDividerBox(divX, botY);

        // 分频输出 → PFD 下端（反馈输入）
        const pfdLx = blocks[0].cx;
        this.group.add(new Konva.Line({
            points:[divX-2, botY, pfdLx, botY, pfdLx, topY + blocks[0].h/2],
            stroke:'rgba(255,160,50,0.55)', strokeWidth:1.3, dash:[4,3],
            lineCap:'round', lineJoin:'round',
        }));
        this._drawArrowHead(pfdLx, topY + blocks[0].h/2, 'down', 'rgba(255,160,50,0.8)');

        // 标注
        this.group.add(new Konva.Text({
            x:pfdLx-16, y:botY+6, text:'Fdiv', fontSize:8,
            fill:'rgba(255,160,50,0.8)', fontFamily:'monospace',
        }));
    }

    _drawDividerBox(cx, cy) {
        const w=46, h=22;
        this.group.add(new Konva.Rect({
            x:cx-w/2, y:cy-h/2, width:w, height:h,
            fill:'#0f1e2e', stroke:'#2a5878', strokeWidth:1.2, cornerRadius:4,
        }));
        this.group.add(new Konva.Text({
            x:cx-w/2+2, y:cy-8, width:w-4,
            text:`÷N=${this.N}`, fontSize:9, fill:'#6ab0d0',
            fontStyle:'bold', align:'center', fontFamily:'monospace',
        }));
        this._dividerBox = { cx, cy, w, h };
    }

    // ════════════════════════════════════════════════════════════════
    // ① PFD 鉴相鉴频器
    // ════════════════════════════════════════════════════════════════
    _drawBlock_PFD() {
        const b = this._blocks[0];
        this._drawBlockShell(b, '#1a1f35', '#304878', '① PFD', '鉴相鉴频器');

        const cx=b.cx, cy=b.cy;
        const dfw=26, dfh=22;

        // D触发器 A（上，接Fref）
        const dfaY = cy - 16;
        this._drawDFF(cx-2, dfaY, 'DFF_A', 'UP', '#60a0ff');

        // D触发器 B（下，接Fdiv）
        const dfbY = cy + 16;
        this._drawDFF(cx-2, dfbY, 'DFF_B', 'DN', '#ffa040');

        // 与门（复位）
        this._drawAndGate(cx + dfw/2 + 14, cy, '#80ff80');

        // 内部连线
        this.group.add(new Konva.Line({
            points:[cx-2+dfw/2, dfaY, cx-2+dfw/2, cy-4, cx+dfw/2+8, cy-4, cx+dfw/2+8, cy],
            stroke:'rgba(100,200,100,0.5)', strokeWidth:0.9,
        }));
        this.group.add(new Konva.Line({
            points:[cx-2+dfw/2, dfbY, cx-2+dfw/2, cy+4, cx+dfw/2+8, cy+4, cx+dfw/2+8, cy],
            stroke:'rgba(100,200,100,0.5)', strokeWidth:0.9,
        }));

        // UP/DN 输出标注（动态颜色由 _upLabel/_dnLabel 控制）
        this._upLabel = new Konva.Text({
            x:b.x+b.w-26, y:dfaY-6, text:'UP',
            fontSize:8, fill:'#60a0ff', fontStyle:'bold', fontFamily:'monospace',
        });
        this._dnLabel = new Konva.Text({
            x:b.x+b.w-26, y:dfbY-2, text:'DN',
            fontSize:8, fill:'#ffa040', fontStyle:'bold', fontFamily:'monospace',
        });
        this.group.add(this._upLabel, this._dnLabel);
    }

    _drawDFF(cx, cy, id, outLabel, color) {
        const w=26, h=18;
        this.group.add(new Konva.Rect({
            x:cx-w/2, y:cy-h/2, width:w, height:h,
            fill:'#101828', stroke:color, strokeWidth:1, cornerRadius:2,
        }));
        this.group.add(new Konva.Text({
            x:cx-w/2+2, y:cy-5, text:'D', fontSize:8, fill:color, fontFamily:'monospace',
        }));
        // 时钟三角
        this.group.add(new Konva.Line({
            points:[cx-w/2, cy+2, cx-w/2+5, cy+6, cx-w/2, cy+10],
            stroke:color, strokeWidth:1, closed:false,
        }));
        // Q 输出
        this.group.add(new Konva.Line({
            points:[cx+w/2, cy, cx+w/2+8, cy],
            stroke:color, strokeWidth:1.2,
        }));
        this.group.add(new Konva.Text({
            x:cx+w/2+2, y:cy-5, text:'Q', fontSize:7, fill:color, fontFamily:'monospace',
        }));
    }

    _drawAndGate(cx, cy, color) {
        const w=14, h=18;
        this.group.add(new Konva.Line({
            points:[
                cx-w/2, cy-h/2,
                cx,     cy-h/2,
                cx+w/2, cy,
                cx,     cy+h/2,
                cx-w/2, cy+h/2,
                cx-w/2, cy-h/2,
            ],
            stroke:color, strokeWidth:1, closed:true,
            fill:'rgba(80,200,80,0.1)',
        }));
        // 输出线（复位）
        this.group.add(new Konva.Line({
            points:[cx+w/2, cy, cx+w/2+6, cy],
            stroke:'rgba(80,200,80,0.5)', strokeWidth:1,
        }));
        this.group.add(new Konva.Text({
            x:cx-5, y:cy-4, text:'&', fontSize:7,
            fill:color, fontFamily:'monospace',
        }));
    }

    // ════════════════════════════════════════════════════════════════
    // ② CP 电荷泵
    // ════════════════════════════════════════════════════════════════
    _drawBlock_CP() {
        const b = this._blocks[1];
        this._drawBlockShell(b, '#1a1a30', '#304060', '② CP', '电荷泵');

        const cx=b.cx, cy=b.cy;
        const topY2 = this._topY;

        // 上方 PMOS 电流源（UP控制）
        const pmosY = cy - 22;
        this._drawCurrentSource(cx, pmosY, 'up', '#60a0ff', '+Icp');
        // 下方 NMOS 电流源（DN控制）
        const nmosY = cy + 22;
        this._drawCurrentSource(cx, nmosY, 'down', '#ffa040', '-Icp');

        // 输出节点
        this.group.add(new Konva.Circle({
            x:b.x+b.w+4, y:topY2, radius:3.5, fill:'#40d0ff', stroke:'#2090c0', strokeWidth:0.8,
        }));

        // 连线（电流源 → 输出）
        this.group.add(new Konva.Line({
            points:[cx, pmosY+12, cx, cy-6],
            stroke:'#60a0ff', strokeWidth:1, dash:[3,2],
        }));
        this.group.add(new Konva.Line({
            points:[cx, cy+6, cx, nmosY-12],
            stroke:'#ffa040', strokeWidth:1, dash:[3,2],
        }));
        // 净输出线
        this.group.add(new Konva.Line({
            points:[cx, cy-6, b.x+b.w, this._topY],
            stroke:'#40d0ff', strokeWidth:1.2, dash:[3,2],
        }));

        // 输出电流净值（动态）
        this._cpCurrentText = new Konva.Text({
            x:b.x+b.w-30, y:cy-6, text:'0μA',
            fontSize:7.5, fill:'#40d0ff', fontFamily:'monospace', fontStyle:'bold',
        });
        this.group.add(this._cpCurrentText);
    }

    _drawCurrentSource(cx, cy, dir, color, label) {
        // 圆圈 + 箭头
        this.group.add(new Konva.Circle({
            x:cx, y:cy, radius:11,
            fill:'#101828', stroke:color, strokeWidth:1.2,
        }));
        const d = dir==='up' ? -1 : 1;
        this.group.add(new Konva.Line({
            points:[cx, cy-5*d, cx, cy+5*d],
            stroke:color, strokeWidth:1.5,
        }));
        this.group.add(new Konva.Line({
            points:[cx-4, cy+(2)*d, cx, cy-4*d, cx+4, cy+(2)*d],
            stroke:color, strokeWidth:1.3, lineCap:'round', lineJoin:'round',
        }));
        this.group.add(new Konva.Text({
            x:cx+14, y:cy-5, text:label, fontSize:7.5,
            fill:color, fontFamily:'monospace',
        }));
        // 控制线（来自PFD）
        this.group.add(new Konva.Line({
            points:[cx-11, cy, cx-this._blocks[1].w*0.38, cy],
            stroke:color, strokeWidth:0.9, dash:[2,2],
        }));
    }

    // ════════════════════════════════════════════════════════════════
    // ③ LF 环路滤波器
    // ════════════════════════════════════════════════════════════════
    _drawBlock_LF() {
        const b = this._blocks[2];
        this._drawBlockShell(b, '#1a2518', '#304828', '③ LF', '环路滤波器');

        const cx=b.cx, cy=b.cy;

        // R1（串联）
        const r1y = cy - 14;
        this._drawResistorV(cx - 12, r1y, 'R1', `${(this.R1/1000).toFixed(1)}k`);

        // C1（主电容）
        const c1y = cy + 6;
        this._drawCapV(cx - 12, c1y, 'C1', `${(this.C1*1e12).toFixed(0)}p`);

        // C2（并联小电容）
        this._drawCapV(cx + 14, cy, 'C2', `${(this.C2*1e12).toFixed(0)}p`, '#a0d0a0');

        // Vctrl 输出节点 + 电压显示
        this._vctrlText = new Konva.Text({
            x:b.x+2, y:cy+30, width:b.w-4,
            text:`Vctrl\n${this._vctrl.toFixed(3)}V`,
            fontSize:9, fill:'#80e080', fontStyle:'bold',
            align:'center', fontFamily:'monospace', lineHeight:1.3,
            shadowColor:'#40ff40', shadowBlur:4, shadowOpacity:0.6,
        });
        this.group.add(this._vctrlText);
    }

    _drawResistorV(cx, cy, name, val) {
        const h=20, w=10;
        this.group.add(new Konva.Rect({
            x:cx-w/2, y:cy-h/2, width:w, height:h,
            fill:'#1e2a10', stroke:'#7a9040', strokeWidth:1, cornerRadius:2,
        }));
        this.group.add(new Konva.Line({ points:[cx,cy-h/2,cx,cy-h/2-6], stroke:'#80a040', strokeWidth:1.2 }));
        this.group.add(new Konva.Line({ points:[cx,cy+h/2,cx,cy+h/2+6], stroke:'#80a040', strokeWidth:1.2 }));
        this.group.add(new Konva.Text({ x:cx+6, y:cy-6, text:`${name}\n${val}`, fontSize:6.5, fill:'#7a9040', fontFamily:'monospace', lineHeight:1.3 }));
    }

    _drawCapV(cx, cy, name, val, color='#60c080') {
        const gap=5, w=14;
        this.group.add(new Konva.Line({ points:[cx,cy-gap-6,cx,cy-gap], stroke:color, strokeWidth:1.2 }));
        this.group.add(new Konva.Line({ points:[cx-w/2,cy-gap,cx+w/2,cy-gap], stroke:color, strokeWidth:2.2 }));
        this.group.add(new Konva.Line({ points:[cx-w/2,cy+gap,cx+w/2,cy+gap], stroke:color, strokeWidth:2.2 }));
        this.group.add(new Konva.Line({ points:[cx,cy+gap,cx,cy+gap+6], stroke:color, strokeWidth:1.2 }));
        this.group.add(new Konva.Text({ x:cx+8, y:cy-6, text:`${name}\n${val}`, fontSize:6.5, fill:color, fontFamily:'monospace', lineHeight:1.3 }));
    }

    // ════════════════════════════════════════════════════════════════
    // ④ VCO 压控振荡器
    // ════════════════════════════════════════════════════════════════
    _drawBlock_VCO() {
        const b = this._blocks[3];
        this._drawBlockShell(b, '#1a1520', '#483060', '④ VCO', '压控振荡器');

        const cx=b.cx, cy=b.cy;

        // LC 谐振回路图形
        this._drawLCTank(cx, cy - 10);

        // Kvco 标注
        this.group.add(new Konva.Text({
            x:b.x+2, y:cy+28, width:b.w-4,
            text:`Kvco\n${this._fmtHz(this.Kvco)}/V`,
            fontSize:8, fill:'#a080d0', align:'center', fontFamily:'monospace', lineHeight:1.3,
        }));

        // 频率输出（动态）
        this._vcoFreqText = new Konva.Text({
            x:b.x+2, y:cy+50, width:b.w-4,
            text:`${this._fmtHz(this.Fout_nom)}`,
            fontSize:10, fill:'#c0a0ff', fontStyle:'bold',
            align:'center', fontFamily:'monospace',
            shadowColor:'#c0a0ff', shadowBlur:5, shadowOpacity:0.7,
        });
        this.group.add(this._vcoFreqText);
    }

    _drawLCTank(cx, cy) {
        // 线圈 L（上方螺旋）
        const turns=4, seg=9;
        for (let i=0;i<turns;i++) {
            const pts=[];
            const ax = cx - turns*seg/2 + i*seg + seg/2;
            for (let s=0;s<=10;s++) {
                const a = Math.PI*s/10;
                pts.push(ax - (seg/2)*Math.cos(a));
                pts.push(cy - 8 - 7*Math.sin(a));
            }
            this.group.add(new Konva.Line({ points:pts, stroke:'#c090ff', strokeWidth:2, lineCap:'round', lineJoin:'round' }));
        }
        this.group.add(new Konva.Text({ x:cx-6, y:cy-22, text:'L', fontSize:8, fill:'#c090ff', fontFamily:'monospace' }));

        // 变容二极管 Cvar（可变电容）
        const cvx=cx, cvy=cy+8;
        this.group.add(new Konva.Line({ points:[cvx-16,cvy,cvx-4,cvy], stroke:'#a070ff', strokeWidth:1.5 }));
        this.group.add(new Konva.Line({ points:[cvx-4,cvy-8,cvx-4,cvy+8], stroke:'#a070ff', strokeWidth:2.5 }));
        this.group.add(new Konva.Line({ points:[cvx+4,cvy-8,cvx+4,cvy+8], stroke:'#a070ff', strokeWidth:2.5 }));
        // 变容二极管箭头
        this.group.add(new Konva.Line({ points:[cvx,cvy-6,cvx+4,cvy], stroke:'#ff80ff', strokeWidth:1.2 }));
        this.group.add(new Konva.Line({ points:[cvx,cvy+6,cvx+4,cvy], stroke:'#ff80ff', strokeWidth:1.2 }));
        this.group.add(new Konva.Line({ points:[cvx+4,cvy,cvx+16,cvy], stroke:'#a070ff', strokeWidth:1.5 }));
        this.group.add(new Konva.Text({ x:cx-4, y:cvy+10, text:'Cvar', fontSize:7, fill:'#a070ff', fontFamily:'monospace' }));

        // 控制电压箭头（Vctrl输入）
        this.group.add(new Konva.Line({
            points:[this._blocks[3].x, this._topY, cx, this._topY, cx, cvy-10],
            stroke:'#80e080', strokeWidth:1, dash:[3,2],
        }));
        this.group.add(new Konva.Text({ x:this._blocks[3].x+2, y:this._topY+4, text:'Vctrl→', fontSize:7, fill:'#80e080', fontFamily:'monospace' }));
    }

    // ── 分频器（已在_drawFeedbackPath中绘制，此处仅补充细节）──────
    _drawDivider() {
        // ÷N 已在 _drawFeedbackPath 中绘制，无需重复
    }

    // ── 波形显示区（四路波形）──────────────────────────────────────
    _drawWaveBoxes() {
        const W = this.width, PAD = 18;
        const y0 = this._waveY;
        const wh = this._waveH;
        const blocks = this._blocks;

        const waveDefs = [
            { key:'pfd',  label:'PFD — Fref / Fdiv 相位',    color:'#6090ff', subColor:'#ff9040' },
            { key:'cp',   label:'CP — 输出电流',              color:'#40d0ff', subColor:null },
            { key:'lf',   label:'LF — Vctrl 收敛',            color:'#60e070', subColor:null },
            { key:'vco',  label:'VCO — 输出频率',             color:'#c090ff', subColor:null },
        ];

        this._waveBoxDefs = {};
        blocks.forEach((b, i) => {
            const def = waveDefs[i];
            const bx = b.x, bw = b.w;

            // 底框
            this.group.add(new Konva.Rect({
                x:bx, y:y0, width:bw, height:wh,
                fill:'rgba(0,0,0,0.4)', stroke:`${def.color}55`,
                strokeWidth:1, cornerRadius:4,
            }));
            // 标签
            this.group.add(new Konva.Text({
                x:bx+3, y:y0+3, width:bw-6, text:def.label,
                fontSize:6.8, fill:def.color, fontFamily:'monospace',
            }));
            // 中心参考线
            const my = y0 + wh * 0.52;
            this.group.add(new Konva.Line({
                points:[bx+4, my, bx+bw-4, my],
                stroke:`${def.color}22`, strokeWidth:0.7, dash:[4,4],
            }));

            this._waveBoxDefs[def.key] = {
                x:bx+3, y:y0+12, w:bw-6, h:wh-16,
                color:def.color, subColor:def.subColor,
            };
        });
    }

    // ── 顶部模块标签（已在各 block shell 绘制）──────────────────────
    _drawTopLabels() {
        // 锁定状态大标签
        const W = this.width;
        this._lockStateText = new Konva.Text({
            x:0, y:this._waveY - 18, width:W,
            text:'● ACQUIRING LOCK...',
            fontSize:11, fill:'#ffcc40', fontStyle:'bold',
            align:'center', fontFamily:'monospace',
            shadowColor:'#ffcc40', shadowBlur:8, shadowOpacity:0.8,
        });
        this.group.add(this._lockStateText);

        // 进度条
        const pby = this._waveY - 6;
        const pbw = this.width - 60;
        this.group.add(new Konva.Rect({
            x:30, y:pby, width:pbw, height:5,
            fill:'rgba(255,255,255,0.05)', stroke:'rgba(255,255,255,0.1)',
            strokeWidth:0.8, cornerRadius:2,
        }));
        this._progressBar = new Konva.Rect({
            x:30, y:pby, width:0, height:5,
            fill:'#ffcc40', cornerRadius:2,
            shadowColor:'#ffcc40', shadowBlur:4, shadowOpacity:0.7,
        });
        this.group.add(this._progressBar);
    }

    // ── 右下状态面板 ──────────────────────────────────────────────
    _drawStatusPanel() {
        const W = this.width, H = this.height, PAD = 18;
        const pw=160, ph=60;
        const px = W - PAD - pw, py = H - PAD - ph;

        this.group.add(new Konva.Rect({
            x:px, y:py, width:pw, height:ph,
            fill:'#080f18', stroke:'#1e3858', strokeWidth:1, cornerRadius:5,
        }));
        this.group.add(new Konva.Text({
            x:px+4, y:py+3, width:pw-8,
            text:'── 实时参数 ──',
            fontSize:7, fill:'#2a5080', align:'center', fontFamily:'monospace',
        }));

        const rows = [
            { key:'Fout',    label:'Fout',   unit:'',   color:'#c0a0ff' },
            { key:'Vctrl',   label:'Vctrl',  unit:'V',  color:'#60e070' },
            { key:'PhErr',   label:'ΔΦ',     unit:'°',  color:'#ff9060' },
            { key:'State',   label:'状态',   unit:'',   color:'#ffcc40' },
        ];
        this._statLabels = {};
        rows.forEach(({ key, label, unit, color }, i) => {
            const ly = py + 14 + i * 12;
            this.group.add(new Konva.Text({
                x:px+6, y:ly, text:`${label}:`,
                fontSize:8, fill:'#3a6080', fontFamily:'monospace',
            }));
            const t = new Konva.Text({
                x:px+44, y:ly, text:'—',
                fontSize:8, fill:color, fontFamily:'monospace', fontStyle:'bold', width:pw-50,
            });
            this._statLabels[key] = t;
            this.group.add(t);
        });

        // 状态指示灯
        this._stateDot = new Konva.Circle({
            x:px+pw-10, y:py+ph-10, radius:5,
            fill:'#ffcc40', stroke:'#a08820',
            strokeWidth:0.8, shadowColor:'#ffcc40',
            shadowBlur:6, shadowOpacity:0.8,
        });
        this.group.add(this._stateDot);
    }

    // ── 通用模块外壳 ──────────────────────────────────────────────
    _drawBlockShell(b, fillColor, strokeColor, title, subtitle) {
        this.group.add(new Konva.Rect({
            x:b.x, y:b.y, width:b.w, height:b.h,
            fillLinearGradientStartPoint:{x:0,y:0},
            fillLinearGradientEndPoint:{x:0,y:b.h},
            fillLinearGradientColorStops:[0,fillColor,1,'#0a0f18'],
            stroke:strokeColor, strokeWidth:1.2, cornerRadius:6,
            shadowColor:strokeColor, shadowBlur:6, shadowOpacity:0.2,
        }));
        // 顶部色条
        this.group.add(new Konva.Rect({
            x:b.x+1, y:b.y+1, width:b.w-2, height:5,
            fill:strokeColor+'88', cornerRadius:[6,6,0,0],
        }));
        // 标题
        this.group.add(new Konva.Text({
            x:b.x+2, y:b.y+7, width:b.w-4,
            text:title, fontSize:9, fill:strokeColor,
            fontStyle:'bold', align:'center', fontFamily:'monospace',
        }));
        this.group.add(new Konva.Text({
            x:b.x+2, y:b.y+18, width:b.w-4,
            text:subtitle, fontSize:7, fill:strokeColor+'aa',
            align:'center', fontFamily:'monospace',
        }));
    }

    // ════════════════════════════════════════════════════════════════
    // 动画层
    // ════════════════════════════════════════════════════════════════
    _createAnimLayers() {
        this._animGroup = new Konva.Group({ listening:false });
        this.group.add(this._animGroup);

        // 四路波形曲线
        this._waveCurves = {};
        ['pfd_ref','pfd_div','cp','lf','vco'].forEach(key => {
            const line = new Konva.Line({
                points:[0,0], stroke:'#ffffff',
                strokeWidth:1.5, lineCap:'round', lineJoin:'round',
                listening:false,
            });
            this._animGroup.add(line);
            this._waveCurves[key] = line;
        });

        // PFD UP 脉冲高亮
        this._upHighlight = new Konva.Rect({
            x:0,y:0,width:0,height:0,
            fill:'rgba(60,120,255,0.25)', cornerRadius:2, listening:false,
        });
        this._dnHighlight = new Konva.Rect({
            x:0,y:0,width:0,height:0,
            fill:'rgba(255,140,40,0.25)', cornerRadius:2, listening:false,
        });
        this._animGroup.add(this._upHighlight, this._dnHighlight);

        // 信号流粒子（4段路径）
        this._sigParticles = [];
        const pColors = ['#60a0ff','#40d0ff','#60e070','#c090ff','#ffa040'];
        pColors.forEach((col, pi) => {
            for (let i=0;i<6;i++) {
                const dot = new Konva.Circle({
                    x:0,y:0, radius:2.8,
                    fill:col, opacity:0,
                    shadowColor:col, shadowBlur:5, shadowOpacity:0.9,
                    listening:false,
                });
                this._animGroup.add(dot);
                this._sigParticles.push({ dot, t:i/6, path:pi });
            }
        });

        // VCO 振荡动画圆（频率视觉化）
        this._vcoRings = [];
        for (let r=0;r<4;r++) {
            const ring = new Konva.Circle({
                x:0,y:0, radius:0, fill:'transparent',
                stroke:'#c090ff', strokeWidth:1.2, opacity:0, listening:false,
            });
            this._animGroup.add(ring);
            this._vcoRings.push({ ring, t:r/4 });
        }
        const vb = this._blocks[3];
        this._vcoCenterX = vb.cx;
        this._vcoCenterY = vb.cy - 10;
    }

    // ── 路径集合 ──────────────────────────────────────────────────
    _getSignalPaths() {
        const W=this.width, PAD=18;
        const sy=this._topY, by=this._botY;
        const bs = this._blocks;
        const div = this._dividerBox;

        return [
            // path 0: Fref → PFD
            [{ x:PAD,y:sy },{ x:bs[0].x,y:sy }],
            // path 1: PFD → CP → LF → VCO (主路)
            [{ x:bs[0].x+bs[0].w,y:sy },{ x:bs[1].x,y:sy },
             { x:bs[1].x+bs[1].w,y:sy },{ x:bs[2].x,y:sy },
             { x:bs[2].x+bs[2].w,y:sy },{ x:bs[3].x,y:sy }],
            // path 2: VCO → Fout
            [{ x:bs[3].x+bs[3].w,y:sy },{ x:W-PAD,y:sy }],
            // path 3: Fout → ÷N (反馈上段)
            [{ x:bs[3].x+bs[3].w,y:sy },{ x:bs[3].x+bs[3].w+14,y:sy },
             { x:bs[3].x+bs[3].w+14,y:by },{ x:div.cx+div.w/2,y:by }],
            // path 4: ÷N → PFD (反馈下段)
            [{ x:div.cx-div.w/2,y:by },{ x:bs[0].cx,y:by },
             { x:bs[0].cx,y:sy+bs[0].h/2 }],
        ];
    }

    _interpPath(path, t) {
        const segs=[]; let total=0;
        for (let i=1;i<path.length;i++) {
            const dx=path[i].x-path[i-1].x, dy=path[i].y-path[i-1].y;
            const l=Math.sqrt(dx*dx+dy*dy);
            segs.push(l); total+=l;
        }
        if (total===0) return path[0];
        let tgt = ((t%1)+1)%1 * total;
        for (let i=0;i<segs.length;i++) {
            if (tgt<=segs[i]) {
                const f=tgt/segs[i];
                return { x:path[i].x+(path[i+1].x-path[i].x)*f,
                         y:path[i].y+(path[i+1].y-path[i].y)*f };
            }
            tgt-=segs[i];
        }
        return path[path.length-1];
    }

    // ── 波形渲染 ──────────────────────────────────────────────────
    _renderWaves() {
        const progress = this._lockProgress;
        const locked   = this._lockState === 'LOCKED';

        // ── PFD 波形：Fref（蓝色方波）& Fdiv（橙色方波，相位偏移）──
        const pfdBox = this._waveBoxDefs['pfd'];
        if (pfdBox) {
            const { x,y,w,h,color,subColor } = pfdBox;
            const refPts=[], divPts=[];
            const steps=80, refH=h*0.35;
            // Fref：固定频率方波
            for (let i=0;i<=steps;i++) {
                const px=x+i*(w/steps);
                const t=i/steps;
                const phase=t*8*Math.PI + this._phaseRef * 0.2;
                const val = Math.sin(phase) > 0 ? 1 : 0;
                refPts.push(px, y+h*0.18 + refH*(1-val));
            }
            // Fdiv：相位延迟，锁定后趋近0延迟
            const phaseShift = locked ? 0.08 : (1 - progress) * Math.PI * 1.8;
            for (let i=0;i<=steps;i++) {
                const px=x+i*(w/steps);
                const t=i/steps;
                const phase=t*8*Math.PI + this._phaseRef*0.2 - phaseShift;
                const val = Math.sin(phase) > 0 ? 1 : 0;
                divPts.push(px, y+h*0.56 + refH*(1-val));
            }
            this._waveCurves['pfd_ref'].points(refPts);
            this._waveCurves['pfd_ref'].stroke(color);
            this._waveCurves['pfd_div'].points(divPts);
            this._waveCurves['pfd_div'].stroke(subColor||'#ffa040');

            // UP 脉冲高亮
            const upW = locked ? 4 : (1-progress)*24 + 4;
            this._upHighlight.x(x+10); this._upHighlight.y(y+2);
            this._upHighlight.width(upW); this._upHighlight.height(h*0.42);
            this._dnHighlight.x(x+10+upW+2); this._dnHighlight.y(y+h*0.48);
            this._dnHighlight.width(locked?2:4); this._dnHighlight.height(h*0.42);
        }

        // ── CP 电流波形 ──
        const cpBox = this._waveBoxDefs['cp'];
        if (cpBox) {
            const { x,y,w,h,color } = cpBox;
            const pts=[];
            const midY = y+h*0.5;
            const amp  = locked ? h*0.05 : h*0.35 * (1-progress*0.75);
            for (let i=0;i<=80;i++) {
                const px=x+i*(w/80);
                const t=i/80;
                const phase=t*10*Math.PI + this._phaseRef*0.15;
                const pulse = Math.sin(phase)>0.6 ? 1 : (Math.sin(phase)<-0.6 ? -1 : 0);
                pts.push(px, midY - amp*pulse);
            }
            this._waveCurves['cp'].points(pts);
            this._waveCurves['cp'].stroke(color);
        }

        // ── LF Vctrl 收敛曲线 ──
        const lfBox = this._waveBoxDefs['lf'];
        if (lfBox) {
            const { x,y,w,h,color } = lfBox;
            // 使用历史记录绘制收敛曲线
            const hist = this._vctrlHistory;
            if (hist.length > 1) {
                const pts=[];
                const vmin=0.5, vmax=2.0;
                const n=Math.min(hist.length, 80);
                for (let i=0;i<n;i++) {
                    const px=x + i*(w/n);
                    const v=hist[hist.length-n+i];
                    const py=y+h - (v-vmin)/(vmax-vmin)*h*0.85 - 4;
                    pts.push(px, Math.max(y+2, Math.min(y+h-2, py)));
                }
                this._waveCurves['lf'].points(pts);
                this._waveCurves['lf'].stroke(color);
            }
        }

        // ── VCO 输出频率波形（频率随Vctrl变化）──
        const vcoBox = this._waveBoxDefs['vco'];
        if (vcoBox) {
            const { x,y,w,h,color } = vcoBox;
            const pts=[];
            // 频率：捕获时从偏低→目标频率
            const freqRatio = 0.6 + progress * 0.4; // 0.6N~1.0N
            const cycles = 6 * freqRatio;
            const amp = h*0.38;
            for (let i=0;i<=100;i++) {
                const t=i/100;
                const px=x+t*w;
                // 频率随进度递增（调频效果）
                const localFreq = locked ? 1 : (0.6 + t*progress*0.4);
                const phase=t*cycles*2*Math.PI*localFreq + this._phaseVco*0.05;
                pts.push(px, y+h*0.5 - amp*Math.sin(phase));
            }
            this._waveCurves['vco'].points(pts);
            this._waveCurves['vco'].stroke(color);
        }
    }

    // ── 主仿真逻辑 ────────────────────────────────────────────────
    _simulate(dt) {
        const prevState = this._lockState;

        if (this._lockState === 'ACQUIRING') {
            this._lockTime     += dt;
            this._lockProgress  = Math.min(1, this._lockTime / this._lockDuration);

            // 一阶系统：控制电压指数收敛
            const tau    = this._lockDuration * 0.35;
            const Vtarget = this.Vctrl_center;
            const Vstart  = this.Vctrl_center - 0.65; // 起始偏移
            this._vctrl = Vtarget + (Vstart - Vtarget) * Math.exp(-this._lockTime / tau);

            // 加入锁定噪声（衰减振荡）
            const noise = 0.04 * Math.exp(-this._lockTime * 1.2) * Math.sin(this._lockTime * 18);
            this._vctrl += noise;

            // 相位误差：随进度指数衰减
            this._phaseErr = (1 - this._lockProgress) * 180 + 5;

            // 到达锁定
            if (this._lockProgress >= 1.0) {
                this._lockState    = 'LOCKED';
                this._lockProgress = 1.0;
                this._vctrl        = this.Vctrl_center;
                this._phaseErr     = 2;
            }

        } else if (this._lockState === 'LOCKED') {
            // 锁定后微小抖动（相位噪声）
            this._vctrl    = this.Vctrl_center + 0.003 * Math.sin(this._phase * 7.3);
            this._phaseErr = 2 + 1.5 * Math.abs(Math.sin(this._phase * 4.1));

        } else if (this._lockState === 'UNLOCKED') {
            // 失锁重新捕获
            this._lockState    = 'ACQUIRING';
            this._lockTime     = 0;
            this._lockProgress = 0;
            this._vctrl        = this.Vctrl_center - 0.65;
        }

        // 计算当前 Fvco
        const Fvco = this.Fout_nom + this.Kvco * (this._vctrl - this.Vctrl_center);
        this._currentFout = Fvco;

        // PFD UP/DN 脉冲（衰减）
        const phaseDiff = this._phaseErr;
        this._upDecay = Math.max(0, this._upDecay - dt * 8);
        this._dnDecay = Math.max(0, this._dnDecay - dt * 8);
        if (phaseDiff > 5) {
            this._upDecay = Math.min(1, phaseDiff / 180);
        }

        // 积累相位
        this._phaseRef  += dt * 2 * Math.PI * 4;  // 视觉频率
        this._phaseVco  += dt * 2 * Math.PI * 4 * (0.6 + this._lockProgress * 0.4);

        // 记录历史
        this._vctrlHistory.push(this._vctrl);
        if (this._vctrlHistory.length > this._maxHistory) {
            this._vctrlHistory.shift();
        }
    }

    // ── 更新 UI 文字 ──────────────────────────────────────────────
    _updateUI() {
        const locked = this._lockState === 'LOCKED';

        // 控制电压
        if (this._vctrlText) {
            this._vctrlText.text(`Vctrl\n${this._vctrl.toFixed(3)}V`);
            this._vctrlText.fill(locked ? '#40ff80' : '#ffcc40');
            this._vctrlText.shadowColor(locked ? '#40ff80' : '#ffcc40');
        }

        // VCO 频率
        if (this._vcoFreqText && this._currentFout) {
            this._vcoFreqText.text(this._fmtHz(this._currentFout));
            this._vcoFreqText.fill(locked ? '#80ffcc' : '#c090ff');
        }

        // 进度条
        if (this._progressBar) {
            const pbw = this.width - 60;
            this._progressBar.width(pbw * Math.min(1, this._lockProgress));
            this._progressBar.fill(locked ? '#40ff80' : '#ffcc40');
            this._progressBar.shadowColor(locked ? '#40ff80' : '#ffcc40');
        }

        // 锁定状态文字
        if (this._lockStateText) {
            const stateMap = {
                'ACQUIRING': { text:'◎  ACQUIRING LOCK...', color:'#ffcc40' },
                'LOCKED':    { text:'●  LOCKED',            color:'#40ff80' },
                'UNLOCKED':  { text:'○  UNLOCKED',          color:'#ff5050' },
            };
            const s = stateMap[this._lockState];
            this._lockStateText.text(s.text);
            this._lockStateText.fill(s.color);
            this._lockStateText.shadowColor(s.color);
        }

        // UP/DN 标签亮度
        if (this._upLabel) {
            const upA = 0.3 + this._upDecay * 0.7;
            this._upLabel.fill(`rgba(96,160,255,${upA.toFixed(2)})`);
        }
        if (this._dnLabel) {
            const dnA = 0.3 + this._dnDecay * 0.7;
            this._dnLabel.fill(`rgba(255,160,64,${dnA.toFixed(2)})`);
        }

        // CP 电流文字
        if (this._cpCurrentText) {
            const icpNet = (this._upDecay - this._dnDecay) * this.Icp * 1e6;
            this._cpCurrentText.text(`${icpNet >= 0 ? '+' : ''}${icpNet.toFixed(0)}μA`);
            this._cpCurrentText.fill(icpNet > 0 ? '#60a0ff' : icpNet < 0 ? '#ffa040' : '#40d0ff');
        }

        // 状态面板
        if (this._statLabels) {
            this._statLabels['Fout']?.text(this._fmtHz(this._currentFout || this.Fout_nom));
            this._statLabels['Vctrl']?.text(`${this._vctrl.toFixed(4)}V`);
            this._statLabels['PhErr']?.text(`${this._phaseErr.toFixed(1)}°`);
            this._statLabels['State']?.text(this._lockState);
            if (this._stateDot) {
                const col = locked ? '#40ff80' : this._lockState==='ACQUIRING' ? '#ffcc40' : '#ff5050';
                this._stateDot.fill(col);
                this._stateDot.shadowColor(col);
                this._stateDot.shadowBlur(locked ? 8 : 4);
            }
        }
    }

    // ── 粒子动画 ──────────────────────────────────────────────────
    _updateParticles(dt) {
        const paths = this._getSignalPaths();
        const speeds = [0.5, 0.4, 0.6, 0.3, 0.25];
        const maxOpacity = [0.9, 0.85, 0.9, 0.7, 0.75];

        this._sigParticles.forEach(p => {
            p.t = ((p.t + dt * speeds[p.path]) % 1);
            const path = paths[p.path];
            if (!path || path.length < 2) { p.dot.opacity(0); return; }
            const pos = this._interpPath(path, p.t);
            p.dot.x(pos.x); p.dot.y(pos.y);
            const a = p.t < 0.06 ? p.t/0.06 : p.t > 0.94 ? (1-p.t)/0.06 : 1;
            p.dot.opacity(a * maxOpacity[p.path]);
        });

        // VCO 振荡环（频率越高，扩散越快）
        const ringSpeed = 0.5 + (this._lockProgress) * 0.5;
        this._vcoRings.forEach(({ ring, t: t0 }, i) => {
            this._vcoRings[i].t = ((t0 + dt * ringSpeed) % 1);
            const rt = this._vcoRings[i].t;
            ring.x(this._vcoCenterX);
            ring.y(this._vcoCenterY);
            ring.radius(rt * 28 + 4);
            ring.opacity((1 - rt) * 0.55);
            ring.stroke(this._lockState === 'LOCKED' ? '#80ffcc' : '#c090ff');
        });
    }

    // ── 主帧循环 ──────────────────────────────────────────────────
    _tickAnimation(dt) {
        this._phase += dt;
        this._simulate(dt);
        this._renderWaves();
        this._updateUI();
        this._updateParticles(dt);
        this._animGroup.getLayer()?.batchDraw();
    }

    // 集中化 tick（由 consys._tickAll 在 20fps 调用）
    tick(dt) {
        this._tickAnimation(dt);
    }
    // ── 交互（点击 VCO 区域触发失锁→重新捕获）────────────────────
    _bindInteraction() {
        const vb = this._blocks[3];
        // 点击 VCO 块触发频率跳变（演示重新捕获）
        const hitArea = new Konva.Rect({
            x:vb.x, y:vb.y, width:vb.w, height:vb.h,
            fill:'transparent', listening:true,
        });
        hitArea.on('click tap', () => this.triggerReacquire());
        this.group.add(hitArea);

        // 点击分频器切换 N（演示频率切换）
        if (this._dividerBox) {
            const db = this._dividerBox;
            const dbHit = new Konva.Rect({
                x:db.cx-db.w/2-4, y:db.cy-db.h/2-4,
                width:db.w+8, height:db.h+8,
                fill:'transparent', listening:true,
            });
            dbHit.on('click tap', () => this.stepN());
            this.group.add(dbHit);
        }
    }

    // ════════════════════════════════════════════════════════════════
    // 公共 API
    // ════════════════════════════════════════════════════════════════

    /** 触发失锁并重新捕获（演示用） */
    triggerReacquire() {
        this._lockState    = 'UNLOCKED';
        this._lockTime     = 0;
        this._lockProgress = 0;
        this._vctrlHistory = [];
        this._vctrl        = this.Vctrl_center - 0.65;
        this._phaseErr     = 180;
        this._refreshCache();
    }

    /** 步进分频比 N（演示频率切换） */
    stepN() {
        const steps = [50, 80, 100, 150, 200];
        const idx   = steps.indexOf(this.N);
        this.N      = steps[(idx + 1) % steps.length];
        this.Fout_nom = this.Fref * this.N;
        this.triggerReacquire();
    }

    /** 设置分频比 */
    setN(n) {
        this.N        = Math.max(1, Math.round(n));
        this.Fout_nom = this.Fref * this.N;
        this.triggerReacquire();
    }

    /** 设置参考频率 */
    setFref(f) {
        this.Fref     = f;
        this.Fout_nom = this.Fref * this.N;
        this.triggerReacquire();
    }

    /** 当前状态快照 */
    getState() {
        return {
            lockState:    this._lockState,
            lockProgress: this._lockProgress,
            Vctrl:        this._vctrl,
            phaseError:   this._phaseErr,
            Fout:         this._currentFout || this.Fout_nom,
            N:            this.N,
            Fref:         this.Fref,
        };
    }

    isLocked() { return this._lockState === 'LOCKED'; }

    update(state) {
        if (state && typeof state === 'object') {
            if (state.N    !== undefined) this.setN(state.N);
            if (state.Fref !== undefined) this.setFref(state.Fref);
        }
        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label:'位号/名称',            key:'label',         type:'text'   },
            { label:'参考频率 Fref (Hz)',   key:'Fref',          type:'number' },
            { label:'分频比 N',             key:'N',             type:'number' },
            { label:'VCO增益 Kvco (Hz/V)', key:'Kvco',          type:'number' },
            { label:'电荷泵电流 Icp (A)',   key:'Icp',           type:'number' },
            { label:'LF 电阻 R1 (Ω)',       key:'R1',            type:'number' },
            { label:'LF 主电容 C1 (F)',     key:'C1',            type:'number' },
            { label:'LF 并联电容 C2 (F)',   key:'C2',            type:'number' },
            { label:'VCO 中心控制电压 (V)', key:'Vctrl_center',  type:'number' },
            { label:'捕获时间模拟 (s)',      key:'lockDuration',  type:'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label)        this.label        = cfg.label;
        if (cfg.Fref)         this.Fref         = parseFloat(cfg.Fref)         || this.Fref;
        if (cfg.N)            this.N            = parseInt(cfg.N)              || this.N;
        if (cfg.Kvco)         this.Kvco         = parseFloat(cfg.Kvco)         || this.Kvco;
        if (cfg.Icp)          this.Icp          = parseFloat(cfg.Icp)          || this.Icp;
        if (cfg.R1)           this.R1           = parseFloat(cfg.R1)           || this.R1;
        if (cfg.C1)           this.C1           = parseFloat(cfg.C1)           || this.C1;
        if (cfg.C2)           this.C2           = parseFloat(cfg.C2)           || this.C2;
        if (cfg.Vctrl_center) this.Vctrl_center = parseFloat(cfg.Vctrl_center) || this.Vctrl_center;
        if (cfg.lockDuration) this._lockDuration = parseFloat(cfg.lockDuration) || this._lockDuration;

        this.Fout_nom = this.Fref * this.N;
        this.config   = { ...this.config, ...cfg };
        this.triggerReacquire();
    }

    destroy() {
        super.destroy?.();
    }
}