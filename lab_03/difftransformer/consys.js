import { Workflow, CircuitSolver, PneumaticSolver, DigitalSolver, MicrocontrollerSolver, MCS51Solver, Show, perfMonitor } from './export.js';

import { LeakDetector, AirBottle, PressRegulator, PressMeter, TeeConnector, StopValve, Pump, Cooler, Engine, WaterTankSystem, WaterTankTwoPos, WaterTankLevelControl, DiffTransmitter, BubbleLevelTransmitter, PIDController, OvenSystem, ElecValve, LVDTPressureSensor, TempTransmitter, PressTransmitter, SmartPressTransmitter, Rosemount475, VoltageTransmitter, DCPower, AmpMeter, VariResistor, Resistor, Multimeter, OpAmp, Ground, Monitor, ProcessCalibrator, VoltageRelay, ACPower, Oscilloscope_tri, Oscilloscope, SignalGenerator, Capacitor, JFET, Diode, Transistor, RealResistor, RealVariResistor, CoolingSystem, FuelOilHeater, PressRelay, AudioVisualAlarm, NormallyClosedPushButton, NormallyOpenPushButton } from './export.js';
import { HistoryManager, ConnectionManager, Renderer, UIManager, WorkflowManager, AIModule, AOModule, DIModule, DOModule, CentralComputer, CANBus, createCANSystem, BUSCON } from './export.js';

import { WaterBath, RealPT100, RealTC,ThreeValve,StrainCylinderSensor,PneumaticValve,
AirCompressor,
 } from './export.js';
import { AND, OR, NOT, NAND, NOR, XOR, DFlipFlop, JKFlipFlop, ClockGen, Counter, ADC, DAC, MCU, Timer555, MCS51 } from './export.js';
/**
 * ControlSystem - 控制系统仿真引擎
 * 负责组件管理、物理计算、自动/手动连线逻辑及渲染更新
 * 各功能细节委托给子模块处理
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
        this.comps = {};
        this.conns = [];
        this.pipeNodes = [];
        this.wireNodes = [];

        // 3. 连线交互状态
        this.linkingState = null;
        this.tempLine = null;

        // 4. 流程控制、电路求解、气路求解、数字求解
        this.stepsArray = [];
        this.workflowComp = null;
        this.voltageSolver = null;
        this.pressSolver = null;
        this.digitalSolver = null;
        this.mcuSolver = null;
        this.showComp = null;

        // 5. 性能优化：重绘控制标记
        this._needsRedraw = true;
        this._physicsIterCount = 0;

        // 6. 子模块实例化
        this.history = new HistoryManager();
        this.connMgr = new ConnectionManager(this);
        this.renderer = new Renderer(this);
        this.uiMgr = new UIManager(this);
        this.workflowMgr = new WorkflowManager(this);

        // 7. 初始化流程
        this.init();
        this.initHistory();
        this.initStageEvents();
        this.workflowMgr.initSteps();
        this.workflowMgr.initFault();
    }

    // ==========================================
    // 第一部分：初始化与核心配置
    // ==========================================

    /**
     * 系统初始化：创建组件并启动仿真循环
     */
    init() {
        const baseWidth = 1920;
        const baseHeight = 1080;
        const scaleX = window.innerWidth / baseWidth;
        const scaleY = window.innerHeight / baseHeight;
        const scale = Math.min(scaleX, scaleY);
        const offsetX = (window.innerWidth - baseWidth * scale) / 2;
        const offsetY = (window.innerHeight - baseHeight * scale) / 2;

        const componentConfigs = [
            { Class: Ground, id: 'gnd1', x: 50, y: 550 },
            { Class: LVDTPressureSensor, id: 'pt', x: 170, y: 500 },
            { Class: Ground, id: 'gnd2', x: 250, y: 600 },
            { Class: AirBottle, id: 'cab', x: -20, y: 870 },
            { Class: PressRegulator, id: 'preg', x: -80, y: 650, reverse: true },

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
            { Class: VariResistor, id: 'varires', value: 20000,cvalue:10000, x: 750, y: 480 },
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

            { Class: Oscilloscope_tri, id: 'osc3', x: 780, y: 160, visible: true },
            { Class: SignalGenerator, id: 'sg', x: 210, y: 200, visible: true },
            { Class: Multimeter, id: 'multimeter', x: 650, y: 500, visible: false},
            { Class: AmpMeter, id: 'ampmeter', x: 450, y: 100, visible: false },
            { Class: ProcessCalibrator, id: 'cali', x: 600, y: 100, visible: false },
        ];

        const scaledConfigs = componentConfigs.map(cfg => ({
            ...cfg,
            x: cfg.x * scale + offsetX,
            y: cfg.y * scale + offsetY,
            scale: scale
        }));

        const visibilityMap = {}; // 存储需要隐藏的组件

        scaledConfigs.forEach(cfg => {
            if (cfg.visible === false) {
                visibilityMap[cfg.id] = false;
                delete cfg.visible; // 移除 visible 参数，让组件正常初始化
            }

            this.comps[cfg.id] = new cfg.Class(cfg, this);
            this.layer.add(this.comps[cfg.id].group);
        });

        // 绘制一次以激活事件系统和完成初始化
        this._applyStaticCaching();
        this.layer.draw();

        // 最后隐藏需要隐藏的组件
        Object.keys(visibilityMap).forEach(compId => {
            if (this.comps[compId] && this.comps[compId].group) {
                this.comps[compId].group.visible(false);
            }
        });

        this.layer.draw();

        this.workflowComp = new Workflow(this);
        this.voltageSolver = new CircuitSolver(this);
        this.pressSolver = new PneumaticSolver(this);
        this.digitalSolver = new DigitalSolver(this);
        this.mcuSolver = new MicrocontrollerSolver(this);
        this.mcs51Solver = new MCS51Solver(this);
        this.showComp = new Show(this);

        perfMonitor.enabled = true;

        this._physicsTimer = setInterval(() => this._updatePhysics(), 1000 / 20);
        this._renderLoop();
    }

    /**
     * 历史状态初始化：绑定撤销/重做按钮
     */
    initHistory() {
        const btnUndo = document.getElementById('btnUndo');
        const btnRedo = document.getElementById('btnRedo');
        this.history.onChange = () => {
            btnUndo.disabled = !(this.history.undos && this.history.undos.length > 0);
            btnRedo.disabled = !(this.history.redos && this.history.redos.length > 0);
        };
        this.history.onChange();
    }

    /**
     * 连线交互初始化：鼠标移动虚线预览 + 右键取消
     */
    initStageEvents() {
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
            e.evt.preventDefault();
            e.evt.stopPropagation();
            if (e.target === this.stage || e.target.name() === 'background-rect') {
                this.uiMgr.showSystemContextMenu(e.evt);
            }
        });

        window.addEventListener('contextmenu', (e) => { e.preventDefault(); this.connMgr.resetLinking(); });
        window.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.connMgr.resetLinking(); });
    }

    // ==========================================
    // 第二部分：代理方法（保持原有外部调用接口不变）
    // ==========================================

    // ── 连线管理代理 ──────────────────────────────────────────

    handlePortClick(comp, portId, type) {
        this.connMgr.handlePortClick(comp, portId, type);
    }

    resetLinking() {
        this.connMgr.resetLinking();
    }

    addConnWithHistory(conn) {
        this.connMgr.addConnWithHistory(conn);
    }

    addConn(conn) {
        this.connMgr.addConn(conn);
    }

    removeConnWithHistory(conn) {
        this.connMgr.removeConnWithHistory(conn);
    }

    removeConn(conn) {
        this.connMgr.removeConn(conn);
    }

    addConnectionAnimated(conn) {
        return this.connMgr.addConnectionAnimated(conn);
    }

    _connEqual(a, b) {
        return this.connMgr.connEqual(a, b);
    }

    _connKeyCanonical(c) {
        return this.connMgr.connKeyCanonical(c);
    }

    // ── 渲染代理 ──────────────────────────────────────────────

    redrawAll() {
        this.renderer.redrawAll();
    }

    requestRedraw() {
        this._needsRedraw = true;
    }

    updateLinePositions() {
        this.renderer.updateLinePositions();
    }

    // ── UI 代理 ───────────────────────────────────────────────

    showSystemContextMenu(evt) {
        this.uiMgr.showSystemContextMenu(evt);
    }

    setSimulationStep(val) {
        this.uiMgr.setSimulationStep(val);
    }

    showFloatingTip(text, duration) {
        this.uiMgr.showFloatingTip(text, duration);
    }

    // ── 流程/故障代理 ─────────────────────────────────────────

    switchWorkflow(taskValue) {
        this.workflowMgr.switchWorkflow(taskValue);
    }

    openWorkflowPanel(mode) {
        this.workflowMgr.openWorkflowPanel(mode);
    }

    applyAllPresets() {
        this.workflowMgr.applyAllPresets();
    }

    async applyStartSystem() {
        return this.workflowMgr.applyStartSystem();
    }

    fiveStep() {
        this.workflowMgr.fiveStep();
    }

    // ==========================================
    // 第三部分：电路/气路仿真接口
    // ==========================================

    getVoltageBetween(portIdA, portIdB) {
        return this.voltageSolver.getPD(portIdA, portIdB);
    }

    isPortConnected(portIdA, portIdB) {
        return this.voltageSolver.isPortConnected(portIdA, portIdB);
    }

    getPressAt(portId) {
        // 预留接口
    }

    onComponentStateChange(dev) {
        // 预留接口
    }

    // ==========================================
    // 第四部分：仿真主循环（物理计算 + 渲染）
    // ==========================================

    /**
     * 物理计算循环 (20fps，setInterval 保证计算频率)
     * 优化：添加性能监测
     */
    _updatePhysics() {
        this._physicsIterCount++;

        const startPhysics = performance.now();
        perfMonitor.recordMetric('physicUpdate', performance.now() - startPhysics);

        const startCircuit = performance.now();
        this.voltageSolver.update();
        perfMonitor.recordMetric('circuitSolve', performance.now() - startCircuit);

        const startPneumatic = performance.now();
        this.pressSolver.solve();
        perfMonitor.recordMetric('pneumaticSolve', performance.now() - startPneumatic);

        // ── 数字逻辑仿真 ──
        const startDigital = performance.now();
        if (this.digitalSolver) {
            this.digitalSolver.update(1 / 20);
        }
        if (this.mcuSolver) {
            this.mcuSolver.update(1 / 20, 5);
        }
        if (this.mcs51Solver) {
            this.mcs51Solver.update(1 / 20);
        }
        // 更新数字组件的 LED 显示
        this._updateDigitalLEDs();
        perfMonitor.recordMetric('digitalSolve', performance.now() - startDigital);
    }

    /**
     * 更新所有数字组件的 LED 指示灯
     */
    _updateDigitalLEDs() {
        Object.values(this.comps).forEach(comp => {
            if (comp.updateLED && typeof comp.updateLED === 'function') {
                comp.updateLED();
            }
        });
    }

    /**
     * 静态组件 Canvas 缓存策略
     */
    _applyStaticCaching() {
        Object.values(this.comps).forEach(comp => {
            if (comp.cache === 'fixed') {
                if (comp.group && comp.group.cache) {
                    comp.group.cache();
                }
            }
        });
    }

    /**
     * 显示仪表菜单：万用表、信号发生器、过程校验仪
     */
    showInstrument() {
        const modal = document.getElementById('instrumentModal');

        // 如果菜单已显示，则关闭它
        if (modal.style.display === 'flex') {
            modal.style.display = 'none';
            return;
        }

        const form = document.getElementById('instrumentForm');

        // 仪表配置信息
        const instruments = [
            { id: 'ampmeter', name: '电流表', compId: 'ampmeter' },
            { id: 'multimeter', name: '万用表', compId: 'multimeter' },
            { id: 'sg', name: '信号发生器', compId: 'sg' },
            { id: 'cali', name: '过程校验仪', compId: 'cali' },
            { id: 'osc3', name: '三路示波器', compId: 'osc3' },
        ];

        // 清空表单
        form.innerHTML = '';

        // 创建每个仪表的复选框
        instruments.forEach(inst => {
            const div = document.createElement('div');
            div.className = 'i-checkbox';

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.value = inst.compId;
            checkbox.id = `instr_${inst.id}`;

            // 检查该组件是否存在并显示
            const comp = this.comps[inst.compId];
            if (comp && comp.group) {
                checkbox.checked = comp.group.visible();
            }

            // 监听复选框变化事件
            checkbox.addEventListener('change', (e) => {
                this.toggleInstrumentVisibility(inst.compId, e.target.checked);
            });

            const label = document.createElement('label');
            label.htmlFor = `instr_${inst.id}`;
            label.textContent = inst.name;
            label.style.cursor = 'pointer';
            label.style.flex = '1';

            div.appendChild(checkbox);
            div.appendChild(label);
            form.appendChild(div);
        });

        // 显示模态框
        modal.style.display = 'flex';
    }

    /**
     * 切换仪表的显示/隐藏状态
     */
    toggleInstrumentVisibility(compId, visible) {
        const comp = this.comps[compId];
        if (comp && comp.group) {
            comp.group.visible(visible);
            // 确保事件监听器保持启用状态
            comp.group.listening(true);

            // 当显示组件时，强制重绘整个舞台以确保事件系统正确激活
            if (visible) {
                this.stage.draw();
            }

            this.requestRedraw();
        }
    }

    /**
     * 优化后的按需重绘循环 (RequestAnimationFrame)
     * 改进措施：
     * 1. 添加帧率上限 (60fps)
     * 2. 分离管道/电路层的绘制
     * 3. 智能判断是否需要真正绘制
     * 4. 集成性能监测
     */
    _renderLoop() {
        const frameStart = performance.now();
        const now = frameStart;

        // 帧率上限：60fps (16.67ms per frame)
        if (!this._lastFrameTime) this._lastFrameTime = now;
        const deltaTime = now - this._lastFrameTime;

        // 只在距离上次绘制 > 16ms 时才进行绘制
        if (deltaTime >= 33 && this._needsRedraw) {
            this.layer.batchDraw();
            this.lineLayer.batchDraw();
            this._needsRedraw = false;
            this._lastFrameTime = now;
            perfMonitor.recordMetric('batchDraw', performance.now() - frameStart);
        } else if (deltaTime >= 16 && !this._needsRedraw) {
            // 即使无需重绘，也要每 100ms 检查一次仪表更新
            if (deltaTime >= 100) {
                this.layer.batchDraw();
                this.lineLayer.batchDraw();
                this._lastFrameTime = now;
                perfMonitor.recordMetric('batchDraw', performance.now() - frameStart);
            }
        }

        const totalFrameTime = performance.now() - frameStart;
        perfMonitor.recordMetric('renderLoop', totalFrameTime);
        requestAnimationFrame(() => this._renderLoop());
    }
}
