import { BaseComponent } from './BaseComponent.js';

/**
 * Alfa Laval ENGARD 中央冷却水温度控制器 面板仿真组件
 * （Alfa Laval ENGARD Central Cooling Water Temperature Controller）
 *
 * ── 面板布局（参照实物图片）──────────────────────────────────────
 *
 *  面板底色：青蓝色（#3a8fa0 系）
 *  品牌标识：左上角 "Alfa Laval" Logo
 *
 *  ┌─────────────────────────────────────────────────────────────┐
 *  │  [Alfa Laval Logo]                                          │
 *  │                                                             │
 *  │  ┌──────────────────────────────────┐  ❄ %  🌡 °C         │  [8]旋钮
 *  │  │  冷却水回路流程图（上）          │                      │  [9]旋钮
 *  │  │  路线1: □─▷────────────────── TT│  [红×8]  [LED显示]  │  [10]旋钮
 *  │  │  路线2: □─▷──────── TT──[三通阀]│  [绿×6]             │  [15]旋钮
 *  │  │  路线3: □─▷─□──────── [调节阀] │                      │
 *  │  └──────────────────────────────────┘  ● 绿(运行)         │
 *  │                                         ● 棕(待机)         │
 *  │  [大旋钮]                               ● 棕(故障)         │
 *  │   (绿色)                                ● 橙(警告)   [控制条]
 *  │                                         ● 红(报警)   图标按钮
 *  │  ┌──────────────────────────────────┐                      │
 *  │  │  泵组流程图（下）                │                      │
 *  │  │  S1─P1─S2─P2─S3─S4─P3          │                      │
 *  │  │              %BYPASS─[调节阀]   │                      │
 *  │  └──────────────────────────────────┘                      │
 *  └─────────────────────────────────────────────────────────────┘
 *
 * ── 标注对应（图片中的数字编号）─────────────────────────────────
 *  1  — 冷却回路图：路线1（Loop 1）
 *  2  — 冷却回路图：路线2（Loop 2）
 *  3  — 泵流程图区域
 *  4  — 泵流程图：P1~P3 泵组
 *  5  — TT 温度变送器（回路侧）
 *  6  — TT 温度变送器（三通阀前）
 *  7  — 三通温控阀（Three-Way Control Valve）
 *  8  — 旋钮1（右上，功能调节）
 *  9  — 旋钮2
 *  10 — 旋钮3
 *  11 — LED 数字显示屏列1（°C/% 选择）
 *  12 — LED 数字显示屏列2
 *  13 — LED 数字显示屏列3
 *  14 — 右侧状态指示灯列
 *  15 — 旋钮4（右下）
 *
 * ── 仿真逻辑 ─────────────────────────────────────────────────────
 *  • LED 显示屏：显示温度（°C）或流量（%），按模式切换
 *  • 8个红色报警灯：对应各路超温/故障/压差/流量低等报警
 *  • 6个绿色状态灯：对应各路运行状态
 *  • 右侧4个状态灯：系统运行/待机/警告/报警
 *  • 三通阀仿真：根据 PID 输出驱动阀位
 *  • 泵组仿真：P1~P3 轮换启停
 *
 * ── 端口 ─────────────────────────────────────────────────────────
 *  port_tt_in     — TT 温度输入（来自冷却水出口温度变送器）
 *  port_ctrl_valve — 三通调节阀控制输出（4~20mA）
 *  port_bypass     — 旁通调节阀控制输出
 *  port_pump_cmd   — 泵组启停指令
 *  port_alarm_out  — 报警继电器输出
 */
export class EngardCoolingController extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        // ── 面板尺寸（参照图片比例 约 5:3）──
        this.width  = Math.max(560, config.width  || 680);
        this.height = Math.max(330, config.height || 410);

        this.type    = 'engard_cooling_ctrl';
        this.special = 'none';
        this.cache   = 'fixed';

        // ── 铭牌 ──
        this.label = config.label || 'ENGARD';
        this.model = config.model || 'CW-TEMP-CTRL';

        // ── 温度量程 ──
        this.rangeMin = config.rangeMin !== undefined ? config.rangeMin : 0;
        this.rangeMax = config.rangeMax !== undefined ? config.rangeMax : 80;

        // ── 设定值 ──
        this._sp      = config.initSP !== undefined ? config.initSP : 36;
        this._pv      = config.initPV !== undefined ? config.initPV : 41;  // 图片显示 41

        // ── PID ──
        this._Kp = config.Kp || 2.5;
        this._Ti = config.Ti || 25;
        this._Td = config.Td || 3;
        this._integral  = 0;
        this._prevError = 0;

        // ── 控制输出 ──
        this._valvePos    = 0;    // 0~100% 三通阀开度
        this._bypassPos   = 0;    // 0~100% 旁通阀开度
        this._ctrlOutput  = 0;

        // ── 过程惯性 ──
        this._tau    = 35;        // s
        this._pvTgt  = this._pv;

        // ── 泵组状态（P1/P2/P3）──
        this._pumps  = [true, false, false]; // P1运行，P2/P3备用

        // ── 报警（8个红灯）──
        // [0]回路1超温, [1]回路2超温, [2]回路3超温,
        // [3]温控阀故障, [4]流量低, [5]压差高, [6]泵故障, [7]系统报警
        this._alarms  = [false, false, false, false, false, false, false, false];

        // ── 状态（6个绿灯）──
        // [0]回路1运行, [1]回路2运行, [2]回路1阀开, [3]回路2阀开,
        // [4]回路3运行, [5]系统正常
        this._status  = [true, true, false, false, true, true];

        // ── 右侧4灯（系统级）──
        // 运行(绿)/待机(棕)/警告(棕)/报警(红)
        this._sysLeds = [true, false, false, false];

        // ── 显示模式 ──
        this._dispMode = 'temp'; // 'temp' | 'pct'
        this._displayVal = this._pv;

        // ── 仿真时钟 ──
        this._noiseAmp = 0.06;
        this._blinkPhase = 0;

        this._computeLayout();
        this._init();
        this._addPorts();
    }

    // ═══════════════════════════════════════════
    _computeLayout() {
        const W = this.width, H = this.height;

        // 面板内边距
        this._pad = { t: H * 0.06, l: W * 0.02, r: W * 0.02, b: H * 0.04 };

        // Logo 区域
        this._logoH = H * 0.12;

        // 主内容区 Y 起点
        const contentY = this._pad.t + this._logoH;
        const contentH = H - contentY - this._pad.b;

        // 左侧旋钮区
        this._bigKnobR  = Math.min(W, H) * 0.072;
        this._bigKnobCX = W * 0.115;
        this._bigKnobCY = contentY + contentH * 0.52;

        // 上方流程图区域（冷却回路）
        this._topDiagX  = W * 0.195;
        this._topDiagY  = contentY;
        this._topDiagW  = W * 0.535;
        this._topDiagH  = contentH * 0.42;

        // LED指示灯行（红色 + 绿色）
        this._ledRowY   = contentY + contentH * 0.44;
        this._ledRowH   = contentH * 0.18;
        this._ledStartX = W * 0.210;
        this._ledSpacX  = W * 0.058;
        this._ledCount  = 8;  // 每行

        // 下方流程图（泵组）
        this._btmDiagX  = W * 0.195;
        this._btmDiagY  = contentY + contentH * 0.63;
        this._btmDiagW  = W * 0.535;
        this._btmDiagH  = contentH * 0.36;

        // 中间信息区（雪花/温度图标 + LED显示）
        this._infoX     = W * 0.735;
        this._infoY     = contentY;
        this._infoW     = W * 0.115;
        this._infoH     = contentH;

        // 右侧控制条
        this._ctrlStripX = W * 0.852;
        this._ctrlStripY = contentY;
        this._ctrlStripW = W * 0.078;
        this._ctrlStripH = contentH;

        // 最右侧4个旋钮
        this._knobsX    = W * 0.930;
        this._knobsR    = Math.min(W, H) * 0.048;
        this._knobsStartY = contentY + contentH * 0.05;
        this._knobsSpacY  = contentH * 0.245;

        // LED大显示屏
        this._bigDispX  = W * 0.735;
        this._bigDispY  = contentY + contentH * 0.38;
        this._bigDispW  = W * 0.200;
        this._bigDispH  = contentH * 0.22;
    }

    // ── 全量初始化 ────────────────────────────
    _init() {
        this._drawPanelBody();
        this._drawLogo();
        this._drawTopDiagram();
        this._drawBigKnob();
        this._drawRedLEDRow();
        this._drawGreenLEDRow();
        this._drawBtmDiagram();
        this._drawInfoIcons();
        this._drawBigDisplay();
        this._drawSysLEDs();
        this._drawCtrlStrip();
        this._drawRightKnobs();
        
    }

    // ── 面板主体 ─────────────────────────────
    _drawPanelBody() {
        const W = this.width, H = this.height;

        // 外框阴影
        this.group.add(new Konva.Rect({
            x: 3, y: 3, width: W, height: H,
            fill: 'rgba(0,0,0,0.4)', cornerRadius: 6,
        }));

        // 面板主体（青蓝色，与图片一致）
        this.group.add(new Konva.Rect({
            x: 0, y: 0, width: W, height: H,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: W, y: H },
            fillLinearGradientColorStops: [
                0,   '#3d9db0',
                0.4, '#3592a5',
                0.8, '#2e8595',
                1,   '#276878',
            ],
            stroke: '#1a5060', strokeWidth: 2,
            cornerRadius: 5,
        }));

        // 面板顶部高光
        this.group.add(new Konva.Rect({
            x: 1, y: 1, width: W - 2, height: H * 0.03,
            fill: 'rgba(255,255,255,0.12)', cornerRadius: [5, 5, 0, 0],
        }));
    }

    // ── Alfa Laval Logo 区 ───────────────────
    _drawLogo() {
        const W = this.width;
        const ly = this._pad.t;

        // Logo 背景（轻微白色区域）
        this.group.add(new Konva.Rect({
            x: W * 0.02, y: ly - 2, width: W * 0.28, height: this._logoH - 2,
            fill: 'rgba(255,255,255,0.08)', cornerRadius: 3,
        }));

        // Alfa Laval 符号（简化三角形 logo）
        const lx = W * 0.04;
        const ly2 = ly + this._logoH * 0.2;
        const lsize = this._logoH * 0.55;

        // Logo 图形（两个三角形）
        this.group.add(new Konva.Line({
            points: [lx, ly2 + lsize, lx + lsize * 0.55, ly2, lx + lsize, ly2 + lsize],
            closed: false, stroke: '#f0f0f0', strokeWidth: 2.5, lineCap: 'round', lineJoin: 'round',
        }));
        this.group.add(new Konva.Line({
            points: [lx + lsize * 0.18, ly2 + lsize * 0.58, lx + lsize * 0.55, ly2, lx + lsize * 0.82, ly2 + lsize * 0.58],
            closed: false, stroke: '#f0f0f0', strokeWidth: 1.5, lineCap: 'round',
        }));

        // "Alfa Laval" 文字
        this.group.add(new Konva.Text({
            x: lx + lsize * 1.2, y: ly + this._logoH * 0.22,
            text: 'Alfa Laval',
            fontSize: this._logoH * 0.45, fontStyle: 'bold',
            fontFamily: 'Georgia, serif',
            fill: '#f0f0f0',
        }));

        // 子标题
        this.group.add(new Konva.Text({
            x: W * 0.02, y: ly + this._logoH * 0.72,
            text: 'ENGARD  Central Cooling Water Temperature Controller',
            fontSize: this._logoH * 0.24,
            fontFamily: 'Arial, sans-serif',
            fill: 'rgba(220,240,245,0.75)',
        }));
    }

    // ── 上方冷却回路流程图 ───────────────────
    _drawTopDiagram() {
        const dx = this._topDiagX, dy = this._topDiagY;
        const dw = this._topDiagW, dh = this._topDiagH;

        // 背景（浅青色面板）
        this.group.add(new Konva.Rect({
            x: dx, y: dy, width: dw, height: dh,
            fill: '#c8e8f0', stroke: '#a0c8d8', strokeWidth: 1,
            cornerRadius: 3,
        }));

        // ── 三条回路线 ──
        const lineColor   = '#1a3040';
        const lineW       = 1.2;
        const leftX       = dx + dw * 0.04;
        const rightX      = dx + dw * 0.82;
        const y1 = dy + dh * 0.20;
        const y2 = dy + dh * 0.50;
        const y3 = dy + dh * 0.78;

        // 左侧竖向汇流管（带网格纹）
        this.group.add(new Konva.Rect({
            x: leftX - 5, y: y1 - 5, width: 10, height: y3 - y1 + 10,
            fill: '#7ab0c0', stroke: '#4a8090', strokeWidth: 1,
        }));

        // 右侧出口竖向汇流管
        this.group.add(new Konva.Rect({
            x: rightX - 5, y: y1 - 5, width: 10, height: y3 - y1 + 10,
            fill: '#7ab0c0', stroke: '#4a8090', strokeWidth: 1,
        }));

        // 三条横向回路线 + 元件
        [y1, y2, y3].forEach((ry, i) => {
            // 主管线
            this.group.add(new Konva.Line({
                points: [leftX, ry, rightX, ry],
                stroke: lineColor, strokeWidth: lineW,
            }));

            // 回路编号标签
            const lblX = dx + dw * 0.015;
            this.group.add(new Konva.Rect({
                x: lblX, y: ry - 7, width: 14, height: 13,
                fill: '#d0e8f0', stroke: '#8ab8c8', strokeWidth: 0.8, cornerRadius: 1,
            }));
            this.group.add(new Konva.Text({
                x: lblX + 1, y: ry - 5, text: `${i + 1}`,
                fontSize: 8, fontFamily: 'Arial', fill: '#1a3040',
            }));

            // 流量调节阀符号（▷）
            const valveX = leftX + dw * 0.08;
            this._drawFlowValve(valveX, ry);

            // 路线3额外有一个中间隔离阀
            if (i === 2) {
                this._drawFlowValve(leftX + dw * 0.18, ry);
            }
        });

        // TT 温度变送器1（回路侧，编号5）
        const tt1x = dx + dw * 0.64, tt1y = dy + dh * 0.15;
        this._drawTT(tt1x, tt1y, 'TT');
        this.group.add(new Konva.Line({
            points: [tt1x, tt1y + 10, tt1x, y1],
            stroke: lineColor, strokeWidth: 0.8, dash: [2, 2],
        }));

        // TT 温度变送器2（三通阀前，编号6）
        const tt2x = dx + dw * 0.52, tt2y = dy + dh * 0.42;
        this._drawTT(tt2x, tt2y, 'TT');

        // 三通温控阀（编号7）
        const tvx = dx + dw * 0.68, tvy = dy + dh * 0.35;
        this._drawThreeWayValve(tvx, tvy, dh * 0.30);

        // 三通阀连接线
        this.group.add(new Konva.Line({
            points: [tvx - dw * 0.16, y2, tvx - 8, tvy + dh * 0.12],
            stroke: lineColor, strokeWidth: lineW,
        }));
        this.group.add(new Konva.Line({
            points: [tvx + 8, tvy + dh * 0.12, rightX, y2],
            stroke: lineColor, strokeWidth: lineW,
        }));
        this.group.add(new Konva.Line({
            points: [tvx, tvy - 4, tvx, y1],
            stroke: lineColor, strokeWidth: lineW,
        }));

        // 热交换器符号（右下）
        this._drawHeatExchanger(dx + dw * 0.82, dy + dh * 0.60, dw * 0.10, dh * 0.28);

        // 标注 "↕↕↑" 振动/流量图标
        this.group.add(new Konva.Text({
            x: dx + dw * 0.86, y: dy + dh * 0.60,
            text: '↕↕↑', fontSize: 10, fill: '#1a3040',
        }));
    }

    // ── 流量阀符号（三角形）─────────────────
    _drawFlowValve(cx, cy) {
        const r = 6;
        this.group.add(new Konva.Line({
            points: [cx - r, cy - r * 0.6, cx + r, cy, cx - r, cy + r * 0.6, cx - r, cy - r * 0.6],
            closed: true, fill: 'rgba(80,140,160,0.5)', stroke: '#1a3040', strokeWidth: 0.8,
        }));
    }

    // ── TT 温度变送器符号 ─────────────────────
    _drawTT(cx, cy, label) {
        this.group.add(new Konva.Circle({
            x: cx, y: cy, radius: 10,
            fill: '#d0e8f0', stroke: '#1a3040', strokeWidth: 0.9,
        }));
        this.group.add(new Konva.Text({
            x: cx - 8, y: cy - 5, text: label,
            fontSize: 7, fontStyle: 'bold', fill: '#1a3040', fontFamily: 'Arial',
        }));
    }

    // ── 三通温控阀（三角形组合）─────────────
    _drawThreeWayValve(cx, cy, size) {
        const s = size * 0.35;
        // 上三角
        this.group.add(new Konva.Line({
            points: [cx - s, cy - s * 0.4, cx + s, cy - s * 0.4, cx, cy + s * 0.4],
            closed: true, fill: '#b8d8e8', stroke: '#1a3040', strokeWidth: 0.9,
        }));
        // 下三角（镜像）
        this.group.add(new Konva.Line({
            points: [cx - s, cy + s * 0.4, cx + s, cy + s * 0.4, cx, cy - s * 0.4],
            closed: true, fill: '#d8eef8', stroke: '#1a3040', strokeWidth: 0.9,
        }));
        // 调节阀手柄
        this.group.add(new Konva.Line({
            points: [cx, cy - s * 0.4, cx, cy - s],
            stroke: '#1a3040', strokeWidth: 1.5, lineCap: 'round',
        }));

        // 动态阀位指针（绑定 _valvePos）
        this._valveArrow = new Konva.Line({
            points: [cx - s * 0.4, cy - s * 0.6, cx + s * 0.4, cy - s * 0.6],
            stroke: '#e04010', strokeWidth: 1.5, lineCap: 'round',
        });
        this.group.add(this._valveArrow);

        // 标注
        this.group.add(new Konva.Text({
            x: cx - 10, y: cy + s * 0.5,
            text: 'TCV', fontSize: 7, fill: '#1a3040',
        }));

        this._tvCX = cx; this._tvCY = cy; this._tvS = s;
    }

    // ── 热交换器符号 ─────────────────────────
    _drawHeatExchanger(x, y, w, h) {
        this.group.add(new Konva.Rect({
            x, y, width: w, height: h,
            fill: '#b0d0e0', stroke: '#1a3040', strokeWidth: 0.9, cornerRadius: 2,
        }));
        // 内部波浪线
        for (let i = 0; i < 3; i++) {
            const ly2 = y + h * (0.25 + i * 0.25);
            this.group.add(new Konva.Line({
                points: [x + 2, ly2, x + w * 0.4, ly2 - h * 0.06, x + w * 0.7, ly2 + h * 0.06, x + w - 2, ly2],
                stroke: '#1a3040', strokeWidth: 0.7, tension: 0.4,
            }));
        }
    }

    // ── 左侧大旋钮（绿色，设定温度）─────────
    _drawBigKnob() {
        const cx = this._bigKnobCX, cy = this._bigKnobCY, r = this._bigKnobR;

        // 底座环
        this.group.add(new Konva.Circle({
            x: cx, y: cy, radius: r * 1.4,
            fill: '#204050', stroke: '#0a1820', strokeWidth: 1.5,
        }));

        // 旋钮主体（青绿色，与图片一致）
        this._bigKnobShape = new Konva.Circle({
            x: cx, y: cy, radius: r,
            fillRadialGradientStartPoint: { x: -r * 0.3, y: -r * 0.3 },
            fillRadialGradientStartRadius: 0,
            fillRadialGradientEndPoint:   { x: 0, y: 0 },
            fillRadialGradientEndRadius:  r,
            fillRadialGradientColorStops: [
                0,   '#5adcd0',
                0.4, '#20b0a0',
                0.8, '#108878',
                1,   '#0a5848',
            ],
            stroke: '#086050', strokeWidth: 1.2,
            shadowColor: '#20d0c0', shadowBlur: 8, shadowOpacity: 0.4,
        });
        this.group.add(this._bigKnobShape);

        // 齿纹（12段）
        for (let i = 0; i < 12; i++) {
            const a  = (i / 12) * Math.PI * 2;
            const ix = cx + Math.cos(a) * r * 0.86;
            const iy = cy + Math.sin(a) * r * 0.86;
            const ox = cx + Math.cos(a) * r * 0.98;
            const oy = cy + Math.sin(a) * r * 0.98;
            this.group.add(new Konva.Line({
                points: [ix, iy, ox, oy],
                stroke: '#0a4838', strokeWidth: 2, lineCap: 'round',
            }));
        }

        // 指针
        this._bigKnobAngle = -90;  // 12点方向
        this._bigKnobPtr = new Konva.Line({
            points: [cx, cy, cx, cy - r * 0.75],
            stroke: '#e0f8f0', strokeWidth: 2.5, lineCap: 'round',
        });
        this.group.add(this._bigKnobPtr);

        // 中心点
        this.group.add(new Konva.Circle({
            x: cx, y: cy, radius: r * 0.18,
            fill: '#b0e8d8', stroke: '#50a090', strokeWidth: 0.8,
        }));

        // 旋钮交互
        this._bigKnobShape.on('click tap', () => this._adjustSP(1));
        this._bigKnobShape.on('contextmenu', (e) => { e.evt.preventDefault(); this._adjustSP(-1); });

        // 标注
        this.group.add(new Konva.Text({
            x: cx - 30, y: cy + r * 1.55,
            width: 60, text: 'SP SET',
            fontSize: 8, fill: 'rgba(200,230,240,0.8)',
            fontFamily: 'Arial', align: 'center',
        }));
    }

    // ── 8个红色报警灯行 ──────────────────────
    _drawRedLEDRow() {
        const labels = ['L1-H', 'L2-H', 'L3-H', 'TCV', 'FLOW', 'DIFF', 'PUMP', 'SYS'];
        this._redLEDs = [];

        for (let i = 0; i < this._ledCount; i++) {
            const cx = this._ledStartX + i * this._ledSpacX;
            const cy = this._ledRowY + this._ledRowH * 0.28;
            const r  = Math.min(this.width, this.height) * 0.024;
            const on = this._alarms[i];

            // LED 外壳
            this.group.add(new Konva.Circle({
                x: cx, y: cy, radius: r * 1.28,
                fill: '#1a2828', stroke: '#0a1818', strokeWidth: 0.8,
            }));

            // LED 发光体
            const dot = new Konva.Circle({
                x: cx, y: cy, radius: r,
                fill: on ? '#ff3322' : '#3a1010',
                stroke: on ? '#cc2211' : '#2a0808', strokeWidth: 0.8,
                shadowColor: on ? '#ff5533' : 'transparent',
                shadowBlur: on ? 8 : 0, shadowOpacity: 0.9,
            });
            this.group.add(dot);

            // 高光
            this.group.add(new Konva.Circle({
                x: cx - r * 0.28, y: cy - r * 0.28, radius: r * 0.32,
                fill: 'rgba(255,255,255,0.20)',
            }));

            this._redLEDs.push({ dot, cx, cy });
        }
    }

    // ── 6个绿色状态灯行（下一行）───────────
    _drawGreenLEDRow() {
        this._greenLEDs = [];
        const count = 6;

        for (let i = 0; i < count; i++) {
            const cx = this._ledStartX + i * this._ledSpacX;
            const cy = this._ledRowY + this._ledRowH * 0.72;
            const r  = Math.min(this.width, this.height) * 0.022;
            const on = this._status[i];

            // 外壳
            this.group.add(new Konva.Circle({
                x: cx, y: cy, radius: r * 1.28,
                fill: '#1a2818', stroke: '#0a1808', strokeWidth: 0.8,
            }));

            // 发光体
            const dot = new Konva.Circle({
                x: cx, y: cy, radius: r,
                fill: on ? '#22dd44' : '#0a2010',
                stroke: on ? '#18aa30' : '#08180a', strokeWidth: 0.8,
                shadowColor: on ? '#33ff55' : 'transparent',
                shadowBlur: on ? 7 : 0, shadowOpacity: 0.85,
            });
            this.group.add(dot);

            this.group.add(new Konva.Circle({
                x: cx - r * 0.28, y: cy - r * 0.28, radius: r * 0.30,
                fill: 'rgba(255,255,255,0.18)',
            }));

            this._greenLEDs.push({ dot, cx, cy });
        }
    }

    // ── 下方泵组流程图 ───────────────────────
    _drawBtmDiagram() {
        const dx = this._btmDiagX, dy = this._btmDiagY;
        const dw = this._btmDiagW, dh = this._btmDiagH;

        // 背景
        this.group.add(new Konva.Rect({
            x: dx, y: dy, width: dw, height: dh,
            fill: '#c8e8f0', stroke: '#a0c8d8', strokeWidth: 1, cornerRadius: 3,
        }));

        const lineColor = '#1a3040';
        const lineW     = 1.2;

        // 左右汇流管
        const leftX  = dx + dw * 0.04;
        const rightX = dx + dw * 0.82;
        const mainY  = dy + dh * 0.35;
        const p3Y    = dy + dh * 0.68;

        this.group.add(new Konva.Rect({
            x: leftX - 5, y: mainY - 5, width: 10, height: p3Y - mainY + 10,
            fill: '#7ab0c0', stroke: '#4a8090', strokeWidth: 1,
        }));
        this.group.add(new Konva.Rect({
            x: rightX - 5, y: mainY - 5, width: 10, height: p3Y - mainY + 10,
            fill: '#7ab0c0', stroke: '#4a8090', strokeWidth: 1,
        }));

        // P1 回路（上）
        this.group.add(new Konva.Line({
            points: [leftX, mainY, rightX, mainY],
            stroke: lineColor, strokeWidth: lineW,
        }));

        // P2 回路（中，稍低）
        const p2Y = dy + dh * 0.52;
        this.group.add(new Konva.Line({
            points: [leftX, p2Y, dx + dw * 0.55, p2Y],
            stroke: lineColor, strokeWidth: lineW,
        }));

        // P3 回路（下）
        this.group.add(new Konva.Line({
            points: [leftX, p3Y, dx + dw * 0.55, p3Y],
            stroke: lineColor, strokeWidth: lineW,
        }));

        // 泵符号和阀门
        const pumpData = [
            { label: 'S1', vx: leftX + dw * 0.06, px: leftX + dw * 0.13, plabel: 'P1', py: mainY },
            { label: 'S2', vx: leftX + dw * 0.20, px: leftX + dw * 0.27, plabel: 'P2', py: p2Y },
            { label: 'S3', vx: leftX + dw * 0.28, px: leftX + dw * 0.35, plabel: 'P3', py: p3Y },
            { label: 'S4', vx: leftX + dw * 0.39, px: null, plabel: null, py: p3Y },
        ];

        this._pumpSymbols = [];

        pumpData.forEach(({ label, vx, px, plabel, py }) => {
            // 阀门
            this._drawIsolationValve(vx, py, label);

            // 泵（圆圈+三角形符号）
            if (px) {
                const active = this._pumps[['P1','P2','P3'].indexOf(plabel)] || false;
                const psym = this._drawPumpSymbol(px, py, plabel, active);
                this._pumpSymbols.push({ sym: psym, label: plabel });
            }
        });

        // 旁通阀（% BYPASS）
        const bvx = dx + dw * 0.72, bvy = dy + dh * 0.30;
        this._drawBypassValve(bvx, bvy, dw * 0.14, dh * 0.42);

        // BYPASS 标注
        this.group.add(new Konva.Text({
            x: bvx - 5, y: dy + dh * 0.05,
            text: '% BYPASS', fontSize: 7,
            fill: '#1a3040', fontFamily: 'Arial',
        }));

        // 旁通阀连接线（从主管路到旁通）
        this.group.add(new Konva.Line({
            points: [dx + dw * 0.55, mainY, bvx - 8, bvy + dh * 0.15],
            stroke: lineColor, strokeWidth: lineW,
        }));
        this.group.add(new Konva.Line({
            points: [bvx + 8, bvy + dh * 0.15, rightX, mainY],
            stroke: lineColor, strokeWidth: lineW,
        }));
    }

    // ── 隔离阀符号（正方形）─────────────────
    _drawIsolationValve(cx, cy, label) {
        const s = 7;
        this.group.add(new Konva.Rect({
            x: cx - s, y: cy - s, width: s * 2, height: s * 2,
            fill: '#d0e8f0', stroke: '#1a3040', strokeWidth: 0.8, cornerRadius: 1,
        }));
        this.group.add(new Konva.Text({
            x: cx - s + 1, y: cy - 4,
            text: label, fontSize: 6, fill: '#1a3040',
        }));
    }

    // ── 泵符号（圆+三角）───────────────────
    _drawPumpSymbol(cx, cy, label, active) {
        const r = 8;
        const circle = new Konva.Circle({
            x: cx, y: cy, radius: r,
            fill: active ? '#88d8b8' : '#a0b8c0',
            stroke: '#1a3040', strokeWidth: 0.9,
        });
        this.group.add(circle);
        this.group.add(new Konva.Line({
            points: [cx - r * 0.5, cy - r * 0.6, cx + r * 0.5, cy, cx - r * 0.5, cy + r * 0.6],
            closed: true, fill: '#1a3040', stroke: 'none',
        }));
        this.group.add(new Konva.Text({
            x: cx - 8, y: cy + r + 1,
            text: label, fontSize: 6, fill: '#1a3040',
        }));
        return circle;
    }

    // ── 旁通调节阀（图中三通阀形状）─────────
    _drawBypassValve(cx, cy, w, h) {
        const s = Math.min(w, h) * 0.4;
        this.group.add(new Konva.Line({
            points: [cx - s, cy - s * 0.4, cx + s, cy - s * 0.4, cx, cy + s * 0.4],
            closed: true, fill: '#b8d8e8', stroke: '#1a3040', strokeWidth: 0.9,
        }));
        this.group.add(new Konva.Line({
            points: [cx - s, cy + s * 0.4, cx + s, cy + s * 0.4, cx, cy - s * 0.4],
            closed: true, fill: '#d8eef8', stroke: '#1a3040', strokeWidth: 0.9,
        }));
        this._bypassArrow = new Konva.Line({
            points: [cx, cy - s * 0.4, cx, cy - s * 1.0],
            stroke: '#e04010', strokeWidth: 1.5, lineCap: 'round',
        });
        this.group.add(this._bypassArrow);
    }

    // ── 中央信息图标（❄ % / 🌡 °C）──────────
    _drawInfoIcons() {
        const ix = this._infoX, iy = this._infoY;
        const iw = this._infoW, ih = this._infoH;

        // 雪花图标（❄）+ %
        this.group.add(new Konva.Text({
            x: ix, y: iy + ih * 0.05, width: iw * 0.5,
            text: '❄', fontSize: 22, fill: '#c8eef8', align: 'center',
        }));
        this.group.add(new Konva.Text({
            x: ix, y: iy + ih * 0.18, width: iw * 0.5,
            text: '%', fontSize: 11, fill: 'rgba(200,230,240,0.7)',
            fontFamily: 'Arial', align: 'center',
        }));

        // 温度计图标 + °C
        this.group.add(new Konva.Text({
            x: ix + iw * 0.5, y: iy + ih * 0.05, width: iw * 0.5,
            text: '🌡', fontSize: 20, align: 'center',
        }));
        this.group.add(new Konva.Text({
            x: ix + iw * 0.5, y: iy + ih * 0.18, width: iw * 0.5,
            text: '°C', fontSize: 11, fill: 'rgba(200,230,240,0.7)',
            fontFamily: 'Arial', align: 'center',
        }));
    }

    // ── 大 LED 数字显示屏（红色，显示"41"）──
    _drawBigDisplay() {
        const dx = this._bigDispX, dy = this._bigDispY;
        const dw = this._bigDispW, dh = this._bigDispH;

        // 显示屏外框
        this.group.add(new Konva.Rect({
            x: dx - 4, y: dy - 4, width: dw + 8, height: dh + 8,
            fill: '#1a1a1a', stroke: '#0a0a0a', strokeWidth: 2, cornerRadius: 4,
        }));

        // 显示屏背景（深红黑）
        this.group.add(new Konva.Rect({
            x: dx, y: dy, width: dw, height: dh,
            fill: '#1c0808', stroke: '#2a0808', strokeWidth: 1, cornerRadius: 3,
        }));

        // 背景网格（数码管底色）
        this.group.add(new Konva.Rect({
            x: dx + 2, y: dy + 2, width: dw - 4, height: dh - 4,
            fill: '#200c0c', cornerRadius: 2,
        }));

        // 动态数字
        this._bigDispText = new Konva.Text({
            x: dx + 4, y: dy + dh * 0.08,
            width: dw - 8, height: dh - dh * 0.10,
            text: Math.round(this._displayVal).toString(),
            fontSize: dh * 0.72, fontStyle: 'bold',
            fontFamily: '"Courier New", "DS-Digital", monospace',
            fill: '#ff3318',
            shadowColor: '#ff4422', shadowBlur: 6, shadowOpacity: 0.7,
            align: 'center',
        });
        this.group.add(this._bigDispText);

        // 反光层
        this.group.add(new Konva.Rect({
            x: dx + 1, y: dy + 1, width: dw - 2, height: dh * 0.28,
            fill: 'rgba(255,255,255,0.03)', cornerRadius: [2, 2, 0, 0],
        }));
    }

    // ── 右侧4个系统状态指示灯 ───────────────
    _drawSysLEDs() {
        // 运行(绿)/待机(棕/橙)/警告(棕)/报警(红)
        const ledDefs = [
            { color: '#22dd44', dimColor: '#0a2010', label: 'RUN',  x: this.width * 0.840, y: this._infoY + this._infoH * 0.12 },
            { color: '#cc8822', dimColor: '#2a1a04', label: 'STBY', x: this.width * 0.840, y: this._infoY + this._infoH * 0.30 },
            { color: '#cc8822', dimColor: '#2a1a04', label: 'WARN', x: this.width * 0.840, y: this._infoY + this._infoH * 0.68 },
            { color: '#ff3322', dimColor: '#3a1010', label: 'ALM',  x: this.width * 0.840, y: this._infoY + this._infoH * 0.86 },
        ];

        this._sysLEDShapes = [];
        const r = Math.min(this.width, this.height) * 0.026;

        ledDefs.forEach((ld, i) => {
            const on = this._sysLeds[i];
            this.group.add(new Konva.Circle({
                x: ld.x, y: ld.y, radius: r * 1.3,
                fill: '#1a2020', stroke: '#0a1010', strokeWidth: 0.8,
            }));
            const dot = new Konva.Circle({
                x: ld.x, y: ld.y, radius: r,
                fill: on ? ld.color : ld.dimColor,
                stroke: on ? ld.color : '#1a1a1a', strokeWidth: 0.8,
                shadowColor: on ? ld.color : 'transparent',
                shadowBlur: on ? 8 : 0, shadowOpacity: 0.85,
            });
            this.group.add(dot);
            this.group.add(new Konva.Circle({
                x: ld.x - r * 0.28, y: ld.y - r * 0.28, radius: r * 0.30,
                fill: 'rgba(255,255,255,0.20)',
            }));
            this._sysLEDShapes.push({ dot, def: ld });
        });
    }

    // ── 右侧控制条（白色背景，图标+按钮）────
    _drawCtrlStrip() {
        const sx = this._ctrlStripX, sy = this._ctrlStripY;
        const sw = this._ctrlStripW, sh = this._ctrlStripH;

        // 控制条背景（白/浅灰）
        this.group.add(new Konva.Rect({
            x: sx, y: sy, width: sw, height: sh,
            fill: '#e8eff5', stroke: '#b0c0cc', strokeWidth: 1, cornerRadius: 3,
        }));

        // 按钮定义（图标 + 功能）
        const btnDefs = [
            { icon: '⚙', label: 'MODE',  y: sy + sh * 0.06 },  // 运行模式
            { icon: '▶', label: 'RUN',   y: sy + sh * 0.25 },  // 启动
            { icon: '↑↓', label: 'SETP', y: sy + sh * 0.46 },  // 设定值调节
            { icon: '↓', label: 'DOWN',  y: sy + sh * 0.63 },  // 减小
            { icon: '⏺', label: 'CONF',  y: sy + sh * 0.80 },  // 确认/配置
            { icon: '⚠', label: 'ALM',   y: sy + sh * 0.90 },  // 报警确认
        ];

        this._ctrlBtns = [];
        const bw = sw * 0.82, bh = sh * 0.08;
        const bx = sx + sw * 0.09;

        btnDefs.forEach(bd => {
            // 按钮外框
            this.group.add(new Konva.Rect({
                x: bx + 1, y: bd.y + 2, width: bw, height: bh,
                fill: '#a0a8b0', cornerRadius: 2,
            }));
            const btn = new Konva.Rect({
                x: bx, y: bd.y, width: bw, height: bh,
                fillLinearGradientStartPoint: { x: 0, y: 0 },
                fillLinearGradientEndPoint:   { x: 0, y: bh },
                fillLinearGradientColorStops: [0, '#d8e4ec', 0.5, '#c0ced8', 1, '#a8b8c4'],
                stroke: '#88a0b0', strokeWidth: 0.7, cornerRadius: 2,
            });
            this.group.add(btn);
            // 图标
            this.group.add(new Konva.Text({
                x: bx + 2, y: bd.y + 1, width: bw * 0.45, height: bh,
                text: bd.icon, fontSize: bh * 0.75, align: 'center',
                fill: '#304050',
            }));
            // 标签
            this.group.add(new Konva.Text({
                x: bx + bw * 0.42, y: bd.y + bh * 0.15, width: bw * 0.56, height: bh,
                text: bd.label, fontSize: bh * 0.62,
                fontFamily: 'Arial', fontStyle: 'bold',
                fill: '#304050', align: 'left',
            }));

            btn.on('mouseenter', () => { btn.opacity(0.7); this._refreshCache(); });
            btn.on('mouseleave', () => { btn.opacity(1.0); this._refreshCache(); });
            btn.on('click tap', () => this._onCtrlBtn(bd.label));
            this._ctrlBtns.push(btn);
        });
    }

    // ── 最右侧4个圆形旋钮 ───────────────────
    _drawRightKnobs() {
        this._rightKnobs = [];
        for (let i = 0; i < 4; i++) {
            const cx = this._knobsX + this._knobsR * 1.1;
            const cy = this._knobsStartY + i * this._knobsSpacY;
            const r  = this._knobsR;

            // 底座
            this.group.add(new Konva.Circle({
                x: cx, y: cy, radius: r * 1.45,
                fill: '#1c2830', stroke: '#0a1218', strokeWidth: 1.5,
            }));

            // 旋钮主体（深灰银）
            const knob = new Konva.Circle({
                x: cx, y: cy, radius: r,
                fillRadialGradientStartPoint: { x: -r * 0.3, y: -r * 0.3 },
                fillRadialGradientStartRadius: 0,
                fillRadialGradientEndPoint:   { x: 0, y: 0 },
                fillRadialGradientEndRadius:  r,
                fillRadialGradientColorStops: [
                    0,   '#7a8898',
                    0.5, '#4a5868',
                    1,   '#2a3440',
                ],
                stroke: '#1a2430', strokeWidth: 1,
            });
            this.group.add(knob);

            // 齿纹（10段）
            for (let j = 0; j < 10; j++) {
                const a  = (j / 10) * Math.PI * 2;
                this.group.add(new Konva.Line({
                    points: [
                        cx + Math.cos(a) * r * 0.85, cy + Math.sin(a) * r * 0.85,
                        cx + Math.cos(a) * r * 0.98, cy + Math.sin(a) * r * 0.98,
                    ],
                    stroke: '#0a1218', strokeWidth: 1.8, lineCap: 'round',
                }));
            }

            // 指针
            const ptr = new Konva.Line({
                points: [cx, cy, cx, cy - r * 0.75],
                stroke: '#d0dce8', strokeWidth: 2, lineCap: 'round',
            });
            this.group.add(ptr);

            // 中心
            this.group.add(new Konva.Circle({
                x: cx, y: cy, radius: r * 0.18,
                fill: '#a0b0be', stroke: '#708090', strokeWidth: 0.8,
            }));

            knob.on('click tap', () => this._onKnobClick(i));
            this._rightKnobs.push({ knob, ptr, cx, cy, angle: -90 });
        }
    }

    // ── 端口 ─────────────────────────────────
    _addPorts() {
        const W = this.width, H = this.height;
        this.addPort(W * 0.15, H,       'port_tt_in',     'wire', 'TT IN');
        this.addPort(W * 0.35, H,       'port_ctrl_valve','wire', 'CTRL');
        this.addPort(W * 0.55, H,       'port_bypass',    'wire', 'BYP');
        this.addPort(W * 0.75, H,       'port_pump_cmd',  'wire', 'PUMP');
        this.addPort(W * 0.92, H,       'port_alarm_out', 'wire', 'ALM');
    }

    // ═══════════════════════════════════════════
    // 动画主循环
    // ═══════════════════════════════════════════
    // 集中化 tick（由 consys._tickAll 在 20fps 调用）
    tick(dt) {
        this._simulate(dt);
        this._refreshDisplay();
    }
    // ── 过程仿真 ─────────────────────────────
    _simulate(dt) {
        // PID 计算
        const error      = this._sp - this._pv;
        this._integral  += error * dt;
        this._integral   = Math.max(-120, Math.min(120, this._integral));
        const derivative = this._Td > 0 ? (error - this._prevError) / dt : 0;
        this._prevError  = error;

        const Ki = this._Ti > 0 ? this._Kp / this._Ti : 0;
        const Kd = this._Kp * this._Td;
        this._ctrlOutput = this._Kp * error + Ki * this._integral + Kd * derivative;
        this._ctrlOutput = Math.max(0, Math.min(100, this._ctrlOutput));

        // 阀位（一阶滞后，τ=5s）
        this._valvePos  += ((this._ctrlOutput - this._valvePos) / 5)  * dt;
        this._bypassPos += ((this._ctrlOutput * 0.6 - this._bypassPos) / 8) * dt;

        // 过程温度（一阶惯性）
        const loadTemp   = this._sp + 5 * (1 - this._ctrlOutput / 100);
        const noise      = (Math.random() - 0.5) * this._noiseAmp * 2;
        this._pvTgt      = loadTemp + noise;
        this._pv        += ((this._pvTgt - this._pv) / this._tau) * dt;
        this._pv         = Math.max(this.rangeMin, Math.min(this.rangeMax, this._pv));
        this._displayVal = this._dispMode === 'temp' ? this._pv : this._ctrlOutput;

        // 报警更新
        this._alarms[0] = this._pv > this._sp + 5;
        this._alarms[1] = this._pv > this._sp + 8;
        this._alarms[7] = this._alarms.slice(0, 7).some(Boolean);

        // 系统状态灯
        this._sysLeds[0] = this._pumps.some(Boolean);             // RUN
        this._sysLeds[1] = !this._sysLeds[0];                    // STBY
        this._sysLeds[2] = this._pv > this._sp + 3;              // WARN
        this._sysLeds[3] = this._alarms[7];                       // ALM

        // 状态绿灯
        this._status[0] = this._pumps[0];
        this._status[1] = this._pumps[1];
        this._status[4] = this._pumps[2];
        this._status[5] = this._sysLeds[0];
    }

    // ── 刷新所有显示元素 ─────────────────────
    _refreshDisplay() {
        // 大显示屏
        if (this._bigDispText) {
            const val = this._dispMode === 'temp'
                ? this._pv.toFixed(1)
                : Math.round(this._ctrlOutput).toString();
            this._bigDispText.text(val);
            this._bigDispText.fill(this._alarms[7] ? '#ff8822' : '#ff3318');
        }

        // 红色报警灯
        this._redLEDs?.forEach((led, i) => {
            const on = this._alarms[i];
            led.dot.fill(on ? '#ff3322' : '#3a1010');
            led.dot.shadowBlur(on ? 8 : 0);
        });

        // 绿色状态灯
        this._greenLEDs?.forEach((led, i) => {
            const on = this._status[i];
            led.dot.fill(on ? '#22dd44' : '#0a2010');
            led.dot.shadowBlur(on ? 7 : 0);
        });

        // 系统状态灯
        this._sysLEDShapes?.forEach((ls, i) => {
            const on = this._sysLeds[i];
            ls.dot.fill(on ? ls.def.color : ls.def.dimColor);
            ls.dot.shadowBlur(on ? 8 : 0);
        });

        // 三通阀阀位指针
        if (this._valveArrow && this._tvCX !== undefined) {
            const frac = this._valvePos / 100;
            const s    = this._tvS;
            const offset = (frac - 0.5) * s * 1.2;
            this._valveArrow.points([
                this._tvCX - s * 0.4 + offset, this._tvCY - s * 0.6,
                this._tvCX + s * 0.4 + offset, this._tvCY - s * 0.6,
            ]);
        }

        // 旋钮指针（大旋钮跟随 SP）
        if (this._bigKnobPtr) {
            const frac = (this._sp - this.rangeMin) / (this.rangeMax - this.rangeMin);
            const ang  = (-135 + frac * 270) * Math.PI / 180;
            const cx = this._bigKnobCX, cy = this._bigKnobCY, r = this._bigKnobR;
            this._bigKnobPtr.points([
                cx + Math.cos(ang) * r * 0.22, cy + Math.sin(ang) * r * 0.22,
                cx + Math.cos(ang) * r * 0.82, cy + Math.sin(ang) * r * 0.82,
            ]);
        }

        this._refreshCache();
    }

    // ── 交互处理 ─────────────────────────────
    _adjustSP(delta) {
        this._sp = Math.max(this.rangeMin, Math.min(this.rangeMax, this._sp + delta));
        this._integral = 0;
    }

    _onCtrlBtn(label) {
        switch (label) {
            case 'MODE':
                this._dispMode = this._dispMode === 'temp' ? 'pct' : 'temp';
                break;
            case 'RUN':
                // 切换第一台泵
                this._pumps[0] = !this._pumps[0];
                break;
            case 'SETP':
                this._adjustSP(0.5);
                break;
            case 'DOWN':
                this._adjustSP(-0.5);
                break;
            case 'ALM':
                this._alarms.fill(false);
                break;
        }
    }

    _onKnobClick(idx) {
        // 右侧旋钮1~4 分别控制：SP微调、报警复位、泵切换、模式
        const rk = this._rightKnobs[idx];
        if (!rk) return;
        rk.angle = ((rk.angle || -90) + 30) % 360;
        const ang = rk.angle * Math.PI / 180;
        const r = this._knobsR;
        rk.ptr.points([
            rk.cx + Math.cos(ang) * r * 0.22, rk.cy + Math.sin(ang) * r * 0.22,
            rk.cx + Math.cos(ang) * r * 0.82, rk.cy + Math.sin(ang) * r * 0.82,
        ]);
        if (idx === 0) this._adjustSP(1);
        if (idx === 1) this._alarms.fill(false);
        if (idx === 2) {
            // 轮换泵
            const cur = this._pumps.findIndex(p => p);
            this._pumps[cur] = false;
            this._pumps[(cur + 1) % 3] = true;
        }
        if (idx === 3) {
            this._dispMode = this._dispMode === 'temp' ? 'pct' : 'temp';
        }
        this._refreshCache();
    }

    // ═══════════════════════════════════════════
    // 公共 API
    // ═══════════════════════════════════════════
    getPV()      { return this._pv; }
    getSP()      { return this._sp; }
    getOutput()  { return this._ctrlOutput; }
    isAlarm()    { return this._alarms.some(Boolean); }
    getValvePos(){ return this._valvePos; }

    setSP(sp) {
        this._sp = Math.max(this.rangeMin, Math.min(this.rangeMax, sp));
        this._integral = 0;
    }
    setPV(pv) {
        this._pv = Math.max(this.rangeMin, Math.min(this.rangeMax, pv));
    }
    setPumpState(idx, on) {
        if (idx >= 0 && idx < 3) this._pumps[idx] = !!on;
    }
    clearAlarms() { this._alarms.fill(false); }

    update(state) {
        if (!state || typeof state !== 'object') return;
        if (state.sp  !== undefined) this.setSP(state.sp);
        if (state.pv  !== undefined) this.setPV(state.pv);
        if (state.p1  !== undefined) this.setPumpState(0, state.p1);
        if (state.p2  !== undefined) this.setPumpState(1, state.p2);
        if (state.p3  !== undefined) this.setPumpState(2, state.p3);
        if (state.ack) this.clearAlarms();
        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label: '位号',             key: 'label',    type: 'text'   },
            { label: '型号',             key: 'model',    type: 'text'   },
            { label: '量程下限 (°C)',    key: 'rangeMin', type: 'number' },
            { label: '量程上限 (°C)',    key: 'rangeMax', type: 'number' },
            { label: '初始设定值 (°C)',  key: 'initSP',   type: 'number' },
            { label: '初始过程值 (°C)',  key: 'initPV',   type: 'number' },
            { label: 'PID Kp',           key: 'Kp',       type: 'number' },
            { label: 'PID Ti (s)',       key: 'Ti',       type: 'number' },
            { label: 'PID Td (s)',       key: 'Td',       type: 'number' },
            { label: '过程惯性时间 (s)', key: 'tau',      type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label   ) this.label    = cfg.label;
        if (cfg.model   ) this.model    = cfg.model;
        if (cfg.rangeMin !== undefined) this.rangeMin = parseFloat(cfg.rangeMin) || this.rangeMin;
        if (cfg.rangeMax !== undefined) this.rangeMax = parseFloat(cfg.rangeMax) || this.rangeMax;
        if (cfg.initSP  !== undefined) this.setSP(parseFloat(cfg.initSP));
        if (cfg.initPV  !== undefined) this.setPV(parseFloat(cfg.initPV));
        if (cfg.Kp      !== undefined) this._Kp  = parseFloat(cfg.Kp)  || this._Kp;
        if (cfg.Ti      !== undefined) this._Ti  = parseFloat(cfg.Ti)  || this._Ti;
        if (cfg.Td      !== undefined) this._Td  = parseFloat(cfg.Td)  || this._Td;
        if (cfg.tau     !== undefined) this._tau = parseFloat(cfg.tau) || this._tau;
        this.config = { ...this.config, ...cfg };
        this._refreshCache();
    }

    destroy() {
        super.destroy?.();
    }
}