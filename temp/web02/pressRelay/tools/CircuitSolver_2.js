/**
 * 电路求解类 V4.0 - 集成仪表自动更新功能
 */
export class CircuitSolver {
    constructor(devices) {
        this.rawDevices = devices;
        this.portToCluster = new Map();
        this.nodeVoltages = new Map();
        this.clusters = [];
        this.clusterCount = 0;
        this.gndClusterIndices = new Set();
        this.vPosMap = new Map();

        // --- 性能优化预分配 ---
        this.parent = {}; // 避免 buildTopology 每次创建新对象
        this.nodeMap = new Map();

        // 预定义常用的后缀字符串，避免反复拼接生成临时字符串
        this.suffixes = ['_l', '_m', '_r', '_p', '_n', '_v', '_ma', '_com', '_COM', '_NO', '_pi1', '_ni1', '_po1', '_no1', '_po2', '_no2', '_vcc', '_gnd', '_OUT'];
        this.portCache = new Map(); // 缓存生成的端口 ID
    }

    // 获取缓存的端口 ID 字符串，减少 GC 压力
    _getPortId(deviceId, sfx) {
        let cache = this.portCache.get(deviceId);
        if (!cache) {
            cache = {};
            this.portCache.set(deviceId, cache);
        }
        if (!cache[sfx]) cache[sfx] = `${deviceId}_wire${sfx}`;
        return cache[sfx];
    }
    _getDevicePorts(id) {
        // 优化：只返回当前电路中存在的端口
        const ports = [];
        for (let i = 0; i < this.suffixes.length; i++) {
            const p = this._getPortId(id, this.suffixes[i]);
            if (this.portToCluster.has(p)) ports.push(p);
        }
        return ports;
    }
    update(conns) {
        // 1. 重置状态 (使用 clear 保持引用，避免分配新内存)
        this.portToCluster.clear();
        this.nodeVoltages.clear();
        this.gndClusterIndices.clear();
        this.vPosMap.clear();
        this.nodeMap.clear();
        this.clusters.length = 0;
        for (let key in this.parent) delete this.parent[key];

        this.connections = conns; // 移除 filter(wire)，建议在外部提前过滤或内部逻辑判断

        this._buildTopology();
        this._solve();
        this._updateInstruments();
    }
    /**
     * 1. 拓扑构建 (并查集 + 零电阻桥接)
     */
    _buildTopology() {
        const parent = this.parent;
        const find = (i) => (parent[i] === undefined || parent[i] === i) ? i : (parent[i] = find(parent[i]));
        const union = (i, j) => {
            const rI = find(i), rJ = find(j);
            if (rI !== rJ) parent[rI] = rJ;
        };

        const allPorts = new Set();

        // 批量处理连接
        const conns = this.connections;
        for (let i = 0; i < conns.length; i++) {
            const c = conns[i];
            if (c.type !== 'wire') continue;
            allPorts.add(c.from);
            allPorts.add(c.to);
            union(c.from, c.to);
        }

        // 批量处理设备内部桥接
        const devs = this.rawDevices;
        for (let i = 0; i < devs.length; i++) {
            const dev = devs[i];
            const id = dev.id;

            // 确保所有端口都在 Set 中
            for (let s = 0; s < 18; s++) { // 只检查常用前10个后缀
                allPorts.add(this._getPortId(id, this.suffixes[s]));
            }

            if (dev.type === 'switch' && !dev.isOpen) union(this._getPortId(id, '_l'), this._getPortId(id, '_r'));
            else if (dev.type === 'ampmeter') union(this._getPortId(id, '_p'), this._getPortId(id, '_n'));
            else if (dev.type === 'multimeter' && dev.mode === 'MA') union(this._getPortId(id, '_ma'), this._getPortId(id, '_com'));
            else if (dev.currentResistance < 0.001) union(this._getPortId(id, '_l'), this._getPortId(id, '_r'));
            else if (dev.type === 'relay' && dev.isEnergized) union(this._getPortId(dev.id, '_NO'), this._getPortId(dev.id, '_COM'));
        }

        // 3. 构建 Cluster 映射
        const clusterIndex = new Map();
        let idx = 0;
        const clusterMap = {};

        allPorts.forEach(p => {
            const root = find(p);
            let cIdx = clusterIndex.get(root);
            if (cIdx === undefined) {
                cIdx = idx++;
                clusterIndex.set(root, cIdx);
                clusterMap[root] = new Set();
            }
            this.portToCluster.set(p, cIdx);
            clusterMap[root].add(p);
        });

        this.clusterCount = idx;
        this.clusters = Object.values(clusterMap);
    }

    /**
     * 2. 核心求解 (节点电压法)
     */
    _solve() {
        const powerDevs = this.rawDevices.filter(d => d.type === 'source');
        if (powerDevs.length === 0) return;
        const pidDevs = this.rawDevices.filter(d => d.type === 'PID');
        const opAmps = this.rawDevices.filter(d => d.type === 'amplifier');
        // 1. 预处理电源和 GND
        for (let i = 0; i < powerDevs.length; i++) {
            const p = powerDevs[i];
            const pId = this._getPortId(p.id, '_p'), nId = this._getPortId(p.id, '_n');
            const pC = this.portToCluster.get(pId), nC = this.portToCluster.get(nId);
            if (nC !== undefined) this.gndClusterIndices.add(nC);
            if (pC !== undefined) this.vPosMap.set(pC, p.getValue());
        }

        const nodeMap = new Map();
        let mSize = 0;
        for (let i = 0; i < this.clusterCount; i++) {
            if (!this.gndClusterIndices.has(i) && !this.vPosMap.has(i)) nodeMap.set(i, mSize++);
        }

        if (mSize === 0) { this._assignKnown(); return; }
        // 2. 统计额外的电压源方程数量 (PID 的 pi1 配电端 和 PWM 输出端)
        let extraEqCount = 0;
        pidDevs.forEach(pid => {
            if (this.portToCluster.has(this._getPortId(pid.id, '_pi1'))) extraEqCount++;
            if (pid.outModes.CH1 === 'PWM' && this.portToCluster.has(this._getPortId(pid.id, '_po1'))) extraEqCount++;
            if (pid.outModes.CH2 === 'PWM' && this.portToCluster.has(this._getPortId(pid.id, '_po2'))) extraEqCount++;
        });
        opAmps.forEach(() => extraEqCount++);

        const totalSize = mSize + extraEqCount;
        const G = Array.from({ length: totalSize }, () => new Float64Array(totalSize));
        const B = new Float64Array(totalSize);
        let currentVSourceIdx = mSize; // 额外方程起始索引

        // 3. 填充普通线性电阻
        this.rawDevices.forEach(dev => {
            if (['source', 'transmitter_2wire', 'PID'].includes(dev.type) || dev.currentResistance < 0.001) return;
            const c1 = this.portToCluster.get(this._getPortId(dev.id, '_l'));
            const c2 = this.portToCluster.get(this._getPortId(dev.id, '_r'));
            let devResistance = 1000000000;
            if (dev.currentResistance !== undefined) devResistance = dev.currentResistance;
            if (c1 !== undefined && c2 !== undefined) {
                this._fillMatrix(G, B, nodeMap, c1, c2, 1 / devResistance);
            }
        });

        // 4. 【核心修复】变送器作为受控电阻注入
        this.rawDevices.filter(d => d.type === 'transmitter_2wire').forEach(dev => {
            const cP = this.portToCluster.get(this._getPortId(dev.id, '_p'));
            const cN = this.portToCluster.get(this._getPortId(dev.id, '_l'));
            if (cP === undefined || cN === undefined) return;

            // 获取当前压差（P减N）
            const lastV = dev._lastVDiff !== undefined ? dev._lastVDiff : 0;

            let dynamicG;

            // --- 关键修复：反向截止逻辑 ---
            if (lastV < 10) {
                // 电压小于10V（包括负电压），变送器不工作
                // 表现为极高电阻（1GΩ），电流接近0
                dynamicG = 1 / 1e9;
            } else {
                // 正常工作区间
                const targetI = this._calcTransmitterCurrent(dev);
                dynamicG = targetI / lastV;
            }

            // 阻尼处理，防止震荡
            if (dev._lastG === undefined) dev._lastG = dynamicG;
            dev._lastG = (dynamicG + dev._lastG) / 2;

            this._fillMatrix(G, B, nodeMap, cP, cN, dev._lastG);
        });

        // 5. 【新增】注入 PID 控制器        
        pidDevs.forEach(pid => {
            if (!pid.powerOn) {
                pid.ch1Current = 0;
                pid.ch2Current = 0;
                return;
            }

            // 5.1 4-20mA 输入回路: pi1(24V馈电) 和 ni(250Ω内阻)
            const cPi1 = this.portToCluster.get(this._getPortId(pid.id, '_pi1'));
            const cNi1 = this.portToCluster.get(this._getPortId(pid.id, '_ni1'));
            if (cPi1 !== undefined) {
                this._addVoltageSourceToMNA(G, B, nodeMap, cPi1, -1, 24.0, currentVSourceIdx++);
            }
            if (cNi1 !== undefined) {
                this._fillMatrix(G, B, nodeMap, cNi1, -1, 1 / 250); // 接地电阻
            }

            // 5.2 4-20mA 输出 / PWM 输出 (共用端子 po, no)
            const cPo1 = this.portToCluster.get(this._getPortId(pid.id, '_po1'));
            const cNo1 = this.portToCluster.get(this._getPortId(pid.id, '_no1'));
            if (cPo1 !== undefined && cNo1 !== undefined) {
                if (pid.outModes.CH1 === '4-20mA') {
                    this._addCurrentSourceToMNA(B, nodeMap, cPo1, cNo1, pid.output1mA / 1000);
                } else if (pid.outModes.CH1 === 'PWM') {
                    const cPo1 = this.portToCluster.get(this._getPortId(pid.id, '_po1'));
                    const cNo1 = this.portToCluster.get(this._getPortId(pid.id, '_no1'));

                    if (cPo1 !== undefined && cNo1 !== undefined) {

                        pid.ch1VSourceIdx = currentVSourceIdx;
                        // 获取输入 VCC 的实时电压（或者写死 24）
                        const vcc = this.getVoltageAtPort(`${p}vcc`) || 24;
                        // 瞬时电压：开启时为 VCC，关闭时为 0
                        const vTarget = pid.heatInstantOn ? vcc : 0;

                        this._addVoltageSourceToMNA(G, B, nodeMap, cPo1, cNo1, vTarget, currentVSourceIdx++);
                    }
                }
            }

            // 5.3 4-20mA 输出 / PWM 输出 (共用端子 po, no)
            const cPo2 = this.portToCluster.get(this._getPortId(pid.id, '_po2'));
            const cNo2 = this.portToCluster.get(this._getPortId(pid.id, '_no2'));
            if (cPo2 !== undefined && cNo2 !== undefined) {
                if (pid.outModes.CH2 === '4-20mA') {
                    this._addCurrentSourceToMNA(B, nodeMap, cPo2, cNo2, pid.output1mA / 1000);
                } else if (pid.outModes.CH2 === 'PWM') {
                    const cPo2 = this.portToCluster.get(this._getPortId(pid.id, '_po2'));
                    const cNo2 = this.portToCluster.get(this._getPortId(pid.id, '_no2'));
                    if (cPo2 !== undefined && cNo2 !== undefined) {
                        pid.ch2VSourceIdx = currentVSourceIdx;
                        const vcc = this.getVoltageAtPort(this._getPortId(pid.id, '_vcc')) || 24;
                        const vTarget = pid.coolInstantOn ? vcc : 0;

                        this._addVoltageSourceToMNA(G, B, nodeMap, cPo2, cNo2, vTarget, currentVSourceIdx++);
                    }
                }
            }
        });

        // 2. 【新增】注入运算放大器模型 (VCVS)
        opAmps.forEach(op => {
            const cP = this.portToCluster.get(this._getPortId(op.id, '_p'));  // 同相输入端
            const cN = this.portToCluster.get(this._getPortId(op.id, '_n'));  // 反相输入端
            const cOut = this.portToCluster.get(this._getPortId(op.id, '_OUT')); // 输出端

            if (cOut !== undefined) {
                // 运放方程: V(out) - Gain * V(p) + Gain * V(n) = 0
                // 对应 MNA 矩阵中的一行：
                // [..., -Gain, Gain, ..., 1, ...] * [..., Vp, Vn, ..., Vout, ...] = 0

                this._addOpAmpToMNA(G, B, nodeMap, cP, cN, cOut, op.gain, currentVSourceIdx++);

                // 记录索引用于回传输出电流（如果需要）
                op.vSourceIdx = currentVSourceIdx - 1;
            }
        });
        // 注入 GMIN 确保矩阵非奇异
        const GMIN = 1e-12; // 极小的电导，相当于 1TΩ 电阻，不影响计算精度
        for (let i = 0; i < totalSize; i++) {
            G[i][i] += GMIN;
        }

        // 4. 求解矩阵
        const results = this._gauss(G, B);
        this._assignKnown();
        nodeMap.forEach((mIdx, cIdx) => this.nodeVoltages.set(cIdx, results[mIdx]));

        // 5. 【关键】计算并缓存当前帧的压差，供下一帧使用
        this.rawDevices.filter(d => d.type === 'transmitter_2wire').forEach(dev => {
            const pV = this.getVoltageAtPort(this._getPortId(dev.id, '_p'));
            const nV = this.getVoltageAtPort(this._getPortId(dev.id, '_n'));
            dev._lastVDiff = pV - nV; // 存储压差
        });

        // --- 回传电流数据 ---
        pidDevs.forEach(pid => {
            if (pid.ch1VSourceIdx !== undefined) pid.ch1Current = results[pid.ch1VSourceIdx];
            if (pid.ch2VSourceIdx !== undefined) pid.ch2Current = results[pid.ch2VSourceIdx];
        });
    }
    _fillMatrix(G, B, nodeMap, c1, c2, g) {
        if (c1 === undefined || c2 === undefined) return; // 安全检查
        const get = (c) => {
            if (this.gndClusterIndices.has(c)) return { t: 'g' };
            if (this.vPosMap.has(c)) return { t: 'v', v: this.vPosMap.get(c) };
            const idx = nodeMap.get(c);
            if (idx === undefined) return { t: 'none' }; // 关键修复：处理孤立节点
            return { t: 'u', i: idx };
        };
        const n1 = get(c1), n2 = get(c2);
        if (n1.t === 'u') {
            G[n1.i][n1.i] += g;
            if (n2.t === 'u') G[n1.i][n2.i] -= g;
            else if (n2.t === 'v') B[n1.i] += g * n2.v;
        }
        if (n2.t === 'u') {
            G[n2.i][n2.i] += g;
            if (n1.t === 'u') G[n2.i][n1.i] -= g;
            else if (n1.t === 'v') B[n2.i] += g * n1.v;
        }
    }
    _assignKnown() {
        this.gndClusterIndices.forEach(idx => this.nodeVoltages.set(idx, 0));
        this.vPosMap.forEach((v, idx) => this.nodeVoltages.set(idx, v));
    }
    /**
         * 高性能 Gauss 消元 (In-place 减少内存分配)
         */
    _gauss(A, b) {
        const n = b.length;
        for (let i = 0; i < n; i++) {
            let pivotRow = i;
            let maxVal = Math.abs(A[i][i]);
            // 部分选主元（增加数值稳定性）
            for (let k = i + 1; k < n; k++) {
                if (Math.abs(A[k][i]) > maxVal) {
                    maxVal = Math.abs(A[k][i]);
                    pivotRow = k;
                }
            }
            if (maxVal < 1e-20) continue;

            // 交换行
            [A[i], A[pivotRow]] = [A[pivotRow], A[i]];
            [b[i], b[pivotRow]] = [b[pivotRow], b[i]];

            const pivot = A[i][i];
            for (let j = i + 1; j < n; j++) {
                const f = A[j][i] / pivot;
                b[j] -= f * b[i];
                const rowJ = A[j];
                const rowI = A[i];
                for (let k = i + 1; k < n; k++) rowJ[k] -= f * rowI[k];
            }
        }

        const x = new Float64Array(n);
        for (let i = n - 1; i >= 0; i--) {
            let s = 0;
            const rowI = A[i];
            for (let j = i + 1; j < n; j++) s += rowI[j] * x[j];
            x[i] = (b[i] - s) / rowI[i];
        }
        return x;
    }
    /**
     * 在 MNA 矩阵中添加电压源: V(c1) - V(c2) = voltage
     * 如果 c2 为 -1，则表示相对于 GND
     */
    _addVoltageSourceToMNA(G, B, nodeMap, c1, c2, voltage, vIdx) {
        const i = this.gndClusterIndices.has(c1) ? -1 : (this.vPosMap.has(c1) ? -2 : nodeMap.get(c1));
        const j = (c2 === -1 || this.gndClusterIndices.has(c2)) ? -1 : (this.vPosMap.has(c2) ? -2 : nodeMap.get(c2));

        // 填充结果向量
        let adjustedV = voltage;
        if (this.vPosMap.has(c1)) adjustedV -= this.vPosMap.get(c1);
        if (this.vPosMap.has(c2)) adjustedV += this.vPosMap.get(c2);
        B[vIdx] = adjustedV;

        // 填充 KCL 约束
        if (i >= 0) {
            G[vIdx][i] = 1;
            G[i][vIdx] = 1;
        }
        if (j >= 0) {
            G[vIdx][j] = -1;
            G[j][vIdx] = -1;
        }
    }

    /**
     * 在 MNA 矩阵中添加电流源: 从 cPos 流向 cNeg
     */
    _addCurrentSourceToMNA(B, nodeMap, cPos, cNeg, current) {
        const i = nodeMap.get(cPos);
        const j = nodeMap.get(cNeg);
        if (i !== undefined) B[i] += current;
        if (j !== undefined) B[j] -= current;
    }
    /**
     * 注入运算放大器方程: V(out) - Gain * (Vp - Vn) = 0
     * @param {Array} G 导纳矩阵
     * @param {Array} B 结果向量
     * @param {Map} nodeMap 节点映射
     * @param {number} cP 同相端 Cluster 索引
     * @param {number} cN 反相端 Cluster 索引
     * @param {number} cOut 输出端 Cluster 索引
     * @param {number} gain 增益
     * @param {number} vIdx 额外方程在矩阵中的行索引
     */
    _addOpAmpToMNA(G, B, nodeMap, cP, cN, cOut, gain, vIdx) {
        const p = this._getMatrixIdx(nodeMap, cP);
        const n = this._getMatrixIdx(nodeMap, cN);
        const out = this._getMatrixIdx(nodeMap, cOut);

        // 1. 填充 KCL：输出端注入未知电流 J
        if (out >= 0) {
            G[out][vIdx] = 1; // 在输出节点 KCL 中加入输出电流变量
        }

        // 2. 填充约束方程行: 1*Vout - Gain*Vp + Gain*Vn = 0
        if (out >= 0) G[vIdx][out] = 1;

        if (p >= 0) {
            G[vIdx][p] -= gain;
        } else if (this.vPosMap.has(cP)) {
            B[vIdx] += gain * this.vPosMap.get(cP);
        } // GND(p < 0) 时项为 0，不用处理

        if (n >= 0) {
            G[vIdx][n] += gain;
        } else if (this.vPosMap.has(cN)) {
            B[vIdx] -= gain * this.vPosMap.get(cN);
        }
    }

    // 辅助方法：获取矩阵索引（处理 GND 和已知电压源）
    _getMatrixIdx(nodeMap, clusterIdx) {
        if (clusterIdx === undefined || this.gndClusterIndices.has(clusterIdx)) return -1;
        if (this.vPosMap.has(clusterIdx)) return -2;
        return nodeMap.get(clusterIdx);
    }
    /**
    * 3. 更新仪表状态
    */
    _updateInstruments() {
        this.rawDevices.forEach(dev => {
            // 1. 电流表逻辑 (支持 ampmeter 和万用表 MA 档)
            if (dev.type === 'ampmeter' || (dev.type === 'multimeter' && dev.mode === 'MA')) {
                const pId = dev.type === 'ampmeter' ? this._getPortId(dev.id, '_p') : this._getPortId(dev.id, '_ma');
                const nId = dev.type === 'ampmeter' ? this._getPortId(dev.id, '_n') : this._getPortId(dev.id, '_com');
                const pIndex = this.portToCluster.get(pId);
                const nIndex = this.portToCluster.get(nId);
                if (pIndex <this.clusterCount || nIndex <this.clusterCount) {
                    dev.update(0);
                } else {
                    const current = this._calculateBranchCurrent(dev);
                    dev.update(current * 1000); // 调用组件内部的 update 方法刷新 UI
                }
            }

            // 2. 万用表逻辑
            if (dev.type === 'multimeter') {
                const mode = dev.mode || 'OFF';

                // 电压档
                if (mode.startsWith('DCV')) {
                    let diff = 0;
                    if (this.portToCluster.get(this._getPortId(dev.id, '_v')) <this.clusterCount && this.portToCluster.get(this._getPortId(dev.id, '_com')) <this.clusterCount) {
                        diff = this.getPD(this._getPortId(dev.id, '_v'), this._getPortId(dev.id, '_com'));
                        console.log(this.portToCluster.get(this._getPortId(dev.id, '_com')));
                        dev.update(diff);
                    }
                }
                // 电阻档 (利用你写的 _getEquivalentResistance)
                else if (mode.startsWith('RES')) {
                    const comNode = this._getPortId(dev.id, '_com');
                    const vNode = this._getPortId(dev.id, '_v');


                    // 寻找节点所属的集群
                    const comCluster = this.clusters.find(c => c.has(comNode));
                    const vCluster = this.clusters.find(c => c.has(vNode));

                    let R = Infinity;
                    if (comCluster && vCluster && Math.abs(this.getPD(vNode, comNode)) < 0.1) {
                        R = this._getEquivalentResistance(comCluster, vCluster, this.clusters);
                    }

                    // 如果是 Infinity，传递一个特定的大值代表 OL (Overload)
                    dev.update(R === Infinity ? 10000000 : R);
                }
                // 其他模式清零
                else if (['OFF', 'ACV', 'C'].includes(mode)) {
                    dev.update(0);
                }
            }
            if (dev.type === 'transmitter_2wire') {
                const cP = this.portToCluster.get(this._getPortId(dev.id, '_p'));
                const cN = this.portToCluster.get(this._getPortId(dev.id, '_n'));
                dev.update({ powered: dev._lastVDiff > 10 && cP !== undefined && cN !== undefined && dev.isOpened === false, transCurrent: this._calcTransmitterCurrent(dev) * 1000 });
            }

            if (dev.type === 'PID') {
                const inI = Math.abs(this.getVoltageAtPort(this._getPortId(dev.id, '_ni1')) / 250);
                dev.update(inI * 1000);
            }
        });
    }

    //辅助1：用于计算电流表/万用表电流档显示电流
    _calculateBranchCurrent(dev) { // 传入电流表设备对象
        let portP = this._getPortId(dev.id, '_p');
        let portN = this._getPortId(dev.id, '_n');
        if (dev.type === 'multimeter') {
            portP = this._getPortId(dev.id, '_ma');
            portN = this._getPortId(dev.id, '_com');
        }

        // 搜索时屏蔽掉当前的 dev.id
        const pFuncDevs = this._getConnectedFunctionalDevices(portP, dev.id);
        const nFuncDevs = this._getConnectedFunctionalDevices(portN, dev.id);

        const pHasSource = pFuncDevs.some(d => d.device.type === 'source' || d.extPort === `${d.device.id}_wire_pi1`);

        // 依然采用你的避开电源逻辑
        if (pHasSource) {
            let iInN = 0;
            nFuncDevs.forEach(item => {
                iInN += this._getPhysicalFlowIntoPort(item.device, item.extPort);
            });
            // 物理流向：如果电流从 N 端流出（iInN 为负），读数为正
            return -iInN;
        } else {
            let iInP = 0;
            pFuncDevs.forEach(item => {
                iInP += this._getPhysicalFlowIntoPort(item.device, item.extPort);
            });
            return iInP;
        }
    }
    /**
     * 辅助2：物理流向判定：计算电流从 extPort “流入” meterPort 的数值
     */
    _getPhysicalFlowIntoPort(dev, extPort) {
        let otherPort = null;

        // 情况 A：普通电阻或负载
        if (dev.currentResistance >= 0.001 && dev.type !== 'source') {
            if (extPort === this._getPortId(dev.id, '_l')) {
                otherPort = this._getPortId(dev.id, '_r');
            } else {
                otherPort = this._getPortId(dev.id, '_l');
            }
            // 电流 = (外部电位 - 仪表电位) / 电阻
            // 若 vExt > vMeter，结果为正，表示电流确实在流入仪表
            return this.getPD(otherPort, extPort) / dev.currentResistance;
        }

        // 情况 B：变送器 (2线制)
        if (dev.type === 'transmitter_2wire') {
            const i = (dev._lastVDiff > 10) ? (dev._lastVDiff * (dev._lastG || 0)) : 0;
            // 变送器电流永远从自身的 P 流向 N
            // 如果仪表接在变送器的 N 端，说明电流从变送器流出 -> 进入仪表 (流入)
            if (extPort.endsWith('_n')) return i;
            // 如果仪表接在变送器的 P 端，说明电流进入变送器 -> 离开仪表 (流出)
            if (extPort.endsWith('_p')) return -i;
        }
        // C. PID 控制器逻辑
        if (dev.type === 'PID') {
            if (extPort.endsWith('_po1') || extPort.endsWith('_no1')) {
                if (dev.outModes.CH1 === '4-20mA') {
                    // 1. 增加开路检测：检查 po1 和 no1 是否在同一个有效回路中
                    const cPo1 = this.portToCluster.get(this._getPortId(dev.id, '_po1'));
                    const cNo1 = this.portToCluster.get(this._getPortId(dev.id, '_no1'));

                    // 利用你已有的 _getEquivalentResistance 方法探测两者之间的电阻
                    const req = this._getEquivalentResistance(
                        this.clusters.find(c => c.has(this._getPortId(dev.id, '_po1'))),
                        this.clusters.find(c => c.has(this._getPortId(dev.id, '_no1'))),
                        this.clusters
                    );

                    // 2. 如果电阻是 Infinity (或远大于正常工业负载，如 > 100kΩ)，说明没连上
                    if (cPo1 === undefined || cNo1 === undefined || req > 100000) return 0;

                    // 3. 只有回路导通，才返回设定电流
                    const i = dev.output1mA / 1000;
                    return extPort.endsWith('_po1') ? i : -i;
                } else if (dev.outModes.CH1 === 'PWM') {
                    // 1. 获取两个端口对应的 Cluster
                    const cPo1 = this.portToCluster.get(this._getPortId(dev.id, '_po1'));
                    const cNo1 = this.portToCluster.get(this._getPortId(dev.id, '_no1'));

                    if (cPo1 === undefined || cNo1 === undefined) return 0;

                    const i = dev.ch1Current || 0;
                    return extPort.endsWith('_po1') ? -i : i;
                }
            }
            if (extPort.endsWith('_po2') || extPort.endsWith('_no2')) {
                if (dev.outModes.CH2 === '4-20mA') {
                    // 1. 增加开路检测：检查 po1 和 no1 是否在同一个有效回路中
                    const cPo2 = this.portToCluster.get(this._getPortId(dev.id, '_po2'));
                    const cNo2 = this.portToCluster.get(this._getPortId(dev.id, '_no2'));

                    // 利用你已有的 _getEquivalentResistance 方法探测两者之间的电阻
                    const req = this._getEquivalentResistance(
                        this.clusters.find(c => c.has(this._getPortId(dev.id, '_po2'))),
                        this.clusters.find(c => c.has(this._getPortId(dev.id, '_no2'))),
                        this.clusters
                    );

                    // 2. 如果电阻是 Infinity (或远大于正常工业负载，如 > 100kΩ)，说明没连上
                    if (cPo2 === undefined || cNo2 === undefined || req > 100000) return 0;

                    // 3. 只有回路导通，才返回设定电流
                    const i = dev.output2mA / 1000;
                    return extPort.endsWith('_po2') ? i : -i;
                } else if (dev.outModes.CH2 === 'PWM') {
                    // 1. 获取两个端口对应的 Cluster
                    const cPo2 = this.portToCluster.get(this._getPortId(dev.id, '_po2'));
                    const cNo2 = this.portToCluster.get(this._getPortId(dev.id, '_no2'));

                    if (cPo2 === undefined || cNo2 === undefined) return 0;

                    // 2. 定义流向：po1 流出为负，no1 流入为正
                    const i = dev.ch2Current || 0;
                    return extPort.endsWith('_po2') ? -i : i;
                }
            }
            // PID 输入端 ni
            // if (extPort.endsWith('_ni1')) return (0 - vExt) / 250;
            // --- pi1 馈电端逻辑 ---
            // pi1 是 24V 输出端，电流永远流出 PID (即流向外部)
            if (extPort.endsWith('_pi1') || extPort.endsWith('_ni1')) {
                // 这里是关键：pi1 的电流应该等于 ni1 (输入端) 的电流
                // 因为 pi1 给变送器供电，变送器电流最后回到 ni1
                const vNi = this.getVoltageAtPort(`${dev.id}_wire_ni1`);
                const iLoop = vNi / 250;
                return -iLoop; // 物理流向：从 pi1 流出，所以是负值
            }
        }
        return 0;
    }

    /**
     * 辅助3：寻找与电流表端口“物理意义上”直接挂载的所有功能设备
     */
    _getConnectedFunctionalDevices(meterPort, meterId) { // 传入当前电流表 ID
        const found = [];
        const visitedPorts = new Set();
        const queue = [meterPort];
        const processedZeroResDevs = new Set();

        while (queue.length > 0) {
            const curr = queue.shift();
            if (visitedPorts.has(curr)) continue;
            visitedPorts.add(curr);

            // 1. 导线链条追踪
            this.connections.forEach(conn => {
                let nextPort = null;
                if (conn.from === curr) nextPort = conn.to;
                else if (conn.to === curr) nextPort = conn.from;
                if (nextPort) queue.push(nextPort);
            });

            // 2. 穿透零电阻设备
            const devId = curr.split('_wire_')[0];
            const dev = this.rawDevices.find(d => d.id === devId);

            if (dev) {
                // --- 核心修复：禁止穿透正在进行测量的这个表 ---
                if (dev.id === meterId) {
                    // 如果搜到了自己的端口，记录下来但不允许从这个端口爬到另一个端口
                    continue;
                }

                // 识别功能性设备（终点）
                if (dev.currentResistance >= 0.001 || dev.type === 'source' || dev.type === 'transmitter_2wire' || dev.type === 'PID') {
                    found.push({ device: dev, extPort: curr });
                }

                // 穿透其它零电阻设备（如开关、其它电流表、继电器）
                if (!processedZeroResDevs.has(dev.id)) {
                    if (this._isZeroResistanceDevice(dev)) {
                        processedZeroResDevs.add(dev.id);
                        this._getDevicePorts(dev.id).forEach(p => queue.push(p));
                    }
                }
            }
        }
        return found;
    }

    /**
     * 辅助：判定是否为“零电阻”直通设备
     */
    _isZeroResistanceDevice(dev) {
        // 电流表两端
        if (dev.type === 'ampmeter' || (dev.type === 'multimeter' && dev.mode === 'MA')) return true;
        // 闭合的开关
        if (dev.type === 'switch' && !dev.isOpen) return true;
        // 闭合的继电器触点 (根据你的业务逻辑添加)
        if (dev.type === 'relay' && dev.isEnergized) return true;
        // 其他极小电阻
        if (dev.currentResistance < 0.001 && dev.type !== 'source') return true;

        return false;
    }

    // --- 工具方法 ---
    //辅助4：用于变送器电流测量，压控电流源也可放在这一部分。
    _calcTransmitterCurrent(dev) {

        if (dev.isOpened === true) return 0;
        const cL = this.portToCluster.get(this._getPortId(dev.id, '_l'));
        const cM = this.portToCluster.get(this._getPortId(dev.id, '_m'));
        const cR = this.portToCluster.get(this._getPortId(dev.id, '_r'));

        // 1. 硬件故障判断：优先级最高，直接返回固定特征电流
        if (cL === undefined || cM === undefined || cR === undefined) return 0.0216; // 未接线
        if (cM !== cR) return 0.0216; // PT100 感温元件开路
        if (cM === cL && cM === cR) return 0.0036; // PT100 短路

        // 2. 正常寻找匹配的 PT100 电阻
        let R = 10000000;
        this.rawDevices.filter(d => d.type === 'resistor').forEach(r => {
            const rL = this.portToCluster.get(this._getPortId(r.id, '_l'));
            const rR = this.portToCluster.get(this._getPortId(r.id, '_r'));
            if ((rL === cL && rR === cR) || (rL === cR && rR === cL)) {
                R = r.currentResistance;
            }
        });

        // 3. 计算电流 (4-20mA 对应 0-100度)
        // 假设 R=100Ω 是 0度 (4mA)，R=138.51Ω 是 100度 (20mA)

        const iRaw = 16 * (R - 100) / dev.rangeMax * 0.3851 + 4;
        const iFix = (iRaw * dev.spanAdj + dev.zeroAdj) / 1000;

        // 4. 饱和限制：即使温度超标，电流也只在 3.8mA - 20.5mA 之间波动
        // 只有发生上面第1步的“断路”才会跳到 21.6mA
        return Math.max(0.0038, Math.min(0.0205, iFix));
    }
    //辅助5：两个用于电压测量。
    getVoltageAtPort(pId) {
        const cIdx = this.portToCluster.get(pId);
        return cIdx !== undefined ? (this.nodeVoltages.get(cIdx) || 0) : 0;
    }
    getPD(pA, pB) {
        const aIdx = this.portToCluster.get(pA);
        const bIdx = this.portToCluster.get(pB);
        if (aIdx === undefined || bIdx === undefined) return 0;
        return this.getVoltageAtPort(pA) - this.getVoltageAtPort(pB);
    }

    //辅助6：用于电阻档测量。
    /* 改进方案：利用矩阵“试探法” (The Matrix Injection Method)不要手动去数路径，而是模拟万用表测量电阻的过程：在 A 节点注入 $1\text{A}$ 电流。将 B 节点设定为 GND ($0\text{V}$)。求解此时 A 节点的电压 $V_A$。根据欧姆定律 $R = V / I$，因为 $I=1$，所以 $R = V_A$。这种方法无论中间串了 3 个、10 个还是并联了复杂的电桥，都能算得准。 */
    _getEquivalentResistance(startCluster, endCluster, allClusters) {
        const startIdx = allClusters.indexOf(startCluster);
        const endIdx = allClusters.indexOf(endCluster);

        if (startIdx === -1 || endIdx === -1) return Infinity;
        if (startIdx === endIdx) return 0;

        // 1. 准备一个临时的节点地图（排除 B 节点，因为 B 是我们要设定的参考地）
        const nodeMap = new Map();
        let mSize = 0;
        for (let i = 0; i < allClusters.length; i++) {
            if (i !== endIdx) {
                nodeMap.set(i, mSize++);
            }
        }

        const G = Array.from({ length: mSize }, () => new Float64Array(mSize));
        const B = new Float64Array(mSize);

        // 2. 填充所有电阻电导
        for (let i = 0; i < allClusters.length; i++) {
            for (let j = i + 1; j < allClusters.length; j++) {
                const res = this._getParallelResistanceBetweenClusters(allClusters[i], allClusters[j]);
                if (res.count > 0 && res.totalR !== Infinity) {
                    const g = 1 / res.totalR;
                    // 这里的逻辑类似 _fillMatrix，但针对 endIdx 为地的情况
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

        // 3. 在 A 节点注入 1A 电流
        const aNodeIdx = nodeMap.get(startIdx);
        if (aNodeIdx === undefined) return Infinity; // A 到 B 完全不通
        B[aNodeIdx] = 1.0;

        // 4. 注入 GMIN 保证非奇异矩阵（防止悬空）
        for (let i = 0; i < mSize; i++) G[i][i] += 1e-15;

        // 5. 求解电压
        try {
            const results = this._gauss(G, B);
            const vA = results[aNodeIdx];

            // 如果算出来电压太大，说明电阻极大或断路
            return (vA > 1e9) ? Infinity : vA;
        } catch (e) {
            return Infinity;
        }
    }
    /**
    * 辅助计算两个等电位集群之间的总并联电阻
    * @param {Set} clusterA 节点集合 A
    * @param {Set} clusterB 节点集合 B
    * @returns {Object} { totalR: 数值, count: 电阻个数 }
    */
    _getParallelResistanceBetweenClusters(clusterA, clusterB) {
        let inverseRSum = 0;
        let resistorCount = 0;
        let hasZeroResistor = false;

        if (clusterA === clusterB) {
            return { totalR: 0, count: 0 };
        }
        this.rawDevices.forEach(dev => {
            // --- 逻辑 A：处理普通二端电阻 ---
            if (dev.type === 'resistor') {
                const p0InA = clusterA.has(this._getPortId(dev.id, '_l'));
                const p1InB = clusterB.has(this._getPortId(dev.id, '_r'));
                const p0InB = clusterB.has(this._getPortId(dev.id, '_l'));
                const p1InA = clusterA.has(this._getPortId(dev.id, '_r'));

                if ((p0InA && p1InB) || (p0InB && p1InA)) {
                    const r = dev.currentResistance;
                    if (r === undefined) r = 1e9;
                    if (r < 0.001) hasZeroResistor = true;
                    else inverseRSum += (1 / r);
                    resistorCount++;
                }
            }
        });
        // 逻辑处理
        if (hasZeroResistor) return { totalR: 0, count: resistorCount }; // 只要有一个0电阻并联，总电阻就是0
        if (resistorCount === 0) return { totalR: Infinity, count: 0 }; // 无连接，开路

        return {
            totalR: 1 / inverseRSum,
            count: resistorCount
        };
    }

}