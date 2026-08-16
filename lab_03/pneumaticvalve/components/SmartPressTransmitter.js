/**
 * SmartPressTransmitter.js
 * 智能压力变送器仿真组件
 * 外形参照罗斯蒙特 3051 系列，支持 HART 协议操作
 *
 * 功能：
 *   - 标准 4-20mA 两线制输出
 *   - HART 协议叠加通信（FSK 调制模拟）
 *   - LCD 显示：PV / AO / 百分比 / 诊断信息
 *   - 零点/量程本地按键调整（LRV/URV）
 *   - 量程调整：通过 HART 命令写入
 *   - 阻尼调整：通过配置对话框
 *   - 故障诊断：开路/短路/量程超限告警
 *   - HART 变量：PV, SV, TV, QV（4个过程变量）
 */
import { BaseComponent } from './BaseComponent.js';

// ── HART 命令模拟表 ──────────────────────────────────────────────────────────
const HART_COMMANDS = {
    0:  'Read Unique Identifier',
    1:  'Read Primary Variable',
    2:  'Read Current and Percent Range',
    3:  'Read Dynamic Variables and Current',
    6:  'Write Polling Address',
    11: 'Read Unique Identifier By Tag',
    12: 'Read Message',
    13: 'Read Tag/Descriptor/Date',
    14: 'Read Primary Variable Transducer Info',
    15: 'Read Device Information',
    16: 'Read Final Assembly Number',
    17: 'Write Message',
    18: 'Write Tag/Descriptor/Date',
    35: 'Write Primary Variable Range',
    36: 'Set Primary Variable Upper Range',
    37: 'Set Primary Variable Lower Range',
    38: 'Reset Configuration Changed Flag',
    40: 'Enter/Exit Fixed Current Mode',
    43: 'Set Primary Variable Zero',
    44: 'Write Primary Variable Units',
    45: 'Trim DAC Gain',
    46: 'Trim DAC Zero',
};

// ── LCD 显示模式 ─────────────────────────────────────────────────────────────
const LCD_MODES = ['PV', 'AO', 'PCT', 'BAR'];

export class SmartPressTransmitter extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        this.scale = 1.2;

        // ── 外形尺寸（参照 Rosemount 3051 比例）────────────────────────
        this.width  = Math.max(150, Math.min(config.width  || 150, 210));
        this.height = Math.max(200, Math.min(config.height || 200, 260));

        // ── 设备类型标识 ─────────────────────────────────────────────────
        this.type    = 'transmitter_2wire';
        this.special = 'press';
        this.cache   = 'fixed';

        // ── 量程配置（LRV/URV）──────────────────────────────────────────
        this.min     = parseFloat(config.min)  || 0;
        this.max     = parseFloat(config.max)  || 100;
        this.unit    = config.unit || 'kPa';
        this.damping = parseFloat(config.damping) || 0.5;  // 阻尼时间常数（秒）

        // ── 过程变量（HART 4变量）──────────────────────────────────────
        this.press   = 0;     // PV  - 一次变量（压力）
        this.pvFilt  = 0;     // 阻尼滤波后的 PV
        this.ao      = 4.0;   // AO  - 模拟输出（mA）
        this.pct     = 0.0;   // SV  - 量程百分比
        this.temp    = 25.0;  // TV  - 壳体温度（模拟）
        this.sensorP = 0.0;   // QV  - 传感器差压

        // ── 本地调零/量程旋钮 ────────────────────────────────────────────
        this.zeroAdj = 0;
        this.spanAdj = 1.0;

        // ── 故障标志 ─────────────────────────────────────────────────────
        this.isBreak   = false;   // 硬件开路
        this.isSat     = false;   // 饱和标志

        // ── HART 通信状态 ─────────────────────────────────────────────────
        this.hartEnabled    = true;
        this.hartAddress    = 0;                       // 轮询地址
        this.hartTag        = config.tag || this.id;   // 位号
        this.hartDesc       = config.desc || '';       // 描述
        this.hartDate       = '2025-01-01';
        this.hartMsg        = 'Smart Press Transmitter';
        this.hartMfr        = 'Rosemount';
        this.hartModel      = '3051';
        this.hartFirmware   = '1.0.0';
        this.hartSerial     = Math.floor(Math.random() * 1e8).toString().padStart(8, '0');
        this._cfgChanged    = false;

        // ── HART 通信面板状态 ─────────────────────────────────────────────
        this._hartPanelOpen = false;
        this._hartLog       = [];      // 通信记录（最多 50 条）
        this._hartCmdInput  = '';
        this._fixedCurrentMode = false;
        this._fixedCurrent     = 4.0;

        // ── LCD 显示状态 ─────────────────────────────────────────────────
        this._lcdModeIdx   = 0;        // 当前 LCD 显示模式索引
        this._lcdMode      = LCD_MODES[0];
        this._lcdLastBlink = 0;
        this._lcdBlinkOn   = true;

        // ── 配置对象 ─────────────────────────────────────────────────────
        this.config = {
            id: this.id, tag: this.hartTag,
            min: this.min, max: this.max,
            unit: this.unit, damping: this.damping
        };

        // ── 构建 UI ──────────────────────────────────────────────────────
        this.knobs = {};
        this._init();

        // ── 管路接口与电气端口 ───────────────────────────────────────────
        // 底部管嘴（高压侧）
        this.addPort(this.width/ 2, this.height , 'in', 'pipe', 'in');
        // 接线端子（顶部）
        this.addPort(this.width , 18, 'p', 'wire', 'p');
        this.addPort(this.width , 46, 'n', 'wire');

        // ── LCD 双击切换显示模式 ─────────────────────────────────────────
        this.lcdBg && this.lcdBg.on('dblclick', (e) => {
            e.cancelBubble = true;
            this._cycleLcdMode();
        });
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  初始化
    // ═══════════════════════════════════════════════════════════════════════
    _init() {
        this.sg = new Konva.Group({scalex: this.scale, scaley: this.scale});
        this.group.add(this.sg);
        this._drawEnclosure();
        this._drawLCD();
        this._drawButtons();
    }

    _drawEnclosure() {
        const W = this.width;
        const H = this.height;
        const cx = W / 2;

        // ── 标签文字 ────────────────────────────────────────────────────
        const labelText = new Konva.Text({
            x: 0, y: -14, width: W,
            text: '智能压力变送器', fontSize: 14,
            align: 'center', fill: '#2c3e50', fontStyle: 'bold'
        });

        // ── 接线盒（顶部矩形区域） ──────────────────────────────────────
        const jBox = new Konva.Rect({
            x: 12, y: 5,
            width: W - 24, height: 52,
            fill: '#ecf0f1', stroke: '#95a5a6', strokeWidth: 1.5,
            cornerRadius: 4
        });
        // 接线盒左右端盖（六角螺帽效果）
        const lcap = new Konva.Rect({ x: 0, y: 10, width: 14, height: 42, fill: '#bdc3c7', stroke: '#7f8c8d', cornerRadius: 2 });
        const rcap = new Konva.Rect({ x: W - 14, y: 10, width: 14, height: 42, fill: '#bdc3c7', stroke: '#7f8c8d', cornerRadius: 2 });

        // ── HART/4-20mA 标记 ────────────────────────────────────────────
        const hartLabel = new Konva.Text({
            x: 16, y: 8, width: W - 32,
            text: 'HART  4~20mA', fontSize: 9,
            align: 'center', fill: '#2980b9', fontStyle: 'bold'
        });

        // ── 品牌 & 型号标签 ─────────────────────────────────────────────
        const brand = new Konva.Text({
            x: 16, y: 39, width: W - 32,
            text: `${this.hartMfr} ${this.hartModel}`, fontSize: 8,
            align: 'center', fill: '#7f8c8d'
        });

        // ── 主体圆柱（传感器舱） ────────────────────────────────────────
        const bodyOuter = new Konva.Circle({
            x: cx, y: 108, radius: 60,
            fill: '#2f3542', stroke: '#1e272e', strokeWidth: 1.5
        });
        // 银灰色端盖（模拟铝合金外壳）
        const bodyCap = new Konva.Circle({
            x: cx, y: 108, radius: 56,
            fill: '#576574', stroke: '#485460', strokeWidth: 3
        });
        // 深蓝色饰环
        const bodyRing = new Konva.Circle({
            x: cx, y: 108, radius: 48,
            fill: '#2c3e50', stroke: '#1a252f', strokeWidth: 2
        });

        // ── 底部连接颈与过程连接 ────────────────────────────────────────
        const neck = new Konva.Rect({
            x: cx - 10, y: 165,
            width: 20, height: 22,
            fill: '#bdc3c7', stroke: '#95a5a6'
        });
        const flange = new Konva.Rect({
            x: cx - 28, y: 183,
            width: 56, height: 14,
            fill: '#95a5a6', stroke: '#7f8c8d', cornerRadius: 2
        });

        this.sg.add(
            jBox, lcap, rcap,
            bodyOuter, bodyCap, bodyRing,
            neck, flange,
            labelText, hartLabel, brand
        );

        this._lcdCenterY = 108;
    }

    _drawLCD() {
        const cx = this.width / 2;
        const cy = this._lcdCenterY;
        const lcdR = 36;

        // LCD 圆形背景
        this.lcdBg = new Konva.Circle({
            x: cx, y: cy, radius: lcdR,
            fill: '#000'
        });

        // 主显示文字（PV 值）
        this.lcdMain = new Konva.Text({
            x: cx - 30, y: cy - 14,
            width: 60, text: '---',
            fontSize: 16, fontFamily: 'Digital-7, monospace',
            fill: '#00ff88', align: 'center', fontStyle: 'bold'
        });

        // 单位文字
        this.lcdUnit = new Konva.Text({
            x: cx - 20, y: cy + 4,
            width: 40, text: '',
            fontSize: 9, fill: '#00cc66', align: 'center'
        });

        // 模式标签（左上角小字）
        this.lcdModeLabel = new Konva.Text({
            x: cx - 34, y: cy - 30,
            width: 68, text: 'PV',
            fontSize: 8, fill: '#26de81', align: 'left'
        });

        // HART 通信指示灯（右上角小点）
        this.hartIndic = new Konva.Circle({
            x: cx + 28, y: cy - 26,
            radius: 4, fill: '#2f3542'
        });

        // 故障指示（红色闪烁，正常隐藏）
        this.faultIndic = new Konva.Text({
            x: cx - 30, y: cy - 32,
            width: 60, text: '',
            fontSize: 7, fill: '#ff4757', align: 'center'
        });

        this.sg.add(
            this.lcdBg, this.lcdMain, this.lcdUnit,
            this.lcdModeLabel, this.hartIndic, this.faultIndic
        );
    }

    _drawButtons() {
        const W = this.width;
        // 在接线盒区域放置 2 个按键：
        //   [ZERO] - 零点按下3s 启动本地零点设置
        //   [SPAN] - 量程按下3s 启动本地满度设置
        // 同时添加 HART 通信按键
        const btnDefs = [
            { id: 'zero', x: 32, label: 'Z', title: 'ZERO' },
            { id: 'span', x: W - 32, label: 'S', title: 'SPAN' },
        ];

        btnDefs.forEach(b => {
            const knobGrp = new Konva.Group({ x: b.x, y: 32 });
            const base  = new Konva.Circle({ radius: 10, fill: '#dfe6e9', stroke: '#636e72' });
            const rotor = new Konva.Group();
            rotor.add(new Konva.Circle({ radius: 7, fill: '#f1f2f6', stroke: '#2d3436' }));
            rotor.add(new Konva.Line({ points: [0, -5, 0, 5], stroke: '#2d3436', strokeWidth: 2.5 }));
            const lbl = new Konva.Text({
                x: -10, y: 14, width: 20,
                text: b.title, fontSize: 7,
                fill: '#636e72', align: 'center'
            });

            knobGrp.add(base, rotor, lbl);
            this.knobs[b.id] = rotor;

            rotor.on('mousedown touchstart', (e) => {
                e.cancelBubble = true;
                const startY = e.evt.clientY ?? e.evt.touches?.[0]?.clientY ?? 0;
                const startRot = rotor.rotation();
                const onMove = (me) => {
                    const cy = me.clientY ?? (me.touches?.[0]?.clientY ?? me.clientY);
                    const delta = (startY - cy) * 2;
                    rotor.rotation(startRot + delta);
                    if (b.id === 'zero') {
                        this.zeroAdj = (rotor.rotation() / 360) * 0.8;
                    } else {
                        this.spanAdj = 1.0 + (rotor.rotation() / 360) * 0.5;
                    }
                };
                const onUp = () => {
                    window.removeEventListener('mousemove', onMove);
                    window.removeEventListener('touchmove', onMove);
                    window.removeEventListener('mouseup',   onUp);
                    window.removeEventListener('touchend',  onUp);
                };
                window.addEventListener('mousemove', onMove);
                window.addEventListener('touchmove', onMove);
                window.addEventListener('mouseup',   onUp);
                window.addEventListener('touchend',  onUp);
            });

            this.sg.add(knobGrp);
        });

        // ── HART 通信按键（接线盒中央） ──────────────────────────────────
        const hartBtn = new Konva.Rect({
            x: this.width / 2 - 18, y: 20,
            width: 36, height: 18,
            fill: '#2980b9', stroke: '#1a6296',
            cornerRadius: 3
        });
        const hartBtnLbl = new Konva.Text({
            x: this.width / 2 - 18, y: 24,
            width: 36, text: 'HART',
            fontSize: 8, fill: '#fff', align: 'center', fontStyle: 'bold'
        });
        hartBtn.on('mousedown touchstart', (e) => {
            e.cancelBubble = true;
            this._openHartPanel();
        });
        hartBtnLbl.on('mousedown touchstart', (e) => {
            e.cancelBubble = true;
            this._openHartPanel();
        });
        hartBtn.on('dblclick', e => e.cancelBubble = true);
        hartBtnLbl.on('dblclick', e => e.cancelBubble = true);
        this.sg.add(hartBtn, hartBtnLbl);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  LCD 显示切换
    // ═══════════════════════════════════════════════════════════════════════
    _cycleLcdMode() {
        this._lcdModeIdx = (this._lcdModeIdx + 1) % LCD_MODES.length;
        this._lcdMode = LCD_MODES[this._lcdModeIdx];
        this._refreshCache();
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  update — 由 InstrumentUpdater 每帧调用
    //  state: { powered: bool, transCurrent: number(mA) }
    // ═══════════════════════════════════════════════════════════════════════
    update(state) {
        if (this.isBreak || !state || !state.powered) {
            this._setBlackScreen();
            this._refreshCache();
            return;
        }

        const inCurrent = typeof state.transCurrent === 'number' ? state.transCurrent : 4.0;
        this.ao = inCurrent;

        // ── 由 AO 反推 PV（显示用）──────────────────────────────────────
        const pvRaw = ((inCurrent - 4) / 16) * (this.max - this.min) + this.min;
        // 阻尼一阶滤波（简化，每次 update ~50ms）
        const alpha = Math.min(1, 50 / Math.max(1, this.damping * 1000));
        this.pvFilt = this.pvFilt + alpha * (pvRaw - this.pvFilt);
        this.press  = this.pvFilt;

        // ── 百分比 ───────────────────────────────────────────────────────
        this.pct = Math.min(100, Math.max(0, (inCurrent - 4) / 16 * 100));

        // ── 故障检测 ─────────────────────────────────────────────────────
        let isFault = false;
        let faultText = '';
        if (inCurrent < 3.8) {
            faultText = 'LLLL';
            isFault = true;
        } else if (inCurrent > 20.8) {
            faultText = 'HHHH';
            isFault = true;
        }
        this.isSat = isFault;

        // ── LCD 内容更新 ─────────────────────────────────────────────────
        if (isFault) {
            this.lcdBg.fill('#1a1a2e');
            this.lcdMain.fill('#ff4757');
            this.lcdMain.text(faultText);
            this.lcdUnit.text('');
            this.faultIndic.text('ALM');
            this.hartIndic.fill('#ff4757');
        } else {
            this.lcdBg.fill('#0a2a1a');
            this.lcdMain.fill('#00ff88');
            this.faultIndic.text('');
            this.hartIndic.fill(this.hartEnabled ? '#00e676' : '#2f3542');

            switch (this._lcdMode) {
                case 'PV': {
                    const decimals = this.unit === 'MPa' ? 4 : (this.unit === 'kPa' ? 2 : 1);
                    this.lcdMain.text(this.press.toFixed(decimals));
                    this.lcdUnit.text(this.unit);
                    this.lcdModeLabel.text('PV');
                    break;
                }
                case 'AO':
                    this.lcdMain.text(inCurrent.toFixed(3));
                    this.lcdUnit.text('mA');
                    this.lcdModeLabel.text('AO');
                    break;
                case 'PCT':
                    this.lcdMain.text(this.pct.toFixed(1));
                    this.lcdUnit.text('%');
                    this.lcdModeLabel.text('PCT');
                    break;
                case 'BAR': {
                    // 简单棒图（用字符模拟）
                    const bars = Math.round(this.pct / 10);
                    this.lcdMain.text('▌'.repeat(bars).padEnd(10, '░').substring(0, 6));
                    this.lcdUnit.text(`${this.pct.toFixed(0)}%`);
                    this.lcdModeLabel.text('BAR');
                    break;
                }
            }
        }

        this._refreshCache();
    }

    _setBlackScreen() {
        try {
            this.lcdBg.fill('#000');
            this.lcdMain.text('');
            this.lcdUnit.text('');
            this.faultIndic.text('');
            this.hartIndic.fill('#2f3542');
        } catch (e) { }
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  HART 通信面板
    // ═══════════════════════════════════════════════════════════════════════
    _openHartPanel() {
        const old = document.getElementById('hart-panel');
        if (old) { old.remove(); return; }

        const panel = document.createElement('div');
        panel.id = 'hart-panel';
        panel.style.cssText = `
            position: fixed; top: 60px; right: 20px;
            width: 420px; background: #1a1a2e;
            border: 2px solid #2980b9; border-radius: 8px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.7);
            z-index: 20000; font-family: 'Courier New', monospace;
            color: #e0e0e0; font-size: 12px;
            user-select: none;
        `;

        // 标题栏（可拖拽）
        panel.innerHTML = `
            <div id="hart-titlebar" style="
                background: linear-gradient(135deg,#2980b9,#1a5f8a);
                padding: 8px 12px; border-radius: 6px 6px 0 0;
                display: flex; justify-content: space-between; align-items: center;
                cursor: move;">
                <span style="font-weight:bold;font-size:13px;">
                    &#9664;&#9654; HART Communicator — ${this.hartTag} (${this.hartMfr} ${this.hartModel})
                </span>
                <button id="hart-close" style="
                    background:none;border:1px solid #aaa;color:#fff;
                    border-radius:3px;padding:1px 7px;cursor:pointer;">✕</button>
            </div>
            <div style="padding:10px;">
                <!-- 设备信息区 -->
                <div style="background:#0a1628;border:1px solid #2980b9;border-radius:4px;padding:8px;margin-bottom:8px;">
                    <div style="color:#26de81;font-weight:bold;margin-bottom:4px;">▶ 设备信息</div>
                    <div id="hart-devinfo" style="line-height:1.8;"></div>
                </div>
                <!-- 过程变量显示 -->
                <div style="background:#0a1628;border:1px solid #27ae60;border-radius:4px;padding:8px;margin-bottom:8px;">
                    <div style="color:#26de81;font-weight:bold;margin-bottom:4px;">▶ 过程变量（Cmd 3）</div>
                    <div id="hart-pvdisp" style="line-height:1.8;"></div>
                </div>
                <!-- 量程配置 -->
                <div style="background:#0a1628;border:1px solid #f39c12;border-radius:4px;padding:8px;margin-bottom:8px;">
                    <div style="color:#f1c40f;font-weight:bold;margin-bottom:6px;">▶ 量程配置（Cmd 35）</div>
                    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;align-items:center;">
                        <label style="color:#bdc3c7;">LRV (下限):</label>
                        <input id="hart-lrv" type="number" step="any" value="${this.min}"
                            style="background:#162032;color:#f1c40f;border:1px solid #f39c12;border-radius:3px;padding:3px 6px;width:100%;box-sizing:border-box;">
                        <span style="color:#bdc3c7;">${this.unit}</span>
                        <label style="color:#bdc3c7;">URV (上限):</label>
                        <input id="hart-urv" type="number" step="any" value="${this.max}"
                            style="background:#162032;color:#f1c40f;border:1px solid #f39c12;border-radius:3px;padding:3px 6px;width:100%;box-sizing:border-box;">
                        <span style="color:#bdc3c7;">${this.unit}</span>
                        <label style="color:#bdc3c7;">阻尼 (s):</label>
                        <input id="hart-damp" type="number" step="0.1" min="0" max="32" value="${this.damping}"
                            style="background:#162032;color:#f1c40f;border:1px solid #f39c12;border-radius:3px;padding:3px 6px;width:100%;box-sizing:border-box;">
                        <span style="color:#bdc3c7;">秒</span>
                    </div>
                    <div style="margin-top:8px;display:flex;gap:8px;">
                        <button id="hart-cmd35" style="
                            background:#2980b9;color:#fff;border:none;border-radius:4px;
                            padding:5px 14px;cursor:pointer;font-size:11px;">
                            写入量程 (Cmd 35)
                        </button>
                        <button id="hart-cmd43" style="
                            background:#27ae60;color:#fff;border:none;border-radius:4px;
                            padding:5px 14px;cursor:pointer;font-size:11px;">
                            本地调零 (Cmd 43)
                        </button>
                    </div>
                </div>
                <!-- 固定电流模式 -->
                <div style="background:#0a1628;border:1px solid #8e44ad;border-radius:4px;padding:8px;margin-bottom:8px;">
                    <div style="color:#a29bfe;font-weight:bold;margin-bottom:6px;">▶ 固定电流模式（Cmd 40）</div>
                    <div style="display:flex;align-items:center;gap:10px;">
                        <label style="color:#bdc3c7;">固定电流 (mA):</label>
                        <input id="hart-fixma" type="number" step="0.01" min="3.5" max="22" value="${this._fixedCurrent}"
                            style="background:#162032;color:#a29bfe;border:1px solid #8e44ad;border-radius:3px;padding:3px 6px;width:80px;">
                        <button id="hart-fixon" style="
                            background:${this._fixedCurrentMode ? '#c0392b' : '#8e44ad'};
                            color:#fff;border:none;border-radius:4px;padding:5px 12px;cursor:pointer;font-size:11px;">
                            ${this._fixedCurrentMode ? '退出固定模式' : '进入固定模式'}
                        </button>
                    </div>
                </div>
                <!-- 通信日志 -->
                <div style="background:#0a1628;border:1px solid #555;border-radius:4px;padding:8px;">
                    <div style="color:#95a5a6;font-weight:bold;margin-bottom:4px;">▶ 通信日志</div>
                    <div id="hart-log" style="
                        height:100px;overflow-y:auto;font-size:10px;
                        line-height:1.5;color:#7f8c8d;">
                    </div>
                    <div style="margin-top:6px;display:flex;gap:6px;">
                        <input id="hart-cmdinput" type="number" min="0" max="255" placeholder="命令号"
                            style="background:#162032;color:#ecf0f1;border:1px solid #555;border-radius:3px;
                            padding:3px 6px;width:80px;">
                        <button id="hart-sendbtn" style="
                            background:#34495e;color:#ecf0f1;border:1px solid #555;border-radius:4px;
                            padding:4px 12px;cursor:pointer;font-size:11px;">
                            发送
                        </button>
                        <button id="hart-clrbtn" style="
                            background:#2c3e50;color:#95a5a6;border:1px solid #555;border-radius:4px;
                            padding:4px 10px;cursor:pointer;font-size:11px;">
                            清除
                        </button>
                    </div>
                </div>
            </div>
        `;

        this.sys.container.appendChild(panel);
        this._updateHartPanelData(panel);
        this._bindHartPanelEvents(panel);
        this._makeDraggable(panel, panel.querySelector('#hart-titlebar'));

        this._hartPanelRef = panel;
    }

    _updateHartPanelData(panel) {
        const info = panel.querySelector('#hart-devinfo');
        if (info) {
            info.innerHTML = [
                `<span style="color:#95a5a6;">位号 (Tag):</span>    <span style="color:#ecf0f1;">${this.hartTag}</span>`,
                `<span style="color:#95a5a6;">制造商:</span>        <span style="color:#ecf0f1;">${this.hartMfr}</span>`,
                `<span style="color:#95a5a6;">型号:</span>          <span style="color:#ecf0f1;">${this.hartModel}</span>`,
                `<span style="color:#95a5a6;">序列号:</span>        <span style="color:#ecf0f1;">${this.hartSerial}</span>`,
                `<span style="color:#95a5a6;">轮询地址:</span>      <span style="color:#ecf0f1;">${this.hartAddress}</span>`,
                `<span style="color:#95a5a6;">量程单位:</span>      <span style="color:#ecf0f1;">${this.unit}</span>`,
                `<span style="color:#95a5a6;">LRV / URV:</span>     <span style="color:#f1c40f;">${this.min} / ${this.max} ${this.unit}</span>`,
                `<span style="color:#95a5a6;">固件版本:</span>      <span style="color:#ecf0f1;">${this.hartFirmware}</span>`,
                `<span style="color:#95a5a6;">组态变更:</span>      <span style="color:${this._cfgChanged ? '#ff4757' : '#26de81'};">${this._cfgChanged ? '已变更（未清零）' : '未变更'}</span>`,
            ].join('<br>');
        }
        const pv = panel.querySelector('#hart-pvdisp');
        if (pv) {
            pv.innerHTML = [
                `<span style="color:#95a5a6;">PV  (一次变量):</span> <span style="color:#26de81;font-weight:bold;">${this.press.toFixed(4)} ${this.unit}</span>`,
                `<span style="color:#95a5a6;">AO  (模拟输出):</span> <span style="color:#26de81;">${this.ao.toFixed(3)} mA</span>`,
                `<span style="color:#95a5a6;">PCT (量程百分比):</span><span style="color:#26de81;">${this.pct.toFixed(2)} %</span>`,
                `<span style="color:#95a5a6;">TV  (壳体温度):</span> <span style="color:#f39c12;">${this.temp.toFixed(1)} °C</span>`,
                `<span style="color:#95a5a6;">状态:</span>           <span style="color:${this.isSat ? '#ff4757' : '#26de81'};">${this.isSat ? '饱和/告警' : '正常'}</span>`,
            ].join('<br>');
        }
    }

    _bindHartPanelEvents(panel) {
        // 关闭
        panel.querySelector('#hart-close').onclick = () => panel.remove();

        // 写入量程 Cmd 35
        panel.querySelector('#hart-cmd35').onclick = () => {
            const lrv  = parseFloat(panel.querySelector('#hart-lrv').value);
            const urv  = parseFloat(panel.querySelector('#hart-urv').value);
            const damp = parseFloat(panel.querySelector('#hart-damp').value);
            if (isNaN(lrv) || isNaN(urv) || urv <= lrv) {
                this._hartLog.push(`[ERR] Cmd 35: URV 必须大于 LRV`);
            } else {
                this.min     = lrv;
                this.max     = urv;
                this.damping = isNaN(damp) ? this.damping : Math.max(0, Math.min(32, damp));
                this.config.min     = this.min;
                this.config.max     = this.max;
                this.config.damping = this.damping;
                this._cfgChanged = true;
                this._hartLog.push(`[CMD 35] 写入量程: LRV=${lrv} URV=${urv} ${this.unit}  阻尼=${this.damping}s  ✔`);
                this._updateHartPanelData(panel);
            }
            this._renderHartLog(panel);
        };

        // 本地调零 Cmd 43
        panel.querySelector('#hart-cmd43').onclick = () => {
            this.zeroAdj = -this.press;
            this._cfgChanged = true;
            this._hartLog.push(`[CMD 43] 本地调零完成，当前PV=${this.press.toFixed(4)} ${this.unit}  ✔`);
            this._renderHartLog(panel);
        };

        // 固定电流模式 Cmd 40
        panel.querySelector('#hart-fixon').onclick = () => {
            if (this._fixedCurrentMode) {
                this._fixedCurrentMode = false;
                this._hartLog.push(`[CMD 40] 退出固定电流模式  ✔`);
            } else {
                const ma = parseFloat(panel.querySelector('#hart-fixma').value);
                if (isNaN(ma) || ma < 3.5 || ma > 22) {
                    this._hartLog.push(`[ERR] Cmd 40: 电流值必须在 3.5~22 mA 之间`);
                } else {
                    this._fixedCurrent     = ma;
                    this._fixedCurrentMode = true;
                    this._hartLog.push(`[CMD 40] 进入固定电流模式: ${ma.toFixed(3)} mA  ✔`);
                }
            }
            this._renderHartLog(panel);
            // 更新按钮文字和颜色
            const btn = panel.querySelector('#hart-fixon');
            btn.textContent = this._fixedCurrentMode ? '退出固定模式' : '进入固定模式';
            btn.style.background = this._fixedCurrentMode ? '#c0392b' : '#8e44ad';
        };

        // 发送通用命令
        panel.querySelector('#hart-sendbtn').onclick = () => {
            const cmdNum = parseInt(panel.querySelector('#hart-cmdinput').value);
            if (isNaN(cmdNum) || cmdNum < 0 || cmdNum > 255) {
                this._hartLog.push(`[ERR] 请输入有效命令号 (0~255)`);
            } else {
                const resp = this._execHartCommand(cmdNum);
                this._hartLog.push(`[CMD ${cmdNum}] ${HART_COMMANDS[cmdNum] || '未知命令'}`);
                resp.forEach(line => this._hartLog.push(`  → ${line}`));
            }
            if (this._hartLog.length > 50) this._hartLog = this._hartLog.slice(-50);
            this._renderHartLog(panel);
            this._updateHartPanelData(panel);
        };

        // 清除日志
        panel.querySelector('#hart-clrbtn').onclick = () => {
            this._hartLog = [];
            this._renderHartLog(panel);
        };

        // Enter 键发送
        panel.querySelector('#hart-cmdinput').onkeydown = (e) => {
            if (e.key === 'Enter') panel.querySelector('#hart-sendbtn').click();
        };
    }

    _execHartCommand(cmd) {
        const ts = new Date().toLocaleTimeString();
        switch (cmd) {
            case 0:
                return [
                    `Mfr: ${this.hartMfr}`, `Model: ${this.hartModel}`,
                    `S/N: ${this.hartSerial}`, `FW: ${this.hartFirmware}`,
                    `Address: ${this.hartAddress}`
                ];
            case 1:
                return [`PV = ${this.press.toFixed(6)} ${this.unit}`];
            case 2:
                return [
                    `AO = ${this.ao.toFixed(3)} mA`,
                    `PCT = ${this.pct.toFixed(2)} %`
                ];
            case 3:
                return [
                    `PV = ${this.press.toFixed(6)} ${this.unit}`,
                    `AO = ${this.ao.toFixed(3)} mA`,
                    `PCT = ${this.pct.toFixed(2)} %`,
                    `TV = ${this.temp.toFixed(1)} °C`
                ];
            case 12:
                return [`Message: ${this.hartMsg}`];
            case 13:
                return [
                    `Tag: ${this.hartTag}`,
                    `Desc: ${this.hartDesc}`,
                    `Date: ${this.hartDate}`
                ];
            case 14:
                return [
                    `LRV = ${this.min} ${this.unit}`,
                    `URV = ${this.max} ${this.unit}`,
                    `Damping = ${this.damping} s`
                ];
            case 15:
                return [
                    `Mfr: ${this.hartMfr}`, `Model: ${this.hartModel}`,
                    `FW: ${this.hartFirmware}`, `S/N: ${this.hartSerial}`
                ];
            case 38:
                this._cfgChanged = false;
                return ['Configuration changed flag cleared  ✔'];
            case 44:
                return [`Primary Variable Units: ${this.unit}  (read-only in simulation)`];
            default:
                return [`响应: OK (模拟)`];
        }
    }

    _renderHartLog(panel) {
        const logEl = panel.querySelector('#hart-log');
        if (!logEl) return;
        logEl.innerHTML = this._hartLog.map((line, i) => {
            const color = line.startsWith('[ERR]') ? '#ff6b6b'
                : line.startsWith('[CMD') ? '#74b9ff'
                : '#95a5a6';
            return `<div style="color:${color};">${line}</div>`;
        }).join('');
        logEl.scrollTop = logEl.scrollHeight;
    }

    _makeDraggable(el, handle) {
        let ox = 0, oy = 0, sx = 0, sy = 0;
        handle.onmousedown = (e) => {
            e.preventDefault();
            sx = e.clientX; sy = e.clientY;
            ox = el.offsetLeft; oy = el.offsetTop;
            document.onmousemove = (me) => {
                el.style.left = (ox + me.clientX - sx) + 'px';
                el.style.top  = (oy + me.clientY - sy) + 'px';
                el.style.right = 'auto';
            };
            document.onmouseup = () => {
                document.onmousemove = null;
                document.onmouseup   = null;
            };
        };
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  配置对话框字段
    // ═══════════════════════════════════════════════════════════════════════
    getConfigFields() {
        return [
            { label: '位号 (Tag)', key: 'id',      type: 'text' },
            { label: 'HART 位号', key: 'tag',     type: 'text' },
            { label: 'LRV 下限值',  key: 'min',     type: 'number' },
            { label: 'URV 上限值',  key: 'max',     type: 'number' },
            {
                label: '显示单位', key: 'unit', type: 'select',
                options: [
                    { label: 'kPa',  value: 'kPa'  },
                    { label: 'MPa',  value: 'MPa'  },
                    { label: 'Bar',  value: 'Bar'  },
                    { label: 'PSI',  value: 'PSI'  },
                    { label: 'inH2O', value: 'inH2O' },
                ]
            },
            { label: '阻尼时间 (s)', key: 'damping', type: 'number' },
        ];
    }

    onConfigUpdate(newConfig) {
        this.id          = newConfig.id      || this.id;
        this.hartTag     = newConfig.tag     || this.hartTag;
        this.min         = parseFloat(newConfig.min)     || this.min;
        this.max         = parseFloat(newConfig.max)     || this.max;
        this.unit        = newConfig.unit    || this.unit;
        this.damping     = parseFloat(newConfig.damping) || this.damping;
        this.config      = { ...newConfig };
        this._cfgChanged = true;
        // 刷新 HART 面板（如已打开）
        if (this._hartPanelRef && document.body.contains(this._hartPanelRef)) {
            this._updateHartPanelData(this._hartPanelRef);
        }
    }
}
