import { Workflow } from './tools/Workflow.js';
import { CircuitSolver } from './tools/CircuitSolver.js';
import { PneumaticSolver } from './tools/PneumaticSolver.js';


import { AirBottle } from './components/AirBottle.js';
import { PressRegulator } from './components/PressRegulator.js';
import { StopValve } from './components/StopValve.js';
import { TeeConnector } from './components/TeeConnector.js';

import { DCPower } from './components/DCPower.js';
import { VariResistor } from './components/VariResistor.js';
import { AmpMeter } from './components/AmpMeter.js';
import { DiffTransmitter } from './components/DiffTransmitter.js';
import { ThreeValve } from './components/ThreeValve.js';



/**
 * ControlSystem - 控制系统仿真引擎
 * 负责组件管理、物理计算、自动/手动连线逻辑及渲染更新
 */
export class ControlSystem {
    constructor() {
        // 1. 画布基础设置
        this.container = document.getElementById('container');
        this.stage = new Konva.Stage({ container: 'container', width: window.innerWidth, height: window.innerHeight });
        this.layer = new Konva.Layer();
        this.lineLayer = new Konva.Layer();
        this.stage.add(this.layer, this.lineLayer);

        // 2. 组件和连线资源池
        this.comps = {};        // 组件实例集合
        this.conns = [];        // 所有连接统一存储为 {from, to, type}
        this.pipeNodes = [];    // 画布上的管路形状节点
        this.wireNodes = [];    // 画布上的电路形状节点

        // 3. 连线交互状态
        this.linkingState = null; // 当前正在连线的起点信息
        this.tempLine = null;     // 鼠标跟随虚线

        //4. 流程控制和电路求解
        this.stepsArray = [];  //存储所有流程的数组
        this.workflowComp = null;  //流程控制实例组件
        this.solver = null;  //电路求解器实例组件

        //5.基本初始化、撤销恢复初始化、交互初始化、流程控制初始化。
        this.init();
        this.initHistory();
        this.initStageEvents();
        this.initSteps();
        this.initFault();
    }

    // ==========================================
    // 第一部分：初始化与核心配置
    // ==========================================

    /**
     * 1. 系统初始化：创建组件并启动仿真循环
     */
    init() {
        // 1. 实例化组件，传入 this 以便组件能够调用 handlePortClick 和 redrawAll
        const componentConfigs = [
            { Class: DCPower, id: 'dcpower', x: 60, y: 65 },
            { Class: VariResistor, id: 'varires', x: 400, y: 165 },
            { Class: AmpMeter, id: 'ampmeter', x: 100, y: 365 },
            { Class: DiffTransmitter, id: 'difftr', x: 230, y: 230 },
            { Class: ThreeValve, id: '3valve', x: 230, y: 480 },
            { Class: TeeConnector, id: 'teeconnector', x: 700, y: 505, direction: 'right' },
            { Class: PressRegulator, id: 'pressreg', x: 500, y: 435 },
            { Class: PressRegulator, id: 'pressreg2', x: 500, y: 635 },
            { Class: StopValve, id: 'stopvalve', x: 850, y: 455 },
            { Class: AirBottle, id: 'cab', x: 1050, y: 435 },

        ];

        componentConfigs.forEach(cfg => {
            this.comps[cfg.id] = new cfg.Class(cfg, this);
            this.layer.add(this.comps[cfg.id].group);
        });
        this.layer.draw();

        // 2. 实例化流程工具、电路求解工具
        this.workflowComp = new Workflow(this);
        this.voltageSolver = new CircuitSolver(this);
        this.pressSolver = new PneumaticSolver(this);

        // 3. 启动物理计算和动画循环
        this.anim = new Konva.Animation((frame) => this.updateSimulation(frame), this.layer);
        this.anim.start();
    }

    // 2. 历史状态初始化、声明onChange函数（处理两个按钮的状态）
    initHistory() {
        // history 管理：仅记录用户点击产生的连接/删除动作
        this.history = new HistoryManager();
        const btnUndo = document.getElementById('btnUndo');
        const btnRedo = document.getElementById('btnRedo');
        this.history.onChange = () => {
            btnUndo.disabled = !(this.history.undos && this.history.undos.length > 0);
            btnRedo.disabled = !(this.history.redos && this.history.redos.length > 0);
        };
        this.history.onChange();
    }

    // 3. 连线交互的初始化、定义鼠标移动处理函数（画出虚线）
    initStageEvents() {
        // 鼠标移动时实时更新虚线终点坐标
        this.stage.on('mousemove', () => {
            if (!this.linkingState || !this.tempLine) return;
            const pos = this.stage.getPointerPosition();
            let startPos;
            if (this.linkingState.comp && this.linkingState.comp.getAbsPortPos) {
                startPos = this.linkingState.comp.getAbsPortPos(this.linkingState.portId);
            } else {
                const did = this.linkingState.portId.split('_')[0];
                startPos = this.comps[did]?.getAbsPortPos(this.linkingState.portId);
            }
            if (!startPos) return;
            this.tempLine.points([startPos.x, startPos.y, pos.x, pos.y]);
            this.tempLine.moveToBottom();
            this.layer.batchDraw();
        });
        // 右键或 ESC 取消当前连线操作
        window.addEventListener('contextmenu', (e) => { e.preventDefault(); this.resetLinking(); });
        window.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.resetLinking(); });
    }

    // 4. 流程初始化函数
    initSteps() {
        // 1. 定义项目配置表 (包含名称和 ID)
        const projectConfigs = [
            { id: 0, name: "1. 电动差压变送器的结构、电路、气路连接(项目7.3)" },
            { id: 1, name: "2. 电动差压变送器的零点和量程调整(项目7.3)" },
        ];

        // 2. 动态填充 HTML 的 select 下拉框
        const taskSelect = document.getElementById('taskSelect');
        if (taskSelect) {
            // 保留第一个默认选项，清空其他的（防止重复调用时堆叠）
            taskSelect.innerHTML = '<option value="" selected>请选择操作项目...</option>';

            projectConfigs.forEach(proj => {
                const opt = document.createElement('option');
                opt.value = proj.id;    // 对应 stepsArray 的索引
                opt.textContent = proj.name;
                taskSelect.appendChild(opt);
            });
        }
        // 3. 每个项目操作流程定义
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
        this.stepsArray[0] = [
            // --- 第一部分：气路连接 ---
            {
                msg: "步骤 1：连接主气源：气瓶 -> 截止阀 -> 三通接头右端。",
                act: async () => {
                    await new Promise(resolve => setTimeout(resolve, 3000)); // 先停顿
                    await this.addConnectionAnimated(conns[0]);
                    await this.addConnectionAnimated(conns[1]);
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
                    await new Promise(resolve => setTimeout(resolve, 3000)); // 先停顿
                    await this.addConnectionAnimated(conns[2]);
                    await this.addConnectionAnimated(conns[3]);
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
                    await new Promise(resolve => setTimeout(resolve, 3000)); // 先停顿
                    await this.addConnectionAnimated(conns[5]);
                    await this.addConnectionAnimated(conns[6]);
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
                    await new Promise(resolve => setTimeout(resolve, 3000)); // 先停顿
                    await this.addConnectionAnimated(conns[4]); // L侧
                    await this.addConnectionAnimated(conns[7]); // H侧
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
                    await new Promise(resolve => setTimeout(resolve, 3000)); // 先停顿
                    await this.addConnectionAnimated(conns[8]);
                    await this.addConnectionAnimated(conns[9]);
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
                    await new Promise(resolve => setTimeout(resolve, 3000)); // 先停顿
                    await this.addConnectionAnimated(conns[10]);
                    await this.addConnectionAnimated(conns[11]);
                },
                check: () => {
                    const c1 = sys.conns.some(c => sys._connEqual(c, conns[10]));
                    const c2 = sys.conns.some(c => sys._connEqual(c, conns[11]));
                    return c1 && c2;
                }
            }
        ];
        this.stepsArray[1] = [
    // 1. 检查项目0的连线是否全部完成
    {
        msg: "步骤 1：连线并检查，请确保气路与电路已按照要求连接完毕。",
        act: async () => {
            // 自动补全未连接的线路（预防用户直接跳转项目2）
            await new Promise(resolve => setTimeout(resolve, 3000)); // 先停顿
            for (const conn of conns) {
                if (!sys.conns.some(c => sys._connEqual(c, conn))) {
                    await this.addConnectionAnimated(conn);
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
            await new Promise(resolve => setTimeout(resolve, 3000)); // 先停顿
            this.comps.dcpower.isOn = true;
            // this.comps.cab.pressure = 1.0; // 确保气瓶有压
            this.comps.stopvalve.isOpen = true; // 打开截止阀
            this.comps.dcpower.update();
            this.comps.stopvalve.update();
            await new Promise(resolve => setTimeout(resolve, 2000));
        },
        check: () => this.comps.dcpower.isOn && this.comps.stopvalve.isOpen && Math.abs(this.comps.ampmeter.value - 4) < 0.1
    },

    // 3. 三阀组操作：开平衡阀，高低压阀保持关闭
    {
        msg: "步骤 3：进入调校准备。先打开平衡阀 (vE)，并确认高、低压截止阀 (vH, vL) 处于关闭状态。",
        act: async () => {
            await new Promise(resolve => setTimeout(resolve, 3000)); // 先停顿
            this.comps['3valve'].vE = true;
            this.comps['3valve'].vH = false;
            this.comps['3valve'].vL = false;
            this.comps['3valve'].updateUI(); // 触发手柄旋转动画
            this.layer.batchDraw();
            await new Promise(resolve => setTimeout(resolve, 2000));
        },
        check: () => this.comps['3valve'].vE === true && this.comps['3valve'].vH === false && this.comps['3valve'].vL === false
    },

    // 4. 三阀组操作：依次打开高低压阀
    {
        msg: "步骤 4：引入工艺压力,依次打开三阀组的高压截止阀和低压截止阀。关闭平衡阀，使系统投入工作。",
        act: async () => {
            await new Promise(resolve => setTimeout(resolve, 3000)); // 先停顿
            this.comps['3valve'].vH = true;
            this.comps['3valve'].updateUI();
            await new Promise(resolve => setTimeout(resolve, 2000));
            this.comps['3valve'].vL = true;
            this.comps['3valve'].updateUI();
            await new Promise(resolve => setTimeout(resolve, 2000)); 
            this.comps['3valve'].vE =false;
            this.comps['3valve'].updateUI();            
            await new Promise(resolve => setTimeout(resolve, 2000));
        },
        check: () => this.comps['3valve'].vH === true && this.comps['3valve'].vL === true&&this.comps['3valve'].vE ===false
    },

    // 5. 设定调压阀压力以产生 0.1MPa 差压
    {
        msg: "步骤 5：设定新的零点0.1MPa：将调压阀1(高压侧)设为 0.4MPa，调压阀2(低压侧)设为 0.3MPa。",
        act: async () => {
            await new Promise(resolve => setTimeout(resolve, 3000)); // 先停顿
            this.comps.pressreg.setPressure = 0.4;
            this.comps.pressreg2.setPressure = 0.3;
            this.comps.pressreg.update();
            this.comps.pressreg2.update();
            await new Promise(resolve => setTimeout(resolve, 2000));
        },
        check: () =>Math.abs(this.comps.pressreg.setPressure - 0.4) <0.02 && Math.abs(this.comps.pressreg2.setPressure - 0.3) <0.02
    },

    // 6. 调节零点旋钮
    {
        msg: "步骤 6：零点调节：调节变送器的调零旋钮，使输出电流重新回到 4mA。",
        act: async () => {
            // 模拟用户调节动作，这里可以直接修改变送器的内部零点偏移参数
            await new Promise(resolve => setTimeout(resolve, 3000)); // 先停顿
            this.comps.difftr.zeroAdj = -1.6; 
            this.comps.difftr.update();
            await new Promise(resolve => setTimeout(resolve, 2000));
        },
        check: () => {
            // 检查电流是否在 0.1MPa 差压下回到了 4mA 附近
            const current = this.comps.ampmeter.value;
            return Math.abs(current - 4) < 0.05;
        }
    },
        // 7. 设定新的量程上限0.9MPa
    {
        msg: "步骤 7：设定新的量程上限：0.9MPa。将调压阀1(高压侧)设为 1.2MPa，调压阀2(低压侧)保持 0.3MPa。",
        act: async () => {
            await new Promise(resolve => setTimeout(resolve, 3000)); // 先停顿
            this.comps.pressreg.setPressure = 1.2;
            this.comps.pressreg.update();
            await new Promise(resolve => setTimeout(resolve, 2000));
        },
        check: () =>Math.abs(this.comps.pressreg.setPressure - 1.2) <0.02 && Math.abs(this.comps.pressreg2.setPressure - 0.3) <0.02
    },
        // 8. 调节量程旋钮
    {
        msg: "步骤 8：量程调整：调节变送器的量程旋钮，使输出电流重新回到 20mA。",
        act: async () => {
            // 模拟用户调节动作，这里可以直接修改变送器的内部零点偏移参数
            await new Promise(resolve => setTimeout(resolve, 3000)); // 先停顿
            this.comps.difftr.spanAdj = 1.224; 
            this.comps.difftr.update();
            await new Promise(resolve => setTimeout(resolve, 2000));
        },
        check: () => {
            // 检查电流是否在 0.1MPa 差压下回到了 4mA 附近
            const current = this.comps.ampmeter.value;
            return Math.abs(current - 20) < 0.05;
        }
    },
        // 9. 设定调压阀压力以产生 0.1MPa 差压
    {
        msg: "步骤 9：量程改变，零点改变，需要重新回到零点0.1MPa：将调压阀1(高压侧)设为 0.4MPa，调压阀2(低压侧)设为 0.3MPa。",
        act: async () => {
            await new Promise(resolve => setTimeout(resolve, 3000)); // 先停顿
            this.comps.pressreg.setPressure = 0.4;
            this.comps.pressreg.update();
            await new Promise(resolve => setTimeout(resolve, 2000));
        },
        check: () =>Math.abs(this.comps.pressreg.setPressure - 0.4) <0.02 && Math.abs(this.comps.pressreg2.setPressure - 0.3) <0.02
    },

    // 10. 重新调零
    {
        msg: "步骤 10：此时电流不是4mA，需要重新调零：调节变送器的调零旋钮，使输出电流重新回到 4mA。",
        act: async () => {
            // 模拟用户调节动作，这里可以直接修改变送器的内部零点偏移参数
            await new Promise(resolve => setTimeout(resolve, 3000)); // 先停顿
            this.comps.difftr.zeroAdj = -1.957; 
            this.comps.difftr.update();
            await new Promise(resolve => setTimeout(resolve, 2000));
        },
        check: () => {
            // 检查电流是否在 0.1MPa 差压下回到了 4mA 附近
            const current = this.comps.ampmeter.value;
            return Math.abs(current - 4) < 0.05;
        }
    },
            // 11. 再次回到新的量程上限0.9MPa
    {
        msg: "步骤 11：回到新的量程上限：0.9MPa。将调压阀1(高压侧)设为 1.2MPa，调压阀2(低压侧)保持 0.3MPa。",
        act: async () => {
            await new Promise(resolve => setTimeout(resolve, 3000)); // 先停顿
            this.comps.pressreg.setPressure = 1.2;
            this.comps.pressreg.update();
            await new Promise(resolve => setTimeout(resolve, 2000));
        },
        check: () =>Math.abs(this.comps.pressreg.setPressure - 1.2) <0.02 && Math.abs(this.comps.pressreg2.setPressure - 0.3) <0.02
    },
        // 12. 调节量程旋钮
    {
        msg: "步骤 12：再次进行量程调整：调节变送器的量程旋钮，使输出电流重新回到 20mA。",
        act: async () => {
            // 模拟用户调节动作，这里可以直接修改变送器的内部零点偏移参数
            await new Promise(resolve => setTimeout(resolve, 3000)); // 先停顿
            this.comps.difftr.spanAdj = 1.2470; 
            this.comps.difftr.update();
            await new Promise(resolve => setTimeout(resolve, 2000));
        },
        check: () => {
            // 检查电流是否在 0.1MPa 差压下回到了 4mA 附近
            const current = this.comps.ampmeter.value;
            return Math.abs(current - 20) < 0.05;
        }
    },
];
    }

    // 5. 初始化故障触发、修复、检测
    initFault() {

        // 1. 配置化故障定义：code -> { 检测逻辑, 修复逻辑 }
        this.FAULT_CONFIG = {
            1: {
                id: 1,
                name: "本项目无故障设置环节",
                trigger: () => { if (this.comps['trans']) this.comps['trans'].isOpened = true; },
                check: () => this.comps['trans']?.isOpened === true,
                repair: () => { if (this.comps['trans']) this.comps['trans'].isOpened = false; }
            }
            // 2: { check: ..., repair: ... }, // 后续增加故障只需在此处添加
        };
        // 2. 动态生成 UI 元素
        const faultForm = document.getElementById('faultForm');
        if (faultForm) {
            faultForm.innerHTML = ''; // 清空原有内容

            Object.values(this.FAULT_CONFIG).forEach(fault => {
                const label = document.createElement('label');
                label.className = 'f-checkbox';

                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.value = fault.id;
                checkbox.id = `fault_check_${fault.id}`; // 确保 ID 唯一，不要全是 check1

                label.appendChild(checkbox);
                label.appendChild(document.createTextNode(` ${fault.name}`));

                faultForm.appendChild(label);
            });
        }

    }
    // ==========================================
    // 第二部分：处理流程化任务
    // ==========================================
    // 1. 项目选择框调用的函数，用于切换 任务流程。
    switchWorkflow(taskValue) {
        if (!taskValue) {
            console.log("未选择任何任务，清空流程数据");
            this.workflowComp._workflow = [];
            this.workflowComp._workflowIdx = 0;

            // 如果面板已打开，刷新一下列表显示为空
            if (this.workflowComp._workflowPanelEl) {
                this.workflowComp.closeWorkflowPanel();
            }
            return;
        }

        console.log("切换至任务:", taskValue);

        // 根据具体任务 ID 加载对应的步骤数据
        // 你可以把这些数据存在一个对象里，例如 this.allTasksData
        this.workflowComp._workflow = this.stepsArray[taskValue];

        // 切换任务后，重置进度索引
        this.workflowComp._workflowIdx = 0;

        // 切换任务后，需要重新点击开始
        if (this.workflowComp._workflowPanelEl) {
            this.workflowComp.closeWorkflowPanel();
        }
    }

    // 2. 根据用户选择的方式，单步、完整、评估、演练调用流程工具的对应函数。
    openWorkflowPanel(mode) {
        if (mode === 'step') {
            this.workflowComp.stepByStep();
        }
        else {
            this.workflowComp.openWorkflowPanel(mode);
        }
    }
    /**
     * 3. 一键自动连线：将预设的逻辑关系注入连接池
     */
    applyAllPresets() {
        // 1. 定义预设连接关系
        this.conns = [
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

        console.log("气路与测量系统预设连接已完成。", this.conns);
        this.redrawAll();

    }

    // 4. 启动系统，控制开关、截止阀之类组件控制系统运行
    applyStartSystem() {

        this.comps.stopvalve.isOpen = true;
        this.comps.stopvalve.update();
        this.comps.dcpower.isOn = true;
        this.comps.dcpower.update();
        this.comps['3valve'].vH = true;
        this.comps['3valve'].vL = true;
        this.comps['3valve'].vE = false;
        this.comps['3valve']._init();
    }
    // 5. 多点步进系统，用于多次设置参数
    sevenStep() {
        const reg = this.comps['pressreg'];
        const reg2 = this.comps['pressreg2'];
        reg2.setPressure = 0.2;
        reg2.update();
        const difftr = this.comps['difftr'];
        if (!reg || !difftr) return;

        // 1. 定义压力点序列
        const steps = [
            difftr.min + 0.2,  // 0: 触发复位
            difftr.min + 0.2 + (difftr.max - difftr.min) / 2,  // 1: 上升期-中间态
            difftr.max + 0.2,
        ];

        // 2. 关键修复：使用显式的计数器代替数值查找
        // 如果没有初始化过，或者当前压力和步骤记录对不上（手动调了压力），则初始化
        if (this._testStep === undefined || this._testStep >= steps.length) {
            this._testStep = 0;
        }

        const nextIndex = this._testStep;
        const targetP = steps[nextIndex];

        // 3. 执行压力更新
        reg.setPressure = targetP;
        if (typeof reg.update === 'function') {
            reg.update();
        }

        // 4. 更新步进计数器，为下一次调用做准备
        this._testStep = (nextIndex + 1) % steps.length;
    }


    // ==========================================
    // 第二部分：交互管理（手动连线控制）
    // ==========================================


    /**
     * 1. 处理端口点击事件：实现“起点-预览-终点”连线逻辑
     */
    handlePortClick(comp, portId, type) {
        if (!this.linkingState) {
            // 设定起点
            this.linkingState = { comp, portId, type };
            this.tempLine = new Konva.Line({
                stroke: type === 'wire' ? '#eb0d0d' : '#463aed',
                strokeWidth: type === 'wire' ? 2 : 12,
                opacity: 0.6, dash: [10, 5]
            });
            this.layer.add(this.tempLine);
        } else {
            // 设定终点
            if (this.linkingState.type === type) {
                const aPort = this.linkingState.portId;
                const bPort = portId;
                if (aPort === bPort) { this.resetLinking(); return; }

                const newConn = { from: aPort, to: bPort, type };


                // 1. 检查是否已经存在该连接（无论正反向），在统一的 this.conns 中查找
                const exists = this.conns.some(c => this._connEqual(c, newConn));
                if (exists) {
                    this.resetLinking();
                    return;
                }

                // 2. 修正后的管路冲突检查
                if (type === 'pipe') {
                    // 只有当新连接的端点 被“除了对方以外”的其他连接占用时，才算冲突
                    // 在船舶管路仿真中，通常一个接口只能接一根管子
                    const isPortBusy = (pid) => this.conns.filter(c => c.type === 'pipe').some(c => c.from === pid || c.to === pid);

                    if (isPortBusy(aPort)) {
                        alert(`端口 ${aPort} 已有管路连接`);
                        this.resetLinking();
                        return;
                    }
                    if (isPortBusy(bPort)) {
                        alert(`端口 ${bPort} 已有管路连接`);
                        this.resetLinking();
                        return;
                    }
                }

                // 3. 电路通常允许并联（一个端点接多根线），所以不对 wire 做 isPortBusy 检查
                this.addConnWithHistory(newConn);
            } else {
                alert("类型不匹配：管路不能连接到电路！");
            }
            this.resetLinking();
        }
    }
    // 辅助函数：比较两个连接是否等价（无顺序）
    _connEqual(a, b) {
        // 无向比较：类型相同且端点集合相等（正向或反向均视为相同连接）
        if (a.type !== b.type) return false;
        return (a.from === b.from && a.to === b.to) || (a.from === b.to && a.to === b.from);
    }

    // 辅助函数：生成连接的规范键（端点排序后）用于界面元素标记
    _connKeyCanonical(c) {
        // 无向规范键：按字符串顺序对端点排序以保证正反向具有相同键
        const a = c.from;
        const b = c.to;
        return a <= b ? `${a}-${b}` : `${b}-${a}`;
    }

    // 2. 连接虚线销毁函数。
    resetLinking() {
        // 1. 物理销毁 Konva 对象，释放内存并从图层移除
        if (this.tempLine) {
            this.tempLine.destroy();
            this.tempLine = null;
        }
        // 2. 清空状态位
        this.linkingState = null;
        // 3. 刷新画布
        this.layer.batchDraw();
    }

    // 3. 简单的连接历史操作（仅针对用户点击行为）
    addConnWithHistory(conn) {
        const sys = this;
        const action = {
            do() {
                if (!sys.conns.some(c => sys._connEqual(c, conn))) sys.conns.push(conn);
                sys.redrawAll();
            },
            undo() {
                const idx = sys.conns.findIndex(c => sys._connKeyCanonical(c) === sys._connKeyCanonical(conn) && c.type === conn.type);
                if (idx !== -1) sys.conns.splice(idx, 1);
                sys.redrawAll();
            }
        };
        this.history.do(action);
    }
    addConn(conn) {
        if (!this.conns.some(c => sys._connEqual(c, conn))) this.conns.push(conn);
        this.redrawAll();
    }

    // 4. 删除连线调用，前者可以恢复，后者不可恢复。
    removeConnWithHistory(conn) {
        const sys = this;
        const action = {
            do() {
                const idx = sys.conns.findIndex(c => sys._connKeyCanonical(c) === sys._connKeyCanonical(conn) && c.type === conn.type);
                if (idx !== -1) sys.conns.splice(idx, 1);
                sys.redrawAll();
            },
            undo() {
                if (!sys.conns.some(c => sys._connEqual(c, conn))) sys.conns.push(conn);
                sys.redrawAll();
            }
        };
        this.history.do(action);
    }
    removeConn(conn) {
        const idx = this.conns.findIndex(c => this._connKeyCanonical(c) === this._connKeyCanonical(conn) && c.type === conn.type);
        if (idx !== -1) this.conns.splice(idx, 1);
        this.redrawAll();
    }

    //5. 动画方式添加连线：3s 完成一次连线，结束后把连线加入 this.conns 并重绘，用户演示。
    addConnectionAnimated(conn) {
        return new Promise((resolve) => {
            const getPosByPort = (portId) => {
                const did = portId.split('_')[0];
                return this.comps[did]?.getAbsPortPos(portId);
            };

            const fromPos = getPosByPort(conn.from);
            const toPos = getPosByPort(conn.to);

            // --- 安全检查：如果坐标获取不到，直接完成，防止 Promise 永远挂起 ---
            if (!fromPos || !toPos) {
                console.error("Connection failed: Missing port coordinates", conn);
                this.conns.push(conn);
                this.solver.update(this.conns);
                this.redrawAll();
                return resolve();
            }

            const animLine = new Konva.Line({
                points: [fromPos.x, fromPos.y, fromPos.x, fromPos.y],
                stroke: conn.type === 'wire' ? '#e41c1c' : '#78e4c9',
                strokeWidth: conn.type === 'wire' ? 6 : 10,
                lineCap: 'round',
                lineJoin: 'round',
                shadowBlur: conn.type === 'pipe' ? 6 : 0,
                shadowColor: '#333',
                opacity: 0.95,
                listening: false // 提高性能，动画线不参与事件捕获
            });

            this.lineLayer.add(animLine);

            const duration = 3000; // 建议 1.2s，3s 对自动演示来说略久
            const start = performance.now();

            const animate = (now) => {
                const elapsed = now - start;
                const t = Math.min(1, elapsed / duration);

                // 缓动函数 (Ease-out)，让连线在接近终点时有一个减速感，更具质感
                const easeOut = 1 - Math.pow(1 - t, 3);

                const curX = fromPos.x + (toPos.x - fromPos.x) * easeOut;
                const curY = fromPos.y + (toPos.y - fromPos.y) * easeOut;

                animLine.points([fromPos.x, fromPos.y, curX, curY]);
                this.lineLayer.batchDraw();

                if (t < 1) {
                    requestAnimationFrame(animate);
                } else {
                    // --- 动画彻底结束后的清理与状态更新 ---
                    animLine.destroy();

                    // 确保不重复添加
                    const exists = this.conns.some(c => c.from === conn.from && c.to === conn.to);
                    if (!exists) {
                        this.conns.push(conn);
                    }

                    this.redrawAll();

                    // 关键点：在这里 resolve，外部的 await 才会继续
                    resolve();
                }
            };

            requestAnimationFrame(animate);
        });
    }

    // ==========================================
    // 第三部分：渲染引擎（连线绘制）
    // ==========================================

    /**
 * 统一重绘接口：当组件移动或连接池改变时调用
 */
    redrawAll() {
        this._renderGroup(this.conns.filter(c => c.type === 'pipe'), 'pipe');
        this._renderGroup(this.conns.filter(c => c.type === 'wire'), 'wire');
    }
    _renderGroup(conns, type) {
        const nodesRef = type === 'pipe' ? 'pipeNodes' : 'wireNodes';
        this[nodesRef].forEach(n => n.destroy());
        this[nodesRef] = [];

        const getPosByPort = (portId) => {
            const did = portId.split('_')[0];
            return this.comps[did]?.getAbsPortPos(portId);
        };

        conns.forEach(conn => {
            const p1 = getPosByPort(conn.from);
            const p2 = getPosByPort(conn.to);
            if (!p1 || !p2) return;

            let line;
            if (type === 'pipe') {
                // --- 1. 计算管路点集合 ---
                // 如果 conn.midPoint 存在，则管路由三点组成
                let pts = [p1.x, p1.y, p2.x, p2.y];
                if (conn.midPoint) {
                    pts = [p1.x, p1.y, conn.midPoint.x, conn.midPoint.y, p2.x, p2.y];
                }

                // --- 2. 绘制底层管道和流动层 ---
                line = new Konva.Line({
                    points: pts,
                    stroke: '#c4c7c8',
                    strokeWidth: 16,
                    lineCap: 'round',
                    lineJoin: 'round'
                });
                const flow = new Konva.Line({
                    points: pts,
                    stroke: '#130cdf',
                    strokeWidth: 4,
                    dash: [10, 20],
                    name: 'flow',
                    lineJoin: 'round'
                });

                // --- 3. 创建可拖动的中间点 (Handle) ---
                const handlePos = conn.midPoint || { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
                const handle = new Konva.Circle({
                    x: handlePos.x,
                    y: handlePos.y,
                    radius: 6,
                    fill: '#f1c40f',
                    stroke: '#d35400',
                    strokeWidth: 2,
                    draggable: true,
                    visible: false // 默认隐藏，鼠标经过管路时显示
                });

                // 拖拽事件：更新数据并重绘
                handle.on('dragmove', () => {
                    conn.midPoint = { x: handle.x(), y: handle.y() };
                    // 实时更新当前线条预览，提高流畅度
                    const newPts = [p1.x, p1.y, handle.x(), handle.y(), p2.x, p2.y];
                    line.points(newPts);
                    flow.points(newPts);
                });

                handle.on('dragend', () => {
                    this.redrawAll(); // 确保所有关联层刷新
                });

                // 交互效果：鼠标悬停在管路上显示拖动手柄
                const showHandle = () => { handle.visible(true); this.lineLayer.batchDraw(); };
                const hideHandle = () => { if (!handle.isDragging()) handle.visible(false); this.lineLayer.batchDraw(); };

                line.on('mouseenter', showHandle);
                line.on('mouseleave', hideHandle);
                handle.on('mouseenter', showHandle);
                handle.on('mouseleave', hideHandle);

                // 双击删除逻辑
                const key = this._connKeyCanonical(conn);
                flow.setAttr('connKey', key);
                const removeHandler = () => {
                    const existing = this.conns.find(c => this._connKeyCanonical(c) === key && c.type === 'pipe');
                    if (existing) this.removeConnWithHistory(existing);
                };
                line.on('dblclick', removeHandler);

                this.lineLayer.add(line, flow, handle);
                this[nodesRef].push(line, flow, handle);

                line.moveToBottom();
                flow.moveToBottom();
            } else {
                // 绘制电路：三点贝塞尔曲线（start -> control -> end），对同一对组件的多条线做偏移以防重叠
                if (conn.from.includes('multimeter') || conn.to.includes('multimeter')) {
                    // 万用表特殊连线逻辑
                    let strokeColor;
                    // --- 核心修改：万用表表笔线增加中点以触发 tension ---
                    const midX = (p1.x + p2.x) / 2;
                    const midY = Math.max(p1.y, p2.y) + 20; // 模拟重力，让中点下垂 30 像素

                    // 重新构造点序列：[起点, 中点, 终点]
                    const linePoints = [p1.x, p1.y, midX, midY, p2.x, p2.y];
                    // 根据端子功能上色
                    if (conn.from.includes('com') || conn.to.includes('com')) {
                        strokeColor = '#006400'; // 墨绿色
                    } else if (conn.from.includes('wire_v') || conn.to.includes('wire_v') || conn.from.includes('wire_ma') || conn.to.includes('wire_ma')) {
                        strokeColor = '#FF4500'; // 火红色 (OrangeRed)
                    }
                    line = new Konva.Line({
                        points: linePoints,
                        stroke: strokeColor,
                        strokeWidth: 6,
                        lineCap: 'round',
                        lineJoin: 'round',
                        tension: 0.4, // 关键：lineTension设置此值大于0即变为贝塞尔曲线
                    });
                }
                else {
                    const midX = (p1.x + p2.x) / 2;
                    const midY = (p1.y + p2.y) / 2;
                    const dx = p2.x - p1.x;
                    const dy = p2.y - p1.y;
                    // 归一化的垂直向量
                    const len = Math.sqrt(dx * dx + dy * dy) || 1;
                    const ux = -dy / len;
                    const uy = dx / len;

                    // 找到与当前连接相同组件对的所有电线（无顺序）
                    const devA = conn.from.split('_')[0];
                    const devB = conn.to.split('_')[0];
                    const siblings = this.conns.filter(c => c.type === 'wire' && (() => {
                        const ca = c.from.split('_')[0];
                        const cb = c.to.split('_')[0];
                        return (ca === devA && cb === devB) || (ca === devB && cb === devA);
                    })());
                    const idx = siblings.findIndex(c => this._connKeyCanonical(c) === this._connKeyCanonical(conn));
                    const total = siblings.length || 1;
                    const spacing = 18; // 垂直偏移间距
                    const longSpacing = 8; // 沿线微偏移，减少缠绕
                    // 使偏移在多条线时成对分布于两侧
                    const offset = (idx - (total - 1) / 2) * spacing;
                    const longOffset = (idx - (total - 1) / 2) * longSpacing;

                    const controlX = midX + ux * offset + (dx / len) * longOffset;
                    const controlY = midY + uy * offset + (dy / len) * longOffset;

                    // 使用二次控制点复制为两个控制点以兼容 Konva 的贝塞尔格式
                    const pts = [p1.x, p1.y, controlX, controlY, controlX, controlY, p2.x, p2.y];
                    let stroke;
                    if (conn.from.includes('wire_p') || conn.to.includes('wire_p') || conn.from.includes('wire_a')) stroke = '#e60c0c';
                    else stroke = '#544f4f';
                    line = new Konva.Line({
                        points: pts,
                        stroke: stroke, strokeWidth: 4, bezier: true
                    });

                }
                // 标记连接键并绑定双击删除事件
                const key = this._connKeyCanonical(conn);
                line.setAttr('connKey', key);
                line.setAttr('connType', type);
                line.on('dblclick', () => {
                    const existing = this.conns.find(c => this._connKeyCanonical(c) === key && c.type === type);
                    if (existing) {
                        this.removeConnWithHistory(existing);
                        this.solver.update(this.conns);
                    }
                });
                this.lineLayer.add(line);
                this[nodesRef].push(line);
            }
            line.moveToBottom();
        });
        this.lineLayer.batchDraw();
    }

    // ==========================================
    // 第四部分：电路仿真、气路仿真、仪表显示
    // ==========================================

    //1. 提供给下属组件调用的回调函数，组件可根据端口电压决定自己的状态。
    getVoltageBetween(portIdA, portIdB) {
        return this.voltageSolver.getPD(portIdA, portIdB);
    }

    isPortConnected(pA, pB) {
        return this.voltageSolver.isPortConnected(pA, pB);
    }
    getPressAt(port) {

    }

    // ==========================================
    // 第五部分：回调函数，主循环
    // ==========================================
    // 1. 下属组件状态发生变化时调用的函数
    onComponentStateChange(dev) {

    }
    /**
     * 2. 仿真更新循环：
     */
    updateSimulation(frame) {

        //console.log("帧时间：", frame.timeDiff, frame.frameRate);
        this.pressSolver.solve();
        this.voltageSolver.update();
    }





}

// 最小历史管理器：仅对用户交互的连线添加撤销/重做支持
class HistoryManager {
    constructor() {
        this.undos = [];
        this.redos = [];
        this.max = 80;
        this.onChange = () => { };
    }

    do(action) {
        try {
            action.do();
            this.undos.push(action);
            if (this.undos.length > this.max) this.undos.shift();
            this.redos = [];
            this.onChange();
        } catch (e) { console.error('History do error', e); }
    }

    undo() {
        const a = this.undos.pop();
        if (!a) return;
        try { a.undo(); this.redos.push(a); this.onChange(); } catch (e) { console.error('History undo error', e); }
    }

    redo() {
        const a = this.redos.pop();
        if (!a) return;
        try { a.do(); this.undos.push(a); this.onChange(); } catch (e) { console.error('History redo error', e); }
    }
}
