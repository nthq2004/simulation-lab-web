import { BaseComponent } from './BaseComponent.js';

/**
 * SyncGenerator3P.js
 * 船舶主配电板同步发电机组件（三相电源输出，type = 'source_3p'，复用现有求解器 stamp）。
 *
 * 界面布局：左侧为操作台，右侧为发电机本体。
 *   ┌─ 左侧操作台 ─────────────────────────────┐
 *   │  标题 + LCD（频率 / 线电压）              │
 *   │  本地/遥控转换开关                        │
 *   │  绿色起动带灯按钮 + 红色停止带灯按钮      │
 *   │  加速/减速旋钮（瞬时偏转，松手回弹）      │
 *   └──────────────────────────────────────────┘
 *   ┌─ 右侧发电机 ─────────────────────────────┐
 *   │  定子环形 + 三相绕组（120°对称分布）      │
 *   │  中心旋转的两对磁极转子                    │
 *   └──────────────────────────────────────────┘
 *
 * 顶部 4 个端口：u / v / w —— 三相输出端口（有效值 vRms 的对称三相电源），
 *   n —— 中性点端口。
 * 右侧沿右边界垂直排列 6 个电气端口（从上到下）：
 *   rm_start_a / rm_start_b —— 遥控起动（同簇即有效指令）
 *   rm_stop_a  / rm_stop_b  —— 遥控停止（同簇即有效指令，优先级高于起动）
 *   freq_in_p  / freq_in_n  —— 加速/减速指令（正电压加速，负电压减速）
 *
 * 电源参数：相电压有效值 vRms（默认 230V，LCD 同步显示线电压 √3·vRms），
 * 频率 freq（默认 50Hz，范围 freqMin~freqMax），可由调速旋钮/遥控指令积分调节。
 */
export class SyncGenerator3P extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = 334;
        this.height = 240;

        this.type  = 'source_3p';
        this.cache = 'fixed';

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        this.config = {
            id: this.id,
            freq:    this.freq,
            freqMin: this.freqMin,
            freqMax: this.freqMax,
            vRms:    this.vRms,
            ratedPower:   this.ratedPower,
            ratedVoltage: this.ratedVoltage,
            ratedCosPhi:  this.ratedCosPhi,
            isOn:    this.isOn,
            mode:    this.mode,
            freqDroop: this.freqDroop,
            qDroopVar: this.qDroopVar,
            vDroopV:   this.vDroopV,
            avrDelay:  this.avrDelay,
            avrTime:   this.avrTime,
            maxDropV:  this.maxDropV,
            avrMaxComp: this.avrMaxComp,
            freqWn:    this._wn,
            freqZeta:  this._zeta,
        };

        this._addPorts();
    }

    _recalcGeometry() {
        this._gen = {
            cx: 247, cy: 140,
            rOuter: 68, rInner: 40,
            rRotor: 39, rWinding: 52,
        };

        this._portX = {
            u: 200, v: 247, w: 293, n: 317,
        };
        // 右侧电气端口（遥控起动/停止、加速/减速指令），圆心落在右边界线上
        const rx = this.width;
        this._portRight = {
            x: rx,
            startA: 36,  startB: 72,
            stopA:  108, stopB:  144,
            fInP:   180, fInN:   216,
        };

        this._ctrl = {
            lcd:   { x: 3, y: 18, w: 152, h: 62 },
            sw:    { x: 78, y: 113 },
            start: { x: 15,  y: 140, w: 57, h: 27 },
            stop:  { x: 85,  y: 140, w: 57, h: 27 },
            knob:  { x: 78, y: 200, r: 20 },
        };
    }

    _initParameters(config) {
        this.freq    = parseFloat(config.freq)    || 50;
        this.freqMin = parseFloat(config.freqMin) || 45;
        this.freqMax = parseFloat(config.freqMax) || 55;
        // 解列后自动把设定软复位到"解列前系统状态对应的等效设定"：
        // 使解列动作仅体现被转移负载对应的频率下垂（留网机降、被解列机升），
        // 默认关闭，仅特定教学流程启用（sys_ljdq4-1.js 的 gen1/gen2）。
        this.autoDecoupleTrim = config.autoDecoupleTrim === true;
        this.vRms    = parseFloat(config.vRms)    || 230;
        this.rOn     = parseFloat(config.rOn)     || 0.4;
        this.isOn    = config.isOn === true || config.isOn === 'true';
        this.mode    = config.mode || 'local';
        this._manualRate = 1.5;   // 手动旋钮频率变化率 Hz/s
        // 遥控电压→频率变化率 Hz/(s·V)。不宜过大：调速指令为 bang-bang（并车/自动调频），
        // 过快的响应与面板指令延时叠加会产生±1Hz 频率极限环，导致无法并车。
        // 0.6 Hz/s 下同步能稳定收敛（此前 2.0 会使 df 持续振荡、qf2 无法合闸）。
        this._remoteGain = parseFloat(config.remoteGain) || 0.6;
        this._knobDir    = 0;     // 旋钮当前偏转方向（-1/0/+1）
        this._remoteRate = 0;     // 遥控指令引起的频率变化率
        this._rotorAngle = 0;     // 转子累积机械角度

        // 额定参数（铭牌）：额定功率/额定电压(线)/额定功率因数 → 额定电流
        this.ratedPower  = parseFloat(config.ratedPower)  || 400;  // kW
        this.ratedVoltage = parseFloat(config.ratedVoltage) || 400; // 线电压 V
        this.ratedCosPhi = parseFloat(config.ratedCosPhi) || 0.8;
        this._recalcRatedCurrent();

        // 实际输出测量（滑动窗口 RMS）
        // 关键时序：solver.update() 每物理 tick(50ms) 只推进 currentTime += 0.5ms，
        // 而测量每 tick 推 1 个瞬时样本 → 样本间隔恰为 0.5ms。
        // 50Hz 周期 = 20ms = 40 样本。窗口必须覆盖整数个完整周期，
        // 否则 RMS 随窗口相位滑动剧烈波动（24 样本=12ms=0.6 周期 → 电流/无功/
        // 功率因数 ±10% 跳变）。measWin=40 覆盖恰好 1 个整周期 → RMS 精确稳定。
        this._curBufU = []; this._curBufV = []; this._curBufW = [];
        this._pBuf = [];
        this._rmsI = 0;
        this._pwr = 0;
        // 端子电压实测（滑窗 RMS）：与电子脱扣器测量保持同步
        this._vBufU = []; this._vBufV = []; this._vBufW = [];
        this._rmsV = 0;
        this._measWin = parseFloat(config.measWin) || 40;
        this._lastMeasIter = undefined;
        this._prevIsOn = this.isOn;
        this._peers = [];
        this._lastPeerCnt = 0;
        this._rOnEff = this.rOn;
        this._phaseShift = 0;   // 并联相位偏移（弧度）：并车时对齐到系统相位
        this._peerFreq = null;  // 并联集群共享频率（本机参与集群控制后同步）
        // ── 并车显示功率修正（教学规律：原机组只减 5%，仅 5% 转移给新并入机组）──
        // 内部真实功率 _pwr 仍由电路求解器计算（供调差/下垂/AVR 用），
        // 而面板/本体 LCD 显示的功率 _displayP 遵循教学规律，不直接显示内部重分配值。
        // _lastStandaloneP：单机运行（未被并联）期间最近一次实测稳定的有功功率（即"并车前功率"）；
        // 并网瞬间作为显示基准。_parMode=false → _displayP 恒等于 _pwr（正常显示）。
        this._lastStandaloneP = 0;
        this._parBaseP   = 0;     // 并车前原机功率基准 P_before
        this._parMode    = false; // 并车显示修正模式
        this._parIsNew   = false; // true=本机为新并入机组（显示 5%），false=原机组（显示 95%）
        this._parPaired  = null;  // 并车的另一台机组引用（供解列时协同复位）
        this._displayP   = 0;     // 面板/本体 LCD 显示的功率
        // —— 并车新增负载按调差系数分配显示 ——
        this._parShare       = 0;   // 本机有功分配比例（∝1/freqDroop，iSum 归一化）
        this._parDP          = 0;   // 电网新增功率 ΔP（leader 低通后广播，每台一致）
        this._parTotalBase   = NaN; // 并车稳定后总负载零点（校零用，仅 leader 维护）
        this._parBenchFrames = 0;   // 校零倒计时：并车后短暂采样稳态总功率作为零点
        // —— 并车份额由"并车瞬间频差"动态决定（此前固定 5%）——
        this._parRatio = 0;         // 本机对 P_before 的显示份额（新机=Δf×20%，原机=1−新机）
        // —— 解列前快照（面板分闸按钮按下瞬间冻结，供解列分支等效设定复位）——
        this._parDecP = NaN;        // 解列前本机显示功率
        this._parDecF = NaN;        // 解列前系统频率（_freqOut）
        // 单机运行期间持续记录的并车前频率（物理对齐前最后值）：
        // 合闸/并网帧会把本机 freq 强制对齐 leader，故频差须在单机期间采样
        this._freqStandalone   = this.freq;   // 并车前设定频率（含工作流调频）
        this._freqOutStandalone = this._freqOut; // 并车前实际输出频率（含下垂）
        // —— 并联期间显示频率动态基准（调节任一机设定频率 → 电网频率同步变化）——
        // 并车后调节调速旋钮只改设定频率 this.freq，物理上系统频率按"平均设定−下垂"变化；
        // 显示频率基准也随平均设定频率实时平移，保证两机面板读数同步跟随。
        this._parFbase    = NaN; // 当前显示频率基准（leader 广播）
        this._parFsetInit = NaN; // 并车时刻的平均设定频率（平移零点）
        this._parFbaseInit = NaN; // 并车初始显示基准（=原机设定频率）
        // —— 并联运行时频率调节 → 功率转移 ——
        // 调高本机设定频率 → 本机显示功率增大、另一台对称减小（总功率守恒）。
        // 相对平均设定的频偏每 0.1Hz 转移 2% 总功率（与并车频差份额同口径，无饱和）。
        this._parTrans = 0;      // 本机运行时功率转移份额（leader 广播，无饱和）

        // ── 调差特性参数 ──
        // 频率-有功下垂：满载(ratedPower) 时频率下降 freqDroop Hz（调差率 4%，50×4%=2Hz）
        this.freqDroop = parseFloat(config.freqDroop) || 2;
        // 电压-无功下垂：感性无功达到 qDroopVar(40kvar) 时线电压下降 vDroopV(10V，2.5%)
        // （vDroopV 由 20V 减半为 10V：加 350kW 满载负载时母线电压降约减半）
        this.qDroopVar = parseFloat(config.qDroopVar) || 40000;
        this.vDroopV   = parseFloat(config.vDroopV)   || 30;
        // AVR 自动电压调节：压降持续 avrDelay 秒后开始补偿，avrTime 秒内恢复原值
        this.avrDelay = parseFloat(config.avrDelay) || 8;
        this.avrTime  = parseFloat(config.avrTime)  || 5;
        // 最大可补偿的线电压降（V）：需覆盖满载内阻压降 + 无功下垂，保证 AVR 最终将
        // 端子电压补回额定值（真实发电机励磁调节即可做到）。默认 150V 线电压：
        // 额定 400V/80kW 满载（Ie≈144A、rOn=0.4Ω）内阻线压降≈100V，覆盖有余。
        this.maxDropV = parseFloat(config.maxDropV) || 150;
        // AVR 最大补偿比例（0~1）：1.0 允许全额补偿到额定电压（电压仅受 1.3·vRms 防
        // 冲击上限约束）；比例速率控制 + 死区 + 延时已保证无过冲。
        this.avrMaxComp = parseFloat(config.avrMaxComp) !== undefined ? parseFloat(config.avrMaxComp) : 1.0;

        // 实际输出量（含调差），供波形/LCD/遥控面板读取
        this._freqOut  = this.freq;
        this._vRmsOut  = this.vRms;
        this._displayFreq = this.freq; // 显示频率（并车修正时随显示功率下垂）
        this._freqSetPre = NaN;        // 并网前设定频率（并车显示频率的基准，防并网对齐覆盖）
        this._avrTimer = 0;   // 压降持续时间
        this._avrComp  = 0;   // AVR 补偿量 0~1
        this._errFilt  = 0;   // 端子电压误差低通滤波值（相电压）

        // ── 频率动态模型（负荷突变时频率过冲再回落）──
        // 二阶弹簧-阻尼系统：频率向静态下垂目标 f_target 收敛，阻尼比 <1 时产生过冲
        this._freq      = this.freq;                // 实际输出频率（动态）
        this._freqRate  = 0;                        // 频率变化率 df/dt
        this._wn        = parseFloat(config.freqWn)    || 2.5;  // 固有角频率 rad/s（越小转子越"重"）
        this._zeta      = parseFloat(config.freqZeta)  || 0.9; // 阻尼比（<1 有过冲）

        // ── 故障注入标志 ──
        // 调速器故障：输出频率降至 25Hz，线电压降至 280V
        this._faultGovernor = false;
        // 调压器（AVR）故障：线电压降至 200V，频率不受影响
        this._faultAVR      = false;

        // ── 原动机故障标志（用于遥控面板 READY FOR START 指示灯条件）──
        // 运行时任一故障被置位 → 原动机保护停机（isOn 强制置 false）；
        // 故障未清除前无法再次起动（遥控/本地起动指令均会被保护逻辑立即清零）。
        this._faultOverspeed   = false; // 原动机超速故障
        this._faultOilPress    = false; // 滑油低压故障
        this._faultCoolantTemp = false; // 冷却水温高故障

        // ── 原动机故障拖转（逆功率）──
        // 冷却水温高且并联运行：原动机故障停机，发电机被母线拖动（电动机方式），
        // 输出真实逆功率，从 0 线性爬升至 revMaxKw。主开关逆功率保护在逆功率
        // 达到 8kW 后延时 5s 跳闸（保护由 MarineMainsSwitch 实现）。
        this._primeTrip   = false;      // 原动机故障拖转中
        this._primeTripT  = 0;          // 故障持续时间（s，驱动逆功率爬升）
        this.revRiseKw    = parseFloat(config.revRiseKw) || 1.5; // 逆功率爬升率 kW/s（0→9kW 约 6s）
        this.revMaxKw     = parseFloat(config.revMaxKw)  || 9;   // 逆功率上限 kW
    }

    _recalcRatedCurrent() {
        // 三相额定电流：Ie = P / (√3·U·cosφ)
        const denom = Math.sqrt(3) * this.ratedVoltage * this.ratedCosPhi;
        this.ratedCurrent = denom > 0 ? this.ratedPower * 1000 / denom : 0;
    }

    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
    }

    // ─────────────────────────── 静态绘制 ───────────────────────────
    _drawStaticParts() {
        const g = this._gen;

        // 左侧操作台面板
        this._staticGroup.add(new Konva.Rect({
            x: 0, y: 0, width: 157, height: this.height,
            fill: '#e8eef4', stroke: '#1a252f', strokeWidth: 1, cornerRadius: 3,
        }));
        // 右侧发电机面板
        this._staticGroup.add(new Konva.Rect({
            x: 167, y: 0, width: this.width - 167, height: this.height,
            fill: '#dfe7ee', stroke: '#1a252f', strokeWidth: 1, cornerRadius: 3,
        }));

        // 标题
        this._staticGroup.add(new Konva.Text({
            x: 0, y: 2, width: 157,
            text: '同步发电机', fontSize: 12, fontStyle: 'bold',
            fill: '#1a252f', align: 'center',
        }));

        // LCD 背景
        const lcd = this._ctrl.lcd;
        this._staticGroup.add(new Konva.Rect({
            x: lcd.x, y: lcd.y, width: lcd.w, height: lcd.h,
            fill: '#0a0e12', cornerRadius: 2, stroke: '#3a4a55', strokeWidth: 1,
        }));

        // 控制方式开关底座与标签
        this._drawSwitchBase();

        // 按钮底座（圆角凹槽）
        this._staticGroup.add(new Konva.Rect({
            x: this._ctrl.start.x - 2, y: this._ctrl.start.y - 2,
            width: this._ctrl.start.w + 4, height: this._ctrl.start.h + 4,
            fill: '#cdd8e0', cornerRadius: 4,
        }));
        this._staticGroup.add(new Konva.Rect({
            x: this._ctrl.stop.x - 2, y: this._ctrl.stop.y - 2,
            width: this._ctrl.stop.w + 4, height: this._ctrl.stop.h + 4,
            fill: '#cdd8e0', cornerRadius: 4,
        }));
        this._staticGroup.add(new Konva.Text({
            x: this._ctrl.start.x, y: this._ctrl.start.y + this._ctrl.start.h + 2,
            width: this._ctrl.start.w, text: '起动', fontSize: 11,
            fill: '#2e7d32', align: 'center', fontStyle: 'bold',
        }));
        this._staticGroup.add(new Konva.Text({
            x: this._ctrl.stop.x, y: this._ctrl.stop.y + this._ctrl.stop.h + 2,
            width: this._ctrl.stop.w, text: '停止', fontSize: 11,
            fill: '#b71c1c', align: 'center', fontStyle: 'bold',
        }));

        // 调速旋钮刻度盘
        const knob = this._ctrl.knob;
        this._staticGroup.add(new Konva.Circle({
            x: knob.x, y: knob.y, radius: knob.r + 4,
            fill: '#cfd8df', stroke: '#5a6a75', strokeWidth: 1,
        }));
        this._staticGroup.add(new Konva.Text({
            x: knob.x - 40, y: knob.y + knob.r + 4, width: 80,
            text: '减速  ←  加速', fontSize: 11, fill: '#333', align: 'center',
        }));

        // ── 发电机本体：定子 ──
        this._staticGroup.add(new Konva.Ring({
            x: g.cx, y: g.cy,
            innerRadius: g.rInner, outerRadius: g.rOuter,
            fill: '#7a8894', stroke: '#2c3a45', strokeWidth: 1,
        }));
        // 定子通风槽装饰
        for (let a = 0; a < 360; a += 20) {
            const rad = a * Math.PI / 180;
            const rx = g.cx + (g.rInner + 4) * Math.cos(rad);
            const ry = g.cy + (g.rInner + 4) * Math.sin(rad);
            this._staticGroup.add(new Konva.Circle({
                x: rx, y: ry, radius: 1.5, fill: '#56646e',
            }));
        }

        // ── 三相绕组（120° 对称，U红 / V绿 / W蓝 环形线圈）──
        const winding = (angDeg, label, fill, stroke, labelColor) => {
            const rad = angDeg * Math.PI / 180;
            const cx = g.cx + g.rWinding * Math.cos(rad);
            const cy = g.cy + g.rWinding * Math.sin(rad);
            this._staticGroup.add(new Konva.Ring({
                x: cx, y: cy,
                innerRadius: 7, outerRadius: 10,
                fill, stroke, strokeWidth: 1,
            }));
            this._staticGroup.add(new Konva.Text({
                x: cx - 5, y: cy - 3, width: 10,
                text: label, fontSize: 6, fontStyle: 'bold',
                fill: labelColor, align: 'center',
            }));
        };
        winding(90,  'V', '#20a030', '#0f7018', '#064d12');
        winding(210, 'U', '#e02020', '#8a1010', '#7a0000');
        winding(330, 'W', '#2a60d0', '#163a8a', '#0a2a6a');

        // ── 绕组引线 → 顶部端口（颜色与绕组一致）──
        const wire = (pts, color, wd = 2) => {
            this._staticGroup.add(new Konva.Line({
                points: pts, stroke: color, strokeWidth: wd,
                lineCap: 'round', lineJoin: 'round',
            }));
        };
        const topY = g.cy - g.rOuter; // 定子外缘顶部 y
        // V 相（顶部绕组，位于环内 r=52）→ v 端口（绿）
        wire([247, 88, 247, 0], '#20a030');
        // U 相（左下绕组）→ u 端口（红）
        wire([202, 114, 200, topY, 200, 0], '#e02020');
        // W 相（右下绕组）→ w 端口（蓝）
        wire([292, 114, 293, topY, 293, 0], '#2a60d0');
        // 中性线：中心 → n 端口
        wire([g.cx, g.cy, this._portX.n, g.cy, this._portX.n, 0], '#44505a', 1);
        // 定子顶部三个引出孔
        [200, 247, 293].forEach(x => {
            this._staticGroup.add(new Konva.Circle({
                x, y: topY, radius: 2, fill: '#2c3a45',
            }));
        });
        // 中性点标记
        this._staticGroup.add(new Konva.Circle({
            x: g.cx, y: g.cy, radius: 3, fill: '#44505a', stroke: '#222',
        }));
    }

    _drawSwitchBase() {
        const sw = this._ctrl.sw;
        // 底座（宽度 84，高度 29 → 39）
        this._staticGroup.add(new Konva.Rect({
            x: sw.x - 42, y: sw.y - 18, width: 84, height: 39,
            fill: '#cdd8e0', cornerRadius: 4, stroke: '#5a6a75', strokeWidth: 1,
        }));
        // 标签
        this._staticGroup.add(new Konva.Text({
            x: sw.x - 42, y: sw.y - 32, width: 84,
            text: '控制方式', fontSize: 11, fill: '#333', align: 'center',
        }));
        this._staticGroup.add(new Konva.Text({
            x: sw.x - 42, y: sw.y - 15, width: 30,
            text: '本地', fontSize: 11, fill: '#2e7d32', align: 'center', fontStyle: 'bold',
        }));
        this._staticGroup.add(new Konva.Text({
            x: sw.x + 12, y: sw.y - 15, width: 30,
            text: '遥控', fontSize: 11, fill: '#1565c0', align: 'center', fontStyle: 'bold',
        }));
    }

    // ─────────────────────────── 动态节点 ───────────────────────────
    _createDynamicNodes() {
        const g = this._gen;

        // ── 转子（两对磁极，可旋转）──
        this._rotorGroup = new Konva.Group({ x: g.cx, y: g.cy });
        // 转子轴
        this._rotorGroup.add(new Konva.Circle({
            x: 0, y: 0, radius: 7, fill: '#2c3a45', stroke: '#161d23', strokeWidth: 1,
        }));
        // 4 个磁极（上下左右，N/S 交替，径向范围 r≈7~32，不越定子内缘）
        const poles = [
            { x: -5,  y: -32, w: 11, h: 25, c: '#d03030' }, // 上 N
            { x: 7,   y: -5,  w: 25, h: 11, c: '#3060c8' }, // 右 S
            { x: -5,  y: 7,   w: 11, h: 25, c: '#d03030' }, // 下 N
            { x: -32, y: -5,  w: 25, h: 11, c: '#3060c8' }, // 左 S
        ];
        poles.forEach(p => {
            this._rotorGroup.add(new Konva.Rect({
                x: p.x, y: p.y,
                width: p.w, height: p.h,
                fill: p.c, stroke: '#8a1a1a', strokeWidth: 1, cornerRadius: 2,
            }));
        });
        this._rotorGroup.add(new Konva.Circle({
            x: 0, y: 0, radius: 4, fill: '#f5f7fa',
        }));
        this._rotorGroup.rotation(this._rotorAngle);
        this._dynamicGroup.add(this._rotorGroup);

        // ── LCD 动态文本 ──
        const lcd = this._ctrl.lcd;
        this._lcdFreq = new Konva.Text({
            x: lcd.x + 4, y: lcd.y + 2, width: lcd.w - 8,
            text: '', fontSize: 14, fontFamily: 'monospace',fontStyle:'bold',
            fill: '#00ff88', align: 'left',
        });
        this._lcdVolt = new Konva.Text({
            x: lcd.x + 4, y: lcd.y + 22, width: lcd.w - 8,
            text: '', fontSize: 14, fontFamily: 'monospace',fontStyle:'bold',
            fill: '#f4d744', align: 'left',
        });
        this._lcdRated = new Konva.Text({
            x: lcd.x + 4, y: lcd.y + 42, width: lcd.w - 8,
            text: '', fontSize: 14, fontFamily: 'monospace',fontStyle:'bold',
            fill: '#7dd3ff', align: 'left',
        });
        this._dynamicGroup.add(this._lcdFreq, this._lcdVolt, this._lcdRated);

        // ── 带灯按钮 ──
        this._startFace = new Konva.Rect({
            x: this._ctrl.start.x, y: this._ctrl.start.y,
            width: this._ctrl.start.w, height: this._ctrl.start.h,
            fill: '#2ecc71', cornerRadius: 3, stroke: '#1a7a3a', strokeWidth: 1,
        });
        this._stopFace = new Konva.Rect({
            x: this._ctrl.stop.x, y: this._ctrl.stop.y,
            width: this._ctrl.stop.w, height: this._ctrl.stop.h,
            fill: '#e74c3c', cornerRadius: 3, stroke: '#8a1a1a', strokeWidth: 1,
        });
        this._startLed = new Konva.Circle({
            x: this._ctrl.start.x + this._ctrl.start.w - 9, y: this._ctrl.start.y + this._ctrl.start.h / 2,
            radius: 4, fill: '#3a3a3a', stroke: '#222', strokeWidth: 1,
        });
        this._stopLed = new Konva.Circle({
            x: this._ctrl.stop.x + this._ctrl.stop.w - 9, y: this._ctrl.stop.y + this._ctrl.stop.h / 2,
            radius: 4, fill: '#3a3a3a', stroke: '#222', strokeWidth: 1,
        });
        this._dynamicGroup.add(this._startFace, this._stopFace, this._startLed, this._stopLed);

        // ── 调速旋钮指针（垂直向上为 0°）──
        const knob = this._ctrl.knob;
        this._knobPointer = new Konva.Line({
            x: knob.x, y: knob.y,
            points: [0, 0, 0, -knob.r + 5],
            stroke: '#f1f9f5', strokeWidth: 6, lineCap: 'round',
        });
        this._knobPointer.rotation(0);
        this._knobDisk = new Konva.Circle({
            x: knob.x, y: knob.y, radius: knob.r,
            fill: '#7f8c8d', stroke: '#4a5a63', strokeWidth: 1,
            cursor: 'pointer',
        });
        this._knobDisk.hitStrokeWidth(20);
        this._dynamicGroup.add(this._knobDisk, this._knobPointer);

        // ── 控制方式拨杆（旋钮，原尺寸×2）──
        this._switchKnob = new Konva.Group({ x: this._ctrl.sw.x, y: this._ctrl.sw.y+5 });
        this._switchKnob.add(new Konva.Line({
            points: [0, 0, 0, -16], stroke: '#2c3a45', strokeWidth: 6, lineCap: 'round',
        }));
        this._switchKnob.add(new Konva.Circle({
            x: 0, y: 0, radius: 10, fill: '#2c3a45', stroke: '#161d23', strokeWidth: 2,
        }));
        this._switchKnob.rotation(this.mode === 'local' ? -45 : 45);
        this._dynamicGroup.add(this._switchKnob);

        this._updateDisplay();
    }

    // ─────────────────────────── 交互绑定 ───────────────────────────
    _bindInteraction() {
        // 控制方式拨杆：点击切换 本地/遥控
        this._switchKnob.on('click tap', (e) => {
            e.cancelBubble = true;
            this.mode = (this.mode === 'local') ? 'remote' : 'local';
            new Konva.Tween({
                node: this._switchKnob,
                rotation: this.mode === 'local' ? -45 : 45,
                duration: 0.18,
            }).play();
            this.config.mode = this.mode;
            this._updateDisplay();
        });

        // 起动/停止带灯按钮
        const bindBtn = (face, onPress) => {
            let pressed = false;
            face.on('mousedown touchstart', (e) => {
                e.cancelBubble = true;
                if (!pressed) { pressed = true; face.y(face.y() + 1.5); }
                if (this.mode === 'local') onPress();
                this._updateDisplay();
            });
            face.on('mouseup touchend mouseleave', () => {
                if (pressed) { pressed = false; face.y(face.y() - 1.5); }
                this._updateDisplay();
            });
        };
        bindBtn(this._startFace, () => { this.isOn = true; });
        bindBtn(this._stopFace,  () => { this.isOn = false; });

        // 调速旋钮：按下右侧 → +45° 加速；左侧 → -45° 减速；松手回弹
        this._knobDisk.on('mousedown touchstart', (e) => {
            e.cancelBubble = true;
            const pos = this.sys.stage.getPointerPosition();
            const abs = this._knobDisk.getAbsolutePosition();
            this._knobDir = (pos && pos.x > abs.x) ? 1 : -1;
            this._tweenKnob(this._knobDir * 45);

            const onUp = () => {
                this._knobDir = 0;
                this._tweenKnob(0);
                window.removeEventListener('mouseup', onUp);
                window.removeEventListener('touchend', onUp);
            };
            window.addEventListener('mouseup', onUp);
            window.addEventListener('touchend', onUp);
        });
    }

    _tweenKnob(angle) {
        if (this._knobTw) this._knobTw.destroy();
        this._knobTw = new Konva.Tween({
            node: this._knobPointer, rotation: angle, duration: 0.12,
        });
        this._knobTw.play();
    }

    // ─────────────────────────── 端口 ───────────────────────────
    _addPorts() {
        const p = this._portX;
        const r = this._portRight;
        this.addPort(p.u, 0, 'u', 'wire', 'p');
        this.addPort(p.v, 0, 'v', 'wire', 'p');
        this.addPort(p.w, 0, 'w', 'wire', 'p');
        this.addPort(p.n, 0, 'n', 'wire');
        this.addPort(r.x, r.startA, 'rm_start_a', 'wire');
        this.addPort(r.x, r.startB, 'rm_start_b', 'wire');
        this.addPort(r.x, r.stopA,  'rm_stop_a',  'wire');
        this.addPort(r.x, r.stopB,  'rm_stop_b',  'wire');
        this.addPort(r.x, r.fInP,   'freq_in_p',  'wire', 'p');
        this.addPort(r.x, r.fInN,   'freq_in_n',  'wire', 'n');
    }

    // ─────────────────────────── 电源输出 ───────────────────────────
    getPhaseVoltage(phase, time) {
        if (!this.isOn) return 0;
        const vRms = this._vRmsOut || this.vRms;
        // 波形频率恒定为电网基频 50Hz：频率-有功下垂（_freqOut）只反映在表计显示上，
        // 不改变实际输出波形频率。因此并联机组波形严格同频，相位由 _phaseShift 唯一决定，
        // 不会因带载调差或调速方式差异产生相位漂移 → 并车无相位冲击、无持续环流。
        const freq = 50;
        const peak = vRms * Math.SQRT2;
        const omega = 2 * Math.PI * freq;
        let offset = 0;
        if (phase === 'v')      offset = -4 * Math.PI / 3;
        else if (phase === 'w') offset = -2 * Math.PI / 3;
        return peak * Math.sin(omega * time + offset + this._phaseShift);
    }

    getLineVoltage() {
        return Math.sqrt(3) * (this._vRmsOut || this.vRms);
    }

    // ─────────────────────────── 仿真主循环 ───────────────────────────
    tick(dt) {
        const solver = this.sys && this.sys.voltageSolver;
        if (solver) {
            // ── 并联检测：与其它在网运行的同型电源（经导线/合闸开关形成同一导电网络）视为并联 ──
            this._peers = [];
            if (this.isOn) {
                const myU = solver.portToCluster.get(`${this.id}_wire_u`);
                if (myU !== undefined) {
                    // 并查集：导线簇 + 合闸 ACB 主触头（l↔t）构建导电连通图
                    const uf = new Map();
                    const root = (x) => {
                        if (!uf.has(x)) uf.set(x, x);
                        let r = x;
                        while (uf.get(r) !== r) r = uf.get(r);
                        let cur = x;
                        while (uf.get(cur) !== r) { const nx = uf.get(cur); uf.set(cur, r); cur = nx; }
                        return r;
                    };
                    const union = (a, b) => {
                        if (a === undefined || b === undefined) return;
                        const ra = root(a), rb = root(b);
                        if (ra !== rb) uf.set(ra, rb);
                    };
                    const p2c = solver.portToCluster;
                    for (const d of (solver.rawDevices || [])) {
                        if (!d || d.type !== 'ACB' || d._state !== 'on') continue;
                        [['l1','t1'],['l2','t2'],['l3','t3']].forEach(([a, b]) => {
                            union(p2c.get(`${d.id}_wire_${a}`), p2c.get(`${d.id}_wire_${b}`));
                        });
                    }
                    const rMy = root(myU);
                    for (const oid in this.sys.comps) {
                        if (oid === this.id) continue;
                        const oc = this.sys.comps[oid];
                        if (!oc || oc.type !== 'source_3p' || !oc.isOn) continue;
                        const ou = solver.portToCluster.get(`${oid}_wire_u`);
                        if (ou !== undefined && root(ou) === rMy) this._peers.push(oc);
                    }
                }
            }
            // 并联功率分配：内阻均分（调差率分配）。
            // 调差率(freqDroop)大的机组分担的有功小，等效内阻与 freqDroop 成正比，
            // 使并联各机有功按频差系数反比分配（P_i ∝ 1/freqDroop_i）。
            if (this._peers.length > 0) {
                let dSum = this.freqDroop, n = 1;
                for (const p of this._peers) { dSum += p.freqDroop; n++; }
                const dAvg = dSum / n;
                this._rOnEff = this.rOn * (dAvg > 0 ? this.freqDroop / dAvg : 1);
            } else {
                this._rOnEff = this.rOn;
            }
            // 遥控起动/停止：两个端口在同一簇即有效指令
            const a1 = solver.portToCluster.get(`${this.id}_wire_rm_start_a`);
            const a2 = solver.portToCluster.get(`${this.id}_wire_rm_start_b`);
            const b1 = solver.portToCluster.get(`${this.id}_wire_rm_stop_a`);
            const b2 = solver.portToCluster.get(`${this.id}_wire_rm_stop_b`);
            const remoteStart = a1 !== undefined && a1 === a2;
            const remoteStop  = b1 !== undefined && b1 === b2;
            if (this.mode === 'remote') {
                if (remoteStart) this.isOn = true;
                if (remoteStop)  this.isOn = false; // 停止指令优先
            }

            // 原动机保护停机：超速 / 滑油低压 / 冷却水温高 → 并联运行时原动机故障、
            // 发电机被母线拖转（输出逆功率）；单机运行时停机。故障未清除前无法起动。
            if (this._faultOverspeed || this._faultOilPress || this._faultCoolantTemp) {
                if (this._peers.length > 0 && this.isOn) {
                    // 并网拖转：保持并网（MNA 仍 stamp 电压源），进入逆功率状态
                    if (!this._primeTrip) { this._primeTrip = true; this._primeTripT = 0; }
                } else {
                    this.isOn = false; // 单机停机
                }
            } else if (this._primeTrip) {
                // 原动机故障已修复 → 退出拖转状态
                this._primeTrip = false;
                this._primeTripT = 0;
            }

            // 加速/减速指令端口：正电压加速、负电压减速
            const cP = solver.portToCluster.get(`${this.id}_wire_freq_in_p`);
            const cN = solver.portToCluster.get(`${this.id}_wire_freq_in_n`);
            if (cP !== undefined && cN !== undefined) {
                const vP = solver.nodeVoltages.get(cP) || 0;
                const vN = solver.nodeVoltages.get(cN) || 0;
                // 节点电压可能为 NaN（并网冲击瞬态），NaN 会污染遥控频率设定值
                this._remoteRate = (isFinite(vP) && isFinite(vN)) ? this._remoteGain * (vP - vN) : 0;
            } else {
                this._remoteRate = 0;
            }

            // ── 实际输出测量：每相电流 = (源电动势 - 相端电压)/内阻，滑窗求三相电流 RMS 与有功功率 ──
            // 状态翻转帧跳过测量：求解器本帧仍按旧 isOn stamp（端口电压未建立），
            // 若立即用新 isOn 计算 (emf - vu)/rOn 会产生瞬态大电流并被滑窗保留。
            if (this.isOn && this.isOn === this._prevIsOn) {
                const advanced = solver.globalIterCount !== this._lastMeasIter;
                this._lastMeasIter = solver.globalIterCount;
                if (advanced) {
                    const getV = (pId) => {
                        const c = solver.portToCluster.get(pId);
                        return c !== undefined ? (solver.nodeVoltages.get(c) || 0) : 0;
                    };
                    const vN = getV(`${this.id}_wire_n`);
                    const emfU = this.getPhaseVoltage('u', solver.currentTime);
                    const emfV = this.getPhaseVoltage('v', solver.currentTime);
                    const emfW = this.getPhaseVoltage('w', solver.currentTime);
                    const vu = getV(`${this.id}_wire_u`) - vN;
                    const vv = getV(`${this.id}_wire_v`) - vN;
                    const vw = getV(`${this.id}_wire_w`) - vN;
                    const rOn = this._rOnEff || this.rOn || 0.01;
                    const iu = (emfU - vu) / rOn;
                    const iv = (emfV - vv) / rOn;
                    const iw = (emfW - vw) / rOn;

                    const win = this._measWin;
                    // 并网冲击帧过滤：合闸瞬间（peer 数刚变化）本机相位尚未对齐，
                    // 求解器会把两电源接在极端相位差上，产生物理上不可能的巨幅瞬态电流。
                    // 这类样本不进入测量窗，避免污染 RMS/功率显示。
                    const inSurgeFrame = this._peers.length > 0 && this._lastPeerCnt === 0;
                    const iMax = this.ratedCurrent * 6;
                    const sane = (v) => !inSurgeFrame && Math.abs(v) < iMax;
                    const push = (arr, v) => { arr.push(v * v); if (arr.length > win) arr.shift(); };
                    if (sane(iu) && sane(iv) && sane(iw)) {
                        push(this._curBufU, iu);
                        push(this._curBufV, iv);
                        push(this._curBufW, iw);
                        // 端子电压同步采样（与电流同窗口），RMS 后供 LCD 显示
                        push(this._vBufU, vu);
                        push(this._vBufV, vv);
                        push(this._vBufW, vw);
                        // 三相瞬时功率（带符号）：p = u·iu + v·iv + w·iw
                        this._pBuf.push((vu * iu + vv * iv + vw * iw) / 1000);
                        if (this._pBuf.length > win) this._pBuf.shift();
                    }

                    const avg = (arr) => arr.length > 0 ? Math.sqrt(arr.reduce((a, b) => a + b, 0) / arr.length) : 0;
                    const rU = avg(this._curBufU), rV = avg(this._curBufV), rW = avg(this._curBufW);
                    // 显示实际负载相电流（三相中最大相）
                    this._rmsI = Math.max(rU, rV, rW);
                    // 端子相电压 RMS：三相平均（与电子脱扣器测量一致）
                    this._rmsV = (avg(this._vBufU) + avg(this._vBufV) + avg(this._vBufW)) / 3;
                    // 缓冲为空（起动/并网清窗后测量帧被过滤）时不能算 0/0=NaN
                    this._pwr = this._pBuf.length > 0 ? this._pBuf.reduce((a, b) => a + b, 0) / this._pBuf.length : 0;

                    // 原动机故障拖转：发电机被母线拖动，输出真实逆功率。
                    // 从 0 线性爬升至 revMaxKw（默认 9kW）后保持，供主开关逆功率
                    // 保护检测（≥8kW 延时 5s 跳闸）。显示层与保护均读此 _pwr。
                    if (this._primeTrip) {
                        this._primeTripT += dt;
                        this._pwr = -Math.min(this.revMaxKw, this.revRiseKw * this._primeTripT);
                    }
                }
            } else {
                this._curBufU.length = this._curBufV.length = this._curBufW.length = 0;
                this._vBufU.length = this._vBufV.length = this._vBufW.length = 0;
                this._pBuf.length = 0;
                this._rmsI = 0;
                this._pwr = 0;
                this._rmsV = 0;
                // 停机/起动翻转：并车显示基准与修正模式复位，
                // 避免上次会话的旧基准残留污染下一次并车显示
                this._lastStandaloneP = 0;
                this._parMode = false;
                this._parPaired = null;
                this._displayP = 0;
                this._displayFreq = this.freq;
                this._freqSetPre = NaN;
                this._parShare = 0;
                this._parDP = 0;
                this._parTotalBase = NaN;
                this._parBenchFrames = 0;
                this._parRatio = 0;
                this._freqStandalone = this.freq;
                this._freqOutStandalone = this._freqOut;
                this._parFbase = NaN;
                this._parFsetInit = NaN;
                this._parFbaseInit = NaN;
                this._parTrans = 0;
                this._parDecP = NaN;
                this._parDecF = NaN;
                this._primeTrip = false;
                this._primeTripT = 0;
            }
            // 起动瞬间/并网瞬间：本机与在网机组建立连接（0→N peer）时，
            // 将频率与相位对齐到集群主机。本模型电动势相位为 ω·t 解析式，
            // 只要各机频率严格相等且相位偏移一致，相位即处处相等 → 零环流。
            // （注意：不能把 follower 的相位算成 (ω_l-ω_s)·t0 的固定偏置——那会留下
            //  永久相位差；必须直接复制主机的 freq 与 shift，二者都相同则相位恒等。）
            if (this.isOn && this._peers.length > 0 && this._lastPeerCnt === 0) {
                let leader = this;
                for (const p of this._peers) if (p.id < leader.id) leader = p;
                if (leader !== this) {
                    this._phaseShift = leader._phaseShift || 0;
                    this._freq = leader._freq;
                    this._freqRate = leader._freqRate;
                    // 波形物理频率必须同步对齐：getPhaseVoltage 使用 this.freq 生成波形，
                    // 若仅对齐 _freq（显示频率），两机频率不同会导致并网后相位持续漂移，
                    // 产生数百安培的持续环流。对齐后只要双方频率严格相等即相位恒等。
                    // 先记录并网前设定频率（并车显示频率的基准），再被覆盖为 leader 设定值。
                    this._freqSetPre = this.freq;
                    if (isFinite(leader.freq)) this.freq = leader.freq;
                    // 并联机组挂同一母线，端子电压必须一致：复制主机输出电动势幅值，
                    // 避免本机因并网前空载电压偏高/偏低造成电压差 → 环流。
                    if (isFinite(leader._vRmsOut)) {
                        this._vRmsOut = leader._vRmsOut;
                        this._avrComp = leader._avrComp || 0;
                        this._avrTimer = leader._avrTimer || 0;
                        this._qVar = leader._qVar || 0;
                    }
                }
                // 并网冲击电流已进入所有在网机组的测量窗，统一清空避免污染显示
                this._curBufU.length = this._curBufV.length = this._curBufW.length = 0;
                this._pBuf.length = 0;
                for (const p of this._peers) {
                    if (p._curBufU) p._curBufU.length = p._curBufV.length = p._curBufW.length = 0;
                    if (p._pBuf) p._pBuf.length = 0;
                }
            }

            // ── 并车显示功率修正（教学规律:原机组只减 5%，仅 5% 转移给新并入机组）──
            // 内部功率 _pwr（求解器按电路/调差计算）保留，仅修改面板/本体 LCD 的显示功率。
            if (this.isOn && this._peers.length === 0) {
                // 单机运行（未并联）：持续记录"并车前功率"作为并车显示基准；
                // 且单机必须显示内部真实功率（_parMode=false → _displayP=_pwr）
                this._lastStandaloneP = isFinite(this._pwr) ? this._pwr : this._lastStandaloneP;
                // 并车前频率（物理对齐前的最后值）：并车份额按并车瞬间频差决定，
                // 频差 = 新机设定频率 − 原机实际输出频率，须在单机期间持续采样
                this._freqStandalone = this.freq;
                this._freqOutStandalone = this._freqOut;
                if (this._parMode) { this._parMode = false; this._parPaired = null; }
                this._refreshDisplayP();
            }
            const becamePar = this.isOn && this._peers.length > 0 && this._lastPeerCnt === 0;
            if (becamePar) {
                // 本机刚并入：决定"原机组 / 新机组"并广播显示基准
                let leader = this;
                for (const p of this._peers) if (p.id < leader.id) leader = p;
                // 原机组 = 并车前的在网机组（此场景 leader 即原机组）：
                // 其 _lastStandaloneP 保存了并车前最近的实测功率，作为 P_before
                const owner = (leader && leader !== this && leader._lastStandaloneP > 0)
                    ? leader                                  // 并车进已有网络：原机是 leader
                    : this;                                   // 多台同时并入（罕见）：以本机作基准
                const Pbefore = owner._lastStandaloneP > 0 ? owner._lastStandaloneP
                    : (isFinite(this._pwr) ? this._pwr : 0);
                // 配对新入机组（供解列时原机复位对方）
                let newGen = null;
                for (const p of this._peers) if (p !== owner) { newGen = p; break; }
                // 边界：本机帧（this===owner）的 peers 恰都不被排除时 newGen 为 null，
                // 此时以本机自身与会由 leader 帧广播一致的方案兜底，避免空引用崩溃。
                const incGen = newGen || (this !== owner ? this : null);
                // ── 并车瞬间频差决定显示份额（替代固定 5%）──
                // 频差 = 新机并车前设定频率 − 原机并车前实际输出频率（Hz）。
                // 每 0.1Hz 频差对应 2% 总功率：份额 = Δf×20%（如 +0.2Hz→4%、−0.1Hz→−2%）；
                // clamp ±10% 对应同步保护频差边界 ±0.5Hz。频差为负 → 新机份额为负（吸收功率）、
                // 原机份额 >100%（如 −2% → 原机 102%）。物理上合闸/并网帧会强制将新机 freq
                // 对齐 leader，故频差取单机期间的 _freqStandalone/_freqOutStandalone 记录。
                const df = incGen && isFinite(owner._freqOutStandalone) && isFinite(incGen._freqStandalone)
                    ? incGen._freqStandalone - owner._freqOutStandalone
                    : 0;
                const ratioNew = Math.max(-0.1, Math.min(0.1, (isFinite(df) ? df : 0) * 0.2));
                // 新增负载按调差系数反比分配：freqDroop 大的机组分得的有功小。
                // 与物理分配一致（_rOnEff ∝ freqDroop → P_i ∝ 1/freqDroop）。
                const invD = (g) => 1 / ((g && g.freqDroop > 0) ? g.freqDroop : 1);
                const allGens = [...this._peers, this];
                let iSum = 0;
                for (const g of allGens) iSum += invD(g);
                // 并车显示频率基准：并车时刻平均设定频率作为平移零点，
                // 之后调节任一机设定频率 → 平均设定变化 → 电网显示频率同步变化。
                // 注：此帧各机 freq 已被 _autoSyncIncoming/并网对齐（均等于 leader 设定），
                // 故 fSetInit 即对齐后的共同设定频率，fBaseInit 取原机设定。
                let fSetSum = 0;
                for (const g of allGens) fSetSum += g.freq;
                const fSetInit = fSetSum / allGens.length;
                const fBaseInit = owner.freq;
                // 给集群内全部机组（含自身）写入显示基准
                // （多机场景：owner 的份额应为 1−Σ各新机份额；本工程两机，owner=1−ratioNew）
                const apply = (g, isNew) => {
                    g._parMode = true;
                    // 并车原负载基准：起步用并车前原机稳态实测负载 Pbefore
                    //（单机期间持续采样的稳态值，无并网冲击污染）；
                    // 校零期内由 leader 帧逐步平滑过渡到 _parTotalBase（见 leader 帧）。
                    g._parBaseP = Pbefore;
                    g._parIsNew = isNew;
                    g._parPaired = isNew ? owner : (newGen || null);
                    g._parShare = iSum > 0 ? invD(g) / iSum : 0;
                    g._parRatio = isNew ? ratioNew : (1 - ratioNew);
                    g._parDP = 0;
                    g._parTotalBase = NaN;
                    g._parBenchFrames = 50; // 并车后 2.5s 校零
                    g._parFsetInit = fSetInit;
                    g._parFbaseInit = fBaseInit;
                    g._parFbase = fBaseInit;
                    g._parTrans = 0;
                };
                for (const p of this._peers) apply(p, p !== owner);
                apply(this, this !== owner);
                // 立即刷新一次显示功率
                this._refreshDisplayP();
                for (const p of this._peers) if (p._refreshDisplayP) p._refreshDisplayP();
            } else if (this.isOn && this._peers.length === 0 && this._lastPeerCnt > 0) {
                // 解列（N→0）：恢复显示真实功率
                if (this._parPaired && this._parPaired._parMode) this._parPaired._parMode = false;
                this._parMode = false;
                // 解列瞬间把设定软复位到"解列前系统状态对应的等效设定"：
                //   newFreq = 解列前系统频率 fSys + 本机解列前显示功率/额定×下垂
                // 解列后两机端口簇各自独立，均满足 peers:0→0 走本分支，因此各机按
                // 自身快照复位即可——留网机承接负载频率微降、被解列机卸载空载频率
                // 微升，两机特征对称连续、无跳变。
                // 仅在"设定明显偏离解列前系统频率"(>0.3Hz，转移功率残留场景)时生效；
                // 正常设定（如 reverse-power 中 1# 满载 50Hz 设定）不触发，避免复并后
                // 系统频率被异常设定抬高。跳闸解列（isOn=false）不走本分支，零影响。
                if (this.autoDecoupleTrim) {
                    // 系统频率与显示功率优先取"分闸按钮按下瞬间"冻结的快照（_parDecF/_parDecP），
                    // 断线过渡帧会把 _displayP 重组（dp 分层丢失）并污染 _freqOut，快照失效再回退。
                    const fSys = (isFinite(this._parDecF) && this._parDecF > 0)
                        ? this._parDecF
                        : ((isFinite(this._freqOut) && this._freqOut > 0) ? this._freqOut : this._displayFreq);
                    // Ps 允许负值：解列前处于逆功率的机组（如 reverse-power 流程）其显示
                    // 功率为负，快照必须原样使用，否则会回退到断线过渡帧被重组污染的
                    // _displayP（实测解列帧瞬间 _displayP 会从 -1.3kW 跳成 +9.7kW）。
                    const Ps = isFinite(this._parDecP)
                        ? this._parDecP
                        : (isFinite(this._displayP) ? this._displayP : 0);
                    // 仅当"两机设定均值明显偏离解列前系统频率"（转移功率残留场景，如流程 5
                    // 步骤 9 后 1#=51.7/2#=49.6、均值 50.65 vs fSys 49.995 差 0.66Hz）才复位；
                    // 正常设定（如 reverse-power 中 1#=50/2#≈50、均值≈fSys）及复并 act 正在
                    // 准备的设定不触发，避免破坏复并流程。均值须用 _parPaired（分支末尾才清）。
                    const pairF = (this._parPaired && isFinite(this._parPaired.freq))
                        ? this._parPaired.freq : this.freq;
                    const dev = Math.abs((this.freq + pairF) / 2 - fSys);
                    if (isFinite(fSys) && dev > 0.3) {
                        const newFreq = this.ratedPower > 0
                            ? fSys + (Ps / this.ratedPower) * this.freqDroop
                            : fSys;
                        if (isFinite(newFreq) && Math.abs(this.freq - newFreq) > 0.02) {
                            this.freq = Math.max(this.freqMin, Math.min(this.freqMax, newFreq));
                        }
                    }
                }
                this._parPaired = null;
                this._displayP = isFinite(this._pwr) ? this._pwr : 0;
            }
            // 并联保持期间：电网新增负载功率按调差系数分配加到显示功率上。
            // leader 统一计算并广播，保证两台面板读数一致。
            if (this._parMode && this._peers.length > 0) {
                let leader = this;
                for (const p of this._peers) if (p.id < leader.id) leader = p;
                if (leader === this) {
                    // 当前并联总负载（各机内部真实功率求和）
                    let tot = isFinite(this._pwr) ? this._pwr : 0;
                    for (const p of this._peers) tot += (isFinite(p._pwr) ? p._pwr : 0);
                    if (this._parBenchFrames > 0) {
                        // 校零期：并车后测量窗波动大，不判定新增负载，仅平滑采稳态总功率作零点
                        this._parBenchFrames--;
                        this._parTotalBase = (this._parBenchFrames === 49)
                            ? tot
                            : (isFinite(this._parTotalBase) ? this._parTotalBase * 0.8 + tot * 0.2 : tot);
                        this._parDP = 0;
                        // 原负载基准逐步平滑过渡到校零稳态值（从并车前 Pbefore 起平滑），
                        // 避免校零结束瞬间显示跳变；两机基准保持一致。
                        this._parBaseP = this._parTotalBase;
                        for (const p of this._peers) p._parBaseP = this._parTotalBase;
                    } else {
                        // 新增功率 = 当前总负载 - 并车稳态零点，经低通平滑（抑制波动）
                        const dp = Math.max(0, tot - this._parTotalBase);
                        this._parDP = this._parDP * 0.8 + dp * 0.2;
                    }
                    for (const p of this._peers) {
                        p._parDP = this._parDP;
                        p._parBenchFrames = this._parBenchFrames;
                    }
                    // ── 显示频率动态基准：平均设定频率平移叠加到并车初始基准 ──
                    // 并联运行后调节任一机调速旋钮（只改 this.freq），电网频率随之变化，
                    // 两机显示频率须同步跟随。物理上 fTarget=平均设定−下垂，此处同口径：
                    //   fBase = 并车初始基准 +（当前平均设定 − 并车时平均设定）
                    let fSum = this.freq, nF = 1;
                    for (const p of this._peers) { fSum += p.freq; nF++; }
                    const fAvg = fSum / nF;
                    const fBaseDyn = (isFinite(this._parFbaseInit) && isFinite(this._parFsetInit))
                        ? this._parFbaseInit + (fAvg - this._parFsetInit)
                        : this.freq;
                    this._parFbase = fBaseDyn;
                    // ── 运行时频率调节 → 功率转移份额 ──
                    // 相对平均设定越高 → 本机承担越多。每 0.1Hz 频偏 → 2% 总功率，
                    // 无饱和限制：持续调节频率（至旋钮限位 45~55Hz）功率持续转移，
                    // 两机 Σtransfer=0 保证总显示功率守恒。份额可超 100%（另一台为负）。
                    this._parTrans = (isFinite(this.freq - fAvg) ? (this.freq - fAvg) : 0) * 0.2;
                    for (const p of this._peers) {
                        p._parFbase = fBaseDyn;
                        p._parTrans = (isFinite(p.freq - fAvg) ? (p.freq - fAvg) : 0) * 0.2;
                    }
                }
                this._refreshDisplayP();
            }
            this._lastPeerCnt = this._peers.length;
            this._prevIsOn = this.isOn;
        }

        // 频率积分调节（手动旋钮 + 遥控指令叠加），并夹紧到上下限
        const rate = this._knobDir * this._manualRate + this._remoteRate;
        if (rate !== 0 || dt > 0) {
            this.freq = Math.max(this.freqMin, Math.min(this.freqMax, this.freq + rate * dt));
        }

        // ── 调差特性 ──
        // 1) 频率-有功下垂：满载 ratedPower(kW) 时频率下降 freqDroop(2Hz，4%)，频率不自动恢复，等待手动调节
        // 2) 电压-无功下垂 + AVR：感性无功达 qDroopVar(40kvar) 时线电压下降 vDroopV(20V，5%)，
        //    压降持续 avrDelay(3s) 后自动电压调节，avrTime 内逐渐恢复原值
        if (this.isOn) {
            // 下垂用功率限幅：并网冲击/测量窗口混入瞬态大值会使调差率项爆发式偏离，
            // 进而频率发散、相位旋转加剧（正反馈）。物理调速器输出有限幅，这里将
            // 参与下垂计算的功率夹在 ±2×额定功率内，保证最大下垂偏移 ≤ 2×freqDroop。
            const clampP = (p) => Math.max(-2 * p.ratedPower, Math.min(2 * p.ratedPower, p._pwr));
            const Pkw = clampP(this);
            let fTarget;
            let leader = null;
            if (this._peers.length > 0) {
                // 并联运行：各机按同一目标频率调节（基于系统总负荷统一下垂），保证各机频率完全一致。
                // 物理上并联网会通过同步转矩强制各机同频（相位锁定），本模型源电动势为 ω·t 解析式，
                // 故必须让各机频率严格相等，否则相位持续漂移 → 环流冲击 → 数值爆炸。
                // 各机有功分配由内阻调差实现（_rOnEff ∝ freqDroop，见上文），此处不再按单机下垂。
                leader = this;
                for (const p of this._peers) if (p.id < leader.id) leader = p;
                // 下垂基准用"空载设定频率"this.freq（旋钮/遥控调频目标），
                // 不能用当前动态频率 _freq：否则基准本身随下垂下降，每帧再减下垂 → 频率持续下滑。
                let fSum = this.freq, n = 1, Ptot = Pkw, Prated = this.ratedPower, dSum = this.freqDroop;
                for (const p of this._peers) {
                    fSum += p.freq; n++;
                    Ptot += clampP(p); Prated += p.ratedPower; dSum += p.freqDroop;
                }
                const fSet = fSum / n;
                const dAvg = dSum / n;
                fTarget = fSet - (Prated > 0 ? (Ptot / Prated) * dAvg : 0);
            } else {
                // 单机运行：仅频率-有功下垂
                fTarget = this.freq - (this.ratedPower > 0 ? (Pkw / this.ratedPower) * this.freqDroop : 0);
            }
            // ── 频率：二阶动态（负荷突降时频率瞬时过冲再回落）──
            const wn = this._wn, zeta = this._zeta;
            // 防御：任何一次异常把 _freq/_freqRate 污染为 NaN 后，+= 运算永远无法自愈，
            // 频率一旦 NaN 会随从机复制扩散到整个并网集群。此处强制复位。
            if (!isFinite(this._freq) || !isFinite(this._freqRate)) {
                this._freq = this.freq;
                this._freqRate = 0;
            }
            const accel = wn * wn * (fTarget - this._freq) - 2 * zeta * wn * this._freqRate;
            this._freqRate += accel * dt;
            this._freq += this._freqRate * dt;
            this._freqOut = this._freq;
            // 从机严格跟随主机频率（保持并联集群严格同频）。
            // 注意：相位偏移(_phaseShift)只在并网瞬间对齐一次，这里不可覆盖，
            // 否则会撤销并网时算好的相位对齐，导致相位差重新积累 → 环流爆炸。
            if (leader && leader !== this) {
                this._freq = leader._freq;
                this._freqRate = leader._freqRate;
                this._freqOut = leader._freq;
            }

            const lineVset = Math.sqrt(3) * this.vRms;
            // 无功计算限幅：S 中的 _rmsI 若混入并网冲击瞬态大值，Q 会爆炸 → droopV 爆炸 →
            // _vRmsOut 变为巨幅负值 → 电动势爆炸（正反馈）。用电流上限封住 S。
            // 注意限幅必须取额定电流：若取 2.5×，并网瞬间 _rmsI≈2000A 仍会把 Q 推到
            // 800kvar、droopV→400V，_vRmsOut 被夹到 0.5vRms=115V → 本机电动势塌到
            // 另一半 → 机组间出现 ~115V 电压差 → 环流持续数秒（负反馈被 AVR 缓慢恢复）。
            const Ilimit = this.ratedCurrent;
            const S = Math.sqrt(3) * lineVset * Math.min(this._rmsI, Ilimit);
            const P = Pkw * 1000;
            const Q = Math.sqrt(Math.max(0, S * S - P * P));
            this._qVar = Q;

            // ── AVR 闭环：以实测端子电压 _rmsV 为准（含内阻分压）──
            // 端子相电压实测值；若尚未采到（起动/空载清窗）回退设定值，避免误触发。
            const termV = this._rmsV > 0 ? this._rmsV : this.vRms;
            // 实测压降（相）：设定空载相电压 - 实测端子相电压。正值表示带载后端子电压偏低，
            // 既包含无功下垂，也包含阻性负载在内阻 rOn 上的有功分压。
            const dropPh = this.vRms - termV;

            // ── 误差比例减速 + 记忆保持（死区 + 低通，消除极限环）──
            // 欠压(dropPh>死区)→补偿量上升；过压(dropPh<-死区)→对称回落；
            // 达标(死区内)→保持当前补偿（记忆型，消除稳态误差且不过冲）。
            // 关键：补偿速率与误差成比例（误差越大越快、越接近目标越慢），
            // 接近死区时速率自然趋近 0，配合加大死区，避免固定速率积分穿越
            // 死区后仍继续过补偿 → 390/410 来回振荡。
            // 低通时间常数 0.2s（原 1.0s 滞后过大，加剧极限环），仅滤除测量高频抖动。
            this._errFilt = (this._errFilt || 0) + (dropPh - (this._errFilt || 0)) * Math.min(1, dt / 0.2);
            const db = 1.0;   // 死区（V，相电压）
            const satErr = 10; // 误差达到此值（V相）时为满速率
            const maxC = this.avrMaxComp || 1.0; // 补偿量上限（防起动瞬间过冲）
            const errAbs = Math.abs(this._errFilt);
            // 速率比例系数：|err|≤死区→0，≥satErr→1，线性过渡（比例控制，天然防过冲）
            const kRate = Math.min(1, Math.max(0, (errAbs - db) / (satErr - db)));
            const rate = (1 / (this.avrTime * 1.5)) * dt * kRate;  // 每帧变化量 ∝ 误差
            if (this._errFilt > db) {
                this._avrTimer += dt;
                if (this._avrTimer >= this.avrDelay) {
                    this._avrComp = Math.min(maxC, this._avrComp + rate);
                }
            } else if (this._errFilt < -db) {
                this._avrTimer = 0;
                this._avrComp = Math.max(0, this._avrComp - rate);
            }
            // 死区内（|err|<1.0V）：保持当前补偿量，不增不减
            // 输出相电压 = 空载电压 + 补偿升压（抵消内阻/无功分压，使端子恢复 vRms）。
            // 补偿上限 maxDropV(线电压) 折算到相电压 /√3，夹在 0.5vRms~1.3vRms 防并网冲击。
            this._vRmsOut = Math.max(0.5 * this.vRms, Math.min(1.3 * this.vRms,
                this.vRms + (this.maxDropV / Math.sqrt(3)) * this._avrComp));

            // ── 故障注入（优先级最高，覆盖正常调节结果）──
            // 调速器故障：输出频率强制 25Hz，线电压强制 280V（相电压 280/√3）
            if (this._faultGovernor) {
                this._freq     = 25;
                this._freqRate = 0;
                this._freqOut  = 25;
                this._vRmsOut  = 280 / Math.sqrt(3);
            }
            // 调压器（AVR）故障：线电压强制 200V（相电压 200/√3），频率保持正常
            if (this._faultAVR) {
                this._vRmsOut = 200 / Math.sqrt(3);
            }
        } else {
            this._freqOut = this.freq;
            this._freq = this.freq;
            this._freqRate = 0;
            this._vRmsOut = this.vRms;
            this._avrTimer = 0;
            this._avrComp = 0;
            this._qVar = 0;
        }

        // 转子旋转（仅运行时），机械角速度 ∝ 实际输出频率（×3 放大，动画更明显）
        if (this.isOn) {
            this._rotorAngle += (this._freqOut / 50) * 9 * (dt / 0.05);
            this._rotorGroup.rotation(this._rotorAngle % 360);
        }

        this._updateDisplay();
        if (this.sys && typeof this.sys.requestRedraw === 'function') this.sys.requestRedraw();
    }

    // ── 显示读数（本体 LCD 与遥控面板共用同一来源）────────────────
    // 电压使用实测端子值（滑窗 RMS）；功率使用 _displayP（并车教学修正）；
    // 电流与功率因数均随显示功率自洽推导：
    //   ① 功率因数取"真实负载功率因数"——由内部有功 _pwr 与真实电流 _rmsI 得出，
    //      保留电路真实物理特性（白炽灯≈1、电机感性≈0.8 等）；
    //   ② 显示电流由 显示功率/(√3·线电压·真实功率因数) 反推，
    //      使并车修正下 I、P、cosφ 三者严格自洽（P=√3·V·I·cosφ）。
    // 单机时 _displayP=_pwr，反推电流与真实 _rmsI 数学恒等，显示不变。
    _displayReading() {
        const lineV = this._rmsV > 0 ? Math.sqrt(3) * this._rmsV : this.getLineVoltage();
        const P = isFinite(this._displayP) ? this._displayP : this._pwr;
        const pwrReal = isFinite(this._pwr) ? this._pwr : 0;
        let cos = 0;
        if (this._rmsI > 0 && lineV > 0 && pwrReal !== 0) {
            // 逆功率（拖转/低频并车）时功率因数为正（数值上取 |有功|），
            // 电流方向由有功符号表达，cosφ 本身恒为 0~1
            cos = Math.min(1, Math.max(0, (Math.abs(pwrReal) * 1000) / (Math.sqrt(3) * lineV * this._rmsI)));
        }
        let I = 0;
        if (P !== 0 && lineV > 0) {
            if (cos > 0) {
                I = (Math.abs(P) * 1000) / (Math.sqrt(3) * lineV * cos);
            } else {
                // 真实功率因数丢失（如无功环流/励磁分量）→ 按纯阻性估算，避免除零爆表
                I = (Math.abs(P) * 1000) / (Math.sqrt(3) * lineV);
            }
        }
        return {
            on:    !!this.isOn,
            lineV: lineV,
            // 并车修正模式下的显示频率：
            //   原机组：随自身显示功率下垂（_displayFreq，功率只减 5% → 频率几乎不变）；
            //   新机组：[2 号机]直接复制原机组(_parPaired)的显示频率——并联机组必须同频，
            //      新机若按自身 5% 显示功率单独下垂会得到偏高的频率（近似空载频率），
            //      与新机已并网运行的物理事实不符、且与原机显示不一致。
            // 非并车修正（单机/解列）：显示真实频率 _freqOut。
            freq:  (this._parMode && isFinite(this._parBaseP) && this._parBaseP > 0)
                ? ((this._parIsNew && this._parPaired && isFinite(this._parPaired._displayFreq))
                    ? this._parPaired._displayFreq
                    : (isFinite(this._displayFreq) ? this._displayFreq : (this._freqOut ?? this.freq)))
                : ((this._freqOut ?? this.freq) || 0),
            I:     I || 0,
            P:     P || 0,
            cos:   cos,
        };
    }

    _updateDisplay() {
        // LCD 与遥控面板一致：行1 电压/频率，行2 电流/功率，行3 功率因数
        const r = this._displayReading();
        // 电流/功率 >100 去掉小数点，否则保留 1 位小数
        const fmt = (v) => v > 100 ? v.toFixed(0) : v.toFixed(1);
        if (this._lcdFreq) {
            this._lcdFreq.text(this.isOn ? `V ${r.lineV.toFixed(1)}V  F ${r.freq.toFixed(1)}Hz` : 'V--  F--');
        }
        if (this._lcdVolt) {
            this._lcdVolt.text(this.isOn ? `I ${fmt(r.I)}A  P ${fmt(r.P)}kW` : 'I--  P--');
        }
        if (this._lcdRated) {
            this._lcdRated.text(this.isOn ? `COSφ ${r.cos.toFixed(2)}` : 'COS--');
        }
        // 带灯按钮：运行→起动灯亮(绿)，停机→停止灯亮(红)
        if (this._startLed) {
            this._startLed.fill(this.isOn ? '#7dffb0' : '#3a3a3a');
        }
        if (this._stopLed) {
            this._stopLed.fill(this.isOn ? '#3a3a3a' : '#ff7d6b');
        }
    }

    // ── 原动机故障（供遥控面板 READY FOR START 指示灯与故障教学使用）──
    getEngineFaults() {
        return {
            overspeed:   !!this._faultOverspeed,
            oilPress:    !!this._faultOilPress,
            coolantTemp: !!this._faultCoolantTemp,
        };
    }

    // ── 解列前快照（面板分闸按钮按下瞬间由 GeneratorRemotePanel 调用）──
    // 并联稳态时冻结本机与并联伙伴的显示功率与系统频率，供解列分支做
    // "等效设定复位"：newFreq = 解列前系统频率 + 本机解列前下垂。此刻尚未断线，
    // _displayP/_freqOut 都是并联稳态值，不受断线过渡帧重组污染。
    freezeDecouple() {
        const freeze = (g) => {
            if (!g) return;
            g._parDecP = isFinite(g._displayP) ? g._displayP : g._pwr;
            g._parDecF = (isFinite(g._freqOut) && g._freqOut > 0) ? g._freqOut : g._displayFreq;
        };
        const peer = (this._parMode && this._parPaired) ? this._parPaired : null;
        freeze(this);
        if (peer) freeze(peer);
    }

    // 刷新并车修正后的显示功率：
    // 显示功率 = 并车基准份额(_parRatio：由并车瞬间频差决定，替代固定 5%)
    //            + 运行时频率调节转移份额(_parTrans：调高本机频率→功率增大)
    //            × P_before
    //            + 电网新增负载功率按调差系数分配的本机份额（_parShare×_parDP）。
    // 非并车修正模式下 _displayP 恒等于内部功率 _pwr。
    // 显示频率与显示功率联动：并车修正时按"显示功率×单机下垂公式"计算（随显示功率
    // 变化，不随真实功率），故原机功率只减 5% → 显示频率几乎不变；单机/解列时显示
    // 真实频率 _freqOut。
    _refreshDisplayP() {
        // 原动机故障拖转：显示真实逆功率（负），频率跟随并联母线（不复刻单机下垂）
        if (this._primeTrip) {
            this._displayP = isFinite(this._pwr) ? this._pwr : 0;
            this._displayFreq = (this._parMode && this._parPaired && isFinite(this._parPaired._displayFreq))
                ? this._parPaired._displayFreq
                : this._freqOut;
            return;
        }
        if (!this.isOn || !this._parMode || !isFinite(this._parBaseP) || this._parBaseP <= 0) {
            this._displayP = isFinite(this._pwr) ? this._pwr : 0;
            this._displayFreq = this._freqOut;
            return;
        }
        // 三层功率分配语义（教学规律）：
        //  1) 并车原负载（_parBaseP）：按并车瞬间频差份额 _parRatio 分配（正频差 0.1Hz→2%，
        //     由并车前新机设定频率 − 原机输出频率决定），并叠加运行时调设定产生的转移份额
        //     _parTrans（调节调速器只在本层转移功率，Σratio=1、Σtrans=0）；
        //  2) 电网新增负载（_parDP）：按调差系数份额 _parShare 分配（调差系数相同 → 均分，
        //     Σshare=1）。
        // 总显示功率 = (ratio+trans)×base + share×dp，Σ=1 → 守恒。
        const base = this._parBaseP;
        const ratio = this._parRatio || 0;
        const trans = isFinite(this._parTrans) ? this._parTrans : 0;
        const share = this._parShare || 0;
        const dp = (share > 0 && isFinite(this._parDP) && this._parDP > 0)
            ? this._parDP    // 新增负载功率
            : 0;
        // 并联逆功率：有故障机组（_primeTrip）逆功率时，整个电网的全部真实功率
        // 均由在网机组承担显示 —— 面板 = 电网总功率 + 逆功率绝对值：
        //   电网总功率 = Σ各机真实功率（逆功率为负值，先加回绝对值 → 电网真实负载功率）
        //   面板显示   = 电网总功率 + 逆功率绝对值（含供给故障机组拖转的能量）
        // 无逆功率时按原分配公式显示。仅影响显示，不影响物理 _pwr。
        let revComp = 0;
        let hasRev = false;
        for (const p of this._peers) {
            if (p._primeTrip && isFinite(p._pwr) && p._pwr < 0) {
                hasRev = true;
                revComp += Math.abs(p._pwr);
            }
        }
        if (hasRev) {
            let gridTotal = isFinite(this._pwr) ? this._pwr : 0;
            for (const p of this._peers) gridTotal += (isFinite(p._pwr) ? p._pwr : 0);
            gridTotal += revComp;   // 电网总功率（真实负载功率）
            this._displayP = gridTotal + revComp;   // 电网总功率 + 逆功率绝对值
        } else {
            this._displayP = (ratio + trans) * base + share * dp;
        }
        // 显示频率按显示功率单机下垂（与 fTarget 单机公式一致）：
        //   f = 并车前设定频率 fBase - (P_display/ratedPower)×freqDroop
        // fBase 采用并联期间 leader 广播的动态基准（_parFbase）：并车后调节任一机
        // 设定频率 → 平均设定变化 → 电网显示频率同步平移；并网瞬间物理层会把 freq
        // 对齐到 leader，_freqSetPre 仅在广播基准不可用时兜底。
        const fBase = isFinite(this._parFbase)
            ? this._parFbase
            : (isFinite(this._freqSetPre) ? this._freqSetPre : this.freq);
        const Pkw = Math.max(-2 * this.ratedPower, Math.min(2 * this.ratedPower, this._displayP));
        this._displayFreq = this.ratedPower > 0
            ? fBase - (Pkw / this.ratedPower) * this.freqDroop
            : fBase;
    }

    // ── 显示参数（供遥控面板 LCD 直接读取，与本体 LCD 完全同源同步）──
    getDisplayParams() {
        return this._displayReading();
    }

    // 设置原动机故障：kind ∈ 'overspeed' | 'oilPress' | 'coolantTemp'；on=true 置位故障
    setEngineFault(kind, on) {
        const map = { overspeed: '_faultOverspeed', oilPress: '_faultOilPress', coolantTemp: '_faultCoolantTemp' };
        const k = map[kind];
        if (!k) return;
        this[k] = !!on;
        this.markDirty();
        if (this.sys && typeof this.sys.requestRedraw === 'function') this.sys.requestRedraw();
    }

    // ─────────────────────────── 配置 ───────────────────────────
    getConfigFields() {
        return [
            { label: '初始频率 (Hz)',     key: 'freq',    type: 'number' },
            { label: '额定功率 (kW)',     key: 'ratedPower',   type: 'number' },
            { label: '额定电压 (V 线)',   key: 'ratedVoltage', type: 'number' },
            { label: '额定功率因数',      key: 'ratedCosPhi',  type: 'number', step: 0.01 },
            { label: '初始状态', key: 'isOn', type: 'select', get: c => c.isOn, options: [
                { label: '停机', value: false },
                { label: '运行', value: true },
            ]},
            { label: '满载频率下垂 (Hz)',   key: 'freqDroop', type: 'number', step: 0.5 },
            { label: '无功下垂基准 (kvar)', key: 'qDroopVar', type: 'number' },
            { label: '最大电压降 (V 线)',   key: 'vDroopV',   type: 'number' },
            { label: 'AVR 恢复延时 (s)',    key: 'avrDelay',  type: 'number' },
            { label: 'AVR 恢复时间 (s)',    key: 'avrTime',   type: 'number' },
            { label: 'AVR 最大补偿压降 (V线)', key: 'maxDropV', type: 'number' },
            { label: 'AVR 最大补偿比例 (0~1)', key: 'avrMaxComp', type: 'number', step: 0.05 },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.freq    !== undefined) this.freq    = parseFloat(cfg.freq)    || 50;
        if (cfg.freqMin !== undefined) this.freqMin = parseFloat(cfg.freqMin) || 45;
        if (cfg.freqMax !== undefined) this.freqMax = parseFloat(cfg.freqMax) || 55;
        if (cfg.ratedPower   !== undefined) { this.ratedPower   = parseFloat(cfg.ratedPower);   this._recalcRatedCurrent(); }
        if (cfg.ratedVoltage !== undefined) { this.ratedVoltage = parseFloat(cfg.ratedVoltage); this._recalcRatedCurrent(); }
        if (cfg.ratedCosPhi  !== undefined) { this.ratedCosPhi  = parseFloat(cfg.ratedCosPhi);  this._recalcRatedCurrent(); }
        if (cfg.isOn    !== undefined) this.isOn    = cfg.isOn === true || cfg.isOn === 'true';
        if (cfg.mode    !== undefined) {
            this.mode = cfg.mode === 'remote' ? 'remote' : 'local';
            if (this._switchKnob) this._switchKnob.rotation(this.mode === 'local' ? -45 : 45);
        }
        // 原动机故障注入（故障教学 / READY FOR START 灯演示）
        if (cfg.faultOverspeed   !== undefined) this._faultOverspeed   = cfg.faultOverspeed   === true || cfg.faultOverspeed   === 'true';
        if (cfg.faultOilPress    !== undefined) this._faultOilPress    = cfg.faultOilPress    === true || cfg.faultOilPress    === 'true';
        if (cfg.faultCoolantTemp !== undefined) this._faultCoolantTemp = cfg.faultCoolantTemp === true || cfg.faultCoolantTemp === 'true';
        if (cfg.freqDroop !== undefined) this.freqDroop = parseFloat(cfg.freqDroop) || 2;
        if (cfg.qDroopVar !== undefined) this.qDroopVar = parseFloat(cfg.qDroopVar) || 40000;
        if (cfg.vDroopV   !== undefined) this.vDroopV   = parseFloat(cfg.vDroopV)   || 20;
        if (cfg.avrDelay  !== undefined) this.avrDelay  = parseFloat(cfg.avrDelay)  || 8;
        if (cfg.avrTime   !== undefined) this.avrTime   = parseFloat(cfg.avrTime)   || 5;
        if (cfg.maxDropV  !== undefined) this.maxDropV  = parseFloat(cfg.maxDropV)  || 40;
        if (cfg.avrMaxComp !== undefined) this.avrMaxComp = parseFloat(cfg.avrMaxComp);
        this.freq = Math.max(this.freqMin, Math.min(this.freqMax, this.freq));
        this.config = { ...this.config, ...cfg };
        this._updateDisplay();
        if (this.sys && typeof this.sys.requestRedraw === 'function') this.sys.requestRedraw();
    }

    destroy() { super.destroy?.(); }
}
