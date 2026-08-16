import { BaseComponent } from './BaseComponent.js';

/**
 * 三相空气断路器（Three-Phase Air Circuit Breaker / MCCB）仿真组件
 *
 * ═══ 渲染优化原则 ═══════════════════════════════════════════
 *  1. 动态元素（操作手柄、三极触头刀片、跳闸状态指示）使用 in-place 更新
 *  2. 消除所有 shadow 属性，避免离屏阴影渲染
 *  3. 静态部件（外框、绝缘底座、接线柱、铭牌）仅在 init 时缓存
 *  4. 电弧特效在独立 _arcGroup 中重建，不干扰主体动态节点
 * ═══════════════════════════════════════════════════════════
 *
 * ── 结构说明 ──────────────────────────────────────────────────
 *
 *  左半区：操作面板（物理操作侧）
 *    - 断路器壳体：深色工程塑料外壳
 *    - 操作手柄（Handle）：可拨动的扳手，三个状态：
 *        ON（合闸）  → 手柄推至上方
 *        OFF（分闸） → 手柄推至下方
 *        TRIP（跳闸）→ 手柄弹至中间位置，红色跳闸指示
 *    - 状态指示窗：显示 ON / OFF / TRIP 文字
 *    - 手柄刻度弧：显示档位范围
 *
 *  右半区：电路原理图区（IEC 60617 图形符号）
 *    - 三极主触头（L1/L2/L3 ↔ T1/T2/T3）：上进线端、下出线端
 *    - 三个可动触桥：模拟三极同步开合动作
 *    - 过电流脱扣器符号（矩形方框，带热元件波浪线）
 *    - 合闸时绿色触点高光，分闸/跳闸时灰色
 *
 * ── 断路器状态机 ───────────────────────────────────────────
 *
 *  ON   → 点击手柄或调用 open()  → OFF（带动画，产生电弧）
 *  OFF  → 点击手柄或调用 close() → ON（带动画，产生电弧）
 *  TRIP → 只能先拨到 OFF（复位），再拨到 ON（合闸）
 *  任意状态 → 调用 trip()  → TRIP（瞬时，产生电弧）
 *  TRIP → 点击手柄拨向 OFF 侧 → OFF（手动复位）
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  l1 — 进线端 L1（左上）
 *  l2 — 进线端 L2（中上）
 *  l3 — 进线端 L3（右上）
 *  t1 — 出线端 T1（左下）
 *  t2 — 出线端 T2（中下）
 *  t3 — 出线端 T3（右下）
 *  fla — 分励脱扣器 A（右中上）
 *  flb — 分励脱扣器 B（右中下）
 *
 * ── 可配置参数 ────────────────────────────────────────────────
 *  label          : 位号（默认 'QF'）
 *  ratedVoltage   : 额定电压 V（默认 380）
 *  ratedCurrent   : 额定电流 A（默认 100）
 *  tripCurrent    : 脱扣电流（过载倍数，默认 10，即 10×In）
 *  initState      : 初始状态 'on'|'off'|'trip'（默认 'off'）
 *  animDur        : 分合闸动画时长 s（默认 0.10）
 */
export class ThreePhaseACB extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(260, config.width  || 350);
        this.height = Math.max(120, config.height || 160);

        this.type    = 'ACB';
        this.special = '3P-ACB';
        this.cache   = 'fixed';

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        this.config = {
            label:        this.label,
            ratedVoltage: this.ratedVoltage,
            ratedCurrent: this.ratedCurrent,
            tripCurrent:  this.tripCurrent,
            initState:    this._state,
            animDur:      this._animDur,
            tripCoilR:    this._tripCoilR,
        };

        // ── 端口 ──────────────────────────────────────
        // L1/L2/L3 进线端（上边）
        this.addPort(this._portL[0].x, this._portL[0].y, 'l1', 'wire');
        this.addPort(this._portL[1].x, this._portL[1].y, 'l2', 'wire');
        this.addPort(this._portL[2].x, this._portL[2].y, 'l3', 'wire');
        // T1/T2/T3 出线端（下边）
        this.addPort(this._portT[0].x, this._portT[0].y, 't1', 'wire', 'p');
        this.addPort(this._portT[1].x, this._portT[1].y, 't2', 'wire', 'p');
        this.addPort(this._portT[2].x, this._portT[2].y, 't3', 'wire', 'p');
        // fla/flb 分励脱扣器接口（右边）
        this.addPort(this._portFla.x, this._portFla.y, 'fla', 'wire');
        this.addPort(this._portFlb.x, this._portFlb.y, 'flb', 'wire');
    }

    // ═══════════════════════════════════════════
    // 几何尺寸计算
    // ═══════════════════════════════════════════

    _recalcGeometry() {
        const W = this.width, H = this.height;

        // 左右分割线（左侧操作面板，右侧原理图）
        this._divX = W * 0.43;

        // ── 外框 ──
        this._frame = { x: 2, y: 2, w: W - 4, h: H - 4, rx: 6 };

        // ── 左侧操作面板几何 ──────────────────────────
        // 断路器外壳矩形（仿工程塑料外壳）
        const panelPad = 8;
        this._shellRect = {
            x: panelPad,
            y: panelPad,
            w: this._divX - panelPad * 2,
            h: H - panelPad * 2,
            rx: 5,
        };

        // 操作手柄中心（外壳中央偏上）
        this._handleCX = this._shellRect.x + this._shellRect.w * 0.50;
        this._handleCY = H * 0.55;

        // 手柄轨道：从 OFF 到 ON
        // ON  → 手柄偏右（12 点方向，90° 朝上）
        // OFF → 手柄偏左（约 45° 朝右下）
        // TRIP→ 手柄居中（竖直偏左，约 110°）
        this._handleAngles = {
            on:   0,   // 向右上（合闸）
            off:   160,   // 向右下（分闸）
            trip:   90,   // 居中竖直（跳闸弹出）
        };

        // 手柄长度
        this._handleLen  = Math.min(this._shellRect.w * 0.42, this._shellRect.h * 0.38);
        this._handleW    = Math.max(8, W * 0.032);

        // 手柄枢轴半径（弧形底座）
        this._pivotR     = Math.max(7, W * 0.030);

        // 刻度弧半径
        this._scaleArcR  = this._handleLen * 1.18;

        // 状态指示窗（外壳上方）
        this._indicatorRect = {
            x: this._shellRect.x + 6,
            y: this._shellRect.y + 6,
            w: this._shellRect.w - 12,
            h: Math.max(18, H * 0.14),
            rx: 3,
        };

        // ── 右侧电路原理图区几何 ───────────────────
        const rLeft = this._divX + W * 0.03;
        const rW    = W - rLeft - W * 0.03;

        // 三极对称排布，均匀分列
        const poles = 3;
        this._poleXs = Array.from({ length: poles }, (_, i) =>
            rLeft + rW * (i + 0.36) / poles
        );

        // 进线端 Y（上方）
        this._lineInY  = H * 0.18;
        // 出线端 Y（下方）
        this._lineOutY = H * 0.82;

        // 触头固定接触点（进线侧触头）
        this._contactInY  = H * 0.33;
        // 触头固定接触点（出线侧触头）
        this._contactOutY = H * 0.67;

        // 触头间距（合闸时触桥中心 Y 居中，分闸时上方离开）
        this._contactR    = Math.max(5, W * 0.020);

        // 触桥矩形尺寸（每极）
        this._bridgeW = Math.max(8, rW / poles * 0.35);
        this._bridgeH = (this._contactOutY - this._contactInY) * 0.55;

        // 过电流脱扣器区域（三极共用，原理图下区）
        this._tripBoxY = this._contactOutY + 6;
        this._tripBoxH = H * 0.10;

        // 接线柱半径
        this._termR = Math.max(4, W * 0.018);

        // 端口（组件外部引线）
        this._portL = this._poleXs.map(px => ({ x: px, y: 2 }));
        this._portT = this._poleXs.map(px => ({ x: px, y: H - 2 }));
        // 分励脱扣器端口（右边）
        this._portFla = { x: W - 2, y: H * 0.32 };
        this._portFlb = { x: W - 2, y: H * 0.68 };

        // Test 按钮（左壳体内侧，垂直居中于手柄）
        this._testBtn = {
            x: this._shellRect.x + 4,
            y: this._handleCY - 10,
            w: this._shellRect.w * 0.22,
            h: 20,
            rx: 3,
        };

        // 标签位置
        this._labelPos = { x: 0, y: -16, w: W };
    }

    // ═══════════════════════════════════════════
    // 参数初始化
    // ═══════════════════════════════════════════

    _initParameters(config) {
        this.ratedVoltage = config.ratedVoltage !== undefined ? config.ratedVoltage : 380;
        this.ratedCurrent = config.ratedCurrent !== undefined ? config.ratedCurrent : 100;
        this.tripCurrent  = config.tripCurrent  !== undefined ? config.tripCurrent  : 10;
        this.label        = config.label        || 'QF';
        this.function     = config.function     || '三相空气断路器';

        // 状态：'on' | 'off' | 'trip'
        const initState = (config.initState || 'off').toLowerCase();
        this._state       = ['on', 'off', 'trip'].includes(initState) ? initState : 'off';
        this._prevState   = this._state;

        // 动画
        this._animating   = false;
        this._animT       = 0;
        this._animFromAng = this._handleAngles[this._state];
        this._animToAng   = this._handleAngles[this._state];
        this._curHandleAng = this._handleAngles[this._state];

        // 触桥偏移（合闸=0，分闸/跳闸=负值上移）
        this._bridgeOffset    = this._state === 'on' ? 0 : -(this._contactOutY - this._contactInY) * 0.35;
        this._bridgeOffsetTo  = this._bridgeOffset;
        this._bridgeOffsetFrom = this._bridgeOffset;

        this._arcFrames     = 0;
        this._animDur       = config.animDur !== undefined ? config.animDur : 0.10;
        this._animJustEnded = false;

        // ── 三相电流 RMS 测量缓冲区 ──
        this._iBuf = [new Array(40).fill(0), new Array(40).fill(0), new Array(40).fill(0)];
        this._iBufSum = [0, 0, 0];
        this._iBufIdx = 0;
        this._iBufCount = 0;
        this._iRms = [0, 0, 0];

        this.opsCount = config.initOps || 0;

        this._tripCoilR = config.tripCoilR !== undefined ? config.tripCoilR : 50;
    }

    // ═══════════════════════════════════════════
    // 主初始化入口
    // ═══════════════════════════════════════════

    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
    }

    // ═══════════════════════════════════════════
    // 静态部件
    // ═══════════════════════════════════════════

    _drawStaticParts() {
        this._drawFrame();
        this._drawDivider();
        this._drawShell();
        this._drawScaleArc();
        this._drawSchematicStatic();
        this._drawTripCoil();
        this._drawTestButton();
        this._drawLabel();
    }

    /** 外框 */
    _drawFrame() {
        const f = this._frame;
        this._staticGroup.add(new Konva.Rect({
            x: f.x, y: f.y, width: f.w, height: f.h,
            fill: '#dee0eb',
            stroke: '#b0a698',
            strokeWidth: 1.5,
            cornerRadius: f.rx,
        }));
        // 顶部装饰条
        this._staticGroup.add(new Konva.Rect({
            x: f.x + 2, y: f.y + 2, width: f.w - 4, height: f.h * 0.10,
            fill: 'rgba(100,140,220,0.18)',
            cornerRadius: [f.rx, f.rx, 0, 0],
        }));
        // 功能标注
        this._staticGroup.add(new Konva.Text({
            x: f.x + 4, y: f.y - 16,
            text: this.function,
            fontSize: Math.max(14, this.width * 0.028),
            fill: '#5a6a7a',
            fontStyle:'bold'
        }));
    }

    /** 左右分隔线 */
    _drawDivider() {
        this._staticGroup.add(new Konva.Line({
            points: [this._divX, this._frame.y + 8, this._divX, this._frame.y + this._frame.h - 8],
            stroke: '#b0a698', strokeWidth: 1, dash: [4, 4],
        }));
    }

    /** 断路器外壳（工程塑料外壳仿真） */
    _drawShell() {
        const s = this._shellRect;

        // 外壳主体
        this._staticGroup.add(new Konva.Rect({
            x: s.x, y: s.y, width: s.w, height: s.h,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: s.w, y: s.h },
            fillLinearGradientColorStops: [
                0,   '#3a3e44',
                0.4, '#484c52',
                0.7, '#3e4248',
                1,   '#2e3238',
            ],
            stroke: '#222428',
            strokeWidth: 2,
            cornerRadius: s.rx,
        }));

        // 外壳高光（左上斜边）
        this._staticGroup.add(new Konva.Rect({
            x: s.x + 2, y: s.y + 2, width: s.w - 4, height: s.h * 0.15,
            fill: 'rgba(255,255,255,0.06)',
            cornerRadius: [s.rx, s.rx, 0, 0],
        }));

        // 状态指示窗（静态背景）
        const ir = this._indicatorRect;
        this._staticGroup.add(new Konva.Rect({
            x: ir.x, y: ir.y, width: ir.w, height: ir.h,
            fill: '#12160e',
            stroke: '#444',
            strokeWidth: 1,
            cornerRadius: ir.rx,
        }));

        // 手柄枢轴底座（凸台）
        const cx = this._handleCX, cy = this._handleCY;
        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: this._pivotR + 4,
            fillLinearGradientStartPoint: { x: -(this._pivotR + 4), y: 0 },
            fillLinearGradientEndPoint:   { x:  (this._pivotR + 4), y: 0 },
            fillLinearGradientColorStops: [
                0,   '#5a5e64',
                0.5, '#7a7e84',
                1,   '#5a5e64',
            ],
            stroke: '#222', strokeWidth: 1,
        }));

        // 铭牌（外壳底部）
        const npW = s.w - 16, npH = Math.max(18, s.h * 0.18);
        this._staticGroup.add(new Konva.Rect({
            x: s.x + 8, y: s.y + s.h - npH - 4,
            width: npW, height: npH,
            fill: '#c8c0a0',
            stroke: '#908878', strokeWidth: 1, cornerRadius: 2,
        }));
        const fs = Math.max(12, this.width * 0.026);
        this._staticGroup.add(new Konva.Text({
            x: s.x + 8 + 2, y: s.y + s.h - npH - 4 ,
            text: `${this.label}`,
            fontSize: fs + 2, fontStyle: 'bold', fill: '#2a2018',
        }));
        this._staticGroup.add(new Konva.Text({
            x: s.x + 8 + 2, y: s.y + s.h - npH - 4 + fs + 3,
            text: `${this.ratedVoltage}V  ${this.ratedCurrent}A`,
            fontSize: fs, fill: '#4a3828',
        }));
    }

    /** 手柄区刻度弧（ON/OFF 范围） */
    _drawScaleArc() {
        const cx  = this._handleCX, cy = this._handleCY;
        const R   = this._scaleArcR;
        const a1  = (this._handleAngles.on-90)  * Math.PI / 180;
        const a2  = (this._handleAngles.off-90) * Math.PI / 180;

        // 绘制弧线（ON 到 OFF）
        const pts = [];
        const steps = 24;
        for (let i = 0; i <= steps; i++) {
            const a = a1 + (a2 - a1) * (i / steps);
            pts.push(cx + R * Math.cos(a), cy + R * Math.sin(a));
        }
        this._staticGroup.add(new Konva.Line({
            points: pts, stroke: '#888', strokeWidth: 1.2,
            lineCap: 'round', lineJoin: 'round', listening: false,
        }));

        // 刻度线与标注
        const marks = [
            { angle: this._handleAngles.on-70,   text: 'ON',   color: '#20c030' },
            { angle: this._handleAngles.trip-90,  text: 'TRIP', color: '#e08020' },
            { angle: this._handleAngles.off-90,  text: 'OFF',  color: '#c03020' },
        ];
        marks.forEach(m => {
            const rad = m.angle * Math.PI / 180;
            this._staticGroup.add(new Konva.Line({
                points: [
                    cx + (R - 4) * Math.cos(rad), cy + (R - 4) * Math.sin(rad),
                    cx + (R + 4) * Math.cos(rad), cy + (R + 4) * Math.sin(rad),
                ],
                stroke: m.color, strokeWidth: 1.5, lineCap: 'round',
            }));
            const lr = R + 16;
            this._staticGroup.add(new Konva.Text({
                x: cx + lr * Math.cos(rad) - 10,
                y: cy + lr * Math.sin(rad) - 7,
                text: m.text,
                fontSize: Math.max(10, this.width * 0.025),
                fontStyle: 'bold',
                fill: m.color,
            }));
        });
    }

    /** 原理图区静态元素：接线柱、导线引出、过电流脱扣器框 */
    _drawSchematicStatic() {
        // 三极对称绘制
        this._poleXs.forEach((px, i) => {
            const poleName = ['L1', 'L2', 'L3'][i];
            const outName  = ['T1', 'T2', 'T3'][i];
            const color    = ['#e03030', '#20a030', '#2050e0'][i];

            // 进线端接线柱
            this._drawTerminalPost({ x: px, y: this._lineInY }, poleName, color);
            // 出线端接线柱
            this._drawTerminalPost({ x: px, y: this._lineOutY }, outName, color);

            // 进线端向上引出到边框
            this._staticGroup.add(new Konva.Line({
                points: [px, this._lineInY - this._termR, px, 2],
                stroke: color, strokeWidth: 2.5,
            }));

            // 出线端向下引出到边框
            this._staticGroup.add(new Konva.Line({
                points: [px, this._lineOutY + this._termR, px, this.height - 2],
                stroke: color, strokeWidth: 2.5,
            }));

            // 进线端接线柱到固定触点竖线
            this._staticGroup.add(new Konva.Line({
                points: [px, this._lineInY + this._termR, px, this._contactInY],
                stroke: color, strokeWidth: 2,
            }));

            // 出线端接线柱到固定触点竖线
            this._staticGroup.add(new Konva.Line({
                points: [px, this._contactOutY, px, this._lineOutY - this._termR],
                stroke: color, strokeWidth: 2,
            }));

            // 固定触点（进线侧，上方静触头横线）
            this._staticGroup.add(new Konva.Line({
                points: [px - 10, this._contactInY, px + 10, this._contactInY],
                stroke: color, strokeWidth: 3, lineCap: 'round',
            }));

            // 固定触点（出线侧，下方静触头横线）
            this._staticGroup.add(new Konva.Line({
                points: [px - 10, this._contactOutY, px + 10, this._contactOutY],
                stroke: color, strokeWidth: 3, lineCap: 'round',
            }));
        });

    }

    /** 绘制单个接线柱（铜色圆柱） */
    _drawTerminalPost(pos, name, color) {
        const R = this._termR;
        const { x, y } = pos;
        const fs = Math.max(12, this.width * 0.025);

        this._staticGroup.add(new Konva.Circle({
            x, y, radius: R,
            fillLinearGradientStartPoint: { x: -R, y: -R },
            fillLinearGradientEndPoint:   { x:  R, y:  R },
            fillLinearGradientColorStops: [
                0,   '#7a6a30',
                0.4, '#d4aa52',
                0.7, '#e8c86a',
                1,   '#8a7030',
            ],
            stroke: '#6a5a28', strokeWidth: 1,
        }));
        this._staticGroup.add(new Konva.Circle({
            x, y, radius: R * 0.38,
            fill: '#2a1a08', stroke: '#5a4a20', strokeWidth: 0.6,
        }));
        this._staticGroup.add(new Konva.Text({
            x: x - 24, y: y-5 ,
            text: name, fontSize: fs, fontStyle: 'bold', fill: color,
        }));
    }

    /** 分励脱扣器线圈（右侧 fla ↔ flb 之间） */
    _drawTripCoil() {
        const W = this.width, H = this.height;
        const rLeft = this._divX + W * 0.03;
        const rW = W - rLeft - W * 0.03;

        // 线圈盒位置（右侧，fla/flb 之间偏左）
        const coilCX = this._portFla.x - 18;
        const coilTop = this._portFla.y + 6;
        const coilBot = this._portFlb.y - 6;
        const coilCY = (coilTop + coilBot) / 2;
        const coilH = coilBot - coilTop;
        const coilW = Math.max(10, rW * 0.10);

        // 线圈盒主体（矩形，代表电磁铁线圈）
        this._staticGroup.add(new Konva.Rect({
            x: coilCX - coilW / 2, y: coilTop,
            width: coilW, height: coilH,
            fill: '#f8f0dc',
            stroke: '#6a5a28', strokeWidth: 1.2,
            cornerRadius: 2,
        }));

        // 线圈内弧线（波浪线表示线圈）
        const arcSteps = 5;
        for (let i = 0; i < arcSteps; i++) {
            const y1 = coilTop + coilH * (i / arcSteps);
            const y2 = coilTop + coilH * ((i + 0.5) / arcSteps);
            const y3 = coilTop + coilH * ((i + 0.95) / arcSteps);
            const bulge = (i % 2 === 0) ? -coilW * 0.25 : coilW * 0.25;
            this._staticGroup.add(new Konva.Line({
                points: [
                    coilCX - coilW * 0.30, y1,
                    coilCX + bulge, y2,
                    coilCX + coilW * 0.30, y3,
                ],
                stroke: '#4a3828', strokeWidth: 1, tension: 0.4,
                listening: false,
            }));
        }

        // 引线：线圈 → fla 端口
        this._staticGroup.add(new Konva.Line({
            points: [coilCX, coilTop, this._portFla.x, this._portFla.y],
            stroke: '#6a5a28', strokeWidth: 1.5, listening: false,
        }));
        // 引线：线圈 → flb 端口
        this._staticGroup.add(new Konva.Line({
            points: [coilCX, coilBot, this._portFlb.x, this._portFlb.y],
            stroke: '#6a5a28', strokeWidth: 1.5, listening: false,
        }));

        // 文字标注
        this._staticGroup.add(new Konva.Text({
            x: coilCX - coilW / 2 - 28, y: coilCY - 6,
            text: 'ST', fontSize: Math.max(10, W * 0.024),
            fontStyle: 'bold', fill: '#6a3828',
        }));
    }

    /** 位号铭牌 */
    _drawLabel() {
        // 左上角位号
        this._staticGroup.add(new Konva.Text({
            x: this._shellRect.x + 4, y: this._shellRect.y + 4,
            text: this.label,
            fontSize: Math.max(11, this.width * 0.028),
            fontStyle: 'bold',
            fill: '#d4d8dc',
        }));
    }

    /** Test 按钮（静态外观） */
    _drawTestButton() {
        const b = this._testBtn;
        this._staticGroup.add(new Konva.Rect({
            x: b.x, y: b.y, width: b.w, height: b.h,
            fill: '#4a4e54',
            stroke: '#e8a030',
            strokeWidth: 1.5,
            cornerRadius: b.rx,
        }));
        this._staticGroup.add(new Konva.Text({
            x: b.x, y: b.y,
            width: b.w, height: b.h,
            text: 'TEST',
            fontSize: Math.max(9, this.width * 0.024),
            fontStyle: 'bold',
            fill: '#e8a030',
            align: 'center',
            verticalAlign: 'middle',
        }));
    }

    // ═══════════════════════════════════════════
    // 动态层（一次性创建，每帧 in-place 更新）
    // ═══════════════════════════════════════════

    _createDynamicNodes() {
        this._createHandleGroup();
        this._createBridgeGroups();
        this._createIndicatorText();
    }

    /** 操作手柄组（绕枢轴旋转） */
    _createHandleGroup() {
        const cx = this._handleCX, cy = this._handleCY;
        const L  = this._handleLen;
        const bW = this._handleW;

        this._handleGroup = new Konva.Group({
            x: cx, y: cy,
            rotation: this._curHandleAng,
        });

        // 手柄杆主体
        this._handleGroup.add(new Konva.Rect({
            x: -bW / 2, y: -this._pivotR * 0.6,
            width: bW, height: -(L - this._pivotR * 0.6),
            fillLinearGradientStartPoint: { x: -bW / 2, y: 0 },
            fillLinearGradientEndPoint:   { x:  bW / 2, y: 0 },
            fillLinearGradientColorStops: [
                0,   '#c0c4c8',
                0.3, '#f0f2f4',
                0.6, '#d8dadc',
                1,   '#b0b4b8',
            ],
            stroke: '#808488', strokeWidth: 1,
            cornerRadius: [0, 0, 3, 3],
        }));

        // 手柄顶端圆弧（握手部分）
        this._handleGroup.add(new Konva.Ellipse({
            x: 0, y: -(L - this._pivotR * 0.6),
            radiusX: bW * 0.7,
            radiusY: bW * 0.9,
            fill: '#d8dadc',
            stroke: '#909498', strokeWidth: 1,
        }));

        // 手柄中间装饰槽
        this._handleGroup.add(new Konva.Rect({
            x: -bW * 0.20, y: -this._pivotR * 0.6 - L * 0.55,
            width: bW * 0.40, height: L * 0.40,
            fill: 'rgba(0,0,0,0.18)',
            cornerRadius: 2,
        }));

        // 枢轴帽
        this._handleGroup.add(new Konva.Circle({
            x: 0, y: 0, radius: this._pivotR * 0.60,
            fillLinearGradientStartPoint: { x: -this._pivotR, y: -this._pivotR },
            fillLinearGradientEndPoint:   { x:  this._pivotR, y:  this._pivotR },
            fillLinearGradientColorStops: [
                0,   '#d8dce0',
                0.5, '#f0f2f4',
                1,   '#b0b4b8',
            ],
            stroke: '#808488', strokeWidth: 0.8,
        }));

        this._dynamicGroup.add(this._handleGroup);
    }

    /** 三极触桥组（同步上下位移） */
    _createBridgeGroups() {
        this._bridgeGroups = this._poleXs.map((px, i) => {
            const color = ['#e03030', '#20a030', '#2050e0'][i];
            const bridgeCY = (this._contactInY + this._contactOutY) / 2 + this._bridgeOffset;

            const g = new Konva.Group({ x: px, y: bridgeCY });

            // 触桥主体（铜色矩形）
            g.add(new Konva.Rect({
                x: -this._bridgeW / 2, y: -this._bridgeH / 2,
                width: this._bridgeW, height: this._bridgeH,
                fillLinearGradientStartPoint: { x: -this._bridgeW / 2, y: 0 },
                fillLinearGradientEndPoint:   { x:  this._bridgeW / 2, y: 0 },
                fillLinearGradientColorStops: [
                    0,   '#8a7030',
                    0.3, '#d4a848',
                    0.6, '#f0c860',
                    0.8, '#c8a040',
                    1,   '#8a7030',
                ],
                stroke: '#7a6028', strokeWidth: 0.8,
                cornerRadius: 3,
            }));

            // 触桥高光
            g.add(new Konva.Rect({
                x: -this._bridgeW / 2 + 2, y: -this._bridgeH / 2 + 2,
                width: this._bridgeW - 4, height: this._bridgeH * 0.25,
                fill: 'rgba(255,255,255,0.22)',
                cornerRadius: [2, 2, 0, 0],
            }));

            // 触点接触端（上下各一个银点）
            [-1, 1].forEach(side => {
                g.add(new Konva.Circle({
                    x: 0, y: side * this._bridgeH / 2,
                    radius: this._contactR,
                    fill: '#e8e8e8',
                    stroke: '#a0a0a0', strokeWidth: 0.8,
                }));
            });

            // 极色标记线
            g.add(new Konva.Line({
                points: [-this._bridgeW / 2 + 2, 0, this._bridgeW / 2 - 2, 0],
                stroke: color, strokeWidth: 1.5, opacity: 0.6,
            }));

            this._dynamicGroup.add(g);
            return g;
        });

        // 合闸状态触点高光（每极上下各一个）
        this._contactGlows = this._poleXs.map((px, i) => {
            const glows = [];
            [this._contactInY, this._contactOutY].forEach(cy => {
                const g = new Konva.Circle({
                    x: px, y: cy,
                    radius: this._contactR * 1.8,
                    fill: 'rgba(80,220,80,0.32)',
                    visible: this._state === 'on',
                    listening: false,
                });
                this._dynamicGroup.add(g);
                glows.push(g);
            });
            return glows;
        });
    }

    /** 状态指示文字（动态颜色与内容） */
    _createIndicatorText() {
        const ir = this._indicatorRect;
        const cfg = this._getIndicatorCfg();

        this._indicatorBg = new Konva.Rect({
            x: ir.x + 1, y: ir.y + 1,
            width: ir.w - 2, height: ir.h - 2,
            fill: cfg.bg, cornerRadius: ir.rx - 1,
        });

        this._indicatorText = new Konva.Text({
            x: ir.x, y: ir.y,
            width: ir.w, height: ir.h,
            text: cfg.text,
            fontSize: Math.max(11, this.width * 0.032),
            fontStyle: 'bold',
            fill: cfg.color,
            align: 'center',
            verticalAlign: 'middle',
            listening: false,
        });

        this._dynamicGroup.add(this._indicatorBg);
        this._dynamicGroup.add(this._indicatorText);
    }

    _getIndicatorCfg() {
        switch (this._state) {
            case 'on':   return { text: '● ON',   color: '#30ef50', bg: '#0a2010' };
            case 'trip': return { text: '⚡ TRIP', color: '#ffb030', bg: '#201000' };
            default:     return { text: '○ OFF',  color: '#888898', bg: '#101014' };
        }
    }

    // ═══════════════════════════════════════════
    // 动态更新（每帧 in-place）
    // ═══════════════════════════════════════════

    _updateDynamic() {
        // 1) 手柄旋转
        this._handleGroup.rotation(this._curHandleAng);

        // 2) 触桥位移（三极同步）
        const bridgeCenterY = (this._contactInY + this._contactOutY) / 2;
        this._bridgeGroups.forEach(g => {
            g.y(bridgeCenterY + this._bridgeOffset);
        });

        // 3) 触点高光：仅合闸状态显示
        const closed = !this._animating && this._state === 'on';
        this._contactGlows.forEach(glows => {
            glows.forEach(g => g.visible(closed));
        });

        // 4) 状态指示窗更新
        if (!this._animating || this._animJustEnded) {
            const cfg = this._getIndicatorCfg();
            this._indicatorBg.fill(cfg.bg);
            this._indicatorText.text(cfg.text);
            this._indicatorText.fill(cfg.color);
        }

    }

    // ═══════════════════════════════════════════
    // 交互绑定
    // ═══════════════════════════════════════════

    _bindInteraction() {
        const cx = this._handleCX, cy = this._handleCY;
        const hitR = this._handleLen + 10;

        const hitArea = new Konva.Rect({
            x: this._shellRect.x,
            y: this._shellRect.y,
            width: this._shellRect.w,
            height: this._shellRect.h - 30,  // 避免覆盖铭牌区
            fill: 'transparent',
        });

        hitArea.on('click tap', (e) => {
            if (this._animating) return;
            const stage = this.group.getStage();
            if (!stage) return;
            const pointer = stage.getPointerPosition();
            if (!pointer) return;

            const tr = this.group.getTransform().copy();
            tr.invert();
            const local = tr.point(pointer);

            // 点击位置相对于手柄枢轴的方向决定操作意图
            const dy = local.y - cy;
            // 点击上半（dy < 0）→ 合闸意图；点击下半 → 分闸意图
            if (this._state === 'off') {
                this.close();
            } else if (this._state === 'on') {
                this.open();
            } else if (this._state === 'trip') {
                // TRIP 状态：先手动复位到 OFF
                this._resetToOff();
            }
        });

        hitArea.on('mouseenter', () => { document.body.style.cursor = 'pointer'; });
        hitArea.on('mouseleave', () => { document.body.style.cursor = 'default'; });

        this._interactGroup.add(hitArea);

        // ── Test 按钮（有电压才可脱扣） ──
        const tb = this._testBtn;
        this.addClickablePart('test-btn', tb.x, tb.y, tb.w, tb.h);
        const testHit = new Konva.Rect({
            x: tb.x, y: tb.y, width: tb.w, height: tb.h,
            fill: 'transparent',
        });
        testHit.on('click tap', () => {
            if (this._animating) return;
            if (this._state !== 'on') return;
            const pv = this._phaseVoltages;
            const hasV = pv && (Math.abs(pv.l1 || 0) > 10 || Math.abs(pv.l2 || 0) > 10 || Math.abs(pv.l3 || 0) > 10);
            if (hasV) this.trip();
        });
        testHit.on('mouseenter', () => { document.body.style.cursor = 'pointer'; });
        testHit.on('mouseleave', () => { document.body.style.cursor = 'default'; });
        this._interactGroup.add(testHit);
    }

    // ═══════════════════════════════════════════
    // tick（20fps）
    // ═══════════════════════════════════════════

    tick(dt) {
        this._tickAnimation(dt);
        this._updateRMS();
        this._checkOvercurrentTrip();

        if (this._animating || this._animJustEnded) {
            this._animJustEnded = false;
            this._updateDynamic();
            this.markDirty();
        }
        this._refreshIfDirty();
    }

    /** 动画插值 */
    _tickAnimation(dt) {
        if (!this._animating) return;

        this._animT += dt / this._animDur;
        if (this._animT >= 1) {
            this._animT         = 1;
            this._animating     = false;
            this._animJustEnded = true;
            this._curHandleAng  = this._animToAng;
            this._bridgeOffset  = this._bridgeOffsetTo;
        }

        const ease = 0.5 - 0.5 * Math.cos(this._animT * Math.PI);
        this._curHandleAng = this._animFromAng + (this._animToAng - this._animFromAng) * ease;
        this._bridgeOffset = this._bridgeOffsetFrom + (this._bridgeOffsetTo - this._bridgeOffsetFrom) * ease;
    }

    /** 三相电流 RMS 更新（40 点滑动窗口） */
    _updateRMS() {
        const pc = this.phaseCurrents;
        if (!pc) return;
        const inst = [pc.l1 || 0, pc.l2 || 0, pc.l3 || 0];
        for (let i = 0; i < 3; i++) {
            const i2 = inst[i] * inst[i];
            const old = this._iBuf[i][this._iBufIdx];
            this._iBuf[i][this._iBufIdx] = i2;
            this._iBufSum[i] = this._iBufSum[i] - old + i2;
        }
        this._iBufIdx = (this._iBufIdx + 1) % 40;
        if (this._iBufCount < 40) this._iBufCount++;
        if (this._iBufCount >= 40) {
            for (let i = 0; i < 3; i++) {
                this._iRms[i] = Math.sqrt(this._iBufSum[i] / 40);
            }
        }
    }

    /** 过流脱扣检测：RMS 超过 tripCurrent×ratedCurrent 时跳闸 */
    _checkOvercurrentTrip() {
        if (this._state !== 'on') return;
        if (this._iBufCount < 40) return;
        const threshold = this.tripCurrent * this.ratedCurrent;
        for (let i = 0; i < 3; i++) {
            if (this._iRms[i] > threshold) {
                this.trip();
                return;
            }
        }
    }

    // ═══════════════════════════════════════════
    // 内部状态切换辅助
    // ═══════════════════════════════════════════

    _startAnim(toState) {
        this._animFromAng      = this._curHandleAng;
        this._animToAng        = this._handleAngles[toState];
        this._bridgeOffsetFrom = this._bridgeOffset;
        this._bridgeOffsetTo   = toState === 'on'
            ? 0
            : -(this._contactOutY - this._contactInY) * (toState === 'trip' ? 0.28 : 0.35);
        this._animT   = 0;
        this._animating = true;
        this._state   = toState;
        this.opsCount++;
    }

    _resetToOff() {
        // TRIP → OFF（手动复位，较慢动作）
        this._animDur = 0.15;
        this._startAnim('off');
    }

    // ═══════════════════════════════════════════
    // 公开 API
    // ═══════════════════════════════════════════

    /** 合闸（OFF → ON） */
    close() {
        if (this._animating || this._state !== 'off') return;
        this._animDur = this.config.animDur || 0.10;
        this._startAnim('on');
    }

    /** 分闸（ON → OFF） */
    open() {
        if (this._animating || this._state !== 'on') return;
        this._animDur = this.config.animDur || 0.10;
        this._startAnim('off');
    }

    /** 脱扣跳闸（任意状态 → TRIP，瞬时，电弧） */
    trip() {
        if (this._state === 'trip') return;
        this._animDur = 0.06;
        this._startAnim('trip');
    }

    /** 查询状态 */
    getState()     { return this._state; }
    isClosed()     { return this._state === 'on'; }
    isTripped()    { return this._state === 'trip'; }
    isAnimating()  { return this._animating; }
    getOpsCount()  { return this.opsCount; }

    /** 外部状态驱动（供仿真引擎调用） */
    update(state) {
        const s = String(state).toLowerCase();
        if (s === 'on'   || s === '1') this.close();
        if (s === 'off'  || s === '0') this.open();
        if (s === 'trip')              this.trip();
    }

    getConfigFields() {
        return [
            { label: '位号/名称',          key: 'label',        type: 'text'   },
            { label: '额定电压 (V)',        key: 'ratedVoltage', type: 'number' },
            { label: '额定电流 (A)',        key: 'ratedCurrent', type: 'number' },
            { label: '脱扣倍数 (×In)',      key: 'tripCurrent',  type: 'number' },
            { label: '初始状态 on/off/trip',key: 'initState',    type: 'text'   },
            { label: '动作时间 (s)',         key: 'animDur',      type: 'number' },
            { label: '分励线圈电阻 (Ω)',     key: 'tripCoilR',    type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label        !== undefined) this.label        = cfg.label;
        if (cfg.ratedVoltage !== undefined) this.ratedVoltage = parseFloat(cfg.ratedVoltage);
        if (cfg.ratedCurrent !== undefined) this.ratedCurrent = parseFloat(cfg.ratedCurrent);
        if (cfg.tripCurrent  !== undefined) this.tripCurrent  = parseFloat(cfg.tripCurrent);
        if (cfg.animDur      !== undefined) this._animDur     = parseFloat(cfg.animDur);
        if (cfg.tripCoilR    !== undefined) this._tripCoilR   = parseFloat(cfg.tripCoilR);

        if (cfg.initState !== undefined) {
            const want = cfg.initState.toLowerCase();
            if (['on', 'off', 'trip'].includes(want) && want !== this._state) {
                this.update(want);
            }
        }

        this.config = { ...this.config, ...cfg };
        this._recalcGeometry();
        this._staticGroup.destroyChildren();
        this._dynamicGroup.destroyChildren();
        this._drawStaticParts();
        this._createDynamicNodes();
        this._refreshCache();
    }

    destroy() {
        super.destroy?.();
    }
}
