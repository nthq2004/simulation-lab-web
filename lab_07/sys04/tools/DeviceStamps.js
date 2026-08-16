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
            const R = (dev.currentResistance !== undefined) ? Math.max(dev.currentResistance, 0.001) : 1e9;
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

    // ─── 1b. 单相熔断器（电阻模型） ──────────────────────────────────────
    stampFuses(ctx, G, B, fuseDevs) {
        fuseDevs.forEach(dev => {
            const cL = ctx.portToCluster.get(`${dev.id}_wire_l`);
            const cT = ctx.portToCluster.get(`${dev.id}_wire_t`);
            if (cL !== undefined && cT !== undefined) {
                const R = dev.getState() === 'ok' ? 0.01 : 1e9;
                this._fill(ctx, G, B, cL, cT, 1 / R);
            }
        });
    },

    // ─── 1c. 三相可调负载（星形：每相恒阻抗电阻 + 无功支路）──────────────────
    // 恒阻抗：R = Uph²/(P/3)，线性、绝对稳定；母线电压接近额定吸收接近设定功率。
    stampLoad3p(ctx, G, B, devs, deltaTime) {
        devs.forEach(dev => {
            const cN = ctx.portToCluster.get(`${dev.id}_wire_n`);
            const loaded = !!dev._loaded;
            const R = (loaded && dev._Rph > 0) ? dev._Rph : 1e9;
            const phs = ['l1', 'l2', 'l3'];
            phs.forEach((p, i) => {
                const c = ctx.portToCluster.get(`${dev.id}_wire_${p}`);
                if (c === undefined || cN === undefined) return;
                // 有功支路：每相恒阻抗电阻导纳
                this._fill(ctx, G, B, c, cN, 1 / Math.max(R, 0.001));
                if (!loaded || deltaTime <= 0) return;
                if (dev.reactive === 'ind' && dev._Lph > 0) {
                    // 感性并联支路：伴随模型（同电感）
                    const gEq = deltaTime / dev._Lph;
                    const iEq = dev._iLast[i] || 0;
                    this._fill(ctx, G, B, c, cN, gEq);
                    this._addI(ctx, B, c, cN, -iEq);
                } else if (dev._Cph > 0) {
                    // 容性并联支路：伴随模型（同电容）
                    const gEq = dev._Cph / deltaTime;
                    const iEq = gEq * (dev._vLast[i] || 0);
                    this._fill(ctx, G, B, c, cN, gEq);
                    this._addI(ctx, B, c, cN, iEq);
                }
            });
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

    // ─── 4b. 镍氢电池（诺顿等效：电流源 + 内阻并联，V_src = V_ocv - V_p） ──
    stampBatteries(ctx, G, B, batteryDevs) {
        batteryDevs.forEach(dev => {
            const cP = ctx.portToCluster.get(`${dev.id}_wire_p`);
            const cN = ctx.portToCluster.get(`${dev.id}_wire_n`);
            if (cP !== undefined && cN !== undefined) {
                this._fill(ctx, G, B, cP, cN, 1 / dev._rOn);
                const vSrc = dev._voltage - dev._vp;
                this._addI(ctx, B, cP, cN, vSrc / dev._rOn);
            }
        });
    },

    // ─── 4c. 铅酸蓄电池（诺顿等效，6节串联，每节一个电流源+内阻并联） ──
    //       串联由 CircuitTopology 通过内部 union 实现，12个端子均对外引出
    stampLeadAcidBatteries(ctx, G, B, batteryDevs) {
        batteryDevs.forEach(dev => {
            const rCell = dev._rOn / 6;
            const vPerCell = (dev._voltage - (dev._vp || 0)) / 6;

            for (let i = 1; i <= 6; i++) {
                const cP = ctx.portToCluster.get(`${dev.id}_wire_cell${i}_p`);
                const cN = ctx.portToCluster.get(`${dev.id}_wire_cell${i}_n`);
                if (cP !== undefined && cN !== undefined) {
                    this._fill(ctx, G, B, cP, cN, 1 / rCell);
                    this._addI(ctx, B, cP, cN, vPerCell / rCell);
                }
            }
        });
    },

    // ─── 4c2. 单节铅酸蓄电池（诺顿等效，1节，电流源 + 内阻并联） ──
    stampSingleLeadAcidBatteries(ctx, G, B, batteryDevs) {
        batteryDevs.forEach(dev => {
            const cP = ctx.portToCluster.get(dev.id + '_wire_p');
            const cN = ctx.portToCluster.get(dev.id + '_wire_n');
            if (cP !== undefined && cN !== undefined) {
                this._fill(ctx, G, B, cP, cN, 1 / dev._rOn);
                const vSrc = dev._voltage - (dev._vp || 0);
                this._addI(ctx, B, cP, cN, vSrc / dev._rOn);
            }
        });
    },

    // ─── 4d. 充放电板（CC/CV 模式：CV 时诺顿等效，CC 时电流源 + 高阻并联） ──
    stampChargeBoards(ctx, G, B, cbDevs) {
        cbDevs.forEach(dev => {
            const rOut = 0.05;
            const g = 1 / rOut;
            if (dev.isOutputEnabled(1)) {
                const v1 = dev.getOutputVoltage(1);
                const lim1 = dev.getCurrentLimit(1);
                const c1p = ctx.portToCluster.get(`${dev.id}_wire_ch1_p`);
                const c1n = ctx.portToCluster.get(`${dev.id}_wire_ch1_n`);
                if (c1p !== undefined && c1n !== undefined) {
                    if (dev._ch1CCMode) {
                        // CC 模式：电流源 + 高阻并联（数值稳定），电流限制到 lim1
                        this._fill(ctx, G, B, c1p, c1n, 1e-8); // 微小电导防奇异
                        this._addI(ctx, B, c1p, c1n, lim1);
                    } else {
                        // CV 模式：标准诺顿等效
                        this._fill(ctx, G, B, c1p, c1n, g);
                        this._addI(ctx, B, c1p, c1n, v1 * g);
                    }
                }
            }
            if (dev.isOutputEnabled(2)) {
                const v2 = dev.getOutputVoltage(2);
                const lim2 = dev.getCurrentLimit(2);
                const c2p = ctx.portToCluster.get(`${dev.id}_wire_ch2_p`);
                const c2n = ctx.portToCluster.get(`${dev.id}_wire_ch2_n`);
                if (c2p !== undefined && c2n !== undefined) {
                    if (dev._ch2CCMode) {
                        // CC 模式：电流源 + 高阻并联
                        this._fill(ctx, G, B, c2p, c2n, 1e-8);
                        this._addI(ctx, B, c2p, c2n, lim2);
                    } else {
                        // CV 模式：标准诺顿等效
                        this._fill(ctx, G, B, c2p, c2n, g);
                        this._addI(ctx, B, c2p, c2n, v2 * g);
                    }
                }
            }
        });
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
                    // 关闭时呈高阻抗（10 MΩ），避免把电机端子短路到中性点
                    const rOn = dev.isOn
                        ? dev._rOnEff || dev.rOn || 0.01
                        : 10e6;

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
            if (dev.special !== 'voltage' && dev.special !== 'time') return;
            const c1 = ctx.portToCluster.get(`${dev.id}_wire_l`);
            const c2 = ctx.portToCluster.get(`${dev.id}_wire_r`);
            const R = dev.currentResistance || 1000;
            if (c1 !== undefined && c2 !== undefined)
                this._fill(ctx, G, B, c1, c2, 1 / R);

            if (dev.special === 'time') return;

            const cCOM = ctx.portToCluster.get(`${dev.id}_wire_COM`);
            const cNO = ctx.portToCluster.get(`${dev.id}_wire_NO`);
            if (cCOM !== undefined && cNO !== undefined) {
                const R = (dev.isEnergized===true && dev.contactFault === false) ? 0.01 : 1e9;
                this._fill(ctx, G, B, cCOM, cNO, 1 / R);
            }

        });
    },

    // ─── 16b. 三相交流接触器（串联 RL 伴随模型） ──────────────────────
    stampContactors(ctx, G, B, contactorDevs, deltaTime) {
        // 旧伴随模型 stamp 保留注释作为参考，实际由 stampRLSeries 替代
    },

    // ─── 16b. 主触头（3极，每极独立电阻） ──────────────────────────────────
    stampMainContacts(ctx, G, B, devs) {
        devs.forEach(dev => {
            const R = dev.getValue();
            const poles = [
                ['l1', 't1'],
                ['l2', 't2'],
                ['l3', 't3'],
            ];
            poles.forEach(([p1, p2]) => {
                const c1 = ctx.portToCluster.get(`${dev.id}_wire_${p1}`);
                const c2 = ctx.portToCluster.get(`${dev.id}_wire_${p2}`);
                if (c1 !== undefined && c2 !== undefined) {
                    this._fill(ctx, G, B, c1, c2, 1 / R);
                }
            });
        });
    },

    // ─── 16d. 辅助常开触点（单极电阻） ──────────────────────────────────
    stampNOContacts(ctx, G, B, devs) {
        devs.forEach(dev => {
            const R = dev.getValue();
            const c1 = ctx.portToCluster.get(`${dev.id}_wire_com`);
            const c2 = ctx.portToCluster.get(`${dev.id}_wire_no`);
            if (c1 !== undefined && c2 !== undefined) {
                this._fill(ctx, G, B, c1, c2, 1 / R);
            }
        });
    },

    // ─── 16e. 辅助常闭触点（单极电阻） ──────────────────────────────────
    stampNCContacts(ctx, G, B, devs) {
        devs.forEach(dev => {
            const R = dev.getValue();
            const c1 = ctx.portToCluster.get(`${dev.id}_wire_com`);
            const c2 = ctx.portToCluster.get(`${dev.id}_wire_nc`);
            if (c1 !== undefined && c2 !== undefined) {
                this._fill(ctx, G, B, c1, c2, 1 / R);
            }
        });
    },

    // ─── 16f. 线圈（固定电阻） ──────────────────────────────────
    stampContactCoils(ctx, G, B, devs) {
        devs.forEach(dev => {
            const R = 1000;
            const c1 = ctx.portToCluster.get(`${dev.id}_wire_a1`);
            const c2 = ctx.portToCluster.get(`${dev.id}_wire_a2`);
            if (c1 !== undefined && c2 !== undefined) {
                this._fill(ctx, G, B, c1, c2, 1 / R);
            }
        });
    },

    // ─── 16c RL 串联支路（电压源方程 MNA stamp） ──────────────────────────
    // 用电压源方程消除伴随模型 DC 稳态误差：
    //   V_A1 - V_A2 - (R + L/dt)·i = -(L/dt)·iPrev
    // 每设备增加一行一列到 MNA（电流 i 为新增变量）
    stampRLSeries(ctx, G, B, devs, startIdx, deltaTime) {
        devs.forEach((dev, i) => {
            const p1 = dev._rlPort1 || 'a1';
            const p2 = dev._rlPort2 || 'a2';
            const c1 = ctx.portToCluster.get(`${dev.id}_wire_${p1}`);
            const c2 = ctx.portToCluster.get(`${dev.id}_wire_${p2}`);
            if (c1 === undefined || c2 === undefined) return;

            if (dev._faultCoilOpen) {
                this._fill(ctx, G, B, c1, c2, 1e-10);
                dev._coilPrevCurrent = 0;
                return;
            }

            const R = dev._coilResistance || 1000;
            const L = dev._coilInductance ?? 5;
            if (L <= 0) {
                this._fill(ctx, G, B, c1, c2, 1 / R);
                return;
            }

            const dt = deltaTime;
            const iPrev = dev._coilPrevCurrent || 0;
            const vIdx = startIdx + i;
            const R_s = R + L / dt;
            const V_s = -(L / dt) * iPrev;

            const { nodeMap, gndClusterIndices, vPosMap } = ctx;

            const i1 = gndClusterIndices.has(c1) ? -1 : (vPosMap.has(c1) ? -2 : (nodeMap.has(c1) ? nodeMap.get(c1) : -1));
            const i2 = gndClusterIndices.has(c2) ? -1 : (vPosMap.has(c2) ? -2 : (nodeMap.has(c2) ? nodeMap.get(c2) : -1));

            let adjustedV = V_s;
            if (vPosMap.has(c1)) adjustedV -= vPosMap.get(c1);
            if (vPosMap.has(c2)) adjustedV += vPosMap.get(c2);

            B[vIdx] = adjustedV;
            G[vIdx][vIdx] = -R_s;

            if (i1 >= 0) {
                G[vIdx][i1] = 1;
                G[i1][vIdx] = 1;
            }
            if (i2 >= 0) {
                G[vIdx][i2] = -1;
                G[i2][vIdx] = -1;
            }

            dev._rlVIdx = vIdx;
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

    // ─── 22.3 逆功率继电器（REV-POWER）：NO/NC/COM 触点电阻注入 ───
    stampRevPowerContacts(ctx, G, B, revPowerDevs) {
        revPowerDevs.forEach(dev => {
            const tripped = dev._state === 'tripped';
            const cCOM = ctx.portToCluster.get(`${dev.id}_wire_COM`);
            const cNC  = ctx.portToCluster.get(`${dev.id}_wire_NC`);
            const cNO  = ctx.portToCluster.get(`${dev.id}_wire_NO`);
            if (cCOM !== undefined && cNC !== undefined) {
                this._fill(ctx, G, B, cCOM, cNC, tripped ? 1e-9 : 100);
            }
            if (cCOM !== undefined && cNO !== undefined) {
                this._fill(ctx, G, B, cCOM, cNO, tripped ? 100 : 1e-9);
            }
        });
    },

    // ─── 22.2 恒流源（理想恒流源，无顺从电压限制）───
    stampCCSources(ctx, G, B, ccDevs, ccVIdx) {
        ccDevs.forEach(dev => {
            const cN = ctx.portToCluster.get(dev.id + '_wire_com');
            const cP = ctx.portToCluster.get(dev.id + '_wire_i1');
            if (cP !== undefined && cN !== undefined) {
                this._fill(ctx, G, B, cN, -1, 1e-6);
                const iVal = (dev.currentValue !== undefined) ? dev.currentValue : 0.001;
                this._addI(ctx, B, cP, cN, iVal);
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

    // ─── 25. IC7805 三端稳压器（受控电压源 + 0.01Ω 输出电阻 + 限流）────
    /**
     * IC7805 MNA 注入：
     *   - 诺顿等效（正常模式）：G = 1/0.01 S 并联 I = Vt/0.01 A
     *   - 恒流源（限流模式 1.5A / 短路模式 0.5A）
     *   Vt 由 Vin 每轮迭代计算，无需额外方程。
     */
    stamp7805s(ctx, G, B, devs, results) {
        devs.forEach(dev => {
            const cIn = ctx.portToCluster.get(`${dev.id}_wire_in`);
            const cOut = ctx.portToCluster.get(`${dev.id}_wire_out`);
            const cGnd = ctx.portToCluster.get(`${dev.id}_wire_gnd`);

            if (cOut === undefined || cGnd === undefined) {
                dev.physCurrent = 0;
                return;
            }

            // 短路：out 和 gnd 属于同一簇
            if (cOut === cGnd) {
                this._addI(ctx, B, cOut, cGnd, 0.5);
                dev._regMode = 'short';
                return;
            }

            // 读取本轮迭代电压
            const vIn = cIn !== undefined ? (ctx.getVoltageFromResults(results, cIn) || 0) : 0;
            const vGnd = ctx.getVoltageFromResults(results, cGnd) || 0;
            const vOut = ctx.getVoltageFromResults(results, cOut) || 0;
            const Vi = vIn - vGnd;
            const Vo = vOut - vGnd;

            // 目标空载电压
            let Vt;
            if (Vi < 5) {
                Vt = Vi;
            } else {
                Vt = 5 + 0.005 * (Vi - 8);
            }
            dev._lastVt = Vt;
            dev._lastVi = Vi;

            // 估算输出电流
            const IoEst = Vt > 0.01 ? (Vt - Vo) / 0.01 : 0;

            if (IoEst > 1.5) {
                // 限流模式：1.5A 恒流源
                this._addI(ctx, B, cOut, cGnd, 1.5);
                dev._regMode = 'cl';
            } else {
                // 正常稳压模式：诺顿等效（受控电压源 + 0.01Ω 输出电阻）
                this._fill(ctx, G, B, cOut, cGnd, 1 / 0.01);
                this._addI(ctx, B, cOut, cGnd, Vt / 0.01);
                dev._regMode = 'normal';
            }
        });
    },

    // ─── 26. 三相电机绕组（三耦合电感器，MNA 电流变量法）───────────────
    /**
     * 为三相异步电动机定子绕组注入三相互感耦合电感模型。
     *
     * 每台设备占用 3 个电流变量列（i_u, i_v, i_w），对应 3 个绕组方程。
     *
     * 方程（后向欧拉离散）：
     *   V(u1)-V(u2) = R·i_u + (L/dt)·i_u + (M/dt)·i_v + (M/dt)·i_w - H_u
     *   V(v1)-V(v2) = R·i_v + (M/dt)·i_u + (L/dt)·i_v + (M/dt)·i_w - H_v
     *   V(w1)-V(w2) = R·i_w + (M/dt)·i_u + (M/dt)·i_v + (L/dt)·i_w - H_w
     *
     * 历史项：
     *   H_u = (L/dt)·i_u_prev + (M/dt)·i_v_prev + (M/dt)·i_w_prev
     *   H_v = (M/dt)·i_u_prev + (L/dt)·i_v_prev + (M/dt)·i_w_prev
     *   H_w = (M/dt)·i_u_prev + (M/dt)·i_v_prev + (L/dt)·i_w_prev
     *
     * M < 0 表示相差 120°（cos120° = -1/2），U1 正脉冲 → V1 反偏。
     */
    stampMotorWindings(ctx, G, B, mwDevs, mwVIdx) {
        const dt = ctx.deltaTime || 0.1e-3;

        const portNode = (c) => {
            if (c === undefined) return undefined;
            const m = ctx.nodeMap.get(c);
            return m !== undefined ? m : undefined;
        };
        const portKnown = (c) => c !== undefined && ctx.vPosMap.has(c);
        const portKnownV = (c) => ctx.vPosMap.get(c);

        const kclStamp = (nodeCluster, iCol, sign) => {
            const n = portNode(nodeCluster);
            if (n !== undefined) G[n][iCol] += sign;
        };

        const eqVStamp = (eqRow, termCluster, coeff) => {
            const n = portNode(termCluster);
            if (n !== undefined) {
                G[eqRow][n] += coeff;
            } else if (portKnown(termCluster)) {
                B[eqRow] -= coeff * portKnownV(termCluster);
            }
        };

        let vIdx = mwVIdx;

        mwDevs.forEach(dev => {
            const p = (name) => ctx.portToCluster.get(`${dev.id}_wire_${name}`);
            const cU1 = p('u1'), cU2 = p('u2');
            const cV1 = p('v1'), cV2 = p('v2');
            const cW1 = p('w1'), cW2 = p('w2');

            const R  = dev.windingR  || 2.5;
            const L  = dev.windingL  || 0.082;
            const M  = dev.mutualL   || -0.039;

            const Gself = L / dt;
            const Gmut  = M / dt;

            const iuP = dev._iuPrev || 0;
            const ivP = dev._ivPrev || 0;
            const iwP = dev._iwPrev || 0;

            const Hu = Gself * iuP + Gmut * ivP + Gmut * iwP;
            const Hv = Gmut * iuP + Gself * ivP + Gmut * iwP;
            const Hw = Gmut * iuP + Gmut * ivP + Gself * iwP;

            const colU = vIdx;
            const colV = vIdx + 1;
            const colW = vIdx + 2;
            dev._iUCol = colU;
            dev._iVCol = colV;
            dev._iWCol = colW;

            // ── U 相方程 ──
            if (cU1 !== undefined && cU2 !== undefined) {
                eqVStamp(colU, cU1,  1);
                eqVStamp(colU, cU2, -1);
                G[colU][colU] -= (R + Gself);
                G[colU][colV] -= Gmut;
                G[colU][colW] -= Gmut;
                B[colU] -= Hu;

                kclStamp(cU1, colU,  1);
                kclStamp(cU2, colU, -1);
            } else {
                G[colU][colU] += 1;
            }

            // ── V 相方程 ──
            if (cV1 !== undefined && cV2 !== undefined) {
                eqVStamp(colV, cV1,  1);
                eqVStamp(colV, cV2, -1);
                G[colV][colU] -= Gmut;
                G[colV][colV] -= (R + Gself);
                G[colV][colW] -= Gmut;
                B[colV] -= Hv;

                kclStamp(cV1, colV,  1);
                kclStamp(cV2, colV, -1);
            } else {
                G[colV][colV] += 1;
            }

            // ── W 相方程 ──
            if (cW1 !== undefined && cW2 !== undefined) {
                eqVStamp(colW, cW1,  1);
                eqVStamp(colW, cW2, -1);
                G[colW][colU] -= Gmut;
                G[colW][colV] -= Gmut;
                G[colW][colW] -= (R + Gself);
                B[colW] -= Hw;

                kclStamp(cW1, colW,  1);
                kclStamp(cW2, colW, -1);
            } else {
                G[colW][colW] += 1;
            }

            vIdx += 3;
        });
        return vIdx;
    },

    // ─── 27. 控制变压器：双绕组等效电路 MNA 注入 ──────────────────────────
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

    // ─── 28. 三相异步电动机（6 电流变量完整耦合模型）────────────────────
    /**
     * 为 InductionMotor 注入 6 电流变量 MNA 模型：
     *   3 定子电流（i_u, i_v, i_w）— 连接外部端子 u1-u2, v1-v2, w1-w2
     *   3 转子电流（i_ru, i_rv, i_rw）— 内部短路，无外部端口
     *
     * 若 dev.simpleModel === true 则退化为 3 变量简化模型（定子 RL+转矩公式，
     * 避免因后向欧拉离散相位误差导致的负转矩/数值发散）。
     */
    stampInductionMotors(ctx, G, B, motorDevs) {
        this._stampIMSimple(ctx, G, B, motorDevs);
    },

    /** 简化 3 变量模型：每相 RL 串联，转矩由 I²·R2/slip 公式计算 */
    _stampIMSimple(ctx, G, B, motorDevs) {
        const dt = ctx.deltaTime || 0.5e-3;

        motorDevs.forEach(dev => {
            const p = (name) => ctx.portToCluster.get(`${dev.id}_wire_${name}`);
            const cU1 = p('u1'), cU2 = p('u2');
            const cV1 = p('v1'), cV2 = p('v2');
            const cW1 = p('w1'), cW2 = p('w2');

            const R1 = dev.R1 || 2.15;
            const R2 = dev.R2 || 0.42;
            const L1s = dev.Lsigma1 || 0.004;
            const L2s = dev.Lsigma2 || 0.005;

            let slip = dev.slip !== undefined ? dev.slip : 1;
            if (Math.abs(slip) < 0.0001) slip = slip >= 0 ? 0.0001 : -0.0001;
            const R_load = R1 + R2 / slip;
            const L_total = L1s + L2s;  // 简化模型不含串联 Lm，Lm 作为并联励磁支路处理
            const Zeq = R_load + L_total / dt;
            const Geq = 1 / Zeq;
            const Ldt = L_total / dt;

            // 保存 Norton 参数供后处理回读电流
            dev._nortonGeq = Geq;
            dev._nortonLdt = Ldt;

            dev._iUCol = undefined; dev._iVCol = undefined; dev._iWCol = undefined;
            dev._iRUCol = undefined; dev._iRVCol = undefined; dev._iRWCol = undefined;

            const iup = dev._iuPrev || 0, ivp = dev._ivPrev || 0, iwp = dev._iwPrev || 0;
            let Ihu = Ldt * Geq * iup;
            let Ihv = Ldt * Geq * ivp;
            let Ihw = Ldt * Geq * iwp;

            // ── 并联励磁支路：Rc || (R_damp + Lm) 诺顿梯形积分 ──
            const Rc_val  = dev.Rc || 300;
            const Lm_val  = dev.Lm || 0.078;
            const G_Rc    = Rc_val > 0 ? 1 / Rc_val : 0;
            // RL 串联（R_damp 提供阻尼，消除纯电感梯形积分的 DC 漂移）
            const R_damp  = 0.5;                      // 串联阻尼电阻 (Ω)
            const K_Lm    = dt / (2 * Lm_val);
            const Geq_RL  = K_Lm / (1 + R_damp * K_Lm);   // = dt/(2Lm + R_damp·dt)
            const damp_alpha = (1 - R_damp * K_Lm) / (1 + R_damp * K_Lm);
            // Lm 历史电流：I_hist[n] = α·I[n-1] + Geq·V[n-1]
            const magIhu  = (dev._magVuPrev !== undefined) ? damp_alpha * (dev._magIuPrev || 0) + Geq_RL * dev._magVuPrev : 0;
            const magIhv  = (dev._magVvPrev !== undefined) ? damp_alpha * (dev._magIvPrev || 0) + Geq_RL * dev._magVvPrev : 0;
            const magIhw  = (dev._magVwPrev !== undefined) ? damp_alpha * (dev._magIwPrev || 0) + Geq_RL * dev._magVwPrev : 0;

            const G_mag   = G_Rc + Geq_RL;   // 总励磁电导

            // 保存供 CircuitSolver 后处理使用
            dev._nortonMagGeq = G_mag;
            dev._nortonMagIhu = magIhu;
            dev._nortonMagIhv = magIhv;
            dev._nortonMagIhw = magIhw;
            // 保存 RL 参数确保后处理与封装使用一致的 α 和 Geq
            dev._nortonRL_Geq   = Geq_RL;
            dev._nortonRL_alpha = damp_alpha;

            // 诺顿等效：转子支路 + 励磁支路并联 → 总电导 + 总历史电流源
            for (const [c1, c2, Ih, magIh] of [[cU1, cU2, Ihu, magIhu], [cV1, cV2, Ihv, magIhv], [cW1, cW2, Ihw, magIhw]]) {
                if (c1 !== undefined && c2 !== undefined) {
                    this._fill(ctx, G, B, c1, c2, Geq + G_mag);
                    // 历史电流源方向：从 c2 流向 c1
                    this._addI(ctx, B, c2, c1, Ih + magIh);
                }
            }

            // ── 剩磁：仅在交流电源断开时注入（电源接通时内阻极小，不参与 MNA）──
            // 剩磁通 ψ_r 旋转感应 e = ψ_r·K_rem·ω_m·sin(θ_r)，
            // 诺顿：I = e/R_rem, G = 1/R_rem，并联在电机端子上。
            // 300 RPM (10Hz) → e ≈ 2.3Vpk → Vterm ≈ 2.3Vpk。
            const comps = Object.values(dev.sys?.comps || {});
            const acOn = comps.some(c => c.type === 'source_3p' && c.isOn);
            if (!acOn) {
                const remFlux = dev.remanenceFlux || 0;
                const omega_m = dev._omega_m || 0;
                if (remFlux > 1e-6 && omega_m > 0.01) {
                    const K_rem = 6.0;
                    const e_rem = remFlux * K_rem * omega_m;
                    const thR = dev._theta_r || 0;
                    const s_u = Math.sin(thR);
                    const s_v = Math.sin(thR - 2.0943951023931953);
                    const s_w = Math.sin(thR + 2.0943951023931953);
                    const R_rem = 0.1;
                    const G_rem = 10.0;
                    if (cU1 !== undefined && cU2 !== undefined) {
                        this._fill(ctx, G, B, cU1, cU2, G_rem);
                        this._addI(ctx, B, cU2, cU1, e_rem * s_u * G_rem);
                    }
                    if (cV1 !== undefined && cV2 !== undefined) {
                        this._fill(ctx, G, B, cV1, cV2, G_rem);
                        this._addI(ctx, B, cV2, cV1, e_rem * s_v * G_rem);
                    }
                    if (cW1 !== undefined && cW2 !== undefined) {
                        this._fill(ctx, G, B, cW1, cW2, G_rem);
                        this._addI(ctx, B, cW2, cW1, e_rem * s_w * G_rem);
                    }
                }
            }
        });
    },

    // ─── 热继电器三相热元件（小电阻注入） ────────────────────────────
    stampThermalRelays(ctx, G, B, thermalDevs) {
        thermalDevs.forEach(dev => {
            const R = dev._phaseResistance || 0.01;
            [['l1','t1'],['l2','t2'],['l3','t3']].forEach(([a, b]) => {
                const pa = `${dev.id}_wire_${a}`;
                const pb = `${dev.id}_wire_${b}`;
                const c1 = ctx.portToCluster.get(pa);
                const c2 = ctx.portToCluster.get(pb);
                if (c1 !== undefined && c2 !== undefined)
                    this._fill(ctx, G, B, c1, c2, 1 / R);
            });
        });
    },

    // ─── 热继电器复合设备：三相发热元件（小电阻注入）───────────────
    stampThermalHeatElements(ctx, G, B, devs) {
        devs.forEach(dev => {
            const R = dev.getValue() || 0.01;
            [['l1','t1'],['l2','t2'],['l3','t3']].forEach(([a, b]) => {
                const pa = `${dev.id}_wire_${a}`;
                const pb = `${dev.id}_wire_${b}`;
                const c1 = ctx.portToCluster.get(pa);
                const c2 = ctx.portToCluster.get(pb);
                if (c1 !== undefined && c2 !== undefined)
                    this._fill(ctx, G, B, c1, c2, 1 / R);
            });
        });
    },

    // ─── 三相空气断路器（接触电阻 + 分励脱扣器线圈）─────────────────
    stampACBs(ctx, G, B, acbDevs) {
        acbDevs.forEach(dev => {
            // 船用发电机主开关（MarineMainsSwitch）：合闸注入 0.0001Ω，分闸不注入导纳（真正隔离，
            // 避免高阻把悬空汇流排网络拖到电源电位，导致"分闸仍带电"）
            if (dev.special === 'MainsSwitch') {
                if (dev._state === 'on') {
                    const R = 0.0001;
                    [['l1','t1'],['l2','t2'],['l3','t3']].forEach(([a, b]) => {
                        const c1 = ctx.portToCluster.get(`${dev.id}_wire_${a}`);
                        const c2 = ctx.portToCluster.get(`${dev.id}_wire_${b}`);
                        if (c1 !== undefined && c2 !== undefined)
                            this._fill(ctx, G, B, c1, c2, 1 / R);
                    });
                }
                // 控制线圈电阻（储能电机/合闸线圈/失压/电子脱扣，每对默认 200Ω）
                [['m1','m2'],['c1','c2'],['uv1','uv2'],['et1','et2']].forEach(([a, b]) => {
                    const Rc = (dev._coilR && dev._coilR[a]) || 200;
                    const cA = ctx.portToCluster.get(`${dev.id}_wire_${a}`);
                    const cB = ctx.portToCluster.get(`${dev.id}_wire_${b}`);
                    if (cA !== undefined && cB !== undefined)
                        this._fill(ctx, G, B, cA, cB, 1 / Rc);
                });
                // 分励线圈 fla↔flb
                const Rfl = dev._tripCoilR || 50;
                const cFla = ctx.portToCluster.get(`${dev.id}_wire_fla`);
                const cFlb = ctx.portToCluster.get(`${dev.id}_wire_flb`);
                if (cFla !== undefined && cFlb !== undefined)
                    this._fill(ctx, G, B, cFla, cFlb, 1 / Rfl);
                // 辅助触点：常闭 nc（分闸闭合 / 合闸断开）、常开 no（分闸断开 / 合闸闭合）
                const auxOn = dev._state === 'on';
                [['nc1', 'nc2', auxOn ? 10e9 : 0.0001], ['no1', 'no2', auxOn ? 0.0001 : 10e9]].forEach(([a, b, R]) => {
                    const c1 = ctx.portToCluster.get(`${dev.id}_wire_${a}`);
                    const c2 = ctx.portToCluster.get(`${dev.id}_wire_${b}`);
                    if (c1 !== undefined && c2 !== undefined)
                        this._fill(ctx, G, B, c1, c2, 1 / R);
                });
                return;
            }

            // 主触头接触电阻（仅合闸状态）
            if (dev._state === 'on') {
                const Rcontact = 0.001;
                [['l1','t1'],['l2','t2'],['l3','t3']].forEach(([a, b]) => {
                    const c1 = ctx.portToCluster.get(`${dev.id}_wire_${a}`);
                    const c2 = ctx.portToCluster.get(`${dev.id}_wire_${b}`);
                    if (c1 !== undefined && c2 !== undefined)
                        this._fill(ctx, G, B, c1, c2, 1 / Rcontact);
                });
            }
            // 分励脱扣器线圈电阻（始终存在于 fla↔flb 之间）
            const Rcoil = dev._tripCoilR || 50;
            const cFla = ctx.portToCluster.get(`${dev.id}_wire_fla`);
            const cFlb = ctx.portToCluster.get(`${dev.id}_wire_flb`);
            if (cFla !== undefined && cFlb !== undefined)
                this._fill(ctx, G, B, cFla, cFlb, 1 / Rcoil);
        });
    },

    // ─── 船用主开关电子脱扣器（MarineElectronicTrip） ────────────────
    // I+↔I- 以 0V 电压源注入（等效理想导线）测量回路电流（参照 ElecMeter/Wattmeter）；
    // t1↔t2 为脱扣输出电压源：未脱扣 0V，脱扣 24V
    stampTripRelays(ctx, G, B, tripDevs, tripVIdx) {
        tripDevs.forEach(dev => {
            const cIp = ctx.portToCluster.get(`${dev.id}_wire_i+`);
            const cIm = ctx.portToCluster.get(`${dev.id}_wire_i-`);
            if (cIp !== undefined && cIm !== undefined) {
                // 0V 电压源：测电流端不引入电阻，求解结果 = 流过 I+/I- 的回路电流
                this._addV(ctx, G, B, cIp, cIm, 0, tripVIdx);
                dev.currentIdx = tripVIdx++;
            } else {
                dev.currentIdx = undefined;
            }

            // 脱扣输出电压源 t1↔t2：未脱扣 0V，脱扣 24V
            const cT1 = ctx.portToCluster.get(`${dev.id}_wire_t1`);
            const cT2 = ctx.portToCluster.get(`${dev.id}_wire_t2`);
            if (cT1 !== undefined && cT2 !== undefined) {
                const vOut = dev._tripped ? 24 : 0;
                this._addV(ctx, G, B, cT1, cT2, vOut, tripVIdx);
                dev.tripOutIdx = tripVIdx++;
            } else {
                dev.tripOutIdx = undefined;
            }
        });
        return tripVIdx;
    },

    // ─── 发电机组遥控面板（GeneratorRemotePanel） ───────────────────────
    // 3 个电压源：调速 spd→-1/0/+1V、合闸 close→24V、分闸 open→24V。
    // 面板通电（_powered）后才输出非零电压，未通电恒 0V（等价短接）。
    stampGenRemotePanels(ctx, G, B, panelDevs, vIdx) {
        panelDevs.forEach(dev => {
            const powered = !!dev._powered;
            const emit = (a, b, volt) => {
                const cA = ctx.portToCluster.get(`${dev.id}_wire_${a}`);
                const cB = ctx.portToCluster.get(`${dev.id}_wire_${b}`);
                if (cA !== undefined && cB !== undefined) {
                    this._addV(ctx, G, B, cA, cB, volt, vIdx++);
                }
            };
            emit('spd_p', 'spd_n', powered ? (dev._spdVolt || 0) : 0);
            emit('close_a', 'close_b', powered && dev._closePressed ? 24 : 0);
            emit('open_a', 'open_b', powered && dev._openPressed ? 24 : 0);
        });
        return vIdx;
    },
    stampFluorescentLamps(ctx, G, B, lampDevs) {
        lampDevs.forEach(dev => {
            const cLa = ctx.portToCluster.get(`${dev.id}_wire_left_a`);
            const cLb = ctx.portToCluster.get(`${dev.id}_wire_left_b`);
            const cRa = ctx.portToCluster.get(`${dev.id}_wire_right_a`);
            const cRb = ctx.portToCluster.get(`${dev.id}_wire_right_b`);

            const isOn = dev._state === 'on';
            const rFil = isOn ? 15 : dev.filamentR;
            const rGap = isOn ? dev.gapOnR : 10e6;

            if (cLa !== undefined && cLb !== undefined)
                this._fill(ctx, G, B, cLa, cLb, 1 / rFil);
            if (cRa !== undefined && cRb !== undefined)
                this._fill(ctx, G, B, cRa, cRb, 1 / rFil);
            if (cLb !== undefined && cRb !== undefined)
                this._fill(ctx, G, B, cLb, cRb, 1 / rGap);
        });
    },

    // ─── 启辉器：电压控制可变电阻 ───────────────────────────────────
    stampStarters(ctx, G, B, starterDevs) {
        starterDevs.forEach(dev => {
            const cL = ctx.portToCluster.get(`${dev.id}_wire_l`);
            const cR = ctx.portToCluster.get(`${dev.id}_wire_r`);
            if (cL === undefined || cR === undefined) return;
            const R = dev.getResistance();
            this._fill(ctx, G, B, cL, cR, 1 / R);
        });
    },

    // ─── UPS 不间断电源（诺顿等效交流源注入） ──────────────────────────
    // 每个输出通道（out1/out2）在供电时以诺顿等效注入交流电压源
    // （与 stampPowerSources 一致，不增加矩阵方程）；不供电时输出开路（高阻）。
    // UPS 不间断电源：输出端用电压源方程注入（强制 out_p - out_n = 期望输出，
    // 支路电流由 MNA 直接解出，避免诺顿模型与组件时间基准不同步导致的相位误差）
    stampUPSs(ctx, G, B, upsDevs, vIdx, currentTime) {
        upsDevs.forEach(dev => {
            ['out1', 'out2'].forEach(ch => {
                const pId = `${dev.id}_wire_${ch}_p`;
                const nId = `${dev.id}_wire_${ch}_n`;
                const cP = ctx.portToCluster.get(pId);
                const cN = ctx.portToCluster.get(nId);
                if (cP !== undefined && cN !== undefined) {
                    if (dev.isOutputActive(ch)) {
                        const v = dev.getOutputInstant(ch, currentTime);
                        this._addV(ctx, G, B, cP, cN, v, vIdx);
                        dev._upsVIdx = dev._upsVIdx || { out1: -1, out2: -1 };
                        dev._upsVIdx[ch] = vIdx;
                    } else {
                        dev._upsVIdx = dev._upsVIdx || { out1: -1, out2: -1 };
                        dev._upsVIdx[ch] = -1;
                    }
                }
                vIdx++; // 索引计数严格一致（未接线通道也占位，但矩阵不使用）
            });
        });
        return vIdx;
    },

};
