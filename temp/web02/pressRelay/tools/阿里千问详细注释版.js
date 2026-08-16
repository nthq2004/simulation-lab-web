/**
 * 电路求解类 V4.0 - 集成仪表自动更新功能
 * 
 * 【核心算法架构】
 * 1. 拓扑分析 (Topology Analysis): 使用并查集 (Union-Find) 将物理连接合并为逻辑节点 (Clusters)。
 * 2. 改进节点电压法 (MNA): 构建 Gx=B 线性方程组，支持电压源、受控源。
 * 3. 非线性迭代 (Non-linear Iteration): 类似 Newton-Raphson 方法，通过多次迭代处理二极管、三极管、运放饱和等非线性状态。
 * 4. 仪表反推 (Instrument Back-projection): 求解电压后，利用 KCL 和欧姆定律反推电流表读数。
 */
export class CircuitSolver {
    /**
     * 构造函数：初始化求解器状态
     * @param {Array} devices - 电路中所有设备的原始数据数组
     */
    constructor(devices) {
        this.rawDevices = devices;       // 存储原始设备对象引用，后续会直接修改其属性（如 current, state）
        this.portToCluster = new Map();  // 映射表：端口字符串ID (如 "R1_wire_l") -> 节点簇整数索引 (0, 1, 2...)
        this.nodeVoltages = new Map();   // 映射表：节点簇索引 -> 计算出的电压值 (最终结果)
        this.clusters = [];              // 数组：每个元素是一个 Set，包含属于该节点簇的所有端口ID
        this.clusterCount = 0;           // 节点簇的总数量
        this.gndClusterIndices = new Set(); // 集合：存储被标记为“地 (GND)”的节点簇索引，这些点电压强制为 0
        this.vPosMap = new Map();        // 映射表：存储已知电压的节点簇索引及其电压值 (如电源正极)
        
        // 调试开关：开启后会在控制台输出迭代过程中的详细信息
        this.debug = true;
    }

    /**
     * 主更新入口函数
     * 每次电路状态变化（如开关动作、滑变移动）时调用此函数
     * @param {Array} conns - 连接关系列表，主要包含 type:'wire' 的导线对象
     */
    update(conns) {
        // --- 关键步骤：重置状态 ---
        // 必须清空上一帧的计算缓存，防止旧数据污染新计算
        this.portToCluster.clear();      // 清空端口到节点的映射
        this.nodeVoltages.clear();       // 清空电压结果
        this.gndClusterIndices.clear();  // 清空接地标记
        this.vPosMap.clear();            // 清空已知电压标记
        this.clusters = [];              // 重置簇列表

        // 过滤出纯导线连接，用于构建拓扑网络
        // 忽略其他类型的连接（如果有），只关心电气导通
        this.connections = conns.filter(c => c.type === 'wire');

        // 执行三大核心阶段
        this._buildTopology();           // 阶段 1: 建立电气连接拓扑，确定哪些点是等电位的
        this._solve();                   // 阶段 2: 列写并求解电路方程，计算各点电压
        this._updateInstruments();       // 阶段 3: 根据电压结果，计算并更新仪表（电流表、万用表）的显示值
    }

    /**
     * 1. 拓扑构建 (_buildTopology)
     * 目标：利用并查集算法，将所有通过导线或零电阻元件连接的端口合并为同一个“节点簇”。
     * 原理：电路中由理想导线连接的点电位相同，视为同一个节点。
     */
    _buildTopology() {
        // --- 并查集 (Union-Find) 数据结构实现 ---
        const parent = {}; // 记录每个端口的父节点，用于查找根节点
        
        // find 函数：查找端口 i 所属集合的根节点 (带路径压缩优化)
        // 如果 parent[i] 未定义或指向自己，则 i 是根；否则递归查找并压缩路径
        const find = (i) => (parent[i] === undefined || parent[i] === i) ? i : (parent[i] = find(parent[i]));
        
        // union 函数：合并端口 i 和 j 所在的集合
        // 将 i 的根节点的父节点指向 j 的根节点
        const union = (i, j) => {
            const rI = find(i), rJ = find(j); // 分别找到 i 和 j 的根
            if (rI !== rJ) parent[rI] = rJ;   // 如果根不同，则合并（将 rI 挂到 rJ 下）
        };

        // 1. 预先收集所有存在的端口 ID
        // 使用 Set 去重，确保每个端口只处理一次
        const allPorts = new Set();

        // 遍历所有导线连接
        this.connections.forEach(c => {
            allPorts.add(c.from); // 添加起点端口
            allPorts.add(c.to);   // 添加终点端口
            union(c.from, c.to);  // 【核心】将导线两端合并到同一集合（等电位）
        });

        // 遍历所有设备，处理内部连接和孤立端口
        this.rawDevices.forEach(dev => {
            // 获取该设备的所有端口 ID 并加入总集合
            const ps = this._getDevicePorts(dev.id);
            ps.forEach(p => allPorts.add(p));

            const id = dev.id;
            
            // 【核心】处理“零电阻”内部桥接逻辑
            // 某些设备在特定状态下，其内部端口相当于直接用导线短接
            
            // 情况 A: 开关闭合 -> 左端 (_l) 和右端 (_r) 短接
            if (dev.type === 'switch' && !dev.isOpen) union(`${id}_wire_l`, `${id}_wire_r`);
            
            // 情况 B: 继电器吸合 -> 常开触点 (_NO) 和公共端 (_COM) 短接
            if (dev.type === 'relay' && dev.isEnergized) union(`${id}_wire_NO`, `${id}_wire_COM`);
            
            // 情况 C: 电流表 (Ampmeter) -> 内阻视为 0，正负端短接
            if (dev.type === 'ampmeter') union(`${id}_wire_p`, `${id}_wire_n`);
            
            // 情况 D: 万用表电流档 (MA) -> 内阻视为 0，短接
            if (dev.type === 'multimeter' && dev.mode === 'MA') union(`${id}_wire_ma`, `${id}_wire_com`);
            
            // 情况 E: 任意设备电阻极小 (<1mΩ) -> 视为短路
            if (dev.currentResistance < 0.001) {
                union(`${id}_wire_l`, `${id}_wire_r`);
            }
        });

        // 3. 构建 Cluster 映射 (将并查集的根节点映射为连续整数索引 0, 1, 2...)
        const clusterIndex = new Map(); // 记录每个根节点对应的索引号
        let idx = 0; // 当前分配的索引号

        allPorts.forEach(p => {
            const root = find(p); // 找到端口 p 所属集合的根
            // 如果这个根还没分配索引，分配一个新的
            if (!clusterIndex.has(root)) {
                clusterIndex.set(root, idx++);
            }
            // 记录：端口 p 属于索引为 clusterIndex.get(root) 的节点簇
            this.portToCluster.set(p, clusterIndex.get(root));
        });
        this.clusterCount = idx; // 记录总共有多少个独立节点簇

        // 4. 生成最终的 clusters 集合 (反向映射：索引 -> 端口集合)
        // 用于后续计算等效电阻等功能
        const clusterMap = {}; // 临时对象：根节点 -> Set(端口)
        allPorts.forEach(p => {
            const root = find(p);
            if (!clusterMap[root]) clusterMap[root] = new Set(); // 初始化集合
            clusterMap[root].add(p); // 将端口加入对应集合
        });
        // 将对象.values() 转为数组，存入 this.clusters
        this.clusters = Object.values(clusterMap);
    }

    /**
     * 辅助函数：获取设备的所有标准端口 ID
     * @param {String} id - 设备 ID
     * @returns {Array} 端口 ID 列表 (如 ["dev1_wire_l", "dev1_wire_r", ...])
     */
    _getDevicePorts(id) {
        // 定义所有可能的端口后缀
        const sfx = ['_l', '_m', '_r', '_p', '_n', '_v', '_ma', '_com', '_COM', '_NO'];
        // 拼接 ID 和后缀，并过滤掉那些实际上不存在的端口 (通过检查 portToCluster 是否有记录来间接判断，或者单纯生成候选)
        // 注意：此处逻辑略有循环依赖风险，但在 buildTopology 中先 add 后 check 是安全的，
        // 或者这里仅仅是生成候选字符串，实际存在性由 caller 保证。
        return sfx.map(s => `${id}_wire${s}`).filter(p => this.portToCluster.has(p));
    }

    /**
     * 2. 核心求解 (_solve)
     * 使用改进节点电压法 (MNA) 结合迭代法求解非线性电路。
     * 流程：构建矩阵 -> 高斯消元 -> 检查收敛/状态切换 -> 重复直到稳定
     */
    _solve() {
        // --- 步骤 1: 识别接地 (GND) 节点 ---
        // 查找所有类型为 'gnd' 的设备
        const gndDevs = this.rawDevices.filter(d => d.type === 'gnd');
        gndDevs.forEach(g => {
            // 获取接地端口对应的节点簇索引
            const clusterIdx = this.portToCluster.get(`${g.id}_wire_gnd`);
            if (clusterIdx !== undefined) {
                // 标记该簇为地，其电压将在后续强制设为 0
                this.gndClusterIndices.add(clusterIdx);
            }
        });

        // --- 步骤 2: 处理独立电源和特殊设备 ---
        const powerDevs = this.rawDevices.filter(d => d.type === 'source'); // 独立电压源
        const pidDevs = this.rawDevices.filter(d => d.type === 'PID');      // PID 控制器
        const bjtDevs = this.rawDevices.filter(d => d.type === 'bjt');      // 三极管

        // 配置电源节点的已知电压
        powerDevs.forEach(p => {
            const pId = `${p.id}_wire_p`; // 正极端口
            const nId = `${p.id}_wire_n`; // 负极端口
            
            // 策略：通常将电源负极视为参考地 (如果未显式接地)
            if (this.portToCluster.has(nId)) this.gndClusterIndices.add(this.portToCluster.get(nId));
            
            // 将电源正极标记为已知电压节点 (vPosMap)
            if (this.portToCluster.has(pId)) this.vPosMap.set(this.portToCluster.get(pId), p.getValue());
        });

        // --- 步骤 3: 初始化运放状态 ---
        const opAmps = this.rawDevices.filter(d => d.type === 'amplifier');
        // 仅在第一次运行时初始化，假设所有运放初始处于线性区 (未饱和)
        if (!this._opAmpsInitialized) {
            opAmps.forEach(op => op.internalState = 'linear');
            this._opAmpsInitialized = true;
        }

        // --- 步骤 4: 建立矩阵映射 (Node Mapping) ---
        // MNA 矩阵只需要为“未知电压”的节点分配行/列索引
        // 已知电压 (地、电源正极) 不需要未知量，直接移项到方程右边
        const nodeMap = new Map(); // 映射：节点簇索引 -> 矩阵行/列索引 (0 到 mSize-1)
        let mSize = 0; // 未知节点的数量

        for (let i = 0; i < this.clusterCount; i++) {
            // 如果不是地，也不是已知电压源节点，则需要求解
            if (!this.gndClusterIndices.has(i) && !this.vPosMap.has(i)) {
                nodeMap.set(i, mSize++);
            }
        }

        // 优化：如果没有未知节点，直接赋值已知电压并返回
        if (mSize === 0) { 
            this._assignKnown(); 
            return; 
        }

        // --- 步骤 5: 统计额外方程数量 (MNA 扩展) ---
        // 电压源、运放输出、PWM 输出等需要引入额外的电流变量和约束方程
        let extraEqCount = 0;
        pidDevs.forEach(pid => {
            if (this.portToCluster.has(`${pid.id}_wire_pi1`)) extraEqCount++; // PID 24V 馈电回路
            if (pid.outModes.CH1 === 'PWM' && this.portToCluster.has(`${pid.id}_wire_po1`)) extraEqCount++; // CH1 PWM
            if (pid.outModes.CH2 === 'PWM' && this.portToCluster.has(`${pid.id}_wire_po2`)) extraEqCount++; // CH2 PWM
        });

        // 矩阵总维度 = 未知节点数 + 额外电压源方程数 + 运放方程数
        const totalSize = mSize + extraEqCount + opAmps.length;
        
        // 初始化结果向量 (存储电压和额外电流变量)
        let results = new Float64Array(totalSize);
        
        // 设置最大迭代次数，防止非线性电路不收敛导致死循环
        let maxIterations = 200; 

        // ================= 核心迭代循环 (Newton-Raphson 思想) =================
        for (let iter = 0; iter < maxIterations; iter++) {
            // 每次迭代必须重新初始化矩阵 G (导纳矩阵) 和向量 B (激励向量)
            // 因为非线性元件（二极管、运放）的状态可能改变，导致矩阵结构或系数变化
            const G = Array.from({ length: totalSize }, () => new Float64Array(totalSize));
            const B = new Float64Array(totalSize);

            // --- 1. 填充普通线性电阻 ---
            this.rawDevices.forEach(dev => {
                // 跳过特殊设备 (它们有独立的注入逻辑) 和极小电阻 (已在拓扑中短接)
                if (['source', 'transmitter_2wire', 'PID'].includes(dev.type) || dev.currentResistance < 0.001) return;
                
                const c1 = this.portToCluster.get(`${dev.id}_wire_l`); // 左端节点索引
                const c2 = this.portToCluster.get(`${dev.id}_wire_r`); // 右端节点索引
                
                let devResistance = 1000000000; // 默认高阻 (防除零)
                if (dev.currentResistance !== undefined) devResistance = dev.currentResistance;
                
                // 如果两端都有效，将电导 (G=1/R) 填入矩阵
                if (c1 !== undefined && c2 !== undefined) {
                    this._fillMatrix(G, B, nodeMap, c1, c2, 1 / devResistance);
                }
            });

            // --- 2. 处理变送器 (Transmitter) - 受控非线性电阻 ---
            // 特性：电压<10V 截止 (高阻)，>10V 恒流 (4-20mA)
            this.rawDevices.filter(d => d.type === 'transmitter_2wire').forEach(dev => {
                const cP = this.portToCluster.get(`${dev.id}_wire_p`);
                const cN = this.portToCluster.get(`${dev.id}_wire_n`);
                if (cP === undefined || cN === undefined) return;

                // 获取上一轮迭代的压差 (Vp - Vn)，用于判断当前状态
                const lastV = dev._lastVDiff !== undefined ? dev._lastVDiff : 0;
                let dynamicG; // 动态电导

                // 【关键逻辑】反向截止与正常工作判断
                if (lastV < 10) {
                    // 电压不足 10V，变送器不工作，表现为极高电阻 (1GΩ)，电流趋近于 0
                    dynamicG = 1 / 1e9;
                } else {
                    // 正常工作区：计算目标电流，然后推导等效电导 G = I_target / V
                    // 这种线性化处理是为了适配 MNA 矩阵
                    const targetI = this._calcTransmitterCurrent(dev);
                    dynamicG = targetI / lastV;
                }

                // 【数值稳定性】阻尼处理：平滑电导变化，避免迭代震荡
                if (dev._lastG === undefined) dev._lastG = dynamicG;
                dev._lastG = (dynamicG + dev._lastG) / 2; // 取平均值

                // 将动态电导填入矩阵
                this._fillMatrix(G, B, nodeMap, cP, cN, dev._lastG);
            });

            // --- 3. 注入 PID 控制器模型 ---
            let currentVSourceIdx = mSize; // 额外方程的起始索引
            
            pidDevs.forEach(pid => {
                if (!pid.powerOn) {
                    pid.ch1Current = 0;
                    pid.ch2Current = 0;
                    return;
                }
                const p = `${pid.id}_wire_`;

                // 3.1 输入回路：24V 馈电 (pi1) 和 250Ω 采样电阻 (ni1)
                const cPi1 = this.portToCluster.get(`${p}pi1`);
                const cNi1 = this.portToCluster.get(`${p}ni1`);
                
                // 添加 24V 电压源约束方程
                if (cPi1 !== undefined) {
                    this._addVoltageSourceToMNA(G, B, nodeMap, cPi1, -1, 24.0, currentVSourceIdx++);
                }
                // 添加 250Ω 接地电阻 (ni1 到地)
                if (cNi1 !== undefined) {
                    this._fillMatrix(G, B, nodeMap, cNi1, -1, 1 / 250); 
                }

                // 3.2 通道 1 输出 (CH1): 4-20mA 或 PWM
                const cPo1 = this.portToCluster.get(`${p}po1`);
                const cNo1 = this.portToCluster.get(`${p}no1`);
                if (cPo1 !== undefined && cNo1 !== undefined) {
                    if (pid.outModes.CH1 === '4-20mA') {
                        // 恒流源模式：直接在 B 向量中添加电流注入
                        this._addCurrentSourceToMNA(B, nodeMap, cPo1, cNo1, pid.output1mA / 1000);
                    } else if (pid.outModes.CH1 === 'PWM') {
                        // PWM 模式：模拟为受控电压源 (VCC 或 0V)
                        pid.ch1VSourceIdx = currentVSourceIdx; // 记录索引以便后续读取电流
                        const vcc = this.getVoltageAtPort(`${p}vcc`) || 24; // 获取供电电压
                        // 根据瞬时占空比状态决定输出电压
                        const vTarget = pid.heatInstantOn ? vcc : 0;
                        this._addVoltageSourceToMNA(G, B, nodeMap, cPo1, cNo1, vTarget, currentVSourceIdx++);
                    }
                }

                // 3.3 通道 2 输出 (CH2): 逻辑同 CH1
                const cPo2 = this.portToCluster.get(`${p}po2`);
                const cNo2 = this.portToCluster.get(`${p}no2`);
                if (cPo2 !== undefined && cNo2 !== undefined) {
                    if (pid.outModes.CH2 === '4-20mA') {
                        // 注意：原代码此处可能是 copy-paste 错误，应使用 output2mA
                        this._addCurrentSourceToMNA(B, nodeMap, cPo2, cNo2, (pid.output2mA || pid.output1mA) / 1000);
                    } else if (pid.outModes.CH2 === 'PWM') {
                        pid.ch2VSourceIdx = currentVSourceIdx;
                        const vcc = this.getVoltageAtPort(`${p}vcc`) || 24;
                        const vTarget = pid.coolInstantOn ? vcc : 0;
                        this._addVoltageSourceToMNA(G, B, nodeMap, cPo2, cNo2, vTarget, currentVSourceIdx++);
                    }
                }
            });

            // --- 4. 注入运放 (Op-Amp) 模型 ---
            // 运放是非线性的，需根据其当前状态 (线性/饱和) 构建不同的方程
            let opVIdx = currentVSourceIdx;
            opAmps.forEach(op => {
                const cP = this.portToCluster.get(`${op.id}_wire_p`); // 同相输入端
                const cN = this.portToCluster.get(`${op.id}_wire_n`); // 反相输入端
                const cOut = this.portToCluster.get(`${op.id}_wire_OUT`); // 输出端

                if (cOut !== undefined) {
                    const outM = nodeMap.get(cOut);
                    // MNA 标准操作：在输出节点的 KCL 方程中增加电流变量 (I_out)
                    if (outM !== undefined) G[outM][opVIdx] += 1;

                    if (op.internalState === 'linear') {
                        // 【线性区方程】: Vout = A * (Vp - Vn)  =>  1*Vout - A*Vp + A*Vn = 0
                        if (outM !== undefined) G[opVIdx][outM] = 1; // Vout 系数
                        
                        const pM = nodeMap.get(cP), nM = nodeMap.get(cN);
                        // 处理 Vp: 如果是未知节点，填矩阵；如果是已知电压，移项到 B
                        if (pM !== undefined) G[opVIdx][pM] -= op.gain;
                        else if (this.vPosMap.has(cP)) B[opVIdx] += op.gain * this.vPosMap.get(cP);

                        // 处理 Vn: 注意符号变化 (+A*Vn)
                        if (nM !== undefined) G[opVIdx][nM] += op.gain;
                        else if (this.vPosMap.has(cN)) B[opVIdx] -= op.gain * this.vPosMap.get(cN);
                    } else {
                        // 【饱和区方程】: Vout = V_limit (常数)
                        // 方程形式：1*Vout = V_limit
                        if (outM !== undefined) G[opVIdx][outM] = 1;
                        // 根据饱和方向设定右侧常数
                        B[opVIdx] = (op.internalState === 'pos_sat') ? op.vPosLimit : op.vNegLimit;
                    }
                }
                // 记录该运放在矩阵中的行索引，用于后续提取输出电流
                op.currentIdx = opVIdx;
                opVIdx++;
            });

            // --- 5. 注入二极管 (Diode) 模型 ---
            // 使用分段线性伴随模型 (Companion Model)
            this.rawDevices.filter(d => d.type === 'diode').forEach(dev => {
                const cA = this.portToCluster.get(`${dev.id}_wire_l`); // 阳极
                const cC = this.portToCluster.get(`${dev.id}_wire_r`); // 阴极
                if (cA === undefined || cC === undefined) {
                    dev.physCurrent = 0;
                    return;
                }

                // 获取当前迭代计算出的两端电压
                const vA = this.getVoltageFromResults(results, nodeMap, cA);
                const vC = this.getVoltageFromResults(results, nodeMap, cC);
                const vDiff = vA - vC;

                if (vDiff > dev.vForward) {
                    // 【导通态】: 等效为一个小电阻 rOn 串联一个电压源 vForward
                    // 转换为诺顿等效并联入矩阵：电导 G = 1/rOn, 并联电流源 I = vForward/rOn
                    const gOn = 1 / (dev.rOn || 0.5);
                    const iEq = dev.vForward * gOn;
                    this._fillMatrix(G, B, nodeMap, cA, cC, gOn);
                    this._addCurrentSourceToMNA(B, nodeMap, cA, cC, iEq); // 电流从 A 流向 C
                } else {
                    // 【截止态】: 等效为一个极大电阻 rOff
                    this._fillMatrix(G, B, nodeMap, cA, cC, 1 / (dev.rOff || 1e9));
                }
            });

            // --- 6. 注入三极管 (BJT) 模型 ---
            bjtDevs.forEach(dev => {
                const cB = this.portToCluster.get(`${dev.id}_wire_b`); // 基极
                const cC = this.portToCluster.get(`${dev.id}_wire_c`); // 集电极
                const cE = this.portToCluster.get(`${dev.id}_wire_e`); // 发射极
                
                // 保护：如果关键引脚未连接，跳过计算
                if (cB === undefined || (cC === undefined && cE === undefined)) {
                    return;
                }

                // 获取当前迭代电压
                const vB = this.getVoltageFromResults(results, nodeMap, cB);
                const vC = this.getVoltageFromResults(results, nodeMap, cC);
                const vE = this.getVoltageFromResults(results, nodeMap, cE);

                // 退化情况处理：如果缺少 C 或 E，退化为二极管模型
                if (cB !== undefined && cE !== undefined && cC === undefined) {
                    // B-E 结二极管
                    const vDiff = vB - vE;
                    if (vDiff > 0.7) {
                        const gOn = 2; const iEq = 0.7 * gOn;
                        this._fillMatrix(G, B, nodeMap, cB, cE, gOn);
                        this._addCurrentSourceToMNA(B, nodeMap, cB, cE, iEq);
                    } else {
                        this._fillMatrix(G, B, nodeMap, cB, cE, 1 / (1e9));
                    }
                } else if (cB !== undefined && cC !== undefined && cE === undefined) {
                    // B-C 结二极管
                    const vDiff = vB - vC;
                    if (vDiff > 0.7) {
                        const gOn = 2; const iEq = 0.7 * gOn;
                        this._fillMatrix(G, B, nodeMap, cB, cC, gOn);
                        this._addCurrentSourceToMNA(B, nodeMap, cB, cC, iEq);
                    } else {
                        this._fillMatrix(G, B, nodeMap, cB, cC, 1 / (1e9));
                    }
                } else {
                    // 标准三极管模式：调用设备自带的伴随模型生成器
                    const model = dev.getCompanionModel(vB, vC, vE) || { matrix: {}, currents: {} };
                    this._fillBJTMatrix(G, B, nodeMap, cC, cB, cE, model);
                }

                // 调试日志：输出迭代过程中的电压值
                if (this.debug) console.debug(`iter=${iter},${dev.id}: vB=${vB}, vC=${vC}, vE=${vE}`);
            });

            // --- 数值稳定性：注入 GMIN ---
            // 在对角线增加极小电导 (1e-12)，防止矩阵奇异 (Singularity) 导致无法求逆
            for (let i = 0; i < totalSize; i++) G[i][i] += 1e-12;

            // --- 求解线性方程组 Gx = B ---
            const nextResults = this._gauss(G, B);

            // --- 收敛性检查 ---
            let maxError = 0;
            for (let i = 0; i < totalSize; i++) {
                maxError = Math.max(maxError, Math.abs(nextResults[i] - results[i]));
            }

            // --- 核心：带限幅的阻尼更新 (Relaxation & Limiting) ---
            // 目的：防止非线性元件状态突变导致解在两个值之间无限震荡
            nodeMap.forEach((mIdx, cIdx) => {
                const oldV = this.nodeVoltages.get(cIdx) || 0; // 上一轮电压
                const rawNewV = nextResults[mIdx];             // 本轮计算出的原始电压

                // 1. 阻尼 (Damping): 新解只采纳 30%，保留 70% 旧值 (松弛因子 0.3)
                const damping = 0.3;
                let nextV = oldV + damping * (rawNewV - oldV);

                // 2. 位移限幅 (Step Limiting): 单步电压变化绝对值不超过 0.5V
                // 即使计算出跳变 100V，也强制限制为 0.5V，给模型时间平滑过渡
                const MAX_STEP = 0.5;
                let delta = nextV - oldV;
                if (Math.abs(delta) > MAX_STEP) {
                    nextV = oldV + MAX_STEP * Math.sign(delta);
                }

                // 更新全局电压缓存
                this.nodeVoltages.set(cIdx, nextV);
                // 更新临时结果供下一轮状态判断使用
                nextResults[mIdx] = nextV;
            });

            // --- 状态切换检查 (决定是否继续迭代) ---
            let stateChanged = false;
            
            // 检查运放是否进入/退出饱和
            opAmps.forEach(op => {
                const cP = this.portToCluster.get(`${op.id}_wire_p`);
                const cN = this.portToCluster.get(`${op.id}_wire_n`);
                const cOut = this.portToCluster.get(`${op.id}_wire_OUT`);

                // 获取当前计算出的实时电位
                const vP = this.getVoltageFromResults(results, nodeMap, cP);
                const vN = this.getVoltageFromResults(results, nodeMap, cN);
                const vOutRaw = this.getVoltageFromResults(results, nodeMap, cOut);

                let newState = op.internalState;

                if (op.internalState === 'linear') {
                    // 线性区 -> 饱和区：看输出电压是否超标
                    if (vOutRaw > op.vPosLimit) newState = 'pos_sat';
                    else if (vOutRaw < op.vNegLimit) newState = 'neg_sat';
                } else {
                    // 饱和区 -> 线性区：必须看输入压差 (Vp-Vn) 是否反向
                    // 只有当输入极性反转，运放才有可能退出饱和
                    const vDiff = vP - vN;
                    if (op.internalState === 'pos_sat' && vDiff < 0) newState = 'linear';
                    else if (op.internalState === 'neg_sat' && vDiff > 0) newState = 'linear';
                    else if (cP === undefined && cN === undefined || vDiff === 0) newState = 'linear';
                }

                if (op.internalState !== newState) {
                    op.internalState = newState;
                    stateChanged = true; // 标记状态已变，需要继续迭代
                }
            });

            // 检查二极管是否通断切换
            this.rawDevices.filter(d => d.type === 'diode').forEach(dev => {
                const vA = this.getVoltageFromResults(results, nodeMap, this.portToCluster.get(`${dev.id}_wire_l`));
                const vC = this.getVoltageFromResults(results, nodeMap, this.portToCluster.get(`${dev.id}_wire_r`));
                const isNowOn = (vA - vC) > dev.vForward;
                if (dev._lastOnState !== isNowOn) { 
                    dev._lastOnState = isNowOn; 
                    stateChanged = true; 
                }
            });

            // 更新结果向量
            results = nextResults;

            // 终止条件：状态无变化 且 电压误差小于阈值 (1uV)
            if (!stateChanged && maxError < 1e-6) break;
        }

        // --- 迭代结束：后处理 ---
        
        // 将已知电压 (地、电源) 填入最终结果 Map
        this._assignKnown();

        // 1. 计算电阻电流 (I = (Vl - Vr) / R)
        this.rawDevices.filter(d => (d.type === 'resistor') && d.currentResistance >= 0.001).forEach(dev => {
            const portL = `${dev.id}_wire_l`;
            const portR = `${dev.id}_wire_r`;
            const vL = this.nodeVoltages.get(this.portToCluster.get(portL)) || 0;
            const vR = this.nodeVoltages.get(this.portToCluster.get(portR)) || 0;
            // 规定方向：从左向右流为正
            dev.physCurrent = (vL - vR) / dev.currentResistance;
        });

        // 2. 变送器：缓存当前压差，供下一帧迭代使用
        this.rawDevices.filter(d => d.type === 'transmitter_2wire').forEach(dev => {
            const pV = this.getVoltageAtPort(`${dev.id}_wire_p`);
            const nV = this.getVoltageAtPort(`${dev.id}_wire_n`);
            dev._lastVDiff = pV - nV;
        });

        // 3. PID：从矩阵解中提取电流变量 (MNA 中的额外变量)
        pidDevs.forEach(pid => {
            if (pid.ch1VSourceIdx !== undefined) pid.ch1Current = results[pid.ch1VSourceIdx];
            if (pid.ch2VSourceIdx !== undefined) pid.ch2Current = results[pid.ch2VSourceIdx];
        });

        // 4. 运放：提取输出电流
        opAmps.forEach(op => {
            if (op.currentIdx !== undefined) op.outCurrent = results[op.currentIdx];
            if (this.debug) console.log('运放输出电流：', op.outCurrent);
        });

        // 5. 二极管：计算最终物理电流
        this.rawDevices.filter(d => d.type === 'diode').forEach(dev => {
            const cA = this.portToCluster.get(`${dev.id}_wire_l`);
            const cC = this.portToCluster.get(`${dev.id}_wire_r`);
            const vA = this.nodeVoltages.get(cA) || 0;
            const vC = this.nodeVoltages.get(cC) || 0;
            const vDiff = vA - vC;
            const vForward = dev.vForward || 0.68;
            const rOn = dev.rOn || 0.5;
            const gOn = 1 / rOn;

            if (vDiff > vForward) {
                // 导通：I = (V - Vf) / Ron
                dev.physCurrent = gOn * (vDiff - vForward);
            } else {
                // 截止：I = 0
                dev.physCurrent = 0;
            }
        });

        // 6. 三极管：计算各极电流 (Ib, Ic, Ie)
        this.rawDevices.filter(d => d.type === 'bjt').forEach(dev => {
            const cB = this.portToCluster.get(`${dev.id}_wire_b`);
            const cC = this.portToCluster.get(`${dev.id}_wire_c`);
            const cE = this.portToCluster.get(`${dev.id}_wire_e`);
            const vB = this.nodeVoltages.get(cB) || 0;
            const vC = this.nodeVoltages.get(cC) || 0;
            const vE = this.nodeVoltages.get(cE) || 0;

            dev.physCurrents = { b: 0, c: 0, e: 0 };
            const model = dev.getCompanionModel(vB, vC, vE);
            const { gBE, iBE, beta, gCE_sat, pol, V_SAT } = model.internal;

            // 根据连接完整性选择计算模型
            if (cB !== undefined && cE !== undefined && (cC === undefined || cC === cB)) {
                // B-E 二极管模式
                const vDiff = (vB - vE) * pol;
                const Ib = (vDiff > 0.7) ? 2 * (vDiff - 0.7) : 0;
                dev.physCurrents.b = Ib * pol;
                dev.physCurrents.e = -dev.physCurrents.b;
            } else if (cB !== undefined && cC !== undefined && (cE === undefined || cE === cB)) {
                // B-C 二极管模式
                const vDiff = (vB - vC) * pol;
                const Ib = (vDiff > 0.7) ? 2 * (vDiff - 0.7) : 0;
                dev.physCurrents.b = Ib * pol;
                dev.physCurrents.c = -dev.physCurrents.b;
            } else {
                // 完整三极管模型
                const vbeLocal = (vB - vE) * pol;
                const vceLocal = (vC - vE) * pol;
                const Ib = pol * (gBE * vbeLocal + iBE);
                // Ic = Beta*Ib + 饱和修正项
                const Ic = (beta * Ib) + pol * (gCE_sat * (vceLocal - V_SAT));
                dev.physCurrents.b = Ib;
                dev.physCurrents.c = Ic;
                dev.physCurrents.e = -(Ib + Ic); // KCL: Ie = -(Ib+Ic)
            }
        });
    }

    /**
     * 辅助：从结果数组中安全获取某节点簇的电压
     * 处理地、已知电压源、未知节点三种情况
     */
    getVoltageFromResults(results, nodeMap, clusterIdx) {
        if (clusterIdx === undefined) return 0;
        if (this.gndClusterIndices.has(clusterIdx)) return 0; // 地
        if (this.vPosMap.has(clusterIdx)) return this.vPosMap.get(clusterIdx); // 已知源
        const mIdx = nodeMap.get(clusterIdx);
        return mIdx !== undefined ? results[mIdx] : 0; // 未知节点 (从解向量取值)
    }

    /**
     * 辅助：填充导纳矩阵 G 和激励向量 B (针对电阻元件)
     * @param {Matrix} G - 导纳矩阵
     * @param {Vector} B - 激励向量
     * @param {Map} nodeMap - 节点映射
     * @param {Number} c1 - 节点 1 索引
     * @param {Number} c2 - 节点 2 索引
     * @param {Number} g - 电导 (1/R)
     */
    _fillMatrix(G, B, nodeMap, c1, c2, g) {
        if (c1 === undefined || c2 === undefined) return; // 安全检查

        // 内部 helper：获取节点类型 ('u':未知, 'g':地, 'v':已知电压, 'none':无效)
        const get = (c) => {
            if (this.gndClusterIndices.has(c)) return { t: 'g' };
            if (this.vPosMap.has(c)) return { t: 'v', v: this.vPosMap.get(c) };
            const idx = nodeMap.get(c);
            if (idx === undefined) return { t: 'none' };
            return { t: 'u', i: idx };
        };

        const n1 = get(c1), n2 = get(c2);

        // 标准 MNA 填充规则 (KCL)
        // 对于节点 1: G11 += g, G12 -= g (如果 2 是未知), B1 += g*V2 (如果 2 是已知)
        if (n1.t === 'u') {
            G[n1.i][n1.i] += g;
            if (n2.t === 'u') G[n1.i][n2.i] -= g;
            else if (n2.t === 'v') B[n1.i] += g * n2.v;
        }
        // 对于节点 2: G22 += g, G21 -= g (如果 1 是未知), B2 += g*V1 (如果 1 是已知)
        if (n2.t === 'u') {
            G[n2.i][n2.i] += g;
            if (n1.t === 'u') G[n2.i][n1.i] -= g;
            else if (n1.t === 'v') B[n2.i] += g * n1.v;
        }
    }

    /**
     * 辅助：填充三极管伴随模型矩阵
     * 将三极管的线性化模型 (Gm, gBE, etc.) 注入到 G 和 B 中
     */
    _fillBJTMatrix(G, B, nodeMap, cC, cB, cE, model) {
        // 获取各极在矩阵中的索引
        const idx = { c: nodeMap.get(cC), b: nodeMap.get(cB), e: nodeMap.get(cE) };
        const { gBE, iBE, beta, gCE_sat, pol, V_SAT } = model.internal;
        
        // Helper: 安全地累加矩阵元素
        const addG = (r, c, val) => { if (r !== undefined && c !== undefined) G[r][c] += val; };

        // 1. BE 结电导注入 (控制端)
        addG(idx.b, idx.b, gBE); addG(idx.b, idx.e, -gBE);
        addG(idx.e, idx.b, -gBE); addG(idx.e, idx.e, gBE);
        // 注入 BE 结等效电流源
        if (idx.b !== undefined) B[idx.b] -= pol * iBE;
        if (idx.e !== undefined) B[idx.e] += pol * iBE;

        // 2. 受控源注入 (Beta * Ib)
        // Ic 受 Vbe 控制，跨导 transG = Beta * gBE
        const transG = beta * gBE;
        addG(idx.c, idx.b, transG * pol);
        addG(idx.c, idx.e, -transG * pol);
        addG(idx.e, idx.b, -transG * pol);
        addG(idx.e, idx.e, transG * pol);

        // 注入受控源等效电流
        const iControl = beta * iBE;
        if (idx.c !== undefined) B[idx.c] -= pol * iControl;
        if (idx.e !== undefined) B[idx.e] += pol * iControl;

        // 3. 饱和/钳位项 (C-E 间电阻)
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

    /**
     * 辅助：将已知电压 (地、电源) 赋值到 nodeVoltages Map
     */
    _assignKnown() {
        this.gndClusterIndices.forEach(idx => this.nodeVoltages.set(idx, 0));
        this.vPosMap.forEach((v, idx) => this.nodeVoltages.set(idx, v));
    }

    /**
     * 辅助：高斯消元法求解线性方程组 Ax = b
     * 返回解向量 x
     */
    _gauss(A, b) {
        const n = b.length;
        // 前向消元
        for (let i = 0; i < n; i++) {
            let pivot = A[i][i];
            if (Math.abs(pivot) < 1e-18) continue; // 避免除以零 (虽然加了 GMIN，但以防万一)
            for (let j = i + 1; j < n; j++) {
                const f = A[j][i] / pivot;
                b[j] -= f * b[i];
                for (let k = i; k < n; k++) A[j][k] -= f * A[i][k];
            }
        }
        // 回代求解
        const x = new Float64Array(n);
        for (let i = n - 1; i >= 0; i--) {
            let s = 0;
            for (let j = i + 1; j < n; j++) s += A[i][j] * x[j];
            x[i] = (b[i] - s) / A[i][i];
        }
        return x;
    }

    /**
     * 辅助：在 MNA 矩阵中添加电压源约束方程
     * 方程形式：V(c1) - V(c2) = voltage
     * @param {Number} vIdx - 新增方程在矩阵中的行/列索引
     */
    _addVoltageSourceToMNA(G, B, nodeMap, c1, c2, voltage, vIdx) {
        // 确定节点在矩阵中的索引 (-1 表示地或已知，需特殊处理)
        const i = this.gndClusterIndices.has(c1) ? -1 : (this.vPosMap.has(c1) ? -2 : nodeMap.get(c1));
        const j = (c2 === -1 || this.gndClusterIndices.has(c2)) ? -1 : (this.vPosMap.has(c2) ? -2 : nodeMap.get(c2));

        // 调整右侧向量 B (移项已知电压)
        let adjustedV = voltage;
        if (this.vPosMap.has(c1)) adjustedV -= this.vPosMap.get(c1);
        if (this.vPosMap.has(c2)) adjustedV += this.vPosMap.get(c2);
        B[vIdx] = adjustedV;

        // 填充 KCL 约束行和列 (MNA 标准格式)
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
     * 辅助：在 MNA 矩阵中添加电流源
     * 电流从 cPos 流向 cNeg
     */
    _addCurrentSourceToMNA(B, nodeMap, cPos, cNeg, current) {
        const i = nodeMap.get(cPos);
        const j = nodeMap.get(cNeg);
        if (i !== undefined) B[i] += current; // 流出节点减去，流入节点加上 (取决于符号约定，此处为注入)
        if (j !== undefined) B[j] -= current;
    }

    /**
     * 3. 更新仪表状态 (_updateInstruments)
     * 根据计算出的节点电压，反推各仪表的读数并调用其 update 方法刷新 UI
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
                    dev.update(0); // 未连接则读数为 0
                } else {
                    // 调用专用算法计算流经该支路的电流
                    const current = this._calculateBranchCurrent(dev);
                    dev.update(current * 1000); // 转换为 mA 显示
                }
            }

            // 2. 万用表逻辑
            if (dev.type === 'multimeter') {
                const mode = dev.mode || 'OFF';

                // 电压档 (DCV)
                if (mode.startsWith('DCV')) {
                    let diff = 0;
                    if (this.portToCluster.get(`${dev.id}_wire_v`) !== undefined && this.portToCluster.get(`${dev.id}_wire_com`) !== undefined) 
                        diff = this.getPD(`${dev.id}_wire_v`, `${dev.id}_wire_com`);
                    dev.update(diff);
                } 
                // 电阻档 (RES)
                else if (mode.startsWith('RES')) {
                    const comNode = `${dev.id}_wire_com`;
                    const vNode = `${dev.id}_wire_v`;
                    // 找到端口所属的簇
                    const comCluster = this.clusters.find(c => c.has(comNode));
                    const vCluster = this.clusters.find(c => c.has(vNode));

                    let R = Infinity;
                    // 只有在无明显外部电压干扰时才测电阻 (模拟真实万用表)
                    if (comCluster && vCluster && Math.abs(this.getPD(vNode, comNode)) < 0.1) {
                        // 使用矩阵注入法测量等效电阻
                        R = this._getEquivalentResistance(comCluster, vCluster, this.clusters);
                    }
                    // OL (Overload) 显示为大值
                    dev.update(R === Infinity ? 10000000 : R);
                } 
                // 其他模式清零
                else if (['OFF', 'ACV', 'C'].includes(mode)) {
                    dev.update(0);
                }
            }

            // 3. 变送器状态更新
            if (dev.type === 'transmitter_2wire') {
                const cP = this.portToCluster.get(`${dev.id}_wire_p`);
                const cN = this.portToCluster.get(`${dev.id}_wire_n`);
                dev.update({ 
                    powered: dev._lastVDiff > 10 && cP !== undefined && cN !== undefined && dev.isOpened === false, 
                    transCurrent: this._calcTransmitterCurrent(dev) * 1000 
                });
            }

            // 4. PID 输入电流更新
            if (dev.type === 'PID') {
                // 通过采样电阻 250Ω 计算输入电流
                const inI = Math.abs(this.getVoltageAtPort(`${dev.id}_wire_ni1`) / 250);
                dev.update(inI * 1000);
            }
        });
    }

    // ================= 仪表电流计算辅助函数 =================

    /**
     * 辅助 1：计算电流表所在支路的电流
     * 原理：利用 KCL，查找连接到电流表两端的所有功能设备，累加它们的电流
     */
    _calculateBranchCurrent(dev) {
        let portP = `${dev.id}_wire_p`;
        let portN = `${dev.id}_wire_n`;
        if (dev.type === 'multimeter') {
            portP = `${dev.id}_wire_ma`;
            portN = `${dev.id}_wire_com`;
        }

        // 搜索连接到 P 端和 N 端的功能设备 (排除电流表自身，防止短路逻辑)
        const pFuncDevs = this._getConnectedFunctionalDevices(portP, dev.id);
        const nFuncDevs = this._getConnectedFunctionalDevices(portN, dev.id);

        // 判断哪一侧有电源 (电流通常从电源侧流出，流向负载侧)
        // 这里的逻辑是：如果 P 侧有源，则电流从 P 流向 N，我们计算流入 N 的总电流
        const pHasSource = pFuncDevs.some(d => d.device.type === 'source' || d.extPort === `${d.device.id}_wire_pi1` || d.device.type === 'gnd');

        if (pHasSource) {
            let iInN = 0;
            nFuncDevs.forEach(item => {
                iInN += this._getPhysicalFlowIntoPort(item.device, item.extPort);
            });
            return -iInN; // 物理流向修正
        } else {
            let iInP = 0;
            pFuncDevs.forEach(item => {
                iInP += this._getPhysicalFlowIntoPort(item.device, item.extPort);
            });
            return iInP;
        }
    }

    /**
     * 辅助 2：物理流向判定
     * 计算电流从设备端口 extPort“流入”外部网络的数值
     * 返回值正负代表方向
     */
    _getPhysicalFlowIntoPort(dev, extPort) {
        // 情况 1: 电阻
        if (dev.type === 'resistor') {
            const totalCurrent = dev.physCurrent || 0;
            // 如果查询的是左端口，流入为正 (vL > vR 时 current 为正，即从左流出，所以流入为负？需根据 physCurrent 定义调整)
            // 此处逻辑：physCurrent 定义为 L->R。
            // 若查 L 端：电流从 L 流出，故流入为 -current
            // 若查 R 端：电流流入 R，故流入为 +current
            return extPort.endsWith('_l') ? -totalCurrent : totalCurrent;
        }

        // 情况 2: 变送器
        if (dev.type === 'transmitter_2wire') {
            const i = (dev._lastVDiff > 10) ? (dev._lastVDiff * (dev._lastG || 0)) : 0;
            // 变送器电流永远从自身的 P 流向 N
            if (extPort.endsWith('_n')) return i; // 从 N 流出即流入外部网络
            if (extPort.endsWith('_p')) return -i;
        }

        // 情况 3: PID 控制器
        if (dev.type === 'PID') {
            // CH1 输出
            if (extPort.endsWith('_po1') || extPort.endsWith('_no1')) {
                if (dev.outModes.CH1 === '4-20mA') {
                    // 开路检测：如果回路电阻过大，电流为 0
                    const cPo1 = this.portToCluster.get(`${dev.id}_wire_po1`);
                    const cNo1 = this.portToCluster.get(`${dev.id}_wire_no1`);
                    const req = this._getEquivalentResistance(
                        this.clusters.find(c => c.has(`${dev.id}_wire_po1`)),
                        this.clusters.find(c => c.has(`${dev.id}_wire_no1`)),
                        this.clusters
                    );
                    if (cPo1 === undefined || cNo1 === undefined || req > 100000) return 0;
                    
                    const i = dev.output1mA / 1000;
                    return extPort.endsWith('_po1') ? i : -i;
                } else if (dev.outModes.CH1 === 'PWM') {
                    const i = dev.ch1Current || 0;
                    return extPort.endsWith('_po1') ? -i : i;
                }
            }
            // CH2 输出 (逻辑同上)
            if (extPort.endsWith('_po2') || extPort.endsWith('_no2')) {
                 if (dev.outModes.CH2 === '4-20mA') {
                    const cPo2 = this.portToCluster.get(`${dev.id}_wire_po2`);
                    const cNo2 = this.portToCluster.get(`${dev.id}_wire_no2`);
                    const req = this._getEquivalentResistance(
                        this.clusters.find(c => c.has(`${dev.id}_wire_po2`)),
                        this.clusters.find(c => c.has(`${dev.id}_wire_no2`)),
                        this.clusters
                    );
                    if (cPo2 === undefined || cNo2 === undefined || req > 100000) return 0;
                    const i = (dev.output2mA || dev.output1mA) / 1000;
                    return extPort.endsWith('_po2') ? i : -i;
                } else if (dev.outModes.CH2 === 'PWM') {
                    const i = dev.ch2Current || 0;
                    return extPort.endsWith('_po2') ? -i : i;
                }
            }
            // 输入端 (pi1/ni1)
            if (extPort.endsWith('_pi1') || extPort.endsWith('_ni1')) {
                const vNi = this.getVoltageAtPort(`${dev.id}_wire_ni1`);
                const iLoop = vNi / 250;
                return -iLoop; // pi1 流出，ni1 流入
            }
        }

        // 情况 4: 运放
        if (dev.type === 'amplifier') {
            if (extPort.endsWith('_p') || extPort.endsWith('_n')) return 0; // 理想输入阻抗无穷大
            if (extPort.endsWith('_OUT')) return -dev.outCurrent || 0;
        }

        // 情况 5: 二极管
        if (dev.type === 'diode') {
            const current = dev.physCurrent || 0;
            return extPort.endsWith('_l') ? -current : current;
        }

        // 情况 6: 三极管
        if (dev.type === 'bjt') {
            if (!dev.physCurrents) return 0;
            if (extPort.endsWith('_b')) return -dev.physCurrents.b;
            if (extPort.endsWith('_c')) return -dev.physCurrents.c;
            if (extPort.endsWith('_e')) return -dev.physCurrents.e;
        }

        return 0;
    }

    /**
     * 辅助 3：寻找与电流表端口“物理意义上”直接挂载的所有功能设备
     * 使用 BFS (广度优先搜索) 遍历导线和零电阻元件
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

            // 1. 沿导线传播
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
                // 【核心修复】禁止穿透正在测量的这个表本身 (防止形成自环)
                if (dev.id === meterId) continue;

                // 识别功能性设备 (终点)：有电阻或是源
                if (dev.currentResistance >= 0.001 || dev.type === 'source' || dev.type === 'transmitter_2wire' || dev.type === 'PID' || dev.type === 'diode' || dev.type === 'bjt' || dev.type === 'amplifier') {
                    found.push({ device: dev, extPort: curr });
                }

                // 穿透其它零电阻设备 (如开关、继电器、其他电流表)
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
        if (dev.type === 'ampmeter' || (dev.type === 'multimeter' && dev.mode === 'MA')) return true;
        if (dev.type === 'switch' && !dev.isOpen) return true;
        if (dev.type === 'relay' && dev.isEnergized) return true;
        if (dev.currentResistance < 0.001 && dev.type !== 'source') return true;
        return false;
    }

    // ================= 变送器与电阻测量工具 =================

    /**
     * 辅助 4：计算变送器电流 (基于 PT100 阻值映射)
     * 逻辑：检测 PT100 接线状态 -> 读取阻值 -> 线性映射到 4-20mA -> 限幅
     */
    _calcTransmitterCurrent(dev) {
        if (dev.isOpened === true) return 0;
        const cL = this.portToCluster.get(`${dev.id}_wire_l`);
        const cM = this.portToCluster.get(`${dev.id}_wire_m`);
        const cR = this.portToCluster.get(`${dev.id}_wire_r`);

        // 1. 硬件故障判断 (优先级最高)
        if (cL === undefined || cM === undefined || cR === undefined) return 0.0216; // 未接线 -> 21.6mA (报警)
        if (cM !== cR) return 0.0216; // PT100 感温元件开路 -> 21.6mA
        if (cM === cL && cM === cR) return 0.0036; // PT100 短路 -> 3.6mA

        // 2. 正常寻找匹配的 PT100 电阻
        let R = 10000000;
        this.rawDevices.filter(d => d.type === 'resistor').forEach(r => {
            const rL = this.portToCluster.get(`${r.id}_wire_l`);
            const rR = this.portToCluster.get(`${r.id}_wire_r`);
            // 匹配连接关系
            if ((rL === cL && rR === cR) || (rL === cR && rR === cL)) {
                R = r.currentResistance;
            }
        });

        // 3. 计算电流 (4-20mA 对应 0-100 度)
        // 公式：I = 16 * (R - 100) / 38.51 + 4
        const iRaw = 16 * (R - 100) / 38.51 + 4;
        const iFix = (iRaw * dev.spanAdj + dev.zeroAdj) / 1000;

        // 4. 饱和限制 (3.8mA - 20.5mA)
        return Math.max(0.0038, Math.min(0.0205, iFix));
    }

    // 辅助 5a：获取端口电压
    getVoltageAtPort(pId) {
        const cIdx = this.portToCluster.get(pId);
        return cIdx !== undefined ? (this.nodeVoltages.get(cIdx) || 0) : 0;
    }

    // 辅助 5b：获取两点压差
    getPD(pA, pB) {
        const aIdx = this.portToCluster.get(pA);
        const bIdx = this.portToCluster.get(pB);
        if (aIdx === undefined || bIdx === undefined) return 0;
        return this.getVoltageAtPort(pA) - this.getVoltageAtPort(pB);
    }

    /**
     * 辅助 6：矩阵注入法测量等效电阻 (_getEquivalentResistance)
     * 原理：
     * 1. 构建一个临时子电路矩阵，排除 endCluster (将其视为地)。
     * 2. 在 startCluster 注入 1A 电流源。
     * 3. 求解 startCluster 的电压 V。
     * 4. 根据 R = V / I，因 I=1，故 R = V。
     * 优点：能自动处理复杂的串并联、电桥结构，无需手动遍历路径。
     */
    _getEquivalentResistance(startCluster, endCluster, allClusters) {
        const startIdx = allClusters.indexOf(startCluster);
        const endIdx = allClusters.indexOf(endCluster);

        if (startIdx === -1 || endIdx === -1) return Infinity;
        if (startIdx === endIdx) return 0;

        // 1. 准备临时节点地图 (排除 endCluster，因为它被设为参考地)
        const nodeMap = new Map();
        let mSize = 0;
        for (let i = 0; i < allClusters.length; i++) {
            if (i !== endIdx) nodeMap.set(i, mSize++);
        }

        const G = Array.from({ length: mSize }, () => new Float64Array(mSize));
        const B = new Float64Array(mSize);

        // 2. 填充所有电阻电导 (仅考虑连接两个不同簇的电阻)
        for (let i = 0; i < allClusters.length; i++) {
            for (let j = i + 1; j < allClusters.length; j++) {
                const res = this._getParallelResistanceBetweenClusters(allClusters[i], allClusters[j]);
                if (res.count > 0 && res.totalR !== Infinity) {
                    const g = 1 / res.totalR;
                    // 填充逻辑同 _fillMatrix，但针对 endIdx 为地的情况简化
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

        // 3. 在 A 节点 (startIdx) 注入 1A 电流
        const aNodeIdx = nodeMap.get(startIdx);
        if (aNodeIdx === undefined) return Infinity; // A 到 B 完全不通
        B[aNodeIdx] = 1.0;

        // 4. 注入 GMIN 保证非奇异矩阵
        for (let i = 0; i < mSize; i++) G[i][i] += 1e-15;

        // 5. 求解电压
        try {
            const results = this._gauss(G, B);
            const vA = results[aNodeIdx];
            // 如果电压极大，说明电阻极大或断路
            return (vA > 1e9) ? Infinity : vA;
        } catch (e) {
            return Infinity;
        }
    }

    /**
     * 辅助：计算两个等电位集群之间的总并联电阻
     * 遍历所有电阻，找出跨接在 clusterA 和 clusterB 之间的电阻，计算并联值
     */
    _getParallelResistanceBetweenClusters(clusterA, clusterB) {
        let inverseRSum = 0;
        let resistorCount = 0;
        let hasZeroResistor = false;

        if (clusterA === clusterB) return { totalR: 0, count: 0 };

        this.rawDevices.forEach(dev => {
            if (dev.type === 'resistor') {
                // 检查电阻两端是否分别位于两个簇中
                const p0InA = clusterA.has(`${dev.id}_wire_l`);
                const p1InB = clusterB.has(`${dev.id}_wire_r`);
                const p0InB = clusterB.has(`${dev.id}_wire_l`);
                const p1InA = clusterA.has(`${dev.id}_wire_r`);

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
        if (hasZeroResistor) return { totalR: 0, count: resistorCount }; // 只要有 0 电阻并联，总阻为 0
        if (resistorCount === 0) return { totalR: Infinity, count: 0 }; // 无连接，开路

        return {
            totalR: 1 / inverseRSum,
            count: resistorCount
        };
    }
}