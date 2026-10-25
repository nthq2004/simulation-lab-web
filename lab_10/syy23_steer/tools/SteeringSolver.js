const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const norm180 = (a) => ((a + 540) % 360) - 180;
const wrap360 = (a) => ((a % 360) + 360) % 360;

export class SteeringSolver {
    constructor(sys) {
        this.sys = sys;

        this.m = {
            displayPower: false,
            mainPower: false,
            autoPower: true,
            autoEngaged: false,
            sys: 1,
            standby: false,
            heater: false,

            pump: {
                1: { running: false, started: false, trip: false, current: 0, pressure: 0, oil: 85, temp: 35, power: false, standby: false, local: true, fillOpen: false, drainOpen: false, lowTimer: 0, isoAuto: false },
                2: { running: false, started: false, trip: false, current: 0, pressure: 0, oil: 85, temp: 35, power: false, standby: false, local: true, fillOpen: false, drainOpen: false, lowTimer: 0, isoAuto: false },
            },

            mode: 'manual',
            nfu: 'center',
            nfuTimer: 0,
            nfuActive: false,
            helm: 0,
            helmAngle: 0,
            manualSteer: 0,
            servoPos: 0.5,
            pilotPos: 0,
            localEmergency: false,
            emergencyHold: false,
            valveReady: false,
            solenoidOn: false,

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
            rudderRate: 0.8667,
            rudderLagTau: 0.28,
            yawTau: 6.0,
            autoKp: 1.2,
            autoKi: 0.0,
            autoKd: 8.0,
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
        [1, 2].forEach(n => { if (m.pump[n]) m.pump[n].power = !!on; });
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

    // 单机电源开关（1#/2# 独立）
    setUnitPower(n, on) {
        const m = this.m;
        const p = m.pump[n];
        if (!p) return false;
        p.power = !!on;
        if (!p.power) {
            p.running = false;
            p.started = false;
            p.current = 0;
        }
        m.mainPower = !!(m.pump[1].power || m.pump[2].power);
        if (!m.mainPower) { m.autoPower = false; m.autoEngaged = false; }
        return true;
    }

    toggleUnitPower(n) {
        const p = this.m.pump[n];
        return this.setUnitPower(n, !(p && p.power));
    }

    // 单机备用开关（备用投入后，另一机跳闸时本机自起动）
    toggleUnitStandby(n) {
        const p = this.m.pump[n];
        if (!p) return false;
        p.standby = !p.standby;
        return p.standby;
    }

    // 油箱注油 / 卸油截止阀
    toggleFillValve(n) {
        const p = this.m.pump[n];
        if (!p) return false;
        p.fillOpen = !p.fillOpen;
        return p.fillOpen;
    }

    toggleDrainValve(n) {
        const p = this.m.pump[n];
        if (!p) return false;
        p.drainOpen = !p.drainOpen;
        return p.drainOpen;
    }

    setUnitStandby(n, on) {
        const p = this.m.pump[n];
        if (!p) return false;
        p.standby = !!on;
        return p.standby;
    }

    // 单机机旁/遥控选择：true=机旁（遥控系统不可用）
    setUnitLocal(n, on) {
        const p = this.m.pump[n];
        if (!p) return false;
        p.local = !!on;
        return p.local;
    }

    startPump(n) {
        const m = this.m;
        const p = m.pump[n];
        if (!p || !m.mainPower || p.trip || !p.power) return false;
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
        m.emergencyHold = false;
        if (!m.autoPower) {
            m.autoEngaged = false;
        } else if (m.mode === 'auto') {
            m.autoEngaged = true;
            m.autoInt = 0;
        } else if (m.mode === 'manual') {
            m.autoEngaged = false;
            m.nfuActive = false;
            m.manualSteer = 0;
            m.rudderCmd = clamp(m.helmAngle / 18, -35, 35);
            m.rudderLagCmd = m.rudderCmd;
        }
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
        m.emergencyHold = false;
        m.nfuActive = false;
        m.nfu = 'center';
        m.nfuTimer = 0;
        m.manualSteer = 0;
        if (mode === 'manual') {
            m.rudderCmd = clamp(m.helmAngle / 18, -35, 35);
            m.rudderLagCmd = m.rudderCmd;
        }
        if (mode === 'nfu') this._nfuCmd = m.rudder;
        if (mode === 'auto') m.autoInt = 0;
        if (mode === 'auto') {
            if (!m.faults.autoPower) {
                m.autoPower = true;
                m.autoEngaged = true;
                m.autoInt = 0;
            }
        }
        if (mode !== 'auto') m.autoEngaged = false;
    }

    pressNfu(dir) {
        const m = this.m;
        if (dir !== 'port' && dir !== 'starboard') return;
        m.nfuActive = true;
        m.autoEngaged = false;
        m.nfu = dir;
        m.nfuTimer = 9999;
        m.manualSteer = dir === 'port' ? -1 : 1;
        this._nfuCmd = m.rudder;
    }

    releaseNfu() {
        const m = this.m;
        m.nfuActive = false;
        m.nfu = 'center';
        m.nfuTimer = 0;
        m.manualSteer = 0;
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

    setManualSteer(dir) {
        this.m.manualSteer = dir === -1 ? -1 : (dir === 1 ? 1 : 0);
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
        p.standbyTimer = 0;
        p.lowTimer = 0;
        p.isoAuto = false;
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
            // 备用自起动：另一机故障跳闸后延时 3s 再起动
            const other = m.pump[n === 1 ? 2 : 1];
            const needStandby = !!(other && other.trip && p.standby && p.power && !p.trip && !p.started);
            if (needStandby) {
                p.standbyTimer = (p.standbyTimer || 0) + dt;
                if (p.standbyTimer >= 3) { p.started = true; p.standbyTimer = 0; }
            } else {
                p.standbyTimer = 0;
            }
            p.running = !!(m.mainPower && p.power && p.started && !p.trip);
            let pTarget = p.running ? (leak ? 2.4 : 8.0) : 0;
            p.pressure += (pTarget - p.pressure) * (1 - Math.exp(-dt / 0.55));
            if (p.pressure < 0.02) p.pressure = 0;
            const iTarget = p.running ? (leak ? 31.5 : 42.5) + p.pressure * 0.35 : 0;
            p.current += (iTarget - p.current) * (1 - Math.exp(-dt / 0.4));
            if (!p.running && p.current < 0.1) p.current = 0;
            // 油位：注油阀接通 +10%/min，卸油阀接通 -2%/s；故障漏油按原速率
            let dOil = 0;
            if (p.fillOpen) dOil += (10 / 60) * dt;
            if (p.drainOpen) dOil -= 2 * dt;
            if (leak) dOil -= 0.35 * dt * 20;
            if (!p.fillOpen && !p.drainOpen && !leak) dOil += (85 - p.oil) * (1 - Math.exp(-dt / 2.0));
            p.oil = clamp(p.oil + dOil, 0, 100);

            // 油位极低（<20%）→ 3s 后本机跳闸，并触发另一机组的隔离阀动作
            if (p.oil < 20) {
                p.lowTimer = (p.lowTimer || 0) + dt;
                if (p.lowTimer >= 3) {
                    if (!p.trip) p.trip = true;
                    p.running = false;
                    p.started = false;
                    m.tripReason = `${n}# 油位极低（<20%）自动停机`;
                    const o2 = m.pump[n === 1 ? 2 : 1];
                    if (o2) o2.isoAuto = true;
                }
            } else {
                p.lowTimer = 0;
            }
            // 油温：泵运行时每 3s 升 1℃，停止时每 2s 降 1℃
            p.temp = clamp(p.temp + (p.running ? (1 / 3) : (-1 / 2)) * dt, 35, 85);
        });

        // 指令优先发给当前开关指向的舵机；该机未运行则转给运行中的备用舵机
        const selSys = m.sys;
        const altSys = selSys === 1 ? 2 : 1;
        const usable = (n) => !!(m.pump[n] && m.pump[n].running && !m.pump[n].local);
        let actSys = usable(selSys) ? selSys : (usable(altSys) ? altSys : selSys);
        // 机旁应急操舵优先：正在使用应急开关的机旁机组接管
        const localActive = [1, 2].find(n => m.pump[n] && m.pump[n].local && m.pump[n].running && (m.pump[n].emerg || 0) !== 0);
        if (localActive) actSys = localActive;
        // 机旁应急结束后的伺服回中：仍由原机组执行，直到回中完成
        if (!localActive && m.returnSys) {
            if (Math.abs((m.servoPos ?? 0.5) - 0.5) > 0.005) actSys = m.returnSys;
            else m.returnSys = 0;
        }
        m.remoteAvail = usable(selSys) || usable(altSys);
        m.activeSys = actSys;
        const ap = m.pump[actSys];
        // 机旁应急操舵方向（各机独立）
        const localEmergDir = (ap && ap.local) ? (ap.emerg || 0) : 0;
        const steerDir = localEmergDir !== 0 ? localEmergDir : (m.manualSteer || 0);
        const emergActive = (m.mode === 'nfu') || m.nfuActive || localEmergDir !== 0;
        m.steerDir = steerDir;
        const hydOk = !!(m.mainPower && ap.running && ap.pressure > 3.0);
        const pressFactor = clamp(ap.pressure / 8.0, 0.25, 1.0);

        if (m.emergencyHold && !m.autoPower) {
            m.rudderCmd = m.rudder;
        } else if (emergActive) {
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

        const P = this._params;
        const remoteInhibit = m.autoPower && !m.solenoidOn && !(ap && ap.local);   // 机旁位不受遥控闭锁限制
        if (hydOk) {
            if (!remoteInhibit) {
                let servoTarget;
                if (emergActive) {
                    servoTarget = steerDir > 0 ? 0.75 : (steerDir < 0 ? 0.25 : 0.5);
                } else {
                    const rudderErr = m.rudderCmd - (m.rudderFeedback ?? m.rudder);   // 随动/自动舵使用舵角反馈值
                    servoTarget = clamp(0.5 + clamp(rudderErr / 10, -1, 1) * 0.25, 0.125, 0.875);
                }
                const err = servoTarget - m.servoPos;
                const errAbs = Math.abs(err);
                if (errAbs > 0.005) {
                    const want = err > 0 ? -1 : 1;
                    // 反向滞回：小幅反向不改阀位，避免先导阀来回切换
                    if (m.pilotPos !== 0 && m.pilotPos !== want && errAbs < 0.02) {
                        // 保持原阀位
                    } else {
                        m.pilotPos = want;
                    }
                    const servoStep = 0.0625 * dt;
                    m.servoPos += (err > 0 ? 1 : -1) * Math.min(errAbs, servoStep);
                } else {
                    m.pilotPos = 0;
                }
            }

            if (emergActive) {
                const offset = steerDir ? (m.servoPos - 0.5) : 0;
                const rate = (!remoteInhibit && m.valveReady) ? (offset / 0.25) * P.rudderRate : 0;
                m.rudder = clamp(m.rudder + rate * dt, -35, 35);
                m.rudderRate = rate;
                m.rudderLagCmd = m.rudder;
            } else if (!remoteInhibit && m.valveReady) {
                // 反馈故障时，随动/自动舵按错误反馈闭环，实际舵角停在偏差处
                const cmdEff = clamp(m.rudderCmd - (m.faults.feedback ? 3 : 0), -35, 35);
                m.rudderLagCmd += (cmdEff - m.rudderLagCmd) * (1 - Math.exp(-dt / P.rudderLagTau));
                const rate = P.rudderRate * pressFactor;
                const d = m.rudderLagCmd - m.rudder;
                const step = clamp(d, -rate * dt, rate * dt);
                m.rudder = clamp(m.rudder + step, -35, 35);
                m.rudderRate = step / dt;
            } else {
                m.rudderLagCmd = m.rudder;
                m.rudderRate = 0;
            }
        } else {
            m.pilotPos = 0;
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

        // 舵角反馈装置故障：遥控显示（及随动/自动舵反馈）偏差 3°，机旁显示仍为真实舵角
        m.rudderFeedback = m.faults.feedback ? clamp(m.rudder + 3, -40, 40) : m.rudder;
        m.displayRudder = m.rudderFeedback;

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
