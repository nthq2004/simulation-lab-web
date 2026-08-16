import { Workflow } from './tools/Workflow.js';  // 流程控制工具
import { CircuitSolver } from './tools/CircuitSolver.js';  // 电路求解工具
import { PneumaticSolver } from './tools/PneumaticSolver.js'; // 气路求解工具
import { Show } from './tools/Show.js'; // 提示展示工具

import { LeakDetector } from './components/LeakDetector.js';
import { AirBottle } from './components/AirBottle.js';
import { PressRegulator } from './components/PressRegulator.js';
import { PressMeter } from './components/PressMeter.js';
import { TeeConnector } from './components/TeeConnector.js';
import { StopValve } from './components/StopValve.js';
import { Pump } from './components/Pump.js';
import { Cooler } from './components/Cooler.js';
import { Engine } from './components/Engine.js';

import { PIDController } from './components/PID.js';
import { OvenSystem } from './components/OvenSystem.js';
import { ElecValve } from './components/ElecValve.js';

import { LVDTPressureSensor } from './components/LVDT.js';
import { TempTransmitter } from './components/TempTransmitter.js';
import { PressTransmitter } from './components/PressTransmitter.js';

import { VoltageTransmitter } from './components/VoltageTransmitter.js';
import { DCPower } from './components/DCPower.js';
import { AmpMeter } from './components/AmpMeter.js';
import { VariResistor } from './components/VariResistor.js';
import { Resistor } from './components/Resistor.js';
import { Multimeter } from './components/Multimeter.js';
import { OpAmp } from './components/OpAmp.js';
import { Ground } from './components/Gnd.js';
import { Monitor } from './components/Monitor.js';

import { Relay } from './components/Relay.js';
import { ACPower } from './components/ACPower.js';
import { Oscilloscope_tri } from './components/Osc_tri.js';
import { Oscilloscope } from './components/Oscilloscope.js';
import { SignalGenerator } from './components/SignalGenerator.js';
import { Capacitor } from './components/Capacitor.js';
import { JFET } from './components/JFET.js';
import { Diode } from './components/Diode.js';
import { Transistor } from './components/Transistor.js';

import { RealVariResistor } from './components/RealVariResistor.js';
import { CoolingSystem } from './components/CoolingSystem.js';

// ── 新拆分的子模块 ──────────────────────────────────────────────
import { HistoryManager } from './lib/HistoryManager.js';
import { ConnectionManager } from './lib/ConnectionManager.js';
import { Renderer } from './lib/Renderer.js';
import { UIManager } from './lib/UIManager.js';
import { WorkflowManager } from './lib/WorkflowManager.js';

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

        // 4. 流程控制、电路求解、气路求解
        this.stepsArray = [];
        this.workflowComp = null;
        this.voltageSolver = null;
        this.pressSolver = null;
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

        this._applyStaticCaching();
        this.layer.draw();

        this.workflowComp = new Workflow(this);
        this.voltageSolver = new CircuitSolver(this);
        this.pressSolver = new PneumaticSolver(this);
        this.showComp = new Show(this);
        
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
     */
    _updatePhysics() {
        this._physicsIterCount++;
        this.voltageSolver.update();
        this.pressSolver.solve();
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
     * 按需重绘循环 (RequestAnimationFrame，跟随浏览器 UI 刷新)
     */
    _renderLoop() {
        if (this._needsRedraw) {
            this.layer.batchDraw();
            this.lineLayer.batchDraw();
            this._needsRedraw = false;
        }
        requestAnimationFrame(() => this._renderLoop());
    }
}
