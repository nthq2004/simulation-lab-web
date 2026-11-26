/**
 * GensetStartSolver — 船舶柴油发电机组（副机）起动与调速过程模型
 * ═══════════════════════════════════════════════════════════════════════════
 *  工程：副机起动和调速系统的功能测试（单页组件 GensetStartMimic）
 *
 *  一、起动联锁（8 个条件，全部满足才允许起动）
 *    ① 盘车机构脱开（DISENGAGED）
 *    ② 停机手柄在工作位（WORK，闭锁手柄未压下）
 *    ③ 安保已复位（无跳闸锁存）
 *    ④ 起动空气压力 > 2.0 MPa（20 bar）
 *    ⑤ 燃油压力 > 0.6 MPa（6 bar）
 *    ⑥ 调速器无故障
 *    ⑦ 断路器分闸
 *    ⑧ 柴油机转速低于发火转速（120 r/min）
 *
 *  二、起动执行链
 *    起动指令（机旁 / 遥控）→ 起动电磁阀得电 → 主起动阀打开（气动控制阀正常）
 *    → 空气分配器按发火顺序把起动空气送入各缸 → 曲轴转动 → 燃油投入 → 发火
 *    → 转速 > 200 r/min 时起动电磁阀断电（主起动阀关闭）→ 怠速 → 稳定运行
 *
 *  三、起动时序（互斥，同一时间只有一个状态灯亮）
 *    停止 → 准备好 → 起动 → 起动空气投入 → 曲轴转动 → 燃油投入 → 发火 → 怠速运行 → 稳定运行
 *    对应转速节点：0 s/0 → 5 s/30 → 10 s/120 → 15 s/200 → 25 s/600 → 40 s/1700 → 48 s/1800
 *
 *  四、调速系统
 *    转速设定值（默认 1800 r/min）→ 电子调速器 → 油门拉杆 → 高压油泵齿条 → 燃油量
 *    刺破阀（PUNCTURE VALVE）：通入控制空气即泄放高压油泵燃油，机组立即停油停车
 *
 *  五、趋势记录：燃油量（%）与转速（r/min）各保留最近 3 min，0.5 s 采样一次
 * ═══════════════════════════════════════════════════════════════════════════
 */

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** 向目标值逼近（每秒最多变化 rate） */
function approach(cur, target, dt, rate) {
    if (!(rate > 0)) return target;
    const d = target - cur;
    const step = rate * dt;
    if (Math.abs(d) <= step) return target;
    return cur + Math.sign(d) * step;
}

/** 发火转速（r/min）：低于此转速才允许起动 */
export const FIRE_SPEED = 120;

/** 起动转速时间节点：[时间 s, 转速 r/min] */
export const START_KNOTS = [[0, 0], [5, 30], [10, 120], [15, 200], [25, 600], [40, 1700], [48, 1800]];

/** 起动时序状态（互斥） */
export const SEQ_STEPS = ['STOP', 'READY', 'START', 'AIR', 'CRANK', 'FUEL', 'FIRE', 'IDLE', 'STABLE'];
export const SEQ_CN = {
    STOP: '停止', READY: '准备好', START: '起动', AIR: '起动空气投入', CRANK: '曲轴转动',
    FUEL: '燃油投入', FIRE: '发火', IDLE: '怠速运行', STABLE: '稳定运行',
};
export const SEQ_EN = {
    STOP: 'STOPPED', READY: 'READY', START: 'STARTING', AIR: 'START AIR ON', CRANK: 'CRANKING',
    FUEL: 'FUEL IN', FIRE: 'FIRING', IDLE: 'IDLE', STABLE: 'STABLE',
};

/** 起动联锁 8 个条件 */
export const START_CONDITIONS = [
    { key: 'turningGear', cn: '盘车机构脱开', en: 'TURNING GEAR DISENGAGED' },
    { key: 'blockHandle', cn: '停机手柄工作位', en: 'BLOCK HANDLE AT WORK' },
    { key: 'safety', cn: '安保已复位', en: 'SAFETY RESET' },
    { key: 'airPress', cn: '起动空气压力 > 2.0 MPa', en: 'START AIR PRESS.' },
    { key: 'fuelPress', cn: '燃油压力 > 0.6 MPa', en: 'FUEL OIL PRESS.' },
    { key: 'governor', cn: '调速器无故障', en: 'GOVERNOR OK' },
    { key: 'breaker', cn: '断路器分闸', en: 'BREAKER OPEN' },
    { key: 'engineSpeed', cn: '转速低于发火转速', en: 'ENGINE STOPPED' },
];

/** 趋势窗口（s） */
export const TREND_WINDOW = 180;

export function createStartModel() {
    return {
        clock: 0,
        mode: 'LOCAL',              // BLOCK / LOCAL / REMOTE
        turningGear: false,         // true = 盘车机构啮合
        blockHandle: false,         // true = 停机手柄压下（STOP 位）
        lampTest: false, _lampT: 0,

        safetyReset: true,          // 安保复位状态
        trips: { overspeed: false, loPress: false, htTemp: false, estop: false },

        air: {
            press: 28.0, max: 30.0, min: 20.0,   // bar（min = 2.0 MPa）
            comp: false, compOn: true, valve: false,
        },
        fuel: {
            press: 6.5, pressSet: 6.5, minPress: 6.0,   // bar（minPress = 0.6 MPa）
            pump: true, quickClose: false,              // quickClose = true → 速闭阀关闭
            punctureAir: false,                          // 刺破阀通控制空气 → 停油
            tankLevel: 72,
        },
        gov: { setpoint: 1800, fault: false, rack: 0, active: false },

        breaker: { closed: false, ready: false },
        loadTest: { on: false, kw: 100 },

        engine: { speed: 0, running: false, cranking: false, fuel: 0, load: 0, startFail: false, runtime: 0 },
        gen: { volt: 0, freq: 0, kw: 0, amp: 0 },

        exec: { solenoid: false, mainValve: false, distributor: false, cyl: -1 },
        seq: 'STOP',
        seqT: 0,
        startCmd: null,             // 'LOCAL' | 'REMOTE' | null
        condOk: false,
        condList: [],
        fuelCut: false,

        faults: {
            pneu: false,            // 气动控制阀故障（主起动阀不能打开）
            distributor: false,     // 空气分配器故障
            gov: false,             // 调速器故障
            fuelPump: false,        // 燃油泵故障
            fuelLow: false,         // 燃油压力低
            airComp: false,         // 空压机故障
        },

        // 趋势（最近 3 min）
        hist: { t: [], fuel: [], speed: [] },
    };
}

export class GensetStartSolver {
    constructor(sys) {
        this.sys = sys;
        this.cfg = { timeScale: 1 };
        this.m = createStartModel();
        this._histAcc = 0;
    }

    _tip(msg) {
        if (this.sys && typeof this.sys._tipPurifier === 'function') this.sys._tipPurifier(msg);
    }

    // ═══════════════════════════════════════════════════════════
    //  过程求解（20 fps，dt ≈ 0.05 s）
    // ═══════════════════════════════════════════════════════════
    solve(dt) {
        const m = this.m;
        const dts = (dt || 0.05) * (this.cfg.timeScale || 1);
        m.clock += dts;
        const E = m.engine, A = m.air, FU = m.fuel, GV = m.gov, BR = m.breaker, F = m.faults;

        // ── 0. 灯测试计时 ──
        if (m._lampT > 0) {
            m._lampT -= dts;
            if (m._lampT <= 0) { m._lampT = 0; m.lampTest = false; }
        }

        // ── 1. 起动空气系统（空压机自动补气）──
        if (!A.compOn || F.airComp) A.comp = false;
        else if (A.press <= 24) A.comp = true;
        else if (A.press >= A.max) A.comp = false;
        if (A.comp) A.press = Math.min(A.max, A.press + 1.6 * dts);

        // ── 2. 燃油系统（燃油泵 → 速闭阀 → 高压油泵）──
        const pumpRun = FU.pump && !F.fuelPump;
        FU.pumpRun = pumpRun;
        const supplyOk = pumpRun && !FU.quickClose && !F.fuelLow;
        FU.press = approach(FU.press, supplyOk ? FU.pressSet : 0, dts, 1.4);
        m.fuelMPa = FU.press / 10;
        m.fuelSupply = supplyOk;

        // 刺破阀 / 速闭阀 / 安保 → 停油
        m.fuelCut = FU.punctureAir || FU.quickClose || !supplyOk || m.trips.estop || m.blockHandle;

        // ── 3. 起动联锁条件 ──
        const conds = this.conditions();
        m.condList = conds;
        m.condOk = conds.every(c => c.ok);

        // ── 4. 起动时序 ──
        if (E.cranking) {
            m.seqT += dts;
            const t = m.seqT;
            A.press = Math.max(0, A.press - 0.7 * dts);           // 起动耗气

            m.exec.solenoid = t < 15;                             // 起动电磁阀（转速 > 200 断电）
            m.exec.mainValve = m.exec.solenoid && !F.pneu && A.press > 5;
            m.exec.distributor = m.exec.mainValve && !F.distributor;
            A.valve = m.exec.mainValve;

            const airOk = m.exec.distributor;
            if (t < 15) {
                E.speed = airOk ? this._profile(t) : approach(E.speed, 0, dts, 120);
            } else if (m.fuelCut) {
                E.speed = approach(E.speed, 0, dts, 240);
            } else {
                E.speed = Math.max(E.speed, this._profile(t));
            }
            m.exec.cyl = airOk && t < 15 ? Math.floor((m.clock * 6) % 8) : -1;

            if (t < 15 && !airOk && t > 4) {
                this._abortStart(F.pneu ? '起动失败：气动控制阀故障，主起动阀打不开'
                    : F.distributor ? '起动失败：空气分配器故障，起动空气不能依次进入各缸'
                        : '起动失败：起动空气压力不足');
            } else if (t > 12 && !m.fuelSupply) {
                this._abortStart('起动失败：燃油压力不足，不能发火');
            } else if (t > 20 && E.speed < 30) {
                this._abortStart('起动失败：曲轴转速上不去');
            } else if (t >= 48) {
                E.cranking = false;
                E.running = true;
                m.startCmd = null;
                m.exec.solenoid = false; m.exec.mainValve = false; m.exec.distributor = false;
                m.exec.cyl = -1;
                A.valve = false;
                this._tip('机组进入稳定运行（1800 r/min）');
            }
        } else {
            m.exec.solenoid = false;
            m.exec.mainValve = false;
            m.exec.distributor = false;
            m.exec.cyl = -1;
            A.valve = false;

            if (E.running) {
                if (m.fuelCut) {
                    E.running = false;
                    this._tip('燃油切断（刺破阀 / 速闭阀动作），机组停车');
                } else {
                    E.speed = approach(E.speed, GV.setpoint, dts, 90);
                    E.runtime += dts;
                }
            } else {
                E.speed = approach(E.speed, 0, dts, 420);
                m.seqT = 0;
                m.startCmd = null;
            }
        }

        // ── 5. 调速器与燃油量 ──
        const err = GV.setpoint - E.speed;
        GV.active = E.running;
        if (E.running) GV.rack = clamp(26 + err * 0.55 + E.load * 0.55, 8, 100);
        else if (E.cranking && E.speed > FIRE_SPEED) GV.rack = clamp(20 + err * 0.4, 8, 100);
        else GV.rack = 0;
        E.fuel = m.fuelCut ? 0 : GV.rack;

        // ── 6. 负荷（负荷测试塑壳断路器合上才带载）──
        const loadOn = m.loadTest.on && BR.closed && E.running && E.speed > 1500;
        m.gen.kw = loadOn ? m.loadTest.kw : 0;
        E.load = loadOn ? clamp(m.gen.kw / 250 * 100, 0, 100) : 0;

        // ── 7. 发电机 ──
        m.gen.volt = E.speed > 300 ? clamp(400 * E.speed / 1800, 0, 420) : 0;
        m.gen.freq = E.speed / 36;
        m.gen.amp = m.gen.kw > 0.1 ? (m.gen.kw * 1000) / (1.732 * 400 * 0.8) : 0;
        BR.ready = E.running && E.speed > 1700 && m.gen.volt > 380;
        if (!E.running && E.speed < 300) BR.closed = false;      // 停机自动分闸

        // ── 8. 超速保护（简易）──
        if (!m.trips.overspeed && E.speed > 1900) {
            m.trips.overspeed = true;
            E.running = false;
            this._tip('超速保护动作：燃油切断，机组停车');
        }
        if (m.trips.estop || m.trips.overspeed) { E.running = false; m.startCmd = null; }

        // ── 9. 时序状态（互斥）──
        m.seq = this._seqState();
        m.startFail = E.startFail;

        // ── 10. 趋势采样 ──
        this._sample(dts);
    }

    /** 起动转速曲线（按时间节点线性插值） */
    _profile(t) {
        const K = START_KNOTS;
        if (t <= K[0][0]) return K[0][1];
        for (let i = 1; i < K.length; i++) {
            if (t <= K[i][0]) {
                const [t0, v0] = K[i - 1], [t1, v1] = K[i];
                return v0 + (v1 - v0) * (t - t0) / (t1 - t0);
            }
        }
        return K[K.length - 1][1];
    }

    /** 起动失败（中止起动） */
    _abortStart(msg) {
        const m = this.m;
        m.engine.cranking = false;
        m.engine.startFail = true;
        m.startCmd = null;
        m.seqT = 0;
        m.exec.solenoid = false; m.exec.mainValve = false; m.exec.distributor = false; m.exec.cyl = -1;
        m.air.valve = false;
        this._tip(msg);
    }

    /** 起动时序状态（9 个灯互斥） */
    _seqState() {
        const m = this.m, E = m.engine;
        if (E.speed >= 1700) return 'STABLE';
        if (E.speed >= 600) return 'IDLE';
        if (E.speed >= 200) return 'FIRE';
        if (E.speed >= 120) return 'FUEL';
        if (E.speed >= 30) return 'CRANK';
        if (m.exec.solenoid && m.seqT > 0.8) return 'AIR';
        if (m.startCmd) return 'START';
        if (m.condOk) return 'READY';
        return 'STOP';
    }

    /** 趋势采样（0.5 s 一点，保留 3 min） */
    _sample(dts) {
        const h = this.m.hist;
        this._histAcc += dts;
        if (this._histAcc < 0.5) return;
        this._histAcc = 0;
        h.t.push(this.m.clock);
        h.fuel.push(this.m.engine.fuel);
        h.speed.push(this.m.engine.speed);
        const t0 = this.m.clock - TREND_WINDOW;
        while (h.t.length && h.t[0] < t0) { h.t.shift(); h.fuel.shift(); h.speed.shift(); }
    }

    // ═══════════════════════════════════════════════════════════
    //  状态查询
    // ═══════════════════════════════════════════════════════════

    /** 8 个起动联锁条件（含满足与否） */
    conditions() {
        const m = this.m;
        return [
            { key: 'turningGear', cn: START_CONDITIONS[0].cn, ok: !m.turningGear },
            { key: 'blockHandle', cn: START_CONDITIONS[1].cn, ok: !m.blockHandle },
            { key: 'safety', cn: START_CONDITIONS[2].cn, ok: m.safetyReset && !m.trips.estop && !m.trips.overspeed },
            { key: 'airPress', cn: START_CONDITIONS[3].cn, ok: m.air.press >= m.air.min },
            { key: 'fuelPress', cn: START_CONDITIONS[4].cn, ok: m.fuel.press >= m.fuel.minPress },
            { key: 'governor', cn: START_CONDITIONS[5].cn, ok: !m.gov.fault },
            { key: 'breaker', cn: START_CONDITIONS[6].cn, ok: !m.breaker.closed },
            { key: 'engineSpeed', cn: START_CONDITIONS[7].cn, ok: m.engine.speed < FIRE_SPEED },
        ];
    }

    /** 是否允许起动（8 个条件全部满足且未运行） */
    allowStart() {
        const m = this.m;
        return m.condOk && !m.engine.running && !m.engine.cranking;
    }

    /** Ready For Start 指示灯 */
    readyForStart() {
        const m = this.m;
        return this.allowStart() && m.engine.speed < 1;
    }

    seqText() {
        return SEQ_CN[this.m.seq] || this.m.seq;
    }

    // ═══════════════════════════════════════════════════════════
    //  操作接口
    // ═══════════════════════════════════════════════════════════

    /** 控制方式旋钮：BLOCK / LOCAL / REMOTE（到端点不循环） */
    setMode(mode) {
        if (!['BLOCK', 'LOCAL', 'REMOTE'].includes(mode)) return false;
        this.m.mode = mode;
        this._tip(`控制方式：${mode === 'BLOCK' ? '闭锁' : mode === 'LOCAL' ? '机旁' : '遥控'}（${mode}）`);
        return true;
    }

    cycleMode(dir) {
        const order = ['BLOCK', 'LOCAL', 'REMOTE'];
        const i = order.indexOf(this.m.mode);
        const n = clamp(i + (dir > 0 ? 1 : -1), 0, order.length - 1);
        if (n !== i) this.setMode(order[n]);
        return this.m.mode;
    }

    /** 盘车机构：啮合 / 脱开 */
    setTurningGear(on) {
        this.m.turningGear = !!on;
        this._tip(this.m.turningGear ? '盘车机构啮合：禁止起动主机' : '盘车机构已脱开：允许起动');
    }

    toggleTurningGear() { this.setTurningGear(!this.m.turningGear); }

    /** 停机手柄：压下（STOP）/ 工作位（WORK） */
    setBlockHandle(on) {
        this.m.blockHandle = !!on;
        this._tip(this.m.blockHandle ? '停机手柄压下（STOP）：燃油齿条被压到 0 位' : '停机手柄在工作位（WORK）');
    }

    toggleBlockHandle() { this.setBlockHandle(!this.m.blockHandle); }

    /** 起动：from = 'LOCAL' | 'REMOTE' */
    startEngine(from = 'LOCAL') {
        const m = this.m;
        if (m.mode === 'BLOCK') { m.engine.startFail = true; this._tip('控制方式在闭锁位（BLOCK），不能起动'); return false; }
        if (from === 'LOCAL' && m.mode !== 'LOCAL') { this._tip('控制方式不在机旁，机旁起动无效'); return false; }
        if (from === 'REMOTE' && m.mode !== 'REMOTE') { this._tip('控制方式不在遥控，遥控起动无效'); return false; }
        if (m.engine.running) { this._tip('机组已在运行'); return false; }
        if (m.engine.cranking) return false;
        if (m.trips.estop) { this._tip('紧急停车未复位，不能起动'); return false; }

        const bad = this.conditions().filter(c => !c.ok);
        if (bad.length) {
            m.engine.startFail = true;
            this._tip(`起动联锁未满足：${bad.map(b => b.cn).join('、')}`);
            return false;
        }
        m.startCmd = from;
        m.seqT = 0;
        m.engine.cranking = true;
        m.engine.startFail = false;
        this._tip(`起动指令（${from === 'LOCAL' ? '机旁' : '遥控'}）：起动电磁阀得电`);
        return true;
    }

    /** 停止（正常停车） */
    stopEngine() {
        const m = this.m;
        if (!m.engine.running && !m.engine.cranking) { this._tip('机组已停机'); return; }
        m.engine.running = false;
        m.engine.cranking = false;
        m.startCmd = null;
        m.seqT = 0;
        this._tip('正常停车：燃油齿条回 0，机组降速停车');
    }

    /** 紧急停车（直接断油） */
    emergencyStop() {
        const m = this.m;
        m.trips.estop = true;
        m.safetyReset = false;
        m.engine.running = false;
        m.engine.cranking = false;
        m.startCmd = null;
        m.seqT = 0;
        this._tip('紧急停车：燃油立即切断，机组停车');
    }

    /** 复位（保护 / 起动失败） */
    resetTrips() {
        const m = this.m;
        if (m.engine.running) { this._tip('机组运行中，不能复位'); return false; }
        m.trips = { overspeed: false, loPress: false, htTemp: false, estop: false };
        m.safetyReset = true;
        m.engine.startFail = false;
        this._tip('保护已复位，机组恢复备用');
        return true;
    }

    /** 灯测试 */
    lampTest() {
        this.m.lampTest = true;
        this.m._lampT = 3;
        this._tip('灯测试：全部指示灯点亮 3 s');
    }

    /** 负荷调节旋钮（机旁面板，0~100 %，仅用于显示负荷给定） */
    stepLoad(dir) {
        this.m.loadTest.kw = clamp(this.m.loadTest.kw + (dir > 0 ? 10 : -10), 10, 250);
        this._tip(`负荷测试负载：${this.m.loadTest.kw.toFixed(0)} kW`);
    }

    // ── 遥控操作模块 ──
    /** 调速旋钮：设定转速 ±50 r/min（1500~1900） */
    stepSetpoint(dir) {
        const g = this.m.gov;
        g.setpoint = clamp(g.setpoint + (dir > 0 ? 50 : -50), 1500, 1900);
        this._tip(`转速设定值：${g.setpoint.toFixed(0)} r/min`);
    }

    setSetpoint(v) {
        this.m.gov.setpoint = clamp(v, 1500, 1900);
    }

    /** 合闸（发电机主开关） */
    closeBreaker() {
        const m = this.m;
        if (m.breaker.closed) return true;
        if (!m.breaker.ready) { this._tip('机组未达到额定转速/电压，不能合闸'); return false; }
        m.breaker.closed = true;
        this._tip('发电机断路器合闸：机组并网带载');
        return true;
    }

    openBreaker() {
        const m = this.m;
        if (!m.breaker.closed) { this._tip('断路器已在分闸位'); return false; }
        m.breaker.closed = false;
        m.loadTest.on = false;
        this._tip('发电机断路器分闸：机组解列');
        return true;
    }

    /** 负荷测试开关（塑壳断路器）：推上加载 / 拉下卸载 */
    setLoadTest(on) {
        const m = this.m;
        if (on && !m.breaker.closed) { this._tip('请先合闸，再推上负荷测试开关'); return false; }
        m.loadTest.on = !!on;
        this._tip(m.loadTest.on ? `负荷测试投入：${m.loadTest.kw.toFixed(0)} kW` : '负荷测试切除：空载运行');
        return true;
    }

    toggleLoadTest() { return this.setLoadTest(!this.m.loadTest.on); }

    setLoadKw(v) {
        this.m.loadTest.kw = clamp(Number(v) || 0, 10, 250);
        this._tip(`负荷测试负载：${this.m.loadTest.kw.toFixed(0)} kW`);
    }

    // ── 燃油 / 调速系统 ──
    toggleFuelPump() {
        this.m.fuel.pump = !this.m.fuel.pump;
        this._tip(`燃油泵：${this.m.fuel.pump ? '运行' : '停止'}`);
    }

    toggleQuickClose() {
        const F = this.m.fuel;
        F.quickClose = !F.quickClose;
        this._tip(F.quickClose ? '燃油速闭阀关闭：燃油立即切断' : '燃油速闭阀打开：恢复供油');
    }

    togglePunctureAir() {
        const F = this.m.fuel;
        F.punctureAir = !F.punctureAir;
        this._tip(F.punctureAir ? '刺破阀通入控制空气：泄放高压油泵燃油，机组停油' : '刺破阀控制空气切除：恢复供油');
    }

    toggleGovFault() {
        this.m.gov.fault = !this.m.gov.fault;
        this.m.faults.gov = this.m.gov.fault;
        this._tip(this.m.gov.fault ? '电子调速器故障：油门拉杆失控（起动联锁不满足）' : '电子调速器恢复正常');
    }

    togglePneuFault() {
        this.m.faults.pneu = !this.m.faults.pneu;
        this._tip(this.m.faults.pneu ? '气动控制阀故障：主起动阀不能打开' : '气动控制阀恢复正常');
    }

    toggleDistributorFault() {
        this.m.faults.distributor = !this.m.faults.distributor;
        this._tip(this.m.faults.distributor ? '空气分配器故障：起动空气不能依次进入各缸' : '空气分配器恢复正常');
    }

    /** 故障设置（供故障界面 / 工作流使用） */
    setFault(key, on) {
        const F = this.m.faults;
        if (!(key in F)) { console.warn('[GensetStartSolver] 未知故障：', key); return; }
        F[key] = !!on;
        if (key === 'gov') this.m.gov.fault = !!on;
    }

    repairFault(key) { this.setFault(key, false); }

    /** 复位到冷态备用（保留故障设置） */
    resetAll() {
        const faults = { ...this.m.faults };
        const kw = this.m.loadTest.kw;
        this.m = createStartModel();
        this.m.faults = faults;
        this.m.gov.fault = !!faults.gov;
        this.m.loadTest.kw = kw;
        this._histAcc = 0;
    }

    /** 一键起动：满足联锁 → 起动 → 稳定运行 */
    quickStart() {
        const m = this.m;
        m.mode = 'LOCAL';
        m.turningGear = false;
        m.blockHandle = false;
        m.safetyReset = true;
        m.trips = { overspeed: false, loPress: false, htTemp: false, estop: false };
        m.breaker.closed = false;
        m.loadTest.on = false;
        m.air.press = m.air.max;
        m.fuel.pump = true; m.fuel.quickClose = false; m.fuel.punctureAir = false;
        m.fuel.press = m.fuel.pressSet;
        m.gov.fault = false;
        m.faults.pneu = false; m.faults.distributor = false;
        m.engine.startFail = false;
        m.engine.cranking = false;
        m.engine.running = true;
        m.engine.speed = m.gov.setpoint;
        m.engine.load = 0;
        m.engine.fuel = 26;
        m.seqT = 0;
        m.startCmd = null;
        m.seq = 'STABLE';
        m.exec.solenoid = false; m.exec.mainValve = false; m.exec.distributor = false; m.exec.cyl = -1;
        m.air.valve = false;
        m.gen.volt = 400; m.gen.freq = 50; m.gen.kw = 0; m.gen.amp = 0;
        m.breaker.ready = true;
        m.condOk = true;
    }

    /** 工具栏「5 点步进」：复位 → 起动 → 稳定运行 → 合闸 → 带负荷 */
    fiveStep(i) {
        const m = this.m;
        switch (i) {
            case 0:
                this.resetAll();
                m.mode = 'LOCAL';
                m.turningGear = false;
                m.blockHandle = false;
                m.safetyReset = true;
                break;
            case 1:
                this.startEngine('LOCAL');
                break;
            case 2:
                this.quickStart();
                break;
            case 3:
                this.closeBreaker();
                break;
            default:
                this.setLoadTest(true);
                break;
        }
    }
}

export default GensetStartSolver;
