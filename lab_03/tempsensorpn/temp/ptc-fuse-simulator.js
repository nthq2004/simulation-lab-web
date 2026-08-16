/**
 * PTC自恢复保险丝仿真模块
 * 完整的热电模型仿真
 */

export class PTCResettableFuseSimulator {
    /**
     * @param {Object} config - 配置参数
     * @param {number} config.Vsupply - 供电电压 (V)
     * @param {number} config.Rload - 负载电阻 (Ω)
     * @param {number} config.Rmin - PTC最小电阻 (Ω)
     * @param {number} config.Rmax - PTC最大电阻 (Ω)
     * @param {number} config.Tswitch - 切换温度 (°C)
     * @param {number} config.Tcurie - 居里温度 (°C)
     * @param {number} config.Tambient - 环境温度 (°C)
     * @param {number} config.thermalCap - 热容量 (J/°C)
     * @param {number} config.thermalRes - 热阻 (°C/W)
     */
    constructor(config = {}) {
        // 电气参数
        this.Vsupply = config.Vsupply || 12;        // 供电电压
        this.Rload = config.Rload || 5;             // 负载电阻
        this.Rmin = config.Rmin || 10;              // PTC最小电阻
        this.Rmax = config.Rmax || 1e6;             // PTC最大电阻
        this.Tswitch = config.Tswitch || 80;        // NTC->PTC切换温度
        this.Tcurie = config.Tcurie || 110;         // 居里温度（最大电阻点）
        this.alphaNTC = config.alphaNTC || 0.02;    // NTC区衰减系数
        
        // 热学参数
        this.Tambient = config.Tambient || 25;      // 环境温度
        this.thermalCap = config.thermalCap || 0.5; // 热容量 J/°C
        this.thermalRes = config.thermalRes || 15;  // 热阻 °C/W
        this.surfaceArea = config.surfaceArea || 100; // 散热面积 mm²
        
        // 工作状态
        this.temperature = this.Tambient;           // 当前温度
        this.resistance = this.Rmin;                // 当前电阻
        this.current = 0;                           // 电流
        this.voltage = 0;                           // 电压
        this.power = 0;                             // 功率
        this.state = 'normal';                      // 工作状态
        
        // 时间跟踪
        this.time = 0;
        this.timeInState = {};
        
        // 故障计数
        this.faultCount = 0;
        this.protectionCount = 0;
    }
    
    /**
     * 计算PTC电阻值基于温度
     * @param {number} T - 温度 (°C)
     * @returns {number} 电阻值 (Ω)
     */
    calculateResistance(T) {
        if (T < this.Tswitch) {
            // 第一区：NTC区（低温）
            // R(T) = Rmin × exp[-α×(T-Tswitch)]
            // 电阻轻微下降
            const exponent = -this.alphaNTC * (T - this.Tswitch);
            return this.Rmin * Math.exp(exponent);
            
        } else if (T >= this.Tswitch && T <= this.Tcurie) {
            // 第二区：居里点突变区（关键区）
            // R(T) = Rmin × exp[β×(T-Tswitch)²]
            // 电阻急剧增大（指数增长）
            const dT = T - this.Tswitch;
            const dTmax = this.Tcurie - this.Tswitch;
            const beta = Math.log(this.Rmax / this.Rmin) / (dTmax * dTmax);
            
            return this.Rmin * Math.exp(beta * dT * dT);
            
        } else {
            // 第三区：高温饱和区
            // 电阻达到最大值后略微下降
            const excessT = T - this.Tcurie;
            const decay = Math.max(0.1, 1 - excessT / 100);
            return this.Rmax * decay;
        }
    }
    
    /**
     * 计算焦耳热功率
     * @returns {number} 功率 (W)
     */
    getJouleHeating() {
        return Math.pow(this.current, 2) * this.resistance;
    }
    
    /**
     * 计算对流散热功率
     * @returns {number} 功率 (W)
     */
    getConvectiveHeating() {
        const deltaT = this.temperature - this.Tambient;
        return deltaT / this.thermalRes;
    }
    
    /**
     * 更新仿真状态
     * @param {number} dt - 时间步长 (秒)
     * @param {Object} externalParams - 外部参数修改
     */
    update(dt, externalParams = {}) {
        // 更新外部参数
        if (externalParams.Rload !== undefined) this.Rload = externalParams.Rload;
        if (externalParams.Vsupply !== undefined) this.Vsupply = externalParams.Vsupply;
        if (externalParams.Tambient !== undefined) this.Tambient = externalParams.Tambient;
        
        // 1. 计算电气量
        const totalR = this.resistance + this.Rload;
        this.current = this.Vsupply / totalR;
        this.voltage = this.current * this.resistance;
        this.power = this.current * this.voltage;
        
        // 2. 热动力学计算
        const heatingPower = this.getJouleHeating();      // 焦耳热输入 (W)
        const coolingPower = this.getConvectiveHeating(); // 对流散热 (W)
        const netPower = heatingPower - coolingPower;     // 净热功率 (W)
        
        // 3. 温度变化
        // dT/dt = P_net / C_th
        const tempChange = netPower * dt / this.thermalCap;
        this.temperature += tempChange;
        
        // 4. 确保温度下界
        this.temperature = Math.max(this.Tambient, this.temperature);
        
        // 5. 更新PTC电阻
        this.resistance = this.calculateResistance(this.temperature);
        
        // 6. 更新工作状态
        this.updateState();
        
        // 7. 累加时间
        this.time += dt;
    }
    
    /**
     * 更新工作状态机
     */
    updateState() {
        const prevState = this.state;
        const T = this.temperature;
        const I = this.current;
        
        if (T < this.Tswitch - 5) {
            // 明显低于切换点
            this.state = 'normal';
            
        } else if (T >= this.Tswitch - 5 && T < this.Tswitch + 10) {
            // 接近切换点
            this.state = 'transitioning';
            
        } else if (T >= this.Tswitch + 10 && T < this.Tcurie) {
            // 在居里点区间，限流中
            this.state = 'limiting';
            
        } else if (T >= this.Tcurie - 5) {
            // 达到或超过居里温度
            if (I < 0.05) {
                this.state = 'protected';
                this.protectionCount++;
            } else {
                this.state = 'limiting';
            }
            
        }
        
        if (prevState !== this.state) {
            if (!this.timeInState[this.state]) {
                this.timeInState[this.state] = 0;
            }
        }
    }
    
    /**
     * 获取状态信息
     * @returns {Object} 状态对象
     */
    getState() {
        return {
            temperature: this.temperature,
            resistance: this.resistance,
            current: this.current,
            voltage: this.voltage,
            power: this.power,
            state: this.state,
            time: this.time,
            protectionCount: this.protectionCount,
            ratio: (this.resistance / this.Rmin).toFixed(2)
        };
    }
    
    /**
     * 重置仿真
     */
    reset() {
        this.temperature = this.Tambient;
        this.resistance = this.Rmin;
        this.current = 0;
        this.voltage = 0;
        this.power = 0;
        this.state = 'normal';
        this.time = 0;
        this.protectionCount = 0;
    }
}

/**
 * PTC保护电路分析
 */
export class PTCProtectionCircuitAnalyzer {
    /**
     * 分析过流保护特性
     * @param {number} Ilimit - 过流阈值 (A)
     * @param {PTCResettableFuseSimulator} ptc - PTC仿真器
     * @returns {Object} 分析结果
     */
    static analyzeProtectionCharacteristics(Ilimit, ptc) {
        const analysis = {
            normalOperatingCurrent: ptc.Vsupply / (ptc.Rmin + ptc.Rload),
            triggerCurrent: Ilimit,
            protectionRatio: Ilimit / (ptc.Vsupply / (ptc.Rmin + ptc.Rload)),
            limitingResistance: ptc.Rmax,
            limitedCurrent: ptc.Vsupply / (ptc.Rmax + ptc.Rload),
            responseTime: null,
            recoveryTime: null
        };
        
        return analysis;
    }
    
    /**
     * 计算过流时的能量释放
     * @param {number} I - 故障电流 (A)
     * @param {number} R - PTC电阻 (Ω)
     * @param {number} t - 时间 (秒)
     * @returns {number} 能量 (焦耳)
     */
    static calculateEnergy(I, R, t) {
        return Math.pow(I, 2) * R * t;
    }
    
    /**
     * 验证PTC是否满足保护要求
     * @param {PTCResettableFuseSimulator} ptc - PTC仿真器
     * @param {Object} requirements - 需求
     * @returns {boolean} 是否满足
     */
    static verifyRequirements(ptc, requirements) {
        const analysis = this.analyzeProtectionCharacteristics(
            requirements.maxAllowableCurrent || 2.0,
            ptc
        );
        
        return analysis.limitedCurrent < requirements.maxAllowableCurrent;
    }
}

/**
 * 故障场景模拟
 */
export class FaultScenarios {
    /**
     * 场景1：短路故障
     */
    static shortCircuitScenario(ptc) {
        const results = [];
        const originalRload = ptc.Rload;
        
        ptc.Rload = 0.1; // 模拟短路
        
        for (let t = 0; t < 2; t += 0.01) {
            ptc.update(0.01);
            results.push({
                time: t,
                ...ptc.getState()
            });
        }
        
        ptc.Rload = originalRload; // 恢复
        return results;
    }
    
    /**
     * 场景2：过载故障
     */
    static overloadScenario(ptc) {
        const results = [];
        const originalRload = ptc.Rload;
        
        ptc.Rload = 1; // 增加负载
        
        for (let t = 0; t < 3; t += 0.01) {
            ptc.update(0.01);
            results.push({
                time: t,
                ...ptc.getState()
            });
        }
        
        ptc.Rload = originalRload; // 恢复
        return results;
    }
    
    /**
     * 场景3：自恢复过程
     */
    static recoveryScenario(ptc) {
        const results = [];
        const originalRload = ptc.Rload;
        
        // 第一阶段：短路
        ptc.Rload = 0.1;
        for (let t = 0; t < 1; t += 0.01) {
            ptc.update(0.01);
            results.push({ time: t, phase: 'short-circuit', ...ptc.getState() });
        }
        
        // 第二阶段：清除故障
        ptc.Rload = originalRload;
        for (let t = 1; t < 4; t += 0.01) {
            ptc.update(0.01);
            results.push({ time: t, phase: 'recovery', ...ptc.getState() });
        }
        
        return results;
    }
}

/**
 * 应用对比
 */
export const ApplicationComparison = {
    // PTC vs 传统熔断丝
    ptcVsFuse: {
        feature: ['自动恢复', '无需更换', '重复使用', '灵敏度可调', '快速响应', '成本'],
        PTC: ['✓', '✓', '✓', '✓', '✓', '较高'],
        TraditionalFuse: ['✗', '✗', '✗', '✓', '△', '低'],
    },
    
    // PTC vs 继电器
    ptcVsRelay: {
        feature: ['被动器件', '无需电源', '可靠性', '响应速度', '集成度', '成本'],
        PTC: ['✓', '✓', '△', '快', '高', '中等'],
        Relay: ['✗', '✗', '✓', '较慢', '低', '低'],
    },
    
    // 典型应用场景
    applications: [
        {
            name: 'USB充电口',
            maxCurrent: 2.5,
            ptcModel: 'PPTC-50',
            benefit: '防止过充'
        },
        {
            name: '电池管理',
            maxCurrent: 10,
            ptcModel: 'PPTC-80',
            benefit: '短路保护'
        },
        {
            name: '通信基站',
            maxCurrent: 50,
            ptcModel: 'PPTC-120',
            benefit: '电源保护'
        },
        {
            name: '工业控制',
            maxCurrent: 20,
            ptcModel: 'PTC-100',
            benefit: '设备保护'
        }
    ]
};

export default {
    PTCResettableFuseSimulator,
    PTCProtectionCircuitAnalyzer,
    FaultScenarios,
    ApplicationComparison
};
