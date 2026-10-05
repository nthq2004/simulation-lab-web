import { BaseDevice } from './BaseDevice.js';

/**
 * TimeRelayDevice — 时间继电器设备状态机（复合设备核心）
 *
 * 由时间继电器线圈（TimeRelayCoil）驱动：
 *   线圈采集两端电压 RMS → setVoltage() → preUpdate() 状态迁移
 *
 * 两种延时方式（mode）：
 *   'on'  通电延时（delay-on，如 JSZ3）：
 *       idle（待机）→ 线圈得电进入 timing（计时）→ 计时到达进入 output（输出）
 *       线圈失电 → 立即回到 idle
 *   'off' 断电延时（delay-off）：
 *       线圈得电 → 立即进入 output（NO 立即闭合、NC 立即断开）
 *       线圈失电 → 保持 output 并开始计时，延时到达后才回到 idle
 *
 * 触点状态（供触头组件读取）：
 *   getNOClosed() — 常开触头：delay-on 为延时到达后闭合；delay-off 为线圈得电即闭合
 *   getNCClosed() — 常闭触头：output 期间断开，其余时间闭合
 */
export class TimeRelayDevice extends BaseDevice {
    constructor(config) {
        super(config);
        this.state = {
            energized: false,
            state: 'idle',
            elapsed: 0,
        };
        this.mode           = config.mode || 'on';   // 'on' 通电延时 | 'off' 断电延时
        this.delayTime      = config.delayTime !== undefined ? config.delayTime : 5;
        this.closeGap       = config.closeGap  !== undefined ? config.closeGap  : 0.5;
        this.pickupVoltage  = config.pickupVoltage  !== undefined ? config.pickupVoltage  : 160;
        this.releaseVoltage = config.releaseVoltage !== undefined ? config.releaseVoltage : 40;
        this._manualOverride = false;
    }

    setMode(m) {
        if (m === 'on' || m === 'off') this.mode = m;
    }

    getMode() { return this.mode; }

    /**
     * 设置线圈额定电压：吸合电压取 0.85Un、返回电压取 0.7Un。
     * （本工程时间继电器为 24V 线圈，故吸合 ≈20.4V、返回 ≈16.8V）
     */
    setRatedVoltage(u) {
        if (u > 0) {
            this.ratedVoltage   = u;
            this.pickupVoltage  = 0.85 * u;
            this.releaseVoltage = 0.7 * u;
        }
    }

    getRatedVoltage() { return this.ratedVoltage || 0; }

    setVoltage(v) {
        this.state.voltage = v;
    }

    getVoltage() {
        return this.state.voltage || 0;
    }

    setDelayTime(v) {
        if (v !== undefined && isFinite(v)) this.delayTime = Math.max(0, Math.min(30, parseFloat(v)));
    }

    getDelayTime() {
        return this.delayTime;
    }

    getState() {
        return this.state.state;
    }

    isEnergized() {
        return this.state.energized;
    }

    isOutput() {
        return this.state.state === 'output';
    }

    setManualOverride(v) {
        this._manualOverride = !!v;
    }

    getManualOverride() {
        return this._manualOverride;
    }

    /** 常开触头：delay-on 为延时到达并经过换接间隔后闭合；delay-off 为线圈得电即闭合 */
    getNOClosed() {
        if (this._manualOverride) return true;
        if (this.mode === 'off') return this.state.state === 'output';
        const gapDone = this.state.elapsed >= this.delayTime + this.closeGap;
        return (this.state.state === 'output' && gapDone);
    }

    /** 常闭触头：output 期间断开（delay-off 时含断电延续期），其余时间闭合 */
    getNCClosed() {
        return this.state.state !== 'output' || this._manualOverride;
    }

    preUpdate(dt) {
        const v = this.getVoltage();
        const st = this.state.state;

        let nextState = st;
        let nextElapsed = this.state.elapsed;
        let nextEnergized = this.state.energized;

        if (this.mode === 'off') {
            // ── 断电延时（delay-off）──
            if (v > this.pickupVoltage) {
                // 得电：立即输出，计时清零
                nextState = 'output';
                nextElapsed = 0;
                nextEnergized = true;
            } else if (v < this.releaseVoltage) {
                // 失电：保持输出并开始计时，延时到达后复位
                if (st === 'output') {
                    nextElapsed += dt;
                    if (nextElapsed >= this.delayTime) { nextState = 'idle'; nextElapsed = 0; }
                } else {
                    nextState = 'idle';
                    nextElapsed = 0;
                }
                nextEnergized = false;
            }
        } else {
            // ── 通电延时（delay-on）──
            if (v > this.pickupVoltage) {
                if (st === 'idle') {
                    nextState = 'timing';
                    nextElapsed = 0;
                } else if (st === 'timing') {
                    nextElapsed += dt;
                    if (nextElapsed >= this.delayTime) {
                        nextState = 'output';
                        nextElapsed = this.delayTime;
                    }
                } else if (st === 'output') {
                    // 输出态持续计时，用于换接间隔（closeGap）判断
                    nextElapsed += dt;
                }
                nextEnergized = true;
            } else if (v < this.releaseVoltage) {
                if (st !== 'idle') {
                    nextState = 'idle';
                    nextElapsed = 0;
                }
                nextEnergized = false;
            }
        }

        this._setNext('state', nextState);
        this._setNext('elapsed', nextElapsed);
        this._setNext('energized', nextEnergized);
    }
}
