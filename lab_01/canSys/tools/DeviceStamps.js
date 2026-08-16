/**
 * DeviceStamps.js
 * 各器件的 MNA 矩阵注入（stamp）
 * 每个方法接收求解器上下文 ctx（含 portToCluster / nodeMap / gndClusterIndices / vPosMap / clusters）
 * 以及矩阵 G / B，并返回 vSourceIdx（更新后的电压源索引计数器）。
 */

import { MNAMatrix } from './MNAMatrix.js';

export const DeviceStamps = {

    // ─── 辅助：绑定 ctx 到 MNAMatrix 的快捷调用 ───────────────────────────
    _fill(ctx, G, B, c1, c2, g) {
        MNAMatrix.fillMatrix(G, B, ctx.nodeMap, ctx.gndClusterIndices, ctx.vPosMap, c1, c2, g);
    },
    _addV(ctx, G, B, c1, c2, v, vIdx) {
        MNAMatrix.addVoltageSource(G, B, ctx.nodeMap, ctx.gndClusterIndices, ctx.vPosMap, c1, c2, v, vIdx);
    },
    _addI(ctx, B, cPos, cNeg, i) {
        MNAMatrix.addCurrentSource(B, ctx.nodeMap, cPos, cNeg, i);
    },

    // ─── 1. 线性电阻 ──────────────────────────────────────────────────────
    stampResistors(ctx, G, B, resistorDevs) {
        resistorDevs.forEach(dev => {
            if (dev.currentResistance < 0.1) return;
            const c1 = ctx.portToCluster.get(`${dev.id}_wire_l`);
            const c2 = ctx.portToCluster.get(`${dev.id}_wire_r`);
            const R = dev.currentResistance !== undefined ? dev.currentResistance : 1e9;
            if (c1 !== undefined && c2 !== undefined)
                this._fill(ctx, G, B, c1, c2, 1 / R);
        });
    },

    // ─── 2. 压力传感器（双路电阻） ────────────────────────────────────────
    stampPressureSensors(ctx, G, B, pressDevs) {
        pressDevs.forEach(dev => {
            const c1l = ctx.portToCluster.get(`${dev.id}_wire_r1l`);
            const c1r = ctx.portToCluster.get(`${dev.id}_wire_r1r`);
            if (c1l !== undefined && c1r !== undefined)
                this._fill(ctx, G, B, c1l, c1r, 1 / Math.max(0.001, dev.r1));

            const c2l = ctx.portToCluster.get(`${dev.id}_wire_r2l`);
            const c2r = ctx.portToCluster.get(`${dev.id}_wire_r2r`);
            if (c2l !== undefined && c2r !== undefined)
                this._fill(ctx, G, B, c2l, c2r, 1 / Math.max(0.001, dev.r2));
        });
    },

    // ─── 3. 变送器（受控电阻模型） ───────────────────────────────────────
    stampTransmitters(ctx, G, B, transmitterDevs) {
        transmitterDevs.forEach(dev => {
            const cP = ctx.portToCluster.get(`${dev.id}_wire_p`);
            const cN = ctx.portToCluster.get(`${dev.id}_wire_n`);
            if (cP === undefined || cN === undefined) return;

            const lastV = dev._lastVDiff !== undefined ? dev._lastVDiff : 0;
            let dynamicG;
            if (lastV < 10) {
                dynamicG = 1 / 1e9;
            } else {
                const targetI = ctx.calcTransmitterCurrent(dev);
                dynamicG = targetI / lastV;
            }
            if (dev._lastG === undefined) dev._lastG = dynamicG;
            dev._lastG = (dynamicG + dev._lastG) / 2;
            this._fill(ctx, G, B, cP, cN, dev._lastG);
        });
    },

    // ─── 4. DC/AC 电源（诺顿等效：电流源 + 内阻并联） ──────────────────
    stampPowerSources(ctx, G, B, powerDevs, currentVSourceIdx, currentTime) {
        powerDevs.forEach((dev, idx) => {
            const pId = `${dev.id}_wire_p`;
            const nId = `${dev.id}_wire_n`;
            const cP = ctx.portToCluster.get(pId);
            const cN = ctx.portToCluster.get(nId);

            if (cP !== undefined && cN !== undefined) {
                const voltage = dev.getValue(currentTime);
                const rOn = dev.rOn || 0.1;

                // 诺顿等效：
                // 1. 填充内阻导纳到 G 矩阵（p 到 n 之间）
                this._fill(ctx, G, B, cP, cN, 1 / rOn);

                // 2. 在 B 向量中注入等效电流源：I = V / rOn
                const iSource = voltage / rOn;
                this._addI(ctx, B, cP, cN, iSource);
            }
        });
    },

    // ─── 5. 三相电源（诺顿等效：每相都是电流源 + 内阻并联） ──────────────
    stampPower3Sources(ctx, G, B, power3Devs, currentVSourceIdx, currentTime) {
        power3Devs.forEach((dev, idx) => {
            ['u', 'v', 'w'].forEach((phase, phaseIdx) => {
                const pId = `${dev.id}_wire_${phase}`;
                const nId = `${dev.id}_wire_n`;
                const cP = ctx.portToCluster.get(pId);
                const cN = ctx.portToCluster.get(nId);

                if (cP !== undefined && cN !== undefined) {
                    const voltage = dev.getPhaseVoltage(phase, currentTime);
                    const rOn = dev.rOn || 0.1;

                    // 诺顿等效：
                    // 1. 填充内阻导纳到 G 矩阵（phase 到 n 之间）
                    this._fill(ctx, G, B, cP, cN, 1 / rOn);

                    // 2. 在 B 向量中注入等效电流源：I = V / rOn
                    const iSource = voltage / rOn;
                    this._addI(ctx, B, cP, cN, iSource);
                }
            });
        });
    },


    // ─── 6. PID 控制器 ────────────────────────────────────────────────────
    /**
     * @returns {number} 更新后的 currentVSourceIdx
     */
    stampPIDs(ctx, G, B, pidDevs, currentVSourceIdx) {
        const injectLimitedCurrent = (pid, cPos, cNeg, targetMA, maxV, onResolved) => {
            if (cPos === undefined || cNeg === undefined) return;
            const targetA = targetMA / 1000;
            const rReq = ctx.getEquivalentResistance(
                ctx.clusters[cPos], ctx.clusters[cNeg], ctx.clusters
            );
            if (rReq * targetA > maxV || rReq > 1000000) {
                const vIdx = currentVSourceIdx;
                this._addV(ctx, G, B, cPos, cNeg, maxV, currentVSourceIdx++);
                onResolved?.({ mode: 'voltage', index: vIdx });
            } else {
                this._addI(ctx, B, cPos, cNeg, targetA);
                currentVSourceIdx++;
                onResolved?.({ mode: 'current', valueA: targetA });
            }
        };

        pidDevs.forEach(pid => {
            if (!pid.powerOn) {
                pid.ch1Current = 0;
                pid.ch2Current = 0;
                return;
            }
            const p = `${pid.id}_wire_`;

            // PID 内部 GND 端点（no1、no2 负端都连接到这里）
            const cGnd = ctx.portToCluster.get(`${p}gnd`);

            // VCC 和 GND 之间注入 50Ω 电阻
            const cVcc = ctx.portToCluster.get(`${p}vcc`);
            if (cVcc !== undefined && cGnd !== undefined) {
                this._fill(ctx, G, B, cVcc, cGnd, 1 / 50);  // 50Ω = 0.02 S
            }

            // 4-20mA 输入回路：pi1(24V馈电) + ni1(250Ω内阻)
            const cPi1 = ctx.portToCluster.get(`${p}pi1`);
            const cNi1 = ctx.portToCluster.get(`${p}ni1`);
            if (cPi1 !== undefined)
                this._addV(ctx, G, B, cPi1, -1, 24.0, currentVSourceIdx++);
            if (cNi1 !== undefined)
                this._fill(ctx, G, B, cNi1, -1, 1 / 250);

            // CH1 输出：po1(+) 和 no1(-，连接到 GND)
            const cPo1 = ctx.portToCluster.get(`${p}po1`);
            const cNo1 = ctx.portToCluster.get(`${p}no1`);
            if (cPo1 !== undefined && cNo1 !== undefined &&
                (pid.outSelection === 'CH1' || pid.outSelection === 'BOTH')) {
                // no1 和 gnd 等电位
                if (cGnd !== undefined) {
                    this._fill(ctx, G, B, cNo1, cGnd, 1e6);  // 极强硬连接
                }

                if (pid.outModes.CH1 === '4-20mA') {
                    injectLimitedCurrent(pid, cPo1, cNo1, pid.output1mA, 23.5, (info) => {
                        pid._ch1CurrentInfo = info;
                    });
                } else if (pid.outModes.CH1 === 'PWM') {
                    pid.ch1VSourceIdx = currentVSourceIdx;
                    const vcc = ctx.getVoltageAtPort(`${p}vcc`) || 24;
                    const vTarget = pid.heatInstantOn ? vcc : 0;
                    this._addV(ctx, G, B, cPo1, cNo1, vTarget, currentVSourceIdx++);
                }
            }

            // CH2 输出：po2(+) 和 no2(-，连接到 GND)
            const cPo2 = ctx.portToCluster.get(`${p}po2`);
            const cNo2 = ctx.portToCluster.get(`${p}no2`);
            if (cPo2 !== undefined && cNo2 !== undefined &&
                (pid.outSelection === 'CH2' || pid.outSelection === 'BOTH')) {
                // no2 和 gnd 等电位
                if (cGnd !== undefined) {
                    this._fill(ctx, G, B, cNo2, cGnd, 1e6);  // 极强硬连接
                }

                if (pid.outModes.CH2 === '4-20mA') {
                    injectLimitedCurrent(pid, cPo2, cNo2, pid.output2mA, 23.5, (info) => {
                        pid._ch2CurrentInfo = info;
                    });
                } else if (pid.outModes.CH2 === 'PWM') {
                    pid.ch2VSourceIdx = currentVSourceIdx;
                    const vcc = ctx.getVoltageAtPort(`${p}vcc`) || 24;
                    const vTarget = pid.coolInstantOn ? vcc : 0;
                    this._addV(ctx, G, B, cPo2, cNo2, vTarget, currentVSourceIdx++);
                }
            }
        });
        return currentVSourceIdx;
    },

    // ─── 7. 热电偶（诺顿等效：电流源 + 内阻并联） ──────────────────
    stampThermocouples(ctx, G, B, tcDevs, currentVSourceIdx) {
        tcDevs.forEach(tc => {
            const cP = ctx.portToCluster.get(`${tc.id}_wire_r`);
            const cN = ctx.portToCluster.get(`${tc.id}_wire_l`);
            if (cP === undefined || cN === undefined) return;

            const voltage = tc.currentVoltage;
            const rInt = tc.currentResistance || 0.5;

            // 诺顿等效：
            // 1. 填充内阻导纳到 G 矩阵（p 到 n 之间）
            this._fill(ctx, G, B, cP, cN, 1 / rInt);

            // 2. 在 B 向量中注入等效电流源：I = V / rInt
            const iSource = voltage / rInt;
            this._addI(ctx, B, cP, cN, iSource);
        });
    },

    // ─── 8. 运算放大器 ───────────────────────────────────────────────────
    stampOpAmps(ctx, G, B, opAmps, opVIdx) {
        opAmps.forEach(op => {
            const cP = ctx.portToCluster.get(`${op.id}_wire_p`);
            const cN = ctx.portToCluster.get(`${op.id}_wire_n`);
            const cOut = ctx.portToCluster.get(`${op.id}_wire_OUT`);

            if (cOut !== undefined) {
                const outM = ctx.nodeMap.get(cOut);

                // 输出 0.2Ω 源电阻（导纳 = 1/0.2 = 5 S）
                if (outM !== undefined) {
                    this._fill(ctx, G, B, cOut, cOut, 5);
                }

                if (outM !== undefined) G[outM][opVIdx] += 1;

                if (op.internalState === 'linear') {
                    if (outM !== undefined) G[opVIdx][outM] = 1;
                    const pM = ctx.nodeMap.get(cP), nM = ctx.nodeMap.get(cN);
                    if (pM !== undefined) G[opVIdx][pM] -= op.gain;
                    else if (ctx.vPosMap.has(cP)) B[opVIdx] += op.gain * ctx.vPosMap.get(cP);
                    if (nM !== undefined) G[opVIdx][nM] += op.gain;
                    else if (ctx.vPosMap.has(cN)) B[opVIdx] -= op.gain * ctx.vPosMap.get(cN);
                } else {
                    if (outM !== undefined) G[opVIdx][outM] = 1;
                    B[opVIdx] = (op.internalState === 'pos_sat') ? op.vPosLimit : op.vNegLimit;
                }
            }
            op.currentIdx = opVIdx++;
        });
        return opVIdx;
    },

    // ─── 9. 二极管（非线性伴随模型） ────────────────────────────────────
    stampDiodes(ctx, G, B, diodeDevs, results) {
        diodeDevs.forEach(dev => {
            const cA = ctx.portToCluster.get(`${dev.id}_wire_l`);
            const cC = ctx.portToCluster.get(`${dev.id}_wire_r`);
            if (cA === undefined || cC === undefined) { dev.physCurrent = 0; return; }

            const vA = ctx.getVoltageFromResults(results, cA);
            const vC = ctx.getVoltageFromResults(results, cC);
            const vDiff = vA - vC;

            if (vDiff > dev.vForward) {
                const gOn = 1 / (dev.rOn || 0.5);
                const iEq = dev.vForward * gOn;
                this._fill(ctx, G, B, cA, cC, gOn);
                this._addI(ctx, B, cA, cC, iEq);
            } else {
                this._fill(ctx, G, B, cA, cC, 1 / (dev.rOff || 1e9));
            }
        });
    },

    // ─── 10. BJT 三极管 ───────────────────────────────────────────────────
    stampBJTs(ctx, G, B, bjtDevs, results) {
        bjtDevs.forEach(dev => {
            const cB = ctx.portToCluster.get(`${dev.id}_wire_b`);
            const cC = ctx.portToCluster.get(`${dev.id}_wire_c`);
            const cE = ctx.portToCluster.get(`${dev.id}_wire_e`);
            if (cB === undefined || (cC === undefined && cE === undefined)) return;

            const vB = ctx.getVoltageFromResults(results, cB);
            const vC = ctx.getVoltageFromResults(results, cC);
            const vE = ctx.getVoltageFromResults(results, cE);

            if (cB !== undefined && cE !== undefined && cC === undefined) {
                const vDiff = vB - vE;
                if (vDiff > 0.7) {
                    const gOn = 2, iEq = 0.7 * gOn;
                    this._fill(ctx, G, B, cB, cE, gOn);
                    this._addI(ctx, B, cB, cE, iEq);
                } else {
                    this._fill(ctx, G, B, cB, cE, 1 / 1e9);
                }
            } else if (cB !== undefined && cC !== undefined && cE === undefined) {
                const vDiff = vB - vC;
                if (vDiff > 0.7) {
                    const gOn = 2, iEq = 0.7 * gOn;
                    this._fill(ctx, G, B, cB, cC, gOn);
                    this._addI(ctx, B, cB, cC, iEq);
                } else {
                    this._fill(ctx, G, B, cB, cC, 1 / 1e9);
                }
            } else {
                const model = dev.getCompanionModel(vB, vC, vE) || { matrix: {}, currents: {} };
                MNAMatrix.fillBJTMatrix(G, B, ctx.nodeMap, cC, cB, cE, model);
            }
        });
    },

    // ─── 11. NJFET ─────────────────────────────────────────────────────────
    stampJFETs(ctx, G, B, jfetDevs, results) {
        jfetDevs.forEach(dev => {
            const cG = ctx.portToCluster.get(`${dev.id}_wire_g`);
            const cD = ctx.portToCluster.get(`${dev.id}_wire_d`);
            const cS = ctx.portToCluster.get(`${dev.id}_wire_s`);

            if (cG !== undefined) this._fill(ctx, G, B, cG, -1, 1e-12);

            if (cD !== undefined && cS !== undefined) {
                const vG = ctx.getVoltageFromResults(results, cG) || 0;
                const vS = ctx.getVoltageFromResults(results, cS) || 0;
                const res = dev.getDSResistance(vG - vS);
                this._fill(ctx, G, B, cD, cS, 1 / Math.max(0.001, res));
            }
        });
    },

    // ─── 12. 电容 / 电感（伴随模型） ─────────────────────────────────────
    stampReactives(ctx, G, B, devs, deltaTime) {
        devs.forEach(dev => {
            const cL = ctx.portToCluster.get(`${dev.id}_wire_l`);
            const cR = ctx.portToCluster.get(`${dev.id}_wire_r`);
            const { gEq, iEq } = dev.getCompanionModel(deltaTime);
            this._fill(ctx, G, B, cL, cR, gEq);
            this._addI(ctx, B, cL, cR, iEq);
        });
    },

    // ─── 13. 示波器（理想电流表：0V 电压源） ────────────────────────────
    stampOscilloscopes(ctx, G, B, oscDevs, oscVIdx) {
        oscDevs.forEach(dev => {
            const cIn = ctx.portToCluster.get(`${dev.id}_wire_l`);
            const cOut = ctx.portToCluster.get(`${dev.id}_wire_r`);
            if (cIn === undefined || cOut === undefined) return;
            this._addV(ctx, G, B, cIn, cOut, 0, oscVIdx);
            dev.currentIdx = oscVIdx++;
        });
        return oscVIdx;
    },

    // ─── 14. 压力变送器 / LVDT（受控电压源） ────────────────────────────
    stampLVDTs(ctx, G, B, lvdtDevs, ptVIdx) {
        lvdtDevs.forEach(dev => {
            const ports = ['p', 'n', 'outp', 'outn'].map(k => ctx.portToCluster.get(`${dev.id}_wire_${k}`));
            const [cInP, cInN, cOutP, cOutN] = ports;
            const m = ports.map(c => ctx.nodeMap.get(c));
            const [mInP, mInN, mOutP, mOutN] = m;

            if (cOutP !== undefined && cOutN !== undefined) {
                const k = dev.outputRatio || 0;
                if (mOutP !== undefined) G[mOutP][ptVIdx] += 1;
                if (mOutN !== undefined) G[mOutN][ptVIdx] -= 1;

                if (mOutP !== undefined) G[ptVIdx][mOutP] += 1;
                else if (ctx.vPosMap.has(cOutP)) B[ptVIdx] -= ctx.vPosMap.get(cOutP);

                if (mOutN !== undefined) G[ptVIdx][mOutN] -= 1;
                else if (ctx.vPosMap.has(cOutN)) B[ptVIdx] += ctx.vPosMap.get(cOutN);

                if (mInP !== undefined) G[ptVIdx][mInP] -= k;
                else if (ctx.vPosMap.has(cInP)) B[ptVIdx] += k * ctx.vPosMap.get(cInP);

                if (mInN !== undefined) G[ptVIdx][mInN] += k;
                else if (ctx.vPosMap.has(cInN)) B[ptVIdx] -= k * ctx.vPosMap.get(cInN);

                this._fill(ctx, G, B, cInP, cInN, 1e-9); // Gmin 防奇异
            } else {
                G[ptVIdx][ptVIdx] = 1;
            }
            dev.currentIdx = ptVIdx++;
        });
        return ptVIdx;
    },

    // ─── 15. 信号发生器（诺顿等效） ──────────────────────────────────────
    stampSignalGenerators(ctx, G, B, sgDevs, currentTime) {
        sgDevs.forEach(sg => {
            sg.voltOutputs = sg.update(currentTime);
            [
                { key: 'ch1', p: 'ch1p', n: 'ch1n', idx: 0 },
                { key: 'ch2', p: 'ch2p', n: 'ch2n', idx: 1 }
            ].forEach(chCfg => {
                const ch = sg.channels[chCfg.idx];
                const portP = ctx.portToCluster.get(`${sg.id}_wire_${chCfg.p}`);
                const portN = ctx.portToCluster.get(`${sg.id}_wire_${chCfg.n}`);

                if (ch.enabled && portN !== undefined && portP !== undefined) {
                    const Rs = 50, Gs = 1 / Rs;
                    const Vs = sg.voltOutputs[chCfg.key];
                    const Is = Vs / Rs;
                    this._fill(ctx, G, B, portP, portN, Gs);
                    this._addI(ctx, B, portP, portN, Is);
                }
            });
        });
    },

    // ─── 16 电压型继电器（线圈电阻） ────────────────────────────────────
    stampRelays(ctx, G, B, relayDevs) {
        relayDevs.forEach(dev => {
            if (dev.special !== 'voltage') return;
            const c1 = ctx.portToCluster.get(`${dev.id}_wire_l`);
            const c2 = ctx.portToCluster.get(`${dev.id}_wire_r`);
            const R = dev.currentResistance || 1000;
            if (c1 !== undefined && c2 !== undefined && R > 0.1)
                this._fill(ctx, G, B, c1, c2, 1 / R);
        });
    },

    // ─── 17. AI 模块（模拟量输入） ────────────────────────────────────
    /**
     * AI 模块注入：
     * CH1/CH2: 4-20mA 电流输入，通过 250Ω 采样电阻读取电流
     * CH3: RTD/PT100 热电阻输入，读取电阻值
     * CH4: TC/热电偶输入，读取电压
     * CAN1/CAN2: 当终端开关有效时，注入 120Ω 终端电阻
     */
    stampAI(ctx, G, B, aiDevs, currentVSourceIdx) {
        aiDevs.forEach(ai => {

            const p = `${ai.id}_wire_`;
            const c_can1p = ctx.portToCluster.get(`${p}can1p`);
            const c_can1n = ctx.portToCluster.get(`${p}can1n`);
            const c_can2p = ctx.portToCluster.get(`${p}can2p`);
            const c_can2n = ctx.portToCluster.get(`${p}can2n`);
            // ── CAN1 和 CAN2：终端电阻注入（当 termEnabled 有效时） ────
            if (ai.termEnabled) {

                if (c_can1p !== undefined && c_can1n !== undefined) {
                    // 注入 120Ω 终端电阻
                    this._fill(ctx, G, B, c_can1p, c_can1n, 1 / 120);
                }


                if (c_can2p !== undefined && c_can2n !== undefined) {
                    // 注入 120Ω 终端电阻
                    this._fill(ctx, G, B, c_can2p, c_can2n, 1 / 120);
                }
            }
            if (!ai.powerOn) return;

            // VCC 和 GND 之间：注入电源内阻 50Ω（保持电源稳定）
            const cVcc = ctx.portToCluster.get(`${p}vcc`);
            const cGnd = ctx.portToCluster.get(`${p}gnd`);
            if (cVcc !== undefined && cGnd !== undefined) {
                this._fill(ctx, G, B, cVcc, cGnd, 1 / 50);  // 50Ω 电源内阻
            }

            // ── CH1 (4-20mA) ──────────────────────────────────────────
            // 结构：电压源注入 - 在 ch1p 端口直接注入 24V 电压源
            const c_ch1p = ctx.portToCluster.get(`${p}ch1p`);
            const c_ch1n = ctx.portToCluster.get(`${p}ch1n`);
            if (c_ch1p !== undefined) {
                // 1. 在 ch1p 和 gnd 之间注入 24V 电压源（需要额外的方程）
                this._addV(ctx, G, B, c_ch1p, cGnd, 24.0, currentVSourceIdx++);
            }
            if (c_ch1n !== undefined) {
                // 2. 采样电阻在端口与接地端之间
                this._fill(ctx, G, B, c_ch1n, cGnd, 1 / 250);
            }

            // ── CH2 (4-20mA) ──────────────────────────────────────────
            const c_ch2p = ctx.portToCluster.get(`${p}ch2p`);
            const c_ch2n = ctx.portToCluster.get(`${p}ch2n`);
            if (c_ch2p !== undefined) {
                // 1. 在 ch2p 和 gnd 之间注入 24V 电压源（需要额外的方程）
                this._addV(ctx, G, B, c_ch2p, cGnd, 24.0, currentVSourceIdx++);
            }
            if (c_ch2n !== undefined) {
                // 2. 采样电阻在端口与接地端之间
                this._fill(ctx, G, B, c_ch2n, cGnd, 1 / 250);
            }

            // ── CH3 (RTD/PT100) ────────────────────────────────────────
            // 结构：诺顿等效 - 同 CH1/CH2 的馈电方式
            const c_ch3p = ctx.portToCluster.get(`${p}ch3p`);
            const c_ch3n = ctx.portToCluster.get(`${p}ch3n`);
            if (c_ch3p !== undefined && c_ch3n !== undefined) {
                // 诺顿等效
                const rFeed = 1000;
                const vFeed = 1.0;
                this._fill(ctx, G, B, c_ch3p, c_ch3n, 1 / rFeed);
                const iEq = vFeed / rFeed;
                this._addI(ctx, B, c_ch3p, c_ch3n, iEq);
            }

            // ── CH4 (TC/热电偶) ────────────────────────────────────────
            // 结构：直接连接热电偶两端，高阻输入（>1MΩ）
            const c_ch4p = ctx.portToCluster.get(`${p}ch4p`);
            const c_ch4n = ctx.portToCluster.get(`${p}ch4n`);
            if (c_ch4p !== undefined && c_ch4n !== undefined) {
                // 注入高阻输入（1MΩ），防止漏电流
                this._fill(ctx, G, B, c_ch4p, c_ch4n, 1 / 1000000);
            }

            if (c_can1p !== undefined && c_can1n !== undefined) {
                this._addV(ctx, G, B, c_can1p, cGnd, 2.5 + 0.2 * ai.sys.canBus._busLoad, currentVSourceIdx++);
                this._addV(ctx, G, B, c_can1n, cGnd, 2.5 - 0.2 * ai.sys.canBus._busLoad, currentVSourceIdx++);
            }

        });
        return currentVSourceIdx;
    },

    // ---18. 注入过程校验仪 (Process Calibrator) ---
    stampCalibrators(ctx, G, B, pcDevs, currentVSourceIdx, currentTime) {

        pcDevs.forEach(pc => {
            const id = pc.id;
            const p = `${id}_wire_`;
            //右边测量端的簇序号
            const cMa = ctx.portToCluster.get(`${p}meas_ma`);
            const cCom = ctx.portToCluster.get(`${p}meas_com`);
            //左边4个端的簇序号
            const cSMa = ctx.portToCluster.get(`${p}src_ma`);
            const cSCom = ctx.portToCluster.get(`${p}src_com`);
            const cSV = ctx.portToCluster.get(`${p}src_v`);
            const cSTc = ctx.portToCluster.get(`${p}src_tc`);
            if (pc.upMode === 'MEAS_LOOP') {
                // MEAS_LOOP: ma 引脚馈电 24V，com 引脚接 250Ω 到地
                if (cMa !== undefined) {
                    this._addV(ctx, G, B, cMa, -1, 24.0, currentVSourceIdx++);
                }
                if (cCom !== undefined) {
                    this._fill(ctx, G, B, cCom, -1, 1 / 250);
                }
            } else if (pc.upMode === 'MEAS_MA') {
                //测量4-20mA电流时，用250欧姆电阻，参数1-5V电压。
                if (cMa !== undefined && cCom !== undefined) {
                    this._fill(ctx, G, B, cMa, cCom, 1 / 250);
                }
            }
            // A. 测量面板逻辑 (MEASURE)
            if (pc.activePanel === 'MEASURE') {
                if (pc.measureMode === 'MEAS_MA') {
                    // MEAS_MA: ma 和 com 之间注入 250Ω 内阻
                    if (cSMa !== undefined && cSCom !== undefined) {
                        this._fill(ctx, G, B, cSMa, cSCom, 1 / 250);
                    }
                } else if (pc.measureMode === 'MEAS_LOOP') {
                    if (cSMa !== undefined) {
                        this._addV(ctx, G, B, cSMa, -1, 24.0, currentVSourceIdx++);
                    }
                    if (cSCom !== undefined) {
                        this._fill(ctx, G, B, cSCom, -1, 1 / 250);
                    }
                }
            }
            // B. 输出面板逻辑 (SOURCE)
            else if (pc.activePanel === 'SOURCE') {
                switch (pc.sourceMode) {
                    case 'SRC_MA':
                        // 注入电流源 (注意：这里可以使用之前讨论的限压逻辑，防止开路电压过高)
                        if (cSMa !== undefined && cSCom !== undefined) {
                            this._addI(ctx, B, cSMa, cSCom, pc.sourceValue / 1000);
                        }
                        break;
                    case 'SRC_LOOP':
                        // 注入一个变化的电导
                        if (cSMa !== undefined && cSCom !== undefined) {

                            const lastV = pc._lastVDiff !== undefined ? pc._lastVDiff : 0;
                            let dynamicG;
                            if (lastV < 10) {
                                dynamicG = 1 / 1e9;
                            } else {
                                const targetI = pc.sourceValue / 1000;
                                dynamicG = targetI / lastV;
                            }
                            if (pc._lastG === undefined) pc._lastG = dynamicG;
                            pc._lastG = (dynamicG + pc._lastG) / 2;
                            this._fill(ctx, G, B, cSMa, cSCom, pc._lastG);
                        }

                        break;
                    case 'SRC_V':
                        if (cSV !== undefined && cSCom !== undefined) {
                            this._addV(ctx, G, B, cSV, cSCom, pc.sourceValue, currentVSourceIdx++);
                        }
                        break;

                    case 'SRC_RES':
                        // 模拟电阻：利用 fillMatrix 注入电导
                        if (cSV !== undefined && cSCom !== undefined) {
                            const res = Math.max(0.1, pc.sourceValue); // 防止除以 0
                            this._fill(ctx, G, B, cSV, cSCom, 1 / res);

                        }
                        break;
                    case 'SRC_RTD':
                        // 模拟电阻：利用 fillMatrix 注入电导
                        if (cSV !== undefined && cSCom !== undefined) {
                            const ptRes = pc._tempToRTDOhm(pc.sourceValue);
                            const res = Math.max(0.1, ptRes.toFixed(2)); // 防止除以 0
                            this._fill(ctx, G, B, cSV, cSCom, 1 / res);

                        }
                        break;
                    case 'SRC_TC':
                        // 热电偶模拟：注入微伏/毫伏级电压源
                        if (cSTc !== undefined && cSCom !== undefined) {
                            this._addV(ctx, G, B, cSTc, cSCom, pc.sourceValue * 41 / 1e6, currentVSourceIdx++);
                        }
                        break;

                    case 'SRC_HZ':
                        // 频率模拟：通常注入瞬时电压（类似 PWM 的逻辑）
                        if (cSV !== undefined && cSCom !== undefined) {
                            const voltage = pc.getSourceValue(currentTime);
                            const rOn = pc.rOn || 0.1;
                            console.log(voltage);

                            // 诺顿等效：
                            // 1. 填充内阻导纳到 G 矩阵（p 到 n 之间）
                            this._fill(ctx, G, B, cSV, cSCom, 1 / rOn);

                            // 2. 在 B 向量中注入等效电流源：I = V / rOn
                            const iSource = voltage / rOn;
                            this._addI(ctx, B, cSV, cSCom, iSource);
                        }
                        break;
                }
            }
        });
        return currentVSourceIdx;
    }

};
