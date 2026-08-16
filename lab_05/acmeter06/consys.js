import {
    Workflow, CircuitSolver, PneumaticSolver, DigitalSolver, MicrocontrollerSolver,
    MCS51Solver, Show, perfMonitor, EventBus, EquipmentPool, ThermalSolver
} from './export.js';
import {
    LeakDetector, AirBottle, PressRegulator, PressMeter, TeeConnector,
    StopValve, Pump, Cooler, Engine, WaterTankSystem, WaterTankTwoPos,
    WaterTankLevelControl, DiffTransmitter, BubbleLevelTransmitter,
    PIDController, OvenSystem, ElecValve, LVDTPressureSensor, TempTransmitter,
    PressTransmitter, SmartPressTransmitter, Rosemount475, VoltageTransmitter,
    DCPower, DCVoltage, VariResistor, Resistor, OpAmp, Ground, Monitor,
    VoltageRelay, ACPower, Oscilloscope_tri,
    Capacitor, JFET, Diode, RealDiode, Zener, RealZener, LED, RealLED, DIAC, RealDIAC, Photodiode, RealPhotodiode, Phototransistor, RealPhototransistor, Transistor, NpnTempSensor, RealResistor, SCR, RealScr,
    RealVariResistor, CoolingSystem, FuelOilHeater, PressRelay, AudioVisualAlarm,
    NormallyClosedPushButton, NormallyOpenPushButton,
    RealTransistor, IGBT, RealIGBT, Mosfet, RealMosfet,
    IncandescentLamp, RealIncandescentLamp, Triac, RealTriac, Inductor, UJT, RealUJT
} from './export.js';

import { HistoryManager, ConnectionManager, Renderer, UIManager, WorkflowManager, 
    AIModule, AOModule, DIModule, DOModule, CentralComputer, 
    CANBus, createCANSystem, BUSCON } from './export.js';

import {
    WaterBath, RealPT100, RealTC, ThreeValve, StrainCylinderSensor, PneumaticValve,
    AirCompressor, NTCThermistor, NTCtempTransmitter, DigitClampMeter, HallClampMeter,
    DigitMegohmMeter, ThreePhaseMotor,
} from './export.js';

import { AND, OR, NOT, NAND, NOR, XOR, DFlipFlop, JKFlipFlop, ClockGen, 
    Counter, ADC, DAC, MCU, Timer555, MCS51 } from './export.js';

import { CurrentTransformer, ACVoltmeter, PotentialTransformer, SinglePhaseFuse } from './export.js';

import { componentConfigs, initSlider } from './project/multimeter_factor.js';
    
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
            c.type === 'ac_source' || c.type === 'source_3p' || c.type === 'signal_generator');
        this._hasCalibrator = Object.values(this.comps).some(c => c.type === 'calibrator');

        perfMonitor.enabled = true;

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

        // ── 保险丝保护逻辑 ──
        if (hasWires) {
            const comps = this.comps;
            const map   = this.voltageSolver && this.voltageSolver.portToCluster;
            if (map) {
                // ① 电压表端口短接 → FU2 熔断
                const vpC = map.get('volt1_wire_vp');
                const vnC = map.get('volt1_wire_vn');
                if (vpC !== undefined && vnC !== undefined && vpC === vnC) {
                    const fu2 = comps['fu2'];
                    if (fu2 && !fu2.isBlown()) fu2.blow();
                }
                // ② 交流电源电流 > 15A → FU1 熔断
                const ac = comps['ac'];
                if (ac && Math.abs(ac.physCurrent || 0) > 15) {
                    const fu1 = comps['fu1'];
                    if (fu1 && !fu1.isBlown()) fu1.blow();
                }
            }
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
