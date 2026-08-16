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
            if (dev.type === 'relay' && (dev.special === 'voltage' && dev.contactFault===false)) {
                if (dev.isEnergized) internalUnion(`${id}_wire_NO`, `${id}_wire_COM`);
                else internalUnion(`${id}_wire_NC`, `${id}_wire_COM`);
            }            
            // PT100 传感器：在三线制等特定配置下，补偿端(t)与信号端(r)通常在根部短接
            if (dev.special === 'pt100')
                internalUnion(`${id}_wire_r`, `${id}_wire_t`);

            // 热继电器：主电路 L-T 由 DeviceStamps 作小电阻处理，不在此短接
            // 辅助触头：NC 未跳脱时闭合，NO 跳脱时闭合
            if (dev.type === 'relay' && dev.special === 'time') {
                if (dev._state === 'output') {
                    internalUnion(`${id}_wire_no_a`, `${id}_wire_com_a`);
                    internalUnion(`${id}_wire_com_b`, `${id}_wire_no_b`);
                } else {
                    internalUnion(`${id}_wire_nc_a`, `${id}_wire_com_a`);
                    internalUnion(`${id}_wire_com_b`, `${id}_wire_nc_b`);
                }
            }

            if (dev.type === 'RELAY' && dev.special === 'THERMAL-OL-RELAY') {
                if (dev._state !== 'tripped') {
                    internalUnion(`${id}_wire_nc_a`, `${id}_wire_nc_b`);
                } else {
                    internalUnion(`${id}_wire_no_a`, `${id}_wire_no_b`);
                }
            }

            // 三相交流接触器：吸合时短接主触点和 NO 触点，释放时短接 NC 触点
            if (dev.type === 'CONTACTOR') {
                const isOn = dev._state === 'on';
                if (isOn) {
                    if (!dev._faultContactL1T1) internalUnion(`${id}_wire_l1`, `${id}_wire_t1`);
                    internalUnion(`${id}_wire_l2`, `${id}_wire_t2`);
                    internalUnion(`${id}_wire_l3`, `${id}_wire_t3`);
                    if (!dev._faultContactNO1) internalUnion(`${id}_wire_no1a`, `${id}_wire_no1b`);
                    internalUnion(`${id}_wire_no2a`, `${id}_wire_no2b`);
                } else {
                    internalUnion(`${id}_wire_nc1a`, `${id}_wire_nc1b`);
                    internalUnion(`${id}_wire_nc2a`, `${id}_wire_nc2b`);
                }
            }

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

        // 4. 【内置端口】MOTOR / motor_winding 等器件的内部端口始终纳入拓扑（即使未接线）
        rawDevices.forEach(dev => {
            if (dev.type === 'MOTOR') {
                ['l1', 'l2', 'l3', 'pe'].forEach(p =>
                    activePorts.add(`${dev.id}_wire_${p}`));
            }
            if (dev.type === 'motor_winding') {
                ['u1','u2','v1','v2','w1','w2'].forEach(p =>
                    activePorts.add(`${dev.id}_wire_${p}`));
            }
            if (dev.type === 'induction_motor') {
                ['u1','u2','v1','v2','w1','w2'].forEach(p =>
                    activePorts.add(`${dev.id}_wire_${p}`));
            }
            if (dev.type === 'source_3p') {
                ['u', 'v', 'w', 'n'].forEach(p =>
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
