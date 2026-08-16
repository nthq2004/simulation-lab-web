import { Workflow } from './tools/Workflow.js';  // 流程控制工具
import { CircuitSolver } from './tools/CircuitSolver.js';  // 电路求解工具
import { PneumaticSolver } from './tools/PneumaticSolver.js'; // 气路求解工具
import { Show } from './tools/Show.js'; // 提示展示工具

import { AirBottle } from './components/AirBottle.js'; // 气瓶组件
import { PressRegulator } from './components/PressRegulator.js';  // 减压阀组件
import { PressMeter } from './components/PressMeter.js';  // 压力表组件


import { LVDTPressureSensor } from './components/LVDT.js';  // 差动变压器组件

import { VoltageTransmitter } from './components/VoltageTransmitter.js';  // 电压变送器组件 

import { DCPower } from './components/DCPower.js';  // 直流电源组件
import { AmpMeter } from './components/AmpMeter.js'; // 电流表组件
import { VariResistor } from './components/VariResistor.js'; // 可变电阻组件
import { Resistor } from './components/Resistor.js'; // 电阻组件
import { Multimeter } from './components/Multimeter.js';  // 万用表组件
import { OpAmp } from './components/OpAmp.js';  // 运算放大器组件
import { Ground } from './components/Gnd.js';  // 地组件
import { PIDController } from './components/PID.js';  // PID控制器组件


import { ACPower } from './components/ACPower.js';  // 交流电源组件
import { Oscilloscope_tri } from './components/Osc_tri.js'; // 三通道示波器组件
import { Oscilloscope } from './components/Oscilloscope.js';  // 示波器组件
import { SignalGenerator } from './components/SignalGenerator.js';  // 信号发生器组件
import { Capacitor } from './components/Capacitor.js';  // 电容组件
import { JFET } from './components/JFET.js';  // JFET场效应管组件
import { Diode } from './components/Diode.js';  // 二极管组件

import { Transistor } from './components/Transistor.js';  // 三极管组件
import { PressTransmitter } from './components/PressTransmitter.js';
import { RealVariResistor } from './components/RealVariResistor.js';
import { TeeConnector } from './components/TeeConnector.js';
import { StopValve } from './components/StopValve.js';
import { LeakDetector } from './components/LeakDetector.js';
/**
 * ControlSystem - 控制系统仿真引擎
 * 负责组件管理、物理计算、自动/手动连线逻辑及渲染更新
 */
export class ControlSystem {
    constructor() {
        // 1. 画布基础设置
        this.container = document.getElementById('container'); // 画布容器
        this.stage = new Konva.Stage({ container: 'container', width: window.innerWidth, height: window.innerHeight }); // 整个画布舞台
        this.layer = new Konva.Layer();  // 组件层（包含所有组件节点）
        this.lineLayer = new Konva.Layer(); // 连线层（单独管理连线，便于控制层级和重绘）
        this.stage.add(this.layer, this.lineLayer); // 组件层在下，连线层在上

        // 2. 组件和连线资源池
        this.comps = {};        // 组件实例集合
        this.conns = [];        // 所有连接统一存储为 {from, to, type}
        this.pipeNodes = [];    // 画布上的管路形状节点
        this.wireNodes = [];    // 画布上的电路形状节点

        // 3. 连线交互状态
        this.linkingState = null; // 当前正在连线的起点信息
        this.tempLine = null;     // 鼠标跟随虚线

        //4. 流程控制、电路求解、气路求解
        this.stepsArray = [];  //存储所有流程的数组
        this.workflowComp = null;  //流程控制实例组件
        this.voltageSolver = null;  //电路求解器实例组件
        this.pressSolver = null;   //气路求解器组件
        this.showComp = null;        //提示展示组件

        // --- 5. 性能优化：重绘控制标记 ---
        this._needsRedraw = true; // 初始状态需要绘制一次
        this._physicsIterCount = 0; // 物理计算迭代计数器

        //6.基本初始化、撤销恢复初始化、交互初始化、流程控制初始化、故障配置初始化。
        this.init();  // 基础组件和循环初始化
        this.initHistory();  // 历史状态管理初始化
        this.initStageEvents(); // 连线交互事件初始化
        this.initSteps(); // 流程控制初始化
        this.initFault(); // 故障配置初始化

    }

    // ==========================================
    // 第一部分：初始化与核心配置
    // ==========================================

    /**
     * 1. 系统初始化：创建组件并启动仿真循环
     */
    init() {
        // 计算缩放因子以适应不同屏幕大小
        const baseWidth = 1920;  // 设计稿的基础宽度
        const baseHeight = 1080; // 设计稿的基础高度
        const scaleX = window.innerWidth / baseWidth;  // 水平缩放因子
        const scaleY = window.innerHeight / baseHeight; // 垂直缩放因子
        const scale = Math.min(scaleX, scaleY);  // 取较小的缩放因子以保持宽高比
        const offsetX = (window.innerWidth - baseWidth * scale) / 2;  // 水平居中偏移
        const offsetY = (window.innerHeight - baseHeight * scale) / 2; // 垂直居中偏移

        // 1. 实例化组件，传入 this 以便组件能够调用 handlePortClick 和 redrawAll
        const componentConfigs = [
            { Class: AirBottle, id: 'cab', x: 1250, y: 300 },

            { Class: StopValve, id: 'stopv', x: 950, y: 380 },
            { Class: TeeConnector, id: 'tconn', x: 500, y: 400, direction: 'right' },
            { Class: PressRegulator, id: 'preg', x: 700, y: 350 },
            { Class: PressTransmitter, id: 'ptrans', x: 250, y: 350 },
            { Class: PressMeter, id: 'pmeter', x: 520, y: 150 },
            { Class: DCPower, id: 'dcpower', x: -50, y: 50 },
            { Class: VariResistor, id: 'varires', value: 500, x: 200, y: 150 },
            { Class: AmpMeter, id: 'ampmeter', x: 50, y: 400 },
            { Class: Multimeter, id: 'multimeter', x: 1520, y: 130 },
            { Class: LeakDetector, id: 'leak', x: 1100, y: 200 },
        ];

        // 应用缩放和偏移到组件配置
        const scaledConfigs = componentConfigs.map(cfg => ({
            ...cfg,   // 应用缩放和偏移到组件坐标
            x: cfg.x * scale + offsetX,  // 应用水平缩放和居中偏移
            y: cfg.y * scale + offsetY,  // 应用垂直缩放和居中偏移
            scale: scale    // 传递缩放因子到组件，组件内部根据需要调整大小
        }));

        // 实例化组件并添加到画布
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
        // 3. 启动独立的物理计算循环 (使用 setInterval 保证计算频率)
        this._physicsTimer = setInterval(() => this._updatePhysics(), 1000 / 60); // 60fps 的计算频率

        // 4. 启动独立的渲染循环 (使用 RequestAnimationFrame 跟随浏览器 UI 刷新)
        this._renderLoop();
    }



    // 2. 历史状态初始化、声明onChange函数（处理两个按钮的状态）
    initHistory() {
        // history 管理：仅记录用户点击产生的连接/删除动作
        this.history = new HistoryManager();
        const btnUndo = document.getElementById('btnUndo');
        const btnRedo = document.getElementById('btnRedo');
        this.history.onChange = () => { // 每次历史状态改变时更新按钮状态
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
                // 直接从组件获取起点坐标（适用于组件内端口）
                startPos = this.linkingState.comp.getAbsPortPos(this.linkingState.portId);
            } else {
                const did = this.linkingState.portId.split('_')[0];
                startPos = this.comps[did]?.getAbsPortPos(this.linkingState.portId);
            }
            if (!startPos) return;
            // 更新虚线坐标,并确保虚线在所有组件之下
            this.tempLine.points([startPos.x, startPos.y, pos.x, pos.y]);
            this.tempLine.moveToBottom();
            // 优化：只在坐标发生实际变化时才请求重绘，避免不必要的渲染
            this.requestRedraw();
        });
        this.stage.on('contextmenu', (e) => {
            e.evt.preventDefault(); // 阻止默认菜单
            e.evt.stopPropagation(); // ← 防止触发 window 的监听器
            // 逻辑：如果点击的是空白处（不是组件），显示系统菜单
            // 如果你已经为组件写了右键逻辑，这里需要判断 target 
            if (e.target === this.stage || e.target.name() === 'background-rect') {
                // 右键点击空白处，显示系统菜单
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
            { id: 0, name: "1. 压力变送器的功能测试(项目4.1)" },
            { id: 1, name: "2. 压力变送器回路断路故障排除(项目4.1)" },
            { id: 2, name: "3. 压力变送器气路漏气故障排除(项目4.1)" },
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
        const autoConns = [
            { from: 'dcpower_wire_p', to: 'varires_wire_l', type: 'wire' },
            { from: 'varires_wire_r', to: 'ptrans_wire_p', type: 'wire' },
            { from: 'ptrans_wire_n', to: 'ampmeter_wire_p', type: 'wire' },
            { from: 'ampmeter_wire_n', to: 'dcpower_wire_n', type: 'wire' },
            { from: 'cab_pipe_o', to: 'stopv_pipe_i', type: 'pipe' },
            { from: 'stopv_pipe_o', to: 'preg_pipe_i', type: 'pipe' },
            { from: 'preg_pipe_o', to: 'tconn_pipe_u', type: 'pipe' },
            { from: 'tconn_pipe_l', to: 'pmeter_pipe_i', type: 'pipe' },
            { from: 'tconn_pipe_r', to: 'ptrans_pipe_i', type: 'pipe' },
        ];
        this.stepsArray[0] = [
            {
                msg: "1. 24V电源(+) -> 负载电阻(+)",
                act: async () => {
                    this.conns = []; // 清空现有连接
                    this.comps['dcpower'].isOn = false;
                    this.comps['dcpower'].update();
                    this.comps['stopv'].isOpen = false;
                    this.comps['stopv'].update();

                    await new Promise(r => setTimeout(r, 500));
                    await this.addConnectionAnimated(autoConns[0]);
                    await new Promise(r => setTimeout(r, 500));
                },
                check: () => this.conns.some(c => this._connEqual(c, autoConns[0]))
            },
            {
                msg: "2. 负载电阻(-)-> 压力变送器(+)",
                act: async () => {
                    await new Promise(r => setTimeout(r, 500));
                    await this.addConnectionAnimated(autoConns[1]);
                    await new Promise(r => setTimeout(r, 500));
                },
                check: () => this.conns.some(c => this._connEqual(c, autoConns[1]))
            },
            {
                msg: "3.  压力变送器(-) -> 电流表(+)",
                act: async () => {
                    await new Promise(r => setTimeout(r, 500));
                    await this.addConnectionAnimated(autoConns[2]);
                    await new Promise(r => setTimeout(r, 500));
                },
                check: () => this.conns.some(c => this._connEqual(c, autoConns[2]))
            },
            {
                msg: "4. 电流表(-) -> 24V电源(-)",
                act: async () => {
                    await new Promise(r => setTimeout(r, 500));
                    await this.addConnectionAnimated(autoConns[3]);
                    await new Promise(r => setTimeout(r, 500));
                },
                check: () => this.conns.some(c => this._connEqual(c, autoConns[3]))
            },
            {
                msg: "5. 空气瓶出口 -> 截止阀右端",
                act: async () => {
                    await new Promise(r => setTimeout(r, 500));
                    await this.addConnectionAnimated(autoConns[4]);
                    await new Promise(r => setTimeout(r, 500));
                },
                check: () => this.conns.some(c => this._connEqual(c, autoConns[4]))
            },
            {
                msg: "6. 截止阀左端 -> 调节阀入口",
                act: async () => {
                    await new Promise(r => setTimeout(r, 500));
                    await this.addConnectionAnimated(autoConns[5]);
                    await new Promise(r => setTimeout(r, 500));
                },
                check: () => this.conns.some(c => this._connEqual(c, autoConns[5]))
            },
            {
                msg: "7. 调节阀出口 -> T型管下端",
                act: async () => {
                    await new Promise(r => setTimeout(r, 500));
                    await this.addConnectionAnimated(autoConns[6]);
                    await new Promise(r => setTimeout(r, 500));
                },
                check: () => this.conns.some(c => this._connEqual(c, autoConns[6]))
            },
            {
                msg: "8. T型管上端 -> 压力表",
                act: async () => {
                    await new Promise(r => setTimeout(r, 500));
                    await this.addConnectionAnimated(autoConns[7]);
                    await new Promise(r => setTimeout(r, 500));
                },
                check: () => this.conns.some(c => this._connEqual(c, autoConns[7]))
            },
            {
                msg: "9. T型管左端 -> 压力变送器气压口",
                act: async () => {
                    await new Promise(r => setTimeout(r, 500));
                    await this.addConnectionAnimated(autoConns[8]);
                    await new Promise(r => setTimeout(r, 500));
                },
                check: () => this.conns.some(c => this._connEqual(c, autoConns[8]))
            },
            {
                msg: "10. 按下24V电源键,接通电源",
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    this.comps['dcpower'].isOn = true;
                    this.comps['dcpower'].update();
                    await new Promise(r => setTimeout(r, 2000));
                },
                check: () => this.comps['dcpower'].isOn === true
            },
            {
                msg: "11. 合上截止阀,变送器气压为0,电流应为4mA.",
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    this.comps['stopv'].isOpen = true;
                    this.comps['stopv'].update();
                    this.comps['preg'].setPressure = 0;
                    this.comps['preg'].update();
                    await new Promise(r => setTimeout(r, 2000));
                },
                check: () => this.comps['stopv'].isOpen === true && this.comps['preg'].setPressure === 0 && Math.abs(this.comps['ampmeter'].value - 4) < 0.1
            },
            {
                msg: `12. 将压力调节到0.25 * 量程,变送器电流应为8mA.`,
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    this.comps['preg'].setPressure = 0.25 * this.comps['ptrans'].max;
                    this.comps['preg'].update();
                    await new Promise(r => setTimeout(r, 2000));
                },
                check: () => Math.abs(this.comps['preg'].setPressure - 0.25 * this.comps['ptrans'].max) < 0.05 && Math.abs(this.comps['ampmeter'].value - 8) < 0.1
            },
            {
                msg: `13. 将压力调节到0.5 * 量程,变送器电流应为12mA.`,
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    this.comps['preg'].setPressure = 0.5 * this.comps['ptrans'].max;
                    this.comps['preg'].update();
                    await new Promise(r => setTimeout(r, 1000));
                },
                check: () => Math.abs(this.comps['preg'].setPressure - 0.5 * this.comps['ptrans'].max) < 0.05 && Math.abs(this.comps['ampmeter'].value - 12) < 0.1
            },
            {
                msg: `14. 将压力调节到0.75 *  量程,变送器电流应为16mA.`,
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    this.comps['preg'].setPressure = 0.75 * this.comps['ptrans'].max;
                    this.comps['preg'].update();
                    await new Promise(r => setTimeout(r, 1000));
                },
                check: () => Math.abs(this.comps['preg'].setPressure - 0.75 * this.comps['ptrans'].max) < 0.05 && Math.abs(this.comps['ampmeter'].value - 16) < 0.1
            },
            {
                msg: `15. 将压力调节到1* 量程,变送器电流应为20mA.`,
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    this.comps['preg'].setPressure = this.comps['ptrans'].max;
                    this.comps['preg'].update();
                    await new Promise(r => setTimeout(r, 1000));
                },
                check: () => Math.abs(this.comps['preg'].setPressure - this.comps['ptrans'].max) < 0.05 && Math.abs(this.comps['ampmeter'].value - 20) < 0.1
            },
        ];
        const meterConns = [
            { from: 'multimeter_wire_com', to: 'dcpower_wire_n', type: 'wire' },
            { from: 'multimeter_wire_v', to: 'dcpower_wire_p', type: 'wire' },
            { from: 'multimeter_wire_com', to: 'ptrans_wire_n', type: 'wire' },
            { from: 'multimeter_wire_v', to: 'ptrans_wire_p', type: 'wire' },
        ];
        this.stepsArray[1] = [
            {
                msg: '1. 接通电路和气路。',
                act: async () => {
                    await new Promise(r => setTimeout(r, 500));
                    // 使用 for...of 替代 forEach
                    for (const conn of autoConns) {
                        const exists = this.conns.some(c => this._connEqual(c, conn));
                        if (!exists) {
                            // 这里会等待当前这一根线画完，再进入下一次循环
                            await this.addConnectionAnimated(conn);
                            // 每一根线画完后，可以稍微停顿一下（可选）
                        }
                    }
                    await new Promise(r => setTimeout(r, 500));
                },
                check: () => {
                    return autoConns.every(conn =>
                        this.conns.some(c => this._connEqual(c, conn))
                    );
                }
            },
            {
                msg: '2. 触发压力变送器电路断路故障。',
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    this.FAULT_CONFIG['1'].trigger();
                    await new Promise(r => setTimeout(r, 2000));
                },
                check: () => this.FAULT_CONFIG['1'].check()
            },

            {
                msg: '3. 合上电源和截止阀，观察电流表显示为0。',
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    this.comps['dcpower'].isOn = true;
                    this.comps['dcpower'].update();
                    await new Promise(r => setTimeout(r, 2000));

                    this.comps['stopv'].isOpen = true;
                    this.comps['stopv'].update();
                    await new Promise(r => setTimeout(r, 1000));
                },
                check: () => this.comps['dcpower'].isOn && this.comps['stopv'].isOpen && Math.abs(this.comps['ampmeter'].value - 0) < 0.1
            },
            {
                msg: '4. 关闭气源。',
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    this.comps['stopv'].isOpen = false;
                    this.comps['stopv'].update();
                    await new Promise(r => setTimeout(r, 1000));
                },
                check: () => !this.comps['stopv'].isOpen
            },
            {
                msg: '5. 用万用表测电压,判断电路断点。',
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    this.comps['multimeter'].group.position({ x: 700, y: 500 });
                    await new Promise(r => setTimeout(r, 1000));

                    this.comps['multimeter'].mode = "DCV200";
                    this.comps['multimeter']._updateAngleByMode('DCV200');
                    await new Promise(r => setTimeout(r, 1000));

                    await this.addConnectionAnimated(meterConns[0]);
                    await this.addConnectionAnimated(meterConns[1]);
                    await new Promise(r => setTimeout(r, 3000));

                    if (this.comps['ptrans'].isBreak) {
                        this.removeConn(meterConns[0]);
                        this.removeConn(meterConns[1]);
                        await new Promise(r => setTimeout(r, 1000));

                        await this.addConnectionAnimated(meterConns[2]);
                        await this.addConnectionAnimated(meterConns[3]);
                    }
                    await new Promise(r => setTimeout(r, 2000));
                },
                check: () => {

                    // 如果是电源断线，multimeter 测 dcpower_wire_p 到 dcpower_wire_n 应为 0
                    if (this.comps['dcpower'].isBreak) {
                        // 只有当万用表连接到 dcpower_wire_p 与 dcpower_wire_n 时才判断
                        return this.conns.some(c =>this._connEqual(c,meterConns[0])) &&
                            this.conns.some(c => c =>this._connEqual(c,meterConns[1])) && this.comps['dcpower'].isOn &&(this.comps['multimeter'].mode === 'DCV200') &&
                            Math.abs(this.comps['multimeter'].value - 0) < 0.5;
                    }
                    // 如果是变送器内部断线，万用表可测得变送器 p/n 端电压等于电源电压
                    if (this.comps['ptrans'].isBreak) {
                        return this.conns.some(c =>this._connEqual(c,meterConns[2])) &&
                            this.conns.some(c => c =>this._connEqual(c,meterConns[3]))&& this.comps['dcpower'].isOn &&(this.comps['multimeter'].mode === 'DCV200') && Math.abs(this.comps['multimeter'].value - this.comps['dcpower'].getValue()) < 0.5;
                    }
                    return false;
                }
            },
            {
                msg: '6. 关闭电源，修复断线故障。',
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    this.comps['dcpower'].isOn = false;
                    this.comps['dcpower'].update();
                    await new Promise(r => setTimeout(r, 2000));

                    this.FAULT_CONFIG['1'].repair();
                    await new Promise(r => setTimeout(r, 2000));
                },
                check: () => !this.comps['dcpower'].isOn && !this.FAULT_CONFIG['1'].check()
            },
            {
                msg: '7. 开启电源，确认在无气压输入情况下电流恢复为4mA。',
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    this.comps['dcpower'].isOn = true;
                    this.comps['dcpower'].update();
                    await new Promise(r => setTimeout(r, 2000));
                },
                check: () => (this.comps['dcpower'].isOn) && (Math.abs(this.comps['ampmeter'].value - 4) < 0.5)
            }
        ];
        this.stepsArray[2] = [
            {
                msg: '1. 接通电路和气路。',
                act: async () => {
                    await new Promise(r => setTimeout(r, 100));
                    // 使用 for...of 替代 forEach
                    for (const conn of autoConns) {
                        const exists = this.conns.some(c =>
                           this._connEqual(c, conn)
                        );
                        if (!exists) {
                            // 这里会等待当前这一根线画完，再进入下一次循环
                            await this.addConnectionAnimated(conn);
                            // 每一根线画完后，可以稍微停顿一下（可选）
                        }
                    }
                    await new Promise(r => setTimeout(r, 100));
                },
                check: () => {
                    return autoConns.every(conn =>
                        this.conns.some(c =>
                            this._connEqual(c, conn)
                        )
                    );
                }
            },
            {
                msg: '2. 触发压力变送器气路漏气故障。',
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    this.FAULT_CONFIG['2'].trigger();
                    await new Promise(r => setTimeout(r, 2000));
                },
                check: () => this.FAULT_CONFIG['2'].check()
            },
            {
                msg: '3. 合上电源和截止阀，观察电流表显示正常。',
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    this.comps['dcpower'].isOn = true;
                    this.comps['dcpower'].update();
                    await new Promise(r => setTimeout(r, 2000));
                    this.comps['stopv'].isOpen = true;
                    this.comps['stopv'].update();
                    await new Promise(r => setTimeout(r, 1000));
                },
                check: () => this.comps['dcpower'].isOn && this.comps['stopv'].isOpen && Math.abs(this.comps['ampmeter'].value - 4) < 0.1
            },
            {
                msg: `4. 将压力调节到 0.5 倍变送器量程，观察漏气现象，判断漏气点。 `,
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    this.comps['preg'].setPressure = 0.5 * this.comps['ptrans'].max;
                    await new Promise(r => setTimeout(r, 3000));
                },
                check: () => Math.abs((this.comps['preg'].setPressure) - 0.5 * this.comps['ptrans'].max) < (0.05)
            },
            {
                msg: '5. 使用 Leak Test 工具检测漏气',
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    const portsToCheck = ['ptrans_pipe_i', 'pmeter_pipe_i'];

                    // 1. 使用 find 找到第一个 isLeaking 为 true 的节点
                    const leakingNode = portsToCheck.reduce((foundNode, id) => {
                        if (foundNode) return foundNode; // 如果已经找到了，就不再继续查找

                        const compId = id.split('_')[0];
                        const comp = this.comps[compId];

                        if (comp && comp.ports) {
                            const port = comp.ports.find(p => p.id === id);
                            // 检查端口是否存在，且属性是否为 true
                            if (port && port.node && port.node.getAttr('isLeaking') === true) {
                                return port.node;
                            }
                        }
                        return null;
                    }, null);

                    // 防御性检查：如果没有找到漏气点，直接结束，防止后续代码报错
                    if (!leakingNode) {
                        console.log("未检测到漏气点");
                        return;
                    }
                    // 2. 获取该节点的绝对坐标
                    const pos = leakingNode.getAbsolutePosition();

                    this.comps['leak'].group.position({ x: pos.x - 20, y: pos.y + 30 });
                    await new Promise(r => setTimeout(r, 500));
                    this.comps['leak'].group.position({ x: pos.x - 10, y: pos.y + 50 });
                    await new Promise(r => setTimeout(r, 500));
                    this.comps['leak'].group.position({ x: pos.x - 20, y: pos.y + 30 });
                    await new Promise(r => setTimeout(r, 500));
                    this.comps['leak'].group.position({ x: pos.x - 10, y: pos.y + 50 });
                    await new Promise(r => setTimeout(r, 3000));
                },
                check: () => (this.comps['leak'] && this.comps['leak'].isEmitting === true)
            },
            {
                msg: '6. 关闭电源和气源。',
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    this.comps['dcpower'].isOn = false;
                    this.comps['dcpower'].update();
                    await new Promise(r => setTimeout(r, 2000));

                    this.comps['stopv'].isOpen = false;
                    this.comps['stopv'].update();
                    await new Promise(r => setTimeout(r, 1000));
                },
                check: () => (!this.comps['dcpower'].isOn) && (!this.comps['stopv'].isOpen)
            },
            {
                msg: '7. 修复漏气点。',
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    this.FAULT_CONFIG['2'].repair();
                    await new Promise(r => setTimeout(r, 3000));
                },
                check: () => !this.FAULT_CONFIG['2'].check()
            },
            {
                msg: '8. 合上电源和气源，确定气压表和变送器读数接近相等。',
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    this.comps['dcpower'].isOn = true;
                    this.comps['dcpower'].update();
                    await new Promise(r => setTimeout(r, 2000));

                    this.comps['stopv'].isOpen = true;
                    this.comps['stopv'].update();
                    await new Promise(r => setTimeout(r, 1000));

                    this.comps['preg'].setPressure = (0.5 * this.comps['ptrans'].max);
                    await new Promise(r => setTimeout(r, 1000));
                },
                check: () => (this.comps['dcpower'].isOn) && (this.comps['stopv'].isOpen) && (Math.abs((this.comps['preg'].setPressure) - 0.5 * this.comps['ptrans'].max)) < 0.05
            }
        ];


    }

    // 5. 初始化故障触发、修复、检测
    initFault() {

        // 1. 配置化故障定义：code -> { 检测逻辑, 修复逻辑 }
        this.FAULT_CONFIG = {
            1: {
                id: 1,
                name: "1. 压力变送器回路断路故障",
                trigger: () => {
                    // 1: 设置开路故障
                    const choices = ['dcpower', 'ptrans'];
                    const pick = choices[Math.floor(Math.random() * choices.length)];
                    const device = this.comps[pick];
                    if (device) {
                        device.isBreak = true; // 这里用 isBreak 来模拟开路状态，实际可以根据需要调整属性名称和逻辑
                    }
                },
                check: () => { return this.comps['dcpower'].isBreak || this.comps['ptrans'].isBreak },
                repair: () => {
                    if (this.comps['dcpower'].isBreak) this.comps['dcpower'].isBreak = false;
                    if (this.comps['ptrans'].isBreak) this.comps['ptrans'].isBreak = false;
                }
            },
            2: {
                id: 2,
                name: "2. 压力变送器气路漏气故障",
                trigger: () => {
                    // n=2: 设置漏气故障
                    const candidates = [];
                    const tryPush = (id) => {
                        const parts = id.split('_');
                        const compId = parts[0]; // 获取组件 ID
                        const comp = this.comps[compId];
                        let foundPort = null;

                        for (let i = 0; i < comp.ports.length; i++) {
                            if (comp.ports[i].id === id) {
                                foundPort = comp.ports[i];
                                break; // 找到后立即停止循环
                            }
                        }
                        candidates.push(foundPort);
                    };
                    tryPush('ptrans_pipe_i');
                    tryPush('pmeter_pipe_i');
                    if (candidates.length === 0) {
                        return;
                    }
                    const idx = Math.floor(Math.random() * candidates.length);
                    const port = candidates[idx];
                    port.node.setAttr('isLeaking', true);
                },
                check: () => {
                    const portsToCheck = ['ptrans_pipe_i', 'pmeter_pipe_i'];
                    return portsToCheck.some(id => {
                        const compId = id.split('_')[0];
                        const comp = this.comps[compId];
                        if (comp) {
                            const port = comp.ports.find(p => p.id === id);
                            return port && port.node.attrs.isLeaking;
                        }
                        return false;
                    });

                },
                repair: () => {
                    const portsToCheck = ['ptrans_pipe_i', 'pmeter_pipe_i'];
                    portsToCheck.forEach(id => {
                        const compId = id.split('_')[0];
                        const comp = this.comps[compId];
                        if (comp) {
                            const port = comp.ports.find(p => p.id === id);
                            if (port && port.node.attrs.isLeaking) {
                                port.node.setAttr('isLeaking', false);
                            }
                        }
                    });
                }
            },

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
            { from: 'dcpower_wire_p', to: 'varires_wire_l', type: 'wire' },
            { from: 'varires_wire_r', to: 'ptrans_wire_p', type: 'wire' },
            { from: 'ptrans_wire_n', to: 'ampmeter_wire_p', type: 'wire' },
            { from: 'ampmeter_wire_n', to: 'dcpower_wire_n', type: 'wire' },
            { from: 'cab_pipe_o', to: 'stopv_pipe_i', type: 'pipe' },
            { from: 'stopv_pipe_o', to: 'preg_pipe_i', type: 'pipe' },
            { from: 'preg_pipe_o', to: 'tconn_pipe_u', type: 'pipe' },
            { from: 'tconn_pipe_l', to: 'pmeter_pipe_i', type: 'pipe' },
            { from: 'tconn_pipe_r', to: 'ptrans_pipe_i', type: 'pipe' },
        ];
        this.redrawAll();

    }

    // 4. 启动系统，控制开关、截止阀之类组件控制系统运行
    async applyStartSystem() {
        // this.comps.multimeter.mode = 'DCV200';
        // this.comps.multimeter._updateAngleByMode();

        this.comps.dcpower.isOn = true;
        this.comps.dcpower.update();

        this.comps.stopv.isOpen = true;
        this.comps.stopv.update();

    }
    // 5. 多点步进系统，用于多次设置参数
    /**
     * 5点步进系统：根据 PID 模式切换步进目标
     * 手动模式：步进 PID 输出 (0, 25, 50, 75, 100)
     * 自动模式：步进设定值 (0.25, 0.5, 0.75, 1, 0)，模拟不同压力点的系统响应
     */
    fiveStep() {
        const varipress = this.comps['preg'];
        if (!varipress) return;
        // 1. 获取当前  模式 ()
        const isManual = false;
        // 2. 定义不同模式下的步进序列
        const steps = isManual
            ? [0, 25, 50, 75, 100]                   // 手动模式：PID 输出百分比 (%)
            : [0.25, 0.5, 0.75, 1, 0]; // 自动模式：设置参数值
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
        } else {
            // --- 自动模式逻辑 ---
            // 设置参数变化
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
