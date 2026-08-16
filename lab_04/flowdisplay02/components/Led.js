import { BaseComponent } from './BaseComponent.js';

/**
 * 发光二极管（LED）仿真组件
 * （Light Emitting Diode）
 *
 * ── 结构说明 ──────────────────────────────────────────────────
 *
 *  LED 是一种半导体发光器件，由以下部分组成：
 *
 *  1. 封装体（Lens / Dome）：半圆形透明/有色环氧树脂罩
 *     - 圆弧顶端（Dome Top）：聚光折射层，决定发光颜色
 *     - 平台圆柱（Flat Cylinder）：封装底座部分
 *  2. 阳极引脚（Anode / +）：较长引脚，正极，电流流入
 *  3. 阴极引脚（Cathode / -）：较短引脚，负极（内有平切标识）
 *  4. 杯形反射碗（Reflector Cup）：芯片下方，提升出光效率
 *  5. 键合线（Bond Wire）：芯片到引脚的连接细线
 *  6. 发光晕（Glow Halo）：导通时向外辐射的光晕效果
 *
 * ── 工作原理 ──────────────────────────────────────────────────
 *
 *  正向导通：阳极电位 > 阴极电位，且正向电压超过导通阈值（Vf）
 *    → 芯片发光，光晕动态呼吸，亮度随电流变化
 *  反向截止：阳极电位 ≤ 阴极电位
 *    → LED 熄灭，组件呈灰暗状态
 *
 *  仿真支持以下颜色：red / green / blue / yellow / white / orange
 *
 * ── 动画效果 ──────────────────────────────────────────────────
 *
 *  导通时：光晕呼吸动画（正弦缓动，周期约 1.5s）
 *  截止时：静态灰暗外观
 *  开/关瞬间：短暂闪烁过渡（100ms 渐亮 / 渐暗）
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  anode   — 阳极（+，长引脚，左侧）
 *  cathode — 阴极（−，短引脚，右侧）
 */
export class LED extends BaseComponent {

    // ── 颜色预设表 ──────────────────────────────
    static COLOR_PRESETS = {
        red:    { lens: '#ff4444', glow: '#ff2020', dim: '#8b2020', vf: 2.0 },
        green:  { lens: '#44ff44', glow: '#20ff40', dim: '#1a6620', vf: 2.2 },
        blue:   { lens: '#4488ff', glow: '#2060ff', dim: '#1a2880', vf: 3.2 },
        yellow: { lens: '#ffee44', glow: '#ffdd00', dim: '#806820', vf: 2.1 },
        white:  { lens: '#e8f4ff', glow: '#ffffff', dim: '#8090a0', vf: 3.4 },
        orange: { lens: '#ff8833', glow: '#ff6600', dim: '#804020', vf: 2.1 },
    };

    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(80,  config.width  || 120);
        this.height = Math.max(100, config.height || 150);

        this.type    = 'led';
        this.special = 'none';
        this.cache   = 'fixed';

        this._initGroups();
        // ── 额定参数 ──
        this.colorName    = config.color        || 'red';
        this.ratedVoltage = config.ratedVoltage || 5.0;   // V（电路电压）
        this.ratedCurrent = config.ratedCurrent || 20;    // mA（额定工作电流）
        this.label        = config.label        || 'LED'; // 位号

        this._colors = LED.COLOR_PRESETS[this.colorName] || LED.COLOR_PRESETS.red;
        this._vf     = this._colors.vf;  // 正向导通电压

        // ── 状态 ──
        this._lit           = config.initLit !== false ? false : true; // 默认熄灭
        this._animating     = false;   // 过渡动画（开/关瞬间）
        this._animT         = 0;       // 过渡进度 0~1
        this._animDir       = 1;       // +1 = 点亮，-1 = 熄灭
        this._animDur       = 0.10;    // s（开关过渡时长）
        this._breathT       = 0;       // 呼吸动画相位（0~2π）
        this._breathSpeed   = 2 * Math.PI / 1.5; // rad/s（1.5s 一周期）
        this._brightness    = this._lit ? 1.0 : 0.0; // 当前亮度 0~1

        // ── 几何尺寸 ──
        const W = this.width, H = this.height;

        // 封装体中心
        this._cx = W * 0.50;
        this._cy = H * 0.32;

        // 封装体尺寸
        this._lensR       = Math.min(W, H) * 0.28; // 半球半径
        this._bodyH       = this._lensR * 0.50;    // 圆柱高度
        this._bodyW       = this._lensR * 2.0;     // 圆柱宽度（= 直径）

        // 引脚
        this._pinLen      = H * 0.38;   // 引脚伸出长度
        this._pinW        = W * 0.030;  // 引脚线宽
        this._pinSpacing  = this._lensR * 0.80; // 两引脚间距

        // 光晕
        this._glowMaxR    = this._lensR * 2.8;
        this._glowMinR    = this._lensR * 1.5;


        this._init();

        // ── 端口 ──
        const pinTopY = this._cy + this._bodyH + this._pinLen + 4;
        this.addPort(
            this._cx - this._pinSpacing / 2,
            pinTopY,
            'anode', 'wire', 'A+'
        );
        this.addPort(
            this._cx + this._pinSpacing / 2,
            pinTopY,
            'cathode', 'wire', 'K-'
        );
    }

    // ═══════════════════════════════════════════
    _init() {
        this._drawGlowLayer();      // 最底层：光晕（动态）
        this._drawPins();           // 引脚（固定）
        this._drawReflectorCup();   // 反射碗（固定）
        this._drawBody();           // 封装圆柱（固定）
        this._drawDome();           // 半球镜头（固定底色）
        this._drawBondWire();       // 键合线（固定）
        this._drawLitOverlay();     // 点亮叠加层（动态）
        this._drawPinLabels();      // 引脚标注（固定）
        this._drawLabel();          // 位号标注
        this._drawStatusIndicator();
        
    }

    // ── 光晕层（最底层，动态）────────────────
    _drawGlowLayer() {
        this._glowGroup = new Konva.Group();
        this._staticGroup.add(this._glowGroup);
        this._rebuildGlow();
    }

    _rebuildGlow() {
        this._glowGroup.destroyChildren();
        if (this._brightness <= 0.01) return;

        const br  = this._brightness;
        const cx  = this._cx;
        const cy  = this._cy;
        const col = this._colors.glow;

        // 外层大光晕（径向渐变）
        const outerR = this._glowMinR + (this._glowMaxR - this._glowMinR) * br;
        this._glowGroup.add(new Konva.Circle({
            x: cx, y: cy,
            radius: outerR,
            fillRadialGradientStartPoint:  { x: 0, y: 0 },
            fillRadialGradientEndPoint:    { x: 0, y: 0 },
            fillRadialGradientStartRadius: this._lensR * 0.8,
            fillRadialGradientEndRadius:   outerR,
            fillRadialGradientColorStops:  [
                0,   this._hexToRgba(col, 0.30 * br),
                0.5, this._hexToRgba(col, 0.12 * br),
                1,   this._hexToRgba(col, 0),
            ],
        }));

        // 内核强光斑
        this._glowGroup.add(new Konva.Circle({
            x: cx, y: cy,
            radius: this._lensR * 1.1,
            fillRadialGradientStartPoint:  { x: 0, y: 0 },
            fillRadialGradientEndPoint:    { x: 0, y: 0 },
            fillRadialGradientStartRadius: 0,
            fillRadialGradientEndRadius:   this._lensR * 1.1,
            fillRadialGradientColorStops:  [
                0,   this._hexToRgba(col, 0.55 * br),
                0.6, this._hexToRgba(col, 0.18 * br),
                1,   this._hexToRgba(col, 0),
            ],
        }));
    }

    // ── 引脚 ─────────────────────────────────
    _drawPins() {
        const cx    = this._cx;
        const cy    = this._cy;
        const bodyH = this._bodyH;
        const pinL  = this._pinLen;
        const pinW  = this._pinW;
        const sp    = this._pinSpacing / 2;
        const pinY1 = cy + bodyH;
        const pinY2 = pinY1 + pinL;

        // 引脚渐变色（仿镀锡铜线）
        const pinGrad = {
            fillLinearGradientStartPoint: { x: -pinW, y: 0 },
            fillLinearGradientEndPoint:   { x:  pinW, y: 0 },
            fillLinearGradientColorStops: [0,'#9aa0a8', 0.5,'#e0e4e8', 1,'#9aa0a8'],
        };

        // ── 阳极（左，较长，末端弯折）──
        this._staticGroup.add(new Konva.Rect({
            x: cx - sp - pinW/2, y: pinY1,
            width: pinW, height: pinL,
            ...pinGrad,
            stroke: '#707880', strokeWidth: 0.5,
        }));
        // 阳极末端弯折（L 形，向左延伸）
        this._staticGroup.add(new Konva.Line({
            points: [cx - sp, pinY2, cx - sp - pinW*3, pinY2],
            stroke: '#c0c4c8', strokeWidth: pinW,
            lineCap: 'round',
        }));

        // ── 阴极（右，较短，末端有平切）──
        const cathodeLen = pinL * 0.88;
        this._staticGroup.add(new Konva.Rect({
            x: cx + sp - pinW/2, y: pinY1,
            width: pinW, height: cathodeLen,
            ...pinGrad,
            stroke: '#707880', strokeWidth: 0.5,
        }));
        // 阴极平切标记（侧面缺口）
        this._staticGroup.add(new Konva.Line({
            points: [
                cx + sp - pinW*1.5, pinY1 + cathodeLen * 0.05,
                cx + sp + pinW*2.5, pinY1 + cathodeLen * 0.05,
            ],
            stroke: '#555a60', strokeWidth: 1.2, lineCap: 'round',
        }));
        // 阴极末端弯折（向右延伸）
        this._staticGroup.add(new Konva.Line({
            points: [cx + sp, pinY1 + cathodeLen, cx + sp + pinW*3, pinY1 + cathodeLen],
            stroke: '#c0c4c8', strokeWidth: pinW,
            lineCap: 'round',
        }));
    }

    // ── 反射碗 ───────────────────────────────
    _drawReflectorCup() {
        const cx   = this._cx;
        const cy   = this._cy;
        const r    = this._lensR;
        const bH   = this._bodyH;
        const bW   = this._bodyW;

        // 反射碗（梯形，银白色）
        this._staticGroup.add(new Konva.Line({
            points: [
                cx - bW/2, cy + bH,
                cx - r*0.45, cy + r*0.08,
                cx + r*0.45, cy + r*0.08,
                cx + bW/2,  cy + bH,
            ],
            closed: true,
            fillLinearGradientStartPoint: { x: cx - bW/2, y: 0 },
            fillLinearGradientEndPoint:   { x: cx + bW/2, y: 0 },
            fillLinearGradientColorStops: [
                0, '#5a5a60', 0.3,'#b0b4b8', 0.5,'#d8dcde',
                0.7,'#b0b4b8', 1, '#5a5a60',
            ],
            stroke: '#444850', strokeWidth: 0.8,
        }));

        // 芯片（中心小方块）
        const chipS = r * 0.22;
        this._chip = new Konva.Rect({
            x: cx - chipS/2, y: cy - chipS/2 + r*0.08,
            width: chipS, height: chipS,
            fill: '#2a2a30', stroke: '#1a1a20', strokeWidth: 0.5,
            cornerRadius: 1,
        });
        this._staticGroup.add(this._chip);
    }

    // ── 封装圆柱（底座）─────────────────────
    _drawBody() {
        const cx  = this._cx;
        const cy  = this._cy;
        const r   = this._lensR;
        const bH  = this._bodyH;
        const col = this._colors;

        // 圆柱侧面
        this._staticGroup.add(new Konva.Rect({
            x: cx - r, y: cy,
            width: r * 2, height: bH,
            fillLinearGradientStartPoint: { x: cx - r, y: 0 },
            fillLinearGradientEndPoint:   { x: cx + r, y: 0 },
            fillLinearGradientColorStops: [
                0,   this._darken(col.dim, 0.6),
                0.25, col.dim,
                0.55, this._lighten(col.dim, 0.5),
                0.80, col.dim,
                1,   this._darken(col.dim, 0.6),
            ],
            stroke: this._darken(col.dim, 0.4), strokeWidth: 0.8,
        }));

        // 圆柱顶面椭圆（视角过渡）
        this._staticGroup.add(new Konva.Ellipse({
            x: cx, y: cy,
            radiusX: r, radiusY: r * 0.18,
            fill: this._lighten(col.dim, 0.3),
            stroke: this._darken(col.dim, 0.3), strokeWidth: 0.6,
        }));

        // 圆柱底面椭圆
        this._staticGroup.add(new Konva.Ellipse({
            x: cx, y: cy + bH,
            radiusX: r, radiusY: r * 0.18,
            fill: this._darken(col.dim, 0.5),
            stroke: this._darken(col.dim, 0.5), strokeWidth: 0.6,
        }));
    }

    // ── 半球镜头 ─────────────────────────────
    _drawDome() {
        const cx  = this._cx;
        const cy  = this._cy;
        const r   = this._lensR;
        const col = this._colors;

        // 半球主体
        this._dome = new Konva.Ellipse({
            x: cx, y: cy,
            radiusX: r, radiusY: r * 0.95,
            fillRadialGradientStartPoint:  { x: -r*0.20, y: -r*0.30 },
            fillRadialGradientEndPoint:    { x:  0, y: 0 },
            fillRadialGradientStartRadius: 0,
            fillRadialGradientEndRadius:   r * 1.2,
            fillRadialGradientColorStops:  [
                0,   this._lighten(col.dim, 1.0),
                0.4, col.dim,
                1,   this._darken(col.dim, 0.5),
            ],
            stroke: this._darken(col.dim, 0.4), strokeWidth: 1.0,
        });
        this._staticGroup.add(this._dome);

        // 高光斑（左上角白色椭圆）
        this._domeHL = new Konva.Ellipse({
            x: cx - r*0.28, y: cy - r*0.38,
            radiusX: r*0.28, radiusY: r*0.18,
            fill: 'rgba(255,255,255,0.30)',
            rotation: -25,
        });
        this._staticGroup.add(this._domeHL);

        // 次高光
        this._staticGroup.add(new Konva.Ellipse({
            x: cx - r*0.45, y: cy - r*0.20,
            radiusX: r*0.10, radiusY: r*0.08,
            fill: 'rgba(255,255,255,0.15)',
            rotation: -15,
        }));
    }

    // ── 点亮叠加层（动态）───────────────────
    _drawLitOverlay() {
        this._litGroup = new Konva.Group();
        this._staticGroup.add(this._litGroup);
        this._rebuildLitOverlay();
    }

    _rebuildLitOverlay() {
        this._litGroup.destroyChildren();
        if (this._brightness <= 0.01) return;

        const br  = this._brightness;
        const cx  = this._cx;
        const cy  = this._cy;
        const r   = this._lensR;
        const col = this._colors;

        // 点亮时，镜头颜色变亮
        this._litGroup.add(new Konva.Ellipse({
            x: cx, y: cy,
            radiusX: r, radiusY: r * 0.95,
            fillRadialGradientStartPoint:  { x: -r*0.20, y: -r*0.30 },
            fillRadialGradientEndPoint:    { x: 0, y: 0 },
            fillRadialGradientStartRadius: 0,
            fillRadialGradientEndRadius:   r * 1.2,
            fillRadialGradientColorStops:  [
                0,   this._hexToRgba('#ffffff', 0.90 * br),
                0.3, this._hexToRgba(col.lens,  0.85 * br),
                0.7, this._hexToRgba(col.glow,  0.60 * br),
                1,   this._hexToRgba(col.glow,  0.20 * br),
            ],
            stroke: this._hexToRgba(col.lens, 0.6 * br), strokeWidth: 1.0,
        }));

        // 核心白点（最亮处）
        this._litGroup.add(new Konva.Ellipse({
            x: cx - r*0.18, y: cy - r*0.25,
            radiusX: r*0.22, radiusY: r*0.16,
            fill: this._hexToRgba('#ffffff', 0.75 * br),
            rotation: -25,
        }));

        // 芯片点亮颜色
        if (this._chip) {
            this._litGroup.add(new Konva.Rect({
                x: this._chip.x(), y: this._chip.y(),
                width: this._chip.width(), height: this._chip.height(),
                fill: this._hexToRgba(col.glow, 0.9 * br),
                cornerRadius: 1,
            }));
        }
    }

    // ── 键合线 ───────────────────────────────
    _drawBondWire() {
        const cx  = this._cx;
        const cy  = this._cy;
        const r   = this._lensR;
        const sp  = this._pinSpacing / 2;
        const bH  = this._bodyH;
        const chipY = cy + r * 0.08;

        // 阳极键合线（芯片 → 左引脚内壁）
        this._staticGroup.add(new Konva.Line({
            points: [
                cx - r * 0.08, chipY,
                cx - sp * 0.7,  cy + bH * 0.30,
                cx - sp,        cy + bH,
            ],
            stroke: 'rgba(220,210,160,0.60)', strokeWidth: 0.7,
            tension: 0.5, lineCap: 'round',
        }));

        // 阴极键合线（芯片 → 右引脚内壁）
        this._staticGroup.add(new Konva.Line({
            points: [
                cx + r * 0.08, chipY,
                cx + sp * 0.7,  cy + bH * 0.30,
                cx + sp,        cy + bH,
            ],
            stroke: 'rgba(220,210,160,0.60)', strokeWidth: 0.7,
            tension: 0.5, lineCap: 'round',
        }));
    }

    // ── 引脚标注 ─────────────────────────────
    _drawPinLabels() {
        const cx     = this._cx;
        const pinY2  = this._cy + this._bodyH + this._pinLen;
        const sp     = this._pinSpacing / 2;

        // 阳极标注（+）
        this._staticGroup.add(new Konva.Text({
            x: cx - sp - 14, y: pinY2 + 4,
            text: '+', fontSize: 11, fontStyle: 'bold',
            fill: '#ef9a9a',
        }));
        // 阴极标注（-）
        this._staticGroup.add(new Konva.Text({
            x: cx + sp + 4, y: pinY2 + 4,
            text: '−', fontSize: 13, fontStyle: 'bold',
            fill: '#90caf9',
        }));
    }

    // ── 位号标注 ─────────────────────────────
    _drawLabel() {
        this._staticGroup.add(new Konva.Text({
            x: 0, y: -16, width: this.width,
            text: `${this.label}  ${this.colorName.toUpperCase()}  Vf=${this._vf}V`,
            fontSize: 9, fontStyle: 'bold', fill: '#546e7a', align: 'center',
        }));
    }

    // ── 状态指示 ─────────────────────────────
    _drawStatusIndicator() {
        const ix = this.width - 18;
        const iy = this._cy + this._bodyH + this._pinLen * 0.55;

        this._statusDot = new Konva.Circle({
            x: ix, y: iy, radius: 4,
            fill: this._lit ? this._colors.glow : '#555',
            stroke: this._lit ? this._colors.lens : '#333',
            strokeWidth: 0.8,
            shadowColor: this._lit ? this._colors.glow : 'transparent',
            shadowBlur:  this._lit ? 6 : 0,
            shadowOpacity: 0.9,
        });
        this._statusText = new Konva.Text({
            x: ix - 20, y: iy + 6,
            text: this._lit ? 'ON' : 'OFF',
            fontSize: 8, fontStyle: 'bold',
            fill: this._lit ? this._colors.glow : '#666',
            align: 'right', width: 18,
        });
        this._staticGroup.add(this._statusDot, this._statusText);
    }

    // ── 点击交互 ─────────────────────────────
    _bindInteraction() {
        // 点击封装体切换状态
        this._dome && this._dome.on('click tap', () => this.toggle());
        this._dome && this._dome.listening(true);
    }

    // ═══════════════════════════════════════════
    // 集中化 tick（由 consys._tickAll 在 20fps 调用）
    tick(dt) {
        this._tickAnimation(dt);
    
        this._refreshCache();
    }
    _tickAnimation(dt) {
        let dirty = false;

        // ── 开关过渡动画 ──
        if (this._animating) {
            this._animT += dt / this._animDur;
            if (this._animT >= 1) {
                this._animT     = 1;
                this._animating = false;
                this._lit       = this._animDir > 0;
            }
            const ease = 0.5 - 0.5 * Math.cos(this._animT * Math.PI);
            this._brightness = this._animDir > 0 ? ease : (1 - ease);
            dirty = true;
        }

        // ── 呼吸动画（点亮状态）──
        if (this._lit && !this._animating) {
            this._breathT += dt * this._breathSpeed;
            if (this._breathT > 2 * Math.PI) this._breathT -= 2 * Math.PI;
            const breathFactor = 0.82 + 0.18 * Math.sin(this._breathT);
            this._brightness = breathFactor;
            dirty = true;
        }

        if (!this._lit && !this._animating) {
            if (this._brightness > 0) {
                this._brightness = 0;
                dirty = true;
            }
        }

        if (dirty) {
            this._rebuildGlow();
            this._rebuildLitOverlay();
            this._updateStatus();
            this._refreshCache();
        }
    }

    _updateStatus() {
        const on = this._lit || (this._animating && this._animDir > 0 && this._brightness > 0.1);
        if (this._statusDot) {
            this._statusDot.fill(on ? this._colors.glow : '#555');
            this._statusDot.stroke(on ? this._colors.lens : '#333');
            this._statusDot.shadowColor(on ? this._colors.glow : 'transparent');
            this._statusDot.shadowBlur(on ? 6 : 0);
        }
        if (this._statusText) {
            this._statusText.text(on ? 'ON' : 'OFF');
            this._statusText.fill(on ? this._colors.glow : '#666');
        }
    }

    // ═══════════════════════════════════════════
    /** 切换点亮 / 熄灭 */
    toggle() {
        if (this._animating) return;
        this._animDir   = this._lit ? -1 : 1;
        this._animT     = 0;
        this._animating = true;
        this._refreshCache();
    }

    /** 点亮 */
    turnOn() {
        if (this._lit || this._animating) return;
        this._animDir   = 1;
        this._animT     = 0;
        this._animating = true;
        this._refreshCache();
    }

    /** 熄灭 */
    turnOff() {
        if (!this._lit || this._animating) return;
        this._animDir   = -1;
        this._animT     = 0;
        this._animating = true;
        this._refreshCache();
    }

    /** 查询当前状态 */
    isLit()       { return this._lit; }
    isAnimating() { return this._animating; }

    update(state) {
        if (typeof state === 'boolean') {
            state ? this.turnOn() : this.turnOff();
        }
        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label: '位号/名称',       key: 'label',         type: 'text'   },
            { label: '颜色',            key: 'color',         type: 'select',
              options: Object.keys(LED.COLOR_PRESETS) },
            { label: '额定电压 (V)',     key: 'ratedVoltage',  type: 'number' },
            { label: '额定电流 (mA)',    key: 'ratedCurrent',  type: 'number' },
            { label: '初始状态（亮=1）', key: 'initLit',       type: 'number' },
            { label: '呼吸周期 (s)',     key: 'breathPeriod',  type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        this.label        = cfg.label        || this.label;
        this.ratedVoltage = parseFloat(cfg.ratedVoltage) || this.ratedVoltage;
        this.ratedCurrent = parseFloat(cfg.ratedCurrent) || this.ratedCurrent;
        if (cfg.color && LED.COLOR_PRESETS[cfg.color]) {
            this.colorName = cfg.color;
            this._colors   = LED.COLOR_PRESETS[cfg.color];
            this._vf       = this._colors.vf;
        }
        if (cfg.breathPeriod) {
            this._breathSpeed = 2 * Math.PI / parseFloat(cfg.breathPeriod);
        }
        if (cfg.initLit !== undefined) {
            const wantLit = !!parseInt(cfg.initLit);
            if (wantLit !== this._lit) this.toggle();
        }
        this.config = { ...this.config, ...cfg };
        this._refreshCache();
    }

    destroy() {
        super.destroy?.();
    }

    // ═══════════════════════════════════════════
    // ── 颜色工具方法 ──────────────────────────

    /** hex → rgba 字符串，带 alpha */
    _hexToRgba(hex, alpha) {
        const h = hex.replace('#', '');
        const r = parseInt(h.substring(0, 2), 16);
        const g = parseInt(h.substring(2, 4), 16);
        const b = parseInt(h.substring(4, 6), 16);
        return `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
    }

    /** 加亮一个 hex 色 */
    _lighten(hex, amount) {
        return this._adjustBrightness(hex, amount);
    }

    /** 加暗一个 hex 色 */
    _darken(hex, amount) {
        return this._adjustBrightness(hex, -amount);
    }

    _adjustBrightness(hex, amount) {
        const h = hex.replace('#', '');
        let r = parseInt(h.substring(0, 2), 16);
        let g = parseInt(h.substring(2, 4), 16);
        let b = parseInt(h.substring(4, 6), 16);
        r = Math.min(255, Math.max(0, Math.round(r + 255 * amount)));
        g = Math.min(255, Math.max(0, Math.round(g + 255 * amount)));
        b = Math.min(255, Math.max(0, Math.round(b + 255 * amount)));
        return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
    }
}