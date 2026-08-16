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
            { id: 0, name: "1. 冷却水温度控制系统运行" },

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
            { from: 'engine_pipe_o', to: 'pump_pipe_i', type: 'pipe' },
            { from: 'pump_pipe_o', to: 'tconn_pipe_l', type: 'pipe' },
            { from: 'tconn_pipe_u', to: 'valve_pipe_u', type: 'pipe' },
            { from: 'tconn_pipe_r', to: 'cooler_pipe_i', type: 'pipe' },
            { from: 'cooler_pipe_o', to: 'valve_pipe_l', type: 'pipe' },
            { from: 'valve_pipe_r', to: 'engine_pipe_i', type: 'pipe' },

            { from: 'pid_wire_vcc', to: 'dcpower_wire_p', type: 'wire' },
            { from: 'pid_wire_gnd', to: 'dcpower_wire_n', type: 'wire' },
            { from: 'dcpower_wire_n', to: 'gnd_wire_gnd', type: 'wire' },

            { from: 'pt_wire_l', to: 'ttrans_wire_l', type: 'wire' },
            { from: 'pt_wire_r', to: 'ttrans_wire_m', type: 'wire' },
            { from: 'pt_wire_r', to: 'ttrans_wire_r', type: 'wire' },
            { from: 'pid_wire_pi1', to: 'ampmeter_wire_p', type: 'wire' },
            { from: 'ampmeter_wire_n', to: 'ttrans_wire_p', type: 'wire' },
            { from: 'ttrans_wire_n', to: 'pid_wire_ni1', type: 'wire' },
            { from: 'pid_wire_no1', to: 'valve_wire_r', type: 'wire' },
            { from: 'pid_wire_po1', to: 'valve_wire_l', type: 'wire' },

            { from: 'pid_wire_b1', to: 'monitor_wire_b1', type: 'wire' },
            { from: 'pid_wire_a1', to: 'monitor_wire_a1', type: 'wire' }
        ];

        const checkConnectionsExist = (connIndices) => {
            return connIndices.every(i =>
                sys.conns.some(c => sys.connMgr.connEqual(c, autoConns[i]))
            );
        };

        sys.stepsArray[0] = [
            {
                msg: "1：从柴油机冷却水出口 --> 水泵入口。",
                act: async () => {
                    sys.conns = [];
                    sys.comps['dcpower'].isOn = false;
                    sys.comps['dcpower'].update();
                    sys.comps['pump'].pumpOn = false;
                    sys.comps['engine'].engOn = false;
                    sys.comps['pid'].mode = 'MAN';
                    await new Promise(r => setTimeout(r, 2000));
                    await sys.connMgr.addConnectionAnimated(autoConns[0]);
                },
                check: () => checkConnectionsExist([0])
            },
            {
                msg: "2：从水泵出口 --> T型管上端。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    await sys.connMgr.addConnectionAnimated(autoConns[1]);
                    sys.comps.monitor.btnMuteFunc();
                    sys.comps.monitor.btnAckFunc();
                },
                check: () => checkConnectionsExist([1])
            },
            {
                msg: "3：从T型管右端 --> 三通调节阀左端",
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    await sys.connMgr.addConnectionAnimated(autoConns[2]);
                },
                check: () => checkConnectionsExist([2])
            },
            {
                msg: "4：从T型管下端 --> 冷却器入口。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    await sys.connMgr.addConnectionAnimated(autoConns[3]);
                },
                check: () => checkConnectionsExist([3])
            },
            {
                msg: "5：从冷却器出口 --> 三通调节阀下端。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    await sys.connMgr.addConnectionAnimated(autoConns[4]);
                },
                check: () => checkConnectionsExist([4])
            },
            {
                msg: "6：从三通调节阀上端 --> 柴油机冷却水入口。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    await sys.connMgr.addConnectionAnimated(autoConns[5]);
                },
                check: () => checkConnectionsExist([5])
            },
            {
                msg: "7：连接 PID 控制器电源到 DC24V 正负极,并接地。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    await sys.connMgr.addConnectionAnimated(autoConns[6]);
                    await sys.connMgr.addConnectionAnimated(autoConns[7]);
                    await sys.connMgr.addConnectionAnimated(autoConns[8]);
                },
                check: () => checkConnectionsExist([6, 7, 8])
            },
            {
                msg: "8：连接 PT100 信号线至温度变送器端子。",
                act: async () => {
                    await sys.connMgr.addConnectionAnimated(autoConns[9]);
                    await sys.connMgr.addConnectionAnimated(autoConns[10]);
                    await sys.connMgr.addConnectionAnimated(autoConns[11]);
                },
                check: () => checkConnectionsExist([9, 10, 11])
            },
            {
                msg: "9：连接温度变送器输出信号 (4-20mA) 至 PID 输入端。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    await sys.connMgr.addConnectionAnimated(autoConns[12]);
                    await sys.connMgr.addConnectionAnimated(autoConns[13]);
                    await sys.connMgr.addConnectionAnimated(autoConns[14]);
                },
                check: () => checkConnectionsExist([12, 13, 14])
            },
            {
                msg: "10：连接 PID 控制输出至三通调节阀电机端子。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    await sys.connMgr.addConnectionAnimated(autoConns[15]);
                    await sys.connMgr.addConnectionAnimated(autoConns[16]);
                },
                check: () => checkConnectionsExist([15, 16])
            },
            {
                msg: "11：连接 RS485 通讯总线至上位机监控终端。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    await sys.connMgr.addConnectionAnimated(autoConns[17]);
                    await sys.connMgr.addConnectionAnimated(autoConns[18]);
                },
                check: () => checkConnectionsExist([17, 18])
            },
            {
                msg: "12：开启24V电源。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    sys.comps.dcpower.isOn = true;
                    sys.comps.dcpower.update();
                    await new Promise(r => setTimeout(r, 2000));
                    sys.comps.monitor.btnMuteFunc();
                    sys.comps.monitor.btnAckFunc();
                },
                check: () => sys.comps.dcpower.isOn === true
            },
            {
                msg: "13：手动调节阀门开度到略大于20%。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    sys.comps.pid.mode = "MAN";
                    sys.comps.pid.OUT = 25;
                    await new Promise(r => setTimeout(r, 2000));
                },
                check: () => sys.comps.valve.currentPos > 0.2
            },
            {
                msg: "14：开启冷却水泵。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    sys.comps.pump.pumpOn = true;
                    await new Promise(r => setTimeout(r, 2000));
                },
                check: () => sys.comps.pump.pumpOn === true
            },
            {
                msg: "15：开启柴油机。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    sys.comps.engine.engOn = true;
                    await new Promise(r => setTimeout(r, 2000));
                },
                check: () => sys.comps.engine.engOn === true
            },
            {
                msg: "16：PID控制器切换到自动模式。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    sys.comps.pid.mode = 'AUTO';
                    await new Promise(r => setTimeout(r, 2000));
                },
                check: () => sys.comps.pid.mode === 'AUTO'
            },
            {
                msg: "17：确保系统警报已经消音、消闪。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    sys.comps.monitor.btnMuteFunc();
                    sys.comps.monitor.btnAckFunc();
                    await new Promise(r => setTimeout(r, 2000));
                },
                check: () => !sys.comps.monitor.activeAlarms.some(a => !a.muted)
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
                name: "1. DPU电源故障 ",
                trigger: () => { sys.comps['ai'].isBreak = true; },
                check: () => { return sys.comps['ai'].isBreak === true; },
                repair: () => { sys.comps['ai'].isBreak = false; }
            },
            2: {
                id: 2,
                name: "2. DPU通信接口故障 ",
                trigger: () => { sys.comps['ai'].commFault = true; },
                check: () => { return sys.comps['ai'].commFault === true; },
                repair: () => { sys.comps['ai'].commFault = false; }
            },
            3: {
                id: 3,
                name: "3. DPU输入输出接口故障 ",
                trigger: () => { sys.comps['ai'].moduleFault = true; },
                check: () => { return sys.comps['ai'].moduleFault === true; },
                repair: () => { sys.comps['ai'].moduleFault = false; }
            },
            4: {
                id: 4,
                name: "4. DPU信号通道故障 ",
                trigger: () => { sys.comps['ai'].channelFault = true; },
                check: () => { return sys.comps['ai'].channelFault === true; },
                repair: () => { sys.comps['ai'].channelFault = false; }
            },
            5: {
                id: 5,
                name: "5. DPU系统故障 ",
                trigger: () => { sys.comps['ai'].sysFault = true; },
                check: () => { return sys.comps['ai'].sysFault === true; },
                repair: () => { sys.comps['ai'].sysFault = false; }
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
            { from: 'ai_wire_vcc', to: 'dcpower_wire_p', type: 'wire' },
            { from: 'ai_wire_gnd', to: 'dcpower_wire_n', type: 'wire' },
            { from: 'dcpower_wire_n', to: 'gnd_wire_gnd', type: 'wire' },
            { from: 'ao_wire_vcc', to: 'dcpower_wire_p', type: 'wire' },
            { from: 'ao_wire_gnd', to: 'dcpower_wire_n', type: 'wire' },
            { from: 'di_wire_vcc', to: 'dcpower_wire_p', type: 'wire' },
            { from: 'di_wire_gnd', to: 'dcpower_wire_n', type: 'wire' },
            { from: 'do_wire_vcc', to: 'dcpower_wire_p', type: 'wire' },
            { from: 'do_wire_gnd', to: 'dcpower_wire_n', type: 'wire' },

            { from: 'ai_wire_can1p', to: 'can_wire_can1p', type: 'wire' },
            { from: 'ai_wire_can1n', to: 'can_wire_can1n', type: 'wire' },
            { from: 'ao_wire_can1p', to: 'can_wire_can1p', type: 'wire' },
            { from: 'ao_wire_can1n', to: 'can_wire_can1n', type: 'wire' },
            { from: 'di_wire_can1p', to: 'can_wire_can1p', type: 'wire' },
            { from: 'di_wire_can1n', to: 'can_wire_can1n', type: 'wire' },
            { from: 'do_wire_can1p', to: 'can_wire_can1p', type: 'wire' },
            { from: 'do_wire_can1n', to: 'can_wire_can1n', type: 'wire' },

            { from: 'cc_wire_can1p', to: 'can_wire_can1p', type: 'wire' },
            { from: 'cc_wire_can1n', to: 'can_wire_can1n', type: 'wire' },

        ];
        sys.redrawAll();
    }

    /** 启动系统：开启电源、泵、发动机，切换 PID 至自动模式 */
    async applyStartSystem() {
        const sys = this.sys;
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
        const pid = sys.comps['pid'];
        const isManual = pid.mode === "MAN";
        const steps = isManual
            ? [0, 25, 50, 75, 100]
            : [0.25, 0.5, 0.75, 1, 0];

        if (sys._testStep === undefined || sys._testStep >= steps.length) {
            sys._testStep = 0;
        }
        const nextIndex = sys._testStep;
        const targetValue = steps[nextIndex];

        if (isManual) {
            pid.OUT = targetValue;
        } else {
            // 自动模式预留扩展
        }
        sys._testStep = (nextIndex + 1) % steps.length;
    }
}
