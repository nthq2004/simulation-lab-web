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
        // ── 压力场（原有逻辑保持不变）──
        const terminalPressures = {};
        const queue = [];
        const visitedPorts = new Set();
        const currentTopologyKey = this._computeTopologyKey();

        Object.values(this.sys.comps).forEach(device => {
            if (device.ports) {
                device.ports.forEach(port => {
                    if (port.type === 'pipe') terminalPressures[port.id] = 0;
                });
            }
        });

        Object.values(this.sys.comps).forEach(device => {
            if (device.type === 'airBottle') {
                const outPortId = `${device.id}_pipe_o`;
                terminalPressures[outPortId] = device.pressure || 0;
                queue.push(outPortId);
            }
            if (device.special === 'actuator') {
                const outPortId = `${device.id}_pipe_o`;
                terminalPressures[outPortId] = device.outPress || 0;
                queue.push(outPortId);
            }
            if(device.type ==='calibrator' && device.activePanel === 'SOURCE' && device.sourceMode === 'SRC_PRESSURE'){  
                const outPortId = `${device.id}_pipe_o`;
                terminalPressures[outPortId] = device.sourceValue /1000 || 0; // 压力校准器输出压力，单位转换为 MPa
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
        Object.values(this.sys.comps).forEach(device => {
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

        const targetTypes = ['relay', 'pressSwitch', 'pressMeter', 'regulator',
            'pressure_sensor', 'pressure_transducer'];

        Object.values(this.sys.comps).forEach(device => {
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

            else if (device.special === 'press') {
                const inPortId = `${device.id}_pipe_i`;
                device.press = pressures[inPortId] || 0;
                device.flow = getPortFlow(inPortId);  // 附加流量
            }

            else if (device.type === 'stopValve') {
                const inPortId = `${device.id}_pipe_i`;
                const currentP = pressures[inPortId] || 0;
                if (currentP > 0 && device.isOpen === true) {
                    this.sys.comps['cab'].isConsuming = true;
                } else {
                    this.sys.comps['cab'].isConsuming = false;
                }
            }

            else if (device.special === 'diff') {
                const pH = `${device.id}_pipe_h`;
                const pL = `${device.id}_pipe_l`;
                device.press = pressures[pH] - pressures[pL];
            }
            else if (device.type === 'calibrator') {
                if(device.upMode === 'MEAS_PRESSURE'){
                    const pIn = `${device.id}_pipe_i`;
                    device.upPressureValue = pressures[pIn]*1000 || 0;   
                }
                if(device.activePanel === 'MEASURE' && device.sourceMode === 'MEAS_PRESSURE'){
                    const pIn = `${device.id}_pipe_o`;
                    device.downPressureValue = (pressures[pIn] || 0) * 1000; // 从 MPa 转回 kPa
                }
            }
            else if (device.special === 'actuator') {
                const pS = `${device.id}_pipe_s`;
                const pIn = `${device.id}_pipe_i`;
                device.sourcePress = pressures[pS];
                device.inPress = pressures[pIn];
                device.flow = getPortFlow(pIn);
            }
            else if (device.type === '3valve') {
                if (device.vE === true) {
                    const pInH = this.terminalPressures[`${device.id}_pipe_inh`];
                    const pInL = this.terminalPressures[`${device.id}_pipe_inl`];
                    // 平衡阀开启：输出端连通
                    if (device.vH && device.vL) {
                        this.terminalPressures[`${device.id}_pipe_outh`] = (pInH + pInL) / 2;
                        this.terminalPressures[`${device.id}_pipe_outl`] = (pInH + pInL) / 2;
                    } else if (device.vH) {
                        this.terminalPressures[`${device.id}_pipe_outh`] = pInH;
                        this.terminalPressures[`${device.id}_pipe_outl`] = pInH;
                    } else if (device.vL) {
                        this.terminalPressures[`${device.id}_pipe_outh`] = pInL;
                        this.terminalPressures[`${device.id}_pipe_outl`] = pInL;// 只通低压，平衡到两端
                    } else {
                        this.terminalPressures[`${device.id}_pipe_outh`] = 0;
                        this.terminalPressures[`${device.id}_pipe_outl`] = 0;   // 进口全关
                    }
                }

            }

            else if (device.type === 'airCompressor') {
                // // 3. 核心新增：压缩机充气逻辑  A. 只有压缩机在运转时才具备充气能力
                if (device.running) {
                    const outPortId = `${device.id}_pipe_o`;
                    const bottleInPortId = `cab_pipe_i`;
                    const conn = { from: outPortId, to: bottleInPortId, type: 'pipe' };
                    const exists = this.sys.conns.some(c => this.sys._connEqual(c, conn));
                    // C. 关键：判断压缩机输出口与气瓶输入口是否在同一压力分支
                    if (exists)
                        // D. 调用气瓶的充气方法 (每帧增加少量压力)
                        this.sys.comps['cab'].refill(0.002);
                }
            }
        });
    }

    /** 生成连线唯一键 */
    _connKey(conn) {
        return `${conn.from}=>${conn.to}`;
    }

    /**
     * 处理压力在设备内部从输入端到输出端的转换
     */
    _processInternalTransfer(device, inputPortId, terminalPressures, queue) {
        const inP = terminalPressures[inputPortId];
        const deviceId = device.id;

        switch (device.type) {
            case 'teeConnector':
                // 三通：任一端口进，其他所有端口出
                device.ports.forEach(p => {
                    if (p.id !== inputPortId) {
                        terminalPressures[p.id] = inP;
                        queue.push(p.id);
                    }
                });
                break;

            case 'stopValve':
                // 截止阀：仅在开启时传递压力
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
                // 调压阀：仅从输入(i)传向输出(o)，且受设定值限制
                if (inputPortId.includes('_pipe_i')) {
                    const outPortId = `${deviceId}_pipe_o`;
                    // 核心逻辑：输出 = Min(输入, 设定值)
                    const outP = Math.min(inP, device.setPressure || 0);
                    terminalPressures[outPortId] = outP;
                    // 同步设备内部属性，用于 UI 显示
                    queue.push(outPortId);
                }
                break;
            case '3valve':
                if (device.vE === false) {
                    if (inputPortId === `${deviceId}_pipe_inl`) {
                        const outPortId = `${deviceId}_pipe_outl`;
                        if (device.vL == true)
                            terminalPressures[outPortId] = inP;
                        else terminalPressures[outPortId] = 0;
                        // 同步设备内部属性，用于 UI 显示
                        queue.push(outPortId);
                    } else if (inputPortId === `${deviceId}_pipe_inh`) {
                        const outPortId = `${deviceId}_pipe_outh`;
                        if (device.vH == true)
                            terminalPressures[outPortId] = inP;
                        else terminalPressures[outPortId] = 0;
                        // 同步设备内部属性，用于 UI 显示
                        queue.push(outPortId);
                    }
                }

            case 'transmitter_2wire':
                if (device.special === 'press') device.press = inP;
            case 'pressMeter':
            case 'relay':
                // 末端感应设备：更新内部压力值用于显示或逻辑判断

                break;
        }
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
            }else if (dev.type === 'regulator') {
                parts.push(`${dev.id}:regulator:setP=${dev.setPressure || 0}`);
            }else if (dev.type === 'calibrator') {
                parts.push(`${dev.id}:calibrator:activePanel=${dev.activePanel},sourceMode=${dev.sourceMode},sourceValue=${dev.sourceValue}`);
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