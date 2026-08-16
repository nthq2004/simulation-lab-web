/**
 * DO.js — 数字量输出模块 (Digital Output Module)
 * 船舶机舱监测报警系统 · CAN 总线架构
 *
 * 硬件规格：
 *   - 2路 继电器干接点输出 (CH1, CH2 — 常开/常闭无源触点，额定 250VAC/5A)
 *   - 2路 24V 湿接点输出   (CH3, CH4 — 内部 24V 驱动，NPN 晶体管输出)
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
    { id: 'ch1', label: 'CH1', type: 'RELAY', desc: 'Relay NO' },
    { id: 'ch2', label: 'CH2', type: 'RELAY', desc: 'Relay NO' },
    { id: 'ch3', label: 'CH3', type: 'WET24', desc: '24V PNP' },
    { id: 'ch4', label: 'CH4', type: 'WET24', desc: '24V PNP' },
];

// ─────────────────────────────────────────────
//  主类
// ─────────────────────────────────────────────
export class DOModule extends BaseComponent {

    constructor(config, sys) {
        super(config, sys);

        this.w = W;
        this.h = H;
        this.scale = 1.35;
        this.type = 'DO';
        this.special = 'can';
        this.cache = 'fixed';

        // ── 电源状态 ──
        this.powerOn = false;
        this.isBreak = false; // 线路断开状态（模拟电源断开或输出回路故障）
        this.commFault = false; // 通信故障标志
        this.moduleFault = false; // 模块故障标志（如过温、内部错误等）
        this.channelFault = false; // 通道1故障状态


        this.nodeAddress = (config && config.nodeAddress != null) ? config.nodeAddress : 4;
        this.termEnabled = false;
        this.currentResistance = 1000000; // 默认高阻（未启用终端电阻）
        this.ch1R = 1000000;
        this.ch2R = 1000000;

        // ── 通道输出数据 ──
        // state:     当前输出逻辑状态 (true=吸合/导通)
        // fault:     输出故障（继电器线圈断路 / 晶体管过流）
        // hold:      通信超时安全锁定标志
        // toggleCnt: 继电器动作次数（寿命计数）
        // loadMA:    湿接点通道负载电流（仿真值，mA）
        this.channels = {
            ch1: { type: 'RELAY', state: false, fault: false, hold: false, toggleCnt: 0, coilOK: true, mode: 'hand' },
            ch2: { type: 'RELAY', state: false, fault: false, hold: false, toggleCnt: 0, coilOK: true, mode: 'hand' },
            ch3: { type: 'WET24', state: false, fault: false, hold: false, loadMA: 0, mode: 'pulse' },
            ch4: { type: 'WET24', state: false, fault: false, hold: false, loadMA: 0, mode: 'pulse' },
        };

        // ── 安全输出（通信超时后的保持策略）──
        // mode: 'hold'=保持, 'off'=全部断开, 'preset'=预设
        this.safeOutput = {
            ch1: { mode: 'off', presetState: false },
            ch2: { mode: 'off', presetState: false },
            ch3: { mode: 'off', presetState: false },
            ch4: { mode: 'off', presetState: false },
        };

        // ── 脉冲输出配置（闪烁/定时输出）──
        // active: 是否处于脉冲模式; onMs/offMs: 开/关时长; phase: 当前相位计时
        this.pulseConfig = {
            ch1: { active: false, onMs: 500, offMs: 500, phaseStart: 0 },
            ch2: { active: false, onMs: 500, offMs: 500, phaseStart: 0 },
            ch3: { active: true, onMs: 500, offMs: 500, phaseStart: 0 },
            ch4: { active: true, onMs: 500, offMs: 500, phaseStart: 180 },
        };

        // ── 模块状态灯 ──
        this.ledStatus = { pwr: false, run: false, flt: false, com: false };

        // ── CAN 总线状态 ──
        this.canBusConnected = false;
        this.lastRxTime = 0;
        this.lastTxTime = 0;
        this.txCount = 0;
        this.rxCount = 0;
        this.txInterval = 500;   // ms，状态心跳周期
        this.comTimeout = 2000;  // ms，通信超时阈值
        this.comErrorCount = 0;
        this.heartbeatTimeout = 5000; // ms，心跳超时判定        

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
        // 顶部装饰条：紫色（DO）
        sg.add(new Konva.Rect({ x: 0, y: 0, width: W, height: 6, fill: '#660099', cornerRadius: [3, 3, 0, 0] }));
    }

    _drawHeader() {
        const sg = this.scaleGroup;
        sg.add(new Konva.Rect({ x: 4, y: 8, width: W - 8, height: 30, fill: '#111', stroke: '#660099', strokeWidth: 1, cornerRadius: 2 }));
        sg.add(new Konva.Text({ x: 6, y: 12, text: 'DO-4通道', fontSize: 14, fontFamily: 'Courier New', fontStyle: 'bold', fill: '#cc44ff' }));
        sg.add(new Konva.Text({ x: 6, y: 28, text: 'DIGITAL  OUTPUT  MODULE', fontSize: 7, fill: '#29a04d' }));
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

            sg.add(new Konva.Rect({ x: 4, y, width: W - 8, height: 48, fill: '#0a0a0a', stroke: '#333', strokeWidth: 1, cornerRadius: 2 }));
            sg.add(new Konva.Text({ x: 8, y: y + 4, text: ch.label, fontSize: 10, fontStyle: 'bold', fill: '#aaa' }));
            sg.add(new Konva.Text({ x: 8, y: y + 16, text: ch.desc, fontSize: 7, fill: '#32ad32' }));

            // 通道类型标记
            const typeColor = ch.type === 'RELAY' ? '#2a1a2a' : '#1a2a1a';
            const typeFg = ch.type === 'RELAY' ? '#cc44ff' : '#44ffaa';
            sg.add(new Konva.Rect({ x: 8, y: y + 28, width: 32, height: 12, fill: typeColor, stroke: typeFg, strokeWidth: 0.5, cornerRadius: 1 }));
            sg.add(new Konva.Text({ x: 8, y: y + 29, text: ch.type, fontSize: 7, fill: typeFg, width: 32, align: 'center' }));

            // 状态大字显示区
            const dispBg = new Konva.Rect({ x: 44, y: y + 4, width: 100, height: 38, fill: '#050505', stroke: '#2a1a2a', strokeWidth: 1, cornerRadius: 1 });
            sg.add(dispBg);

            const stateText = new Konva.Text({
                x: 46, y: y + 10, width: 96, text: '---',
                fontSize: 20, fontFamily: 'Courier New', fontStyle: 'bold',
                fill: '#333', align: 'center'
            });
            sg.add(stateText);

            // 继电器线圈/晶体管图标行
            const subText = new Konva.Text({ x: 46, y: y + 32, width: 96, text: '', fontSize: 7, fill: '#f5eeee', align: 'center' });
            sg.add(subText);

            // 通道输出指示灯
            const led = new Konva.Circle({ x: 162, y: y + 14, radius: 5, fill: '#222', stroke: '#111', strokeWidth: 1 });
            sg.add(led);
            sg.add(new Konva.Text({ x: 170, y: y + 10, text: 'OUT', fontSize: 7, fill: '#f3ecec' }));

            // 状态标注（HOLD / PULSE / ----）
            const statusText = new Konva.Text({ x: 162, y: y + 24, text: '----', fontSize: 8, fill: '#555', width: 34, align: 'center' });
            sg.add(statusText);

            // 动作计数（继电器）或负载电流（湿接点）
            const infoText = new Konva.Text({ x: 8, y: y + 30, text: '', fontSize: 7, fill: '#444' });
            sg.add(infoText);

            this._chDisplays[ch.id] = { bg: dispBg, state: stateText, sub: subText, status: statusText, info: infoText };
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
        sg.add(new Konva.Text({ x: 8, y: y - 8, text: '状态指示灯', fontSize: 8, fill: '#fbf3f3' }));
        this._statusLEDs = {};
        defs.forEach(d => {
            const dot = new Konva.Circle({ x: d.x + 10, y: y + 10, radius: 5, fill: '#222', stroke: '#111', strokeWidth: 1 });
            const txt = new Konva.Text({ x: d.x - 4, y: y + 16, text: d.label, fontSize: 7, fill: '#f9f4f4', width: 28, align: 'center' });
            this._statusLEDs[d.id] = { dot, color: d.color };
            sg.add(dot, txt);
        });
    }

    _drawAddressSwitch() {
        const sg = this.scaleGroup;
        const y = 288, swW = 18, gap = 22;

        sg.add(new Konva.Rect({ x: 4, y: y - 2, width: W - 8, height: 38, fill: '#0a0a0a', stroke: '#333', strokeWidth: 1, cornerRadius: 2 }));
        sg.add(new Konva.Text({ x: 8, y: y - 4, text: '节点地址', fontSize: 8, fill: '#f5f0f0' }));

        this._swObjs = [];
        for (let i = 0; i < 4; i++) {
            const bitVal = 1 << i;
            const x0 = 14 + i * gap;
            const isOn = (this.nodeAddress & bitVal) !== 0;
            const swBg = new Konva.Rect({ x: x0, y: y + 8, width: swW, height: 26, fill: '#1a1a1a', stroke: '#444', strokeWidth: 1, cornerRadius: 2 });
            const knob = new Konva.Rect({ x: x0 + 3, y: isOn ? y + 10 : y + 22, width: swW - 6, height: 10, fill: isOn ? '#ffcc00' : '#333', stroke: '#555', strokeWidth: 1, cornerRadius: 1 });
            const lbl = new Konva.Text({ x: x0, y: y + 35, text: `SW${i + 1}`, fontSize: 6, fill: '#f2efef', width: swW, align: 'center' });
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
        this._addrDecText = new Konva.Text({ x: 105, y: y + 13, text: String(this.nodeAddress), fontSize: 10, fontFamily: 'Courier New', fill: '#ffcc00', width: 30, align: 'left' });
        sg.add(this._addrDecText);
    }

    _drawTermSwitch() {
        const sg = this.scaleGroup;
        const x0 = 160, y0 = 288;
        sg.add(new Konva.Text({ x: x0 - 4, y: y0 - 4, text: '终端电阻', fontSize: 8, fill: '#f2ebeb' }));
        const termBg = new Konva.Rect({ x: x0 + 2, y: y0 + 8, width: 24, height: 26, fill: '#1a1a1a', stroke: '#444', strokeWidth: 1, cornerRadius: 2 });
        this._termKnob = new Konva.Rect({ x: x0 + 5, y: y0 + 22, width: 18, height: 10, fill: '#333', stroke: '#555', strokeWidth: 1, cornerRadius: 1 });
        const termLbl = new Konva.Text({ x: x0, y: y0 + 35, text: '120Ω', fontSize: 6, fill: '#f7f7f7', width: 32, align: 'center' });
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
        [{ x: 5, text: 'CANH' }, { x: 45, text: 'CANL' }, { x: 95, text: 'GND' }, { x: 128, text: 'VCC' }]
            .forEach(l => sg.add(new Konva.Text({ x: l.x, y: H + 5, text: l.text, fontSize: 7, fill: '#222' })));
    }

    _drawPortLabels() {
        const sg = this.scaleGroup;
        CH_CONFIG.forEach((ch, i) => {
            const y = 44 + i * 52 + 14;
            // 继电器：COM / NO；湿接点：OUT+ / GND
            const labels = ch.type === 'RELAY' ? ['NO', 'COM'] : ['OUT+', 'GND'];
            sg.add(new Konva.Text({ x: -44, y, text: `${ch.label} ${labels[0]}`, fontSize: 7, fill: '#0d05f2' }));
            sg.add(new Konva.Text({ x: -44, y: y + 14, text: `${ch.label} ${labels[1]}`, fontSize: 7, fill: '#0d05f2' }));
        });
        sg.add(new Konva.Text({ x: W + 2, y: 14, text: 'VCC', fontSize: 7, fill: '#0d05f2' }));
        sg.add(new Konva.Text({ x: W + 2, y: 30, text: 'GND', fontSize: 7, fill: '#0d05f2' }));
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
        this.addPort((W + 18) * this.scale, 14 * this.scale, 'vcc', 'wire', 'p');
        this.addPort((W + 18) * this.scale, 30 * this.scale, 'gnd', 'wire');
        this.addPort(25 * this.scale, (H + 20) * this.scale, 'can1p', 'wire', 'p');
        this.addPort(70 * this.scale, (H + 20) * this.scale, 'can1n', 'wire');
        this.addPort(115 * this.scale, (H + 20) * this.scale, 'can2p', 'wire', 'p');
        this.addPort(160 * this.scale, (H + 20) * this.scale, 'can2n', 'wire');
    }

    // ══════════════════════════════════════════
    //  交互（点击显示区手动强制输出，仅供调试）
    // ══════════════════════════════════════════
    _initInteraction() {
        CH_CONFIG.forEach(ch => {
            const disp = this._chDisplays[ch.id];
            disp.bg.on('click tap', () => {
                // 仅在断电或失联情况下允许手动强制
                if (!this.powerOn || (Date.now() - this.lastRxTime > this.comTimeout)) {
                    this._setOutput(ch.id, !this.channels[ch.id].state);
                }
            });
            disp.bg.listening(true);
        });

        this.scaleGroup.on('dblclick', () => {
            this.comErrorCount = 0;
            Object.keys(this.channels).forEach(id => { this.channels[id].hold = false; });
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
            } catch (_) { /* 未连线时由 setPower() 控制 */ }

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
                console.log(`[DO #${this.nodeAddress}] NMT: Starting → ${NMT_STATE.RUN} state`);
            }
        } else if (cmd === NMT_CMD.STOP) {
            if (this.nmtState === NMT_STATE.RUN) {
                this.nmtState = NMT_STATE.STOP;
                this.nmtStateTime = Date.now();
                console.log(`[DO #${this.nodeAddress}] NMT: Stopping → ${NMT_STATE.STOP} state`);
            }
        } else if (cmd === NMT_CMD.RESET) {
            this.nmtState = NMT_STATE.INIT;
            this.nmtStateTime = Date.now();
            this.txCount = 0;
            this.rxCount = 0;
            this.comErrorCount = 0;
            this.lastTxTime = 0;
            this.lastRxTime = 0;
            console.log(`[DO #${this.nodeAddress}] NMT: Resetting → ${NMT_STATE.INIT} state`);
        } else if (cmd === NMT_CMD.RESETCOM) {
            this.comErrorCount = 0;
            this.lastTxTime = 0;
            this.lastRxTime = 0;
            this.txCount = 0;
            this.rxCount = 0;
            console.log(`[DO #${this.nodeAddress}] NMT: Communication reset`);
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

        if (!this.powerOn) {
            // 断电时继电器全部释放
            Object.keys(this.channels).forEach(id => {
                if (this.channels[id].state) this._setOutput(id, false);
            });
            this._renderOff();
            return;
        }

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

        // 通信超时 → 安全输出；通信恢复 → 清除 hold 标志
        if (this.lastRxTime > 0 && (now - this.lastRxTime) > this.comTimeout) {
            this._applySafeOutput();
            this.ledStatus.flt = true;
        } else {
            // 通信正常时，清除所有通道的 hold 标志，恢复正常控制
            const wasTimeout = Object.keys(this.channels).some(id => this.channels[id].hold);
            Object.keys(this.channels).forEach(id => {
                this.channels[id].hold = false;
            });
            // 如果刚从超时恢复，刷新 DO 设置界面的模式显示
            if (wasTimeout) this._notifyModeChange();
        }
        this.ledStatus.run = (now % 1000) < 500;
        // 脉冲输出更新
        this._updatePulse(now);

        // 湿接点负载电流仿真（简单线性模型）
        ['ch3', 'ch4'].forEach(id => {
            const ch = this.channels[id];
            ch.loadMA = 0; // 仿真 100~120mA
            ch.fault = ch.state && ch.loadMA > 500; // 过流保护阈值 500mA
        });

        // 继电器输出电阻设置（）
        ['ch1', 'ch2'].forEach(id => {
            this.channels[id].fault = !this.channels[id].coilOK;
        });

        this.ch1R = this.channels['ch1'].state === true ? 0.01 : 1000000;
        this.ch2R = this.channels['ch2'].state === true ? 0.01 : 1000000;

        // 状态心跳 - 仅在RUN状态下发送
        if (this._isCanTransmit() && now - this.lastTxTime >= this.txInterval) {
            this._canTransmitStatus();
            this.lastTxTime = now;
        }

        this.ledStatus.com = (now - this.lastRxTime < 80) || (now - this.lastTxTime < 80);
        // 9. FLT 灯
        this.ledStatus.flt = this.moduleFault || this.commFault || this.sysFault || !this.busConnected;
        if (this.powerOn && this.busConnected && !this.commFault && !this.sysFault) this.sys.canBus.setNodeOnline(this.id);
        else this.sys.canBus.resetNodeOnline(this.id);

        this._render();
    }

    // ══════════════════════════════════════════
    //  输出控制
    // ══════════════════════════════════════════
    _setOutput(chId, state) {
        const ch = this.channels[chId];
        if (!ch) return;
        const prev = ch.state;
        ch.state = state;
        // 继电器动作计数
        if (ch.type === 'RELAY' && prev !== state) ch.toggleCnt++;
    }

    _updatePulse(now) {
        Object.keys(this.pulseConfig).forEach(id => {
            const pc = this.pulseConfig[id];
            if (!pc.active) return;

            // 1. 计算单个周期的总时长
            const period = pc.onMs + pc.offMs;

            // 2. 将初相位（0-360°）转换为时间偏移（毫秒）
            // 公式：(phaseStart / 360) * period
            const phaseOffsetMs = ((pc.phaseStart % 360) / 360) * period;

            // 3. 计算在当前时间轴上的进度
            // 引入 now，并加上初相位偏移，确保波形从预期的相位点开始运动
            const currentTimeInCycle = (now + phaseOffsetMs) % period;

            // 4. 根据当前进度判断输出状态
            // 如果进度小于开启时间 (onMs)，则为高电平/激活状态
            this._setOutput(id, currentTimeInCycle < pc.onMs);
        });
    }

    _applySafeOutput() {
        Object.keys(this.channels).forEach(id => {
            const ch = this.channels[id];
            if (ch.hold) return;
            const safe = this.safeOutput[id];
            switch (safe.mode) {
                case 'off':
                    this.pulseConfig[id].active = false;
                    ch.mode = 'hand';
                    this._setOutput(id, false);
                    break;
                case 'preset':
                    this.pulseConfig[id].active = false;
                    ch.mode = 'hand';
                    this._setOutput(id, safe.presetState);
                    break;
                case 'hold':   /* 保持当前状态 */                    break;
            }
            ch.hold = true;
        });
    }

    // ══════════════════════════════════════════
    //  CAN 总线通信
    // ══════════════════════════════════════════
    /**
     * 接收指令帧（来自中央计算机）
     * 指令帧 ID = (0x40 << 7) | nodeAddress
     * Data（4字节）：
     *   Byte 0: cmd
     *     0x01 — 直接输出控制  (Byte1=chMask, Byte2=stateMask)
     *     0x02 — 脉冲输出启动  (Byte1=chMask, Byte2-3=onMs, Byte4-5=offMs,Byte6-7=phStart)
     *     0x03 — 脉冲输出停止  (Byte1=chMask)
     *     0x04 — 全部断开
     *     0x05 — 修改安全输出策略 (Byte1=chMask, Byte2=modeMask 0=off/1=hold/2=preset, Byte3=presetMask)
     *     0x06 — 修改心跳周期     (Byte1-2=ms)
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
                    console.log(`[AO #${this.nodeAddress}] Heartbeat received → ${NMT_STATE.RUN} state`);
                }
            }
            return;
        }
        // ── 处理配置命令 ──
        // ── 处理配置命令 ──
        const expectedId = CANId.encode(CAN_FUNC.DO_CMD, this.nodeAddress);
        if (frame.id !== expectedId) return;

        this.lastRxTime = Date.now();
        this.rxCount++;
        this.ledStatus.com = true;

        const cmd = frame.data[0];
        const chKeys = ['ch1', 'ch2', 'ch3', 'ch4'];
        const chMask = frame.data[1] || 0;

        switch (cmd) {
            case 0x01: {
                const stateMask = frame.data[2] || 0;
                chKeys.forEach((id, i) => {
                    if (chMask & (1 << i)) {
                        this.channels[id].hold = false;
                        this.pulseConfig[id].active = false;
                        this._setOutput(id, !!(stateMask & (1 << i)));
                    }
                });
                break;
            }
            case 0x02: {
                const onMs = (frame.data[2] << 8) | frame.data[3];
                const offMs = (frame.data[4] << 8) | frame.data[5];
                const phStart = (frame.data[6] << 8) | frame.data[7];
                chKeys.forEach((id, i) => {
                    if (chMask & (1 << i)) {
                        this.channels[id].hold = false;
                        this.pulseConfig[id].active = true;
                        this.pulseConfig[id].onMs = Math.max(50, onMs);
                        this.pulseConfig[id].offMs = Math.max(50, offMs);
                        this.pulseConfig[id].phaseStart = phStart;
                    }
                });
                break;
            }
            case 0x03:
                chKeys.forEach((id, i) => {
                    if (chMask & (1 << i)) this.pulseConfig[id].active = false;
                });
                break;
            case 0x04:
                chKeys.forEach(id => { this._setOutput(id, false); this.channels[id].hold = false; this.pulseConfig[id].active = false; });
                break;
            case 0x05: {
                const modeMap = ['off', 'hold', 'preset'];
                const modeMask = frame.data[2] & 0x03;
                const presMask = frame.data[3] || 0;
                chKeys.forEach((id, i) => {
                    if (chMask & (1 << i)) {
                        this.safeOutput[id].mode = modeMap[modeMask] || 'off';
                        this.safeOutput[id].presetState = !!(presMask & (1 << i));
                    }
                });
                break;
            }
            case 0x06:
                this.txInterval = Math.max(100, (frame.data[1] << 8) | frame.data[2]);
                break;

            // ── 写入：通道模式 (0x10) ──
            // Byte1=chMask  Byte2=mode (0=hand,1=auto,2=pulse,3=disable)
            case 0x10: {
                const modeNames = ['hand', 'auto', 'pulse', 'disable'];
                chKeys.forEach((id, i) => {
                    if (chMask & (1 << i)) {
                        const m = modeNames[frame.data[2] & 0x03] || 'hand';
                        this.channels[id].mode = m;
                        if (m === 'pulse') {
                            this.pulseConfig[id].active = true;
                        } else {
                            this.pulseConfig[id].active = false;
                        }
                    }
                });
                break;
            }
            // ── 写入：脉冲参数 (0x11) ──
            // Byte1=chMask  Byte2-3=onMs  Byte4-5=offMs  Byte6-7=phaseMs
            case 0x11: {
                const onMs = (frame.data[2] << 8) | frame.data[3];
                const offMs = (frame.data[4] << 8) | frame.data[5];
                const phaseMs = (frame.data[6] << 8) | frame.data[7];
                chKeys.forEach((id, i) => {
                    if (chMask & (1 << i)) {
                        this.pulseConfig[id].onMs = Math.max(50, onMs);
                        this.pulseConfig[id].offMs = Math.max(50, offMs);
                        this.pulseConfig[id].phaseStart = phaseMs;
                    }
                });
                break;
            }
            // ── 写入：安全输出模式 (0x12) ──
            // Byte1=chMask  Byte2=mode(0=off,1=hold,2=preset)  Byte3=presetMask
            case 0x12: {
                const modeMap2 = ['off', 'hold', 'preset'];
                const modeMask = frame.data[2] & 0x03;
                const presMask = frame.data[3] || 0;
                chKeys.forEach((id, i) => {
                    if (chMask & (1 << i)) {
                        this.safeOutput[id].mode = modeMap2[modeMask] || 'off';
                        this.safeOutput[id].presetState = !!(presMask & (1 << i));
                    }
                });
                break;
            }
            // ── 查询：通道模式 (0x20) ──
            // Byte1=chIdx (0-3)
            case 0x20: {
                const chIdx2 = frame.data[1] & 0x03;
                const cid = chKeys[chIdx2];
                const modeIdx = ['hand', 'auto', 'pulse', 'disable'].indexOf(this.channels[cid].mode);
                this._sendResponse([0x20, chIdx2, modeIdx < 0 ? 0 : modeIdx, 0, 0, 0, 0, 0]);
                break;
            }
            // ── 查询：脉冲参数 (0x21) ──
            // Byte1=chIdx
            case 0x21: {
                const chIdx3 = frame.data[1] & 0x03;
                const cid2 = chKeys[chIdx3];
                const pc = this.pulseConfig[cid2];
                const onMs2 = Math.round(pc.onMs) & 0xFFFF;
                const offMs2 = Math.round(pc.offMs) & 0xFFFF;
                const phMs = Math.round(pc.phaseStart) & 0xFFFF;
                this._sendResponse([
                    0x21, chIdx3,
                    (onMs2 >> 8) & 0xFF, onMs2 & 0xFF,
                    (offMs2 >> 8) & 0xFF, offMs2 & 0xFF,
                    (phMs >> 8) & 0xFF, phMs & 0xFF
                ]);
                break;
            }
            // ── 查询：安全输出模式 (0x22) ──
            // Byte1=chIdx
            case 0x22: {
                const chIdx4 = frame.data[1] & 0x03;
                const cid3 = chKeys[chIdx4];
                const safe = this.safeOutput[cid3];
                const safeModeIdx = ['off', 'hold', 'preset'].indexOf(safe.mode);
                this._sendResponse([
                    0x22, chIdx4,
                    safeModeIdx < 0 ? 0 : safeModeIdx,
                    safe.presetState ? 1 : 0,
                    0, 0, 0, 0
                ]);
                break;
            }
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
                this._sendResponse(payload);
                break;
        }
    }
    _sendResponse(responseData) {
        if (!this.sys || typeof this.sys.canBus === 'undefined') return;

        const frameId = CANId.encode(CAN_FUNC.DO_REPLY, this.nodeAddress & 0x0F);
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
    /**
     * 状态心跳帧 ID = (CAN_FUNC_DO << 7) | nodeAddress
     * Data（4字节）：
     *   Byte 0: 输出状态位 [bit0=ch1…bit3=ch4]
     *   Byte 1: 故障位
     *   Byte 2: HOLD 位
     *   Byte 3: 脉冲活跃位
     */
    _canTransmitStatus() {
        // ── NMT 状态检查：仅在运行状态下才发送数据 ──
        if (!this._isCanTransmit()) {
            return;
        }

        if (!this.sys || typeof this.sys.canBus === 'undefined') return;

        const chKeys = ['ch1', 'ch2', 'ch3', 'ch4'];
        const mkByte = fn => chKeys.reduce((b, id, i) => b | (fn(this.channels[id], id) ? (1 << i) : 0), 0);

        const data = [
            mkByte(c => c.state),
            mkByte(c => c.fault),
            mkByte(c => c.hold),
            chKeys.reduce((b, id, i) => b | (this.pulseConfig[id].active ? (1 << i) : 0), 0),
        ];

        try {
            this.sys.canBus.send({
                id: CANId.encode(CAN_FUNC.DO_STATUS, this.nodeAddress),
                extended: false, rtr: false, dlc: 4, data, sender: this.id, timestamp: Date.now()
            });
            this.txCount++;
            this.canBusConnected = true;
        } catch (e) {
            this.comErrorCount++;
            this.canBusConnected = false;
        }
    }

    // ══════════════════════════════════════════
    //  渲染
    // ══════════════════════════════════════════
    _render() {
        CH_CONFIG.forEach(ch => {
            const cData = this.channels[ch.id];
            const pc = this.pulseConfig[ch.id];
            const disp = this._chDisplays[ch.id];
            const led = this._chLEDs[ch.id];
            if (cData.mode === 'disable') {

                const d = this._chDisplays[ch.id];
                d.state.text(''); d.sub.text(''); d.status.text(''); d.info.text('');
                d.bg.stroke('#333');
                this._chLEDs[ch.id].fill('#222');
                return;
            }

            if (cData.fault) {
                disp.state.text('ERR');
                disp.state.fill('#ff3300');
                disp.bg.stroke('#550000');
                disp.status.text('FLT');
                disp.status.fill('#ff3300');
                led.fill('#ff3300');
                disp.sub.text(ch.type === 'RELAY' ? 'COIL ERR' : 'OVERCURRENT');
                disp.info.text('');
                return;
            }

            const on = cData.state;

            // 状态大字
            disp.state.text(on ? ' ON ' : 'OFF ');

            if (ch.type === 'RELAY') {
                disp.state.fill(on ? '#cc44ff' : '#555');
                disp.bg.stroke(on ? '#2a1a2a' : '#1a1a1a');
                led.fill(on ? '#cc44ff' : '#222');
                // 继电器触点图示：▶| 闭合 / ▶  断开
                disp.sub.text(on ? '▶| CLOSED' : '▶  OPEN');
                disp.sub.fill(on ? '#cc44ff' : '#555');
                disp.info.text(`ACT:${cData.toggleCnt}`);
            } else {
                disp.state.fill(on ? '#44ffaa' : '#555');
                disp.bg.stroke(on ? '#1a2a1a' : '#1a1a1a');
                led.fill(on ? '#44ffaa' : '#222');
                disp.sub.text('24V ');
                disp.sub.fill(on ? '#44ffaa' : '#555');
                disp.info.text(`LOAD:---mA`);
            }

            // HOLD / PULSE / ---- 标注
            if (cData.hold) { disp.status.text('HOLD'); disp.status.fill('#ffcc00'); }
            else if (pc.active) { disp.status.text('PULSE'); disp.status.fill('#00aaff'); }
            else { disp.status.text('----'); disp.status.fill('#555'); }
        });

        Object.keys(this._statusLEDs).forEach(id => {
            this._statusLEDs[id].dot.fill(this.ledStatus[id] ? this._statusLEDs[id].color : '#222');
        });
        this._refreshCache();
    }

    _renderOff() {
        CH_CONFIG.forEach(ch => {
            const d = this._chDisplays[ch.id];
            d.state.text(''); d.sub.text(''); d.status.text(''); d.info.text('');
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
     * 直接控制输出（供仿真引擎调用）
     * @param {string}  chId  - 'ch1'~'ch4'
     * @param {boolean} state - true=导通/吸合
     */
    setOutput(chId, state) {
        if (this.channels[chId] !== undefined) {
            this.channels[chId].hold = false;
            this.pulseConfig[chId].active = false;
            this._setOutput(chId, state);
        }
    }

    /**
     * 启动脉冲输出
     * @param {string} chId  - 通道 id
     * @param {number} onMs  - 导通时长 ms
     * @param {number} offMs - 关断时长 ms
     */
    startPulse(chId, onMs, offMs, phStart) {
        if (!this.pulseConfig[chId]) return;
        this.pulseConfig[chId].active = true;
        this.pulseConfig[chId].onMs = Math.max(50, onMs);
        this.pulseConfig[chId].offMs = Math.max(50, offMs);
        this.pulseConfig[chId].phaseStart = phStart;
        this.channels[chId].hold = false;
    }

    /** 停止脉冲输出 */
    stopPulse(chId) {
        if (this.pulseConfig[chId]) {
            this.pulseConfig[chId].active = false;
            this._setOutput(chId, false);
        }
    }

    /**
     * 配置安全输出策略
     * @param {string}  chId        - 通道 id
     * @param {string}  mode        - 'off'|'hold'|'preset'
     * @param {boolean} [preset]    - preset 模式下的预设状态
     */
    setSafeOutput(chId, mode, preset = false) {
        if (this.safeOutput[chId]) {
            this.safeOutput[chId].mode = mode;
            this.safeOutput[chId].presetState = preset;
        }
    }

    /** 模拟继电器线圈断路（测试故障处理）*/
    setCoilFault(chId, fault) {
        if (this.channels[chId] && this.channels[chId].type === 'RELAY') {
            this.channels[chId].coilOK = !fault;
        }
    }

    /** 获取所有通道输出快照 */
    getChannelOutputs() {
        return Object.keys(this.channels).reduce((acc, id) => {
            const ch = this.channels[id];
            acc[id] = { type: ch.type, state: ch.state, fault: ch.fault, hold: ch.hold };
            return acc;
        }, {});
    }

    /** 通知 DO 设置界面更新模式显示 */
    _notifyModeChange() {
        // 发送事件或标记，供外部监听通信恢复时刷新 UI
        const chIds = ['ch1', 'ch2', 'ch3', 'ch4'];
        chIds.forEach((chId, i) => {
            const modeIdx = ['hand', 'auto', 'pulse', 'disable'].indexOf(this.channels[chId].mode);
            this._sendResponse([0x20, i, modeIdx < 0 ? 0 : modeIdx, 0, 0, 0, 0, 0]);
        });
    }


    destroy() {
        if (this._loopTimer) clearInterval(this._loopTimer);
        super.destroy && super.destroy();
    }
}