import { BaseComponent } from './BaseComponent.js';

/**
 * 液晶显示器 12864 仿真组件
 * （LCD 128×64 Graphic Dot-Matrix Display）
 *
 * ── 结构说明 ──────────────────────────────────────────────────
 *
 *  12864 是一款 128×64 点阵图形液晶显示模块，广泛用于嵌入式系统。
 *  参考型号：ST7920 / KS0108 驱动，标准 20-PIN 单排接口。
 *
 *  1. PCB 基板（PCB Board）：
 *     - 典型草绿色 FR4 环氧玻纤板
 *     - 背面可选背光板（LED 背光或 EL 冷光片）
 *
 *  2. LCD 显示面板（Display Panel）：
 *     - 外框：黑色/深灰色遮光边框
 *     - 显示区：128×64 点阵像素（仿真时以缩放像素块渲染）
 *     - 视角膜：偏振膜使未通电液晶呈蓝/灰色底色（STN 型）
 *     - 背光色：蓝底白字（最常见）/ 黄绿底黑字 / 白底黑字
 *
 *  3. 引脚排列（标准 20-PIN，底部单排）：
 *     - VSS(1)  VDD(2)  VO(3)   RS(4)   RW(5)   E(6)
 *     - DB0(7)  DB1(8)  DB2(9)  DB3(10) DB4(11) DB5(12)
 *     - DB6(13) DB7(14) PSB(15) NC(16)  RST(17) VOUT(18)
 *     - BLA(19) BLK(20)
 *
 *  4. 显示内存（DDRAM / GDRAM）：
 *     - 仿真内部维护 128×64 位图缓冲区（_framebuffer）
 *     - 每像素 1bit（0=暗，1=亮）
 *     - 支持文本模式（内置 ASCII + GB2312 字库模拟）
 *     - 支持图形模式（直接写入像素位图）
 *
 * ── 工作原理 ──────────────────────────────────────────────────
 *
 *  ① 初始化序列：RST 复位 → 发送功能设置指令 → 开显示
 *  ② 文本写入：setCursor(col, row) → writeText(str)
 *     - 每行最多 8 个汉字（16×16 点阵）或 16 个 ASCII（8×16 点阵）
 *     - 共 4 行（row 0~3）
 *  ③ 图形写入：drawPixel(x, y, on) / drawBitmap(x, y, w, h, data)
 *  ④ 背光控制：setBacklight(on/off/brightness)
 *
 * ── 显示模式 ──────────────────────────────────────────────────
 *
 *  TEXT    — 文本模式：支持 4 行 × 16 字符 ASCII 显示
 *  GRAPHIC — 图形模式：128×64 像素位图直接操作
 *  MIXED   — 混合模式：图形层叠加文本层
 *  DEMO    — 演示模式：内置动画演示（波形/字符滚动/图形绘制）
 *
 * ── 背光配色方案 ──────────────────────────────────────────────
 *
 *  blue    — 蓝底白字（最常见，ST7920 默认）
 *  yellow  — 黄绿底黑字（户外可读性强）
 *  white   — 白底黑字（高对比度）
 *  green   — 绿底黑字（复古风格）
 *  none    — 无背光（反射型）
 *
 * ── 动画效果 ──────────────────────────────────────────────────
 *
 *  上电初始化：模拟 LCD 初始化序列动画（扫描线逐行刷新）
 *  文本写入：字符逐个出现（打字机效果，可配速）
 *  背光开关：150ms 渐亮/渐暗过渡
 *  DEMO 模式：正弦波动画 + 滚动文字
 *  光标：可见光标在文本模式下闪烁（500ms 周期）
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  vss   — 引脚 1，GND
 *  vdd   — 引脚 2，VCC(5V/3.3V)
 *  vo    — 引脚 3，LCD 对比度调节（接电位器）
 *  rs    — 引脚 4，寄存器选择（0=指令，1=数据）
 *  rw    — 引脚 5，读写选择（0=写，1=读）
 *  e     — 引脚 6，使能信号（下降沿触发）
 *  db0~7 — 引脚 7~14，8位并行数据总线
 *  psb   — 引脚 15，串/并口选择（1=并行，0=串行）
 *  rst   — 引脚 17，复位（低电平有效）
 *  bla   — 引脚 19，背光阳极
 *  blk   — 引脚 20，背光阴极
 */
export class LCD12864 extends BaseComponent {

    // ── 背光配色预设 ──────────────────────────
    static BACKLIGHT_THEMES = {
        blue:   {
            bg: '#1a3a6a',        // 背光底色
            fg: '#c8e8ff',        // 像素亮色（字/图）
            off: '#142850',       // 像素暗色（点阵背景）
            glow: '#4080c0',      // 背光辉光
            border: '#0a1a30',    // 边框色
            pcb: '#2d5a1b',       // PCB 颜色
        },
        yellow: {
            bg: '#b8c840',
            fg: '#202808',
            off: '#a0b030',
            glow: '#d0e050',
            border: '#303810',
            pcb: '#2d5a1b',
        },
        white: {
            bg: '#d8e4e8',
            fg: '#101418',
            off: '#c0ced4',
            glow: '#e8f4f8',
            border: '#606870',
            pcb: '#2d5a1b',
        },
        green: {
            bg: '#102a10',
            fg: '#20ff60',
            off: '#0c1e0c',
            glow: '#18c040',
            border: '#081008',
            pcb: '#2d5a1b',
        },
        none: {
            bg: '#b8bca8',
            fg: '#202418',
            off: '#a8ac98',
            glow: '#c8ccb8',
            border: '#404438',
            pcb: '#2d5a1b',
        },
    };

    // ── 仿真用字体（5×8 点阵 ASCII，简化版）──
    // 每字符 5 列，每列 8 位（LSB=顶）
    static FONT_5X8 = {
        ' ': [0x00,0x00,0x00,0x00,0x00],
        '!': [0x00,0x5F,0x00,0x00,0x00],
        '"': [0x07,0x00,0x07,0x00,0x00],
        '#': [0x14,0x7F,0x14,0x7F,0x14],
        '%': [0x23,0x13,0x08,0x64,0x62],
        '+': [0x08,0x08,0x3E,0x08,0x08],
        ',': [0x00,0x50,0x30,0x00,0x00],
        '-': [0x08,0x08,0x08,0x08,0x08],
        '.': [0x00,0x60,0x60,0x00,0x00],
        '/': [0x20,0x10,0x08,0x04,0x02],
        '0': [0x3E,0x51,0x49,0x45,0x3E],
        '1': [0x00,0x42,0x7F,0x40,0x00],
        '2': [0x42,0x61,0x51,0x49,0x46],
        '3': [0x21,0x41,0x45,0x4B,0x31],
        '4': [0x18,0x14,0x12,0x7F,0x10],
        '5': [0x27,0x45,0x45,0x45,0x39],
        '6': [0x3C,0x4A,0x49,0x49,0x30],
        '7': [0x01,0x71,0x09,0x05,0x03],
        '8': [0x36,0x49,0x49,0x49,0x36],
        '9': [0x06,0x49,0x49,0x29,0x1E],
        ':': [0x00,0x36,0x36,0x00,0x00],
        '<': [0x08,0x14,0x22,0x41,0x00],
        '=': [0x14,0x14,0x14,0x14,0x14],
        '>': [0x00,0x41,0x22,0x14,0x08],
        '?': [0x02,0x01,0x51,0x09,0x06],
        '@': [0x32,0x49,0x59,0x51,0x3E],
        'A': [0x7E,0x11,0x11,0x11,0x7E],
        'B': [0x7F,0x49,0x49,0x49,0x36],
        'C': [0x3E,0x41,0x41,0x41,0x22],
        'D': [0x7F,0x41,0x41,0x22,0x1C],
        'E': [0x7F,0x49,0x49,0x49,0x41],
        'F': [0x7F,0x09,0x09,0x09,0x01],
        'G': [0x3E,0x41,0x49,0x49,0x7A],
        'H': [0x7F,0x08,0x08,0x08,0x7F],
        'I': [0x00,0x41,0x7F,0x41,0x00],
        'J': [0x20,0x40,0x41,0x3F,0x01],
        'K': [0x7F,0x08,0x14,0x22,0x41],
        'L': [0x7F,0x40,0x40,0x40,0x40],
        'M': [0x7F,0x02,0x0C,0x02,0x7F],
        'N': [0x7F,0x04,0x08,0x10,0x7F],
        'O': [0x3E,0x41,0x41,0x41,0x3E],
        'P': [0x7F,0x09,0x09,0x09,0x06],
        'Q': [0x3E,0x41,0x51,0x21,0x5E],
        'R': [0x7F,0x09,0x19,0x29,0x46],
        'S': [0x46,0x49,0x49,0x49,0x31],
        'T': [0x01,0x01,0x7F,0x01,0x01],
        'U': [0x3F,0x40,0x40,0x40,0x3F],
        'V': [0x1F,0x20,0x40,0x20,0x1F],
        'W': [0x3F,0x40,0x38,0x40,0x3F],
        'X': [0x63,0x14,0x08,0x14,0x63],
        'Y': [0x07,0x08,0x70,0x08,0x07],
        'Z': [0x61,0x51,0x49,0x45,0x43],
        '[': [0x00,0x7F,0x41,0x41,0x00],
        ']': [0x00,0x41,0x41,0x7F,0x00],
        'a': [0x20,0x54,0x54,0x54,0x78],
        'b': [0x7F,0x48,0x44,0x44,0x38],
        'c': [0x38,0x44,0x44,0x44,0x20],
        'd': [0x38,0x44,0x44,0x48,0x7F],
        'e': [0x38,0x54,0x54,0x54,0x18],
        'f': [0x08,0x7E,0x09,0x01,0x02],
        'g': [0x0C,0x52,0x52,0x52,0x3E],
        'h': [0x7F,0x08,0x04,0x04,0x78],
        'i': [0x00,0x44,0x7D,0x40,0x00],
        'j': [0x20,0x40,0x44,0x3D,0x00],
        'k': [0x7F,0x10,0x28,0x44,0x00],
        'l': [0x00,0x41,0x7F,0x40,0x00],
        'm': [0x7C,0x04,0x18,0x04,0x78],
        'n': [0x7C,0x08,0x04,0x04,0x78],
        'o': [0x38,0x44,0x44,0x44,0x38],
        'p': [0x7C,0x14,0x14,0x14,0x08],
        'q': [0x08,0x14,0x14,0x18,0x7C],
        'r': [0x7C,0x08,0x04,0x04,0x08],
        's': [0x48,0x54,0x54,0x54,0x20],
        't': [0x04,0x3F,0x44,0x40,0x20],
        'u': [0x3C,0x40,0x40,0x40,0x3C],
        'v': [0x1C,0x20,0x40,0x20,0x1C],
        'w': [0x3C,0x40,0x30,0x40,0x3C],
        'x': [0x44,0x28,0x10,0x28,0x44],
        'y': [0x0C,0x50,0x50,0x50,0x3C],
        'z': [0x44,0x64,0x54,0x4C,0x44],
        '|': [0x00,0x00,0x7F,0x00,0x00],
        '~': [0x08,0x04,0x08,0x10,0x08],
    };

    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(300, config.width  || 420);
        this.height = Math.max(220, config.height || 320);

        this.type    = 'lcd12864';
        this.special = 'none';
        this.cache   = 'fixed';

        // ── 参数 ──
        this.label         = config.label         || 'LCD12864';
        this.themeName     = config.theme          || 'blue';
        this.contrast      = config.contrast       || 0.85;    // 0~1 对比度
        this.backlightOn   = config.backlightOn    !== false;  // 背光默认开
        this.backlightBr   = config.backlightBr    || 1.0;     // 背光亮度 0~1
        this.cursorVisible = config.cursorVisible  || false;
        this.blinkCursor   = config.blinkCursor    || true;

        this._theme = LCD12864.BACKLIGHT_THEMES[this.themeName]
                    || LCD12864.BACKLIGHT_THEMES.blue;

        // ── 显示缓冲区 128×64 bits ──
        this.COLS = 128;
        this.ROWS = 64;
        this._framebuffer = new Uint8Array(this.COLS * this.ROWS); // 0=off,1=on

        // ── 文本层（4行×16列 ASCII 字符） ──
        this._textBuffer  = Array.from({ length: 4 }, () => Array(16).fill(' '));
        this._cursorCol   = 0;
        this._cursorRow   = 0;

        // ── 初始化序列动画 ──
        this._initAnim      = true;
        this._initScanLine  = 0;      // 当前扫描行
        this._initScanSpeed = 128;    // 行/秒

        // ── 背光渐变 ──
        this._blCurrentBr  = this.backlightOn ? this.backlightBr : 0;
        this._blTargetBr   = this._blCurrentBr;
        this._blSpeed      = 1.0 / 0.15;  // 过渡速度

        // ── 光标闪烁 ──
        this._cursorBlinkT = 0;
        this._cursorShow   = true;

        // ── 演示模式 ──
        this._demoMode    = config.demoMode || false;
        this._demoT       = 0;
        this._demoPhase   = 0;

        // ── 打字机效果队列 ──
        this._typeQueue   = [];   // [{col,row,char}...]
        this._typeT       = 0;
        this._typeSpeed   = config.typeSpeed || 20;  // 字符/秒

        // ── 像素渲染缓存（脏标记） ──
        this._dirty       = true;

        // ── 几何尺寸 ──
        const W = this.width, H = this.height;

        // PCB 板
        this._pcbX = 0;
        this._pcbY = 0;
        this._pcbW = W;
        this._pcbH = H;

        // LCD 外框（黑色遮光）
        this._frameX = W * 0.04;
        this._frameY = H * 0.06;
        this._frameW = W * 0.92;
        this._frameH = H * 0.68;

        // 显示区（点阵区）
        this._dispX  = this._frameX + this._frameW * 0.05;
        this._dispY  = this._frameY + this._frameH * 0.07;
        this._dispW  = this._frameW * 0.90;
        this._dispH  = this._frameH * 0.86;

        // 每像素尺寸
        this._pixW   = this._dispW / this.COLS;
        this._pixH   = this._dispH / this.ROWS;

        // 引脚区（底部单排 20 脚）
        this._pinAreaY  = this._frameY + this._frameH + H * 0.03;
        this._pinH      = H * 0.14;
        this._pinW      = W * 0.018;
        this._pinPitch  = W * 0.044;
        this._pinStartX = W * 0.06;

        this._lastTs = null;
        this._animId = null;

        // 默认内容：写入欢迎文字
        if (!this._demoMode) {
            this._writeTextInstant(0, 0, '  LCD 12864 ');
            this._writeTextInstant(0, 1, ' 128x64 Dots');
            this._writeTextInstant(0, 2, ' STN Display');
            this._writeTextInstant(0, 3, ' Simulation ');
        }

        this._init();

        // ── 端口 ──
        this._buildPorts();
    }

    _buildPorts() {
        const pinNames = [
            'vss','vdd','vo','rs','rw','e',
            'db0','db1','db2','db3','db4','db5','db6','db7',
            'psb','nc','rst','vout','bla','blk',
        ];
        pinNames.forEach((name, i) => {
            const x = this._pinStartX + i * this._pinPitch + this._pinW / 2;
            const y = this._pinAreaY + this._pinH + 4;
            this.addPort(x, y, name, 'wire', name.toUpperCase());
        });
    }

    // ═══════════════════════════════════════════
    _init() {
        this._drawPCB();           // PCB 基板
        this._drawBacklightLayer();// 背光层（动态）
        this._drawLCDFrame();      // LCD 外框
        this._drawDisplayArea();   // 显示区（canvas/konva 像素）
        this._drawPixelLayer();    // 像素渲染层（动态）
        this._drawInitOverlay();   // 初始化扫描动画层
        this._drawCursorLayer();   // 光标层
        this._drawPins();          // 引脚
        this._drawPinLabels();     // 引脚标注
        this._drawScrews();        // 安装螺孔
        this._drawLabel();         // 标注
        this._startAnimation();
    }

    // ── PCB 基板 ─────────────────────────────
    _drawPCB() {
        const col = this._theme;
        // PCB 主体
        this.group.add(new Konva.Rect({
            x: 0, y: 0, width: this._pcbW, height: this._pcbH,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: this._pcbW, y: this._pcbH },
            fillLinearGradientColorStops: [
                0, col.pcb,
                0.4, this._lighten(col.pcb, 0.06),
                0.6, col.pcb,
                1, this._darken(col.pcb, 0.08),
            ],
            stroke: this._darken(col.pcb, 0.2), strokeWidth: 1.5,
            cornerRadius: 4,
            shadowColor: '#000', shadowBlur: 8, shadowOffsetY: 3, shadowOpacity: 0.35,
        }));

        // PCB 铜箔走线纹理（水平细线）
        for (let i = 1; i < 6; i++) {
            const y = this._pcbH * (i / 6);
            this.group.add(new Konva.Line({
                points: [8, y, this._pcbW - 8, y],
                stroke: this._lighten(col.pcb, 0.10),
                strokeWidth: 0.4, dash: [12, 8],
                opacity: 0.5,
            }));
        }
    }

    // ── 背光层（动态，在 LCD 框下方）─────────
    _drawBacklightLayer() {
        this._blGroup = new Konva.Group();
        this.group.add(this._blGroup);
        this._rebuildBacklight();
    }

    _rebuildBacklight() {
        this._blGroup.destroyChildren();
        const br = this._blCurrentBr;
        if (br <= 0.005) return;
        const col = this._theme;

        // 背光辉光（LCD 框后方光晕）
        this._blGroup.add(new Konva.Rect({
            x: this._frameX - 4, y: this._frameY - 4,
            width: this._frameW + 8, height: this._frameH + 8,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: this._frameW, y: this._frameH },
            fillLinearGradientColorStops: [
                0,   this._rgba(col.glow, 0.15 * br),
                0.5, this._rgba(col.glow, 0.25 * br),
                1,   this._rgba(col.glow, 0.10 * br),
            ],
            cornerRadius: 5,
        }));
    }

    // ── LCD 外框（遮光边框）──────────────────
    _drawLCDFrame() {
        const col = this._theme;

        // 外框主体（黑色/深色）
        this.group.add(new Konva.Rect({
            x: this._frameX, y: this._frameY,
            width: this._frameW, height: this._frameH,
            fill: col.border,
            stroke: this._darken(col.border, 0.3),
            strokeWidth: 1.2,
            cornerRadius: 3,
        }));

        // 外框顶部高光（立体感）
        this.group.add(new Konva.Rect({
            x: this._frameX + 1, y: this._frameY + 1,
            width: this._frameW - 2, height: this._frameH * 0.04,
            fill: 'rgba(255,255,255,0.08)', cornerRadius: [3, 3, 0, 0],
        }));

        // 内嵌斜面线（模拟金属导轨）
        this.group.add(new Konva.Rect({
            x: this._frameX + 3, y: this._frameY + 3,
            width: this._frameW - 6, height: this._frameH - 6,
            fill: 'transparent',
            stroke: 'rgba(255,255,255,0.06)', strokeWidth: 1,
            cornerRadius: 2,
        }));
    }

    // ── 显示区背景 ───────────────────────────
    _drawDisplayArea() {
        const col = this._theme;

        // 显示区底色（STN 液晶底色）
        this._dispBg = new Konva.Rect({
            x: this._dispX, y: this._dispY,
            width: this._dispW, height: this._dispH,
            fill: col.bg,
            stroke: this._darken(col.border, 0.2), strokeWidth: 0.6,
        });
        this.group.add(this._dispBg);

        // 偏振膜纹理（细微网格感）
        this.group.add(new Konva.Rect({
            x: this._dispX, y: this._dispY,
            width: this._dispW, height: this._dispH,
            fillPatternRepeat: 'repeat',
            fill: 'transparent',
            opacity: 0.04,
            stroke: 'rgba(0,0,0,0.15)', strokeWidth: 0,
        }));
    }

    // ── 像素渲染层（核心，动态）──────────────
    _drawPixelLayer() {
        this._pixGroup = new Konva.Group({
            x: this._dispX,
            y: this._dispY,
            clipX: 0, clipY: 0,
            clipWidth: this._dispW, clipHeight: this._dispH,
        });
        this.group.add(this._pixGroup);
        this._rebuildPixels();
    }

    _rebuildPixels() {
        this._pixGroup.destroyChildren();
        const col   = this._theme;
        const br    = this._blCurrentBr;
        const ctr   = this.contrast;
        const pw    = this._pixW;
        const ph    = this._pixH;
        const fb    = this._framebuffer;
        const W     = this.COLS;
        const H     = this.ROWS;

        // 渲染：每个亮像素绘制一个小矩形
        // 优化：将所有亮像素合并为尽量少的 shape
        // 使用 Konva.Shape 自定义绘制，一次 sceneFunc 渲染全部像素
        const fgColor = col.fg;
        const bgColor = col.bg;
        const offColor = col.off;

        const shape = new Konva.Shape({
            sceneFunc: (ctx, shape) => {
                // 背景
                ctx.fillStyle = bgColor;
                ctx.fillRect(0, 0, this._dispW, this._dispH);

                // 亮像素
                const alpha = 0.60 + 0.40 * ctr * (br > 0 ? 1 : 0.25);
                ctx.globalAlpha = alpha;

                // 绘制 ON 像素
                ctx.fillStyle = fgColor;
                for (let y = 0; y < H; y++) {
                    for (let x = 0; x < W; x++) {
                        if (fb[y * W + x]) {
                            const px = x * pw;
                            const py = y * ph;
                            ctx.fillRect(px + 0.3, py + 0.3, pw - 0.3, ph - 0.3);
                        }
                    }
                }

                // 初始化扫描线以上暗色蒙层
                if (this._initAnim && this._initScanLine < H) {
                    ctx.globalAlpha = 0.85;
                    ctx.fillStyle = bgColor;
                    ctx.fillRect(0, this._initScanLine * ph, this._dispW, (H - this._initScanLine) * ph);
                }

                ctx.globalAlpha = 1;
                ctx._context.draw();
            },
            width: this._dispW, height: this._dispH,
        });
        this._pixGroup.add(shape);
        this._pixShape = shape;
    }

    // ── Konva.Shape 自定义绘制（重写）────────
    // 注：标准 Konva 的 sceneFunc 不需要 _context.draw()，用标准写法
    _rebuildPixelsDirect() {
        this._pixGroup.destroyChildren();

        const col      = this._theme;
        const br       = this._blCurrentBr;
        const ctr      = this.contrast;
        const pixW     = this._pixW;
        const pixH     = this._pixH;
        const fb       = this._framebuffer;
        const COLS     = this.COLS;
        const ROWS     = this.ROWS;
        const scanLine = this._initScanLine;
        const initAnim = this._initAnim;

        // 背景填充
        this._pixGroup.add(new Konva.Rect({
            x: 0, y: 0, width: this._dispW, height: this._dispH,
            fill: col.bg,
        }));

        // 仅渲染可见行（初始化动画限制）
        const visibleRows = initAnim ? scanLine : ROWS;
        const alpha = Math.max(0.25, (0.60 + 0.40 * ctr) * (br > 0 ? 1 : 0.30));

        // 批量渲染：将连续的亮像素合并为宽矩形以减少节点数
        for (let y = 0; y < visibleRows; y++) {
            let runStart = -1;
            for (let x = 0; x <= COLS; x++) {
                const on = x < COLS && fb[y * COLS + x];
                if (on && runStart < 0) {
                    runStart = x;
                } else if (!on && runStart >= 0) {
                    // 提交一段连续像素
                    this._pixGroup.add(new Konva.Rect({
                        x: runStart * pixW + 0.2,
                        y: y * pixH + 0.2,
                        width: (x - runStart) * pixW - 0.2,
                        height: pixH - 0.2,
                        fill: col.fg,
                        opacity: alpha,
                    }));
                    runStart = -1;
                }
            }
        }

        // 扫描线以下：半透明蒙层（未初始化区域）
        if (initAnim && scanLine < ROWS) {
            this._pixGroup.add(new Konva.Rect({
                x: 0, y: scanLine * pixH,
                width: this._dispW, height: (ROWS - scanLine) * pixH,
                fill: col.bg, opacity: 0.90,
            }));
        }
    }

    // ── 初始化扫描动画层 ─────────────────────
    _drawInitOverlay() {
        this._initOverlayGroup = new Konva.Group();
        this.group.add(this._initOverlayGroup);
    }

    _rebuildInitOverlay() {
        this._initOverlayGroup.destroyChildren();
        if (!this._initAnim) return;

        const sl = this._initScanLine;
        if (sl >= this.ROWS) return;

        const col = this._theme;
        // 扫描线高亮
        this._initOverlayGroup.add(new Konva.Rect({
            x: this._dispX,
            y: this._dispY + sl * this._pixH - 0.5,
            width: this._dispW,
            height: Math.max(1, this._pixH * 1.5),
            fill: this._rgba(col.glow, 0.55),
        }));
    }

    // ── 光标层 ───────────────────────────────
    _drawCursorLayer() {
        this._cursorGroup = new Konva.Group();
        this.group.add(this._cursorGroup);
    }

    _rebuildCursor() {
        this._cursorGroup.destroyChildren();
        if (!this.cursorVisible || !this._cursorShow) return;
        if (this._initAnim) return;

        const col = this._theme;
        const cx  = this._cursorCol;
        const cy  = this._cursorRow;

        // 字符宽 6px（5+1 间距），高 8px，缩放到显示区
        const charW = 6 * this._pixW;
        const charH = 8 * this._pixH;
        const startX = this._dispX + cx * charW;
        const startY = this._dispY + cy * charH;

        // 光标下划线
        this._cursorGroup.add(new Konva.Rect({
            x: startX, y: startY + charH - this._pixH,
            width: charW, height: this._pixH,
            fill: col.fg, opacity: 0.85,
        }));
    }

    // ── 引脚（底部单排 20 脚）────────────────
    _drawPins() {
        const pinNames = [
            'VSS','VDD','VO','RS','RW','E',
            'DB0','DB1','DB2','DB3','DB4','DB5','DB6','DB7',
            'PSB','NC','RST','VOUT','BLA','BLK',
        ];
        const comPins = new Set([0, 1, 14, 18, 19]);  // 电源/背光引脚
        const dataPins = new Set([6,7,8,9,10,11,12,13]); // 数据总线

        for (let i = 0; i < 20; i++) {
            const x  = this._pinStartX + i * this._pinPitch;
            const y0 = this._pinAreaY;
            const y1 = y0 + this._pinH;
            const pW = this._pinW;

            const isData = dataPins.has(i);
            const isCom  = comPins.has(i);
            const gradCol = isCom ? '#b8bcc0' : (isData ? '#c8a060' : '#a0c0b0');

            // 引脚矩形
            this.group.add(new Konva.Rect({
                x: x, y: y0, width: pW, height: this._pinH,
                fillLinearGradientStartPoint: { x: -pW, y: 0 },
                fillLinearGradientEndPoint:   { x:  pW, y: 0 },
                fillLinearGradientColorStops: [
                    0, this._darken(gradCol, 0.3),
                    0.5, gradCol,
                    1, this._darken(gradCol, 0.3),
                ],
                stroke: this._darken(gradCol, 0.2), strokeWidth: 0.3,
            }));

            // 引脚末端焊点
            this.group.add(new Konva.Circle({
                x: x + pW / 2, y: y1 + 2,
                radius: pW * 1.2,
                fill: '#b0b4b8', stroke: '#808488', strokeWidth: 0.4,
            }));
        }
    }

    // ── 引脚标注 ─────────────────────────────
    _drawPinLabels() {
        const labels = [
            'VSS','VDD','VO','RS','RW','E',
            'D0','D1','D2','D3','D4','D5','D6','D7',
            'PSB','NC','RST','VO','BLA','BLK',
        ];
        const labelY = this._pinAreaY + this._pinH + 6;

        for (let i = 0; i < 20; i++) {
            const x = this._pinStartX + i * this._pinPitch;
            const pW = this._pinW;
            this.group.add(new Konva.Text({
                x: x - 4, y: labelY,
                text: labels[i], fontSize: 5.5,
                fill: '#7a8590', align: 'center', width: pW + 8,
                rotation: 45,
            }));

            // 引脚编号
            this.group.add(new Konva.Text({
                x: x - 2, y: this._pinAreaY - 10,
                text: String(i + 1), fontSize: 6,
                fill: '#546e7a', align: 'center', width: pW + 4,
            }));
        }
    }

    // ── 安装螺孔（四角）─────────────────────
    _drawScrews() {
        const W = this._pcbW, H = this._pcbH;
        const r = 5, corners = [
            [r + 4, r + 4], [W - r - 4, r + 4],
            [r + 4, H - r - 20], [W - r - 4, H - r - 20],
        ];
        corners.forEach(([cx, cy]) => {
            // 安装孔外环
            this.group.add(new Konva.Circle({
                x: cx, y: cy, radius: r,
                fill: this._darken(this._theme.pcb, 0.25),
                stroke: this._darken(this._theme.pcb, 0.40), strokeWidth: 0.8,
            }));
            // 铜焊盘环
            this.group.add(new Konva.Circle({
                x: cx, y: cy, radius: r - 1.5,
                fill: 'transparent',
                stroke: '#c8a830', strokeWidth: 1.0,
            }));
            // 孔心
            this.group.add(new Konva.Circle({
                x: cx, y: cy, radius: r * 0.40,
                fill: '#1a1e22',
            }));
        });
    }

    // ── 位号标注 ─────────────────────────────
    _drawLabel() {
        const W = this._pcbW;

        // 顶部位号
        this.group.add(new Konva.Text({
            x: 0, y: -18, width: W,
            text: `${this.label}  128×64  ${this.themeName.toUpperCase()} BL`,
            fontSize: 9, fontStyle: 'bold', fill: '#546e7a', align: 'center',
        }));

        // LCD 框下方型号丝印
        this.group.add(new Konva.Text({
            x: this._frameX + 4, y: this._frameY + this._frameH + 3,
            text: `12864  ST7920`,
            fontSize: 7.5, fill: this._darken(this._theme.pcb, -0.15),
        }));

        // 背光亮度状态
        this._blStatusText = new Konva.Text({
            x: this._frameX + this._frameW - 60,
            y: this._frameY + this._frameH + 3,
            text: `BL: ${this.backlightOn ? 'ON' : 'OFF'}`,
            fontSize: 7.5, fill: '#78909c',
        });
        this.group.add(this._blStatusText);
    }

    // ── 动画主循环 ───────────────────────────
    _startAnimation() {
        const tick = ts => {
            if (this._lastTs !== null) {
                const dt = Math.min((ts - this._lastTs) / 1000, 0.05);
                this._tickAnimation(dt);
            }
            this._lastTs = ts;
            this._animId = requestAnimationFrame(tick);
        };
        this._animId = requestAnimationFrame(tick);
    }

    _stopAnimation() {
        if (this._animId) { cancelAnimationFrame(this._animId); this._animId = null; }
    }

    _tickAnimation(dt) {
        let dirty = false;

        // ── 初始化扫描动画 ──
        if (this._initAnim) {
            this._initScanLine += dt * this._initScanSpeed;
            if (this._initScanLine >= this.ROWS) {
                this._initScanLine = this.ROWS;
                this._initAnim     = false;
                if (this._demoMode) this._demoPhase = 0;
            }
            dirty = true;
        }

        // ── 背光渐变 ──
        const blDiff = this._blTargetBr - this._blCurrentBr;
        if (Math.abs(blDiff) > 0.005) {
            const step = Math.sign(blDiff) * this._blSpeed * dt;
            this._blCurrentBr = Math.max(0, Math.min(1,
                Math.abs(step) > Math.abs(blDiff)
                    ? this._blTargetBr
                    : this._blCurrentBr + step
            ));
            dirty = true;
        }

        // ── 打字机效果 ──
        if (this._typeQueue.length > 0) {
            this._typeT += dt;
            const interval = 1 / this._typeSpeed;
            while (this._typeT >= interval && this._typeQueue.length > 0) {
                const { col, row, char } = this._typeQueue.shift();
                this._writeCharToFB(col, row, char);
                this._typeT -= interval;
                dirty = true;
            }
        }

        // ── 光标闪烁 ──
        if (this.cursorVisible && this.blinkCursor) {
            this._cursorBlinkT += dt;
            if (this._cursorBlinkT >= 0.5) {
                this._cursorBlinkT -= 0.5;
                this._cursorShow = !this._cursorShow;
                this._rebuildCursor();
            }
        }

        // ── 演示模式 ──
        if (this._demoMode && !this._initAnim) {
            this._demoT += dt;
            this._tickDemo(dt);
            dirty = true;
        }

        if (dirty) {
            this._rebuildBacklight();
            this._rebuildPixelsDirect();
            this._rebuildInitOverlay();
            if (this._blStatusText) {
                this._blStatusText.text(`BL: ${this.backlightOn ? 'ON' : 'OFF'}`);
            }
            this._refreshCache();
        }
    }

    // ── 演示动画 ─────────────────────────────
    _tickDemo(dt) {
        const t = this._demoT;
        this._clearFB();

        // ─ 阶段 0~4s：正弦波 ─
        if (t < 4) {
            // 顶部文字
            this._writeTextInstant(2, 0, 'Sine Wave Demo');
            // 画正弦波
            for (let x = 0; x < this.COLS; x++) {
                const y = Math.round(
                    (this.ROWS / 2 - 10) +
                    14 * Math.sin((x / this.COLS) * 4 * Math.PI + t * 3)
                );
                for (let dy = -1; dy <= 1; dy++) {
                    this._setPixel(x, y + dy + 16, 1);
                }
            }
            // X / Y 轴
            for (let x = 0; x < this.COLS; x++) this._setPixel(x, 48, 1);
            for (let y = 16; y < 56; y++)     this._setPixel(0, y, 1);
        }
        // ─ 阶段 4~8s：字符滚动 ─
        else if (t < 8) {
            const offset = Math.floor((t - 4) * 8) % 16;
            const lines = [
                '  LCD 12864   ',
                '  128x64 STN  ',
                '  ST7920 DRV  ',
                '  Simulation  ',
            ];
            lines.forEach((line, row) => {
                this._writeTextInstant(0, row, line.slice(offset) + line.slice(0, offset));
            });
        }
        // ─ 阶段 8~12s：矩形/图形 ─
        else if (t < 12) {
            this._writeTextInstant(0, 0, ' Graphics Mode');
            const phase = (t - 8) / 4;
            for (let i = 0; i < 4; i++) {
                const margin = 4 + i * 6 + Math.round(phase * 4);
                const x0 = margin, y0 = 12 + margin * 0.5;
                const x1 = this.COLS - margin, y1 = this.ROWS - margin * 0.5;
                if (x0 < x1 && y0 < y1) this._drawRect(x0, y0, x1, y1);
            }
            // 对角线
            this._drawLine(0, 12, this.COLS - 1, this.ROWS - 1);
            this._drawLine(this.COLS - 1, 12, 0, this.ROWS - 1);
        }
        // ─ 循环 ─
        else {
            this._demoT = 0;
        }
    }

    // ═══════════════════════════════════════════
    // ── 帧缓冲操作 ────────────────────────────

    _clearFB() {
        this._framebuffer.fill(0);
    }

    _setPixel(x, y, v) {
        if (x < 0 || x >= this.COLS || y < 0 || y >= this.ROWS) return;
        this._framebuffer[y * this.COLS + x] = v ? 1 : 0;
    }

    _drawRect(x0, y0, x1, y1) {
        for (let x = x0; x <= x1; x++) { this._setPixel(x, y0, 1); this._setPixel(x, y1, 1); }
        for (let y = y0; y <= y1; y++) { this._setPixel(x0, y, 1); this._setPixel(x1, y, 1); }
    }

    _drawLine(x0, y0, x1, y1) {
        let dx = Math.abs(x1-x0), dy = Math.abs(y1-y0);
        let sx = x0<x1?1:-1, sy = y0<y1?1:-1, err = dx-dy;
        while(true) {
            this._setPixel(x0, y0, 1);
            if (x0===x1 && y0===y1) break;
            let e2 = 2*err;
            if (e2 > -dy) { err -= dy; x0 += sx; }
            if (e2 <  dx) { err += dx; y0 += sy; }
        }
    }

    /** 将单个 ASCII 字符写入帧缓冲（5×8 点阵，缩放到 pixW×pixH） */
    _writeCharToFB(col, row, char) {
        const font  = LCD12864.FONT_5X8;
        const glyph = font[char] || font[' '];
        const startX = col * 6;   // 每字符 6 像素宽（5+间距1）
        const startY = row * 8;   // 每字符 8 像素高

        for (let cx = 0; cx < 5; cx++) {
            const colData = glyph[cx] || 0;
            for (let cy = 0; cy < 8; cy++) {
                const bit = (colData >> cy) & 1;
                this._setPixel(startX + cx, startY + cy, bit);
            }
        }
        this._textBuffer[row][col] = char;
    }

    /** 立即写入一行文本（无打字机效果） */
    _writeTextInstant(startCol, row, text) {
        for (let i = 0; i < text.length && startCol + i < 16; i++) {
            this._writeCharToFB(startCol + i, row, text[i]);
        }
    }

    // ═══════════════════════════════════════════
    // ── 公共控制 API ──────────────────────────

    /** 清屏 */
    clear() {
        this._clearFB();
        this._textBuffer = Array.from({ length: 4 }, () => Array(16).fill(' '));
        this._dirty = true;
        this._refreshCache();
    }

    /**
     * 文本模式写入（打字机效果）
     * @param {string} text  要显示的字符串
     * @param {number} col   起始列（0~15）
     * @param {number} row   行（0~3）
     * @param {boolean} instant 是否立即显示（不走打字机队列）
     */
    writeText(text, col = 0, row = 0, instant = false) {
        if (instant) {
            this._writeTextInstant(col, row, text);
            this._cursorCol = Math.min(15, col + text.length);
            this._cursorRow = row;
        } else {
            for (let i = 0; i < text.length; i++) {
                const c = col + i;
                if (c >= 16) break;
                this._typeQueue.push({ col: c, row, char: text[i] });
            }
        }
        this._refreshCache();
    }

    /**
     * 图形模式：设置单个像素
     * @param {number} x   列像素坐标（0~127）
     * @param {number} y   行像素坐标（0~63）
     * @param {boolean} on 亮/灭
     */
    drawPixel(x, y, on = true) {
        this._setPixel(x, y, on ? 1 : 0);
        this._refreshCache();
    }

    /**
     * 图形模式：绘制位图
     * @param {number} x      起始列
     * @param {number} y      起始行
     * @param {number} width  宽度
     * @param {number} height 高度
     * @param {Uint8Array|Array} data 位图数据（每字节=8个横向像素，高位在左）
     */
    drawBitmap(x, y, width, height, data) {
        const bytesPerRow = Math.ceil(width / 8);
        for (let row = 0; row < height; row++) {
            for (let col = 0; col < width; col++) {
                const byteIdx = row * bytesPerRow + Math.floor(col / 8);
                const bit     = (data[byteIdx] >> (7 - (col % 8))) & 1;
                this._setPixel(x + col, y + row, bit);
            }
        }
        this._refreshCache();
    }

    /** 清除一行 */
    clearLine(row) {
        const startY = row * 8;
        for (let y = 0; y < 8; y++) {
            for (let x = 0; x < this.COLS; x++) {
                this._setPixel(x, startY + y, 0);
            }
        }
        this._textBuffer[row].fill(' ');
        this._refreshCache();
    }

    /** 设置背光 */
    setBacklight(on, brightness = 1.0) {
        this.backlightOn  = on;
        this.backlightBr  = Math.max(0, Math.min(1, brightness));
        this._blTargetBr  = on ? this.backlightBr : 0;
        this._refreshCache();
    }

    /** 设置光标位置 */
    setCursor(col, row) {
        this._cursorCol = Math.max(0, Math.min(15, col));
        this._cursorRow = Math.max(0, Math.min(3,  row));
    }

    /** 切换主题 */
    setTheme(name) {
        if (!LCD12864.BACKLIGHT_THEMES[name]) return;
        this.themeName = name;
        this._theme    = LCD12864.BACKLIGHT_THEMES[name];
        this._refreshCache();
    }

    /** 开启/关闭演示模式 */
    setDemoMode(on) {
        this._demoMode = on;
        if (on) { this._demoT = 0; this._clearFB(); }
    }

    /** 模拟复位 */
    reset() {
        this._clearFB();
        this._initScanLine = 0;
        this._initAnim     = true;
        this._typeQueue    = [];
        this._cursorCol    = 0;
        this._cursorRow    = 0;
        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label: '位号',       key: 'label',       type: 'text'   },
            { label: '背光主题',   key: 'theme',        type: 'select',
              options: Object.keys(LCD12864.BACKLIGHT_THEMES) },
            { label: '对比度',     key: 'contrast',     type: 'number' },
            { label: '背光开启',   key: 'backlightOn',  type: 'number' },
            { label: '打字速度',   key: 'typeSpeed',    type: 'number' },
            { label: '演示模式',   key: 'demoMode',     type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        this.label = cfg.label || this.label;
        if (cfg.theme)       this.setTheme(cfg.theme);
        if (cfg.contrast)    this.contrast   = parseFloat(cfg.contrast);
        if (cfg.backlightOn !== undefined) this.setBacklight(!!parseInt(cfg.backlightOn));
        if (cfg.typeSpeed)   this._typeSpeed = parseFloat(cfg.typeSpeed);
        if (cfg.demoMode !== undefined) this.setDemoMode(!!parseInt(cfg.demoMode));
        this.config = { ...this.config, ...cfg };
        this._refreshCache();
    }

    update(state) {
        if (typeof state === 'string') this.writeText(state, 0, 0, true);
        else if (typeof state === 'object' && state !== null) {
            if (state.text !== undefined) this.writeText(state.text, state.col||0, state.row||0, state.instant);
            if (state.pixel !== undefined) this.drawPixel(state.pixel.x, state.pixel.y, state.pixel.on);
            if (state.backlight !== undefined) this.setBacklight(state.backlight);
            if (state.clear) this.clear();
        }
        this._refreshCache();
    }

    destroy() { this._stopAnimation(); super.destroy?.(); }

    // ── 颜色工具 ─────────────────────────────
    _rgba(hex, alpha) {
        const h = hex.replace('#', '');
        const r = parseInt(h.substring(0,2), 16);
        const g = parseInt(h.substring(2,4), 16);
        const b = parseInt(h.substring(4,6), 16);
        return `rgba(${r},${g},${b},${(+alpha).toFixed(3)})`;
    }
    _lighten(hex, a) { return this._adjustBr(hex,  a); }
    _darken (hex, a) { return this._adjustBr(hex, -a); }
    _adjustBr(hex, a) {
        const h = hex.replace('#','');
        return '#' + [0,2,4].map(i => {
            const v = Math.min(255, Math.max(0,
                Math.round(parseInt(h.substring(i,i+2),16) + 255*a)));
            return v.toString(16).padStart(2,'0');
        }).join('');
    }
}