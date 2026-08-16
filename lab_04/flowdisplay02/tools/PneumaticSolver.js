/**
 * 气路物理求解器
 * 负责根据拓扑连接和设备状态，计算全场压力分布
 */

export class PneumaticSolver {
    constructor(sys) {
        this.sys = sys;
        this.terminalPressures = {};
        this.segmentFlows = {};       // 新增：每条 conn 的流量 { connKey: flowValue }
        this.topologyKey = null;
        this.cachedPressures = {};
        this.pressureEps = 1e-4;

        // 阻抗配置（可由外部覆盖）
        this.impedance = {
            pipe: 0.10,   // 管路固定10%压损系数（相对量，非绝对）
            stopValve: 0.02,   // 截止阀全开阻抗
            regulator: 0.05,   // 调压阀阻抗
            tee: 0.01,   // 三通接头（近似零）
            load: 1.00,   // 执行器/负载（主要消耗点）
            leak: 0.005,  // 泄漏旁路（极低阻抗）
        };
    }

    solve() {
        // ── 拓扑键缓存：无变化则跳过（避免全量 BFS）──
        const currentTopologyKey = this._computeTopologyKey();
        if (currentTopologyKey === this._cachedTopologyKey) return;
        this._cachedTopologyKey = currentTopologyKey;

        // ── 组件数组缓存（避免每帧多次 Object.values）──
        const allComps = this.__allComps || (this.__allComps = Object.values(this.sys.comps));

        // ── 压力场（原有逻辑保持不变）──
        const terminalPressures = {};
        const queue = [];
        const visitedPorts = new Set();

        allComps.forEach(device => {
            if (device.ports) {
                device.ports.forEach(port => {
                    if (port.type === 'pipe') terminalPressures[port.id] = 0;
                });
            }
        });

        allComps.forEach(device => {
            if (device.type === 'airBottle') {
                const outPortId = `${device.id}_pipe_o`;
                terminalPressures[outPortId] = device.pressure || 0;
                queue.push(outPortId);
            }
            if (device.type === 'Pump' && device.pumpOn) {
                const outPortId = `${device.id}_pipe_o`;
                terminalPressures[outPortId] = 0.4;  // 0.4 MPa 基准压力
                queue.push(outPortId);
            }
            if (device.special === 'actuator') {
                const outPortId = `${device.id}_pipe_o`;
                terminalPressures[outPortId] = device.outPress || 0;
                queue.push(outPortId);
            }
            if (device.special === 'bubble_level') {
                const outPortId = `${device.id}_pipe_o`;
                terminalPressures[outPortId] = device.backPress / 1000 || 0;
                queue.push(outPortId);
            }
            if (device.type === 'calibrator' && device.activePanel === 'SOURCE' && device.sourceMode === 'SRC_PRESSURE') {
                const outPortId = `${device.id}_pipe_o`;
                terminalPressures[outPortId] = device.sourceValue / 1000 || 0; // 压力校准器输出压力，单位转换为 MPa
                queue.push(outPortId);
            }
        });

        while (queue.length > 0) {
            const currentPortId = queue.shift();
            if (visitedPorts.has(currentPortId)) continue;
            visitedPorts.add(currentPortId);
            const currentP = terminalPressures[currentPortId];

            this.sys.conns.forEach(conn => {
                if (conn.type !== 'pipe') return;
                let nextPortId = null;
                if (conn.from === currentPortId) nextPortId = conn.to;
                else if (conn.to === currentPortId) nextPortId = conn.from;

                if (nextPortId) {
                    terminalPressures[nextPortId] = currentP;

                    const compId = nextPortId.split('_')[0];
                    const comp = this.sys.comps[compId];
                    if (comp) {
                        const port = comp.ports.find(p => p.id === nextPortId);
                        if (port && port.node.getAttr('isLeaking')) {
                            const lossRatio = 0.2 + Math.random() * 0.1;
                            terminalPressures[nextPortId] = Math.max(0, currentP * (1 - lossRatio));
                        }
                    }

                    const deviceId = this._getDeviceIdFromPort(nextPortId);
                    const device = this.sys.comps[deviceId];
                    if (device) {
                        this._processInternalTransfer(device, nextPortId, terminalPressures, queue);
                    }
                }
            });
        }

        this.terminalPressures = terminalPressures;

        const pressuresChanged = this._pressuresChanged(this.cachedPressures, terminalPressures);
        const topologyChanged = currentTopologyKey !== this.topologyKey;
        if (!topologyChanged && !pressuresChanged) return;

        this.topologyKey = currentTopologyKey;
        this.cachedPressures = Object.assign({}, terminalPressures);

        // ── 新增：流量场求解 ──
        this._solveFlows(terminalPressures);

        // ── 设备状态同步（原有逻辑，增加 flow 注入）──
        this._syncDevices();
    }

    /**
     * 流量场求解
     * 遍历所有 pipe 类型连线，用两端压差和等效阻抗计算流量
     */
    _solveFlows(pressures) {
        const flows = {};

        this.sys.conns.forEach((conn, idx) => {
            if (conn.type !== 'pipe') return;

            const pFrom = pressures[conn.from] || 0;
            const pTo = pressures[conn.to] || 0;
            const deltaP = pFrom - pTo;

            // 计算该管段的等效阻抗
            const R = this._getSegmentImpedance(conn, pressures);

            // Q = ΔP / R，阻抗为0时流量为0（避免除零）
            const Q = (R > 0 && deltaP > 0) ? deltaP / R : 0;

            const key = this._connKey(conn);
            flows[key] = {
                Q,
                from: conn.from,
                to: conn.to,
                deltaP,
                R,
            };
        });

        // 三通节点：汇总流量守恒校验（可选，用于调试）
        this._balanceTeeFlows(flows, pressures);

        this.segmentFlows = flows;
    }

    /**
     * 获取某条管路连线的等效阻抗
     * 阻抗 = 管路固定损耗 + 目标端设备附加阻抗
     */
    _getSegmentImpedance(conn, pressures) {
        const R = this.impedance;
        let totalR = 0;

        // 管路自身固定损耗（10% 压损系数，转换为阻抗）
        // 用起点压力归一化：R_pipe = pipeLoss * P_source
        const pSource = pressures[conn.from] || 0;
        totalR += R.pipe * pSource;  // 等效为绝对阻抗

        // 目标端设备类型附加阻抗
        const toDeviceId = this._getDeviceIdFromPort(conn.to);
        const toDevice = this.sys.comps[toDeviceId];

        if (toDevice) {
            switch (toDevice.type) {
                case 'stopValve':
                    totalR += toDevice.isOpen ? R.stopValve * pSource : Infinity;
                    break;
                case 'regulator':
                    totalR += R.regulator * pSource;
                    break;
                case 'teeConnector':
                    totalR += R.tee * pSource;
                    break;
                default:
                    // special === 'actuator' 或其他终端负载
                    if (toDevice.special === 'actuator' || toDevice.special === 'press') {
                        totalR += R.load * pSource;
                    }
                    // 泄漏端口：附加极小阻抗（已在压力层处理过）
                    const port = toDevice.ports?.find(p => p.id === conn.to);
                    if (port?.node?.getAttr('isLeaking')) {
                        totalR = Math.min(totalR, R.leak * pSource);
                    }
                    break;
            }
        }

        return totalR > 0 ? totalR : 1e-6; // 防止除零
    }

    /**
     * 三通节点流量平衡：将入口流量按下游各支路压差比例分配
     * 修正 segmentFlows 中各出口的 Q 值
     */
    _balanceTeeFlows(flows, pressures) {
        const allComps = this.__allComps || Object.values(this.sys.comps);
        allComps.forEach(device => {
            if (device.type !== 'teeConnector') return;

            // 找出所有连接到该三通的管路
            const inConns = [];
            const outConns = [];

            this.sys.conns.forEach(conn => {
                if (conn.type !== 'pipe') return;
                const toId = this._getDeviceIdFromPort(conn.to);
                const fromId = this._getDeviceIdFromPort(conn.from);
                if (toId === device.id) inConns.push(conn);
                if (fromId === device.id) outConns.push(conn);
            });

            if (inConns.length === 0 || outConns.length === 0) return;

            // 总入口流量
            const Q_in = inConns.reduce((sum, c) => sum + (flows[this._connKey(c)]?.Q || 0), 0);

            // 各出口压差权重
            const teeP = pressures[`${device.id}_pipe_o`] ||
                pressures[`${device.id}_pipe_1`] ||
                device.ports?.reduce((max, p) => Math.max(max, pressures[p.id] || 0), 0) || 0;

            const weights = outConns.map(c => {
                const pDown = pressures[c.to] || 0;
                return Math.max(0, teeP - pDown);
            });

            const totalWeight = weights.reduce((a, b) => a + b, 0);

            // 按权重分配流量
            outConns.forEach((c, i) => {
                const key = this._connKey(c);
                if (flows[key] && totalWeight > 0) {
                    flows[key].Q = Q_in * (weights[i] / totalWeight);
                }
            });
        });
    }

    /**
     * 设备状态同步（原有逻辑提取为独立方法 + 注入流量）
     */
    _syncDevices() {
        const pressures = this.terminalPressures;
        const flows = this.segmentFlows;

        // 辅助：查询某个端口上的流量（取相关管路的 Q）
        const getPortFlow = (portId) => {
            for (const [, seg] of Object.entries(flows)) {
                if (seg.from === portId || seg.to === portId) return seg.Q;
            }
            return 0;
        };

        const targetTypes = ['pressSwitch', 'pressMeter', 'regulator',
            'pressure_sensor', 'pressure_transducer'];

        const allComps = this.__allComps || Object.values(this.sys.comps);
        allComps.forEach(device => {
            if (targetTypes.includes(device.type)) {
                const inPortId = `${device.id}_pipe_i`;
                const currentP = pressures[inPortId] || 0;

                if (device.update) {
                    if (device.type === 'regulator') {
                        device.inputPressure = currentP;
                        device.update();
                    } else {
                        device.update(currentP);
                    }
                }
            }

            // 流量传感器 / 变送器：注入流量值
            else if (device.type === 'flow_sensor' || device.type === 'flow_transmitter') {
                const inPortId = `${device.id}_pipe_i`;
                const Q = getPortFlow(inPortId);
                device.flow = Q;
                if (device.update) device.update(pressures[inPortId] || 0, Q);
            }

            else if (device.type === 'dp_flow_indicator' ||
                     device.type === 'rotameter' ||
                     device.type === 'impeller_flow_indicator') {
                // 直接根据泵状态和阀位计算流量（BFS 无法产生压差梯度）
                const pump = this.sys.comps['pump-01'] || this.sys.comps.pump;
                const pumpOn = pump && pump.pumpOn;
                const engine = this.sys.comps['engine-01'];
                const engOn = engine && engine.engOn;
                const isRunning = pumpOn && engOn;
                const valve = this.sys.comps.elecValve;
                const pos = valve ? (valve.currentPos || 0) : 0;

                let flowVal = 0;
                if (isRunning) {
                    const totalFlow = 1.0; // 归一化总流量
                    if (device.type === 'dp_flow_indicator') {
                        flowVal = totalFlow * pos * device.Qmax;
                    } else if (device.type === 'rotameter') {
                        flowVal = totalFlow * (1 - pos) * device.Qmax;
                    } else if (device.type === 'impeller_flow_indicator') {
                        flowVal = totalFlow * device.Qmax;
                    }
                }
                if (device.setFlow) {
                    // 只设置目标流量，由 tick() 中的平滑插值自然过渡
                    device._targetFlow = Math.max(0, Math.min(1, flowVal / device.Qmax));
                }
            }
	        });
	    }

	    /**
	     * 处理压力在设备内部从输入端到输出端的转换
	     */
	    _processInternalTransfer(device, inputPortId, terminalPressures, queue) {
	        const inP = terminalPressures[inputPortId];
	        const deviceId = device.id;

	        switch (device.type) {
	            case 'teeConnector':
	                device.ports.forEach(p => {
	                    if (p.id !== inputPortId) {
	                        terminalPressures[p.id] = inP;
	                        queue.push(p.id);
	                    }
	                });
	                break;

	            case 'stopValve':
	                const otherPort = device.ports.find(p => p.id !== inputPortId);
	                if (otherPort) {
	                    if (device.isOpen) {
	                        this.sys.comps['cab'].isConsuming = true;
	                        terminalPressures[otherPort.id] = inP;
	                    }
	                    else {
	                        this.sys.comps['cab'].isConsuming = false;
	                        terminalPressures[otherPort.id] = 0;
	                    }
	                    queue.push(otherPort.id);
	                }
	                break;

	            case 'regulator':
	                if (inputPortId.includes('_pipe_i')) {
	                    const outPortId = deviceId + '_pipe_o';
	                    const outP = Math.min(inP, device.setPressure || 0);
	                    terminalPressures[outPortId] = outP;
	                    queue.push(outPortId);
	                }
	                break;

	            case '3valve':
	                if (device.vE === false) {
	                    if (inputPortId === deviceId + '_pipe_inl') {
	                        const outPortId = deviceId + '_pipe_outl';
	                        terminalPressures[outPortId] = device.vL ? inP : 0;
	                        queue.push(outPortId);
	                    } else if (inputPortId === deviceId + '_pipe_inh') {
	                        const outPortId = deviceId + '_pipe_outh';
	                        terminalPressures[outPortId] = device.vH ? inP : 0;
	                        queue.push(outPortId);
	                    }
	                }
	                break;

	            case 'transmitter_2wire':
	                if (device.special === 'press') device.press = inP;
	                if (device.special === 'bubble_level') device.press = inP;
	                break;

	            case 'dp_flow_indicator':
	            case 'rotameter':
	            case 'impeller_flow_indicator':
	                if (inputPortId.includes('terminal_in')) {
	                    const outPort = device.ports.find(p => p.id.includes('terminal_out'));
	                    if (outPort) {
	                        terminalPressures[outPort.id] = inP * 0.95;
	                        queue.push(outPort.id);
	                    }
	                }
	                break;

	            case 'Cooler':
	                if (inputPortId.includes('_pipe_i')) {
	                    const outPort = device.ports.find(p => p.id.includes('_pipe_o'));
	                    if (outPort) {
	                        terminalPressures[outPort.id] = inP * 0.85;
	                        queue.push(outPort.id);
	                    }
	                }
	                break;
	        }

	        if (device.special === 'actuator' && device.type === 'resistor') {
	            const pos = device.currentPos || 0;
	            if (inputPortId.includes('_pipe_u') || inputPortId.includes('_pipe_l')) {
	                const outPortId = deviceId + '_pipe_r';
	                const mixRatio = inputPortId.includes('_pipe_u') ? (1 - pos) : pos;
	                const prevP = terminalPressures[outPortId] || 0;
	                terminalPressures[outPortId] = Math.max(prevP, inP * Math.max(mixRatio, 0.01));
	                queue.push(outPortId);
	            }
	        }
	    }

	
    _connKey(conn) {
        return `${conn.from}|${conn.to}|${conn.type}`;
    }

    _getDeviceIdFromPort(portId) {
        return portId.split('_pipe_')[0];
    }

    _computeTopologyKey() {
        // 连线列表（规范化后排序）
        const conns = (this.sys.conns || []).map(c => `${c.from}|${c.to}|${c.type}`).sort().join(';');

        // 关键设备状态：影响连通性的那些（截止阀、三通、三位阀等）
        const parts = [];
        Object.values(this.sys.comps || {}).forEach(dev => {
            if (!dev || !dev.id) return;
            if (dev.type === 'stopValve') {
                parts.push(`${dev.id}:stop:${!!dev.isOpen}`);
            } else if (dev.type === '3valve') {
                parts.push(`${dev.id}:3valve:e=${!!dev.vE},h=${!!dev.vH},l=${!!dev.vL}`);
            } else if (dev.type === 'airCompressor') {
                parts.push(`${dev.id}:compressor:state=${!!dev.running},p=${dev.pressure || 0}`);
            } else if (dev.type === 'regulator') {
                parts.push(`${dev.id}:regulator:setP=${dev.setPressure || 0}`);
            } else if (dev.type === 'calibrator') {
                parts.push(`${dev.id}:calibrator:upMode=${dev.upMode},sourceMode=${dev.sourceMode},sourceValue=${dev.sourceValue}`);
            } else if (dev.special === 'bubble_level') {
                parts.push(`${dev.id}:bubble_level:backPress=${dev.backPress}`);
            } else if (dev.type === 'Pump') {
                parts.push(`${dev.id}:pumpOn=${!!dev.pumpOn}`);
            } else if (dev.type === 'engine') {
                parts.push(`${dev.id}:engOn=${!!dev.engOn}`);
            }
            // 电动阀/执行器位置 -> 影响流道拓扑（使求解器在阀位变化时重新同步）
            if (dev.special === 'actuator' && typeof dev.currentPos === 'number') {
                parts.push(`${dev.id}:pos=${dev.currentPos.toFixed(3)}`);
            }
        });

        return conns + '|' + parts.sort().join(';');
    }

    _pressuresChanged(prev, curr) {
        const eps = this.pressureEps || 1e-4;
        const keys = new Set([...Object.keys(prev || {}), ...Object.keys(curr || {})]);
        for (const k of keys) {
            const pv = prev[k] || 0;
            const cv = curr[k] || 0;
            if (Math.abs(pv - cv) > eps) return true;
        }
        return false;
    }
}