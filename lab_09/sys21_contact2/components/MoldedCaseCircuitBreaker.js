import { BaseComponent } from './BaseComponent.js';

/**
 * 塑壳式断路器（Molded Case Circuit Breaker, MCCB）仿真组件
 *
 * ═══ 界面构成 ═══════════════════════════════════════════════════
 *  左半区：塑壳式断路器外观（参照 DistributionBox 中的单个塑壳开关）
 *    - 白色工程塑料壳体、顶部高光、侧边厚度
 *    - 中央竖滑槽 + 蓝色长方体操作手柄（可手推/手拉，槽内上下滑动）
 *    - 槽侧 ON / TRIP / OFF 状态标记
 *    - 上下各 3 颗接线端子螺丝
 *
 *  右半区：断路器内部结构（纯二维原理结构图，随动作产生动画）
 *    - 三极主触头（可动触头绕传动轴旋转开合）
 *    - 传动轴（连接三极可动触头，并连至操作手柄）
 *    - 操作手柄（杠杆，与传动轴联动）
 *    - 电磁脱扣器（每相 1 个，短路时衔铁弹出）
 *    - 热脱扣器双金属片（每相 1 个，过载时受热弯曲）
 *    - 脱扣轴（汇集各脱扣器动作，连至自由脱扣机构）
 *    - 分励脱扣器（1 个，24V 线圈，得电推动脱扣轴）
 *    - 自由脱扣机构（锁扣，跳闸时释放）
 *
 * ═══ 电气接口（8 个，全部在右侧界面引出）═══════════════════════
 *  l1/l2/l3 — 三相进线端（右上）
 *  t1/t2/t3 — 三相出线端（右下）
 *  fla/flb  — 分励脱扣器线圈接口（右缘，24V）
 *
 * ═══ 状态机 ═══════════════════════════════════════════════════
 *  OFF  → 点击手柄 / close()  → ON
 *  ON   → 点击手柄 / open()   → OFF
 *  任意 → trip(reason)        → TRIP（锁扣释放，传动轴回弹分闸）
 *  TRIP → 点击手柄 / reset()  → OFF（手动复位）
 *
 * ═══ 保护特性（In = 额定电流）═══════════════════════════════════
 *  · 短路：相电流瞬时值 ≥ 短路倍数(默认 5)×In → 瞬时跳闸
 *  · 过载：1.2×In 时约 20s、2×In 时约 0.4s，反时限（对数-对数插值）
 *  · 分励：fla/flb 接通 24V 电源，线圈得电 → 跳闸
 *
 * ═══ 可配置参数 ═══════════════════════════════════════════════
 *  label / ratedCurrent / overloadPickup / tripTime12 / tripTime2 /
 *  shortPickup / tripCoilR / initState / animDur
 */
export class MoldedCaseCircuitBreaker extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(340, config.width  || 380);
        this.height = Math.max(300, config.height || 370);

        this.type    = 'ACB';        // 复用 ACB 求解通道（主触头 + 分励线圈）
        this.special = '3P-MCCB';    // 走 ACB 通用 stamp（非 MainsSwitch 分支）
        this.cache   = 'fixed';

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        this.config = {
            id: this.id,
            label: this.label,
            ratedCurrent: this.ratedCurrent,
            overloadPickup: this.overloadPickup,
            tripTime12: this._t12,
            tripTime2: this._t2,
            shortPickup: this.shortPickup,
            tripCoilR: this._tripCoilR,
            initState: this._state,
            animDur: this._animDur,
        };

        // ── 电气接口（8 个）──────────────────────────────────
        this.addPort(this._portL[0].x, this._portL[0].y, 'l1', 'wire');
        this.addPort(this._portL[1].x, this._portL[1].y, 'l2', 'wire');
        this.addPort(this._portL[2].x, this._portL[2].y, 'l3', 'wire');
        this.addPort(this._portT[0].x, this._portT[0].y, 't1', 'wire', 'p');
        this.addPort(this._portT[1].x, this._portT[1].y, 't2', 'wire', 'p');
        this.addPort(this._portT[2].x, this._portT[2].y, 't3', 'wire', 'p');
        this.addPort(this._portF[0].x, this._portF[0].y, 'fla', 'wire', 'p');
        this.addPort(this._portF[1].x, this._portF[1].y, 'flb', 'wire');

        this._updateDynamic();
    }

    // ═══════════════════════════════════════════════════════════
    // 几何尺寸
    // ═══════════════════════════════════════════════════════════

    _recalcGeometry() {
        const W = this.width, H = this.height;

        this._frame = { x: 2, y: 2, w: W - 4, h: H - 4, rx: 8 };
        this._divX  = 162;   // 左侧外观区（去掉两侧空隙，壳体基本贴边）

        // ── 左侧：外观（壳体加宽、滑槽与手柄加宽）──────────────
        const cw = 150, ch = 300;
        this._case = { x: 6, y: 30, w: cw, h: ch, rx: 4 };

        this._slotW   = 36;                 // 滑槽加宽（原 26）
        this._slotTop = this._case.y + 40;
        this._slotBot = this._case.y + ch - 40;

        this._handleCX = this._case.x + cw / 2;
        this._handleMidY = this._case.y + ch / 2;
        this._handleOffsets = { on: -ch * 0.175, off: ch * 0.135, trip: -ch * 0.01 };
        this._handleBarW = 34;              // 手柄加宽（原 24）
        this._handleBarH = ch * 0.30;

        // 端子螺丝行
        this._screwTopY = this._case.y + 22;
        this._screwBotY = this._case.y + ch - 22;
        this._screwXs = [0.25, 0.50, 0.75].map(f => this._case.x + cw * f);
        this._screwR = 4;

        // ── 右侧：内部结构（上下引线截断，整体压缩）────────────
        const sL = this._divX + 4;
        const sR = W - 4;
        const sW = sR - sL;
        this._sch = { L: sL, R: sR, W: sW };

        this._poleXs = [0.20, 0.38, 0.56].map(f => sL + sW * f);

        this._termInY  = 22;    // 端口(2) → 端子(22)，引线截短
        this._termOutY = H - 22;
        this._fixedY   = 76;
        this._pivotY   = 148;   // 传动轴 / 可动触头枢轴
        this._magY     = 214;   // 电磁脱扣器线圈
        this._bimY     = 262;   // 热脱扣器双金属片
        this._tripShaftY = 300; // 脱扣轴

        this._termR = 4;
        this._magW  = 16;
        this._magH  = 30;
        this._bimH  = 32;

        // 机构（右）
        this._latchX = sL + sW * 0.70;
        this._latchY = 146;
        this._handlePivot = { x: sL + sW * 0.88, y: 96 };
        this._handleLen = 40;
        this._shuntCX = sL + sW * 0.88;
        this._shuntCY = 258;
        this._shuntW  = 16;
        this._shuntH  = 30;

        // 传动轴右端（连至机构）
        this._shaftRightX = sL + sW * 0.82;

        // 分断弹簧：挂在传动轴左端，下端为固定锚点；合闸时被拉长（储能）
        this._springX = this._poleXs[0] - 30;
        this._springBotY = this._pivotY + 50;

        // ── 端口坐标 ──────────────────────────────────────────
        this._portL = this._poleXs.map(px => ({ x: px, y: 2 }));
        this._portT = this._poleXs.map(px => ({ x: px, y: H - 2 }));
        this._portF = [
            { x: W - 2, y: 234 },
            { x: W - 2, y: 314 },
        ];

        // 状态指示
        this._indicator = { x: this._case.x, y: this._case.y + ch + 6, w: cw, h: 22, rx: 3 };
    }

    // ═══════════════════════════════════════════════════════════
    // 参数初始化
    // ═══════════════════════════════════════════════════════════

    _initParameters(config) {
        this.label    = config.label || 'QF';
        this.function = config.function || '塑壳式断路器 MCCB';

        this.ratedCurrent   = config.ratedCurrent   !== undefined ? config.ratedCurrent   : 100;
        this.overloadPickup = config.overloadPickup !== undefined ? config.overloadPickup : 1.2;
        this._t12           = config.tripTime12     !== undefined ? config.tripTime12     : 20;   // 1.2×In 动作时间(s)
        this._t2            = config.tripTime2      !== undefined ? config.tripTime2      : 0.4;  // 2×In 动作时间(s)
        this.shortPickup    = config.shortPickup    !== undefined ? config.shortPickup    : 5;    // 短路瞬时倍数
        this._tripCoilR     = config.tripCoilR      !== undefined ? config.tripCoilR      : 2000; // 24V 分励线圈电阻

        const s = String(config.initState || 'off').toLowerCase();
        this._state = ['on', 'off', 'trip'].includes(s) ? s : 'off';
        this._tripReason = '';

        // 动画：0=分闸 1=合闸
        this._animDur = config.animDur !== undefined ? config.animDur : 0.22;
        this._animating = false;
        this._animT = 0;
        this._justEnded = false;
        this._curClose = this._state === 'on' ? 1 : 0;
        this._curLatch = this._state === 'trip' ? 1 : 0;
        this._curHandleY = this._handleOffsets[this._state];
        this._handleFromY = this._curHandleY;
        this._handleToY   = this._curHandleY;
        this._animFrom = null;
        this._animTo = null;

        // 电流 / 保护：峰值包络（快起慢落）估算有效值
        this._peak = [0, 0, 0];
        this._rms = [0, 0, 0];
        this._heat = [0, 0, 0];     // 热积累（0~1，同时驱动双金属片弯曲）
        this._magPhase = [false, false, false];
        this._shuntCurrent = 0;
        this._shuntOn = false;

        this.opsCount = config.initOps || 0;
    }

    // ═══════════════════════════════════════════════════════════
    // 主初始化
    // ═══════════════════════════════════════════════════════════

    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
    }

    // ═══════════════════════════════════════════════════════════
    // 静态绘制
    // ═══════════════════════════════════════════════════════════

    _drawStaticParts() {
        this._drawFrame();
        this._drawCase();
        this._drawInternalStatic();
        this._drawHeader();
    }

    _drawFrame() {
        const f = this._frame;
        this._staticGroup.add(new Konva.Rect({
            x: f.x, y: f.y, width: f.w, height: f.h,
            fill: '#e9ecf2', stroke: '#a8a29a', strokeWidth: 1.5, cornerRadius: f.rx,
        }));
        // 右侧内部结构底衬
        this._staticGroup.add(new Konva.Rect({
            x: this._sch.L - 2, y: 30, width: this._sch.W + 4, height: f.h - 32,
            fill: '#f4f6fa', stroke: '#ccd2da', strokeWidth: 1, cornerRadius: 4,
        }));
        // 左右分隔线
        this._staticGroup.add(new Konva.Line({
            points: [this._divX, f.y + 32, this._divX, f.y + f.h - 6],
            stroke: '#a8a29a', strokeWidth: 1, dash: [5, 4],
        }));
    }

    _drawHeader() {
        const f = this._frame;
        this._staticGroup.add(new Konva.Rect({
            x: f.x + 2, y: f.y + 2, width: f.w - 4, height: 28,
            fill: 'rgba(90,130,210,0.18)', cornerRadius: [f.rx, f.rx, 0, 0],
        }));
        this._staticGroup.add(new Konva.Text({
            x: f.x + 10, y: f.y + 7, text: this.function,
            fontSize: Math.max(12, this.width * 0.020), fontStyle: 'bold', fill: '#3a4658',
        }));
        this._staticGroup.add(new Konva.Text({
            x: f.x + 10, y: f.y + 34, text: '外观', fontSize: 11, fill: '#7a8290',
        }));
        this._staticGroup.add(new Konva.Text({
            x: this._divX + 10, y: f.y + 34, text: '内部结构', fontSize: 11, fill: '#7a8290',
        }));
    }

    /** 左侧：塑壳断路器外观（白色壳体 + 滑槽 + 端子螺丝 + 铭牌） */
    _drawCase() {
        const c = this._case;
        const g = this._staticGroup;

        // 侧边厚度（立体感）
        g.add(new Konva.Rect({
            x: c.x + 4, y: c.y + 4, width: c.w, height: c.h,
            fill: '#c2c8d2', cornerRadius: c.rx, listening: false,
        }));
        // 正面壳体
        g.add(new Konva.Rect({
            x: c.x, y: c.y, width: c.w, height: c.h,
            fillLinearGradientStartPoint: { x: c.x, y: c.y },
            fillLinearGradientEndPoint:   { x: c.x + c.w, y: c.y + c.h },
            fillLinearGradientColorStops: [0, '#fafbfd', 0.5, '#f0f1f4', 1, '#dfe3ea'],
            stroke: '#a0a8b8', strokeWidth: 1.5, cornerRadius: c.rx,
        }));
        // 顶部高光
        g.add(new Konva.Rect({
            x: c.x + 3, y: c.y + 3, width: c.w - 6, height: 8,
            fill: 'rgba(255,255,255,0.7)', cornerRadius: [c.rx, c.rx, 0, 0], listening: false,
        }));
        // 侧棱受光
        g.add(new Konva.Line({
            points: [c.x + 1, c.y + 6, c.x + 1, c.y + c.h - 6],
            stroke: 'rgba(255,255,255,0.6)', strokeWidth: 2, listening: false,
        }));

        // 中央竖滑槽
        const slotX = this._handleCX - this._slotW / 2;
        g.add(new Konva.Rect({
            x: slotX, y: this._slotTop, width: this._slotW, height: this._slotBot - this._slotTop,
            fill: '#cfd3da', stroke: '#9aa2ac', strokeWidth: 1, cornerRadius: 3, listening: false,
        }));
        g.add(new Konva.Rect({
            x: slotX + 1, y: this._slotTop + 1, width: this._slotW - 2,
            height: (this._slotBot - this._slotTop) * 0.5,
            fill: 'rgba(0,0,0,0.10)', cornerRadius: [3, 3, 0, 0], listening: false,
        }));
        g.add(new Konva.Rect({
            x: slotX + 1, y: this._slotBot - (this._slotBot - this._slotTop) * 0.4,
            width: this._slotW - 2, height: (this._slotBot - this._slotTop) * 0.4 - 1,
            fill: 'rgba(255,255,255,0.35)', cornerRadius: [0, 0, 3, 3], listening: false,
        }));

        // 状态标记（ON / TRIP / OFF）
        const marks = [
            { off: this._handleOffsets.on,   text: 'ON',   color: '#20a030' },
            { off: this._handleOffsets.trip, text: 'TRIP', color: '#e08020' },
            { off: this._handleOffsets.off,  text: 'OFF',  color: '#c03020' },
        ];
        marks.forEach(m => {
            g.add(new Konva.Text({
                x: slotX - 24, y: this._handleMidY + m.off - 5,
                text: m.text, fontSize: 8, fontStyle: 'bold', fill: m.color, listening: false,
            }));
        });

        // 上下端子螺丝
        [this._screwTopY, this._screwBotY].forEach(y => {
            this._screwXs.forEach(x => this._screw(x, y));
        });

        // 铭牌
        const npX = c.x + 10, npY = c.y + c.h - 70, npW = c.w - 20, npH = 24;
        g.add(new Konva.Rect({
            x: npX, y: npY, width: npW, height: npH,
            fill: '#c8c0a0', stroke: '#908878', strokeWidth: 1, cornerRadius: 2, listening: false,
        }));
        g.add(new Konva.Text({
            x: npX + 4, y: npY + 2, text: this.label, fontSize: 11, fontStyle: 'bold', fill: '#2a2018',
        }));
        g.add(new Konva.Text({
            x: npX + 4, y: npY + 13, text: `In=${this.ratedCurrent}A`, fontSize: 9, fill: '#4a3828',
        }));
    }

    /** 铜色十字螺丝 */
    _screw(x, y) {
        const r = this._screwR;
        this._staticGroup.add(new Konva.Circle({
            x, y, radius: r,
            fillLinearGradientStartPoint: { x: -r, y: -r },
            fillLinearGradientEndPoint:   { x:  r, y:  r },
            fillLinearGradientColorStops: [0, '#8a7a30', 0.4, '#c8a848', 0.7, '#d8b858', 1, '#7a6a28'],
            stroke: '#5a4a18', strokeWidth: 0.6, listening: false,
        }));
        this._staticGroup.add(new Konva.Line({ points: [x - r * 0.55, y, x + r * 0.55, y], stroke: '#3a2a08', strokeWidth: 0.7, listening: false }));
        this._staticGroup.add(new Konva.Line({ points: [x, y - r * 0.55, x, y + r * 0.55], stroke: '#3a2a08', strokeWidth: 0.7, listening: false }));
    }

    /** 右侧：内部结构静态部分 */
    _drawInternalStatic() {
        const g = this._staticGroup;

        this._poleXs.forEach((px, i) => {
            const color = ['#c0392b', '#27a04a', '#2b6fd0'][i];
            const inName  = ['L1', 'L2', 'L3'][i];
            const outName = ['T1', 'T2', 'T3'][i];

            // 端子
            this._terminal(px, this._termInY, inName, color, -1);
            this._terminal(px, this._termOutY, outName, color, 1);

            // 端子 → 边框
            g.add(new Konva.Line({ points: [px, 2, px, this._termInY - this._termR], stroke: color, strokeWidth: 2.5 }));
            g.add(new Konva.Line({ points: [px, this._termOutY + this._termR, px, this.height - 2], stroke: color, strokeWidth: 2.5 }));

            // 端子 → 静触头
            g.add(new Konva.Line({ points: [px, this._termInY + this._termR, px, this._fixedY], stroke: color, strokeWidth: 2 }));
            // 静触头
            g.add(new Konva.Line({ points: [px - 12, this._fixedY, px + 12, this._fixedY], stroke: color, strokeWidth: 3.5, lineCap: 'round' }));
            g.add(new Konva.Line({ points: [px - 3, this._fixedY - 6, px + 9, this._fixedY], stroke: '#9aa0a6', strokeWidth: 2 }));

            // 传动轴 → 电磁脱扣器 → 双金属片 → 出线端子
            g.add(new Konva.Line({ points: [px, this._pivotY, px, this._magY - this._magH / 2], stroke: color, strokeWidth: 2 }));
            g.add(new Konva.Line({ points: [px, this._magY + this._magH / 2, px, this._bimY - this._bimH / 2], stroke: color, strokeWidth: 2 }));
            g.add(new Konva.Line({ points: [px, this._bimY + this._bimH / 2, px, this._termOutY - this._termR], stroke: color, strokeWidth: 2 }));

            // 电磁脱扣器线圈
            this._coilSymbol(px, this._magY, this._magW, this._magH, '#c07830');
            // 双金属片安装槽
            g.add(new Konva.Rect({
                x: px - 6, y: this._bimY - this._bimH / 2 - 3, width: 12, height: this._bimH + 6,
                fill: '#e6e9ee', stroke: '#b8bec6', strokeWidth: 0.8, cornerRadius: 2, listening: false,
            }));
            // 脱扣轴挂钩
            g.add(new Konva.Line({
                points: [px, this._magY + this._magH / 2 + 4, px, this._tripShaftY - 6],
                stroke: '#8a9099', strokeWidth: 1.2, dash: [3, 3], opacity: 0.7, listening: false,
            }));
        });

        // 自由脱扣机构底座
        g.add(new Konva.Rect({
            x: this._latchX - 18, y: this._latchY - 20, width: 36, height: 40,
            fill: 'rgba(107,113,120,0.12)', stroke: '#8a9099', strokeWidth: 1, dash: [3, 3], cornerRadius: 3, listening: false,
        }));
        this._label('脱扣机构', this._latchX - 16, this._latchY - 32, '#4a5568');

        // 分励脱扣器线圈
        this._coilSymbol(this._shuntCX, this._shuntCY, this._shuntW, this._shuntH, '#b06a20');
        g.add(new Konva.Line({
            points: [this._shuntCX, this._shuntCY - this._shuntH / 2, this._portF[0].x, this._portF[0].y],
            stroke: '#8a6a30', strokeWidth: 1.6, listening: false,
        }));
        g.add(new Konva.Line({
            points: [this._shuntCX, this._shuntCY + this._shuntH / 2, this._portF[1].x, this._portF[1].y],
            stroke: '#8a6a30', strokeWidth: 1.6, listening: false,
        }));
        this._label('分励脱扣', this._shuntCX - 48, this._shuntCY - 4, '#6a3828');

        // 部件标注（左对齐于内部结构面板左缘，避免压到分隔线）
        const lx = this._sch.L + 2;
        this._label('触头', lx, this._fixedY - 8, '#5a6a7a');
        this._label('传动轴', lx, this._pivotY - 5, '#5a6a7a');
        this._label('电磁脱扣器', lx, this._magY - 5, '#5a6a7a');
        this._label('热脱扣器', lx, this._bimY - 5, '#5a6a7a');
        this._label('脱扣轴', lx, this._tripShaftY - 14, '#5a6a7a');
        this._label('手柄', this._handlePivot.x - 8, this._handlePivot.y - 46, '#5a6a7a');
        this._label('弹簧', lx, this._springBotY + 2, '#5a6a7a');

        // 分断弹簧固定端锚板
        g.add(new Konva.Rect({
            x: this._springX - 9, y: this._springBotY - 4, width: 18, height: 6,
            fill: '#8a9099', stroke: '#5a6068', strokeWidth: 1, cornerRadius: 1.5, listening: false,
        }));
    }

    /** 接线柱 */
    _terminal(x, y, name, color, side) {
        const R = this._termR;
        const g = this._staticGroup;
        g.add(new Konva.Circle({
            x, y, radius: R,
            fillLinearGradientStartPoint: { x: x - R, y: y - R },
            fillLinearGradientEndPoint:   { x: x + R, y: y + R },
            fillLinearGradientColorStops: [0, '#7a6a30', 0.4, '#d4aa52', 0.7, '#e8c86a', 1, '#8a7030'],
            stroke: '#6a5a28', strokeWidth: 1, listening: false,
        }));
        g.add(new Konva.Circle({ x, y, radius: R * 0.38, fill: '#2a1a08', stroke: '#5a4a20', strokeWidth: 0.6, listening: false }));
        // 标注置于端子右侧，避免顶部标注压到标题栏
        g.add(new Konva.Text({
            x: x + 7, y: y - 5, text: name,
            fontSize: 9, fontStyle: 'bold', fill: color, listening: false,
        }));
    }

    /** 线圈符号 */
    _coilSymbol(cx, cy, w, h, color) {
        const g = this._staticGroup;
        g.add(new Konva.Rect({
            x: cx - w / 2, y: cy - h / 2, width: w, height: h, cornerRadius: 3,
            fillLinearGradientStartPoint: { x: cx - w / 2, y: 0 },
            fillLinearGradientEndPoint:   { x: cx + w / 2, y: 0 },
            fillLinearGradientColorStops: [0, '#7a4a12', 0.4, color, 0.7, '#e0a050', 1, '#7a4a12'],
            stroke: '#5a3410', strokeWidth: 1, listening: false,
        }));
        for (let i = 1; i <= 3; i++) {
            const yy = cy - h / 2 + h * i / 4;
            g.add(new Konva.Line({ points: [cx - w / 2 + 2, yy, cx + w / 2 - 2, yy], stroke: '#5a3410', strokeWidth: 1, opacity: 0.7, listening: false }));
        }
    }

    _label(text, x, y, color) {
        this._staticGroup.add(new Konva.Text({ x, y, text, fontSize: 8, fill: color, listening: false }));
    }

    // ═══════════════════════════════════════════════════════════
    // 动态层
    // ═══════════════════════════════════════════════════════════

    _createDynamicNodes() {
        this._createHandle();
        this._createBlades();
        this._createShaft();
        this._createSpring();
        this._createTripShaft();
        this._createLatch();
        this._createSchHandle();
        this._createPlungers();
        this._createBimetals();
        this._createShuntGlow();
        this._createIndicator();
    }

    /** 左侧蓝色长方体手柄（3D 效果，槽内上下滑动） */
    _createHandle() {
        const bw = this._handleBarW, bh = this._handleBarH;
        const g = new Konva.Group({ x: this._handleCX, y: this._handleMidY + this._handleOffsets[this._state] });

        // 投影
        g.add(new Konva.Rect({ x: -bw / 2 + 2, y: -bh / 2 + 3, width: bw, height: bh, fill: 'rgba(0,0,0,0.16)', cornerRadius: 3, listening: false }));
        // 正面
        g.add(new Konva.Rect({
            x: -bw / 2, y: -bh / 2, width: bw, height: bh,
            fillLinearGradientStartPoint: { x: 0, y: -bh / 2 },
            fillLinearGradientEndPoint:   { x: 0, y:  bh / 2 },
            fillLinearGradientColorStops: [0, '#3890e0', 0.3, '#2878c8', 0.7, '#1a60a8', 1, '#1848a0'],
            stroke: '#1040a0', strokeWidth: 1, cornerRadius: 3,
        }));
        // 高光
        g.add(new Konva.Rect({ x: -bw / 2 + 3, y: -bh / 2 + 1, width: bw - 6, height: bh * 0.22, fill: 'rgba(255,255,255,0.32)', cornerRadius: [2, 2, 0, 0], listening: false }));
        // 中央凸起（施力处）
        const gripW = bw - 6, gripH = Math.max(12, bh * 0.24), gripY = -gripH / 2;
        g.add(new Konva.Rect({ x: -gripW / 2, y: gripY + 2, width: gripW, height: gripH, fill: 'rgba(0,0,0,0.28)', cornerRadius: 2, listening: false }));
        g.add(new Konva.Rect({
            x: -gripW / 2, y: gripY, width: gripW, height: gripH,
            fillLinearGradientStartPoint: { x: 0, y: gripY },
            fillLinearGradientEndPoint:   { x: 0, y: gripY + gripH },
            fillLinearGradientColorStops: [0, '#5aa0ec', 0.35, '#3890e0', 0.65, '#2a70b8', 1, '#18508e'],
            stroke: '#1040a0', strokeWidth: 0.8, cornerRadius: 3, listening: false,
        }));
        g.add(new Konva.Rect({ x: -gripW / 2 + 2, y: gripY + 1, width: gripW - 4, height: 2, fill: 'rgba(255,255,255,0.5)', cornerRadius: 1, listening: false }));

        this._handleGroup = g;
        this._dynamicGroup.add(g);
    }

    /** 三极可动触头（绕传动轴旋转） */
    _createBlades() {
        const bladeLen = this._pivotY - this._fixedY;
        this._blades = this._poleXs.map((px, i) => {
            const color = ['#c0392b', '#27a04a', '#2b6fd0'][i];
            const g = new Konva.Group({ x: px, y: this._pivotY, rotation: (1 - this._curClose) * 42 });
            g.add(new Konva.Line({ points: [0, 0, 0, -bladeLen], stroke: '#c8a040', strokeWidth: 4.5, lineCap: 'round' }));
            g.add(new Konva.Line({ points: [0, 0, 0, -bladeLen], stroke: '#f0c860', strokeWidth: 1.6, lineCap: 'round' }));
            g.add(new Konva.Circle({ x: 0, y: -bladeLen, radius: 3.4, fill: '#e8e8e8', stroke: '#a0a0a0', strokeWidth: 0.8 }));
            g.add(new Konva.Circle({ x: 0, y: -bladeLen * 0.5, radius: 2.2, fill: color }));
            this._dynamicGroup.add(g);
            return g;
        });
        // 合闸触点高光
        this._glows = this._poleXs.map(px => {
            const c = new Konva.Circle({ x: px, y: this._fixedY, radius: 7, fill: 'rgba(80,220,80,0.35)', visible: this._state === 'on', listening: false });
            this._dynamicGroup.add(c);
            return c;
        });
    }

    /** 传动轴（横向，连接三极触头与操作手柄） */
    _createShaft() {
        const y = this._pivotY;
        this._shaftGroup = new Konva.Group({ x: 0, y: 0 });
        this._shaftGroup.add(new Konva.Line({
            points: [this._poleXs[0] - 24, y, this._shaftRightX, y],
            stroke: '#7a8088', strokeWidth: 5, lineCap: 'round',
        }));
        this._shaftGroup.add(new Konva.Line({
            points: [this._poleXs[0] - 24, y, this._shaftRightX, y],
            stroke: '#b8bec6', strokeWidth: 2, lineCap: 'round',
        }));
        // 手柄轴 → 传动轴：虚线，表示手柄带动传动轴
        this._shaftGroup.add(new Konva.Line({
            points: [this._handlePivot.x, this._handlePivot.y, this._shaftRightX, y],
            stroke: '#9aa0a6', strokeWidth: 1.6, dash: [4, 3],
        }));
        this._dynamicGroup.add(this._shaftGroup);
    }

    /** 分断弹簧（挂在传动轴左端与固定锚点之间，合闸时被拉长） */
    _createSpring() {
        this._springLine = new Konva.Line({
            points: this._springPoints(0),
            stroke: '#c0c4c8', strokeWidth: 2, lineCap: 'round',
        });
        this._dynamicGroup.add(this._springLine);
    }

    /** 弹簧折线（offset：传动轴竖向位移） */
    _springPoints(offset) {
        const x = this._springX;
        const y0 = this._pivotY + offset;
        const y1 = this._springBotY;
        const n = 6, amp = 6;
        const pts = [x, y0];
        for (let i = 1; i < n; i++) {
            const y = y0 + (y1 - y0) * (i / n);
            pts.push(x + (i % 2 === 0 ? amp : -amp), y);
        }
        pts.push(x, y1);
        return pts;
    }

    /** 脱扣轴（横向，汇集各脱扣器动作，连至自由脱扣机构） */
    _createTripShaft() {
        const y = this._tripShaftY;
        this._tripShaftGroup = new Konva.Group({ x: 0, y: 0 });
        this._tripShaftGroup.add(new Konva.Line({
            points: [this._poleXs[0] - 26, y, this._latchX - 14, y],
            stroke: '#8a6a30', strokeWidth: 4, lineCap: 'round',
        }));
        this._tripShaftGroup.add(new Konva.Line({
            points: [this._latchX - 14, y, this._latchX - 14, this._latchY + 14],
            stroke: '#8a6a30', strokeWidth: 2.6,
        }));
        this._dynamicGroup.add(this._tripShaftGroup);
    }

    /** 自由脱扣机构（锁扣） */
    _createLatch() {
        const g = new Konva.Group({ x: this._latchX, y: this._latchY, rotation: this._curLatch * -34 });
        g.add(new Konva.Line({
            points: [0, 14, 0, -2, -14, -2, -14, -12],
            stroke: '#5a6068', strokeWidth: 4, lineCap: 'round', lineJoin: 'round',
        }));
        g.add(new Konva.Circle({ x: 0, y: 14, radius: 3.4, fill: '#3a3e44', stroke: '#1a1c20', strokeWidth: 1 }));
        this._latchGroup = g;
        this._dynamicGroup.add(g);
    }

    /** 内部操作手柄杠杆 */
    _createSchHandle() {
        const p = this._handlePivot;
        const g = new Konva.Group({ x: p.x, y: p.y, rotation: (1 - this._curClose) * 46 - 23 });
        g.add(new Konva.Line({ points: [0, 0, 0, -this._handleLen], stroke: '#c0392b', strokeWidth: 6, lineCap: 'round' }));
        g.add(new Konva.Circle({ x: 0, y: -this._handleLen, radius: 6, fill: '#e04a38', stroke: '#7a1a12', strokeWidth: 1 }));
        g.add(new Konva.Circle({ x: 0, y: 0, radius: 3.6, fill: '#3a3e44', stroke: '#1a1c20', strokeWidth: 1 }));
        this._schHandleGroup = g;
        this._dynamicGroup.add(g);
    }

    /** 电磁脱扣器衔铁（短路时弹出） */
    _createPlungers() {
        this._plungers = this._poleXs.map(px => {
            const g = new Konva.Group({ x: px, y: this._magY - this._magH / 2 - 4 });
            g.add(new Konva.Line({ points: [0, 0, 0, -10], stroke: '#6b7178', strokeWidth: 2 }));
            g.add(new Konva.Rect({ x: -this._magW * 0.45, y: -18, width: this._magW * 0.9, height: 8, fill: '#9aa0a6', stroke: '#5a6068', strokeWidth: 1, cornerRadius: 1.5 }));
            this._dynamicGroup.add(g);
            return g;
        });
    }

    /** 热脱扣器双金属片 */
    _createBimetals() {
        this._bim = this._poleXs.map(px => {
            const line = new Konva.Line({
                points: this._bimetalPoints(px, this._bimY, this._bimH, 0),
                stroke: '#b8892f', strokeWidth: 5, lineCap: 'round', tension: 0.4,
            });
            this._dynamicGroup.add(line);
            return line;
        });
    }

    /** 分励线圈通电发光 */
    _createShuntGlow() {
        this._shuntGlow = new Konva.Circle({
            x: this._shuntCX, y: this._shuntCY, radius: this._shuntW * 0.9,
            fill: 'rgba(240,150,60,0.32)', visible: false, listening: false,
        });
        this._dynamicGroup.add(this._shuntGlow);
    }

    /** 状态指示窗 */
    _createIndicator() {
        const ir = this._indicator;
        this._indBg = new Konva.Rect({ x: ir.x, y: ir.y, width: ir.w, height: ir.h, fill: '#101014', stroke: '#444', strokeWidth: 1, cornerRadius: ir.rx });
        this._indText = new Konva.Text({
            x: ir.x, y: ir.y, width: ir.w, height: ir.h, text: '○ OFF',
            fontSize: 12, fontStyle: 'bold', fill: '#888898', align: 'center', verticalAlign: 'middle', listening: false,
        });
        this._dynamicGroup.add(this._indBg);
        this._dynamicGroup.add(this._indText);
    }

    // ═══════════════════════════════════════════════════════════
    // 形状辅助
    // ═══════════════════════════════════════════════════════════

    _bimetalPoints(cx, cy, h, heat) {
        const bend = heat * 12;
        const top = cy - h / 2, bot = cy + h / 2;
        return [cx, top, cx + bend * 0.5, cy, cx + bend, bot];
    }

    // ═══════════════════════════════════════════════════════════
    // 逐帧更新
    // ═══════════════════════════════════════════════════════════

    _updateDynamic() {
        // 左侧手柄（合闸在 ON 位、分闸在 OFF 位、跳闸在中间位）
        this._handleGroup.y(this._handleMidY + this._curHandleY);

        // 三极触头
        const bladeAng = (1 - this._curClose) * 42;
        this._blades.forEach(g => g.rotation(bladeAng));
        this._glows.forEach(c => c.visible(!this._animating && this._state === 'on'));

        // 传动轴 / 手柄 / 锁扣 / 脱扣轴
        const shaftOff = (1 - this._curClose) * 10;
        this._shaftGroup.y(shaftOff);
        this._springLine.points(this._springPoints(shaftOff));
        this._schHandleGroup.rotation((1 - this._curClose) * 46 - 23);
        this._latchGroup.rotation(this._curLatch * -34);
        this._tripShaftGroup.x(this._curLatch * 10);

        // 电磁脱扣器衔铁
        this._plungers.forEach((g, i) => g.y(this._magY - this._magH / 2 - 4 - (this._magPhase[i] ? 9 : 0)));

        // 双金属片
        this._bim.forEach((line, i) => line.points(this._bimetalPoints(this._poleXs[i], this._bimY, this._bimH, this._heat[i])));

        // 分励线圈发光
        this._shuntGlow.visible(this._shuntOn);

        // 指示窗
        const cfg = this._indicatorCfg();
        this._indBg.fill(cfg.bg);
        this._indText.text(cfg.text);
        this._indText.fill(cfg.color);
    }

    _indicatorCfg() {
        switch (this._state) {
            case 'on':   return { text: '● ON',   color: '#30ef50', bg: '#0a2010' };
            case 'trip': return { text: `⚡ TRIP ${this._reasonLabel()}`, color: '#ffb030', bg: '#201000' };
            default:     return { text: '○ OFF',  color: '#888898', bg: '#101014' };
        }
    }

    _reasonLabel() {
        switch (this._tripReason) {
            case 'short':    return '短路';
            case 'overload': return '过载';
            case 'shunt':    return '分励';
            default:         return '';
        }
    }

    // ═══════════════════════════════════════════════════════════
    // 交互
    // ═══════════════════════════════════════════════════════════

    _bindInteraction() {
        this._parts = {};
        const c = this._case;

        // 点击外观手柄（或整个壳体）切换状态（合闸/分闸/复位）。
        // 直接复用 addClickablePart 返回的命中区，避免其上层热区吞掉点击事件。
        const bindToggle = (hit) => {
            hit.on('click tap', () => this._toggle());
            hit.on('mouseenter', () => { document.body.style.cursor = 'pointer'; });
            hit.on('mouseleave', () => { document.body.style.cursor = 'default'; });
        };
        // 整个壳体（点击任意处均可切换）
        bindToggle(this.addClickablePart('case', c.x, c.y, c.w, c.h, true));
        // 操作手柄（滑槽区域）：单独注册，供结构识别箭头精确指向手柄
        bindToggle(this.addClickablePart(
            'handle',
            this._handleCX - this._slotW / 2 - 6,
            this._slotTop - 6,
            this._slotW + 12,
            (this._slotBot - this._slotTop) + 12,
            true
        ));

        // 内部结构可识别部件（供工作流箭头指示）
        const p0 = this._poleXs[0], p2 = this._poleXs[2];
        const spanX = p2 - p0 + 60;
        this.addClickablePart('contact', p0 - 30, this._fixedY - 20, spanX, 40);
        this.addClickablePart('shaft', p0 - 30, this._pivotY - 14, spanX, 28);
        this.addClickablePart('magnetic-trip', p0 - 30, this._magY - this._magH * 0.6, spanX, this._magH * 1.2);
        this.addClickablePart('thermal-trip', p0 - 30, this._bimY - this._bimH * 0.6, spanX, this._bimH * 1.2);
        this.addClickablePart('trip-shaft', p0 - 36, this._tripShaftY - 12, (this._latchX - p0) + 16, 24);
        this.addClickablePart('shunt-trip', this._shuntCX - 18, this._shuntCY - this._shuntH * 0.7, 36, this._shuntH * 1.4);
        this.addClickablePart('spring', this._springX - 12, this._pivotY - 4, 24, (this._springBotY - this._pivotY) + 12);
    }

    _toggle() {
        if (this._animating) return;
        if (this._state === 'off') this.close();
        else if (this._state === 'on') this.open();
        else if (this._state === 'trip') this._resetToOff();
    }

    /** 可识别部件中心（世界坐标，计入组件位移/旋转/缩放） */
    getClickablePartCenter(partId) {
        const p = this._parts && this._parts[partId];
        if (!p) return null;
        const pt = this.group.getAbsoluteTransform().point({ x: p.x + p.w / 2, y: p.y + p.h / 2 });
        return { x: pt.x, y: pt.y };
    }

    // ═══════════════════════════════════════════════════════════
    // tick（20fps）
    // ═══════════════════════════════════════════════════════════

    tick(dt) {
        this._tickAnimation(dt);
        this._updateCurrents(dt);
        this._checkShunt();
        this._checkProtection(dt);

        if (this._animating || this._justEnded || this._dynDirty) {
            this._justEnded = false;
            this._dynDirty = false;
            this._updateDynamic();
            this.markDirty();
        }
        this._refreshIfDirty();
    }

    _tickAnimation(dt) {
        if (!this._animating) return;
        this._animT += dt / this._animDur;
        if (this._animT >= 1) {
            this._animT = 1;
            this._animating = false;
            this._justEnded = true;
        }
        const ease = 0.5 - 0.5 * Math.cos(this._animT * Math.PI);
        this._curClose = this._animFrom.close + (this._animTo.close - this._animFrom.close) * ease;
        this._curLatch = this._animFrom.latch + (this._animTo.latch - this._animFrom.latch) * ease;
        this._curHandleY = this._handleFromY + (this._handleToY - this._handleFromY) * ease;
    }

    /**
     * 电流有效值：峰值包络法（快起、慢落），I_rms = 峰值 / √2。
     * 求解器每帧推进 9°（50Hz），峰值每半周期刷新一次；
     * 快起保证过流在半个周期内被捕捉（满足 0.4s 级动作），
     * 慢落保留热记忆，避免电流波动时误复位。
     */
    _updateCurrents(dt) {
        if (this._state !== 'on') {
            this._peak = [0, 0, 0];
            this._rms = [0, 0, 0];
            return;
        }
        const pc = this.phaseCurrents;
        const inst = pc ? [pc.l1 || 0, pc.l2 || 0, pc.l3 || 0] : [0, 0, 0];
        const decay = 0.999;   // 半周期刷新，保持段衰减约 2%
        for (let i = 0; i < 3; i++) {
            const a = Math.abs(inst[i]);
            this._peak[i] = Math.max(a, this._peak[i] * decay);
            this._rms[i] = this._peak[i] / Math.SQRT2;
        }
    }

    /** 分励脱扣检测（线圈电流由电路求解器回填） */
    _checkShunt() {
        const i = Math.abs(this._shuntTripCurrent || 0);
        this._shuntOn = i > 0.005;   // ≈10V / 2000Ω 以上视为得电
    }

    /**
     * 反时限动作时间（s）：M = I / In
     *  锚点：1.2×In → 20s、2×In → 0.4s、5×In → 瞬时
     *  1.2 ~ 5 倍之间按对数-对数线性插值；≥ 5 倍返回 0（瞬时）
     */
    _tripTimeFor(M) {
        const p = this.overloadPickup;
        const sp = this.shortPickup;
        if (!(M > 0)) return Infinity;
        if (M < p) return Infinity;
        if (M >= sp) return 0;

        const anchors = [[p, this._t12]];
        if (p < 2 && 2 < sp) anchors.push([2, this._t2]);
        anchors.push([sp, 0.02]);
        anchors.sort((a, b) => a[0] - b[0]);

        for (let i = 0; i < anchors.length - 1; i++) {
            const [m0, t0] = anchors[i];
            const [m1, t1] = anchors[i + 1];
            if (M <= m1) {
                const f = (Math.log(M) - Math.log(m0)) / (Math.log(m1) - Math.log(m0));
                return Math.exp(Math.log(t0) + f * (Math.log(t1) - Math.log(t0)));
            }
        }
        return 0.02;
    }

    _checkProtection(dt) {
        const pc = this.phaseCurrents;
        const inst = pc ? [pc.l1 || 0, pc.l2 || 0, pc.l3 || 0] : [0, 0, 0];

        if (this._state !== 'on') {
            for (let i = 0; i < 3; i++) this._heat[i] = Math.max(0, this._heat[i] - dt * 0.3);
            this._dynDirty = true;
            return;
        }

        const In = this.ratedCurrent;

        // 1) 短路（电磁脱扣）：瞬时值或峰值包络达到短路电流对应的峰值。
        //    0.85 / 1.12 的系数略低于 √2：因求解器每帧仅推进 9°，采样点很难恰好落在
        //    波峰，且电源内阻使 350kW 时电流约 434A（4.3×In），需保证其可靠判为短路。
        const shortRms = this.shortPickup * In;
        const shortEnv = shortRms * 0.85;
        const shortPk = shortRms * 1.12;
        let shortHit = false;
        for (let i = 0; i < 3; i++) {
            if (Math.abs(inst[i]) > shortPk || this._rms[i] >= shortEnv) { this._magPhase[i] = true; shortHit = true; }
        }
        if (shortHit) { this.trip('short'); return; }

        // 2) 过载（热脱扣）：反时限热积累（同时驱动双金属片弯曲）。
        //    热积累速率设下限 T_FLOOR，保证大电流时电磁脱扣先于热脱扣动作。
        const T_FLOOR = 0.5;
        let tripOver = false;
        for (let i = 0; i < 3; i++) {
            const M = this._rms[i] / In;
            const t = this._tripTimeFor(M);
            if (isFinite(t) && t > 0) {
                this._heat[i] += Math.min(dt / t, dt / T_FLOOR);
            } else {
                this._heat[i] = Math.max(0, this._heat[i] - dt * 0.3);
            }
            this._heat[i] = Math.min(1.1, this._heat[i]);
            if (this._heat[i] >= 1) tripOver = true;
        }
        if (tripOver) { this.trip('overload'); return; }

        this._dynDirty = true;
    }

    // ═══════════════════════════════════════════════════════════
    // 状态切换
    // ═══════════════════════════════════════════════════════════

    _startAnim(toState) {
        this._animFrom = { close: this._curClose, latch: this._curLatch };
        this._animTo = {
            close: toState === 'on' ? 1 : 0,
            latch: toState === 'trip' ? 1 : 0,
        };
        this._handleFromY = this._curHandleY;
        this._handleToY   = this._handleOffsets[toState];
        this._animT = 0;
        this._animating = true;
        this._state = toState;
        this.opsCount++;
        if (toState !== 'trip') {
            this._tripReason = '';
            this._magPhase = [false, false, false];
        }
    }

    /** 合闸（OFF → ON） */
    close() {
        if (this._animating || this._state !== 'off') return false;
        this._animDur = this.config.animDur || 0.22;
        this._startAnim('on');
        return true;
    }

    /** 分闸（ON → OFF） */
    open() {
        if (this._animating || this._state !== 'on') return false;
        this._animDur = this.config.animDur || 0.22;
        this._startAnim('off');
        return true;
    }

    /** 脱扣跳闸（任意 → TRIP，瞬时） */
    trip(reason = 'shunt') {
        if (this._state === 'trip') return;
        this._tripReason = reason;
        if (reason === 'short' && !this._magPhase.some(v => v)) this._magPhase = [true, true, true];
        this._animDur = 0.08;
        this._startAnim('trip');
    }

    /** 手动复位（TRIP → OFF） */
    _resetToOff() {
        if (this._animating || this._state !== 'trip') return false;
        this._animDur = 0.22;
        this._startAnim('off');
        this._heat = [0, 0, 0];
        return true;
    }
    reset() { return this._resetToOff(); }

    // ═══════════════════════════════════════════════════════════
    // 公开 API
    // ═══════════════════════════════════════════════════════════

    getState()    { return this._state; }
    isClosed()    { return this._state === 'on'; }
    isTripped()   { return this._state === 'trip'; }
    isAnimating() { return this._animating; }
    getOpsCount() { return this.opsCount; }
    getTripReason() { return this._tripReason; }
    getRmsCurrents() { return [...this._rms]; }
    getHeat() { return [...this._heat]; }
    getTripCoilR() { return this._tripCoilR; }

    update(state) {
        const s = String(state).toLowerCase();
        if (s === 'on' || s === '1') this.close();
        if (s === 'off' || s === '0') { if (this._state === 'trip') this._resetToOff(); else this.open(); }
        if (s === 'trip') this.trip('shunt');
    }

    // ═══════════════════════════════════════════════════════════
    // 配置界面
    // ═══════════════════════════════════════════════════════════

    getConfigFields() {
        return [
            { label: '位号/名称', key: 'label', type: 'text' },
            { label: '额定电流 In (A)', key: 'ratedCurrent', type: 'number' },
            { label: '过载起始倍数 (×In)', key: 'overloadPickup', type: 'number', min: 1.05, max: 2, step: 0.05 },
            { label: '1.2×In 动作时间 (s)', key: 'tripTime12', type: 'number', min: 0.1, step: 0.5 },
            { label: '2×In 动作时间 (s)', key: 'tripTime2', type: 'number', min: 0.05, step: 0.05 },
            { label: '短路瞬时倍数 (×In)', key: 'shortPickup', type: 'number', min: 3, step: 0.5 },
            { label: '分励线圈电阻 (Ω)', key: 'tripCoilR', type: 'number' },
            { label: '初始状态 on/off/trip', key: 'initState', type: 'text' },
            { label: '动作时间 (s)', key: 'animDur', type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label !== undefined) this.label = cfg.label;
        if (cfg.ratedCurrent !== undefined) this.ratedCurrent = parseFloat(cfg.ratedCurrent);
        if (cfg.overloadPickup !== undefined) this.overloadPickup = parseFloat(cfg.overloadPickup);
        if (cfg.tripTime12 !== undefined) this._t12 = parseFloat(cfg.tripTime12);
        if (cfg.tripTime2 !== undefined) this._t2 = parseFloat(cfg.tripTime2);
        if (cfg.shortPickup !== undefined) this.shortPickup = parseFloat(cfg.shortPickup);
        if (cfg.tripCoilR !== undefined) this._tripCoilR = parseFloat(cfg.tripCoilR);
        if (cfg.animDur !== undefined) this._animDur = parseFloat(cfg.animDur);

        this.config = { ...this.config, ...cfg };

        if (cfg.initState !== undefined) {
            const want = String(cfg.initState).toLowerCase();
            if (['on', 'off', 'trip'].includes(want) && want !== this._state) {
                if (want === 'off' && this._state === 'trip') this._resetToOff();
                else {
                    this._state = want;
                    this._curClose = want === 'on' ? 1 : 0;
                    this._curLatch = want === 'trip' ? 1 : 0;
                    this._curHandleY = this._handleOffsets[want];
                }
            }
        }

        this._recalcGeometry();
        this._staticGroup.destroyChildren();
        this._dynamicGroup.destroyChildren();
        this._interactGroup.destroyChildren();
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
        this._updateDynamic();
        this._refreshCache();
        if (this.sys && this.sys.requestRedraw) this.sys.requestRedraw();
    }

    destroy() {
        super.destroy?.();
    }
}
