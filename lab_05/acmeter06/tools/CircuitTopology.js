/**
 * CircuitTopology.js
 * 拓扑构建：并查集 + 零电阻短接 → Cluster 映射
 */

export class CircuitTopology {
    /**
     * @param {object[]} rawDevices  所有器件数组
     * @param {object[]} connections 导线连接数组（type === 'wire'）
     */
    build(rawDevices, connections) {
        const parent = {};
        const find = (i) => (parent[i] === undefined || parent[i] === i) ? i : (parent[i] = find(parent[i]));
        const union = (i, j) => {
            const rI = find(i), rJ = find(j);
            if (rI !== rJ) parent[rI] = rJ;
        };

        // 1. 只收集有连线的端口
        const activePorts = new Set();
        connections.forEach(c => {
            activePorts.add(c.from);
            activePorts.add(c.to);
            union(c.from, c.to);
        });

        // 2. 器件内部的零电阻短接逻辑（只有两端都有连线才 union）
        rawDevices.forEach(dev => {
            const id = dev.id;
            const internalUnion = (p1, p2) => {
                if (activePorts.has(p1) && activePorts.has(p2)) union(p1, p2);
            };
            // 开关：闭合状态下左右端短接
            if (dev.type === 'switch' && dev.isOn)
                internalUnion(`${id}_wire_l`, `${id}_wire_r`);
            // SPNT 开关（单刀多掷）：根据 _position 短接 COM 与对应端子
            if (dev.type === 'SPNT' && dev._position !== undefined)
                internalUnion(`${id}_wire_com`, `${id}_wire_t${dev._position}`);
            // SmartAnalogSwitch：根据 position 短接 COM 与对应端子（功能型 SP4T）
            if (dev.type === 'smart_switch' && dev.position !== undefined)
                internalUnion(`${id}_wire_com`, `${id}_wire_t${dev.position}`);
            // 万能转换开关：根据凸轮表短路每对触点 L-R
            if (dev.type === 'uniswitch' && dev._pairClosed !== undefined) {
                dev._pairClosed.forEach((closed, i) => {
                    if (closed) internalUnion(`${id}_wire_p${i+1}l`, `${id}_wire_p${i+1}r`);
                });
            }
            // 电压、时间继电器：赋予小电阻，通过压差可计算电流，其它继电器当成开关
            if (dev.type === 'relay' && (dev.special !== 'voltage')) {
                if (dev.isEnergized) internalUnion(`${id}_wire_NO`, `${id}_wire_COM`);
                else internalUnion(`${id}_wire_NC`, `${id}_wire_COM`);
            }
            if (dev.type === 'relay' && (dev.special === 'voltage' && dev.contactFault===false)) {
                if (dev.isEnergized) internalUnion(`${id}_wire_NO`, `${id}_wire_COM`);
                else internalUnion(`${id}_wire_NC`, `${id}_wire_COM`);
            }            
            // PT100 传感器：在三线制等特定配置下，补偿端(t)与信号端(r)通常在根部短接
            if (dev.special === 'pt100')
                internalUnion(`${id}_wire_r`, `${id}_wire_t`);
            // 普通电阻：当阻值设定极小时（小于 0.01Ω），仿真逻辑将其视为理想导线以简化计算
            if (dev.type === 'resistor' && dev.currentResistance < 0.01)
                internalUnion(`${id}_wire_l`, `${id}_wire_r`);
            // 单相熔断器：正常时 l-t 短路，熔断后开路
            if (dev.type === '1p-fuse' && dev.getState() === 'ok')
                internalUnion(`${id}_wire_l`, `${id}_wire_t`);
        });

        // 3. 【全局合并所有地】所有 Ground 组件的端口视为同一节点
        let firstGnd = null;
        rawDevices.forEach(dev => {
            if (dev.type === 'gnd') {
                const pid = `${dev.id}_wire_gnd`;
                if (activePorts.has(pid)) {
                    if (firstGnd === null) firstGnd = pid;
                    else union(firstGnd, pid);
                }
            }
        });

        // 4. 【内置端口】MOTOR 等器件的内部端口始终纳入拓扑（即使未接线）
        rawDevices.forEach(dev => {
            if (dev.type === 'MOTOR') {
                ['l1', 'l2', 'l3', 'pe'].forEach(p =>
                    activePorts.add(`${dev.id}_wire_${p}`));
            }
        });
        // 数字万用表电阻/二极管档：V 和 COM 始终纳入拓扑（即使未接线），
        // 以便恒流源注入和顺从电压输出
        rawDevices.forEach(dev => {
            if (dev.type === 'multimeter' && dev.mode && (dev.mode.startsWith('RES') || dev.mode === 'DIODE')) {
                activePorts.add(`${dev.id}_wire_v`);
                activePorts.add(`${dev.id}_wire_com`);
            }
        });

        // 5. 【构建映射表】将物理端口名映射为数值索引 (Cluster Index)
        const portToCluster = new Map();// 键：端口名 (String)，值：节点索引 (Number)
        const clusterIndexMap = new Map();// 辅助：记录每个并查集根节点的唯一索引
        let idx = 0;
        activePorts.forEach(p => {
            const root = find(p);
            // 如果这个根节点还没分配索引，则分配一个新的递增索引
            if (!clusterIndexMap.has(root)) clusterIndexMap.set(root, idx++);
            // 将当前端口指向对应的索引
            portToCluster.set(p, clusterIndexMap.get(root));
        });
        // 总节点数（MNA 矩阵的大小将基于此值构建）
        const clusterCount = idx;

        // 4. 生成 clusters 集合（每个 cluster 是端口名的 Set）
        const clusterGroups = {};
        activePorts.forEach(p => {
            const root = find(p);
            if (!clusterGroups[root]) clusterGroups[root] = new Set();
            clusterGroups[root].add(p);
        });
        // 转化为数组格式：[[port1, port2], [port3, port4], ...]
        const clusters = Object.values(clusterGroups);

        return { portToCluster, clusterCount, clusters };
    }
}
