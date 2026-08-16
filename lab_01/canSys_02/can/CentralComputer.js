/**
 * CentralComputer.js — 中央监控计算机（主入口）
 * 船舶机舱监测报警系统 · CAN 总线架构
 *
 * 页面列表：
 *   [0] 报警页面      — 报警列表、确认、消音
 *   [1] 参数显示页面  — AI / AO / DI / DO 实时值 (4块)
 *   [2] 网络诊断页面  — CAN 总线、节点状态、通信统计
 *   [3] AI 设置页面   — 通道模式、报警阈值、工程量
 *   [4] AO 设置页面   — 自动/手动切换、强制输出
 *   [5] DI 设置页面   — 自动/手动切换、滑块调整
 *   [6] DO 设置页面   — 计数、防抖、门限配置
 *   [7] 液位双位控制画面
 *   [8] 温度控制画面
 *
 * 模块结构：
 *   constants.js      — 尺寸常量、配色系统、标签列表
 *   uiHelpers.js      — mkBtn / mkToggle 工厂函数
 *   shellAndTabs.js   — 外壳绘制、标签栏、页面容器与切换
 *   pageBuilders.js   — 各页面一次性构建函数（_buildXxxPage）
 *   pageRenderers.js  — 各页面每 tick 刷新函数（_renderXxxPage）
 *   canBusHandler.js  — CAN 接收/发送、NMT 管理、参数查询
 *   simulation.js     — 液位仿真、温度仿真
 *   alarmSystem.js    — 报警检测、触发、闪烁
 *   dialogs.js        — AI 量程/阈值 DOM 弹窗
 */

import { BaseComponent } from '../components/BaseComponent.js';
import { NMT_CMD, NMT_STATE } from './CANBUS.js';

import { W, H, C } from './cc/constants.js';

import { drawShell, drawTabs, switchPage, buildPageContainers, refreshTabs } from './cc/shellAndTabs.js';

import {
    buildAlarmPage, buildParamPage, buildNetworkPage, buildAISetPage,
    buildAOPage, buildDISetPage, buildDOPage, buildLevelPage, buildTempPage
} from './cc/pageBuilders.js';

import {
    renderAlarmPage, renderParamPage, renderNetworkPage, renderAISetPage,
    renderAOPage, renderDISetPage, renderDOPage, renderLevelPage, renderTempPage
} from './cc/pageRenderers.js';

import {
    onCanReceive, canHandleAIReport, canHandleAIReply, canHandleAOStatus,
    canHandleAOReply, canHandleDIReport, canHandleDIReply, canHandleDOStatus,
    canHandleDOReply, canSendAOCommand, canSendDOCommand, canSendNMT,
    startAllNodes, stopAllNodes, resetAllNodes, sendNMTCommand,
    requestNodeConfig, initAIParams, initAOParams, initDIParams, initDOParams
} from './cc/canBusHandler.js';

import { simLevel, simTemp } from './cc/simulation.js';
import { processAlarms } from './cc/alarmSystem.js';
import { openRangeEditor, openAlarmEditor } from './cc/dialogs.js';

// ─────────────────────────────────────────────
//  主类
// ─────────────────────────────────────────────
export class CentralComputer extends BaseComponent {

    constructor(config, sys) {
        super(config, sys);

        this.w = W;
        this.h = H + 30;
        this.scale = 1.5;
        this.type = 'CentralComputer';
        this.cache = 'fixed';

        this.commFault = false;
        this.busConnected = false;

        // 当前激活的页面索引
        this.activePage = 7;

        // ── 系统数据快照 ──────────────────────────
        this.data = {
            ai: {
                ch1: { value: 0, fault: false, faultText: 'normal', alarm: 'normal', unit: 'bar' },
                ch2: { value: 0, fault: false, faultText: 'normal', alarm: 'normal', unit: 'MPa' },
                ch3: { value: 0, fault: false, faultText: 'normal', alarm: 'normal', unit: '°C' },
                ch4: { value: 0, fault: false, faultText: 'normal', alarm: 'normal', unit: '°C' },
            },
            ao: {
                ch1: { type: '4-20mA', percent: 0, actual: 4.0, fault: false, hold: false, mode: 'disable', lrv: 0, urv: 100 },
                ch2: { type: '4-20mA', percent: 0, actual: 4.0, fault: false, hold: false, mode: 'disable', lrv: 0, urv: 100 },
                ch3: { type: 'PWM', percent: 0, actual: 0, fault: false, hold: false, mode: 'disable', lrv: 0, urv: 100 },
                ch4: { type: 'PWM', percent: 0, actual: 0, fault: false, hold: false, mode: 'disable', lrv: 0, urv: 100 },
            },
            di: {
                ch1: { state: false, fault: false, alarm: false, counter: 0, trigger: 'NONE' },
                ch2: { state: false, fault: false, alarm: false, counter: 0, trigger: 'NONE' },
                ch3: { state: false, fault: false, alarm: false, counter: 0, trigger: 'NONE' },
                ch4: { state: false, fault: false, alarm: false, counter: 0, trigger: 'NONE' },
            },
            do: {
                ch1: { state: false, fault: false, hold: false, mode: 'hand', pulse: { onMs: 500, offMs: 500, phaseMs: 0 }, safeMode: 'off', presetState: false },
                ch2: { state: false, fault: false, hold: false, mode: 'hand', pulse: { onMs: 500, offMs: 500, phaseMs: 0 }, safeMode: 'off', presetState: false },
                ch3: { state: false, fault: false, hold: false, mode: 'hand', pulse: { onMs: 500, offMs: 500, phaseMs: 0 }, safeMode: 'off', presetState: false },
                ch4: { state: false, fault: false, hold: false, mode: 'hand', pulse: { onMs: 500, offMs: 500, phaseMs: 0 }, safeMode: 'off', presetState: false },
            },
        };

        // ── 手动控制 ──────────────────────────────
        this.doManual = { ch1: false, ch2: false, ch3: false, ch4: false };
        this.doManualState = { ch1: false, ch2: false, ch3: false, ch4: false };
        this.aoManual = { ch1: false, ch2: false, ch3: false, ch4: false };
        this.aoManualVal = { ch1: 0, ch2: 0, ch3: 0, ch4: 0 };

        // ── 报警系统 ──────────────────────────────
        this.activeAlarms = [];
        this.alarmIdCounter = 0;
        this.flashState = true;
        this.faultTimers = {};
        this.alarmDelay = 3000;
        this.maxAlarmLines = 18;

        // ── 液位双位控制 ──────────────────────────
        this.levelCtrl = {
            level: 45, setHH: 80, setH: 70, setL: 30, setLL: 20,
            inletOn: false, simMode: true,drainOn:true,switchOn:false,
        };
        this._levelTrendHistory = [];

        // ── 温度控制 ──────────────────────────────
        this.tempCtrl = {
            pv: 25, sv: 60, out: 0, mode: 'AUTO',
            history: [], maxHist: 200,
        };

        // ── CAN 总线运行时状态 ────────────────────
        this.nodeAddress = 0;
        this._canNodeLastSeen = {};
        this._diPrevState = {};

        // ── NMT 网络管理 ──────────────────────────
        this.nmtNodeStates = { ai: 'init', ao: 'init', di: 'init', do: 'init' };
        this.nodeConfigs = {
            ai: { channels: {}, ranges: {}, alarms: {}, lastupdated: 0, available: false, pending: false },
            ao: { channels: {}, lastupdated: 0, available: false, pending: false },
            di: { channels: {}, lastupdated: 0, available: false, pending: false },
            do: { channels: {}, lastupdated: 0, available: false, pending: false },
        };

        // ── 心跳 ──────────────────────────────────
        this._heartbeatRunning = false;
        this.heartbeatIntervalMs = (config?.heartbeatIntervalMs) ?? 1000;

        // ── NMT 自动启动序列 ──────────────────────
        this.nmtStartSequence = null;
        this.nmtAutoStart = true;
        this.nmtAutoStartDelay = 2000;

        this._initPorts();
        this._initVisuals();
        this._startLoop();
    }

    // ══════════════════════════════════════════
    //  界面初始化
    // ══════════════════════════════════════════
    _initVisuals() {
        this.sg = new Konva.Group({ scaleX: this.scale, scaleY: this.scale });
        this.group.add(this.sg);
        drawShell(this);
        drawTabs(this);
        this._buildPages();
    }

    _buildPages() {
        buildPageContainers(this);
        buildAlarmPage(this);     // 0: 报警列表
        buildParamPage(this);     // 1: 参数一览
        buildNetworkPage(this);   // 2: 网络诊断
        buildAISetPage(this);     // 3: AI 设置
        buildAOPage(this);        // 4: AO 设置
        buildDISetPage(this);     // 5: DI 设置
        buildDOPage(this);        // 6: DO 设置
        buildLevelPage(this);     // 7: 液位控制
        buildTempPage(this);      // 8: 温度控制
    }

    // ══════════════════════════════════════════
    //  端口注册
    // ══════════════════════════════════════════
    _initPorts() {
        this.addPort(50 * this.scale, (H + 32) * this.scale, 'can1p', 'wire', 'p');
        this.addPort(100 * this.scale, (H + 32) * this.scale, 'can1n', 'wire');
        this.addPort((this.w - 100) * this.scale, (H + 32) * this.scale, 'can2p', 'wire', 'p');
        this.addPort((this.w - 50) * this.scale, (H + 32) * this.scale, 'can2n', 'wire');
    }

    // ══════════════════════════════════════════
    //  主循环
    // ══════════════════════════════════════════
    _startLoop() {
        this._loopTimer = setInterval(() => this._tick(), 100);
        this._flashTimer = setInterval(() => { this.flashState = !this.flashState; }, 500);

        if (this.nmtAutoStart) {
            this.nmtStartSequence = setTimeout(() => this._startAllNodes(), this.nmtAutoStartDelay);
        }
    }

    /**
     * 主心跳函数（每 100ms 调用）
     * 1. 更新时钟
     * 2. 检测总线连接状态
     * 3. 拉取模块数据 & 发送下行帧
     * 4. 物理过程仿真
     * 5. 报警处理
     * 6. 页面渲染分发
     * 7. 刷新状态栏
     */
    _tick() {
        // 1. 时钟
        this._clockText.text(new Date().toTimeString().slice(0, 8));

        // 2. 总线连接检测
        try {
            this.busConnected = this.sys.isPortConnected(`${this.id}_wire_can1p`, 'can_wire_can1p')
                && this.sys.isPortConnected(`${this.id}_wire_can1n`, 'can_wire_can1n');
            if (this.busConnected && !this.commFault) this.sys.canBus.setNodeOnline(this.id);
            else this.sys.canBus.resetNodeOnline(this.id);
        } catch (_) {
            this.busConnected = false;
        }

        // 心跳广播管理（上升沿启动，下降沿停止）
        try {
            const bus = this.sys?.canBus;
            if (this.busConnected && bus && !this._heartbeatRunning) {
                bus.startHeartbeat(this.id, this.heartbeatIntervalMs);
                this._heartbeatRunning = true;
                console.log('[CC] CAN heartbeat started');
            } else if (!this.busConnected && this._heartbeatRunning && bus) {
                bus.stopHeartbeat();
                this._heartbeatRunning = false;
                console.log('[CC] CAN heartbeat stopped');
            }
        } catch (_) { }

        // 3. 数据拉取 & 状态栏更新
        this._pullModuleData();

        // 4. 物理仿真
        simLevel(this);
        simTemp(this);

        // 5. 报警处理
        processAlarms(this);

        // 6. 页面渲染分发
        switch (this.activePage) {
            case 0: renderAlarmPage(this); break;
            case 1: renderParamPage(this); break;
            case 2: renderNetworkPage(this); break;
            case 3: renderAISetPage(this); break;
            case 4: renderAOPage(this); break;
            case 5: renderDISetPage(this); break;
            case 6: renderDOPage(this); break;
            case 7: renderLevelPage(this); break;
            case 8: renderTempPage(this); break;
        }

        // 7. 状态栏报警计数
        const uc = this.activeAlarms.filter(a => !a.confirmed).length;
        this._alarmCountText.text(uc > 0 ? `报警: ${uc} 条未确认` : '报警: 无');
        this._alarmCountText.fill(uc > 0 ? C.red : C.textDim);

        this._refreshCache();
    }

    // ══════════════════════════════════════════
    //  数据拉取（每 tick）
    // ══════════════════════════════════════════
    _pullModuleData() {
        this._canSendAOCommand();
        this._canSendDOCommand();        
        const now = Date.now();
        const TIMEOUT = 2000;

        const nodeMap = {
            1: { label: 'AI', dataKey: 'ai', keys: ['ch1', 'ch2', 'ch3', 'ch4'] },
            2: { label: 'AO', dataKey: 'ao', keys: ['ch1', 'ch2', 'ch3', 'ch4'] },
            3: { label: 'DI', dataKey: 'di', keys: ['ch1', 'ch2', 'ch3', 'ch4'] },
            4: { label: 'DO', dataKey: 'do', keys: ['ch1', 'ch2', 'ch3', 'ch4'] },
        };

        const onlineNodes = [];
        const offlineNodes = [];

        Object.entries(nodeMap).forEach(([addrStr, meta]) => {
            const addr = parseInt(addrStr);
            const lastSeen = this._canNodeLastSeen[addr] || 0;
            const timeout = lastSeen > 0 && (now - lastSeen) > TIMEOUT;
            const neverSeen = lastSeen === 0;

            if (timeout) {
                offlineNodes.push(meta.label);
                meta.keys.forEach(id => {
                    const ch = this.data[meta.dataKey][id];
                    if (ch) {
                        ch.fault = true;
                        ch.hold = true;
                    }
                });
            } else if (!neverSeen) {
                onlineNodes.push(meta.label);
                meta.keys.forEach(id => {
                    const ch = this.data[meta.dataKey][id];
                    if (ch && ch.hold) ch.hold = false;
                });
            }
        });

        // 更新底部状态栏
        const busOff = this.sys?.canBus?.isBusOff?.() ?? false;
        if (busOff || !this.busConnected) {
            this._statusText.text('✖ CAN BUS OFF');
            this._statusText.fill(C.red);
        } else if (offlineNodes.length > 0) {
            this._statusText.text(`⚠ CAN: ${offlineNodes.join('·')} 超时`);
            this._statusText.fill(C.red);
            this._nodeText.text(`NODE: ${onlineNodes.join('·') || '无在线节点'}`);
            this._nodeText.fill(C.yellow);
        } else if (onlineNodes.length > 0) {
            this._statusText.text('● CAN BUS ONLINE');
            this._statusText.fill(C.green);
            this._nodeText.text(`NODE: ${onlineNodes.join('·')}`);
            this._nodeText.fill(C.green);
        } else {
            this._statusText.text('● CAN BUS ONLINE');
            this._statusText.fill(C.green);
        }

        // AI 参数 pending → 上线后触发初始化读取
        try {
            const bus = this.sys?.canBus;
            const aiOnline = bus ? bus.isNodeOnline('ai') : false;
            if (aiOnline && this.nodeConfigs.ai?.pending && this.busConnected && !this.commFault) {
                this.nodeConfigs.ai.pending = false;
                this.nodeConfigs.ai.available = true;
                console.log('[CC] AI 上线，触发参数初始化读取');
                this._initAIParams();
            }
        } catch (_) { }

        // AO 参数 pending → 上线后触发初始化读取
        try {
            const bus = this.sys?.canBus;
            const aoOnline = bus ? bus.isNodeOnline('ao') : false;
            if (aoOnline && this.nodeConfigs.ao?.pending && this.busConnected && !this.commFault) {
                this.nodeConfigs.ao.pending = false;
                this.nodeConfigs.ao.available = true;
                console.log('[CC] AO 上线，触发参数初始化读取');
                this._initAOParams();
            }
        } catch (_) { }

        // DI 参数 pending → 上线后触发初始化读取
        try {
            const bus = this.sys?.canBus;
            const diOnline = bus ? bus.isNodeOnline('di') : false;
            if (diOnline && this.nodeConfigs.di?.pending && this.busConnected && !this.commFault) {
                this.nodeConfigs.di.pending = false;
                this.nodeConfigs.di.available = true;
                console.log('[CC] DI 上线，触发参数初始化读取');
                this._initDIParams();
            }
        } catch (_) { }

        // DO 参数 pending → 上线后触发初始化读取
        try {
            const bus = this.sys?.canBus;
            const doOnline = bus ? bus.isNodeOnline('do') : false;
            if (doOnline && this.nodeConfigs.do?.pending && this.busConnected && !this.commFault) {
                this.nodeConfigs.do.pending = false;
                this.nodeConfigs.do.available = true;
                console.log('[CC] DO 上线，触发参数初始化读取');
                this._initDOParams();
            }
        } catch (_) { }

        // 同步网络诊断页节点指示灯
        if (this._netRowDisps) {
            Object.entries(nodeMap).forEach(([addrStr]) => {
                const addr = parseInt(addrStr);
                const row = this._netRowDisps[addr]; if (!row) return;
                const lastSeen = this._canNodeLastSeen[addr] || 0;
                const online = lastSeen > 0 && (now - lastSeen) < TIMEOUT;
                row.dot.fill(online ? C.green : (lastSeen === 0 ? C.textDim : C.red));
            });
        }
    }

    // ══════════════════════════════════════════
    //  委托给 canBusHandler.js 的方法
    // ══════════════════════════════════════════

    /** 总线帧接收入口（由 CANBus._dispatch() 自动调用） */
    onCanReceive(frame) { onCanReceive(this, frame); }

    _canSendAOCommand() { canSendAOCommand(this); }
    _canSendDOCommand() { canSendDOCommand(this); }
    _canSendNMT(cmd, targetAddr = 0) { canSendNMT(this, cmd, targetAddr); }

    _startAllNodes() { startAllNodes(this); }
    _stopAllNodes() { stopAllNodes(this); }
    _resetAllNodes() { resetAllNodes(this); }
    _sendNMTCommand(nodeType, cmd) { sendNMTCommand(this, nodeType, cmd); }

    _requestNodeConfig(nodeType, configCmd, param = 0) { requestNodeConfig(this, nodeType, configCmd, param); }
    _initAIParams() { initAIParams(this); }
    _initAOParams() { initAOParams(this); }
    _initDIParams() { initDIParams(this); }
    _initDOParams() { initDOParams(this); }

    // ══════════════════════════════════════════
    //  委托给 shellAndTabs.js 的方法
    // ══════════════════════════════════════════
    _switchPage(idx) { switchPage(this, idx); }
    _refreshTabs() { refreshTabs(this); }

    // ══════════════════════════════════════════
    //  委托给 dialogs.js 的方法
    // ══════════════════════════════════════════
    _openRangeEditor(chId, refs) { openRangeEditor(this, chId, refs); }
    _openAlarmEditor(chId) { openAlarmEditor(this, chId); }

    // ══════════════════════════════════════════
    //  AI 行更新（AI 设置页辅助）它的主要职责是“数据合并与视图渲染”：将最新接收到的 CAN 数据（缓存 cached）与系统已有的配置数据（this.sys.comps['ai']）进行合并，然后将结果显示在界面对应的行（row）元素上。
    // ══════════════════════════════════════════
    _updateAIRowFromModule(chId) {
        const ai = this.sys.comps['ai'];  // 获取系统全局的 AI 组件配置
        if (!this._aiRows?.[chId]) return;
        const row = this._aiRows[chId];

        const cached = this.data?.ai?.[chId] ?? {}; // 获取当前最新的缓存数据（来自 CAN 回复）如果缓存中有最新的 value 或 mode，直接使用缓存数据（说明刚收到新数据）。否则，使用系统组件中保存的旧数据。如果都没有，给一个默认值 { value: 0, mode: 'normal' } 防止报错。
        const ch = (cached.value !== undefined || cached.mode !== undefined) ? cached
            : (ai?.channels?.[chId] ?? { value: 0, mode: 'normal' });
        //量程数据 (rng) 与 报警数据 (alm).逻辑：优先显示刚才 CAN 回复中解析出来的 cached 数据。兜底：如果缓存没更新，就显示系统里存的配置。
        const rng = cached.ranges ?? ai?.ranges?.[chId] ?? { urv: '--', lrv: '--', unit: '--' };
        const alm = cached.alarms ?? ai?.alarms?.[chId] ?? { hh: '--', h: '--', l: '--', ll: '--' };

        const mode = ch.mode ?? ai?.channels?.[chId]?.mode ?? 'normal';
        if (row.modeTxt) {
            // 根据 mode 的值（'normal', 'test' 等）动态改变文字颜色。
            row.modeTxt.text(`Mode: ${mode}`);
            row.modeTxt.fill(mode === 'normal' ? C.green : mode === 'test' ? C.orange : C.textDim);
        }
        // 如果值为 null 或 undefined，显示 '---'，否则显示具体数值。
        if (row.valDisplay) row.valDisplay.text(ch.value == null ? '---' : String(ch.value));
        // 详细参数显示：分别更新 URV, LRV, Unit, HH, H, L, LL 的文本内容。
        row.urvText?.text?.(`上限: ${rng.urv}`);
        row.lrvText?.text?.(`下限: ${rng.lrv}`);
        row.unitText?.text?.(`单位: ${rng.unit}`);
        row.hhText?.text?.(`HH: ${alm.hh}`);
        row.hText?.text?.(`H: ${alm.h}`);
        row.lText?.text?.(`L: ${alm.l}`);
        row.llText?.text?.(`LL: ${alm.ll}`);
        this._refreshCache();
    }

    /** 占位，实际颜色逻辑已集成到 renderParamPage */
    _updateAIChannelDisplay() { }

    /**
     * DO 行参数更新（DO 设置页辅助）
     * 将最新收到的 DO 模块参数同步到界面对应行
     */
    _updateDORowFromModule(chId) {
        if (!this._doRows?.[chId]) return;
        const row = this._doRows[chId];
        const doMod = this.sys?.comps?.['do'];
        const d = this.data?.do?.[chId] ?? {};

        const MODE_LABELS = { hand: '手  动', auto: '自  动', pulse: '脉冲模式', disable: '禁  用' };
        const MODE_COLORS_MAP = { hand: '#ffcc00', auto: '#44ff88', pulse: '#00aaff', disable: '#888' };
        const SAFE_COLORS_MAP = { off: '#888', hold: '#ffcc00', preset: '#ff8833' };

        const mode = d.mode || doMod?.channels?.[chId]?.mode || 'hand';
        const mc = MODE_COLORS_MAP[mode] || '#888';
        if (row.modeBtn) {
            row.modeBtn.findOne('Rect').fill(mc + '33');
            row.modeBtn.findOne('Rect').stroke(mc);
            row.modeBtn.findOne('Text').text(MODE_LABELS[mode] || mode);
            row.modeBtn.findOne('Text').fill(mc);
        }
        row.forceBtn?.opacity(mode === 'hand'  ? 1 : 0.35);
        row.pulseBtn?.opacity(mode === 'pulse' ? 1 : 0.35);

        // 脉冲参数文本
        if (row.pulseBtn && mode === 'pulse') {
            const pc = doMod?.pulseConfig?.[chId] || d.pulse || {};
            const onMs  = pc.onMs  ?? 500;
            const offMs = pc.offMs ?? 500;
            const phMs  = pc.phaseStart ??0;
            row.pulseBtn.findOne('Text').text(`${onMs}  ${offMs}  ${phMs}`);
        }

        // 安全输出
        const safeMode = d.safeMode || doMod?.safeOutput?.[chId]?.mode || 'off';
        const sc = SAFE_COLORS_MAP[safeMode] || '#888';
        if (row.safeBtn) {
            row.safeBtn.findOne('Rect').fill(sc + '33');
            row.safeBtn.findOne('Rect').stroke(sc);
            row.safeBtn.findOne('Text').text(`Safe: ${safeMode}`);
            row.safeBtn.findOne('Text').fill(sc);
        }

        // presetBtn 可见性与文本
        if (row.presetBtn) {
            row.presetBtn.visible(safeMode === 'preset');
            const ps = d.presetState ?? doMod?.safeOutput?.[chId]?.presetState ?? false;
            row.presetBtn.findOne('Text').text(ps ? '预设:  ON' : '预设: OFF');
            row.presetBtn.findOne('Rect').fill(ps ? '#ff883333' : '#88888822');
            row.presetBtn.findOne('Rect').stroke(ps ? '#ff8833' : '#888');
            row.presetBtn.findOne('Text').fill(ps ? '#ff8833' : '#888');
        }

        this._refreshCache();
    }

    /**
     * 网络诊断日志追加（供 canBusHandler 或 UI 按钮调用）
     * @param {string} line 单行文本
     */
    _appendNetDiagLog(line) {
        try {
            if (!this._netDiagLog) this._netDiagLog = [];
            const ts = new Date().toTimeString().slice(0, 8);
            this._netDiagLog.push(`${ts} ${line}`);
            if (this._netDiagLog.length > 10) this._netDiagLog.shift();
            if (this._netDiagText) this._netDiagText.text(this._netDiagLog.join('\n'));
            this._refreshCache();
        } catch (e) { console.warn(e); }
    }

    // ══════════════════════════════════════════
    //  公开 API
    // ══════════════════════════════════════════
    update(newData) {
        if (!newData) return;
        if (newData.ai) Object.assign(this.data.ai, newData.ai);
        if (newData.ao) Object.assign(this.data.ao, newData.ao);
        if (newData.di) Object.assign(this.data.di, newData.di);
        if (newData.do) Object.assign(this.data.do, newData.do);
    }

    showPage(idx) { this._switchPage(idx); }

    destroy() {
        if (this._loopTimer) clearInterval(this._loopTimer);
        if (this._flashTimer) clearInterval(this._flashTimer);
        super.destroy?.();
    }
}