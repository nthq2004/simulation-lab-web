import { BaseComponent } from './BaseComponent.js';

/**
 * 单相空气开关内部机构仿真组件
 * （Single-Phase MCB Internal Mechanism Simulation）
 *
 * ── 参考图片对照 ──────────────────────────────────────────────
 *
 *  图片为单极 MCB（微型断路器）拆壳后的正面俯视图，可见：
 *
 *  【左区】操作机构区
 *   · 黑色塑料锁扣机构（上锁扣 + 下锁扣）
 *   · 搭扣弹簧（复位弹簧）
 *   · 分合闸联动连杆
 *   · 动触头臂（铜制，绕枢轴旋转）
 *
 *  【中区】脱扣机构区
 *   · 铜线绕制的螺线管线圈（电磁脱扣器）
 *   · 铁芯（受短路大电流吸引后动作）
 *   · 双金属片（双层金属片，过载时热弯曲）
 *   · 脱扣杆（传递脱扣力）
 *
 *  【右区】灭弧室区
 *   · 红色绝缘框 + 金属栅片（灭弧栅）
 *   · 电弧通道（触头断开时电弧沿此通道进入灭弧室）
 *
 * ── 组件演示的三大物理过程 ────────────────────────────────────
 *
 *  1. 正常合闸（Normal Closed）
 *     - 动触头紧压静触头，接触点金黄色发光
 *     - 双金属片平直，螺线管无动作
 *     - 电流线（白色流动粒子）沿导流路径流动
 *
 *  2. 过载脱扣（Overload Trip - Thermal Release）
 *     - 触发条件：电流超过额定值（1.1~6倍额定电流）
 *     - 过程：
 *       a. 双金属片受热弯曲（红色渐变，可视化热量积累）
 *       b. 弯曲量达到阈值后，顶住脱扣杆端部
 *       c. 脱扣杆旋转，释放下锁扣
 *       d. 搭扣弹簧驱动动触头臂向上旋转（分闸）
 *       e. 触头分离处产生电弧（橙黄色闪光线）
 *       f. 电弧被吸入灭弧栅（逐步拉伸→分割→熄灭）
 *     - 动作时间：1.1倍→几秒，6倍→几十毫秒（仿真加速显示）
 *
 *  3. 短路脱扣（Short-Circuit Trip - Electromagnetic Release）
 *     - 触发条件：电流超过整定值（10倍以上额定电流）
 *     - 过程：
 *       a. 螺线管线圈通过大电流，产生强磁场
 *       b. 铁芯瞬间被吸入线圈（向下运动，<10ms）
 *       c. 铁芯撞击脱扣杆，释放上锁扣
 *       d. 触头瞬间分离
 *       e. 短路电弧（更强烈，蓝白色）被吸入灭弧室
 *       f. 灭弧栅将电弧分割成多段小电弧快速冷却熄灭
 *
 * ── 电弧熄灭动画细节 ─────────────────────────────────────────
 *
 *  电弧生命周期（共 4 阶段）：
 *  Phase 1 - 燃弧（Arc Ignition, 0~80ms）
 *    动触头离开静触头瞬间，接触点拉出金黄色细丝电弧
 *    粒子：大量橙黄/白色随机锯齿折线，宽度随时间增加
 *
 *  Phase 2 - 电弧移动（Arc Migration, 80~200ms）
 *    电弧根部随触头运动向灭弧室方向移动
 *    磁场对电弧产生推力，驱使电弧进入灭弧栅
 *    粒子：折线逐步向右倾斜偏移
 *
 *  Phase 3 - 电弧分割（Arc Splitting, 200~400ms）
 *    灭弧栅金属板将整体电弧切割成多段串联小电弧
 *    每段小电弧的维弧电压增大，总维弧电压超过电源电压
 *    粒子：多段平行短折线，颜色由橙变蓝白（温度降低）
 *
 *  Phase 4 - 熄弧（Arc Extinction, 400~600ms）
 *    各段小电弧因维弧电压不足相继熄灭
 *    最终完全熄弧，断路器完成开断
 *    粒子：折线逐渐变细变短→消失，偶有残余紫色辉光
 *
 * ── 状态机 ────────────────────────────────────────────────────
 *
 *  CLOSED     → 合闸运行（正常导通）
 *  TRIPPING   → 脱扣动作中（触头正在分离）
 *  ARCING     → 燃弧（触头已分离，电弧进行中）
 *  OPEN       → 完全分闸（电弧熄灭，回路断开）
 *  RESETTING  → 手动复位（操作手柄向下，重新搭扣）
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  terminal_in  — 进线端（顶部固定触头上方）
 *  terminal_out — 出线端（底部出线端子下方）
 */
export class MCBInternalMechanism extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(320, config.width  || 400);
        this.height = Math.max(280, config.height || 360);

        this.type    = 'mcb_internal';
        this.special = 'none';
        this.cache   = 'fixed';

        this._initGroups();
        // ── 铭牌 ──
        this.label        = config.label        || 'QF';
        this.ratedCurrent = config.ratedCurrent || 16;    // A
        this.ratedVoltage = config.ratedVoltage || 230;   // V
        this.tripCurve    = config.tripCurve    || 'C';   // B/C/D

        // ── 仿真参数 ──
        this.loadCurrent  = config.loadCurrent  || 0;     // A 当前负载电流
        this.shortCircuit = false;   // 是否模拟短路状态

        // ── 状态机 ──
        // 'OPEN' | 'CLOSED' | 'TRIPPING' | 'ARCING' | 'RESETTING'
        this._state       = config.initState || 'OPEN';
        this._tripType    = null;   // 'OVERLOAD' | 'SHORT'
        this._arcPhase    = 0;      // 0~1 电弧生命进度
        this._arcT        = 0;      // 电弧累计时间（s）
        this._arcDur      = 0.6;    // 电弧总持续时间（s）

        // ── 热效应（过载）──
        this._heatLevel   = 0;      // 0~1 双金属片热积累
        this._heatDecay   = 0.05;   // 冷却速率（/s）
        this._heatGain    = 0;      // 加热速率（/s，由电流决定）

        // ── 电磁吸合位置（短路脱扣）──
        this._plungerY    = 0;      // 铁芯位移 0~1（0=未动，1=全吸合）

        // ── 触头位置 ──
        this._contactAngle = this._state === 'CLOSED' ? 0 : 1; // 0=合闸，1=分闸
        this._targetContact = this._contactAngle;

        // ── 电流粒子 ──
        this._currentParticles = [];

        // ── 电弧粒子 ──
        this._arcParticles = [];


        this._calcGeometry();
        this._init();

        // 端口
        const g = this._geo;
        this.addPort(g.fixedContactX, 0,            'terminal_in',  'wire', 'L');
        this.addPort(g.outTerminalX,  this.height+4, 'terminal_out', 'wire', 'N');
    }

    // ═══════════════════════════════════════════
    _calcGeometry() {
        const W = this.width, H = this.height;
        const g = {};

        // ── 壳体内腔 ──
        g.bodyX = W * 0.03;
        g.bodyY = H * 0.04;
        g.bodyW = W * 0.94;
        g.bodyH = H * 0.88;

        // ── 三大区域划分 ──
        g.zone1X = g.bodyX;                           // 左：操作机构
        g.zone1W = g.bodyW * 0.38;
        g.zone2X = g.bodyX + g.zone1W;               // 中：脱扣机构
        g.zone2W = g.bodyW * 0.33;
        g.zone3X = g.bodyX + g.zone1W + g.zone2W;    // 右：灭弧室
        g.zone3W = g.bodyW * 0.29;

        // ── 固定触头（上方进线端） ──
        g.fixedContactX = g.zone1X + g.zone1W * 0.55;
        g.fixedContactY = g.bodyY + H * 0.10;

        // ── 触头枢轴（动触头旋转中心） ──
        g.pivotX = g.zone1X + g.zone1W * 0.30;
        g.pivotY = g.bodyY + H * 0.42;

        // ── 动触头（臂长） ──
        g.armLen = H * 0.28;

        // ── 双金属片（中区）──
        g.bimetalX = g.zone2X + g.zone2W * 0.30;
        g.bimetalY = g.bodyY + H * 0.45;
        g.bimetalW = g.zone2W * 0.22;
        g.bimetalH = H * 0.30;

        // ── 螺线管（中区上方） ──
        g.solenoidX = g.zone2X + g.zone2W * 0.45;
        g.solenoidY = g.bodyY + H * 0.10;
        g.solenoidW = g.zone2W * 0.42;
        g.solenoidH = H * 0.32;

        // ── 铁芯（螺线管内部） ──
        g.plungerX = g.solenoidX + g.solenoidW * 0.25;
        g.plungerW = g.solenoidW * 0.50;
        g.plungerH = g.solenoidH * 0.38;
        g.plungerY0 = g.solenoidY + g.solenoidH * 0.10; // 未吸合时Y

        // ── 脱扣杆（中区中部） ──
        g.tripLeverX = g.zone2X + g.zone2W * 0.12;
        g.tripLeverY = g.bodyY + H * 0.40;
        g.tripLeverLen = H * 0.22;

        // ── 锁扣机构（左区上方） ──
        g.latchX = g.zone1X + g.zone1W * 0.62;
        g.latchY = g.bodyY + H * 0.18;

        // ── 灭弧栅（右区） ──
        g.arcChamberX = g.zone3X + g.zone3W * 0.05;
        g.arcChamberY = g.bodyY + H * 0.08;
        g.arcChamberW = g.zone3W * 0.88;
        g.arcChamberH = H * 0.62;
        g.gridCount   = 9;   // 灭弧栅片数

        // ── 出线端子（底部） ──
        g.outTerminalX = g.fixedContactX;
        g.outTerminalY = g.bodyY + g.bodyH;

        // ── 电弧起点/终点 ──
        g.arcStartX = g.fixedContactX;
        g.arcStartY = g.fixedContactY + H * 0.04;
        g.arcEndX   = g.arcChamberX + g.arcChamberW * 0.15;
        g.arcEndY   = g.arcChamberY + g.arcChamberH * 0.55;

        this._geo = g;
    }

    // ═══════════════════════════════════════════
    _init() {
        this._drawBackground();
        this._drawZoneDividers();
        this._drawArcChamber();        // 灭弧室（底层，被遮挡部分）
        this._drawFixedContact();      // 固定触头
        this._drawOperatingMechanism();// 操作机构（锁扣、连杆）
        this._drawBimetal();           // 双金属片（动态）
        this._drawSolenoid();          // 螺线管（含铁芯动态）
        this._drawTripLever();         // 脱扣杆
        this._buildContactGroup();     // 动触头（动态）
        this._buildArcGroup();         // 电弧粒子层
        this._buildCurrentFlow();      // 电流粒子层
        this._drawLabels();
        this._drawControlPanel();      // 演示控制面板
        
    }

    // ── 壳体背景 ─────────────────────────────
    _drawBackground() {
        const g = this._geo;
        // 外壳
        this._staticGroup.add(new Konva.Rect({
            x: g.bodyX - 2, y: g.bodyY - 2,
            width: g.bodyW + 4, height: g.bodyH + 4,
            fill: '#b0b8c0', stroke: '#808890', strokeWidth: 1.5,
            cornerRadius: 5,
            shadowColor: '#000', shadowBlur: 8, shadowOpacity: 0.25,
        }));
        // 内腔底色（绝缘塑料灰白）
        this._staticGroup.add(new Konva.Rect({
            x: g.bodyX, y: g.bodyY,
            width: g.bodyW, height: g.bodyH,
            fill: '#d8dce4',
            cornerRadius: 4,
        }));
        // 区域底色（参考图片的浅灰色内腔底面）
        [[g.zone1X, '#c8ccd4'], [g.zone2X, '#ccd0d8'], [g.zone3X, '#c4c8d0']].forEach(([zx, fc], i) => {
            const zw = [g.zone1W, g.zone2W, g.zone3W][i];
            this._staticGroup.add(new Konva.Rect({
                x: zx, y: g.bodyY,
                width: zw, height: g.bodyH,
                fill: fc, cornerRadius: i === 0 ? [4,0,0,4] : i === 2 ? [0,4,4,0] : 0,
            }));
        });
    }

    // ── 区域分隔线 ────────────────────────────
    _drawZoneDividers() {
        const g = this._geo;
        [g.zone2X, g.zone3X].forEach(dx => {
            this._staticGroup.add(new Konva.Line({
                points: [dx, g.bodyY + 4, dx, g.bodyY + g.bodyH - 4],
                stroke: '#a0a8b0', strokeWidth: 1, dash: [6,4],
            }));
        });
        // 区域标注
        const H = this.height;
        [
            { x: g.zone1X, w: g.zone1W, t: '操作机构' },
            { x: g.zone2X, w: g.zone2W, t: '脱扣机构' },
            { x: g.zone3X, w: g.zone3W, t: '灭弧室' },
        ].forEach(({ x, w, t }) => {
            this._staticGroup.add(new Konva.Text({
                x: x + 2, y: g.bodyY + g.bodyH - 12,
                width: w - 4, text: t,
                fontSize: 7.5, fill: '#606878', align: 'center',
            }));
        });
    }

    // ── 灭弧室 ────────────────────────────────
    _drawArcChamber() {
        const g  = this._geo;
        const ac = { x: g.arcChamberX, y: g.arcChamberY, w: g.arcChamberW, h: g.arcChamberH };

        // 外框（红色绝缘纸板）
        this._staticGroup.add(new Konva.Rect({
            x: ac.x, y: ac.y, width: ac.w, height: ac.h,
            fill: '#c62828', stroke: '#8b0000', strokeWidth: 1.5,
            cornerRadius: 3,
        }));
        // 内腔（暗黑色，电弧通道）
        this._staticGroup.add(new Konva.Rect({
            x: ac.x + 3, y: ac.y + 3,
            width: ac.w - 6, height: ac.h - 6,
            fill: '#1a1a1a', cornerRadius: 2,
        }));

        // 灭弧栅片（金属栅格，9片）
        const gapH = (ac.h - 10) / (g.gridCount + 1);
        for (let i = 1; i <= g.gridCount; i++) {
            const gy = ac.y + 5 + gapH * i;
            // 栅片主体
            this._staticGroup.add(new Konva.Rect({
                x: ac.x + 4, y: gy - 2,
                width: ac.w - 8, height: 4,
                fillLinearGradientStartPoint: { x: 0, y: 0 },
                fillLinearGradientEndPoint:   { x: ac.w-8, y: 0 },
                fillLinearGradientColorStops: [
                    0,'#5a5a5a', 0.20,'#9a9a9a', 0.50,'#c0c0c0', 0.80,'#8a8a8a', 1,'#5a5a5a',
                ],
                stroke: '#3a3a3a', strokeWidth: 0.5,
            }));
            // 栅片齿（右侧锯齿，参考图片中红色绝缘板右边缘的金属齿）
            for (let t = 0; t < 4; t++) {
                this._staticGroup.add(new Konva.Rect({
                    x: ac.x + ac.w - 10 + t*2.2, y: gy - 1.5,
                    width: 1.5, height: 3,
                    fill: '#a0a0a0',
                }));
            }
        }

        // 右侧出口（排气孔）
        this._staticGroup.add(new Konva.Rect({
            x: ac.x + ac.w - 2, y: ac.y + ac.h*0.30,
            width: 4, height: ac.h*0.40,
            fill: '#2a2a2a',
        }));

        // 标注
        this._staticGroup.add(new Konva.Text({
            x: ac.x + 2, y: ac.y + ac.h * 0.42,
            width: ac.w - 4, text: `灭弧栅\n${g.gridCount}片`,
            fontSize: 7.5, fill: '#ffcdd2', align: 'center', lineHeight: 1.4,
        }));
    }

    // ── 固定触头（上方进线端） ───────────────
    _drawFixedContact() {
        const g  = this._geo;
        const cx = g.fixedContactX;

        // 进线铜排
        this._staticGroup.add(new Konva.Rect({
            x: cx - 10, y: 0,
            width: 20, height: g.fixedContactY + 12,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: 20, y: 0 },
            fillLinearGradientColorStops: [0,'#7a6030', 0.3,'#c8a040', 0.6,'#e8c060', 0.9,'#b89038', 1,'#7a6030'],
            stroke: '#6a5020', strokeWidth: 0.8,
        }));

        // 固定静触头（圆形接触面）
        this._staticContact = new Konva.Circle({
            x: cx, y: g.fixedContactY + 10,
            radius: 8,
            fill: '#c8a040', stroke: '#8a6820', strokeWidth: 1.5,
            shadowColor: '#c8a040', shadowBlur: 0, shadowOpacity: 0.8,
        });
        this._staticGroup.add(this._staticContact);

        // 触点发光（合闸时）
        this._contactGlow = new Konva.Circle({
            x: cx, y: g.fixedContactY + 10,
            radius: 14,
            fill: 'rgba(255,180,50,0)',
        });
        this._staticGroup.add(this._contactGlow);

        // 接线端子标注
        this._staticGroup.add(new Konva.Text({
            x: cx - 12, y: -2,
            text: 'L (IN)', fontSize: 7.5, fontStyle: 'bold', fill: '#ef9a9a',
        }));
    }

    // ── 操作机构（锁扣、连杆、弹簧）─────────
    _drawOperatingMechanism() {
        const g = this._geo;

        // 操作手柄（顶部，已简化为状态指示）
        this._staticGroup.add(new Konva.Rect({
            x: g.zone1X + g.zone1W*0.20, y: g.bodyY + 2,
            width: g.zone1W * 0.60, height: this.height * 0.08,
            fill: '#1565c0', stroke: '#0d47a1', strokeWidth: 1.2, cornerRadius: 3,
        }));
        this._handleText = new Konva.Text({
            x: g.zone1X + g.zone1W*0.20, y: g.bodyY + 4,
            width: g.zone1W * 0.60,
            text: '●  合',
            fontSize: 9, fontStyle: 'bold', fill: '#fff', align: 'center',
        });
        this._staticGroup.add(this._handleText);

        // 上锁扣（勾形黑色塑料件）
        this._upperLatch = new Konva.Path({
            x: g.latchX, y: g.latchY,
            data: `M 0 0 L 18 0 L 18 12 Q 18 22 8 22 L 0 22 L 0 14 L 10 14 Q 12 14 12 12 L 12 0`,
            fill: '#2a2a2a', stroke: '#111', strokeWidth: 1,
        });
        this._staticGroup.add(this._upperLatch);

        // 下锁扣
        this._lowerLatch = new Konva.Path({
            x: g.latchX - 2, y: g.latchY + 30,
            data: `M 0 0 L 20 0 L 20 8 L 8 8 Q 4 8 4 12 L 4 20 L 0 20 Z`,
            fill: '#333', stroke: '#111', strokeWidth: 1,
        });
        this._staticGroup.add(this._lowerLatch);

        // 搭扣弹簧（折线弹簧）
        this._latchSpring = new Konva.Line({
            points: this._getSmallSpringPts(g.latchX - 8, g.latchY + 10, 16, 6),
            stroke: '#4a7a4a', strokeWidth: 2, lineJoin: 'round',
        });
        this._staticGroup.add(this._latchSpring);

        // 枢轴圆
        this._staticGroup.add(new Konva.Circle({
            x: g.pivotX, y: g.pivotY, radius: 6,
            fill: '#606870', stroke: '#404050', strokeWidth: 1.5,
        }));
        this._staticGroup.add(new Konva.Circle({
            x: g.pivotX, y: g.pivotY, radius: 2.5,
            fill: '#303040',
        }));
    }

    _getSmallSpringPts(x, y, len, coils) {
        const pts = [];
        for (let i = 0; i <= coils; i++) {
            pts.push(x + (len/coils)*i, y + (i%2===0 ? -4 : 4));
        }
        return pts;
    }

    // ── 双金属片（动态，过载热弯曲）─────────
    _drawBimetal() {
        const g  = this._geo;

        // 固定端
        this._staticGroup.add(new Konva.Rect({
            x: g.bimetalX - 4, y: g.bimetalY - 8,
            width: g.bimetalW + 8, height: 10,
            fill: '#606870', stroke: '#404050', strokeWidth: 0.8, cornerRadius: 2,
        }));

        // 双金属片本体（动态，贝塞尔曲线路径）
        this._bimetalPath = new Konva.Path({
            data: this._getBimetalPath(0),
            stroke: '#c0a030', strokeWidth: g.bimetalW,
            fill: 'transparent', lineCap: 'round',
        });
        this._staticGroup.add(this._bimetalPath);

        // 上层（不同金属，颜色稍深）
        this._bimetalPath2 = new Konva.Path({
            data: this._getBimetalPath(0),
            stroke: '#808898', strokeWidth: g.bimetalW * 0.45,
            fill: 'transparent', lineCap: 'round', opacity: 0.7,
        });
        this._staticGroup.add(this._bimetalPath2);

        // 热效应发光层
        this._bimetalHeat = new Konva.Path({
            data: this._getBimetalPath(0),
            stroke: 'rgba(255,80,0,0)',
            strokeWidth: g.bimetalW * 1.5,
            fill: 'transparent', lineCap: 'round', opacity: 0.0,
        });
        this._staticGroup.add(this._bimetalHeat);

        // 标注
        this._staticGroup.add(new Konva.Text({
            x: g.bimetalX - 4, y: g.bimetalY + g.bimetalH + 6,
            text: '双金属片', fontSize: 7, fill: '#606878',
        }));
        // 温度指示文字（动态）
        this._heatText = new Konva.Text({
            x: g.bimetalX - 16, y: g.bimetalY + g.bimetalH * 0.4,
            text: '',
            fontSize: 7.5, fontStyle: 'bold', fill: '#ef5350',
        });
        this._staticGroup.add(this._heatText);
    }

    _getBimetalPath(heatLevel) {
        const g  = this._geo;
        const x  = g.bimetalX + g.bimetalW/2;
        const y0 = g.bimetalY;
        const y1 = g.bimetalY + g.bimetalH;
        // 弯曲量（向右弯）
        const bend = heatLevel * g.bimetalW * 2.8;
        return `M ${x} ${y0} C ${x + bend*0.3} ${y0 + g.bimetalH*0.35} ${x + bend*0.7} ${y0 + g.bimetalH*0.65} ${x + bend} ${y1}`;
    }

    _updateBimetal() {
        const h  = this._heatLevel;
        const path = this._getBimetalPath(h);
        if (this._bimetalPath)  { this._bimetalPath.data(path);  }
        if (this._bimetalPath2) { this._bimetalPath2.data(path); }
        if (this._bimetalHeat) {
            this._bimetalHeat.data(path);
            const alpha = h * 0.65;
            this._bimetalHeat.stroke(`rgba(255,100,0,${alpha.toFixed(3)})`);
            this._bimetalHeat.opacity(alpha);
        }
        if (this._heatText) {
            if (h > 0.1) {
                const tempRise = Math.round(h * 120);
                this._heatText.text(`+${tempRise}°C`);
                this._heatText.fill(h > 0.7 ? '#ff5252' : '#fb8c00');
            } else {
                this._heatText.text('');
            }
        }
    }

    // ── 螺线管线圈（含铁芯）─────────────────
    _drawSolenoid() {
        const g  = this._geo;
        const sx = g.solenoidX, sy = g.solenoidY;
        const sw = g.solenoidW, sh = g.solenoidH;

        // 线圈外框
        this._staticGroup.add(new Konva.Rect({
            x: sx, y: sy, width: sw, height: sh,
            fill: '#1a1e2a', stroke: '#303448', strokeWidth: 1.5, cornerRadius: 3,
        }));

        // 铜线圈绕组（橙棕色，参考图片）
        const coilCount = 14;
        for (let i = 0; i < coilCount; i++) {
            const cy2 = sy + 4 + (sh - 10) * (i / coilCount);
            const colorT = i / coilCount;
            const r = Math.round(150 + colorT * 60);
            const grn = Math.round(80 + colorT * 30);
            this._staticGroup.add(new Konva.Line({
                points: [sx+3, cy2, sx+sw-3, cy2 + 4],
                stroke: `rgb(${r},${grn},20)`,
                strokeWidth: 3.5, lineCap: 'round',
            }));
        }

        // 铁芯外框（线圈内部）
        this._staticGroup.add(new Konva.Rect({
            x: g.plungerX, y: g.plungerY0 + sh * 0.55,
            width: g.plungerW, height: g.plungerH * 0.5,
            fill: '#606878', stroke: '#404050', strokeWidth: 0.8, cornerRadius: 2,
        }));

        // 铁芯（动态，短路时被吸入）
        this._plunger = new Konva.Rect({
            x: g.plungerX, y: g.plungerY0,
            width: g.plungerW, height: g.plungerH,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: g.plungerW, y: 0 },
            fillLinearGradientColorStops: [0,'#484858', 0.4,'#7878a0', 0.6,'#8888b0', 1,'#484858'],
            stroke: '#303040', strokeWidth: 1, cornerRadius: 2,
        });
        this._staticGroup.add(this._plunger);

        // 铁芯弹簧（铁芯下方）
        this._plungerSpring = new Konva.Line({
            points: this._getSmallSpringPts(
                g.plungerX + g.plungerW*0.35,
                g.plungerY0 + g.plungerH,
                g.plungerW*0.30, 5
            ),
            stroke: '#3a8a3a', strokeWidth: 1.8, lineJoin: 'round',
        });
        this._staticGroup.add(this._plungerSpring);

        // 磁场光晕（短路时发光）
        this._solenoidGlow = new Konva.Rect({
            x: sx - 3, y: sy - 3, width: sw + 6, height: sh + 6,
            fill: 'rgba(100,150,255,0)',
            stroke: 'rgba(100,150,255,0)',
            strokeWidth: 3, cornerRadius: 5,
        });
        this._staticGroup.add(this._solenoidGlow);

        // 标注
        this._staticGroup.add(new Konva.Text({
            x: sx, y: sy + sh + 4,
            width: sw, text: '电磁脱扣器\n(螺线管)',
            fontSize: 7, fill: '#606878', align: 'center', lineHeight: 1.3,
        }));
    }

    _updateSolenoid() {
        const g = this._geo;
        const p = this._plungerY;  // 0~1

        // 铁芯向下移动（被吸入线圈）
        const moveY = p * g.solenoidH * 0.52;
        this._plunger.y(g.plungerY0 + moveY);

        // 磁场光晕
        const glowA = p * 0.5;
        this._solenoidGlow.fill(`rgba(80,120,255,${(glowA*0.3).toFixed(3)})`);
        this._solenoidGlow.stroke(`rgba(80,120,255,${glowA.toFixed(3)})`);
    }

    // ── 脱扣杆 ────────────────────────────────
    _drawTripLever() {
        const g  = this._geo;
        const tx = g.tripLeverX, ty = g.tripLeverY;

        // 脱扣杆主体（L形杆，黑色塑料）
        this._tripLeverGroup = new Konva.Group({ x: tx, y: ty });

        this._tripLeverGroup.add(new Konva.Path({
            data: `M 0 0 L 48 0 L 48 8 L 10 8 L 10 ${g.tripLeverLen} L 0 ${g.tripLeverLen} Z`,
            fill: '#2a2a2a', stroke: '#111', strokeWidth: 1, cornerRadius: 2,
        }));
        // 枢轴点
        this._tripLeverGroup.add(new Konva.Circle({
            x: 10, y: 8, radius: 4,
            fill: '#606870', stroke: '#404050', strokeWidth: 1,
        }));

        this._staticGroup.add(this._tripLeverGroup);

        // 脱扣杆旋转角度（0=正常，1=脱扣）
        this._tripLeverAngle = 0;
    }

    _updateTripLever() {
        const targetAngle = (this._state === 'TRIPPING' || this._state === 'ARCING' || this._state === 'OPEN') ? 20 : 0;
        this._tripLeverAngle += (targetAngle - this._tripLeverAngle) * 0.15;
        if (this._tripLeverGroup) {
            this._tripLeverGroup.rotation(this._tripLeverAngle);
        }
    }

    // ── 动触头（动态旋转组）─────────────────
    _buildContactGroup() {
        const g = this._geo;
        this._contactGroup = new Konva.Group();
        this._staticGroup.add(this._contactGroup);
        this._rebuildContact();
    }

    _getContactAngleForState() {
        // 0 = 合闸（水平朝上，接触静触头）
        // 1 = 分闸（向右旋转约 40°）
        return this._contactAngle;
    }

    _rebuildContact() {
        this._contactGroup.destroyChildren();
        const g     = this._geo;
        const t     = this._contactAngle;   // 0~1
        const angle = t * 42;               // °，0=合，42=分
        const px    = g.pivotX, py = g.pivotY;

        const grp = new Konva.Group({ x: px, y: py, rotation: angle });

        // 动触头臂（铜制扁条）
        grp.add(new Konva.Rect({
            x: -5, y: -g.armLen,
            width: 10, height: g.armLen,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: 10, y: 0 },
            fillLinearGradientColorStops: [0,'#7a6030', 0.3,'#c8a040', 0.6,'#e8c060', 1,'#7a6030'],
            stroke: '#6a5020', strokeWidth: 0.8,
            cornerRadius: [3,3,0,0],
        }));

        // 动触头（顶端圆形接触点）
        const contactColor = t < 0.05 ? '#ffcc40' : '#c8a040';
        grp.add(new Konva.Circle({
            x: 0, y: -g.armLen,
            radius: 7,
            fill: contactColor, stroke: '#8a6820', strokeWidth: 1.5,
            shadowColor: t < 0.05 ? '#ffcc40' : 'transparent',
            shadowBlur: t < 0.05 ? 8 : 0, shadowOpacity: 0.8,
        }));

        // 合闸时的接触点高亮
        if (t < 0.05) {
            grp.add(new Konva.Circle({
                x: 0, y: -g.armLen, radius: 12,
                fill: 'rgba(255,200,50,0.20)',
            }));
        }

        // 导线（软连接，随臂摆动）
        grp.add(new Konva.Path({
            data: `M 4 0 Q ${8 + t*15} ${-g.armLen*0.3} 5 ${-g.armLen*0.6}`,
            stroke: '#c8a040', strokeWidth: 3, fill: 'transparent',
            lineCap: 'round',
        }));

        this._contactGroup.add(grp);

        // 出线铜排（下方固定）
        this._contactGroup.add(new Konva.Rect({
            x: px - 6, y: py,
            width: 12, height: this.height - py,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: 12, y: 0 },
            fillLinearGradientColorStops: [0,'#7a6030', 0.4,'#c8a040', 0.7,'#b89038', 1,'#7a6030'],
            stroke: '#6a5020', strokeWidth: 0.8,
        }));

        // 出线标注
        this._contactGroup.add(new Konva.Text({
            x: px - 18, y: this.height - 10,
            text: 'N (OUT)', fontSize: 7.5, fontStyle: 'bold', fill: '#90caf9',
        }));
    }

    // ── 电弧粒子层 ────────────────────────────
    _buildArcGroup() {
        this._arcGroup = new Konva.Group();
        this._staticGroup.add(this._arcGroup);
    }

    _renderArc(dt) {
        this._arcGroup.destroyChildren();
        if (this._state !== 'ARCING') return;

        const g     = this._geo;
        const phase = this._arcPhase;  // 0~1
        const t     = this._arcT;

        // 电弧起点：动触头当前位置
        const angle   = this._contactAngle * 42 * Math.PI / 180;
        const arcSX   = g.pivotX + Math.sin(angle) * (-g.armLen * (-1)) * 0.1;
        const arcSY   = g.pivotY - Math.cos(angle) * g.armLen;
        // 电弧终点：静触头
        const arcEX   = g.fixedContactX;
        const arcEY   = g.fixedContactY + 10;

        // Phase 1 & 2：触头间直接电弧
        if (phase < 0.45) {
            const arcIntensity = (1 - phase/0.45);
            const count = Math.round(3 + arcIntensity * 4);
            for (let i = 0; i < count; i++) {
                const isShort = this._tripType === 'SHORT';
                const pts = this._generateArcPoints(arcSX, arcSY, arcEX, arcEY, i, isShort);
                const alpha = arcIntensity * (0.6 + Math.random() * 0.4);
                const color = isShort
                    ? `rgba(${180+Math.round(Math.random()*75)},${200+Math.round(Math.random()*55)},255,${alpha.toFixed(2)})`
                    : `rgba(255,${160+Math.round(Math.random()*95)},${30+Math.round(Math.random()*60)},${alpha.toFixed(2)})`;
                this._arcGroup.add(new Konva.Line({
                    points: pts, stroke: color,
                    strokeWidth: 1.5 + arcIntensity * 2 + Math.random() * 1.5,
                    lineJoin: 'round', lineCap: 'round',
                }));
            }
        }

        // Phase 2-3：电弧向灭弧室迁移
        if (phase > 0.15 && phase < 0.7) {
            const migRatio = Math.min(1, (phase - 0.15) / 0.45);
            // 电弧从触头弯向灭弧室入口
            const midX = arcSX + (g.arcEndX - arcSX) * migRatio;
            const midY = arcSY + (g.arcEndY - arcSY) * migRatio * 0.5;
            this._arcGroup.add(new Konva.Path({
                data: `M ${arcSX} ${arcSY} Q ${midX + 20} ${midY} ${midX} ${arcSY + (arcEY - arcSY)*migRatio}`,
                stroke: `rgba(255,140,30,${(0.7 - phase).toFixed(2)})`,
                strokeWidth: 1.5 + (1-migRatio) * 2,
                fill: 'transparent', lineCap: 'round',
            }));
        }

        // Phase 3-4：灭弧栅内分割的多段小电弧
        if (phase > 0.35) {
            const splitRatio = Math.min(1, (phase - 0.35) / 0.35);
            const activeSlots = Math.round(splitRatio * g.gridCount * 0.8);
            const ac = { x: g.arcChamberX, y: g.arcChamberY, w: g.arcChamberW, h: g.arcChamberH };
            const gapH = (ac.h - 10) / (g.gridCount + 1);

            for (let i = 0; i < activeSlots; i++) {
                const slotY = ac.y + 5 + gapH * (i + 1) + gapH * 0.15;
                const slotH = gapH * 0.7;
                const segAlpha = Math.max(0, (1 - phase) * 1.8 + Math.random() * 0.3);
                if (segAlpha < 0.05) continue;

                // 每段小弧（锯齿折线）
                const segPts = [];
                const segCount = 5;
                for (let s = 0; s <= segCount; s++) {
                    const sx2 = ac.x + 6 + (ac.w - 14) * (s / segCount);
                    const sy2 = slotY + (s%2===0 ? -2 : 2) + Math.random()*2 - 1;
                    segPts.push(sx2, sy2);
                }
                const hue = Math.round(30 - phase * 25);
                this._arcGroup.add(new Konva.Line({
                    points: segPts,
                    stroke: `rgba(255,${120 + Math.round(hue*3)},80,${segAlpha.toFixed(2)})`,
                    strokeWidth: 0.8 + (1-phase) * 1.5,
                    lineJoin: 'round', lineCap: 'round',
                }));
            }

            // 残余紫色辉光（相变 > 0.75）
            if (phase > 0.75) {
                const residualAlpha = (1 - phase) * 0.8;
                for (let i = 0; i < 3; i++) {
                    const rx2 = ac.x + ac.w * (0.2 + Math.random() * 0.6);
                    const ry2 = ac.y + ac.h * (0.3 + Math.random() * 0.4);
                    this._arcGroup.add(new Konva.Circle({
                        x: rx2, y: ry2, radius: 3 + Math.random() * 4,
                        fill: `rgba(200,100,255,${(residualAlpha * Math.random()).toFixed(3)})`,
                    }));
                }
            }
        }

        // 电弧进度更新
        this._arcT    += dt;
        this._arcPhase = Math.min(1, this._arcT / this._arcDur);

        // 电弧熄灭后进入 OPEN
        if (this._arcPhase >= 1) {
            this._state        = 'OPEN';
            this._contactAngle = 1;
            this._plungerY     = 0;
        }
    }

    _generateArcPoints(sx, sy, ex, ey, seed, isShort) {
        const pts    = [sx, sy];
        const steps  = 6 + Math.floor(Math.random() * 4);
        const ampMax = isShort ? 20 : 12;
        for (let i = 1; i < steps; i++) {
            const t2  = i / steps;
            const mx  = sx + (ex - sx) * t2;
            const my  = sy + (ey - sy) * t2;
            const amp = (Math.random() - 0.5) * ampMax;
            const amp2= (Math.random() - 0.5) * ampMax * 0.5;
            pts.push(mx + amp2, my + amp);
        }
        pts.push(ex, ey);
        return pts;
    }

    // ── 电流流动粒子 ─────────────────────────
    _buildCurrentFlow() {
        this._currentGroup = new Konva.Group();
        this._staticGroup.add(this._currentGroup);
    }

    _renderCurrentFlow(dt) {
        this._currentGroup.destroyChildren();
        if (this._state !== 'CLOSED') return;

        const g    = this._geo;
        const cx   = g.fixedContactX;

        // 电流粒子（沿导通路径流动）
        const count = Math.floor(4 + (this.loadCurrent / this.ratedCurrent) * 6);
        const T     = Date.now() / 1000;

        for (let i = 0; i < count; i++) {
            const phase = ((T * 1.5 + i * (1/count)) % 1);
            // 路径：从进线端→触头→出线端，垂直路径
            const py2   = g.fixedContactY * (1 - phase) + (g.pivotY + g.armLen) * phase;
            const alpha = 0.5 + 0.5 * Math.sin(phase * Math.PI);
            const iRatio = Math.min(1, this.loadCurrent / (this.ratedCurrent * 1.2));
            const r = Math.round(255 * iRatio);
            const gb = Math.round(255 * (1 - iRatio * 0.5));
            this._currentGroup.add(new Konva.Circle({
                x: cx + (Math.random()-0.5)*4, y: py2,
                radius: 2 + iRatio * 1.5,
                fill: `rgba(${r},${gb},${gb},${alpha.toFixed(2)})`,
            }));
        }

        // 电流值显示
        if (this.loadCurrent > 0) {
            const overRatio = this.loadCurrent / this.ratedCurrent;
            const color = overRatio > 1.5 ? '#ff5252' : overRatio > 1.1 ? '#fb8c00' : '#81c784';
            this._currentGroup.add(new Konva.Text({
                x: g.zone1X + 4, y: g.bodyY + g.bodyH * 0.55,
                text: `I = ${this.loadCurrent.toFixed(1)} A\n(${(overRatio*100).toFixed(0)}% In)`,
                fontSize: 8, fontStyle: 'bold', fill: color, lineHeight: 1.4,
            }));
        }
    }

    // ── 控制面板（演示用按钮）───────────────
    _drawControlPanel() {
        const W = this.width, H = this.height;
        const py = H + 14;

        // 三个按钮背景
        [
            { label: '● 合闸',    color: '#1b5e20', key: 'close',    x: 0 },
            { label: '⚡ 过载模拟', color: '#e65100', key: 'overload', x: W*0.34 },
            { label: '⚡ 短路模拟', color: '#c62828', key: 'short',    x: W*0.67 },
        ].forEach(({ label, color, key, x }) => {
            const bw = W * 0.30;
            const btn = new Konva.Rect({
                x: x, y: py, width: bw, height: 20,
                fill: color, stroke: '#000', strokeWidth: 0.8, cornerRadius: 3,
                shadowColor: '#000', shadowBlur: 3, shadowOpacity: 0.3,
            });
            this._interactGroup.add(btn);
            this._staticGroup.add(new Konva.Text({
                x: x + 2, y: py + 4, width: bw - 4,
                text: label, fontSize: 8, fontStyle: 'bold',
                fill: '#fff', align: 'center',
            }));
            btn.on('click tap', () => {
                if (key === 'close')    this.close();
                if (key === 'overload') this.simulateOverload();
                if (key === 'short')    this.simulateShortCircuit();
            });
            btn.listening(true);
        });
    }

    // ── 标注 ─────────────────────────────────
    _drawLabels() {
        const W = this.width;
        this._staticGroup.add(new Konva.Text({
            x: 0, y: -18, width: W,
            text: `${this.label}  单相空气开关（解剖图）  ${this.ratedVoltage}V / ${this.ratedCurrent}A`,
            fontSize: 9, fontStyle: 'bold', fill: '#546e7a', align: 'center',
        }));

        // 状态文字（动态）
        this._stateText = new Konva.Text({
            x: 0, y: -8, width: W,
            text: this._stateLabel(),
            fontSize: 8, fontStyle: 'bold',
            fill: this._stateColor(), align: 'center',
        });
        this._staticGroup.add(this._stateText);

        // 脱扣原理说明（分栏标注）
        [
            { x: this._geo.bimetalX - 10, y: this._geo.bodyY + 4, t: '🌡过载\n热脱扣' },
            { x: this._geo.solenoidX,     y: this._geo.bodyY + 4, t: '⚡短路\n电磁脱扣' },
        ].forEach(({ x, y, t }) => {
            this._staticGroup.add(new Konva.Text({
                x, y, text: t, fontSize: 7, fill: '#37474f',
                lineHeight: 1.3, fontStyle: 'bold',
            }));
        });
    }

    _stateLabel() {
        const m = {
            CLOSED: '● 合闸运行',
            TRIPPING: '⚡ 脱扣动作中…',
            ARCING: this._arcPhase < 0.35 ? '🔥 燃弧中' : this._arcPhase < 0.65 ? '🔥 电弧迁移→灭弧栅' : '💨 电弧分割熄灭中…',
            OPEN: '○ 分闸（回路断开）',
            RESETTING: '↩ 复位中…',
        };
        return m[this._state] || '';
    }

    _stateColor() {
        const c = { CLOSED:'#43a047', TRIPPING:'#fb8c00', ARCING:'#ef5350', OPEN:'#90a4ae', RESETTING:'#1976d2' };
        return c[this._state] || '#607080';
    }

    // ═══════════════════════════════════════════
    // 主循环
    // 集中化 tick（由 consys._tickAll 在 20fps 调用）
    tick(dt) {
        this._tickSim(dt);
    
        this._refreshCache();
    }
    _tickSim(dt) {
        // ── 热效应计算（过载脱扣） ──
        if (this._state === 'CLOSED') {
            const overRatio = this.loadCurrent / this.ratedCurrent;
            if (overRatio > 1.05) {
                // 加热：超出额定电流的平方成正比
                this._heatGain = Math.pow(overRatio - 1.0, 1.5) * 0.12;
                this._heatLevel = Math.min(1, this._heatLevel + this._heatGain * dt);
            } else {
                // 冷却
                this._heatLevel = Math.max(0, this._heatLevel - this._heatDecay * dt);
            }

            // 过载脱扣阈值
            if (this._heatLevel >= 1.0 && this._state === 'CLOSED') {
                this._triggerTrip('OVERLOAD');
            }
        } else if (this._state === 'OPEN' || this._state === 'TRIPPING') {
            // 冷却
            this._heatLevel = Math.max(0, this._heatLevel - this._heatDecay * 0.5 * dt);
        }

        // ── 脱扣动作（触头分离） ──
        if (this._state === 'TRIPPING') {
            this._contactAngle += dt * 3.5;
            if (this._contactAngle >= 0.5) {
                this._contactAngle = 0.5;
                this._state = 'ARCING';
                this._arcT = 0;
                this._arcPhase = 0;
            }
        }

        // ── 合闸动作（复位） ──
        if (this._state === 'RESETTING') {
            this._contactAngle -= dt * 2.5;
            this._plungerY = Math.max(0, this._plungerY - dt * 3);
            if (this._contactAngle <= 0) {
                this._contactAngle = 0;
                this._state = 'CLOSED';
                this._tripType = null;
                this._heatLevel = 0;
            }
        }

        // ── 铁芯复位（短路脱扣后逐渐弹回） ──
        if (this._state !== 'TRIPPING') {
            if (this._tripType !== 'SHORT' || this._state === 'OPEN') {
                this._plungerY = Math.max(0, this._plungerY - dt * 1.2);
            }
        }

        // ── 更新各动态元素 ──
        this._updateBimetal();
        this._updateSolenoid();
        this._updateTripLever();
        this._rebuildContact();
        this._renderArc(dt);
        this._renderCurrentFlow(dt);

        // ── 更新状态文字和手柄 ──
        if (this._stateText) {
            this._stateText.text(this._stateLabel());
            this._stateText.fill(this._stateColor());
        }
        if (this._handleText) {
            const c = this._state === 'CLOSED';
            this._handleText.text(c ? '●  合' : '○  分');
            this._handleText.fill(c ? '#a5d6a7' : '#ef9a9a');
        }
        // 静触头发光
        if (this._staticContact) {
            this._staticContact.shadowBlur(this._state === 'CLOSED' ? 10 : 0);
            this._contactGlow.fill(this._state === 'CLOSED' ? 'rgba(255,200,50,0.18)' : 'rgba(255,200,50,0)');
        }

        this._refreshCache();
    }

    // ── 触发脱扣 ─────────────────────────────
    _triggerTrip(type) {
        if (this._state !== 'CLOSED') return;
        this._tripType    = type;
        this._state       = 'TRIPPING';
        if (type === 'SHORT') {
            this._plungerY  = 1;    // 铁芯瞬间吸合
            this._arcDur    = 0.5;  // 短路电弧较短（熄弧快）
        } else {
            this._arcDur    = 0.7;  // 过载电弧稍长
        }
    }

    // ═══════════════════════════════════════════
    // 公开 API

    /** 合闸复位 */
    close() {
        if (this._state === 'ARCING' || this._state === 'TRIPPING') return;
        if (this._state === 'CLOSED') return;
        this._state = 'RESETTING';
    }

    /** 手动分闸 */
    open() {
        if (this._state !== 'CLOSED') return;
        this._triggerTrip('OVERLOAD');
    }

    /** 模拟过载（设置为额定电流的 3 倍，会触发热脱扣） */
    simulateOverload(multiple = 3) {
        if (this._state !== 'CLOSED') this.close();
        setTimeout(() => {
            this.loadCurrent = this.ratedCurrent * multiple;
        }, 300);
    }

    /** 模拟短路（立即触发电磁脱扣） */
    simulateShortCircuit() {
        if (this._state !== 'CLOSED') {
            this.close();
            setTimeout(() => this._triggerTrip('SHORT'), 350);
        } else {
            this._triggerTrip('SHORT');
        }
    }

    /** 设置负载电流（A）*/
    setLoadCurrent(mA) {
        this.loadCurrent = Math.max(0, mA);
    }

    getState()     { return this._state; }
    isClosed()     { return this._state === 'CLOSED'; }
    getHeatLevel() { return this._heatLevel; }

    update(state) {
        if (typeof state === 'boolean') { state ? this.close() : this.open(); }
        if (typeof state === 'number')  { this.setLoadCurrent(state); }
        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label: '位号',             key: 'label',        type: 'text'   },
            { label: '额定电流 (A)',      key: 'ratedCurrent', type: 'number' },
            { label: '额定电压 (V)',      key: 'ratedVoltage', type: 'number' },
            { label: '脱扣曲线 (B/C/D)', key: 'tripCurve',    type: 'text'   },
            { label: '初始电流 (A)',      key: 'loadCurrent',  type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label)        this.label        = cfg.label;
        if (cfg.ratedCurrent) this.ratedCurrent = parseFloat(cfg.ratedCurrent);
        if (cfg.ratedVoltage) this.ratedVoltage = parseFloat(cfg.ratedVoltage);
        if (cfg.tripCurve)    this.tripCurve    = cfg.tripCurve;
        if (cfg.loadCurrent !== undefined) this.loadCurrent = parseFloat(cfg.loadCurrent);
        this.config = { ...this.config, ...cfg };
        this._refreshCache();
    }

    destroy() {
        super.destroy?.();
    }
}