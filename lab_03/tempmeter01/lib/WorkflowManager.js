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
        sys.redrawAll();
    }

    /** 启动系统：开启直流电源 */
    async applyStartSystem() {
        const sys = this.sys;
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

            if (sys.comps['bimetal'] && sys.comps['bimetal'].setTemperature) {
                sys.comps['bimetal'].setTemperature(nextTemp);
            }
            if (sys.comps['mercury'] && sys.comps['mercury'].setTemperature) {
                sys.comps['mercury'].setTemperature(nextTemp);
            }
            if (sys.comps['tempmeter'] && sys.comps['tempmeter'].update) {
                sys.comps['tempmeter'].update(nextTemp);
            }
            if (sys.comps['handheld'] && sys.comps['handheld'].update) {
                sys.comps['handheld'].update(nextTemp);
            }        

    }
}
