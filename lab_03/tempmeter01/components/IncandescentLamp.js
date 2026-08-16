import { BaseComponent } from './BaseComponent.js';

/**
 * 白炽灯仿真组件
 * （Incandescent Lamp / Incandescent Bulb）
 *
 * ── 工作原理 ──────────────────────────────────────────────────
 *
 *  白炽灯是利用电流热效应发光的热辐射光源：
 *
 *  1. 灯丝加热原理（焦耳效应）：
 *     通电后，电流流过钨丝（灯丝），产生焦耳热：
 *       P = I² × R = U² / R = U × I
 *     钨丝温度急剧升高，至 2200~3400 K 时发出可见光。
 *     钨丝在高温下的电阻随温度升高而增大（正温度系数 PTC）：
 *       R(T) = R₀ × (1 + α×(T - T₀))
 *       α_钨 ≈ 0.0045 /°C（电阻温度系数）
 *     冷态电阻约为热态的 1/8 ~ 1/12，因此开灯瞬间冲击电流较大。
 *
 *  2. 热辐射（黑体辐射）：
 *     灯丝辐射光谱由普朗克黑体辐射定律决定：
 *       峰值波长 λ_max = 2898 μm·K / T（维恩位移定律）
 *     2800K 时峰值约 1035nm（近红外），可见光效率约 10~15%，
 *     其余 85~90% 以红外热辐射散失 → 效率低是白炽灯的主要缺点。
 *     色温：2700~3000K（暖白），显色指数 Ra ≈ 100（最佳显色性）。
 *
 *  3. 灯泡结构：
 *     ① 玻璃泡壳：内充惰性气体（氩气+少量氮气）或真空，防止钨丝氧化
 *     ② 钨丝灯丝：双螺旋结构，减小热辐射损失，延长寿命
 *     ③ 导丝（导入线）：Mo 钼丝，从泡壳穿过到灯丝
 *     ④ 玻璃芯柱（芯杆）：固定灯丝和导丝
 *     ⑤ 铝制灯头（E27/E14）：螺口或插口，电气连接
 *
 *  4. 寿命与失效：
 *     额定寿命约 1000 小时（白炽灯）/ 2000h（卤钨灯）
 *     失效原因：钨蒸发→灯丝变细→断路；或玻璃发黑（钨沉积）
 *
 *  5. 仿真功能：
 *     - 通电/断电状态切换
 *     - 灯丝从冷态到热态的温度暂态过程（约 100~200ms）
 *     - 光晕（Halo）亮度随电压变化
 *     - 闪烁效果（电压波动仿真，约 ±2%）
 *     - 色温随功率变化（低压偏红，满压暖白）
 *     - 灯泡玻璃磨砂/透明两种外观
 *     - 累计工作时间与寿命百分比显示
 *
 * ── 组件结构 ──────────────────────────────────────────────────
 *  ① 灯泡玻璃泡壳（梨形轮廓，含磨砂/透明渐变）
 *  ② 钨丝灯丝（双螺旋线圈，随温度变色：冷灰→橙红→亮黄白）
 *  ③ 芯杆+导丝结构（玻璃芯杆，铜/钼导线）
 *  ④ 铝制灯头（E27 螺纹头，银灰色）
 *  ⑤ 光晕发光效果（径向渐变，随亮度变化）
 *  ⑥ 灯丝温度暂态动画（通断电时的热/冷却过程）
 *  ⑦ 参数仪表（电压/电流/功率/色温/亮度/寿命）
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  terminal_a — A 端（灯头顶部接线端，一般接相线）
 *  terminal_b — B 端（灯头侧面螺纹，一般接零线）
 */
export class IncandescentLamp extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(100, config.width  || 130);
        this.height = Math.max(160, config.height || 200);

        this.type    = 'incandescent_lamp';
        this.special = 'none';
        this.cache   = 'fixed';

        // ── 额定参数 ──
        this.ratedVoltage = config.ratedVoltage || 220;   // V
        this.ratedPower   = config.ratedPower   || 60;    // W
        this.ratedLife    = config.ratedLife    || 1000;  // h（额定寿命）
        this.label        = config.label        || 'EL';  // 位号
        this.bulbType     = config.bulbType     || 'frosted'; // 'frosted'（磨砂）| 'clear'（透明）

        // ── 电气参数（热态）──
        this.R_hot  = this.ratedVoltage ** 2 / this.ratedPower;  // Ω（热态电阻）
        this.R_cold = this.R_hot / 10;   // Ω（冷态电阻，约 1/10）
        this.alpha  = 0.0045;            // /°C（钨丝电阻温度系数）
        this.T_cold = 20;                // °C（冷态温度）
        this.T_hot  = 2800;             // °C（额定热态温度）

        // 时间常数：热态建立约 150ms（一阶热模型）
        this.thermalTau = config.thermalTau || 0.15;     // s（热时间常数）
        // 冷却时间常数略长
        this.coolTau    = config.coolTau    || 0.30;     // s（冷却时间常数）

        // ── 运行状态 ──
        this._powered      = false;       // 是否通电
        this._tempNorm     = 0;           // 归一化温度（0=冷态，1=热态）
        this._flickerPhase = 0;           // 闪烁相位
        this._usedHours    = config.initHours || 0;  // 已用小时数
        this._lifeRate     = this._usedHours / this.ratedLife; // 寿命消耗比

        // 应用电压（可调，模拟欠压/过压）
        this._appliedVoltage = config.initVoltage || this.ratedVoltage;

        // 实时电气量
        this.voltage    = 0;
        this.current    = 0;
        this.power      = 0;
        this.resistance = this.R_cold;
        this.colorTemp  = 2700;  // K
        this.brightness = 0;     // 0~1

        // 累计时间（仿真时间，加速：1s仿真 = 1s实际）
        this._simTime = 0;

        // ── 几何 ──
        const W = this.width, H = this.height;

        // 泡壳中心
        this._bulbCX   = W / 2;
        this._bulbCY   = H * 0.38;
        this._bulbR    = W * 0.40;   // 球形半径

        // 灯头
        this._baseY    = H * 0.70;
        this._baseH    = H * 0.22;
        this._baseW    = W * 0.44;


        this._init();

        // 端口
        this.addPort(W/2, H + 6, 'terminal_a', 'wire', 'A');
        this.addPort(W/2 + this._baseW*0.5, this._baseY + this._baseH*0.5, 'terminal_b', 'wire', 'B');
    }

    // ═══════════════════════════════════════════
    _init() {
        this._drawHaloLayer();        // 底层光晕（在灯泡下方）
        this._drawBulb();             // 泡壳
        this._drawFilamentSupport();  // 芯杆 + 导丝
        this._drawFilamentLayer();    // 灯丝（动态层）
        this._drawBase();             // 灯头
        this._drawLabel();
        this._drawInfoPanel();
        this._bindClick();
        
    }

    // ── 光晕层（最底层） ─────────────────────
    _drawHaloLayer() {
        this._haloGroup = new Konva.Group({ opacity: 0 });

        // 外层大光晕
        this._haloOuter = new Konva.Circle({
            x: this._bulbCX, y: this._bulbCY,
            radius: this._bulbR * 2.2,
            fillRadialGradientStartPoint: { x: 0, y: 0 },
            fillRadialGradientEndPoint:   { x: 0, y: 0 },
            fillRadialGradientStartRadius: 0,
            fillRadialGradientEndRadius:   this._bulbR * 2.2,
            fillRadialGradientColorStops:  [
                0,   'rgba(255,230,140,0.35)',
                0.4, 'rgba(255,200,80,0.18)',
                0.7, 'rgba(255,180,60,0.07)',
                1,   'rgba(255,160,40,0)',
            ],
        });

        // 内层光晕
        this._haloInner = new Konva.Circle({
            x: this._bulbCX, y: this._bulbCY,
            radius: this._bulbR * 1.15,
            fillRadialGradientStartPoint: { x: 0, y: 0 },
            fillRadialGradientEndPoint:   { x: 0, y: 0 },
            fillRadialGradientStartRadius: 0,
            fillRadialGradientEndRadius:   this._bulbR * 1.15,
            fillRadialGradientColorStops:  [
                0,   'rgba(255,255,210,0.55)',
                0.6, 'rgba(255,220,120,0.20)',
                1,   'rgba(255,200,80,0)',
            ],
        });

        this._haloGroup.add(this._haloOuter, this._haloInner);
        this.group.add(this._haloGroup);
    }

    // ── 玻璃泡壳 ─────────────────────────────
    _drawBulb() {
        const cx = this._bulbCX, cy = this._bulbCY, r = this._bulbR;

        // 泡壳主体（梨形：上方球形 + 下方收窄颈部）
        // 用贝塞尔曲线近似梨形轮廓
        const neckW  = this._baseW * 0.75;
        const neckY  = this._baseY - 2;
        const topY   = cy - r * 1.02;

        this._bulbPath = new Konva.Path({
            data: `
                M ${cx - neckW/2} ${neckY}
                C ${cx - neckW/2} ${neckY - r*0.55},
                  ${cx - r*0.95}  ${neckY - r*0.85},
                  ${cx - r*0.85}  ${cy}
                C ${cx - r*1.02} ${cy + r*0.20},
                  ${cx - r*1.02} ${cy - r*0.20},
                  ${cx - r*0.98} ${cy - r*0.50}
                C ${cx - r*0.88} ${topY + r*0.08},
                  ${cx - r*0.30} ${topY},
                  ${cx}          ${topY}
                C ${cx + r*0.30} ${topY},
                  ${cx + r*0.88} ${topY + r*0.08},
                  ${cx + r*0.98} ${cy - r*0.50}
                C ${cx + r*1.02} ${cy - r*0.20},
                  ${cx + r*1.02} ${cy + r*0.20},
                  ${cx + r*0.85} ${cy}
                C ${cx + r*0.95}  ${neckY - r*0.85},
                  ${cx + neckW/2} ${neckY - r*0.55},
                  ${cx + neckW/2} ${neckY}
                Z
            `,
            fill: this._getBulbFill(),
            stroke: 'rgba(180,220,255,0.55)',
            strokeWidth: 1.0,
        });

        // 泡壳高光（左上方弧形反光）
        this._bulbHL1 = new Konva.Path({
            data: `
                M ${cx - r*0.55} ${cy - r*0.70}
                C ${cx - r*0.68} ${cy - r*0.90},
                  ${cx - r*0.30} ${cy - r*0.98},
                  ${cx - r*0.05} ${cy - r*0.92}
                C ${cx + r*0.10} ${cy - r*0.88},
                  ${cx - r*0.42} ${cy - r*0.62},
                  ${cx - r*0.55} ${cy - r*0.70}
                Z
            `,
            fill: 'rgba(255,255,255,0.20)',
            stroke: 'none',
        });

        // 小高光点
        this._bulbHL2 = new Konva.Ellipse({
            x: cx - r*0.52, y: cy - r*0.72,
            radiusX: r*0.06, radiusY: r*0.09,
            fill: 'rgba(255,255,255,0.35)',
            rotation: -25,
        });

        // 灯泡通光效果层（通电时内部发光）
        this._bulbGlow = new Konva.Path({
            data: this._bulbPath.data(),
            fillRadialGradientStartPoint: { x: 0, y: 0 },
            fillRadialGradientEndPoint:   { x: 0, y: 0 },
            fillRadialGradientStartRadius: 0,
            fillRadialGradientEndRadius:   r * 0.9,
            fillRadialGradientColorStops:  [
                0,   'rgba(255,240,180,0)',
                0.5, 'rgba(255,220,120,0)',
                1,   'rgba(255,200,80,0)',
            ],
            listening: false,
            // 注意：径向渐变原点需通过 offset 设置到圆心位置
        });

        // 颈部（收窄段，单独绘制更清晰）
        this._neckRect = new Konva.Rect({
            x: cx - neckW/2, y: neckY - 4,
            width: neckW, height: 8,
            fill: this.bulbType === 'frosted'
                ? 'rgba(210,230,255,0.65)'
                : 'rgba(200,230,255,0.45)',
            stroke: 'rgba(160,200,240,0.4)',
            strokeWidth: 0.5,
        });

        this.group.add(this._bulbPath, this._bulbGlow, this._neckRect, this._bulbHL1, this._bulbHL2);
        this._neckY  = neckY;
        this._neckW  = neckW;
    }

    _getBulbFill() {
        if (this.bulbType === 'frosted') {
            return 'rgba(225,238,255,0.72)';
        } else {
            return 'rgba(200,228,255,0.38)';
        }
    }

    // ── 芯杆 + 导丝结构 ──────────────────────
    _drawFilamentSupport() {
        const cx = this._bulbCX, cy = this._bulbCY;
        const r  = this._bulbR;
        const neckY = this._neckY;

        // 玻璃芯杆（竖立在灯泡中央，从颈部向上）
        const stemH = r * 0.75;
        const stemW = r * 0.08;
        const stemY = neckY - stemH;

        this.group.add(new Konva.Rect({
            x: cx - stemW/2, y: stemY,
            width: stemW, height: stemH,
            fill: 'rgba(200,230,255,0.55)',
            stroke: 'rgba(160,200,230,0.40)',
            strokeWidth: 0.5,
            cornerRadius: 1,
        }));

        // 灯丝支撑钩（芯杆顶端横向支撑架）
        const hookY = stemY + stemH * 0.08;
        const hookW = r * 0.45;
        // 左支撑
        this.group.add(new Konva.Line({
            points: [cx - stemW/2, hookY, cx - hookW, hookY - r*0.12],
            stroke: 'rgba(160,190,220,0.55)', strokeWidth: 1.2, lineCap: 'round',
        }));
        // 右支撑
        this.group.add(new Konva.Line({
            points: [cx + stemW/2, hookY, cx + hookW, hookY - r*0.12],
            stroke: 'rgba(160,190,220,0.55)', strokeWidth: 1.2, lineCap: 'round',
        }));

        // 导线（左右各一根，从颈部向上进入芯杆）
        const wireCol = 'rgba(180,160,100,0.70)';
        this.group.add(new Konva.Line({
            points: [
                cx - stemW*1.8, neckY,
                cx - stemW*1.8, stemY + stemH*0.55,
                cx - hookW,     hookY - r*0.12,
            ],
            stroke: wireCol, strokeWidth: 1, lineCap: 'round', lineJoin: 'round',
        }));
        this.group.add(new Konva.Line({
            points: [
                cx + stemW*1.8, neckY,
                cx + stemW*1.8, stemY + stemH*0.55,
                cx + hookW,     hookY - r*0.12,
            ],
            stroke: wireCol, strokeWidth: 1, lineCap: 'round', lineJoin: 'round',
        }));

        // 保存灯丝锚点坐标
        this._filAnchorL = { x: cx - hookW, y: hookY - r*0.12 };
        this._filAnchorR = { x: cx + hookW, y: hookY - r*0.12 };
        this._filTopY    = hookY - r*0.32;
    }

    // ── 灯丝动态层 ───────────────────────────
    _drawFilamentLayer() {
        this._filamentGroup = new Konva.Group();
        this.group.add(this._filamentGroup);
        this._rebuildFilament();
    }

    _rebuildFilament() {
        this._filamentGroup.destroyChildren();

        const T = this._tempNorm;   // 0~1
        const aL = this._filAnchorL, aR = this._filAnchorR;
        const cx = this._bulbCX;
        const topY = this._filTopY;

        // 灯丝颜色（冷态→热态渐变）
        // 冷：灰白 #aaa → 暖橙 #ff6010 → 亮橙黄 #ffb020 → 亮黄白 #fff0a0
        const filColor = this._getFilamentColor(T);
        const filGlow  = this._getFilamentGlow(T);
        const filW     = 1.5 + T * 0.5;   // 热态时视觉上略粗（发光）

        // 双螺旋灯丝（简化为锯齿折线，模拟螺旋线圈）
        const nCoils = 10;  // 螺旋圈数（显示用）
        const filW2  = aR.x - aL.x;  // 灯丝水平跨度
        const filH   = (aL.y - topY) * 0.85;  // 灯丝竖向高度

        // 主螺旋（下层）
        const pts1 = this._buildSpiralPoints(
            aL.x, aL.y, aR.x, aL.y, topY + filH*0.30, nCoils
        );
        // 副螺旋（上层，偏移半个周期）
        const pts2 = this._buildSpiralPoints(
            aL.x + filW2/(nCoils*2), aL.y - filH*0.25,
            aR.x - filW2/(nCoils*2), aL.y - filH*0.25,
            topY + filH*0.05, nCoils - 1
        );

        // 灯丝光晕（热态时，模糊发光）
        if (T > 0.15) {
            [pts1, pts2].forEach(pts => {
                this._filamentGroup.add(new Konva.Line({
                    points: pts,
                    stroke: filGlow,
                    strokeWidth: filW + 5 + T*8,
                    lineJoin: 'round', lineCap: 'round',
                    opacity: T * 0.35,
                }));
            });
        }

        // 灯丝主线
        [pts1, pts2].forEach(pts => {
            this._filamentGroup.add(new Konva.Line({
                points: pts,
                stroke: filColor,
                strokeWidth: filW,
                lineJoin: 'round', lineCap: 'round',
            }));
        });

        // 连接线（从锚点到螺旋端点）
        [aL, aR].forEach(a => {
            this._filamentGroup.add(new Konva.Line({
                points: [a.x, a.y, a.x, a.y - (a.y - (topY + filH*0.30))*0.05],
                stroke: filColor, strokeWidth: filW, lineCap: 'round',
            }));
        });
    }

    // 构建螺旋锯齿折线点数组
    _buildSpiralPoints(x1, y1, x2, y2, yTop, nCoils) {
        const pts = [];
        const totalPts = nCoils * 4;  // 每圈 4 个点
        for (let i = 0; i <= totalPts; i++) {
            const t  = i / totalPts;
            const x  = x1 + (x2-x1)*t;
            // y：在 y1 和 yTop 之间 zigzag，整体从 y1 抛物线收向顶部再展开
            const yMid  = yTop + (y1-yTop)*Math.abs(Math.sin(t*Math.PI));
            const zigzag= Math.sin(i * Math.PI / 2) * (y1-yTop)*0.12;
            pts.push(x, yMid + zigzag);
        }
        return pts;
    }

    _getFilamentColor(T) {
        if (T < 0.01) return '#888888';
        if (T < 0.30) {
            const r = Math.round(136 + (255-136)*T/0.30);
            const g = Math.round(0   + 96*T/0.30);
            const b = 0;
            return `rgb(${r},${g},${b})`;
        }
        if (T < 0.65) {
            const t2= (T-0.30)/0.35;
            const r = 255;
            const g = Math.round(96 + (176-96)*t2);
            const b = 0;
            return `rgb(${r},${g},${b})`;
        }
        // T → 1: 亮橙黄 → 亮黄白
        const t3= (T-0.65)/0.35;
        const r = 255;
        const g = Math.round(176 + (240-176)*t3);
        const b = Math.round(0   + 160*t3);
        return `rgb(${r},${g},${b})`;
    }

    _getFilamentGlow(T) {
        if (T < 0.3) return `rgba(255,60,0,${T*0.6})`;
        if (T < 0.7) return `rgba(255,140,20,${0.18+T*0.25})`;
        return `rgba(255,220,120,${0.30+T*0.20})`;
    }

    // ── 灯头（E27 螺纹头）────────────────────
    _drawBase() {
        const cx  = this._bulbCX;
        const by  = this._baseY;
        const bh  = this._baseH;
        const bw  = this._baseW;
        const nw  = this._neckW;

        // 灯头主体（铝质，银灰色渐变）
        this.group.add(new Konva.Rect({
            x: cx - bw/2, y: by,
            width: bw, height: bh,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: bw, y: 0 },
            fillLinearGradientColorStops: [
                0,   '#5a5a5a',
                0.20,'#9a9a9a',
                0.50,'#c8c8c8',
                0.75,'#9a9a9a',
                1,   '#5a5a5a',
            ],
            stroke: '#444', strokeWidth: 0.8,
            cornerRadius: [0, 0, 3, 3],
        }));

        // 螺纹纹路（横向线条）
        const nThreads = 7;
        for (let i = 0; i < nThreads; i++) {
            const ty = by + (i+1)*(bh*0.82)/(nThreads+1);
            this.group.add(new Konva.Line({
                points: [cx-bw/2+2, ty, cx+bw/2-2, ty],
                stroke: 'rgba(0,0,0,0.22)', strokeWidth: 0.9,
            }));
        }

        // 灯头顶部连接环（与颈部衔接）
        this.group.add(new Konva.Rect({
            x: cx - nw/2 - 1, y: by - 4,
            width: nw + 2, height: 8,
            fill: '#8a8a8a', stroke: '#555', strokeWidth: 0.5,
            cornerRadius: 1,
        }));

        // 灯头底部绝缘端（白色/黄色陶瓷端帽）
        this.group.add(new Konva.Rect({
            x: cx - bw*0.36, y: by + bh*0.82,
            width: bw*0.72, height: bh*0.20,
            fill: '#ddd8c0', stroke: '#aaa090', strokeWidth: 0.5,
            cornerRadius: [0,0,2,2],
        }));

        // 中心接触点（铜质，顶部导电片）
        this.group.add(new Konva.Ellipse({
            x: cx, y: by + bh*0.93,
            radiusX: bw*0.12, radiusY: bh*0.04,
            fill: '#c8a030', stroke: '#a07820', strokeWidth: 0.8,
        }));

        // 灯头高光
        this.group.add(new Konva.Line({
            points: [cx - bw*0.28, by+4, cx - bw*0.28, by+bh*0.80],
            stroke: 'rgba(255,255,255,0.18)', strokeWidth: 2, lineCap: 'round',
        }));
    }

    // ── 标注 ─────────────────────────────────
    _drawLabel() {
        this.group.add(new Konva.Text({
            x: 0, y: -16, width: this.width,
            text: `${this.label}  ${this.ratedVoltage}V  ${this.ratedPower}W`,
            fontSize: 9, fontStyle: 'bold', fill: '#546e7a', align: 'center',
        }));
    }

    // ── 信息面板（灯泡下方小仪表）────────────
    _drawInfoPanel() {
        const panY = this._baseY + this._baseH + 10;

        this._infoPower = new Konva.Text({
            x: 0, y: panY, width: this.width,
            text: 'P=0W  T=冷态', fontSize: 8, fill: '#37474f',
            align: 'center', fontFamily: 'Courier New, monospace',
        });
        this._infoLife = new Konva.Text({
            x: 0, y: panY + 12, width: this.width,
            text: `寿命: 0/${this.ratedLife}h`, fontSize: 7.5, fill: '#37474f',
            align: 'center', fontFamily: 'Courier New, monospace',
        });
        this.group.add(this._infoPower, this._infoLife);
    }

    // ── 点击灯泡切换状态 ─────────────────────
    _bindClick() {
        this._bulbPath.on('click tap', () => this.toggle());
        this._bulbPath.listening(true);
        this._bulbGlow.listening(false);
    }

    // ═══════════════════════════════════════════
    // 集中化 tick（由 consys._tickAll 在 20fps 调用）
    tick(dt) {
        this._tickPhysics(dt);
        this._tickVisuals(dt);
        this._refreshCache();
    }
    // ── 物理仿真 ─────────────────────────────
    _tickPhysics(dt) {
        this._flickerPhase += dt * 2 * Math.PI * 100; // 100Hz 闪烁基频

        if (this._powered) {
            // 通电：温度向热态趋近（一阶热模型）
            this._tempNorm += (1 - this._tempNorm) * (1 - Math.exp(-dt / this.thermalTau));
            this._tempNorm  = Math.min(1, this._tempNorm);

            // 闪烁（模拟电网电压波动 ±2%）
            const flicker = 1 + 0.02 * Math.sin(this._flickerPhase) * Math.sin(this._flickerPhase * 0.37);

            // 实时电阻（热态）
            const T_actual = this.T_cold + this._tempNorm*(this.T_hot - this.T_cold);
            this.resistance= this.R_cold * (1 + this.alpha*(T_actual - this.T_cold));
            this.resistance= Math.min(this.R_hot*1.05, this.resistance);

            this.voltage   = this._appliedVoltage * flicker;
            this.current   = this.voltage / this.resistance;
            this.power     = this.voltage * this.current;

            // 累计工作时间
            this._simTime += dt;
            this._usedHours = this._simTime / 3600;
            this._lifeRate  = Math.min(1, this._usedHours / this.ratedLife);

            // 色温（随功率变化）
            const pNorm    = Math.min(1, this.power / this.ratedPower);
            this.colorTemp = 1800 + pNorm * 1000;  // 1800K~2800K

            // 亮度
            this.brightness= this._tempNorm * Math.min(1.05, this.power / this.ratedPower);

        } else {
            // 断电：温度向冷态衰减
            this._tempNorm -= this._tempNorm * (1 - Math.exp(-dt / this.coolTau));
            this._tempNorm  = Math.max(0, this._tempNorm);

            this.voltage    = 0;
            this.current    = 0;
            this.power      = 0;
            this.resistance = this.R_cold * (1 + this.alpha*(this.T_cold + this._tempNorm*(this.T_hot-this.T_cold) - this.T_cold));
            this.brightness = this._tempNorm;
            this.colorTemp  = 1800 + this._tempNorm * 1000;
        }
    }

    // ── 视觉更新 ─────────────────────────────
    _tickVisuals(dt) {
        const T = this._tempNorm;
        const B = this.brightness;

        // ── 灯丝（每 3 帧重建一次，减少开销）──
        if (!this._rebuildCounter) this._rebuildCounter = 0;
        this._rebuildCounter++;
        if (this._rebuildCounter >= 3) {
            this._rebuildCounter = 0;
            this._rebuildFilament();
        }

        // ── 光晕 ──
        if (this._haloGroup) {
            this._haloGroup.opacity(B * 0.95);
        }
        if (this._haloOuter) {
            const stops = [
                0,   `rgba(255,${Math.round(200+T*30)},${Math.round(80+T*60)},${(B*0.30).toFixed(2)})`,
                0.4, `rgba(255,${Math.round(180+T*20)},${Math.round(60+T*40)},${(B*0.14).toFixed(2)})`,
                0.7, `rgba(255,${Math.round(160)},${Math.round(40)},${(B*0.05).toFixed(2)})`,
                1,   'rgba(255,150,30,0)',
            ];
            this._haloOuter.fillRadialGradientColorStops(stops);
        }

        // ── 泡壳内部发光 ──
        if (this._bulbPath && B > 0.05) {
            const bulbAlpha = B * (this.bulbType === 'frosted' ? 0.72 : 0.38) + B*0.18;
            const r = Math.round(225 + B*30);
            const g = Math.round(238 - B*20);
            const baseAlpha = this.bulkType === 'frosted' ? 0.72 : 0.38;
            // 通电时泡壳变暖黄色
            const warmR = Math.round(215 + B*40);
            const warmG = Math.round(220 + B*18);
            const warmB = Math.round(200 - B*60);
            this._bulbPath.fill(
                B > 0.05
                    ? `rgba(${warmR},${warmG},${warmB},${Math.min(0.88, baseAlpha + B*0.25)})`
                    : this._getBulbFill()
            );
        } else if (this._bulbPath) {
            this._bulbPath.fill(this._getBulbFill());
        }

        // ── 信息面板 ──
        if (this._infoPower) {
            const tempStr = T < 0.05 ? '冷态' : T < 0.5 ? '加热中' : `${Math.round(this.T_cold + T*(this.T_hot-this.T_cold))}°C`;
            this._infoPower.text(`P=${this.power.toFixed(0)}W  ${tempStr}`);
            this._infoPower.fill(this._powered ? '#ffd54f' : '#37474f');
        }
        if (this._infoLife) {
            const hStr = this._usedHours < 1 ? `${(this._usedHours*60).toFixed(0)}min` : `${this._usedHours.toFixed(1)}h`;
            this._infoLife.text(`寿命: ${hStr}/${this.ratedLife}h  ${(this._lifeRate*100).toFixed(2)}%`);
            this._infoLife.fill(this._lifeRate > 0.9 ? '#ef5350' : this._lifeRate > 0.7 ? '#ffa726' : '#37474f');
        }
    }

    // ═══════════════════════════════════════════
    /** 切换通断电状态 */
    toggle() {
        this._powered = !this._powered;
        this._refreshCache();
    }

    /** 通电 */
    turnOn() {
        if (!this._powered) { this._powered = true; this._refreshCache(); }
    }

    /** 断电 */
    turnOff() {
        if (this._powered) { this._powered = false; this._refreshCache(); }
    }

    /** 设置应用电压（仿真欠压/过压） */
    setVoltage(v) {
        this._appliedVoltage = Math.max(0, Math.min(this.ratedVoltage * 1.2, v));
        this._refreshCache();
    }

    isPowered()    { return this._powered; }
    getPower()     { return this.power; }
    getBrightness(){ return this.brightness; }
    getColorTemp() { return this.colorTemp; }
    getLifeRate()  { return this._lifeRate; }

    update(powered) {
        if (typeof powered === 'boolean') {
            powered ? this.turnOn() : this.turnOff();
        }
        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label:'位号/名称',        key:'label',         type:'text'   },
            { label:'额定电压 (V)',      key:'ratedVoltage',  type:'number' },
            { label:'额定功率 (W)',      key:'ratedPower',    type:'number' },
            { label:'额定寿命 (h)',      key:'ratedLife',     type:'number' },
            { label:'灯泡类型(frosted/clear)', key:'bulbType',type:'text'   },
            { label:'热时间常数 (s)',    key:'thermalTau',    type:'number' },
            { label:'冷却时间常数 (s)',  key:'coolTau',       type:'number' },
        ];
    }

    onConfigUpdate(cfg) {
        this.label        = cfg.label        || this.label;
        this.ratedVoltage = parseFloat(cfg.ratedVoltage) || this.ratedVoltage;
        this.ratedPower   = parseFloat(cfg.ratedPower)   || this.ratedPower;
        this.ratedLife    = parseFloat(cfg.ratedLife)    || this.ratedLife;
        this.bulbType     = cfg.bulbType     || this.bulbType;
        this.thermalTau   = parseFloat(cfg.thermalTau)   || this.thermalTau;
        this.coolTau      = parseFloat(cfg.coolTau)      || this.coolTau;
        this.R_hot        = this.ratedVoltage**2 / this.ratedPower;
        this.R_cold       = this.R_hot / 10;
        this.config       = { ...this.config, ...cfg };
        this._refreshCache();
    }

    destroy() {
        super.destroy?.();
    }
}