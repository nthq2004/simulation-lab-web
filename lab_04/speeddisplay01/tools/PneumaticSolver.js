/**
 * 气路物理求解器
 * 负责根据拓扑连接和设备状态，计算全场压力分布
 */

export class PneumaticSolver {
    constructor(sys) {
        this.sys = sys;
        this.terminalPressures = {};
        this.topologyKey = null;
        this.cachedPressures = {};
        this.pressureEps = 1e-4;

        // 流量区域拓扑（由 _buildFlowZones 构建）
        this._flowZoneMap = {};   // portId → 'main'|'u_branch'|'l_branch'|'common'|'zero'
        this._pipeGraph = {};     // 管路连接邻接表
    }

    solve() {
        const currentTopologyKey = this._computeTopologyKey();

        // ── 拓扑变化时：重算压力场 + 重建流区域 ──
        if (currentTopologyKey !== this._cachedTopologyKey) {
            this._cachedTopologyKey = currentTopologyKey;

            // ── 组件数组缓存（避免多次 Object.values）──
            const allComps = this.__allComps || (this.__allComps = Object.values(this.sys.comps));

            // ── 压力场 BFS ──
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
                    terminalPressures[outPortId] = 0.4;
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
                    terminalPressures[outPortId] = device.sourceValue / 1000 || 0;
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
                            if (port && port.node && port.node.getAttr && port.node.getAttr('isLeaking')) {
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
            if (topologyChanged || pressuresChanged) {
                this.topologyKey = currentTopologyKey;
                this.cachedPressures = Object.assign({}, terminalPressures);
                this._syncDevices();
            }

            // ── 拓扑变化时重建流量区域 ──
            this._buildFlowZones();
        }

        // ── 设备流量更新（每帧执行，捕捉 pumpFlow / valvePos 实时变化）──
        this._updateDeviceFlows();
    }

    /**
     * 设备状态同步（仅压力相关设备）
     */
    _syncDevices() {
        const pressures = this.terminalPressures;
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
        });
    }

    /**
     * 构建流量区域拓扑
     *
     * 根据管路连接图，将每个 pipe 端口归类到以下区域之一：
     *   'main'     — 干路（泵出口到三通之间）
     *   'u_branch' — u 支路（最终汇入调节阀 u 口）
     *   'l_branch' — l 支路（最终汇入调节阀 l 口）
     *   'common'   — 公共回路（从调节阀 r 口出发）
     *   'zero'     — 未连接任何源
     *
     * 方法：构建端口无向图 → 连通分量分析 → 以调节阀三端口 + 泵出口为锚点分类
     */
    _buildFlowZones() {
        this._flowZoneMap = {};

        // ── 1. 构建管路端口邻接表 ──
        const graph = {};
        this.sys.conns.forEach(conn => {
            if (conn.type !== 'pipe') return;
            if (!graph[conn.from]) graph[conn.from] = [];
            if (!graph[conn.to]) graph[conn.to] = [];
            graph[conn.from].push(conn.to);
            graph[conn.to].push(conn.from);
        });
        this._pipeGraph = graph;

        // ── 2. 关键设备 ──
        const pump = Object.values(this.sys.comps).find(c => c.type === 'Pump');
        const pumpOutPort = pump ? `${pump.id}_pipe_o` : null;

        const elecValve = Object.values(this.sys.comps).find(c => c.special === 'actuator' && c.type === 'resistor');
        const vU = elecValve ? `${elecValve.id}_pipe_u` : null;
        const vL = elecValve ? `${elecValve.id}_pipe_l` : null;
        const vR = elecValve ? `${elecValve.id}_pipe_r` : null;

        // ── 3. 连通分量 BFS ──
        const visited = new Set();
        const graphKeys = Object.keys(graph);
        const comps = [];

        graphKeys.forEach(startPort => {
            if (visited.has(startPort)) return;

            const ports = [];
            const queue = [startPort];
            while (queue.length > 0) {
                const curr = queue.shift();
                if (visited.has(curr)) continue;
                visited.add(curr);
                ports.push(curr);
                for (const nb of (graph[curr] || [])) {
                    if (!visited.has(nb)) queue.push(nb);
                }
            }

            const portSet = new Set(ports);
            let zone = 'zero';
            if (vR && portSet.has(vR)) {
                zone = 'common';
            } else if (vU && portSet.has(vU)) {
                zone = 'u_branch';
            } else if (vL && portSet.has(vL)) {
                zone = 'l_branch';
            } else if (pumpOutPort && portSet.has(pumpOutPort)) {
                zone = 'main';
            }
            if (zone === 'zero' && !elecValve && !pump) zone = 'main';
            if (zone === 'zero' && pump && !elecValve) zone = 'main';

            comps.push({ ports, zone });
            ports.forEach(pid => { this._flowZoneMap[pid] = zone; });
        });

        // ── 4. 通过内联设备传播 u_branch / l_branch ──
        //    内联设备：流量计、冷却器等（非三通/调节阀/发动机/泵）
        const boundaryTypes = new Set(['teeConnector', 'engine', 'Pump']);

        let changed = true;
        while (changed) {
            changed = false;
            for (const comp of comps) {
                if (comp.zone !== 'zero') continue;
                const compSet = new Set(comp.ports);

                for (const portId of comp.ports) {
                    const devId = portId.split('_pipe_')[0];
                    const dev = this.sys.comps[devId];
                    if (!dev || !dev.ports || boundaryTypes.has(dev.type)) continue;
                    // 检查 ElecValve（actuator）也属于边界
                    if (dev.type === 'resistor' && dev.special === 'actuator') continue;

                    for (const op of dev.ports) {
                        if (op.type !== 'pipe' || compSet.has(op.id)) continue;
                        const otherZone = this._flowZoneMap[op.id];
                        if (otherZone === 'u_branch' || otherZone === 'l_branch') {
                            comp.zone = otherZone;
                            comp.ports.forEach(pid => { this._flowZoneMap[pid] = otherZone; });
                            changed = true;
                            break;
                        }
                    }
                    if (changed) break;
                }
            }
        }

        // ── 5. 重映射：common/zero → main ──
        for (const portId in this._flowZoneMap) {
            if (this._flowZoneMap[portId] === 'common' || this._flowZoneMap[portId] === 'zero') {
                this._flowZoneMap[portId] = 'main';
            }
        }
    }

    /**
     * 判断管路流向
     * @param {object} conn - { from, to, type }
     * @returns {number} 1 = conn.from→conn.to, -1 = conn.to→conn.from
     *
     * 规则：
     *   *_out / *_o → 从该端流出
     *   *_in  / *_i → 从另一端流入
     *   三通调节阀：_l/_u 流入，_r 流出
     */
    _pipeFlowDirection(conn) {
        const pf = conn.from, pt = conn.to;
        const portFrom = pf.split('_pipe_')[1] || '';
        const portTo   = pt.split('_pipe_')[1] || '';

        // ---- 三通调节阀 ElecValve 特殊规则 ----
        const devFrom = pf.split('_pipe_')[0];
        const devTo   = pt.split('_pipe_')[0];
        if (devFrom && devFrom === devTo) {
            const isL = portFrom === 'l' || portTo === 'l';
            const isU = portFrom === 'u' || portTo === 'u';
            const isR = portFrom === 'r' || portTo === 'r';
            if (isR && (isL || isU)) {
                return (portFrom === 'l' || portFrom === 'u') ? 1 : -1;
            }
        }

        // ---- 通用端口命名规则 ----
        const fromIsOut = /_(?:o|out)$/.test(pf);
        const toIsOut   = /_(?:o|out)$/.test(pt);
        const fromIsIn  = /_(?:i|in)$/.test(pf);
        const toIsIn    = /_(?:i|in)$/.test(pt);

        if (fromIsOut) return 1;   // 从 from 流出 → from→to
        if (toIsOut)   return -1;  // 从 to 流出   → to→from
        if (toIsIn)    return 1;   // 流入 to       → from→to
        if (fromIsIn)  return -1;  // 流入 from     → to→from

        return 1; // 默认 from→to
    }

    /**
     * 设备流量更新（基于区域拓扑）
     *
     * 每帧执行：
     *   main / common 区域：flow = 泵设定流量
     *   u_branch 区域：     flow = 泵流量 × (1 - 调节阀开度)
     *   l_branch 区域：     flow = 泵流量 × 调节阀开度
     *   zero 区域：         flow = 0
     */
    _updateDeviceFlows() {
        // 首次运行或拓扑未构建时调用
        if (Object.keys(this._flowZoneMap).length === 0) {
            this._buildFlowZones();
        }

        // ── 1. 泵流量 ──
        const pump = Object.values(this.sys.comps).find(c => c.type === 'Pump');
        const mainFlow = (pump && pump.pumpOn) ? (pump.pumpFlow != null ? pump.pumpFlow : 1) : 0;

        // ── 2. 调节阀开度 ──
        const elecValve = Object.values(this.sys.comps).find(c => c.special === 'actuator' && c.type === 'resistor');
        const pos = elecValve ? (elecValve.currentPos || 0) : 0;

        // ── 3. 各区域流量值 ──
        const zoneFlow = {
            'main':     mainFlow,
            'u_branch': mainFlow * (1 - pos),
            'l_branch': mainFlow * pos,
            'common':   mainFlow,
            'zero':     0,
        };

        // ── 4. 遍历所有设备，注入流量 ──
        const allComps = this.__allComps || Object.values(this.sys.comps);
        allComps.forEach(device => {
            if (!device.ports) return;

            // 找该设备的 pipe 端口
            const pipePorts = device.ports.filter(p => p.type === 'pipe');
            if (pipePorts.length === 0) return;

            // 用第一个 pipe 端口确定区域（同设备所有 pipe 口应在同一区域）
            const zone = this._flowZoneMap[pipePorts[0].id] || 'zero';
            const flowValue = zoneFlow[zone] !== undefined ? zoneFlow[zone] : 0;

            // 设置归一化目标流量（供 dp_flow_indicator / rotameter / impeller_flow_indicator 使用）
            if (typeof device.setFlow === 'function') {
                device._targetFlow = Math.max(0, Math.min(1, flowValue));
            }

            // 设置 device.flow 属性（供 flow_sensor / flow_transmitter 等使用）
            if ('flow' in device) {
                device.flow = flowValue;
            }
        });

        // ── 5. 管路流动动画（虚线位移 + 颜色/宽度）──
        const pipeNodes = this.sys.pipeNodes;
        if (pipeNodes && pipeNodes.length > 0) {
            const pipeConns = this.sys.conns.filter(c => c.type === 'pipe');
            for (let i = 0; i < pipeConns.length; i++) {
                const conn = pipeConns[i];
                const flow = pipeNodes[i * 3 + 1];
                if (!flow) continue;

                const zone = this._flowZoneMap[conn.from] || this._flowZoneMap[conn.to] || 'zero';
                const flowValue = zoneFlow[zone] !== undefined ? zoneFlow[zone] : 0;

                if (flowValue > 0) {
                    flow.visible(true);
                    const ratio = flowValue;
                    const speed = 1 + ratio * ratio * 6;
                    // 方向判定：源→目标方向为正（dashOffset 递减），反之为负
                    const dir = this._pipeFlowDirection(conn);
                    flow.dashOffset((flow.dashOffset() || 0) - speed * dir);
                    // 区域区分色：干路蓝、u支路绿、l支路橙
                    const zoneColors = { main: '#3498db', u_branch: '#27ae60', l_branch: '#e67e22' };
                    flow.stroke(zoneColors[zone] || '#3498db');
                    // 线宽 2~8px（平方放大对比）
                    flow.strokeWidth(2 + ratio * ratio * 6);
                } else {
                    flow.visible(false);
                }
            }
        }
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
                parts.push(`${dev.id}:pumpOn=${!!dev.pumpOn},flow=${dev.pumpFlow != null ? dev.pumpFlow : 1}`);
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
