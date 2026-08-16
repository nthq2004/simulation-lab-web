import { BaseComponent } from './BaseComponent.js';

/**
 * 电磁炉仿真组件
 * （Induction Cooker Simulation）
 *
 * ── 结构说明 ──────────────────────────────────────────────────
 *
 *  本组件仿真家用电磁炉完整工况，涵盖以下子系统：
 *
 *  【外壳结构】
 *  1. 炉体机壳（Housing）：钢化玻璃面板，底部散热腔
 *  2. 微晶玻璃面板（Ceramic Glass）：承载锅具，耐热耐冲击
 *  3. 加热区标识（Heating Zone Mark）：中心圆形加热区指示
 *  4. 散热风扇（Cooling Fan）：底部排热
 *
 *  【电磁系统】
 *  5. IGBT 功率模块（IGBT）：高频开关，驱动线圈
 *  6. 励磁线圈（Induction Coil）：扁平螺旋形，产生交变磁场（20~35kHz）
 *  7. 磁力线（Magnetic Field Lines）：动态可视，交变方向
 *  8. 铁氧体磁条（Ferrite Bar）：导磁，防磁场外泄
 *
 *  【锅具系统（工况：铁锅烧水）】
 *  9.  铁锅（Cast Iron Pot）：锅底感应涡流，锅体升温
 * 10.  水（Water）：受热升温，产生气泡和蒸汽
 * 11.  锅底涡流（Eddy Currents）：环形感应电流，产生焦耳热
 *
 *  【热力系统】
 * 12. 锅底温度（Pot Bottom Temp，Tp）：由涡流焦耳热直接加热
 * 13. 水温（Water Temp，Tw）：从锅底热传导至水
 * 14. 沸腾判断（Boiling Detection）：Tw ≥ 100°C 触发沸腾状态
 * 15. 蒸汽（Steam）：沸腾后锅口冒出水蒸气
 *
 *  【控制面板】
 * 16. 电源开关（Power Button）：点击切换开/关
 * 17. 功率调节（Power Level，1~8 档）：± 按钮或滑块，控制加热强度
 * 18. 定时器（Timer）：显示已运行时长
 * 19. 显示屏（Display）：功率档位、水温、运行状态
 * 20. 指示灯（LED Indicator）：运行/待机/沸腾三色
 *
 * ── 涡流物理模型 ──────────────────────────────────────────────
 *
 *  励磁线圈产生频率 f = 25kHz 的交变磁场 B(t) = B₀·sin(2π·f·t)
 *
 *  锅底感应 EMF（法拉第定律）：
 *      ε = -N · dΦ/dt = -N · A · dB/dt
 *
 *  涡流路径（闭合环路，锅底导体中）：
 *      I_eddy = ε / R_pot_bottom
 *
 *  焦耳热功率（锅底热源）：
 *      P_eddy = I_eddy² · R = η · P_input
 *      （η = 电磁耦合效率，约 0.85~0.95）
 *
 *  锅底升温（集总热容模型）：
 *      dTp/dt = (P_eddy - Q_conv) / (m_pot · Cp_iron)
 *      Q_conv = h · A · (Tp - Tw)
 *
 *  水升温：
 *      dTw/dt = (Q_conv - Q_loss) / (m_water · Cp_water)
 *
 *  沸腾条件：Tw ≥ 100°C（标准大气压）
 *
 * ── 动态仿真效果 ──────────────────────────────────────────────
 *
 *  · 涡流环形动画：多圈同心椭圆电流线，随功率变化亮度/密度
 *  · 磁力线动画：线圈上方磁力线周期升降，极性交替
 *  · 气泡动画：沸腾前小泡，沸腾后大泡密集上升
 *  · 蒸汽动画：沸腾后锅口蒸汽飘散
 *  · 锅底热色变化：冷蓝 → 橙红（温度映射）
 *  · 散热风扇旋转（运行时）
 *  · 功率指示条（1~8 格高亮）
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  power_port — 电源线接口（底部）
 *
 * ── 公共 API ──────────────────────────────────────────────────
 *  .toggle()                — 开/关电源
 *  .start() / .stop()       — 启动/停机
 *  .setPowerLevel(n)        — 设置功率档位 1~8
 *  .addWater(liters)        — 加水（升）
 *  .reset()                 — 复位（冷却至室温）
 *  .getWaterTemp()          — 获取当前水温 °C
 *  .getPotTemp()            — 获取锅底温度 °C
 *  .isBoiling()             — 是否沸腾
 *  .update(state)           — 批量更新状态
 */
export class InductionCooker extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(340, config.width  || 440);
        this.height = Math.max(320, config.height || 460);

        this.type    = 'induction_cooker';
        this.special = 'none';
        this.cache   = 'fixed';

        this._initGroups();
        // ── 铭牌参数 ──
        this.label       = config.label       || 'IH-1';
        this.ratedPower  = config.ratedPower  || 2000;   // W 额定功率
        this.frequency   = config.frequency   || 25000;  // Hz 工作频率
        this.voltage     = config.voltage     || 220;    // V

        // ── 运行状态 ──
        this._running       = false;
        this._powerLevel    = config.powerLevel  || 4;   // 1~8 档
        this._waterMass     = config.waterMass   || 1.5; // kg (约1.5升)
        this._potMass       = config.potMass     || 1.8; // kg 铸铁锅
        this._ambientTemp   = config.ambientTemp || 25;  // °C

        // ── 热力状态 ──
        this._potTemp       = this._ambientTemp; // °C 锅底温度
        this._waterTemp     = this._ambientTemp; // °C 水温
        this._boiling       = false;
        this._runTime       = 0;                 // s 累计运行时长

        // ── 物理常数 ──
        this._Cp_water  = 4186;  // J/(kg·K) 水的比热容
        this._Cp_iron   = 460;   // J/(kg·K) 铸铁比热容
        this._h_conv    = 200;   // W/(m²·K) 对流传热系数（锅底→水）
        this._A_pot     = 0.035; // m² 锅底面积
        this._eta       = 0.90;  // 电磁耦合效率

        // ── 额定功率分档（W）──
        this._powerTable = [200, 400, 600, 800, 1000, 1300, 1600, 2000];

        // ── 动画状态 ──
        this._eddyPhase   = 0;  // 涡流动画相位 0~1
        this._magPhase    = 0;  // 磁力线相位 0~1
        this._bubblePhase = 0;  // 气泡相位 0~1
        this._steamPhase  = 0;  // 蒸汽相位 0~1
        this._fanAngle    = 0;
        this._flashPhase  = 0;  // 功率闪烁

        // ── 气泡池 ──
        this._bubbles = [];

        // 动画状态由 consys._tickAll 统一驱动

        // ── 几何布局 ──
        const W = this.width, H = this.height;

        // 炉体区（下部）
        this._housingY   = H * 0.52;
        this._housingH   = H * 0.42;

        // 玻璃面板
        this._glassY     = H * 0.50;
        this._glassH     = H * 0.04;

        // 铁锅
        this._potCX      = W * 0.50;
        this._potCY      = H * 0.38;
        this._potRX      = W * 0.36;
        this._potRY      = H * 0.12;
        this._potBodyH   = H * 0.18;

        // 线圈中心
        this._coilCX     = W * 0.50;
        this._coilCY     = H * 0.60;
        this._coilR      = W * 0.28;

        // 控制面板（底部）
        this._panelY     = H * 0.80;
        this._panelH     = H * 0.16;

        this._init();

        // 端口
        this.addPort(W * 0.50, H + 6, 'power_port', 'wire', 'AC');
    }

    // ══════════════════════════════════════════════
    _init() {
        this._drawHousing();
        this._drawCoilArea();
        this._drawGlassPanel();
        this._drawPot();
        this._drawWater();
        this._drawControlPanel();
        this._drawLabel();
        this._buildDynamicLayers();
    }

    // ── 炉体机壳 ───────────────────────────────────
    _drawHousing() {
        const W = this.width, H = this.height;
        const hy = this._housingY, hh = this._housingH;

        // 主壳体
        this._staticGroup.add(new Konva.Rect({
            x: W * 0.04, y: hy,
            width: W * 0.92, height: hh,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: 0, y: hh },
            fillLinearGradientColorStops: [
                0,   '#2e3038',
                0.4, '#383c46',
                0.8, '#2a2d34',
                1,   '#1e2028',
            ],
            stroke: '#1a1c22', strokeWidth: 1.5,
            cornerRadius: [4, 4, 12, 12],
            shadowColor: '#000', shadowBlur: 14,
            shadowOffsetY: 6, shadowOpacity: 0.45,
        }));

        // 散热孔格栅（两侧）
        [W * 0.07, W * 0.84].forEach(sx => {
            for (let i = 0; i < 6; i++) {
                this._staticGroup.add(new Konva.Rect({
                    x: sx, y: hy + hh * 0.55 + i * 8,
                    width: W * 0.07, height: 4,
                    fill: '#1a1c22', cornerRadius: 2,
                }));
            }
        });

        // 底部脚垫
        [[W * 0.10, H - 8], [W * 0.88, H - 8]].forEach(([fx, fy]) => {
            this._staticGroup.add(new Konva.Rect({
                x: fx - 12, y: fy,
                width: 24, height: 8,
                fill: '#111', cornerRadius: [0, 0, 4, 4],
            }));
        });

        // 散热风扇（底部中央，正视简化为圆形）
        this._fanGroup = new Konva.Group({ x: W * 0.50, y: hy + hh * 0.30 });
        this._fanGroup.add(new Konva.Circle({
            radius: W * 0.055,
            fill: '#1e2028', stroke: '#2e3038', strokeWidth: 1,
        }));
        const fanBlades = 6;
        for (let i = 0; i < fanBlades; i++) {
            const angle = (i / fanBlades) * 360;
            this._fanGroup.add(new Konva.Line({
                points: [0, 0, 0, -W * 0.042],
                stroke: '#3a4050', strokeWidth: 3,
                lineCap: 'round', rotation: angle,
            }));
        }
        this._fanGroup.add(new Konva.Circle({ radius: W * 0.010, fill: '#505a6a' }));
        this._staticGroup.add(this._fanGroup);

        // IGBT 模块标注
        this._staticGroup.add(new Konva.Rect({
            x: W * 0.60, y: hy + hh * 0.15,
            width: W * 0.26, height: H * 0.08,
            fill: '#111418', stroke: '#30363d', strokeWidth: 0.8,
            cornerRadius: 3,
        }));
        this._staticGroup.add(new Konva.Text({
            x: W * 0.62, y: hy + hh * 0.18,
            text: 'IGBT\nIPM Module',
            fontSize: 7, fill: '#4fc3f7', fontStyle: 'bold',
            lineHeight: 1.4,
        }));

        // 铁氧体磁条（线圈下方）
        const ferY = this._coilCY + this._coilR * 0.18;
        for (let i = -2; i <= 2; i++) {
            this._staticGroup.add(new Konva.Rect({
                x: W * 0.50 + i * W * 0.09 - W * 0.025,
                y: ferY,
                width: W * 0.05, height: H * 0.022,
                fill: '#3d2a1a', stroke: '#5a3e28', strokeWidth: 0.5,
                cornerRadius: 1,
            }));
        }
        this._staticGroup.add(new Konva.Text({
            x: W * 0.56, y: ferY + H * 0.025,
            text: '铁氧体磁条', fontSize: 6.5, fill: '#8d6e63',
        }));
    }

    // ── 励磁线圈（扁平螺旋，正视投影）──────────────
    _drawCoilArea() {
        const cx = this._coilCX, cy = this._coilCY;
        const maxR = this._coilR;
        const turns = 7;

        // 线圈匝（从外到内，递减椭圆）
        for (let i = 0; i < turns; i++) {
            const frac = (turns - i) / turns;
            const rx = maxR * frac;
            const ry = rx * 0.22;
            const alpha = 0.15 + frac * 0.35;
            this._staticGroup.add(new Konva.Ellipse({
                x: cx, y: cy,
                radiusX: rx, radiusY: ry,
                fill: 'transparent',
                stroke: `rgba(180,140,60,${alpha})`,
                strokeWidth: 2.5,
            }));
        }

        // 线圈引线（左右两端）
        this._staticGroup.add(new Konva.Line({
            points: [cx - maxR - 6, cy, cx - maxR - 6, cy + 20, W * 0.06, cy + 20],
            stroke: '#b87333', strokeWidth: 2,
            lineCap: 'round', lineJoin: 'round',
        }));
        this._staticGroup.add(new Konva.Line({
            points: [cx + maxR + 6, cy, cx + maxR + 6, cy + 20, W * 0.94, cy + 20],
            stroke: '#b87333', strokeWidth: 2,
            lineCap: 'round', lineJoin: 'round',
        }));

        this._staticGroup.add(new Konva.Text({
            x: cx - 18, y: cy + this._coilR * 0.30,
            text: '励磁线圈', fontSize: 7, fill: '#b87333',
        }));

        const W = this.width;
    }

    // ── 微晶玻璃面板 ────────────────────────────────
    _drawGlassPanel() {
        const W = this.width, H = this.height;
        const gy = this._glassY, gh = this._glassH;

        // 玻璃基板（深色半透明）
        this._staticGroup.add(new Konva.Rect({
            x: W * 0.04, y: gy,
            width: W * 0.92, height: gh,
            fill: '#0a0c10',
            stroke: '#2a2e38', strokeWidth: 1,
            cornerRadius: [8, 8, 0, 0],
        }));
        // 玻璃高光（顶面反光）
        this._staticGroup.add(new Konva.Rect({
            x: W * 0.06, y: gy + 1,
            width: W * 0.88, height: gh * 0.30,
            fill: 'rgba(255,255,255,0.08)',
            cornerRadius: [6, 6, 0, 0],
        }));

        // 加热区圆形标记（虚线圆）
        this._staticGroup.add(new Konva.Circle({
            x: W * 0.50, y: gy + gh * 0.50,
            radius: W * 0.22,
            fill: 'transparent',
            stroke: 'rgba(200,180,100,0.25)',
            strokeWidth: 1, dash: [4, 4],
        }));

        // 玻璃材质标注
        this._staticGroup.add(new Konva.Text({
            x: W * 0.74, y: gy + 2,
            text: '微晶玻璃面板',
            fontSize: 6, fill: 'rgba(150,160,180,0.60)',
        }));
    }

    // ── 铁锅（俯视+侧视融合）──────────────────────
    _drawPot() {
        const W = this.width, H = this.height;
        const cx = this._potCX, cy = this._potCY;
        const rx = this._potRX, ry = this._potRY;
        const bh = this._potBodyH;

        // 锅体侧壁（梯形体）
        this._staticGroup.add(new Konva.Line({
            points: [
                cx - rx, cy,
                cx - rx * 0.75, cy - bh,
                cx + rx * 0.75, cy - bh,
                cx + rx, cy,
            ],
            closed: true,
            fillLinearGradientStartPoint: { x: -rx, y: 0 },
            fillLinearGradientEndPoint:   { x:  rx, y: 0 },
            fillLinearGradientColorStops: [
                0,   '#2a2a2a',
                0.25,'#3d3d3d',
                0.50,'#4a4a4a',
                0.75,'#363636',
                1,   '#222222',
            ],
            stroke: '#1a1a1a', strokeWidth: 1.5,
        }));

        // 锅口椭圆（顶面）
        this._staticGroup.add(new Konva.Ellipse({
            x: cx, y: cy - bh,
            radiusX: rx * 0.75, radiusY: ry * 0.55,
            fillLinearGradientStartPoint: { x: -rx * 0.75, y: 0 },
            fillLinearGradientEndPoint:   { x:  rx * 0.75, y: 0 },
            fillLinearGradientColorStops: [0,'#3a3a3a',0.5,'#555',1,'#2e2e2e'],
            stroke: '#1a1a1a', strokeWidth: 1,
        }));

        // 锅底椭圆（感应加热面，热色动态）
        this._potBottomEllipse = new Konva.Ellipse({
            x: cx, y: cy,
            radiusX: rx, radiusY: ry,
            fill: this._tempToColor(this._potTemp),
            stroke: '#111', strokeWidth: 1.5,
        });
        this._staticGroup.add(this._potBottomEllipse);

        // 锅底高光
        this._staticGroup.add(new Konva.Ellipse({
            x: cx - rx * 0.25, y: cy - ry * 0.25,
            radiusX: rx * 0.25, radiusY: ry * 0.18,
            fill: 'rgba(255,255,255,0.06)',
        }));

        // 锅耳（左右把手）
        [[-1, -14], [1, -14]].forEach(([dir, offsetY]) => {
            this._staticGroup.add(new Konva.Rect({
                x: cx + dir * (rx * 0.75 + 2) - (dir > 0 ? 22 : 0),
                y: cy - bh + H * 0.025 + offsetY,
                width: 22, height: 10,
                fill: '#1a1a1a', stroke: '#111', strokeWidth: 0.8,
                cornerRadius: [3, 3, 0, 0],
            }));
        });

        // 锅体材质标注
        this._staticGroup.add(new Konva.Text({
            x: cx + rx * 0.80, y: cy - bh * 0.5,
            text: '铸铁锅', fontSize: 7, fill: '#707080',
        }));
    }

    // ── 水（锅内，动态）─────────────────────────────
    _drawWater() {
        const W = this.width, H = this.height;
        const cx = this._potCX;
        const cy = this._potCY;
        const rx = this._potRX, ry = this._potRY;
        const bh = this._potBodyH;

        // 水面（椭圆，动态颜色随水温）
        this._waterSurface = new Konva.Ellipse({
            x: cx, y: cy - bh * 0.30,
            radiusX: rx * 0.70, radiusY: ry * 0.42,
            fill: 'rgba(30,120,200,0.55)',
            stroke: 'rgba(80,160,255,0.35)', strokeWidth: 0.8,
        });
        this._staticGroup.add(this._waterSurface);

        // 水面高光
        this._staticGroup.add(new Konva.Ellipse({
            x: cx - rx * 0.20, y: cy - bh * 0.34,
            radiusX: rx * 0.28, radiusY: ry * 0.14,
            fill: 'rgba(180,220,255,0.20)',
            listening: false,
        }));

        // 水温标注
        this._waterTempText = new Konva.Text({
            x: cx - 32, y: cy - bh * 0.38,
            text: `水温 ${this._waterTemp.toFixed(1)}°C`,
            fontSize: 8, fill: 'rgba(140,200,255,0.80)',
            fontStyle: 'bold',
        });
        this._staticGroup.add(this._waterTempText);
    }

    // ── 控制面板 ────────────────────────────────────
    _drawControlPanel() {
        const W = this.width, H = this.height;
        const py = this._panelY, ph = this._panelH;

        // 面板背板
        this._staticGroup.add(new Konva.Rect({
            x: W * 0.06, y: py,
            width: W * 0.88, height: ph,
            fill: '#1a1c22', stroke: '#2a2e38', strokeWidth: 0.8,
            cornerRadius: 4,
        }));

        // ── 显示屏 ──
        const dispX = W * 0.08, dispY = py + ph * 0.08;
        const dispW = W * 0.38, dispH = ph * 0.60;
        this._staticGroup.add(new Konva.Rect({
            x: dispX, y: dispY, width: dispW, height: dispH,
            fill: '#050a08', stroke: '#1e3a2a', strokeWidth: 1,
            cornerRadius: 4,
        }));
        // 显示屏内容
        this._displayRunText = new Konva.Text({
            x: dispX + 6, y: dispY + 4,
            text: `P${this._powerLevel}`,
            fontSize: 22, fill: this._running ? '#00ff7f' : '#1a4a30',
            fontStyle: 'bold',
        });
        this._displayTempText = new Konva.Text({
            x: dispX + 6, y: dispY + dispH * 0.52,
            text: `${this._waterTemp.toFixed(0)}°C`,
            fontSize: 11, fill: this._running ? '#40c080' : '#1a3a20',
            fontStyle: 'bold',
        });
        this._displayTimeText = new Konva.Text({
            x: dispX + dispW * 0.52, y: dispY + dispH * 0.52,
            text: '00:00',
            fontSize: 10, fill: this._running ? '#30a060' : '#152a18',
        });
        this._staticGroup.add(this._displayRunText, this._displayTempText, this._displayTimeText);

        // 沸腾指示
        this._boilText = new Konva.Text({
            x: dispX + dispW * 0.50, y: dispY + 6,
            text: 'BOIL', fontSize: 9,
            fill: 'transparent', fontStyle: 'bold',
        });
        this._staticGroup.add(this._boilText);

        // ── 功率指示条（8 格）──
        const barX0 = W * 0.50, barY = py + ph * 0.15;
        const barW = W * 0.05, barH = ph * 0.22, barGap = W * 0.045;
        this._powerBars = [];
        for (let i = 0; i < 8; i++) {
            const bar = new Konva.Rect({
                x: barX0 + i * barGap, y: barY,
                width: barW, height: barH,
                fill: i < this._powerLevel
                    ? this._powerBarColor(i + 1)
                    : '#1e2028',
                stroke: '#2e3038', strokeWidth: 0.5,
                cornerRadius: 2,
            });
            this._staticGroup.add(bar);
            this._powerBars.push(bar);
        }

        // ── 电源按钮 ──
        const btnR  = Math.min(W, H) * 0.048;
        const btnX  = W * 0.12, btnY = py + ph * 0.76;
        this._powerBtn = new Konva.Circle({
            x: btnX, y: btnY, radius: btnR,
            fill: this._running ? '#1a4a20' : '#2a1a18',
            stroke: this._running ? '#00e676' : '#ef5350',
            strokeWidth: 1.5,
            shadowColor: this._running ? '#00e676' : '#ef5350',
            shadowBlur: this._running ? 8 : 3,
            shadowOpacity: 0.7,
            cursor: 'pointer',
        });
        // 电源图标（圆弧+竖线）
        this._powerIconArc = new Konva.Arc({
            x: btnX, y: btnY + 1,
            innerRadius: btnR * 0.40, outerRadius: btnR * 0.55,
            angle: 260, rotation: 130,
            fill: 'transparent',
            stroke: this._running ? '#00e676' : '#ef5350',
            strokeWidth: 2,
        });
        this._powerIconLine = new Konva.Line({
            points: [btnX, btnY - btnR * 0.58, btnX, btnY + btnR * 0.05],
            stroke: this._running ? '#00e676' : '#ef5350',
            strokeWidth: 2, lineCap: 'round',
        });
        this._staticGroup.add(this._powerBtn, this._powerIconArc, this._powerIconLine);
        this._staticGroup.add(new Konva.Text({
            x: btnX - 8, y: btnY + btnR + 3,
            text: '开/关', fontSize: 7, fill: '#7a8090',
        }));

        // ── 功率减档按钮（−）──
        const ctrlY = py + ph * 0.78;
        const minusBtnX = W * 0.66;
        this._minusBtn = new Konva.Rect({
            x: minusBtnX - 14, y: ctrlY - 10,
            width: 28, height: 20,
            fill: '#252830', stroke: '#3a3e48', strokeWidth: 1,
            cornerRadius: 4, cursor: 'pointer',
        });
        this._minusBtnText = new Konva.Text({
            x: minusBtnX - 5, y: ctrlY - 7,
            text: '−', fontSize: 14, fill: '#c0c8d8',
        });
        this._staticGroup.add(this._minusBtn, this._minusBtnText);

        // 功率档位数字
        this._levelText = new Konva.Text({
            x: W * 0.72, y: ctrlY - 7,
            text: `${this._powerLevel}`, fontSize: 13,
            fill: '#e0e8f0', fontStyle: 'bold',
        });
        this._staticGroup.add(this._levelText);

        // ── 功率加档按钮（+）──
        const plusBtnX = W * 0.80;
        this._plusBtn = new Konva.Rect({
            x: plusBtnX - 14, y: ctrlY - 10,
            width: 28, height: 20,
            fill: '#252830', stroke: '#3a3e48', strokeWidth: 1,
            cornerRadius: 4, cursor: 'pointer',
        });
        this._plusBtnText = new Konva.Text({
            x: plusBtnX - 4, y: ctrlY - 7,
            text: '+', fontSize: 13, fill: '#c0c8d8',
        });
        this._staticGroup.add(this._plusBtn, this._plusBtnText);
        this._staticGroup.add(new Konva.Text({
            x: W * 0.65, y: ctrlY + 12,
            text: '功率调节', fontSize: 6.5, fill: '#606878',
        }));

        // ── 状态 LED ──
        this._statusLed = new Konva.Circle({
            x: W * 0.90, y: py + ph * 0.35,
            radius: 5,
            fill: this._running ? '#00e676' : '#444',
            shadowColor: this._running ? '#00e676' : 'transparent',
            shadowBlur: this._running ? 8 : 0,
        });
        this._staticGroup.add(this._statusLed);
        this._staticGroup.add(new Konva.Text({
            x: W * 0.88, y: py + ph * 0.50,
            text: '状态', fontSize: 6.5, fill: '#606878',
        }));

        // ── 绑定交互 ──
        this._powerBtn.on('click tap', () => this.toggle());
        this._powerIconArc.on('click tap', () => this.toggle());
        this._powerIconLine.on('click tap', () => this.toggle());
        this._minusBtn.on('click tap', () => this.setPowerLevel(this._powerLevel - 1));
        this._minusBtnText.on('click tap', () => this.setPowerLevel(this._powerLevel - 1));
        this._plusBtn.on('click tap', () => this.setPowerLevel(this._powerLevel + 1));
        this._plusBtnText.on('click tap', () => this.setPowerLevel(this._powerLevel + 1));
        [this._powerBtn, this._powerIconArc, this._powerIconLine,
         this._minusBtn, this._minusBtnText, this._plusBtn, this._plusBtnText]
            .forEach(n => n.listening(true));
    }

    // ── 标注 ────────────────────────────────────────
    _drawLabel() {
        const W = this.width;
        this._staticGroup.add(new Konva.Text({
            x: 0, y: -18, width: W,
            text: `${this.label}  电磁炉  ${this.ratedPower}W  ${this.voltage}V  ${(this.frequency / 1000).toFixed(0)}kHz`,
            fontSize: 9, fontStyle: 'bold', fill: '#546e7a', align: 'center',
        }));
    }

    // ── 动态层（涡流/磁力线/气泡/蒸汽）────────────
    _buildDynamicLayers() {
        const W = this.width, H = this.height;

        // 涡流层（锅底动态电流环）
        this._eddyGroup = new Konva.Group();
        this._staticGroup.add(this._eddyGroup);

        // 磁力线层
        this._magGroup = new Konva.Group();
        this._staticGroup.add(this._magGroup);

        // 气泡层
        this._bubbleGroup = new Konva.Group();
        this._staticGroup.add(this._bubbleGroup);

        // 蒸汽层
        this._steamGroup = new Konva.Group();
        this._staticGroup.add(this._steamGroup);

        // 预生成涡流圆环（5 圈，动态显示强度）
        this._eddyRings = [];
        const ecx = this._potCX, ecy = this._potCY;
        const erx = this._potRX, ery = this._potRY;
        for (let i = 0; i < 5; i++) {
            const frac = (i + 1) / 6;
            const ring = new Konva.Ellipse({
                x: ecx, y: ecy,
                radiusX: erx * frac, radiusY: ery * frac,
                fill: 'transparent',
                stroke: '#ff6600',
                strokeWidth: 2,
                dash: [8, 6],
                opacity: 0,
                listening: false,
            });
            this._eddyGroup.add(ring);
            this._eddyRings.push({ node: ring, frac, baseOpacity: 0 });
        }

        // 涡流方向箭头（4 个，均匀分布在锅底）
        this._eddyArrows = [];
        for (let i = 0; i < 4; i++) {
            const angle = (i / 4) * Math.PI * 2;
            const ax = ecx + erx * 0.55 * Math.cos(angle);
            const ay = ecy + ery * 0.55 * Math.sin(angle);
            const arrow = new Konva.Text({
                x: ax - 5, y: ay - 5,
                text: '↻', fontSize: 11,
                fill: '#ff6600', opacity: 0,
                listening: false,
            });
            this._eddyGroup.add(arrow);
            this._eddyArrows.push({ node: arrow, angle });
        }

        // 磁力线（线圈上方，8 条弧线）
        this._magLines = [];
        for (let i = 0; i < 8; i++) {
            const tx = this._coilCX + (i - 3.5) * this._coilR * 0.26;
            const line = new Konva.Path({
                data: `M ${tx} ${this._coilCY} C ${tx} ${this._glassY + 2} ${tx} ${this._potCY} ${tx} ${this._potCY}`,
                fill: 'none',
                stroke: '#4a90d9',
                strokeWidth: 1.2,
                opacity: 0,
                listening: false,
            });
            this._magGroup.add(line);
            this._magLines.push({ node: line, tx, phase: i / 8 });
        }

        // 预生成气泡对象池
        for (let i = 0; i < 20; i++) {
            const bubble = new Konva.Circle({
                radius: 3, fill: 'rgba(200,240,255,0.5)',
                stroke: 'rgba(120,200,255,0.6)', strokeWidth: 0.5,
                opacity: 0, listening: false,
            });
            this._bubbleGroup.add(bubble);
            this._bubbles.push({ node: bubble, active: false, x: 0, y: 0, vy: 0, r: 3 });
        }

        // 蒸汽粒子（预生成）
        this._steamParticles = [];
        for (let i = 0; i < 12; i++) {
            const steam = new Konva.Ellipse({
                radiusX: 6, radiusY: 3,
                fill: 'rgba(200,220,240,0.25)',
                opacity: 0, listening: false,
            });
            this._steamGroup.add(steam);
            this._steamParticles.push({ node: steam, t: i / 12, x: 0, y: 0 });
        }
    }

    // ══════════════════════════════════════════════
    // 集中化 tick（由 consys._tickAll 在 20fps 调用）
    tick(dt) {
        this._tickPhysics(dt);
        this._tickAnimation(dt);
    
        this._refreshCache();
    }

    // ── 物理仿真步进 ──────────────────────────────
    _tickPhysics(dt) {
        if (!this._running) {
            // 自然冷却
            const Tamb = this._ambientTemp;
            const coolPot   = 0.8;  // 散热系数
            const coolWater = 0.3;
            if (this._potTemp   > Tamb) this._potTemp   -= (this._potTemp   - Tamb) * coolPot   * dt * 0.1;
            if (this._waterTemp > Tamb) this._waterTemp -= (this._waterTemp - Tamb) * coolWater * dt * 0.05;
            this._boiling = false;
            return;
        }

        this._runTime += dt;

        // 输入功率
        const P_input = this._powerTable[this._powerLevel - 1]; // W

        // 锅底感应涡流热功率（焦耳热）
        const P_eddy = P_input * this._eta;

        // 对流传热（锅底 → 水）
        const Q_conv = this._h_conv * this._A_pot *
            Math.max(0, this._potTemp - this._waterTemp);

        // 锅底升温 dT/dt = (P_eddy - Q_conv) / (m * Cp)
        const m_pot = this._potMass;
        const dTp = (P_eddy - Q_conv) / (m_pot * this._Cp_iron);
        this._potTemp = Math.min(300, this._potTemp + dTp * dt);

        // 水升温 dT/dt = (Q_conv - Q_evap_loss) / (m * Cp)
        const m_w = this._waterMass;
        const boilingLoss = this._boiling ? 500 : 0; // 沸腾蒸发散热
        const dTw = (Q_conv - boilingLoss) / (m_w * this._Cp_water);
        this._waterTemp = Math.min(100, this._waterTemp + dTw * dt);

        // 沸腾判断
        this._boiling = this._waterTemp >= 99.5;

        // 更新显示
        this._updateDisplay();
    }

    // ── 动画步进 ──────────────────────────────────
    _tickAnimation(dt) {
        const W = this.width, H = this.height;
        const isOn = this._running;

        // ── 风扇旋转 ──
        if (isOn) {
            this._fanAngle += dt * 360 * 4;
            this._fanGroup.rotation(this._fanAngle);
        }

        // ── 涡流动画 ──
        const eddyStrength = isOn ? (this._powerLevel / 8) : 0;
        this._eddyPhase = (this._eddyPhase + dt * 3 * (1 + this._powerLevel * 0.3)) % 1;

        this._eddyRings.forEach((r, i) => {
            if (!isOn) { r.node.opacity(0); return; }
            // 各圈错相，产生扫描效果
            const phase = (this._eddyPhase + i * 0.2) % 1;
            const alpha = eddyStrength * 0.7 * Math.sin(phase * Math.PI * 2) * 0.5 + eddyStrength * 0.35;
            r.node.opacity(Math.max(0, alpha));
            // 虚线偏移（流动感）
            r.node.dashOffset(-(this._eddyPhase * 28 + i * 6));
            // 高温时颜色偏橙红
            const tempFrac = Math.min(1, (this._potTemp - 25) / 200);
            const g = Math.round(180 - tempFrac * 130);
            r.node.stroke(`rgba(255,${g},0,1)`);
        });

        // 涡流箭头旋转方向交替
        this._eddyArrows.forEach((a, i) => {
            if (!isOn) { a.node.opacity(0); return; }
            const pulse = 0.5 + 0.5 * Math.sin(this._eddyPhase * Math.PI * 2 + i);
            a.node.opacity(eddyStrength * pulse * 0.9);
            // 旋转方向（每圈交替）
            a.node.text(Math.sin(this._eddyPhase * Math.PI * 2) > 0 ? '↻' : '↺');
        });

        // ── 磁力线动画 ──
        this._magPhase = (this._magPhase + dt * 2.5) % 1;
        this._magLines.forEach((m, i) => {
            if (!isOn) { m.node.opacity(0); return; }
            const ph = (this._magPhase + m.phase) % 1;
            const amp = 0.3 + 0.5 * Math.abs(Math.sin(ph * Math.PI));
            const mag_alpha = eddyStrength * amp * 0.7;
            m.node.opacity(mag_alpha);

            // 动态磁力线路径（上下弯曲变化）
            const bx  = m.tx;
            const by1 = this._glassY - 10 * amp;
            const by2 = this._potCY  - 20 * amp;
            m.node.data(
                `M ${bx} ${this._coilCY - 5} C ${bx} ${by1} ${bx} ${by2} ${bx} ${this._potCY}`
            );
            // 磁场极性颜色（正负半周）
            m.node.stroke(ph < 0.5 ? '#4a90d9' : '#e040fb');
        });

        // ── 气泡动画 ──
        this._bubblePhase = (this._bubblePhase + dt) % 1;
        const bubbleRate = this._boiling ? 8 :
                           this._waterTemp > 80 ? 3 :
                           this._waterTemp > 60 ? 1 : 0;

        // 激活新气泡
        if (isOn && bubbleRate > 0 && Math.random() < bubbleRate * dt) {
            const inactive = this._bubbles.find(b => !b.active);
            if (inactive) {
                const bx = this._potCX + (Math.random() - 0.5) * this._potRX * 1.1;
                const by = this._potCY - this._potBodyH * 0.25;
                const br = this._boiling ? (3 + Math.random() * 4) : (1.5 + Math.random() * 2);
                inactive.active = true;
                inactive.x = bx;
                inactive.y = by;
                inactive.vy = -(20 + Math.random() * 30);
                inactive.r  = br;
                inactive.node.radius(br);
                inactive.node.x(bx);
                inactive.node.y(by);
            }
        }

        // 更新气泡
        this._bubbles.forEach(b => {
            if (!b.active) { b.node.opacity(0); return; }
            b.y += b.vy * dt;
            b.x += (Math.random() - 0.5) * 8 * dt;
            b.node.x(b.x);
            b.node.y(b.y);
            // 气泡接近水面时淡出
            const topY = this._potCY - this._potBodyH * 0.25 - this._potRY * 0.40;
            const progress = (this._potCY - this._potBodyH * 0.25 - b.y) /
                             (this._potRY * 0.40);
            b.node.opacity(Math.max(0, Math.min(0.8, progress)));
            // 气泡离开水面则回收
            if (b.y < topY - 20 || !isOn) {
                b.active = false;
                b.node.opacity(0);
            }
        });

        // ── 蒸汽动画 ──
        this._steamPhase = (this._steamPhase + dt * 0.8) % 1;
        if (this._boiling && isOn) {
            this._steamParticles.forEach((s, i) => {
                const t = (s.t + this._steamPhase) % 1;
                const potTopX = this._potCX + (Math.random() < 0.02 ? (Math.random() - 0.5) * this._potRX * 1.2 : 0);
                const startY  = this._potCY - this._potBodyH - this._potRY * 0.50;
                const sy = startY - t * H * 0.14;
                const sx = this._potCX + Math.sin(t * Math.PI * 3 + i) * this._potRX * 0.35;
                const alpha = t < 0.2 ? t * 5 : t > 0.7 ? (1 - t) * 3.33 : 1;
                s.node.x(sx);
                s.node.y(sy);
                s.node.radiusX(6 + t * 18);
                s.node.radiusY(3 + t * 9);
                s.node.opacity(alpha * 0.40);
            });
        } else {
            this._steamParticles.forEach(s => s.node.opacity(0));
        }

        // ── 锅底热色更新 ──
        if (this._potBottomEllipse) {
            this._potBottomEllipse.fill(this._tempToColor(this._potTemp));
        }

        // ── 水面颜色 ──
        if (this._waterSurface) {
            const wf = Math.min(1, (this._waterTemp - 25) / 75);
            const r = Math.round(30  + wf * 80);
            const g = Math.round(120 - wf * 40);
            const b = Math.round(200 - wf * 60);
            this._waterSurface.fill(`rgba(${r},${g},${b},0.55)`);
        }

        // ── 沸腾闪烁 ──
        if (this._boiling && isOn) {
            this._flashPhase = (this._flashPhase + dt * 2) % 1;
            const flash = 0.5 + 0.5 * Math.sin(this._flashPhase * Math.PI * 2);
            this._boilText?.fill(`rgba(255,80,0,${flash})`);
        } else {
            this._boilText?.fill('transparent');
        }

        this._refreshCache();
    }

    // ── 温度 → 颜色映射 ──
    _tempToColor(t) {
        // 25°C = 深灰   100°C = 深橙   200°C = 亮红橙   300°C = 亮橙
        const f = Math.min(1, Math.max(0, (t - 25) / 275));
        if (f < 0.25) {
            // 冷灰 → 暗红
            const p = f / 0.25;
            const r = Math.round(50  + p * 100);
            const g = Math.round(50  - p * 30);
            const b = Math.round(50  - p * 30);
            return `rgb(${r},${g},${b})`;
        } else if (f < 0.60) {
            const p = (f - 0.25) / 0.35;
            const r = Math.round(150 + p * 90);
            const g = Math.round(20  + p * 60);
            const b = 0;
            return `rgb(${r},${g},${b})`;
        } else {
            const p = (f - 0.60) / 0.40;
            const r = 255;
            const g = Math.round(80  + p * 90);
            const b = 0;
            return `rgb(${r},${g},${b})`;
        }
    }

    _powerBarColor(level) {
        if (level <= 2) return '#1a6a30';
        if (level <= 5) return '#b07800';
        return '#a02020';
    }

    // ── 更新 UI 显示 ──
    _updateDisplay() {
        const W = this.width, H = this.height;
        // 格式化时间
        const mins = Math.floor(this._runTime / 60);
        const secs = Math.floor(this._runTime % 60);
        const timeStr = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

        const green = '#00ff7f', dim = '#1a4a30';
        const c = this._running ? green : dim;

        this._displayRunText?.text(`P${this._powerLevel}`);
        this._displayRunText?.fill(c);
        this._displayTempText?.text(`${this._waterTemp.toFixed(0)}°C`);
        this._displayTempText?.fill(this._running ? '#40c080' : '#1a3a20');
        this._displayTimeText?.text(timeStr);
        this._displayTimeText?.fill(this._running ? '#30a060' : '#152a18');

        // 水温标注
        this._waterTempText?.text(`水温 ${this._waterTemp.toFixed(1)}°C`);

        // 功率条
        this._powerBars?.forEach((bar, i) => {
            bar.fill(i < this._powerLevel
                ? this._powerBarColor(i + 1)
                : '#1e2028');
        });
        this._levelText?.text(`${this._powerLevel}`);

        // 电源按钮
        const btnColor = this._running ? '#00e676' : '#ef5350';
        this._powerBtn?.fill(this._running ? '#1a4a20' : '#2a1a18');
        this._powerBtn?.stroke(btnColor);
        this._powerBtn?.shadowColor(btnColor);
        this._powerBtn?.shadowBlur(this._running ? 8 : 3);
        this._powerIconArc?.stroke(btnColor);
        this._powerIconLine?.stroke(btnColor);

        // 状态灯
        this._statusLed?.fill(this._running ? (this._boiling ? '#ff8800' : '#00e676') : '#444');
        this._statusLed?.shadowColor(this._running ? (this._boiling ? '#ff8800' : '#00e676') : 'transparent');
        this._statusLed?.shadowBlur(this._running ? 8 : 0);
    }

    // ══════════════════════════════════════════════
    // ── 公共 API ──────────────────────────────────

    toggle()  { this._running ? this.stop() : this.start(); }

    start() {
        if (this._running) return;
        this._running = true;
        this._updateDisplay();
        this._refreshCache();
    }

    stop() {
        if (!this._running) return;
        this._running = false;
        this._updateDisplay();
        this._refreshCache();
    }

    setPowerLevel(level) {
        this._powerLevel = Math.max(1, Math.min(8, Math.round(level)));
        this._updateDisplay();
        this._refreshCache();
    }

    addWater(liters) {
        this._waterMass = Math.max(0.2, this._waterMass + liters);
    }

    reset() {
        this._running     = false;
        this._potTemp     = this._ambientTemp;
        this._waterTemp   = this._ambientTemp;
        this._boiling     = false;
        this._runTime     = 0;
        this._updateDisplay();
        this._refreshCache();
    }

    getWaterTemp()  { return this._waterTemp; }
    getPotTemp()    { return this._potTemp; }
    isBoiling()     { return this._boiling; }
    isRunning()     { return this._running; }
    getPowerLevel() { return this._powerLevel; }

    update(state) {
        if (typeof state === 'boolean') { state ? this.start() : this.stop(); }
        if (typeof state === 'object' && state !== null) {
            if (state.running      !== undefined) state.running ? this.start() : this.stop();
            if (state.powerLevel   !== undefined) this.setPowerLevel(state.powerLevel);
            if (state.waterMass    !== undefined) this._waterMass  = state.waterMass;
            if (state.ambientTemp  !== undefined) this._ambientTemp = state.ambientTemp;
        }
        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label: '位号/名称',         key: 'label',        type: 'text'   },
            { label: '额定功率 (W)',       key: 'ratedPower',   type: 'number' },
            { label: '工作频率 (Hz)',      key: 'frequency',    type: 'number' },
            { label: '电源电压 (V)',       key: 'voltage',      type: 'number' },
            { label: '初始功率档位 (1~8)', key: 'powerLevel',   type: 'number' },
            { label: '水量 (kg)',          key: 'waterMass',    type: 'number' },
            { label: '铁锅质量 (kg)',      key: 'potMass',      type: 'number' },
            { label: '环境温度 (°C)',      key: 'ambientTemp',  type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        this.label        = cfg.label       || this.label;
        this.ratedPower   = parseFloat(cfg.ratedPower) || this.ratedPower;
        this.frequency    = parseFloat(cfg.frequency)  || this.frequency;
        this.voltage      = parseFloat(cfg.voltage)    || this.voltage;
        if (cfg.powerLevel  !== undefined) this.setPowerLevel(parseFloat(cfg.powerLevel));
        if (cfg.waterMass   !== undefined) this._waterMass  = parseFloat(cfg.waterMass);
        if (cfg.potMass     !== undefined) this._potMass    = parseFloat(cfg.potMass);
        if (cfg.ambientTemp !== undefined) {
            this._ambientTemp = parseFloat(cfg.ambientTemp);
            if (!this._running) {
                this._potTemp = this._ambientTemp;
                this._waterTemp = this._ambientTemp;
            }
        }
        this.config = { ...this.config, ...cfg };
        this._refreshCache();
    }

    destroy() { super.destroy?.(); }
}