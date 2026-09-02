/**
 * MicrocontrollerSolver.js — 微型控制器解释执行引擎
 *
 * 职责：
 *   1. 解释执行用户编写的"固件"（简化的伪指令集）
 *   2. 每个仿真步执行 N 条指令（模拟时钟频率）
 *   3. 通过 SignalBridge 读写 GPIO、ADC、PWM 等外设
 *   4. 支持定时器中断和外部中断
 *
 * 指令集（教学简化版）：
 *   SET  PIN, VALUE     — 设置 GPIO 输出
 *   READ PIN, VAR       — 读取 GPIO 输入到变量
 *   ADC  CH, VAR        — 读取 ADC 通道值到变量
 *   PWM  PIN, DUTY      — 设置 PWM 输出占空比
 *   DELAY MS            — 延时（消耗仿真周期）
 *   CMP  A, B           — 比较 A 和 B，设置标志位
 *   JMP  LABEL          — 无条件跳转
 *   JZ   LABEL          — 标志位为 0 时跳转
 *   JNZ  LABEL          — 标志位非 0 时跳转
 *   MOV  VAR, VAL       — 变量赋值
 *   ADD  VAR, VAL       — 变量加法
 *   SUB  VAR, VAL       — 变量减法
 *   NOP                 — 空操作
 *   HALT                — 停止执行
 */

import { signalBridge } from './SignalBridge.js';

export class MicrocontrollerSolver {
    constructor(sys) {
        this.sys = sys;

        // ── 所有 MCU 实例 ──
        this._mcus = [];

        // ── 指令计数器（每个 MCU） ──
        this._programCounters = new Map(); // mcuId -> { pc, registers, flags, state }

        // ── 已编译的指令列表 ──
        this._compiledPrograms = new Map(); // mcuId -> Instruction[]
    }

    /**
     * 每个仿真步调用
     * @param {number} deltaTime — 仿真步长 (秒)
     * @param {number} [instructionsPerStep=10] — 每步最大指令数
     */
    update(deltaTime, instructionsPerStep = 10) {
        // 1. 发现系统中的 MCU
        this._discoverMCUs();

        // 2. 逐个 MCU 执行指令
        this._mcus.forEach(mcu => {
            if (!mcu.powerOn) return;

            // 获取或创建执行上下文
            let ctx = this._programCounters.get(mcu.id);
            if (!ctx) {
                ctx = this._initContext(mcu);
                this._programCounters.set(mcu.id, ctx);
            }

            // 编译程序（如果尚未编译）
            if (!this._compiledPrograms.has(mcu.id)) {
                this._compileProgram(mcu);
            }

            const program = this._compiledPrograms.get(mcu.id);
            if (!program || program.length === 0 || ctx.state === 'halted') return;

            // 执行指令
            const maxInstr = instructionsPerStep;
            for (let i = 0; i < maxInstr; i++) {
                if (ctx.pc < 0 || ctx.pc >= program.length) {
                    ctx.pc = 0; // 自动回绕（循环执行）
                }

                const instr = program[ctx.pc];
                this._executeInstruction(mcu, ctx, instr);

                if (ctx.state === 'halted') break;

                // 处理 DELAY
                if (ctx._delayCycles > 0) {
                    ctx._delayCycles--;
                    break; // 延迟期间不执行后续指令
                }

                ctx.pc++;
            }

            // 同步 MCU 状态到组件显示
            this._syncMCUState(mcu, ctx);
        });
    }

    _discoverMCUs() {
        const allMcus = Object.values(this.sys.comps).filter(d => d.type === 'd_mcu');
        // 只在第一次或新 MCU 出现时更新列表
        this._mcus = allMcus;
    }

    _initContext(mcu) {
        return {
            pc: 0,
            regs: {},        // 用户变量
            flags: { z: 0, c: 0 }, // 标志位
            state: 'running',  // 'running' | 'halted'
            _delayCycles: 0,
            _timerCounters: {},  // 定时器状态
        };
    }

    /**
     * 编译固件代码为指令列表
     * 支持简单的行格式: "INSTR ARG1, ARG2"
     */
    _compileProgram(mcu) {
        const code = mcu.firmware || '';
        const lines = code.split('\n').filter(l => l.trim() && !l.trim().startsWith('//'));
        const instructions = [];

        // 第一遍：收集标签
        const labels = new Map();
        lines.forEach((line, idx) => {
            const trimmed = line.trim();
            if (trimmed.endsWith(':')) {
                labels.set(trimmed.slice(0, -1), instructions.length);
            } else {
                instructions.push({ line: trimmed, sourceLine: idx });
            }
        });

        // 第二遍：解析参数
        const parsed = instructions.map(instr => {
            const parts = instr.line.split(/\s+/);
            const opcode = parts[0].toUpperCase();
            const args = parts.slice(1).join(' ').split(',').map(a => a.trim());

            // 解析数值参数
            const parsedArgs = args.map(a => {
                if (labels.has(a)) return { type: 'label', value: labels.get(a) };
                const num = parseFloat(a);
                if (!isNaN(num)) return { type: 'num', value: num };
                return { type: 'var', value: a };
            });

            return { opcode, args: parsedArgs, raw: instr.line };
        });

        this._compiledPrograms.set(mcu.id, parsed);
    }

    /**
     * 执行单条指令
     */
    _executeInstruction(mcu, ctx, instr) {
        const { opcode, args } = instr;

        // 辅助：获取变量值
        const getVal = (arg) => {
            if (arg.type === 'num') return arg.value;
            if (arg.type === 'label') return arg.value;
            if (arg.type === 'var') return ctx.regs[arg.value] || 0;
            return 0;
        };

        // 辅助：获取引脚值
        const getPin = (pinName) => {
            const lineId = `${mcu.id}_gpio_${pinName}`;
            return signalBridge.readSignal(lineId);
        };

        // 辅助：设置引脚值
        const setPin = (pinName, val) => {
            const lineId = `${mcu.id}_gpio_${pinName}`;
            signalBridge.writeSignal(lineId, val ? 1 : 0, 'strong');
        };

        switch (opcode) {
            case 'SET': {
                // SET PIN, VALUE
                const pinName = args[0]?.value || '';
                const val = getVal(args[1]);
                setPin(pinName, val);
                break;
            }
            case 'READ': {
                // READ PIN, VAR
                const rPin = args[0]?.value || '';
                const rVar = args[1]?.value || '';
                ctx.regs[rVar] = getPin(rPin);
                break;
            }
            case 'ADC': {
                // ADC CH, VAR
                const ch = parseInt(getVal(args[0])) || 0;
                const adcVar = args[1]?.value || '';
                const adcPortId = `${mcu.id}_adc_ch${ch}`;
                ctx.regs[adcVar] = signalBridge.getADCDigital(adcPortId);
                break;
            }
            case 'PWM': {
                // PWM PIN, DUTY（0~100）
                const pwmPin = args[0]?.value || '';
                const duty = Math.max(0, Math.min(100, getVal(args[1])));
                // 简化：占空比 > 50 输出高，否则输出低
                setPin(pwmPin, duty > 50 ? 1 : 0);
                break;
            }
            case 'DELAY': {
                // DELAY MS — 消耗仿真周期
                let ms = getVal(args[0]);
                ctx._delayCycles = Math.max(1, Math.round(ms / 50)); // 50ms ≈ 1 个仿真步
                break;
            }
            case 'CMP': {
                // CMP A, B — 比较
                const cmpA = getVal(args[0]);
                const cmpB = getVal(args[1]);
                ctx.flags.z = (cmpA === cmpB) ? 1 : 0;
                ctx.flags.c = (cmpA < cmpB) ? 1 : 0;
                break;
            }
            case 'MOV': {
                // MOV VAR, VAL
                const movVar = args[0]?.value || '';
                ctx.regs[movVar] = getVal(args[1]);
                break;
            }
            case 'ADD': {
                // ADD VAR, VAL
                const addVar = args[0]?.value || '';
                ctx.regs[addVar] = (ctx.regs[addVar] || 0) + getVal(args[1]);
                break;
            }
            case 'SUB': {
                // SUB VAR, VAL
                const subVar = args[0]?.value || '';
                ctx.regs[subVar] = (ctx.regs[subVar] || 0) - getVal(args[1]);
                break;
            }
            case 'JMP': {
                // JMP LABEL
                ctx.pc = getVal(args[0]);
                return; // 不自动递增 pc
            }
            case 'JZ': {
                // JZ LABEL — 标志位 Z=1 时跳转
                if (ctx.flags.z) {
                    ctx.pc = getVal(args[0]);
                    return;
                }
                break;
            }
            case 'JNZ': {
                // JNZ LABEL — 标志位 Z=0 时跳转
                if (!ctx.flags.z) {
                    ctx.pc = getVal(args[0]);
                    return;
                }
                break;
            }
            case 'NOP':
                break;
            case 'HALT':
                ctx.state = 'halted';
                break;
            default:
                // 未知指令视为 NOP
                break;
        }
    }

    /**
     * 将 MCU 内部状态同步到组件显示属性
     */
    _syncMCUState(mcu, ctx) {
        mcu.pc = ctx.pc;
        mcu.regs = { ...ctx.regs };
        mcu.flags = { ...ctx.flags };
        mcu.state = ctx.state;
        mcu.digitalOut = ctx.state === 'running' ? 1 : 0;
    }

    /**
     * 重新加载某个 MCU 的固件（用户修改代码后调用）
     */
    reloadFirmware(mcuId) {
        this._compiledPrograms.delete(mcuId);
        this._programCounters.delete(mcuId);
    }

    /**
     * 重置某个 MCU
     */
    resetMCU(mcuId) {
        this._programCounters.delete(mcuId);
        const mcu = this.sys.comps[mcuId];
        if (mcu) {
            const ctx = this._initContext(mcu);
            this._programCounters.set(mcuId, ctx);
            mcu.state = 'running';
        }
    }

    /**
     * 获取 MCU 诊断信息
     */
    getDiagnostics(mcuId) {
        const ctx = this._programCounters.get(mcuId);
        const mcu = this.sys.comps[mcuId];
        if (!ctx || !mcu) return null;
        const program = this._compiledPrograms.get(mcuId);
        return {
            pc: ctx.pc,
            programLength: program?.length || 0,
            registerCount: Object.keys(ctx.regs).length,
            state: ctx.state,
            firmwareLines: (mcu.firmware || '').split('\n').length,
        };
    }
}
