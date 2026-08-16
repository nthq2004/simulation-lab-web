/**
 * Fluke726.js
 * 基于 Konva.js 仿真的 FLUKE 726 精密过程校验仪
 * 参考 Multimeter.js 架构，完整还原 FLUKE 726 界面与功能
 *
 * 主要功能：
 *   MEASURE（测量）: 电流回路 mA、直流电压 V
 *   SOURCE（源输出）: 电流 mA、电压 V、电阻 Ω、热电偶 TC、RTD、频率 Hz、压力（扩展）
 *   辅助功能: 百分比误差显示、HART 通信、步进输出（25%/0%/100%）
 */
import { BaseComponent } from './BaseComponent.js';

const STEP_CONFIG = {
    'SRC_MA': { steps: [0.01, 0.1, 1.0], defaultIdx: 2 }, // 初始 1.0
    'SRC_LOOP': { steps: [0.01, 0.1, 1.0], defaultIdx: 2 }, // 初始 1.0    
    'SRC_V': { steps: [0.01, 0.1, 1.0], defaultIdx: 2 }, // 初始 1.0
    'SRC_RES': { steps: [0.1, 1.0, 10.0, 100.0, 1000.0], defaultIdx: 2 }, // 初始 10.0
    'SRC_HZ': { steps: [0.1, 1.0, 10.0, 100.0], defaultIdx: 2 }, // 初始 100.0
    'SRC_TC': { steps: [0.1, 1.0, 10.0, 100.0], defaultIdx: 2 }, // 初始 10.0
    'SRC_RTD': { steps: [0.1, 1.0, 10.0, 100.0], defaultIdx: 2 }, // 初始 10.0
    'SRC_PRESSURE': { steps: [0.1, 1.0, 10.0, 100.0], defaultIdx: 2 }, // 初始 10.0
};

export class ProcessCalibrator extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        this.scale = 1.2;

        // ── 仪器类型标识 ──────────────────────────────────────────────
        this.type = 'calibrator';
        this.cache = 'fixed';

        // ── 工作状态 ─────────────────────────────────────────────────
        /**
         * upMode: 测量功能档位
         *   'OFF'       - 关机
         *   'MEAS_MA'   - 测量电流回路 mA
         *   'MEAS_V'    - 测量直流电压 V
         *   'MEAS_P'    - 测量压力（扩展功能，模拟 4-20mA 输出）
         *   'MEAS_LOOP'  - 测量电流回路（与 MEAS_MA 等效，输出24V电压）
         */
        this.upMode = 'MEAS_V';
        this.measureMode = 'MEAS_V';
        /**
         * measureMode:  下排测量功能档位
         *   'MEAS_MA'    - 测量电流 mA (0-24mA)
         *   'MEAS_V'     - 测量电压 V  (0-10V / ±30V)
         *   'MEAS_RES'   - 测量电阻 Ω
         *   'MEAS_TC'    - 测量热电偶 (热电偶类型可选: J/K/T/E/R/S/B/N)
         *   'MEAS_RTD'   - 测量RTD  (Pt100 等)
         *   'MEAS_HZ'    - 测量频率 Hz
         */
        /**
         * sourceMode: 源输出功能档位
         *   'SRC_MA'    - 输出电流 mA (0-24mA)
         *   'SRC_V'     - 输出电压 V  (0-10V / ±30V)
         *   'SRC_RES'   - 输出电阻 Ω
         *   'SRC_TC'    - 热电偶模拟 (热电偶类型可选: J/K/T/E/R/S/B/N)
         *   'SRC_RTD'   - RTD 模拟 (Pt100 等)
         *   'SRC_HZ'    - 输出频率 Hz
         */
        this.sourceMode = 'SRC_V';

        /**
         * activePanel: 当前激活的操作面板，决定旋钮/按键响应
         *   'MEASURE' | 'SOURCE'
         */
        this.activePanel = 'MEASURE';

        this.isPowered = true;           // 电源状态
        this._backlightOn = true;        // 背光状态

        // ── 上排测量值 ───────────────────────────────────────────────────
        this.upValue = 0.0;      // 当前测量输入值
        this.upDisplayStr = '0.00'; // 上行显示字符串（大字符）

        // ── 下排测量值 ───────────────────────────────────────────────────
        this.measureValue = 0.0;      // 当前测量输入值
        this.measureDisplayStr = '0.00'; // 上行显示字符串（大字符）
        // ── 源输出值 ─────────────────────────────────────────────────
        this.sourceValue = 0.0;          // 当前源输出设定值
        this.sourceDisplayStr = '0.00';  // 下行显示字符串

        // ── 热电偶/RTD 配置 ──────────────────────────────────────────
        this.tcType = 'K';               // 热电偶类型: J K T E R S B N
        this.rtdType = 'Pt100';          // RTD类型: Pt100 / Pt200 / Ni120
        this.tempUnit = '°C';            // 温度单位: °C / °F

        // ── 百分比误差 ───────────────────────────────────────────────
        this.percentError = 0.0;         // %Error
        this.showPercent = false;

        // ── 气路模块（内部集成压力模块）────────────────────────────
        this.pressureModuleEnabled = true;       // 内部压力模块是否启用
        this.pressureValue = 0.0;                // 当前气压值 (kPa)
        this.pressureMode = 'INPUT';             // INPUT: 输入模式，OUTPUT: 输出模式
        this.pressureRange = { lo: 0.0, hi: 100.0 }; // 气压量程 0-100 kPa
        this.pressureZeroOffset = 0.0;           // 气压零偏

        // ── 步进输出百分比 ───────────────────────────────────────────
        // FLUKE726 有 0% / 25% / 100% 步进按键
        this.stepPercents = [0, 25, 100];

        // ── 尺寸 ─────────────────────────────────────────────────────
        this.width = (config.width || 260) * this.scale;
        this.height = (config.height || 520) * this.scale;

        // ── 节流参数 ─────────────────────────────────────────────────
        this._displayThrottle = 200;
        this._lastUpdateAt = 0;
        this._pendingValue = null;
        this._pendingTimer = null;

        // ── 构建 UI ──────────────────────────────────────────────────
        this._createUI();

        // ── 接线端口 ─────────────────────────────────────────────────
        // FLUKE726 底部端口布局（从左到右）:
        //   SOURCE侧: mA / V·Ω·RTD / TC / COM
        //   MEASURE侧: mA(LOOP) / COM
        this._addPorts();
    }

    // ═══════════════════════════════════════════════════════════════════
    //  UI 构建
    // ═══════════════════════════════════════════════════════════════════

    _createUI() {
        const W = this.width;
        const H = this.height;
        const cx = W / 2;
        const s = this.scale;

        // ── 外壳：黄色（FLUKE 标志色）+ 深灰面板 ──────────────────────
        const body = new Konva.Rect({
            x: 0, y: 0,
            width: W, height: H,
            fill: '#2b2b2b',
            stroke: '#F5A800',       // FLUKE 黄
            strokeWidth: 14 * s,
            cornerRadius: 18 * s,
            shadowBlur: 16 * s,
            shadowColor: '#000',
            shadowOpacity: 0.6
        });
        this.group.add(body);

        // 黄色顶部品牌条
        const topBar = new Konva.Rect({
            x: 7 * s, y: 7 * s,
            width: W - 14 * s, height: 38 * s,
            fill: '#F5A800',
            cornerRadius: [12 * s, 12 * s, 0, 0]
        });
        this.group.add(topBar);

        // FLUKE 品牌文字
        const brandText = new Konva.Text({
            x: 14 * s, y: 13 * s,
            text: 'FLUKE',
            fontSize: 18 * s,
            fontFamily: 'Arial Black, sans-serif',
            fontStyle: 'bold',
            fill: '#1a1a1a'
        });
        const modelText = new Konva.Text({
            x: W - 90 * s, y: 12 * s,
            text: '726',
            fontSize: 16 * s,
            fontFamily: 'Arial, sans-serif',
            fontStyle: 'bold',
            fill: '#1a1a1a'
        });
        const subtitleText = new Konva.Text({
            x: W - 125 * s, y: 30 * s,
            text: 'PRECISION CALIBRATOR',
            fontSize: 8.5 * s,
            fontFamily: 'Arial, sans-serif',
            fill: '#1a1a1a',
            letterSpacing: 0.5
        });
        this.group.add(brandText, modelText, subtitleText);

        // ── 顶部气路接口（模拟内部压力模块）────────────────────────────
        this._buildPressurePort(cx, s, W);

        // ── 双行 LCD 显示屏 ────────────────────────────────────────────
        this._buildLCD(cx, s, W);

        // ── 功能按键区 ────────────────────────────────────────────────
        this._buildButtons(cx, s, W, H);

        // ── 端口标签区 ────────────────────────────────────────────────
        this._buildJackLabels(s, W, H);

        // 旋钮/按键绑定在 _buildButtons 内完成
    }

    /**
     * 构建双行 LCD
     * 上行（MEASURE LOOP）：大字体，5位半数字，绿底
     * 下行（SOURCE）：中字体，数值 + 单位+辅助信息
     */
    _buildLCD(cx, s, W) {
        const lcdX = 14 * s;
        const lcdY = 52 * s;
        const lcdW = W - 28 * s;
        const lcdH = 130 * s;

        // LCD 背景
        this.lcdBg = new Konva.Rect({
            x: lcdX, y: lcdY,
            width: lcdW, height: lcdH,
            fill: '#cadcb0',
            stroke: '#444',
            strokeWidth: 2 * s,
            cornerRadius: 4 * s
        });
        this.group.add(this.lcdBg);

        // ── MEASURE LOOP 区域（上行）──────────────────────────────────
        const measLabelY = lcdY + 6 * s;
        this.measLabel = new Konva.Text({
            x: lcdX + 6 * s, y: measLabelY,
            text: 'MEASURE  LOOP',
            fontSize: 8 * s,
            fontFamily: 'Arial, sans-serif',
            fill: '#1a3a0a',
            fontStyle: 'bold'
        });

        // 测量值（大字）
        this.lcdMeasValue = new Konva.Text({
            x: lcdX + 6 * s,
            y: lcdY + 16 * s,
            text: '0.00',
            fontSize: 36 * s,
            fontFamily: 'DSEG7 Classic, monospace',
            fontStyle: 'bold',
            fill: '#1a3a0a',
            width: lcdW * 0.65,
            align: 'right'
        });

        // 测量单位（右上角）
        this.lcdMeasUnit = new Konva.Text({
            x: lcdX + lcdW * 0.72,
            y: lcdY + 16 * s,
            text: 'V',
            fontSize: 18 * s,
            fontFamily: 'Arial, sans-serif',
            fontStyle: 'bold',
            fill: '#1a3a0a'
        });

        // 分隔线
        const divLine = new Konva.Line({
            points: [lcdX + 4 * s, lcdY + 62 * s, lcdX + lcdW - 4 * s, lcdY + 62 * s],
            stroke: '#3a5a2a',
            strokeWidth: 1 * s,
            dash: [3, 3]
        });

        // ── SOURCE 区域（下行）───────────────────────────────────────
        this.srcLabel = new Konva.Text({
            x: lcdX + 6 * s, y: lcdY + 66 * s,
            text: 'MEASURE',
            fontSize: 8 * s,
            fontFamily: 'Arial, sans-serif',
            fill: '#1a3a0a',
            fontStyle: 'bold'
        });

        this.lcdSrcValue = new Konva.Text({
            x: lcdX + 6 * s,
            y: lcdY + 76 * s,
            text: '0.00',
            fontSize: 30 * s,
            fontFamily: 'DSEG7 Classic, monospace',
            fontStyle: 'bold',
            fill: '#1a3a0a',
            width: lcdW * 0.60,
            align: 'right'
        });

        // 源单位
        this.lcdSrcUnit = new Konva.Text({
            x: lcdX + lcdW * 0.65,
            y: lcdY + 76 * s,
            text: 'V',
            fontSize: 14 * s,
            fontFamily: 'Arial, sans-serif',
            fontStyle: 'bold',
            fill: '#1a3a0a'
        });

        // 源辅助信息（TC类型/RTD类型等）
        this.lcdSrcAux = new Konva.Text({
            x: lcdX + lcdW * 0.65,
            y: lcdY + 96 * s,
            text: '',
            fontSize: 9 * s,
            fontFamily: 'Arial, sans-serif',
            fill: '#1a3a0a'
        });

        // %Error 显示
        this.lcdPercentError = new Konva.Text({
            x: lcdX + 4 * s,
            y: lcdY + lcdH - 16 * s,
            text: '',
            fontSize: 9 * s,
            fontFamily: 'Arial, sans-serif',
            fill: '#2a5a1a'
        });

        this.group.add(
            this.measLabel, this.lcdMeasValue, this.lcdMeasUnit,
            divLine,
            this.srcLabel, this.lcdSrcValue, this.lcdSrcUnit, this.lcdSrcAux,
            this.lcdPercentError
        );
    }

    /**
     * 构建功能按键区域（严格对照 FLUKE 726 实物面板）
     *
     * ┌─────────────────────────────────────────────────────────┐
     * │ 第1排(5个): [⏻电源] [V mA LOOP] [压力◎] [ZERO清零] [☀背光] │
     * ├─────────────────────────────────────────────────────────┤
     * │ 第2+3排左: ┌──────────┐  第2排右3个: [V mA] [压力⊥] [Hz Ω]  │
     * │           │  MEAS    │  第3排右3个: [TC]   [RTD]   [°C °F] │
     * │           │──────────│                                      │
     * │           │  SOURCE  │                                      │
     * │           └──────────┘                                      │
     * ├─────────────────────────────────────────────────────────┤
     * │ 左列:          中列(圆形方向盘):         右列(步进):          │
     * │ [STORE/SETUP]   [  ▲  ]                [  100%  ]           │
     * │ [RECALL   ]  [◄][   ][►]               [ ▲ 25% ]           │
     * │ [模式选择  ]   [  ▼  ]                [ ▼ 25% ]           │
     * │                                         [   0%  ]           │
     * └─────────────────────────────────────────────────────────┘
     */
    _buildButtons(cx, s, W, H) {

        // ── 布局基准 ───────────────────────────────────────────────────
        // 按键区域从 LCD 下方开始，LCD 底部约在 y=190
        const ROW1_Y = 196 * s;   // 第1排 顶部Y
        const ROW23_Y = 224 * s;   // 第2/3排 顶部Y
        const BLK_Y = 302 * s;   // 下方功能块 顶部Y

        const BH1 = 22 * s;       // 第1排按键高度
        const BH23 = 20 * s;       // 第2/3排按键高度
        const BH_BIG = BH23 * 2 + 4 * s;  // MEAS/SOURCE 大按键高度（跨两排）
        const BH_BLK = 22 * s;     // 下方功能块按键高度

        // 左边距
        const LM = 12 * s;
        // 可用宽度
        const AW = W - LM * 2;

        // ── 辅助：注册一个按键（矩形+文字+事件） ─────────────────────
        const addBtn = (x, y, w, h, label, fill, tc, action, fontSize2line, customDraw) => {
            const rect = new Konva.Rect({
                x, y, width: w, height: h,
                fill, stroke: '#1a1a1a', strokeWidth: 1 * s,
                cornerRadius: 3 * s,
                shadowBlur: 2 * s, shadowColor: '#000', shadowOpacity: 0.4
            });
            rect.on('mousedown touchstart', (e) => {
                e.cancelBubble = true;
                this._handleButtonAction(action);
                // 异步处理视觉反馈，避免阻塞事件处理
                Promise.resolve().then(() => {
                    rect.fill(this._brighten(fill));
                    this._refreshCache();
                    setTimeout(() => { rect.fill(fill); this._refreshCache(); }, 50);
                });
            });
            rect.on('dblclick', e => { e.cancelBubble = true; });
            this.group.add(rect);

            if (customDraw) {
                customDraw(x, y, w, h);
            } else {
                const lines = label.split('\n');
                const fs = fontSize2line
                    ? (lines.length > 1 ? fontSize2line : fontSize2line * 1.3)
                    : (lines.length > 1 ? 6.5 * s : 9 * s);
                const totalH = fs * lines.length * 1.35;
                const txt = new Konva.Text({
                    x, y: y + (h - totalH) / 2 + 4 * s,
                    text: label,
                    fontSize: fs,
                    fontFamily: 'Arial, sans-serif',
                    fill: tc,
                    width: w, align: 'center'
                });
                txt.on('mousedown touchstart', (e) => {
                    e.cancelBubble = true;
                    this._handleButtonAction(action);
                    // 异步处理视觉反馈，避免阻塞事件处理
                    Promise.resolve().then(() => {
                        rect.fill(this._brighten(fill));
                        this._refreshCache();
                        setTimeout(() => { rect.fill(fill); this._refreshCache(); }, 50);
                    });
                });
                this.group.add(txt);
            }
        };

        // ════════════════════════════════════════════════════════════
        //  第1排：5个按键等宽排列
        //  1-电源开关  2-V/mA/LOOP切换  3-压力测量  4-清零  5-背光
        // ════════════════════════════════════════════════════════════
        const R1_COUNT = 5;
        const R1_GAP = 4 * s;
        const R1_BW = (AW - R1_GAP * (R1_COUNT - 1)) / R1_COUNT;

        const row1Btns = [
            // 1. 电源开关 — 绿色圆形电源符号
            { label: 'Power', fill: '#1e6b1e', tc: '#7fff7f', action: 'POWER' },
            // 2. V mA LOOP — 电压/电流/回路切换
            { label: 'V mA\nLOOP', fill: '#3a3a3a', tc: '#ffffff', action: 'V_MA_LOOP' },
            // 3. 压力测量选择
            { label: 'GAS\npressure', fill: '#3a3a3a', tc: '#c3f920', action: 'PRESSURE' },
            // 4. 清零（压力模块读数清零）
            { label: 'ZERO\npressure', fill: '#3a3a3a', tc: '#00ffff', action: 'ZERO' },
            // 5. 背景灯开关
            { label: '☀', fill: '#3a3a3a', tc: '#ffee88', action: 'BACKLIGHT' },
        ];

        row1Btns.forEach((b, i) => {
            const bx = LM + i * (R1_BW + R1_GAP);
            addBtn(bx, ROW1_Y, R1_BW, BH1, b.label, b.fill, b.tc, b.action, 8 * s);
        });

        // ════════════════════════════════════════════════════════════
        //  第2排 + 第3排
        //  最左：MEAS/SOURCE 大按键（跨两排）
        //  右侧第2排：[V mA] [压力⊥] [Hz Ω]
        //  右侧第3排：[TC]   [RTD]   [°C °F]
        // ════════════════════════════════════════════════════════════
        const BIG_W = 46 * s;   // MEAS/SOURCE 大按键宽度
        const BIG_GAP = 5 * s;    // 大按键与右侧按键的间距

        // ── MEAS/SOURCE 大按键（蓝色，跨行）──────────────────────────
        const bigX = LM;
        const bigY = ROW23_Y + 5 * s;
        const bigW = BIG_W;
        const bigH = BH_BIG;

        const bigRect = new Konva.Rect({
            x: bigX, y: bigY, width: bigW, height: bigH,
            fill: '#1a4e8a', stroke: '#1a1a1a', strokeWidth: 1 * s,
            cornerRadius: 4 * s,
            shadowBlur: 3 * s, shadowColor: '#000', shadowOpacity: 0.5
        });
        bigRect.on('mousedown touchstart', (e) => {
            e.cancelBubble = true;
            this._handleButtonAction('MEAS_SOURCE');
            // 异步处理视觉反馈，避免阻塞事件处理
            Promise.resolve().then(() => {
                bigRect.fill(this._brighten('#1a4e8a'));
                this._refreshCache();
                setTimeout(() => { bigRect.fill('#1a4e8a'); this._refreshCache(); }, 50);
            });
        });
        bigRect.on('dblclick', e => { e.cancelBubble = true; });
        this.group.add(bigRect);

        // 上半行文字 "MEAS"
        const measTxt = new Konva.Text({
            x: bigX, y: bigY + 8 * s,
            text: 'MEAS',
            fontSize: 9 * s, fontFamily: 'Arial, sans-serif', fontStyle: 'bold',
            fill: '#ffffff', width: bigW, align: 'center'
        });
        measTxt.on('mousedown touchstart', (e) => {
            e.cancelBubble = true;
            this._handleButtonAction('MEAS_SOURCE');
            // 异步处理视觉反馈，避免阻塞事件处理
            Promise.resolve().then(() => {
                bigRect.fill(this._brighten('#1a4e8a'));
                this._refreshCache();
                setTimeout(() => { bigRect.fill('#1a4e8a'); this._refreshCache(); }, 50);
            });
        });
        // 中间分割线
        const bigDiv = new Konva.Line({
            points: [bigX + 4 * s, bigY + bigH / 2, bigX + bigW - 4 * s, bigY + bigH / 2],
            stroke: '#88aadd', strokeWidth: 1 * s
        });
        // 下半行文字 "SOURCE"
        const srcTxt = new Konva.Text({
            x: bigX, y: bigY + bigH / 2 + 6 * s,
            text: 'SOURCE',
            fontSize: 9 * s, fontFamily: 'Arial, sans-serif', fontStyle: 'bold',
            fill: '#ffffff', width: bigW, align: 'center'
        });
        srcTxt.on('mousedown touchstart', (e) => {
            e.cancelBubble = true;
            this._handleButtonAction('MEAS_SOURCE');
            // 异步处理视觉反馈，避免阻塞事件处理
            Promise.resolve().then(() => {
                bigRect.fill(this._brighten('#1a4e8a'));
                this._refreshCache();
                setTimeout(() => { bigRect.fill('#1a4e8a'); this._refreshCache(); }, 50);
            });
        });
        this.group.add(measTxt, bigDiv, srcTxt);

        // ── 右侧3列按键 ───────────────────────────────────────────────
        const rightStartX = LM + BIG_W + BIG_GAP;
        const rightAW = W - rightStartX - LM;
        const R23_COUNT = 3;
        const R23_GAP = 4 * s;
        const R23_BW = (rightAW - R23_GAP * (R23_COUNT - 1)) / R23_COUNT;
        const ROW3_Y = ROW23_Y + BH23 + 11 * s;

        // 第2排右侧 3个按键
        const row2RightBtns = [
            // V mA — 选择电压/毫安输出或电流模拟测量
            { label: 'V  mA', fill: '#3a3a3a', tc: '#ffff00', action: 'V_MA' },
            // 压力测量和输出功能（图标：圆形 + 双对接二极管）
            { label: 'PRESSURE', fill: '#3a3a3a', tc: '#ffff00', action: 'PRESSURE_SRC' },
            // Hz Ω — 欧姆测量和输出
            { label: 'Hz  Ω', fill: '#3a3a3a', tc: '#ffff00', action: 'HZ_OHM' },
        ];

        row2RightBtns.forEach((b, i) => {
            const bx = rightStartX + i * (R23_BW + R23_GAP);
            addBtn(bx, ROW23_Y + 5 * s, R23_BW, BH23, b.label, b.fill, b.tc, b.action, 7.5 * s, b.customDraw);
        });

        // 第3排右侧 3个按键
        const row3RightBtns = [
            { label: 'TC', fill: '#3a3a3a', tc: '#ffff00', action: 'TC' },
            { label: 'RTD', fill: '#3a3a3a', tc: '#ffff00', action: 'RTD' },
            // 摄氏/华氏切换，默认 °C 高亮
            { label: '°C  °F', fill: '#3a3a3a', tc: '#ffff00', action: 'TEMP_UNIT' },
        ];

        row3RightBtns.forEach((b, i) => {
            const bx = rightStartX + i * (R23_BW + R23_GAP);
            addBtn(bx, ROW3_Y, R23_BW, BH23, b.label, b.fill, b.tc, b.action, 7.5 * s);
        });

        // ════════════════════════════════════════════════════════════
        //  下方功能块：左列 | 中列圆形方向盘 | 右列步进
        // ════════════════════════════════════════════════════════════
        const BLK_GAP = 5 * s;

        // ── 左列：3个按键垂直排列 ─────────────────────────────────────
        const LEFT_W = 46 * s;
        const LEFT_H = BH_BLK;
        const LEFT_GAP = 6 * s;

        const leftBtns = [
            { label: 'STORE', fill: '#6d9279', tc: '#ffffff', action: 'STORE_SETUP' },
            { label: 'RECALL', fill: '#6b957b', tc: '#ffffff', action: 'RECALL' },
            { label: 'MODE', fill: '#709671', tc: '#f8f6f2', action: 'MODE_SEL' },
        ];

        // 左列顶部与方向盘顶部对齐
        const DPAD_CY = BLK_Y + 46 * s;   // 方向盘中心Y
        const LEFT_TOTAL_H = leftBtns.length * LEFT_H + (leftBtns.length - 1) * LEFT_GAP;
        const LEFT_START_Y = DPAD_CY - LEFT_TOTAL_H / 2;

        leftBtns.forEach((b, i) => {
            const bx = LM + 5 * s;
            const by = LEFT_START_Y - 20 + i * (LEFT_H + LEFT_GAP + 20);
            addBtn(bx, by, LEFT_W, LEFT_H + 5 * s, b.label, b.fill, b.tc, b.action, 7 * s);
        });

        // ── 中列：圆形方向盘 ──────────────────────────────────────────
        // 整体圆盘背景
        const DPAD_R = 38 * s;
        const DPAD_CX = LM + LEFT_W + BLK_GAP + DPAD_R + 30 * s;

        const dpadBg = new Konva.Circle({
            x: DPAD_CX, y: DPAD_CY - 5 * s,
            radius: DPAD_R,
            fill: '#222', stroke: '#444', strokeWidth: 2 * s
        });
        this.group.add(dpadBg);

        // 4个方向按键（扇形触发区用矩形热区 + 箭头符号）
        const ARROW_SIZE = 18 * s;   // 箭头热区尺寸
        const ARROW_OFF = DPAD_R * 0.65;  // 偏移距离

        const arrowBtns = [
            { label: '▲', dx: 0, dy: -ARROW_OFF, action: 'UP' },
            { label: '▼', dx: 0, dy: ARROW_OFF, action: 'DOWN' },
            { label: '◄', dx: -ARROW_OFF, dy: 0, action: 'LEFT' },
            { label: '►', dx: ARROW_OFF, dy: 0, action: 'RIGHT' },
        ];

        arrowBtns.forEach(a => {
            const ax = DPAD_CX + a.dx - ARROW_SIZE / 2;
            const ay = DPAD_CY - 5 * s + a.dy - ARROW_SIZE / 2;
            const arrowTxt = new Konva.Text({
                x: ax, y: ay + (ARROW_SIZE - 11 * s) / 2 - 2 * s,
                text: a.label, fontSize: 15 * s,
                fontFamily: 'Arial, sans-serif', fill: '#ffffff',
                width: ARROW_SIZE, align: 'center'
            });
            const arrowRect = new Konva.Rect({
                x: ax, y: ay, width: ARROW_SIZE, height: ARROW_SIZE,
                fill: 'transparent'
            });

            arrowRect.on('mousedown touchstart', (e) => {
                e.cancelBubble = true;
                this._handleButtonAction(a.action);
                // 异步处理视觉反馈，避免阻塞事件处理
                Promise.resolve().then(() => {
                    arrowTxt.fill('#ffcc44');
                    this._refreshCache();
                    setTimeout(() => { arrowTxt.fill('#ffffff'); this._refreshCache(); }, 50);
                });
            });
            arrowRect.on('dblclick', e => { e.cancelBubble = true; });
            this.group.add(arrowTxt, arrowRect);
        });

        // 中心小圆
        const dpadCenter = new Konva.Circle({
            x: DPAD_CX, y: DPAD_CY - 5 * s,
            radius: DPAD_R * 0.28,
            fill: '#333', stroke: '#555', strokeWidth: 1 * s
        });
        this.group.add(dpadCenter);

        // ── 右列：4个步进按键 ──────────────────────────────────────────
        const RIGHT_W = 44 * s;
        const RIGHT_H = BH_BLK;
        const RIGHT_GAP = 6 * s;
        const RIGHT_X = W - LM - RIGHT_W;

        const rightBtns = [
            { label: '100%', fill: '#2e2e2e', tc: '#00ffff', action: 'STEP_100' },
            { label: '▲ 25%', fill: '#2e2e2e', tc: '#00ffff', action: 'STEP_UP25' },
            { label: '▼ 25%', fill: '#2e2e2e', tc: '#00ffff', action: 'STEP_DN25' },
            { label: '0%', fill: '#2e2e2e', tc: '#00ffff', action: 'STEP_0' },
        ];

        const RIGHT_TOTAL_H = rightBtns.length * RIGHT_H + (rightBtns.length - 1) * RIGHT_GAP;
        const RIGHT_START_Y = DPAD_CY - RIGHT_TOTAL_H / 2;

        rightBtns.forEach((b, i) => {
            const by = RIGHT_START_Y + i * (RIGHT_H + RIGHT_GAP);
            addBtn(RIGHT_X - 10, by, RIGHT_W, RIGHT_H, b.label, b.fill, b.tc, b.action, 8 * s);
        });

    }

    /**
     * 构建顶部气路接口（模拟FLUKE726内部集成压力模块）
     * 当处于输入模式时，显示气压
     * 当处于输出模式时，控制输出气压的大小
     */
    _buildPressurePort(cx, s, W) {
        // 气路接口位置：顶部品牌条下方，居中
        const portY = 48 * s;
        const portRadius = 8 * s;

        // 管道连接处 - 上方导管
        const tubePipe = new Konva.Rect({
            x: cx - 5 * s, y: 30 * s,
            width: 10 * s, height: 16 * s,
            fill: '#888',
            stroke: '#444',
            strokeWidth: 1 * s,
            cornerRadius: 1 * s
        });
        this.group.add(tubePipe);

        // 接头底座（喇叭形）
        const connectorBase = new Konva.Polygon({
            points: [
                cx - 12 * s, portY,
                cx - 6 * s, portY + 10 * s,
                cx + 6 * s, portY + 10 * s,
                cx + 12 * s, portY
            ],
            fill: '#cc8800',
            stroke: '#665500',
            strokeWidth: 2 * s
        });
        this.group.add(connectorBase);

        // 内部孔 - 红色(输入)或蓝色(输出)
        this.pressurePortCircle = new Konva.Circle({
            x: cx, y: portY + 4 * s,
            radius: portRadius,
            fill: '#ff4444',  // 默认红色（输入模式）
            stroke: '#000',
            strokeWidth: 1.5 * s
        });
        this.group.add(this.pressurePortCircle);

        // 内孔
        const innerHole = new Konva.Circle({
            x: cx, y: portY + 4 * s,
            radius: portRadius * 0.6,
            fill: '#1a1a1a',
            stroke: '#333',
            strokeWidth: 1 * s
        });
        this.group.add(innerHole);

        // 接口标签（可交互，显示/隐藏压力值）
        this.pressurePortLabel = new Konva.Text({
            x: cx - 20 * s, y: portY + 12 * s,
            text: 'P',
            fontSize: 10 * s,
            fontFamily: 'Arial, sans-serif',
            fontStyle: 'bold',
            fill: '#fff'
        });
        this.group.add(this.pressurePortLabel);

        // 压力值显示（在接口下方，小字体）
        this.pressurePortValue = new Konva.Text({
            x: cx - 28 * s, y: portY + 22 * s,
            text: 'kPa: 0.0',
            fontSize: 8 * s,
            fontFamily: 'Arial, sans-serif',
            fill: '#ffff00'
        });
        this.group.add(this.pressurePortValue);
    }

    /**
     * 构建底部接线端口及标签
     * SOURCE 侧（左）: mA | V·Ω·RTD | TC | COM
     * MEASURE 侧（右）: mA(LOOP) | COM
     */
    _buildJackLabels(s, W, H) {
        // 区域标签
        const srcAreaLabel = new Konva.Text({
            x: 48 * s, y: H - 78 * s,
            text: 'SOURCE / MEASURE',
            fontSize: 8 * s, fontFamily: 'Arial, sans-serif', fill: '#19fe15'
        });
        const measAreaLabel = new Konva.Text({
            x: W * 0.72, y: H - 78 * s,
            text: 'MEASURE',
            fontSize: 8 * s, fontFamily: 'Arial, sans-serif', fill: '#0cf56d'
        });
        this.group.add(srcAreaLabel, measAreaLabel);

        // 端口定义 [label, x_ratio, color]
        const ports = [
            { label: 'mA', xr: 0.08, fill: '#c00' },
            { label: 'V·Ω·Hz\nRTD', xr: 0.25, fill: '#c00' },
            { label: 'TC', xr: 0.42, fill: '#c00' },
            { label: 'COM', xr: 0.56, fill: '#222' },
            { label: 'V · mA\nLOOP', xr: 0.74, fill: '#c00' },
            { label: 'COM', xr: 0.90, fill: '#222' },
        ];

        const jackRadius = 10 * s;
        const jackY = H - 30 * s;

        ports.forEach(p => {
            const x = W * p.xr;
            const jack = new Konva.Circle({
                x, y: jackY,
                radius: jackRadius,
                fill: p.fill,
                stroke: '#111', strokeWidth: 2.5 * s
            });
            const inner = new Konva.Circle({
                x, y: jackY,
                radius: jackRadius * 0.55,
                fill: '#1a1a1a', stroke: '#333', strokeWidth: 2 * s
            });
            const lines = p.label.split('\n');
            const lbl = new Konva.Text({
                x: x - 18 * s, y: jackY - jackRadius - 18 * s,
                text: p.label,
                fontSize: 8 * s,
                fontFamily: 'Arial, sans-serif',
                fill: '#ccc',
                width: 36 * s, align: 'center'
            });
            this.group.add(jack, inner, lbl);
        });

        // 分隔竖线（SOURCE / MEASURE 分界）
        const divX = W * 0.63;
        const divLine = new Konva.Line({
            points: [divX, H - 70 * s, divX, H - 10 * s],
            stroke: '#555', strokeWidth: 1 * s, dash: [3, 2]
        });
        this.group.add(divLine);
    }

    _addPorts() {
        const W = this.width;
        const H = this.height;
        const s = this.scale;
        const jackY = H - 30 * s;

        const portDefs = [
            { xr: 0.08, name: 'src_ma', type: 'wire', polarity: 'p' },
            { xr: 0.25, name: 'src_v', type: 'wire', polarity: 'p' },
            { xr: 0.42, name: 'src_tc', type: 'wire', polarity: 'p' },
            { xr: 0.56, name: 'src_com', type: 'wire', polarity: 'n' },
            { xr: 0.74, name: 'meas_ma', type: 'wire', polarity: 'p' },
            { xr: 0.90, name: 'meas_com', type: 'wire', polarity: 'n' },
        ];

        portDefs.forEach(p => {
            const x = W * p.xr;
            this.addPort(x, jackY, p.name, p.type, p.polarity);
        });

        // 顶部气路接口（模拟压力模块）
        const pressurePortY = 52 * s;  // 品牌条下方
        this.addPort(W / 2, pressurePortY, 'pressure_in', 'pipe', 'in');
        this.addPort(W / 2, pressurePortY, 'pressure_out', 'pipe', 'out');
    }

    // ═══════════════════════════════════════════════════════════════════
    //  按键响应逻辑
    // ═══════════════════════════════════════════════════════════════════

    _handleButtonAction(action) {
        switch (action) {

            // ── 第1排 ────────────────────────────────────────────────
            case 'POWER':
                // 电源开关
                this.isPowered = !this.isPowered;
                if (!this.isPowered) {
                    this.lcdMeasValue.text('');
                    this.lcdMeasUnit.text('');
                    this.lcdSrcValue.text('');
                    this.lcdSrcUnit.text('');
                    this.lcdSrcAux.text('');
                    this.lcdPercentError.text('');
                    this.lcdBg.fill('#000000');
                    this._refreshCache();
                } else {
                    this._backlightOn = true;  // 默认开机背光开启
                    this.lcdBg.fill('#cadcb0');
                    this._refreshDisplay();
                }
                break;

            case 'V_MA_LOOP':
                // 电压/电流/回路 三态循环切换（测量侧）
                if (this.upMode === 'MEAS_MA') this.upMode = 'MEAS_LOOP';
                else if (this.upMode === 'MEAS_V') this.upMode = 'MEAS_MA';
                else this.upMode = 'MEAS_V';
                this._refreshDisplay();
                break;

            case 'PRESSURE':
                // 压力测量选择（切换到外接压力模块读数）
                this.upMode = 'MEAS_PRESSURE';
                this._refreshDisplay();
                break;

            case 'ZERO':
                // 压力模块读数清零（记录当前值为零偏）
                if (this.upMode === 'MEAS_PRESSURE') this.upZeroOffset = this.upValue;
                this._refreshDisplay();
                break;

            case 'BACKLIGHT':
                // 背景灯开关
                this._backlightOn = !this._backlightOn;
                if (this.isPowered) {
                    this.lcdBg.fill(this._backlightOn ? '#cadcb0' : '#a1b389');
                    this._refreshCache();
                }
                break;

            case 'MEAS_SOURCE':
                // 切换激活面板（MEASURE ↔ SOURCE）
                this.activePanel = (this.activePanel === 'MEASURE') ? 'SOURCE' : 'MEASURE';
                this.measureMode = 'MEAS_V';  // 切换到测量面板时默认电压测量
                this.sourceMode = 'SRC_V';  // 切换到源输出面板时默认电流输出
                this._resetSourceValueToMin();
                this._refreshDisplay();
                break;

            case 'V_MA':
                // 电压/毫安切换
                if (this.activePanel === 'SOURCE') {
                    if (this.sourceMode === 'SRC_MA') this.sourceMode = 'SRC_LOOP';
                    else if (this.sourceMode === 'SRC_V') this.sourceMode = 'SRC_MA';
                    else this.sourceMode = 'SRC_V';
                    this._resetSourceValueToMin();  // 切换档位时重置为最小值
                } else {
                    if (this.measureMode === 'MEAS_MA') this.measureMode = 'MEAS_LOOP';
                    else if (this.measureMode === 'MEAS_V') this.measureMode = 'MEAS_MA';
                    else this.measureMode = 'MEAS_V';
                }
                this._refreshDisplay();
                break;

            case 'PRESSURE_SRC':
                // 压力测量和输出功能
                if (this.activePanel === 'SOURCE') {
                    this.sourceMode = 'SRC_PRESSURE';
                    this._resetSourceValueToMin();  // 切换档位时重置为最小值
                } else this.measureMode = 'MEAS_PRESSURE';
                this._refreshDisplay();
                break;

            case 'HZ_OHM':
                // Hz/欧姆 组合按键
                if (this.activePanel === 'SOURCE') {
                    const newMode = (this.sourceMode === 'SRC_HZ') ? 'SRC_RES' : 'SRC_HZ';
                    this.sourceMode = newMode;
                    this._resetSourceValueToMin();  // 切换档位时重置为最小值
                } else {
                    this.measureMode = (this.measureMode === 'MEAS_RES') ? 'MEAS_HZ' : 'MEAS_RES';
                }
                this._refreshDisplay();
                break;

            case 'TC':
                // 热电偶功能
                if (this.activePanel === 'SOURCE') {
                    this.sourceMode = 'SRC_TC';
                    this._resetSourceValueToMin();  // 切换档位时重置为最小值
                } else this.measureMode = 'MEAS_TC';
                this._refreshDisplay();
                break;

            case 'RTD':
                // RTD 功能
                if (this.activePanel === 'SOURCE') {
                    this.sourceMode = 'SRC_RTD';
                    this._resetSourceValueToMin();  // 切换档位时重置为最小值
                } else this.measureMode = 'MEAS_RTD';
                this._refreshDisplay();
                break;

            case 'TEMP_UNIT':
                // °C / °F 切换
                this.tempUnit = (this.tempUnit === '°C') ? '°F' : '°C';
                this._refreshDisplay();
                break;

            case 'STORE_SETUP':
            case 'RECALL':
            case 'MODE_SEL':
                // 占位：可扩展为弹出配置对话框
                break;

            case 'UP':
                this._adjustSourceValue(+1);
                break;

            case 'DOWN':
                this._adjustSourceValue(-1);
                break;

            case 'LEFT':
                this._moveCursor(-1);
                break;

            case 'RIGHT':
                this._moveCursor(+1);
                break;

            case 'STEP_100':
                this._applyStepPercent(100);
                break;

            case 'STEP_UP25':
                this._stepSourceByPercent(+25);
                break;

            case 'STEP_DN25':
                this._stepSourceByPercent(-25);
                break;

            case 'STEP_0':
                this._applyStepPercent(0);
                break;

            default:
                break;
        }
        this._refreshCache();
    }

    // ═══════════════════════════════════════════════════════════════════
    //  源输出调整
    // ═══════════════════════════════════════════════════════════════════

    /**
     * 将源输出设置为量程的指定百分比
     * 各档位量程定义（0%~100% 对应范围）：
     *   SRC_MA  → 4~20 mA（NAMUR 4-20mA 标准）
     *   SRC_V   → 0~10 V
     *   SRC_RES → 0~10000 Ω
     *   SRC_HZ  → 0~1000 Hz
     *   SRC_TC  → 依热电偶类型（此处默认 K: -200~1372 °C）
     *   SRC_RTD → 依 Pt100: -200~850 °C
     */
    _applyStepPercent(pct) {
        const { lo, hi } = this._getSourceRange();
        this.sourceValue = lo + (hi - lo) * pct / 100;
        this._refreshDisplay();
    }

    /**
     * 切换源输出档位时，重置为新档位的最小值
     * 用于提高操作效率，避免保留上一档位的数值
     */
    _resetSourceValueToMin() {
        const { lo } = this._getSourceRange();
        this.sourceValue = lo;
    }

    _stepSourceByPercent(deltaPct) {
        const { lo, hi } = this._getSourceRange();
        const delta = (hi - lo) * Math.abs(deltaPct) / 100;
        this.sourceValue = Math.min(hi, Math.max(lo, this.sourceValue + (deltaPct > 0 ? delta : -delta)));
        this._refreshDisplay();
    }

    _adjustSourceValue(dir) {
        // 按最小分辨率调整
        const step = this._getSourceStep();
        this.sourceValue += dir * step;
        const { lo, hi } = this._getSourceRange();
        this.sourceValue = Math.min(hi, Math.max(lo, this.sourceValue));
        this._refreshDisplay();
    }

    _moveCursor(direction) {
        const config = STEP_CONFIG[this.sourceMode];
        if (!config) return;

        // 初始化索引（如果尚未定义）
        if (this._currentStepIdx === undefined) {
            this._currentStepIdx = config.defaultIdx;
        }

        // 计算新索引：LEFT (-1) 让索引增加(更大步进)，RIGHT (+1) 让索引减少(更小步进)
        // 注意：这里根据你的操作习惯决定，通常 LEFT 是移动到更高位
        let nextIdx = this._currentStepIdx - direction;

        // 边界检查：确保索引不越界
        if (nextIdx >= 0 && nextIdx < config.steps.length) {
            this._currentStepIdx = nextIdx;
        }
    }

    _getSourceRange() {
        switch (this.sourceMode) {
            case 'SRC_MA': return { lo: 4.0, hi: 20.0 };
            case 'SRC_LOOP': return { lo: 4.0, hi: 20.0 };
            case 'SRC_V': return { lo: 0.0, hi: 10.0 };
            case 'SRC_RES': return { lo: 0.0, hi: 10000 };
            case 'SRC_HZ': return { lo: 0.0, hi: 1000 };
            case 'SRC_TC': return { lo: -200.0, hi: 1372.0 }; // K型
            case 'SRC_RTD': return { lo: -200.0, hi: 850.0 }; // Pt100
            case 'SRC_PRESSURE': return { lo: 0.0, hi: 100.0 }; // kPa
            default: return { lo: 0.0, hi: 100.0 };
        }
    }

    _getSourceStep() {
        const config = STEP_CONFIG[this.sourceMode];
        if (!config) return 1.0;

        // 如果没有手动移动过，返回该模式的默认初始值
        if (this._currentStepIdx === undefined) {
            return config.steps[config.defaultIdx];
        }

        return config.steps[this._currentStepIdx];
    }

    // ═══════════════════════════════════════════════════════════════════
    //  百分比误差计算
    // ═══════════════════════════════════════════════════════════════════

    /**
     * 计算 %Error（测量值相对于源输出值的误差百分比）
     * %Error = (measured - source) / span × 100
     */
    _calcPercentError() {
        const { lo, hi } = this._getSourceRange();
        const span = hi - lo;
        if (Math.abs(span) < 1e-9) return 0;
        return ((this.measureValue - this.sourceValue) / span) * 100;
    }

    // ═══════════════════════════════════════════════════════════════════
    //  显示刷新
    // ═══════════════════════════════════════════════════════════════════

    _refreshDisplay() {
        if (!this.isPowered) {
            //关闭液晶屏，显示黑色背景
            if (this.lcdBg) {
                this.lcdBg.fill('#000000');
                this._refreshCache();
            }
            return;
        }


        // ── 上行：测量值 ────────────────────────────────────────────
        let upStr, upUnit;
        const upmv = this.upValue - (this.upZeroOffset || 0);

        switch (this.upMode) {
            case 'MEAS_MA':
                upStr = upmv.toFixed(2);
                upUnit = 'mA';
                break;
            case 'MEAS_V':
                upStr = upmv.toFixed(2);
                upUnit = 'V';
                break;
            case 'MEAS_LOOP':
                // 回路电流（带供电）
                upStr = upmv.toFixed(2);
                upUnit = 'LOOP';
                break;
            case 'MEAS_PRESSURE':
                upStr = upmv.toFixed(1);
                upUnit = 'kPa';
                break;
            default:
                upStr = '----';
                upUnit = '';
        }
        this.lcdMeasValue.text(upStr);
        this.lcdMeasUnit.text(upUnit);

        // ── 下行：根据 activePanel 显示测量值或输出值 ─────────────────
        let srcLabel, srcStr, srcUnit, srcAux;
        const mv = this.measureValue - (this.measureZeroOffset || 0);
        if (this.activePanel === 'MEASURE') {
            // MEASURE 模式：显示左边4个接线柱的测量结果
            srcLabel = 'MEASURE';

            // 根据第一排和第二排的按钮选择显示对应的测量值
            // 优先级：按钮选择的档位
            switch (this.measureMode) {
                case 'MEAS_MA':
                    srcStr = mv.toFixed(2);
                    srcUnit = 'mA';
                    break;
                case 'MEAS_LOOP':
                    srcStr = mv.toFixed(2);
                    srcUnit = 'mA LOOP';
                    break;
                case 'MEAS_V':
                    srcStr = mv.toFixed(2);
                    srcUnit = 'V';
                    break;
                case 'MEAS_RES':
                    srcStr = mv.toFixed(1);
                    if (srcStr === 'Infinity') srcStr = 'O.L'
                    srcUnit = 'Ω';
                    break;
                case 'MEAS_HZ':
                    srcStr = mv.toFixed(1);
                    if (srcStr === 'NaN') srcStr = 'O.L'
                    srcUnit = 'Hz';
                    break;
                case 'MEAS_TC':
                    srcStr = mv.toFixed(1);
                    srcUnit = this.tempUnit;
                    srcAux = this.tcType;
                    break;
                case 'MEAS_RTD':
                    srcStr = mv.toFixed(1);
                    if (srcStr === 'Infinity') srcStr = 'O.L'
                    srcUnit = this.tempUnit;
                    srcAux = this.rtdType;
                    break;
                case 'MEAS_PRESSURE':
                    srcStr = mv.toFixed(1);
                    srcUnit = 'kPa';
                    break;
                default:
                    srcStr = '---';
                    srcUnit = '';
                    srcAux = '';
            }
        } else {
            // SOURCE 模式：显示左边4个接线柱的输出参数
            srcLabel = 'SOURCE';

            switch (this.sourceMode) {
                case 'SRC_MA':
                    srcStr = this.sourceValue.toFixed(2);
                    srcUnit = 'mA';
                    srcAux = '';
                    break;
                case 'SRC_LOOP':
                    srcStr = this.sourceValue.toFixed(2);
                    srcUnit = 'mA LOOP';
                    srcAux = '';
                    break;
                case 'SRC_V':
                    srcStr = this.sourceValue.toFixed(2);
                    srcUnit = 'V';
                    srcAux = '';
                    break;
                case 'SRC_RES':
                    srcStr = this.sourceValue.toFixed(1);
                    srcUnit = 'Ω';
                    srcAux = '';
                    break;
                case 'SRC_HZ':
                    srcStr = this.sourceValue.toFixed(1);
                    srcUnit = 'Hz';
                    srcAux = '';
                    break;
                case 'SRC_TC':
                    srcStr = this.sourceValue.toFixed(1);
                    srcUnit = this.tempUnit;
                    srcAux = this.tcType + '\n' + (this.sourceValue * 0.041).toFixed(2);
                    break;
                case 'SRC_RTD':
                    srcStr = this.sourceValue.toFixed(1);
                    srcUnit = this.tempUnit;
                    srcAux = this.rtdType + '\n' + Math.round(this._tempToRTDOhm(this.sourceValue));
                    break;
                case 'SRC_PRESSURE':
                    srcStr = this.sourceValue.toFixed(1);
                    srcUnit = 'kPa';
                    srcAux = '';
                    break;
                default:
                    srcStr = '---';
                    srcUnit = '';
                    srcAux = '';
            }
        }

        // 更新下排液晶显示
        this.srcLabel.text(srcLabel);
        this.lcdSrcValue.text(srcStr);
        this.lcdSrcUnit.text(srcUnit);
        this.lcdSrcAux.text(srcAux);

        // ── %Error ─────────────────────────────────────────────────
        if (this.showPercent && this.sourceMode !== 'SRC_OFF') {
            const pct = this._calcPercentError();
            this.lcdPercentError.text('%Err: ' + pct.toFixed(2) + '%');
        } else {
            this.lcdPercentError.text('');
        }

        // ── 更新顶部气路接口显示 ────────────────────────────────────
        this._updatePressurePortDisplay();

        this._refreshCache();
    }

    /**
     * 更新顶部气路接口的颜色和显示值
     * 当 sourceMode === 'SRC_PRESSURE' 时：输出模式（蓝色），显示输出气压值
     * 当 measureMode === 'MEAS_PRESSURE' 时：输入模式（红色），显示测量气压值
     */
    _updatePressurePortDisplay() {
        if (!this.pressurePortCircle || !this.pressurePortValue) return;

        let displayValue = 0;
        let isOutputMode = false;

        // 判断当前模式
        if (this.activePanel === 'SOURCE' && this.sourceMode === 'SRC_PRESSURE') {
            // 输出模式：显示源输出的气压值
            isOutputMode = true;
            displayValue = this.sourceValue;
            this.pressureMode = 'OUTPUT';
        } else if (this.activePanel === 'MEASURE' && this.measureMode === 'MEAS_PRESSURE') {
            // 输入模式：显示测量的气压值
            isOutputMode = false;
            displayValue = this.measureValue - (this.pressureZeroOffset || 0);
            this.pressureMode = 'INPUT';
        } else {
            // 非气压模式：显示为灰色
            this.pressurePortCircle.fill('#888888');
            this.pressurePortValue.text('P: --');
            return;
        }

        // 更新接口颜色：输入红色，输出蓝色
        const portColor = isOutputMode ? '#4488ff' : '#ff4444';
        this.pressurePortCircle.fill(portColor);

        // 更新显示值
        const displayStr = displayValue.toFixed(1);
        this.pressurePortValue.text(`P: ${displayStr} kPa`);
    }

    /**
     * Pt100 温度转电阻（简化 Callendar-Van Dusen，适用 0~850°C）
     * R(T) = R0 * (1 + A*T + B*T²)
     */
    _tempToRTDOhm(T) {
        const R0 = 100.0;
        const A = 3.9083e-3;
        const B = -5.775e-7;
        if (T >= 0) return R0 * (1 + A * T + B * T * T);
        // 低温段简化
        const C = -4.183e-12;
        return R0 * (1 + A * T + B * T * T + C * (T - 100) * T * T * T);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  辅助工具
    // ═══════════════════════════════════════════════════════════════════

    _brighten(hex) {
        // 简单提亮颜色用于按键点击反馈
        try {
            const n = parseInt(hex.replace('#', ''), 16);
            const r = Math.min(255, ((n >> 16) & 0xff) + 60);
            const g = Math.min(255, ((n >> 8) & 0xff) + 60);
            const b = Math.min(255, (n & 0xff) + 60);
            return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
        } catch (e) { return hex; }
    }

    // ═══════════════════════════════════════════════════════════════════
    //  公共 update 接口（供仿真引擎调用）
    // ═══════════════════════════════════════════════════════════════════

    /**
     * 更新测量输入值（由外部信号驱动）
     * @param {number} val  输入到测量端口的物理量（mA 或 V）
     */
    update(val1, val2) {
        this.upValue = val1;
        this.measureValue = val2;

        const now = performance.now();
        const elapsed = now - (this._lastUpdateAt || 0);

        if (elapsed < this._displayThrottle) {
            this._pendingValue1 = val1;
            this._pendingValue2 = val2;
            if (!this._pendingTimer) {
                const wait = Math.max(1, this._displayThrottle - elapsed);
                this._pendingTimer = setTimeout(() => {
                    this._pendingTimer = null;
                    try { this.update(this._pendingValue1, this._pendingValue2); } catch (e) { }
                }, wait);
            }
            return;
        }

        this._lastUpdateAt = now;
        this._pendingValue1 = null;
        this._pendingValue2 = null;
        if (!this.isPowered) return;

        this._refreshDisplay();
    }

    /**
     * 设置源输出值（由上层逻辑写入）
     * @param {number} val     目标值
     * @param {string} [mode]  可选：同时切换 sourceMode
     */
    setSource(val, mode) {
        if (mode) this.sourceMode = mode;
        const { lo, hi } = this._getSourceRange();
        this.sourceValue = Math.min(hi, Math.max(lo, val));
        this._refreshDisplay();
    }
    /**
     * 设置热电偶类型
     * @param {'J'|'K'|'T'|'E'|'R'|'S'|'B'|'N'} type
     */
    setTCType(type) {
        this.tcType = type;
        if (this.sourceMode === 'SRC_TC') this._refreshDisplay();
    }

    /**
     * 设置 RTD 类型
     * @param {'Pt100'|'Pt200'|'Ni120'} type
     */
    setRTDType(type) {
        this.rtdType = type;
        if (this.sourceMode === 'SRC_RTD') this._refreshDisplay();
    }

    /**
     * 切换温度单位
     * @param {'°C'|'°F'} unit
     */
    setTempUnit(unit) {
        this.tempUnit = unit;
        this._refreshDisplay();
    }

    /**
     * 启用/禁用 %Error 显示
     * @param {boolean} show
     */
    setShowPercent(show) {
        this.showPercent = show;
        this._refreshDisplay();
    }

    /**
     * 获取当前源输出值（供外部读取）
     */
    getSourceValue(currentTime) {
        if (this.activePanel === 'SOURCE' && this.sourceMode === 'SRC_HZ') {
            const frequency = this.sourceValue;
            const omega = 2 * Math.PI * frequency;
            const v = Math.sin(omega * currentTime);
            const retValue = (v>0)?5:0;
            return retValue;
        }
        else {
            return this.sourceValue;
        }

    }

    /**
     * 获取当前测量值（供外部读取）
     */
    getMeasureValue() {
        return this.measureValue;
    }

    getUpValue() {
        return this.upValue;
    }

    // ═══════════════════════════════════════════════════════════════════
    //  气路模块公共接口
    // ═══════════════════════════════════════════════════════════════════

    /**
     * 获取当前气压输出值（供外部读取）
     * 仅在 SOURCE 模式且 sourceMode === 'SRC_PRESSURE' 时有效
     */
    getPressureOutputValue() {
        if (this.activePanel === 'SOURCE' && this.sourceMode === 'SRC_PRESSURE') {
            return this.sourceValue;
        }
        return 0;
    }

    /**
     * 获取当前气压输入值（供外部读取）
     * 仅在 MEASURE 模式且 measureMode === 'MEAS_PRESSURE' 时有效
     */
    getPressureInputValue() {
        if (this.activePanel === 'MEASURE' && this.measureMode === 'MEAS_PRESSURE') {
            return this.measureValue - (this.pressureZeroOffset || 0);
        }
        return 0;
    }

    /**
     * 设置气压输出值（用于程序控制）
     * @param {number} value   目标气压值 (kPa)
     */
    setPressureOutput(value) {
        const { lo, hi } = this.pressureRange;
        this.sourceValue = Math.min(hi, Math.max(lo, value));
        if (this.activePanel === 'SOURCE' && this.sourceMode === 'SRC_PRESSURE') {
            this._refreshDisplay();
        }
    }

    /**
     * 设置内部压力模块为输出模式并输出指定气压
     * @param {number} pressure   目标气压值 (kPa)
     */
    setPressureSourceMode(pressure) {
        this.activePanel = 'SOURCE';
        this.sourceMode = 'SRC_PRESSURE';
        this._resetSourceValueToMin();
        this.setPressureOutput(pressure);
    }

    /**
     * 设置内部压力模块为输入模式
     */
    setPressureMeasureMode() {
        this.activePanel = 'MEASURE';
        this.measureMode = 'MEAS_PRESSURE';
        this._refreshDisplay();
    }

    /**
     * 获取气压模块当前模式
     * @returns {'INPUT'|'OUTPUT'}
     */
    getPressureMode() {
        return this.pressureMode;
    }

    /**
     * 获取气压接口是否可用
     */
    isPressureModuleEnabled() {
        return this.pressureModuleEnabled;
    }
}
