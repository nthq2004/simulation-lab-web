/**
 * InstrumentUpdater.js
 * 仪表更新：电流表、万用表、变送器显示、PID 显示、示波器、监控器等
 */

export class InstrumentUpdater {
    /**
     * @param {object} solver  CircuitSolver 实例（用于访问 portToCluster / nodeVoltages / clusters 等）
     */
    constructor(solver) {
        this.solver = solver;
    }

    update() {
        const s = this.solver;
        s.rawDevices.forEach(dev => {
            this._updateAmpmeter(dev);
            this._updateMultimeter(dev);
            this._updateTransmitterDisplay(dev);
            this._updatePIDDisplay(dev);
            this._updateMonitor(dev);
            this._updateOscilloscope(dev);
            this._updateOscilloscopeTri(dev);
        });
    }

    // ─── 电流表 ──────────────────────────────────────────────────────────
    _updateAmpmeter(dev) {
        const s = this.solver;
        if (dev.type !== 'ampmeter' && !(dev.type === 'multimeter' && dev.mode === 'MA')) return;

        const pId = dev.type === 'ampmeter' ? `${dev.id}_wire_p` : `${dev.id}_wire_ma`;
        const nId = dev.type === 'ampmeter' ? `${dev.id}_wire_n` : `${dev.id}_wire_com`;
        const pIndex = s.portToCluster.get(pId);
        const nIndex = s.portToCluster.get(nId);

        if (pIndex === undefined || nIndex === undefined) { dev.update(0); return; }

        const current = s._calculateBranchCurrent(dev);
        dev.update(current * 1000);
    }

    // ─── 万用表 ───────────────────────────────────────────────────────────
    _updateMultimeter(dev) {
        if (dev.type !== 'multimeter') return;
        const s = this.solver;
        const mode = dev.mode || 'OFF';

        // 电压档
        if (mode.startsWith('DCV')) {
            let diff = 0;
            const vIdx = s.portToCluster.get(`${dev.id}_wire_v`);
            const comIdx = s.portToCluster.get(`${dev.id}_wire_com`);
            if (vIdx !== undefined && comIdx !== undefined)
                diff = s.getPD(`${dev.id}_wire_v`, `${dev.id}_wire_com`);
            dev.update(diff);
        }
        // 电阻档
        else if (mode.startsWith('RES')) {
            dev.update(this._measureResistance(dev));
        }
        // 二极管档
        else if (mode === 'DIODE') {
            dev.update(this._measureDiode(dev));
        }
        // 电容档
        else if (mode === 'C') {
            dev.update(this._measureCapacitance(dev));
        }
        // 交流电压档
        else if (mode.startsWith('ACV')) {
            this._updateACV(dev);
        }
    }

    _measureResistance(dev) {
        const s = this.solver;
        const comNode = `${dev.id}_wire_com`;
        const vNode = `${dev.id}_wire_v`;
        const comIdx = s.portToCluster.get(comNode);
        const vIdx = s.portToCluster.get(vNode);

        let R = Infinity;
        if (comIdx !== undefined && vIdx !== undefined && Math.abs(s.getPD(vNode, comNode)) < 0.1) {
            R = s._getEquivalentResistance(s.clusters[comIdx], s.clusters[vIdx], s.clusters);

            // BJT 模拟：检测是否接了三极管
            const bjtDevs = s.rawDevices.filter(d => d.type === 'bjt');
            bjtDevs.forEach(t => {
                const bIdx = s.portToCluster.get(`${t.id}_wire_b`);
                const cIdx = s.portToCluster.get(`${t.id}_wire_c`);
                const eIdx = s.portToCluster.get(`${t.id}_wire_e`);
                const isNPN = (t.subType === 'NPN');
                let isTargetPair = false, controlRes = Infinity;

                if (isNPN) {
                    if (vIdx === cIdx && comIdx === eIdx) {
                        isTargetPair = true;
                        controlRes = s._getEquivalentResistance(s.clusters[bIdx], s.clusters[cIdx], s.clusters);
                    }
                } else {
                    if (vIdx === eIdx && comIdx === cIdx) {
                        isTargetPair = true;
                        controlRes = s._getEquivalentResistance(s.clusters[bIdx], s.clusters[cIdx], s.clusters);
                    }
                }
                if (isTargetPair && controlRes !== Infinity) {
                    const seed = Math.floor(controlRes);
                    const pseudoRandom = Math.abs(Math.sin(seed));
                    const factor = 6 + (pseudoRandom * 3);
                    R = Math.min(R, Math.max(5000, controlRes * factor));
                }
            });
        }
        return R === Infinity ? 10000000 : R;
    }

    _measureDiode(dev) {
        const s = this.solver;
        const vNode = `${dev.id}_wire_v`;
        const comNode = `${dev.id}_wire_com`;
        const vIdx = s.portToCluster.get(vNode);
        const comIdx = s.portToCluster.get(comNode);
        if (vIdx === undefined || comIdx === undefined) return 10000000;

        let R = Infinity;
        const vCluster = s.clusters[vIdx];
        const comCluster = s.clusters[comIdx];

        // 查找普通二极管
        const diodeDevs = (s._cachedDevs && s._cachedDevs.diodeDevs) || s.rawDevices.filter(d => d.type === 'diode');
        const isDiode = diodeDevs.find(d => {
            const dA = s.portToCluster.get(`${d.id}_wire_l`);
            const dC = s.portToCluster.get(`${d.id}_wire_r`);
            return (vIdx === dA && comIdx === dC);
        });

        if (isDiode) return 0.6868;

        // 查找三极管 PN 结
        const transistorDevs = s.rawDevices.filter(d => d.type === 'bjt');
        const triodeMatch = transistorDevs.find(t => {
            const b = s.portToCluster.get(`${t.id}_wire_b`);
            const c = s.portToCluster.get(`${t.id}_wire_c`);
            const e = s.portToCluster.get(`${t.id}_wire_e`);
            const isNPN = (t.subType === 'NPN');
            const isBasePositive = isNPN ? (vIdx === b) : (comIdx === b);

            if (isBasePositive) {
                if (isNPN ? (comIdx === e) : (vIdx === e)) { R = 0.6868; return true; }
                if (isNPN ? (comIdx === c) : (vIdx === c)) { R = 0.6767; return true; }
            }
            return false;
        });

        if (!triodeMatch && Math.abs(s.getPD(vNode, comNode)) < 0.1) {
            R = s._getEquivalentResistance(vCluster, comCluster, s.clusters);
        }
        return R === Infinity ? 10000000 : R;
    }

    _measureCapacitance(dev) {
        const s = this.solver;
        const vIdx = s.portToCluster.get(`${dev.id}_wire_v`);
        const comIdx = s.portToCluster.get(`${dev.id}_wire_com`);
        if (vIdx === undefined || comIdx === undefined) return 0;

        const caps = (s._cachedDevs && s._cachedDevs.capacitorDevs) || s.rawDevices.filter(d => d.type === 'capacitor');
        const targetCap = caps.find(d => {
            const dL = s.portToCluster.get(`${d.id}_wire_l`);
            const dR = s.portToCluster.get(`${d.id}_wire_r`);
            return (vIdx === dL && comIdx === dR) || (vIdx === dR && comIdx === dL);
        });
        return targetCap ? targetCap.capacitance * 1000000 : 0;
    }

    _updateACV(dev) {
        const s = this.solver;
        const vNode = `${dev.id}_wire_v`;
        const comNode = `${dev.id}_wire_com`;
        const vDiff = s.getPD(vNode, comNode);

        if (dev._sampleTimer === undefined) dev._sampleTimer = 0;
        if (dev._maxV === undefined) dev._maxV = 0;

        dev._maxV = Math.max(dev._maxV, Math.abs(vDiff));
        dev._sampleTimer += s.deltaTime;

        const HALF_PERIOD = 0.01;
        if (dev._sampleTimer >= 2 * HALF_PERIOD) {
            const rms = dev._maxV / 1.414;
            dev._displayRMS = rms < 0.01 ? 0 : rms;
            dev.update(dev._displayRMS);
            dev._sampleTimer = 0;
            dev._maxV = 0;
        }
    }

    // ─── 变送器显示 ───────────────────────────────────────────────────────
    _updateTransmitterDisplay(dev) {
        if (dev.type !== 'transmitter_2wire') return;
        const s = this.solver;
        const cP = s.portToCluster.get(`${dev.id}_wire_p`);
        const cN = s.portToCluster.get(`${dev.id}_wire_n`);
        dev.update({
            powered: dev._lastVDiff > 10 && cP !== undefined && cN !== undefined,
            transCurrent: s._calcTransmitterCurrent(dev) * 1000
        });
    }

    // ─── PID 输入电流显示 ─────────────────────────────────────────────────
    _updatePIDDisplay(dev) {
        if (dev.type !== 'PID') return;
        const s = this.solver;
        const inI = Math.abs(s.getVoltageAtPort(`${dev.id}_wire_ni1`) / 250);
        dev.update(inI * 1000);
    }

    // ─── 监控器（Monitor）────────────────────────────────────────────────
    _updateMonitor(dev) {
        if (dev.type !== 'monitor') return;
        const s = this.solver;
        const pid = s.sys.comps.pid;

        const monA = s.portToCluster.get(`${dev.id}_wire_a1`);
        const monB = s.portToCluster.get(`${dev.id}_wire_b1`);
        const pidA = s.portToCluster.get(`${pid.id}_wire_a1`);
        const pidB = s.portToCluster.get(`${pid.id}_wire_b1`);

        const isCommunicating = monA !== undefined && monB !== undefined &&
            monA === pidA && monB === pidB && pid.powerOn;

        if (!isCommunicating) {
            dev.update({ pv: 0, sv: 0, out1: 0, out2: 0,
                fault: { transmitter: null, ovenTemp: false, pidOutput1: false, pidOutput2: false, communication: true } });
            return;
        }

        const inputCurrentMA = Math.abs(s.getVoltageAtPort(`${pid.id}_wire_ni1`) / 250) * 1000;
        let vOut1 = s.getPD(`${pid.id}_wire_po1`, `${pid.id}_wire_no1`);
        let vOut2 = s.getPD(`${pid.id}_wire_po2`, `${pid.id}_wire_no2`);

        let transFault = null;
        if (inputCurrentMA >= 21.0)                            transFault = 'OPEN';
        else if (inputCurrentMA <= 3.8 && inputCurrentMA > 0.5) transFault = 'SHORT';
        else if (inputCurrentMA <= 0.5)                        transFault = 'LOOP_BREAK';

        const mode1 = pid.outModes.CH1;
        const mode2 = pid.outModes.CH2;
        const p1Idx = s.portToCluster.get(`${pid.id}_wire_po1`);
        const n1Idx = s.portToCluster.get(`${pid.id}_wire_no1`);
        const p2Idx = s.portToCluster.get(`${pid.id}_wire_po2`);
        const n2Idx = s.portToCluster.get(`${pid.id}_wire_no2`);

        let out1Fault = false, out2Fault = false;
        if (mode1 === '4-20mA') {
            out1Fault = Math.abs(vOut1) < 0.1 || Math.abs(vOut1) > 23;
            vOut1 = pid.OUT;
        } else {
            out1Fault = (p1Idx !== undefined && n1Idx !== undefined)
                ? s._getEquivalentResistance(s.clusters[p1Idx], s.clusters[n1Idx], s.clusters) > 10000
                : true;
            vOut1 = vOut1 * 4.16;
        }
        if (mode2 === '4-20mA') {
            out2Fault = Math.abs(vOut2) < 0.1 || Math.abs(vOut2) > 23;
            vOut2 = pid.OUT;
        } else {
            out2Fault = (p2Idx !== undefined && n2Idx !== undefined)
                ? s._getEquivalentResistance(s.clusters[p2Idx], s.clusters[n2Idx], s.clusters) > 10000
                : true;
            vOut2 = vOut2 * 4.16;
        }

        dev.update({
            pv: pid.PV > 0 ? pid.PV : 0,
            sv: pid.SV,
            out1: pid.outSelection === 'CH1' || pid.outSelection === 'BOTH' ? vOut1 : 0,
            out2: pid.outSelection === 'CH2' || pid.outSelection === 'BOTH' ? vOut2 : 0,
            fault: {
                transmitter: transFault,
                ovenTemp: pid.PV >= pid.alarm.HH,
                pidOutput1: (out1Fault || pid.out1Fault) && (pid.outSelection === 'CH1' || pid.outSelection === 'BOTH'),
                pidOutput2: (out2Fault || pid.out2Fault) && (pid.outSelection === 'CH2' || pid.outSelection === 'BOTH'),
                communication: false
            }
        });
    }

    // ─── 单通道示波器 ─────────────────────────────────────────────────────
    _updateOscilloscope(dev) {
        if (dev.type !== 'oscilloscope') return;
        const s = this.solver;
        const cVH = s.portToCluster.get(`${dev.id}_wire_p`);
        const cVL = s.portToCluster.get(`${dev.id}_wire_n`);
        const vDiff = (s.nodeVoltages.get(cVH) || 0) - (s.nodeVoltages.get(cVL) || 0);
        const iVal = dev.physCurrent || 0;
        dev.updateTrace(vDiff, iVal, s.globalIterCount);
    }

    // ─── 三通道示波器 ─────────────────────────────────────────────────────
    _updateOscilloscopeTri(dev) {
        if (dev.type !== 'oscilloscope_tri') return;
        const s = this.solver;
        const channels = [
            { p: 'ch1p', n: 'ch1n' },
            { p: 'ch2p', n: 'ch2n' },
            { p: 'ch3p', n: 'ch3n' }
        ];
        const vDiffs = channels.map(ch => {
            const clusP = s.portToCluster.get(`${dev.id}_wire_${ch.p}`);
            const clusN = s.portToCluster.get(`${dev.id}_wire_${ch.n}`);
            return (s.nodeVoltages.get(clusP) || 0) - (s.nodeVoltages.get(clusN) || 0);
        });
        dev.updateTrace(vDiffs, s.globalIterCount);
    }
}
