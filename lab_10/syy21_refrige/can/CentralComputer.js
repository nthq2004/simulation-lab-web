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
 *   pageBuilders/     — 各页面构建 + 每 tick 刷新函数
 *   canBusHandler.js  — CAN 接收/发送、NMT 管理、参数查询
 *   simulation.js     — 液位仿真、温度仿真
 *   dialogs.js        — AI 量程/阈值 DOM 弹窗
 */

import { BaseComponent } from '../components/BaseComponent.js';
import { CAN_TICK_INTERVAL } from './CANBUS.js';
import { W, H, C } from './cc/constants.js';

import { drawShell, drawTabs, switchPage, buildPageContainers, refreshTabs } from './cc/shellAndTabs.js';

import {
    buildAlarmPage, buildParamPage, buildNetworkPage, buildAISetPage,
    buildAOPage, buildDISetPage, buildDOPage, buildLevelPage, buildTempPage,
    renderAlarmPage, renderParamPage, renderNetworkPage, renderAISetPage,
    renderAOPage, renderDISetPage, renderDOPage, renderLevelPage, renderTempPage,
    simLevel, simTemp,simAlarm
} from './cc/index.js';

import {
    onCanReceive, canHandleAIReport, canHandleAIReply, canHandleAOStatus,
    canHandleAOReply, canHandleDIReport, canHandleDIReply, canHandleDOStatus,
    canHandleDOReply, canSendAOCommand, canSendDOCommand, canSendNMT,
    startAllNodes, stopAllNodes, resetAllNodes, sendNMTCommand,
    requestNodeConfig, initAIParams, initAOParams, initDIParams, initDOParams
} from './cc/canBusHandler.js';

import { processAlarms } from './cc/alarmPage.js';
import { openRangeEditor, openAlarmEditor } from './cc/dialogs.js';

// ─────────────────────────────────────────────
//  主类
// ─────────────────────────────────────────────
export class CentralComputer extends BaseComponent {

    constructor(config, sys) {
        super(config, sys);

        this.w = W;
        this.h = H + 30;
        this.scale = 1.2;
        
        this.type = 'CentralComputer';
        this.special = 'can';
        this.cache = 'fixed';  // 模板：静态部件（外壳/页签底板）仅 _staticGroup 做一次位图缓存，运行时不再刷新

        this.commFault = false;
        this.busConnected = false;

        // 当前激活的页面索引
        this.activePage = 0;

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
        this.maxAlarmLines = 16;

        // ── 液位双位控制 ──────────────────────────
        this.levelCtrl = {
            level: 50, setHH: 80, setH: 70, setL: 30, setLL: 20,
            inletOn: false, simMode: 'HAND', drainOn: true,
            // 通道选择
            inputChannel: 'ch1',  // 输入通道：ch1 或 ch2（从 AI 模块读取）
            outputChannel: 'ch1', // 输出通道：ch1 或 ch2（输出到 DO 模块）
            isManualMode: false,  // 手动模式标志
        };
        this._levelTrendHistory = [];

        // ── 温度控制 ──────────────────────────────
        this.tempCtrl = {
            // PID 参数
            pv: 60, sv: 120, out: 0, mode: 'HAND',
            p: 4.0,     // 比例系数 P
            i: 0.0,     // 积分系数 I
            d: 0.0,     // 微分系数 D
            history: [], maxHist: 200,
            
            // 通道选择
            inputChannel: 'ch3',   // 输入通道：AI 模块 CH3
            outputChannel: 'ch1',  // 输出通道：AO 模块 CH1 或 CH2，默认 CH1
            
            // 手动模式
            isManualMode: false,   // 手动模式标志
            simMode: 'HAND',       // 'AUTO' 或 'HAND'
            
            // 执行机构
            valveOpen: 0,         // 蒸汽阀开度 %
            
            // 报警
            highAlarm: 150,        // 高温报警
            lowAlarm: 50,          // 低温报警
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

        // ── 新组件模板：固定调用顺序 ──
        this._initGroups();              // 静态 / 动态 / 交互 分组
        this._adoptGroups();             // 三组挂进 sg（本组件按 1.2 倍缩放）
        this._recalcGeometry();          // 计算几何尺寸
        this._initParameters(config);    // 参数读入 + config 副本
        this._init();                    // 静态绘制 → 动态节点 → 交互绑定
        this._initPorts();               // 最后注册端口
        this._startLoop();
    }

    // ══════════════════════════════════════════
    //  新组件模板：几何 / 参数 / 配置 API
    // ══════════════════════════════════════════
    _recalcGeometry() {
        this.width = this.w;
        this.height = this.h;
    }

    _initParameters(config) {
        if (config) {
            if (config.alarmDelay != null) this.alarmDelay = config.alarmDelay;
            if (config.maxAlarmLines != null) this.maxAlarmLines = config.maxAlarmLines;
            if (config.heartbeatIntervalMs != null) this.heartbeatIntervalMs = config.heartbeatIntervalMs;
        }
        this.config = {
            alarmDelay: this.alarmDelay,
            maxAlarmLines: this.maxAlarmLines,
            heartbeatIntervalMs: this.heartbeatIntervalMs,
        };
    }

    getConfigFields() {
        return [
            { key: 'alarmDelay', label: '报警延时(ms)', min: 0, max: 30000, step: 500 },
            { key: 'maxAlarmLines', label: '报警列表最大行数', min: 4, max: 64, step: 1 },
        ];
    }

    onConfigUpdate(cfg) {
        if (!cfg) return;
        if (cfg.alarmDelay != null) this.alarmDelay = Math.max(0, Number(cfg.alarmDelay) || 0);
        if (cfg.maxAlarmLines != null) this.maxAlarmLines = Math.max(4, Number(cfg.maxAlarmLines) || 16);
        Object.assign(this.config || {}, { alarmDelay: this.alarmDelay, maxAlarmLines: this.maxAlarmLines });
        this.markDirty();
        this._refreshIfDirty(true);
    }

    // ══════════════════════════════════════════
    //  界面初始化（模板三段式）
    // ══════════════════════════════════════════
    /** 把 _initGroups() 创建的三组挂进 sg（1.2 倍缩放） */
    _adoptGroups() {
        this.sg = new Konva.Group({ scaleX: this.scale, scaleY: this.scale });
        this.group.add(this.sg);
        this.sg.add(this._staticGroup);
        this.sg.add(this._dynamicGroup);
        this.sg.add(this._interactGroup);
    }

    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
    }

    /** ① 静态部件：外壳 + 页签 + 页面容器（先统一加到 sg，再由 ② 分区） */
    _drawStaticParts() {
        drawShell(this);
        drawTabs(this);
        this._buildPages();
    }

    /**
     * ② 动态节点：把"页签切换会改的"与"内容本身动态的"迁入 _dynamicGroup。
     *   - _pages：页签切换靠 p.visible()，内容（报警列表/参数/通道状态）持续变化
     *   - 页签 bg/txt：refreshTabs 会改填充与文字颜色，且带点击交互
     * 若误留在静态组，位图固化后页签会"点不动"、页面内容不再刷新。
     */
    _createDynamicNodes() {
        const dyn = this._dynamicGroup;
        const st = this._staticGroup;
        if (!dyn || !st || !this.sg) return;

        const dynSet = new Set();
        const mark = n => { if (n && typeof n === 'object' && typeof n.getParent === 'function') dynSet.add(n); };
        (this._pages || []).forEach(mark);
        // refreshTabs 会改 bg/txt/ind 三者（我此前漏了 ind，导致激活指示条被固化）
        (this._tabs || []).forEach(t => { if (t) { mark(t.bg); mark(t.txt); mark(t.ind); } });
        // 外壳上的动态文本：时钟 / 状态栏 / 报警计数 / 节点列表。
        // _tick 每 100ms 都会改写它们；若留在静态组并被位图固化，状态栏将永远
        // 停在构造时的初始值 '● CAN BUS ONLINE' —— 表现为"状态从不刷新"。
        // （注意：判断时必须读画布像素，不能只读 .text()，节点属性总是最新的。）
        mark(this._clockText);
        mark(this._statusText);
        mark(this._alarmCountText);
        mark(this._nodeText);

        // 按 sg 原有子节点顺序搬运，保持原本的层叠次序
        let kids = [];
        try { kids = Array.prototype.slice.call(this.sg.getChildren()); } catch (e) { kids = []; }
        kids.forEach(n => {
            if (n === dyn || n === st || n === this._interactGroup) return;
            if (dynSet.has(n)) dyn.add(n); else st.add(n);
        });

        // 双保险：无论原先挂在哪个组，都必须落在动态组（否则页签/页面会被位图冻结）
        const move = n => {
            if (!n || typeof n.getParent !== 'function') return;
            const p = n.getParent();
            if (p === dyn) return;
            if (p === st) dyn.add(n);   // dyn/st 同在 sg 下、坐标一致，移动不改变位置
        };
        (this._pages || []).forEach(move);
        (this._tabs || []).forEach(t => { if (t) { move(t.bg); move(t.txt); } });
    }

    /** ③ 交互绑定（页签点击已在 drawTabs 内完成绑定） */
    _bindInteraction() { }

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
    /**
     * 计算总线终端电阻的等效电阻，并驱动通信错误状态。
     *
     * CAN 总线要求两端各接一个 120Ω 终端电阻：
     *   两端都接通 → R_eq = 120 // 120 = 60Ω，阻抗匹配，通信正常；
     *   任一端断开 → R_eq 变为 120Ω 或开路，阻抗失配 → 通信错误率上升。
     *
     * 故障表现（刻意区分两类设备）：
     *   - AI/AO/DI/DO：进入通信错误状态（commFault）并**锁存** ——
     *     即使总线电阻恢复也不自动清除，必须经复位（网络诊断页 NMT RESET
     *     或工具栏「起动系统」）才重新进入通信状态；
     *   - CC：进入 CAN BUS OFF（busConnected = false），总线一旦恢复
     *     就自动回到 CAN BUS ONLINE，无需复位。
     *
     * @returns {boolean} 两端终端是否都接通（等效电阻 = 60Ω）
     */
    _updateBusTermination() {
        const sys = this.sys;
        if (!sys || !sys.comps) return true;

        const term = sys.comps['term-cc'];
        // CC 侧终端"已接入总线"需同时满足：开关接通 **且** 两端接线在位。
        // 只判断开关的话，把电阻两端的线拔掉（等效于电阻断开）不会被检测到，
        // 表现为"断开了终端电阻但 CC 仍显示 CAN BUS ONLINE"。
        const wired = function (portId) {
            const conns = sys.conns || [];
            return conns.some(c => c.from === portId || c.to === portId);
        };
        const ccTerm = !!(term && typeof term.isEnabled === 'function' && term.isEnabled()
            && wired('term-cc_wire_l') && wired('term-cc_wire_r'));
        const diMod = sys.comps['di'];
        const diTerm = !!(diMod && diMod.termEnabled);

        // 等效电阻 = 所有接通的 120Ω 终端并联
        let n = (ccTerm ? 1 : 0) + (diTerm ? 1 : 0);
        ['ai', 'ao', 'do'].forEach(id => {
            const m = sys.comps[id];
            if (m && m.termEnabled) n++;
        });
        this.busTermCount = n;
        this.busEquivalentResistance = n === 0 ? Infinity : 120 / n;

        const ok = ccTerm && diTerm;   // 两端终端必须都接通

        // ── 错误计数：断开后不立即进入故障态，而是累计约 30s 才触发 ──
        // 本方法由 _tick() 每 CAN_TICK_INTERVAL(100ms) 调用一次。
        // 用真实时间戳计时（而非"次数×100ms"累加）：_tickAcc 每次归零会丢掉
        // 余数，固定步长累加会让名义时间落后于真实时间，30s 阈值实际要更久才到。
        //   ok=false → 从首次断开起累计时长
        //   ok=true  → 清零（在触发前恢复则不进入故障）
        const STEP = CAN_TICK_INTERVAL;
        if (ok) {
            this.busTermErrStart = 0;
            this.busTermErrCount = 0;
            this.busTermErrMs = 0;
        } else {
            if (!this.busTermErrStart) this.busTermErrStart = Date.now();
            this.busTermErrMs = Date.now() - this.busTermErrStart;
            this.busTermErrCount = Math.floor(this.busTermErrMs / STEP);   // 错误计数（每 100ms 一次）
        }
        const tripped = (!ok && this.busTermErrMs >= 30000);
        this.busTermTripped = tripped;
        // 距离触发还剩多少毫秒（0 表示已触发或当前正常）
        this.busTermErrRemain = (!ok && !tripped) ? (30000 - this.busTermErrMs) : 0;

        if (tripped) {
            // 通信错误：四模块 commFault 置位并锁存（此处只置位，不自动清除，
            // 恢复后仍须复位 —— 网络诊断页「复位」或工具栏「起动系统」）
            ['ai', 'ao', 'di', 'do'].forEach(id => {
                const m = sys.comps[id];
                if (m) m.commFault = true;
            });
            // CC 自身不置 commFault，由 busConnected=false 表现为 CAN BUS OFF，
            // 总线恢复后 busConnected 会被上方检测重新算成 true → 自动 ONLINE。
        }

        // ── 把总线终端故障映射到 CAN 总线统计 ──
        // 网络诊断页显示的是 canBus 的 `ERR:${errorFrames}` 与
        // `BUS-OFF:${isBusOff()}`；若不写入这两处，终端断开时页面会一直
        // 显示 "ERR:0 / BUS-OFF:否"，看起来像"CC 状态完全没变化"。
        try {
            const bus = sys.canBus;
            if (bus) {
                if (!ok) {
                    // 故障期间每 100ms 累计一次错误，ERR 计数随断开时刻开始增长
                    if (bus._stats) bus._stats.errorFrames++;
                }
                if (tripped) {
                    if (!bus._busOff) {
                        bus._busOff = true;
                        if (bus._stats) bus._stats.busOffCount++;
                    }
                } else if (bus._busOff) {
                    bus._busOff = false;   // 终端恢复 → 自动退出 BUS-OFF
                }
            }
        } catch (e) { /* 统计写入失败不影响主流程 */ }

        // 触发前仍视为链路可用（不进 OFF）；触发后由 !ok 决定是否恢复
        return ok || !tripped;
    }

    _startLoop() {
        // 周期任务（心跳 tick + 报警闪烁）改由 consys._tickAll 集中调用 tick(dt) 驱动
        this._tickAcc = 0;
        this._flashAcc = 0;

        if (this.nmtAutoStart) {
            this.nmtStartSequence = setTimeout(() => this._startAllNodes(), this.nmtAutoStartDelay);
        }
    }

    /** 集中式 tick：100ms 执行一次 _tick；每 500ms 翻转报警闪烁相位 */
    tick(dt) {
        this._flashAcc = (this._flashAcc || 0) + dt;
        if (this._flashAcc >= 0.5) {
            this._flashAcc = 0;
            this.flashState = !this.flashState;
        }
        this._tickAcc = (this._tickAcc || 0) + dt;
        if (this._tickAcc >= CAN_TICK_INTERVAL / 1000) {
            this._tickAcc = 0;
            try { this._tick(); } catch (e) { /* 单帧异常不阻断仿真循环 */ }
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

        // 2a. 总线终端电阻等效电阻检测（须先于总线连接检测，才能给出正确在线状态）
        // 包一层 try/catch：本方法异常若冒泡出去，会被 tick() 的 catch 吞掉并中断
        // 后续的 _pullModuleData() —— 状态栏就永远停在构造时的初始值
        // '● CAN BUS ONLINE'，表现为"还没连线却一直显示 ONLINE、状态从不变化"。
        let busTermOk = true;
        try {
            busTermOk = this._updateBusTermination();
        } catch (e) {
            console.error('[CC] 总线终端电阻检测异常：', e);
            busTermOk = true;   // 检测异常时不要干扰原有的总线连通判定
        }

        // 2. 总线连接检测
        try {
            this.busConnected = busTermOk
                && this.sys.isOnCanBus(`${this.id}_wire_can1p`)
                && this.sys.isOnCanBus(`${this.id}_wire_can1n`);
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
        simAlarm(this);

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

        this.markDirty();
        this._refreshIfDirty();
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
            // 总线 OFF 时没有在线节点，NODE 列表必须一并清成占位符；
            // 此分支原本不更新 _nodeText，会残留上一次在线时的节点名
            // （构造初始值即 'NODE: ------'）。
            this._nodeText.text('NODE: ------');
            this._nodeText.fill(C.textDim);
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
        this.markDirty();
        this._refreshIfDirty();
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

        this.markDirty();
        this._refreshIfDirty();
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
            this.markDirty();
        this._refreshIfDirty();
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
        // 定时器已迁移至集中 tick；仅清理 NMT 自动启动延时
        if (this.nmtStartSequence) clearTimeout(this.nmtStartSequence);
        super.destroy?.();
    }
}