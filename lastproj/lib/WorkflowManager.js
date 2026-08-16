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
            { id: 1, name: "Brokaw温度传感器仿真电路" },
        ];

        const taskSelect = document.getElementById('taskSelect');
        if (taskSelect) {
            taskSelect.innerHTML = '';
            projectConfigs.forEach(proj => {
                const opt = document.createElement('option');
                opt.value = proj.id;
                opt.textContent = proj.name;
                opt.selected = true;
                taskSelect.appendChild(opt);
            });
        }

        // ── Brokaw温度传感器仿真电路（项目ID: 1）──
        const brokawConns = [
            { from: 'b_vcc_wire_p', to: 'b_r2_wire_l', type: 'wire' },
            { from: 'b_vcc_wire_p', to: 'b_r3_wire_l', type: 'wire' },
            { from: 'b_r2_wire_r', to: 'b_q1_wire_c', type: 'wire' },
            { from: 'b_r3_wire_r', to: 'b_q2_wire_c', type: 'wire' },
            { from: 'b_q1_wire_e', to: 'b_gnd1_wire_gnd', type: 'wire' },
            { from: 'b_q2_wire_e', to: 'b_r1_wire_l', type: 'wire' },
            { from: 'b_r1_wire_r', to: 'b_gnd2_wire_gnd', type: 'wire' },
            { from: 'b_q1_wire_c', to: 'b_u1_wire_n', type: 'wire' },
            { from: 'b_q2_wire_c', to: 'b_u1_wire_p', type: 'wire' },
            { from: 'b_u1_wire_OUT', to: 'b_q3_wire_b', type: 'wire' },
            { from: 'b_u1_wire_OUT', to: 'b_q1_wire_b', type: 'wire' },
            { from: 'b_u1_wire_OUT', to: 'b_q2_wire_b', type: 'wire' },
            { from: 'b_q3_wire_c', to: 'b_vcc_wire_p', type: 'wire' },
            { from: 'b_q3_wire_e', to: 'b_r4_wire_l', type: 'wire' },
            { from: 'b_r4_wire_r', to: 'b_gnd3_wire_gnd', type: 'wire' },
            { from: 'b_vcc_wire_n', to: 'b_gnd4_wire_gnd', type: 'wire' },
        ];
        sys.brokawConns = brokawConns;

        sys.stepsArray[1] = [

            // --- 第1步：连接Brokaw电路 ---
            {
                msg: "步骤 1：连接 Brokaw 温度传感器电路",
                act: async () => {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    for (let i = 0; i < brokawConns.length; i++) {
                        await sys.addConnectionAnimated(brokawConns[i]);
                    }
                    sys.showFloatingTip("Brokaw 电路已自动搭建完成", 3000);
                },
                check: () =>
                    brokawConns.every(c =>
                        sys.conns.some(sc => sys._connEqual(sc, c))
                    )
            },

            // --- 第2步：开启VCC电源 ---
            {
                msg: "步骤 2：开启+15V电源，电路开始工作",
                act: async () => {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    const vcc = sys.comps['b_vcc'];
                    if (vcc) {
                        vcc.isOn = true;
                        vcc.update();
                    }
                    sys.showFloatingTip("电源已开启，Brokaw 电路工作", 3000);
                },
                check: () => {
                    const vcc = sys.comps['b_vcc'];
                    return vcc && vcc.isOn;
                }
            },

            // --- 第3步：T=0°C观察 ---
            {
                msg: "步骤 3：设定 T=0°C，观察 ΔVbe（PTAT 电压）",
                act: async () => {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    const slider = document.getElementById('tempSlider');
                    const display = document.getElementById('tempDisplay');
                    if (slider) { slider.value = 0; }
                    sys.globalTemp = 0;
                    if (display) { display.textContent = '0°C'; }
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    const vR1 = sys.getVoltageBetween('b_r1_wire_l', 'b_r1_wire_r');
                    const vDropR2 = sys.getVoltageBetween('b_vcc_wire_p', 'b_q1_wire_c');
                    sys.showFloatingTip(`T=0°C: ΔVbe=${(vR1||0).toFixed(4)}V  V_R2=${(vDropR2||0).toFixed(4)}V`, 4000);
                },
                check: () => true
            },

            // --- 第4步：T=25°C观察 ---
            {
                msg: "步骤 4：设定 T=25°C（室温），观察 ΔVbe",
                act: async () => {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    const slider = document.getElementById('tempSlider');
                    const display = document.getElementById('tempDisplay');
                    if (slider) { slider.value = 25; }
                    sys.globalTemp = 25;
                    if (display) { display.textContent = '25°C'; }
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    const vR1 = sys.getVoltageBetween('b_r1_wire_l', 'b_r1_wire_r');
                    const vDropR2 = sys.getVoltageBetween('b_vcc_wire_p', 'b_q1_wire_c');
                    sys.showFloatingTip(`T=25°C: ΔVbe=${(vR1||0).toFixed(4)}V  V_R2=${(vDropR2||0).toFixed(4)}V`, 4000);
                },
                check: () => true
            },

            // --- 第5步：T=50°C观察 ---
            {
                msg: "步骤 5：设定 T=50°C，观察 ΔVbe 随温度升高",
                act: async () => {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    const slider = document.getElementById('tempSlider');
                    const display = document.getElementById('tempDisplay');
                    if (slider) { slider.value = 50; }
                    sys.globalTemp = 50;
                    if (display) { display.textContent = '50°C'; }
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    const vR1 = sys.getVoltageBetween('b_r1_wire_l', 'b_r1_wire_r');
                    const vDropR2 = sys.getVoltageBetween('b_vcc_wire_p', 'b_q1_wire_c');
                    sys.showFloatingTip(`T=50°C: ΔVbe=${(vR1||0).toFixed(4)}V  V_R2=${(vDropR2||0).toFixed(4)}V`, 4000);
                },
                check: () => true
            },

            // --- 第6步：T=100°C观察 ---
            {
                msg: "步骤 6：设定 T=100°C，观察 ΔVbe 继续增大",
                act: async () => {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    const slider = document.getElementById('tempSlider');
                    const display = document.getElementById('tempDisplay');
                    if (slider) { slider.value = 100; }
                    sys.globalTemp = 100;
                    if (display) { display.textContent = '100°C'; }
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    const vR1 = sys.getVoltageBetween('b_r1_wire_l', 'b_r1_wire_r');
                    const vDropR2 = sys.getVoltageBetween('b_vcc_wire_p', 'b_q1_wire_c');
                    sys.showFloatingTip(`T=100°C: ΔVbe=${(vR1||0).toFixed(4)}V  V_R2=${(vDropR2||0).toFixed(4)}V`, 4000);
                },
                check: () => true
            },

            // --- 第7步：实验总结 ---
            {
                msg: "步骤 7：实验总结——ΔVbe 正比于绝对温度 T",
                act: async () => {
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    sys.showFloatingTip(
                        "Brokaw 温度传感器原理：\n" +
                        "ΔVbe = Vt·ln(8), Vt = kT/q\n" +
                        "ΔVbe 随温度升高而增大（PTAT）\n" +
                        "放大后: V_R2+V_R3 = 55.6×ΔVbe ≈ 10mV/°C",
                        6000
                    );
                },
                check: () => true
            },

        ];

    }

    // ==========================================
    // 2. 故障初始化
    // ==========================================
    initFault() {
        const sys = this.sys;

        sys.FAULT_CONFIG = {};

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
        // Brokaw 温度传感器电路（16条连线）
        sys.conns = [
            { from: 'b_vcc_wire_p', to: 'b_r2_wire_l', type: 'wire' },
            { from: 'b_vcc_wire_p', to: 'b_r3_wire_l', type: 'wire' },
            { from: 'b_r2_wire_r', to: 'b_q1_wire_c', type: 'wire' },
            { from: 'b_r3_wire_r', to: 'b_q2_wire_c', type: 'wire' },
            { from: 'b_q1_wire_e', to: 'b_gnd1_wire_gnd', type: 'wire' },
            { from: 'b_q2_wire_e', to: 'b_r1_wire_l', type: 'wire' },
            { from: 'b_r1_wire_r', to: 'b_gnd2_wire_gnd', type: 'wire' },
            { from: 'b_q1_wire_c', to: 'b_u1_wire_n', type: 'wire' },
            { from: 'b_q2_wire_c', to: 'b_u1_wire_p', type: 'wire' },
            { from: 'b_u1_wire_OUT', to: 'b_q3_wire_b', type: 'wire' },
            { from: 'b_u1_wire_OUT', to: 'b_q1_wire_b', type: 'wire' },
            { from: 'b_u1_wire_OUT', to: 'b_q2_wire_b', type: 'wire' },
            { from: 'b_q3_wire_c', to: 'b_vcc_wire_p', type: 'wire' },
            { from: 'b_q3_wire_e', to: 'b_r4_wire_l', type: 'wire' },
            { from: 'b_r4_wire_r', to: 'b_gnd3_wire_gnd', type: 'wire' },
            { from: 'b_vcc_wire_n', to: 'b_gnd4_wire_gnd', type: 'wire' },
        ];
        sys.redrawAll();
    }

    /** 启动系统：开启直流电源 */
    async applyStartSystem() {
        const sys = this.sys;
        const vcc = sys.comps['b_vcc'];
        if (vcc) {
            vcc.isOn = true;
            vcc.update();
            sys.showFloatingTip("Brokaw 电路电源已开启", 2000);
        }
    }

    /**
     * 5点步进系统：温度循环 0 → 25 → 50 → 75 → 100 → 0
     */
    fiveStep() {
        const sys = this.sys;
        const temps = [0, 25, 50, 75, 100];
        const currentTemp = sys.globalTemp || 0;
        let nextTemp = temps[0];
        for (const t of temps) {
            if (Math.abs(t - currentTemp) < 1) {
                const idx = temps.indexOf(t);
                nextTemp = temps[(idx + 1) % temps.length];
                break;
            }
        }
        sys.globalTemp = nextTemp;
        const slider = document.getElementById('tempSlider');
        const display = document.getElementById('tempDisplay');
        if (slider) slider.value = nextTemp;
        if (display) display.textContent = nextTemp.toFixed(0) + '°C';

        const vR1 = sys.getVoltageBetween('b_r1_wire_l', 'b_r1_wire_r');
        const vDropR2 = sys.getVoltageBetween('b_vcc_wire_p', 'b_q1_wire_c');
        if (sys.showFloatingTip) {
            sys.showFloatingTip(
                `T=${nextTemp}°C  ΔVbe=${(vR1 || 0).toFixed(4)}V  V_R2=${(vDropR2 || 0).toFixed(4)}V`,
                3000
            );
        }
    }
}
