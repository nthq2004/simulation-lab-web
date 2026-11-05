/**
 * BoilerSolver — 辅锅炉（PLC 控制）过程模型与虚拟 I/O 桥
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  依据：第六章 图 6-3-18（系统组成）、表 6-3-1（I/O 表）、
 *        图 6-3-20/21/22（梯形图 1~27 段）、图 6-3-23（运行流程图）。
 *
 *  职责分工：
 *    · 本模块        —— 锅炉物理过程（蒸汽压力、水位、重油温度、风压、火焰）
 *                       与机旁操纵台开关量的采集；
 *    · S7200Solver   —— 执行教材梯形图翻译成的 STL 程序（27 段），产生 Q 输出；
 *    · 虚拟 I/O 桥   —— 每扫描周期把面板/过程开关量写入 PLC 的 I 过程映像，
 *                       并把 Q 输出回读给锅炉本体、面板指示灯。
 *
 *  为什么用"虚拟端子"而不是画真实导线：
 *    锅炉系统图与操纵台在第 1 页、CPU 在第 2 页，平台的多页面画布约定
 *    "连线只在两端组件同页时显示"，跨页拉线不可行；因此 CPU 端子排以
 *    I/Q 实时状态的方式呈现（端子可点击查看地址、用途与电平）。
 * ═══════════════════════════════════════════════════════════════════════════
 */

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** 以 rate（每秒）向 target 逼近 */
function approach(cur, target, dt, rate) {
    const d = target - cur;
    const step = rate * dt;
    if (Math.abs(d) <= step) return target;
    return cur + Math.sign(d) * step;
}

/** Q 位索引：Q b.n → b*8+n */
const Q = (b, n) => b * 8 + n;

export class BoilerSolver {
    constructor(sys) {
        this.sys = sys;
        this.plcId = 'plc-1';

        // ── 可调参数（压力单位 MPa，水位 %，温度 ℃，时间 s）──
        this.cfg = {
            timeScale: 1,        // 仿真时间倍率（1 = 实时，预扫风 36 s）
            pStart: 0.50,        // 锅炉起压点
            pHighLow: 0.62,      // 大小火转换压力继电器上限（转小火）
            pHighLowLower: 0.50, // 大小火转换压力继电器下限（转回大火）
            pUpper: 0.70,        // 自动起停压力继电器上限（停炉）
            pLower: 0.56,        // 自动起停压力继电器复位值（压力降到 0.56 重新起动）
            pOver: 0.78,         // 蒸汽超压继电器
            pSafety: 0.85,       // 安全阀开启压力（卸放，维持汽包压力）
            heatFull: 0.0045,    // 大火热负荷（MPa/s）
            heatLow: 0.0030,     // 小火热负荷（MPa/s）
            demand: 0.0036,      // 用汽负荷（MPa/s）：负荷旋钮 50% 对应值
            pumpRate: 2.2,       // 给水泵流量（%/s）
            blowdownRate: 1.0,   // 排污放水速率（%/s，排污截止阀导通时）
            evapFull: 0.55,      // 大火蒸发（%/s）
            evapLow: 0.30,       // 小火蒸发（%/s）
            levelLowSet: 35,     // 正常水位下限（液位继电器动作）
            levelHighSet: 70,    // 正常水位上限
            levelDangerLow: 20,  // 危险低水位电极
            levelOverHigh: 85,   // 超高水位电极
            oilTempLow: 90,      // 重油油温过低继电器
            oilTempTarget: 115,  // 重油加热器目标温度
        };

        /** 运行状态（面板 / 本体 / 状态仪共同读取） */
        this.m = {
            t: 0,
            // 机旁操纵台
            power: false,
            burnerKnob: 'stop',      // stop | sweep | auto | ignite | low | high
            oilPumpKnob: 'stop',     // stop | p1 | p2
            pump1Mode: 'stop',       // 1# 给水泵选择：stop | auto | manual
            pump2Mode: 'stop',       // 2# 给水泵选择：stop | auto | manual
            // 过程量
            pressure: 0.55,
            level: 56,
            oilTemp: 108,
            airPressure: 0,          // 0~1（风压建立程度）
            airPressureOk: false,
            flame: 0,                // 0~1（火焰强度）
            flameOn: false,
            // 输出镜像（Q 过程映像）
            out: {},
        };

        // 按钮脉冲截止时间（s）
        this._pulse = { prep: 0, stop: 0, mute: 0 };

        // 故障标志
        this.faults = {
            fanPressure: false,   // 风压继电器不动作（风机运行但风压失压）
            damperStuck: false,   // 风门卡死在关小位置（风量不足 → 风压建立不起来）
            igniteFail: false,    // 点火失败（油路/点火变压器故障）
            flameOut: false,      // 运行中故障熄火
            flameSensor: false,   // 火焰探头脏污（测不到火焰信号）
            lowWater: false,      // 水位异常下降（泄漏/给水不足）
            highWater: false,     // 水位异常上升
            overPressure: false,  // 自动起停压力继电器失灵（不切停）
            oilTempLowFault: false, // 重油加热器故障（油温下降）
            waterPumpFail: false, // 给水泵不出水
            noDemand: false,      // 无蒸汽用户（压力只升不降）
        };

        // 两条油泵支路的入口截止阀（手动阀：true=开启）。默认起动即接通；
        // 某支路截止阀关闭 → 该支路断油，油泵虽转而喷油电磁阀无油可喷 → 点不着火。
        this.oilValves = [true, true];

        // 压力继电器状态（带上下限回差，避免压力在设定点附近反复动作）
        this._upperRelay = false;   // true：已达自动起停上限（接点断开）
        this._hlRelay = false;      // true：已达大小火转换上限（转小火）

        this.q = new Array(64).fill(false);
        this.mbits = new Array(256).fill(false);
        this.timers = null;
        this.scanCount = 0;
        this.plcError = null;

        // 注册为系统级虚拟 I/O 桥（S7200Solver 扫描到读取输入后调用 applyInputs）
        sys.ioBridge = this;

        this.reset();
    }

    // ═══════════════════════════════════════════════════════════
    //  复位
    // ═══════════════════════════════════════════════════════════
    reset() {
        const m = this.m;
        m.t = 0;
        m.power = false;
        m.burnerKnob = 'stop';
        m.oilPumpKnob = 'stop';
        m.pump1Mode = 'stop';
        m.pump2Mode = 'stop';
        m.pressure = 0.55;
        m.level = 56;
        m.oilTemp = 108;
        m.airPressure = 0;
        m.airPressureOk = false;
        m.flame = 0;
        m.flameOn = false;
        m.safetyOpen = false;
        m.blowdown = false;
        m.i23Grounded = false;
        m.i26Grounded = false;
        m.out = {};
        this._pulse = { prep: 0, stop: 0, mute: 0 };
        this._upperRelay = false;
        this._hlRelay = false;
        this.oilValves = [true, true];      // 复位后两路入口截止阀恢复接通
        this._mk = null; this._mkT = 0; this._mLoad = false; this._mPost = false;
        Object.keys(this.faults).forEach(k => { this.faults[k] = false; });
        // 同时复位 PLC 过程映像（Q/M/定时器），否则上一次的报警锁存（如风机失压 Q1.0）
        // 会让锅炉永远无法重新起动——这正是"按下起动毫无反应"的典型故障。
        this.resetPLC();
    }

    /** 复位 PLC 过程映像（Q/M/定时器/计数器），保留程序与运行模式 */
    resetPLC() {
        const sol = this.sys && this.sys.s7200Solver;
        if (sol && typeof sol.resetPLC === 'function') {
            try { sol.resetPLC(this.plcId); } catch (e) { /* ignore */ }
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  虚拟 I/O 桥：写 PLC 输入过程映像
    // ═══════════════════════════════════════════════════════════
    applyInputs(plc, ctx) {
        if (!plc || plc.id !== this.plcId || !ctx || !Array.isArray(ctx.I)) return;
        const m = this.m;
        const t = m.t;
        const powered = !!m.power;

        const knob = m.burnerKnob;
        const oilKnob = m.oilPumpKnob;

        const set = (byte, bit, v) => { ctx.I[Q(byte, bit)] = powered ? !!v : false; };

        // ── 水位控制（I0.0~I0.6）──
        set(0, 0, m.pump1Mode === 'auto');
        set(0, 1, m.pump1Mode === 'manual');
        set(0, 2, m.pump2Mode === 'auto');
        set(0, 3, m.pump2Mode === 'manual');
        // 液位继电器（正常水位调节触点）：低于下限闭合，高于上限断开（双位）
        if (m.level < this.cfg.levelLowSet) this._levelRelay = true;
        else if (m.level > this.cfg.levelHighSet) this._levelRelay = false;
        set(0, 4, !!this._levelRelay);
        set(0, 5, m.level >= this.cfg.levelOverHigh);   // 超高水位电极
        set(0, 6, m.level <= this.cfg.levelDangerLow);  // 危险低水位电极

        // ── 燃烧控制开关与按钮（I0.7~I1.7）──
        set(0, 7, t < this._pulse.prep);            // 燃烧准备（按钮）
        set(1, 0, t < this._pulse.stop);            // 燃烧停止（按钮）
        set(1, 1, knob === 'auto');                 // 自动
        set(1, 2, knob === 'sweep');                // 扫风
        set(1, 3, knob === 'ignite');               // 点火
        set(1, 4, knob === 'low');                  // 小火
        set(1, 5, knob === 'high');                 // 大火
        set(1, 6, oilKnob === 'p1');                // 1# 油泵选择
        set(1, 7, oilKnob === 'p2');                // 2# 油泵选择

        // ── 传感器与保护（I2.0~I2.6）──
        set(2, 0, t < this._pulse.mute);                              // 消声（按钮）
        set(2, 1, m.oilTemp < this.cfg.oilTempLow);                   // 重油油温过低
        set(2, 2, !!m.airPressureOk);                                 // 风压正常（继电器闭合）
        // 自动起停压力继电器（带上、下限回差）：达上限断开，降至下限重新闭合。
        // PLC 图 6-3-20 程序段 6 用常闭触点 AN I2.3，故上限动作时输入为 1。
        const cfg = this.cfg;
        if (m.pressure >= cfg.pUpper) this._upperRelay = true;
        else if (m.pressure <= cfg.pLower) this._upperRelay = false;
        set(2, 3, this._upperRelay && !this.faults.overPressure);
        set(2, 4, !!m.flameOn);                                       // 火焰监视（紫外光电管）
        // 大小火转换压力继电器（同样带上下限回差）
        if (m.pressure >= cfg.pHighLow) this._hlRelay = true;
        else if (m.pressure <= cfg.pHighLowLower) this._hlRelay = false;
        set(2, 5, this._hlRelay);                                     // 上限断开 → 转小火
        set(2, 6, m.pressure >= this.cfg.pOver);                      // 蒸汽超压

        // ── 安全阀试验：I2.3 / I2.6 端子直接接地（PE）时，信号被短路屏蔽 ──
        // 接地后 PLC 读到的输入恒为 0 → 自动停机与蒸汽超压保护都失去作用，
        // 汽包压力会一路上升，直到安全阀（0.85 MPa）起跳卸放。
        const pid = plc.id;
        this.m.i23Grounded = this._isGrounded(`${pid}_wire_di23`);
        this.m.i26Grounded = this._isGrounded(`${pid}_wire_di26`);
        if (this.m.i23Grounded) { set(2, 3, false); this._upperRelay = false; }
        if (this.m.i26Grounded) { set(2, 6, false); }
    }

    /** 端口是否经导线（可多段）接到接地符号的 PE 端子 */
    _isGrounded(portId) {
        const sys = this.sys;
        const conns = (sys && Array.isArray(sys.conns)) ? sys.conns : null;
        if (!conns || !portId) return false;
        const adj = new Map();
        for (const c of conns) {
            if (!c || !c.from || !c.to) continue;
            if (!adj.has(c.from)) adj.set(c.from, []);
            if (!adj.has(c.to)) adj.set(c.to, []);
            adj.get(c.from).push(c.to);
            adj.get(c.to).push(c.from);
        }
        if (!adj.has(portId)) return false;
        const seen = new Set([portId]);
        const queue = [portId];
        while (queue.length) {
            const cur = queue.shift();
            if (/_wire_pe$/.test(cur)) return true;      // 接地符号的端口
            for (const nx of (adj.get(cur) || [])) {
                if (!seen.has(nx)) { seen.add(nx); queue.push(nx); }
            }
        }
        return false;
    }

    // ═══════════════════════════════════════════════════════════
    //  过程模型
    // ═══════════════════════════════════════════════════════════
    solve(dtRaw) {
        const speed = Math.max(1, this.cfg.timeScale || 1);
        // 与 PLC 扫描使用同一时间基准（consys 也把 dt × 倍率 传给 S7200Solver），
        // 保证模型过程量与 T101~T108 的定时在倍率下依然同步。
        const dt = (dtRaw || 0.05) * speed;
        const m = this.m;
        m.t += dt;

        // ── 读取 PLC 过程映像（上一扫描的 Q / M / T）──
        const sol = this.sys && this.sys.s7200Solver;
        const img = sol && typeof sol.getProcessImage === 'function' ? sol.getProcessImage(this.plcId) : null;
        if (img) {
            this.q = img.Q;
            this.mbits = img.M;
            this.timers = img.T;
            this.scanCount = img.scanCount || 0;
            this.plcError = img.error || null;
        }
        const q = this.q;
        const powered = !!m.power;

        const out = {
            waterPump1: powered && !!q[Q(0, 0)],
            waterPump2: powered && !!q[Q(0, 1)],
            levelHighAlarm: !!q[Q(0, 2)],
            levelLowAlarm: !!q[Q(0, 3)],
            fan: powered && !!q[Q(0, 4)],
            oilPump1: powered && !!q[Q(0, 5)],
            oilPump2: powered && !!q[Q(0, 6)],
            oilTempAlarm: !!q[Q(0, 7)],
            fanFailAlarm: !!q[Q(1, 0)],
            igniter: powered && !!q[Q(1, 1)],
            gasMain: powered && !!q[Q(1, 2)],
            gas1: powered && !!q[Q(1, 3)],
            damperClosed: powered && !!q[Q(1, 4)],
            gas2: powered && !!q[Q(1, 5)],
            flameLamp: !!q[Q(1, 6)],
            overPressureAlarm: !!q[Q(1, 7)],
            horn: !!q[Q(2, 0)],
            ready: !!q[Q(2, 1)],
            highFire: !!q[Q(2, 2)],
            lowFire: !!q[Q(2, 3)],
            igniteFailAlarm: !!q[Q(2, 4)],
            flameOutAlarm: !!q[Q(2, 5)],
        };
        m.out = out;

        // ── 风压（风机运行后约 1.5 s 建立；风压继电器故障时不建立）──
        let airTarget = (out.fan && !this.faults.fanPressure) ? 1 : 0;
        // 风门卡死在关小位置：风量不够，风压只能建立到 0.45（低于 0.6 的合格值）
        if (this.faults.damperStuck) airTarget = Math.min(airTarget, 0.45);
        m.airPressure = approach(m.airPressure, airTarget, dt, 0.7);
        m.airPressureOk = m.airPressure > 0.6;

        // ── 火焰（有油、有风、有点火变压器或已有火 → 约 1.2 s 建立）──
        // 入口截止阀未开 → 该支路没有油，油泵空转
        const v1 = this.oilValves[0] !== false, v2 = this.oilValves[1] !== false;
        const pumpOil1 = out.oilPump1 && v1;
        const pumpOil2 = out.oilPump2 && v2;
        const fuelIn = out.gasMain && out.gas1 && (pumpOil1 || pumpOil2);
        const airOk = m.airPressureOk;
        let wantFlame = fuelIn && airOk && (out.igniter || m.flame > 0.5);
        if (this.faults.igniteFail || this.faults.flameOut || this.faults.flameSensor) wantFlame = false;
        if (m.oilTemp < this.cfg.oilTempLow) wantFlame = false;   // 重油温度过低无法良好雾化
        m.flame = approach(m.flame, wantFlame ? 1 : 0, dt, wantFlame ? 0.85 : 1.7);
        m.flameOn = m.flame > 0.5;

        // ── 蒸汽压力 ──
        const heat = m.flameOn ? (out.gas2 ? this.cfg.heatFull : this.cfg.heatLow) : 0;
        let demand = this.faults.noDemand ? 0
            : this.cfg.demand * (1 + 0.25 * Math.sin(m.t / 37));
        m.pressure = clamp(m.pressure + (heat - demand) * dt, 0, 1.2);
        // ── 安全阀：起座 0.85 MPa，回座压力 = 0.9 × 起座压力 = 0.765 MPa（带 10% 回差）──
        // 起座后阀门保持开启、把汽包压力钳在 0.85 MPa；
        // 只有压力回落到 0.765 MPa 以下才重新关闭（截止），避免在设定点附近频繁启闭。
        const pRelief = this.cfg.pSafety || 0.85;
        const pReseat = pRelief * 0.9;
        if (m.pressure >= pRelief) m.safetyOpen = true;
        if (m.safetyOpen && m.pressure <= pReseat) m.safetyOpen = false;
        if (m.safetyOpen) m.pressure = Math.min(m.pressure, pRelief);

        // ── 水位（给水泵进水 - 蒸发；含故障注水/失水）──
        const wpOn = (out.waterPump1 || out.waterPump2) && !this.faults.waterPumpFail;
        const supply = wpOn ? this.cfg.pumpRate : 0;
        const evap = m.flameOn ? (out.gas2 ? this.cfg.evapFull : this.cfg.evapLow) : 0;
        let dLevel = supply - evap;
        // 排污截止阀导通 → 放水，水位以 1 %/s 下降（与给水、蒸发叠加）
        if (m.blowdown) dLevel -= (this.cfg.blowdownRate || 1.0);
        if (this.faults.lowWater) dLevel -= 4.0;   // 泄漏/给水不足：水位快速下降
        if (this.faults.highWater) dLevel += 2.4;
        m.level = clamp(m.level + dLevel * dt, 0, 100);

        // ── 重油温度（蒸汽加热器；加热器故障时自然冷却）──
        const heaterOn = powered && !this.faults.oilTempLowFault;
        m.oilTemp = approach(m.oilTemp, heaterOn ? this.cfg.oilTempTarget : 25, dt, heaterOn ? 0.30 : 0.12);

        // ── 运行阶段（供面板 / 状态显示）──
        m.stage = this._stageText();
        m.countdown = this._countdownText();
        m.alarms = this.getAlarms();
    }

    _timer(no) {
        const t = this.timers && this.timers[no];
        if (!t) return { cur: 0, bit: false, preset: 0 };
        // 时基 100ms（T101~T108 均属 100ms 级）
        return { cur: t.cur, bit: !!t.bit, preset: t.preset || 0, sec: (t.cur || 0) / 10 };
    }

    _stageText() {
        const m = this.m, out = m.out || {};
        const t101 = this._timer(101), t102 = this._timer(102), t103 = this._timer(103), t104 = this._timer(104);
        const autoSafe = !!(this.mbits && this.mbits[Q(0, 2)]);   // M0.2 自动安全运行信号
        const fanOn = !!out.fan;
        // T104 是断电延时（TOF）：自动运行时它一直闭合；自动条件消失后才开始 20 s 计时，
        // 因此"后扫风"= 风机仍在转、但自动安全信号已消失（或已按停止）。
        if (!fanOn && !t104.bit) return '停炉';
        if (!out.ready && fanOn) return '后扫风';
        if (t104.bit && fanOn && !autoSafe) return '后扫风';
        // 手动档位：不跑自动定时器，按旋钮位置 + 停留时间判定
        if (m.burnerKnob !== 'auto') return this._manualStage();
        if (!t101.bit) return '预扫风';
        if (!this._timer(109).bit) return '点火位置';
        if (!this._timer(110).bit) return '点火准备';
        if (!t102.bit) return '点火';
        if (!t103.bit) return '小火稳定';
        return out.highFire ? '大火运行' : '小火运行';
    }

    /**
     * 手动方式阶段判定（按燃烧控制旋钮位置）：
     *   停止 → 停炉；扫风 → 预扫风（由小火/大火转来则显示后扫风）
     *   点火 → 点火；小火 → 火焰稳定（≥18 s 或曾进入大火后为负荷控制）
     *   大火 → 负荷控制；进入负荷控制后在小火/大火之间切换保持
     */
    _manualStage() {
        const m = this.m;
        const knob = m.burnerKnob;
        const prev = this._mk;
        if (knob !== prev) {
            this._mk = knob;
            this._mkT = m.t;
            if (knob === 'sweep') this._mPost = (prev === 'low' || prev === 'high' || prev === 'ignite');
            else if (knob === 'ignite' || knob === 'stop') { this._mLoad = false; this._mPost = false; }
        }
        if (knob === 'high') this._mLoad = true;
        else if (knob === 'low' && !this._mLoad && (m.t - (this._mkT || 0)) >= 18) this._mLoad = true;

        switch (knob) {
            case 'sweep': return this._mPost ? '后扫风' : '预扫风';
            case 'ignite': return '点火';
            case 'low': return this._mLoad ? '小火运行' : '小火稳定';
            case 'high': return '大火运行';
            case 'stop':
            default: return '停炉';
        }
    }

    /** 剩余时间：一律用定时器自己的设定值（preset）计算，参数被改动后也准确 */
    _left(no) {
        const t = this._timer(no);
        const total = (t.preset || 0) / 10;
        return Math.max(0, total - t.sec).toFixed(0);
    }

    _countdownText() {
        const out = this.m.out || {};
        if (this.m.stage === '预扫风') return `${this._left(101)} s`;
        if (this.m.stage === '点火位置') return `${this._left(109)} s`;
        if (this.m.stage === '点火准备') return `${this._left(110)} s`;
        if (this.m.stage === '点火') return `${this._left(102)} s`;
        if (this.m.stage === '小火稳定') return `${this._left(103)} s`;
        if (this.m.stage === '后扫风') return `${this._left(104)} s`;
        if (!out.ready) return '—';
        return '—';
    }

    /** 报警清单（供面板报警窗显示；ack = 已消声） */
    getAlarms() {
        const out = this.m.out || {};
        const muted = (byte, bit) => !!(this.mbits && this.mbits[Q(byte, bit)]);
        const list = [
            { id: 'levelHigh', name: '水位过高', on: out.levelHighAlarm, ack: muted(1, 6) },
            { id: 'levelLow', name: '水位过低', on: out.levelLowAlarm, ack: muted(1, 0) },
            { id: 'oilTemp', name: '重油油温过低', on: out.oilTempAlarm, ack: muted(1, 1) },
            { id: 'fanFail', name: '风机失压', on: out.fanFailAlarm, ack: muted(1, 2) },
            { id: 'overPressure', name: '蒸汽压力过高', on: out.overPressureAlarm, ack: muted(1, 3) },
            { id: 'flameOut', name: '故障熄火', on: out.flameOutAlarm, ack: muted(1, 4) },
            { id: 'igniteFail', name: '点火失败', on: out.igniteFailAlarm, ack: muted(1, 5) },
        ];
        return list.filter(a => a.on);
    }

    /** 当前是否有未消声报警（面板蜂鸣器 / 报警灯用） */
    hasUnmutedAlarm() { return this.getAlarms().some(a => !a.ack); }

    // ═══════════════════════════════════════════════════════════
    //  机旁操纵台 API
    // ═══════════════════════════════════════════════════════════
    togglePower() { this.m.power = !this.m.power; if (!this.m.power) this.m.burnerKnob = 'stop'; return this.m.power; }

    /** 燃烧控制旋钮档位顺序（停止→扫风→自动→点火→小火→大火，多档不循环） */
    // 顺时针排列：自动(-45°) → 停止(0°) → 扫风(45°) → 点火(90°) → 小火(135°) → 大火(180°)
    get burnerModes() { return ['auto', 'stop', 'sweep', 'ignite', 'low', 'high']; }

    cycleBurnerKnob(dir = 1) {
        const order = this.burnerModes;
        const i = order.indexOf(this.m.burnerKnob);
        const next = clamp(i + (dir > 0 ? 1 : -1), 0, order.length - 1);
        this.m.burnerKnob = order[next];
        return this.m.burnerKnob;
    }

    setBurnerKnob(mode) {
        if (this.burnerModes.includes(mode)) this.m.burnerKnob = mode;
        return this.m.burnerKnob;
    }

    // 顺时针排列：1#(-90°) → 停止(0°) → 2#(+90°)
    get oilPumpModes() { return ['p1', 'stop', 'p2']; }

    cycleOilPump(dir = 1) {
        const order = this.oilPumpModes;
        const i = order.indexOf(this.m.oilPumpKnob);
        this.m.oilPumpKnob = order[clamp(i + (dir > 0 ? 1 : -1), 0, order.length - 1)];
        return this.m.oilPumpKnob;
    }

    setOilPump(mode) { if (this.oilPumpModes.includes(mode)) this.m.oilPumpKnob = mode; return this.m.oilPumpKnob; }

    // 每台给水泵一个三档选择开关：自动(-90°) → 停止(0°) → 手动(+90°)
    get pumpModes() { return ['auto', 'stop', 'manual']; }

    cyclePump(which, dir = 1) {
        const key = which === 2 ? 'pump2Mode' : 'pump1Mode';
        const order = this.pumpModes;
        const i = Math.max(0, order.indexOf(this.m[key]));
        this.m[key] = order[clamp(i + (dir > 0 ? 1 : -1), 0, order.length - 1)];
        return this.m[key];
    }

    setPump(which, mode) {
        const key = which === 2 ? 'pump2Mode' : 'pump1Mode';
        if (this.pumpModes.includes(mode)) this.m[key] = mode;
        return this.m[key];
    }

    /** 兼容旧接口：'stop' / 'p1auto' / 'p1manual' / 'p2auto' / 'p2manual' */
    get waterPumpModes() { return ['stop', 'p1auto', 'p1manual', 'p2auto', 'p2manual']; }

    cycleWaterPump(dir = 1) {
        const order = this.waterPumpModes;
        const cur = (this.m.pump1Mode === 'auto') ? 'p1auto'
            : (this.m.pump1Mode === 'manual') ? 'p1manual'
                : (this.m.pump2Mode === 'auto') ? 'p2auto'
                    : (this.m.pump2Mode === 'manual') ? 'p2manual' : 'stop';
        const i = order.indexOf(cur);
        return this.setWaterPump(order[clamp(i + (dir > 0 ? 1 : -1), 0, order.length - 1)]);
    }

    setWaterPump(mode) {
        const map = {
            stop: ['stop', 'stop'],
            p1auto: ['auto', 'stop'], p1manual: ['manual', 'stop'],
            p2auto: ['stop', 'auto'], p2manual: ['stop', 'manual'],
        };
        const [a, b] = map[mode] || ['stop', 'stop'];
        this.m.pump1Mode = a;
        this.m.pump2Mode = b;
        return mode;
    }

    /** 按钮：燃烧准备（自锁由 PLC 程序段 5 完成，按钮只给脉冲） */
    pressPrep(ms = 700) { this._pulse.prep = this.m.t + ms / 1000; }
    pressStop(ms = 700) { this._pulse.stop = this.m.t + ms / 1000; }
    pressMute(ms = 700) { this._pulse.mute = this.m.t + ms / 1000; }

    // ═══════════════════════════════════════════════════════════
    //  故障注入（故障界面 / 工作流调用）
    // ═══════════════════════════════════════════════════════════
    setFault(id, on) {
        if (id in this.faults) { this.faults[id] = !!on; return true; }
        return false;
    }

    getFault(id) { return !!(id in this.faults && this.faults[id]); }

    clearFaults() { Object.keys(this.faults).forEach(k => { this.faults[k] = false; }); }
}

export default BoilerSolver;
