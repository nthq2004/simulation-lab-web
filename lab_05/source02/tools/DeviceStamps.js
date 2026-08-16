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
            const R = (dev.currentResistance !== undefined && dev.currentResistance >= 0.01) ? dev.currentResistance : 1e9;
            const c1 = ctx.portToCluster.get(`${dev.id}_wire_l`);
            const c2 = ctx.portToCluster.get(`${dev.id}_wire_r`);
            if (c1 !== undefined && c2 !== undefined)
                this._fill(ctx, G, B, c1, c2, 1 / R);
            if (dev.special === 'oilheater') {
                const cP = ctx.portToCluster.get(`${dev.id}_wire_p`);
                const cN = ctx.portToCluster.get(`${dev.id}_wire_n`);
                if (cP !== undefined && cN !== undefined) {
                    this._fill(ctx, G, B, cP, cN, 0.004);
                }
            }
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

            if (dev.special === 'diff_level') {
                const lId = `${dev.id}_wire_l`;
                const rId = `${dev.id}_wire_r`;
                const cL = ctx.portToCluster.get(lId);
                const cR = ctx.portToCluster.get(rId);
                if (cL !== undefined && cR !== undefined) {
                    this._fill(ctx, G, B, cL, cR, 1 / 250);
                }
            }
        });
    },

    // ─── 4. DC/AC 电源（诺顿等效：电流源 + 内阻并联） ──────────────────
    stampPowerSources(ctx, G, B, powerDevs, currentTime) {
        powerDevs.forEach((dev, idx) => {
            const pId = `${dev.id}_wire_p`;
            const nId = `${dev.id}_wire_n`;
            const cP = ctx.portToCluster.get(pId);
            const cN = ctx.portToCluster.get(nId);

            if (cP !== undefined && cN !== undefined) {
                const voltage = dev.getValue(currentTime);
                const rOn = Math.max(0.01, dev.rOn || 0.1);

                // 诺顿等效：
                // 1. 填充内阻导纳到 G 矩阵（p 到 n 之间）
                this._fill(ctx, G, B, cP, cN, 1 / rOn);

                // 2. 在 B 向量中注入等效电流源：I = V / rOn
                const iSource = voltage / rOn;
                this._addI(ctx, B, cP, cN, iSource);
            }
        });
    },

    // ─── 新：DC 源（special === 'dc_source'）
    // 将组件参数 dev.dcVoltage 注入为在 p 和 n 端口间的电压源（占用电压源方程）
    stampDCSources(ctx, G, B, dcDevs, currentVSourceIdx) {
        dcDevs.forEach(dev => {
            const pId = `${dev.id}_wire_p`;
            const nId = `${dev.id}_wire_n`;
            const cP = ctx.portToCluster.get(pId);
            const cN = ctx.portToCluster.get(nId);
            if (cP === undefined || cN === undefined) { dev.currentIdx = undefined; return; }
            const v = (dev.dcVoltage !== undefined) ? dev.dcVoltage : 0;
            dev.currentIdx = currentVSourceIdx;
            this._addV(ctx, G, B, cP, cN, v, currentVSourceIdx++);
        });
        return currentVSourceIdx;
    },

    // ─── 5. 三相电源（诺顿等效：每相都是电流源 + 内阻并联） ──────────────
    stampPower3Sources(ctx, G, B, power3Devs, currentTime) {
        power3Devs.forEach((dev, idx) => {
            ['u', 'v', 'w'].forEach((phase, phaseIdx) => {
                const pId = `${dev.id}_wire_${phase}`;
                const nId = `${dev.id}_wire_n`;
                const cP = ctx.portToCluster.get(pId);
                const cN = ctx.portToCluster.get(nId);

                if (cP !== undefined && cN !== undefined) {
                    const voltage = dev.getPhaseVoltage(phase, currentTime);
                    const rOn = Math.max(0.01, dev.rOn || 0.1);

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

    // ─── 5b. 三相异步电动机（各相对 PE 绝缘电阻） ─────────────────────
    stampMotors(ctx, G, B, motorDevs) {
        motorDevs.forEach(dev => {
            const addR = (p, R) => {
                const pid = `${dev.id}_wire_${p}`;
                const pe  = `${dev.id}_wire_pe`;
                const c1 = ctx.portToCluster.get(pid);
                const c2 = ctx.portToCluster.get(pe);
                if (c1 !== undefined && c2 !== undefined) {
                    this._fill(ctx, G, B, c1, c2, 1 / Math.max(0.001, R));
                }
            };
            addR('l1', dev.uohm ?? 20e6);
            addR('l2', dev.vohm ?? 20e6);
            addR('l3', dev.wohm ?? 20e6);
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
                // 限压模式：注入电压源，限制最大电压
                const vIdx = currentVSourceIdx;
                this._addV(ctx, G, B, cPos, cNeg, maxV, currentVSourceIdx++);
                onResolved?.({ mode: 'voltage', index: vIdx });
            } else {
                // 电流源模式：直接注入电流，不占用电压源索引
                currentVSourceIdx++;
                this._addI(ctx, B, cPos, cNeg, targetA);
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
            if (cPi1 !== undefined) {
                this._addV(ctx, G, B, cPi1, -1, 24.0, currentVSourceIdx++);
            }
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
    stampThermocouples(ctx, G, B, tcDevs) {
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
                // 这是 电流索引所在列，节点电流方程引入电压源的电流，留出填+1，另一端是相对地的。
                if (outM !== undefined) G[outM][opVIdx] += 1;

                if (op.internalState === 'linear') {
                    // 线性状态下，out - gain(vP - vN) =0  ，填充电流索引所在行，out =+1, vP = -gain,vN = +gain.
                    if (outM !== undefined) G[opVIdx][outM] = 1;
                    const pM = ctx.nodeMap.get(cP), nM = ctx.nodeMap.get(cN);
                    if (pM !== undefined) G[opVIdx][pM] -= op.gain;
                    else if (ctx.vPosMap.has(cP)) B[opVIdx] += op.gain * ctx.vPosMap.get(cP);
                    if (nM !== undefined) G[opVIdx][nM] += op.gain;
                    else if (ctx.vPosMap.has(cN)) B[opVIdx] -= op.gain * ctx.vPosMap.get(cN);
                    // 输入失调电压：Vout = gain × (Vp - Vn + Vos)
                    if (op.inputOffset) B[opVIdx] += op.gain * op.inputOffset;
                } else {
                    // 非线性状态下，out = 饱和值，是一个电压源，填入电流相量的电压源部分。
                    if (outM !== undefined) G[opVIdx][outM] = 1;
                    B[opVIdx] = (op.internalState === 'pos_sat') ? op.vPosLimit : op.vNegLimit;
                }
            }
            //op.currentIdx是解相量中 电压源电流的 节点索引，可以在 results【op.currentIdx】获得电流的解。
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
            //导通时，看成导通电压和导通电阻串联
            if (vDiff > dev.vForward) {
                const gOn = 1 / (dev.rOn || 0.5);
                const iEq = dev.vForward * gOn;
                this._fill(ctx, G, B, cA, cC, gOn);
                this._addI(ctx, B, cA, cC, iEq);
            } else {
                //未导通，注入1000M电阻
                this._fill(ctx, G, B, cA, cC, 1 / (dev.rOff || 1e9));
            }
        });
    },

    // ─── 9b. 稳压二极管 Zener（双向分段线性） ───────────────────────────
    stampZeners(ctx, G, B, zenerDevs, results) {
        zenerDevs.forEach(dev => {
            const cA = ctx.portToCluster.get(`${dev.id}_wire_l`);
            const cC = ctx.portToCluster.get(`${dev.id}_wire_r`);
            if (cA === undefined || cC === undefined) { dev.physCurrent = 0; return; }

            if (dev._faultShort) {
                this._fill(ctx, G, B, cA, cC, 1);
                return;
            }
            if (dev._faultOpen) {
                this._fill(ctx, G, B, cA, cC, 1e-10);
                return;
            }

            const vA = ctx.getVoltageFromResults(results, cA);
            const vC = ctx.getVoltageFromResults(results, cC);
            const vDiff = vA - vC;
            const vF = dev.vForward || 0.7;
            const vZ = dev.vZener || 5.1;
            const gOn = 1 / (dev.rOn || 0.5);
            const rOff = dev.rOff || 1e8;

            if (vDiff > vF) {
                const iEq = vF * gOn;
                this._fill(ctx, G, B, cA, cC, gOn);
                this._addI(ctx, B, cA, cC, iEq);
            } else if (vDiff < -vZ) {
                const iEq = -vZ * gOn;
                this._fill(ctx, G, B, cA, cC, gOn);
                this._addI(ctx, B, cA, cC, iEq);
            } else {
                this._fill(ctx, G, B, cA, cC, 1 / rOff);
            }
        });
    },

    // ─── 9c. 发光二极管 LED（同二极管模型，不同默认参数） ─────────────
    stampLEDs(ctx, G, B, ledDevs, results) {
        ledDevs.forEach(dev => {
            const cA = ctx.portToCluster.get(`${dev.id}_wire_l`);
            const cC = ctx.portToCluster.get(`${dev.id}_wire_r`);
            if (cA === undefined || cC === undefined) { dev.physCurrent = 0; return; }

            if (dev._burnedOut || dev._faultOpen) {
                this._fill(ctx, G, B, cA, cC, 1e-10);
                return;
            }
            if (dev._faultShort) {
                this._fill(ctx, G, B, cA, cC, 1);
                return;
            }

            const vA = ctx.getVoltageFromResults(results, cA);
            const vC = ctx.getVoltageFromResults(results, cC);
            const vDiff = vA - vC;
            if (vDiff > (dev.vForward || 2.0)) {
                const gOn = 1 / (dev.rOn || 0.5);
                const iEq = (dev.vForward || 2.0) * gOn;
                this._fill(ctx, G, B, cA, cC, gOn);
                this._addI(ctx, B, cA, cC, iEq);
            } else {
                this._fill(ctx, G, B, cA, cC, 1 / (dev.rOff || 1e9));
            }
        });
    },

    // ─── 9d. 光敏二极管 Photodiode（正向同二极管，反向光生电流） ─────
    stampPhotodiodes(ctx, G, B, photodiodeDevs, results) {
        photodiodeDevs.forEach(dev => {
            const cA = ctx.portToCluster.get(`${dev.id}_wire_l`);
            const cC = ctx.portToCluster.get(`${dev.id}_wire_r`);
            if (cA === undefined || cC === undefined) { dev.physCurrent = 0; return; }

            const vA = ctx.getVoltageFromResults(results, cA);
            const vC = ctx.getVoltageFromResults(results, cC);
            const vDiff = vA - vC;
            const gOn = 1 / (dev.rOn || 0.5);
            const rOff = dev.rOff || 1e8;

            if (vDiff > (dev.vForward || 0.7)) {
                const iEq = (dev.vForward || 0.7) * gOn;
                this._fill(ctx, G, B, cA, cC, gOn);
                this._addI(ctx, B, cA, cC, iEq);
            } else {
                this._fill(ctx, G, B, cA, cC, 1 / rOff);
                const iPhoto = (dev.photoCurrent || 0) / 1e6;
                if (Math.abs(iPhoto) > 1e-12) {
                    this._addI(ctx, B, cC, cA, iPhoto);
                }
            }
        });
    },

    // ─── 9d2. 光敏三极管 Phototransistor ─────────────────────────────
    stampPhototransistors(ctx, G, B, ptDevs, results) {
        ptDevs.forEach(dev => {
            const cC = ctx.portToCluster.get(`${dev.id}_wire_c`);
            const cE = ctx.portToCluster.get(`${dev.id}_wire_e`);
            const cB = ctx.portToCluster.get(`${dev.id}_wire_b`);
            if (cC === undefined || cE === undefined) { dev.physCurrent = 0; return; }

            const vC = ctx.getVoltageFromResults(results, cC) || 0;
            const vE = ctx.getVoltageFromResults(results, cE) || 0;
            const vCE = vC - vE;

            if (cB !== undefined) {
                this._fill(ctx, G, B, cB, -1, 1e-12);
            }

            const iPhoto = (dev.photoCurrent || 0) / 1e6;
            const beta = dev.beta || 200;

            if (iPhoto > 1e-12 && vCE > 0) {
                const iLight = beta * iPhoto;
                const gOn = 1 / (dev.rOn || 50);
                this._fill(ctx, G, B, cC, cE, gOn);
                this._addI(ctx, B, cC, cE, iLight);
            } else {
                this._fill(ctx, G, B, cC, cE, 1 / (dev.rOff || 1e8));
            }
        });
    },

    // ─── 9e. 双向触发二极管 DIAC（双向导通） ─────────────────────────
    stampDIACs(ctx, G, B, diacDevs, results) {
        diacDevs.forEach(dev => {
            const cA = ctx.portToCluster.get(`${dev.id}_wire_l`);
            const cC = ctx.portToCluster.get(`${dev.id}_wire_r`);
            if (cA === undefined || cC === undefined) { dev.physCurrent = 0; return; }

            if (dev._faultShort) {
                this._fill(ctx, G, B, cA, cC, 1);
                return;
            }

            const vA = ctx.getVoltageFromResults(results, cA);
            const vC = ctx.getVoltageFromResults(results, cC);
            const vDiff = vA - vC;
            const vBO = dev.vBreakover || 30;
            const vHold = dev.vHold || 10;
            const rOn = dev.rOn || 5;
            const gOn = 1 / rOn;
            const rOff = dev.rOff || 1e8;

            if (Math.abs(vDiff) > vBO) {
                dev._diacActive = true;
                dev._diacSign = vDiff >= 0 ? 1 : -1;
            } else if (dev._diacActive) {
                const iDiac = (Math.abs(vDiff) - vHold) / rOn;
                if (iDiac < 0.01) {
                    dev._diacActive = false;
                }
            }

            if (dev._diacActive) {
                const vSign = dev._diacSign || 1;
                const iEq = vHold * gOn * vSign;
                this._fill(ctx, G, B, cA, cC, gOn);
                this._addI(ctx, B, cA, cC, iEq);
            } else {
                this._fill(ctx, G, B, cA, cC, 1 / rOff);
                dev._diacSign = 0;
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
                const model = dev.getCompanionModel(vB, vC, vE);
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
            // 等效为一个压控电阻，导通时电阻很小。
            if (cD !== undefined && cS !== undefined) {
                const vG = ctx.getVoltageFromResults(results, cG) || 0;
                const vS = ctx.getVoltageFromResults(results, cS) || 0;
                const res = dev.getDSResistance(vG - vS);
                this._fill(ctx, G, B, cD, cS, 1 / Math.max(0.001, res));
            }
        });
    },

    // ─── 11.5 SCR 晶闸管 ─────────────────────────────────────────
    stampSCRs(ctx, G, B, scrDevs, results) {
        scrDevs.forEach(dev => {
            const cG = ctx.portToCluster.get(`${dev.id}_wire_g`);
            const cA = ctx.portToCluster.get(`${dev.id}_wire_a`);
            const cK = ctx.portToCluster.get(`${dev.id}_wire_k`);

            if (cG !== undefined && cK !== undefined) {
                const vG = ctx.getVoltageFromResults(results, cG) || 0;
                const vK = ctx.getVoltageFromResults(results, cK) || 0;
                const vGK = vG - vK;
                if (dev._faultGateOpen) {
                    this._fill(ctx, G, B, cG, cK, 1e-12);
                } else if (vGK > dev.gkForwardV) {
                    const gOn = 1 / (dev.gkR || 0.5);
                    const iEq = dev.gkForwardV * gOn;
                    this._fill(ctx, G, B, cG, cK, gOn);
                    this._addI(ctx, B, cG, cK, iEq);
                } else {
                    this._fill(ctx, G, B, cG, cK, 1 / (dev.gkROff || 1e8));
                }
                const gateActive = !dev._faultGateOpen && vGK > dev.gkForwardV;
                if (gateActive && !dev._gateWasActive && !dev._triggered) {
                    dev._triggered = true;
                }
                dev._gateWasActive = gateActive;
            }

            if (cA !== undefined && cK !== undefined) {
                const vA = ctx.getVoltageFromResults(results, cA) || 0;
                const vK = ctx.getVoltageFromResults(results, cK) || 0;
                const vG = ctx.getVoltageFromResults(results, cG) || 0;
                const vGK = vG - vK;

                if (dev._faultAKShort) {
                    this._fill(ctx, G, B, cA, cK, 1);
                    dev._scrStampMode = 'ron';
                } else if (dev._triggered) {
                    const vAK_prev = vA - vK;
                    let iEst;
                    if (dev._scrStampMode === 'ron') {
                        iEst = vAK_prev / Math.max(0.001, dev.rOn || 0.1);
                    } else {
                        iEst = (vAK_prev - (dev.vOn || 1.0)) / Math.max(0.001, dev.rOn || 0.1);
                    }
                    if (Math.abs(iEst) > (dev.holdCurrent || 0.0005) * 0.5) {
                        const gOn = 1 / (dev.rOn || 0.1);
                        const iEq = (dev.vOn || 1.0) * gOn;
                        this._fill(ctx, G, B, cA, cK, gOn);
                        this._addI(ctx, B, cA, cK, iEq);
                        dev._scrStampMode = 'companion';
                    } else {
                        this._fill(ctx, G, B, cA, cK, 1 / (dev.rOn || 0.1));
                        dev._scrStampMode = 'ron';
                    }
                } else {
                    this._fill(ctx, G, B, cA, cK, 1 / (dev.rOff || 1e6));
                    dev._scrStampMode = 'off';
                }
            }
        });
    },

    // ─── 11.55 双向晶闸管 TRIAC（双向导通，门极正负均可触发） ─────────
    stampTRIACs(ctx, G, B, triacDevs, results) {
        triacDevs.forEach(dev => {
            const cG = ctx.portToCluster.get(`${dev.id}_wire_g`);
            const cMT1 = ctx.portToCluster.get(`${dev.id}_wire_mt1`);
            const cMT2 = ctx.portToCluster.get(`${dev.id}_wire_mt2`);

            if (cG !== undefined && cMT1 !== undefined) {
                const vG = ctx.getVoltageFromResults(results, cG) || 0;
                const vMT1 = ctx.getVoltageFromResults(results, cMT1) || 0;
                const vGmt1 = vG - vMT1;

                if (dev._faultGateOpen) {
                    this._fill(ctx, G, B, cG, cMT1, 1e-12);
                    dev._gateActive = false;
                } else if (Math.abs(vGmt1) > dev.vGt) {
                    dev._gateActive = true;
                } else if (!dev._gateActive || Math.abs(vGmt1) < dev.vGt * 0.3) {
                    dev._gateActive = false;
                }

                if (dev._gateActive) {
                    const gOn = 1 / (dev.rG || 10);
                    const iEq = (vGmt1 > 0 ? dev.vGt : -dev.vGt) * gOn;
                    this._fill(ctx, G, B, cG, cMT1, gOn);
                    this._addI(ctx, B, cG, cMT1, iEq);
                } else {
                    this._fill(ctx, G, B, cG, cMT1, 1 / (dev.rGOff || 1e8));
                }

                if (dev._gateActive && !dev._gateWasActive && !dev._triggered) {
                    dev._triggered = true;
                }
                dev._gateWasActive = dev._gateActive;
            }

            if (cMT2 !== undefined && cMT1 !== undefined) {
                const vMT2 = ctx.getVoltageFromResults(results, cMT2) || 0;
                const vMT1 = ctx.getVoltageFromResults(results, cMT1) || 0;
                const vMT = vMT2 - vMT1;

                if (dev._faultMTShort) {
                    this._fill(ctx, G, B, cMT2, cMT1, 1);
                    dev._stampMode = 'short';
                } else if (dev._triggered) {
                    const gOn = 1 / (dev.rOn || 0.1);
                    this._fill(ctx, G, B, cMT2, cMT1, gOn);
                    dev._stampMode = 'on';
                } else {
                    this._fill(ctx, G, B, cMT2, cMT1, 1 / (dev.rOff || 1e6));
                    dev._stampMode = 'off';
                }
            }
        });
    },

    // ─── 11.56 单结晶体管 UJT ────────────────────────────────────────
    stampUJTs(ctx, G, B, ujtDevs, results) {
        ujtDevs.forEach(dev => {
            const cB1 = ctx.portToCluster.get(`${dev.id}_wire_b1`);
            const cB2 = ctx.portToCluster.get(`${dev.id}_wire_b2`);
            const cE = ctx.portToCluster.get(`${dev.id}_wire_e`);
            if (cB1 === undefined || cB2 === undefined || cE === undefined) return;

            const gBB = 1 / (dev.rBB || 5000);
            this._fill(ctx, G, B, cB1, cB2, gBB);

            const vB1 = ctx.getVoltageFromResults(results, cB1) || 0;
            const vB2 = ctx.getVoltageFromResults(results, cB2) || 0;
            const vE = ctx.getVoltageFromResults(results, cE) || 0;
            const vEB1 = vE - vB1;
            const vB2B1 = vB2 - vB1;
            const eta = dev.eta || 0.63;
            const vD = dev.vD || 0.6;
            const VP = eta * vB2B1 + vD;

            if (vEB1 > VP && !dev._triggered) {
                dev._triggered = true;
            }

            if (dev._triggered) {
                const gOn = 1 / (dev.rOn || 15);
                const iEq = (dev.vOn || 1.5) * gOn;
                this._fill(ctx, G, B, cE, cB1, gOn);
                this._addI(ctx, B, cE, cB1, iEq);
            } else {
                this._fill(ctx, G, B, cE, cB1, 1 / (dev.rOff || 1e8));
            }
        });
    },

    // ─── 11.6 IGBT 绝缘栅双极晶体管 ──────────────────────────────────
    stampIGBTs(ctx, G, B, igbtDevs, results) {
        igbtDevs.forEach(dev => {
            const cG = ctx.portToCluster.get(`${dev.id}_wire_g`);
            const cC = ctx.portToCluster.get(`${dev.id}_wire_c`);
            const cE = ctx.portToCluster.get(`${dev.id}_wire_e`);

            if (cG !== undefined && cE !== undefined) {
                this._fill(ctx, G, B, cG, cE, 1e-8);
            }

            if (cC !== undefined && cE !== undefined) {
                const vG = ctx.getVoltageFromResults(results, cG) || 0;
                const vE = ctx.getVoltageFromResults(results, cE) || 0;
                const vC = ctx.getVoltageFromResults(results, cC) || 0;
                const vGE = vG - vE;
                const vCE = vC - vE;

                if (dev._faultCEShort) {
                    this._fill(ctx, G, B, cC, cE, 1);
                    dev._igbtStampMode = 'ron';
                    dev._isOn = true;
                } else if (dev._faultCEOpen) {
                    this._fill(ctx, G, B, cC, cE, 1e-10);
                    dev._igbtStampMode = 'off';
                    dev._isOn = false;
                } else if (vGE > dev.vth) {
                    const gOn = 1 / (dev.rOn || 0.1);
                    const iEq = (dev.vOn || 1.8) * gOn;
                    this._fill(ctx, G, B, cC, cE, gOn);
                    this._addI(ctx, B, cC, cE, iEq);
                    dev._igbtStampMode = 'ron';
                    dev._isOn = true;
                } else {
                    this._fill(ctx, G, B, cC, cE, 1 / (dev.rOff || 1e6));
                    dev._igbtStampMode = 'off';
                    dev._isOn = false;
                }
            }
        });
    },

    // ─── 11.7 MOSFET ─────────────────────────────────────────────
    stampMOSFETs(ctx, G, B, mosfetDevs, results) {
        mosfetDevs.forEach(dev => {
            const cG = ctx.portToCluster.get(`${dev.id}_wire_g`);
            const cD = ctx.portToCluster.get(`${dev.id}_wire_d`);
            const cS = ctx.portToCluster.get(`${dev.id}_wire_s`);

            if (cG !== undefined && cS !== undefined) {
                this._fill(ctx, G, B, cG, cS, 1e-8);
            }

            if (cD !== undefined && cS !== undefined) {
                const vG = ctx.getVoltageFromResults(results, cG) || 0;
                const vS = ctx.getVoltageFromResults(results, cS) || 0;
                const vD = ctx.getVoltageFromResults(results, cD) || 0;
                const vGS = vG - vS;
                const vDS = vD - vS;

                if (dev._faultDSShort) {
                    this._fill(ctx, G, B, cD, cS, 1);
                    dev._mosfetStampMode = 'ron';
                    dev._isOn = true;
                } else if (dev._faultDSOpen) {
                    this._fill(ctx, G, B, cD, cS, 1e-10);
                    dev._mosfetStampMode = 'off';
                    dev._isOn = false;
                } else if (vGS > dev.vth) {
                    const gOn = 1 / (dev.rOn || 0.2);
                    this._fill(ctx, G, B, cD, cS, gOn);
                    dev._mosfetStampMode = 'ron';
                    dev._isOn = true;
                } else {
                    this._fill(ctx, G, B, cD, cS, 1 / (dev.rOff || 1e6));
                    dev._mosfetStampMode = 'off';
                    dev._isOn = false;
                }
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
            // 后向欧拉: 电容 I = gEq*V - iEq (iEq>0 从L入从R出)
            // 后向欧拉: 电感 I = gEq*V + iEq (iEq>0 应从R入从L出)
            this._addI(ctx, B, cL, cR, dev.type === 'inductor' ? -iEq : iEq);
        });
    },

    // ─── 13. 示波器（理想电流表：0V 电压源） ────────────────────────────
    stampOscilloscopes(ctx, G, B, oscDevs, oscVIdx) {
        oscDevs.forEach(dev => {
            const cIn = ctx.portToCluster.get(`${dev.id}_wire_l`);
            const cOut = ctx.portToCluster.get(`${dev.id}_wire_r`);
            if (cIn === undefined || cOut === undefined) { dev.currentIdx = undefined; return; }
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
                //这是电流索引所在列，流进为+1，流出为-1
                if (mOutP !== undefined) G[mOutP][ptVIdx] += 1;
                if (mOutN !== undefined) G[mOutN][ptVIdx] -= 1;

                if (mOutP !== undefined) G[ptVIdx][mOutP] += 1;
                // 如果该节点电压已知，outP - outN -k(inP - inN) =0，把outP 移到最右边，电流相量对应索引行，放已知的电源电压。
                else if (ctx.vPosMap.has(cOutP)) B[ptVIdx] -= ctx.vPosMap.get(cOutP);

                if (mOutN !== undefined) G[ptVIdx][mOutN] -= 1;
                else if (ctx.vPosMap.has(cOutN)) B[ptVIdx] += ctx.vPosMap.get(cOutN);

                if (mInP !== undefined) G[ptVIdx][mInP] -= k;
                else if (ctx.vPosMap.has(cInP)) B[ptVIdx] += k * ctx.vPosMap.get(cInP);

                if (mInN !== undefined) G[ptVIdx][mInN] += k;
                else if (ctx.vPosMap.has(cInN)) B[ptVIdx] -= k * ctx.vPosMap.get(cInN);

                this._fill(ctx, G, B, cInP, cInN, 1e-9); // Gmin 防奇异
            } else {
                // 1*电流 = 0；
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
            if (c1 !== undefined && c2 !== undefined)
                this._fill(ctx, G, B, c1, c2, 1 / R);

            const cCOM = ctx.portToCluster.get(`${dev.id}_wire_COM`);
            const cNO = ctx.portToCluster.get(`${dev.id}_wire_NO`);
            if (cCOM !== undefined && cNO !== undefined) {
                const R = (dev.isEnergized===true && dev.contactFault === false) ? 0.01 : 1e9;
                this._fill(ctx, G, B, cCOM, cNO, 1 / R);
            }

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
                const rFeed = 10000;
                const vFeed = 10;
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
                this._fill(ctx, G, B, c_ch4p, c_ch4n, 1 / 1e9);
            }
            // ---在线路上注入电压，模拟CAN总线工作的状态。
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
                            pc.currentIdx = currentVSourceIdx;
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
    },
    // ─── 19. AO 模块（模拟量输出） ────────────────────────────────────
    stampAO(ctx, G, B, aoDevs, currentVSourceIdx) {
        aoDevs.forEach(ao => {

            const p = `${ao.id}_wire_`;
            const c_can1p = ctx.portToCluster.get(`${p}can1p`);
            const c_can1n = ctx.portToCluster.get(`${p}can1n`);
            const c_can2p = ctx.portToCluster.get(`${p}can2p`);
            const c_can2n = ctx.portToCluster.get(`${p}can2n`);
            // ── CAN1 和 CAN2：终端电阻注入（当 termEnabled 有效时） ────
            if (ao.termEnabled) {
                if (c_can1p !== undefined && c_can1n !== undefined) {
                    // 注入 120Ω 终端电阻
                    this._fill(ctx, G, B, c_can1p, c_can1n, 1 / 120);
                }
                if (c_can2p !== undefined && c_can2n !== undefined) {
                    // 注入 120Ω 终端电阻
                    this._fill(ctx, G, B, c_can2p, c_can2n, 1 / 120);
                }
            }
            if (!ao.powerOn) return;

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
            if (c_ch1p !== undefined && c_ch1n !== undefined) {
                this._addI(ctx, B, c_ch1p, c_ch1n, ao.channels.ch1.actual / 1000);
            }

            // ── CH2 (4-20mA) ──────────────────────────────────────────
            const c_ch2p = ctx.portToCluster.get(`${p}ch2p`);
            const c_ch2n = ctx.portToCluster.get(`${p}ch2n`);
            if (c_ch2p !== undefined && c_ch2n !== undefined) {
                this._addI(ctx, B, c_ch2p, c_ch2n, ao.channels.ch2.actual / 1000);
            }

            // ── CH3 (PWM) ────────────────────────────────────────
            // PWM电压输出。
            const c_ch3p = ctx.portToCluster.get(`${p}ch3p`);
            const c_ch3n = ctx.portToCluster.get(`${p}ch3n`);
            if (c_ch3p !== undefined && c_ch3n !== undefined) {
                const instantV = ao.channels.ch3.instantOn ? 24 : 0;
                this._addV(ctx, G, B, c_ch3p, c_ch3n, instantV, currentVSourceIdx++);
            }

            // ── CH4 (PWM) ────────────────────────────────────────
            const c_ch4p = ctx.portToCluster.get(`${p}ch4p`);
            const c_ch4n = ctx.portToCluster.get(`${p}ch4n`);
            if (c_ch4p !== undefined && c_ch4n !== undefined) {
                const instantV = ao.channels.ch4.instantOn ? 24 : 0;
                this._addV(ctx, G, B, c_ch4p, c_ch4n, instantV, currentVSourceIdx++);
            }

        });
        return currentVSourceIdx;
    },

    // ─── 20. DI模块 ───────────────────────────────────────────────
    stampDI(ctx, G, B, diDevs) {
        diDevs.forEach(di => {
            const p = `${di.id}_wire_`;
            const c_can1p = ctx.portToCluster.get(`${p}can1p`);
            const c_can1n = ctx.portToCluster.get(`${p}can1n`);
            const c_can2p = ctx.portToCluster.get(`${p}can2p`);
            const c_can2n = ctx.portToCluster.get(`${p}can2n`);
            // ── CAN1 和 CAN2：终端电阻注入（当 termEnabled 有效时） ────
            if (di.termEnabled) {
                if (c_can1p !== undefined && c_can1n !== undefined) {
                    // 注入 120Ω 终端电阻
                    this._fill(ctx, G, B, c_can1p, c_can1n, 1 / 120);
                }
                if (c_can2p !== undefined && c_can2n !== undefined) {
                    // 注入 120Ω 终端电阻
                    this._fill(ctx, G, B, c_can2p, c_can2n, 1 / 120);
                }
            }
            if (!di.powerOn) return;
            // VCC 和 GND 之间：注入电源内阻 50Ω（保持电源稳定）
            const cVcc = ctx.portToCluster.get(`${p}vcc`);
            const cGnd = ctx.portToCluster.get(`${p}gnd`);
            if (cVcc !== undefined && cGnd !== undefined) {
                this._fill(ctx, G, B, cVcc, cGnd, 1 / 50);  // 50Ω 电源内阻
            }
        });

    },
    // ─── 21. DI模块 ───────────────────────────────────────────────
    stampDO(ctx, G, B, doDevs, currentVSourceIdx) {
        doDevs.forEach(dev => {
            const p = `${dev.id}_wire_`;
            const c_can1p = ctx.portToCluster.get(`${p}can1p`);
            const c_can1n = ctx.portToCluster.get(`${p}can1n`);
            const c_can2p = ctx.portToCluster.get(`${p}can2p`);
            const c_can2n = ctx.portToCluster.get(`${p}can2n`);
            // ── CAN1 和 CAN2：终端电阻注入（当 termEnabled 有效时） ────
            if (dev.termEnabled) {
                if (c_can1p !== undefined && c_can1n !== undefined) {
                    // 注入 120Ω 终端电阻
                    this._fill(ctx, G, B, c_can1p, c_can1n, 1 / 120);
                }
                if (c_can2p !== undefined && c_can2n !== undefined) {
                    // 注入 120Ω 终端电阻
                    this._fill(ctx, G, B, c_can2p, c_can2n, 1 / 120);
                }
            }
            if (!dev.powerOn) return;
            // VCC 和 GND 之间：注入电源内阻 50Ω（保持电源稳定）
            const cVcc = ctx.portToCluster.get(`${p}vcc`);
            const cGnd = ctx.portToCluster.get(`${p}gnd`);
            if (cVcc !== undefined && cGnd !== undefined) {
                this._fill(ctx, G, B, cVcc, cGnd, 1 / 50);  // 50Ω 电源内阻
            }
            // ── CH1 (电阻注入) ──────────────────────────────────────────
            // 导通时0.01，不导通时1000000
            const c_ch1p = ctx.portToCluster.get(`${p}ch1p`);
            const c_ch1n = ctx.portToCluster.get(`${p}ch1n`);
            if (c_ch1p !== undefined && c_ch1n !== undefined) {
                const instantR = dev.channels.ch1.state ? 0.01 : 1e9;
                this._fill(ctx, G, B, c_ch1p, c_ch1n, 1 / instantR);
            }

            // ── CH2 (电阻注入) ──────────────────────────────────────────
            const c_ch2p = ctx.portToCluster.get(`${p}ch2p`);
            const c_ch2n = ctx.portToCluster.get(`${p}ch2n`);
            if (c_ch2p !== undefined && c_ch2n !== undefined) {
                const instantR = dev.channels.ch2.state ? 0.01 : 1e9;
                this._fill(ctx, G, B, c_ch2p, c_ch2n, 1 / instantR);
            }

            // ── CH3 (PNP24V 输出) ────────────────────────────────────────
            const c_ch3p = ctx.portToCluster.get(`${p}ch3p`);
            const c_ch3n = ctx.portToCluster.get(`${p}ch3n`);
            if (c_ch3p !== undefined && c_ch3n !== undefined) {
                if (dev.channels.ch3.state)
                    this._addV(ctx, G, B, c_ch3p, c_ch3n, 24, currentVSourceIdx++);
                else {
                    this._fill(ctx, G, B, c_ch3p, c_ch3n, 1 / 1e9);
                    // 未注入电压源，不递增索引
                }
            }

            // ── CH4 (PWM) ────────────────────────────────────────
            const c_ch4p = ctx.portToCluster.get(`${p}ch4p`);
            const c_ch4n = ctx.portToCluster.get(`${p}ch4n`);
            if (c_ch4p !== undefined && c_ch4n !== undefined) {
                if (dev.channels.ch4.state)
                    this._addV(ctx, G, B, c_ch4p, c_ch4n, 24, currentVSourceIdx++);
                else {
                    this._fill(ctx, G, B, c_ch4p, c_ch4n, 1 / 1e6);
                    // 未注入电压源，不递增索引
                }
            }
        });
    },

    // ─── 22. NE555 定时器 ──────────────────────────────────────────────────
    /**
     * stamp555 — 处理 555 定时器的 MNA 模型
     *
     * 建模内容：
     *   1. DIS(7) 放电管：Q=0 时导通（~10Ω→GND），Q=1 时截止（10MΩ）
     *   2. CTRL(5) 分压到 GND 的等效电阻（内部 5kΩ 分压网络）
     *   3. OUT(3) 输出级：高电平时通过小电阻接到 VCC，低电平时通过小电阻接到 GND
     *
     * 参数来自 DigitalSolver 端计算的 _disChargeOn 和 _outHigh
     */
    stamp555(ctx, G, B, devs) {
        devs.forEach(dev => {
            const id = dev.id;

            // ── 1. DIS 放电管 ──
            const cDIS = ctx.portToCluster.get(`${id}_wire_dis`);
            const cGND = ctx.portToCluster.get(`${id}_wire_gnd`);
            if (cDIS !== undefined && cGND !== undefined) {
                const R = dev._disChargeOn ? 10 : 1e7;
                this._fill(ctx, G, B, cDIS, cGND, 1 / R);
            }

            // ── 2. CTRL 内部 5kΩ 到 GND ──
            const cCTRL = ctx.portToCluster.get(`${id}_wire_ctrl`);
            if (cCTRL !== undefined && cGND !== undefined) {
                this._fill(ctx, G, B, cCTRL, cGND, 1 / 5000);
            }

            // ── 3. OUT 输出级 ──
            const cOUT = ctx.portToCluster.get(`${id}_wire_out`);
            const cVCC = ctx.portToCluster.get(`${id}_wire_vcc`);
            if (cOUT !== undefined) {
                if (dev._outHigh && cVCC !== undefined) {
                    // OUT=H：OUT 通过 ~100Ω 接到 VCC（但也会被 MNA 的电压源钳位）
                    this._fill(ctx, G, B, cOUT, cVCC, 1 / 100);
                } else if (!dev._outHigh && cGND !== undefined) {
                    // OUT=L：OUT 通过 ~50Ω 接到 GND
                    this._fill(ctx, G, B, cOUT, cGND, 1 / 50);
                } else {
                    // 未连接电源时，高阻态
                    this._fill(ctx, G, B, cOUT, cGND || 0, 1 / 1e7);
                }
            }
        });
    },

    // ─── 22.1 交流电流表（0V 电压源 → 精确电流检测）───
    stampACAmmeters(ctx, G, B, acAmmDevs, acAmmVIdx) {
        acAmmDevs.forEach(dev => {
            const cAp = ctx.portToCluster.get(`${dev.id}_wire_ap`);
            const cAn = ctx.portToCluster.get(`${dev.id}_wire_an`);
            if (cAp === undefined || cAn === undefined) { dev.currentIdx = undefined; return; }
            this._addV(ctx, G, B, cAp, cAn, 0, acAmmVIdx);
            dev.currentIdx = acAmmVIdx++;
        });
        return acAmmVIdx;
    },

    // ─── 22.2 功率表（Wattmeter）：电流线圈 ip/in 注入 0V 电压源 ───
    stampWattmeters(ctx, G, B, wattmeterDevs, wattmeterVIdx) {
        wattmeterDevs.forEach(dev => {
            const cIp = ctx.portToCluster.get(`${dev.id}_wire_ip`);
            const cIn = ctx.portToCluster.get(`${dev.id}_wire_in`);
            if (cIp === undefined || cIn === undefined) { dev.currentIdx = undefined; return; }
            this._addV(ctx, G, B, cIp, cIn, 0, wattmeterVIdx);
            dev.currentIdx = wattmeterVIdx++;
        });
        return wattmeterVIdx;
    },

    // ─── 22.2 恒流源（理想恒流源，无顺从电压限制）───
    stampCCSources(ctx, G, B, ccDevs, ccVIdx) {
        const CURRENTS = [0.001, 0.0001, 0.00001, 0.000001];
        ccDevs.forEach(dev => {
            const cN = ctx.portToCluster.get(`${dev.id}_wire_com`);
            for (let i = 0; i < 4; i++) {
                const cP = ctx.portToCluster.get(`${dev.id}_wire_i${i+1}`);
                if (cP === undefined || cN === undefined) { ccVIdx++; continue; }
                this._addI(ctx, B, cP, cN, CURRENTS[i]);
                ccVIdx++;
            }
        });
        return ccVIdx;
    },

    /**
     * ─── 电流互感器（CT）MNA 注入 ──────────────────────────────────────────
     *
     *  电流互感器的工作原理基于电磁感应和磁动势平衡：
     *    原边电流 I₁ 在铁芯中产生磁通 → 副边感应出电流 I₂
     *    I₁ × N₁ = I₂ × N₂  →  I₂ = I₁ / K（K = N₂/N₁）
     *
     *  ── 电路注入策略 ────────────────────────────────────────────────────
     *
     *  ① 原边（P1-P2）：以 0V 理想电压源注入
     *     - 0V 电压源对电路拓扑无影响（等效于理想导线短接）
     *     - 求解该电压源的电流即可获得原边电流 I₁
     *     - MNA 中增加一个方程：V(P1) - V(P2) = 0
     *     - 结果中 results[currentIdxPrimary] = I₁
     *
     *  ② 副边（S1-S2）：受控电流源（带顺从电压限制）
     *     - 目标输出电流：I₂_target = I₁_prev / K
     *       （I₁_prev 为上轮迭代解得的原边电流，非线性迭代可保证收敛）
     *     - 通过等效电阻计算判断负载情况：
     *       a. 若 R_load × I₂ > 1000V 或 R_load > 1MΩ（近似开路）
     *          → 切换为电压源模式，输出 ±1000V（方向由 I₂ 极性决定）
     *          此即"顺从电压"（compliance voltage）限制：
     *          实际电流源无法在极高负载阻抗下维持恒定电流，
     *          输出电压会达到电源轨（此处设定为 1000V）。
     *       b. 正常负载下直接注入电流源 I₂_target
     *
     *  ── 收敛性说明 ──────────────────────────────────────────────────────
     *    副边注入依赖原边电流 I₁，而 I₁ 是本次求解的目标。
     *    这构成一个"代数环"，通过 MNA 的非线性迭代（最多 200 轮，阻尼因子 0.3）
     *    可收敛到稳态解：
     *      轮次 1：I₁ = 0 → I₂ = 0 → 求解得 I₁_actual
     *      轮次 2：I₁ = I₁_actual(阻尼后) → I₂ = I₁_actual/K → 求解更新 I₁
     *      ... 迭代至收敛
     *
     *  @param {Object} ctx     - 求解器上下文（含 portToCluster, nodeMap 等）
     *  @param {Array[]} G      - MNA 电导矩阵（方阵，每行一个 Float64Array）
     *  @param {Float64Array} B - 电流/电压源向量
     *  @param {Object[]} ctDevs - 所有 CT 设备实例数组
     *  @param {number} ctVIdx   - 当前可用的电压源方程起始索引
     *  @returns {number} 更新后的电压源方程索引
     */
    stampCurrentTransformers(ctx, G, B, ctDevs, ctVIdx) {
        ctDevs.forEach(dev => {
            // 获取四个端口的簇编号（cluster index），
            // 若端口未接线则 clusterIdx 为 undefined
            const cP1 = ctx.portToCluster.get(`${dev.id}_wire_p1`);
            const cP2 = ctx.portToCluster.get(`${dev.id}_wire_p2`);
            const cS1 = ctx.portToCluster.get(`${dev.id}_wire_s1`);
            const cS2 = ctx.portToCluster.get(`${dev.id}_wire_s2`);

            // ═══ 原边：0V 电压源注入 ═══════════════════════════════════
            // 电压源方程：V(P1) - V(P2) = 0
            // 求解后 dev._currentIdxPrimary 对应的结果项即为 I₁
            if (cP1 !== undefined && cP2 !== undefined) {
                this._addV(ctx, G, B, cP1, cP2, 0, ctVIdx);
                dev._currentIdxPrimary = ctVIdx;
                ctVIdx++;
            }

            // ═══ 副边：受控电流源（带顺从电压限制）═══════════════════
            if (cS1 !== undefined && cS2 !== undefined) {
                // 匝数比 K（副边匝数 / 原边匝数），最小为 1
                const ratio = Math.max(1, dev._turnsRatio || 10);

                // 使用上轮迭代解出的原边电流
                const iPrimary = dev._prevIPrimary || 0;
                const iSecondary = iPrimary / ratio;

                // 估算副边端口的等效负载电阻
                // 若负载电阻极大（开路或高阻状态），电流源会试图维持恒定电流
                // 但实际 CT 的电压会被限制在顺从电压（1000V）以内
                const rReq = ctx.getEquivalentResistance(
                    ctx.clusters[cS1], ctx.clusters[cS2], ctx.clusters
                );

                // 判断是否需要切换为电压源模式
                if (rReq * Math.abs(iSecondary) > 1000 || rReq > 1e6) {
                    // 顺从电压限制模式：注入 ±1000V 电压源
                    // 极性由副边电流方向决定
                    const sign = iSecondary >= 0 ? 1 : -1;
                    this._addV(ctx, G, B, cS1, cS2, sign * 1000, ctVIdx);
                    dev._secondaryMode = 'voltage';  // 标记当前模式供调试
                    dev._currentIdxSecondary = ctVIdx;
                    ctVIdx++;
                } else {
                    // 正常模式：直接注入电流源
                    this._addI(ctx, B, cS1, cS2, iSecondary);
                    dev._secondaryMode = 'current';
                    ctVIdx++;  // 预分配的方程被"消耗"（电流源不需方程，但保持计数一致）
                }
            }
        });
        return ctVIdx;
    },

    // ─── 23. 电压互感器（PT）：受控电压源（VCVS） ──────────────────────
    /**
     *  电压互感器 MNA 注入：
     *    V(S1) - V(S2) = (1/K) × (V(P1) - V(P2))
     *    其中 K = N₁/N₂，gain = 1/K = N₂/N₁
     *
     *  原边：1GΩ 高阻抗（模拟 PT 空载损耗，极小）
     *  副边：受控电压源，方程同 LVDT 形式
     */
    stampPotentialTransformers(ctx, G, B, potDevs, potVIdx) {
        potDevs.forEach(dev => {
            const cP1 = ctx.portToCluster.get(`${dev.id}_wire_p1`);
            const cP2 = ctx.portToCluster.get(`${dev.id}_wire_p2`);
            const cS1 = ctx.portToCluster.get(`${dev.id}_wire_s1`);
            const cS2 = ctx.portToCluster.get(`${dev.id}_wire_s2`);

            if (cP1 !== undefined && cP2 !== undefined) {
                this._fill(ctx, G, B, cP1, cP2, 1e-9);
            }
            if (cS1 !== undefined && cS2 !== undefined) {
                const turnsRatio = Math.max(1, dev._turnsRatio || 10);
                const gain = 1 / turnsRatio;
                const mP1 = ctx.nodeMap.get(cP1);
                const mP2 = ctx.nodeMap.get(cP2);
                const mS1 = ctx.nodeMap.get(cS1);
                const mS2 = ctx.nodeMap.get(cS2);

                if (mS1 !== undefined) G[mS1][potVIdx] += 1;
                else if (ctx.vPosMap.has(cS1)) B[potVIdx] -= ctx.vPosMap.get(cS1);
                if (mS2 !== undefined) G[mS2][potVIdx] -= 1;
                else if (ctx.vPosMap.has(cS2)) B[potVIdx] += ctx.vPosMap.get(cS2);

                if (mS1 !== undefined) G[potVIdx][mS1] += 1;
                else if (ctx.vPosMap.has(cS1)) B[potVIdx] -= ctx.vPosMap.get(cS1);
                if (mS2 !== undefined) G[potVIdx][mS2] -= 1;
                else if (ctx.vPosMap.has(cS2)) B[potVIdx] += ctx.vPosMap.get(cS2);
                if (mP1 !== undefined) G[potVIdx][mP1] -= gain;
                else if (ctx.vPosMap.has(cP1)) B[potVIdx] += gain * ctx.vPosMap.get(cP1);
                if (mP2 !== undefined) G[potVIdx][mP2] += gain;
                else if (ctx.vPosMap.has(cP2)) B[potVIdx] -= gain * ctx.vPosMap.get(cP2);

                dev._currentIdxSecondary = potVIdx++;
            }
        });
        return potVIdx;
    },

    // ─── 23.8 万用表/电流表电流档（0V 电压源注入，等效理想电流表）────────
    stampMultimeters(ctx, G, B, mmDevs, results, mmResVIdx) {
        let idx = mmResVIdx;
        mmDevs.forEach(dev => {
            if (dev.mode === 'MA') {
                const cMa = ctx.portToCluster.get(`${dev.id}_wire_ma`);
                const cCom = ctx.portToCluster.get(`${dev.id}_wire_com`);
                if (cMa === undefined || cCom === undefined) return;
                this._fill(ctx, G, B, cMa, cCom, 1 / 0.2);
            } else if (dev.mode === 'RES200' || dev.mode === 'RES2k' || dev.mode === 'RES200k' || dev.mode === 'DIODE') {
                const cV = ctx.portToCluster.get(`${dev.id}_wire_v`);
                const cCOM = ctx.portToCluster.get(`${dev.id}_wire_com`);
                if (cV === undefined || cCOM === undefined) { dev.currentIdx = undefined; idx++; return; }
                let iSet = 0;
                if (dev.mode === 'DIODE') iSet = 0.001;
                else if (dev.mode === 'RES200') iSet = 0.001;
                else if (dev.mode === 'RES2k') iSet = 0.0001;
                else if (dev.mode === 'RES200k') iSet = 0.000001;
                const vV = ctx.getVoltageFromResults(results, cV) || 0;
                const vCOM = ctx.getVoltageFromResults(results, cCOM) || 0;
                const vPort = Math.abs(vV - vCOM);
                const prevCV = dev._resCV;
                if (vPort >= 3) {
                    dev._resCV = true;
                } else if (vPort <= 2.5) {
                    dev._resCV = false;
                }
                // 首轮迭代 results 被初始化为 0，此时 vPort=0 不代表真实测量值
                if (Math.abs(vPort) < 0.01 && prevCV !== undefined) {
                    dev._resCV = prevCV;
                }
                if (dev._resCV) {
                    this._addV(ctx, G, B, cV, cCOM, 3, idx);
                    dev.currentIdx = idx;
                } else {
                    this._addI(ctx, B, cV, cCOM, iSet);
                    dev.currentIdx = undefined;
                }
                idx++;
            }
        });
    },

    stampAmmeters(ctx, G, B, ammeterDevs, ammVIdx) {
        ammeterDevs.forEach(dev => {
            const cP = ctx.portToCluster.get(`${dev.id}_wire_p`);
            const cN = ctx.portToCluster.get(`${dev.id}_wire_n`);
            if (cP === undefined || cN === undefined) { dev.currentIdx = undefined; return; }
            this._addV(ctx, G, B, cP, cN, 0, ammVIdx);
            dev.currentIdx = ammVIdx++;
        });
        return ammVIdx;
    },

    // ─── 24. MF47 万用表等效注入 ────────────────────────────────────────────
    stampMF47(ctx, G, B, mf47Devs) {
        mf47Devs.forEach(dev => {
            const R = dev.getInputImpedance();
            const group = dev._range?.group;
            const cV = ctx.portToCluster.get(`${dev.id}_wire_v`);
            const cMA = ctx.portToCluster.get(`${dev.id}_wire_mA`);
            const cCOM = ctx.portToCluster.get(`${dev.id}_wire_COM`);

            if (group === 'DCmA') {
                // 直流电流档：在 mA 与 COM 之间注入电阻
                if (cMA !== undefined && cCOM !== undefined)
                    this._fill(ctx, G, B, cMA, cCOM, 1 / R);
            } else if (group === 'OHM') {
                // 电阻档：在 VΩI 与 COM 之间注入诺顿等效
                if (cV !== undefined && cCOM !== undefined) {
                    this._fill(ctx, G, B, cV, cCOM, 1 / R);
                    const batteryV = dev._range?.multiplier >= 10000 ? 9 : 1.5;
                    this._addI(ctx, B, cCOM, cV, batteryV / R);
                }
            } else {
                // 直流/交流电压档：在 VΩI 与 COM 之间注入电阻
                if (cV !== undefined && cCOM !== undefined)
                    this._fill(ctx, G, B, cV, cCOM, 1 / R);
            }
        });
    },

    // ─── 25. 控制变压器：双绕组等效电路 MNA 注入 ──────────────────────────
    /**
     * 注入双绕组控制变压器的 MNA 等效电路。
     *
     * 等效电路结构：
     *   ┌── R1 ── V_a ── [Lm ‖ CCCS(I₂/N)] ──┐  原边 (p1-p2)
     *   │                                       │
     *   p1                                      p2
     *
     *   s1 ── [VCVS(V_mag/N) + R₂] ── s2       副边
     *
     * 需要 2 个额外矩阵行/列：
     *   - 1 个内部节点 V_a（R1 与 Lm 之间）→ 添加到节点电压区
     *   - 1 个 VCVS 方程（副边受控源）→ 添加到电压源方程区
     *
     * @param {Object} ctx       - 求解器上下文
     * @param {Array[]} G        - MNA 电导矩阵
     * @param {Float64Array} B   - 电流/电压源向量
     * @param {Object[]} ctDevs  - 控制变压器设备实例数组
     * @param {number} vcvsStart - VCVS 方程在矩阵中的起始行索引
     * @param {number} intStart  - 内部节点在矩阵中的起始列/行索引
     */
    /**
     * 控制变压器 —— 互感耦合电感（伴随模型，直流自然被阻隔）
     *
     * 为每台变压器引入 2 个 MNA 电流变量（i_p, i_s），
     * 不使用导纳矩阵求逆，避免数值退化。
     * 每台占用 2 个额外方程/列（共 ctVcvsEqCount = 2 × 台数）。
     */
    stampControlTransformers(ctx, G, B, ctDevs, ctVIdx) {
        const dt = ctx.deltaTime || 0.1e-3;

        // 端口节点探测
        const portNode = (c) => {
            if (c === undefined) return undefined;
            const m = ctx.nodeMap.get(c);
            if (m !== undefined) return m;
            return undefined;
        };
        const portKnown = (c) => {
            if (c === undefined) return false;
            return ctx.vPosMap.has(c);
        };
        const portKnownV = (c) => ctx.vPosMap.get(c);
        const portGnd = (c) => {
            if (c === undefined) return false;
            return ctx.gndClusterIndices.has(c);
        };

        // 向节点行注入电流 i 对 iCol 列的导纳
        const kclStamp = (nodeCluster, iCol, sign) => {
            const n = portNode(nodeCluster);
            if (n !== undefined) G[n][iCol] += sign;
        };

        // 向方程行注入端子电压 G[eqRow][termCluster] = coeff
        // 若端子为已知/接地则折入 B
        const eqVStamp = (eqRow, termCluster, coeff) => {
            const n = portNode(termCluster);
            if (n !== undefined) {
                G[eqRow][n] += coeff;
            } else if (portKnown(termCluster)) {
                B[eqRow] -= coeff * portKnownV(termCluster);
            }
            // 接地：电压=0，coeff*0=0，跳过
        };

        let vIdx = ctVIdx;

        ctDevs.forEach(dev => {
            const cP1 = ctx.portToCluster.get(`${dev.id}_wire_p1`);
            const cP2 = ctx.portToCluster.get(`${dev.id}_wire_p2`);
            const cS1 = ctx.portToCluster.get(`${dev.id}_wire_s1`);
            const cS2 = ctx.portToCluster.get(`${dev.id}_wire_s2`);

            const primaryConnected  = cP1 !== undefined && cP2 !== undefined;
            const secondaryConnected = cS1 !== undefined && cS2 !== undefined;

            // 两绕组均断连 → 跳过
            if (!primaryConnected && !secondaryConnected) {
                dev._i1Col = undefined;
                dev._i2Col = undefined;
                vIdx += 2;
                return;
            }

            const N  = Math.max(0.001, dev._turnsRatio || 1);
            const R1 = Math.max(0.001, dev._primaryResistance   || 20);
            const R2 = Math.max(0.001, dev._secondaryResistance || 0.3);
            const L1 = Math.max(0,     dev._primaryLeakage      || 0.01);
            const L2 = Math.max(1e-6,  dev._secondaryLeakage    || 0.001);
            const Lm = Math.max(0.001, dev._magnetizingInductance || 10);
            const Rc = Math.max(0.001, dev._coreResistance || 50000);

            const Lp = Lm + L1;
            const Ls = Lp / (N * N) + L2;
            const M  = Lp / N;

            const A  = Lp / dt;      // 原边自感伴随电导
            const Bm = M  / dt;      // 互感伴随电导
            const C  = Ls / dt;      // 副边自感伴随电导

            const i1prev = dev._i1Prev || 0;
            const i2prev = dev._i2Prev || 0;

            // 历史项（驱动能量保持 + 飞返）
            const Hp = A * i1prev + Bm * i2prev;
            const Hs = Bm * i1prev + C  * i2prev;

            const i1Col = vIdx;
            const i2Col = vIdx + 1;
            dev._i1Col = i1Col;
            dev._i2Col = i2Col;

            // ── 原边 ──
            if (primaryConnected) {
                // Vp1-Vp2 = (R1+A)·i1 + Bm·i2 + Hp
                eqVStamp(i1Col, cP1,  1);
                eqVStamp(i1Col, cP2, -1);
                G[i1Col][i1Col] -= (R1 + A);
                if (secondaryConnected) G[i1Col][i2Col] -= Bm;
                B[i1Col] -= Hp;

                // KCL p1→p2
                kclStamp(cP1, i1Col,  1);
                kclStamp(cP2, i1Col, -1);
            } else {
                // 原边断连 → i1=0
                G[i1Col][i1Col] += 1;
            }

            // ── 副边 ──
            if (secondaryConnected) {
                // Vs1-Vs2 = Bm·i1 + (R2+C)·i2 + Hs
                eqVStamp(i2Col, cS1,  1);
                eqVStamp(i2Col, cS2, -1);
                if (primaryConnected) G[i2Col][i1Col] -= Bm;
                G[i2Col][i2Col] -= (R2 + C);
                B[i2Col] -= Hs;

                // KCL s1→s2
                kclStamp(cS1, i2Col,  1);
                kclStamp(cS2, i2Col, -1);
            } else {
                // 副边断连 → i2=0
                G[i2Col][i2Col] += 1;
            }

            // ── 铁损 Rc（并联在有连通的绕组端子上）──
            {
                const gCore = 1 / Rc;
                let n1, n2;
                if (primaryConnected) {
                    n1 = portNode(cP1); n2 = portNode(cP2);
                } else {
                    n1 = portNode(cS1); n2 = portNode(cS2);
                }
                if (n1 !== undefined && n2 !== undefined) {
                    G[n1][n1] += gCore; G[n1][n2] -= gCore;
                    G[n2][n1] -= gCore; G[n2][n2] += gCore;
                } else if (n1 !== undefined && (n2 === undefined || portGnd(cP2) || portKnown(cP2))) {
                    G[n1][n1] += gCore;
                    if (portKnown(cP2)) B[n1] += gCore * portKnownV(cP2);
                } else if (n2 !== undefined && (n1 === undefined || portGnd(cP1) || portKnown(cP1))) {
                    G[n2][n2] += gCore;
                    if (portKnown(cP1)) B[n2] -= gCore * portKnownV(cP1);
                }
            }

            vIdx += 2;
        });
    },

};
