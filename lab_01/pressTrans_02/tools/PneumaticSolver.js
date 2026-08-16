/**
 * 气路物理求解器
 * 负责根据拓扑连接和设备状态，计算全场压力分布
 */
export class PneumaticSolver {
    constructor(sys) {
        this.sys = sys; // 持有系统引用，获取 comps 和 conns
        this.terminalPressures = {};
        // 缓存：拓扑指纹与上一次求解得到的压力快照
        this.topologyKey = null;
        this.cachedPressures = {};
        // 压力比较容差
        this.pressureEps = 1e-4;
    }

    /**
     * 核心求解函数
     * 返回所有端口的压力映射表 { portId: pressureValue }
     */
    solve() {
        const terminalPressures = {};
        const queue = [];
        const visitedPorts = new Set();

        // 计算当前拓扑指纹（连线 + 关键设备开关状态）
        const currentTopologyKey = this._computeTopologyKey();

        // 1. 初始化：将所有管路端口压力设为 0
        Object.values(this.sys.comps).forEach(device => {
            if (device.ports) {
                device.ports.forEach(port => {
                    if (port.type === 'pipe') {
                        terminalPressures[port.id] = 0;
                    }
                });
            }
        });

        // 2. 识别气源：将所有主动产生压力的端口放入 BFS 队列
        Object.values(this.sys.comps).forEach(device => {
            if (device.type === 'airBottle') {
                const outPortId = `${device.id}_pipe_o`;
                // 气瓶内部压力作为起点
                terminalPressures[outPortId] = device.pressure || 0;
                queue.push(outPortId);
            }
            if (device.special === 'actuator') {
                const outPortId = `${device.id}_pipe_o`;
                // 电气阀门定位器的输出压力作为起点
                terminalPressures[outPortId] = device.outPress || 0;
                queue.push(outPortId);
            }
        });

        // 3. BFS 压力扩散
        while (queue.length > 0) {
            const currentPortId = queue.shift();
            // 避免无限环路
            if (visitedPorts.has(currentPortId)) continue;
            visitedPorts.add(currentPortId);

            const currentP = terminalPressures[currentPortId];

            // A. 通过外部连线扩散 (Wire/Pipe in Conns)
            this.sys.conns.forEach(conn => {
                if (conn.type !== 'pipe') return;

                let nextPortId = null;
                if (conn.from === currentPortId) nextPortId = conn.to;
                else if (conn.to === currentPortId) nextPortId = conn.from;

                if (nextPortId) {
                    // 管路连接视为等压（忽略长管压降）
                    terminalPressures[nextPortId] = currentP;

                    // 如果该端口被标记为泄漏，则实际输入压力随机降低 10% ~ 30%
                    const compId = nextPortId.split('_')[0];
                    const comp = this.sys.comps[compId];
                    if (comp) {
                        const port = comp.ports.find(p => p.id === nextPortId);
                        if (port && port.node.getAttr('isLeaking')) {
                            const lossRatio = 0.2 + Math.random() * 0.01; // 0.1 ~ 0.3
                            terminalPressures[nextPortId] = Math.max(0, currentP * (1 - lossRatio));
                        }
                    }

                    // 查找该端口所属设备，进行内部扩散
                    const deviceId = this._getDeviceIdFromPort(nextPortId);
                    const device = this.sys.comps[deviceId];
                    if (device) {
                        this._processInternalTransfer(device, nextPortId, terminalPressures, queue);
                    }
                }
            });
        }

        this.terminalPressures = terminalPressures;
        // 4. 扩散完成后：比较拓扑与压力快照，若无变化则直接返回，避免不必要的设备更新
        const pressuresChanged = this._pressuresChanged(this.cachedPressures, terminalPressures);
        const topologyChanged = currentTopologyKey !== this.topologyKey;

        if (!topologyChanged && !pressuresChanged) {
            // 无变化：保持缓存并跳过后续更新逻辑
            this.terminalPressures = terminalPressures;
            return;
        }

        // 有变化：更新缓存并继续正常的设备同步逻辑
        this.topologyKey = currentTopologyKey;
        this.cachedPressures = Object.assign({}, terminalPressures);

        // 5. 扩散完成后，强制同步所有压力感应设备的状态
        // 这样做可以确保那些因为连线断开而无法被 BFS 触达的设备，能正确接收到 0 压力信号
        const targetTypes = ['relay', 'pressSwitch', 'pressMeter', 'regulator', 'pressure_sensor', 'pressure_transducer'];

        Object.values(this.sys.comps).forEach(device => {
            if (targetTypes.includes(device.type)) {
                // 获取当前求解器中该设备输入端口的压力，如果 BFS 没扫到，则默认为 0
                const inPortId = `${device.id}_pipe_i`;
                const currentP = this.terminalPressures[inPortId] || 0;

                if (device.update) {
                    // 特殊处理：调压阀（pressRegulator）可能需要保存输入压力用于内部逻辑
                    if (device.type === 'regulator') {
                        device.inputPressure = currentP;
                        device.update();
                    } else {
                        // 执行设备逻辑更新（如仪表盘指针旋转、压力继电器开关动作等）
                        device.update(currentP);
                    }


                }
            } else if (device.special === 'press') {
                const inPortId = `${device.id}_pipe_i`;
                device.press = this.terminalPressures[inPortId] || 0;

            }
            else if (device.type === 'stopValve') {
                const inPortId = `${device.id}_pipe_i`;
                const currentP = this.terminalPressures[inPortId] || 0;
                if (currentP > 0 && device.isOpen === true) {
                    this.sys.comps['cab'].isConsuming = true;
                } else {
                    this.sys.comps['cab'].isConsuming = false;
                }
            } else if (device.special === 'diff') {
                const pH = `${device.id}_pipe_h`;
                const pL = `${device.id}_pipe_l`;
                device.press = this.terminalPressures[pH] - this.terminalPressures[pL];
            } else if (device.special === 'actuator') {
                const pS = `${device.id}_pipe_s`;
                const pIn = `${device.id}_pipe_i`;
                device.sourcePress = this.terminalPressures[pS];
                device.inPress = this.terminalPressures[pIn];
            } else if (device.type === '3valve') {
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
        // 假设 ID 格式为 "CompID_pipe_Label"
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
                parts.push(`${dev.id}:compressor:run=${!!dev.running}`);
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