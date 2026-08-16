import { BaseComponent } from './BaseComponent.js';

export class ThreePhaseContactor extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(400, config.width  || 520);
        this.height = Math.max(260, config.height || 320);

        this.type    = 'CONTACTOR';
        this.special = '3P-CONTACTOR';
        this.cache   = 'fixed';
        this._useRLSeries = true;

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        this.config = {
            id: this.id,
            label:        this.label,
            coilVoltage:  this.coilVoltage,
            ratedCurrent: this.ratedCurrent,
            initState:    this._state,
            animDur:      this._animDur,
            coilResistance: this._coilResistance,
            pickupRatio:    this._pickupRatio,
            dropoutRatio:   this._dropoutRatio,
            ratedCoilVoltage: this._ratedCoilVoltage,
        };

        // ── 7 组触点的顶部端口 ──
        const topPorts = ['no1a','nc1a','l1','l2','l3','nc2a','no2a'];
        const botPorts = ['no1b','nc1b','t1','t2','t3','nc2b','no2b'];
        this._contactSlots.forEach((s, i) => {
            this.addPort(s.cx, 2, topPorts[i], 'wire');
            this.addPort(s.cx, this.height - 2, botPorts[i], 'wire', 'p');
        });
        // 线圈端口（左侧边缘）
        this.addPort(this._coilTermA1.x, this._coilTermA1.y, 'a1', 'wire');
        this.addPort(this._coilTermA2.x, this._coilTermA2.y, 'a2', 'wire', 'p');
    }

    // ═══════════════════════════════════════════
    // 几何尺寸计算
    // ═══════════════════════════════════════════

    _recalcGeometry() {
        const W = this.width, H = this.height;
        this._divX = W * 0.38;
        this._frame = { x: 2, y: 2, w: W - 4, h: H - 4, rx: 6 };
        this._termR = Math.max(3.5, W * 0.012);

        const fs = Math.max(9, W * 0.018);

        // ══ 左侧：电磁机构 ════════════════════════
        const LP = 8;
        const LW = this._divX - LP * 2;
        const LCX = LP + LW / 2;

        // A1/A2 接线端子（左侧边缘，垂直排列）
        this._coilTermA1 = { x: 4, y: H * 0.28 };
        this._coilTermA2 = { x: 4, y: H * 0.72 };

        // E 形静铁心：竖轭在左，3 条水平腿向右
        const magTop  = LP + 30;
        const magBot  = H - LP - 16;
        const magH    = magBot - magTop;

        // 磁轭（垂直背铁）—— 加粗
        const yokeW = 22;
        const yokeX = 24;

        // 3 条水平腿（上 / 中 / 下）—— 加粗，去掉两头多余部分
        const legH = 18;
        const legLen = 76;
        const legEndX = yokeX + yokeW + legLen;

        const legPositions = [
            magTop + legH / 2,
            magTop + magH * 0.50,
            magBot - legH / 2,
        ];

        this._yoke = { x: yokeX, y: magTop, w: yokeW, h: magH };
        this._legs = legPositions.map((cy, i) => ({
            x: yokeX + yokeW,
            y: cy - legH / 2,
            w: legLen,
            h: legH,
            isCenter: i === 1,
        }));

        // 线圈绕组（包围中心腿）
        this._coilRect = {
            x: this._legs[1].x - 3,
            y: this._legs[1].y - 10,
            w: this._legs[1].w + 6,
            h: this._legs[1].h + 20,
        };

        // 从 A1/A2 到线圈的引线拐点（A1→右端，A2→左端）
        this._coilWireA1 = { x: this._coilRect.x + this._coilRect.w - 8, y: this._coilRect.y + 5 };
        this._coilWireA2 = { x: this._coilRect.x + 6, y: this._coilRect.y + this._coilRect.h - 5 };

        // 气隙 + 动铁芯
        this._airGapMax = 14;
        this._armW = 18;
        this._armH = magH - 8;
        this._armX = legEndX;

        this._armOffsetMax = this._airGapMax;
        this._armOffsetCur = this._state === 'on' ? 0 : this._armOffsetMax;

        // 弹簧（动铁芯右上/右下 → 分隔线右侧，吸合时拉伸可见）
        this._springTopY = magTop + 6;
        this._springBotY = magBot - 6;
        this._springAnchorRight = Math.floor(this._divX + 8);

        // 可动轴（从动铁芯中心水平向右延伸到右边界）—— 加粗
        this._shaftY = magTop + magH / 2;
        this._shaftLen = W - this._divX - 10;

        // ══ 右侧：7 组触点 ════════════════════════
        const RP = 10;
        const RX = this._divX + RP;
        const RW = W - this._divX - RP * 2;

        const slotCount = 7;
        const slotW = RW / slotCount;
        this._contactSlots = [];
        for (let i = 0; i < slotCount; i++) {
            const cx = RX + (i + 0.5) * slotW;
            const isNC = (i === 1 || i === 5);
            const isMain = (i >= 2 && i <= 4);
            // 主触点 spanW 更大（接触面积大）
            const spanW = isMain ? Math.max(8, slotW * 0.56) : Math.max(3, slotW * 0.14);
            const colors = ['#01250a','#818103','#e03030','#20a030','#2050e0','#707d3f','#084817'];
            const labels = ['13-14','31-32','L1/T1','L2/T2','L3/T3','41-42','23-24'];
            this._contactSlots.push({
                cx,
                isNC,
                isMain,
                color: colors[i],
                label: labels[i],
                spanW,
                dotR: isMain ? 4.5 : 3.5,
            });
        }

        // 触桥参数
        this._bridgeOpenDX = 20;
        this._closedGap = -8;

        // 导线线宽
        this._wireSW    = 3.5;
        this._coilWireSW = 4;
        this._shaftSW   = 5;
        this._springSW  = 3.5;
    }

    // ═══════════════════════════════════════════
    // 参数初始化
    // ═══════════════════════════════════════════

    _initParameters(config) {
        this.label        = config.label        || 'KM';
        this.coilVoltage  = config.coilVoltage  || '220VAC';
        this.ratedCurrent = config.ratedCurrent !== undefined ? config.ratedCurrent : 9;
        this.function     = config.function     || '三相交流接触器';

        const s = (config.initState || 'off').toLowerCase();
        this._state = s === 'on' ? 'on' : 'off';

        this._animDur       = config.animDur !== undefined ? config.animDur : 0.12;
        this._animating     = false;
        this._animT         = 0;
        this._animFromOff   = 0;
        this._animToOff     = 0;
        this._armOffsetCur  = this._state === 'on' ? 0 : this._armOffsetMax;

        this._coilEnergized = this._state === 'on';
        this._arcFrames = 0;
        this.opsCount = config.initOps || 0;

        this._coilResistance    = config.coilResistance !== undefined ? config.coilResistance : 1000;
        this._coilInductanceOpen  = config.coilInductanceOpen  !== undefined ? config.coilInductanceOpen : 0.5;
        this._coilInductanceClosed = config.coilInductanceClosed !== undefined ? config.coilInductanceClosed : 15;
        this._pickupRatio   = config.pickupRatio   || 0.85;
        this._dropoutRatio  = config.dropoutRatio  || 0.70;
        this._ratedCoilVoltage = config.ratedCoilVoltage || 220;
        this._pickupVoltage   = this._ratedCoilVoltage * this._pickupRatio;
        this._dropoutVoltage  = this._ratedCoilVoltage * this._dropoutRatio;
        this._coilInductance  = this._state === 'on' ? this._coilInductanceClosed : this._coilInductanceOpen;
        this._coilPrevCurrent = 0;
        this._autoSense       = config.autoSense !== false;

        this._vBuf = new Array(40).fill(0);
        this._vBufIdx = 0;
        this._vBufCount = 0;
        this._momentaryHeld = false;
        this._faultStuck = false;
        this._faultCoilOpen = false;
        this._faultContactL1T1 = false;
        this._faultContactNO1 = false;
        this._faultShadingRing = false;
        this._vBufSum = 0;
        this._vRms = 0;
    }

    // ═══════════════════════════════════════════
    // 主初始化
    // ═══════════════════════════════════════════

    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindMomentaryPress();
    }

    // ═══════════════════════════════════════════
    // 瞬态按压交互
    // ═══════════════════════════════════════════

    _bindMomentaryPress() {
        const hit = new Konva.Rect({
            x: this._frame.x + 2, y: this._frame.y + 2,
            width: this._divX - 4, height: this._frame.h - 4,
            fill: 'transparent',
        });

        const doRelease = () => {
            if (!this._momentaryHeld) return;
            this._momentaryHeld = false;
            this._animating = false;
            this.deenergize();
            window.removeEventListener('mouseup', doRelease);
            window.removeEventListener('touchend', doRelease);
        };

        hit.on('mousedown touchstart', (e) => {
            e.cancelBubble = true;
            if (this._momentaryHeld || this._faultStuck) return;
            this._momentaryHeld = true;
            this._animating = false;
            this.energize();
            window.addEventListener('mouseup', doRelease);
            window.addEventListener('touchend', doRelease);
        });

        hit.on('mouseenter', () => { document.body.style.cursor = 'pointer'; });
        hit.on('mouseleave', () => {
            document.body.style.cursor = 'default';
            doRelease();
        });

        this._interactGroup.add(hit);
    }

    // ═══════════════════════════════════════════
    // 静态部件
    // ═══════════════════════════════════════════

    _drawStaticParts() {
        this._drawFrame();
        this._drawDivider();
        this._drawStaticCore();
        this._drawCoilWindingAndWires();
        this._drawCoilTerminals();
        this._drawSchematicStatic();
        this._drawPanelLabel();
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
        // 左面板浅色背景
        this._staticGroup.add(new Konva.Rect({
            x: f.x + 2, y: f.y + 2,
            width: this._divX - f.x - 2, height: f.h - 4,
            fill: '#e0e4f0', cornerRadius: [f.rx, 0, 0, f.rx],
        }));
    }

    _drawDivider() {
        const f = this._frame;
        this._staticGroup.add(new Konva.Line({
            points: [this._divX, f.y + 8, this._divX, f.y + f.h - 8],
            stroke: '#8898b0', strokeWidth: 1.5, dash: [5, 3],
        }));
    }

    /** E 形静铁心（开口向右）——加粗 */
    _drawStaticCore() {
        const { x: yx, y: yy, w: yw, h: yh } = this._yoke;

        // 磁轭（垂直背铁）—— 更宽
        this._staticGroup.add(new Konva.Rect({
            x: yx, y: yy, width: yw, height: yh,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint: { x: yw, y: 0 },
            fillLinearGradientColorStops: [0, '#3c4050', 0.5, '#5a6070', 1, '#3c4050'],
            stroke: '#282c3a', strokeWidth: 1,
        }));

        // 3 条水平腿（加高）
        this._legs.forEach((leg, i) => {
            this._staticGroup.add(new Konva.Rect({
                x: leg.x, y: leg.y, width: leg.w, height: leg.h,
                fillLinearGradientStartPoint: { x: 0, y: 0 },
                fillLinearGradientEndPoint: { x: 0, y: leg.h },
                fillLinearGradientColorStops: [0, '#4a5060', 0.5, '#6a7080', 1, '#4a5060'],
                stroke: '#282c3a', strokeWidth: 0.8,
            }));
            // 叠片纹理——更多
            for (let k = 0; k < 5; k++) {
                const ly = leg.y + leg.h * (k + 1) / 6;
                this._staticGroup.add(new Konva.Line({
                    points: [leg.x, ly, leg.x + leg.w, ly],
                    stroke: 'rgba(255,255,255,0.08)', strokeWidth: 0.8,
                }));
            }
            // 短路环（上下腿端面）
            if (!leg.isCenter) {
                this._staticGroup.add(new Konva.Ellipse({
                    x: leg.x + leg.w - 4, y: leg.y + leg.h / 2,
                    radiusX: 5, radiusY: leg.h * 0.38,
                    fill: 'none', stroke: '#c0c8d0', strokeWidth: 2,
                }));
            }
        });
    }

    /** 线圈绕组——6 匝垂直绕线 */
    _drawCoilWindingAndWires() {
        const cr = this._coilRect;

        // A1 → 线圈右端引线（加粗）
        this._staticGroup.add(new Konva.Line({
            points: [
                this._coilTermA1.x + 4, this._coilTermA1.y,
                this._coilWireA1.x, this._coilTermA1.y,
                this._coilWireA1.x, this._coilWireA1.y,
            ],
            stroke: '#e04040', strokeWidth: this._coilWireSW,
            lineCap: 'round', lineJoin: 'round',
        }));
        // A2 → 线圈左端引线（加粗）
        this._staticGroup.add(new Konva.Line({
            points: [
                this._coilTermA2.x + 4, this._coilTermA2.y,
                this._coilWireA2.x, this._coilTermA2.y,
                this._coilWireA2.x, this._coilWireA2.y,
            ],
            stroke: '#4080e0', strokeWidth: this._coilWireSW,
            lineCap: 'round', lineJoin: 'round',
        }));

        // 线圈骨架背景
        this._staticGroup.add(new Konva.Rect({
            x: cr.x, y: cr.y, width: cr.w, height: cr.h,
            fill: 'rgba(60,40,10,0.50)',
            stroke: '#705030', strokeWidth: 1.5, cornerRadius: 3,
        }));

        // 12 匝垂直绕线（每匝一个矩形环，交替铜色）
        const turns = 12;
        const gap = 3;
        const loopW = (cr.w - 4 - gap * (turns - 1)) / turns;
        for (let i = 0; i < turns; i++) {
            const x0 = cr.x + 2 + i * (loopW + gap);
            const x1 = x0 + loopW;
            const color = i % 2 === 0 ? '#daa520' : '#b8860b';
            this._staticGroup.add(new Konva.Line({
                points: [
                    x0, cr.y + cr.h - 2,
                    x0, cr.y + 2,
                    x1, cr.y + 2,
                    x1, cr.y + cr.h - 2,
                ],
                closed: true,
                stroke: color, strokeWidth: 2.5,
                lineCap: 'round', lineJoin: 'round',
                tension: 0.2,
            }));
        }
    }

    /** A1 / A2 左侧边缘接线柱 */
    _drawCoilTerminals() {
        const draw = (pos, label, color) => {
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
        draw(this._coilTermA1, 'A1', '#e04040');
        draw(this._coilTermA2, 'A2', '#4080e0');
    }

    /** 右侧 7 组触点静态结构——加粗接线+主触点加大 */
    _drawSchematicStatic() {
        const fs = Math.max(8, this.width * 0.016);

        this._contactSlots.forEach((slot, i) => {
            const cx = slot.cx;
            const halfSpan = slot.spanW / 2;
            const inY = this._shaftY - 36;
            const outY = this._shaftY + 36;
            const topStemY = this._shaftY - 20;
            const botStemY = this._shaftY + 20;
            const wireSW = slot.isMain ? this._wireSW + 0.5 : this._wireSW;

            // 进线（上）—— 加粗
            this._staticGroup.add(new Konva.Line({
                points: [cx, 2 + this._termR, cx, topStemY],
                stroke: slot.color, strokeWidth: wireSW, lineCap: 'round',
            }));
            // 出线（下）—— 加粗
            this._staticGroup.add(new Konva.Line({
                points: [cx, botStemY, cx, this.height - 2 - this._termR],
                stroke: slot.color, strokeWidth: wireSW, lineCap: 'round',
            }));
            // 静触点半圆（位于 cx，方向：NO→向右，NC→向左）
            const statR = slot.dotR + 1;
            const statFace = slot.isNC ? 90 : -90;
            // 上半圆
            this._staticGroup.add(new Konva.Arc({
                x: cx, y: topStemY,
                innerRadius: 0, outerRadius: statR,
                angle: 180, rotation: statFace,
                fill: slot.color, stroke: '#6a5a28', strokeWidth: 0.8,
            }));
            // 下半圆
            this._staticGroup.add(new Konva.Arc({
                x: cx, y: botStemY,
                innerRadius: 0, outerRadius: statR,
                angle: 180, rotation: statFace,
                fill: slot.color, stroke: '#6a5a28', strokeWidth: 0.8,
            }));
            // 端子标签
            const topNames = ['NO1','NC1','L1','L2','L3','NC2','NO2'];
            this._staticGroup.add(new Konva.Text({
                x: cx - 10, y: -18,
                text: topNames[i], fontSize: fs +3, fill: slot.color, fontStyle: 'bold',
            }));
        });
    }

    _drawPanelLabel() {

    }

    // ═══════════════════════════════════════════
    // 动态层
    // ═══════════════════════════════════════════

    _createDynamicNodes() {
        this._createArmatureAndShaft();
        this._createSprings();
        this._createContactBridges();
        this._createCoilLed();
        this._arcGroup = new Konva.Group({ listening: false });
        this._dynamicGroup.add(this._arcGroup);
    }

    /** 动铁芯（竖条）+ 可动轴（粗水平线） */
    _createArmatureAndShaft() {
        const off = this._armOffsetCur;
        const armX = this._armX + off;

        this._armGroup = new Konva.Group({ x: 0, listening: false });

        // 动铁芯竖条（加宽）
        this._armGroup.add(new Konva.Rect({
            x: armX, y: this._yoke.y + 4,
            width: this._armW, height: this._armH,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint: { x: this._armW, y: 0 },
            fillLinearGradientColorStops: [0, '#404858', 0.4, '#606878', 0.8, '#6a7080', 1, '#404858'],
            stroke: '#282c3a', strokeWidth: 0.8,
        }));
        // 叠片纹
        for (let k = 1; k <= 4; k++) {
            const lx = armX + this._armW * k / 5;
            this._armGroup.add(new Konva.Line({
                points: [lx, this._yoke.y + 6, lx, this._yoke.y + this._armH - 2],
                stroke: 'rgba(255,255,255,0.07)', strokeWidth: 0.8,
            }));
        }
        // 吸合端面高光
        this._armGlow = new Konva.Rect({
            x: armX, y: this._yoke.y + 4,
            width: 2, height: this._armH,
            fill: 'rgba(120,180,255,0.25)',
            visible: this._state === 'on',
        });
        this._armGroup.add(this._armGlow);

        // 可动轴（刚体，整体平移）—— 左段：动铁芯 → 分隔线
        const shaftX0 = armX + this._armW;
        const shaftH = this._shaftSW;
        this._shaftLine = new Konva.Rect({
            x: shaftX0, y: this._shaftY - shaftH / 2,
            width: this._divX + 4 - (this._armX + this._armW),
            height: shaftH,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint: { x: 0, y: shaftH },
            fillLinearGradientColorStops: [0, '#60a0d0', 0.5, '#90c8f0', 1, '#5090c0'],
            stroke: '#3078a0', strokeWidth: 0.8,
            cornerRadius: 2,
        });
        this._armGroup.add(this._shaftLine);

        // 右段：分隔线 → 右边界（固定宽度，预先裁短 armOffsetMax 避免出界）
        const shaftRightW = this.width - 8 - this._divX - this._armOffsetMax;
        this._shaftRight = new Konva.Rect({
            x: this._divX + off, y: this._shaftY - shaftH / 2,
            width: shaftRightW,
            height: shaftH,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint: { x: 0, y: shaftH },
            fillLinearGradientColorStops: [0, '#60a0d0', 0.5, '#90c8f0', 1, '#5090c0'],
            stroke: '#3078a0', strokeWidth: 0.8,
            cornerRadius: 2,
        });
        this._armGroup.add(this._shaftRight);

        this._dynamicGroup.add(this._armGroup);
    }

    /** 复位弹簧（动铁芯右上/右下 → 右侧，吸合拉伸可见）—— 加粗 */
    _createSprings() {
        this._springGroups = [];
        [this._springTopY, this._springBotY].forEach((sy, si) => {
            const g = new Konva.Group({ listening: false });
            const off = this._armOffsetCur;
            const armLeftX = this._armX + off;
            const armRightX = armLeftX + this._armW;

            const pts = this._makeSpringPoints(armRightX + 4, this._springAnchorRight, sy);
            const sl = new Konva.Line({
                points: pts, stroke: '#6090a8',
                strokeWidth: this._springSW,
                lineCap: 'round', lineJoin: 'round',
            });
            g.add(sl);
            g._springLine = sl;
            g._armRightX = armRightX;
            g._anchorX = this._springAnchorRight;
            g._y = sy;
            this._dynamicGroup.add(g);
            this._springGroups.push(g);
        });
    }

    _makeSpringPoints(x0, x1, y) {
        const pts = [x0, y];
        const turns = 7;
        const dx = (x1 - x0);
        const amp = Math.max(3, dx * 0.14);
        for (let i = 0; i <= turns * 2; i++) {
            const t = i / (turns * 2);
            const x = x0 + t * dx;
            const yOff = (i % 2 === 0) ? -amp : amp;
            pts.push(x, y + yOff);
        }
        pts.push(x1, y);
        return pts;
    }

    /** 7 组触点的动触桥——垂直杆（2倍长）+ 两端半圆触点（方向：NO→左，NC→右） */
    _createContactBridges() {
        this._contactBridges = this._contactSlots.map((slot, i) => {
            const isNC = slot.isNC;
            const isClosed = isNC ? (this._state !== 'on') : (this._state === 'on');
            const openDX = this._bridgeOpenDX * (isNC ? -1 : 1);
            const closedOff = isNC ? this._closedGap : -this._closedGap;
            const bridgeOff = isClosed ? closedOff : openDX;
            const bridgeX = slot.cx + bridgeOff;
            const r = slot.dotR;
            const faceDir = isNC ? -90 : 90; // NO→左(90)，NC→右(-90)

            const g = new Konva.Group({ y: this._shaftY, x: 0, listening: false });
            const topRel = -20;
            const botRel = 20;

            // 垂直杆（2倍长）
            g.add(new Konva.Line({
                points: [bridgeX, topRel, bridgeX, botRel],
                stroke: '#d4a848', strokeWidth: 3.5, lineCap: 'round',
            }));
            // 上半圆触点
            g.add(new Konva.Arc({
                x: bridgeX, y: topRel,
                innerRadius: 0, outerRadius: r,
                angle: 180, rotation: faceDir,
                fill: isClosed ? '#f0c860' : (isNC ? '#e08020' : '#a09080'),
                stroke: '#7a6028', strokeWidth: 0.8,
            }));
            // 下半圆触点
            g.add(new Konva.Arc({
                x: bridgeX, y: botRel,
                innerRadius: 0, outerRadius: r,
                angle: 180, rotation: faceDir,
                fill: isClosed ? '#f0c860' : (isNC ? '#e08020' : '#a09080'),
                stroke: '#7a6028', strokeWidth: 0.8,
            }));

            this._dynamicGroup.add(g);
            return { g, slot, isNC, bridgeX, openDX, r };
        });
    }

    /** 线圈通电指示灯 */
    _createCoilLed() {
        const ledX = this._yoke.x + this._yoke.w ;
        const ledY = this._yoke.y + this._yoke.h + 10;

        this._coilLed = new Konva.Circle({
            x: ledX, y: ledY, radius: 5,
            fill: this._state === 'on' ? '#20ee30' : '#184020',
            stroke: '#304830', strokeWidth: 1, listening: false,
        });
        this._dynamicGroup.add(this._coilLed);

        this._coilLedLabel = new Konva.Text({
            x: ledX + 7, y: ledY - 5,
            text: this._state === 'on' ? '通电' : '断电',
            fontSize: Math.max(12, this.width * 0.016),
            fill: this._state === 'on' ? '#20ee30' : '#607080',
            listening: false,
        });
        this._dynamicGroup.add(this._coilLedLabel);
    }

    // ═══════════════════════════════════════════
    // 动态更新
    // ═══════════════════════════════════════════

    _updateDynamic() {
        let off = this._armOffsetCur;
        if (this._faultShadingRing && this._state === 'on') {
            off += Math.sin(Date.now() * 0.015) * 0.4;
        }
        const ratio = (this._armOffsetMax === 0) ? 1
            : 1 - Math.abs(off) / this._armOffsetMax;

        // 1) 动铁芯 + 轴水平位移
        const armX = this._armX + off;
        const arm = this._armGroup.children;
        if (arm[0]) arm[0].x(armX);
        if (arm[2]) arm[2].x(armX + this._armW);
        const shaftX0 = armX + this._armW;
        if (this._shaftLine) {
            this._shaftLine.x(shaftX0);
            this._shaftLine.width(this._divX + 4 - this._armX - this._armW);
        }
        if (this._shaftRight) {
            this._shaftRight.x(this._divX + off);
        }
        if (this._armGlow) {
            this._armGlow.x(armX);
            this._armGlow.visible(ratio > 0.95);
        }

        // 2) 复位弹簧（右锚点固定，吸合拉伸→红色，释放→蓝色）
        const armRightX = armX + this._armW;
        this._springGroups.forEach(sg => {
            const pts = this._makeSpringPoints(armRightX + 4, sg._anchorX, sg._y);
            sg._springLine.points(pts);
            sg._springLine.stroke(ratio > 0.5 ? '#d04830' : '#6090a8');
            sg._springLine.strokeWidth(ratio > 0.5 ? this._springSW + 0.5 : this._springSW);
        });

        // 3) 7 组触桥（垂直杆 + 方向性半圆触点）
        this._contactBridges.forEach(cb => {
            const openDX = this._bridgeOpenDX * (cb.isNC ? -1 : 1);
            const closedOff = cb.isNC ? this._closedGap : -this._closedGap;
            const t = cb.isNC ? 1 - ratio : ratio;
            const bridgeOff = closedOff * t + openDX * (1 - t);
            const bridgeX = cb.slot.cx + bridgeOff;
            const topRel = -20, botRel = 20;
            const faceDir = cb.isNC ? -90 : 90;
            const isClosed = t > 0.5;

            // 杆（children[0]）
            if (cb.g.children[0]) {
                cb.g.children[0].points([bridgeX, topRel, bridgeX, botRel]);
            }
            const fillClr = isClosed ? '#f0c860' : (cb.isNC ? '#e08020' : '#a09080');
            // 上半圆（children[1]）
            if (cb.g.children[1]) {
                cb.g.children[1].x(bridgeX);
                cb.g.children[1].y(topRel);
                cb.g.children[1].rotation(faceDir);
                cb.g.children[1].fill(fillClr);
            }
            // 下半圆（children[2]）
            if (cb.g.children[2]) {
                cb.g.children[2].x(bridgeX);
                cb.g.children[2].y(botRel);
                cb.g.children[2].rotation(faceDir);
                cb.g.children[2].fill(fillClr);
            }
        });

        // 4) 线圈 LED
        this._coilLed.fill(this._state === 'on' ? '#20ee30' : (ratio > 0.3 ? '#10a018' : '#184020'));
        this._coilLedLabel.text(this._state === 'on' ? '通电' : '断电');
        this._coilLedLabel.fill(this._state === 'on' ? '#20ee30' : '#607080');

        // 5) 电弧
        this._arcGroup.destroyChildren();
        if (this._arcFrames > 0) {
            this._contactSlots.slice(2, 5).forEach(slot => {
                for (let k = 0; k < 3; k++) {
                    this._arcGroup.add(new Konva.Line({
                        points: [
                            slot.cx + (Math.random() - 0.5) * 10, this._shaftY - 6 + (Math.random() - 0.5) * 6,
                            slot.cx + (Math.random() - 0.5) * 6, this._shaftY,
                            slot.cx + (Math.random() - 0.5) * 10, this._shaftY + 6 + (Math.random() - 0.5) * 6,
                        ],
                        stroke: `rgba(255,${180 + Math.round(Math.random() * 75)},60,${0.5 + Math.random() * 0.4})`,
                        strokeWidth: 1 + Math.random() * 0.8, lineCap: 'round',
                    }));
                }
            });
        }
    }

    // ═══════════════════════════════════════════
    // tick
    // ═══════════════════════════════════════════

    tick(dt) {
        if (this._autoSense && this.sys.getVoltageBetween && !this._momentaryHeld) {
            const vRaw = this.sys.getVoltageBetween(`${this.id}_wire_a1`, `${this.id}_wire_a2`);
            if (vRaw !== undefined && isFinite(vRaw)) {
                const v2 = vRaw * vRaw;
                const old = this._vBuf[this._vBufIdx];
                this._vBuf[this._vBufIdx] = v2;
                this._vBufSum = this._vBufSum - old + v2;
                this._vBufIdx = (this._vBufIdx + 1) % 40;
                if (this._vBufCount < 40) this._vBufCount++;
                if (this._vBufCount >= 40) {
                    this._vRms = Math.sqrt(this._vBufSum / 40);
                }
            }
            if (this._vBufCount >= 40 && !this._animating) {
                if (this._state === 'off' && this._vRms >= this._pickupVoltage && !this._faultCoilOpen) {
                    this.energize();
                } else if (this._state === 'on' && this._vRms <= this._dropoutVoltage) {
                    this.deenergize();
                }
            }
            this._coilInductance = this._state === 'on' ? this._coilInductanceClosed : this._coilInductanceOpen;
        }

        if (this._faultShadingRing && this._state === 'on') {
            this._coilInductance = this._coilInductanceClosed * (0.3 + 0.7 * (0.5 + 0.5 * Math.sin(Date.now() * 0.02)));
        }

        if (this._faultCoilOpen && this._state === 'on' && !this._momentaryHeld) {
            this.deenergize();
        }

        this._tickAnimation(dt);
        if (this._arcFrames > 0) this._arcFrames--;

        const needUpdate = this._animating || this._arcFrames > 0
            || this._coilEnergized
            || this._animJustEnded;

        if (needUpdate) {
            this._animJustEnded = false;
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
            this._animJustEnded = true;
            this._armOffsetCur = this._animToOff;
            return;
        }

        const ease = 0.5 - 0.5 * Math.cos(this._animT * Math.PI);
        this._armOffsetCur = this._animFromOff + (this._animToOff - this._animFromOff) * ease;

        const ratio = 1 - Math.abs(this._armOffsetCur / this._armOffsetMax);
        if (ratio > 0.88 && this._arcFrames === 0) {
            this._arcFrames = 5;
        }
    }

    _startAnim(toState) {
        this._animFromOff   = this._armOffsetCur;
        this._animToOff     = toState === 'on' ? 0 : this._armOffsetMax;
        this._animT         = 0;
        this._animating     = true;
        this._state         = toState;
        this._coilEnergized = toState === 'on';
        this.opsCount++;
    }

    // ═══════════════════════════════════════════
    // 公开 API
    // ═══════════════════════════════════════════

    energize() {
        if (this._faultStuck || this._animating || this._state === 'on') return;
        this._animDur = this.config.animDur || 0.12;
        this._startAnim('on');
    }

    deenergize() {
        if (this._faultStuck || this._animating || this._state === 'off') return;
        this._animDur = (this.config.animDur || 0.12) * 0.85;
        this._startAnim('off');
    }

    getState()    { return this._state; }
    isClosed()    { return this._state === 'on'; }
    getOpsCount() { return this.opsCount; }

    update(state) {
        const v = String(state).toLowerCase();
        if (v === 'on'  || v === '1') this.energize();
        if (v === 'off' || v === '0') this.deenergize();
    }

    getConfigFields() {
        return [
            { label: '位号/名称',          key: 'label',        type: 'text'   },
            { label: '线圈电压规格',        key: 'coilVoltage',  type: 'text'   },
            { label: '额定电流 (A)',        key: 'ratedCurrent', type: 'number' },
            { label: '初始状态 on/off',     key: 'initState',    type: 'text'   },
            { label: '动作时间 (s)',        key: 'animDur',      type: 'number' },
            { label: '线圈电阻 (Ω)',        key: 'coilResistance', type: 'number' },
            { label: '吸合电压比',          key: 'pickupRatio',  type: 'number' },
            { label: '释放电压比',          key: 'dropoutRatio', type: 'number' },
            { label: '线圈额定电压 (V)',    key: 'ratedCoilVoltage', type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label        !== undefined) this.label        = cfg.label;
        if (cfg.coilVoltage  !== undefined) this.coilVoltage  = cfg.coilVoltage;
        if (cfg.ratedCurrent !== undefined) this.ratedCurrent = parseFloat(cfg.ratedCurrent);
        if (cfg.animDur      !== undefined) this._animDur     = parseFloat(cfg.animDur);
        if (cfg.initState !== undefined) {
            const want = cfg.initState.toLowerCase();
            if (want === 'on' && this._state !== 'on' && !this._faultCoilOpen) this.energize();
            if (want === 'off' && this._state !== 'off') this.deenergize();
        }
        if (cfg.coilResistance !== undefined) this._coilResistance = parseFloat(cfg.coilResistance);
        if (cfg.pickupRatio    !== undefined) { this._pickupRatio = parseFloat(cfg.pickupRatio); this._pickupVoltage = this._ratedCoilVoltage * this._pickupRatio; }
        if (cfg.dropoutRatio   !== undefined) { this._dropoutRatio = parseFloat(cfg.dropoutRatio); this._dropoutVoltage = this._ratedCoilVoltage * this._dropoutRatio; }
        if (cfg.ratedCoilVoltage !== undefined) { this._ratedCoilVoltage = parseFloat(cfg.ratedCoilVoltage); this._pickupVoltage = this._ratedCoilVoltage * this._pickupRatio; this._dropoutVoltage = this._ratedCoilVoltage * this._dropoutRatio; }
        this.config = { ...this.config, ...cfg };
        this._recalcGeometry();
        this._staticGroup.destroyChildren();
        this._dynamicGroup.destroyChildren();
        this._drawStaticParts();
        this._createDynamicNodes();
        this._refreshCache();
    }

    destroy() { super.destroy?.(); }
}
