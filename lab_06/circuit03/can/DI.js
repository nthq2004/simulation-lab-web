/**
 * DI.js — 数字量输入模块 (Digital Input Module) · 主入口
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
 *
 * 模块拆分说明：
 *   DI.constants.js  — 常量、通道配置、默认数据工厂函数
 *   DI.visuals.js    — Konva 图形绘制 Mixin（_initVisuals、_render 等）
 *   DI.can.js        — CAN 总线通信 Mixin（onCanReceive、_canTransmit 等）
 *   DI.js            — 主类（构造、主循环、消抖处理、公开 API）
 */

import { BaseComponent } from '../components/BaseComponent.js';
import { NMT_STATE } from './CANBUS.js';

import { W, H, CH_CONFIG, DEBOUNCE_MS, defaultChannels, defaultAlarmConfig } from './dpu/DI.constants.js';
import { applyVisualsMixin } from './dpu/DI.visuals.js';
import { applyCANMixin } from './dpu/DI.can.js';

// ─────────────────────────────────────────────
//  主类
// ─────────────────────────────────────────────
export class DIModule extends BaseComponent {

    constructor(config, sys) {
        super(config, sys);

        this.w = W;
        this.h = H;
        this.scale = 1.1;
        this.type = 'DI';
        this.special = 'can';
        this.cache = 'fixed';

        // ── 电源状态 ──
        this.powerOn = false;
        this.isBreak = false;
        this.commFault = false;
        this.moduleFault = false;
        this.channelFault = false;

        // ── 节点地址 (0~15) ──
        this.nodeAddress = (config && config.nodeAddress != null) ? config.nodeAddress : 3;

        // ── 终端电阻 ──
        this.termEnabled = false;
        this.currentResistance = 1000000;

        // ── 通道数据 ──
        this.channels = defaultChannels();

        // ── 事件记录（最近 8 条变化事件）──
        this.eventLog = [];
        this.maxEventLog = 8;

        // ── 报警配置（可由中央计算机下发修改）──
        this.alarmConfig = defaultAlarmConfig();

        // ── 模块状态灯 ──
        this.ledStatus = { pwr: false, run: false, flt: false, com: false };

        // ── CAN 总线状态 ──
        this.canBusConnected = false;
        this.lastTxTime = 0;
        this.lastRxTime = 0;
        this.txCount = 0;
        this.rxCount = 0;
        this.txInterval = 200;
        this._txOnChange = true;
        this.heartbeatTimeout = 5000;
        this.busConnected = false;
        this.comErrorCount = 0;

        // ── NMT 状态机 ──
        this.nmtState = NMT_STATE.INIT;
        this.nmtStateTime = Date.now();

        // ── 初始化 ──
        this._initVisuals();
        this._initPorts();
        this._initInteraction();
        this._startLoop();
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
    //  交互
    // ══════════════════════════════════════════
    _initInteraction() {
        CH_CONFIG.forEach(ch => {
            const disp = this._chDisplays[ch.id];
            disp.bg.on('click tap', () => {
                const cur = this.channels[ch.id].raw;
                this._injectRaw(ch.id, !cur);
            });
            disp.bg.listening(true);
        });

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
            } catch (_) { /* 未连线时由 setPower() 控制 */ }

            this._tick();
        }, 50);

        this.nmtState = NMT_STATE.INIT;
        this.nmtStateTime = Date.now();
    }

    _tick() {
        const now = Date.now();

        if (!this.powerOn) { this._renderOff(); return; }

        this.ledStatus.pwr = true;

        if (this.sysFault) {
            this.ledStatus.run = false;
            this.ledStatus.flt = true;
            this.ledStatus.com = false;
            this._render();
            return;
        }

        if (now - this._lastHeartbeat > this.heartbeatTimeout && this.nmtState === NMT_STATE.RUN) {
            this.nmtState = NMT_STATE.PREOP;
            this.nmtStateTime = now;
        }

        this.ledStatus.run = (now % 1000) < 500;

        // 湿接点电压读取
        ['ch3', 'ch4'].forEach(id => {
            const ch = this.channels[id];
            try {
                ch.voltage = this.sys.getVoltageBetween(`${this.id}_wire_${id}p`, `${this.id}_wire_${id}n`);
                const newRaw = ch.voltage > 15;
                this._injectRaw(id, newRaw);
                ch.fault = ch.voltage > 0 && ch.voltage < 8;
            } catch (_) { /* 未建模时忽略 */ }
        });

        // 干接点信号读取
        ['ch1', 'ch2'].forEach(id => {
            const ch = this.channels[id];
            try {
                const voltage = this.sys.getVoltageBetween(`${this.id}_wire_${id}p`, `${this.id}_wire_${id}n`);
                const newRaw = this.sys.isPortConnected(`${this.id}_wire_${id}p`, `${this.id}_wire_${id}n`);
                this._injectRaw(id, newRaw);
                ch.fault = voltage > 1;
            } catch (_) { /* 未建模时忽略 */ }
        });

        // 消抖处理
        this._processDebounce(now);

        // CAN 周期上报
        if (this._isCanTransmit() && now - this.lastTxTime >= this.txInterval) {
            this._canTransmit();
            this.lastTxTime = now;
        }

        this._comBlink = (now - this.lastTxTime) < 80;
        this.ledStatus.com = (!this.busConnected || this.commFault) ? false : this._comBlink;

        this.ledStatus.flt = this.moduleFault || this.commFault || this.sysFault || !this.busConnected;
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
    //  公开 API
    // ══════════════════════════════════════════

    _injectRaw(chId, val) {
        const ch = this.channels[chId];
        if (!ch) return;
        if (ch.raw !== val) {
            ch.raw = val;
            ch.debounceAt = Date.now();
        }
    }

    setState(chId, val) {
        const ch = this.channels[chId];
        if (!ch) return;
        ch.raw = val;
        ch.state = val;
    }

    getChannelStates() {
        return Object.keys(this.channels).reduce((acc, id) => {
            acc[id] = { state: this.channels[id].state, fault: this.channels[id].fault, counter: this.channels[id].counter };
            return acc;
        }, {});
    }

    setPower(on) { this.powerOn = on; }

    destroy() {
        if (this._loopTimer) clearInterval(this._loopTimer);
        super.destroy && super.destroy();
    }
}

// ── 混入视觉和 CAN 通信方法 ──
applyVisualsMixin(DIModule.prototype);
applyCANMixin(DIModule.prototype);
