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
    },

    /**
     * 填充 BJT 伴随模型矩阵
     */
    fillBJTMatrix(G, B, nodeMap, cC, cB, cE, model) {
        const idx = { c: nodeMap.get(cC), b: nodeMap.get(cB), e: nodeMap.get(cE) };
        const { gBE, iBE, beta, gCE_sat, pol, V_SAT } = model.internal;
        const addG = (r, c, val) => { if (r !== undefined && c !== undefined) G[r][c] += val; };

        // 1. BE 结注入 (控制端)
        addG(idx.b, idx.b, gBE); addG(idx.b, idx.e, -gBE);
        addG(idx.e, idx.b, -gBE); addG(idx.e, idx.e, gBE);
        if (idx.b !== undefined) B[idx.b] -= pol * iBE;
        if (idx.e !== undefined) B[idx.e] += pol * iBE;

        // 2. 受控源 (放大项)
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
    },

    /**
     * 在 MNA 矩阵中添加电压源: V(c1) - V(c2) = voltage
     * 如果 c2 为 -1，则表示相对于 GND
     */
    addVoltageSource(G, B, nodeMap, gndClusterIndices, vPosMap, c1, c2, voltage, vIdx) {
        const i = gndClusterIndices.has(c1) ? -1 : (vPosMap.has(c1) ? -2 : nodeMap.get(c1));
        const j = (c2 === -1 || gndClusterIndices.has(c2)) ? -1 : (vPosMap.has(c2) ? -2 : nodeMap.get(c2));

        let adjustedV = voltage;
        if (vPosMap.has(c1)) adjustedV -= vPosMap.get(c1);
        if (vPosMap.has(c2)) adjustedV += vPosMap.get(c2);
        B[vIdx] = adjustedV;

        if (i >= 0) { G[vIdx][i] = 1; G[i][vIdx] = 1; }
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
