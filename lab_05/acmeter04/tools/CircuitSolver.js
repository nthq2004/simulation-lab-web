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
            power3Devs:       raw.filter(d => d.type === 'source_3p'),
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
            relayDevs:        raw.filter(d => d.type === 'relay' && d.special === 'voltage'),
            aiDevs:           raw.filter(d => d.type === 'AI'),
            pcDevs:           raw.filter(d => d.type === 'calibrator'),
            aoDevs:           raw.filter(d => d.type === 'AO'),
            diDevs:           raw.filter(d => d.type === 'DI'),
            doDevs:           raw.filter(d => d.type === 'DO'),
            dcDevs:           raw.filter(d => d.special === 'dc_source'),
            mf47Devs:         raw.filter(d => d.type === 'mf47'),
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
            ctDevs:           raw.filter(d => d.special === 'CURRENT_TRANSFORMER'),
            potentialTransformerDevs: raw.filter(d => d.special === 'POTENTIAL_TRANSFORMER'),
        };
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 主循环
    // ═══════════════════════════════════════════════════════════════════════
    update() {
        //        console.log(sys.comps,this.rawDevices); 前者是对象形式，后者是数字形式。

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
                if (d.type === 'switch' || (d.type === 'relay' && d.special !== 'voltage')) {
                    resistSigs.push(`${d.id}:on=${d.isOn}`);
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
            pcDevs, aoDevs, diDevs, doDevs, dcDevs, mf47Devs, ne555Devs, ccDevs,
            motorDevs, scrDevs, triacDevs, igbtDevs, mosfetDevs, ujtDevs,
            acAmmeterDevs, acVoltmeterDevs, ctDevs, potentialTransformerDevs,
        } = this._deviceCache;

        this._cachedDevs = this._deviceCache;

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

        // ---总的方程数量。
        const totalSize = mSize + pidEqCount + opAmps.length + oscDevs.length + lvdtDevs.length + aiEqCount + pcEqCount + dcEqCount + aoEqCount + doEqCount + acAmmEqCount + ctEqCount + ptEqCount;

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
        };

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
            // ─ 2. 压力传感器 ──────────────────────────────────────────────
            DeviceStamps.stampPressureSensors(ctx, G, B, pressDevs);
            // ─ 3. 变送器 ───────────────────────────────────────────────────
            DeviceStamps.stampTransmitters(ctx, G, B, transmitterDevs);
            // ─ 4. 电源 & 5. 三相电源（诺顿等效注入，不增加方程）──────────
            DeviceStamps.stampPowerSources(ctx, G, B, powerDevs, currentTime);
            DeviceStamps.stampPower3Sources(ctx, G, B, power3Devs, currentTime);

            // ─ 6. PID 控制器 ──────────────────────────────────────────────
            let pidVIdx = mSize;
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
            // ─ 16 电压型继电器（线圈电阻） ────────────────────────────────
            DeviceStamps.stampRelays(ctx, G, B, relayDevs);
            // ─ 17 AI 模块 ────────────────────────────────────────────────
            const aiVIdx = ptVIdx + lvdtDevs.length;
            DeviceStamps.stampAI(ctx, G, B, aiDevs, aiVIdx);
            // ─ 18 过程校验仪 ───────────────────────────────────────────────
            const pcVIdx = aiVIdx + aiEqCount;
            DeviceStamps.stampCalibrators(ctx, G, B, pcDevs, pcVIdx, currentTime);
            // ── DC 源注入（每个占用一个电压源方程）
            const dcVIdx = pcVIdx + pcEqCount;
            DeviceStamps.stampDCSources(ctx, G, B, dcDevs, dcVIdx);
            // ── 三相异步电动机对地绝缘电阻 ──
            DeviceStamps.stampMotors(ctx, G, B, motorDevs);
            // ─ 19 AO 模块 ────────────────────────────────────────────────
            const aoVIdx = pcVIdx + pcEqCount + dcEqCount;
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

            // - 23 交流电流表（0V 电压源注入）
            const acAmmVIdx = totalSize - acAmmEqCount - ctEqCount - ptEqCount;
            DeviceStamps.stampACAmmeters(ctx, G, B, acAmmeterDevs, acAmmVIdx);

            /**
             * ─ 23.5 电流互感器（CT）：原边 0V 电压源 + 副边受控源 ─────
             *
             *  stampCurrentTransformers 的详细注入策略见 DeviceStamps.js。
             *  简要总结：
             *    - 原边（P1-P2）：0V 电压源，acts as ammeter
             *    - 副边（S1-S2）：受控电流源 I₂ = I₁_prev / K，
             *      负载过高时切换为 ±1000V 电压源（顺从电压限制）
             *
             *  方程位置：CT 方程位于 ACAmmeter 方程之前、矩阵最末尾。
             *  ctVIdx = totalSize - ctEqCount 确保在总方程末尾预留空间。
             */
            const ctVIdx = totalSize - ctEqCount - ptEqCount;
            DeviceStamps.stampCurrentTransformers(ctx, G, B, ctDevs, ctVIdx);

            // ─ 23.7 电压互感器（PT）受控电压源注入 ────────────────────
            const potVIdx = totalSize - ptEqCount;
            DeviceStamps.stampPotentialTransformers(ctx, G, B, potentialTransformerDevs, potVIdx);

            // - 24 MF47 万用表等效注入
            DeviceStamps.stampMF47(ctx, G, B, mf47Devs);

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
                const MAX_STEP = 5.0;
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
            pcDevs, aoDevs, diDevs, doDevs, mf47Devs, ne555Devs, ccDevs,
            scrDevs, triacDevs, igbtDevs, mosfetDevs, ujtDevs,
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
                    dev.phaseCurrents[phase] = (vTarget - (vP - vN)) / (dev.rOn || 0.1);
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
        // ─ 16 电压型继电器线圈电流（对应 stampRelays）
        relayDevs.forEach(dev => {
            const vL = getV(dev.id, 'l');
            const vR = getV(dev.id, 'r');
            if (vL !== undefined && vR !== undefined) {
                dev.physCurrent = (vL - vR) / (dev.currentResistance || 1000);
            }
            const vNO = getV(dev.id, 'NO');
            const vCOM = getV(dev.id, 'COM');
            if (vNO !== undefined && vCOM !== undefined) {
                const R = dev.isEnergized ? 0.01 : 1e9;
                dev.contactCurrent = (vNO - vCOM) / R;
            }
        });

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
            if (extPort.endsWith('_l')) return -total;
            if (extPort.endsWith('_r')) return total;
            if (extPort.endsWith('_p')) return -dev.actCurrent;
            if (extPort.endsWith('_n')) return dev.actCurrent;      
            return 0;      
        }
        // ─ 16 电压型继电器线圈电流（对应 stampRelays）
        if (dev.type === 'relay' && dev.special === 'voltage') {
            const i = dev.physCurrent || 0;
            if (extPort.endsWith('_l')) return -i;
            if (extPort.endsWith('_r')) return i;
            if (extPort.endsWith('_NO')) return -dev.contactCurrent;
            if (extPort.endsWith('_COM')) return dev.contactCurrent;
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
            const i = dev.physCurrent || 0;
            if (extPort.endsWith('_n')) return i;
            if (extPort.endsWith('_p')) return -i;
            // NTC 温度变送器：l/r 是传感器输入端口，电流为 0（高阻输入）
            if (dev.special === 'ntc') {
                if (extPort.endsWith('_l') || extPort.endsWith('_r')) return 0;
            }
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
            // CH1 输出通道
            if (extPort.endsWith('_po1')) return dev.ch1Current || 0;
            if (extPort.endsWith('_no1')) return -(dev.ch1Current || 0);
            // CH2 输出通道
            if (extPort.endsWith('_po2')) return dev.ch2Current || 0;
            if (extPort.endsWith('_no2')) return -(dev.ch2Current || 0);
            // PI1 输入供电端
            if (extPort.endsWith('_pi1')) return dev.pi1Current || 0;
            if (extPort.endsWith('_ni1')) return -(dev.pi1Current || 0);
            // VCC 电源端
            if (extPort.endsWith('_vcc')) return -(dev.vccCurrent || 0);
            if (extPort.endsWith('_gnd')) return dev.vccCurrent || 0;
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
            if (extPort.endsWith('_OUT')) return -dev.physCurrent || 0;
        }
        // ─ 9. 二极管电流（对应 stampDiodes）
        if (dev.type === 'diode' || dev.type === 'zener' || dev.type === 'led' || dev.type === 'photodiode' || dev.type === 'diac') {
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
        // ─ 11.5 SCR 电流（对应 stampSCRs）
        if (dev.type === 'scr') {
            const i = dev.physCurrent || 0;
            if (extPort.endsWith('_a')) return -i;
            if (extPort.endsWith('_k')) return i;
            if (extPort.endsWith('_g')) return -(dev.gateCurrent || 0);
            return 0;
        }
        // ─ 11.55 TRIAC 电流（对应 stampTRIACs）
        if (dev.type === 'triac') {
            const i = dev.physCurrent || 0;
            if (extPort.endsWith('_mt2')) return -i;
            if (extPort.endsWith('_mt1')) return i;
            if (extPort.endsWith('_g')) return -(dev.gateCurrent || 0);
            return 0;
        }
        // ─ 11.6 IGBT 电流（对应 stampIGBTs）
        if (dev.type === 'igbt') {
            const i = dev.physCurrent || 0;
            if (extPort.endsWith('_c')) return -i;
            if (extPort.endsWith('_e')) return i;
            if (extPort.endsWith('_g')) return 0;
            return 0;
        }
        // ─ 11.7 MOSFET 电流（对应 stampMOSFETs）
        if (dev.type === 'mosfet') {
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
        // ─ 17. AI模块//19 AO模块 //20 DI模块 //21 DO模块（对应 stampAI,stampAO，stampDI）
        if (dev.type === 'AI' || dev.type === 'AO' || dev.type === 'DI' || dev.type === 'DO') {
            if (extPort.endsWith('_ch1p')) return dev.ch1Current || 0;
            if (extPort.endsWith('_ch1n')) return -(dev.ch1Current || 0);
            if (extPort.endsWith('_ch2p')) return dev.ch2Current || 0;
            if (extPort.endsWith('_ch2n')) return -(dev.ch2Current || 0);
            if (extPort.endsWith('_ch3p')) return dev.ch3Current || 0;
            if (extPort.endsWith('_ch3n')) return -(dev.ch3Current || 0);
            if (extPort.endsWith('_ch4p')) return dev.ch4Current || 0;
            if (extPort.endsWith('_ch4n')) return -(dev.ch4Current || 0);
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
                dev.type === 'diode' || dev.type === 'zener' || dev.type === 'led' || dev.type === 'photodiode' || dev.type === 'diac' || dev.type === 'bjt' || dev.type === 'njfet' ||
                dev.type === 'amplifier' || dev.type === 'signal_generator' ||
                dev.type === 'pressure_transducer' || dev.type === 'pressure_sensor' ||
                dev.type === 'oscilloscope' || dev.type === 'oscilloscope_tri' ||
                dev.type === 'capacitor' || dev.type === 'inductor' ||
                dev.type === 'AI' || dev.type === 'calibrator' || dev.type === 'AO' || (
                    dev.type === 'relay' && dev.special === 'voltage') ||
                dev.type === 'DI' || dev.type === 'DO' || dev.type === 'scr' || dev.type === 'igbt' || dev.type === 'mosfet' ;

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
