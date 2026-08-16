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
    }

    // ==========================================
    // 1. 流程初始化：填充下拉框 + 定义所有步骤
    // ==========================================
    initSteps() {
        const sys = this.sys;

        const projectConfigs = [
            { id: 0, name: "1. 数字式温控器最小系统运行(项目4.2)" },
            { id: 1, name: "2. 温控系统阶跃响应(项目4.2)" },
            { id: 2, name: "3. 温控系统输入回路断线故障响应(项目4.2)" },
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
            { from: 'pid_wire_vcc', to: 'dcpower_wire_p', type: 'wire' },
            { from: 'pid_wire_gnd', to: 'dcpower_wire_n', type: 'wire' },
            { from: 'gnd_wire_gnd', to: 'dcpower_wire_n', type: 'wire' },            

            { from: 'oven_wire_l', to: 'ttrans_wire_l', type: 'wire' },
            { from: 'oven_wire_r', to: 'ttrans_wire_m', type: 'wire' },
            { from: 'oven_wire_r', to: 'ttrans_wire_r', type: 'wire' },

            { from: 'pid_wire_pi1', to: 'ampmeter_wire_p', type: 'wire' },
            { from: 'ampmeter_wire_n', to: 'ttrans_wire_p', type: 'wire' },
            { from: 'ttrans_wire_n', to: 'pid_wire_ni1', type: 'wire' },

            { from: 'pid_wire_no1', to: 'rplus_wire_r', type: 'wire' },
            { from: 'pid_wire_po1', to: 'rplus_wire_l', type: 'wire' },
            { from: 'rplus_wire_COM', to: 'oven_wire_heaterl', type: 'wire' },
            { from: 'rplus_wire_NO', to: 'oven_wire_heaterr', type: 'wire' },

            { from: 'pid_wire_no2', to: 'rminus_wire_r', type: 'wire' },
            { from: 'pid_wire_po2', to: 'rminus_wire_l', type: 'wire' },
            { from: 'rminus_wire_COM', to: 'oven_wire_fanl', type: 'wire' },
            { from: 'rminus_wire_NO', to: 'oven_wire_fanr', type: 'wire' },

            { from: 'pid_wire_b1', to: 'monitor_wire_b1', type: 'wire' },
            { from: 'pid_wire_a1', to: 'monitor_wire_a1', type: 'wire' }
        ];
        const meterConns = [
            { from: 'multimeter_wire_com', to: 'dcpower_wire_n', type: 'wire' },
            { from: 'multimeter_wire_v', to: 'dcpower_wire_p', type: 'wire' },
            { from: 'multimeter_wire_com', to: 'ptrans_wire_n', type: 'wire' },
            { from: 'multimeter_wire_v', to: 'ptrans_wire_p', type: 'wire' },
        ];

        const checkConnectionsExist = (connIndices) => {
            return connIndices.every(i =>
                sys.conns.some(c => sys.connMgr.connEqual(c, autoConns[i]))
            );
        };

        sys.stepsArray[0] = [
            //系统起动过程演练
            {
                msg: "1：连接PID控制器-->直流24V电源。",
                act: async () => {
                    await new Promise(resolve => setTimeout(resolve, 500));
                    for (let i = 0; i < 3; i++) {
                        await sys.addConnectionAnimated(autoConns[i]);
                    }
                    sys.comps.monitor.btnMute.fire('click');
                    sys.comps.monitor.btnAck.fire('click');
                    await new Promise(resolve => setTimeout(resolve, 500));
                },
                check: () => checkConnectionsExist([0, 1, 2])
            },
            {
                msg: "2：连接烘箱PT100传感器 --> 温度变送器-->PID控制器4-20mA输入端。",
                act: async () => {
                    await new Promise(resolve => setTimeout(resolve, 500));
                    for (let i = 3; i < 9; i++) {
                        await sys.addConnectionAnimated(autoConns[i]);
                    }

                },
                check: () => checkConnectionsExist([3, 4, 5, 6, 7, 8])
            },
            {
                msg: "3：连接PID控制器第1路输出-->加继电器 --> 烘箱加热器。",
                act: async () => {
                    await new Promise(resolve => setTimeout(resolve, 500));
                    for (let i = 9; i < 13; i++) {
                        await sys.addConnectionAnimated(autoConns[i]);
                    }
                },
                check: () => checkConnectionsExist([9, 10, 11, 12])
            },
            {
                msg: "4：连接PID控制器第2路输出-->减继电器 --> 烘箱散热风扇。",
                act: async () => {
                    await new Promise(resolve => setTimeout(resolve, 500));
                    for (let i = 13; i < 17; i++) {
                        await sys.addConnectionAnimated(autoConns[i]);
                    }
                },
                check: () => checkConnectionsExist([13, 14, 15, 16])
            },
            {
                msg: "5：连接PID控制器-->监控主机RS485通信端子。",
                act: async () => {
                    await new Promise(resolve => setTimeout(resolve, 500));
                    for (let i = 17; i < 19; i++) {
                        await sys.addConnectionAnimated(autoConns[i]);
                    }
                },
                check: () => checkConnectionsExist([17, 18])
            },
            {
                msg: "6：开启电源，确认PID控制处于手动状态，输出为50%，中位不输出。",
                act: async () => {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    sys.comps.dcpower.isOn = true;
                    sys.comps.dcpower.update();
                    sys.comps.pid.mode = "MAN";
                    sys.comps.pid.OUT = 50;
                    await new Promise(resolve => setTimeout(resolve, 4000));
                    sys.comps.monitor.btnMute.fire('click');
                    sys.comps.monitor.btnAck.fire('click');
                },
                check: () => {
                    const c1 = sys.comps.dcpower.isOn === true;
                    const c2 = sys.comps.pid.mode === "MAN";
                    const c3 = Math.abs(sys.comps.pid.OUT - 50) < 2;
                    return c1 && c2 && c3;
                }
            },

            // --- 电气接线部分 ---
            {
                msg: "7：将烘箱加热器和散热风扇的控制模式转为遥控。",
                act: async () => {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    sys.comps.oven._fanKnob.fire('click');
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    sys.comps.oven._heaterKnob.fire('click');
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    sys.comps.monitor.btnMute.fire('click');
                    sys.comps.monitor.btnAck.fire('click');
                    await new Promise(resolve => setTimeout(resolve, 2000));
                },
                check: () => {
                    const c1 = sys.comps.oven._fan.mode === "remote";
                    const c2 = sys.comps.oven._heater.mode === "remote";
                    return c1 && c2;
                }
            },
            {
                msg: "8：将PID控制器转为自动模式，系统开始工作，直到PV与SV差值小于10度。确保系统已经消音、消闪，故障复位。",
                act: async () => {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    sys.comps.pid.mode = "AUTO";
                    await new Promise(resolve => setTimeout(resolve, 2000));
                },
                check: () => {
                    const c1 = sys.comps.pid.mode === "AUTO";
                    const c2 = sys.comps.monitor.activeAlarms.every(
                        a => a.muted === true && a.confirmed === true);
                    return c1 && c2 && Math.abs(sys.comps.pid.PV - sys.comps.pid.SV) < 10;
                }
            }

        ];
        sys.stepsArray[1] = [
            // --- 阶跃响应 ---
            {
                msg: "1：确保系统已经正常运行，PID控制器自动模式，PV与SV偏差小于10度，报警已消声、消闪。",
                act: async () => {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    sys.applyAllPresets();
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    sys.applyStartSystem();
                    await new Promise(resolve => setTimeout(resolve, 30000));
                    sys.comps.monitor.btnMute.fire('click');
                    sys.comps.monitor.btnAck.fire('click');
                },
                check: () => {
                    const c1 = sys.comps.pid.mode === "AUTO";
                    const c2 = Math.abs(sys.comps.pid.PV - sys.comps.pid.SV) < 10;
                    const c3 = !sys.comps.monitor.activeAlarms.some(
                        a => a.muted === false);
                    const c4 = sys.comps.dcpower.isOn;
                    return c1 && c2 && c3 && c4;
                }
            },
            {
                msg: "2：将设定值调到80度，观察加继电器、加热器的动作。",
                act: async () => {
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    sys.comps.pid.SV = 80;
                    await new Promise(resolve => setTimeout(resolve, 30000));
                },
                check: () => Math.abs(sys.comps.pid.SV - 80) < 2
            },
            {
                msg: "3：将设定值调到50度，观察减继电器、散热风扇的动作。",
                act: async () => {
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    sys.comps.pid.SV = 50;
                    await new Promise(resolve => setTimeout(resolve, 30000));
                },
                check: () => Math.abs(sys.comps.pid.SV - 50) < 2
            }
        ];
        sys.stepsArray[2] = [
            // --- 温度变送器开路故障响应 ---
            {
                msg: "1：确保系统已经正常运行，PID控制器自动模式，PV与SV偏差小于10度，报警已消声、消闪。",
                act: async () => {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    sys.applyAllPresets();
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    sys.applyStartSystem();
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    sys.comps.monitor.btnMute.fire('click');
                    sys.comps.monitor.btnAck.fire('click');
                    await new Promise(resolve => setTimeout(resolve, 30000));

                },
                check: () => {
                    const c1 = sys.comps.pid.mode === "AUTO";
                    const c2 = Math.abs(sys.comps.pid.PV - sys.comps.pid.SV) < 10;
                    const c3 = !sys.comps.monitor.activeAlarms.some(
                        a => a.muted === false);
                    const c4 = sys.comps.dcpower.isOn;
                    return c1 && c2 && c3 && c4;
                }
            },
            {
                msg: "2：触发温度变送器输出回路断路故障。",
                act: async () => {
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    sys.comps.ttrans.isBreak = true;
                    await new Promise(resolve => setTimeout(resolve, 3000));
                },
                check: () => sys.comps.ttrans.isBreak === true
            },
            {
                msg: "3：查看报警监视面板，进行消音、消闪。",
                act: async () => {
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    sys.comps.monitor.btnMute.fire('click');
                    sys.comps.monitor.btnAck.fire('click');
                    await new Promise(resolve => setTimeout(resolve, 3000));
                },
                check: async () => {
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    const monitor = sys.comps.monitor;
                    const alarms = monitor.activeAlarms;
                    return alarms.every(a => a.muted === true);
                }

            },
            {
                msg: "4：描述现象：PID温度显示LLLL，因为电流为0，低于量程下限4mA。默认的处理方式：PID控制器认为温度偏低，以最大加热功率输出，最终系统温度超高。",
                act: async () => {
                    await new Promise(resolve => setTimeout(resolve, 10000));
                },
                check: async () => {
                    await new Promise(resolve => setTimeout(resolve, 5000));
                    const c1 = sys.comps.oven.sensorTemp >= 80;
                    return c1;
                }
            },
            {
                msg: "5：清除故障，描述现象：实际温度超高，以最大散热功率输出，迅速降温。",
                act: async () => {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    sys.comps.ttrans.isBreak = false;
                    await new Promise(resolve => setTimeout(resolve, 5000));
                    sys.comps.monitor.btnMute.fire('click');
                    sys.comps.monitor.btnAck.fire('click');
                },
                check: async () => {
                    // 1. 先等待 6s 确保仿真引擎的温度升高并触发了报警逻辑
                    await new Promise(resolve => setTimeout(resolve, 6000));
                    const monitor = sys.comps.monitor;
                    const alarms = monitor.activeAlarms;
                    // 3. 只有当存在报警，且所有报警都消音了，才返回 true
                    return alarms.every(a => a.muted === true) && sys.comps.ttrans.isBreak === false;
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
                name: "3. 温度变送器回路断路故障",
                trigger: () => {
                    // 1: 设置开路故障
                    const device = sys.comps['ttrans'];
                    if (device) {
                        device.isBreak = true;
                    }
                },
                check: () => { return sys.comps['ttrans'].isBreak },
                repair: () => {
                    if (sys.comps['ttrans'].isBreak) sys.comps['ttrans'].isBreak = false;
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
        sys.conns = [
            { from: 'pid_wire_vcc', to: 'dcpower_wire_p', type: 'wire' },
            { from: 'pid_wire_gnd', to: 'dcpower_wire_n', type: 'wire' },
            { from: 'dcpower_wire_n', to: 'gnd_wire_gnd', type: 'wire' },

            { from: 'oven_wire_l', to: 'ttrans_wire_l', type: 'wire' },
            { from: 'oven_wire_r', to: 'ttrans_wire_m', type: 'wire' },
            { from: 'oven_wire_r', to: 'ttrans_wire_r', type: 'wire' },
            { from: 'pid_wire_pi1', to: 'ampmeter_wire_p', type: 'wire' },
            { from: 'ampmeter_wire_n', to: 'ttrans_wire_p', type: 'wire' },
            { from: 'ttrans_wire_n', to: 'pid_wire_ni1', type: 'wire' },

            { from: 'pid_wire_no1', to: 'rplus_wire_r', type: 'wire' },
            { from: 'pid_wire_po1', to: 'rplus_wire_l', type: 'wire' },
            { from: 'rplus_wire_COM', to: 'oven_wire_heaterl', type: 'wire' },
            { from: 'rplus_wire_NO', to: 'oven_wire_heaterr', type: 'wire' },
            { from: 'pid_wire_no2', to: 'rminus_wire_r', type: 'wire' },
            { from: 'pid_wire_po2', to: 'rminus_wire_l', type: 'wire' },
            { from: 'rminus_wire_COM', to: 'oven_wire_fanl', type: 'wire' },
            { from: 'rminus_wire_NO', to: 'oven_wire_fanr', type: 'wire' },

            { from: 'pid_wire_b1', to: 'monitor_wire_b1', type: 'wire' },
            { from: 'pid_wire_a1', to: 'monitor_wire_a1', type: 'wire' }
        ];
        sys.redrawAll();
    }

    /** 启动系统：开启电源、泵、发动机，切换 PID 至自动模式 */
    async applyStartSystem() {
        const sys = this.sys;
        sys.comps.dcpower.isOn = true;
        sys.comps.dcpower.update();
        sys.comps.pid.mode = "AUTO";
        sys.comps.oven._fanKnob.fire('click');
        sys.comps.oven._heaterKnob.fire('click');
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
