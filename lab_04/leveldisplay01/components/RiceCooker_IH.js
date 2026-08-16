import { BaseComponent } from './BaseComponent.js';

/**
 * IH 电磁感应加热智能电饭煲仿真组件
 * （IH Rice Cooker — Induction Heating Type）
 *
 * ══════════════════════════════════════════════════════════════════════
 *  整机电路拓扑（两大子系统）
 * ══════════════════════════════════════════════════════════════════════
 *
 *  ┌─ 子系统 A：功率回路（整流电源 + IGBT + IH 线圈）────────────────┐
 *  │                                                                    │
 *  │  220V AC ──► EMI 滤波 ──► 整流桥（D1~D4）──► PFC 电感            │
 *  │           ──► 滤波电容 C_bus（约 300V DC）                        │
 *  │           ──► IGBT（绝缘栅双极型晶体管）                          │
 *  │               · 型号典型：FGH40N60 / IXGH40N60                   │
 *  │               · 集电极 C → 谐振电容 C_res → IH 线圈 L            │
 *  │               · 发射极 E → 直流母线负极                           │
 *  │           ──► IH 加热线圈（平面涡旋线圈，铜利兹线绕制）           │
 *  │               · 工作频率：20 kHz ~ 30 kHz（准谐振/半桥驱动）      │
 *  │               · 线圈交变磁场穿透内胆底部（磁性不锈钢）            │
 *  │               · 涡流 + 磁滞损耗在内胆壁中转化为热量               │
 *  │                                                                    │
 *  │  核心原理：                                                        │
 *  │    IGBT 以 f_sw = 20~30kHz 高频开关，驱动 LC 谐振回路             │
 *  │    → 线圈产生高频交变磁场（B 场）                                  │
 *  │    → 磁场穿透铁磁性不锈钢内胆底壁                                 │
 *  │    → 感应涡流（Eddy Current）+ 磁滞损耗 → 内胆自身发热           │
 *  │    → 无接触传热，效率约 90%（远高于接触式 60~70%）               │
 *  └────────────────────────────────────────────────────────────────────┘
 *
 *  ┌─ 子系统 B：控制回路（NTC 测温 + MCU + IGBT 驱动）───────────────┐
 *  │                                                                    │
 *  │  NTC 热敏电阻（Negative Temperature Coefficient Thermistor）      │
 *  │    · 贴于内胆底部弹片（紧压内胆外壁）                             │
 *  │    · T↑ → R_NTC↓ → 分压电路输出电压 V_ntc↑                     │
 *  │    · MCU ADC 采样 V_ntc → 换算实时温度                            │
 *  │    · 典型参数：R25 = 10kΩ，B 值 = 3950K                          │
 *  │    · 副 NTC（锅盖内侧）：检测蒸汽温度，判断煮饭阶段               │
 *  │                                                                    │
 *  │  MCU 控制板（STM32 / 瑞萨 RH850 类似）                            │
 *  │    · ADC → NTC 温度采样（10ms 周期）                              │
 *  │    · 模糊控制 / PID 算法 → 计算目标功率 P_target                  │
 *  │    · 输出 PWM 信号（Duty cycle 0~100%）→ IGBT 驱动板             │
 *  │    · 阶段判断：预热 → 沸腾 → 焖饭 → 保温                        │
 *  │    · 液晶显示 / 按键扫描                                          │
 *  │                                                                    │
 *  │  IGBT 驱动电路（Gate Driver IC，如 IR2110 / HCPL-314J）          │
 *  │    · 电气隔离（光耦 / 磁耦）：控制侧 3.3V 与功率侧 300V 隔离     │
 *  │    · 输入：MCU PWM 信号（3.3V 逻辑）                              │
 *  │    · 输出：IGBT 栅极驱动电压 Vgs = +15V（开）/ −8V（关）        │
 *  │    · 含欠压锁定（UVLO）、过流保护（OCP）                          │
 *  │    · 开通时间 t_on ≈ 100ns，关断时间 t_off ≈ 150ns               │
 *  └────────────────────────────────────────────────────────────────────┘
 *
 * ══════════════════════════════════════════════════════════════════════
 *  烹饪阶段状态机
 * ══════════════════════════════════════════════════════════════════════
 *
 *  IDLE  ──[pressCook()]──►  PREHEAT（预热，约 1~2min）
 *         · 功率 30%，快速提升内胆温度
 *
 *  PREHEAT  ──[T ≥ 80°C]──►  BOIL（沸腾加热，约 10~15min）
 *         · 功率 100%，全功率推至沸腾
 *
 *  BOIL  ──[T ≥ 100°C && 顶盖 NTC 检测蒸汽稳定]──►  SIMMER（焖饭）
 *         · 功率降至 30~50%，维持微沸，水分被米粒吸收
 *
 *  SIMMER  ──[顶盖 NTC 蒸汽减弱 / 计时结束]──►  DONE（焖熟）
 *         · 关闭 IH 功率，纯余热焖 5min
 *
 *  DONE  ──[自动]──►  WARM（保温）
 *         · 功率 5~8%，维持 65~74°C
 *         · IGBT 占空比极低（约 3~8%）
 *
 *  任意状态 ──[pressCancel()]──►  IDLE
 *
 * ══════════════════════════════════════════════════════════════════════
 *  温度物理模型
 * ══════════════════════════════════════════════════════════════════════
 *
 *  有效加热功率：P_eff = P_rated × dutyCycle × η_IH
 *    η_IH = 0.92（IH 感应加热效率）
 *
 *  温升方程（简化集总热容模型）：
 *    PREHEAT / BOIL：
 *      dT/dt = (P_eff × α − k_cool×(T−T_amb)) × simScale
 *      α = 0.00080（有水时，水比热缓冲）
 *
 *    沸腾相变段（T ≈ 100°C，有水）：
 *      温度被相变锁定；水位以蒸发速率线性下降
 *      α_boil = 0.000035（相变吸热极大）
 *
 *    SIMMER / DONE：
 *      占空比降低，温度缓慢下降或维持
 *
 *    WARM：
 *      PID 近似，目标 70°C
 *
 *  NTC 温度换算（Steinhart–Hart 简化式）：
 *    1/T = 1/T_ref + (1/B) × ln(R/R_ref)
 *    T_ref = 298.15K，R_ref = 10kΩ，B = 3950K
 *    V_ntc = Vcc × R_NTC / (R_pull + R_NTC)
 *    MCU ADC 读值 → 反算 R_NTC → 代入公式得 T
 *
 *  IGBT 占空比控制：
 *    dutyCycle = f(阶段, T_error, P_target)
 *    PREHEAT:  duty = 0.30
 *    BOIL:     duty = 1.00
 *    SIMMER:   duty = 0.45 - PID_adjust
 *    DONE:     duty = 0.00
 *    WARM:     duty = clamp(k_p×(70-T), 0.03, 0.10)
 *
 * ══════════════════════════════════════════════════════════════════════
 *  绘制分层（从底到顶）
 * ══════════════════════════════════════════════════════════════════════
 *
 *  Layer 0   底座（base）
 *  Layer 1   外壳主体（housing）
 *  Layer 2   控制板区域（controlBoard）— 静态结构
 *  Layer 3   功率板区域（powerBoard）— 静态结构
 *  Layer 4   IH 线圈（ihCoil）— 静态结构
 *  Layer 5   加热盘 + 内胆（pot）— 含 _waterGroup（动态）
 *  Layer 6   锅盖（lid）
 *  Layer 7   _igbtGroup   — IGBT + 驱动电路动态层（tick 更新）
 *  Layer 8   _ntcGroup    — NTC + ADC 动态层（tick 更新）
 *  Layer 9   _coilGroup   — 磁场线 + 涡流动态层（tick 更新）
 *  Layer 10  _panelGroup  — 操作面板（tick 更新）
 *  Layer 11  _waveGroup   — PWM 波形示意（tick 更新）
 *  Layer 12  标注文字
 *
 * ══════════════════════════════════════════════════════════════════════
 *  端口
 * ══════════════════════════════════════════════════════════════════════
 *  ac_l      — 交流火线输入（L，220V）
 *  ac_n      — 交流零线输入（N，220V）
 *  dc_bus    — 直流母线（+300V DC，整流后）
 *  gate_pwm  — IGBT 栅极 PWM 信号输入（MCU 输出，3.3V 逻辑）
 *  ntc_out   — NTC 分压输出（模拟电压，接 MCU ADC）
 *  coil_out  — IH 线圈电流输出（高频，20~30kHz）
 */

// ═══════════════════════════════════════════════════════════════════════
//  阶段枚举
// ═══════════════════════════════════════════════════════════════════════
const IH_STAGE = {
    IDLE:    'idle',
    PREHEAT: 'preheat',   // 预热
    BOIL:    'boil',      // 沸腾加热
    SIMMER:  'simmer',    // 焖饭
    DONE:    'done',      // 焖熟（余热焖）
    WARM:    'warm',      // 保温
};

// ═══════════════════════════════════════════════════════════════════════
//  IH 电饭煲主类
// ═══════════════════════════════════════════════════════════════════════
export class IHRiceCooker extends BaseComponent {

    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(300, config.width  || 360);
        this.height = Math.max(380, config.height || 440);

        this.type    = 'ih_rice_cooker';
        this.special = 'none';
        this.cache   = 'fixed';

        // ── 额定参数 ────────────────────────────────────────────────
        this.label        = config.label        || 'IH-RC';
        this.ratedVoltage = config.ratedVoltage || 220;     // V AC
        this.ratedPower   = config.ratedPower   || 1050;    // W
        this.switchFreq   = config.switchFreq   || 25000;   // Hz，IGBT 开关频率
        this.ihEfficiency = config.ihEfficiency || 0.92;    // IH 效率
        this.warmTarget   = config.warmTarget   || 70;      // °C，保温目标
        this.ambientTemp  = config.ambientTemp  || 25;      // °C
        this.ntcR25       = config.ntcR25       || 10000;   // Ω，NTC 25°C 阻值
        this.ntcB         = config.ntcB         || 3950;    // K，NTC B 值
        this.ntcPull      = config.ntcPull      || 10000;   // Ω，上拉电阻
        this.vcc          = config.vcc          || 3.3;     // V，MCU 参考电压

        // 仿真加速倍率
        this._simScale    = config.simScale     || 32;

        // ── 物理状态 ────────────────────────────────────────────────
        this._stage       = IH_STAGE.IDLE;
        this._temperature = this.ambientTemp;      // 内胆底部温度 °C
        this._lidTemp     = this.ambientTemp;      // 锅盖蒸汽温度 °C
        this._waterLevel  = config.waterLevel !== undefined
                            ? Number(config.waterLevel) : 1.0;
        this._cookProg    = 0;          // 煮饭总进度 0~1
        this._stageTimer  = 0;          // 当前阶段计时 s
        this._cookCount   = config.initCookCount || 0;

        // ── IGBT / 功率控制状态 ──────────────────────────────────
        this._dutyCycle   = 0;          // IGBT 占空比 0~1
        this._dcBusVolt   = 0;          // 直流母线电压 V（整流后约 300V）
        this._igbtTemp    = this.ambientTemp;  // IGBT 结温 °C
        this._igbtOn      = false;       // IGBT 当前开关状态（高频闪烁）
        this._igbtFlipT   = 0;          // IGBT 翻转计时

        // ── NTC 测温状态 ─────────────────────────────────────────
        this._ntcR        = this._calcNtcR(this._temperature);  // NTC 实时阻值 Ω
        this._ntcV        = this._calcNtcV(this._ntcR);         // NTC 分压 V
        this._adcRaw      = Math.round(this._ntcV / this.vcc * 4095); // 12-bit ADC

        // ── IH 线圈磁场动画状态 ──────────────────────────────────
        this._coilPhase   = 0;          // 磁场相位（0~2π，用于磁力线动画）
        this._coilFlux    = 0;          // 磁通量归一化（0~1）
        this._eddyPhase   = 0;          // 涡流动画相位

        // ── PWM 波形历史（面板示波器，64 点）───────────────────
        this._pwmHistory  = new Array(64).fill(0);
        this._pwmTimer    = 0;

        // ── 温度历史（迷你曲线，60 点）─────────────────────────
        this._tempHistory = new Array(60).fill(this.ambientTemp);
        this._histTimer   = 0;

        // ── 初始化绘制 ───────────────────────────────────────────
        this._layout = this._calcLayout();
        this._init();

        // ── 端口 ─────────────────────────────────────────────────
        const L = this._layout;
        this.addPort(L.base.x + 10, L.base.y + L.base.h + 4, 'ac_l',     'wire', 'L');
        this.addPort(L.base.x + 28, L.base.y + L.base.h + 4, 'ac_n',     'wire', 'N');
        this.addPort(L.base.x + 56, L.base.y + L.base.h + 4, 'dc_bus',   'wire', 'DC');
        this.addPort(L.base.x + 82, L.base.y + L.base.h + 4, 'gate_pwm', 'wire', 'PWM');
        this.addPort(L.base.x +108, L.base.y + L.base.h + 4, 'ntc_out',  'wire', 'NTC');
        this.addPort(L.base.x +134, L.base.y + L.base.h + 4, 'coil_out', 'wire', 'IH');
    }

    // ═══════════════════════════════════════════════════════════════════
    //  布局计算
    // ═══════════════════════════════════════════════════════════════════
    _calcLayout() {
        const W = this.width, H = this.height;
        return {
            // 外壳
            housing:     { x: W*0.02, y: H*0.01, w: W*0.96, h: H*0.56, rx: 14 },
            // 锅盖
            lid:         { x: W*0.05, y: H*0.01, w: W*0.90, h: H*0.08, rx: 8  },
            // 内胆（剖面，居中上部）
            pot:         { x: W*0.18, y: H*0.08, w: W*0.64, h: H*0.26, rx: 6  },
            // IH 线圈（内胆正下方）
            ihCoil:      { x: W*0.20, y: H*0.34, w: W*0.60, h: H*0.06, rx: 4  },
            // 整流 + 功率板（左下区）
            powerBoard:  { x: W*0.03, y: H*0.41, w: W*0.40, h: H*0.14, rx: 4  },
            // 控制板（右下区）
            ctrlBoard:   { x: W*0.55, y: H*0.41, w: W*0.40, h: H*0.14, rx: 4  },
            // 底座
            base:        { x: W*0.02, y: H*0.57, w: W*0.96, h: H*0.06, rx: 6  },
            // 操作面板（底座下方）
            panel:       { x: W*0.02, y: H*0.63, w: W*0.96, h: H*0.35, rx: 8  },
            // 面板内分区
            panelLeft:   { x: W*0.04, y: H*0.65, w: W*0.28, h: H*0.32 },  // 温度 + 曲线
            panelMid:    { x: W*0.34, y: H*0.65, w: W*0.30, h: H*0.32 },  // PWM 示波 + NTC
            panelRight:  { x: W*0.66, y: H*0.65, w: W*0.28, h: H*0.32 },  // 按键 + 阶段
        };
    }

    // ═══════════════════════════════════════════════════════════════════
    //  初始化绘制
    // ═══════════════════════════════════════════════════════════════════
    _init() {
        this._drawHousing();
        this._drawLid();
        this._drawPot();
        this._drawIhCoilStatic();
        this._drawPowerBoard();
        this._drawCtrlBoard();
        this._drawBase();
        this._drawPanel();
        this._drawLabel();
        // 动态层
        this._igbtGroup = new Konva.Group(); this.group.add(this._igbtGroup);
        this._ntcGroup  = new Konva.Group(); this.group.add(this._ntcGroup);
        this._coilGroup = new Konva.Group(); this.group.add(this._coilGroup);
        this._waveGroup = new Konva.Group(); this.group.add(this._waveGroup);
        this._bindInteraction();
    }

    // ───────────────────────────────────────────────────────────────────
    //  外壳（哑光黑高端质感）
    // ───────────────────────────────────────────────────────────────────
    _drawHousing() {
        const h = this._layout.housing;
        this.group.add(new Konva.Rect({
            x: h.x, y: h.y, width: h.w, height: h.h,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: h.w, y: 0 },
            fillLinearGradientColorStops: [
                0, '#1a1a1a', 0.10, '#2e2e2e', 0.45, '#383838',
                0.55, '#383838', 0.90, '#2e2e2e', 1, '#1a1a1a',
            ],
            stroke: '#484848', strokeWidth: 1.5, cornerRadius: h.rx,
            shadowColor: '#000', shadowBlur: 10, shadowOffsetY: 4, shadowOpacity: 0.35,
        }));
        // 顶部高光
        this.group.add(new Konva.Rect({
            x: h.x+4, y: h.y+2, width: h.w-8, height: h.h*0.05,
            fill: 'rgba(255,255,255,0.12)', cornerRadius: [h.rx,h.rx,0,0],
        }));
        // 品牌色条（正面下方）
        this.group.add(new Konva.Rect({
            x: h.x, y: h.y+h.h-12, width: h.w, height: 12,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: h.w, y: 0 },
            fillLinearGradientColorStops: [0,'#1a3a6a', 0.5,'#2255a0', 1,'#1a3a6a'],
            cornerRadius: [0,0,h.rx,h.rx],
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    //  锅盖（IH 款镜面内盖）
    // ───────────────────────────────────────────────────────────────────
    _drawLid() {
        const l = this._layout.lid;
        const W = this.width;
        this.group.add(new Konva.Rect({
            x: l.x, y: l.y, width: l.w, height: l.h,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: 0, y: l.h },
            fillLinearGradientColorStops: [0,'#505050',0.5,'#787878',1,'#404040'],
            stroke: '#606060', strokeWidth: 1, cornerRadius: l.rx,
        }));
        // 提手（弧形）
        this.group.add(new Konva.Rect({
            x: W*0.40, y: l.y-5, width: W*0.20, height: 9,
            fill: '#282828', stroke: '#505050', strokeWidth: 1, cornerRadius: 5,
        }));
        // 排气孔
        for (let i = 0; i < 5; i++) {
            this.group.add(new Konva.Circle({
                x: W*(0.36+i*0.07), y: l.y+l.h*0.6, radius: 2.5,
                fill: '#303030', stroke: '#505050', strokeWidth: 0.5,
            }));
        }
        // 副 NTC 位置标注（锅盖内侧蒸汽温度传感器）
        this._lidNtcDot = new Konva.Circle({
            x: W*0.72, y: l.y+l.h*0.55, radius: 3.5,
            fill: '#ff8020', stroke: '#cc5010', strokeWidth: 0.8,
            shadowColor: '#ff8020', shadowBlur: 3, shadowOpacity: 0.6,
        });
        this.group.add(this._lidNtcDot);
        this.group.add(new Konva.Text({
            x: W*0.74, y: l.y+l.h*0.3, text: 'NTC-lid',
            fontSize: 7, fill: '#ff9040',
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    //  内胆（磁性不锈钢，含水/饭动态层）
    // ───────────────────────────────────────────────────────────────────
    _drawPot() {
        const p = this._layout.pot;
        // 外壁（磁性不锈钢，304+430 复合，深银色）
        this.group.add(new Konva.Rect({
            x: p.x, y: p.y, width: p.w, height: p.h,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: p.w, y: 0 },
            fillLinearGradientColorStops: [
                0,'#484848', 0.15,'#686868', 0.45,'#808080',
                0.55,'#808080', 0.85,'#686868', 1,'#484848',
            ],
            stroke: '#505050', strokeWidth: 1, cornerRadius: p.rx,
        }));
        // 底壁加厚标记（铁素体不锈钢磁性底，供 IH 感应）
        this.group.add(new Konva.Rect({
            x: p.x+4, y: p.y+p.h-8, width: p.w-8, height: 8,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: p.w, y: 0 },
            fillLinearGradientColorStops: [0,'#383838',0.5,'#606060',1,'#383838'],
            cornerRadius: [0,0,p.rx-1,p.rx-1],
        }));
        // 水/饭动态层
        this._waterGroup = new Konva.Group();
        this.group.add(this._waterGroup);
        this._rebuildWaterLayer();
        // 内壁（不粘涂层，橙红色调）
        this.group.add(new Konva.Rect({
            x: p.x+6, y: p.y+4, width: p.w-12, height: p.h-12,
            fill: 'none', stroke: 'rgba(200,120,60,0.20)', strokeWidth: 1,
            cornerRadius: p.rx-2,
        }));
    }

    _rebuildWaterLayer() {
        this._waterGroup.destroyChildren();
        const p  = this._layout.pot;
        const wl = Math.max(0, Math.min(1, this._waterLevel));
        if (wl <= 0) return;

        const innerH = p.h - 12;
        const waterH = innerH * wl;
        const waterY = p.y + p.h - 8 - waterH;

        let c1, c2;
        const prog = this._cookProg;
        if      (prog > 0.88) { c1 = '#f2e8c8'; c2 = '#e4d4a0'; }
        else if (prog > 0.45) { c1 = '#eef0e0'; c2 = '#d8e4c0'; }
        else                  { c1 = '#b8d0e0'; c2 = '#90b8cc'; }

        this._waterGroup.add(new Konva.Rect({
            x: p.x+6, y: waterY, width: p.w-12, height: waterH,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: 0, y: waterH },
            fillLinearGradientColorStops: [0,c1,1,c2],
            cornerRadius: [0,0,p.rx-2,p.rx-2],
        }));

        // 沸腾气泡
        if (this._stage === IH_STAGE.BOIL && this._temperature >= 95) {
            for (let i = 0; i < 10; i++) {
                this._waterGroup.add(new Konva.Circle({
                    x: p.x+8 + Math.random()*(p.w-16),
                    y: waterY+8 + Math.random()*(waterH-16),
                    radius: 1.5 + Math.random()*2.8,
                    fill: 'rgba(255,255,255,0.55)',
                }));
            }
            const wpts = [];
            for (let x = 0; x <= p.w-12; x += 5) {
                wpts.push(p.x+6+x, waterY + Math.sin(x*0.2)*2.8);
            }
            this._waterGroup.add(new Konva.Line({
                points: wpts, stroke: 'rgba(255,255,255,0.35)',
                strokeWidth: 1.5, tension: 0.4, lineCap: 'round',
            }));
        }

        // 蒸汽
        if (this._temperature > 65 && this._stage !== IH_STAGE.IDLE) {
            const alpha = Math.min(0.50, (this._temperature-65)/55);
            const W = this.width;
            [W*0.30, W*0.46, W*0.62].forEach((sx, i) => {
                this._waterGroup.add(new Konva.Line({
                    points: [sx, this._layout.lid.y-3, sx+(i-1)*5, this._layout.lid.y-14, sx, this._layout.lid.y-22],
                    stroke: `rgba(160,200,230,${alpha.toFixed(2)})`,
                    strokeWidth: 3, lineCap: 'round', tension: 0.5,
                }));
            });
        }
    }

    // ───────────────────────────────────────────────────────────────────
    //  IH 线圈（静态结构：平面涡旋铜利兹线）
    // ───────────────────────────────────────────────────────────────────
    _drawIhCoilStatic() {
        const c  = this._layout.ihCoil;
        const cx = c.x + c.w/2;
        const cy = c.y + c.h/2;

        // 背板（PEEK 绝缘基板，奶白色）
        this.group.add(new Konva.Rect({
            x: c.x, y: c.y, width: c.w, height: c.h,
            fill: '#e8e0c8', stroke: '#c8b880', strokeWidth: 0.8, cornerRadius: c.rx,
        }));

        // 平面涡旋线圈（从外向内 7 圈，椭圆近似）
        const coilRings = 7;
        for (let i = 0; i < coilRings; i++) {
            const rw = (c.w/2 - 8) * (1 - i * 0.11);
            const rh = (c.h/2 - 3) * (1 - i * 0.10);
            const brightness = Math.round(160 - i*12);
            this.group.add(new Konva.Ellipse({
                x: cx, y: cy,
                radiusX: rw, radiusY: rh,
                fill: 'none',
                stroke: `rgb(${brightness+30},${brightness},${brightness-40})`,
                strokeWidth: i < 3 ? 2.2 : 1.8,
            }));
        }
        // 线圈引出端（左右各一）
        this.group.add(new Konva.Line({
            points: [c.x+8, cy, c.x+8, c.y+c.h+6],
            stroke: '#a08040', strokeWidth: 2.5, lineCap: 'round',
        }));
        this.group.add(new Konva.Line({
            points: [c.x+c.w-8, cy, c.x+c.w-8, c.y+c.h+6],
            stroke: '#a08040', strokeWidth: 2.5, lineCap: 'round',
        }));
        // 标注
        this.group.add(new Konva.Text({
            x: cx-20, y: c.y+c.h*0.30,
            text: 'IH 感应线圈', fontSize: 8, fill: '#806040',
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    //  功率板（整流桥 + PFC + IGBT 静态结构）
    // ───────────────────────────────────────────────────────────────────
    _drawPowerBoard() {
        const pb = this._layout.powerBoard;
        // PCB 底色（绿色 PCB）
        this.group.add(new Konva.Rect({
            x: pb.x, y: pb.y, width: pb.w, height: pb.h,
            fill: '#1a4020', stroke: '#10301a', strokeWidth: 1, cornerRadius: pb.rx,
        }));
        this.group.add(new Konva.Text({
            x: pb.x+4, y: pb.y+3, text: '功率板 Power PCB',
            fontSize: 7.5, fill: '#60c060', fontStyle: 'bold',
        }));

        const W = this.width;
        const compY = pb.y + pb.h*0.40;

        // ── 整流桥（D1~D4，菱形符号）──
        const bx = pb.x + pb.w*0.10;
        this._drawRectBridge(bx, compY, 26);

        // ── PFC 电感（小方块）──
        const pfcX = pb.x + pb.w*0.32;
        this.group.add(new Konva.Rect({
            x: pfcX, y: compY-7, width: 16, height: 14,
            fill: '#603010', stroke: '#904020', strokeWidth: 0.8, cornerRadius: 2,
        }));
        this.group.add(new Konva.Text({ x: pfcX+2, y: compY-4, text: 'L', fontSize: 8, fill: '#ffcc80', fontStyle: 'bold' }));

        // ── 滤波电容（高大圆柱形）──
        const capX = pb.x + pb.w*0.50;
        this.group.add(new Konva.Rect({
            x: capX, y: compY-10, width: 14, height: 20,
            fill: '#1a2080', stroke: '#3040c0', strokeWidth: 0.8, cornerRadius: 2,
        }));
        this.group.add(new Konva.Rect({
            x: capX+2, y: compY-10, width: 10, height: 4,
            fill: '#c8c8c8', cornerRadius: [2,2,0,0],
        }));
        this.group.add(new Konva.Text({ x: capX+1, y: compY-3, text: 'C', fontSize: 8, fill: '#8090ff', fontStyle: 'bold' }));

        // ── IGBT（TO-247 封装，绘制为大黑块 + 引脚）──
        const igX = pb.x + pb.w*0.70;
        this._igbtBaseX = igX;
        this._igbtBaseY = compY;
        this._drawIgbtPackage(igX, compY, false);

        // PCB 走线（黄铜色细线）
        this.group.add(new Konva.Line({
            points: [bx+26, compY, pfcX, compY],
            stroke: '#c8a040', strokeWidth: 1.2,
        }));
        this.group.add(new Konva.Line({
            points: [pfcX+16, compY, capX, compY],
            stroke: '#c8a040', strokeWidth: 1.2,
        }));
        this.group.add(new Konva.Line({
            points: [capX+14, compY, igX, compY],
            stroke: '#c8a040', strokeWidth: 1.2,
        }));

        // 母线电压标注（动态文字由 _igbtGroup 刷新）
        this._dcBusLabel = new Konva.Text({
            x: pb.x+4, y: pb.y+pb.h-12,
            text: `Vbus: ---V  D: 0%`,
            fontSize: 7.5, fill: '#80cc80', fontFamily: 'monospace',
        });
        this.group.add(this._dcBusLabel);
    }

    _drawRectBridge(bx, by, size) {
        // 整流桥菱形符号
        const s = size / 2;
        // 菱形外框
        this.group.add(new Konva.Line({
            points: [bx, by-s, bx+s, by, bx, by+s, bx-s, by, bx, by-s],
            stroke: '#c0c0c0', strokeWidth: 1, closed: true, fill: '#303030',
        }));
        // 内部 × 对角线（四只二极管简化）
        this.group.add(new Konva.Line({ points: [bx-s+2,by-s+2, bx+s-2,by+s-2], stroke:'#60a0ff', strokeWidth:0.8 }));
        this.group.add(new Konva.Line({ points: [bx+s-2,by-s+2, bx-s+2,by+s-2], stroke:'#60a0ff', strokeWidth:0.8 }));
        // 标注
        this.group.add(new Konva.Text({ x: bx-6, y: by+s+2, text: 'Bridge', fontSize: 7, fill: '#80b0e0' }));
    }

    _drawIgbtPackage(igX, compY, isGlowing) {
        // TO-247 封装主体（黑色）
        this.group.add(new Konva.Rect({
            x: igX-2, y: compY-14, width: 22, height: 28,
            fill: isGlowing ? '#3a1a0a' : '#202020',
            stroke: isGlowing ? '#ff6020' : '#505050', strokeWidth: 1, cornerRadius: 2,
            shadowColor: isGlowing ? '#ff4000' : 'transparent',
            shadowBlur: isGlowing ? 8 : 0, shadowOpacity: 0.7,
        }));
        // 散热翅片
        this.group.add(new Konva.Rect({
            x: igX+18, y: compY-12, width: 8, height: 24,
            fill: '#b0b0b0', stroke: '#888', strokeWidth: 0.5,
        }));
        for (let i = 0; i < 5; i++) {
            this.group.add(new Konva.Line({
                points: [igX+18, compY-10+i*5, igX+26, compY-10+i*5],
                stroke: '#909090', strokeWidth: 0.6,
            }));
        }
        // 三根引脚（G、C、E）
        const pins = [{x:igX+2,lbl:'G'},{x:igX+8,lbl:'C'},{x:igX+14,lbl:'E'}];
        pins.forEach(p => {
            this.group.add(new Konva.Line({
                points: [p.x, compY+14, p.x, compY+22],
                stroke: '#c0c0c0', strokeWidth: 2, lineCap: 'round',
            }));
            this.group.add(new Konva.Text({
                x: p.x-3, y: compY+23, text: p.lbl, fontSize: 7, fill: '#a0c0a0',
            }));
        });
        // 标注
        this.group.add(new Konva.Text({
            x: igX-2, y: compY-12, text: 'IGBT', fontSize: 7.5,
            fill: isGlowing ? '#ff9050' : '#80a080', fontStyle: 'bold',
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    //  控制板（MCU + NTC 分压 + 驱动 IC 静态结构）
    // ───────────────────────────────────────────────────────────────────
    _drawCtrlBoard() {
        const cb = this._layout.ctrlBoard;
        // PCB（蓝色高端板）
        this.group.add(new Konva.Rect({
            x: cb.x, y: cb.y, width: cb.w, height: cb.h,
            fill: '#10203a', stroke: '#102860', strokeWidth: 1, cornerRadius: cb.rx,
        }));
        this.group.add(new Konva.Text({
            x: cb.x+4, y: cb.y+3, text: '控制板 MCU PCB',
            fontSize: 7.5, fill: '#4090e0', fontStyle: 'bold',
        }));

        const compY = cb.y + cb.h*0.45;

        // ── MCU 芯片（QFP 封装）──
        const mcuX = cb.x + cb.w*0.08;
        this.group.add(new Konva.Rect({
            x: mcuX, y: compY-11, width: 22, height: 22,
            fill: '#282828', stroke: '#606060', strokeWidth: 0.8, cornerRadius: 1,
        }));
        // MCU 引脚简化
        for (let i = 0; i < 5; i++) {
            this.group.add(new Konva.Rect({ x: mcuX-3, y: compY-8+i*4, width: 3, height: 2, fill: '#a0a0a0' }));
            this.group.add(new Konva.Rect({ x: mcuX+22, y: compY-8+i*4, width: 3, height: 2, fill: '#a0a0a0' }));
        }
        this.group.add(new Konva.Text({ x: mcuX+3, y: compY-6, text: 'MCU', fontSize: 8, fill: '#60a0ff', fontStyle: 'bold' }));

        // ── NTC 分压电路（R_pull + NTC）──
        const ntcX = cb.x + cb.w*0.42;
        // 上拉电阻
        this.group.add(new Konva.Rect({
            x: ntcX, y: compY-14, width: 10, height: 8,
            fill: '#805030', stroke: '#c08050', strokeWidth: 0.7, cornerRadius: 1,
        }));
        this.group.add(new Konva.Text({ x: ntcX+1, y: compY-13, text: 'Rp', fontSize: 7, fill: '#ffcc80' }));
        // 节点
        this.group.add(new Konva.Circle({
            x: ntcX+5, y: compY, radius: 2.5, fill: '#60c060',
        }));
        // NTC 本体
        this.group.add(new Konva.Rect({
            x: ntcX, y: compY+4, width: 10, height: 8,
            fill: '#802020', stroke: '#ff4040', strokeWidth: 0.7, cornerRadius: 1,
        }));
        this.group.add(new Konva.Text({ x: ntcX, y: compY+5, text: 'NTC', fontSize: 7, fill: '#ff8080' }));
        // 连线 Rp→节点→NTC
        this.group.add(new Konva.Line({ points:[ntcX+5,compY-6,ntcX+5,compY], stroke:'#c0e0c0',strokeWidth:1 }));
        this.group.add(new Konva.Line({ points:[ntcX+5,compY,ntcX+5,compY+4], stroke:'#c0e0c0',strokeWidth:1 }));
        // ADC 连线 → MCU
        this.group.add(new Konva.Line({
            points: [ntcX+5, compY, mcuX+22, compY-2],
            stroke: '#40c040', strokeWidth: 1, dash: [3,2],
        }));
        this.group.add(new Konva.Text({ x: ntcX+12, y: compY-8, text: 'ADC', fontSize: 7, fill: '#40c040' }));

        // ── 驱动 IC（IGBT Gate Driver）──
        const drvX = cb.x + cb.w*0.70;
        this.group.add(new Konva.Rect({
            x: drvX, y: compY-11, width: 18, height: 22,
            fill: '#282828', stroke: '#808080', strokeWidth: 0.8, cornerRadius: 1,
        }));
        this.group.add(new Konva.Text({ x: drvX+1, y: compY-8, text: 'DRV', fontSize: 7.5, fill: '#ffaa30', fontStyle: 'bold' }));
        // 光耦隔离符号
        this.group.add(new Konva.Line({
            points: [drvX+7, compY-11, drvX+7, compY+11],
            stroke: '#606060', strokeWidth: 0.8, dash: [2,1],
        }));
        // PWM 输入 → 驱动 IC
        this.group.add(new Konva.Line({
            points: [mcuX+22, compY+2, drvX, compY+2],
            stroke: '#ffaa30', strokeWidth: 1, dash: [3,2],
        }));
        this.group.add(new Konva.Text({ x: mcuX+24, y: compY-4, text: 'PWM', fontSize: 7, fill: '#ffaa30' }));
        // 驱动输出 → 功率板（跨区连线用端口表示）
        this.group.add(new Konva.Line({
            points: [drvX+18, compY, cb.x+cb.w, compY],
            stroke: '#ff8020', strokeWidth: 1.5,
        }));
        this.group.add(new Konva.Text({ x: cb.x+cb.w-16, y: compY-8, text: 'Vg', fontSize: 7, fill: '#ff8020' }));

        // NTC 实时数值标注（动态）
        this._ntcLabel = new Konva.Text({
            x: cb.x+4, y: cb.y+cb.h-12,
            text: `NTC: ---Ω  ADC: ----  V: ---V`,
            fontSize: 7, fill: '#40b0e0', fontFamily: 'monospace',
        });
        this.group.add(this._ntcLabel);
    }

    // ───────────────────────────────────────────────────────────────────
    //  底座
    // ───────────────────────────────────────────────────────────────────
    _drawBase() {
        const b = this._layout.base;
        this.group.add(new Konva.Rect({
            x: b.x, y: b.y, width: b.w, height: b.h,
            fill: '#181818', stroke: '#282828', strokeWidth: 1.5, cornerRadius: b.rx,
            shadowColor: '#000', shadowBlur: 4, shadowOffsetY: 2, shadowOpacity: 0.35,
        }));
        // 防滑脚垫
        for (let i = 0; i < 4; i++) {
            this.group.add(new Konva.Rect({
                x: b.x+b.w*(0.07+i*0.26)-10, y: b.y+b.h*0.55,
                width: 20, height: b.h*0.30, fill: '#101010', cornerRadius: 2,
            }));
        }
    }

    // ───────────────────────────────────────────────────────────────────
    //  操作面板（三栏布局）
    // ───────────────────────────────────────────────────────────────────
    _drawPanel() {
        const pn = this._layout.panel;
        this.group.add(new Konva.Rect({
            x: pn.x, y: pn.y, width: pn.w, height: pn.h,
            fill: '#0e0e1a', stroke: '#1e1e30', strokeWidth: 1, cornerRadius: pn.rx,
        }));
        // 分隔线
        const L = this._layout;
        [L.panelMid.x, L.panelRight.x].forEach(dx => {
            this.group.add(new Konva.Line({
                points: [dx, pn.y+6, dx, pn.y+pn.h-6],
                stroke: '#1e1e30', strokeWidth: 1, dash: [2,3],
            }));
        });

        this._panelGroup = new Konva.Group();
        this.group.add(this._panelGroup);

        this._drawPanelLeft();
        this._drawPanelMid();
        this._drawPanelRight();
    }

    // ── 面板左栏：温度数字 + 曲线 ───────────────────────────────────
    _drawPanelLeft() {
        const pl = this._layout.panelLeft;

        this._tempNumText = new Konva.Text({
            x: pl.x, y: pl.y+2, width: pl.w,
            text: `${Math.round(this._temperature)}°`,
            fontSize: 28, fontStyle: 'bold', fontFamily: 'monospace',
            fill: '#3890d0', align: 'center',
            shadowColor: '#3890d0', shadowBlur: 5, shadowOpacity: 0.5,
        });
        this._panelGroup.add(this._tempNumText);

        this._stageText = new Konva.Text({
            x: pl.x, y: pl.y+36, width: pl.w,
            text: '─ 待机 ─', fontSize: 9, fill: '#506090', align: 'center',
        });
        this._panelGroup.add(this._stageText);

        // duty 进度条
        this._dutyBar = new Konva.Rect({
            x: pl.x+4, y: pl.y+50, width: 0, height: 6,
            fill: '#2255a0', cornerRadius: 3,
        });
        this._panelGroup.add(new Konva.Rect({
            x: pl.x+4, y: pl.y+50, width: pl.w-8, height: 6,
            fill: '#1a1a28', stroke: '#2a2a40', strokeWidth: 0.5, cornerRadius: 3,
        }));
        this._panelGroup.add(this._dutyBar);
        this._panelGroup.add(new Konva.Text({
            x: pl.x+4, y: pl.y+60, text: 'Duty', fontSize: 7.5, fill: '#4060a0',
        }));

        // 温度曲线
        this._tempChartGroup = new Konva.Group();
        this._panelGroup.add(this._tempChartGroup);
        this._rebuildTempChart();
    }

    _rebuildTempChart() {
        this._tempChartGroup.destroyChildren();
        const pl = this._layout.panelLeft;
        const cx = pl.x+2, cy = pl.y+pl.h-2, cw = pl.w-4, ch = 38;

        this._tempChartGroup.add(new Konva.Rect({
            x: cx, y: cy-ch, width: cw, height: ch,
            fill: 'rgba(6,6,18,0.70)', stroke: '#181828', strokeWidth: 0.5, cornerRadius: 2,
        }));
        // 100°C 基准线
        const refY = cy - (100-20)/110*ch;
        this._tempChartGroup.add(new Konva.Line({
            points: [cx, refY, cx+cw, refY],
            stroke: 'rgba(200,60,30,0.38)', strokeWidth: 0.8, dash: [3,2],
        }));
        this._tempChartGroup.add(new Konva.Text({ x: cx+2, y: refY-9, text:'100°', fontSize:6, fill:'rgba(200,80,40,0.65)' }));

        const hist = this._tempHistory, n = hist.length;
        const pts  = [];
        for (let i = 0; i < n; i++) {
            pts.push(cx+(i/(n-1))*cw, cy - ((hist[i]-20)/110)*ch);
        }
        this._tempChartGroup.add(new Konva.Line({
            points: pts, stroke: this._getTempColor(),
            strokeWidth: 1.2, lineCap: 'round', lineJoin: 'round', tension: 0.3,
        }));
    }

    _getTempColor() {
        const t = this._temperature;
        if (t >= 100) return '#e04020';
        if (t >= 70)  return '#d08020';
        if (t >= 50)  return '#c0a020';
        return '#3890d0';
    }

    // ── 面板中栏：PWM 示波 + NTC 数值 ───────────────────────────────
    _drawPanelMid() {
        const pm = this._layout.panelMid;
        // PWM 示波器背景
        this.group.add(new Konva.Rect({
            x: pm.x+2, y: pm.y+2, width: pm.w-4, height: pm.h*0.52,
            fill: 'rgba(0,8,0,0.80)', stroke: '#103010', strokeWidth: 0.8, cornerRadius: 3,
        }));
        this.group.add(new Konva.Text({
            x: pm.x+4, y: pm.y+4, text: 'PWM Gate Signal',
            fontSize: 7, fill: '#30a030',
        }));
        // 示波网格
        for (let i = 1; i < 4; i++) {
            this.group.add(new Konva.Line({
                points: [pm.x+2, pm.y+2+i*(pm.h*0.52/4), pm.x+pm.w-2, pm.y+2+i*(pm.h*0.52/4)],
                stroke: 'rgba(0,80,0,0.25)', strokeWidth: 0.5,
            }));
        }

        // NTC 数据显示
        this._ntcPanelText = new Konva.Text({
            x: pm.x+4, y: pm.y + pm.h*0.56,
            text: 'NTC\nR: ----Ω\nV: --.- V\nADC: ----\nT: --.- °C',
            fontSize: 8, fill: '#40b0e0', lineHeight: 1.6, fontFamily: 'monospace',
        });
        this._panelGroup.add(this._ntcPanelText);

        // PWM 波形组（动态）
        this._pwmWaveGroup = new Konva.Group();
        this._panelGroup.add(this._pwmWaveGroup);
        this._pwmBgX  = pm.x+2;
        this._pwmBgY  = pm.y+2;
        this._pwmBgW  = pm.w-4;
        this._pwmBgH  = pm.h*0.52;
    }

    _rebuildPwmWave() {
        this._pwmWaveGroup.destroyChildren();
        const hist = this._pwmHistory;
        const n    = hist.length;
        const x0   = this._pwmBgX+2;
        const y0   = this._pwmBgY + this._pwmBgH - 4;
        const yH   = this._pwmBgH - 14;
        const dx   = (this._pwmBgW-4) / (n-1);

        const pts = [];
        for (let i = 0; i < n; i++) {
            pts.push(x0 + i*dx, y0 - hist[i]*yH);
        }
        this._pwmWaveGroup.add(new Konva.Line({
            points: pts, stroke: '#30dd30',
            strokeWidth: 1.2, lineCap: 'square', lineJoin: 'miter',
        }));
        // Duty 数值标注
        this._pwmWaveGroup.add(new Konva.Text({
            x: x0, y: this._pwmBgY+4,
            text: `D=${(this._dutyCycle*100).toFixed(0)}%  f=${(this.switchFreq/1000).toFixed(0)}kHz`,
            fontSize: 7.5, fill: '#80ff80', fontFamily: 'monospace',
        }));
    }

    // ── 面板右栏：按键 + 阶段指示灯 ────────────────────────────────
    _drawPanelRight() {
        const pr = this._layout.panelRight;

        // 煮饭键
        const bw = pr.w*0.80, bh = pr.h*0.26;
        const bx = pr.x + pr.w*0.10, by = pr.y + pr.h*0.05;

        this._cookBtnShadow = new Konva.Rect({
            x: bx+3, y: by+4, width: bw, height: bh,
            fill: 'rgba(0,0,0,0.45)', cornerRadius: 6,
        });
        this._cookBtn = new Konva.Rect({
            x: bx, y: by, width: bw, height: bh,
            fill: '#1a3a70', stroke: '#2255a0', strokeWidth: 1, cornerRadius: 6,
        });
        this._cookBtnHL = new Konva.Rect({
            x: bx+4, y: by+3, width: bw-8, height: bh*0.35,
            fill: 'rgba(255,255,255,0.12)', cornerRadius: [4,4,0,0],
        });
        this._cookBtnLabel = new Konva.Text({
            x: bx, y: by+bh*0.28, width: bw,
            text: '开始煮饭', fontSize: 10, fontStyle: 'bold',
            fill: '#80c0ff', align: 'center',
        });
        this._panelGroup.add(this._cookBtnShadow, this._cookBtn, this._cookBtnHL, this._cookBtnLabel);

        // 取消键
        const cby = by + bh + 6;
        this._cancelBtn = new Konva.Rect({
            x: bx, y: cby, width: bw, height: bh*0.75,
            fill: '#2a1a1a', stroke: '#503030', strokeWidth: 1, cornerRadius: 5,
        });
        this._cancelBtnLabel = new Konva.Text({
            x: bx, y: cby+bh*0.18, width: bw,
            text: '取消', fontSize: 10, fill: '#c06060', align: 'center',
        });
        this._panelGroup.add(this._cancelBtn, this._cancelBtnLabel);

        // 阶段指示 LED 条
        const stages = [
            { key: IH_STAGE.PREHEAT, label: '预热', color: '#ff9020' },
            { key: IH_STAGE.BOIL,    label: '沸腾', color: '#e03020' },
            { key: IH_STAGE.SIMMER,  label: '焖饭', color: '#d8b020' },
            { key: IH_STAGE.DONE,    label: '焖熟', color: '#40cc40' },
            { key: IH_STAGE.WARM,    label: '保温', color: '#3080ff' },
        ];
        this._stageLeds = {};
        stages.forEach((s, i) => {
            const ly = pr.y + pr.h*0.58 + i*14;
            const dot = new Konva.Circle({
                x: pr.x+8, y: ly, radius: 4,
                fill: '#181828', stroke: '#282840', strokeWidth: 0.6,
            });
            const lbl = new Konva.Text({
                x: pr.x+16, y: ly-5, text: s.label,
                fontSize: 8.5, fill: '#404060',
            });
            this._panelGroup.add(dot, lbl);
            this._stageLeds[s.key] = { dot, lbl, color: s.color, offFill: '#181828', offText: '#404060' };
        });

        this._btnBaseX = bx;
        this._btnBaseY = by;
        this._btnW     = bw;
        this._btnH     = bh;
        this._btnOff   = 0;

        this._updatePanelVisuals();
    }

    _updatePanelVisuals() {
        if (!this._cookBtn) return;

        // 温度
        const c = this._getTempColor();
        if (this._tempNumText) {
            this._tempNumText.text(`${Math.round(this._temperature)}°`);
            this._tempNumText.fill(c); this._tempNumText.shadowColor(c);
        }

        // 阶段文字
        const stageMap = {
            [IH_STAGE.IDLE]:    '─ 待机 ─',
            [IH_STAGE.PREHEAT]: '▲ 预热中',
            [IH_STAGE.BOIL]:    '● 沸腾加热',
            [IH_STAGE.SIMMER]:  '◆ 焖饭中',
            [IH_STAGE.DONE]:    '✓ 焖熟',
            [IH_STAGE.WARM]:    '♨ 保温中',
        };
        if (this._stageText) this._stageText.text(stageMap[this._stage] || '─');

        // Duty 进度条
        if (this._dutyBar) {
            const pl = this._layout.panelLeft;
            this._dutyBar.width(Math.max(0, (pl.w-8)*this._dutyCycle));
            this._dutyBar.fill(this._dutyCycle > 0.7 ? '#e04020' : this._dutyCycle > 0.3 ? '#d08020' : '#2255a0');
        }

        // 煮饭键颜色
        const cooking = this._stage !== IH_STAGE.IDLE;
        if (this._cookBtn) this._cookBtn.fill(cooking ? '#1e4880' : '#1a3a70');

        // 阶段 LED
        if (this._stageLeds) {
            Object.entries(this._stageLeds).forEach(([key, led]) => {
                const on = key === this._stage;
                led.dot.fill(on ? led.color : led.offFill);
                led.dot.shadowColor(on ? led.color : 'transparent');
                led.dot.shadowBlur(on ? 8 : 0);
                led.dot.shadowOpacity(0.9);
                led.lbl.fill(on ? led.color : led.offText);
            });
        }

        // NTC 面板文字
        const r = Math.round(this._ntcR);
        const v = this._ntcV.toFixed(2);
        const adc = this._adcRaw;
        if (this._ntcPanelText) {
            this._ntcPanelText.text(
                `NTC\nR: ${r.toLocaleString()}Ω\nV: ${v} V\nADC: ${adc}\nT: ${this._temperature.toFixed(1)}°C`
            );
        }
        if (this._ntcLabel) {
            this._ntcLabel.text(`NTC: ${r}Ω  ADC:${adc}  V:${v}V`);
        }

        // 直流母线电压
        const vbus = this._dcBusVolt.toFixed(0);
        const duty = (this._dutyCycle*100).toFixed(0);
        if (this._dcBusLabel) this._dcBusLabel.text(`Vbus:${vbus}V  D:${duty}%`);
    }

    // ───────────────────────────────────────────────────────────────────
    //  标注
    // ───────────────────────────────────────────────────────────────────
    _drawLabel() {
        this.group.add(new Konva.Text({
            x: 0, y: -16, width: this.width,
            text: `${this.label}  IH 电磁感应电饭煲  ${this.ratedVoltage}V / ${this.ratedPower}W  ${(this.switchFreq/1000).toFixed(0)}kHz`,
            fontSize: 9, fontStyle: 'bold', fill: '#546e7a', align: 'center',
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    //  交互绑定
    // ───────────────────────────────────────────────────────────────────
    _bindInteraction() {
        setTimeout(() => {
            if (this._cookBtn) {
                this._cookBtn.on('click tap', () => this.pressCook());
                this._cookBtnLabel.on('click tap', () => this.pressCook());
                [this._cookBtn, this._cookBtnLabel].forEach(n => {
                    n.on('mouseenter', () => { document.body.style.cursor = 'pointer'; });
                    n.on('mouseleave', () => { document.body.style.cursor = 'default'; });
                });
            }
            if (this._cancelBtn) {
                this._cancelBtn.on('click tap', () => this.pressCancel());
                this._cancelBtnLabel.on('click tap', () => this.pressCancel());
                [this._cancelBtn, this._cancelBtnLabel].forEach(n => {
                    n.on('mouseenter', () => { document.body.style.cursor = 'pointer'; });
                    n.on('mouseleave', () => { document.body.style.cursor = 'default'; });
                });
            }
        }, 80);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  Tick — 由 consys._tickAll 在 20fps 调用
    // ═══════════════════════════════════════════════════════════════════
    tick(dt) {
        this._tickStageLogic(dt);
        this._tickPhysics(dt);
        this._tickIgbt(dt);
        this._tickNtc();
        this._tickCoilAnim(dt);
        this._tickHistoryRecord(dt);
        this._tickPwmRecord(dt);
        this._rebuildDynamicLayers();
        this._updatePanelVisuals();
        this._refreshCache();
    }

    // ── 阶段状态机逻辑 ───────────────────────────────────────────────
    _tickStageLogic(dt) {
        if (this._stage === IH_STAGE.IDLE) return;

        this._stageTimer += dt * this._simScale;  // 压缩时间

        switch (this._stage) {
            case IH_STAGE.PREHEAT:
                this._dutyCycle = 0.30;
                if (this._temperature >= 82) {
                    this._stage = IH_STAGE.BOIL;
                    this._stageTimer = 0;
                    this.emit?.('stageChange', { stage: IH_STAGE.BOIL });
                }
                break;

            case IH_STAGE.BOIL:
                this._dutyCycle = 1.00;
                // 沸腾后，顶盖蒸汽温度持续 ≥ 95°C，视为沸腾稳定 → 焖饭
                if (this._temperature >= 100 && this._lidTemp >= 92 && this._stageTimer > 15) {
                    this._stage = IH_STAGE.SIMMER;
                    this._stageTimer = 0;
                    this.emit?.('stageChange', { stage: IH_STAGE.SIMMER });
                }
                break;

            case IH_STAGE.SIMMER:
                // PID 调节：维持微沸
                this._dutyCycle = Math.max(0.25, Math.min(0.55, 0.40 + (100-this._temperature)*0.03));
                // 水分被吸收，水位降低；蒸汽温度趋于下降 → 焖熟
                if (this._waterLevel < 0.08 || this._stageTimer > 60) {
                    this._stage = IH_STAGE.DONE;
                    this._stageTimer = 0;
                    this._dutyCycle  = 0;
                    this.emit?.('stageChange', { stage: IH_STAGE.DONE });
                }
                break;

            case IH_STAGE.DONE:
                this._dutyCycle = 0;
                if (this._stageTimer > 20) {  // 余热焖 ~20s 仿真（对应实际约 10min）
                    this._stage = IH_STAGE.WARM;
                    this._stageTimer = 0;
                    this.emit?.('stageChange', { stage: IH_STAGE.WARM });
                }
                break;

            case IH_STAGE.WARM:
                // PID 保温：目标 70°C
                const err = this.warmTarget - this._temperature;
                this._dutyCycle = Math.max(0.02, Math.min(0.10, 0.05 + err*0.006));
                break;
        }
    }

    // ── 温度物理仿真 ─────────────────────────────────────────────────
    _tickPhysics(dt) {
        const sdt  = dt * this._simScale;
        const T    = this._temperature;
        const Ta   = this.ambientTemp;
        const k    = 0.016;
        const Peff = this.ratedPower * this._dutyCycle * this.ihEfficiency;

        if (this._stage === IH_STAGE.IDLE) {
            this._temperature = Math.max(Ta, T - k*(T-Ta)*sdt);
            this._dcBusVolt   = 0;
            return;
        }

        this._dcBusVolt = 220 * Math.SQRT2 * 0.90;  // 约 280V DC（全波整流 + 电容滤波）

        const hasWater = this._waterLevel > 0.02;
        let dT;

        if (this._stage === IH_STAGE.BOIL && hasWater && T >= 99) {
            // 沸腾相变锁温
            dT = (Peff * 0.000030) * sdt;
            this._waterLevel = Math.max(0, this._waterLevel - 0.0012*sdt);
        } else if (this._stage === IH_STAGE.SIMMER && hasWater) {
            dT = (Peff * 0.00055 - k*(T-Ta)) * sdt;
            this._waterLevel = Math.max(0, this._waterLevel - 0.0006*sdt);
        } else if (this._stage === IH_STAGE.DONE) {
            dT = -k*(T-Ta)*sdt * 0.3;   // 缓慢余热散失
        } else if (this._stage === IH_STAGE.WARM) {
            dT = (Peff * 0.00045 - k*(T-Ta)) * sdt;
        } else {
            // PREHEAT + BOIL 升温段
            dT = (Peff * 0.00080 - k*(T-Ta)) * sdt;
        }

        this._temperature = Math.max(Ta, T + dT);
        this._cookProg    = Math.min(1, this._cookProg + sdt * 0.006);

        // 锅盖 NTC（蒸汽温度）：滞后主温 ~8°C，沸腾后升至 95°C
        const lidTarget   = Math.min(this._temperature * 0.92, this._temperature - 8);
        this._lidTemp    += (lidTarget - this._lidTemp) * 0.08 * sdt;

        // IGBT 结温（开关损耗 + 导通损耗）
        const igbtPdiss   = this.ratedPower * this._dutyCycle * 0.015;  // 约 1.5% 损耗
        this._igbtTemp   += (igbtPdiss*0.012 - 0.015*(this._igbtTemp-Ta)) * sdt;
        this._igbtTemp    = Math.max(Ta, this._igbtTemp);
    }

    // ── IGBT 开关动画（高频仿真：每 50ms 翻转一次视觉状态）─────────
    _tickIgbt(dt) {
        if (this._stage === IH_STAGE.IDLE) {
            this._igbtOn = false; return;
        }
        this._igbtFlipT += dt;
        const period = 1 / 20;  // 视觉翻转 20Hz（实际 25kHz 无法直接显示）
        if (this._igbtFlipT >= period) {
            this._igbtFlipT = 0;
            this._igbtOn = Math.random() < this._dutyCycle;
        }
    }

    // ── NTC 温度换算 ─────────────────────────────────────────────────
    _tickNtc() {
        this._ntcR   = this._calcNtcR(this._temperature);
        this._ntcV   = this._calcNtcV(this._ntcR);
        this._adcRaw = Math.round(this._ntcV / this.vcc * 4095);
    }

    /**
     * NTC 阻值换算（Steinhart–Hart 简化式）
     *   R = R_ref × exp( B × (1/T − 1/T_ref) )
     *   T_ref = 298.15K（25°C），R_ref = ntcR25
     */
    _calcNtcR(tempC) {
        const T_ref = 298.15;
        const T     = tempC + 273.15;
        return this.ntcR25 * Math.exp(this.ntcB * (1/T - 1/T_ref));
    }

    /** NTC 分压：V_ntc = Vcc × R_NTC / (R_pull + R_NTC) */
    _calcNtcV(rNtc) {
        return this.vcc * rNtc / (this.ntcPull + rNtc);
    }

    // ── IH 线圈磁场动画 ──────────────────────────────────────────────
    _tickCoilAnim(dt) {
        if (this._stage === IH_STAGE.IDLE) {
            this._coilFlux = Math.max(0, this._coilFlux - dt*2);
        } else {
            const target  = this._dutyCycle;
            this._coilFlux += (target - this._coilFlux) * 0.15;
        }
        this._coilPhase += dt * 2 * Math.PI * 4;   // 4Hz 视觉旋转
        this._eddyPhase += dt * 2 * Math.PI * 6;
    }

    // ── 历史记录 ─────────────────────────────────────────────────────
    _tickHistoryRecord(dt) {
        this._histTimer += dt;
        if (this._histTimer >= 0.5) {
            this._histTimer = 0;
            this._tempHistory.shift();
            this._tempHistory.push(this._temperature);
        }
    }

    _tickPwmRecord(dt) {
        this._pwmTimer += dt;
        if (this._pwmTimer >= 0.08) {
            this._pwmTimer = 0;
            this._pwmHistory.shift();
            // 生成方波样本（模拟 PWM）：随机 0/1，概率=dutyCycle
            this._pwmHistory.push(this._stage !== IH_STAGE.IDLE && Math.random() < this._dutyCycle ? 1 : 0);
        }
    }

    // ── 动态层整体重绘 ───────────────────────────────────────────────
    _rebuildDynamicLayers() {
        this._rebuildWaterLayer();
        this._rebuildIgbtLayer();
        this._rebuildNtcLayer();
        this._rebuildCoilLayer();
        this._rebuildTempChart();
        this._rebuildPwmWave();
        this._updateHeaterGlow();
    }

    // ── IGBT 动态层（开关状态 + 结温 + 电流方向）────────────────────
    _rebuildIgbtLayer() {
        this._igbtGroup.destroyChildren();
        const pb  = this._layout.powerBoard;
        const igX = this._igbtBaseX;
        const igY = this._igbtBaseY;
        const on  = this._igbtOn;

        // IGBT 封装（高亮表示开通）
        this._igbtGroup.add(new Konva.Rect({
            x: igX-2, y: igY-14, width: 22, height: 28,
            fill: on ? '#3a1a08' : '#202020',
            stroke: on ? '#ff6020' : '#505050', strokeWidth: on ? 1.5 : 1,
            cornerRadius: 2,
            shadowColor: on ? '#ff4000' : 'transparent',
            shadowBlur: on ? 10 : 0, shadowOpacity: 0.8,
        }));
        this._igbtGroup.add(new Konva.Text({
            x: igX-2, y: igY-11, text: 'IGBT',
            fontSize: 7.5, fill: on ? '#ff8040' : '#808080', fontStyle: 'bold',
        }));
        // 开通时电流流向箭头（C → E，橙色）
        if (on) {
            this._igbtGroup.add(new Konva.Arrow({
                points: [igX+8, igY-12, igX+8, igY+12],
                stroke: '#ff7020', strokeWidth: 2,
                fill: '#ff7020', pointerLength: 4, pointerWidth: 4,
            }));
        }
        // 结温显示
        const tjColor = this._igbtTemp > 90 ? '#ff4020' : this._igbtTemp > 60 ? '#ff9020' : '#80c060';
        this._igbtGroup.add(new Konva.Text({
            x: igX-2, y: igY+16, text: `Tj:${Math.round(this._igbtTemp)}°`,
            fontSize: 7.5, fill: tjColor, fontFamily: 'monospace',
        }));

        // 电流路径（母线 → IGBT → IH 线圈，虚线）
        if (this._stage !== IH_STAGE.IDLE) {
            const coil = this._layout.ihCoil;
            const alpha = this._dutyCycle * (on ? 0.8 : 0.3);
            this._igbtGroup.add(new Konva.Line({
                points: [igX+8, pb.y, igX+8, coil.y+coil.h],
                stroke: `rgba(255,120,30,${alpha.toFixed(2)})`,
                strokeWidth: 1.5, dash: [4,3], lineCap: 'round',
            }));
        }
    }

    // ── NTC 动态层（分压节点电压 + 测量示意）────────────────────────
    _rebuildNtcLayer() {
        this._ntcGroup.destroyChildren();
        const p   = this._layout.pot;
        const ntcX = p.x + p.w - 10;
        const ntcY = p.y + p.h - 5;

        // NTC 贴片（贴于内胆底部外壁弹片上）
        const ntcColor = this._temperature > 100 ? '#ff3018' :
                         this._temperature > 70  ? '#ff8020' :
                         this._temperature > 50  ? '#e0b020' : '#4090e0';
        this._ntcGroup.add(new Konva.Rect({
            x: ntcX-6, y: ntcY-5, width: 12, height: 10,
            fill: ntcColor, stroke: '#888', strokeWidth: 0.8, cornerRadius: 1.5,
            shadowColor: ntcColor, shadowBlur: 4, shadowOpacity: 0.7,
        }));
        this._ntcGroup.add(new Konva.Text({
            x: ntcX-12, y: ntcY-13, text: 'NTC', fontSize: 7.5, fill: ntcColor,
        }));
        // 弹片（弹性臂，确保紧压内胆）
        this._ntcGroup.add(new Konva.Line({
            points: [ntcX, ntcY+5, ntcX, ntcY+18, ntcX+20, ntcY+18],
            stroke: '#8888a0', strokeWidth: 1.5, lineCap: 'round', lineJoin: 'round',
        }));

        // 导线 → 控制板（虚线）
        const cb = this._layout.ctrlBoard;
        this._ntcGroup.add(new Konva.Line({
            points: [ntcX+6, ntcY, ntcX+6, ntcY+30, cb.x+cb.w*0.50, cb.y+cb.h*0.45],
            stroke: `rgba(40,180,40,0.50)`,
            strokeWidth: 1, dash: [3,2], lineCap: 'round',
        }));

        // 实时电压/阻值标注（浮动气泡）
        const v   = this._ntcV.toFixed(2);
        const r   = (this._ntcR/1000).toFixed(1);
        this._ntcGroup.add(new Konva.Rect({
            x: ntcX+8, y: ntcY-18, width: 58, height: 16,
            fill: 'rgba(8,20,8,0.80)', stroke: '#204020', strokeWidth: 0.5, cornerRadius: 2,
        }));
        this._ntcGroup.add(new Konva.Text({
            x: ntcX+10, y: ntcY-15,
            text: `${r}kΩ  ${v}V`,
            fontSize: 8, fill: '#40d040', fontFamily: 'monospace',
        }));
    }

    // ── IH 线圈磁场 + 涡流动态层 ────────────────────────────────────
    _rebuildCoilLayer() {
        this._coilGroup.destroyChildren();
        const c  = this._layout.ihCoil;
        const cx = c.x + c.w/2;
        const cy = c.y + c.h/2;
        const flux = this._coilFlux;
        if (flux < 0.02) return;

        // ── 磁力线（从线圈向上穿透内胆底壁）──
        // 用多条向上弯曲的弧线表示磁通量穿透方向
        const nLines = 5;
        const p      = this._layout.pot;
        const potBot = p.y + p.h - 6;  // 内胆底部
        for (let i = 0; i < nLines; i++) {
            const frac   = (i - (nLines-1)/2) / (nLines-1) * 0.7;
            const startX = cx + frac*(c.w*0.55);
            const alpha  = flux * (0.5 - Math.abs(frac)*0.3);
            const phase  = this._coilPhase + i * 0.4;
            const wave   = Math.sin(phase) * 3 * flux;
            this._coilGroup.add(new Konva.Line({
                points: [
                    startX, cy-4,
                    startX+wave*0.5, cy - (potBot-cy)*0.35,
                    startX-wave*0.5, cy - (potBot-cy)*0.70,
                    startX, potBot,
                ],
                stroke: `rgba(60,130,255,${alpha.toFixed(3)})`,
                strokeWidth: 1.2, tension: 0.5, lineCap: 'round',
                dash: [6,3],
            }));
            // 磁场方向箭头（中间位置）
            const midX = startX + wave*0.1;
            const midY = cy - (potBot-cy)*0.5;
            this._coilGroup.add(new Konva.Arrow({
                points: [midX, midY+5, midX, midY-5],
                stroke: `rgba(80,150,255,${(alpha*0.8).toFixed(3)})`,
                fill:   `rgba(80,150,255,${(alpha*0.8).toFixed(3)})`,
                strokeWidth: 1, pointerLength: 4, pointerWidth: 3,
            }));
        }

        // 磁场强度标注
        this._coilGroup.add(new Konva.Text({
            x: c.x+c.w+4, y: cy-10,
            text: `B~${(flux*0.8).toFixed(2)}T`,
            fontSize: 7.5, fill: `rgba(80,150,255,${Math.min(1,flux+0.2).toFixed(2)})`,
            fontFamily: 'monospace',
        }));

        // ── 涡流（内胆底壁中的感应电流，椭圆环）──
        if (flux > 0.15) {
            const nEddy = 3;
            for (let i = 0; i < nEddy; i++) {
                const ex    = c.x + c.w*(0.20+i*0.28);
                const ey    = potBot - 3;
                const er    = (c.w*0.10)*(1-i*0.05);
                const ephase = this._eddyPhase + i*2.1;
                const ealpha = flux * 0.55 * (0.5+0.5*Math.sin(ephase));
                // 涡流椭圆
                this._coilGroup.add(new Konva.Ellipse({
                    x: ex, y: ey, radiusX: er, radiusY: 3.5,
                    fill: 'none',
                    stroke: `rgba(255,160,30,${ealpha.toFixed(3)})`,
                    strokeWidth: 1.5,
                }));
                // 涡流旋转方向符号
                this._coilGroup.add(new Konva.Arc({
                    x: ex, y: ey,
                    innerRadius: er-1, outerRadius: er,
                    angle: 280, fill: `rgba(255,180,40,${(ealpha*0.7).toFixed(3)})`,
                    rotation: ephase * 180/Math.PI,
                }));
            }
            // 涡流标注
            this._coilGroup.add(new Konva.Text({
                x: c.x, y: potBot-12,
                text: '≈ 涡流（Eddy Current）→ 发热',
                fontSize: 7, fill: `rgba(255,160,40,${Math.min(0.9,flux).toFixed(2)})`,
            }));
        }

        // 高频电流波形示意（线圈右侧）
        if (flux > 0.1) {
            const wx   = c.x + c.w + 6;
            const wy   = cy;
            const wpts = [];
            for (let i = 0; i < 32; i++) {
                const px = wx + i*2.5;
                const py = wy + Math.sin(this._coilPhase*2 + i*0.6) * 5 * flux;
                wpts.push(px, py);
            }
            this._coilGroup.add(new Konva.Line({
                points: wpts, stroke: `rgba(60,220,255,${(flux*0.7).toFixed(2)})`,
                strokeWidth: 1.2, tension: 0.1, lineCap: 'round',
            }));
            this._coilGroup.add(new Konva.Text({
                x: wx, y: wy-12,
                text: `${(this.switchFreq/1000).toFixed(0)}kHz`,
                fontSize: 7, fill: `rgba(60,220,255,${(flux*0.7).toFixed(2)})`,
            }));
        }
    }

    _updateHeaterGlow() {
        // 内胆底壁受热发光（IH 涡流发热可视化）
        const coil = this._layout.ihCoil;
        if (!this._coilHeatRect) {
            this._coilHeatRect = new Konva.Rect({
                x: coil.x, y: coil.y-6, width: coil.w, height: 10,
                fill: 'rgba(255,80,0,0)', cornerRadius: 2,
            });
            this.group.add(this._coilHeatRect);
        }
        const op = Math.min(0.55, this._coilFlux * (this._temperature-20)/100);
        this._coilHeatRect.fill(`rgba(255,80,0,${op.toFixed(3)})`);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  外部操作接口
    // ═══════════════════════════════════════════════════════════════════

    /**
     * 按下开始煮饭键
     *   - IDLE / WARM → PREHEAT
     *   - 其他阶段忽略
     */
    pressCook() {
        if (this._stage !== IH_STAGE.IDLE && this._stage !== IH_STAGE.WARM) return;
        this._waterLevel = 1.0;
        this._cookProg   = 0;
        this._stageTimer = 0;
        this._stage      = IH_STAGE.PREHEAT;
        this._cookCount++;
        this.emit?.('stageChange', { stage: IH_STAGE.PREHEAT });
        this._refreshCache();
    }

    /** 取消 / 停止 */
    pressCancel() {
        if (this._stage === IH_STAGE.IDLE) return;
        this._stage      = IH_STAGE.IDLE;
        this._dutyCycle  = 0;
        this._stageTimer = 0;
        this.emit?.('stageChange', { stage: IH_STAGE.IDLE });
        this._refreshCache();
    }

    // ── 查询接口 ─────────────────────────────────────────────────────
    getStage()          { return this._stage;       }
    getTemperature()    { return this._temperature; }
    getLidTemperature() { return this._lidTemp;     }
    getWaterLevel()     { return this._waterLevel;  }
    getCookProgress()   { return this._cookProg;    }
    getDutyCycle()      { return this._dutyCycle;   }
    getIgbtTemp()       { return this._igbtTemp;    }
    getNtcResistance()  { return this._ntcR;        }
    getNtcVoltage()     { return this._ntcV;        }
    getAdcRaw()         { return this._adcRaw;      }
    getDcBusVoltage()   { return this._dcBusVolt;   }
    getCookCount()      { return this._cookCount;   }
    isIdle()            { return this._stage === IH_STAGE.IDLE;  }
    isWarming()         { return this._stage === IH_STAGE.WARM;  }

    /** 手动设置水位（测试接口）*/
    refillWater(level = 1.0) {
        this._waterLevel = Math.min(1, Math.max(0, level));
        this._refreshCache();
    }

    // ═══════════════════════════════════════════════════════════════════
    //  配置字段（供属性编辑器调用）
    // ═══════════════════════════════════════════════════════════════════
    getConfigFields() {
        return [
            { label: '位号/名称',             key: 'label',        type: 'text'   },
            { label: '额定电压 (V)',           key: 'ratedVoltage', type: 'number' },
            { label: '额定功率 (W)',           key: 'ratedPower',   type: 'number' },
            { label: 'IGBT 开关频率 (Hz)',     key: 'switchFreq',   type: 'number' },
            { label: 'IH 效率 (0~1)',          key: 'ihEfficiency', type: 'number' },
            { label: '保温目标温度 (°C)',      key: 'warmTarget',   type: 'number' },
            { label: 'NTC R25 (Ω)',            key: 'ntcR25',       type: 'number' },
            { label: 'NTC B 值 (K)',           key: 'ntcB',         type: 'number' },
            { label: 'NTC 上拉电阻 (Ω)',       key: 'ntcPull',      type: 'number' },
            { label: 'MCU Vcc (V)',            key: 'vcc',          type: 'number' },
            { label: '仿真加速倍率',           key: 'simScale',     type: 'number' },
            { label: '初始水量 (0~1)',         key: 'waterLevel',   type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label)        this.label        = cfg.label;
        if (cfg.ratedPower)   this.ratedPower   = parseFloat(cfg.ratedPower)   || this.ratedPower;
        if (cfg.switchFreq)   this.switchFreq   = parseFloat(cfg.switchFreq)   || this.switchFreq;
        if (cfg.ihEfficiency) this.ihEfficiency = parseFloat(cfg.ihEfficiency) || this.ihEfficiency;
        if (cfg.warmTarget)   this.warmTarget   = parseFloat(cfg.warmTarget)   || this.warmTarget;
        if (cfg.ntcR25)       this.ntcR25       = parseFloat(cfg.ntcR25)       || this.ntcR25;
        if (cfg.ntcB)         this.ntcB         = parseFloat(cfg.ntcB)         || this.ntcB;
        if (cfg.ntcPull)      this.ntcPull      = parseFloat(cfg.ntcPull)      || this.ntcPull;
        if (cfg.vcc)          this.vcc          = parseFloat(cfg.vcc)          || this.vcc;
        if (cfg.simScale)     this._simScale    = parseFloat(cfg.simScale)     || this._simScale;
        if (cfg.waterLevel !== undefined) this.refillWater(parseFloat(cfg.waterLevel));
        this.config = { ...this.config, ...cfg };
        this._refreshCache();
    }

    destroy() {
        super.destroy?.();
    }
}