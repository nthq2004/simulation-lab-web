/**
 * 气路物理求解器
 * 负责根据拓扑连接和设备状态，计算全场压力分布
 */
export class PneumaticSolver {
    constructor(sys) {
        this.sys = sys; // 持有系统引用，获取 comps 和 conns
        this.terminalPressures = {};
    }

    /**
     * 核心求解函数
     * 返回所有端口的压力映射表 { portId: pressureValue }
     */
    solve() {
        const terminalPressures = {};
        const queue = [];
        const visitedPorts = new Set();

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
                        terminalPressures[otherPort.id] = inP;
                    }
                    else {
                        terminalPressures[otherPort.id] =0;
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
                    device.inputPressure = inP;
                    device.update();
                    queue.push(outPortId);
                }
                break;

            case 'pressMeter':
            case 'relay':
                // 末端感应设备：更新内部压力值用于显示或逻辑判断
                if (device.update) device.update(inP);
                break;
        }
    }

    _getDeviceIdFromPort(portId) {
        // 假设 ID 格式为 "CompID_pipe_Label"
        return portId.split('_pipe_')[0];
    }
}