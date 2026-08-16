import { BaseComponent } from './BaseComponent.js';

/**
 * 三相空气开关仿真组件
 * （3-Phase Miniature Circuit Breaker / MCB）
 *
 * ── 外观参考 ──────────────────────────────────────────────────
 *
 *  参考正泰 NXB-63 C63 三相断路器，白色外壳 + 蓝色把手，正视图。
 *  三极并排，共用一个联动操作手柄，整体比例与实物一致。
 *
 * ── 结构说明 ──────────────────────────────────────────────────
 *
 *  1. 外壳（Housing）
 *     三极并排的白色工程塑料壳体，左极带品牌铭牌区域
 *     外壳轮廓：圆角矩形，顶部略宽（接线端子区域）
 *     壳体之间有竖向分隔线（极间隔板）
 *
 *  2. 顶部接线端子区（Top Terminal）
 *     三极各自顶部有进线螺旋端子：
 *     - 黄绿色六角螺钉头（接线螺母）
 *     - 螺钉下方的铜排压板
 *     - 端子区域略突出壳体顶面
 *
 *  3. 底部接线端子区（Bottom Terminal）
 *     三极各自底部有出线端子，结构与顶部相同
 *
 *  4. 状态指示窗口（Status Window）
 *     每极壳体上部中央有一个矩形绿色小窗（ON 状态绿色，OFF 状态红色）
 *     窗内有 ON / OFF 文字
 *
 *  5. 联动手柄（Operating Handle）
 *     横跨三极的蓝色矩形手柄（拨片），可上下拨动：
 *     - 上位（UP）：合闸（ON）— 手柄在壳体上方偏上
 *     - 下位（DOWN）：分闸（OFF）— 手柄在壳体中部偏下
 *     手柄两端有圆弧收口，表面有横向防滑纹
 *     手柄侧面标注"↑ ON / ↓ OFF"
 *     手柄颜色：正泰蓝（#1976d2）
 *
 *  6. 品牌铭牌区（Nameplate）
 *     左极壳体上印有：
 *     - 品牌名（默认 CHNT）
 *     - 型号（默认 NXB-63）
 *     - 规格（C63 / 400V~ / 50Hz / 6000A）
 *     - 认证标志（CCC）
 *
 *  7. 跳闸状态（Tripped）
 *     过载/短路保护动作时，手柄弹至中间位置（中位）
 *     状态窗显示橙色，提示需要复位
 *     调用 reset() 后恢复至 OFF 位，再 close() 重新合闸
 *
 * ── 手柄位置定义 ─────────────────────────────────────────────
 *
 *  _handlePos:
 *    'ON'      → 手柄上位（合闸），Y 偏移 = 0
 *    'OFF'     → 手柄下位（分闸），Y 偏移 = +handleTravel
 *    'TRIPPED' → 手柄中位（跳闸），Y 偏移 = +handleTravel/2
 *
 *  动画：手柄在三个位置间以 150ms 正弦缓动平滑过渡
 *
 * ── 交互方式 ─────────────────────────────────────────────────
 *
 *  · 点击手柄：在 ON ↔ OFF 之间切换（若当前为 TRIPPED，仅允许切至 OFF）
 *  · 调用 close()   → ON
 *  · 调用 open()    → OFF
 *  · 调用 trip()    → TRIPPED（模拟过载跳闸）
 *  · 调用 reset()   → TRIPPED → OFF（复位）
 *  · 调用 toggle()  → ON ↔ OFF
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  terminal_l1_in  — L1 进线（顶部左极）
 *  terminal_l2_in  — L2 进线（顶部中极）
 *  terminal_l3_in  — L3 进线（顶部右极）
 *  terminal_l1_out — L1 出线（底部左极）
 *  terminal_l2_out — L2 出线（底部中极）
 *  terminal_l3_out — L3 出线（底部右极）
 */
export class ThreePhaseBreaker extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(180, config.width  || 220);
        this.height = Math.max(280, config.height || 340);

        this.type    = 'three_phase_breaker';
        this.special = 'none';
        this.cache   = 'fixed';

        // ── 铭牌参数 ──
        this.label        = config.label        || 'QF';
        this.brand        = config.brand        || 'CHNT';
        this.model        = config.model        || 'NXB-63';
        this.ratedVoltage = config.ratedVoltage || 400;    // V
        this.ratedCurrent = config.ratedCurrent || 63;     // A
        this.breakingCap  = config.breakingCap  || 6000;   // A 分断能力

        // ── 状态 ──
        // 'ON' | 'OFF' | 'TRIPPED'
        this._state     = config.initState || 'OFF';
        this._animating = false;
        this._animT     = 0;
        this._animDur   = 0.15;       // s
        this._handleY   = 0;          // 当前手柄 Y 偏移（像素，动画驱动）
        this._targetY   = 0;          // 目标 Y 偏移
        this.opsCount   = config.initOps || 0;


        this._calcGeometry();
        this._init();

        // ── 端口（六个） ──
        const g = this._geo;
        ['l1','l2','l3'].forEach((ph, i) => {
            const cx = g.poles[i].cx;
            this.addPort(cx, 0,         `terminal_${ph}_in`,  'wire', ph.toUpperCase()+'+');
            this.addPort(cx, this.height, `terminal_${ph}_out`, 'wire', ph.toUpperCase()+'-');
        });
    }

    // ═══════════════════════════════════════════
    _calcGeometry() {
        const W = this.width, H = this.height;
        const g = {};

        // 三极并排尺寸
        const poleCount = 3;
        g.bodyX = W * 0.04;
        g.bodyY = H * 0.05;
        g.bodyW = W * 0.92;
        g.bodyH = H * 0.90;
        g.poleW = g.bodyW / poleCount;  // 每极宽度

        // 每极中心 X
        g.poles = Array.from({ length: poleCount }, (_, i) => ({
            cx: g.bodyX + g.poleW * (i + 0.5),
            x:  g.bodyX + g.poleW * i,
        }));

        // 接线端子区（顶/底各 15%）
        g.termH    = g.bodyH * 0.130;
        g.termTopY = g.bodyY;
        g.termBotY = g.bodyY + g.bodyH - g.termH;

        // 状态指示窗（端子区下方）
        g.winW  = g.poleW * 0.38;
        g.winH  = g.bodyH * 0.060;
        g.winY  = g.termTopY + g.termH + g.bodyH * 0.020;

        // 手柄区域（壳体中段）
        g.handleX      = g.bodyX;
        g.handleW      = g.bodyW;
        g.handleH      = g.bodyH * 0.175;
        g.handleYonPos = g.termTopY + g.termH + g.winH + g.bodyH * 0.055;  // ON 上位
        g.handleTravel = g.bodyH * 0.115;   // 从 ON 到 OFF 的行程

        // 铭牌区（左极，指示窗以下，手柄以上/以下文字区）
        g.plateX = g.poles[0].x + g.poleW * 0.04;
        g.plateY = g.winY + g.winH + g.bodyH * 0.015;
        g.plateW = g.poleW * 0.92;

        this._geo = g;
    }

    // ═══════════════════════════════════════════
    _init() {
        this._handleY  = this._stateToY(this._state);
        this._targetY  = this._handleY;

        this._drawBodyBackground();
        this._drawTerminals('top');
        this._drawTerminals('bottom');
        this._drawStatusWindows();
        this._drawNameplate();
        this._buildHandleGroup();
        this._drawDividers();
        this._drawLabel();
        
    }

    // ── 壳体背景 ─────────────────────────────
    _drawBodyBackground() {
        const g = this._geo;

        // 整体阴影
        this.group.add(new Konva.Rect({
            x: g.bodyX + 4, y: g.bodyY + 5,
            width: g.bodyW, height: g.bodyH,
            fill: 'rgba(0,0,0,0.22)',
            cornerRadius: 6,
        }));

        // 三极各自壳体（白色，有渐变质感）
        for (let i = 0; i < 3; i++) {
            const px = g.poles[i].x;
            const rx = i === 0 ? [5,0,0,5] : i === 2 ? [0,5,5,0] : 0;

            this.group.add(new Konva.Rect({
                x: px, y: g.bodyY,
                width: g.poleW, height: g.bodyH,
                fillLinearGradientStartPoint: { x: 0, y: 0 },
                fillLinearGradientEndPoint:   { x: g.poleW, y: 0 },
                fillLinearGradientColorStops: [
                    0,    '#c8cdd4',
                    0.06, '#e8ecf0',
                    0.18, '#f4f6f8',
                    0.50, '#ffffff',
                    0.82, '#f0f2f4',
                    0.94, '#e0e4e8',
                    1,    '#c0c6cc',
                ],
                stroke: '#a0a8b0', strokeWidth: 0.8,
                cornerRadius: rx,
            }));

            // 壳体顶面高光
            this.group.add(new Konva.Rect({
                x: px + 2, y: g.bodyY + 2,
                width: g.poleW - 4, height: g.bodyH * 0.04,
                fill: 'rgba(255,255,255,0.55)',
                cornerRadius: i === 0 ? [4,0,0,0] : i === 2 ? [0,4,0,0] : 0,
            }));
        }

        // 顶部蓝色装饰条（品牌配色带）
        this.group.add(new Konva.Rect({
            x: g.bodyX, y: g.bodyY,
            width: g.bodyW, height: g.bodyH * 0.022,
            fill: '#1976d2',
            cornerRadius: [5, 5, 0, 0],
        }));
    }

    // ── 接线端子（顶/底）─────────────────────
    _drawTerminals(pos) {
        const g    = this._geo;
        const isTop = pos === 'top';
        const ty   = isTop ? g.termTopY : g.termBotY;
        const th   = g.termH;

        for (let i = 0; i < 3; i++) {
            const px = g.poles[i].x;
            const cx = g.poles[i].cx;

            // 端子底座（灰色压板区）
            this.group.add(new Konva.Rect({
                x: px + g.poleW * 0.08, y: ty + th * 0.05,
                width: g.poleW * 0.84, height: th * 0.90,
                fillLinearGradientStartPoint: { x: 0, y: 0 },
                fillLinearGradientEndPoint:   { x: g.poleW*0.84, y: 0 },
                fillLinearGradientColorStops: [
                    0,'#a0a8b0', 0.30,'#c8d0d8', 0.60,'#d8e0e8', 0.85,'#b8c0c8', 1,'#909aa0',
                ],
                stroke: '#808890', strokeWidth: 0.8,
                cornerRadius: isTop ? [3,3,0,0] : [0,0,3,3],
            }));

            // 铜排压板（金黄色小矩形）
            const cpY = isTop ? ty + th*0.15 : ty + th*0.50;
            this.group.add(new Konva.Rect({
                x: px + g.poleW*0.22, y: cpY,
                width: g.poleW*0.56, height: th*0.28,
                fillLinearGradientStartPoint: { x: 0, y: 0 },
                fillLinearGradientEndPoint:   { x: g.poleW*0.56, y: 0 },
                fillLinearGradientColorStops: [
                    0,'#8a7028', 0.25,'#c8a840', 0.55,'#e8c858',
                    0.80,'#b89038', 1,'#806820',
                ],
                stroke: '#706020', strokeWidth: 0.7, cornerRadius: 2,
            }));
            // 铜排高光
            this.group.add(new Konva.Line({
                points: [px+g.poleW*0.30, cpY+2, px+g.poleW*0.70, cpY+2],
                stroke: 'rgba(255,255,255,0.25)', strokeWidth: 1,
            }));

            // 接线螺钉（黄绿色六角头）
            const screwY = isTop ? ty + th*0.28 : ty + th*0.62;
            const screwR = g.poleW * 0.165;
            // 六角外形（用正六边形）
            this.group.add(new Konva.RegularPolygon({
                x: cx, y: screwY,
                sides: 6, radius: screwR,
                fillRadialGradientStartPoint: { x: -screwR*0.25, y: -screwR*0.25 },
                fillRadialGradientStartRadius: 0,
                fillRadialGradientEndPoint: { x: 0, y: 0 },
                fillRadialGradientEndRadius: screwR,
                fillRadialGradientColorStops: [
                    0, '#d4e040', 0.40, '#b8c828', 0.75, '#909818', 1, '#686e10',
                ],
                stroke: '#505808', strokeWidth: 0.8,
                rotation: 30,
                shadowColor: '#000', shadowBlur: 3, shadowOpacity: 0.35,
            }));
            // 螺钉内圆（内六角孔）
            this.group.add(new Konva.Circle({
                x: cx, y: screwY, radius: screwR * 0.42,
                fill: '#3a4010', stroke: '#282c08', strokeWidth: 0.6,
            }));
            // 内六角十字线
            for (let k = 0; k < 3; k++) {
                const ka = k * 60 * Math.PI / 180;
                this.group.add(new Konva.Line({
                    points: [
                        cx + Math.cos(ka)*screwR*0.12, screwY + Math.sin(ka)*screwR*0.12,
                        cx + Math.cos(ka)*screwR*0.36, screwY + Math.sin(ka)*screwR*0.36,
                    ],
                    stroke: '#606810', strokeWidth: 1, lineCap: 'round',
                }));
            }
        }
    }

    // ── 状态指示窗口（三个，每极一个）────────
    _drawStatusWindows() {
        const g = this._geo;
        this._statusWindows = [];

        for (let i = 0; i < 3; i++) {
            const cx = g.poles[i].cx;
            const wx = cx - g.winW / 2;
            const wy = g.winY;

            // 窗框
            this.group.add(new Konva.Rect({
                x: wx - 1, y: wy - 1,
                width: g.winW + 2, height: g.winH + 2,
                fill: '#606870', cornerRadius: 2,
            }));

            // 窗口内容（动态，存引用）
            const win = new Konva.Rect({
                x: wx, y: wy,
                width: g.winW, height: g.winH,
                fill: this._windowColor(),
                cornerRadius: 1,
                shadowColor: this._windowColor(),
                shadowBlur: this._state === 'ON' ? 6 : 0,
                shadowOpacity: 0.8,
            });
            const winText = new Konva.Text({
                x: wx, y: wy + g.winH * 0.15,
                width: g.winW, text: this._windowText(),
                fontSize: g.winH * 0.52, fontStyle: 'bold',
                fill: '#fff', align: 'center',
            });

            this.group.add(win, winText);
            this._statusWindows.push({ win, winText });
        }
    }

    _windowColor() {
        if (this._state === 'ON')      return '#43a047';
        if (this._state === 'TRIPPED') return '#fb8c00';
        return '#e53935';
    }

    _windowText() {
        if (this._state === 'ON')      return 'ON';
        if (this._state === 'TRIPPED') return 'TRP';
        return 'OFF';
    }

    _updateStatusWindows() {
        const color = this._windowColor();
        const text  = this._windowText();
        const glow  = this._state === 'ON' ? 7 : (this._state === 'TRIPPED' ? 5 : 0);
        this._statusWindows?.forEach(({ win, winText }) => {
            win.fill(color);
            win.shadowColor(color);
            win.shadowBlur(glow);
            winText.text(text);
        });
    }

    // ── 极间分隔线 ────────────────────────────
    _drawDividers() {
        const g = this._geo;
        // 两条分隔线（极1|2 和 极2|3 之间）
        [1, 2].forEach(i => {
            const dx = g.bodyX + g.poleW * i;
            this.group.add(new Konva.Line({
                points: [dx, g.bodyY + 2, dx, g.bodyY + g.bodyH - 2],
                stroke: '#808890', strokeWidth: 1.0,
                dash: [4, 3],
            }));
        });
    }

    // ── 品牌铭牌（左极）─────────────────────
    _drawNameplate() {
        const g  = this._geo;
        const px = g.plateX, py = g.plateY;
        const pw = g.plateW;

        // 铭牌背景（淡灰）
        this.group.add(new Konva.Rect({
            x: px, y: py, width: pw, height: g.bodyH * 0.28,
            fill: 'rgba(240,242,245,0.0)',
        }));

        let lineY = py;
        const addLine = (txt, size, color, bold) => {
            this.group.add(new Konva.Text({
                x: px, y: lineY, width: pw,
                text: txt, fontSize: size,
                fontStyle: bold ? 'bold' : 'normal',
                fill: color,
            }));
            lineY += size * 1.35;
        };

        // 品牌名（蓝色大字）
        addLine(this.brand, g.poleW * 0.26, '#1565c0', true);
        // 型号
        addLine(this.model + '  ⊕', g.poleW * 0.18, '#1a1a2a', true);
        // 规格
        addLine(`C${this.ratedCurrent}`, g.poleW * 0.22, '#1a1a2a', true);
        addLine(`${this.ratedVoltage}V~`, g.poleW * 0.14, '#444', false);
        addLine('50Hz', g.poleW * 0.14, '#444', false);
        addLine(`${this.breakingCap}A`, g.poleW * 0.14, '#444', false);

        // ON/OFF 操作提示（小图标文字）
        const tipY = py + g.bodyH * 0.30;
        this.group.add(new Konva.Text({
            x: px, y: tipY, width: pw,
            text: '↑ ON\n↓ OFF',
            fontSize: g.poleW * 0.13,
            fill: '#607080', lineHeight: 1.4,
        }));
    }

    // ── 联动手柄（动态，存引用）──────────────
    _buildHandleGroup() {
        const g = this._geo;
        this._handleGroup = new Konva.Group();
        this._rebuildHandle();
        this.group.add(this._handleGroup);

        // 点击切换
        this._handleGroup.on('click tap', () => this.toggle());
        this._handleGroup.listening(true);
    }

    _rebuildHandle() {
        this._handleGroup.destroyChildren();
        const g   = this._geo;
        const hx  = g.handleX;
        const hy  = g.handleYonPos + this._handleY;
        const hw  = g.handleW;
        const hh  = g.handleH;
        const rx  = hh * 0.38;

        const isOn      = this._state === 'ON' || (this._animating && this._animDir > 0 && this._handleY < g.handleTravel * 0.4);
        const isTripped = this._state === 'TRIPPED';

        // 手柄阴影
        this._handleGroup.add(new Konva.Rect({
            x: hx + 3, y: hy + 4,
            width: hw, height: hh,
            fill: 'rgba(0,0,0,0.22)',
            cornerRadius: rx,
        }));

        // 手柄主体
        const handleColor = isTripped
            ? '#f57c00'
            : isOn ? '#1565c0' : '#1976d2';
        const handleDark  = isTripped ? '#e65100' : '#0d47a1';
        const handleLight = isTripped ? '#ff9800' : '#42a5f5';

        this._handleGroup.add(new Konva.Rect({
            x: hx, y: hy, width: hw, height: hh,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: 0, y: hh },
            fillLinearGradientColorStops: [
                0,   handleLight,
                0.25,'rgba(255,255,255,0.18)',
                0.30, handleColor,
                0.70, handleColor,
                0.85, handleDark,
                1,   handleDark,
            ],
            stroke: handleDark, strokeWidth: 1.2,
            cornerRadius: rx,
            shadowColor: handleColor,
            shadowBlur: isOn ? 8 : 4,
            shadowOpacity: 0.45,
        }));

        // 手柄顶面高光带
        this._handleGroup.add(new Konva.Rect({
            x: hx + 4, y: hy + 3,
            width: hw - 8, height: hh * 0.20,
            fill: 'rgba(255,255,255,0.28)',
            cornerRadius: [rx, rx, 0, 0],
        }));

        // 防滑横纹（7 条）
        const notchCount = 7;
        for (let n = 0; n < notchCount; n++) {
            const ny = hy + hh * 0.28 + n * (hh * 0.50 / notchCount);
            this._handleGroup.add(new Konva.Line({
                points: [hx + hw*0.06, ny, hx + hw*0.94, ny],
                stroke: 'rgba(0,0,0,0.18)', strokeWidth: 0.9,
            }));
            // 纹路高光
            this._handleGroup.add(new Konva.Line({
                points: [hx + hw*0.06, ny+1, hx + hw*0.94, ny+1],
                stroke: 'rgba(255,255,255,0.10)', strokeWidth: 0.6,
            }));
        }

        // 手柄两端圆弧凸起（立体感）
        [-1, 1].forEach(side => {
            const ex = side > 0 ? hx + hw - rx*0.6 : hx + rx*0.6;
            this._handleGroup.add(new Konva.Ellipse({
                x: ex, y: hy + hh/2,
                radiusX: rx * 0.55, radiusY: hh * 0.42,
                fill: side > 0 ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.12)',
            }));
        });

        // 中心三个极连接块（手柄覆盖区域的每极联动部件）
        for (let i = 0; i < 3; i++) {
            const cx = g.poles[i].cx;
            const bw = g.poleW * 0.50;
            this._handleGroup.add(new Konva.Rect({
                x: cx - bw/2, y: hy + hh*0.35,
                width: bw, height: hh*0.30,
                fill: 'rgba(255,255,255,0.14)',
                stroke: 'rgba(255,255,255,0.10)', strokeWidth: 0.6,
                cornerRadius: 2,
            }));
        }

        // ON/OFF 位置文字（手柄上）
        this._handleGroup.add(new Konva.Text({
            x: hx + hw * 0.72, y: hy + hh * 0.32,
            text: isTripped ? 'TRIP' : (isOn ? 'ON' : 'OFF'),
            fontSize: g.poleW * 0.16, fontStyle: 'bold',
            fill: 'rgba(255,255,255,0.75)',
        }));
    }

    // ── 组件标注 ─────────────────────────────
    _drawLabel() {
        const W = this.width;
        this.group.add(new Konva.Text({
            x: 0, y: -16, width: W,
            text: `${this.label}  三相断路器  ${this.ratedVoltage}V / ${this.ratedCurrent}A`,
            fontSize: 9, fontStyle: 'bold', fill: '#546e7a', align: 'center',
        }));

        // 相序端子标注（顶部）
        const g = this._geo;
        ['L1', 'L2', 'L3'].forEach((ph, i) => {
            const cx = g.poles[i].cx;
            this.group.add(new Konva.Text({
                x: cx - 8, y: -2,
                text: ph, fontSize: 7.5, fontStyle: 'bold',
                fill: ['#ef9a9a','#fff59d','#90caf9'][i],
            }));
        });
        // 底部相序
        ['L1', 'L2', 'L3'].forEach((ph, i) => {
            const cx = g.poles[i].cx;
            this.group.add(new Konva.Text({
                x: cx - 8, y: this.height + 3,
                text: ph, fontSize: 7.5, fontStyle: 'bold',
                fill: ['#ef9a9a','#fff59d','#90caf9'][i],
            }));
        });
    }

    // ═══════════════════════════════════════════
    // 状态 → 手柄 Y 偏移
    _stateToY(state) {
        const g = this._geo;
        if (state === 'ON')      return 0;
        if (state === 'TRIPPED') return g.handleTravel * 0.50;
        return g.handleTravel;   // OFF
    }

    // ═══════════════════════════════════════════
    // 动画循环
    // 集中化 tick（由 consys._tickAll 在 20fps 调用）
    tick(dt) {
        this._tickAnimation(dt);
    }
    _tickAnimation(dt) {
        if (!this._animating) return;

        this._animT += dt / this._animDur;
        if (this._animT >= 1) {
            this._animT     = 1;
            this._animating = false;
            this._handleY   = this._targetY;
        } else {
            // 正弦缓动
            const ease    = 0.5 - 0.5 * Math.cos(this._animT * Math.PI);
            const startY  = this._animFromY;
            this._handleY = startY + (this._targetY - startY) * ease;
        }

        this._rebuildHandle();
        this._updateStatusWindows();
        this._refreshCache();
    }

    _startTransition(toState) {
        if (this._animating) return false;
        this._animFromY  = this._handleY;
        this._targetY    = this._stateToY(toState);
        this._animT      = 0;
        this._animating  = true;
        this._animDir    = this._targetY < this._animFromY ? 1 : -1;
        this._state      = toState;
        this.opsCount++;
        this._refreshCache();
        return true;
    }

    // ═══════════════════════════════════════════
    // 公开 API

    /** 切换 ON ↔ OFF（跳闸时仅切至 OFF）*/
    toggle() {
        if (this._animating) return;
        if (this._state === 'TRIPPED') {
            this._startTransition('OFF');
        } else {
            this._startTransition(this._state === 'ON' ? 'OFF' : 'ON');
        }
    }

    /** 合闸 → ON */
    close() {
        if (this._state === 'ON' || this._animating) return;
        if (this._state === 'TRIPPED') return;  // 需先 reset
        this._startTransition('ON');
    }

    /** 分闸 → OFF */
    open() {
        if (this._state === 'OFF' || this._animating) return;
        this._startTransition('OFF');
    }

    /** 模拟过载/短路跳闸 → TRIPPED */
    trip() {
        if (this._state === 'TRIPPED' || this._animating) return;
        this._startTransition('TRIPPED');
    }

    /** 跳闸复位 → OFF（必须先 reset 才能重新 close）*/
    reset() {
        if (this._state !== 'TRIPPED' || this._animating) return;
        this._startTransition('OFF');
    }

    getState()      { return this._state; }
    isClosed()      { return this._state === 'ON'; }
    isTripped()     { return this._state === 'TRIPPED'; }
    isAnimating()   { return this._animating; }
    getOpsCount()   { return this.opsCount; }

    update(state) {
        if (typeof state === 'boolean') {
            state ? this.close() : this.open();
        } else if (typeof state === 'string') {
            if (state === 'ON')      this.close();
            if (state === 'OFF')     this.open();
            if (state === 'TRIPPED') this.trip();
            if (state === 'RESET')   this.reset();
        }
        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label: '位号',              key: 'label',        type: 'text'   },
            { label: '品牌',              key: 'brand',        type: 'text'   },
            { label: '型号',              key: 'model',        type: 'text'   },
            { label: '额定电压 (V)',       key: 'ratedVoltage', type: 'number' },
            { label: '额定电流 (A)',       key: 'ratedCurrent', type: 'number' },
            { label: '分断能力 (A)',       key: 'breakingCap',  type: 'number' },
            { label: '初始状态(ON/OFF)',   key: 'initState',    type: 'text'   },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label)        this.label        = cfg.label;
        if (cfg.brand)        this.brand        = cfg.brand;
        if (cfg.model)        this.model        = cfg.model;
        if (cfg.ratedVoltage) this.ratedVoltage = parseFloat(cfg.ratedVoltage);
        if (cfg.ratedCurrent) this.ratedCurrent = parseFloat(cfg.ratedCurrent);
        if (cfg.breakingCap)  this.breakingCap  = parseFloat(cfg.breakingCap);
        if (cfg.initState)    this.update(cfg.initState);
        this.config = { ...this.config, ...cfg };
        this._refreshCache();
    }

    destroy() {
        super.destroy?.();
    }
}