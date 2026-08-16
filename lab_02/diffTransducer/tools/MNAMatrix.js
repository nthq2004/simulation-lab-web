/**
 * MNAMatrix.js
 * MNA 矩阵底层操作：填充、求解、电压源/电流源注入
 */

export const MNAMatrix = {

    /**
     * 填充导纳矩阵（普通双端元件）
     */
    fillMatrix(G, B, nodeMap, gndClusterIndices, vPosMap, c1, c2, g) {
        if (c1 === undefined || c2 === undefined) return;
        const get = (c) => {
            if (gndClusterIndices.has(c)) return { t: 'g' };
            if (vPosMap.has(c)) return { t: 'v', v: vPosMap.get(c) };
            const idx = nodeMap.get(c);
            if (idx === undefined) return { t: 'none' };
            return { t: 'u', i: idx };
        };
        // 电导矩阵标准填入4个元素。如果有一个是接地的，只填入一个
        const n1 = get(c1), n2 = get(c2);
        if (n1.t === 'u') {
            G[n1.i][n1.i] += g;
            if (n2.t === 'u') G[n1.i][n2.i] -= g;
            // 如果有一端电压已知，则该点到已知电压点流出一个电流g*(vi-V),所有右边电流支路增加一个g*V.
            else if (n2.t === 'v') B[n1.i] += g * n2.v;
        }
        if (n2.t === 'u') {
            G[n2.i][n2.i] += g;
            if (n1.t === 'u') G[n2.i][n1.i] -= g;
            else if (n1.t === 'v') B[n2.i] += g * n1.v;
        }
    },

    /**
     * 填充 BJT 伴随模型矩阵
     */
    /**
     * 填充 BJT（双极结型晶体管）到 MNA 矩阵
     * @param {Array[]} G - 系统的电导矩阵 (LHS)
     * @param {number[]} B - 系统的电流矢量 (RHS)
     * @param {Map} nodeMap - 节点名称到矩阵索引的映射
     * @param {string} cC - 集电极 (Collector) 节点名称
     * @param {string} cB - 基极 (Base) 节点名称
     * @param {string} cE - 发射极 (Emitter) 节点名称
     * @param {Object} model - 三极管模型实例，包含当前迭代状态
     */
    fillBJTMatrix(G, B, nodeMap, cC, cB, cE, model) {
        // 获取 C、B、E 三个端子在矩阵中对应的行/列索引
        const idx = { c: nodeMap.get(cC), b: nodeMap.get(cB), e: nodeMap.get(cE) };

        // 从模型内部状态中提取线性化参数：
        // gBE: BE结的等效电导 (di/dv)
        // iBE: 伴随电流源补偿项
        // beta: 电流放大系数 (HFE)
        // gCE_sat: 饱和区等效电导 (用于模拟 VCE 饱和压降)
        // pol: 极性因子 (NPN 为 1, PNP 为 -1)
        // V_SAT: 饱和压降阈值
        const { gBE, iBE, beta, gCE_sat, pol, V_SAT } = model.internal;

        // 辅助函数：安全地向 G 矩阵添加电导值（过滤未接地/未定义的节点）
        const addG = (r, c, val) => { if (r !== undefined && c !== undefined) G[r][c] += val; };

        // --- 1. BE 结注入 (基极控制端线性化模型) ---
        // BE 结被建模为一个电阻 (1/gBE) 和电流源 (iBE) 的并联
        // 在 G 矩阵中填充 BE 结之间的跨导
        addG(idx.b, idx.b, gBE); addG(idx.b, idx.e, -gBE);
        addG(idx.e, idx.b, -gBE); addG(idx.e, idx.e, gBE);

        // 在 B 矢量中填充 BE 结的伴随电流源
        // pol 用于处理 NPN/PNP 电流方向相反的问题
        if (idx.b !== undefined) B[idx.b] -= pol * iBE;
        if (idx.e !== undefined) B[idx.e] += pol * iBE;

        // --- 2. 受控源 (模拟 IC = beta * IB 的放大特性) ---
        // 定义跨导项 transG，将基极电压的变化转换为集电极电流的变化
        const transG = beta * gBE;

        // 填充 VCCS（电压控制电流源）到 G 矩阵
        // 这代表了 Ic 对 Vbe 的依赖关系。ic =beta* gbe*(vb-ve)+beta*iBE
        addG(idx.c, idx.b, transG * pol);  // Ic 正比于 Vb
        addG(idx.c, idx.e, -transG * pol); // Ic 反比于 Ve
        addG(idx.e, idx.b, -transG * pol); // 发射极电流平衡项
        addG(idx.e, idx.e, transG * pol);

        // 填充受控电流源的常数补偿项到 B 矢量
        const iControl = beta * iBE;
        if (idx.c !== undefined) B[idx.c] -= pol * iControl;
        if (idx.e !== undefined) B[idx.e] += pol * iControl;

        // --- 3. 饱和/钳位项 (处理 VCE 饱和区) ---
        // 如果 BJT 进入饱和区，ce 之间表现为很小的电阻
        if (gCE_sat > 0) {
            // 在 C、E 节点间添加等效电导
            addG(idx.c, idx.c, gCE_sat);
            addG(idx.c, idx.e, -gCE_sat);
            addG(idx.e, idx.c, -gCE_sat);
            addG(idx.e, idx.e, gCE_sat);

            // 补偿电流源，用于将 VCE 维持在 V_SAT 附近
            const iSatComp = V_SAT * gCE_sat * pol;
            if (idx.c !== undefined) B[idx.c] += iSatComp;
            if (idx.e !== undefined) B[idx.e] -= iSatComp;
        }
    },

    /**
     * 在 MNA 矩阵中添加电压源: V(c1) - V(c2) = voltage
     * 如果 c2 为 -1，则表示相对于 GND
     */
    addVoltageSource(G, B, nodeMap, gndClusterIndices, vPosMap, c1, c2, voltage, vIdx) {
        const i = gndClusterIndices.has(c1) ? -1 : (vPosMap.has(c1) ? -2 : nodeMap.get(c1));
        const j = (c2 === -1 || gndClusterIndices.has(c2)) ? -1 : (vPosMap.has(c2) ? -2 : nodeMap.get(c2));

        //如果接地、电压簇里面有该节点，矩阵里没有该行的存在，电压要进行调整。
        let adjustedV = voltage;
        if (vPosMap.has(c1)) adjustedV -= vPosMap.get(c1);
        if (vPosMap.has(c2)) adjustedV += vPosMap.get(c2);
        B[vIdx] = adjustedV;
        // 电压源 行= vIndex ; vi - vj = voltage;
        if (i >= 0) { G[vIdx][i] = 1; G[i][vIdx] = 1; }
        // 列是节点电流方程，从i流出为正，从j流进为 -1
        if (j >= 0) { G[vIdx][j] = -1; G[j][vIdx] = -1; }
    },

    /**
     * 在 MNA 矩阵中添加电流源: 从 cPos 流向 cNeg
     */
    addCurrentSource(B, nodeMap, cPos, cNeg, current) {
        const i = nodeMap.get(cPos);
        const j = nodeMap.get(cNeg);
        if (i !== undefined) B[i] += current;
        if (j !== undefined) B[j] -= current;
    },

    /**
     * 列主元高斯消去法求解线性方程组 Ax = b
     */
    gauss(A, b) {
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
    },
};
