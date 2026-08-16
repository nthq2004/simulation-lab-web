import { BaseComponent } from './BaseComponent.js';

/**
 * 微波炉仿真组件
 * （Microwave Oven Simulation）
 *
 * ── 结构说明 ──────────────────────────────────────────────────
 *
 *  本组件仿真家用微波炉完整工况，涵盖以下子系统：
 *
 *  【外壳与腔体结构】
 *  1.  炉体机壳（Housing）：钢板冲压外壳，背部散热
 *  2.  炉腔（Cavity）：不锈钢内腔，微波谐振腔
 *  3.  炉门（Door）：钢化玻璃 + 金属网（法拉第笼，防微波泄漏）
 *  4.  铰链与门锁（Hinge & Latch）：安全联锁，门开则停止工作
 *  5.  玻璃转盘（Glass Turntable）：带动食物旋转，均匀加热
 *  6.  转盘驱动电机（Turntable Motor）：低速同步电机，约 3 rpm
 *
 *  【微波产生系统】
 *  7.  磁控管（Magnetron）：核心发射器，产生 2.45GHz 微波
 *      - 阴极（Cathode）：发射热电子
 *      - 谐振腔（Resonant Cavity）：形成谐振，稳定频率
 *      - 天线（Antenna）：将微波耦合入炉腔
 *  8.  高压变压器（HV Transformer）：将 220V 升至 2000~4000V
 *  9.  高压电容（HV Capacitor）：倍压整流电路的一部分
 * 10.  高压二极管（HV Diode）：倍压整流
 * 11.  波导管（Waveguide）：将微波从磁控管传入炉腔
 * 12.  搅拌叶片（Stirrer Fan）：波导出口旋转叶片，散射微波使分布均匀
 *
 *  【微波传播与加热】
 * 13.  微波（Microwave，f = 2.45GHz，λ = 12.2cm）：
 *      在炉腔内多次反射，形成驻波分布
 * 14.  食物介质加热（Dielectric Heating）：
 *      水分子在 2.45GHz 交变电场中极化翻转，摩擦产热
 *      P_heat = σ_eff · |E|² · V_food
 * 15.  热分布（Thermal Distribution）：
 *      由驻波节点/波腹位置决定，转盘旋转弥补不均匀性
 *
 *  【热力仿真模型】
 * 16. 食物温度（Food Temp，Tf）：集总热容模型
 *     dTf/dt = P_micro / (m_food · Cp_food) - Q_loss
 * 17. 蒸汽（Steam）：食物含水 → 加热后冒出水蒸气
 * 18. 腔体温度（Cavity Temp，Tc）：由食物散热缓慢升温
 *
 *  【安全系统】
 * 19. 过热保护（Thermal Cutout）：腔体温度超限自动停机
 * 20. 门联锁（Door Interlock）：三重微动开关，门开停机
 * 21. 散热风扇（Cooling Fan）：冷却磁控管
 *
 *  【控制面板】
 * 22. 数码显示屏（LED Display）：倒计时、功率档位、状态
 * 23. 时间设置（Time +10s / +1min / +10min）：快捷加时按钮
 * 24. 功率选择（Power Level，P10~P100，10 档）
 * 25. 开始/暂停（Start / Pause）
 * 26. 停止/取消（Stop / Cancel）：单按暂停，双按取消清零
 * 27. 解冻功能（Defrost）：P30 功率自动解冻模式
 * 28. 快速加热（Quick Start）：直接按数字键 1~6 启动对应分钟
 *
 * ── 微波物理模型 ──────────────────────────────────────────────
 *
 *  磁控管频率：f = 2.45 GHz，波长 λ = c/f = 12.2 cm
 *
 *  介质加热功率密度：
 *      P_v = ω · ε₀ · ε''_r · |E|²
 *      ω = 2π·f，ε''_r = 水的介电损耗因子（≈ 9.4 @ 2.45GHz）
 *
 *  食物升温（集总模型，忽略内部热传导）：
 *      dTf/dt = (P_micro · η_coupling - Q_surface_loss) / (m · Cp)
 *      η_coupling ≈ 0.50~0.85（取决于食物介电特性）
 *
 *  驻波分布（腔内驻波，简化为正弦叠加）：
 *      E(x,y) ∝ sin(2πx/λ) · sin(2πy/λ)
 *      → 产生加热不均匀，转盘旋转平均化
 *
 * ── 动态仿真效果 ──────────────────────────────────────────────
 *
 *  · 玻璃转盘旋转（含食物盘，3 rpm）
 *  · 微波射线动画：从波导出口射出，炉壁多次反射，形成折线路径
 *  · 驻波热图：炉腔内周期性亮斑（热节点），随转盘旋转相位变化
 *  · 磁控管灯光脉冲（工作时阳极高亮闪烁）
 *  · 食物上冒出蒸汽（温度 > 60°C）
 *  · 炉腔内壁反光动画（微波反射）
 *  · 数码管显示倒计时（实时更新）
 *  · 功率档位 LED 指示灯
 *  · 完成时"叮"提示（状态提示文字闪烁）
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  power_port — 电源线接口（背部）
 *
 * ── 公共 API ──────────────────────────────────────────────────
 *  .start()                     — 开始加热
 *  .pause()                     — 暂停
 *  .stop()                      — 停止并清零
 *  .addTime(seconds)            — 增加时间（秒）
 *  .setPowerLevel(n)            — 设置功率 1~10（对应 P10~P100）
 *  .setDefrost(weightKg)        — 设置解冻模式
 *  .setFood(massKg, cpJ_kgK)   — 设置食物质量和比热容
 *  .openDoor() / .closeDoor()  — 开/关门
 *  .reset()                     — 全部复位
 *  .getFoodTemp()               — 获取食物温度 °C
 *  .getTimeRemaining()          — 获取剩余时间 s
 *  .update(state)               — 批量更新
 */
export class MicrowaveOven extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(380, config.width  || 500);
        this.height = Math.max(300, config.height || 420);

        this.type    = 'microwave_oven';
        this.special = 'none';
        this.cache   = 'fixed';

        // ── 铭牌参数 ──
        this.label        = config.label        || 'MW-1';
        this.ratedPower   = config.ratedPower   || 1000;  // W 额定输出
        this.inputPower   = config.inputPower   || 1350;  // W 输入
        this.frequency    = 2450e6;                       // Hz 2.45 GHz
        this.voltage      = config.voltage      || 220;

        // ── 运行状态 ──
        this._running      = false;
        this._paused       = false;
        this._doorOpen     = false;
        this._defrostMode  = false;
        this._powerLevel   = config.powerLevel  || 10;    // 1~10
        this._timeSet      = config.initTime    || 0;     // s 设定时间
        this._timeRemain   = 0;                           // s 剩余
        this._finished     = false;
        this._finishFlash  = 0;

        // ── 食物参数 ──
        this._foodMass   = config.foodMass   || 0.30;   // kg
        this._foodCp     = config.foodCp     || 3500;   // J/(kg·K) 含水食物
        this._foodTemp   = config.ambientTemp || 20;    // °C 初始温度
        this._cavityTemp = config.ambientTemp || 20;    // °C 腔体温度
        this._ambientTemp = config.ambientTemp|| 20;

        // ── 物理常数 ──
        this._etaCoupling  = 0.65;   // 微波耦合效率
        this._Qloss        = 5;      // W 食物表面散热
        this._maxCavityTemp = 100;   // °C 过热保护阈值

        // ── 动画状态 ──
        this._turntableAngle = 0;    // 转盘角度 °
        this._microPhase     = 0;    // 微波动画相位
        this._stirrerAngle   = 0;    // 搅拌叶片角度
        this._steamPhase     = 0;    // 蒸汽相位
        this._magnetronPulse = 0;    // 磁控管脉冲
        this._waveRays       = [];   // 微波射线路径（预计算）
        this._steamParticles = [];

        // ── 功率表（W，对应 P10~P100）──
        this._powerTable = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];

        // 动画状态由 consys._tickAll 统一驱动

        // ── 几何尺寸 ──
        const W = this.width, H = this.height;

        // 炉体外壳
        this._housingX = W * 0.02;
        this._housingY = H * 0.04;
        this._housingW = W * 0.96;
        this._housingH = H * 0.92;

        // 炉腔（左侧大区域）
        this._cavityX  = W * 0.04;
        this._cavityY  = H * 0.08;
        this._cavityW  = W * 0.58;
        this._cavityH  = H * 0.72;

        // 玻璃转盘
        this._turntableCX = this._cavityX + this._cavityW * 0.50;
        this._turntableCY = this._cavityY + this._cavityH * 0.78;
        this._turntableR  = this._cavityW * 0.38;

        // 食物位置（转盘中央）
        this._foodCX = this._turntableCX;
        this._foodCY = this._turntableCY - this._turntableR * 0.10;

        // 控制面板（右侧）
        this._panelX  = W * 0.64;
        this._panelY  = H * 0.04;
        this._panelW  = W * 0.34;
        this._panelH  = H * 0.92;

        // 磁控管位置（右侧腔体后方，示意）
        this._magnetronX = this._cavityX + this._cavityW + W * 0.02;
        this._magnetronY = this._cavityY + this._cavityH * 0.15;

        // 波导出口（炉腔顶部）
        this._waveguideX = this._cavityX + this._cavityW * 0.70;
        this._waveguideY = this._cavityY + 4;

        this._init();

        // 端口
        this.addPort(W * 0.50, H + 6, 'power_port', 'wire', 'AC');
    }

    // ══════════════════════════════════════════════
    _init() {
        this._precomputeWaveRays();
        this._drawHousing();
        this._drawCavity();
        this._drawDoor();
        this._drawMagnetronArea();
        this._drawWaveguide();
        this._drawTurntable();
        this._drawFood();
        this._drawControlPanel();
        this._drawLabel();
        this._buildDynamicLayers();
    }

    // ── 预计算微波折线路径（7 条，模拟反射）──────
    _precomputeWaveRays() {
        const cx = this._cavityX, cy = this._cavityY;
        const cw = this._cavityW, ch = this._cavityH;
        const wx = this._waveguideX, wy = this._waveguideY;

        this._waveRays = [];
        const dirs = [
            { dx: -0.6, dy: 0.8 }, { dx:  0.0, dy: 1.0 }, { dx:  0.6, dy: 0.8 },
            { dx: -0.9, dy: 0.4 }, { dx:  0.9, dy: 0.4 }, { dx: -0.3, dy: 0.9 },
            { dx:  0.3, dy: 0.9 },
        ];

        dirs.forEach(({ dx, dy }) => {
            const pts = [{ x: wx, y: wy }];
            let x = wx, y = wy, vx = dx, vy = dy;
            const speed = (cw + ch) * 0.28;
            for (let bounce = 0; bounce < 4; bounce++) {
                let tx, ty, nx = 0, ny = 0;
                // 找最近的墙
                let minT = Infinity;
                const walls = [
                    { nx: 1, ny: 0, d: cx },          // 左壁
                    { nx: -1,ny: 0, d: cx + cw },      // 右壁（波导侧）
                    { nx: 0, ny: 1, d: cy },            // 顶壁
                    { nx: 0, ny: -1,d: cy + ch },       // 底壁
                ];
                walls.forEach(w => {
                    let t;
                    if (w.nx !== 0) t = (w.d - x) / vx;
                    else            t = (w.d - y) / vy;
                    if (t > 1e-3 && t < minT) { minT = t; nx = w.nx; ny = w.ny; }
                });
                if (!isFinite(minT)) break;
                tx = x + vx * minT;
                ty = y + vy * minT;
                pts.push({ x: tx, y: ty });
                x = tx; y = ty;
                // 反射
                if (nx !== 0) vx = -vx;
                if (ny !== 0) vy = -vy;
            }
            this._waveRays.push(pts);
        });
    }

    // ── 炉体外壳 ───────────────────────────────────
    _drawHousing() {
        const W = this.width, H = this.height;
        const hx = this._housingX, hy = this._housingY;
        const hw = this._housingW, hh = this._housingH;

        // 外壳主体（米白/浅灰，家电质感）
        this.group.add(new Konva.Rect({
            x: hx, y: hy, width: hw, height: hh,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: hw, y: hh },
            fillLinearGradientColorStops: [
                0,   '#d8dade',
                0.3, '#e4e6ea',
                0.7, '#d0d2d8',
                1,   '#c4c6cc',
            ],
            stroke: '#a8aaae', strokeWidth: 1.5,
            cornerRadius: 10,
            shadowColor: '#000', shadowBlur: 14,
            shadowOffsetY: 5, shadowOpacity: 0.22,
        }));
        // 顶面高光
        this.group.add(new Konva.Rect({
            x: hx + 4, y: hy + 4, width: hw - 8, height: hh * 0.06,
            fill: 'rgba(255,255,255,0.40)',
            cornerRadius: [8, 8, 0, 0],
        }));
        // 品牌铭牌
        this.group.add(new Konva.Text({
            x: hx + hw * 0.30, y: hy + hh * 0.02,
            text: 'MICROWAVE',
            fontSize: 8, fontStyle: 'bold',
            fill: 'rgba(80,90,110,0.55)',
            letterSpacing: 2,
        }));
    }

    // ── 炉腔 ───────────────────────────────────────
    _drawCavity() {
        const cx = this._cavityX, cy = this._cavityY;
        const cw = this._cavityW, ch = this._cavityH;

        // 腔体内壁（不锈钢，深灰镜面）
        this.group.add(new Konva.Rect({
            x: cx, y: cy, width: cw, height: ch,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: cw, y: ch },
            fillLinearGradientColorStops: [
                0,   '#1c1e24',
                0.3, '#22262e',
                0.7, '#1a1c22',
                1,   '#141618',
            ],
            stroke: '#2a2e38', strokeWidth: 1.5,
            cornerRadius: 4,
        }));
        // 腔体内壁金属光泽（上左高光）
        this.group.add(new Konva.Rect({
            x: cx + 2, y: cy + 2, width: cw * 0.30, height: ch * 0.15,
            fill: 'rgba(255,255,255,0.04)',
            cornerRadius: [3, 0, 0, 0],
        }));

        // 腔体顶部导波板（网格纹）
        const gridY = cy + 2;
        for (let i = 0; i < 8; i++) {
            this.group.add(new Konva.Line({
                points: [cx + cw * (i / 8), gridY, cx + cw * (i / 8), gridY + 6],
                stroke: 'rgba(120,140,160,0.20)', strokeWidth: 0.5,
            }));
        }

        // 腔体底板（略浅）
        this.group.add(new Konva.Rect({
            x: cx + 2, y: cy + ch * 0.88,
            width: cw - 4, height: ch * 0.12,
            fill: 'rgba(255,255,255,0.04)',
            cornerRadius: [0, 0, 3, 3],
        }));
    }

    // ── 炉门（钢化玻璃+金属网）──────────────────
    _drawDoor() {
        const cx = this._cavityX, cy = this._cavityY;
        const cw = this._cavityW, ch = this._cavityH;

        // 门框（叠在炉腔前方）
        this._doorFrame = new Konva.Rect({
            x: cx, y: cy, width: cw, height: ch,
            fill: 'transparent',
            stroke: '#3a3e4a', strokeWidth: 3,
            cornerRadius: 4,
        });
        this.group.add(this._doorFrame);

        // 钢化玻璃（半透明暗绿）
        this._doorGlass = new Konva.Rect({
            x: cx + 3, y: cy + 3,
            width: cw - 6, height: ch - 6,
            fill: 'rgba(20,40,30,0.65)',
            stroke: '#2a3030', strokeWidth: 0.8,
            cornerRadius: 2,
        });
        this.group.add(this._doorGlass);

        // 金属防护网（均匀点阵，模拟法拉第笼网孔）
        const dotGap = 9;
        const dW = cw - 12, dH = ch - 12;
        const cols = Math.floor(dW / dotGap);
        const rows = Math.floor(dH / dotGap);
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const dx = cx + 6 + c * dotGap;
                const dy = cy + 6 + r * dotGap;
                this.group.add(new Konva.Circle({
                    x: dx, y: dy, radius: 1.2,
                    fill: 'rgba(60,80,70,0.50)',
                    listening: false,
                }));
            }
        }

        // 门铰链（左侧）
        [cy + ch * 0.12, cy + ch * 0.88].forEach(hy => {
            this.group.add(new Konva.Rect({
                x: cx - 6, y: hy - 8, width: 8, height: 16,
                fill: '#8a8e98', stroke: '#606470', strokeWidth: 0.8,
                cornerRadius: 2,
            }));
        });

        // 门把手（右侧）
        this._doorHandle = new Konva.Rect({
            x: cx + cw + 2, y: cy + ch * 0.35,
            width: 8, height: ch * 0.30,
            fill: '#9a9ea8', stroke: '#6a6e78', strokeWidth: 0.8,
            cornerRadius: 4,
            cursor: 'pointer',
        });
        this.group.add(this._doorHandle);
        this._doorHandle.on('click tap', () => this._toggleDoor());

        // 观察窗标注
        this.group.add(new Konva.Text({
            x: cx + cw * 0.25, y: cy + ch * 0.03,
            text: '金属网（法拉第笼）',
            fontSize: 6.5, fill: 'rgba(100,130,110,0.60)',
        }));
    }

    // ── 磁控管区域（右侧外壳内，示意）─────────────
    _drawMagnetronArea() {
        const W = this.width, H = this.height;
        const mx = this._magnetronX, my = this._magnetronY;
        const mw = W * 0.08, mh = H * 0.30;

        // 磁控管外壳（铝合金散热片）
        this.group.add(new Konva.Rect({
            x: mx, y: my, width: mw, height: mh,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: mw, y: 0 },
            fillLinearGradientColorStops: [
                0,'#4a4a52',0.4,'#6a6a72',0.7,'#5a5a62',1,'#3a3a42',
            ],
            stroke: '#2a2a32', strokeWidth: 1,
            cornerRadius: 3,
        }));
        // 散热片（横向细线）
        for (let i = 0; i < 10; i++) {
            const fy = my + (i / 10) * mh + 4;
            this.group.add(new Konva.Line({
                points: [mx, fy, mx + mw, fy],
                stroke: 'rgba(30,30,38,0.6)', strokeWidth: 1.5,
            }));
        }

        // 磁控管天线（顶部小圆柱）
        this.group.add(new Konva.Rect({
            x: mx + mw * 0.35, y: my - 10,
            width: mw * 0.30, height: 12,
            fill: '#b87333', stroke: '#8a5520', strokeWidth: 0.8,
            cornerRadius: [3, 3, 0, 0],
        }));

        // 磁控管脉冲指示（动态，工作时橙红闪烁）
        this._magnetronIndicator = new Konva.Circle({
            x: mx + mw * 0.50, y: my + mh * 0.30,
            radius: mw * 0.20,
            fill: '#1a1218',
            stroke: '#3a2030', strokeWidth: 1,
        });
        this.group.add(this._magnetronIndicator);

        // 高压变压器（磁控管下方）
        this.group.add(new Konva.Rect({
            x: mx, y: my + mh + 6, width: mw, height: H * 0.12,
            fill: '#1a1a22', stroke: '#2a2a30', strokeWidth: 0.8,
            cornerRadius: 2,
        }));
        this.group.add(new Konva.Text({
            x: mx + 2, y: my + mh + 8,
            text: 'HV\nXfmr',
            fontSize: 6, fill: '#4a5060', lineHeight: 1.4,
        }));

        // 高压电容
        this.group.add(new Konva.Ellipse({
            x: mx + mw * 0.50, y: my + mh + H * 0.18,
            radiusX: mw * 0.25, radiusY: H * 0.04,
            fill: '#1a3a5a', stroke: '#1565c0', strokeWidth: 0.8,
        }));
        this.group.add(new Konva.Text({
            x: mx + 1, y: my + mh + H * 0.18,
            text: 'HV\nCap', fontSize: 5.5, fill: '#4a90c0',
            lineHeight: 1.3,
        }));

        // 标注
        this.group.add(new Konva.Text({
            x: mx - 2, y: my - 16,
            text: '磁控管\n2.45GHz',
            fontSize: 6.5, fill: '#9a7a40', fontStyle: 'bold',
            lineHeight: 1.3,
        }));
    }

    // ── 波导管（磁控管→腔顶）──────────────────────
    _drawWaveguide() {
        const wx = this._waveguideX, wy = this._waveguideY;
        const mx = this._magnetronX + this.width * 0.04;

        // 波导管路径
        this.group.add(new Konva.Line({
            points: [mx, this._magnetronY + 10, mx, wy, wx, wy],
            stroke: '#5a5a62', strokeWidth: 5,
            lineCap: 'round', lineJoin: 'round',
        }));
        this.group.add(new Konva.Line({
            points: [mx, this._magnetronY + 10, mx, wy, wx, wy],
            stroke: 'rgba(255,255,255,0.10)',
            strokeWidth: 1.5, lineCap: 'round', lineJoin: 'round',
        }));

        // 搅拌叶片（波导出口）
        this._stirrerGroup = new Konva.Group({ x: wx, y: wy + 6 });
        for (let i = 0; i < 4; i++) {
            const ang = (i / 4) * 360;
            this._stirrerGroup.add(new Konva.Line({
                points: [0, 0, 16, 0],
                stroke: '#8a9090', strokeWidth: 2,
                lineCap: 'round', rotation: ang,
            }));
        }
        this._stirrerGroup.add(new Konva.Circle({
            radius: 3, fill: '#6a7078',
        }));
        this.group.add(this._stirrerGroup);

        // 波导口标注
        this.group.add(new Konva.Text({
            x: wx + 8, y: wy + 2,
            text: '波导 / 搅拌叶片',
            fontSize: 6, fill: '#606870',
        }));
    }

    // ── 玻璃转盘 ──────────────────────────────────
    _drawTurntable() {
        const tx = this._turntableCX, ty = this._turntableCY;
        const tr = this._turntableR;

        // 转盘支撑架（三叉，动态）
        this._turntableGroup = new Konva.Group({ x: tx, y: ty });

        // 玻璃盘（透明圆）
        this._turntableGroup.add(new Konva.Circle({
            radius: tr,
            fill: 'rgba(80,160,130,0.18)',
            stroke: 'rgba(100,180,150,0.45)',
            strokeWidth: 1.5,
        }));
        // 玻璃盘高光
        this._turntableGroup.add(new Konva.Ellipse({
            x: -tr * 0.25, y: -tr * 0.25,
            radiusX: tr * 0.35, radiusY: tr * 0.20,
            fill: 'rgba(255,255,255,0.08)',
        }));
        // 三叉支撑臂
        for (let i = 0; i < 3; i++) {
            const ang = (i / 3) * Math.PI * 2;
            this._turntableGroup.add(new Konva.Line({
                points: [0, 0,
                    Math.cos(ang) * tr * 0.82,
                    Math.sin(ang) * tr * 0.82],
                stroke: 'rgba(100,120,110,0.55)',
                strokeWidth: 2, lineCap: 'round',
            }));
        }
        // 转盘中心轴
        this._turntableGroup.add(new Konva.Circle({
            radius: 4,
            fill: '#505860', stroke: '#3a4048', strokeWidth: 1,
        }));

        this.group.add(this._turntableGroup);
    }

    // ── 食物（碗+内容）──────────────────────────────
    _drawFood() {
        const fx = this._foodCX, fy = this._foodCY;
        const W  = this.width;
        const bR = W * 0.075;

        // 食物组（随转盘旋转）
        this._foodGroup = new Konva.Group({ x: fx, y: fy });

        // 碗（侧视椭圆）
        this._foodGroup.add(new Konva.Ellipse({
            x: 0, y: 0,
            radiusX: bR, radiusY: bR * 0.40,
            fillLinearGradientStartPoint: { x: -bR, y: 0 },
            fillLinearGradientEndPoint:   { x:  bR, y: 0 },
            fillLinearGradientColorStops: [0,'#c8cac0',0.5,'#e0e2d8',1,'#b0b2a8'],
            stroke: '#909290', strokeWidth: 1,
        }));
        // 碗内食物（汤/饭，棕色）
        this._foodFill = new Konva.Ellipse({
            x: 0, y: -bR * 0.05,
            radiusX: bR * 0.82, radiusY: bR * 0.28,
            fill: '#8a6840',
        });
        this._foodGroup.add(this._foodFill);
        // 碗口椭圆
        this._foodGroup.add(new Konva.Ellipse({
            x: 0, y: -bR * 0.08,
            radiusX: bR, radiusY: bR * 0.32,
            fill: 'transparent',
            stroke: '#909290', strokeWidth: 1,
        }));

        this.group.add(this._foodGroup);

        // 食物温度标注
        this._foodTempText = new Konva.Text({
            x: fx - 28, y: fy - bR * 0.80,
            text: `食物 ${this._foodTemp.toFixed(1)}°C`,
            fontSize: 7.5, fill: 'rgba(200,180,120,0.80)',
            fontStyle: 'bold',
        });
        this.group.add(this._foodTempText);
    }

    // ── 控制面板（右侧）──────────────────────────
    _drawControlPanel() {
        const W = this.width, H = this.height;
        const px = this._panelX, py = this._panelY;
        const pw = this._panelW, ph = this._panelH;

        // 面板底板
        this.group.add(new Konva.Rect({
            x: px, y: py, width: pw, height: ph,
            fill: '#1e2028', stroke: '#2a2e3a', strokeWidth: 1,
            cornerRadius: [0, 8, 8, 0],
        }));

        // ── 数码显示屏 ──
        const dispX = px + pw * 0.06;
        const dispY = py + ph * 0.05;
        const dispW = pw * 0.88;
        const dispH = ph * 0.18;

        this.group.add(new Konva.Rect({
            x: dispX, y: dispY, width: dispW, height: dispH,
            fill: '#040808', stroke: '#102018', strokeWidth: 1,
            cornerRadius: 4,
        }));
        // 显示屏高光
        this.group.add(new Konva.Rect({
            x: dispX + 2, y: dispY + 2, width: dispW - 4, height: dispH * 0.25,
            fill: 'rgba(0,255,100,0.03)',
            cornerRadius: [3, 3, 0, 0],
        }));

        // 时间显示（主显示）
        this._dispTime = new Konva.Text({
            x: dispX + pw * 0.04, y: dispY + dispH * 0.08,
            text: '0:00', fontSize: 26,
            fill: '#00cc44', fontStyle: 'bold',
            fontFamily: 'monospace',
        });
        this.group.add(this._dispTime);

        // 功率/状态副显示
        this._dispStatus = new Konva.Text({
            x: dispX + pw * 0.04, y: dispY + dispH * 0.68,
            text: `P${this._powerLevel * 10}  待机`,
            fontSize: 9, fill: '#008833', fontFamily: 'monospace',
        });
        this.group.add(this._dispStatus);

        // 显示屏功率指示点（10 个）
        this._powerDots = [];
        for (let i = 0; i < 10; i++) {
            const dot = new Konva.Circle({
                x: dispX + dispW * (0.08 + i * 0.085),
                y: dispY + dispH * 0.88,
                radius: 2.8,
                fill: i < this._powerLevel ? '#00cc44' : '#0a1a10',
            });
            this.group.add(dot);
            this._powerDots.push(dot);
        }

        // ── 按钮区 ──
        const btnAreaY = dispY + dispH + ph * 0.03;

        // 快速加时按钮 (+10s / +1min / +10min)
        const timeLabels = ['+10s', '+1分', '+10分'];
        this._timeBtns = [];
        timeLabels.forEach((lbl, i) => {
            const bx = px + pw * (0.08 + i * 0.30);
            const by = btnAreaY;
            const bw = pw * 0.25, bh = ph * 0.072;
            const btn = new Konva.Rect({
                x: bx, y: by, width: bw, height: bh,
                fill: '#252a36', stroke: '#363c4a', strokeWidth: 0.8,
                cornerRadius: 5, cursor: 'pointer',
            });
            const txt = new Konva.Text({
                x: bx + bw * 0.50, y: by + bh * 0.28,
                text: lbl, fontSize: 9, fill: '#9aa0b0',
                align: 'center', offsetX: 0,
            });
            // 居中
            txt.x(bx + (bw - txt.width()) / 2);
            btn.on('click tap', () => {
                const secs = [10, 60, 600][i];
                this.addTime(secs);
            });
            this.group.add(btn, txt);
            this._timeBtns.push({ btn, txt });
        });

        // 功率按钮（−功率 / +功率）
        const pwrY = btnAreaY + ph * 0.11;
        const pwrBtnLabels = ['功率−', '解冻', '功率+'];
        this._pwrBtns = [];
        pwrBtnLabels.forEach((lbl, i) => {
            const bx = px + pw * (0.08 + i * 0.30);
            const by = pwrY;
            const bw = pw * 0.25, bh = ph * 0.072;
            const btn = new Konva.Rect({
                x: bx, y: by, width: bw, height: bh,
                fill: '#2a2030', stroke: '#3a3040', strokeWidth: 0.8,
                cornerRadius: 5, cursor: 'pointer',
            });
            const txt = new Konva.Text({
                x: bx, y: by + bh * 0.28,
                text: lbl, fontSize: 8.5, fill: '#8090a0',
                width: bw, align: 'center',
            });
            btn.on('click tap', () => {
                if (i === 0) this.setPowerLevel(this._powerLevel - 1);
                else if (i === 1) this.setDefrost();
                else this.setPowerLevel(this._powerLevel + 1);
            });
            this.group.add(btn, txt);
            this._pwrBtns.push({ btn, txt });
        });

        // 数字快捷键（1~6，快速加热 1~6 分钟）
        const numY = pwrY + ph * 0.11;
        this._numBtns = [];
        for (let n = 1; n <= 6; n++) {
            const col = (n - 1) % 3, row = Math.floor((n - 1) / 3);
            const bx = px + pw * (0.08 + col * 0.30);
            const by = numY + row * ph * 0.098;
            const bw = pw * 0.25, bh = ph * 0.080;
            const btn = new Konva.Rect({
                x: bx, y: by, width: bw, height: bh,
                fill: '#1e2430', stroke: '#2a3040', strokeWidth: 0.8,
                cornerRadius: 5, cursor: 'pointer',
            });
            const txt = new Konva.Text({
                x: bx, y: by + bh * 0.22,
                text: `${n}`, fontSize: 14, fill: '#6a7890',
                fontStyle: 'bold', width: bw, align: 'center',
            });
            const lbl = new Konva.Text({
                x: bx, y: by + bh * 0.62,
                text: `${n}分钟`, fontSize: 6, fill: '#404858',
                width: bw, align: 'center',
            });
            btn.on('click tap', () => {
                this._timeSet = n * 60;
                this._timeRemain = this._timeSet;
                if (!this._running) this.start();
                this._updateDisplay();
            });
            this.group.add(btn, txt, lbl);
            this._numBtns.push({ btn, txt, lbl });
        }

        // ── 开始 / 停止 大按钮 ──
        const ctrlY = numY + ph * 0.21;

        // 开始/暂停按钮（绿）
        const startBx = px + pw * 0.08;
        const startBW = pw * 0.55, startBH = ph * 0.095;
        this._startBtn = new Konva.Rect({
            x: startBx, y: ctrlY,
            width: startBW, height: startBH,
            fill: '#183a20', stroke: '#00cc44', strokeWidth: 1.5,
            cornerRadius: 6, cursor: 'pointer',
        });
        this._startBtnText = new Konva.Text({
            x: startBx, y: ctrlY + startBH * 0.28,
            text: '▶  开始', fontSize: 13,
            fill: '#00cc44', fontStyle: 'bold',
            width: startBW, align: 'center',
        });
        this._startBtn.on('click tap', () => {
            if (this._running) this.pause();
            else this.start();
        });
        this._startBtnText.on('click tap', () => {
            if (this._running) this.pause();
            else this.start();
        });
        this.group.add(this._startBtn, this._startBtnText);

        // 停止按钮（红）
        const stopBx = startBx + startBW + pw * 0.04;
        const stopBW = pw * 0.28;
        this._stopBtn = new Konva.Rect({
            x: stopBx, y: ctrlY,
            width: stopBW, height: startBH,
            fill: '#3a1a18', stroke: '#cc2222', strokeWidth: 1.5,
            cornerRadius: 6, cursor: 'pointer',
        });
        this._stopBtnText = new Konva.Text({
            x: stopBx, y: ctrlY + startBH * 0.28,
            text: '■ 取消', fontSize: 11,
            fill: '#cc2222', fontStyle: 'bold',
            width: stopBW, align: 'center',
        });
        this._stopBtn.on('click tap', () => this.stop());
        this._stopBtnText.on('click tap', () => this.stop());
        this.group.add(this._stopBtn, this._stopBtnText);

        [this._startBtn, this._startBtnText, this._stopBtn, this._stopBtnText,
         ...this._timeBtns.map(b => [b.btn, b.txt]).flat(),
         ...this._pwrBtns.map(b => [b.btn, b.txt]).flat(),
         ...this._numBtns.map(b => [b.btn, b.txt, b.lbl]).flat(),
        ].forEach(n => n.listening(true));

        // 面板底部信息
        this.group.add(new Konva.Text({
            x: px + pw * 0.06, y: py + ph * 0.93,
            text: `${this.ratedPower}W  2.45GHz  ${this.voltage}V`,
            fontSize: 7, fill: '#3a4050',
        }));
    }

    // ── 组件标注 ───────────────────────────────────
    _drawLabel() {
        const W = this.width;
        this.group.add(new Konva.Text({
            x: 0, y: -18, width: W,
            text: `${this.label}  微波炉  ${this.ratedPower}W  2.45GHz  ${this.voltage}V`,
            fontSize: 9, fontStyle: 'bold', fill: '#546e7a', align: 'center',
        }));
    }

    // ── 动态层（微波射线 / 热图 / 蒸汽）──────────
    _buildDynamicLayers() {
        const W = this.width, H = this.height;
        const cx = this._cavityX, cy = this._cavityY;
        const cw = this._cavityW, ch = this._cavityH;

        // 微波射线层
        this._waveGroup = new Konva.Group();
        this.group.add(this._waveGroup);

        // 每条折线路径
        this._waveLineNodes = this._waveRays.map(pts => {
            const flat = pts.flatMap(p => [p.x, p.y]);
            const line = new Konva.Line({
                points: flat, stroke: '#00ff88',
                strokeWidth: 1.2, opacity: 0,
                dash: [4, 3], listening: false,
            });
            this._waveGroup.add(line);
            return line;
        });

        // 驻波热图（热节点圆，叠加在腔内）
        this._hotspots = [];
        const hotCount = 12;
        for (let i = 0; i < hotCount; i++) {
            const hx = cx + cw * 0.10 + Math.random() * cw * 0.80;
            const hy = cy + ch * 0.10 + Math.random() * ch * 0.75;
            const spot = new Konva.Circle({
                x: hx, y: hy,
                radius: 14 + Math.random() * 10,
                fill: 'rgba(255,100,0,0.00)',
                listening: false,
            });
            this._waveGroup.add(spot);
            this._hotspots.push({ node: spot, baseX: hx, baseY: hy, phase: Math.random() });
        }

        // 蒸汽层
        this._steamGroup = new Konva.Group();
        this.group.add(this._steamGroup);
        for (let i = 0; i < 10; i++) {
            const steam = new Konva.Ellipse({
                radiusX: 5, radiusY: 2.5,
                fill: 'rgba(200,220,210,0.28)',
                opacity: 0, listening: false,
            });
            this._steamGroup.add(steam);
            this._steamParticles.push({
                node: steam, t: i / 10,
            });
        }
    }

    // ══════════════════════════════════════════════
    // 集中化 tick（由 consys._tickAll 在 20fps 调用）
    tick(dt) {
        this._tickPhysics(dt);
        this._tickAnimation(dt);
    }

    // ── 物理仿真 ──────────────────────────────────
    _tickPhysics(dt) {
        if (!this._running || this._paused || this._doorOpen) {
            // 自然冷却
            if (this._foodTemp > this._ambientTemp)
                this._foodTemp -= (this._foodTemp - this._ambientTemp) * 0.02 * dt;
            return;
        }

        // 倒计时
        this._timeRemain = Math.max(0, this._timeRemain - dt);
        if (this._timeRemain <= 0 && this._running) {
            this._running   = false;
            this._finished  = true;
            this._finishFlash = 0;
            this._updateDisplay();
            return;
        }

        // 微波输出功率
        const P_out = this._powerTable[this._powerLevel - 1];
        const P_food = P_out * this._etaCoupling;

        // 食物升温
        const Q_loss = this._Qloss;
        const dTf = (P_food - Q_loss) / (this._foodMass * this._foodCp);
        this._foodTemp = Math.min(120, this._foodTemp + dTf * dt);

        // 腔体缓慢升温
        this._cavityTemp = Math.min(60,
            this._cavityTemp + 0.1 * dt);

        // 过热保护
        if (this._cavityTemp >= this._maxCavityTemp) {
            this.stop();
            return;
        }

        this._updateDisplay();
    }

    // ── 动画步进 ──────────────────────────────────
    _tickAnimation(dt) {
        const active = this._running && !this._paused && !this._doorOpen;

        // ── 转盘旋转（3 rpm）──
        if (active) {
            this._turntableAngle += dt * 3 * 6; // 3rpm → 18°/s
            this._turntableGroup.rotation(this._turntableAngle);
            this._foodGroup.rotation(this._turntableAngle);
        }

        // ── 搅拌叶片旋转（较快）──
        if (active) {
            this._stirrerAngle += dt * 180;
            this._stirrerGroup.rotation(this._stirrerAngle);
        }

        // ── 微波动画 ──
        this._microPhase = (this._microPhase + dt * 4) % 1;

        const str = active ? (this._powerLevel / 10) : 0;

        // 折线微波射线（分段淡入淡出，相位不同）
        this._waveLineNodes.forEach((line, i) => {
            if (!active) { line.opacity(0); return; }
            const ph = (this._microPhase + i * 0.14) % 1;
            const alpha = str * 0.60 * Math.sin(ph * Math.PI);
            line.opacity(Math.max(0, alpha));
            line.dashOffset(-(this._microPhase * 20 + i * 8));
            // 颜色随功率变化（绿→黄→橙）
            const hue = 140 - this._powerLevel * 8;
            line.stroke(`hsl(${hue},100%,55%)`);
        });

        // 驻波热图（随转盘相位变化）
        this._hotspots.forEach((hs, i) => {
            if (!active) { hs.node.fill('rgba(255,100,0,0.00)'); return; }
            const ph = (this._microPhase * 2 + hs.phase + this._turntableAngle / 360) % 1;
            const intensity = str * 0.12 * (0.4 + 0.6 * Math.abs(Math.sin(ph * Math.PI)));
            hs.node.fill(`rgba(255,100,0,${intensity})`);
        });

        // ── 磁控管脉冲 ──
        if (active) {
            this._magnetronPulse = (this._magnetronPulse + dt * 8) % 1;
            const pulse = 0.35 + 0.65 * Math.sin(this._magnetronPulse * Math.PI * 2);
            const r = Math.round(100 + pulse * 155);
            const g = Math.round(pulse * 60);
            this._magnetronIndicator.fill(`rgb(${r},${g},0)`);
            this._magnetronIndicator.shadowColor(`rgb(${r},${g},0)`);
            this._magnetronIndicator.shadowBlur(pulse * 10);
            this._magnetronIndicator.shadowOpacity(0.8);
        } else {
            this._magnetronIndicator.fill('#1a1218');
            this._magnetronIndicator.shadowBlur(0);
        }

        // ── 蒸汽（食物温度 > 55°C）──
        this._steamPhase = (this._steamPhase + dt * 0.8) % 1;
        const steamStr = active ? Math.max(0, (this._foodTemp - 55) / 65) : 0;

        this._steamParticles.forEach((s, i) => {
            if (steamStr < 0.01) { s.node.opacity(0); return; }
            const t = (s.t + this._steamPhase) % 1;
            const fx = this._foodCX + Math.sin(t * Math.PI * 3 + i) * this._width * 0.04;
            const fy = this._foodCY - this._width * 0.035 - t * this._height * 0.10;
            const alpha = steamStr * (t < 0.25 ? t * 4 : t > 0.7 ? (1 - t) * 3.33 : 1) * 0.5;
            s.node.x(fx);
            s.node.y(fy);
            s.node.radiusX(5 + t * 14);
            s.node.radiusY(2.5 + t * 7);
            s.node.opacity(alpha);
        });

        // ── 食物颜色（随温度加深）──
        if (this._foodFill) {
            const tf = Math.min(1, (this._foodTemp - 20) / 100);
            const r = Math.round(138 + tf * 40);
            const g = Math.round(104 - tf * 30);
            const b = Math.round(64  - tf * 20);
            this._foodFill.fill(`rgb(${r},${g},${b})`);
        }

        // ── 食物温度标注 ──
        this._foodTempText?.text(`食物 ${this._foodTemp.toFixed(1)}°C`);

        // ── 完成闪烁 ──
        if (this._finished) {
            this._finishFlash += dt * 3;
            const fb = Math.sin(this._finishFlash) > 0;
            this._dispTime?.fill(fb ? '#00ff88' : '#004422');
        }

        this._refreshCache();
    }

    _updateDisplay() {
        const remain = this._timeRemain;
        const mins = Math.floor(remain / 60);
        const secs = Math.floor(remain % 60);
        const timeStr = `${mins}:${String(secs).padStart(2, '0')}`;

        this._dispTime?.text(timeStr);
        if (!this._finished) {
            this._dispTime?.fill('#00cc44');
        }

        const modeStr = this._defrostMode ? '解冻' :
                        this._running  ? '加热中' :
                        this._paused   ? '暂停' :
                        this._finished ? '完成！' : '待机';
        this._dispStatus?.text(`P${this._powerLevel * 10}  ${modeStr}`);

        // 功率点
        this._powerDots?.forEach((dot, i) => {
            dot.fill(i < this._powerLevel ? '#00cc44' : '#0a1a10');
        });

        // 开始按钮文字
        if (this._startBtnText) {
            if (this._running) {
                this._startBtnText.text('⏸  暂停');
                this._startBtn.stroke('#cc8800');
                this._startBtnText.fill('#cc8800');
                this._startBtn.fill('#2a2010');
            } else {
                this._startBtnText.text('▶  开始');
                this._startBtn.stroke('#00cc44');
                this._startBtnText.fill('#00cc44');
                this._startBtn.fill('#183a20');
            }
        }
    }

    _toggleDoor() {
        this._doorOpen ? this.closeDoor() : this.openDoor();
    }

    // ══════════════════════════════════════════════
    // ── 公共 API ──────────────────────────────────

    start() {
        if (this._doorOpen) return;
        if (this._timeRemain <= 0 && this._timeSet > 0)
            this._timeRemain = this._timeSet;
        if (this._timeRemain <= 0) this._timeRemain = 30; // 默认30s
        this._running  = true;
        this._paused   = false;
        this._finished = false;
        this._updateDisplay();
        this._refreshCache();
    }

    pause() {
        if (!this._running) return;
        this._paused  = !this._paused;
        this._running = !this._paused;
        this._updateDisplay();
        this._refreshCache();
    }

    stop() {
        this._running   = false;
        this._paused    = false;
        this._finished  = false;
        this._timeRemain = 0;
        this._timeSet    = 0;
        this._defrostMode = false;
        this._updateDisplay();
        this._refreshCache();
    }

    addTime(seconds) {
        this._timeSet    = (this._timeSet || 0) + seconds;
        this._timeRemain = (this._timeRemain || 0) + seconds;
        this._finished   = false;
        if (this._timeRemain > 6000) {
            this._timeRemain = 6000;
            this._timeSet    = 6000;
        }
        if (!this._running) this.start();
        this._updateDisplay();
        this._refreshCache();
    }

    setPowerLevel(n) {
        this._powerLevel = Math.max(1, Math.min(10, Math.round(n)));
        this._defrostMode = false;
        this._updateDisplay();
        this._refreshCache();
    }

    setDefrost(weightKg) {
        this._defrostMode = true;
        this._powerLevel  = 3; // P30
        if (weightKg) {
            // 每 100g 约 4 分钟
            this._timeSet    = Math.round(weightKg * 4 * 60);
            this._timeRemain = this._timeSet;
        }
        this._updateDisplay();
        this._refreshCache();
    }

    setFood(massKg, cpJ_kgK) {
        this._foodMass = massKg  || this._foodMass;
        this._foodCp   = cpJ_kgK || this._foodCp;
    }

    openDoor() {
        this._doorOpen = true;
        if (this._running) {
            this._running = false;
            this._paused  = true;
        }
        if (this._doorGlass) this._doorGlass.fill('rgba(20,40,30,0.20)');
        this._updateDisplay();
        this._refreshCache();
    }

    closeDoor() {
        this._doorOpen = false;
        if (this._doorGlass) this._doorGlass.fill('rgba(20,40,30,0.65)');
        this._updateDisplay();
        this._refreshCache();
    }

    reset() {
        this.stop();
        this._foodTemp    = this._ambientTemp;
        this._cavityTemp  = this._ambientTemp;
        this._turntableAngle = 0;
        if (this._turntableGroup) this._turntableGroup.rotation(0);
        if (this._foodGroup)      this._foodGroup.rotation(0);
        this._updateDisplay();
        this._refreshCache();
    }

    getFoodTemp()      { return this._foodTemp; }
    getCavityTemp()    { return this._cavityTemp; }
    getTimeRemaining() { return this._timeRemain; }
    isRunning()        { return this._running; }
    isPaused()         { return this._paused; }
    isDoorOpen()       { return this._doorOpen; }
    isFinished()       { return this._finished; }

    update(state) {
        if (typeof state === 'object' && state !== null) {
            if (state.running      !== undefined) state.running ? this.start() : this.stop();
            if (state.powerLevel   !== undefined) this.setPowerLevel(state.powerLevel);
            if (state.time         !== undefined) { this._timeSet = state.time; this._timeRemain = state.time; }
            if (state.foodMass     !== undefined) this._foodMass  = state.foodMass;
            if (state.doorOpen     !== undefined) state.doorOpen ? this.openDoor() : this.closeDoor();
            if (state.defrost      !== undefined) this.setDefrost(state.defrost);
        }
        this._updateDisplay();
        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label: '位号/名称',          key: 'label',        type: 'text'   },
            { label: '额定输出功率 (W)',    key: 'ratedPower',   type: 'number' },
            { label: '电源电压 (V)',        key: 'voltage',      type: 'number' },
            { label: '功率档位 (1~10)',     key: 'powerLevel',   type: 'number' },
            { label: '初始设定时间 (s)',    key: 'initTime',     type: 'number' },
            { label: '食物质量 (kg)',       key: 'foodMass',     type: 'number' },
            { label: '食物比热容 J/(kg·K)','key': 'foodCp',      type: 'number' },
            { label: '环境温度 (°C)',       key: 'ambientTemp',  type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        this.label       = cfg.label       || this.label;
        this.ratedPower  = parseFloat(cfg.ratedPower) || this.ratedPower;
        this.voltage     = parseFloat(cfg.voltage)    || this.voltage;
        if (cfg.powerLevel  !== undefined) this.setPowerLevel(parseFloat(cfg.powerLevel));
        if (cfg.initTime    !== undefined) { this._timeSet = parseFloat(cfg.initTime); }
        if (cfg.foodMass    !== undefined) this._foodMass  = parseFloat(cfg.foodMass);
        if (cfg.foodCp      !== undefined) this._foodCp    = parseFloat(cfg.foodCp);
        if (cfg.ambientTemp !== undefined) this._ambientTemp = parseFloat(cfg.ambientTemp);
        this.config = { ...this.config, ...cfg };
        this._refreshCache();
    }

    destroy() { super.destroy?.(); }
}