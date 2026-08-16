import { BaseComponent } from './BaseComponent.js';

/**
 * 传统电饭煲仿真组件（Rice Cooker — Magnetic Thermostat Type）
 *
 * ── 结构说明 ──────────────────────────────────────────────────────────
 *
 *  传统电饭煲采用纯机械结构，由以下关键部件组成：
 *
 *  1. 外壳（Housing）
 *     - 不锈钢或喷漆钢板外壳，内衬隔热材料
 *
 *  2. 内胆（Inner Pot）
 *     - 铝合金冲压成型，内壁涂不粘涂层（特氟龙）
 *     - 底部外壁紧贴加热盘，依靠接触传热
 *
 *  3. 加热盘（Heating Plate / Hotplate）
 *     - 电热管铸入铝盘（功率约 700W）
 *     - 与内胆底部紧密贴合，热阻极小
 *     - 盘中央凸台安装磁钢限温器
 *
 *  4. 磁钢限温器（Magnetic Temperature Limiter）← 核心切换元件
 *
 *     原理：
 *       ┌─────────────────────────────────────────────────────┐
 *       │  永磁铁（固定）                                      │
 *       │     ↕ 磁力吸附                                      │
 *       │  感温磁性钢片（随弹片浮动）                          │
 *       │     ↕ 弹性臂（双金属复合片）                        │
 *       │  触点（串联在主加热回路中）                          │
 *       └─────────────────────────────────────────────────────┘
 *
 *       常温 / 升温阶段（T < 103°C）：
 *         磁性钢片保持铁磁性 → 永磁铁将其吸住
 *         → 弹片被压平 → 触点闭合 → 大功率加热回路接通
 *
 *       水分蒸干，温度突破约 103°C（磁性钢片居里点）：
 *         磁性钢片铁磁性消失 → 永磁铁吸力骤降至零
 *         → 弹片弹力释放 → 弹片上弹 → 触点断开
 *         → 同步：联动推杆顶开煮饭按键棘爪 → 按键弹起
 *         → 大功率加热回路切断，小功率保温回路接通
 *
 *     关键物理：
 *       - 水沸腾的汽化潜热（2257 kJ/kg）是天然温度"保险丝"
 *       - 只要锅内有水，锅底温度就被锁定在约 100°C，不会触发跳闸
 *       - 一旦水蒸干，失去相变缓冲，温度在数秒内飙升突破 103°C
 *       - 整个切换过程无需任何电子元件，纯粹依靠材料物性
 *
 *  5. 煮饭按键（Cook Lever / Push Button）
 *     - 按下时：压缩弹簧，棘爪卡住按键，维持压下状态
 *     - 弹起时：限温器联动杆顶开棘爪 → 弹簧将按键弹出（行程约 10mm）
 *
 *  6. 保温加热器（Warm Heater，约 40W）
 *     - 始终接通，独立双金属片恒温器在 65～75°C 反复通断
 *     - 煮饭期间温度高于保温目标，该恒温器处于断开状态
 *
 *  7. 指示灯
 *     - 红灯（煮饭）：与大功率加热盘并联，按键压下时亮
 *     - 黄灯（保温）：与保温加热器并联，跳闸后亮
 *
 * ── 状态机 ────────────────────────────────────────────────────────────
 *
 *  IDLE  ──[pressCook()]──► COOKING
 *  COOKING ──[T ≥ tripTemp，磁钢失磁]──► TRIPPING（动画 ~200ms）
 *  TRIPPING ──[动画结束]──► WARMING
 *  WARMING ──[pressCook()]──► COOKING（加水重置，再次煮饭）
 *
 * ── 温度物理模型 ──────────────────────────────────────────────────────
 *
 *  COOKING 阶段：
 *    ① 升温段（T < 100°C，有水）
 *         dT = (cookPower × 0.00075 − k×(T−Ta)) × simScale × dt
 *    ② 沸腾段（T ≈ 100°C，有水）
 *         汽化潜热锁温：dT ≈ 0，水位以 0.0016/s 速率蒸发
 *    ③ 干烧段（waterLevel < 2%）
 *         dT = (cookPower × 0.0018 − k×(T−Ta)) × simScale × dt
 *         温度在 2～3s 内突破 tripTemp
 *
 *  WARMING 阶段：PID 近似，目标 warmTarget°C
 *  IDLE 阶段：自然冷却至室温
 *
 * ── 动画时序 ──────────────────────────────────────────────────────────
 *
 *  跳闸触发：
 *    t=0ms   _doTrip() 调用
 *              → _bimetal.animating = true（弹片上弹，200ms spring 缓动）
 *              → _button.animating  = true（按键弹起，120ms sin 缓动）
 *              → state = TRIPPING
 *    t≈250ms  state = WARMING
 *
 * ── 绘制分层 ──────────────────────────────────────────────────────────
 *
 *  Layer 0  底座（base）
 *  Layer 1  外壳主体（housing）
 *  Layer 2  加热盘 + _heaterGlow（动态透明度）
 *  Layer 3  内胆 + _waterGroup（动态重绘）
 *  Layer 4  锅盖（lid）
 *  Layer 5  _limiterGroup — 磁钢限温器（动态重绘）
 *  Layer 6  _panelGroup  — 面板、按键、LED（动态重绘）
 *  Layer 7  接线示意（_cookWireL/R, _warmWireL/R，动态颜色）
 *  Layer 8  标注文字
 *
 * ── 端口 ──────────────────────────────────────────────────────────────
 *  power_l   — 火线输入（L）
 *  power_n   — 零线输入（N）
 *  cook_out  — 煮饭加热盘输出（H1，700W 大功率回路）
 *  warm_out  — 保温加热器输出（H2，40W 小功率回路）
 */

// ═══════════════════════════════════════════════════════════════════════
//  状态枚举
// ═══════════════════════════════════════════════════════════════════════
const RC_STATE = {
    IDLE:     'idle',
    COOKING:  'cooking',
    TRIPPING: 'tripping',   // 跳闸动画进行中（约 200ms）
    WARMING:  'warming',
};

// ═══════════════════════════════════════════════════════════════════════
//  传统电饭煲仿真主类
// ═══════════════════════════════════════════════════════════════════════
export class RiceCooker extends BaseComponent {

    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(220, config.width  || 260);
        this.height = Math.max(340, config.height || 380);

        this.type    = 'rice_cooker';
        this.special = 'none';
        this.cache   = 'fixed';

        this._initGroups();
        // ── 额定参数 ────────────────────────────────────────────────
        this.label        = config.label        || 'RC';
        this.ratedVoltage = config.ratedVoltage || 220;    // V
        this.cookPower    = config.cookPower    || 700;    // W，煮饭功率
        this.warmPower    = config.warmPower    || 40;     // W，保温功率
        this.tripTemp     = config.tripTemp     || 103;    // °C，磁钢失磁触发温度
        this.warmTarget   = config.warmTarget   || 70;     // °C，保温目标
        this.ambientTemp  = config.ambientTemp  || 25;     // °C，环境温度

        // 仿真加速倍率（真实煮饭 ~20min，仿真 ~30s）
        this._simScale    = config.simScale     || 36;

        // ── 物理状态 ────────────────────────────────────────────────
        this._state       = RC_STATE.IDLE;
        this._temperature = this.ambientTemp;
        this._waterLevel  = config.waterLevel !== undefined
                            ? Number(config.waterLevel) : 1.0;   // 0~1
        this._cookProg    = 0;      // 煮饭进度 0~1（用于饭色渲染）
        this._cookCount   = config.initCookCount || 0;
        this._magnetStr   = 1.0;   // 磁力强度 0~1

        // ── 磁钢限温器动画状态 ───────────────────────────────────
        this._bimetal = {
            tripped:   false,   // false = 弹片压下（接通），true = 弹起（断开）
            animating: false,
            animT:     0,
            animDur:   0.20,    // s
            offset:    0,       // px，弹片上弹位移（0=压下，10=弹起）
        };

        // ── 煮饭按键动画状态 ─────────────────────────────────────
        this._button = {
            pressed:   false,   // 是否处于压下锁定状态
            animating: false,
            animT:     0,
            animDur:   0.12,    // s
            offset:    0,       // px，按键压入深度（0=弹起，14=压下）
        };

        // ── 温度历史（迷你曲线图，60 个采样点）─────────────────
        this._tempHistory = new Array(60).fill(this.ambientTemp);
        this._histTimer   = 0;

        // ── 初始化绘制 ───────────────────────────────────────────
        this._layout = this._calcLayout();
        this._init();

        // ── 端口 ─────────────────────────────────────────────────
        const L = this._layout;
        this.addPort(L.base.x + 12, L.base.y + L.base.h + 4, 'power_l',  'wire', 'L');
        this.addPort(L.base.x + 32, L.base.y + L.base.h + 4, 'power_n',  'wire', 'N');
        this.addPort(L.base.x + 60, L.base.y + L.base.h + 4, 'cook_out', 'wire', 'H1');
        this.addPort(L.base.x + 80, L.base.y + L.base.h + 4, 'warm_out', 'wire', 'H2');
    }

    // ═══════════════════════════════════════════════════════════════════
    //  布局计算
    // ═══════════════════════════════════════════════════════════════════
    _calcLayout() {
        const W = this.width, H = this.height;
        return {
            housing:   { x: W*0.06, y: H*0.01, w: W*0.88, h: H*0.70, rx: 16 },
            lid:       { x: W*0.09, y: H*0.01, w: W*0.82, h: H*0.09, rx: 8  },
            pot:       { x: W*0.14, y: H*0.09, w: W*0.72, h: H*0.36, rx: 6  },
            heater:    { x: W*0.18, y: H*0.44, w: W*0.64, h: H*0.07, rx: 4  },
            limiter:   { x: W*0.36, y: H*0.52, w: W*0.28, h: H*0.06 },
            base:      { x: W*0.06, y: H*0.71, w: W*0.88, h: H*0.07, rx: 6  },
            panel:     { x: W*0.06, y: H*0.78, w: W*0.88, h: H*0.20, rx: 8  },
            thermArea: { x: W*0.08, y: H*0.80, w: W*0.30, h: H*0.17 },
            btnArea:   { x: W*0.42, y: H*0.80, w: W*0.50, h: H*0.17 },
        };
    }

    // ═══════════════════════════════════════════════════════════════════
    //  初始化绘制（静态结构 + 动态分层）
    // ═══════════════════════════════════════════════════════════════════
    _init() {
        this._drawHousing();
        this._drawLid();
        this._drawPot();           // 含 _waterGroup（动态）
        this._drawHeatingPlate();  // 含 _heaterGlow（动态透明度）
        this._drawLimiterLayer();  // 磁钢限温器，_limiterGroup（动态重绘）
        this._drawBase();
        this._drawPanel();         // 含 _panelGroup（动态重绘）
        this._drawWiring();
        this._drawLabel();
        this._bindInteraction();
    }

    // ───────────────────────────────────────────────────────────────────
    //  外壳（不锈钢拉丝质感）
    // ───────────────────────────────────────────────────────────────────
    _drawHousing() {
        const h = this._layout.housing;
        this._staticGroup.add(new Konva.Rect({
            x: h.x, y: h.y, width: h.w, height: h.h,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: h.w, y: 0 },
            fillLinearGradientColorStops: [
                0, '#b8b8b8', 0.12, '#d8d8d8', 0.40, '#f0f0f0',
                0.60, '#f0f0f0', 0.88, '#d0d0d0', 1, '#b0b0b0',
            ],
            stroke: '#909090', strokeWidth: 1.5, cornerRadius: h.rx,
            shadowColor: '#000', shadowBlur: 8, shadowOffsetY: 3, shadowOpacity: 0.22,
        }));
        // 顶部高光
        this._staticGroup.add(new Konva.Rect({
            x: h.x+4, y: h.y+2, width: h.w-8, height: h.h*0.07,
            fill: 'rgba(255,255,255,0.52)', cornerRadius: [h.rx, h.rx, 0, 0],
        }));
        // 左侧竖向光泽线
        this._staticGroup.add(new Konva.Line({
            points: [h.x+h.w*0.10, h.y+14, h.x+h.w*0.10, h.y+h.h-14],
            stroke: 'rgba(255,255,255,0.32)', strokeWidth: 3, lineCap: 'round',
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    //  锅盖
    // ───────────────────────────────────────────────────────────────────
    _drawLid() {
        const l = this._layout.lid;
        const W = this.width;
        // 盖体
        this._staticGroup.add(new Konva.Rect({
            x: l.x, y: l.y, width: l.w, height: l.h,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: 0, y: l.h },
            fillLinearGradientColorStops: [0,'#d8d8d8', 0.5,'#efefef', 1,'#b8b8b8'],
            stroke: '#8a8a8a', strokeWidth: 1.2, cornerRadius: l.rx,
        }));
        // 提手
        this._staticGroup.add(new Konva.Rect({
            x: W*0.38, y: l.y-5, width: W*0.24, height: 11,
            fill: '#c03020', stroke: '#8a1a10', strokeWidth: 1, cornerRadius: 4,
        }));
        // 排气孔
        for (let i = 0; i < 6; i++) {
            this._staticGroup.add(new Konva.Circle({
                x: W*(0.33+i*0.065), y: l.y+l.h*0.55,
                radius: 2.2, fill: '#909090', stroke: '#707070', strokeWidth: 0.5,
            }));
        }
        // 密封胶条
        this._staticGroup.add(new Konva.Rect({
            x: l.x+2, y: l.y+l.h-3, width: l.w-4, height: 4,
            fill: '#808080', cornerRadius: 2,
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    //  内胆（剖面）+ 动态水/饭层
    // ───────────────────────────────────────────────────────────────────
    _drawPot() {
        const p = this._layout.pot;
        // 外壁
        this._staticGroup.add(new Konva.Rect({
            x: p.x, y: p.y, width: p.w, height: p.h,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: p.w, y: 0 },
            fillLinearGradientColorStops: [
                0,'#707878', 0.2,'#a8b4b8', 0.5,'#c0ccd0', 0.8,'#a0acb0', 1,'#707878',
            ],
            stroke: '#607080', strokeWidth: 1, cornerRadius: p.rx,
        }));
        // 动态水/饭层
        this._waterGroup = new Konva.Group();
        this._staticGroup.add(this._waterGroup);
        this._rebuildWaterLayer();
        // 内壁不粘涂层描边
        this._staticGroup.add(new Konva.Rect({
            x: p.x+5, y: p.y+3, width: p.w-10, height: p.h-6,
            fill: 'none', stroke: 'rgba(40,40,40,0.18)', strokeWidth: 0.8,
            cornerRadius: p.rx-2,
        }));
    }

    _rebuildWaterLayer() {
        this._waterGroup.destroyChildren();
        const p  = this._layout.pot;
        const wl = Math.max(0, Math.min(1, this._waterLevel));
        if (wl <= 0) return;

        const innerH = p.h - 8;
        const waterH = innerH * wl;
        const waterY = p.y + p.h - 4 - waterH;

        // 颜色随进度变化：生米+水(蓝白) → 半熟(乳绿) → 熟饭(黄白)
        let c1, c2;
        const prog = this._cookProg;
        if (prog > 0.85)      { c1 = '#f4ead0'; c2 = '#e8d8a8'; }
        else if (prog > 0.40) { c1 = '#eef4e4'; c2 = '#d4e8c0'; }
        else                  { c1 = '#c0d8e4'; c2 = '#9cc0cc'; }

        this._waterGroup.add(new Konva.Rect({
            x: p.x+5, y: waterY, width: p.w-10, height: waterH,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: 0, y: waterH },
            fillLinearGradientColorStops: [0, c1, 1, c2],
            cornerRadius: [0,0,p.rx-2,p.rx-2],
        }));

        // 沸腾气泡（COOKING && T ≥ 98°C）
        if (this._state === RC_STATE.COOKING && this._temperature >= 98) {
            for (let i = 0; i < 9; i++) {
                this._waterGroup.add(new Konva.Circle({
                    x: p.x + 8 + Math.random()*(p.w-16),
                    y: waterY + 6 + Math.random()*(waterH-12),
                    radius: 1.8 + Math.random()*2.5,
                    fill: 'rgba(255,255,255,0.58)',
                }));
            }
            // 水面波纹
            const pts = [];
            for (let x = 0; x <= p.w-10; x += 5) {
                pts.push(p.x+5+x, waterY + Math.sin(x*0.18)*2.5);
            }
            this._waterGroup.add(new Konva.Line({
                points: pts, stroke: 'rgba(255,255,255,0.38)',
                strokeWidth: 1.5, tension: 0.4, lineCap: 'round',
            }));
        }

        // 蒸汽（COOKING，T > 60°C）
        if (this._state === RC_STATE.COOKING && this._temperature > 60) {
            const alpha = Math.min(0.55, (this._temperature-60)/60);
            const W = this.width;
            [W*0.28, W*0.45, W*0.62].forEach((sx, i) => {
                this._waterGroup.add(new Konva.Line({
                    points: [sx, this._layout.lid.y-4, sx+(i-1)*5, this._layout.lid.y-14, sx, this._layout.lid.y-22],
                    stroke: `rgba(170,200,220,${alpha.toFixed(2)})`,
                    strokeWidth: 2.8, lineCap: 'round', tension: 0.5,
                }));
            });
        }
    }

    // ───────────────────────────────────────────────────────────────────
    //  加热盘
    // ───────────────────────────────────────────────────────────────────
    _drawHeatingPlate() {
        const hp = this._layout.heater;
        // 铝盘主体
        this._staticGroup.add(new Konva.Rect({
            x: hp.x, y: hp.y, width: hp.w, height: hp.h,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: hp.w, y: 0 },
            fillLinearGradientColorStops: [0,'#604820', 0.3,'#b86820', 0.7,'#b86820', 1,'#604820'],
            stroke: '#402808', strokeWidth: 1, cornerRadius: hp.rx,
        }));
        // 电热管纹路
        for (let i = 0; i < 5; i++) {
            this._staticGroup.add(new Konva.Line({
                points: [hp.x+hp.w*(0.08+i*0.20), hp.y+2, hp.x+hp.w*(0.08+i*0.20), hp.y+hp.h-2],
                stroke: 'rgba(60,30,5,0.38)', strokeWidth: 1, lineCap: 'round',
            }));
        }
        // 发光叠层（动态透明度）
        this._heaterGlow = new Konva.Rect({
            x: hp.x, y: hp.y, width: hp.w, height: hp.h,
            fill: 'rgba(255,75,0,0)', cornerRadius: hp.rx,
        });
        this._staticGroup.add(this._heaterGlow);
    }

    // ───────────────────────────────────────────────────────────────────
    //  磁钢限温器动态层
    // ───────────────────────────────────────────────────────────────────
    _drawLimiterLayer() {
        this._limiterGroup = new Konva.Group();
        this._staticGroup.add(this._limiterGroup);
        this._rebuildLimiter();
    }

    /**
     * 磁钢限温器完整重绘
     *
     * 构成（从上到下）：
     *   固定支架（铆在加热盘凸台上）
     *   └── 永磁铁（圆柱形，银白色，始终固定）
     *       └── 感温磁性钢片（随弹片浮动，接触/离开永磁铁）
     *   弹性臂（双层复合弹片：上层因瓦合金，下层黄铜）
     *   └── 动触点（弹片末端）↔ 静触点（固定在支架上）
     *   联动推杆（弹片末端 → 按键底部）
     */
    _rebuildLimiter() {
        this._limiterGroup.destroyChildren();
        const lm     = this._layout.limiter;
        const bi     = this._bimetal;
        const offset = bi.offset;      // 弹片上弹量 px（0=压下/接通，10=弹起/断开）
        const closed = offset < 4;     // 触点是否接通

        // ── 固定支架（深灰，铸铁色）──
        const brX = lm.x + lm.w*0.38;
        const brY = lm.y - 2;
        this._limiterGroup.add(new Konva.Rect({
            x: brX-5, y: brY, width: 10, height: lm.h*1.8,
            fill: '#505050', stroke: '#303030', strokeWidth: 0.8, cornerRadius: 2,
        }));

        // ── 永磁铁（固定，圆柱截面，银灰色）──
        const magX = brX-10, magY = brY+2, magW = 20, magH = 11;
        this._limiterGroup.add(new Konva.Rect({
            x: magX, y: magY, width: magW, height: magH,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: magW, y: 0 },
            fillLinearGradientColorStops: [0,'#808080', 0.5,'#d8d8d8', 1,'#808080'],
            stroke: '#505050', strokeWidth: 0.8, cornerRadius: 3,
        }));
        // 永磁铁标注
        this._limiterGroup.add(new Konva.Text({
            x: magX, y: magY+2, width: magW, text: 'N S',
            fontSize: 7.5, fill: '#303030', align: 'center', fontStyle: 'bold',
        }));

        // 磁力线（随 magnetStr 淡化，失磁时消失）
        const magAlpha = Math.max(0.05, this._magnetStr * 0.50);
        for (let i = 0; i < 4; i++) {
            this._limiterGroup.add(new Konva.Arc({
                x: magX+magW/2, y: magY+magH,
                innerRadius: 5+i*5, outerRadius: 6+i*5,
                angle: 180, fill: `rgba(50,110,220,${(magAlpha-i*0.02).toFixed(3)})`,
                rotation: 0,
            }));
        }

        // ── 感温磁性钢片（随弹片浮动）──
        // 接通时：紧贴永磁铁底面（chipY ≈ magY+magH）
        // 断开时：随弹片上弹 offset px 后离开
        const chipY = magY + magH - offset;
        this._limiterGroup.add(new Konva.Rect({
            x: magX+2, y: chipY, width: magW-4, height: 5,
            fill: closed ? '#c8a840' : '#909090',
            stroke: '#606060', strokeWidth: 0.6, cornerRadius: 1,
            shadowColor: closed ? '#ffcc40' : 'transparent',
            shadowBlur: closed ? 4 : 0, shadowOpacity: 0.7,
        }));

        // ── 弹性臂（双层复合片，以左端为固定端）──
        const armX  = lm.x;
        const armY  = lm.y + lm.h*0.5 - offset;   // 自由端随弹片浮动
        const armLen = lm.w * 0.76;
        // 上层：因瓦合金（低热膨胀系数，蓝灰色）
        this._limiterGroup.add(new Konva.Rect({
            x: armX, y: armY-4, width: armLen, height: 4,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: armLen, y: 0 },
            fillLinearGradientColorStops: [0,'#3a5898', 0.5,'#6080c8', 1,'#3a5898'],
            stroke: '#2a4070', strokeWidth: 0.5,
        }));
        // 下层：黄铜（高热膨胀系数，金黄色）
        this._limiterGroup.add(new Konva.Rect({
            x: armX, y: armY, width: armLen, height: 4,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: armLen, y: 0 },
            fillLinearGradientColorStops: [0,'#7a6030', 0.5,'#d8b050', 1,'#7a6030'],
            stroke: '#6a5020', strokeWidth: 0.5,
        }));
        // 弹片左侧固定铆钉
        this._limiterGroup.add(new Konva.Circle({
            x: armX+4, y: armY-2, radius: 3.5,
            fill: '#505050', stroke: '#303030', strokeWidth: 0.8,
        }));

        // ── 触点（动触点 + 静触点）──
        const tcX     = armX + armLen;
        const dynY    = armY - 2;                      // 动触点：随弹片浮动
        const fixedY  = lm.y + lm.h*0.5 + 1;          // 静触点：始终固定
        const tcColor = closed ? '#e8c040' : '#909090';
        const tcGlow  = closed ? '#ffcc40' : 'transparent';
        // 静触点（固定，连到接线柱）
        this._limiterGroup.add(new Konva.Rect({
            x: tcX, y: fixedY-12, width: 3, height: 16,
            fill: '#606060', stroke: '#404040', strokeWidth: 0.5,
        }));
        this._limiterGroup.add(new Konva.Circle({
            x: tcX+1.5, y: fixedY, radius: 4,
            fill: '#909090', stroke: '#606060', strokeWidth: 0.8,
        }));
        // 动触点（浮动）
        this._limiterGroup.add(new Konva.Circle({
            x: tcX+1.5, y: dynY, radius: 4,
            fill: tcColor, stroke: closed?'#a08020':'#707070', strokeWidth: 0.8,
            shadowColor: tcGlow, shadowBlur: closed?6:0, shadowOpacity: 0.85,
        }));
        // 接触间隙标注（断开时）
        if (!closed) {
            this._limiterGroup.add(new Konva.Line({
                points: [tcX-8, fixedY, tcX-8, dynY],
                stroke: '#d85820', strokeWidth: 1, dash: [2,1],
            }));
            this._limiterGroup.add(new Konva.Text({
                x: tcX-24, y: (fixedY+dynY)/2-5,
                text: `${(offset*0.8).toFixed(1)}mm`,
                fontSize: 7, fill: '#d85820',
            }));
        }

        // 接通时电流粒子（橙黄色小点）
        if (closed) {
            for (let i = 0; i < 5; i++) {
                this._limiterGroup.add(new Konva.Circle({
                    x: armX + armLen*(0.10+i*0.18),
                    y: armY,
                    radius: 1.8,
                    fill: 'rgba(255,200,60,0.80)',
                }));
            }
        }

        // ── 联动推杆（弹片末端 → 按键底部，虚线）──
        const rodX  = tcX + 14;
        const rodY1 = dynY;                         // 随弹片浮动
        const rodY2 = this._layout.panel.y;         // 按键底部
        this._limiterGroup.add(new Konva.Line({
            points: [rodX, rodY1, rodX, rodY2],
            stroke: '#686868', strokeWidth: 2, dash: [4,2], lineCap: 'round',
        }));
        // 推杆末端箭头
        this._limiterGroup.add(new Konva.RegularPolygon({
            x: rodX, y: rodY1-2, sides: 3,
            radius: 4, fill: '#686868', rotation: 180,
        }));

        // ── 说明标注 ──
        this._limiterGroup.add(new Konva.Text({
            x: lm.x-2, y: lm.y-15,
            text: '磁钢限温器', fontSize: 7.5, fill: '#7090b0', fontStyle: 'italic',
        }));
        this._limiterGroup.add(new Konva.Text({
            x: lm.x-2, y: lm.y+lm.h+2,
            text: closed ? '● 吸合（主路接通）' : '⚡ 失磁（主路断开）',
            fontSize: 7.5,
            fill: closed ? '#4a9a4a' : '#d85a20',
            fontStyle: 'bold',
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    //  底座
    // ───────────────────────────────────────────────────────────────────
    _drawBase() {
        const b = this._layout.base;
        this._staticGroup.add(new Konva.Rect({
            x: b.x, y: b.y, width: b.w, height: b.h,
            fill: '#282828', stroke: '#181818', strokeWidth: 1.5,
            cornerRadius: b.rx,
            shadowColor: '#000', shadowBlur: 5, shadowOffsetY: 2, shadowOpacity: 0.30,
        }));
        // 防滑脚垫（4 个）
        for (let i = 0; i < 4; i++) {
            this._staticGroup.add(new Konva.Rect({
                x: b.x+b.w*(0.07+i*0.26)-10, y: b.y+b.h*0.55,
                width: 20, height: b.h*0.30,
                fill: '#141414', cornerRadius: 3,
            }));
        }
    }

    // ───────────────────────────────────────────────────────────────────
    //  操作面板
    // ───────────────────────────────────────────────────────────────────
    _drawPanel() {
        const pn = this._layout.panel;
        // 面板背景
        this._staticGroup.add(new Konva.Rect({
            x: pn.x, y: pn.y, width: pn.w, height: pn.h,
            fill: '#1a1a2a', stroke: '#2a2a40', strokeWidth: 1, cornerRadius: pn.rx,
        }));
        // 分隔线
        this._staticGroup.add(new Konva.Line({
            points: [pn.x+pn.w*0.38, pn.y+6, pn.x+pn.w*0.38, pn.y+pn.h-6],
            stroke: '#2a2a40', strokeWidth: 1, dash: [2,3],
        }));

        this._panelGroup = new Konva.Group();
        this._staticGroup.add(this._panelGroup);

        this._drawThermoDisplay();
        this._drawCookButton();
        this._drawIndicatorLEDs();
        this._updatePanelVisuals();
    }

    // ── 温度显示 + 迷你曲线 ──────────────────────────────────────────
    _drawThermoDisplay() {
        const td = this._layout.thermArea;

        this._tempText = new Konva.Text({
            x: td.x, y: td.y+2, width: td.w,
            text: `${Math.round(this._temperature)}°`,
            fontSize: 30, fontStyle: 'bold', fontFamily: 'monospace',
            fill: '#3890d0', align: 'center',
            shadowColor: '#3890d0', shadowBlur: 5, shadowOpacity: 0.6,
        });
        this._panelGroup.add(this._tempText);

        this._stateText = new Konva.Text({
            x: td.x, y: td.y+38, width: td.w,
            text: '— 待机 —',
            fontSize: 9, fill: '#6878a0', align: 'center',
        });
        this._panelGroup.add(this._stateText);

        this._chartGroup = new Konva.Group();
        this._panelGroup.add(this._chartGroup);
        this._rebuildTempChart();
    }

    _rebuildTempChart() {
        this._chartGroup.destroyChildren();
        const td = this._layout.thermArea;
        const cx = td.x+1, cy = td.y+td.h-2, cw = td.w-2, ch = 28;

        this._chartGroup.add(new Konva.Rect({
            x: cx, y: cy-ch, width: cw, height: ch,
            fill: 'rgba(8,8,24,0.65)', stroke: '#1c2040', strokeWidth: 0.5, cornerRadius: 2,
        }));
        // 103°C 阈值线
        const ty = cy - ((this.tripTemp-20)/110)*ch;
        this._chartGroup.add(new Konva.Line({
            points: [cx, ty, cx+cw, ty],
            stroke: 'rgba(220,80,30,0.45)', strokeWidth: 0.8, dash: [3,2],
        }));
        this._chartGroup.add(new Konva.Text({
            x: cx+2, y: ty-9, text: `${this.tripTemp}°`,
            fontSize: 6.5, fill: 'rgba(220,100,40,0.70)',
        }));
        // 温度折线
        const pts = [];
        for (let i = 0; i < this._tempHistory.length; i++) {
            pts.push(
                cx + (i/(this._tempHistory.length-1))*cw,
                cy - ((this._tempHistory[i]-20)/110)*ch,
            );
        }
        this._chartGroup.add(new Konva.Line({
            points: pts, stroke: this._getTemperatureColor(),
            strokeWidth: 1.2, lineCap: 'round', lineJoin: 'round', tension: 0.3,
        }));
    }

    _getTemperatureColor() {
        const t = this._temperature;
        if (t >= 100) return '#d85a20';
        if (t >= 70)  return '#ba7418';
        if (t >= 50)  return '#c8a020';
        return '#3890d0';
    }

    // ── 煮饭按键（机械弹簧键）────────────────────────────────────────
    _drawCookButton() {
        const ba = this._layout.btnArea;
        const bw = ba.w*0.46, bh = ba.h*0.56;
        const bx = ba.x+2, by = ba.y+ba.h*0.08;

        // 阴影块（模拟立体侧面）
        this._btnShadow = new Konva.Rect({
            x: bx+3, y: by+5, width: bw, height: bh,
            fill: 'rgba(0,0,0,0.45)', cornerRadius: 7,
        });
        this._panelGroup.add(this._btnShadow);

        // 按键主体
        this._btnRect = new Konva.Rect({
            x: bx, y: by, width: bw, height: bh,
            fill: '#c02818', stroke: 'rgba(255,255,255,0.18)',
            strokeWidth: 0.8, cornerRadius: 7,
        });
        this._panelGroup.add(this._btnRect);

        // 按键高光
        this._btnHL = new Konva.Rect({
            x: bx+4, y: by+3, width: bw-8, height: bh*0.32,
            fill: 'rgba(255,255,255,0.20)', cornerRadius: [5,5,0,0],
        });
        this._panelGroup.add(this._btnHL);

        // 按键文字
        this._btnLabel = new Konva.Text({
            x: bx, y: by+bh*0.30, width: bw,
            text: '煮　饭',
            fontSize: 11, fontStyle: 'bold', fill: '#ffffff', align: 'center',
        });
        this._panelGroup.add(this._btnLabel);

        // 弹簧（按键左侧）
        this._springGroup = new Konva.Group();
        this._panelGroup.add(this._springGroup);

        // 行程刻度（按键右侧）
        for (let i = 0; i <= 3; i++) {
            this._panelGroup.add(new Konva.Line({
                points: [bx+bw+3, by+i*(bh/3), bx+bw+7, by+i*(bh/3)],
                stroke: '#3a3a50', strokeWidth: 0.8,
            }));
        }

        // 棘爪锁扣（按键右下）
        this._latchGroup = new Konva.Group();
        this._panelGroup.add(this._latchGroup);

        // 记录初始几何（动画用）
        this._btnBaseX = bx;
        this._btnBaseY = by;
        this._btnW     = bw;
        this._btnH     = bh;
    }

    _rebuildSpring(bx, by, bh) {
        this._springGroup.destroyChildren();
        const sx  = bx - 12;
        const sy1 = by + this._button.offset;  // 弹簧上端随按键浮动
        const sy2 = by + bh + 6;               // 弹簧下端固定
        const coils = 7;
        const pts = [sx, sy1];
        for (let i = 0; i < coils; i++) {
            const y = sy1 + (sy2-sy1)*((i+0.5)/coils);
            pts.push(sx + (i%2===0 ? -4 : 4), y);
        }
        pts.push(sx, sy2);
        this._springGroup.add(new Konva.Line({
            points: pts,
            stroke: '#7090b0', strokeWidth: 1.5, lineCap: 'round', lineJoin: 'round',
        }));
        // 上下固定板
        [[sx, sy1], [sx, sy2]].forEach(([px, py]) => {
            this._springGroup.add(new Konva.Line({
                points: [px-5, py, px+5, py],
                stroke: '#9090a0', strokeWidth: 2, lineCap: 'round',
            }));
        });
        // 弹力状态标注
        const compressed = this._button.offset > 6;
        this._springGroup.add(new Konva.Text({
            x: sx-22, y: (sy1+sy2)/2-4,
            text: compressed ? '压缩' : '自由',
            fontSize: 7.5,
            fill: compressed ? '#d85a20' : '#5888a8',
        }));
    }

    _rebuildLatch(bx, by, bw, bh) {
        this._latchGroup.destroyChildren();
        const pressed   = this._button.offset > 6;
        const lx        = bx + bw + 10;
        const ly        = by + this._button.offset;
        const hookColor = pressed ? '#4a9a4a' : '#8050a0';

        // 棘爪钩形
        this._latchGroup.add(new Konva.Line({
            points: [lx, ly+bh, lx, ly+bh*0.5, lx+9, ly+bh*0.5],
            stroke: hookColor, strokeWidth: 2.5, lineCap: 'round', lineJoin: 'round',
        }));
        // 状态标注
        this._latchGroup.add(new Konva.Text({
            x: lx+12, y: ly+bh*0.5-5,
            text: pressed ? '棘爪\n锁紧' : '棘爪\n释放',
            fontSize: 7.5, fill: hookColor, fontStyle: 'bold',
        }));
    }

    // ── 指示灯（红=煮饭，黄=保温）───────────────────────────────────
    _drawIndicatorLEDs() {
        const ba = this._layout.btnArea;
        const defs = [
            { key: 'cook', label: '煮饭', color: '#e83020', off: '#301010' },
            { key: 'warm', label: '保温', color: '#d89020', off: '#302010' },
        ];
        this._leds = {};
        defs.forEach((def, i) => {
            const lx = ba.x + ba.w*(0.56+i*0.25);
            const ly = ba.y + ba.h*0.24;
            // LED 外壳
            this._panelGroup.add(new Konva.Circle({
                x: lx, y: ly, radius: 8,
                fill: '#181820', stroke: '#303040', strokeWidth: 0.8,
            }));
            // LED 芯（动态）
            const led = new Konva.Circle({
                x: lx, y: ly, radius: 5.5,
                fill: def.off,
            });
            this._panelGroup.add(led);
            this._leds[def.key] = { circle: led, color: def.color, off: def.off };
            // 文字标注
            this._panelGroup.add(new Konva.Text({
                x: lx-12, y: ly+10, width: 24, text: def.label,
                fontSize: 8, fill: '#5060a0', align: 'center',
            }));
        });
    }

    // ── 统一刷新面板可视状态 ─────────────────────────────────────────
    _updatePanelVisuals() {
        if (!this._btnRect || !this._panelGroup) return;

        const offset   = this._button.offset;  // 0=弹起，14=压下
        const by       = this._btnBaseY + offset;
        const cooking  = this._state === RC_STATE.COOKING || this._state === RC_STATE.TRIPPING;
        const warming  = this._state === RC_STATE.WARMING;

        // 按键随 offset 下移
        this._btnRect.y(by);
        this._btnHL.y(by+3);
        this._btnLabel.y(by + this._btnH*0.30);
        this._btnShadow.y(this._btnBaseY + 5 + offset*0.5);
        this._btnRect.fill(cooking ? '#e83028' : '#c02818');

        // 重绘弹簧和棘爪
        this._rebuildSpring(this._btnBaseX, this._btnBaseY, this._btnH);
        this._rebuildLatch(this._btnBaseX, this._btnBaseY, this._btnW, this._btnH);

        // LED
        if (this._leds) {
            const cookL = this._leds['cook'];
            const warmL = this._leds['warm'];
            if (cookL) {
                cookL.circle.fill(cooking ? cookL.color : cookL.off);
                cookL.circle.shadowColor(cooking ? cookL.color : 'transparent');
                cookL.circle.shadowBlur(cooking ? 8 : 0);
                cookL.circle.shadowOpacity(0.9);
            }
            if (warmL) {
                warmL.circle.fill(warming ? warmL.color : warmL.off);
                warmL.circle.shadowColor(warming ? warmL.color : 'transparent');
                warmL.circle.shadowBlur(warming ? 8 : 0);
                warmL.circle.shadowOpacity(0.9);
            }
        }

        // 温度数字
        if (this._tempText) {
            this._tempText.text(`${Math.round(this._temperature)}°`);
            const c = this._getTemperatureColor();
            this._tempText.fill(c);
            this._tempText.shadowColor(c);
        }
        // 状态文字
        if (this._stateText) {
            const map = {
                [RC_STATE.IDLE]:     '— 待机 —',
                [RC_STATE.COOKING]:  '▶ 煮饭中',
                [RC_STATE.TRIPPING]: '⚡ 跳闸！',
                [RC_STATE.WARMING]:  '◆ 保温中',
            };
            this._stateText.text(map[this._state] || '—');
        }
    }

    // ───────────────────────────────────────────────────────────────────
    //  电路接线示意
    // ───────────────────────────────────────────────────────────────────
    _drawWiring() {
        const hp   = this._layout.heater;
        const base = this._layout.base;
        const y1   = hp.y + hp.h/2 - 3;   // 主加热回路
        const y2   = hp.y + hp.h/2 + 5;   // 保温回路

        this._cookWireL = new Konva.Line({
            points: [base.x, y1, hp.x, y1],
            stroke: '#404040', strokeWidth: 1.2, dash: [5,3], lineCap: 'round',
        });
        this._cookWireR = new Konva.Line({
            points: [hp.x+hp.w, y1, base.x+base.w, y1],
            stroke: '#404040', strokeWidth: 1.2, dash: [5,3], lineCap: 'round',
        });
        this._warmWireL = new Konva.Line({
            points: [base.x, y2, hp.x, y2],
            stroke: '#303030', strokeWidth: 1.2, dash: [3,4], lineCap: 'round',
        });
        this._warmWireR = new Konva.Line({
            points: [hp.x+hp.w, y2, base.x+base.w, y2],
            stroke: '#303030', strokeWidth: 1.2, dash: [3,4], lineCap: 'round',
        });
        this._staticGroup.add(this._cookWireL, this._cookWireR, this._warmWireL, this._warmWireR);

        // 线路端子标注
        this._staticGroup.add(new Konva.Text({
            x: base.x+2, y: y1-9, text: 'L', fontSize: 8, fill: '#705040', fontStyle: 'bold',
        }));
        this._staticGroup.add(new Konva.Text({
            x: base.x+2, y: y2+2, text: 'N', fontSize: 8, fill: '#506060', fontStyle: 'bold',
        }));
    }

    _updateWiring() {
        if (!this._cookWireL) return;
        const cookOn = this._state === RC_STATE.COOKING;
        const warmOn = this._state === RC_STATE.WARMING;
        this._cookWireL.stroke(cookOn ? '#d85820' : '#404040');
        this._cookWireR.stroke(cookOn ? '#d85820' : '#404040');
        this._warmWireL.stroke(warmOn ? '#d8a020' : '#303030');
        this._warmWireR.stroke(warmOn ? '#d8a020' : '#303030');
    }

    // ───────────────────────────────────────────────────────────────────
    //  标注
    // ───────────────────────────────────────────────────────────────────
    _drawLabel() {
        this._staticGroup.add(new Konva.Text({
            x: 0, y: -16, width: this.width,
            text: `${this.label}  传统电饭煲  ${this.ratedVoltage}V / ${this.cookPower}W`,
            fontSize: 9, fontStyle: 'bold', fill: '#546e7a', align: 'center',
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    //  交互绑定
    // ───────────────────────────────────────────────────────────────────
    _bindInteraction() {
        setTimeout(() => {
            if (this._btnRect) {
                this._btnRect.on('click tap', () => this.pressCook());
                this._btnRect.on('mouseenter', () => {
                    if (this._state !== RC_STATE.COOKING) document.body.style.cursor = 'pointer';
                });
                this._btnRect.on('mouseleave', () => { document.body.style.cursor = 'default'; });
            }
            if (this._btnLabel) {
                this._btnLabel.on('click tap', () => this.pressCook());
            }
        }, 80);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  Tick — 由 consys._tickAll 在 20fps 调用
    // ═══════════════════════════════════════════════════════════════════
    tick(dt) {
        this._tickPhysics(dt);
        this._tickBimetalAnim(dt);
        this._tickButtonAnim(dt);
        this._tickHistoryRecord(dt);
        this._tickRefreshDisplay();
    
        this._refreshCache();
    }

    // ── 温度物理仿真 ─────────────────────────────────────────────────
    _tickPhysics(dt) {
        const sdt = dt * this._simScale;
        const T   = this._temperature;
        const Ta  = this.ambientTemp;
        const k   = 0.018;

        if (this._state === RC_STATE.COOKING) {
            const hasWater = this._waterLevel > 0.02;
            let dT;

            if (hasWater && T < 100) {
                // ① 升温段：水比热大，升温较慢
                dT = (this.cookPower * 0.00075 - k*(T-Ta)) * sdt;
            } else if (hasWater && T >= 100) {
                // ② 沸腾段：汽化潜热锁温，水位持续下降
                dT = (this.cookPower * 0.000040) * sdt;
                this._waterLevel = Math.max(0, this._waterLevel - 0.0016*sdt);
            } else {
                // ③ 干烧段：失去相变缓冲，温度急升
                dT = (this.cookPower * 0.0018 - k*(T-Ta)) * sdt;
            }

            this._temperature = Math.max(Ta, T + dT);
            this._cookProg    = Math.min(1, this._cookProg + sdt*0.007);

            // 磁力强度：T < 90°C 满额；90 → tripTemp 线性衰减；≥ tripTemp 归零
            this._magnetStr = T < 90 ? 1.0
                : T < this.tripTemp ? 1.0 - (T-90)/(this.tripTemp-90)*0.90
                : 0.0;

            // 触发跳闸
            if (this._temperature >= this.tripTemp && !this._bimetal.tripped) {
                this._doTrip();
            }

        } else if (this._state === RC_STATE.WARMING) {
            const err   = this.warmTarget - T;
            const power = Math.max(0, Math.min(this.warmPower, err*3.0));
            const dT    = (power*0.00040 - k*(T-Ta)) * sdt;
            this._temperature = Math.max(Ta, T + dT);
            this._magnetStr   = 0;

        } else {
            // IDLE / TRIPPING：自然冷却
            const dT = -k*(T-Ta)*sdt;
            this._temperature = Math.max(Ta, T + dT);
            if (this._state === RC_STATE.IDLE) this._magnetStr = 1.0;
        }
    }

    // ── 触发跳闸序列 ─────────────────────────────────────────────────
    _doTrip() {
        if (this._bimetal.tripped || this._bimetal.animating) return;

        // 弹片上弹动画
        this._bimetal.tripped   = true;
        this._bimetal.animating = true;
        this._bimetal.animT     = 0;

        this._state = RC_STATE.TRIPPING;

        // 同步：按键弹起动画
        this._button.pressed   = false;
        this._button.animating = true;
        this._button.animT     = 0;

        this.emit?.('trip', {
            temperature: this._temperature,
            waterLevel:  this._waterLevel,
        });

        // 动画结束后切换到 WARMING
        setTimeout(() => {
            if (this._state === RC_STATE.TRIPPING) {
                this._state = RC_STATE.WARMING;
                this.emit?.('stateChange', { state: RC_STATE.WARMING });
            }
        }, Math.round(this._bimetal.animDur * 1000) + 60);
    }

    // ── 磁钢弹片动画 tick ────────────────────────────────────────────
    _tickBimetalAnim(dt) {
        const bi = this._bimetal;
        if (!bi.animating) return;

        bi.animT += dt / bi.animDur;
        if (bi.animT >= 1) { bi.animT = 1; bi.animating = false; }

        const ease = this._springEase(bi.animT);
        // tripped=true: 0→10（弹起）；false: 10→0（复位）
        bi.offset = bi.tripped ? 10*ease : 10*(1-ease);

        this._rebuildLimiter();
        this._refreshCache();
    }

    // ── 煮饭按键动画 tick ────────────────────────────────────────────
    _tickButtonAnim(dt) {
        const cb = this._button;
        if (!cb.animating) return;

        cb.animT += dt / cb.animDur;
        if (cb.animT >= 1) { cb.animT = 1; cb.animating = false; }

        const ease = 0.5 - 0.5*Math.cos(cb.animT * Math.PI);
        // pressed=true: 0→14（压下）；false: 14→0（弹起）
        cb.offset = cb.pressed ? 14*ease : 14*(1-ease);

        this._updatePanelVisuals();
        this._refreshCache();
    }

    // ── 温度历史采样 ─────────────────────────────────────────────────
    _tickHistoryRecord(dt) {
        this._histTimer += dt;
        if (this._histTimer >= 0.5) {
            this._histTimer = 0;
            this._tempHistory.shift();
            this._tempHistory.push(this._temperature);
        }
    }

    // ── 整帧刷新 ─────────────────────────────────────────────────────
    _tickRefreshDisplay() {
        this._rebuildWaterLayer();
        this._updateHeaterGlow();
        this._updatePanelVisuals();
        this._rebuildTempChart();
        this._updateWiring();
        this._refreshCache();
    }

    _updateHeaterGlow() {
        if (!this._heaterGlow) return;
        let op = 0;
        if (this._state === RC_STATE.COOKING || this._state === RC_STATE.TRIPPING) {
            op = Math.min(0.55, (this._temperature-20)/100);
        } else if (this._state === RC_STATE.WARMING) {
            op = 0.18;
        }
        this._heaterGlow.fill(`rgba(255,75,0,${op.toFixed(3)})`);
    }

    // ── 弹性缓动（带轻微过冲）───────────────────────────────────────
    _springEase(t) {
        return 1 - Math.pow(1-t, 3) * Math.cos(t * Math.PI * 2.1);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  外部操作接口
    // ═══════════════════════════════════════════════════════════════════

    /**
     * 按下煮饭键
     *   - IDLE / WARMING → COOKING
     *   - COOKING / TRIPPING 中调用无效（防止重复触发）
     */
    pressCook() {
        if (this._state === RC_STATE.COOKING || this._state === RC_STATE.TRIPPING) return;

        // 按键压下动画
        this._button.pressed   = true;
        this._button.animating = true;
        this._button.animT     = 0;

        // 若弹片仍处弹起状态，触发复位动画（允许再次煮饭）
        if (this._bimetal.tripped) {
            this._bimetal.tripped   = false;
            this._bimetal.animating = true;
            this._bimetal.animT     = 0;
        }

        // 补满水、重置进度
        this._waterLevel = 1.0;
        this._cookProg   = 0;
        this._state      = RC_STATE.COOKING;
        this._cookCount++;

        this.emit?.('stateChange', { state: RC_STATE.COOKING });
        this._refreshCache();
    }

    // ── 查询接口 ─────────────────────────────────────────────────────
    getState()          { return this._state;       }
    getTemperature()    { return this._temperature; }
    getWaterLevel()     { return this._waterLevel;  }
    getCookProgress()   { return this._cookProg;    }
    getMagnetStrength() { return this._magnetStr;   }
    isCooking()         { return this._state === RC_STATE.COOKING;  }
    isWarming()         { return this._state === RC_STATE.WARMING;  }
    getCookCount()      { return this._cookCount;   }

    /** 手动加水（测试 / 重置水位接口）*/
    refillWater(level = 1.0) {
        this._waterLevel = Math.min(1, Math.max(0, level));
        this._refreshCache();
    }

    // ═══════════════════════════════════════════════════════════════════
    //  配置字段（供属性编辑器调用）
    // ═══════════════════════════════════════════════════════════════════
    getConfigFields() {
        return [
            { label: '位号/名称',           key: 'label',        type: 'text'   },
            { label: '额定电压 (V)',         key: 'ratedVoltage', type: 'number' },
            { label: '煮饭功率 (W)',         key: 'cookPower',    type: 'number' },
            { label: '保温功率 (W)',         key: 'warmPower',    type: 'number' },
            { label: '磁钢失磁触发温度 (°C)', key: 'tripTemp',    type: 'number' },
            { label: '保温目标温度 (°C)',    key: 'warmTarget',   type: 'number' },
            { label: '仿真加速倍率',         key: 'simScale',     type: 'number' },
            { label: '初始水量 (0～1)',      key: 'waterLevel',   type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label)      this.label        = cfg.label;
        if (cfg.cookPower)  this.cookPower     = parseFloat(cfg.cookPower)  || this.cookPower;
        if (cfg.warmPower)  this.warmPower     = parseFloat(cfg.warmPower)  || this.warmPower;
        if (cfg.tripTemp)   this.tripTemp      = parseFloat(cfg.tripTemp)   || this.tripTemp;
        if (cfg.warmTarget) this.warmTarget    = parseFloat(cfg.warmTarget) || this.warmTarget;
        if (cfg.simScale)   this._simScale     = parseFloat(cfg.simScale)   || this._simScale;
        if (cfg.waterLevel !== undefined) this.refillWater(parseFloat(cfg.waterLevel));
        this.config = { ...this.config, ...cfg };
        this._refreshCache();
    }

    destroy() {
        super.destroy?.();
    }
}