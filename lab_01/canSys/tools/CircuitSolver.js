/**
 * CircuitSolver.js  V4.0 (模块化重构版)
 *
 * 模块结构：
 *   CircuitTopology    — 并查集拓扑构建
 *   MNAMatrix          — 矩阵底层操作（填充、求解、电压源/电流源注入）
 *   DeviceStamps       — 各器件 MNA stamp
 *   CircuitUtils       — 等效电阻、电压辅助方法
 *   InstrumentUpdater  — 仪表 UI 更新
 *   _updateDeviceCurrents — 求解后所有设备电流统一计算
 */

import { CircuitTopology } from './CircuitTopology.js';
import { MNAMatrix } from './MNAMatrix.js';
import { DeviceStamps } from './DeviceStamps.js';
import { CircuitUtils } from './CircuitUtils.js';
import { InstrumentUpdater } from './InstrumentUpdater.js';

export class CircuitSolver {
    constructor(sys) {
        this.sys = sys;
        this.deltaTime = 0.1 / 1000; // 0.1ms 步长
        this.currentTime = 0;
        this.globalIterCount = 0;
        this.rawDevices = Object.values(sys.comps);
        this.portToCluster = new Map();
        this.nodeVoltages = new Map();
        this.clusters = [];
        this.clusterCount = 0;
        this.gndClusterIndices = new Set();
        this.vPosMap = new Map();

        this._equivResCache = new Map();
        this._topologySig = null;

        this._topology = new CircuitTopology();
        this._instruments = new InstrumentUpdater(this);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 主循环
    // ═══════════════════════════════════════════════════════════════════════
    update() {
        this.portToCluster.clear();
        this.nodeVoltages.clear();
        this.gndClusterIndices.clear();
        this.vPosMap.clear();
        this.clusters = [];

        this.connections = this.sys.conns.filter(c => c.type === 'wire');
        this.currentTime += this.deltaTime;
        this.globalIterCount++;

        this._buildTopology();
        this._invalidateCacheIfNeeded();
        this._solve();
        this._instruments.update();
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 1. 拓扑构建
    // ═══════════════════════════════════════════════════════════════════════
    _buildTopology() {
        const result = this._topology.build(this.rawDevices, this.connections);
        this.portToCluster = result.portToCluster;
        this.clusterCount = result.clusterCount;
        this.clusters = result.clusters;
    }

    _invalidateCacheIfNeeded() {
        try {
            const connKeys = this.connections.map(c => `${c.from}-${c.to}-${c.type}`).sort();
            const resistSigs = [];
            for (const d of this.rawDevices) {
                if (d.type === 'resistor') resistSigs.push(`${d.id}:${d.currentResistance || 0}`);
                if (d.type === 'pressure_sensor') {
                    resistSigs.push(`${d.id}_r1:${d.r1 || 0}`);
                    resistSigs.push(`${d.id}_r2:${d.r2 || 0}`);
                }
                if (d.special === 'can') resistSigs.push(`${d.id}:${d.currentResistance || 0}`);
                if (d.type === 'relay' && d.special === 'voltage') resistSigs.push(`${d.id}:${d.currentResistance || 0}`);
                if (d.type === 'tc') resistSigs.push(`${d.id}:${d.currentResistance || 0}`);
                if(d.type === 'calibrator'){
                    resistSigs.push(`${d.id}:${d.sourceValue || 0}`);}

            }
            resistSigs.sort();
            const sig = connKeys.join('|') + '|' + resistSigs.join('|');
            if (sig !== this._topologySig) {
                this._topologySig = sig;
                this._equivResCache.clear();
            }
        } catch (e) { /* ignore */ }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 2. 核心求解（节点电压法 + 非线性迭代）
    // ═══════════════════════════════════════════════════════════════════════
    _solve() {
        const currentTime = this.globalIterCount * this.deltaTime;
        const raw = this.rawDevices;

        // 按类型分组（供本帧和仪表复用）
        const gndDevs = raw.filter(d => d.type === 'gnd');
        const powerDevs = raw.filter(d => d.type === 'source' || d.type === 'ac_source');
        const power3Devs = raw.filter(d => d.type === 'source_3p');
        const tcDevs = raw.filter(d => d.type === 'tc');
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
        const relayDevs = raw.filter(d => d.type === 'relay' && d.special === 'voltage');
        const aiDevs = raw.filter(d => d.type === 'AI');
        const pcDevs = raw.filter(d => d.type === 'calibrator');

        this._cachedDevs = {
            gndDevs, powerDevs, power3Devs, tcDevs, pidDevs, bjtDevs, opAmps,
            oscDevs, osc3Devs, diodeDevs, resistorDevs, pressDevs, transmitterDevs,
            capacitorDevs, inductorDevs, lvdtDevs, sgDevs, jfetDevs, relayDevs, aiDevs,
            pcDevs,
        };

        // ── 识别 GND / 已知电源节点 ──────────────────────────────────────
        gndDevs.forEach(g => {
            const cIdx = this.portToCluster.get(`${g.id}_wire_gnd`);
            if (cIdx !== undefined) this.gndClusterIndices.add(cIdx);
        });
        // ---默认将电源的负极视为接地点---
        powerDevs.forEach(p => {
            const nIdx = this.portToCluster.get(`${p.id}_wire_n`);
            if (nIdx !== undefined) this.gndClusterIndices.add(nIdx);
        });

        if (!this._opAmpsInitialized) {
            opAmps.forEach(op => op.internalState = 'linear');
            this._opAmpsInitialized = true;
        }

        // ── 建立节点映射 ─────────────────────────────────────────────────
        const nodeMap = new Map();
        let mSize = 0;
        for (let i = 0; i < this.clusterCount; i++) {
            if (!this.gndClusterIndices.has(i) && !this.vPosMap.has(i)) nodeMap.set(i, mSize++);
        }
        if (mSize === 0) { this._assignKnown(); return; }

        // ── 统计额外电压源方程数（DC/AC/三相电源采用诺顿等效，不增加行数）─
        let pidEqCount = 0;
        pidDevs.forEach(pid => {
            if (this.portToCluster.has(`${pid.id}_wire_pi1`) && this.portToCluster.has(`${pid.id}_wire_ni1`)) pidEqCount++;
            if (this.portToCluster.has(`${pid.id}_wire_po1`) && this.portToCluster.has(`${pid.id}_wire_no1`)) pidEqCount++;
            if (this.portToCluster.has(`${pid.id}_wire_po2`) && this.portToCluster.has(`${pid.id}_wire_no2`)) pidEqCount++;
        });

        // ── AI 模块电压源方程数（CH1p 和 CH2p 各增加一个方程）─
        let aiEqCount = 0;
        aiDevs.forEach(ai => {
            if (!ai.powerOn) return;
            const p = `${ai.id}_wire_`;
            const c_ch1p = this.portToCluster.get(`${p}ch1p`);
            if (c_ch1p !== undefined) aiEqCount++;
            const c_ch2p = this.portToCluster.get(`${p}ch2p`);
            if (c_ch2p !== undefined) aiEqCount++;
            const c_can1p = this.portToCluster.get(`${p}can1p`);
            const c_can1n = this.portToCluster.get(`${p}can1n`);
            if (c_can1p !== undefined && c_can1n !== undefined) {
                aiEqCount++;
                aiEqCount++;
            }
        });
        let pcEqCount = 0;
        // 统计过程校验仪需要的额外方程
        pcDevs.forEach(pc => {
            if (!pc.isPowered) return;
            const p = `${pc.id}_wire_`;

            // 上排功能档位：MEAS_LOOP 需要 24V 电压源
            if (pc.upMode === 'MEAS_LOOP') {
                const cMa = this.portToCluster.get(`${p}meas_ma`);
                if (cMa !== undefined) {
                    pcEqCount++;  // 注入 24V 电压源
                }
            }

            // 输出面板下的 SOURCE_V, SOURCE_TC, SOURCE_HZ 模式需要电压源
            if (pc.activePanel === 'SOURCE') {
                if (['SRC_V', 'SRC_TC'].includes(pc.sourceMode)) {
                    const cSCom = this.portToCluster.get(`${p}src_com`);
                    if (cSCom !== undefined) {
                        pcEqCount++;  // 注入电压源
                    }
                }
            } else if (pc.activePanel === 'MEASURE') {
                if (pc.measureMode === 'MEAS_LOOP') {
                    const cSCom = this.portToCluster.get(`${p}src_com`);
                    if (cSCom !== undefined) {
                        pcEqCount++;  // 注入电压源
                    }
                }
            }
        });
        const totalSize = mSize + pidEqCount + opAmps.length + oscDevs.length + lvdtDevs.length + aiEqCount + pcEqCount;
        let results = new Float64Array(totalSize);

        const G = Array.from({ length: totalSize }, () => new Float64Array(totalSize));
        const B = new Float64Array(totalSize);

        // ── 构建传给 DeviceStamps 的上下文对象 ───────────────────────────
        const ctx = {
            portToCluster: this.portToCluster,
            nodeMap,
            gndClusterIndices: this.gndClusterIndices,
            vPosMap: this.vPosMap,
            clusters: this.clusters,
            getVoltageFromResults: (res, cIdx) =>
                CircuitUtils.getVoltageFromResults(res, nodeMap, this.gndClusterIndices, this.vPosMap, cIdx),
            getVoltageAtPort: (pId) => this.getVoltageAtPort(pId),
            getEquivalentResistance: (a, b, all) =>
                this._getEquivalentResistance(a, b, all),
            calcTransmitterCurrent: (dev) => this._calcTransmitterCurrent(dev),
        };

        // ── 迭代求解 ─────────────────────────────────────────────────────
        const maxIterations = 200;
        for (let iter = 0; iter < maxIterations; iter++) {
            for (let gi = 0; gi < totalSize; gi++) G[gi].fill(0);
            B.fill(0);

            // ── 各器件 stamp 注入（序号对应 DeviceStamps 中的 stamp 方法） ────
            // ─ 1. 电阻 ───────────────────────────────────────────────────
            DeviceStamps.stampResistors(ctx, G, B, resistorDevs);
            // ─ 2. 压力传感器 ──────────────────────────────────────────────
            DeviceStamps.stampPressureSensors(ctx, G, B, pressDevs);
            // ─ 3. 变送器 ───────────────────────────────────────────────────
            DeviceStamps.stampTransmitters(ctx, G, B, transmitterDevs);
            // ─ 4. 电源 & 5. 三相电源（诺顿等效注入，不增加方程）──────────
            DeviceStamps.stampPowerSources(ctx, G, B, powerDevs, 0, currentTime);
            DeviceStamps.stampPower3Sources(ctx, G, B, power3Devs, 0, currentTime);

            // ─ 6. PID 控制器 ──────────────────────────────────────────────
            let pidVIdx = mSize;
            DeviceStamps.stampPIDs(ctx, G, B, pidDevs, pidVIdx);

            // ─ 7. 热电偶（诺顿等效注入，不增加方程）──────────────────────
            DeviceStamps.stampThermocouples(ctx, G, B, tcDevs);
            // ─ 8. 运放 ─────────────────────────────────────────────────────
            const opVIdx = mSize + pidEqCount;
            DeviceStamps.stampOpAmps(ctx, G, B, opAmps, opVIdx);
            // ─ 9. 二极管 ───────────────────────────────────────────────────
            DeviceStamps.stampDiodes(ctx, G, B, diodeDevs, results);
            // ─ 10. BJT ────────────────────────────────────────────────────
            DeviceStamps.stampBJTs(ctx, G, B, bjtDevs, results);
            // ─ 11. JFET ───────────────────────────────────────────────────
            DeviceStamps.stampJFETs(ctx, G, B, jfetDevs, results);
            // ─ 12.1 & 12.2 电容 & 电感 ────────────────────────────────────
            DeviceStamps.stampReactives(ctx, G, B, capacitorDevs, this.deltaTime);
            DeviceStamps.stampReactives(ctx, G, B, inductorDevs, this.deltaTime);
            // ─ 13. 示波器 ──────────────────────────────────────────────────
            const oscVIdx = mSize + pidEqCount + opAmps.length;
            DeviceStamps.stampOscilloscopes(ctx, G, B, oscDevs, oscVIdx);
            // ─ 14. LVDT / 压力变送器 ───────────────────────────────────────
            const ptVIdx = oscVIdx + oscDevs.length;
            DeviceStamps.stampLVDTs(ctx, G, B, lvdtDevs, ptVIdx);
            // ─ 15. 信号发生器 ──────────────────────────────────────────────
            DeviceStamps.stampSignalGenerators(ctx, G, B, sgDevs, currentTime);
            // ─ 16 电压型继电器（线圈电阻） ────────────────────────────────
            DeviceStamps.stampRelays(ctx, G, B, relayDevs);
            // ─ 17 AI 模块 ────────────────────────────────────────────────
            const aiVIdx = ptVIdx + lvdtDevs.length;
            const pcVIdx = DeviceStamps.stampAI(ctx, G, B, aiDevs, aiVIdx);
            // ─ 18 过程校验仪 ───────────────────────────────────────────────
            DeviceStamps.stampCalibrators(ctx, G, B, pcDevs, pcVIdx,currentTime);


            // Gmin 防奇异
            for (let i = 0; i < totalSize; i++) G[i][i] += 1e-12;
            const nextResults = MNAMatrix.gauss(G, B);
            // 收敛检查
            let maxError = 0;
            for (let i = 0; i < totalSize; i++)
                maxError = Math.max(maxError, Math.abs(nextResults[i] - results[i]));

            // 阻尼更新
            nodeMap.forEach((mIdx, cIdx) => {
                const oldV = this.nodeVoltages.get(cIdx) || 0;
                const rawNewV = nextResults[mIdx];
                if (this.vPosMap.has(cIdx)) { this.nodeVoltages.set(cIdx, rawNewV); return; }

                const damping = 0.3;
                let nextV = oldV + damping * (rawNewV - oldV);
                const MAX_STEP = 0.5;
                const delta = nextV - oldV;
                if (Math.abs(delta) > MAX_STEP) nextV = oldV + MAX_STEP * Math.sign(delta);
                this.nodeVoltages.set(cIdx, nextV);
                nextResults[mIdx] = nextV;
            });

            // 运放状态切换
            let stateChanged = false;
            opAmps.forEach(op => {
                const cP = this.portToCluster.get(`${op.id}_wire_p`);
                const cN = this.portToCluster.get(`${op.id}_wire_n`);
                const cOut = this.portToCluster.get(`${op.id}_wire_OUT`);
                const vP = ctx.getVoltageFromResults(results, cP);
                const vN = ctx.getVoltageFromResults(results, cN);
                const vOutRaw = ctx.getVoltageFromResults(results, cOut);

                let newState = op.internalState;
                if (op.internalState === 'linear') {
                    if (vOutRaw > op.vPosLimit) newState = 'pos_sat';
                    else if (vOutRaw < op.vNegLimit) newState = 'neg_sat';
                } else {
                    const vDiff = vP - vN;
                    if (op.internalState === 'pos_sat' && vDiff < 0) newState = 'linear';
                    else if (op.internalState === 'neg_sat' && vDiff > 0) newState = 'linear';
                    else if ((cP === undefined && cN === undefined) || vDiff === 0) newState = 'linear';
                }
                if (op.internalState !== newState) { op.internalState = newState; stateChanged = true; }
            });

            results = nextResults;
            if (!stateChanged && maxError < 1e-6) break;
        }

        this._assignKnown();

        // ── 统一电流计算：所有设备电流都在 _updateDeviceCurrents 中计算 ───
        this._updateDeviceCurrents(this._cachedDevs, results);
    }

    // ── 统一计算所有设备的电流（取代原 CurrentReadback 阶段）────────────
    // 序号对应 DeviceStamps 中各 stamp 方法的顺序
    _updateDeviceCurrents(devices, results) {
        const {
            resistorDevs, pressDevs, transmitterDevs, pidDevs, tcDevs, opAmps,
            diodeDevs, bjtDevs, jfetDevs, capacitorDevs, inductorDevs,
            oscDevs, lvdtDevs, sgDevs, powerDevs, power3Devs, relayDevs, aiDevs,
            pcDevs,
        } = devices;

        // ─ 1. 电阻电流（对应 stampResistors）
        resistorDevs.forEach(dev => {
            if (dev.currentResistance < 0.1) return;
            const cL = this.portToCluster.get(`${dev.id}_wire_l`);
            const cR = this.portToCluster.get(`${dev.id}_wire_r`);
            const vL = this.nodeVoltages.get(cL) || 0;
            const vR = this.nodeVoltages.get(cR) || 0;
            dev.physCurrent = (vL - vR) / dev.currentResistance;
        });

        // ─ 2. 压力传感器电流（对应 stampPressureSensors）
        pressDevs.forEach(dev => {
            const c1l = this.portToCluster.get(`${dev.id}_wire_r1l`);
            const c1r = this.portToCluster.get(`${dev.id}_wire_r1r`);
            const c2l = this.portToCluster.get(`${dev.id}_wire_r2l`);
            const c2r = this.portToCluster.get(`${dev.id}_wire_r2r`);
            dev.r1Current = ((this.nodeVoltages.get(c1l) || 0) - (this.nodeVoltages.get(c1r) || 0)) / Math.max(0.001, dev.r1);
            dev.r2Current = ((this.nodeVoltages.get(c2l) || 0) - (this.nodeVoltages.get(c2r) || 0)) / Math.max(0.001, dev.r2);
        });

        // ─ 3. 变送器缓存压差（对应 stampTransmitters）
        transmitterDevs.forEach(dev => {
            const pV = this.getVoltageAtPort(`${dev.id}_wire_p`);
            const nV = this.getVoltageAtPort(`${dev.id}_wire_n`);
            dev._lastVDiff = pV - nV;
        });

        // ─ 4. 电源电流（对应 stampPowerSources）
        powerDevs.forEach(dev => {
            const cP = this.portToCluster.get(`${dev.id}_wire_p`);
            const cN = this.portToCluster.get(`${dev.id}_wire_n`);
            if (cP === undefined || cN === undefined) return;
            const vDiff = (this.nodeVoltages.get(cP) || 0) - (this.nodeVoltages.get(cN) || 0);
            const rOn = dev.rOn || 0.1;
            const voltage = dev.getValue(this.currentTime);
            dev.physCurrent = (voltage - vDiff) / rOn;
        });

        // ─ 5. 三相电源电流（对应 stampPower3Sources）
        power3Devs.forEach(dev => {
            dev.phaseCurrents = { u: 0, v: 0, w: 0 };
            ['u', 'v', 'w'].forEach(phase => {
                const cP = this.portToCluster.get(`${dev.id}_wire_${phase}`);
                const cN = this.portToCluster.get(`${dev.id}_wire_n`);
                if (cP === undefined || cN === undefined) return;
                const vDiff = (this.nodeVoltages.get(cP) || 0) - (this.nodeVoltages.get(cN) || 0);
                const rOn = dev.rOn || 0.1;
                const voltage = dev.getPhaseVoltage(phase, this.currentTime);
                dev.phaseCurrents[phase] = (voltage - vDiff) / rOn;
            });
        });

        // ─ 6. PID 电流（对应 stampPIDs）
        pidDevs.forEach(pid => {
            if (!pid.powerOn) return;
            if (pid._ch1CurrentInfo) {
                const info = pid._ch1CurrentInfo;
                if (info.mode === 'voltage') {
                    pid.ch1Current = Math.abs(results[info.index]) * 1000;
                } else {
                    pid.ch1Current = info.valueA * 1000;
                }
                pid._ch1CurrentInfo = null;
            } else if (pid.ch1VSourceIdx !== undefined) {
                pid.ch1Current = results[pid.ch1VSourceIdx] * 1000;
            }
            if (pid._ch2CurrentInfo) {
                const info = pid._ch2CurrentInfo;
                if (info.mode === 'voltage') {
                    pid.ch2Current = Math.abs(results[info.index]) * 1000;
                } else {
                    pid.ch2Current = info.valueA * 1000;
                }
                pid._ch2CurrentInfo = null;
            } else if (pid.ch2VSourceIdx !== undefined) {
                pid.ch2Current = results[pid.ch2VSourceIdx] * 1000;
            }
        });

        // ─ 7. 热电偶电流（对应 stampThermocouples）诺顿等效模型
        tcDevs.forEach(tc => {
            const cP = this.portToCluster.get(`${tc.id}_wire_r`);
            const cN = this.portToCluster.get(`${tc.id}_wire_l`);
            if (cP !== undefined && cN !== undefined) {
                const vDiff = (this.nodeVoltages.get(cP) || 0) - (this.nodeVoltages.get(cN) || 0);
                const rInt = tc.currentResistance || 0.5;
                const voltage = tc.currentVoltage;
                tc.physCurrent = (voltage - vDiff) / rInt;
            }
        });

        // ─ 8. 运放电流（对应 stampOpAmps）
        opAmps.forEach(op => {
            if (op.currentIdx !== undefined) op.outCurrent = results[op.currentIdx];
        });

        // ─ 9. 二极管电流（对应 stampDiodes）
        diodeDevs.forEach(dev => {
            const cA = this.portToCluster.get(`${dev.id}_wire_l`);
            const cC = this.portToCluster.get(`${dev.id}_wire_r`);
            const vA = this.nodeVoltages.get(cA) || 0;
            const vC = this.nodeVoltages.get(cC) || 0;
            const vDiff = vA - vC;
            const vForward = dev.vForward || 0.68;
            const rOn = dev.rOn || 0.5;
            dev.physCurrent = (vDiff > vForward) ? (1 / rOn) * (vDiff - vForward) : 0;
        });

        // ─ 10. BJT 电流（对应 stampBJTs）
        bjtDevs.forEach(dev => {
            const cB = this.portToCluster.get(`${dev.id}_wire_b`);
            const cC = this.portToCluster.get(`${dev.id}_wire_c`);
            const cE = this.portToCluster.get(`${dev.id}_wire_e`);
            const vB = this.nodeVoltages.get(cB) || 0;
            const vC = this.nodeVoltages.get(cC) || 0;
            const vE = this.nodeVoltages.get(cE) || 0;

            dev.physCurrents = { b: 0, c: 0, e: 0 };
            const model = dev.getCompanionModel(vB, vC, vE);
            const { gBE, iBE, beta, gCE_sat, pol, V_SAT } = model.internal;

            if (cB !== undefined && cE !== undefined && (cC === undefined || cC === cB)) {
                const vDiff = (vB - vE) * pol;
                const Ib = (vDiff > 0.7) ? 2 * (vDiff - 0.7) : 0;
                dev.physCurrents.b = Ib * pol;
                dev.physCurrents.e = -dev.physCurrents.b;
            } else if (cB !== undefined && cC !== undefined && (cE === undefined || cE === cB)) {
                const vDiff = (vB - vC) * pol;
                const Ib = (vDiff > 0.7) ? 2 * (vDiff - 0.7) : 0;
                dev.physCurrents.b = Ib * pol;
                dev.physCurrents.c = -dev.physCurrents.b;
            } else {
                const vbeLocal = (vB - vE) * pol;
                const vceLocal = (vC - vE) * pol;
                const Ib = pol * (gBE * vbeLocal + iBE);
                const Ic = (beta * Ib) + pol * (gCE_sat * (vceLocal - V_SAT));
                dev.physCurrents.b = Ib;
                dev.physCurrents.c = Ic;
                dev.physCurrents.e = -(Ib + Ic);
            }
        });

        // ─ 11. JFET 电流（对应 stampJFETs）
        jfetDevs.forEach(dev => {
            const cD = this.portToCluster.get(`${dev.id}_wire_d`);
            const cS = this.portToCluster.get(`${dev.id}_wire_s`);
            const vD = this.nodeVoltages.get(cD) || 0;
            const vS = this.nodeVoltages.get(cS) || 0;
            const res = dev.getDSResistance(vD - vS);
            dev.physCurrent = (vD - vS) / res;
        });

        // ─ 12.1 & 12.2 电容/电感（对应 stampReactives）
        capacitorDevs.forEach(dev => {
            const cL = this.portToCluster.get(`${dev.id}_wire_l`);
            const cR = this.portToCluster.get(`${dev.id}_wire_r`);
            const vL = this.nodeVoltages.get(cL) || 0;
            const vR = this.nodeVoltages.get(cR) || 0;
            dev.calculatePhysicalCurrent(vL, vR, this.deltaTime);
            dev.updateState(vL, vR);
        });

        inductorDevs.forEach(dev => {
            const cL = this.portToCluster.get(`${dev.id}_wire_l`);
            const cR = this.portToCluster.get(`${dev.id}_wire_r`);
            const vL = this.nodeVoltages.get(cL) || 0;
            const vR = this.nodeVoltages.get(cR) || 0;
            dev.calculatePhysicalCurrent(vL, vR, this.deltaTime);
            dev.updateState();
        });

        // ─ 13. 示波器电流（对应 stampOscilloscopes）
        oscDevs.forEach(dev => {
            if (dev.currentIdx !== undefined) dev.physCurrent = results[dev.currentIdx];
        });

        // ─ 14. LVDT/压力变送器电流（对应 stampLVDTs）
        lvdtDevs.forEach(dev => {
            if (dev.currentIdx !== undefined) dev.physCurrent = results[dev.currentIdx];
        });

        // ─ 15. 信号发生器电流（对应 stampSignalGenerators）
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
        // ─ 16 电压型继电器线圈电流（对应 stampRelays）
        relayDevs.forEach(dev => {
            const cL = this.portToCluster.get(`${dev.id}_wire_l`);
            const cR = this.portToCluster.get(`${dev.id}_wire_r`);
            if (cL !== undefined && cR !== undefined) {
                const vL = this.nodeVoltages.get(cL) || 0;
                const vR = this.nodeVoltages.get(cR) || 0;
                const R = dev.currentResistance || 1000;
                dev.physCurrent = (vL - vR) / R;
            }
        });

        // ─ 17. AI 模块电流（对应 stampAI）
        aiDevs.forEach(dev => {
            if (!dev.powerOn) return;
            const cP = this.portToCluster.get(`${dev.id}_wire_vcc`);
            const cN = this.portToCluster.get(`${dev.id}_wire_gnd`);
            if (cP === undefined || cN === undefined) return;
            const vDiff = (this.nodeVoltages.get(cP) || 0) - (this.nodeVoltages.get(cN) || 0);
            dev.physCurrent = vDiff / 50;

            // CH1 (4-20mA) - 读取电流（从 ch1p 到 ch1n 的电压差除以 250Ω 采样电阻）
            const c_ch1p = this.portToCluster.get(`${dev.id}_wire_ch1p`);
            const c_ch1n = this.portToCluster.get(`${dev.id}_wire_ch1n`);
            if (c_ch1p !== undefined && c_ch1n !== undefined) {
                const v_ch1n = this.nodeVoltages.get(c_ch1n) || 0;
                dev.ch1Current = v_ch1n / 250; // 250Ω 采样电阻，得到电流（A）
                dev.setRaw('ch1', dev.ch1Current * 1000); // 注入 CH1
            }
            else {
                dev.ch1Current = 0;
                dev.setRaw('ch1', 0); // 注入 CH1
            }

            // CH2 (4-20mA) - 读取电流（从 ch2p 到 ch2n 的电压差除以 250Ω 采样电阻）
            const c_ch2p = this.portToCluster.get(`${dev.id}_wire_ch2p`);
            const c_ch2n = this.portToCluster.get(`${dev.id}_wire_ch2n`);
            if (c_ch2p !== undefined && c_ch2n !== undefined) {
                const v_ch2n = this.nodeVoltages.get(c_ch2n) || 0;
                dev.ch2Current = v_ch2n / 250; // 250Ω 采样电阻
                dev.setRaw('ch2', dev.ch2Current * 1000); // 注入 CH2
            }
            else {
                dev.ch2Current = 0;
                dev.setRaw('ch2', 0); // 注入 CH2
            }
            // CH3 (RTD/PT100) - 读取电阻值
            const c_ch3p = this.portToCluster.get(`${dev.id}_wire_ch3p`);
            const c_ch3n = this.portToCluster.get(`${dev.id}_wire_ch3n`);
            if (c_ch3p !== undefined && c_ch3n !== undefined) {
                const v_ch3p = this.nodeVoltages.get(c_ch3p) || 0;
                const v_ch3n = this.nodeVoltages.get(c_ch3n) || 0;
                // 计算等效电阻：需要通过等效电阻计算接口
                const equiv_r = this._getEquivalentResistance(
                    this.clusters[c_ch3p], this.clusters[c_ch3n], this.clusters
                );
                dev.ch3Current = (v_ch3p - v_ch3n) / equiv_r;
                dev.setRaw('ch3', equiv_r); // 注入 CH3（Ω 为单位）
            }
            else {
                dev.ch3Current = 0
                dev.setRaw('ch3', 1000000); // 注入 CH3（Ω 为单位）
            }

            // CH4 (TC/热电偶) - 读取电压
            const c_ch4p = this.portToCluster.get(`${dev.id}_wire_ch4p`);
            const c_ch4n = this.portToCluster.get(`${dev.id}_wire_ch4n`);
            if (c_ch4p !== undefined && c_ch4n !== undefined) {
                const equiv_r = this._getEquivalentResistance(
                    this.clusters[c_ch4p], this.clusters[c_ch4n], this.clusters
                );
                if (equiv_r > 50) {
                    dev.setRaw('ch4', -100);
                }
                const v_ch4 = (this.nodeVoltages.get(c_ch4p) || 0) - (this.nodeVoltages.get(c_ch4n) || 0);
                const v_ch4_mV = v_ch4 * 1000; // 转换为 mV
                dev.setRaw('ch4', v_ch4_mV); // 注入 CH4（mV 为单位）
            }
            else {
                dev.setRaw('ch4', -100); // 注入 CH3（Ω 为单位）
            }

            // CAN 端口：当终端开关有效时，注入 120Ω 电阻
            const c_can1p = this.portToCluster.get(`${dev.id}_wire_can1p`);
            const c_can1n = this.portToCluster.get(`${dev.id}_wire_can1n`);
            const c_can2p = this.portToCluster.get(`${dev.id}_wire_can2p`);
            const c_can2n = this.portToCluster.get(`${dev.id}_wire_can2n`);

            if (dev.termEnabled) {
                if (c_can1p !== undefined && c_can1n !== undefined) {
                    // 终端电阻已通过 stampAI 在 G 矩阵中注入
                }
                if (c_can2p !== undefined && c_can2n !== undefined) {
                    // 终端电阻已通过 stampAI 在 G 矩阵中注入
                }
            }
        });
        // ─ 18. 过程校验仪电流（对应 stampCalibrators）根据不同模式计算电流
        pcDevs.forEach(dev => {
            if (!dev.isPowered) return;
            const p = `${dev.id}_wire_`;
            const cMa = this.portToCluster.get(`${p}meas_ma`);
            const cCom = this.portToCluster.get(`${p}meas_com`);
            const cSMa = this.portToCluster.get(`${p}src_ma`);
            const cSCom = this.portToCluster.get(`${p}src_com`);
            const cSV = this.portToCluster.get(`${p}src_v`);
            if (cMa !== undefined && cCom !== undefined) {
                if (dev.upMode === 'MEAS_LOOP') {
                    // MEAS_LOOP 模式：从 meas_ma 注入 24V 电压源，通过 meas_com 到 GND 的 250Ω 电阻                
                    const vCom = this.getVoltageAtPort(`${p}meas_com`);
                    const iMeas = vCom / 250;  // 通过采样电阻的电流
                    dev.upCurrent = iMeas;
                } else if (dev.upMode === 'MEAS_MA') {
                    // SRC_MA 模式：从 src_ma 注入设定电流，通过 src_com 到 GND 的 250Ω 电阻
                    const vMa = this.getVoltageAtPort(`${p}meas_ma`);
                    const vCom = this.getVoltageAtPort(`${p}meas_com`);
                    const iMeas = (vMa - vCom) / 250; // 转换为 A
                    dev.upCurrent = iMeas;
                } else {
                    dev.upCurrent = 0;
                }
            }
            else {
                dev.upCurrent = 0;
            }
            // 测量模式下的电流计算
            if (dev.activePanel === 'MEASURE') {
                // SRC_MA 模式：测量 src_ma 和 src_com 之间的电流（250Ω 内阻）
                if (cSMa !== undefined && cSCom !== undefined) {
                    if (dev.measureMode === 'SRC_MA') {
                        const vSMa = this.getVoltageAtPort(`${p}src_ma`);
                        const vSCom = this.getVoltageAtPort(`${p}src_com`);
                        const iMeas = (vSMa - vSCom) / 250;
                        dev.maCurrent = iMeas;
                    } else if (dev.measureMode === 'SRC_LOOP') {
                        // SRC_LOOP 模式：从 src_ma 注入 24V 电压源，通过 src_com 到 GND 的 250Ω 电阻                
                        const vSCom = this.getVoltageAtPort(`${p}src_com`);
                        const iMeas = vSCom / 250;  // 通过采样电阻的电流
                        dev.maCurrent = iMeas;
                    }
                } else {
                    dev.maCurrent = 0;
                }
                if (cSV !== undefined && cSCom !== undefined) {
                    if (dev.measureMode === 'SRC_RES' || dev.measureMode === 'SRC_RTD') {
                        // LOOP 模式：测量 meas_ma 和 meas_com 之间的电流（250Ω 内阻）
                        const vSV = this.getVoltageAtPort(`${p}src_v`);
                        const vSCom = this.getVoltageAtPort(`${p}src_com`);
                        const rMeas = this._getEquivalentResistance(
                            this.clusters[cSV], this.clusters[cSCom], this.clusters
                        );
                        const iMeas = (vSV - vSCom) / rMeas;
                        dev.vCurrent = iMeas;
                    } else {
                        dev.vCurrent = 0;
                    }
                } else {
                    dev.vCurrent = 0;
                }
            } else if (dev.activePanel === 'SOURCE') {
                if (cSMa !== undefined && cSCom !== undefined) {
                    switch (dev.sourceMode) {
                        case 'SRC_MA':
                            // 电流源模式：直接输出设定电流
                            dev.maCurrent = dev.sourceValue / 1000;  // 转换为 A
                            break;
                        case 'SRC_LOOP':
                            dev.maCurrent = dev.sourceValue / 1000;
                            break;
                        default:
                            dev.maCurrent = 0;
                            break;
                    }
                } else {
                    dev.vCurrent = 0;
                }
                if (cSV !== undefined && cSCom !== undefined) {
                    switch (dev.sourceMode) {
                        case 'SRC_V':
                            // 电压源模式：根据实际负载计算电流
                            if (cSV !== undefined && cSCom !== undefined) {
                                const vSrc = this.getVoltageAtPort(`${p}src_v`);
                                const vCom = this.getVoltageAtPort(`${p}src_com`);
                                const rLoad = this._getEquivalentResistance(
                                    this.clusters[cSV], this.clusters[cSCom], this.clusters
                                );
                                if (rLoad !== undefined && rLoad > 0.1) {
                                    dev.vCurrent = (vSrc - vCom) / rLoad;
                                } else {
                                    dev.vVCurrent = 0;
                                }
                            }
                            break;
                        case 'SRC_RES':
                            // 电阻模式：根据施加的电压和电阻值计算电流
                            if (cSV !== undefined && cSCom !== undefined) {
                                const vSrc = this.getVoltageAtPort(`${p}src_v`);
                                const vCom = this.getVoltageAtPort(`${p}src_com`);
                                const res = Math.max(0.1, dev.sourceValue);
                                dev.vCurrent = (vSrc - vCom) / res;
                            }
                            break;
                        default:
                            // 频率模拟：通常注入的是脉冲信号，计算平均电流
                            dev.vCurrent = 0;
                            break;
                    }
                } else {
                    dev.vCurrent = 0;
                }

            }
        });

    }

    // ═══════════════════════════════════════════════════════════════════════
    // 公开辅助方法（供 InstrumentUpdater / DeviceStamps 回调使用）
    // ═══════════════════════════════════════════════════════════════════════
    getVoltageFromResults(results, nodeMap, clusterIdx) {
        return CircuitUtils.getVoltageFromResults(results, nodeMap, this.gndClusterIndices, this.vPosMap, clusterIdx);
    }

    getVoltageAtPort(pId) {
        return CircuitUtils.getVoltageAtPort(pId, this.portToCluster, this.nodeVoltages);
    }

    getPD(pA, pB) {
        return CircuitUtils.getPD(pA, pB, this.portToCluster, this.nodeVoltages);
    }

    isPortConnected(pA, pB) {
        return CircuitUtils.isPortConnected(pA, pB, this.portToCluster);
    }

    _getEquivalentResistance(startCluster, endCluster, allClusters) {
        return CircuitUtils.getEquivalentResistance(
            startCluster, endCluster, allClusters,
            this.rawDevices, this.portToCluster, this._equivResCache
        );
    }

    _getParallelResistanceBetweenClusters(clusterA, clusterB) {
        return CircuitUtils.getParallelResistanceBetweenClusters(clusterA, clusterB, this.rawDevices);
    }

    _calcTransmitterCurrent(dev) {
        return CircuitUtils.calcTransmitterCurrent(dev, this.portToCluster, this.nodeVoltages, this.rawDevices);
    }

    _assignKnown() {
        this.gndClusterIndices.forEach(idx => this.nodeVoltages.set(idx, 0));
        this.vPosMap.forEach((v, idx) => this.nodeVoltages.set(idx, v));
    }

    // ── 电流表辅助（保留在主类，因为需要访问 connections 等内部状态）────
    _calculateBranchCurrent(dev) {
        let portP = `${dev.id}_wire_p`;
        let portN = `${dev.id}_wire_n`;
        if (dev.type === 'multimeter') { portP = `${dev.id}_wire_ma`; portN = `${dev.id}_wire_com`; }

        const pFuncDevs = this._getConnectedFunctionalDevices(portP, dev.id);
        const nFuncDevs = this._getConnectedFunctionalDevices(portN, dev.id);

        // 现在只有 GND 是理想电源，DC/AC/三相电源都是诺顿等效可直接获取电流
        const pHasSource = pFuncDevs.some(d => d.device.type === 'gnd');

        if (pHasSource) {
            let iInN = 0;
            nFuncDevs.forEach(item => { iInN += this._getPhysicalFlowIntoPort(item.device, item.extPort); });
            return -iInN;
        } else {
            let iInP = 0;
            pFuncDevs.forEach(item => { iInP += this._getPhysicalFlowIntoPort(item.device, item.extPort); });
            return iInP;
        }
    }

    _getPhysicalFlowIntoPort(dev, extPort) {
        // ─ 1. 电阻电流 + 12. 电容/电感电流（对应 stampResistors + stampReactives）
        if (dev.type === 'resistor' || dev.type === 'capacitor' || dev.type === 'inductor') {
            const total = dev.physCurrent || 0;
            return extPort.endsWith('_l') ? -total : total;
        }
        // ─ 16 电压型继电器线圈电流（对应 stampRelays）
        if (dev.type === 'relay' && dev.special === 'voltage') {
            const i = dev.physCurrent || 0;
            if (extPort.endsWith('_l')) return -i;
            if (extPort.endsWith('_r')) return i;
            return 0;
        }
        // ─ 2. 压力传感器电流（对应 stampPressureSensors）
        if (dev.type === 'pressure_sensor') {
            if (extPort.endsWith('_r1l')) return -(dev.r1Current || 0);
            if (extPort.endsWith('_r1r')) return (dev.r1Current || 0);
            if (extPort.endsWith('_r2l')) return -(dev.r2Current || 0);
            if (extPort.endsWith('_r2r')) return (dev.r2Current || 0);
            return 0;
        }

        // ─ 3. 变送器缓存压差（对应 stampTransmitters）
        if (dev.type === 'transmitter_2wire') {
            const i = (dev._lastVDiff > 10) ? (dev._lastVDiff * (dev._lastG || 0)) : 0;
            if (extPort.endsWith('_n')) return i;
            if (extPort.endsWith('_p')) return -i;
            return 0;
        }
        // ─ 4. & 5. 电源电流（对应 stampPowerSources & stampPower3Sources）
        // DC/AC/三相电源：诺顿等效（电流源+内阻）直接从已计算的 physCurrent 获取
        if (dev.type === 'source' || dev.type === 'ac_source') {
            const i = dev.physCurrent || 0;
            if (extPort.endsWith('_p')) return i;
            if (extPort.endsWith('_n')) return -i;
            return 0;
        }
        if (dev.type === 'source_3p') {
            const phase = extPort.includes('_u') ? 'u' : extPort.includes('_v') ? 'v' : 'w';
            const i = (dev.phaseCurrents && dev.phaseCurrents[phase]) || 0;
            if (extPort.includes('_' + phase)) return i;
            if (extPort.endsWith('_n')) return -i;
            return 0;
        }
        // ─ 6. PID 电流（对应 stampPIDs）
        if (dev.type === 'PID') {
            if (extPort.endsWith('_po1') || extPort.endsWith('_no1')) {
                if (dev.outModes.CH1 === '4-20mA') {
                    const cPo1 = this.portToCluster.get(`${dev.id}_wire_po1`);
                    const cNo1 = this.portToCluster.get(`${dev.id}_wire_no1`);
                    const vDiff = (this.nodeVoltages.get(cPo1) || 0) - (this.nodeVoltages.get(cNo1) || 0);
                    const req = (cPo1 !== undefined && cNo1 !== undefined)
                        ? this._getEquivalentResistance(this.clusters[cPo1], this.clusters[cNo1], this.clusters) : Infinity;
                    if (cPo1 === undefined || cNo1 === undefined || req > 100000) return 0;
                    const i = (vDiff > 23.49) ? vDiff / req : dev.output1mA / 1000;
                    return extPort.endsWith('_po1') ? i : -i;
                } else if (dev.outModes.CH1 === 'PWM') {
                    const i = dev.ch1Current || 0;
                    return extPort.endsWith('_po1') ? -i : i;
                }
            }
            if (extPort.endsWith('_po2') || extPort.endsWith('_no2')) {
                if (dev.outModes.CH2 === '4-20mA') {
                    const cPo2 = this.portToCluster.get(`${dev.id}_wire_po2`);
                    const cNo2 = this.portToCluster.get(`${dev.id}_wire_no2`);
                    const vDiff = (this.nodeVoltages.get(cPo2) || 0) - (this.nodeVoltages.get(cNo2) || 0);
                    const req = (cPo2 !== undefined && cNo2 !== undefined)
                        ? this._getEquivalentResistance(this.clusters[cPo2], this.clusters[cNo2], this.clusters) : Infinity;
                    if (cPo2 === undefined || cNo2 === undefined || req > 100000) return 0;
                    const i = (vDiff > 23.49) ? vDiff / req : dev.output2mA / 1000;
                    return extPort.endsWith('_po2') ? i : -i;
                } else if (dev.outModes.CH2 === 'PWM') {
                    const i = dev.ch2Current || 0;
                    return extPort.endsWith('_po2') ? -i : i;
                }
            }
            if (extPort.endsWith('_pi1') || extPort.endsWith('_ni1')) {
                const vNi = this.getVoltageAtPort(`${dev.id}_wire_ni1`);
                const iLoop = vNi / 250;
                return extPort.endsWith('_pi1') ? iLoop : -iLoop;
            }
            if (extPort.endsWith('_vcc') || extPort.endsWith('_gnd')) {
                const vcc = this.getVoltageAtPort(`${dev.id}_wire_vcc`);
                const iLoop = vcc / 50;
                return extPort.endsWith('_vcc') ? -iLoop : iLoop;
            }
            return 0;
        }
        // ─ 7. 热电偶电流（
        if (dev.type === 'tc') {
            if (!this.portToCluster.get(`${dev.id}_wire_l`) || !this.portToCluster.get(`${dev.id}_wire_r`)) return 0;
            const current = dev.physCurrent || 0;
            return extPort.endsWith('_l') ? -current : current;
        }
        // ─ 8. 运放电流（对应 stampOpAmps）
        if (dev.type === 'amplifier') {
            if (extPort.endsWith('_p') || extPort.endsWith('_n')) return 0;
            if (extPort.endsWith('_OUT')) return -dev.outCurrent || 0;
        }
        // ─ 9. 二极管电流（对应 stampDiodes）
        if (dev.type === 'diode') {
            if (!this.portToCluster.get(`${dev.id}_wire_l`) || !this.portToCluster.get(`${dev.id}_wire_r`)) return 0;
            const current = dev.physCurrent || 0;
            return extPort.endsWith('_l') ? -current : current;
        }
        // ─ 10. BJT 电流（对应 stampBJTs）
        if (dev.type === 'bjt') {
            if (!dev.physCurrents) return 0;
            if (extPort.endsWith('_b')) return -dev.physCurrents.b;
            if (extPort.endsWith('_c')) return -dev.physCurrents.c;
            if (extPort.endsWith('_e')) return -dev.physCurrents.e;
        }
        // ─ 11. JFET 电流（对应 stampJFETs）
        if (dev.type === 'njfet') {
            const i = dev.physCurrent || 0;
            if (extPort.endsWith('_d')) return -i;
            if (extPort.endsWith('_s')) return i;
            if (extPort.endsWith('_g')) return 0;
            return 0;
        }
        if (dev.type === 'oscilloscope_tri') return 0;
        // ─ 13. 示波器电流（对应 stampOscilloscopes）
        if (dev.type === 'oscilloscope') {
            const i = dev.physCurrent || 0;
            if (extPort.endsWith('_l')) return i;
            if (extPort.endsWith('_r')) return -i;
            return 0;
        }
        // ─ 14. LVDT/压力变送器电流（对应 stampLVDTs）
        if (dev.type === 'pressure_transducer') {
            const i = dev.physCurrent || 0;
            if (extPort.endsWith('_outp')) return -i;
            if (extPort.endsWith('_outn')) return i;
            if (extPort.endsWith('_p') || extPort.endsWith('_n')) {
                const cP = this.portToCluster.get(`${dev.id}_wire_p`);
                const cN = this.portToCluster.get(`${dev.id}_wire_n`);
                const iIn = ((this.nodeVoltages.get(cP) || 0) - (this.nodeVoltages.get(cN) || 0)) * 1e-9;
                return extPort.endsWith('_p') ? -iIn : iIn;
            }
            return 0;
        }
        // ─ 15. 信号发生器电流（对应 stampSignalGenerators）
        if (dev.type === 'signal_generator') {
            if (extPort.endsWith('_ch1p')) return dev.ch1Current || 0;
            if (extPort.endsWith('_ch1n')) return -(dev.ch1Current || 0);
            if (extPort.endsWith('_ch2p')) return dev.ch2Current || 0;
            if (extPort.endsWith('_ch2n')) return -(dev.ch2Current || 0);
            return 0;
        }
        // ─ 17. AI模块（对应 stampAI）
        if (dev.type === 'AI') {
            if (extPort.endsWith('_ch1p')) return dev.ch1Current || 0;
            if (extPort.endsWith('_ch1n')) return -(dev.ch1Current || 0);
            if (extPort.endsWith('_ch2p')) return dev.ch2Current || 0;
            if (extPort.endsWith('_ch2n')) return -(dev.ch2Current || 0);
            if (extPort.endsWith('_ch3p')) return dev.ch3Current || 0;
            if (extPort.endsWith('_ch3n')) return -(dev.ch3Current || 0);
            if (extPort.endsWith('_vcc')) return -dev.physCurrent || 0;
            if (extPort.endsWith('_gnd')) return (dev.physCurrent || 0);
            return 0;
        }
        // ─ 18. 过程校验仪（对应 stampCalibrators）
        if (dev.type === 'calibrator') {
            // 上面板
            if (dev.upMode === 'MEAS_LOOP' || dev.upMode === 'MEAS_MA') {
                const iMeas = dev.upCurrent || 0;
                if (extPort.endsWith('_meas_ma')) return iMeas;
                if (extPort.endsWith('_meas_com')) return -iMeas;
            } 
            // 下面板
            if (dev.activePanel === 'MEASURE') {
                // SRC_MA 模式：测量 src_ma 和 src_com 之间的电流
                if (dev.measureMode === 'MEAS_MA' || dev.measureMode === 'MEAS_LOOP') {
                    const iMeas = dev.maCurrent || 0;
                    if (extPort.endsWith('_src_ma')) return iMeas;
                    if (extPort.endsWith('_src_com')) return -iMeas;
                } else if (dev.measureMode === 'MEAS_RES' || dev.measureMode === 'MEAS_RTD') {
                    const iMeas = dev.vCurrent || 0;
                    if (extPort.endsWith('_src_v')) return iMeas;
                    if (extPort.endsWith('_src_com')) return -iMeas;
                }
            } else if (dev.activePanel === 'SOURCE') {
                if (dev.sourceMode === 'SRC_MA' || dev.sourceMode === 'SRC_LOOP') {
                    const iMeas = dev.maCurrent || 0;
                    if (extPort.endsWith('_src_ma')) return iMeas;
                    if (extPort.endsWith('_src_com')) return -iMeas;
                } else if (dev.sourceMode === 'SRC_RES' || dev.sourceMode === 'SRC_RTD') {
                    const iMeas = dev.vCurrent || 0;
                    if (extPort.endsWith('_src_v')) return iMeas;
                    if (extPort.endsWith('_src_com')) return -iMeas;
                }
            }
            return 0;
        }
        return 0;
    }

    _getConnectedFunctionalDevices(meterPort, meterId) {
        const found = [];
        const visitedPorts = new Set();
        const queue = [meterPort];
        const processedDevs = new Set();
        const devMap = new Map();
        this.rawDevices.forEach(d => devMap.set(d.id, d));

        while (queue.length > 0) {
            const curr = queue.shift();
            if (visitedPorts.has(curr)) continue;
            visitedPorts.add(curr);

            this.connections.forEach(conn => {
                if (conn.from === curr) queue.push(conn.to);
                else if (conn.to === curr) queue.push(conn.from);
            });

            const devId = curr.split('_wire_')[0];
            const dev = devMap.get(devId);
            if (!dev || dev.id === meterId) continue;

            const isFunctional =
                (dev.type === 'resistor' && dev.currentResistance > 0.1) ||
                dev.type === 'source' || dev.type === 'ac_source' || dev.type === 'source_3p' ||
                dev.type === 'gnd' || dev.type === 'transmitter_2wire' || dev.type === 'PID' ||
                dev.type === 'diode' || dev.type === 'bjt' || dev.type === 'njfet' ||
                dev.type === 'amplifier' || dev.type === 'signal_generator' ||
                dev.type === 'pressure_transducer' || dev.type === 'pressure_sensor' ||
                dev.type === 'oscilloscope' || dev.type === 'oscilloscope_tri' ||
                dev.type === 'capacitor' || dev.type === 'inductor' ||
                dev.type === 'AI' || dev.type === 'calibrator';

            if (isFunctional) { found.push({ device: dev, extPort: curr }); continue; }

            if (!processedDevs.has(dev.id)) {
                processedDevs.add(dev.id);
                const prefix = `${dev.id}_wire_`;
                const currCluster = this.portToCluster.get(curr);
                for (const [activePort] of this.portToCluster.entries()) {
                    if (!activePort.startsWith(prefix) || activePort === curr) continue;
                    const otherCluster = this.portToCluster.get(activePort);
                    if (currCluster !== undefined && otherCluster === currCluster) queue.push(activePort);
                }
            }
        }
        return found;
    }

    // MNAMatrix 委托（供外部/测试访问）
    _fillMatrix(G, B, nodeMap, c1, c2, g) {
        MNAMatrix.fillMatrix(G, B, nodeMap, this.gndClusterIndices, this.vPosMap, c1, c2, g);
    }
    _addVoltageSourceToMNA(G, B, nodeMap, c1, c2, voltage, vIdx) {
        MNAMatrix.addVoltageSource(G, B, nodeMap, this.gndClusterIndices, this.vPosMap, c1, c2, voltage, vIdx);
    }
    _addCurrentSourceToMNA(B, nodeMap, cPos, cNeg, current) {
        MNAMatrix.addCurrentSource(B, nodeMap, cPos, cNeg, current);
    }
    _gauss(A, b) {
        return MNAMatrix.gauss(A, b);
    }
}
