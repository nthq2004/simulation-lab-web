/**
 * 电路求解类 V4.0 - 集成仪表自动更新功能
 */
export class CircuitSolver {
    constructor(sys) {
        this.sys = sys;
        this.deltaTime = 0.1 / 1000; // 0.1ms 步长,容纳40ms的波形。100Hz 4个波。
        // 0.01ms步长，容纳4ms的波形。1000Hz，4个波。
        // 0.001ms步长，容纳0.4ms的波形。10KHz，4个波。
        this.currentTime = 0;
        this.globalIterCount = 0;
        this.rawDevices = Object.values(sys.comps);
        this.portToCluster = new Map();
        this.nodeVoltages = new Map();
        this.clusters = [];
        this.clusterCount = 0;
        this.gndClusterIndices = new Set();
        this.vPosMap = new Map();
        // 可配置参数：用于诊断和数值稳定性保护
        this.debug = false;
        // 缓存：用于避免重复计算等效电阻（在拓扑未变时复用）
        this._equivResCache = new Map();
        this._topologySig = null;
    }
    update() {
        // --- 关键：每次更新前重置所有中间计算状态 ---
        this.portToCluster.clear();
        this.nodeVoltages.clear();
        this.gndClusterIndices.clear();
        this.vPosMap.clear();
        this.clusters = [];

        this.connections = this.sys.conns.filter(c => c.type === 'wire');
        this.currentTime += this.deltaTime;
        this.globalIterCount++;
        this._buildTopology();
        // 计算当前拓扑签名（连线 + 关键器件阻值），若签名变化则清空等效电阻缓存
        try {
            const connKeys = this.connections.map(c => `${c.from}-${c.to}-${c.type}`).sort();
            const resistSignatures = [];
            for (let i = 0; i < this.rawDevices.length; i++) {
                const d = this.rawDevices[i];
                // 1. 处理普通电阻和 PT100
                if (d.type === 'resistor') {
                    resistSignatures.push(`${d.id}:${d.currentResistance || 0}`);
                }

                // 2. 处理压力传感器：必须同时监控 r1 和 r2
                if (d.type === 'pressure_sensor') {
                    // 将两个内部电阻的变化都计入签名
                    resistSignatures.push(`${d.id}_r1:${d.r1 || 0}`);
                    resistSignatures.push(`${d.id}_r2:${d.r2 || 0}`);
                }
            }
            resistSignatures.sort();
            const sig = connKeys.join('|') + '|' + resistSignatures.join('|');
            if (sig !== this._topologySig) {
                this._topologySig = sig;
                this._equivResCache.clear();
            }
        } catch (e) { /* ignore signature errors */ }
        this._solve();

        this._updateInstruments();
    }
    /**
     * 1. 拓扑构建 (并查集 + 零电阻桥接)
     */
    _buildTopology() {
        const parent = {};
        const find = (i) => (parent[i] === undefined || parent[i] === i) ? i : (parent[i] = find(parent[i]));
        const union = (i, j) => {
            const rI = find(i), rJ = find(j);
            if (rI !== rJ) parent[rI] = rJ;
        };

        // 1. 预先收集所有可能存在的端口 (关键修复)
        const allPorts = new Set();

        // 从导线中获取端口
        this.connections.forEach(c => {
            allPorts.add(c.from);
            allPorts.add(c.to);
            union(c.from, c.to);
        });

        // 从所有设备中获取端口 (确保没连线的端口也能被识别)
        this.rawDevices.forEach(dev => {
            const ps = this._getDevicePorts(dev.id);
            ps.forEach(p => allPorts.add(p));

            // 2. 处理零电阻内部桥接 (保持原有逻辑)
            const id = dev.id;
            if (dev.type === 'switch' && !dev.isOpen) union(`${id}_wire_l`, `${id}_wire_r`);
            if (dev.type === 'relay' && dev.isEnergized) union(`${id}_wire_NO`, `${id}_wire_COM`);
            if (dev.type === 'ampmeter') union(`${id}_wire_p`, `${id}_wire_n`);
            if (dev.special === 'pt100') union(`${id}_wire_r`, `${id}_wire_t`);
            if (dev.type === 'multimeter' && dev.mode === 'MA') union(`${id}_wire_ma`, `${id}_wire_com`);
            if (dev.currentResistance < 0.001) {
                union(`${id}_wire_l`, `${id}_wire_r`);
            }
        });

        // 3. 构建 Cluster 映射
        const clusterIndex = new Map();
        let idx = 0;

        allPorts.forEach(p => {
            const root = find(p);
            if (!clusterIndex.has(root)) {
                clusterIndex.set(root, idx++);
            }
            this.portToCluster.set(p, clusterIndex.get(root));
        });
        this.clusterCount = idx;

        // 4. 生成最终的 clusters 集合
        // 这里的 id 来源于 parent，可能漏掉没有 union 过的孤立节点，所以改用 allPorts 遍历
        const clusterMap = {};
        allPorts.forEach(p => {
            const root = find(p);
            if (!clusterMap[root]) clusterMap[root] = new Set();
            clusterMap[root].add(p);
        });
        this.clusters = Object.values(clusterMap);
    }
    _getDevicePorts(id) {
        const sfx = ['_l', '_m', '_r', '_p', '_n', '_v', '_ma', '_com', '_COM', '_NO'];
        return sfx.map(s => `${id}_wire${s}`).filter(p => this.portToCluster.has(p));
    }
    /**
     * 2. 核心求解 (节点电压法)
     */
    _solve() {
        const currentTime = this.globalIterCount * this.deltaTime;
        const raw = this.rawDevices;
        // 预缓存按类型分组，避免在循环中重复 filter
        const gndDevs = raw.filter(d => d.type === 'gnd');
        const powerDevs = raw.filter(d => d.type === 'source' || d.type === 'ac_source');
        const power3Devs = raw.filter(d => d.type === 'source_3p');
        const tcDevs = raw.filter(d => d.special === 'tc');
        const pidDevs = raw.filter(d => d.type === 'PID');
        const bjtDevs = raw.filter(d => d.type === 'bjt');
        const opAmps = raw.filter(d => d.type === 'amplifier');
        const oscDevs = raw.filter(d => d.type === 'oscilloscope');
        const osc3Devs = raw.filter(d => d.type === 'oscilloscope_tri');
        const diodeDevs = raw.filter(d => d.type === 'diode');
        const resistorDevs = raw.filter(d => d.type === 'resistor');
        const pressDevs = raw.filter(d => d.type === 'pressure_sensor');
        const transmitterDevs = raw.filter(d => d.type === 'transmitter_2wire');
        const capacitorDevs = raw.filter(d => d.type === 'capacitor');
        const inductorDevs = raw.filter(d => d.type === 'inductor');
        const lvdtDevs = raw.filter(d => d.type === 'pressure_transducer');
        const sgDevs = raw.filter(d => d.type === 'signal_generator');
        const jfetDevs = raw.filter(d => d.type === 'njfet');

        // 将这些按类型分组缓存到实例，供后续的 _updateInstruments 使用，避免重复扫描 rawDevices
        this._cachedDevs = {
            gndDevs,
            powerDevs,
            power3Devs,
            tcDevs,
            pidDevs,
            bjtDevs,
            opAmps,
            oscDevs,
            osc3Devs,
            diodeDevs,
            resistorDevs,
            pressDevs,
            transmitterDevs,
            capacitorDevs,
            inductorDevs,
            lvdtDevs,
            sgDevs,
            jfetDevs,

        };
        // 1.识别专门的 GND 设备
        gndDevs.forEach(g => {
            const clusterIdx = this.portToCluster.get(`${g.id}_wire_gnd`);
            if (clusterIdx !== undefined) {
                this.gndClusterIndices.add(clusterIdx);
            }
        });
        //2.处理电源设备
        powerDevs.forEach(p => {
            const pId = `${p.id}_wire_p`, nId = `${p.id}_wire_n`;
            if (this.portToCluster.has(nId)) this.gndClusterIndices.add(this.portToCluster.get(nId));
            if (this.portToCluster.has(pId)) this.vPosMap.set(this.portToCluster.get(pId), p.getValue(currentTime));
        });
        power3Devs.forEach(dev => {
            // 分别注入 U, V, W 三路电压源
            ['u', 'v', 'w'].forEach(pKey => {
                const cPhase = this.portToCluster.get(`${dev.id}_wire_${pKey}`);
                const vNow = dev.getPhaseVoltage(pKey, currentTime);
                this.vPosMap.set(cPhase, vNow);
            });
        });

        // 3. 初始化所有运放为线性模式 (Linear Mode) (使用上面缓存的 opAmps)
        if (!this._opAmpsInitialized) {
            opAmps.forEach(op => op.internalState = 'linear');
            this._opAmpsInitialized = true;
        }

        //4. 建立节点到cluster的映射，方便填充矩阵。
        const nodeMap = new Map();
        let mSize = 0;
        for (let i = 0; i < this.clusterCount; i++) {
            if (!this.gndClusterIndices.has(i) && !this.vPosMap.has(i)) nodeMap.set(i, mSize++);
        }

        if (mSize === 0) { this._assignKnown();  }
        // 5. 统计额外的电压源方程数量 (PID 的 pi1 配电端 和 PWM 输出端)
        let extraEqCount = 0;
        pidDevs.forEach(pid => {
            if (this.portToCluster.has(`${pid.id}_wire_pi1`)) extraEqCount++;
            if (pid.outModes.CH1 === 'PWM' && this.portToCluster.has(`${pid.id}_wire_po1`)) extraEqCount++;
            if (pid.outModes.CH2 === 'PWM' && this.portToCluster.has(`${pid.id}_wire_po2`)) extraEqCount++;
        });
        tcDevs.forEach(tc => {
            if (this.portToCluster.has(`${tc.id}_wire_r`) && this.portToCluster.has(`${tc.id}_wire_l`)) {
                extraEqCount++; // 每个热电偶占用一个电流变量方程
            }
        });
        const totalSize = mSize + extraEqCount + opAmps.length + oscDevs.length + lvdtDevs.length; // 总方程数量 = 节点电压方程 + 额外电压源方程 + 运放模式方程 + 示波器约束方程 + 压力变送器方程
        let results = new Float64Array(totalSize);
        let maxIterations = 200; // 运放状态切换很快，通常2-3次就收敛

        // 预分配矩阵并在每次迭代中重用，避免频繁分配内存
        const G = Array.from({ length: totalSize }, () => new Float64Array(totalSize));
        const B = new Float64Array(totalSize);

        // --- 核心迭代循环 ---
        for (let iter = 0; iter < maxIterations; iter++) {
            // 每次迭代必须重置 G 和 B
            for (let gi = 0; gi < totalSize; gi++) G[gi].fill(0);
            B.fill(0);

            // 1. (1)填充普通线性电阻
            resistorDevs.forEach(dev => {
                if (dev.currentResistance < 0.01) return;
                const c1 = this.portToCluster.get(`${dev.id}_wire_l`);
                const c2 = this.portToCluster.get(`${dev.id}_wire_r`);
                let devResistance = 1000000000;
                if (dev.currentResistance !== undefined) devResistance = dev.currentResistance;
                if (c1 !== undefined && c2 !== undefined) {
                    this._fillMatrix(G, B, nodeMap, c1, c2, 1 / devResistance);
                }
            });
            // (2)填充压力传感器 (双支路电阻)
            pressDevs.forEach(dev => {
                if (dev.type !== 'pressure_sensor') return;

                // --- 处理 r1 支路 ---
                const c1l = this.portToCluster.get(`${dev.id}_wire_r1l`);
                const c1r = this.portToCluster.get(`${dev.id}_wire_r1r`);
                if (c1l !== undefined && c1r !== undefined) {
                    // 使用实时计算的 r1 阻值
                    const g1 = 1 / Math.max(0.001, dev.r1);
                    this._fillMatrix(G, B, nodeMap, c1l, c1r, g1);
                }

                // --- 处理 r2 支路 ---
                const c2l = this.portToCluster.get(`${dev.id}_wire_r2l`);
                const c2r = this.portToCluster.get(`${dev.id}_wire_r2r`);
                if (c2l !== undefined && c2r !== undefined) {
                    // 使用实时计算的 r2 阻值
                    const g2 = 1 / Math.max(0.001, dev.r2);
                    this._fillMatrix(G, B, nodeMap, c2l, c2r, g2);
                }
            });
            // 2. 【核心修复】变送器作为受控电阻注入
            transmitterDevs.forEach(dev => {
                const cP = this.portToCluster.get(`${dev.id}_wire_p`);
                const cN = this.portToCluster.get(`${dev.id}_wire_n`);
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

            // 3. 【新增】注入 PID 控制器 
            let currentVSourceIdx = mSize; // 额外方程起始索引       
            pidDevs.forEach(pid => {
                if (!pid.powerOn) {
                    pid.ch1Current = 0;
                    pid.ch2Current = 0;
                    return;
                }
                const p = `${pid.id}_wire_`;

                // 3.1 4-20mA 输入回路: pi1(24V馈电) 和 ni(250Ω内阻)
                const cPi1 = this.portToCluster.get(`${p}pi1`);
                const cNi1 = this.portToCluster.get(`${p}ni1`);
                if (cPi1 !== undefined) {
                    this._addVoltageSourceToMNA(G, B, nodeMap, cPi1, -1, 24.0, currentVSourceIdx++);
                }
                if (cNi1 !== undefined) {
                    this._fillMatrix(G, B, nodeMap, cNi1, -1, 1 / 250); // 接地电阻
                }

                // 3.2 4-20mA 输出 / PWM 输出 (共用端子 po, no)
                const cPo1 = this.portToCluster.get(`${p}po1`);
                const cNo1 = this.portToCluster.get(`${p}no1`);
                if (cPo1 !== undefined && cNo1 !== undefined) {
                    if (pid.outModes.CH1 === '4-20mA') {
                        this._addCurrentSourceToMNA(B, nodeMap, cPo1, cNo1, pid.output1mA / 1000);
                    } else if (pid.outModes.CH1 === 'PWM') {
                        const cPo1 = this.portToCluster.get(`${p}po1`);
                        const cNo1 = this.portToCluster.get(`${p}no1`);

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

                // 3.3 4-20mA 输出 / PWM 输出 (共用端子 po, no)
                const cPo2 = this.portToCluster.get(`${p}po2`);
                const cNo2 = this.portToCluster.get(`${p}no2`);
                if (cPo2 !== undefined && cNo2 !== undefined) {
                    if (pid.outModes.CH2 === '4-20mA') {
                        this._addCurrentSourceToMNA(B, nodeMap, cPo2, cNo2, pid.output2mA / 1000);
                    } else if (pid.outModes.CH2 === 'PWM') {
                        const cPo2 = this.portToCluster.get(`${p}po2`);
                        const cNo2 = this.portToCluster.get(`${p}no2`);
                        if (cPo2 !== undefined && cNo2 !== undefined) {
                            pid.ch2VSourceIdx = currentVSourceIdx;
                            const vcc = this.getVoltageAtPort(`${p}vcc`) || 24;
                            const vTarget = pid.coolInstantOn ? vcc : 0;

                            this._addVoltageSourceToMNA(G, B, nodeMap, cPo2, cNo2, vTarget, currentVSourceIdx++);
                        }
                    }
                }
            });
            // 3.2 在循环内部，填充 PID 之后，填充热电偶
            let tcVIdx = currentVSourceIdx;
            tcDevs.forEach(tc => {
                const cP = this.portToCluster.get(`${tc.id}_wire_r`); // 正极
                const cN = this.portToCluster.get(`${tc.id}_wire_l`); // 负极

                if (cP !== undefined && cN !== undefined) {
                    tc.vSourceIdx = tcVIdx; // 记录电流索引以便后续回传
                    // 核心：Vp - Vn = tc.currentVoltage
                    this._addVoltageSourceToMNA(G, B, nodeMap, cP, cN, tc.currentVoltage, tcVIdx++);
                }
            });
            // 4. 【关键修复】运放注入：必须在每次迭代根据 internalState 决定矩阵系数
            let opVIdx = tcVIdx;
            opAmps.forEach(op => {
                const cP = this.portToCluster.get(`${op.id}_wire_p`);
                const cN = this.portToCluster.get(`${op.id}_wire_n`);
                const cOut = this.portToCluster.get(`${op.id}_wire_OUT`);

                if (cOut !== undefined) {
                    const outM = nodeMap.get(cOut);
                    // KCL项：在输出节点的方程里加上输出电流变量
                    if (outM !== undefined) G[outM][opVIdx] += 1;

                    if (op.internalState === 'linear') {
                        // 1*Vout - A*Vp + A*Vn = 0
                        if (outM !== undefined) G[opVIdx][outM] = 1;
                        const pM = nodeMap.get(cP), nM = nodeMap.get(cN);
                        if (pM !== undefined) G[opVIdx][pM] -= op.gain;
                        else if (this.vPosMap.has(cP)) B[opVIdx] += op.gain * this.vPosMap.get(cP);

                        if (nM !== undefined) G[opVIdx][nM] += op.gain;
                        else if (this.vPosMap.has(cN)) B[opVIdx] -= op.gain * this.vPosMap.get(cN);
                    } else {
                        // 饱和态：1*Vout = Vlimit
                        if (outM !== undefined) G[opVIdx][outM] = 1;
                        B[opVIdx] = (op.internalState === 'pos_sat') ? op.vPosLimit : op.vNegLimit;
                    }
                }
                op.currentIdx = opVIdx;
                opVIdx++;
            });

            // 5. 注入二极管 (Diode) 非线性伴随模型
            diodeDevs.forEach(dev => {
                const cA = this.portToCluster.get(`${dev.id}_wire_l`); // 正极
                const cC = this.portToCluster.get(`${dev.id}_wire_r`); // 负极
                if (cA === undefined || cC === undefined) {
                    dev.physCurrent = 0;
                    return;
                }

                const vA = this.getVoltageFromResults(results, nodeMap, cA);
                const vC = this.getVoltageFromResults(results, nodeMap, cC);
                const vDiff = vA - vC;

                if (vDiff > dev.vForward) {
                    // 导通态：G = 1/rOn, 并联电流源 I = vForward/rOn
                    const gOn = 1 / (dev.rOn || 0.5);
                    const iEq = dev.vForward * gOn;
                    this._fillMatrix(G, B, nodeMap, cA, cC, gOn);
                    this._addCurrentSourceToMNA(B, nodeMap, cA, cC, iEq); // 电流从A流向C
                } else {
                    // 截止态
                    this._fillMatrix(G, B, nodeMap, cA, cC, 1 / (dev.rOff || 1e9));
                }
            });
            // 6.1 注入 BJT 
            bjtDevs.forEach(dev => {
                const cB = this.portToCluster.get(`${dev.id}_wire_b`);
                const cC = this.portToCluster.get(`${dev.id}_wire_c`);
                const cE = this.portToCluster.get(`${dev.id}_wire_e`);
                // --- 核心保护：如果基极没接，或者 C/E 全没接，该器件不参与本轮矩阵填充 ---
                if (cB === undefined || (cC === undefined && cE === undefined)) {
                    return;
                }
                // 获取当前迭代的电压
                const vB = this.getVoltageFromResults(results, nodeMap, cB);
                const vC = this.getVoltageFromResults(results, nodeMap, cC);
                const vE = this.getVoltageFromResults(results, nodeMap, cE);
                if (cB !== undefined && cE !== undefined && cC === undefined) {
                    const vDiff = vB - vE;
                    if (vDiff > 0.7) {
                        // 导通态：G = 1/rOn, 并联电流源 I = vForward/rOn
                        const gOn = 2;
                        const iEq = 0.7 * gOn;
                        this._fillMatrix(G, B, nodeMap, cB, cE, gOn);
                        this._addCurrentSourceToMNA(B, nodeMap, cB, cE, iEq); // 电流从A流向C
                    } else {
                        // 截止态
                        this._fillMatrix(G, B, nodeMap, cB, cE, 1 / (1e9));
                    }
                } else if (cB !== undefined && cC !== undefined && cE === undefined) {
                    const vDiff = vB - vC;
                    if (vDiff > 0.7) {
                        // 导通态：G = 1/rOn, 并联电流源 I = vForward/rOn
                        const gOn = 2;
                        const iEq = 0.7 * gOn;
                        this._fillMatrix(G, B, nodeMap, cB, cC, gOn);
                        this._addCurrentSourceToMNA(B, nodeMap, cB, cC, iEq); // 电流从A流向C
                    } else {
                        // 截止态
                        this._fillMatrix(G, B, nodeMap, cB, cC, 1 / (1e9));
                    }
                } else {
                    const model = dev.getCompanionModel(vB, vC, vE) || { matrix: {}, currents: {} };
                    this._fillBJTMatrix(G, B, nodeMap, cC, cB, cE, model);
                }

            });
            //6.2 注入 NJFET 开关模型
            jfetDevs.forEach(dev => {
                const cG = this.portToCluster.get(`${dev.id}_wire_g`);
                const cD = this.portToCluster.get(`${dev.id}_wire_d`);
                const cS = this.portToCluster.get(`${dev.id}_wire_s`);

                // 1. 处理栅极 G (理想高阻)
                if (cG !== undefined) {
                    // 注入极小电导防止节点悬空导致矩阵奇异 (1GΩ)
                    this._fillMatrix(G, B, nodeMap, cG, -1, 1e-12);
                }
                // 2. 处理 D-S 沟道
                if (cD !== undefined && cS !== undefined) {
                    // 获取当前迭代的电压估计值
                    // 注意：为了收敛稳定，建议使用上一步提到的 this.nodeVoltages
                    const vG = this.getVoltageFromResults(results, nodeMap, cG) || 0;
                    const vS = this.getVoltageFromResults(results, nodeMap, cS) || 0;
                    const vGS = vG - vS;
                    // 调用组件自带的电阻计算逻辑
                    const res = dev.getDSResistance(vGS);
                    const gDS = 1 / Math.max(0.001, res);
                    // 注入 DS 间的电导到 G 矩阵
                    this._fillMatrix(G, B, nodeMap, cD, cS, gDS);
                }
            });
            // 7. 注入电容/电感 模型
            capacitorDevs.forEach(dev => {
                const cL = this.portToCluster.get(`${dev.id}_wire_l`);
                const cR = this.portToCluster.get(`${dev.id}_wire_r`);

                // 获取模型：注意这里的 deltaTime 必须与仿真步长一致
                const { gEq, iEq } = dev.getCompanionModel(this.deltaTime);
                // 1. 注入等效电导 (像电阻一样)
                this._fillMatrix(G, B, nodeMap, cL, cR, gEq);
                // 2. 注入伴随电流源 (iEq)
                // 电流方向是从 L 流向 R，所以 L 减去 iEq，R 加上 iEq
                this._addCurrentSourceToMNA(B, nodeMap, cL, cR, iEq);
            });
            inductorDevs.forEach(dev => {
                const cL = this.portToCluster.get(`${dev.id}_wire_l`);
                const cR = this.portToCluster.get(`${dev.id}_wire_r`);

                // 获取模型：注意这里的 deltaTime 必须与仿真步长一致
                const { gEq, iEq } = dev.getCompanionModel(this.deltaTime);
                // 1. 注入等效电导 (像电阻一样)
                this._fillMatrix(G, B, nodeMap, cL, cR, gEq);
                // 2. 注入伴随电流源 (iEq)
                // 电流方向是从 L 流向 R，所以 L 减去 iEq，R 加上 iEq
                this._addCurrentSourceToMNA(B, nodeMap, cL, cR, iEq);
            });
            // 8. 注入示波器模型
            let oscVIdx = opVIdx;
            oscDevs.forEach(dev => {
                const cIn = this.portToCluster.get(`${dev.id}_wire_l`);
                const cOut = this.portToCluster.get(`${dev.id}_wire_r`);
                // 如果没有接线，则不注入矩阵逻辑
                if (cIn === undefined || cOut === undefined) return;
                // 电流通道在矩阵中表现为 0V 电压源（理想电流表）
                // 这会给矩阵增加一个超节点约束：V_in - V_out = 0
                this._addVoltageSourceToMNA(G, B, nodeMap, cIn, cOut, 0, oscVIdx);

                dev.currentIdx = oscVIdx;
                oscVIdx++;
            });

            // 9. 注入压力传感器模型 (差动变压器/LVDT)
            let ptVIdx = oscVIdx;
            lvdtDevs.forEach(dev => {
                const ports = ['p', 'n', 'outp', 'outn'].map(k => this.portToCluster.get(`${dev.id}_wire_${k}`));
                const [cInP, cInN, cOutP, cOutN] = ports;

                // 获取节点索引
                const m = ports.map(c => nodeMap.get(c));
                const [mInP, mInN, mOutP, mOutN] = m;

                if (cOutP !== undefined && cOutN !== undefined) {
                    const k = dev.outputRatio || 0;

                    // --- A. KCL 电流项 (针对输出端) ---
                    if (mOutP !== undefined) G[mOutP][ptVIdx] += 1;
                    if (mOutN !== undefined) G[mOutN][ptVIdx] -= 1;

                    // --- B. 约束方程: V(outP) - V(outN) = k * (V(inP) - V(inN)) ---
                    // 移项得: 1*V(outP) - 1*V(outN) - k*V(inP) + k*V(inN) = 0

                    // 1. 处理输出端
                    if (mOutP !== undefined) G[ptVIdx][mOutP] += 1;
                    else if (this.vPosMap.has(cOutP)) B[ptVIdx] -= this.vPosMap.get(cOutP);
                    // 如果是 GND (不在 nodeMap 也不在 vPosMap)，贡献为 0，逻辑正确

                    if (mOutN !== undefined) G[ptVIdx][mOutN] -= 1;
                    else if (this.vPosMap.has(cOutN)) B[ptVIdx] += this.vPosMap.get(cOutN);

                    // 2. 处理输入端 (受控源项)
                    if (mInP !== undefined) {
                        G[ptVIdx][mInP] -= k;
                    } else if (this.vPosMap.has(cInP)) {
                        B[ptVIdx] += k * this.vPosMap.get(cInP);
                    }

                    if (mInN !== undefined) {
                        G[ptVIdx][mInN] += k;
                    } else if (this.vPosMap.has(cInN)) {
                        B[ptVIdx] -= k * this.vPosMap.get(cInN);
                    }

                    // --- C. 防奇异：给输入端注入极小电导 (Gmin) ---
                    // 防止原边线圈悬空导致矩阵无法求解
                    this._fillMatrix(G, B, nodeMap, cInP, cInN, 1e-9);

                } else {
                    G[ptVIdx][ptVIdx] = 1;
                }
                dev.currentIdx = ptVIdx++;
            });
            // 10,注入信号发生器
            sgDevs.forEach(sg => {
                // 获取当前时刻的理想波形电压值 { ch1: v, ch2: v }
                sg.voltOutputs = sg.update(currentTime);

                [
                    { key: 'ch1', p: 'ch1p', n: 'ch1n', idx: 0 },
                    { key: 'ch2', p: 'ch2p', n: 'ch2n', idx: 1 }
                ].forEach(chCfg => {
                    const ch = sg.channels[chCfg.idx];

                    // 1. 获取端口对应的 Cluster ID (电路节点)
                    const portP = this.portToCluster.get(`${sg.id}_wire_${chCfg.p}`);
                    const portN = this.portToCluster.get(`${sg.id}_wire_${chCfg.n}`);

                    // 2. 状态判定
                    if (ch.enabled && portN !== undefined && portP !== undefined) {
                        /**
                         * 使能状态：等效为 50Ω 电阻串联理想电压源
                         * 转换成诺顿等效电路以便于使用你的 _fillMatrix 和 _addCurrentSourceToMNA:
                         * - 并联电阻 Rs = 50 Ω
                         * - 并联电流源 Is = V_ideal / Rs (电流从 N 流向 P)
                         */
                        const Rs = 50;
                        const Gs = 1 / Rs; // 电导
                        const Vs = sg.voltOutputs[chCfg.key]; // 理想电压 (包含偏置)
                        const Is = Vs / Rs; // 诺顿等效电流

                        // 注入内阻产生的电导
                        this._fillMatrix(G, B, nodeMap, portP, portN, Gs);

                        // 注入等效电流源 (从负极流向正极，因为是电源内部)
                        // 注意：cPos 是电流流入的节点，cNeg 是流出的节点
                        this._addCurrentSourceToMNA(B, nodeMap, portP, portN, Is);

                    } else {
                        /**
                         * 未使能状态：高阻状态 (Hi-Z)
                         * 在 MNA 矩阵中，高阻即“断路”，不需要对 G 或 B 矩阵做任何操作
                         * 此时 portP 和 portN 之间没有电流路径
                         */
                    }
                });

            });
            // 注入 GMIN 防奇异
            for (let i = 0; i < totalSize; i++) G[i][i] += 1e-12;

            const nextResults = this._gauss(G, B);
            // 检查电压是否收敛 (L2范数或最大误差)
            let maxError = 0;
            for (let i = 0; i < totalSize; i++) {
                maxError = Math.max(maxError, Math.abs(nextResults[i] - results[i]));
            }
            // 核心：带限幅的阻尼更新
            nodeMap.forEach((mIdx, cIdx) => {
                const oldV = this.nodeVoltages.get(cIdx) || 0;
                const rawNewV = nextResults[mIdx];
                // 如果这个节点是受控源或已知源，跳过阻尼，直接赋值
                if (this.vPosMap.has(cIdx)) {
                    this.nodeVoltages.set(cIdx, rawNewV);
                    return;
                }
                //  阻尼 (0.3 表示新解只占 30%)
                const damping = 0.3;
                let nextV = oldV + damping * (rawNewV - oldV);

                //  位移限幅 (MAX_STEP = 0.1V ~ 0.5V)
                // 即使 rawNewV 算出了 -100V，本轮迭代它也只能下降 0.5V
                // 这给模型足够的时间在“平滑带”内找到平衡点
                const MAX_STEP = 0.5;
                let delta = nextV - oldV;
                if (Math.abs(delta) > MAX_STEP) {
                    nextV = oldV + MAX_STEP * Math.sign(delta);
                }

                this.nodeVoltages.set(cIdx, nextV);
                nextResults[mIdx] = nextV;
            });
            // 第一阶段末尾. 检查状态切换 (修正版：引入输入压差判据)
            let stateChanged = false;
            opAmps.forEach(op => {
                const cP = this.portToCluster.get(`${op.id}_wire_p`);
                const cN = this.portToCluster.get(`${op.id}_wire_n`);
                const cOut = this.portToCluster.get(`${op.id}_wire_OUT`);

                // 获取当前迭代算出的实时电位
                const vP = this.getVoltageFromResults(results, nodeMap, cP);
                const vN = this.getVoltageFromResults(results, nodeMap, cN);
                const vOutRaw = this.getVoltageFromResults(results, nodeMap, cOut);

                let newState = op.internalState;

                if (op.internalState === 'linear') {
                    // 线性区判断：看输出是否超标
                    if (vOutRaw > op.vPosLimit) newState = 'pos_sat';
                    else if (vOutRaw < op.vNegLimit) newState = 'neg_sat';
                } else {
                    // 饱和区判断：必须看输入压差才能“逃离”饱和
                    // 只有当压差方向改变，且线性计算结果回到安全范围内时才切换回线性
                    const vDiff = vP - vN;
                    if (op.internalState === 'pos_sat' && vDiff < 0) {
                        newState = 'linear';
                    } else if (op.internalState === 'neg_sat' && vDiff > 0) {
                        newState = 'linear';
                    } else if (cP === undefined && cN === undefined || vDiff === 0) {

                        newState = 'linear';
                    }

                }
                if (op.internalState !== newState) {
                    op.internalState = newState;
                    stateChanged = true;
                }
            });
            results = nextResults;
            if (!stateChanged && maxError < 1e-6) break;
        }

        this._assignKnown();

        // --- 1.(1) 电阻/电位器等双端线性元件电流预存 ---
        resistorDevs.forEach(dev => {
            if (dev.currentResistance < 0.001) return;
            const portL = `${dev.id}_wire_l`;
            const portR = `${dev.id}_wire_r`;

            const vL = this.nodeVoltages.get(this.portToCluster.get(portL)) || 0;
            const vR = this.nodeVoltages.get(this.portToCluster.get(portR)) || 0;

            // 规定一个标准方向：从 left 流向 right 为正
            dev.physCurrent = (vL - vR) / dev.currentResistance;
        });
        // 1,(2). pressure_sensor 各支路电流回传
        pressDevs.forEach(dev => {
            const c1l = this.portToCluster.get(`${dev.id}_wire_r1l`);
            const c1r = this.portToCluster.get(`${dev.id}_wire_r1r`);
            const c2l = this.portToCluster.get(`${dev.id}_wire_r2l`);
            const c2r = this.portToCluster.get(`${dev.id}_wire_r2r`);

            const v1l = this.nodeVoltages.get(c1l) || 0;
            const v1r = this.nodeVoltages.get(c1r) || 0;
            const v2l = this.nodeVoltages.get(c2l) || 0;
            const v2r = this.nodeVoltages.get(c2r) || 0;

            dev.r1Current = (v1l - v1r) / Math.max(0.001, dev.r1);
            dev.r2Current = (v2l - v2r) / Math.max(0.001, dev.r2);
        });
        // 2. 【关键】变送器计算并缓存当前帧的压差，供下一帧使用
        transmitterDevs.forEach(dev => {
            const pV = this.getVoltageAtPort(`${dev.id}_wire_p`);
            const nV = this.getVoltageAtPort(`${dev.id}_wire_n`);
            dev._lastVDiff = pV - nV; // 存储压差
        });

        // ---3.PID 回传电流数据 ---
        pidDevs.forEach(pid => {
            if (pid.ch1VSourceIdx !== undefined) pid.ch1Current = results[pid.ch1VSourceIdx];
            if (pid.ch2VSourceIdx !== undefined) pid.ch2Current = results[pid.ch2VSourceIdx];
        });

        // ---3.2 tc 热电偶电流回传（从 MNA 结果中读取流过电压源的电流）
        tcDevs.forEach(tc => {
            if (tc.vSourceIdx !== undefined) {
                tc.physCurrent = results[tc.vSourceIdx];
            }
        });
        // ---4.运放 回传电流数据 ---
        opAmps.forEach(op => {
            if (op.currentIdx !== undefined) op.outCurrent = results[op.currentIdx];
        });
        // 5. _solve() 循环彻底结束，电压已同步到 this.nodeVoltages，存储二极管电流
        diodeDevs.forEach(dev => {
            const cA = this.portToCluster.get(`${dev.id}_wire_l`);
            const cC = this.portToCluster.get(`${dev.id}_wire_r`);
            const vA = this.nodeVoltages.get(cA) || 0;
            const vC = this.nodeVoltages.get(cC) || 0;
            const vDiff = vA - vC;

            // 必须镜像填充矩阵时的逻辑
            const vForward = dev.vForward || 0.68; // 确保默认值一致
            const rOn = dev.rOn || 0.5;
            const gOn = 1 / rOn;

            if (vDiff > vForward) {
                // 导通态：I = (V - V_forward) / rOn
                dev.physCurrent = gOn * (vDiff - vForward);
            } else {
                // 截止态：I = V / rOff
                dev.physCurrent = 0;
            }
        });
        // 6.1 三极管存储电流 (使用缓存 bjtDevs)
        bjtDevs.forEach(dev => {
            const cB = this.portToCluster.get(`${dev.id}_wire_b`);
            const cC = this.portToCluster.get(`${dev.id}_wire_c`);
            const cE = this.portToCluster.get(`${dev.id}_wire_e`);
            const vB = this.nodeVoltages.get(cB) || 0;
            const vC = this.nodeVoltages.get(cC) || 0;
            const vE = this.nodeVoltages.get(cE) || 0;

            dev.physCurrents = { b: 0, c: 0, e: 0 };

            // 1. 获取伴随模型参数
            const model = dev.getCompanionModel(vB, vC, vE);
            const { gBE, iBE, beta, gCE_sat, pol, V_SAT } = model.internal;

            // 2. 判别拓扑模式（镜像注入逻辑）
            if (cB !== undefined && cE !== undefined && (cC === undefined || cC === cB)) {
                // B-E 模式
                const vDiff = (vB - vE) * pol;
                const Ib = (vDiff > 0.7) ? 2 * (vDiff - 0.7) : 0;
                dev.physCurrents.b = Ib * pol;
                dev.physCurrents.e = -dev.physCurrents.b;
            } else if (cB !== undefined && cC !== undefined && (cE === undefined || cE === cB)) {
                // B-C 模式
                const vDiff = (vB - vC) * pol;
                const Ib = (vDiff > 0.7) ? 2 * (vDiff - 0.7) : 0;
                dev.physCurrents.b = Ib * pol;
                dev.physCurrents.c = -dev.physCurrents.b;
            } else {
                // 标准模式：Ib = (gBE * vbeLocal + iBE) * pol
                const vbeLocal = (vB - vE) * pol;
                const vceLocal = (vC - vE) * pol;

                const Ib = pol * (gBE * vbeLocal + iBE);
                // Ic = 放大电流 + 饱和对冲电流
                const Ic = (beta * Ib) + pol * (gCE_sat * (vceLocal - V_SAT));

                dev.physCurrents.b = Ib;
                dev.physCurrents.c = Ic;
                dev.physCurrents.e = -(Ib + Ic);
            }
        });
        // 6.2 在 jfet获取电流
        jfetDevs.forEach(dev => {
            const cD = this.portToCluster.get(`${dev.id}_wire_d`);
            const cS = this.portToCluster.get(`${dev.id}_wire_s`);
            const vD = this.nodeVoltages.get(cD) || 0;
            const vS = this.nodeVoltages.get(cS) || 0;

            const res = dev.getDSResistance(vD - vS); // 这里逻辑其实取决于 vGS，但 res 已确定
            dev.physCurrent = (vD - vS) / res;
        });

        // 7.1 求解定格阶段重要：在这一步完成后，更新电容的历史状态
        capacitorDevs.forEach(dev => {
            const cL = this.portToCluster.get(`${dev.id}_wire_l`);
            const cR = this.portToCluster.get(`${dev.id}_wire_r`);
            const vL = this.nodeVoltages.get(cL) || 0;
            const vR = this.nodeVoltages.get(cR) || 0;

            // 1. 计算物理电流存入缓存（供仪表盘显示）
            dev.calculatePhysicalCurrent(vL, vR, this.deltaTime);
            // 2. 将当前电压存入 vLast，供下一毫秒使用
            dev.updateState(vL, vR);
        });
        // 7.2 求解定格阶段重要：在这一步完成后，更新电感的历史状态
        inductorDevs.forEach(dev => {
            const cL = this.portToCluster.get(`${dev.id}_wire_l`);
            const cR = this.portToCluster.get(`${dev.id}_wire_r`);
            const vL = this.nodeVoltages.get(cL) || 0;
            const vR = this.nodeVoltages.get(cR) || 0;

            // 1. 计算物理电流存入缓存（供仪表盘显示）
            dev.calculatePhysicalCurrent(vL, vR, this.deltaTime);
            // 2. 将当前电压存入 vLast，供下一毫秒使用
            dev.updateState();
            if (this.debug) console.log(dev.type, dev.physCurrent, vL, vR);
        });
        // 8. 更新示波器电压和电流
        oscDevs.forEach(dev => {
            // 1. 获取电压通道压差
            if (dev.currentIdx !== undefined) dev.physCurrent = results[dev.currentIdx];
            // 3. 更新示波器波形
            // dev.updateTrace(vDiff, iVal, this.globalIterCount);
        });

        // 9. 在循环结束后，提取压力传感器电流数据
        lvdtDevs.forEach(dev => {
            if (dev.currentIdx !== undefined) {
                // 这里的电流是从 outP 流向 outN 的内部等效电流
                dev.physCurrent = results[dev.currentIdx];
            }
        });
        // 10.在循环结束后，提取信号发生器电流
        sgDevs.forEach(sg => {
            [
                { key: 'ch1', p: 'ch1p', n: 'ch1n', idx: 0 },
                { key: 'ch2', p: 'ch2p', n: 'ch2n', idx: 1 }
            ].forEach(chCfg => {
                const ch = sg.channels[chCfg.idx];
                const portP = this.portToCluster.get(`${sg.id}_wire_${chCfg.p}`);
                const portN = this.portToCluster.get(`${sg.id}_wire_${chCfg.n}`);

                if (ch.enabled && portP !== undefined && portN !== undefined) {
                    const vP = this.nodeVoltages.get(portP) || 0;
                    const vN = this.nodeVoltages.get(portN) || 0;

                    // 诺顿模型下的负载电流计算：
                    // I_load = Is - (vP - vN) * Gs
                    // 其中 Is 是内部理想电流源，Gs 是 1/50 欧姆
                    const Vs = sg.voltOutputs[chCfg.key]; // 理想电压
                    const Rs = 50;

                    // 这里的电流是从 P 流向 N 的外部电流
                    const current = (Vs - (vP - vN)) / Rs;

                    if (chCfg.idx === 0) sg.ch1Current = current;
                    else sg.ch2Current = current;
                } else {
                    if (chCfg.idx === 0) sg.ch1Current = 0;
                    else sg.ch2Current = 0;
                }
            });
        });


    }
    getVoltageFromResults(results, nodeMap, clusterIdx) {
        if (clusterIdx === undefined) return 0;
        if (this.gndClusterIndices.has(clusterIdx)) return 0;
        if (this.vPosMap.has(clusterIdx)) return this.vPosMap.get(clusterIdx);
        const mIdx = nodeMap.get(clusterIdx);
        return mIdx !== undefined ? results[mIdx] : 0;
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

    _fillBJTMatrix(G, B, nodeMap, cC, cB, cE, model) {
        const idx = { c: nodeMap.get(cC), b: nodeMap.get(cB), e: nodeMap.get(cE) };
        const { gBE, iBE, beta, gCE_sat, pol, V_SAT } = model.internal;
        const addG = (r, c, val) => { if (r !== undefined && c !== undefined) G[r][c] += val; };

        // 1. BE 结注入 (控制端)
        addG(idx.b, idx.b, gBE); addG(idx.b, idx.e, -gBE);
        addG(idx.e, idx.b, -gBE); addG(idx.e, idx.e, gBE);
        if (idx.b !== undefined) B[idx.b] -= pol * iBE;
        if (idx.e !== undefined) B[idx.e] += pol * iBE;

        // 2. 受控源 (放大项)
        // Ic = beta * (gBE * Vbe + iBE)
        const transG = beta * gBE;
        addG(idx.c, idx.b, transG * pol);
        addG(idx.c, idx.e, -transG * pol);
        addG(idx.e, idx.b, -transG * pol);
        addG(idx.e, idx.e, transG * pol);

        const iControl = beta * iBE;
        if (idx.c !== undefined) B[idx.c] -= pol * iControl;
        if (idx.e !== undefined) B[idx.e] += pol * iControl;

        // 3. 饱和/钳位项
        if (gCE_sat > 0) {
            addG(idx.c, idx.c, gCE_sat);
            addG(idx.c, idx.e, -gCE_sat);
            addG(idx.e, idx.c, -gCE_sat);
            addG(idx.e, idx.e, gCE_sat);

            const iSatComp = V_SAT * gCE_sat * pol;
            if (idx.c !== undefined) B[idx.c] += iSatComp;
            if (idx.e !== undefined) B[idx.e] -= iSatComp;
        }
    }
    _assignKnown() {
        this.gndClusterIndices.forEach(idx => this.nodeVoltages.set(idx, 0));
        this.vPosMap.forEach((v, idx) => this.nodeVoltages.set(idx, v));
    }
    _gauss(A, b) {
        const n = b.length;
        for (let i = 0; i < n; i++) {
            // 列主元选取
            let maxVal = Math.abs(A[i][i]), maxRow = i;
            for (let k = i + 1; k < n; k++) {
                if (Math.abs(A[k][i]) > maxVal) { maxVal = Math.abs(A[k][i]); maxRow = k; }
            }
            if (maxRow !== i) {
                [A[i], A[maxRow]] = [A[maxRow], A[i]];
                [b[i], b[maxRow]] = [b[maxRow], b[i]];
            }
            const pivot = A[i][i];
            if (Math.abs(pivot) < 1e-18) continue;
            for (let j = i + 1; j < n; j++) {
                const f = A[j][i] / pivot;
                b[j] -= f * b[i];
                for (let k = i; k < n; k++) A[j][k] -= f * A[i][k];
            }
        }
        const x = new Float64Array(n);
        for (let i = n - 1; i >= 0; i--) {
            let s = 0;
            for (let j = i + 1; j < n; j++) s += A[i][j] * x[j];
            x[i] = Math.abs(A[i][i]) < 1e-18 ? 0 : (b[i] - s) / A[i][i];
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
    * 3. 更新仪表状态
    */
    _updateInstruments() {
        this.rawDevices.forEach(dev => {
            // 1. 电流表逻辑 (支持 ampmeter 和万用表 MA 档)
            if (dev.type === 'ampmeter' || (dev.type === 'multimeter' && dev.mode === 'MA')) {
                const pId = dev.type === 'ampmeter' ? `${dev.id}_wire_p` : `${dev.id}_wire_ma`;
                const nId = dev.type === 'ampmeter' ? `${dev.id}_wire_n` : `${dev.id}_wire_com`;
                const pIndex = this.portToCluster.get(pId);
                const nIndex = this.portToCluster.get(nId);
                if (pIndex === undefined || nIndex === undefined) {
                    dev.update(0);
                } else {
                    const current = this._calculateBranchCurrent(dev);
                    dev.update(current * 1000); // 调用组件内部的 update 方法刷新 UI
                }
            }

            // 2. 万用表逻辑（优化：使用 portToCluster 索引与缓存设备列表，避免 find/filter 扫描）
            if (dev.type === 'multimeter') {
                const mode = dev.mode || 'OFF';

                // 电压档
                if (mode.startsWith('DCV')) {
                    let diff = 0;
                    const vIdx = this.portToCluster.get(`${dev.id}_wire_v`);
                    const comIdx = this.portToCluster.get(`${dev.id}_wire_com`);
                    if (vIdx !== undefined && comIdx !== undefined) diff = this.getPD(`${dev.id}_wire_v`, `${dev.id}_wire_com`);
                    dev.update(diff);
                }
                // 电阻档
                else if (mode.startsWith('RES')) {
                    const comNode = `${dev.id}_wire_com`;
                    const vNode = `${dev.id}_wire_v`;
                    const comIdx = this.portToCluster.get(comNode);
                    const vIdx = this.portToCluster.get(vNode);

                    let R = Infinity;

                    if (comIdx !== undefined && vIdx !== undefined && Math.abs(this.getPD(vNode, comNode)) < 0.1) {
                        const comCluster = this.clusters[comIdx];
                        const vCluster = this.clusters[vIdx];
                        R = this._getEquivalentResistance(comCluster, vCluster, this.clusters);
                        const bjtDevs = this.rawDevices.filter(d => d.type === 'bjt');

                        bjtDevs.forEach(t => {
                            const bIdx = this.portToCluster.get(`${t.id}_wire_b`);
                            const cIdx = this.portToCluster.get(`${t.id}_wire_c`);
                            const eIdx = this.portToCluster.get(`${t.id}_wire_e`);
                            const isNPN = (t.subType === 'NPN');

                            let isTargetPair = false;
                            let controlRes = Infinity;

                            if (isNPN) {
                                // NPN: V->C, COM->E。探测 BC 电阻
                                if (vIdx === cIdx && comIdx === eIdx) {
                                    isTargetPair = true;
                                    controlRes = this._getEquivalentResistance(this.clusters[bIdx], this.clusters[cIdx], this.clusters);
                                }
                            } else {
                                // PNP: V->E, COM->C。探测 EB 电阻 (电流从E进)
                                if (vIdx === eIdx && comIdx === cIdx) {
                                    isTargetPair = true;
                                    // 探测 E-B 之间的电阻，这会产生基极偏置
                                    controlRes = this._getEquivalentResistance(this.clusters[bIdx], this.clusters[cIdx], this.clusters);
                                }
                            }

                            if (isTargetPair && controlRes !== Infinity) {
                                const seed = Math.floor(controlRes);

                                // 使用正弦函数模拟一个 0 到 1 之间的伪随机分布
                                const pseudoRandom = Math.abs(Math.sin(seed));

                                // 映射到 6 到 9 之间
                                const factor = 6 + (pseudoRandom * 3);
                                const simulatedR = Math.max(5000, controlRes * factor);
                                R = Math.min(R, simulatedR);
                            }
                        });
                    }
                    dev.update(R === Infinity ? 10000000 : R);
                }
                // 二极管档
                else if (mode === 'DIODE') {
                    const vNode = `${dev.id}_wire_v`;
                    const comNode = `${dev.id}_wire_com`;
                    const vIdx = this.portToCluster.get(vNode);
                    const comIdx = this.portToCluster.get(comNode);

                    let R = Infinity;

                    if (vIdx !== undefined && comIdx !== undefined) {
                        const vCluster = this.clusters[vIdx];
                        const comCluster = this.clusters[comIdx];

                        // --- A. 优先查找普通二极管 ---
                        const diodeDevs = (this._cachedDevs && this._cachedDevs.diodeDevs) || this.rawDevices.filter(d => d.type === 'diode');
                        const isDiode = diodeDevs.find(d => {
                            const dA = this.portToCluster.get(`${d.id}_wire_l`);
                            const dC = this.portToCluster.get(`${d.id}_wire_r`);
                            return (vIdx === dA && comIdx === dC); // 仅正向导通
                        });

                        if (!isDiode) {
                            // --- B. 查找三极管 PN 结 ---
                            const transistorDevs = this.rawDevices.filter(d => d.type === 'bjt');
                            const triodeMatch = transistorDevs.find(t => {
                                const b = this.portToCluster.get(`${t.id}_wire_b`);
                                const c = this.portToCluster.get(`${t.id}_wire_c`);
                                const e = this.portToCluster.get(`${t.id}_wire_e`);

                                const isNPN = (t.subType === 'NPN');

                                // 逻辑：NPN 红笔接B为正向；PNP 黑笔接B为正向
                                const isBasePositive = isNPN ? (vIdx === b) : (comIdx === b);
                                const isBaseNegative = isNPN ? (comIdx === b) : (vIdx === b);

                                if (isBasePositive) {
                                    // 测 BE 结 (红B黑E for NPN)
                                    if (isNPN ? (comIdx === e) : (vIdx === e)) {
                                        R = 0.6868;
                                        return true;
                                    }
                                    // 测 BC 结 (红B黑C for NPN)
                                    if (isNPN ? (comIdx === c) : (vIdx === c)) {
                                        R = 0.6767;
                                        return true;
                                    }
                                }
                                return false;
                            });

                            // --- C. 如果都不是，尝试测量等效电阻 (通断测试) ---
                            if (!triodeMatch) {
                                if (Math.abs(this.getPD(vNode, comNode)) < 0.1) {
                                    R = this._getEquivalentResistance(vCluster, comCluster, this.clusters);
                                }
                            }
                        } else {
                            R = 0.6868;
                        }
                    }
                    // 这里的 10000000 会触发万用表的 O.L 显示
                    dev.update(R === Infinity ? 10000000 : R);
                }
                // 电容档
                else if (mode === 'C') {
                    const vNode = `${dev.id}_wire_v`;
                    const comNode = `${dev.id}_wire_com`;
                    const vIdx = this.portToCluster.get(vNode);
                    const comIdx = this.portToCluster.get(comNode);

                    let C = 0;
                    if (vIdx !== undefined && comIdx !== undefined) {
                        const caps = (this._cachedDevs && this._cachedDevs.capacitorDevs) || this.rawDevices.filter(d => d.type === 'capacitor');
                        const targetCap = caps.find(d => {
                            const dL = this.portToCluster.get(`${d.id}_wire_l`);
                            const dR = this.portToCluster.get(`${d.id}_wire_r`);
                            return (vIdx === dL && comIdx === dR) || (vIdx === dR && comIdx === dL);
                        });
                        if (targetCap) C = targetCap.capacitance * 1000000;
                    }
                    dev.update(C);
                }
                else if (mode.startsWith('ACV')) {
                    const vNode = `${dev.id}_wire_v`;
                    const comNode = `${dev.id}_wire_com`;
                    const vDiff = this.getPD(vNode, comNode);

                    // 1. 初始化设备私有变量（如果不存在）
                    if (dev._sampleTimer === undefined) dev._sampleTimer = 0;
                    if (dev._maxV === undefined) dev._maxV = 0;

                    // 2. 持续捕捉当前半波内的绝对值最大值（峰值）
                    dev._maxV = Math.max(dev._maxV, Math.abs(vDiff));

                    // 3. 累积仿真经过的时间
                    dev._sampleTimer += this.deltaTime;

                    // 4. 判断是否达到半个周期 (50Hz 下半波为 0.01s)
                    const HALF_PERIOD = 0.01;
                    if (dev._sampleTimer >= 2 * HALF_PERIOD) {
                        // 计算有效值：V_rms = V_peak / sqrt(2)
                        const rms = dev._maxV / 1.414;

                        // 过滤极其微小的数值噪声
                        dev._displayRMS = rms < 0.01 ? 0 : rms;

                        // 执行 UI 更新（每 10ms 更新一次读数是稳定的）
                        dev.update(dev._displayRMS);

                        // 重置计数器和峰值，开始下一个半波的采样
                        dev._sampleTimer = 0;
                        dev._maxV = 0;
                    }

                    // 注意：这里去掉了外部的 dev.update，确保只有在半波结束采样完成时才刷新读数
                }
                else {
                    dev.update(0);
                }
            }
            if (dev.type === 'transmitter_2wire') {
                const cP = this.portToCluster.get(`${dev.id}_wire_p`);
                const cN = this.portToCluster.get(`${dev.id}_wire_n`);
                dev.update({ powered: dev._lastVDiff > 10 && cP !== undefined && cN !== undefined , transCurrent: this._calcTransmitterCurrent(dev) * 1000 });
            }

            if (dev.type === 'PID') {
                const inI = Math.abs(this.getVoltageAtPort(`${dev.id}_wire_ni1`) / 250);
                dev.update(inI * 1000);
            }
            // 2. 更新示波器电压和电流
            if (dev.type === 'oscilloscope') {
                // 1. 获取电压通道压差
                const cVH = this.portToCluster.get(`${dev.id}_wire_p`);
                const cVL = this.portToCluster.get(`${dev.id}_wire_n`);
                const vDiff = (this.nodeVoltages.get(cVH) || 0) - (this.nodeVoltages.get(cVL) || 0);

                // 2. 获取电流通道电流
                // 这里的电流直接从 MNA 结果 results 的额外变量列读取（即 0V 电源产生的电流）
                const iVal = dev.physCurrent || 0;
                // 3. 更新示波器波形
                dev.updateTrace(vDiff, iVal, this.globalIterCount);
            }
            if (dev.type === 'oscilloscope_tri') {
                // 1. 定义通道后缀映射
                const channels = [
                    { p: 'ch1p', n: 'ch1n' },
                    { p: 'ch2p', n: 'ch2n' },
                    { p: 'ch3p', n: 'ch3n' }
                ];
                // 2. 循环计算每一路的压差
                const vDiffs = channels.map(ch => {
                    // 获取正负端子对应的电路节点集群 ID
                    const clusP = this.portToCluster.get(`${dev.id}_wire_${ch.p}`);
                    const clusN = this.portToCluster.get(`${dev.id}_wire_${ch.n}`);
                    // 从计算结果 nodeVoltages 中提取电势（如果悬空则默认为 0）
                    const voltP = this.nodeVoltages.get(clusP) || 0;
                    const voltN = this.nodeVoltages.get(clusN) || 0;

                    // 返回该通道的差分电压
                    return voltP - voltN;
                });

                // 3. 将包含 3 个电压值的数组传给示波器更新函数
                // 此时不再需要 iVal，因为三路全是电压通道
                dev.updateTrace(vDiffs, this.globalIterCount);


            }
        });

    }

    //辅助1：用于计算电流表/万用表电流档显示电流
    _calculateBranchCurrent(dev) { // 传入电流表设备对象
        let portP = `${dev.id}_wire_p`;
        let portN = `${dev.id}_wire_n`;
        if (dev.type === 'multimeter') {
            portP = `${dev.id}_wire_ma`;
            portN = `${dev.id}_wire_com`;
        }

        // 搜索时屏蔽掉当前的 dev.id
        const pFuncDevs = this._getConnectedFunctionalDevices(portP, dev.id);
        const nFuncDevs = this._getConnectedFunctionalDevices(portN, dev.id);

        const pHasSource = pFuncDevs.some(d => d.device.type === 'source' || d.device.type === 'source_ac' || d.device.type === 'source_3p' || d.extPort === `${d.device.id}_wire_pi1` || d.device.type === 'gnd');
        // const pHasSource = pFuncDevs.some(d => d.device.type === 'source' || d.extPort === `${d.device.id}_wire_pi1` || d.extPort === `${d.device.id}_wire_OUT` || d.device.type === 'gnd');
        // if (this.debug) console.log(pFuncDevs, nFuncDevs, pHasSource);

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

        // 情况 1： 针对电阻类
        if (dev.type === 'resistor' || dev.type === 'capacitor' || dev.type === 'inductor') {
            const totalCurrent = dev.physCurrent || 0;
            // 如果查询的是左端口，流入为正 (vL > vR 时 current 为正)
            // 如果查询的是右端口，流入为正 (vR > vL 时 current 为负，所以取反)
            return extPort.endsWith('_l') ? -totalCurrent : totalCurrent;
        }
        // 情况 1.2： 针对应变式压力传感器
        if (dev.type === 'pressure_sensor') {
            if (extPort.endsWith('_r1l')) return -(dev.r1Current || 0);
            if (extPort.endsWith('_r1r')) return (dev.r1Current || 0);
            if (extPort.endsWith('_r2l')) return -(dev.r2Current || 0);
            if (extPort.endsWith('_r2r')) return (dev.r2Current || 0);
            return 0;
        }

        // 情况 2：变送器 (2线制)
        if (dev.type === 'transmitter_2wire') {
            const i = (dev._lastVDiff > 10) ? (dev._lastVDiff * (dev._lastG || 0)) : 0;
            // 变送器电流永远从自身的 P 流向 N
            // 如果仪表接在变送器的 N 端，说明电流从变送器流出 -> 进入仪表 (流入)
            if (extPort.endsWith('_n')) return i;
            // 如果仪表接在变送器的 P 端，说明电流进入变送器 -> 离开仪表 (流出)
            if (extPort.endsWith('_p')) return -i;
        }
        // 情况 3. PID 控制器逻辑
        if (dev.type === 'PID') {
            if (extPort.endsWith('_po1') || extPort.endsWith('_no1')) {
                if (dev.outModes.CH1 === '4-20mA') {
                    // 1. 增加开路检测：检查 po1 和 no1 是否在同一个有效回路中
                    const cPo1 = this.portToCluster.get(`${dev.id}_wire_po1`);
                    const cNo1 = this.portToCluster.get(`${dev.id}_wire_no1`);

                    // 利用 portToCluster 索引直接获取 cluster，避免 find 扫描
                    const req = (cPo1 !== undefined && cNo1 !== undefined)
                        ? this._getEquivalentResistance(this.clusters[cPo1], this.clusters[cNo1], this.clusters)
                        : Infinity;

                    // 2. 如果电阻是 Infinity (或远大于正常工业负载，如 > 100kΩ)，说明没连上
                    if (cPo1 === undefined || cNo1 === undefined || req > 100000) return 0;

                    // 3. 只有回路导通，才返回设定电流
                    const i = dev.output1mA / 1000;
                    return extPort.endsWith('_po1') ? i : -i;
                } else if (dev.outModes.CH1 === 'PWM') {
                    //1. 获取两个端口对应的 Cluster
                    const cPo1 = this.portToCluster.get(`${dev.id}_wire_po1`);
                    const cNo1 = this.portToCluster.get(`${dev.id}_wire_no1`);

                    if (cPo1 === undefined || cNo1 === undefined) return 0;



                    // 2. 定义流向：po1 流出为负，no1 流入为正
                    const i = dev.ch1Current || 0;
                    return extPort.endsWith('_po1') ? -i : i;
                }
            }
            if (extPort.endsWith('_po2') || extPort.endsWith('_no2')) {
                if (dev.outModes.CH2 === '4-20mA') {
                    // 1. 增加开路检测：检查 po1 和 no1 是否在同一个有效回路中
                    const cPo2 = this.portToCluster.get(`${dev.id}_wire_po2`);
                    const cNo2 = this.portToCluster.get(`${dev.id}_wire_no2`);

                    // 利用 portToCluster 索引直接获取 cluster，避免 find 扫描
                    const req = (cPo2 !== undefined && cNo2 !== undefined)
                        ? this._getEquivalentResistance(this.clusters[cPo2], this.clusters[cNo2], this.clusters)
                        : Infinity;

                    // 2. 如果电阻是 Infinity (或远大于正常工业负载，如 > 100kΩ)，说明没连上
                    if (cPo2 === undefined || cNo2 === undefined || req > 100000) return 0;

                    // 3. 只有回路导通，才返回设定电流
                    const i = dev.output2mA / 1000;
                    return extPort.endsWith('_po2') ? i : -i;
                } else if (dev.outModes.CH2 === 'PWM') {
                    // 1. 获取两个端口对应的 Cluster
                    const cPo2 = this.portToCluster.get(`${dev.id}_wire_po2`);
                    const cNo2 = this.portToCluster.get(`${dev.id}_wire_no2`);

                    if (cPo2 === undefined || cNo2 === undefined) return 0;

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
        // 情况 3.2：热电偶 (tc)
        if (dev.special === 'tc') {
            const i = dev.physCurrent || 0;
            // 电压源方向：cP = wire_r（正极），cN = wire_l（负极）
            // 电流从 r 流出（进入外部回路正端），从 l 流回
            if (extPort.endsWith('_r')) return -i;
            if (extPort.endsWith('_l')) return i;
            return 0;
        }
        // 情况 4. 运放各端电流        
        if (dev.type === 'amplifier') {
            // 1. 输入端 (P 和 N)：理想运放输入阻抗无穷大，电流为 0
            if (extPort.endsWith('_p') || extPort.endsWith('_n')) {
                return 0;
            }

            // 2. 输出端 (OUT)：直接返回矩阵解出的电流变量
            if (extPort.endsWith('_OUT')) {
                // 注意：在 MNA 中，解出的电压源电流方向通常是“流出”为正或“流入”为正，
                // 取决于你填充矩阵时的符号。
                // 根据你 _solve 里的逻辑：G[outM][opVIdx] += 1
                // 这通常意味着解出的 results[op.currentIdx] 是从 OUT 节点流向外部的电流。
                return -dev.outCurrent || 0;
            }
        }
        // --- 情况5：二极管部分 ---
        if (dev.type === 'diode') {
            const cA = this.portToCluster.get(`${dev.id}_wire_l`); // 正极
            const cC = this.portToCluster.get(`${dev.id}_wire_r`); // 负极
            if (cA === undefined || cC === undefined) {
                dev.physCurrent = 0;
                return 0;
            }
            const current = dev.physCurrent || 0;
            // 这里的极性需根据你的仪表盘习惯定义：通常从 Anode 流入为正
            return extPort.endsWith('_l') ? -current : current;
        }
        // --- 情况6：三级管部分 ---
        if (dev.type === 'bjt') {
            // 如果没有计算过电流，返回 0
            if (!dev.physCurrents) return 0;

            if (extPort.endsWith('_b')) return -dev.physCurrents.b;
            if (extPort.endsWith('_c')) return -dev.physCurrents.c;
            if (extPort.endsWith('_e')) return -dev.physCurrents.e;
        }
        // 情况 6.2：NJFET
        if (dev.type === 'njfet') {
            const i = dev.physCurrent || 0;
            // 标准 JFET：电流从 D 流向 S（当 Vds > 0 时为正）
            if (extPort.endsWith('_d')) return -i;
            if (extPort.endsWith('_s')) return i;
            if (extPort.endsWith('_g')) return 0; // 栅极理想高阻
            return 0;
        }
        // 情况 8：三通道示波器
        if (dev.type === 'oscilloscope_tri') {
            return 0;
        }
        // 情况 8：单通道示波器（已注入，补充端口电流）
        if (dev.type === 'oscilloscope') {
            const i = dev.physCurrent || 0;
            // 理想电流表：电流从 l 流入，从 r 流出
            if (extPort.endsWith('_l')) return i;
            if (extPort.endsWith('_r')) return -i;
            return 0;
        }
        // 情况 9：LVDT / pressure_transducer 输入输出端口
        if (dev.type === 'pressure_transducer') {
            const i = dev.physCurrent || 0;
            // 输出端：电流从 outp 流出，outn 流入
            if (extPort.endsWith('_outp')) return -i;
            if (extPort.endsWith('_outn')) return i;
            // 输入端（原边线圈）：Gmin 极小，实际接近 0
            if (extPort.endsWith('_p') || extPort.endsWith('_n')) {
                const cP = this.portToCluster.get(`${dev.id}_wire_p`);
                const cN = this.portToCluster.get(`${dev.id}_wire_n`);
                const vP = this.nodeVoltages.get(cP) || 0;
                const vN = this.nodeVoltages.get(cN) || 0;
                const iIn = (vP - vN) * 1e-9; // Gmin 注入的极小电流
                return extPort.endsWith('_p') ? -iIn : iIn;
            }
            return 0;
        }
        // ---情况10. 信号发生器两路输出电流        
        if (dev.type === 'signal_generator') {
            let returnCurrent=0;
            const ch1Current = dev.ch1Current || 0;
            const ch2Current = dev.ch2Current || 0;
            if (extPort.endsWith('_ch1p')) returnCurrent = ch1Current;
            else if (extPort.endsWith('_ch1n')) returnCurrent = -ch1Current;
            else if (extPort.endsWith('_ch2p')) returnCurrent = ch2Current;
            else if (extPort.endsWith('_ch2n')) returnCurrent = -ch2Current;
            return returnCurrent;
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
        // 缓存 id->device 映射，避免循环中频繁查找
        const devMap = new Map();
        this.rawDevices.forEach(d => devMap.set(d.id, d));

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
            const dev = devMap.get(devId);

            if (dev) {
                // --- 核心修复：禁止穿透正在进行测量的这个表 ---
                if (dev.id === meterId) {
                    // 如果搜到了自己的端口，记录下来但不允许从这个端口爬到另一个端口
                    continue;
                }

                // 识别功能性设备（终点）
                if (dev.currentResistance >= 0.001 || dev.type === 'source' || dev.type === 'transmitter_2wire' || dev.type === 'PID' || dev.type === 'diode' || dev.type === 'bjt' || dev.type === 'amplifier' || dev.type === 'signal_generator' || dev.type === 'pressure_transducer' || dev.type === 'pressure_sensor' || dev.type === 'oscilloscope' || dev.type === 'oscilloscope_tri' || dev.type === 'capacitor' || dev.type === 'inductor') {
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
        const resistorDevs = (this._cachedDevs && this._cachedDevs.resistorDevs)
            || this.rawDevices.filter(d => d.type === 'resistor');
        if (dev.isBreak === true) return 0;
        if (dev.special === 'temp') {
            const cL = this.portToCluster.get(`${dev.id}_wire_l`);
            const cM = this.portToCluster.get(`${dev.id}_wire_m`);
            const cR = this.portToCluster.get(`${dev.id}_wire_r`);

            // 1. 硬件故障判断：优先级最高，直接返回固定特征电流
            if (cL === undefined || cM === undefined || cR === undefined) return 0.0216; // 未接线
            if (cM !== cR) return 0.0216; // PT100 感温元件开路
            if (cM === cL && cM === cR) return 0.0036; // PT100 短路

            // 2. 正常寻找匹配的 PT100 电阻
            let R = 10000000;
            resistorDevs.forEach(r => {
                const rL = this.portToCluster.get(`${r.id}_wire_l`);
                const rR = this.portToCluster.get(`${r.id}_wire_r`);
                if ((rL === cL && rR === cR) || (rL === cR && rR === cL)) {
                    R = r.currentResistance;
                }
            });

            // 3. 计算电流 (4-20mA 对应 0-100度)
            // 假设 R=100Ω 是 0度 (4mA)，R=138.51Ω 是 100度 (20mA)
            const iRaw = 16 * (R - 100) / 38.51 + 4;
            const iFix = (iRaw - 4) * dev.spanAdj + 4 + dev.zeroAdj;

            // 4. 饱和限制：即使温度超标，电流也只在 3.8mA - 20.5mA 之间波动
            // 只有发生上面第1步的“断路”才会跳到 21.6mA
            return Math.max(0.0038, Math.min(0.0205, iFix / 1000));
        } else if (dev.special === 'press' || dev.special === 'diff') {
            const percent = (dev.press - dev.min) / (dev.max - dev.min);
            const iRaw = 16 * percent + 4;
            const iFix = (iRaw - 4) * dev.spanAdj + 4 + dev.zeroAdj;
            return Math.max(0.0038, Math.min(0.0205, iFix / 1000));
        }else if (dev.special === 'voltage') {
            dev.voltage = this.getPD(`${dev.id}_wire_l`,`${dev.id}_wire_r`)*1000;
            const percent = (Math.abs(dev.voltage) - dev.min) / (dev.max - dev.min);
            const iRaw = 16 * percent + 4;
            const iFix = (iRaw - 4) * dev.spanAdj + 4 + dev.zeroAdj;
            return Math.max(0.0038, Math.min(0.0205, iFix / 1000));
        }

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

    isPortConnected(pA, pB) {
        const idxA = this.portToCluster.get(pA);
        const idxB = this.portToCluster.get(pB);
        return (idxA !== undefined && idxB !== undefined && idxA === idxB);
    }

    //辅助6：用于电阻档测量。
    /* 改进方案：利用矩阵“试探法” (The Matrix Injection Method)不要手动去数路径，而是模拟万用表测量电阻的过程：在 A 节点注入 $1\text{A}$ 电流。将 B 节点设定为 GND ($0\text{V}$)。求解此时 A 节点的电压 $V_A$。根据欧姆定律 $R = V / I$，因为 $I=1$，所以 $R = V_A$。这种方法无论中间串了 3 个、10 个还是并联了复杂的电桥，都能算得准。 */
    _getEquivalentResistance(startCluster, endCluster, allClusters) {
        const startIdx = allClusters.indexOf(startCluster);
        const endIdx = allClusters.indexOf(endCluster);

        if (startIdx === -1 || endIdx === -1) return Infinity;
        if (startIdx === endIdx) return 0;

        // 尝试从缓存读取（基于拓扑签名 + 节点对）
        const cacheKey = `${startIdx}_${endIdx}`;
        if (this._equivResCache && this._equivResCache.has(cacheKey)) {
            return this._equivResCache.get(cacheKey);
        }

        // 1. 准备一个临时的节点地图（排除 endIdx 作为参考地）
        const nodeMap = new Map();
        let mSize = 0;
        for (let i = 0; i < allClusters.length; i++) {
            if (i !== endIdx) nodeMap.set(i, mSize++);
        }

        if (mSize === 0) return Infinity;

        const G = Array.from({ length: mSize }, () => new Float64Array(mSize));
        const B = new Float64Array(mSize);

        // 2. 预计算所有电阻的簇索引，避免在每对簇中重复遍历所有设备
        const resistorList = [];
        for (let k = 0; k < this.rawDevices.length; k++) {
            const dev = this.rawDevices[k];

            // --- 处理普通电阻和 PT100 ---
            if (dev.type === 'resistor') {
                const lIdx = this.portToCluster.get(`${dev.id}_wire_l`);
                let rIdx = this.portToCluster.get(`${dev.id}_wire_r`);

                // 兼容 pt100 特殊端口逻辑
                if (dev.special === 'pt100' && rIdx === undefined) {
                    rIdx = this.portToCluster.get(`${dev.id}_wire_t`);
                }

                if (lIdx !== undefined && rIdx !== undefined) {
                    const r = (dev.currentResistance === undefined) ? 1e9 : dev.currentResistance;
                    resistorList.push({ l: lIdx, r: rIdx, R: r });
                }
            }

            // --- 处理压力传感器 (双路独立电阻) ---
            if (dev.type === 'pressure_sensor') {
                // 1. 处理 r1 支路 (左侧)
                const r1lIdx = this.portToCluster.get(`${dev.id}_wire_r1l`);
                const r1rIdx = this.portToCluster.get(`${dev.id}_wire_r1r`);
                if (r1lIdx !== undefined && r1rIdx !== undefined) {
                    const r1Val = (dev.r1 === undefined) ? 1e9 : dev.r1;
                    resistorList.push({ l: r1lIdx, r: r1rIdx, R: r1Val });
                }

                // 2. 处理 r2 支路 (右侧)
                const r2lIdx = this.portToCluster.get(`${dev.id}_wire_r2l`);
                const r2rIdx = this.portToCluster.get(`${dev.id}_wire_r2r`);
                if (r2lIdx !== undefined && r2rIdx !== undefined) {
                    const r2Val = (dev.r2 === undefined) ? 1e9 : dev.r2;
                    resistorList.push({ l: r2lIdx, r: r2rIdx, R: r2Val });
                }
            }
        }

        // 3. 填充矩阵：遍历簇对并汇总并联电导（仅遍历一次 resistorList）
        for (let i = 0; i < allClusters.length; i++) {
            for (let j = i + 1; j < allClusters.length; j++) {
                let inverseRSum = 0;
                let resistorCount = 0;
                let hasZeroResistor = false;
                for (let t = 0; t < resistorList.length; t++) {
                    const re = resistorList[t];
                    if ((re.l === i && re.r === j) || (re.l === j && re.r === i)) {
                        resistorCount++;
                        if (re.R < 0.001) { hasZeroResistor = true; break; }
                        inverseRSum += 1 / re.R;
                    }
                }
                let totalR = Infinity;
                if (hasZeroResistor) totalR = 0;
                else if (resistorCount > 0) totalR = 1 / inverseRSum;

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

        // 4. 在 A 节点注入 1A 电流
        const aNodeIdx = nodeMap.get(startIdx);
        if (aNodeIdx === undefined) return Infinity; // A 到 B 完全不通
        B[aNodeIdx] = 1.0;

        // 5. 注入 GMIN 保证非奇异矩阵（防止悬空）
        for (let i = 0; i < mSize; i++) G[i][i] += 1e-15;

        // 6. 求解电压
        try {
            const results = this._gauss(G, B);
            const vA = results[aNodeIdx];
            const out = (vA > 1e9) ? Infinity : vA;
            if (this._equivResCache) this._equivResCache.set(cacheKey, out);
            return out;
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
                const p0InA = clusterA.has(`${dev.id}_wire_l`);

                let p1InB = clusterB.has(`${dev.id}_wire_r`);
                if (dev.special === 'pt100') p1InB = clusterB.has(`${dev.id}_wire_r`) || clusterB.has(`${dev.id}_wire_t`);
                const p0InB = clusterB.has(`${dev.id}_wire_l`);
                let p1InA = clusterA.has(`${dev.id}_wire_r`);
                if (dev.special === 'pt100') p1InA = clusterA.has(`${dev.id}_wire_r`) || clusterA.has(`${dev.id}_wire_t`);

                if ((p0InA && p1InB) || (p0InB && p1InA)) {
                    let r = dev.currentResistance;
                    if (r === undefined) r = 1e9;
                    if (r < 0.001) hasZeroResistor = true;
                    else inverseRSum += (1 / r);
                    resistorCount++;
                }
            }
            // --- 逻辑 B：处理压力传感器 (双回路电阻) ---
            if (dev.type === 'pressure_sensor') {
                // 1. 检查 r1 支路 (左侧端口 r1l 和 r1r)
                const r1l_InA = clusterA.has(`${dev.id}_wire_r1l`);
                const r1r_InB = clusterB.has(`${dev.id}_wire_r1r`);
                const r1l_InB = clusterB.has(`${dev.id}_wire_r1l`);
                const r1r_InA = clusterA.has(`${dev.id}_wire_r1r`);

                if ((r1l_InA && r1r_InB) || (r1l_InB && r1r_InA)) {
                    processResistor(dev.r1);
                }

                // 2. 检查 r2 支路 (右侧端口 r2l 和 r2r)
                const r2l_InA = clusterA.has(`${dev.id}_wire_r2l`);
                const r2r_InB = clusterB.has(`${dev.id}_wire_r2r`);
                const r2l_InB = clusterB.has(`${dev.id}_wire_r2l`);
                const r2r_InA = clusterA.has(`${dev.id}_wire_r2r`);

                if ((r2l_InA && r2r_InB) || (r2l_InB && r2r_InA)) {
                    processResistor(dev.r2);
                }
            }
        });
        // 内部处理函数：累加电导或标记短路
        function processResistor(rValue) {
            let r = rValue;
            if (r === undefined) r = 1e9;
            if (r < 0.001) hasZeroResistor = true;
            else inverseRSum += (1 / r);
            resistorCount++;
        }
        // 逻辑处理
        if (hasZeroResistor) return { totalR: 0, count: resistorCount }; // 只要有一个0电阻并联，总电阻就是0
        if (resistorCount === 0) return { totalR: Infinity, count: 0 }; // 无连接，开路

        return {
            totalR: 1 / inverseRSum,
            count: resistorCount
        };
    }

}