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
    { id: 'ch3', label: 'CH3', type: 'WET24', desc: '24V NPN' },
    { id: 'ch4', label: 'CH4', type: 'WET24', desc: '24V NPN' },
];

// CAN 功能码 0x04 = DO
const CAN_FUNC_DO = 0x04;

// ─────────────────────────────────────────────
//  主类
// ─────────────────────────────────────────────
export class DOModule extends BaseComponent {

    constructor(config, sys) {
        super(config, sys);

        this.w = W;
        this.h = H;
        this.scale = 1.35;
        this.type  = 'DO';
        this.cache = 'fixed';

        this.powerOn     = false;
        this.nodeAddress = (config && config.nodeAddress != null) ? config.nodeAddress : 4;
        this.termEnabled = false;

        // ── 通道输出数据 ──
        // state:     当前输出逻辑状态 (true=吸合/导通)
        // fault:     输出故障（继电器线圈断路 / 晶体管过流）
        // hold:      通信超时安全锁定标志
        // toggleCnt: 继电器动作次数（寿命计数）
        // loadMA:    湿接点通道负载电流（仿真值，mA）
        this.channels = {
            ch1: { type: 'RELAY', state: false, fault: false, hold: false, toggleCnt: 0, coilOK: true  },
            ch2: { type: 'RELAY', state: false, fault: false, hold: false, toggleCnt: 0, coilOK: true  },
            ch3: { type: 'WET24', state: false, fault: false, hold: false, loadMA: 0                   },
            ch4: { type: 'WET24', state: false, fault: false, hold: false, loadMA: 0                   },
        };

        // ── 安全输出（通信超时后的保持策略）──
        // mode: 'hold'=保持, 'off'=全部断开, 'preset'=预设
        this.safeOutput = {
            ch1: { mode: 'off',  presetState: false },
            ch2: { mode: 'off',  presetState: false },
            ch3: { mode: 'off',  presetState: false },
            ch4: { mode: 'off',  presetState: false },
        };

        // ── 脉冲输出配置（闪烁/定时输出）──
        // active: 是否处于脉冲模式; onMs/offMs: 开/关时长; phase: 当前相位计时
        this.pulseConfig = {
            ch1: { active: false, onMs: 500, offMs: 500, phaseStart: 0 },
            ch2: { active: false, onMs: 500, offMs: 500, phaseStart: 0 },
            ch3: { active: false, onMs: 500, offMs: 500, phaseStart: 0 },
            ch4: { active: false, onMs: 500, offMs: 500, phaseStart: 0 },
        };

        // ── 模块状态灯 ──
        this.ledStatus = { pwr: false, run: false, flt: false, com: false };

        // ── CAN 总线状态 ──
        this.canBusConnected = false;
        this.lastRxTime      = 0;
        this.lastTxTime      = 0;
        this.txCount         = 0;
        this.rxCount         = 0;
        this.txInterval      = 500;   // ms，状态心跳周期
        this.comTimeout      = 2000;  // ms，通信超时阈值
        this.comErrorCount   = 0;

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
        sg.add(new Konva.Rect({ x: W,   y: 0, ...railAttr }));
        sg.add(new Konva.Rect({
            x: 0, y: 0, width: W, height: H,
            fillLinearGradientStartPoint:  { x: 0, y: 0 },
            fillLinearGradientEndPoint:    { x: W, y: 0 },
            fillLinearGradientColorStops:  [0, '#2c2c2c', 0.5, '#3a3a3a', 1, '#2c2c2c'],
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
        this._chLEDs     = {};

        CH_CONFIG.forEach((ch, i) => {
            const y  = 44 + i * 52;
            const sg = this.scaleGroup;

            sg.add(new Konva.Rect({ x: 4, y, width: W - 8, height: 48, fill: '#0a0a0a', stroke: '#333', strokeWidth: 1, cornerRadius: 2 }));
            sg.add(new Konva.Text({ x: 8, y: y + 4,  text: ch.label, fontSize: 10, fontStyle: 'bold', fill: '#aaa' }));
            sg.add(new Konva.Text({ x: 8, y: y + 16, text: ch.desc,  fontSize: 7,  fill: '#32ad32' }));

            // 通道类型标记
            const typeColor = ch.type === 'RELAY' ? '#2a1a2a' : '#1a2a1a';
            const typeFg    = ch.type === 'RELAY' ? '#cc44ff' : '#44ffaa';
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
            this._chLEDs[ch.id]     = led;
        });
    }

    _drawStatusLEDs() {
        const sg   = this.scaleGroup;
        const y    = 256;
        const defs = [
            { id: 'pwr', label: 'PWR', color: '#00ff00', x: 14  },
            { id: 'run', label: 'RUN', color: '#00ff00', x: 58  },
            { id: 'flt', label: 'FLT', color: '#ff3300', x: 102 },
            { id: 'com', label: 'COM', color: '#00aaff', x: 146 },
        ];
        sg.add(new Konva.Rect({ x: 4, y: y - 4, width: W - 8, height: 28, fill: '#0a0a0a', stroke: '#333', strokeWidth: 1, cornerRadius: 2 }));
        sg.add(new Konva.Text({ x: 8, y: y - 8, text: '状态指示灯', fontSize: 8, fill: '#fbf3f3' }));
        this._statusLEDs = {};
        defs.forEach(d => {
            const dot = new Konva.Circle({ x: d.x+10, y: y + 10, radius: 5, fill: '#222', stroke: '#111', strokeWidth: 1 });
            const txt = new Konva.Text({ x: d.x - 4, y: y + 16, text: d.label, fontSize: 7, fill: '#f9f4f4', width: 28, align: 'center' });
            this._statusLEDs[d.id] = { dot, color: d.color };
            sg.add(dot, txt);
        });
    }

    _drawAddressSwitch() {
        const sg = this.scaleGroup;
        const y  = 288, swW = 18, gap = 22;

        sg.add(new Konva.Rect({ x: 4, y: y - 2, width: W - 8, height: 38, fill: '#0a0a0a', stroke: '#333', strokeWidth: 1, cornerRadius: 2 }));
        sg.add(new Konva.Text({ x: 8, y: y - 4, text: '节点地址', fontSize: 8, fill: '#f5f0f0' }));

        this._swObjs = [];
        for (let i = 0; i < 4; i++) {
            const bitVal = 1 << i;
            const x0     = 14 + i * gap;
            const isOn   = (this.nodeAddress & bitVal) !== 0;
            const swBg = new Konva.Rect({ x: x0, y: y + 8, width: swW, height: 26, fill: '#1a1a1a', stroke: '#444', strokeWidth: 1, cornerRadius: 2 });
            const knob = new Konva.Rect({ x: x0 + 3, y: isOn ? y + 10 : y + 22, width: swW - 6, height: 10, fill: isOn ? '#ffcc00' : '#333', stroke: '#555', strokeWidth: 1, cornerRadius: 1 });
            const lbl  = new Konva.Text({ x: x0, y: y + 35, text: `SW${i + 1}`, fontSize: 6, fill: '#f2efef', width: swW, align: 'center' });
            const vLbl = new Konva.Text({ x: x0, y: y + 8,  text: bitVal.toString(), fontSize: 6, fill: '#444', width: swW, align: 'center' });
            swBg.on('click tap', () => {
                if (this.nodeAddress & bitVal) this.nodeAddress &= ~bitVal;
                else                           this.nodeAddress |=  bitVal;
                this._refreshSwitches();
                this._nodeAddrDisplay.text(`NODE:${String(this.nodeAddress).padStart(2, '0')}`);
                this._refreshCache();
            });
            this._swObjs.push({ knob, bitVal, y0: y });
            sg.add(swBg, knob, lbl, vLbl);
        }
        this._addrDecText = new Konva.Text({ x: 80, y: y + 13, text: String(this.nodeAddress), fontSize: 10, fontFamily: 'Courier New', fill: '#ffcc00', width: 30, align: 'right' });
        sg.add(this._addrDecText);
    }

    _drawTermSwitch() {
        const sg = this.scaleGroup;
        const x0 = 160, y0 = 288;
        sg.add(new Konva.Text({ x: x0-4, y: y0 - 4, text: '终端电阻', fontSize: 8, fill: '#f2ebeb' }));
        const termBg   = new Konva.Rect({ x: x0 + 2, y: y0 + 8, width: 24, height: 26, fill: '#1a1a1a', stroke: '#444', strokeWidth: 1, cornerRadius: 2 });
        this._termKnob = new Konva.Rect({ x: x0 + 5, y: y0 + 22, width: 18, height: 10, fill: '#333', stroke: '#555', strokeWidth: 1, cornerRadius: 1 });
        const termLbl  = new Konva.Text({ x: x0, y: y0 + 35, text: '120Ω', fontSize: 6, fill: '#f7f7f7', width: 32, align: 'center' });
        termBg.on('click tap', () => {
            this.termEnabled = !this.termEnabled;
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
            this.addPort(-18 * this.scale, (yBase + 38) * this.scale, `${ch.id}n`,  'wire');
        });
        this.addPort((W + 18) * this.scale, 14 * this.scale, 'vcc',  'wire', 'p');
        this.addPort((W + 18) * this.scale, 30 * this.scale, 'gnd',  'wire');
        this.addPort(25  * this.scale, (H + 20) * this.scale, 'can1h', 'wire', 'p');
        this.addPort(70  * this.scale, (H + 20) * this.scale, 'can1l', 'wire');
        this.addPort(115 * this.scale, (H + 20) * this.scale, 'can1h', 'wire','p');
        this.addPort(160 * this.scale, (H + 20) * this.scale, 'can2l', 'wire');
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
                this.powerOn = this.sys.getVoltageBetween(`${this.id}_wire_vcc`, `${this.id}_wire_gnd`) ===0;
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
        this.ledStatus.run = (now % 1000) < 500;

        // 通信超时 → 安全输出
        if (this.lastRxTime > 0 && (now - this.lastRxTime) > this.comTimeout) {
            this._applySafeOutput();
            this.ledStatus.flt = true;
        }

        // 脉冲输出更新
        this._updatePulse(now);

        // 湿接点负载电流仿真（简单线性模型）
        ['ch3', 'ch4'].forEach(id => {
            const ch = this.channels[id];
            ch.loadMA = ch.state ? Math.round(100 + Math.random() * 20) : 0; // 仿真 100~120mA
            ch.fault  = ch.state && ch.loadMA > 500; // 过流保护阈值 500mA
        });

        // 继电器线圈检测（仿真：coilOK 由外部注入）
        ['ch1', 'ch2'].forEach(id => {
            this.channels[id].fault = !this.channels[id].coilOK;
        });

        // 状态心跳 - 仅在RUN状态下发送
        if (this._isCanTransmit() && now - this.lastTxTime >= this.txInterval) {
            this._canTransmitStatus();
            this.lastTxTime = now;
        }

        this.ledStatus.com = (now - this.lastRxTime < 80) || (now - this.lastTxTime < 80);
        this.ledStatus.flt = Object.values(this.channels).some(c => c.fault);

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
        // 同步到仿真总线（供下游元件读取）
        try {
            this.sys.setContactState(`${this.id}_${chId}`, state);
        } catch (_) { }
    }

    _updatePulse(now) {
        Object.keys(this.pulseConfig).forEach(id => {
            const pc = this.pulseConfig[id];
            if (!pc.active) return;
            const elapsed = (now - pc.phaseStart) % (pc.onMs + pc.offMs);
            this._setOutput(id, elapsed < pc.onMs);
        });
    }

    _applySafeOutput() {
        Object.keys(this.channels).forEach(id => {
            const ch = this.channels[id];
            if (ch.hold) return;
            const safe = this.safeOutput[id];
            switch (safe.mode) {
                case 'off':    this._setOutput(id, false);           break;
                case 'preset': this._setOutput(id, safe.presetState);break;
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
     *     0x02 — 脉冲输出启动  (Byte1=chMask, Byte2-3=onMs, Byte4-5=offMs)
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
        
        // ── 处理配置命令 ──
        if (frame.id !== ((0x40 << 7) | (this.nodeAddress & 0x0F))) return;

        this.lastRxTime = Date.now();
        this.rxCount++;
        this.ledStatus.com = true;

        const cmd    = frame.data[0];
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
                const onMs  = (frame.data[2] << 8) | frame.data[3];
                const offMs = (frame.data[4] << 8) | frame.data[5];
                chKeys.forEach((id, i) => {
                    if (chMask & (1 << i)) {
                        this.channels[id].hold    = false;
                        this.pulseConfig[id].active     = true;
                        this.pulseConfig[id].onMs        = Math.max(50, onMs);
                        this.pulseConfig[id].offMs       = Math.max(50, offMs);
                        this.pulseConfig[id].phaseStart  = Date.now();
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
                const modeMap  = ['off', 'hold', 'preset'];
                const modeMask = frame.data[2] & 0x03;
                const presMask = frame.data[3] || 0;
                chKeys.forEach((id, i) => {
                    if (chMask & (1 << i)) {
                        this.safeOutput[id].mode        = modeMap[modeMask] || 'off';
                        this.safeOutput[id].presetState = !!(presMask & (1 << i));
                    }
                });
                break;
            }
            case 0x06:
                this.txInterval = Math.max(100, (frame.data[1] << 8) | frame.data[2]);
                break;
        }
    }

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
                id: (CAN_FUNC_DO << 7) | (this.nodeAddress & 0x0F),
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
            const pc    = this.pulseConfig[ch.id];
            const disp  = this._chDisplays[ch.id];
            const led   = this._chLEDs[ch.id];

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
                disp.sub.text(on ? `24V ▪ ${cData.loadMA}mA` : '24V ○ 0mA');
                disp.sub.fill(on ? '#44ffaa' : '#555');
                disp.info.text(`LOAD:${cData.loadMA}mA`);
            }

            // HOLD / PULSE / ---- 标注
            if (cData.hold)       { disp.status.text('HOLD');  disp.status.fill('#ffcc00'); }
            else if (pc.active)   { disp.status.text('PULSE'); disp.status.fill('#00aaff'); }
            else                  { disp.status.text('----');  disp.status.fill('#555');    }
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
    startPulse(chId, onMs, offMs) {
        if (!this.pulseConfig[chId]) return;
        this.pulseConfig[chId].active    = true;
        this.pulseConfig[chId].onMs      = Math.max(50, onMs);
        this.pulseConfig[chId].offMs     = Math.max(50, offMs);
        this.pulseConfig[chId].phaseStart = Date.now();
        this.channels[chId].hold         = false;
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
            this.safeOutput[chId].mode        = mode;
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


    destroy() {
        if (this._loopTimer) clearInterval(this._loopTimer);
        super.destroy && super.destroy();
    }
}