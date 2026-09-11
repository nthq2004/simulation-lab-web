/**
 * SignalBridge.js — 模拟-数字信号桥接
 *
 * 职责：
 *   1. 在模拟求解器（CircuitSolver）和数字求解器（DigitalSolver）之间交换信号
 *   2. ADC 组件将模拟电压写入，DigitalSolver 读取数字值
 *   3. DAC 组件由 DigitalSolver 写入数字值，输出到模拟电路
 *   4. 每个仿真步由 ControlSystem 触发同步
 */

export class SignalBridge {
    constructor() {
        // ── 模拟 → 数字 通道 ──
        // Map<adcPortId, { voltage: number, digitalValue: number, bits: number, vRef: number }>
        this._adcInputs = new Map();

        // ── 数字 → 模拟 通道 ──
        // Map<dacPortId, { digitalValue: number, voltage: number, bits: number, vRef: number }>
        this._dacOutputs = new Map();

        // ── 数字信号线（组件之间的离散 0/1/Z/X 连接） ──
        // Map<signalLineId, { value: 0|1|'Z'|'X', strength: 'strong'|'weak'|'highZ' }>
        this._digitalSignals = new Map();

        // ── 数字信号线连接拓扑 ──
        // Map<signalLineId, Set<componentPortId>>
        this._signalConnections = new Map();

        // ── 时钟信号 ──
        // Map<clockId, { frequency: number, phase: number, duty: number, value: 0|1 }>
        this._clocks = new Map();

        this._time = 0;
    }

    /**
     * 每个仿真步开始时调用，更新时钟信号和 ADC/DAC 转换
     * @param {number} deltaTime — 仿真步长时间 (秒)
     */
    step(deltaTime) {
        this._time += deltaTime;

        // 1. 更新时钟信号
        this._clocks.forEach((clock, id) => {
            const period = 1 / clock.frequency;
            const tInPeriod = this._time % period;
            clock.value = (tInPeriod < period * clock.duty) ? 1 : 0;
        });

        // 2. ADC 转换：将电压转换为数字值
        this._adcInputs.forEach((ch, portId) => {
            const v = ch.voltage || 0;
            const maxVal = (1 << ch.bits) - 1;
            const normalized = Math.max(0, Math.min(v / ch.vRef, 1));
            ch.digitalValue = Math.round(normalized * maxVal);
        });

        // 3. DAC 转换：将数字值转换为电压
        this._dacOutputs.forEach((ch, portId) => {
            const maxVal = (1 << ch.bits) - 1;
            ch.voltage = (ch.digitalValue / maxVal) * ch.vRef;
        });
    }

    // ══════════════════════════════════════════════
    //  ADC 通道管理
    // ══════════════════════════════════════════════

    /**
     * 注册一个 ADC 通道
     * @param {string} portId — ADC 端口标识 (如 'adc1_wire_in')
     * @param {number} bits — ADC 分辨率 (默认 10)
     * @param {number} vRef — 参考电压 (默认 5.0)
     */
    registerADC(portId, bits = 10, vRef = 5.0) {
        this._adcInputs.set(portId, {
            voltage: 0,
            digitalValue: 0,
            bits,
            vRef,
        });
    }

    /**
     * 更新 ADC 输入电压（由 CircuitSolver 在模拟求解后调用）
     */
    setADCVoltage(portId, voltage) {
        const ch = this._adcInputs.get(portId);
        if (ch) ch.voltage = voltage;
    }

    /**
     * 读取 ADC 转换后的数字值（由 DigitalSolver 调用）
     * @returns {number}
     */
    getADCDigital(portId) {
        return this._adcInputs.get(portId)?.digitalValue ?? 0;
    }

    // ══════════════════════════════════════════════
    //  DAC 通道管理
    // ══════════════════════════════════════════════

    /**
     * 注册一个 DAC 通道
     */
    registerDAC(portId, bits = 10, vRef = 5.0) {
        this._dacOutputs.set(portId, {
            digitalValue: 0,
            voltage: 0,
            bits,
            vRef,
        });
    }

    /**
     * 设置 DAC 数字值（由 DigitalSolver 调用）
     */
    setDACDigital(portId, value) {
        const ch = this._dacOutputs.get(portId);
        if (ch) {
            ch.digitalValue = Math.max(0, Math.min((1 << ch.bits) - 1, Math.round(value)));
        }
    }

    /**
     * 读取 DAC 输出电压（由 CircuitSolver 的 DeviceStamps 调用）
     * @returns {number}
     */
    getDACVoltage(portId) {
        return this._dacOutputs.get(portId)?.voltage ?? 0;
    }

    // ══════════════════════════════════════════════
    //  数字信号线管理（用于逻辑门之间的连接）
    // ══════════════════════════════════════════════

    /**
     * 创建一条数字信号线
     * @param {string} lineId
     */
    createSignalLine(lineId) {
        if (!this._digitalSignals.has(lineId)) {
            this._digitalSignals.set(lineId, { value: 0, strength: 'strong' });
            this._signalConnections.set(lineId, new Set());
        }
    }

    /**
     * 将组件端口连接到信号线
     * @param {string} lineId
     * @param {string} componentPortId — 如 'and1_out'
     */
    connectToLine(lineId, componentPortId) {
        this.createSignalLine(lineId);
        this._signalConnections.get(lineId).add(componentPortId);
    }

    /**
     * 写入数字信号（驱动信号线）
     * @param {string} lineId
     * @param {0|1} value
     * @param {'strong'|'weak'} [strength='strong']
     */
    writeSignal(lineId, value, strength = 'strong') {
        const sig = this._digitalSignals.get(lineId);
        if (!sig) return;
        // 简单冲突解决：strong 覆盖 weak
        if (strength === 'strong' || sig.strength !== 'strong') {
            sig.value = value;
            sig.strength = strength;
        }
    }

    /**
     * 读取信号线的值
     * @returns {0|1|'Z'}
     */
    readSignal(lineId) {
        return this._digitalSignals.get(lineId)?.value ?? 0;
    }

    /**
     * 获取所有连接到某信号线的端口
     * @returns {Set<string>}
     */
    getLineConnections(lineId) {
        return this._signalConnections.get(lineId) ?? new Set();
    }

    /**
     * 获取所有信号线及其当前值
     * @returns {Array<{lineId: string, value: 0|1}>}
     */
    getAllSignalStates() {
        const states = [];
        this._digitalSignals.forEach((sig, lineId) => {
            states.push({ lineId, value: sig.value });
        });
        return states;
    }

    // ══════════════════════════════════════════════
    //  时钟管理
    // ══════════════════════════════════════════════

    /**
     * 注册时钟信号
     */
    registerClock(clockId, frequency = 1000, duty = 0.5) {
        this._clocks.set(clockId, {
            frequency,
            phase: 0,
            duty,
            value: 0,
        });
    }

    /**
     * 获取时钟当前值
     * @returns {0|1}
     */
    getClockValue(clockId) {
        return this._clocks.get(clockId)?.value ?? 0;
    }

    /**
     * 检测时钟上升沿
     */
    isRisingEdge(clockId, prevValue) {
        const curr = this.getClockValue(clockId);
        return prevValue === 0 && curr === 1;
    }

    /**
     * 检测时钟下降沿
     */
    isFallingEdge(clockId, prevValue) {
        const curr = this.getClockValue(clockId);
        return prevValue === 1 && curr === 0;
    }

    // ══════════════════════════════════════════════
    //  重置
    // ══════════════════════════════════════════════

    reset() {
        this._adcInputs.clear();
        this._dacOutputs.clear();
        this._digitalSignals.clear();
        this._signalConnections.clear();
        this._clocks.clear();
        this._time = 0;
    }
}

// 全局单例
export const signalBridge = new SignalBridge();
