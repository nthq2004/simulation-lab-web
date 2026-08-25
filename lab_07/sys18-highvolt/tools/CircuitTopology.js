/**
 * CircuitTopology.js
 * 拓扑构建：并查集 + 零电阻短接 → Cluster 映射
 */

export class CircuitTopology {
    /**
     * @param {object[]} rawDevices  所有器件数组
     * @param {object[]} connections 导线连接数组（type === 'wire'）
     */
    build(rawDevices, connections, poorContactPorts = new Set(), faultShortGroups = []) {
        const parent = {};
        const find = (i) => (parent[i] === undefined || parent[i] === i) ? i : (parent[i] = find(parent[i]));
        const union = (i, j) => {
            const rI = find(i), rJ = find(j);
            if (rI !== rJ) parent[rI] = rJ;
        };

        // 1. 只收集有连线的端口（接触不良的端口不参与 union）
        const activePorts = new Set();
        connections.forEach(c => {
            activePorts.add(c.from);
            activePorts.add(c.to);
            if (!poorContactPorts.has(c.from) && !poorContactPorts.has(c.to))
                union(c.from, c.to);
        });

        // 1b. 故障注入短路：把指定端口强制合并为同一簇（模拟相间短路）
        // faultShortGroups 形如 [['port_a','port_b'], ['x','y','z']]，每组内所有端口
        // 即使无导线也视为同一导电节点；短路端口须先登记为活动端口，
        // 否则未连线端口不参与后续拓扑构建。
        faultShortGroups.forEach(group => {
            if (!Array.isArray(group) || group.length < 2) return;
            group.forEach(p => activePorts.add(p));
            const root0 = group[0];
            for (let k = 1; k < group.length; k++) union(root0, group[k]);
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
            if (dev.type === 'relay' && dev.special === 'wtrelay') {
                if (dev.isEnergized) internalUnion(`${id}_wire_NC`, `${id}_wire_COM`);
                else internalUnion(`${id}_wire_NO`, `${id}_wire_COM`);
            }
            // 逆功率继电器：未动作(含延时中) NC-COM 闭合；跳闸后 NO-COM 闭合
            if (dev.type === 'relay' && dev.special === 'REV-POWER') {
                if (dev._state === 'tripped') internalUnion(`${id}_wire_NO`, `${id}_wire_COM`);
                else internalUnion(`${id}_wire_NC`, `${id}_wire_COM`);
            }
            // PT100 传感器：在三线制等特定配置下，补偿端(t)与信号端(r)通常在根部短接
            if (dev.special === 'pt100')
                internalUnion(`${id}_wire_r`, `${id}_wire_t`);
            // UPS：输出中性线与输入中性线内部共地（避免输出浮动子网导致 MNA 奇异）
            if (dev.type === 'ups') {
                internalUnion(`${id}_wire_in_n`, `${id}_wire_out1_n`);
                internalUnion(`${id}_wire_in_n`, `${id}_wire_out2_n`);
            }

            // 起动按钮（NO常开）：按下或模拟闭合时短接
            if (dev.type === 'PUSHBUTTON' && dev.special === 'START-BTN' && (dev._isPressed || dev._manualPressed))
                internalUnion(`${id}_wire_no1`, `${id}_wire_no2`);

            // 发电机组遥控面板：START/STOP 按住时短接对应端口对
            if (dev.type === 'gen_remote_panel') {
                if (dev._startPressed) internalUnion(`${id}_wire_start_a`, `${id}_wire_start_b`);
                if (dev._stopPressed)  internalUnion(`${id}_wire_stop_a`, `${id}_wire_stop_b`);
            }

            // 应急配电板：起动/停止信号短接对应端口对
            if (dev.type === 'emergency_panel') {
                if (dev._out && dev._out.genStart) internalUnion(`${id}_wire_egen_start_a`, `${id}_wire_egen_start_b`);
                if (dev._out && dev._out.genStop)  internalUnion(`${id}_wire_egen_stop_a`,  `${id}_wire_egen_stop_b`);
            }

            // 停止按钮（NC常闭）：未按下且未故障时短接
            if (dev.type === 'PUSHBUTTON' && dev.special === 'STOP-BTN' && !dev._isPressed && !dev._faultOpen)
                internalUnion(`${id}_wire_nc3`, `${id}_wire_nc4`);

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

            // 铅酸蓄电池：仅当有接线时才注册内部端口（防止未接线电池产生浮动节点）
            if (dev.type === 'leadacid_battery') {
                let hasConnection = false;
                for (let i = 1; i <= 6 && !hasConnection; i++) {
                    if (activePorts.has(`${id}_wire_cell${i}_p`) || activePorts.has(`${id}_wire_cell${i}_n`)) hasConnection = true;
                }
                if (hasConnection) {
                    for (let i = 1; i <= 6; i++) {
                        activePorts.add(`${id}_wire_cell${i}_p`);
                        activePorts.add(`${id}_wire_cell${i}_n`);
                    }
                    for (let i = 1; i < 6; i++) {
                        internalUnion(`${id}_wire_cell${i}_n`, `${id}_wire_cell${i + 1}_p`);
                    }
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

            // 空气断路器（ACB，含联络开关/船用主开关）辅助触点：
            //   NO 常开触点（no1/no2）：合闸闭合、分闸断开
            //   NC 常闭触点（nc1/nc2）：分闸闭合、合闸断开
            if (dev.type === 'ACB') {
                const acbOn = dev._state === 'on';
                if (dev.ports) {
                    if (dev.ports.some(p => p.id === 'no1')) {
                        if (acbOn) internalUnion(`${id}_wire_no1`, `${id}_wire_no2`);
                    }
                    if (dev.ports.some(p => p.id === 'nc1')) {
                        if (!acbOn) internalUnion(`${id}_wire_nc1`, `${id}_wire_nc2`);
                    }
                }
                // 接地开关闭合：T1/T2/T3 出线侧与内部虚拟地短接（与地同簇）
                if (typeof dev.isGrounded === 'function' ? dev.isGrounded() : (dev._gsClosed === true)) {
                    ['t1', 't2', 't3'].forEach(p => {
                        const tid = `${id}_wire_${p}`;
                        const gid = `${id}_wire_gnd`;
                        activePorts.add(tid);
                        activePorts.add(gid);
                        internalUnion(tid, gid);
                    });
                } else {
                    // 未接地时仅登记端口（不合并，端口保持独立）
                    ['t1', 't2', 't3'].forEach(p => activePorts.add(`${id}_wire_${p}`));
                }
            }

            // 三相汇流排：同一相位铜条上所有已连线端口短接为同一节点
            // （仅 union 有连线的端口，未接线端口不产生浮动节点）
            if (dev.type === 'busbar_3p') {
                const n = dev._portsPerBar || 8;
                ['l1', 'l2', 'l3'].forEach(ph => {
                    let first = null;
                    for (let i = 1; i <= n; i++) {
                        const pid = `${id}_wire_${ph}_${i}`;
                        if (activePorts.has(pid)) {
                            if (first === null) first = pid;
                            else internalUnion(first, pid);
                        }
                    }
                });
            }

        });

        // 3. 【全局合并所有地】所有 Ground 组件与同步表的接地端视为同一节点
        let firstGnd = null;
        rawDevices.forEach(dev => {
            if (dev.type === 'gnd' || dev.type === 'syncroscope') {
                const pid = `${dev.id}_wire_gnd`;
                if (activePorts.has(pid)) {
                    if (firstGnd === null) firstGnd = pid;
                    else union(firstGnd, pid);
                }
            }
            // 真空断路器接地开关闭合：其内部虚拟地端口并入全局地
            if (dev.type === 'ACB' && typeof dev.isGrounded === 'function' && dev.isGrounded()) {
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
            if (dev.type === 'ACB') {
                ['l1','l2','l3','t1','t2','t3','fla','flb'].forEach(p =>
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
