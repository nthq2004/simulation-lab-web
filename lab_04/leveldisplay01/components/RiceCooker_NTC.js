import { BaseComponent } from './BaseComponent.js';

/**
 * 微电脑电饭煲仿真组件
 * （Microcomputer Rice Cooker — 传统加热盘式）
 *
 * ══════════════════════════════════════════════════════════════════════
 *  整机电路拓扑（五大子系统）
 * ══════════════════════════════════════════════════════════════════════
 *
 *  ┌─ 子系统 1：电源与功率回路 ──────────────────────────────────────┐
 *  │                                                                    │
 *  │  220V AC ──► 电源变压器 ──► 整流滤波 ──► 5V/12V 低压电源        │
 *  │           ──► 加热盘（发热盘，铝/不锈钢铸造）                    │
 *  │               · 功率：500W ~ 900W                                │
 *  │               · 电阻值约 50~100Ω                                 │
 *  │           ──► 继电器 / 双向可控硅（TRIAC）                       │
 *  │               · 继电器：电磁机械式，有咔哒声，适合大功率 ON/OFF  │
 *  │               · TRIAC：固态开关，过零触发，调功/移相控制         │
 *  │               · 本组件采用：继电器（主加热）+ TRIAC（选配保温）  │
 *  └────────────────────────────────────────────────────────────────────┘
 *
 *  ┌─ 子系统 2：测温回路（NTC + 上拉电阻 + ADC）─────────────────────┐
 *  │                                                                    │
 *  │  NTC 热敏电阻（Negative Temperature Coefficient）                │
 *  │    · 贴于内胆底部中心（紧压发热盘，涂导热硅脂）                  │
 *  │    · 典型参数：R25 = 50kΩ，B = 3950K（或 10kΩ / 4100K）         │
 *  │    · T↑ → R_NTC↓ → 分压电路输出电压 V_ntc↓                     │
 *  │                                                                    │
 *  │  上拉电阻 R_pull（固定电阻，典型 10k~50kΩ）                     │
 *  │    · V_ntc = Vcc × R_NTC / (R_pull + R_NTC)                     │
 *  │                                                                    │
 *  │  MCU 内置 ADC（10bit / 12bit）                                   │
 *  │    · 采样率：每秒 10~20 次                                       │
 *  │    · 反算公式：R_NTC = R_pull × (V_ntc) / (Vcc - V_ntc)         │
 *  │    · 查表 / Steinhart-Hart → 实时温度                           │
 *  └────────────────────────────────────────────────────────────────────┘
 *
 *  ┌─ 子系统 3：控制回路（MCU + 按键 + 显示）────────────────────────┐
 *  │                                                                    │
 *  │  MCU（如 HT66F004 / STM8S003 / 松翰 SN8P）                       │
 *  │    · 温度采样 → 模糊控制 / PID / 阈值判断                        │
 *  │    · 烹饪阶段状态机（预热 → 沸腾 → 焖饭 → 保温）                 │
 *  │    · I/O 输出：控制继电器线圈 / TRIAC 触发                       │
 *  │    · I/O 输入：按键扫描，开盖检测（磁簧开关）                    │
 *  │    · 输出：LED 数码管 / LCD 显示                                 │
 *  │                                                                    │
 *  │  按键（开始/取消/保温/预约）                                     │
 *  │    · 电阻分压式 ADC 按键 / 独立 I/O                              │
 *  └────────────────────────────────────────────────────────────────────┘
 *
 *  ┌─ 子系统 4：执行部件（继电器 / TRIAC）───────────────────────────┐
 *  │                                                                    │
 *  │  继电器驱动电路：                                                 │
 *  │    · MCU I/O → 三极管（如 8050）→ 继电器线圈（12V / 5V）        │
 *  │    · 续流二极管（1N4148/1N4007）吸收反向电动势                  │
 *  │    · 触点容量：10A 250VAC                                        │
 *  │                                                                    │
 *  │  TRIAC 驱动（选配，调功控温）：                                  │
 *  │    · MCU PWM / 过零触发 → 光耦 MOC3063 → TRIAC（BT136）         │
 *  │    · 加热盘功率 = 额定功率 × 导通占空比                         │
 *  └────────────────────────────────────────────────────────────────────┘
 *
 *  ┌─ 子系统 5：发热与热传递（加热盘 + 内胆）───────────────────────┐
 *  │                                                                    │
 *  │  加热盘（铸铝发热盘）：                                           │
 *  │    · 功率：P_heat = P_rated × dutyCycle                         │
 *  │    · 热惯性较大，升温/降温有滞后                                │
 *  │                                                                    │
 *  │  热传导模型：                                                     │
 *  │    · 加热盘 → 接触传导 → 内胆底部 → 米饭/水                     │
 *  │    · 热容 C_thermal ≈ 150 J/°C                                  │
 *  │    · 热阻 R_thermal ≈ 0.6 °C/W（盘→内胆）                      │
 *  │    · 散热损失：与室温温差成正比，k_cool = 0.02 ~ 0.04           │
 *  └────────────────────────────────────────────────────────────────────┘
 *
 * ══════════════════════════════════════════════════════════════════════
 *  烹饪阶段状态机（传统微电脑电饭煲）
 * ══════════════════════════════════════════════════════════════════════
 *
 *  IDLE  ──[pressCook()]──►  PREHEAT（预热吸水，约 3~5min）
 *         · 功率 100% 全速加热，使米粒温度提升至约 60°C
 *
 *  PREHEAT  ──[T ≥ 65°C]──►  BOIL（煮沸，约 10~15min）
 *         · 功率 100%，快速加热至沸腾
 *
 *  BOIL  ──[T ≥ 98°C && 计时 ≥ 8min]──►  SIMMER（焖饭）
 *         · 功率降至 20~40%，间歇加热，维持微沸
 *         · 水被米粒吸收，温度缓慢下降
 *
 *  SIMMER  ──[温度下降至 ≤ 70°C / 计时结束]──►  DONE（完成）
 *         · 关闭加热，余热焖 5~10min
 *
 *  DONE  ──[自动]──►  WARM（保温）
 *         · 间歇加热（约 5~15% duty），维持 65~75°C
 *         · 继电器周期性通断，防止干烧
 *
 *  任意状态 ──[pressCancel()]──►  IDLE
 *
 * ══════════════════════════════════════════════════════════════════════
 *  温度物理模型
 * ══════════════════════════════════════════════════════════════════════
 *
 *  加热功率：P_eff = P_rated × dutyCycle × η_thermal
 *    η_thermal = 0.88（加热盘→内胆热效率）
 *
 *  温升微分方程：
 *    C × dT/dt = P_eff - (T - T_amb) / R_thermal - k_loss × (T - T_amb)
 *    C = 120 J/°C（有水时等效热容）
 *
 *  沸腾段（T ≥ 98°C，有水）：
 *    温度被相变锁住，水位线性下降
 *    T 维持在 98~102°C 之间
 *    水位蒸发速率：dW/dt = -0.0008 × dutyCycle（仿真值）
 *
 *  保温段 PID 近似：
 *    duty = max(0.03, min(0.18, 0.06 + (target - T) × 0.008))
 *
 *  NTC 温度查表（简化 Steinhart-Hart）：
 *    1/T = 1/T_ref + (1/B) × ln(R/R_ref)
 *
 *  ADC 转换（10bit，0~1023）：
 *    adc_val = (V_ntc / Vcc) × 1023
 *
 * ══════════════════════════════════════════════════════════════════════
 *  绘制分层（从底到顶）
 * ══════════════════════════════════════════════════════════════════════
 *
 *  Layer 0   外壳底座（base）
 *  Layer 1   电源板区域（powerSupply）— 变压器/整流/滤波
 *  Layer 2   控制板区域（controlBoard）— MCU + 按键 + 显示
 *  Layer 3   继电器 / TRIAC（relayTriac）— 执行部件静态
 *  Layer 4   加热盘（heaterPlate）— 静态 + 动态发热光效
 *  Layer 5   内胆 + 米/水（potGroup）— 动态
 *  Layer 6   锅盖 + 蒸汽孔（lid）
 *  Layer 7   NTC + ADC 动态层（ntcDynamic）
 *  Layer 8   继电器开关动态层（relayDynamic）— 触点火花/线圈磁
 *  Layer 9   控制信号动态层（controlDynamic）— MCU I/O 指示
 *  Layer 10  面板显示层（panelDisplay）— 温度/阶段/时间
 *  Layer 11  标注文字
 *
 * ══════════════════════════════════════════════════════════════════════
 *  端口
 * ══════════════════════════════════════════════════════════════════════
 *  ac_l      — 交流火线输入（L，220V）
 *  ac_n      — 交流零线输入（N，220V）
 *  heater_out— 加热盘驱动输出（接继电器触点或 TRIAC）
 *  ntc_out   — NTC 分压输出（模拟电压，接 MCU ADC）
 *  mcu_pwm   — MCU 加热控制输出（PWM 或 ON/OFF 信号）
 *  relay_coil— 继电器线圈驱动输入（可选调试）
 */

// ═══════════════════════════════════════════════════════════════════════
//  阶段枚举
// ═══════════════════════════════════════════════════════════════════════
const MCU_STAGE = {
    IDLE:    'idle',
    PREHEAT: 'preheat',
    BOIL:    'boil',
    SIMMER:  'simmer',
    DONE:    'done',
    WARM:    'warm',
};

// ═══════════════════════════════════════════════════════════════════════
//  微电脑电饭煲主类
// ═══════════════════════════════════════════════════════════════════════
export class MicroRiceCooker extends BaseComponent {

    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(300, config.width  || 360);
        this.height = Math.max(380, config.height || 440);

        this.type    = 'micro_rice_cooker';
        this.special = 'none';
        this.cache   = 'fixed';

        // ── 额定参数 ────────────────────────────────────────────────
        this.label        = config.label        || 'MRC-01';
        this.ratedVoltage = config.ratedVoltage || 220;     // V AC
        this.ratedPower   = config.ratedPower   || 700;     // W
        this.heaterType   = config.heaterType   || 'relay'; // 'relay' 或 'triac'
        this.thermalEff   = config.thermalEff   || 0.88;    // 热效率
        this.warmTarget   = config.warmTarget   || 68;      // °C 保温目标
        this.ambientTemp  = config.ambientTemp  || 25;      // °C

        // ── NTC 参数 ────────────────────────────────────────────────
        this.ntcR25       = config.ntcR25       || 50000;   // Ω，50kΩ@25°C
        this.ntcB         = config.ntcB         || 3950;    // K
        this.ntcPull      = config.ntcPull      || 10000;   // Ω，上拉电阻 10k
        this.vcc          = config.vcc          || 5.0;     // V，MCU 供电（5V 系统）
        this.adcBits      = config.adcBits      || 10;      // ADC 分辨率

        // 仿真加速倍率
        this._simScale    = config.simScale     || 24;

        // ── 物理状态 ────────────────────────────────────────────────
        this._stage       = MCU_STAGE.IDLE;
        this._temperature = this.ambientTemp;      // 内胆底部温度 °C
        this._plateTemp   = this.ambientTemp;      // 加热盘温度 °C
        this._lidTemp     = this.ambientTemp;      // 锅盖温度 °C
        this._waterLevel  = config.waterLevel !== undefined
                            ? Number(config.waterLevel) : 1.0;
        this._cookProg    = 0;                     // 煮饭总进度 0~1
        this._stageTimer  = 0;                     // 当前阶段计时 s
        this._cookCount   = config.initCookCount || 0;

        // ── 功率控制状态 ──────────────────────────────────────────
        this._dutyCycle   = 0;                    // 加热占空比 0~1
        this._heaterOn    = false;                // 加热器当前开关状态
        this._relayOn     = false;                // 继电器吸合状态
        this._triacGate   = false;                // TRIAC 触发信号

        // ── NTC 测温状态 ─────────────────────────────────────────
        this._ntcR        = this._calcNtcR(this._temperature);
        this._ntcV        = this._calcNtcV(this._ntcR);
        this._adcRaw      = Math.round(this._ntcV / this.vcc * ((1 << this.adcBits) - 1));

        // ── 控制信号状态 ─────────────────────────────────────────
        this._mcuPwmOut   = false;                // MCU 加热控制输出
        this._mcuPinState = false;                // MCU 控制引脚电平
        this._relayCoilEn = false;                // 继电器线圈使能

        // ── 温度历史（曲线，60点）─────────────────────────────────
        this._tempHistory = new Array(60).fill(this.ambientTemp);
        this._histTimer   = 0;
        this._powerHistory= new Array(60).fill(0);

        // ── 初始化绘制 ───────────────────────────────────────────
        this._layout = this._calcLayout();
        this._init();

        // ── 端口 ─────────────────────────────────────────────────
        const L = this._layout;
        this.addPort(L.base.x + 10, L.base.y + L.base.h + 4, 'ac_l',      'wire', 'L');
        this.addPort(L.base.x + 28, L.base.y + L.base.h + 4, 'ac_n',      'wire', 'N');
        this.addPort(L.base.x + 56, L.base.y + L.base.h + 4, 'heater_out','wire', 'HEAT');
        this.addPort(L.base.x + 82, L.base.y + L.base.h + 4, 'ntc_out',   'wire', 'NTC');
        this.addPort(L.base.x +108, L.base.y + L.base.h + 4, 'mcu_pwm',   'wire', 'PWM');
        this.addPort(L.base.x +134, L.base.y + L.base.h + 4, 'relay_coil','wire', 'R_COIL');
    }

    // ═══════════════════════════════════════════════════════════════════
    //  布局计算
    // ═══════════════════════════════════════════════════════════════════
    _calcLayout() {
        const W = this.width, H = this.height;
        return {
            // 外壳主体
            housing:     { x: W*0.02, y: H*0.01, w: W*0.96, h: H*0.60, rx: 12 },
            // 锅盖
            lid:         { x: W*0.05, y: H*0.01, w: W*0.90, h: H*0.07, rx: 6  },
            // 内胆
            pot:         { x: W*0.16, y: H*0.07, w: W*0.68, h: H*0.28, rx: 5  },
            // 加热盘（发热盘）
            heaterPlate: { x: W*0.20, y: H*0.35, w: W*0.60, h: H*0.06, rx: 4  },
            // 电源板（变压器/整流/滤波）
            powerSupply: { x: W*0.02, y: H*0.42, w: W*0.38, h: H*0.14, rx: 4  },
            // 继电器 / TRIAC 区域
            relayZone:   { x: W*0.42, y: H*0.42, w: W*0.22, h: H*0.14, rx: 4  },
            // 控制板（MCU）
            ctrlBoard:   { x: W*0.66, y: H*0.42, w: W*0.32, h: H*0.14, rx: 4  },
            // 底座
            base:        { x: W*0.02, y: H*0.58, w: W*0.96, h: H*0.05, rx: 5  },
            // 操作面板
            panel:       { x: W*0.02, y: H*0.63, w: W*0.96, h: H*0.35, rx: 8  },
            // 面板分区
            panelLeft:   { x: W*0.04, y: H*0.65, w: W*0.28, h: H*0.32 },  // 温度 + 进度
            panelMid:    { x: W*0.34, y: H*0.65, w: W*0.30, h: H*0.32 },  // ADC/NTC 数据
            panelRight:  { x: W*0.66, y: H*0.65, w: W*0.30, h: H*0.32 },  // 按键
        };
    }

    // ═══════════════════════════════════════════════════════════════════
    //  初始化绘制
    // ═══════════════════════════════════════════════════════════════════
    _init() {
        this._drawHousing();
        this._drawLid();
        this._drawPot();
        this._drawHeaterStatic();
        this._drawPowerSupply();
        this._drawRelayZone();
        this._drawCtrlBoard();
        this._drawBase();
        this._drawPanel();
        this._drawLabel();

        // 动态层
        this._ntcDynamic   = new Konva.Group(); this.group.add(this._ntcDynamic);
        this._relayDynamic = new Konva.Group(); this.group.add(this._relayDynamic);
        this._controlDynamic = new Konva.Group(); this.group.add(this._controlDynamic);
        this._panelDisplay = new Konva.Group(); this.group.add(this._panelDisplay);
        this._potDynamic   = new Konva.Group(); this.group.add(this._potDynamic);

        this._bindInteraction();
        this._initDynamicContent();
    }

    // ───────────────────────────────────────────────────────────────────
    //  外壳（象牙白/米白，家电风格）
    // ───────────────────────────────────────────────────────────────────
    _drawHousing() {
        const h = this._layout.housing;
        this.group.add(new Konva.Rect({
            x: h.x, y: h.y, width: h.w, height: h.h,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: 0, y: h.h },
            fillLinearGradientColorStops: [
                0, '#f8f6f0', 0.20, '#f0ede5', 0.80, '#e8e4dc', 1, '#ddd8d0',
            ],
            stroke: '#b0a898', strokeWidth: 1.2, cornerRadius: h.rx,
            shadowColor: '#aaa', shadowBlur: 6, shadowOffsetY: 3, shadowOpacity: 0.25,
        }));
        // 装饰腰线
        this.group.add(new Konva.Rect({
            x: h.x, y: h.y+h.h-8, width: h.w, height: 8,
            fill: '#c8b280', cornerRadius: [0,0,h.rx,h.rx],
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    //  锅盖（透明玻璃+不锈钢包边）
    // ───────────────────────────────────────────────────────────────────
    _drawLid() {
        const l = this._layout.lid;
        const W = this.width;
        // 玻璃盖
        this.group.add(new Konva.Rect({
            x: l.x, y: l.y, width: l.w, height: l.h,
            fill: 'rgba(200,210,220,0.45)', stroke: '#c0c0c0', strokeWidth: 1,
            cornerRadius: l.rx, shadowBlur: 2, shadowColor: '#aaa',
        }));
        // 不锈钢包边
        this.group.add(new Konva.Rect({
            x: l.x-2, y: l.y-1, width: l.w+4, height: l.h+2,
            fill: 'none', stroke: '#c8c0b0', strokeWidth: 2, cornerRadius: l.rx+1,
        }));
        // 提手
        this.group.add(new Konva.Rect({
            x: W*0.40, y: l.y-6, width: W*0.20, height: 8,
            fill: '#a09080', stroke: '#807060', strokeWidth: 1, cornerRadius: 3,
        }));
        // 蒸汽孔
        for (let i = 0; i < 3; i++) {
            this.group.add(new Konva.Circle({
                x: W*(0.44 + i*0.06), y: l.y+l.h*0.55, radius: 2.8,
                fill: '#444', stroke: '#666', strokeWidth: 0.6,
            }));
        }
    }

    // ───────────────────────────────────────────────────────────────────
    //  内胆（铝合金+不粘涂层）
    // ───────────────────────────────────────────────────────────────────
    _drawPot() {
        const p = this._layout.pot;
        // 外壁
        this.group.add(new Konva.Rect({
            x: p.x, y: p.y, width: p.w, height: p.h,
            fill: '#606060', stroke: '#808080', strokeWidth: 1,
            cornerRadius: p.rx, shadowBlur: 3, shadowColor: '#555',
        }));
        // 内壁不粘涂层
        this.group.add(new Konva.Rect({
            x: p.x+4, y: p.y+3, width: p.w-8, height: p.h-6,
            fill: '#c8b898', stroke: '#b8a078', strokeWidth: 0.5,
            cornerRadius: p.rx-2,
        }));
        // 水位刻度线
        const marks = [0.25, 0.5, 0.75];
        marks.forEach(m => {
            this.group.add(new Konva.Line({
                points: [p.x+4, p.y+p.h-6 - p.h*m, p.x+18, p.y+p.h-6 - p.h*m],
                stroke: '#a08060', strokeWidth: 0.8, dash: [2,2],
            }));
        });
    }

    // 动态水/饭层
    _rebuildPotDynamic() {
        this._potDynamic.destroyChildren();
        const p  = this._layout.pot;
        const wl = Math.max(0, Math.min(1, this._waterLevel));
        if (wl <= 0) return;

        const innerH = p.h - 10;
        const waterH = innerH * wl;
        const waterY = p.y + p.h - 6 - waterH;

        let c1, c2;
        if (this._cookProg > 0.7) { c1 = '#f0e8c0'; c2 = '#e0d0a0'; }
        else if (this._cookProg > 0.3) { c1 = '#eef0e8'; c2 = '#dde0d0'; }
        else { c1 = '#b8d0e8'; c2 = '#98b8d0'; }

        this._potDynamic.add(new Konva.Rect({
            x: p.x+5, y: waterY, width: p.w-10, height: waterH,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: 0, y: waterH },
            fillLinearGradientColorStops: [0,c1,1,c2],
            cornerRadius: [0,0,p.rx-2,p.rx-2],
        }));

        // 沸腾气泡
        if (this._stage === MCU_STAGE.BOIL && this._temperature >= 95) {
            for (let i = 0; i < 12; i++) {
                this._potDynamic.add(new Konva.Circle({
                    x: p.x+8 + Math.random()*(p.w-16),
                    y: waterY+8 + Math.random()*(waterH-16),
                    radius: 1.5 + Math.random()*2.5,
                    fill: 'rgba(255,255,255,0.6)',
                }));
            }
        }

        // 蒸汽
        if (this._temperature > 60 && this._stage !== MCU_STAGE.IDLE) {
            const alpha = Math.min(0.45, (this._temperature-60)/70);
            const W = this.width;
            [W*0.32, W*0.48, W*0.64].forEach(sx => {
                this._potDynamic.add(new Konva.Line({
                    points: [sx, this._layout.lid.y-2, sx-3, this._layout.lid.y-12, sx, this._layout.lid.y-20],
                    stroke: `rgba(180,220,245,${alpha.toFixed(2)})`,
                    strokeWidth: 3, tension: 0.6, lineCap: 'round',
                }));
            });
        }
    }

    // ───────────────────────────────────────────────────────────────────
    //  加热盘（静态）
    // ───────────────────────────────────────────────────────────────────
    _drawHeaterStatic() {
        const hp = this._layout.heaterPlate;
        // 铸铝盘体
        this.group.add(new Konva.Rect({
            x: hp.x, y: hp.y, width: hp.w, height: hp.h,
            fill: '#a0a0a0', stroke: '#808080', strokeWidth: 1,
            cornerRadius: hp.rx, shadowBlur: 2, shadowColor: '#666',
        }));
        // 加热管（云母发热丝示意）
        for (let i = 0; i < 3; i++) {
            this.group.add(new Konva.Rect({
                x: hp.x+8 + i*25, y: hp.y+4, width: 18, height: hp.h-8,
                fill: '#d05020', stroke: '#b04018', strokeWidth: 0.6,
                cornerRadius: 3,
            }));
        }
        // 温度保险丝示意
        this.group.add(new Konva.Rect({
            x: hp.x+hp.w-18, y: hp.y+2, width: 12, height: hp.h-4,
            fill: '#602020', stroke: '#903030', strokeWidth: 0.5, cornerRadius: 2,
        }));
        this.group.add(new Konva.Text({
            x: hp.x+hp.w-22, y: hp.y+hp.h-10, text: 'TCO', fontSize: 6, fill: '#ff8080',
        }));
    }

    // 加热盘发热光效（动态）
    _updateHeaterGlow() {
        const hp = this._layout.heaterPlate;
        const intensity = this._heaterOn ? this._dutyCycle * 0.8 : 0;
        const alpha = Math.min(0.55, intensity * 0.9);
        if (!this._heaterGlowRect) {
            this._heaterGlowRect = new Konva.Rect({
                x: hp.x+2, y: hp.y-4, width: hp.w-4, height: hp.h+6,
                fill: `rgba(255,100,20,0)`, cornerRadius: hp.rx,
            });
            this.group.add(this._heaterGlowRect);
        }
        this._heaterGlowRect.fill(`rgba(255,100,20,${alpha.toFixed(3)})`);
        this._heaterGlowRect.shadowBlur = intensity > 0.2 ? 12 : 0;
        this._heaterGlowRect.shadowColor = intensity > 0.2 ? '#ff6020' : 'transparent';
    }

    // ───────────────────────────────────────────────────────────────────
    //  电源板（变压器/整流桥/滤波）
    // ───────────────────────────────────────────────────────────────────
    _drawPowerSupply() {
        const ps = this._layout.powerSupply;
        this.group.add(new Konva.Rect({
            x: ps.x, y: ps.y, width: ps.w, height: ps.h,
            fill: '#1a2a1a', stroke: '#2a3a2a', strokeWidth: 1, cornerRadius: ps.rx,
        }));
        this.group.add(new Konva.Text({
            x: ps.x+4, y: ps.y+3, text: '电源板 Power Supply', fontSize: 7.5,
            fill: '#60c060', fontStyle: 'bold',
        }));

        const cy = ps.y + ps.h*0.45;
        // 变压器
        this.group.add(new Konva.Rect({
            x: ps.x+6, y: cy-12, width: 28, height: 24,
            fill: '#302010', stroke: '#604020', strokeWidth: 0.8, cornerRadius: 2,
        }));
        this.group.add(new Konva.Text({ x: ps.x+10, y: cy-6, text: 'T1', fontSize: 8, fill: '#ffcc80' }));
        // 整流桥
        this.group.add(new Konva.Rect({
            x: ps.x+42, y: cy-8, width: 20, height: 16,
            fill: '#202020', stroke: '#404040', strokeWidth: 0.6, cornerRadius: 1,
        }));
        this.group.add(new Konva.Text({ x: ps.x+46, y: cy-4, text: 'DB', fontSize: 7, fill: '#80a0ff' }));
        // 滤波电容
        this.group.add(new Konva.Rect({
            x: ps.x+70, y: cy-12, width: 12, height: 20,
            fill: '#102060', stroke: '#2040a0', strokeWidth: 0.6, cornerRadius: 2,
        }));
        this.group.add(new Konva.Text({ x: ps.x+72, y: cy-6, text: 'C', fontSize: 7, fill: '#8090ff' }));
        // 三端稳压 7805
        this.group.add(new Konva.Rect({
            x: ps.x+ps.w-22, y: cy-6, width: 16, height: 12,
            fill: '#282828', stroke: '#505050', strokeWidth: 0.5,
        }));
        this.group.add(new Konva.Text({ x: ps.x+ps.w-20, y: cy-4, text: '7805', fontSize: 6, fill: '#a0c0a0' }));

        // 输出线 +5V / GND
        this.group.add(new Konva.Line({
            points: [ps.x+ps.w-6, cy, ps.x+ps.w+8, cy],
            stroke: '#ff4040', strokeWidth: 1,
        }));
        this.group.add(new Konva.Text({ x: ps.x+ps.w-2, y: cy-6, text: '+5V', fontSize: 6, fill: '#ff8080' }));
    }

    // ───────────────────────────────────────────────────────────────────
    //  继电器 / TRIAC 区域
    // ───────────────────────────────────────────────────────────────────
    _drawRelayZone() {
        const rz = this._layout.relayZone;
        this.group.add(new Konva.Rect({
            x: rz.x, y: rz.y, width: rz.w, height: rz.h,
            fill: '#1a1a2a', stroke: '#2a2a3a', strokeWidth: 1, cornerRadius: rz.rx,
        }));
        this.group.add(new Konva.Text({
            x: rz.x+4, y: rz.y+3, text: '执行部件', fontSize: 7.5,
            fill: '#ffaa60', fontStyle: 'bold',
        }));

        const cx = rz.x + rz.w/2;
        const cy = rz.y + rz.h*0.5;

        // 继电器主体
        this._relayRect = new Konva.Rect({
            x: cx-20, y: cy-12, width: 40, height: 24,
            fill: '#303030', stroke: '#606060', strokeWidth: 0.8, cornerRadius: 3,
        });
        this.group.add(this._relayRect);
        this.group.add(new Konva.Text({ x: cx-8, y: cy-6, text: 'RELAY', fontSize: 7, fill: '#ffcc80' }));
        // 线圈引脚
        this.group.add(new Konva.Line({
            points: [cx-16, cy+12, cx-16, cy+20, cx-12, cy+20],
            stroke: '#c0c0c0', strokeWidth: 1.5,
        }));
        this.group.add(new Konva.Line({
            points: [cx+16, cy+12, cx+16, cy+20, cx+12, cy+20],
            stroke: '#c0c0c0', strokeWidth: 1.5,
        }));
        // 触点端子
        this.group.add(new Konva.Line({
            points: [cx-8, cy-12, cx-8, cy-20, cx-4, cy-20],
            stroke: '#d0a060', strokeWidth: 1.5,
        }));
        this.group.add(new Konva.Line({
            points: [cx+8, cy-12, cx+8, cy-20, cx+4, cy-20],
            stroke: '#d0a060', strokeWidth: 1.5,
        }));

        // 续流二极管
        this.group.add(new Konva.Rect({
            x: cx-30, y: cy, width: 8, height: 6,
            fill: '#402020', stroke: '#802020', strokeWidth: 0.6,
        }));
        this.group.add(new Konva.Text({ x: cx-34, y: cy-1, text: 'D', fontSize: 6, fill: '#ff8080' }));

        // TRIAC 示意（选配）
        if (this.heaterType === 'triac') {
            this.group.add(new Konva.Rect({
                x: cx+24, y: cy-6, width: 12, height: 12,
                fill: '#1a1a3a', stroke: '#4040a0', strokeWidth: 0.8,
            }));
            this.group.add(new Konva.Text({ x: cx+25, y: cy-4, text: 'TR', fontSize: 6, fill: '#80a0ff' }));
        }
    }

    // 继电器动态层（触点火花、吸合指示）
    _rebuildRelayDynamic() {
        this._relayDynamic.destroyChildren();
        const rz = this._layout.relayZone;
        const cx = rz.x + rz.w/2;
        const cy = rz.y + rz.h*0.5;

        const on = this._relayOn;
        // 吸合时触点火花效果
        if (on) {
            this._relayDynamic.add(new Konva.Circle({
                x: cx-3, y: cy-8, radius: 4,
                fill: '#ff8020', shadowBlur: 8, shadowColor: '#ff6020',
                opacity: 0.7 + Math.random()*0.3,
            }));
            this._relayDynamic.add(new Konva.Circle({
                x: cx+3, y: cy-8, radius: 3,
                fill: '#ffa040', shadowBlur: 6, shadowColor: '#ff8040',
                opacity: 0.6,
            }));
        }
        // 线圈磁场线
        if (this._relayCoilEn) {
            for (let i = 0; i < 3; i++) {
                this._relayDynamic.add(new Konva.Ellipse({
                    x: cx-4, y: cy+2, radiusX: 8, radiusY: 4,
                    fill: 'none', stroke: `rgba(100,150,255,${0.3+Math.sin(Date.now()*0.01+i)*0.2})`,
                    strokeWidth: 0.8, rotation: i*30,
                }));
            }
        }

        // 状态文字
        this._relayDynamic.add(new Konva.Text({
            x: cx-12, y: cy+16, text: on ? '吸合' : '断开',
            fontSize: 7, fill: on ? '#ff8030' : '#808080', fontFamily: 'monospace',
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    //  控制板（MCU + 按键 + 显示驱动）
    // ───────────────────────────────────────────────────────────────────
    _drawCtrlBoard() {
        const cb = this._layout.ctrlBoard;
        this.group.add(new Konva.Rect({
            x: cb.x, y: cb.y, width: cb.w, height: cb.h,
            fill: '#0a1a2a', stroke: '#1a2a3a', strokeWidth: 1, cornerRadius: cb.rx,
        }));
        this.group.add(new Konva.Text({
            x: cb.x+4, y: cb.y+3, text: '控制板 MCU', fontSize: 7.5,
            fill: '#60a0ff', fontStyle: 'bold',
        }));

        const cy = cb.y + cb.h*0.45;

        // MCU 芯片
        this.group.add(new Konva.Rect({
            x: cb.x+6, y: cy-12, width: 30, height: 24,
            fill: '#202020', stroke: '#404040', strokeWidth: 0.8, cornerRadius: 1,
        }));
        this.group.add(new Konva.Text({ x: cb.x+10, y: cy-6, text: 'MCU', fontSize: 9, fill: '#60ff60', fontStyle: 'bold' }));
        // 引脚示意
        for (let i = 0; i < 4; i++) {
            this.group.add(new Konva.Rect({ x: cb.x+4, y: cy-8+i*5, width: 2, height: 3, fill: '#a0a0a0' }));
            this.group.add(new Konva.Rect({ x: cb.x+36, y: cy-8+i*5, width: 2, height: 3, fill: '#a0a0a0' }));
        }

        // ADC 输入标注
        this.group.add(new Konva.Line({
            points: [cb.x+36, cy-4, cb.x+48, cy-4],
            stroke: '#40ff40', strokeWidth: 0.8, dash: [2,2],
        }));
        this.group.add(new Konva.Text({ x: cb.x+38, y: cy-9, text: 'ADC_IN', fontSize: 6, fill: '#40ff40' }));

        // 加热控制输出（PWM/ON-OFF）
        this.group.add(new Konva.Line({
            points: [cb.x+36, cy+2, cb.x+48, cy+2],
            stroke: '#ffaa40', strokeWidth: 0.8, dash: [2,2],
        }));
        this.group.add(new Konva.Text({ x: cb.x+38, y: cy-1, text: 'HEAT_CTRL', fontSize: 6, fill: '#ffaa40' }));

        // 晶振
        this.group.add(new Konva.Rect({
            x: cb.x+cb.w-20, y: cy-3, width: 14, height: 8,
            fill: '#303030', stroke: '#606060', strokeWidth: 0.5, cornerRadius: 1,
        }));
        this.group.add(new Konva.Text({ x: cb.x+cb.w-18, y: cy-1, text: '4MHz', fontSize: 6, fill: '#a0a0a0' }));
    }

    // MCU 动态层（状态指示、PWM 闪烁）
    _rebuildControlDynamic() {
        this._controlDynamic.destroyChildren();
        const cb = this._layout.ctrlBoard;
        const mcuX = cb.x + 6, mcuY = cb.y + cb.h*0.45 - 12;

        // MCU 运行指示 LED
        const ledOn = this._stage !== MCU_STAGE.IDLE;
        this._controlDynamic.add(new Konva.Circle({
            x: mcuX+24, y: mcuY-4, radius: 2.5,
            fill: ledOn ? '#00ff40' : '#204020',
            shadowBlur: ledOn ? 6 : 0, shadowColor: '#00ff40',
        }));

        // 加热控制引脚电平闪烁（PWM 示意）
        if (this._mcuPwmOut || this._heaterOn) {
            const blink = (Date.now() % 200) < 100;
            this._controlDynamic.add(new Konva.Rect({
                x: mcuX+30, y: mcuY+8, width: 6, height: 4,
                fill: blink ? '#ffaa40' : '#402000',
                cornerRadius: 1,
            }));
            this._controlDynamic.add(new Konva.Text({
                x: mcuX+24, y: mcuY+14, text: 'PWM_OUT', fontSize: 6, fill: '#ffaa40',
            }));
        }

        // 控制信号占空比文字
        this._controlDynamic.add(new Konva.Text({
            x: cb.x+4, y: cb.y+cb.h-12,
            text: `Duty:${(this._dutyCycle*100).toFixed(0)}%  ${this.heaterType==='relay'?'RELAY':'TRIAC'}`,
            fontSize: 7, fill: '#80c0ff', fontFamily: 'monospace',
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    //  底座
    // ───────────────────────────────────────────────────────────────────
    _drawBase() {
        const b = this._layout.base;
        this.group.add(new Konva.Rect({
            x: b.x, y: b.y, width: b.w, height: b.h,
            fill: '#282828', stroke: '#404040', strokeWidth: 1, cornerRadius: b.rx,
            shadowBlur: 4, shadowOffsetY: 2, shadowColor: '#333', shadowOpacity: 0.4,
        }));
        for (let i = 0; i < 4; i++) {
            this.group.add(new Konva.Rect({
                x: b.x+b.w*(0.08+i*0.28)-8, y: b.y+b.h-4,
                width: 16, height: 5, fill: '#181818', cornerRadius: 2,
            }));
        }
    }

    // ───────────────────────────────────────────────────────────────────
    //  操作面板（三栏）
    // ───────────────────────────────────────────────────────────────────
    _drawPanel() {
        const pn = this._layout.panel;
        this.group.add(new Konva.Rect({
            x: pn.x, y: pn.y, width: pn.w, height: pn.h,
            fill: '#181c28', stroke: '#283040', strokeWidth: 1, cornerRadius: pn.rx,
        }));

        const L = this._layout;
        [L.panelMid.x, L.panelRight.x].forEach(dx => {
            this.group.add(new Konva.Line({
                points: [dx, pn.y+6, dx, pn.y+pn.h-6],
                stroke: '#2a2a3a', strokeWidth: 0.8, dash: [2,3],
            }));
        });

        this._drawPanelLeft();
        this._drawPanelMid();
        this._drawPanelRight();
    }

    // 左栏：温度 + 进度
    _drawPanelLeft() {
        const pl = this._layout.panelLeft;

        this._tempNumText = new Konva.Text({
            x: pl.x, y: pl.y+4, width: pl.w,
            text: `${Math.round(this._temperature)}°`,
            fontSize: 32, fontStyle: 'bold', fontFamily: 'monospace',
            fill: '#4090e0', align: 'center',
        });
        this._panelDisplay.add(this._tempNumText);

        this._stageText = new Konva.Text({
            x: pl.x, y: pl.y+44, width: pl.w,
            text: '待机', fontSize: 11, fill: '#60a0e0', align: 'center',
        });
        this._panelDisplay.add(this._stageText);

        // 进度条
        this._progBg = new Konva.Rect({
            x: pl.x+8, y: pl.y+62, width: pl.w-16, height: 6,
            fill: '#2a2a3a', cornerRadius: 3,
        });
        this._progBar = new Konva.Rect({
            x: pl.x+8, y: pl.y+62, width: 0, height: 6,
            fill: '#4090e0', cornerRadius: 3,
        });
        this._panelDisplay.add(this._progBg, this._progBar);

        // 水位条
        this._waterBarBg = new Konva.Rect({
            x: pl.x+8, y: pl.y+74, width: pl.w-16, height: 4,
            fill: '#2a2a3a', cornerRadius: 2,
        });
        this._waterBar = new Konva.Rect({
            x: pl.x+8, y: pl.y+74, width: 0, height: 4,
            fill: '#3090d0', cornerRadius: 2,
        });
        this._panelDisplay.add(this._waterBarBg, this._waterBar);
    }

    // 中栏：ADC / NTC 实时数据
    _drawPanelMid() {
        this._ntcDataText = new Konva.Text({
            x: this._layout.panelMid.x+6, y: this._layout.panelMid.y+8,
            text: 'NTC 数据\nR: ----Ω\nV: --.- V\nADC: ----\nT: --.- °C',
            fontSize: 8.5, fill: '#80c0e0', lineHeight: 1.5, fontFamily: 'monospace',
        });
        this._panelDisplay.add(this._ntcDataText);
    }

    // 右栏：按键
    _drawPanelRight() {
        const pr = this._layout.panelRight;
        const bw = pr.w*0.70, bh = pr.h*0.24;
        const bx = pr.x + (pr.w - bw)/2, by = pr.y + 8;

        // 开始/煮饭键
        this._cookBtn = new Konva.Rect({
            x: bx, y: by, width: bw, height: bh,
            fill: '#2a4a6a', stroke: '#4090c0', strokeWidth: 1, cornerRadius: 6,
        });
        this._cookBtnLabel = new Konva.Text({
            x: bx, y: by+bh*0.28, width: bw,
            text: '煮饭', fontSize: 11, fill: '#c0e0ff', align: 'center', fontStyle: 'bold',
        });
        this._panelDisplay.add(this._cookBtn, this._cookBtnLabel);

        // 取消键
        const cby = by + bh + 6;
        this._cancelBtn = new Konva.Rect({
            x: bx, y: cby, width: bw, height: bh*0.8,
            fill: '#4a2a2a', stroke: '#903030', strokeWidth: 1, cornerRadius: 5,
        });
        this._cancelBtnLabel = new Konva.Text({
            x: bx, y: cby+bh*0.22, width: bw,
            text: '取消', fontSize: 10, fill: '#ffa0a0', align: 'center',
        });
        this._panelDisplay.add(this._cancelBtn, this._cancelBtnLabel);

        // 阶段指示
        const stages = [
            { stage: MCU_STAGE.PREHEAT, label: '预热', yoff: 0 },
            { stage: MCU_STAGE.BOIL,    label: '煮沸', yoff: 14 },
            { stage: MCU_STAGE.SIMMER,  label: '焖饭', yoff: 28 },
            { stage: MCU_STAGE.WARM,    label: '保温', yoff: 42 },
        ];
        this._stageIndicators = {};
        stages.forEach(s => {
            const ly = pr.y + pr.h*0.58 + s.yoff;
            const dot = new Konva.Circle({
                x: pr.x+10, y: ly, radius: 3.5,
                fill: '#283040', stroke: '#405060', strokeWidth: 0.6,
            });
            const lbl = new Konva.Text({
                x: pr.x+20, y: ly-5, text: s.label,
                fontSize: 8.5, fill: '#7080a0',
            });
            this._panelDisplay.add(dot, lbl);
            this._stageIndicators[s.stage] = { dot, lbl, color: '#60c0ff' };
        });
    }

    _updatePanelDisplay() {
        if (!this._tempNumText) return;

        this._tempNumText.text(`${Math.round(this._temperature)}°`);
        const stageMap = {
            [MCU_STAGE.IDLE]: '待机', [MCU_STAGE.PREHEAT]: '预热中',
            [MCU_STAGE.BOIL]: '煮沸', [MCU_STAGE.SIMMER]: '焖饭中',
            [MCU_STAGE.DONE]: '完成', [MCU_STAGE.WARM]: '保温',
        };
        this._stageText.text(stageMap[this._stage] || '─');
        if (this._progBar) this._progBar.width(Math.max(0, (this._layout.panelLeft.w-16) * this._cookProg));
        if (this._waterBar) this._waterBar.width(Math.max(0, (this._layout.panelLeft.w-16) * this._waterLevel));

        // NTC 数据
        if (this._ntcDataText) {
            this._ntcDataText.text(
                `NTC 数据\nR: ${Math.round(this._ntcR).toLocaleString()}Ω\n` +
                `V: ${this._ntcV.toFixed(2)} V\nADC: ${this._adcRaw}\nT: ${this._temperature.toFixed(1)}°C`
            );
        }

        // 阶段指示灯
        if (this._stageIndicators) {
            Object.entries(this._stageIndicators).forEach(([st, obj]) => {
                const active = st === this._stage;
                obj.dot.fill(active ? obj.color : '#283040');
                obj.dot.shadowBlur(active ? 6 : 0);
                obj.dot.shadowColor(active ? obj.color : 'transparent');
                obj.lbl.fill(active ? obj.color : '#7080a0');
            });
        }
    }

    // ───────────────────────────────────────────────────────────────────
    //  NTC 动态层（贴片位置 + 电压探头）
    // ───────────────────────────────────────────────────────────────────
    _rebuildNtcDynamic() {
        this._ntcDynamic.destroyChildren();
        const p = this._layout.pot;
        const ntcX = p.x + p.w - 12;
        const ntcY = p.y + p.h - 6;

        const temp = this._temperature;
        const ntcColor = temp > 100 ? '#ff3020' : temp > 70 ? '#ff8020' : temp > 50 ? '#e0b020' : '#4090e0';

        // NTC 传感头
        this._ntcDynamic.add(new Konva.Rect({
            x: ntcX-5, y: ntcY-4, width: 10, height: 8,
            fill: ntcColor, stroke: '#888', strokeWidth: 0.6, cornerRadius: 1.5,
            shadowBlur: 6, shadowColor: ntcColor,
        }));
        this._ntcDynamic.add(new Konva.Text({
            x: ntcX-10, y: ntcY-14, text: 'NTC', fontSize: 7, fill: ntcColor,
        }));

        // 分压电路示意
        const cb = this._layout.ctrlBoard;
        this._ntcDynamic.add(new Konva.Line({
            points: [ntcX, ntcY, ntcX+8, ntcY+12, cb.x+cb.w*0.25, cb.y+cb.h*0.45],
            stroke: '#40c040', strokeWidth: 1, dash: [3,2],
        }));

        // 实时测量气泡
        this._ntcDynamic.add(new Konva.Rect({
            x: ntcX+4, y: ntcY-20, width: 58, height: 16,
            fill: 'rgba(0,20,0,0.75)', stroke: '#306030', strokeWidth: 0.6, cornerRadius: 2,
        }));
        this._ntcDynamic.add(new Konva.Text({
            x: ntcX+6, y: ntcY-17,
            text: `${(this._ntcR/1000).toFixed(1)}kΩ ${this._ntcV.toFixed(2)}V`,
            fontSize: 7, fill: '#60ff60', fontFamily: 'monospace',
        }));
    }

    // ═══════════════════════════════════════════════════════════════════
    //  交互绑定
    // ═══════════════════════════════════════════════════════════════════
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

    _initDynamicContent() {
        this._rebuildPotDynamic();
        this._rebuildNtcDynamic();
        this._rebuildRelayDynamic();
        this._rebuildControlDynamic();
        this._updateHeaterGlow();
        this._updatePanelDisplay();
    }

    // ═══════════════════════════════════════════════════════════════════
    //  Tick — 由 consys._tickAll 在 20fps 调用
    // ═══════════════════════════════════════════════════════════════════
    tick(dt) {
        this._tickStageLogic(dt);
        this._tickPhysics(dt);
        this._tickControlSignals(dt);
        this._tickNtc();
        this._tickHistory(dt);
        this._rebuildDynamicLayers();
        this._updatePanelDisplay();
        this._refreshCache();
    }

    // 阶段状态机
    _tickStageLogic(dt) {
        if (this._stage === MCU_STAGE.IDLE) return;

        const sdt = dt * this._simScale;
        this._stageTimer += sdt;

        switch (this._stage) {
            case MCU_STAGE.PREHEAT:
                this._dutyCycle = 1.0;
                if (this._temperature >= 68) {
                    this._stage = MCU_STAGE.BOIL;
                    this._stageTimer = 0;
                    this.emit?.('stageChange', { stage: MCU_STAGE.BOIL });
                }
                break;

            case MCU_STAGE.BOIL:
                this._dutyCycle = 1.0;
                if (this._temperature >= 98 && this._stageTimer > 8) {
                    this._stage = MCU_STAGE.SIMMER;
                    this._stageTimer = 0;
                    this.emit?.('stageChange', { stage: MCU_STAGE.SIMMER });
                }
                break;

            case MCU_STAGE.SIMMER:
                this._dutyCycle = Math.max(0.15, Math.min(0.45, 0.30 + (100 - this._temperature) * 0.02));
                if (this._waterLevel < 0.05 || this._stageTimer > 40) {
                    this._stage = MCU_STAGE.DONE;
                    this._stageTimer = 0;
                    this._dutyCycle = 0;
                    this.emit?.('stageChange', { stage: MCU_STAGE.DONE });
                }
                break;

            case MCU_STAGE.DONE:
                this._dutyCycle = 0;
                if (this._stageTimer > 15) {
                    this._stage = MCU_STAGE.WARM;
                    this._stageTimer = 0;
                    this.emit?.('stageChange', { stage: MCU_STAGE.WARM });
                }
                break;

            case MCU_STAGE.WARM:
                const err = this.warmTarget - this._temperature;
                this._dutyCycle = Math.max(0.04, Math.min(0.18, 0.07 + err * 0.007));
                break;
        }
    }

    // 物理模型：加热盘 + 内胆热传递
    _tickPhysics(dt) {
        const sdt = dt * this._simScale;
        const Ta = this.ambientTemp;

        if (this._stage === MCU_STAGE.IDLE) {
            this._temperature = Math.max(Ta, this._temperature - 0.008 * (this._temperature - Ta) * sdt);
            this._plateTemp = Math.max(Ta, this._plateTemp - 0.012 * (this._plateTemp - Ta) * sdt);
            this._dcBusVolt = 0;
            return;
        }

        // 加热功率
        const P_heat = this.ratedPower * this._dutyCycle;
        const P_eff = P_heat * this.thermalEff;

        // 加热盘热容 C_plate ≈ 80 J/°C
        const C_plate = 80;
        const dT_plate = (P_heat * 0.92 - 0.018 * (this._plateTemp - Ta)) * sdt / C_plate;
        this._plateTemp = Math.max(Ta, this._plateTemp + dT_plate);

        // 内胆热传递（接触传导）
        const heatToPot = (this._plateTemp - this._temperature) * 0.85;
        const hasWater = this._waterLevel > 0.02;
        let dT_pot;

        if (this._stage === MCU_STAGE.BOIL && hasWater && this._temperature >= 98) {
            // 沸腾相变锁温
            dT_pot = (P_eff * 0.00004 + heatToPot * 0.12) * sdt;
            this._waterLevel = Math.max(0, this._waterLevel - 0.0008 * sdt);
            this._temperature = Math.min(102, this._temperature + dT_pot);
        } else {
            const C_pot = hasWater ? 130 : 60;
            dT_pot = (P_eff * 0.00065 + heatToPot * 0.12 - 0.012 * (this._temperature - Ta)) * sdt / (C_pot / 30);
            this._temperature += dT_pot;
            if (this._stage === MCU_STAGE.SIMMER && hasWater) {
                this._waterLevel = Math.max(0, this._waterLevel - 0.0005 * sdt);
            }
        }

        this._temperature = Math.max(Ta, this._temperature);
        this._cookProg = Math.min(1, this._cookProg + sdt * 0.0035);

        // 锅盖温度
        const lidTarget = Math.min(this._temperature * 0.88, this._temperature - 10);
        this._lidTemp += (lidTarget - this._lidTemp) * 0.06 * sdt;
    }

    // 控制信号：继电器/TRIAC 驱动
    _tickControlSignals(dt) {
        const targetOn = this._dutyCycle > 0.01 && this._stage !== MCU_STAGE.IDLE;

        if (this.heaterType === 'relay') {
            // 继电器不能高频开关，模拟最小 ON/OFF 时间
            if (!this._relayTimer) this._relayTimer = 0;
            this._relayTimer += dt;
            const period = 2.0;  // 2秒控制周期
            const onTime = period * this._dutyCycle;
            const state = this._relayTimer % period < onTime;
            this._heaterOn = state && targetOn;
            this._relayOn = this._heaterOn;
            this._relayCoilEn = this._heaterOn;
            this._mcuPwmOut = this._heaterOn;
        } else {
            // TRIAC 模式，快速 PWM
            this._heaterOn = targetOn && (Math.random() < this._dutyCycle);
            this._triacGate = this._heaterOn;
            this._relayOn = false;
            this._mcuPwmOut = this._heaterOn;
        }

        // MCU 引脚输出电平
        this._mcuPinState = this._heaterOn;
    }

    // NTC 温度换算
    _tickNtc() {
        this._ntcR = this._calcNtcR(this._temperature);
        this._ntcV = this._calcNtcV(this._ntcR);
        const maxAdc = (1 << this.adcBits) - 1;
        this._adcRaw = Math.round(this._ntcV / this.vcc * maxAdc);
    }

    _calcNtcR(tempC) {
        const T_ref = 298.15;
        const T = tempC + 273.15;
        return this.ntcR25 * Math.exp(this.ntcB * (1/T - 1/T_ref));
    }

    _calcNtcV(rNtc) {
        return this.vcc * rNtc / (this.ntcPull + rNtc);
    }

    _tickHistory(dt) {
        this._histTimer += dt;
        if (this._histTimer >= 0.6) {
            this._histTimer = 0;
            this._tempHistory.shift();
            this._tempHistory.push(this._temperature);
            this._powerHistory.shift();
            this._powerHistory.push(this._dutyCycle);
        }
    }

    _rebuildDynamicLayers() {
        this._rebuildPotDynamic();
        this._rebuildNtcDynamic();
        this._rebuildRelayDynamic();
        this._rebuildControlDynamic();
        this._updateHeaterGlow();
    }

    // ── 辅助绘制 ─────────────────────────────────────────────────────
    _drawLabel() {
        this.group.add(new Konva.Text({
            x: 0, y: -16, width: this.width,
            text: `${this.label}  微电脑电饭煲  ${this.ratedVoltage}V / ${this.ratedPower}W  ${this.heaterType.toUpperCase()}`,
            fontSize: 9, fontStyle: 'bold', fill: '#5a6a7a', align: 'center',
        }));
    }

    // ═══════════════════════════════════════════════════════════════════
    //  外部操作接口
    // ═══════════════════════════════════════════════════════════════════
    pressCook() {
        if (this._stage !== MCU_STAGE.IDLE && this._stage !== MCU_STAGE.WARM) return;
        this._waterLevel = 1.0;
        this._cookProg = 0;
        this._stageTimer = 0;
        this._stage = MCU_STAGE.PREHEAT;
        this._cookCount++;
        this.emit?.('stageChange', { stage: MCU_STAGE.PREHEAT });
        this._refreshCache();
    }

    pressCancel() {
        if (this._stage === MCU_STAGE.IDLE) return;
        this._stage = MCU_STAGE.IDLE;
        this._dutyCycle = 0;
        this._heaterOn = false;
        this._relayOn = false;
        this._stageTimer = 0;
        this.emit?.('stageChange', { stage: MCU_STAGE.IDLE });
        this._refreshCache();
    }

    // 查询接口
    getStage() { return this._stage; }
    getTemperature() { return this._temperature; }
    getLidTemperature() { return this._lidTemp; }
    getWaterLevel() { return this._waterLevel; }
    getCookProgress() { return this._cookProg; }
    getDutyCycle() { return this._dutyCycle; }
    getHeaterOn() { return this._heaterOn; }
    getNtcResistance() { return this._ntcR; }
    getNtcVoltage() { return this._ntcV; }
    getAdcRaw() { return this._adcRaw; }
    isIdle() { return this._stage === MCU_STAGE.IDLE; }

    refillWater(level = 1.0) {
        this._waterLevel = Math.min(1, Math.max(0, level));
        this._refreshCache();
    }

    // ═══════════════════════════════════════════════════════════════════
    //  配置字段
    // ═══════════════════════════════════════════════════════════════════
    getConfigFields() {
        return [
            { label: '位号/名称',           key: 'label',        type: 'text'   },
            { label: '额定电压 (V)',         key: 'ratedVoltage', type: 'number' },
            { label: '额定功率 (W)',         key: 'ratedPower',   type: 'number' },
            { label: '加热类型 (relay/triac)', key: 'heaterType', type: 'select', options: ['relay','triac'] },
            { label: '热效率 (0~1)',         key: 'thermalEff',   type: 'number' },
            { label: '保温目标 (°C)',        key: 'warmTarget',   type: 'number' },
            { label: 'NTC R25 (Ω)',          key: 'ntcR25',       type: 'number' },
            { label: 'NTC B 值 (K)',         key: 'ntcB',         type: 'number' },
            { label: 'NTC 上拉 (Ω)',         key: 'ntcPull',      type: 'number' },
            { label: 'MCU Vcc (V)',          key: 'vcc',          type: 'number' },
            { label: 'ADC 分辨率 (bit)',     key: 'adcBits',      type: 'number' },
            { label: '仿真加速倍率',         key: 'simScale',     type: 'number' },
            { label: '初始水量 (0~1)',       key: 'waterLevel',   type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label)        this.label        = cfg.label;
        if (cfg.ratedPower)   this.ratedPower   = parseFloat(cfg.ratedPower)   || this.ratedPower;
        if (cfg.heaterType)   this.heaterType   = cfg.heaterType;
        if (cfg.thermalEff)   this.thermalEff   = parseFloat(cfg.thermalEff)   || this.thermalEff;
        if (cfg.warmTarget)   this.warmTarget   = parseFloat(cfg.warmTarget)   || this.warmTarget;
        if (cfg.ntcR25)       this.ntcR25       = parseFloat(cfg.ntcR25)       || this.ntcR25;
        if (cfg.ntcB)         this.ntcB         = parseFloat(cfg.ntcB)         || this.ntcB;
        if (cfg.ntcPull)      this.ntcPull      = parseFloat(cfg.ntcPull)      || this.ntcPull;
        if (cfg.vcc)          this.vcc          = parseFloat(cfg.vcc)          || this.vcc;
        if (cfg.adcBits)      this.adcBits      = parseInt(cfg.adcBits)        || this.adcBits;
        if (cfg.simScale)     this._simScale    = parseFloat(cfg.simScale)     || this._simScale;
        if (cfg.waterLevel !== undefined) this.refillWater(parseFloat(cfg.waterLevel));
        this.config = { ...this.config, ...cfg };
        this._refreshCache();
    }

    destroy() {
        super.destroy?.();
    }
}