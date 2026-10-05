import { PROJECT_WORKFLOWS, FAULT_CONFIGS,
    fiveStep as defaultFiveStep,
    applyAllPresets as defaultApplyAllPresets,
    applyStartSystem as defaultApplyStartSystem } from '../project/sys_dgdq8.js';

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

        const projectConfigs = Object.values(PROJECT_WORKFLOWS).map(wf => ({
            id: wf.id,
            name: wf.name,
        }));

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

        // 注册步骤到 stepsArray
        Object.values(PROJECT_WORKFLOWS).forEach(wf => {
            sys.stepsArray[wf.id] = wf.steps;
        });
    }

    // ==========================================
    // 2. 故障初始化
    // ==========================================
    initFault() {
        const sys = this.sys;

        sys.FAULT_CONFIG = { ...FAULT_CONFIGS };

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
                label.appendChild(document.createTextNode(` ${fault.name} (${fault.system})`));
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
        // 必须先停止正在进行的演示：上一个流程可能正卡在某一步的 await 中，
        // 若不先停，它会用已换掉的 _workflow 继续执行（包括旧的 _resetRig 清空接线）、
        // 并把 _workflowIdx 改写，与新启动的演示并发 → 总线反复断开（CAN BUS OFF）
        // 且新流程的切页 op 被跳过（网络诊断页不出现）。
        try { sys.workflowComp.stopAutoDemo && sys.workflowComp.stopAutoDemo(); } catch (e) { /* ignore */ }

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
        sys.currentWorkflowId = taskValue;
        sys.workflowComp._workflow = sys.stepsArray[taskValue];
        sys.workflowComp._workflowIdx = 0;
        sys.workflowComp._wfZeroFaultSet = false;
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

    /** 一键自动连线：委托给项目配置实现 */
    applyAllPresets() {
        defaultApplyAllPresets.call(this);
    }

    /** 启动系统：委托给项目配置实现 */
    async applyStartSystem() {
        return defaultApplyStartSystem.call(this);
    }

    /** 5点步进系统：委托给项目配置实现 */
    fiveStep() {
        defaultFiveStep.call(this);
    }
}
