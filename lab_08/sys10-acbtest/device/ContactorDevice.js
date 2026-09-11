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
        const ratedVoltage = 220;
        const PICKUP_VOLTAGE  = ratedVoltage * 0.85;
        const RELEASE_VOLTAGE = ratedVoltage * 0.7;

        const next = this.state.pickup
            ? this.state.voltage > RELEASE_VOLTAGE
            : this.state.voltage > PICKUP_VOLTAGE;

        this._setNext('pickup', next);
    }
}