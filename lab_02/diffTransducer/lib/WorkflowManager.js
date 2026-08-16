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
            { id: 0, name: "1. 电动差压变送器的结构、电路、气路连接(项目7.3)" },
            { id: 1, name: "2. 电动差压变送器的零点和量程调整(项目7.3)" },
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
            // --- 气路部分 (Pipe) ---
            // 1. 气瓶 -> 截止阀 -> 三通
            { from: 'cab_pipe_o', to: 'stopvalve_pipe_i', type: 'pipe' },
            { from: 'stopvalve_pipe_o', to: 'teeconnector_pipe_u', type: 'pipe' },

            // 2. 低压支路 (L): 三通右端 -> 调压阀2 -> 三阀组inL -> 变送器L
            { from: 'teeconnector_pipe_r', to: 'pressreg2_pipe_i', type: 'pipe' },
            { from: 'pressreg2_pipe_o', to: '3valve_pipe_inl', type: 'pipe' },
            { from: '3valve_pipe_outl', to: 'difftr_pipe_l', type: 'pipe' },

            // 3. 高压支路 (H): 三通左端 -> 调压阀1 -> 三阀组inH -> 变送器H
            { from: 'teeconnector_pipe_l', to: 'pressreg_pipe_i', type: 'pipe' },
            { from: 'pressreg_pipe_o', to: '3valve_pipe_inh', type: 'pipe' },
            { from: '3valve_pipe_outh', to: 'difftr_pipe_h', type: 'pipe' },

            // --- 电路部分 (Wire) ---
            // 电源 -> 电阻 -> 变送器 -> 电流表 -> 电源
            { from: 'dcpower_wire_p', to: 'varires_wire_l', type: 'wire' },
            { from: 'varires_wire_r', to: 'difftr_wire_p', type: 'wire' },
            { from: 'difftr_wire_n', to: 'ampmeter_wire_p', type: 'wire' },
            { from: 'ampmeter_wire_n', to: 'dcpower_wire_n', type: 'wire' }
        ];

        const checkConnectionsExist = (connIndices) => {
            return connIndices.every(i =>
                sys.conns.some(c => sys.connMgr.connEqual(c, conns[i]))
            );
        };
        sys.stepsArray[0] = [
            // --- 第一部分：气路连接 ---
            {
                msg: "步骤 1：连接主气源：气瓶 -> 截止阀 -> 三通接头右端。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000)); // 先停顿
                    await sys.addConnectionAnimated(conns[0]);
                    await sys.addConnectionAnimated(conns[1]);
                },
                check: () => {
                    const c1 = sys.conns.some(c => sys._connEqual(c, conns[0]));
                    const c2 = sys.conns.some(c => sys._connEqual(c, conns[1]));
                    return c1 && c2;
                }
            },
            {
                msg: "步骤 2：连接低压气路：三通接头下端 -> 下调压阀2 -> 三阀组低压输入端 (inl)。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000)); // 先停顿
                    await sys.addConnectionAnimated(conns[2]);
                    await sys.addConnectionAnimated(conns[3]);
                },
                check: () => {
                    const c1 = sys.conns.some(c => sys._connEqual(c, conns[2]));
                    const c2 = sys.conns.some(c => sys._connEqual(c, conns[3]));
                    return c1 && c2;
                }
            },
            {
                msg: "步骤 3：连接高压气路：三通接头上端 -> 上调压阀1 -> 三阀组高压输入端 (inh)。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000)); // 先停顿
                    await sys.addConnectionAnimated(conns[5]);
                    await sys.addConnectionAnimated(conns[6]);
                },
                check: () => {
                    const c1 = sys.conns.some(c => sys._connEqual(c, conns[5]));
                    const c2 = sys.conns.some(c => sys._connEqual(c, conns[6]));
                    return c1 && c2;
                }
            },
            {
                msg: "步骤 4：连接变送器气口：三阀组输出端 -> 差压变送器对应 H/L 接口。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000)); // 先停顿
                    await sys.addConnectionAnimated(conns[4]); // L侧
                    await sys.addConnectionAnimated(conns[7]); // H侧
                },
                check: () => {
                    const c1 = sys.conns.some(c => sys._connEqual(c, conns[4]));
                    const c2 = sys.conns.some(c => sys._connEqual(c, conns[7]));
                    return c1 && c2;
                }
            },

            // --- 第二部分：电路连接 ---
            {
                msg: "步骤 5：连接供电回路：24V电源正极 -> 可调电阻 -> 变送器正极。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000)); // 先停顿
                    await sys.addConnectionAnimated(conns[8]);
                    await sys.addConnectionAnimated(conns[9]);
                },
                check: () => {
                    const c1 = sys.conns.some(c => sys._connEqual(c, conns[8]));
                    const c2 = sys.conns.some(c => sys._connEqual(c, conns[9]));
                    return c1 && c2;
                }
            },
            {
                msg: "步骤 6：闭合回路：变送器负极 -> 电流表 -> 电源负极。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000)); // 先停顿
                    await sys.addConnectionAnimated(conns[10]);
                    await sys.addConnectionAnimated(conns[11]);
                },
                check: () => {
                    const c1 = sys.conns.some(c => sys._connEqual(c, conns[10]));
                    const c2 = sys.conns.some(c => sys._connEqual(c, conns[11]));
                    return c1 && c2;
                }
            }
        ];
        sys.stepsArray[1] = [
            // 1. 检查项目0的连线是否全部完成
            {
                msg: "步骤 1：连线并检查，请确保气路与电路已按照要求连接完毕。",
                act: async () => {
                    // 自动补全未连接的线路（预防用户直接跳转项目2）
                    await new Promise(r => setTimeout(r, 3000)); // 先停顿
                    for (const conn of conns) {
                        if (!sys.conns.some(c => sys._connEqual(c, conn))) {
                            await sys.addConnectionAnimated(conn);
                        }
                    }
                },
                check: () => {
                    return conns.every(conn => sys.conns.some(c => sys._connEqual(c, conn)));
                }
            },

            // 2. 初始零点检查
            {
                msg: "步骤 2：接通电源，打开截止阀。观察电流显示应为 4mA（初始零点）。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000)); // 先停顿
                    sys.comps.dcpower.isOn = true;
                    // sys.comps.cab.pressure = 1.0; // 确保气瓶有压
                    sys.comps.stopvalve.isOpen = true; // 打开截止阀
                    sys.comps.dcpower.update();
                    sys.comps.stopvalve.update();
                    await new Promise(r => setTimeout(r, 2000));
                },
                check: () => sys.comps.dcpower.isOn && sys.comps.stopvalve.isOpen && Math.abs(sys.comps.ampmeter.value - 4) < 0.1
            },

            // 3. 三阀组操作：开平衡阀，高低压阀保持关闭
            {
                msg: "步骤 3：进入调校准备。先打开平衡阀 (vE)，并确认高、低压截止阀 (vH, vL) 处于关闭状态。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000)); // 先停顿
                    sys.comps['3valve'].vE = true;
                    sys.comps['3valve'].vH = false;
                    sys.comps['3valve'].vL = false;
                    sys.comps['3valve'].updateUI(); // 触发手柄旋转动画
                    await new Promise(r => setTimeout(r, 2000));
                },
                check: () => sys.comps['3valve'].vE === true && sys.comps['3valve'].vH === false && sys.comps['3valve'].vL === false
            },

            // 4. 三阀组操作：依次打开高低压阀
            {
                msg: "步骤 4：引入工艺压力,依次打开三阀组的高压截止阀和低压截止阀。关闭平衡阀，使系统投入工作。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000)); // 先停顿
                    sys.comps['3valve'].vH = true;
                    sys.comps['3valve'].updateUI();
                    await new Promise(r => setTimeout(r, 2000));
                    sys.comps['3valve'].vL = true;
                    sys.comps['3valve'].updateUI();
                    await new Promise(r => setTimeout(r, 2000));
                    sys.comps['3valve'].vE = false;
                    sys.comps['3valve'].updateUI();
                    await new Promise(r => setTimeout(r, 2000));
                },
                check: () => sys.comps['3valve'].vH === true && sys.comps['3valve'].vL === true && sys.comps['3valve'].vE === false
            },

            // 5. 设定调压阀压力以产生 0.1MPa 差压
            {
                msg: "步骤 5：设定新的零点0.1MPa：将调压阀1(高压侧)设为 0.4MPa，调压阀2(低压侧)设为 0.3MPa。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000)); // 先停顿
                    sys.comps.pressreg.setPressure = 0.4;
                    sys.comps.pressreg2.setPressure = 0.3;
                    sys.comps.pressreg.update();
                    sys.comps.pressreg2.update();
                    await new Promise(r => setTimeout(r, 2000));
                },
                check: () => Math.abs(sys.comps.pressreg.setPressure - 0.4) < 0.02 && Math.abs(sys.comps.pressreg2.setPressure - 0.3) < 0.02
            },

            // 6. 调节零点旋钮
            {
                msg: "步骤 6：零点调节：调节变送器的调零旋钮，使输出电流重新回到 4mA。",
                act: async () => {
                    // 模拟用户调节动作，这里可以直接修改变送器的内部零点偏移参数
                    await new Promise(r => setTimeout(r, 3000)); // 先停顿
                    sys.comps.difftr.zeroAdj = -1.6;
                    sys.comps.difftr.update();
                    await new Promise(r => setTimeout(r, 2000));
                },
                check: () => {
                    // 检查电流是否在 0.1MPa 差压下回到了 4mA 附近
                    const current = sys.comps.ampmeter.value;
                    return Math.abs(current - 4) < 0.05;
                }
            },
            // 7. 设定新的量程上限0.9MPa
            {
                msg: "步骤 7：设定新的量程上限：0.9MPa。将调压阀1(高压侧)设为 1.2MPa，调压阀2(低压侧)保持 0.3MPa。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000)); // 先停顿
                    sys.comps.pressreg.setPressure = 1.2;
                    sys.comps.pressreg.update();
                    await new Promise(r => setTimeout(r, 2000));
                },
                check: () => Math.abs(sys.comps.pressreg.setPressure - 1.2) < 0.02 && Math.abs(sys.comps.pressreg2.setPressure - 0.3) < 0.02
            },
            // 8. 调节量程旋钮
            {
                msg: "步骤 8：量程调整：调节变送器的量程旋钮，使输出电流重新回到 20mA。",
                act: async () => {
                    // 模拟用户调节动作，这里可以直接修改变送器的内部零点偏移参数
                    await new Promise(r => setTimeout(r, 3000)); // 先停顿
                    sys.comps.difftr.spanAdj = 1.224;
                    sys.comps.difftr.update();
                    await new Promise(r => setTimeout(r, 2000));
                },
                check: () => {
                    // 检查电流是否在 0.1MPa 差压下回到了 4mA 附近
                    const current = sys.comps.ampmeter.value;
                    return Math.abs(current - 20) < 0.05;
                }
            },
            // 9. 设定调压阀压力以产生 0.1MPa 差压
            {
                msg: "步骤 9：量程改变，零点改变，需要重新回到零点0.1MPa：将调压阀1(高压侧)设为 0.4MPa，调压阀2(低压侧)设为 0.3MPa。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000)); // 先停顿
                    sys.comps.pressreg.setPressure = 0.4;
                    sys.comps.pressreg.update();
                    await new Promise(r => setTimeout(r, 2000));
                },
                check: () => Math.abs(sys.comps.pressreg.setPressure - 0.4) < 0.02 && Math.abs(sys.comps.pressreg2.setPressure - 0.3) < 0.02
            },

            // 10. 重新调零
            {
                msg: "步骤 10：此时电流不是4mA，需要重新调零：调节变送器的调零旋钮，使输出电流重新回到 4mA。",
                act: async () => {
                    // 模拟用户调节动作，这里可以直接修改变送器的内部零点偏移参数
                    await new Promise(r => setTimeout(r, 3000)); // 先停顿
                    sys.comps.difftr.zeroAdj = -1.957;
                    sys.comps.difftr.update();
                    await new Promise(r => setTimeout(r, 2000));
                },
                check: () => {
                    // 检查电流是否在 0.1MPa 差压下回到了 4mA 附近
                    const current = sys.comps.ampmeter.value;
                    return Math.abs(current - 4) < 0.05;
                }
            },
            // 11. 再次回到新的量程上限0.9MPa
            {
                msg: "步骤 11：回到新的量程上限：0.9MPa。将调压阀1(高压侧)设为 1.2MPa，调压阀2(低压侧)保持 0.3MPa。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000)); // 先停顿
                    sys.comps.pressreg.setPressure = 1.2;
                    sys.comps.pressreg.update();
                    await new Promise(r => setTimeout(r, 2000));
                },
                check: () => Math.abs(sys.comps.pressreg.setPressure - 1.2) < 0.02 && Math.abs(sys.comps.pressreg2.setPressure - 0.3) < 0.02
            },
            // 12. 调节量程旋钮
            {
                msg: "步骤 12：再次进行量程调整：调节变送器的量程旋钮，使输出电流重新回到 20mA。",
                act: async () => {
                    // 模拟用户调节动作，这里可以直接修改变送器的内部零点偏移参数
                    await new Promise(r => setTimeout(r, 3000)); // 先停顿
                    sys.comps.difftr.spanAdj = 1.2470;
                    sys.comps.difftr.update();
                    await new Promise(r => setTimeout(r, 2000));
                },
                check: () => {
                    // 检查电流是否在 0.1MPa 差压下回到了 4mA 附近
                    const current = sys.comps.ampmeter.value;
                    return Math.abs(current - 20) < 0.05;
                }
            },
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
                trigger: () => { },
                check: () => { },
                repair: () => { }
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
            // 1. 气瓶 -> 截止阀 -> 三通
            { from: 'cab_pipe_o', to: 'stopvalve_pipe_i', type: 'pipe' },
            { from: 'stopvalve_pipe_o', to: 'teeconnector_pipe_u', type: 'pipe' },

            // 2. 低压支路 (L): 三通右端 -> 调压阀2 -> 三阀组inL -> 变送器L
            { from: 'teeconnector_pipe_r', to: 'pressreg2_pipe_i', type: 'pipe' },
            { from: 'pressreg2_pipe_o', to: '3valve_pipe_inl', type: 'pipe' },
            { from: '3valve_pipe_outl', to: 'difftr_pipe_l', type: 'pipe' },

            // 3. 高压支路 (H): 三通左端 -> 调压阀1 -> 三阀组inH -> 变送器H
            { from: 'teeconnector_pipe_l', to: 'pressreg_pipe_i', type: 'pipe' },
            { from: 'pressreg_pipe_o', to: '3valve_pipe_inh', type: 'pipe' },
            { from: '3valve_pipe_outh', to: 'difftr_pipe_h', type: 'pipe' },

            // --- 电路部分 (Wire) ---
            // 电源 -> 电阻 -> 变送器 -> 电流表 -> 电源
            { from: 'dcpower_wire_p', to: 'varires_wire_l', type: 'wire' },
            { from: 'varires_wire_r', to: 'difftr_wire_p', type: 'wire' },
            { from: 'difftr_wire_n', to: 'ampmeter_wire_p', type: 'wire' },
            { from: 'ampmeter_wire_n', to: 'dcpower_wire_n', type: 'wire' }
        ];


        sys.redrawAll();
    }

    /** 启动系统：开启电源、泵、发动机，切换 PID 至自动模式 */
    async applyStartSystem() {
        sys.comps.stopvalve.isOpen = true;
        sys.comps.stopvalve.update();
        sys.comps.dcpower.isOn = true;
        sys.comps.dcpower.update();
        sys.comps['3valve'].vH = true;
        sys.comps['3valve'].vL = true;
        sys.comps['3valve'].vE = false;
        sys.comps['3valve']._init();
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
        const reg2 = sys.comps['pressreg2'];
        reg2.setPressure = 0.3;
        reg2.update();
        const difftr = sys.comps['difftr'];
        if (!reg || !difftr) return;

        const isManual = true;
        const steps = [
            difftr.min + 0.4,  // 0: 触发复位
            difftr.min + 0.8,  // 1: 上升期-中间态
            difftr.min + 1.2,
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
