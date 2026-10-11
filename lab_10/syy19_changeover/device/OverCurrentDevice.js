import { BaseDevice } from './BaseDevice.js';

/**
 * OverCurrentDevice — 过流继电器复合设备（GLJ）
 *
 * 由测量电流的绕组（OverCurrentCoil）驱动：
 *   绕组采集流过自身的电流 → setCurrent(I) → preUpdate() 滞回判定 → picked
 *
 * 输出触头（OverCurrentNOContact）读取 getContactClosed()：
 *   动作（I > pickupCurrent）→ 常开触头闭合；返回（I < releaseCurrent）→ 断开
 *
 * 与接触器复合设备（ContactorDevice）同构：绕组与触头共享同一 deviceid。
 */
export class OverCurrentDevice extends BaseDevice {
    constructor(config) {
        super(config);
        this.state = { picked: false, current: 0 };
        this.pickupCurrent  = config.pickupCurrent  !== undefined ? config.pickupCurrent  : 1.2;
        this.releaseCurrent = config.releaseCurrent !== undefined ? config.releaseCurrent : 0.9;
        // 动作延时（s）：电流持续超过动作值达此时长后才动作（固定 5s）
        this.delayTime      = config.delayTime !== undefined ? config.delayTime : 5;
        this._manualOverride = false;
        this._overElapsed = 0;
    }

    setDelayTime(v) { if (v >= 0) this.delayTime = v; }
    getDelayTime()  { return this.delayTime; }

    setCurrent(i) { this.state.current = Math.abs(i) || 0; }
    getCurrent()  { return this.state.current || 0; }

    setPickupCurrent(v)  { if (v !== undefined && isFinite(v)) this.pickupCurrent = parseFloat(v); }
    setReleaseCurrent(v) { if (v !== undefined && isFinite(v)) this.releaseCurrent = parseFloat(v); }

    isPickup() { return this.state.picked; }

    setManualOverride(v) { this._manualOverride = !!v; }
    getManualOverride()  { return this._manualOverride; }

    getContactClosed() { return this.state.picked || this._manualOverride; }

    preUpdate(dt) {
        const i = this.getCurrent();
        const step = dt || (1 / 20);

        if (!this.state.picked) {
            // 电流持续超过动作值 → 计时；达到延时时间才动作
            if (i > this.pickupCurrent) {
                this._overElapsed += step;
                if (this._overElapsed >= this.delayTime) {
                    this._setNext('picked', true);
                    this._overElapsed = 0;
                }
            } else {
                this._overElapsed = 0;
            }
        } else {
            // 已动作：电流返回后立即释放
            if (i < this.releaseCurrent) {
                this._setNext('picked', false);
                this._overElapsed = 0;
            }
        }
    }

    /** 已过流计时（s），供显示用 */
    getOverElapsed() { return this._overElapsed || 0; }
}
