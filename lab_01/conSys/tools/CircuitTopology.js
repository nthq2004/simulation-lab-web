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

            if (dev.type === 'switch' && dev.isOn)
                internalUnion(`${id}_wire_l`, `${id}_wire_r`);
            if (dev.type === 'relay') {
                if (dev.isEnergized) internalUnion(`${id}_wire_NO`, `${id}_wire_COM`);
                else                 internalUnion(`${id}_wire_NC`, `${id}_wire_COM`);
            }
            if (dev.type === 'ampmeter')
                internalUnion(`${id}_wire_p`, `${id}_wire_n`);
            if (dev.special === 'pt100')
                internalUnion(`${id}_wire_r`, `${id}_wire_t`);
            if (dev.type === 'multimeter' && dev.mode === 'MA')
                internalUnion(`${id}_wire_ma`, `${id}_wire_com`);
            if (dev.type === 'resistor' && dev.currentResistance < 0.1)
                internalUnion(`${id}_wire_l`, `${id}_wire_r`);
        });

        // 3. 构建 portToCluster 映射
        const portToCluster = new Map();
        const clusterIndexMap = new Map();
        let idx = 0;
        activePorts.forEach(p => {
            const root = find(p);
            if (!clusterIndexMap.has(root)) clusterIndexMap.set(root, idx++);
            portToCluster.set(p, clusterIndexMap.get(root));
        });
        const clusterCount = idx;

        // 4. 生成 clusters 集合（每个 cluster 是端口名的 Set）
        const clusterGroups = {};
        activePorts.forEach(p => {
            const root = find(p);
            if (!clusterGroups[root]) clusterGroups[root] = new Set();
            clusterGroups[root].add(p);
        });
        const clusters = Object.values(clusterGroups);

        return { portToCluster, clusterCount, clusters };
    }
}
