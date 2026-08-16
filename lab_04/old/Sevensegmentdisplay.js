import { BaseComponent } from './BaseComponent.js';

/**
 * 七段数码显示管仿真组件
 * （Seven-Segment Display）
 *
 * ── 结构说明 ──────────────────────────────────────────────────
 *
 *  七段数码管是由 7 个 LED 发光段（a~g）和 1 个小数点（dp）组成的
 *  数字显示器件，标准引脚排列参考 5161AS（共阴）/ 5161BS（共阳）。
 *
 *  段排列（标准命名）：
 *
 *       aaa
 *      f   b
 *      f   b
 *       ggg
 *      e   c
 *      e   c
 *       ddd   .dp
 *
 *  1. 封装外壳（DIP-10 Package）：
 *     - 黑色矩形背景，正面深灰色显示面板
 *     - 红色/绿色/黄色/蓝色 LED 发光段（可配置颜色）
 *     - 段熄灭时呈深暗色，导通时呈亮色并有光晕
 *
 *  2. 引脚排列（DIP-10，底部 5+5）：
 *     - 下排（左→右）：pin1(e), pin2(d), pin3=COM, pin4(c), pin5(dp)
 *     - 上排（左→右）：pin10(f), pin9(a), pin8=COM, pin7(b), pin6(g)
 *     - COM：共阴为 GND，共阳为 VCC
 *
 *  3. 显示面板：
 *     - 七段均为八角形（扁六边形）形态，更接近真实 LED 段外观
 *     - 小数点为圆形
 *     - 未亮段保留暗色轮廓，体现器件真实外观
 *
 * ── 工作原理 ──────────────────────────────────────────────────
 *
 *  共阴（Common Cathode）模式（默认）：
 *    - COM 引脚接 GND
 *    - 各段引脚输入高电平 → 对应段点亮
 *    - segments 对象中值为 true → 点亮，false → 熄灭
 *
 *  共阳（Common Anode）模式：
 *    - COM 引脚接 VCC
 *    - 各段引脚输入低电平 → 对应段点亮（逻辑取反）
 *
 *  支持直接输入数字（0-9）、字母（A/b/C/d/E/F/H/L/P/U）或自定义段码。
 *
 * ── 数字 / 字符 段码表 ────────────────────────────────────────
 *
 *   '0': a b c d e f     '1': b c         '2': a b d e g
 *   '3': a b c d g       '4': b c f g     '5': a c d f g
 *   '6': a c d e f g     '7': a b c       '8': a b c d e f g
 *   '9': a b c d f g     'A': a b c e f g 'b': c d e f g
 *   'C': a d e f         'd': b c d e g   'E': a d e f g
 *   'F': a e f g         'H': b c e f g   'L': d e f
 *   'P': a b e f g       'U': b c d e f   '-': g only
 *
 * ── 动画效果 ──────────────────────────────────────────────────
 *
 *  段亮起：100ms 渐亮过渡 + 橙红/绿/蓝色光晕（可配色）
 *  段熄灭：80ms 渐暗过渡
 *  数字切换：各段独立过渡，无整体闪烁
 *  闪烁模式：可启用全体段以 blink 频率（默认 1Hz）闪烁
 *  流水灯模式：段依次循环点亮（演示模式）
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  seg_a  — 段 a（顶横段）
 *  seg_b  — 段 b（右上竖段）
 *  seg_c  — 段 c（右下竖段）
 *  seg_d  — 段 d（底横段）
 *  seg_e  — 段 e（左下竖段）
 *  seg_f  — 段 f（左上竖段）
 *  seg_g  — 段 g（中横段）
 *  seg_dp — 小数点
 *  com    — 公共端（共阴GND / 共阳VCC）
 */
export class SevenSegmentDisplay extends BaseComponent {

    // ── 颜色预设 ──────────────────────────────
    static COLOR_PRESETS = {
        red:    { lit: '#ff3a1a', glow: '#ff2000', dim: '#3a1010', panel: '#1a0808' },
        green:  { lit: '#30ff60', glow: '#10ff40', dim: '#0e3018', panel: '#081408' },
        yellow: { lit: '#ffee10', glow: '#ffcc00', dim: '#383010', panel: '#181408' },
        blue:   { lit: '#30a0ff', glow: '#1080ff', dim: '#0e2040', panel: '#080c18' },
        white:  { lit: '#e8f4ff', glow: '#ffffff', dim: '#303438', panel: '#181c20' },
        orange: { lit: '#ff8020', glow: '#ff6000', dim: '#382010', panel: '#180c04' },
    };

    // ── 字符段码表（段名: a b c d e f g）──────
    static CHAR_MAP = {
        '0': { a:1,b:1,c:1,d:1,e:1,f:1,g:0 },
        '1': { a:0,b:1,c:1,d:0,e:0,f:0,g:0 },
        '2': { a:1,b:1,c:0,d:1,e:1,f:0,g:1 },
        '3': { a:1,b:1,c:1,d:1,e:0,f:0,g:1 },
        '4': { a:0,b:1,c:1,d:0,e:0,f:1,g:1 },
        '5': { a:1,b:0,c:1,d:1,e:0,f:1,g:1 },
        '6': { a:1,b:0,c:1,d:1,e:1,f:1,g:1 },
        '7': { a:1,b:1,c:1,d:0,e:0,f:0,g:0 },
        '8': { a:1,b:1,c:1,d:1,e:1,f:1,g:1 },
        '9': { a:1,b:1,c:1,d:1,e:0,f:1,g:1 },
        'A': { a:1,b:1,c:1,d:0,e:1,f:1,g:1 },
        'b': { a:0,b:0,c:1,d:1,e:1,f:1,g:1 },
        'C': { a:1,b:0,c:0,d:1,e:1,f:1,g:0 },
        'd': { a:0,b:1,c:1,d:1,e:1,f:0,g:1 },
        'E': { a:1,b:0,c:0,d:1,e:1,f:1,g:1 },
        'F': { a:1,b:0,c:0,d:0,e:1,f:1,g:1 },
        'H': { a:0,b:1,c:1,d:0,e:1,f:1,g:1 },
        'L': { a:0,b:0,c:0,d:1,e:1,f:1,g:0 },
        'P': { a:1,b:1,c:0,d:0,e:1,f:1,g:1 },
        'U': { a:0,b:1,c:1,d:1,e:1,f:1,g:0 },
        '-': { a:0,b:0,c:0,d:0,e:0,f:0,g:1 },
        ' ': { a:0,b:0,c:0,d:0,e:0,f:0,g:0 },
    };

    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(120, config.width  || 160);
        this.height = Math.max(180, config.height || 240);

        this.type    = 'seven_segment';
        this.special = 'none';
        this.cache   = 'fixed';

        this._initGroups();
        // ── 参数 ──
        this.label      = config.label      || 'SEG';
        this.colorName  = config.color      || 'red';
        this.commonMode = config.commonMode || 'cathode';  // 'cathode' | 'anode'
        this.blinkHz    = config.blinkHz    || 1.0;        // 闪烁频率
        this.brightness = config.brightness !== undefined ? config.brightness : 1.0;

        this._colors = SevenSegmentDisplay.COLOR_PRESETS[this.colorName]
                     || SevenSegmentDisplay.COLOR_PRESETS.red;

        // ── 各段亮度状态（0~1，支持渐变）──
        const segNames = ['a','b','c','d','e','f','g','dp'];
        this._segBrightness = {};  // 当前亮度
        this._segTarget     = {};  // 目标亮度
        segNames.forEach(s => {
            this._segBrightness[s] = 0;
            this._segTarget[s]     = 0;
        });

        // ── 模式 ──
        this._blinkMode   = config.blinkMode   || false;
        this._blinkT      = 0;
        this._blinkState  = true;  // 闪烁时当前显示/隐藏
        this._demoMode    = config.demoMode    || false;
        this._demoT       = 0;
        this._demoStep    = 0;
        this._demoDigits  = '0123456789AbCdEF'.split('');

        // ── 过渡速度（s）──
        this._riseTime = 0.10;  // 点亮时间
        this._fallTime = 0.08;  // 熄灭时间

        // ── 几何尺寸 ──
        const W = this.width, H = this.height;

        // 封装外壳
        this._pkgX = W * 0.06;
        this._pkgY = H * 0.05;
        this._pkgW = W * 0.88;
        this._pkgH = H * 0.72;

        // 显示面板（封装内部）
        this._panelX = this._pkgX + this._pkgW * 0.06;
        this._panelY = this._pkgY + this._pkgH * 0.06;
        this._panelW = this._pkgW * 0.88;
        this._panelH = this._pkgH * 0.88;

        // 七段布局参数（相对于显示面板）
        this._segSetup = this._calcSegGeometry();

        // 引脚
        this._pinH    = H * 0.16;
        this._pinW    = W * 0.030;
        this._pinTopY = this._pkgY + this._pkgH;
        // 5 个下排引脚，5 个上排引脚
        this._pinDefs = this._calcPinPositions();


        // 初始显示
        const initChar = config.initChar !== undefined ? String(config.initChar) : '8';
        this._applyChar(initChar, true);

        this._init();

        // ── 端口 ──
        this._pinDefs.forEach(p => {
            const portX = p.x;
            const portY = p.bottom ? this._pinTopY + this._pinH + 4
                                   : this._pkgY - this._pinH - 4;
            this.addPort(portX, portY, p.id, 'wire', p.label);
        });
    }

    // ── 计算七段几何坐标 ─────────────────────
    _calcSegGeometry() {
        const px = this._panelX, py = this._panelY;
        const pw = this._panelW, ph = this._panelH;
        const pad = pw * 0.07;

        // 显示区（去掉 dp 占位后的左侧数字区）
        const dw = pw * 0.76;      // 数字宽度
        const dh = ph * 0.90;      // 数字高度
        const dx = px + pad;       // 数字区左起点
        const dy = py + ph * 0.05; // 数字区上起点

        const sw = dw * 0.72;      // 横段宽度
        const sh = dh * 0.09;      // 横段高度（扁）
        const vw = sh * 0.95;      // 竖段宽度
        const vh = (dh - 3 * sh) / 2 * 0.88;  // 竖段高度

        // 段中心斜切量（八角形两端切角偏移）
        const cut = sh * 0.55;

        const cx = dx + sw / 2;   // 段水平中心

        // 各段的中心坐标和方向
        return {
            sw, sh, vw, vh, cut,
            // 横段（a, g, d）
            a:  { type: 'h', x: cx, y: dy + sh/2 },
            g:  { type: 'h', x: cx, y: dy + sh + vh + sh/2 },
            d:  { type: 'h', x: cx, y: dy + sh + vh + sh + vh + sh/2 },
            // 竖段（f, b, e, c）
            f:  { type: 'v', x: dx + vw/2,      y: dy + sh + vh/2 },
            b:  { type: 'v', x: dx + sw - vw/2, y: dy + sh + vh/2 },
            e:  { type: 'v', x: dx + vw/2,      y: dy + sh + vh + sh + vh/2 },
            c:  { type: 'v', x: dx + sw - vw/2, y: dy + sh + vh + sh + vh/2 },
            // 小数点
            dp: { type: 'dot', x: px + pw * 0.88, y: dy + dh - sh },
        };
    }

    // ── 计算引脚位置（DIP-10）────────────────
    _calcPinPositions() {
        const pkgX = this._pkgX, pkgW = this._pkgW;
        const pitch = pkgW / 5.5;
        const startX = pkgX + pitch * 0.5;

        // 下排（bottom=true）：pin1~5（e, d, COM, c, dp）
        // 上排（bottom=false）：pin6~10（g, b, COM, a, f）
        return [
            { id:'seg_e',  label:'e',   x: startX + pitch*0, bottom:true  },
            { id:'seg_d',  label:'d',   x: startX + pitch*1, bottom:true  },
            { id:'com1',   label:'COM', x: startX + pitch*2, bottom:true  },
            { id:'seg_c',  label:'c',   x: startX + pitch*3, bottom:true  },
            { id:'seg_dp', label:'dp',  x: startX + pitch*4, bottom:true  },
            { id:'seg_g',  label:'g',   x: startX + pitch*0, bottom:false },
            { id:'seg_b',  label:'b',   x: startX + pitch*1, bottom:false },
            { id:'com2',   label:'COM', x: startX + pitch*2, bottom:false },
            { id:'seg_a',  label:'a',   x: startX + pitch*3, bottom:false },
            { id:'seg_f',  label:'f',   x: startX + pitch*4, bottom:false },
        ];
    }

    // ── 应用字符/段码 ─────────────────────────
    _applyChar(char, instant = false) {
        const map = SevenSegmentDisplay.CHAR_MAP[char];
        if (!map) return;
        ['a','b','c','d','e','f','g'].forEach(s => {
            this._segTarget[s] = map[s] ? 1.0 : 0.0;
            if (instant) this._segBrightness[s] = this._segTarget[s];
        });
    }

    _applySegments(segs, instant = false) {
        Object.keys(segs).forEach(s => {
            if (this._segTarget.hasOwnProperty(s)) {
                this._segTarget[s] = segs[s] ? 1.0 : 0.0;
                if (instant) this._segBrightness[s] = this._segTarget[s];
            }
        });
    }

    // ═══════════════════════════════════════════
    _init() {
        this._drawPackage();          // 封装外壳
        this._drawPanel();            // 显示面板背景
        this._drawSegGlowLayer();     // 各段光晕（动态，底层）
        this._drawSegments();         // 七段+dp（动态叠加）
        this._drawPins();             // 引脚
        this._drawPinLabels();        // 引脚标注
        this._drawLabel();            // 位号
        this._drawStatusBar();        // 底部状态信息栏
        
    }

    // ── 封装外壳 ─────────────────────────────
    _drawPackage() {
        const px = this._pkgX, py = this._pkgY;
        const pw = this._pkgW, ph = this._pkgH;

        // 外壳主体
        this._staticGroup.add(new Konva.Rect({
            x: px, y: py, width: pw, height: ph,
            fillLinearGradientStartPoint: { x: 0,  y: 0  },
            fillLinearGradientEndPoint:   { x: pw, y: ph },
            fillLinearGradientColorStops: [
                0, '#1e2024', 0.4, '#16181c', 0.6, '#16181c', 1, '#1c1e22',
            ],
            stroke: '#30343a', strokeWidth: 1.2,
            cornerRadius: 4,
            shadowColor: '#000', shadowBlur: 6, shadowOffsetY: 2, shadowOpacity: 0.40,
        }));

        // 顶部高光
        this._staticGroup.add(new Konva.Rect({
            x: px + 2, y: py + 2, width: pw - 4, height: ph * 0.04,
            fill: 'rgba(255,255,255,0.06)', cornerRadius: [4, 4, 0, 0],
        }));

        // Pin-1 缺口（左下角）
        this._staticGroup.add(new Konva.Circle({
            x: px + pw * 0.10, y: py + ph - 1,
            radius: pw * 0.04,
            fill: '#0c0e10', stroke: '#282c30', strokeWidth: 0.6,
        }));
    }

    // ── 显示面板背景 ─────────────────────────
    _drawPanel() {
        const col = this._colors;
        this._staticGroup.add(new Konva.Rect({
            x: this._panelX, y: this._panelY,
            width: this._panelW, height: this._panelH,
            fill: col.panel,
            stroke: '#080a0c', strokeWidth: 0.8,
            cornerRadius: 2,
        }));

        // 面板内部淡反光（顶部）
        this._staticGroup.add(new Konva.Rect({
            x: this._panelX + 1, y: this._panelY + 1,
            width: this._panelW - 2, height: this._panelH * 0.06,
            fill: 'rgba(255,255,255,0.04)', cornerRadius: [2, 2, 0, 0],
        }));
    }

    // ── 各段光晕层（底层，动态）──────────────
    _drawSegGlowLayer() {
        this._glowGroup = new Konva.Group();
        this._staticGroup.add(this._glowGroup);
        this._rebuildGlows();
    }

    _rebuildGlows() {
        this._glowGroup.destroyChildren();
        const seg = this._segSetup;
        const col = this._colors;
        const br  = this.brightness;

        const segNames = ['a','b','c','d','e','f','g','dp'];
        segNames.forEach(sn => {
            const intensity = this._segBrightness[sn] * br;
            if (intensity <= 0.02) return;
            const s = seg[sn];

            if (s.type === 'dot') {
                this._glowGroup.add(new Konva.Circle({
                    x: s.x, y: s.y + seg.sh / 2,
                    radius: seg.sh * (1.2 + 0.6 * intensity),
                    fillRadialGradientStartPoint:  { x: 0, y: 0 },
                    fillRadialGradientEndPoint:    { x: 0, y: 0 },
                    fillRadialGradientStartRadius: 0,
                    fillRadialGradientEndRadius:   seg.sh * (1.2 + 0.6 * intensity),
                    fillRadialGradientColorStops: [
                        0,   this._rgba(col.glow, 0.60 * intensity),
                        0.4, this._rgba(col.glow, 0.25 * intensity),
                        1,   this._rgba(col.glow, 0),
                    ],
                }));
            } else if (s.type === 'h') {
                this._glowGroup.add(new Konva.Rect({
                    x: s.x - seg.sw / 2 - 2,
                    y: s.y - seg.sh / 2 - seg.sh * 0.8 * intensity,
                    width:  seg.sw + 4,
                    height: seg.sh + seg.sh * 1.6 * intensity,
                    fillLinearGradientStartPoint: { x: 0, y: 0 },
                    fillLinearGradientEndPoint:   { x: 0, y: seg.sh * 1.6 * intensity },
                    fillLinearGradientColorStops: [
                        0,   this._rgba(col.glow, 0),
                        0.4, this._rgba(col.glow, 0.28 * intensity),
                        0.6, this._rgba(col.glow, 0.28 * intensity),
                        1,   this._rgba(col.glow, 0),
                    ],
                    cornerRadius: 3,
                }));
            } else {
                this._glowGroup.add(new Konva.Rect({
                    x: s.x - seg.vw / 2 - seg.vw * 0.8 * intensity,
                    y: s.y - seg.vh / 2 - 2,
                    width:  seg.vw + seg.vw * 1.6 * intensity,
                    height: seg.vh + 4,
                    fillLinearGradientStartPoint: { x: 0, y: 0 },
                    fillLinearGradientEndPoint:   { x: seg.vw * 1.6 * intensity, y: 0 },
                    fillLinearGradientColorStops: [
                        0,   this._rgba(col.glow, 0),
                        0.4, this._rgba(col.glow, 0.28 * intensity),
                        0.6, this._rgba(col.glow, 0.28 * intensity),
                        1,   this._rgba(col.glow, 0),
                    ],
                    cornerRadius: 3,
                }));
            }
        });
    }

    // ── 七段 + dp 绘制（动态叠加）────────────
    _drawSegments() {
        this._segGroup = new Konva.Group();
        this._staticGroup.add(this._segGroup);
        this._rebuildSegments();
    }

    _rebuildSegments() {
        this._segGroup.destroyChildren();
        const seg = this._segSetup;
        const col = this._colors;
        const br  = this.brightness;

        const segNames = ['a','b','c','d','e','f','g','dp'];
        segNames.forEach(sn => {
            const raw = this._segBrightness[sn] * br;
            const s   = seg[sn];
            const lit = raw > 0.02;

            if (s.type === 'dot') {
                // 小数点
                const r   = seg.sh * 0.55;
                const dotX = s.x;
                const dotY = s.y + seg.sh * 0.5;
                this._segGroup.add(new Konva.Circle({
                    x: dotX, y: dotY, radius: r,
                    fill: lit ? this._rgba(col.lit, Math.min(1, raw + 0.1))
                              : col.dim,
                    stroke: lit ? this._rgba(col.lit, 0.4) : 'transparent',
                    strokeWidth: lit ? 0.5 : 0,
                    shadowColor:   lit ? col.glow : 'transparent',
                    shadowBlur:    lit ? r * 2.5 * raw : 0,
                    shadowOpacity: lit ? 0.85 : 0,
                }));
                return;
            }

            if (s.type === 'h') {
                // 横段：扁六边形（左右端斜切）
                const x0 = s.x - seg.sw / 2;
                const x1 = s.x + seg.sw / 2;
                const y0 = s.y - seg.sh / 2;
                const y1 = s.y + seg.sh / 2;
                const c  = seg.cut;
                const points = [
                    x0 + c, y0,
                    x1 - c, y0,
                    x1,     s.y,
                    x1 - c, y1,
                    x0 + c, y1,
                    x0,     s.y,
                ];
                const segFill = lit
                    ? (raw > 0.5
                        ? this._rgba(col.lit, Math.min(1, raw))
                        : this._interpolateColor(col.dim, col.lit, raw * 2))
                    : col.dim;
                this._segGroup.add(new Konva.Line({
                    points, closed: true,
                    fill: segFill,
                    stroke: lit ? this._rgba(col.lit, 0.25) : this._rgba(col.dim, 0.3),
                    strokeWidth: 0.6,
                    shadowColor:   lit ? col.glow : 'transparent',
                    shadowBlur:    lit ? seg.sh * 1.5 * raw : 0,
                    shadowOpacity: lit ? 0.70 : 0,
                }));
            } else {
                // 竖段：扁六边形（上下端斜切）
                const x0 = s.x - seg.vw / 2;
                const x1 = s.x + seg.vw / 2;
                const y0 = s.y - seg.vh / 2;
                const y1 = s.y + seg.vh / 2;
                const c  = seg.cut * 0.85;
                const points = [
                    s.x, y0,
                    x1,  y0 + c,
                    x1,  y1 - c,
                    s.x, y1,
                    x0,  y1 - c,
                    x0,  y0 + c,
                ];
                const segFill = lit
                    ? (raw > 0.5
                        ? this._rgba(col.lit, Math.min(1, raw))
                        : this._interpolateColor(col.dim, col.lit, raw * 2))
                    : col.dim;
                this._segGroup.add(new Konva.Line({
                    points, closed: true,
                    fill: segFill,
                    stroke: lit ? this._rgba(col.lit, 0.25) : this._rgba(col.dim, 0.3),
                    strokeWidth: 0.6,
                    shadowColor:   lit ? col.glow : 'transparent',
                    shadowBlur:    lit ? seg.vw * 2.0 * raw : 0,
                    shadowOpacity: lit ? 0.70 : 0,
                }));
            }
        });
    }

    // ── 引脚 ─────────────────────────────────
    _drawPins() {
        this._pinDefs.forEach(p => {
            const isBottom = p.bottom;
            const y0 = isBottom ? this._pinTopY : this._pkgY;
            const y1 = isBottom ? this._pinTopY + this._pinH : this._pkgY - this._pinH;
            const pW = this._pinW;

            const isCom = p.id.startsWith('com');
            const col = isCom ? '#a0a4a8' : '#c0c4c8';

            this._staticGroup.add(new Konva.Rect({
                x: p.x - pW/2,
                y: Math.min(y0, y1),
                width: pW,
                height: this._pinH,
                fillLinearGradientStartPoint: { x: -pW, y: 0 },
                fillLinearGradientEndPoint:   { x:  pW, y: 0 },
                fillLinearGradientColorStops: [
                    0, '#6a6e74', 0.5, col, 1, '#6a6e74',
                ],
                stroke: '#505458', strokeWidth: 0.4,
            }));

            // 末端焊点
            this._staticGroup.add(new Konva.Circle({
                x: p.x,
                y: isBottom ? y1 + 2 : y1 - 2,
                radius: pW * 1.3,
                fill: '#b0b4b8', stroke: '#808488', strokeWidth: 0.5,
            }));
        });
    }

    // ── 引脚标注 ─────────────────────────────
    _drawPinLabels() {
        this._pinDefs.forEach(p => {
            const isBottom = p.bottom;
            const fz = 7.5;
            const textY = isBottom
                ? this._pinTopY + this._pinH + 5
                : this._pkgY - this._pinH - 13;

            const isCom = p.id.startsWith('com');
            const fill  = isCom ? '#80a0c0'
                        : (p.label === 'dp' ? '#a090c0' : '#90a0b0');

            this._staticGroup.add(new Konva.Text({
                x: p.x - 8, y: textY,
                text: p.label, fontSize: fz, fontStyle: 'bold',
                fill, align: 'center', width: 16,
            }));
        });
    }

    // ── 位号和参数标注 ────────────────────────
    _drawLabel() {
        const W = this.width;
        // 顶部位号
        this._staticGroup.add(new Konva.Text({
            x: 0, y: -18, width: W,
            text: `${this.label}  ${this.colorName.toUpperCase()}  共${this.commonMode === 'cathode' ? '阴' : '阳'}`,
            fontSize: 9, fontStyle: 'bold', fill: '#546e7a', align: 'center',
        }));
    }

    // ── 底部状态信息栏 ────────────────────────
    _drawStatusBar() {
        const W = this.width, H = this.height;
        const barY = H - 24;

        this._statusBg = new Konva.Rect({
            x: this._pkgX, y: barY,
            width: this._pkgW, height: 18,
            fill: '#0c0e10', cornerRadius: 2,
            stroke: '#282c30', strokeWidth: 0.5,
        });
        this._statusText = new Konva.Text({
            x: this._pkgX, y: barY + 4,
            width: this._pkgW,
            text: this._currentChar ? `'${this._currentChar}'` : '--',
            fontSize: 9, fill: '#78909c', align: 'center',
        });
        this._staticGroup.add(this._statusBg, this._statusText);
    }

    // ── 启动动画 ─────────────────────────────
    // 集中化 tick（由 consys._tickAll 在 20fps 调用）
    tick(dt) {
        this._tickAnimation(dt);
    
        this._refreshCache();
    }
    _tickAnimation(dt) {
        let dirty = false;

        // ── 演示模式（循环显示数字）──
        if (this._demoMode) {
            this._demoT += dt;
            if (this._demoT >= 0.7) {
                this._demoT -= 0.7;
                this._demoStep = (this._demoStep + 1) % this._demoDigits.length;
                this._applyChar(this._demoDigits[this._demoStep]);
                this._currentChar = this._demoDigits[this._demoStep];
            }
        }

        // ── 闪烁模式 ──
        if (this._blinkMode) {
            this._blinkT += dt;
            const period = 1.0 / this._blinkHz;
            if (this._blinkT >= period) {
                this._blinkT -= period;
                this._blinkState = !this._blinkState;
                const segs = ['a','b','c','d','e','f','g','dp'];
                segs.forEach(s => {
                    this._segTarget[s] = this._blinkState ? (this._segTarget[s] > 0 ? 1 : 0) : 0;
                });
            }
        }

        // ── 各段亮度渐变 ──
        const segNames = ['a','b','c','d','e','f','g','dp'];
        segNames.forEach(sn => {
            const cur = this._segBrightness[sn];
            const tgt = this._segTarget[sn];
            if (Math.abs(cur - tgt) > 0.005) {
                const speed = tgt > cur ? dt / this._riseTime : dt / this._fallTime;
                this._segBrightness[sn] = tgt > cur
                    ? Math.min(tgt, cur + speed)
                    : Math.max(tgt, cur - speed);
                dirty = true;
            }
        });

        if (dirty) {
            this._rebuildGlows();
            this._rebuildSegments();
            this._refreshCache();
        }
    }

    // ═══════════════════════════════════════════
    // ── 公共控制 API ──────────────────────────

    /** 显示单个字符（'0'~'9', 'A','b','C','d','E','F','H','L','P','U','-',' '） */
    showChar(char) {
        this._currentChar = String(char);
        this._applyChar(this._currentChar);
        if (this._statusText) {
            this._statusText.text(`'${this._currentChar}'`);
        }
        this._refreshCache();
    }

    /** 显示数字（0~9） */
    showDigit(n) { this.showChar(String(Math.max(0, Math.min(9, Math.round(n))))); }

    /** 直接设置各段（{ a:true, b:false, ... }） */
    setSegments(segs, dp = false) {
        this._currentChar = null;
        this._applySegments({ ...segs, dp });
        if (this._statusText) this._statusText.text('custom');
        this._refreshCache();
    }

    /** 全部点亮 */
    allOn() {
        ['a','b','c','d','e','f','g','dp'].forEach(s => this._segTarget[s] = 1);
        if (this._statusText) this._statusText.text("'8.'");
        this._refreshCache();
    }

    /** 全部熄灭 */
    allOff() {
        ['a','b','c','d','e','f','g','dp'].forEach(s => this._segTarget[s] = 0);
        if (this._statusText) this._statusText.text('--');
        this._refreshCache();
    }

    /** 开启/关闭演示模式（循环显示 0~F） */
    setDemoMode(on) {
        this._demoMode = on;
        if (on) { this._demoT = 0; this._demoStep = 0; }
    }

    /** 开启/关闭闪烁 */
    setBlink(on, hz = 1.0) {
        this._blinkMode = on;
        this._blinkHz   = hz;
        this._blinkT    = 0;
        if (!on) {
            // 恢复原段态
            if (this._currentChar) this._applyChar(this._currentChar);
        }
    }

    /** 设置亮度（0~1） */
    setBrightness(v) {
        this.brightness = Math.max(0, Math.min(1, v));
        this._refreshCache();
    }

    /** 点亮/熄灭小数点 */
    setDp(on) {
        this._segTarget.dp = on ? 1 : 0;
        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label: '位号',           key: 'label',       type: 'text'   },
            { label: '颜色',           key: 'color',       type: 'select',
              options: Object.keys(SevenSegmentDisplay.COLOR_PRESETS) },
            { label: '公共端模式',     key: 'commonMode',  type: 'select',
              options: ['cathode', 'anode'] },
            { label: '初始字符',       key: 'initChar',    type: 'text'   },
            { label: '演示模式',       key: 'demoMode',    type: 'number' },
            { label: '闪烁频率 (Hz)',  key: 'blinkHz',     type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        this.label = cfg.label || this.label;
        if (cfg.color && SevenSegmentDisplay.COLOR_PRESETS[cfg.color]) {
            this.colorName = cfg.color;
            this._colors   = SevenSegmentDisplay.COLOR_PRESETS[cfg.color];
        }
        if (cfg.commonMode) this.commonMode = cfg.commonMode;
        if (cfg.initChar)   this.showChar(String(cfg.initChar));
        if (cfg.demoMode !== undefined) this.setDemoMode(!!parseInt(cfg.demoMode));
        if (cfg.blinkHz) this.setBlink(this._blinkMode, parseFloat(cfg.blinkHz));
        this.config = { ...this.config, ...cfg };
        this._refreshCache();
    }

    update(state) {
        if (typeof state === 'number') this.showDigit(state);
        else if (typeof state === 'string') this.showChar(state);
        else if (typeof state === 'object' && state !== null) this.setSegments(state);
        this._refreshCache();
    }

    destroy() {
        super.destroy?.();
    }

    // ── 颜色工具 ─────────────────────────────
    _rgba(hex, alpha) {
        const h = hex.replace('#', '');
        const r = parseInt(h.substring(0, 2), 16);
        const g = parseInt(h.substring(2, 4), 16);
        const b = parseInt(h.substring(4, 6), 16);
        return `rgba(${r},${g},${b},${(+alpha).toFixed(3)})`;
    }

    _interpolateColor(hex1, hex2, t) {
        const parse = h => {
            h = h.replace('#', '');
            return [parseInt(h.substring(0,2),16), parseInt(h.substring(2,4),16), parseInt(h.substring(4,6),16)];
        };
        const [r1,g1,b1] = parse(hex1);
        const [r2,g2,b2] = parse(hex2);
        const r = Math.round(r1 + (r2 - r1) * t);
        const g = Math.round(g1 + (g2 - g1) * t);
        const b = Math.round(b1 + (b2 - b1) * t);
        return `rgb(${r},${g},${b})`;
    }
}