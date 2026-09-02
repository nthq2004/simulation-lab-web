/**
 * ThermalOverloadRelay.js — 热继电器（Thermal Overload Relay）仿真组件
 *
 * ════════════════════════════════════════════════════════════════
 *  功能概述：
 *    仿真工业热继电器（基于双金属片热弯曲原理的过载保护电器）。
 *    三相主电路通过热元件（小电阻）接入电路求解器，在 tick() 中
 *    通过 40 点滑动 RMS 计算每相电流有效值，驱动内部状态机
 *   （normal → loading → tripped → reset）。
 *
 *  仿真闭环（数据流）：
 *    MNA stamp(3×0.01Ω) → 求解节点电压
 *      → _updateDeviceCurrents 回填 _phaseCurrents[i]
 *      → tick() 40 点 RMS → maxI / ratedCurrent → setLoad(ratio)
 *      → 状态机 → NC/NO 经 CircuitTopology.internalUnion 切换
 *
 *  渲染优化原则：
 *    1. 动态元素（双金属片弯曲、挡板、推杆、触桥）使用 in-place 更新
 *    2. 消除所有 Shadow，避免离屏 Canvas
 *    3. 静态部件仅 init 时做一次位图缓存（cache='fixed'）
 *
 *  端口列表（10 个电气接口）：
 *    L1/L2/L3  — 进线（主电路上端）
 *    T1/T2/T3  — 出线（主电路下端）
 *    nc_a/nc_b — 常闭触点 95-96（未跳脱时闭合）
 *    no_a/no_b — 常开触点 97-98（跳脱时闭合）
 *
 *  状态机：
 *    'normal'  → 负载比 ≤ 1.0，双金属片直立，NC 闭合，NO 断开
 *    'loading' → 负载比 ≥ 1.0，热量累积，双金属片渐弯
 *    'tripped' → 热量 100%，挡板全位移，NC 断，NO 合
 *    (复位)    → 1s easeOutSine 动画回 normal
 *
 *  可配置参数：
 *    label, ratedCurrent, tripClass, initState,
 *    loadRatio, phaseResistance
 * ════════════════════════════════════════════════════════════════
 */
import { BaseComponent } from './BaseComponent.js';

export class ThermalOverloadRelay extends BaseComponent {

    // ════════════════════════════════════════════════════════════
    // 构造函数 — 初始化尺寸、类型、几何、参数、图形和端口
    // ════════════════════════════════════════════════════════════
    constructor(config, sys) {
        super(config, sys);

        // 最小尺寸约束：宽 ≥ 340，高 ≥ 240
        this.width  = Math.max(340, config.width  || 420);
        this.height = Math.max(240, config.height || 300);

        // 类型标记，供 CircuitSolver._buildDeviceCache() 筛选
        // special = 'THERMAL-OL-RELAY' 区别于普通电压继电器
        this.type    = 'RELAY';
        this.special = 'THERMAL-OL-RELAY';
        this.cache   = 'fixed';   // 静态层启用 Konva 位图缓存

        // 热元件数目（1~3），需要先于 _recalcGeometry 设置
        this.poleCount = Math.max(1, Math.min(3, config.poles !== undefined ? config.poles : 3));

        // 固定初始化流程（四步，顺序不可颠倒）
        this._initGroups();          // 1. 创建 Konva 分组（_staticGroup / _dynamicGroup / _interactGroup）
        this._recalcGeometry();      // 2. 根据宽高计算所有控件/元件坐标
        this._initParameters(config);// 3. 从 config 读取参数，初始化运行状态
        this._init();                // 4. 绘制静态图形 + 创建动态节点 + 绑定交互

        // 保存配置快照，供 getConfigFields() / onConfigUpdate() 对比
        this.config = {
            poles:        this.poleCount,
            label:        this.label,
            ratedCurrent: this.ratedCurrent,
            tripClass:    this.tripClass,
            initState:    this._state,
            loadRatio:    this._loadRatio,
        };

        // ── 注册电气端口（对应 CircuitTopology / DeviceStamps 识别的名称）──
        // 每个 poleData 对应一相，cx 为柱中心 X 坐标
        this._poleData.forEach((p, i) => {
            // 进线端口 L1/L2/L3，位于组件顶部 y=2
            this.addPort(p.cx, 2, ['l1','l2','l3'][i], 'wire');
            // 出线端口 T1/T2/T3，位于组件底部 y=height-2, 标记为正极性
            this.addPort(p.cx, this.height - 2, ['t1','t2','t3'][i], 'wire', 'p');
        });
        // 常闭触点 NC（95-96）：右上侧上下排列
        this.addPort(this._ncPort.xa, this._ncPort.ya, 'nc_a', 'wire', 'p');
        this.addPort(this._ncPort.xb, this._ncPort.yb, 'nc_b', 'wire');
        // 常开触点 NO（97-98）：右下侧上下排列
        this.addPort(this._noPort.xa, this._noPort.ya, 'no_a', 'wire');
        this.addPort(this._noPort.xb, this._noPort.yb, 'no_b', 'wire');
    }

    // ════════════════════════════════════════════════════════════
    // 几何尺寸计算
    // 根据当前 this.width / this.height 重新计算所有 UI 元素的
    // 位置、尺寸和角度参数。响应式布局，支持 config 更新后重算。
    // ════════════════════════════════════════════════════════════
    _recalcGeometry() {
        const W = this.width, H = this.height;

        // 左右分区线：左 52% 为热元件区，右 48% 为触点机构区
        this._divX = W * 0.52;
        // 外框参数（用于绘制面板边框和倒角）
        this._frame = { x: 2, y: 2, w: W - 4, h: H - 4, rx: 6 };

        // ══ 左侧：热元件区 ═══════════════════════════
        const LP  = 10;       // 左内边距
        const LW  = this._divX - LP * 2;  // 热元件区可用宽度

        // 三相热元件均匀分布（始终 3 个物理位置）
        const poleCount  = 3;
        const poleSpanW  = LW * 0.88;       // 三相总展宽
        const polePadL   = LP + (LW - poleSpanW) / 2;  // 左端偏移
        const poleSpacing = poleSpanW / poleCount;      // 相间距

        // 每相中心 X 坐标
        this._poleData = Array.from({ length: poleCount }, (_, i) => ({
            cx: polePadL + poleSpacing * (i + 0.5),
        }));

        // 活跃极（有双金属片）：1→中间, 2→两侧, 3→全部
        const pc = this.poleCount;
        if (pc <= 1) {
            this._activePoles = [false, true, false];
        } else if (pc <= 2) {
            this._activePoles = [true, false, true];
        } else {
            this._activePoles = [true, true, true];
        }

        // 双金属片（Bimetallic Strip）的纵向区域
        // bmsTop ~ bmsBot 定义了从顶部接线柱到底部接线柱的范围
        const bmsW  = Math.max(10, poleSpacing * 0.32); // 双金属片宽度
        const bmsTop = H * 0.16;
        const bmsBot = H * 0.78;
        const bmsH   = bmsBot - bmsTop;

        this._bmsW    = bmsW;
        this._bmsTop  = bmsTop;
        this._bmsBot  = bmsBot;
        this._bmsH    = bmsH;

        // 加热线圈区域（双金属片中段 20%~80%）
        this._coilTop = bmsTop + bmsH * 0.20;
        this._coilBot = bmsTop + bmsH * 0.80;
        this._coilH   = this._coilBot - this._coilTop;

        // 双金属片自由端（下端）最大水平偏移量，模拟热弯曲幅度
        this._bmsMaxBend = poleSpacing * 0.38;

        // ══ 右侧：触点机构区 ═══════════════════════════
        const RP    = 8;
        const RX    = this._divX + RP;
        const RW    = W - this._divX - RP * 2;

        // ── 挡板（左区保留，推杆贯通至右区）───────────
        const deflExt = 14;
        this._deflBaseX0 = this._poleData[0].cx - this._bmsW / 2 - deflExt;
        this._deflBaseX1 = this._poleData[2].cx + this._bmsW / 2 + deflExt;
        this._deflectorY  = this._bmsBot + 12;
        this._deflectorH  = 12;

        this._tabGapPx = 3;
        const halfBW = this._bmsW / 2;
        this._tabW = 9;
        this._tabBaseXs = [];
        this._poleData.forEach((p, i) => {
            if (this._activePoles[i]) {
                this._tabBaseXs.push(p.cx + halfBW + this._tabGapPx + this._tabW / 2);
            }
        });
        this._tabH = Math.max(18, this._bmsH * 0.22);

        // ── 推杆：从左区挡板贯通至右区触点机构 ────────
        this._pushRodY    = this._deflectorY + this._deflectorH / 2;
        this._pushRodX0   = this._deflBaseX1;
        this._pushRodX1   = RX + RW * 0.60;

        // ── 触点机构区（纵向分区）─────────────────────
        const ncContactY   = H * 0.22;
        const noContactY   = H * 0.78;
        const pivotY       = H * 0.50;

        // NC/NO 静触头 — 靠左排列
        this._ncContactY  = ncContactY;
        this._ncStaticLX  = RX + RW * 0.10;
        this._ncStaticRX  = RX + RW * 0.40;

        this._noContactY  = noContactY;
        this._noStaticLX  = RX + RW * 0.10;
        this._noStaticRX  = RX + RW * 0.40;

        this._bridgeW = this._ncStaticRX - this._ncStaticLX;

        // 弹跳机构旋转支点
        this._pivotX = RX + RW * 0.30-1;
        this._pivotY = pivotY;
        this._armLen = H * 0.18;

        // 触点臂旋转角度
        this._armAngleNormal  = 0;
        this._armAngleTripped = 20 * Math.PI / 180;
        this._noMaxLift       = Math.sin(this._armAngleTripped) * this._bridgeW * 0.7;

        // 接线柱圆点半径
        this._termR = Math.max(3.5, W * 0.012);

        // ── NC 端口（右上边缘，上下错开排列）─────────
        this._ncPort = {
            xa: W - 2, ya: H * 0.35,   // 静触点 → 黑色
            xb: W - 2,  yb: H * 0.22,   // 动触点 → 红色
        };

        // ── NO 端口（右下边缘，上下错开排列）─────────
        this._noPort = {
            xa: W - 2, ya: H * 0.92,   // 静触点 → 黑色
            xb: W - 2,  yb: H * 0.78,   // 动触点 → 红色
        };

        // ── 整定旋钮（面积减半）────────────────────────
        this._knobR = Math.max(15, RW * 0.212);
        this._knobX = RX + RW * 0.78;
        this._knobY = H * 0.54;

        // ── 红色 RESET 按钮（圆形，面积减半）────────────
        this._resetBtnR = Math.max(9, RW * 0.085);
        this._resetBtnX = RX + RW * 0.75;
        this._resetBtnY = H * 0.12;
        this._resetLinkX0 = this._resetBtnX;
        this._resetLinkY0 = this._resetBtnY + this._resetBtnR;
        this._resetLinkX1 = this._pivotX;
        this._resetLinkY1 = this._pivotY;

        // ── TEST 按钮（推杆左端上方，用于机械测试脱扣）──
        this._testBtnR  = Math.max(7, RW * 0.07);
        this._testBtnX  = this._pushRodX0 + 32;
        this._testBtnY  = this._pushRodY - 80;
    }

    // ════════════════════════════════════════════════════════════
    // 参数初始化
    // 从 config 读取所有可配置参数，初始化运行状态、动画变量、
    // 电流检测缓冲区。
    // ════════════════════════════════════════════════════════════
    _initParameters(config) {
        // --- 用户可配置参数 ---
        this.label        = config.label        || 'FR';           // 位号（默认 FR）
        this.ratedCurrent = config.ratedCurrent !== undefined ? config.ratedCurrent : 9; // 整定电流 A
        this._defaultRated = this.ratedCurrent;
        this.tripClass    = config.tripClass    !== undefined ? config.tripClass    : 10; // 脱扣等级
        this.function     = config.function     || '热继电器';      // 面板标题文字

        // 初始状态：'normal' 或 'tripped'
        const s = (config.initState || 'normal').toLowerCase();
        this._state = (s === 'tripped') ? 'tripped' : 'normal';

        // 每相热元件的负载比/热量/弯曲（独立驱动）
        this._poleLoadRatio = [0, 0, 0];
        this._poleHeat      = [0, 0, 0];
        this._poleBend      = [0, 0, 0];
        if (config.loadRatio !== undefined) {
            const v = Math.max(0, Math.min(1.5, config.loadRatio));
            for (let i = 0; i < 3; i++) this._poleLoadRatio[i] = v;
        }
        // 负载比 0~1.5（0=空载，1=额定电流，>1=过载）
        this._loadRatio   = Math.max(0, Math.min(1.5, config.loadRatio || 0));

        // 双金属片弯曲比例：0（直立）~ 1（最大弯曲）
        // tripped 状态固定为 1.0
        this._bendRatio   = this._state === 'tripped' ? 1.0 : Math.min(1.0, this._loadRatio);
        if (this._state === 'tripped') {
            for (let i = 0; i < 3; i++) {
                if (this._activePoles[i]) { this._poleBend[i] = 1.0; this._poleHeat[i] = 1.0; }
            }
        }

        // 触点臂当前旋转角度
        this._armAngleCur = this._state === 'tripped'
            ? this._armAngleTripped : this._armAngleNormal;

        // --- 动画变量（复位动画使用 easeOutSine 插值）---
        this._animating   = false;     // 是否正在播放动画
        this._animT       = 0;         // 动画进度 [0,1]
        this._animDur     = 0.25;      // 动画时长（秒）
        this._animFromBend = this._bendRatio;
        this._animToBend   = this._bendRatio;
        this._animFromAngle = this._armAngleCur;
        this._animToAngle   = this._armAngleCur;
        this._animJustEnded = false;   // 动画刚结束标记（用于触发一帧绘制）

        // 热量累积值 [0,1]：loading 状态下每帧递增
        this._heatLevel   = this._state === 'tripped' ? 1.0 : this._loadRatio * 0.8;
        // 热量光晕相位（用于呼吸动画）
        this._heatPhase   = 0;

        // --- 每相热元件电阻 ---
        // 此电阻值被注入 MNA 矩阵（DeviceStamps.stampThermalRelays），
        // 使电路求解器可计算每相压降和电流。
        this._phaseResistance = config.phaseResistance !== undefined ? config.phaseResistance : 0.01;

        // --- 三相电流 RMS 测量缓冲区 ---
        // 采用 40 点滑动窗口，20fps 下覆盖 2 秒数据，确保稳态精度。
        // 每相独立缓冲区，取三相最大值驱动状态机。
        this._iBuf = [new Array(40).fill(0), new Array(40).fill(0), new Array(40).fill(0)];
        this._iBufSum = [0, 0, 0];   // 每相平方和
        this._iBufIdx = 0;            // 循环缓冲区写指针
        this._iBufCount = 0;          // 已采样数（满 40 后才计算 RMS）
        this._iRms = [0, 0, 0];       // 每相 RMS 电流

        // 以下由 CircuitSolver._updateDeviceCurrents 每帧回填
        // _phaseCurrents[i] = (V_li - V_ti) / _phaseResistance
        this._phaseCurrents = [0, 0, 0];
        this._maxInstCurrent = 0;

        // 操作次数计数（跳脱次数）
        this.opsCount = config.initOps || 0;

        // TEST 按钮状态
        this._testPressed = false;
        this._testPushDx = 0;            // TEST 对推杆的额外偏移量

        // 脏检查快照（_updateDynamic 使用），初始化 null 确保首次一定执行
        this._san = null;
    }

    // ════════════════════════════════════════════════════════════
    // 主初始化（固定顺序）
    // ════════════════════════════════════════════════════════════
    _init() {
        this._drawStaticParts();    // 绘制所有一次性图形（外框、接线柱、铭牌等）
        this._createDynamicNodes(); // 创建每帧更新的动态节点（双金属片、挡板、触桥等）
        this._bindInteraction();    // 绑定 RESET 按钮交互
    }

    // ════════════════════════════════════════════════════════════
    // 静态部件绘制
    // 所有图形加入 this._staticGroup，仅初始化时绘制一次，
    // 之后通过 cache='fixed' 做位图缓存，不参与每帧重绘。
    // ════════════════════════════════════════════════════════════
    _drawStaticParts() {
        this._drawFrame();               // 面板外框 + 左右分区背景
        this._drawDivider();             // 中间分隔线 + 分区标题
        this._drawMainCircuitStatic();   // 主电路区静态元素（接线柱、双金属片背景、线圈）
        this._drawContactZoneStatic();   // 触点区静态元素（静触头、端子、标注）
        this._drawControls();            // 整定旋钮 + RESET 按钮
        this._drawPanelLabel();          // 底部位号和等级标签
    }

    // ── 面板外框 + 分区背景 ──────────────────────────────────────
    _drawFrame() {
        const f = this._frame;
        // 整体背景面板（浅灰蓝底色）
        this._staticGroup.add(new Konva.Rect({
            x: f.x, y: f.y, width: f.w, height: f.h,
            fill: '#f2efe8', stroke: '#c8b8a0', strokeWidth: 1.5, cornerRadius: f.rx,
        }));
        // 顶部装饰色条（橙色半透明，呼应热保护主题）
        this._staticGroup.add(new Konva.Rect({
            x: f.x + 2, y: f.y + 2, width: f.w - 4, height: f.h * 0.055,
            fill: 'rgba(200,130,40,0.18)', cornerRadius: [f.rx, f.rx, 0, 0],
        }));
        // 标题文字（如"热继电器"）
        this._staticGroup.add(new Konva.Text({
            x: this._divX + 4, y: f.y - 15,
            text: this.function,
            fontSize: Math.max(13, this.width * 0.022), fill: '#00060c',
        }));
        // 左侧面板背景（浅暖灰风格）
        this._staticGroup.add(new Konva.Rect({
            x: f.x + 2, y: f.y + 2,
            width: this._divX - f.x - 2, height: f.h - 4,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: this._divX, y: 0 },
            fillLinearGradientColorStops: [0, '#f0ece3', 1, '#e8e0d2'],
            cornerRadius: [f.rx, 0, 0, f.rx],
        }));
    }

    // ── 分隔线  ────────────────────────────────────────
    _drawDivider() {
        // 竖直虚线分隔左右两区
        this._staticGroup.add(new Konva.Line({
            points: [this._divX, this._frame.y + 8, this._divX, this._frame.y + this._frame.h - 8],
            stroke: '#8090a8', strokeWidth: 1.5, dash: [5, 3],
        }));
    }

    // ── 主电路区静态部件 ──────────────────────────────────────────
    // 包含：接线柱（上下端）、双金属片矩形背景、层间分界线、
    // 相色标环、加热线圈骨架和漆包线匝。
    _drawMainCircuitStatic() {
        // 三相标识色：U=红, V=绿, W=蓝
        const poleColors = ['#e03030', '#20a030', '#2050e0'];
        const inNames    = ['L1', 'L2', 'L3'];
        const outNames   = ['T1', 'T2', 'T3'];
        const fs = Math.max(12, this.width * 0.018);

        this._poleData.forEach((p, i) => {
            const cx    = p.cx;
            const color = poleColors[i];

            // ── 上端进线接线柱 ──
            this._drawTermPost({ x: cx, y: this._bmsTop - 18 }, color);
            this._staticGroup.add(new Konva.Text({
                x: cx - 8, y: this._bmsTop - 60 - this._termR ,
                text: inNames[i], fontSize: fs, fontStyle: 'bold', fill: color,
            }));
            // ── 下端出线接线柱 ──
            this._drawTermPost({ x: cx, y: this._bmsBot + 38 }, color);
            this._staticGroup.add(new Konva.Text({
                x: cx - 8, y: this._bmsBot + 68 + this._termR ,
                text: outNames[i], fontSize: fs, fontStyle: 'bold', fill: color,
            }));

            // 接线柱到组件边界的引出线
            this._staticGroup.add(new Konva.Line({
                points: [cx, this._bmsTop - 8 - this._termR, cx, 2],
                stroke: color, strokeWidth: 2.5,
            }));
            this._staticGroup.add(new Konva.Line({
                points: [cx, this._bmsBot + 28 + this._termR, cx, this.height - 2],
                stroke: color, strokeWidth: 2.5,
            }));

            // ── 双金属片静态背景（仅活跃极） ──
            const bw = this._bmsW;
            if (this._activePoles[i]) {
                // 左层（低膨胀合金，深灰）：热膨胀系数小
                // 右层（高膨胀合金，铜色）：热膨胀系数大
                this._staticGroup.add(new Konva.Rect({
                    x: cx - bw / 2, y: this._bmsTop,
                    width: bw * 0.42, height: this._bmsH,
                    fill: '#4a5060', stroke: '#384048', strokeWidth: 0.6,
                }));
                this._staticGroup.add(new Konva.Rect({
                    x: cx - bw / 2 + bw * 0.42, y: this._bmsTop,
                    width: bw * 0.42, height: this._bmsH,
                    fill: '#8a7040', stroke: '#705830', strokeWidth: 0.6,
                }));
                // 两层之间的分界线（虚线）
                this._staticGroup.add(new Konva.Line({
                    points: [cx - bw / 2 + bw * 0.42, this._bmsTop + 4,
                             cx - bw / 2 + bw * 0.42, this._bmsBot - 4],
                    stroke: '#c0c8d0', strokeWidth: 0.6, dash: [3, 3],
                }));
            }

            // ── 加热线圈 — 斜绕漆包线绕组（10 匝，无骨架） ──
            const coilOutW = bw * 1.85;
            const co = coilOutW / 2;
            const coilL = cx - co, coilR = cx + co;
            const turns = 10;
            const sl = this._coilH / turns * 0.45;

            // 第一匝和最后一匝的右端点（精确对齐）
            const topY = this._coilTop + this._coilH / turns * (0.5 - 0.45);
            const botY = this._coilTop + this._coilH / turns * (turns - 0.5 + 0.45);
            const termTopY = this._bmsTop - 8;
            const termBotY = this._bmsBot + 8;

            // 进出线均在绕组右侧（从右端引到接线柱）
            this._staticGroup.add(new Konva.Line({
                points: [cx, termTopY-10, coilR, topY],
                stroke: '#b08030', strokeWidth: 1.5, lineCap: 'round',
            }));
            this._staticGroup.add(new Konva.Line({
                points: [coilR, botY, cx, termBotY+30],
                stroke: '#b08030', strokeWidth: 1.5, lineCap: 'round',
            }));
            // 连接点焊点
            this._staticGroup.add(new Konva.Circle({
                x: coilR, y: topY, radius: 2.5, fill: '#c89020',
            }));
            this._staticGroup.add(new Konva.Circle({
                x: coilR, y: botY, radius: 2.5, fill: '#c89020',
            }));

            // 10 匝斜绕（交替前后，模拟螺旋缠绕）
            for (let k = 0; k < turns; k++) {
                const t = (k + 0.5) / turns;
                const yM = this._coilTop + t * this._coilH;
                const dir = k % 2 === 0 ? 1 : -1;
                const yL = yM + dir * sl;
                const yR = yM - dir * sl;

                if (k % 2 === 0) {
                    // 正面匝：全跨距可见
                    this._staticGroup.add(new Konva.Line({
                        points: [coilL, yL, coilR, yR],
                        stroke: '#c89020', strokeWidth: 3.5, lineCap: 'round',
                    }));
                } else {
                    // 背面匝：被双金属片遮挡中间，仅露出两侧
                    const bmsHalf = bw / 2;
                    const sL = cx - bmsHalf, sR = cx + bmsHalf;
                    const slope = (yR - yL) / (coilR - coilL);
                    const ySL = yL + (sL - coilL) * slope;
                    const ySR = yL + (sR - coilL) * slope;
                    this._staticGroup.add(new Konva.Line({
                        points: [coilL, yL, sL, ySL],
                        stroke: '#a07820', strokeWidth: 3, lineCap: 'round',
                    }));
                    this._staticGroup.add(new Konva.Line({
                        points: [sR, ySR, coilR, yR],
                        stroke: '#a07820', strokeWidth: 3, lineCap: 'round',
                    }));
                }
            }
        });
    }

    // ── 触点区静态结构 ────────────────────────────────────────────
    _drawContactZoneStatic() {
        const fs = Math.max(12, this.width * 0.018);
        const jR = 2.5;
        const hGap = 18;  // 水平引线 Y 错开间距

        // 静触点色（暗、匹配黑色端口），动触点色（亮、匹配红色端口）
        const ncStaticCol = '#8a5a30';  // 暗橙（静）
        const ncMovingCol = '#e06020';  // 亮橙（动）
        const noStaticCol = '#1a5080';  // 暗蓝（静）
        const noMovingCol = '#2080d0';  // 亮蓝（动）

        // ── NC 触点（右上区域）────────────────────────
        // 端子 95（黑/静）→ 下行至 ncContactY+hGap → 水平至左静触头 → 上行
        this._drawTermPost({ x: this._ncPort.xa, y: this._ncPort.ya }, ncStaticCol);
        this._staticGroup.add(new Konva.Text({
            x: this._ncPort.xa - 12, y: this._ncPort.ya - this._termR - fs - 2,
            text: '95', fontSize: fs, fontStyle: 'bold', fill: ncStaticCol,
        }));
        this._staticGroup.add(new Konva.Line({
            points: [this._ncPort.xa, this._ncPort.ya ,
                     this._ncStaticLX, this._ncContactY + 40,
                     this._ncStaticLX, this._ncContactY],
            stroke: ncStaticCol, strokeWidth: 2,
        }));
        this._staticGroup.add(new Konva.Circle({
            x: this._ncStaticLX, y: this._ncContactY,
            radius: jR, fill: ncStaticCol,
        }));

        // 端子 96（红/动）→ 下行至 ncContactY → 水平至右静触头
        this._drawTermPost({ x: this._ncPort.xb, y: this._ncPort.yb }, ncMovingCol);
        this._staticGroup.add(new Konva.Text({
            x: this._ncPort.xb - 12, y: this._ncPort.yb - this._termR - fs - 2,
            text: '96', fontSize: fs, fontStyle: 'bold', fill: ncMovingCol,
        }));
        this._staticGroup.add(new Konva.Line({
            points: [this._ncPort.xb, this._ncPort.yb + this._termR,
                     this._ncPort.xb, this._ncContactY,
                     this._ncStaticRX, this._ncContactY],
            stroke: ncMovingCol, strokeWidth: 2,
        }));
        this._staticGroup.add(new Konva.Circle({
            x: this._ncStaticRX, y: this._ncContactY,
            radius: jR, fill: ncMovingCol,
        }));

        // 静触头接触块
        const padW = 12, padH = 6;
        this._staticGroup.add(new Konva.Rect({
            x: this._ncStaticLX - padW / 2, y: this._ncContactY - padH / 2,
            width: padW, height: padH,
            fill: ncStaticCol, cornerRadius: 1,
        }));
        this._staticGroup.add(new Konva.Rect({
            x: this._ncStaticRX - padW / 2, y: this._ncContactY - padH / 2,
            width: padW, height: padH,
            fill: ncMovingCol, cornerRadius: 1,
        }));


        // ── NO 触点（右下区域）────────────────────────
        // 端子 97（黑/静）→ 上行至 noContactY-hGap → 水平至左静触头 → 下行
        this._drawTermPost({ x: this._noPort.xa, y: this._noPort.ya }, noStaticCol);
        this._staticGroup.add(new Konva.Text({
            x: this._noPort.xa - 14, y: this._noPort.ya + this._termR + 2,
            text: '97', fontSize: fs, fontStyle: 'bold', fill: noStaticCol,
        }));
        this._staticGroup.add(new Konva.Line({
            points: [this._noPort.xa, this._noPort.ya ,
                     this._noStaticLX, this._noContactY + 40,
                     this._noStaticLX, this._noContactY],
            stroke: noStaticCol, strokeWidth: 2,
        }));
        this._staticGroup.add(new Konva.Circle({
            x: this._noStaticLX, y: this._noContactY,
            radius: jR, fill: noStaticCol,
        }));

        // 端子 98（红/动）→ 上行至 noContactY → 水平至右静触头
        this._drawTermPost({ x: this._noPort.xb, y: this._noPort.yb }, noMovingCol);
        this._staticGroup.add(new Konva.Text({
            x: this._noPort.xb - 14, y: this._noPort.yb + this._termR + 2,
            text: '98', fontSize: fs, fontStyle: 'bold', fill: noMovingCol,
        }));
        this._staticGroup.add(new Konva.Line({
            points: [this._noPort.xb, this._noPort.yb - this._termR,
                     this._noPort.xb, this._noContactY,
                     this._noStaticRX, this._noContactY],
            stroke: noMovingCol, strokeWidth: 2,
        }));
        this._staticGroup.add(new Konva.Circle({
            x: this._noStaticRX, y: this._noContactY,
            radius: jR, fill: noMovingCol,
        }));

        // 静触头接触块
        this._staticGroup.add(new Konva.Rect({
            x: this._noStaticLX - padW / 2, y: this._noContactY - padH / 2,
            width: padW, height: padH,
            fill: noStaticCol, cornerRadius: 1,
        }));
        this._staticGroup.add(new Konva.Rect({
            x: this._noStaticRX - padW / 2, y: this._noContactY - padH / 2,
            width: padW, height: padH,
            fill: noMovingCol, cornerRadius: 1,
        }));

        // 旋转支点标记
        this._staticGroup.add(new Konva.Line({
            points: [
                this._pivotX, this._pivotY - 5,
                this._pivotX - 5, this._pivotY + 4,
                this._pivotX + 5, this._pivotY + 4,
            ],
            stroke: '#809090', strokeWidth: 1.2, fill: '#c0c8d0',
            closed: true,
        }));
    }

    // ── 整定旋钮 + RESET 按钮 ─────────────────────────────────────
    _drawControls() {
        const R  = this._knobR;
        const kx = this._knobX, ky = this._knobY;
        const fs = Math.max(9, this.width * 0.019);
        const defR = this._defaultRated;

        // 虚线：旋钮 → 支点（电流整定对杠杆施加力）
        this._staticGroup.add(new Konva.Line({
            points: [kx, ky, this._pivotX, this._pivotY],
            stroke: '#7a8aaa', strokeWidth: 1.2, dash: [4, 3],
            lineCap: 'round',
        }));

        // 外环（金属质感）
        this._staticGroup.add(new Konva.Circle({
            x: kx, y: ky, radius: R,
            fillLinearGradientStartPoint: { x: -R, y: -R },
            fillLinearGradientEndPoint:   { x:  R, y:  R },
            fillLinearGradientColorStops: [0, '#505870', 0.35, '#7884a0', 0.7, '#606878', 1, '#384050'],
            stroke: '#202838', strokeWidth: 2,
        }));

        // 内圆（使用左侧面板颜色）
        this._staticGroup.add(new Konva.Circle({
            x: kx, y: ky, radius: R * 0.80,
            fillLinearGradientStartPoint: { x: -R * 0.8, y: -R * 0.8 },
            fillLinearGradientEndPoint:   { x:  R * 0.8, y:  R * 0.8 },
            fillLinearGradientColorStops: [0, '#f0ece3', 1, '#e8e0d2'],
            stroke: '#c0b8a8', strokeWidth: 1.2,
        }));

        // 刻度标记（围绕垂直向上线对称分布，-60° ~ +60°）
        for (let a = -60; a <= 60; a += 15) {
            const rad = (a - 90) * Math.PI / 180;
            const isMajor = a % 30 === 0;
            const r1 = R * 0.78, r2 = isMajor ? R * 0.68 : R * 0.72;
            this._staticGroup.add(new Konva.Line({
                points: [kx + r1 * Math.cos(rad), ky + r1 * Math.sin(rad),
                         kx + r2 * Math.cos(rad), ky + r2 * Math.sin(rad)],
                stroke: '#504030', strokeWidth: isMajor ? 2 : 1.2,
                lineCap: 'round',
            }));
            if (isMajor) {
                const val = defR * (1 + a / 60 * 0.5);
                const tr = R * 1.15;
                this._staticGroup.add(new Konva.Text({
                    x: kx + tr * Math.cos(rad) - 10,
                    y: ky + tr * Math.sin(rad) - 7,
                    text: val % 1 === 0 ? String(val) : val.toFixed(1),
                    fontSize: 12, fill: '#3a3028',
                }));
            }
        }

        // 整定值文字标签（加入动态组，避开静态缓存）
        this._ratedLabel = new Konva.Text({
            x: kx - R * 1.5, y: ky + R + 3,
            width: R * 3,
            text: `整定 ${this.ratedCurrent.toFixed(1)}A`,
            fontSize: 15, fontStyle: 'bold', fill: '#b01020', align: 'center',
            listening: false,
        });
        this._dynamicGroup.add(this._ratedLabel);

        // 中心圆盖
        this._staticGroup.add(new Konva.Circle({
            x: kx, y: ky, radius: R * 0.18,
            fill: '#384050', stroke: '#506070', strokeWidth: 1.2,
        }));

        // ── RESET 按钮（红色圆形，带机械联动示意） ────────
        const rr = this._resetBtnR;
        this._staticGroup.add(new Konva.Circle({
            x: this._resetBtnX, y: this._resetBtnY, radius: rr,
            fillLinearGradientStartPoint: { x: -rr, y: -rr },
            fillLinearGradientEndPoint:   { x:  rr, y:  rr },
            fillLinearGradientColorStops: [0, '#cc2020', 0.4, '#ee4040', 0.7, '#cc2020', 1, '#881010'],
            stroke: '#660808', strokeWidth: 1.5,
        }));
        this._staticGroup.add(new Konva.Text({
            x: this._resetBtnX - rr, y: this._resetBtnY - fs / 2,
            width: rr * 2, text: 'RESET', fontSize: fs - 1, fontStyle: 'bold',
            fill: '#fff8f0', align: 'center',
        }));
        // 机械联动虚线：按钮 → 支点
        this._staticGroup.add(new Konva.Line({
            points: [this._resetLinkX0, this._resetLinkY0,
                     this._resetLinkX1 , this._resetLinkY1],
            stroke: '#a0a8b8', strokeWidth: 1.2, dash: [4, 3],
            lineCap: 'round',
        }));

        // ── TEST 按钮（蓝色圆形，位于推杆左端上方） ──────
        const tr = this._testBtnR;
        this._staticGroup.add(new Konva.Circle({
            x: this._testBtnX, y: this._testBtnY, radius: tr,
            fillLinearGradientStartPoint: { x: -tr, y: -tr },
            fillLinearGradientEndPoint:   { x:  tr, y:  tr },
            fillLinearGradientColorStops: [0, '#3080d0', 0.4, '#50a0f0', 0.7, '#3080d0', 1, '#1050a0'],
            stroke: '#083880', strokeWidth: 1.5,
        }));
        this._staticGroup.add(new Konva.Text({
            x: this._testBtnX - tr, y: this._testBtnY - fs / 2,
            width: tr * 2, text: 'TEST', fontSize: fs - 1, fontStyle: 'bold',
            fill: '#fff8f0', align: 'center',
        }));
    }

    // ── 接线柱绘制（带金属光泽的圆形端子） ────────────────────────
    _drawTermPost(pos, color) {
        const R = this._termR, { x, y } = pos;
        // 外层金属圈（黄铜色渐变）
        this._staticGroup.add(new Konva.Circle({
            x, y, radius: R,
            fillLinearGradientStartPoint: { x: -R, y: -R },
            fillLinearGradientEndPoint:   { x:  R, y:  R },
            fillLinearGradientColorStops: [0, '#7a6a30', 0.4, '#d4aa52', 0.7, '#e8c86a', 1, '#8a7030'],
            stroke: '#6a5a28', strokeWidth: 1,
        }));
        // 内孔（暗色，模拟接线孔）
        this._staticGroup.add(new Konva.Circle({
            x, y, radius: R * 0.38, fill: '#2a1a08', stroke: '#5a4a20', strokeWidth: 0.6,
        }));
    }

    // ── 底部面板标签（位号 + 脱扣等级） ────────────────────────────
    _drawPanelLabel() {
    }

    // ════════════════════════════════════════════════════════════
    // 动态层
    // 所有动态节点在 _createDynamicNodes 中一次性创建，
    // 每帧通过 _updateDynamic() 做 in-place 属性修改，不销毁重建。
    // ════════════════════════════════════════════════════════════
    _createDynamicNodes() {
        this._createBimetals();          // 三相双金属片弯曲体（Konva.Shape 自定义绘制）
        this._createDeflectorPusher();   // 挡板 + 推杆（随弯曲量平移）
        this._createLinkLine();          // 联动虚线（推杆 → 触点臂支点）
        this._createContactArm();        // 触点臂（绕支点旋转的刚性杆）
        this._createContactBridges();    // NC/NO 触桥（水平杆 + 接触点）
        this._createTripIndicator();     // TRIP 指示灯 + 状态文字
        this._createKnobPointer();       // 整定旋钮指针（动态，随整定值旋转）

        // TEST 按钮 → 推杆左端 虚线（动端点随推杆移动）
        this._testLinkLine = new Konva.Line({
            points: [this._testBtnX, this._testBtnY + this._testBtnR,
                     this._pushRodX0, this._pushRodY],
            stroke: '#a0a8b8', strokeWidth: 1.2, dash: [4, 3],
            lineCap: 'round', listening: false,
        });
        this._dynamicGroup.add(this._testLinkLine);
    }

    // ── 三相双金属片弯曲体 ────────────────────────────────────────
    // 使用 Konva.Shape（自定义 Canvas 绘制）通过二次贝塞尔曲线
    // 模拟双金属片的热弯曲效果。
    //   固定端（上端）不动，自由端（下端）随 bendRatio 向右偏移。
    //   lo = 低膨胀层（深灰），hi = 高膨胀层（铜色）。
    _createBimetals() {
        const bw = this._bmsW;

        this._bmetalGroups = [];
        this._poleData.forEach((p, i) => {
            if (!this._activePoles[i]) return;
            const cx = p.cx;
            const pv = isFinite(this._poleBend[i]) ? this._poleBend[i] : 0;
            const initBend = pv * this._bmsMaxBend;
            const g = new Konva.Group({ listening: false });

            // 低膨胀层（左侧）
            // 通过 sceneFunc 在每帧重绘时读取 shape._bend 属性
            const lo = new Konva.Shape({
                sceneFunc: (ctx, shape) => {
                    const b = shape._bend || 0;
                    ctx.beginPath();
                    // 左上角 → 左下角（贝塞尔弯曲）
                    ctx.moveTo(cx - bw / 2, this._bmsTop);
                    ctx.quadraticCurveTo(
                        cx - bw / 2 + b * 0.3, this._bmsTop + this._bmsH * 0.5,
                        cx - bw / 2 + b, this._bmsBot
                    );
                    // 下边 → 右侧边 → 上边
                    ctx.lineTo(cx - bw / 2 + b + bw * 0.42, this._bmsBot);
                    ctx.quadraticCurveTo(
                        cx - bw / 2 + b * 0.3 + bw * 0.42, this._bmsTop + this._bmsH * 0.5,
                        cx - bw / 2 + bw * 0.42, this._bmsTop
                    );
                    ctx.closePath();
                    ctx.fillStrokeShape(shape);
                },
                fill: '#4a5060',
                stroke: '#384048', strokeWidth: 0.8,
                listening: false,
                opacity: 0.35,
            });
            lo._bend = initBend;  // 存弯曲量供 sceneFunc 读取
            g.add(lo);

            // 高膨胀层（右侧，铜色）
            const hi = new Konva.Shape({
                sceneFunc: (ctx, shape) => {
                    const b = shape._bend || 0;
                    const off = bw * 0.42;  // 相对于左层的偏移
                    ctx.beginPath();
                    ctx.moveTo(cx - bw / 2 + off, this._bmsTop);
                    ctx.quadraticCurveTo(
                        cx - bw / 2 + b * 0.3 + off, this._bmsTop + this._bmsH * 0.5,
                        cx - bw / 2 + b + off, this._bmsBot
                    );
                    ctx.lineTo(cx - bw / 2 + b + off + bw * 0.42, this._bmsBot);
                    ctx.quadraticCurveTo(
                        cx - bw / 2 + b * 0.3 + off + bw * 0.42, this._bmsTop + this._bmsH * 0.5,
                        cx - bw / 2 + off + bw * 0.42, this._bmsTop
                    );
                    ctx.closePath();
                    ctx.fillStrokeShape(shape);
                },
                fill: '#8a7040',
                stroke: '#705830', strokeWidth: 0.8,
                listening: false,
                opacity: 0.35,
            });
            hi._bend = initBend;
            g.add(hi);

            // 弯曲量标注箭头（仅在弯曲显著时显示）
            const arrowLine = new Konva.Line({
                points: [cx, this._bmsBot + 3, cx + initBend, this._bmsBot + 3],
                stroke: '#e0a030', strokeWidth: 1.5, lineCap: 'round',
                visible: initBend > 2, listening: false,
            });
            g.add(arrowLine);

            this._dynamicGroup.add(g);
            this._bmetalGroups.push({ g, lo, hi, arrowLine, cx: p.cx, idx: i });
        });
    }

    // ── 挡板（Deflector）+ 推杆（Push Rod）─────────────────────────
    // 挡板为横向刚性板，连接三相双金属片自由端。
    // 过载时三相弯曲产生的位移通过挡板传递到推杆，
    // 推杆再推动弹跳机构使触点切换。
    // ── 挡板位移量（死区：弯曲量须超过挡片间隙才开始移动） ──────
    // 位移 = 双金属片底端实际偏移量 - 死区间隙
    _getDeflectorDx() {
        const bendPx = this._bendRatio * this._bmsMaxBend;
        return Math.max(0, bendPx - this._tabGapPx);
    }

    _createDeflectorPusher() {
        const dx  = this._getDeflectorDx();
        const dY  = this._deflectorY;
        const dH  = this._deflectorH;
        const baseX0 = this._deflBaseX0;
        const baseX1 = this._deflBaseX1;
        const deflW  = baseX1 - baseX0;

        // 挡板主体（横跨三相的铝合金色条）
        this._deflector = new Konva.Rect({
            x: baseX0 + dx, y: dY,
            width: deflW, height: dH,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: 0, y: dH },
            fillLinearGradientColorStops: [0, '#8090a8', 0.5, '#b0c0d0', 1, '#7080a0'],
            stroke: '#506080', strokeWidth: 1.2,
            cornerRadius: 2,
        });
        this._deflector._baseX = baseX0;
        this._dynamicGroup.add(this._deflector);

        // 3 个垂直挡片（从挡板上缘向上伸出，各位于双金属片右侧）
        this._tabs = this._tabBaseXs.map(tx => {
            const tab = new Konva.Rect({
                x: tx + dx - this._tabW / 2, y: dY - this._tabH,
                width: this._tabW, height: this._tabH,
                fill: '#90a0b8', stroke: '#607080', strokeWidth: 0.8,
                cornerRadius: 1,
            });
            tab._baseX = tx;
            this._dynamicGroup.add(tab);
            return tab;
        });

        // 推杆（从左区挡板水平延伸至右区触点机构）
        const rodY = dY + dH / 2;
        this._pushRod = new Konva.Line({
            points: [this._pushRodX0 + dx, rodY, this._pushRodX1 + dx * 0.85, rodY],
            stroke: '#a0b0c0', strokeWidth: 3,
            lineCap: 'round', listening: false,
        });
        this._pushRod._baseX0 = this._pushRodX0;
        this._pushRod._baseX1 = this._pushRodX1;
        this._dynamicGroup.add(this._pushRod);

        // 分隔板导孔（推杆穿过隔板的金属衬套）
        this._guideBushing = new Konva.Rect({
            x: this._divX - 3, y: rodY - 4,
            width: 6, height: 8,
            fill: '#607080', stroke: '#405060', strokeWidth: 1,
            cornerRadius: 1, listening: false,
        });
        this._dynamicGroup.add(this._guideBushing);

        // 推杆头（圆形末端）
        this._pushRodHead = new Konva.Circle({
            x: this._pushRodX1 + dx * 0.85, y: rodY,
            radius: 4,
            fill: '#c0d0e0', stroke: '#809090', strokeWidth: 1,
        });
        this._dynamicGroup.add(this._pushRodHead);

    }

    // ── 曲柄连杆（从推杆头到触点臂支点的刚性传动杆）─────────────
    _createLinkLine() {
        const dx = this._getDeflectorDx();
        const rodY = this._deflectorY + this._deflectorH / 2;

        // 曲柄臂（实心连杆，展示机械传动关系）
        this._linkLine = new Konva.Line({
            points: [
                this._pushRodX1 + dx * 0.85, rodY,
                this._pivotX, this._pivotY,
            ],
            stroke: '#4a7aaa', strokeWidth: 3,
            lineCap: 'round', listening: false,
        });
        this._dynamicGroup.add(this._linkLine);

        // 推杆端关节销
        this._jointPin0 = new Konva.Circle({
            x: this._pushRodX1 + dx * 0.85, y: rodY,
            radius: 2.5, fill: '#c0d0e0', stroke: '#4a7aaa', strokeWidth: 1.2,
            listening: false,
        });
        this._dynamicGroup.add(this._jointPin0);

        // 支点端关节销
        this._jointPin1 = new Konva.Circle({
            x: this._pivotX, y: this._pivotY,
            radius: 2.5, fill: '#c0d0e0', stroke: '#4a7aaa', strokeWidth: 1.2,
            listening: false,
        });
        this._dynamicGroup.add(this._jointPin1);
    }

    // ── 触点臂 ────────────────────────────────────────────────────
    // 绕 pivotX/pivotY 旋转的刚性臂，两端分别连至 NC/NO 触桥中心
    _createContactArm() {
        const angle = this._armAngleCur;
        const ncRelY = this._ncContactY - this._pivotY;
        const noRelY = this._noContactY - this._pivotY;
        const bridgeCX = (this._ncStaticLX + this._ncStaticRX) / 2;
        const armOffX = bridgeCX - this._pivotX + 8;
        const margin = Math.max(12, this.height * 0.06);

        this._armGroup = new Konva.Group({
            x: this._pivotX, y: this._pivotY,
            rotation: angle * 180 / Math.PI,
            listening: false,
        });

        // 刚性臂主体（两端各缩短 margin，指向触桥中心）
        const ncy0 = ncRelY + margin;
        const ncy1 = noRelY - margin;
        this._armGroup.add(new Konva.Line({
            points: [armOffX, ncy0, armOffX, ncy1],
            stroke: '#6070a0', strokeWidth: 8, lineCap: 'round',
        }));

        // 支点圆圈
        this._armGroup.add(new Konva.Circle({
            x: 0, y: 0, radius: 5,
            fill: '#c0c8d8', stroke: '#809098', strokeWidth: 1.2,
        }));

        // NC 动触头连接点（臂上端）
        this._armGroup.add(new Konva.Circle({
            x: armOffX, y: ncy0, radius: 3.5,
            fill: '#e06020', stroke: '#b04010', strokeWidth: 1,
        }));

        // NO 动触头连接点（臂下端）
        this._armGroup.add(new Konva.Circle({
            x: armOffX, y: ncy1, radius: 3.5,
            fill: '#2080d0', stroke: '#1060b0', strokeWidth: 1,
        }));

        // ── 虚线连杆（从臂端到静触头） ────────────────
        // NC：从臂端到静触头 (ncStaticLX, ncContactY)
        this._ncArmLine = new Konva.Line({
            points: [
                this._pivotX + armOffX, this._pivotY + ncy0,
                this._ncStaticLX, this._ncContactY,
            ],
            stroke: '#8a9bb8', strokeWidth: 1.5, dash: [5, 4],
            lineCap: 'round', listening: false,
        });
        this._dynamicGroup.add(this._ncArmLine);

        // NO：从臂端到静触头 (noStaticLX, noContactY)
        this._noArmLine = new Konva.Line({
            points: [
                this._pivotX + armOffX, this._pivotY + ncy1,
                this._noStaticLX, this._noContactY,
            ],
            stroke: '#8a9bb8', strokeWidth: 1.5, dash: [5, 4],
            lineCap: 'round', listening: false,
        });
        this._dynamicGroup.add(this._noArmLine);

        this._armOffX = armOffX;
        this._armMargin = margin;
        this._ncRelY = ncRelY;
        this._noRelY = noRelY;
        this._armNCY = ncy0;
        this._armNOY = ncy1;

        this._dynamicGroup.add(this._armGroup);
    }

    // ── NC / NO 触桥 ──────────────────────────────────────────────
    _createContactBridges() {
        const angle = this._armAngleCur, bW = this._bridgeW;

        // ── NC 触桥 ──────────────────────────────
        const ncRightY = this._ncContactY - Math.sin(angle) * bW;
        this._ncBridge = new Konva.Group({ listening: false });

        // 触桥主体（粗线，左端固定于动触头连接点，右端摆臂）
        this._ncBridgeLine = new Konva.Line({
            points: [
                this._ncStaticLX, this._ncContactY,
                this._ncStaticRX, ncRightY,
            ],
            stroke: '#e06020', strokeWidth: 4, lineCap: 'round',
        });
        this._ncBridge.add(this._ncBridgeLine);

        // 左端动触头（始终与左静触头接触，银色圆点+橙色外圈）
        this._ncBridge.add(new Konva.Circle({
            x: this._ncStaticLX, y: this._ncContactY,
            radius: 4.5, fill: '#f0f0f0', stroke: '#e06020', strokeWidth: 1.5,
        }));
        // 右端动触头（正常时接触右静触头，跳脱时抬起）
        this._ncRightContact = new Konva.Circle({
            x: this._ncStaticRX, y: ncRightY,
            radius: 4.5, fill: '#f0f0f0', stroke: '#e06020', strokeWidth: 1.5,
        });
        this._ncBridge.add(this._ncRightContact);

        this._dynamicGroup.add(this._ncBridge);

        // NC 接触高光（闭合时显示橙色光晕）
        this._ncGlow = new Konva.Circle({
            x: this._ncStaticRX, y: this._ncContactY,
            radius: 8, fill: 'rgba(255,180,60,0.30)',
            visible: this._state !== 'tripped', listening: false,
        });
        this._dynamicGroup.add(this._ncGlow);

        // NC 断开间隙虚线
        this._ncGapLine = new Konva.Line({
            points: [this._ncStaticRX, ncRightY, this._ncStaticRX, this._ncContactY],
            stroke: 'rgba(220,80,20,0.60)', strokeWidth: 1.5,
            dash: [4, 3], lineCap: 'round',
            visible: angle > 0.05, listening: false,
        });
        this._dynamicGroup.add(this._ncGapLine);

        // ── NO 触桥 ──────────────────────────────
        // 常态（angle=0）：noRightY = noContactY - maxLift（断开，右端悬空高于静触点）
        // 跳脱（angle=28°）：noRightY = noContactY - maxLift + maxLift = noContactY（闭合）
        const noRightY = this._noContactY - this._noMaxLift + Math.sin(angle) * bW * 0.7;
        this._noBridge = new Konva.Group({ listening: false });

        this._noBridgeLine = new Konva.Line({
            points: [
                this._noStaticLX, this._noContactY,
                this._noStaticRX, noRightY,
            ],
            stroke: '#2080d0', strokeWidth: 4, lineCap: 'round',
        });
        this._noBridge.add(this._noBridgeLine);

        // 左端动触头
        this._noBridge.add(new Konva.Circle({
            x: this._noStaticLX, y: this._noContactY,
            radius: 4.5, fill: '#f0f0f0', stroke: '#2080d0', strokeWidth: 1.5,
        }));
        // 右端动触头
        this._noRightContact = new Konva.Circle({
            x: this._noStaticRX, y: noRightY,
            radius: 4.5, fill: '#f0f0f0', stroke: '#2080d0', strokeWidth: 1.5,
        });
        this._noBridge.add(this._noRightContact);

        this._dynamicGroup.add(this._noBridge);

        // NO 接触高光（过载闭合时显示蓝色光晕）
        this._noGlow = new Konva.Circle({
            x: this._noStaticRX, y: this._noContactY,
            radius: 8, fill: 'rgba(60,180,255,0.30)',
            visible: this._state === 'tripped', listening: false,
        });
        this._dynamicGroup.add(this._noGlow);
    }

    // ── TRIP 指示灯 + 状态文字 ────────────────────────────────────
    _createTripIndicator() {
        const ledX = this.width - 100;
        const ledY = 12;
        const R    = 8;

        // TRIP 指示灯（红色 = 跳脱，暗红 = 正常）
        this._tripLed = new Konva.Circle({
            x: ledX, y: ledY, radius: R,
            fill: this._state === 'tripped' ? '#ff3020' : '#301010',
            stroke: '#502020', strokeWidth: 1.5, listening: false,
        });
        this._dynamicGroup.add(this._tripLed);

        // TRIP 文字标签
        this._tripLedLabel = new Konva.Text({
            x: ledX - 12, y: ledY + R + 2,
            text: 'TRIP',
            fontSize: Math.max(10, this.width * 0.017),
            fontStyle: 'bold',
            fill: this._state === 'tripped' ? '#ff4030' : '#504040',
            listening: false,
        });
        this._dynamicGroup.add(this._tripLedLabel);

        // 底部状态文字（显示当前运行状态：空载/运行/升温中/过载跳脱）
        this._stateLabel = new Konva.Text({
            x: this._divX + 6,
            y: this.height - 20,
            text: this._getStateLabelText(),
            fontSize: Math.max(12, this.width * 0.019),
            fill: this._getStateLabelColor(),
            listening: false,
        });
        this._dynamicGroup.add(this._stateLabel);
    }

    // ── 整定旋钮指针（动态元素，随整定值旋转） ─────────────────
    _createKnobPointer() {
        const R  = this._knobR;
        const kx = this._knobX, ky = this._knobY;

        // 指针：从中心附近指向刻度边缘，角度由整定值决定
        this._knobPointer = new Konva.Line({
            points: [0, 0, 0, 0],
            stroke: '#e03030', strokeWidth: 3, lineCap: 'round',
            listening: false,
        });
        this._updateKnobPointer();
        this._dynamicGroup.add(this._knobPointer);
    }

    _updateKnobPointer() {
        const R  = this._knobR;
        const kx = this._knobX, ky = this._knobY;
        const defR = this._defaultRated;
        const ratio = defR > 0 ? this.ratedCurrent / defR : 1;
        const angleDeg = -90 + (ratio - 1.0) * 120;
        const rad = angleDeg * Math.PI / 180;
        this._knobPointer.points([
            kx + R * 0.22 * Math.cos(rad + Math.PI),
            ky + R * 0.22 * Math.sin(rad + Math.PI),
            kx + R * 0.72 * Math.cos(rad),
            ky + R * 0.72 * Math.sin(rad),
        ]);
    }

    // ── 状态文字生成（根据 _state 和 _loadRatio 返回中文描述） ────
    _getStateLabelText() {
        if (this._state === 'tripped')   return '⚡ 过载跳脱';
        if (this._state === 'loading')   return `▲ 升温中 ${Math.round(this._heatLevel * 100)}%`;
        if (this._loadRatio > 0.1)       return `● 运行 ${Math.round(this._loadRatio * 100)}%`;
        return '○ 空载';
    }

    // ── 状态文字颜色 ──────────────────────────────────────────────
    _getStateLabelColor() {
        if (this._state === 'tripped') return '#ff4030';
        if (this._state === 'loading') return '#e0a020';
        if (this._loadRatio > 0.1)     return '#30c050';
        return '#607080';
    }

    // ════════════════════════════════════════════════════════════
    // 动态更新（每帧 in-place 修改，不销毁重建节点）
    // ════════════════════════════════════════════════════════════
    _updateDynamic() {
        this._heatLevel   = isFinite(this._heatLevel)   ? this._heatLevel   : 0;
        this._bendRatio   = isFinite(this._bendRatio)   ? this._bendRatio   : 0;
        this._armAngleCur = isFinite(this._armAngleCur) ? this._armAngleCur : 0;

        // 脏检查：无变化时跳过全部属性设置（90% 的稳态帧走此路径）
        const _bd = this._bendRatio, _ag = this._armAngleCur, _hl = this._heatLevel;
        const _tdx = this._testPushDx || 0;
        const _dirty =
            !this._san || Math.abs(_bd - this._san.bd) > 1e-6 ||
            Math.abs(_ag - this._san.ag) > 1e-9 ||
            this._state !== this._san.st ||
            this._poleBend.some((v, i) => Math.abs(v - (this._san.pb ? this._san.pb[i] : -1)) > 1e-6) ||
            Math.abs(_tdx - this._san.tdx) > 1e-6;
        this._san = { bd: _bd, ag: _ag, hl: _hl, st: this._state, pb: [...this._poleBend], tdx: _tdx };
        if (_dirty) {
            const bend  = _bd * this._bmsMaxBend;
            const angle = _ag;
            const ratio = _bd;

            this._bmetalGroups.forEach(({ lo, hi, arrowLine, cx, idx }) => {
                const pv = isFinite(this._poleBend[idx]) ? this._poleBend[idx] : 0;
                const pb = pv * this._bmsMaxBend;
                lo._bend = pb;
                hi._bend = pb;
                arrowLine.points([
                    cx, this._bmsBot + 3,
                    cx + pb, this._bmsBot + 3,
                ]);
                arrowLine.visible(pb > 2);
            });

            const dx    = this._getDeflectorDx();
            const prDx  = dx + this._testPushDx;   // 推杆独立偏移（TEST 时额外右移）
            const dBase = this._deflector._baseX;
            const rodY  = this._deflectorY + this._deflectorH / 2;

            // 挡板/挡片只跟随 dx（bendRatio），不受 TEST 影响
            this._deflector.x(dBase + dx);
            this._tabs.forEach(tab => tab.x(tab._baseX + dx - this._tabW / 2));

            // 推杆系使用合并偏移 prDx（TEST 时也右移）
            const rd0 = this._pushRod._baseX0;
            const rd1 = this._pushRod._baseX1;
            this._pushRod.points([rd0 + prDx, rodY, rd1 + prDx * 0.85, rodY]);
            this._pushRodHead.x(rd1 + prDx * 0.85);
            this._pushRodHead.y(rodY);

            this._linkLine.points([rd1 + prDx * 0.85, rodY, this._pivotX, this._pivotY]);
            this._linkLine.stroke(`rgba(74,122,170,${0.45 + ratio * 0.50})`);
            this._jointPin0.x(rd1 + prDx * 0.85);
            this._jointPin0.y(rodY);

            // TEST 虚线端点跟随推杆左端
            this._testLinkLine.points([
                this._testBtnX, this._testBtnY + this._testBtnR,
                rd0 + prDx, rodY,
            ]);

            this._armGroup.rotation(angle * 180 / Math.PI);

            // 虚线连杆端点（用标准旋转矩阵匹配 Konva 的变换）
            const cosA = Math.cos(angle), sinA = Math.sin(angle);
            const ncx = this._pivotX + this._armOffX * cosA - this._armNCY * sinA;
            const ncy = this._pivotY + this._armOffX * sinA + this._armNCY * cosA;
            this._ncArmLine.points([ncx, ncy, this._ncStaticLX, this._ncContactY]);
            const nox = this._pivotX + this._armOffX * cosA - this._armNOY * sinA;
            const noy = this._pivotY + this._armOffX * sinA + this._armNOY * cosA;
            this._noArmLine.points([nox, noy, this._noStaticLX, this._noContactY]);

            const ncRightY = this._ncContactY - Math.sin(angle) * this._bridgeW;
            this._ncBridgeLine.points([
                this._ncStaticLX, this._ncContactY,
                this._ncStaticRX, ncRightY,
            ]);
            this._ncRightContact.x(this._ncStaticRX);
            this._ncRightContact.y(ncRightY);

            const ncOpen = angle > 0.04;
            this._ncGapLine.points([this._ncStaticRX, ncRightY, this._ncStaticRX, this._ncContactY]);
            this._ncGapLine.visible(ncOpen);
            this._ncGlow.visible(!ncOpen);

            const gapPx = Math.round(Math.sin(angle) * this._bridgeW);
            if (ncOpen && !this._ncGapText) {
                this._ncGapText = new Konva.Text({
                    x: this._ncStaticRX + 8, y: (ncRightY + this._ncContactY) / 2 - 5,
                    text: `↕ ${gapPx}px`, fontSize: Math.max(8, this.width * 0.016),
                    fill: '#ff8040', listening: false,
                });
                this._dynamicGroup.add(this._ncGapText);
            } else if (this._ncGapText) {
                if (ncOpen) {
                    this._ncGapText.visible(true);
                    this._ncGapText.x(this._ncStaticRX + 8);
                    this._ncGapText.y((ncRightY + this._ncContactY) / 2 - 5);
                    this._ncGapText.text(`↕ ${gapPx}px`);
                } else {
                    this._ncGapText.visible(false);
                }
            }

            const noRightY = this._noContactY - this._noMaxLift + Math.sin(angle) * this._bridgeW * 0.7;
            this._noBridgeLine.points([
                this._noStaticLX, this._noContactY,
                this._noStaticRX, noRightY,
            ]);
            this._noRightContact.x(this._noStaticRX);
            this._noRightContact.y(noRightY);

            const noClosed = (this._noContactY - noRightY) < 2;
            this._noGlow.visible(noClosed);

            const tripped = this._state === 'tripped';
            this._tripLed.fill(tripped ? '#ff3020' : (ratio > 0.5 ? '#802010' : '#301010'));
            this._tripLedLabel.fill(tripped ? '#ff4030' : (ratio > 0.5 ? '#c04020' : '#504040'));
        }

        // 状态标签每帧更新（含百分比数字）
        this._stateLabel.text(this._getStateLabelText());
        this._stateLabel.fill(this._getStateLabelColor());

        // 整定旋钮指针 + 文字标签（无条件更新）
        this._updateKnobPointer();
        this._ratedLabel && this._ratedLabel.text(`整定 ${this.ratedCurrent.toFixed(1)}A`);
    }

    // ════════════════════════════════════════════════════════════
    // 交互绑定
    // RESET 按钮 → 跳脱后手动复位
    // ════════════════════════════════════════════════════════════
    _bindInteraction() {
        // 整定旋钮交互：滚轮 + 垂直拖动
        const defR = this._defaultRated;
        const step = Math.max(0.1, defR * 0.02);
        const clamp = (v) => Math.max(defR * 0.5, Math.min(defR * 1.5,
            Math.round(v / step) * step));

        const knobHit = new Konva.Circle({
            x: this._knobX, y: this._knobY, radius: this._knobR * 0.80,
            draggable: true, fill: 'transparent',
        });
        // 滚轮
        knobHit.on('wheel', (e) => {
            e.evt.preventDefault();
            e.evt.stopPropagation();
            this.ratedCurrent = clamp(this.ratedCurrent + (e.evt.deltaY < 0 ? step : -step));
            this._redrawDynamic();
        });
        // 垂直拖动（draggable 阻止父级拖拽，dragmove 中重置位置）
        const origX = this._knobX, origY = this._knobY;
        let dragY = 0, dragAccum = 0;
        knobHit.on('dragstart', (e) => {
            dragY = knobHit.getStage().getPointerPosition().y;
            dragAccum = 0;
            e.cancelBubble = true;
        });
        knobHit.on('dragmove', (e) => {
            e.cancelBubble = true;
            const curY = knobHit.getStage().getPointerPosition().y;
            const dy = dragY - curY;
            dragY = curY;
            dragAccum += dy;
            const s = Math.round(dragAccum / 12);
            if (s !== 0) {
                this.ratedCurrent = clamp(this.ratedCurrent + s * step);
                this._redrawDynamic();
                dragAccum -= s * 12;
            }
            knobHit.position({ x: origX, y: origY });
        });
        knobHit.on('dragend', (e) => {
            e.cancelBubble = true;
            knobHit.position({ x: origX, y: origY });
        });
        knobHit.on('mouseenter', () => { document.body.style.cursor = 'pointer'; });
        knobHit.on('mouseleave', () => { document.body.style.cursor = 'default'; });
        this._interactGroup.add(knobHit);

        // RESET 按钮点击热区（圆形）
        const resetHit = new Konva.Circle({
            x: this._resetBtnX, y: this._resetBtnY, radius: this._resetBtnR,
            fill: 'transparent',
        });
        resetHit.on('click tap', () => { this.reset(); });
        resetHit.on('mouseenter', () => { document.body.style.cursor = 'pointer'; });
        resetHit.on('mouseleave', () => { document.body.style.cursor = 'default'; });
        this._interactGroup.add(resetHit);

        // TEST 按钮：按下脱扣，松开还原
        const testHit = new Konva.Circle({
            x: this._testBtnX, y: this._testBtnY, radius: this._testBtnR,
            fill: 'transparent',
        });
        const onTestDown = () => { this._testPressed = true; };
        const onTestUp   = () => { this._testPressed = false; };
        testHit.on('mousedown touchstart', onTestDown);
        testHit.on('mouseup touchend', onTestUp);
        // 鼠标移出按钮也视为释放
        testHit.on('mouseleave', onTestUp);
        testHit.on('mouseenter', () => { document.body.style.cursor = 'pointer'; });
        testHit.on('mouseleave', () => { document.body.style.cursor = 'default'; });
        this._interactGroup.add(testHit);
    }

    // ════════════════════════════════════════════════════════════
    // tick(dt) — 20fps 仿真循环入口
    //
    // 每帧执行：
    //   1. 三相 RMS 电流测量
    //      从 _phaseCurrents（由 CircuitSolver 回填）读取每相瞬时电流，
    //      更新 40 点滑动平方和缓冲区，计算有效值。
    //      取三相最大 RMS 值与 ratedCurrent 的比值 → setLoad(ratio)
    //      当 ratio ≥ 1.0 时触发 overload() → loading 状态。
    //   2. 动画更新（_tickAnimation）
    //      loading 状态：heatLevel 累积，bendRatio 递增
    //      reset 动画：bendRatio 和 armAngle 插值归零
    //   3. 重绘判定
    //      若有任何动态变化则调用 _updateDynamic() + markDirty()
    // ════════════════════════════════════════════════════════════
    tick(dt) {
        // ── 三相电流 RMS 测量 ──────────────────────────────────────
        // _phaseCurrents[0..2] 由 CircuitSolver._updateDeviceCurrents 每帧回填
        // 计算公式：I_phase = (V_li - V_ti) / _phaseResistance
        if (this._phaseCurrents && this._phaseCurrents.length === 3) {
            for (let i = 0; i < 3; i++) {
                const iInst = isFinite(this._phaseCurrents[i]) ? this._phaseCurrents[i] : 0;
                const i2 = iInst * iInst;
                const old = this._iBuf[i][this._iBufIdx];
                this._iBuf[i][this._iBufIdx] = i2;
                this._iBufSum[i] = this._iBufSum[i] - old + i2;
            }
            // 循环写指针 + 计数器
            this._iBufIdx = (this._iBufIdx + 1) % 40;
            if (this._iBufCount < 40) this._iBufCount++;

            // 缓冲区满 40 点后开始计算 RMS
            if (this._iBufCount >= 40) {
                for (let i = 0; i < 3; i++) {
                    this._iRms[i] = Math.sqrt(this._iBufSum[i] / 40);
                    // 每相负载比独立计算
                    this._poleLoadRatio[i] = this.ratedCurrent > 0
                        ? this._iRms[i] / this.ratedCurrent : 0;
                }
                // 汇总值兼容外部 API 读取
                this._loadRatio = Math.max(...this._poleLoadRatio);
            }
        }

        // ── 动画更新（热量累积 / 复位插值） ────────────────────────
        this._tickAnimation(dt);

        // ── 每帧更新动态节点位置 ──
        // _refreshIfDirty() 仅在首次（_cacheDirty=true）建立静态缓存，
        // 之后每帧 check 但无操作；不由 markDirty() 触发，避免每帧重建缓存。
        this._animJustEnded = false;
        this._updateDynamic();
        this._refreshIfDirty();
        if (this.sys && typeof this.sys.requestRedraw === 'function') {
            this.sys.requestRedraw();
        }
    }

    // ── 帧动画逻辑 ────────────────────────────────────────────────
    _tickAnimation(dt) {
        // 确保数组有效
        for (let i = 0; i < 3; i++) {
            this._poleHeat[i] = isFinite(this._poleHeat[i]) ? this._poleHeat[i] : 0;
            this._poleBend[i] = isFinite(this._poleBend[i]) ? this._poleBend[i] : 0;
        }
        this._armAngleCur = isFinite(this._armAngleCur) ? this._armAngleCur : 0;

        // ── TEST 按钮强制脱扣（机械推杆模拟，优先于所有状态机） ──
        if (this._testPressed) {
            this._testPushDx   = this._bmsMaxBend;
            this._armAngleCur  = this._armAngleTripped;
            this._state        = 'tripped';
            return;
        } else if (this._testPushDx !== 0) {
            this._testPushDx   = 0;
        }

        // ── 复位动画优先 ──
        // reset() 设 _state='normal' 后启动动画，必须在状态块之前拦截
        if (this._animating) {
            this._animT += dt / this._animDur;
            if (this._animT >= 1) {
                this._animT         = 1;
                this._animating     = false;
                this._animJustEnded = true;
                for (let i = 0; i < 3; i++) {
                    if (this._activePoles[i]) {
                        this._poleBend[i] = this._animToBend;
                        this._poleHeat[i] = 0;
                    }
                }
                this._bendRatio   = this._animToBend;
                this._heatLevel   = 0;
                this._armAngleCur = this._animToAngle;
                return;
            }
            const ease = 0.5 - 0.5 * Math.cos(this._animT * Math.PI);
            const curBend = this._animFromBend + (this._animToBend - this._animFromBend) * ease;
            for (let i = 0; i < 3; i++) {
                if (this._activePoles[i]) this._poleBend[i] = curBend;
            }
            this._bendRatio   = curBend;
            this._armAngleCur = this._animFromAngle + (this._animToAngle - this._animFromAngle) * ease;
            return;
        }

        // 正常状态：检测是否触发过载
        if (this._state === 'normal') {
            let anyOverload = false;
            for (let i = 0; i < 3; i++) {
                if (!this._activePoles[i]) continue;
                if (this._poleLoadRatio[i] >= 1.0) { anyOverload = true; break; }
            }
            if (anyOverload) {
                this._state = 'loading';
                for (let i = 0; i < 3; i++) this._poleHeat[i] = 0;
                this._armAngleCur = 0;
            } else {
                // 正常偏转：各相按负载比弯曲
                for (let i = 0; i < 3; i++) {
                    if (!this._activePoles[i]) continue;
                    this._poleBend[i] = Math.min(this._poleLoadRatio[i] * 0.85, 0.95);
                    this._poleHeat[i] = 0;
                }
            }
            this._bendRatio = this._getMaxActiveBend();
            this._heatLevel = 0;
            return;
        }

        // loading 状态：各相独立累积热量和弯曲
        if (this._state === 'loading') {
            for (let i = 0; i < 3; i++) {
                if (!this._activePoles[i]) continue;
                const r = this._poleLoadRatio[i];

                let bendRate, tripRate;
                if (r <= 1.0)       bendRate = -0.4;
                else if (r < 1.1)   bendRate = 0.1;
                else if (r < 1.2)   bendRate = 0.2;
                else if (r < 1.5)   bendRate = 1 / 3;
                else                bendRate = 1.0;

                if (r <= 1.0)       tripRate = -0.4;
                else if (r < 1.2)   tripRate = 0.001+(r-1.0)*0.25;
                else if (r < 1.5)   tripRate = 0.05 + 0.5 * (r - 1.2);
                else                tripRate = 1 / 5;

                this._poleBend[i] = Math.max(0, Math.min(1.0, this._poleBend[i] + dt * bendRate));
                this._poleHeat[i] = Math.max(0, Math.min(1.0, this._poleHeat[i] + dt * tripRate));
            }

            this._bendRatio = this._getMaxActiveBend();
            this._heatLevel = this._getMaxActiveHeat();
            this._armAngleCur = this._heatLevel * this._armAngleTripped;

            if (this._heatLevel >= 1.0) {
                this._state = 'tripped';
                this.opsCount++;
                // 各极保持各自的实际热量/弯曲值（由逐相累积得到，不强制设 1.0）
                this._bendRatio   = this._getMaxActiveBend();
                this._heatLevel   = this._getMaxActiveHeat();
                this._armAngleCur = this._armAngleTripped;
            } else if (this._heatLevel <= 0 && this._bendRatio <= 0) {
                this._state = 'normal';
                for (let i = 0; i < 3; i++) {
                    this._poleHeat[i] = 0;
                    this._poleBend[i] = 0;
                }
                this._armAngleCur = 0;
            }
            return;
        }

        // tripped 状态：各相按负载比散热，触点保持跳脱
        if (this._state === 'tripped') {
            for (let i = 0; i < 3; i++) {
                if (!this._activePoles[i]) continue;
                const r = this._poleLoadRatio[i];
                if (r >= 0.8) {
                    this._poleHeat[i] = Math.min(1.0, this._poleHeat[i] + dt * 0.55);
                } else if (this._poleHeat[i] > 0) {
                    this._poleHeat[i] = Math.max(0, this._poleHeat[i] - dt * 0.4);
                }
                this._poleBend[i] = this._poleHeat[i];
            }
            this._bendRatio   = this._getMaxActiveBend();
            this._heatLevel   = this._bendRatio;
            this._armAngleCur = this._armAngleTripped;
            return;
        }
    }

    _getMaxActiveBend() {
        let m = 0;
        for (let i = 0; i < 3; i++) {
            const v = this._poleBend[i];
            if (this._activePoles[i] && isFinite(v) && v > m) m = v;
        }
        return m;
    }

    _getMaxActiveHeat() {
        let m = 0;
        for (let i = 0; i < 3; i++) {
            const v = this._poleHeat[i];
            if (this._activePoles[i] && isFinite(v) && v > m) m = v;
        }
        return m;
    }

    // ════════════════════════════════════════════════════════════
    // 公开 API
    // ════════════════════════════════════════════════════════════

    /** 模拟过载 — 进入 loading 状态，热量从零开始累积 → 最终自动跳脱 */
    overload() {
        if (this._state === 'tripped') return;
        this._state      = 'loading';
        for (let i = 0; i < 3; i++) {
            if (this._activePoles[i]) {
                this._poleHeat[i] = 0;
                this._poleLoadRatio[i] = Math.max(this._poleLoadRatio[i], 1.0);
            }
        }
        this._heatLevel  = 0;
        this._armAngleCur = 0;
        this._redrawDynamic();
    }

    /** 立即跳脱 — 跳过加热过程，直接进入 tripped 状态 */
    trip() {
        this._state       = 'tripped';
        for (let i = 0; i < 3; i++) {
            if (this._activePoles[i]) {
                this._poleBend[i] = 1.0;
                this._poleHeat[i] = 1.0;
            }
        }
        this._bendRatio   = 1.0;
        this._armAngleCur = this._armAngleTripped;
        this._heatLevel   = 1.0;
        this._animating   = false;
        this.opsCount++;
        this._redrawDynamic();
    }

    /** 复位 — 从 tripped → normal，播放 1s 缓出动画
     *  热态锁：双金属片弯曲量超过阈值时拒绝复位，需冷却后才生效 */
    reset() {
        if (this._state !== 'tripped') return;
        // 双金属片仍处于弯曲状态（未冷却）时锁定复位
        if (this._getMaxActiveBend() > 0.3) return;
        this._state       = 'normal';
        this._animating   = true;
        this._animT       = 0;
        this._animDur     = 1.0;
        this._animFromBend  = this._bendRatio;
        this._animToBend    = 0;
        this._animFromAngle = this._armAngleCur;
        for (let i = 0; i < 3; i++) this._poleHeat[i] = 0;
        this._heatLevel     = 0;
        this._animToAngle   = 0;
        this._redrawDynamic();
    }

    /**
     * 设置热元件负载比（0~1.5）
     * 由外部手动调用，设所有相的负载相同。
     * @param {number} r 负载比：0=空载, 1=额定, ≥1=过载触发跳闸
     */
    setLoad(r) {
        r = Math.max(0, Math.min(1.5, r));
        this._loadRatio = r;
        for (let i = 0; i < 3; i++) {
            if (this._activePoles[i]) this._poleLoadRatio[i] = r;
        }
        // 负载 ≥ 1.0 且当前为 normal → 触发过载序列
        if (r >= 1.0 && this._state === 'normal') {
            this.overload();
            return;
        }
        // 在 normal 状态下仅更新双金属片视觉（弯曲/挡板/推杆），不触发触点动作
        if (this._state === 'normal') {
            const b = Math.min(r * 0.85, 0.95);
            for (let i = 0; i < 3; i++) {
                if (this._activePoles[i]) this._poleBend[i] = b;
            }
            this._bendRatio = b;
        }
        this._redrawDynamic();
    }

    /** 仅重绘动态层，不触发静态缓存重建 */
    _redrawDynamic() {
        this._updateDynamic();
        if (this.sys && typeof this.sys.requestRedraw === 'function') {
            this.sys.requestRedraw();
        }
    }

    // ── 只读属性查询 ──────────────────────────────────────────────
    getState()        { return this._state; }         // 当前状态字符串
    isTripped()       { return this._state === 'tripped'; }  // 是否已跳脱
    isNcClosed()      { return this._state !== 'tripped'; }  // NC 是否闭合
    isNoOpen()        { return this._state !== 'tripped'; }  // NO 是否断开
    getHeatLevel()    { return this._heatLevel; }    // 当前热量 [0,1]
    getBendRatio()    { return this._bendRatio; }    // 弯曲比例 [0,1]
    getOpsCount()     { return this.opsCount; }      // 跳脱次数

    /** 统一状态更新接口（供外部字符串命令调用） */
    update(state) {
        const v = String(state).toLowerCase();
        if (v === 'trip' || v === 'overload' || v === '1') this.trip();
        if (v === 'reset' || v === 'normal'  || v === '0') this.reset();
    }

    // ── 配置对话框字段定义 ────────────────────────────────────────
    getConfigFields() {
        return [
            { label: '位号/名称',       key: 'label',        type: 'text'   },
            { label: '热元件数目',       key: 'poles',        type: 'select',
                options: [{value:1,label:'1'},{value:2,label:'2'},{value:3,label:'3'}] },
            { label: '刻度中心线值 (A)', key: 'ratedCurrent', type: 'number',
                min: Math.max(0.1, this._defaultRated * 0.2),
                max: this._defaultRated * 4,
                step: Math.max(0.1, Math.round(this._defaultRated * 0.05 * 10) / 10) },
            { label: '脱扣等级',         key: 'tripClass',    type: 'number' },
            { label: '初始状态',         key: 'initState',    type: 'text'   },
            { label: '初始负载比 0~1',   key: 'loadRatio',    type: 'number' },
        ];
    }

    // ── 配置更新回调 ──────────────────────────────────────────────
    onConfigUpdate(cfg) {
        if (cfg.poles         !== undefined) this.poleCount = Math.max(1, Math.min(3, cfg.poles));
        if (cfg.label        !== undefined) this.label        = cfg.label;
        if (cfg.ratedCurrent !== undefined) {
            this.ratedCurrent = parseFloat(cfg.ratedCurrent);
            this._defaultRated = this.ratedCurrent; // 刻度中心线随整定值移动
        }
        if (cfg.tripClass    !== undefined) this.tripClass    = parseFloat(cfg.tripClass);
        if (cfg.loadRatio    !== undefined) this.setLoad(parseFloat(cfg.loadRatio));
        if (cfg.initState !== undefined) {
            const v = cfg.initState.toLowerCase();
            if (v === 'tripped') this.trip();
            if (v === 'normal')  this.reset();
        }
        this.config = { ...this.config, ...cfg };
        // 配置变化后几何尺寸可能改变，需完全重建图形
        this._recalcGeometry();
        this._staticGroup.destroyChildren();
        this._dynamicGroup.destroyChildren();
        this._interactGroup.destroyChildren();
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
        this._refreshCache();
        this._san = null; // 强制下次 _updateDynamic 全量刷新逐相值
    }

    // ── 清理资源 ──────────────────────────────────────────────────
    destroy() { super.destroy?.(); }
}
