import { BaseComponent } from './BaseComponent.js';

/**
 * 家用燃气热水器仿真组件
 * （Domestic Gas Water Heater — Auto-Ignition Type）
 *
 * ══════════════════════════════════════════════════════════════════════
 *  整机工作流程（开启热水阀 → 自动点火 → 燃烧加热 全过程）
 * ══════════════════════════════════════════════════════════════════════
 *
 *  步骤 ① — 检测水流（水流传感器触发）
 *    用户打开热水龙头
 *    → 冷水进水管压力驱动水流通过热交换器
 *    → 水流传感器（霍尔式叶轮）转速超过阈值（约 2 L/min）
 *    → 输出脉冲信号给控制板 MCU
 *
 *  步骤 ② — 燃气阀开启（电磁阀通电）
 *    MCU 收到水流信号后约 100ms
 *    → 驱动主燃气电磁阀（Solenoid Valve，DC 12V/1A）通电开启
 *    → 燃气（天然气 CH₄ 或液化气 C₃H₈）从燃气管路进入燃烧室
 *    → 同时开启引燃用小火电磁阀（部分型号，先开小火）
 *
 *  步骤 ③ — 脉冲点火（压电陶瓷 / 电子变压器）
 *    MCU 同步触发点火模块
 *    → 点火变压器升压至 8,000～15,000V 高压脉冲
 *    → 点火电极（Ignition Electrode）与接地极之间产生电火花
 *    → 火花间距约 3～5mm，放电频率约 3～8Hz
 *    → 点火脉冲持续约 3～8 秒，直到火焰传感器确认点火成功
 *
 *  步骤 ④ — 火焰确认（离子火焰传感器）
 *    点火电极附近另有火焰传感器（Ion Sensor / Thermocouple）
 *    → 离子感应原理：火焰等离子体导通 AC 电路，产生整流电流（约 0.5～3μA）
 *    → MCU ADC 检测到确认信号
 *    → 停止点火脉冲，维持主燃气阀开启
 *    → 若 8 秒内未检测到火焰 → 关闭燃气阀（安全保护）→ 报警
 *
 *  步骤 ⑤ — 燃烧加热
 *    燃气在燃烧室（Burner）充分燃烧（完全燃烧产物：CO₂ + H₂O）
 *    → 高温烟气（约 900℃）流过热交换器铜管翅片
 *    → 冷水在铜管内流动，与烟气换热
 *    → 出水温度由比例调节阀（Modulating Gas Valve）控制
 *    → 比例调节范围：最小火力约 10% ~ 最大火力 100%（防过热）
 *
 *  步骤 ⑥ — 温度控制（PID 调节）
 *    NTC 热敏电阻贴于出水铜管
 *    → MCU 采样出水温度（目标温度由面板设置，通常 38～55℃）
 *    → PID 算法调节比例燃气阀开度（PWM 驱动步进电机或比例阀）
 *    → 进水温度（另一 NTC）同步补偿
 *
 *  步骤 ⑦ — 关闭热水阀 → 熄火
 *    用户关闭龙头
 *    → 水流传感器脉冲停止
 *    → MCU 约 50ms 后关闭主燃气电磁阀
 *    → 燃气断供，火焰熄灭
 *    → 离子传感器确认熄火，系统回到待机状态
 *
 * ══════════════════════════════════════════════════════════════════════
 *  关键部件结构
 * ══════════════════════════════════════════════════════════════════════
 *
 *  ┌── 进水管（Cold Water Inlet）
 *  │   └── 水流传感器（Flow Sensor，霍尔叶轮）
 *  │       检测流量 > 2L/min 即触发点火序列
 *  │
 *  ├── 燃气管路（Gas Supply）
 *  │   ├── 燃气电磁阀（Main Solenoid Valve，常闭型）
 *  │   │   断电关闭（Fail-Safe），通电开启
 *  │   ├── 比例调节阀（Modulating Valve）
 *  │   │   控制燃气流量 → 控制火力大小
 *  │   └── 过压保护阀（过压自动关闭）
 *  │
 *  ├── 点火系统（Ignition System）
 *  │   ├── 点火变压器（Ignition Transformer，升压 220V→10kV）
 *  │   ├── 点火电极（Spark Electrode，W 合金，耐高温）
 *  │   └── 离子火焰传感器（Ion Sensor，与点火电极共用或独立）
 *  │
 *  ├── 燃烧室（Combustion Chamber）
 *  │   ├── 主燃烧器（Burner，预混式或大气式）
 *  │   └── 观察窗（部分型号，可见火焰颜色）
 *  │
 *  ├── 热交换器（Heat Exchanger）
 *  │   ├── 铜管翅片（Copper Fin-Tube）
 *  │   ├── 进水 NTC（T_cold 采样）
 *  │   └── 出水 NTC（T_hot 采样，PID 反馈）
 *  │
 *  ├── 烟道（Flue / Exhaust）
 *  │   ├── 强制排烟风机（Exhaust Fan，平衡式/强排式）
 *  │   └── 烟温传感器（防过热保护）
 *  │
 *  └── 控制板（MCU Control Board）
 *      ├── 水流信号输入 → 点火逻辑
 *      ├── 火焰确认输入 → 安全保护
 *      ├── NTC 温度采样 → PID 调节
 *      ├── 显示面板（温度设定 / 故障码）
 *      └── 电源（3节5号电池 / 外接 DC 3V，驱动阀和点火）
 *
 * ══════════════════════════════════════════════════════════════════════
 *  自动点火阶段状态机
 * ══════════════════════════════════════════════════════════════════════
 *
 *  IDLE（待机）
 *    └──[openValve() / 水流传感器触发]──►
 *  FLOW_DETECT（水流检测，约 200ms）
 *    └──[流量 ≥ 阈值]──►
 *  GAS_OPEN（燃气阀开启，约 100ms 延迟通电）
 *    └──[阀全开]──►
 *  SPARKING（点火放电，3～8Hz 脉冲，最长 8s）
 *    └──[离子传感器确认火焰]──►  BURNING（正常燃烧加热）
 *    └──[超时 8s 无火焰]    ──►  IGNITE_FAIL（点火失败，报警）
 *  BURNING（燃烧中）
 *    └──[closeValve() / 水流停止]──►
 *  EXTINGUISHING（熄火过程，约 200ms 阀关闭）
 *    └──[燃气断供，火焰熄灭确认]──►  IDLE
 *  IGNITE_FAIL（点火失败）
 *    └──[reset()]──►  IDLE
 *
 * ══════════════════════════════════════════════════════════════════════
 *  温度物理模型
 * ══════════════════════════════════════════════════════════════════════
 *
 *  出水温度（T_out）：
 *    BURNING 阶段：
 *      gasRatio = 当前燃气阀开度（0～1，PID 调节）
 *      P_heat   = ratedPower × gasRatio（kW）
 *      dT_out/dt = (P_heat / (flowRate × C_water) − k_loss×(T_out−T_amb)) × simScale
 *      C_water ≈ 4.18 kJ/(kg·K)，flowRate 单位 kg/s
 *    熄火后：自然冷却
 *
 *  燃烧室温度（T_flame）：
 *    SPARKING → BURNING：T_flame 从室温急升至约 900℃（动画）
 *    EXTINGUISHING：急降
 *
 *  PID 控制（维持出水温度 = setTemp）：
 *    err = setTemp − T_out
 *    gasRatio = clamp(0.10 + kp×err + ki×∫err dt, 0.10, 1.0)
 *    最小 10% 火力（防止熄火），最大 100%
 *
 * ══════════════════════════════════════════════════════════════════════
 *  绘制分层（从底到顶）
 * ══════════════════════════════════════════════════════════════════════
 *
 *  Layer 0   外壳（housing）
 *  Layer 1   热交换器（heatExchanger）—静态铜管翅片
 *  Layer 2   燃烧室背板（burnerBack）
 *  Layer 3   进出水管 + 燃气管路（pipes）—静态
 *  Layer 4   控制板区域（controlBoard）—静态
 *  Layer 5   _flameGroup     — 火焰动画（tick 驱动）
 *  Layer 6   _sparkGroup     — 点火电火花动画（tick 驱动）
 *  Layer 7   _flowGroup      — 水流动画（tick 驱动）
 *  Layer 8   _valveGroup     — 燃气阀状态（tick 驱动）
 *  Layer 9   _sensorGroup    — 传感器数值标注（tick 驱动）
 *  Layer 10  _panelGroup     — 操作面板（tick 驱动）
 *  Layer 11  标注文字
 *
 * ══════════════════════════════════════════════════════════════════════
 *  端口
 * ══════════════════════════════════════════════════════════════════════
 *  cold_in      — 冷水进水口
 *  hot_out      — 热水出水口
 *  gas_in       — 燃气进气口
 *  exhaust_out  — 烟气排放口
 *  power_in     — 电源输入（DC 3V 电池 / 外接）
 */

// ═══════════════════════════════════════════════════════════════════════
//  阶段枚举
// ═══════════════════════════════════════════════════════════════════════
const GWH_STAGE = {
    IDLE:         'idle',
    FLOW_DETECT:  'flow_detect',   // 水流检测中（约 200ms）
    GAS_OPEN:     'gas_open',      // 燃气阀开启中（约 100ms）
    SPARKING:     'sparking',      // 点火放电中（最长 8s）
    BURNING:      'burning',       // 正常燃烧
    EXTINGUISHING:'extinguishing', // 熄火中（约 300ms）
    IGNITE_FAIL:  'ignite_fail',   // 点火失败（E1 故障）
};

// ═══════════════════════════════════════════════════════════════════════
//  燃气热水器主类
// ═══════════════════════════════════════════════════════════════════════
export class GasWaterHeater extends BaseComponent {

    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(280, config.width  || 340);
        this.height = Math.max(380, config.height || 460);

        this.type    = 'gas_water_heater';
        this.special = 'none';
        this.cache   = 'fixed';

        this._initGroups();
        // ── 额定参数 ────────────────────────────────────────────────
        this.label        = config.label        || 'GWH';
        this.ratedPower   = config.ratedPower   || 16000;  // W（16kW 热功率）
        this.setTemp      = config.setTemp      || 45;     // °C，目标出水温度
        this.flowThresh   = config.flowThresh   || 2.0;    // L/min，触发阈值
        this.maxSparkTime = config.maxSparkTime || 8.0;    // s，最长点火时间
        this.ambientTemp  = config.ambientTemp  || 15;     // °C

        // 仿真加速倍率（水加热过程约 20s 仿真对应真实约 60s）
        this._simScale    = config.simScale     || 3;

        // ── 物理状态 ────────────────────────────────────────────────
        this._stage       = GWH_STAGE.IDLE;
        this._stageTimer  = 0;            // 当前阶段已耗时 s（实际时间）

        // 水温
        this._tColdIn     = this.ambientTemp;   // 进水温度 °C
        this._tHotOut     = this.ambientTemp;   // 出水温度 °C
        this._tFlame      = this.ambientTemp;   // 燃烧室温度 °C（0~900）

        // 燃气控制
        this._gasValveOpen = false;    // 主燃气电磁阀状态
        this._gasRatio     = 0;        // 燃气阀开度 0~1（比例调节）
        this._pidIntegral  = 0;        // PID 积分项

        // 点火
        this._sparkOn      = false;    // 当前是否放电
        this._sparkFlipT   = 0;        // 点火脉冲翻转计时
        this._sparkFreq    = 5;        // Hz，点火频率
        this._flameConfirmed = false;  // 离子传感器是否确认火焰
        this._sparkCount   = 0;        // 本次点火已放电次数

        // 水阀（用户操作）
        this._waterValveOpen = false;  // 热水龙头是否打开
        this._flowRate       = 0;      // L/min，当前流量（平滑）

        // 风机
        this._fanOn          = false;
        this._fanAngle       = 0;      // 风机叶片旋转角度

        // 动画相位（火焰、水流）
        this._flamePhase     = 0;
        this._waterPhase     = 0;
        this._smokePhase     = 0;

        // PID 历史
        this._tOutHistory    = new Array(50).fill(this.ambientTemp);
        this._histTimer      = 0;

        // 操作计数
        this._igniteCount    = config.initIgniteCount || 0;
        this._failCount      = 0;

        // ── 布局 & 初始化 ────────────────────────────────────────
        this._layout = this._calcLayout();
        this._init();

        // ── 端口 ─────────────────────────────────────────────────
        const L = this._layout;
        this.addPort(L.coldPipe.x - 4,       L.coldPipe.y + L.coldPipe.h/2, 'cold_in',     'pipe', '冷');
        this.addPort(L.hotPipe.x + L.hotPipe.w + 4, L.hotPipe.y + L.hotPipe.h/2, 'hot_out','pipe', '热');
        this.addPort(L.gasPipe.x - 4,        L.gasPipe.y + L.gasPipe.h/2,  'gas_in',      'pipe', '气');
        this.addPort(L.exhaust.x + L.exhaust.w/2, L.exhaust.y - 4,          'exhaust_out', 'pipe', '烟');
        this.addPort(L.panel.x + 10,          L.panel.y + L.panel.h + 4,    'power_in',    'wire', 'DC');
    }

    // ═══════════════════════════════════════════════════════════════════
    //  布局
    // ═══════════════════════════════════════════════════════════════════
    _calcLayout() {
        const W = this.width, H = this.height;
        return {
            // 外壳
            housing:    { x: W*0.02, y: H*0.01, w: W*0.96, h: H*0.88, rx: 12 },
            // 顶部排烟口
            exhaust:    { x: W*0.38, y: H*0.01, w: W*0.24, h: H*0.05 },
            // 热交换器（上半区，铜管翅片）
            heatExch:   { x: W*0.08, y: H*0.05, w: W*0.84, h: H*0.30, rx: 4 },
            // 燃烧室（热交换器正下方）
            burner:     { x: W*0.10, y: H*0.35, w: W*0.80, h: H*0.24, rx: 4 },
            // 燃气管路区（燃烧室下方）
            gasZone:    { x: W*0.10, y: H*0.59, w: W*0.48, h: H*0.10 },
            // 控制板区（右下）
            ctrlZone:   { x: W*0.62, y: H*0.59, w: W*0.28, h: H*0.18 },
            // 操作面板（底部）
            panel:      { x: W*0.02, y: H*0.79, w: W*0.96, h: H*0.10, rx: 6 },
            // 冷水进水管（左侧）
            coldPipe:   { x: W*0.02, y: H*0.22, w: W*0.06, h: H*0.08 },
            // 热水出水管（右侧）
            hotPipe:    { x: W*0.92, y: H*0.22, w: W*0.06, h: H*0.08 },
            // 燃气进气管（左下）
            gasPipe:    { x: W*0.02, y: H*0.62, w: W*0.08, h: H*0.05 },
        };
    }

    // ═══════════════════════════════════════════════════════════════════
    //  初始化绘制（静态结构）
    // ═══════════════════════════════════════════════════════════════════
    _init() {
        this._drawHousing();
        this._drawExhaust();
        this._drawHeatExchanger();
        this._drawBurnerBack();
        this._drawPipes();
        this._drawGasValveStatic();
        this._drawControlBoard();
        this._drawPanel();
        this._drawLabel();

        // 动态层（Group，tick 时 destroyChildren + 重绘）
        this._flameGroup  = new Konva.Group(); this._staticGroup.add(this._flameGroup);
        this._sparkGroup  = new Konva.Group(); this._staticGroup.add(this._sparkGroup);
        this._flowGroup   = new Konva.Group(); this._staticGroup.add(this._flowGroup);
        this._valveGroup  = new Konva.Group(); this._staticGroup.add(this._valveGroup);
        this._sensorGroup = new Konva.Group(); this._staticGroup.add(this._sensorGroup);
        this._panelDynGroup = new Konva.Group(); this._staticGroup.add(this._panelDynGroup);
        this._fanGroup    = new Konva.Group(); this._staticGroup.add(this._fanGroup);

        this._bindInteraction();
    }

    // ───────────────────────────────────────────────────────────────────
    //  外壳（白色家电 / 烤漆钢板）
    // ───────────────────────────────────────────────────────────────────
    _drawHousing() {
        const h = this._layout.housing;
        this._staticGroup.add(new Konva.Rect({
            x: h.x, y: h.y, width: h.w, height: h.h,
            fillLinearGradientStartPoint: { x:0, y:0 },
            fillLinearGradientEndPoint:   { x:h.w, y:0 },
            fillLinearGradientColorStops: [
                0,'#c8c8c8', 0.10,'#e0e0e0', 0.40,'#f2f2f2',
                0.60,'#f2f2f2', 0.90,'#e0e0e0', 1,'#c0c0c0',
            ],
            stroke:'#a8a8a8', strokeWidth:1.5, cornerRadius:h.rx,
            shadowColor:'#000', shadowBlur:8, shadowOffsetY:3, shadowOpacity:0.18,
        }));
        // 顶部高光条
        this._staticGroup.add(new Konva.Rect({
            x:h.x+4, y:h.y+2, width:h.w-8, height:h.h*0.04,
            fill:'rgba(255,255,255,0.55)', cornerRadius:[h.rx,h.rx,0,0],
        }));
        // 品牌铭牌区（右上）
        this._staticGroup.add(new Konva.Rect({
            x:h.x+h.w*0.72, y:h.y+h.h*0.06, width:h.w*0.22, height:h.h*0.06,
            fill:'#2244a8', stroke:'#1a3488', strokeWidth:0.8, cornerRadius:3,
        }));
        this._staticGroup.add(new Konva.Text({
            x:h.x+h.w*0.73, y:h.y+h.h*0.075,
            text:`${this.label}  ${Math.round(this.ratedPower/1000)}kW`,
            fontSize:9, fill:'#ffffff', fontStyle:'bold',
        }));
        // 左侧竖向光泽
        this._staticGroup.add(new Konva.Line({
            points:[h.x+h.w*0.07, h.y+14, h.x+h.w*0.07, h.y+h.h-14],
            stroke:'rgba(255,255,255,0.30)', strokeWidth:2.5, lineCap:'round',
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    //  排烟口（顶部）
    // ───────────────────────────────────────────────────────────────────
    _drawExhaust() {
        const e = this._layout.exhaust;
        // 排烟管外口
        this._staticGroup.add(new Konva.Rect({
            x:e.x, y:e.y, width:e.w, height:e.h,
            fill:'#484848', stroke:'#303030', strokeWidth:1, cornerRadius:[4,4,0,0],
        }));
        // 排烟格栅
        for (let i=0; i<4; i++) {
            this._staticGroup.add(new Konva.Line({
                points:[e.x+e.w*(0.15+i*0.22), e.y+2, e.x+e.w*(0.15+i*0.22), e.y+e.h-2],
                stroke:'#282828', strokeWidth:1.5, lineCap:'round',
            }));
        }
        this._staticGroup.add(new Konva.Text({
            x:e.x+e.w+3, y:e.y+2, text:'排烟', fontSize:7.5, fill:'#888',
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    //  热交换器（铜管翅片阵列）
    // ───────────────────────────────────────────────────────────────────
    _drawHeatExchanger() {
        const he = this._layout.heatExch;
        // 背板（深灰，铜色调）
        this._staticGroup.add(new Konva.Rect({
            x:he.x, y:he.y, width:he.w, height:he.h,
            fill:'#1a1010', stroke:'#382010', strokeWidth:1, cornerRadius:he.rx,
        }));
        // 标注
        this._staticGroup.add(new Konva.Text({
            x:he.x+4, y:he.y+3, text:'热交换器（Copper Fin-Tube Heat Exchanger）',
            fontSize:8, fill:'#b08060', fontStyle:'italic',
        }));

        // 铜管翅片（8 排，每排多个翅片）
        const finCols = 10, finRows = 5;
        const finW = (he.w - 16) / finCols;
        const finH = (he.h - 20) / finRows;
        for (let row=0; row<finRows; row++) {
            for (let col=0; col<finCols; col++) {
                const fx = he.x + 8 + col*finW;
                const fy = he.y + 14 + row*finH;
                // 翅片矩形（铜色）
                this._staticGroup.add(new Konva.Rect({
                    x:fx+1, y:fy+1, width:finW-2, height:finH-2,
                    fillLinearGradientStartPoint:{x:0,y:0},
                    fillLinearGradientEndPoint:{x:finW,y:0},
                    fillLinearGradientColorStops:[0,'#7a4a20',0.4,'#c88040',0.6,'#d89050',1,'#7a4a20'],
                    stroke:'#5a3010', strokeWidth:0.5, cornerRadius:1,
                }));
            }
        }
        // 铜管（穿过翅片的两排主管）
        [0.32, 0.66].forEach(ry => {
            this._staticGroup.add(new Konva.Rect({
                x:he.x+8, y:he.y+he.h*ry-3, width:he.w-16, height:6,
                fill:'#c87020', stroke:'#a05010', strokeWidth:0.8, cornerRadius:3,
            }));
        });

        // 进出水 NTC 标注
        const W = this.width;
        this._staticGroup.add(new Konva.Circle({
            x:he.x+10, y:he.y+he.h*0.50, radius:4,
            fill:'#4090e0', stroke:'#2060c0', strokeWidth:0.8,
        }));
        this._staticGroup.add(new Konva.Text({
            x:he.x+16, y:he.y+he.h*0.50-5, text:'NTC进', fontSize:7, fill:'#4090e0',
        }));
        this._ntcInDot = new Konva.Circle({
            x:he.x+he.w-10, y:he.y+he.h*0.50, radius:4,
            fill:'#e04020', stroke:'#c02010', strokeWidth:0.8,
        });
        this._staticGroup.add(this._ntcInDot);
        this._staticGroup.add(new Konva.Text({
            x:he.x+he.w-32, y:he.y+he.h*0.50-5, text:'NTC出', fontSize:7, fill:'#e04020',
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    //  燃烧室背板
    // ───────────────────────────────────────────────────────────────────
    _drawBurnerBack() {
        const b = this._layout.burner;
        // 燃烧室箱体（耐火钢板，深灰）
        this._staticGroup.add(new Konva.Rect({
            x:b.x, y:b.y, width:b.w, height:b.h,
            fill:'#1c1c1c', stroke:'#383838', strokeWidth:1, cornerRadius:b.rx,
        }));
        this._staticGroup.add(new Konva.Text({
            x:b.x+4, y:b.y+3, text:'燃烧室（Combustion Chamber）',
            fontSize:8, fill:'#606060', fontStyle:'italic',
        }));

        // 燃烧器头部（多孔分气板）
        const burnerY = b.y + b.h - 16;
        this._staticGroup.add(new Konva.Rect({
            x:b.x+10, y:burnerY, width:b.w-20, height:10,
            fill:'#404040', stroke:'#555', strokeWidth:0.8, cornerRadius:2,
        }));
        // 燃烧孔（小圆孔阵列）
        const nHoles = 16;
        for (let i=0; i<nHoles; i++) {
            this._staticGroup.add(new Konva.Circle({
                x: b.x+14 + i*(b.w-28)/(nHoles-1),
                y: burnerY+5, radius:2.5,
                fill:'#202020', stroke:'#505050', strokeWidth:0.5,
            }));
        }
        this._burnerY = burnerY;    // 保存燃烧器头部 Y，供火焰动画使用
        this._burnerX = b.x + 10;
        this._burnerW = b.w - 20;

        // 点火电极（两根，一根点火，一根检测）
        const elecX = [b.x+b.w*0.25, b.x+b.w*0.75];
        elecX.forEach((ex, i) => {
            // 陶瓷绝缘体（白色）
            this._staticGroup.add(new Konva.Rect({
                x:ex-3, y:burnerY-18, width:6, height:18,
                fill:'#d8d8c0', stroke:'#b0b090', strokeWidth:0.5, cornerRadius:2,
            }));
            // 电极金属针
            this._staticGroup.add(new Konva.Line({
                points:[ex, burnerY-4, ex+(i===0?4:-4), burnerY+2],
                stroke:'#c0c0c0', strokeWidth:2, lineCap:'round',
            }));
            this._staticGroup.add(new Konva.Text({
                x:ex-12, y:burnerY-28, text: i===0?'点火极':'检测极',
                fontSize:7, fill:'#808080',
            }));
        });
        this._elecX   = elecX;

        // 风机位置（燃烧室右侧）
        this._fanCX = b.x + b.w + 16;
        this._fanCY = b.y + b.h*0.45;
    }

    // ───────────────────────────────────────────────────────────────────
    //  进出水管 + 燃气管路（静态结构）
    // ───────────────────────────────────────────────────────────────────
    _drawPipes() {
        const W = this.width, H = this.height;
        const he = this._layout.heatExch;

        // 冷水进水管（左侧，蓝色）
        this._staticGroup.add(new Konva.Rect({
            x:W*0.02, y:H*0.21, width:W*0.06, height:H*0.10,
            fill:'#2060a0', stroke:'#1040808', strokeWidth:1, cornerRadius:2,
        }));
        this._staticGroup.add(new Konva.Text({
            x:W*0.02, y:H*0.21-10, text:'冷水进', fontSize:7.5, fill:'#4090d0',
        }));
        // 冷水连接热交换器
        this._staticGroup.add(new Konva.Rect({
            x:W*0.08, y:H*0.24, width:W*0.02, height:H*0.06,
            fill:'#2060a0', cornerRadius:1,
        }));

        // 热水出水管（右侧，红色）
        this._staticGroup.add(new Konva.Rect({
            x:W*0.92, y:H*0.21, width:W*0.06, height:H*0.10,
            fill:'#a03020', stroke:'#701808', strokeWidth:1, cornerRadius:2,
        }));
        this._staticGroup.add(new Konva.Text({
            x:W*0.90, y:H*0.21-10, text:'热水出', fontSize:7.5, fill:'#e06040',
        }));
        this._staticGroup.add(new Konva.Rect({
            x:W*0.90, y:H*0.24, width:W*0.02, height:H*0.06,
            fill:'#a03020', cornerRadius:1,
        }));

        // 燃气进管（左下，黄色）
        this._staticGroup.add(new Konva.Rect({
            x:W*0.02, y:H*0.61, width:W*0.08, height:H*0.05,
            fill:'#a08010', stroke:'#806008', strokeWidth:1, cornerRadius:2,
        }));
        this._staticGroup.add(new Konva.Text({
            x:W*0.02, y:H*0.61-10, text:'燃气', fontSize:7.5, fill:'#c0a030',
        }));

        // 水流传感器位置标注
        const flowX = W*0.08, flowY = H*0.245;
        this._staticGroup.add(new Konva.Rect({
            x:flowX-4, y:flowY-4, width:12, height:12,
            fill:'#204060', stroke:'#3060a0', strokeWidth:0.8, cornerRadius:2,
        }));
        this._staticGroup.add(new Konva.Text({
            x:flowX+10, y:flowY-2, text:'水流\n传感器', fontSize:7, fill:'#6090c0', lineHeight:1.4,
        }));
        this._flowSensorX = flowX + 2;
        this._flowSensorY = flowY + 2;
    }

    // ───────────────────────────────────────────────────────────────────
    //  燃气阀（静态背景部分，动态状态由 _valveGroup 渲染）
    // ───────────────────────────────────────────────────────────────────
    _drawGasValveStatic() {
        const gz = this._layout.gasZone;
        this._staticGroup.add(new Konva.Rect({
            x:gz.x, y:gz.y, width:gz.w, height:gz.h,
            fill:'#141414', stroke:'#222', strokeWidth:0.8, cornerRadius:3,
        }));
        this._staticGroup.add(new Konva.Text({
            x:gz.x+3, y:gz.y+2, text:'燃气阀组',
            fontSize:7.5, fill:'#505050',
        }));

        // 主燃气电磁阀外形
        const mx = gz.x+8, my = gz.y+gz.h*0.30;
        this._staticGroup.add(new Konva.Rect({
            x:mx, y:my, width:28, height:22,
            fill:'#303030', stroke:'#505050', strokeWidth:0.8, cornerRadius:3,
        }));
        this._staticGroup.add(new Konva.Text({ x:mx+2, y:my+7, text:'主阀', fontSize:8, fill:'#808080' }));

        // 比例调节阀
        const px = gz.x+50, py = gz.y+gz.h*0.20;
        this._staticGroup.add(new Konva.Rect({
            x:px, y:py, width:24, height:26,
            fill:'#383838', stroke:'#505050', strokeWidth:0.8, cornerRadius:3,
        }));
        this._staticGroup.add(new Konva.Text({ x:px+2, y:py+8, text:'比例\n阀', fontSize:7, fill:'#909090', lineHeight:1.4 }));

        // 点火变压器（右侧）
        const itx = gz.x+gz.w*0.68, ity = gz.y+gz.h*0.15;
        this._staticGroup.add(new Konva.Rect({
            x:itx, y:ity, width:32, height:26,
            fill:'#1a1a30', stroke:'#303050', strokeWidth:0.8, cornerRadius:2,
        }));
        this._staticGroup.add(new Konva.Text({ x:itx+2, y:ity+6, text:'点火\n变压器', fontSize:7.5, fill:'#6060c0', lineHeight:1.5 }));
        // 高压输出线
        this._staticGroup.add(new Konva.Line({
            points:[itx+16, ity, itx+16, this._layout.burner.y+this._layout.burner.h-18],
            stroke:'#4040a0', strokeWidth:1.5, dash:[3,2], lineCap:'round',
        }));

        this._mainValveX  = mx;
        this._mainValveY  = my;
        this._ratioValveX = px;
        this._ratioValveY = py;
        this._ignTransX   = itx;
        this._ignTransY   = ity;
    }

    // ───────────────────────────────────────────────────────────────────
    //  控制板（MCU 静态结构）
    // ───────────────────────────────────────────────────────────────────
    _drawControlBoard() {
        const cz = this._layout.ctrlZone;
        this._staticGroup.add(new Konva.Rect({
            x:cz.x, y:cz.y, width:cz.w, height:cz.h,
            fill:'#0c1c0c', stroke:'#183018', strokeWidth:0.8, cornerRadius:3,
        }));
        this._staticGroup.add(new Konva.Text({
            x:cz.x+3, y:cz.y+2, text:'MCU 控制板',
            fontSize:7.5, fill:'#30a030', fontStyle:'bold',
        }));
        // MCU 芯片
        this._staticGroup.add(new Konva.Rect({
            x:cz.x+4, y:cz.y+14, width:18, height:18,
            fill:'#202020', stroke:'#505050', strokeWidth:0.5, cornerRadius:1,
        }));
        this._staticGroup.add(new Konva.Text({ x:cz.x+6, y:cz.y+19, text:'MCU', fontSize:8, fill:'#4090e0', fontStyle:'bold' }));
        // 各信号接口标注
        const sigs = ['水流','火焰','NTC出','NTC进','气阀','点火'];
        sigs.forEach((s, i) => {
            this._staticGroup.add(new Konva.Text({
                x:cz.x+24, y:cz.y+14+i*8, text:`→ ${s}`,
                fontSize:6.5, fill:'#306030',
            }));
        });
        // 动态状态文字
        this._ctrlStatusText = new Konva.Text({
            x:cz.x+3, y:cz.y+cz.h-11,
            text:'状态: 待机',
            fontSize:8, fill:'#30c030', fontFamily:'monospace',
        });
        this._staticGroup.add(this._ctrlStatusText);
    }

    // ───────────────────────────────────────────────────────────────────
    //  操作面板（静态结构，动态内容由 _panelDynGroup 渲染）
    // ───────────────────────────────────────────────────────────────────
    _drawPanel() {
        const pn = this._layout.panel;
        this._staticGroup.add(new Konva.Rect({
            x:pn.x, y:pn.y, width:pn.w, height:pn.h,
            fill:'#181818', stroke:'#282828', strokeWidth:1, cornerRadius:pn.rx,
        }));
        // 温度显示框（中央）
        this._staticGroup.add(new Konva.Rect({
            x:pn.x+pn.w*0.30, y:pn.y+4, width:pn.w*0.24, height:pn.h-8,
            fill:'#0a1a0a', stroke:'#1a3a1a', strokeWidth:0.8, cornerRadius:3,
        }));
        // 按键区（左右各一）
        this._hotBtnX  = pn.x + pn.w*0.06;
        this._hotBtnY  = pn.y + pn.h*0.20;
        this._hotBtnW  = pn.w*0.22;
        this._hotBtnH  = pn.h*0.65;
        this._upBtnX   = pn.x + pn.w*0.60;
        this._dnBtnX   = pn.x + pn.w*0.75;
        this._tempBtnY = pn.y + pn.h*0.15;
        this._tempBtnH = pn.h*0.70;

        // 按键底色（静态背景）
        ['开/关热水', '温度 ▲', '温度 ▼'].forEach((t, i) => {
            const bx = i===0 ? this._hotBtnX : (i===1 ? this._upBtnX : this._dnBtnX);
            const bw = i===0 ? this._hotBtnW : pn.w*0.12;
            this._staticGroup.add(new Konva.Rect({
                x:bx, y:this._tempBtnY, width:bw, height:this._tempBtnH,
                fill:'#222', stroke:'#404040', strokeWidth:0.6, cornerRadius:4,
            }));
            this._staticGroup.add(new Konva.Text({
                x:bx+2, y:this._tempBtnY+this._tempBtnH*0.25,
                width:bw-4, text:t, fontSize:8.5, fill:'#808080', align:'center',
            }));
        });
    }

    // ───────────────────────────────────────────────────────────────────
    //  标注
    // ───────────────────────────────────────────────────────────────────
    _drawLabel() {
        this._staticGroup.add(new Konva.Text({
            x:0, y:-16, width:this.width,
            text:`${this.label}  家用燃气热水器  ${Math.round(this.ratedPower/1000)}kW  自动点火仿真`,
            fontSize:9, fontStyle:'bold', fill:'#546e7a', align:'center',
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    //  交互绑定
    // ───────────────────────────────────────────────────────────────────
    _bindInteraction() {
        setTimeout(() => {
            // 热水阀开/关按键
            const hotHit = new Konva.Rect({
                x:this._hotBtnX, y:this._tempBtnY,
                width:this._hotBtnW, height:this._tempBtnH,
                fill:'rgba(0,0,0,0)', listening:true,
            });
            this._interactGroup.add(hotHit);
            hotHit.on('click tap', () => this.toggleWaterValve());
            hotHit.on('mouseenter', () => { document.body.style.cursor='pointer'; });
            hotHit.on('mouseleave', () => { document.body.style.cursor='default'; });

            // 温度 ▲
            const upHit = new Konva.Rect({
                x:this._upBtnX, y:this._tempBtnY,
                width:this.width*0.12, height:this._tempBtnH,
                fill:'rgba(0,0,0,0)', listening:true,
            });
            this._interactGroup.add(upHit);
            upHit.on('click tap', () => { this.setTemp = Math.min(60, this.setTemp+1); });
            upHit.on('mouseenter', () => { document.body.style.cursor='pointer'; });
            upHit.on('mouseleave', () => { document.body.style.cursor='default'; });

            // 温度 ▼
            const dnHit = new Konva.Rect({
                x:this._dnBtnX, y:this._tempBtnY,
                width:this.width*0.12, height:this._tempBtnH,
                fill:'rgba(0,0,0,0)', listening:true,
            });
            this._interactGroup.add(dnHit);
            dnHit.on('click tap', () => { this.setTemp = Math.max(35, this.setTemp-1); });
            dnHit.on('mouseenter', () => { document.body.style.cursor='pointer'; });
            dnHit.on('mouseleave', () => { document.body.style.cursor='default'; });
        }, 80);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  Tick — 由 consys._tickAll 在 20fps 调用
    // ═══════════════════════════════════════════════════════════════════
    tick(dt) {
        this._tickStageLogic(dt);
        this._tickPhysics(dt);
        this._tickAnimPhases(dt);
        this._tickHistoryRecord(dt);

        this._rebuildFlame();
        this._rebuildSpark();
        this._rebuildWaterFlow();
        this._rebuildValveStatus();
        this._rebuildSensors();
        this._rebuildPanelDyn();
        this._rebuildFan(dt);
        this._refreshCache();
    }

    // ── 自动点火阶段状态机 ───────────────────────────────────────────
    _tickStageLogic(dt) {
        this._stageTimer += dt;

        switch (this._stage) {

            case GWH_STAGE.IDLE:
                this._gasValveOpen = false;
                this._gasRatio     = 0;
                this._fanOn        = false;
                this._sparkOn      = false;
                this._flameConfirmed = false;
                break;

            case GWH_STAGE.FLOW_DETECT:
                // 水流检测：200ms 后确认流量足够
                this._flowRate = Math.min(6.0, this._flowRate + dt*20);
                if (this._stageTimer >= 0.20) {
                    if (this._flowRate >= this.flowThresh) {
                        this._setStage(GWH_STAGE.GAS_OPEN);
                        this._fanOn = true;
                    } else {
                        this._setStage(GWH_STAGE.IDLE);
                    }
                }
                break;

            case GWH_STAGE.GAS_OPEN:
                // 燃气阀通电开启，约 150ms 全开
                this._fanOn = true;
                if (this._stageTimer >= 0.15) {
                    this._gasValveOpen = true;
                    this._gasRatio     = 0.5;  // 点火时先开半档
                    this._setStage(GWH_STAGE.SPARKING);
                    this._sparkCount = 0;
                }
                break;

            case GWH_STAGE.SPARKING:
                // 点火放电（3~8Hz 脉冲）
                this._fanOn        = true;
                this._gasValveOpen = true;
                this._gasRatio     = 0.45;

                // 火花翻转
                this._sparkFlipT += dt;
                if (this._sparkFlipT >= 1.0 / this._sparkFreq) {
                    this._sparkFlipT = 0;
                    this._sparkOn    = !this._sparkOn;
                    if (this._sparkOn) this._sparkCount++;
                }

                // 燃气升温 → 模拟燃气混合，约 1.5s 后点燃
                if (this._stageTimer >= 1.5 && !this._flameConfirmed) {
                    this._flameConfirmed = true;
                    this._setStage(GWH_STAGE.BURNING);
                    this._sparkOn = false;
                    this._gasRatio = 0.8;
                    this._igniteCount++;
                    this.emit?.('ignite', { sparkCount: this._sparkCount });
                }
                // 超时保护
                if (this._stageTimer >= this.maxSparkTime && !this._flameConfirmed) {
                    this._gasValveOpen = false;
                    this._gasRatio     = 0;
                    this._sparkOn      = false;
                    this._failCount++;
                    this._setStage(GWH_STAGE.IGNITE_FAIL);
                    this.emit?.('igniteFail');
                }
                break;

            case GWH_STAGE.BURNING:
                this._fanOn        = true;
                this._gasValveOpen = true;
                // PID 调节火力
                this._tickPID(dt);
                break;

            case GWH_STAGE.EXTINGUISHING:
                // 关闭燃气阀，约 300ms 火焰熄灭
                this._gasValveOpen = false;
                this._gasRatio     = Math.max(0, this._gasRatio - dt*3.5);
                this._flowRate     = Math.max(0, this._flowRate - dt*15);
                if (this._stageTimer >= 0.30) {
                    this._gasRatio = 0;
                    this._fanOn    = false;
                    this._setStage(GWH_STAGE.IDLE);
                    this.emit?.('extinguished');
                }
                break;

            case GWH_STAGE.IGNITE_FAIL:
                // 故障等待重置
                this._gasValveOpen = false;
                this._gasRatio     = 0;
                this._sparkOn      = false;
                this._fanOn        = false;
                break;
        }
    }

    _setStage(s) {
        this._stage      = s;
        this._stageTimer = 0;
        this.emit?.('stageChange', { stage: s });
    }

    // ── PID 调节出水温度 ─────────────────────────────────────────────
    _tickPID(dt) {
        const err        = this.setTemp - this._tHotOut;
        const kp         = 0.025, ki = 0.004;
        this._pidIntegral = Math.max(-5, Math.min(5, this._pidIntegral + err*dt));
        const output     = 0.30 + kp*err + ki*this._pidIntegral;
        this._gasRatio   = Math.max(0.10, Math.min(1.0, output));
    }

    // ── 温度物理仿真 ─────────────────────────────────────────────────
    _tickPhysics(dt) {
        const sdt       = dt * this._simScale;
        const Ta        = this.ambientTemp;
        const k_loss    = 0.015;
        const burning   = this._stage === GWH_STAGE.BURNING;
        const sparking  = this._stage === GWH_STAGE.SPARKING;
        const extinguish= this._stage === GWH_STAGE.EXTINGUISHING;

        // 出水温度（对流换热模型）
        if (burning) {
            const Peff   = this.ratedPower * this._gasRatio;
            const flow_kg_s = (this._flowRate / 60) * 1.0;  // kg/s (ρ=1kg/L)
            const C_water   = 4180;  // J/(kg·K)
            // ΔT = P / (flow × C) 的稳态值，用一阶惯性跟随
            const tTarget   = this._tColdIn + Peff / Math.max(0.01, flow_kg_s * C_water);
            this._tHotOut  += (tTarget - this._tHotOut) * 0.04 * sdt;
            this._tHotOut   = Math.max(Ta, Math.min(90, this._tHotOut));
        } else if (sparking) {
            this._tHotOut   = Math.max(Ta, this._tHotOut - k_loss*(this._tHotOut-Ta)*sdt);
        } else {
            this._tHotOut   = Math.max(Ta, this._tHotOut - k_loss*(this._tHotOut-Ta)*sdt*0.5);
        }

        // 燃烧室火焰温度（仿真 0~1 归一化）
        if (burning) {
            this._tFlame += (900 * this._gasRatio - this._tFlame) * 0.08 * sdt;
        } else if (sparking && this._gasValveOpen) {
            this._tFlame += (200 - this._tFlame) * 0.10 * sdt;
        } else {
            this._tFlame  = Math.max(Ta, this._tFlame - 60*sdt);
        }
    }

    // ── 动画相位更新 ─────────────────────────────────────────────────
    _tickAnimPhases(dt) {
        if (this._tFlame > 50) {
            this._flamePhase += dt * (3 + this._gasRatio * 4);
        }
        if (this._flowRate > 0) {
            this._waterPhase += dt * this._flowRate * 0.8;
        }
        if (this._stage === GWH_STAGE.BURNING || this._stage === GWH_STAGE.SPARKING) {
            this._smokePhase += dt * 1.2;
        }
        if (this._fanOn) {
            this._fanAngle += dt * 360 * (2 + this._gasRatio * 3);
        }
    }

    _tickHistoryRecord(dt) {
        this._histTimer += dt;
        if (this._histTimer >= 0.4) {
            this._histTimer = 0;
            this._tOutHistory.shift();
            this._tOutHistory.push(this._tHotOut);
        }
    }

    // ───────────────────────────────────────────────────────────────────
    //  动态层：火焰
    // ───────────────────────────────────────────────────────────────────
    _rebuildFlame() {
        this._flameGroup.destroyChildren();
        const burning = this._stage === GWH_STAGE.BURNING;
        const sparking = this._stage === GWH_STAGE.SPARKING && this._gasValveOpen;
        const extinguish = this._stage === GWH_STAGE.EXTINGUISHING;

        if (this._tFlame < 30 && !burning && !sparking) return;

        const flameH   = Math.min(this._layout.burner.h * 0.75, (this._tFlame / 900) * this._layout.burner.h * 0.85);
        const bx       = this._burnerX;
        const by       = this._burnerY;
        const bw       = this._burnerW;
        const nFlames  = burning ? 14 : (sparking ? 8 : 6);
        const flameRatio = this._gasRatio;

        for (let i = 0; i < nFlames; i++) {
            const fx   = bx + (i / (nFlames-1)) * bw;
            const fH   = flameH * (0.6 + 0.4*Math.sin(this._flamePhase + i*0.7));
            const swayX = Math.sin(this._flamePhase*0.8 + i*1.1) * 3 * flameRatio;

            // 外焰（蓝色，高温完全燃烧区）
            this._flameGroup.add(new Konva.Line({
                points:[
                    fx, by,
                    fx+swayX-4, by-fH*0.45,
                    fx+swayX,   by-fH,
                    fx+swayX+4, by-fH*0.45,
                    fx, by,
                ],
                closed:true,
                fill: burning
                    ? `rgba(30,80,255,${(0.5+flameRatio*0.4).toFixed(2)})`
                    : `rgba(60,60,200,0.35)`,
                stroke:'none',
                tension:0.4,
            }));
            // 内焰（橙黄，较短）
            const fH2 = fH * 0.60;
            this._flameGroup.add(new Konva.Line({
                points:[
                    fx, by,
                    fx+swayX*0.5-3, by-fH2*0.5,
                    fx+swayX*0.5,   by-fH2,
                    fx+swayX*0.5+3, by-fH2*0.5,
                    fx, by,
                ],
                closed:true,
                fill: burning
                    ? `rgba(255,${140+Math.round(flameRatio*80)},20,${(0.7+flameRatio*0.25).toFixed(2)})`
                    : 'rgba(255,140,20,0.45)',
                stroke:'none',
                tension:0.4,
            }));
            // 火芯（白黄，最热）
            if (burning && flameRatio > 0.4) {
                this._flameGroup.add(new Konva.Line({
                    points:[fx, by, fx+swayX*0.3, by-fH*0.35, fx+swayX*0.3, by-fH*0.25, fx, by],
                    closed:true,
                    fill:`rgba(255,255,200,${(flameRatio*0.6).toFixed(2)})`,
                    stroke:'none', tension:0.3,
                }));
            }
        }

        // 火焰温度标注
        if (burning) {
            this._flameGroup.add(new Konva.Text({
                x:this._layout.burner.x+this._burnerW-10, y:by - flameH - 20,
                text:`≈${Math.round(this._tFlame)}°C`,
                fontSize:8.5, fill:'rgba(255,180,60,0.85)', fontFamily:'monospace',
            }));
        }

        // 烟气上升（燃烧室顶部）
        if (burning || extinguish) {
            for (let i=0; i<4; i++) {
                const sx = this._layout.burner.x + this._layout.burner.w*(0.20+i*0.22);
                const sy = this._layout.burner.y + 8;
                const alpha = Math.min(0.35, (this._tFlame/900)*0.40*(0.5+0.5*Math.sin(this._smokePhase+i)));
                this._flameGroup.add(new Konva.Line({
                    points:[sx, sy, sx+Math.sin(this._smokePhase+i)*6, sy-10, sx, sy-18],
                    stroke:`rgba(80,80,80,${alpha.toFixed(3)})`,
                    strokeWidth:4, lineCap:'round', tension:0.5,
                }));
            }
        }
    }

    // ───────────────────────────────────────────────────────────────────
    //  动态层：点火电火花
    // ───────────────────────────────────────────────────────────────────
    _rebuildSpark() {
        this._sparkGroup.destroyChildren();
        if (this._stage !== GWH_STAGE.SPARKING || !this._sparkOn) return;

        const ex1 = this._elecX[0];  // 点火极 X
        const ex2 = this._elecX[1];  // 检测极 X
        const ey  = this._burnerY + 2;

        // 主放电弧（点火极 → 接地，锯齿形闪电）
        const pts = this._calcLightning(ex1, ey-2, ex1+4, ey+8, 5);
        this._sparkGroup.add(new Konva.Line({
            points:pts,
            stroke:'rgba(160,200,255,0.95)',
            strokeWidth:2, lineCap:'round', lineJoin:'round',
        }));
        // 外发光晕
        this._sparkGroup.add(new Konva.Circle({
            x:ex1+2, y:ey+3, radius:8,
            fill:'rgba(100,150,255,0.25)',
        }));
        // 高压脉冲标注
        this._sparkGroup.add(new Konva.Rect({
            x:ex1-28, y:ey-22, width:56, height:14,
            fill:'rgba(10,10,30,0.85)', stroke:'rgba(80,80,200,0.6)', strokeWidth:0.5, cornerRadius:2,
        }));
        this._sparkGroup.add(new Konva.Text({
            x:ex1-26, y:ey-19,
            text:`⚡ ~10kV 放电 #${this._sparkCount}`,
            fontSize:7.5, fill:'rgba(140,170,255,0.95)', fontFamily:'monospace',
        }));

        // 离子检测极状态
        this._sparkGroup.add(new Konva.Circle({
            x:ex2, y:ey+2, radius:5,
            fill:'rgba(255,200,50,0.25)',
        }));
        this._sparkGroup.add(new Konva.Text({
            x:ex2+7, y:ey-4, text:'离子检测', fontSize:7, fill:'rgba(255,200,80,0.70)',
        }));
    }

    /**
     * 生成锯齿形闪电路径（模拟电弧放电）
     */
    _calcLightning(x1, y1, x2, y2, segments) {
        const pts = [x1, y1];
        for (let i=1; i<segments; i++) {
            const t  = i/segments;
            const px = x1 + (x2-x1)*t + (Math.random()-0.5)*10;
            const py = y1 + (y2-y1)*t + (Math.random()-0.5)*6;
            pts.push(px, py);
        }
        pts.push(x2, y2);
        return pts;
    }

    // ───────────────────────────────────────────────────────────────────
    //  动态层：水流动画
    // ───────────────────────────────────────────────────────────────────
    _rebuildWaterFlow() {
        this._flowGroup.destroyChildren();
        const W = this.width, H = this.height;
        const flowing = this._flowRate > 0.5;

        if (!flowing) return;

        const alpha = Math.min(0.75, this._flowRate / 8);

        // 冷水流动（进水管内，蓝色流动粒子）
        for (let i=0; i<5; i++) {
            const phase = ((this._waterPhase*0.6 + i*0.3) % 1.0);
            const py = H*0.21 + phase * H*0.17;
            this._flowGroup.add(new Konva.Circle({
                x:W*0.05, y:py, radius:3,
                fill:`rgba(60,140,220,${alpha.toFixed(2)})`,
            }));
        }

        // 热水流动（出水管内，红橙色）
        const hotAlpha = (this._tHotOut > 35) ? Math.min(0.75, (this._tHotOut-20)/60) : 0.20;
        for (let i=0; i<5; i++) {
            const phase = ((this._waterPhase*0.6 + i*0.3) % 1.0);
            const py = H*0.38 - phase * H*0.17;
            this._flowGroup.add(new Konva.Circle({
                x:W*0.95, y:py, radius:3,
                fill:`rgba(220,${Math.round(100 - (this._tHotOut-15)*1.2)},40,${hotAlpha.toFixed(2)})`,
            }));
        }

        // 水流传感器叶轮旋转动画
        const fcx = this._flowSensorX;
        const fcy = this._flowSensorY;
        for (let i=0; i<4; i++) {
            const ang = (this._waterPhase*4 + i*Math.PI/2);
            this._flowGroup.add(new Konva.Line({
                points:[fcx, fcy, fcx+Math.cos(ang)*5, fcy+Math.sin(ang)*5],
                stroke:`rgba(80,160,255,0.80)`,
                strokeWidth:1.5, lineCap:'round',
            }));
        }

        // 流量标注
        this._flowGroup.add(new Konva.Text({
            x:W*0.09, y:H*0.28,
            text:`${this._flowRate.toFixed(1)}L/min`,
            fontSize:8, fill:'rgba(80,160,255,0.80)', fontFamily:'monospace',
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    //  动态层：燃气阀状态
    // ───────────────────────────────────────────────────────────────────
    _rebuildValveStatus() {
        this._valveGroup.destroyChildren();

        // 主燃气电磁阀
        const valveOpen = this._gasValveOpen;
        const mx = this._mainValveX;
        const my = this._mainValveY;
        this._valveGroup.add(new Konva.Rect({
            x:mx, y:my, width:28, height:22,
            fill: valveOpen ? '#1a3a1a' : '#3a1a1a',
            stroke: valveOpen ? '#40a040' : '#a04040',
            strokeWidth: 1, cornerRadius:3,
            shadowColor: valveOpen ? '#20c020' : '#c02020',
            shadowBlur: valveOpen ? 6 : 0, shadowOpacity:0.7,
        }));
        this._valveGroup.add(new Konva.Text({
            x:mx+2, y:my+3, text: valveOpen ? '主阀\n开★' : '主阀\n关',
            fontSize:8, fill: valveOpen ? '#50e050' : '#e05050', lineHeight:1.4,
        }));

        // 比例阀开度可视化（开度条）
        const px = this._ratioValveX;
        const py = this._ratioValveY;
        const barH = Math.round(this._gasRatio * 22);
        this._valveGroup.add(new Konva.Rect({
            x:px+16, y:py+2, width:6, height:22,
            fill:'#181818', stroke:'#404040', strokeWidth:0.5, cornerRadius:1,
        }));
        if (barH > 0) {
            this._valveGroup.add(new Konva.Rect({
                x:px+16, y:py+2+(22-barH), width:6, height:barH,
                fill:`rgb(${Math.round(this._gasRatio*220)},${Math.round(120-this._gasRatio*80)},20)`,
                cornerRadius:1,
            }));
        }
        this._valveGroup.add(new Konva.Text({
            x:px+2, y:py+8, text:`比例\n${Math.round(this._gasRatio*100)}%`,
            fontSize:7, fill:'#a0a060', lineHeight:1.4,
        }));

        // 点火变压器工作状态
        const sparking = this._stage === GWH_STAGE.SPARKING;
        const itx = this._ignTransX;
        const ity = this._ignTransY;
        if (sparking && this._sparkOn) {
            this._valveGroup.add(new Konva.Rect({
                x:itx, y:ity, width:32, height:26,
                fill:'#101030', stroke:'#5050e0', strokeWidth:1.2, cornerRadius:2,
                shadowColor:'#4040ff', shadowBlur:8, shadowOpacity:0.7,
            }));
            this._valveGroup.add(new Konva.Text({
                x:itx+2, y:ity+4, text:'点火中\n⚡10kV',
                fontSize:7.5, fill:'#8080ff', lineHeight:1.5,
            }));
        }
    }

    // ───────────────────────────────────────────────────────────────────
    //  动态层：传感器数值标注
    // ───────────────────────────────────────────────────────────────────
    _rebuildSensors() {
        this._sensorGroup.destroyChildren();
        const he = this._layout.heatExch;

        // NTC 出水温度（颜色随温度变化）
        const tColor = this._tHotOut > 50 ? '#e04020' :
                       this._tHotOut > 38 ? '#d08020' :
                       this._tHotOut > 28 ? '#c0a020' : '#4090d0';
        this._sensorGroup.add(new Konva.Rect({
            x:he.x+he.w-55, y:he.y+he.h*0.38, width:50, height:16,
            fill:'rgba(8,4,0,0.82)', stroke:`rgba(${tColor.slice(1).match(/.{2}/g).map(h=>parseInt(h,16)).join(',')},0.5)`,
            strokeWidth:0.5, cornerRadius:2,
        }));
        this._sensorGroup.add(new Konva.Text({
            x:he.x+he.w-52, y:he.y+he.h*0.38+3,
            text:`出水: ${this._tHotOut.toFixed(1)}°C`,
            fontSize:8.5, fill:tColor, fontFamily:'monospace',
        }));

        // NTC 进水温度
        this._sensorGroup.add(new Konva.Text({
            x:he.x+4, y:he.y+he.h*0.38+3,
            text:`进水: ${this._tColdIn.toFixed(0)}°C`,
            fontSize:8.5, fill:'#4090d0', fontFamily:'monospace',
        }));

        // 离子传感器确认标注（BURNING 阶段）
        if (this._stage === GWH_STAGE.BURNING || this._flameConfirmed) {
            const ex2 = this._elecX[1];
            this._sensorGroup.add(new Konva.Rect({
                x:ex2-30, y:this._burnerY-18, width:60, height:12,
                fill:'rgba(0,20,0,0.85)', stroke:'rgba(40,180,40,0.6)', strokeWidth:0.5, cornerRadius:2,
            }));
            this._sensorGroup.add(new Konva.Text({
                x:ex2-28, y:this._burnerY-15,
                text:'✓ 火焰已确认（~0.8μA）',
                fontSize:7.5, fill:'#30d030', fontFamily:'monospace',
            }));
        }

        // 控制板状态文字更新
        const stageLabels = {
            [GWH_STAGE.IDLE]:         '待机',
            [GWH_STAGE.FLOW_DETECT]:  `检测水流 ${this._flowRate.toFixed(1)}L/min`,
            [GWH_STAGE.GAS_OPEN]:     '燃气阀通电开启…',
            [GWH_STAGE.SPARKING]:     `点火放电 #${this._sparkCount} / ${this._stageTimer.toFixed(1)}s`,
            [GWH_STAGE.BURNING]:      `燃烧 ${Math.round(this._gasRatio*100)}% | ${this._tHotOut.toFixed(1)}°C`,
            [GWH_STAGE.EXTINGUISHING]:'熄火中…',
            [GWH_STAGE.IGNITE_FAIL]:  'E1 点火失败！',
        };
        if (this._ctrlStatusText) {
            this._ctrlStatusText.text(`状态: ${stageLabels[this._stage] || '?'}`);
            this._ctrlStatusText.fill(
                this._stage === GWH_STAGE.IGNITE_FAIL ? '#e04040' :
                this._stage === GWH_STAGE.BURNING     ? '#30e030' :
                this._stage === GWH_STAGE.SPARKING    ? '#e0e040' : '#30c030'
            );
        }
    }

    // ───────────────────────────────────────────────────────────────────
    //  动态层：操作面板
    // ───────────────────────────────────────────────────────────────────
    _rebuildPanelDyn() {
        this._panelDynGroup.destroyChildren();
        const pn  = this._layout.panel;
        const W   = this.width;

        // 热水阀按键高亮
        const btnOn = this._waterValveOpen;
        this._panelDynGroup.add(new Konva.Rect({
            x:this._hotBtnX, y:this._tempBtnY,
            width:this._hotBtnW, height:this._tempBtnH,
            fill: btnOn ? '#1a3a1a' : '#2a1a1a',
            stroke: btnOn ? '#40c040' : '#c04040', strokeWidth:1, cornerRadius:4,
            shadowColor: btnOn ? '#30e030' : 'transparent',
            shadowBlur: btnOn ? 8 : 0, shadowOpacity:0.8,
        }));
        this._panelDynGroup.add(new Konva.Text({
            x:this._hotBtnX+2, y:this._tempBtnY+this._tempBtnH*0.20,
            width:this._hotBtnW-4, text: btnOn ? '●\n热水开' : '○\n热水关',
            fontSize:9, fill: btnOn ? '#40e040' : '#e04040',
            fontStyle:'bold', align:'center', lineHeight:1.5,
        }));

        // 数字温度显示（绿色 7-段风格）
        const dispX = pn.x + pn.w*0.30;
        const dispY = pn.y + 4;
        const dispW = pn.w*0.24;
        const dispH = pn.h - 8;
        this._panelDynGroup.add(new Konva.Text({
            x:dispX+4, y:dispY+3, width:dispW-8,
            text:`${Math.round(this._tHotOut)}°`,
            fontSize:22, fontStyle:'bold', fontFamily:'monospace',
            fill: this._stage === GWH_STAGE.BURNING ? '#30e030' : '#205020',
            align:'center',
            shadowColor: this._stage === GWH_STAGE.BURNING ? '#20c020' : 'transparent',
            shadowBlur:4, shadowOpacity:0.8,
        }));
        this._panelDynGroup.add(new Konva.Text({
            x:dispX+4, y:dispY+dispH-12, width:dispW-8,
            text:`设定:${this.setTemp}°`,
            fontSize:8, fill:'#406040', align:'center', fontFamily:'monospace',
        }));

        // 阶段指示 LED 排
        const stages = [
            { stage:GWH_STAGE.FLOW_DETECT, label:'水流', color:'#2080ff' },
            { stage:GWH_STAGE.GAS_OPEN,    label:'气阀', color:'#ff8020' },
            { stage:GWH_STAGE.SPARKING,    label:'点火', color:'#e0e040' },
            { stage:GWH_STAGE.BURNING,     label:'燃烧', color:'#ff4020' },
            { stage:GWH_STAGE.WARM,        label:'热水', color:'#30c030' },
        ];
        stages.forEach((s, i) => {
            const lx   = pn.x + pn.w*0.58 + i*(pn.w*0.08);
            const ly   = pn.y + pn.h*0.50;
            const isOn = this._stage === s.stage ||
                         (s.stage === GWH_STAGE.WARM && this._stage === GWH_STAGE.BURNING);
            this._panelDynGroup.add(new Konva.Circle({
                x:lx, y:ly, radius:4.5,
                fill: isOn ? s.color : '#1a1a1a',
                shadowColor: isOn ? s.color : 'transparent',
                shadowBlur: isOn ? 8 : 0, shadowOpacity:0.9,
            }));
            this._panelDynGroup.add(new Konva.Text({
                x:lx-8, y:ly+6, text:s.label, fontSize:7, fill:'#505060',
            }));
        });

        // 故障指示
        if (this._stage === GWH_STAGE.IGNITE_FAIL) {
            this._panelDynGroup.add(new Konva.Rect({
                x:pn.x+pn.w*0.40, y:pn.y+2, width:pn.w*0.20, height:pn.h-4,
                fill:'rgba(180,20,20,0.85)', cornerRadius:3,
            }));
            this._panelDynGroup.add(new Konva.Text({
                x:pn.x+pn.w*0.41, y:pn.y+pn.h*0.25,
                width:pn.w*0.18, text:'E1\n故障',
                fontSize:10, fontStyle:'bold', fill:'#ffffff', align:'center',
            }));
        }

        // 温度曲线（迷你）
        const cxO = pn.x + pn.w*0.02;
        const cyO = pn.y + pn.h - 2;
        const cwO = pn.w*0.27;
        const chO = pn.h - 6;
        this._panelDynGroup.add(new Konva.Rect({
            x:cxO, y:cyO-chO, width:cwO, height:chO,
            fill:'rgba(4,10,4,0.70)', stroke:'#102010', strokeWidth:0.5, cornerRadius:2,
        }));
        // setTemp 基准线
        const sty = cyO - ((this.setTemp-10)/70)*chO;
        this._panelDynGroup.add(new Konva.Line({
            points:[cxO,sty,cxO+cwO,sty],
            stroke:'rgba(50,200,50,0.35)', strokeWidth:0.7, dash:[3,2],
        }));
        const hist = this._tOutHistory, n = hist.length;
        const pts  = [];
        for (let i=0;i<n;i++) {
            pts.push(cxO+(i/(n-1))*cwO, cyO-((hist[i]-10)/70)*chO);
        }
        if (pts.length >= 4) {
            this._panelDynGroup.add(new Konva.Line({
                points:pts, stroke:'#30c030',
                strokeWidth:1.2, lineCap:'round', lineJoin:'round', tension:0.3,
            }));
        }
    }

    // ───────────────────────────────────────────────────────────────────
    //  动态层：排烟风机叶片
    // ───────────────────────────────────────────────────────────────────
    _rebuildFan(dt) {
        this._fanGroup.destroyChildren();
        if (!this._fanOn && this._fanAngle % 360 < 2) return;

        const fx = this.width * 0.92;
        const fy = this._layout.heatExch.y + this._layout.heatExch.h*0.35;
        const R  = 14;

        // 风机外圈
        this._fanGroup.add(new Konva.Circle({
            x:fx, y:fy, radius:R+4,
            fill:'#181818', stroke:'#383838', strokeWidth:1,
        }));
        // 4 片叶片
        for (let i=0;i<4;i++) {
            const ang = (this._fanAngle + i*90) * Math.PI/180;
            const bx  = fx + Math.cos(ang)*R*0.4;
            const by  = fy + Math.sin(ang)*R*0.4;
            this._fanGroup.add(new Konva.Ellipse({
                x:bx, y:by,
                radiusX:R*0.45, radiusY:R*0.20,
                rotation:this._fanAngle + i*90,
                fill:this._fanOn ? 'rgba(150,160,170,0.75)' : 'rgba(80,80,90,0.50)',
                stroke:'none',
            }));
        }
        // 轴心
        this._fanGroup.add(new Konva.Circle({
            x:fx, y:fy, radius:4,
            fill:'#505050', stroke:'#303030', strokeWidth:0.8,
        }));
        this._fanGroup.add(new Konva.Text({
            x:fx+18, y:fy-5, text:'排烟\n风机', fontSize:7, fill:'#606060',
        }));
    }

    // ═══════════════════════════════════════════════════════════════════
    //  外部操作接口
    // ═══════════════════════════════════════════════════════════════════

    /**
     * 切换热水阀（模拟用户开/关热水龙头）
     */
    toggleWaterValve() {
        if (this._waterValveOpen) {
            this.closeWaterValve();
        } else {
            this.openWaterValve();
        }
    }

    /**
     * 打开热水阀（触发自动点火序列）
     */
    openWaterValve() {
        if (this._waterValveOpen) return;
        if (this._stage === GWH_STAGE.IGNITE_FAIL) return;  // 故障未复位
        this._waterValveOpen = true;
        this._flowRate       = 0;
        this._setStage(GWH_STAGE.FLOW_DETECT);
        this.emit?.('waterValveOpen');
        this._refreshCache();
    }

    /**
     * 关闭热水阀（触发熄火序列）
     */
    closeWaterValve() {
        if (!this._waterValveOpen) return;
        this._waterValveOpen = false;
        if (this._stage === GWH_STAGE.BURNING || this._stage === GWH_STAGE.SPARKING) {
            this._setStage(GWH_STAGE.EXTINGUISHING);
        } else {
            this._flowRate = 0;
            this._setStage(GWH_STAGE.IDLE);
        }
        this.emit?.('waterValveClose');
        this._refreshCache();
    }

    /**
     * 复位故障
     */
    reset() {
        if (this._stage !== GWH_STAGE.IGNITE_FAIL) return;
        this._waterValveOpen = false;
        this._gasValveOpen   = false;
        this._gasRatio       = 0;
        this._sparkOn        = false;
        this._flowRate       = 0;
        this._tFlame         = this.ambientTemp;
        this._pidIntegral    = 0;
        this._setStage(GWH_STAGE.IDLE);
        this.emit?.('reset');
        this._refreshCache();
    }

    // ── 查询接口 ─────────────────────────────────────────────────────
    getStage()         { return this._stage; }
    getOutletTemp()    { return this._tHotOut; }
    getInletTemp()     { return this._tColdIn; }
    getFlowRate()      { return this._flowRate; }
    getGasRatio()      { return this._gasRatio; }
    getFlameTemp()     { return this._tFlame; }
    isWaterOpen()      { return this._waterValveOpen; }
    isBurning()        { return this._stage === GWH_STAGE.BURNING; }
    isSparking()       { return this._stage === GWH_STAGE.SPARKING; }
    getIgniteCount()   { return this._igniteCount; }
    getFailCount()     { return this._failCount; }

    // ═══════════════════════════════════════════════════════════════════
    //  配置字段
    // ═══════════════════════════════════════════════════════════════════
    getConfigFields() {
        return [
            { label:'位号/名称',           key:'label',        type:'text'   },
            { label:'额定热功率 (W)',       key:'ratedPower',   type:'number' },
            { label:'出水目标温度 (°C)',    key:'setTemp',      type:'number' },
            { label:'水流触发阈值 (L/min)', key:'flowThresh',   type:'number' },
            { label:'最长点火时间 (s)',     key:'maxSparkTime', type:'number' },
            { label:'环境温度 (°C)',        key:'ambientTemp',  type:'number' },
            { label:'仿真加速倍率',         key:'simScale',     type:'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label)        this.label        = cfg.label;
        if (cfg.ratedPower)   this.ratedPower   = parseFloat(cfg.ratedPower)   || this.ratedPower;
        if (cfg.setTemp)      this.setTemp      = parseFloat(cfg.setTemp)      || this.setTemp;
        if (cfg.flowThresh)   this.flowThresh   = parseFloat(cfg.flowThresh)   || this.flowThresh;
        if (cfg.maxSparkTime) this.maxSparkTime = parseFloat(cfg.maxSparkTime) || this.maxSparkTime;
        if (cfg.ambientTemp)  this.ambientTemp  = parseFloat(cfg.ambientTemp)  || this.ambientTemp;
        if (cfg.simScale)     this._simScale    = parseFloat(cfg.simScale)     || this._simScale;
        this.config = { ...this.config, ...cfg };
        this._refreshCache();
    }

    destroy() {
        super.destroy?.();
    }
}