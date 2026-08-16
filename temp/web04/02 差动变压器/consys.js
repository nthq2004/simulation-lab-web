import { Workflow } from './tools/Workflow.js';
import { CircuitSolver } from './tools/CircuitSolver.js';
import { PneumaticSolver } from './tools/PneumaticSolver.js';
import { Show } from './tools/Show.js';

import { DCPower } from './components/DCPower.js';
// import { AmpMeter } from './components/AmpMeter.js';
import { VariResistor } from './components/VariResistor.js';
import { Resistor } from './components/Resistor.js';
import { Multimeter } from './components/Multimeter.js';
import { OpAmp } from './components/OpAmp.js';
import { Ground } from './components/Gnd.js';
import { PIDController } from './components/PID.js';

import { AirBottle } from './components/AirBottle.js';
import { PressRegulator } from './components/PressRegulator.js';
import { LVDTPressureSensor } from './components/LVDT.js';
// import { ACPower } from './components/ACPower.js';
import { Oscilloscope_tri } from './components/Osc_tri.js';
// import { Oscilloscope } from './components/Oscilloscope.js';
import { SignalGenerator } from './components/SignalGenerator.js';
import { Capacitor } from './components/Capacitor.js';
import { JFET } from './components/JFET.js';
import { Diode } from './components/Diode.js';
import {VoltageTransmitter} from './components/VoltageTransmitter.js'
// import { Transistor } from './components/Transistor.js'
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
        this.voltageSolver = null;  //电路求解器实例组件
        this.pressSolver = null;   //气路求解器组件

        // --- 性能优化：重绘控制标记 ---
        this._needsRedraw = true; // 初始状态需要绘制一次
        this._physicsIterCount = 0; // 物理计算迭代计数器

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
        // 计算缩放因子以适应不同屏幕大小
        const baseWidth = 1920;
        const baseHeight = 1080;
        const scaleX = window.innerWidth / baseWidth;
        const scaleY = window.innerHeight / baseHeight;
        const scale = Math.min(scaleX, scaleY);
        const offsetX = (window.innerWidth - baseWidth * scale) / 2;
        const offsetY = (window.innerHeight - baseHeight * scale) / 2;

        // 1. 实例化组件，传入 this 以便组件能够调用 handlePortClick 和 redrawAll
        const componentConfigs = [
            // { Class: ACPower, id: 'acpower', x: 50, y: 100 },
            { Class: SignalGenerator, id: 'sg', x: 150, y: 200 },
            { Class: Ground, id: 'gnd1', x: 350, y: 400 },
            { Class: LVDTPressureSensor, id: 'pt', x: 150, y: 500 },
            { Class: Ground, id: 'gnd2', x: 220, y: 600 },
            { Class: AirBottle, id: 'cab', x: -20, y: 850 },
            { Class: PressRegulator, id: 'preg', x: -60, y: 650, reverse: true },

            { Class: Capacitor, id: 'c1',capacitance:47, x: 300, y: 800},
            { Class: Resistor, id: 'r10k1', x: 400, y: 850, value: 10000, direction: 'vertical' },
            { Class: Ground, id: 'gnd3', x: 400, y: 950 },
            { Class: OpAmp, id: 'amp1', x: 530, y: 850 },
            { Class: Diode, id: 'd1', x: 700, y: 800, direction: 'reverse' },
            { Class: Resistor, id: 'r10k2', x: 800, y: 850, value: 10000, direction: 'vertical' },
            { Class: JFET, id: 'jfet', x: 900, y: 800 },
            { Class: Ground, id: 'gnd4', x: 850, y: 950 },

            { Class: Resistor, id: 'r10k3', x: 600, y: 500, value: 10000 },
            { Class: Resistor, id: 'r10k4', x: 600, y: 550, value: 10000 },
            { Class: OpAmp, id: 'amp2', x: 780, y: 600 },
            { Class: Resistor, id: 'r220', x: 900, y: 600, value: 220 },
            { Class: VariResistor, id: 'varires', value: 20000, x: 750, y: 480 },
            { Class: Ground, id: 'gnd5', x: 950, y: 450 },

            { Class: Resistor, id: 'r10k5', x: 1020, y: 550, value: 10000 },
            { Class: Resistor, id: 'r10k6', x: 1160, y: 550, value: 10000 },
            { Class: Capacitor, id: 'c2', x: 1100, y: 650,capacitance:1,direction:'vertical' },
            { Class: Capacitor, id: 'c3', x: 1200, y: 650,capacitance:1,direction:'vertical' },
            { Class: OpAmp, id: 'amp3', x: 1300, y: 600 },
            { Class: Ground, id: 'gnd6', x: 1150, y: 750 },


            { Class: DCPower, id: 'dcpower2', x: 1750, y: 130 },
            { Class: PIDController, id: 'pid', x: 1280, y: 20 },
            {Class:VoltageTransmitter,id:'vtr',x:1450,y:500},

            { Class: Oscilloscope_tri, id: 'osc', x: 750, y: 160 },
            // { Class: AmpMeter, id: 'ampmeter', x: 1600, y: 400 },
            { Class: Multimeter, id: 'multimeter', x: 1720, y: 530 },
        ];

        // 应用缩放和偏移到组件配置
        const scaledConfigs = componentConfigs.map(cfg => ({
            ...cfg,
            x: cfg.x * scale + offsetX,
            y: cfg.y * scale + offsetY,
            scale: scale
        }));

        scaledConfigs.forEach(cfg => {
            this.comps[cfg.id] = new cfg.Class(cfg, this);
            this.layer.add(this.comps[cfg.id].group);
        });
        // --- 性能优化：静态组件启用 Canvas 缓存 ---
        this._applyStaticCaching();
        this.layer.draw();

        // 2. 实例化流程工具、电路求解工具
        this.workflowComp = new Workflow(this);
        this.voltageSolver = new CircuitSolver(this);
        this.pressSolver = new PneumaticSolver(this);
        this.showComp = new Show(this);

        // --- 核心优化：解耦仿真主循环 ---
        // 1. 启动独立的物理计算循环 (使用 setInterval 保证计算频率)
        this._physicsTimer = setInterval(() => this._updatePhysics(), 1000 / 60); // 60fps 的计算频率

        // 2. 启动独立的渲染循环 (使用 RequestAnimationFrame 跟随浏览器 UI 刷新)
        this._renderLoop();
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
            this.requestRedraw();
        });
        this.stage.on('contextmenu', (e) => {
            e.evt.preventDefault(); // 阻止默认菜单
            e.evt.stopPropagation(); // ← 防止触发 window 的监听器
            // 逻辑：如果点击的是空白处（不是组件），显示系统菜单
            // 如果你已经为组件写了右键逻辑，这里需要判断 target 
            if (e.target === this.stage || e.target.name() === 'background-rect') {
                this.showSystemContextMenu(e.evt);
            }
        });
        // 右键或 ESC 取消当前连线操作
        window.addEventListener('contextmenu', (e) => { e.preventDefault(); this.resetLinking(); });
        window.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.resetLinking(); });
    }

    // 4. 流程初始化函数
    initSteps() {
        // 1. 定义项目配置表 (包含名称和 ID)
        const projectConfigs = [
            { id: 0, name: "1. 压力变送器功能的验证" },
            // { id: 1, name: "2. 电桥的测试" },
            // { id: 2, name: "3. 仪表放大器前端放大器的测试" },
            // { id: 3, name: "4. 偏置电路的测试" },
            // { id: 4, name: "5. 仪表放大器差动放大电路的测试" },
            // { id: 5, name: "6. V/I转换电路（4-20mA）的测试" }
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
            // --- 1. 桥式电路部分 (电桥测量) ---
            // 电源正极驱动电桥顶端 (R1, R2 上端)
            { from: 'dcpower_wire_p', to: 'pt_wire_r1l', type: 'wire' },
            { from: 'dcpower_wire_p', to: 'r3_wire_l', type: 'wire' },
            // 电桥下端 (PT100, VariRes 下端) 接地形成回路
            { from: 'pt_wire_r2r', to: 'gnd0_wire_gnd', type: 'wire' },
            { from: 'r4_wire_r', to: 'gnd0_wire_gnd', type: 'wire' },
            // 桥臂连接：左臂 R1-PT100，右臂 R2-VariRes
            { from: 'pt_wire_r1r', to: 'pt_wire_r2l', type: 'wire' },
            { from: 'r3_wire_r', to: 'r4_wire_l', type: 'wire' },


            // --- 2. 仪表放大器部分 (三运放结构：amp1, amp2 为输入级，amp3 为差分级) ---
            // 输入级：将电桥左右中点信号接入 amp1 和 amp2 的同相输入端
            { from: 'r3_wire_r', to: 'amp1_wire_p', type: 'wire' }, // 右桥压 -> amp1
            { from: 'pt_wire_r2l', to: 'amp2_wire_p', type: 'wire' }, // 左桥压 -> amp2
            // 增益电阻 Rg=10k (r5k为固定的5k，r10kv是可调的10k，取中间值5k) 跨接在两个运放的反相输入端之间
            { from: 'amp1_wire_n', to: 'r10kv_wire_l', type: 'wire' },
            { from: 'r10kv_wire_r', to: 'r5k_wire_l', type: 'wire' },
            { from: 'r5k_wire_r', to: 'amp2_wire_n', type: 'wire' },
            // 增益电阻可一分为二：10k电位器分成两个5k，分别接在 amp1 和 amp2 的反相输入端，形成差分放大器的增益调节，放大倍数为 1 + 101.5k/5k = 21.3 倍
            // 反馈电阻：amp1 和 amp2 的输出通过 r106k1, r106k2 回馈，此为amp1的反馈
            { from: 'amp1_wire_OUT', to: 'r106k1_wire_r', type: 'wire' },
            { from: 'r106k1_wire_l', to: 'amp1_wire_n', type: 'wire' },
            // 反馈电阻：amp1 和 amp2 的输出通过 r106k1, r106k2 回馈，此为amp2的反馈
            { from: 'amp2_wire_OUT', to: 'r106k2_wire_r', type: 'wire' },
            { from: 'r106k2_wire_l', to: 'amp2_wire_n', type: 'wire' },

            // 差分输出级 (amp3)：接收前级输出
            { from: 'amp1_wire_OUT', to: 'r5k1_wire_l', type: 'wire' },
            { from: 'r5k1_wire_r', to: 'amp3_wire_n', type: 'wire' },
            { from: 'amp2_wire_OUT', to: 'r5k2_wire_l', type: 'wire' },
            { from: 'r5k2_wire_r', to: 'amp3_wire_p', type: 'wire' },
            // amp3 反馈，输入电阻5k，反馈电阻50k，增益10倍，差分最大电压18.8mV，两级放大213倍，输出最大4V
            { from: 'amp3_wire_OUT', to: 'r50k1_wire_r', type: 'wire' },
            { from: 'r50k1_wire_l', to: 'amp3_wire_n', type: 'wire' },

            // --- 3. 偏置与加法电路 (amp4) ---
            // 电源接到两个电阻的分压电路，上电阻4k，下电阻1k，分压后得到1V的偏置电压。
            { from: 'dcpower_wire_p', to: 'r4k_wire_l', type: 'wire' },
            { from: 'r4k_wire_r', to: 'r1k_wire_l', type: 'wire' },
            { from: 'r1k_wire_r', to: 'gnd_wire_gnd', type: 'wire' },
            // 1V电压输入到amp4的同相端，利用射级跟随器结构提供低阻抗的1V偏置电压，同时将amp3的输出通过电阻送入amp4的反相端进行加法运算，实现零点偏移。
            { from: 'r1k_wire_l', to: 'amp4_wire_p', type: 'wire' },
            { from: 'amp4_wire_OUT', to: 'r50k2_wire_r', type: 'wire' },
            { from: 'r50k2_wire_r', to: 'amp4_wire_n', type: 'wire' },
            // 1V偏置电压由 amp4 提供，连接到 amp3 的同相输入端
            { from: 'r50k2_wire_l', to: 'amp3_wire_p', type: 'wire' },

            // --- 4. 电流源驱动部分 (amp5 + Transistor) ---
            // 同相端输入控制电压。1V对应4mA，5V对应20mA。
            { from: 'amp3_wire_OUT', to: 'r100k2_wire_l', type: 'wire' },
            { from: 'r100k2_wire_r', to: 'amp5_wire_p', type: 'wire' },
            // 放大器输出通过三极管进行电流放大。集电极由24V供电，发射极驱动定值250欧姆电阻产生电流。
            // { from: 'dcpower2_wire_p', to: 'transistor_wire_c', type: 'wire' },
            { from: 'amp5_wire_OUT', to: 'transistor_wire_b', type: 'wire' },
            { from: 'transistor_wire_e', to: 'r250_wire_l', type: 'wire' },
            //从三极管发射极进行负反馈，正反馈在定值电阻左端，因此能形成深度负反馈，放大器工作在线性状态。
            { from: 'r250_wire_l', to: 'r100k3_wire_r', type: 'wire' },
            { from: 'r100k3_wire_l', to: 'r100k1_wire_r', type: 'wire' },
            { from: 'r100k1_wire_l', to: 'gnd3_wire_gnd', type: 'wire' },
            { from: 'r100k1_wire_r', to: 'amp5_wire_n', type: 'wire' },
            // 从定值电阻右端进行正反馈，形成电流采样回路，确保输出电流与控制电压成线性关系。
            { from: 'r250_wire_r', to: 'r100k4_wire_r', type: 'wire' },
            { from: 'r100k4_wire_l', to: 'amp5_wire_p', type: 'wire' },

            // (1)使用500欧姆负载rload,电流表与负载电阻串联，监测输出电流大小，同时负载电阻形成电流回路的闭合。
            { from: 'r250_wire_r', to: 'ampmeter_wire_p', type: 'wire' },
            // { from: 'ampmeter_wire_n', to: 'rload_wire_l', type: 'wire' },
            // { from: 'rload_wire_r', to: 'gnd2_wire_gnd', type: 'wire' },
            // (2)PID输入回路，三极管由pid_wire_pi1供电，4-20mA电流通过电流表监测后进入pid_wire_ni1，形成闭环控制。
            { from: 'dcpower2_wire_p', to: 'pid_wire_vcc', type: 'wire' },
            { from: 'dcpower2_wire_n', to: 'pid_wire_gnd', type: 'wire' },
            { from: 'pid_wire_pi1', to: 'transistor_wire_c', type: 'wire' },
            { from: 'ampmeter_wire_n', to: 'pid_wire_ni1', type: 'wire' },

            // --- 5. 各级测量监测 (万用表) ---
            // 万用表1监测电桥输出差压
            // { from: 'multimeter_wire_v', to: 'r1_wire_r', type: 'wire' },
            // { from: 'multimeter_wire_com', to: 'r2_wire_r', type: 'wire' },
            //万用表1监测一级放大输出，验证前置放大器的放大倍数是否正确。
            // { from: 'multimeter_wire_v', to: 'amp2_wire_OUT', type: 'wire' },
            // { from: 'multimeter_wire_com', to: 'amp1_wire_OUT', type: 'wire' },
            // 万用表1监测仪表放大器的输出
            { from: 'multimeter_wire_v', to: 'amp3_wire_OUT', type: 'wire' },
            { from: 'multimeter_wire_com', to: 'gnd_wire_gnd', type: 'wire' },
            // 万用表1监测PT100输出电压
            { from: 'multimeter2_wire_v', to: 'pt_wire_l', type: 'wire' },
            { from: 'multimeter2_wire_com', to: 'gnd_wire_gnd', type: 'wire' },

        ];
        this.stepsArray[0] = [
            // 1. 电桥供电基础回路
            {
                msg: "步骤 1：建立电桥供电与接地回路（压力传感器的R1和R2, 对称电阻R3和R4）。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 500));
                    const path = [
                        // 电源正极驱动电桥顶端 (R1, R2 上端)
                        { from: 'dcpower_wire_p', to: 'pt_wire_r1l', type: 'wire' },
                        { from: 'dcpower_wire_p', to: 'r3_wire_l', type: 'wire' },
                        // 电桥下端 (PT100, VariRes 下端) 接地形成回路
                        { from: 'pt_wire_r2r', to: 'gnd0_wire_gnd', type: 'wire' },
                        { from: 'r4_wire_r', to: 'gnd0_wire_gnd', type: 'wire' },
                        // 桥臂连接：左臂 R1-PT100，右臂 R2-VariRes
                        { from: 'pt_wire_r1r', to: 'pt_wire_r2l', type: 'wire' },
                        { from: 'r3_wire_r', to: 'r4_wire_l', type: 'wire' },
                    ];
                    for (let c of path) await this.addConnectionAnimated(c);
                    this.showComp.showTooltip('pt', '1. 压力传感器电桥连接', { color: '#2ecc71' });
                    await new Promise(r => setTimeout(r, 3000));
                },
                check: () => {
                    const required = [
                        // 电源正极驱动电桥顶端 (R1, R2 上端)
                        { from: 'dcpower_wire_p', to: 'pt_wire_r1l' },
                        { from: 'dcpower_wire_p', to: 'r3_wire_l' },
                        // 电桥下端 (PT100, VariRes 下端) 接地形成回路
                        { from: 'pt_wire_r2r', to: 'gnd0_wire_gnd' },
                        { from: 'r4_wire_r', to: 'gnd0_wire_gnd' },
                        // 桥臂连接：左臂 R1-PT100，右臂 R2-VariRes
                        { from: 'pt_wire_r1r', to: 'pt_wire_r2l' },
                        { from: 'r3_wire_r', to: 'r4_wire_l' },
                    ];
                    return required.every(req => this.conns.some(c => this._connEqual(c, { ...req, type: 'wire' })));
                }
            },

            // 2. 仪表放大器前级输入与增益网络
            {
                msg: "步骤 2：连接电桥差分输出至仪表放大器前级（Amp1, Amp2）及增益电阻网络。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 500));
                    const path = [
                        { from: 'pt_wire_r2l', to: 'amp2_wire_p', type: 'wire' }, // 左桥压 -> amp2
                        { from: 'r3_wire_r', to: 'amp1_wire_p', type: 'wire' }, // 右桥压 -> amp1
                        { from: 'amp2_wire_n', to: 'r5k_wire_r', type: 'wire' },
                        { from: 'r5k_wire_l', to: 'r10kv_wire_r', type: 'wire' },
                        { from: 'r10kv_wire_l', to: 'amp1_wire_n', type: 'wire' }
                    ];
                    for (let c of path) await this.addConnectionAnimated(c);
                    this.showComp.showTooltip('r10kv', '2. 仪表放大器前端增益调节网络', { color: '#2ecc71' });
                },
                check: () => {
                    const required = [
                        { from: 'pt_wire_r2l', to: 'amp2_wire_p' }, // 左桥压 -> amp2
                        { from: 'r3_wire_r', to: 'amp1_wire_p' }, // 右桥压 -> amp1
                        { from: 'amp2_wire_n', to: 'r5k_wire_r' },
                        { from: 'r5k_wire_l', to: 'r10kv_wire_r' },
                        { from: 'r10kv_wire_l', to: 'amp1_wire_n' }
                    ];
                    return required.every(req => this.conns.some(c => this._connEqual(c, { ...req, type: 'wire' })));
                }
            },

            // 3. 前级负反馈
            {
                msg: "步骤 3：建立 Amp1 和 Amp2 的闭环负反馈回路。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 500));
                    const path = [
                        { from: 'amp1_wire_OUT', to: 'r106k1_wire_r', type: 'wire' },
                        { from: 'r106k1_wire_l', to: 'amp1_wire_n', type: 'wire' },
                        { from: 'amp2_wire_OUT', to: 'r106k2_wire_r', type: 'wire' },
                        { from: 'r106k2_wire_l', to: 'amp2_wire_n', type: 'wire' }
                    ];
                    for (let c of path) await this.addConnectionAnimated(c);
                    this.showComp.showTooltip('r106k1', '3. 放大器1负反馈', { color: '#2ecc71' });
                    this.showComp.showTooltip('r106k2', '3. 放大器2负反馈', { color: '#2ecc71' });
                },
                check: () => {
                    const required = [
                        { from: 'amp1_wire_OUT', to: 'r106k1_wire_r' },
                        { from: 'r106k1_wire_l', to: 'amp1_wire_n' },
                        { from: 'amp2_wire_OUT', to: 'r106k2_wire_r' },
                        { from: 'r106k2_wire_l', to: 'amp2_wire_n' }
                    ];
                    return required.every(req => this.conns.some(c => this._connEqual(c, { ...req, type: 'wire' })));
                }
            },

            // 4. 差分输出级 Amp3
            {
                msg: "步骤 4：连接差分放大级 Amp3反相输入、同相输入 及其负反馈回路。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 500));
                    const path = [
                        { from: 'amp1_wire_OUT', to: 'r5k1_wire_l', type: 'wire' },
                        { from: 'r5k1_wire_r', to: 'amp3_wire_n', type: 'wire' },
                        { from: 'amp2_wire_OUT', to: 'r5k2_wire_l', type: 'wire' },
                        { from: 'r5k2_wire_r', to: 'amp3_wire_p', type: 'wire' },
                        { from: 'amp3_wire_OUT', to: 'r50k1_wire_r', type: 'wire' },
                        { from: 'r50k1_wire_l', to: 'amp3_wire_n', type: 'wire' }
                    ];
                    for (let c of path) await this.addConnectionAnimated(c);
                    this.showComp.showTooltip('r50k1', '4. 放大器3负反馈', { color: '#2ecc71' });

                },
                check: () => {
                    const required = [
                        { from: 'amp1_wire_OUT', to: 'r5k1_wire_l' },
                        { from: 'r5k1_wire_r', to: 'amp3_wire_n' },
                        { from: 'amp2_wire_OUT', to: 'r5k2_wire_l' },
                        { from: 'r5k2_wire_r', to: 'amp3_wire_p' },
                        { from: 'amp3_wire_OUT', to: 'r50k1_wire_r' },
                        { from: 'r50k1_wire_l', to: 'amp3_wire_n' }
                    ];
                    return required.every(req => this.conns.some(c => this._connEqual(c, { ...req, type: 'wire' })));
                }
            },

            // 5. 偏置电压产生与注入 (Amp4)
            {
                msg: "步骤 5：建立偏置电路（1V 参考电压）并注入 Amp3同相端。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 500));
                    const path = [
                        { from: 'dcpower_wire_p', to: 'r4k_wire_l', type: 'wire' },
                        { from: 'r4k_wire_r', to: 'r1k_wire_l', type: 'wire' },
                        { from: 'r1k_wire_r', to: 'gnd_wire_gnd', type: 'wire' },
                        { from: 'r1k_wire_l', to: 'amp4_wire_p', type: 'wire' },
                        { from: 'amp4_wire_OUT', to: 'r50k2_wire_r', type: 'wire' },
                        { from: 'r50k2_wire_r', to: 'amp4_wire_n', type: 'wire' },
                        { from: 'r50k2_wire_l', to: 'amp3_wire_p', type: 'wire' }
                    ];
                    for (let c of path) await this.addConnectionAnimated(c);
                    this.showComp.showTooltip('amp4', '5.amp4提供 1V 零点偏置', { color: '#f32d2d' });
                },
                check: () => {
                    const required = [
                        { from: 'dcpower_wire_p', to: 'r4k_wire_l' },
                        { from: 'r4k_wire_r', to: 'r1k_wire_l' },
                        { from: 'r1k_wire_r', to: 'gnd_wire_gnd' },
                        { from: 'r1k_wire_l', to: 'amp4_wire_p' },
                        { from: 'amp4_wire_OUT', to: 'r50k2_wire_r' },
                        { from: 'r50k2_wire_r', to: 'amp4_wire_n' },
                        { from: 'r50k2_wire_l', to: 'amp3_wire_p' }
                    ];
                    return required.every(req => this.conns.some(c => this._connEqual(c, { ...req, type: 'wire' })));
                }
            },

            // 6. 电流源预驱动 (Amp5)
            {
                msg: "步骤 6：连接V/I转换电路：Amp3 输出驱动 Amp5 同相端，Amp5输出驱动三极管基极，射极跟随输出。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 500));
                    const path = [
                        { from: 'amp3_wire_OUT', to: 'r100k2_wire_l', type: 'wire' },
                        { from: 'r100k2_wire_r', to: 'amp5_wire_p', type: 'wire' },
                        { from: 'amp5_wire_OUT', to: 'transistor_wire_b', type: 'wire' }
                    ];
                    for (let c of path) await this.addConnectionAnimated(c);
                    this.showComp.showTooltip('transistor', '6.三极管电流放大', { color: '#3bd369' });
                },
                check: () => {
                    const required = [
                        { from: 'amp3_wire_OUT', to: 'r100k2_wire_l' },
                        { from: 'r100k2_wire_r', to: 'amp5_wire_p' },
                        { from: 'amp5_wire_OUT', to: 'transistor_wire_b' }
                    ];
                    return required.every(req => this.conns.some(c => this._connEqual(c, { ...req, type: 'wire' })));
                }
            },

            // 7. PID 供电与电流源主回路
            {
                msg: "步骤 7：PID 供电，由 PID 输入回路提供 24V 至三极管集电极。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 500));
                    const path = [
                        { from: 'dcpower2_wire_p', to: 'pid_wire_vcc', type: 'wire' },
                        { from: 'dcpower2_wire_n', to: 'pid_wire_gnd', type: 'wire' },
                        { from: 'pid_wire_pi1', to: 'transistor_wire_c', type: 'wire' }
                    ];
                    for (let c of path) await this.addConnectionAnimated(c);
                    this.showComp.showTooltip('r100k3', '7. PID向三极管提供24V', { color: '#3bd369' });
                },
                check: () => {
                    const required = [
                        { from: 'dcpower2_wire_p', to: 'pid_wire_vcc' },
                        { from: 'dcpower2_wire_n', to: 'pid_wire_gnd' },
                        { from: 'pid_wire_pi1', to: 'transistor_wire_c' }
                    ];
                    return required.every(req => this.conns.some(c => this._connEqual(c, { ...req, type: 'wire' })));
                }
            },

            // 8. 电流源负反馈 (R250 左端)
            {
                msg: "步骤 8：建立amp5负反馈（三极管发射极、R250 左端）。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 500));
                    const path = [
                        { from: 'transistor_wire_e', to: 'r250_wire_l', type: 'wire' },
                        { from: 'r250_wire_l', to: 'r100k3_wire_r', type: 'wire' },
                        { from: 'r100k3_wire_l', to: 'r100k1_wire_r', type: 'wire' },
                        { from: 'r100k1_wire_l', to: 'gnd3_wire_gnd', type: 'wire' },
                        { from: 'r100k1_wire_r', to: 'amp5_wire_n', type: 'wire' }
                    ];
                    for (let c of path) await this.addConnectionAnimated(c);
                    this.showComp.showTooltip('gnd3', '8. 放大器5负反馈', { color: '#3bd369' });
                },
                check: () => {
                    const required = [
                        { from: 'transistor_wire_e', to: 'r250_wire_l' },
                        { from: 'r250_wire_l', to: 'r100k3_wire_r' },
                        { from: 'r100k3_wire_l', to: 'r100k1_wire_r' },
                        { from: 'r100k1_wire_l', to: 'gnd3_wire_gnd' },
                        { from: 'r100k1_wire_r', to: 'amp5_wire_n' }
                    ];
                    return required.every(req => this.conns.some(c => this._connEqual(c, { ...req, type: 'wire' })));
                }
            },

            // 9. 电流源正反馈 (R250 右端)
            {
                msg: "步骤 9：建立电流源正反馈（R250 右端），正反馈小于负反馈强度，整体呈现负反馈。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 500));
                    const path = [
                        { from: 'r250_wire_r', to: 'r100k4_wire_r', type: 'wire' },
                        { from: 'r100k4_wire_l', to: 'amp5_wire_p', type: 'wire' }
                    ];
                    for (let c of path) await this.addConnectionAnimated(c);
                    this.showComp.showTooltip('r100k4', '9. 放大器5正反馈', { color: '#e65111' });
                },
                check: () => {
                    const required = [
                        { from: 'r250_wire_r', to: 'r100k4_wire_r' },
                        { from: 'r100k4_wire_l', to: 'amp5_wire_p' }
                    ];
                    return required.every(req => this.conns.some(c => this._connEqual(c, { ...req, type: 'wire' })));
                }
            },

            // 10. 回路闭合至 PID 输入
            {
                msg: "步骤 10：连接电流表监测并将 4-20mA 信号反馈至 PID 输入端。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 500));
                    const path = [
                        { from: 'r250_wire_r', to: 'ampmeter_wire_p', type: 'wire' },
                        { from: 'ampmeter_wire_n', to: 'pid_wire_ni1', type: 'wire' }
                    ];
                    for (let c of path) await this.addConnectionAnimated(c);
                    this.showComp.showTooltip('ampmeter', '10. 4-20mA电流', { color: '#3bd369' });
                },
                check: () => {
                    const required = [
                        { from: 'r250_wire_r', to: 'ampmeter_wire_p' },
                        { from: 'ampmeter_wire_n', to: 'pid_wire_ni1' }
                    ];
                    return required.every(req => this.conns.some(c => this._connEqual(c, { ...req, type: 'wire' })));
                }
            },
            // 10. 气路连接
            {
                msg: "步骤 11：完成气路连接：空气瓶--》调压阀--》压力传感器。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 500));
                    const path = [
                        { from: 'cab_pipe_o', to: 'preg_pipe_i', type: 'pipe' },
                        { from: 'preg_pipe_o', to: 'pt_pipe_i', type: 'pipe' },
                    ];
                    for (let c of path) await this.addConnectionAnimated(c);
                    this.showComp.showTooltip('ampmeter', '11. 完成气路连接', { color: '#3bd369' });
                },
                check: () => {
                    const required = [
                        { from: 'cab_pipe_o', to: 'preg_pipe_i' },
                        { from: 'preg_pipe_o', to: 'pt_pipe_i' },
                    ];
                    return required.every(req => this.conns.some(c => this._connEqual(c, { ...req, type: 'pipe' })));
                }
            },
            // 12. 万用表监测连接
            {
                msg: "步骤 12：连接万用表监测电桥输出、仪表放大器输出。仪表放大器放大倍数约160倍，电桥满量程输出约25mV，放大后约4V，加上偏置电压1V，最终输出满量程电压5V。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 500));
                    this.comps.multimeter.mode = 'DCV20'; // 设置万用表1为电压档
                    this.comps.multimeter._updateAngleByMode(); // 更新指针角度
                    this.comps.multimeter2.mode = 'DCVmv'; // 设置万用表2为电压档
                    this.comps.multimeter2._updateAngleByMode(); // 更新指针角度
                    const path = [
                        { from: 'multimeter_wire_v', to: 'amp3_wire_OUT', type: 'wire' },
                        { from: 'multimeter_wire_com', to: 'gnd_wire_gnd', type: 'wire' },
                        { from: 'multimeter2_wire_v', to: 'pt_wire_r2l', type: 'wire' },
                        { from: 'multimeter2_wire_com', to: 'r3_wire_r', type: 'wire' }
                    ];
                    for (let c of path) await this.addConnectionAnimated(c);

                    await new Promise(r => setTimeout(r, 4000));
                },
                check: () => this.comps.dcpower.isOn === true && this.comps.dcpower2.isOn === true
            },
            // 13. 接通电源
            {
                msg: "步骤 13：接通电桥5V电源，接通变送器24V电源。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 500));
                    this.comps.dcpower.isOn = true; // 
                    this.comps.dcpower2.isOn = true; // 接通24V电源
                    this.comps.dcpower.update();
                    this.comps.dcpower2.update();

                    await new Promise(r => setTimeout(r, 4000));
                },
                check: () => this.comps.dcpower.isOn === true && this.comps.dcpower2.isOn === true
            },
            // 修正后的步骤 14
            {
                msg: "步骤 14：调压至0.5MPa气压。观察输出电流（预期 12mA）及 PID PV显示值（0.5）。",
                act: async () => {
                    // 1. 设置状态
                    this.comps.preg.setPressure = 0.5;
                    this.comps.preg.update();

                    // 2. 显示反馈
                    this.showComp.showStatusRing('pt', '#f1c40f');
                    // 确保 ID 传递准确
                    this.showComp.removeTooltip('pt');
                    this.showComp.showTooltip('pt', '产生0.5Mpa气压 ', { color: '#e82f0e' });

                    // 3. 等待时间增加一定的缓冲
                    await new Promise(r => setTimeout(r, 4000));

                    // 4. 强制清除
                    // 如果 removeTooltip 不管用，尝试调用通用的清理方法或检查该方法内部实现
                    this.showComp.removeTooltip('pt');
                    this.showComp.removeTooltip('pt');
                    // 建议：如果还有残留，可以检查是否叠加了多个 Tooltip
                    // 可以在 show 之前先 remove 一次防止堆叠
                },
                check: () => Math.abs(this.comps.pt.currentP - 0.5) < 0.1
            },

            // 15. 100度性能验证
            {
                msg: "步骤 15：产生1Mpa气压。观察输出电流（预期 20mA）及 PID PV显示值(1)。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 500));
                    this.comps.preg.setPressure = 1;
                    this.comps.preg.update(); // 触发组件状态更新
                    this.showComp.showTooltip('pt', '产生1MPa气压', { color: '#e82f0e' });
                    await new Promise(r => setTimeout(r, 4000));
                    this.showComp.clearAllTooltips(); // 演示结束，恢复视角
                },
                check: () => Math.abs(this.comps.pt.currentP - 1) < 0.1
            }
        ];


    }

    // 5. 初始化故障触发、修复、检测
    initFault() {

        // 1. 配置化故障定义：code -> { 检测逻辑, 修复逻辑 }
        this.FAULT_CONFIG = {
            1: {
                id: 1,
                name: "本实验无故障设定。",
                trigger: () => { if (this.comps['valve2']) this.comps['valve2'].isLeaking = true; },
                check: () => { return this.comps['valve2'] ? this.comps['valve2'].isLeaking === true : false; },
                repair: () => { if (this.comps['valve2']) this.comps['valve2'].isLeaking = false; }
            },

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
            // --- 1. 桥式电路部分 (电桥测量) ---
            // 电源正极驱动电桥顶端 (R1, R2 上端)
            { from: 'dcpower_wire_p', to: 'pt_wire_r1l', type: 'wire' },
            { from: 'dcpower_wire_p', to: 'r3_wire_l', type: 'wire' },
            // 电桥下端 (PT100, VariRes 下端) 接地形成回路
            { from: 'pt_wire_r2r', to: 'gnd0_wire_gnd', type: 'wire' },
            { from: 'r4_wire_r', to: 'gnd0_wire_gnd', type: 'wire' },
            // 桥臂连接：左臂 R1-PT100，右臂 R2-VariRes
            { from: 'pt_wire_r1r', to: 'pt_wire_r2l', type: 'wire' },
            { from: 'r3_wire_r', to: 'r4_wire_l', type: 'wire' },

            // --- 2. 仪表放大器部分 (三运放结构：amp1, amp2 为输入级，amp3 为差分级) ---
            // 输入级：将电桥左右中点信号接入 amp1 和 amp2 的同相输入端
            { from: 'r3_wire_r', to: 'amp1_wire_p', type: 'wire' }, // 右桥压 -> amp1
            { from: 'pt_wire_r2l', to: 'amp2_wire_p', type: 'wire' }, // 左桥压 -> amp2
            // 增益电阻 Rg=10k (r5k为固定的5k，r10kv是可调的10k，取中间值5k) 跨接在两个运放的反相输入端之间
            { from: 'amp1_wire_n', to: 'r10kv_wire_l', type: 'wire' },
            { from: 'r10kv_wire_r', to: 'r5k_wire_l', type: 'wire' },
            { from: 'r5k_wire_r', to: 'amp2_wire_n', type: 'wire' },
            // 增益电阻可一分为二：10k电位器分成两个5k，分别接在 amp1 和 amp2 的反相输入端，形成差分放大器的增益调节，放大倍数为 1 + 101.5k/5k = 21.3 倍
            // 反馈电阻：amp1 和 amp2 的输出通过 r106k1, r106k2 回馈，此为amp1的反馈
            { from: 'amp1_wire_OUT', to: 'r106k1_wire_r', type: 'wire' },
            { from: 'r106k1_wire_l', to: 'amp1_wire_n', type: 'wire' },
            // 反馈电阻：amp1 和 amp2 的输出通过 r106k1, r106k2 回馈，此为amp2的反馈
            { from: 'amp2_wire_OUT', to: 'r106k2_wire_r', type: 'wire' },
            { from: 'r106k2_wire_l', to: 'amp2_wire_n', type: 'wire' },

            // 差分输出级 (amp3)：接收前级输出
            { from: 'amp1_wire_OUT', to: 'r5k1_wire_l', type: 'wire' },
            { from: 'r5k1_wire_r', to: 'amp3_wire_n', type: 'wire' },
            { from: 'amp2_wire_OUT', to: 'r5k2_wire_l', type: 'wire' },
            { from: 'r5k2_wire_r', to: 'amp3_wire_p', type: 'wire' },
            // amp3 反馈，输入电阻5k，反馈电阻50k，增益10倍，差分最大电压18.8mV，两级放大213倍，输出最大4V
            { from: 'amp3_wire_OUT', to: 'r50k1_wire_r', type: 'wire' },
            { from: 'r50k1_wire_l', to: 'amp3_wire_n', type: 'wire' },

            // --- 3. 偏置与加法电路 (amp4) ---
            // 电源接到两个电阻的分压电路，上电阻4k，下电阻1k，分压后得到1V的偏置电压。
            { from: 'dcpower_wire_p', to: 'r4k_wire_l', type: 'wire' },
            { from: 'r4k_wire_r', to: 'r1k_wire_l', type: 'wire' },
            { from: 'r1k_wire_r', to: 'gnd_wire_gnd', type: 'wire' },
            // 1V电压输入到amp4的同相端，利用射级跟随器结构提供低阻抗的1V偏置电压，同时将amp3的输出通过电阻送入amp4的反相端进行加法运算，实现零点偏移。
            { from: 'r1k_wire_l', to: 'amp4_wire_p', type: 'wire' },
            { from: 'amp4_wire_OUT', to: 'r50k2_wire_r', type: 'wire' },
            { from: 'r50k2_wire_r', to: 'amp4_wire_n', type: 'wire' },
            // 1V偏置电压由 amp4 提供，连接到 amp3 的同相输入端
            { from: 'r50k2_wire_l', to: 'amp3_wire_p', type: 'wire' },

            // --- 4. 电流源驱动部分 (amp5 + Transistor) ---
            // 同相端输入控制电压。1V对应4mA，5V对应20mA。
            { from: 'amp3_wire_OUT', to: 'r100k2_wire_l', type: 'wire' },
            { from: 'r100k2_wire_r', to: 'amp5_wire_p', type: 'wire' },
            // 放大器输出通过三极管进行电流放大。集电极由24V供电，发射极驱动定值250欧姆电阻产生电流。
            // { from: 'dcpower2_wire_p', to: 'transistor_wire_c', type: 'wire' },
            { from: 'amp5_wire_OUT', to: 'transistor_wire_b', type: 'wire' },
            { from: 'transistor_wire_e', to: 'r250_wire_l', type: 'wire' },
            //从三极管发射极进行负反馈，正反馈在定值电阻左端，因此能形成深度负反馈，放大器工作在线性状态。
            { from: 'r250_wire_l', to: 'r100k3_wire_r', type: 'wire' },
            { from: 'r100k3_wire_l', to: 'r100k1_wire_r', type: 'wire' },
            { from: 'r100k1_wire_l', to: 'gnd3_wire_gnd', type: 'wire' },
            { from: 'r100k1_wire_r', to: 'amp5_wire_n', type: 'wire' },
            // 从定值电阻右端进行正反馈，形成电流采样回路，确保输出电流与控制电压成线性关系。
            { from: 'r250_wire_r', to: 'r100k4_wire_r', type: 'wire' },
            { from: 'r100k4_wire_l', to: 'amp5_wire_p', type: 'wire' },

            // (1)使用500欧姆负载rload,电流表与负载电阻串联，监测输出电流大小，同时负载电阻形成电流回路的闭合。
            { from: 'r250_wire_r', to: 'ampmeter_wire_p', type: 'wire' },
            // { from: 'ampmeter_wire_n', to: 'rload_wire_l', type: 'wire' },
            { from: 'rload_wire_r', to: 'gnd2_wire_gnd', type: 'wire' },
            // (2)PID输入回路，三极管由pid_wire_pi1供电，4-20mA电流通过电流表监测后进入pid_wire_ni1，形成闭环控制。
            { from: 'dcpower2_wire_p', to: 'pid_wire_vcc', type: 'wire' },
            { from: 'dcpower2_wire_n', to: 'pid_wire_gnd', type: 'wire' },
            { from: 'pid_wire_pi1', to: 'transistor_wire_c', type: 'wire' },
            { from: 'ampmeter_wire_n', to: 'pid_wire_ni1', type: 'wire' },

            // --- 5. 各级测量监测 (万用表) ---
            // 万用表1监测电桥输出差压
            // { from: 'multimeter_wire_v', to: 'r1_wire_r', type: 'wire' },
            // { from: 'multimeter_wire_com', to: 'r2_wire_r', type: 'wire' },
            //万用表1监测一级放大输出，验证前置放大器的放大倍数是否正确。
            // { from: 'multimeter_wire_v', to: 'amp2_wire_OUT', type: 'wire' },
            // { from: 'multimeter_wire_com', to: 'amp1_wire_OUT', type: 'wire' },
            // 万用表1监测仪表放大器的输出
            { from: 'multimeter_wire_v', to: 'amp3_wire_OUT', type: 'wire' },
            { from: 'multimeter_wire_com', to: 'gnd_wire_gnd', type: 'wire' },
            // 万用表1监测PT100输出电压
            { from: 'multimeter2_wire_v', to: 'pt_wire_r1r', type: 'wire' },
            { from: 'multimeter2_wire_com', to: 'r3_wire_r', type: 'wire' },

            //--- 6. 气路连接 ---
            { from: 'cab_pipe_o', to: 'preg_pipe_i', type: 'pipe' },
            { from: 'preg_pipe_o', to: 'pt_pipe_i', type: 'pipe' },
        ];
        this.redrawAll();

    }

    // 4. 启动系统，控制开关、截止阀之类组件控制系统运行
    async applyStartSystem() {
        this.comps.multimeter.mode = 'DCV20';
        this.comps.multimeter._updateAngleByMode();
        this.comps.multimeter2.mode = 'DCVmv';
        this.comps.multimeter2._updateAngleByMode();
        this.comps.dcpower.isOn = true;
        this.comps.dcpower.update();
        this.comps.dcpower2.isOn = true;
        this.comps.dcpower2.update();
        this.comps.pid.mode = 'AUTO';


    }
    // 5. 多点步进系统，用于多次设置参数
    /**
     * 5点步进系统：根据 PID 模式切换步进目标
     * 手动模式：步进 PID 输出 (0, 25, 50, 75, 100)
     * 自动模式：步进 Pt100 电阻 (100, 109.73, 119.4, 128.98, 138.51) -> 对应 0, 25, 50, 75, 100°C
     */
    fiveStep() {
        const pid = this.comps['pid'];
        const varipress = this.comps['preg'];

        if (!pid || !varipress) return;

        // 1. 获取当前 PID 模式 (假设 pid.mode 为 'MAN' 或 'AUTO')
        const isManual = pid.mode === 'MAN';

        // 2. 定义不同模式下的步进序列
        const steps = isManual
            ? [0, 25, 50, 75, 100]                   // 手动模式：PID 输出百分比 (%)
            : [0.25, 0.5, 0.75, 1, 0]; // 自动模式：Pt100 电阻值 (Ω)

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
            varipress.setPressure = targetValue;
            if (typeof varipress.update === 'function') {
                varipress.update();
            }
        }

        // 5. 更新计数器
        this._testStep = (nextIndex + 1) % steps.length;
    }


    // ==========================================
    // 第二部分：交互管理（手动连线控制）
    // ==========================================
    /**
     * 显示系统级右键菜单（用于设置仿真步长等）
     */
    showSystemContextMenu(evt) {
        // 1. 移除可能已存在的旧菜单
        const oldMenu = document.getElementById('sys-context-menu');
        if (oldMenu) oldMenu.remove();

        const menu = document.createElement('div');
        menu.id = 'sys-context-menu';
        // 基础样式
        const baseStyle = `
        position: fixed; top: ${evt.clientY}px; left: ${evt.clientX}px;
        background: white; border: 1px solid #ccc; border-radius: 4px;
        box-shadow: 2px 2px 10px rgba(0,0,0,0.2); z-index: 10000;
        padding: 5px 0; min-width: 160px; font-family: sans-serif; font-size: 14px;
    `;
        menu.style = baseStyle;

        // 工具函数：创建普通菜单项
        const createItem = (label, onClick, hasSubmenu = false) => {
            const item = document.createElement('div');
            item.style = 'padding: 8px 15px; cursor: pointer; transition: background 0.2s; display: flex; justify-content: space-between; align-items: center;';
            item.innerHTML = `<span>${label}</span>${hasSubmenu ? '<span style="font-size:10px;">▶</span>' : ''}`;

            item.onmouseenter = () => item.style.background = '#f0f0f0';
            item.onmouseleave = () => item.style.background = 'transparent';

            if (onClick) {
                item.onclick = (e) => {
                    e.stopPropagation();
                    onClick();
                };
            }
            return item;
        };

        // --- 创建“仿真步长”子菜单项 ---
        const stepLabel = `仿真步长 (${(this.voltageSolver.deltaTime * 1000).toFixed(2)}ms)`;
        const stepItem = createItem(stepLabel, null, true);

        // 创建子菜单容器
        const submenu = document.createElement('div');
        submenu.style = `
        position: absolute; left: 100%; top: 0; background: white;
        border: 1px solid #ccc; border-radius: 4px; box-shadow: 2px 2px 10px rgba(0,0,0,0.1);
        display: none; padding: 5px 0; min-width: 120px;
    `;

        // 定义可选步长
        const steps = [
            { label: '0.1 ms', value: 0.0001 },
            { label: '0.01 ms', value: 0.00001 },
            { label: '0.001 ms', value: 0.000001 }
        ];

        steps.forEach(s => {
            // 判断是否是当前步长
            const isCurrent = Math.abs(this.voltageSolver.deltaTime - s.value) < s.value * 0.1;
            const subItem = document.createElement('div');
            subItem.style = 'padding: 8px 15px; cursor: pointer; display: flex; align-items: center;';
            subItem.innerHTML = `<span style="width: 20px;">${isCurrent ? '✓' : ''}</span>${s.label}`;

            subItem.onmouseenter = () => subItem.style.background = '#f0f0f0';
            subItem.onmouseleave = () => subItem.style.background = 'transparent';

            subItem.onclick = (e) => {
                e.stopPropagation();
                this.setSimulationStep(s.value);
                menu.remove();
            };
            submenu.appendChild(subItem);
        });

        // 鼠标悬浮显示子菜单逻辑
        stepItem.onmouseenter = () => {
            stepItem.style.background = '#f0f0f0';
            submenu.style.display = 'block';
        };
        stepItem.onmouseleave = (e) => {
            // 检查鼠标是否移向了子菜单
            if (!submenu.contains(e.relatedTarget)) {
                submenu.style.display = 'none';
            }
        };
        submenu.onmouseleave = (e) => {
            if (!stepItem.contains(e.relatedTarget)) {
                submenu.style.display = 'none';
            }
        };

        stepItem.appendChild(submenu);
        menu.appendChild(stepItem);

        // 挂载到容器
        this.container.appendChild(menu);

        // 点击其他地方关闭
        const closeMenu = (e) => {
            if (!menu.contains(e.target)) {
                menu.remove();
                window.removeEventListener('mousedown', closeMenu);
            }
        };
        window.addEventListener('mousedown', closeMenu);
    }

    /**
     * 修改步长的逻辑方法
     */
    setSimulationStep(val) {
        if (this.voltageSolver) {
            this.voltageSolver.deltaTime = val;
            console.log(`[System] 步长已切换至: ${val * 1000} ms`);
            // 必要时重置部分瞬态参数，防止数值突变
            this._needsRedraw = true;
        }
    }


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
            setTimeout(() => {
                if (this.container.contains(tip)) this.container.removeChild(tip);
            }, 500);
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
            this.requestRedraw();
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
        this.requestRedraw();
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
        if (!this.conns.some(c => this._connEqual(c, conn))) this.conns.push(conn);
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

    // 请求一次在下一帧统一重绘（组件在高频更新中应调用此方法）
    requestRedraw() {
        this._needsRedraw = true;
    }

    // 增量更新现有线条节点的位置（避免销毁重建）
    updateLinePositions() {
        const getPosByPort = (portId) => {
            const did = portId.split('_')[0];
            return this.comps[did]?.getAbsPortPos(portId);
        };

        // 更新 pipeNodes：每个 conn 对应 3 个节点（line, flow, handle）
        const pipeConns = this.conns.filter(c => c.type === 'pipe');
        if (this.pipeNodes.length === pipeConns.length * 3) {
            for (let i = 0; i < pipeConns.length; i++) {
                const conn = pipeConns[i];
                const p1 = getPosByPort(conn.from);
                const p2 = getPosByPort(conn.to);
                if (!p1 || !p2) continue;
                const baseIdx = i * 3;
                const line = this.pipeNodes[baseIdx];
                const flow = this.pipeNodes[baseIdx + 1];
                const handle = this.pipeNodes[baseIdx + 2];
                let pts = [p1.x, p1.y, p2.x, p2.y];
                if (conn.midPoint) pts = [p1.x, p1.y, conn.midPoint.x, conn.midPoint.y, p2.x, p2.y];
                try { line.points(pts); flow.points(pts); handle.position(conn.midPoint || { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 }); } catch (e) { }
            }
        } else {
            // 节点数量不匹配，退化为完全重绘
            // 不直接调用 this.redrawAll()，仅标记需要重绘，下一帧会触发
            this._needsRedraw = true;
        }

        // 更新 wireNodes：每个 conn 对应 1 个节点
        const wireConns = this.conns.filter(c => c.type === 'wire');
        if (this.wireNodes.length === wireConns.length) {
            for (let i = 0; i < wireConns.length; i++) {
                const conn = wireConns[i];
                const p1 = getPosByPort(conn.from);
                const p2 = getPosByPort(conn.to);
                if (!p1 || !p2) continue;
                const node = this.wireNodes[i];
                try {
                    if (conn.from.includes('multimeter') || conn.to.includes('multimeter')) {
                        const midX = (p1.x + p2.x) / 2;
                        const midY = Math.max(p1.y, p2.y) + 20;
                        node.points([p1.x, p1.y, midX, midY, p2.x, p2.y]);
                    } else {
                        const midX = (p1.x + p2.x) / 2;
                        const midY = (p1.y + p2.y) / 2;
                        const dx = p2.x - p1.x;
                        const dy = p2.y - p1.y;
                        const len = Math.sqrt(dx * dx + dy * dy) || 1;
                        const ux = -dy / len;
                        const uy = dx / len;
                        const devA = conn.from.split('_')[0];
                        const devB = conn.to.split('_')[0];
                        const siblings = this.conns.filter(c => c.type === 'wire' && (() => {
                            const ca = c.from.split('_')[0];
                            const cb = c.to.split('_')[0];
                            return (ca === devA && cb === devB) || (ca === devB && cb === devA);
                        })());
                        const idx = siblings.findIndex(c => this._connKeyCanonical(c) === this._connKeyCanonical(conn));
                        const total = siblings.length || 1;
                        const spacing = 18;
                        const longSpacing = 8;
                        const offset = (idx - (total - 1) / 2) * spacing;
                        const longOffset = (idx - (total - 1) / 2) * longSpacing;
                        const controlX = midX + ux * offset + (dx / len) * longOffset;
                        const controlY = midY + uy * offset + (dy / len) * longOffset;
                        const pts = [p1.x, p1.y, controlX, controlY, controlX, controlY, p2.x, p2.y];
                        node.points(pts);
                    }
                } catch (e) { }
            }
        } else {
            this._needsRedraw = true;
        }
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
                const showHandle = () => { handle.visible(true); if (this.requestRedraw) this.requestRedraw(); };
                const hideHandle = () => { if (!handle.isDragging()) handle.visible(false); if (this.requestRedraw) this.requestRedraw(); };

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
                    if (conn.from.endsWith('p') || conn.to.endsWith('p') || conn.from.includes('wire_a')) stroke = '#e60c0c';
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
     * 优化点 1：物理计算循环 (CPU 密集型)
     * 将 CircuitSolver 和 Workflow 的 check 完全隔离在 UI 重绘之外
     */
    _updatePhysics() {

        // 1. 电路求解
        this.voltageSolver.update();
        // 2. 气路求解
        this.pressSolver.solve();
        if (this._physicsIterCount % 60 === 0) {
            // 每 60 次统计不做其他工作，这里保留供后续扩展
        }
        this._physicsIterCount++;
    }

    /**
         * 优化点 2：静态组件 Canvas 缓存策略
         * 对 Resistor、PT100 等纯静态、无指针旋转的组件进行离屏 Canvas 缓存
         */
    _applyStaticCaching() {
        // 1. 遍历组件并执行 cache()
        Object.values(this.comps).forEach(comp => {
            if (comp.cache === 'fixed') {
                if (comp.group && comp.group.cache) {
                    // cache() 是 Konva 降低 CPU 渲染压力的利器
                    comp.group.cache();
                }
            }
        });
    }

    /**
     * 优化点 3：按需重绘循环 (GPU/UI 密集型)
     * 只有当 _needsRedraw 标记为 true 时，才执行 batchDraw()
     */
    _renderLoop() {
        // 1. 检查重绘标记 (耗时极多)
        if (this._needsRedraw) {
            // batchDraw() 是 Konva 内部优化过的重绘方法
            this.layer.batchDraw();
            // 同步重绘连线图层，确保在拖动组件时线路位置更新可见
            this.lineLayer.batchDraw();
            this._needsRedraw = false; // 重置标记
        }

        // 2. 递归调用 RequestAnimationFrame，跟随浏览器 UI 刷新频率
        requestAnimationFrame(() => this._renderLoop());
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
