/**
 * AO.js — 模拟量输出模块 (Analog Output Module) · 主入口
 * 船舶机舱监测报警系统 · CAN 总线架构
 *
 * 硬件规格：
 *   - 2路 4-20mA 电流输出 (CH1, CH2)
 *   - 2路 PWM 输出 (CH3, CH4)
 *   - CAN 总线接口 (CANH / CANL)
 *   - DC 24V 电源接口
 *   - 4路通道运行指示灯 (每通道1个)
 *   - 4个模块状态指示灯：PWR / RUN / FLT / COM
 *   - 4位地址码拨码开关 (SW1~SW4，二进制编码，地址范围 0-15)
 *   - 1个终端电阻使能开关 (120Ω)
 *
 * 模块拆分说明：
 *   AO.constants.js  — 常量、通道配置、默认数据工厂函数
 *   AO.visuals.js    — Konva 图形绘制 Mixin（_initVisuals、_render 等）
 *   AO.can.js        — CAN 总线通信 Mixin（onCanReceive、_canTransmit 等）
 *   AO.js            — 主类（构造、主循环、输出更新、安全输出、公开 API）
 */

import { BaseComponent } from '../components/BaseComponent.js';
import { NMT_STATE }     from './CANBUS.js';

import { W, H, CH_CONFIG, PWM_RENDER_INTERVAL, defaultChannels, defaultRanges, defaultSafeOutput } from './dpu/AO.constants.js';
import { applyVisualsMixin } from './dpu/AO.visuals.js';
import { applyCANMixin }     from './dpu/AO.can.js';

// ─────────────────────────────────────────────
//  主类
// ─────────────────────────────────────────────
export class AOModule extends BaseComponent {

    constructor(config, sys) {
        super(config, sys);

        this.w = W;
        this.h = H;
        this.scale = 1.1;
        this.type = 'AO';
        this.special = 'can';
        this.cache = 'fixed';

        // ── 电源状态 ──
        this.powerOn = false;
        this.isBreak = false;
        this.commFault = false;
        this.moduleFault = false;
        this.channelFault = false;

        // ── 节点地址 (0~15) ──
        this.nodeAddress = (config && config.nodeAddress != null) ? config.nodeAddress : 2;

        // ── 终端电阻 ──
        this.termEnabled = false;
        this.currentResistance = 1000000;

        // ── 通道输出数据 ──
        this.channels = defaultChannels();

        // ── 量程/单位配置 ──
        this.ranges = defaultRanges();

        // ── 安全输出配置 ──
        this.safeOutput = defaultSafeOutput();

        // ── 模块状态灯 ──
        this.ledStatus = { pwr: false, run: false, flt: false, com: false };

        // ── CAN 总线状态 ──
        this.canBusConnected = false;
        this.lastRxTime = 0;
        this.lastTxTime = 0;
        this.txCount = 0;
        this.rxCount = 0;
        this.txInterval = 500;
        this.comErrorCount = 0;
        this.comTimeout = 2000;
        this.heartbeatTimeout = 5000;

        // ── 内部计时 ──
        this._runBlink = false;
        this._blinkTick = 0;
        this._lastPwmTick = 0;

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

        this.addPort((W + 18) * this.scale, 10 * this.scale, 'vcc', 'wire', 'p');
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
        }, PWM_RENDER_INTERVAL);

        this.nmtState = NMT_STATE.INIT;
        this.nmtStateTime = Date.now();
    }

    _tick() {
        const now = Date.now();
        this._blinkTick = now;

        if (!this.powerOn) {
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
            console.log(`[AO #${this.nodeAddress}] Heartbeat lost → PREOP state`);
        }

        this._runBlink = (now % 1000) < 500;
        this.ledStatus.run = this._runBlink;

        const comAge = now - this.lastRxTime;
        if (this.lastRxTime > 0 && comAge > this.comTimeout) {
            this._applySafeOutput();
            this.ledStatus.flt = true;
        }

        this._updateOutputs(now);

        if (this._isCanTransmit() && now - this.lastTxTime >= this.txInterval) {
            this._canTransmitStatus();
            this.lastTxTime = now;
        }

        this._comBlink = (now - this.lastTxTime) < 80;
        this.ledStatus.com = (!this.busConnected || this.commFault) ? false : this._comBlink;

        this.ledStatus.flt = this.moduleFault || this.commFault || this.sysFault||!this.busConnected;
        if (this.powerOn && this.busConnected && !this.commFault) this.sys.canBus.setNodeOnline(this.id);
        else this.sys.canBus.resetNodeOnline(this.id);
        this._render();
    }

    // ══════════════════════════════════════════
    //  输出更新
    // ══════════════════════════════════════════
    _updateOutputs(now) {
        const dt = (now - this._lastPwmTick) / 1000;
        this._lastPwmTick = now;

        Object.keys(this.channels).forEach(id => {
            const ch = this.channels[id];
            const rng = this.ranges[id];

            if (ch.mode === 'disable') {
                ch.actual = 0;
                ch.instantOn = false;
                ch.percent = 0;
                return;
            }

            let pct = ch.percent;
            pct = Math.max(rng.lrv, Math.min(rng.urv, pct));
            pct = Math.max(0, Math.min(100, pct));

            if (ch.type === '4-20mA') {
                ch.actual = 4 + (pct / 100) * 16;
                ch.fault = false;
            } else if (ch.type === 'PWM') {
                const period = ch.frequency / 200;
                ch.pwmPhase += dt;
                if (ch.pwmPhase >= period) ch.pwmPhase = ch.pwmPhase % period;
                ch.actual = pct;
                ch.instantOn = ch.pwmPhase < (period * pct / 100);
            }
        });
    }

    // ══════════════════════════════════════════
    //  安全输出（通信超时）
    // ══════════════════════════════════════════
    _applySafeOutput() {
        Object.keys(this.channels).forEach(id => {
            const ch = this.channels[id];
            const safe = this.safeOutput[id];
            if (ch.hold) return;
            switch (safe.mode) {
                case 'hold':    break;
                case 'preset':  ch.percent = safe.presetPercent; break;
                case 'zero':    ch.percent = 0; break;
            }
            ch.hold = true;
        });
    }

    // ══════════════════════════════════════════
    //  公开 API
    // ══════════════════════════════════════════

    setOutput(chId, percent) {
        if (this.channels[chId] !== undefined && this.channels[chId].mode === 'hand') {
            this.channels[chId].percent = Math.max(0, Math.min(100, percent));
            this.channels[chId].hold = false;
        }
    }

    setPwmFrequency(chId, hz) {
        if (this.channels[chId] && this.channels[chId].type === 'PWM') {
            this.channels[chId].frequency = Math.max(1, hz);
        }
    }

    setSafeOutput(chId, mode, presetPercent = 0) {
        if (this.safeOutput[chId]) {
            this.safeOutput[chId].mode = mode;
            this.safeOutput[chId].presetPercent = presetPercent;
        }
    }

    setPower(on) { this.powerOn = on; }

    getChannelOutputs() {
        return Object.keys(this.channels).reduce((acc, id) => {
            const ch = this.channels[id];
            acc[id] = {
                type: ch.type, percent: ch.percent, actual: ch.actual,
                instantOn: ch.instantOn, fault: ch.fault, hold: ch.hold,
            };
            return acc;
        }, {});
    }

    destroy() {
        if (this._loopTimer) clearInterval(this._loopTimer);
        super.destroy && super.destroy();
    }
}

// ── 混入视觉和 CAN 通信方法 ──
applyVisualsMixin(AOModule.prototype);
applyCANMixin(AOModule.prototype);
