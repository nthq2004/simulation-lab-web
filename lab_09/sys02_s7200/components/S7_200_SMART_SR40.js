import { BaseComponent } from './BaseComponent.js';

/**
 * 西门子 S7-200 SMART CPU SR40 可编程控制器仿真组件
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  外观（尽量还原实物）：
 *    - 深灰塑料机身 + 顶部 RUN/STOP/ERROR 状态指示灯
 *    - 左侧 RS485 口（PORT0/PORT1）、以太网 RJ45 口
 *    - 中间可拆装"存储卡"槽与状态铭牌（CPU SR40 / 订货号）
 *    - 上排数字量输入端子（DIa: DI0.0~DI0.7 …），下排数字量输出端子
 *    - 底部 24V/0V 传感器电源 + 模拟量输入 AI / 输出 AQ
 *
 *  运行模型：由 tools/S7200Solver.js 按扫描周期解释指令表程序；
 *            本组件负责外观、按键、程序编辑、I/O 端口注册与过程映像显示。
 *
 *  程序加载：右键菜单「程序编辑器」打开内置 STL（语句表）编辑器，
 *            编辑/保存后热加载，RUN 模式下立即按新程序执行。
 * ═══════════════════════════════════════════════════════════════════════════
 */
export class S7_200_SMART_SR40 extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(380, config.width  || 460);
        this.height = Math.max(380, config.height || 470);

        this.type  = 'plc_s7200';
        this.special = 'plc';
        this.cache = 'fixed';

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._initState();
        this._init();
        this._registerPorts();

        this.config = {
            id: this.id,
            label: this.label,
            mode: this.mode,
            program: this._programText,
        };
    }

    // ═══════════════════════════════════════════════════════════════
    // 几何
    // ═══════════════════════════════════════════════════════════════
    _recalcGeometry() {
        const W = this.width, H = this.height;

        this._body = { x: 0, y: 0, w: W, h: H, rx: 4 };

        // 顶部状态灯区
        this._ledZone = { x: 0, y: 0, w: W, h: H * 0.095 };
        this._leds = {
            run:   { x: W * 0.30, y: H * 0.046, r: Math.max(4.5, W * 0.014) },
            stop:  { x: W * 0.42, y: H * 0.046, r: Math.max(4.5, W * 0.014) },
            error: { x: W * 0.54, y: H * 0.046, r: Math.max(4.5, W * 0.014) },
        };

        // 通信口区（左侧 RS485 + 以太网）
        this._commZone = { x: W * 0.02, y: H * 0.115, w: W * 0.30, h: H * 0.17 };
        this._rs485 = { x: this._commZone.x, y: this._commZone.y + this._commZone.h * 0.12,
                        w: this._commZone.w * 0.42, h: this._commZone.h * 0.62 };
        this._eth = { x: this._commZone.x + this._commZone.w * 0.50, y: this._commZone.y + this._commZone.h * 0.12,
                      w: this._commZone.w * 0.44, h: this._commZone.h * 0.62 };

        // 铭牌 / 存储卡
        this._nameplate = { x: W * 0.34, y: H * 0.125, w: W * 0.40, h: H * 0.155 };
        this._card = { x: W * 0.76, y: H * 0.125, w: W * 0.22, h: H * 0.155 };

        // 模式开关（RUN/STOP 拨动）
        this._modeSw = { x: W * 0.78, y: H * 0.315, w: W * 0.16, h: H * 0.085 };

        // ── 端子排分区 ──
        // 上：DI（两排之间留足间距，避免拥挤）
        this._termTop = { x: W * 0.02, y: H * 0.415, w: W * 0.96, h: H * 0.245 };
        // 下：DQ
        this._termBot = { x: W * 0.02, y: H * 0.675, w: W * 0.96, h: H * 0.245 };
        // 底部辅助：24V/0V 传感器电源 + AI/AQ
        this._termAux = { x: W * 0.02, y: H * 0.928, w: W * 0.96, h: H * 0.058 };

        // 端子行布局（每排端子的横向位置 + 行内纵向位置）
        this._mkRow = (y0, h, labels, rowY) => {
            const pad = W * 0.05;
            const span = W * 0.90;
            return labels.map((lab, i) => {
                const x = pad + (labels.length === 1 ? span / 2 : (span / (labels.length - 1)) * i);
                return { ...lab, ax: x, y: y0 + h * (rowY !== undefined ? rowY : 0.42) };
            });
        };

        // 上排 DI 组（第一排）
        this._diRow = this._mkRow(this._termTop.y, this._termTop.h, [
            { id: '1m',  label: '1M' },
            { id: 'di00', label: '0.0', bit: 0 },
            { id: 'di01', label: '0.1', bit: 1 },
            { id: 'di02', label: '0.2', bit: 2 },
            { id: 'di03', label: '0.3', bit: 3 },
            { id: 'di04', label: '0.4', bit: 4 },
            { id: 'di05', label: '0.5', bit: 5 },
            { id: 'di06', label: '0.6', bit: 6 },
            { id: 'di07', label: '0.7', bit: 7 },
            { id: 'di10', label: '1.0', bit: 8 },
            { id: 'di11', label: '1.1', bit: 9 },
            { id: 'di12', label: '1.2', bit: 10 },
            { id: 'di13', label: '1.3', bit: 11 },
        ], 0.30);

        // 第二排 DI 组（2M 另起），与第一排之间留足间距
        this._diRow2 = this._mkRow(this._termTop.y, this._termTop.h, [
            { id: '2m',  label: '2M' },
            { id: 'di14', label: '1.4', bit: 12 },
            { id: 'di15', label: '1.5', bit: 13 },
            { id: 'di16', label: '1.6', bit: 14 },
            { id: 'di17', label: '1.7', bit: 15 },
            { id: 'di20', label: '2.0', bit: 16 },
            { id: 'di21', label: '2.1', bit: 17 },
            { id: 'di22', label: '2.2', bit: 18 },
            { id: 'di23', label: '2.3', bit: 19 },
            { id: 'di24', label: '2.4', bit: 20 },
            { id: 'di25', label: '2.5', bit: 21 },
            { id: 'di26', label: '2.6', bit: 22 },
            { id: 'di27', label: '2.7', bit: 23 },
        ], 0.76);

        // 下排 DQ 组（第一排）
        this._dqRow = this._mkRow(this._termBot.y, this._termBot.h, [
            { id: '1l',  label: '1L+', pwr: true },
            { id: 'dq00', label: '0.0', bit: 0 },
            { id: 'dq01', label: '0.1', bit: 1 },
            { id: 'dq02', label: '0.2', bit: 2 },
            { id: 'dq03', label: '0.3', bit: 3 },
            { id: 'dq04', label: '0.4', bit: 4 },
            { id: 'dq05', label: '0.5', bit: 5 },
            { id: 'dq06', label: '0.6', bit: 6 },
            { id: 'dq07', label: '0.7', bit: 7 },
            { id: 'dq10', label: '1.0', bit: 8 },
            { id: 'dq11', label: '1.1', bit: 9 },
            { id: 'dq12', label: '1.2', bit: 10 },
            { id: 'dq13', label: '1.3', bit: 11 },
        ], 0.30);
        this._dqRow2 = this._mkRow(this._termBot.y, this._termBot.h, [
            { id: '2l',  label: '2L+', pwr: true },
            { id: 'dq14', label: '1.4', bit: 12 },
            { id: 'dq15', label: '1.5', bit: 13 },
            { id: 'dq16', label: '1.6', bit: 14 },
            { id: 'dq17', label: '1.7', bit: 15 },
            { id: 'mm',  label: 'M' },
            { id: 'lplus', label: 'L+' },
        ], 0.76);

        // 底部辅助：24V/0V 传感器电源 + AI/AQ
        this._auxRow = this._mkRow(this._termAux.y, this._termAux.h, [
            { id: '24v', label: '24V' },
            { id: 'v0',  label: '0V' },
            { id: 'ai0', label: 'AI1' },
            { id: 'ai1', label: 'AI2' },
            { id: 'aq0', label: 'AQ1' },
        ]);

        // DI / DQ 引脚清单（供求解器使用）
        this.diPins = [...this._diRow, ...this._diRow2]
            .filter(t => t.id.startsWith('di')).map(t => t.id);
        this.dqPins = [...this._dqRow, ...this._dqRow2]
            .filter(t => t.id.startsWith('dq')).map(t => t.id);
    }

    _initParameters(config) {
        this.label = config.label || 'SR40';
        this._modeInit = config.mode || 'RUN';

        this._defaultProgram = [
            '// S7-200 SMART SR40 示例程序',
            '// 1) 起保停：I0.0 启动  I0.1 停止  → Q0.0 输出',
            'LD     I0.0',
            'O      Q0.0',
            'AN     I0.1',
            '=      Q0.0',
            '',
            '// 2) 定时输出：SM0.5（1s 时钟）经 T37(1s) 延时 → Q0.1',
            'LD     SM0.5',
            'TON    T37, 10',
            'LD     T37',
            '=      Q0.1',
            '',
            '// 3) 计数输出：I0.2 计数到 5 次 → Q0.2；I0.3 复位',
            'LD     I0.2',
            'CTU    C0, 5',
            'LD     I0.3',
            'R      C0, 1',
            'LD     C0',
            '=      Q0.2',
            'END',
        ].join('\n');

        this._programText = config.program || this._defaultProgram;
    }

    _initState() {
        this.mode = (this._modeInit === 'STOP') ? 'STOP' : 'RUN';
        this._display = null;
        this._qBits = null;   // 求解器回填的 Q 过程映像
    }

    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
    }

    // ═══════════════════════════════════════════════════════════════
    // 端口
    // ═══════════════════════════════════════════════════════════════
    _registerPorts() {
        const addRow = (row) => row.forEach(t => {
            if (t.pwr) this.addPort(t.ax, t.y, t.id, 'wire', 'p');
            else this.addPort(t.ax, t.y, t.id, 'wire');
        });
        addRow(this._diRow);
        addRow(this._diRow2);
        addRow(this._dqRow);
        addRow(this._dqRow2);
        addRow(this._auxRow);
    }

    // ═══════════════════════════════════════════════════════════════
    // 静态绘制
    // ═══════════════════════════════════════════════════════════════
    _drawStaticParts() {
        this._drawBody();
        this._drawLEDZone();
        this._drawCommPorts();
        this._drawNameplate();
        this._drawModeSwitchBase();
        this._drawTerminalStrips();
    }

    _drawBody() {
        const W = this.width, H = this.height;
        this._staticGroup.add(new Konva.Rect({
            x: 0, y: 0, width: W, height: H, cornerRadius: 4,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint: { x: 0, y: H },
            fillLinearGradientColorStops: [0, '#5a6069', 0.5, '#464d55', 1, '#31373e'],
            stroke: '#1c2126', strokeWidth: 1.4, listening: false,
        }));
        // 顶部状态灯区底色
        const z = this._ledZone;
        this._staticGroup.add(new Konva.Rect({
            x: z.x, y: z.y, width: z.w, height: z.h,
            fill: '#2b3137', listening: false,
        }));
    }

    _drawLEDZone() {
        const W = this.width;
        const spec = [
            { key: 'run',   text: 'RUN',   col: '#2ecc71' },
            { key: 'stop',  text: 'STOP',  col: '#f0c419' },
            { key: 'error', text: 'ERROR', col: '#e74c3c' },
        ];
        spec.forEach(s => {
            const p = this._leds[s.key];
            this._staticGroup.add(new Konva.Circle({
                x: p.x, y: p.y, radius: p.r,
                fill: '#1a1f24', stroke: '#0e1216', strokeWidth: 0.8, listening: false,
            }));
            this._staticGroup.add(new Konva.Text({
                x: p.x - W * 0.05, y: p.y + p.r + 2, width: W * 0.10,
                text: s.text, fontSize: Math.max(9, W * 0.028), fontStyle: 'bold',
                fontFamily: 'Arial, sans-serif', fill: '#c9d1d9', align: 'center', listening: false,
            }));
        });
        // 品牌文字
        this._staticGroup.add(new Konva.Text({
            x: W * 0.04, y: this._ledZone.y + this._ledZone.h * 0.22, text: 'SIEMENS',
            fontSize: Math.max(12, W * 0.042), fontStyle: 'bold',
            fontFamily: 'Arial, sans-serif', fill: '#009999', listening: false,
        }));
    }

    _drawCommPorts() {
        const W = this.width;
        // RS485（DB9 简化）
        const r = this._rs485;
        this._staticGroup.add(new Konva.Rect({
            x: r.x, y: r.y, width: r.w, height: r.h, cornerRadius: 2,
            fill: '#2b3137', stroke: '#12161a', strokeWidth: 1, listening: false,
        }));
        this._staticGroup.add(new Konva.Text({
            x: r.x, y: r.y + r.h * 0.28, width: r.w, text: 'RS485',
            fontSize: Math.max(9, W * 0.026), fill: '#9aa2aa', align: 'center', listening: false,
        }));
        // 以太网 RJ45
        const e = this._eth;
        this._staticGroup.add(new Konva.Rect({
            x: e.x, y: e.y, width: e.w, height: e.h, cornerRadius: 2,
            fill: '#1b2024', stroke: '#12161a', strokeWidth: 1, listening: false,
        }));
        // RJ45 网口示意（缺口）
        this._staticGroup.add(new Konva.Rect({
            x: e.x + e.w * 0.18, y: e.y + e.h * 0.16, width: e.w * 0.64, height: e.h * 0.68,
            fill: '#0c1013', stroke: '#3a4046', strokeWidth: 0.6, listening: false,
        }));
        this._staticGroup.add(new Konva.Text({
            x: e.x, y: e.y + e.h + 1, width: e.w, text: 'ETHERNET',
            fontSize: Math.max(8, W * 0.022), fill: '#9aa2aa', align: 'center', listening: false,
        }));
    }

    _drawNameplate() {
        const n = this._nameplate, W = this.width;
        this._staticGroup.add(new Konva.Rect({
            x: n.x, y: n.y, width: n.w, height: n.h, cornerRadius: 2,
            fill: '#e9e6dc', stroke: '#9aa0a6', strokeWidth: 0.8, listening: false,
        }));
        this._staticGroup.add(new Konva.Text({
            x: n.x + 5, y: n.y + 4, width: n.w - 10,
            text: 'SIEMENS  SIMATIC S7-200 SMART',
            fontSize: Math.max(10, W * 0.029), fontStyle: 'bold',
            fontFamily: 'Arial, sans-serif', fill: '#1a1a1a', listening: false,
        }));
        this._staticGroup.add(new Konva.Text({
            x: n.x + 5, y: n.y + n.h * 0.34, width: n.w - 10,
            text: 'CPU SR40  AC/DC/Relay',
            fontSize: Math.max(12, W * 0.038), fontStyle: 'bold',
            fontFamily: 'Arial, sans-serif', fill: '#0a5a5a', listening: false,
        }));
        this._staticGroup.add(new Konva.Text({
            x: n.x + 5, y: n.y + n.h * 0.68, width: n.w - 10,
            text: '6ES7 288-1SR40-0AA0  DC24V 4W',
            fontSize: Math.max(8, W * 0.023), fontFamily: 'Arial, sans-serif', fill: '#333', listening: false,
        }));

        // 存储卡槽
        const c = this._card, W2 = this.width;
        this._staticGroup.add(new Konva.Rect({
            x: c.x, y: c.y, width: c.w, height: c.h, cornerRadius: 2,
            fill: '#3a4048', stroke: '#12161a', strokeWidth: 0.8, listening: false,
        }));
        this._staticGroup.add(new Konva.Text({
            x: c.x, y: c.y + c.h * 0.30, width: c.w, text: 'MC',
            fontSize: Math.max(10, W2 * 0.03), fontStyle: 'bold',
            fontFamily: 'Arial, sans-serif', fill: '#c9d1d9', align: 'center', listening: false,
        }));
    }

    _drawModeSwitchBase() {
        const m = this._modeSw, W = this.width;
        this._staticGroup.add(new Konva.Rect({
            x: m.x, y: m.y, width: m.w, height: m.h, cornerRadius: 3,
            fill: '#23282d', stroke: '#12161a', strokeWidth: 1, listening: false,
        }));
        this._staticGroup.add(new Konva.Text({
            x: m.x, y: m.y - Math.max(12, W * 0.038), width: m.w, text: 'RUN / STOP',
            fontSize: Math.max(9, W * 0.026), fill: '#9aa2aa', align: 'center', listening: false,
        }));
    }

    _drawTerminalStrips() {
        const W = this.width;
        const strips = [
            { box: this._termTop, rows: [this._diRow, this._diRow2], title: '数字量输入 DI' },
            { box: this._termBot, rows: [this._dqRow, this._dqRow2], title: '数字量输出 DQ' },
            { box: this._termAux, rows: [this._auxRow], title: '' },
        ];
        strips.forEach(({ box, rows, title }) => {
            this._staticGroup.add(new Konva.Rect({
                x: box.x, y: box.y - (title ? Math.max(12, W * 0.036) : 0),
                width: box.w, height: box.h + (title ? Math.max(12, W * 0.036) : 0),
                cornerRadius: 3, fill: '#1b2024', stroke: '#0e1216', strokeWidth: 1, listening: false,
            }));
            if (title) {
                this._staticGroup.add(new Konva.Text({
                    x: box.x + 5, y: box.y - Math.max(12, W * 0.036) + 2, text: title,
                    fontSize: Math.max(9, W * 0.027), fontStyle: 'bold',
                    fill: '#9aa2aa', listening: false,
                }));
            }
            rows.forEach(row => row.forEach(t => {
                this._staticGroup.add(new Konva.Rect({
                    x: t.ax - 5, y: t.y - 5, width: 10, height: 10, cornerRadius: 1,
                    fill: t.pwr ? '#c9a227' : '#8a929a', stroke: '#5a6168', strokeWidth: 0.6, listening: false,
                }));
                this._staticGroup.add(new Konva.Text({
                    x: t.ax - 15, y: t.y + 7, width: 30, text: t.label,
                    fontSize: Math.max(9, W * 0.025), fontStyle: 'bold',
                    fontFamily: 'Arial, sans-serif', fill: '#dbe2e8', align: 'center', listening: false,
                }));
            }));
        });
    }

    // ═══════════════════════════════════════════════════════════════
    // 动态节点
    // ═══════════════════════════════════════════════════════════════
    _createDynamicNodes() {
        const d = this._dynamicGroup, W = this.width;

        // 状态灯
        this._runLed = new Konva.Circle({
            x: this._leds.run.x, y: this._leds.run.y, radius: this._leds.run.r,
            fill: '#1a1f24', listening: false,
        });
        this._stopLed = new Konva.Circle({
            x: this._leds.stop.x, y: this._leds.stop.y, radius: this._leds.stop.r,
            fill: '#1a1f24', listening: false,
        });
        this._errLed = new Konva.Circle({
            x: this._leds.error.x, y: this._leds.error.y, radius: this._leds.error.r,
            fill: '#1a1f24', listening: false,
        });
        d.add(this._runLed, this._stopLed, this._errLed);

        // 模式开关手柄
        this._modeHandle = new Konva.Rect({
            x: this._modeSw.x + 3, y: this._modeSw.y + 3,
            width: this._modeSw.w * 0.5 - 3, height: this._modeSw.h - 6, cornerRadius: 2,
            fill: '#1f9d55', listening: false,
        });
        d.add(this._modeHandle);

        // DI / DQ 端口状态指示灯
        this._ioDots = {};
        const mkDots = (row, bit) => row.forEach(t => {
            if (!t.id.startsWith(bit)) return;
            const dot = new Konva.Circle({
                x: t.ax, y: t.y - Math.max(13, W * 0.036), radius: Math.max(3.2, W * 0.011),
                fill: '#26303a', listening: false,
            });
            d.add(dot);
            this._ioDots[t.id] = dot;
        });
        mkDots(this._diRow, 'di');
        mkDots(this._diRow2, 'di');
        mkDots(this._dqRow, 'dq');
        mkDots(this._dqRow2, 'dq');

        // 程序摘要文本（显示扫描计数/程序行数）
        this._infoText = new Konva.Text({
            x: this._commZone.x, y: this._modeSw.y + this._modeSw.h * 0.2,
            width: this.width * 0.72, text: '',
            fontSize: Math.max(9, W * 0.026), fontFamily: 'Consolas, monospace',
            fill: '#9aa2aa', listening: false,
        });
        d.add(this._infoText);
    }

    // ═══════════════════════════════════════════════════════════════
    // 交互
    // ═══════════════════════════════════════════════════════════════
    _bindInteraction() {
        // 模式开关
        const hit = this.addClickablePart('mode-sw', this._modeSw.x, this._modeSw.y, this._modeSw.w, this._modeSw.h);
        if (hit) hit.on('click tap', () => this.toggleMode());

        // 以太网口（点击 → 提示）
        const ethHit = this.addClickablePart('eth', this._eth.x, this._eth.y, this._eth.w, this._eth.h);
        if (ethHit) ethHit.on('click tap', () => this._tip('以太网口：用于编程/下载程序'));

        // 状态灯区
        const ledHit = this.addClickablePart('leds', this._ledZone.x, this._ledZone.y, this._ledZone.w, this._ledZone.h);
        if (ledHit) ledHit.on('click tap', () => {
            const m = this.mode === 'RUN' ? '运行' : '停止';
            const n = (this._display && this._display.scanCount) || 0;
            this._tip(`状态：${m}  扫描次数：${n}`);
        });
    }

    getClickablePartCenter(partId) {
        const rel = {
            'mode-sw': this._modeSw,
            'eth': this._eth,
            'leds': this._ledZone,
        }[partId];
        if (!rel) return super.getClickablePartCenter(partId);
        const g = this.group.getAbsolutePosition();
        return { x: g.x + rel.x + rel.w / 2, y: g.y + rel.y + rel.h / 2 };
    }

    toggleMode() {
        this.mode = (this.mode === 'RUN') ? 'STOP' : 'RUN';
        if (this.mode === 'RUN' && this.sys.s7200Solver) {
            this.sys.s7200Solver.reloadProgram(this.id);
        }
        this._updateDisplay();
        this._tip(this.mode === 'RUN' ? '已切换到 RUN（执行程序）' : '已切换到 STOP（停止执行）');
        if (this.sys.requestRedraw) this.sys.requestRedraw();
    }

    // ═══════════════════════════════════════════════════════════════
    // 主循环
    // ═══════════════════════════════════════════════════════════════
    tick(dt) {
        this._updateDisplay();
        if (this.sys && typeof this.sys.requestRedraw === 'function') this.sys.requestRedraw();
    }

    _updateDisplay() {
        const running = this.mode === 'RUN';
        const hasErr = !!(this._display && this._display.error);

        this._runLed.fill(running && !hasErr ? '#2ecc71' : '#14301c');
        this._stopLed.fill(!running ? '#f0c419' : '#332b12');
        this._errLed.fill(hasErr ? '#e74c3c' : '#301616');

        // 模式手柄位置/颜色
        const onLeft = !running;
        this._modeHandle.x(onLeft ? this._modeSw.x + 3 : this._modeSw.x + this._modeSw.w * 0.5);
        this._modeHandle.fill(running ? '#1f9d55' : '#d84438');

        // DI / DQ 指示灯
        const di = (this._display && this._display.di) || [];
        const dq = (this._display && this._display.dq) || [];
        this.diPins.forEach((pin, i) => {
            const dot = this._ioDots[pin];
            if (dot) dot.fill(di[i] ? '#26d24e' : '#26303a');
        });
        this.dqPins.forEach((pin, i) => {
            const dot = this._ioDots[pin];
            if (dot) dot.fill(dq[i] ? '#f0a020' : '#26303a');
        });

        // 信息文本
        const lines = this._programText ? this._programText.split(/\r?\n/).filter(l => l.trim() && !l.trim().startsWith('//')).length : 0;
        const scans = (this._display && this._display.scanCount) || 0;
        this._infoText.text(`${running ? 'RUN ' : 'STOP'}  |  ${lines} 条指令  |  扫描 ${scans}${hasErr ? '  |  ⚠程序错误' : ''}`);
        this._infoText.fill(hasErr ? '#e07060' : '#9aa2aa');
    }

    _tip(msg) {
        if (this.sys && typeof this.sys.showFloatingTip === 'function') {
            this.sys.showFloatingTip(`S7-200: ${msg}`, 2200);
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // 右键菜单 & 程序编辑器
    // ═══════════════════════════════════════════════════════════════
    getContextMenuItems() {
        return [
            { label: this.mode === 'RUN' ? '切换到 STOP' : '切换到 RUN', onClick: () => this.toggleMode() },
            { label: '程序编辑器（STL）', onClick: () => this.showProgramEditor() },
            { label: '加载程序文件', onClick: () => this._loadProgramFile() },
            { label: '重置 CPU', onClick: () => this._resetCPU() },
            { label: 'I/O 状态查看', onClick: () => this._showIOViewer() },
        ];
    }

    showProgramEditor() {
        const old = document.getElementById('plc-prog-editor');
        if (old) old.remove();

        const modal = document.createElement('div');
        modal.id = 'plc-prog-editor';
        modal.style = `position:fixed;inset:0;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;z-index:9999;`;

        const box = document.createElement('div');
        box.style = `background:#1e1e2e;border-radius:8px;width:640px;max-width:92vw;max-height:88vh;display:flex;flex-direction:column;padding:16px;color:#cdd6f4;font-family:'Consolas',monospace;box-shadow:0 8px 30px rgba(0,0,0,0.5);`;

        const title = document.createElement('div');
        title.innerText = `S7-200 SMART ${this.label} 程序编辑器（语句表 STL）`;
        title.style = 'font-size:15px;font-weight:bold;color:#89b4fa;margin-bottom:8px;';
        box.appendChild(title);

        const hint = document.createElement('div');
        hint.innerHTML = '指令示例：<b>LD/LDN/A/AN/O/ON/=</b>、<b>S/R</b>、<b>TON/TOF/CTU</b>、<b>=I/&gt;I/&lt;I</b>、<b>MOV_W/+I/-I</b>、<b>JMP/LBL</b>、<b>END</b>；操作数：I0.0 / Q0.0 / M0.0 / T37 / C0 / AIW0 / VW0。';
        hint.style = 'font-size:12px;color:#a6adc8;margin-bottom:10px;line-height:1.5;';
        box.appendChild(hint);

        const ta = document.createElement('textarea');
        ta.value = this._programText || '';
        ta.spellcheck = false;
        ta.style = `flex:1;min-height:320px;background:#11111b;color:#a6e3a1;border:1px solid #313244;border-radius:4px;padding:10px;font-family:'Consolas',monospace;font-size:13px;line-height:1.5;resize:vertical;white-space:pre;`;
        box.appendChild(ta);

        const err = document.createElement('div');
        err.style = 'font-size:12px;color:#f38ba8;margin-top:6px;min-height:16px;';
        box.appendChild(err);

        const btnRow = document.createElement('div');
        btnRow.style = 'display:flex;justify-content:flex-end;gap:10px;margin-top:12px;';
        const mkBtn = (text, bg, onClick) => {
            const b = document.createElement('button');
            b.innerText = text;
            b.style = `padding:8px 16px;border:none;border-radius:4px;cursor:pointer;font-size:13px;color:#fff;background:${bg};`;
            b.onclick = onClick;
            return b;
        };
        btnRow.appendChild(mkBtn('取消', '#6c7086', () => modal.remove()));
        btnRow.appendChild(mkBtn('保存并下载', '#1f9d55', () => {
            this._programText = ta.value;
            this.config.program = ta.value;
            if (this.sys.s7200Solver) {
                this.sys.s7200Solver.reloadProgram(this.id);
                const d = this.sys.s7200Solver.getDiagnostics(this.id);
                if (d && d.error) {
                    err.innerText = '程序存在错误：' + d.error;
                    return;
                }
            }
            this._tip('程序已下载，CPU 将按新程序执行');
            modal.remove();
        }));
        box.appendChild(btnRow);

        modal.appendChild(box);
        // 点击遮罩关闭
        modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
        this.sys.container.appendChild(modal);
        requestAnimationFrame(() => ta.focus());
    }

    _loadProgramFile() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.txt,.awl,.stl,.prg';
        input.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => {
                this._programText = String(ev.target.result || '');
                this.config.program = this._programText;
                if (this.sys.s7200Solver) this.sys.s7200Solver.reloadProgram(this.id);
                this._tip(`已加载程序：${file.name}`);
                if (this.sys.requestRedraw) this.sys.requestRedraw();
            };
            reader.readAsText(file);
        };
        input.click();
    }

    _resetCPU() {
        if (this.sys.s7200Solver) this.sys.s7200Solver.resetPLC(this.id);
        this._tip('CPU 已重置');
        if (this.sys.requestRedraw) this.sys.requestRedraw();
    }

    _showIOViewer() {
        const d = this._display || { di: [], dq: [], scanCount: 0 };
        const old = document.getElementById('plc-io-viewer');
        if (old) old.remove();

        const modal = document.createElement('div');
        modal.id = 'plc-io-viewer';
        modal.style = `position:fixed;inset:0;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;z-index:9999;`;
        const box = document.createElement('div');
        box.style = `background:#1e1e2e;border-radius:8px;width:520px;max-width:92vw;max-height:86vh;overflow:auto;padding:18px;color:#cdd6f4;font-family:'Consolas',monospace;font-size:13px;`;

        let html = `<h3 style="color:#89b4fa;margin:0 0 10px;">S7-200 SR40 I/O 状态（扫描 ${d.scanCount || 0}）</h3>`;
        html += '<div style="color:#a6adc8;margin-bottom:6px;">数字量输入 I</div><div>';
        this.diPins.forEach((pin, i) => {
            const bitIdx = parseInt(pin.substring(2), 10); // di00 → 00
            const byte = Math.floor(bitIdx / 10), bit = bitIdx % 10;
            const on = d.di && d.di[i];
            html += `<span style="display:inline-block;min-width:74px;color:${on ? '#a6e3a1' : '#585b70'};">I${byte}.${bit}:${on ? '1' : '0'}</span>`;
        });
        html += '</div><div style="color:#a6adc8;margin:10px 0 6px;">数字量输出 Q</div><div>';
        this.dqPins.forEach((pin, i) => {
            const bitIdx = parseInt(pin.substring(2), 10);
            const byte = Math.floor(bitIdx / 10), bit = bitIdx % 10;
            const on = d.dq && d.dq[i];
            html += `<span style="display:inline-block;min-width:74px;color:${on ? '#fab387' : '#585b70'};">Q${byte}.${bit}:${on ? '1' : '0'}</span>`;
        });
        html += '</div>';

        box.innerHTML = html;
        const closeBtn = document.createElement('button');
        closeBtn.innerText = '关闭';
        closeBtn.style = 'margin-top:14px;padding:8px 16px;border:none;border-radius:4px;cursor:pointer;background:#6c7086;color:#fff;';
        closeBtn.onclick = () => modal.remove();
        box.appendChild(closeBtn);

        modal.appendChild(box);
        modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
        this.sys.container.appendChild(modal);
    }

    // ═══════════════════════════════════════════════════════════════
    // 配置对话框
    // ═══════════════════════════════════════════════════════════════
    getConfigFields() {
        return [
            { label: '位号/名称', key: 'label', type: 'text', get: c => c.label },
            { label: '运行模式', key: 'mode', type: 'select',
              get: c => c.mode,
              options: [
                { label: 'RUN（执行程序）', value: 'RUN' },
                { label: 'STOP（停止执行）', value: 'STOP' },
              ] },
            { label: '程序行数', key: 'progLines', type: 'number', disabled: true,
              get: c => (c._programText || '').split(/\r?\n/).length },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label !== undefined) this.label = cfg.label;
        if (cfg.mode !== undefined && cfg.mode !== this.mode) {
            this.mode = cfg.mode;
            if (this.mode === 'RUN' && this.sys.s7200Solver) this.sys.s7200Solver.reloadProgram(this.id);
        }
        this.config = { ...this.config, ...cfg };
        this._updateDisplay();
        if (this.sys.requestRedraw) this.sys.requestRedraw();
    }

    // ═══════════════════════════════════════════════════════════════
    // 公开 API（供外部/工作流调用）
    // ═══════════════════════════════════════════════════════════════
    setProgram(text) {
        this._programText = String(text || '');
        this.config.program = this._programText;
        if (this.sys.s7200Solver) this.sys.s7200Solver.reloadProgram(this.id);
    }
    getProgram() { return this._programText; }
    setMode(m) { if (m !== this.mode) this.toggleMode(); }
    isRunning() { return this.mode === 'RUN'; }
    getDigitalInputs() { return (this._display && this._display.di) || []; }
    getDigitalOutputs() { return (this._display && this._display.dq) || []; }
    getScanCount() { return (this._display && this._display.scanCount) || 0; }
}

function configMode(config) {
    return (config && config.mode === 'STOP') ? 'STOP' : 'RUN';
}

export default S7_200_SMART_SR40;
