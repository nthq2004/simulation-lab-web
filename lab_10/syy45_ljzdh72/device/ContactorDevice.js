import { BaseDevice } from './BaseDevice.js';

export class ContactorDevice extends BaseDevice {
    constructor(config) {
        super(config);
        this.state = {
            pickup: false,
            current: 0,
            voltage: 0,
        };
        this._manualOverride = false;
        // 线圈额定电压（V）：吸合取 0.85Un、释放取 0.7Un（默认 220，可被组件设定）
        this.ratedVoltage = config.ratedVoltage !== undefined ? config.ratedVoltage : 220;
    }

    setRatedVoltage(v) {
        if (v > 0) this.ratedVoltage = v;
    }

    getRatedVoltage() {
        return this.ratedVoltage;
    }

    setCurrent(v) {
        this.state.current = v;
    }

    getCurrent() {
        return this.state.current;
    }

    setVoltage(v) {
        this.state.voltage = v;
    }

    getVoltage() {
        return this.state.voltage;
    }

    isPickup() {
        return this.state.pickup;
    }

    setManualOverride(v) {
        this._manualOverride = !!v;
    }

    getManualOverride() {
        return this._manualOverride;
    }

    getContactClosed() {
        return this.state.pickup || this._manualOverride;
    }

    preUpdate(dt) {
        const ratedVoltage = this.ratedVoltage || 220;
        const PICKUP_VOLTAGE  = ratedVoltage * 0.85;
        const RELEASE_VOLTAGE = ratedVoltage * 0.7;

        const next = this.state.pickup
            ? this.state.voltage > RELEASE_VOLTAGE
            : this.state.voltage > PICKUP_VOLTAGE;

        this._setNext('pickup', next);
    }
}