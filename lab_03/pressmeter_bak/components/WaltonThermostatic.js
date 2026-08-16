import { BaseComponent } from './BaseComponent.js';

/**
 * WALTON 自力式旋转三通恒温阀仿真组件
 * （Walton Engineering Self-Acting Rotary 3-Way Thermostatic Control Valve）
 *
 * ── 产品背景 ──────────────────────────────────────────────────
 *
 *  英国 Walton Engineering 生产的自力式旋转三通恒温阀，
 *  广泛应用于船舶主机（柴油机/蒸汽轮机/燃气轮机）：
 *    · 主机夹套冷却水温度控制
 *    · 润滑油冷却器旁路温控
 *    · 压缩机冷却系统
 *    · 船舶空调冷冻水系统
 *
 *  阀门口径范围：25mm（1"）~ 250mm（10"）
 *  材质：青铜（Bronze）/ 不锈钢（Stainless Steel）
 *  最大压差：0.8 bar（全流量工况）
 *  无需外部电源或气源，温包膨胀直接驱动转子
 *
 * ── 工作原理 ──────────────────────────────────────────────────
 *
 *  核心机构：热膨胀温包（Thermostatic Element）+ 转子（Rotor）
 *
 *  温包工作方式：
 *    - 温包内充注特殊蜡质（Wax Fill），精确固化/熔化相变温度
 *    - 随流体温度升高，蜡熔化膨胀，推动推杆（Spindle）伸长
 *    - 推杆通过连杆机构驱动转子旋转
 *    - 推杆回缩由内置回位弹簧（Return Spring）保证
 *
 *  两种安装模式：
 *
 *  ①  混合模式（Mixing，阀门装于冷却器下游）：
 *      热旁路（Bypass）热流 ──┐
 *                              ├──→ 混合出口（Common）
 *      冷却器出口（Cooler）──┘
 *
 *      温度升高 → 冷却器开度↑、旁路开度↓ → 混合温度↓
 *
 *  ②  分流模式（Diverting，阀门装于冷却器上游）：
 *      公共入口（Common）──→ 旁路（Bypass）
 *                         └──→ 冷却器（Cooler）
 *
 *      温度升高 → 更多流量流向冷却器
 *
 *  转子特征（Walton 专利旋转设计）：
 *    - 转子为圆柱形，内含月牙形流道（Crescent Flow Channel）
 *    - 旋转角 0°~90°：线性比例调节冷却器/旁路开度
 *    - 极低压差（流道几乎直通，无折弯），节能优势明显
 *
 *  整定温度（Set Temperature）：
 *    - 通过预装不同相变温度的温包实现，常规范围 35~95°C
 *    - 典型工作带（Proportional Band）：约 ±6°C
 *
 * ── 视觉结构（正视图 + 剖视联动）─────────────────────────────
 *
 *  ┌──────────────────────────────────────────────────┐
 *  │         标注区（型号 / 位号 / 整定温度）            │
 *  ├──────────────────────────────────────────────────┤
 *  │  ╔══════════════════════════════════════════╗    │
 *  │  ║   阀体剖视（转子位置 + 流道动态可视化）    ║    │
 *  │  ║                                          ║    │
 *  │  ║  [BYPASS口] ──── 转子 ──── [COOLER口]    ║    │
 *  │  ║                   │                      ║    │
 *  │  ║              [COMMON口]                  ║    │
 *  │  ╚══════════════════════════════════════════╝    │
 *  │  ┌────────────────────────────────────────────┐  │
 *  │  │  温包剖视：推杆行程 + 蜡膨胀状态            │  │
 *  │  └────────────────────────────────────────────┘  │
 *  │  ┌────────────────────────────────────────────┐  │
 *  │  │  温度计 + 流量分配显示条                    │  │
 *  │  └────────────────────────────────────────────┘  │
 *  │  [设定温度旋钮]  [安装模式]  [当前温度显示]        │
 *  ├──────────────────────────────────────────────────┤
 *  │  管口接头：BYPASS  COMMON  COOLER               │
 *  └──────────────────────────────────────────────────┘
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  port_bypass  — 旁路口（热流旁路 / 绕过冷却器的高温流体）
 *  port_common  — 公共口（混合模式出口 / 分流模式入口）
 *  port_cooler  — 冷却器口（连接冷却器的流体进/出口）
 */
export class WaltonThermostatic extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(220, config.width  || 260);
        this.height = Math.max(300, config.height || 340);

        this.type    = 'walton_thermostatic';
        this.special = 'none';
        this.cache   = 'fixed';

        // ── 铭牌参数 ──────────────────────────────────────────
        this.label      = config.label      || 'TV-101';          // 位号
        this.model      = config.model      || 'WE-100R';         // 型号
        this.boreMM     = config.boreMM     || 100;               // 口径 mm
        this.material   = config.material   || 'Bronze';          // 材质
        this.installMode = config.installMode || 'mixing';        // 'mixing' / 'diverting'

        // ── 整定参数 ──────────────────────────────────────────
        // 设定温度（℃）：温包膨胀起点
        this.setTemp    = Math.max(30, Math.min(95, config.setTemp || 65));
        // 比例带（℃）：从全旁路→全冷却器的温度跨度
        this.propBand   = Math.max(2,  Math.min(15, config.propBand || 6));

        // ── 过程变量 ──────────────────────────────────────────
        // 当前流体温度（℃）
        this._temp      = config.initTemp !== undefined ? config.initTemp : this.setTemp - 3;
        // 转子旋转角（°）：0=全旁路，90=全冷却器
        this._rotorAngle  = 0;
        // 各口流量分配（归一化 0~1）
        this._bypFrac     = 1.0;   // 旁路流量比
        this._cooFrac     = 0.0;   // 冷却器流量比
        // 温包推杆行程（归一化 0~1）
        this._spindlePos  = 0.0;

        // ── 动画状态 ──────────────────────────────────────────
        this._animTime    = 0;
        this._flowPhase   = 0;     // 流体动画相位（0~2π）
        this._waxPhase    = 0;     // 蜡膨胀动画
        this._glowPulse   = 0;
        this._tempVel     = 0;     // 温度变化速率（演示用）
        this._dragging    = null;  // 旋钮拖拽

        // ── 几何布局 ──────────────────────────────────────────
        const W = this.width, H = this.height;

        // 阀体外壳
        this._shell = { x: W*0.05, y: H*0.07, w: W*0.90, h: H*0.87, rx: 8 };

        // 阀体剖视区（上半）
        this._bodyRect = {
            x: W*0.08, y: H*0.11,
            w: W*0.84, h: H*0.34,
        };

        // 转子中心
        this._rotorCx = W * 0.50;
        this._rotorCy = this._bodyRect.y + this._bodyRect.h * 0.48;
        this._rotorR  = Math.min(W, H) * 0.115;

        // 三个管口位置（T形布局）
        //   BYPASS 左，COOLER 右，COMMON 下
        this._portBypass = {
            x: this._bodyRect.x + this._bodyRect.w * 0.10,
            y: this._rotorCy,
        };
        this._portCooler = {
            x: this._bodyRect.x + this._bodyRect.w * 0.90,
            y: this._rotorCy,
        };
        this._portCommon = {
            x: this._rotorCx,
            y: this._bodyRect.y + this._bodyRect.h * 0.88,
        };

        // 温包剖视区
        this._elemRect = {
            x: W*0.08, y: H*0.47,
            w: W*0.84, h: H*0.14,
        };

        // 流量分配显示区
        this._flowRect = {
            x: W*0.08, y: H*0.63,
            w: W*0.84, h: H*0.10,
        };

        // 控制旋钮区
        this._ctrlRect = {
            x: W*0.08, y: H*0.75,
            w: W*0.84, h: H*0.08,
        };
        this._setKnob = {
            x: W*0.22, y: H*0.79,
            r: W*0.055,
        };

        // 管口接头区
        this._pipeRect = {
            x: W*0.08, y: H*0.85,
            w: W*0.84, h: H*0.07,
        };

        this._init();

        // ── 注册端口 ──────────────────────────────────────────
        const pr = this._pipeRect;
        this.addPort(pr.x + pr.w*0.15, H*0.96, 'port_bypass', 'wire', 'BYP');
        this.addPort(pr.x + pr.w*0.50, H*0.96, 'port_common', 'wire', 'COM');
        this.addPort(pr.x + pr.w*0.85, H*0.96, 'port_cooler', 'wire', 'COO');
    }

    // ═══════════════════════════════════════════════════════════
    _clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
    _clamp01(v)        { return this._clamp(v, 0, 1); }
    _lerp(a, b, t)     { return a + (b - a) * t; }

    _init() {
        this._drawShell();
        this._drawBodySection();
        this._drawElementSection();
        this._drawFlowSection();
        this._drawControlSection();
        this._drawPipeSection();
        this._drawTopLabel();
        this._buildDynamic();
        
    }

    // ── 外壳 ─────────────────────────────────────────────────
    _drawShell() {
        const s = this._shell, W = this.width;

        this.group.add(new Konva.Rect({
            x: s.x, y: s.y, width: s.w, height: s.h,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: s.w, y: 0 },
            fillLinearGradientColorStops: [
                0,   '#3d3020',
                0.10,'#6a5030',
                0.50,'#7a6038',
                0.90,'#6a5030',
                1,   '#3d3020',
            ],
            stroke: '#2a1e10', strokeWidth: 1.5,
            cornerRadius: s.rx,
            shadowColor: '#000', shadowBlur: 10,
            shadowOffsetY: 4, shadowOpacity: 0.5,
        }));
        // 顶面高光（金属质感）
        this.group.add(new Konva.Rect({
            x: s.x+3, y: s.y+3, width: s.w-6, height: s.h*0.04,
            fill: 'rgba(255,220,140,0.12)', cornerRadius: [s.rx, s.rx, 0, 0],
        }));
        // 铸造纹理（水平浅线）
        for (let i = 1; i < 8; i++) {
            this.group.add(new Konva.Line({
                points: [s.x+10, s.y+s.h*i/8, s.x+s.w-10, s.y+s.h*i/8],
                stroke: 'rgba(0,0,0,0.08)', strokeWidth: 0.5,
            }));
        }
        // 四角螺栓
        const bR = W*0.020;
        [[s.x+14,s.y+14],[s.x+s.w-14,s.y+14],
         [s.x+14,s.y+s.h-14],[s.x+s.w-14,s.y+s.h-14]].forEach(([x,y])=>{
            this.group.add(new Konva.RegularPolygon({
                x, y, sides:6, radius:bR,
                fill:'#b09060', stroke:'#806040', strokeWidth:0.6, rotation:30,
            }));
            this.group.add(new Konva.Circle({ x, y, radius:bR*0.42, fill:'#6a4820', stroke:'#503010', strokeWidth:0.4 }));
        });
        // 铭牌
        this.group.add(new Konva.Rect({
            x: s.x+s.w-75, y: s.y+s.h-20, width: 70, height: 16,
            fill: '#d0b060', stroke: '#906830', strokeWidth: 0.8, cornerRadius: 2,
        }));
        this.group.add(new Konva.Text({
            x: s.x+s.w-73, y: s.y+s.h-17, width: 66,
            text: 'WALTON ENG.', fontSize: 6.5, fill: '#3a2010',
            fontStyle: 'bold', align: 'center',
        }));
    }

    // ── 阀体剖视区（静态背景）────────────────────────────────
    _drawBodySection() {
        const br = this._bodyRect;
        const cx = this._rotorCx, cy = this._rotorCy, R = this._rotorR;

        // 剖视背景
        this.group.add(new Konva.Rect({
            x: br.x, y: br.y, width: br.w, height: br.h,
            fill: '#0c1018', stroke: '#2a3040', strokeWidth: 1,
            cornerRadius: 4,
        }));

        // 内腔（圆形，容纳转子）
        this.group.add(new Konva.Circle({
            x: cx, y: cy, radius: R * 1.28,
            fill: '#141c28', stroke: '#3a4a5a', strokeWidth: 1.2,
        }));

        // ── 三个管道通道 ──
        const pipeW = R * 0.68;
        const pipeClr = '#1a2435';
        const pipeSt  = '#2e4050';

        // 左侧管道（BYPASS）
        this.group.add(new Konva.Rect({
            x: br.x, y: cy - pipeW/2,
            width: cx - R*1.28 - br.x + 4, height: pipeW,
            fill: pipeClr, stroke: pipeSt, strokeWidth: 0.8,
        }));
        // 右侧管道（COOLER）
        this.group.add(new Konva.Rect({
            x: cx + R*1.28 - 4, y: cy - pipeW/2,
            width: br.x+br.w - (cx+R*1.28) + 4, height: pipeW,
            fill: pipeClr, stroke: pipeSt, strokeWidth: 0.8,
        }));
        // 下侧管道（COMMON）
        this.group.add(new Konva.Rect({
            x: cx - pipeW/2, y: cy + R*1.28 - 4,
            width: pipeW, height: br.y+br.h - (cy+R*1.28) + 4,
            fill: pipeClr, stroke: pipeSt, strokeWidth: 0.8,
        }));

        // ── 管口法兰 ──
        const flangeR = pipeW * 0.62;
        const drawFlange = (x, y, isHoriz) => {
            const fw = isHoriz ? 8 : pipeW + 10;
            const fh = isHoriz ? pipeW + 10 : 8;
            this.group.add(new Konva.Rect({
                x: x - fw/2, y: y - fh/2, width: fw, height: fh,
                fill: '#607080', stroke: '#404858', strokeWidth: 0.8,
                cornerRadius: 1,
            }));
        };
        drawFlange(br.x + 5, cy, true);
        drawFlange(br.x+br.w - 5, cy, true);
        drawFlange(cx, br.y+br.h - 4, false);

        // ── 管口标签 ──
        this.group.add(new Konva.Text({
            x: br.x, y: cy - R*0.36 - 10, width: R*0.90,
            text: 'BYPASS', fontSize: 6.5, fill: '#e8a040',
            fontStyle: 'bold', align: 'center',
        }));
        this.group.add(new Konva.Text({
            x: cx + R*1.28 - 4, y: cy - R*0.36 - 10, width: br.x+br.w - (cx+R*1.28),
            text: 'COOLER', fontSize: 6.5, fill: '#40a0e8',
            fontStyle: 'bold', align: 'center',
        }));
        this.group.add(new Konva.Text({
            x: cx - R*0.55, y: br.y+br.h - 10,
            text: 'COMMON', fontSize: 6.5, fill: '#60d090',
            fontStyle: 'bold', align: 'center', width: R*1.1,
        }));

        // 剖视标题
        this.group.add(new Konva.Text({
            x: br.x + 4, y: br.y + 3,
            text: '— VALVE BODY (CROSS SECTION) —',
            fontSize: 5.5, fill: 'rgba(180,160,100,0.40)',
            fontStyle: 'bold italic',
        }));
    }

    // ── 温包剖视区（静态）────────────────────────────────────
    _drawElementSection() {
        const er = this._elemRect;

        this.group.add(new Konva.Rect({
            x: er.x, y: er.y, width: er.w, height: er.h,
            fill: '#0a0e14', stroke: '#2a3040', strokeWidth: 0.8, cornerRadius: 3,
        }));
        this.group.add(new Konva.Text({
            x: er.x+4, y: er.y+3, text: '— THERMOSTATIC ELEMENT —',
            fontSize: 5.5, fill: 'rgba(220,180,80,0.38)', fontStyle: 'bold italic',
        }));

        // 温包外壳（铜管）
        const ecy = er.y + er.h * 0.55;
        const ex0 = er.x + er.w*0.05;
        const ex1 = er.x + er.w*0.78;
        const eH  = er.h * 0.52;

        this.group.add(new Konva.Rect({
            x: ex0, y: ecy - eH/2, width: ex1-ex0, height: eH,
            fillLinearGradientStartPoint: { x: 0, y: -eH/2 },
            fillLinearGradientEndPoint:   { x: 0, y: eH/2 },
            fillLinearGradientColorStops: [0,'#806040', 0.3,'#c09060', 0.7,'#a07848', 1,'#604828'],
            stroke: '#4a3018', strokeWidth: 0.8, cornerRadius: [3,0,0,3],
        }));
        // 温包端盖
        this.group.add(new Konva.Rect({
            x: ex0-3, y: ecy-eH*0.65, width: 6, height: eH*1.3,
            fill: '#d0a060', stroke: '#806030', strokeWidth: 0.6, cornerRadius: 2,
        }));

        // 蜡填充物内部（静态底色）
        this.group.add(new Konva.Rect({
            x: ex0+2, y: ecy - eH/2+2, width: (ex1-ex0-4)*0.55, height: eH-4,
            fill: '#3a2810', cornerRadius: 1,
        }));

        // 推杆导槽
        this.group.add(new Konva.Rect({
            x: ex1-2, y: ecy-3, width: er.w*0.18, height: 6,
            fill: '#304050', stroke: '#506070', strokeWidth: 0.5, cornerRadius: 1,
        }));

        // 回位弹簧（锯齿线）
        const ssx = ex1 + er.w*0.08;
        const spts = [];
        const sLen = er.w * 0.10;
        const sSeg = 8;
        for (let i = 0; i <= sSeg; i++) {
            const px = ssx + (i/sSeg)*sLen;
            const py = ecy + (i%2===0 ? -5 : 5);
            spts.push(px, py);
        }
        this.group.add(new Konva.Line({
            points: spts, stroke: '#607080', strokeWidth: 1.2,
            lineCap: 'round', lineJoin: 'round',
        }));

        // 参数标注
        this.group.add(new Konva.Text({
            x: er.x+4, y: er.y+er.h-12,
            text: `Set: ${this.setTemp}°C  Band: ±${(this.propBand/2).toFixed(1)}°C  Wax Element`,
            fontSize: 6, fill: '#c0a050', fontStyle: 'italic',
        }));
    }

    // ── 流量分配显示区（静态框）──────────────────────────────
    _drawFlowSection() {
        const fr = this._flowRect;

        this.group.add(new Konva.Rect({
            x: fr.x, y: fr.y, width: fr.w, height: fr.h,
            fill: '#080c12', stroke: '#1e2838', strokeWidth: 0.8, cornerRadius: 3,
        }));
        this.group.add(new Konva.Text({
            x: fr.x+4, y: fr.y+3, text: '— FLOW DISTRIBUTION —',
            fontSize: 5.5, fill: 'rgba(160,200,120,0.38)', fontStyle: 'bold italic',
        }));

        // 三个通道标签（动态条在 _rebuildDynamic 中画）
        const labels = [
            { x: fr.x+fr.w*0.05, label:'BYPASS', color:'#e8a040' },
            { x: fr.x+fr.w*0.38, label:'ROTOR°', color:'#d0c060' },
            { x: fr.x+fr.w*0.70, label:'COOLER', color:'#40a0e8' },
        ];
        labels.forEach(({ x, label, color }) => {
            this.group.add(new Konva.Text({
                x, y: fr.y+fr.h-10, width: fr.w*0.28,
                text: label, fontSize: 5.5, fill: color, align: 'center',
            }));
        });
    }

    // ── 控制旋钮区（静态底层）────────────────────────────────
    _drawControlSection() {
        const cr = this._ctrlRect;
        const W  = this.width;

        this.group.add(new Konva.Rect({
            x: cr.x, y: cr.y, width: cr.w, height: cr.h,
            fill: '#0e1218', stroke: '#2a3040', strokeWidth: 0.6, cornerRadius: 3,
        }));

        // 设定温度旋钮（外环）
        const k = this._setKnob;
        this.group.add(new Konva.Circle({
            x: k.x, y: k.y, radius: k.r * 1.20,
            fill: '#141820', stroke: '#3a4050', strokeWidth: 1,
        }));
        this.group.add(new Konva.Text({
            x: k.x - 24, y: k.y + k.r + 4, width: 48,
            text: 'SET TEMP °C', fontSize: 5.5, fill: '#8090a0',
            align: 'center', fontStyle: 'bold',
        }));

        // 安装模式显示（静态标签，动态文本在 rebuildDynamic 中更新）
        this.group.add(new Konva.Text({
            x: cr.x + cr.w*0.40, y: cr.y + cr.h*0.12,
            text: 'MODE:', fontSize: 6, fill: '#708090', fontStyle: 'bold',
        }));

        // 当前温度标签
        this.group.add(new Konva.Text({
            x: cr.x + cr.w*0.70, y: cr.y + cr.h*0.12,
            text: 'T FLUID:', fontSize: 6, fill: '#708090', fontStyle: 'bold',
        }));
    }

    // ── 管口接头区（静态）────────────────────────────────────
    _drawPipeSection() {
        const pr = this._pipeRect;

        this.group.add(new Konva.Rect({
            x: pr.x, y: pr.y, width: pr.w, height: pr.h,
            fill: '#0c1016', stroke: '#1e2838', strokeWidth: 0.6,
            cornerRadius: [0,0,4,4],
        }));

        const pipes = [
            { frac:0.15, label:'BYPASS', color:'#e8a040' },
            { frac:0.50, label:'COMMON', color:'#60d090' },
            { frac:0.85, label:'COOLER', color:'#40a0e8' },
        ];
        pipes.forEach(({ frac, label, color }) => {
            const px = pr.x + pr.w*frac;
            const py = pr.y + 3;
            // 法兰螺母（六角）
            this.group.add(new Konva.RegularPolygon({
                x: px, y: py + 4, sides:6, radius: 7,
                fill: '#707880', stroke: '#404850', strokeWidth: 0.6, rotation:30,
            }));
            // 管内孔
            this.group.add(new Konva.Circle({
                x: px, y: py + 4, radius: 4,
                fill: '#1a2030', stroke: '#303848', strokeWidth: 0.5,
            }));
            this.group.add(new Konva.Text({
                x: px-16, y: py+12, width: 32,
                text: label, fontSize: 5.5, fill: color, align: 'center',
            }));
        });
    }

    // ── 顶部标注 ──────────────────────────────────────────────
    _drawTopLabel() {
        const W = this.width;
        this.group.add(new Konva.Text({
            x: 0, y: -16, width: W,
            text: `${this.label}  ${this.model}  DN${this.boreMM}  ${this.material}`,
            fontSize: 8.5, fontStyle: 'bold', fill: '#b09060', align: 'center',
        }));
    }

    // ═══════════════════════════════════════════════════════════
    // 动态图层
    // ═══════════════════════════════════════════════════════════
    _buildDynamic() {
        this._dynGroup = new Konva.Group();
        this.group.add(this._dynGroup);
        this._rebuildDynamic();
    }

    _rebuildDynamic() {
        this._dynGroup.destroyChildren();
        this._drawRotor();
        this._drawFlowLines();
        this._drawWaxElement();
        this._drawFlowBars();
        this._drawKnobNeedle();
        this._drawStatusTexts();
        this._drawTempGauge();
    }

    // ── 转子（月牙形流道）────────────────────────────────────
    _drawRotor() {
        const cx = this._rotorCx, cy = this._rotorCy, R = this._rotorR;
        const angle = this._rotorAngle;  // 0=全旁路，90=全冷却器

        // 转子外圆（钢/青铜）
        this._dynGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: R,
            fillRadialGradientStartPoint: { x: -R*0.3, y: -R*0.3 },
            fillRadialGradientStartRadius: 0,
            fillRadialGradientEndPoint:   { x: 0, y: 0 },
            fillRadialGradientEndRadius:  R,
            fillRadialGradientColorStops: [
                0,   '#a09070',
                0.4, '#7a6848',
                0.8, '#5a4830',
                1,   '#3a2a18',
            ],
            stroke: '#2a1e10', strokeWidth: 1.2,
        }));

        // ── 月牙形流道（内孔）──
        // 转子内有一个直通孔，旋转后连通不同的管口
        // 用 Konva.Arc 模拟流道开口（从旋转角度判断哪侧通哪侧）
        const frac = this._bypFrac;   // 旁路流量比

        // 旁路侧开口（左→中心）
        if (frac > 0.02) {
            const arcAng = frac * 80;
            this._dynGroup.add(new Konva.Arc({
                x: cx, y: cy,
                innerRadius: R*0.28, outerRadius: R*0.72,
                angle: arcAng * 1.6,
                rotation: 180 - arcAng * 0.8,
                fill: `rgba(232,160,64,${0.25 + frac*0.45})`,
                stroke: `rgba(232,160,64,${0.5 + frac*0.3})`,
                strokeWidth: 0.6,
            }));
        }

        // 冷却器侧开口（右→中心）
        const cf = this._cooFrac;
        if (cf > 0.02) {
            const arcAng = cf * 80;
            this._dynGroup.add(new Konva.Arc({
                x: cx, y: cy,
                innerRadius: R*0.28, outerRadius: R*0.72,
                angle: arcAng * 1.6,
                rotation: -arcAng * 0.8,
                fill: `rgba(64,160,232,${0.25 + cf*0.45})`,
                stroke: `rgba(64,160,232,${0.5 + cf*0.3})`,
                strokeWidth: 0.6,
            }));
        }

        // 中心公共通道（总是连通 COMMON 口）
        this._dynGroup.add(new Konva.Arc({
            x: cx, y: cy,
            innerRadius: R*0.28, outerRadius: R*0.68,
            angle: 70,
            rotation: 55,
            fill: 'rgba(96,208,144,0.22)',
            stroke: 'rgba(96,208,144,0.50)',
            strokeWidth: 0.6,
        }));

        // 转子分隔叶片（两条径向线，表示固体部分）
        const bladesAngle = [-angle*Math.PI/180, (90-angle)*Math.PI/180 + Math.PI/2];
        bladesAngle.forEach(a => {
            this._dynGroup.add(new Konva.Line({
                points: [
                    cx + Math.cos(a)*R*0.25, cy + Math.sin(a)*R*0.25,
                    cx + Math.cos(a)*R*0.92, cy + Math.sin(a)*R*0.92,
                ],
                stroke: '#5a4030', strokeWidth: 3, lineCap: 'round',
            }));
        });

        // 转子轴心
        this._dynGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: R*0.14,
            fill: '#c0a060', stroke: '#806030', strokeWidth: 0.8,
        }));

        // 转子角度刻度环（外侧）
        for (let i = 0; i <= 9; i++) {
            const a = (i*10 - 90) * Math.PI / 180;
            const tick = i%3===0 ? R*0.14 : R*0.08;
            this._dynGroup.add(new Konva.Line({
                points: [
                    cx+Math.cos(a)*(R*1.18), cy+Math.sin(a)*(R*1.18),
                    cx+Math.cos(a)*(R*1.18+tick), cy+Math.sin(a)*(R*1.18+tick),
                ],
                stroke:'rgba(180,160,100,0.40)', strokeWidth: i%3===0?1:0.5,
            }));
        }

        // 旋转角指示线（指向热膨胀方向）
        const indA = (angle - 90) * Math.PI / 180;
        this._dynGroup.add(new Konva.Arrow({
            points: [cx, cy, cx+Math.cos(indA)*R*1.25, cy+Math.sin(indA)*R*1.25],
            stroke: '#f0d060', fill: '#f0d060',
            strokeWidth: 1.2, pointerLength: 4, pointerWidth: 3,
        }));
    }

    // ── 流体流线动画 ──────────────────────────────────────────
    _drawFlowLines() {
        const cx = this._rotorCx, cy = this._rotorCy, R = this._rotorR;
        const br = this._bodyRect;
        const phase = this._flowPhase;

        const drawFlow = (x0, y0, x1, y1, color, frac) => {
            if (frac < 0.03) return;
            const segments = 5;
            for (let i = 0; i < segments; i++) {
                const t = ((phase * 0.8 + i/segments) % 1.0);
                const alpha = Math.sin(t * Math.PI) * frac * 0.7;
                const px = this._lerp(x0, x1, t);
                const py = this._lerp(y0, y1, t);
                const dotR = 2.5 * frac;
                this._dynGroup.add(new Konva.Circle({
                    x: px, y: py, radius: dotR,
                    fill: color.replace(')', `,${alpha})`).replace('rgb','rgba'),
                    listening: false,
                }));
            }
        };

        // 旁路流（左 → 转子）
        drawFlow(
            br.x + 8, cy,
            cx - R*1.28, cy,
            'rgb(232,160,64)', this._bypFrac
        );
        // 冷却器流（右 → 转子）
        drawFlow(
            br.x+br.w-8, cy,
            cx + R*1.28, cy,
            'rgb(64,160,232)', this._cooFrac
        );
        // 公共出口流（转子 → 下）
        drawFlow(
            cx, cy+R*1.28,
            cx, br.y+br.h-6,
            'rgb(96,208,144)', 1.0
        );
    }

    // ── 蜡温包动态（推杆行程）────────────────────────────────
    _drawWaxElement() {
        const er = this._elemRect;
        const ecy = er.y + er.h * 0.55;
        const eH  = er.h * 0.52;
        const ex0 = er.x + er.w*0.05;
        const maxWaxLen = (er.x + er.w*0.78 - ex0 - 4) * 0.55;

        // 蜡膨胀填充动态层
        const waxLen = maxWaxLen * (0.3 + this._spindlePos * 0.70);
        const r = Math.floor(80 + this._spindlePos*120);
        const g = Math.floor(60 + this._spindlePos*40);
        const b = 20;
        this._dynGroup.add(new Konva.Rect({
            x: ex0+2, y: ecy - eH/2+2, width: waxLen, height: eH-4,
            fill: `rgb(${r},${g},${b})`,
            cornerRadius: 1,
        }));

        // 蜡液化闪光（高温时随机气泡效果）
        if (this._spindlePos > 0.3) {
            const bubbleCount = Math.floor(this._spindlePos * 4);
            for (let i = 0; i < bubbleCount; i++) {
                const bx = ex0 + 4 + Math.sin(this._waxPhase*2.1 + i*1.7) * waxLen * 0.4 + waxLen*0.3;
                const by = ecy + Math.cos(this._waxPhase*1.8 + i*2.3) * (eH/2 - 4) * 0.6;
                this._dynGroup.add(new Konva.Circle({
                    x: bx, y: by, radius: 1.5 + Math.random()*1.5,
                    fill: `rgba(255,180,60,${0.3 + this._spindlePos*0.3})`,
                }));
            }
        }

        // 推杆动态位置
        const spindleX = er.x + er.w*0.78 + this._spindlePos * er.w*0.13;
        this._dynGroup.add(new Konva.Rect({
            x: er.x+er.w*0.78, y: ecy-2.5,
            width: spindleX - (er.x+er.w*0.78), height: 5,
            fill: '#b0c0d0', stroke: '#607080', strokeWidth: 0.5, cornerRadius: 1,
        }));

        // 推杆顶端
        this._dynGroup.add(new Konva.Circle({
            x: spindleX, y: ecy, radius: 4,
            fill: '#d0e0f0', stroke: '#7090a0', strokeWidth: 0.8,
        }));

        // 行程百分比
        this._dynGroup.add(new Konva.Text({
            x: er.x + er.w*0.82, y: ecy - 8, width: 30,
            text: `${Math.round(this._spindlePos*100)}%`,
            fontSize: 6.5, fill: '#f0d060', align: 'center', fontStyle: 'bold',
        }));
    }

    // ── 流量分配进度条 ────────────────────────────────────────
    _drawFlowBars() {
        const fr = this._flowRect;
        const barH = fr.h * 0.40;
        const barY = fr.y + fr.h * 0.20;

        const bars = [
            { x: fr.x+fr.w*0.03, w: fr.w*0.28, frac: this._bypFrac, color: '#e8a040', label: `${Math.round(this._bypFrac*100)}%` },
            { x: fr.x+fr.w*0.36, w: fr.w*0.28, frac: this._rotorAngle/90, color: '#d0c060', label: `${Math.round(this._rotorAngle)}°` },
            { x: fr.x+fr.w*0.68, w: fr.w*0.28, frac: this._cooFrac, color: '#40a0e8', label: `${Math.round(this._cooFrac*100)}%` },
        ];

        bars.forEach(({ x, w, frac, color, label }) => {
            // 背景轨道
            this._dynGroup.add(new Konva.Rect({
                x, y: barY, width: w, height: barH,
                fill: 'rgba(0,0,0,0.40)', stroke: '#2a3040',
                strokeWidth: 0.5, cornerRadius: 2,
            }));
            // 填充
            this._dynGroup.add(new Konva.Rect({
                x, y: barY, width: w * frac, height: barH,
                fill: color, opacity: 0.75, cornerRadius: 2,
            }));
            // 数值
            this._dynGroup.add(new Konva.Text({
                x: x, y: barY + barH + 1, width: w,
                text: label, fontSize: 6.5, fill: color,
                align: 'center', fontStyle: 'bold',
            }));
        });
    }

    // ── 设定旋钮动态（指针线）────────────────────────────────
    _drawKnobNeedle() {
        const k = this._setKnob;
        const frac = (this.setTemp - 30) / (95 - 30);
        const angleRad = (-150 + frac * 300) * Math.PI / 180;
        const r = k.r;

        // 旋钮主体
        this._dynGroup.add(new Konva.Circle({
            x: k.x, y: k.y, radius: r,
            fillRadialGradientStartPoint: { x:-r*0.3, y:-r*0.3 },
            fillRadialGradientStartRadius: 0,
            fillRadialGradientEndPoint:   { x:0, y:0 },
            fillRadialGradientEndRadius:  r,
            fillRadialGradientColorStops: [0,'#9a8060', 0.6,'#6a5040', 1,'#3a2a18'],
            stroke: '#2a1e10', strokeWidth: 0.8,
        }));

        // 刻度圈
        for (let i = 0; i <= 12; i++) {
            const a = (-150 + i*25) * Math.PI / 180;
            const tick = i%3===0 ? r*0.25 : r*0.14;
            this._dynGroup.add(new Konva.Line({
                points: [
                    k.x+Math.cos(a)*(r*0.82), k.y+Math.sin(a)*(r*0.82),
                    k.x+Math.cos(a)*(r*0.82-tick), k.y+Math.sin(a)*(r*0.82-tick),
                ],
                stroke:'rgba(220,180,80,0.40)', strokeWidth: i%3===0?1:0.5,
            }));
        }

        // 指针
        this._dynGroup.add(new Konva.Line({
            points: [
                k.x+Math.cos(angleRad)*r*0.28, k.y+Math.sin(angleRad)*r*0.28,
                k.x+Math.cos(angleRad)*r*0.80, k.y+Math.sin(angleRad)*r*0.80,
            ],
            stroke: '#f0e060', strokeWidth: 1.8, lineCap: 'round',
        }));

        // 数值
        this._dynGroup.add(new Konva.Text({
            x: k.x-16, y: k.y-6, width: 32,
            text: `${this.setTemp}°C`,
            fontSize: 7, fill: '#f0e060', align: 'center', fontStyle: 'bold',
        }));
    }

    // ── 状态文本（模式 + 当前温度）────────────────────────────
    _drawStatusTexts() {
        const cr = this._ctrlRect;

        const modeColor = this.installMode === 'mixing' ? '#60d090' : '#d090d0';
        this._dynGroup.add(new Konva.Text({
            x: cr.x + cr.w*0.46, y: cr.y + cr.h*0.38,
            text: this.installMode === 'mixing' ? 'MIXING ▼' : 'DIVERT ▲',
            fontSize: 7.5, fill: modeColor, fontStyle: 'bold',
        }));

        const tempColor = this._temp > this.setTemp + this.propBand/2 ? '#ff6060'
            : this._temp < this.setTemp - this.propBand/2 ? '#60b0ff' : '#80ff80';
        this._dynGroup.add(new Konva.Text({
            x: cr.x + cr.w*0.73, y: cr.y + cr.h*0.35,
            text: `${this._temp.toFixed(1)}°C`,
            fontSize: 8.5, fill: tempColor, fontStyle: 'bold',
        }));
    }

    // ── 温度计（竖向迷你）────────────────────────────────────
    _drawTempGauge() {
        const cr  = this._ctrlRect;
        const gx  = cr.x + cr.w * 0.82;
        const gy  = cr.y + cr.h * 0.08;
        const gH  = cr.h * 0.75;
        const gW  = 8;

        // 外框
        this._dynGroup.add(new Konva.Rect({
            x: gx, y: gy, width: gW, height: gH,
            fill: '#0a0e14', stroke: '#3a4a5a', strokeWidth: 0.6, cornerRadius: 3,
        }));

        // 填充（温度比例）
        const frac = this._clamp01((this._temp - 20) / (this.setTemp + 20 - 20));
        const fillH = gH * 0.90 * frac;
        const r = Math.floor(60 + frac * 200);
        const g = Math.floor(120 - frac * 80);
        const b = Math.floor(200 - frac * 180);

        this._dynGroup.add(new Konva.Rect({
            x: gx+1.5, y: gy + gH*0.90 - fillH + gH*0.05,
            width: gW-3, height: fillH,
            fill: `rgb(${r},${g},${b})`, cornerRadius: 2,
        }));

        // 设定点刻度线
        const spFrac = this._clamp01((this.setTemp - 20) / (this.setTemp + 20 - 20));
        const spY = gy + gH*0.90 - gH*0.90*spFrac + gH*0.05;
        this._dynGroup.add(new Konva.Line({
            points: [gx-3, spY, gx+gW+3, spY],
            stroke: '#f0e060', strokeWidth: 1, dash:[2,2],
        }));
    }

    // ═══════════════════════════════════════════════════════════
    // 动画循环
    // ═══════════════════════════════════════════════════════════
    // 集中化 tick（由 consys._tickAll 在 20fps 调用）
    tick(dt) {
        this._tickAnimation(dt);
    }
    _tickAnimation(dt) {
        this._animTime  += dt;
        this._flowPhase  = (this._flowPhase + dt * 0.8) % 1.0;
        this._waxPhase  += dt * 1.5;
        this._glowPulse  = 0.5 + 0.5 * Math.sin(this._animTime * 2.5);

        // ── 温包响应：温度→推杆行程（一阶滞后，τ=3s）──
        const tLo = this.setTemp - this.propBand / 2;
        const tHi = this.setTemp + this.propBand / 2;
        let targetSpindle;
        if (this._temp <= tLo)      targetSpindle = 0;
        else if (this._temp >= tHi) targetSpindle = 1;
        else                        targetSpindle = (this._temp - tLo) / (tHi - tLo);

        this._spindlePos += (targetSpindle - this._spindlePos) * Math.min(1, dt / 3.0);

        // ── 转子角度跟随推杆（机械延迟，τ=0.5s）──
        const targetAngle = this._spindlePos * 90;
        this._rotorAngle  += (targetAngle - this._rotorAngle) * Math.min(1, dt / 0.5);

        // ── 流量分配（线性比例）──
        this._cooFrac = this._clamp01(this._rotorAngle / 90);
        this._bypFrac = 1 - this._cooFrac;

        this._rebuildDynamic();
        this._refreshCache();
    }

    // ── 交互绑定 ──────────────────────────────────────────────
    _bindInteraction() {
        // 设定温度旋钮拖拽
        const k = this._setKnob;
        const hitKnob = new Konva.Circle({
            x: k.x, y: k.y, radius: k.r * 1.2,
            fill: 'transparent', listening: true,
        });
        this._dynGroup.add(hitKnob);
        hitKnob.on('mousedown touchstart', (e) => {
            const y = e.evt.type === 'touchstart' ? e.evt.touches[0].clientY : e.evt.clientY;
            this._dragging = { key: 'setTemp', startY: y, startVal: this.setTemp };
            e.cancelBubble = true;
        });

        const onMove = (e) => {
            if (!this._dragging) return;
            const curY = e.type === 'touchmove' ? e.touches[0].clientY : e.clientY;
            const dy   = this._dragging.startY - curY;
            this.setTemp = this._clamp(this._dragging.startVal + dy * 0.5, 30, 95);
            this.setTemp = Math.round(this.setTemp);
            this._refreshCache();
        };
        const onUp = () => { this._dragging = null; };
        if (typeof window !== 'undefined') {
            window.addEventListener('mousemove', onMove);
            window.addEventListener('mouseup',   onUp);
            window.addEventListener('touchmove', onMove, { passive: true });
            window.addEventListener('touchend',  onUp);
        }

        // 点击模式区域切换 mixing/diverting
        const cr = this._ctrlRect;
        const modeHit = new Konva.Rect({
            x: cr.x + cr.w*0.38, y: cr.y,
            width: cr.w*0.26, height: cr.h,
            fill: 'transparent', listening: true,
        });
        this.group.add(modeHit);
        modeHit.on('click tap', () => {
            this.installMode = this.installMode === 'mixing' ? 'diverting' : 'mixing';
            this._refreshCache();
        });
    }

    // ═══════════════════════════════════════════════════════════
    // 公开 API
    // ═══════════════════════════════════════════════════════════

    /** 设置流体温度（°C） */
    setFluidTemp(temp) {
        this._temp = temp;
        this._refreshCache();
    }

    /** 读取当前流体温度 */
    getFluidTemp() { return this._temp; }

    /** 读取旁路流量比（0~1） */
    getBypassFraction() { return this._bypFrac; }

    /** 读取冷却器流量比（0~1） */
    getCoolerFraction() { return this._cooFrac; }

    /** 读取转子角度（0~90°） */
    getRotorAngle() { return this._rotorAngle; }

    /** 读取温包推杆行程（0~1） */
    getSpindlePosition() { return this._spindlePos; }

    update(state) {
        if (typeof state === 'object' && state !== null) {
            if (state.temp    !== undefined) this._temp       = parseFloat(state.temp);
            if (state.setTemp !== undefined) this.setTemp     = parseFloat(state.setTemp);
            if (state.mode    !== undefined) this.installMode = state.mode;
        } else if (typeof state === 'number') {
            this._temp = state;
        }
        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label: '位号',           key: 'label',        type: 'text'   },
            { label: '型号',           key: 'model',        type: 'text'   },
            { label: '口径 (mm)',      key: 'boreMM',       type: 'number' },
            { label: '材质',           key: 'material',     type: 'text'   },
            { label: '整定温度 (°C)',  key: 'setTemp',      type: 'number' },
            { label: '比例带 (°C)',    key: 'propBand',     type: 'number' },
            { label: '安装模式',       key: 'installMode',  type: 'text'   },
            { label: '初始温度 (°C)', key: 'initTemp',      type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label)       this.label       = cfg.label;
        if (cfg.model)       this.model       = cfg.model;
        if (cfg.boreMM     !== undefined) this.boreMM    = parseInt(cfg.boreMM);
        if (cfg.material)    this.material    = cfg.material;
        if (cfg.setTemp    !== undefined) this.setTemp   = this._clamp(parseFloat(cfg.setTemp), 30, 95);
        if (cfg.propBand   !== undefined) this.propBand  = this._clamp(parseFloat(cfg.propBand), 2, 15);
        if (cfg.installMode) this.installMode = cfg.installMode;
        if (cfg.initTemp   !== undefined) this._temp     = parseFloat(cfg.initTemp);
        this.config = { ...this.config, ...cfg };
        this._refreshCache();
    }

    destroy() {
        super.destroy?.();
    }
}