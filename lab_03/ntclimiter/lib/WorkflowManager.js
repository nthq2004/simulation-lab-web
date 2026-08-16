/**
 * WorkflowManager - 流程与故障管理模块
 * 负责项目操作流程定义（stepsArray）、故障配置（FAULT_CONFIG）、
 * 流程切换、一键连线、系统启动、5点步进等业务逻辑
 */
export class WorkflowManager {
    /**
     * @param {object} sys - ControlSystem 实例
     */
    constructor(sys) {
        this.sys = sys;
        sys.requiredPipes = [
        ];
    }

    // ==========================================
    // 1. 流程初始化：填充下拉框 + 定义所有步骤
    // ==========================================
    initSteps() {
        const sys = this.sys;

        const projectConfigs = [
            { id: 0, name: "1. NTC电阻实现的电源浪涌电流抑制电路" },
        ];

        const taskSelect = document.getElementById('taskSelect');
        if (taskSelect) {
            taskSelect.innerHTML = '<option value="" selected>请选择操作项目...</option>';
            projectConfigs.forEach(proj => {
                const opt = document.createElement('option');
                opt.value = proj.id;
                opt.textContent = proj.name;
                taskSelect.appendChild(opt);
            });
        }

        // 浪涌电流抑制电路连线：
        // DC 24V(+) → NTC(自热) → (电容 1000µF || 负载 100Ω) → GND
        // 电容与负载并联，模拟实际电源的负载与滤波电容
        const conns = [
            { from: 'dcpower_wire_p', to: 'ntc_wire_l', type: 'wire' },
            { from: 'ntc_wire_r', to: 'cap_wire_l', type: 'wire' },
            { from: 'cap_wire_l', to: 'load_wire_l', type: 'wire' },
            { from: 'cap_wire_r', to: 'gnd_wire_gnd', type: 'wire' },
            { from: 'load_wire_r', to: 'gnd_wire_gnd', type: 'wire' },
            { from: 'dcpower_wire_n', to: 'gnd2_wire_gnd', type: 'wire' },
        ];
        sys.stepsArray[0] = [

            // --- 第1步：连接浪涌抑制主回路 ---
            {
                msg: "步骤 1：连接浪涌抑制电路：DC 24V→NTC→(电容∥负载)→GND。",
                act: async () => {
                    await new Promise(resolve => setTimeout(resolve, 2000));

                    for (let i = 0; i < conns.length; i++) {
                        await sys.addConnectionAnimated(conns[i]);
                    }
                },
                check: () =>
                    conns.every(c =>
                        sys.conns.some(sc => sys._connEqual(sc, c))
                    )
            },

            // --- 第2步：开启直流电源 ---
            {
                msg: "步骤 2：开启直流电源（24V）。",
                act: async () => {
                    await new Promise(resolve => setTimeout(resolve, 2000));

                    sys.comps.dcpower.isOn = true;
                    sys.comps.dcpower.update();

                    sys.showFloatingTip("电源已开启，NTC开始自热…", 3000);
                },
                check: () => sys.comps.dcpower.isOn
            },

            // --- 第3步：观察浪涌电流抑制过程（等待NTC自热）---
            {
                msg: "步骤 3：观察浪涌电流抑制——NTC冷态高阻限制浪涌。",
                act: async () => {
                    await new Promise(resolve => setTimeout(resolve, 4000));
                },
                check: () => {
                    const ntc = sys.comps.ntc;
                    return ntc && ntc.temperature > 30;
                }
            },

            // --- 第4步：NTC继续升温，电阻下降 ---
            {
                msg: "步骤 4：NTC自热升温，电阻持续下降，电流增大。",
                act: async () => {
                    await new Promise(resolve => setTimeout(resolve, 5000));
                },
                check: () => {
                    const ntc = sys.comps.ntc;
                    return ntc && ntc.currentResistance < 5;
                }
            },

            // --- 第5步：进入稳态 ---
            {
                msg: "步骤 5：NTC达到热平衡，电路进入稳态运行。",
                act: async () => {
                    await new Promise(resolve => setTimeout(resolve, 5000));
                    sys.showFloatingTip("稳态：NTC阻值=" +
                        sys.comps.ntc._fmtR(sys.comps.ntc.currentResistance) +
                        "  温升=" + sys.comps.ntc.selfHeatDT.toFixed(1) + "°C", 4000);
                },
                check: () => {
                    const ntc = sys.comps.ntc;
                    // 检查是否接近热平衡（温度变化率小）
                    return ntc && ntc.selfHeatDT > 50;
                }
            },

            // --- 第6步：关闭电源，观察NTC降温 ---
            {
                msg: "步骤 6：关闭电源，观察NTC冷却降温。",
                act: async () => {
                    await new Promise(resolve => setTimeout(resolve, 2000));

                    sys.comps.dcpower.isOn = false;
                    sys.comps.dcpower.update();

                    sys.showFloatingTip("电源已关闭，NTC开始冷却…", 3000);
                },
                check: () => !sys.comps.dcpower.isOn
            },

            // --- 第7步：NTC冷却完成 ---
            {
                msg: "步骤 7：NTC冷却至接近环境温度，阻值恢复。",
                act: async () => {
                    await new Promise(resolve => setTimeout(resolve, 5000));
                    sys.showFloatingTip("浪涌电流抑制实验完成", 2000);
                },
                check: () => {
                    const ntc = sys.comps.ntc;
                    return ntc && ntc.temperature < 35;
                }
            }

        ];

    }

    // ==========================================
    // 2. 故障初始化
    // ==========================================
    initFault() {
        const sys = this.sys;

        sys.FAULT_CONFIG = {

            1: {
                id: 1,
                name: "NTC开路失效（无浪涌抑制能力）",
                trigger: () => {
                    const ntc = sys.comps.ntc;
                    if (ntc) { ntc.isBreak = true; }
                },
                check: () => {
                    const ntc = sys.comps.ntc;
                    return ntc ? ntc.isBreak : false;
                },
                repair: () => {
                    const ntc = sys.comps.ntc;
                    if (ntc) { ntc.isBreak = false; }
                }
            },
        };

        const faultForm = document.getElementById('faultForm');
        if (faultForm) {
            faultForm.innerHTML = '';
            Object.values(sys.FAULT_CONFIG).forEach(fault => {
                const label = document.createElement('label');
                label.className = 'f-checkbox';
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.value = fault.id;
                checkbox.id = `fault_check_${fault.id}`;
                label.appendChild(checkbox);
                label.appendChild(document.createTextNode(` ${fault.name}`));
                faultForm.appendChild(label);
            });
        }
    }

    // ==========================================
    // 3. 流程切换与控制
    // ==========================================

    /** 项目选择框调用的函数，用于切换任务流程 */
    switchWorkflow(taskValue) {
        const sys = this.sys;
        if (!taskValue) {
            console.log("未选择任何任务，清空流程数据");
            sys.workflowComp._workflow = [];
            sys.workflowComp._workflowIdx = 0;
            if (sys.workflowComp._workflowPanelEl) {
                sys.workflowComp.closeWorkflowPanel();
            }
            return;
        }
        console.log("切换至任务:", taskValue);
        sys.workflowComp._workflow = sys.stepsArray[taskValue];
        sys.workflowComp._workflowIdx = 0;
        if (sys.workflowComp._workflowPanelEl) {
            sys.workflowComp.closeWorkflowPanel();
        }
    }

    /** 根据用户选择的方式（单步/完整/评估/演练）打开流程面板 */
    openWorkflowPanel(mode) {
        const sys = this.sys;
        if (mode === 'step') {
            sys.workflowComp.stepByStep();
        } else {
            sys.workflowComp.openWorkflowPanel(mode);
        }
    }

    // ==========================================
    // 4. 快捷操作
    // ==========================================

    /** 一键自动连线：将预设的逻辑关系注入连接池 */
    applyAllPresets() {
        const sys = this.sys;
        // 1. 定义预设连接关系 — 浪涌电流抑制电路
        // DC 24V(+) → NTC → (电容 ∥ 负载) → GND
        sys.conns = [
            { from: 'dcpower_wire_p', to: 'ntc_wire_l', type: 'wire' },
            { from: 'ntc_wire_r', to: 'cap_wire_l', type: 'wire' },
            { from: 'cap_wire_l', to: 'load_wire_l', type: 'wire' },
            { from: 'cap_wire_r', to: 'gnd_wire_gnd', type: 'wire' },
            { from: 'load_wire_r', to: 'gnd_wire_gnd', type: 'wire' },
            { from: 'dcpower_wire_n', to: 'gnd2_wire_gnd', type: 'wire' },
        ];

        sys.redrawAll();
    }

    /** 启动系统：开启直流电源 */
    async applyStartSystem() {
        sys.comps.dcpower.isOn = true;
        sys.comps.dcpower.update();
    }

    /**
     * 5点步进系统：切换直流电源开关，演示浪涌抑制过程
     */
    fiveStep() {
        const sys = this.sys;
        const dcpower = sys.comps['dcpower'];
        const ntc = sys.comps['ntc'];

        if (!dcpower) return;

        if (dcpower.isOn) {
            // 当前开机 → 关机，观察NTC冷却
            dcpower.isOn = false;
            dcpower.update();
            if (sys.showFloatingTip) {
                sys.showFloatingTip("电源关闭，NTC冷却中", 2000);
            }
        } else {
            // 当前关机 → 开机，观察浪涌抑制
            dcpower.isOn = true;
            dcpower.update();
            if (sys.showFloatingTip) {
                sys.showFloatingTip(
                    "电源开启，NTC=" + ntc._fmtR(ntc.currentResistance) +
                    " 浪涌电流=" + (ntc.physCurrent || 0).toFixed(2) + "A",
                    3000
                );
            }
        }
    }
}
