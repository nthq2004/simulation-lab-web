export class BaseDevice {
    constructor(config) {
        this.id = config.id;
        this.sys = config.sys || null;
        this.state = {};
        this._nextState = {};
    }

    preUpdate(dt) {}

    commit() {
        Object.assign(this.state, this._nextState);
    }

    _setNext(key, value) {
        this._nextState[key] = value;
    }

    destroy() {}
}