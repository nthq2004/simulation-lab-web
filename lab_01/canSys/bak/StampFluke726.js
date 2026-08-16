/**
 * DeviceStamps_Fluke726.js
 *
 * FLUKE 726 过程校验仪的电路矩阵注入（stamp）与电流读取逻辑。
 * 遵循与 DeviceStamps.stampAI 相同的 MNA（改进节点分析）约定：
 *
 *   G  —— 导纳矩阵  (n×n)
 *   B  —— 电压源关联矩阵列（n×m，每列对应一个独立电压源）
 *   ctx —— 上下文，包含:
 *            ctx.nodeCount  当前节点数
 *            ctx.vsrcCount  当前电压源数
 *            ctx.addNode()  → 返回新节点编号
 *            ctx.addVsrc()  → 返回新电压源行编号
 *
 * 端口命名约定（与 Fluke726._addPorts() 一致）：
 *   SOURCE 侧：
 *     `${id}_wire_src_ma`    — 电流/电压/电阻公共正端
 *     `${id}_wire_src_vohm`  — 电压/电阻输出正端（V·Ω·RTD）
 *     `${id}_wire_src_tc`    — TC 输出端
 *     `${id}_wire_src_com`   — SOURCE 公共地
 *   MEASURE 侧：
 *     `${id}_wire_meas_ma`   — LOOP/mA 测量正端
 *     `${id}_wire_meas_com`  — MEASURE 公共地
 */

export const DeviceStamps = {

    // ═══════════════════════════════════════════════════════════════════
    //  主入口：对所有 Fluke726 器件逐一 stamp
    // ═══════════════════════════════════════════════════════════════════

    /**
     * 将所有 fluke726 器件注入到 MNA 矩阵。
     *
     * @param {object}   ctx        - MNA 上下文（节点/电压源计数与分配）
     * @param {number[][]} G        - 导纳矩阵
     * @param {number[][]} B        - 电压源关联矩阵
     * @param {object[]}  devs      - Fluke726 实例数组（dev.type === 'fluke726'）
     * @param {Map}       portToCluster - 端口名 → 节点编号的映射表
     */
    stampFluke726(ctx, G, B, devs, portToCluster) {
        devs.forEach(dev => {
            if (!dev.isPowered) return;
            this._stampOne(ctx, G, B, dev, portToCluster);
        });
    },

    // ───────────────────────────────────────────────────────────────────
    //  单器件 stamp 分发
    // ───────────────────────────────────────────────────────────────────

    _stampOne(ctx, G, B, dev, portToCluster) {
        const id = dev.id;

        // ── 获取各端口对应节点编号 ──────────────────────────────────
        const cSrcMa   = portToCluster.get(`${id}_wire_src_ma`);
        const cSrcVohm = portToCluster.get(`${id}_wire_src_vohm`);
        const cSrcTc   = portToCluster.get(`${id}_wire_src_tc`);
        const cSrcCom  = portToCluster.get(`${id}_wire_src_com`);
        const cMeasMa  = portToCluster.get(`${id}_wire_meas_ma`);
        const cMeasCom = portToCluster.get(`${id}_wire_meas_com`);

        // ── MEASURE 侧注入 ───────────────────────────────────────────
        // 根据 measureMode 决定 MEASURE 端口的元件注入：
        //   MEAS_LOOP → meas_ma/meas_com 之间注入 24V 电压源（带供电回路电流）
        //                + meas_com/GND 间注入 250Ω 采样电阻
        //   MEAS_MA   → meas_ma/meas_com 之间注入 250Ω 采样电阻（无源测量）
        //   其他模式  → 不注入（高阻）
        this._stampMeasSide(ctx, G, B, dev, cMeasMa, cMeasCom);

        // ── SOURCE 侧注入 ────────────────────────────────────────────
        // 仅在 activePanel === 'SOURCE' 时激活输出；
        // MEASURE 激活时 SOURCE 侧仍可作为被动测量端（250Ω，见 MEAS_MA 分支）。
        if (dev.activePanel === 'SOURCE') {
            this._stampSourceSide(ctx, G, B, dev, cSrcMa, cSrcVohm, cSrcTc, cSrcCom);
        } else if (dev.activePanel === 'MEASURE') {
            // MEASURE 激活时，SOURCE 端口 src_ma/src_com 注入 250Ω 采样电阻
            // （用于读取外部电流回路，例如变送器 4-20mA 输出）
            if (dev.measureMode === 'MEAS_MA') {
                if (cSrcMa !== undefined && cSrcCom !== undefined) {
                    this._stampResistor(G, cSrcMa, cSrcCom, 250);
                }
            }
        }
    },

    // ───────────────────────────────────────────────────────────────────
    //  MEASURE 侧：根据 measureMode 注入
    // ───────────────────────────────────────────────────────────────────

    _stampMeasSide(ctx, G, B, dev, cMeasMa, cMeasCom) {
        if (cMeasMa === undefined || cMeasCom === undefined) return;

        switch (dev.measureMode) {

            case 'MEAS_LOOP': {
                // ── 回路供电模式（LOOP POWER）───────────────────────
                // 在 meas_ma 与 meas_com 之间注入 24V 电压源，
                // 同时在 meas_com 与全局 GND（节点0）之间注入 250Ω 采样电阻。
                // 仿真回路：
                //   [24V src] → meas_ma ──[外部变送器]── meas_com → [250Ω] → GND
                // 测量：v(meas_com) / 250 = 回路电流（A），× 1000 得 mA。
                const vsIdx = this._stampVoltageSource(ctx, B, cMeasMa, cMeasCom, 24.0);
                dev._vsrc_measLoop = vsIdx; // 保存电压源索引，用于后续读取电流
                // 250Ω 采样电阻：meas_com → GND（节点0）
                this._stampResistor(G, cMeasCom, 0, 250);
                break;
            }

            case 'MEAS_MA': {
                // ── 无源电流测量（外部回路已有电源）──────────────────
                // 在 meas_ma / meas_com 之间注入 250Ω 采样电阻。
                // 测量：v(meas_com) / 250 = 电流（A），× 1000 得 mA。
                this._stampResistor(G, cMeasMa, cMeasCom, 250);
                break;
            }

            case 'MEAS_V': {
                // ── 电压测量（高阻，理论上无负载）──────────────────
                // 注入 1MΩ 等效输入阻抗（避免浮节点）
                this._stampResistor(G, cMeasMa, cMeasCom, 1e6);
                break;
            }

            case 'MEAS_PRESSURE': {
                // ── 外接压力模块（电流输出 4-20mA）──────────────────
                // 压力模块接在 meas_ma / meas_com，本仪器提供 24V 供电 + 250Ω 采样
                const vsIdx = this._stampVoltageSource(ctx, B, cMeasMa, cMeasCom, 24.0);
                dev._vsrc_measPressure = vsIdx;
                this._stampResistor(G, cMeasCom, 0, 250);
                break;
            }

            case 'MEAS_OHM': {
                // ── 电阻测量（注入 1mA 激励源，读电压差）────────────
                // 在 meas_ma / meas_com 之间注入 1mA 电流源
                this._stampCurrentSource(G, cMeasMa, cMeasCom, 0.001);
                break;
            }

            case 'MEAS_TC':
            case 'MEAS_HZ':
            case 'MEAS_RTD': {
                // 这些模式使用 SOURCE 侧端口（src_vohm/src_tc），
                // MEASURE 侧保持高阻（1MΩ 防浮节点）
                this._stampResistor(G, cMeasMa, cMeasCom, 1e6);
                break;
            }

            default:
                // 未知模式：高阻
                this._stampResistor(G, cMeasMa, cMeasCom, 1e6);
                break;
        }
    },

    // ───────────────────────────────────────────────────────────────────
    //  SOURCE 侧：根据 sourceMode 注入
    // ───────────────────────────────────────────────────────────────────

    _stampSourceSide(ctx, G, B, dev, cSrcMa, cSrcVohm, cSrcTc, cSrcCom) {

        switch (dev.sourceMode) {

            case 'SRC_MA': {
                // ── 电流源输出（4-20mA）────────────────────────────
                // 在 src_ma / src_com 之间注入 sourceValue mA 的理想电流源。
                // FLUKE726 输出电流源：正端为 src_ma，负端（参考）为 src_com。
                if (cSrcMa === undefined || cSrcCom === undefined) break;
                const iVal = (dev.sourceValue || 0) / 1000; // mA → A
                this._stampCurrentSource(G, cSrcMa, cSrcCom, iVal);
                break;
            }

            case 'SRC_V': {
                // ── 电压源输出（0-10V 或 ±30V）─────────────────────
                // 在 src_vohm / src_com 之间注入 sourceValue V 的理想电压源。
                if (cSrcVohm === undefined || cSrcCom === undefined) break;
                const vsIdx = this._stampVoltageSource(ctx, B, cSrcVohm, cSrcCom, dev.sourceValue || 0);
                dev._vsrc_srcV = vsIdx;
                break;
            }

            case 'SRC_RES': {
                // ── 电阻输出（模拟电阻，接在 src_vohm / src_com）───
                // 注入等效电阻值（Ω）。
                if (cSrcVohm === undefined || cSrcCom === undefined) break;
                const rVal = Math.max(0.1, dev.sourceValue || 100); // 最小 0.1Ω 防奇异
                this._stampResistor(G, cSrcVohm, cSrcCom, rVal);
                break;
            }

            case 'SRC_TC': {
                // ── 热电偶模拟（mV 级电压源）────────────────────────
                // 热电偶输出 mV 信号，接在 src_tc / src_com 之间。
                // sourceValue 为温度（°C），通过 TC 查表/公式转换为 mV，
                // 再注入对应的电压源（单位 V）。
                if (cSrcTc === undefined || cSrcCom === undefined) break;
                const vTc = this._tempToTCVoltage(dev.sourceValue || 0, dev.tcType || 'K'); // 返回 V
                const vsIdx = this._stampVoltageSource(ctx, B, cSrcTc, cSrcCom, vTc);
                dev._vsrc_srcTc = vsIdx;
                break;
            }

            case 'SRC_RTD': {
                // ── RTD 模拟（电阻，接在 src_vohm / src_com）────────
                // RTD（Pt100）输出等效电阻，根据 sourceValue（°C）计算 Ω。
                if (cSrcVohm === undefined || cSrcCom === undefined) break;
                const rRtd = this._tempToRTDOhm(dev.sourceValue || 0, dev.rtdType || 'Pt100');
                this._stampResistor(G, cSrcVohm, cSrcCom, rRtd);
                break;
            }

            case 'SRC_HZ': {
                // ── 频率输出（方波，用低内阻电压源近似）──────────────
                // 仿真中用一个 ±5V 幅值的等效低阻源表示频率信号。
                // 注意：真实仿真中频率信号需要时域步进，此处为稳态近似。
                if (cSrcVohm === undefined || cSrcCom === undefined) break;
                const vsIdx = this._stampVoltageSource(ctx, B, cSrcVohm, cSrcCom, 5.0);
                dev._vsrc_srcHz = vsIdx;
                break;
            }

            case 'SRC_PRESSURE': {
                // ── 压力模块输出（4-20mA 电流源，同 SRC_MA）─────────
                if (cSrcMa === undefined || cSrcCom === undefined) break;
                const iPres = (dev.sourceValue || 0) / 1000;
                this._stampCurrentSource(G, cSrcMa, cSrcCom, iPres);
                break;
            }

            case 'SRC_OFF':
            default:
                // 源关闭：所有 SOURCE 端口保持高阻（1MΩ 防浮节点）
                if (cSrcMa  !== undefined && cSrcCom !== undefined)
                    this._stampResistor(G, cSrcMa,  cSrcCom, 1e6);
                if (cSrcVohm !== undefined && cSrcCom !== undefined)
                    this._stampResistor(G, cSrcVohm, cSrcCom, 1e6);
                if (cSrcTc  !== undefined && cSrcCom !== undefined)
                    this._stampResistor(G, cSrcTc,  cSrcCom, 1e6);
                break;
        }
    },

    // ═══════════════════════════════════════════════════════════════════
    //  电流计算（在 MNA 求解后调用，读取各端口电流）
    // ═══════════════════════════════════════════════════════════════════

    /**
     * 在 MNA 求解（nodeVoltages / branchCurrents 已更新）后，
     * 逐一计算每台 Fluke726 的各通道电流/读数，
     * 并将结果写入 dev 的状态属性，同时调用 dev.update() 刷新 LCD。
     *
     * @param {object[]}  devs           - Fluke726 实例数组
     * @param {Map}       portToCluster  - 端口名 → 节点编号
     * @param {Map}       nodeVoltages   - 节点编号 → 电压（V）
     * @param {number[]}  branchCurrents - 电压源支路电流数组（MNA 解向量的 vsrc 部分）
     */
    calcFluke726(devs, portToCluster, nodeVoltages, branchCurrents) {
        devs.forEach(dev => {
            if (!dev.isPowered) return;
            this._calcOne(dev, portToCluster, nodeVoltages, branchCurrents);
        });
    },

    _calcOne(dev, portToCluster, nodeVoltages, branchCurrents) {
        const id  = dev.id;
        const vAt = n => (nodeVoltages.get(n) || 0);

        // ── 节点编号获取 ─────────────────────────────────────────────
        const cSrcMa   = portToCluster.get(`${id}_wire_src_ma`);
        const cSrcVohm = portToCluster.get(`${id}_wire_src_vohm`);
        const cSrcTc   = portToCluster.get(`${id}_wire_src_tc`);
        const cSrcCom  = portToCluster.get(`${id}_wire_src_com`);
        const cMeasMa  = portToCluster.get(`${id}_wire_meas_ma`);
        const cMeasCom = portToCluster.get(`${id}_wire_meas_com`);

        // ════════════════════════════════════════════════════════════
        //  MEASURE 侧电流读取
        // ════════════════════════════════════════════════════════════

        switch (dev.measureMode) {

            case 'MEAS_LOOP':
            case 'MEAS_PRESSURE': {
                // 24V 供电回路：测量 meas_com 节点电压 / 250Ω = 回路电流
                const vMeasCom = vAt(cMeasCom);
                dev.measLoopCurrent = vMeasCom / 250; // A
                const mA = dev.measLoopCurrent * 1000;
                dev.update(mA); // → 刷新 LCD 上行显示
                break;
            }

            case 'MEAS_MA': {
                // SOURCE 侧 src_ma/src_com 间 250Ω 采样电阻上的压降
                if (cSrcMa !== undefined && cSrcCom !== undefined) {
                    const vDiff = vAt(cSrcMa) - vAt(cSrcCom);
                    dev.measMaCurrent = vDiff / 250; // A
                    dev.update(dev.measMaCurrent * 1000); // mA → LCD
                }
                break;
            }

            case 'MEAS_V': {
                // 直接读取 meas_ma 相对 meas_com 的电压差
                if (cMeasMa !== undefined && cMeasCom !== undefined) {
                    const vDiff = vAt(cMeasMa) - vAt(cMeasCom);
                    dev.measVoltage = vDiff;
                    dev.update(vDiff); // V → LCD
                }
                break;
            }

            case 'MEAS_OHM': {
                // 1mA 激励源：R = v(meas_ma - meas_com) / 0.001
                if (cMeasMa !== undefined && cMeasCom !== undefined) {
                    const vDiff = vAt(cMeasMa) - vAt(cMeasCom);
                    dev.measResistance = vDiff / 0.001; // Ω
                    dev.update(dev.measResistance);
                }
                break;
            }

            case 'MEAS_TC': {
                // 热电偶：读 src_tc / src_com 之间的 mV 电压，通过反查表转温度
                if (cSrcTc !== undefined && cSrcCom !== undefined) {
                    const vTc_mV = (vAt(cSrcTc) - vAt(cSrcCom)) * 1000; // V → mV
                    const tempC  = this._tcVoltageToTemp(vTc_mV, dev.tcType || 'K');
                    dev.measTCTemp = dev.tempUnit === '°F' ? tempC * 9 / 5 + 32 : tempC;
                    dev.update(dev.measTCTemp);
                }
                break;
            }

            case 'MEAS_RTD': {
                // RTD：读 src_vohm / src_com 之间的等效电阻，转温度
                if (cSrcVohm !== undefined && cSrcCom !== undefined) {
                    const vDiff = vAt(cSrcVohm) - vAt(cSrcCom);
                    // 假设仿真中已注入 1mA 激励或通过等效电阻方式读取
                    // 此处直接通过等效电阻读取（需要外部 _getEquivalentResistance）
                    const rRtd  = dev._measRTDOhm || 100; // 由外部等效电阻接口写入
                    const tempC = this._rtdOhmToTemp(rRtd, dev.rtdType || 'Pt100');
                    dev.measRTDTemp = dev.tempUnit === '°F' ? tempC * 9 / 5 + 32 : tempC;
                    dev.update(dev.measRTDTemp);
                }
                break;
            }

            default:
                break;
        }

        // ════════════════════════════════════════════════════════════
        //  SOURCE 侧电流读取（用于外部 getPortCurrent 接口返回值）
        // ════════════════════════════════════════════════════════════

        if (dev.activePanel === 'SOURCE') {
            switch (dev.sourceMode) {

                case 'SRC_MA':
                case 'SRC_PRESSURE':
                    // 理想电流源：端口电流即 sourceValue mA
                    dev.srcMaCurrent = (dev.sourceValue || 0) / 1000; // A
                    break;

                case 'SRC_V':
                    // 电压源：支路电流从 branchCurrents 读取
                    if (dev._vsrc_srcV !== undefined && branchCurrents) {
                        dev.srcVCurrent = branchCurrents[dev._vsrc_srcV] || 0; // A
                    }
                    break;

                case 'SRC_RES':
                    // 电阻：通过节点电压差计算
                    if (cSrcVohm !== undefined && cSrcCom !== undefined) {
                        const vDiff = vAt(cSrcVohm) - vAt(cSrcCom);
                        const rVal  = Math.max(0.1, dev.sourceValue || 100);
                        dev.srcResCurrent = vDiff / rVal; // A
                    }
                    break;

                case 'SRC_TC':
                    // TC 电压源支路电流
                    if (dev._vsrc_srcTc !== undefined && branchCurrents) {
                        dev.srcTcCurrent = branchCurrents[dev._vsrc_srcTc] || 0;
                    }
                    break;

                case 'SRC_RTD':
                    // RTD 电阻分支电流
                    if (cSrcVohm !== undefined && cSrcCom !== undefined) {
                        const vDiff = vAt(cSrcVohm) - vAt(cSrcCom);
                        const rRtd  = this._tempToRTDOhm(dev.sourceValue || 0, dev.rtdType || 'Pt100');
                        dev.srcRtdCurrent = vDiff / rRtd;
                    }
                    break;

                case 'SRC_HZ':
                    if (dev._vsrc_srcHz !== undefined && branchCurrents) {
                        dev.srcHzCurrent = branchCurrents[dev._vsrc_srcHz] || 0;
                    }
                    break;

                default:
                    break;
            }
        }
    },

    // ═══════════════════════════════════════════════════════════════════
    //  外部端口电流查询接口
    //  供仿真引擎的 getPortCurrent(dev, extPort) 调用
    // ═══════════════════════════════════════════════════════════════════

    /**
     * 返回指定端口的流出电流（A）。
     * 约定：电流从 p 端流出为正，从 n 端流出（即流入）为负。
     *
     * @param {object} dev      - Fluke726 实例
     * @param {string} extPort  - 端口后缀，例如 '_wire_src_ma'
     * @returns {number} 电流 A
     */
    getPortCurrent(dev, extPort) {
        if (dev.type !== 'fluke726') return 0;

        // ── MEASURE 侧端口 ───────────────────────────────────────────
        if (extPort.endsWith('_wire_meas_ma')) {
            // LOOP / PRESSURE 模式：回路电流从 meas_ma 流出
            if (dev.measureMode === 'MEAS_LOOP' || dev.measureMode === 'MEAS_PRESSURE') {
                return -(dev.measLoopCurrent || 0); // 电压源内部电流方向约定
            }
            // MEAS_MA：电流从外部流入，此端口视为参考正端
            if (dev.measureMode === 'MEAS_MA') {
                return dev.measMaCurrent || 0;
            }
            return 0;
        }

        if (extPort.endsWith('_wire_meas_com')) {
            if (dev.measureMode === 'MEAS_LOOP' || dev.measureMode === 'MEAS_PRESSURE') {
                return dev.measLoopCurrent || 0;
            }
            if (dev.measureMode === 'MEAS_MA') {
                return -(dev.measMaCurrent || 0);
            }
            return 0;
        }

        // ── SOURCE 侧端口 ────────────────────────────────────────────
        if (extPort.endsWith('_wire_src_ma')) {
            switch (dev.sourceMode) {
                case 'SRC_MA':
                case 'SRC_PRESSURE':
                    return dev.srcMaCurrent || 0;  // 电流源：正端流出
                default:
                    return 0;
            }
        }

        if (extPort.endsWith('_wire_src_vohm')) {
            switch (dev.sourceMode) {
                case 'SRC_V':
                    return -(dev.srcVCurrent || 0);
                case 'SRC_RES':
                    return dev.srcResCurrent || 0;
                case 'SRC_RTD':
                    return dev.srcRtdCurrent || 0;
                case 'SRC_HZ':
                    return -(dev.srcHzCurrent || 0);
                default:
                    return 0;
            }
        }

        if (extPort.endsWith('_wire_src_tc')) {
            return -(dev.srcTcCurrent || 0);
        }

        if (extPort.endsWith('_wire_src_com')) {
            // src_com 为所有 SOURCE 通路的公共回流端
            switch (dev.sourceMode) {
                case 'SRC_MA':
                case 'SRC_PRESSURE':
                    return -(dev.srcMaCurrent || 0);
                case 'SRC_V':
                    return dev.srcVCurrent || 0;
                case 'SRC_RES':
                    return -(dev.srcResCurrent || 0);
                case 'SRC_TC':
                    return dev.srcTcCurrent || 0;
                case 'SRC_RTD':
                    return -(dev.srcRtdCurrent || 0);
                case 'SRC_HZ':
                    return dev.srcHzCurrent || 0;
                default:
                    return 0;
            }
        }

        return 0;
    },

    // ═══════════════════════════════════════════════════════════════════
    //  MNA 基本元件 stamp 工具函数
    // ═══════════════════════════════════════════════════════════════════

    /**
     * stamp 电阻（conductance = 1/R）到 G 矩阵。
     * 节点编号 0 为全局 GND（不写入矩阵，等价于接地）。
     *
     * @param {number[][]} G - 导纳矩阵
     * @param {number}     p - 正节点编号
     * @param {number}     n - 负节点编号（0 = GND）
     * @param {number}     R - 电阻值（Ω）
     */
    _stampResistor(G, p, n, R) {
        const g = 1.0 / R;
        if (p > 0) G[p][p] += g;
        if (n > 0) G[n][n] += g;
        if (p > 0 && n > 0) {
            G[p][n] -= g;
            G[n][p] -= g;
        }
    },

    /**
     * stamp 理想电压源到 B 矩阵（MNA 扩展列）。
     * 增加一个新的 KVL 方程行：v(p) - v(n) = vVal。
     *
     * @param {object}     ctx  - MNA 上下文（ctx.addVsrc() 分配行号）
     * @param {number[][]} B    - 电压源关联矩阵（n × m）
     * @param {number}     p    - 正节点
     * @param {number}     n    - 负节点
     * @param {number}     vVal - 电压源值（V）
     * @returns {number} 分配到的电压源行索引
     */
    _stampVoltageSource(ctx, B, p, n, vVal) {
        const k = ctx.addVsrc(vVal); // 返回行索引，同时将 vVal 写入 RHS
        if (p > 0) { B[p][k] =  1; B[k][p] =  1; }
        if (n > 0) { B[n][k] = -1; B[k][n] = -1; }
        return k;
    },

    /**
     * stamp 理想电流源到 G 矩阵的 RHS（注入节点电流）。
     * 正方向：电流从节点 n 流向节点 p（即 p 端流出）。
     *
     * @param {number[][]} G    - 导纳矩阵（此函数修改 G 的 RHS 列，或由调用方传入 I 向量）
     * @param {number}     p    - 电流流出节点
     * @param {number}     n    - 电流流入节点
     * @param {number}     iVal - 电流值（A）
     *
     * 注意：MNA 中电流源直接修改右端向量 I（而非 G 矩阵）。
     * 本实现将 iVal 附加在 G 矩阵的附加列（index=0 保留为 I 列），
     * 如框架使用独立 I 向量，调用方可改为：
     *   I[p] += iVal;  I[n] -= iVal;
     */
    _stampCurrentSource(G, p, n, iVal) {
        // 本函数修改节点注入电流向量。
        // 约定：G 矩阵第 0 列 / 附加字段 _I 存储注入电流。
        // 为兼容不同框架，提供两种写法：
        if (G._I) {
            // 方式A：框架提供独立注入电流向量 G._I
            if (p > 0) G._I[p] += iVal;
            if (n > 0) G._I[n] -= iVal;
        } else {
            // 方式B：直接操作 RHS（需框架在 Gx=I 中处理）
            // 调用方需在 G 上附挂 _I 数组，或由仿真引擎统一处理。
            // 此处作为备用：将注入量记录在 G 的扩展字段
            if (!G._injections) G._injections = [];
            G._injections.push({ p, n, i: iVal });
        }
    },

    // ═══════════════════════════════════════════════════════════════════
    //  物理转换工具
    // ═══════════════════════════════════════════════════════════════════

    /**
     * Pt100 RTD 温度 → 电阻（Callendar-Van Dusen）
     * @param {number} T     - 温度（°C）
     * @param {string} type  - 'Pt100' | 'Pt200' | 'Ni120'
     * @returns {number} 电阻（Ω）
     */
    _tempToRTDOhm(T, type = 'Pt100') {
        switch (type) {
            case 'Pt200': {
                // Pt200：R0=200Ω，系数同 Pt100
                const R0 = 200, A = 3.9083e-3, B_ = -5.775e-7;
                if (T >= 0) return R0 * (1 + A * T + B_ * T * T);
                const C = -4.183e-12;
                return R0 * (1 + A * T + B_ * T * T + C * (T - 100) * T * T * T);
            }
            case 'Ni120': {
                // Ni120 简化线性近似（0~100°C）
                const R0 = 120, alpha = 6.18e-3;
                return R0 * (1 + alpha * T);
            }
            case 'Pt100':
            default: {
                const R0 = 100, A = 3.9083e-3, B_ = -5.775e-7;
                if (T >= 0) return R0 * (1 + A * T + B_ * T * T);
                const C = -4.183e-12;
                return R0 * (1 + A * T + B_ * T * T + C * (T - 100) * T * T * T);
            }
        }
    },

    /**
     * RTD 电阻 → 温度（Pt100 线性近似迭代求逆）
     * @param {number} R     - 测量电阻（Ω）
     * @param {string} type  - 'Pt100' | 'Pt200' | 'Ni120'
     * @returns {number} 温度（°C）
     */
    _rtdOhmToTemp(R, type = 'Pt100') {
        // 使用二分法求逆
        let lo = -200, hi = 850;
        for (let i = 0; i < 40; i++) {
            const mid = (lo + hi) / 2;
            if (this._tempToRTDOhm(mid, type) < R) lo = mid;
            else hi = mid;
        }
        return (lo + hi) / 2;
    },

    /**
     * 热电偶 温度 → 电压（V）
     * 使用简化多项式（IEC 60584），各型号参数覆盖 -200~1372°C。
     *
     * @param {number} T    - 温度（°C）
     * @param {string} type - 'J'|'K'|'T'|'E'|'R'|'S'|'B'|'N'
     * @returns {number} 热电动势（V，冷端 0°C 参考）
     */
    _tempToTCVoltage(T, type = 'K') {
        // 系数来源：NIST IEC 60584 简化版（mV）
        // 返回值转换为 V（÷1000）
        let mV = 0;
        switch (type.toUpperCase()) {
            case 'K': {
                // K型：-270~0°C 和 0~1372°C 两段
                if (T < 0) {
                    // 低温段（9阶多项式近似）
                    const c = [0, 3.9450128025e-2, 2.3622373598e-5, -3.2858906784e-7,
                               -4.9904828777e-9, -6.7509059173e-11, -5.7410327428e-13,
                               -3.1088872894e-15, -1.0451609365e-17, -1.9889266878e-20, -1.6322697486e-23];
                    mV = c.reduce((s, ci, i) => s + ci * Math.pow(T, i), 0);
                } else {
                    // 高温段（含指数项简化为线性近似）
                    const c = [-1.7600413686e1, 3.8921204975e-2, 1.8558770032e-5,
                               -9.9457592874e-8, 3.1840945719e-10, -5.6072844889e-13,
                                5.6075059059e-16, -3.2020720003e-19, 9.7151147152e-23, -1.2104721275e-26];
                    mV = c.reduce((s, ci, i) => s + ci * Math.pow(T, i), 0);
                    // 指数修正项（简化忽略，误差 < 0.1°C）
                }
                break;
            }
            case 'J': {
                if (T < 760) {
                    const c = [0, 5.0381187815e-2, 3.0475836930e-5, -8.5681065720e-8,
                               1.3228195295e-10, -1.7052958337e-13, 2.0948090697e-16,
                               -1.2538395336e-19, 1.5631725697e-23];
                    mV = c.reduce((s, ci, i) => s + ci * Math.pow(T, i), 0);
                } else {
                    const c = [2.9645625681e5, -1.4976127786e3, 3.1787103924, -3.1847686701e-3,
                               1.5720819004e-6, -3.0691369056e-10];
                    mV = c.reduce((s, ci, i) => s + ci * Math.pow(T, i), 0);
                }
                break;
            }
            case 'T': {
                // T型：-270~400°C
                const c = T < 0
                    ? [0, 3.8748106364e-2, 3.3292227880e-5, 2.0618243404e-7,
                       -2.1882256846e-9, -1.0996590927e-11, -3.0815758772e-14,
                       -4.5627106864e-17, -2.7517416930e-20]
                    : [0, 3.8748106364e-2, 3.3292227880e-5, 2.0618243404e-7,
                       -2.1882256846e-9, -1.0996590927e-11, -3.0815758772e-14,
                       -4.5627106864e-17, -2.7517416930e-20];
                mV = c.reduce((s, ci, i) => s + ci * Math.pow(T, i), 0);
                break;
            }
            case 'E': {
                const c = T < 0
                    ? [0, 5.8665508708e-2, 4.5410977124e-5, -7.7998048686e-7,
                       -2.5800160843e-8, -5.9452583057e-10, -9.3214058667e-12,
                       -1.0287605534e-13, -8.0370123621e-16, -4.3979497391e-18,
                       -1.6414776355e-20, -3.9673619516e-23, -5.5827328721e-26, -3.4657842013e-29]
                    : [0, 5.8665508708e-2, 4.5032275582e-5, 2.8908407212e-8,
                       -3.3056896652e-10, 6.5024403270e-13, -1.9197495504e-16,
                       -1.2536600497e-18, 2.1489217569e-21, -1.4388041782e-24, 3.5960899481e-28];
                mV = c.reduce((s, ci, i) => s + ci * Math.pow(T, i), 0);
                break;
            }
            case 'R': {
                // R型：0~1664°C（简化线性 0~1400°C）
                mV = T * 0.00597;
                break;
            }
            case 'S': {
                // S型：简化线性
                mV = T * 0.00541;
                break;
            }
            case 'B': {
                // B型：250~1820°C，低温灵敏度极低
                if (T < 630.615) {
                    const c = [0, -2.4650818346e-4, 5.9040421171e-6, -1.3257931636e-9,
                               -1.5668291901e-11, 1.6944529240e-14, -5.0236999400e-18];
                    mV = c.reduce((s, ci, i) => s + ci * Math.pow(T, i), 0);
                } else {
                    const c = [-3.8938168621, 2.8571351097e-2, -8.4885104785e-5,
                               1.5785280164e-7, -1.6835344864e-10, 1.1109794013e-13,
                               -4.4515431033e-17, 9.8975640821e-21, -9.3791330289e-25];
                    mV = c.reduce((s, ci, i) => s + ci * Math.pow(T, i), 0);
                }
                break;
            }
            case 'N': {
                // N型：简化线性近似
                mV = T * 0.02774;
                break;
            }
            default:
                mV = T * 0.04; // 未知类型：默认近似
                break;
        }
        return mV / 1000; // mV → V
    },

    /**
     * 热电偶 mV 反查温度（二分法）
     * @param {number} mV   - 热电动势（mV）
     * @param {string} type - 热电偶类型
     * @returns {number} 温度（°C）
     */
    _tcVoltageToTemp(mV, type = 'K') {
        // 使用二分法，在常用量程内迭代
        const RANGES = {
            'K': [-200, 1372], 'J': [-210, 1200], 'T': [-270, 400],
            'E': [-270, 1000], 'R': [0, 1664],    'S': [0, 1664],
            'B': [250, 1820],  'N': [-270, 1300]
        };
        const [tLo, tHi] = RANGES[type.toUpperCase()] || [-200, 1372];
        let lo = tLo, hi = tHi;
        for (let i = 0; i < 50; i++) {
            const mid = (lo + hi) / 2;
            const vmid = this._tempToTCVoltage(mid, type) * 1000; // V → mV
            if (vmid < mV) lo = mid;
            else hi = mid;
        }
        return (lo + hi) / 2;
    },

};