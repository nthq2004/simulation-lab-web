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
            { id: 0, name: "1. PTC电阻实现的过热保护电路" },
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

        // PTC 过热保护电路连线：
        // DC 12V(+) → PTC(过热保护元件) → 负载(5Ω 模拟电机/加热器) → GND
        const conns = [
            { from: 'dcpower_wire_p', to: 'ptc_wire_l', type: 'wire' },
            { from: 'ptc_wire_r', to: 'load_wire_l', type: 'wire' },
            { from: 'load_wire_r', to: 'gnd_wire_gnd', type: 'wire' },
            { from: 'dcpower_wire_n', to: 'gnd2_wire_gnd', type: 'wire' },
        ];
        sys.stepsArray[0] = [

            // --- 第1步：连接PTC过热保护主回路 ---
            {
                msg: "步骤 1：连接PTC过热保护电路：DC 12V→PTC(过热保护元件)→负载(5Ω)→GND。",
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

            // --- 第2步：开启直流电源，PTC处于常温低阻状态 ---
            {
                msg: "步骤 2：开启直流电源（12V），观察PTC常温低阻导通状态。",
                act: async () => {
                    await new Promise(resolve => setTimeout(resolve, 2000));

                    sys.comps.dcpower.isOn = true;
                    sys.comps.dcpower.update();

                    sys.showFloatingTip("电源已开启，PTC常温低阻，电流正常通过", 3000);
                },
                check: () => sys.comps.dcpower.isOn
            },

            // --- 第3步：观察PTC常温特性（手动升温前）---
            {
                msg: "步骤 3：观察PTC的R-T特性——常温下PTC呈低阻（约10Ω），电路正常工作。",
                act: async () => {
                    await new Promise(resolve => setTimeout(resolve, 3000));
                },
                check: () => {
                    const ptc = sys.comps.ptc;
                    return ptc && ptc.temperature < 40 && ptc.state === 'normal';
                }
            },

            // --- 第4步：PTC温度上升，进入保护状态 ---
            {
                msg: "步骤 4：PTC温度升高至切换点(Ts=80°C)以上——PTC进入高阻保护状态，电流受限。",
                act: async () => {
                    // 激活PTC自动热仿真模式，模拟过流/过热场景
                    const ptc = sys.comps.ptc;
                    if (ptc) {
                        ptc._autoMode = true;
                        ptc._useManual = false;
                        ptc._autoTemp = ptc.Tswitch + 10; // 直接让温度超过切换点
                    }
                    await new Promise(resolve => setTimeout(resolve, 4000));

                    sys.showFloatingTip("PTC已进入高阻保护状态！电流大幅下降", 3000);
                },
                check: () => {
                    const ptc = sys.comps.ptc;
                    return ptc && ptc.state === 'protected';
                }
            },

            // --- 第5步：PTC持续升温，进入深度保护 ---
            {
                msg: "步骤 5：PTC温度继续升高至居里点(Tc=110°C)——电阻急剧增大数百万倍，实现完全保护。",
                act: async () => {
                    const ptc = sys.comps.ptc;
                    if (ptc) {
                        ptc._autoTemp = ptc.Tcurie + 20;
                    }
                    await new Promise(resolve => setTimeout(resolve, 4000));

                    const ptcNow = sys.comps.ptc;
                    sys.showFloatingTip("PTC居里点突变：R=" +
                        ptcNow._fmtR(ptcNow.currentResistance) +
                        "  I=" + ptcNow.current.toFixed(4) + "A", 4000);
                },
                check: () => {
                    const ptc = sys.comps.ptc;
                    return ptc && ptc.currentResistance > ptc.Rmin * 1000;
                }
            },

            // --- 第6步：降温，PTC自动恢复 ---
            {
                msg: "步骤 6：触发PTC自恢复——移除过热源后PTC降温，电阻自动恢复至低阻态。",
                act: async () => {
                    const ptc = sys.comps.ptc;
                    if (ptc) {
                        ptc._autoMode = false;
                        ptc._useManual = true;
                        ptc._manualTemp = 25;
                    }
                    await new Promise(resolve => setTimeout(resolve, 5000));

                    sys.showFloatingTip("PTC已自动恢复，电路重新正常导通", 3000);
                },
                check: () => {
                    const ptc = sys.comps.ptc;
                    return ptc && ptc.temperature < 45 && ptc.state === 'normal';
                }
            },

            // --- 第7步：实验总结 ---
            {
                msg: "步骤 7：观察PTC的自恢复特性——PTC过热保护实验完成。",
                act: async () => {
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    sys.showFloatingTip("PTC过热保护实验完成！\n核心原理：居里点相变→电阻突增→限流保护→降温恢复", 5000);
                },
                check: () => {
                    const ptc = sys.comps.ptc;
                    return ptc && ptc.state === 'normal';
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
                name: "PTC短路失效（失去过热保护能力）",
                trigger: () => {
                    const ptc = sys.comps.ptc;
                    if (ptc) {
                        // 将PTC的Rmin设为极低且不随温度变化，模拟短路
                        ptc._origRmin = ptc.Rmin;
                        ptc._origRmax = ptc.Rmax;
                        ptc.Rmin = 0.01;
                        ptc.Rmax = 0.01;
                    }
                },
                check: () => {
                    const ptc = sys.comps.ptc;
                    return ptc ? ptc.Rmin < 0.1 : false;
                },
                repair: () => {
                    const ptc = sys.comps.ptc;
                    if (ptc) {
                        if (ptc._origRmin) ptc.Rmin = ptc._origRmin;
                        if (ptc._origRmax) ptc.Rmax = ptc._origRmax;
                    }
                }
            },

            2: {
                id: 2,
                name: "PTC开路失效（电路断路无法工作）",
                trigger: () => {
                    const ptc = sys.comps.ptc;
                    if (ptc) { ptc.isBreak = true; }
                },
                check: () => {
                    const ptc = sys.comps.ptc;
                    return ptc ? ptc.isBreak : false;
                },
                repair: () => {
                    const ptc = sys.comps.ptc;
                    if (ptc) { ptc.isBreak = false; }
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
        // 定义预设连接关系 — PTC过热保护电路
        // DC 12V(+) → PTC → 负载(5Ω) → GND
        sys.conns = [
            { from: 'dcpower_wire_p', to: 'ptc_wire_l', type: 'wire' },
            { from: 'ptc_wire_r', to: 'load_wire_l', type: 'wire' },
            { from: 'load_wire_r', to: 'gnd_wire_gnd', type: 'wire' },
            { from: 'dcpower_wire_n', to: 'gnd2_wire_gnd', type: 'wire' },
        ];

        sys.redrawAll();
    }

    /** 启动系统：开启直流电源 */
    async applyStartSystem() {
        const sys = this.sys;
        sys.comps.dcpower.isOn = true;
        sys.comps.dcpower.update();
    }

    /**
     * 5点步进系统：在正常和过温保护状态间切换
     */
    fiveStep() {
        const sys = this.sys;
        const dcpower = sys.comps['dcpower'];
        const ptc = sys.comps['ptc'];

        if (!dcpower) return;

        if (dcpower.isOn) {
            // 当前开机 → 关机，观察PTC恢复
            dcpower.isOn = false;
            dcpower.update();
            // 将PTC重置为常温态
            if (ptc) {
                ptc._autoMode = false;
                ptc._useManual = true;
                ptc._manualTemp = 25;
            }
            if (sys.showFloatingTip) {
                sys.showFloatingTip("电源关闭，PTC冷却恢复中", 2000);
            }
        } else {
            // 当前关机 → 开机，先观察正常运行，再触发过温保护
            dcpower.isOn = true;
            dcpower.update();

            // 激活PTC自动热仿真，模拟过温
            if (ptc) {
                ptc._autoMode = true;
                ptc._useManual = false;
                ptc._autoTemp = ptc.Tswitch + 15;
            }
            if (sys.showFloatingTip) {
                sys.showFloatingTip(
                    "PTC过温保护启动：R=" + ptc._fmtR(ptc.currentResistance) +
                    " I=" + (ptc.current || 0).toFixed(2) + "A",
                    3000
                );
            }
        }
    }
}
