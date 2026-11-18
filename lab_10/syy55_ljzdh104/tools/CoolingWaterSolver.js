/**
 * CoolingWaterSolver — 船舶主机高温冷却水（缸套淡水）温度控制过程模型
 * ═══════════════════════════════════════════════════════════════════════════
 *  依据「冷却水系统图.png / 船舶冷却水系统MIMIC图.svg」：
 *
 *   主机（缸套 + 柴油机机体）—— 缸套淡水出口 T 84.2 ℃ —— TT 温度变送器 —— 回流总管
 *     ├─ WB-V25S → 主机缸套水加热器（锅炉蒸汽 g 191.5）→ WB-V27S ──┐
 *     ├─ WB-V7S   → 造水机（34，用缸套水加热海水）→ WB-V6S ──────────┼→ 总管
 *     └─ 旁通 ────────────────────────────────────────────────────┘
 *   总管 ── 1#/2# 高温冷却淡水泵（起动 / 停止按钮）—— 排出侧 P 2.1 bar
 *     ├─ 高温淡水冷却器（海水侧 31，淡水 T 85 → 55.3 ℃）
 *     └─ WB-V502 → WB-V12S / WB-V13S 调节支路（除气柜旁）
 *          → 除气柜 ── 膨胀水柜（日用淡水 35 补水，L 78 %）—— 吸入侧 P 3.8 bar → 主机
 *
 *  控制（面板 LDCL 状态 / TEMP / Ctrl）：
 *   · TEMP = TC 实测的缸套水出口温度；Ctrl = 0~100 %，即**三通调节阀的冷却口开度**
 *     （0 % = 全部旁通冷却器 → 最热；100 % = 全部经高温淡水冷却器 → 最冷）。
 *   · TEMP 行 AUTO：PI 调节（死区 0.4 ℃、积分分离），把出口温度调回设定值 T；
 *     MANU：由面板 ▲ / ▼ 手动给定开度。
 *   · LDCL 状态 Automatic / Manual：Manual 时回路按手动给定值保持（切除自动调节）。
 *   · 报警：A 11 缸套水温度高、A 12 缸套水温度低、A 21 冷却水泵出口压力低、
 *     A 31 膨胀水柜液位低；持续 3 s 才确认（TRIP 灯闪烁 → 常亮，复位后消除）。
 *   · 联锁：两台冷却泵全停 / 出口压力低于 0.3 bar 持续 5 s → 水流开关 PS 断开 →
 *     主机保护停机（柴油机自动停车，转动件动画停止）。
 *
 *  ⚠ 本模型只做教学级仿真：温度用一阶热平衡推进（温升/温降按 accel 加速），
 *    压力/流量按泵起停速率建立与消失，报警带确认延时。
 * ═══════════════════════════════════════════════════════════════════════════
 */

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** 向目标值逼近（每秒最多变化 rate） */
function approach(cur, target, dt, rate) {
    const d = target - cur;
    const step = rate * dt;
    if (Math.abs(d) <= step) return target;
    return cur + Math.sign(d) * step;
}

/** 颜色插值（0 → 白，1 → 目标色） */
export function blendColor(a, b, t) {
    t = clamp(t, 0, 1);
    return `rgb(${Math.round(a[0] + (b[0] - a[0]) * t)},${Math.round(a[1] + (b[1] - a[1]) * t)},${Math.round(a[2] + (b[2] - a[2]) * t)})`;
}

/** 水温 → 管段颜色（30 ℃ 浅蓝 → 85 ℃ 橙红） */
export function tempColor(t) {
    return blendColor([150, 218, 246], [235, 120, 52], (t - 30) / 55);
}

/** 水泵方式档位（与水泵面板"方式"旋钮一致） */
export const PUMP_MODES = ['MAN', 'STOP', 'AUTO'];
export const PUMP_MODE_CN = { MAN: '手动', STOP: '停止', AUTO: '自动' };

/** 报警编码表 */
export const CW_ALARMS = {
    A10: { text: '缸套水温度高高', kind: 'high' },
    A11: { text: '缸套水温度高', kind: 'high' },
    A12: { text: '缸套水温度低', kind: 'low' },
    A21: { text: '冷却水泵出口压力低', kind: 'pressure' },
    A31: { text: '膨胀水柜液位低', kind: 'level' },
};

/** 默认参数（与面板默认显示一致：SET = 85.0 ℃、P = 6.0 ℃、Ti = 40 s） */
export const CW_DEFAULTS = {
    setTemp: 85.0,
    bandP: 6.0,
    ti: 40,
    deadband: 0.4,
};

const U_MIN = 2, U_MAX = 98;   // 三通阀冷却口开度限幅（%）

function mkPump(id, name) {
    return {
        id, name,
        mode: 'STOP',          // MAN / STOP / AUTO（水泵面板方式旋钮）
        manRun: false,         // 手动方式下的"起动"指令（MAN 方式本身不起泵）
        run: false,
        stopping: false,       // 旋钮打 STOP 引起的停泵（联锁不会自动重起）
        stopReason: '',
        current: 0,
        runTime: 0,
        aux: false,
    };
}

function createModel() {
    return {
        clock: 0,
        panelMain: true,       // 水泵面板主电源
        mode: 'MANU',          // LDCL 状态：默认手动（MANU）；需人工/AUTO 投入才自动调节

        // ── 手动阀门：true = 打开 ──
        sw: {
            wbV25S: true, wbV27S: false,   // 缸套水加热器 进 / 出
            wbV6S: true, wbV7S: false,     // 造水机 进 / 出
            wbV4: false,                   // 缸套水至污水井（放水阀，默认关）
            wbV5: true,                    // 主管进泵截止阀（图 WB-V5）
            wbV8: true, wbV9: true,        // 1# / 2# 泵吸入阀（图 WB-V8 / WB-V9）
            wbV15S: true,                  // 膨胀水柜至吸入总管截止阀（图 WB-V15S）
            wbV502: true, wbV12S: true,    // 冷却器支路 / 旁通支路的调节阀手动截止阀
            wbV13S: true,                  // 除气柜入口截止阀
            wbV26S: false,                 // 系统至污水井（最低位放水阀，默认关）
        },

        // ── 报警限（可在 LDCL 面板 菜单 → ALARM 组设定）──
        alarmLim: { HH: 98, H: 95, L: 55 },   // ℃：温度高高 / 温度高 / 温度低

        // ── 温度控制回路 ──
        setTemp: CW_DEFAULTS.setTemp,
        bandP: CW_DEFAULTS.bandP,
        ti: CW_DEFAULTS.ti,
        deadband: CW_DEFAULTS.deadband,
        temp: 60,              // 主机缸套水出口温度（系统初始化温度 60 ℃）
        tcMeas: 60,            // TT 测量值（一阶滞后）
        manip: 0,              // 冷却口实际开度（阀位）：初始 0 %（全旁通）
        outCmd: 0,             // PID 调节器输出（指令值），初始 0 %
        integral: 0,           // 积分项
        manualOut: 0,          // 手动给定开度（冷却口开度），初始 0 %
        tempCtrl: 'AUTO',      // TEMP 行控制方式：AUTO / MANU
        held: false,           // 积分分离标志
        loadNom: null,         // 运行时自动学习到的"设计负荷"（使前馈与当前热平衡匹配）

        // ── 泵 / 压力 / 流量 ──
        pumps: { cw1: mkPump('cw1', '1 号高温冷却淡水泵'), cw2: mkPump('cw2', '2 号高温冷却淡水泵') },
        psUp: false,           // 水流开关 PS
        autoTimer: 0,          // PS 低压力延时计时（s）：累计 3 s 发出自动起动信号
        autoLead: null,        // 自动方式下被选定为运行机组（另一台备用）
        pressIn: 0,            // 吸入侧压力 bar（P 3.8）
        pressOut: 0,           // 排出侧压力 bar（P 2.1）
        flow: 0,               // 冷却水流量 m³/h

        // ── 边界条件（演示/工作流可调）──
        load: 50,              // 主机负荷 %（柴油机起动默认 50 %，可由控制盒旋钮调节 0~110）
        engineSw: false,       // 柴油机起停开关位置（默认停车位）
        engineOn: false,       // 柴油机实际运转（开关在运行位且起动联锁允许）
        seaTemp: 28,           // 海水温度 ℃
        heatherOn: false,      // 缸套水加热器（蒸汽）投入
        steamPress: 0,         // 加热器蒸汽压力 bar（图 g 191.5）
        freshOn: true,         // 日用淡水（35）补水
        tank: 78,              // 膨胀水柜液位 %（图 L 78.0）

        // ── 时间常数（s，教学已加速）──
        tauSensor: 6,
        pumpRate: 0.22,

        alarmCfg: {
            A10: { en: true, delay: 3 },
            A11: { en: true, delay: 3 },
            A12: { en: true, delay: 3 },
            A21: { en: true, delay: 3 },
            A31: { en: true, delay: 3 },
        },
        alarms: [],
        alarmActive: false,

        // ── 故障 ──
        faults: {
            controller: false,   // LDCL 控制器故障：自动方式固定输出 45 %，面板读数显示 ***
            tt: false,           // TT 温度变送器故障：读数失效，自动控制切除
            valve: false,        // 冷却水调节阀卡涩：执行机构不动作
            pump1: false,
            pump2: false,
            leak: false,         // 膨胀水柜泄漏：液位迅速下降
        },

        tripped: false,          // 主机保护停机
        tripCause: '',
        t: {},                   // 定时器集合
    };
}

export class CoolingWaterSolver {
    constructor(sys) {
        this.sys = sys;
        this.cfg = {
            accel: 20,          // 温升 / 温降加速倍数（教学用；1 = 真实比例）
            timeScale: 1,
        };
        this.m = createModel();
        this._initAlarms();
    }

    _tip(msg) {
        if (this.sys && typeof this.sys._tipPurifier === 'function') this.sys._tipPurifier(msg);
    }

    _initAlarms() {
        const m = this.m;
        m.alarms = Object.keys(CW_ALARMS).map(code => ({
            code, text: CW_ALARMS[code].text, kind: CW_ALARMS[code].kind,
            active: false, ack: true, timer: 0,
        }));
    }

    // ═══════════════════════════════════════════════════════════
    //  过程求解（20 fps，dt ≈ 0.05 s）
    // ═══════════════════════════════════════════════════════════
    solve(dt) {
        const m = this.m;
        const dts = (dt || 0.05) * (this.cfg.timeScale || 1);
        m.clock += dts;
        const acc = this.cfg.accel || 1;

        // ── 0a. 柴油机起停与起动联锁：开关在运行位但 PS 断开时不起动，压力建立后自动起动 ──
        if (!m.engineSw) {
            if (m.engineOn) { m.engineOn = false; }
        } else if (!m.engineOn && !m.tripped && m.psUp) {
            m.engineOn = true;
            m.load = 50;
            this._tip('柴油机：起动运转（负荷 50 %）');
        }

        // ── 0. PS 低压力 → 延时 3 s → 自动起动信号 ──
        //   信号只在"方式旋钮打在 AUTO（且无故障）"的机组中派发：
        //   派给一台作运行机组，另一台保持备用；运行机组故障后压力再次跌落，
        //   延时 3 s 后信号自动转派给备用机组。
        const pumpFaulted = (id) => (id === 'cw1' ? m.faults.pump1 : m.faults.pump2);
        // 自动起动候选：本泵方式旋钮在 AUTO 且无故障（与温度调节器的 A/M 无关）
        const autoPool = ['cw1', 'cw2'].filter(id => m.pumps[id].mode === 'AUTO' && !pumpFaulted(id));
        if (!m.psUp && autoPool.length) {
            m.autoTimer += dts;
            if (m.autoTimer >= 3) {
                const leadAlive = m.autoLead && autoPool.includes(m.autoLead)
                    && m.pumps[m.autoLead].run
                    && (m.autoLead === 'cw1' ? m.sw.wbV8 !== false : m.sw.wbV9 !== false);
                if (!leadAlive) {
                    const idle = autoPool.filter(id => !m.pumps[id].run);
                    const pick = idle[0] || autoPool[0];
                    if (pick && pick !== m.autoLead) {
                        m.autoLead = pick;
                        this._tip(`PS 压力低延时 3 s：自动起动${m.pumps[pick].name}`
                            + (autoPool.length > 1 ? '（另一台自动备用）' : ''));
                    } else {
                        m.autoLead = pick;
                    }
                }
            }
        } else if (m.psUp) {
            m.autoTimer = 0;
        }

        // ── 1. 泵：方式旋钮 + 自动/备用 + 故障决定运行 ──
        Object.values(m.pumps).forEach(p => {
            const faulted = pumpFaulted(p.id);
            // 水泵自动方式只由本泵方式旋钮与 PS 自动起动逻辑决定，与温度调节器的 A/M 无关
            const wantAuto = p.mode === 'AUTO' && m.autoLead === p.id;
            const wantMan = p.mode === 'MAN' && !!p.manRun;     // 手动方式下按"起动"才运转
            const shouldRun = !faulted && (wantMan || wantAuto);
            if (shouldRun) {
                if (!p.run) { p.run = true; p.stopping = false; p.stopReason = ''; }
            } else if (p.run) {
                p.run = false;
                p.stopping = p.mode === 'MAN' && !p.manRun;
                p.stopReason = faulted ? '电机故障'
                    : (p.mode === 'MAN' ? '按下停止按钮' : (p.mode === 'AUTO' ? '自动方式下未选为运行机组' : ''));
            }
            p.current = p.run ? 18.5 : 0;
            if (p.run) p.runTime += dts;
            p.aux = Object.values(m.pumps).some(q => q.run);
        });
        // 只有"运行中且吸入阀打开"的泵才真正出力
        const supOpen = (id) => (id === 'cw1' ? m.sw.wbV8 !== false : m.sw.wbV9 !== false);
        const delivers = (id) => !!m.pumps[id].run && supOpen(id);
        const running = ['cw1', 'cw2'].filter(delivers).length;

        // ── 2. 压力 / 流量 ──
        // 运行泵的吸入阀关闭时，出力立即消失 → 排出压力快速下降 → PS 动作
        m.pressOut = approach(m.pressOut, running ? (running > 1 ? 2.25 : 2.05) : 0.02, dts, m.pumpRate * 14);
        m.pressIn = approach(m.pressIn, running ? 3.8 : 0.15, dts, m.pumpRate * 10);
        m.flow = approach(m.flow, running ? (running > 1 ? 46 : 41) : 0, dts, m.pumpRate * 60);
        // 水流开关：泵出口压力建立，且吸入侧手动阀门（WB-V502/V12S/V13S/V15S、泵吸入阀）确实打开
        // 泵吸入通路：只需除气柜进口截止阀 + 至少一台泵的吸入阀；
        // 冷却器支路阀（WB-V502/V12S）、水柜出口（WB-V15S）属支路，关闭不影响泵吸入
        const suctionOk = !!(m.sw.wbV13S && (m.sw.wbV8 || m.sw.wbV9));
        m.psUp = m.pressOut > 0.8 && m.flow > 5 && suctionOk;

        // ── 3. 调节阀执行机构 ──
        const valveBlocked = !m.sw.wbV502 || !m.sw.wbV12S || m.faults.valve;
        const uTarget = this._ctrlTarget();
        m.outCmd = m.engineOn ? clamp(uTarget, U_MIN, U_MAX) : 0;    // 调节器输出（指令）
        if (!m.engineOn) {
            // 柴油机未起动：无热源，PID 调节器不投入运行（方式仍可切到 AUTO），冷却口保持 0 %
            m.manip = approach(m.manip, 0, dts, 14);
        } else if (!m.faults.valve) {
            // 阀位跟随指令（手动阀全关时执行机构同样失去动力）
            const tgt = (!m.sw.wbV502 || !m.sw.wbV12S) ? m.manip : m.outCmd;
            m.manip = approach(m.manip, tgt, dts, 14);   // 约 7 s 走完行程
        }
        // 调节阀卡涩：阀位保持不动（m.manip 不变），但 PID 输出 outCmd 仍按调节规律变化

        // ── 4. 热平衡（一阶集总模型）──
        const flowFrac = m.psUp ? clamp(m.flow / 41, 0, 1) : 0;
        const cool = clamp(m.manip / 100, 0, 1);        // 冷却口开度（Ctrl）
        const eff = cool * flowFrac;                    // 经高温淡水冷却器的有效流量比例
        const load = clamp(m.load, 0, 110) / 100;

        // (a) 主机能量平衡（教学简化）：
        //     dT/dt = q − (T − 冷却水温)·k·eff − (T − 海水温)·k·(1 − eff)
        //   · eff = 1（全经冷却器）→ 冷却水温（柜温），带走量大，温度低；
        //   · eff = 0（冷却口全关 = 全旁通）→ 只能经缸壁向海水散热，带走量小，温度高；
        //   · 两种散热的稳态增益相差约 5 倍，使 85 ℃ 工况下"Ctrl 变化 1 % ≈ 温度变化 0.3 ℃"。
        this._syncHeat();
        const q = m.engineOn ? this._q : 0;          // 柴油机停车 → 无热源
        const tCoolIn = m.seaTemp + 8;                       // 冷却器出口（LTFW 冷却后）淡水温度
        // 旁通混合后的回水温度（进机水温）：必须低于机出口温度
        const tReturn = Math.min(eff * tCoolIn + (1 - eff) * m.temp, m.temp - 0.3);
        const dCool = Math.max(0, m.temp - tReturn) * this._k * 9 * flowFrac;   // 经冷却器带走（冷却口越大带走越多）
        const dDiss = Math.max(0, m.temp - m.seaTemp) * this._k * 0.9;          // 机体 / 柜壁向海水散热（很小）
        let dTdt = (q * 0.5 - (dCool + dDiss) / 0.425 * 0.5) * acc;
        if (m.tripped) dTdt -= this._q * 0.9 * acc;
        // (b) 缸套水加热器（蒸汽 g 191.5）：蒸汽阀开时按预热 / 保温量投入（出水约 90 ℃）
        if (m.sw.wbV25S) {
            const hOut = m.heatherOn ? 90 + 2 * clamp(m.steamPress / 4, 0, 1) : 88.5;
            dTdt += (hOut - m.temp) * (m.heatherOn ? 0.12 : 0.05) * acc;
        }
        // (c) 造水机：用缸套水加热海水（取走热量，出水约 83 ℃）
        if (m.sw.wbV6S && m.sw.wbV7S) dTdt += (83 - m.temp) * 0.10 * flowFrac * acc;
        // (e) 冷却水泵全停：没有强制循环，管路与主机内的水几乎静止
        if (!m.psUp) {
            // 不流动：柴油机运转时缸内蓄热使水温缓慢上升；停车时缓慢冷下来
            dTdt = m.engineOn ? (0.012 + 0.025 * clamp((m.load || 0) / 64, 0.3, 1.6)) : -0.003;
            if (m.heatherOn && m.sw.wbV25S) dTdt += (92 - m.temp) * 0.02;
        }
        m.temp = clamp(m.temp + dTdt * dts, 20, 135);

        // 高温膨胀水柜（进机水温）：缸套水在柜内混合，一阶跟随（时间常数约 2 min ≈ 大热容）
        if (m.tankT == null) m.tankT = m.temp;
        const tauTank = 120 / Math.max(1, acc);
        if (!m.psUp) m.tankT += (m.temp - m.tankT) * clamp(dts / 60, 0, 1);
        else m.tankT += (tReturn - m.tankT) * clamp(dts / tauTank, 0, 1);
        // TT 一阶滞后 + 坏值
        m.tcMeas += (m.temp - m.tcMeas) * clamp(dts / m.tauSensor, 0, 1);
        const tcVal = m.faults.tt ? NaN : m.tcMeas;

        // ── 5. 主机保护（水流开关 PS 断开 20 s → 主机停车；柴油机停机时不触发）──
        if (m.psUp) {
            m.t.trip = 0;
            if (m.tripped) {
                m.tripped = false;
                if (this.sys && typeof this.sys.coolingHostTrip === 'function') this.sys.coolingHostTrip(false);
            }
        } else if (!m.engineOn) {
            m.t.trip = 0;          // 柴油机已停机：只停止计时，跳闸标志保持到 PS 恢复
        } else {
            m.t.trip = (m.t.trip || 0) + dts;
            if (m.pressOut < 0.3 && m.t.trip > 20 && !m.tripped) {
                m.tripped = true;
                m.engineOn = false;
                m.tripCause = (m.faults.pump1 && m.faults.pump2) ? '两台冷却泵电机故障' : '冷却水压力低（水流开关 PS 断开）';
                this._tip(`🚨 主机保护：${m.tripCause}，柴油机自动停车`);
                if (this.sys && typeof this.sys.coolingHostTrip === 'function') this.sys.coolingHostTrip(true);
            }
        }

        // ── 6. 膨胀水柜液位 ──
        if (m.faults.leak) m.tank -= 0.6 * dts;
        else if (m.freshOn) m.tank = approach(m.tank, 78, dts, 0.12);
        else m.tank -= 0.03 * dts;
        m.tank = clamp(m.tank, 0, 100);

        // ── 7. 报警（3 s 确认；故障消失后自动回位）──
        const LL = m.alarmLim || { HH: 98, H: 95, L: 55 };
        const cond = {
            A10: Number.isFinite(tcVal) && tcVal > LL.HH,   // 温度高高
            A11: Number.isFinite(tcVal) && tcVal > LL.H,    // 温度高
            A12: Number.isFinite(tcVal) && tcVal < LL.L,    // 温度低
            A21: !!(m.pumps.cw1.run || m.pumps.cw2.run) && m.pressOut < 1.8,
            A31: m.tank < 20,
        };
        m.alarms.forEach(a => {
            const c = m.alarmCfg[a.code];
            if (c.en && cond[a.code]) {
                a.timer += dts;
                if (a.timer >= c.delay && !a.active) { a.active = true; a.ack = false; }
            } else {
                a.timer = 0;
                if (a.active) { a.active = false; a.ack = true; }
            }
        });
        m.alarmActive = m.alarms.some(a => a.active);
        return m;
    }

    /**
     * 热平衡参数整定：按当前负荷求"主机热源 q"与"冷却器传热系数 k"，使
     * 额定负荷 N 64 下"冷却口开度 70 % → 缸套水 85 ℃"（冷却器课题的设计工况），
     * 且负荷改变时操作灵敏度保持在合理范围（0.4~0.8 ℃/%）。
     */
    _syncHeat() {
        const m = this.m;
        const sea = m.seaTemp;
        const tCoolIn = sea + 8;                               // 冷却器出口（LTFW 冷却后）淡水温度
        // 设计工况：100 % 负荷 + 冷却口 98 %（限幅上限）→ 稳定 85 ℃
        const qR = 0.40;                                       // 100 % 负荷时的热源 ℃/s
        const effD = 0.98;
        // 稳态：qR = [ effD·(85 − tCoolIn)·9 + (85 − sea)·0.9 ]·k / 0.425
        //   k 只按设计工况整定一次，不随负荷变化
        const k = (qR * 0.425) / (effD * (85 - tCoolIn) * 9 + (85 - sea) * 0.9);
        this._qR = qR;
        this._k = clamp(k, 1e-6, 10);
        // 当前负荷下的热源：q ∝ (负荷/100)^1.322
        //   标定结果：80 % 负荷时约 70 % 开度维持 85 ℃；>100 % 负荷时冷却口全开温度仍上升
        const Lf = Math.max(0, clamp(m.load || 0, 0, 130)) / 100;
        this._q = qR * Math.pow(Lf, 1.322);
    }

    /** TT（温度变送器）显示值：正常情况下为实测值；变送器故障返回 NaN（面板显示 ***） */
    showValue() {
        const m = this.m;
        return m.faults.tt ? NaN : m.tcMeas;
    }

    /** 膨胀水柜（进机）温度显示值 */
    tankTemp() {
        const m = this.m;
        return clamp(m.tankT == null ? m.temp + 8 : m.tankT, 20, 130);
    }

    /** 高温淡水冷却器出口温度（图上 T 55.3 ℃） */
    coolerOut() {
        const m = this.m;
        if (!m.psUp) return m.seaTemp + 2;
        return clamp(m.seaTemp + 6 + (m.temp - m.seaTemp - 6) * (1 - clamp(m.manip / 100, 0, 1)) * 0.75, m.seaTemp + 2, m.temp - 1);
    }

    /** 计算操作量目标（Ctrl，%）—— AUTO：PI + 负荷前馈；MANU：手动给定 */
    _ctrlTarget() {
        const m = this.m;
        this._syncHeat();                                        // 无论何种方式都先整定热平衡参数
        if (m.mode !== 'AUTO' || m.tempCtrl === 'MANU' || m.faults.tt) {
            return clamp(m.manualOut == null ? m.manip : m.manualOut, U_MIN, U_MAX);
        }
        if (m.faults.controller) return 45;                 // 控制器故障：固定输出
        const sp = m.setTemp;
        const e = m.tcMeas - sp;                             // 偏差（+ = 温度偏高 → 加大冷却口开度）
        // 负荷前馈：按设计关系 开度(%) ≈ 109.6·(负荷/100)^1.322 − 11.6（80 % 负荷 → 70 %）
        const Lf = Math.pow(Math.max(0, clamp(m.load, 0, 130)) / 100, 1.322);
        const uFF = clamp(100 * (1.0963 * Lf - 0.1163)
            + (m.seaTemp - 28) * 0.45
            + (m.heatherOn ? 6 : 0) + ((m.sw.wbV6S && m.sw.wbV7S) ? -3 : 0), 0, 100);
        const pb = Math.max(1, m.bandP);
        const uP = clamp(e / pb, -1.2, 1.2) * 45;
        m.held = Math.abs(e) > 2.5;                            // 积分分离：偏差大时切除积分
        if (!m.held && Math.abs(e) > 0.25) {
            // 积分作用：偏差每持续 1 s 把操作量推移 1.2 %（Ti 按 40 s 名义值缩放）——用于消除余差
            const k = 40 / Math.max(5, m.ti || 40);
            m.integral = clamp(m.integral + (e > 0 ? 1 : -1) * 1.2 * k * dtsK(this), -25, 25);
        } else if (m.held) {
            // 积分分离（抗积分饱和）：偏差大时停止积分，并把积分项向 0 缓慢拉回，
            // 避免长时间超额调节使积分项饱和、偏差反向时迟迟不能反向作用
            m.integral *= Math.exp(-dtsK(this) / 20);
        }
        return clamp(uFF + uP + m.integral, U_MIN, U_MAX);
    }

    // ═══════════════════════════════════════════════════════════
    //  面板操作（由组件真实点击触发）
    // ═══════════════════════════════════════════════════════════

    /** 柴油机起停开关：开关可以转到运行位，但 PS 断开时柴油机不会起动（起动联锁） */
    setEngine(on) {
        const m = this.m;
        if (on) {
            m.engineSw = true;
            if (!m.psUp) {
                this._tip('柴油机起动闭锁：冷却水压力低（PS 断开），开关已在运行位，压力建立后自动起动');
                return false;
            }
            if (!m.engineOn) {
                m.engineOn = true;
                m.tripped = false;
                m.t.trip = 0;
                m.load = 50;                      // 起动默认负荷 50 %
                this._tip('柴油机：起动运转（负荷 50 %）');
            }
            return true;
        }
        m.engineSw = false;
        m.engineOn = false;
        m.tripped = false;
        m.t.trip = 0;
        this._tip('柴油机：停车（无热源，水温将下降）');
        return true;
    }

    /** 柴油机负荷旋钮（每档 ±10 %） */
    stepLoad(dir) {
        const m = this.m;
        m.load = clamp((m.load || 0) + (dir > 0 ? 10 : -10), 0, 110);
        this._tip(`柴油机负荷：${m.load.toFixed(0)} %`);
    }

    /** 1 / 2 号泵"起动" */
    startPump(id) {
        const m = this.m, p = m.pumps[id];
        if (!p) return false;
        const faulted = id === 'cw1' ? m.faults.pump1 : m.faults.pump2;
        if (faulted) { this._tip(`${p.name} 电机故障，起动失败`); return false; }
        p.mode = 'MAN';
        p.manRun = true;
        p.run = true;
        p.stopping = false;
        p.stopReason = '';
        this._tip(`${p.name} 起动：MENU RUN，排出压力建立中…`);
        return true;
    }

    /** 1 / 2 号泵"停止" */
    stopPump(id) {
        const m = this.m, p = m.pumps[id];
        if (!p) return false;
        p.run = false;
        p.manRun = false;
        p.mode = 'MAN';                 // 停止后方式仍停在"手动"，需再按起动才运转
        p.stopping = true;
        p.stopReason = '按下停止按钮';
        this._tip(`${p.name} 停止：MENU STOP，排出压力下降中…`);
        return true;
    }

    stopAll() { this.stopPump('cw1'); this.stopPump('cw2'); }

    /** 水泵面板"方式"旋钮 */
    setPumpMode(id, mode) {
        const m = this.m, p = m.pumps[id];
        if (!p || !PUMP_MODES.includes(mode)) return false;
        if (mode === 'MAN') {
            // 打到"手动"只是具备手动操作能力：保持当前运转状态，不主动起动
            p.mode = 'MAN';
            p.manRun = !!p.run;
            this._tip(`${p.name} 方式：手动${p.run ? '（保持运转，可用停止按钮停机）' : '（按起动按钮才运转）'}`);
        } else if (mode === 'STOP') {
            this.stopPump(id);
        } else {
            p.mode = 'AUTO';
            if (p.run) m.autoLead = id;      // 原本在运转则继续由自动逻辑接管
            this._tip(`${p.name} 方式：自动${p.run ? '（运行中）' : '（待 PS 低压力信号自动起动）'}`);
        }
        return true;
    }

    /** 方式旋钮换档（到端点不循环） */
    cyclePumpMode(id, dir) {
        const p = this.m.pumps[id];
        if (!p) return;
        const i = PUMP_MODES.indexOf(p.mode);
        const n = clamp(i + (dir > 0 ? 1 : -1), 0, PUMP_MODES.length - 1);
        if (n !== i) this.setPumpMode(id, PUMP_MODES[n]);
    }

    /** LDCL 状态：Automatic ⇄ Manual */
    setMode(mode) {
        const m = this.m;
        m.mode = (mode === 'MANU' || mode === 'Manual') ? 'MANU' : 'AUTO';
        if (m.mode === 'MANU') { m.manualOut = m.manip; m.integral = 0; }
        this._tip(m.mode === 'AUTO' ? 'LDCL 状态：Automatic（自动控制）' : 'LDCL 状态：Manual（手动控制）');
    }

    toggleMode() { this.setMode(this.m.mode === 'AUTO' ? 'MANU' : 'AUTO'); }

    /** TEMP 行控制方式：AUTO ⇄ MANU */
    setTempCtrl(mode) {
        const m = this.m;
        m.tempCtrl = (mode === 'AUTO') ? 'AUTO' : 'MANU';
        if (m.tempCtrl === 'MANU') m.manualOut = m.manip;
        this._tip(`TEMP 控制方式：${m.tempCtrl}（${m.tempCtrl === 'AUTO' ? '按设定值自动调节' : '手动给定冷却口开度'}）`);
    }

    toggleTempCtrl() { this.setTempCtrl((this.m.tempCtrl || 'AUTO') === 'AUTO' ? 'MANU' : 'AUTO'); }

    /** 手动增减操作量（Ctrl 值），dir = +1 / −1 */
    stepManip(dir) {
        const m = this.m;
        if (!m.engineOn) {
            this._tip('柴油机未起动：PID 不运行，冷却口保持关闭（0 %）');
            m.manualOut = 0;
            return 0;
        }
        m.manualOut = clamp(((m.manualOut == null ? m.manip : m.manualOut) + (dir > 0 ? 2 : -2)), U_MIN, U_MAX);
        if (m.mode === 'AUTO' && (m.tempCtrl || 'AUTO') === 'AUTO') {
            this._tip('手动增减操作量需先切到 Manual（面板 Ctrl）');
            return m.manualOut;
        }
        m.manip = m.manualOut;
        this._tip(`Ctrl（冷却口开度）= ${m.manualOut.toFixed(0)} %`);
        return m.manualOut;
    }

    /** 温度设定值 */
    setSetpoint(v) {
        this.m.setTemp = clamp(Number(v), 60, 95);
        this.m.integral = 0;
        this._tip(`温度设定值 T = ${this.m.setTemp.toFixed(1)} ℃`);
    }

    /** 调节阀手动切入（把当前开度作为手动给定值，Reg 打 MANU） */
    manualTakeover() {
        const m = this.m;
        m.manualOut = m.manip;
        m.tempCtrl = 'MANU';
        this._tip(`TEMP 控制切入 MANU：冷却口开度由手动给定（当前 ${m.manip.toFixed(0)} %）`);
    }

    /** 调节阀切回自动（Reg 打 AUTO） */
    autoTakeover() {
        const m = this.m;
        m.tempCtrl = 'AUTO';
        m.integral = 0;
        this._tip('TEMP 控制切回 AUTO：冷却口开度由 LDCL 控制器按设定值自动调节');
    }

    /** 泵吸入阀全开？ */
    suctionOpen() {
        const s = this.m.sw;
        return !!(s.wbV502 && s.wbV12S && s.wbV13S && s.wbV15S && (s.wbV8 || s.wbV9));
    }

    /** 能否自动调节 */
    autoActive() {
        const m = this.m;
        return m.mode === 'AUTO' && (m.tempCtrl || 'AUTO') === 'AUTO' && !m.faults.tt;
    }

    // ═══════════════════════════════════════════════════════════
    //  报警 / 故障
    // ═══════════════════════════════════════════════════════════
    pressAlarmReset() {
        const m = this.m;
        const unack = m.alarms.filter(a => a.active && !a.ack);
        unack.forEach(a => { a.ack = true; });
        this._tip(unack.length ? `报警已确认（${unack.map(a => a.code).join('、')}）` : '无待确认报警');
        return unack.length > 0;
    }

    setFault(key, on) {
        const m = this.m;
        if (!(key in m.faults)) return false;
        m.faults[key] = !!on;
        if (key === 'tt' && !on) m.tcMeas = m.temp;
        if (key === 'leak' && !on) m.tank = Math.max(m.tank, 45);
        return true;
    }

    repairFault(key) { return this.setFault(key, false); }

    /** 手动阀门开 / 关（MIMIC 图上点击） */
    toggleValve(k) {
        const m = this.m;
        if (!(k in m.sw)) return false;
        m.sw[k] = !m.sw[k];
        const names = {
            wbV25S: '缸套水加热器进口阀 WB-V25S', wbV27S: '缸套水加热器出口阀 WB-V27S',
            wbV6S: '造水机进口阀 WB-V6S', wbV7S: '造水机出口阀 WB-V7S',
            wbV4: '缸套水至污水井阀 WB-V4', wbV502: '冷却器支路调节阀截止阀 WB-V502',
            wbV12S: '旁通支路调节阀截止阀 WB-V12S', wbV13S: '除气柜入口阀 WB-V13S',
            wbV26S: '系统至污水井阀 WB-V26S',
        };
        this._tip(`${names[k]}：${m.sw[k] ? '打开' : '关闭'}`);
        return m.sw[k];
    }

    // ═══════════════════════════════════════════════════════════
    //  显示派生量
    // ═══════════════════════════════════════════════════════════
    stateText() {
        const m = this.m;
        if (m.tripped) return '主机 MCR 保护停机';
        if (!(m.pumps.cw1.run || m.pumps.cw2.run)) return '冷却水泵停止';
        if (m.mode !== 'AUTO') return 'Manual · 手动控制';
        if (m.faults.tt) return 'TT 坏值 · 自动切除';
        if (m.faults.controller) return '控制器故障 · 应急';
        return 'Automatic · 温度定值控制';
    }
}

/** 积分步进辅助：按求解周期换算（50 ms） */
function dtsK(solver) { return 0.05 * (solver.cfg.timeScale || 1); }

export default CoolingWaterSolver;
