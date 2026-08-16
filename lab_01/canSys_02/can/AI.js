/**
 * AI.js — 模拟量输入模块 (Analog Input Module) · 主入口
 * 船舶机舱监测报警系统 · CAN 总线架构
 *
 * 硬件规格：
 *   - 2路 4-20mA 电流输入 (CH1, CH2)
 *   - 1路 RTD 热电阻输入 (PT100)
 *   - 1路 TC 热电偶输入 (K型)
 *   - 2路 CAN 总线接口 (CANH / CANL)
 *   - DC 24V 电源接口
 *   - 4路通道运行指示灯 (每通道1个)
 *   - 4个模块状态指示灯：PWR / RUN / FLT / COM
 *   - 4位地址码拨码开关 (SW1~SW4，二进制编码，地址范围 0-15)
 *   - 1个终端电阻使能开关 (120Ω)
 *
 * 模块拆分说明：
 *   AI.constants.js  — 常量、通道配置、默认数据工厂函数
 *   AI.visuals.js    — Konva 图形绘制 Mixin（_initVisuals、_render 等）
 *   AI.can.js        — CAN 总线通信 Mixin（onCanReceive、_canTransmit 等）
 *   AI.js            — 主类（构造、主循环、通道数据处理、公开 API）
 */

import { BaseComponent } from '../components/BaseComponent.js';
import { NMT_STATE }     from './CANBUS.js';

import { W, H, CH_CONFIG, defaultChannels, defaultRanges, defaultAlarms } from './dpu/AI.constants.js';
import { applyVisualsMixin } from './dpu/AI.visuals.js';
import { applyCANMixin }     from './dpu/AI.can.js';

// ─────────────────────────────────────────────
//  主类定义
// ─────────────────────────────────────────────
export class AIModule extends BaseComponent {
    /**
     * @param {Object} config - 初始化配置对象（可选）
     * @param {Object} sys    - 系统环境对象（仿真引擎）
     */
    constructor(config, sys) {
        super(config, sys);

        this.w     = W;
        this.h     = H;
        this.scale = 1.35;
        this.type  = 'AI';
        this.special = 'can';
        this.cache   = 'fixed';

        // ── 电源 / 物理连接状态 ──
        this.powerOn      = false;
        this.busConnected = false;

        // ── 5种故障状态 ──
        this.isBreak     = false;
        this.commFault   = false;
        this.moduleFault = false;
        this.channelFault = false;
        this.sysFault    = false;

        // ── 节点地址 (0~15)，由拨码开关决定 ──
        this.nodeAddress = (config && config.nodeAddress != null) ? config.nodeAddress : 1;

        // ── 终端电阻 ──
        this.termEnabled      = false;
        this.currentResistance = 1000000;

        // ── 通道数据 ──
        this.channels = defaultChannels();
        this.ranges   = defaultRanges();
        this.alarms   = defaultAlarms();

        // ── 模块状态灯 ──
        this.ledStatus = { pwr: false, run: false, flt: false, com: false };

        // ── CAN 总线状态 ──
        this.canBusConnected = false;
        this.lastTxTime  = 0;
        this.lastRxTime  = 0;
        this.txCount     = 0;
        this.rxCount     = 0;
        this.txInterval  = 200;   // ms
        this.comErrorCount = 0;

        // ── 内部计时 ──
        this._runBlink  = false;
        this._comBlink  = false;
        this._blinkTick = 0;

        // ── NMT 网络管理状态机 ──
        this.nmtState       = 'init';
        this.nmtStateTime   = Date.now();
        this._lastHeartbeat = 0;
        this.heartbeatTimeout = 10000;  // ms，可通过 config 覆盖

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
        // 左侧：4路模拟输入，每路 + / -
        CH_CONFIG.forEach((ch, i) => {
            const yBase = 44 + i * 52;
            this.addPort(-18 * this.scale, (yBase + 12) * this.scale, `${ch.id}p`, 'wire', 'p');
            this.addPort(-18 * this.scale, (yBase + 38) * this.scale, `${ch.id}n`, 'wire');
        });
        // 右侧：24V 电源
        this.addPort((W + 18) * this.scale, 10 * this.scale, 'vcc', 'wire', 'p');
        this.addPort((W + 18) * this.scale, 38 * this.scale, 'gnd', 'wire');
        // 底部：CAN 总线
        this.addPort(35  * this.scale, (H + 20) * this.scale, 'can1p', 'wire', 'p');
        this.addPort(80  * this.scale, (H + 20) * this.scale, 'can1n', 'wire');
        this.addPort(125 * this.scale, (H + 20) * this.scale, 'can2p', 'wire', 'p');
        this.addPort(170 * this.scale, (H + 20) * this.scale, 'can2n', 'wire');
    }

    // ══════════════════════════════════════════
    //  交互（双击重置通信错误计数）
    // ══════════════════════════════════════════
    _initInteraction() {
        this.scaleGroup.on('dblclick', () => {
            this.comErrorCount = 0;
            this._refreshCache();
        });
    }

    // ══════════════════════════════════════════
    //  主循环 (100ms/次)
    // ══════════════════════════════════════════
    _startLoop() {
        this._loopTimer = setInterval(() => {
            try {
                this.powerOn      = !this.isBreak &&
                    this.sys.getVoltageBetween(`${this.id}_wire_vcc`, `${this.id}_wire_gnd`) > 18;
                this.busConnected = this.sys.isPortConnected(`${this.id}_wire_can1p`, 'can_wire_can1p') &&
                    this.sys.isPortConnected(`${this.id}_wire_can1n`, 'can_wire_can1n');
            } catch (_) { }
            this._tick();
        }, 100);

        this.nmtState     = NMT_STATE.INIT;
        this.nmtStateTime = Date.now();
    }

    _tick() {
        const now = Date.now();
        this._blinkTick = now;

        // 1. 断电 → 黑屏
        if (!this.powerOn) {
            this._renderOff();
            return;
        }

        // 2. 电源灯常亮
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
            this.nmtState     = NMT_STATE.PREOP;
            this.nmtStateTime = now;
            console.log(`[AI #${this.nodeAddress}] Heartbeat lost → ${NMT_STATE.PREOP} state`);
        }

        // 5. RUN 灯（每 500ms 闪烁）
        this._runBlink     = (now % 1000) < 500;
        this.ledStatus.run = this._runBlink;

        // 6. 通道数据处理
        this._processChannels();

        // 7. CAN 定时上报
        if (this._isCanTransmit() && now - this.lastTxTime >= this.txInterval) {
            this._canTransmit();
            this.lastTxTime = now;
        }

        // 8. COM 灯（发送后点亮 80ms）
        this._comBlink     = (now - this.lastTxTime) < 80;
        this.ledStatus.com = (!this.busConnected || this.commFault) ? false : this._comBlink;

        // 9. FLT 灯
        this.ledStatus.flt = this.moduleFault || this.commFault || this.sysFault;

        if (this.powerOn&&this.busConnected && !this.commFault) this.sys.canBus.setNodeOnline(this.id);
        else                                       this.sys.canBus.resetNodeOnline(this.id);

        // 10. 渲染
        this._render();
    }

    // ══════════════════════════════════════════
    //  通道数据处理（ADC 转换 + 报警判断）
    // ══════════════════════════════════════════
    _processChannels() {
        // moduleFault：所有通道失效
        if (this.moduleFault) {
            Object.keys(this.channels).forEach(id => {
                this.channels[id].fault     = true;
                this.channels[id].faultText = 'OPEN';
                this.channels[id].value     = -1;
            });
            return;
        }

        Object.keys(this.channels).forEach(id => {
            const ch  = this.channels[id];
            const rng = this.ranges[id];
            const alm = this.alarms[id];

            // channelFault：仅 ch1 失效
            if (this.channelFault && id === 'ch1') {
                ch.fault = true; ch.faultText = 'OPEN'; ch.value = -1;
                return;
            }

            // ── ADC 转换 ──
            switch (ch.type) {
                case '4-20mA':
                    if (ch.raw < 3.8 || ch.raw > 20.5) {
                        ch.fault = true;
                        ch.faultText = ch.raw < 0.1 ? 'OPEN' : ch.raw > 21 ? 'SHORT' : 'OUTRANGE';
                    } else {
                        ch.fault = false;
                        ch.value = rng.lrv + ((ch.raw - 4) / 16) * (rng.urv - rng.lrv);
                    }
                    break;

                case 'RTD': {
                    const r = ch.raw;
                    if (r < 18.52 || r > 175.86) {
                        ch.fault = true;
                        ch.faultText = ch.raw < 0.5 ? 'SHORT' : ch.raw > 1000 ? 'OPEN' : 'OUTRANGE';
                    } else {
                        ch.fault = false;
                        ch.value = (r / 100 - 1) / 0.00385;  // PT100 线性近似
                    }
                    break;
                }
                case 'TC': {
                    const mv = ch.raw;
                    if (mv < -0.1 || mv > 17.0) {
                        ch.fault = true;
                        ch.faultText = ch.raw < -0.2 ? 'OPEN' : 'OUTRANGE';
                    } else {
                        ch.fault = false;
                        ch.value = mv / 0.04;  // K型热电偶线性近似
                    }
                    break;
                }
            }

            // 限幅（超量程不故障但截断）
            if (!ch.fault) {
                const margin = (rng.urv - rng.lrv) * 0.05;
                ch.value = Math.max(rng.lrv - margin, Math.min(rng.urv + margin, ch.value));
            }

            // ── 报警判断 ──
            if (!ch.fault) {
                const v = ch.value;
                if      (v >= alm.hh) alm.status = 'HH';
                else if (v >= alm.h)  alm.status = 'H';
                else if (v <= alm.ll) alm.status = 'LL';
                else if (v <= alm.l)  alm.status = 'L';
                else                  alm.status = 'normal';
            } else {
                alm.status = 'FAULT';
            }
        });
    }

    // ══════════════════════════════════════════
    //  公开 API（供仿真引擎调用）
    // ══════════════════════════════════════════

    /**
     * 注入原始信号值
     * @param {string} chId - 'ch1' | 'ch2' | 'ch3' | 'ch4'
     * @param {number} raw  - 4-20mA: mA；RTD: Ω；TC: mV
     */
    setRaw(chId, raw) {
        if (this.sysFault) return;
        const ch = this.channels[chId];
        if (ch !== undefined && ch.mode === 'normal') ch.raw = raw;
    }

    /**
     * 直接设置工程量（仅在 test 模式下生效）
     * 自动反算 raw 值以保持一致
     */
    setValue(chId, value) {
        const ch  = this.channels[chId];
        const rng = this.ranges[chId];
        if (!ch || !rng || ch.mode !== 'test') return;
        ch.value = value;
        ch.fault = false;
        switch (ch.type) {
            case '4-20mA': ch.raw = 4 + ((value - rng.lrv) / (rng.urv - rng.lrv)) * 16;   break;
            case 'RTD':    ch.raw = 100 * (1 + 0.00385 * value);                             break;
            case 'TC':     ch.raw = value * 0.04;                                             break;
        }
    }

    /** 获取所有通道工程量（供中央计算机轮询读取）*/
    getChannelValues() {
        return Object.keys(this.channels).reduce((acc, id) => {
            acc[id] = {
                value: this.channels[id].value,
                fault: this.channels[id].fault,
                alarm: this.alarms[id].status,
                unit:  this.ranges[id].unit,
                mode:  this.channels[id].mode,
            };
            return acc;
        }, {});
    }

    /**
     * 设置通道模式
     * @param {string} chId - 'ch1' | 'ch2' | 'ch3' | 'ch4'
     * @param {string} mode - 'normal' | 'test' | 'disable'
     */
    setChannelMode(chId, mode) {
        const ch = this.channels[chId];
        if (ch !== undefined && ['normal', 'test', 'disable'].includes(mode)) ch.mode = mode;
    }

    /** 销毁模块，清除定时器 */
    destroy() {
        if (this._loopTimer) clearInterval(this._loopTimer);
        super.destroy && super.destroy();
    }
}

// ─────────────────────────────────────────────
//  混入图形和 CAN 方法到原型
// ─────────────────────────────────────────────
applyVisualsMixin(AIModule.prototype);
applyCANMixin(AIModule.prototype);