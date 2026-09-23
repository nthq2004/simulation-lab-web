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
        // 线圈额定电压（可由 ContactorCoil 按 config 覆盖），默认 220V
        this._ratedVoltage = config.ratedCoilVoltage || 220;
    }

    setRatedVoltage(v) {
        if (v !== undefined && isFinite(v) && v > 0) this._ratedVoltage = v;
    }

    getRatedVoltage() {
        return this._ratedVoltage;
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
        // 额定电压优先取自同 deviceid 的线圈组件（支持 DC24V 等不同等级）
        const coil = this._findCoil();
        if (coil && coil._ratedCoilVoltage) this._ratedVoltage = coil._ratedCoilVoltage;

        const ratedVoltage = this._ratedVoltage || 220;
        const PICKUP_VOLTAGE  = ratedVoltage * 0.85;
        const RELEASE_VOLTAGE = ratedVoltage * 0.7;

        const next = this.state.pickup
            ? this.state.voltage > RELEASE_VOLTAGE
            : this.state.voltage > PICKUP_VOLTAGE;

        this._setNext('pickup', next);
    }

    /** 在系统中查找与本设备同 deviceid 的线圈组件（缓存） */
    _findCoil() {
        if (this._coilRef) return this._coilRef;
        const sys = this.sys;
        if (!sys || !sys.comps) return null;
        for (const c of Object.values(sys.comps)) {
            if (c && c.special === 'contactcoil' && c.config && c.config.deviceid === this.id) {
                this._coilRef = c;
                return c;
            }
        }
        return null;
    }
}