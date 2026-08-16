import { BaseComponent } from './BaseComponent.js';

/**
 * 双金属片温控电饭煲仿真组件
 * （Rice Cooker — Bimetallic Thermostat Type）
 *
 * ══════════════════════════════════════════════════════════════════════
 *  适用范围说明
 * ══════════════════════════════════════════════════════════════════════
 *
 *  本组件仿真的是"第三种"电饭煲结构：
 *    ✗ 磁钢限温器（传统按键跳闸型）
 *    ✗ IH 电磁感应加热
 *    ✓ 双金属片温控器（Bimetallic Thermostat）
 *
 *  典型产品：东芝早期型号、部分国产家用 2~3L 小电饭煲、
 *            电热饭盒、简易电热保温盘。
 *  特点：结构比磁钢型更简单（无弹片锁扣机构），
 *        通过双金属片的热变形直接驱动微动开关，
 *        实现"煮饭→保温"的自动切换，且可在保温区间
 *        反复通断，形成闭环恒温控制。
 *
 * ══════════════════════════════════════════════════════════════════════
 *  核心部件结构
 * ══════════════════════════════════════════════════════════════════════
 *
 *  1. 外壳与内胆（Housing & Inner Pot）
 *     - 外壳：喷漆钢板，底部设散热孔
 *     - 内胆：铝合金冲压，内涂不粘层
 *     - 内胆底面与加热盘紧密接触（无气隙）
 *
 *  2. 电热盘（Heating Plate，约 500~700W）
 *     - 电热管铸入铝盘，盘面平整
 *     - 中央凸台安装双金属片温控器
 *
 *  3. 双金属片温控器（Bimetallic Thermostat）← 全文核心
 *
 *     ┌──────────────────────────────────────────────────────────────┐
 *     │  结构（从下到上）：                                           │
 *     │                                                               │
 *     │  固定底座（螺钉固定在加热盘凸台上）                           │
 *     │  └── 双金属片（Bimetal Strip）                               │
 *     │       · 下层：因瓦合金（Invar，Fe-Ni 36%）                   │
 *     │               热膨胀系数 α₁ ≈ 1.5×10⁻⁶ /K（极低）           │
 *     │       · 上层：黄铜（Brass，Cu-Zn）                           │
 *     │               热膨胀系数 α₂ ≈ 18×10⁻⁶ /K（高）              │
 *     │       · 两层冶金焊合，不可分离                                │
 *     │  └── 动触点（固定在弹片自由端）                               │
 *     │  └── 静触点（固定在上方接线柱，不动）                        │
 *     │  └── 调温螺钉（拨动静触点高度 → 改变动作温度）               │
 *     │                                                               │
 *     │  工作原理：                                                   │
 *     │                                                               │
 *     │  ① 常温（T < T_close）：                                     │
 *     │     双金属片平直 → 动触点贴合静触点 → 电路闭合              │
 *     │     → 加热盘全功率通电（主加热回路）                          │
 *     │                                                               │
 *     │  ② 升温 → 沸腾（T ≈ 100°C）：                               │
 *     │     双金属片受热，黄铜膨胀量 >> 因瓦合金                      │
 *     │     → 片体向因瓦侧（下方）弯曲                                │
 *     │     → 动触点下移，但静触点仍在接触范围内                     │
 *     │     → 电路保持闭合（水的相变锁温保护）                       │
 *     │                                                               │
 *     │  ③ 水干 → 温度突破 T_open（约 125~145°C）：                 │
 *     │     弯曲量超过触点接触行程 → 动触点脱开静触点               │
 *     │     → 主加热电路断开                                         │
 *     │     → 保温加热器（并联小功率加热元件）接通                   │
 *     │                                                               │
 *     │  ④ 保温冷却（T < T_close，约 65~80°C）：                    │
 *     │     双金属片冷却复原 → 动触点重新接触静触点                  │
 *     │     → 主加热电路重新闭合 → 再次加热                         │
 *     │     → 在 T_close ↔ T_open 之间反复通断（闭环恒温）          │
 *     │                                                               │
 *     │  关键参数：                                                   │
 *     │    · 动作温度差（Differential）= T_open − T_close            │
 *     │    · 典型值：保温段 ΔT ≈ 15~25°C                            │
 *     │    · 响应时间：约 30~120s（取决于双金属片厚度和热容）         │
 *     └──────────────────────────────────────────────────────────────┘
 *
 *  4. 保温加热器（Warm Heater，约 30~50W）
 *     - 与主加热盘并联，串联保温专用双金属片（较薄，响应快）
 *     - 主触点断开后，保温加热器独立维持温度
 *     - 也可以是 PTC 自限温元件（部分型号）
 *
 *  5. 操作旋钮（Rotary Switch）
 *     - 三档：OFF（断电）/ COOK（煮饭，接主加热盘）/ WARM（强制保温）
 *     - 无需按键锁扣，靠旋钮维持通断
 *
 * ══════════════════════════════════════════════════════════════════════
 *  与其他类型的区别对比
 * ══════════════════════════════════════════════════════════════════════
 *
 *  ┌──────────────┬────────────────┬────────────────┬────────────────┐
 *  │ 特性         │ 磁钢限温器     │ 双金属片温控   │ IH 智能型      │
 *  ├──────────────┼────────────────┼────────────────┼────────────────┤
 *  │ 切换方式     │ 一次性弹起     │ 反复通断       │ PWM 占空比     │
 *  │ 温控精度     │ ±5°C          │ ±10~20°C       │ ±1°C          │
 *  │ 动作机构     │ 永磁铁+弹片   │ 双金属片弯曲   │ MCU+IGBT       │
 *  │ 操作方式     │ 机械按键       │ 旋转选择钮     │ 数字面板       │
 *  │ 保温方式     │ 独立保温加热器 │ 主盘闭环通断   │ 低占空比闭环   │
 *  │ 结构复杂度   │ 中             │ 低             │ 高             │
 *  │ 成本         │ 低             │ 极低           │ 高             │
 *  └──────────────┴────────────────┴────────────────┴────────────────┘
 *
 * ══════════════════════════════════════════════════════════════════════
 *  温控状态机（双金属片闭环通断）
 * ══════════════════════════════════════════════════════════════════════
 *
 *  旋钮 OFF：
 *    → 所有电路断开，自然冷却
 *
 *  旋钮 COOK：
 *    HEATING（主加热，触点闭合）
 *      → 水沸腾，相变锁温 ~100°C
 *      → 水干，温度突破 T_open（约 135°C）
 *      → 双金属片弯曲，动触点脱开
 *    TRIPPED（触点断开）
 *      → 保温加热器接通，温度缓慢下降
 *      → T 降至 T_close（约 80°C）
 *      → 双金属片复原，动触点重新接触
 *    → 回到 HEATING，开始新一轮循环
 *
 *  旋钮 WARM（强制保温）：
 *    → 旋钮直接接保温加热器回路
 *    → 双金属片同样在 T_close~T_open 间闭环通断
 *    → 维持温度约 65~80°C
 *
 * ══════════════════════════════════════════════════════════════════════
 *  双金属片弯曲物理模型
 * ══════════════════════════════════════════════════════════════════════
 *
 *  弯曲挠度（中点位移）近似公式（Timoshenko 双金属片理论）：
 *
 *    δ = (3/2) × (α₂ − α₁) × (T − T₀) × L² / h
 *
 *  其中：
 *    α₂ − α₁ = 16.5×10⁻⁶ /K（黄铜 − 因瓦合金差值）
 *    T₀       = 参考温度（室温 25°C）
 *    L        = 双金属片悬臂长度（仿真中 = 30px）
 *    h        = 双金属片总厚度（仿真中 = 2.5px）
 *    δ        = 自由端挠度（px），触点接触/断开由 δ vs δ_gap 判断
 *
 *  δ_gap（触点间隙）= δ(T_open) 时的挠度
 *  当 δ > δ_gap → 动触点脱开静触点 → 电路断开
 *  当 δ < δ_gap × 0.60 → 复原闭合（滞差 40%）
 *
 *  仿真简化：
 *    deflection(T) = clamp((T − 25) / 130, 0, 1) × maxDeflection
 *    触点状态由 deflection 与 gapThreshold（T_open 归一化）比较
 *
 * ══════════════════════════════════════════════════════════════════════
 *  绘制分层（从底到顶）
 * ══════════════════════════════════════════════════════════════════════
 *
 *  Layer 0   底座（base）
 *  Layer 1   外壳主体（housing）
 *  Layer 2   加热盘（heatingPlate）含 _heaterGlow（动态）
 *  Layer 3   内胆（pot）含 _waterGroup（动态）
 *  Layer 4   锅盖（lid）
 *  Layer 5   _bimetalGroup  — 双金属片机构（动态重绘，tick 驱动）
 *  Layer 6   _contactGroup  — 触点 + 间隙（动态重绘，tick 驱动）
 *  Layer 7   _panelGroup    — 面板 + 旋钮 + LED（动态重绘，tick 驱动）
 *  Layer 8   _wireGroup     — 电路接线示意（动态颜色）
 *  Layer 9   标注文字
 *
 * ══════════════════════════════════════════════════════════════════════
 *  端口
 * ══════════════════════════════════════════════════════════════════════
 *  power_l    — 火线输入（L，220V）
 *  power_n    — 零线输入（N，220V）
 *  heater_out — 主加热盘输出（主回路）
 *  warm_out   — 保温加热器输出（辅回路）
 */

// ═══════════════════════════════════════════════════════════════════════
//  旋钮档位枚举
// ═══════════════════════════════════════════════════════════════════════
const KNOB = {
    OFF:  'off',
    COOK: 'cook',
    WARM: 'warm',
};

// ═══════════════════════════════════════════════════════════════════════
//  温控子状态枚举（仅在 COOK / WARM 档下有效）
// ═══════════════════════════════════════════════════════════════════════
const TC_STATE = {
    CLOSED:   'closed',   // 双金属片触点闭合（主加热通电）
    TRIPPING: 'tripping', // 触点断开动画进行中（约 250ms）
    OPEN:     'open',     // 触点断开（保温加热器通电）
    CLOSING:  'closing',  // 触点复原动画进行中（约 400ms）
};

// ═══════════════════════════════════════════════════════════════════════
//  双金属片温控电饭煲主类
// ═══════════════════════════════════════════════════════════════════════
export class BimetallicRiceCooker extends BaseComponent {

    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(260, config.width  || 300);
        this.height = Math.max(380, config.height || 430);

        this.type    = 'bimetallic_rice_cooker';
        this.special = 'none';
        this.cache   = 'fixed';

        this._initGroups();
        // ── 额定参数 ────────────────────────────────────────────────
        this.label        = config.label        || 'BRC';
        this.ratedVoltage = config.ratedVoltage || 220;   // V
        this.cookPower    = config.cookPower    || 600;   // W，主加热盘
        this.warmPower    = config.warmPower    || 40;    // W，保温加热器
        this.ambientTemp  = config.ambientTemp  || 25;    // °C

        // 双金属片参数
        // T_open：动触点脱开温度（触点断开）
        this.tOpen        = config.tOpen        || 135;   // °C
        // T_close：动触点复原温度（触点重新闭合）
        this.tClose       = config.tClose       || 78;    // °C
        // 最大挠度（px，对应 tOpen 时的形变量）
        this._maxDeflect  = 14;

        // 仿真加速倍率
        this._simScale    = config.simScale     || 34;

        // ── 物理状态 ────────────────────────────────────────────────
        this._knob        = KNOB.OFF;
        this._tcState     = TC_STATE.OPEN;   // 默认触点断开（冷态下无意义）
        this._temperature = this.ambientTemp;
        this._waterLevel  = config.waterLevel !== undefined
                            ? Number(config.waterLevel) : 1.0;
        this._cookProg    = 0;
        this._cycleCount  = 0;  // 双金属片通断循环次数
        this._cookCount   = config.initCookCount || 0;

        // 双金属片几何状态
        this._deflection  = 0;          // 当前挠度 px（0=平直，_maxDeflect=最大弯曲）
        this._deflTarget  = 0;          // 目标挠度（物理计算值）
        this._contactGap  = 0;          // 触点间隙 px（>0 = 断开）

        // 触点动画
        this._tcAnim = {
            animating: false,
            animT:     0,
            animDir:   1,   // +1=断开，-1=复原
            animDur:   0.25,
        };

        // 旋钮动画角度（°）
        this._knobAngle   = -90;   // OFF = -90°，COOK = 0°，WARM = +90°
        this._knobTarget  = -90;
        this._knobAnimT   = 0;
        this._knobAnimDur = 0.18;
        this._knobAnimating = false;

        // 温度历史
        this._tempHistory = new Array(60).fill(this.ambientTemp);
        this._histTimer   = 0;

        // 周期波形历史（通断状态 0/1，64点）
        this._cycleHistory  = new Array(64).fill(0);
        this._cycleTimer    = 0;

        // ── 布局 & 初始化 ────────────────────────────────────────
        this._layout = this._calcLayout();
        this._init();

        // ── 端口 ─────────────────────────────────────────────────
        const L = this._layout;
        this.addPort(L.base.x + 10, L.base.y + L.base.h + 4, 'power_l',    'wire', 'L');
        this.addPort(L.base.x + 30, L.base.y + L.base.h + 4, 'power_n',    'wire', 'N');
        this.addPort(L.base.x + 60, L.base.y + L.base.h + 4, 'heater_out', 'wire', 'H1');
        this.addPort(L.base.x + 85, L.base.y + L.base.h + 4, 'warm_out',   'wire', 'H2');
    }

    // ═══════════════════════════════════════════════════════════════════
    //  布局
    // ═══════════════════════════════════════════════════════════════════
    _calcLayout() {
        const W = this.width, H = this.height;
        return {
            housing:   { x: W*0.04, y: H*0.01, w: W*0.92, h: H*0.63, rx: 15 },
            lid:       { x: W*0.07, y: H*0.01, w: W*0.86, h: H*0.085, rx: 8  },
            pot:       { x: W*0.13, y: H*0.085,w: W*0.74, h: H*0.33,  rx: 6  },
            heater:    { x: W*0.17, y: H*0.41, w: W*0.66, h: H*0.065, rx: 4  },
            // 双金属片机构区（加热盘中央正下方）
            bimetal:   { x: W*0.30, y: H*0.48, w: W*0.40, h: H*0.08 },
            base:      { x: W*0.04, y: H*0.64, w: W*0.92, h: H*0.065, rx: 5  },
            panel:     { x: W*0.04, y: H*0.705,w: W*0.92, h: H*0.285, rx: 8  },
            // 面板内分区
            pLeft:     { x: W*0.06, y: H*0.72, w: W*0.32, h: H*0.26 },  // 温度+曲线
            pMid:      { x: W*0.40, y: H*0.72, w: W*0.24, h: H*0.26 },  // 通断波形
            pRight:    { x: W*0.66, y: H*0.72, w: W*0.28, h: H*0.26 },  // 旋钮+LED
        };
    }

    // ═══════════════════════════════════════════════════════════════════
    //  初始化绘制
    // ═══════════════════════════════════════════════════════════════════
    _init() {
        this._drawHousing();
        this._drawLid();
        this._drawPot();
        this._drawHeatingPlate();
        this._drawBase();
        this._drawPanel();
        this._drawLabel();
        // 动态层
        this._bimetalGroup = new Konva.Group(); this._staticGroup.add(this._bimetalGroup);
        this._contactGroup = new Konva.Group(); this._staticGroup.add(this._contactGroup);
        this._wireGroup    = new Konva.Group(); this._staticGroup.add(this._wireGroup);
        this._panelDynGroup= new Konva.Group(); this._staticGroup.add(this._panelDynGroup);
        this._rebuildBimetal();
        this._rebuildWires();
        this._bindInteraction();
    }

    // ───────────────────────────────────────────────────────────────────
    //  外壳（白色家电涂装风格）
    // ───────────────────────────────────────────────────────────────────
    _drawHousing() {
        const h = this._layout.housing;
        // 主体
        this._staticGroup.add(new Konva.Rect({
            x: h.x, y: h.y, width: h.w, height: h.h,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: h.w, y: 0 },
            fillLinearGradientColorStops: [
                0, '#d0d0d0', 0.12, '#e8e8e8', 0.42, '#f5f5f5',
                0.58, '#f5f5f5', 0.88, '#e4e4e4', 1, '#c8c8c8',
            ],
            stroke: '#a8a8a8', strokeWidth: 1.5, cornerRadius: h.rx,
            shadowColor: '#000', shadowBlur: 8, shadowOffsetY: 3, shadowOpacity: 0.20,
        }));
        // 顶部高光
        this._staticGroup.add(new Konva.Rect({
            x: h.x+4, y: h.y+2, width: h.w-8, height: h.h*0.06,
            fill: 'rgba(255,255,255,0.60)', cornerRadius: [h.rx, h.rx, 0, 0],
        }));
        // 底部装饰色带（橙色暖调，区别于磁钢型和 IH 型）
        this._staticGroup.add(new Konva.Rect({
            x: h.x, y: h.y+h.h-10, width: h.w, height: 10,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: h.w, y: 0 },
            fillLinearGradientColorStops: [0,'#7a3a10', 0.5,'#c06020', 1,'#7a3a10'],
            cornerRadius: [0, 0, h.rx, h.rx],
        }));
        // 侧边光泽线
        this._staticGroup.add(new Konva.Line({
            points: [h.x+h.w*0.08, h.y+16, h.x+h.w*0.08, h.y+h.h-16],
            stroke: 'rgba(255,255,255,0.38)', strokeWidth: 2.5, lineCap: 'round',
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    //  锅盖
    // ───────────────────────────────────────────────────────────────────
    _drawLid() {
        const l = this._layout.lid;
        const W = this.width;
        // 盖体（浅灰，带弧度）
        this._staticGroup.add(new Konva.Rect({
            x: l.x, y: l.y, width: l.w, height: l.h,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: 0, y: l.h },
            fillLinearGradientColorStops: [0,'#d8d8d8', 0.45,'#f0f0f0', 1,'#c0c0c0'],
            stroke: '#9a9a9a', strokeWidth: 1, cornerRadius: l.rx,
        }));
        // 塑料提手
        this._staticGroup.add(new Konva.Rect({
            x: W*0.38, y: l.y-5, width: W*0.24, height: 10,
            fill: '#d05010', stroke: '#903010', strokeWidth: 1, cornerRadius: 5,
        }));
        // 排气孔
        for (let i = 0; i < 6; i++) {
            this._staticGroup.add(new Konva.Circle({
                x: W*(0.32+i*0.07), y: l.y+l.h*0.58, radius: 2,
                fill: '#aaaaaa', stroke: '#888', strokeWidth: 0.5,
            }));
        }
        // 密封圈
        this._staticGroup.add(new Konva.Rect({
            x: l.x+3, y: l.y+l.h-3, width: l.w-6, height: 4,
            fill: '#909090', cornerRadius: 2,
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    //  内胆 + 水/饭动态层
    // ───────────────────────────────────────────────────────────────────
    _drawPot() {
        const p = this._layout.pot;
        // 外壁（铝色）
        this._staticGroup.add(new Konva.Rect({
            x: p.x, y: p.y, width: p.w, height: p.h,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: p.w, y: 0 },
            fillLinearGradientColorStops: [
                0,'#787878', 0.18,'#b0b8b8', 0.5,'#c8d0d0',
                0.82,'#a8b0b0', 1,'#787878',
            ],
            stroke: '#686868', strokeWidth: 1, cornerRadius: p.rx,
        }));
        // 水/饭动态层
        this._waterGroup = new Konva.Group();
        this._staticGroup.add(this._waterGroup);
        this._rebuildWaterLayer();
        // 内壁不粘层描边
        this._staticGroup.add(new Konva.Rect({
            x: p.x+5, y: p.y+3, width: p.w-10, height: p.h-6,
            fill: 'none', stroke: 'rgba(40,40,40,0.16)', strokeWidth: 0.8,
            cornerRadius: p.rx-2,
        }));
        // 底壁加厚（导热铝，接触加热盘）
        this._staticGroup.add(new Konva.Rect({
            x: p.x+4, y: p.y+p.h-7, width: p.w-8, height: 7,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: p.w, y: 0 },
            fillLinearGradientColorStops: [0,'#505858', 0.5,'#788080', 1,'#505858'],
            cornerRadius: [0,0,p.rx-1,p.rx-1],
        }));
    }

    _rebuildWaterLayer() {
        this._waterGroup.destroyChildren();
        const p  = this._layout.pot;
        const wl = Math.max(0, Math.min(1, this._waterLevel));
        if (wl <= 0) return;

        const innerH = p.h - 10;
        const waterH = innerH * wl;
        const waterY = p.y + p.h - 5 - waterH;

        // 颜色随进度变化
        let c1, c2;
        const pg = this._cookProg;
        if (pg > 0.85)      { c1 = '#f4ead0'; c2 = '#e8d4a0'; }
        else if (pg > 0.40) { c1 = '#eef4e2'; c2 = '#d4e8bc'; }
        else                { c1 = '#c2d8e4'; c2 = '#9cbccc'; }

        this._waterGroup.add(new Konva.Rect({
            x: p.x+5, y: waterY, width: p.w-10, height: waterH,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: 0, y: waterH },
            fillLinearGradientColorStops: [0,c1,1,c2],
            cornerRadius: [0,0,p.rx-2,p.rx-2],
        }));

        // 沸腾气泡（触点闭合且 T ≥ 96°C）
        const isBoiling = this._tcState === TC_STATE.CLOSED
                       && this._temperature >= 96;
        if (isBoiling) {
            for (let i = 0; i < 8; i++) {
                this._waterGroup.add(new Konva.Circle({
                    x: p.x+7 + Math.random()*(p.w-14),
                    y: waterY+6 + Math.random()*(waterH-12),
                    radius: 1.8 + Math.random()*2.5,
                    fill: 'rgba(255,255,255,0.56)',
                }));
            }
            // 水面波纹
            const wpts = [];
            for (let x = 0; x <= p.w-10; x+=6) {
                wpts.push(p.x+5+x, waterY + Math.sin(x*0.16)*2.8);
            }
            this._waterGroup.add(new Konva.Line({
                points: wpts, stroke: 'rgba(255,255,255,0.36)',
                strokeWidth: 1.5, tension: 0.4, lineCap: 'round',
            }));
        }

        // 蒸汽
        if (this._temperature > 60 && this._knob !== KNOB.OFF) {
            const alpha = Math.min(0.52, (this._temperature-60)/55);
            const W = this.width;
            [W*0.30, W*0.47, W*0.64].forEach((sx, i) => {
                this._waterGroup.add(new Konva.Line({
                    points: [sx, this._layout.lid.y-3, sx+(i-1)*5, this._layout.lid.y-13, sx, this._layout.lid.y-21],
                    stroke: `rgba(175,205,225,${alpha.toFixed(2)})`,
                    strokeWidth: 3, lineCap: 'round', tension: 0.5,
                }));
            });
        }
    }

    // ───────────────────────────────────────────────────────────────────
    //  加热盘
    // ───────────────────────────────────────────────────────────────────
    _drawHeatingPlate() {
        const hp = this._layout.heater;
        // 铝盘
        this._staticGroup.add(new Konva.Rect({
            x: hp.x, y: hp.y, width: hp.w, height: hp.h,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: hp.w, y: 0 },
            fillLinearGradientColorStops: [0,'#604020', 0.3,'#b87030', 0.7,'#b87030', 1,'#604020'],
            stroke: '#402010', strokeWidth: 1, cornerRadius: hp.rx,
        }));
        // 电热管纹路（6条）
        for (let i = 0; i < 6; i++) {
            this._staticGroup.add(new Konva.Line({
                points: [hp.x+hp.w*(0.07+i*0.16), hp.y+2, hp.x+hp.w*(0.07+i*0.16), hp.y+hp.h-2],
                stroke: 'rgba(55,25,5,0.38)', strokeWidth: 1, lineCap: 'round',
            }));
        }
        // 中央凸台（安装双金属片）
        this._staticGroup.add(new Konva.Rect({
            x: hp.x+hp.w*0.38, y: hp.y+hp.h-2, width: hp.w*0.24, height: 6,
            fill: '#808080', stroke: '#606060', strokeWidth: 0.6, cornerRadius: 2,
        }));
        // 发光层（动态）
        this._heaterGlow = new Konva.Rect({
            x: hp.x, y: hp.y, width: hp.w, height: hp.h,
            fill: 'rgba(255,70,0,0)', cornerRadius: hp.rx,
        });
        this._staticGroup.add(this._heaterGlow);
    }

    // ───────────────────────────────────────────────────────────────────
    //  底座
    // ───────────────────────────────────────────────────────────────────
    _drawBase() {
        const b = this._layout.base;
        this._staticGroup.add(new Konva.Rect({
            x: b.x, y: b.y, width: b.w, height: b.h,
            fill: '#242424', stroke: '#181818', strokeWidth: 1.5, cornerRadius: b.rx,
            shadowColor: '#000', shadowBlur: 5, shadowOffsetY: 2, shadowOpacity: 0.30,
        }));
        for (let i = 0; i < 4; i++) {
            this._staticGroup.add(new Konva.Rect({
                x: b.x+b.w*(0.07+i*0.26)-9, y: b.y+b.h*0.55,
                width: 18, height: b.h*0.30, fill: '#141414', cornerRadius: 2,
            }));
        }
    }

    // ───────────────────────────────────────────────────────────────────
    //  操作面板（静态背景 + 三栏划分）
    // ───────────────────────────────────────────────────────────────────
    _drawPanel() {
        const pn = this._layout.panel;
        this._staticGroup.add(new Konva.Rect({
            x: pn.x, y: pn.y, width: pn.w, height: pn.h,
            fill: '#181818', stroke: '#282828', strokeWidth: 1, cornerRadius: pn.rx,
        }));
        // 分隔线
        const L = this._layout;
        [L.pMid.x, L.pRight.x].forEach(dx => {
            this._staticGroup.add(new Konva.Line({
                points: [dx, pn.y+5, dx, pn.y+pn.h-5],
                stroke: '#282828', strokeWidth: 1, dash: [2,3],
            }));
        });
        // 各栏标题
        [
            { x: L.pLeft.x,  text: '温度监测' },
            { x: L.pMid.x+2, text: '通断波形' },
            { x: L.pRight.x+2,text: '控制旋钮' },
        ].forEach(t => {
            this._staticGroup.add(new Konva.Text({
                x: t.x, y: pn.y+5, text: t.text,
                fontSize: 8, fill: '#505060', fontStyle: 'italic',
            }));
        });

        this._panelGroup = new Konva.Group();
        this._staticGroup.add(this._panelGroup);
        this._drawPanelLeft();
        this._drawPanelMid();
        this._drawPanelRight();
    }

    // ── 面板左：温度数字 + T_open/T_close 标注 + 温度曲线 ───────────
    _drawPanelLeft() {
        const pl = this._layout.pLeft;

        this._tempNumText = new Konva.Text({
            x: pl.x, y: pl.y+2, width: pl.w,
            text: `${Math.round(this._temperature)}°`,
            fontSize: 30, fontStyle: 'bold', fontFamily: 'monospace',
            fill: '#3890d0', align: 'center',
            shadowColor: '#3890d0', shadowBlur: 5, shadowOpacity: 0.5,
        });
        this._panelGroup.add(this._tempNumText);

        this._tcStateText = new Konva.Text({
            x: pl.x, y: pl.y+38, width: pl.w,
            text: '─ 断电 ─', fontSize: 9, fill: '#506090', align: 'center',
        });
        this._panelGroup.add(this._tcStateText);

        // T_open / T_close 数值行
        this._topenText = new Konva.Text({
            x: pl.x+2, y: pl.y+52,
            text: `T断: ${this.tOpen}°C  T合: ${this.tClose}°C`,
            fontSize: 8.5, fill: '#806040', fontFamily: 'monospace',
        });
        this._panelGroup.add(this._topenText);

        // 循环次数
        this._cycleText = new Konva.Text({
            x: pl.x+2, y: pl.y+64,
            text: `通断循环: 0 次`, fontSize: 8.5, fill: '#607080', fontFamily: 'monospace',
        });
        this._panelGroup.add(this._cycleText);

        // 温度曲线
        this._tempChartGroup = new Konva.Group();
        this._panelGroup.add(this._tempChartGroup);
        this._rebuildTempChart();
    }

    _rebuildTempChart() {
        this._tempChartGroup.destroyChildren();
        const pl = this._layout.pLeft;
        const cx = pl.x+1, cy = pl.y+pl.h-2, cw = pl.w-2, ch = 52;

        // 背景
        this._tempChartGroup.add(new Konva.Rect({
            x: cx, y: cy-ch, width: cw, height: ch,
            fill: 'rgba(6,6,16,0.72)', stroke: '#181828', strokeWidth: 0.5, cornerRadius: 2,
        }));

        // T_open 红虚线
        const toY = cy - ((this.tOpen  -20)/160)*ch;
        const tcY = cy - ((this.tClose -20)/160)*ch;
        this._tempChartGroup.add(new Konva.Line({
            points:[cx,toY,cx+cw,toY], stroke:'rgba(220,60,20,0.50)', strokeWidth:0.8, dash:[3,2],
        }));
        this._tempChartGroup.add(new Konva.Line({
            points:[cx,tcY,cx+cw,tcY], stroke:'rgba(40,180,80,0.50)', strokeWidth:0.8, dash:[3,2],
        }));
        this._tempChartGroup.add(new Konva.Text({ x:cx+2,y:toY-8, text:`断${this.tOpen}°`, fontSize:6, fill:'rgba(220,80,30,0.70)'}));
        this._tempChartGroup.add(new Konva.Text({ x:cx+2,y:tcY+2, text:`合${this.tClose}°`, fontSize:6, fill:'rgba(40,200,80,0.70)'}));

        // 温度折线
        const hist = this._tempHistory, n = hist.length;
        const pts  = [];
        for (let i=0;i<n;i++) {
            pts.push(cx+(i/(n-1))*cw, cy-((hist[i]-20)/160)*ch);
        }
        this._tempChartGroup.add(new Konva.Line({
            points:pts, stroke:this._getTempColor(),
            strokeWidth:1.2, lineCap:'round', lineJoin:'round', tension:0.3,
        }));
    }

    _getTempColor() {
        const t = this._temperature;
        if (t >= 120) return '#e02010';
        if (t >= 90)  return '#d07018';
        if (t >= 60)  return '#c0a020';
        return '#3890d0';
    }

    // ── 面板中：通断周期波形示波 ─────────────────────────────────────
    _drawPanelMid() {
        const pm = this._layout.pMid;
        // 示波器背景
        this._staticGroup.add(new Konva.Rect({
            x: pm.x+2, y: pm.y+14, width: pm.w-4, height: pm.h*0.55,
            fill: 'rgba(0,8,0,0.80)', stroke: '#0c280c', strokeWidth: 0.8, cornerRadius: 3,
        }));
        // 网格
        for (let i=1;i<4;i++) {
            this._staticGroup.add(new Konva.Line({
                points:[pm.x+2, pm.y+14+i*(pm.h*0.55/4), pm.x+pm.w-2, pm.y+14+i*(pm.h*0.55/4)],
                stroke:'rgba(0,60,0,0.25)', strokeWidth:0.5,
            }));
        }
        // 波形组（动态）
        this._cycleWaveGroup = new Konva.Group();
        this._panelGroup.add(this._cycleWaveGroup);
        this._cwBgX = pm.x+2;
        this._cwBgY = pm.y+14;
        this._cwBgW = pm.w-4;
        this._cwBgH = pm.h*0.55;

        // 温度区间说明
        this._panelGroup.add(new Konva.Text({
            x: pm.x+3, y: pm.y+14+pm.h*0.60,
            text: `↑ H1 闭合（加热）\n↓ H1 断开（保温）`,
            fontSize: 8, fill: '#406040', lineHeight: 1.7,
        }));
    }

    _rebuildCycleWave() {
        this._cycleWaveGroup.destroyChildren();
        const hist = this._cycleHistory, n = hist.length;
        const x0   = this._cwBgX+1;
        const y0   = this._cwBgY + this._cwBgH - 4;
        const yH   = this._cwBgH - 8;
        const dx   = (this._cwBgW-2)/(n-1);

        // 方波：用折线段模拟（方形，不平滑）
        const pts = [x0, y0 - hist[0]*yH];
        for (let i=1;i<n;i++) {
            const px = x0+i*dx;
            pts.push(px, y0-hist[i-1]*yH);  // 垂直跳变
            pts.push(px, y0-hist[i]*yH);
        }
        this._cycleWaveGroup.add(new Konva.Line({
            points:pts, stroke:'#30e030',
            strokeWidth:1.5, lineCap:'square', lineJoin:'miter',
        }));
    }

    // ── 面板右：旋钮 + 指示灯 ────────────────────────────────────────
    _drawPanelRight() {
        const pr = this._layout.pRight;
        const cx = pr.x + pr.w/2;
        const cy = pr.y + pr.h*0.40;
        const R  = pr.w*0.30;

        // 旋钮外圈（刻度盘）
        this._staticGroup.add(new Konva.Circle({
            x:cx, y:cy, radius:R+8,
            fill:'#1e1e1e', stroke:'#404040', strokeWidth:1.5,
        }));
        // 刻度线（OFF / COOK / WARM 三个位置）
        const tickAngles = { OFF:-90, COOK:0, WARM:90 };
        const tickLabels = { OFF:'断', COOK:'煮', WARM:'保' };
        Object.entries(tickAngles).forEach(([key, ang]) => {
            const rad = ang * Math.PI / 180;
            const tx  = cx + (R+4)*Math.cos(rad);
            const ty  = cy + (R+4)*Math.sin(rad);
            this._staticGroup.add(new Konva.Line({
                points:[cx+(R-2)*Math.cos(rad),cy+(R-2)*Math.sin(rad),tx,ty],
                stroke:'#707070', strokeWidth:1.5, lineCap:'round',
            }));
            this._staticGroup.add(new Konva.Text({
                x: cx+(R+10)*Math.cos(rad)-8,
                y: cy+(R+10)*Math.sin(rad)-6,
                text: tickLabels[key], fontSize:9, fill:'#909090', fontStyle:'bold',
            }));
        });

        // 旋钮本体（动态旋转，由 _panelDynGroup 重绘）
        this._knobCX  = cx;
        this._knobCY  = cy;
        this._knobR   = R;

        // 指示灯（H1 主路 / H2 保温）
        const ledDefs = [
            { key:'cook', label:'主路 H1', color:'#e04020', off:'#381010', ly: pr.y+pr.h*0.75 },
            { key:'warm', label:'保温 H2', color:'#d09020', off:'#382010', ly: pr.y+pr.h*0.88 },
        ];
        this._leds = {};
        ledDefs.forEach(def => {
            this._staticGroup.add(new Konva.Circle({
                x:pr.x+12, y:def.ly, radius:6,
                fill:'#181818', stroke:'#303030', strokeWidth:0.6,
            }));
            const led = new Konva.Circle({ x:pr.x+12, y:def.ly, radius:4.5, fill:def.off });
            this._panelGroup.add(led);
            this._panelGroup.add(new Konva.Text({
                x:pr.x+22, y:def.ly-5.5, text:def.label, fontSize:9, fill:'#505060',
            }));
            this._leds[def.key] = { circle:led, color:def.color, off:def.off };
        });
    }

    // ───────────────────────────────────────────────────────────────────
    //  双金属片机构完整重绘（核心动态层）
    // ───────────────────────────────────────────────────────────────────
    /**
     * 双金属片几何模型：
     *
     *  固定端（左，铆钉固定在加热盘凸台）
     *  ────────────────────────[动触点]
     *                                  ↕ contactGap（断开时有间隙）
     *                          [静触点]（固定在上方接线柱）
     *
     *  弯曲方向：温度升高 → 黄铜膨胀 > 因瓦合金 → 弹片向下弯（挠度增大）
     *  动触点随自由端向下位移 → 脱离上方固定静触点 → 电路断开
     *
     *  仿真中挠度 deflection = (T-25)/155 * maxDeflect（线性近似）
     *  触点断开条件：deflection > gapThreshold（T_open 归一化）
     *  触点重合条件：deflection < gapThreshold * 0.55（滞差区）
     */
    _rebuildBimetal() {
        this._bimetalGroup.destroyChildren();
        this._contactGroup.destroyChildren();

        const bm      = this._layout.bimetal;
        const bi      = this;
        const def     = this._deflection;   // px，当前挠度（0=平直，>0=向下弯）
        const closed  = this._tcState === TC_STATE.CLOSED || this._tcState === TC_STATE.CLOSING;
        const gap     = this._contactGap;   // px，触点间隙（0=接触，>0=断开）
        const W       = this.width;

        const fixX   = bm.x;                   // 固定端 X
        const fixY   = bm.y + bm.h*0.40;       // 固定端 Y（中线）
        const freeX  = bm.x + bm.w*0.82;       // 自由端 X
        const freeY  = fixY + def;              // 自由端 Y（随挠度下移）
        const armLen = freeX - fixX;

        // ── 固定铆钉底座 ──
        this._bimetalGroup.add(new Konva.Rect({
            x: fixX-5, y: fixY-8, width:10, height:16,
            fill:'#484848', stroke:'#303030', strokeWidth:0.8, cornerRadius:2,
        }));
        this._bimetalGroup.add(new Konva.Circle({
            x:fixX, y:fixY, radius:3.5,
            fill:'#888', stroke:'#555', strokeWidth:0.8,
        }));

        // ── 调温螺钉（右侧，调整静触点高度）──
        const screwX = freeX + 12;
        const screwY = fixY - 8;  // 静触点附近
        this._bimetalGroup.add(new Konva.Rect({
            x:screwX-3, y:screwY-6, width:6, height:14,
            fill:'#909090', stroke:'#606060', strokeWidth:0.6, cornerRadius:1,
        }));
        // 一字槽
        this._bimetalGroup.add(new Konva.Line({
            points:[screwX-3,screwY-6, screwX+3,screwY-6],
            stroke:'#484848', strokeWidth:1.2,
        }));
        this._bimetalGroup.add(new Konva.Text({
            x:screwX+5, y:screwY-4, text:'调温\n螺钉', fontSize:6.5, fill:'#808080', lineHeight:1.5,
        }));

        // ── 双金属片本体（悬臂梁，自固定端弯曲至自由端）──
        // 用贝塞尔曲线模拟弯曲形态，控制点在中间
        const midX = fixX + armLen*0.55;
        const midY = fixY + def*0.45;

        // 上层（因瓦合金，低膨胀，蓝灰色），稍窄
        const invarPts = this._calcBezierPoints(fixX, fixY-2.5, midX, midY-2.5, freeX, freeY-2.5, 20);
        this._bimetalGroup.add(new Konva.Line({
            points:invarPts, stroke:'#4868b0', strokeWidth:3.5,
            lineCap:'round', lineJoin:'round', tension:0,
        }));
        // 下层（黄铜，高膨胀，金黄色）
        const brassPts = this._calcBezierPoints(fixX, fixY+2.5, midX, midY+2.5, freeX, freeY+2.5, 20);
        this._bimetalGroup.add(new Konva.Line({
            points:brassPts, stroke:'#c09030', strokeWidth:3.5,
            lineCap:'round', lineJoin:'round', tension:0,
        }));
        // 两层焊合线（中间接合面）
        const bondPts = this._calcBezierPoints(fixX, fixY, midX, midY, freeX, freeY, 20);
        this._bimetalGroup.add(new Konva.Line({
            points:bondPts, stroke:'rgba(80,80,80,0.45)', strokeWidth:0.8,
            lineCap:'round', lineJoin:'round', tension:0,
        }));

        // ── 接通时电流粒子（沿弹片流动）──
        if (closed) {
            for (let i=0;i<5;i++) {
                const t   = i/4;
                const px  = fixX + t*armLen;
                const py  = fixY + def*t*t*0.6;
                this._bimetalGroup.add(new Konva.Circle({
                    x:px, y:py, radius:2,
                    fill:'rgba(255,200,60,0.80)',
                }));
            }
        }

        // ── 动触点（弹片自由端）──
        const tcColor = closed ? '#e8c040' : '#909090';
        const tcGlow  = closed ? '#ffcc40' : 'transparent';
        this._contactGroup.add(new Konva.Circle({
            x:freeX, y:freeY+2, radius:5,
            fill:tcColor, stroke:closed?'#a08020':'#606060', strokeWidth:0.9,
            shadowColor:tcGlow, shadowBlur:closed?6:0, shadowOpacity:0.85,
        }));

        // ── 静触点（固定，始终在 fixY - 接触距离 的高度）──
        const staticY = fixY - 6;  // 静触点高于弹片平直位时约 6px（触点设计行程）
        // 接线柱
        this._contactGroup.add(new Konva.Rect({
            x:freeX-3, y:staticY-14, width:6, height:18,
            fill:'#707070', stroke:'#505050', strokeWidth:0.5, cornerRadius:1,
        }));
        this._contactGroup.add(new Konva.Circle({
            x:freeX, y:staticY, radius:5,
            fill:'#909090', stroke:'#606060', strokeWidth:0.8,
        }));

        // ── 触点间隙标注（断开时显示间距）──
        if (!closed && gap > 0.5) {
            const gapMm = (gap * 0.25).toFixed(2);  // px → mm 近似
            // 双向箭头
            this._contactGroup.add(new Konva.Arrow({
                points:[freeX+10, staticY, freeX+10, freeY+2],
                stroke:'#d06020', strokeWidth:1.2, fill:'#d06020',
                pointerLength:4, pointerWidth:3,
            }));
            this._contactGroup.add(new Konva.Arrow({
                points:[freeX+10, freeY+2, freeX+10, staticY],
                stroke:'#d06020', strokeWidth:1.2, fill:'#d06020',
                pointerLength:4, pointerWidth:3,
            }));
            this._contactGroup.add(new Konva.Rect({
                x:freeX+12, y:(staticY+freeY)/2-7, width:36, height:14,
                fill:'rgba(10,5,0,0.80)', stroke:'#402010', strokeWidth:0.5, cornerRadius:2,
            }));
            this._contactGroup.add(new Konva.Text({
                x:freeX+14, y:(staticY+freeY)/2-4,
                text:`间隙\n${gapMm}mm`,
                fontSize:7, fill:'#e07030', lineHeight:1.5, fontFamily:'monospace',
            }));
        }

        // ── 标注 ──
        // 材料标注
        this._bimetalGroup.add(new Konva.Text({
            x:fixX+armLen*0.15, y:fixY-14,
            text:'因瓦合金（α₁低）', fontSize:6.5, fill:'#6880c0', fontStyle:'italic',
        }));
        this._bimetalGroup.add(new Konva.Text({
            x:fixX+armLen*0.15, y:fixY+8,
            text:'黄铜（α₂高）', fontSize:6.5, fill:'#b89040', fontStyle:'italic',
        }));

        // 弯曲方向箭头（温度高时显示）
        if (def > 3) {
            this._bimetalGroup.add(new Konva.Arrow({
                points:[freeX-12, fixY+2, freeX-12, freeY],
                stroke:'rgba(200,80,20,0.70)', fill:'rgba(200,80,20,0.70)',
                strokeWidth:1.5, pointerLength:5, pointerWidth:4,
            }));
            this._bimetalGroup.add(new Konva.Text({
                x:freeX-36, y:(fixY+freeY)/2-4,
                text:`↓${def.toFixed(1)}px`, fontSize:7, fill:'rgba(200,80,20,0.70)',
            }));
        }

        // 触点状态文字
        const stateStr = closed ? '● 触点闭合（电路接通）' : `◯ 触点断开（间隙 ${gap.toFixed(1)}px）`;
        this._bimetalGroup.add(new Konva.Text({
            x:bm.x-2, y:bm.y+bm.h+2,
            text:stateStr,
            fontSize:8,
            fill: closed ? '#50c050' : '#d06020',
            fontStyle:'bold',
        }));

        // 区域标题
        this._bimetalGroup.add(new Konva.Text({
            x:bm.x-2, y:bm.y-16,
            text:'双金属片温控器（Bimetallic Thermostat）',
            fontSize:8, fill:'#8090a0', fontStyle:'italic',
        }));
    }

    /**
     * 计算贝塞尔曲线点序列（用于渲染弯曲弹片）
     * 二次贝塞尔：P(t) = (1-t)²P0 + 2t(1-t)P1 + t²P2
     */
    _calcBezierPoints(x0,y0,xm,ym,x2,y2,steps) {
        const pts = [];
        for (let i=0;i<=steps;i++) {
            const t  = i/steps;
            const u  = 1-t;
            pts.push(u*u*x0 + 2*u*t*xm + t*t*x2);
            pts.push(u*u*y0 + 2*u*t*ym + t*t*y2);
        }
        return pts;
    }

    // ───────────────────────────────────────────────────────────────────
    //  接线示意（动态颜色）
    // ───────────────────────────────────────────────────────────────────
    _rebuildWires() {
        this._wireGroup.destroyChildren();
        const hp   = this._layout.heater;
        const base = this._layout.base;
        const cookOn = (this._knob !== KNOB.OFF) && this._tcState === TC_STATE.CLOSED;
        const warmOn = (this._knob !== KNOB.OFF) && this._tcState !== TC_STATE.CLOSED;
        const y1 = hp.y + hp.h/2 - 3;
        const y2 = hp.y + hp.h/2 + 5;

        // 主加热回路（L 线）
        this._wireGroup.add(new Konva.Line({
            points:[base.x, y1, hp.x, y1],
            stroke: cookOn?'#d86010':'#383838',
            strokeWidth:1.2, dash:[5,3], lineCap:'round',
        }));
        this._wireGroup.add(new Konva.Line({
            points:[hp.x+hp.w, y1, base.x+base.w, y1],
            stroke: cookOn?'#d86010':'#383838',
            strokeWidth:1.2, dash:[5,3], lineCap:'round',
        }));
        // 保温回路（N 线）
        this._wireGroup.add(new Konva.Line({
            points:[base.x, y2, hp.x, y2],
            stroke: warmOn?'#d09020':'#2a2a2a',
            strokeWidth:1.2, dash:[3,4], lineCap:'round',
        }));
        this._wireGroup.add(new Konva.Line({
            points:[hp.x+hp.w, y2, base.x+base.w, y2],
            stroke: warmOn?'#d09020':'#2a2a2a',
            strokeWidth:1.2, dash:[3,4], lineCap:'round',
        }));
        // 端子标注
        this._wireGroup.add(new Konva.Text({
            x:base.x+2, y:y1-9, text:'L', fontSize:8, fill:'#806040', fontStyle:'bold',
        }));
        this._wireGroup.add(new Konva.Text({
            x:base.x+2, y:y2+2, text:'N', fontSize:8, fill:'#507060', fontStyle:'bold',
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    //  动态面板刷新（旋钮 + LED + 数值）
    // ───────────────────────────────────────────────────────────────────
    _rebuildPanelDyn() {
        this._panelDynGroup.destroyChildren();

        // ── 旋钮本体（随 _knobAngle 旋转）──
        const cx  = this._knobCX;
        const cy  = this._knobCY;
        const R   = this._knobR;
        const ang = this._knobAngle;

        // 旋钮圆盘
        this._panelDynGroup.add(new Konva.Circle({
            x:cx, y:cy, radius:R,
            fillRadialGradientStartPoint:{x:0,y:0},
            fillRadialGradientStartRadius:0,
            fillRadialGradientEndPoint:{x:0,y:0},
            fillRadialGradientEndRadius:R,
            fillRadialGradientColorStops:[0,'#585858',1,'#282828'],
            stroke:'#606060', strokeWidth:1.5,
        }));
        // 旋钮指示线（方向指针）
        const rad = ang * Math.PI/180;
        this._panelDynGroup.add(new Konva.Line({
            points:[cx, cy, cx+R*0.78*Math.cos(rad), cy+R*0.78*Math.sin(rad)],
            stroke:'#e09030', strokeWidth:2.5, lineCap:'round',
        }));
        // 中心圆帽
        this._panelDynGroup.add(new Konva.Circle({
            x:cx, y:cy, radius:R*0.18,
            fill:'#d09030', stroke:'#a07020', strokeWidth:1,
        }));

        // 当前档位文字
        const knobLabels = { [KNOB.OFF]:'断电', [KNOB.COOK]:'煮饭', [KNOB.WARM]:'保温' };
        this._panelDynGroup.add(new Konva.Text({
            x:cx-20, y:cy+R+6, width:40,
            text:knobLabels[this._knob],
            fontSize:9, fill:'#d09030', fontStyle:'bold', align:'center',
        }));

        // ── LED 更新 ──
        const cookOn = (this._knob !== KNOB.OFF) && this._tcState === TC_STATE.CLOSED;
        const warmOn = (this._knob !== KNOB.OFF) && this._tcState !== TC_STATE.CLOSED;
        if (this._leds) {
            const cookL = this._leds['cook'];
            const warmL = this._leds['warm'];
            if (cookL) {
                cookL.circle.fill(cookOn ? cookL.color : cookL.off);
                cookL.circle.shadowColor(cookOn ? cookL.color : 'transparent');
                cookL.circle.shadowBlur(cookOn ? 8 : 0); cookL.circle.shadowOpacity(0.9);
            }
            if (warmL) {
                warmL.circle.fill(warmOn ? warmL.color : warmL.off);
                warmL.circle.shadowColor(warmOn ? warmL.color : 'transparent');
                warmL.circle.shadowBlur(warmOn ? 8 : 0); warmL.circle.shadowOpacity(0.9);
            }
        }

        // ── 温度数字 ──
        if (this._tempNumText) {
            const c = this._getTempColor();
            this._tempNumText.text(`${Math.round(this._temperature)}°`);
            this._tempNumText.fill(c); this._tempNumText.shadowColor(c);
        }
        // ── 状态文字 ──
        if (this._tcStateText) {
            const stateMap = {
                [TC_STATE.CLOSED]:   '▶ 加热中（触点闭合）',
                [TC_STATE.TRIPPING]: '⚡ 断开！',
                [TC_STATE.OPEN]:     '◆ 保温中（触点断开）',
                [TC_STATE.CLOSING]:  '↩ 触点复原中',
            };
            const offText = '─ 断电 ─';
            this._tcStateText.text(
                this._knob === KNOB.OFF ? offText : (stateMap[this._tcState] || '─')
            );
        }
        // ── 循环次数 ──
        if (this._cycleText) {
            this._cycleText.text(`通断循环: ${this._cycleCount} 次`);
        }
    }

    // ───────────────────────────────────────────────────────────────────
    //  加热盘发光更新
    // ───────────────────────────────────────────────────────────────────
    _updateHeaterGlow() {
        if (!this._heaterGlow) return;
        const cookOn = (this._knob !== KNOB.OFF) && this._tcState === TC_STATE.CLOSED;
        const warmOn = (this._knob !== KNOB.OFF) && this._tcState !== TC_STATE.CLOSED;
        let op = 0;
        if (cookOn) op = Math.min(0.55, (this._temperature-20)/115);
        else if (warmOn) op = 0.15;
        this._heaterGlow.fill(`rgba(255,70,0,${op.toFixed(3)})`);
    }

    // ───────────────────────────────────────────────────────────────────
    //  标注
    // ───────────────────────────────────────────────────────────────────
    _drawLabel() {
        this._staticGroup.add(new Konva.Text({
            x:0, y:-16, width:this.width,
            text:`${this.label}  双金属片温控电饭煲  ${this.ratedVoltage}V / ${this.cookPower}W`,
            fontSize:9, fontStyle:'bold', fill:'#546e7a', align:'center',
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    //  交互绑定（旋钮点击循环切档）
    // ───────────────────────────────────────────────────────────────────
    _bindInteraction() {
        setTimeout(() => {
            // 旋钮区域（点击循环：OFF→COOK→WARM→OFF）
            const knobHit = new Konva.Circle({
                x:this._knobCX, y:this._knobCY, radius:this._knobR+10,
                fill:'rgba(0,0,0,0)', listening:true,
            });
            this._panelGroup.add(knobHit);
            knobHit.on('click tap', () => this._cycleKnob());
            knobHit.on('mouseenter', () => { document.body.style.cursor='pointer'; });
            knobHit.on('mouseleave', () => { document.body.style.cursor='default'; });
        }, 80);
    }

    _cycleKnob() {
        const order = [KNOB.OFF, KNOB.COOK, KNOB.WARM];
        const idx   = order.indexOf(this._knob);
        this.setKnob(order[(idx+1) % order.length]);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  Tick — 由 consys._tickAll 在 20fps 调用
    // ═══════════════════════════════════════════════════════════════════
    tick(dt) {
        this._tickPhysics(dt);
        this._tickThermostatLogic(dt);
        this._tickBimetalDeflection(dt);
        this._tickContactAnim(dt);
        this._tickKnobAnim(dt);
        this._tickHistoryRecord(dt);
        this._tickCycleRecord(dt);
        this._rebuildBimetal();
        this._rebuildWires();
        this._rebuildPanelDyn();
        this._rebuildCycleWave();
        this._rebuildTempChart();
        this._rebuildWaterLayer();
        this._updateHeaterGlow();
        this._refreshCache();
    }

    // ── 温度物理仿真 ─────────────────────────────────────────────────
    _tickPhysics(dt) {
        const sdt  = dt * this._simScale;
        const T    = this._temperature;
        const Ta   = this.ambientTemp;
        const k    = 0.018;
        const cookOn = (this._knob !== KNOB.OFF) && this._tcState === TC_STATE.CLOSED;
        const warmOn = (this._knob !== KNOB.OFF) && this._tcState !== TC_STATE.CLOSED;

        if (this._knob === KNOB.OFF) {
            // 自然冷却
            this._temperature = Math.max(Ta, T - k*(T-Ta)*sdt);
            return;
        }

        const P = cookOn ? this.cookPower : (warmOn ? this.warmPower : 0);
        const hasWater = this._waterLevel > 0.02;
        let dT;

        if (cookOn && hasWater && T < 100) {
            dT = (P*0.00078 - k*(T-Ta)) * sdt;
        } else if (cookOn && hasWater && T >= 100) {
            // 沸腾相变：温度被锁定
            dT = (P*0.000032) * sdt;
            this._waterLevel = Math.max(0, this._waterLevel - 0.0014*sdt);
        } else if (cookOn && !hasWater) {
            // 水干后急速升温
            dT = (P*0.0020 - k*(T-Ta)) * sdt;
        } else {
            // 保温：PID 近似
            const err = 70 - T;
            const Peff = Math.max(0, Math.min(this.warmPower, err*3.5));
            dT = (Peff*0.00042 - k*(T-Ta)) * sdt;
        }

        this._temperature = Math.max(Ta, T + dT);
        if (cookOn) this._cookProg = Math.min(1, this._cookProg + sdt*0.0065);
    }

    // ── 双金属片温控逻辑（闭环通断）────────────────────────────────
    _tickThermostatLogic(dt) {
        if (this._knob === KNOB.OFF) return;
        if (this._tcAnim.animating) return;  // 动画中不触发新动作

        const T = this._temperature;

        if (this._tcState === TC_STATE.CLOSED) {
            // 已接通 → 检测是否达到断开温度
            if (T >= this.tOpen) {
                this._startTrip();
            }
        } else if (this._tcState === TC_STATE.OPEN) {
            // 已断开 → 检测是否冷却到复原温度
            if (T <= this.tClose) {
                this._startClose();
            }
        }
    }

    // 触发断开动画
    _startTrip() {
        this._tcAnim.animating = true;
        this._tcAnim.animDir   = 1;    // 断开方向
        this._tcAnim.animT     = 0;
        this._tcAnim.animDur   = 0.25;
        this._tcState          = TC_STATE.TRIPPING;
        this.emit?.('trip', { temperature: this._temperature, cycleCount: this._cycleCount });
    }

    // 触发复原动画
    _startClose() {
        this._tcAnim.animating = true;
        this._tcAnim.animDir   = -1;   // 复原方向
        this._tcAnim.animT     = 0;
        this._tcAnim.animDur   = 0.40;
        this._tcState          = TC_STATE.CLOSING;
        this._cycleCount++;
        this.emit?.('close', { temperature: this._temperature, cycleCount: this._cycleCount });
    }

    // ── 双金属片挠度更新（物理计算，平滑跟随温度）───────────────────
    _tickBimetalDeflection(dt) {
        // 挠度目标：(T-25)/(T_open_max-25) 归一化，映射到 maxDeflect
        const T      = this._temperature;
        const target = Math.max(0, Math.min(1, (T-25)/155)) * this._maxDeflect;
        // 平滑跟随（热惯性）
        this._deflection += (target - this._deflection) * 0.06 * dt * this._simScale;
        this._deflection  = Math.max(0, this._deflection);

        // 触点间隙：仅在 TRIPPING/OPEN 状态下产生间隙
        const tripDeflect = (this.tOpen-25)/155 * this._maxDeflect;  // T_open 时的挠度
        if (this._tcState === TC_STATE.CLOSED || this._tcState === TC_STATE.CLOSING) {
            this._contactGap = 0;
        } else {
            // 断开量 = 当前挠度 - 触点接触时的临界挠度
            this._contactGap = Math.max(0, this._deflection - tripDeflect * 0.78);
        }
    }

    // ── 触点动画 tick ────────────────────────────────────────────────
    _tickContactAnim(dt) {
        const a = this._tcAnim;
        if (!a.animating) return;

        a.animT += dt / a.animDur;
        if (a.animT >= 1) {
            a.animT     = 1;
            a.animating = false;
            if (a.animDir > 0) {
                this._tcState = TC_STATE.OPEN;
            } else {
                this._tcState = TC_STATE.CLOSED;
            }
        }
    }

    // ── 旋钮旋转动画 tick ────────────────────────────────────────────
    _tickKnobAnim(dt) {
        if (!this._knobAnimating) return;
        this._knobAnimT += dt / this._knobAnimDur;
        if (this._knobAnimT >= 1) {
            this._knobAnimT     = 1;
            this._knobAnimating = false;
            this._knobAngle     = this._knobTarget;
            return;
        }
        const ease         = 0.5 - 0.5*Math.cos(this._knobAnimT * Math.PI);
        const startAngle   = this._knobAngle;
        this._knobAngle    = startAngle + (this._knobTarget - startAngle) * ease;
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

    _tickCycleRecord(dt) {
        this._cycleTimer += dt;
        if (this._cycleTimer >= 0.12) {
            this._cycleTimer = 0;
            this._cycleHistory.shift();
            const isOn = (this._tcState === TC_STATE.CLOSED) ? 1 : 0;
            this._cycleHistory.push(isOn);
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    //  外部操作接口
    // ═══════════════════════════════════════════════════════════════════

    /**
     * 设置旋钮档位
     *   knob：'off' | 'cook' | 'warm'
     */
    setKnob(knob) {
        if (knob === this._knob) return;
        const prev = this._knob;
        this._knob = knob;

        // 旋钮角度目标
        const angles = { [KNOB.OFF]:-90, [KNOB.COOK]:0, [KNOB.WARM]:90 };
        const fromAngle = angles[prev] ?? -90;
        this._knobAngle    = fromAngle;
        this._knobTarget   = angles[knob] ?? -90;
        this._knobAnimT    = 0;
        this._knobAnimating = true;

        if (knob === KNOB.OFF) {
            // 断电：不管触点状态，仿真停止
        } else if (prev === KNOB.OFF) {
            // 从断电切入：初始化触点状态
            // 若温度低于 T_close，触点应闭合
            if (this._temperature <= this.tClose) {
                this._tcState  = TC_STATE.CLOSED;
                this._waterLevel = 1.0;
                this._cookProg   = 0;
                if (knob === KNOB.COOK) this._cookCount++;
            } else {
                this._tcState = TC_STATE.OPEN;
            }
        }

        this.emit?.('knobChange', { knob });
        this._refreshCache();
    }

    /** 旋转到煮饭档（便捷方法）*/
    startCook() { this.setKnob(KNOB.COOK); }

    /** 旋转到保温档 */
    startWarm() { this.setKnob(KNOB.WARM); }

    /** 旋转到断电档 */
    powerOff() { this.setKnob(KNOB.OFF); }

    // ── 查询接口 ─────────────────────────────────────────────────────
    getKnob()         { return this._knob; }
    getTcState()      { return this._tcState; }
    getTemperature()  { return this._temperature; }
    getWaterLevel()   { return this._waterLevel; }
    getCookProgress() { return this._cookProg; }
    getDeflection()   { return this._deflection; }
    getContactGap()   { return this._contactGap; }
    getCycleCount()   { return this._cycleCount; }
    getCookCount()    { return this._cookCount; }
    isHeating()       { return this._knob !== KNOB.OFF && this._tcState === TC_STATE.CLOSED; }
    isWarming()       { return this._knob !== KNOB.OFF && this._tcState !== TC_STATE.CLOSED; }

    /** 手动加水 */
    refillWater(level = 1.0) {
        this._waterLevel = Math.min(1, Math.max(0, level));
        this._refreshCache();
    }

    // ═══════════════════════════════════════════════════════════════════
    //  配置字段
    // ═══════════════════════════════════════════════════════════════════
    getConfigFields() {
        return [
            { label:'位号/名称',           key:'label',        type:'text'   },
            { label:'额定电压 (V)',         key:'ratedVoltage', type:'number' },
            { label:'主加热功率 (W)',       key:'cookPower',    type:'number' },
            { label:'保温功率 (W)',         key:'warmPower',    type:'number' },
            { label:'双金属片断开温度 T_open (°C)',  key:'tOpen',  type:'number' },
            { label:'双金属片复原温度 T_close (°C)', key:'tClose', type:'number' },
            { label:'仿真加速倍率',         key:'simScale',     type:'number' },
            { label:'初始水量 (0~1)',       key:'waterLevel',   type:'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label)      this.label        = cfg.label;
        if (cfg.cookPower)  this.cookPower     = parseFloat(cfg.cookPower)  || this.cookPower;
        if (cfg.warmPower)  this.warmPower     = parseFloat(cfg.warmPower)  || this.warmPower;
        if (cfg.tOpen)      this.tOpen         = parseFloat(cfg.tOpen)      || this.tOpen;
        if (cfg.tClose)     this.tClose        = parseFloat(cfg.tClose)     || this.tClose;
        if (cfg.simScale)   this._simScale     = parseFloat(cfg.simScale)   || this._simScale;
        if (cfg.waterLevel !== undefined) this.refillWater(parseFloat(cfg.waterLevel));
        if (this._topenText) {
            this._topenText.text(`T断: ${this.tOpen}°C  T合: ${this.tClose}°C`);
        }
        this.config = { ...this.config, ...cfg };
        this._refreshCache();
    }

    destroy() {
        super.destroy?.();
    }
}