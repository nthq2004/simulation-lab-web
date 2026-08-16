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
            { id: 0, name: "1. 压力开关测操作和调整(项目7.2)" },
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

            // 调压阀 (regulator) -> 三通接头 (teeConnector) 的输入端 (u)
            { from: 'pressreg_pipe_o', to: 'teeconnector_pipe_r', type: 'pipe' },

            // 三通接头 (teeConnector) 分支 1 (l) -> 压力表 (pressMeter)
            { from: 'teeconnector_pipe_u', to: 'pressmeter_pipe_i', type: 'pipe' },

            // 三通接头 (teeConnector) 分支 2 (r) -> 压力开关 (pressSwitch)
            { from: 'teeconnector_pipe_l', to: 'yt1226_pipe_i', type: 'pipe' },

            // --- 电路部分 (Wire) ---
            // 万用表 (multimeter) 红表笔 -> 压力开关 (pressSwitch) 电气接口 1
            { from: 'multimeter_wire_v', to: 'yt1226_wire_NO', type: 'wire' },

            // 万用表 (multimeter) 黑表笔 -> 压力开关 (pressSwitch) 电气接口 2
            { from: 'multimeter_wire_com', to: 'yt1226_wire_COM', type: 'wire' }

        ];

        const checkConnectionsExist = (connIndices) => {
            return connIndices.every(i =>
                sys.conns.some(c => sys.connMgr.connEqual(c, autoConns[i]))
            );
        };

        sys.stepsArray[0] = [
            // --- 第一部分：YT1226 参数设置 ---
            {
                msg: "1：设置压力开关：将给定值（High Set）调至 0.12MPa，幅差旋钮调至第 6 格。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    // 假设设置 0.12MPa，幅差第 6 格对应约 0.04MPa 的幅差
                    sys.comps.yt1226.differential = 60;
                    sys.comps.yt1226.setPoint = 60;
                    sys.comps.yt1226.update();
                    await new Promise(r => setTimeout(r, 3000));
                },
                check: () => sys.comps.yt1226.differential === 60 && sys.comps.yt1226.setPoint === 60
            },

            // --- 第二部分：气路与电路连接 (Step 2 - 8) ---
            {
                msg: "2：连接气路：气瓶 -> 截止阀 。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    await sys.addConnectionAnimated(autoConns[0]); // airBottle -> stopValve

                },
                check: () => sys.conns.some(c => sys._connEqual(c, autoConns[0]))
            },
            {
                msg: "3：连接气路：截止阀 -> 调压阀。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    await sys.addConnectionAnimated(autoConns[1]); // stopValve -> regulator
                },
                check: () => sys.conns.some(c => sys._connEqual(c, autoConns[1]))
            },
            {
                msg: "4：连接气路：调压阀 -> 三通接头输入端。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    await sys.addConnectionAnimated(autoConns[2]);
                },
                check: () => sys.conns.some(c => sys._connEqual(c, autoConns[2]))
            },
            {
                msg: "5：连接气路：三通接头分支 -> 压力表。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    await sys.addConnectionAnimated(autoConns[3]);
                },
                check: () => sys.conns.some(c => sys._connEqual(c, autoConns[3]))
            },
            {
                msg: "6：连接气路：三通接头另一分支 -> YT1226 压力接口。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    await sys.addConnectionAnimated(autoConns[4]);
                },
                check: () => sys.conns.some(c => sys._connEqual(c, autoConns[4]))
            },
            {
                msg: "7：准备万用表：切换至电阻/通断档位，监测开关状态。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    sys.comps.multimeter.mode = 'RES200';
                    sys.comps.multimeter._updateAngleByMode();
                    await new Promise(r => setTimeout(r, 1000));
                },
                check: () => sys.comps.multimeter.mode === 'RES200'
            },
            {
                msg: "8：连接电路：万用表红表笔 -> 压力开关 NC 端子。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    await sys.addConnectionAnimated(autoConns[5]);
                },
                check: () => sys.conns.some(c => sys._connEqual(c, autoConns[5]))
            },
            {
                msg: "9：连接电路：万用表黑表笔 -> 压力开关 COM 端子。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    await sys.addConnectionAnimated(autoConns[6]);
                },
                check: () => sys.conns.some(c => sys._connEqual(c, autoConns[6]))
            },


            // --- 第三部分：动作特性演练 ---
            {
                msg: "10：打开截止阀，系统气路通畅。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    sys.comps.stopvalve.isOpen = true;
                    sys.comps.stopvalve.update();
                },
                check: () => sys.comps.stopvalve.isOpen === true
            },
            {
                msg: "11：调压：压力低于下限复位值 (LowSet - 0.01)，观察开关处于闭合状态。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    const target = sys.comps.yt1226.lowSet - 0.01;
                    sys.comps.pressreg.setPressure = target;
                    await new Promise(r => setTimeout(r, 3000));
                },
                check: () => sys.comps.yt1226.isEnergized === true && Math.abs(sys.comps.yt1226.pressure - (sys.comps.yt1226.lowSet - 0.01)) < 0.02
            },
            {
                msg: "12：升压：压力略高于下限值 (LowSet + 0.01)，由于幅差存在，开关应保持闭合。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    const target = sys.comps.yt1226.lowSet + 0.01;
                    sys.comps.pressreg.setPressure = target;
                    await new Promise(r => setTimeout(r, 3000));
                },
                check: () => sys.comps.yt1226.isEnergized === true && Math.abs(sys.comps.yt1226.pressure - (sys.comps.yt1226.lowSet + 0.01)) < 0.02
            },
            {
                msg: "13：升压：压力接近上限但未达到 (HighSet - 0.01)，开关应保持闭合。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    const target = sys.comps.yt1226.highSet - 0.01;
                    sys.comps.pressreg.setPressure = target;
                    await new Promise(r => setTimeout(r, 3000));
                },
                check: () => sys.comps.yt1226.isEnergized === true && Math.abs(sys.comps.yt1226.pressure - (sys.comps.yt1226.highSet - 0.01)) < 0.02
            },
            {
                msg: "14：触发上限：压力超过上限 (HighSet + 0.01)，开关应立即断开。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    const target = sys.comps.yt1226.highSet + 0.01;
                    sys.comps.pressreg.setPressure = target;
                    await new Promise(r => setTimeout(r, 3000));
                },
                check: () => sys.comps.yt1226.isEnergized === false && Math.abs(sys.comps.yt1226.pressure - (sys.comps.yt1226.highSet + 0.01)) < 0.02
            },
            {
                msg: "15：降压：压力跌回上限以下 (HighSet - 0.01)，由于滞后，开关应保持断开。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    const target = sys.comps.yt1226.highSet - 0.01;
                    sys.comps.pressreg.setPressure = target;
                    await new Promise(r => setTimeout(r, 3000));
                },
                check: () => sys.comps.yt1226.isEnergized === false && Math.abs(sys.comps.yt1226.pressure - (sys.comps.yt1226.highSet - 0.01)) < 0.02
            },
            {
                msg: "16：降压：压力继续跌至下限上方 (LowSet + 0.01)，开关仍应保持断开。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    const target = sys.comps.yt1226.lowSet + 0.01;
                    sys.comps.pressreg.setPressure = target;
                    await new Promise(r => setTimeout(r, 3000));
                },
                check: () => sys.comps.yt1226.isEnergized === false && Math.abs(sys.comps.yt1226.pressure - (sys.comps.yt1226.lowSet + 0.01)) < 0.02
            },
            {
                msg: "17：触发下限复位：压力低于下限值 (LowSet - 0.01)，开关应重新闭合。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    const target = sys.comps.yt1226.lowSet - 0.01;
                    sys.comps.pressreg.setPressure = target;
                    await new Promise(r => setTimeout(r, 3000));
                },
                check: () => sys.comps.yt1226.isEnergized === true && Math.abs(sys.comps.yt1226.pressure - (sys.comps.yt1226.lowSet - 0.01)) < 0.02
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
                name: "本项目无故障设置. ",
                trigger: () => {   },
                check: () => {   },
                repair: () => {   }
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
        // 1. 定义预设连接关系
        sys.conns = [
            // --- 气路部分 (Pipe) ---
            // 气瓶 (airBottle) -> 截止阀 (stopValve)
            { from: 'cab_pipe_o', to: 'stopvalve_pipe_i', type: 'pipe' },

            // 截止阀 (stopValve) -> 调压阀 (regulator)
            { from: 'stopvalve_pipe_o', to: 'pressreg_pipe_i', type: 'pipe' },

            // 调压阀 (regulator) -> 三通接头 (teeConnector) 的输入端 (u)
            { from: 'pressreg_pipe_o', to: 'teeconnector_pipe_r', type: 'pipe' },

            // 三通接头 (teeConnector) 分支 1 (l) -> 压力表 (pressMeter)
            { from: 'teeconnector_pipe_u', to: 'pressmeter_pipe_i', type: 'pipe' },

            // 三通接头 (teeConnector) 分支 2 (r) -> 压力开关 (pressSwitch)
            { from: 'teeconnector_pipe_l', to: 'yt1226_pipe_i', type: 'pipe' },

            // --- 电路部分 (Wire) ---
            // 万用表 (multimeter) 红表笔 -> 压力开关 (pressSwitch) 电气接口 1
            { from: 'multimeter_wire_v', to: 'yt1226_wire_NO', type: 'wire' },

            // 万用表 (multimeter) 黑表笔 -> 压力开关 (pressSwitch) 电气接口 2
            { from: 'multimeter_wire_com', to: 'yt1226_wire_COM', type: 'wire' }
        ];

        if (sys.comps.multimeter) {
            sys.comps.multimeter.mode = 'RES200';
            sys.comps.multimeter._updateAngleByMode();
        }
        sys.redrawAll();
    }

    /** 启动系统：开启电源、泵、发动机，切换 PID 至自动模式 */
    async applyStartSystem() {
        const sys = this.sys;
        sys.comps.stopvalve.isOpen = true;
        sys.comps.stopvalve.update();
    }

    /**
     * 5点步进系统：根据 PID 模式切换步进目标
     * 手动模式：步进 PID 输出 (0, 25, 50, 75, 100)
     * 自动模式：步进设定值 (0.25, 0.5, 0.75, 1, 0)
     */
    fiveStep() {
        const sys = this.sys;
        // const pid = sys.comps['pid'];
        const reg = sys.comps['pressreg'];
        const yt = sys.comps['yt1226'];
        if (!reg || !yt) return;

        const isManual = true;
        // const steps = isManual
        //     ? [0, 25, 50, 75, 100]
        //     : [0.25, 0.5, 0.75, 1, 0];
    // 1. 定义压力点序列
    const steps = [
        yt.lowSet - 0.01,  // 0: 触发复位
        yt.lowSet + 0.01,  // 1: 上升期-中间态
        yt.highSet - 0.01, // 2: 临界点前
        yt.highSet + 0.01, // 3: 触发跳断
        yt.highSet - 0.01, // 4: 下降期-滞后态
        yt.lowSet + 0.01,  // 5: 下降期-中间态
    ];


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
