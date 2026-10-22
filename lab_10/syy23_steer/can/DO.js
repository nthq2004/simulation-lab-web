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
import { NMT_STATE, CAN_TICK_INTERVAL } from './CANBUS.js';

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
        this.cache = 'fixed';  // 模板：静态部件仅 _staticGroup 做一次位图缓存，运行时不再刷新

        // ── 电源状态 ──
        this.powerOn = false;
        this.isBreak = false;
        this.commFault = false;
        this.moduleFault = false;
        this.channelFault = false;

        // ── 节点地址 (0~15) ──
        this.nodeAddress = 4;   // 默认地址，config 覆盖由 _initParameters() 读入

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

        // ── 新组件模板：固定调用顺序 ──
        this._initGroups();              // 静态 / 动态 / 交互 分组
        this._adoptGroups();             // 三组挂进 scaleGroup（本组件按倍率缩放）
        this._recalcGeometry();          // 计算几何尺寸
        this._initParameters(config);    // 参数读入 + config 副本
        this._init();                    // 静态绘制 → 动态节点 → 交互绑定
        this._initPorts();               // 最后注册端口
        this._startLoop();
    }

    /** 模板：几何尺寸计算 */
    _recalcGeometry() {
        this.width = W;
        this.height = H;
    }

    /** 模板：参数初始化（用 config 覆盖默认值，并保存 config 副本） */
    _initParameters(config) {
        if (config) {
            if (config.nodeAddress != null) this.nodeAddress = config.nodeAddress;
            if (config.termEnabled != null) this.termEnabled = !!config.termEnabled;
            if (config.heartbeatTimeout != null) this.heartbeatTimeout = config.heartbeatTimeout;
        }
        this.config = {
            nodeAddress: this.nodeAddress,
            termEnabled: this.termEnabled,
            heartbeatTimeout: this.heartbeatTimeout,
        };
    }

    /** 模板：可配置参数列表（供右键「参数设置」使用） */
    getConfigFields() {
        return [
            { key: 'nodeAddress', label: '节点地址(0~15)', min: 0, max: 15, step: 1 },
            { key: 'termEnabled', label: '终端电阻 120Ω', type: 'boolean' },
        ];
    }

    /** 模板：配置更新回调 */
    onConfigUpdate(cfg) {
        if (!cfg) return;
        if (cfg.nodeAddress != null) {
            this.nodeAddress = Math.max(0, Math.min(15, Number(cfg.nodeAddress) || 0));
            this._refreshSwitches && this._refreshSwitches();
            this._nodeAddrDisplay && this._nodeAddrDisplay.text(`NODE:${String(this.nodeAddress).padStart(2, '0')}`);
        }
        if (cfg.termEnabled != null) {
            this.termEnabled = !!cfg.termEnabled;
            this.currentResistance = this.termEnabled ? 120 : 1000000;
            if (this._termKnob) this._termKnob.fill(this.termEnabled ? '#00aaff' : '#333');
        }
        Object.assign(this.config || {}, { nodeAddress: this.nodeAddress, termEnabled: this.termEnabled });
        this.markDirty();
        this._refreshIfDirty(true);
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
            this.markDirty();
            this._refreshIfDirty(true);
        });
    }

    // ══════════════════════════════════════════
    //  主循环：由 consys._tickAll 集中调用 tick(dt)，累计 CAN_TICK_INTERVAL 执行一次（10Hz）
    // ══════════════════════════════════════════
    _startLoop() {
        this._tickAcc = 0;
        this.nmtState = NMT_STATE.INIT;
        this.nmtStateTime = Date.now();
    }

    /** 集中式 tick（20fps 调用）：累计到 CAN_TICK_INTERVAL(100ms) 再执行原 _tick */
    tick(dt) {
        this._tickAcc = (this._tickAcc || 0) + dt;
        if (this._tickAcc < CAN_TICK_INTERVAL / 1000) return;
        this._tickAcc = 0;
        try {
            this.powerOn = this.sys.getVoltageBetween(`${this.id}_wire_vcc`, `${this.id}_wire_gnd`) > 18 && this.isBreak === false;
            this.busConnected = this.sys.isOnCanBus(`${this.id}_wire_can1p`) &&
                this.sys.isOnCanBus(`${this.id}_wire_can1n`);
        } catch (_) { /* 未连线时由 setPower() 控制 */ }
        this._tick();
        // 每个 10Hz 周期结束刷新：清除 cache=false 组件残留的固化位图并请求重绘
        this.markDirty();
        this._refreshIfDirty();
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
            if (wasTimeout) {
                // 通信恢复：把被安全输出强制改成 'hand' 的通道模式还原为故障前的值，
                // 否则通道会永久停在手动（设置页显示手动、实际是自动）。
                this._restoreModeFromSafe();
                this._notifyModeChange();
            }
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

        // COM 灯：最近有 CAN 收发活动时按 1Hz 闪烁，无活动/断线/故障时熄灭。
        // 原实现用「TX 后 80ms 点亮」的窄窗口绑死 TX 时刻，AI/DI 因 txInterval
        // 较小而每次都落在窗口内 → 灯恒亮不闪；AO/DO 则相反。改为固定占空比后
        // 四个模块行为统一、且节拍与模块上报周期无关。
        const comActive = (now - Math.max(this.lastTxTime || 0, this.lastRxTime || 0)) < 1500;
        this._comBlink = comActive && ((now % 600) < 300);
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
            const ch = this.channels[id];
            // 通道模式为 pulse 时就应输出脉冲。
            // 原实现只认 pc.active 标志，而该标志仅由手工 setPulse() 置位 ——
            // 在「DO 设置」页把模式切到 pulse 时它仍是默认的 false，导致
            // 第一行就 return，表现为"切到脉冲模式没有脉冲输出"。
            // 现在以通道模式为准；active 仅保留为手工 setPulse 的开关。
            const modeIsPulse = !!(ch && ch.mode === 'pulse');
            if (!modeIsPulse) { pc.active = false; return; }
            pc.active = true;

            const onMs  = Number(pc.onMs)  > 0 ? pc.onMs  : 500;
            const offMs = Number(pc.offMs) > 0 ? pc.offMs : 500;
            const period = onMs + offMs;
            const phaseOffsetMs = ((Number(pc.phaseStart) || 0) % 360) / 360 * period;
            const currentTimeInCycle = (now + phaseOffsetMs) % period;
            this._setOutput(id, currentTimeInCycle < onMs);
        });
    }

    _applySafeOutput() {
        Object.keys(this.channels).forEach(id => {
            const ch = this.channels[id];
            if (ch.hold) return;
            const safe = this.safeOutput[id];
            // 进入安全输出前记下通道原模式：安全动作会把 mode 强制改成 'hand'，
            // 若不在恢复时还原，通信故障结束后通道会永久停在"手动"，
            // 表现为"设置页显示手动、实际是自动"。
            if (!this._modeBeforeSafe) this._modeBeforeSafe = {};
            if (this._modeBeforeSafe[id] === undefined) this._modeBeforeSafe[id] = ch.mode;
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

    /** 通信恢复时还原被安全输出改掉的通道模式 */
    _restoreModeFromSafe() {
        if (!this._modeBeforeSafe) return;
        Object.keys(this._modeBeforeSafe).forEach(id => {
            const ch = this.channels[id];
            const was = this._modeBeforeSafe[id];
            if (ch && was !== undefined && ch.mode !== was) ch.mode = was;
        });
        this._modeBeforeSafe = null;
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
        // 定时器已迁移至集中 tick，无需清理
        super.destroy && super.destroy();
    }
}

// ── 混入视觉和 CAN 通信方法 ──
applyVisualsMixin(DOModule.prototype);
applyCANMixin(DOModule.prototype);
