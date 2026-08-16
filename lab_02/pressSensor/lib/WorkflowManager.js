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
            { id: 0, name: "1. 压力变送器好坏的判别(项目7.1.2)" },
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

        const autoConns = [
 
            // --- 气路部分 (Pipe) ---
            // 气瓶 (airBottle) -> 截止阀 (stopValve)
            { from: 'cab_pipe_o', to: 'stopvalve_pipe_i', type: 'pipe' },

            // 截止阀 (stopValve) -> 调压阀 (regulator)
            { from: 'stopvalve_pipe_o', to: 'pressreg_pipe_i', type: 'pipe' },

            // 调压阀 (regulator) -> 压力变送器 (pressTransmitter) 的输入口 (i)
            // 根据你 PressTransmitter 的定义：this.addPort(70, 168, 'i', 'pipe', 'in');
            { from: 'pressreg_pipe_o', to: 'ptr_pipe_i', type: 'pipe' },

            // --- 电路部分 (Wire) ---
            // 电源正极 (dcPower_p) -> 电阻 (resistor_1)
            { from: 'dcpower_wire_p', to: 'varires_wire_l', type: 'wire' },

            // 电阻 (resistor_2) -> 压力变送器正极 (pressTransmitter_p)
            // 根据你的定义：this.addPort(140, 18, 'p', 'wire', 'p');
            { from: 'varires_wire_r', to: 'ptr_wire_p', type: 'wire' },

            // 压力变送器负极 (pressTransmitter_n) -> 电流表输入端 (ammeter_i)
            // 根据你的定义：this.addPort(140, 48, 'n', 'wire');
            { from: 'ptr_wire_n', to: 'ampmeter_wire_p', type: 'wire' },

            // 电流表输出端 (ammeter_o) -> 电源负极 (dcPower_n)
            { from: 'ampmeter_wire_n', to: 'dcpower_wire_n', type: 'wire' }

        ];

        const checkConnectionsExist = (connIndices) => {
            return connIndices.every(i =>
                sys.conns.some(c => sys.connMgr.connEqual(c, autoConns[i]))
            );
        };

        sys.stepsArray[0] = [
            // --- 第一部分：物理连线 (Step 1-7) ---
            {
                msg: "1：气路连接 - 从空气瓶连接到截止阀。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000)); // 先停顿
                    await sys.addConnectionAnimated(autoConns[0]);              // 后执行
                },
                check: () => sys.conns.some(c => sys._connEqual(c, autoConns[0]))
            },
            {
                msg: "2：气路连接 - 从截止阀连接到调压阀。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    await sys.addConnectionAnimated(autoConns[1]);
                },
                check: () => sys.conns.some(c => sys._connEqual(c, autoConns[1]))
            },
            {
                msg: "3：气路连接 - 从调压阀输出连接到压力变送器输入口。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    await sys.addConnectionAnimated(autoConns[2]);
                },
                check: () => sys.conns.some(c => sys._connEqual(c, autoConns[2]))
            },
            {
                msg: "4：电路连接 - 24V电源正极连接到回路电阻。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    await sys.addConnectionAnimated(autoConns[3]);
                },
                check: () => sys.conns.some(c => sys._connEqual(c, autoConns[3]))
            },
            {
                msg: "5：电路连接 - 回路电阻连接到压力变送器正极端子(P)。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    await sys.addConnectionAnimated(autoConns[4]);
                },
                check: () => sys.conns.some(c => sys._connEqual(c, autoConns[4]))
            },
            {
                msg: "6：电路连接 - 压力变送器负极端子(N)连接到电流表正极。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    await sys.addConnectionAnimated(autoConns[5]);
                },
                check: () => sys.conns.some(c => sys._connEqual(c, autoConns[5]))
            },
            {
                msg: "7：电路连接 - 电流表负极连接回到24V电源负极，完成电流环路。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    await sys.addConnectionAnimated(autoConns[6]);
                },
                check: () => sys.conns.some(c => sys._connEqual(c, autoConns[6]))
            },

            // --- 第二部分：系统启动 (Step 8-9) ---
            {
                msg: "8：接通直流电源，观察变送器LCD屏幕是否点亮，此时电流应为4mA。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    sys.comps.dcpower.isOn = true;
                    sys.comps.dcpower.update();
                },
                check: () => sys.comps.dcpower.isOn === true
            },
            {
                msg: "9：开启气瓶截止阀，使气源压力进入调压阀。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    sys.comps.stopvalve.isOpen = true;
                    sys.comps.stopvalve.update();
                },
                check: () => sys.comps.stopvalve.isOpen === true
            },

            // --- 第三部分：5点步进校验 (Step 10-13) ---
            {
                msg: "10：步进校验 - 调节压力至 25% 量程点，此时电流应为8mA。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    const ptr = sys.comps.ptr;
                    sys.comps.pressreg.setPressure = ptr.min + (ptr.max - ptr.min) * 0.25;
                    sys.comps.pressreg.update();
                },
                check: () => {
                    const ptr = sys.comps.ptr;
                    const target = ptr.min + (ptr.max - ptr.min) * 0.25;
                    return Math.abs(sys.comps.pressreg.outputPressure - target) < 0.01;
                }
            },
            {
                msg: "11：步进校验 - 调节压力至 50% 量程点（中点），此时电流应为12mA。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    const ptr = sys.comps.ptr;
                    sys.comps.pressreg.setPressure = ptr.min + (ptr.max - ptr.min) * 0.5;
                    sys.comps.pressreg.update();
                },
                check: () => {
                    const ptr = sys.comps.ptr;
                    const target = ptr.min + (ptr.max - ptr.min) * 0.5;
                    return Math.abs(sys.comps.pressreg.outputPressure - target) < 0.01;
                }
            },
            {
                msg: "12：步进校验 - 调节压力至 75% 量程点，此时电流应为16mA。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    const ptr = sys.comps.ptr;
                    sys.comps.pressreg.setPressure = ptr.min + (ptr.max - ptr.min) * 0.75;
                    sys.comps.pressreg.update();
                },
                check: () => {
                    const ptr = sys.comps.ptr;
                    const target = ptr.min + (ptr.max - ptr.min) * 0.75;
                    return Math.abs(sys.comps.pressreg.outputPressure - target) < 0.01;
                }
            },
            {
                msg: "13：步进校验 - 调节压力至 100% 量程点（满量程），此时电流应为20mA。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    const ptr = sys.comps.ptr;
                    sys.comps.pressreg.setPressure = ptr.max;
                    sys.comps.pressreg.update();
                },
                check: () => {
                    const ptr = sys.comps.ptr;
                    return Math.abs(sys.comps.pressreg.outputPressure - ptr.max) < 0.01;
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
                name: "1. 变送器开路（断路） ",
                trigger: () => {  sys.comps['ptr'].isOpened = true; },
                check: () => { return  sys.comps['ptr'].isOpened === true; },
                repair: () => {  sys.comps['ptr'].isOpened = false; }
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
        sys.conns = [
            // --- 气路部分 (Pipe) ---
            // 气瓶 (airBottle) -> 截止阀 (stopValve)
            { from: 'cab_pipe_o', to: 'stopvalve_pipe_i', type: 'pipe' },

            // 截止阀 (stopValve) -> 调压阀 (regulator)
            { from: 'stopvalve_pipe_o', to: 'pressreg_pipe_i', type: 'pipe' },

            // 调压阀 (regulator) -> 压力变送器 (pressTransmitter) 的输入口 (i)
            // 根据你 PressTransmitter 的定义：this.addPort(70, 168, 'i', 'pipe', 'in');
            { from: 'pressreg_pipe_o', to: 'ptr_pipe_i', type: 'pipe' },

            // --- 电路部分 (Wire) ---
            // 电源正极 (dcPower_p) -> 电阻 (resistor_1)
            { from: 'dcpower_wire_p', to: 'varires_wire_l', type: 'wire' },

            // 电阻 (resistor_2) -> 压力变送器正极 (pressTransmitter_p)
            // 根据你的定义：this.addPort(140, 18, 'p', 'wire', 'p');
            { from: 'varires_wire_r', to: 'ptr_wire_p', type: 'wire' },

            // 压力变送器负极 (pressTransmitter_n) -> 电流表输入端 (ammeter_i)
            // 根据你的定义：this.addPort(140, 48, 'n', 'wire');
            { from: 'ptr_wire_n', to: 'ampmeter_wire_p', type: 'wire' },

            // 电流表输出端 (ammeter_o) -> 电源负极 (dcPower_n)
            { from: 'ampmeter_wire_n', to: 'dcpower_wire_n', type: 'wire' }
        ];
        sys.redrawAll();
    }

    /** 启动系统：开启电源、泵、发动机，切换 PID 至自动模式 */
    async applyStartSystem() {
        const sys = this.sys;
        sys.comps.stopvalve.isOpen = true;
        sys.comps.stopvalve.update();
        sys.comps.dcpower.isOn = true;
        sys.comps.dcpower.update();        
    }

    /**
     * 5点步进系统：根据 PID 模式切换步进目标
     * 手动模式：步进 PID 输出 (0, 25, 50, 75, 100)
     * 自动模式：步进设定值 (0.25, 0.5, 0.75, 1, 0)
     */
    fiveStep() {
        const sys = this.sys;
        // const pid = sys.comps['pid'];
        const reg = sys.comps['pressreg']; // 调压阀
        const ptr = sys.comps['ptr'];      // 压力变送器  
        if (!reg || !ptr) return;        
        const isManual = true;
        const span = ptr.max - ptr.min;
        // const steps = isManual
        //     ? [0, 25, 50, 75, 100]
        //     : [0.25, 0.5, 0.75, 1, 0];
        const steps = [0.25, 0.5, 0.75, 1.0,0].map(p => ptr.min + span * p);

        if (sys._testStep === undefined || sys._testStep >= steps.length) {
            sys._testStep = 0;
        }
        const nextIndex = sys._testStep;
        const targetValue = steps[nextIndex];

        if (isManual) {
            reg.setPressure = targetValue;
            reg.update();

        } else {
            // 自动模式预留扩展
        }
        sys._testStep = (nextIndex + 1) % steps.length;
    }
}
