import { Workflow, CircuitSolver, PneumaticSolver, DigitalSolver, MicrocontrollerSolver, MCS51Solver, Show, perfMonitor, EventBus, EquipmentPool, ThermalSolver } from './export.js';
import { COOLING_SYSTEM_DEVICES } from './tools/CoolingSystemData.js';
import { PHASE2_ALL_DEVICES } from './tools/Phase2SystemData.js';

import { LeakDetector, AirBottle, PressRegulator, PressMeter, TeeConnector, StopValve, Pump, Cooler, Engine, WaterTankSystem, WaterTankTwoPos, WaterTankLevelControl, DiffTransmitter, BubbleLevelTransmitter, PIDController, OvenSystem, ElecValve, LVDTPressureSensor, TempTransmitter, PressTransmitter, SmartPressTransmitter, Rosemount475, VoltageTransmitter, DCPower, AmpMeter, VariResistor, Resistor, Multimeter, OpAmp, Ground, Monitor, ProcessCalibrator, VoltageRelay, ACPower, Oscilloscope_tri, Oscilloscope, SignalGenerator, Capacitor, JFET, Diode, Transistor, NpnTempSensor, RealResistor, RealVariResistor, CoolingSystem, FuelOilHeater, PressRelay, AudioVisualAlarm, NormallyClosedPushButton, NormallyOpenPushButton, BourdonTube, DiaphragmGauge } from './export.js';
import { HistoryManager, ConnectionManager, Renderer, UIManager, WorkflowManager, AIModule, AOModule, DIModule, DOModule, CentralComputer, CANBus, createCANSystem, BUSCON } from './export.js';

import {
    WaterBath, RealPT100, RealTC, ThreeValve, StrainCylinderSensor, PneumaticValve,
    AirCompressor, NTCThermistor, NTCtempTransmitter,
} from './export.js';

import { AND, OR, NOT, NAND, NOR, XOR, DFlipFlop, JKFlipFlop, ClockGen, Counter, ADC, DAC, MCU, Timer555, MCS51 } from './export.js';
import { StateSync } from './engineroom3d/integration/StateSync.js';
import { AlarmLogger } from './tools/AlarmLogger.js';
import { HistoryRecorder } from './tools/HistoryRecorder.js';
import { ReplayController } from './tools/ReplayController.js';
import { ScenarioManager } from './tools/ScenarioManager.js';
import { PRE_BUILT_SCENARIOS } from './tools/PreBuiltScenarios.js';
import { SessionManager } from './tools/SessionManager.js';
import { ActionLogger } from './tools/ActionLogger.js';
import { ScoringEngine } from './tools/ScoringEngine.js';
import { ReportGenerator } from './tools/ReportGenerator.js';
import { ReportUI } from './tools/ReportUI.js';

// modbus
import { IASServer, PLC, ModbusTempTransmitter, ModbusPressTransmitter, ModbusVFD, ModbusLevelTransmitter, ModbusValvePositioner, ModbusBUSCON, createModbusSystem } from './export.js';

// gateway
import { GatewayController, GatewayPanel } from './gateway/GatewayUI.js';
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

            { Class: Oscilloscope_tri, id: 'osc3', x: 800, y: 160, visible: false },
            { Class: SignalGenerator, id: 'sg', x: 210, y: 200, visible: false },
            { Class: Multimeter, id: 'multimeter', x: 1350, y: 500, visible: false },
            { Class: AmpMeter, id: 'ampmeter', x: 450, y: 100, visible: false },
            { Class: ProcessCalibrator, id: 'cali', x: 600, y: 100, visible: false },

            // ── 波登管压力表（左侧）──
            { Class: BourdonTube, id: 'bourdon', x: 350, y: 80,
              width: 300, height: 360, label: 'PI-101',
              rangeMax: 100, rangeUnit: 'kPa', dialDivs: 10,
              initPressure: 0 },
            // ── 膜片式压力表（右侧）──
            { Class: DiaphragmGauge, id: 'diaphragm', x: 800, y: 80,
              width: 300, height: 400, label: 'PI-201',
              rangeMax: 100, rangeUnit: 'kPa', dialDivs: 10,
              initPressure: 0 },

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

        // ── 数字孪生模块初始化 ──
        this.eventBus = new EventBus();
        this.equipmentPool = new EquipmentPool();
        this.stateSync = new StateSync(this.equipmentPool, this.eventBus);
        this.alarmLogger = new AlarmLogger(this.eventBus);
        // ── 学员操作记录分析报告模块 ──
        this.sessionManager = new SessionManager(this.equipmentPool, this.eventBus);
        this.actionLogger = new ActionLogger(this.eventBus);
        this.scoringEngine = new ScoringEngine();
        this.reportGenerator = new ReportGenerator();
        this.reportUI = new ReportUI(this.reportGenerator, this.sessionManager, this.scoringEngine);
        // ── 历史记录 ──
        this.historyRecorder = new HistoryRecorder(this.equipmentPool, this.eventBus);
        this.replayController = new ReplayController(this.equipmentPool, this.eventBus);
        this.scenarioManager = new ScenarioManager(this.equipmentPool, this.eventBus);
        PRE_BUILT_SCENARIOS.forEach(s => this.scenarioManager.register(s.id, s));
        this.thermalSolver = new ThermalSolver(this);
        // 注册发动机热节点网络
        // ── 硬件网关 ──
        this.gatewayController = new GatewayController(this.equipmentPool, this.eventBus, {
            baudRate: 115200,
            wsUrl: 'ws://localhost:8080',
        });

        if (this.thermalSolver.addEngine) {
            this.thermalSolver.addEngine({
                id: 'me-01',
                coolant: { temp: 25, capacity: 5000 },
                exhaust: { temp: 30, capacity: 1000 },
                lubeOil: { temp: 25, capacity: 3000 },
            });
        }
        this.engineRoom3D = null;  // 按需加载

        // 注册冷却水系统设备到对象池
        COOLING_SYSTEM_DEVICES.forEach(cfg => this.equipmentPool.register(cfg));

        // 注册 Phase 2 系统设备到对象池
        PHASE2_ALL_DEVICES.forEach(cfg => this.equipmentPool.register(cfg));

        // ── 集中化动画组件列表（替代各组件独立 rAF 循环） ──
        this._animCompIds = Object.keys(this.comps).filter(id => {
            const c = this.comps[id];
            return c && typeof c.tick === 'function';
        });

        //perfMonitor.enabled = true;

        // ── 工具栏温度滑块 ──
        this._initTempSlider();

        this._physicsTimer = setInterval(() => this._updatePhysics(), 1000 / 20);
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
                const did = this.linkingState.portId.split('_wire_')[0] || this.linkingState.portId.split('_')[0];
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
        // 直接触发绘制，不再依赖 renderLoop（已被 _tickAll 替代）
        this.layer.batchDraw();
        this.lineLayer.batchDraw();
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

        // ── 只有存在电气连线时才运行电路求解器 ──
        const hasWires = this.conns.some(c => c.type === 'wire');
        if (hasWires) {
            const startCircuit = performance.now();
            this.voltageSolver.update();
            perfMonitor.recordMetric('circuitSolve', performance.now() - startCircuit);
        }

        // ── 只有存在管路连线时才运行气路求解器 ──
        const hasPipes = this.conns.some(c => c.type === 'pipe');
        if (hasPipes) {
            const startPneumatic = performance.now();
            this.pressSolver.solve();
            perfMonitor.recordMetric('pneumaticSolve', performance.now() - startPneumatic);
        }

        // ── 数字逻辑仿真（同样按需） ──
        const hasDigital = Object.values(this.comps).some(c =>
            c.type && (c.type.startsWith('digital_') || c.type === 'mcu' || c.type === 'mcs51'));
        if (hasDigital) {
            const startDigital = performance.now();
            if (this.digitalSolver) this.digitalSolver.update(1 / 20);
            if (this.mcuSolver) this.mcuSolver.update(1 / 20, 5);
            if (this.mcs51Solver) this.mcs51Solver.update(1 / 20);
            this._updateDigitalLEDs();
            perfMonitor.recordMetric('digitalSolve', performance.now() - startDigital);
        }

        // ── Modbus 网络仿真 ──
        if (this.modbusBus) {
            try { this.modbusBus.update(); }
            catch (e) { console.warn('[consys] Modbus update error:', e); }
        }

        // ── 热力求解 ──
        if (this.thermalSolver) this.thermalSolver.solve(1 / 20);

        // ── 集中化组件动画 tick（20fps，替代各组件独立 rAF 循环） ──
        this._tickAll(1 / 20);

        // ── 状态同步到 3D 场景 ──
        if (this.stateSync) this.stateSync.sync();

        perfMonitor.recordMetric('physicUpdate', performance.now() - startPhysics);
    }

    /**
     * 集中化组件动画 tick — 替代各组件独立的 requestAnimationFrame 循环
     */
    _tickAll(dt) {
        if (!this._animCompIds) return;
        for (let i = 0; i < this._animCompIds.length; i++) {
            const comp = this.comps[this._animCompIds[i]];
            if (comp && comp.tick) comp.tick(dt);
        }
        // 更新缓存后刷新屏幕（20fps 足够平滑）
        this.layer.batchDraw();
        this.lineLayer.batchDraw();
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
     * 按需重绘 — 由 _tickAll（20fps）和 requestRedraw() 共同驱动
     * 不再持有独立的 requestAnimationFrame 循环
     */
    _renderLoop() {
        // 已废弃，绘图由 _tickAll（20fps）统一驱动
    }

    // ── 压力滑块界面 ──
    _initTempSlider() {
        const toolbar = document.getElementById('toolbar');
        const sliderDiv = document.createElement('div');
        sliderDiv.id = 'pressSliderContainer';
        sliderDiv.style.cssText = 'display:inline-flex;align-items:center;gap:6px;margin-left:12px;';
        sliderDiv.innerHTML = `
            <span style="font-size:12px;font-weight:bold;">压力:</span>
            <input type="range" id="pressSlider" min="0" max="100" value="0" style="width:160px;">
            <span id="pressDisplay" style="font-size:12px;min-width:60px;">0.0 kPa</span>
        `;
        toolbar.appendChild(sliderDiv);

        const slider = document.getElementById('pressSlider');
        const display = document.getElementById('pressDisplay');
        slider.addEventListener('input', () => {
            const press = parseFloat(slider.value);
            display.textContent = press.toFixed(1) + ' kPa';
            if (this.comps['bourdon'] && this.comps['bourdon'].applyPressure) {
                this.comps['bourdon'].applyPressure(press);
            }
            if (this.comps['diaphragm'] && this.comps['diaphragm'].applyPressure) {
                const diaphragmPress = Math.min(press, this.comps['diaphragm'].rangeMax);
                this.comps['diaphragm'].applyPressure(diaphragmPress);
            }
            this.requestRedraw();
        });
    }


}
