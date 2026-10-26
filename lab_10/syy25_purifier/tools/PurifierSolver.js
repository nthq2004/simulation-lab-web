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
const START_TAU = 75;          // 模拟秒
const STOP_TAU = 130;          // 模拟秒
const TEMP_TAU = 70;           // 模拟秒

export const PURIFIER_RATED_SPEED = RATED_SPEED;

function createModel() {
    return {
        clock: 0,
        epcPower: false,
        mainPower: false,
        local: false,
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
        },
        motor: { on: false, current: 0, power: 0, trip: false },
        feed: {
            pumpOn: false, valveOpen: false, sv4: false, recirc: false,
            flow: 0, pressure: 0,
            temp: 40, heaterOn: false, heaterPower: 0, tempSet: 98,
        },
        oil: {
            dirty: 80, clean: 20, outletPressure: 0, outletTemp: 40,
            waterContent: 4, waterInOil: 0.2, backpressure: 0,
        },
        water: {
            mainOpen: false, supply: 0,
            airMainOpen: false, air: 0,
            sv10: false, sv15: false, sv16: false, drain: false,
            outletPressure: 0,
        },
        sludge: { tank: 12, count: 0, lastTime: 0, nextIn: 900, feedback: false },
        tempCtrl: { mode: 'AUTO', setpoint: 98, output: 0 },
        cip: false,
        debugMode: false,

        params: {
            dischargeInterval: 5,     // min（教学默认，可调 2~240）
            minInterval: 10,          // min
            sepTemp: 98,              // °C
            flow: 1.5,                // m³/h
            sealTime: 6,              // s（水封）
            displacementTime: 8,      // s（置换水）
            drainTime: 20,            // s（排水阀）
            waterTrigger: 15,         // pF
            timeScale: 1,             // 仿真时间倍率（1×=实时）
            vibrationWarn: 4.5,
            vibrationTrip: 7.1,
        },

        alarms: [],
        alarmActive: false,
        alarmAck: false,

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

    setEpcPower(on) {
        const m = this.m;
        on = !!on;
        if (m.epcPower === on) return;
        m.epcPower = on;
        if (!on) {
            m.mode = 'MAN';
            if (m.state !== 'STANDSTILL') {
                this._raise('A13', 'POWER FAILURE');
                this._tripStop('epc-power');
            }
        } else {
            this._clear('A13');
        }
    }

    toggleEpcPower() { this.setEpcPower(!this.m.epcPower); }

    setMainPower(on) {
        const m = this.m;
        on = !!on;
        if (m.mainPower === on) return;
        m.mainPower = on;
        if (!on) {
            m.motor.on = false;
            m.motor.current = 0;
            m.feed.pumpOn = false;
            m.feed.heaterOn = false;
            m.water.sv10 = m.water.sv15 = m.water.sv16 = m.water.drain = false;
            if (m.state !== 'STANDSTILL') {
                this._raise('A12', 'SEPARATOR MOTOR - FAILURE');
                this._tripStop('main-power');
            }
        }
    }

    toggleMainPower() { this.setMainPower(!this.m.mainPower); }

    setLocal(on) { this.m.local = !!on; }

    /** 调试模式接口：后续调试界面调用后，模拟图阀门/电机/截止阀可控 */
    setDebugMode(on) { this.m.debugMode = !!on; return this.m.debugMode; }
    toggleLocal() { this.m.local = !this.m.local; return this.m.local; }

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
        this.m.feed.pumpOn = !!on;
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
        if (!m.debugMode && m.mode !== 'MAN') {
            this._tip('AUTO 模式下阀门由 EPC-60 控制；调试模式接口已预留');
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
            if (!m.mainPower) { this._tip('请先合上机旁主电源'); return false; }
            if (m.emergency) return false;
            if (m.state !== 'STANDSTILL') return false;
            m.motor.on = true;
            m.motor.trip = false;
            m.state = 'STARTING';
            m.stateTime = 0;
            m._pulse16 = 0;
            m._pulse4000 = false;
            m._stopPulse = false;
            m.seq = { name: 'start', step: 0, t: 0, attempts: 0, feedback: false, resume: '' };
            m.counters.startCount++;
            return true;
        }
        if (m.local) { this._tip('机旁控制优先，请切换到遥控'); return false; }
        if (!this._canStart()) return false;
        m.motor.on = true;
        m.motor.trip = false;
        m.state = 'STARTING';
        m.stateTime = 0;
        m._pulse16 = 0;
        m._pulse4000 = false;
        m._stopPulse = false;
        m._sinceDischarge = 0;
        m.sludge.nextIn = m.params.dischargeInterval * 60;
        m.feed.heaterOn = true;
        m.seq = { name: 'start', step: 0, t: 0, attempts: 0, feedback: false, resume: '' };
        m.counters.startCount++;
        return true;
    }

    pressSeparation() {
        if (this.m.state === 'SEPARATION' || this.m.state === 'STANDBY') {
            this._tip('分油机已在运行，请按 STOP 停机');
            return false;
        }
        return this.start(false);
    }

    localStart() { return this.start(true); }

    pressStop() {
        const m = this.m;
        if (m.state === 'STANDSTILL' || m.state === 'STOPPING') return false;
        m.state = 'STOPPING';
        m._stopPulse = false;
        m.seq = { name: 'stop', step: 0, t: 0, attempts: 0, feedback: false, resume: '', emergency: false };
        m.feed.valveOpen = false;
        m.feed.pumpOn = false;
        m.feed.heaterOn = false;
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
        this._startDischarge('manual');
        return true;
    }

    _startDischarge(reason, resume) {
        const m = this.m;
        const prev = resume || (m.state === 'STANDBY' ? 'STANDBY' : 'SEPARATION');
        m.state = 'DISCHARGE';
        m.seq = { name: 'discharge', step: 0, t: 0, attempts: 0, feedback: false, resume: prev, reason };
        m.feed.valveOpen = false;
        m.sludge.feedback = false;
    }

    _tripStop(reason) {
        const m = this.m;
        if (m.state === 'STOPPING') return;
        m.feed.valveOpen = false;
        m.feed.pumpOn = false;
        m.feed.heaterOn = false;
        m.state = 'STOPPING';
        m._stopPulse = false;
        m.seq = { name: 'stop', step: 10, t: 0, attempts: 0, feedback: false, resume: '', emergency: true, reason };
    }

    // ═══════════════════════════════════════════════════════════
    //  报警
    // ═══════════════════════════════════════════════════════════

    _raise(code, text) {
        const m = this.m;
        if (m.alarms.some(a => a.code === code && a.active)) return;
        m.alarms.unshift({ code, text, time: m.clock, ack: false, active: true });
        if (m.alarms.length > 40) m.alarms.length = 40;
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
        const m = this.m;
        if (m.state !== 'STANDSTILL') return false;
        m.epcPower = true;
        m.mainPower = true;
        m.local = false;
        m.mode = 'AUTO';
        m.water.mainOpen = true;
        m.water.airMainOpen = true;
        m.water.supply = 5.5;
        m.water.air = 6.0;
        m.bowl.speed = RATED_SPEED * 0.98;
        m.feed.temp = 97;
        m.feed.tempSet = m.params.sepTemp;
        return this.start(false);
    }

    fiveStep(idx) {
        const m = this.m;
        idx = ((idx % 5) + 5) % 5;
        if (idx === 0) {
            this.resetAll();
            return '停止';
        }
        if (idx === 1) {
            this.resetAll();
            const mm = this.m;
            mm.epcPower = true; mm.mainPower = true; mm.water.mainOpen = true; mm.water.airMainOpen = true;
            mm.water.supply = 5.5; mm.water.air = 6.0;
            mm.motor.on = true; mm.state = 'STARTING'; mm.bowl.speed = RATED_SPEED * 0.45;
            mm.seq = { name: 'start', step: 0, t: 0, attempts: 0, feedback: false, resume: '' };
            return '起动升速';
        }
        if (idx === 2) {
            m.epcPower = true; m.mainPower = true; m.water.mainOpen = true; m.water.airMainOpen = true;
            m.water.supply = 5.5; m.water.air = 6.0;
            m.motor.on = true; m.bowl.speed = RATED_SPEED;
            m.bowl.closed = true; m.bowl.waterSeal = true;
            m.feed.heaterOn = true; m.feed.temp = m.params.sepTemp;
            m.mode = 'MAN';
            m.state = 'STANDBY';
            return '水封/待命';
        }
        if (idx === 3) {
            m.epcPower = true; m.mainPower = true; m.water.mainOpen = true; m.water.airMainOpen = true;
            m.water.supply = 5.5; m.water.air = 6.0;
            m.motor.on = true; m.bowl.speed = RATED_SPEED;
            m.bowl.closed = true; m.bowl.waterSeal = true;
            m.feed.heaterOn = true; m.feed.temp = m.params.sepTemp;
            m.feed.valveOpen = true; m.feed.pumpOn = true;
            m.feed.flow = m.params.flow;
            m.mode = 'MAN';
            m.state = 'SEPARATION';
            m.sludge.nextIn = m.params.dischargeInterval * 60;
            return '正常分油';
        }
        // idx === 4
        if (m.state !== 'SEPARATION' && m.state !== 'STANDBY') {
            m.epcPower = true; m.mainPower = true; m.water.mainOpen = true; m.water.airMainOpen = true;
            m.water.supply = 5.5; m.water.air = 6.0;
            m.motor.on = true; m.bowl.speed = RATED_SPEED;
            m.bowl.closed = true; m.bowl.waterSeal = true;
            m.feed.heaterOn = true; m.feed.temp = m.params.sepTemp;
            m.feed.valveOpen = true; m.feed.pumpOn = true;
            m.feed.flow = m.params.flow;
            m.state = 'SEPARATION';
        }
        this._startDischarge('manual');
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

        // ── 转速 ──
        const speedTarget = m.motor.on ? RATED_SPEED : 0;
        const tau = m.motor.on ? START_TAU : STOP_TAU;
        m.bowl.speed = expApproach(m.bowl.speed, speedTarget, tau, dtp);
        if (!m.motor.on && m.bowl.speed < 1) m.bowl.speed = 0;
        m.bowl.discRot += (m.bowl.speed / RATED_SPEED) * 8.0 * dts;

        // ── 电机电流 / 功率 ──
        const load = m.state === 'SEPARATION' ? 1.0 : (m.motor.on ? 0.42 : 0);
        const iTarget = m.motor.on ? (3.2 + 8.0 * load + 3.0 * (m.bowl.speed / RATED_SPEED)) : 0;
        m.motor.current = expApproach(m.motor.current, iTarget, 0.6, dts);
        if (!m.motor.on && m.motor.current < 0.1) m.motor.current = 0;
        m.motor.power = m.motor.current * 0.38; // kW 近似

        // ── 温度 ──
        let tempTarget = 40;
        if (m.feed.heaterOn && m.mainPower) tempTarget = m.faults.tempLow ? 72 : m.feed.tempSet;
        const tTau = m.feed.heaterOn ? TEMP_TAU : 180;
        m.feed.temp = expApproach(m.feed.temp, tempTarget, tTau, dtp);
        m.feed.heaterPower = m.feed.heaterOn ? clamp((m.feed.tempSet - m.feed.temp) * 0.6 + 2, 0, 8) : 0;

        // ── 进油流量 ──
        const canFeed = m.feed.pumpOn && m.feed.valveOpen && m.bowl.closed && m.bowl.waterSeal
            && m.feed.temp > 80 && m.state === 'SEPARATION';
        const flowTarget = canFeed ? m.params.flow : 0;
        m.feed.flow = expApproach(m.feed.flow, flowTarget, 1.2, dtp);
        if (m.feed.flow < 0.01) m.feed.flow = 0;

        // ── 压力 ──
        const pt1Target = (m.feed.pumpOn && m.mainPower) ? (m.feed.valveOpen ? 0.26 + m.feed.flow * 0.03 : 0.12) : 0;
        m.feed.pressure = expApproach(m.feed.pressure, pt1Target, 0.8, dtp);

        const pt4Target = (m.state === 'SEPARATION' && m.bowl.closed && m.bowl.waterSeal)
            ? (m.faults.leak ? 0.02 : 0.28 + m.feed.flow * 0.02)
            : (m.state === 'DISCHARGE' ? 0.03 : 0);
        m.oil.outletPressure = expApproach(m.oil.outletPressure, pt4Target, 0.9, dtp);

        const pt5Target = m.water.mainOpen && (m.water.sv10 || m.water.sv15 || m.water.sv16 || m.water.drain)
            ? (0.18 + (m.water.sv15 ? 0.05 : 0)) : 0;
        m.water.outletPressure = expApproach(m.water.outletPressure, pt5Target, 0.8, dtp);

        // ── 水分 / ALCAP ──
        if (m.state === 'SEPARATION') {
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

        // ── 出油温度 / 温度控制器 ──
        m.oil.outletTemp = expApproach(m.oil.outletTemp, m.feed.temp + (m.state === 'SEPARATION' ? 1.2 : 0), 20, dtp);
        m.tempCtrl.setpoint = m.params.sepTemp;
        m.tempCtrl.output = clamp(m.feed.heaterPower * 2.13, 0, 99);

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

        if (m.bowl.discharge > 0) m.bowl.discharge = Math.max(0, m.bowl.discharge - dts);
        if (m.bowl.leak > 0 && !m.faults.leak) m.bowl.leak = Math.max(0, m.bowl.leak - dts);
        if (m._pulse16 > 0) {
            m._pulse16 -= dts;
            m.water.sv16 = m._pulse16 > 0;
            if (m._pulse16 <= 0) m.water.sv16 = false;
        }
    }

    _solveState(dts, dtp) {
        const m = this.m;
        if (m.mode === 'AUTO') {
            m.feed.sv4 = (m.state === 'STARTING' || m.state === 'START_SEQ' || m.state === 'STANDBY');
            m.feed.recirc = m.feed.sv4;
        }
        switch (m.state) {
            case 'STANDSTILL':
                m.motor.on = false;
                m.feed.valveOpen = false;
                m.feed.pumpOn = false;
                m.feed.heaterOn = false;
                break;

            case 'STARTING': {
                // 4000 r/min 时关闭水脉冲 1 s
                if (m.bowl.speed >= 4000 && !m._pulse4000) {
                    m._pulse4000 = true;
                    m._pulse16 = 1.0;
                }
                if (m.bowl.speed >= RATED_SPEED * 0.95) {
                    if (m.epcPower && m.mode === 'AUTO') {
                        m.state = 'START_SEQ';
                        m.seq = { name: 'startseq', step: 0, t: 0, attempts: 0, feedback: false, resume: '' };
                        m.feed.heaterOn = true;
                    } else {
                        m.state = 'STANDBY';
                    }
                }
                break;
            }

            case 'START_SEQ': {
                const q = m.seq;
                q.t += dts;
                if (q.step === 0) {
                    m.water.sv15 = true;
                    if (q.t >= 3) { m.water.sv15 = false; m.bowl.closed = false; m.bowl.discharge = 1.2; q.step = 1; q.t = 0; }
                } else if (q.step === 1) {
                    if (q.t >= 4) { q.step = 2; q.t = 0; }
                } else if (q.step === 2) {
                    m.water.sv16 = true;
                    if (q.t >= 8) { m.water.sv16 = false; m.bowl.closed = true; q.step = 3; q.t = 0; }
                } else if (q.step === 3) {
                    m.water.sv10 = true;
                    if (q.t >= m.params.sealTime) {
                        m.water.sv10 = false;
                        m.bowl.waterSeal = true;
                        q.step = 4; q.t = 0;
                    }
                } else {
                    m.feed.heaterOn = true;
                    m.state = 'STANDBY';
                    m.sludge.nextIn = m.params.dischargeInterval * 60;
                }
                break;
            }

            case 'STANDBY': {
                m.feed.heaterOn = m.epcPower && !m.faults.tempLow;
                const ready = m.bowl.closed && m.bowl.waterSeal && m.feed.temp >= m.params.sepTemp - 2;
                if (ready && m.mode === 'AUTO' && m.feed.pumpOn === false) {
                    m.feed.valveOpen = true;
                    m.feed.pumpOn = true;
                    m.state = 'SEPARATION';
                    m.sludge.nextIn = m.params.dischargeInterval * 60;
                } else if (ready && m.mode === 'MAN' && m.feed.pumpOn && m.feed.valveOpen) {
                    m.state = 'SEPARATION';
                    m.sludge.nextIn = m.params.dischargeInterval * 60;
                }
                break;
            }

            case 'SEPARATION': {
                // 自动排渣
                if (m.mode === 'AUTO' && m.sludge.nextIn <= 0 && m.sludge.tank < 90) {
                    this._startDischarge('auto');
                    break;
                }
                // ALCAP：水分高 → 排水或提前排渣
                const mt = m.faults.transducer ? -1 : m.oil.waterContent;
                if (!m.faults.transducer && mt > m.params.waterTrigger) {
                    const sinceMin = (m.params.dischargeInterval * 60 - m.sludge.nextIn) / 60;
                    if (sinceMin < m.params.minInterval) {
                        m.water.drain = true;
                        m._drainTimer = (m._drainTimer || 0) + dts;
                        if (m._drainTimer > m.params.drainTime) {
                            m.water.drain = false;
                            m._drainTimer = 0;
                            m._drainCount++;
                            if (m._drainCount >= 5) this._raise('A15', 'LO DRAINING FREQUENTLY');
                        }
                    } else {
                        this._startDischarge('alcap');
                    }
                } else {
                    m.water.drain = false;
                    m._drainTimer = 0;
                }
                break;
            }

            case 'DISCHARGE':
                this._solveDischarge(dts);
                break;

            case 'STOPPING':
                this._solveStop(dts);
                break;

            default:
                break;
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
                m.sludge.tank = clamp(m.sludge.tank + 2.5, 0, 100);
                m.sludge.lastTime = m.clock;
                m.sludge.nextIn = m.params.dischargeInterval * 60;
                m._sinceDischarge = 0;
                m._drainCount = 0;
                m.bowl.discharge = 0;
                if (q.resume === 'STANDBY') {
                    m.state = 'STANDBY';
                    m.feed.valveOpen = false;
                } else {
                    m.state = 'SEPARATION';
                    m.feed.valveOpen = true;
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
            m.feed.pumpOn = false;
            m.feed.heaterOn = false;
            m.water.sv10 = m.water.sv15 = m.water.sv16 = m.water.drain = false;
            if (m.bowl.speed < MIN_SPEED) {
                m.bowl.speed = 0;
                m.state = 'STANDSTILL';
                m.bowl.closed = false;
                m.bowl.waterSeal = false;
                m.seq = { name: '', step: 0, t: 0, attempts: 0, feedback: false, resume: '' };
            }
            return;
        }

        switch (q.step) {
            case 0:
                m.feed.valveOpen = false;
                m.feed.pumpOn = false;
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

        // 油温低
        if (m.state === 'SEPARATION' && m.feed.temp < 90) {
            this._lowTempTimer += dts;
            if (m._lowTempTimer > 1.0) {
                this._raise('A05', 'OIL FEED TEMPERATURE - LOW');
                m.feed.valveOpen = false;
                m.feed.heaterOn = true;
            }
            if (m._lowTempTimer > 10) this._tripStop('temp-low');
        } else {
            this._lowTempTimer = 0;
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
