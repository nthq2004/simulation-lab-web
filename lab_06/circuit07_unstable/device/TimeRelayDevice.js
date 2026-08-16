import { BaseDevice } from './BaseDevice.js';

/**
 * TimeRelayDevice — 时间继电器设备状态机（复合设备核心）
 *
 * 由时间继电器线圈（TimeRelayCoil）驱动：
 *   线圈采集两端电压 RMS → setVoltage() → preUpdate() 状态迁移
 *
 * 状态机（通电延时型，如 JSZ3）：
 *   idle  （待机）：线圈电压低于释放阈值，触头保持初始状态
 *   timing（延时中）：线圈得电开始计时，计时到达后进入 output
 *   output（输出） ：延时到达，常开延时闭合触头闭合、常闭延时断开触头断开
 *
 * 触点状态（供触头组件读取）：
 *   getNOClosed() — 常开延时闭合触头：延时到达且经过换接间隔后闭合
 *   getNCClosed() — 常闭延时断开触头：非 output 态闭合
 *
 * 为避免星三角切换瞬间 Y/Δ 两接触器同时吸合造成相间短路，
 * 常闭触头在延时到达瞬间断开，常开触头在延时到达 + closeGap 后才闭合。
 */
export class TimeRelayDevice extends BaseDevice {
    constructor(config) {
        super(config);
        this.state = {
            energized: false,
            state: 'idle',
            elapsed: 0,
        };
        this.delayTime      = config.delayTime !== undefined ? config.delayTime : 5;
        this.closeGap       = config.closeGap  !== undefined ? config.closeGap  : 0.5;
        this.pickupVoltage  = config.pickupVoltage  !== undefined ? config.pickupVoltage  : 160;
        this.releaseVoltage = config.releaseVoltage !== undefined ? config.releaseVoltage : 40;
        this._manualOverride = false;
    }

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

    /** 常开延时闭合触头：延时到达并经过换接间隔（closeGap）后闭合 */
    getNOClosed() {
        const gapDone = this.state.elapsed >= this.delayTime + this.closeGap;
        return (this.state.state === 'output' && gapDone) || this._manualOverride;
    }

    /** 常闭延时断开触头：延时到达（output）前闭合 */
    getNCClosed() {
        return this.state.state !== 'output' || this._manualOverride;
    }

    preUpdate(dt) {
        const v = this.getVoltage();
        const st = this.state.state;

        let nextState = st;
        let nextElapsed = this.state.elapsed;
        let nextEnergized = this.state.energized;

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

        this._setNext('state', nextState);
        this._setNext('elapsed', nextElapsed);
        this._setNext('energized', nextEnergized);
    }
}
