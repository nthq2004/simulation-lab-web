import { BaseComponent } from './BaseComponent.js';

/**
 * 电吹风仿真组件
 * （Hair Dryer — 串激电机 + 电热丝 + 双金属片保护）
 *
 * ══════════════════════════════════════════════════════════════════════
 *  整机电路拓扑（四大子系统）
 * ══════════════════════════════════════════════════════════════════════
 *
 *  ┌─ 子系统 1：电源与功率回路 ──────────────────────────────────────┐
 *  │                                                                    │
 *  │  220V AC ──► 电源开关 ──► 档位切换开关                          │
 *  │           │                                                       │
 *  │           ├─► 风扇电机（串激式/罩极式交流电机）                  │
 *  │           │   · 工作原理：交变磁场在定子与转子间产生转矩         │
 *  │           │   · 调速方式：串联二极管半波整流 / 抽头电感 / 可控硅 │
 *  │           │   · 本组件采用：二极管半波整流调速（简单可靠）       │
 *  │           │                                                       │
 *  │           └─► 电热丝（镍铬合金丝，绕在云母支架上）               │
 *  │               · 低温档：串联二极管半波整流，功率减半              │
 *  │               · 高温档：全波供电，满功率                          │
 *  │               · 功率范围：800W ~ 2000W                           │
 *  └────────────────────────────────────────────────────────────────────┘
 *
 *  ┌─ 子系统 2：过热保护（双金属片温控器）──────────────────────────┐
 *  │                                                                    │
 *  │  双金属片（Bimetallic Strip）                                    │
 *  │    · 由两种热膨胀系数不同的金属贴合而成                          │
 *  │    · 常态：触点闭合（常闭型）                                    │
 *  │    · 过热时：双金属片受热弯曲 → 触点断开 → 切断加热回路         │
 *  │    · 冷却后：双金属片恢复原状 → 触点重新闭合                     │
 *  │    · 动作温度：通常 70°C ~ 90°C（出风口检测）                   │
 *  │    · 复位温度：约 50°C ~ 60°C（自动复位）                       │
 *  │                                                                    │
 *  │  一次性温度保险丝（Thermal Fuse）                                │
 *  │    · 二级保护，极端过热时永久熔断（约 120~150°C）               │
 *  │    · 本组件仿真双金属片可恢复保护                                │
 *  └────────────────────────────────────────────────────────────────────┘
 *
 *  ┌─ 子系统 3：控制回路（档位开关 + 指示灯）───────────────────────┐
 *  │                                                                    │
 *  │  档位开关（机械联动或电子开关）                                  │
 *  │    · 风扇档位：停止(0) / 低速(1) / 高速(2)                       │
 *  │    · 加热档位：关(0) / 低温(1) / 高温(2)                         │
 *  │    · 通常为联动设计，也可独立控制                                │
 *  │                                                                    │
 *  │  指示灯（LED / 氖灯）                                            │
 *  │    · 电源指示 / 加热指示                                         │
 *  └────────────────────────────────────────────────────────────────────┘
 *
 *  ┌─ 子系统 4：气路与热传递 ────────────────────────────────────────┐
 *  │                                                                    │
 *  │  风扇电机 ──► 气流 ──► 电热丝 ──► 出风口（温度/风速输出）       │
 *  │                                                                    │
 *  │  出风口温度模型：                                                 │
 *  │    T_out = T_amb + P_heat × η / (C_air × Q_air)                  │
 *  │    Q_air ∝ 电机转速（风扇档位）                                  │
 *  │                                                                    │
 *  │  热惯性：温度变化有滞后 τ ≈ 2~3 秒                               │
 *  └────────────────────────────────────────────────────────────────────┘
 *
 * ══════════════════════════════════════════════════════════════════════
 *  档位与功率关系
 * ══════════════════════════════════════════════════════════════════════
 *
 *  风扇档位：
 *    FAN_STOP  (0) → 转速 0%，无风
 *    FAN_LOW   (1) → 转速 45%，二极管半波整流（正弦波半周导通）
 *    FAN_HIGH  (2) → 转速 100%，全波供电
 *
 *  加热档位（电热丝功率）：
 *    HEAT_OFF  (0) → 功率 0%
 *    HEAT_LOW  (1) → 功率 50%（二极管半波整流，有效值减半）
 *    HEAT_HIGH (2) → 功率 100%（全波供电）
 *
 *  注意：某些电吹风风扇和加热是联动的（开加热时风扇必须运转）
 *
 * ══════════════════════════════════════════════════════════════════════
 *  双金属片保护逻辑
 * ══════════════════════════════════════════════════════════════════════
 *
 *  检测点：出风口温度（电热丝后端）
 *  动作阈值：T_trip = 85°C（典型值）
 *  复位阈值：T_reset = 55°C
 *
 *  状态机：
 *    NORMAL（正常）──[T_out ≥ T_trip]──► TRIPPED（断开保护）
 *    TRIPPED  ──[T_out ≤ T_reset]──────► NORMAL（自动复位）
 *
 *  保护触发时：
 *    · 加热电源被切断（不论加热档位如何）
 *    · 风扇仍可运转（用于吹散余热）
 *    · 指示灯闪烁/变色提示过热
 *
 * ══════════════════════════════════════════════════════════════════════
 *  绘制分层（从底到顶）
 * ══════════════════════════════════════════════════════════════════════
 *
 *  Layer 0   外壳（枪型/手柄式）
 *  Layer 1   进风口 + 风扇叶轮（动态）
 *  Layer 2   电机组件（串激电机示意）
 *  Layer 3   电热丝组件（云母支架 + 发热丝，动态发热光效）
 *  Layer 4   双金属片温控器（热响应结构）
 *  Layer 5   出风口 + 温度传感器示意
 *  Layer 6   档位开关面板 + 指示灯
 *  Layer 7   动态层：气流粒子（风速/温度颜色）
 *  Layer 8   动态层：双金属片弯曲动画
 *  Layer 9   动态层：电热丝发热光晕
 *  Layer 10  标注与原理说明文字
 *
 * ══════════════════════════════════════════════════════════════════════
 *  端口
 * ══════════════════════════════════════════════════════════════════════
 *  ac_l      — 交流火线输入（L，220V）
 *  ac_n      — 交流零线输入（N，220V）
 *  heater_pwr— 电热丝供电输出（经双金属片控制）
 *  motor_pwr — 电机供电输出（档位控制后）
 */

// ═══════════════════════════════════════════════════════════════════════
//  档位枚举
// ═══════════════════════════════════════════════════════════════════════
const FAN_SPEED = {
    STOP: 0,
    LOW:  1,
    HIGH: 2,
};

const HEAT_LEVEL = {
    OFF:  0,
    LOW:  1,
    HIGH: 2,
};

const THERMAL_STATE = {
    NORMAL:  'normal',   // 正常闭合
    TRIPPED: 'tripped',  // 过热断开
};

// ═══════════════════════════════════════════════════════════════════════
//  电吹风主类
// ═══════════════════════════════════════════════════════════════════════
export class HairDryer extends BaseComponent {

    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(280, config.width  || 320);
        this.height = Math.max(240, config.height || 300);

        this.type    = 'hair_dryer';
        this.special = 'none';
        this.cache   = 'fixed';

        this._initGroups();
        // ── 额定参数 ────────────────────────────────────────────────
        this.label          = config.label          || 'HD-8800';
        this.ratedVoltage   = config.ratedVoltage   || 220;        // V AC
        this.ratedPower     = config.ratedPower     || 1600;       // W（高温档功率）
        this.heaterResist   = config.heaterResist   || 30.25;      // Ω（P=U²/R → 1600W）
        this.motorPower     = config.motorPower     || 30;         // W 电机功率

        // ── 档位设置 ────────────────────────────────────────────────
        this._fanSpeed      = FAN_SPEED.STOP;        // 当前风扇档位
        this._heatLevel     = HEAT_LEVEL.OFF;        // 当前加热档位
        this._thermalState  = THERMAL_STATE.NORMAL;  // 双金属片状态

        // ── 保护参数 ────────────────────────────────────────────────
        this.tripTemp       = config.tripTemp       || 85;         // °C 过热动作温度
        this.resetTemp      = config.resetTemp      || 55;         // °C 复位温度
        this.thermalLag     = config.thermalLag     || 2.5;        // 秒 热响应时间

        // ── 环境参数 ────────────────────────────────────────────────
        this.ambientTemp    = config.ambientTemp    || 25;         // °C
        this.simScale       = config.simScale       || 24;         // 仿真加速

        // ── 物理状态 ────────────────────────────────────────────────
        this._outletTemp    = this.ambientTemp;      // 出风口温度 °C
        this._heaterTemp    = this.ambientTemp;      // 电热丝温度 °C（双金属片检测点）
        this._caseTemp      = this.ambientTemp;      // 外壳温度
        this._airflow       = 0;                     // 气流速度（归一化 0~1）
        this._heatPower     = 0;                     // 实际加热功率 W
        this._heaterOn      = false;                 // 加热器是否供电

        // ── 动态动画状态 ────────────────────────────────────────────
        this._fanRotorPhase = 0;                     // 风扇旋转相位
        this._fanRpm        = 0;                     // 转速（显示用）
        this._airParticles  = [];                    // 气流粒子
        this._bimetalBend   = 0;                     // 双金属片弯曲度 0~1
        this._glowIntensity  = 0;                    // 发热丝发光强度

        // ── 历史数据（温度曲线）────────────────────────────────────
        this._tempHistory   = new Array(50).fill(this.ambientTemp);
        this._histTimer     = 0;

        // ── 初始化绘制 ───────────────────────────────────────────────
        this._layout = this._calcLayout();
        this._init();

        // ── 端口 ─────────────────────────────────────────────────────
        const L = this._layout;
        this.addPort(L.body.x + 10, L.body.y + L.body.h + 4, 'ac_l',       'wire', 'L');
        this.addPort(L.body.x + 28, L.body.y + L.body.h + 4, 'ac_n',       'wire', 'N');
        this.addPort(L.body.x + 56, L.body.y + L.body.h + 4, 'heater_pwr', 'wire', 'HEAT');
        this.addPort(L.body.x + 84, L.body.y + L.body.h + 4, 'motor_pwr',  'wire', 'MOTOR');
    }

    // ═══════════════════════════════════════════════════════════════════
    //  布局计算（枪型电吹风）
    // ═══════════════════════════════════════════════════════════════════
    _calcLayout() {
        const W = this.width, H = this.height;
        return {
            // 主体（枪筒）
            body:       { x: W*0.15, y: H*0.10, w: W*0.70, h: H*0.48, rx: 20 },
            // 手柄
            handle:     { x: W*0.28, y: H*0.48, w: W*0.44, h: H*0.32, rx: 12 },
            // 进风口（后部）
            intake:     { x: W*0.12, y: H*0.20, w: W*0.08, h: H*0.28, rx: 4 },
            // 出风口（前部）
            outlet:     { x: W*0.82, y: H*0.18, w: W*0.10, h: H*0.32, rx: 6 },
            // 风扇叶轮区域
            fanZone:    { x: W*0.20, y: H*0.22, w: W*0.20, h: H*0.24 },
            // 电机区域
            motorZone:  { x: W*0.38, y: H*0.24, w: W*0.12, h: H*0.20 },
            // 电热丝区域
            heaterZone: { x: W*0.52, y: H*0.20, w: W*0.28, h: H*0.28, rx: 6 },
            // 双金属片（出风口附近）
            bimetal:    { x: W*0.74, y: H*0.15, w: W*0.12, h: H*0.08, rx: 3 },
            // 档位开关面板（手柄上）
            switchPanel:{ x: W*0.32, y: H*0.68, w: W*0.36, h: H*0.18, rx: 6 },
        };
    }

    // ═══════════════════════════════════════════════════════════════════
    //  初始化绘制
    // ═══════════════════════════════════════════════════════════════════
    _init() {
        this._drawBody();
        this._drawHandle();
        this._drawIntake();
        this._drawOutlet();
        this._drawFanStatic();
        this._drawMotorStatic();
        this._drawHeaterStatic();
        this._drawBimetalStatic();
        this._drawSwitchPanel();
        this._drawLabel();

        // 动态层
        this._fanBladeGroup = new Konva.Group();
        this._dynamicGroup.add(this._fanBladeGroup);

        this._airflowGroup = new Konva.Group();
        this._dynamicGroup.add(this._airflowGroup);

        this._heaterGlowGroup = new Konva.Group();
        this._dynamicGroup.add(this._heaterGlowGroup);

        this._bimetalGroup = new Konva.Group();
        this._dynamicGroup.add(this._bimetalGroup);

        this._indicatorGroup = new Konva.Group();
        this._dynamicGroup.add(this._indicatorGroup);

        this._initDynamicContent();
        this._bindInteraction();
    }

    // ───────────────────────────────────────────────────────────────────
    //  外壳（枪筒 + 手柄）
    // ───────────────────────────────────────────────────────────────────
    _drawBody() {
        const b = this._layout.body;
        this._staticGroup.add(new Konva.Rect({
            x: b.x, y: b.y, width: b.w, height: b.h,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: b.w, y: 0 },
            fillLinearGradientColorStops: [0, '#e0d8d0', 0.5, '#f0ece8', 1, '#e0d8d0'],
            stroke: '#b0a898', strokeWidth: 1.5, cornerRadius: b.rx,
            shadowBlur: 5, shadowColor: '#888', shadowOffsetY: 2, shadowOpacity: 0.3,
        }));
        // 装饰条纹
        this._staticGroup.add(new Konva.Rect({
            x: b.x+5, y: b.y+2, width: b.w-10, height: 3,
            fill: '#c8b280', cornerRadius: 1.5,
        }));
    }

    _drawHandle() {
        const h = this._layout.handle;
        this._staticGroup.add(new Konva.Rect({
            x: h.x, y: h.y, width: h.w, height: h.h,
            fill: '#d8d0c8', stroke: '#a09888', strokeWidth: 1.2, cornerRadius: h.rx,
        }));
        // 电源线出口
        this._staticGroup.add(new Konva.Line({
            points: [h.x+h.w/2, h.y+h.h, h.x+h.w/2, h.y+h.h+12],
            stroke: '#606060', strokeWidth: 2.5, lineCap: 'round',
        }));
        this._staticGroup.add(new Konva.Circle({
            x: h.x+h.w/2, y: h.y+h.h+12, radius: 3,
            fill: '#808080', stroke: '#505050',
        }));
    }

    _drawIntake() {
        const i = this._layout.intake;
        this._staticGroup.add(new Konva.Rect({
            x: i.x, y: i.y, width: i.w, height: i.h,
            fill: '#a0a098', stroke: '#808078', strokeWidth: 0.8, cornerRadius: i.rx,
        }));
        // 进风格栅
        for (let y = 0; y < 4; y++) {
            this._staticGroup.add(new Konva.Line({
                points: [i.x+4, i.y+8 + y*8, i.x+i.w-4, i.y+8 + y*8],
                stroke: '#606058', strokeWidth: 1,
            }));
        }
        this._staticGroup.add(new Konva.Text({ x: i.x+2, y: i.y-6, text: '进风', fontSize: 7, fill: '#606060' }));
    }

    _drawOutlet() {
        const o = this._layout.outlet;
        this._staticGroup.add(new Konva.Rect({
            x: o.x, y: o.y, width: o.w, height: o.h,
            fill: '#888888', stroke: '#707070', strokeWidth: 1, cornerRadius: o.rx,
        }));
        // 出风格栅（竖条）
        for (let i = 0; i < 5; i++) {
            this._staticGroup.add(new Konva.Line({
                points: [o.x+6 + i*5, o.y+5, o.x+6 + i*5, o.y+o.h-5],
                stroke: '#606060', strokeWidth: 1.2,
            }));
        }
        this._staticGroup.add(new Konva.Text({ x: o.x+o.w-12, y: o.y-6, text: '出风', fontSize: 7, fill: '#606060' }));
    }

    // ── 风扇叶轮（静态基底）─────────────────────────────────────────
    _drawFanStatic() {
        const fz = this._layout.fanZone;
        const cx = fz.x + fz.w/2;
        const cy = fz.y + fz.h/2;
        // 叶轮底座
        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: fz.w/2 - 2,
            fill: '#c0b8a8', stroke: '#a09888', strokeWidth: 1,
        }));
        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: fz.w/2 - 8,
            fill: '#a09888', stroke: '#888078', strokeWidth: 0.8,
        }));
    }

    // ── 电机静态 ─────────────────────────────────────────────────────
    _drawMotorStatic() {
        const mz = this._layout.motorZone;
        const cx = mz.x + mz.w/2;
        const cy = mz.y + mz.h/2;
        // 电机外壳
        this._staticGroup.add(new Konva.Rect({
            x: mz.x, y: mz.y, width: mz.w, height: mz.h,
            fill: '#506070', stroke: '#304050', strokeWidth: 1, cornerRadius: 4,
        }));
        this._staticGroup.add(new Konva.Text({ x: cx-8, y: cy-4, text: 'M', fontSize: 10, fill: '#a0c0e0', fontStyle: 'bold' }));
        // 电机轴示意
        this._staticGroup.add(new Konva.Line({ points: [cx, cy, cx+15, cy], stroke: '#c0c0c0', strokeWidth: 2 }));
    }

    // ── 电热丝静态（云母支架）───────────────────────────────────────
    _drawHeaterStatic() {
        const hz = this._layout.heaterZone;
        // 云母片支架
        this._staticGroup.add(new Konva.Rect({
            x: hz.x, y: hz.y, width: hz.w, height: hz.h,
            fill: '#d0c8b0', stroke: '#b0a888', strokeWidth: 1, cornerRadius: hz.rx,
        }));
        // 电热丝（波纹状）
        for (let i = 0; i < 8; i++) {
            const y = hz.y + 6 + i * (hz.h-12)/7;
            this._staticGroup.add(new Konva.Line({
                points: [hz.x+6, y, hz.x+12, y-2, hz.x+18, y, hz.x+24, y-2, hz.x+30, y, hz.x+hz.w-6, y-1],
                stroke: '#c86020', strokeWidth: 2, tension: 0.2,
            }));
        }
        this._staticGroup.add(new Konva.Text({ x: hz.x+4, y: hz.y-6, text: '电热丝 (Ni-Cr)', fontSize: 7, fill: '#a06020' }));
    }

    // ── 双金属片静态 ─────────────────────────────────────────────────
    _drawBimetalStatic() {
        const bm = this._layout.bimetal;
        // 外壳
        this._staticGroup.add(new Konva.Rect({
            x: bm.x, y: bm.y, width: bm.w, height: bm.h,
            fill: '#a0a0a0', stroke: '#808080', strokeWidth: 0.8, cornerRadius: bm.rx,
        }));
        this._staticGroup.add(new Konva.Text({ x: bm.x+2, y: bm.y+2, text: '双金属片', fontSize: 6, fill: '#404040' }));
        // 触点示意
        this._staticGroup.add(new Konva.Circle({ x: bm.x+bm.w-6, y: bm.y+bm.h/2, radius: 2.5, fill: '#d0a030' }));
        this._staticGroup.add(new Konva.Circle({ x: bm.x+bm.w-12, y: bm.y+bm.h/2, radius: 2, fill: '#c0c0c0' }));
    }

    // ── 档位开关面板 ─────────────────────────────────────────────────
    _drawSwitchPanel() {
        const sp = this._layout.switchPanel;
        this._staticGroup.add(new Konva.Rect({
            x: sp.x, y: sp.y, width: sp.w, height: sp.h,
            fill: '#302820', stroke: '#504030', strokeWidth: 1, cornerRadius: sp.rx,
        }));

        // 风扇档位开关（三档滑动）
        this._fanSlider = new Konva.Rect({
            x: sp.x+10, y: sp.y+12, width: sp.w-20, height: 6,
            fill: '#504030', cornerRadius: 3,
        });
        this._fanKnob = new Konva.Circle({
            x: sp.x+10, y: sp.y+15, radius: 8,
            fill: '#c0a060', stroke: '#a08040', strokeWidth: 1,
            draggable: true,
        });
        this._staticGroup.add(this._fanSlider, this._fanKnob);

        // 加热档位开关（两档/三档）
        this._heatSlider = new Konva.Rect({
            x: sp.x+10, y: sp.y+36, width: sp.w-20, height: 6,
            fill: '#504030', cornerRadius: 3,
        });
        this._heatKnob = new Konva.Circle({
            x: sp.x+10, y: sp.y+39, radius: 8,
            fill: '#c06030', stroke: '#a04020', strokeWidth: 1,
            draggable: true,
        });
        this._staticGroup.add(this._heatSlider, this._heatKnob);

        // 档位标注
        this._staticGroup.add(new Konva.Text({ x: sp.x+5, y: sp.y+2, text: '风速', fontSize: 7, fill: '#c0a060' }));
        this._staticGroup.add(new Konva.Text({ x: sp.x+5, y: sp.y+26, text: '温度', fontSize: 7, fill: '#c08060' }));
        this._staticGroup.add(new Konva.Text({ x: sp.x+12, y: sp.y+22, text: '○ 低 高', fontSize: 6, fill: '#907050' }));
        this._staticGroup.add(new Konva.Text({ x: sp.x+12, y: sp.y+46, text: '○ 低 高', fontSize: 6, fill: '#907050' }));

        // 指示灯
        this._powerLed = new Konva.Circle({
            x: sp.x+sp.w-12, y: sp.y+8, radius: 3.5,
            fill: '#202020', stroke: '#404040',
        });
        this._heatLed = new Konva.Circle({
            x: sp.x+sp.w-12, y: sp.y+sp.h-10, radius: 3.5,
            fill: '#202020', stroke: '#404040',
        });
        this._staticGroup.add(this._powerLed, this._heatLed);
    }

    // 动态层初始化
    _initDynamicContent() {
        this._rebuildFanBlades();
        this._rebuildBimetal();
        this._updateIndicators();
    }

    // 风扇叶片动态（旋转）
    _rebuildFanBlades() {
        this._fanBladeGroup.destroyChildren();
        const fz = this._layout.fanZone;
        const cx = fz.x + fz.w/2;
        const cy = fz.y + fz.h/2;
        const r = fz.w/2 - 10;

        const rpm = this._fanRpm;
        const phase = this._fanRotorPhase;

        // 4 片叶片
        for (let i = 0; i < 4; i++) {
            const angle = phase + (i * Math.PI * 2 / 4);
            const x1 = cx + Math.cos(angle) * r * 0.5;
            const y1 = cy + Math.sin(angle) * r * 0.5;
            const x2 = cx + Math.cos(angle + 0.6) * r;
            const y2 = cy + Math.sin(angle + 0.6) * r;
            const x3 = cx + Math.cos(angle - 0.6) * r;
            const y3 = cy + Math.sin(angle - 0.6) * r;

            this._fanBladeGroup.add(new Konva.Line({
                points: [cx, cy, x2, y2, x3, y3, cx, cy],
                fill: `rgba(160,140,110,${0.5 + rpm*0.3})`,
                stroke: '#a08868', strokeWidth: 0.5,
                closed: true,
            }));
        }
        // 轴心
        this._fanBladeGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: 6,
            fill: '#888078', stroke: '#706860', strokeWidth: 0.8,
        }));
    }

    // 双金属片动态（弯曲动画）
    _rebuildBimetal() {
        this._bimetalGroup.destroyChildren();
        const bm = this._layout.bimetal;
        const bend = this._bimetalBend;  // 0~1，弯曲度

        // 双金属片弯曲变形（用路径表示）
        const startX = bm.x + 5;
        const startY = bm.y + bm.h/2;
        const endX = bm.x + bm.w - 8;
        const endY = bm.y + bm.h/2 + bend * 8;

        this._bimetalGroup.add(new Konva.Line({
            points: [startX, startY, endX, endY],
            stroke: '#c0a060', strokeWidth: 4, lineCap: 'round',
            shadowBlur: bend > 0.5 ? 4 : 0,
            shadowColor: '#ff6020',
        }));

        // 触点状态
        const isTripped = this._thermalState === THERMAL_STATE.TRIPPED;
        this._bimetalGroup.add(new Konva.Circle({
            x: endX, y: endY, radius: 3,
            fill: isTripped ? '#ff3030' : '#30ff30',
            stroke: '#fff', strokeWidth: 0.5,
        }));
        this._bimetalGroup.add(new Konva.Circle({
            x: bm.x+bm.w-6, y: bm.y+bm.h/2, radius: 2.5,
            fill: '#c0c0c0', stroke: '#888',
        }));

        // 状态文字
        this._bimetalGroup.add(new Konva.Text({
            x: bm.x+bm.w+4, y: bm.y-2,
            text: isTripped ? '过热断开!' : '正常闭合',
            fontSize: 7, fill: isTripped ? '#ff6060' : '#60c060',
            fontFamily: 'monospace',
        }));
    }

    // 指示灯更新
    _updateIndicators() {
        if (!this._powerLed) return;
        const isOn = this._fanSpeed !== FAN_SPEED.STOP;
        const heating = this._heatLevel !== HEAT_LEVEL.OFF && this._thermalState === THERMAL_STATE.NORMAL;

        this._powerLed.fill(isOn ? '#00ff40' : '#202020');
        this._powerLed.shadowBlur(isOn ? 6 : 0);
        this._powerLed.shadowColor(isOn ? '#00ff40' : 'transparent');

        this._heatLed.fill(heating ? '#ff4040' : '#202020');
        this._heatLed.shadowBlur(heating ? 6 : 0);
        this._heatLed.shadowColor(heating ? '#ff4040' : 'transparent');
    }

    // 电热丝发光效果
    _updateHeaterGlow() {
        this._heaterGlowGroup.destroyChildren();
        const hz = this._layout.heaterZone;
        const glow = this._glowIntensity;

        if (glow > 0.05) {
            const alpha = Math.min(0.65, glow * 0.8);
            this._heaterGlowGroup.add(new Konva.Rect({
                x: hz.x-2, y: hz.y-2, width: hz.w+4, height: hz.h+4,
                fill: `rgba(255,80,20,${alpha})`,
                cornerRadius: hz.rx+2,
                shadowBlur: 15, shadowColor: '#ff6020',
            }));
            // 发热丝高亮
            for (let i = 0; i < 8; i++) {
                const y = hz.y + 6 + i * (hz.h-12)/7;
                this._heaterGlowGroup.add(new Konva.Line({
                    points: [hz.x+6, y, hz.x+hz.w-6, y],
                    stroke: `rgba(255,200,80,${0.4+glow*0.5})`,
                    strokeWidth: 3,
                }));
            }
        }
    }

    // 气流粒子效果（动态）
    _updateAirflow() {
        this._airflowGroup.destroyChildren();
        if (this._airflow <= 0.05) return;

        const outlet = this._layout.outlet;
        const cx = outlet.x + outlet.w - 4;
        const cy = outlet.y + outlet.h/2;

        const particleCount = Math.floor(12 * this._airflow);
        const tempFactor = Math.max(0, (this._outletTemp - this.ambientTemp) / 80);

        for (let i = 0; i < particleCount; i++) {
            const offX = 5 + Math.random() * 25 * this._airflow;
            const offY = (Math.random() - 0.5) * 20 * this._airflow;
            const alpha = 0.4 + Math.random() * 0.5;
            const color = tempFactor > 0.6 ? '#ff6040' : (tempFactor > 0.3 ? '#ffa040' : '#80c0ff');
            this._airflowGroup.add(new Konva.Circle({
                x: cx + offX, y: cy + offY,
                radius: 1.5 + Math.random() * 2,
                fill: color,
                opacity: alpha,
            }));
        }

        // 热浪扭曲效果（高温时）
        if (tempFactor > 0.5) {
            for (let i = 0; i < 3; i++) {
                this._airflowGroup.add(new Konva.Line({
                    points: [cx+10, cy-8 + i*8, cx+30, cy-5 + i*8 + Math.sin(Date.now()*0.01)*3],
                    stroke: `rgba(255,160,80,0.3)`,
                    strokeWidth: 2, tension: 0.5,
                }));
            }
        }
    }

    // 档位旋钮交互
    _bindInteraction() {
        setTimeout(() => {
            if (this._fanKnob) {
                this._fanKnob.on('dragmove', (e) => {
                    const sp = this._layout.switchPanel;
                    const minX = sp.x + 10;
                    const maxX = sp.x + sp.w - 20;
                    let x = e.target.x();
                    x = Math.min(maxX, Math.max(minX, x));
                    e.target.x(x);
                    // 根据位置计算档位
                    const t = (x - minX) / (maxX - minX);
                    if (t < 0.33) this.setFanSpeed(FAN_SPEED.STOP);
                    else if (t < 0.66) this.setFanSpeed(FAN_SPEED.LOW);
                    else this.setFanSpeed(FAN_SPEED.HIGH);
                });
            }
            if (this._heatKnob) {
                this._heatKnob.on('dragmove', (e) => {
                    const sp = this._layout.switchPanel;
                    const minX = sp.x + 10;
                    const maxX = sp.x + sp.w - 20;
                    let x = e.target.x();
                    x = Math.min(maxX, Math.max(minX, x));
                    e.target.x(x);
                    const t = (x - minX) / (maxX - minX);
                    if (t < 0.33) this.setHeatLevel(HEAT_LEVEL.OFF);
                    else if (t < 0.66) this.setHeatLevel(HEAT_LEVEL.LOW);
                    else this.setHeatLevel(HEAT_LEVEL.HIGH);
                });
            }
        }, 80);
    }

    // 设置旋钮位置
    _updateKnobPositions() {
        if (!this._fanKnob || !this._heatKnob) return;
        const sp = this._layout.switchPanel;
        const minX = sp.x + 10;
        const maxX = sp.x + sp.w - 20;
        const fanMap = { [FAN_SPEED.STOP]: 0.15, [FAN_SPEED.LOW]: 0.5, [FAN_SPEED.HIGH]: 0.85 };
        const heatMap = { [HEAT_LEVEL.OFF]: 0.15, [HEAT_LEVEL.LOW]: 0.5, [HEAT_LEVEL.HIGH]: 0.85 };
        this._fanKnob.x(minX + fanMap[this._fanSpeed] * (maxX - minX));
        this._heatKnob.x(minX + heatMap[this._heatLevel] * (maxX - minX));
    }

    // ───────────────────────────────────────────────────────────────────
    //  标注
    // ───────────────────────────────────────────────────────────────────
    _drawLabel() {
        this._staticGroup.add(new Konva.Text({
            x: 0, y: -16, width: this.width,
            text: `${this.label}  电吹风  ${this.ratedPower/1000}kW  ${this.ratedVoltage}V`,
            fontSize: 9, fontStyle: 'bold', fill: '#5a6a7a', align: 'center',
        }));
    }

    // ═══════════════════════════════════════════════════════════════════
    //  Tick — 主仿真循环
    // ═══════════════════════════════════════════════════════════════════
    tick(dt) {
        this._tickPhysics(dt);
        this._tickThermalProtection(dt);
        this._tickAnimations(dt);
        this._updateDynamicLayers();
        this._refreshCache();
    }

    // 物理模型：风扇转速、加热功率、出风口温度
    _tickPhysics(dt) {
        const sdt = dt * this.simScale;

        // ── 风扇转速与风量 ──────────────────────────────────────────
        let targetRpm = 0;
        switch (this._fanSpeed) {
            case FAN_SPEED.LOW:  targetRpm = 0.45; break;
            case FAN_SPEED.HIGH: targetRpm = 1.0; break;
            default: targetRpm = 0;
        }
        // 电机惯性（加速/减速平滑）
        this._fanRpm += (targetRpm - this._fanRpm) * 0.15 * sdt;
        this._airflow = this._fanRpm;  // 风量正比于转速

        // ── 加热功率计算（考虑双金属片保护）─────────────────────────
        const heatSelected = this._heatLevel;
        let basePower = 0;
        if (heatSelected === HEAT_LEVEL.LOW) {
            basePower = this.ratedPower * 0.5;   // 半波整流，功率减半
        } else if (heatSelected === HEAT_LEVEL.HIGH) {
            basePower = this.ratedPower;         // 全功率
        }

        // 双金属片保护：过热时切断加热
        const heatingEnabled = (this._thermalState === THERMAL_STATE.NORMAL);
        this._heaterOn = (basePower > 0) && heatingEnabled;
        this._heatPower = this._heaterOn ? basePower : 0;

        // ── 电热丝温度（热惯性）─────────────────────────────────────
        // 加热功率使温度上升，风量使温度下降
        const P_heat = this._heatPower;
        const coolingRate = 0.012 * (this._heaterTemp - this.ambientTemp);
        const forcedCooling = this._airflow * 0.025 * (this._heaterTemp - this.ambientTemp);
        let dT_heater = (P_heat * 0.0008 - coolingRate - forcedCooling) * sdt;
        this._heaterTemp += dT_heater;
        this._heaterTemp = Math.max(this.ambientTemp, Math.min(180, this._heaterTemp));

        // ── 出风口温度（滞后于电热丝）───────────────────────────────
        const targetOutlet = this.ambientTemp + (this._heaterTemp - this.ambientTemp) * 0.7;
        this._outletTemp += (targetOutlet - this._outletTemp) * 0.12 * sdt;

        // 温度历史记录
        this._histTimer += dt;
        if (this._histTimer >= 0.5) {
            this._histTimer = 0;
            this._tempHistory.shift();
            this._tempHistory.push(this._outletTemp);
        }
    }

    // 双金属片过热保护逻辑
    _tickThermalProtection(dt) {
        const sdt = dt * this.simScale;
        const temp = this._heaterTemp;  // 检测电热丝附近温度

        if (this._thermalState === THERMAL_STATE.NORMAL) {
            if (temp >= this.tripTemp) {
                this._thermalState = THERMAL_STATE.TRIPPED;
                this.emit?.('protection', { state: 'tripped', temp: temp });
            }
        } else {
            if (temp <= this.resetTemp) {
                this._thermalState = THERMAL_STATE.NORMAL;
                this.emit?.('protection', { state: 'reset', temp: temp });
            }
        }

        // 双金属片弯曲度（温度比例）
        const tripRange = this.tripTemp - this.resetTemp;
        if (temp <= this.resetTemp) this._bimetalBend = 0;
        else if (temp >= this.tripTemp) this._bimetalBend = 1;
        else this._bimetalBend = (temp - this.resetTemp) / tripRange;
    }

    // 动画更新
    _tickAnimations(dt) {
        // 风扇旋转（转速决定角速度）
        const speedFactor = this._fanRpm;
        this._fanRotorPhase += dt * 12 * speedFactor;  // 弧度/秒
        if (this._fanRotorPhase > Math.PI * 2) this._fanRotorPhase -= Math.PI * 2;

        // 发热丝发光强度（正比于加热功率）
        const targetGlow = this._heaterOn ? (this._heatPower / this.ratedPower) : 0;
        this._glowIntensity += (targetGlow - this._glowIntensity) * 0.2;
    }

    _updateDynamicLayers() {
        this._rebuildFanBlades();
        this._rebuildBimetal();
        this._updateHeaterGlow();
        this._updateAirflow();
        this._updateIndicators();
        this._updateKnobPositions();

        // 在面板上显示温度信息
        const sp = this._layout.switchPanel;
        if (!this._tempDisplay) {
            this._tempDisplay = new Konva.Text({
                x: sp.x+5, y: sp.y+sp.h-14,
                fontSize: 8, fill: '#e0a060', fontFamily: 'monospace',
            });
            this._staticGroup.add(this._tempDisplay);
        }
        const protectMark = this._thermalState === THERMAL_STATE.TRIPPED ? '⚠过热保护 ' : '';
        this._tempDisplay.text(`${protectMark}风口:${Math.round(this._outletTemp)}°C  热丝:${Math.round(this._heaterTemp)}°C`);
        this._tempDisplay.x(sp.x+5);
        this._tempDisplay.y(sp.y+sp.h-14);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  外部控制接口
    // ═══════════════════════════════════════════════════════════════════
    setFanSpeed(speed) {
        if (speed === FAN_SPEED.STOP || speed === FAN_SPEED.LOW || speed === FAN_SPEED.HIGH) {
            this._fanSpeed = speed;
            // 安全逻辑：如果风扇停止，加热应自动关闭（防止干烧）
            if (speed === FAN_SPEED.STOP && this._heatLevel !== HEAT_LEVEL.OFF) {
                this._heatLevel = HEAT_LEVEL.OFF;
                this._updateKnobPositions();
            }
        }
    }

    setHeatLevel(level) {
        if (level === HEAT_LEVEL.OFF || level === HEAT_LEVEL.LOW || level === HEAT_LEVEL.HIGH) {
            // 安全逻辑：风扇停止时不允许开启加热
            if (level !== HEAT_LEVEL.OFF && this._fanSpeed === FAN_SPEED.STOP) {
                return;
            }
            this._heatLevel = level;
        }
    }

    // 手动复位双金属片（模拟冷却后自动复位，但提供手动接口）
    resetThermalProtection() {
        this._thermalState = THERMAL_STATE.NORMAL;
        this._bimetalBend = 0;
    }

    // 查询接口
    getFanSpeed()       { return this._fanSpeed; }
    getHeatLevel()      { return this._heatLevel; }
    getOutletTemp()     { return this._outletTemp; }
    getHeaterTemp()     { return this._heaterTemp; }
    getAirflow()        { return this._airflow; }
    getHeatPower()      { return this._heatPower; }
    isOverheated()      { return this._thermalState === THERMAL_STATE.TRIPPED; }
    getThermalState()   { return this._thermalState; }

    // ═══════════════════════════════════════════════════════════════════
    //  配置字段
    // ═══════════════════════════════════════════════════════════════════
    getConfigFields() {
        return [
            { label: '型号/名称',        key: 'label',        type: 'text'   },
            { label: '额定电压 (V)',      key: 'ratedVoltage', type: 'number' },
            { label: '额定功率 (W)',      key: 'ratedPower',   type: 'number' },
            { label: '过热动作温度 (°C)', key: 'tripTemp',     type: 'number' },
            { label: '复位温度 (°C)',     key: 'resetTemp',    type: 'number' },
            { label: '热响应时间 (s)',    key: 'thermalLag',   type: 'number' },
            { label: '环境温度 (°C)',     key: 'ambientTemp',  type: 'number' },
            { label: '仿真加速倍率',      key: 'simScale',     type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label)         this.label        = cfg.label;
        if (cfg.ratedPower)    this.ratedPower   = parseFloat(cfg.ratedPower)   || this.ratedPower;
        if (cfg.tripTemp)      this.tripTemp     = parseFloat(cfg.tripTemp)     || this.tripTemp;
        if (cfg.resetTemp)     this.resetTemp    = parseFloat(cfg.resetTemp)    || this.resetTemp;
        if (cfg.thermalLag)    this.thermalLag   = parseFloat(cfg.thermalLag)   || this.thermalLag;
        if (cfg.ambientTemp)   this.ambientTemp  = parseFloat(cfg.ambientTemp)  || this.ambientTemp;
        if (cfg.simScale)      this.simScale     = parseFloat(cfg.simScale)     || this.simScale;
        this.config = { ...this.config, ...cfg };
        this._refreshCache();
    }

    destroy() {
        super.destroy?.();
    }
}