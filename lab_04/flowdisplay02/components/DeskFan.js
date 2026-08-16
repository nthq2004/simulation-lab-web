import { BaseComponent } from './BaseComponent.js';

/**
 * 家用台式电风扇仿真组件
 * （Home Desk Fan）
 *
 * ── 结构说明 ──────────────────────────────────────────────────
 *
 *  参考图片为三叶片台式电风扇，正视图，本组件完整复现其外观并添加
 *  可交互的操控面板。主要部分：
 *
 *  1. 底座（Base）：椭圆形灰色底座，含4颗装饰螺钉和控制琴键
 *     - 琴键1：电源开关（Power）—— 按下=开，再按=关
 *     - 琴键2：低速（Low / 1档）
 *     - 琴键3：中速（Medium / 2档）
 *     - 琴键4：高速（High / 3档）
 *     转速琴键互斥（同一时间只有一个按下），电源关时全部弹起
 *
 *  2. 立柱（Pole）：灰色竖杆，连接底座与网罩
 *
 *  3. 网罩（Guard）：圆形白色铁丝网，外环 + 辐条 + 同心圆
 *
 *  4. 叶片（Blades）：三片青绿色扇叶，以中心毂为轴旋转
 *     - 每片叶片由贝塞尔曲线绘制，带透视翘曲感
 *     - 旋转速度随档位变化：停止 / 慢 / 中 / 快
 *     - 高速时叶片因运动模糊变为半透明圆盘
 *
 *  5. 中心毂（Hub）：灰色圆形，覆盖在叶片交汇处
 *
 *  6. 状态指示灯（LED）：底座上方三颗小灯，分别对应三个档位
 *
 * ── 档位与转速 ───────────────────────────────────────────────
 *
 *  档位 0（关）：bladeRPM = 0
 *  档位 1（低）：bladeRPM = 120  rpm → ω ≈ 2π×2 = ~12.6 rad/s
 *  档位 2（中）：bladeRPM = 240  rpm
 *  档位 3（高）：bladeRPM = 400  rpm
 *
 * ── 琴键交互 ─────────────────────────────────────────────────
 *
 *  点击琴键时产生 4px 下压动画（60ms），松开时弹起
 *  电源键按下 → 恢复上次档位（默认低速）
 *  电源键再按 → 关闭，所有档位键弹起
 *  档位键按下 → 切换档位，若电源未开则自动开电源
 *
 * ── 动画帧循环 ──────────────────────────────────────────────
 *
 *  requestAnimationFrame 驱动，dt 积分叶片角度
 *  高速（3档）时叠加运动模糊圆盘（opacity 随转速渐变）
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  terminal_l — 火线端（L，底座左侧）
 *  terminal_n — 零线端（N，底座右侧）
 */
export class DeskFan extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(220, config.width  || 260);
        this.height = Math.max(320, config.height || 380);

        this.type    = 'desk_fan';
        this.special = 'none';
        this.cache   = 'fixed';

        this._initGroups();
        // ── 铭牌参数 ──
        this.label       = config.label       || 'FAN';
        this.ratedVoltage = config.ratedVoltage || 220;   // V
        this.ratedPower   = config.ratedPower   || 45;    // W

        // ── 转速表（rpm） ──
        this._speedRPM = [0, 120, 240, 400];     // 0档=关，1~3档
        this._speedLabels = ['—', '低速', '中速', '高速'];

        // ── 状态 ──
        this._powered  = config.initPowered || false;  // 是否通电
        this._gear     = config.initGear    || 0;      // 0=关 1/2/3=档位
        this._lastGear = 1;                            // 关机前记忆档位

        // ── 叶片动画 ──
        this._bladeAngle = 0;        // 当前角度 rad

        // ── 琴键按压动画 ──
        this._keyPress   = [false, false, false, false]; // 4颗琴键按压状态
        this._keyAnimT   = [0, 0, 0, 0];                // 按压动画进度

        // ── 几何 ──
        this._calcGeometry();
        this._init();

        // ── 端口 ──
        const b = this._geo.base;
        this.addPort(b.cx - b.rw * 0.55, b.cy + b.rh + 4, 'terminal_l', 'wire', 'L');
        this.addPort(b.cx + b.rw * 0.55, b.cy + b.rh + 4, 'terminal_n', 'wire', 'N');
    }

    // ═══════════════════════════════════════════
    _calcGeometry() {
        const W = this.width, H = this.height;
        const g = {};

        // 网罩圆心（偏上方）
        g.guardCX = W * 0.50;
        g.guardCY = H * 0.36;
        g.guardR  = W * 0.420;   // 外环半径

        // 叶片中心（与网罩同心）
        g.hubCX = g.guardCX;
        g.hubCY = g.guardCY;
        g.hubR  = W * 0.068;     // 中心毂半径
        g.bladeR = g.guardR * 0.62; // 叶片从毂边缘伸出的长度

        // 立柱
        g.poleX = W * 0.465;
        g.poleY = g.guardCY + g.guardR * 0.90;
        g.poleW = W * 0.072;
        g.poleH = H * 0.20;

        // 底座（椭圆近似为圆角矩形）
        g.base = {
            cx:  W * 0.50,
            cy:  g.poleY + g.poleH + H * 0.035,
            rw:  W * 0.42,
            rh:  H * 0.075,
        };

        // 四颗琴键（底座上，横向排列）
        const kw = g.base.rw * 0.38,  kh = g.base.rh * 0.72;
        const kGap = kw * 0.12;
        const totalW = kw * 4 + kGap * 3;
        const kStartX = g.base.cx - totalW / 2;
        const kY = g.base.cy - kh / 2;
        g.keys = Array.from({ length: 4 }, (_, i) => ({
            x: kStartX + i * (kw + kGap),
            y: kY,
            w: kw,
            h: kh,
        }));

        // 指示灯（琴键上方，3颗对应1/2/3档）
        g.leds = [1, 2, 3].map(i => ({
            cx: g.keys[i].x + kw / 2,
            cy: kY - g.base.rh * 0.35,
            r: W * 0.016,
        }));

        this._geo = g;
    }

    // ═══════════════════════════════════════════
    _init() {
        this._drawBase();
        this._drawPole();
        this._drawGuard();
        this._buildBladeGroup();
        this._drawHub();
        this._drawKeys();
        this._drawLEDs();
        this._drawLabel();
        
    }

    // ── 底座 ─────────────────────────────────
    _drawBase() {
        const { base } = this._geo;
        const W = this.width;

        // 底座阴影
        this._staticGroup.add(new Konva.Ellipse({
            x: base.cx + 4, y: base.cy + 8,
            radiusX: base.rw * 0.90, radiusY: base.rh * 0.55,
            fill: 'rgba(0,0,0,0.18)',
        }));

        // 底座主体（椭圆圆角矩形感，用椭圆近似）
        this._baseShape = new Konva.Ellipse({
            x: base.cx, y: base.cy,
            radiusX: base.rw, radiusY: base.rh,
            fillLinearGradientStartPoint: { x: -base.rw, y: -base.rh },
            fillLinearGradientEndPoint:   { x: base.rw,  y: base.rh  },
            fillLinearGradientColorStops: [
                0, '#d8dce0', 0.4, '#ececf0', 0.7, '#dde0e5', 1, '#c8ccd2',
            ],
            stroke: '#b0b4bc', strokeWidth: 1.5,
            shadowColor: '#000', shadowBlur: 6, shadowOffsetY: 3, shadowOpacity: 0.2,
        });
        this._staticGroup.add(this._baseShape);

        // 底座顶面高光
        this._staticGroup.add(new Konva.Ellipse({
            x: base.cx, y: base.cy - base.rh * 0.30,
            radiusX: base.rw * 0.78, radiusY: base.rh * 0.32,
            fill: 'rgba(255,255,255,0.22)',
        }));

        // 底座装饰点（4颗小圆钉）
        const dotY = base.cy + base.rh * 0.35;
        [-base.rw * 0.30, -base.rw * 0.10, base.rw * 0.10, base.rw * 0.30].forEach(dx => {
            this._staticGroup.add(new Konva.Circle({
                x: base.cx + dx, y: dotY, radius: W * 0.012,
                fill: '#b0b4bc', stroke: '#9aa0a8', strokeWidth: 0.6,
            }));
        });
    }

    // ── 立柱 ─────────────────────────────────
    _drawPole() {
        const { poleX, poleY, poleW, poleH } = this._geo;
        // 立柱主体
        this._staticGroup.add(new Konva.Rect({
            x: poleX, y: poleY, width: poleW, height: poleH,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: poleW, y: 0 },
            fillLinearGradientColorStops: [
                0, '#b0b6be', 0.30, '#d8dde4', 0.60, '#e8ecf0', 0.80, '#c8cdd4', 1, '#a8aeb6',
            ],
            stroke: '#9aa0a8', strokeWidth: 1,
            cornerRadius: poleW * 0.20,
        }));
        // 高光线
        this._staticGroup.add(new Konva.Line({
            points: [poleX + poleW * 0.32, poleY + 4, poleX + poleW * 0.32, poleY + poleH - 4],
            stroke: 'rgba(255,255,255,0.40)', strokeWidth: 1.5, lineCap: 'round',
        }));
    }

    // ── 网罩 ─────────────────────────────────
    _drawGuard() {
        const { guardCX, guardCY, guardR } = this._geo;

        // 网罩外环
        this._staticGroup.add(new Konva.Circle({
            x: guardCX, y: guardCY, radius: guardR,
            fill: 'rgba(240,242,245,0.0)',
            stroke: '#c8cdd4', strokeWidth: guardR * 0.045,
            shadowColor: '#000', shadowBlur: 10, shadowOpacity: 0.15,
        }));
        // 外环内侧细环
        this._staticGroup.add(new Konva.Circle({
            x: guardCX, y: guardCY, radius: guardR * 0.94,
            fill: 'transparent', stroke: '#d4d8de', strokeWidth: guardR * 0.022,
        }));

        // 辐条（18根均匀分布）
        const spokeCount = 18;
        for (let i = 0; i < spokeCount; i++) {
            const ang = (i / spokeCount) * Math.PI * 2;
            this._staticGroup.add(new Konva.Line({
                points: [
                    guardCX + Math.cos(ang) * guardR * 0.10,
                    guardCY + Math.sin(ang) * guardR * 0.10,
                    guardCX + Math.cos(ang) * guardR * 0.93,
                    guardCY + Math.sin(ang) * guardR * 0.93,
                ],
                stroke: '#cdd1d8', strokeWidth: 0.9,
            }));
        }

        // 同心圆（5圈）
        [0.22, 0.38, 0.54, 0.70, 0.82].forEach(ratio => {
            this._staticGroup.add(new Konva.Circle({
                x: guardCX, y: guardCY, radius: guardR * ratio,
                fill: 'transparent', stroke: '#cdd1d8', strokeWidth: 0.9,
            }));
        });
    }

    // ── 叶片组（动态，可旋转）────────────────
    _buildBladeGroup() {
        const { hubCX, hubCY, hubR, bladeR } = this._geo;

        this._bladeGroup = new Konva.Group({ x: hubCX, y: hubCY });

        // 三片叶片，间隔 120°
        this._bladeShapes = [];
        for (let i = 0; i < 3; i++) {
            const baseAng = (i / 3) * Math.PI * 2;
            const blade   = this._buildBlade(baseAng, hubR, bladeR);
            this._bladeGroup.add(blade);
            this._bladeShapes.push(blade);
        }

        // 运动模糊圆盘（高速时叠加）
        this._blurDisk = new Konva.Circle({
            radius: bladeR * 0.96,
            fill: 'rgba(110,196,190,0)',   // 初始透明
        });
        this._bladeGroup.add(this._blurDisk);

        this._staticGroup.add(this._bladeGroup);
    }

    _buildBlade(baseAngle, hubR, bladeR) {
        // 一片叶片：以中心为原点，沿 baseAngle 方向延伸的水滴/桨叶形状
        // 用 Path（贝塞尔）绘制扇叶外形，具有翘曲感
        const bx = Math.cos(baseAngle);
        const by = Math.sin(baseAngle);
        // 垂直方向
        const px = -by, py = bx;

        // 叶片宽度
        const halfW = bladeR * 0.38;
        // 关键点（相对于中心原点）
        const tip   = { x: bx * bladeR,          y: by * bladeR          };
        const left  = { x: bx * hubR * 1.1 + px * halfW * 0.85,
                        y: by * hubR * 1.1 + py * halfW * 0.85 };
        const right = { x: bx * hubR * 1.1 - px * halfW * 0.85,
                        y: by * hubR * 1.1 - py * halfW * 0.85 };
        const midL  = { x: bx * bladeR * 0.52 + px * halfW,
                        y: by * bladeR * 0.52 + py * halfW };
        const midR  = { x: bx * bladeR * 0.52 - px * halfW * 0.55,
                        y: by * bladeR * 0.52 - py * halfW * 0.55 };

        const pathData = [
            `M ${left.x} ${left.y}`,
            `Q ${midL.x} ${midL.y} ${tip.x} ${tip.y}`,
            `Q ${midR.x} ${midR.y} ${right.x} ${right.y}`,
            `Z`,
        ].join(' ');

        const blade = new Konva.Path({
            data: pathData,
            fillLinearGradientStartPoint: { x: 0, y: -bladeR * 0.5 },
            fillLinearGradientEndPoint:   { x: 0, y:  bladeR * 0.5 },
            fillLinearGradientColorStops: [
                0,   '#9adad6',
                0.35,'#6ec4be',
                0.65,'#5bb8b2',
                1,   '#4aacaa',
            ],
            stroke: '#3a9490', strokeWidth: 0.8,
            opacity: 0.92,
        });

        // 叶片高光（中轴线）
        const hlGrp = new Konva.Group();
        hlGrp.add(blade);
        hlGrp.add(new Konva.Line({
            points: [
                bx * hubR * 1.4 + px * halfW * 0.15,
                by * hubR * 1.4 + py * halfW * 0.15,
                bx * bladeR * 0.85 + px * halfW * 0.08,
                by * bladeR * 0.85 + py * halfW * 0.08,
            ],
            stroke: 'rgba(255,255,255,0.32)', strokeWidth: 1.5, lineCap: 'round',
        }));

        return hlGrp;
    }

    // ── 中心毂 ────────────────────────────────
    _drawHub() {
        const { hubCX, hubCY, hubR } = this._geo;
        // 毂主体
        this._staticGroup.add(new Konva.Circle({
            x: hubCX, y: hubCY, radius: hubR,
            fillRadialGradientStartPoint: { x: -hubR * 0.2, y: -hubR * 0.2 },
            fillRadialGradientStartRadius: 0,
            fillRadialGradientEndPoint:   { x: 0, y: 0 },
            fillRadialGradientEndRadius:  hubR,
            fillRadialGradientColorStops: [
                0, '#e8eaed', 0.5, '#c8cdd4', 1, '#a8adb6',
            ],
            stroke: '#9aa0a8', strokeWidth: 1.2,
            shadowColor: '#000', shadowBlur: 5, shadowOpacity: 0.25,
        }));
        // 毂中心小圆
        this._staticGroup.add(new Konva.Circle({
            x: hubCX, y: hubCY, radius: hubR * 0.30,
            fill: '#b8bec6', stroke: '#9aa0a8', strokeWidth: 0.8,
        }));
    }

    // ── 琴键 ──────────────────────────────────
    _drawKeys() {
        const { keys } = this._geo;
        const labels   = ['电源', '低速', '中速', '高速'];
        // 颜色方案：电源=红，低=绿，中=蓝，高=橙
        this._keyColors = ['#e53935', '#43a047', '#1e88e5', '#fb8c00'];

        this._keyGroups = [];
        keys.forEach((k, i) => {
            const grp    = new Konva.Group({ x: k.x, y: k.y });
            const isDown = this._isKeyDown(i);
            const pressOffset = isDown ? 4 : 0;

            // 键盖阴影（键未按下时可见）
            const shadow = new Konva.Rect({
                x: 0, y: k.h - 2, width: k.w, height: 4,
                fill: 'rgba(0,0,0,0.15)', cornerRadius: [0, 0, 3, 3],
            });
            // 键盖主体
            const body = new Konva.Rect({
                x: 0, y: pressOffset, width: k.w, height: k.h - pressOffset,
                fillLinearGradientStartPoint: { x: 0, y: 0 },
                fillLinearGradientEndPoint:   { x: 0, y: k.h },
                fillLinearGradientColorStops: isDown
                    ? [0, this._keyColors[i], 0.6, this._darken(this._keyColors[i]), 1, this._darken(this._keyColors[i])]
                    : [0, '#dde0e5', 0.5, '#c8ccd2', 1, '#b8bcc4'],
                stroke: isDown ? this._darken(this._keyColors[i]) : '#a8aeb6',
                strokeWidth: 1,
                cornerRadius: 3,
            });
            // 键顶高光
            const hl = new Konva.Rect({
                x: 2, y: pressOffset + 2, width: k.w - 4, height: k.h * 0.28,
                fill: 'rgba(255,255,255,0.22)', cornerRadius: [2, 2, 0, 0],
            });
            // 键标文字
            const txt = new Konva.Text({
                x: 0, y: pressOffset + k.h * 0.35,
                width: k.w, text: labels[i],
                fontSize: k.w * 0.28, fontStyle: 'bold', align: 'center',
                fill: isDown ? '#fff' : '#606878',
            });

            grp.add(shadow, body, hl, txt);
            grp._body = body; grp._hl = hl; grp._txt = txt; grp._shadow = shadow;

            // 点击交互
            grp.on('click tap', () => this._onKeyClick(i));
            grp.listening(true);

            this._keyGroups.push(grp);
            this._interactGroup.add(grp);
        });
    }

    _isKeyDown(i) {
        if (i === 0) return this._powered;          // 电源键：通电=按下
        return this._powered && this._gear === i;   // 档位键：当前档=按下
    }

    _darken(hex) {
        const n = parseInt(hex.slice(1), 16);
        const r = Math.max(0, (n >> 16) - 50);
        const g = Math.max(0, ((n >> 8) & 0xff) - 50);
        const b = Math.max(0, (n & 0xff) - 50);
        return `rgb(${r},${g},${b})`;
    }

    _updateKeys() {
        const { keys } = this._geo;
        keys.forEach((k, i) => {
            const grp    = this._keyGroups[i];
            if (!grp) return;
            const isDown = this._isKeyDown(i);
            const off    = isDown ? 4 : 0;

            grp._body.y(off);
            grp._body.height(k.h - off);
            grp._hl.y(off + 2);
            grp._txt.y(off + k.h * 0.35);
            grp._shadow.visible(!isDown);

            if (isDown) {
                grp._body.fillLinearGradientColorStops([
                    0, this._keyColors[i], 0.6, this._darken(this._keyColors[i]), 1, this._darken(this._keyColors[i]),
                ]);
                grp._body.stroke(this._darken(this._keyColors[i]));
                grp._txt.fill('#fff');
            } else {
                grp._body.fillLinearGradientColorStops([0, '#dde0e5', 0.5, '#c8ccd2', 1, '#b8bcc4']);
                grp._body.stroke('#a8aeb6');
                grp._txt.fill('#606878');
            }
        });
    }

    _onKeyClick(i) {
        if (i === 0) {
            // 电源键
            if (this._powered) {
                this._powered = false;
                this._gear    = 0;
            } else {
                this._powered = true;
                this._gear    = this._lastGear || 1;
            }
        } else {
            // 档位键 1/2/3
            if (!this._powered) {
                this._powered = true;
            }
            this._gear     = i;
            this._lastGear = i;
        }
        this._updateKeys();
        this._updateLEDs();
    }

    // ── 指示灯 ────────────────────────────────
    _drawLEDs() {
        const { leds } = this._geo;
        this._ledShapes = leds.map((led, i) => {
            const gear   = i + 1;
            const active = this._powered && this._gear === gear;
            const colors = ['#43a047', '#1e88e5', '#fb8c00'];
            const c      = colors[i];
            const shape  = new Konva.Circle({
                x: led.cx, y: led.cy, radius: led.r,
                fill:   active ? c : '#3a3e46',
                stroke: active ? c : '#505560',
                strokeWidth: 0.8,
                shadowColor:   c,
                shadowBlur:    active ? 8 : 0,
                shadowOpacity: 0.8,
            });
            this._staticGroup.add(shape);
            return { shape, color: c };
        });
    }

    _updateLEDs() {
        this._ledShapes.forEach(({ shape, color }, i) => {
            const active = this._powered && this._gear === i + 1;
            shape.fill(active ? color : '#3a3e46');
            shape.stroke(active ? color : '#505560');
            shape.shadowBlur(active ? 8 : 0);
        });
    }

    // ── 标注 ─────────────────────────────────
    _drawLabel() {
        const W = this.width;
        this._staticGroup.add(new Konva.Text({
            x: 0, y: -16, width: W,
            text: `${this.label}  台式电风扇  ${this.ratedVoltage}V / ${this.ratedPower}W`,
            fontSize: 9, fontStyle: 'bold', fill: '#546e7a', align: 'center',
        }));

        // 端子标注
        const b = this._geo.base;
        this._staticGroup.add(new Konva.Text({
            x: b.cx - b.rw * 0.60, y: b.cy + b.rh + 5,
            text: 'L', fontSize: 8, fontStyle: 'bold', fill: '#ef9a9a',
        }));
        this._staticGroup.add(new Konva.Text({
            x: b.cx + b.rw * 0.52, y: b.cy + b.rh + 5,
            text: 'N', fontSize: 8, fontStyle: 'bold', fill: '#90caf9',
        }));
    }

    // ═══════════════════════════════════════════
    // 主动画循环
    // 集中化 tick（由 consys._tickAll 在 20fps 调用）
    tick(dt) {
        this._tickAnim(dt);
    
        this._refreshCache();
    }
    _tickAnim(dt) {
        if (!this._powered || this._gear === 0) {
            // 惯性减速
            if (Math.abs(this._omega) > 0.01) {
                this._omega = (this._omega || 0) * (1 - dt * 3.5);
            } else {
                this._omega = 0;
            }
        } else {
            // 目标角速度
            const targetRPM = this._speedRPM[this._gear];
            const targetOmega = targetRPM / 60 * Math.PI * 2;
            this._omega = this._omega || 0;
            // 平滑加速
            this._omega += (targetOmega - this._omega) * dt * 2.5;
        }

        this._bladeAngle += (this._omega || 0) * dt;

        // 更新叶片旋转
        this._bladeGroup.rotation(this._bladeAngle * 180 / Math.PI);

        // 运动模糊圆盘：转速越高透明度越高
        const blurAlpha = Math.min(0.55, Math.max(0, (Math.abs(this._omega || 0) - 8) / 18));
        this._blurDisk.fill(`rgba(110,196,190,${blurAlpha.toFixed(3)})`);
        // 高速时叶片本体渐隐
        this._bladeShapes.forEach(b => b.opacity(Math.max(0.15, 1 - blurAlpha * 1.5)));

        this._refreshCache();
    }

    // ═══════════════════════════════════════════
    // 公开 API
    /** 开机，可指定档位 */
    powerOn(gear = 1)  {
        this._powered = true;
        this._gear    = Math.max(1, Math.min(3, gear));
        this._lastGear = this._gear;
        this._updateKeys(); this._updateLEDs();
    }

    /** 关机 */
    powerOff() {
        this._powered = false; this._gear = 0;
        this._updateKeys(); this._updateLEDs();
    }

    /** 设置档位（1/2/3）*/
    setGear(gear) {
        if (gear < 1 || gear > 3) return;
        if (!this._powered) this._powered = true;
        this._gear = gear; this._lastGear = gear;
        this._updateKeys(); this._updateLEDs();
    }

    isPowered() { return this._powered; }
    getGear()   { return this._gear; }
    getRPM()    { return this._powered ? this._speedRPM[this._gear] : 0; }

    update(state) {
        if (typeof state === 'boolean') {
            state ? this.powerOn(this._lastGear || 1) : this.powerOff();
        } else if (typeof state === 'number') {
            state === 0 ? this.powerOff() : this.setGear(state);
        }
        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label: '位号/名称',       key: 'label',         type: 'text'   },
            { label: '额定电压 (V)',     key: 'ratedVoltage',  type: 'number' },
            { label: '额定功率 (W)',     key: 'ratedPower',    type: 'number' },
            { label: '初始开机(1=开)',   key: 'initPowered',   type: 'number' },
            { label: '初始档位 (1~3)',   key: 'initGear',      type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label)        this.label        = cfg.label;
        if (cfg.ratedVoltage) this.ratedVoltage = parseFloat(cfg.ratedVoltage);
        if (cfg.ratedPower)   this.ratedPower   = parseFloat(cfg.ratedPower);
        if (cfg.initPowered !== undefined) {
            parseInt(cfg.initPowered) ? this.powerOn(this._lastGear || 1) : this.powerOff();
        }
        if (cfg.initGear !== undefined) this.setGear(parseInt(cfg.initGear));
        this.config = { ...this.config, ...cfg };
        this._refreshCache();
    }

    destroy() {
        super.destroy?.();
    }
}