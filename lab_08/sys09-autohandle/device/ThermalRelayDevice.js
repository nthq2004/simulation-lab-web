import { BaseDevice } from './BaseDevice.js';

/**
 * ThermalRelayDevice — 热继电器设备状态机（复合设备核心）
 *
 * 由发热元件（ThermalHeatElement）驱动：
 *   发热元件采集三相电流 RMS → setCurrent() → preUpdate() 反时限热积累
 *   热量 ≥ 100% → tripped → 常闭断开 / 常开闭合
 *
 * 反时限特性（模拟双金属片热积累）：
 *   过载比 ratio = |I| / I_rated
 *   ratio > 1 时热量按 tripTime = tripClass / (ratio² - 1) 累积
 *   ratio ≤ 1 时热量按时间常数缓慢散失
 *   tripClass 越大，同样过载倍数下动作越慢（IEC 脱扣等级）
 */
export class ThermalRelayDevice extends BaseDevice {
    constructor(config) {
        super(config);
        this.state = {
            tripped: false,
            current: 0,
            heat: 0,
        };
        this.ratedCurrent = config.ratedCurrent || 9;
        this.tripClass    = config.tripClass    || 10;
        this._manualTrip  = false;
        this._resetRequested = false;
    }

    setCurrent(v) {
        this.state.current = v;
    }

    getCurrent() {
        return this.state.current;
    }

    setRatedCurrent(v) {
        if (v > 0) this.ratedCurrent = v;
    }

    getRatedCurrent() {
        return this.ratedCurrent;
    }

    setTripClass(v) {
        this.tripClass = v;
    }

    getTripClass() {
        return this.tripClass;
    }

    isTripped() {
        return this.state.tripped;
    }

    getHeat() {
        return this.state.heat;
    }

    /** 常闭触点：未脱扣时闭合 */
    getNCClosed() {
        return !this.state.tripped;
    }

    /** 常开触点：脱扣时闭合 */
    getNOClosed() {
        return this.state.tripped;
    }

    setManualTrip(v) {
        this._manualTrip = !!v;
    }

    getManualTrip() {
        return this._manualTrip;
    }

    /** 请求复位（仅当过载已消失时生效） */
    requestReset() {
        this._resetRequested = true;
    }

    preUpdate(dt) {
        const current = Math.abs(this.state.current || 0);
        const rated   = this.ratedCurrent > 0 ? this.ratedCurrent : 9;
        const ratio   = current / rated;
        const heat    = this.state.heat;

        // 手动试验脱扣：强制进入并保持脱扣
        if (this._manualTrip) {
            this._setNext('tripped', true);
            this._setNext('heat', 1);
            this._resetRequested = false;
            return;
        }

        let nextHeat;
        if (ratio > 1) {
            // 反时限热积累：动作时间 ≈ tripClass / (ratio² - 1) 秒
            const tripTime = this.tripClass / Math.max(0.05, ratio * ratio - 1);
            nextHeat = Math.min(1, heat + dt / tripTime);
        } else {
            // 冷却：时间常数约 20s 的指数衰减
            nextHeat = Math.max(0, heat - dt * heat * 0.05);
        }

        let tripped = nextHeat >= 1;
        if (tripped) {
            // 已脱扣且过载消失 + 复位请求 → 复位
            if (this._resetRequested && ratio <= 1) {
                tripped = false;
                nextHeat = 0;
            }
        }

        this._setNext('heat', nextHeat);
        this._setNext('tripped', tripped);
        this._resetRequested = false;
    }
}
