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
            { id: 0, name: "1. 空气瓶压力双位控制" },
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

        const conns = [
            //1，空气瓶的出口连接三通接口的上端端
            { from: 'cab_pipe_o', to: 'teeconnector_pipe_u', type: 'pipe' },
            //2. 三通接口左端连接截止阀输入端，截止阀输出连气压表
            { from: 'teeconnector_pipe_l', to: 'stopvalve_pipe_i', type: 'pipe' },
            { from: 'stopvalve_pipe_o', to: 'pressmeter_pipe_i', type: 'pipe' },
            //3.三通接口右端连接压力开关气压输入口
            { from: 'teeconnector_pipe_r', to: 'pressswitch_pipe_i', type: 'pipe' },
            //4.压缩机的出口连到空气瓶入口
            { from: 'ac_pipe_o', to: 'cab_pipe_i', type: 'pipe' },
            //5 压缩机的遥控电气接口连到压力开关的电路输出
            { from: 'ac_wire_l', to: 'pressswitch_wire_NO', type: 'wire' },
            { from: 'ac_wire_r', to: 'pressswitch_wire_COM', type: 'wire' },


        ];
        sys.stepsArray[0] = [

            // --- 第1步：建立气路基础 ---
            {
                msg: "步骤 1：连接气源主回路（压缩机 → 空气瓶 → 三通）。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));

                    await sys.addConnectionAnimated(conns[4]); // 压缩机 → 空气瓶
                    await sys.addConnectionAnimated(conns[0]); // 空气瓶 → 三通上端
                },
                check: () =>
                    [4, 0].every(i => sys.conns.some(c => sys._connEqual(c, conns[i])))
            },

            // --- 第2步：连接测量支路 ---
            {
                msg: "步骤 2：连接压力表测量回路（三通 → 截止阀 → 压力表）。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 1000));

                    await sys.addConnectionAnimated(conns[1]); // 三通 → 截止阀
                    await sys.addConnectionAnimated(conns[2]); // 截止阀 → 压力表
                },
                check: () =>
                    [1, 2].every(i => sys.conns.some(c => sys._connEqual(c, conns[i])))
            },

            // --- 第3步：连接控制支路 ---
            {
                msg: "步骤 3：连接压力开关气源（三通 → 压力开关）。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 1000));

                    await sys.addConnectionAnimated(conns[3]); // 注意：这里是你定义中的右侧（如果编号不同请对应）
                },
                check: () =>
                    sys.conns.some(c => sys._connEqual(c, conns[3]))
            },

            // --- 第4步：连接电气控制回路 ---
            {
                msg: "步骤 4：连接压力开关与压缩机控制电路。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 1000));

                    await sys.addConnectionAnimated(conns[5]); // NO → 压缩机
                    await sys.addConnectionAnimated(conns[6]); // COM → 压缩机
                },
                check: () =>
                    [5, 6].every(i => sys.conns.some(c => sys._connEqual(c, conns[i])))
            },

            // --- 第5步：打开截止阀 ---
            {
                msg: "步骤 5：打开截止阀，使气源进入压力表和压力开关。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 1000));

                    const valve = sys.comps['stopvalve'];
                    if (valve) {
                        valve.isOpen = true;
                        valve.update();
                        sys.showFloatingTip("截止阀已打开", 2000);
                    }

                    await new Promise(r => setTimeout(r, 1500));
                },
                check: () => sys.comps['stopvalve']?.isOpen === true
            },

            // --- 第6步：切换遥控模式 ---
            {
                msg: "步骤 6：将压缩机切换至遥控模式（由压力开关自动控制）。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 1000));

                    const ac = sys.comps['ac'];
                    if (ac) {
                        ac.mode = 'remote';
                        sys.comps.ac.knobGroup.rotation(45);
                        sys.showFloatingTip("压缩机已进入遥控模式", 2000);
                    }

                    await new Promise(r => setTimeout(r, 1500));
                },
                check: () => sys.comps['ac']?.mode === 'remote'
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
                name: "本实验无故障设置环节",
                trigger: () => {
                    
                },
                check: () => false,
                repair: () => {
                    
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
        // 1. 定义预设连接关系
        sys.conns = [
            //首先，空气瓶的出口连接三通接口的右端
            { from: 'cab_pipe_o', to: 'teeconnector_pipe_u', type: 'pipe' },
            //三通接口左端连接
            { from: 'teeconnector_pipe_l', to: 'stopvalve_pipe_i', type: 'pipe' },
            //截止阀
            { from: 'stopvalve_pipe_o', to: 'pressmeter_pipe_i', type: 'pipe' },
            //三通接口下端连接压力开关
            { from: 'teeconnector_pipe_r', to: 'pressswitch_pipe_i', type: 'pipe' },
            //压缩机的出口连到空气瓶入口
            { from: 'ac_pipe_o', to: 'cab_pipe_i', type: 'pipe' },
            //压缩机的另个电气接口连到压力开关
            { from: 'ac_wire_l', to: 'pressswitch_wire_NO', type: 'wire' },
            { from: 'ac_wire_r', to: 'pressswitch_wire_COM', type: 'wire' },
        ];

        sys.redrawAll();
    }

    /** 启动系统：开启电源、泵、发动机，切换 PID 至自动模式 */
    async applyStartSystem() {

        sys.comps.ac.mode = 'remote';
        sys.comps.ac.knobGroup.rotation(45);
        sys.comps.stopvalve.toggle();
    }

    /**
     * 5点步进系统：根据 PID 模式切换步进目标
     * 手动模式：步进 PID 输出 (0, 25, 50, 75, 100)
     * 自动模式：步进设定值 (0.25, 0.5, 0.75, 1, 0)
     */
    fiveStep() {
        const sys = this.sys;
        const pid = sys.comps['pid'];
        const varires = sys.comps['varires'];

        if (!pid || !varires) return;

        // 1. 获取当前 PID 模式 (假设 pid.mode 为 'MAN' 或 'AUTO')
        const isManual = pid.mode === 'MAN';

        // 2. 定义不同模式下的步进序列
        const steps = isManual
            ? [25, 50, 75, 100, 0]                   // 手动模式：PID 输出百分比 (%)
            : [100 + 25 * 0.3851, 100 + 50 * 0.3851, 100 + 75 * 0.3851, 100 + 100 * 0.3851, 100]; // 自动模式：Pt100 电阻值 (Ω)


        if (sys._testStep === undefined || sys._testStep >= steps.length) {
            sys._testStep = 0;
        }
        const nextIndex = sys._testStep;
        const targetValue = steps[nextIndex];

        if (isManual) {
            // --- 手动模式逻辑 ---
            // 设置 PID 的手动输出值
            pid.OUT = targetValue;

        } else {
            // 设置可变电阻值 (模拟 Pt100)
            varires.currentResistance = targetValue;
            if (typeof varires.update === 'function') {
                varires.update();
            }
        }
        sys._testStep = (nextIndex + 1) % steps.length;
    }
}
