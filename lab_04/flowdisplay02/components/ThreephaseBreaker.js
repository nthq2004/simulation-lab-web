import { BaseComponent } from './BaseComponent.js';

/**
 * 三相空气开关（断路器）仿真组件
 * （Three-Phase Air Circuit Breaker / MCCB / MCB）
 *
 * ── 器件原理 ──────────────────────────────────────────────────
 *
 *  空气开关（断路器）是兼具手动操作和自动保护双重功能的
 *  低压电器。以空气作为绝缘和灭弧介质，因此得名。
 *
 *  三相断路器同时控制三相（L1/L2/L3），手动拨动一个操作
 *  手柄即可同步接通或断开全部三相。
 *
 *  ┌─────────────────────────────────────────────────────────┐
 *  │  自动脱扣保护机制（三重保护）：                          │
 *  │                                                         │
 *  │  ① 过载保护（双金属片热脱扣）                           │
 *  │     I > 1.2In，双金属片受热弯曲，经延时后脱扣          │
 *  │     反时限特性：过载倍数越大，动作时间越短              │
 *  │                                                         │
 *  │  ② 短路保护（电磁瞬时脱扣）                             │
 *  │     I > (3~10)×In，电磁铁瞬时吸合，< 20ms 分闸        │
 *  │     保护电路免受短路电流破坏                            │
 *  │                                                         │
 *  │  ③ 欠压保护（失压脱扣，可选附件）                       │
 *  │     电压低于 0.7Un 时线圈失磁，弹簧推动脱扣            │
 *  └─────────────────────────────────────────────────────────┘
 *
 * ── 内部结构（正视剖面）──────────────────────────────────────
 *
 *  ┌─────────────────────────────────────────────────────────┐
 *  │                  操作手柄（红/绿双色）                   │
 *  │                      ↕ 上=合闸 下=分闸                 │
 *  ├──────────────────────────────────────────────────────── │
 *  │  L1 ──[静触头]──[动触桥]──[软连接]──[热元件]── T1      │
 *  │  L2 ──[静触头]──[动触桥]──[软连接]──[热元件]── T2      │
 *  │  L3 ──[静触头]──[动触桥]──[软连接]──[热元件]── T3      │
 *  │                                                         │
 *  │  触头区          灭弧室              热元件/电磁脱扣     │
 *  │  ┌──┐            ╔══╗              ┌────┐             │
 *  │  │静│            ║栅║              │双金│             │
 *  │  │触│            ║片║              │属片│             │
 *  │  │头│←→动触桥→  ║灭║              │热元│             │
 *  │  └──┘            ║弧║              │件  │             │
 *  │                  ╚══╝              └────┘             │
 *  │                                                         │
 *  │  联动轴（三相共轴，保证三相同步）                        │
 *  │  ┌────────────────────────────────────────────────┐    │
 *  │  │  L1动触桥 ─── 联动连杆 ─── L2动触桥 ─── L3动触桥 │  │
 *  │  └────────────────────────────────────────────────┘    │
 *  ├──────────────────────────────────────────────────────── │
 *  │  脱扣机构：弹簧锁扣机构 + 双金属片 + 电磁脱扣器         │
 *  └─────────────────────────────────────────────────────────┘
 *
 * ── 各部件详解 ────────────────────────────────────────────────
 *
 *  1. 操作手柄（Operating Handle）
 *     - ABS 工程塑料，红绿双色（红=ON，绿=OFF，部分型号反色）
 *     - 合闸位（ON）：手柄向上
 *     - 分闸位（OFF）：手柄向下
 *     - 脱扣位（TRIP）：手柄在 ON/OFF 中间位置（弹出约15°）
 *     - 复位操作：先推到 OFF 位，再推到 ON 位
 *
 *  2. 触头系统（Contact System）
 *     - 每相一对静/动触头（银合金接触面）
 *     - 三相动触头固定在联动轴上同步动作
 *     - 接触压力弹簧：保证接触可靠，减少接触电阻
 *     - 接触面积：额定电流越大触头越大
 *
 *  3. 灭弧室（Arc Chute）
 *     - 栅片式灭弧：多片钢质栅片将电弧分割冷却
 *     - 分闸时电弧在栅片间被迅速拉长熄灭
 *     - 耐弧材料（陶瓷或高温塑料）侧壁
 *     - 排气孔：弧气排出
 *
 *  4. 热元件（Thermal Element）
 *     - 双金属片+加热电阻丝（串联于主路）
 *     - 过载电流产生焦耳热，双金属片弯曲推动脱扣杠杆
 *
 *  5. 电磁脱扣器（Electromagnetic Tripper）
 *     - 电磁铁+衔铁结构
 *     - 短路时大电流产生强磁场，瞬时吸合衔铁推动脱扣
 *
 *  6. 自由脱扣机构（Free-Trip Mechanism）
 *     - 弹簧储能的锁扣机构
 *     - 脱扣后手柄快速运动到 TRIP 位，与合闸操作解耦
 *     - 保证在任何操作位置都能可靠脱扣
 *
 *  7. 接线端子（Terminals）
 *     - 上端：进线 L1/L2/L3（主电源侧）
 *     - 下端：出线 T1/T2/T3（负载侧）
 *     - 可插入导线截面：6~95mm²（按规格）
 *     - M6 接线螺钉
 *
 * ── 型号参数（DZ47 / DZ158 / DW15 系列）────────────────────
 *
 *  额定电压：AC 400V（三相），DC 100~250V
 *  额定电流：6/10/16/20/25/32/40/50/63A（小型 MCB）
 *             100/125/160/200/250/400/630A（塑壳 MCCB）
 *  分断能力：6kA（普通）/10kA（高分断）/25kA（超高分断）
 *  瞬时脱扣倍数：B类 3~5×In / C类 5~10×In / D类 10~20×In
 *
 * ── 仿真动画 ──────────────────────────────────────────────────
 *
 *  1. 手柄旋转：合闸（ON）↔分闸（OFF）平滑动画（150ms，正弦缓动）
 *  2. 脱扣位（TRIP）：手柄弹出到中间位，区别于手动 OFF
 *  3. 三相动触桥：随手柄联动（同步旋转，体现三相共轴）
 *  4. 电弧闪光：分合闸瞬间触头间蓝白弧光（含扇形扩散）
 *  5. 导通辉光：合闸时触头接触点发橙黄光
 *  6. 过载预警：热元件随负载电流变红，双金属片弯曲动画
 *  7. 短路脱扣：瞬时弹出，电弧比过载更强烈
 *  8. 复位指引：脱扣后 TRIP 位指示，提示先推 OFF 再推 ON
 *  9. 接线端子发热：大电流时端子区橙红辉光
 * 10. 分断容量指示：超过额定分断能力时显示警告
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  L1, L2, L3  — 进线（主电源侧，上部）
 *  T1, T2, T3  — 出线（负载侧，下部）
 */
export class ThreePhaseBreaker extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(140, config.width  || 180);
        this.height = Math.max(280, config.height || 340);

        this.type    = 'three_phase_breaker';
        this.special = 'none';
        this.cache   = 'fixed';

        this._initGroups();
        // ── 额定参数 ──
        this.label          = config.label          || 'QF';
        this.ratedVoltage   = config.ratedVoltage   || 400;   // V
        this.ratedCurrent   = config.ratedCurrent   || 32;    // A
        this.breakingCap    = config.breakingCap    || 6;     // kA 分断能力
        // 瞬时脱扣倍数：'B'=3~5×，'C'=5~10×，'D'=10~20×
        this.tripClass      = config.tripClass      || 'C';
        this.poles          = 3;                               // 三极固定

        // ── 开关状态 ──
        // 'on'=合闸, 'off'=分闸（手动）, 'trip'=脱扣（自动保护）
        this._state       = config.initState || 'off';
        this._closed      = this._state === 'on';

        // 动画
        this._animating   = false;
        this._animT       = 0;           // 0~1
        this._animDir     = 1;           // +1合闸，-1分闸，-2脱扣
        this._animDur     = 0.15;        // s
        // 手柄角度：-30°=ON（合闸），0°=TRIP，+30°=OFF（分闸）
        this._handleAngle = this._stateToAngle(this._state);

        // 操作计数
        this.opsCount     = config.initOps || 0;

        // ── 保护状态 ──
        this._loadCurrent    = config.initCurrent || 0;   // A
        this._thermalLevel   = 0;      // 0~1 热积累
        this._faultCurrent   = 0;      // A 故障电流峰值
        this._arcFlash       = 0;      // 电弧强度
        this._arcPhase       = 0;      // 电弧动画相位
        this._contactGlow    = 0;      // 触头导通辉光
        this._thermalConst   = config.thermalConst || 120; // s

        // ── 几何布局 ──
        const W = this.width, H = this.height;

        // 外壳
        this._body = {
            x: W * 0.04, y: H * 0.02,
            w: W * 0.92, h: H * 0.90,
            rx: 5,
        };

        // 三相触头列（等间距）
        this._phases = [0, 1, 2].map(i => ({
            cx: W * (0.22 + i * 0.28),
            // 进线端子（上）
            inY:   H * 0.02,
            // 静触头（上）
            stY:   H * 0.15,
            // 动触桥旋转中心
            pivY:  H * 0.30,
            // 静触头（下）
            stY2:  H * 0.46,
            // 热元件
            htY:   H * 0.55,
            // 出线端子（下）
            outY:  H * 0.92,
            label: ['L1', 'L2', 'L3'][i],
            outLabel: ['T1', 'T2', 'T3'][i],
            color: ['#ef9a9a', '#aed6a8', '#90caf9'][i],
        }));

        // 操作手柄（中部）
        this._handle = {
            cx:   W * 0.50,
            cy:   H * 0.38,
            len:  H * 0.095,
            w:    W * 0.28,
        };

        // 联动轴
        this._shaft = {
            y:  H * 0.30,
            x1: this._phases[0].cx,
            x2: this._phases[2].cx,
        };

        // 灭弧室（每相）
        this._arcChutes = this._phases.map(ph => ({
            x: ph.cx - W * 0.080,
            y: H * 0.17,
            w: W * 0.160,
            h: H * 0.105,
        }));


        this._init();

        // 注册端口（进线/出线）
        this._phases.forEach((ph, i) => {
            this.addPort(ph.cx, H * 0.02 - 8, `L${i+1}`, 'wire', ph.label);
            this.addPort(ph.cx, H * 0.92 + 8, `T${i+1}`, 'wire', ph.outLabel);
        });
    }

    _stateToAngle(state) {
        if (state === 'on')   return -28;   // °，手柄向上
        if (state === 'trip') return  0;    // °，中间脱扣位
        return  28;                         // °，手柄向下(off)
    }

    // ═══════════════════════════════════════════
    _init() {
        this._drawBody();           // 外壳静态底层
        this._drawArcChutes();      // 灭弧室（静态）
        this._drawTerminals();      // 端子区（静态）
        this._drawStaticContacts(); // 静触头（静态）
        this._drawShaftRail();      // 联动轴导轨（静态）

        // 动态层（按 Z 序）
        this._arcGroup      = new Konva.Group();  // 电弧
        this._contactGroup  = new Konva.Group();  // 动触桥 + 导通辉光
        this._handleGroup   = new Konva.Group();  // 操作手柄
        this._thermGroup    = new Konva.Group();  // 热元件状态

        this._staticGroup.add(this._arcGroup);
        this._staticGroup.add(this._thermGroup);
        this._staticGroup.add(this._contactGroup);
        this._staticGroup.add(this._handleGroup);

        this._drawLabel();
        this._drawStatusIndicator();

        this._rebuildContacts();
        this._rebuildHandle();
        this._rebuildThermElements();

        this._bindInteraction();
        
    }

    // ── 外壳 ─────────────────────────────────
    _drawBody() {
        const b = this._body, W = this.width, H = this.height;

        // 主外壳（工程塑料，深灰）
        this._staticGroup.add(new Konva.Rect({
            x: b.x, y: b.y, width: b.w, height: b.h,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: b.w, y: b.h },
            fillLinearGradientColorStops: [
                0,   '#3c4050',
                0.25,'#464a5a',
                0.6, '#404455',
                1,   '#2e3240',
            ],
            stroke: '#202432', strokeWidth: 1.5,
            cornerRadius: b.rx,
            shadowColor: '#000', shadowBlur: 12,
            shadowOffsetY: 4, shadowOpacity: 0.5,
        }));

        // 顶面高光条
        this._staticGroup.add(new Konva.Rect({
            x: b.x + 2, y: b.y + 2,
            width: b.w - 4, height: b.h * 0.04,
            fill: 'rgba(255,255,255,0.07)',
            cornerRadius: [b.rx, b.rx, 0, 0],
        }));

        // 相间隔板（两条竖向浅凸线）
        [0.36, 0.64].forEach(fx => {
            this._staticGroup.add(new Konva.Line({
                points: [b.x + b.w * fx, b.y + b.h * 0.08,
                         b.x + b.w * fx, b.y + b.h * 0.92],
                stroke: 'rgba(0,0,0,0.22)', strokeWidth: 1.2,
            }));
            this._staticGroup.add(new Konva.Line({
                points: [b.x + b.w * fx + 1, b.y + b.h * 0.08,
                         b.x + b.w * fx + 1, b.y + b.h * 0.92],
                stroke: 'rgba(255,255,255,0.04)', strokeWidth: 0.8,
            }));
        });

        // 操作窗口凹槽（手柄区域）
        this._staticGroup.add(new Konva.Rect({
            x: b.x + b.w * 0.20, y: H * 0.30,
            width: b.w * 0.60, height: H * 0.16,
            fill: '#1e2230',
            stroke: '#141820', strokeWidth: 0.8,
            cornerRadius: 4,
        }));

        // 铭牌区
        const npX = b.x + b.w * 0.08, npY = b.y + b.h * 0.75;
        this._staticGroup.add(new Konva.Rect({
            x: npX, y: npY,
            width: b.w * 0.84, height: H * 0.12,
            fill: '#18202c', stroke: '#0e1420', strokeWidth: 0.5,
            cornerRadius: 2,
        }));
        this._staticGroup.add(new Konva.Text({
            x: npX + 2, y: npY + 3,
            width: b.w * 0.84 - 4,
            text: `${this.ratedCurrent}A  ${this.ratedVoltage}V`,
            fontSize: Math.max(6, W * 0.052),
            fill: 'rgba(180,200,220,0.65)',
            align: 'center', fontStyle: 'bold',
            fontFamily: 'Arial, sans-serif',
        }));
        this._staticGroup.add(new Konva.Text({
            x: npX + 2, y: npY + 14,
            width: b.w * 0.84 - 4,
            text: `${this.breakingCap}kA  ${this.tripClass}级`,
            fontSize: Math.max(5.5, W * 0.042),
            fill: 'rgba(130,160,190,0.50)',
            align: 'center',
            fontFamily: 'Courier New',
        }));

        // 外壳角螺钉（4颗）
        [[b.x + 7,     b.y + 7    ],
         [b.x + b.w-7, b.y + 7    ],
         [b.x + 7,     b.y + b.h-7],
         [b.x + b.w-7, b.y + b.h-7],
        ].forEach(([sx, sy]) => {
            this._staticGroup.add(new Konva.Circle({
                x: sx, y: sy, radius: 3.2,
                fill: '#505868', stroke: '#303040', strokeWidth: 0.6,
            }));
            this._staticGroup.add(new Konva.Line({
                points: [sx-2, sy-2, sx+2, sy+2],
                stroke: '#383848', strokeWidth: 0.8,
            }));
        });
    }

    // ── 灭弧室（栅片式，静态）────────────────
    _drawArcChutes() {
        const W = this.width;
        this._arcChutes.forEach(ac => {
            // 灭弧室外框
            this._staticGroup.add(new Konva.Rect({
                x: ac.x, y: ac.y, width: ac.w, height: ac.h,
                fill: '#1e242e',
                stroke: '#0e1418', strokeWidth: 0.8,
                cornerRadius: 2,
            }));
            // 栅片（5片横线）
            const sheets = 5;
            for (let i = 1; i <= sheets; i++) {
                const sy = ac.y + ac.h * (i / (sheets + 1));
                this._staticGroup.add(new Konva.Line({
                    points: [ac.x + 2, sy, ac.x + ac.w - 2, sy],
                    stroke: '#3a4858', strokeWidth: 1.0,
                }));
            }
            // 排气孔（右侧小圆）
            this._staticGroup.add(new Konva.Circle({
                x: ac.x + ac.w - 5, y: ac.y + ac.h / 2,
                radius: 2.5,
                fill: '#0a1018', stroke: '#1a2530', strokeWidth: 0.5,
            }));
        });
    }

    // ── 接线端子（静态）──────────────────────
    _drawTerminals() {
        const W = this.width, H = this.height;
        const termH = H * 0.040, termW = W * 0.13;

        this._phases.forEach(ph => {
            // 进线端子（上方）
            this._drawTerminalBlock(ph.cx, H * 0.02, termW, termH, ph.label, ph.color, 'top');
            // 出线端子（下方）
            this._drawTerminalBlock(ph.cx, H * 0.92, termW, termH, ph.outLabel, ph.color, 'bottom');
        });
    }

    _drawTerminalBlock(cx, y, tw, th, label, color, side) {
        const W = this.width;
        const tx = cx - tw / 2;
        const ty = side === 'top' ? y : y - 2;

        // 端子块主体（银灰色金属）
        this._staticGroup.add(new Konva.Rect({
            x: tx, y: ty, width: tw, height: th,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: tw, y: 0 },
            fillLinearGradientColorStops: [
                0,   '#505860',
                0.28,'#8a9298',
                0.55,'#b0b8c0',
                0.82,'#8a9298',
                1,   '#505860',
            ],
            stroke: '#383e48', strokeWidth: 0.8,
            cornerRadius: 2,
        }));

        // 接线螺钉（M6）
        const screwY = ty + th * 0.50;
        this._staticGroup.add(new Konva.Circle({
            x: cx, y: screwY,
            radius: tw * 0.24,
            fill: '#909aa0', stroke: '#606870', strokeWidth: 0.6,
        }));
        this._staticGroup.add(new Konva.Line({
            points: [cx - tw * 0.18, screwY, cx + tw * 0.18, screwY],
            stroke: '#484e58', strokeWidth: 0.9,
        }));
        this._staticGroup.add(new Konva.Line({
            points: [cx, screwY - tw * 0.18, cx, screwY + tw * 0.18],
            stroke: '#484e58', strokeWidth: 0.9,
        }));

        // 标注
        const labelY = side === 'top' ? ty - 11 : ty + th + 3;
        this._staticGroup.add(new Konva.Text({
            x: cx - 10, y: labelY,
            width: 20, text: label,
            fontSize: 8, fill: color,
            align: 'center', fontStyle: 'bold',
            fontFamily: 'Arial, sans-serif',
        }));
    }

    // ── 静触头（固定部分，静态）──────────────
    _drawStaticContacts() {
        const W = this.width, H = this.height;
        const cW = W * 0.055, cH = H * 0.022;

        this._phases.forEach(ph => {
            // 上静触头（进线侧）
            this._drawStaticContactPair(ph.cx, ph.stY, cW, cH, true);
            // 下静触头（出线侧）
            this._drawStaticContactPair(ph.cx, ph.stY2, cW, cH, false);
        });
    }

    _drawStaticContactPair(cx, cy, cw, ch, isUpper) {
        // 静触头底座（黄铜）
        this._staticGroup.add(new Konva.Rect({
            x: cx - cw / 2, y: cy - ch / 2,
            width: cw, height: ch,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: cw, y: 0 },
            fillLinearGradientColorStops: [
                0,'#7a6a2a',0.3,'#c8a848',0.6,'#e0c060',0.85,'#b09038',1,'#7a6a2a',
            ],
            stroke: '#5a4a20', strokeWidth: 0.6,
            cornerRadius: 1,
        }));
        // 银合金接触面（亮白色小块）
        const contactFace = isUpper
            ? { y: cy + ch * 0.20 }
            : { y: cy - ch * 0.20 - ch * 0.18 };
        this._staticGroup.add(new Konva.Rect({
            x: cx - cw * 0.30, y: contactFace.y,
            width: cw * 0.60, height: ch * 0.20,
            fill: '#d8dce0',
            stroke: '#a0a8b0', strokeWidth: 0.4,
            cornerRadius: 0.5,
        }));
    }

    // ── 联动轴导轨（静态）────────────────────
    _drawShaftRail() {
        const s = this._shaft, W = this.width;

        // 联动轴横梁
        this._staticGroup.add(new Konva.Rect({
            x: s.x1 - W * 0.04, y: s.y - W * 0.018,
            width: s.x2 - s.x1 + W * 0.08, height: W * 0.036,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: 0, y: W * 0.036 },
            fillLinearGradientColorStops: [
                0,'#6a7080',0.3,'#909aa8',0.7,'#888090',1,'#505560',
            ],
            stroke: '#303840', strokeWidth: 0.8,
            cornerRadius: 2,
        }));

        // 三相联接点
        this._phases.forEach(ph => {
            this._staticGroup.add(new Konva.Circle({
                x: ph.cx, y: s.y, radius: W * 0.030,
                fillRadialGradientStartPoint:  { x: -W*0.01, y: -W*0.01 },
                fillRadialGradientEndPoint:    { x: 0, y: 0 },
                fillRadialGradientStartRadius: 0,
                fillRadialGradientEndRadius:   W * 0.030,
                fillRadialGradientColorStops:  [0,'#c0c8d0',0.6,'#9098a0',1,'#505860'],
                stroke: '#303840', strokeWidth: 0.6,
            }));
        });
    }

    // ══════════════════════════════════════════
    // ── 动态重绘 ──────────────────────────────

    /** 重建动触桥 + 导通辉光 + 电弧 */
    _rebuildContacts() {
        this._contactGroup.destroyChildren();
        this._arcGroup.destroyChildren();

        const closed    = this._closed;
        const animating = this._animating;
        const angle     = this._handleAngle;  // °
        const W = this.width, H = this.height;

        // 动触桥旋转角度（与手柄联动）
        // 合闸(−28°)→桥水平压合；分闸(+28°)→桥向上抬起
        const bridgeAngle = angle;  // 同号映射

        this._phases.forEach((ph, i) => {
            const cx   = ph.cx;
            const pivY = ph.pivY;
            const bW   = W * 0.055;   // 动触桥宽
            const bLen = H * 0.165;   // 动触桥长

            // 旋转组（以轴心为中心）
            const bg = new Konva.Group({
                x: cx, y: pivY,
                rotation: bridgeAngle,
            });

            // 动触桥主体（铜合金）
            bg.add(new Konva.Rect({
                x: -bW / 2, y: -bLen / 2,
                width: bW, height: bLen,
                fillLinearGradientStartPoint: { x: -bW/2, y: 0 },
                fillLinearGradientEndPoint:   { x:  bW/2, y: 0 },
                fillLinearGradientColorStops: [
                    0,'#7a6228',0.25,'#c8a040',0.55,'#e0b848',0.80,'#b09030',1,'#7a6228',
                ],
                stroke: '#5a4818', strokeWidth: 0.6,
                cornerRadius: 1,
            }));

            // 两端接触面（银合金）
            [-1, 1].forEach(dir => {
                bg.add(new Konva.Rect({
                    x: -bW * 0.32, y: dir > 0 ? bLen/2 - bW*0.32 : -bLen/2,
                    width: bW * 0.64, height: bW * 0.28,
                    fill: '#d0d8e0',
                    stroke: '#909aa0', strokeWidth: 0.4, cornerRadius: 0.5,
                }));
            });

            // 导通辉光（合闸时）
            const glow = this._contactGlow;
            if (closed && glow > 0.05) {
                bg.add(new Konva.Rect({
                    x: -bW * 0.6, y: -bLen / 2 - 3,
                    width: bW * 1.2, height: bLen + 6,
                    fill: `rgba(255,160,30,${glow * 0.22})`,
                    cornerRadius: 3,
                }));
            }

            this._contactGroup.add(bg);

            // 电弧效果（分合瞬间，在触头接触点位置）
            if (this._arcFlash > 0.05 && animating) {
                this._drawArcEffect(cx, ph.stY, ph.stY2, i);
            }
        });

        // 静止时接触点辉光（合闸稳态）
        if (closed && !animating) {
            this._phases.forEach(ph => {
                this._contactGroup.add(new Konva.Circle({
                    x: ph.cx, y: ph.stY + H * 0.010,
                    radius: W * 0.022,
                    fill: `rgba(255,200,80,${this._contactGlow * 0.35})`,
                    shadowColor: 'rgba(255,180,50,1)',
                    shadowBlur: 6 * this._contactGlow,
                    shadowOpacity: 0.7,
                }));
                this._contactGroup.add(new Konva.Circle({
                    x: ph.cx, y: ph.stY2 - H * 0.010,
                    radius: W * 0.022,
                    fill: `rgba(255,200,80,${this._contactGlow * 0.35})`,
                    shadowColor: 'rgba(255,180,50,1)',
                    shadowBlur: 6 * this._contactGlow,
                    shadowOpacity: 0.7,
                }));
            });
        }
    }

    /** 电弧效果（栅片间闪烁）*/
    _drawArcEffect(cx, y1, y2, phaseIdx) {
        const af    = this._arcFlash;
        const W     = this.width;
        const H     = this.height;
        const ph    = this._arcPhase;
        const ac    = this._arcChutes[phaseIdx];

        // 触头间主弧
        for (let k = 0; k < 3; k++) {
            const ax = cx + (Math.random() - 0.5) * W * 0.04;
            this._arcGroup.add(new Konva.Line({
                points: [
                    cx, y1 + H * 0.012,
                    ax, (y1 + y2) / 2 + (Math.random() - 0.5) * H * 0.04,
                    cx, y2 - H * 0.012,
                ],
                stroke: k === 0
                    ? `rgba(255,255,200,${af * 0.90})`
                    : `rgba(100,160,255,${af * 0.65})`,
                strokeWidth: 2.5 - k * 0.6,
                tension: 0.4 + Math.random() * 0.3,
                lineCap: 'round',
            }));
        }

        // 灭弧室内弧光（栅片间）
        if (af > 0.3) {
            this._arcGroup.add(new Konva.Rect({
                x: ac.x + 1, y: ac.y + 1,
                width: ac.w - 2, height: ac.h - 2,
                fill: `rgba(${Math.round(100 + af * 80)},${Math.round(150 + af * 50)},255,${af * 0.28})`,
                cornerRadius: 1,
            }));
        }

        // 分散弧焰（扇形）
        const fanR = W * 0.08 * af;
        for (let k = 0; k < 4; k++) {
            const ang = (Math.PI * 0.2) + k * (Math.PI * 0.55 / 4);
            this._arcGroup.add(new Konva.Line({
                points: [
                    cx, y1 + H * 0.012,
                    cx + Math.cos(ang) * fanR * Math.random(),
                    y1 + H * 0.012 + Math.sin(ang) * fanR * Math.random(),
                ],
                stroke: `rgba(255,${Math.round(200 + Math.random() * 55)},80,${af * 0.55})`,
                strokeWidth: 0.8 + Math.random(),
            }));
        }
    }

    /** 重建操作手柄 */
    _rebuildHandle() {
        this._handleGroup.destroyChildren();
        const hd  = this._handle;
        const ang = this._handleAngle;   // °
        const W   = this.width, H = this.height;
        const state = this._state;

        // 手柄旋转组
        const hg = new Konva.Group({
            x: hd.cx, y: hd.cy,
            rotation: ang,
        });

        // 手柄基座（固定，不旋转）
        this._handleGroup.add(new Konva.Rect({
            x: hd.cx - hd.w / 2, y: hd.cy - hd.len * 0.25,
            width: hd.w, height: hd.len * 0.50,
            fill: '#1a1e28',
            stroke: '#0e1218', strokeWidth: 0.8,
            cornerRadius: 3,
        }));

        // 手柄主体（拨片）
        const hColor0 = state === 'on'   ? '#d03020'
                      : state === 'trip' ? '#e07820'
                      : '#404858';
        const hColor1 = state === 'on'   ? '#a01c10'
                      : state === 'trip' ? '#b05010'
                      : '#282e3c';

        hg.add(new Konva.Rect({
            x: -hd.w / 2, y: -hd.len,
            width: hd.w, height: hd.len * 1.8,
            fillLinearGradientStartPoint: { x: -hd.w/2, y: 0 },
            fillLinearGradientEndPoint:   { x:  hd.w/2, y: 0 },
            fillLinearGradientColorStops: [
                0, hColor1, 0.25, hColor0,
                0.6, hColor0, 0.85, hColor1, 1, hColor1,
            ],
            cornerRadius: 4,
            stroke: state === 'on' ? '#700e06' : state === 'trip' ? '#904008' : '#14181e',
            strokeWidth: 1,
            shadowColor: '#000', shadowBlur: 6,
            shadowOffsetY: 2, shadowOpacity: 0.4,
        }));

        // 手柄高光
        hg.add(new Konva.Rect({
            x: -hd.w / 2 + 2, y: -hd.len + 2,
            width: hd.w - 4, height: hd.len * 0.18,
            fill: 'rgba(255,255,255,0.12)',
            cornerRadius: [4, 4, 0, 0],
        }));

        // ON/OFF/TRIP 文字
        const stateText = state === 'on' ? 'ON' : state === 'trip' ? 'TRIP' : 'OFF';
        const stateColor = state === 'on' ? '#ffdddd' : state === 'trip' ? '#ffd090' : '#9090a0';
        hg.add(new Konva.Text({
            x: -hd.w / 2, y: -hd.len * 0.45,
            width: hd.w, text: stateText,
            fontSize: Math.max(7, W * 0.058),
            fill: stateColor,
            align: 'center', fontStyle: 'bold',
            fontFamily: 'Arial, sans-serif',
        }));

        // 手柄凸纹（防滑纹理）
        for (let k = 0; k < 4; k++) {
            const ky = -hd.len * 0.85 + k * hd.len * 0.20;
            hg.add(new Konva.Line({
                points: [-hd.w * 0.35, ky, hd.w * 0.35, ky],
                stroke: 'rgba(0,0,0,0.18)', strokeWidth: 0.8, lineCap: 'round',
            }));
        }

        // TRIP 状态：手柄橙色辉光警示
        if (state === 'trip') {
            const flash = 0.5 + Math.abs(Math.sin(this._arcPhase * 2)) * 0.5;
            hg.add(new Konva.Rect({
                x: -hd.w / 2 - 3, y: -hd.len - 3,
                width: hd.w + 6, height: hd.len * 1.8 + 6,
                fill: 'transparent',
                stroke: `rgba(255,160,30,${flash * 0.55})`,
                strokeWidth: 2,
                cornerRadius: 6,
            }));
        }

        this._handleGroup.add(hg);

        // 手柄旁 ON / OFF 位置标注（固定，不旋转）
        [{y: hd.cy - hd.len * 1.10, text: '▲ ON', col: '#e08060'},
         {y: hd.cy + hd.len * 1.10, text: '▼ OFF', col: '#6080a0'},
        ].forEach(lbl => {
            this._handleGroup.add(new Konva.Text({
                x: hd.cx - 20, y: lbl.y,
                width: 40, text: lbl.text,
                fontSize: 7, fill: lbl.col,
                align: 'center', fontFamily: 'Courier New',
            }));
        });
    }

    /** 热元件状态（过载指示）*/
    _rebuildThermElements() {
        this._thermGroup.destroyChildren();
        const lv   = Math.min(1, this._thermalLevel);
        const W    = this.width, H = this.height;

        if (lv < 0.05) return;

        this._phases.forEach(ph => {
            const htY = ph.htY;
            const htH = H * 0.055, htW = W * 0.10;

            // 热元件发光（过载时）
            const rr = Math.round(160 + lv * 80);
            const rg = Math.round(80  - lv * 70);
            this._thermGroup.add(new Konva.Rect({
                x: ph.cx - htW / 2, y: htY,
                width: htW, height: htH,
                fill: `rgba(${rr},${rg},20,${lv * 0.55})`,
                cornerRadius: 1,
            }));
            // 热元件线圈（细波浪线）
            const pts = [];
            const segs = 6;
            for (let j = 0; j <= segs * 8; j++) {
                const t  = j / (segs * 8);
                const y  = htY + 3 + t * (htH - 6);
                const xo = Math.sin(t * segs * Math.PI * 2) * htW * 0.30;
                pts.push(ph.cx + xo, y);
            }
            this._thermGroup.add(new Konva.Line({
                points: pts,
                stroke: `rgba(${rr},${rg},20,${0.55 + lv * 0.35})`,
                strokeWidth: htW * 0.10,
                tension: 0.3, lineCap: 'round',
            }));
        });
    }

    // ── 标注 ─────────────────────────────────
    _drawLabel() {
        const W = this.width;
        this._staticGroup.add(new Konva.Text({
            x: 0, y: -20, width: W,
            text: `${this.label}  三相空气开关`,
            fontSize: 9, fontStyle: 'bold', fill: '#546e7a',
            align: 'center', fontFamily: 'Arial, sans-serif',
        }));
        this._staticGroup.add(new Konva.Text({
            x: 0, y: -9, width: W,
            text: `${this.ratedCurrent}A  ${this.ratedVoltage}V  ${this.tripClass}级  ${this.breakingCap}kA`,
            fontSize: 7, fill: '#3a5a7a',
            align: 'center', fontFamily: 'Courier New',
        }));
    }

    // ── 状态指示灯 ───────────────────────────
    _drawStatusIndicator() {
        const W = this.width, H = this.height;
        const b = this._body;

        // 右上角状态指示灯
        this._statusDot = new Konva.Circle({
            x: b.x + b.w - 10, y: b.y + 10,
            radius: 4.5,
            fill:   this._closed ? '#66bb6a' : '#ef5350',
            stroke: this._closed ? '#2e7d32' : '#c62828',
            strokeWidth: 0.8,
            shadowColor: this._closed ? '#66bb6a' : '#ef5350',
            shadowBlur: this._closed ? 6 : 2,
            shadowOpacity: 0.85,
        });
        this._statusText = new Konva.Text({
            x: b.x + b.w - 36, y: b.y + 5,
            width: 26,
            text: this._state === 'on' ? 'ON' : this._state === 'trip' ? 'TRIP' : 'OFF',
            fontSize: 8, fontStyle: 'bold',
            fill: this._closed ? '#66bb6a' : this._state === 'trip' ? '#ffa726' : '#ef5350',
            align: 'right',
        });
        this._staticGroup.add(this._statusDot, this._statusText);
    }

    _updateStatusIndicator() {
        const on    = this._state === 'on';
        const trip  = this._state === 'trip';
        const col   = on ? '#66bb6a' : trip ? '#ffa726' : '#ef5350';
        const scol  = on ? '#2e7d32' : trip ? '#e65100' : '#c62828';

        if (this._statusDot) {
            this._statusDot.fill(col);
            this._statusDot.stroke(scol);
            this._statusDot.shadowColor(col);
            this._statusDot.shadowBlur(on ? 6 : trip ? 4 : 2);
        }
        if (this._statusText) {
            const lbl = on ? 'ON' : trip ? 'TRIP' : 'OFF';
            this._statusText.text(lbl);
            this._statusText.fill(col);
        }
    }

    // ── 交互绑定（手柄区域点击）──────────────
    _bindInteraction() {
        const hd  = this._handle;
        const W   = this.width;
        const hit = new Konva.Rect({
            x: hd.cx - hd.w / 2 - 4,
            y: hd.cy - hd.len * 1.2,
            width: hd.w + 8,
            height: hd.len * 2.4,
            fill: 'transparent',
        });
        this._interactGroup.add(hit);
        hit.on('click tap', () => this.toggle());
    }

    // ═══════════════════════════════════════════
    // 集中化 tick（由 consys._tickAll 在 20fps 调用）
    tick(dt) {
        this._tickAnimation(dt, ts);
    
        this._refreshCache();
    }
    _tickAnimation(dt, ts) {
        let dirty = false;

        // ── 手柄动画 ──
        if (this._animating) {
            this._animT += dt / this._animDur;
            if (this._animT >= 1) {
                this._animT = 1;
                this._animating = false;
                this._arcFlash  = 0;
            }
            const ease = 0.5 - 0.5 * Math.cos(this._animT * Math.PI);

            const fromAngle = this._animFromAngle;
            const toAngle   = this._animToAngle;
            this._handleAngle = fromAngle + (toAngle - fromAngle) * ease;

            // 分合闸末尾时电弧衰减
            this._arcFlash = Math.max(0, this._arcFlash - dt * 6);
            dirty = true;
        }

        // ── 接触辉光（合闸稳态渐入）──
        const targetGlow = this._closed && !this._animating ? 0.80 : 0;
        this._contactGlow += (targetGlow - this._contactGlow) * Math.min(1, dt * 8);
        if (Math.abs(this._contactGlow - targetGlow) > 0.01) dirty = true;

        // ── 热量积累 ──
        const I  = this._loadCurrent;
        const In = this.ratedCurrent;
        if (!this._state === 'on') {
            // 断路时冷却
            this._thermalLevel *= Math.exp(-dt / (this._thermalConst * 2));
        } else {
            const ratio    = I / In;
            const heatRate = (ratio * ratio - 1) / this._thermalConst;
            this._thermalLevel = Math.max(0, Math.min(1.05,
                this._thermalLevel + heatRate * dt));
            // 过载脱扣
            if (this._thermalLevel >= 1.0 && this._state === 'on') {
                this._triggerTrip('thermal');
            }
            // 短路瞬时脱扣
            const tripMultiplier = this.tripClass === 'B' ? 5
                                 : this.tripClass === 'D' ? 10 : 10;
            if (I > tripMultiplier * In && this._state === 'on') {
                this._triggerTrip('short');
            }
        }

        // ── 电弧相位（TRIP 手柄脉动）──
        this._arcPhase += dt * 3.5;

        if (dirty || this._state === 'trip') {
            this._rebuildContacts();
            this._rebuildHandle();
            this._rebuildThermElements();
            this._updateStatusIndicator();
            this._refreshCache();
        }
    }

    _triggerTrip(cause) {
        this._state       = 'trip';
        this._closed      = false;
        this._animFromAngle = this._handleAngle;
        this._animToAngle   = this._stateToAngle('trip');
        this._animT       = 0;
        this._animating   = true;
        this._animDur     = cause === 'short' ? 0.03 : 0.12;  // 短路更快
        this._arcFlash    = cause === 'short' ? 1.0 : 0.60;
    }

    // ══════════════════════════════════════════
    // ── 公开 API ─────────────────────────────

    /** 切换开关（手动拨动） */
    toggle() {
        if (this._animating) return;
        if (this._state === 'on') {
            this.open();
        } else if (this._state === 'off') {
            this.close();
        } else if (this._state === 'trip') {
            // TRIP → 必须先推到 OFF 才能复位
            this._state         = 'off';
            this._animFromAngle = this._handleAngle;
            this._animToAngle   = this._stateToAngle('off');
            this._animT         = 0;
            this._animating     = true;
            this._animDur       = 0.12;
        }
        this.opsCount++;
        this._refreshCache();
    }

    /** 合闸（手动/程序控制） */
    close() {
        if (this._state === 'on' || this._animating) return;
        if (this._state === 'trip') return;  // 脱扣后需先复位到 OFF
        const fromAngle      = this._handleAngle;
        this._state          = 'on';
        this._closed         = true;
        this._animFromAngle  = fromAngle;
        this._animToAngle    = this._stateToAngle('on');
        this._animT          = 0;
        this._animating      = true;
        this._animDur        = 0.15;
        this._arcFlash       = 0.40;
        this.opsCount++;
        this._refreshCache();
    }

    /** 分闸（手动） */
    open() {
        if (this._state === 'off' || this._animating) return;
        const fromAngle      = this._handleAngle;
        this._state          = 'off';
        this._closed         = false;
        this._animFromAngle  = fromAngle;
        this._animToAngle    = this._stateToAngle('off');
        this._animT          = 0;
        this._animating      = true;
        this._animDur        = 0.15;
        this._arcFlash       = 0.50;
        this.opsCount++;
        this._refreshCache();
    }

    /** 复位（从 TRIP 状态恢复到 OFF，再可手动 ON） */
    reset() {
        if (this._state !== 'trip') return;
        this._state         = 'off';
        this._thermalLevel  = 0;
        this._animFromAngle = this._handleAngle;
        this._animToAngle   = this._stateToAngle('off');
        this._animT         = 0;
        this._animating     = true;
        this._animDur       = 0.12;
        this._refreshCache();
    }

    /** 设置负载电流（用于过载/短路保护仿真） */
    setCurrent(I) { this._loadCurrent = Math.max(0, I); }

    /** 查询状态 */
    isClosed()    { return this._state === 'on'; }
    isTripped()   { return this._state === 'trip'; }
    getState()    { return this._state; }
    getOpsCount() { return this.opsCount; }

    update(state) {
        if (typeof state === 'boolean') {
            state ? this.close() : this.open();
        } else if (state === 'trip') {
            this._triggerTrip('manual');
        } else if (state === 'reset') {
            this.reset();
        } else if (typeof state === 'object' && state !== null) {
            if (state.current !== undefined) this.setCurrent(state.current);
            if (state.closed  === true)  this.close();
            if (state.closed  === false) this.open();
            if (state.reset   === true)  this.reset();
        }
        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label: '位号/名称',           key: 'label',        type: 'text'   },
            { label: '额定电压 (V)',         key: 'ratedVoltage', type: 'number' },
            { label: '额定电流 (A)',         key: 'ratedCurrent', type: 'number' },
            { label: '分断能力 (kA)',        key: 'breakingCap',  type: 'number' },
            { label: '脱扣级别 (B/C/D)',     key: 'tripClass',    type: 'text'   },
            { label: '初始状态(on/off)',     key: 'initState',    type: 'text'   },
            { label: '初始电流 (A)',         key: 'initCurrent',  type: 'number' },
            { label: '热时间常数 (s)',       key: 'thermalConst', type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label        !== undefined) this.label        = cfg.label;
        if (cfg.ratedVoltage !== undefined) this.ratedVoltage = parseFloat(cfg.ratedVoltage);
        if (cfg.ratedCurrent !== undefined) this.ratedCurrent = parseFloat(cfg.ratedCurrent);
        if (cfg.breakingCap  !== undefined) this.breakingCap  = parseFloat(cfg.breakingCap);
        if (cfg.tripClass    !== undefined) this.tripClass    = cfg.tripClass.toUpperCase();
        if (cfg.thermalConst !== undefined) this._thermalConst = parseFloat(cfg.thermalConst);
        if (cfg.initCurrent  !== undefined) this.setCurrent(parseFloat(cfg.initCurrent));
        if (cfg.initState    !== undefined) {
            const s = cfg.initState;
            if (s === 'on')   this.close();
            if (s === 'off')  this.open();
            if (s === 'trip') this._triggerTrip('manual');
        }
        this.config = { ...this.config, ...cfg };
        this._refreshCache();
    }

    destroy() {
        super.destroy?.();
    }
}