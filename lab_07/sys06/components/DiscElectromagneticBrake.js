import { BaseComponent } from './BaseComponent.js';

/**
 * 圆盘式电磁制动器（失电制动器）
 *
 * 结构（从左到右）：
 *   [E形静铁心+线圈] — [弹簧] — [动衔铁(右面摩擦片)] — [制动盘] — [固定压板] — [转轴→]
 *
 * 原理：
 *   - 通电：衔铁被吸向铁心（左移），压缩弹簧，摩擦片离开制动盘 → 松闸，转轴可自由转动
 *   - 断电：弹簧推动衔铁右移，摩擦片压紧制动盘，制动盘压向固定压板 → 抱闸，转轴减速停止
 *   - 固定压板通过上下两根导向杆与衔铁连接，保证衔铁只能轴向移动、不随转轴转动
 *
 * 电气：DC 线圈，直接读取端口直流电压（无需 RMS）
 *   - _useRLSeries 接入电路求解器（MNA 串联 RL 伴随模型）
 *   - 端口 a1(正)/a2(负)
 */
export class DiscElectromagneticBrake extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(540, config.width  || 600);
        this.height = Math.max(300, config.height || 320);

        this.type  = 'BRAKE';
        this.cache = 'fixed';
        this._useRLSeries = true;

        // 工作气隙（mm）——调节旋钮改变它，塞尺按它判断
        this._airGapMin = 0.3;
        this._airGapMax = 1.5;
        const rawGap = config.airGapMM !== undefined ? config.airGapMM : 0.8;
        this._airGapMM = Math.max(this._airGapMin, Math.min(this._airGapMax, rawGap));
        this._padWearMM = 0;   // 摩擦片磨损量（mm）：磨损时动衔铁带摩擦片右移，磁轭不动

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        this.config = {
            id: this.id,
            label:        this.label,
            coilVoltage:  this.coilVoltage,
            initState:    this._state,
            animDur:      this._animDur,
            coilResistance: this._coilResistance,
            pickupRatio:  this._pickupRatio,
            dropoutRatio: this._dropoutRatio,
            ratedCoilVoltage: this._ratedCoilVoltage,
            initialSpeed: this._initialSpeed,
            handSpinSpeed: this._handSpinSpeed,
            brakeTau:     this._brakeTau,
            freeTau:      this._freeTau,
            airGapMM:     this._airGapMM,
        };

        // ── 线圈端口（左侧边缘）──
        this.addPort(this._coilTermA1.x, this._coilTermA1.y, 'a1', 'wire', 'p');
        this.addPort(this._coilTermA2.x, this._coilTermA2.y, 'a2', 'wire');
    }

    // ═══════════════════════════════════════════
    // 几何尺寸计算
    // ═══════════════════════════════════════════

    _recalcGeometry() {
        const W = this.width, H = this.height;
        this._frame = { x: 2, y: 2, w: W - 4, h: H - 4, rx: 8 };
        this._termR = Math.max(3.5, W * 0.012);

        // ══ 电磁机构参数 ═════════════════════════
        const yokeW = 22;
        const yokeY = H * 0.20;
        const yokeH = H * 0.60;
        const legH  = H * 0.07;
        const legLen = W * 0.16;

        // ══ 动衔铁（竖条 + 右面摩擦片）══
        this._armW = 16;
        this._armH = H * 0.60;
        this._padW = 7;                // 摩擦片厚度

        // ══ 制动盘 / 固定压板（位置固定，与气隙无关）══
        this._diskR  = H * 0.19;
        this._diskCY = H / 2;
        this._padH = Math.min(this._armH * 0.62, this._diskR * 1.85);

        // ══ 工作气隙 → 衔铁行程（0.8mm 基准对应 18px）══
        const pxPerMM = 18 / 0.8;
        const padWearPx = this._padWearMM * pxPerMM;   // 摩擦片磨损使衔铁右移的量
        const workingGapPx = this._airGapMM * pxPerMM;
        this._airGapPx = workingGapPx;      // 当前气隙对应尺寸线长度(px)
        this._armOffsetMax = workingGapPx;  // 抱闸行程 = 工作气隙

        // 抱闸时摩擦片贴制动盘的位置固定不变。物理行为：
        //   · 摩擦片磨损 → 动衔铁带着摩擦片右移一点点，磁轭本身不动（气隙增大）；
        //   · 手动调小气隙 → 磁轭右移靠近衔铁（气隙减小）。
        // 磁轭基准 x=26 对应设定气隙 0.8mm；实际气隙 = 设定气隙 + 磨损量。
        const setGapMM = this._airGapMM - this._padWearMM;   // 磁轭位置对应气隙（已含磨损补偿）
        const armRestBase = 26 + yokeW + legLen + 18;        // 无磨损 0.8mm 时的抱闸位（衔铁左面）
        const armRestX = armRestBase + padWearPx;            // 抱闸时衔铁左面（磨损右移）
        this._armRestX = armRestX;
        this._armX = armRestX - workingGapPx;                // 吸合位置（贴铁心端面）
        const yokeX = 26 - (setGapMM - 0.8) * pxPerMM;       // 磁轭：设定气隙小→右移

        const padRightWhenBrake = armRestX + this._armW + this._padW;
        this._diskCX = padRightWhenBrake + this._diskR;

        this._plateR   = this._diskR + H * 0.055;
        this._plateCX  = this._diskCX + this._diskR + 2 + this._plateR;
        this._plateCY  = H / 2;

        // ══ 左侧电磁机构（磁轭随设定气隙平移，不随磨损移动）══
        this._yoke = { x: yokeX, y: yokeY, w: yokeW, h: yokeH };
        this._legs = [0, 1, 2].map(i => {
            const cy = i === 0 ? yokeY + legH / 2
                      : i === 1 ? yokeY + yokeH / 2
                      : yokeY + yokeH - legH / 2;
            return { x: yokeX + yokeW, y: cy - legH / 2, w: legLen, h: legH, isCenter: i === 1 };
        });

        this._coilRect = {
            x: this._legs[1].x - 3,
            y: this._legs[1].y - 10,
            w: this._legs[1].w + 6,
            h: this._legs[1].h + 20,
        };

        this._coilTermA1 = { x: 4, y: H * 0.32 };
        this._coilTermA2 = { x: 4, y: H * 0.68 };
        this._coilWireA1 = { x: this._coilRect.x + this._coilRect.w - 8, y: this._coilRect.y + 5 };
        this._coilWireA2 = { x: this._coilRect.x + 6, y: this._coilRect.y + this._coilRect.h - 5 };

        // ══ 转轴（制动盘中心向右）══════════════════
        this._shaftY  = this._diskCY;
        this._shaftX0 = this._diskCX;
        this._shaftX1 = W - 8;
        this._shaftSW = 9;

        // ══ 导向杆（上下各一，固定，穿过衔铁→压板）══
        this._rodY = [
            this._diskCY - (this._diskR + 8),
            this._diskCY + (this._diskR + 8),
        ];
        this._rodX0 = this._armX;      // 到动衔铁截止，不向左伸出
        this._rodX1 = this._plateCX;

        // ══ 螺旋弹簧（磁轭背面 → 动衔铁左面）══════════
        this._springY = [this._diskCY - this._armH * 0.22, this._diskCY + this._armH * 0.22];
        this._springAnchorX = this._yoke.x + this._yoke.w;  // 磁轭右缘（弹簧左端）
        this._springR = 7;              // 弹簧半径（大）
        this._springCoilCount = 7;      // 螺旋匝数

        // ══ 气隙调节旋钮（磁轭左侧，A1/A2 端子之间空白区）══
        this._knob = { cx: 17, cy: H * 0.50, r: Math.max(11, H * 0.045) };

        // ══ 状态文字位置（左下角空白区）════════════
        this._statusX = 10;
        this._statusY = H * 0.87;
    }

    // ═══════════════════════════════════════════
    // 参数初始化
    // ═══════════════════════════════════════════

    _initParameters(config) {
        this.label        = config.label        || 'YB';
        this.coilVoltage  = config.coilVoltage  || 'DC24V';
        this.function     = config.function     || '圆盘式电磁制动器';

        const s = (config.initState || 'off').toLowerCase();
        this._state = s === 'on' ? 'on' : 'off';

        this._animDur       = config.animDur !== undefined ? config.animDur : 0.18;
        this._animating     = false;
        this._animT         = 0;
        this._animFromOff   = 0;
        this._animToOff     = 0;
        this._animJustEnded = false;
        this._armOffsetCur  = this._state === 'on' ? 0 : this._armOffsetMax;

        this._coilEnergized = this._state === 'on';

        // ── 线圈电气参数（DC 直流，无需 RMS）──
        this._coilResistance    = config.coilResistance !== undefined ? config.coilResistance : 500;
        this._coilInductanceOpen  = config.coilInductanceOpen  !== undefined ? config.coilInductanceOpen  : 0.1;
        this._coilInductanceClosed = config.coilInductanceClosed !== undefined ? config.coilInductanceClosed : 2;
        this._pickupRatio   = config.pickupRatio   || 0.85;
        this._dropoutRatio  = config.dropoutRatio  || 0.70;
        this._ratedCoilVoltage = config.ratedCoilVoltage || 24;
        this._pickupVoltage   = this._ratedCoilVoltage * this._pickupRatio;
        this._dropoutVoltage  = this._ratedCoilVoltage * this._dropoutRatio;
        this._coilInductance  = this._state === 'on' ? this._coilInductanceClosed : this._coilInductanceOpen;
        this._coilPrevCurrent = 0;
        this._autoSense       = config.autoSense !== false;
        this._momentaryHeld   = false;

        // ── 直流电压平滑值（一阶低通防抖）──
        this._vSm = 0;

        // ── 转轴转动 ──
        this._initialSpeed = config.initialSpeed !== undefined ? config.initialSpeed : 0;   // rpm
        this._handSpinSpeed = config.handSpinSpeed !== undefined ? config.handSpinSpeed : 1200; // rpm
        this._brakeTau  = config.brakeTau !== undefined ? config.brakeTau : 0.12;  // 抱闸减速时间常数 s
        this._freeTau   = config.freeTau  !== undefined ? config.freeTau  : 25;     // 松闸自由转动阻尼 s
        this._omega = this._initialSpeed * 2 * Math.PI / 60;   // rad/s
        this._theta = 0;

        // ── 故障 ──
        this._faultStuck = false;
        this._faultCoilOpen = false;
        this._faultPadWear = false;      // 摩擦片磨损0.5mm（气隙由故障配置联动增大）
    }

    // ═══════════════════════════════════════════
    // 主初始化
    // ═══════════════════════════════════════════

    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
        this._addClickableParts();
        this._bindInteraction();
        this._updateDynamic();
    }

    /** 重建全部图形（配置更新 / 气隙调节后调用） */
    _rebuildAll() {
        this._recalcGeometry();
        this._staticGroup.destroyChildren();
        this._dynamicGroup.destroyChildren();
        this._interactGroup.destroyChildren();
        this._armOffsetCur = this._state === 'on' ? 0 : this._armOffsetMax;
        this._drawStaticParts();
        this._createDynamicNodes();
        this._addClickableParts();
        this._bindInteraction();
        this._updateDynamic();
        this._refreshCache();
    }

    /** 可识别部件（工作流 find 用）：气隙调节旋钮 */
    _addClickableParts() {
        const k = this._knob;
        this.addClickablePart('knob', k.cx - k.r, k.cy - k.r, k.r * 2, k.r * 2);
    }

    // ═══════════════════════════════════════════
    // 交互：拨动转轴
    // ═══════════════════════════════════════════

    _bindInteraction() {
        const y = this._shaftY;
        const hit = new Konva.Rect({
            x: this._shaftX0, y: y - 16,
            width: this._shaftX1 - this._shaftX0, height: 32,
            fill: 'transparent',
        });
        hit.on('click tap', (e) => {
            e.cancelBubble = true;
            this.handSpin(this._handSpinSpeed);
        });
        hit.on('mouseenter', () => { document.body.style.cursor = 'pointer'; });
        hit.on('mouseleave', () => { document.body.style.cursor = 'default'; });
        this._interactGroup.add(hit);

        this._bindKnob();
    }

    /** 气隙调节旋钮：滚轮 + 上下拖动（拖拽中仅原位刷新读数，松手后重建） */
    _bindKnob() {
        const k = this._knob;
        const step = 0.05;
        const clamp = (v) => Math.max(this._airGapMin, Math.min(this._airGapMax,
            Math.round(v / step) * step));

        const knobHit = new Konva.Circle({
            x: k.cx, y: k.cy, radius: k.r * 0.92,
            draggable: true, fill: 'transparent',
        });
        knobHit.on('wheel', (e) => {
            e.evt.preventDefault();
            e.evt.stopPropagation();
            const v = clamp(this._airGapMM + (e.evt.deltaY < 0 ? step : -step));
            setTimeout(() => this.setAirGap(v, true), 0);
        });
        const origX = k.cx, origY = k.cy;
        let dragY = 0, dragAccum = 0;
        knobHit.on('dragstart', (e) => {
            dragY = knobHit.getStage().getPointerPosition().y;
            dragAccum = 0;
            e.cancelBubble = true;
        });
        knobHit.on('dragmove', (e) => {
            e.cancelBubble = true;
            const curY = knobHit.getStage().getPointerPosition().y;
            const dy = dragY - curY;
            dragY = curY;
            dragAccum += dy;
            const s = Math.round(dragAccum / 10);
            if (s !== 0) {
                this.setAirGap(clamp(this._airGapMM + s * step), false);
                dragAccum -= s * 10;
            }
            knobHit.position({ x: origX, y: origY });
        });
        knobHit.on('dragend', (e) => {
            e.cancelBubble = true;
            knobHit.position({ x: origX, y: origY });
            setTimeout(() => this.setAirGap(this._airGapMM, true), 0);
        });
        knobHit.on('mouseenter', () => { document.body.style.cursor = 'pointer'; });
        knobHit.on('mouseleave', () => { document.body.style.cursor = 'default'; });
        this._interactGroup.add(knobHit);
    }

    // ═══════════════════════════════════════════
    // 静态部件
    // ═══════════════════════════════════════════

    _drawStaticParts() {
        this._drawFrame();
        this._drawStaticCore();
        this._drawCoilWindingAndWires();
        this._drawCoilTerminals();
        this._drawGuideRods();
        this._drawPlate();
        this._drawShaftBody();
        this._drawStaticLabels();
        this._drawKnobBody();
    }

    /** 气隙调节旋钮（磁轭左侧，固定于机座，指针在动态层） */
    _drawKnobBody() {
        const k = this._knob;
        const R = k.r;
        this._staticGroup.add(new Konva.Circle({
            x: k.cx, y: k.cy, radius: R,
            fillLinearGradientStartPoint: { x: -R, y: -R },
            fillLinearGradientEndPoint: { x: R, y: R },
            fillLinearGradientColorStops: [0, '#e8e8e8', 0.5, '#b8b8b8', 1, '#606060'],
            stroke: '#404040', strokeWidth: 1.2,
        }));
        // 滚花边缘
        const teeth = 14;
        for (let i = 0; i < teeth; i++) {
            const a = (i / teeth) * Math.PI * 2;
            this._staticGroup.add(new Konva.Line({
                points: [
                    k.cx + Math.cos(a) * (R - 0.5), k.cy + Math.sin(a) * (R - 0.5),
                    k.cx + Math.cos(a) * (R - 3.5), k.cy + Math.sin(a) * (R - 3.5),
                ],
                stroke: '#787878', strokeWidth: 1.4,
            }));
        }
        // 内圈指示环
        this._staticGroup.add(new Konva.Circle({
            x: k.cx, y: k.cy, radius: R * 0.72,
            fill: '#c8c8c8', stroke: '#909090', strokeWidth: 1,
        }));
        // 标签
        this._staticGroup.add(new Konva.Text({
            x: k.cx - 26, y: k.cy + R + 2, width: 52,
            text: '气隙\n调节', align: 'center',
            fontSize: 10, fill: '#505860', fontStyle: 'bold', listening: false,
        }));
    }

    _drawFrame() {
        const f = this._frame;
        this._staticGroup.add(new Konva.Rect({
            x: f.x, y: f.y, width: f.w, height: f.h,
            fill: '#eef1f8', stroke: '#b0a698', strokeWidth: 1.5, cornerRadius: f.rx,
        }));
        this._staticGroup.add(new Konva.Rect({
            x: f.x + 2, y: f.y + 2, width: f.w - 4, height: f.h * 0.06,
            fill: 'rgba(60,120,200,0.12)', cornerRadius: [f.rx, f.rx, 0, 0],
        }));
    }

    /** E 形静铁心（开口向右） */
    _drawStaticCore() {
        const { x: yx, y: yy, w: yw, h: yh } = this._yoke;
        this._staticGroup.add(new Konva.Rect({
            x: yx, y: yy, width: yw, height: yh,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint: { x: yw, y: 0 },
            fillLinearGradientColorStops: [0, '#3c4050', 0.5, '#5a6070', 1, '#3c4050'],
            stroke: '#282c3a', strokeWidth: 1,
        }));

        this._legs.forEach((leg, i) => {
            this._staticGroup.add(new Konva.Rect({
                x: leg.x, y: leg.y, width: leg.w, height: leg.h,
                fillLinearGradientStartPoint: { x: 0, y: 0 },
                fillLinearGradientEndPoint: { x: 0, y: leg.h },
                fillLinearGradientColorStops: [0, '#4a5060', 0.5, '#6a7080', 1, '#4a5060'],
                stroke: '#282c3a', strokeWidth: 0.8,
            }));
            for (let k = 0; k < 4; k++) {
                const ly = leg.y + leg.h * (k + 1) / 5;
                this._staticGroup.add(new Konva.Line({
                    points: [leg.x, ly, leg.x + leg.w, ly],
                    stroke: 'rgba(255,255,255,0.08)', strokeWidth: 0.8,
                }));
            }
        });
    }

    /** 线圈绕组 */
    _drawCoilWindingAndWires() {
        const cr = this._coilRect;
        this._staticGroup.add(new Konva.Line({
            points: [
                this._coilTermA1.x + 4, this._coilTermA1.y,
                this._coilWireA1.x, this._coilTermA1.y,
                this._coilWireA1.x, this._coilWireA1.y,
            ],
            stroke: '#e04040', strokeWidth: 4,
            lineCap: 'round', lineJoin: 'round',
        }));
        this._staticGroup.add(new Konva.Line({
            points: [
                this._coilTermA2.x + 4, this._coilTermA2.y,
                this._coilWireA2.x, this._coilTermA2.y,
                this._coilWireA2.x, this._coilWireA2.y,
            ],
            stroke: '#4080e0', strokeWidth: 4,
            lineCap: 'round', lineJoin: 'round',
        }));

        this._staticGroup.add(new Konva.Rect({
            x: cr.x, y: cr.y, width: cr.w, height: cr.h,
            fill: 'rgba(60,40,10,0.50)',
            stroke: '#705030', strokeWidth: 1.5, cornerRadius: 3,
        }));

        const turns = 10;
        const gap = 3;
        const loopW = (cr.w - 4 - gap * (turns - 1)) / turns;
        for (let i = 0; i < turns; i++) {
            const x0 = cr.x + 2 + i * (loopW + gap);
            const x1 = x0 + loopW;
            this._staticGroup.add(new Konva.Line({
                points: [
                    x0, cr.y + cr.h - 2,
                    x0, cr.y + 2,
                    x1, cr.y + 2,
                    x1, cr.y + cr.h - 2,
                ],
                closed: true,
                stroke: i % 2 === 0 ? '#daa520' : '#b8860b', strokeWidth: 2.5,
                lineCap: 'round', lineJoin: 'round', tension: 0.2,
            }));
        }
    }

    /** A1 / A2 接线端子 */
    _drawCoilTerminals() {
        const draw = (pos) => {
            const R = this._termR - 1;
            this._staticGroup.add(new Konva.Circle({
                x: pos.x + 2, y: pos.y, radius: R,
                fillLinearGradientStartPoint: { x: -R, y: -R },
                fillLinearGradientEndPoint: { x: R, y: R },
                fillLinearGradientColorStops: [0, '#7a6a30', 0.4, '#d4aa52', 0.7, '#e8c86a', 1, '#8a7030'],
                stroke: '#6a5a28', strokeWidth: 1.2,
            }));
            this._staticGroup.add(new Konva.Circle({
                x: pos.x + 2, y: pos.y, radius: R * 0.38,
                fill: '#2a1a08', stroke: '#5a4a20', strokeWidth: 0.6,
            }));
        };
        draw(this._coilTermA1);
        draw(this._coilTermA2);
        this._staticGroup.add(new Konva.Text({
            x: 10, y: this._coilTermA1.y - 16,
            text: 'A1', fontSize: 12, fill: '#c03030', fontStyle: 'bold',
        }));
        this._staticGroup.add(new Konva.Text({
            x: 10, y: this._coilTermA2.y + 8,
            text: 'A2', fontSize: 12, fill: '#3070c0', fontStyle: 'bold',
        }));
    }

    /** 上下导向杆（固定，衔铁沿其轴向滑动） */
    _drawGuideRods() {
        this._rodY.forEach(ry => {
            this._staticGroup.add(new Konva.Line({
                points: [this._rodX0, ry, this._rodX1, ry],
                stroke: '#8890a0', strokeWidth: 5, lineCap: 'round',
            }));
        });
    }

    /** 固定压板（大圆板，制动盘右侧，静止） */
    _drawPlate() {
        const R = this._plateR;
        this._staticGroup.add(new Konva.Circle({
            x: this._plateCX, y: this._plateCY, radius: R,
            fillLinearGradientStartPoint: { x: -R, y: -R },
            fillLinearGradientEndPoint: { x: R, y: R },
            fillLinearGradientColorStops: [0, '#b8bcc4', 0.5, '#8a8f9a', 1, '#5a5e68'],
            stroke: '#4a4e58', strokeWidth: 2,
        }));
        // 压板与制动盘之间的摩擦面环
        this._staticGroup.add(new Konva.Circle({
            x: this._plateCX, y: this._plateCY, radius: R - 6,
            fill: 'none', stroke: '#d8d4c8', strokeWidth: 2, dash: [4, 3],
        }));
        this._staticGroup.add(new Konva.Text({
            x: this._plateCX - R, y: this._plateCY + R + 2,
            width: R * 2, text: '固定压板', align: 'center',
            fontSize: 12, fill: '#5a5e68', fontStyle: 'bold',
        }));
    }

    /** 转轴本体（渐变圆柱，表面斜纹由动态层滚动） */
    _drawShaftBody() {
        const sw = this._shaftSW;
        const x0 = this._shaftX0, x1 = this._shaftX1, y = this._shaftY;
        this._staticGroup.add(new Konva.Rect({
            x: x0, y: y - sw / 2, width: x1 - x0, height: sw,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint: { x: 0, y: sw },
            fillLinearGradientColorStops: [0, '#60a0d0', 0.5, '#90c8f0', 1, '#5090c0'],
            stroke: '#3078a0', strokeWidth: 0.8, cornerRadius: 3,
        }));
        // 轴端帽
        this._staticGroup.add(new Konva.Circle({
            x: x1, y, radius: sw / 2 + 1,
            fill: '#c0c8d0', stroke: '#8090a0', strokeWidth: 1,
        }));
        this._staticGroup.add(new Konva.Circle({
            x: x1, y, radius: sw / 2 - 2,
            fill: '#e8ecef', stroke: '#a0a8b0', strokeWidth: 0.8,
        }));
    }

    _drawStaticLabels() {
        const fs = Math.max(12, this.width * 0.02);
        this._staticGroup.add(new Konva.Text({
            x: this._yoke.x, y: this._yoke.y - 24,
            text: this.label, fontSize: fs, fontStyle: 'bold', fill: '#303848',
        }));
        this._staticGroup.add(new Konva.Text({
            x: this._diskCX - this._diskR, y: this._diskCY + this._diskR + 14,
            width: this._diskR * 2, text: '制动盘', align: 'center',
            fontSize: 12, fill: '#3868a0', fontStyle: 'bold',
        }));
    }

    // ═══════════════════════════════════════════
    // 动态层
    // ═══════════════════════════════════════════

    _createDynamicNodes() {
        this._createArmature();
        this._createSprings();
        this._createDisk();
        this._createShaftStripes();
        this._createStatus();
        this._createAirGapMark();
        this._createKnobDynamic();
    }

    /** 气隙旋钮动态部分：指针 + 数值读数（随气隙原位更新） */
    _createKnobDynamic() {
        const k = this._knob;
        this._knobPointer = new Konva.Line({
            x: k.cx, y: k.cy,
            points: [0, -k.r * 0.15, 0, -k.r * 0.82],
            stroke: '#d03030', strokeWidth: 2.4, lineCap: 'round', listening: false,
        });
        this._dynamicGroup.add(this._knobPointer);
        this._dynamicGroup.add(new Konva.Circle({
            x: k.cx, y: k.cy, radius: Math.max(2.5, k.r * 0.18),
            fill: '#303030', listening: false,
        }));
        this._knobReadout = new Konva.Text({
            x: k.cx - 20, y: k.cy + k.r + 12, width: 40, align: 'center',
            text: '0.80', fontSize: 12, fontStyle: 'bold', fill: '#d03030', listening: false,
        });
        this._updateKnobVisual();
    }

    /** 旋钮指针角度：气隙 0.3→1.5mm 映射到 -60°~+60° */
    _knobAngleFor(mm) {
        const span = this._airGapMax - this._airGapMin;
        return (mm - this._airGapMin) / span * 120 - 60;
    }

    _updateKnobVisual() {
        if (this._knobPointer) this._knobPointer.rotation(this._knobAngleFor(this._airGapMM));
    }

    /** 动衔铁（竖条 + 右面摩擦片 + 上下导向套筒） */
    _createArmature() {
        const off = this._armOffsetCur;
        const cy = this._diskCY;
        const armX = this._armX + off;

        this._armGroup = new Konva.Group({ x: 0, listening: false });

        // 衔铁竖条
        this._armBar = new Konva.Rect({
            x: armX, y: cy - this._armH / 2,
            width: this._armW, height: this._armH,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint: { x: this._armW, y: 0 },
            fillLinearGradientColorStops: [0, '#404858', 0.4, '#606878', 0.8, '#6a7080', 1, '#404858'],
            stroke: '#282c3a', strokeWidth: 0.8,
        });
        this._armGroup.add(this._armBar);

        // 吸合端面高光
        this._armGlow = new Konva.Rect({
            x: armX, y: cy - this._armH / 2,
            width: 2, height: this._armH,
            fill: 'rgba(120,180,255,0.25)', visible: false,
        });
        this._armGroup.add(this._armGlow);

        // 摩擦片（衔铁右面，棕红）
        this._pad = new Konva.Rect({
            x: armX + this._armW, y: cy - this._padH / 2,
            width: this._padW, height: this._padH,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint: { x: this._padW, y: 0 },
            fillLinearGradientColorStops: [0, '#7a3a20', 0.5, '#a85030', 1, '#6a2c14'],
            stroke: '#4a1c0c', strokeWidth: 0.8,
            cornerRadius: 2,
        });
        this._armGroup.add(this._pad);

        // 上下导向套筒（套在导向杆上，随衔铁移动）
        this._rodY.forEach(ry => {
            const sleeveH = 9;
            this._armGroup.add(new Konva.Rect({
                x: armX + 1, y: ry - sleeveH / 2,
                width: this._armW + this._padW - 2, height: sleeveH,
                fill: '#c8ccd4', stroke: '#8890a0', strokeWidth: 1, cornerRadius: 3,
            }));
        });

        this._dynamicGroup.add(this._armGroup);
    }

    /** 螺旋复位弹簧（磁轭背面 → 动衔铁左面，吸合压缩 / 释放伸长） */
    _createSprings() {
        this._springGroups = [];
        this._springY.forEach(sy => {
            const g = new Konva.Group({ listening: false });
            const r = this._springR;
            const anchorX = this._springAnchorX;
            const dx = Math.max(r * 2 + 6, (this._armX + this._armOffsetCur) - anchorX);
            const spacing = (dx - r * 2) / (this._springCoilCount - 1);
            const coils = [];
            for (let i = 0; i < this._springCoilCount; i++) {
                const c = new Konva.Circle({
                    x: anchorX + r + i * spacing, y: sy, radius: r,
                    fill: 'rgba(235,240,248,0.9)', stroke: '#8090b0', strokeWidth: 2.4,
                });
                g.add(c);
                coils.push(c);
            }
            const lastX = anchorX + r + (this._springCoilCount - 1) * spacing;
            const ll = new Konva.Line({ points: [anchorX, sy, anchorX + r, sy], stroke: '#8090b0', strokeWidth: 2.4 });
            const rl = new Konva.Line({ points: [lastX + r, sy, this._armX + this._armOffsetCur, sy], stroke: '#8090b0', strokeWidth: 2.4 });
            g._coils = coils; g._leftLine = ll; g._rightLine = rl; g._y = sy;
            g.add(ll); g.add(rl);
            this._dynamicGroup.add(g);
            this._springGroups.push(g);
        });
    }

    /** 制动盘（圆盘 + 径向扇区，旋转动画） */
    _createDisk() {
        const R = this._diskR;
        this._diskGroup = new Konva.Group({
            x: this._diskCX, y: this._diskCY, listening: false,
        });

        // 盘体
        this._diskGroup.add(new Konva.Circle({
            radius: R,
            fillLinearGradientStartPoint: { x: -R, y: -R },
            fillLinearGradientEndPoint: { x: R, y: R },
            fillLinearGradientColorStops: [0, '#d8b060', 0.5, '#b89038', 1, '#8a6a28'],
            stroke: '#6a5220', strokeWidth: 2,
        }));
        // 轮毂
        this._diskGroup.add(new Konva.Circle({
            radius: R * 0.22,
            fill: '#a0a8b0', stroke: '#707880', strokeWidth: 1.5,
        }));
        // 径向扇区标记（4 段）
        for (let k = 0; k < 4; k++) {
            this._diskGroup.add(new Konva.Wedge({
                x: 0, y: 0, radius: R * 0.96,
                angle: 28, rotation: k * 90 + 20,
                fill: 'rgba(255,255,255,0.28)', stroke: 'rgba(120,90,30,0.4)', strokeWidth: 1,
            }));
        }
        // 边缘刻度
        for (let k = 0; k < 24; k++) {
            const a = (k / 24) * Math.PI * 2;
            this._diskGroup.add(new Konva.Line({
                points: [
                    Math.cos(a) * (R - 3), Math.sin(a) * (R - 3),
                    Math.cos(a) * (R - 6), Math.sin(a) * (R - 6),
                ],
                stroke: '#8a6a28', strokeWidth: 1,
            }));
        }

        this._diskGroup.rotation((this._theta * 180 / Math.PI) % 360);
        this._dynamicGroup.add(this._diskGroup);
    }

    /** 转轴表面斜纹（随转速沿 x 滚动，模拟旋转） */
    _createShaftStripes() {
        const sw = this._shaftSW;
        const y = this._shaftY;
        const span = this._shaftX1 - this._shaftX0;
        this._stripeGroup = new Konva.Group({ listening: false });
        this._stripes = [];
        const count = 8;
        const period = span / count;
        for (let i = 0; i < count; i++) {
            const baseX = i * period;
            const line = new Konva.Line({
                points: [baseX, y - sw / 2, baseX + 4, y + sw / 2],
                stroke: 'rgba(20,60,90,0.55)', strokeWidth: 2, lineCap: 'round',
            });
            this._stripeGroup.add(line);
            this._stripes.push({ line, period, baseX });
        }
        this._stripeGroup.x(this._shaftX0);
        this._dynamicGroup.add(this._stripeGroup);
    }

    /** 状态文字 + 通电指示灯 */
    _createStatus() {
        const fs  = Math.max(13, this.width * 0.02);
        const lh  = fs + 6;
        const x   = this._statusX, y = this._statusY;

        this._led = new Konva.Circle({
            x: x + 4, y: y + lh * 0.35, radius: 6,
            fill: this._state === 'on' ? '#20ee30' : '#184020',
            stroke: '#304830', strokeWidth: 1, listening: false,
        });
        this._dynamicGroup.add(this._led);

        const tx = x + 18;
        this._statusTexts = {
            state: new Konva.Text({ x: tx, y, fontSize: fs, fontStyle: 'bold', fill: '#303848', listening: false }),
            speed: new Konva.Text({ x: tx, y: y + lh, fontSize: fs, fontStyle: 'bold', fill: '#d03030', listening: false }),
        };
        Object.values(this._statusTexts).forEach(t => this._dynamicGroup.add(t));
    }

    /** 工作气隙标注（动态：吸合消失 / 抱闸显示；标在磁轭上腿端面与衔铁上端之间的间隙） */
    _createAirGapMark() {
        this._airGapY = this._yoke.y + this._legs[0].h / 2;   // 磁轭最上铁芯柱（上腿）中心高度
        this._airGapGroup = new Konva.Group({ listening: false });
        this._airGapBg = new Konva.Rect({ fill: 'rgba(255,255,255,0.78)', cornerRadius: 2, listening: false });
        this._airGapLine = new Konva.Line({ points: [], stroke: '#e04040', strokeWidth: 1.6 });
        this._airGapBar0 = new Konva.Line({ points: [], stroke: '#e04040', strokeWidth: 1.2 });
        this._airGapBar1 = new Konva.Line({ points: [], stroke: '#e04040', strokeWidth: 1.2 });
        this._airGapText = new Konva.Text({
            text: '工作气隙 ' + this._airGapMM.toFixed(2) + 'mm', fontSize: 15, fontStyle: 'bold', fill: '#c03030',
        });
        [this._airGapBg, this._airGapLine, this._airGapBar0, this._airGapBar1, this._airGapText]
            .forEach(n => this._airGapGroup.add(n));
        this._dynamicGroup.add(this._airGapGroup);
    }

    // ═══════════════════════════════════════════
    // 动态更新（in-place）
    // ═══════════════════════════════════════════

    _updateDynamic() {
        const off = this._armOffsetCur;
        const armX = this._armX + off;
        const ratio = 1 - off / this._armOffsetMax; // 1=吸合(松闸), 0=抱闸

        // 1) 衔铁 + 摩擦片 + 套筒
        if (this._armBar) this._armBar.x(armX);
        if (this._pad) this._pad.x(armX + this._armW);
        if (this._armGlow) {
            this._armGlow.x(armX);
            this._armGlow.visible(ratio > 0.95);
        }
        if (this._armGroup) {
            this._armGroup.children.forEach(ch => {
                if (ch === this._armBar || ch === this._pad || ch === this._armGlow) return;
                ch.x(armX + 1);
            });
        }

        // 2) 螺旋弹簧（右端随衔铁移动，吸合压缩 / 抱闸展开）
        const anchorX = this._springAnchorX;
        this._springGroups.forEach(sg => {
            const r = this._springR;
            const dx = Math.max(r * 2 + 6, armX - anchorX);
            const spacing = (dx - r * 2) / (this._springCoilCount - 1);
            sg._coils.forEach((c, i) => c.x(anchorX + r + i * spacing));
            const lastX = anchorX + r + (this._springCoilCount - 1) * spacing;
            sg._leftLine.points([anchorX, sg._y, anchorX + r, sg._y]);
            sg._rightLine.points([lastX + r, sg._y, armX, sg._y]);
            const sc = ratio > 0.5 ? '#d04830' : '#8090b0';
            sg._coils.forEach(c => c.stroke(sc));
            sg._leftLine.stroke(sc); sg._rightLine.stroke(sc);
        });

        // 2.5) 工作气隙标注（吸合时气隙为 0 隐藏，抱闸时显示；
        //      尺寸线在上腿端面与衔铁之间的间隙处，文字紧贴其上方）
        if (this._airGapGroup) {
            const gx0 = this._legs[0].x + this._legs[0].w;   // 铁心上腿端面
            const gx1 = armX;                                // 衔铁左面
            const yGap = this._airGapY;
            const mid = (gx0 + gx1) / 2;
            const show = (gx1 - gx0) > 2;
            this._airGapLine.points([gx0, yGap, gx1, yGap]);
            this._airGapBar0.points([gx0, yGap, gx0, yGap + 6]);
            this._airGapBar1.points([gx1, yGap, gx1, yGap + 6]);
            const tx = mid - this._airGapText.width() / 2;
            const ty = this._yoke.y - this._airGapText.height() - 5;   // 文字完全在磁轭上方，不遮磁轭
            this._airGapText.x(tx); this._airGapText.y(ty);
            if (this._airGapBg) {
                this._airGapBg.x(tx - 2); this._airGapBg.y(ty - 2);
                this._airGapBg.width(this._airGapText.width() + 4);
                this._airGapBg.height(this._airGapText.height() + 4);
            }
            [this._airGapLine, this._airGapBar0, this._airGapBar1, this._airGapText]
                .forEach(n => n.visible(show));
            if (this._airGapBg) this._airGapBg.visible(show);
        }

        // 3) 制动盘旋转
        const deg = (this._theta * 180 / Math.PI) % 360;
        if (this._diskGroup) this._diskGroup.rotation(deg);

        // 4) 转轴斜纹滚动（沿 x 循环）
        if (this._stripeGroup) {
            const span = this._shaftX1 - this._shaftX0;
            const roll = ((this._theta * span / (2 * Math.PI)) % span + span) % span;
            this._stripes.forEach(s => {
                let px = s.baseX + roll;
                if (px > span) px -= span;
                s.line.x(px);
            });
        }

        // 5) LED + 状态文字
        const energized = this._state === 'on';
        if (this._led) this._led.fill(energized ? '#20ee30' : (ratio > 0.3 ? '#10a018' : '#184020'));
        const st = this._statusTexts;
        if (st.state) st.state.text(energized ? '线圈通电-松闸' : '线圈断电-抱闸');
        if (st.speed) {
            const n = Math.abs(this._omega) * 60 / (2 * Math.PI);
            st.speed.text(`转速 ${n.toFixed(0)} r/min`);
        }

        // 6) 气隙旋钮指针与读数
        this._updateKnobVisual();
    }

    // ═══════════════════════════════════════════
    // tick
    // ═══════════════════════════════════════════

    tick(dt) {
        // 1) 直流电压检测（直接读取端口直流电压，无需 RMS）
        if (this._autoSense && this.sys.getVoltageBetween && !this._momentaryHeld) {
            const vRaw = this.sys.getVoltageBetween(`${this.id}_wire_a1`, `${this.id}_wire_a2`);
            if (vRaw !== undefined && isFinite(vRaw)) {
                this._vSm = this._vSm * 0.7 + vRaw * 0.3;
            }
            if (!this._animating) {
                if (this._state === 'off' && this._vSm >= this._pickupVoltage && !this._faultCoilOpen) {
                    this.energize();
                } else if (this._state === 'on' && this._vSm <= this._dropoutVoltage) {
                    this.deenergize();
                }
            }
            this._coilInductance = this._state === 'on' ? this._coilInductanceClosed : this._coilInductanceOpen;
        }

        if (this._faultCoilOpen && this._state === 'on' && !this._momentaryHeld) {
            this.deenergize();
        }

        this._tickAnimation(dt);

        // 2) 转动动力学
        if (this._state === 'off') {
            this._omega *= Math.exp(-dt / this._brakeTau);
            if (Math.abs(this._omega) < 0.05) this._omega = 0;
        } else {
            this._omega *= Math.exp(-dt / this._freeTau);
        }
        this._theta += this._omega * dt;

        const needUpdate = this._animating || this._animJustEnded
            || Math.abs(this._omega) > 0.01 || this._state === 'on';

        if (needUpdate) {
            this._animJustEnded = false;
            this._updateDynamic();
            if (this.sys && typeof this.sys.requestRedraw === 'function') this.sys.requestRedraw();
        }
    }

    _tickAnimation(dt) {
        if (!this._animating) return;
        this._animT += dt / this._animDur;
        if (this._animT >= 1) {
            this._animT = 1;
            this._animating = false;
            this._animJustEnded = true;
            this._armOffsetCur = this._animToOff;
            return;
        }
        const ease = 0.5 - 0.5 * Math.cos(this._animT * Math.PI);
        this._armOffsetCur = this._animFromOff + (this._animToOff - this._animFromOff) * ease;
    }

    _startAnim(toState) {
        this._animFromOff   = this._armOffsetCur;
        this._animToOff     = toState === 'on' ? 0 : this._armOffsetMax;
        this._animT         = 0;
        this._animating     = true;
        this._state         = toState;
        this._coilEnergized = toState === 'on';
    }

    // ═══════════════════════════════════════════
    // 公开 API
    // ═══════════════════════════════════════════

    /** 松闸（通电吸合，衔铁远离制动盘） */
    energize() {
        if (this._faultStuck || this._animating || this._state === 'on') return;
        this._animDur = this.config.animDur || 0.18;
        this._startAnim('on');
    }

    /** 抱闸（断电，弹簧推衔铁压紧制动盘） */
    deenergize() {
        if (this._faultStuck || this._animating || this._state === 'off') return;
        this._animDur = (this.config.animDur || 0.18) * 0.85;
        this._startAnim('off');
    }

    /** 拨动转轴：设置角速度（rad/s） */
    spin(omega) {
        this._omega = omega;
    }

    /** 手动拨动转速设置（rpm） */
    handSpin(rpm) {
        this._omega = rpm * 2 * Math.PI / 60;
    }

    getState()    { return this._state; }
    isBraking()   { return this._state === 'off'; }
    isEnergized() { return this._state === 'on'; }
    getOmega()    { return this._omega; }
    getSpeed()    { return Math.abs(this._omega) * 60 / (2 * Math.PI); }

    /** 读取当前工作气隙（mm） */
    getAirGap() { return this._airGapMM; }

    /**
     * 设置工作气隙（mm，范围 [0.3, 1.5]）
     * @param {number} mm
     * @param {boolean} [rebuild=true] 是否立即重建图形（拖动中传 false 原位刷新）
     */
    setAirGap(mm, rebuild = true) {
        const v = Math.max(this._airGapMin, Math.min(this._airGapMax, mm));
        if (rebuild && Math.abs(v - this._airGapMM) < 0.001) return;
        this._airGapMM = v;
        if (rebuild) {
            this._rebuildAll();
        } else {
            if (this._airGapText) this._airGapText.text('工作气隙 ' + this._airGapMM.toFixed(2) + 'mm');
            this._updateKnobVisual();
        }
        if (this.sys && typeof this.sys.requestRedraw === 'function') this.sys.requestRedraw();
    }

    /** 读取摩擦片磨损量（mm） */
    getPadWear() { return this._padWearMM; }

    /**
     * 设置摩擦片磨损量（mm）：磨损使动衔铁带摩擦片右移、气隙自动增大，磁轭不动
     * @param {number} mm
     */
    setPadWear(mm) {
        const v = Math.max(0, mm || 0);
        if (Math.abs(v - this._padWearMM) < 0.001) return;
        const delta = v - this._padWearMM;
        this._padWearMM = v;
        // 磨损/修复时工作气隙同步增大/减小（保持设定气隙对应的磁轭位置不变）
        this._airGapMM = Math.max(this._airGapMin, Math.min(this._airGapMax, this._airGapMM + delta));
        this._rebuildAll();
        if (this.sys && typeof this.sys.requestRedraw === 'function') this.sys.requestRedraw();
    }

    update(state) {
        const v = String(state).toLowerCase();
        if (v === 'on'  || v === '1') this.energize();
        if (v === 'off' || v === '0') this.deenergize();
    }

    getConfigFields() {
        return [
            { label: '位号/名称',          key: 'label',        type: 'text'   },
            { label: '线圈电压规格',        key: 'coilVoltage',  type: 'text'   },
            { label: '初始状态 on/off',     key: 'initState',    type: 'text'   },
            { label: '动作时间 (s)',        key: 'animDur',      type: 'number' },
            { label: '线圈电阻 (Ω)',        key: 'coilResistance', type: 'number' },
            { label: '线圈额定电压 (V)',    key: 'ratedCoilVoltage', type: 'number' },
            { label: '吸合电压比',          key: 'pickupRatio',  type: 'number' },
            { label: '释放电压比',          key: 'dropoutRatio', type: 'number' },
            { label: '初始转速 (r/min)',    key: 'initialSpeed', type: 'number' },
            { label: '手动拨动转速 (r/min)', key: 'handSpinSpeed', type: 'number' },
            { label: '抱闸减速时间常数 (s)', key: 'brakeTau',     type: 'number' },
            { label: '松闸自由阻尼时间 (s)', key: 'freeTau',      type: 'number' },
            { label: '工作气隙 (mm)',        key: 'airGapMM',     type: 'number', min: 0.3, max: 1.5, step: 0.05 },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label        !== undefined) this.label        = cfg.label;
        if (cfg.coilVoltage  !== undefined) this.coilVoltage  = cfg.coilVoltage;
        if (cfg.animDur      !== undefined) this._animDur     = parseFloat(cfg.animDur);
        if (cfg.coilResistance !== undefined) this._coilResistance = parseFloat(cfg.coilResistance);
        if (cfg.pickupRatio    !== undefined) { this._pickupRatio = parseFloat(cfg.pickupRatio); this._pickupVoltage = this._ratedCoilVoltage * this._pickupRatio; }
        if (cfg.dropoutRatio   !== undefined) { this._dropoutRatio = parseFloat(cfg.dropoutRatio); this._dropoutVoltage = this._ratedCoilVoltage * this._dropoutRatio; }
        if (cfg.ratedCoilVoltage !== undefined) { this._ratedCoilVoltage = parseFloat(cfg.ratedCoilVoltage); this._pickupVoltage = this._ratedCoilVoltage * this._pickupRatio; this._dropoutVoltage = this._ratedCoilVoltage * this._dropoutRatio; }
        if (cfg.initialSpeed !== undefined) { this._initialSpeed = parseFloat(cfg.initialSpeed); this._omega = this._initialSpeed * 2 * Math.PI / 60; }
        if (cfg.handSpinSpeed !== undefined) this._handSpinSpeed = parseFloat(cfg.handSpinSpeed);
        if (cfg.brakeTau !== undefined) this._brakeTau = parseFloat(cfg.brakeTau);
        if (cfg.freeTau  !== undefined) this._freeTau  = parseFloat(cfg.freeTau);
        if (cfg.airGapMM !== undefined) {
            const g = parseFloat(cfg.airGapMM);
            this._airGapMM = Math.max(this._airGapMin, Math.min(this._airGapMax, g));
        }
        if (cfg.initState !== undefined) {
            const want = cfg.initState.toLowerCase();
            if (want === 'on' && this._state !== 'on' && !this._faultCoilOpen) this.energize();
            if (want === 'off' && this._state !== 'off') this.deenergize();
        }
        this.config = { ...this.config, ...cfg };
        this._rebuildAll();
    }

    destroy() { super.destroy?.(); }
}
