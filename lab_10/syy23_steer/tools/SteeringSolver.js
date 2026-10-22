const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const norm180 = (a) => ((a + 540) % 360) - 180;
const wrap360 = (a) => ((a % 360) + 360) % 360;

export class SteeringSolver {
    constructor(sys) {
        this.sys = sys;

        this.m = {
            displayPower: false,
            mainPower: false,
            autoPower: false,
            autoEngaged: false,
            sys: 1,
            standby: false,
            heater: false,

            pump: {
                1: { running: false, started: false, trip: false, current: 0, pressure: 0, oil: 85, temp: 35 },
                2: { running: false, started: false, trip: false, current: 0, pressure: 0, oil: 85, temp: 35 },
            },

            mode: 'manual',
            nfu: 'center',
            nfuTimer: 0,
            helm: 0,
            helmAngle: 0,

            rudder: 0,
            rudderCmd: 0,
            rudderLagCmd: 0,
            displayRudder: 0,
            rudderRate: 0,
            autoInt: 0,

            heading: 0,
            headingSet: 0,
            speed: 16.1,
            yawRate: 0,

            windForce: 3.0,
            windDir: 0,
            ambient: 30.0,
            seaWater: 23.5,

            engine: {
                rpm: 58.0,
                fuelIndex: 39.8,
                load: 33.5,
                power: 21270.3,
                torque: 2999.5,
                fuelRate: 166.6,
            },
            propeller: {
                thrust: 7506.8,
                hullDrag: 7507.7,
                torque: 2988.5,
            },

            alarms: {
                power: false,
                hydLow: false,
                pumpTrip: false,
                autoOff: false,
                feedback: false,
            },
            alarmText: '',

            faults: {
                pump1Trip: false,
                pump2Trip: false,
                hydLeak: false,
                feedback: false,
                autoPower: false,
            },

            tripReason: '',
            resetPulse: false,
        };

        this._params = {
            rudderRate: 2.6,
            rudderLagTau: 0.28,
            yawTau: 6.0,
            autoKp: 2.1,
            autoKi: 0.006,
            autoKd: 1.0,
        };

        this._nfuCmd = 0;
        this._lastMode = 'manual';
    }

    get activePump() {
        return this.m.pump[this.m.sys];
    }

    setDisplayPower(on) {
        this.m.displayPower = !!on;
    }

    toggleDisplayPower() {
        this.setDisplayPower(!this.m.displayPower);
    }

    setMainPower(on) {
        const m = this.m;
        m.mainPower = !!on;
        if (!m.mainPower) {
            [1, 2].forEach(n => {
                m.pump[n].running = false;
                m.pump[n].started = false;
                m.pump[n].current = 0;
            });
            m.autoPower = false;
            m.autoEngaged = false;
        }
    }

    toggleMainPower() {
        this.setMainPower(!this.m.mainPower);
    }

    startPump(n) {
        const m = this.m;
        const p = m.pump[n];
        if (!p || !m.mainPower || p.trip) return false;
        p.started = true;
        p.running = true;
        return true;
    }

    stopPump(n) {
        const m = this.m;
        const p = m.pump[n];
        if (!p) return false;
        p.started = false;
        p.running = false;
        return true;
    }

    selectSystem(n) {
        n = Number(n) === 2 ? 2 : 1;
        this.m.sys = n;
        this._nfuCmd = this.m.rudder;
    }

    setAutoPower(on) {
        const m = this.m;
        if (m.faults.autoPower && on) return false;
        m.autoPower = !!on;
        if (!m.autoPower) m.autoEngaged = false;
        return true;
    }

    toggleAutoPower() {
        return this.setAutoPower(!this.m.autoPower);
    }

    setAutoEngaged(on) {
        const m = this.m;
        if (on && (!m.autoPower || m.faults.autoPower)) return false;
        m.autoEngaged = !!on;
        if (m.autoEngaged) {
            m.mode = 'auto';
            m.nfu = 'center';
            m.nfuTimer = 0;
            m.autoInt = 0;
        }
        return true;
    }

    toggleAutoEngaged() {
        return this.setAutoEngaged(!this.m.autoEngaged);
    }

    setMode(mode) {
        const m = this.m;
        if (!['auto', 'manual', 'nfu'].includes(mode)) return;
        m.mode = mode;
        m.nfu = 'center';
        m.nfuTimer = 0;
        if (mode === 'nfu') this._nfuCmd = m.rudder;
        if (mode === 'auto') m.autoInt = 0;
        if (mode === 'auto' && m.autoPower && !m.faults.autoPower) m.autoEngaged = true;
        if (mode !== 'auto') m.autoEngaged = false;
    }

    pressNfu(dir) {
        const m = this.m;
        if (dir !== 'port' && dir !== 'starboard') return;
        m.mode = 'nfu';
        m.autoEngaged = false;
        m.nfu = dir;
        m.nfuTimer = 9999;
        this._nfuCmd = m.rudder;
    }

    releaseNfu() {
        const m = this.m;
        m.nfu = 'center';
        m.nfuTimer = 0;
        if (m.mode === 'nfu') m.rudderCmd = m.rudder;
    }

    setHeading(v) {
        this.m.headingSet = clamp(Number(v) || 0, -90, 90);
        this.m.autoInt = 0;
    }

    nudgeHeading(d) {
        this.setHeading(this.m.headingSet + d);
    }

    setWheelAngle(deg) {
        const m = this.m;
        m.helmAngle = Number(deg) || 0;
        m.helm = clamp(m.helmAngle / 630, -1, 1);
        if (m.mode === 'manual') m.rudderCmd = clamp(m.helmAngle / 18, -35, 35);
    }

    rotateWheelBy(deg) {
        this.setWheelAngle(this.m.helmAngle + (Number(deg) || 0));
    }

    setHelm(v) {
        this.setWheelAngle(clamp(Number(v) || 0, -1, 1) * 630);
    }

    nudgeHelm(d) {
        this.rotateWheelBy((Number(d) || 0) * 630);
    }

    centerHelm() {
        this.setWheelAngle(0);
    }

    setNfu(dir) {
        const m = this.m;
        if (!['port', 'center', 'starboard'].includes(dir)) return;
        m.nfu = dir;
        m.nfuTimer = dir === 'center' ? 0 : 1.6;
        if (dir !== 'center') this._nfuCmd = m.rudder;
    }

    setStandby(on) { this.m.standby = !!on; }
    toggleStandby() { this.m.standby = !this.m.standby; }
    setHeater(on) { this.m.heater = !!on; }
    toggleHeater() { this.m.heater = !this.m.heater; }

    tripPump(n) {
        const p = this.m.pump[n];
        if (!p) return;
        p.trip = true;
        p.running = false;
        p.started = false;
        this.m.tripReason = `${n}# 液压泵过载跳闸`;
    }

    resetPump(n) {
        const p = this.m.pump[n];
        if (!p) return;
        p.trip = false;
        p.running = false;
        p.started = false;
        if (n === 1) this.m.faults.pump1Trip = false;
        if (n === 2) this.m.faults.pump2Trip = false;
        this.m.tripReason = '';
    }

    solve(dt) {
        const m = this.m;
        dt = clamp(dt || 0.05, 0.001, 0.2);

        if (m.resetPulse) {
            m.resetPulse = false;
        }

        if (m.faults.pump1Trip) this.tripPump(1);
        if (m.faults.pump2Trip) this.tripPump(2);

        if (m.faults.autoPower) {
            m.autoPower = false;
            m.autoEngaged = false;
        }

        const leak = !!m.faults.hydLeak;

        [1, 2].forEach(n => {
            const p = m.pump[n];
            p.running = !!(m.mainPower && p.started && !p.trip);
            let pTarget = p.running ? (leak ? 2.4 : 8.0) : 0;
            p.pressure += (pTarget - p.pressure) * (1 - Math.exp(-dt / 0.55));
            if (p.pressure < 0.02) p.pressure = 0;
            const iTarget = p.running ? (leak ? 31.5 : 42.5) + p.pressure * 0.35 : 0;
            p.current += (iTarget - p.current) * (1 - Math.exp(-dt / 0.4));
            if (!p.running && p.current < 0.1) p.current = 0;
            const oilTarget = leak ? Math.max(12, p.oil - 0.35 * dt * 20) : 85;
            p.oil += (oilTarget - p.oil) * (1 - Math.exp(-dt / 2.0));
            p.temp += ((p.running ? 52 : 35) - p.temp) * (1 - Math.exp(-dt / 6));
        });

        const ap = m.pump[m.sys];
        const hydOk = !!(m.mainPower && ap.running && ap.pressure > 3.0);
        const pressFactor = clamp(ap.pressure / 8.0, 0.25, 1.0);

        if (m.mode === 'nfu') {
            if (m.nfuTimer > 0) {
                m.nfuTimer = Math.max(0, m.nfuTimer - dt);
                if (hydOk) {
                    const dir = m.nfu === 'starboard' ? 1 : (m.nfu === 'port' ? -1 : 0);
                    this._nfuCmd = clamp(this._nfuCmd + dir * 5.2 * dt * pressFactor, -35, 35);
                }
                m.rudderCmd = this._nfuCmd;
            } else {
                m.nfu = 'center';
                m.rudderCmd = m.rudder;
            }
        } else if (m.mode === 'manual') {
            m.rudderCmd = clamp(m.helmAngle / 18, -35, 35);
            m.helm = clamp(m.helmAngle / 630, -1, 1);
        } else if (m.mode === 'auto') {
            if (m.autoPower && m.autoEngaged && hydOk) {
                const P = this._params;
                const err = norm180(m.headingSet - m.heading);
                m.autoInt = clamp(m.autoInt + err * dt, -320, 320);
                const cmd = err * P.autoKp - m.yawRate * P.autoKd + m.autoInt * P.autoKi;
                m.rudderCmd = clamp(cmd, -35, 35);
            } else {
                m.autoInt = 0;
                m.rudderCmd = m.rudder;
            }
        } else {
            m.autoInt = 0;
        }

        if (hydOk) {
            const P = this._params;
            m.rudderLagCmd += (m.rudderCmd - m.rudderLagCmd) * (1 - Math.exp(-dt / P.rudderLagTau));
            const rate = P.rudderRate * pressFactor;
            const d = m.rudderLagCmd - m.rudder;
            const step = clamp(d, -rate * dt, rate * dt);
            m.rudder = clamp(m.rudder + step, -40, 40);
            m.rudderRate = step / dt;
        } else {
            m.rudderLagCmd = m.rudder;
            m.rudderRate = 0;
        }

        if (m.mode !== 'nfu' && m.mode !== 'manual') {
            this._nfuCmd = m.rudder;
        }

        const speedFactor = clamp(m.speed / 16.1, 0.3, 1.4);
        const windYaw = (m.windForce / 100) * Math.sin((m.windDir - m.heading) * Math.PI / 180);
        const yawTarget = hydOk ? (m.rudder / 35) * 2.3 * speedFactor + windYaw : windYaw * 0.4;
        m.yawRate += (yawTarget - m.yawRate) * (1 - Math.exp(-dt / this._params.yawTau));
        m.heading = wrap360(m.heading + m.yawRate * dt);

        m.displayRudder = m.faults.feedback ? clamp(m.rudder + 18, -45, 45) : m.rudder;

        const loadBias = Math.abs(m.rudder) * 0.10;
        m.engine.rpm = 58.0 + (m.speed - 16.1) * 0.8 + loadBias * 0.35;
        m.engine.fuelIndex = 39.8 + loadBias * 0.9;
        m.engine.load = 33.5 + loadBias;
        m.engine.power = 21270.3 + loadBias * 120;
        m.engine.torque = 2999.5 + loadBias * 16;
        m.engine.fuelRate = 166.6 + loadBias * 0.6;

        m.propeller.thrust = 7506.8 + loadBias * 8;
        m.propeller.hullDrag = 7507.7 + loadBias * 7;
        m.propeller.torque = 2988.5 + loadBias * 5;

        const a = m.alarms;
        a.power = !m.mainPower;
        a.hydLow = !!(m.mainPower && (!ap.running || ap.pressure <= 3.0));
        a.pumpTrip = !!(m.pump[1].trip || m.pump[2].trip);
        a.autoOff = !!(m.mode === 'auto' && (!m.autoPower || !m.autoEngaged || m.faults.autoPower));
        a.feedback = !!m.faults.feedback;

        if (a.pumpTrip) m.alarmText = m.tripReason || '液压泵过载跳闸';
        else if (a.hydLow) m.alarmText = leak ? '液压系统失压（泄漏）' : '液压系统压力低';
        else if (a.autoOff) m.alarmText = '自动舵未投入 / 电源断开';
        else if (a.feedback) m.alarmText = '舵角反馈信号异常';
        else m.alarmText = '';

        if (this._lastMode !== m.mode) {
            this._lastMode = m.mode;
            if (m.mode === 'nfu') this._nfuCmd = m.rudder;
        }
    }
}

export default SteeringSolver;
