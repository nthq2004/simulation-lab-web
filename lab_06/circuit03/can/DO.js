/**
 * DO.js — 数字量输出模块 (Digital Output Module) · 主入口
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
 *
 * 模块拆分说明：
 *   DO.constants.js  — 常量、通道配置、默认数据工厂函数
 *   DO.visuals.js    — Konva 图形绘制 Mixin（_initVisuals、_render 等）
 *   DO.can.js        — CAN 总线通信 Mixin（onCanReceive、_canTransmitStatus 等）
 *   DO.js            — 主类（构造、主循环、输出控制、脉冲、安全输出、公开 API）
 */

import { BaseComponent } from '../components/BaseComponent.js';
import { NMT_STATE }     from './CANBUS.js';

import { W, H, CH_CONFIG, defaultChannels, defaultSafeOutput, defaultPulseConfig } from './dpu/DO.constants.js';
import { applyVisualsMixin } from './dpu/DO.visuals.js';
import { applyCANMixin }     from './dpu/DO.can.js';

// ─────────────────────────────────────────────
//  主类
// ─────────────────────────────────────────────
export class DOModule extends BaseComponent {

    constructor(config, sys) {
        super(config, sys);

        this.w = W;
        this.h = H;
        this.scale = 1.1;
        this.type = 'DO';
        this.special = 'can';
        this.cache = 'fixed';

        // ── 电源状态 ──
        this.powerOn = false;
        this.isBreak = false;
        this.commFault = false;
        this.moduleFault = false;
        this.channelFault = false;

        // ── 节点地址 (0~15) ──
        this.nodeAddress = (config && config.nodeAddress != null) ? config.nodeAddress : 4;

        // ── 终端电阻 ──
        this.termEnabled = false;
        this.currentResistance = 1000000;
        this.ch1R = 1e9;
        this.ch2R = 1e9;

        // ── 通道输出数据 ──
        this.channels = defaultChannels();

        // ── 安全输出配置 ──
        this.safeOutput = defaultSafeOutput();

        // ── 脉冲输出配置 ──
        this.pulseConfig = defaultPulseConfig();

        // ── 模块状态灯 ──
        this.ledStatus = { pwr: false, run: false, flt: false, com: false };

        // ── CAN 总线状态 ──
        this.canBusConnected = false;
        this.lastRxTime = 0;
        this.lastTxTime = 0;
        this.txCount = 0;
        this.rxCount = 0;
        this.txInterval = 500;
        this.comTimeout = 2000;
        this.comErrorCount = 0;
        this.heartbeatTimeout = 5000;

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
        this.addPort((W + 18) * this.scale, 14 * this.scale, 'vcc', 'wire', 'p');
        this.addPort((W + 18) * this.scale, 30 * this.scale, 'gnd', 'wire');
        this.addPort(25 * this.scale, (H + 20) * this.scale, 'can1p', 'wire', 'p');
        this.addPort(70 * this.scale, (H + 20) * this.scale, 'can1n', 'wire');
        this.addPort(115 * this.scale, (H + 20) * this.scale, 'can2p', 'wire', 'p');
        this.addPort(160 * this.scale, (H + 20) * this.scale, 'can2n', 'wire');
    }

    // ══════════════════════════════════════════
    //  交互
    // ══════════════════════════════════════════
    _initInteraction() {
        CH_CONFIG.forEach(ch => {
            const disp = this._chDisplays[ch.id];
            disp.bg.on('click tap', () => {
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

        this.nmtState = NMT_STATE.INIT;
        this.nmtStateTime = Date.now();
    }

    _tick() {
        const now = Date.now();

        if (!this.powerOn) {
            Object.keys(this.channels).forEach(id => {
                if (this.channels[id].state) this._setOutput(id, false);
            });
            this._renderOff();
            return;
        }

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

        if (this.lastRxTime > 0 && (now - this.lastRxTime) > this.comTimeout) {
            this._applySafeOutput();
            this.ledStatus.flt = true;
        } else {
            const wasTimeout = Object.keys(this.channels).some(id => this.channels[id].hold);
            Object.keys(this.channels).forEach(id => { this.channels[id].hold = false; });
            if (wasTimeout) this._notifyModeChange();
        }

        this.ledStatus.run = (now % 1000) < 500;
        this._updatePulse(now);

        ['ch3', 'ch4'].forEach(id => {
            const ch = this.channels[id];
            ch.loadMA = 0;
            ch.fault = ch.state && ch.loadMA > 500;
        });

        ['ch1', 'ch2'].forEach(id => {
            this.channels[id].fault = !this.channels[id].coilOK;
        });

        this.ch1R = this.channels.ch1.state ? 0.01 : 1e9;
        this.ch2R = this.channels.ch2.state ? 0.01 : 1e9;

        if (this._isCanTransmit() && now - this.lastTxTime >= this.txInterval) {
            this._canTransmitStatus();
            this.lastTxTime = now;
        }

        this._comBlink = (now - this.lastTxTime) < 80;
        this.ledStatus.com = (!this.busConnected || this.commFault) ? false : this._comBlink;
        
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
        if (ch.type === 'RELAY' && prev !== state) ch.toggleCnt++;
    }

    _updatePulse(now) {
        Object.keys(this.pulseConfig).forEach(id => {
            const pc = this.pulseConfig[id];
            if (!pc.active) return;
            const period = pc.onMs + pc.offMs;
            const phaseOffsetMs = ((pc.phaseStart % 360) / 360) * period;
            const currentTimeInCycle = (now + phaseOffsetMs) % period;
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
                case 'hold': break;
            }
            ch.hold = true;
        });
    }

    // ══════════════════════════════════════════
    //  通知模式变更
    // ══════════════════════════════════════════
    _notifyModeChange() {
        const chIds = ['ch1', 'ch2', 'ch3', 'ch4'];
        chIds.forEach((chId, i) => {
            const modeIdx = ['hand', 'auto', 'pulse', 'disable'].indexOf(this.channels[chId].mode);
            this._sendResponse([0x20, i, modeIdx < 0 ? 0 : modeIdx, 0, 0, 0, 0, 0]);
        });
    }

    // ══════════════════════════════════════════
    //  公开 API
    // ══════════════════════════════════════════

    setOutput(chId, state) {
        if (this.channels[chId] !== undefined) {
            this.channels[chId].hold = false;
            this.pulseConfig[chId].active = false;
            this._setOutput(chId, state);
        }
    }

    startPulse(chId, onMs, offMs, phStart) {
        if (!this.pulseConfig[chId]) return;
        this.pulseConfig[chId].active = true;
        this.pulseConfig[chId].onMs = Math.max(50, onMs);
        this.pulseConfig[chId].offMs = Math.max(50, offMs);
        this.pulseConfig[chId].phaseStart = phStart;
        this.channels[chId].hold = false;
    }

    stopPulse(chId) {
        if (this.pulseConfig[chId]) {
            this.pulseConfig[chId].active = false;
            this._setOutput(chId, false);
        }
    }

    setSafeOutput(chId, mode, preset = false) {
        if (this.safeOutput[chId]) {
            this.safeOutput[chId].mode = mode;
            this.safeOutput[chId].presetState = preset;
        }
    }

    setCoilFault(chId, fault) {
        if (this.channels[chId] && this.channels[chId].type === 'RELAY') {
            this.channels[chId].coilOK = !fault;
        }
    }

    getChannelOutputs() {
        return Object.keys(this.channels).reduce((acc, id) => {
            const ch = this.channels[id];
            acc[id] = { type: ch.type, state: ch.state, fault: ch.fault, hold: ch.hold };
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
applyVisualsMixin(DOModule.prototype);
applyCANMixin(DOModule.prototype);
