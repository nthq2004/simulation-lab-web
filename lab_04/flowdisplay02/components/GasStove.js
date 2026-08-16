import { BaseComponent } from './BaseComponent.js';

/**
 * 家用天然气灶仿真组件
 * （Domestic Natural Gas Stove — Dual Burner）
 *
 * ══════════════════════════════════════════════════════════════════════
 *  重点仿真：点火系统 + 火焰探针（热电偶）工作原理
 * ══════════════════════════════════════════════════════════════════════
 *
 * ──────────────────────────────────────────────────────────────────────
 *  一、点火系统（Electronic Ignition System）
 * ──────────────────────────────────────────────────────────────────────
 *
 *  1. 压电陶瓷点火器（Piezo Igniter）
 *     旋钮按下时机械撞击压电陶瓷（PZT，锆钛酸铅）
 *     → 压电效应：晶格形变 → 产生高压脉冲（约 5,000～15,000V）
 *     → 通过高压导线传至点火针（Spark Plug）
 *     → 点火针与炉头接地极之间形成电弧放电（间距 3～5mm）
 *     → 引燃混合气体
 *
 *  2. 电子脉冲点火器（Electronic Pulse Igniter，部分型号）
 *     电池（1.5V AA×2）驱动振荡电路
 *     → 升压变压器 → 高压脉冲（约 3～8Hz）
 *     → 同时触发所有炉头点火针
 *     本仿真采用此方案（更易演示脉冲过程）
 *
 *  点火电路原理框图：
 *    [电池 1.5V×2]
 *        ↓
 *    [振荡器 IC（555/专用）]  频率 ≈ 5Hz
 *        ↓
 *    [升压变压器]  初级 3V → 次级 ~10kV
 *        ↓
 *    [高压分配器]  → 左炉点火针 → 电弧 → 接地极
 *                  → 右炉点火针 → 电弧 → 接地极
 *
 *  点火针结构：
 *    - 针体：镍铬合金（Ni-Cr），耐高温高压
 *    - 绝缘体：氧化铝陶瓷（Al₂O₃），隔离高压与炉头金属
 *    - 间隙：3～5mm，通过电场击穿空气放电
 *    - 放电特征：蓝白色弧光，伴随"噼啪"声
 *
 * ──────────────────────────────────────────────────────────────────────
 *  二、火焰探针（Flame Probe / Thermocouple Safety Device）
 * ──────────────────────────────────────────────────────────────────────
 *
 *  安全保护原理（防止燃气泄漏）：
 *
 *  方案 A — 热电偶式（本仿真采用，家用灶主流）
 *
 *    结构：
 *      K 型热电偶（镍铬-镍铝，Ni-Cr / Ni-Al）
 *      探针顶端暴露在火焰焰心附近（约 300～600℃）
 *      冷端（参考端）在炉体内部（约室温 25℃）
 *
 *    工作原理（塞贝克效应，Seebeck Effect）：
 *      ΔT（热端 - 冷端）→ 产生热电动势 EMF
 *      K 型热电偶灵敏度 ≈ 41 μV/°C
 *      火焰稳定时 ΔT ≈ 400℃ → EMF ≈ 16.4 mV
 *
 *    与燃气电磁安全阀的联动：
 *      [热电偶 EMF] → [电磁安全阀线圈（约 10Ω）]
 *      → 线圈电流 I = EMF/R = 16.4mV/10Ω = 1.64mA
 *      → 产生磁力 F，吸住衔铁，保持气阀开启
 *
 *    断火保护过程：
 *      火焰熄灭 → ΔT↓ → EMF↓ → 线圈电流↓ → 磁力不足
 *      → 弹簧将衔铁推开 → 气阀关闭（约 10～30s 响应时间）
 *      → 燃气自动切断，防止未点燃气体泄漏
 *
 *    响应时间分析：
 *      热电偶热惯性（τ ≈ 3～8s）→ 需等热端冷却后 EMF 才下降
 *      安全阀响应（~1s）
 *      总断气时间：约 10～30s（设计有意偏慢，防止正常使用中误断）
 *
 *    仿真中关键参数：
 *      T_hot（热端温度，°C）：火焰焰心处，随燃烧状态变化
 *      T_cold（冷端温度，°C）：恒定室温 25°C
 *      EMF（mV）= seebeckK × (T_hot - T_cold) × 1000  [μV → mV]
 *      seebeckK = 41e-6 V/°C（K 型）
 *      valveCurrent（mA）= EMF / valveCoilR
 *      valveHoldCurrent = 1.0 mA（维持气阀开启的最小电流阈值）
 *      当 valveCurrent < valveHoldCurrent → 气阀关闭 → 燃气切断
 *
 *  方案 B — 离子火焰探针（Ion Probe，部分嵌入式灶参考）
 *      火焰中自由离子 → 导通 AC 微电流 → MCU 检测
 *      本仿真作为辅助说明展示，不作为主安全机制
 *
 * ──────────────────────────────────────────────────────────────────────
 *  三、燃气系统
 * ──────────────────────────────────────────────────────────────────────
 *
 *  燃气种类：天然气（主要成分 CH₄，热值约 35.8 MJ/m³）
 *
 *  气路流程：
 *    市政管网 → 进气口 → 燃气阀（旋钮控制）
 *    → 喷嘴（Injector Nozzle，Φ约1.2mm）
 *    → 文丘里混合管（Venturi Mixer）→ 一次空气吸入混合
 *    → 炉头分气盘（Burner Cap）→ 分气孔（约60个Φ2mm小孔）
 *    → 与二次空气混合点燃
 *
 *  燃烧特征（大气式预混燃烧）：
 *    内锥（蓝色）：预混燃烧区，温度约 500～900℃
 *    外焰（淡蓝/橙色）：扩散燃烧区，温度约 300～600℃
 *    焰心（接近无色透明）：未燃区，温度最低
 *
 *  完全燃烧方程：
 *    CH₄ + 2O₂ → CO₂ + 2H₂O + 热量（△H = -890 kJ/mol）
 *
 * ──────────────────────────────────────────────────────────────────────
 *  四、旋钮控制逻辑
 * ──────────────────────────────────────────────────────────────────────
 *
 *  旋钮操作顺序（三步）：
 *    ① 向内按压（Push）：机械联动开启燃气阀 + 触发点火脉冲
 *    ② 旋转（Rotate）：调节燃气阀开度（大火/小火/熄火）
 *    ③ 松开（Release）：点火完成后松开，热电偶维持气阀
 *
 *  档位：
 *    PRESS（按压）→ GAS_OPEN + 点火序列启动
 *    HIGH（大火）→ gasRatio = 1.0
 *    MED （中火）→ gasRatio = 0.55
 *    LOW （小火）→ gasRatio = 0.28
 *    OFF （关闭）→ gasRatio = 0 → 火焰熄灭 → 热电偶冷却 → 阀关
 *
 * ══════════════════════════════════════════════════════════════════════
 *  仿真阶段状态机
 * ══════════════════════════════════════════════════════════════════════
 *
 *  IDLE   ──[turnKnob(burner)]──►
 *  PRESSING（旋钮按下，燃气阀机械开启，约 200ms）
 *    └──►
 *  SPARKING（点火脉冲放电，3～8Hz，最长 5s）
 *    └──[火焰稳定，热电偶 EMF 超阈值]──►
 *  BURNING（正常燃烧）
 *    └──[turnOff(burner)]──►
 *  EXTINGUISHING（关闭旋钮，火焰熄灭）
 *    └──[热电偶冷却，EMF < 阈值，约 10～15s]──►  IDLE
 *  SPARKING──[超时 5s 未点燃]──►  FAIL（点火失败，蜂鸣）
 *  FAIL──[重试]──►  PRESSING
 *
 * ══════════════════════════════════════════════════════════════════════
 *  绘制分层（从底到顶）
 * ══════════════════════════════════════════════════════════════════════
 *
 *  Layer 0   炉体面板（stoveTop）—白色搪瓷 / 不锈钢面板
 *  Layer 1   炉盘结构（burnerBase）—铸铁炉盘 × 2（静态）
 *  Layer 2   火焰孔（burnerCap）—分气孔圆环（静态）
 *  Layer 3   点火针 + 热电偶（sensors）—静态结构
 *  Layer 4   旋钮（knobs）—静态底座
 *  Layer 5   _flameGroup[L/R] — 火焰动画（tick 驱动）
 *  Layer 6   _sparkGroup[L/R] — 电弧动画（tick 驱动）
 *  Layer 7   _tcGroup[L/R]    — 热电偶状态（tick 驱动）
 *  Layer 8   _knobGroup[L/R]  — 旋钮旋转动画（tick 驱动）
 *  Layer 9   _schematicGroup  — 电路原理图区（tick 驱动）
 *  Layer 10  _panelGroup      — 状态面板（tick 驱动）
 *
 * ══════════════════════════════════════════════════════════════════════
 *  端口
 * ══════════════════════════════════════════════════════════════════════
 *  gas_in      — 燃气进气口
 *  battery_pos — 电池正极（点火用）
 *  battery_neg — 电池负极
 *  tc_left     — 左炉热电偶输出（mV 信号）
 *  tc_right    — 右炉热电偶输出（mV 信号）
 */

// ═══════════════════════════════════════════════════════════════════════
//  炉头阶段枚举
// ═══════════════════════════════════════════════════════════════════════
const BURNER_STAGE = {
    IDLE:          'idle',
    PRESSING:      'pressing',      // 旋钮按下，燃气开启
    SPARKING:      'sparking',      // 点火放电中
    BURNING:       'burning',       // 正常燃烧
    EXTINGUISHING: 'extinguishing', // 熄火冷却（热电偶缓慢冷却）
    FAIL:          'fail',          // 点火失败
};

// 燃气阀开度档位
const GAS_LEVEL = { OFF:0, LOW:0.28, MED:0.55, HIGH:1.0 };

// K 型热电偶塞贝克系数
const SEEBECK_K = 41e-6;      // V/°C
const VALVE_COIL_R = 10;      // Ω，安全阀线圈电阻
const VALVE_HOLD_I = 1.0e-3;  // A，维持开启的最小电流

// ═══════════════════════════════════════════════════════════════════════
//  单炉头状态对象（内部用）
// ═══════════════════════════════════════════════════════════════════════
function makeBurnerState(id) {
    return {
        id,
        stage:        BURNER_STAGE.IDLE,
        stageTimer:   0,
        gasRatio:     0,       // 当前燃气阀开度 0～1
        gasLevel:     GAS_LEVEL.OFF,  // 目标档位
        flameTemp:    25,      // 火焰焰心温度 °C（动态）
        tcHotTemp:    25,      // 热电偶热端温度 °C
        tcColdTemp:   25,      // 热电偶冷端温度 °C（室温）
        emf:          0,       // 热电偶 EMF（V）
        valveCurrent: 0,       // 安全阀电流（A）
        valveOpen:    false,   // 安全阀是否开启
        sparkOn:      false,   // 当前是否放电
        sparkFlipT:   0,
        sparkCount:   0,
        flamePhase:   0,
        knobAngle:    -90,     // °，OFF=-90°，HIGH=0°，MED=45°，LOW=90°
        knobTarget:   -90,
        knobAnimT:    0,
        knobAnimating:false,
        igniteCount:  0,
        failCount:    0,
    };
}

// ═══════════════════════════════════════════════════════════════════════
//  燃气灶主类
// ═══════════════════════════════════════════════════════════════════════
export class GasStove extends BaseComponent {

    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(440, config.width  || 520);
        this.height = Math.max(380, config.height || 460);

        this.type    = 'gas_stove';
        this.special = 'none';
        this.cache   = 'fixed';

        this._initGroups();
        // ── 额定参数 ────────────────────────────────────────────────
        this.label        = config.label        || 'GS';
        this.ratedPowerL  = config.ratedPowerL  || 4200;   // W，左炉额定热功率（大火）
        this.ratedPowerR  = config.ratedPowerR  || 3500;   // W，右炉
        this.ambientTemp  = config.ambientTemp  || 25;     // °C
        this.sparkFreq    = config.sparkFreq    || 5;      // Hz，点火脉冲频率
        this.maxSparkTime = config.maxSparkTime || 5.0;    // s，最长点火时间
        this.tcTimeConst  = config.tcTimeConst  || 4.0;    // s，热电偶热惯性时间常数（仿真加速后）
        this.valveDelay   = config.valveDelay   || 12.0;   // s，安全阀断气延迟（仿真加速后）

        // 仿真加速（热电偶冷却过程较慢，适度加速）
        this._simScale    = config.simScale     || 2.5;

        // ── 双炉头状态 ───────────────────────────────────────────
        this._burners     = {
            L: makeBurnerState('L'),
            R: makeBurnerState('R'),
        };

        // 点火模块共享状态（电子脉冲点火器）
        this._battVoltage = 2.8;  // V，两节1.5V电池（略低于标称，模拟使用中）
        this._ignModuleOn = false; // 点火模块是否工作

        // 全局动画相位
        this._globalTimer = 0;

        // ── 布局 & 初始化 ────────────────────────────────────────
        this._layout = this._calcLayout();
        this._init();

        // ── 端口 ─────────────────────────────────────────────────
        const L = this._layout;
        this.addPort(L.gasInlet.x - 4, L.gasInlet.y + L.gasInlet.h/2, 'gas_in',      'wire', '气');
        this.addPort(L.battery.x + 6,  L.battery.y + L.battery.h + 4, 'battery_pos', 'wire', 'B+');
        this.addPort(L.battery.x + 22, L.battery.y + L.battery.h + 4, 'battery_neg', 'wire', 'B-');
        this.addPort(L.burnerL.cx - 12,L.schematic.y + L.schematic.h + 4, 'tc_left', 'wire', 'TC-L');
        this.addPort(L.burnerR.cx + 4, L.schematic.y + L.schematic.h + 4, 'tc_right','wire', 'TC-R');
    }

    // ═══════════════════════════════════════════════════════════════════
    //  布局
    // ═══════════════════════════════════════════════════════════════════
    _calcLayout() {
        const W = this.width, H = this.height;
        // 炉台面板区
        const topH    = H * 0.50;
        // 下部原理图区
        const scmY    = topH + H*0.02;
        const scmH    = H * 0.44;

        // 左炉中心
        const lcx = W * 0.28;
        const lcy = topH * 0.44;
        // 右炉中心
        const rcx = W * 0.72;
        const rcy = topH * 0.44;
        // 炉盘半径
        const outerR = W * 0.14;
        const innerR = W * 0.06;

        return {
            // 炉体面板
            stoveTop:  { x:W*0.01, y:0,    w:W*0.98, h:topH, rx:10 },
            // 左炉头
            burnerL:   { cx:lcx, cy:lcy, outerR, innerR },
            // 右炉头
            burnerR:   { cx:rcx, cy:rcy, outerR, innerR },
            // 左旋钮
            knobL:     { cx:lcx, cy:topH*0.84 },
            // 右旋钮
            knobR:     { cx:rcx, cy:topH*0.84 },
            // 进气口（左侧）
            gasInlet:  { x:W*0.01, y:topH*0.48, w:W*0.05, h:topH*0.08 },
            // 电池盒（右下角）
            battery:   { x:W*0.85, y:topH*0.74, w:W*0.12, h:topH*0.14 },
            // 原理图区（下半部）
            schematic: { x:W*0.01, y:scmY, w:W*0.98, h:scmH, rx:8 },
            // 原理图内部分区
            scmLeft:   { x:W*0.02, y:scmY+scmH*0.04, w:W*0.28, h:scmH*0.92 },  // 点火电路
            scmMid:    { x:W*0.32, y:scmY+scmH*0.04, w:W*0.36, h:scmH*0.92 },  // 热电偶原理
            scmRight:  { x:W*0.70, y:scmY+scmH*0.04, w:W*0.28, h:scmH*0.92 },  // 安全阀
        };
    }

    // ═══════════════════════════════════════════════════════════════════
    //  初始化绘制
    // ═══════════════════════════════════════════════════════════════════
    _init() {
        this._drawStovePanel();
        this._drawBurnerStatic('L');
        this._drawBurnerStatic('R');
        this._drawGasPipes();
        this._drawBattery();
        this._drawSchematicBackground();
        this._drawLabel();

        // 动态层
        this._flameGroupL  = new Konva.Group(); this._staticGroup.add(this._flameGroupL);
        this._flameGroupR  = new Konva.Group(); this._staticGroup.add(this._flameGroupR);
        this._sparkGroupL  = new Konva.Group(); this._staticGroup.add(this._sparkGroupL);
        this._sparkGroupR  = new Konva.Group(); this._staticGroup.add(this._sparkGroupR);
        this._tcGroupL     = new Konva.Group(); this._staticGroup.add(this._tcGroupL);
        this._tcGroupR     = new Konva.Group(); this._staticGroup.add(this._tcGroupR);
        this._knobGroupL   = new Konva.Group(); this._staticGroup.add(this._knobGroupL);
        this._knobGroupR   = new Konva.Group(); this._staticGroup.add(this._knobGroupR);
        this._schGroup     = new Konva.Group(); this._staticGroup.add(this._schGroup);
        this._panelGroup   = new Konva.Group(); this._staticGroup.add(this._panelGroup);

        this._bindInteraction();
    }

    // ───────────────────────────────────────────────────────────────────
    //  炉体面板（不锈钢 / 搪瓷）
    // ───────────────────────────────────────────────────────────────────
    _drawStovePanel() {
        const t = this._layout.stoveTop;
        // 主面板
        this._staticGroup.add(new Konva.Rect({
            x:t.x, y:t.y, width:t.w, height:t.h,
            fillLinearGradientStartPoint:{x:0,y:0},
            fillLinearGradientEndPoint:{x:0,y:t.h},
            fillLinearGradientColorStops:[
                0,'#d8d8d8', 0.08,'#f0f0f0', 0.50,'#e8e8e8', 1,'#c8c8c8',
            ],
            stroke:'#a0a0a0', strokeWidth:1.5, cornerRadius:t.rx,
            shadowColor:'#000', shadowBlur:6, shadowOffsetY:2, shadowOpacity:0.15,
        }));
        // 面板顶部高光
        this._staticGroup.add(new Konva.Rect({
            x:t.x+4, y:t.y+2, width:t.w-8, height:t.h*0.06,
            fill:'rgba(255,255,255,0.50)', cornerRadius:[t.rx,t.rx,0,0],
        }));
        // 中间分隔槽（铸铁锅架支撑槽）
        this._staticGroup.add(new Konva.Rect({
            x:t.x+t.w*0.46, y:t.y+t.h*0.08, width:t.w*0.08, height:t.h*0.62,
            fill:'#888', stroke:'#606060', strokeWidth:0.5, cornerRadius:3,
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    //  炉头静态结构（铸铁炉盘 + 点火针 + 热电偶）
    // ───────────────────────────────────────────────────────────────────
    _drawBurnerStatic(side) {
        const b   = side === 'L' ? this._layout.burnerL : this._layout.burnerR;
        const cx  = b.cx, cy = b.cy;
        const oR  = b.outerR, iR = b.innerR;

        // 炉架（铸铁，深灰黑）
        for (let i=0; i<4; i++) {
            const ang = (i*90 + 45) * Math.PI/180;
            this._staticGroup.add(new Konva.Line({
                points:[
                    cx + Math.cos(ang)*(iR+4), cy + Math.sin(ang)*(iR+4),
                    cx + Math.cos(ang)*oR*1.15, cy + Math.sin(ang)*oR*1.15,
                ],
                stroke:'#3a3a3a', strokeWidth:6, lineCap:'round',
            }));
        }

        // 外圈炉盘（铸铁，多层圆环）
        [oR, oR*0.82, oR*0.62].forEach((r, idx) => {
            this._staticGroup.add(new Konva.Circle({
                x:cx, y:cy, radius:r,
                fill:'none',
                stroke: idx===0 ? '#484848' : idx===1 ? '#505050' : '#404040',
                strokeWidth: idx===0 ? 10 : idx===1 ? 8 : 6,
            }));
        });

        // 炉盘顶面（铸铁纹理，深灰圆形）
        this._staticGroup.add(new Konva.Circle({
            x:cx, y:cy, radius:iR+2,
            fill:'#2a2a2a', stroke:'#404040', strokeWidth:1.5,
        }));

        // 分气孔圆环（分气盘 Burner Cap，黄铜色）
        this._staticGroup.add(new Konva.Circle({
            x:cx, y:cy, radius:oR*0.70,
            fill:'none', stroke:'#b08030', strokeWidth:5,
        }));
        // 分气小孔（12 个）
        for (let i=0; i<12; i++) {
            const ang = i * (360/12) * Math.PI/180;
            const hx  = cx + Math.cos(ang)*oR*0.70;
            const hy  = cy + Math.sin(ang)*oR*0.70;
            this._staticGroup.add(new Konva.Circle({
                x:hx, y:hy, radius:2.5,
                fill:'#1a1a1a', stroke:'#505030', strokeWidth:0.5,
            }));
        }

        // 点火针（Spark Electrode）——炉头 11 点钟方向
        const sparkAng = -50 * Math.PI/180;
        const spx = cx + Math.cos(sparkAng)*(oR*0.68);
        const spy = cy + Math.sin(sparkAng)*(oR*0.68);
        // 陶瓷绝缘体（白色短柱）
        this._staticGroup.add(new Konva.Rect({
            x:spx-3, y:spy-3, width:6, height:14,
            fill:'#e0ddc8', stroke:'#b0a890', strokeWidth:0.6, cornerRadius:2,
        }));
        // 金属针尖
        this._staticGroup.add(new Konva.Line({
            points:[spx, spy+9, spx+3, spy+14],
            stroke:'#d0d0d0', strokeWidth:1.8, lineCap:'round',
        }));
        this._staticGroup.add(new Konva.Text({
            x:spx+6, y:spy+2, text:'点火针',
            fontSize:7, fill:'#909090',
        }));

        // 热电偶探针（Thermocouple）——炉头 1 点钟方向，稍长
        const tcAng  = -30 * Math.PI/180;
        const tcpx   = cx + Math.cos(tcAng)*(oR*0.65);
        const tcpy   = cy + Math.sin(tcAng)*(oR*0.65);
        // 探针护套（不锈钢，细长圆柱）
        this._staticGroup.add(new Konva.Rect({
            x:tcpx-2, y:tcpy-4, width:4, height:20,
            fill:'#b8b8b8', stroke:'#808080', strokeWidth:0.5, cornerRadius:1,
        }));
        // 热端接头（热电偶焊接点，金黄色）
        this._staticGroup.add(new Konva.Circle({
            x:tcpx, y:tcpy+14, radius:3.5,
            fill:'#d0a030', stroke:'#a07020', strokeWidth:0.8,
        }));
        this._staticGroup.add(new Konva.Text({
            x:tcpx+6, y:tcpy+8, text:'热电偶',
            fontSize:7, fill:'#c08030',
        }));

        // 记录关键坐标（供动态层使用）
        if (side === 'L') {
            this._spL  = {x:spx,  y:spy+14};   // 点火针针尖
            this._tcL  = {x:tcpx, y:tcpy+14};  // 热电偶热端
        } else {
            this._spR  = {x:spx,  y:spy+14};
            this._tcR  = {x:tcpx, y:tcpy+14};
        }
    }

    // ───────────────────────────────────────────────────────────────────
    //  燃气管路示意
    // ───────────────────────────────────────────────────────────────────
    _drawGasPipes() {
        const gi  = this._layout.gasInlet;
        const bL  = this._layout.burnerL;
        const bR  = this._layout.burnerR;
        const W   = this.width;

        // 进气管（左侧横管，黄色标识）
        this._staticGroup.add(new Konva.Rect({
            x:gi.x, y:gi.y, width:gi.w, height:gi.h,
            fill:'#a09010', stroke:'#807008', strokeWidth:1, cornerRadius:2,
        }));
        this._staticGroup.add(new Konva.Text({
            x:gi.x, y:gi.y-10, text:'天然气',
            fontSize:7.5, fill:'#c0b020',
        }));

        // 主气管（横贯面板底部）
        const pipeY = gi.y + gi.h/2;
        this._staticGroup.add(new Konva.Line({
            points:[gi.x+gi.w, pipeY, W*0.90, pipeY],
            stroke:'#808010', strokeWidth:5, lineCap:'round',
        }));
        // 左炉支管
        this._staticGroup.add(new Konva.Line({
            points:[bL.cx, pipeY, bL.cx, bL.cy+bL.outerR*0.5],
            stroke:'#808010', strokeWidth:3.5, lineCap:'round',
        }));
        // 右炉支管
        this._staticGroup.add(new Konva.Line({
            points:[bR.cx, pipeY, bR.cx, bR.cy+bR.outerR*0.5],
            stroke:'#808010', strokeWidth:3.5, lineCap:'round',
        }));
        // 燃气阀旋钮位置标注
        this._staticGroup.add(new Konva.Text({
            x:bL.cx-16, y:pipeY-16, text:'燃气阀', fontSize:7, fill:'#909020',
        }));
        this._staticGroup.add(new Konva.Text({
            x:bR.cx-16, y:pipeY-16, text:'燃气阀', fontSize:7, fill:'#909020',
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    //  电池盒（电子点火电源）
    // ───────────────────────────────────────────────────────────────────
    _drawBattery() {
        const bt = this._layout.battery;
        this._staticGroup.add(new Konva.Rect({
            x:bt.x, y:bt.y, width:bt.w, height:bt.h,
            fill:'#202030', stroke:'#303040', strokeWidth:0.8, cornerRadius:3,
        }));
        // 两节 AA 电池
        for (let i=0; i<2; i++) {
            const bx = bt.x + 3 + i*(bt.w/2 - 2);
            this._staticGroup.add(new Konva.Rect({
                x:bx, y:bt.y+3, width:bt.w/2-4, height:bt.h-6,
                fillLinearGradientStartPoint:{x:0,y:0},
                fillLinearGradientEndPoint:{x:bt.w/2-4,y:0},
                fillLinearGradientColorStops:[0,'#304010',0.5,'#608020',1,'#304010'],
                stroke:'#405010', strokeWidth:0.5, cornerRadius:2,
            }));
            this._staticGroup.add(new Konva.Text({
                x:bx+3, y:bt.y+bt.h*0.30, text:'AA\n1.5V',
                fontSize:7, fill:'#a0c040', lineHeight:1.4,
            }));
        }
        this._staticGroup.add(new Konva.Text({
            x:bt.x, y:bt.y-10, text:'点火电源',
            fontSize:7.5, fill:'#607030',
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    //  原理图区背景（下半部）
    // ───────────────────────────────────────────────────────────────────
    _drawSchematicBackground() {
        const sc = this._layout.schematic;
        this._staticGroup.add(new Konva.Rect({
            x:sc.x, y:sc.y, width:sc.w, height:sc.h,
            fill:'#0c0c16', stroke:'#1c1c28', strokeWidth:1, cornerRadius:sc.rx,
        }));
        this._staticGroup.add(new Konva.Text({
            x:sc.x+sc.w/2-60, y:sc.y+4,
            text:'— 电路原理图 / 工作原理 —',
            fontSize:9, fill:'#404060', fontStyle:'italic',
        }));
        // 三栏分隔线
        const d1 = this._layout.scmMid.x;
        const d2 = this._layout.scmRight.x;
        [d1, d2].forEach(dx => {
            this._staticGroup.add(new Konva.Line({
                points:[dx, sc.y+12, dx, sc.y+sc.h-6],
                stroke:'#1c2030', strokeWidth:1, dash:[3,4],
            }));
        });
        // 栏标题
        const titles = [
            {x:this._layout.scmLeft.x+2,  t:'① 点火系统'},
            {x:this._layout.scmMid.x+2,   t:'② 热电偶原理'},
            {x:this._layout.scmRight.x+2, t:'③ 安全阀联动'},
        ];
        titles.forEach(({ x, t }) => {
            this._staticGroup.add(new Konva.Text({
                x, y:sc.y+14, text:t,
                fontSize:8.5, fill:'#5060a0', fontStyle:'bold',
            }));
        });
    }

    // ───────────────────────────────────────────────────────────────────
    //  标注
    // ───────────────────────────────────────────────────────────────────
    _drawLabel() {
        this._staticGroup.add(new Konva.Text({
            x:0, y:-16, width:this.width,
            text:`${this.label}  家用天然气灶  双炉头  左${this.ratedPowerL/1000}kW / 右${this.ratedPowerR/1000}kW`,
            fontSize:9, fontStyle:'bold', fill:'#546e7a', align:'center',
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    //  交互绑定（旋钮点击）
    // ───────────────────────────────────────────────────────────────────
    _bindInteraction() {
        setTimeout(() => {
            // 左旋钮点击区
            const kL = this._layout.knobL;
            const hitL = new Konva.Circle({
                x:kL.cx, y:kL.cy, radius:22,
                fill:'rgba(0,0,0,0)', listening:true,
            });
            this._interactGroup.add(hitL);
            hitL.on('click tap', () => this.cycleKnob('L'));
            hitL.on('mouseenter', () => { document.body.style.cursor='pointer'; });
            hitL.on('mouseleave', () => { document.body.style.cursor='default'; });

            // 右旋钮点击区
            const kR = this._layout.knobR;
            const hitR = new Konva.Circle({
                x:kR.cx, y:kR.cy, radius:22,
                fill:'rgba(0,0,0,0)', listening:true,
            });
            this._interactGroup.add(hitR);
            hitR.on('click tap', () => this.cycleKnob('R'));
            hitR.on('mouseenter', () => { document.body.style.cursor='pointer'; });
            hitR.on('mouseleave', () => { document.body.style.cursor='default'; });
        }, 80);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  Tick — 由 consys._tickAll 在 20fps 调用
    // ═══════════════════════════════════════════════════════════════════
    tick(dt) {
        this._globalTimer += dt;
        for (const side of ['L','R']) {
            this._tickBurner(side, dt);
        
        this._refreshCache();
    }
        this._rebuildFlame('L');
        this._rebuildFlame('R');
        this._rebuildSpark('L');
        this._rebuildSpark('R');
        this._rebuildThermocouple('L');
        this._rebuildThermocouple('R');
        this._rebuildKnob('L');
        this._rebuildKnob('R');
        this._rebuildSchematic();
        this._rebuildPanel();
        this._refreshCache();
    }

    // ── 单炉头完整 tick ──────────────────────────────────────────────
    _tickBurner(side, dt) {
        const b   = this._burners[side];
        const sdt = dt * this._simScale;
        b.stageTimer += dt;

        // 阶段逻辑
        switch (b.stage) {

            case BURNER_STAGE.IDLE:
                b.gasRatio     = 0;
                b.sparkOn      = false;
                b.valveOpen    = false;
                break;

            case BURNER_STAGE.PRESSING:
                // 旋钮按下：燃气机械开启，约 200ms 后开始放电
                b.gasRatio = 0.4;
                if (b.stageTimer >= 0.20) {
                    b.stage      = BURNER_STAGE.SPARKING;
                    b.stageTimer = 0;
                    b.sparkCount = 0;
                    this._ignModuleOn = true;
                    this.emit?.('sparking', {side});
                }
                break;

            case BURNER_STAGE.SPARKING:
                b.gasRatio = 0.45;
                // 点火脉冲翻转
                b.sparkFlipT += dt;
                if (b.sparkFlipT >= 1.0/this.sparkFreq) {
                    b.sparkFlipT = 0;
                    b.sparkOn    = !b.sparkOn;
                    if (b.sparkOn) b.sparkCount++;
                }
                // 约 1.2s 后点燃（模拟混合气体着火延迟）
                if (b.stageTimer >= 1.2) {
                    b.stage      = BURNER_STAGE.BURNING;
                    b.stageTimer = 0;
                    b.sparkOn    = false;
                    b.gasRatio   = b.gasLevel || GAS_LEVEL.HIGH;
                    b.valveOpen  = true;
                    b.igniteCount++;
                    this._ignModuleOn = false;
                    this.emit?.('ignite', {side, sparkCount:b.sparkCount});
                }
                // 超时保护
                if (b.stageTimer >= this.maxSparkTime) {
                    b.stage      = BURNER_STAGE.FAIL;
                    b.stageTimer = 0;
                    b.sparkOn    = false;
                    b.gasRatio   = 0;
                    b.failCount++;
                    this._ignModuleOn = false;
                    this.emit?.('igniteFail', {side});
                }
                break;

            case BURNER_STAGE.BURNING:
                // 燃气阀开度跟随目标档位
                const targetRatio = b.gasLevel;
                b.gasRatio += (targetRatio - b.gasRatio) * 0.15 * sdt;
                break;

            case BURNER_STAGE.EXTINGUISHING:
                // 旋钮关闭：燃气阀关闭，火焰熄灭
                b.gasRatio    = Math.max(0, b.gasRatio - dt*2.5);
                b.valveOpen   = false;
                // 等待热电偶冷却，安全阀延迟断气（仿真加速）
                if (b.stageTimer >= this.valveDelay * (1/this._simScale)) {
                    b.stage      = BURNER_STAGE.IDLE;
                    b.stageTimer = 0;
                    b.gasRatio   = 0;
                    this.emit?.('extinguished', {side});
                }
                break;

            case BURNER_STAGE.FAIL:
                b.gasRatio  = 0;
                b.sparkOn   = false;
                b.valveOpen = false;
                break;
        }

        // ── 温度物理模型 ────────────────────────────────────────
        const burning = b.stage === BURNER_STAGE.BURNING;
        const hasGas  = b.gasRatio > 0.05;

        if (burning && hasGas) {
            // 火焰焰心温度：随燃气比例趋近最高温度
            const targetFlame = 400 + b.gasRatio * 500;  // 400～900°C
            b.flameTemp += (targetFlame - b.flameTemp) * 0.12 * sdt;
        } else {
            b.flameTemp = Math.max(this.ambientTemp, b.flameTemp - 80*sdt);
        }

        // 热电偶热端温度（焰心处约 40% 火焰温度，焰心边缘）
        const tcTarget = burning ? b.flameTemp * 0.55 : this.ambientTemp;
        // 热惯性：用时间常数 τ 近似一阶惯性
        b.tcHotTemp  += (tcTarget - b.tcHotTemp) / this.tcTimeConst * sdt;
        b.tcHotTemp   = Math.max(this.ambientTemp, b.tcHotTemp);
        b.tcColdTemp  = this.ambientTemp;  // 冷端恒定室温

        // 热电偶 EMF（塞贝克效应，K 型，41μV/°C）
        const deltaT  = b.tcHotTemp - b.tcColdTemp;
        b.emf         = SEEBECK_K * deltaT;            // V

        // 安全阀电流（通过线圈）
        b.valveCurrent = b.emf / VALVE_COIL_R;          // A

        // 安全阀状态：电流超过维持阈值时保持开启
        if (b.valveCurrent >= VALVE_HOLD_I) {
            b.valveOpen = true;
        } else if (!burning && b.stage !== BURNER_STAGE.PRESSING && b.stage !== BURNER_STAGE.SPARKING) {
            b.valveOpen = false;
        }

        // 火焰动画相位
        if (burning) {
            b.flamePhase += dt * (4 + b.gasRatio * 6);
        }

        // 旋钮动画
        if (b.knobAnimating) {
            b.knobAnimT += dt / 0.20;
            if (b.knobAnimT >= 1) { b.knobAnimT = 1; b.knobAnimating = false; b.knobAngle = b.knobTarget; }
            else {
                const ease   = 0.5 - 0.5*Math.cos(b.knobAnimT * Math.PI);
                b.knobAngle  = b.knobAngle + (b.knobTarget - b.knobAngle) * ease;
            }
        }
    }

    // ───────────────────────────────────────────────────────────────────
    //  动态层：火焰
    // ───────────────────────────────────────────────────────────────────
    _rebuildFlame(side) {
        const grp = side === 'L' ? this._flameGroupL : this._flameGroupR;
        grp.destroyChildren();
        const b   = this._burners[side];
        const bc  = side === 'L' ? this._layout.burnerL : this._layout.burnerR;
        const cx  = bc.cx, cy = bc.cy;
        const oR  = bc.outerR;

        if (b.flameTemp < 60 || b.stage === BURNER_STAGE.IDLE || b.stage === BURNER_STAGE.FAIL) return;

        const intensity  = Math.max(0, Math.min(1, (b.flameTemp - 80) / 820));
        const flameH     = oR * 0.60 * intensity;
        const nFlames    = Math.round(10 + intensity*6);
        const flameRingR = oR * 0.70;

        for (let i=0; i<nFlames; i++) {
            const ang    = (i/nFlames)*2*Math.PI + b.flamePhase*0.05;
            const fx     = cx + Math.cos(ang)*flameRingR;
            const fy     = cy + Math.sin(ang)*flameRingR;
            const fH     = flameH * (0.55 + 0.45*Math.sin(b.flamePhase + i*0.8));
            const swayR  = Math.sin(b.flamePhase*0.6 + i*1.2) * 2 * intensity;
            const normX  = Math.cos(ang+Math.PI/2)*swayR;
            const normY  = Math.sin(ang+Math.PI/2)*swayR;
            const tipX   = cx + Math.cos(ang)*(flameRingR + fH) + normX;
            const tipY   = cy + Math.sin(ang)*(flameRingR + fH) + normY;

            // 外焰（蓝色，高温完全燃烧）
            grp.add(new Konva.Line({
                points:[fx-Math.sin(ang)*3, fy+Math.cos(ang)*3,
                        tipX, tipY,
                        fx+Math.sin(ang)*3, fy-Math.cos(ang)*3, fx, fy],
                closed:true,
                fill:`rgba(20,80,255,${(intensity*0.50+0.10).toFixed(2)})`,
                stroke:'none', tension:0.4,
            }));
            // 内焰（橙黄色，较短）
            const fH2 = fH*0.55;
            const tipX2 = cx + Math.cos(ang)*(flameRingR + fH2);
            const tipY2 = cy + Math.sin(ang)*(flameRingR + fH2);
            grp.add(new Konva.Line({
                points:[fx-Math.sin(ang)*2, fy+Math.cos(ang)*2,
                        tipX2, tipY2,
                        fx+Math.sin(ang)*2, fy-Math.cos(ang)*2, fx, fy],
                closed:true,
                fill:`rgba(255,${Math.round(140+intensity*80)},20,${(intensity*0.70+0.15).toFixed(2)})`,
                stroke:'none', tension:0.4,
            }));
        }

        // 焰心发光（中央圆形光晕）
        if (intensity > 0.3) {
            grp.add(new Konva.Circle({
                x:cx, y:cy, radius:oR*0.25*intensity,
                fillRadialGradientStartPoint:{x:0,y:0},
                fillRadialGradientStartRadius:0,
                fillRadialGradientEndPoint:{x:0,y:0},
                fillRadialGradientEndRadius:oR*0.25*intensity,
                fillRadialGradientColorStops:[
                    0,`rgba(255,230,180,${intensity*0.4})`,
                    1,'rgba(255,150,30,0)'
                ],
            }));
        }

        // 火焰温度标注
        grp.add(new Konva.Text({
            x:cx - 18, y:cy - oR - flameH - 14,
            text:`${Math.round(b.flameTemp)}°C`,
            fontSize:9, fill:`rgba(255,${Math.round(180-intensity*60)},40,${Math.min(1,intensity+0.3).toFixed(2)})`,
            fontFamily:'monospace', fontStyle:'bold',
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    //  动态层：点火电弧
    // ───────────────────────────────────────────────────────────────────
    _rebuildSpark(side) {
        const grp = side === 'L' ? this._sparkGroupL : this._sparkGroupR;
        grp.destroyChildren();
        const b = this._burners[side];
        if (b.stage !== BURNER_STAGE.SPARKING || !b.sparkOn) return;

        const sp  = side === 'L' ? this._spL : this._spR;
        const bc  = side === 'L' ? this._layout.burnerL : this._layout.burnerR;
        // 接地极（炉盘金属，针尖附近）
        const gndX = sp.x + 4;
        const gndY = sp.y + 3;

        // 电弧放电（锯齿形，每帧随机生成）
        const pts  = this._zigzag(sp.x, sp.y, gndX, gndY, 6);
        grp.add(new Konva.Line({
            points:pts,
            stroke:'rgba(180,220,255,0.95)',
            strokeWidth:2, lineCap:'round', lineJoin:'round',
        }));
        // 外发光
        grp.add(new Konva.Circle({
            x:(sp.x+gndX)/2, y:(sp.y+gndY)/2, radius:7,
            fill:'rgba(100,160,255,0.28)',
        }));
        // 高压标注
        grp.add(new Konva.Rect({
            x:sp.x - 34, y:sp.y - 20, width:68, height:13,
            fill:'rgba(8,8,28,0.88)', stroke:'rgba(60,80,200,0.55)', strokeWidth:0.5, cornerRadius:2,
        }));
        grp.add(new Konva.Text({
            x:sp.x - 32, y:sp.y - 17,
            text:`⚡ ~10kV  #${b.sparkCount}`,
            fontSize:8, fill:'rgba(140,180,255,0.95)', fontFamily:'monospace',
        }));
    }

    // 锯齿形闪电路径
    _zigzag(x1, y1, x2, y2, segs) {
        const pts = [x1, y1];
        for (let i=1; i<segs; i++) {
            const t  = i/segs;
            pts.push(x1+(x2-x1)*t+(Math.random()-.5)*8,
                     y1+(y2-y1)*t+(Math.random()-.5)*5);
        }
        pts.push(x2, y2);
        return pts;
    }

    // ───────────────────────────────────────────────────────────────────
    //  动态层：热电偶状态（探针温度 + EMF + 阀电流 标注）
    // ───────────────────────────────────────────────────────────────────
    _rebuildThermocouple(side) {
        const grp = side === 'L' ? this._tcGroupL : this._tcGroupR;
        grp.destroyChildren();
        const b   = this._burners[side];
        const tc  = side === 'L' ? this._tcL : this._tcR;

        // 热电偶热端温度颜色
        const hotT   = b.tcHotTemp;
        const tcColor = hotT > 300 ? '#e04020' : hotT > 150 ? '#e09020' : hotT > 80 ? '#c0c020' : '#4090c0';

        // 热端发光圆
        grp.add(new Konva.Circle({
            x:tc.x, y:tc.y, radius:5,
            fill:tcColor,
            shadowColor:tcColor, shadowBlur: hotT > 100 ? 8 : 2, shadowOpacity:0.8,
        }));

        // 浮动数值气泡
        const emfMV = (b.emf * 1000).toFixed(2);
        const iMA   = (b.valveCurrent * 1000).toFixed(2);
        const lines = [
            `Tc热: ${hotT.toFixed(0)}°C`,
            `EMF: ${emfMV} mV`,
            `I阀: ${iMA} mA`,
            b.valveOpen ? '✓ 气阀保持开' : '✗ 气阀关闭',
        ];
        const bw = 80, bh = lines.length*11 + 6;
        const bx = tc.x + 8, by = tc.y - bh/2;

        grp.add(new Konva.Rect({
            x:bx, y:by, width:bw, height:bh,
            fill:'rgba(4,8,18,0.82)',
            stroke: b.valveOpen ? 'rgba(40,180,40,0.5)' : 'rgba(180,40,40,0.5)',
            strokeWidth:0.5, cornerRadius:2,
        }));
        lines.forEach((ln, i) => {
            grp.add(new Konva.Text({
                x:bx+3, y:by+3+i*11, text:ln,
                fontSize:8, fontFamily:'monospace',
                fill: i===3 ? (b.valveOpen ? '#40d040' : '#d04040') : '#80a0c0',
            }));
        });
    }

    // ───────────────────────────────────────────────────────────────────
    //  动态层：旋钮
    // ───────────────────────────────────────────────────────────────────
    _rebuildKnob(side) {
        const grp = side === 'L' ? this._knobGroupL : this._knobGroupR;
        grp.destroyChildren();
        const b  = this._burners[side];
        const kc = side === 'L' ? this._layout.knobL : this._layout.knobR;
        const cx = kc.cx, cy = kc.cy;
        const R  = 18;

        // 旋钮外圈刻度盘
        grp.add(new Konva.Circle({
            x:cx, y:cy, radius:R+5,
            fill:'#1a1a1a', stroke:'#404040', strokeWidth:1.5,
        }));
        // 档位刻度标记
        const marks = [{ang:-90,lbl:'关'},{ang:-30,lbl:'大'},{ang:30,lbl:'中'},{ang:90,lbl:'小'}];
        marks.forEach(m => {
            const rad = m.ang * Math.PI/180;
            grp.add(new Konva.Line({
                points:[cx+(R+1)*Math.cos(rad), cy+(R+1)*Math.sin(rad),
                        cx+(R+5)*Math.cos(rad), cy+(R+5)*Math.sin(rad)],
                stroke:'#686868', strokeWidth:1.5, lineCap:'round',
            }));
            grp.add(new Konva.Text({
                x:cx+(R+10)*Math.cos(rad)-7, y:cy+(R+10)*Math.sin(rad)-5,
                text:m.lbl, fontSize:8, fill:'#707070', fontStyle:'bold',
            }));
        });

        // 旋钮圆盘（随状态旋转）
        const ang = b.knobAngle;
        grp.add(new Konva.Circle({
            x:cx, y:cy, radius:R,
            fillRadialGradientStartPoint:{x:-4,y:-4},
            fillRadialGradientStartRadius:0,
            fillRadialGradientEndPoint:{x:0,y:0},
            fillRadialGradientEndRadius:R,
            fillRadialGradientColorStops:[0,'#606060',1,'#282828'],
            stroke:'#505050', strokeWidth:1.2,
        }));
        // 指针
        const rad = ang * Math.PI/180;
        grp.add(new Konva.Line({
            points:[cx, cy, cx+R*0.80*Math.cos(rad), cy+R*0.80*Math.sin(rad)],
            stroke:'#e09030', strokeWidth:3, lineCap:'round',
        }));
        // 旋钮中心帽
        grp.add(new Konva.Circle({
            x:cx, y:cy, radius:R*0.20,
            fill:'#d09030', stroke:'#a07020', strokeWidth:1,
        }));
        // 档位名称
        const levelNames = {0:'关',0.28:'小火',0.55:'中火',1.0:'大火'};
        const lvName = b.stage===BURNER_STAGE.SPARKING ? '点火' :
                       b.stage===BURNER_STAGE.FAIL     ? '故障' :
                       (levelNames[b.gasLevel] || '─');
        grp.add(new Konva.Text({
            x:cx-14, y:cy+R+6, width:28, text:lvName,
            fontSize:9, fill: b.stage===BURNER_STAGE.BURNING ? '#e09030' :
                               b.stage===BURNER_STAGE.SPARKING ? '#e0e040' : '#606060',
            fontStyle:'bold', align:'center',
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    //  动态层：原理图（三栏）
    // ───────────────────────────────────────────────────────────────────
    _rebuildSchematic() {
        this._schGroup.destroyChildren();

        const bL   = this._burners['L'];
        const bR   = this._burners['R'];
        // 用左炉数据驱动原理图（更活跃时展示）
        const b    = bL.stage !== BURNER_STAGE.IDLE ? bL : bR;
        const sc   = this._layout.schematic;

        // ══ 栏一：点火电路原理图 ══
        this._drawIgnitionCircuit(b);

        // ══ 栏二：热电偶原理详解 ══
        this._drawThermocoupleDetail(b);

        // ══ 栏三：安全阀联动 ══
        this._drawSafetyValveDetail(b);
    }

    _drawIgnitionCircuit(b) {
        const sl  = this._layout.scmLeft;
        const g   = this._schGroup;
        const x0  = sl.x + 4, y0 = sl.y + 18, w = sl.w - 8;
        const sparking = b.stage === BURNER_STAGE.SPARKING;
        const on       = sparking && b.sparkOn;

        // 电池符号
        const batt_y = y0 + 8;
        g.add(new Konva.Text({ x:x0, y:batt_y, text:`[电池 ${this._battVoltage.toFixed(1)}V]`,
            fontSize:9, fill:'#608040', fontFamily:'monospace' }));

        // 振荡器方块
        const osc_y = batt_y + 22;
        g.add(new Konva.Rect({ x:x0, y:osc_y, width:w*0.50, height:16,
            fill:'#101830', stroke:'#304060', strokeWidth:0.8, cornerRadius:2 }));
        g.add(new Konva.Text({ x:x0+3, y:osc_y+3, text:`振荡器 ${this.sparkFreq}Hz`,
            fontSize:8, fill:'#4080c0' }));
        // 方波示意
        const wvx = x0 + w*0.52, wvy = osc_y + 8;
        const sqPts = [wvx,wvy, wvx+5,wvy, wvx+5,wvy-7, wvx+10,wvy-7, wvx+10,wvy, wvx+15,wvy, wvx+15,wvy-7, wvx+20,wvy-7];
        g.add(new Konva.Line({ points:sqPts, stroke: on?'#60e060':'#205020', strokeWidth:1.5, lineCap:'square' }));

        // 升压变压器
        const tr_y = osc_y + 28;
        g.add(new Konva.Rect({ x:x0, y:tr_y, width:w*0.50, height:16,
            fill:'#181028', stroke:'#403060', strokeWidth:0.8, cornerRadius:2 }));
        g.add(new Konva.Text({ x:x0+3, y:tr_y+4, text:'升压 →10kV',
            fontSize:8, fill:'#8060c0' }));

        // 高压输出线（有电时发光）
        const hv_y = tr_y + 16;
        g.add(new Konva.Line({ points:[x0+w*0.25, hv_y, x0+w*0.25, hv_y+12],
            stroke: on?'rgba(160,200,255,0.80)':'rgba(40,60,100,0.60)',
            strokeWidth: on?2:1, dash:[3,2] }));

        // 点火针符号
        const sp_y = hv_y + 12;
        g.add(new Konva.Rect({ x:x0+4, y:sp_y, width:w*0.40, height:14,
            fill:'#202020', stroke: on?'#8090e0':'#404040', strokeWidth:0.8, cornerRadius:2 }));
        g.add(new Konva.Text({ x:x0+7, y:sp_y+3, text:'点火针 ⚡',
            fontSize:8, fill: on?'rgba(160,200,255,0.95)':'#505050' }));

        // 电弧符号
        if (on) {
            const arcPts = this._zigzag(x0+w*0.25, sp_y+14, x0+w*0.25+5, sp_y+22, 5);
            g.add(new Konva.Line({ points:arcPts, stroke:'rgba(140,180,255,0.90)', strokeWidth:1.8, lineCap:'round' }));
            g.add(new Konva.Text({ x:x0+w*0.30, y:sp_y+14, text:'放电', fontSize:8, fill:'rgba(160,200,255,0.90)' }));
        }

        // 点火次数
        g.add(new Konva.Text({ x:x0, y:sp_y+28,
            text:`点火次数: ${b.sparkCount}次\n状态: ${this._stageLabel(b)}`,
            fontSize:8, fill: b.stage===BURNER_STAGE.FAIL?'#e04040':b.stage===BURNER_STAGE.SPARKING?'#e0e040':'#408040',
            lineHeight:1.6, fontFamily:'monospace' }));
    }

    _drawThermocoupleDetail(b) {
        const sm  = this._layout.scmMid;
        const g   = this._schGroup;
        const x0  = sm.x + 4, y0 = sm.y + 18, w = sm.w - 8, h = sm.h - 24;

        // 热电偶结构图（简化截面）
        const tcDiagY = y0 + 6;
        // 火焰区
        const flameOn = b.stage === BURNER_STAGE.BURNING;
        g.add(new Konva.Rect({ x:x0, y:tcDiagY, width:w*0.38, height:h*0.28,
            fill: flameOn?'rgba(30,60,200,0.18)':'rgba(20,20,30,0.60)',
            stroke:'#202040', strokeWidth:0.5, cornerRadius:2 }));
        g.add(new Konva.Text({ x:x0+2, y:tcDiagY+3, text:'焰心区',
            fontSize:8, fill: flameOn?'rgba(80,120,255,0.80)':'#404060' }));
        if (flameOn) {
            for (let i=0; i<3; i++) {
                const fl_y = tcDiagY + 14 + i*4;
                g.add(new Konva.Line({ points:[x0+8+i*6,fl_y, x0+8+i*6,fl_y-5],
                    stroke:`rgba(255,${120+i*30},20,0.60)`, strokeWidth:2, lineCap:'round' }));
            }
        }

        // 探针截面（镍铬合金外套管）
        const probeX = x0 + w*0.40, probeW = 8, probeH = h*0.50;
        g.add(new Konva.Rect({ x:probeX, y:tcDiagY, width:probeW, height:probeH,
            fill:'#808080', stroke:'#606060', strokeWidth:0.5, cornerRadius:1 }));
        // 内部两根金属丝（Ni-Cr 和 Ni-Al）
        g.add(new Konva.Line({ points:[probeX+2, tcDiagY, probeX+2, tcDiagY+probeH],
            stroke:'#4060d0', strokeWidth:1.5 }));
        g.add(new Konva.Line({ points:[probeX+6, tcDiagY, probeX+6, tcDiagY+probeH],
            stroke:'#80a030', strokeWidth:1.5 }));
        // 热端焊接点
        g.add(new Konva.Circle({ x:probeX+4, y:tcDiagY+probeH,
            radius:4, fill:'#d0a030', stroke:'#a07020', strokeWidth:0.8 }));
        g.add(new Konva.Text({ x:probeX+10, y:tcDiagY+probeH-4,
            text:`热端\n${b.tcHotTemp.toFixed(0)}°C`, fontSize:7.5, fill:'#d0a030', lineHeight:1.4 }));
        // 冷端
        g.add(new Konva.Text({ x:probeX+10, y:tcDiagY+2,
            text:`冷端\n${b.tcColdTemp.toFixed(0)}°C`, fontSize:7.5, fill:'#4080c0', lineHeight:1.4 }));

        // 双金属标注
        g.add(new Konva.Text({ x:x0, y:tcDiagY+probeH+6,
            text:'上: Ni-Cr（镍铬）  α₊\n下: Ni-Al（镍铝）  α₋',
            fontSize:7.5, fill:'#607080', lineHeight:1.5 }));

        // EMF 计算过程
        const emfY  = tcDiagY + probeH + 30;
        const deltaT = b.tcHotTemp - b.tcColdTemp;
        const emfMV  = (b.emf*1000).toFixed(2);
        const emfColor = b.emf*1000 > 10 ? '#30d030' : b.emf*1000 > 5 ? '#d0c030' : '#808080';
        g.add(new Konva.Text({ x:x0, y:emfY,
            text:[
                `ΔT = ${deltaT.toFixed(0)}°C`,
                `EMF = α × ΔT`,
                `   = 41μV × ${deltaT.toFixed(0)}`,
                `   = ${emfMV} mV`,
            ].join('\n'),
            fontSize:9, fill:emfColor, fontFamily:'monospace', lineHeight:1.65 }));

        // EMF 进度条
        const barY = emfY + 62, barW = w * 0.85;
        const emfMax = 25;  // mV 满量程
        const barFill = Math.min(1, b.emf*1000/emfMax);
        g.add(new Konva.Rect({ x:x0, y:barY, width:barW, height:7,
            fill:'#101018', stroke:'#202028', strokeWidth:0.5, cornerRadius:3 }));
        if (barFill > 0) {
            g.add(new Konva.Rect({ x:x0, y:barY, width:barW*barFill, height:7,
                fill:emfColor, cornerRadius:3 }));
        }
        // 阈值标记
        const threshX = x0 + barW * (VALVE_HOLD_I*VALVE_COIL_R*1000/emfMax);
        g.add(new Konva.Line({ points:[threshX, barY-3, threshX, barY+10],
            stroke:'rgba(255,100,100,0.70)', strokeWidth:1, dash:[2,1] }));
        g.add(new Konva.Text({ x:threshX-4, y:barY+10, text:'阈值',
            fontSize:7, fill:'rgba(255,120,120,0.70)' }));
    }

    _drawSafetyValveDetail(b) {
        const sr  = this._layout.scmRight;
        const g   = this._schGroup;
        const x0  = sr.x + 4, y0 = sr.y + 18, w = sr.w - 8;

        const valveOpen    = b.valveOpen;
        const iMA          = (b.valveCurrent*1000).toFixed(2);
        const holdMA       = (VALVE_HOLD_I*1000).toFixed(1);
        const valveColor   = valveOpen ? '#30e030' : '#e04040';

        // 安全阀外形（方块 + 衔铁）
        const vx = x0 + w*0.10, vy = y0 + 10, vw = w*0.75, vh = 26;
        g.add(new Konva.Rect({ x:vx, y:vy, width:vw, height:vh,
            fill: valveOpen?'#0a1a0a':'#1a0a0a',
            stroke:valveColor, strokeWidth: valveOpen?1.5:1, cornerRadius:3 }));
        g.add(new Konva.Text({ x:vx+4, y:vy+5, text:'燃气安全阀',
            fontSize:9, fill:valveColor, fontStyle:'bold' }));
        g.add(new Konva.Text({ x:vx+4, y:vy+15,
            text: valveOpen ? '● 开启（通气）' : '○ 关闭（断气）',
            fontSize:8, fill:valveColor }));

        // 线圈符号
        const coilY = vy + vh + 10;
        g.add(new Konva.Text({ x:x0, y:coilY,
            text:'电磁线圈（10Ω）', fontSize:8, fill:'#6080a0' }));
        // 线圈电流计
        const coilBarY = coilY + 14, coilBarW = w*0.85;
        const iFill = Math.min(1, b.valveCurrent/VALVE_HOLD_I*0.8);
        g.add(new Konva.Rect({ x:x0, y:coilBarY, width:coilBarW, height:7,
            fill:'#101018', stroke:'#202028', strokeWidth:0.5, cornerRadius:3 }));
        if (iFill > 0) {
            g.add(new Konva.Rect({ x:x0, y:coilBarY, width:coilBarW*iFill, height:7,
                fill: iFill > 0.8 ? '#30e030' : iFill > 0.4 ? '#d0c030' : '#e04040',
                cornerRadius:3 }));
        }
        // 阈值标线
        const thX2 = x0 + coilBarW * (VALVE_HOLD_I/VALVE_HOLD_I*0.8);
        g.add(new Konva.Line({ points:[thX2, coilBarY-3, thX2, coilBarY+10],
            stroke:'rgba(255,80,80,0.70)', strokeWidth:1, dash:[2,1] }));

        // 数值
        g.add(new Konva.Text({ x:x0, y:coilBarY+12,
            text:`I = ${iMA}mA  (维持需 ≥${holdMA}mA)`,
            fontSize:8, fill: valveOpen?'#30d030':'#c04040', fontFamily:'monospace' }));

        // 衔铁示意（弹簧 + 阀芯）
        const anchorY = coilBarY + 32;
        // 弹簧
        const spPts = [x0+w*0.15, anchorY];
        for (let i=0;i<5;i++) {
            spPts.push(x0+w*0.15+(i%2===0?-6:6), anchorY+4+i*5);
        }
        spPts.push(x0+w*0.15, anchorY+30);
        g.add(new Konva.Line({ points:spPts, stroke:'#707080', strokeWidth:1.5, lineCap:'round', lineJoin:'round' }));

        // 衔铁位置（开 / 关）
        const armOffset = valveOpen ? 0 : 8;
        g.add(new Konva.Rect({ x:x0+w*0.30, y:anchorY+anchorY*0.0+armOffset, width:w*0.50, height:8,
            fill: valveOpen?'#303838':'#383030',
            stroke: valveOpen?'#406060':'#604040', strokeWidth:0.8, cornerRadius:2 }));
        g.add(new Konva.Text({ x:x0+w*0.32, y:anchorY+armOffset+1,
            text: valveOpen?'衔铁吸合':'衔铁复位',
            fontSize:7.5, fill: valveColor }));

        // 响应时间说明
        const respY = anchorY + 50;
        g.add(new Konva.Text({ x:x0, y:respY,
            text:['断火保护流程:',
                  '火灭 → Tc冷却',
                  `τ≈${this.tcTimeConst}s → EMF↓`,
                  `I < ${holdMA}mA → 弹簧`,
                  '→ 阀关 → 断气✓'].join('\n'),
            fontSize:8, fill:'#606880', lineHeight:1.60, fontFamily:'monospace' }));
    }

    // ───────────────────────────────────────────────────────────────────
    //  动态层：状态面板（两炉简洁状态行）
    // ───────────────────────────────────────────────────────────────────
    _rebuildPanel() {
        this._panelGroup.destroyChildren();
        const t  = this._layout.stoveTop;
        const W  = this.width;

        // 两炉状态文字（面板右侧）
        ['L','R'].forEach((side, i) => {
            const b    = this._burners[side];
            const px   = t.x + t.w*(0.04 + i*0.50);
            const py   = t.y + t.h*0.82;
            const col  = b.stage===BURNER_STAGE.BURNING  ? '#e07020' :
                         b.stage===BURNER_STAGE.SPARKING ? '#e0e040' :
                         b.stage===BURNER_STAGE.FAIL     ? '#e04040' : '#505060';
            this._panelGroup.add(new Konva.Text({
                x:px, y:py,
                text:`${side==='L'?'左':'右'}炉: ${this._stageLabel(b)}  ${b.flameTemp>60?Math.round(b.flameTemp)+'°C':''}`,
                fontSize:9, fill:col, fontStyle:'bold',
            }));
        });
    }

    _stageLabel(b) {
        return {
            [BURNER_STAGE.IDLE]:         '待机',
            [BURNER_STAGE.PRESSING]:     '按下旋钮',
            [BURNER_STAGE.SPARKING]:     `点火中 #${b.sparkCount}`,
            [BURNER_STAGE.BURNING]:      `燃烧(${['','小','中','大'][Math.round(b.gasRatio/0.33)]}火)`,
            [BURNER_STAGE.EXTINGUISHING]:'熄火冷却',
            [BURNER_STAGE.FAIL]:         '点火失败',
        }[b.stage] || '─';
    }

    // ═══════════════════════════════════════════════════════════════════
    //  外部操作接口
    // ═══════════════════════════════════════════════════════════════════

    /**
     * 循环切换旋钮档位（每次点击切换一档）
     *   OFF → HIGH → MED → LOW → OFF
     */
    cycleKnob(side) {
        const b = this._burners[side];
        if (b.stage === BURNER_STAGE.FAIL) {
            this.reset(side); return;
        }
        const order = [GAS_LEVEL.OFF, GAS_LEVEL.HIGH, GAS_LEVEL.MED, GAS_LEVEL.LOW];
        const angMap = {[GAS_LEVEL.OFF]:-90, [GAS_LEVEL.HIGH]:-30, [GAS_LEVEL.MED]:30, [GAS_LEVEL.LOW]:90};
        const lblMap = {[GAS_LEVEL.OFF]:'关', [GAS_LEVEL.HIGH]:'大火', [GAS_LEVEL.MED]:'中火', [GAS_LEVEL.LOW]:'小火'};

        const currIdx = order.indexOf(b.gasLevel);
        const nextLvl = order[(currIdx+1) % order.length];
        b.gasLevel    = nextLvl;

        // 旋钮旋转动画
        const prevAngle = b.knobAngle;
        b.knobTarget    = angMap[nextLvl];
        b.knobAnimT     = 0;
        b.knobAnimating = true;
        b.knobAngle     = prevAngle;  // 动画从当前角度开始

        if (nextLvl === GAS_LEVEL.OFF) {
            // 旋到关：开始熄火流程
            if (b.stage === BURNER_STAGE.BURNING || b.stage === BURNER_STAGE.SPARKING) {
                b.stage      = BURNER_STAGE.EXTINGUISHING;
                b.stageTimer = 0;
            } else {
                b.stage      = BURNER_STAGE.IDLE;
                b.stageTimer = 0;
                b.gasRatio   = 0;
            }
        } else if (b.stage === BURNER_STAGE.IDLE || b.stage === BURNER_STAGE.EXTINGUISHING) {
            // 从关档旋到有火档：开始点火
            b.stage      = BURNER_STAGE.PRESSING;
            b.stageTimer = 0;
            b.sparkCount = 0;
        } else if (b.stage === BURNER_STAGE.BURNING) {
            // 已燃烧中：仅调火力
            b.gasRatio = nextLvl;
        }

        this.emit?.('knobCycle', {side, level: lblMap[nextLvl]});
        this._refreshCache();
    }

    /**
     * 直接设定炉头火力档位
     *   level: 'OFF' | 'LOW' | 'MED' | 'HIGH'
     */
    setLevel(side, level) {
        const lv = GAS_LEVEL[level];
        if (lv === undefined) return;
        const b  = this._burners[side];
        b.gasLevel = lv;
        if (lv === GAS_LEVEL.OFF) {
            if (b.stage === BURNER_STAGE.BURNING) {
                b.stage = BURNER_STAGE.EXTINGUISHING; b.stageTimer = 0;
            }
        } else if (b.stage === BURNER_STAGE.IDLE) {
            b.stage = BURNER_STAGE.PRESSING; b.stageTimer = 0; b.sparkCount = 0;
        }
        this._refreshCache();
    }

    /** 复位故障 */
    reset(side) {
        const b  = this._burners[side];
        b.stage      = BURNER_STAGE.IDLE;
        b.stageTimer = 0;
        b.gasRatio   = 0;
        b.gasLevel   = GAS_LEVEL.OFF;
        b.sparkOn    = false;
        b.flameTemp  = this.ambientTemp;
        b.tcHotTemp  = this.ambientTemp;
        b.emf        = 0;
        b.valveOpen  = false;
        b.knobAngle  = -90; b.knobTarget = -90;
        this.emit?.('reset', {side});
        this._refreshCache();
    }

    // ── 查询接口 ─────────────────────────────────────────────────────
    getBurnerStage(side)       { return this._burners[side]?.stage; }
    getFlameTemp(side)         { return this._burners[side]?.flameTemp; }
    getTcHotTemp(side)         { return this._burners[side]?.tcHotTemp; }
    getEmf(side)               { return this._burners[side]?.emf; }
    getValveCurrent(side)      { return this._burners[side]?.valveCurrent; }
    isValveOpen(side)          { return this._burners[side]?.valveOpen; }
    isBurning(side)            { return this._burners[side]?.stage === BURNER_STAGE.BURNING; }
    isSparking(side)           { return this._burners[side]?.stage === BURNER_STAGE.SPARKING; }
    getIgniteCount(side)       { return this._burners[side]?.igniteCount; }

    // ═══════════════════════════════════════════════════════════════════
    //  配置字段
    // ═══════════════════════════════════════════════════════════════════
    getConfigFields() {
        return [
            { label:'位号/名称',            key:'label',        type:'text'   },
            { label:'左炉额定热功率 (W)',    key:'ratedPowerL',  type:'number' },
            { label:'右炉额定热功率 (W)',    key:'ratedPowerR',  type:'number' },
            { label:'点火脉冲频率 (Hz)',     key:'sparkFreq',    type:'number' },
            { label:'最长点火时间 (s)',      key:'maxSparkTime', type:'number' },
            { label:'热电偶时间常数 (s)',    key:'tcTimeConst',  type:'number' },
            { label:'安全阀断气延迟 (s)',    key:'valveDelay',   type:'number' },
            { label:'环境温度 (°C)',         key:'ambientTemp',  type:'number' },
            { label:'仿真加速倍率',          key:'simScale',     type:'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label)        this.label        = cfg.label;
        if (cfg.ratedPowerL)  this.ratedPowerL  = parseFloat(cfg.ratedPowerL)  || this.ratedPowerL;
        if (cfg.ratedPowerR)  this.ratedPowerR  = parseFloat(cfg.ratedPowerR)  || this.ratedPowerR;
        if (cfg.sparkFreq)    this.sparkFreq    = parseFloat(cfg.sparkFreq)    || this.sparkFreq;
        if (cfg.maxSparkTime) this.maxSparkTime = parseFloat(cfg.maxSparkTime) || this.maxSparkTime;
        if (cfg.tcTimeConst)  this.tcTimeConst  = parseFloat(cfg.tcTimeConst)  || this.tcTimeConst;
        if (cfg.valveDelay)   this.valveDelay   = parseFloat(cfg.valveDelay)   || this.valveDelay;
        if (cfg.ambientTemp)  this.ambientTemp  = parseFloat(cfg.ambientTemp)  || this.ambientTemp;
        if (cfg.simScale)     this._simScale    = parseFloat(cfg.simScale)     || this._simScale;
        this.config = { ...this.config, ...cfg };
        this._refreshCache();
    }

    destroy() {
        super.destroy?.();
    }
}