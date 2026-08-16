import { SHIP_WORKFLOWS } from '../tools/Phase3Workflows.js';
import { FAULT_CONFIGS } from '../tools/Phase3FaultConfig.js';

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

        const projectConfigs = Object.values(SHIP_WORKFLOWS).map(wf => ({
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
        Object.values(SHIP_WORKFLOWS).forEach(wf => {
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
        // 演练/评估模式自动启动学员会话
        if ((mode === 'train' || mode === 'eval') && sys.sessionManager) {
            const taskSelect = document.getElementById('taskSelect');
            const workflowId = taskSelect ? taskSelect.value : 'unknown';
            if (workflowId) {
                sys.sessionManager.start('student', workflowId);
                console.log(`[Session] 已自动开始学员会话 (workflow: ${workflowId}, mode: ${mode})`);
            }
        }
    }

    // ==========================================
    // 4. 快捷操作
    // ==========================================

    /** 一键自动连线：将预设的逻辑关系注入连接池 */
    applyAllPresets() {
        const sys = this.sys;
        // Brokaw 温度传感器电路（16条连线）
        sys.redrawAll();
    }

    /** 启动系统：开启直流电源 */
    async applyStartSystem() {
        const sys = this.sys;
    }

    /**
     * 5点步进系统：压力循环 0 → 25 → 50 → 75 → 100 → 0
     */
    fiveStep() {
        const sys = this.sys;
        const pressures = [0, 25, 50, 75, 100];
        // 获取当前压力滑块值
        const slider = document.getElementById('pressSlider');
        const display = document.getElementById('pressDisplay');
        const currentPress = slider ? parseFloat(slider.value) : 0;

        let nextPress = pressures[0];
        for (const p of pressures) {
            if (Math.abs(p - currentPress) < 1) {
                const idx = pressures.indexOf(p);
                nextPress = pressures[(idx + 1) % pressures.length];
                break;
            }
        }

        if (slider) slider.value = nextPress;
        if (display) display.textContent = nextPress.toFixed(1) + ' kPa';

        if (sys.comps['bourdon'] && sys.comps['bourdon'].applyPressure) {
            sys.comps['bourdon'].applyPressure(nextPress);
        }
        if (sys.comps['diaphragm'] && sys.comps['diaphragm'].applyPressure) {
            const dPress = Math.min(nextPress, sys.comps['diaphragm'].rangeMax);
            sys.comps['diaphragm'].applyPressure(dPress);
        }
    }
}
