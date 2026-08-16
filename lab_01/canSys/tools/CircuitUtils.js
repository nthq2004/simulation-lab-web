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
     * 辅助1：从 results 向量或已知映射中获取 cluster 电压
     */
    getVoltageFromResults(results, nodeMap, gndClusterIndices, vPosMap, clusterIdx) {
        if (clusterIdx === undefined) return 0;
        if (gndClusterIndices.has(clusterIdx)) return 0;
        if (vPosMap.has(clusterIdx)) return vPosMap.get(clusterIdx);
        const mIdx = nodeMap.get(clusterIdx);
        return mIdx !== undefined ? results[mIdx] : 0;
    },

    /**
     * 辅助2：获取指定端口电压
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

        // 预计算电阻列表
        const resistorList = [];
        for (let k = 0; k < rawDevices.length; k++) {
            const dev = rawDevices[k];
            if (dev.type === 'resistor') {
                const lIdx = portToCluster.get(`${dev.id}_wire_l`);
                let rIdx = portToCluster.get(`${dev.id}_wire_r`);
                if (dev.special === 'pt100' && rIdx === undefined)
                    rIdx = portToCluster.get(`${dev.id}_wire_t`);
                if (lIdx !== undefined && rIdx !== undefined) {
                    const r = dev.currentResistance === undefined ? 1e9 : dev.currentResistance;
                    resistorList.push({ l: lIdx, r: rIdx, R: r });
                }
            }
            if (dev.type === 'pressure_sensor') {
                const r1lIdx = portToCluster.get(`${dev.id}_wire_r1l`);
                const r1rIdx = portToCluster.get(`${dev.id}_wire_r1r`);
                if (r1lIdx !== undefined && r1rIdx !== undefined)
                    resistorList.push({ l: r1lIdx, r: r1rIdx, R: dev.r1 === undefined ? 1e9 : dev.r1 });

                const r2lIdx = portToCluster.get(`${dev.id}_wire_r2l`);
                const r2rIdx = portToCluster.get(`${dev.id}_wire_r2r`);
                if (r2lIdx !== undefined && r2rIdx !== undefined)
                    resistorList.push({ l: r2lIdx, r: r2rIdx, R: dev.r2 === undefined ? 1e9 : dev.r2 });
            }
            if (dev.special === 'can') {
                const lIdx = portToCluster.get(`${dev.id}_wire_can1p`);
                const rIdx = portToCluster.get(`${dev.id}_wire_can1n`);
                if (lIdx !== undefined && rIdx !== undefined) {
                    const r = dev.currentResistance === undefined ? 1e9 : dev.currentResistance;
                    resistorList.push({ l: lIdx, r: rIdx, R: r });
                }
                const l2Idx = portToCluster.get(`${dev.id}_wire_can2p`);
                const r2Idx = portToCluster.get(`${dev.id}_wire_can2n`);
                if (l2Idx !== undefined && r2Idx !== undefined) {
                    const r = dev.currentResistance === undefined ? 1e9 : dev.currentResistance;
                    resistorList.push({ l: l2Idx, r: r2Idx, R: r });
                }
            }
            if (dev.type === 'relay' && dev.special === 'voltage') {
                const lIdx = portToCluster.get(`${dev.id}_wire_l`);
                const rIdx = portToCluster.get(`${dev.id}_wire_r`);
                if (lIdx !== undefined && rIdx !== undefined) {
                    const r = dev.currentResistance === undefined ? 1e9 : dev.currentResistance;
                    resistorList.push({ l: lIdx, r: rIdx, R: r });
                }
            }
            if (dev.type === 'tc') {
                const lIdx = portToCluster.get(`${dev.id}_wire_l`);
                const rIdx = portToCluster.get(`${dev.id}_wire_r`);
                if (lIdx !== undefined && rIdx !== undefined) {
                    const r = dev.currentResistance === undefined ? 1e9 : dev.currentResistance;
                    resistorList.push({ l: lIdx, r: rIdx, R: r });
                }
            }
            if (dev.type === 'calibrator') {
                const lIdx = portToCluster.get(`${dev.id}_wire_src_v`);
                const rIdx = portToCluster.get(`${dev.id}_wire_src_com`);
                let r = Infinity;
                if (lIdx !== undefined && rIdx !== undefined) {
                    if (dev.sourceMode === "SRC_RES" ) {
                        r = dev.sourceValue;

                    }else if(dev.sourceMode === "SRC_RTD") {
                        r = dev._tempToRTDOhm(dev.sourceValue);

                    }
                    resistorList.push({ l: lIdx, r: rIdx, R: r });
                }
            }
        }

        // 填充导纳矩阵
        for (let i = 0; i < allClusters.length; i++) {
            for (let j = i + 1; j < allClusters.length; j++) {
                let inverseRSum = 0, count = 0;
                let hasZero = false;
                for (const re of resistorList) {
                    if ((re.l === i && re.r === j) || (re.l === j && re.r === i)) {
                        count++;
                        if (re.R < 0.001) { hasZero = true; break; }
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

        let inverseRSum = 0, resistorCount = 0, hasZeroResistor = false;
        const processResistor = (rValue) => {
            const r = rValue === undefined ? 1e9 : rValue;
            if (r < 0.001) hasZeroResistor = true;
            else inverseRSum += 1 / r;
            resistorCount++;
        };

        rawDevices.forEach(dev => {
            if (dev.type === 'resistor' || (dev.type === 'relay' && dev.special === 'voltage')) {
                const p0InA = clusterA.has(`${dev.id}_wire_l`);
                let p1InB = clusterB.has(`${dev.id}_wire_r`);
                if (dev.special === 'pt100') p1InB = p1InB || clusterB.has(`${dev.id}_wire_t`);
                const p0InB = clusterB.has(`${dev.id}_wire_l`);
                let p1InA = clusterA.has(`${dev.id}_wire_r`);
                if (dev.special === 'pt100') p1InA = p1InA || clusterA.has(`${dev.id}_wire_t`);

                if ((p0InA && p1InB) || (p0InB && p1InA)) processResistor(dev.currentResistance);
            }
            if (dev.type === 'pressure_sensor') {
                const pairs = [
                    [`${dev.id}_wire_r1l`, `${dev.id}_wire_r1r`, dev.r1],
                    [`${dev.id}_wire_r2l`, `${dev.id}_wire_r2r`, dev.r2],
                ];
                pairs.forEach(([pl, pr, rv]) => {
                    const inAB = (clusterA.has(pl) && clusterB.has(pr)) || (clusterB.has(pl) && clusterA.has(pr));
                    if (inAB) processResistor(rv);
                });
            }
            if (dev.type === 'tc') {
                const inAB = (clusterA.has(`${dev.id}_wire_l`) && clusterB.has(`${dev.id}_wire_r`)) ||
                    (clusterB.has(`${dev.id}_wire_l`) && clusterA.has(`${dev.id}_wire_r`));
                if (inAB) processResistor(dev.currentResistance);
            }
            if (dev.special === 'can') {
                const inAB = (clusterA.has(`${dev.id}_wire_can1p`) && clusterB.has(`${dev.id}_wire_can1n`)) ||
                    (clusterB.has(`${dev.id}_wire_can1p`) && clusterA.has(`${dev.id}_wire_can1n`));
                console.log(dev.id, inAB);
                if (inAB) processResistor(dev.currentResistance);
            }
            if (dev.type === 'calibrator' && (dev.sourceMode === 'SRC_RES' || dev.sourceMode === 'SRC_RTD')) {
                let R = Infinity;

                if (dev.sourceMode === 'SRC_RES') {
                    R = dev.sourceValue;
                } else if (dev.sourceMode === 'SRC_RTD') {
                    R = dev._tempToRTDOhm(dev.sourceValue);
                }
                const inAB = (clusterA.has(`${dev.id}_wire_src_v`) && clusterB.has(`${dev.id}_wire_src_com`)) ||
                    (clusterB.has(`${dev.id}_wire_src_v`) && clusterA.has(`${dev.id}_wire_src_com`));
                if (inAB) processResistor(R);
            }
        });

        if (hasZeroResistor) return { totalR: 0, count: resistorCount };
        if (resistorCount === 0) return { totalR: Infinity, count: 0 };
        return { totalR: 1 / inverseRSum, count: resistorCount };
    },

    /**
     * 辅助7：变送器目标电流计算
     */
    calcTransmitterCurrent(dev, portToCluster, nodeVoltages, rawDevices) {
        const resistorDevs = rawDevices.filter(d => d.type === 'resistor');
        if (dev.isBreak === true) return 0;

        if (dev.special === 'temp') {
            const cL = portToCluster.get(`${dev.id}_wire_l`);
            const cM = portToCluster.get(`${dev.id}_wire_m`);
            const cR = portToCluster.get(`${dev.id}_wire_r`);
            if (cL === undefined || cM === undefined || cR === undefined) return 0.0216;
            if (cM !== cR) return 0.0216;
            if (cM === cL && cM === cR) return 0.0036;

            let R = 10000000;
            resistorDevs.forEach(r => {
                const rL = portToCluster.get(`${r.id}_wire_l`);
                const rR = portToCluster.get(`${r.id}_wire_r`);
                if ((rL === cL && rR === cR) || (rL === cR && rR === cL)) R = r.currentResistance;
            });
            const iRaw = 16 * (R - 100) / 38.51 + 4;
            const iFix = (iRaw - 4) * dev.spanAdj + 4 + dev.zeroAdj;
            return Math.max(0.0038, Math.min(0.0205, iFix / 1000));

        } else if (dev.special === 'press' || dev.special === 'diff') {
            const percent = (dev.press - dev.min) / (dev.max - dev.min);
            const iRaw = 16 * percent + 4;
            const iFix = (iRaw - 4) * dev.spanAdj + 4 + dev.zeroAdj;
            return Math.max(0.0038, Math.min(0.0205, iFix / 1000));

        } else if (dev.special === 'voltage') {
            const getV = (pId) => {
                const cIdx = portToCluster.get(pId);
                return cIdx !== undefined ? (nodeVoltages.get(cIdx) || 0) : 0;
            };
            dev.voltage = (getV(`${dev.id}_wire_l`) - getV(`${dev.id}_wire_r`)) * 1000;
            const percent = (Math.abs(dev.voltage) - dev.min) / (dev.max - dev.min);
            const iRaw = 16 * percent + 4;
            const iFix = (iRaw - 4) * dev.spanAdj + 4 + dev.zeroAdj;
            return Math.max(0.0038, Math.min(0.0205, iFix / 1000));
        }
    },
};
