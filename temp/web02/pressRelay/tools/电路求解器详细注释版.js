/**
 * 电路求解类 V4.0 - 集成仪表自动更新功能
 * 采用 MNA (修正节点分析法) 算法
 */
export class CircuitSolver {
    constructor(devices) {
        this.rawDevices = devices;         // 存储所有设备实例的引用
        this.portToCluster = new Map();    // 端口 ID -> 电位集群(Cluster)索引的映射
        this.nodeVoltages = new Map();     // 集群索引 -> 计算出的电压值的映射
        this.clusters = [];               // 存储所有的等电位端口集合
        this.clusterCount = 0;             // 当前电路中独立电位点的数量
        this.gndClusterIndices = new Set(); // 存储被识别为“地(GND)”的集群索引
        this.vPosMap = new Map();          // 存储已知电源正极电压的集群索引
    }

    /**
     * 每一帧的主入口
     * @param {Array} conns - 当前画布上所有的导线连接关系
     */
    update(conns) {
        // --- 关键：每次更新前重置所有中间计算状态，防止旧连接干扰 ---
        this.portToCluster.clear();
        this.nodeVoltages.clear();
        this.gndClusterIndices.clear();
        this.vPosMap.clear();
        this.clusters = [];

        // 仅过滤出类型为 'wire' 的连接进行处理
        this.connections = conns.filter(c => c.type === 'wire');

        this._buildTopology();      // 1. 建立拓扑：弄清楚哪些端口连在了一起，形成一个“集群”
        this._solve();              // 2. 核心求解：构建矩阵方程并求解电压/电流
        this._updateInstruments();  // 3. 更新仪表：将求解结果回传给万用表、电流表等 UI 组件
    }

    /**
     * 1. 拓扑构建 (并查集算法 + 零电阻穿透)
     */
    _buildTopology() {
        const parent = {};
        // 并查集的“查找”操作，带路径压缩优化
        const find = (i) => (parent[i] === undefined || parent[i] === i) ? i : (parent[i] = find(parent[i]));
        // 并查集的“合并”操作，将两个端口连通
        const union = (i, j) => {
            const rI = find(i), rJ = find(j);
            if (rI !== rJ) parent[rI] = rJ;
        };

        const allPorts = new Set();

        // 遍历所有导线，将导线两端的端口合并为一个集群
        this.connections.forEach(c => {
            allPorts.add(c.from);
            allPorts.add(c.to);
            union(c.from, c.to);
        });

        // 处理设备内部逻辑：如果是“零电阻”状态，内部两个端口也要合并
        this.rawDevices.forEach(dev => {
            const ps = this._getDevicePorts(dev.id);
            ps.forEach(p => allPorts.add(p));

            const id = dev.id;
            // 开关合上、继电器动作、电流表、万用表电流档：视为短路直通
            if (dev.type === 'switch' && !dev.isOpen) union(`${id}_wire_l`, `${id}_wire_r`);
            if (dev.type === 'relay' && dev.isEnergized) union(`${id}_wire_NO`, `${id}_wire_COM`);
            if (dev.type === 'ampmeter') union(`${id}_wire_p`, `${id}_wire_n`);
            if (dev.type === 'multimeter' && dev.mode === 'MA') union(`${id}_wire_ma`, `${id}_wire_com`);
            if (dev.currentResistance < 0.001) union(`${id}_wire_l`, `${id}_wire_r`);
        });

        // 将并查集的结果转换为 0, 1, 2... 这种连续的索引，方便矩阵计算
        const clusterIndex = new Map();
        let idx = 0;
        allPorts.forEach(p => {
            const root = find(p);
            if (!clusterIndex.has(root)) clusterIndex.set(root, idx++);
            this.portToCluster.set(p, clusterIndex.get(root));
        });
        this.clusterCount = idx;

        // 生成最终的 clusters 集合（Set 数组），方便后续查找
        const clusterMap = {};
        allPorts.forEach(p => {
            const root = find(p);
            if (!clusterMap[root]) clusterMap[root] = new Set();
            clusterMap[root].add(p);
        });
        this.clusters = Object.values(clusterMap);
    }

    // 辅助：获取某个设备可能存在的所有物理端口名
    _getDevicePorts(id) {
        const sfx = ['_l', '_m', '_r', '_p', '_n', '_v', '_ma', '_com', '_COM', '_NO'];
        return sfx.map(s => `${id}_wire${s}`).filter(p => this.portToCluster.has(p));
    }

    /**
     * 2. 核心求解 (节点电压法 MNA)
     */
    _solve() {
        // 筛选出电源和 PID 控制器
        const powerDevs = this.rawDevices.filter(d => d.type === 'source');
        if (powerDevs.length === 0) return;
        const pidDevs = this.rawDevices.filter(d => d.type === 'PID');

        // 遍历所有类型为 'source'（电源）的设备实例
        powerDevs.forEach(p => {
            // 1. 构造该电源设备对应的两个物理端口 ID
            // pId 为电源正极（Positive），nId 为电源负极（Negative/GND）
            const pId = `${p.id}_wire_p`, nId = `${p.id}_wire_n`;

            // 2. 处理电源负极 (nId) -> 设为电路的参考地 (GND)
            // 检查这个负极端口是否连接到了任何导线或集群中
            if (this.portToCluster.has(nId)) {
                // 获取该端口所属的电位集群索引，并将其加入到 gndClusterIndices 集合中
                // 在后续计算中，这些集群的电压将被强制设为 0V
                this.gndClusterIndices.add(this.portToCluster.get(nId));
            }

            // 3. 处理电源正极 (pId) -> 设为已知的高电位点
            // 检查这个正极端口是否连接到了任何导线或集群中
            if (this.portToCluster.has(pId)) {
                // p.getValue() 获取电源当前的输出电压值（如 24 或 12）
                // 在 vPosMap 中记录：该集群索引对应的电压是固定的电源电压
                // 这在 MNA 矩阵中作为已知量，用来驱动电流在电阻网络中流动
                this.vPosMap.set(this.portToCluster.get(pId), p.getValue());
            }
        });

        // 1. 创建一个映射表：[集群索引] -> [矩阵行/列索引]
        const nodeMap = new Map();

        // 2. 初始化矩阵计数器（即矩阵的大小/维数）
        let mSize = 0;

        // 3. 遍历电路中所有的电位集群（每个 Cluster 代表一个电位点）
        for (let i = 0; i < this.clusterCount; i++) {

            // --- 关键过滤逻辑 ---
            // A. 如果这个点不是 GND (地)
            // B. 且这个点不是电源正极 (已知电压点)
            if (!this.gndClusterIndices.has(i) && !this.vPosMap.has(i)) {

                // 那么这个点就是“电压未知”的点，需要建立方程来求解
                // 将该 Cluster 索引 i 映射到矩阵的第 mSize 行/列
                nodeMap.set(i, mSize++);
            }
        }

        if (mSize === 0) { this._assignKnown(); return; }

        // MNA 扩展：如果电路中有独立电压源（如 PID 供电或 PWM），需要增加额外的方程行
        let extraEqCount = 0;
        pidDevs.forEach(pid => {
            if (this.portToCluster.has(`${pid.id}_wire_pi1`)) extraEqCount++;
            if (pid.outModes.CH1 === 'PWM' && this.portToCluster.has(`${pid.id}_wire_po1`)) extraEqCount++;
            if (pid.outModes.CH2 === 'PWM' && this.portToCluster.has(`${pid.id}_wire_po2`)) extraEqCount++;
        });
        /* 这段代码标志着从物理拓扑（导线连接）正式进入了数学建模（矩阵构建）阶段。它正在为修正节点分析法 (Modified Nodal Analysis, MNA) 准备容器。在电路仿真中，我们需要解方程组 $G \cdot x = B$。这里的代码就是在初始化这个 $G$（系数矩阵）和 $B$（常数向量）
        参数详细解析
        1. totalSize (矩阵的总维数)定义：totalSize = mSize + extraEqCount。含义：这是最终线性方程组中未知数的总个数。构成：mSize：未知节点电压的数量（即你之前代码里过滤出的那些既不是 GND 也不是电源正极的节点）。extraEqCount：额外增加的方程数量。在 MNA 中，每当电路中出现一个电压源或理想电感时，我们就无法仅靠节点电压法（KCL）求出其支路电流。因此，我们必须把这些设备的“支路电流”也当作未知数，并为它们各增加一个描述电压差关系的方程。
        2. G (电导矩阵 / 系数矩阵)数据结构：Array.from({ length: totalSize }, () => new Float64Array(totalSize))。这是一个 totalSize \times totalSize 的二维方阵。使用 Float64Array 是为了保证浮点运算的精度和内存效率。物理意义：左上角 $mSize \times mSize$ 的区域主要填充电导（$1/R$）。其他扩展区域填充 $1$ 或 $-1$，用来关联节点电压与支路电流。它是描述电路内部结构的“骨架”。
        3. B (结果向量 / 常数向量)数据结构：长度为 totalSize 的一维浮点数组。物理意义：方程等号右边的值。对于节点方程，它代表流入该节点的已知电流源值。对于扩展方程（电压源），它代表该电压源的额定电压。解出方程后，这个向量与 $G$ 的逆矩阵（或通过 LU 分解）结合，就能算出所有的未知电压和电流。
        4. currentVSourceIdx (扩展方程起始索引)定义：let currentVSourceIdx = mSize;。作用：这是一个指针（计数器）。因为矩阵的前 mSize 行/列已经分配给了“节点电压”，所以第 mSize 行就是第一个“支路电流”未知数的位置。处理流程：每当程序遍历到一个电压源设备时，它会占用 G[currentVSourceIdx] 这一行，然后执行 currentVSourceIdx++，直到把所有电压源的约束条件填完。
        有了这三个参数，程序接下来通常会进入 _fillMatrix（填充矩阵） 环节：遍历电阻：将电导值 $G = 1/R$ 加到 G 矩阵的节点对应位置。遍历电压源：在 G 的 currentVSourceIdx 位置填入 $1$ 和 $-1$，并在 B 向量对应位置填入电压值。
        */
        const totalSize = mSize + extraEqCount;
        const G = Array.from({ length: totalSize }, () => new Float64Array(totalSize)); // 电导矩阵
        const B = new Float64Array(totalSize);                                         // 结果向量
        let currentVSourceIdx = mSize; // 扩展方程（支路电流项）的起始位置

        // 填充普通电阻（线性负载）
        this.rawDevices.forEach(dev => {
            if (['source', 'transmitter_2wire', 'PID'].includes(dev.type) || dev.currentResistance < 0.001) return;
            const c1 = this.portToCluster.get(`${dev.id}_wire_l`);
            const c2 = this.portToCluster.get(`${dev.id}_wire_r`);
            let devResistance = 1e9; // 默认极高电阻
            if (dev.currentResistance !== undefined) devResistance = dev.currentResistance;
            if (c1 !== undefined && c2 !== undefined) {
                this._fillMatrix(G, B, nodeMap, c1, c2, 1 / devResistance); // 注入 G = 1/R
            }
        });
        /* 对于连接在集群 c1 和 c2 之间的电阻，_fillMatrix 会执行以下数学操作：查找 c1 和 c2 在 nodeMap 中对应的矩阵索引（假设为 $i$ 和 $j$）。在矩阵 $G$ 的四个位置进行累加：
        $G[i][i] += G_{dev}$ （节点 $i$ 的自导）
        $G[j][j] += G_{dev}$ （节点 $j$ 的自导）
        $G[i][j] -= G_{dev}$ （节点 $i, j$ 之间的互导）
        $G[j][i] -= G_{dev}$ （节点 $j, i$ 之间的互导） */


        // 填充变送器（非线性，作为“压控电导”注入，利用上一帧结果迭代）
        this.rawDevices.filter(d => d.type === 'transmitter_2wire').forEach(dev => {
            const cP = this.portToCluster.get(`${dev.id}_wire_p`);
            const cN = this.portToCluster.get(`${dev.id}_wire_n`);
            if (cP === undefined || cN === undefined) return;
            const lastV = dev._lastVDiff !== undefined ? dev._lastVDiff : 0;
            let dynamicG;
            if (lastV < 10) { dynamicG = 1 / 1e9; } // 低于 10V 不起振，截止状态
            else {
                const targetI = this._calcTransmitterCurrent(dev);
                dynamicG = targetI / lastV; // 根据期望电流计算等效电导
            }
            if (dev._lastG === undefined) dev._lastG = dynamicG;
            dev._lastG = (dynamicG + dev._lastG) / 2; // 阻尼平滑，防止数值震荡
            this._fillMatrix(G, B, nodeMap, cP, cN, dev._lastG);
        });

        // 填充 PID 控制器
        pidDevs.forEach(pid => {
            if (!pid.powerOn) { pid.ch1Current = 0; pid.ch2Current = 0; return; }
            const p = `${pid.id}_wire_`;

            // 5.1 模拟内部馈电端口 pi1 (固定 24V 输出)
            const cPi1 = this.portToCluster.get(`${p}pi1`);
            const cNi1 = this.portToCluster.get(`${p}ni1`);
            if (cPi1 !== undefined) this._addVoltageSourceToMNA(G, B, nodeMap, cPi1, -1, this.getVoltageAtPort(`${p}vcc`)||24, currentVSourceIdx++);
            if (cNi1 !== undefined) this._fillMatrix(G, B, nodeMap, cNi1, -1, 1 / 250); // ni1 内部有 250Ω 取样电阻接地

            // 5.2 CH1 输出逻辑 (4-20mA 恒流或 PWM 瞬时电压)
            const cPo1 = this.portToCluster.get(`${p}po1`);
            const cNo1 = this.portToCluster.get(`${p}no1`);
            if (cPo1 !== undefined && cNo1 !== undefined) {
                if (pid.outModes.CH1 === '4-20mA') {
                    this._addCurrentSourceToMNA(B, nodeMap, cPo1, cNo1, pid.output1mA / 1000); // 注入受控电流源
                } else if (pid.outModes.CH1 === 'PWM') {
                    pid.ch1VSourceIdx = currentVSourceIdx;
                    const vcc = this.getVoltageAtPort(`${p}vcc`) || 24;
                    const vTarget = pid.heatInstantOn ? vcc : 0; // 瞬时模式：要么是 24V 要么是 0V
                    this._addVoltageSourceToMNA(G, B, nodeMap, cPo1, cNo1, vTarget, currentVSourceIdx++);
                }
            }
            // 5.3 CH2 输出逻辑 (同 CH1)
            const cPo2 = this.portToCluster.get(`${p}po2`);
            const cNo2 = this.portToCluster.get(`${p}no2`);
            if (cPo2 !== undefined && cNo2 !== undefined) {
                if (pid.outModes.CH2 === '4-20mA') {
                    this._addCurrentSourceToMNA(B, nodeMap, cPo2, cNo2, pid.output2mA / 1000);
                } else if (pid.outModes.CH2 === 'PWM') {
                    pid.ch2VSourceIdx = currentVSourceIdx;
                    const vcc = this.getVoltageAtPort(`${p}vcc`) || 24;
                    const vTarget = pid.coolInstantOn ? vcc : 0;
                    this._addVoltageSourceToMNA(G, B, nodeMap, cPo2, cNo2, vTarget, currentVSourceIdx++);
                }
            }
        });

        // 注入极小值 GMIN (1e-12) 确保矩阵每一行都有值，防止由于电路悬空导致的奇异矩阵无法求解
        const GMIN = 1e-12;
        for (let i = 0; i < totalSize; i++) G[i][i] += GMIN;

        // 执行高斯消元法求解线性方程组
        const results = this._gauss(G, B);
        this._assignKnown(); // 先填入已知电压点

        // 将求解出的未知电压填入 nodeVoltages 映射中
        nodeMap.forEach((mIdx, cIdx) => this.nodeVoltages.set(cIdx, results[mIdx]));

        // 为下一帧缓存变送器压差
        this.rawDevices.filter(d => d.type === 'transmitter_2wire').forEach(dev => {
            dev._lastVDiff = this.getPD(`${dev.id}_wire_p`, `${dev.id}_wire_n`);
        });

        // 从解向量中提取 PWM 支路的瞬时电流值 (支路电流就在解向量的末尾部分)
        pidDevs.forEach(pid => {
            if (pid.ch1VSourceIdx !== undefined) pid.ch1Current = results[pid.ch1VSourceIdx];
            if (pid.ch2VSourceIdx !== undefined) pid.ch2Current = results[pid.ch2VSourceIdx];
        });
    }

    /**
     * 将电阻电导注入电导矩阵 G 和结果向量 B
     */
    _fillMatrix(G, B, nodeMap, c1, c2, g) {
        if (c1 === undefined || c2 === undefined) return;
        const get = (c) => {
            if (this.gndClusterIndices.has(c)) return { t: 'g' }; // 地节点
            if (this.vPosMap.has(c)) return { t: 'v', v: this.vPosMap.get(c) }; // 已知电源节点
            const idx = nodeMap.get(c);
            return idx === undefined ? { t: 'none' } : { t: 'u', i: idx }; // 未知电压节点
        };
        const n1 = get(c1), n2 = get(c2);
        // 根据节点类型，向矩阵对应位置累加 g 或在 B 中注入 I = G*V
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

    // 辅助：初始化 nodeVoltages，填入 0V 和电源电压
    _assignKnown() {
        this.gndClusterIndices.forEach(idx => this.nodeVoltages.set(idx, 0));
        this.vPosMap.forEach((v, idx) => this.nodeVoltages.set(idx, v));
    }

    /**
     * 高斯消元法求解方程组 Ax = b
     */
    _gauss(A, b) {
        const n = b.length;
        for (let i = 0; i < n; i++) {
            let pivot = A[i][i];
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
            x[i] = (b[i] - s) / A[i][i];
        }
        return x;
    }

    /**
     * 在 MNA 矩阵中添加电压源方程 V(c1) - V(c2) = voltage
     */
    _addVoltageSourceToMNA(G, B, nodeMap, c1, c2, voltage, vIdx) {
        const i = this.gndClusterIndices.has(c1) ? -1 : (this.vPosMap.has(c1) ? -2 : nodeMap.get(c1));
        const j = (c2 === -1 || this.gndClusterIndices.has(c2)) ? -1 : (this.vPosMap.has(c2) ? -2 : nodeMap.get(c2));

        let adjustedV = voltage;
        if (this.vPosMap.has(c1)) adjustedV -= this.vPosMap.get(c1);
        if (this.vPosMap.has(c2)) adjustedV += this.vPosMap.get(c2);
        B[vIdx] = adjustedV; // 设定目标电压差

        // 在电导矩阵中添加 1 和 -1 的系数（KCL 支路关联）
        if (i >= 0) { G[vIdx][i] = 1; G[i][vIdx] = 1; }
        if (j >= 0) { G[vIdx][j] = -1; G[j][vIdx] = -1; }
    }

    /**
     * 在 MNA 矩阵中添加理想电流源
     */
    _addCurrentSourceToMNA(B, nodeMap, cPos, cNeg, current) {
        const i = nodeMap.get(cPos);
        const j = nodeMap.get(cNeg);
        if (i !== undefined) B[i] += current;  // 流入节点
        if (j !== undefined) B[j] -= current;  // 流出节点
    }

    /**
     * 3. 更新仪表状态：将物理世界的数值传回 UI 组件
     */
    _updateInstruments() {
        this.rawDevices.forEach(dev => {
            // 1. 更新电流表/万用表 mA 档
            if (dev.type === 'ampmeter' || (dev.type === 'multimeter' && dev.mode === 'MA')) {
                const pId = dev.type === 'ampmeter' ? `${dev.id}_wire_p` : `${dev.id}_wire_ma`;
                const nId = dev.type === 'ampmeter' ? `${dev.id}_wire_n` : `${dev.id}_wire_com`;
                if (this.portToCluster.get(pId) === undefined || this.portToCluster.get(nId) === undefined) {
                    dev.update(0);
                } else {
                    const current = this._calculateBranchCurrent(dev); // 使用物理流向判定法计算电流
                    dev.update(current * 1000); // 单位转为 mA
                }
            }

            // 2. 更新万用表其他档位
            if (dev.type === 'multimeter') {
                const mode = dev.mode || 'OFF';
                if (mode.startsWith('DCV')) { // 电压档：计算端口电位差
                    dev.update(this.getPD(`${dev.id}_wire_v`, `${dev.id}_wire_com`));
                } else if (mode.startsWith('RES')) { // 电阻档：调用等效电阻计算算法
                    const comNode = `${dev.id}_wire_com`, vNode = `${dev.id}_wire_v`;
                    const comCluster = this.clusters.find(c => c.has(comNode));
                    const vCluster = this.clusters.find(c => c.has(vNode));
                    let R = Infinity;
                    // 仅当电路断电时测量电阻才有物理意义（此处简化处理）
                    if (comCluster && vCluster && Math.abs(this.getPD(vNode, comNode)) < 0.1) {
                        R = this._getEquivalentResistance(comCluster, vCluster, this.clusters);
                    }
                    dev.update(R === Infinity ? 10000000 : R);
                } else { dev.update(0); }
            }

            // 3. 更新变送器：显示状态（受电否）及计算当前 4-20mA 电流
            if (dev.type === 'transmitter_2wire') {
                const cP = this.portToCluster.get(`${dev.id}_wire_p`);
                const cN = this.portToCluster.get(`${dev.id}_wire_n`);
                dev.update({
                    powered: dev._lastVDiff > 10 && cP !== undefined && cN !== undefined && dev.isOpened === false,
                    transCurrent: this._calcTransmitterCurrent(dev) * 1000
                });
            }

            // 4. 更新 PID 输入显示：基于 ni1 端口流过的电流
            if (dev.type === 'PID') {
                const inI = Math.abs(this.getVoltageAtPort(`${dev.id}_wire_ni1`) / 250);
                dev.update(inI * 1000);
            }
        });
    }

    /**
     * 辅助：计算流经某个仪表的实际支路电流
     * 策略：寻找所有与表头连接的功能设备，并汇总它们的物理流入/流出量
     */
    _calculateBranchCurrent(dev) {
        let portP = dev.type === 'multimeter' ? `${dev.id}_wire_ma` : `${dev.id}_wire_p`;
        let portN = dev.type === 'multimeter' ? `${dev.id}_wire_com` : `${dev.id}_wire_n`;

        const pFuncDevs = this._getConnectedFunctionalDevices(portP, dev.id);
        const nFuncDevs = this._getConnectedFunctionalDevices(portN, dev.id);

        // 如果 P 端连接了电源，通常选择从 N 端统计电流以获得更稳定的数值
        const pHasSource = pFuncDevs.some(d => d.device.type === 'source' || d.extPort === `${d.device.id}_wire_pi1`);

        if (pHasSource) {
            let iInN = 0;
            nFuncDevs.forEach(item => { iInN += this._getPhysicalFlowIntoPort(item.device, item.extPort); });
            return -iInN; // N 端流出定义为正读数
        } else {
            let iInP = 0;
            pFuncDevs.forEach(item => { iInP += this._getPhysicalFlowIntoPort(item.device, item.extPort); });
            return iInP; // P 端流入定义为正读数
        }
    }

    /**
     * 辅助：判定具体某个设备的电流方向和数值
     */
    _getPhysicalFlowIntoPort(dev, extPort) {
        // A. 普通负载电阻：I = deltaV / R
        if (dev.currentResistance >= 0.001 && dev.type !== 'source') {
            const otherPort = (extPort === `${dev.id}_wire_l`) ? `${dev.id}_wire_r` : `${dev.id}_wire_l`;
            return this.getPD(otherPort, extPort) / dev.currentResistance;
        }
        // B. 变送器：电流恒定从 P 流向 N
        if (dev.type === 'transmitter_2wire') {
            const i = (dev._lastVDiff > 10) ? (dev._lastVDiff * (dev._lastG || 0)) : 0;
            return extPort.endsWith('_n') ? i : -i;
        }
        // C. PID 控制器：根据输出模式返回设定电流或 MNA 求解的瞬时电流
        if (dev.type === 'PID') {
            if (extPort.endsWith('_po1') || extPort.endsWith('_no1')) {
                if (dev.outModes.CH1 === '4-20mA') {
                    // 恒流模式需检测回路是否闭合
                    const req = this._getEquivalentResistance(
                        this.clusters.find(c => c.has(`${dev.id}_wire_po1`)),
                        this.clusters.find(c => c.has(`${dev.id}_wire_no1`)),
                        this.clusters
                    );
                    if (req > 100000) return 0; // 回路开路
                    const i = dev.output1mA / 1000;
                    return extPort.endsWith('_po1') ? i : -i;
                } else if (dev.outModes.CH1 === 'PWM') {
                    const i = dev.ch1Current || 0; // PWM 模式直接取矩阵解出的支路电流
                    return extPort.endsWith('_po1') ? i : -i;
                }
            }
            // pi1/ni1 供电回路逻辑
            if (extPort.endsWith('_pi1') || extPort.endsWith('_ni1')) {
                const iLoop = this.getVoltageAtPort(`${dev.id}_wire_ni1`) / 250;
                return extPort.endsWith('_pi1') ? -iLoop : iLoop;
            }
        }
        return 0;
    }

    /**
     * 辅助：通过 BFS 算法在零电阻网络中搜索所有连接的功能设备
     */
    _getConnectedFunctionalDevices(meterPort, meterId) {
        const found = [];
        const visitedPorts = new Set();
        const queue = [meterPort];
        const processedZeroResDevs = new Set();

        while (queue.length > 0) {
            const curr = queue.shift();
            if (visitedPorts.has(curr)) continue;
            visitedPorts.add(curr);

            // 沿导线爬行
            this.connections.forEach(conn => {
                if (conn.from === curr) queue.push(conn.to);
                else if (conn.to === curr) queue.push(conn.from);
            });

            const devId = curr.split('_wire_')[0];
            const dev = this.rawDevices.find(d => d.id === devId);
            if (dev) {
                if (dev.id === meterId) continue; // 不允许爬过仪表自身，否则会短路回路
                // 记录有电阻或有源的设备
                if (dev.currentResistance >= 0.001 || dev.type === 'source' || dev.type === 'transmitter_2wire' || dev.type === 'PID') {
                    found.push({ device: dev, extPort: curr });
                }
                // 穿透零电阻设备继续搜索
                if (!processedZeroResDevs.has(dev.id) && this._isZeroResistanceDevice(dev)) {
                    processedZeroResDevs.add(dev.id);
                    this._getDevicePorts(dev.id).forEach(p => queue.push(p));
                }
            }
        }
        return found;
    }

    // 辅助：判定是否为“直通”设备
    _isZeroResistanceDevice(dev) {
        if (dev.type === 'ampmeter' || (dev.type === 'multimeter' && dev.mode === 'MA')) return true;
        if (dev.type === 'switch' && !dev.isOpen) return true;
        if (dev.type === 'relay' && dev.isEnergized) return true;
        return (dev.currentResistance < 0.001 && dev.type !== 'source');
    }

    /**
     * 变送器电流计算逻辑 (基于 PT100 温度传感器阻值)
     */
    _calcTransmitterCurrent(dev) {
        if (dev.isOpened === true) return 0;
        const cL = this.portToCluster.get(`${dev.id}_wire_l`);
        const cM = this.portToCluster.get(`${dev.id}_wire_m`);
        const cR = this.portToCluster.get(`${dev.id}_wire_r`);

        // 硬件连接异常检测（开路、短路）
        if (cL === undefined || cM === undefined || cR === undefined) return 0.0216; // 传感器断线，电流打满
        if (cM !== cR) return 0.0216; // PT100 三线制补偿线开路
        if (cM === cL && cM === cR) return 0.0036; // PT100 阻值短路，电流过低报警

        // 寻找与之相连的电阻（热电阻）
        let R = 1e9;
        this.rawDevices.filter(d => d.type === 'resistor').forEach(r => {
            const rL = this.portToCluster.get(`${r.id}_wire_l`);
            const rR = this.portToCluster.get(`${r.id}_wire_r`);
            if ((rL === cL && rR === cR) || (rL === cR && rR === cL)) R = r.currentResistance;
        });

        // PT100 公式转换：0-100度 对应 100-138.51欧姆
        const iRaw = 0.016 * (R - 100) / 38.51 + 0.004;
        return Math.max(0.0038, Math.min(0.0205, iRaw)); // 电流钳位在安全区间
    }

    // 获取端口电压值
    getVoltageAtPort(pId) {
        const cIdx = this.portToCluster.get(pId);
        return cIdx !== undefined ? (this.nodeVoltages.get(cIdx) || 0) : 0;
    }

    // 获取两点间的压差 (Potential Difference)
    getPD(pA, pB) {
        return this.getVoltageAtPort(pA) - this.getVoltageAtPort(pB);
    }

    /**
     * 改进的等效电阻计算 (试探法)
     * 在起点注入 1A 电流，终点接地，求解起点电压，结果即为电阻
     */
    _getEquivalentResistance(startCluster, endCluster, allClusters) {
        const startIdx = allClusters.indexOf(startCluster);
        const endIdx = allClusters.indexOf(endCluster);
        if (startIdx === -1 || endIdx === -1) return Infinity;
        if (startIdx === endIdx) return 0;

        const nodeMap = new Map();
        let mSize = 0;
        for (let i = 0; i < allClusters.length; i++) { if (i !== endIdx) nodeMap.set(i, mSize++); }

        const G = Array.from({ length: mSize }, () => new Float64Array(mSize));
        const B = new Float64Array(mSize);

        // 扫描并填充所有电阻性连接
        for (let i = 0; i < allClusters.length; i++) {
            for (let j = i + 1; j < allClusters.length; j++) {
                const res = this._getParallelResistanceBetweenClusters(allClusters[i], allClusters[j]);
                if (res.count > 0 && res.totalR !== Infinity) {
                    const g = 1 / res.totalR;
                    const n1 = nodeMap.has(i) ? { t: 'u', i: nodeMap.get(i) } : { t: 'g' };
                    const n2 = nodeMap.has(j) ? { t: 'u', i: nodeMap.get(j) } : { t: 'g' };
                    if (n1.t === 'u') { G[n1.i][n1.i] += g; if (n2.t === 'u') G[n1.i][n2.i] -= g; }
                    if (n2.t === 'u') { G[n2.i][n2.i] += g; if (n1.t === 'u') G[n2.i][n1.i] -= g; }
                }
            }
        }

        const aNodeIdx = nodeMap.get(startIdx);
        if (aNodeIdx === undefined) return Infinity;
        B[aNodeIdx] = 1.0; // 注入 1A
        for (let i = 0; i < mSize; i++) G[i][i] += 1e-15;

        try {
            const results = this._gauss(G, B);
            return results[aNodeIdx] > 1e9 ? Infinity : results[aNodeIdx];
        } catch (e) { return Infinity; }
    }

    // 内部方法：计算两个节点组之间所有并联设备的合成电阻
    _getParallelResistanceBetweenClusters(clusterA, clusterB) {
        let inverseRSum = 0;
        let resistorCount = 0;
        let hasZeroResistor = false;
        if (clusterA === clusterB) return { totalR: 0, count: 0 };

        this.rawDevices.forEach(dev => {
            const p0InA = clusterA.has(`${dev.id}_wire_l`), p1InB = clusterB.has(`${dev.id}_wire_r`);
            const p0InB = clusterB.has(`${dev.id}_wire_l`), p1InA = clusterA.has(`${dev.id}_wire_r`);
            if ((p0InA && p1InB) || (p0InB && p1InA)) {
                let r = dev.currentResistance || 1e9;
                if (r < 0.001) hasZeroResistor = true;
                else inverseRSum += (1 / r);
                resistorCount++;
            }
        });

        if (hasZeroResistor) return { totalR: 0, count: resistorCount };
        if (resistorCount === 0) return { totalR: Infinity, count: 0 };
        return { totalR: 1 / inverseRSum, count: resistorCount };
    }
}