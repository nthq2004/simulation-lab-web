/**
 * DigitalSolver.js — 数字逻辑求解器
 *
 * 负责对数字逻辑电路（组合逻辑 + 时序逻辑）执行事件驱动仿真。
 * 每个仿真步按拓扑序计算组合逻辑输出，检测时钟边沿更新时序逻辑，
 * 并与模拟电路通过 SignalBridge 交换数据。
 *
 * 求解策略：
 *   1. 拓扑排序 — 对数字组件按输入→输出依赖排序
 *   2. 事件传播 — 从输入变化开始，逐级传播直到稳定
 *   3. 时序更新 — 在组合逻辑稳定后，检测时钟边沿更新触发器
 *
 * 组件类型注册：
 *   - 组合逻辑：输出仅取决于当前输入（AND, OR, NOT, NAND, NOR, XOR）
 *   - 时序逻辑：输出还取决于内部状态（DFF, JKFF, Counter）
 *   - 接口组件：ADC/DAC（通过 SignalBridge 与模拟域交互）
 *   - MCU：微型控制器（通过 MicrocontrollerSolver 解释执行固件）
 */

import { signalBridge } from './SignalBridge.js';

// ── 组合逻辑组件类型列表 ──
const COMBINATIONAL_TYPES = new Set([
    'd_and', 'd_or', 'd_not', 'd_nand', 'd_nor', 'd_xor',
]);

// ── 时序逻辑组件类型列表 ──
const SEQUENTIAL_TYPES = new Set([
    'd_dff', 'd_jkff', 'd_counter', 'd_clockgen',
]);

// ── 接口组件类型列表 ──
const INTERFACE_TYPES = new Set([
    'd_adc', 'd_dac',
]);

// ── 混合信号组件类型列表 ──
// 这些组件既有模拟引脚（通过 MNA 求解电压）也有数字行为（通过 DigitalSolver 更新状态）
const HYBRID_TYPES = new Set([
    'd_555',
]);

export class DigitalSolver {
    constructor(sys) {
        this.sys = sys;

        // ── 组件缓存 ──
        this._combinationalDevs = [];
        this._sequentialDevs = [];
        this._interfaceDevs = [];
        this._hybridDevs = [];

        // ── 拓扑排序 (按依赖关系排列的组件id列表) ──
        this._topoOrder = [];

        // ── 上一帧的信号值（用于检测边沿） ──
        this._prevValues = new Map(); // portId -> 0|1

        // ── 时钟上一次的值（用于边沿检测） ──
        this._prevClockValues = new Map(); // clockId -> 0|1

        // ── 拓扑签名（用于缓存失效检测） ──
        this._topoSig = null;

        // ── 最大迭代次数（防止组合逻辑振荡） ──
        this.maxIterations = 100;
    }

    /**
     * 主入口：每个仿真步调用一次
     * @param {number} deltaTime — 仿真步长 (秒)
     */
    update(deltaTime) {
        // 1. 发现系统中的数字组件
        this._discoverDevices();

        // 2. 更新信号桥时间
        signalBridge.step(deltaTime);

        // 3. 从模拟域读取输入（ADC）
        this._readAnalogInputs();

        // 4. 组合逻辑迭代求解
        this._solveCombinational();

        // 5. 混合信号组件更新（555 定时器等）
        this._updateHybrid();

        // 6. 时序逻辑更新（时钟边沿触发）
        this._updateSequential();

        // 7. 将数字输出写回模拟域（DAC）
        this._writeAnalogOutputs();

        // 7. 保存当前值作为下一帧的"上一帧"值
        this._savePrevValues();
    }

    // ══════════════════════════════════════════════
    //  设备发现与分类
    // ══════════════════════════════════════════════

    _discoverDevices() {
        // 计算签名，只在拓扑变化时重新分类
        const sig = this._computeTopologySig();
        if (sig === this._topoSig) return;
        this._topoSig = sig;

        const raw = Object.values(this.sys.comps);
        this._combinationalDevs = raw.filter(d => COMBINATIONAL_TYPES.has(d.type));
        this._sequentialDevs = raw.filter(d => SEQUENTIAL_TYPES.has(d.type));
        this._interfaceDevs = raw.filter(d => INTERFACE_TYPES.has(d.type));
        this._hybridDevs = raw.filter(d => HYBRID_TYPES.has(d.type));

        // 拓扑排序
        this._topoOrder = this._topologicalSort();
    }

    _computeTopologySig() {
        const raw = Object.values(this.sys.comps);
        const parts = raw
            .filter(d => COMBINATIONAL_TYPES.has(d.type) || SEQUENTIAL_TYPES.has(d.type) || INTERFACE_TYPES.has(d.type) || HYBRID_TYPES.has(d.type))
            .map(d => `${d.id}:${d.type}`)
            .sort();
        return parts.join('|');
    }

    // ══════════════════════════════════════════════
    //  拓扑排序（基于 wire 连接关系）
    // ══════════════════════════════════════════════

    _topologicalSort() {
        // 只对组合逻辑进行拓扑排序；时序逻辑和接口按固定顺序执行
        const combIds = new Set(this._combinationalDevs.map(d => d.id));

        if (combIds.size === 0) return [];

        // 构建有向图：谁驱动谁？
        // 数字信号线连接在 SignalBridge 中
        // 对于 wire 类型连接，可通过 sys.conns 追踪

        // 方法：对每个组合组件，找其输出信号线，再找哪些组件的输入连接了该信号线
        // 这需要对数字组件的端口约定有了解

        // 简化实现：按组件类型给一个固定顺序
        // 真实项目中应该在组件初始化时注册端口-信号线映射
        // 这里我们按照拓扑深度排序：输入→逻辑门→输出

        const order = [];
        // 优先处理接口（ADC 输入）
        // 然后处理组合逻辑
        // 最后处理输出接口（DAC）

        // 实际项目中可使用 Kahn 算法实现完整拓扑排序
        // 这里使用一个基于依赖的简化的方案：
        const inDegree = new Map();
        const adjList = new Map();

        this._combinationalDevs.forEach(d => {
            inDegree.set(d.id, 0);
            adjList.set(d.id, []);
        });

        // 通过 SignalBridge 的信号线建立依赖
        // 如果组件 A 的输出连接到信号线 L，组件 B 的输入也连接到 L，
        // 则 A 必须在 B 之前计算
        this._combinationalDevs.forEach(d => {
            const outputs = d.getDigitalOutputs?.() || [];
            const inputs = d.getDigitalInputs?.() || [];

            outputs.forEach(outPort => {
                this._combinationalDevs.forEach(other => {
                    if (other.id === d.id) return;
                    const otherInputs = other.getDigitalInputs?.() || [];
                    // 如果 other 的某个输入和 d 的某个输出连在同一条信号线上
                    // 则 d -> other 有一条依赖边
                    // 简化：如果找不到具体的连接关系，按注册顺序
                });
            });
        });

        // Kahn 算法（带简化的 fallback）
        const queue = [];
        this._combinationalDevs.forEach(d => {
            if (inDegree.get(d.id) === 0) queue.push(d.id);
        });

        while (queue.length > 0) {
            const id = queue.shift();
            order.push(id);
            (adjList.get(id) || []).forEach(neighbor => {
                const deg = (inDegree.get(neighbor) || 1) - 1;
                inDegree.set(neighbor, deg);
                if (deg === 0) queue.push(neighbor);
            });
        }

        // 如果拓扑排序不完整（有环），将未排序的追加到末尾
        this._combinationalDevs.forEach(d => {
            if (!order.includes(d.id)) order.push(d.id);
        });

        return order;
    }

    // ══════════════════════════════════════════════
    //  模拟输入读取（ADC）
    // ══════════════════════════════════════════════

    _readAnalogInputs() {
        this._interfaceDevs.forEach(dev => {
            if (dev.type === 'd_adc') {
                const adcPortId = `${dev.id}_digital_out`;
                signalBridge.createSignalLine(adcPortId);
                signalBridge.writeSignal(adcPortId, this._readADC(dev));
            }
        });
    }

    /**
     * 从 ADC 组件获取当前数字值
     * adcVal = signalBridge.getADCDigital(adcChannelPort)
     * 然后映射为 0/1 或数字总线（此处简化为 0/1 信号线）
     */
    _readADC(dev) {
        // 找到 ADC 的模拟输入端口名
        const analogPort = dev.getAnalogInputPort?.() || `${dev.id}_wire_in`;
        return signalBridge.getADCDigital(analogPort);
    }

    // ══════════════════════════════════════════════
    //  组合逻辑求解（迭代直到稳定）
    // ══════════════════════════════════════════════

    _solveCombinational() {
        for (let iter = 0; iter < this.maxIterations; iter++) {
            let anyChanged = false;

            this._topoOrder.forEach(compId => {
                const dev = this.sys.comps[compId];
                if (!dev || !COMBINATIONAL_TYPES.has(dev.type)) return;

                const inputs = this._readDigitalInputs(dev);
                const oldOutput = this._readDigitalOutput(dev);
                const newOutput = this._computeGate(dev, inputs);

                if (newOutput !== oldOutput) {
                    this._writeDigitalOutput(dev, newOutput);
                    anyChanged = true;
                }
            });

            if (!anyChanged) break;
        }
    }

    /**
     * 读取组件所有数字输入引脚的当前值
     * @returns {number[]} — 输入引脚值数组
     */
    _readDigitalInputs(dev) {
        const inputPorts = dev.getDigitalInputs?.() || [];
        return inputPorts.map(portId => signalBridge.readSignal(portId));
    }

    /**
     * 读取组件输出信号线的当前值
     * @returns {0|1}
     */
    _readDigitalOutput(dev) {
        const outPort = dev.getDigitalOutput?.() || `${dev.id}_out`;
        return signalBridge.readSignal(outPort);
    }

    /**
     * 将计算结果写入组件输出信号线
     */
    _writeDigitalOutput(dev, value) {
        const outPort = dev.getDigitalOutput?.() || `${dev.id}_out`;
        signalBridge.writeSignal(outPort, value, 'strong');
        // 同步回组件实例，供 UI 显示
        dev.digitalOut = value;
    }

    /**
     * 计算逻辑门输出
     * @param {Object} dev — 组件实例
     * @param {number[]} inputs — 输入值数组 [a, b, ...]
     * @returns {0|1}
     */
    _computeGate(dev, inputs) {
        const a = inputs[0] || 0;
        const b = inputs[1] ?? a; // 单输入门（NOT）使用 a 作为 b

        switch (dev.type) {
            case 'd_and':  return (a && b) ? 1 : 0;
            case 'd_or':   return (a || b) ? 1 : 0;
            case 'd_not':  return a ? 0 : 1;
            case 'd_nand': return (a && b) ? 0 : 1;
            case 'd_nor':  return (a || b) ? 0 : 1;
            case 'd_xor':  return (a !== b) ? 1 : 0;
            default:       return 0;
        }
    }

    // ══════════════════════════════════════════════
    //  时序逻辑更新（时钟边沿触发）
    // ══════════════════════════════════════════════

    _updateSequential() {
        this._sequentialDevs.forEach(dev => {
            switch (dev.type) {
                case 'd_dff':
                    this._updateDFF(dev);
                    break;
                case 'd_jkff':
                    this._updateJKFF(dev);
                    break;
                case 'd_counter':
                    this._updateCounter(dev);
                    break;
                case 'd_clockgen':
                    this._updateClockGen(dev);
                    break;
            }
        });
    }

    /**
     * D 触发器更新
     * 输入: D (data), CLK (clock)
     * 输出: Q, QN (互补)
     * 行为: 时钟上升沿时 Q = D
     */
    _updateDFF(dev) {
        const clkPort = dev.getClockPort?.() || `${dev.id}_clk`;
        const dataPort = dev.getDataPort?.() || `${dev.id}_d`;
        const qPort = dev.getOutputPort?.() || `${dev.id}_q`;
        const qnPort = dev.getComplementPort?.() || `${dev.id}_qn`;

        const clk = signalBridge.readSignal(clkPort);
        const prevClk = this._prevClockValues.get(clkPort) ?? 0;

        // 检测上升沿
        if (prevClk === 0 && clk === 1) {
            const d = signalBridge.readSignal(dataPort);
            dev.q = d;
            dev.qn = d ? 0 : 1;

            signalBridge.writeSignal(qPort, dev.q, 'strong');
            signalBridge.writeSignal(qnPort, dev.qn, 'strong');
        }

        this._prevClockValues.set(clkPort, clk);
    }

    /**
     * JK 触发器更新
     * 输入: J, K, CLK
     * 输出: Q, QN
     * J=0,K=0 → 保持;  J=0,K=1 → 复位;  J=1,K=0 → 置位;  J=1,K=1 → 翻转
     */
    _updateJKFF(dev) {
        const clkPort = dev.getClockPort?.() || `${dev.id}_clk`;
        const jPort = `${dev.id}_j`;
        const kPort = `${dev.id}_k`;
        const qPort = dev.getOutputPort?.() || `${dev.id}_q`;
        const qnPort = dev.getComplementPort?.() || `${dev.id}_qn`;

        const clk = signalBridge.readSignal(clkPort);
        const prevClk = this._prevClockValues.get(clkPort) ?? 0;

        if (prevClk === 0 && clk === 1) {
            const j = signalBridge.readSignal(jPort);
            const k = signalBridge.readSignal(kPort);

            if (j === 0 && k === 0) { /* 保持 */ }
            else if (j === 0 && k === 1) { dev.q = 0; dev.qn = 1; }
            else if (j === 1 && k === 0) { dev.q = 1; dev.qn = 0; }
            else if (j === 1 && k === 1) {
                const tmp = dev.q;
                dev.q = dev.qn;
                dev.qn = tmp;
            }

            signalBridge.writeSignal(qPort, dev.q, 'strong');
            signalBridge.writeSignal(qnPort, dev.qn, 'strong');
        }

        this._prevClockValues.set(clkPort, clk);
    }

    /**
     * 计数器（4位二进制，可预设初值）
     */
    _updateCounter(dev) {
        const clkPort = dev.getClockPort?.() || `${dev.id}_clk`;
        const rstPort = `${dev.id}_rst`;
        const clk = signalBridge.readSignal(clkPort);
        const prevClk = this._prevClockValues.get(clkPort) ?? 0;

        // 复位检测（高电平有效）
        const rst = signalBridge.readSignal(rstPort);
        if (rst) {
            dev.count = 0;
            this._writeCountOutputs(dev);
            this._prevClockValues.set(clkPort, clk);
            return;
        }

        // 时钟上升沿计数
        if (prevClk === 0 && clk === 1) {
            dev.count = ((dev.count ?? 0) + 1) & 0x0F; // 4 位计数器
            this._writeCountOutputs(dev);
        }

        this._prevClockValues.set(clkPort, clk);
    }

    _writeCountOutputs(dev) {
        const count = dev.count ?? 0;
        for (let i = 0; i < 4; i++) {
            const bit = (count >> i) & 1;
            const portId = `${dev.id}_q${i}`;
            signalBridge.writeSignal(portId, bit, 'strong');
        }
        dev.digitalOut = count;
    }

    /**
     * 时钟发生器（由 SignalBridge 的时钟驱动）
     */
    _updateClockGen(dev) {
        const clockId = dev.clockId || dev.id;
        const outPort = dev.getOutputPort?.() || `${dev.id}_out`;
        const value = signalBridge.getClockValue(clockId);
        signalBridge.writeSignal(outPort, value, 'strong');
        dev.digitalOut = value;
    }

    // ══════════════════════════════════════════════
    //  模拟输出写入（DAC）
    // ══════════════════════════════════════════════

    _writeAnalogOutputs() {
        this._interfaceDevs.forEach(dev => {
            if (dev.type === 'd_dac') {
                const digitalPort = dev.getDigitalInputPort?.() || `${dev.id}_digital_in`;
                const digitalVal = signalBridge.readSignal(digitalPort);
                // 简化为将 0/1 映射到 DAC 输出
                // 更复杂的实现应由 MCU 或用 Multi-bit 总线驱动
                const outVal = digitalVal ? dev.maxOutput : 0;
                signalBridge.setDACDigital(`${dev.id}_analog_out`, outVal);
            }
        });
    }

    // ══════════════════════════════════════════════
    //  状态保持
    // ══════════════════════════════════════════════

    _savePrevValues() {
        // 保存时钟值已经在各触发器中做了
        // 这里不做额外操作
    }

    // ══════════════════════════════════════════════
    //  查询接口
    // ══════════════════════════════════════════════

    /**
     * 获取所有数字信号线的当前状态
     */
    getSignalStates() {
        return signalBridge.getAllSignalStates();
    }

    // ══════════════════════════════════════════════
    //  混合信号组件更新（555 定时器）
    // ══════════════════════════════════════════════

    _updateHybrid() {
        this._hybridDevs.forEach(dev => {
            if (dev.type === 'd_555') this._update555(dev);
        });
    }

    /**
     * 555 定时器内部行为仿真（混合信号核心逻辑）
     *
     * 工作流程：
     *   1. 从 MNA 求解结果读取 TH/TR/CTRL/VCC 端口的模拟电压
     *   2. 比较器判定：TH > 2/3 VCC 复位，TR < 1/3 VCC 置位
     *   3. 更新 RS 触发器状态
     *   4. 更新 OUT 和 DIS 输出
     *
     * 访问 MNA 电压的机制：
     *   通过 CircuitSolver.nodeVoltages 和 portToCluster 获取。
     *   在 consys.js 的 _updatePhysics 中，先调 CircuitSolver，再调 DigitalSolver，
     *   所以 DigitalSolver 运行时最新的节点电压已经就绪。
     */
    _update555(dev) {
        // ── 1. 读取各引脚模拟电压 ──
        const vTH = this._getAnalogVoltage(dev, 'th');
        const vTR = this._getAnalogVoltage(dev, 'tr');
        const vCTRL = this._getAnalogVoltage(dev, 'ctrl');
        const vVCC = this._getAnalogVoltage(dev, 'vcc');

        // ── 2. 计算比较器阈值 ──
        // CTRL 引脚可调制阈值
        const refHigh = (vCTRL > 0.1) ? vCTRL : vVCC * 2 / 3;
        const refLow = (vCTRL > 0.1) ? vCTRL * 0.45 : vVCC * 1 / 3;

        // ── 3. 读取 RST 复位引脚（低电平有效） ──
        const rstLine = `${dev.id}_rst`;
        const rst = signalBridge.readSignal(rstLine);

        // ── 4. 检查 RST 下降沿（复位） ──
        const prevRST = dev._prevRST ?? 1;
        if (prevRST === 1 && rst === 0) {
            dev._q = 0;
            dev._disChargeOn = true;
            dev._outHigh = false;
        } else if (rst === 1) {
            // ── 5. 比较器判断（仅在 RST=1 时有效） ──
            const threshTrig = (vTH > refHigh);
            const triggerTrig = (vTR < refLow);

            if (triggerTrig) {
                dev._q = 1;
                dev._disChargeOn = false;
                dev._outHigh = true;
            } else if (threshTrig) {
                dev._q = 0;
                dev._disChargeOn = true;
                dev._outHigh = false;
            }
        }

        // ── 6. 保存状态 ──
        dev._prevRST = rst;
        dev._lastTH = vTH;
        dev._lastTR = vTR;

        // ── 7. 写回数字信号线（OUT）供下游数字门使用 ──
        const outLine = `${dev.id}_out`;
        const outVal = dev._outHigh ? 1 : 0;
        if (outVal !== dev._prevOut) {
            signalBridge.writeSignal(outLine, outVal, 'strong');
            dev._prevOut = outVal;
        }
        dev.digitalOut = outVal;
    }

    /**
     * 通过 MNA 求解结果读取指定引脚的模拟电压
     */
    _getAnalogVoltage(dev, pinName) {
        const portId = `${dev.id}_wire_${pinName}`;
        const solver = this.sys.voltageSolver;
        if (!solver) return 0;
        const clusterIdx = solver.portToCluster.get(portId);
        if (clusterIdx === undefined) return 0;
        return solver.nodeVoltages.get(clusterIdx) || 0;
    }

    /**
     * 获取数字域诊断信息
     */
    getDiagnostics() {
        return {
            combinationalCount: this._combinationalDevs.length,
            sequentialCount: this._sequentialDevs.length,
            interfaceCount: this._interfaceDevs.length,
            hybridCount: this._hybridDevs.length,
            signalCount: signalBridge.getAllSignalStates().length,
            topoOrderLength: this._topoOrder.length,
        };
    }
}
