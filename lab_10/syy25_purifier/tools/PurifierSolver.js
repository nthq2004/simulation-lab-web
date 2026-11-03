/**
 * PurifierSolver — S 型分油机（Alfa Laval S 936 级）与 EPC-60 控制器仿真模型
 *
 * 设计要点：
 *  · 过程量（转速、温度、液位、排渣倒计时）按 m.timeScale 运行（默认 1× 实时）；
 *  · 排渣 / 停机程序的阀门动作保持真实秒级节奏，便于学员观察；
 *  · 状态机：STANDSTILL → STARTING → START_SEQ → STANDBY → SEPARATION
 *            → DISCHARGE → SEPARATION；STOPPING → STANDSTILL；
 *  · 报警、联锁、故障注入均在本模型内完成，组件只读取 m 并调用公开方法。
 */

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const expApproach = (cur, target, tau, dt) => cur + (target - cur) * (1 - Math.exp(-dt / Math.max(0.001, tau)));

const RATED_SPEED = 10680;
const MIN_SPEED = 60;
const START_TAU = 8;           // 模拟秒（约 25 s 升到额定转速）
const STOP_TAU = 6;            // 模拟秒（约 30 s 停转）
const TEMP_TAU = 5.5;          // 模拟秒（约 20 s 升到设定温度）
const COOL_TAU = 90;           // 模拟秒（停止加热后自然降温）

export const PURIFIER_RATED_SPEED = RATED_SPEED;

function createModel() {
    return {
        clock: 0,
        epcPower: false,
        mainPower: false,
        local: true,
        ctrlMode: 'HAND',
        mode: 'AUTO',                 // MAN / AUTO / CIP
        emergency: false,

        state: 'STANDSTILL',
        stateTime: 0,
        seq: { name: '', step: 0, t: 0, attempts: 0, feedback: false, resume: '', emergency: false },

        bowl: {
            speed: 0,
            closed: false,
            waterSeal: false,
            discRot: 0,
            discharge: 0,
            leak: 0,
            vibration: 1.0,
            opWater: 0, sealWater: false, fill: 0, sealForm: 0, sealedOnce: false,
        },
        motor: { on: false, current: 0, power: 0, trip: false },
        feed: {
            pumpOn: false, valveOpen: false, sv4: false, recirc: false, steamValveOpen: false, progOn: false,
            // 所有手动截止阀默认关闭，由操作人员手动开启
            dirtyValveOpen: false, returnValveOpen: false, v1Return: true, checkOpen: false, returnFlow: 0, checkFlow: 0,
            flow: 0, pressure: 0,
            temp: 40, heaterOn: false, heaterPower: 0, tempSet: 98,
        },
        oil: {
            dirty: 80, clean: 20, outletPressure: 0, outletTemp: 40, outletValveOpen: false,
            waterContent: 4, waterInOil: 0.2, backpressure: 0, mtOn: false,
        },
        water: {
            mainOpen: false, supply: 0,
            airMainOpen: false, air: 0,
            sv10: false, sv15: false, sv16: false, drain: false,
            outletPressure: 0,
        },
        sludge: { tank: 12, count: 0, lastTime: 0, nextIn: 900, feedback: false, pumpOn: false },
        tempCtrl: { mode: 'AUTO', setpoint: 98, output: 0, valve: 0 },
        cip: false,
        debugMode: false,

        params: {
            dischargeInterval: 5,     // min（教学默认，可调 2~240）
            minInterval: 10,          // min
            sepTemp: 98,              // °C
            tempLowAlarm: 90,         // °C 进油温度低报警/停止进油
            flow: 1.5,                // m³/h
            sealTime: 6,              // s（水封）
            displacementTime: 8,      // s（置换水）
            drainTime: 20,            // s（排水阀）
            waterTrigger: 15,         // pF
            // 工作时序定时器（秒）
            Ti50: 60, Ti51: 15, Ti52: 25, Ti53: 20, Ti55: 0,
            Ti56: 3, Ti57: 6, Ti58: 5, Ti59: 20, Ti60: 5, Ti61: 5, Ti62: 8, Ti63: 9,
            Ti64: 8, Ti65: 5, Ti66: 12, Ti67: 10,
            Ti70: 10, Ti71: 12, Ti72: 15, Ti73: 5, Ti81: 5, Ti82: 10, Ti83: 5,
            Ti85: 12, Ti86: 15, Ti87: 8, Ti89: 10,
            timeScale: 1,             // 仿真时间倍率（1×=实时）
            vibrationWarn: 4.5,
            vibrationTrip: 7.1,
        },

        alarms: [],
        alarmLog: [],        // 报警记录（含已复位，最新在前）
        alarmActive: false,
        alarmAck: false,

        prog: false, phase: 0, step: 0, timerName: '', timerT: 0,
        stepByStep: false, paused: false, autoStopReq: false, stepDone: false, pendingPhase: 0,
        faults: {
            vibration: false,
            leak: false,
            dischargeFail: false,
            tempLow: false,
            opWaterLow: false,
            transducer: false,
            motorOverload: false,
            sludgeHigh: false,
            airLow: false,
        },

        counters: { runTime: 0, dischargeCount: 0, startCount: 0 },

        display: { rpm: 0, tt1: 40, pt1: 0, pt4: 0, pt5: 0, mt: 4, flow: 0, runTime: 0, next: 0 },

        timeScale: 1,
        _pulse16: 0,
        compWater: false,        // Ti68 期间：正在进补偿水（SV16 通电 3 s）
        drainWater: false,       // Ti68 期间：正在排水（V5 开启）
        waterDrainMode: false,   // V5 排水过程进行中（水分降到 6 pF 后关闭）
        stopManual: false,       // 机旁「分离停止」发起：阶段 5 结束即停程序
        _cwAcc: 0,               // 补偿水累计时间（每 120 s 一次）
        _cwPulse: 0,             // 补偿水剩余通电时间
        _pulse4000: false,
        _stopPulse: false,
        _sinceDischarge: 0,
        _lowTempTimer: 0,
        _leakTimer: 0,
        _drainCount: 0,
    };
}

export class PurifierSolver {
    constructor(sys) {
        this.sys = sys;
        this.m = createModel();
    }

    // ═══════════════════════════════════════════════════════════
    //  基础操作
    // ═══════════════════════════════════════════════════════════

    _resetModel() {
        this.m = createModel();
        return this.m;
    }

    resetAll() {
        this._resetModel();
    }

    /**
     * 主电源统一控制：机旁主电源开关与 EPC-60 面板电源旋钮**同步动作**，
     * 操作任一处即可同时给机旁主回路与 EPC-60 面板上电/断电，不必操作两次。
     * @param {boolean} on 目标状态
     * @param {'main'|'epc'} source 操作源（只影响断电时报哪个报警）
     */
    setPower(on, source = 'main') {
        const m = this.m;
        on = !!on;
        if (m.mainPower === on && m.epcPower === on) return;
        m.mainPower = on;
        m.epcPower = on;                 // ← 两处电源开关保持一致
        if (!on) {
            m.mode = 'MAN';
            m.motor.on = false;
            m.motor.current = 0;
            m.feed.pumpOn = false;
            m.feed.heaterOn = false;
            m.water.sv10 = m.water.sv15 = m.water.sv16 = m.water.drain = false;
            if (m.state !== 'STANDSTILL') {
                if (source === 'epc') this._raise('A13', 'POWER FAILURE');
                else this._raise('A12', 'SEPARATOR MOTOR - FAILURE');
                this._tripStop('main-power');
            }
        } else {
            this._clear('A12');
            this._clear('A13');
            if (m.ctrlMode === 'AUTO' && !m.prog) {
                // AUTO 位合上主电源 → 自动运行分离程序（从阶段一 Ti50 开始）
                m.stepByStep = false;
                this._startProgram(1);
            }
        }
    }

    setEpcPower(on) { this.setPower(on, 'epc'); }

    toggleEpcPower() { this.setPower(!this.m.mainPower, 'epc'); }

    setMainPower(on) { this.setPower(on, 'main'); }

    toggleMainPower() { this.setPower(!this.m.mainPower, 'main'); }

    /**
     * 排渣泵（EPC-60 面板 CIP 左侧泵图标键）：
     * 起动后排渣柜液位逐渐下降，低于 5% 时自动停泵。
     */
    setSludgePump(on) {
        const m = this.m;
        on = !!on;
        if (on) {
            if (m.sludge.tank <= 5) { this._tip('排渣柜液位已低于 5%，排渣泵无需起动'); return false; }
            m.sludge.pumpOn = true;
        } else {
            m.sludge.pumpOn = false;
        }
        return true;
    }

    toggleSludgePump() { return this.setSludgePump(!this.m.sludge.pumpOn); }

    /** 控制模式：HAND（机旁手动）/ EPC（EPC-60 远程）/ AUTO（全自动） */
    setCtrlMode(mode) {
        if (!['HAND', 'EPC', 'AUTO'].includes(mode)) return false;
        const m = this.m;
        m.ctrlMode = mode;
        m.local = (mode === 'HAND');
        if (mode === 'AUTO') {
            m.mode = 'AUTO';
            // AUTO + 主电源已合上 → 自动运行分离程序（从阶段一 Ti50 开始）
            if (m.mainPower && !m.prog) {
                m.stepByStep = false;
                this._startProgram(1);
            }
        }
        return true;
    }

    /** dir > 0 顺时针（向右换档），dir < 0 逆时针（向左换档）；到端点不循环 */
    cycleCtrlMode(dir = 1) {
        const order = ['HAND', 'EPC', 'AUTO'];
        const n = order.length;
        const i = order.indexOf(this.m.ctrlMode);
        const next = Math.min(n - 1, Math.max(0, i + (dir > 0 ? 1 : -1)));
        if (next !== i) this.setCtrlMode(order[next]);
        return this.m.ctrlMode;
    }

    setLocal(on) { this.setCtrlMode(on ? 'HAND' : 'EPC'); }

    /** 调试模式接口：后续调试界面调用后，模拟图阀门/电机/截止阀可控 */
    setDebugMode(on) { this.m.debugMode = !!on; return this.m.debugMode; }
    toggleLocal() { return this.setLocal(!this.m.local) && this.m.local; }

    setMode(mode) {
        if (!['MAN', 'AUTO', 'CIP'].includes(mode)) return false;
        this.m.mode = mode;
        if (mode === 'CIP') {
            // CIP 时禁止进油
            this.m.feed.valveOpen = false;
            this.m.feed.pumpOn = false;
            this.m.feed.heaterOn = false;
        }
        return true;
    }

    cycleMode() {
        const order = ['MAN', 'AUTO', 'CIP'];
        const i = order.indexOf(this.m.mode);
        this.setMode(order[(i + 1) % order.length]);
        return this.m.mode;
    }

    setWaterMain(on) {
        this.m.water.mainOpen = !!on;
        if (!on) {
            this.m.water.sv10 = this.m.water.sv15 = this.m.water.sv16 = false;
        }
    }

    toggleWaterMain() {
        this.setWaterMain(!this.m.water.mainOpen);
        return this.m.water.mainOpen;
    }

    setAirMain(on) { this.m.water.airMainOpen = !!on; }
    toggleAirMain() { this.setAirMain(!this.m.water.airMainOpen); return this.m.water.airMainOpen; }

    setFeedPump(on) {
        const m = this.m;
        m.feed.pumpOn = !!on;
        if (!on) m.feed.heaterOn = false;   // 供油泵停止 → 加热器立即关闭
    }

    toggleFeedPump() {
        this.setFeedPump(!this.m.feed.pumpOn);
        return this.m.feed.pumpOn;
    }

    setHeater(on) {
        this.m.feed.heaterOn = !!on;
    }

    toggleHeater() {
        this.setHeater(!this.m.feed.heaterOn);
        return this.m.feed.heaterOn;
    }

    setParam(key, value) {
        const p = this.m.params;
        if (!(key in p) && key !== 'timeScale') return false;
        const n = Number(value);
        if (!Number.isFinite(n)) return false;
        if (key === 'timeScale') {
            this.m.timeScale = clamp(n, 1, 20);
            p.timeScale = this.m.timeScale;
            return true;
        }
        const limits = {
            dischargeInterval: [2, 240],
            minInterval: [1, 240],
            sepTemp: [40, 110],
            tempLowAlarm: [60, 105],
            flow: [0.2, 5],
            sealTime: [1, 120],
            displacementTime: [1, 120],
            drainTime: [5, 300],
            waterTrigger: [5, 40],
            vibrationWarn: [1, 20],
            vibrationTrip: [2, 30],
            timeScale: [1, 20],
        };
        const [lo, hi] = limits[key] || [-1e9, 1e9];
        p[key] = clamp(n, lo, hi);
        if (key === 'sepTemp') this.m.feed.tempSet = p[key];
        return true;
    }

    getParam(key) { return key === 'timeScale' ? this.m.timeScale : this.m.params[key]; }

    // ═══════════════════════════════════════════════════════════
    //  阀门（手动模式）
    // ═══════════════════════════════════════════════════════════

    setValve(id, on) {
        const m = this.m;
        if (!m.mainPower) return false;
        if (!m.debugMode && m.mode !== 'MAN' && !m.local) {
            this._tip('EPC 控制方式下阀门由 EPC-60 控制；请把转换开关打到 HAND 或启用调试模式');
            return false;
        }
        on = !!on;
        switch (id) {
            case 'v1':
                if (on && (!m.bowl.closed || !m.bowl.waterSeal)) {
                    this._tip('分离筒未关闭/未建立水封，禁止进油');
                    return false;
                }
                m.feed.valveOpen = on;
                return true;
            case 'v5':
                m.water.drain = on;
                return true;
            case 'sv4':
                m.feed.sv4 = on;
                m.feed.recirc = on;
                return true;
            case 'sv10':
                m.water.sv10 = on;
                if (on && m.bowl.closed) m.bowl.waterSeal = true;
                return true;
            case 'sv15':
                m.water.sv15 = on;
                if (on) {
                    if (m.water.supply < 2) { this._tip('工作水压力低，开启水不足'); return false; }
                    m.bowl.closed = false;
                    m.bowl.waterSeal = false;
                    m.bowl.discharge = 1.2;
                    m.sludge.feedback = true;
                }
                return true;
            case 'sv16':
                m.water.sv16 = on;
                if (on) m.bowl.closed = true;
                return true;
            default:
                return false;
        }
    }

    toggleValve(id) {
        const map = { v1: 'feed', sv4: 'feed', v5: 'water', sv10: 'water', sv15: 'water', sv16: 'water' };
        const group = map[id];
        if (!group) return false;
        const cur = id === 'v1' ? this.m.feed.valveOpen
            : id === 'sv4' ? this.m.feed.sv4
                : id === 'v5' ? this.m.water.drain
                    : this.m.water[id];
        const ok = this.setValve(id, !cur);
        if (!ok && this.m.mode !== 'MAN') return cur;
        return id === 'v1' ? this.m.feed.valveOpen
            : id === 'sv4' ? this.m.feed.sv4
                : (id === 'v5' ? this.m.water.drain : this.m.water[id]);
    }

    toggleSteamValve() {
        this.m.feed.steamValveOpen = !this.m.feed.steamValveOpen;
        return this.m.feed.steamValveOpen;
    }

    setManualValve(id, on) {
        if (id === 'dirty-outlet') this.m.feed.dirtyValveOpen = !!on;
        else if (id === 'return') this.m.feed.returnValveOpen = !!on;
        else return false;
        return true;
    }

    _tip(msg) {
        if (this.sys && typeof this.sys._tipPurifier === 'function') {
            this.sys._tipPurifier(msg);
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  起动 / 停止 / 排渣
    // ═══════════════════════════════════════════════════════════

    _canStart() {
        const m = this.m;
        if (m.emergency) { this._raise('A14', 'EMERGENCY STOP - BUTTON PUSHED'); return false; }
        if (!m.mainPower) { this._tip('请先合上机旁主电源'); return false; }
        if (!m.epcPower) { this._tip('请先给 EPC-60 上电'); return false; }
        if (m.motor.trip) { this._tip('电机故障未复位'); return false; }
        if (m.water.supply < 2) { this._raise('A08', 'OPERATING WATER PRESSURE - LOW'); return false; }
        if (m.water.air < 5) { this._raise('A09', 'CONTROL AIR PRESSURE - LOW'); return false; }
        if (m.state !== 'STANDSTILL') { this._tip('分油机已在运行或程序中'); return false; }
        return true;
    }

    start(fromLocal = false) {
        const m = this.m;
        if (fromLocal) {
            // 机旁「电机起动」：只起电机，分离程序由「分离起动 I」触发
            if (!m.mainPower) { this._tip('请先合上机旁主电源'); return false; }
            if (m.emergency) return false;
            if (m.motor.on || m.bowl.speed > MIN_SPEED) { this._tip('分油机电机已在运行'); return false; }
            m.motor.on = true;
            m.motor.trip = false;
            m.state = 'STARTING';
            m._pulse16 = 0;
            m._pulse4000 = false;
            m._stopPulse = false;
            m.counters.startCount++;
            return true;
        }
        if (m.local) { this._tip('机旁（HAND）控制优先，请把转换开关打到 EPC 再遥控起动'); return false; }
        if (!this._canStart()) return false;
        if (m.emergency) return false;
        m.counters.startCount++;
        m._pulse16 = 0;
        m._pulse4000 = false;
        m._stopPulse = false;
        this._startProgram(1);          // 自动起动阶段
        return true;
    }

    pressSeparation() {
        if (this.m.state === 'SEPARATION' || this.m.state === 'STANDBY') {
            this._tip('分油机已在运行，请按 STOP 停机');
            return false;
        }
        return this.start(false);
    }

    localStart() {
        const m = this.m;
        if (!m.local) { this._tip('当前为 EPC/AUTO 方式，机旁不能起动；请把转换开关打到 HAND'); return false; }
        return this.start(true);
    }

    // ── 机旁面板按钮（仅 HAND 方式有效）──────────────────────────
    _handOnly(what) {
        const m = this.m;
        if (m.local) return true;
        this._tip(`${m.ctrlMode === 'AUTO' ? 'AUTO 全自动' : 'EPC 远程'}方式下由控制器控制${what}，机旁按钮无效；请把控制模式打到 HAND`);
        return false;
    }

    localPump(on) {
        if (!this._handOnly('供油泵')) return false;
        const m = this.m;
        if (on && !m.mainPower) { this._tip('请先在机旁合上主电源，再起动供油泵'); return false; }
        this.setFeedPump(on);
        if (on && (!m.feed.dirtyValveOpen || !m.feed.returnValveOpen)) {
            this._tip('供油泵已运行，但沉淀柜出口阀或回流阀未打开，油路不通、无流量');
        }
        return true;
    }

    localHeater(on) {
        if (!this._handOnly('加热器')) return false;
        const m = this.m;
        if (on && !m.feed.pumpOn) {
            this._tip('加热器与供油泵联锁：请先起动供油泵');
            return false;
        }
        m.feed.heaterOn = !!on;
        if (on && !m.feed.steamValveOpen) {
            this._tip('提示：蒸汽截止阀未打开，加热器投入后不会升温');
        }
        return true;
    }

    localMotorStart() {
        if (!this._handOnly('分油机电机')) return false;
        if (!this.m.mainPower) { this._tip('请先在机旁合上主电源，再起动机电'); return false; }
        return this.start(true);
    }

    localMotorStop() {
        if (!this._handOnly('分油机电机')) return false;
        if (!this.m.motor.on && this.m.state === 'STANDSTILL') return false;
        this._startProgram(6);          // 自动停机阶段
        return true;
    }

    /** 分离程序起动（I）：手动方式下按此按钮才开始分离程序 */
    localProgramStart() {
        const m = this.m, P = m.params;
        if (!this._handOnly('分离程序')) return false;
        if (!m.mainPower) { this._tip('请先在机旁合上主电源'); return false; }
        if (m.state === 'SEPARATION' || m.state === 'START_SEQ') { this._tip('分离程序已在运行'); return false; }
        // 手动（HAND）起动前置条件：PT1 进油压力、TT1 油温、分油机转速 三者必须全部达标
        const bad = [];
        if (!m.motor.on || m.bowl.speed < RATED_SPEED * 0.9) {
            bad.push(`分油机转速不足（${Math.round(m.bowl.speed)} r/min，需 ≥ ${Math.round(RATED_SPEED * 0.9)}，请按「分油机电机起动」）`);
        }
        if (m.feed.pressure < 0.1) {
            bad.push(`PT1 进油压力不足（${m.feed.pressure.toFixed(3)} MPa，需 ≥ 0.100，请起动供油泵并打开出口阀）`);
        }
        if (m.feed.temp < P.sepTemp - 2) {
            bad.push(`TT1 油温不足（${m.feed.temp.toFixed(1)} ℃，需 ≥ ${Math.round(P.sepTemp - 2)}，请投入加热器并打开蒸汽阀）`);
        }
        if (bad.length) {
            this._tip('不能起动分离程序：' + bad.join('；'));
            return false;
        }
        m.feed.heaterOn = true;
        m.feed.v1Return = true;
        this._startProgram(2);          // 起动阶段：复位 → 校验 → 排渣 → 水封
        return true;
    }

    /**
     * 分离程序停止（机旁「分离停止」）：
     *  - Ti68 正常分油计时期间按下 → 立即进入阶段 5（Ti81 密封）；
     *  - 排渣阶段按下 → 先走完排渣程序到 Ti75 结束，再自动进入阶段 5（Ti81）。
     */
    localProgramStop() {
        const m = this.m;
        if (!this._handOnly('分离程序')) return false;
        if (!['START_SEQ', 'SEPARATION', 'DISCHARGE', 'STANDBY'].includes(m.state)) return false;
        if (!m.prog) return false;
        m.autoStopReq = true;
        m.stopManual = true;                     // 机旁「分离停止」：阶段 5 走完即结束，不再进阶段 6
        if (m.phase === 4) return true;         // 排渣中：走到 Ti75 后自动进入阶段 5
        m.pendingPhase = 0;
        m.stepDone = false;
        this._enterPhaseNow(5);                 // 阶段 5 第 1 步即 Ti81 密封
        if (m.stepByStep) m.paused = true;      // 单步演示：停在 Ti81 等「下一步」
        return true;
    }

    /** 下一步（单步模式） */
    nextStep() {
        const m = this.m;
        if (!m.prog) { this._tip('程序未运行'); return false; }
        // 正常分油（Ti68）中按「下一步」→ 直接进入排渣阶段（Ti70）
        if (m.phase === 3 && m.step === 4) {
            m.pendingPhase = 0;
            m.stepDone = false;
            this._enterPhaseNow(4);
            if (m.stepByStep) m.paused = true;   // 单步模式：停在 Ti70 等下一次「下一步」
            return true;
        }
        if (m.stepDone) {
            m.stepDone = false;
            if (m.pendingPhase) { const n = m.pendingPhase; m.pendingPhase = 0; this._enterPhaseNow(n); }
            else { m.step += 1; m.timerT = 0; m.timerName = ''; }
            m.paused = false;
            return true;
        }
        if (m.paused) { m.paused = false; return true; }
        return false;
    }

    /** 自动停止：分离中立即转停机阶段；排渣中则走到 Ti75 后停机 */
    requestAutoStop() {
        const m = this.m;
        if (!m.prog) { this._tip('程序未运行'); return false; }
        m.autoStopReq = true;
        if (m.phase === 4) { m.paused = false; return true; }   // 排渣中：等 Ti75 结束后再停机
        // 其余阶段（含 Ti68 分油计时期间）立即进入停机阶段 Ti81
        m.pendingPhase = 0;
        m.stepDone = false;
        this._enterPhaseNow(5);
        if (m.stepByStep) m.paused = true;                      // 单步模式：停在 Ti81 等「下一步」
        return true;
    }

    pressStop() {
        const m = this.m;
        if (m.state === 'STANDSTILL' && !m.prog) return false;
        if (m.emergency) return false;
        m._stopPulse = false;
        // EPC 远程停止：正常分油（Ti68）期间按下 → 先判「自动停止请求」并进入阶段四，
        // 走完排渣程序（Ti70~Ti75）后依次进入阶段五（Ti81~Ti83）、阶段六（Ti85~Ti89），
        // 不允许越过阶段四直接跳到阶段五
        if (m.prog && m.phase === 3 && m.step === 4) {
            m.autoStopReq = true;
            m.stopManual = false;
            m.pendingPhase = 0;
            m.stepDone = false;
            this._enterPhaseNow(4);
            if (m.stepByStep) m.paused = true;   // 单步演示：停在 Ti70 等「下一步」
            return true;
        }
        this._startProgram(5);         // 其余状态：直接进入停机阶段（远程再进入自动停机阶段）
        return true;
    }

    emergencyStop() {
        const m = this.m;
        m.emergency = true;
        m.motor.on = false;
        m.feed.pumpOn = false;
        m.feed.heaterOn = false;
        m.feed.valveOpen = false;
        m.water.sv10 = m.water.sv15 = m.water.sv16 = m.water.drain = false;
        m.state = 'STOPPING';
        m.seq = { name: 'stop', step: 10, t: 0, attempts: 0, feedback: false, resume: '', emergency: true };
        this._raise('A14', 'EMERGENCY STOP - BUTTON PUSHED');
    }

    resetEmergency() {
        const m = this.m;
        if (!m.emergency) return true;
        if (m.bowl.speed > MIN_SPEED) {
            this._tip('分离筒尚未完全静止，不能复位应急停止');
            return false;
        }
        m.emergency = false;
        m.state = 'STANDSTILL';
        this._clear('A14');
        return true;
    }

    pressDischarge() {
        const m = this.m;
        if (m.state !== 'SEPARATION' && m.state !== 'STANDBY') {
            this._tip('仅在分油/待命状态可手动排渣');
            return false;
        }
        if (m.bowl.speed < RATED_SPEED * 0.6) return false;
        if (m.sludge.tank > 90) { this._raise('A10', 'SLUDGE TANK LEVEL - HIGH'); return false; }
        this._startProgram(4);          // 排渣阶段
        return true;
    }

    _startDischarge(reason, resume) {
        const m = this.m;
        const prev = resume || (m.state === 'STANDBY' ? 'STANDBY' : 'SEPARATION');
        m.state = 'DISCHARGE';
        m.seq = { name: 'discharge', step: 0, t: 0, attempts: 0, feedback: false, resume: prev, reason };
        m.feed.valveOpen = false;
        m.oil.outletValveOpen = false;
        m.feed.v1Return = true;
        m.feed.progOn = false;
        m.sludge.feedback = false;
    }

    _tripStop(reason) {
        const m = this.m;
        if (m.state === 'STOPPING') return;
        m.prog = false; m.phase = 0; m.step = 0; m.timerName = ''; m.timerT = 0; m.feed.progOn = false;
        // 清除 Ti68 期间的补偿水 / 排水状态
        m.compWater = false; m.drainWater = false; m.waterDrainMode = false;
        m._cwPulse = 0; m._cwAcc = 0;
        // 故障停机：V1 立即切到回油口；只要泵还有动力，就保持运行并建立回油
        const keepPump = !['main-power', 'epc-power', 'emergency'].includes(reason);
        m.feed.valveOpen = false;
        m.oil.outletValveOpen = false;
        m.feed.v1Return = true;
        if (keepPump) {
            m.feed.returnValveOpen = true;
            // 泵若原本在运行则保持；不要主动停泵
            m.feed.pumpOn = !!m.feed.pumpOn;
        } else {
            m.feed.pumpOn = false;
        }
        m.feed.heaterOn = false;
        m.state = 'STOPPING';
        m._stopPulse = false;
        m.seq = { name: 'stop', step: 10, t: 0, attempts: 0, feedback: false, resume: '', emergency: true, keepPump, reason };
    }

    // ═══════════════════════════════════════════════════════════
    //  报警
    // ═══════════════════════════════════════════════════════════

    _raise(code, text) {
        const m = this.m;
        if (m.alarms.some(a => a.code === code && a.active)) return;
        const rec = { code, text, time: m.clock, ack: false, active: true };
        m.alarms.unshift(rec);
        if (m.alarms.length > 40) m.alarms.length = 40;
        // 报警记录：同一对象同时放入历史表，最新在前，复位后仍保留
        if (!m.alarmLog) m.alarmLog = [];
        m.alarmLog.unshift(rec);
        if (m.alarmLog.length > 50) m.alarmLog.length = 50;
        m.alarmActive = true;
        m.alarmAck = false;
    }

    _clear(code) {
        const m = this.m;
        m.alarms.forEach(a => { if (a.code === code) a.active = false; });
        if (!m.alarms.some(a => a.active)) m.alarmActive = false;
    }

    pressAlarmReset() {
        const m = this.m;
        const active = m.alarms.filter(a => a.active);
        if (active.some(a => !a.ack)) {
            active.forEach(a => { a.ack = true; });
            m.alarmAck = true;
            return 'ack';
        }
        // 第二次：清除已消失的报警；仍存在的故障会重新触发
        m.alarms = m.alarms.filter(a => a.active);
        if (m.alarms.length === 0) {
            m.alarmActive = false;
            m.alarmAck = true;
        }
        return 'reset';
    }

    // ═══════════════════════════════════════════════════════════
    //  故障注入 / 修复
    // ═══════════════════════════════════════════════════════════

    setFault(key, on) {
        const m = this.m;
        if (!(key in m.faults)) return false;
        m.faults[key] = !!on;
        if (on) {
            switch (key) {
                case 'vibration':
                    m.bowl.vibration = 8.2;
                    this._raise('A01', 'HIGH VIBRATION - SHUTDOWN');
                    if (m.state !== 'STANDSTILL') this._tripStop('vibration');
                    break;
                case 'leak':
                    this._raise('A03', 'OIL LEAKING FROM BOWL');
                    m.feed.valveOpen = false;
                    m.bowl.leak = 1;
                    if (m.state !== 'STANDSTILL') this._tripStop('leak');
                    break;
                case 'dischargeFail':
                    // 下一次排渣时无反馈，由程序判定
                    break;
                case 'tempLow':
                    m.feed.heaterOn = false;
                    this._raise('A05', 'OIL FEED TEMPERATURE - LOW');
                    break;
                case 'opWaterLow':
                    this._raise('A08', 'OPERATING WATER PRESSURE - LOW');
                    break;
                case 'transducer':
                    this._raise('A11', 'TRANSDUCER - NO RESPONSE');
                    break;
                case 'motorOverload':
                    m.motor.trip = true;
                    m.motor.on = false;
                    this._raise('A12', 'SEPARATOR MOTOR - FAILURE');
                    if (m.state !== 'STANDSTILL') this._tripStop('motor');
                    break;
                case 'sludgeHigh':
                    m.sludge.tank = 96;
                    this._raise('A10', 'SLUDGE TANK LEVEL - HIGH');
                    break;
                case 'airLow':
                    this._raise('A09', 'CONTROL AIR PRESSURE - LOW');
                    break;
                default: break;
            }
        }
        return true;
    }

    repairFault(key) {
        const m = this.m;
        if (!(key in m.faults)) return false;
        m.faults[key] = false;
        switch (key) {
            case 'vibration':
                m.bowl.vibration = 1.0;
                this._clear('A01'); this._clear('A02');
                break;
            case 'leak':
                m.bowl.leak = 0;
                this._clear('A03');
                break;
            case 'dischargeFail':
                this._clear('A04');
                break;
            case 'tempLow':
                m.feed.heaterOn = true;
                this._clear('A05');
                break;
            case 'opWaterLow':
                this._clear('A08');
                break;
            case 'transducer':
                this._clear('A11');
                break;
            case 'motorOverload':
                m.motor.trip = false;
                this._clear('A12');
                break;
            case 'sludgeHigh':
                m.sludge.tank = 25;
                this._clear('A10');
                break;
            case 'airLow':
                this._clear('A09');
                break;
            default: break;
        }
        if (!m.alarms.some(a => a.active)) m.alarmActive = false;
        return true;
    }

    // ═══════════════════════════════════════════════════════════
    //  教学快捷
    // ═══════════════════════════════════════════════════════════

    quickStart() {
        this.resetAll();
        const m = this.m;
        m.epcPower = true;
        m.mainPower = true;
        m.ctrlMode = 'AUTO';
        m.local = false;
        m.mode = 'AUTO';
        m.water.mainOpen = true;
        m.water.airMainOpen = true;
        m.feed.dirtyValveOpen = true;
        m.feed.returnValveOpen = true;
        m.feed.steamValveOpen = true;
        m.water.supply = 5.5;
        m.water.air = 6.0;
        m.stepByStep = true;      // 单步演示：每完成一步冻结，等「下一步」
        this._startProgram(1);    // 从 Ti50 自动起动开始
        return true;
    }

    fiveStep(idx) {
        const m0 = this.m;
        idx = ((idx % 5) + 5) % 5;
        if (idx === 0) {
            this.resetAll();
            return '停止';
        }
        if (idx === 1) {
            this.resetAll();
            const m = this.m;
            m.epcPower = true; m.mainPower = true; m.water.mainOpen = true; m.water.airMainOpen = true;
            m.feed.dirtyValveOpen = true; m.feed.returnValveOpen = true; m.feed.steamValveOpen = true;
            m.water.supply = 5.5; m.water.air = 6.0;
            m.motor.on = true; m.state = 'STARTING'; m.bowl.speed = RATED_SPEED * 0.45;
            return '起动升速';
        }
        if (idx === 2) {
            m0.epcPower = true; m0.mainPower = true; m0.water.mainOpen = true; m0.water.airMainOpen = true;
            m0.feed.dirtyValveOpen = true; m0.feed.returnValveOpen = true; m0.feed.steamValveOpen = true;
            m0.water.supply = 5.5; m0.water.air = 6.0;
            m0.motor.on = true; m0.bowl.speed = RATED_SPEED;
            m0.bowl.closed = true; m0.bowl.waterSeal = true;
            m0.feed.heaterOn = true; m0.feed.temp = m0.params.sepTemp;
            m0.feed.pumpOn = true;
            m0.mode = 'MAN';
            m0.state = 'STANDBY';
            return '水封/待命';
        }
        if (idx === 3) {
            m0.epcPower = true; m0.mainPower = true; m0.water.mainOpen = true; m0.water.airMainOpen = true;
            m0.feed.dirtyValveOpen = true; m0.feed.returnValveOpen = true; m0.feed.steamValveOpen = true;
            m0.water.supply = 5.5; m0.water.air = 6.0;
            m0.motor.on = true; m0.bowl.speed = RATED_SPEED;
            m0.bowl.closed = true; m0.bowl.waterSeal = true;
            m0.feed.heaterOn = true; m0.feed.temp = m0.params.sepTemp;
            m0.feed.pumpOn = true;
            m0.feed.flow = m0.params.flow;
            m0.mode = 'MAN';
            this._startProgram(3);
            return '正常分油';
        }
        // idx === 4
        if (m0.state !== 'SEPARATION') {
            m0.epcPower = true; m0.mainPower = true; m0.water.mainOpen = true; m0.water.airMainOpen = true;
            m0.feed.dirtyValveOpen = true; m0.feed.returnValveOpen = true; m0.feed.steamValveOpen = true;
            m0.water.supply = 5.5; m0.water.air = 6.0;
            m0.motor.on = true; m0.bowl.speed = RATED_SPEED;
            m0.bowl.closed = true; m0.bowl.waterSeal = true;
            m0.feed.heaterOn = true; m0.feed.temp = m0.params.sepTemp;
            m0.feed.pumpOn = true;
            m0.feed.flow = m0.params.flow;
        }
        this._startProgram(4);
        return '排渣';
    }

    // ═══════════════════════════════════════════════════════════
    //  每帧求解
    // ═══════════════════════════════════════════════════════════

    solve(dt) {
        dt = clamp(dt || 0.05, 0.001, 0.2);
        const m = this.m;
        const dts = dt;
        const dtp = dt * m.timeScale;
        m.clock += dtp;
        m.stateTime += dts;

        // ── 工作水 / 控制空气 ──
        const waterTarget = m.water.mainOpen ? (m.faults.opWaterLow ? 1.2 : 5.5) : 0;
        m.water.supply = expApproach(m.water.supply, waterTarget, 0.8, dts);
        if (m.water.supply < 0.05) m.water.supply = 0;
        const airTarget = m.water.airMainOpen ? (m.faults.airLow ? 3.4 : 6.0) : 0;
        m.water.air = expApproach(m.water.air, airTarget, 0.7, dts);
        if (m.water.air < 0.05) m.water.air = 0;

        // ── 排渣口开合对转速 / 电流的影响 ──
        // 排渣口开启：转速下降 700 r/min、电流上升 10%；关闭后转速回升、电流恢复
        // 「分离筒密封失效」故障：无法重新密封 → 保持下降 900 r/min、电流保持上升 20%
        // 只有「曾经密封过」之后，底盘打开才算排渣口开启（避免升速阶段误判）
        if (m.bowl.closed || m.bowl.discharge > 0) m.bowl.sealedOnce = true;
        const ratedRun = !!(m.motor.on && m.bowl.speed > RATED_SPEED * 0.9);
        const portOpen = (m.bowl.discharge > 0)
            || (m.prog && m.bowl.sealedOnce && !m.bowl.closed && ratedRun);
        const sealFail = !!(m.faults.leak && m.motor.on);
        const dropRpm = sealFail ? 900 : (portOpen ? 700 : 0);
        const iBoost = sealFail ? 0.20 : (portOpen ? 0.10 : 0);

        // ── 转速 ──
        const speedTarget = m.motor.on ? (RATED_SPEED - dropRpm) : 0;
        let tau = m.motor.on ? START_TAU : STOP_TAU;
        if (m.motor.on && m.bowl.speed > RATED_SPEED * 0.9) tau = 2.0;   // 额定转速下排渣引起的跌落/回升
        m.bowl.speed = expApproach(m.bowl.speed, speedTarget, tau, dtp);
        if (!m.motor.on && m.bowl.speed < 1) m.bowl.speed = 0;
        m.bowl.discRot += (m.bowl.speed / RATED_SPEED) * 8.0 * dts;

        // ── 电机电流 / 功率 ──
        const load = (m.state === 'SEPARATION' || m.state === 'DISCHARGE') ? 1.0 : (m.motor.on ? 0.42 : 0);
        const iTarget = m.motor.on ? (3.2 + 8.0 * load + 3.0 * (m.bowl.speed / RATED_SPEED)) * (1 + iBoost) : 0;
        m.motor.current = expApproach(m.motor.current, iTarget, 0.6, dts);
        if (!m.motor.on && m.motor.current < 0.1) m.motor.current = 0;
        m.motor.power = m.motor.current * 0.38; // kW 近似

        // ── 温度 ──
        // 加热器联锁：供油泵停止则加热器立即关闭
        if (!m.feed.pumpOn) m.feed.heaterOn = false;
        if (m.faults.tempLow) m.feed.heaterOn = false;      // 加热器故障：加热器无法投入
        // 调节器投入 = 加热器投入 + 主电源；真正加热还需蒸汽截止阀打开
        const ctrlOn = !!(m.feed.heaterOn && m.mainPower);
        const heating = ctrlOn && !!m.feed.steamValveOpen;
        // 温度调节器需求（阀门开度）：只与温度偏差有关，蒸汽截止阀关闭时开度照样增大
        const demandP = ctrlOn ? clamp((m.feed.tempSet - m.feed.temp) * 0.6 + 2, 0, 8) : 0;
        let tempTarget = 40;
        if (heating) tempTarget = m.faults.tempLow ? 72 : m.feed.tempSet;
        const tTau = heating ? TEMP_TAU : COOL_TAU;
        m.feed.temp = expApproach(m.feed.temp, tempTarget, tTau, dtp);
        m.feed.heaterPower = heating ? demandP : 0;

        // ── 进油流量 ──
        const canFeed = m.feed.pumpOn && m.feed.valveOpen
            && m.feed.dirtyValveOpen
            && m.bowl.closed && m.bowl.waterSeal
            && m.feed.temp > 80 && m.state === 'SEPARATION';
        let flowTarget = canFeed ? m.params.flow : 0;
        if (!m.feed.dirtyValveOpen || m.feed.v1Return) flowTarget = 0;
        const tauFlow = flowTarget < m.feed.flow - 0.01 ? 0.3 : 1.2;
        m.feed.flow = expApproach(m.feed.flow, flowTarget, tauFlow, dtp);
        if (m.feed.flow < 0.01) m.feed.flow = 0;

        // 回流循环流量：起动/待命阶段经 V1 上部通道回到沉淀柜
        const recirc = !!(m.feed.pumpOn && m.mainPower && m.feed.dirtyValveOpen && m.feed.returnValveOpen && m.feed.v1Return);
        const recircTarget = recirc ? Math.max(0.25, m.params.flow * 0.9) : 0;
        const tauReturn = recircTarget < m.feed.returnFlow - 0.01 ? 0.3 : 1.2;
        m.feed.returnFlow = expApproach(m.feed.returnFlow, recircTarget, tauReturn, dtp);
        if (m.feed.returnFlow < 0.01) m.feed.returnFlow = 0;

        // 出口阀或回流阀任一关闭：泵后憋压，单向阀内部循环
        // 回流状态：出口阀或回流阀任一关闭即憋压；
        // 分油状态：回流阀不参与主油路，只有出口阀关闭才憋压。
        const deadhead = !!(m.feed.pumpOn && m.mainPower && (
            m.feed.v1Return
                ? (!m.feed.dirtyValveOpen || !m.feed.returnValveOpen)
                : (!m.feed.dirtyValveOpen)
        ));
        const checkTarget = deadhead ? Math.max(0.2, m.params.flow * 0.8) : 0;
        const tauCheck = checkTarget < m.feed.checkFlow - 0.01 ? 0.3 : 1.0;
        m.feed.checkFlow = expApproach(m.feed.checkFlow, checkTarget, tauCheck, dtp);
        if (m.feed.checkFlow < 0.01) m.feed.checkFlow = 0;

        // ── 压力 ──
        const pt1Target = (m.feed.pumpOn && m.mainPower)
            ? (deadhead ? 0.68 : (m.feed.valveOpen ? 0.26 + m.feed.flow * 0.03 : 0.12))
            : 0;
        const tauP = deadhead && pt1Target > m.feed.pressure ? 0.4 : 0.8;
        m.feed.pressure = expApproach(m.feed.pressure, pt1Target, tauP, dtp);
        m.feed.checkOpen = m.feed.pressure > 0.42;

        let pt4Target = (m.state === 'SEPARATION' && m.bowl.closed && m.bowl.waterSeal)
            ? (m.faults.leak ? 0.02 : 0.28 + m.feed.flow * 0.02)
            : (m.state === 'DISCHARGE' ? 0.03 : 0);
        // Ti59 / Ti71 置换水充筒：压力随水量升高到 0.3 MPa
        if (m.prog && ((m.phase === 2 && m.step === 3) || (m.phase === 4 && m.step === 1))) pt4Target = 0.3 * (m.bowl.fill || 0);
        if (m.prog && m.phase === 4 && m.step === 2) pt4Target = 0.2;   // Ti72 置换出油，压力维持 0.2
        m.oil.outletPressure = expApproach(m.oil.outletPressure, pt4Target, 0.9, dtp);

        // PT5 排水压力：只有 V5（排水阀）打开才有压力；阀门不开恒为 0
        let pt5Target = 0;
        if (m.water.drain && m.water.mainOpen) {
            pt5Target = clamp(0.004 + m.water.supply * 0.004, 0, 0.05);   // 5.5 bar 工作水 → 约 0.026 MPa
        }
        m.water.outletPressure = expApproach(m.water.outletPressure, pt5Target, 0.8, dtp);
        if (!m.water.drain && m.water.outletPressure < 0.004) m.water.outletPressure = 0;

        // ── 水分 / ALCAP ──
        const ti68 = m.prog && m.phase === 3 && m.step === 4;   // 正常分油 Ti68：水分由专用逻辑控制
        if (ti68) {
            // 由 _ti68Water() 处理：水分每分钟 +2 pF，> 12 pF 时 V5 排水到 6 pF
        } else if (m.state === 'SEPARATION') {
            m.oil.waterInOil = clamp(m.oil.waterInOil + (0.0009 + (m.faults.leak ? 0.02 : 0)) * dtp, 0, 3);
            m.oil.waterContent = clamp(4 + m.oil.waterInOil * 14, 0, 40);
        } else {
            m.oil.waterInOil = clamp(m.oil.waterInOil - 0.0015 * dtp, 0, 3);
            m.oil.waterContent = clamp(4 + m.oil.waterInOil * 14, 0, 40);
        }
        if (m.faults.transducer) m.oil.waterContent = -1; // 显示 NC

        // ── 油柜液位 ──
        if (m.feed.flow > 0.01) {
            const d = (m.feed.flow * dtp / 3600) * 10; // 10 m³ 柜，%
            m.oil.dirty = clamp(m.oil.dirty - d, 0, 100);
            m.oil.clean = clamp(m.oil.clean + d * 0.96, 0, 100);
        }
        if (m.oil.dirty < 5) {
            m.oil.dirty = 5; // 教学演示不因缺油中断
        }

        // ── 排渣柜 / 排渣倒计时 ──
        if (m.faults.sludgeHigh) m.sludge.tank = Math.max(m.sludge.tank, 96);
        if (m.state === 'SEPARATION' || m.state === 'STANDBY' || m.state === 'DISCHARGE') {
            m._sinceDischarge += dtp;
            m.sludge.nextIn = Math.max(0, m.sludge.nextIn - dtp);
        }

        // ── 振动 ──
        const imbalance = clamp(m._sinceDischarge / 900, 0, 1) * 0.8;
        let vib = 0.9 + imbalance + (m.faults.vibration ? 7.0 : 0) + (m.bowl.speed / RATED_SPEED) * 0.3;
        if (m.bowl.speed < 1) vib *= 0.1;
        m.bowl.vibration = expApproach(m.bowl.vibration, vib, 0.5, dts);

        // ── 状态机 ──
        this._solveState(dts, dtp);

        // ── 报警评估 ──
        this._evaluateAlarms(dts);

        // 只要停止进油（低油温 / 跑油 / 排渣 / 停机等），立刻切到回油口
        if (!m.feed.valveOpen) m.feed.v1Return = true;

        // ── 出油温度 / 温度控制器 ──
        m.oil.outletTemp = expApproach(m.oil.outletTemp, m.feed.temp + (m.state === 'SEPARATION' ? 1.2 : 0), 20, dtp);
        m.tempCtrl.setpoint = m.params.sepTemp;
        m.tempCtrl.output = clamp(m.feed.heaterPower * 2.13, 0, 99);
        // 蒸汽电动调节阀开度：按加热功率 0~8 kW 线性映射 0~100%
        m.tempCtrl.valve = ctrlOn ? clamp(demandP / 8 * 100, 0, 100) : 0;

        // ── 显示量 ──
        m.display.rpm = m.bowl.speed;
        m.display.tt1 = m.feed.temp;
        m.display.pt1 = m.feed.pressure;
        m.display.pt4 = m.oil.outletPressure;
        m.display.pt5 = m.water.outletPressure;
        m.display.mt = m.faults.transducer ? -1 : m.oil.waterContent;
        m.display.flow = m.feed.flow;
        m.display.runTime = m.counters.runTime;
        m.display.next = m.sludge.nextIn;
        m.counters.runTime += (m.state === 'SEPARATION' ? dtp : 0) / 3600;

        // 排渣泵运行：排渣柜液位逐渐降低，低于 5% 时自动停泵
        if (m.sludge.pumpOn) {
            m.sludge.tank -= 0.8 * dts;              // 约 0.8 %/s
            if (m.sludge.tank <= 5) {
                m.sludge.tank = 5;
                m.sludge.pumpOn = false;             // 低于 5% → 自动停机
            }
        }

        // 每次 SV15 通电（开启水输入、排渣口打开）→ 排渣柜液位上升
        {
            const sv15Now = !!m.water.sv15;
            if (sv15Now && !m._sv15Prev) {
                m.sludge.tank = clamp(m.sludge.tank + 1.25, 0, 100);   // 每次排渣口开启上升 1.25%
            }
            m._sv15Prev = sv15Now;
        }

        if (m.bowl.discharge > 0) m.bowl.discharge = Math.max(0, m.bowl.discharge - dts);
        if (m.bowl.leak > 0 && !m.faults.leak) m.bowl.leak = Math.max(0, m.bowl.leak - dts);
        if (m._pulse16 > 0) {
            m._pulse16 -= dts;
            m.water.sv16 = m._pulse16 > 0;
            if (m._pulse16 <= 0) m.water.sv16 = false;
        }
    }

    // ===== 工作程序：6 个阶段 + Ti 定时器 =====
    _tick(name, dts) {
        const m = this.m;
        if (m.timerName !== name) { m.timerName = name; m.timerT = 0; }
        m.timerT += dts;
        return m.timerT;
    }

    _nextStep() {
        const m = this.m;
        if (m.stepByStep) {
            // 单步模式：本步完成，冻结在当前计时值，等「下一步」再推进
            m.stepDone = true;
            m.paused = true;
            return;
        }
        m.step += 1;
        m.timerT = 0;
        m.timerName = '';
    }

    _enterPhase(n) {
        const m = this.m;
        if (m.stepByStep && m.prog && m.phase > 0) {
            m.pendingPhase = n;      // 单步模式：阶段切换也要等「下一步」
            m.stepDone = true;
            m.paused = true;
            return;
        }
        this._enterPhaseNow(n);
    }

    _enterPhaseNow(n) {
        const m = this.m;
        m.phase = n;
        m.step = 0;
        m.timerT = 0;
        m.timerName = '';
        m.stepDone = false;
        m.paused = false;
        // 离开 Ti68：清除补偿水 / 排水状态（V5 关闭）
        m.compWater = false; m.drainWater = false; m.waterDrainMode = false;
        m._cwPulse = 0; m._cwAcc = 0;
        if (m.water.drain) m.water.drain = false;
        if (m.water.sv16) m.water.sv16 = false;
        m.state = ({ 1: 'STARTING', 2: 'START_SEQ', 3: 'SEPARATION', 4: 'DISCHARGE', 5: 'STOPPING', 6: 'STOPPING' })[n] || 'STANDBY';
    }

    _startProgram(phase) {
        const m = this.m;
        m.prog = true;
        m.feed.progOn = true;
        m._drainCount = 0;
        m.autoStopReq = false;
        m.stopManual = false;
        m.oil.mtOn = false;
        m.pendingPhase = 0;
        this._enterPhaseNow(phase);
    }

    _endProgram(state) {
        const m = this.m;
        m.prog = false;
        m.feed.progOn = false;
        m.phase = 0;
        m.step = 0;
        m.timerT = 0;
        m.timerName = '';
        m.compWater = false; m.drainWater = false; m.waterDrainMode = false;
        m._cwPulse = 0; m._cwAcc = 0;
        m.autoStopReq = false;
        m.stopManual = false;
        m.state = state || (m.motor.on ? 'STANDBY' : 'STANDSTILL');
    }

    _solveState(dts) {
        const m = this.m;
        if (m.paused) return;                // 单步冻结：计时与状态都不推进
        if (!m.prog) {
            if (m.state === 'STOPPING' && m.seq && m.seq.emergency) { this._solveStop(dts); return; }
            if (m.motor.on) m.state = m.bowl.speed >= RATED_SPEED * 0.9 ? 'STANDBY' : 'STARTING';
            else m.state = m.bowl.speed > MIN_SPEED ? 'STOPPING' : 'STANDSTILL';
            return;
        }
        // 工作水 / 密封水的可视化状态
        if (m.water.sv15) {
            m.bowl.opWater = Math.min(1, (m.bowl.opWater || 0) + dts / 2);   // 2 s 积满
            m.bowl.sealWater = 0;                                            // 排渣口开启：密封水被甩出
        }
        if (m.water.sv16 && !m.water.sv15) {
            m.bowl.sealWater = Math.min(1, (Number(m.bowl.sealWater) || 0) + dts / 2.5);   // 密封水层逐渐建立
        }
        switch (m.phase) {
            case 1: this._phaseAutoStart(dts); break;
            case 2: this._phaseStartSeq(dts); break;
            case 3: this._phaseSeparation(dts); break;
            case 4: this._phaseDischarge(dts); break;
            case 5: this._phaseStopSeq(dts); break;
            case 6: this._phaseAutoStop(dts); break;
            default: this._endProgram();
        }
    }

    // 阶段 1：自动起动
    _phaseAutoStart(dts) {
        const m = this.m, P = m.params;
        m.state = m.step >= 3 ? 'START_SEQ' : 'STARTING';
        m.oil.outletValveOpen = true;      // 自动起动阶段 V4 保持开启，SV4 不通电
        if (m.step === 0) {
            // Ti50：计时 3 s 后供油泵起动成功
            this._tick('Ti50', dts);
            if (m.timerT >= 3) {
                if (!m.feed.pumpOn) this.setFeedPump(true);
                this._nextStep();                     // 冻结在 3 s
            }
        } else if (m.step === 1) {
            // Ti51：PT1 压力开始上升，稳定后停止计时并冻结
            this._tick('Ti51', dts);
            const p = m.feed.pressure;
            if (m.timerT < 0.25) { m._pPrev = p; m._pStableT = 0; }
            if (Math.abs(p - (m._pPrev || 0)) < 0.002) m._pStableT = (m._pStableT || 0) + dts;
            else { m._pStableT = 0; m._pPrev = p; }
            if ((m._pStableT > 1.2 && p > 0.02) || m.timerT >= P.Ti51) {
                if (p < 0.02) { this._raise('A17', 'FEED PUMP - NO PRESSURE'); this._tripStop('pump'); }
                else this._nextStep();
            }
        } else if (m.step === 2) {
            // Ti52 起动分油机：25 s 内升到额定转速，到点冻结
            this._tick('Ti52', dts);
            if (!m.motor.on) { m.motor.on = true; m.motor.trip = false; }
            if (m.timerT >= P.Ti52) {
                if (m.bowl.speed < RATED_SPEED * 0.9) { this._raise('A18', 'BOWL SPEED - NO RESPONSE'); this._tripStop('motor'); }
                else this._nextStep();
            }
        } else if (m.step === 3) {
            // Ti53 起动加热器：20 s 内升到设定温度，到点冻结
            this._tick('Ti53', dts);
            if (!m.feed.heaterOn) m.feed.heaterOn = true;
            if (m.timerT >= P.Ti53) {
                if (m.feed.temp < P.sepTemp - 2) { this._raise('A05', 'OIL FEED TEMPERATURE - LOW'); this._tripStop('temp-low'); }
                else this._nextStep();
            }
        } else {
            if (this._tick('Ti55', dts) >= P.Ti55) this._enterPhase(2);
        }
    }

    // 阶段 2：起动（复位 / 校验 / 排渣 / 水封）
    _phaseStartSeq(dts) {
        const m = this.m, P = m.params;
        m.state = 'START_SEQ';
        m.feed.pumpOn = true;
        m.feed.heaterOn = true;
        m.oil.outletValveOpen = false;      // V4 关闭（筒内为空，无净油流动）
        switch (m.step) {
            case 0:
                m.water.sv15 = true;
                if (this._tick('Ti56', dts) >= P.Ti56) { m.water.sv15 = false; m.bowl.closed = false; m.bowl.discharge = 1.2; this._nextStep(); }
                break;
            case 1:
                m.water.sv15 = false;
                m.bowl.opWater = Math.max(0, 1 - this._tick('Ti57', dts) / P.Ti57);   // 工作水逐渐消失
                if (m.timerT >= P.Ti57) { m.bowl.opWater = 0; this._nextStep(); }
                break;
            case 2:
                m.water.sv16 = true;
                m.bowl.closed = true;            // 活动底盘抬起
                if (this._tick('Ti58', dts) >= P.Ti58) { m.water.sv16 = false; this._nextStep(); }
                break;
            case 3:
                // Ti59 置换水：20 s 内逐渐充满分离筒，PT4 升到 0.3 MPa
                m.water.sv10 = true; m.oil.outletValveOpen = false; m.water.drain = false;
                this._tick('Ti59', dts);
                m.bowl.fill = Math.min(1, m.timerT / P.Ti59);
                if (m.timerT >= P.Ti59) { m.water.sv10 = false; m.bowl.fill = 1; this._nextStep(); }
                break;
            case 4:
                // Ti60 排渣：筒内水全部卸放
                m.water.sv15 = true; m.bowl.fill = 0; m.bowl.closed = false; m.bowl.discharge = 1.2;
                if (this._tick('Ti60', dts) >= P.Ti60) { m.water.sv15 = false; this._nextStep(); }
                break;
            case 5:
                m.water.sv15 = false;
                m.bowl.opWater = Math.max(0, 1 - this._tick('Ti61', dts) / P.Ti61);   // 工作水逐渐泄放消失
                if (m.timerT >= P.Ti61) { m.bowl.opWater = 0; this._nextStep(); }
                break;
            case 6:
                m.water.sv16 = true;
                m.bowl.closed = true;
                if (this._tick('Ti62', dts) >= P.Ti62) { m.water.sv16 = false; this._nextStep(); }
                break;
            default:
                // Ti63 建立水封：动画显示水封逐渐形成
                m.water.sv10 = true;
                this._tick('Ti63', dts);
                m.bowl.sealForm = Math.min(1, m.timerT / P.Ti63);
                if (m.timerT >= P.Ti63) { m.water.sv10 = false; m.bowl.waterSeal = true; m.bowl.fill = 0; this._enterPhase(3); }
                break;
        }
    }

    // 阶段 3：分离
    _phaseSeparation(dts) {
        const m = this.m, P = m.params;
        m.state = 'SEPARATION';
        m.feed.pumpOn = true;
        if (m.step === 0) {
            m.feed.v1Return = false; m.feed.valveOpen = true; m.oil.outletValveOpen = false;
            this._tick('Ti64', dts);
            if (m.timerT >= P.Ti64) this._nextStep();     // 供油确认：8 s 冻结
        } else if (m.step === 1) {
            m.oil.mtOn = true;                            // Ti65 起显示水分含量
            m.oil.outletValveOpen = true;
            this._tick('Ti65', dts);
            if (m.timerT >= P.Ti65) {
                if (m.oil.waterContent > P.waterTrigger) P.Ti63 = Math.max(20, P.Ti63 - 10);
                this._nextStep();
            }
        } else if (m.step === 2) {
            m.feed.valveOpen = false; m.feed.v1Return = true; m.oil.outletValveOpen = false; m.water.drain = false;
            this._tick('Ti66', dts);
            if (m.timerT >= P.Ti66) {
                const pr = m.oil.outletPressure;
                if (pr < 0.1 || pr > 0.3) this._raise('A03', 'OIL LEAKING FROM BOWL');
                this._nextStep();
            }
        } else if (m.step === 3) {
            m.feed.v1Return = false; m.feed.valveOpen = true; m.oil.outletValveOpen = true;
            this._tick('Ti67', dts);
            if (m.timerT >= P.Ti67) { m.oil.mtRef = m.oil.waterContent; this._nextStep(); }
        } else {
            m.feed.v1Return = false; m.feed.valveOpen = true; m.oil.outletValveOpen = true;
            // 自动停止请求：正常分离过程中按下，立即转入停机阶段
            if (m.autoStopReq) { this._enterPhase(5); return; }
            const Ti68 = P.dischargeInterval * 60;
            this._tick('Ti68', dts);
            m.sludge.nextIn = Math.max(0, Ti68 - m.timerT);
            this._ti68Water(dts);                                   // 补偿水 / 排水
            if (m.timerT >= Ti68) this._enterPhase(4);
        }
    }

    /**
     * Ti68 正常分油期间的水分管理：
     * ① 每 2 min 让 SV16 通电 3 s 进补偿水（状态栏第二行显示「进补偿水」）；
     * ② 水分含量每分钟上涨 2 pF，超过 12 pF 时 V5 开启一次排水，降到 6 pF 后关闭（显示「排水」）。
     */
    _ti68Water(dts) {
        const m = this.m;
        // ① 补偿水脉冲
        m._cwAcc = (m._cwAcc || 0) + dts;
        if (m._cwPulse > 0) {
            m._cwPulse -= dts;
            if (m._cwPulse <= 0) { m._cwPulse = 0; m.water.sv16 = false; }
            else m.water.sv16 = true;
        } else if (m._cwAcc >= 120) {
            m._cwAcc = 0; m._cwPulse = 3; m.water.sv16 = true;
        }
        m.compWater = m._cwPulse > 0;

        // ② 水分含量：+2 pF/min（waterContent = 4 + waterInOil × 14）
        if (m.waterDrainMode) {
            // V5 排水：约 8 s 由 12 pF 降到 6 pF
            m.oil.waterInOil = clamp((m.oil.waterInOil || 0) - (6 / 14) / 8 * dts, 0, 3);
            m.oil.waterContent = clamp(4 + m.oil.waterInOil * 14, 0, 40);
            if (m.oil.waterContent <= 6.05) {
                m.waterDrainMode = false; m.water.drain = false;   // 降到 6 pF：关闭 V5
            }
        } else {
            m.oil.waterInOil = clamp((m.oil.waterInOil || 0) + (2 / 60) / 14 * dts, 0, 3);
            m.oil.waterContent = clamp(4 + m.oil.waterInOil * 14, 0, 40);
            if (m.oil.waterContent > 12) {                          // 超过 12 pF：开启 V5 排水
                m.waterDrainMode = true; m.water.drain = true;
            }
        }
        m.drainWater = m.waterDrainMode;
    }

    // 阶段 4：排渣
    _phaseDischarge(dts) {
        const m = this.m, P = m.params;
        m.state = 'DISCHARGE';
        switch (m.step) {
            case 0:
                // Ti70 断油并出油：进油三通阀断开，出油阀 V4 关闭，筒内油继续经管道流出
                m.feed.valveOpen = false; m.feed.v1Return = true; m.oil.outletValveOpen = false;
                if (this._tick('Ti70', dts) >= P.Ti70) this._nextStep();
                break;
            case 1:
                // Ti71 置换水进筒：水逐渐充满，筒内看不到油，PT4 升到 0.3 MPa
                m.water.sv10 = true; m.oil.outletValveOpen = false;
                this._tick('Ti71', dts);
                m.bowl.fill = Math.min(1, m.timerT / P.Ti71);
                if (m.timerT >= P.Ti71) { m.bowl.fill = 1; this._nextStep(); }
                break;
            case 2:
                // Ti72 置换：管道内的油全部推出
                m.water.sv10 = true; m.oil.outletValveOpen = true;
                if (this._tick('Ti72', dts) >= P.Ti72) { m.water.sv10 = false; this._nextStep(); }
                break;
            case 3:
                // Ti73 向心管清洗：关闭出油阀 V4，开出水阀 V5 冲洗出水管
                m.oil.outletValveOpen = false;
                m.water.drain = true;
                if (this._tick('Ti73', dts) >= P.Ti73) { m.water.drain = false; this._nextStep(); }
                break;
            case 4:
                // Ti74 输入开启水：筒内水与水封全部甩出
                m.water.sv15 = true; m.bowl.fill = 0;
                m.bowl.waterSeal = false; m.bowl.sealForm = 0;
                if (this._tick('Ti74', dts) >= P.Ti56) {
                    m.water.sv15 = false; m.bowl.closed = false; m.bowl.discharge = 1.4;
                    m.sludge.count++; m.counters.dischargeCount++;
                    this._nextStep();
                }
                break;
            case 5:
                // Ti75 释放刚刚输入的开启水
                m.bowl.opWater = Math.max(0, 1 - this._tick('Ti75', dts) / P.Ti57);
                if (m.timerT >= P.Ti57) {
                    m.bowl.opWater = 0;
                    if (m.autoStopReq) { this._enterPhase(5); }
                    else this._nextStep();      // → Ti62 关闭分离筒，进入下一循环
                }
                break;
            case 6:
                m.water.sv16 = true;
                m.bowl.closed = true;
                if (this._tick('Ti62', dts) >= P.Ti62) { m.water.sv16 = false; this._nextStep(); }
                break;
            default:
                m.water.sv10 = true;
                if (this._tick('Ti63', dts) >= Math.min(P.Ti63, 120)) {
                    m.water.sv10 = false; m.bowl.waterSeal = true;
                    // 排渣阶段中任意时刻按过「分离停止」：排渣程序走完后进入阶段 5（Ti81）
                    if (m.autoStopReq) this._enterPhase(5);
                    else this._enterPhase(3);
                }
                break;
        }
    }

    // 阶段 5：停机
    _phaseStopSeq(dts) {
        const m = this.m, P = m.params;
        m.state = 'STOPPING';
        if (m.step === 0) {
            m.feed.valveOpen = false; m.feed.v1Return = true; m.oil.outletValveOpen = false;
            m.feed.heaterOn = false;
            m.water.sv16 = true;
            m.bowl.closed = true;
            if (this._tick('Ti81', dts) >= P.Ti81) { m.water.sv16 = false; this._nextStep(); }
        } else if (m.step === 1) {
            // Ti82 置换出油：出油阀 V4 保持开启
            m.water.sv10 = true; m.oil.outletValveOpen = true;
            this._tick('Ti82', dts);
            if (m.timerT >= P.Ti82) { m.water.sv10 = false; this._nextStep(); }
        } else {
            m.water.drain = true;
            if (this._tick('Ti83', dts) >= P.Ti83) {
                m.water.drain = false;
                // 机旁手动（HAND）分离停止：阶段 5 走完 Ti81/Ti82/Ti83 即结束，电机继续运行（待命）
                if (m.local || m.stopManual) this._endProgram('STANDBY');
                else this._enterPhase(6);           // 远程/自动：继续阶段 6 停机（Ti85~Ti89）
            }
        }
    }

    // 阶段 6：自动停机
    _phaseAutoStop(dts) {
        const m = this.m, P = m.params;
        m.state = 'STOPPING';
        if (m.step === 0) {
            m.feed.heaterOn = false; m.motor.on = false;
            m.feed.valveOpen = false; m.feed.v1Return = true;
            if (this._tick('Ti85', dts) >= P.Ti85) this._nextStep();
        } else if (m.step === 1) {
            if (this._tick('Ti86', dts) >= P.Ti86) this._nextStep();
        } else if (m.step === 2) {
            m.feed.pumpOn = false;
            if (this._tick('Ti87', dts) >= P.Ti87) this._nextStep();
        } else {
            if (this._tick('Ti89', dts) >= P.Ti89) {
                m.bowl.speed = 0; m.motor.on = false; m.feed.pumpOn = false;
                m.bowl.closed = false; m.bowl.waterSeal = false;
                this._endProgram('STANDSTILL');
            }
        }
    }

    _solveDischarge(dts) {
        const m = this.m;
        const q = m.seq;
        q.t += dts;
        switch (q.step) {
            case 0:
                m.water.sv10 = true;
                m.feed.valveOpen = false;
                if (q.t >= m.params.displacementTime) {
                    m.water.sv10 = false;
                    q.step = 1; q.t = 0;
                }
                break;
            case 1:
                m.water.sv15 = true;
                if (q.t >= 3) {
                    m.water.sv15 = false;
                    m.bowl.closed = false;
                    m.bowl.waterSeal = false;
                    m.bowl.discharge = 1.4;
                    q.feedback = !m.faults.dischargeFail && m.water.supply >= 2;
                    q.step = 2; q.t = 0;
                }
                break;
            case 2:
                if (q.t >= 4) {
                    if (!q.feedback && q.attempts < 1) {
                        q.attempts++;
                        q.step = 1; q.t = 0;
                    } else if (!q.feedback) {
                        this._raise('A04', 'DISCHARGE FEEDBACK - ERROR');
                        this._tripStop('discharge');
                    } else {
                        q.step = 3; q.t = 0;
                    }
                }
                break;
            case 3:
                m.water.sv16 = true;
                if (q.t >= 8) {
                    m.water.sv16 = false;
                    m.bowl.closed = true;
                    q.step = 4; q.t = 0;
                }
                break;
            case 4:
                m.water.sv10 = true;
                if (q.t >= m.params.sealTime) {
                    m.water.sv10 = false;
                    m.bowl.waterSeal = true;
                    q.step = 5; q.t = 0;
                }
                break;
            case 5:
            default:
                m.sludge.count++;
                m.counters.dischargeCount++;
                m.sludge.lastTime = m.clock;
                m.sludge.nextIn = m.params.dischargeInterval * 60;
                m._sinceDischarge = 0;
                m._drainCount = 0;
                m.bowl.discharge = 0;
                if (q.resume === 'STANDBY') {
                    m.state = 'STANDBY';
                    m.feed.valveOpen = false;
                    m.oil.outletValveOpen = false;
                    m.feed.v1Return = true;
                } else {
                    m.state = 'SEPARATION';
                    m.feed.valveOpen = true;
                    m.oil.outletValveOpen = true;
                    m.feed.v1Return = false;
                    m.feed.pumpOn = true;
                }
                m.seq = { name: '', step: 0, t: 0, attempts: 0, feedback: false, resume: '' };
                break;
        }
    }

    _solveStop(dts) {
        const m = this.m;
        const q = m.seq;
        q.t += dts;

        // 应急/故障停机：立即断电机、关阀，等待静止
        if (q.emergency || q.step >= 10) {
            m.motor.on = false;
            m.feed.valveOpen = false;
            m.feed.v1Return = true;
            if (!q.keepPump) m.feed.pumpOn = false;
            m.feed.heaterOn = false;
            m.water.sv10 = m.water.sv15 = m.water.sv16 = m.water.drain = false;
            if (m.bowl.speed < MIN_SPEED) {
                m.bowl.speed = 0;
                m.state = 'STANDSTILL';
                m.bowl.closed = false;
                m.bowl.waterSeal = false;
                m.feed.pumpOn = false;
                m.seq = { name: '', step: 0, t: 0, attempts: 0, feedback: false, resume: '' };
            }
            return;
        }

        switch (q.step) {
            case 0:
                m.feed.valveOpen = false;
                m.oil.outletValveOpen = false;
                m.feed.v1Return = true;
                m.feed.heaterOn = false;
                m.water.sv10 = true;
                if (q.t >= 5) { m.water.sv10 = false; q.step = 1; q.t = 0; }
                break;
            case 1:
                m.water.sv15 = true;
                if (q.t >= 3) {
                    m.water.sv15 = false;
                    m.bowl.closed = false;
                    m.bowl.waterSeal = false;
                    m.bowl.discharge = 1.2;
                    q.step = 2; q.t = 0;
                }
                break;
            case 2:
                if (q.t >= 4) { q.step = 3; q.t = 0; }
                break;
            case 3:
                m.water.sv16 = true;
                if (q.t >= 6) { m.water.sv16 = false; m.bowl.closed = true; q.step = 4; q.t = 0; }
                break;
            case 4:
                m.water.sv10 = true;
                if (q.t >= 4) { m.water.sv10 = false; m.bowl.waterSeal = true; q.step = 5; q.t = 0; }
                break;
            case 5:
                m.motor.on = false;
                q.step = 6; q.t = 0;
                break;
            case 6:
                if (m.bowl.speed < 4000 && !m._stopPulse) {
                    m._stopPulse = true;
                    m._pulse16 = 1.0;
                }
                if (m.bowl.speed < MIN_SPEED) {
                    m.bowl.speed = 0;
                    m.state = 'STANDSTILL';
                    m.bowl.closed = false;
                    m.bowl.waterSeal = false;
                    m.feed.pumpOn = false;
                    m.seq = { name: '', step: 0, t: 0, attempts: 0, feedback: false, resume: '' };
                }
                break;
            default:
                break;
        }
    }

    _evaluateAlarms(dts) {
        const m = this.m;
        const running = m.state === 'SEPARATION' || m.state === 'STANDBY' || m.state === 'STARTING'
            || m.state === 'START_SEQ' || m.state === 'DISCHARGE' || m.state === 'STOPPING';

        // 振动
        if (m.bowl.vibration >= m.params.vibrationTrip && m.bowl.speed > 1000) {
            this._raise('A01', 'HIGH VIBRATION - SHUTDOWN');
            if (m.state !== 'STOPPING' && m.state !== 'STANDSTILL') this._tripStop('vibration');
        } else if (m.bowl.vibration >= m.params.vibrationWarn && m.bowl.speed > 1000) {
            this._raise('A02', 'HIGH VIBRATION - WARNING');
        }

        // 跑油 / 净油压力低
        if (m.state === 'SEPARATION' && m.bowl.closed) {
            if (m.oil.outletPressure < 0.06) {
                m._leakTimer += dts;
                if (m._leakTimer > 2.0) {
                    this._raise('A03', 'OIL LEAKING FROM BOWL');
                    m.feed.valveOpen = false;
                    m.bowl.leak = 1;
                    this._tripStop('leak');
                }
            } else {
                m._leakTimer = 0;
            }
        }

        // 油温低：以实际油温低于设定值为准（蒸汽截止阀关闭 / 加热故障均靠温度下降触发）
        const lowOilTemp = m.state === 'SEPARATION' && m.feed.temp < m.params.tempLowAlarm;
        if (lowOilTemp) {
            m._lowTempTimer = (m._lowTempTimer || 0) + dts;
            if (m._lowTempTimer > 1.0) {
                this._raise('A05', 'OIL FEED TEMPERATURE - LOW');
                m.feed.valveOpen = false;                  // 停止进油
                if (m.feed.steamValveOpen && !m.faults.tempLow) m.feed.heaterOn = true;   // 自动投入加热
            }
            if (m._lowTempTimer > 30) this._tripStop('temp-low');
        } else {
            m._lowTempTimer = 0;
            // 温度回升到 97℃ 以上才复位低温报警，并恢复进油
            if (!m.faults.tempLow && m.feed.temp > 97 && m.alarms.some(a => a.code === 'A05' && a.active)) {
                this._clear('A05');
                if (m.state === 'SEPARATION') m.feed.valveOpen = true;
            }
        }

        // 工作水 / 控制空气（主电源合上后才参与联锁，避免开阀升压过程误报）
        if (m.mainPower && m.water.supply < 2) {
            this._raise('A08', 'OPERATING WATER PRESSURE - LOW');
        } else if (m.water.supply > 2.5 && !m.faults.opWaterLow) {
            this._clear('A08');
        }
        if (m.mainPower && m.water.air < 5) {
            this._raise('A09', 'CONTROL AIR PRESSURE - LOW');
        } else if (m.water.air > 5.5 && !m.faults.airLow) {
            this._clear('A09');
        }

        // 排水压力低：V5 打开但排水压力过低（堵塞 / 阀未动作）
        if (m.water.drain && m.water.mainOpen) {
            m._drainPressTimer = (m._drainPressTimer || 0) + dts;
            if (m._drainPressTimer > 2 && m.water.outletPressure < 0.006) {
                this._raise('A16', 'WATER OUTLET PRESSURE - LOW');
            }
        } else {
            m._drainPressTimer = 0;
        }
        if (!m.water.drain || m.water.outletPressure > 0.01) this._clear('A16');

        // 排渣柜
        if (m.sludge.tank > 90) this._raise('A10', 'SLUDGE TANK LEVEL - HIGH');

        // 电机过载
        if (m.motor.current > 18 && m.motor.on) {
            m.motor.trip = true;
            m.motor.on = false;
            this._raise('A12', 'SEPARATOR MOTOR - FAILURE');
            this._tripStop('motor');
        }

        // 应急
        if (m.emergency) this._raise('A14', 'EMERGENCY STOP - BUTTON PUSHED');
    }
}

export default PurifierSolver;
