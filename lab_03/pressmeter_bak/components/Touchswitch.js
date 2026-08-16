import { BaseComponent } from './BaseComponent.js';

/**
 * 触摸开关（Touch Switch）仿真组件
 *
 * ── 结构说明 ──────────────────────────────────────────────────
 *
 *  触摸开关是一种无机械触点的智能开关，由以下部分组成：
 *
 *  1. 外壳（Housing）：米白色方形塑料面板，嵌入墙面安装盒
 *  2. 触摸感应面板（Touch Sensing Panel）：深色镀膜玻璃/金属感应区，
 *     位于面板中央，对手指触摸产生响应
 *  3. 状态指示灯环（LED Ring）：感应区四周细光圈，
 *     合闸→橙黄暖光，分闸→蓝色待机光
 *  4. 内部继电器（Relay）：通过固态继电器控制主回路通断
 *  5. 底部接线端子（Terminals）：L（相线）、N（零线）、L'（出线）
 *
 * ── 外观参考（图片）─────────────────────────────────────────
 *
 *  方形米白色塑料外框（带斜边倒角）
 *  中央正方形深色（深银灰/镜面）感应区，有微弱光晕
 *  底部两根细线管接口（红色线鼻）
 *  整体风格：工业/家居通用面板式安装
 *
 * ── 动作逻辑 ──────────────────────────────────────────────────
 *
 *  点击感应面板 → 触发 toggle()
 *  ON（合闸）：指示灯橙黄，感应面板发暖光，继电器吸合
 *  OFF（分闸）：指示灯蓝色，感应面板深色，继电器断开
 *
 *  切换动画：200ms 光晕淡入淡出 + 纹波扩散效果
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  terminal_l  — 相线进线端（L）
 *  terminal_n  — 零线端（N）
 *  terminal_lo — 相线出线端（L'）
 */
export class TouchSwitch extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(140, config.width  || 180);
        this.height = Math.max(140, config.height || 180);

        this.type    = 'touch_switch';
        this.special = 'none';
        this.cache   = 'fixed';

        // ── 额定参数 ──
        this.ratedVoltage = config.ratedVoltage || 220;    // V
        this.ratedCurrent = config.ratedCurrent || 10;     // A
        this.label        = config.label        || 'S';    // 位号
        this.loadLabel    = config.loadLabel    || 'LIGHT'; // 负载名

        // ── 状态 ──
        this._closed      = config.initClosed !== false ? false : true;
        this._animating   = false;
        this._animT       = 0;
        this._animDur     = config.animDur || 0.20;  // s
        this._animDir     = 1;                        // +1=合闸，-1=分闸

        // 操作计数
        this.opsCount = config.initOps || 0;

        // ── 几何尺寸 ──
        const W = this.width, H = this.height;

        // 外壳面板
        this._housing = {
            x: W * 0.04, y: H * 0.04,
            w: W * 0.92, h: H * 0.82,
            rx: 8,
        };

        // 感应区（面板中央正方形）
        const hx = this._housing.x, hy = this._housing.y;
        const hw = this._housing.w, hh = this._housing.h;
        const panelSize = Math.min(hw, hh) * 0.52;
        this._panel = {
            x: hx + (hw - panelSize) / 2,
            y: hy + (hh - panelSize) / 2 - hh * 0.02,
            size: panelSize,
            rx: 5,
        };

        // 底部接线端子区
        this._terminalArea = {
            x: W * 0.04,
            y: H * 0.87,
            w: W * 0.92,
            h: H * 0.10,
        };

        // 三个端子 X 坐标
        this._termL  = { x: W * 0.22 };
        this._termN  = { x: W * 0.50 };
        this._termLo = { x: W * 0.78 };

        // 动画参数（光晕半径 & 不透明度）
        this._glowAlpha   = this._closed ? 0.85 : 0.25;
        this._rippleR     = 0;
        this._rippleAlpha = 0;


        this._init();

        // ── 注册端口 ──
        const tyBottom = this._terminalArea.y + this._terminalArea.h + 4;
        this.addPort(this._termL.x,  tyBottom, 'terminal_l',  'wire', 'L');
        this.addPort(this._termN.x,  tyBottom, 'terminal_n',  'wire', 'N');
        this.addPort(this._termLo.x, tyBottom, 'terminal_lo', 'wire', "L'");
    }

    // ═══════════════════════════════════════════
    _init() {
        this._drawHousing();
        this._drawScrews();
        this._drawPanelBase();
        this._drawTerminalArea();
        this._drawLabel();
        this._dynamicGroup = new Konva.Group();
        this.group.add(this._dynamicGroup);
        this._rebuildDynamic();
        this._drawStatusIndicator();
        
    }

    // ── 外壳 ─────────────────────────────────
    _drawHousing() {
        const b = this._housing;

        // 外壳侧边阴影（立体感）
        this.group.add(new Konva.Rect({
            x: b.x + 3, y: b.y + 3,
            width: b.w, height: b.h,
            fill: 'rgba(0,0,0,0.18)',
            cornerRadius: b.rx + 1,
        }));

        // 外壳主体（米白色）
        this.group.add(new Konva.Rect({
            x: b.x, y: b.y, width: b.w, height: b.h,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: b.w, y: b.h },
            fillLinearGradientColorStops: [
                0,   '#f0ede8',
                0.35,'#e8e4de',
                0.70,'#dedad4',
                1,   '#ccc8c2',
            ],
            stroke: '#b0aca6', strokeWidth: 1.2,
            cornerRadius: b.rx,
        }));

        // 顶面高光（左上角斜面反光）
        this.group.add(new Konva.Rect({
            x: b.x + 2, y: b.y + 2,
            width: b.w * 0.55, height: b.h * 0.18,
            fill: 'rgba(255,255,255,0.32)',
            cornerRadius: [b.rx, 0, 0, 0],
        }));

        // 面板内嵌凹槽（面板比外壳略内凹）
        this.group.add(new Konva.Rect({
            x: b.x + b.w * 0.06, y: b.y + b.h * 0.06,
            width: b.w * 0.88, height: b.h * 0.88,
            fill: 'rgba(0,0,0,0.04)',
            stroke: 'rgba(0,0,0,0.08)', strokeWidth: 1,
            cornerRadius: b.rx - 2,
        }));
    }

    // ── 四角固定螺钉 ──────────────────────────
    _drawScrews() {
        const b  = this._housing;
        const r  = this.width * 0.022;
        const ox = b.w * 0.12, oy = b.h * 0.10;
        const positions = [
            { x: b.x + ox,       y: b.y + oy },
            { x: b.x + b.w - ox, y: b.y + oy },
            { x: b.x + ox,       y: b.y + b.h - oy },
            { x: b.x + b.w - ox, y: b.y + b.h - oy },
        ];
        positions.forEach(({ x, y }) => {
            this.group.add(new Konva.Circle({
                x, y, radius: r,
                fillRadialGradientStartPoint: { x: -r*0.3, y: -r*0.3 },
                fillRadialGradientEndPoint:   { x: 0, y: 0 },
                fillRadialGradientStartRadius: 0,
                fillRadialGradientEndRadius:   r,
                fillRadialGradientColorStops:  [0,'#d8d4ce',1,'#a8a49e'],
                stroke: '#909090', strokeWidth: 0.7,
            }));
            // 十字槽
            this.group.add(new Konva.Line({
                points: [x - r*0.55, y, x + r*0.55, y],
                stroke: '#707070', strokeWidth: 0.9, lineCap: 'round',
            }));
            this.group.add(new Konva.Line({
                points: [x, y - r*0.55, x, y + r*0.55],
                stroke: '#707070', strokeWidth: 0.9, lineCap: 'round',
            }));
        });
    }

    // ── 感应面板（静态底层）────────────────────
    _drawPanelBase() {
        const p = this._panel;
        // 感应区外框（金属拉丝质感）
        this.group.add(new Konva.Rect({
            x: p.x - 3, y: p.y - 3,
            width: p.size + 6, height: p.size + 6,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: p.size + 6, y: p.size + 6 },
            fillLinearGradientColorStops: [
                0, '#a0a0a0', 0.4, '#d0d0d0', 0.6, '#b8b8b8', 1, '#888888',
            ],
            cornerRadius: p.rx + 2,
            stroke: '#707070', strokeWidth: 1,
        }));

        // 感应区主体（深色镀膜玻璃）
        this.group.add(new Konva.Rect({
            x: p.x, y: p.y, width: p.size, height: p.size,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: p.size, y: p.size },
            fillLinearGradientColorStops: [
                0,   '#2e2e30',
                0.3, '#3a3a3e',
                0.6, '#2a2a2c',
                1,   '#1e1e20',
            ],
            cornerRadius: p.rx,
            stroke: '#222224', strokeWidth: 0.5,
        }));

        // 感应区内反光（镜面效果，左上斜角高光）
        this.group.add(new Konva.Rect({
            x: p.x + p.size*0.05, y: p.y + p.size*0.05,
            width: p.size * 0.45, height: p.size * 0.20,
            fill: 'rgba(255,255,255,0.08)',
            cornerRadius: [p.rx, 0, 0, 0],
        }));

        // 感应区右下角副高光
        this.group.add(new Konva.Rect({
            x: p.x + p.size*0.65, y: p.y + p.size*0.72,
            width: p.size * 0.28, height: p.size * 0.12,
            fill: 'rgba(255,255,255,0.05)',
            cornerRadius: [0, 0, p.rx, 0],
        }));
    }

    // ── 接线端子区 ────────────────────────────
    _drawTerminalArea() {
        const ta = this._terminalArea;

        // 端子底条
        this.group.add(new Konva.Rect({
            x: ta.x, y: ta.y, width: ta.w, height: ta.h,
            fill: '#d0ccc6', stroke: '#a0a09a', strokeWidth: 0.8,
            cornerRadius: 2,
        }));

        const termY = ta.y + ta.h / 2;
        const termDefs = [
            { x: this._termL.x,  label: 'L',  color: '#e53935' },
            { x: this._termN.x,  label: 'N',  color: '#1565c0' },
            { x: this._termLo.x, label: "L'", color: '#e53935' },
        ];

        termDefs.forEach(({ x, label, color }) => {
            const r = this.width * 0.030;
            // 端子圆孔
            this.group.add(new Konva.Circle({
                x, y: termY, radius: r,
                fill: '#383838', stroke: '#888', strokeWidth: 0.8,
            }));
            // 红色/蓝色线鼻子（接线标识）
            this.group.add(new Konva.Rect({
                x: x - r * 0.55, y: termY + r * 0.55,
                width: r * 1.10, height: r * 0.90,
                fill: color, cornerRadius: 1,
            }));
            // 标注文字
            this.group.add(new Konva.Text({
                x: x - 6, y: ta.y - 11,
                text: label, fontSize: 7.5,
                fill: '#505050', fontStyle: 'bold',
            }));
        });
    }

    // ── 标注（位号、额定参数）────────────────
    _drawLabel() {
        this.group.add(new Konva.Text({
            x: 0, y: -16, width: this.width,
            text: `${this.label}  ${this.ratedVoltage}V / ${this.ratedCurrent}A`,
            fontSize: 9, fontStyle: 'bold', fill: '#546e7a', align: 'center',
        }));
        // 负载名（面板下方）
        this.group.add(new Konva.Text({
            x: 0,
            y: this._panel.y + this._panel.size + 8,
            width: this.width,
            text: this.loadLabel,
            fontSize: 8, fill: '#7a7a7a', align: 'center',
        }));
    }

    // ── 动态层：光圈 + 纹波 + 中心图标 ─────────
    _rebuildDynamic() {
        this._dynamicGroup.destroyChildren();

        const p      = this._panel;
        const cx     = p.x + p.size / 2;
        const cy     = p.y + p.size / 2;
        const closed = this._closed;
        const alpha  = this._glowAlpha;

        // ── 状态光晕（感应面板背光）──
        const glowColor = closed
            ? `rgba(255,160,40,${alpha * 0.55})`
            : `rgba(40,120,255,${alpha * 0.28})`;

        this._dynamicGroup.add(new Konva.Rect({
            x: p.x + 1, y: p.y + 1,
            width: p.size - 2, height: p.size - 2,
            fill: glowColor,
            cornerRadius: p.rx,
        }));

        // ── LED 指示环（感应区四周）──
        const ringColor = closed ? '#ffb030' : '#4090ff';
        const ringAlpha = closed ? 0.90 : 0.55;

        // 上边光条
        this._dynamicGroup.add(new Konva.Rect({
            x: p.x + p.size*0.15, y: p.y + 2,
            width: p.size * 0.70, height: 3,
            fill: ringColor, opacity: ringAlpha,
            cornerRadius: 2,
            shadowColor: ringColor, shadowBlur: closed ? 8 : 4, shadowOpacity: 0.9,
        }));
        // 下边光条
        this._dynamicGroup.add(new Konva.Rect({
            x: p.x + p.size*0.15, y: p.y + p.size - 5,
            width: p.size * 0.70, height: 3,
            fill: ringColor, opacity: ringAlpha,
            cornerRadius: 2,
            shadowColor: ringColor, shadowBlur: closed ? 8 : 4, shadowOpacity: 0.9,
        }));
        // 左边光条
        this._dynamicGroup.add(new Konva.Rect({
            x: p.x + 2, y: p.y + p.size*0.15,
            width: 3, height: p.size * 0.70,
            fill: ringColor, opacity: ringAlpha,
            cornerRadius: 2,
            shadowColor: ringColor, shadowBlur: closed ? 8 : 4, shadowOpacity: 0.9,
        }));
        // 右边光条
        this._dynamicGroup.add(new Konva.Rect({
            x: p.x + p.size - 5, y: p.y + p.size*0.15,
            width: 3, height: p.size * 0.70,
            fill: ringColor, opacity: ringAlpha,
            cornerRadius: 2,
            shadowColor: ringColor, shadowBlur: closed ? 8 : 4, shadowOpacity: 0.9,
        }));

        // ── 中心电源符号图标 ──
        const iconR = p.size * 0.18;
        const iconStroke = closed ? '#ffcc60' : '#6090cc';
        const iconAlpha  = closed ? 0.95 : 0.50;

        // 电源圆弧（缺口在顶部）
        this._dynamicGroup.add(new Konva.Arc({
            x: cx, y: cy,
            innerRadius: iconR * 0.72,
            outerRadius: iconR * 0.72,
            angle: 300,
            rotation: 120,
            stroke: iconStroke, strokeWidth: 2.5,
            opacity: iconAlpha,
            lineCap: 'round',
        }));
        // 电源竖线（顶部缺口的短竖线）
        this._dynamicGroup.add(new Konva.Line({
            points: [cx, cy - iconR * 0.45, cx, cy - iconR * 0.95],
            stroke: iconStroke, strokeWidth: 2.5,
            lineCap: 'round', opacity: iconAlpha,
        }));

        // ── 触摸纹波扩散动画层 ──
        if (this._animating && this._rippleR > 0) {
            this._dynamicGroup.add(new Konva.Circle({
                x: cx, y: cy,
                radius: this._rippleR,
                stroke: closed ? 'rgba(255,180,60,' + this._rippleAlpha + ')' : 'rgba(80,160,255,' + this._rippleAlpha + ')',
                strokeWidth: 1.8,
                fill: 'transparent',
            }));
        }

        // 绑定交互（覆盖在动态层）
        this._dynamicGroup.on('click tap', () => this.toggle());
        this._dynamicGroup.listening(true);

        // 同步更新感应区鼠标手型
        this._dynamicGroup.on('mouseenter', () => {
            const stage = this._dynamicGroup.getStage?.();
            if (stage) stage.container().style.cursor = 'pointer';
        });
        this._dynamicGroup.on('mouseleave', () => {
            const stage = this._dynamicGroup.getStage?.();
            if (stage) stage.container().style.cursor = 'default';
        });
    }

    // ── 状态指示灯（外壳右下角）───────────────
    _drawStatusIndicator() {
        const b  = this._housing;
        const ix = b.x + b.w - 14;
        const iy = b.y + b.h - 12;

        this._statusDot = new Konva.Circle({
            x: ix, y: iy, radius: 4,
            fill:        this._closed ? '#66bb6a' : '#ef5350',
            stroke:      this._closed ? '#2e7d32' : '#c62828',
            strokeWidth: 0.8,
            shadowColor: this._closed ? '#66bb6a' : '#ef5350',
            shadowBlur:  this._closed ? 6 : 2,
            shadowOpacity: 0.85,
        });
        this._statusText = new Konva.Text({
            x: ix - 18, y: iy - 5,
            text: this._closed ? 'ON' : 'OFF',
            fontSize: 7.5, fontStyle: 'bold',
            fill: this._closed ? '#66bb6a' : '#ef5350',
        });
        this.group.add(this._statusDot, this._statusText);
    }

    // ── 动画循环 ──────────────────────────────
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
            this._closed    = this._animDir > 0;
            this._rippleR   = 0;
            this._rippleAlpha = 0;
        }

        // 正弦缓动
        const ease = 0.5 - 0.5 * Math.cos(this._animT * Math.PI);

        // 光晕透明度插值
        if (this._animDir > 0) {
            this._glowAlpha = 0.25 + 0.60 * ease;   // 渐亮
        } else {
            this._glowAlpha = 0.85 - 0.60 * ease;   // 渐暗
        }

        // 纹波半径（0 → panel.size*0.48 → 消失）
        const maxR = this._panel.size * 0.48;
        this._rippleR     = maxR * Math.sin(this._animT * Math.PI);
        this._rippleAlpha = (1 - this._animT) * 0.75;

        this._rebuildDynamic();
        this._updateStatus();
        this._refreshCache();
    }

    _updateStatus() {
        const c = this._animDir > 0 ? this._animT > 0.5 : this._animT < 0.5;
        const on = this._animating ? c : this._closed;
        if (this._statusDot) {
            this._statusDot.fill(on ? '#66bb6a' : '#ef5350');
            this._statusDot.stroke(on ? '#2e7d32' : '#c62828');
            this._statusDot.shadowColor(on ? '#66bb6a' : '#ef5350');
            this._statusDot.shadowBlur(on ? 6 : 2);
        }
        if (this._statusText) {
            this._statusText.text(on ? 'ON' : 'OFF');
            this._statusText.fill(on ? '#66bb6a' : '#ef5350');
        }
    }

    // ═══════════════════════════════════════════
    /** 切换开关状态 */
    toggle() {
        if (this._animating) return;
        this._animDir   = this._closed ? -1 : 1;
        this._animT     = 0;
        this._animating = true;
        this._rippleR   = 0;
        this._rippleAlpha = 0;
        this.opsCount++;
        this._refreshCache();
    }

    /** 合闸（接通） */
    close() {
        if (this._closed || this._animating) return;
        this._animDir   = 1;
        this._animT     = 0;
        this._animating = true;
        this.opsCount++;
        this._refreshCache();
    }

    /** 分闸（断开） */
    open() {
        if (!this._closed || this._animating) return;
        this._animDir   = -1;
        this._animT     = 0;
        this._animating = true;
        this.opsCount++;
        this._refreshCache();
    }

    /** 查询当前状态 */
    isClosed()    { return this._closed; }
    isAnimating() { return this._animating; }
    getOpsCount() { return this.opsCount; }

    update(state) {
        if (typeof state === 'boolean') {
            state ? this.close() : this.open();
        }
        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label: '位号/名称',         key: 'label',        type: 'text'   },
            { label: '负载标注',           key: 'loadLabel',    type: 'text'   },
            { label: '额定电压 (V)',       key: 'ratedVoltage', type: 'number' },
            { label: '额定电流 (A)',       key: 'ratedCurrent', type: 'number' },
            { label: '初始状态（接通=1）', key: 'initClosed',   type: 'number' },
            { label: '动作时间 (s)',       key: 'animDur',      type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        this.label        = cfg.label        || this.label;
        this.loadLabel    = cfg.loadLabel    || this.loadLabel;
        this.ratedVoltage = parseFloat(cfg.ratedVoltage) || this.ratedVoltage;
        this.ratedCurrent = parseFloat(cfg.ratedCurrent) || this.ratedCurrent;
        this._animDur     = parseFloat(cfg.animDur)      || this._animDur;
        if (cfg.initClosed !== undefined) {
            const wantClosed = !!parseInt(cfg.initClosed);
            if (wantClosed !== this._closed) this.toggle();
        }
        this.config = { ...this.config, ...cfg };
        this._refreshCache();
    }

    destroy() {
        super.destroy?.();
    }
}