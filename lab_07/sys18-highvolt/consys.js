import {
    Workflow, CircuitSolver, PneumaticSolver, DigitalSolver, MicrocontrollerSolver,
    MCS51Solver, Show, perfMonitor, EventBus, EquipmentPool, ThermalSolver,
    DeviceManager
} from './export.js';
import {
    LeakDetector, AirBottle, PressRegulator, PressMeter, TeeConnector,
    StopValve, Pump, Cooler, Engine, WaterTankSystem, WaterTankTwoPos,
    WaterTankLevelControl, DiffTransmitter, BubbleLevelTransmitter,
    PIDController, OvenSystem, ElecValve, LVDTPressureSensor, TempTransmitter,
    PressTransmitter, SmartPressTransmitter, Rosemount475, VoltageTransmitter,
    DCPower, DCVoltage, VariResistor, Resistor, OpAmp, Ground, Monitor,
    VoltageRelay, ACPower, ACPower3P, DiagramACPower3P, Oscilloscope_tri,
    Capacitor, JFET, Diode, RealDiode, Zener, RealZener, LED, RealLED, DIAC, RealDIAC, Photodiode, RealPhotodiode, Phototransistor, RealPhototransistor, Transistor, NpnTempSensor, RealResistor, SCR, RealScr,
    RealVariResistor, CoolingSystem, CoolingSys, FuelOilHeater, PressRelay, AudioVisualAlarm, JSZ3, JSZ3N,
    RealTransistor, IGBT, RealIGBT, Mosfet, RealMosfet,
    IncandescentLamp, RealIncandescentLamp, Triac, RealTriac, Inductor, UJT, RealUJT,
    IC7805, ThreePhaseContactor, DiscElectromagneticBrake, FeelerGauge, ThreePhaseACB, DiagramThreePhaseACB,
    MarineMainsSwitch, VacuumCircuitBreaker, MarineHVGenerator, MarineElectronicTrip, GeneratorRemotePanel, HvGenRemotePanel, HvGenProtection, DiagramStartButton, DiagramStopButton,
    EmergencyPanel,
    ShipAutoControl, ThreePhaseLoad, HvThreePhaseLoad, SimpleVCB, SimpleHVGenerator, HvTransformer, HvPowerOneLine, HvSwitchPanel, HvTester, HvGroundMonitor, HvDischargeRod, HvGroundingCable,
    Syncroscope, SP4TSwitch,
    UPS
} from './export.js';

import { HistoryManager, ConnectionManager, Renderer, UIManager, WorkflowManager, 
    AIModule, AOModule, DIModule, DOModule, CentralComputer, 
    CANBus, createCANSystem, BUSCON } from './export.js';

import {
    WaterBath, RealPT100, RealTC, ThreeValve, StrainCylinderSensor, PneumaticValve,
    AirCompressor, NTCThermistor, NTCtempTransmitter, DigitClampMeter, HallClampMeter,
    DigitMegohmMeter, RealMegohmMeter, Megohmmeter, ThreePhaseMotor, MotorTerminalBox, TsCurveDisplay, InductionMotor,
} from './export.js';

import { AND, OR, NOT, NAND, NOR, XOR, DFlipFlop, JKFlipFlop, ClockGen, 
    Counter, ADC, DAC, MCU, Timer555, MCS51 } from './export.js';

import { CurrentTransformer, ACVoltmeter, PotentialTransformer, SinglePhaseFuse, NiMHBattery, RealControlTransformer, Switch } from './export.js';

import { DistributionBox, ShorePowerMainSwitch, ShorePowerBox, NegativeSeqRelay } from './export.js';

import { componentConfigs, initSlider } from './project/sys_ljdq6-1.js';
    
/**
 * ControlSystem - 控制系统仿真引擎
 * 负责组件管理、物理计算、自动/手动连线逻辑及渲染更新
 * 各功能细节委托给子模块处理
 */
export class ControlSystem {
    /**
     * @param {Object} options
     * @param {boolean} [options.gateway=false]  是否启用硬件网关功能
     */
    constructor(options = {}) {
        this._options = options;

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
        this._consecutiveStableFrames = 0;

        // 5b. 多选与组拖拽状态
        this.selectedCompIds = new Set();
        this._selRectStart = null;
        this._selectionRect = null;
        this._dragStartPositions = {};
        this._dragGroupId = null;
        this._lastPointerPos = null;

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

        const scaledConfigs = componentConfigs.map(cfg => ({
            ...cfg,
            x: cfg.x * scale + offsetX,
            y: cfg.y * scale + offsetY,
        }));

        const visibilityMap = {}; // 存储需要隐藏的组件

        scaledConfigs.forEach(cfg => {
            if (cfg.visible === false) {
                visibilityMap[cfg.id] = false;
                delete cfg.visible; // 移除 visible 参数，让组件正常初始化
            }

            this.comps[cfg.id] = new cfg.Class(cfg, this);
            this.layer.add(this.comps[cfg.id].group);

            // 为每个组件添加组拖拽事件
            const g = this.comps[cfg.id].group;
            g.on('dragstart', () => this._onDragStart(cfg.id));
            g.on('dragmove', () => this._onDragMove(cfg.id));
            g.on('dragend', () => this._onDragEnd());
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

        // ── 事件总线与设备对象池 ──
        this.eventBus = new EventBus();
        this.equipmentPool = new EquipmentPool();
        this.thermalSolver = new ThermalSolver(this);

        // ── 复合设备管理器 ──
        this.deviceManager = new DeviceManager(this);
        Object.values(this.comps).forEach(comp => {
            const deviceid = comp.config?.deviceid;
            const DeviceClass = comp.constructor?.DeviceClass;
            if (deviceid && DeviceClass) {
                comp.deviceRef = this.deviceManager.getOrCreate(deviceid, DeviceClass);
            }
        });
        // ── 硬件网关（可选，由 main.js 按需初始化 ──
        this.gatewayController = null;

        // ── 集中化动画组件列表（替代各组件独立 rAF 循环） ──
        this._animCompIds = Object.keys(this.comps).filter(id => {
            const c = this.comps[id];
            return c && typeof c.tick === 'function';
        });

        // ── LED 更新组件缓存（避免每帧遍历所有组件） ──
        this._ledCompIds = Object.keys(this.comps).filter(id => {
            const c = this.comps[id];
            return c && typeof c.updateLED === 'function';
        });

        // ── 静态布尔缓存（组件类型构造后不变，避免每帧 Object.values().some()） ──
        this._hasDigital = Object.values(this.comps).some(c =>
            c.type && (c.type.startsWith('digital_') || c.type === 'mcu' || c.type === 'mcs51'));
        this._hasACSource = Object.values(this.comps).some(c =>
            c.type === 'ac_source' || c.type === 'source_3p' || c.type === 'signal_generator' || c.type === 'ups');
        this._hasCalibrator = Object.values(this.comps).some(c => c.type === 'calibrator');

        perfMonitor.enabled = false;

        // ── 工具栏滑块（由项目配置实现）──
        initSlider(this);
        this._scheduleNextPhysics();
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
        // ── 连线虚线预览 ──
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

        // ── 舞台 mousemove（橡胶框选更新 + 指针记录）──
        this.stage.on('mousemove', () => {
            const pos = this.stage.getPointerPosition();
            this._lastPointerPos = pos;
            if (!this._selectionRect || !this._selRectStart) return;
            const x = Math.min(this._selRectStart.x, pos.x);
            const y = Math.min(this._selRectStart.y, pos.y);
            const w = Math.abs(pos.x - this._selRectStart.x);
            const h = Math.abs(pos.y - this._selRectStart.y);
            this._selectionRect.x(x);
            this._selectionRect.y(y);
            this._selectionRect.width(w);
            this._selectionRect.height(h);
            this.lineLayer.batchDraw();
        });

        // ── 舞台 mousedown（选中 / 橡胶框选开始）──
        this.stage.on('mousedown', (e) => {
            const targetNode = this._findCompGroup(e.target);
            if (targetNode) {
                const compId = targetNode.id();
                // 端口等已设 cancelBubble 的内部节点不会走到分支，
                // 但直接点击组件主体（空白区）会进入这里。
                // 选中逻辑在 mouseup 中统一处理，避免干扰拖拽启动。
                return;
            }
            // 点击空白区域 → 开始橡胶框选
            this.deselectAll();
            const pos = this.stage.getPointerPosition();
            this._selRectStart = { x: pos.x, y: pos.y };
            this._selectionRect = new Konva.Rect({
                x: pos.x, y: pos.y,
                width: 0, height: 0,
                stroke: '#3498db',
                strokeWidth: 1.5,
                dash: [6, 3],
                fill: 'rgba(52, 152, 219, 0.1)',
                name: 'selection-rubber',
                listening: false,
            });
            this.lineLayer.add(this._selectionRect);
        });

        // ── 舞台 mouseup（仅用于橡胶框选结束）──
        this.stage.on('mouseup', () => {
            if (!this._selectionRect || !this._selRectStart) return;
            const pos = this._lastPointerPos || this.stage.getPointerPosition();
            const rect = {
                x: Math.min(this._selRectStart.x, pos.x),
                y: Math.min(this._selRectStart.y, pos.y),
                width: Math.abs(pos.x - this._selRectStart.x),
                height: Math.abs(pos.y - this._selRectStart.y),
            };
            this._selectionRect.destroy();
            this._selectionRect = null;
            this._selRectStart = null;
            if (rect.width > 5 && rect.height > 5) {
                for (const id in this.comps) {
                    const group = this.comps[id].group;
                    if (!group.visible()) continue;
                    const bounds = group.getClientRect();
                    if (this._rectsIntersect(rect, bounds)) {
                        this.selectedCompIds.add(id);
                        this.comps[id].setSelected(true);
                    }
                }
                this.requestRedraw();
            }
        });

        // ── 舞台 click（组件选中/取消选中）──
        this.stage.on('click', (e) => {
            // 橡胶框选中正在进行时不处理
            if (this._selectionRect) return;
            const targetNode = this._findCompGroup(e.target);
            if (targetNode) {
                const compId = targetNode.id();
                this.lastClickedId = compId;
                if (e.evt.ctrlKey || e.evt.metaKey) {
                    if (this.selectedCompIds.has(compId)) {
                        this.selectedCompIds.delete(compId);
                        this.comps[compId].setSelected(false);
                    } else {
                        this.selectedCompIds.add(compId);
                        this.comps[compId].setSelected(true);
                    }
                } else {
                    if (!this.selectedCompIds.has(compId) || this.selectedCompIds.size > 1) {
                        this.deselectAll();
                        this.selectedCompIds.add(compId);
                        this.comps[compId].setSelected(true);
                    }
                }
                this.requestRedraw();
            }
        });

        // ── 系统右键菜单 ──
        this.stage.on('contextmenu', (e) => {
            e.evt.preventDefault();
            e.evt.stopPropagation();
            if (e.target === this.stage || e.target.name() === 'background-rect') {
                this.uiMgr.showSystemContextMenu(e.evt);
            }
        });

        // ── 全局右键 / Escape ──
        window.addEventListener('contextmenu', (e) => { e.preventDefault(); this.connMgr.resetLinking(); });
        window.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.connMgr.resetLinking(); });

        // ── 键盘快捷键 ──
        window.addEventListener('keydown', (e) => {
            if (e.key === 'Delete') {
                if (this.selectedCompIds.size > 0) {
                    e.preventDefault();
                    this.deleteSelected();
                }
            }
            if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
                e.preventDefault();
                this.selectAll();
            }
            if (e.key === 'Escape') {
                this.deselectAll();
            }
        });
    }

    /**
     * 从 Konva 事件目标向上遍历找到所属的组件 Group
     */
    _findCompGroup(target) {
        let node = target;
        while (node && node !== this.stage) {
            if (node.id && node.id() && this.comps[node.id()]) return node;
            node = node.getParent();
        }
        return null;
    }

    /**
     * 矩形相交检测（用于橡胶框选）
     */
    _rectsIntersect(r1, r2) {
        return !(r2.x > r1.x + r1.width ||
                 r2.x + r2.width < r1.x ||
                 r2.y > r1.y + r1.height ||
                 r2.y + r2.height < r1.y);
    }

    /**
     * 取消所有选中
     */
    deselectAll() {
        for (const id of this.selectedCompIds) {
            const comp = this.comps[id];
            if (comp) comp.setSelected(false);
        }
        this.selectedCompIds.clear();
        this.requestRedraw();
    }

    /**
     * 全选所有可见组件
     */
    selectAll() {
        this.deselectAll();
        for (const id in this.comps) {
            const comp = this.comps[id];
            if (comp.group && comp.group.visible()) {
                this.selectedCompIds.add(id);
                comp.setSelected(true);
            }
        }
        this.requestRedraw();
    }

    /**
     * 删除选中组件及其连线（可撤销）
     */
    deleteSelected() {
        if (this.selectedCompIds.size === 0) return;
        const ids = [...this.selectedCompIds];
        this.deselectAll();
        const sys = this;

        // ── 保存快照：组件 config、类引用、关联连线 ──
        const deletedComps = ids.map(id => {
            const comp = sys.comps[id];
            if (!comp) return null;
            return {
                config: {
                    ...comp.config,
                    x: comp.group.x(),
                    y: comp.group.y(),
                },
                Class: comp.constructor,
            };
        }).filter(Boolean);

        const allConns = sys.conns.filter(c => {
            const fromId = c.from && (c.from.split('_wire_')[0] || c.from.split('_')[0]);
            const toId   = c.to   && (c.to.split('_wire_')[0]   || c.to.split('_')[0]);
            return ids.includes(fromId) || ids.includes(toId);
        });

        const action = {
            do() {
                deletedComps.forEach(({ config }) => {
                    const comp = sys.comps[config.id];
                    if (comp) {
                        comp.group.destroy();
                        delete sys.comps[config.id];
                    }
                    // 从 _animCompIds / _ledCompIds 中移除
                    const idxA = sys._animCompIds.indexOf(config.id);
                    if (idxA !== -1) sys._animCompIds.splice(idxA, 1);
                    const idxL = sys._ledCompIds.indexOf(config.id);
                    if (idxL !== -1) sys._ledCompIds.splice(idxL, 1);
                });
                sys.conns = sys.conns.filter(c => {
                    const fromId = c.from && (c.from.split('_wire_')[0] || c.from.split('_')[0]);
                    const toId   = c.to   && (c.to.split('_wire_')[0]   || c.to.split('_')[0]);
                    return !ids.includes(fromId) && !ids.includes(toId);
                });
                sys.renderer.redrawAll();
                sys.requestRedraw();
            },
            undo() {
                deletedComps.forEach(({ config, Class }) => {
                    const comp = new Class(config, sys);
                    sys.layer.add(comp.group);
                    const g = comp.group;
                    g.on('dragstart', () => sys._onDragStart(config.id));
                    g.on('dragmove',  () => sys._onDragMove(config.id));
                    g.on('dragend',   () => sys._onDragEnd());
                    sys.comps[config.id] = comp;
                    // 恢复 _animCompIds / _ledCompIds 注册
                    if (typeof comp.tick === 'function' && !sys._animCompIds.includes(config.id)) {
                        sys._animCompIds.push(config.id);
                    }
                    if (typeof comp.updateLED === 'function' && !sys._ledCompIds.includes(config.id)) {
                        sys._ledCompIds.push(config.id);
                    }
                });
                // 恢复静态缓存
                sys._applyStaticCaching();
                allConns.forEach(c => sys.conns.push(c));
                sys.renderer.redrawAll();
                sys.requestRedraw();
            }
        };

        // 由 history.do 内部调用 action.do() 执行实际删除
        sys.history.do(action);
    }

    /**
     * 组拖拽：拖拽开始时记录所有选中组件的起始位置
     */
    _onDragStart(compId) {
        if (this.selectedCompIds.size < 2) return;
        this._dragStartPositions = {};
        for (const id of this.selectedCompIds) {
            const g = this.comps[id].group;
            this._dragStartPositions[id] = { x: g.x(), y: g.y() };
        }
        this._dragGroupId = compId;
    }

    /**
     * 组拖拽：拖拽移动时同步移动其他选中组件
     */
    _onDragMove(compId) {
        if (this._dragGroupId !== compId || this.selectedCompIds.size < 2) return;
        const draggedGroup = this.comps[compId].group;
        const startPos = this._dragStartPositions[compId];
        if (!startPos) return;
        const dx = draggedGroup.x() - startPos.x;
        const dy = draggedGroup.y() - startPos.y;
        if (dx === 0 && dy === 0) return;
        for (const id of this.selectedCompIds) {
            if (id === compId) continue;
            const g = this.comps[id].group;
            const sp = this._dragStartPositions[id];
            if (sp) {
                g.x(sp.x + dx);
                g.y(sp.y + dy);
            }
        }
        this.renderer.updateLinePositions();
        this.requestRedraw();
    }

    /**
     * 组拖拽结束：清理状态
     */
    _onDragEnd() {
        this._dragStartPositions = {};
        this._dragGroupId = null;
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

        // ── 只有存在电气连线时才运行电路求解器 ──
        // 但有过程校验仪时也运行（校验仪气压显示依赖电路求解）
        const hasWires = this.conns.some(c => c.type === 'wire');
        if (hasWires || this._hasCalibrator) {
            // 自适应求解：稳态时降低求解频率（节省 CPU）
            // 连续稳定 >10 帧 → 每 2 帧求解 1 次
            const stableFrame = this._consecutiveStableFrames;
            // 有交流源时不跳帧（波形需每帧更新）
            const shouldSkip = !this._hasACSource && stableFrame > 10 && (stableFrame % 2 === 0);

            if (!shouldSkip) {
                const startCircuit = performance.now();
                this.voltageSolver.update();
                perfMonitor.recordMetric('circuitSolve', performance.now() - startCircuit);

                // 根据迭代次数更新稳定性计数
                if (this.voltageSolver.lastIterCount < 5) {
                    this._consecutiveStableFrames++;
                } else {
                    this._consecutiveStableFrames = 0;
                }
            } else {
                this._consecutiveStableFrames++;
            }
        } else {
            this._consecutiveStableFrames = 0;
        }

        // ── 只有存在管路连线时才运行气路求解器 ──
        const hasPipes = this.conns.some(c => c.type === 'pipe');
        if (hasPipes) {
            const startPneumatic = performance.now();
            this.pressSolver.solve();
            perfMonitor.recordMetric('pneumaticSolve', performance.now() - startPneumatic);
        }

        // ── 数字逻辑仿真（同样按需） ──
        if (this._hasDigital) {
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
        {
            const start = performance.now();
            if (this.thermalSolver) this.thermalSolver.solve(1 / 20);
            perfMonitor.recordMetric('thermalSolve', performance.now() - start);
        }

        // ── 复合设备更新（preUpdate + commit） ──
        if (this.deviceManager) {
            this.deviceManager.tick(1 / 20);
        }

        // ── 集中化组件动画 tick（20fps，替代各组件独立 rAF 循环） ──
        {
            const start = performance.now();
            this._tickAll(1 / 20);
            perfMonitor.recordMetric('tickAll', performance.now() - start);
        }

        perfMonitor.recordMetric('physicUpdate', performance.now() - startPhysics);

        // 自调度下一次物理更新（替代 setInterval，避免 Violation 告警）
        this._physicsTimer = setTimeout(() => this._scheduleNextPhysics(), 50);
    }

    /**
     * 自调度物理循环入口：每次 tick 结束后调度下一次
     * 替代原来的 setInterval，避免浏览器 Violation 警告
     * （setInterval 在回调超时时会累积告警，setTimeout 无此问题）
     */
    _scheduleNextPhysics() {
        this._updatePhysics();
    }

    /**
     * 集中化组件动画 tick — 替代各组件独立的 requestAnimationFrame 循环
     */
    _tickAll(dt) {
        if (!this._animCompIds) return;

        for (let i = 0; i < this._animCompIds.length; i++) {
            const comp = this.comps[this._animCompIds[i]];
            if (comp && comp.tick) {
                comp.tick(dt);
            }
        }
        if (this._needsRedraw) {
            this._needsRedraw = false;
            // perform synchronous draw during physics tick to move heavy work
            // out of requestAnimationFrame handler (accept longer tick time)
            try {
                this.layer.draw();
                this.lineLayer.draw();
            } catch (e) {
                // fallback to batchDraw if synchronous draw fails
                this.layer.batchDraw();
                this.lineLayer.batchDraw();
            }
        }
    }


    /**
     * 更新所有数字组件的 LED 指示灯
     */
    _updateDigitalLEDs() {
        for (let i = 0; i < this._ledCompIds.length; i++) {
            const comp = this.comps[this._ledCompIds[i]];
            if (comp) comp.updateLED();
        }
    }

    /**
     * 静态组件 Canvas 缓存策略
     */
    _applyStaticCaching() {
        Object.values(this.comps).forEach(comp => {
            if (comp.cache === 'fixed') {
                const target = comp._staticGroup || comp.group;
                if (target && target.cache) {
                    const box = target.getClientRect({ relativeTo: target });
                    if (box && box.width > 0 && box.height > 0) {
                        target.cache({ x: box.x, y: box.y, width: Math.ceil(box.width), height: Math.ceil(box.height) });
                    }
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
            { id: 'elecmeter', name: '数字功率计', compId: 'elecmeter' },
            { id: 'mf47', name: '指针万用表', compId: 'mf47-panel' },
            { id: 'multimeter', name: '数字万用表', compId: 'multimeter' },
            { id: 'sg', name: '信号发生器', compId: 'sg' },
            { id: 'cali', name: '过程校验仪', compId: 'cali' },
            { id: 'osc', name: '三路示波器', compId: 'osc' },
            { id: 'megohm', name: '手摇兆欧表', compId: 'megohm' },
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
            comp.group.listening(true);

            if (visible) {
                // 从隐藏→显示时重新缓存静态层，否则已缓存的位图可能不渲染
                if (comp.cache === 'fixed' && comp._staticGroup) {
                    const box = comp._staticGroup.getClientRect({ relativeTo: comp._staticGroup });
                    comp._staticGroup.clearCache();
                    if (box && box.width > 0 && box.height > 0) {
                        comp._staticGroup.cache({ x: box.x, y: box.y, width: Math.ceil(box.width), height: Math.ceil(box.height) });
                    }
                }
                this.stage.draw();
            }

            this.requestRedraw();
        }
    }
}
