import { Workflow } from './tools/Workflow.js';
import { CircuitSolver } from './tools/CircuitSolver.js';
import { PneumaticSolver } from './tools/PneumaticSolver.js';




import { DCPower } from './components/DCPower.js';
import { AmpMeter } from './components/AmpMeter.js';
import { TempTransmitter } from './components/TempTransmitter.js';
import { VariResistor } from './components/VariResistor.js';
import { PIDController } from './components/PID.js';

import { PneumaticValve } from './components/Actuator.js';
import { AirBottle } from './components/AirBottle.js';




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
            { Class: DCPower, id: 'dcpower', x: 1050, y: 165 },
            { Class: AmpMeter, id: 'ampmeter', x: 450, y: 100 },
            { Class: AmpMeter, id: 'ampmeter2', x: 550, y: 400 },
            { Class: PIDController, id: 'pid', x: 650, y: 150 },
            { Class: AirBottle, id: 'cab', x: 750, y: 650 },
            { Class: PneumaticValve, id: 'valve2', x: 1050, y: 300 },
            { Class: TempTransmitter, id: 'temptr', x: 200, y: 165 },
            { Class: VariResistor, id: 'varires', x: 200, y: 400 },
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
            { id: 0, name: "1. 气动薄膜调节阀的接线" },
            { id: 1, name: "2. 气动薄膜调节阀故障排除" },
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
            // --- 1. PID 调节器工作电源回路 ---
            // 24V 直流电源正极 (P) -> PID 供电输入正极 (VCC)
            { from: 'dcpower_wire_p', to: 'pid_wire_vcc', type: 'wire' },
            // 24V 直流电源负极 (N) -> PID 供电输入负极 (GND)
            { from: 'dcpower_wire_n', to: 'pid_wire_gnd', type: 'wire' },

            // --- 2. 传感器信号输入 (Pt100 三线制模拟) ---
            // 可变电阻左端 -> 温度变送器热电阻输入 A 端
            { from: 'varires_wire_l', to: 'temptr_wire_l', type: 'wire' },
            // 可变电阻右端 -> 同时接入变送器 B 端与 C 端 (实现三线制引线电阻补偿模拟)
            { from: 'varires_wire_r', to: 'temptr_wire_m', type: 'wire' },
            { from: 'varires_wire_r', to: 'temptr_wire_r', type: 'wire' },

            // --- 3. 测量反馈电流环路 (二线制变送器接法) ---
            // PID 内部配电输出正极 (PI1) -> 电流表1正极 (用于监测测量值 PV)
            { from: 'pid_wire_pi1', to: 'ampmeter_wire_p', type: 'wire' },
            // 电流表1负极 -> 温度变送器信号正极 (串联进入环路)
            { from: 'ampmeter_wire_n', to: 'temptr_wire_p', type: 'wire' },
            // 温度变送器信号负极 -> PID 测量信号输入负极 (NI1)，完成测量电流闭环
            { from: 'temptr_wire_n', to: 'pid_wire_ni1', type: 'wire' },

            // --- 4. 控制输出驱动环路 (PID 输出驱动执行器) ---
            // PID 控制信号输出正极 (PO1) -> 电流表2正极 (用于监测输出值 MV)
            { from: 'pid_wire_po1', to: 'ampmeter2_wire_p', type: 'wire' },
            // 电流表2负极 -> 电动阀门控制信号输入正极
            { from: 'ampmeter2_wire_n', to: 'valve2_wire_l', type: 'wire' },
            // 电动阀门信号负极 -> 返回 PID 控制信号输出负极 (NO1)，完成控制电流闭环
            { from: 'valve2_wire_r', to: 'pid_wire_no1', type: 'wire' },

            // --- 5. 电气阀门定位器气路---
            // 气源气压 -> 电气阀门定位器气源口
            { from: 'cab_pipe_o', to: 'valve2_pipe_s', type: 'pipe' },
            // 电气阀门定位器气压输出口 -> 气动薄膜调节器阀气压入口
            { from: 'valve2_pipe_o', to: 'valve2_pipe_i', type: 'pipe' },
        ];
        this.stepsArray[0] = [
            // --- 第一部分：基础电路建立 (1-4步) ---
            {
                msg: "步骤 1：建立控制系统供电回路 (24V -> PID)。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    await this.addConnectionAnimated(conns[0]); // P -> VCC
                    await this.addConnectionAnimated(conns[1]); // N -> GND
                },
                check: () => sys.conns.some(c => sys._connEqual(c, conns[0])) &&
                    sys.conns.some(c => sys._connEqual(c, conns[1]))
            },
            {
                msg: "步骤 2：接通24V电源，便于观察输入、输出接线过程中的变化。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    this.comps.dcpower.isOn = true;
                    this.comps.dcpower.update();
                    await new Promise(r => setTimeout(r, 3000));
                },
                check: () => this.comps.dcpower.isOn === true
            },
            {
                msg: "步骤 3：连接 Pt100 传感器模拟输入 (三线制连接)。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    await this.addConnectionAnimated(conns[2]); // L -> L
                    await this.addConnectionAnimated(conns[3]); // R -> M
                    await this.addConnectionAnimated(conns[4]); // R -> R
                },
                check: () => [2, 3, 4].every(i => sys.conns.some(c => sys._connEqual(c, conns[i])))
            },
            {
                msg: "步骤 4：连接测量反馈回路 (PID配电 -> 电流表1 -> 变送器 -> PID输入)。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    await this.addConnectionAnimated(conns[5]); // PI1 -> Amp1
                    await this.addConnectionAnimated(conns[6]); // Amp1 -> TempTr+
                    await this.addConnectionAnimated(conns[7]); // TempTr- -> NI1
                },
                check: () => [5, 6, 7].every(i => sys.conns.some(c => sys._connEqual(c, conns[i])))
            },
            {
                msg: "步骤 5：连接控制输出回路 (PID输出 -> 电流表2 -> 电动阀门 -> 回路闭合)。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    await this.addConnectionAnimated(conns[8]);  // PO1 -> Amp2
                    await this.addConnectionAnimated(conns[9]);  // Amp2 -> Valve+
                    await this.addConnectionAnimated(conns[10]); // Valve- -> NO1
                },
                check: () => [8, 9, 10].every(i => sys.conns.some(c => sys._connEqual(c, conns[i])))
            },
            {
                msg: "步骤 6：连接电气阀门定位器气源， 连接定位器输出 ->气动薄膜调节阀输入口。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    await this.addConnectionAnimated(conns[11]);  // 
                    await this.addConnectionAnimated(conns[12]); //
                },
                check: () => [11, 12].every(i => sys.conns.some(c => sys._connEqual(c, conns[i])))
            },
            // --- 第二部分：理论考核 (第7步) ---
            {
                msg: "步骤 7：电气阀门定位器信号转换：输入信号和输出信号分别是什么？",
                mode: "quiz",
                quizConfig: {
                    question: "在标准工业控制中，电气阀门定位器的主要作用是将（ ）信号转换为（ ）信号？",
                    options: [
                        "0-10V 电压信号 转换为 4-20mA 电流信号",
                        "4-20mA 电流信号 转换为 0.02-0.1MPa 气压信号",
                        "0.02-0.1MPa 气压信号 转换为 4-20mA 电流信号",
                        "RS485 数字信号 转换为 0-100% 阀位反馈信号"
                    ],
                    answer: 1,
                    analysis: "电气阀门定位器（E/P转换）的核心任务是接收控制系统的电流信号（4-20mA），并将其成比例地转换为气动执行器所需的压力信号（通常为0.02-0.1MPa）。"
                },
                check: () => true
            },

            // --- 第三部分：动态操作演示 (8步) ---
            {
                msg: "步骤 8：考核调节阀选型：气开式与气关式的区别及安全性。",
                mode: "quiz",
                quizConfig: {
                    question: "关于“气关式”调节阀（Air-to-Close），以下描述正确的是：",
                    options: [
                        "随着输入气压增加，阀门开度逐渐变大",
                        "当仪表风气源突然中断时，阀门会自动处于全闭状态",
                        "当仪表风气源突然中断时，阀门会自动处于全开状态（故障开）",
                        "气关阀主要用于防止下游压力过低，而不是出于断气安全考虑"
                    ],
                    answer: 2,
                    analysis: "气关阀（FO，Fail Open）指有气时关闭，无气时开启。在化工生产中，如果气源中断，为了防止加热炉憋压或反应堆过热，通常选择气关阀以确保阀门全开，保证安全排放。"
                },
                check: () => true
            },
            {
                msg: "步骤 9：演示输出变量变化：将 PID 切换至手动，设置输出为 60%，观察输出电流和阀门开度变化。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    const pid = this.comps['pid'];
                    if (pid) {
                        pid.mode = 'MAN'; // 切换手动
                        pid.OUT = 60; // 设置输出 60%
                        this.showFloatingTip("PID 切换至手动模式，输出已设为 60%", 3000);
                        await new Promise(r => setTimeout(r, 3000));
                    }
                },
                // 检查 PID 输出是否为 60
                check: () => Math.abs(this.comps['pid'].OUT - 60) < 1
            }
        ];
        this.stepsArray[1] = [
            // --- 1. 初始化检查 ---
            {
                msg: "步骤 1：系统初始化。检查所有电路连接完整，并确保 24V 直流电源已合上。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    // 自动补全接线
                    for (const conn of conns) {
                        if (!this.conns.some(c => this._connEqual(c, conn))) {
                            await this.addConnectionAnimated(conn);
                        }
                    }
                    this.comps.dcpower.isOn = true;
                    this.comps.dcpower.update();
                    await new Promise(r => setTimeout(r, 2000));
                },
                check: () => this.comps.dcpower.isOn && conns.every(conn => this.conns.some(c => sys._connEqual(c, conn)))
            },

            // --- 2. 设置漏气故障 ---
            {
                msg: "步骤 2：模拟气动回路故障。设置定位器至膜头管路“漏气”。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    const valve = this.comps['valve2']; // 使用指定的 id
                    if (valve) {
                        valve.isLeaking = true;
                        this.showFloatingTip("警告：检测到气路密封失效（漏气）", 3000);
                        await new Promise(r => setTimeout(r, 3000));
                    }
                },
                check: () => this.comps['valve2'].isLeaking === true
            },

            // --- 3. 观察漏气下的工作状态 ---
            {
                msg: "步骤 3：调节 PID 输出至 80%，观察阀门行程是否能达到预定开度。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    const pid = this.comps['pid']; // 使用指定的 id
                    if (pid) {
                        pid.OUT =80;
                        this.showFloatingTip("PID 输出已设为 80%", 3000);
                        await new Promise(r => setTimeout(r, 3000));
                    }
                },
                // 漏气时，valve2.travel 受到 0.5~0.8 随机系数影响，永远达不到 0.8
                check: () => Math.abs(this.comps['pid'].OUT - 80) < 1
            },

            // --- 4. 修复漏气故障 ---
            {
                msg: "步骤 4：修复漏气故障。恢复气路密封，观察阀门行程变化。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    const valve = this.comps['valve2'];
                    if (valve) {
                        valve.isLeaking = false;
                        this.showFloatingTip("气路修复完毕，压力恢复正常", 3000);
                        await new Promise(r => setTimeout(r, 3000));
                    }
                },
                check: () => this.comps['valve2'].isLeaking === false
            },

            // --- 5. 设置卡死故障 ---
            {
                msg: "步骤 5：模拟机械故障。设置阀门机械“卡死”。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    const valve = this.comps['valve2'];
                    if (valve) {
                        valve.isStuck = true;
                        this.showFloatingTip("警告：阀芯发生机械卡死", 3000);
                        await new Promise(r => setTimeout(r, 3000));
                    }
                },
                check: () => this.comps['valve2'].isStuck === true
            },

            // --- 6. 改变输出观察卡死 ---
            {
                msg: "步骤 6：连续改变 PID 输出（50% -> 30%）。观察：压力表动，但阀杆不动。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    const pid = this.comps['pid'];
                    if (pid) {
                        pid.OUT = 50;
                        this.showFloatingTip("调节至 50%", 3000);
                        await new Promise(r => setTimeout(r, 3000));
                        pid.OUT =30;
                        this.showFloatingTip("调节至 30%", 3000);
                        await new Promise(r => setTimeout(r, 3000));
                    }
                },
                check: () => Math.abs(this.comps['pid'].OUT - 30) < 1
            },

            // --- 7. 修复卡死故障 ---
            {
                msg: "步骤 7：修复卡死故障。排除机械阻力，观察阀门是否恢复受控状态。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    const valve = this.comps['valve2'];
                    if (valve) {
                        valve.isStuck = false;
                        this.showFloatingTip("机械故障排除，阀门恢复动作", 3000);
                        await new Promise(r => setTimeout(r, 3000));
                    }
                },
                check: () => this.comps['valve2'].isStuck === false
            }
        ];
    }

    // 5. 初始化故障触发、修复、检测
    initFault() {

        // 1. 配置化故障定义：code -> { 检测逻辑, 修复逻辑 }
        this.FAULT_CONFIG = {
            1: {
                id: 1,
                name: "1. 气动薄膜调节阀漏气故障",
                trigger: () => { if (this.comps['valve2']) this.comps['valve2'].isLeaking = true; },
                check: () => this.comps['valve2'].isLeaking === true,
                repair: () => { if (this.comps['valve2']) this.comps['valve2'].isLeaking = false; }
            },
            2: {
                id: 2,
                name: "2. 气动薄膜调节阀卡死故障",
                trigger: () => { if (this.comps['valve2']) this.comps['valve2'].isStuck = true; },
                check: () => this.comps['valve2'].isStuck === true,
                repair: () => { if (this.comps['valve2']) this.comps['valve2'].isStuck = false; }
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
            // --- 1. PID 调节器工作电源回路 ---
            // 24V 直流电源正极 (P) -> PID 供电输入正极 (VCC)
            { from: 'dcpower_wire_p', to: 'pid_wire_vcc', type: 'wire' },
            // 24V 直流电源负极 (N) -> PID 供电输入负极 (GND)
            { from: 'dcpower_wire_n', to: 'pid_wire_gnd', type: 'wire' },

            // --- 2. 传感器信号输入 (Pt100 三线制模拟) ---
            // 可变电阻左端 -> 温度变送器热电阻输入 A 端
            { from: 'varires_wire_l', to: 'temptr_wire_l', type: 'wire' },
            // 可变电阻右端 -> 同时接入变送器 B 端与 C 端 (实现三线制引线电阻补偿模拟)
            { from: 'varires_wire_r', to: 'temptr_wire_m', type: 'wire' },
            { from: 'varires_wire_r', to: 'temptr_wire_r', type: 'wire' },

            // --- 3. 测量反馈电流环路 (二线制变送器接法) ---
            // PID 内部配电输出正极 (PI1) -> 电流表1正极 (用于监测测量值 PV)
            { from: 'pid_wire_pi1', to: 'ampmeter_wire_p', type: 'wire' },
            // 电流表1负极 -> 温度变送器信号正极 (串联进入环路)
            { from: 'ampmeter_wire_n', to: 'temptr_wire_p', type: 'wire' },
            // 温度变送器信号负极 -> PID 测量信号输入负极 (NI1)，完成测量电流闭环
            { from: 'temptr_wire_n', to: 'pid_wire_ni1', type: 'wire' },

            // --- 4. 控制输出驱动环路 (PID 输出驱动电气阀门定位器) ---
            // PID 控制信号输出正极 (PO1) -> 电流表2正极 (用于监测输出值 MV)
            { from: 'pid_wire_po1', to: 'ampmeter2_wire_p', type: 'wire' },
            // 电流表2负极 -> 电动阀门定位器控制信号输入正极
            { from: 'ampmeter2_wire_n', to: 'valve2_wire_l', type: 'wire' },
            // 电动阀门定位器信号负极 -> 返回 PID 控制信号输出负极 (NO1)，完成控制电流闭环
            { from: 'valve2_wire_r', to: 'pid_wire_no1', type: 'wire' },

            // --- 5. 电气阀门定位器气路---
            // 气源气压 -> 电气阀门定位器气源口
            { from: 'cab_pipe_o', to: 'valve2_pipe_s', type: 'pipe' },
            // 电气阀门定位器气压输出口 -> 气动薄膜调节器阀气压入口
            { from: 'valve2_pipe_o', to: 'valve2_pipe_i', type: 'pipe' },
        ];

        console.log("气路与测量系统预设连接已完成。", this.conns);
        this.redrawAll();

    }

    // 4. 启动系统，控制开关、截止阀之类组件控制系统运行
    applyStartSystem() {
        this.comps.dcpower.isOn = true;
        this.comps.dcpower.update();
    }
    // 5. 多点步进系统，用于多次设置参数
    /**
     * 5点步进系统：根据 PID 模式切换步进目标
     * 手动模式：步进 PID 输出 (0, 25, 50, 75, 100)
     * 自动模式：步进 Pt100 电阻 (100, 109.73, 119.4, 128.98, 138.51) -> 对应 0, 25, 50, 75, 100°C
     */
    fiveStep() {
        const pid = this.comps['pid'];
        const varires = this.comps['varires'];

        if (!pid || !varires) return;

        // 1. 获取当前 PID 模式 (假设 pid.mode 为 'MAN' 或 'AUTO')
        const isManual = pid.mode === 'MAN';

        // 2. 定义不同模式下的步进序列
        const steps = isManual
            ? [0, 25, 50, 75, 100]                   // 手动模式：PID 输出百分比 (%)
            : [115.40, 119.25, 123.11, 126.96, 130.81]; // 自动模式：Pt100 电阻值 (Ω)

        // 3. 维护步进索引
        if (this._testStep === undefined || this._testStep >= steps.length) {
            this._testStep = 0;
        }

        const nextIndex = this._testStep;
        const targetValue = steps[nextIndex];

        // 4. 执行更新逻辑
        if (isManual) {
            // --- 手动模式逻辑 ---
            // 设置 PID 的手动输出值
            pid.OUT = targetValue;
        } else {
            // --- 自动模式逻辑 ---
            // 设置可变电阻值 (模拟 Pt100)
            varires.currentResistance = targetValue;
            if (typeof varires.update === 'function') {
                varires.update();
            }
        }

        // 5. 更新计数器
        this._testStep = (nextIndex + 1) % steps.length;
    }


    // ==========================================
    // 第二部分：交互管理（手动连线控制）
    // ==========================================
    /**
     * 显示一个临时的浮动提示（用于演示模式自动答题）
     */
    showFloatingTip(text, duration = 2500) {
        const tip = document.createElement('div');
        Object.assign(tip.style, {
            position: 'fixed',
            top: '10%',
            left: '50%',
            transform: 'translateX(-50%)',
            padding: '12px 24px',
            background: 'rgba(45, 134, 45, 0.9)', // 墨绿色，代表正确/演示
            color: '#fff',
            borderRadius: '20px',
            fontSize: '16px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            zIndex: '10001',
            pointerEvents: 'none', // 不阻碍点击，防误触
            transition: 'opacity 0.5s ease'
        });
        tip.innerHTML = `💡 ${text}`;
        this.container.appendChild(tip);

        // 动画消失逻辑
        setTimeout(() => {
            tip.style.opacity = '0';
            setTimeout(() => this.container.removeChild(tip), 500);
        }, duration);
    }
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
