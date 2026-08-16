import { BaseComponent } from './BaseComponent.js';

/**
 * 手持式数字温度显示仪表
 * （Handheld Digital Temperature Meter）
 *
 * 仿真一款手持式测温仪，外形参考 Fluke 52-II 数字温度表，
 * 带大屏幕 LCD 显示，可显示当前温度、最大/最小值、温度单位。
 */
export class HandheldTempMeter extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = config.width  || 200;
        this.height = config.height || 340;
        this.type   = 'handheld_temp';
        this.cache  = 'fixed';

        // ── 参数 ──
        this.label   = config.label   || 'TH-1';
        this.min     = config.min     || -50;
        this.max     = config.max     || 300;
        this.unit    = config.unit    || '°C';
        this.resolution = config.resolution || 0.1;

        // ── 温度状态 ──
        const initT = config.initTemp !== undefined ? config.initTemp : 0;
        this._temperature = initT;
        this._displayTemp = initT;
        this._maxTemp     = initT;
        this._minTemp     = initT;
        this._hold        = false;
        this._holdValue   = initT;
        this._overRange   = false;
        this._batteryLow  = false;
        this._backlight   = true;

        // ── 动画 ──
        this._animTime = 0;

        this._init();
    }

    _init() {
        this._drawCase();
        this._drawLCD();
        this._drawBrand();
        this._drawProbe();
        this._drawLabel();
    }

    // ── 外壳 ──
    _drawCase() {
        const W = this.width, H = this.height;

        // 机身主体（深灰 ABS 外壳）
        this.group.add(new Konva.Rect({
            x: 0, y: 0, width: W, height: H,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: W, y: 0 },
            fillLinearGradientColorStops: [
                0, '#2a3038', 0.15, '#3a4248', 0.5, '#4a5258',
                0.85, '#3a4248', 1, '#2a3038',
            ],
            stroke: '#181e22', strokeWidth: 2,
            cornerRadius: 16,
            shadowColor: '#000', shadowBlur: 12, shadowOffsetY: 4, shadowOpacity: 0.4,
        }));

        // 黄色护套（像 Fluke 风格，上下两端）
        this.group.add(new Konva.Rect({
            x: 2, y: 2, width: W - 4, height: 18,
            fill: '#e8a020', cornerRadius: [14, 14, 0, 0],
            strokeWidth: 0,
        }));
        this.group.add(new Konva.Rect({
            x: 2, y: H - 20, width: W - 4, height: 18,
            fill: '#e8a020', cornerRadius: [0, 0, 14, 14],
            strokeWidth: 0,
        }));

        // 防滑手柄纹路（下部）
        for (let i = 0; i < 5; i++) {
            const gy = H - 16 - i * 6;
            this.group.add(new Konva.Line({
                points: [W * 0.15, gy, W * 0.85, gy],
                stroke: 'rgba(0,0,0,0.12)', strokeWidth: 1.0,
            }));
        }

        // 顶部探头接口
        this.group.add(new Konva.Rect({
            x: W / 2 - 12, y: -4, width: 24, height: 8,
            fill: '#5a6068', stroke: '#3a4048', strokeWidth: 1,
            cornerRadius: [4, 4, 0, 0],
        }));
    }

    // ── LCD 屏幕（大字显示温度）──
    _drawLCD() {
        const W = this.width;
        const lcdX = W * 0.08, lcdY = 32;
        const lcdW = W * 0.84, lcdH = W * 0.54;

        // 屏幕边框（金属色）
        this.group.add(new Konva.Rect({
            x: lcdX - 4, y: lcdY - 4,
            width: lcdW + 8, height: lcdH + 8,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: lcdW + 8, y: 0 },
            fillLinearGradientColorStops: [0, '#6a7278', 0.5, '#9aa2a8', 1, '#6a7278'],
            cornerRadius: 4, strokeWidth: 0,
        }));

        // LCD 背光（深绿底色）
        this._lcdBg = new Konva.Rect({
            x: lcdX, y: lcdY, width: lcdW, height: lcdH,
            fill: '#0a1a0a', cornerRadius: 2, strokeWidth: 0,
        });
        this.group.add(this._lcdBg);

        // ── 主温度数字（大字）──
        this._mainText = new Konva.Text({
            x: lcdX + 6, y: lcdY + 6,
            width: lcdW - 12, height: lcdH * 0.62,
            text: '0.0',
            fontSize: lcdH * 0.42,
            fontFamily: 'Courier New, monospace',
            fill: '#4f4', align: 'right',
            verticalAlign: 'middle',
            listening: false,
        });
        this.group.add(this._mainText);

        // 温度单位
        this._unitText = new Konva.Text({
            x: lcdX + lcdW - 26, y: lcdY + 4,
            width: 22, text: this.unit,
            fontSize: lcdH * 0.16,
            fontFamily: 'Arial, sans-serif',
            fill: '#4f4', align: 'center',
            listening: false,
        });
        this.group.add(this._unitText);

        // ── 辅助信息行 ──
        const infoY = lcdY + lcdH * 0.68;
        this._infoText = new Konva.Text({
            x: lcdX + 6, y: infoY,
            width: lcdW - 12, height: lcdH * 0.28,
            text: 'MAX:--  MIN:--  HOLD',
            fontSize: lcdH * 0.12,
            fontFamily: 'Courier New, monospace',
            fill: '#4a8', align: 'left',
            listening: false,
        });
        this.group.add(this._infoText);
    }

    // ── 品牌标识 ──
    _drawBrand() {
        const W = this.width, H = this.height;
        this.group.add(new Konva.Text({
            x: W * 0.1, y: H - 36,
            width: W * 0.8,
            text: 'DIGITAL THERMOMETER',
            fontSize: 8,
            fontFamily: 'Arial Narrow, Arial, sans-serif',
            fill: '#8a9298',
            align: 'center',
            letterSpacing: 1,
            listening: false,
        }));
    }

    // ── 探头引线 ──
    _drawProbe() {
        const W = this.width, H = this.height;
        // 从顶部探头接口引出线缆
        this._probeLine = new Konva.Line({
            points: [W / 2, -4, W / 2 - 20, -35, W / 2 - 10, -55, W / 2 - 25, -80],
            stroke: '#444', strokeWidth: 2.5, lineCap: 'round',
            tension: 0.4,
            listening: false,
        });
        this.group.add(this._probeLine);

        // 探头
        this._probeTip = new Konva.Rect({
            x: W / 2 - 29, y: -90,
            width: 8, height: 16,
            fill: '#989898', stroke: '#666', strokeWidth: 1,
            cornerRadius: [3, 3, 1, 1],
            listening: false,
        });
        this.group.add(this._probeTip);
    }

    _drawLabel() {
        const W = this.width;
        this.group.add(new Konva.Text({
            x: 0, y: -22, width: W,
            text: this.label,
            fontSize: 9, fontStyle: 'bold',
            fill: '#546e7a', align: 'center',
        }));
    }

    // ═══════════════════════════════════════════
    // ── 温度更新 ──
    setTemperature(temp) {
        const clamped = Math.max(this.min - 5, Math.min(this.max + 5, temp));
        this._temperature = clamped;
        if (clamped > this._maxTemp) this._maxTemp = clamped;
        if (clamped < this._minTemp) this._minTemp = clamped;
        this._overRange = (temp > this.max + 2) || (temp < this.min - 2);
    }

    holdToggle() {
        if (this._hold) {
            this._hold = false;
        } else {
            this._hold = true;
            this._holdValue = this._displayTemp;
        }
    }

    clearMinMax() {
        this._maxTemp = this._temperature;
        this._minTemp = this._temperature;
    }

    update(temp) {
        this.setTemperature(temp);
    }

    _updateDisplay() {
        const display = this._hold ? this._holdValue : this._temperature;
        const text = display.toFixed(1);

        this._mainText.text(text);
        this._mainText.fill(this._overRange ? '#f44' : '#4f4');

        // 辅助信息
        const parts = [];
        parts.push(`MAX:${this._maxTemp.toFixed(1)}`);
        parts.push(`MIN:${this._minTemp.toFixed(1)}`);
        if (this._hold) parts.push('HOLD');
        this._infoText.text(parts.join('  '));
    }

    // ═══════════════════════════════════════════
    // ── 动画循环（由 consys._tickAll 在 20fps 调用）──
    tick(dt) {
        this._tick(dt);
    }

    _tick(dt) {
        this._animTime += dt;
        this._updateDisplay();
        this._refreshCache();
    }

    destroy() {
        super.destroy?.();
    }
}
