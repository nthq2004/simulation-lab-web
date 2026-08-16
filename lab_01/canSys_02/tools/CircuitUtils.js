/**
 * CircuitUtils.js
 * 工具方法：
 *   - 等效电阻计算（矩阵试探法）
 *   - 两端并联电阻计算
 *   - 电压读取辅助
 *   - 端口连通判定
 */

import { MNAMatrix } from './MNAMatrix.js';

export const CircuitUtils = {

    /**
     * 辅助1：从 results 向量或已知映射中获取 cluster 电压，这个主要在求解过程中使用
     */
    getVoltageFromResults(results, nodeMap, gndClusterIndices, vPosMap, clusterIdx) {
        if (clusterIdx === undefined) return 0;
        if (gndClusterIndices.has(clusterIdx)) return 0;
        if (vPosMap.has(clusterIdx)) return vPosMap.get(clusterIdx);
        const mIdx = nodeMap.get(clusterIdx);
        return mIdx !== undefined ? results[mIdx] : 0;
    },

    /**
     * 辅助2：获取指定端口电压，这个是在求解后使用。
     */
    getVoltageAtPort(portId, portToCluster, nodeVoltages) {
        const cIdx = portToCluster.get(portId);
        return cIdx !== undefined ? (nodeVoltages.get(cIdx) || 0) : 0;
    },

    /**
     * 辅助3：获取两端口电压差
     */
    getPD(pA, pB, portToCluster, nodeVoltages) {
        const getV = (pId) => {
            const cIdx = portToCluster.get(pId);
            return cIdx !== undefined ? (nodeVoltages.get(cIdx) || 0) : 0;
        };
        // 教训，原来是这样，结构cluster的数值可能为0，导致始终返回0.  if (！portToCluster.get(pA)|| ！portToCluster.get(pB) ) return 0;
        if (portToCluster.get(pA) === undefined || portToCluster.get(pB) === undefined) return 0;
        return getV(pA) - getV(pB);
    },

    /**
     * 辅助4：判断两端口是否处于同一 Cluster（短接/连通）
     */
    isPortConnected(pA, pB, portToCluster) {
        const idxA = portToCluster.get(pA);
        const idxB = portToCluster.get(pB);
        return (idxA !== undefined && idxB !== undefined && idxA === idxB);
    },

    /**
     * 辅助5：等效电阻计算（矩阵注入试探法）
     * 在 A 注入 1A → B 为 GND → 解出 V_A = R_eq
     *
     * @param {Set}   startCluster  起始端集群
     * @param {Set}   endCluster    终止端集群（参考地）
     * @param {Set[]} allClusters   所有 clusters 数组
     * @param {object[]} rawDevices 原始器件数组
     * @param {Map}   portToCluster 端口→cluster 索引映射
     * @param {Map}   equivResCache 缓存（可选，传 null 则不缓存）
     * @returns {number} 等效电阻（Ω），开路返回 Infinity
     */
    getEquivalentResistance(startCluster, endCluster, allClusters, rawDevices, portToCluster, equivResCache) {
        const startIdx = allClusters.indexOf(startCluster);
        const endIdx = allClusters.indexOf(endCluster);

        if (startIdx === -1 || endIdx === -1) return Infinity;
        if (startIdx === endIdx) return 0;

        const cacheKey = `${startIdx}_${endIdx}`;
        // 优先从缓存中获取电阻值
        if (equivResCache && equivResCache.has(cacheKey)) return equivResCache.get(cacheKey);

        // 以 endIdx 为参考地，建立节点映射
        const nodeMap = new Map();
        let mSize = 0;
        for (let i = 0; i < allClusters.length; i++) {
            if (i !== endIdx) nodeMap.set(i, mSize++);
        }
        if (mSize === 0) return Infinity;

        const G = Array.from({ length: mSize }, () => new Float64Array(mSize));
        const B = new Float64Array(mSize);

        /**
         * 构建电阻模型列表
         * 将所有含电阻特性的设备转化为 { l: 节点1, r: 节点2, R: 阻值 } 的统一格式
         */
        const resistorList = [];

        // 辅助函数：尝试获取端点对应的集群索引，并加入列表
        const addResistor = (p1Name, p2Name, resistance) => {
            const lIdx = portToCluster.get(p1Name);
            const rIdx = portToCluster.get(p2Name);
            // 只有当两个端点都连接到了有效的电路集群时，才视为有效支路
            if (lIdx !== undefined && rIdx !== undefined) {
                resistorList.push({
                    l: lIdx,
                    r: rIdx,
                    R: (resistance === undefined || resistance === null) ? 1e9 : resistance
                });
                return true;
            }
            return false;
        };

        for (const dev of rawDevices) {
            const { id, type, special } = dev;

            // 1. 处理标准两线电阻类元件 (包括热电偶 tc、电压型继电器 relay)
            if (type === 'resistor' || type === 'tc' || (type === 'relay' && special === 'voltage')) {
                let rIdx = portToCluster.get(`${id}_wire_r`);

                // 特殊逻辑：PT100 三线制，如果 R 端没接，尝试查找 T 端
                if (special === 'pt100' && rIdx === undefined) {
                    rIdx = portToCluster.get(`${id}_wire_t`);
                }

                const lIdx = portToCluster.get(`${id}_wire_l`);
                if (lIdx !== undefined && rIdx !== undefined) {
                    resistorList.push({
                        l: lIdx,
                        r: rIdx,
                        R: dev.currentResistance ?? 1e9
                    });
                }
                continue;
            }

            // 2. 处理压力传感器 (通常包含两个独立的压力敏电阻通道 R1 和 R2)
            if (type === 'pressure_sensor') {
                addResistor(`${id}_wire_r1l`, `${id}_wire_r1r`, dev.r1);
                addResistor(`${id}_wire_r2l`, `${id}_wire_r2r`, dev.r2);
                continue;
            }

            // 3. 处理 CAN 总线及数字输出模块 (DO)
            if (special === 'can') {
                // 处理两组可能的 CAN 匹配电阻
                addResistor(`${id}_wire_can1p`, `${id}_wire_can1n`, dev.currentResistance);
                addResistor(`${id}_wire_can2p`, `${id}_wire_can2n`, dev.currentResistance);

                // 如果是 DO 类型，额外处理其输出通道的内阻
                if (type === 'DO') {
                    addResistor(`${id}_wire_ch1p`, `${id}_wire_ch1n`, dev.ch1R);
                    addResistor(`${id}_wire_ch2p`, `${id}_wire_ch2n`, dev.ch2R);
                }
                continue;
            }

            // 4. 处理校验仪 (输出模拟电阻或模拟 RTD)
            if (type === 'calibrator') {
                let rVal = Infinity;
                if (dev.sourceMode === "SRC_RES") {
                    rVal = dev.sourceValue;
                } else if (dev.sourceMode === "SRC_RTD") {
                    // 将温度值转换为对应的欧姆值
                    rVal = dev._tempToRTDOhm(dev.sourceValue);
                }

                if (rVal !== Infinity) {
                    addResistor(`${id}_wire_src_v`, `${id}_wire_src_com`, rVal);
                }
            }
        }

        // 填充导纳矩阵，求取等效电阻不用考虑电压源和电流源。
        for (let i = 0; i < allClusters.length; i++) {
            for (let j = i + 1; j < allClusters.length; j++) {
                let inverseRSum = 0, count = 0;
                let hasZero = false;
                for (const re of resistorList) {
                    if ((re.l === i && re.r === j) || (re.l === j && re.r === i)) {
                        count++;
                        if (re.R < 0.1) { hasZero = true; break; }
                        inverseRSum += 1 / re.R;
                    }
                }
                let totalR = Infinity;
                if (hasZero) totalR = 0;
                else if (count > 0) totalR = 1 / inverseRSum;

                if (totalR !== Infinity) {
                    const g = 1 / totalR;
                    const n1 = nodeMap.has(i) ? { t: 'u', i: nodeMap.get(i) } : { t: 'g' };
                    const n2 = nodeMap.has(j) ? { t: 'u', i: nodeMap.get(j) } : { t: 'g' };
                    if (n1.t === 'u') {
                        G[n1.i][n1.i] += g;
                        if (n2.t === 'u') G[n1.i][n2.i] -= g;
                    }
                    if (n2.t === 'u') {
                        G[n2.i][n2.i] += g;
                        if (n1.t === 'u') G[n2.i][n1.i] -= g;
                    }
                }
            }
        }

        const aNodeIdx = nodeMap.get(startIdx);
        if (aNodeIdx === undefined) return Infinity;
        B[aNodeIdx] = 1.0;
        for (let i = 0; i < mSize; i++) G[i][i] += 1e-15;

        try {
            const results = MNAMatrix.gauss(G, B);
            const vA = results[aNodeIdx];
            const out = (vA > 1e9) ? Infinity : vA;
            if (equivResCache) equivResCache.set(cacheKey, out);
            return out;
        } catch (e) {
            return Infinity;
        }
    },

    /**
     * 辅助6：计算两个集群之间的总并联电阻（用于电阻档等简单查询）
     */
    getParallelResistanceBetweenClusters(clusterA, clusterB, rawDevices) {
        if (clusterA === clusterB) return { totalR: 0, count: 0 };

        let inverseRSum = 0;
        let resistorCount = 0;
        let hasZeroResistor = false;

        // 内部辅助函数：处理电阻逻辑
        const processResistor = (rValue) => {
            const r = (rValue === undefined || rValue === null) ? 1e9 : rValue;
            if (r < 0.001) {
                hasZeroResistor = true;
            } else if (!hasZeroResistor) {
                // 如果已经发现零电阻，后续只需计数，不再计算倒数以节省开销
                inverseRSum += 1 / r;
            }
            resistorCount++;
        };

        // 内部辅助函数：判断两个端点是否分别属于 A/B 两个簇
        const isBridge = (p1, p2) => (clusterA.has(p1) && clusterB.has(p2)) || (clusterB.has(p1) && clusterA.has(p2));

        for (const dev of rawDevices) {
            const { id, type, special } = dev;

            // 1. 处理基础电阻/继电器/热电偶
            if (type === 'resistor' || (type === 'relay' && special === 'voltage') || type === 'tc') {
                const left = `${id}_wire_l`;
                const right = `${id}_wire_r`;

                let inAB = isBridge(left, right);

                // PT100 三线制特殊逻辑
                if (!inAB && special === 'pt100') {
                    const top = `${id}_wire_t`;
                    inAB = isBridge(left, top);
                }

                if (inAB) processResistor(dev.currentResistance);
                continue; // 处理完后跳过当前循环
            }

            // 2. 处理压力传感器
            if (type === 'pressure_sensor') {
                if (isBridge(`${id}_wire_r1l`, `${id}_wire_r1r`)) processResistor(dev.r1);
                if (isBridge(`${id}_wire_r2l`, `${id}_wire_r2r`)) processResistor(dev.r2);
                continue;
            }

            // 3. 处理 CAN 总线与 DO 模块 (CAN 特殊处理)
            if (special === 'can') {
                if (isBridge(`${id}_wire_can1p`, `${id}_wire_can1n`)) {
                    processResistor(dev.currentResistance);
                }
                if (type === 'DO') {
                    if (isBridge(`${id}_wire_ch1p`, `${id}_wire_ch1n`)) processResistor(dev.ch1R);
                    if (isBridge(`${id}_wire_ch2p`, `${id}_wire_ch2n`)) processResistor(dev.ch2R);
                }
                continue;
            }

            // 4. 处理校验仪 (模拟电阻输出)
            if (type === 'calibrator' && (dev.sourceMode === 'SRC_RES' || dev.sourceMode === 'SRC_RTD')) {
                if (isBridge(`${id}_wire_src_v`, `${id}_wire_src_com`)) {
                    const R = dev.sourceMode === 'SRC_RES'
                        ? dev.sourceValue
                        : dev._tempToRTDOhm(dev.sourceValue);
                    processResistor(R);
                }
            }
        }

        if (hasZeroResistor) return { totalR: 0, count: resistorCount };
        if (resistorCount === 0) return { totalR: Infinity, count: 0 };

        return { totalR: 1 / inverseRSum, count: resistorCount };
    },

    /**
     * 辅助7：变送器目标电流计算
     */
    /**
     * 计算变送器输出电流 (4-20mA 标准信号)
     * @param {Object} dev 变送器设备对象
     * @param {Map} portToCluster 端口到节点簇的映射
     * @param {Map} nodeVoltages 节点电压数据
     * @param {Array} rawDevices 所有原始设备列表
     */
    calcTransmitterCurrent(dev, portToCluster, nodeVoltages, rawDevices) {
        // 1. 基础状态检查：如果变送器本身损坏/断开，返回 0mA
        if (dev.isBreak) return 0;

        // 通用的 4-20mA 校准转换逻辑
        const applyCalibration = (percent) => {
            const iRaw = 16 * percent + 4; // 理想电流 (mA)
            // 应用零点校准 (zeroAdj) 和 量程校准 (spanAdj)
            const iFix = (iRaw - 4) *(dev.spanAdj===undefined?1:dev.spanAdj) + 4 + (dev.zeroAdj===undefined?0:dev.zeroAdj);
            // 限制在标准工业范围内：3.8mA (下限) 到 20.5mA (上限)
            // 并转换为安培 (A)
            return Math.max(3.8, Math.min(20.5, iFix)) / 1000;
        };

        const { id, special } = dev;

        // --- 分类处理不同类型的变送器 ---

        // A. 温度变送器 (通常接入 PT100 信号)
        if (special === 'temp') {
            const cL = portToCluster.get(`${id}_wire_l`);
            const cM = portToCluster.get(`${id}_wire_m`);
            const cR = portToCluster.get(`${id}_wire_r`);

            // 故障判断逻辑：若端子未连接或三线制接线错误 (M/R 必须短接)，输出 21.6mA 报警电流
            if (cL === undefined || cM === undefined || cR === undefined || cM !== cR) {
                return 0.0216;
            }
            // 如果三线全部短接，视为短路故障，输出 3.6mA
            if (cM === cL) return 0.0036;

            // 查找与该变送器输入端并联的电阻 (PT100 阻值)
            let R = 10000000; // 默认无穷大
            for (const r of rawDevices) {
                if (r.type !== 'resistor') continue;
                const rL = portToCluster.get(`${r.id}_wire_l`);
                const rR = portToCluster.get(`${r.id}_wire_r`);
                // 判断电阻是否跨接在变送器的输入端 (L-R 之间)
                if ((rL === cL && rR === cR) || (rL === cR && rR === cL)) {
                    R = r.currentResistance;
                    break; // 找到即止
                }
            }

            // PT100 转换公式：(R - 100) / 0.3851 得到摄氏度
            // 注意：此处假设变送器量程为 0-100℃（对应 100Ω-138.51Ω），percent 为 (R-100)/38.51
            const percent = (R - 100) / 38.51;
            return applyCalibration(percent);
        }

        // B. 压力 / 差压变送器
        if (special === 'press' || special === 'diff') {
            const percent = (dev.press - dev.min) / (dev.max - dev.min);
            return applyCalibration(percent);
        }

        // C. 电压信号变送器 (如毫伏转 4-20mA)
       if (special === 'voltage') {
            const getV = (pId) => {
                const cIdx = portToCluster.get(pId);
                return cIdx !== undefined ? (nodeVoltages.get(cIdx) || 0) : 0;
            };
            // 计算两端压差 (mV)
            dev.voltage = (getV(`${id}_wire_l`) - getV(`${id}_wire_r`)) * 1000;
            const percent = (Math.abs(dev.voltage) - dev.min) / (dev.max - dev.min);
            return applyCalibration(percent);
        }

        // D. 气泡式液位计 (吹气法)
        if (special === 'bubble_level') {
            // 根据液体密度和高度计算最大背压 P = ρgh
            const backPressMax = 9.81 * dev.tankHeight;
            const percent = dev.backPress / backPressMax;
            return applyCalibration(percent);
        }
        // 差压式，直接给出水位
        if(special ==='diff_level'){
            const percent = dev.level/100;
            return applyCalibration(percent);
        }

        return 0; // 默认不输出电流
    },
};
