/**
 * DI.js — 数字量输入模块 (Digital Input Module)
 * 船舶机舱监测报警系统 · CAN 总线架构
 *
 * 硬件规格：
 *   - 2路 干接点输入 (CH1, CH2 — 无源触点，内部提供 24V 检测电压)
 *   - 2路 湿接点输入 (CH3, CH4 — 有源输入，外部提供 24V 信号)
 *   - CAN 总线接口 (CANH / CANL)
 *   - DC 24V 电源接口
 *   - 4路通道状态指示灯 (每通道1个)
 *   - 4个模块状态指示灯：PWR / RUN / FLT / COM
 *   - 4位地址码拨码开关 (SW1~SW4，二进制编码，地址范围 0-15)
 *   - 1个终端电阻使能开关 (120Ω)
 */

import { BaseComponent } from '../components/BaseComponent.js';
import { CAN_FUNC, CANId, NMT_CMD, NMT_STATE } from './CANBUS.js';

// ─────────────────────────────────────────────
//  常量
// ─────────────────────────────────────────────
const W = 200;
const H = 340;

const CH_CONFIG = [
    { id: 'ch1', label: 'CH1', type: 'DRY', desc: 'Dry NC' },
    { id: 'ch2', label: 'CH2', type: 'DRY', desc: 'Dry NC' },
    { id: 'ch3', label: 'CH3', type: 'WET', desc: 'Wet 24V' },
    { id: 'ch4', label: 'CH4', type: 'WET', desc: 'Wet 24V' },
];


// 消抖时间 (ms)
const DEBOUNCE_MS = 20;

// ─────────────────────────────────────────────
//  主类
// ─────────────────────────────────────────────
export class DIModule extends BaseComponent {

    constructor(config, sys) {
        super(config, sys);

        this.w = W;
        this.h = H;
        this.scale = 1.35;
        this.type = 'DI';
        this.special ='can';
        this.cache = 'fixed';

        this.powerOn = false;
        this.isBreak = false; // 线路断开状态（模拟电源断开或输出回路故障）
        this.commFault = false; // 通信故障标志
        this.moduleFault = false; // 模块故障标志（如过温、内部错误等）
        this.channelFault = false; // 通道1故障状态

        this.nodeAddress = (config && config.nodeAddress != null) ? config.nodeAddress : 3;
        this.termEnabled = false;
        this.currentResistance = 1000000; // 120Ω 或 ∞

        // ── 通道数据 ──
        // state:      当前稳定逻辑状态 (true=闭合/ON)
        // raw:        原始采样状态（消抖前）
        // debounceAt: 最近一次原始变化时间戳
        // fault:      湿接点电压超范围 / 干接点线路短路故障
        // counter:    脉冲计数（上升沿计数）
        // lastEdge:   上一次边沿方向 ('rise'|'fall')
        this.channels = {
            ch1: { type: 'DRY', state: false, raw: false, debounceAt: 0, fault: false, counter: 0, lastEdge: null },
            ch2: { type: 'DRY', state: false, raw: false, debounceAt: 0, fault: false, counter: 0, lastEdge: null },
            ch3: { type: 'WET', state: false, raw: false, debounceAt: 0, fault: false, counter: 0, lastEdge: null, voltage: 0 },
            ch4: { type: 'WET', state: false, raw: false, debounceAt: 0, fault: false, counter: 0, lastEdge: null, voltage: 0 },
        };

        // ── 事件记录（最近 8 条变化事件）──
        this.eventLog = [];
        this.maxEventLog = 8;

        // ── 报警配置（可由中央计算机下发修改）──
        // trigger: 'ON'=闭合报警, 'OFF'=断开报警, 'NONE'=不报警
        this.alarmConfig = {
            ch1: { trigger: 'OFF', label: 'CH1 ALARM' },
            ch2: { trigger: 'OFF', label: 'CH2 ALARM' },
            ch3: { trigger: 'ON', label: 'CH3 ALARM' },
            ch4: { trigger: 'ON', label: 'CH4 ALARM' },
        };

        // ── 模块状态灯 ──
        this.ledStatus = { pwr: false, run: false, flt: false, com: false };

        // ── CAN 总线状态 ──
        this.canBusConnected = false;
        this.lastTxTime = 0;
        this.lastRxTime = 0;
        this.txCount = 0;
        this.rxCount = 0;
        this.txInterval = 200;  // ms，周期上报
        this._txOnChange = true; // 状态变化时立即上报
        this.heartbeatTimeout = 5000; // ms，心跳超时判定

        this.busConnected = false;
        this.comErrorCount = 0;


        // ── NMT 网络管理状态机 ──
        this.nmtState = NMT_STATE.INIT;
        this.nmtStateTime = Date.now();

        this._initVisuals();
        this._initPorts();
        this._initInteraction();
        this._startLoop();
    }

    // ══════════════════════════════════════════
    //  界面绘制
    // ══════════════════════════════════════════
    _initVisuals() {
        this.scaleGroup = new Konva.Group({ scaleX: this.scale, scaleY: this.scale });
        this.group.add(this.scaleGroup);
        this._drawBody();
        this._drawHeader();
        this._drawChannelRows();
        this._drawStatusLEDs();
        this._drawAddressSwitch();
        this._drawTermSwitch();
        this._drawBottomPanel();
        this._drawPortLabels();
    }

    _drawBody() {
        const sg = this.scaleGroup;
        const railAttr = { width: 18, height: H, fill: '#9e9e9e', stroke: '#555', strokeWidth: 1.5, cornerRadius: 2 };
        sg.add(new Konva.Rect({ x: -18, y: 0, ...railAttr }));
        sg.add(new Konva.Rect({ x: W, y: 0, ...railAttr }));
        sg.add(new Konva.Rect({
            x: 0, y: 0, width: W, height: H,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint: { x: W, y: 0 },
            fillLinearGradientColorStops: [0, '#2c2c2c', 0.5, '#3a3a3a', 1, '#2c2c2c'],
            stroke: '#222', strokeWidth: 3, cornerRadius: 3
        }));
        // 顶部装饰条：绿色（DI）
        sg.add(new Konva.Rect({ x: 0, y: 0, width: W, height: 6, fill: '#007733', cornerRadius: [3, 3, 0, 0] }));
    }

    _drawHeader() {
        const sg = this.scaleGroup;
        sg.add(new Konva.Rect({ x: 4, y: 8, width: W - 8, height: 30, fill: '#111', stroke: '#007733', strokeWidth: 1, cornerRadius: 2 }));
        sg.add(new Konva.Text({ x: 6, y: 12, text: 'DI-4通道', fontSize: 14, fontFamily: 'Courier New', fontStyle: 'bold', fill: '#00cc55' }));
        sg.add(new Konva.Text({ x: 6, y: 28, text: 'DIGITAL  INPUT  MODULE', fontSize: 7, fill: '#1c8257' }));
        this._nodeAddrDisplay = new Konva.Text({
            x: 128, y: 14, text: `NODE:${String(this.nodeAddress).padStart(2, '0')}`,
            fontSize: 10, fontFamily: 'Courier New', fill: '#ffcc00'
        });
        sg.add(this._nodeAddrDisplay);
    }

    _drawChannelRows() {
        this._chDisplays = {};
        this._chLEDs = {};

        CH_CONFIG.forEach((ch, i) => {
            const y = 44 + i * 52;
            const sg = this.scaleGroup;

            // 通道背景框
            sg.add(new Konva.Rect({ x: 4, y, width: W - 8, height: 48, fill: '#0a0a0a', stroke: '#333', strokeWidth: 1, cornerRadius: 2 }));

            // 通道标签
            sg.add(new Konva.Text({ x: 8, y: y + 4, text: ch.label, fontSize: 10, fontStyle: 'bold', fill: '#ef1313' }));
            sg.add(new Konva.Text({ x: 8, y: y + 16, text: ch.desc, fontSize: 7, fill: '#555' }));

            // 接点类型标记（DRY / WET 色块）
            const typeColor = ch.type === 'DRY' ? '#1a3a1a' : '#1a2a3a';
            const typeFg = ch.type === 'DRY' ? '#00cc55' : '#00aaff';
            sg.add(new Konva.Rect({ x: 8, y: y + 28, width: 28, height: 12, fill: typeColor, stroke: typeFg, strokeWidth: 0.5, cornerRadius: 1 }));
            sg.add(new Konva.Text({ x: 8, y: y + 29, text: ch.type, fontSize: 7, fill: typeFg, width: 28, align: 'center' }));

            // 状态大字显示区域
            const dispBg = new Konva.Rect({ x: 44, y: y + 4, width: 100, height: 38, fill: '#050505', stroke: '#1a3a1a', strokeWidth: 1, cornerRadius: 1 });
            sg.add(dispBg);

            const stateText = new Konva.Text({
                x: 46, y: y + 10, width: 96, text: '---',
                fontSize: 20, fontFamily: 'Courier New', fontStyle: 'bold',
                fill: '#333', align: 'center'
            });
            sg.add(stateText);

            // 湿接点电压小字
            const voltText = new Konva.Text({ x: 46, y: y + 32, width: 96, text: '', fontSize: 7, fill: '#444', align: 'center' });
            sg.add(voltText);

            // 通道状态指示灯
            const led = new Konva.Circle({ x: 162, y: y + 14, radius: 5, fill: '#222', stroke: '#111', strokeWidth: 1 });
            sg.add(led);
            sg.add(new Konva.Text({ x: 170, y: y + 10, text: 'STA', fontSize: 7, fill: '#f4eded' }));

            // 报警状态
            const almText = new Konva.Text({ x: 162, y: y + 24, text: '----', fontSize: 8, fill: '#555', width: 34, align: 'center' });
            sg.add(almText);

            // 脉冲计数小字
            const cntText = new Konva.Text({ x: 8, y: y + 30, text: '', fontSize: 7, fill: '#444' });
            sg.add(cntText);

            this._chDisplays[ch.id] = { bg: dispBg, state: stateText, volt: voltText, alm: almText, cnt: cntText };
            this._chLEDs[ch.id] = led;
        });
    }

    _drawStatusLEDs() {
        const sg = this.scaleGroup;
        const y = 256;
        const defs = [
            { id: 'pwr', label: 'PWR', color: '#00ff00', x: 14 },
            { id: 'run', label: 'RUN', color: '#00ff00', x: 58 },
            { id: 'flt', label: 'FLT', color: '#ff3300', x: 102 },
            { id: 'com', label: 'COM', color: '#00aaff', x: 146 },
        ];
        sg.add(new Konva.Rect({ x: 4, y: y - 4, width: W - 8, height: 28, fill: '#0a0a0a', stroke: '#333', strokeWidth: 1, cornerRadius: 2 }));
        sg.add(new Konva.Text({ x: 8, y: y - 8, text: '状态指示灯', fontSize: 8, fill: '#f5eeee' }));
        this._statusLEDs = {};
        defs.forEach(d => {
            const dot = new Konva.Circle({ x: d.x + 10, y: y + 10, radius: 5, fill: '#222', stroke: '#111', strokeWidth: 1 });
            const txt = new Konva.Text({ x: d.x - 4, y: y + 16, text: d.label, fontSize: 7, fill: '#f2ecec', width: 28, align: 'center' });
            this._statusLEDs[d.id] = { dot, color: d.color };
            sg.add(dot, txt);
        });
    }

    _drawAddressSwitch() {
        const sg = this.scaleGroup;
        const y = 288;
        const swW = 18, gap = 22;

        sg.add(new Konva.Rect({ x: 4, y: y - 2, width: W - 8, height: 38, fill: '#0a0a0a', stroke: '#333', strokeWidth: 1, cornerRadius: 2 }));
        sg.add(new Konva.Text({ x: 8, y: y - 4, text: '节点地址', fontSize: 8, fill: '#f4ecec' }));

        this._swObjs = [];
        for (let i = 0; i < 4; i++) {
            const bitVal = 1 << i;
            const x0 = 14 + i * gap;
            const isOn = (this.nodeAddress & bitVal) !== 0;
            const swBg = new Konva.Rect({ x: x0, y: y + 8, width: swW, height: 26, fill: '#1a1a1a', stroke: '#444', strokeWidth: 1, cornerRadius: 2 });
            const knob = new Konva.Rect({ x: x0 + 3, y: isOn ? y + 10 : y + 22, width: swW - 6, height: 10, fill: isOn ? '#ffcc00' : '#333', stroke: '#555', strokeWidth: 1, cornerRadius: 1 });
            const lbl = new Konva.Text({ x: x0, y: y + 35, text: `SW${i + 1}`, fontSize: 6, fill: '#fcf8f8', width: swW, align: 'center' });
            const vLbl = new Konva.Text({ x: x0, y: y + 12, text: bitVal.toString(), fontSize: 6, fill: '#444', width: swW, align: 'center' });
            swBg.on('click tap', () => {
                if (this.nodeAddress & bitVal) this.nodeAddress &= ~bitVal;
                else this.nodeAddress |= bitVal;
                this._refreshSwitches();
                this._nodeAddrDisplay.text(`NODE:${String(this.nodeAddress).padStart(2, '0')}`);
                this._refreshCache();
            });
            vLbl.on('click tap', () => {
                if (this.nodeAddress & bitVal) this.nodeAddress &= ~bitVal;
                else this.nodeAddress |= bitVal;
                this._refreshSwitches();
                this._nodeAddrDisplay.text(`NODE:${String(this.nodeAddress).padStart(2, '0')}`);
                this._refreshCache();
            });
            this._swObjs.push({ knob, bitVal, y0: y });
            sg.add(swBg, knob, lbl, vLbl);
        }
        this._addrDecText = new Konva.Text({ x: 106, y: y + 10, text: String(this.nodeAddress), fontSize: 10, fontFamily: 'Courier New', fill: '#ffcc00', width: 30, align: 'left' });
        sg.add(this._addrDecText);
    }

    _drawTermSwitch() {
        const sg = this.scaleGroup;
        const x0 = 160, y0 = 288;
        sg.add(new Konva.Text({ x: x0 - 2, y: y0 - 6, text: '终端电阻', fontSize: 8, fill: '#f4efef' }));
        const termBg = new Konva.Rect({ x: x0 + 2, y: y0 + 8, width: 24, height: 26, fill: '#1a1a1a', stroke: '#444', strokeWidth: 1, cornerRadius: 2 });
        this._termKnob = new Konva.Rect({ x: x0 + 5, y: y0 + 22, width: 18, height: 10, fill: '#333', stroke: '#555', strokeWidth: 1, cornerRadius: 1 });
        const termLbl = new Konva.Text({ x: x0, y: y0 + 35, text: '120Ω', fontSize: 6, fill: '#f5f2f2', width: 32, align: 'center' });
        termBg.on('click tap', () => {
            this.termEnabled = !this.termEnabled;
            this.currentResistance = this.termEnabled ? 120 : 1000000;
            this._termKnob.y(this.termEnabled ? y0 + 10 : y0 + 22);
            this._termKnob.fill(this.termEnabled ? '#00aaff' : '#333');
            this._refreshCache();
        });
        sg.add(termBg, this._termKnob, termLbl);
    }

    _drawBottomPanel() {
        const sg = this.scaleGroup;
        sg.add(new Konva.Rect({ x: 0, y: H, width: W, height: 20, fill: '#9e9e9e', stroke: '#444', strokeWidth: 1.5 }));
        [{ x: 25, text: 'CAN1H' }, { x: 70, text: 'CAN1L' }, { x: 115, text: 'CAN2H' }, { x: 160, text: 'CAN2L' }]
            .forEach(l => sg.add(new Konva.Text({ x: l.x, y: H + 5, text: l.text, fontSize: 7, fill: '#222' })));
    }

    _drawPortLabels() {
        const sg = this.scaleGroup;
        CH_CONFIG.forEach((ch, i) => {
            const y = 44 + i * 52 + 14;
            // 干接点：COM / IN；湿接点：+ / -
            const labels = ch.type === 'DRY' ? ['IN', 'COM'] : ['24V+', 'COM'];
            sg.add(new Konva.Text({ x: -44, y, text: `${ch.label} ${labels[0]}`, fontSize: 7, fill: '#0d05f2' }));
            sg.add(new Konva.Text({ x: -44, y: y + 14, text: `${ch.label} ${labels[1]}`, fontSize: 7, fill: '#0d05f2' }));
        });
        sg.add(new Konva.Text({ x: W + 2, y: 10, text: 'VCC', fontSize: 7, fill: '#0d05f2' }));
        sg.add(new Konva.Text({ x: W + 2, y: 38, text: 'GND', fontSize: 7, fill: '#0d05f2' }));
    }

    // ══════════════════════════════════════════
    //  接线端口注册
    // ══════════════════════════════════════════
    _initPorts() {
        CH_CONFIG.forEach((ch, i) => {
            const yBase = 44 + i * 52;
            this.addPort(-18 * this.scale, (yBase + 12) * this.scale, `${ch.id}p`, 'wire', 'p');
            this.addPort(-18 * this.scale, (yBase + 38) * this.scale, `${ch.id}n`, 'wire');
        });
        this.addPort((W + 18) * this.scale, 12 * this.scale, 'vcc', 'wire', 'p');
        this.addPort((W + 18) * this.scale, 38 * this.scale, 'gnd', 'wire');
        this.addPort(35 * this.scale, (H + 20) * this.scale, 'can1p', 'wire', 'p');
        this.addPort(80 * this.scale, (H + 20) * this.scale, 'can1n', 'wire');
        this.addPort(125 * this.scale, (H + 20) * this.scale, 'can2p', 'wire', 'p');
        this.addPort(170 * this.scale, (H + 20) * this.scale, 'can2n', 'wire');
    }

    // ══════════════════════════════════════════
    //  交互（仿真用：点击通道区域手动拨动接点）
    // ══════════════════════════════════════════
    _initInteraction() {
        CH_CONFIG.forEach(ch => {
            // 点击通道显示区域模拟接点开合
            const disp = this._chDisplays[ch.id];
            disp.bg.on('click tap', () => {
                const cur = this.channels[ch.id].raw;
                this._injectRaw(ch.id, !cur);
            });
            disp.bg.listening(true);
        });

        // 双击模块：清除计数和通信错误
        this.scaleGroup.on('dblclick', () => {
            Object.keys(this.channels).forEach(id => { this.channels[id].counter = 0; });
            this.comErrorCount = 0;
            this._refreshCache();
        });
    }

    // ══════════════════════════════════════════
    //  主循环
    // ══════════════════════════════════════════
    _startLoop() {
        this._loopTimer = setInterval(() => {
            try {
                this.powerOn = this.sys.getVoltageBetween(`${this.id}_wire_vcc`, `${this.id}_wire_gnd`) > 18 && this.isBreak === false;
                this.busConnected = this.sys.isPortConnected(`${this.id}_wire_can1p`, 'can_wire_can1p') &&
                    this.sys.isPortConnected(`${this.id}_wire_can1n`, 'can_wire_can1n');
            } catch (_) { }
            this._tick();
        }, 50);

        // 启动时设置NMT为初始化状态
        this.nmtState = NMT_STATE.INIT;
        this.nmtStateTime = Date.now();
    }

    // ══════════════════════════════════════════
    //  NMT 状态管理
    // ══════════════════════════════════════════
    /**
     * 处理NMT命令
     */
    _handleNMT(cmd) {
        if (cmd === NMT_CMD.START) {
            if (this.nmtState === NMT_STATE.INIT || this.nmtState === NMT_STATE.PREOP) {
                this.nmtState = NMT_STATE.RUN;
                this.nmtStateTime = Date.now();
                console.log(`[DI #${this.nodeAddress}] NMT: Starting → ${NMT_STATE.RUN} state`);
            }
        } else if (cmd === NMT_CMD.STOP) {
            if (this.nmtState === NMT_STATE.RUN) {
                this.nmtState = NMT_STATE.STOP;
                this.nmtStateTime = Date.now();
                console.log(`[DI #${this.nodeAddress}] NMT: Stopping → ${NMT_STATE.STOP} state`);
            }
        } else if (cmd === NMT_CMD.RESET) {
            this.nmtState = NMT_STATE.INIT;
            this.nmtStateTime = Date.now();
            this.txCount = 0;
            this.rxCount = 0;
            this.comErrorCount = 0;
            this.lastTxTime = 0;
            this.lastRxTime = 0;
            console.log(`[DI #${this.nodeAddress}] NMT: Resetting → ${NMT_STATE.INIT} state`);
        } else if (cmd === NMT_CMD.RESETCOM) {
            this.comErrorCount = 0;
            this.lastTxTime = 0;
            this.lastRxTime = 0;
            this.txCount = 0;
            this.rxCount = 0;
            console.log(`[DI #${this.nodeAddress}] NMT: Communication reset`);
        }
    }

    /**
     * 检查是否允许发送数据
     */
    _isCanTransmit() {
        return this.nmtState === NMT_STATE.RUN;
    }

    _tick() {
        const now = Date.now();

        if (!this.powerOn) { this._renderOff(); return; }

        this.ledStatus.pwr = true;
        // 3. sysFault（死机）：停止工作
        if (this.sysFault) {
            this.ledStatus.run = false;
            this.ledStatus.flt = true;
            this.ledStatus.com = false;
            this._render();
            return;
        }
        // 4. 心跳超时：RUN → PREOP
        if (now - this._lastHeartbeat > this.heartbeatTimeout && this.nmtState === NMT_STATE.RUN) {
            this.nmtState = NMT_STATE.PREOP;
            this.nmtStateTime = now;
            console.log(`[AO #${this.nodeAddress}] Heartbeat lost → ${NMT_STATE.PREOP} state`);
        }
        this.ledStatus.run = (now % 1000) < 500;

        // 湿接点电压读取（可由仿真引擎注入）
        ['ch3', 'ch4'].forEach(id => {
            const ch = this.channels[id];
            try {
                ch.voltage = this.sys.getVoltageBetween(`${this.id}_wire_${id}p`, `${this.id}_wire_${id}n`);
                const newRaw = ch.voltage > 15; // 15V 阈值
                this._injectRaw(id, newRaw);
                ch.fault = ch.voltage > 0 && ch.voltage < 8; // 8~15V 为不确定区域，标记故障
            } catch (_) { /* 未建模时忽略 */ }
        });
        ['ch1', 'ch2'].forEach(id => {
            const ch = this.channels[id];
            try {
                const voltage = this.sys.getVoltageBetween(`${this.id}_wire_${id}p`, `${this.id}_wire_${id}n`);
                const newRaw = this.sys.isPortConnected(`${this.id}_wire_${id}p`, `${this.id}_wire_${id}n`);
                this._injectRaw(id, newRaw);
                ch.fault = voltage > 1; // 干接点正常应为0V，非0V可能表示接线错误
            } catch (_) { /* 未建模时忽略 */ }
        });
        // 消抖处理
        this._processDebounce(now);

        // CAN 周期上报 - 仅在RUN状态下发送
        if (this._isCanTransmit() && now - this.lastTxTime >= this.txInterval) {
            this._canTransmit();
            this.lastTxTime = now;
        }

        this.ledStatus.com = (now - this.lastTxTime < 80) || (now - this.lastRxTime < 80);
        this.ledStatus.flt = this.moduleFault || this.commFault || this.sysFault;
        if (this.powerOn && this.busConnected && !this.commFault) this.sys.canBus.setNodeOnline(this.id);
        else this.sys.canBus.resetNodeOnline(this.id);

        this._render();
    }

    // ══════════════════════════════════════════
    //  消抖处理
    // ══════════════════════════════════════════
    _processDebounce(now) {
        Object.keys(this.channels).forEach(id => {
            const ch = this.channels[id];
            if (ch.raw !== ch.state && (now - ch.debounceAt) >= DEBOUNCE_MS) {
                const prev = ch.state;
                ch.state = ch.raw;
                // 边沿检测
                if (!prev && ch.state) {
                    ch.lastEdge = 'rise';
                    ch.counter++;
                    this._logEvent(id, 'RISE');
                    if (this._txOnChange) { this._canTransmit(); this.lastTxTime = now; }
                } else if (prev && !ch.state) {
                    ch.lastEdge = 'fall';
                    this._logEvent(id, 'FALL');
                    if (this._txOnChange) { this._canTransmit(); this.lastTxTime = now; }
                }
            }
        });
    }

    _logEvent(chId, edge) {
        const ts = new Date().toTimeString().slice(0, 8);
        this.eventLog.unshift(`${ts} ${chId.toUpperCase()} ${edge}`);
        if (this.eventLog.length > this.maxEventLog) this.eventLog.pop();
    }

    // ══════════════════════════════════════════
    //  CAN 总线通信
    // ══════════════════════════════════════════
    /**
     * 上报帧 ID = (CAN_FUNC_DI << 7) | nodeAddress
     * Data（4字节）：
     *   Byte 0: 通道状态位 [bit0=ch1 … bit3=ch4]
     *   Byte 1: 故障位     [bit0=ch1 … bit3=ch4]
     *   Byte 2: 报警位     [bit0=ch1 … bit3=ch4]
     *   Byte 3: 保留
     */
    _canTransmit() {
        // ── NMT 状态检查：仅在运行状态下才发送数据 ──
        if (!this._isCanTransmit()) {
            return;
        }

        if (!this.sys || typeof this.sys.canBus === 'undefined') return;

        const stateByte = ['ch1', 'ch2', 'ch3', 'ch4'].reduce((b, id, i) =>
            b | (this.channels[id].state ? (1 << i) : 0), 0);
        const faultByte = ['ch1', 'ch2', 'ch3', 'ch4'].reduce((b, id, i) =>
            b | (this.channels[id].fault ? (1 << i) : 0), 0);
        const alarmByte = ['ch1', 'ch2', 'ch3', 'ch4'].reduce((b, id, i) => {
            const alm = this.alarmConfig[id];
            const ch = this.channels[id];
            const alarm =(alm.trigger === 'NONE')?false: (alm.trigger === 'ON' && ch.state) ||
                (alm.trigger === 'OFF' && !ch.state);
            return b | (alarm ? (1 << i) : 0);
        }, 0);

        const frame = {
            id: CANId.encode(CAN_FUNC.DI_REPORT, this.nodeAddress),
            extended: false, rtr: false, dlc: 4,
            data: [stateByte, faultByte, alarmByte, 0x00],
            sender: this.id,
            timestamp: Date.now(),
        };

        try {
            this.sys.canBus.send(frame);
            // console.log(`[DI #${this.nodeAddress}] Report sent: State=${stateByte.toString(2).padStart(4, '0')} Fault=${faultByte.toString(2).padStart(4, '0')} Alarm=${alarmByte.toString(2).padStart(4, '0')}`);
            this.txCount++;
            this.canBusConnected = true;
        } catch (e) {
            this.comErrorCount++;
            this.canBusConnected = false;
        }
    }

    /**
     * 接收配置帧（来自中央计算机）
     * 配置帧 ID = (0x30 << 7) | nodeAddress
     *   Byte 0: cmd
     *     0x01 — 修改报警触发极性 (Byte1=chMask, Byte2=triggerMask 1=ON/0=OFF)
     *     0x02 — 清除计数器       (Byte1=chMask)
     *     0x03 — 修改上报周期     (Byte1-2=ms)
     *     0x04 — 修改消抖时间     (Byte1-2=ms，全局)
     */
    onCanReceive(frame) {
        if (!frame) return;

        // 解析帧 ID
        const { funcCode, nodeAddr } = CANId.decode(frame.id);

        // ── 处理NMT命令 ──
        if (funcCode === CAN_FUNC.NMT) {
            const nmtCmd = frame.data[0];
            const targetAddr = frame.data[1];
            if (targetAddr === 0 || targetAddr === this.nodeAddress) {
                this._handleNMT(nmtCmd);
            }
            return;
        }
        // ── 广播心跳（Operational = 0x05）──
        if (funcCode === CAN_FUNC.BROADCAST) {
            if (frame.data && frame.data.length > 0 && frame.data[0] === 0x05) {
                this._lastHeartbeat = Date.now();
                if (this.nmtState === NMT_STATE.PREOP || this.nmtState === NMT_STATE.INIT) {
                    this.nmtState = NMT_STATE.RUN;
                    this.nmtStateTime = Date.now();
                    console.log(`[DI #${this.nodeAddress}] Heartbeat received → ${NMT_STATE.RUN} state`);
                }
            }
            return;
        }
        // ── 处理配置命令 ──
        if (frame.id !== CANId.encode(CAN_FUNC.DI_CONFIG,this.nodeAddress )) return;
        this.lastRxTime = Date.now();
        this.rxCount++;

        const cmd = frame.data[0];
        const chKeys = ['ch1', 'ch2', 'ch3', 'ch4'];
        const chMask = frame.data[1] || 0;

        switch (cmd) {
            // 0x04 — 查询报警触发配置
            case 0x04:
                const chIdxQuery = frame.data[1];  // Byte1: 通道索引 (0-3)
                const chKeysQuery = ['ch1', 'ch2', 'ch3', 'ch4'];
                if (chIdxQuery >= 0 && chIdxQuery < 4) {
                    const idQuery = chKeysQuery[chIdxQuery];
                    const currentTrigger = this.alarmConfig[idQuery]?.trigger || 'OFF';
                    const triggerValueMap = { 'OFF': 0, 'ON': 1, 'NONE': 2 };
                    const triggerValue = triggerValueMap[currentTrigger] || 0;
                    
                    // 发送查询回复
                    try {
                        this.sys.canBus.send({
                            id: CANId.encode(CAN_FUNC.DI_REPLY, this.nodeAddress),
                            extended: false, rtr: false, dlc: 3,
                            data: [0x04, chIdxQuery, triggerValue, 0, 0, 0, 0, 0],
                            sender: this.id, timestamp: Date.now()
                        });
                    } catch (e) {
                        console.warn('[DI] 报警配置查询回复发送失败', e);
                    }
                }
                break;
            // 修改报警触发极性
            case 0x01:
                const chIdx = frame.data[2];  // Byte2: 通道索引 (0-3)
                const triggerValue = frame.data[3];  // Byte3: 触发值 (0=OFF, 1=ON, 2=NONE)
                if (chIdx >= 0 && chIdx < 4) {
                    const id = chKeys[chIdx];
                    if (triggerValue === 1) this.alarmConfig[id].trigger = 'ON';
                    else if (triggerValue === 2) this.alarmConfig[id].trigger = 'NONE';
                    else this.alarmConfig[id].trigger = 'OFF';
                }
                // 发送回复
                try {
                    this.sys.canBus.send({
                        id: CANId.encode(CAN_FUNC.DI_REPLY, this.nodeAddress),
                        extended: false, rtr: false, dlc: 3,
                        data: [0x01, chIdx, triggerValue, 0, 0, 0, 0, 0],
                        sender: this.id, timestamp: Date.now()
                    });
                } catch (e) {
                    console.warn('[DI] 报警配置回复发送失败', e);
                }
                break;
                // 清除计数器
            case 0x02:
                chKeys.forEach((id, i) => {
                    if (chMask & (1 << i)) this.channels[id].counter = 0;
                });
                break;
                // 修改上报周期
            case 0x03:
                this.txInterval = Math.max(50, (frame.data[1] << 8) | frame.data[2]);
                break;
                // NMT测试命令，回复自己的ID
            case 0xEE:
                const id = this.id; // 例如 "hello" 或 "hello world"

                // 1. 初始化数组：0xEE 开头，后面跟 7 个 0 占位
                // 这样如果字符串不足 7 位，剩下的会自动补 0
                const payload = [0xEE, 0, 0, 0, 0, 0, 0, 0];

                // 2. 将字符串截取前 7 位，并转换为 ASCII 码填入
                for (let i = 0; i < 7; i++) {
                    if (i < id.length) {
                        payload[i + 1] = id.charCodeAt(i); // i+1 是因为第 0 位是 0xEE
                    }
                }
                console.log(`[DI #${this.nodeAddress}] NMT Test Command Received, replying with ID: ${id}`);

                this._sendResponse(payload);
                break;                
        }
    }
    _sendResponse (responseData) {
        if (!this.sys || typeof this.sys.canBus === 'undefined') return;

        const frameId = CANId.encode(CAN_FUNC.DI_REPLY, this.nodeAddress & 0x0F);
        const frame = {
            id: frameId, extended: false, rtr: false, dlc: 8,
            data: responseData, sender: this.id, timestamp: Date.now(),
        };

        try {
            this.sys.canBus.send(frame);
            this.txCount++;
            this.canBusConnected = true;
        } catch (e) {
            if (++this.comErrorCount > 10) this.ledStatus.flt = true;
            this.canBusConnected = false;
        }
    };
    // ══════════════════════════════════════════
    //  渲染
    // ══════════════════════════════════════════
    _render() {
        CH_CONFIG.forEach(ch => {
            const cData = this.channels[ch.id];
            const disp = this._chDisplays[ch.id];
            const led = this._chLEDs[ch.id];
            const alm = this.alarmConfig[ch.id];

            if (cData.fault) {
                disp.state.text('ERR');
                disp.state.fill('#ff3300');
                disp.bg.stroke('#550000');
                disp.alm.text('FLT');
                disp.alm.fill('#ff3300');
                led.fill('#ff3300');
                disp.volt.text(ch.type === 'WET' ? `${cData.voltage.toFixed(1)}V ?` : '');
                disp.cnt.text(`CNT:${cData.counter}`);
                return;
            }

            const on = cData.state;

            // 状态大字
            disp.state.text(on ? ' ON ' : 'OFF ');
            disp.state.fill(on ? '#00ff44' : '#555');
            disp.bg.stroke(on ? '#1a4a1a' : '#1a1a1a');

            // 指示灯
            led.fill(on ? '#00ff44' : '#222');

            // 湿接点电压标注
            disp.volt.text(ch.type === 'WET' ? `${(cData.voltage || 0).toFixed(1)}V` : '');

            // 报警判断
            const isAlarm = (alm.trigger === 'ON' && on) || (alm.trigger === 'OFF' && !on);
            disp.alm.text(isAlarm ? 'ALM' : '----');
            disp.alm.fill(isAlarm ? '#ff8800' : '#555');

            // 脉冲计数
            disp.cnt.text(`CNT:${cData.counter}`);
        });

        Object.keys(this._statusLEDs).forEach(id => {
            this._statusLEDs[id].dot.fill(this.ledStatus[id] ? this._statusLEDs[id].color : '#222');
        });
        this._refreshCache();
    }

    _renderOff() {
        CH_CONFIG.forEach(ch => {
            const d = this._chDisplays[ch.id];
            d.state.text(''); d.volt.text(''); d.alm.text(''); d.cnt.text('');
            d.bg.stroke('#333');
            this._chLEDs[ch.id].fill('#222');
        });
        Object.keys(this._statusLEDs).forEach(id => this._statusLEDs[id].dot.fill('#222'));
        this._refreshCache();
    }

    // ══════════════════════════════════════════
    //  拨码开关刷新
    // ══════════════════════════════════════════
    _refreshSwitches() {
        this._swObjs.forEach(sw => {
            const isOn = (this.nodeAddress & sw.bitVal) !== 0;
            sw.knob.y(isOn ? sw.y0 + 10 : sw.y0 + 22);
            sw.knob.fill(isOn ? '#ffcc00' : '#333');
        });
        this._addrDecText.text(String(this.nodeAddress));
    }

    // ══════════════════════════════════════════
    //  公开 API
    // ══════════════════════════════════════════

    /**
     * 注入原始信号（仿真引擎或测试用）
     * @param {string}  chId - 'ch1'~'ch4'
     * @param {boolean} val  - true=闭合/有信号
     */
    _injectRaw(chId, val) {
        const ch = this.channels[chId];
        if (!ch) return;
        if (ch.raw !== val) {
            ch.raw = val;
            ch.debounceAt = Date.now();
        }
    }

    /** 直接设置通道状态（跳过消抖，供快速仿真）*/
    setState(chId, val) {
        const ch = this.channels[chId];
        if (!ch) return;
        ch.raw = val;
        ch.state = val;
    }

    /** 获取所有通道状态快照 */
    getChannelStates() {
        return Object.keys(this.channels).reduce((acc, id) => {
            acc[id] = { state: this.channels[id].state, fault: this.channels[id].fault, counter: this.channels[id].counter };
            return acc;
        }, {});
    }

    /** 外部电源注入 */
    setPower(on) { this.powerOn = on; }

    destroy() {
        if (this._loopTimer) clearInterval(this._loopTimer);
        super.destroy && super.destroy();
    }
}