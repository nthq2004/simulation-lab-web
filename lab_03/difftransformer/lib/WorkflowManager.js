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
            { id: 0, name: "1. 差动变压器实现的压力变送器" },
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
            //1，从信号变送器sg的第1路ch1p连接差动变压器pt的原边
            { from: 'sg_wire_ch1p', to: 'pt_wire_p', type: 'wire' },
            { from: 'sg_wire_ch1n', to: 'gnd1_wire_gnd', type: 'wire' },
            { from: 'pt_wire_n', to: 'gnd1_wire_gnd', type: 'wire' },
            //2. 从差动变压器pt副边连接到信号输入端
            { from: 'pt_wire_outp', to: 'r10k3_wire_l', type: 'wire' },
            { from: 'pt_wire_outn', to: 'gnd2_wire_gnd', type: 'wire' },
            //3. 参考信号通过运放生成高低电平信号，驱动JFET开关
            { from: 'sg_wire_ch1p', to: 'c1_wire_l', type: 'wire' },
            { from: 'c1_wire_r', to: 'r10k1_wire_l', type: 'wire' },
            { from: 'r10k1_wire_r', to: 'gnd3_wire_gnd', type: 'wire' },
            { from: 'r10k1_wire_l', to: 'amp1_wire_n', type: 'wire' },
            { from: 'r10k1_wire_r', to: 'amp1_wire_p', type: 'wire' },
            //4. JFET开关的控制信号
            { from: 'amp1_wire_OUT', to: 'd1_wire_r', type: 'wire' },
            { from: 'd1_wire_l', to: 'r10k2_wire_l', type: 'wire' },
            { from: 'r10k2_wire_r', to: 'gnd4_wire_gnd', type: 'wire' },
            { from: 'r10k2_wire_l', to: 'jfet_wire_g', type: 'wire' },
            { from: 'gnd4_wire_gnd', to: 'jfet_wire_s', type: 'wire' },
            { from: 'amp2_wire_p', to: 'jfet_wire_d', type: 'wire' },
            //5. 运放组成的相敏整流电路
            { from: 'amp2_wire_p', to: 'r10k4_wire_r', type: 'wire' },
            { from: 'amp2_wire_n', to: 'r10k3_wire_r', type: 'wire' },
            { from: 'r10k3_wire_l', to: 'r10k4_wire_l', type: 'wire' },
            { from: 'amp2_wire_OUT', to: 'r220_wire_l', type: 'wire' },
            { from: 'r220_wire_r', to: 'varires_wire_r', type: 'wire' },
            { from: 'varires_wire_l', to: 'amp2_wire_n', type: 'wire' },
            //6. 二阶低通滤波电路
            { from: 'r220_wire_r', to: 'r10k5_wire_l', type: 'wire' },
            { from: 'r10k5_wire_r', to: 'r10k6_wire_l', type: 'wire' },
            { from: 'r10k5_wire_r', to: 'c2_wire_l', type: 'wire' },
            { from: 'r10k6_wire_r', to: 'c3_wire_l', type: 'wire' },
            { from: 'c2_wire_r', to: 'gnd6_wire_gnd', type: 'wire' },
            { from: 'c3_wire_r', to: 'gnd6_wire_gnd', type: 'wire' },
            //7. 射级跟随器
            { from: 'amp3_wire_p', to: 'r10k6_wire_r', type: 'wire' },
            { from: 'amp3_wire_n', to: 'amp3_wire_OUT', type: 'wire' },
            //8.通用变送器
            { from: 'amp3_wire_OUT', to: 'vtr_wire_l', type: 'wire' },
            { from: 'vtr_wire_r', to: 'gnd6_wire_gnd', type: 'wire' },
            //9. PID 供电和4-20mA采集电路
            { from: 'pid_wire_pi1', to: 'vtr_wire_p', type: 'wire' },
            { from: 'pid_wire_ni1', to: 'vtr_wire_n', type: 'wire' },
            { from: 'pid_wire_vcc', to: 'dcpower2_wire_p', type: 'wire' },
            { from: 'pid_wire_gnd', to: 'dcpower2_wire_n', type: 'wire' },
            //10.示波器接入
            { from: 'osc3_wire_ch1p', to: 'sg_wire_ch1p', type: 'wire' },
            { from: 'osc3_wire_ch1n', to: 'gnd5_wire_gnd', type: 'wire' },
            { from: 'osc3_wire_ch2p', to: 'r10k3_wire_l', type: 'wire' },
            { from: 'osc3_wire_ch2n', to: 'gnd5_wire_gnd', type: 'wire' },
            { from: 'osc3_wire_ch3p', to: 'r220_wire_r', type: 'wire' },
            { from: 'osc3_wire_ch3n', to: 'gnd5_wire_gnd', type: 'wire' },
            //11. 气路接入
            { from: 'cab_pipe_o', to: 'preg_pipe_i', type: 'pipe' },
            { from: 'preg_pipe_o', to: 'pt_pipe_i', type: 'pipe' }
        ];
        sys.stepsArray[0] = [

            // --- 第1步：激励信号接入 ---
            {
                msg: "步骤 1：连接信号发生器到差动变压器原边。",
                act: async () => {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    await sys.addConnectionAnimated(conns[0]);
                    await sys.addConnectionAnimated(conns[1]);
                    await sys.addConnectionAnimated(conns[2]);
                },
                check: () =>
                    [0, 1, 2].every(i => sys.conns.some(c => sys._connEqual(c, conns[i])))
            },

            // --- 第2步：差动变压器输出接入 ---
            {
                msg: "步骤 2：连接差动变压器副边到信号输入端。",
                act: async () => {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    await sys.addConnectionAnimated(conns[3]);
                    await sys.addConnectionAnimated(conns[4]);
                },
                check: () =>
                    [3, 4].every(i => sys.conns.some(c => sys._connEqual(c, conns[i])))
            },

            // --- 第3步：建立参考信号（同步检波基准） ---
            {
                msg: "步骤 3：构建参考信号通道（RC + 运放比较器）。",
                act: async () => {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    await sys.addConnectionAnimated(conns[5]);
                    await sys.addConnectionAnimated(conns[6]);
                    await sys.addConnectionAnimated(conns[7]);
                    await sys.addConnectionAnimated(conns[8]);
                    await sys.addConnectionAnimated(conns[9]);
                },
                check: () =>
                    [5, 6, 7, 8, 9].every(i => sys.conns.some(c => sys._connEqual(c, conns[i])))
            },

            // --- 第4步：JFET 开关控制 ---
            {
                msg: "步骤 4：连接JFET控制信号（相敏开关）。",
                act: async () => {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    await sys.addConnectionAnimated(conns[10]);
                    await sys.addConnectionAnimated(conns[11]);
                    await sys.addConnectionAnimated(conns[12]);
                    await sys.addConnectionAnimated(conns[13]);
                    await sys.addConnectionAnimated(conns[14]);
                    await sys.addConnectionAnimated(conns[15]);
                },
                check: () =>
                    [10, 11, 12, 13, 14, 15].every(i => sys.conns.some(c => sys._connEqual(c, conns[i])))
            },

            // --- 第5步：相敏检波运放 ---
            {
                msg: "步骤 5：连接相敏检波运放电路。",
                act: async () => {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    await sys.addConnectionAnimated(conns[16]);
                    await sys.addConnectionAnimated(conns[17]);
                    await sys.addConnectionAnimated(conns[18]);
                    await sys.addConnectionAnimated(conns[19]);
                    await sys.addConnectionAnimated(conns[20]);
                    await sys.addConnectionAnimated(conns[21]);
                },
                check: () =>
                    [16, 17, 18, 19, 20, 21].every(i => sys.conns.some(c => sys._connEqual(c, conns[i])))
            },

            // --- 第6步：二阶低通滤波 ---
            {
                msg: "步骤 6：连接二阶低通滤波电路（提取直流量）。",
                act: async () => {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    await sys.addConnectionAnimated(conns[22]);
                    await sys.addConnectionAnimated(conns[23]);
                    await sys.addConnectionAnimated(conns[24]);
                    await sys.addConnectionAnimated(conns[25]);
                    await sys.addConnectionAnimated(conns[26]);
                    await sys.addConnectionAnimated(conns[27]);
                },
                check: () =>
                    [22, 23, 24, 25, 26, 27].every(i => sys.conns.some(c => sys._connEqual(c, conns[i])))
            },

            // --- 第7步：缓冲输出（射极跟随器） ---
            {
                msg: "步骤 7：连接输出缓冲级（射极跟随器）。",
                act: async () => {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    await sys.addConnectionAnimated(conns[28]);
                    await sys.addConnectionAnimated(conns[29]);
                },
                check: () =>
                    [28, 29].every(i => sys.conns.some(c => sys._connEqual(c, conns[i])))
            },

            // --- 第8步：接入变送器 ---
            {
                msg: "步骤 8：连接通用变送器输入。",
                act: async () => {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    await sys.addConnectionAnimated(conns[30]);
                    await sys.addConnectionAnimated(conns[31]);
                },
                check: () =>
                    [30, 31].every(i => sys.conns.some(c => sys._connEqual(c, conns[i])))
            },

            // --- 第9步：4-20mA 回路 ---
            {
                msg: "步骤 9：连接PID与4-20mA采集回路。",
                act: async () => {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    await sys.addConnectionAnimated(conns[32]);
                    await sys.addConnectionAnimated(conns[33]);
                },
                check: () =>
                    [32, 33].every(i => sys.conns.some(c => sys._connEqual(c, conns[i])))
            },

            // --- 第10步：示波器 ---
            {
                msg: "步骤 10：接入示波器观测关键节点信号。",
                act: async () => {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    await sys.addConnectionAnimated(conns[36]);
                    await sys.addConnectionAnimated(conns[37]);
                    await sys.addConnectionAnimated(conns[38]);
                    await sys.addConnectionAnimated(conns[39]);
                    await sys.addConnectionAnimated(conns[40]);
                    await sys.addConnectionAnimated(conns[41]);
                },
                check: () =>
                    [36, 37, 38, 39, 40, 41].every(i => sys.conns.some(c => sys._connEqual(c, conns[i])))
            },

            // --- 第11步：连接电源 ---
            {
                msg: "步骤 11：连接系统电源。",
                act: async () => {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    await sys.addConnectionAnimated(conns[34]); // VCC
                    await sys.addConnectionAnimated(conns[35]); // GND

                    sys.showFloatingTip("系统已连接电源", 2000);
                },
                check: () =>
                    [34, 35].every(i => sys.conns.some(c => sys._connEqual(c, conns[i])))
            },
            {
                msg: "步骤 11：连接气路。",
                act: async () => {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    await sys.addConnectionAnimated(conns[42]); // VCC
                    await sys.addConnectionAnimated(conns[43]); // GND

                    sys.showFloatingTip("系统已连接气路", 2000);
                },
                check: () =>
                    [36, 37].every(i => sys.conns.some(c => sys._connEqual(c, conns[i])))
            },
            {
                msg: "步骤 13：开启系统电源。",
                act: async () => {
                    sys.comps.dcpower2.isOn = true;
                    sys.comps.dcpower2.update();

                    sys.showFloatingTip("系统已开启电源", 2000);
                },
                check: () =>
                    [34, 35].every(i => sys.conns.some(c => sys._connEqual(c, conns[i])))
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
                name: "本项目无故障设置",
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
            //1，从信号变送器sg的第1路ch1p连接差动变压器pt的原边
            { from: 'sg_wire_ch1p', to: 'pt_wire_p', type: 'wire' },
            { from: 'sg_wire_ch1n', to: 'gnd1_wire_gnd', type: 'wire' },
            { from: 'pt_wire_n', to: 'gnd1_wire_gnd', type: 'wire' },
            //2. 从差动变压器pt副边连接到信号输入端
            { from: 'pt_wire_outp', to: 'r10k3_wire_l', type: 'wire' },
            { from: 'pt_wire_outn', to: 'gnd2_wire_gnd', type: 'wire' },
            //3. 参考信号通过运放生成高低电平信号，驱动JFET开关
            { from: 'sg_wire_ch1p', to: 'c1_wire_l', type: 'wire' },
            { from: 'c1_wire_r', to: 'r10k1_wire_l', type: 'wire' },
            { from: 'r10k1_wire_r', to: 'gnd3_wire_gnd', type: 'wire' },
            { from: 'r10k1_wire_l', to: 'amp1_wire_n', type: 'wire' },
            { from: 'r10k1_wire_r', to: 'amp1_wire_p', type: 'wire' },
            //4. JFET开关的控制信号
            { from: 'amp1_wire_OUT', to: 'd1_wire_r', type: 'wire' },
            { from: 'd1_wire_l', to: 'r10k2_wire_l', type: 'wire' },
            { from: 'r10k2_wire_r', to: 'gnd4_wire_gnd', type: 'wire' },
            { from: 'r10k2_wire_l', to: 'jfet_wire_g', type: 'wire' },
            { from: 'gnd4_wire_gnd', to: 'jfet_wire_s', type: 'wire' },
            { from: 'amp2_wire_p', to: 'jfet_wire_d', type: 'wire' },
            //5. 运放组成的相敏整流电路
            { from: 'amp2_wire_p', to: 'r10k4_wire_r', type: 'wire' },
            { from: 'amp2_wire_n', to: 'r10k3_wire_r', type: 'wire' },
            { from: 'r10k3_wire_l', to: 'r10k4_wire_l', type: 'wire' },
            { from: 'amp2_wire_OUT', to: 'r220_wire_l', type: 'wire' },
            { from: 'r220_wire_r', to: 'varires_wire_r', type: 'wire' },
            { from: 'varires_wire_l', to: 'amp2_wire_n', type: 'wire' },
            //6. 二阶低通滤波电路
            { from: 'r220_wire_r', to: 'r10k5_wire_l', type: 'wire' },
            { from: 'r10k5_wire_r', to: 'r10k6_wire_l', type: 'wire' },
            { from: 'r10k5_wire_r', to: 'c2_wire_l', type: 'wire' },
            { from: 'r10k6_wire_r', to: 'c3_wire_l', type: 'wire' },
            { from: 'c2_wire_r', to: 'gnd6_wire_gnd', type: 'wire' },
            { from: 'c3_wire_r', to: 'gnd6_wire_gnd', type: 'wire' },
            //7. 射级跟随器
            { from: 'amp3_wire_p', to: 'r10k6_wire_r', type: 'wire' },
            { from: 'amp3_wire_n', to: 'amp3_wire_OUT', type: 'wire' },
            //8.通用变送器
            { from: 'amp3_wire_OUT', to: 'vtr_wire_l', type: 'wire' },
            { from: 'vtr_wire_r', to: 'gnd6_wire_gnd', type: 'wire' },
            //9. PID 供电和4-20mA采集电路
            { from: 'pid_wire_pi1', to: 'vtr_wire_p', type: 'wire' },
            { from: 'pid_wire_ni1', to: 'vtr_wire_n', type: 'wire' },
            { from: 'pid_wire_vcc', to: 'dcpower2_wire_p', type: 'wire' },
            { from: 'pid_wire_gnd', to: 'dcpower2_wire_n', type: 'wire' },
            //10.示波器接入
            { from: 'osc3_wire_ch1p', to: 'sg_wire_ch1p', type: 'wire' },
            { from: 'osc3_wire_ch1n', to: 'gnd5_wire_gnd', type: 'wire' },
            { from: 'osc3_wire_ch2p', to: 'r10k3_wire_l', type: 'wire' },
            { from: 'osc3_wire_ch2n', to: 'gnd5_wire_gnd', type: 'wire' },
            { from: 'osc3_wire_ch3p', to: 'r220_wire_r', type: 'wire' },
            { from: 'osc3_wire_ch3n', to: 'gnd5_wire_gnd', type: 'wire' },
            //11. 气路接入
            { from: 'cab_pipe_o', to: 'preg_pipe_i', type: 'pipe' },
            { from: 'preg_pipe_o', to: 'pt_pipe_i', type: 'pipe' }
        ];

        sys.redrawAll();
    }

    /** 启动系统：开启电源、泵、发动机，切换 PID 至自动模式 */
    async applyStartSystem() {

        sys.comps.dcpower2.isOn = true;
        sys.comps.dcpower2.update();
    }

    /**
     * 5点步进系统：根据 PID 模式切换步进目标
     * 手动模式：步进 PID 输出 (0, 25, 50, 75, 100)
     * 自动模式：步进设定值 (0.25, 0.5, 0.75, 1, 0)
     */
    fiveStep() {
        const sys = this.sys;
        const pid = sys.comps['pid'];
        const preg = sys.comps['preg'];

        if (!pid || !preg) return;

        // 1. 获取当前 PID 模式 (假设 pid.mode 为 'MAN' 或 'AUTO')
        const isManual = true;

        // 2. 定义不同模式下的步进序列
        const steps = isManual
            ? [0.25, 0.5, 0.75, 1.0, 0]                   // 手动模式：PID 输出百分比 (%)
            : [100 + 25 * 0.3851, 100 + 50 * 0.3851, 100 + 75 * 0.3851, 100 + 100 * 0.3851, 100]; // 自动模式：Pt100 电阻值 (Ω)


        if (sys._testStep === undefined || sys._testStep >= steps.length) {
            sys._testStep = 0;
        }
        const nextIndex = sys._testStep;
        const targetValue = steps[nextIndex];

        if (isManual) {
            // --- 手动模式逻辑 ---
            // 设置 PID 的手动输出值
            preg.setPressure = targetValue;
            preg.update();

        } else {
            // // 设置可变电阻值 (模拟 Pt100)
            // varires.currentResistance = targetValue;
            // if (typeof varires.update === 'function') {
            //     varires.update();
            // }
        }
        sys._testStep = (nextIndex + 1) % steps.length;
    }
}
