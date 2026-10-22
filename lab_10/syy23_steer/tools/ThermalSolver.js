/**
 * ThermalSolver - 热力求解器（基础版）
 * 热节点网络，支持换热器建模
 * 与 PneumaticSolver 耦合（流量影响换热量）
 */
export class ThermalSolver {
    constructor(sys) {
        this.sys = sys;
        this._nodes = new Map();     // nodeId → { temp, capacity }
        this._exchangers = [];       // 换热器列表
    }

    /**
     * 注册热节点
     */
    addNode(id, initialTemp = 25, heatCapacity = 1000) {
        this._nodes.set(id, { temp: initialTemp, capacity: heatCapacity });
    }

    /**
     * 注册换热器
     * @param {Object} config
     * @param {string} config.id
     * @param {string} config.hotSide  热侧节点
     * @param {string} config.coldSide 冷侧节点
     * @param {number} config.area     换热面积
     * @param {number} config.kValue   传热系数
     */
    addExchanger(config) {
        this._exchangers.push({ ...config });
    }

    /**
     * 注册发动机热节点网络
     * @param {Object} config
     * @param {string} config.id
     * @param {Object} [config.coolant]  冷却水初始温度/热容
     * @param {Object} [config.exhaust]  排烟初始温度/热容
     * @param {Object} [config.lubeOil]  滑油初始温度/热容
     */
    addEngine(config) {
        const engine = {
            id: config.id,
            nodes: {},
            _prevFuelRate: 0,
        };

        // 冷却水
        if (config.coolant) {
            const c = config.coolant;
            this.addNode(`${config.id}_coolant`, c.temp || 25, c.capacity || 5000);
            engine.nodes.coolant = `${config.id}_coolant`;
        }

        // 排烟
        if (config.exhaust) {
            const e = config.exhaust;
            this.addNode(`${config.id}_exhaust`, e.temp || 30, e.capacity || 1000);
            engine.nodes.exhaust = `${config.id}_exhaust`;
        }

        // 滑油
        if (config.lubeOil) {
            const l = config.lubeOil;
            this.addNode(`${config.id}_lubeOil`, l.temp || 25, l.capacity || 3000);
            engine.nodes.lubeOil = `${config.id}_lubeOil`;
        }

        if (!this._engines) this._engines = [];
        this._engines.push(engine);
    }

    /**
     * 主求解方法 — 每帧在 _updatePhysics 中调用
     */
    solve(dt) {
        // 冷却水系统热力模型：
        // 淡水从设备吸收热量 → 流经换热器 → 传递给海水 → 排出
        // 简化：仅根据当前状态计算温度变化趋势

        const eqPool = this.sys.equipmentPool;
        if (!eqPool) return;

        const hx = eqPool.get('hx-01');
        if (!hx || !hx.state) return;

        const fwIn = hx.sensors.fwInTemp?.value || 25;
        const swIn = hx.sensors.swInTemp?.value || 20;
        const duty = hx.state.duty || 0.5;

        // 简化换热模型：Δt = (fwIn - swIn) * duty * 0.1
        const fwOut = fwIn - (fwIn - swIn) * duty * 0.3;
        const swOut = swIn + (fwIn - swIn) * duty * 0.3;

        hx.sensors.fwOutTemp && (hx.sensors.fwOutTemp.value = Math.round(fwOut * 10) / 10);
        hx.sensors.swOutTemp && (hx.sensors.swOutTemp.value = Math.round(swOut * 10) / 10);

        // ── 发动机热模型 ──
        if (this._engines && this._engines.length > 0) {
            this._engines.forEach(eng => {
                const eqDevice = eqPool.get(eng.id);
                if (!eqDevice) return;

                const running = eqDevice.state.running || false;
                const fuelRate = eqDevice.state.fuelRate || 0;
                if (!running || fuelRate <= 0) return;

                // 基于喷油量和转速计算发热量
                const rpm = eqDevice.state.speed || 0;
                const heatPower = fuelRate * (rpm / 100 + 0.5) * 100;

                // 热量分配：冷却水 30%, 排烟 40%, 滑油 15%
                const coolantNode = this._nodes.get(eng.nodes.coolant);
                const exhaustNode = this._nodes.get(eng.nodes.exhaust);
                const oilNode = this._nodes.get(eng.nodes.lubeOil);

                if (coolantNode) {
                    const dT = heatPower * 0.30 * dt / coolantNode.capacity;
                    coolantNode.temp += dT;
                }
                if (exhaustNode) {
                    const dT = heatPower * 0.40 * dt / exhaustNode.capacity;
                    exhaustNode.temp += dT;
                }
                if (oilNode) {
                    const dT = heatPower * 0.15 * dt / oilNode.capacity;
                    oilNode.temp += dT;
                }

                // 更新设备池传感器值
                if (eqDevice.sensors.coolantTemp) {
                    eqDevice.sensors.coolantTemp.value = Math.round(coolantNode?.temp || 25);
                }
                if (eqDevice.sensors.exhaustTemp) {
                    eqDevice.sensors.exhaustTemp.value = Math.round(exhaustNode?.temp || 30);
                }

                eng._prevFuelRate = fuelRate;
            });
        }
    }

    /** 查询热节点温度 */
    getNodeTemp(nodeId) {
        return this._nodes.get(nodeId)?.temp || null;
    }

    /** 重置所有节点温度 */
    reset() {
        this._nodes.forEach((node, id) => { node.temp = 25; });
    }
}
