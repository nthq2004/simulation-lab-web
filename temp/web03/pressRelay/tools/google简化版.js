/**
 * 高性能全功能电路求解器 V5.1 - 完整等效版
 * 已集成：电阻、电容、电感、二极管、三极管、运放、PID、变送器、电机、三相电源
 * 包含：物理电流计算、仪表同步更新、一维矩阵优化、拓扑哈希缓存
 */
export class CircuitSolver {
    constructor(devices) {
        this.deltaTime = 0.0001; 
        this.currentTime = 0;
        this.globalIterCount = 0;
        this.rawDevices = devices;

        this.portToCluster = new Map();
        this.clusterCount = 0;
        
        // 性能优化内存池
        this.MAX_SIZE = 256; 
        this.matrixG = new Float64Array(this.MAX_SIZE * this.MAX_SIZE);
        this.vectorB = new Float64Array(this.MAX_SIZE);
        this.lastTopologyHash = "";
    }

    /**
     * 主更新循环
     */
    update(conns) {
        const activeConnections = conns.filter(c => c.type === 'wire');

        // 1. 拓扑检查（结构未变时不重构矩阵映射）
        const currentHash = this._getTopologyHash(activeConnections);
        if (currentHash !== this.lastTopologyHash) {
            this._buildTopology(activeConnections);
            this.lastTopologyHash = currentHash;
        }

        // 2. 执行物理求解
        this._solve();

        this.currentTime += this.deltaTime;
        this.globalIterCount++;

        // 3. 仪表更新：每10帧(1ms)更新一次仪表状态，显著提升渲染性能
        if (this.globalIterCount % 10 === 0) {
            this._updateInstruments();
        }
    }

    _getTopologyHash(conns) {
        let hash = "W" + conns.length;
        for (let i = 0; i < this.rawDevices.length; i++) {
            const d = this.rawDevices[i];
            if (d.type === 'switch') hash += d.isOpen ? "1" : "0";
            if (d.type === 'relay') hash += d.isEnergized ? "1" : "0";
        }
        return hash;
    }

    _buildTopology(activeConns) {
        this.portToCluster.clear();
        const parent = {};

        const find = (i) => (parent[i] === undefined || parent[i] === i) ? i : (parent[i] = find(parent[i]));
        const union = (i, j) => {
            const rI = find(i), rJ = find(j);
            if (rI !== rJ) parent[rI] = rJ;
        };

        // 物理导线
        activeConns.forEach(c => union(c.from, c.to));

        // 器件内部零电阻通路（并查集穿透）
        this.rawDevices.forEach(dev => {
            if (dev.type === 'switch' && !dev.isOpen) union(`${dev.id}_wire_l`, `${dev.id}_wire_r`);
            if (dev.type === 'ampmeter' || dev.type === 'relay_contact_nc') union(`${dev.id}_wire_p`, `${dev.id}_wire_n`);
            if (dev.type === 'relay_contact_no' && dev.isClosed) union(`${dev.id}_wire_p`, `${dev.id}_wire_n`);
        });

        const rootToIndex = new Map();
        let nextIdx = 0;
        this.rawDevices.forEach(dev => {
            this._getDevicePorts(dev).forEach(p => {
                const r = find(p);
                if (!rootToIndex.has(r)) rootToIndex.set(r, nextIdx++);
                this.portToCluster.set(p, rootToIndex.get(r));
            });
        });
        this.clusterCount = nextIdx;
    }

    _solve() {
        if (this.clusterCount === 0) return;

        // 识别 GND
        const gndClusters = new Set();
        this.rawDevices.filter(d => d.type === 'gnd').forEach(g => {
            const idx = this.portToCluster.get(`${g.id}_wire_gnd`);
            if (idx !== undefined) gndClusters.add(idx);
        });

        const nodeMap = new Map();
        let mIdx = 0;
        for (let i = 0; i < this.clusterCount; i++) {
            if (!gndClusters.has(i)) nodeMap.set(i, mIdx++);
        }

        // 电压源映射：记录每个电压源在解向量中的位置，用于提取电流
        const vSourceMap = new Map(); 
        let vEqCount = 0;
        this.rawDevices.forEach(d => {
            const startIdx = mIdx + vEqCount;
            if (['source', 'ac_source', 'transmitter', 'PID', 'amplifier'].includes(d.type)) {
                vSourceMap.set(d.id, [startIdx]);
                vEqCount++;
            } else if (d.type === 'source_3p') {
                vSourceMap.set(d.id, [startIdx, startIdx + 1, startIdx + 2]);
                vEqCount += 3;
            }
        });

        const n = mIdx + vEqCount;
        if (n > this.MAX_SIZE || n <= 0) return;

        let solution = new Float64Array(n);

        // 非线性迭代
        for (let iter = 0; iter < 40; iter++) {
            this.matrixG.fill(0, 0, n * n);
            this.vectorB.fill(0, 0, n);

            let vSourcePtr = mIdx;

            this.rawDevices.forEach(dev => {
                const getC = (pn) => nodeMap.get(this.portToCluster.get(`${dev.id}_wire_${pn}`));
                
                switch (dev.type) {
                    case 'resistor':
                        this._addG(n, getC('l'), getC('r'), 1 / dev.currentResistance);
                        break;
                    case 'capacitor':
                    case 'inductor':
                    case 'motor':
                        const { gEq, iEq } = dev.getCompanionModel(this.deltaTime);
                        this._addG(n, getC('l'), getC('r'), gEq);
                        this._addI(getC('l'), getC('r'), iEq);
                        break;
                    case 'diode':
                        const vd = (solution[getC('p')] || 0) - (solution[getC('n')] || 0);
                        const { g: gD, iEq: iD } = dev.getLinearizedModel(vd);
                        this._addG(n, getC('p'), getC('n'), gD);
                        this._addI(getC('p'), getC('n'), iD);
                        break;
                    case 'source':
                    case 'ac_source':
                        const val = dev.type === 'source' ? dev.getValue() : dev.getInstantaneousVoltage(this.currentTime);
                        this._addV(n, getC('p'), getC('n'), val, vSourcePtr++);
                        break;
                    case 'source_3p':
                        ['u', 'v', 'w'].forEach(ph => {
                            this._addV(n, getC(ph), getC('n'), dev.getPhaseVoltage(ph, this.currentTime), vSourcePtr++);
                        });
                        break;
                    case 'transmitter':
                        this._addV(n, getC('p'), getC('n'), dev.getValue(), vSourcePtr++);
                        break;
                    case 'PID':
                        this._addV(n, getC('out'), getC('n'), dev.getOutput(), vSourcePtr++);
                        break;
                    case 'amplifier':
                        const idxP = getC('p'), idxN = getC('n'), idxOut = getC('out');
                        if (idxOut !== undefined) {
                            if (idxP !== undefined) this.matrixG[vSourcePtr * n + idxP] = 1;
                            if (idxN !== undefined) this.matrixG[vSourcePtr * n + idxN] = -1;
                            this.matrixG[vSourcePtr * n + idxOut] = -1 / 100000;
                            this.matrixG[idxOut * n + vSourcePtr] = 1;
                            vSourcePtr++;
                        }
                        break;
                }
            });

            const nextSol = this._gauss(n);
            let err = 0;
            for (let i = 0; i < n; i++) err = Math.max(err, Math.abs(nextSol[i] - solution[i]));
            solution = nextSol;
            if (err < 1e-5) break;
        }

        this._apply(solution, nodeMap, vSourceMap);
    }

    // 辅助注入函数
    _addG(n, i, j, g) {
        if (i !== undefined) this.matrixG[i * n + i] += g;
        if (j !== undefined) this.matrixG[j * n + j] += g;
        if (i !== undefined && j !== undefined) {
            this.matrixG[i * n + j] -= g;
            this.matrixG[j * n + i] -= g;
        }
    }
    _addI(i, j, iEq) {
        if (i !== undefined) this.vectorB[i] -= iEq;
        if (j !== undefined) this.vectorB[j] += iEq;
    }
    _addV(n, p, nIdx, val, vPtr) {
        if (p !== undefined) {
            this.matrixG[p * n + vPtr] = 1;
            this.matrixG[vPtr * n + p] = 1;
        }
        if (nIdx !== undefined) {
            this.matrixG[nIdx * n + vPtr] = -1;
            this.matrixG[vPtr * n + nIdx] = -1;
        }
        this.vectorB[vPtr] = val;
    }

    _gauss(n) {
        const A = this.matrixG, b = this.vectorB;
        for (let i = 0; i < n; i++) {
            let p = i;
            for (let j = i + 1; j < n; j++) if (Math.abs(A[j * n + i]) > Math.abs(A[p * n + i])) p = j;
            for (let k = i; k < n; k++) [A[i * n + k], A[p * n + k]] = [A[p * n + k], A[i * n + k]];
            [b[i], b[p]] = [b[p], b[i]];
            const v = A[i * n + i];
            if (Math.abs(v) < 1e-18) continue;
            for (let j = i + 1; j < n; j++) {
                const f = A[j * n + i] / v;
                b[j] -= f * b[i];
                for (let k = i; k < n; k++) A[j * n + k] -= f * A[i * n + k];
            }
        }
        const x = new Float64Array(n);
        for (let i = n - 1; i >= 0; i--) {
            let s = 0;
            for (let j = i + 1; j < n; j++) s += A[i * n + j] * x[j];
            x[i] = (b[i] - s) / A[i * n + i];
        }
        return x;
    }

    /**
     * 将求解结果应用回器件，并计算物理电流
     */
    _apply(sol, nodeMap, vSourceMap) {
        this.rawDevices.forEach(dev => {
            const getV = (pn) => {
                const c = this.portToCluster.get(`${dev.id}_wire_${pn}`);
                return nodeMap.has(c) ? sol[nodeMap.get(c)] : 0;
            };

            const vL = getV('l') || getV('p') || getV('u') || getV('out');
            const vR = getV('r') || getV('n');

            // --- 电流提取逻辑 ---
            if (vSourceMap.has(dev.id)) {
                // 对于电压源类，电流存储在解向量的额外方程位置
                const indices = vSourceMap.get(dev.id);
                dev.physCurrent = -sol[indices[0]]; // 负号符合从P流向N的物理定义
                if (dev.type === 'source_3p') {
                    dev.phaseCurrents = indices.map(idx => -sol[idx]);
                }
            } else if (dev.calculatePhysicalCurrent) {
                // 对于无源器件，通过 V/R 或伴随模型计算
                dev.calculatePhysicalCurrent(vL, vR, this.deltaTime);
            }

            if (dev.updateState) dev.updateState(vL, vR, this.deltaTime);
        });
    }

    _getDevicePorts(dev) {
        if (dev.type === 'source_3p') return ['u', 'v', 'w', 'n'].map(k => `${dev.id}_wire_${k}`);
        if (dev.type === 'amplifier' || dev.type === 'PID') return ['p', 'n', 'out'].map(k => `${dev.id}_wire_${k}`);
        if (dev.type === 'gnd') return [`${dev.id}_wire_gnd`];
        return ['l', 'r', 'p', 'n'].map(k => `${dev.id}_wire_${k}`);
    }

    _updateInstruments() {
        // 更新所有示波器、电压表、电流表的文字显示
        this.rawDevices.forEach(d => {
            if (typeof d.update === 'function') d.update();
        });
        
        // 触发外部的回调（如更新全局绘图层）
        if (this.sys && typeof this.sys.onSolverUpdate === 'function') {
            this.sys.onSolverUpdate();
        }
    }
}