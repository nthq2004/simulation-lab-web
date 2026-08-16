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
            // 电压、时间继电器：赋予小电阻，通过压差可计算电流，其它继电器当成开关
            if (dev.type === 'relay' && (dev.special !=='voltage'||dev.special !=='time')) {
                if (dev.isEnergized) internalUnion(`${id}_wire_NO`, `${id}_wire_COM`);
                else internalUnion(`${id}_wire_NC`, `${id}_wire_COM`);
            }// 电流表：理想电流表内阻为 0，视为短路
            if (dev.type === 'ampmeter')
                internalUnion(`${id}_wire_p`, `${id}_wire_n`);
            // PT100 传感器：在三线制等特定配置下，补偿端(t)与信号端(r)通常在根部短接
            if (dev.special === 'pt100')
                internalUnion(`${id}_wire_r`, `${id}_wire_t`);
            // 万用表：切到电流档（MA）时，其表笔间内阻极小，视为短路处理
            if (dev.type === 'multimeter' && dev.mode === 'MA')
                internalUnion(`${id}_wire_ma`, `${id}_wire_com`);
            // 普通电阻：当阻值设定极小时（小于 0.1Ω），仿真逻辑将其视为理想导线以简化计算
            if (dev.type === 'resistor' && dev.currentResistance < 0.1)
                internalUnion(`${id}_wire_l`, `${id}_wire_r`);
        });

        // // 3. 【构建映射表】将物理端口名映射为数值索引 (Cluster Index)
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
