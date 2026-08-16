import { BaseComponent } from '../BaseComponent.js';

/**
 * 储水式电热水器仿真组件
 * （Electric Storage Water Heater）
 *
 * ── 结构说明 ──────────────────────────────────────────────────
 *
 *  参考图片为卧式储水式电热水器（横卧圆柱筒），主要部分：
 *
 *  1. 筒体（Tank Body）：白色圆角横卧矩形，表面有流线装饰曲线
 *     - 左端盖（Left Cap）：左侧半椭圆封头
 *     - 右端盖（Right Cap）：右侧半椭圆封头
 *     - 装饰曲线：深棕色 S 形波浪纹（品牌装饰）
 *     - 装饰圆点：四个空心圆圈（品牌装饰）
 *
 *  2. 控制面板（Control Panel）：右侧黑色矩形面板，含：
 *     - LCD 温度显示屏：显示当前水温（°C），蓝绿色数码管字体
 *     - 电源指示灯：面板左下，亮红/灭
 *     - 加热指示灯：面板右下，亮橙/灭
 *     - 调温旋钮：黑色带刻度拨盘，可拖拽旋转设定温度（35~75°C）
 *     - 电源开关按钮：面板左下小圆按钮
 *
 *  3. 接管组（Pipe Connections）：筒体底部，三路接管：
 *     - 冷水进口（Cold Water Inlet）：蓝色接头，左侧
 *     - 热水出口（Hot Water Outlet）：红色接头，中间
 *     - 备用/排污口（Drain）：中右侧（可选）
 *
 *  4. 铭牌（Nameplate）：右下角能效标签贴纸
 *
 * ── 工作状态 ──────────────────────────────────────────────────
 *
 *  OFF（断电）
 *    电源指示灯灭，加热指示灯灭，LCD 熄屏，旋钮无效
 *
 *  STANDBY（待机，通电但水温已达设定值）
 *    电源指示灯亮（红），加热指示灯灭，LCD 显示当前温度
 *    当前温度 ≥ 设定温度 - 2°C 时进入待机
 *
 *  HEATING（加热中）
 *    电源指示灯亮（红），加热指示灯亮（橙，闪烁），LCD 显示当前温度
 *    温度以 ~1°C/5s 的速率缓慢上升（仿真加速），直至达到设定值
 *    加热时筒体背景色带轻微橙色暖光晕
 *
 * ── 交互方式 ──────────────────────────────────────────────────
 *
 *  1. 点击电源按钮：切换 ON ↔ OFF
 *  2. 拖拽调温旋钮（顺时针/逆时针）：设定温度 35°C ~ 75°C
 *     - 旋钮每转动 1° 对应约 0.11°C（总行程 360°对应 40°C）
 *     - 旋钮刻度盘有角度指示线
 *  3. LCD 显示当前水温（实时仿真升降温）
 *
 * ── 仿真升温逻辑 ──────────────────────────────────────────────
 *
 *  通电且 currentTemp < setTemp：加热，currentTemp += 2°C/s（仿真时间）
 *  断电或 currentTemp >= setTemp：停止加热，自然冷却 0.1°C/s
 *  加热指示灯以 0.8s 为周期闪烁
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  terminal_cold   — 冷水进口（筒体底部左）
 *  terminal_hot    — 热水出口（筒体底部中）
 *  terminal_power  — 电源接口（筒体右侧/控制面板区域）
 */
export class ElectricWaterHeater extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(360, config.width  || 440);
        this.height = Math.max(200, config.height || 260);

        this.type    = 'electric_water_heater';
        this.special = 'none';
        this.cache   = 'fixed';

        this._initGroups();
        // ── 铭牌参数 ──
        this.label        = config.label        || 'EWH';
        this.ratedVoltage = config.ratedVoltage || 220;    // V
        this.ratedPower   = config.ratedPower   || 2000;   // W
        this.capacity     = config.capacity     || 60;     // L

        // ── 状态 ──
        this._powered     = config.initPowered  || false;
        this._setTemp     = config.initSetTemp  || 55;     // °C 设定温度
        this._curTemp     = config.initCurTemp  || 25;     // °C 当前水温
        this._minTemp     = 35;
        this._maxTemp     = 75;

        // 旋钮拖拽状态
        this._knobAngle   = this._tempToAngle(this._setTemp); // 旋钮当前角度（°）
        this._dragging    = false;
        this._dragStartAngle = 0;
        this._dragStartKnob  = 0;

        // 加热指示灯闪烁
        this._blinkT      = 0;
        this._blinkOn     = false;


        // ── 几何 ──
        this._calcGeometry();
        this._init();

        // ── 端口 ──
        const g = this._geo;
        this.addPort(g.coldPipeX,  g.pipePortY, 'terminal_cold',  'wire', 'CW');
        this.addPort(g.hotPipeX,   g.pipePortY, 'terminal_hot',   'wire', 'HW');
        this.addPort(g.powerPortX, g.powerPortY,'terminal_power', 'wire', 'AC');
    }

    // ═══════════════════════════════════════════
    _calcGeometry() {
        const W = this.width, H = this.height;
        const g = {};

        // 筒体外轮廓（横卧，大圆角矩形）
        g.tankX  = W * 0.02;
        g.tankY  = H * 0.06;
        g.tankW  = W * 0.96;
        g.tankH  = H * 0.72;
        g.tankRx = g.tankH * 0.48;   // 高度约一半作为圆角半径，形成端盖圆弧

        // 筒体中心
        g.tankCX = g.tankX + g.tankW / 2;
        g.tankCY = g.tankY + g.tankH / 2;

        // 控制面板（右侧约 22% 宽度区域）
        g.panelX = g.tankX + g.tankW * 0.72;
        g.panelY = g.tankY + g.tankH * 0.12;
        g.panelW = g.tankW * 0.20;
        g.panelH = g.tankH * 0.76;
        g.panelRx = 6;

        // LCD 屏（面板内左上区域）
        g.lcdX = g.panelX + g.panelW * 0.06;
        g.lcdY = g.panelY + g.panelH * 0.08;
        g.lcdW = g.panelW * 0.52;
        g.lcdH = g.panelH * 0.38;

        // 调温旋钮（面板右侧圆形）
        g.knobCX = g.panelX + g.panelW * 0.80;
        g.knobCY = g.panelY + g.panelH * 0.42;
        g.knobR  = g.panelH * 0.26;

        // 电源按钮（面板左下）
        g.pwrBtnX = g.panelX + g.panelW * 0.12;
        g.pwrBtnY = g.panelY + g.panelH * 0.72;
        g.pwrBtnR = g.panelH * 0.065;

        // 指示灯（LCD 下方两颗）
        g.led1CX = g.lcdX + g.lcdW * 0.28;
        g.led1CY = g.lcdY + g.lcdH + g.panelH * 0.09;
        g.led2CX = g.lcdX + g.lcdW * 0.72;
        g.led2CY = g.led1CY;
        g.ledR   = g.panelH * 0.042;

        // 装饰圆点（筒体中央略左位置，4颗）
        const dotBaseX = g.tankX + g.tankW * 0.40;
        const dotBaseY = g.tankCY - g.tankH * 0.05;
        const dotGap   = g.tankW * 0.040;
        g.dots = Array.from({ length: 4 }, (_, i) => ({
            cx: dotBaseX + i * dotGap,
            cy: dotBaseY,
            r: g.tankH * 0.042,
        }));

        // 底部接管
        const pipeBaseY = g.tankY + g.tankH + H * 0.03;
        g.coldPipeX  = g.tankX + g.tankW * 0.28;
        g.hotPipeX   = g.tankX + g.tankW * 0.38;
        g.pipeY      = pipeBaseY;
        g.pipeH      = H * 0.12;
        g.pipeW      = W * 0.040;
        g.pipePortY  = pipeBaseY + g.pipeH + 4;

        // 电源端口（右侧，控制面板下方）
        g.powerPortX = g.panelX + g.panelW * 0.50;
        g.powerPortY = H;

        // 能效标签（右下角）
        g.labelX = g.tankX + g.tankW * 0.91;
        g.labelY = g.tankY + g.tankH * 0.55;
        g.labelW = g.tankW * 0.07;
        g.labelH = g.tankH * 0.38;

        this._geo = g;
    }

    // ═══════════════════════════════════════════
    _init() {
        this._drawTankBody();
        this._drawDecoration();
        this._drawPipes();
        this._drawPanel();
        this._drawLCD();
        this._drawKnob();
        this._drawPowerButton();
        this._drawIndicatorLEDs();
        this._drawEnergyLabel();
        this._drawNameLabel();
        
    }

    // ── 筒体主体 ──────────────────────────────
    _drawTankBody() {
        const g = this._geo;

        // 筒体阴影
        this._staticGroup.add(new Konva.Rect({
            x: g.tankX + 6, y: g.tankY + 8,
            width: g.tankW - 4, height: g.tankH,
            fill: 'rgba(0,0,0,0.15)',
            cornerRadius: g.tankRx,
        }));

        // 筒体主体（白色，带径向光泽）
        this._tankBody = new Konva.Rect({
            x: g.tankX, y: g.tankY,
            width: g.tankW, height: g.tankH,
            fillLinearGradientStartPoint: { x: g.tankW * 0.5, y: 0 },
            fillLinearGradientEndPoint:   { x: g.tankW * 0.5, y: g.tankH },
            fillLinearGradientColorStops: [
                0,   '#f8f9fa',
                0.12,'#ffffff',
                0.45,'#f0f2f4',
                0.80,'#e2e5e9',
                1,   '#d0d4da',
            ],
            stroke: '#c8cdd4', strokeWidth: 1.5,
            cornerRadius: g.tankRx,
            shadowColor: '#000', shadowBlur: 12,
            shadowOffsetX: 2, shadowOffsetY: 4, shadowOpacity: 0.18,
        });
        this._staticGroup.add(this._tankBody);

        // 顶部高光带（镜面感）
        this._staticGroup.add(new Konva.Rect({
            x: g.tankX + g.tankW * 0.08, y: g.tankY + g.tankH * 0.04,
            width: g.tankW * 0.84, height: g.tankH * 0.22,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: 0, y: g.tankH * 0.22 },
            fillLinearGradientColorStops: [0, 'rgba(255,255,255,0.55)', 1, 'rgba(255,255,255,0)'],
            cornerRadius: [g.tankRx * 0.9, g.tankRx * 0.9, 0, 0],
        }));

        // 加热暖光晕（加热时显示）
        this._heatGlow = new Konva.Rect({
            x: g.tankX, y: g.tankY,
            width: g.tankW, height: g.tankH,
            fill: 'rgba(255,140,40,0)',
            cornerRadius: g.tankRx,
        });
        this._staticGroup.add(this._heatGlow);
    }

    // ── 装饰曲线和圆点 ───────────────────────
    _drawDecoration() {
        const g  = this._geo;
        const W  = g.tankW, cx = g.tankX, cy = g.tankY;
        const mh = g.tankH;

        // S 形装饰波浪曲线（深棕色，参考图）
        const sy = cy + mh * 0.35;
        const swingH = mh * 0.28;
        this._staticGroup.add(new Konva.Path({
            data: [
                `M ${cx + W*0.08} ${sy + swingH*0.5}`,
                `C ${cx + W*0.14} ${sy - swingH*0.6}`,
                `  ${cx + W*0.22} ${sy - swingH*0.8}`,
                `  ${cx + W*0.28} ${sy}`,
                `C ${cx + W*0.34} ${sy + swingH*0.9}`,
                `  ${cx + W*0.38} ${sy + swingH*0.9}`,
                `  ${cx + W*0.42} ${sy + swingH*0.5}`,
            ].join(' '),
            stroke: '#6b3a2a', strokeWidth: 1.8,
            fill: 'transparent', lineCap: 'round', lineJoin: 'round',
            opacity: 0.55,
        }));
        // 曲线下方细线（双线装饰）
        this._staticGroup.add(new Konva.Path({
            data: [
                `M ${cx + W*0.09} ${sy + swingH*0.7}`,
                `C ${cx + W*0.15} ${sy - swingH*0.4}`,
                `  ${cx + W*0.23} ${sy - swingH*0.55}`,
                `  ${cx + W*0.29} ${sy + swingH*0.18}`,
                `C ${cx + W*0.35} ${sy + swingH*1.1}`,
                `  ${cx + W*0.39} ${sy + swingH*1.0}`,
                `  ${cx + W*0.43} ${sy + swingH*0.65}`,
            ].join(' '),
            stroke: '#6b3a2a', strokeWidth: 0.9,
            fill: 'transparent', lineCap: 'round', lineJoin: 'round',
            opacity: 0.30,
        }));

        // 四颗装饰空心圆点
        g.dots.forEach(d => {
            this._staticGroup.add(new Konva.Circle({
                x: d.cx, y: d.cy, radius: d.r,
                fill: 'transparent',
                stroke: '#c8cdd4', strokeWidth: 1.5,
            }));
            // 圆点内小圆（中心小点）
            this._staticGroup.add(new Konva.Circle({
                x: d.cx, y: d.cy, radius: d.r * 0.25,
                fill: '#d0d4da',
            }));
        });

        // 左侧品牌文字（浅灰色，两行）
        this._staticGroup.add(new Konva.Text({
            x: cx + W * 0.05, y: cy + mh * 0.25,
            width: W * 0.30,
            text: 'Advanced Heated Water Dispenser',
            fontSize: 7, fill: '#b0b8c2', italic: true, opacity: 0.8,
        }));
        this._staticGroup.add(new Konva.Text({
            x: cx + W * 0.05, y: cy + mh * 0.38,
            width: W * 0.30,
            text: 'Water Sanitary Heating Co. & Home Solution',
            fontSize: 6.5, fill: '#b0b8c2', italic: true, opacity: 0.7,
        }));
    }

    // ── 底部接管 ─────────────────────────────
    _drawPipes() {
        const g = this._geo;

        // 冷水进管（蓝色）
        this._drawPipe(g.coldPipeX, g.pipeY, g.pipeW, g.pipeH, '#1565c0', '#0d47a1', '冷水\n进口');
        // 热水出管（红色）
        this._drawPipe(g.hotPipeX,  g.pipeY, g.pipeW, g.pipeH, '#c62828', '#b71c1c', '热水\n出口');

        // 管道底部接头螺母（六角形近似）
        [g.coldPipeX, g.hotPipeX].forEach((px, i) => {
            const color = i === 0 ? '#1976d2' : '#e53935';
            const nutY  = g.pipeY + g.pipeH - g.pipeW * 0.3;
            const nutR  = g.pipeW * 0.72;
            // 六角螺母（近似用矩形+旋转）
            this._staticGroup.add(new Konva.RegularPolygon({
                x: px + g.pipeW/2, y: nutY + nutR,
                sides: 6, radius: nutR,
                fill: color,
                stroke: i === 0 ? '#0d47a1' : '#b71c1c',
                strokeWidth: 1,
                rotation: 30,
            }));
        });
    }

    _drawPipe(x, y, pw, ph, fillColor, strokeColor, label) {
        const g = this._geo;
        // 管道主体
        this._staticGroup.add(new Konva.Rect({
            x, y, width: pw, height: ph,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: pw, y: 0 },
            fillLinearGradientColorStops: [
                0, strokeColor, 0.30, fillColor,
                0.60, this._lighten(fillColor, 40), 0.85, fillColor, 1, strokeColor,
            ],
            stroke: strokeColor, strokeWidth: 1,
        }));
        // 高光线
        this._staticGroup.add(new Konva.Line({
            points: [x + pw*0.30, y+2, x + pw*0.30, y+ph-4],
            stroke: 'rgba(255,255,255,0.35)', strokeWidth: 1, lineCap: 'round',
        }));
        // 管道顶部凸缘（连接筒体处）
        this._staticGroup.add(new Konva.Rect({
            x: x - pw*0.25, y: y - 3,
            width: pw * 1.5, height: 6,
            fill: '#e0e4e8', stroke: '#c0c4ca', strokeWidth: 0.8,
            cornerRadius: 2,
        }));
        // 标注
        this._staticGroup.add(new Konva.Text({
            x: x - pw * 0.5, y: y + ph + g.pipeW * 2.2,
            width: pw * 2,
            text: label, fontSize: 7, fill: '#546e7a', align: 'center',
        }));
    }

    _lighten(hex, amt) {
        const n = parseInt(hex.replace('#',''), 16);
        const r = Math.min(255, (n >> 16) + amt);
        const gr= Math.min(255, ((n >> 8) & 0xff) + amt);
        const b = Math.min(255, (n & 0xff) + amt);
        return `rgb(${r},${gr},${b})`;
    }

    // ── 控制面板 ─────────────────────────────
    _drawPanel() {
        const g = this._geo;

        // 面板主体（黑色圆角矩形）
        this._staticGroup.add(new Konva.Rect({
            x: g.panelX, y: g.panelY,
            width: g.panelW, height: g.panelH,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: g.panelW, y: g.panelH },
            fillLinearGradientColorStops: [
                0, '#1a1e24', 0.5, '#22272f', 1, '#181c22',
            ],
            stroke: '#10141a', strokeWidth: 1.5,
            cornerRadius: g.panelRx,
            shadowColor: '#000', shadowBlur: 8, shadowOpacity: 0.5,
        }));
        // 面板顶部高光
        this._staticGroup.add(new Konva.Rect({
            x: g.panelX + 2, y: g.panelY + 2,
            width: g.panelW - 4, height: g.panelH * 0.08,
            fill: 'rgba(255,255,255,0.06)',
            cornerRadius: [g.panelRx, g.panelRx, 0, 0],
        }));
    }

    // ── LCD 温度显示屏 ──────────────────────
    _drawLCD() {
        const g = this._geo;

        // LCD 外框
        this._staticGroup.add(new Konva.Rect({
            x: g.lcdX - 2, y: g.lcdY - 2,
            width: g.lcdW + 4, height: g.lcdH + 4,
            fill: '#0a1520', stroke: '#2a3a4a', strokeWidth: 1,
            cornerRadius: 3,
        }));
        // LCD 屏幕背景
        this._lcdBg = new Konva.Rect({
            x: g.lcdX, y: g.lcdY,
            width: g.lcdW, height: g.lcdH,
            fill: '#0d2535',
            cornerRadius: 2,
        });
        this._staticGroup.add(this._lcdBg);

        // 温度数字（大字体）
        this._lcdTempText = new Konva.Text({
            x: g.lcdX + 2, y: g.lcdY + g.lcdH * 0.08,
            width: g.lcdW * 0.72,
            text: this._powered ? Math.round(this._curTemp).toString() : '--',
            fontSize: g.lcdH * 0.58,
            fontFamily: 'Courier New, monospace',
            fontStyle: 'bold',
            fill: this._powered ? '#00e5cc' : '#1a3a3a',
            align: 'right',
        });
        this._staticGroup.add(this._lcdTempText);

        // °C 单位
        this._lcdUnitText = new Konva.Text({
            x: g.lcdX + g.lcdW * 0.73, y: g.lcdY + g.lcdH * 0.08,
            width: g.lcdW * 0.27,
            text: '°C',
            fontSize: g.lcdH * 0.28,
            fontFamily: 'Arial',
            fill: this._powered ? '#00c4ae' : '#1a3a3a',
            align: 'left',
        });
        this._staticGroup.add(this._lcdUnitText);

        // 设定温度小字（下方）
        this._lcdSetText = new Konva.Text({
            x: g.lcdX + 2, y: g.lcdY + g.lcdH * 0.68,
            width: g.lcdW - 4,
            text: this._powered ? `设定:${Math.round(this._setTemp)}°C` : '',
            fontSize: g.lcdH * 0.22,
            fontFamily: 'Arial',
            fill: '#00a090',
            align: 'center',
        });
        this._staticGroup.add(this._lcdSetText);

        // LCD 反光（高光条）
        this._staticGroup.add(new Konva.Rect({
            x: g.lcdX + 2, y: g.lcdY + 2,
            width: g.lcdW * 0.40, height: g.lcdH * 0.28,
            fill: 'rgba(255,255,255,0.04)',
            cornerRadius: 1,
        }));
    }

    _updateLCD() {
        if (!this._lcdTempText) return;
        const on = this._powered;
        this._lcdBg.fill(on ? '#0d2535' : '#080e15');
        this._lcdTempText.text(on ? Math.round(this._curTemp).toString() : '--');
        this._lcdTempText.fill(on ? '#00e5cc' : '#1a3a3a');
        this._lcdUnitText.fill(on ? '#00c4ae' : '#1a3a3a');
        this._lcdSetText.text(on ? `设定:${Math.round(this._setTemp)}°C` : '');
    }

    // ── 调温旋钮 ─────────────────────────────
    _drawKnob() {
        const g  = this._geo;
        const cx = g.knobCX, cy = g.knobCY, r = g.knobR;

        // 旋钮外环刻度盘
        this._knobRing = new Konva.Circle({
            x: cx, y: cy, radius: r,
            fillRadialGradientStartPoint:  { x: 0, y: 0 },
            fillRadialGradientStartRadius: 0,
            fillRadialGradientEndPoint:    { x: 0, y: 0 },
            fillRadialGradientEndRadius:   r,
            fillRadialGradientColorStops:  [0, '#3a4050', 0.65, '#282e38', 1, '#1a1e26'],
            stroke: '#485060', strokeWidth: 1.5,
            shadowColor: '#000', shadowBlur: 8, shadowOpacity: 0.6,
        });
        this._staticGroup.add(this._knobRing);

        // 刻度线（24 格，约 5°C 一格）
        const tickCount = 24;
        for (let i = 0; i < tickCount; i++) {
            const ang  = ((i / tickCount) * 360 - 120) * Math.PI / 180;
            const long = i % 6 === 0;
            const r1   = r * (long ? 0.72 : 0.80);
            const r2   = r * 0.92;
            this._staticGroup.add(new Konva.Line({
                points: [
                    cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1,
                    cx + Math.cos(ang) * r2, cy + Math.sin(ang) * r2,
                ],
                stroke: long ? '#a0a8b8' : '#606878', strokeWidth: long ? 1.2 : 0.7,
            }));
        }

        // 旋钮本体（可旋转组）
        this._knobGroup = new Konva.Group({ x: cx, y: cy, rotation: this._knobAngle });

        // 旋钮本体圆
        this._knobGroup.add(new Konva.Circle({
            radius: r * 0.70,
            fillRadialGradientStartPoint:  { x: -r*0.15, y: -r*0.15 },
            fillRadialGradientStartRadius: 0,
            fillRadialGradientEndPoint:    { x: 0, y: 0 },
            fillRadialGradientEndRadius:   r * 0.70,
            fillRadialGradientColorStops:  [0, '#5a6070', 0.5, '#3a4050', 1, '#282e3a'],
            stroke: '#606878', strokeWidth: 1,
        }));
        // 旋钮指示线（12 点钟位置，随旋转）
        this._knobGroup.add(new Konva.Line({
            points: [0, -r * 0.65, 0, -r * 0.30],
            stroke: '#e0e4ec', strokeWidth: 2.2, lineCap: 'round',
        }));
        // 旋钮中心圆点
        this._knobGroup.add(new Konva.Circle({
            radius: r * 0.14,
            fill: '#8090a0', stroke: '#a0b0c0', strokeWidth: 0.8,
        }));

        this._staticGroup.add(this._knobGroup);

        // ── 旋钮拖拽交互 ──
        this._knobGroup.draggable(false);
        this._knobGroup.on('mousedown touchstart', (e) => {
            this._dragging = true;
            const pos = e.target.getStage().getPointerPosition();
            this._dragStartAngle = Math.atan2(pos.y - cy, pos.x - cx) * 180 / Math.PI;
            this._dragStartKnob  = this._knobAngle;
            e.cancelBubble = true;
        });
        this.group.getStage?.()?.on('mousemove touchmove', (e) => {
            if (!this._dragging) return;
            const stage = this._knobGroup.getStage();
            if (!stage) return;
            const pos   = stage.getPointerPosition();
            if (!pos) return;
            const curAng = Math.atan2(pos.y - cy, pos.x - cx) * 180 / Math.PI;
            let delta    = curAng - this._dragStartAngle;
            // 处理 ±180° 跳变
            if (delta > 180)  delta -= 360;
            if (delta < -180) delta += 360;
            this._knobAngle = this._dragStartKnob + delta;
            // 映射到温度
            const newTemp = this._angleToTemp(this._knobAngle);
            this._setTemp = Math.max(this._minTemp, Math.min(this._maxTemp, newTemp));
            this._knobGroup.rotation(this._knobAngle);
            this._updateLCD();
            this._refreshCache();
        });
        this.group.getStage?.()?.on('mouseup touchend', () => {
            this._dragging = false;
        });

        // 旋钮下方温度标注
        this._staticGroup.add(new Konva.Text({
            x: cx - r, y: cy + r * 1.15,
            width: r * 2,
            text: `${this._minTemp}~${this._maxTemp}°C`,
            fontSize: g.panelH * 0.065,
            fill: '#607080', align: 'center',
        }));
    }

    _tempToAngle(temp) {
        // 35°C → -150°, 75°C → +150° (总行程 300°)
        const ratio = (temp - this._minTemp) / (this._maxTemp - this._minTemp);
        return -150 + ratio * 300;
    }

    _angleToTemp(angle) {
        // 夹入 -150~+150 范围
        let a = ((angle % 360) + 360) % 360;
        if (a > 180) a -= 360;
        a = Math.max(-150, Math.min(150, a));
        return this._minTemp + ((a + 150) / 300) * (this._maxTemp - this._minTemp);
    }

    // ── 电源按钮 ─────────────────────────────
    _drawPowerButton() {
        const g  = this._geo;
        const cx = g.pwrBtnX, cy = g.pwrBtnY, r = g.pwrBtnR;

        // 外环
        this._pwrOuter = new Konva.Circle({
            x: cx, y: cy, radius: r * 1.35,
            fill: '#181c22',
            stroke: this._powered ? '#ef5350' : '#404858',
            strokeWidth: 1.2,
            shadowColor: this._powered ? '#ef5350' : 'transparent',
            shadowBlur:  this._powered ? 8 : 0,
            shadowOpacity: 0.7,
        });
        // 按钮本体
        this._pwrBtn = new Konva.Circle({
            x: cx, y: cy, radius: r,
            fillRadialGradientStartPoint:  { x: 0, y: -r*0.3 },
            fillRadialGradientStartRadius: 0,
            fillRadialGradientEndPoint:    { x: 0, y: 0 },
            fillRadialGradientEndRadius:   r,
            fillRadialGradientColorStops:  this._powered
                ? [0, '#ff6b6b', 0.5, '#ef5350', 1, '#c62828']
                : [0, '#484e5c', 0.5, '#363c48', 1, '#282e38'],
            stroke: this._powered ? '#ff1744' : '#303640',
            strokeWidth: 1,
        });
        // 电源图标（圆圈+竖线）
        this._pwrIcon = new Konva.Path({
            x: cx, y: cy,
            data: `M 0 ${-r*0.55} L 0 ${-r*0.12}
                   M ${-r*0.42} ${-r*0.35}
                   A ${r*0.48} ${r*0.48} 0 1 1 ${r*0.42} ${-r*0.35}`,
            stroke: this._powered ? '#fff' : '#707880',
            strokeWidth: 1.4, lineCap: 'round',
            fill: 'transparent',
        });

        this._staticGroup.add(this._pwrOuter, this._pwrBtn, this._pwrIcon);

        // 标注
        this._staticGroup.add(new Konva.Text({
            x: cx - r*2, y: cy + r * 1.55,
            width: r * 4,
            text: '电源', fontSize: g.panelH * 0.065,
            fill: '#607080', align: 'center',
        }));

        // 点击交互
        this._pwrBtn.on('click tap', () => this._togglePower());
        this._pwrBtn.listening(true);
        this._pwrOuter.on('click tap', () => this._togglePower());
        this._pwrOuter.listening(true);
    }

    _updatePowerButton() {
        const on = this._powered;
        this._pwrOuter.stroke(on ? '#ef5350' : '#404858');
        this._pwrOuter.shadowColor(on ? '#ef5350' : 'transparent');
        this._pwrOuter.shadowBlur(on ? 8 : 0);
        this._pwrBtn.fillRadialGradientColorStops(
            on ? [0, '#ff6b6b', 0.5, '#ef5350', 1, '#c62828']
               : [0, '#484e5c', 0.5, '#363c48', 1, '#282e38']
        );
        this._pwrBtn.stroke(on ? '#ff1744' : '#303640');
        this._pwrIcon.stroke(on ? '#fff' : '#707880');
    }

    _togglePower() {
        this._powered = !this._powered;
        this._updatePowerButton();
        this._updateLCD();
        this._updateLEDs();
        this._refreshCache();
    }

    // ── 指示灯 ────────────────────────────────
    _drawIndicatorLEDs() {
        const g = this._geo;

        // 电源指示灯（红）
        this._led1 = new Konva.Circle({
            x: g.led1CX, y: g.led1CY, radius: g.ledR,
            fill: this._powered ? '#ef5350' : '#2a1818',
            stroke: '#ef5350', strokeWidth: 0.8,
            shadowColor: '#ef5350',
            shadowBlur: this._powered ? 7 : 0,
            shadowOpacity: 0.8,
        });
        this._staticGroup.add(this._led1);
        this._staticGroup.add(new Konva.Text({
            x: g.led1CX - g.ledR * 3, y: g.led1CY + g.ledR * 1.4,
            width: g.ledR * 6, text: '通电',
            fontSize: g.panelH * 0.062, fill: '#607080', align: 'center',
        }));

        // 加热指示灯（橙）
        this._led2 = new Konva.Circle({
            x: g.led2CX, y: g.led2CY, radius: g.ledR,
            fill: '#1c1208',
            stroke: '#fb8c00', strokeWidth: 0.8,
            shadowColor: '#fb8c00',
            shadowBlur: 0,
            shadowOpacity: 0.8,
        });
        this._staticGroup.add(this._led2);
        this._staticGroup.add(new Konva.Text({
            x: g.led2CX - g.ledR * 3, y: g.led2CY + g.ledR * 1.4,
            width: g.ledR * 6, text: '加热',
            fontSize: g.panelH * 0.062, fill: '#607080', align: 'center',
        }));
    }

    _updateLEDs() {
        const on      = this._powered;
        const heating = on && this._curTemp < this._setTemp - 0.5;

        this._led1.fill(on ? '#ef5350' : '#2a1818');
        this._led1.shadowBlur(on ? 7 : 0);

        // 加热灯由 _tickSim 控制闪烁
        if (!heating) {
            this._led2.fill('#1c1208');
            this._led2.shadowBlur(0);
        }
    }

    // ── 能效标签 ─────────────────────────────
    _drawEnergyLabel() {
        const g = this._geo;
        const x = g.labelX, y = g.labelY;
        const w = g.labelW, h = g.labelH;

        // 贴纸外框
        this._staticGroup.add(new Konva.Rect({
            x, y, width: w, height: h,
            fill: '#f5f5f5', stroke: '#9e9e9e', strokeWidth: 0.8,
            cornerRadius: 2,
            shadowColor: '#000', shadowBlur: 3, shadowOpacity: 0.2,
        }));
        // 顶部蓝色标题
        this._staticGroup.add(new Konva.Rect({
            x, y, width: w, height: h * 0.22,
            fill: '#1565c0', cornerRadius: [2, 2, 0, 0],
        }));
        this._staticGroup.add(new Konva.Text({
            x, y: y + h * 0.04, width: w,
            text: '能效', fontSize: w * 0.28, fontStyle: 'bold',
            fill: '#fff', align: 'center',
        }));
        // 能效条（5条，彩色）
        const barColors = ['#c62828','#ef6c00','#f9a825','#558b2f','#1565c0'];
        const barH = h * 0.11;
        barColors.forEach((c, i) => {
            this._staticGroup.add(new Konva.Rect({
                x: x + w * 0.10, y: y + h * 0.24 + i * barH * 1.1,
                width: w * (0.90 - i * 0.12), height: barH,
                fill: c, cornerRadius: 1,
            }));
        });
        // 等级文字
        this._staticGroup.add(new Konva.Text({
            x, y: y + h * 0.82, width: w,
            text: '一级', fontSize: w * 0.24, fontStyle: 'bold',
            fill: '#1565c0', align: 'center',
        }));
    }

    // ── 铭牌标注 ─────────────────────────────
    _drawNameLabel() {
        const W = this.width;
        this._staticGroup.add(new Konva.Text({
            x: 0, y: -18, width: W,
            text: `${this.label}  储水式电热水器  ${this.ratedVoltage}V  ${this.ratedPower}W  ${this.capacity}L`,
            fontSize: 9, fontStyle: 'bold', fill: '#546e7a', align: 'center',
        }));

        // 端子标注
        const g = this._geo;
        this._staticGroup.add(new Konva.Text({
            x: g.coldPipeX - g.pipeW, y: g.pipePortY + 2,
            text: 'CW', fontSize: 7.5, fontStyle: 'bold', fill: '#90caf9',
        }));
        this._staticGroup.add(new Konva.Text({
            x: g.hotPipeX - g.pipeW, y: g.pipePortY + 2,
            text: 'HW', fontSize: 7.5, fontStyle: 'bold', fill: '#ef9a9a',
        }));
        this._staticGroup.add(new Konva.Text({
            x: g.powerPortX - 10, y: this.height - 12,
            text: 'AC', fontSize: 7.5, fontStyle: 'bold', fill: '#a5d6a7',
        }));
    }

    // ═══════════════════════════════════════════
    // 主仿真循环
    // 集中化 tick（由 consys._tickAll 在 20fps 调用）
    tick(dt) {
        this._tickSim(dt);
    
        this._refreshCache();
    }
    _tickSim(dt) {
        const heating = this._powered && this._curTemp < this._setTemp - 0.3;
        const cooling = !this._powered && this._curTemp > 20;

        if (heating) {
            // 加热速率（仿真加速：2°C/s）
            this._curTemp = Math.min(this._setTemp, this._curTemp + 2.0 * dt);
        } else if (cooling) {
            this._curTemp = Math.max(20, this._curTemp - 0.08 * dt);
        }

        // 加热指示灯闪烁
        if (heating) {
            this._blinkT += dt;
            if (this._blinkT >= 0.8) this._blinkT -= 0.8;
            this._blinkOn = this._blinkT < 0.4;
            this._led2.fill(this._blinkOn ? '#fb8c00' : '#1c1208');
            this._led2.shadowBlur(this._blinkOn ? 8 : 0);
        } else {
            this._led2.fill('#1c1208');
            this._led2.shadowBlur(0);
        }

        // 加热暖光晕
        const glowAlpha = heating ? Math.min(0.06, (this._setTemp - this._curTemp) / 200) : 0;
        this._heatGlow.fill(`rgba(255,140,40,${glowAlpha.toFixed(4)})`);

        // LCD 更新（约每 0.5s 刷新一次以减少重绘）
        this._lcdRefreshAcc = (this._lcdRefreshAcc || 0) + dt;
        if (this._lcdRefreshAcc >= 0.5) {
            this._lcdRefreshAcc = 0;
            this._updateLCD();
        }

        this._refreshCache();
    }

    // ═══════════════════════════════════════════
    // 公开 API

    /** 开机 */
    powerOn()  {
        this._powered = true;
        this._updatePowerButton(); this._updateLCD(); this._updateLEDs();
    }

    /** 关机 */
    powerOff() {
        this._powered = false;
        this._updatePowerButton(); this._updateLCD(); this._updateLEDs();
    }

    /** 设定温度（35~75°C） */
    setTargetTemp(temp) {
        this._setTemp   = Math.max(this._minTemp, Math.min(this._maxTemp, temp));
        this._knobAngle = this._tempToAngle(this._setTemp);
        if (this._knobGroup) this._knobGroup.rotation(this._knobAngle);
        this._updateLCD();
    }

    isPowered()     { return this._powered; }
    getCurrentTemp(){ return this._curTemp; }
    getSetTemp()    { return this._setTemp; }
    isHeating()     { return this._powered && this._curTemp < this._setTemp - 0.3; }

    update(state) {
        if (typeof state === 'boolean') {
            state ? this.powerOn() : this.powerOff();
        } else if (typeof state === 'number') {
            this.setTargetTemp(state);
        }
        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label: '位号/名称',         key: 'label',         type: 'text'   },
            { label: '额定电压 (V)',       key: 'ratedVoltage',  type: 'number' },
            { label: '额定功率 (W)',       key: 'ratedPower',    type: 'number' },
            { label: '容量 (L)',           key: 'capacity',      type: 'number' },
            { label: '初始开机 (1=开)',    key: 'initPowered',   type: 'number' },
            { label: '初始设定温度 (°C)',  key: 'initSetTemp',   type: 'number' },
            { label: '初始当前水温 (°C)',  key: 'initCurTemp',   type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label)        this.label        = cfg.label;
        if (cfg.ratedVoltage) this.ratedVoltage = parseFloat(cfg.ratedVoltage);
        if (cfg.ratedPower)   this.ratedPower   = parseFloat(cfg.ratedPower);
        if (cfg.capacity)     this.capacity     = parseFloat(cfg.capacity);
        if (cfg.initSetTemp)  this.setTargetTemp(parseFloat(cfg.initSetTemp));
        if (cfg.initCurTemp)  this._curTemp     = parseFloat(cfg.initCurTemp);
        if (cfg.initPowered !== undefined) {
            parseInt(cfg.initPowered) ? this.powerOn() : this.powerOff();
        }
        this.config = { ...this.config, ...cfg };
        this._refreshCache();
    }

    destroy() {
        super.destroy?.();
    }
}