import { BaseComponent } from './BaseComponent.js';

/**
 * 三相塑壳断路器（MCCB）仿真组件 — 塑壳式 MCCB 外观版本
 *
 * ═══ 与 ThreePhaseACB 的区别 ═══════════════════════════════
 *  仅左侧面板视觉不同：
 *    - 白色工程塑料壳体（非深色）
 *    - 蓝色水平操作手柄条（非旋转杠杆）
 *    - 接线端子螺丝装饰
 *  右半区电路原理图、端口、电气行为完全一致
 *
 * ── 结构说明 ──────────────────────────────────────────────────
 *
 *  左半区：塑壳断路器面板（物理操作侧）
 *    - 白色壳体：仿塑壳式工程塑料外壳
 *    - 蓝色操作手柄（MCCB 手柄）：水平条形把手，垂直平移，三个状态：
 *        ON（合闸）  → 手柄推至上方
 *        OFF（分闸） → 手柄推至下方
 *        TRIP（跳闸）→ 手柄弹至中间位置
 *    - 状态指示窗：显示 ON / OFF / TRIP 文字
 *    - 接线端子螺丝装饰（顶部/底部各三颗）
 *
 *  右半区：电路原理图区（IEC 60617 图形符号）
 *    - 三极主触头（L1/L2/L3 ↔ T1/T2/T3）：上进线端、下出线端
 *    - 三个可动触桥：模拟三极同步开合动作
 *    - 合闸时绿色触点高光，分闸/跳闸时灰色
 *
 * ── 断路器状态机 ───────────────────────────────────────────
 *
 *  ON   → 点击手柄或调用 open()  → OFF
 *  OFF  → 点击手柄或调用 close() → ON
 *  TRIP → 只能先拨到 OFF（复位），再拨到 ON（合闸）
 *  任意状态 → 调用 trip()  → TRIP（瞬时）
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
 */
export class ThreePhaseACB2 extends BaseComponent {
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

        // ── 左侧 MCCB 面板几何 ──────────────────────────
        const panelPad = 8;
        this._shellRect = {
            x: panelPad,
            y: panelPad,
            w: this._divX - panelPad * 2,
            h: H - panelPad * 2,
            rx: 4,
        };

        // MCCB 蓝色手柄中心（面板中央）
        this._handleCX = this._shellRect.x + this._shellRect.w * 0.50;
        this._handleCY = H * 0.52;

        // MCCB 手柄垂直偏移（水平条形把手，上下平移，不旋转）
        // ON  → 手柄推向上方
        // OFF → 手柄推至下方
        // TRIP→ 手柄弹至中间
        this._handleOffsets = {
            on:   -H * 0.24,   // 向上移动（合闸）
            off:   H * 0.14,   // 向下移动（分闸）
            trip:  0,          // 居中（跳闸弹出）
        };

        // MCCB 手柄尺寸（水平条形）
        this._handleBarW = this._shellRect.w * 0.72;
        this._handleBarH = Math.max(15, H * 0.075 * 1.5);

        // ── 右侧电路原理图区几何（与 ThreePhaseACB 完全一致）──
        const rLeft = this._divX + W * 0.03;
        const rW    = W - rLeft - W * 0.03;

        const poles = 3;
        this._poleXs = Array.from({ length: poles }, (_, i) =>
            rLeft + rW * (i + 0.36) / poles
        );

        this._lineInY  = H * 0.18;
        this._lineOutY = H * 0.82;

        this._contactInY  = H * 0.33;
        this._contactOutY = H * 0.67;

        this._contactR    = Math.max(5, W * 0.020);

        this._bridgeW = Math.max(8, rW / poles * 0.35);
        this._bridgeH = (this._contactOutY - this._contactInY) * 0.55;

        this._tripBoxY = this._contactOutY + 6;
        this._tripBoxH = H * 0.10;

        this._termR = Math.max(4, W * 0.018);

        // 端口（组件外部引线）
        this._portL = this._poleXs.map(px => ({ x: px, y: 2 }));
        this._portT = this._poleXs.map(px => ({ x: px, y: H - 2 }));
        // 分励脱扣器端口（右边）
        this._portFla = { x: W - 2, y: H * 0.32 };
        this._portFlb = { x: W - 2, y: H * 0.68 };

        // Test 按钮（左壳体底部，铭牌区上方）
        this._testBtn = {
            x: this._shellRect.x + 4,
            y: this._shellRect.y + this._shellRect.h - 32,
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
        this.function     = config.function     || '三相塑壳断路器';

        // 状态：'on' | 'off' | 'trip'
        const initState = (config.initState || 'off').toLowerCase();
        this._state       = ['on', 'off', 'trip'].includes(initState) ? initState : 'off';
        this._prevState   = this._state;

        // 动画
        this._animating   = false;
        this._animT       = 0;
        this._animFromY   = this._handleOffsets[this._state];
        this._animToY     = this._handleOffsets[this._state];
        this._curHandleY  = this._handleOffsets[this._state];

        // 触桥偏移（合闸=0，分闸/跳闸=负值上移）
        this._bridgeOffset    = this._state === 'on' ? 0 : -(this._contactOutY - this._contactInY) * 0.35;
        this._bridgeOffsetTo  = this._bridgeOffset;
        this._bridgeOffsetFrom = this._bridgeOffset;

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
        this._drawLeftBody();
        this._drawStateLabels();
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

    /** MCCB 白色壳体（塑壳式断路器外观） */
    _drawLeftBody() {
        const s = this._shellRect;

        // 白色壳体主体
        this._staticGroup.add(new Konva.Rect({
            x: s.x, y: s.y, width: s.w, height: s.h,
            fill: '#f0f1f4',
            stroke: '#a0a8b8',
            strokeWidth: 1.5,
            cornerRadius: s.rx,
        }));

        // 壳体顶部高光
        this._staticGroup.add(new Konva.Rect({
            x: s.x + 2, y: s.y + 2, width: s.w - 4, height: s.h * 0.06,
            fill: 'rgba(255,255,255,0.5)',
            cornerRadius: [s.rx, s.rx, 0, 0],
        }));

        // 中心旋转轴（小圆点）
        const cx = this._handleCX, cy = this._handleCY;
        this._staticGroup.add(new Konva.Circle({
            x: cx+5, y: cy, radius: 4,
            fill: '#888',
            stroke: '#666',
            strokeWidth: 1,
        }));

        // 中心旋转轴到手柄的虚线（水平）
        this._staticGroup.add(new Konva.Line({
            points: [cx, cy, cx - this._handleBarW * 0.38, cy],
            stroke: '#888',
            strokeWidth: 1,
            dash: [3, 3],
        }));

        // 旋转轴（TRIP 位置，与手柄等长，靠右）
        const axisOffset = s.w * 0.08;
        const axisHalfW = this._handleBarW / 2;
        this._staticGroup.add(new Konva.Line({
            points: [cx + axisOffset - axisHalfW+5, cy, cx + axisOffset + axisHalfW-5, cy],
            stroke: '#777',
            strokeWidth: 2,
        }));

        // 顶部接线端子螺丝装饰（L1/L2/L3 位置）
        const topY = s.y + 8;
        const termGap = s.w / 4;
        for (let i = 0; i < 3; i++) {
            const tx = s.x + termGap * (i + 1);
            this._drawMCCBScrew(tx, topY);
        }

        // 底部接线端子螺丝装饰（T1/T2/T3 位置）
        const botY = s.y + s.h - 8;
        for (let i = 0; i < 3; i++) {
            const tx = s.x + termGap * (i + 1);
            this._drawMCCBScrew(tx, botY);
        }
    }

    /** MCCB 接线端子螺丝（铜色十字螺丝） */
    _drawMCCBScrew(x, y) {
        const r = Math.max(3.5, this.width * 0.012);
        // 螺丝外圈
        this._staticGroup.add(new Konva.Circle({
            x, y, radius: r,
            fillLinearGradientStartPoint: { x: -r, y: -r },
            fillLinearGradientEndPoint:   { x:  r, y:  r },
            fillLinearGradientColorStops: [
                0,   '#8a7a30',
                0.4, '#c8a848',
                0.7, '#d8b858',
                1,   '#7a6a28',
            ],
            stroke: '#5a4a18', strokeWidth: 0.6,
        }));
        // 螺丝十字槽
        this._staticGroup.add(new Konva.Line({
            points: [x - r * 0.55, y, x + r * 0.55, y],
            stroke: '#3a2a08', strokeWidth: 0.8,
        }));
        this._staticGroup.add(new Konva.Line({
            points: [x, y - r * 0.55, x, y + r * 0.55],
            stroke: '#3a2a08', strokeWidth: 0.8,
        }));
    }

    /** 状态标签（ON/OFF/TRIP 垂直排列，左侧） */
    _drawStateLabels() {
        const cx = this._handleCX, cy = this._handleCY;
        const offset = this._handleOffsets;
        const lblX = this._shellRect.x + 2;

        const marks = [
            { y: cy + offset.on,   text: 'ON',   color: '#20a030' },
            { y: cy + offset.trip, text: 'TRIP', color: '#e08020' },
            { y: cy + offset.off,  text: 'OFF',  color: '#c03020' },
        ];
        const fs = Math.max(10, this.width * 0.025);
        marks.forEach(m => {
            this._staticGroup.add(new Konva.Text({
                x: lblX,
                y: m.y - 6,
                text: m.text,
                fontSize: fs,
                fontStyle: 'bold',
                fill: m.color,
            }));
        });
    }

    /** 原理图区静态元素（与 ThreePhaseACB 完全一致） */
    _drawSchematicStatic() {
        this._poleXs.forEach((px, i) => {
            const poleName = ['L1', 'L2', 'L3'][i];
            const outName  = ['T1', 'T2', 'T3'][i];
            const color    = ['#e03030', '#20a030', '#2050e0'][i];

            this._drawTerminalPost({ x: px, y: this._lineInY }, poleName, color);
            this._drawTerminalPost({ x: px, y: this._lineOutY }, outName, color);

            this._staticGroup.add(new Konva.Line({
                points: [px, this._lineInY - this._termR, px, 2],
                stroke: color, strokeWidth: 2.5,
            }));
            this._staticGroup.add(new Konva.Line({
                points: [px, this._lineOutY + this._termR, px, this.height - 2],
                stroke: color, strokeWidth: 2.5,
            }));
            this._staticGroup.add(new Konva.Line({
                points: [px, this._lineInY + this._termR, px, this._contactInY],
                stroke: color, strokeWidth: 2,
            }));
            this._staticGroup.add(new Konva.Line({
                points: [px, this._contactOutY, px, this._lineOutY - this._termR],
                stroke: color, strokeWidth: 2,
            }));

            this._staticGroup.add(new Konva.Line({
                points: [px - 10, this._contactInY, px + 10, this._contactInY],
                stroke: color, strokeWidth: 3, lineCap: 'round',
            }));
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
            x: x - 24, y: y - 5,
            text: name, fontSize: fs, fontStyle: 'bold', fill: color,
        }));
    }

    /** 分励脱扣器线圈（右侧 fla ↔ flb 之间） */
    _drawTripCoil() {
        const W = this.width, H = this.height;
        const rLeft = this._divX + W * 0.03;
        const rW = W - rLeft - W * 0.03;

        const coilCX = this._portFla.x - 18;
        const coilTop = this._portFla.y + 6;
        const coilBot = this._portFlb.y - 6;
        const coilCY = (coilTop + coilBot) / 2;
        const coilH = coilBot - coilTop;
        const coilW = Math.max(10, rW * 0.10);

        this._staticGroup.add(new Konva.Rect({
            x: coilCX - coilW / 2, y: coilTop,
            width: coilW, height: coilH,
            fill: '#f8f0dc',
            stroke: '#6a5a28', strokeWidth: 1.2,
            cornerRadius: 2,
        }));

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

        this._staticGroup.add(new Konva.Line({
            points: [coilCX, coilTop, this._portFla.x, this._portFla.y],
            stroke: '#6a5a28', strokeWidth: 1.5, listening: false,
        }));
        this._staticGroup.add(new Konva.Line({
            points: [coilCX, coilBot, this._portFlb.x, this._portFlb.y],
            stroke: '#6a5a28', strokeWidth: 1.5, listening: false,
        }));

    }

    /** 位号铭牌 */
    _drawLabel() {
        this._staticGroup.add(new Konva.Text({
            x: this._shellRect.x + 4, y: this._shellRect.y + 4,
            text: this.label,
            fontSize: Math.max(11, this.width * 0.028),
            fontStyle: 'bold',
            fill: '#3a3e44',
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
        this._createMCCBHandle();
        this._createLinkage();
        this._createBridgeGroups();
    }

    /** MCCB 蓝色操作手柄（水平条形，上下平移，不旋转） */
    _createMCCBHandle() {
        const cx = this._handleCX, cy = this._handleCY;
        const bw = this._handleBarW;
        const bh = this._handleBarH;

        this._handleGroup = new Konva.Group({
            x: cx, y: cy + this._curHandleY,
        });

        // 蓝色手柄条主体
        this._handleGroup.add(new Konva.Rect({
            x: -bw / 2, y: -bh / 2,
            width: bw, height: bh,
            fillLinearGradientStartPoint: { x: 0, y: -bh / 2 },
            fillLinearGradientEndPoint:   { x: 0, y:  bh / 2 },
            fillLinearGradientColorStops: [
                0,   '#3890e0',
                0.3, '#2878c8',
                0.7, '#1a60a8',
                1,   '#1848a0',
            ],
            stroke: '#1040a0', strokeWidth: 1,
            cornerRadius: 4,
        }));

        // 手柄高光条（顶部白色半透明）
        this._handleGroup.add(new Konva.Rect({
            x: -bw / 2 + 3, y: -bh / 2 + 1,
            width: bw - 6, height: bh * 0.25,
            fill: 'rgba(255,255,255,0.30)',
            cornerRadius: [3, 3, 0, 0],
        }));

        // 手柄中央凸起（握持区域）
        this._handleGroup.add(new Konva.Rect({
            x: -bw * 0.12, y: -bh * 0.45,
            width: bw * 0.24, height: bh * 0.9,
            fillLinearGradientStartPoint: { x: 0, y: -bh * 0.45 },
            fillLinearGradientEndPoint:   { x: 0, y:  bh * 0.45 },
            fillLinearGradientColorStops: [
                0,   '#4a98e8',
                0.5, '#2a70b8',
                1,   '#1a5898',
            ],
            stroke: '#1040a0', strokeWidth: 0.6,
            cornerRadius: 3,
        }));

        this._dynamicGroup.add(this._handleGroup);
    }

    /** 四边形连杆（旋转轴 ↔ 手柄之间的动态连杆） */
    _createLinkage() {
        const cx = this._handleCX, cy = this._handleCY;
        const bw = this._handleBarW-10;
        const s = this._shellRect;
        const axisOffset = s.w * 0.08;
        const axisHalfW = bw / 2;

        // 旋转轴两端点（固定，与手柄等长，靠右）
        this._axisLeftX  = cx + axisOffset - axisHalfW;
        this._axisRightX = cx + axisOffset + axisHalfW;
        this._axisY = cy;

        // 四边形（初始位置）
        this._linkage = new Konva.Line({
            points: this._calcLinkagePoints(),
            fill: 'rgba(10, 10, 154, 0.18)',
            stroke: '#8890a0',
            strokeWidth: 1,
            closed: true,
            listening: false,
        });
        this._dynamicGroup.add(this._linkage);
    }

    /** 计算四边形四个顶点 */
    _calcLinkagePoints() {
        const cx = this._handleCX;
        const bw = this._handleBarW * 0.48;
        const handleY = this._handleCY + this._curHandleY;

        return [
            this._axisLeftX,  this._axisY,      // 旋转轴左
            cx - bw,          handleY,           // 手柄左
            cx + bw,          handleY,           // 手柄右
            this._axisRightX, this._axisY,      // 旋转轴右
        ];
    }

    /** 三极触桥组（同步上下位移，与 ThreePhaseACB 完全一致） */
    _createBridgeGroups() {
        this._bridgeGroups = this._poleXs.map((px, i) => {
            const color = ['#e03030', '#20a030', '#2050e0'][i];
            const bridgeCY = (this._contactInY + this._contactOutY) / 2 + this._bridgeOffset;

            const g = new Konva.Group({ x: px, y: bridgeCY });

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

            g.add(new Konva.Rect({
                x: -this._bridgeW / 2 + 2, y: -this._bridgeH / 2 + 2,
                width: this._bridgeW - 4, height: this._bridgeH * 0.25,
                fill: 'rgba(255,255,255,0.22)',
                cornerRadius: [2, 2, 0, 0],
            }));

            [-1, 1].forEach(side => {
                g.add(new Konva.Circle({
                    x: 0, y: side * this._bridgeH / 2,
                    radius: this._contactR,
                    fill: '#e8e8e8',
                    stroke: '#a0a0a0', strokeWidth: 0.8,
                }));
            });

            g.add(new Konva.Line({
                points: [-this._bridgeW / 2 + 2, 0, this._bridgeW / 2 - 2, 0],
                stroke: color, strokeWidth: 1.5, opacity: 0.6,
            }));

            this._dynamicGroup.add(g);
            return g;
        });

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

    // ═══════════════════════════════════════════
    // 动态更新（每帧 in-place）
    // ═══════════════════════════════════════════

    _updateDynamic() {
        // 1) MCCB 手柄垂直位移（不旋转）
        this._handleGroup.y(this._handleCY + this._curHandleY);

        // 2) 四边形连杆更新
        this._linkage.points(this._calcLinkagePoints());

        // 3) 触桥位移（三极同步）
        const bridgeCenterY = (this._contactInY + this._contactOutY) / 2;
        this._bridgeGroups.forEach(g => {
            g.y(bridgeCenterY + this._bridgeOffset);
        });

        // 4) 触点高光：仅合闸状态显示
        const closed = !this._animating && this._state === 'on';
        this._contactGlows.forEach(glows => {
            glows.forEach(g => g.visible(closed));
        });
    }

    // ═══════════════════════════════════════════
    // 交互绑定
    // ═══════════════════════════════════════════

    _bindInteraction() {
        const cx = this._handleCX, cy = this._handleCY;

        const hitArea = new Konva.Rect({
            x: this._shellRect.x,
            y: this._shellRect.y,
            width: this._shellRect.w,
            height: this._shellRect.h - 40,  // 避免覆盖铭牌区
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

            const dy = local.y - cy;
            if (this._state === 'off') {
                this.close();
            } else if (this._state === 'on') {
                this.open();
            } else if (this._state === 'trip') {
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
            this._curHandleY    = this._animToY;
            this._bridgeOffset  = this._bridgeOffsetTo;
        }

        const ease = 0.5 - 0.5 * Math.cos(this._animT * Math.PI);
        this._curHandleY  = this._animFromY + (this._animToY - this._animFromY) * ease;
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

    /** 过流脱扣检测 */
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
        this._animFromY       = this._curHandleY;
        this._animToY         = this._handleOffsets[toState];
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
        this._animDur = 0.15;
        this._startAnim('off');
    }

    // ═══════════════════════════════════════════
    // 公开 API
    // ═══════════════════════════════════════════

    close() {
        if (this._animating || this._state !== 'off') return;
        this._animDur = this.config.animDur || 0.10;
        this._startAnim('on');
    }

    open() {
        if (this._animating || this._state !== 'on') return;
        this._animDur = this.config.animDur || 0.10;
        this._startAnim('off');
    }

    trip() {
        if (this._state === 'trip') return;
        this._animDur = 0.06;
        this._startAnim('trip');
    }

    getState()     { return this._state; }
    isClosed()     { return this._state === 'on'; }
    isTripped()    { return this._state === 'trip'; }
    isAnimating()  { return this._animating; }
    getOpsCount()  { return this.opsCount; }

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
