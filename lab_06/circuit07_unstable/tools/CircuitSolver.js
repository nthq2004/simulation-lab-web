/**
 * CircuitSolver.js  V4.0 (模块化重构版)
 *
 * 模块结构：
 *   CircuitTopology    — 并查集拓扑构建
 *   MNAMatrix          — 矩阵底层操作（填充、求解、电压源/电流源注入）
 *   DeviceStamps       — 各器件 MNA stamp
 *   CircuitUtils       — 等效电阻、电压辅助方法
 *   _updateDeviceCurrents — 求解后所有设备电流统一计算
 */

import { CircuitTopology } from './CircuitTopology.js';
import { MNAMatrix } from './MNAMatrix.js';
import { DeviceStamps } from './DeviceStamps.js';
import { CircuitUtils } from './CircuitUtils.js';

export class CircuitSolver {
    constructor(sys) {
        this.sys = sys;
        this.deltaTime = 0.5 / 1000; // 0.5ms 步长
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

        // ── 设备分组缓存（类型在构造后不变，避免每帧重复 filter）──
        this._deviceCache = this._buildDeviceCache();
        this.lastIterCount = 0;

        // ── 矩阵池（避免每帧重新分配 G/B，仅 totalSize 增长时扩容）──
        this._poolG = null;
        this._poolB = null;
        this._poolResults = null;
        this._poolTotalSize = 0;


    }

    /**
     * 确保矩阵池容量 ≥ n
     */
    _ensureMatrixPool(n) {
        if (this._poolTotalSize >= n) return;
        this._poolG = Array.from({ length: n }, () => new Float64Array(n));
        this._poolB = new Float64Array(n);
        this._poolA = new Float64Array(n);
        this._poolX = new Float64Array(n);
        this._poolTotalSize = n;
    }

    /**
     * 按设备类型预分组（一次过滤，永久复用）
     */
    _buildDeviceCache() {
        const raw = this.rawDevices;
        return {
            gndDevs:          raw.filter(d => d.type === 'gnd'),
            powerDevs:        raw.filter(d => d.type === 'source' || d.type === 'ac_source'),
            power3Devs:       raw.filter(d => d.type === 'source_3p' || d.type === 'gen_3p'),
            tcDevs:           raw.filter(d => d.type === 'tc'),
            pidDevs:          raw.filter(d => d.type === 'PID'),
            bjtDevs:          raw.filter(d => d.type === 'bjt'),
            opAmps:           raw.filter(d => d.type === 'amplifier'),
            oscDevs:          raw.filter(d => d.type === 'oscilloscope'),
            osc3Devs:         raw.filter(d => d.type === 'oscilloscope_tri'),
            diodeDevs:        raw.filter(d => d.type === 'diode'),
            zenerDevs:        raw.filter(d => d.type === 'zener'),
            ledDevs:          raw.filter(d => d.type === 'led'),
            photodiodeDevs:   raw.filter(d => d.type === 'photodiode'),
            diacDevs:         raw.filter(d => d.type === 'diac'),
            resistorDevs:     raw.filter(d => d.type === 'resistor'),
            pressDevs:        raw.filter(d => d.type === 'pressure_sensor'),
            transmitterDevs:  raw.filter(d => d.type === 'transmitter_2wire'),
            capacitorDevs:    raw.filter(d => d.type === 'capacitor'),
            inductorDevs:     raw.filter(d => d.type === 'inductor'),
            lvdtDevs:         raw.filter(d => d.type === 'pressure_transducer'),
            sgDevs:           raw.filter(d => d.type === 'signal_generator'),
            jfetDevs:         raw.filter(d => d.type === 'njfet'),
            relayDevs:        raw.filter(d => d.type === 'relay' && (d.special === 'voltage' || d.special === 'time')),
            aiDevs:           raw.filter(d => d.type === 'AI'),
            pcDevs:           raw.filter(d => d.type === 'calibrator'),
            aoDevs:           raw.filter(d => d.type === 'AO'),
            diDevs:           raw.filter(d => d.type === 'DI'),
            doDevs:           raw.filter(d => d.type === 'DO'),
            dcDevs:           raw.filter(d => d.special === 'dc_source'),
            mf47Devs:         raw.filter(d => d.type === 'mf47'),
            multimeterDevs:   raw.filter(d => d.type === 'multimeter'),
            ne555Devs:        raw.filter(d => d.type === 'd_555'),
            ccDevs:           raw.filter(d => d.type === 'cc_source'),
            motorDevs:        raw.filter(d => d.type === 'MOTOR'),
            scrDevs:          raw.filter(d => d.type === 'scr'),
            triacDevs:        raw.filter(d => d.type === 'triac'),
            igbtDevs:         raw.filter(d => d.type === 'igbt'),
            mosfetDevs:       raw.filter(d => d.type === 'mosfet'),
            ujtDevs:          raw.filter(d => d.type === 'ujt'),
            ptDevs:           raw.filter(d => d.type === 'phototransistor'),
            acAmmeterDevs:    raw.filter(d => d.special === 'AC_AMMETER'),
            acVoltmeterDevs:  raw.filter(d => d.special === 'AC_VOLTMETER'),
            wattmeterDevs:    raw.filter(d => d.special === 'WATTMETER' || d.special === 'REV-POWER'),
            revPowerDevs:     raw.filter(d => d.special === 'REV-POWER'),
            ctDevs:           raw.filter(d => d.special === 'CURRENT_TRANSFORMER'),
            potentialTransformerDevs: raw.filter(d => d.special === 'POTENTIAL_TRANSFORMER'),
            ammeterDevs:      raw.filter(d => d.type === 'ampmeter'),
            controlTransformerDevs: raw.filter(d => d.type === 'control_transformer'),
            reg7805Devs: raw.filter(d => d.type === 'regulator_7805'),
            fuseDevs:    raw.filter(d => d.type === '1p-fuse'),
            batteryDevs: raw.filter(d => d.type === 'nimh_battery'),
            leadAcidBatteryDevs: raw.filter(d => d.type === 'leadacid_battery'),
            singleLeadAcidBatteryDevs: raw.filter(d => d.type === 'single_leadacid_battery'),
            chargeBoardDevs: raw.filter(d => d.type === 'charge_board'),
            mwDevs:      raw.filter(d => d.type === 'motor_winding'),
            inductionMotorDevs: raw.filter(d => d.type === 'induction_motor'),
            contactorDevs: raw.filter(d => d.type === 'CONTACTOR'),
            mainContactDevs: raw.filter(d => d.type === 'ContactorDevice' && d.special === 'maincontacts'),
            noContactDevs: raw.filter(d => d.type === 'ContactorDevice' && d.special === 'nocontact'),
            ncContactDevs: raw.filter(d => d.type === 'ContactorDevice' && d.special === 'nccontact'),
            contactCoilDevs: raw.filter(d => d.type === 'ContactorDevice' && d.special === 'contactcoil'),
            thermalHeatDevs: raw.filter(d => d.type === 'ThermalRelayDevice' && d.special === 'heatelement'),
            thermalNOCDevs: raw.filter(d => d.type === 'ThermalRelayDevice' && d.special === 'nocontact'),
            thermalNCCDevs: raw.filter(d => d.type === 'ThermalRelayDevice' && d.special === 'nccontact'),
            thermalRelayDevs: raw.filter(d => d.type === 'RELAY' && d.special === 'THERMAL-OL-RELAY'),
            acbDevs:          raw.filter(d => d.type === 'ACB'),
            genAcbDevs:       raw.filter(d => d.type === 'gen_acb'),
            rlSeriesDevs:  raw.filter(d => d._useRLSeries),
            fluorescentLampDevs: raw.filter(d => d.type === 'fluorescent_lamp'),
            ballastDevs:   raw.filter(d => d.type === 'ballast'),
            starterDevs:   raw.filter(d => d.type === 'starter'),
        };
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 主循环
    // ═══════════════════════════════════════════════════════════════════════
    update() {
        //        console.log(sys.comps,this.rawDevices); 前者是对象形式，后者是数字形式。

        this.connections = this.sys.conns.filter(c => c.type === 'wire');
        this.currentTime += this.deltaTime;
        this.globalIterCount++;

        this.portToCluster.clear();
        this.nodeVoltages.clear();
        this.gndClusterIndices.clear();
        this.vPosMap.clear();
        this.clusters = [];

        this._buildTopology();
        this._invalidateCacheIfNeeded();
        this._solve();
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 1. 拓扑构建
    // ═══════════════════════════════════════════════════════════════════════
    _buildTopology() {
        const poorSet = this.sys._poorContactPorts || new Set();
        const result = this._topology.build(this.rawDevices, this.connections, poorSet);
        this.portToCluster = result.portToCluster;  //每个簇有都有编号，pordID 与编号的对应映射关系。
        this.clusterCount = result.clusterCount;
        this.clusters = result.clusters;//这是端口ID簇，每个簇里面是导线连接在一起的，或通过union方式连到一起
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
                if (d.special === 'can') {
                    resistSigs.push(`${d.id}:${d.currentResistance || 0}`);
                    if (d.type === 'DO') {
                        resistSigs.push(`${d.id}_ch1:${d.ch1R || 0}`);
                        resistSigs.push(`${d.id}_ch2:${d.ch2R || 0}`);
                    }
                }     
                if (d.type === 'relay' && d.special === 'voltage'){
                   resistSigs.push(`${d.id}:${d.currentResistance || 0}:${d.contactFault || 0}`); 
                }
                if (d.type === 'relay' && d.special === 'time'){
                   resistSigs.push(`${d.id}:${d.currentResistance || 0}`);
                }
                if (d.type === 'tc') resistSigs.push(`${d.id}:${d.currentResistance || 0}`);
                if (d.type === 'calibrator') {
                    resistSigs.push(`${d.id}:${d.sourceValue || 0}`);
                }
                if (d.type === 'ntc_thermistor') {
                    resistSigs.push(`${d.id}:${d.resistance || 0}`);
                }
                if (d.type === 'mf47') {
                    resistSigs.push(`${d.id}:${d._rangeId || ''}:${d.getInputImpedance()}`);
                }
                // 拓扑相关状态：开关位置、继电器通断等
                if (d.type === 'smart_switch') {
                    resistSigs.push(`${d.id}:pos=${d.position}`);
                }
                if (d.type === 'SPNT') {
                    resistSigs.push(`${d.id}:pos=${d._position}`);
                }
                if (d.type === 'switch' || (d.type === 'relay' && d.special !== 'voltage' && d.special !== 'time')) {
                    resistSigs.push(`${d.id}:on=${d.isOn}`);
                }
                if (d.type === 'relay' && d.special === 'wtrelay') {
                    resistSigs.push(`${d.id}:on=${d.isEnergized}:fault=${d.contactFault || 0}`);
                }
                if (d.type === 'relay' && d.special === 'voltage') {
                    resistSigs.push(`${d.id}:on=${d.isOn}:fault=${d.contactFault}`);
                }
                if (d.type === 'multimeter') {
                    resistSigs.push(`${d.id}:mode=${d.mode}`);
                }
                if (d.type === 'MOTOR') {
                    resistSigs.push(`${d.id}:uohm=${d.uohm}:vohm=${d.vohm}:wohm=${d.wohm}`);
                }
                if (d.type === 'scr') {
                    resistSigs.push(`${d.id}:tri=${d._triggered || false}:aks=${d._faultAKShort || false}:gop=${d._faultGateOpen || false}`);
                }
                if (d.type === 'triac') {
                    resistSigs.push(`${d.id}:tri=${d._triggered || false}:mts=${d._faultMTShort || false}:gop=${d._faultGateOpen || false}`);
                }
                if (d.type === 'igbt') {
                    resistSigs.push(`${d.id}:on=${d._isOn || false}:cs=${d._faultCEShort || false}:co=${d._faultCEOpen || false}:ron=${d.rOn || 0.15}:roff=${d.rOff || 1e6}:vth=${d.vth || 4.5}:von=${d.vOn || 1.8}`);
                }
                if (d.type === 'mosfet') {
                    resistSigs.push(`${d.id}:on=${d._isOn || false}:ds=${d._faultDSShort || false}:do=${d._faultDSOpen || false}:ron=${d.rOn || 0.2}:roff=${d.rOff || 1e6}:vth=${d.vth || 3}`);
                }
                if (d.type === 'regulator_7805') {
                    resistSigs.push(`${d.id}:mode=${d._regMode || 'normal'}`);
                }
                if (d.type === '1p-fuse') {
                    resistSigs.push(`${d.id}:state=${d.getState()}`);
                }
                if (d.type === 'CONTACTOR') {
                    resistSigs.push(`${d.id}:state=${d._state}:R=${d._coilResistance}:L=${d._coilInductance}:stuck=${!!d._faultStuck}:coilOpen=${!!d._faultCoilOpen}:l1t1=${!!d._faultContactL1T1}:no1=${!!d._faultContactNO1}:ring=${!!d._faultShadingRing}`);
                }
                if (d.type === 'RELAY' && d.special === 'THERMAL-OL-RELAY') {
                    resistSigs.push(`${d.id}:state=${d._state}:R=${d._phaseResistance}:rated=${d.ratedCurrent}`);
                }
                if (d.type === 'fluorescent_lamp') {
                    resistSigs.push(`${d.id}:state=${d._state || 'idle'}:filR=${d.filamentR}:gapR=${d.gapOnR}`);
                }
                if (d.type === 'ballast') {
                    resistSigs.push(`${d.id}:L=${d.inductance}:R=${d.resistance}:i=${((d.iLast||0)+(d.physCurrent||0))/2}`);
                }
                if (d.type === 'starter') {
                    resistSigs.push(`${d.id}:state=${d._state || 'idle'}`);
                }
                if (d.type === 'ACB') {
                    resistSigs.push(`${d.id}:state=${d._state}`);
                }
            }
            resistSigs.sort();
            const sig = connKeys.join('|') + '|' + resistSigs.join('|');
            // console.log (sig,this._equivResCache);
            if (sig !== this._topologySig) {
                this._topologySig = sig;
                this._equivResCache.clear(); //电阻缓存对象，先从这里面查端口号之间的电阻值，查不到再计算。
            }
        } catch (e) { /* ignore */ }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 2. 核心求解（节点电压法 + 非线性迭代）
    // ═══════════════════════════════════════════════════════════════════════
    _solve() {
        const currentTime = this.globalIterCount * this.deltaTime;

        // 使用预缓存的分组（避免每帧 24 次 filter）
        const {
            gndDevs, powerDevs, power3Devs, tcDevs, pidDevs, bjtDevs, opAmps,
            oscDevs, osc3Devs, diodeDevs, zenerDevs, ledDevs, photodiodeDevs, ptDevs, diacDevs, resistorDevs, pressDevs, transmitterDevs,
            capacitorDevs, inductorDevs, lvdtDevs, sgDevs,             jfetDevs, relayDevs, aiDevs,
            pcDevs, aoDevs, diDevs, doDevs, dcDevs, mf47Devs, multimeterDevs, ammeterDevs, ne555Devs, ccDevs,
            motorDevs, scrDevs, triacDevs, igbtDevs, mosfetDevs, ujtDevs,
            acAmmeterDevs, acVoltmeterDevs, ctDevs, potentialTransformerDevs,
            wattmeterDevs, revPowerDevs, reg7805Devs, fuseDevs,             batteryDevs, leadAcidBatteryDevs, singleLeadAcidBatteryDevs, chargeBoardDevs,
            mwDevs, inductionMotorDevs, contactorDevs, thermalRelayDevs, rlSeriesDevs,
            fluorescentLampDevs, ballastDevs, starterDevs,
            acbDevs, mainContactDevs, noContactDevs, ncContactDevs, contactCoilDevs,
            thermalHeatDevs, thermalNOCDevs, thermalNCCDevs, genAcbDevs,
        } = this._deviceCache;

        this._cachedDevs = this._deviceCache;

        // ── 检测系统频率（从活跃的交流电源，用于电机同步速计算） ────────
        this._systemFreq = 50;
        for (const src of power3Devs) {
            if (src.isOn) { this._systemFreq = src.freq || 50; break; }
        }
        if (this._systemFreq === 50) {
            for (const src of powerDevs) {
                if (src.isOn) { this._systemFreq = src.freq || 50; break; }
            }
        }

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
        // ---默认将三相电源的中性点视为接地点---
        power3Devs.forEach(p => {
            const nIdx = this.portToCluster.get(`${p.id}_wire_n`);
            if (nIdx !== undefined) this.gndClusterIndices.add(nIdx);
        });
        // ---没有任何接地参考时，找一个非 vPos 簇钳位到地（防止矩阵奇异）
        if (this.gndClusterIndices.size === 0 && this.clusterCount > 0) {
            for (let ci = 0; ci < this.clusterCount; ci++) {
                if (!this.vPosMap.has(ci)) { this.gndClusterIndices.add(ci); break; }
            }
        }

        // ---运算放大器默认为线性状态。
        if (!this._opAmpsInitialized) {
            opAmps.forEach(op => op.internalState = 'linear');
            this._opAmpsInitialized = true;
        }

        // ── 建立节点映射 ─────────────────────────────────────────────────
        const nodeMap = new Map();
        let mSize = 0;  //这个是位置的节点电压的数量。
        for (let i = 0; i < this.clusterCount; i++) {
            if (!this.gndClusterIndices.has(i) && !this.vPosMap.has(i)) nodeMap.set(i, mSize++);
        }
        if (mSize === 0) { this._assignKnown(); return; }

        // ── 统计额外电压源方程数（DC/AC/三相电源采用诺顿等效，不增加行数）─
        // PID 设备增加的电压方程数，4-20mA回路供电。4-20mA限制电压或者PWM输出电压。
        let pidEqCount = 0;
        pidDevs.forEach(pid => {
            if (this.portToCluster.has(`${pid.id}_wire_pi1`) ) pidEqCount++;
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
        // 过程校验仪增加的方程，两个4-20mA电流回路24V电源，电压源。
        let pcEqCount = 0;
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
        // ── DC 源（special === 'dc_source'）需要为每个有 p/n 端口的设备增加一个额外电压方程
        let dcEqCount = 0;
        dcDevs.forEach(dev => {
            const p = `${dev.id}_wire_`;
            const cP = this.portToCluster.get(`${p}p`);
            const cN = this.portToCluster.get(`${p}n`);
            if (cP !== undefined && cN !== undefined) dcEqCount++;
        });
        // ── 统计额外电压源方程数（AO模块的PWM输出）─
        let aoEqCount = 0;
        aoDevs.forEach(ao => {
            if (this.portToCluster.has(`${ao.id}_wire_ch3p`) && this.portToCluster.has(`${ao.id}_wire_ch3n`)) aoEqCount++;
            if (this.portToCluster.has(`${ao.id}_wire_ch4p`) && this.portToCluster.has(`${ao.id}_wire_ch4n`)) aoEqCount++;
        });
        // ── 统计额外电压源方程数（DO模块的24V输出）─
        let doEqCount = 0;
        doDevs.forEach(dev => {
            if (this.portToCluster.has(`${dev.id}_wire_ch3p`) && this.portToCluster.has(`${dev.id}_wire_ch3n`)) doEqCount++;
            if (this.portToCluster.has(`${dev.id}_wire_ch4p`) && this.portToCluster.has(`${dev.id}_wire_ch4n`)) doEqCount++;
        });
        // ── 交流电流表方程数（每块表一个 0V 电压源）──
        let acAmmEqCount = 0;
        acAmmeterDevs.forEach(dev => {
            const cAp = this.portToCluster.get(`${dev.id}_wire_ap`);
            const cAn = this.portToCluster.get(`${dev.id}_wire_an`);
            if (cAp !== undefined && cAn !== undefined) acAmmEqCount++;
        });

        // ── 功率表方程数（每块表电流线圈 ip/in 一个 0V 电压源）──
        let wattmeterEqCount = 0;
        wattmeterDevs.forEach(dev => {
            const cIp = this.portToCluster.get(`${dev.id}_wire_ip`);
            const cIn = this.portToCluster.get(`${dev.id}_wire_in`);
            if (cIp !== undefined && cIn !== undefined) wattmeterEqCount++;
        });

        /**
         * ── 电流互感器（CT）的额外方程数统计 ──────────────────────────
         *
         *  每个 CT 在 MNA 矩阵中最多占用 2 个额外方程：
         *    ① 原边 0V 电压源（始终需要）— V(P1) - V(P2) = 0
         *    ② 副边电压源（仅在顺从电压模式时需要）— V(S1) - V(S2) = ±1000V
         *
         *  副边在电流源模式下虽然不填入实际的电压源方程，但
         *  出于索引计数一致性，也计为 1 个方程（ctVIdx 递增但矩阵不使用）。
         *  这是沿用 PID 模块的惯例（见 stampPIDs 中 injectLimitedCurrent）。
         *
         *  注意：每个 CT 的 ctEqCount 是静态预计算的（基于端口是否接线），
         *  而非运行时动态决定，确保 G/B 矩阵尺寸在迭代过程中不变。
         */
        let ctEqCount = 0;
        ctDevs.forEach(dev => {
            const cP1 = this.portToCluster.get(`${dev.id}_wire_p1`);
            const cP2 = this.portToCluster.get(`${dev.id}_wire_p2`);
            const cS1 = this.portToCluster.get(`${dev.id}_wire_s1`);
            const cS2 = this.portToCluster.get(`${dev.id}_wire_s2`);
            if (cP1 !== undefined && cP2 !== undefined) ctEqCount++;
            if (cS1 !== undefined && cS2 !== undefined) ctEqCount++;
        });

        // ── 电压互感器（PT）方程数（副边受控电压源，每台 PT 1 个方程）──
        let ptEqCount = 0;
        potentialTransformerDevs.forEach(dev => {
            const cS1 = this.portToCluster.get(`${dev.id}_wire_s1`);
            const cS2 = this.portToCluster.get(`${dev.id}_wire_s2`);
            if (cS1 !== undefined && cS2 !== undefined) ptEqCount++;
        });

        // ── 控制变压器：互感耦合电感伴随模型，每台 2 个电流变量（i_p, i_s）──
        let ctInternalCount = 0;
        const ctCtrlDevs = this._deviceCache.controlTransformerDevs || [];
        let ctVcvsEqCount = ctCtrlDevs.length * 2;

        // ── 三相电机绕组（三耦合电感器，每台 3 个电流变量 i_u, i_v, i_w）──
        let mwEqCount = (mwDevs || []).length * 3;

        // ── 普通电流表方程数（始终在 p-n 间注入 0V 电压源）───────────
        let ammEqCount = 0;
        ammeterDevs.forEach(dev => {
            const cP = this.portToCluster.get(`${dev.id}_wire_p`);
            const cN = this.portToCluster.get(`${dev.id}_wire_n`);
            if (cP !== undefined && cN !== undefined) ammEqCount++;
        });

        // ── 数字万用表 RES 档额外方程数（顺从电压 8V 时注入电压源）──
        let mmResEqCount = 0;
        multimeterDevs.forEach(dev => {
            if (dev.mode && (dev.mode.startsWith('RES') || dev.mode === 'DIODE')) {
                const cV = this.portToCluster.get(`${dev.id}_wire_v`);
                const cCOM = this.portToCluster.get(`${dev.id}_wire_com`);
                if (cV !== undefined && cCOM !== undefined) mmResEqCount++;
            }
        });

        // ── 三相异步电动机方程数（简化模型使用诺顿等效，不占用额外方程）──
        const imEqCount = 0;

const rlEqCount = rlSeriesDevs.length;

const nodeVarCount = mSize + ctInternalCount;
const totalSize = nodeVarCount + pidEqCount + opAmps.length + oscDevs.length + lvdtDevs.length + aiEqCount + pcEqCount + dcEqCount + aoEqCount + doEqCount + acAmmEqCount + wattmeterEqCount + ctEqCount + ptEqCount + ammEqCount + mmResEqCount + ctVcvsEqCount + mwEqCount + imEqCount + rlEqCount;

        // G是矩阵，B是结果相量，results是解相量，都是64位浮点数
        // ── 矩阵池化（复用上次分配的 G/B/results，避免重复 alloc）──
        this._ensureMatrixPool(totalSize);
        const G = this._poolG;
        const B = this._poolB;
        let bufA = this._poolA;
        let bufB = this._poolX;
        let results = bufA;
        results.fill(0);

        // ── 构建传给 DeviceStamps 的上下文对象 ───────────────────────────
        const ctx = {
            portToCluster: this.portToCluster,  //这是端点ID与 簇号的映射。
            nodeMap,  //这是节点号 与 簇号的映射。
            gndClusterIndices: this.gndClusterIndices,  //这是接地的簇号集合
            vPosMap: this.vPosMap,  // 这是簇号与电压的映射
            clusters: this.clusters,
            getVoltageFromResults: (res, cIdx) =>
                CircuitUtils.getVoltageFromResults(res, nodeMap, this.gndClusterIndices, this.vPosMap, cIdx),
            getVoltageAtPort: (pId) => this.getVoltageAtPort(pId),
            getEquivalentResistance: (a, b, all) =>
                this._getEquivalentResistance(a, b, all),
            calcTransmitterCurrent: (dev) => this._calcTransmitterCurrent(dev),
            deltaTime: this.deltaTime,
            nodeVoltages: this.nodeVoltages,
            systemFreq: this._systemFreq,
        };

        // ── 预求解：更新感应电机机械状态（每帧执行一次） ──────────────
        (inductionMotorDevs || []).forEach(dev => {
            dev._preSolve(this.deltaTime);
        });

        // ── 迭代求解 ─────────────────────────────────────────────────────
        const maxIterations = 200;
        let _lastIter = 0;
        for (let iter = 0; iter < maxIterations; iter++) {
            _lastIter = iter + 1;
            for (let gi = 0; gi < totalSize; gi++) G[gi].fill(0);
            B.fill(0);

            // ── 各器件 stamp 注入（序号对应 DeviceStamps 中的 stamp 方法） ────
            // ─ 1. 电阻 ───────────────────────────────────────────────────
            DeviceStamps.stampResistors(ctx, G, B, resistorDevs);
            // ─ 1b. 单相熔断器（电阻模型） ─────────────────────────────────
            DeviceStamps.stampFuses(ctx, G, B, fuseDevs);
            // ─ 2. 压力传感器 ──────────────────────────────────────────────
            DeviceStamps.stampPressureSensors(ctx, G, B, pressDevs);
            // ─ 3. 变送器 ───────────────────────────────────────────────────
            DeviceStamps.stampTransmitters(ctx, G, B, transmitterDevs);
            // ─ 4. 电源 & 5. 三相电源（诺顿等效注入，不增加方程）──────────
            DeviceStamps.stampPowerSources(ctx, G, B, powerDevs, currentTime);
            // ─ 4b. 镍氢电池（诺顿等效） ──────────────────────────────────
            DeviceStamps.stampBatteries(ctx, G, B, batteryDevs);
            // ─ 4c. 铅酸蓄电池（诺顿等效，6节串联） ──────────────────────────────────
            DeviceStamps.stampLeadAcidBatteries(ctx, G, B, leadAcidBatteryDevs);
            DeviceStamps.stampSingleLeadAcidBatteries(ctx, G, B, singleLeadAcidBatteryDevs);
            DeviceStamps.stampPower3Sources(ctx, G, B, power3Devs, currentTime);

            // ─ 6. PID 控制器 ──────────────────────────────────────────────
            let pidVIdx = nodeVarCount;
            DeviceStamps.stampPIDs(ctx, G, B, pidDevs, pidVIdx);

            // ─ 7. 热电偶（诺顿等效注入，不增加方程）──────────────────────
            DeviceStamps.stampThermocouples(ctx, G, B, tcDevs);
            // ─ 8. 运放 ─────────────────────────────────────────────────────
            const opVIdx = pidVIdx + pidEqCount;
            DeviceStamps.stampOpAmps(ctx, G, B, opAmps, opVIdx);
            // ─ 9. 二极管 ───────────────────────────────────────────────────
            DeviceStamps.stampDiodes(ctx, G, B, diodeDevs, results);
            // ─ 9b. 稳压二极管 ──────────────────────────────────────────────
            DeviceStamps.stampZeners(ctx, G, B, zenerDevs, results);
            // ─ 9c. 发光二极管 ──────────────────────────────────────────────
            DeviceStamps.stampLEDs(ctx, G, B, ledDevs, results);
            // ─ 9d. 光敏二极管 ──────────────────────────────────────────────
            DeviceStamps.stampPhotodiodes(ctx, G, B, photodiodeDevs, results);
            // ─ 9d2. 光敏三极管 ─────────────────────────────────────────────
            DeviceStamps.stampPhototransistors(ctx, G, B, ptDevs, results);
            // ─ 9e. 双向触发二极管 ──────────────────────────────────────────
            DeviceStamps.stampDIACs(ctx, G, B, diacDevs, results);
            // ─ 10. BJT ────────────────────────────────────────────────────
            DeviceStamps.stampBJTs(ctx, G, B, bjtDevs, results);
            // ─ 11. JFET ───────────────────────────────────────────────────
            DeviceStamps.stampJFETs(ctx, G, B, jfetDevs, results);
            // ─ 11.5 SCR ───────────────────────────────────────────────────
            DeviceStamps.stampSCRs(ctx, G, B, scrDevs, results);
            // ─ 11.55 TRIAC ─────────────────────────────────────────────────
            DeviceStamps.stampTRIACs(ctx, G, B, triacDevs, results);
            // ─ 11.56 UJT ───────────────────────────────────────────────────
            DeviceStamps.stampUJTs(ctx, G, B, ujtDevs, results);
            // ─ 11.6 IGBT ──────────────────────────────────────────────────
            DeviceStamps.stampIGBTs(ctx, G, B, igbtDevs, results);
            // ─ 11.7 MOSFET ────────────────────────────────────────────────
            DeviceStamps.stampMOSFETs(ctx, G, B, mosfetDevs, results);
            // ─ 11.8 IC7805 三端稳压器 ─────────────────────────────────────
            DeviceStamps.stamp7805s(ctx, G, B, reg7805Devs, results);
            // ─ 12.1 & 12.2 电容 & 电感 ────────────────────────────────────
            DeviceStamps.stampReactives(ctx, G, B, capacitorDevs, this.deltaTime);
            DeviceStamps.stampReactives(ctx, G, B, inductorDevs, this.deltaTime);
            // ─ 13. 示波器 ──────────────────────────────────────────────────
            const oscVIdx = opVIdx + opAmps.length;
            DeviceStamps.stampOscilloscopes(ctx, G, B, oscDevs, oscVIdx);
            // ─ 14. LVDT / 压力变送器 ───────────────────────────────────────
            const ptVIdx = oscVIdx + oscDevs.length;
            DeviceStamps.stampLVDTs(ctx, G, B, lvdtDevs, ptVIdx);
            // ─ 15. 信号发生器 ──────────────────────────────────────────────
            DeviceStamps.stampSignalGenerators(ctx, G, B, sgDevs, currentTime);
            // ─ 15h 热继电器三相热元件（小电阻注入） ──────────────────────
            DeviceStamps.stampThermalRelays(ctx, G, B, thermalRelayDevs);
            // ─ 15i 三相空气断路器（接触电阻注入） ────────────────────────
            DeviceStamps.stampACBs(ctx, G, B, acbDevs);
            // ─ 15i2 船用框架式空气断路器（主触头接触电阻 + 控制线圈电阻）─
            DeviceStamps.stampMainsSwitch(ctx, G, B, genAcbDevs);
            // ─ 15j 主触头（3极电阻注入） ────────────────────────────
            DeviceStamps.stampMainContacts(ctx, G, B, mainContactDevs);
            // ─ 15k 辅助常开触点（电阻注入） ────────────────────────────
            DeviceStamps.stampNOContacts(ctx, G, B, noContactDevs);
            // ─ 15l 辅助常闭触点（电阻注入） ────────────────────────────
            DeviceStamps.stampNCContacts(ctx, G, B, ncContactDevs);
            // ─ 15m 线圈（固定电阻注入） ────────────────────────────
            DeviceStamps.stampContactCoils(ctx, G, B, contactCoilDevs);
            // ─ 15n 热继电器复合设备（发热元件 + NO/NC 触点） ──────────
            DeviceStamps.stampThermalHeatElements(ctx, G, B, thermalHeatDevs);
            DeviceStamps.stampNOContacts(ctx, G, B, thermalNOCDevs);
            DeviceStamps.stampNCContacts(ctx, G, B, thermalNCCDevs);
            // ─ 荧光灯管（4 端口电阻网络） ──────────────────────────
            DeviceStamps.stampFluorescentLamps(ctx, G, B, fluorescentLampDevs);
            // ─ 启辉器（可变电阻） ──────────────────────────────────
            DeviceStamps.stampStarters(ctx, G, B, starterDevs);
            // ─ 镇流器（RL 串联电压源方程 stamp） ──────────────────────
            // ballast 已通过 _useRLSeries 标记，由 stampRLSeries 统一处理
            // ─ 16 电压型继电器（线圈电阻） ────────────────────────────────
            DeviceStamps.stampRelays(ctx, G, B, relayDevs);
            // ─ 16b RL 串联支路（电压源方程 MNA stamp，替代伴随模型） ────
            const rlVIdx = totalSize - rlEqCount;
            DeviceStamps.stampRLSeries(ctx, G, B, rlSeriesDevs, rlVIdx, this.deltaTime);
            // ─ 17 AI 模块 ────────────────────────────────────────────────
            const aiVIdx = ptVIdx + lvdtDevs.length;
            DeviceStamps.stampAI(ctx, G, B, aiDevs, aiVIdx);
            // ─ 18 过程校验仪 ───────────────────────────────────────────────
            const pcVIdx = aiVIdx + aiEqCount;
            DeviceStamps.stampCalibrators(ctx, G, B, pcDevs, pcVIdx, currentTime);
            // ── DC 源注入（每个占用一个电压源方程）
            const dcVIdx = pcVIdx + pcEqCount;
            DeviceStamps.stampDCSources(ctx, G, B, dcDevs, dcVIdx);
            // ── 充放电板注入（每路输出一个电压源方程）
            DeviceStamps.stampChargeBoards(ctx, G, B, chargeBoardDevs);
            // ── 三相异步电动机对地绝缘电阻 ──
            DeviceStamps.stampMotors(ctx, G, B, motorDevs);
            // ─ 19 AO 模块 ────────────────────────────────────────────────
            const aoVIdx = dcVIdx + dcEqCount;
            DeviceStamps.stampAO(ctx, G, B, aoDevs, aoVIdx);
            // - 20 DI 模块
            DeviceStamps.stampDI(ctx, G, B, diDevs);
            // - 21 DO 模块
            const doVIdx = aoVIdx + aoEqCount;
            DeviceStamps.stampDO(ctx, G, B, doDevs, doVIdx);

            // - 22 NE555 定时器（放电管 + OUT 输出级电阻模型）
            DeviceStamps.stamp555(ctx, G, B, ne555Devs);

            // ── 恒流源注入 ────────────────────────────────────────────────
            const ccVIdx = doVIdx + doEqCount;
            DeviceStamps.stampCCSources(ctx, G, B, ccDevs, ccVIdx);

            // 反向索引基准（totalSize 减去 RL 方程数 = 旧 totalSize）
            const adjustedSize = totalSize - rlEqCount;

            // - 23 交流电流表（0V 电压源注入）
            const acAmmVIdx = adjustedSize - acAmmEqCount - wattmeterEqCount - ctEqCount - ptEqCount - ammEqCount - ctVcvsEqCount - mwEqCount;
            DeviceStamps.stampACAmmeters(ctx, G, B, acAmmeterDevs, acAmmVIdx);

            // - 23.2 功率表（0V 电压源注入电流线圈）
            const wattmeterVIdx = adjustedSize - wattmeterEqCount - ctEqCount - ptEqCount - ammEqCount - ctVcvsEqCount - mwEqCount;
            DeviceStamps.stampWattmeters(ctx, G, B, wattmeterDevs, wattmeterVIdx);

            // - 23.3 逆功率继电器（NO/NC/COM 触点电阻注入，无额外方程）
            DeviceStamps.stampRevPowerContacts(ctx, G, B, revPowerDevs);

            /**
             * ─ 23.5 电流互感器（CT）：原边 0V 电压源 + 副边受控源 ─────
             */
            const ctVIdx = adjustedSize - ctEqCount - ptEqCount - ammEqCount - ctVcvsEqCount - mwEqCount;
            DeviceStamps.stampCurrentTransformers(ctx, G, B, ctDevs, ctVIdx);

            // ─ 23.7 电压互感器（PT）受控电压源注入 ────────────────────
            const potVIdx = adjustedSize - ptEqCount - ammEqCount - ctVcvsEqCount - mwEqCount;
            DeviceStamps.stampPotentialTransformers(ctx, G, B, potentialTransformerDevs, potVIdx);

            // ─ 23.75 控制变压器（互感耦合电感伴随模型，2 电流变量/台）──────────
            const ctCtrlVIdx = adjustedSize - ctVcvsEqCount - mwEqCount;
            DeviceStamps.stampControlTransformers(ctx, G, B, ctCtrlDevs, ctCtrlVIdx);

            // ─ 23.76 三相电机绕组（三耦合电感器，3 电流变量/台）─────────────
            const mwVIdx = adjustedSize - mwEqCount - imEqCount;
            DeviceStamps.stampMotorWindings(ctx, G, B, mwDevs, mwVIdx);

            // ─ 23.77 三相异步电动机（简化模型诺顿等效）────────────────
            DeviceStamps.stampInductionMotors(ctx, G, B, inductionMotorDevs);

            // - 24 MF47 万用表等效注入
            DeviceStamps.stampMF47(ctx, G, B, mf47Devs);

            // ─ 25. 数字万用表（MA 档分流电阻；RES 档恒流/恒压迭代切换）──
            const mmResVIdx = adjustedSize - mmResEqCount - ctVcvsEqCount - mwEqCount;
            DeviceStamps.stampMultimeters(ctx, G, B, multimeterDevs, results, mmResVIdx);
            // ─ 26. 普通电流表（0V 电压源注入 p-n 之间）──
            const ammVIdx = adjustedSize - ammEqCount - ctVcvsEqCount - mwEqCount;
            DeviceStamps.stampAmmeters(ctx, G, B, ammeterDevs, ammVIdx);

            // Gmin 防奇异
            for (let i = 0; i < totalSize; i++) G[i][i] += 1e-12;
            const nextResults = MNAMatrix.gauss(G, B, bufB);
            // 收敛检查
            let maxError = 0;
            for (let i = 0; i < totalSize; i++)
                maxError = Math.max(maxError, Math.abs(nextResults[i] - results[i]));

            // 阻尼更新，nodeMap的每一项是  簇号、节点号的映射。
            nodeMap.forEach((mIdx, cIdx) => {
                const oldV = this.nodeVoltages.get(cIdx) || 0;
                const rawNewV = nextResults[mIdx];
                //nextResults：节点号与电压的映射数组。
                if (this.vPosMap.has(cIdx)) { this.nodeVoltages.set(cIdx, rawNewV); return; }

                const damping = Math.min(0.6, 0.30 + iter * 0.04);
                let nextV = oldV + damping * (rawNewV - oldV);
                const MAX_STEP = Math.max(5.0, Math.abs(oldV) * 0.5, Math.abs(rawNewV) * 0.5);
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
            // 交替缓冲池（下一轮 gauss 写入另一个缓冲区）
            [bufA, bufB] = [bufB, bufA];
            if (!stateChanged && maxError < 1e-6) break;
        }
        this.lastIterCount = _lastIter;
        this._assignKnown();

        // ── 统一电流计算：所有设备电流都在 _updateDeviceCurrents 中计算 ───
        this._updateDeviceCurrents(this._cachedDevs, results);
    }

    // ── 统一计算所有设备的电流，进行状态回填（取代原 CurrentReadback 阶段）────────────
    // 序号对应 DeviceStamps 中各 stamp 方法的顺序
    _updateDeviceCurrents(devices, results) {
        const {
            resistorDevs, pressDevs, transmitterDevs, pidDevs, tcDevs, opAmps,
            diodeDevs, zenerDevs, ledDevs, photodiodeDevs, ptDevs, diacDevs, bjtDevs, jfetDevs, capacitorDevs, inductorDevs,
            oscDevs, lvdtDevs, sgDevs, powerDevs, power3Devs, relayDevs, aiDevs,
            pcDevs, aoDevs, diDevs, doDevs, mf47Devs, multimeterDevs, ammeterDevs, ne555Devs, ccDevs,
            scrDevs, triacDevs, igbtDevs, mosfetDevs, ujtDevs,
inductionMotorDevs, contactorDevs, thermalRelayDevs, rlSeriesDevs,
            fluorescentLampDevs, ballastDevs, starterDevs,
            acbDevs,
        } = devices;
        // --- 内部辅助：安全获取端口电压 ---
        const getV = (devId, portName) => {
            const clusterId = this.portToCluster.get(`${devId}_wire_${portName}`);
            if (clusterId === undefined) return undefined;
            return this.nodeVoltages.get(clusterId) || 0;
        };

        // ─ 1. 电阻电流（对应 stampResistors）
        resistorDevs.forEach(dev => {
            const vL = getV(dev.id, 'l') ?? 0;
            const vR = getV(dev.id, 'r') ?? 0;
            dev.physCurrent = dev.currentResistance > 0.01 ? (vL - vR) / dev.currentResistance : 0;
            if (dev.special === 'oilheater') {
                const vP = getV(dev.id, 'p') ?? 0;
                const vN = getV(dev.id, 'n') ?? 0;
                dev.actCurrent = (vP - vN) / 250;
            }
        });

        // ─ 2. 压力传感器电流（对应 stampPressureSensors）
        pressDevs.forEach(dev => {
            const v1l = getV(dev.id, 'r1l') ?? 0;
            const v1r = getV(dev.id, 'r1r') ?? 0;
            const v2l = getV(dev.id, 'r2l') ?? 0;
            const v2r = getV(dev.id, 'r2r') ?? 0;
            dev.r1Current = (v1l - v1r) / Math.max(0.001, dev.r1);
            dev.r2Current = (v2l - v2r) / Math.max(0.001, dev.r2);
        });

        // ─ 3. 变送器缓存压差（对应 stampTransmitters）
        transmitterDevs.forEach(dev => {
            const vP = getV(dev.id, 'p') ?? 0;
            const vN = getV(dev.id, 'n') ?? 0;
            dev._lastVDiff = vP - vN;
            dev.physCurrent = dev._lastVDiff > 10 ? dev._lastG * dev._lastVDiff : 0;
        });

        // ─ 4. 电源电流（对应 stampPowerSources）
        powerDevs.forEach(dev => {
            const vP = getV(dev.id, 'p');
            const vN = getV(dev.id, 'n');
            if (vP !== undefined && vN !== undefined) {
                const vOut = dev.getValue(this.currentTime);
                dev.physCurrent = (vOut - (vP - vN)) / (dev.rOn || 0.1);
            }
        });

        // ─ 5. 三相电源电流（对应 stampPower3Sources）
        power3Devs.forEach(dev => {
            const vN = getV(dev.id, 'n') ?? 0;
            dev.phaseCurrents = { u: 0, v: 0, w: 0 };
            ['u', 'v', 'w'].forEach(phase => {
                const vP = getV(dev.id, phase);
                if (vP !== undefined) {
                    const vTarget = dev.getPhaseVoltage(phase, this.currentTime);
                    dev.phaseCurrents[phase] = (vTarget - (vP - vN)) / (dev.rOn || 0.01);
                }
            });
        });

        // ─ 6. PID 电流（对应 stampPIDs）
        pidDevs.forEach(pid => {
            if (!pid.powerOn) return;
            this._updatePIDChannels(pid, getV, results);
        });

        // ─ 7. 热电偶电流（对应 stampThermocouples）诺顿等效模型
        tcDevs.forEach(dev => {
            const vP = getV(dev.id, 'r'); // 正极 (Red/Positive)
            const vN = getV(dev.id, 'l'); // 负极 (Blue/Negative)

            if (vP !== undefined && vN !== undefined) {
                const vDiff = vP - vN;
                const rInt = dev.currentResistance || 0.5; // 热电偶典型内阻很小
                const vGen = dev.currentVoltage; // 根据温度梯度生成的温差电动势 (mV -> V)

                // 物理电流计算：(生成的电动势 - 端口压差) / 内阻
                dev.physCurrent = (vGen - vDiff) / rInt;
            } else {
                dev.physCurrent = 0;
            }
        });

        // ─ 8. 运放电流（对应 stampOpAmps）
        opAmps.forEach(op => {
            if (op.currentIdx !== undefined) op.physCurrent = results[op.currentIdx];
        });

        // ─ 9. 二极管电流（对应 stampDiodes）
        diodeDevs.forEach(dev => {
            const vA = getV(dev.id, 'l') ?? 0;
            const vC = getV(dev.id, 'r') ?? 0;
            const vDiff = vA - vC;
            const vF = dev.vForward || 0.68;
            const rOn = dev.rOn || 0.5;
            dev.physCurrent = (vDiff > vF) ? (vDiff - vF) / rOn : 0;
        });

        // ─ 9b. 稳压二极管电流（对应 stampZeners）
        zenerDevs.forEach(dev => {
            if (dev._faultShort) { dev.physCurrent = 0; return; }
            if (dev._faultOpen) { dev.physCurrent = 0; return; }
            const vA = getV(dev.id, 'l') ?? 0;
            const vC = getV(dev.id, 'r') ?? 0;
            const vDiff = vA - vC;
            const vF = dev.vForward || 0.7;
            const vZ = dev.vZener || 5.1;
            const rOn = dev.rOn || 0.5;
            if (vDiff > vF) {
                dev.physCurrent = (vDiff - vF) / rOn;
            } else if (vDiff < -vZ) {
                dev.physCurrent = (vDiff + vZ) / rOn;
            } else {
                dev.physCurrent = 0;
            }
        });

        // ─ 9c. 发光二极管电流（对应 stampLEDs）
        ledDevs.forEach(dev => {
            if (dev._burnedOut || dev._faultOpen) { dev.physCurrent = 0; return; }
            const vA = getV(dev.id, 'l') ?? 0;
            const vC = getV(dev.id, 'r') ?? 0;
            const vDiff = vA - vC;
            const vF = dev.vForward || 2.0;
            const rOn = dev.rOn || 0.5;
            dev.physCurrent = (vDiff > vF) ? (vDiff - vF) / rOn : 0;
        });

        // ─ 9d. 光敏二极管电流（对应 stampPhotodiodes）
        photodiodeDevs.forEach(dev => {
            const vA = getV(dev.id, 'l') ?? 0;
            const vC = getV(dev.id, 'r') ?? 0;
            const vDiff = vA - vC;
            const vF = dev.vForward || 0.7;
            const rOn = dev.rOn || 0.5;
            if (vDiff > vF) {
                dev.physCurrent = (vDiff - vF) / rOn;
            } else {
                const iPhoto = (dev.photoCurrent || 0) / 1e6;
                dev.physCurrent = -iPhoto;
            }
        });

        // ─ 9d2. 光敏三极管电流（对应 stampPhototransistors）
        ptDevs.forEach(dev => {
            const vC = getV(dev.id, 'c') ?? 0;
            const vE = getV(dev.id, 'e') ?? 0;
            const vCE = vC - vE;
            const iPhoto = (dev.photoCurrent || 0) / 1e6;
            const beta = dev.beta || 200;
            if (iPhoto > 1e-12 && vCE > 0) {
                const iLight = beta * iPhoto;
                dev.physCurrent = iLight + vCE / (dev.rOn || 50);
                if (vCE < (dev.vceSat || 0.3)) {
                    dev.physCurrent = vCE / (dev.rOn || 50);
                }
            } else {
                dev.physCurrent = vCE / (dev.rOff || 1e8);
            }
        });

        // ─ 9e. 双向触发二极管电流（对应 stampDIACs）
        diacDevs.forEach(dev => {
            const vA = getV(dev.id, 'l') ?? 0;
            const vC = getV(dev.id, 'r') ?? 0;
            const vDiff = vA - vC;
            const vHold = dev.vHold || 10;
            const rOn = dev.rOn || 5;
            dev._vDiffPrev = vDiff;
            if (dev._diacActive) {
                const vSign = dev._diacSign || 1;
                dev.physCurrent = (vDiff - vHold * vSign) / rOn;
            } else {
                dev.physCurrent = 0;
            }
        });

        // ─ 10. BJT 电流（对应 stampBJTs）
        bjtDevs.forEach(dev => {
            const vB = getV(dev.id, 'b') ?? 0;
            const vC = getV(dev.id, 'c') ?? 0;
            const vE = getV(dev.id, 'e') ?? 0;
            const model = dev.getCompanionModel(vB, vC, vE);
            const { gBE, iBE, beta, gCE_sat, pol, V_SAT } = model.internal;

            const vbeLocal = (vB - vE) * pol;
            const vceLocal = (vC - vE) * pol;
            const Ib = pol * (gBE * vbeLocal + iBE);
            const Ic = (beta * Ib) + pol * (gCE_sat * (vceLocal - V_SAT));

            dev.physCurrents = { b: Ib, c: Ic, e: -(Ib + Ic) };
        });

        // ─ 11. JFET 电流（对应 stampJFETs）
        jfetDevs.forEach(dev => {
            const vD = getV(dev.id, 'd') ?? 0;
            const vS = getV(dev.id, 's') ?? 0;
            const res = dev.getDSResistance(vD - vS);
            dev.physCurrent = (vD - vS) / res;
        });

        // ─ 11.5 SCR 电流（对应 stampSCRs）
        scrDevs.forEach(dev => {
            const vA = getV(dev.id, 'a') ?? 0;
            const vK = getV(dev.id, 'k') ?? 0;
            const vG = getV(dev.id, 'g') ?? 0;
            const vGK = vG - vK;
            dev.gateCurrent = vGK > dev.gkForwardV ? (vGK - dev.gkForwardV) / (dev.gkR || 0.5) : 0;
            if (dev._faultAKShort) {
                dev.physCurrent = (vA - vK) / 1;
            } else if (dev._triggered) {
                if (dev._scrStampMode === 'ron') {
                    dev.physCurrent = (vA - vK) / Math.max(0.001, dev.rOn || 0.1);
                    if (dev.physCurrent < (dev.holdCurrent || 0.0005) && vGK <= dev.gkForwardV) {
                        dev._triggered = false;
                    }
                } else {
                    dev.physCurrent = (vA - vK - (dev.vOn || 1.0)) / Math.max(0.001, dev.rOn || 0.1);
                    if (vGK <= dev.gkForwardV && (
                        Math.abs(dev.physCurrent) < (dev.holdCurrent || 0.0005) ||
                        ((dev.vOn || 1.0) - (vA - vK)) > 0.01
                    )) {
                        dev._triggered = false;
                    }
                }
            } else {
                dev.physCurrent = (vA - vK) / Math.max(0.001, dev.rOff || 1e6);
            }
        });

        // ─ 11.55 TRIAC 电流（对应 stampTRIACs）
        triacDevs.forEach(dev => {
            const vMT2 = getV(dev.id, 'mt2') ?? 0;
            const vMT1 = getV(dev.id, 'mt1') ?? 0;
            const vG = getV(dev.id, 'g') ?? 0;
            const vMT = vMT2 - vMT1;
            const vGmt1 = vG - vMT1;
            const vFdiode = 0.67;
            const rDiode = 200;
            if (vGmt1 > vFdiode) {
                dev.gateCurrent = (vGmt1 - vFdiode) / rDiode;
            } else if (vGmt1 < -vFdiode) {
                dev.gateCurrent = (vGmt1 + vFdiode) / rDiode;
            } else {
                dev.gateCurrent = 0;
            }
            if (Math.abs(vGmt1) > dev.vGt) {
                dev.gateCurrent += (Math.abs(vGmt1) - dev.vGt) / (dev.rG || 10);
            }

            if (dev._faultMTShort) {
                dev.physCurrent = vMT / 1;
            } else if (dev._triggered) {
                dev.physCurrent = vMT / Math.max(0.001, dev.rOn || 0.1);
                if (Math.abs(dev.physCurrent) < (dev.holdCurrent || 0.005)) {
                    dev._triggered = false;
                    dev._gateActive = false;
                }
            } else {
                dev.physCurrent = vMT / Math.max(0.001, dev.rOff || 1e6);
            }
        });

        // ─ 11.56 UJT 电流（对应 stampUJTs）
        ujtDevs.forEach(dev => {
            const vB1 = getV(dev.id, 'b1') ?? 0;
            const vB2 = getV(dev.id, 'b2') ?? 0;
            const vE = getV(dev.id, 'e') ?? 0;
            const vEB1 = vE - vB1;
            if (dev._triggered) {
                dev.physCurrent = (vEB1 - (dev.vOn || 1.5)) / Math.max(0.001, dev.rOn || 15);
                if (Math.abs(dev.physCurrent) < (dev.holdCurrent || 0.005)) {
                    dev._triggered = false;
                }
            } else {
                dev.physCurrent = vEB1 / Math.max(0.001, dev.rOff || 1e8);
            }
        });

        // ─ 11.6 IGBT 电流（对应 stampIGBTs）
        igbtDevs.forEach(dev => {
            const vC = getV(dev.id, 'c') ?? 0;
            const vE = getV(dev.id, 'e') ?? 0;
            const vG = getV(dev.id, 'g') ?? 0;
            const vCE = vC - vE;
            if (dev._faultCEShort) {
                dev.physCurrent = vCE / 1;
            } else if (dev._faultCEOpen) {
                dev.physCurrent = 0;
            } else if (dev._isOn) {
                if (dev._igbtStampMode === 'ron') {
                    dev.physCurrent = vCE / Math.max(0.001, dev.rOn || 0.1);
                } else {
                    dev.physCurrent = (vCE - (dev.vOn || 1.8)) / Math.max(0.001, dev.rOn || 0.1);
                }
            } else {
                dev.physCurrent = vCE / Math.max(0.001, dev.rOff || 1e6);
            }
        });

        // ─ 11.7 MOSFET 电流（对应 stampMOSFETs）
        mosfetDevs.forEach(dev => {
            const vD = getV(dev.id, 'd') ?? 0;
            const vS = getV(dev.id, 's') ?? 0;
            const vDS = vD - vS;
            if (dev._faultDSShort) {
                dev.physCurrent = vDS / 1;
            } else if (dev._faultDSOpen) {
                dev.physCurrent = 0;
            } else if (dev._isOn) {
                dev.physCurrent = vDS / Math.max(0.001, dev.rOn || 0.2);
            } else {
                dev.physCurrent = vDS / Math.max(0.001, dev.rOff || 1e6);
            }
        });

        // ─ 12.1 & 12.2 电容/电感（对应 stampReactives）
        [...capacitorDevs, ...inductorDevs].forEach(dev => {
            const vL = getV(dev.id, 'l') ?? 0;
            const vR = getV(dev.id, 'r') ?? 0;
            dev.calculatePhysicalCurrent(vL, vR, this.deltaTime);
            dev.updateState(vL, vR);
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
            const channels = [{ k: 'ch1', p: 'ch1p', n: 'ch1n' }, { k: 'ch2', p: 'ch2p', n: 'ch2n' }];
            channels.forEach((cfg, idx) => {
                const ch = sg.channels[idx];
                const vP = getV(sg.id, cfg.p);
                const vN = getV(sg.id, cfg.n);
                if (ch.enabled && vP !== undefined && vN !== undefined) {
                    const Vs = sg.voltOutputs[cfg.k];
                    sg[`${cfg.k}Current`] = (Vs - (vP - vN)) / 50; // 50Ω 内阻
                } else {
                    sg[`${cfg.k}Current`] = 0;
                }
            });
        });
        // ─ 16 电压/时间型继电器线圈电流（对应 stampRelays）
        relayDevs.forEach(dev => {
            const vL = getV(dev.id, 'l');
            const vR = getV(dev.id, 'r');
            if (vL !== undefined && vR !== undefined) {
                dev.physCurrent = (vL - vR) / (dev.currentResistance || 1000);
            }
            if (dev.special === 'time') return;
            const vNO = getV(dev.id, 'NO');
            const vCOM = getV(dev.id, 'COM');
            if (vNO !== undefined && vCOM !== undefined) {
                const R = dev.isEnergized ? 0.01 : 1e9;
                dev.contactCurrent = (vNO - vCOM) / R;
            }
        });

        // ─ 16b RL 串联支路电流（对应 stampRLSeries，从电压源方程直接读取）
        rlSeriesDevs.forEach(dev => {
            if (dev._rlVIdx !== undefined && dev._rlVIdx >= 0 && dev._rlVIdx < results.length) {
                dev._coilPrevCurrent = results[dev._rlVIdx] || 0;
                dev.physCurrent = dev._coilPrevCurrent;
            }
        });

        // ─ 荧光灯管电流（对应 stampFluorescentLamps）
        fluorescentLampDevs.forEach(dev => {
            const vLa = getV(dev.id, 'left_a') ?? 0;
            const vLb = getV(dev.id, 'left_b') ?? 0;
            const vRa = getV(dev.id, 'right_a') ?? 0;
            const vRb = getV(dev.id, 'right_b') ?? 0;
            const isOn = dev._state === 'on';
            const rFil = isOn ? 0.5 : (dev.filamentR || 200);
            const rGap = isOn ? (dev.gapOnR || 220) : 10e6;
            dev.leftFilamentCurrent = (vLa - vLb) / Math.max(0.001, rFil);
            dev.rightFilamentCurrent = (vRa - vRb) / Math.max(0.001, rFil);
            dev.gapCurrent = (vLb - vRa) / Math.max(0.001, rGap);
            dev.physCurrent = dev.gapCurrent;
        });

        // ─ 启辉器电流（对应 stampStarters）
        starterDevs.forEach(dev => {
            const vL = getV(dev.id, 'l') ?? 0;
            const vR = getV(dev.id, 'r') ?? 0;
            const R = dev.getResistance();
            dev.physCurrent = (vL - vR) / Math.max(0.001, R);
        });

        // ─ 镇流器物理电流（由 calcuatePhysicalCurrent 已在 reactives 循环中计算）
        // （ballast 已经在 capacitorDevs+inductorDevs 循环中被处理）

        // ─ 22 NE555 电流（对应 stamp555）
        // （NE555 的电流在 stamp 阶段已经处理，这里不需要额外计算）

        // ─ 23 MF47 万用表电流（对应 stampMF47）
        mf47Devs.forEach(dev => {
            const vV = getV(dev.id, 'v');
            const vMA = getV(dev.id, 'mA');
            const vCOM = getV(dev.id, 'COM');
            const R = dev.getInputImpedance();
            const group = dev._range?.group;
            if (group === 'DCmA') {
                dev.physCurrent = (vMA !== undefined && vCOM !== undefined)
                    ? (vMA - vCOM) / Math.max(0.1, R) : 0;
            } else {
                dev.physCurrent = (vV !== undefined && vCOM !== undefined)
                    ? (vV - vCOM) / Math.max(0.1, R) : 0;
            }
        });

        // ─ 25. 数字万用表电流（对应 stampMultimeters：分流电阻）
        multimeterDevs.forEach(dev => {
            if (dev.mode === 'MA') {
                const vMa = getV(dev.id, 'ma');
                const vCom = getV(dev.id, 'com');
                dev.physCurrent = (vMa !== undefined && vCom !== undefined) ? (vMa - vCom) / 0.2 : 0;
            } else if (dev.mode && (dev.mode.startsWith('RES') || dev.mode === 'DIODE')) {
                if (dev._resCV && dev.currentIdx !== undefined) {
                    const iReal = Math.abs(results[dev.currentIdx] || 0);
                    let iSet = 0;
                    if (dev.mode === 'DIODE') iSet = 0.001;
                    else if (dev.mode === 'RES200') iSet = 0.001;
                    else if (dev.mode === 'RES2k') iSet = 0.0001;
                    else if (dev.mode === 'RES200k') iSet = 0.000001;
                    if (iReal > iSet * 0.8) dev._resCV = false;
                }
                dev.physCurrent = 0;
            } else {
                dev.physCurrent = 0;
            }
        });
        // ─ 26. 普通电流表电流（对应 stampAmmeters：0V 电压源）
        ammeterDevs.forEach(dev => {
            if (dev.currentIdx !== undefined) {
                dev.physCurrent = results[dev.currentIdx];
            } else {
                dev.physCurrent = 0;
            }
        });

        // ─ 17. 19. 20. 21 AI/AO/DI/DO 模块电流
        const ioModules = [
            { devs: aiDevs, update: this._updateAIChannels.bind(this) },
            { devs: aoDevs, update: this._updateAOChannels.bind(this) },
            { devs: diDevs, update: null },
            { devs: doDevs, update: this._updateDOChannels.bind(this) }
        ];

        ioModules.forEach(group => {
            group.devs.forEach(dev => {
                if (!dev.powerOn) return;
                const vcc = getV(dev.id, 'vcc');
                const gnd = getV(dev.id, 'gnd');
                if (vcc !== undefined && gnd !== undefined) {
                    dev.physCurrent = (vcc - gnd) / 50;
                    if (group.update) group.update(dev, getV);
                }
            });
        });
        // ─ 18. 过程校验仪电流（对应 stampCalibrators）根据不同模式计算电流
        pcDevs.forEach(dev => {
            if (dev.isPowered) this._updateCalibratorCurrents(dev, getV, results);
        })

        // ─ 23.5 交流电流表电流（对应 stampACAmmeters）
        const acAmmeterDevs = devices.acAmmeterDevs || [];
        acAmmeterDevs.forEach(dev => {
            if (dev.currentIdx !== undefined) dev.physCurrent = results[dev.currentIdx];
        });

        // ─ 23.6 功率表电流（对应 stampWattmeters）
        const wattmeterDevs = devices.wattmeterDevs || [];
        wattmeterDevs.forEach(dev => {
            if (dev.currentIdx !== undefined) dev.physCurrent = results[dev.currentIdx];
        });

        /**
         * ── 23.6 电流互感器电流回读 ────────────────────────────────────
         *
         *  从 MNA 求解结果中提取原边电流 I₁（即 0V 电压源的电流），
         *  存入设备对象供 tick() 显示使用。
         *
         *  回读字段：
         *    physCurrent      → 原边电流 I₁（tick 中读取）
         *    _prevIPrimary     → 原边电流副本（下一帧 stamp 中作为 I₁_prev 使用）
         *    I_secondary       → 副边电流 I₂ = I₁ / K（供显示）
         *
         *  收敛传递链：
         *    本轮 results[_currentIdxPrimary] → dev._prevIPrimary
         *      → 下一轮 stampCurrentTransformers 读取 dev._prevIPrimary
         *        → 计算 I₂_target = _prevIPrimary / K → 注入副边
         *          → 求解本轮 MNA → 得到更新的 I₁ → ...
         */
        const ctDevs = devices.ctDevs || [];
        ctDevs.forEach(dev => {
            // 从 MNA 结果向量中读取原边 0V 电压源的电流
            if (dev._currentIdxPrimary !== undefined) {
                dev._prevIPrimary = results[dev._currentIdxPrimary];
                dev.physCurrent = dev._prevIPrimary;
            }
            // 计算副边电流（用于组件界面显示）
            const ratio = Math.max(1, dev._turnsRatio || 10);
            dev.I_secondary = (dev._prevIPrimary || 0) / ratio;
        });

        // ─ 23.7 电压互感器（PT）电压回读 ────────────────────────────────
        const potTransformerDevs = devices.potentialTransformerDevs || [];
        potTransformerDevs.forEach(dev => {
            const getVpt = (port) => {
                const c = this.portToCluster.get(`${dev.id}_wire_${port}`);
                if (c === undefined) return 0;
                return this.nodeVoltages.get(c) || 0;
            };
            dev.V_primary = getVpt('p1') - getVpt('p2');
            const ratio = Math.max(1, dev._turnsRatio || 10);
            dev.V_secondary = dev.V_primary / ratio;
            if (dev._currentIdxSecondary !== undefined) {
                dev.I_secondary = results[dev._currentIdxSecondary];
            }
        });

        // ─ 23.77 三相电机绕组电流回读 ─────────────────────────
        const mwDevs = devices.mwDevs || [];
        mwDevs.forEach(dev => {
            if (dev._iUCol !== undefined) {
                const iu = results[dev._iUCol];
                const iv = results[dev._iVCol];
                const iw = results[dev._iWCol];
                dev._iuPrev = iu;
                dev._ivPrev = iv;
                dev._iwPrev = iw;
                dev.phaseCurrents = { u: iu, v: iv, w: iw };
            }
        });

        // ─ 23.8 控制变压器电流回读 + 直流检测 ──────────────────────
        const ctCtrlDevs = devices.controlTransformerDevs || [];
        ctCtrlDevs.forEach(dev => {
            if (dev._i1Col !== undefined) {
                const i1 = results[dev._i1Col];
                dev.I_primary   = i1;
                dev.physCurrent = i1;
                dev._i1Prev = i1;
            }
            if (dev._i2Col !== undefined) {
                const i2 = results[dev._i2Col];
                dev.I_secondary = i2;
                dev._i2Prev = i2;
            }
        });

        // ─ 24. 恒流源电流（对应 stampCCSources）
        ccDevs.forEach(dev => {
            for (let i = 0; i < 4; i++) {
                const vP = getV(dev.id, `i${i+1}`);
                const vN = getV(dev.id, 'com');
                if (vP !== undefined && vN !== undefined) {
                    dev[`i${i+1}Current`] = (vP - vN);
                } else {
                    dev[`i${i+1}Current`] = 0;
                }
            }
        });

        // ─ 25. IC7805 电流回读（对应 stamp7805s）
        const reg7805Devs = devices.reg7805Devs || [];
        reg7805Devs.forEach(dev => {
            const vIn = getV(dev.id, 'in') ?? 0;
            const vOut = getV(dev.id, 'out') ?? 0;
            const vGnd = getV(dev.id, 'gnd') ?? 0;
            const Vi = vIn - vGnd;
            const Vo = vOut - vGnd;

            if (dev._regMode === 'short') {
                dev.physCurrent = 0.5;
            } else if (dev._regMode === 'cl') {
                dev.physCurrent = 1.5;
            } else {
                let Vt;
                if (Vi < 5) Vt = Vi;
                else Vt = 5 + 0.005 * (Vi - 8);
                dev.physCurrent = Math.max(0, (Vt - Vo) / 0.01);
            }
        });

        // ─ 23.77 三相异步电动机电流回读 + 转矩更新（简化模型）───────
        (inductionMotorDevs || []).forEach(dev => {
            if (!dev._nortonGeq) return;
            // 从节点电压回算相电流
                const vu1 = getV(dev.id, 'u1'), vu2 = getV(dev.id, 'u2');
                const vv1 = getV(dev.id, 'v1'), vv2 = getV(dev.id, 'v2');
                const vw1 = getV(dev.id, 'w1'), vw2 = getV(dev.id, 'w2');
                const Geq  = dev._nortonGeq || 0;
                const Ldt  = dev._nortonLdt || 0;
                const iup  = dev._iuPrev || 0;
                const ivp  = dev._ivPrev || 0;
                const iwp  = dev._iwPrev || 0;
                const i_u  = (vu1 !== undefined && vu2 !== undefined) ? Geq * (vu1 - vu2) + Ldt * Geq * iup : 0;
                const i_v  = (vv1 !== undefined && vv2 !== undefined) ? Geq * (vv1 - vv2) + Ldt * Geq * ivp : 0;
                const i_w  = (vw1 !== undefined && vw2 !== undefined) ? Geq * (vw1 - vw2) + Ldt * Geq * iwp : 0;

                // ── 并联励磁支路电流（Rc || Lm）──
                const magGeq = dev._nortonMagGeq || 0;
                const magIhu = dev._nortonMagIhu || 0;
                const magIhv = dev._nortonMagIhv || 0;
                const magIhw = dev._nortonMagIhw || 0;
                const i_mag_u = (vu1 !== undefined && vu2 !== undefined) ? magGeq * (vu1 - vu2) + magIhu : 0;
                const i_mag_v = (vv1 !== undefined && vv2 !== undefined) ? magGeq * (vv1 - vv2) + magIhv : 0;
                const i_mag_w = (vw1 !== undefined && vw2 !== undefined) ? magGeq * (vw1 - vw2) + magIhw : 0;

                // 总电流（转子 + 励磁）→ 存入显示（_postSolve 仍存转子电流供历史用）
                const i_total_u = i_u + i_mag_u;
                const i_total_v = i_v + i_mag_v;
                const i_total_w = i_w + i_mag_w;
                dev._iuDisplayPrev = i_total_u;
                dev._ivDisplayPrev = i_total_v;
                dev._iwDisplayPrev = i_total_w;
                dev._postSolve(i_u, i_v, i_w);
                dev.phaseCurrents = { u: i_total_u, v: i_total_v, w: i_total_w };

                // 调试确认：取消注释查看实际电流值
                // if (dev.id === 'im01' && this.globalIterCount % 20 === 0)
                //     console.log('im01:', { vu1, vu2, vv1, vv2, vw1, vw2, i_u, i_v, i_w, i_total_u, i_total_v, i_total_w });

                // 保存端电压和 Lm 电流供下一帧梯形积分历史使用
                const RL_Geq   = dev._nortonRL_Geq   || (this.deltaTime || 0.5e-3) / (2 * (dev.Lm || 0.078));
                const RL_alpha = dev._nortonRL_alpha || 1;
                const V_u = (vu1 !== undefined && vu2 !== undefined) ? vu1 - vu2 : 0;
                const V_v = (vv1 !== undefined && vv2 !== undefined) ? vv1 - vv2 : 0;
                const V_w = (vw1 !== undefined && vw2 !== undefined) ? vw1 - vw2 : 0;
                dev._magVuPrev = V_u;
                dev._magVvPrev = V_v;
                dev._magVwPrev = V_w;
                // I_Lm[n] = Geq·V[n] + α·I[n-1] + Geq·V[n-1]
                // 其中 magIhu = α·I[n-1] + Geq·V[n-1] 已在 stamp 中计算
                dev._magIuPrev = RL_Geq * V_u + magIhu;
                dev._magIvPrev = RL_Geq * V_v + magIhv;
                dev._magIwPrev = RL_Geq * V_w + magIhw;
                let slip = dev.slip || 1;
                if (Math.abs(slip) < 0.0001) slip = slip >= 0 ? 0.0001 : -0.0001;
                const p = dev.polePairs || 2;
                const omegaSync = dev._omega_sync || (2 * Math.PI * (this._systemFreq || 50) / Math.max(1, p));

                // ── 转矩由稳态等效电路公式计算 ──
                // 利用电机端电压（而非 Norton 电流）直接得到正确转矩，避开 Norton 电流初始瞬态
                const v_u = (vu1 !== undefined && vu2 !== undefined) ? vu1 - vu2 : 0;
                const v_v = (vv1 !== undefined && vv2 !== undefined) ? vv1 - vv2 : 0;
                const v_w = (vw1 !== undefined && vw2 !== undefined) ? vw1 - vw2 : 0;
                const v_mag_sq = v_u*v_u + v_v*v_v + v_w*v_w;          // 三相瞬时电压平方和
                const Vrms_sq = v_mag_sq / 3;                           // 等效相电压 RMS²

                // 保存实测端电压 RMS 供组件的 _computeTorqueSpecs 显示用
                dev._Vrms = Math.sqrt(Vrms_sq);

                const R1  = dev.R1  || 2.15;
                const R2  = dev.R2  || 0.42;
                const L1s = dev.Lsigma1 || 0.004;
                const L2s = dev.Lsigma2 || 0.005;
                const X_total = 2 * Math.PI * (this._systemFreq || 50) * (L1s + L2s);
                const R_load = R1 + R2 / slip;
                const Z_sq = R_load * R_load + X_total * X_total;

                // T = 3·V²·(R₂/s) / (ω_sync·Z²)
                let te = (Z_sq > 1e-12) ? (3 * Vrms_sq * (R2 / slip)) / (omegaSync * Z_sq) : 0;

                // ── 缺相且电机处于起动状态 → 强制转矩为 0 ──
                const _hasAllPhaseV = Math.abs(v_u) > 5 && Math.abs(v_v) > 5 && Math.abs(v_w) > 5;
                if (!_hasAllPhaseV && Math.abs(dev._omega_m) < 5) te = 0;

                // ── 反接制动转矩增强（|s| > 1.2 时乘 2·(|s|-0.7)，模拟集肤效应）──
                if (Math.abs(slip) > 1.2) te *= 2 * (Math.abs(slip) - 0.7);

                // ── 限幅到电机物理可实现的最大转矩 ──
                // 频率骤降产生负滑差，稳态公式会算出远超 T_max 的制动转矩，
                // 用堵转转矩 T_max = 3·V²/(2·|ω_sync|·(R₁+√(R₁²+X²))) 限幅。
                const sqrt_term = Math.sqrt(R1 * R1 + X_total * X_total);
                const absOmega = Math.abs(omegaSync);
                if (absOmega > 1e-6) {
                    const T_mag = (3 * Vrms_sq) / (2 * absOmega * (R1 + sqrt_term));
                    const limit = T_mag * 1.2;   // 允许 20% 瞬态过冲
                    te = Math.max(-limit, Math.min(limit, te));
                }
                dev._setTorque(te);
        });

        // ─ 热继电器三相热元件电流回填 ─────────────────────────────────
        (thermalRelayDevs || []).forEach(dev => {
            const R = dev._phaseResistance || 0.01;
            const v1 = getV(dev.id, 'l1'), vt1 = getV(dev.id, 't1');
            const v2 = getV(dev.id, 'l2'), vt2 = getV(dev.id, 't2');
            const v3 = getV(dev.id, 'l3'), vt3 = getV(dev.id, 't3');
            const i1 = (v1 !== undefined && vt1 !== undefined) ? (v1 - vt1) / R : 0;
            const i2 = (v2 !== undefined && vt2 !== undefined) ? (v2 - vt2) / R : 0;
            const i3 = (v3 !== undefined && vt3 !== undefined) ? (v3 - vt3) / R : 0;
            dev._phaseCurrents = [i1, i2, i3];
            // 取最大瞬时电流用于 RMS 计算
            dev._maxInstCurrent = Math.max(Math.abs(i1), Math.abs(i2), Math.abs(i3));
        });

        // ─ 三相空气断路器触头电流回读 + 分励脱扣 ─────────────────────
        (devices.acbDevs || []).forEach(dev => {
            const R = dev._state === 'on' ? 0.001 : 1e9;
            const vL1 = getV(dev.id, 'l1'), vT1 = getV(dev.id, 't1');
            const vL2 = getV(dev.id, 'l2'), vT2 = getV(dev.id, 't2');
            const vL3 = getV(dev.id, 'l3'), vT3 = getV(dev.id, 't3');
            dev.phaseCurrents = {
                l1: (vL1 !== undefined && vT1 !== undefined) ? (vL1 - vT1) / R : 0,
                l2: (vL2 !== undefined && vT2 !== undefined) ? (vL2 - vT2) / R : 0,
                l3: (vL3 !== undefined && vT3 !== undefined) ? (vL3 - vT3) / R : 0,
            };
            // 存储进线端电压（供 TEST 按钮检测）
            dev._phaseVoltages = { l1: vL1 ?? 0, l2: vL2 ?? 0, l3: vL3 ?? 0 };
            // 分励脱扣器线圈电流检测
            const vFla = getV(dev.id, 'fla');
            const vFlb = getV(dev.id, 'flb');
            if (vFla !== undefined && vFlb !== undefined) {
                const Rcoil = dev._tripCoilR || 50;
                const iCoil = (vFla - vFlb) / Rcoil;
                dev._shuntTripCurrent = iCoil;
                if (Math.abs(iCoil) > 0.01 && dev._state === 'on' && !dev.isTripped()) {
                    dev.trip();
                }
            } else {
                dev._shuntTripCurrent = 0;
            }
        });

        // ─ 船用框架式空气断路器（发电机主开关）电流/电压回读 ─────────
        (devices.genAcbDevs || []).forEach(dev => {
            const conducting = dev._rackPos === 'connected' && dev._state === 'closed';
            const R = conducting ? 0.001 : 1e9;
            const vL1 = getV(dev.id, 'l1'), vT1 = getV(dev.id, 't1');
            const vL2 = getV(dev.id, 'l2'), vT2 = getV(dev.id, 't2');
            const vL3 = getV(dev.id, 'l3'), vT3 = getV(dev.id, 't3');
            dev.phaseCurrents = {
                l1: (vL1 !== undefined && vT1 !== undefined) ? (vL1 - vT1) / R : 0,
                l2: (vL2 !== undefined && vT2 !== undefined) ? (vL2 - vT2) / R : 0,
                l3: (vL3 !== undefined && vT3 !== undefined) ? (vL3 - vT3) / R : 0,
            };
            dev._phaseVoltages = { l1: vL1 ?? 0, l2: vL2 ?? 0, l3: vL3 ?? 0 };
        });
    }
    /**
     * PID 模块通道详细更新逻辑
     * @param {Object} dev PID模块实例
     * @param {Function} getV 电压获取辅助函数
     * @param {Float64Array} results MNA求解结果
     */
    _updatePIDChannels(dev, getV, results) {
        // --- CH1 & CH2: 输出通道（4-20mA 或 PWM）---
        ['ch1', 'ch2'].forEach((ch, idx) => {
            const poPort = `po${idx + 1}`;
            const noPort = `no${idx + 1}`;
            const vP = getV(dev.id, poPort);
            const vN = getV(dev.id, noPort);

            if (vP !== undefined && vN !== undefined) {
                const outMode = dev.outModes[`CH${idx + 1}`] || '4-20mA';
                if (outMode === '4-20mA') {
                    // 4-20mA 模式：通过负载电阻计算电流
                    const rLoad = this._getEquivalentResistanceFromPorts(dev.id, poPort, noPort);
                    dev[`${ch}Current`] = (vP - vN) / Math.max(0.1, rLoad);
                } else if (outMode === 'PWM') {
                    // PWM 模式：直接使用设备设定值
                    dev[`${ch}Current`] = results[`pid.${ch}VSourceIdx`] || 0;
                }
            } else {
                dev[`${ch}Current`] = 0;
            }
        });

        // --- PI1 & NI1: 4-20mA 输入供电端 ---
        const vPi1 = getV(dev.id, 'pi1');
        const vNi1 = getV(dev.id, 'ni1');
        if (vPi1 !== undefined && vNi1 !== undefined) {
            // 输入回路电流 I = V / 250Ω (标准 4-20mA 回路电阻)
            dev.pi1Current = vNi1 / 250;
        } else {
            dev.pi1Current = 0;
        }

        // --- VCC & GND: 电源供电端 ---
        const vVcc = getV(dev.id, 'vcc');
        const vGnd = getV(dev.id, 'gnd');
        if (vVcc !== undefined && vGnd !== undefined) {
            // 电源消耗电流 I = V / 50Ω (内部电路阻抗)
            dev.vccCurrent = (vVcc - vGnd) / 50;
        } else {
            dev.vccCurrent = 0;
        }
    }

    /**
     * AI 模块通道详细更新
     */
    _updateAIChannels(dev, getV) {
        // 4-20mA 通道 (CH1, CH2)
        [1, 2].forEach(i => {
            const vn = getV(dev.id, `ch${i}n`);
            if (vn !== undefined) {
                dev[`ch${i}Current`] = vn / 250;
                dev.setRaw(`ch${i}`, dev[`ch${i}Current`] * 1000);
            } else {
                dev.setRaw(`ch${i}`, 0);
            }
        });

        // RTD 通道 (CH3)
        const v3p = getV(dev.id, 'ch3p'), v3n = getV(dev.id, 'ch3n');
        
        if (v3p !== undefined && v3n !== undefined) {
            let req = 1e9;
            const vDiff =v3p-v3n;
            if(Math.abs(10-vDiff)>0.05){
                req = 1e4*vDiff/(10-vDiff);
            }
            dev.setRaw('ch3', req);
        }else{
            dev.setRaw('ch3', 1e9);
        }

        // TC 通道 (CH4)
        const v4p = getV(dev.id, 'ch4p'), v4n = getV(dev.id, 'ch4n');
        if (v4p !== undefined && v4n !== undefined) {
            dev.setRaw('ch4', (v4p - v4n) * 1000);
        }else{
            dev.setRaw('ch4', -100);
        }
    }
    /**
     * AO 模块通道详细更新逻辑
     * @param {Object} dev 模块实例
     * @param {Function} getV 电压获取辅助函数
     */
    _updateAOChannels(dev, getV) {
        // --- CH1 & CH2: 4-20mA 电流输出通道 ---
        // 对于 AO 模块，实际电流通常由内部设定值 (actual) 决定
        // 但在仿真中，我们需要确保外部电路是闭合的
        [1, 2].forEach(i => {
            const pPort = `ch${i}p`;
            const nPort = `ch${i}n`;
            const vP = getV(dev.id, pPort);
            const vN = getV(dev.id, nPort);

            if (vP !== undefined && vN !== undefined) {
                // 如果回路闭合，电流等于通道的设定输出值
                dev[`ch${i}Current`] = dev.channels[`ch${i}`].actual / 1000;
            } else {
                // 如果回路断开，实际电流为 0
                dev[`ch${i}Current`] = 0;
            }
        });

        // --- CH3 & CH4: PWM 或 电压输出通道 ---
        // 这类通道通常需要根据负载电阻来计算消耗的电流
        [3, 4].forEach(i => {
            const vP = getV(dev.id, `ch${i}p`);
            const vN = getV(dev.id, `ch${i}n`);

            if (vP !== undefined && vN !== undefined) {
                // 获取外部负载的等效电阻
                const rLoad = this._getEquivalentResistanceFromPorts(dev.id, `ch${i}p`, `ch${i}n`);
                // I = ΔV / R_load
                dev[`ch${i}Current`] = (vP - vN) / Math.max(0.1, rLoad);
            } else {
                dev[`ch${i}Current`] = 0;
            }
        });
    }

    /**
     * DO 模块通道详细更新逻辑
     * @param {Object} dev 模块实例
     * @param {Function} getV 电压获取辅助函数
     */
    _updateDOChannels(dev, getV) {
        // --- CH1 & CH2: 普通开关量输出 ---
        [1, 2].forEach(i => {
            const vP = getV(dev.id, `ch${i}p`);
            const vN = getV(dev.id, `ch${i}n`);

            if (vP !== undefined && vN !== undefined) {
                // dev.ch1R / dev.ch2R 动态反映了开关状态：
                // 闭合时为极小值（如 0.1Ω），断开时为极大值（如 10MΩ）
                const R = dev[`ch${i}R`] || 1000000;
                dev[`ch${i}Current`] = (vP - vN) / R;
            } else {
                dev[`ch${i}Current`] = 0;
            }
        });

        // --- CH3 & CH4: PWM 功率输出通道 ---
        [3, 4].forEach(i => {
            const vP = getV(dev.id, `ch${i}p`);
            const vN = getV(dev.id, `ch${i}n`);

            if (vP !== undefined && vN !== undefined) {
                // PWM 通道的电流计算依赖于负载
                const rLoad = this._getEquivalentResistanceFromPorts(dev.id, `ch${i}p`, `ch${i}n`);
                dev[`ch${i}Current`] = (vP - vN) / Math.max(0.1, rLoad);
            } else {
                dev[`ch${i}Current`] = 0;
            }
        });
    }
    /**
     * 过程校验仪详细更新逻辑
     */
    _updateCalibratorCurrents(dev, getV, results) {
        const p = dev.id;
        // 上部测量面板
        if (dev.upMode === 'MEAS_LOOP') {
            dev.upCurrent = (getV(p, 'meas_com') || 0) / 250;
        } else if (dev.upMode === 'MEAS_MA') {
            dev.upCurrent = ((getV(p, 'meas_ma') || 0) - (getV(p, 'meas_com') || 0)) / 250;
        } else {
            dev.upCurrent = 0;
        }

        // 下部活动面板
        if (dev.activePanel === 'MEASURE') {
            if (dev.measureMode.startsWith('MEAS_MA')) {
                dev.maCurrent = ((getV(p, 'src_ma') || 0) - (getV(p, 'src_com') || 0)) / 250;
                dev.vCurrent = 0;
            } else if (dev.measureMode === 'MEAS_LOOP') {
                dev.maCurrent = (getV(p, 'src_com') || 0) / 250;
                dev.vCurrent = 0;
            } else if (dev.measureMode === 'MEAS_RTD' || dev.measureMode === 'MEAS_R') {
                const r = this._getEquivalentResistanceFromPorts(p, 'src_v', 'src_com');
                dev.vCurrent = ((getV(p, 'src_v') || 0) - (getV(p, 'src_com') || 0)) / r;
                dev.maCurrent = 0;
            } else {
                dev.maCurrent = 0;
                dev.vCurrent = 0;
            }
        } else {
            if (dev.sourceMode === 'SRC_LOOP') {
                const vP = getV(dev.id, `src_ma`) ?? 0;
                const vN = getV(dev.id, `src_com`) ?? 0;
                dev._lastVDiff = vP - vN;  //这是变送器类型的状态回填，必须、重要！！！
                dev.maCurrent = dev._lastG * dev._lastVDiff;
                dev.vCurrent = 0;
            } else if (dev.sourceMode === 'SRC_MA') {
                dev.maCurrent = dev.sourceValue / 1000;
                dev.vCurrent = 0;
            } else if (dev.sourceMode === 'SRC_R' || dev.sourceMode === 'SRC_RTD') {
                dev.maCurrent = 0
                const vP = getV(dev.id, `src_v`) ?? 0;
                const vN = getV(dev.id, `src_com`) ?? 0;
                let R = dev.sourceValue;
                if (dev.sourceMode === 'SRC_RTD') R = dev._tempToRTDOhm(dev.sourceValue);
                dev.vCurrent = (vP - vN) / R;
            } else if (dev.sourceMode === 'SRC_V') {
                dev.maCurrent = 0;
                dev.vCurrent = results[dev.currentIdx];
            } else if (dev.sourceMode === 'SRC_HZ') {
                dev.maCurrent = 0
                const vP = getV(dev.id, `src_v`) ?? 0;
                const vN = getV(dev.id, `src_com`) ?? 0;
                const voltage = dev.getSourceValue(this.currentTime);
                dev.vCurrent = (voltage - (vP - vN)) / (dev.rOn || 0.1);
            }

        }
    }

    /**
     * 辅助：通过端口名获取等效电阻
     */
    _getEquivalentResistanceFromPorts(devId, p1, p2) {
        const c1 = this.portToCluster.get(`${devId}_wire_${p1}`);
        const c2 = this.portToCluster.get(`${devId}_wire_${p2}`);
        if (c1 === undefined || c2 === undefined) return 1e9;
        return this._getEquivalentResistance(this.clusters[c1], this.clusters[c2], this.clusters);
    }
    // ═══════════════════════════════════════════════════════════════════════
    // 公开辅助方法（供 DeviceStamps 回调使用）
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

    getResistanceBetweenPorts(portA, portB) {
        const cA = this.portToCluster.get(portA);
        const cB = this.portToCluster.get(portB);
        if (cA === undefined || cB === undefined) return Infinity;
        return this._getEquivalentResistance(this.clusters[cA], this.clusters[cB], this.clusters);
    }

    isPortConnected(pA, pB) {
        return CircuitUtils.isPortConnected(pA, pB, this.portToCluster, this.clusters, this.rawDevices, this._equivResCache);
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
