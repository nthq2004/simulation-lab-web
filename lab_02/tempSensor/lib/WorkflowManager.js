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
            { id: 0, name: "1. PT100温度传感器的测试(项目7.1.1)" },
            { id: 1, name: "2. K型热电偶的测试(项目7.1.1)" },
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
 
            // --- 电路部分 (Wire) ---
            // 万用表 (multimeter) 红表笔 -> PT100电阻左端。
            { from: 'multimeter_wire_v', to: 'pt_wire_l', type: 'wire' },
            // 万用表 (multimeter) 黑表笔 ->PT100电阻右端。
            { from: 'multimeter_wire_com', to: 'pt_wire_r', type: 'wire' },
            // 万用表 (multimeter) 黑表笔 ->PT100电阻终端。
            { from: 'multimeter_wire_v', to: 'pt_wire_t', type: 'wire' },

            // 万用表 (multimeter) 红表笔 -> 热电偶左端。
            { from: 'multimeter_wire_v', to: 'tc_wire_r', type: 'wire' },
            // 万用表 (multimeter) 黑表笔 ->热电偶右端。
            { from: 'multimeter_wire_com', to: 'tc_wire_l', type: 'wire' },

        ];

        const checkConnectionsExist = (connIndices) => {
            return connIndices.every(i =>
                sys.conns.some(c => sys.connMgr.connEqual(c, autoConns[i]))
            );
        };

        sys.stepsArray[0] = [
            // --- 第一部分：万用表初始化 ---
            {
                msg: "1：准备检测：将万用表旋钮拨至电阻档 (200Ω 档位)。",
                act: async () => {
                    await new Promise(r=> setTimeout(r, 3000));
                    sys.comps.multimeter.mode = 'RES200'; // 假设万用表有此方法
                    sys.comps.multimeter._updateAngleByMode();
                },
                check: () => sys.comps.multimeter.mode === 'RES200'
            },

            // --- 第二部分：PT100 线路检测 ---
            {
                msg: "2：测量3线制特征：连接万用表至 PT100 的两个同颜色端，验证电阻很小。",
                act: async () => {
                    await new Promise(r=> setTimeout(r, 3000));
                    await sys.addConnectionAnimated(autoConns[1]); // COM -> pt_wire_r
                    await sys.addConnectionAnimated(autoConns[2]); // V -> pt_wire_t (注意：根据逻辑此处应为V/COM间电阻)
                    await new Promise(r=> setTimeout(r, 3000));
                },
                check: () => {
                    const c1 = sys.conns.some(c => sys._connEqual(c, autoConns[1]));
                    const c2 = sys.conns.some(c => sys._connEqual(c, autoConns[2]));
                    // 此时读数应接近 0
                    return c1 && c2 && sys.comps.multimeter.value < 0.5;
                }
            },
            {
                msg: "3：测量PT100传感器不同颜色的两端，检测常温阻值 (约107.7Ω)。",
                act: async () => {
                    await new Promise(r=> setTimeout(r, 3000));
                    // 移除旧连线并添加新连线
                    sys.removeConn(autoConns[2]);
                    await sys.addConnectionAnimated(autoConns[0]); // V -> pt_wire_l
                    await new Promise(r=> setTimeout(r, 3000));
                },
                check: () => {
                    const hasRightConn = sys.conns.some(c => sys._connEqual(c, autoConns[1]));
                    const hasLeftConn = sys.conns.some(c => sys._connEqual(c, autoConns[0]));
                    return hasLeftConn && hasRightConn && Math.abs(sys.comps.multimeter.value - 107.7) < 1;
                }
            },

            // --- 第三部分：模拟故障演练 ---
            {
                msg: "4：设置 PT100 开路故障，观察万用表显示溢出 (O.L)。",
                act: async () => {
                    await new Promise(r=> setTimeout(r, 3000));
                    sys.comps.pt.isOpen = true; // 设置开路故障
                    sys.comps.pt.update(20);
                    await new Promise(r=> setTimeout(r, 3000));
                },
                check: () => sys.comps.multimeter.value > 1e6
            },
            {
                msg: "5：修复开路故障，确认万用表读数恢复正常。",
                act: async () => {
                    await new Promise(r=> setTimeout(r, 3000));
                    sys.comps.pt.isOpen = false; // 修复开路故障
                    sys.comps.pt.update(20);
                    await new Promise(r=> setTimeout(r, 3000));
                },
                check: () => {
                    const c1 = Math.abs(sys.comps.multimeter.value - 107.7) < 1;
                    const c2 = sys.comps.pt.isOpen === false;
                    return c1 && c2;
                }

            },
            {
                msg: "6：设置 PT100 短路故障，观察万用表读数归零。",
                act: async () => {
                    await new Promise(r=> setTimeout(r, 3000));
                    sys.comps.pt.isShort = true; // 设置短路故障
                    sys.comps.pt.update(20);
                    await new Promise(r=> setTimeout(r, 3000));
                },
                check: () => sys.comps.multimeter.value < 0.2
            },
            {
                msg: "7：修复短路故障，确认读数恢复为当前环境阻值。",
                act: async () => {
                    await new Promise(r=> setTimeout(r, 3000));
                    sys.comps.pt.isShort = false; // 修复开路故障
                    sys.comps.pt.update(20);
                    await new Promise(r=> setTimeout(r, 3000));
                },
                check: () => {
                    const c1 = Math.abs(sys.comps.multimeter.value - 107.7) < 1;
                    const c2 = sys.comps.pt.isShort === false;
                    return c1 && c2;
                }
            },

            // --- 第四部分：动态实验 ---
            {
                msg: "8：操作：将 PT100 插入恒温水槽中。",
                act: async () => {
                    await new Promise(r=> setTimeout(r, 3000));
                    // 计算插入水槽的中心位置
                    const waterNode = sys.comps.temptest.waterRect;
                    const waterRect = waterNode.getClientRect();
                    const probeRect = sys.comps.pt.probe.getClientRect();
                    const ptGroup = sys.comps.pt.group; // 假设这是整个组件的 Konva Group

                    // 修正后的位移算法：当前位置 + (水槽中心坐标 - 探头中心坐标)
                    const dx = (waterRect.x + waterRect.width / 2) - (probeRect.x + probeRect.width / 2);
                    const dy = (waterRect.y + waterRect.height / 2) - (probeRect.y + probeRect.height / 2);

                    ptGroup.x(ptGroup.x() + dx);
                    ptGroup.y(ptGroup.y() + dy);

                    // 强制重绘
                    sys.redrawAll();
                },
                check: () => {
                    const probeRect = sys.comps.pt.probe.getClientRect();
                    const waterRect = sys.comps.temptest.waterRect.getClientRect();

                    // AABB 碰撞检测逻辑修复
                    const isIntersecting = !(
                        probeRect.x > waterRect.x + waterRect.width ||
                        probeRect.x + probeRect.width < waterRect.x ||
                        probeRect.y > waterRect.y + waterRect.height ||
                        probeRect.y + probeRect.height < waterRect.y
                    );
                    return isIntersecting;
                }
            },
            {
                msg: "9：开启水槽加热至 50℃，观察随温度上升的阻值变化 (约 119.4Ω)。",
                act: async () => {
                    await new Promise(r=> setTimeout(r, 3000));
                    sys.comps.temptest.targetTemp = 50;
                    sys.comps.temptest.toggle();
                    await new Promise(r=> setTimeout(r, 15000));
                    // 提示：此处在实际模拟中可能需要等待水温升高的逻辑过程
                },
                check: () => {
                    const currentTemp = sys.comps.temptest.currentTemp;
                    return Math.abs(currentTemp - 50) < 2 && Math.abs(sys.comps.multimeter.value - 119.4) < 1;
                }
            }
        ];
        sys.stepsArray[1] = [
            // --- 第一部分：热电偶通断检测 ---
            {
                msg: "1：准备检测：将万用表旋钮拨至二极管/蜂鸣器档，用于测试热电偶通断。",
                act: async () => {
                    await new Promise(r=> setTimeout(r, 3000));
                    sys.comps.multimeter.mode = 'DIODE';
                    sys.comps.multimeter._updateAngleByMode();
                },
                check: () => sys.comps.multimeter.mode === 'DIODE'
            },
            {
                msg: "2：连接万用表至热电偶左右两端，测量内部阻值（应小于 5Ω）。",
                act: async () => {
                    await new Promise(r=> setTimeout(r, 3000));
                    // 连接：红表笔 -> tc_wire_l, 黑表笔 -> tc_wire_r
                    await sys.addConnectionAnimated(autoConns[3]);
                    await sys.addConnectionAnimated(autoConns[4]);
                },
                check: () => {
                    const c1 = sys.conns.some(c => sys._connEqual(c, autoConns[3]));
                    const c2 = sys.conns.some(c => sys._connEqual(c, autoConns[4]));
                    // 热电偶导通电阻极小
                    return c1 && c2 && sys.comps.multimeter.value < 5;
                }
            },

            // --- 第二部分：静态电压检测 ---
            {
                msg: "3：切换档位：将万用表拨至直流毫伏档 (DCmV)，此时常温下电压应为 0mV。",
                act: async () => {
                    await new Promise(r=> setTimeout(r, 3000));
                    sys.comps.multimeter.mode = 'DCVmv';
                    sys.comps.multimeter._updateAngleByMode();
                },
                check: () => sys.comps.multimeter.mode === 'DCVmv' && Math.abs(sys.comps.multimeter.value) < 0.1
            },

            // --- 第三部分：热电效应动态实验 ---
            {
                msg: "4：操作：将热电偶插入恒温水槽中。",
                act: async () => {
                    await new Promise(r=> setTimeout(r, 3000));
                    // 旋转与位移逻辑 (复用之前修复的位移算法)
                    const waterNode = sys.comps.temptest.waterRect;
                    const waterRect = waterNode.getClientRect();
                    const probeRect = sys.comps.tc.probe.getClientRect();
                    const tcGroup = sys.comps.tc.group;

                    const dx = (waterRect.x + waterRect.width / 2) - (probeRect.x + probeRect.width / 2);
                    const dy = (waterRect.y + waterRect.height / 2) - (probeRect.y + probeRect.height / 2);

                    tcGroup.x(tcGroup.x() + dx);
                    tcGroup.y(tcGroup.y() + dy);

                    sys.redrawAll();
                },
                check: () => {
                    const probeRect = sys.comps.tc.probe.getClientRect();
                    const waterRect = sys.comps.temptest.waterRect.getClientRect();
                    const isIntersecting = !(
                        probeRect.x > waterRect.x + waterRect.width ||
                        probeRect.x + probeRect.width < waterRect.x ||
                        probeRect.y > waterRect.y + waterRect.height ||
                        probeRect.y + probeRect.height < waterRect.y
                    );
                    return isIntersecting;
                }
            },
            {
                msg: "5：水槽加热至 50℃，观察热电偶产生的热电势（约 1.2mV）。",
                act: async () => {
                    await new Promise(r=> setTimeout(r, 3000));
                    sys.comps.temptest.targetTemp = 50;
                    // 确保水槽开启加热
                    if (!sys.comps.temptest.isHeating) sys.comps.temptest.toggle();

                    // 等待温度升高及读数稳定
                    await new Promise(r=> setTimeout(r, 25000));
                },
                check: () => {
                    const currentTemp = sys.comps.temptest.currentTemp;
                    console.log(currentTemp,sys.comps.multimeter.value);
                    return Math.abs(currentTemp - 50) < 2 && Math.abs(sys.comps.multimeter.value*1000 - 1.2) < 0.3;
                }
            },
            {
                msg: "6：继续加热至 70℃，观察电压随温度升高而增大（约 2.0mV）。",
                act: async () => {
                    await new Promise(r=> setTimeout(r, 3000));
                    sys.comps.temptest.targetTemp = 70;
                    await new Promise(r=> setTimeout(r, 15000));
                },
                check: () => {
                    const currentTemp = sys.comps.temptest.currentTemp;
                    console.log(currentTemp,sys.comps.multimeter.value);
                    return Math.abs(currentTemp - 70) < 2 && Math.abs(sys.comps.multimeter.value*1000 - 2.0) < 0.3;
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
                name: "1. PT100热电阻断路故障 ",
                trigger: () => {  sys.comps['pt'].isOpen = true; },
                check: () => { return  sys.comps['pt'].isOpen === true; },
                repair: () => {  sys.comps['pt'].isOpen = false; }
            },
            2: {
                id: 2,
                name: "2. PT100热电阻短路故障 ",
                trigger: () => { sys.comps['pt'].isShort = true; },
                check: () => { return sys.comps['pt'].isShort === true; },
                repair: () => { sys.comps['pt'].isShort = false; }
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
        ];
        sys.redrawAll();
    }

    /** 启动系统：开启电源、泵、发动机，切换 PID 至自动模式 */
    async applyStartSystem() {
        const sys = this.sys;
    }

    /**
     * 5点步进系统：根据 PID 模式切换步进目标
     * 手动模式：步进 PID 输出 (0, 25, 50, 75, 100)
     * 自动模式：步进设定值 (0.25, 0.5, 0.75, 1, 0)
     */
    fiveStep() {
        const sys = this.sys;
        // const pid = sys.comps['pid'];
        const isManual = true;
        const steps = isManual
            ? [0, 25, 50, 75, 100]
            : [0.25, 0.5, 0.75, 1, 0];

        if (sys._testStep === undefined || sys._testStep >= steps.length) {
            sys._testStep = 0;
        }
        const nextIndex = sys._testStep;
        const targetValue = steps[nextIndex];

        if (isManual) {

        } else {
            // 自动模式预留扩展
        }
        sys._testStep = (nextIndex + 1) % steps.length;
    }
}
