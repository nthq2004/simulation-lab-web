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
     * 同时支持电阻小于1欧姆也视为直接相连
     * @param {string} pA 端口A
     * @param {string} pB 端口B
     * @param {Map} portToCluster 端口到集群的映射
     * @param {Set[]} allClusters 所有集群数组（可选，用于计算等效电阻）
     * @param {object[]} rawDevices 原始器件数组（可选，用于计算等效电阻）
     * @param {Map} equivResCache 等效电阻缓存（可选）
     * @returns {boolean} 两端口是否直接相连
     */
    isPortConnected(pA, pB, portToCluster, allClusters, rawDevices, equivResCache) {
        // 第一步：检查是否在同一集群（直接导线相连）
        const idxA = portToCluster.get(pA);
        const idxB = portToCluster.get(pB);
        if (idxA !== undefined && idxB !== undefined && idxA === idxB) {
            return true;
        }

        // 第二步：如果参数完整，检查等效电阻是否小于1欧姆
        if (allClusters && rawDevices && idxA !== undefined && idxB !== undefined) {
            const clusterA = allClusters[idxA];
            const clusterB = allClusters[idxB];
            if (clusterA && clusterB) {
                const eqRes = this.getEquivalentResistance(clusterA, clusterB, allClusters, rawDevices, portToCluster, equivResCache);
                if (eqRes < 1) {
                    return true;
                }
            }
        }

        return false;
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
                const R = Number.isFinite(resistance) ? resistance : 1e9;
                resistorList.push({ l: lIdx, r: rIdx, R });
                return true;
            }
            return false;
        };

        for (const dev of rawDevices) {
            const { id, type, special } = dev;

            // 1. 处理标准两线电阻类元件 (包括热电偶 tc、电压型继电器 relay)
            if (type === 'resistor' || type === 'tc' || (type === 'relay' && special === 'voltage') || (type === 'relay' && special === 'REV-POWER')) {
                let rIdx = portToCluster.get(`${id}_wire_r`);

                // 特殊逻辑：PT100 三线制，如果 R 端没接，尝试查找 T 端
                if (special === 'pt100' && rIdx === undefined) {
                    rIdx = portToCluster.get(`${id}_wire_t`);
                }

                const lIdx = portToCluster.get(`${id}_wire_l`);
                if (lIdx !== undefined && rIdx !== undefined) {
                    const Rval = dev.currentResistance ?? 1e9;
                    const R = Number.isFinite(Rval) ? Rval : 1e9;
                    resistorList.push({ l: lIdx, r: rIdx, R });
                }
                if (type === 'relay' && special === 'voltage') {
                    const NOIdx = portToCluster.get(`${id}_wire_NO`);
                    const COMIdx = portToCluster.get(`${id}_wire_COM`);
                    const contactResRaw = (dev.isEnergized && dev.contactFault === false) ? 0.01 : 1e9;
                    const contactRes = Number.isFinite(contactResRaw) ? contactResRaw : 1e9;
                    if (NOIdx !== undefined && COMIdx !== undefined) {
                        resistorList.push({
                            l: NOIdx,
                            r: COMIdx,
                            R: contactRes
                        });
                    }
                }
                if (type === 'relay' && special === 'REV-POWER') {
                    const tripped = dev._state === 'tripped';
                    const COMIdx = portToCluster.get(`${id}_wire_COM`);
                    const NCIdx = portToCluster.get(`${id}_wire_NC`);
                    const NOIdx = portToCluster.get(`${id}_wire_NO`);
                    if (COMIdx !== undefined && NCIdx !== undefined) {
                        resistorList.push({ l: COMIdx, r: NCIdx, R: tripped ? 1e9 : 0.01 });
                    }
                    if (COMIdx !== undefined && NOIdx !== undefined) {
                        resistorList.push({ l: COMIdx, r: NOIdx, R: tripped ? 0.01 : 1e9 });
                    }
                }
                if (special === 'oilheater') {
                    const pIdx = portToCluster.get(`${id}_wire_p`);
                    const nIdx = portToCluster.get(`${id}_wire_n`);
                    if (pIdx !== undefined && nIdx !== undefined) {
                        resistorList.push({
                            l: pIdx,
                            r: nIdx,
                            R: 250
                        });
                    }
                }
                continue;
            }

            // 1.5 接触器/继电器触点（主触头、常开/常闭辅助触点、接触器线圈）
            //     接触不良一律按断路处理（填 1e12Ω），与 DeviceStamps 的 stamp 层保持一致
            if (type === 'ContactorDevice') {
                if (special === 'maincontacts') {
                    const v = dev.getValue();
                    addResistor(`${id}_wire_l1`, `${id}_wire_t1`, (dev._faultOpenPoles && dev._faultOpenPoles.l1) ? 1e12 : v);
                    addResistor(`${id}_wire_l2`, `${id}_wire_t2`, (dev._faultOpenPoles && dev._faultOpenPoles.l2) ? 1e12 : v);
                    addResistor(`${id}_wire_l3`, `${id}_wire_t3`, (dev._faultOpenPoles && dev._faultOpenPoles.l3) ? 1e12 : v);
                } else if (special === 'nocontact') {
                    addResistor(`${id}_wire_com`, `${id}_wire_no`,
                        (dev._faultOpen || dev._faultOpenEnd) ? 1e12 : dev.getValue());
                } else if (special === 'nccontact') {
                    addResistor(`${id}_wire_com`, `${id}_wire_nc`, dev.getValue());
                } else if (special === 'contactcoil') {
                    addResistor(`${id}_wire_a1`, `${id}_wire_a2`,
                        dev._faultCoilOpen ? 1e12 : (dev._coilResistance || 1000));
                }
                continue;
            }

            // 1.6 按钮（起动/停止）：按 MNA stamp 的触点通断值，故障（_faultOpen）按断路处理
            if (type === 'PUSHBUTTON') {
                if (special === 'START-BTN') {
                    addResistor(`${id}_wire_no1`, `${id}_wire_no2`, dev._faultOpen ? 1e12 : dev.getValue());
                } else if (special === 'STOP-BTN') {
                    addResistor(`${id}_wire_nc3`, `${id}_wire_nc4`, dev._faultOpen ? 1e12 : dev.getValue());
                }
                continue;
            }

            // 1.7 熔断器：正常 0.01Ω，熔断 1e9Ω
            if (type === '1p-fuse') {
                addResistor(`${id}_wire_l`, `${id}_wire_t`,
                    dev.getState && dev.getState() === 'ok' ? 0.01 : 1e9);
                continue;
            }

            // 1.8 空气断路器（ACB）：合闸 0.001Ω，分闸 1e9Ω
            if (type === 'ACB') {
                const R = (dev._state === 'on') ? 0.001 : 1e9;
                addResistor(`${id}_wire_l1`, `${id}_wire_t1`, R);
                addResistor(`${id}_wire_l2`, `${id}_wire_t2`, R);
                addResistor(`${id}_wire_l3`, `${id}_wire_t3`, R);
                continue;
            }

            // 1.8b 三相配电箱（PDB）：进线=汇流排节点，闭合 0.01Ω；分励线圈恒 200Ω
            if (type === 'PDB') {
                const R = (dev.getSwState(0) === 'on') ? 0.01 : 1e9;
                for (let s = 1; s <= 3; s++) {
                    const Rs = (dev.getSwState(s - 1) === 'on') ? 0.01 : 1e9;
                    for (let ph = 1; ph <= 3; ph++) {
                        addResistor(`${id}_wire_in${ph}`, `${id}_wire_sw${s}_t${ph}`, Rs);
                    }
                    const Rcoil = dev.getTripCoilR ? dev.getTripCoilR() : 200;
                    addResistor(`${id}_wire_sw${s}_fla`, `${id}_wire_sw${s}_flb`, Rcoil);
                }
                void R;
                continue;
            }

            // 1.9 控制变压器：一次/二次绕组直流电阻（铜损电阻）
            if (type === 'control_transformer') {
                addResistor(`${id}_wire_p1`, `${id}_wire_p2`, dev._primaryResistance || 20);
                addResistor(`${id}_wire_s1`, `${id}_wire_s2`, dev._secondaryResistance || 0.3);
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

            // 5. 处理 MF47 万用表等效内阻
            if (type === 'mf47') {
                const Rdev = dev.getInputImpedance();
                const group = dev._range?.group;
                if (group === 'DCmA') {
                    addResistor(`${id}_wire_mA`, `${id}_wire_COM`, Rdev);
                } else {
                    addResistor(`${id}_wire_v`, `${id}_wire_COM`, Rdev);
                }
            }

            // 6. 三相异步电动机：各相对 PE 绝缘电阻
            if (type === 'MOTOR') {
                addResistor(`${id}_wire_l1`, `${id}_wire_pe`, dev.uohm ?? 20e6);
                addResistor(`${id}_wire_l2`, `${id}_wire_pe`, dev.vohm ?? 20e6);
                addResistor(`${id}_wire_l3`, `${id}_wire_pe`, dev.wohm ?? 20e6);
            }

            // 6.1 感应电机（induction_motor）：三相绕组直流电阻（供万用表电阻档测量）
            if (type === 'induction_motor') {
                const rW = (dev.R1 || 0.5) + (dev.R2 || 0.46);
                addResistor(`${id}_wire_u1`, `${id}_wire_u2`, rW);
                addResistor(`${id}_wire_v1`, `${id}_wire_v2`, rW);
                addResistor(`${id}_wire_w1`, `${id}_wire_w2`, rW);
                continue;
            }

            // 7.5 TRIAC 双向晶闸管
            if (type === 'triac') {
                let mtR;
                if (dev._faultMTShort) {
                    mtR = 1;
                } else {
                    mtR = dev._triggered ? (dev.rOnDisp || 50) : (dev.rOff || 1e6);
                }
                addResistor(`${id}_wire_mt2`, `${id}_wire_mt1`, mtR);
                if (dev._faultGateOpen) {
                    addResistor(`${id}_wire_g`, `${id}_wire_mt1`, 1e12);
                } else {
                    addResistor(`${id}_wire_g`, `${id}_wire_mt1`, dev.rGOff || 1e8);
                }
            }

            // 7.6 荧光灯管（4 端口电阻网络）
            if (type === 'fluorescent_lamp') {
                const isOn = dev._state === 'on';
                const rFil = isOn ? 0.5 : (dev.filamentR || 200);
                const rGap = isOn ? (dev.gapOnR || 220) : 10e6;
                addResistor(`${id}_wire_left_a`, `${id}_wire_left_b`, rFil);
                addResistor(`${id}_wire_right_a`, `${id}_wire_right_b`, rFil);
                addResistor(`${id}_wire_left_b`, `${id}_wire_right_a`, rGap);
            }

            // 7.7 启辉器（可变电阻）
            if (type === 'starter') {
                const R = dev._state === 'closed' ? 0.01 : 5e6;
                addResistor(`${id}_wire_l`, `${id}_wire_r`, R);
            }

            // 7.8 镇流器（电感直流电阻分量）
            if (type === 'ballast') {
                addResistor(`${id}_wire_l`, `${id}_wire_r`, dev.resistance || 20);
            }

            // 7.9 热继电器（发热元件 + 常开/常闭触点）
            if (type === 'ThermalRelayDevice') {
                if (special === 'heatelement') {
                    addResistor(`${id}_wire_l1`, `${id}_wire_t1`, dev.getValue());
                    addResistor(`${id}_wire_l2`, `${id}_wire_t2`, dev.getValue());
                    addResistor(`${id}_wire_l3`, `${id}_wire_t3`, dev.getValue());
                } else if (special === 'nccontact') {
                    addResistor(`${id}_wire_com`, `${id}_wire_nc`, dev.getValue());
                } else if (special === 'nocontact') {
                    addResistor(`${id}_wire_com`, `${id}_wire_no`, dev.getValue());
                }
            }

            // 7. SCR 晶闸管（使用 rOnDisp 供万用表电阻档显示）
            if (type === 'scr') {
                let akR;
                if (dev._faultAKShort) {
                    akR = 1;
                } else {
                    akR = dev._triggered ? (dev.rOnDisp || 100) : (dev.rOff || 1e6);
                }
                addResistor(`${id}_wire_a`, `${id}_wire_k`, akR);
                if (dev._faultGateOpen) {
                    addResistor(`${id}_wire_g`, `${id}_wire_k`, 1e12);
                } else {
                    addResistor(`${id}_wire_g`, `${id}_wire_k`, dev.gkROff || 1e8);
                }
            }

            // 7.5 IGBT
            if (type === 'igbt') {
                let ceR;
                if (dev._faultCEShort) {
                    ceR = 1;
                } else if (dev._faultCEOpen) {
                    ceR = 1e10;
                } else {
                    ceR = dev._isOn ? (dev.rOnDisp || 50) : (dev.rOff || 1e6);
                }
                addResistor(`${id}_wire_c`, `${id}_wire_e`, ceR);
                addResistor(`${id}_wire_g`, `${id}_wire_e`, 1e8);
            }

            // 7.6 MOSFET
            if (type === 'mosfet') {
                let dsR;
                if (dev._faultDSShort) {
                    dsR = 1;
                } else if (dev._faultDSOpen) {
                    dsR = 1e10;
                } else {
                    dsR = dev._isOn ? (dev.rOnDisp || 30) : (dev.rOff || 1e6);
                }
                addResistor(`${id}_wire_d`, `${id}_wire_s`, dsR);
                addResistor(`${id}_wire_g`, `${id}_wire_s`, 1e8);
            }

            // 8. 交流电流表（0V 电压源）视为短路（0Ω），使等效电阻计算能穿过电流表
            if (special === 'AC_AMMETER') {
                addResistor(`${id}_wire_ap`, `${id}_wire_an`, 0);
            }

            // 9. 功率表电流线圈（0V 电压源）视为短路（0Ω）
            if (special === 'WATTMETER' || special === 'PFMETER' || special === 'REV-POWER') {
                addResistor(`${id}_wire_ip`, `${id}_wire_in`, 0);
            }
        }

        // 浮空检测：若 start 与 end 在电阻网络中不连通，则两点间无通路（返回 Infinity）
        // 例如接触不良端口（poorContact）使某段网络脱离主回路，gauss 会误算为 0
        {
            const par = new Map();
            const uFind = (i) => { const p = par.get(i); if (p === undefined || p === i) return i; const r = uFind(p); par.set(i, r); return r; };
            const uUnion = (a, b) => { const ra = uFind(a), rb = uFind(b); if (ra !== rb) par.set(ra, rb); };
            for (const re of resistorList) uUnion(re.l, re.r);
            if (uFind(startIdx) !== uFind(endIdx)) {
                if (equivResCache) equivResCache.set(cacheKey, Infinity);
                return Infinity;
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
                        if (re.R < 1e-9) { hasZero = true; break; }
                        inverseRSum += 1 / re.R;
                    }
                }
                let totalR = Infinity;
                if (hasZero) {
                    // 近似短路（R<0.01Ω）：直接用超大电导替代 1/0=Infinity，避免矩阵数值崩溃
                    totalR = 0;
                } else if (count > 0) {
                    totalR = 1 / inverseRSum;
                }

                if (totalR !== Infinity) {
                    const g = hasZero ? 1e9 : 1 / totalR;
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
            // 等效电阻应为非负有限值；负值或超量程视为开路（矩阵病态时可能出现）
            const out = (vA < 0 || vA > 1e9) ? Infinity : vA;
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
            const r = Number.isFinite(rValue) ? rValue : 1e9;
            if (r < 0.01) {
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
            if (type === 'resistor' || (type === 'relay' && special === 'voltage') || type === 'tc' || (type === 'relay' && special === 'REV-POWER')) {
                const left = `${id}_wire_l`;
                const right = `${id}_wire_r`;

                let inAB = isBridge(left, right);

                // PT100 三线制特殊逻辑
                if (!inAB && special === 'pt100') {
                    const top = `${id}_wire_t`;
                    inAB = isBridge(left, top);
                }

                if (inAB) processResistor(dev.currentResistance);

                if (special === 'oilheater') {
                    const pleft = `${id}_wire_p`;
                    const nright = `${id}_wire_n`;
                    let inPN = isBridge(pleft, nright);
                    if (inPN) processResistor(250);
                }
                if (type === 'relay' && special === 'voltage') {
                    const NOleft = `${id}_wire_NO`;
                    const COMright = `${id}_wire_COM`;
                    let inPN = isBridge(NOleft, COMright);
                    let R = 1e9;
                    R = (dev.isEnergized && dev.contactFault === false) ? 0.01 : 1e9;
                    if (inPN) processResistor(R);
                }
                if (type === 'relay' && special === 'REV-POWER') {
                    const tripped = dev._state === 'tripped';
                    const COMleft = `${id}_wire_COM`;
                    const NCright = `${id}_wire_NC`;
                    const NOright = `${id}_wire_NO`;
                    if (isBridge(COMleft, NCright)) processResistor(tripped ? 1e9 : 0.01);
                    if (isBridge(COMleft, NOright)) processResistor(tripped ? 0.01 : 1e9);
                }
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

            // 5. 处理 MF47 万用表等效内阻
            if (type === 'mf47') {
                const Rdev = dev.getInputImpedance();
                const group = dev._range?.group;
                if (group === 'DCmA') {
                    if (isBridge(`${id}_wire_mA`, `${id}_wire_COM`)) processResistor(Rdev);
                } else {
                    if (isBridge(`${id}_wire_v`, `${id}_wire_COM`)) processResistor(Rdev);
                }
            }

            // 5.5 TRIAC（使用 rOnDisp 供万用表电阻档显示）
            if (type === 'triac') {
                let mtR;
                if (dev._faultMTShort) {
                    mtR = 1;
                } else {
                    mtR = dev._triggered ? (dev.rOnDisp || 50) : (dev.rOff || 1e6);
                }
                if (isBridge(`${id}_wire_mt2`, `${id}_wire_mt1`)) processResistor(mtR);
                if (isBridge(`${id}_wire_g`, `${id}_wire_mt1`)) processResistor(dev._faultGateOpen ? 1e12 : (dev.rGOff || 1e8));
            }

            // 6. SCR 晶闸管（使用 rOnDisp 供万用表电阻档显示）
            if (type === 'scr') {
                let akR;
                if (dev._faultAKShort) {
                    akR = 1;
                } else {
                    akR = dev._triggered ? (dev.rOnDisp || 100) : (dev.rOff || 1e6);
                }
                if (isBridge(`${id}_wire_a`, `${id}_wire_k`)) processResistor(akR);
                if (isBridge(`${id}_wire_g`, `${id}_wire_k`)) processResistor(dev._faultGateOpen ? 1e12 : (dev.gkROff || 1e8));
            }

            // 6.5 IGBT（使用 rOnDisp 供万用表电阻档显示）
            if (type === 'igbt') {
                let ceR;
                if (dev._faultCEShort) {
                    ceR = 1;
                } else if (dev._faultCEOpen) {
                    ceR = 1e10;
                } else {
                    ceR = dev._isOn ? (dev.rOnDisp || 50) : (dev.rOff || 1e6);
                }
                if (isBridge(`${id}_wire_c`, `${id}_wire_e`)) processResistor(ceR);
                if (isBridge(`${id}_wire_g`, `${id}_wire_e`)) processResistor(1e8);
            }

            // 6.6 MOSFET（使用 rOnDisp 供万用表电阻档显示）
            if (type === 'mosfet') {
                let dsR;
                if (dev._faultDSShort) {
                    dsR = 1;
                } else if (dev._faultDSOpen) {
                    dsR = 1e10;
                } else {
                    dsR = dev._isOn ? (dev.rOnDisp || 30) : (dev.rOff || 1e6);
                }
                if (isBridge(`${id}_wire_d`, `${id}_wire_s`)) processResistor(dsR);
                if (isBridge(`${id}_wire_g`, `${id}_wire_s`)) processResistor(1e8);
            }

            // 7. 荧光灯管（4 端口模型简化：左右灯丝 + 间隙）
            if (type === 'fluorescent_lamp') {
                const isOn = dev._state === 'on';
                const rFil = isOn ? 0.5 : (dev.filamentR || 200);
                const rGap = isOn ? (dev.gapOnR || 220) : 10e6;
                if (isBridge(`${id}_wire_left_a`, `${id}_wire_left_b`)) processResistor(rFil);
                if (isBridge(`${id}_wire_right_a`, `${id}_wire_right_b`)) processResistor(rFil);
                if (isBridge(`${id}_wire_left_b`, `${id}_wire_right_a`)) processResistor(rGap);
            }

            // 8. 启辉器（可变电阻）
            if (type === 'starter') {
                const R = dev._state === 'closed' ? 0.01 : 5e6;
                if (isBridge(`${id}_wire_l`, `${id}_wire_r`)) processResistor(R);
            }

            // 9. 镇流器（电感 + 电阻）
            if (type === 'ballast') {
                if (isBridge(`${id}_wire_l`, `${id}_wire_r`)) processResistor(dev.resistance || 20);
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
            const iFix = (iRaw - 4) * (dev.spanAdj === undefined ? 1 : dev.spanAdj) + 4 + (dev.zeroAdj === undefined ? 0 : dev.zeroAdj);
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
        if (special === 'magnetic_flip_gauge') {
            return dev.outCurrent/1000;
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
        if (special === 'diff_level') {
            const percent = dev.level / 100;
            return applyCalibration(percent);
        }
        // NTC 热敏电阻式温度变送器
        // 电路结构：Vcc → Rseries(分压电阻) → NTC → GND
        // V_out 为 NTC 上的分压 = Vcc × R_ntc / (Rseries + R_ntc)
        // 因此：R_ntc = Rseries × V_out / (Vcc - V_out)
        if (special === 'ntc') {
            const getV = (pId) => {
                const cIdx = portToCluster.get(pId);
                return cIdx !== undefined ? (nodeVoltages.get(cIdx) || 0) : 0;
            };
            // 读取 NTC 两端的电压（分压值）
            const vOut = (getV(`${id}_wire_l`) - getV(`${id}_wire_r`));
            if (vOut < 0.001) return 0.0038; // 短路或未供电，输出 3.8mA

            // 通过分压公式反推 NTC 阻值
            const Rseries = dev.Rseries || 10000;
            const Vcc = dev.Vcc || 3.3;
            const Rntc = Rseries * vOut / (Vcc - vOut);

            // 通过 B 参数方程反算温度
            // R(T) = Rref × exp[B × (1/T - 1/Tref)]
            // → 1/T = 1/B × ln(R/Rref) + 1/Tref
            const B = dev.B || 3950;
            const Rref = dev.Rref || 10000;
            const Tref = 298.15; // 25°C
            const invT = 1/B * Math.log(Rntc / Rref) + 1/Tref;
            const temperature = 1 / invT - 273.15; // K → °C

            const percent = (temperature - dev.min) / (dev.max - dev.min);
            return applyCalibration(percent);
        }
        return 0; // 默认不输出电流
    },
};
