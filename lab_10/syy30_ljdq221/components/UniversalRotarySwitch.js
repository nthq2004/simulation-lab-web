import { BaseComponent } from './BaseComponent.js';

/**
 * 万能转换开关仿真组件（4档位 × 8对触点）
 * （Universal Rotary Cam Switch — 4 Positions × 8 Contact Pairs）
 *
 * ═══ 渲染优化原则 ═══════════════════════════════════════════
 *  遵循的优化策略：
 *  1. 动态元素（手柄拨杆、8个触桥、高光）使用 in-place 更新
 *  2. 消除所有 shadow 属性，避免离屏阴影渲染
 *  3. 静态部件（外框、接线柱、隔板等）仅在 init 时缓存
 *  4. 电弧特效在独立 _arcGroup 中重建，不干扰主体动态节点
 * ═══════════════════════════════════════════════════════════
 *
 * ── 结构说明 ──────────────────────────────────────────────────
 *
 *  左半区：操作手柄区（物理操作侧）
 *    - 手柄圆盘：可旋转手柄，4 档位（上/右/下/左）各相差 90°
 *    - 手柄拨杆：指示当前档位方向
 *    - 十字刻度：上/右/下/左 4 方向刻度线及档位标注
 *
 *  右半区：电路原理图区（IEC/ANSI 图形符号）
 *    - 8 个触点列，横向均匀分布
 *    - 每列包含下端子（L）和上端子（R），触桥垂直连接 L↔R
 *    - 各列之间有绝缘隔板分隔
 *
 * ── 触点通断规则（凸轮表）────────────────────────────────────
 *         上  右  下  左
 *  对1 [  1   0   0   0  ]
 *  对2 [  1   0   0   0  ]
 *  对3 [  0   1   0   0  ]
 *  对4 [  0   1   0   0  ]
 *  对5 [  0   0   1   0  ]
 *  对6 [  0   0   1   0  ]
 *  对7 [  0   0   0   1  ]
 *  对8 [  0   0   0   1  ]
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  每对触点垂直引出两个端口（L 在下边，R 在上边）：
 *    p1l, p1r — 触点对 1
 *    p2l, p2r — 触点对 2
 *    ...
 *    p8l, p8r — 触点对 8
 *
 * ── 可配置参数 ────────────────────────────────────────────────
 *  label          : 位号（默认 'SA'）
 *  ratedVoltage   : 额定电压 V（默认 380）
 *  ratedCurrent   : 额定电流 A（默认 10）
 *  initPosition   : 初始档位 0=上,1=右,2=下,3=左（默认 1）
 *  animDur        : 动画时长 s（默认 0.06）
 */
export class UniversalRotarySwitch extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(420, config.width  || 450);
        this.height = Math.max(75,  config.height || 120);

        this.type    = 'uniswitch';
        this.special = 't4s8';  // 4 档位 × 8对触点
        this.cache   = 'fixed';

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        this.config = {
            id: this.id,
            label:        this.label,
            ratedVoltage: this.ratedVoltage,
            ratedCurrent: this.ratedCurrent,
            initPosition: this._position,
            animDur:      this._animDur,
        };

        // ── 16 个端口 ─────────────────────────
        for (let i = 0; i < 8; i++) {
            const pL = this._pairPorts[i].L;
            const pR = this._pairPorts[i].R;
            this.addPort(pL.x, pL.y, `p${i+1}l`, 'wire');
            this.addPort(pR.x, pR.y, `p${i+1}r`, 'wire', i === 0 ? 'p' : undefined);
        }
    }

    // ═══════════════════════════════════════════
    // 凸轮表
    // ═══════════════════════════════════════════

    static get CAM_TABLE() {
        return [
            [true,  false, false, false],
            [true,  false, false, false],
            [false, true,  false, false],
            [false, true,  false, false],
            [false, false, true,  false],
            [false, false, true,  false],
            [false, false, false, true ],
            [false, false, false, true ],
        ];
    }

    // ═══════════════════════════════════════════
    // 几何尺寸计算
    // ═══════════════════════════════════════════

    _recalcGeometry() {
        const W = this.width, H = this.height;

        this._divX = W * 0.32;

        this._frame = { x: 2, y: 2, w: W - 4, h: H - 4, rx: 6 };

        // ── 左侧手柄区 ──────────────────────────
        this._knobCenter = { x: W * 0.16, y: H * 0.58 };
        this._knobR      = Math.min(W * 0.12, H * 0.38);
        this._knobInnerR = this._knobR * 0.42;
        this._leverLen   = this._knobR * 0.84;

        this._leverAngles = [-90, 0, 90, 180];
        this._posNames    = ['上', '右', '下', '左'];

        this._arcR = this._knobR * 1.20;

        // ── 右侧原理图区（8 个触点列）────────────
        const rPad  = W * 0.025;
        const rLeft = this._divX + rPad;
        const rW    = W - rLeft - rPad;

        const numCols = 8;
        const colW    = rW / numCols;

        // 端子距顶/底边的距离
        const portInset = 2;
        const termInset = Math.max(10, H * 0.15);

        this._pairs = [];
        this._termR = Math.max(4, W * 0.014);

        for (let i = 0; i < numCols; i++) {
            const cx = rLeft + colW * (i + 0.5);
            this._pairs.push({
                cx,
                // L 端子在下，R 端子上上
                yL: H - termInset,
                yR: termInset,
                bridgeMaxH: (H - termInset * 2) - this._termR * 1.2,
                bridgeW: Math.max(4, W * 0.012),
            });
        }

        // ── 端口位置 ────────────────────────────
        this._pairPorts = this._pairs.map(p => ({
            L: { x: p.cx, y: H - 2 },
            R: { x: p.cx, y: 2 },
        }));
    }

    // ═══════════════════════════════════════════
    // 参数初始化
    // ═══════════════════════════════════════════

    _initParameters(config) {
        this.ratedVoltage = config.ratedVoltage !== undefined ? config.ratedVoltage : 380;
        this.ratedCurrent = config.ratedCurrent !== undefined ? config.ratedCurrent : 10;
        this.label        = config.label || 'SA';

        const initPos  = parseInt(config.initPosition);
        this._position = (isNaN(initPos) || initPos < 0 || initPos > 3) ? 1 : initPos;

        this._animating   = false;
        this._animT       = 0;
        this._animFromPos = this._position;
        this._animToPos   = this._position;

        this._curLeverAngle = this._leverAngles[this._position];

        this._pairClosed = UniversalRotarySwitch.CAM_TABLE.map(row => row[this._position]);
        this._bridgeProgress = this._pairClosed.map(c => c ? 1.0 : 0.0);

        this._arcFrames     = 0;
        this._arcPairs      = [];
        this._animDur       = config.animDur !== undefined ? config.animDur : 0.06;
        this._animJustEnded = false;

        this.opsCount = config.initOps || 0;
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
        this._drawKnobBase();
        this._drawKnobCross();
        this._drawSchematicStatic();
        this._drawLabel();
        this._drawTerminalLabels();
    }

    _drawFrame() {
        const f = this._frame;
        this._staticGroup.add(new Konva.Rect({
            x: f.x, y: f.y, width: f.w, height: f.h,
            fill: '#dee0eb',
            stroke: '#b0a698',
            strokeWidth: 1.5,
            cornerRadius: f.rx,
        }));
        this._staticGroup.add(new Konva.Rect({
            x: f.x + 2, y: f.y + 2, width: f.w - 4, height: f.h * 0.12,
            fill: 'rgba(132, 164, 246, 0.2)',
            cornerRadius: [f.rx, f.rx, 0, 0],
        }));
    }

    _drawDivider() {
        this._staticGroup.add(new Konva.Line({
            points: [this._divX, this._frame.y + 8, this._divX, this._frame.y + this._frame.h - 8],
            stroke: '#b0a698',
            strokeWidth: 1,
            dash: [4, 4],
        }));
        this._staticGroup.add(new Konva.Text({
            x: this._frame.x + 4,
            y: this._frame.y - 14,
            text: '万能转换开关',
            fontSize: Math.max(12, this.width * 0.030),
            fill: '#5a6a7a',
        }));
    }

    _drawKnobBase() {
        const cx = this._knobCenter.x, cy = this._knobCenter.y;
        const R  = this._knobR;

        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: R,
            fill: '#6d706d',
            stroke: '#9a8e80',
            strokeWidth: 1.5,
        }));
        this._staticGroup.add(new Konva.Ring({
            x: cx, y: cy,
            innerRadius: R - 4,
            outerRadius: R,
            fill: '#fae5bd',
        }));
    }

    _drawKnobCross() {
        const cx   = this._knobCenter.x, cy = this._knobCenter.y;
        const R    = this._knobR;
        const arcR = this._arcR;

        // 十字辅助线
        this._staticGroup.add(new Konva.Line({
            points: [cx - arcR + 2, cy, cx + arcR - 2, cy],
            stroke: 'rgba(0,0,0,0.06)', strokeWidth: 1,
        }));
        this._staticGroup.add(new Konva.Line({
            points: [cx, cy - arcR + 2, cx, cy + arcR - 2],
            stroke: 'rgba(0,0,0,0.06)', strokeWidth: 1,
        }));

        const labels = ['上', '右', '下', '左'];
        const colors = ['#5a6a7a', '#037207', '#fa0703', '#0a1af7'];

        this._leverAngles.forEach((deg, i) => {
            const rad = deg * Math.PI / 180;
            const tickR = R + 6;
            this._staticGroup.add(new Konva.Line({
                points: [
                    cx + (R - 4) * Math.cos(rad), cy + (R - 4) * Math.sin(rad),
                    cx + tickR   * Math.cos(rad), cy + tickR   * Math.sin(rad),
                ],
                stroke: '#8a7a68', strokeWidth: 1.2, lineCap: 'round',
            }));
            const labelR = arcR + 10;
            this._staticGroup.add(new Konva.Text({
                x: cx + labelR * Math.cos(rad) - 8,
                y: cy + labelR * Math.sin(rad) - 6,
                text: labels[i],
                fontSize: Math.max(12, this.width * 0.032),
                fontStyle: 'bold',
                fill: colors[i],
            }));
        });
    }

    _drawCamTable() {
        const area  = this._camTable();
        const cam   = UniversalRotarySwitch.CAM_TABLE;
        const posSymbols = ['上', '右', '下', '左'];
        const numPairs = 6, numPos = 4;

        this._staticGroup.add(new Konva.Rect({
            x: area.x, y: area.y, width: area.w, height: area.h,
            fill: '#e8e4dc', stroke: '#b0a698', strokeWidth: 0.8,
            cornerRadius: 3,
        }));

        const cellW = area.w / (numPos + 1);
        const cellH = area.h / (numPairs + 1);
        const fs    = Math.max(6, this.width * 0.024);

        posSymbols.forEach((sym, j) => {
            this._staticGroup.add(new Konva.Text({
                x: area.x + cellW * (j + 1) + 2,
                y: area.y + 2,
                text: sym, fontSize: fs, fontStyle: 'bold',
                fill: '#5a6a7a',
            }));
        });

        for (let i = 0; i < numPairs; i++) {
            this._staticGroup.add(new Konva.Text({
                x: area.x + 2,
                y: area.y + cellH * (i + 1) + 1,
                text: `P${i+1}`, fontSize: fs, fill: '#5a6a7a',
            }));
        }

        for (let i = 0; i < numPairs; i++) {
            for (let j = 0; j < numPos; j++) {
                const closed = cam[i][j];
                this._staticGroup.add(new Konva.Text({
                    x: area.x + cellW * (j + 1) + cellW * 0.5 - 4,
                    y: area.y + cellH * (i + 1) + cellH * 0.35,
                    text: closed ? '●' : '○',
                    fontSize: fs,
                    fill: closed ? '#037207' : '#b0a698',
                }));
            }
        }

        for (let i = 0; i <= numPairs; i++) {
            this._staticGroup.add(new Konva.Line({
                points: [area.x, area.y + cellH * (i + 1), area.x + area.w, area.y + cellH * (i + 1)],
                stroke: '#c8c0b8', strokeWidth: 0.5,
            }));
        }
        for (let j = 1; j <= numPos; j++) {
            this._staticGroup.add(new Konva.Line({
                points: [area.x + cellW * j, area.y, area.x + cellW * j, area.y + area.h],
                stroke: '#c8c0b8', strokeWidth: 0.5,
            }));
        }
    }

    _camTable() {
        return {
            x: this._frame.x + 6,
            y: this._frame.y + this._frame.h + 4,
            w: this._divX - 10,
            h: 0,
        };
    }

    _drawSchematicStatic() {
        const R = this._termR;

        this._pairs.forEach((p, i) => {
            // 列间隔板线
            if (i > 0) {
                const prevCx = this._pairs[i-1].cx;
                const midX = (prevCx + p.cx) / 2;
                this._staticGroup.add(new Konva.Line({
                    points: [midX, this._frame.y + 4, midX, this._frame.y + this._frame.h - 4],
                    stroke: '#c8c0b8', strokeWidth: 0.8,
                }));
            }

            // L 端子（下）
            this._drawTerminalPost({ x: p.cx, y: p.yL });
            // R 端子（上）
            this._drawTerminalPost({ x: p.cx, y: p.yR });

            // L 向下引出线
            this._staticGroup.add(new Konva.Line({
                points: [p.cx, p.yL + R, p.cx, this.height - 2],
                stroke: '#097aeb', strokeWidth: 2,
            }));
            // R 向上引出线
            this._staticGroup.add(new Konva.Line({
                points: [p.cx, p.yR - R, p.cx, 2],
                stroke: '#097aeb', strokeWidth: 2,
            }));
        });
    }

    _drawTerminalPost(pos) {
        const R = this._termR;
        const { x, y } = pos;
        this._staticGroup.add(new Konva.Circle({
            x, y, radius: R,
            fillLinearGradientStartPoint: { x: -R, y: -R },
            fillLinearGradientEndPoint:   { x:  R, y:  R },
            fillLinearGradientColorStops: [
                0, '#7a6a30', 0.4, '#d4aa52', 0.7, '#e8c86a', 1, '#8a7030',
            ],
            stroke: '#6a5a28', strokeWidth: 1,
        }));
        this._staticGroup.add(new Konva.Circle({
            x, y, radius: R * 0.38,
            fill: '#2a1a08', stroke: '#5a4a20', strokeWidth: 0.6,
        }));
        this._staticGroup.add(new Konva.Line({
            points: [x - R * 0.50, y, x + R * 0.50, y],
            stroke: '#3a2a10', strokeWidth: 0.8, lineCap: 'round',
        }));
    }

    _drawLabel() {
    }

    _drawTerminalLabels() {
        const R   = this._termR;
        const fs  = Math.max(6, this.width * 0.022);

        this._pairs.forEach((p, i) => {
            // L 标注（下端子的下方）
            this._staticGroup.add(new Konva.Text({
                x: p.cx - R - 14,
                y: p.yL + R + 1,
                text: `${i+1}L`, fontSize: fs, fontStyle: 'bold',
                fill: '#037207',
            }));
            // R 标注（上端子的上方）
            this._staticGroup.add(new Konva.Text({
                x: p.cx + R + 2,
                y: p.yR - R - fs - 1,
                text: `${i+1}R`, fontSize: fs, fontStyle: 'bold',
                fill: '#fa0703',
            }));
        });
    }

    // ═══════════════════════════════════════════
    // 动态层（一次性创建，每帧 in-place 更新）
    // ═══════════════════════════════════════════

    _createDynamicNodes() {
        this._createLeverGroup();
        this._createBridgeNodes();
        this._createContactGlows();
        this._arcGroup = new Konva.Group({ listening: false });
        this._dynamicGroup.add(this._arcGroup);
    }

    _createLeverGroup() {
        const cx = this._knobCenter.x, cy = this._knobCenter.y;
        const Ri = this._knobInnerR;
        const bW = Math.max(4, this.height * 0.030);

        this._leverGroup = new Konva.Group({
            x: cx, y: cy,
            rotation: this._curLeverAngle,
        });

        this._leverGroup.add(new Konva.Rect({
            x: Ri * 0.20, y: -bW * 0.5,
            width: this._leverLen - Ri * 0.20,
            height: bW,
            fill: '#faf6f6',
            stroke: '#a02018', strokeWidth: 1.2,
            cornerRadius: [0, 4, 4, 0],
        }));

        this._leverGroup.add(new Konva.Rect({
            x: Ri * 0.20 + 2, y: -bW * 0.5 + 1,
            width: this._leverLen - Ri * 0.20 - 8,
            height: bW * 0.30,
            fill: 'rgba(255,255,255,0.18)',
            cornerRadius: [0, 3, 0, 0],
        }));

        this._dynamicGroup.add(this._leverGroup);
    }

    /** 8 个垂直触桥节点 */
    _createBridgeNodes() {
        this._bridgeRects = [];
        this._bridgeGlows = [];

        this._pairs.forEach((p, i) => {
            const bW   = p.bridgeW;
            const maxH = p.bridgeMaxH;
            const prog = this._bridgeProgress[i];

            // 触桥从 R 端子（上）向 L 端子（下）延伸
            const bridgeY = p.yR + this._termR * 0.6;
            const curH    = maxH * prog;

            const rect = new Konva.Rect({
                x: p.cx - bW / 2,
                y: bridgeY,
                width:  bW,
                height: curH,
                fillLinearGradientStartPoint: { x: 0, y: 0 },
                fillLinearGradientEndPoint:   { x: bW, y: 0 },
                fillLinearGradientColorStops: [
                    0, '#8a7530', 0.3, '#d4b050', 0.55, '#f0cc68', 0.75, '#c4a040', 1, '#8a7530',
                ],
                stroke: '#7a6528', strokeWidth: 0.8,
                cornerRadius: 1,
                visible: prog > 0.01,
            });

            const glow = new Konva.Rect({
                x: p.cx - bW / 2 - 2,
                y: bridgeY - 1,
                width:  bW + 4,
                height: curH + 2,
                fill:   'rgba(255,160,30,0.22)',
                cornerRadius: 2,
                visible: prog > 0.92,
                listening: false,
            });

            this._dynamicGroup.add(glow);
            this._dynamicGroup.add(rect);
            this._bridgeRects.push(rect);
            this._bridgeGlows.push(glow);
        });
    }

    _createContactGlows() {
        this._contactGlowsL = [];
        this._contactGlowsR = [];

        this._pairs.forEach((p, i) => {
            const R = this._termR;
            const gL = new Konva.Circle({
                x: p.cx, y: p.yL, radius: R * 1.55,
                fill: 'rgba(255,160,30,0.28)',
                visible: this._bridgeProgress[i] > 0.92,
                listening: false,
            });
            const gR = new Konva.Circle({
                x: p.cx, y: p.yR, radius: R * 1.55,
                fill: 'rgba(255,160,30,0.28)',
                visible: this._bridgeProgress[i] > 0.92,
                listening: false,
            });
            this._dynamicGroup.add(gL);
            this._dynamicGroup.add(gR);
            this._contactGlowsL.push(gL);
            this._contactGlowsR.push(gR);
        });
    }

    // ═══════════════════════════════════════════
    // 动态更新（每帧 in-place）
    // ═══════════════════════════════════════════

    _updateDynamic() {
        this._leverGroup.rotation(((this._curLeverAngle % 360) + 360) % 360);

        this._pairs.forEach((p, i) => {
            const prog    = this._bridgeProgress[i];
            const bW      = p.bridgeW;
            const maxH    = p.bridgeMaxH;
            const curH    = maxH * prog;
            const bridgeY = p.yR + this._termR * 0.6;
            const fullyOn = prog > 0.92;

            this._bridgeRects[i].x(p.cx - bW / 2);
            this._bridgeRects[i].y(bridgeY);
            this._bridgeRects[i].height(curH);
            this._bridgeRects[i].visible(prog > 0.01);

            this._bridgeGlows[i].x(p.cx - bW / 2 - 2);
            this._bridgeGlows[i].y(bridgeY - 1);
            this._bridgeGlows[i].height(curH + 2);
            this._bridgeGlows[i].visible(fullyOn);

            this._contactGlowsL[i].visible(fullyOn);
            this._contactGlowsR[i].visible(fullyOn);
        });

        this._arcGroup.destroyChildren();
        if (this._arcFrames > 0) {
            this._drawArcInGroup(this._arcGroup);
        }
    }

    _drawArcInGroup(group) {
        this._arcPairs.forEach(i => {
            const p  = this._pairs[i];
            const px = p.cx, py = p.yR;
            const R  = this._termR;
            for (let k = 0; k < 3; k++) {
                const spread = (Math.random() - 0.5) * R * 4;
                group.add(new Konva.Line({
                    points: [
                        px - R * 2.5 + Math.random() * 4, py + spread * 0.3,
                        px - R * 1.2 + Math.random() * 5, py + spread,
                        px,                                py + spread * 0.2,
                    ],
                    stroke: `rgba(255,${180 + Math.round(Math.random() * 75)},60,${0.5 + Math.random() * 0.4})`,
                    strokeWidth: 1 + Math.random() * 0.8,
                    lineJoin: 'round', lineCap: 'round', listening: false,
                }));
            }
        });
    }

    // ═══════════════════════════════════════════
    // 交互绑定
    // ═══════════════════════════════════════════

    _bindInteraction() {
        const cx  = this._knobCenter.x, cy = this._knobCenter.y;
        const R   = this._knobR;

        const hitArea = new Konva.Circle({
            x: cx, y: cy,
            radius: R + 10,
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
            const dx = local.x - cx, dy = local.y - cy;
            const clickAngle = ((Math.atan2(dy, dx) * 180 / Math.PI) + 360) % 360;

            const curAngle = this._leverAngles[this._position];
            let diff = clickAngle - curAngle;
            if (diff > 180) diff -= 360;
            else if (diff < -180) diff += 360;

            if (diff > 0) this.toggleNext();
            else          this.togglePrev();
        });

        hitArea.on('mouseenter', () => { document.body.style.cursor = 'pointer'; });
        hitArea.on('mouseleave', () => { document.body.style.cursor = 'default'; });

        this._interactGroup.add(hitArea);
    }

    // ═══════════════════════════════════════════
    // tick（20fps）
    // ═══════════════════════════════════════════

    tick(dt) {
        this._tickAnimation(dt);

        if (this._arcFrames > 0) this._arcFrames--;

        if (this._animating || this._arcFrames > 0 || this._animJustEnded) {
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
            this._animT         = 1;
            this._animating     = false;
            this._animJustEnded = true;
            this._position      = this._animToPos;
            // 最终同步闭合状态
            this._pairClosed = UniversalRotarySwitch.CAM_TABLE.map(row => row[this._position]);
            // 归一化角度
            this._curLeverAngle = ((this._curLeverAngle % 360) + 360) % 360;
        }

        const ease = 0.5 - 0.5 * Math.cos(this._animT * Math.PI);

        // 手柄角度插值（环绕处理）
        const fromLever = this._leverAngles[this._animFromPos];
        const toLever   = this._leverAngles[this._animToPos];
        let toLeverAdj  = toLever;
        const diff = toLever - fromLever;
        if (diff >= 180) {
            toLeverAdj -= 360;
        } else if (diff <= -180) {
            toLeverAdj += 360;
        }
        this._curLeverAngle = fromLever + (toLeverAdj - fromLever) * ease;

        // 各触桥进度插值
        const cam = UniversalRotarySwitch.CAM_TABLE;
        this._pairs.forEach((_, i) => {
            const wasOn  = cam[i][this._animFromPos];
            const willOn = cam[i][this._animToPos];
            if (wasOn && !willOn) {
                this._bridgeProgress[i] = 1.0 - ease;
            } else if (!wasOn && willOn) {
                this._bridgeProgress[i] = ease;
            } else {
                this._bridgeProgress[i] = wasOn ? 1.0 : 0.0;
            }
        });

        // 接触/断开瞬间产生电弧
        if (this._animT > 0.88 && this._arcFrames === 0) {
            this._arcPairs = [];
            cam.forEach((row, i) => {
                if (row[this._animFromPos] !== row[this._animToPos]) {
                    this._arcPairs.push(i);
                }
            });
            if (this._arcPairs.length > 0) {
                this._arcFrames = 3;
            }
        }
    }

    // ═══════════════════════════════════════════
    // 公开 API
    // ═══════════════════════════════════════════

    toggleNext() {
        if (this._animating) return;
        const next = (this._position + 1) % 4;
        this._startSwitch(next);
    }

    togglePrev() {
        if (this._animating) return;
        const prev = ((this._position - 1 + 4) % 4);
        this._startSwitch(prev);
    }

    switchTo(pos) {
        pos = Math.max(0, Math.min(3, parseInt(pos)));
        if (this._animating || pos === this._position) return;
        this._startSwitch(pos);
    }

    _startSwitch(toPos) {
        this._animFromPos = this._position;
        this._animToPos   = toPos;
        this._animT       = 0;
        this._animating   = true;
        this._arcPairs    = [];
        this.opsCount++;
    }

    getPosition()   { return this._position; }

    isPairClosed(pairIdx) {
        const i = Math.max(0, Math.min(7, pairIdx - 1));
        return this._pairClosed[i];
    }

    isAnimating()  { return this._animating; }
    getOpsCount()  { return this.opsCount; }

    update(state) {
        const pos = parseInt(state);
        if (!isNaN(pos) && pos >= 0 && pos <= 3) this.switchTo(pos);
    }

    getConfigFields() {
        return [
            { label: '位号/名称',                   key: 'label',        type: 'text'   },
            { label: '额定电压 (V)',                 key: 'ratedVoltage', type: 'number' },
            { label: '额定电流 (A)',                 key: 'ratedCurrent', type: 'number' },
            { label: '初始档位（0=上,1=右,2=下,3=左）', key: 'initPosition', type: 'number' },
            { label: '动作时间 (s)',                 key: 'animDur',      type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label        !== undefined) this.label        = cfg.label;
        if (cfg.ratedVoltage !== undefined) this.ratedVoltage = parseFloat(cfg.ratedVoltage);
        if (cfg.ratedCurrent !== undefined) this.ratedCurrent = parseFloat(cfg.ratedCurrent);
        if (cfg.animDur      !== undefined) this._animDur     = parseFloat(cfg.animDur);

        if (cfg.initPosition !== undefined) {
            const want = Math.max(0, Math.min(3, parseInt(cfg.initPosition)));
            if (want !== this._position) this.switchTo(want);
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
