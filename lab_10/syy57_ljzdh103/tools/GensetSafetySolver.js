/**
 * GensetSafetySolver — 船舶柴油发电机组（副机）安全保护过程模型
 * ═══════════════════════════════════════════════════════════════════════════
 *  工程：副机安全保护的功能测试（syy52_ljzdh85）
 *
 *  三路保护信号（依据「船舶柴油发电机组安全保护MIMIC」）：
 *    ① 磁电式转速传感器 → 超速保护    定值 1725 r/min（额定 1500 r/min 的 115 %）
 *    ② 滑油压力传感器     → 滑油低压保护 定值 1.5 bar
 *    ③ PT100 温度传感器 → 冷却水高温保护 定值 95 ℃
 *  保护动作链：安全保护模块 → 停机继电器 → 停机电磁阀 → 燃油切断机构 → 柴油机停车
 *
 *  过程参数（与 MIMIC 图读数一致，停机备用时保持图中数值）：
 *    高温淡水 T 45.13（出机）/ T 43.98（进机）/ G 40.92
 *    低温淡水 T 40.50（泵出口）/ G 49.88 / T 41.69（回水）/ 增压空气 T 41.25
 *    滑油     T 67.07 / L 49.48 / P 4.29（滤器后）/ T 66.00 / 设定 66.0
 *              P 5.13 / G 25.64 / T 67.07（冷却器后）/ 排气 T 292.13
 *
 *  ⚠ 教学级模型：温度为一阶集总模型（按 accel 加速），压力/流量按泵起停速率建立，
 *    超速保护无延时立即跳闸，滑油低压 4 s、冷却水高温 6 s 确认延时；
 *    停机备用时无热源，各温度保持不动。
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

/** 保护定值 */
export const PROTECTION_SP = {
    overspeed: 1725,   // r/min（额定 1500 的 115 %）
    loPress: 1.5,      // bar（滑油低压跳闸）
    htTemp: 95,        // ℃（冷却水高温跳闸）
    loPressAlarm: 2.0, // bar（报警）
    htTempAlarm: 90,   // ℃（报警）
    delay: 4,          // s（滑油低压保护确认延时）
    delayOver: 0,      // s（超速保护：无延时，立即跳闸）
    delayHt: 6,        // s（冷却水高温保护确认延时）
};

/** 控制方式档位（与机旁面板旋钮一致） */
export const GEN_MODES = ['BLOCK', 'LOCAL', 'REMOTE'];
export const GEN_MODE_CN = { BLOCK: '闭锁', LOCAL: '机旁', REMOTE: '遥控' };

/** 报警编码表 */
export const GENSET_ALARMS = {
    A11: { text: '滑油压力低', kind: 'trip', delay: 4 },
    A12: { text: '冷却水温度高', kind: 'trip', delay: 6 },
    A13: { text: '机组超速', kind: 'trip', delay: 0 },
    A14: { text: '起动失败', kind: 'alarm' },
    A15: { text: '滑油温度高', kind: 'alarm' },
    A16: { text: '低温淡水温度高', kind: 'alarm' },
    A17: { text: '滑油柜液位低', kind: 'alarm' },
    A18: { text: '盘车机构未脱开', kind: 'alarm' },
    A19: { text: '燃油齿条卡滞，停机失败', kind: 'trip' },
};

/** 手动阀名称（提示文字用） */
export const VALVE_NAMES = {
    vHtEngOut: '主机出口截止阀',
    vHtCoolIn: '高温淡水冷却器进口阀',
    vHtCoolOut: '高温淡水冷却器出口阀',
    vHtPumpIn: '高温淡水泵吸入阀',
    vHtPumpOut: '高温淡水泵排出阀',
    vHtToAE: '至 A/E 高温淡水系统出口阀',
    vHtFromAE: '自 A/E 高温淡水系统进口阀',
    vLtAirIn: '增压空气冷却器进口阀',
    vLtAirOut: '增压空气冷却器出口阀',
    vLtCoolIn: '低温淡水冷却器进口阀',
    vLtCoolOut: '低温淡水冷却器出口阀',
    vLtPumpIn: '低温淡水泵吸入阀',
    vLtPumpOut: '低温淡水泵排出阀',
    vLtToAE: '至 A/E 低温淡水系统出口阀',
    vLtFromAE: '自 A/E 低温淡水系统进口阀',
    vLoSuc: '滑油泵吸入阀',
    vLoDis: '滑油泵排出阀',
    vLoFilterIn: '滑油滤器进口阀',
    vLoFilterOut: '滑油滤器出口阀',
    vLoCoolIn: '滑油冷却器进口阀',
    vLoCoolOut: '滑油冷却器出口阀',
    vLoSludge: '放残（To Sludge）阀',
    vLoPurifyIn: '自滑油分油机进口阀',
    vLoPurifyOut: '至滑油分油机出口阀',
};

/** 初始（备用）工况 —— 与 MIMIC 图读数一致 */
function createModel() {
    return {
        clock: 0,
        mode: 'LOCAL',
        turningGear: false,     // 盘车机构（true = 啮合，禁止起动）
        blockHandle: false,     // 闭锁手柄（true = 压下，燃油齿条为 0）
        lampTest: false,
        _lampT: 0,
        ready: true,
        loadTarget: 50,

        engine: {
            running: false, cranking: 0, speed: 0, load: 0, fuel: 0,
            startFail: false, runtime: 0,
        },
        gen: { volt: 0, freq: 0, amp: 0, kw: 0, breaker: false },

        trips: { overspeed: false, loPress: false, htTemp: false, estop: false },
        tripT: { overspeed: 0, loPress: 0, htTemp: 0 },
        shutdown: { relay: false, solenoid: false, fuelCut: false },

        speedSig: 0,
        pressSig: 5.13,
        htSig: 45.13,

        // 安保测试工具箱（模拟三路保护信号，代替真实传感器）
        test: {
            pumpOn: false, pumpPress: 5.00,   // 手动泵压模块 → 滑油压力传感器
            freqOn: false, freq: 1500,        // 频率发生器 → 转速信号（60 齿，Hz ≈ r/min）
            resOn: false, res: 100.0,         // 电阻箱 → PT100（Ω）
            ovenOn: false, oven: 25,          // 干式温度校验炉 → PT100（℃）
        },

        ht: {
            pump1: true, pump2: false, running: true, circ: true,
            tempOut: 45.13, tempIn: 43.98, flow: 40.92, press: 2.6,
            valve: 52, setpoint: 72.0,
        },
        lt: {
            pump1: true, pump2: false, running: true, circ: true,
            tempOut: 40.50, tempRet: 41.69, airOut: 41.25, flow: 49.88, press: 2.2,
        },
        lo: {
            pumpAtt: true, pumpPrim: false, primMode: 'MAN', running: true, circ: true,
            press: 5.13, pressFilter: 4.29, temp: 67.07, tempFilter: 66.00,
            tempOut: 67.07, flow: 25.64, level: 49.48,
            valve: 50, setpoint: 66.0, sludgeOpen: 1.0,
        },
        exh: 292.13,

        // 起动空气系统（压缩空气起动，不用起动马达）
        air: {
            press: 28.0,     // 空气瓶压力 bar
            max: 30.0,       // 空压机停机压力
            min: 15.0,       // 最低起动压力
            comp: false,     // 空压机运行
            compOn: true,    // 空压机自动投入
            valve: false,    // 起动空气阀（起动时开启）
        },

        sw: {
            vHtEngOut: true, vHtCoolIn: true, vHtCoolOut: true,
            vHtPumpIn: true, vHtPumpOut: true, vHtToAE: false, vHtFromAE: false,
            vLtAirIn: true, vLtAirOut: true, vLtCoolIn: true, vLtCoolOut: true,
            vLtPumpIn: true, vLtPumpOut: true, vLtToAE: false, vLtFromAE: false,
            vLoSuc: true, vLoDis: true, vLoFilterIn: true, vLoFilterOut: true,
            vLoCoolIn: true, vLoCoolOut: true, vLoSludge: false,
            vLoPurifyIn: false, vLoPurifyOut: false,
        },

        faults: {
            speedSensor: false,
            loPressPt: false,
            htTempSensor: false,
            loPump: false,
            htPump1: false,
            htPump2: false,
            ltPump1: false,
            ltPump2: false,
            filterClog: false,
            fuelRack: false,
            airComp: false,
            airLeak: false,
            loLeak: false,
            htValveStuck: false,
            coolerFoul: false,
            govStuck: false,
        },

        // 故障计时（s）
        faultT: { filterClog: 0, loLeak: 0, htValve: 0, coolerFoul: 0, gov: 0, govRef: null },

        alarms: [],
    };
}

export class GensetSafetySolver {
    constructor(sys) {
        this.sys = sys;
        this.cfg = {
            accel: 3,        // 温度变化加速倍数（教学用；1 = 真实比例）
            timeScale: 1,
        };
        this.m = createModel();
        this._initAlarms();
    }

    _tip(msg) {
        if (this.sys && typeof this.sys._tipPurifier === 'function') this.sys._tipPurifier(msg);
    }

    _initAlarms() {
        this.m.alarms = Object.keys(GENSET_ALARMS).map(id => ({
            id, text: GENSET_ALARMS[id].text, kind: GENSET_ALARMS[id].kind,
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
        const E = m.engine, HT = m.ht, LT = m.lt, LO = m.lo, F = m.faults;

        // ── 0. 灯测试计时 ──
        if (m._lampT > 0) {
            m._lampT -= dts;
            if (m._lampT <= 0) { m._lampT = 0; m.lampTest = false; }
        }

        // ── 0b. 故障计时 ──
        const FT = m.faultT;
        FT.filterClog = F.filterClog ? FT.filterClog + dts : 0;
        FT.loLeak = F.loLeak ? FT.loLeak + dts : 0;
        FT.htValve = F.htValveStuck ? FT.htValve + dts : 0;
        FT.coolerFoul = F.coolerFoul ? FT.coolerFoul + dts : 0;
        FT.gov = F.govStuck ? FT.gov + dts : 0;

        // ── 1. 辅助泵运行状态（故障泵不出力）──
        const htRun1 = HT.pump1 && !F.htPump1;
        const htRun2 = HT.pump2 && !F.htPump2;
        const ltRun1 = LT.pump1 && !F.ltPump1;
        const ltRun2 = LT.pump2 && !F.ltPump2;
        // 预润滑泵：MAN 手动起停 / AUT 自动（有电即起动）；机带泵运行（主机运转）时自动停机
        if (E.running) {
            LO.pumpPrim = false;                 // 机带泵已建立油压，预润滑泵自动停止
        } else if (LO.primMode === 'AUT') {
            LO.pumpPrim = true;                  // 自动方式：停机状态自动预润滑
        }
        const loAtt = LO.pumpAtt && !F.loPump && E.running;   // 机带泵由柴油机驱动，仅运转时出油
        const loPrim = LO.pumpPrim && !F.loPump;
        HT.running = htRun1 || htRun2;
        LT.running = ltRun1 || ltRun2;
        LO.running = loAtt || loPrim;

        // ── 2. 闭锁手柄：机械压下燃油齿条，机组不能运行 ──
        if (m.blockHandle) { E.running = false; E.cranking = 0; }

        // ── 3. 起动 / 运转 / 停车状态机 ──
        if (E.cranking > 0) {
            E.cranking += dts;
            E.speed = approach(E.speed, 200, dts, 900);
            if (E.cranking >= 2.6) {
                const ok = this._startPermissive();
                E.cranking = 0;
                if (ok) {
                    E.running = true;
                    E.startFail = false;
                    E.speed = Math.max(E.speed, 200);
                    this._tip('机组起动成功，转速上升至额定值');
                } else {
                    E.startFail = true;
                    this._tip('起动失败：盘车未脱开 / 预润滑油压不足 / 控制方式闭锁');
                }
            }
        }

        if (E.running) {
            E.load = approach(E.load, m.loadTarget, dts, 22 * acc);
            E.runtime += dts;
            if (F.govStuck) {
                // 故障⑤调速器执行机构卡涩：燃油齿条冻结在卡涩瞬间位置，
                // 负荷一旦降低，油门不能回调，转速持续上升，约 10 s 触发超速
                if (FT.govRef == null) FT.govRef = E.load;
                const excess = Math.max(0, FT.govRef - E.load);   // 负荷跌落量 (%)
                const rise = 2 + excess * 0.5;                    // r/min 每秒
                E.speed = Math.min(2600, E.speed + rise * dts);
            } else {
                E.speed = approach(E.speed, 1500, dts, 600 + 300 * (acc - 1));
            }
        } else if (!(E.cranking > 0)) {
            E.speed = approach(E.speed, 0, dts, 900);
            E.load = approach(E.load, 0, dts, 260);
        }

        // ── 4. 保护测量信号（传感器故障 / 试验工具接入时改变）──
        const TT = m.test;
        m.speedSig = TT.freqOn ? TT.freq : (F.speedSensor ? 2400 : E.speed);
        m.pressSig = TT.pumpOn ? TT.pumpPress : (F.loPressPt ? 0.9 : LO.press);
        m.htSig = TT.ovenOn ? TT.oven
            : (TT.resOn ? Math.max(-50, (TT.res - 100) / 0.385) : (F.htTempSensor ? 105 : HT.tempOut));

        const condOver = m.speedSig > PROTECTION_SP.overspeed;
        const condLo = E.speed > 700 && m.pressSig < PROTECTION_SP.loPress;
        const condHt = E.speed > 700 && m.htSig > PROTECTION_SP.htTemp;
        this._latch('overspeed', condOver, dts, '超速保护动作：停机继电器得电', PROTECTION_SP.delayOver);
        this._latch('loPress', condLo, dts, '滑油低压保护动作：停机继电器得电', PROTECTION_SP.delay);
        this._latch('htTemp', condHt, dts, '冷却水高温保护动作：停机继电器得电', PROTECTION_SP.delayHt);

        // ── 5. 停机执行链：保护 → 继电器 → 电磁阀 → 燃油切断 ──
        if (m.trips.overspeed || m.trips.loPress || m.trips.htTemp || m.trips.estop) {
            m.shutdown.relay = true;
        }
        if (m.shutdown.relay) { m.shutdown.solenoid = true; m.shutdown.fuelCut = true; }
        if (m.shutdown.fuelCut && !F.fuelRack) { E.running = false; E.cranking = 0; }

        // ── 6. 燃油齿条 ──
        E.fuel = (m.shutdown.fuelCut || m.blockHandle) ? 0
            : (E.running ? clamp(22 + E.load * 0.75, 22, 100) : (E.cranking > 0 ? 35 : 0));
        if (F.fuelRack && E.running) E.fuel = 100;

        // ── 7. 滑油系统 ──
        LO.circ = (loAtt || loPrim) && m.sw.vLoSuc && m.sw.vLoDis;
        let loPressTgt = Math.max(
            loAtt ? 0.45 + 3.25 * clamp(E.speed / 1500, 0, 1.12) : 0,
            loPrim ? 5.13 : 0,
        ) * (m.sw.vLoFilterIn && m.sw.vLoFilterOut ? 1 : 0.6);
        // 故障①滑油滤器堵塞：30 s 内油压降到 1.5 bar 以下
        if (F.filterClog) loPressTgt *= clamp(1 - (FT.filterClog / 30) * 0.85, 0.15, 1);
        // 故障②滑油管路泄漏：60 s 内油压降到 1.5 bar 以下
        if (F.loLeak) loPressTgt *= clamp(1 - (FT.loLeak / 60) * 0.85, 0.15, 1);
        LO.press = approach(LO.press, loPressTgt, dts, 2.4 * acc);
        LO.pressFilter = Math.max(0, LO.press - (F.filterClog ? 1.9 : 0.84));
        LO.flow = approach(LO.flow, LO.circ ? 25.64 : 0, dts, 40);

        if (E.running) {
            const coolOk = LO.circ && m.sw.vLoCoolIn && m.sw.vLoCoolOut;
            LO.valve = approach(LO.valve, clamp(50 + (LO.temp - LO.setpoint) * 1.5, 0, 100), dts, 18 * acc);
            const coolEff = coolOk ? LO.valve / 100 : 0;
            const heat = 12 + E.load * 0.42;                       // 无冷却时的温升裕度
            const tgt = LT.tempOut + 6.2 + (1 - coolEff) * heat;
            LO.temp = approach(LO.temp, tgt, dts, 1.1 * acc);
        }
        LO.tempOut = LO.temp;
        LO.tempFilter = LO.temp - 1.07;
        LO.sludgeOpen = m.sw.vLoSludge ? 1.0 : 0.0;
        // 滑油柜液位：放残阀开启缓慢下降；故障②管路泄漏时油不断漏出，液位持续降低
        let loDrain = m.sw.vLoSludge ? 0.02 * acc : 0;          // %/s
        if (F.loLeak) loDrain += E.running ? 0.35 : 0.12;        // 泄漏：运行中约 0.35 %/s
        if (loDrain > 0) LO.level = clamp(LO.level - loDrain * dts, 0, 100);

        // ── 8. 高温淡水（缸套水）系统 ──
        HT.circ = HT.running && m.sw.vHtEngOut && m.sw.vHtCoolIn && m.sw.vHtCoolOut
            && m.sw.vHtPumpIn && m.sw.vHtPumpOut;
        HT.flow = approach(HT.flow, HT.circ ? 40.92 : 0, dts, 45);
        HT.press = approach(HT.press, HT.circ ? 2.6 : 0.2, dts, 4);
        if (E.running) {
            if (F.htValveStuck) {
                // 故障③三通阀卡涩：调节失效，出口水温随负荷漂移，约 30 s 升至超温
                const tgt = 96 + Math.max(0, 60 - E.load) * 0.25;
                HT.tempOut = approach(HT.tempOut, tgt, dts, 0.8);
            } else {
                HT.valve = approach(HT.valve, clamp(52 + (HT.tempOut - HT.setpoint) * 1.2, 0, 100), dts, 18 * acc);
                if (HT.circ) {
                    const eff = HT.valve / 100;
                    const tgt = LT.tempOut + 4.63 + (1 - eff) * (46 + E.load * 0.24);
                    HT.tempOut = approach(HT.tempOut, tgt, dts, 1.2 * acc);
                } else {
                    HT.tempOut = approach(HT.tempOut, 118, dts, 0.8 * acc);   // 不循环 → 迅速升温
                }
            }
            HT.tempIn = HT.tempOut - 1.15;
        }

        // ── 9. 低温淡水系统（冷却增压空气与滑油）──
        LT.circ = LT.running && m.sw.vLtAirIn && m.sw.vLtAirOut
            && m.sw.vLtCoolIn && m.sw.vLtCoolOut && m.sw.vLtPumpIn && m.sw.vLtPumpOut;
        LT.flow = approach(LT.flow, LT.circ ? 49.88 : 0, dts, 55);
        LT.press = approach(LT.press, LT.circ ? 2.2 : 0.2, dts, 4);
        if (F.coolerFoul) {
            // 故障④中央冷却器结垢：低温淡水温度持续升高，约 60 s 后缸套水出口超温
            LT.tempOut = approach(LT.tempOut, 66, dts, 0.4);
            LT.tempRet = LT.tempOut + 1.2;
            LT.airOut = LT.tempOut + 0.75;
        } else if (E.running && LT.circ) {
            const tgt = 40.5 + E.load * 0.03 + (LO.circ ? 0.4 : 0);
            LT.tempOut = approach(LT.tempOut, tgt, dts, 0.45 * acc);
            LT.tempRet = LT.tempOut + 0.55 + E.load * 0.011;
            LT.airOut = LT.tempOut + 0.75;
        } else if (!E.running) {
            LT.tempRet = LT.tempOut + 1.19;
            LT.airOut = LT.tempOut + 0.75;
        }

        // ── 10. 起动空气系统（压缩空气起动）──
        const A = m.air;
        if (!A.compOn || F.airComp) A.comp = false;
        else if (A.press <= 24) A.comp = true;
        else if (A.press >= A.max) A.comp = false;
        if (A.comp) A.press = Math.min(A.max, A.press + 1.6 * dts);
        if (F.airLeak) A.press = Math.max(0, A.press - 1.2 * dts);
        A.valve = E.cranking > 0;                       // 起动时起动空气阀开启
        if (A.valve) A.press = Math.max(0, A.press - 1.15 * dts);   // 起动耗气

        // ── 11. 发电机 ──
        m.gen.volt = E.speed > 300 ? clamp(400 * E.speed / 1500, 0, 420) : 0;
        m.gen.freq = E.speed / 30;
        m.gen.kw = E.running ? 250 * E.load / 100 : 0;
        m.gen.amp = m.gen.kw > 0.1 ? (m.gen.kw * 1000) / (1.732 * 400 * 0.8) : 0;
        m.gen.breaker = E.running && E.speed > 1400;

        // ── 12. 排气温度（停机时保持余温读数）──
        if (E.running) m.exh = 285 + E.load * 0.5;

        // ── 12. 报警 ──
        this._alarm('A11', E.speed > 700 && m.pressSig < PROTECTION_SP.loPressAlarm, dts);
        this._alarm('A12', E.speed > 700 && m.htSig > PROTECTION_SP.htTempAlarm, dts);
        this._alarm('A13', m.speedSig > PROTECTION_SP.overspeed, dts);
        this._alarm('A14', E.startFail, dts);
        this._alarm('A15', LO.temp > 78, dts);
        this._alarm('A16', LT.tempOut > 55, dts);
        this._alarm('A17', LO.level < 30, dts);
        this._alarm('A18', m.turningGear && (E.cranking > 0 || E.startFail), dts);
        this._alarm('A19', !!F.fuelRack && m.shutdown.fuelCut, dts);

        m.ready = this.ready();
    }

    /** 保护确认延时 + 锁存 */
    _latch(key, cond, dts, tipText, delay = PROTECTION_SP.delay) {
        const m = this.m;
        if (m.trips[key]) return;
        if (cond) {
            m.tripT[key] = (m.tripT[key] || 0) + dts;
            if (m.tripT[key] >= delay) {
                m.trips[key] = true;
                m.tripT[key] = 0;
                if (tipText) this._tip(tipText);
            }
        } else {
            m.tripT[key] = 0;
        }
    }

    /** 报警确认（跳闸类锁存，非跳闸类条件消失自动消除） */
    _alarm(id, on, dts) {
        const a = this.m.alarms.find(x => x.id === id);
        if (!a) return;
        if (on) {
            a.timer += dts;
            const need = a.kind === 'trip' ? (GENSET_ALARMS[id].delay ?? PROTECTION_SP.delay) : 2;
            if (!a.active && a.timer >= need) { a.active = true; a.ack = false; }
        } else {
            a.timer = 0;
            if (a.active && a.kind === 'alarm') { a.active = false; a.ack = true; }
        }
    }

    _startPermissive() {
        const m = this.m;
        return m.mode !== 'BLOCK' && !m.turningGear && !m.blockHandle
            && !this._anyTrip() && !!m.lo.pumpPrim;
    }

    _anyTrip() {
        const t = this.m.trips;
        return !!(t.overspeed || t.loPress || t.htTemp || t.estop);
    }

    ready() {
        const m = this.m;
        return !m.engine.running && !(m.engine.cranking > 0)
            && m.mode !== 'BLOCK' && !m.turningGear && !m.blockHandle
            && !this._anyTrip() && !!m.lo.pumpPrim;
    }

    /** 报警复位（灯测试 / 报警确认） */
    ackAlarms() {
        this.m.alarms.forEach(a => { if (!a.kind || a.kind === 'alarm') a.ack = true; });
    }

    // ═══════════════════════════════════════════════════════════
    //  操作接口
    // ═══════════════════════════════════════════════════════════

    /** 控制方式旋钮（BLOCK / LOCAL / REMOTE） */
    setMode(mode) {
        if (!GEN_MODES.includes(mode)) return false;
        this.m.mode = mode;
        this._tip(`控制方式：${GEN_MODE_CN[mode]}（${mode}）`);
        return true;
    }

    /** 旋钮换档（到端点不循环） */
    cycleMode(dir) {
        const i = GEN_MODES.indexOf(this.m.mode);
        const n = clamp(i + (dir > 0 ? 1 : -1), 0, GEN_MODES.length - 1);
        if (n !== i) this.setMode(GEN_MODES[n]);
        return this.m.mode;
    }

    /** 盘车机构（啮合 / 脱开） */
    setTurningGear(on) {
        this.m.turningGear = !!on;
        this._tip(this.m.turningGear
            ? '盘车机构啮合：盘车时禁止起动主机'
            : '盘车机构已脱开：可以起动主机');
    }

    toggleTurningGear() { this.setTurningGear(!this.m.turningGear); }

    /** 闭锁手柄（压下 / 复位） */
    setBlockHandle(on) {
        this.m.blockHandle = !!on;
        this._tip(this.m.blockHandle ? '闭锁手柄压下：燃油齿条被压到 0 位' : '闭锁手柄已复位');
    }

    toggleBlockHandle() { this.setBlockHandle(!this.m.blockHandle); }

    /** 机旁起动 */
    startEngine() {
        const m = this.m;
        if (m.engine.running) { this._tip('机组已在运行'); return false; }
        if (m.engine.cranking > 0) return false;
        if (this._anyTrip()) { this._tip('保护跳闸未复位，不能起动'); return false; }
        if (m.mode === 'BLOCK') {
            m.engine.startFail = true;
            this._tip('控制方式在 BLOCK（闭锁）位，起动失败');
            return false;
        }
        if (m.turningGear) {
            m.engine.startFail = true;
            this._tip('盘车机构未脱开，起动失败（START FAIL）');
            return false;
        }
        if (m.blockHandle) {
            m.engine.startFail = true;
            this._tip('闭锁手柄未复位，起动失败（START FAIL）');
            return false;
        }
        if (!m.lo.pumpPrim) { this._tip('预润滑泵未运行，不能起动（先起动预润滑泵建立油压）'); return false; }
        if (m.air.press < m.air.min) {
            m.engine.startFail = true;
            this._tip(`起动空气压力低（${m.air.press.toFixed(1)} bar < ${m.air.min} bar），不能起动`);
            return false;
        }
        m.engine.cranking = 0.0001;
        m.engine.startFail = false;
        this._tip('起动空气阀开启，压缩空气按发火顺序进入各缸，机组起动（约 2.6 s）');
        return true;
    }

    /** 正常停车 */
    stopEngine() {
        const m = this.m;
        if (!m.engine.running && !(m.engine.cranking > 0)) { this._tip('机组已停机'); return; }
        m.engine.running = false;
        m.engine.cranking = 0;
        this._tip('正常停车：燃油齿条回 0，机组降速停车');
    }

    /** 机旁紧急停车（不经过保护模块，直接断油） */
    emergencyStop() {
        const m = this.m;
        m.trips.estop = true;
        m.shutdown.relay = true;
        m.shutdown.solenoid = true;
        m.shutdown.fuelCut = true;
        m.engine.running = false;
        m.engine.cranking = 0;
        this._tip('机旁紧急停车：燃油齿条立即回到 0 位，机组停车');
    }

    /** 安全保护复位（保护条件消除后才能复位） */
    resetTrips() {
        const m = this.m;
        const still = m.speedSig > PROTECTION_SP.overspeed
            || (m.engine.running && m.pressSig < PROTECTION_SP.loPress)
            || (m.engine.running && m.htSig > PROTECTION_SP.htTemp);
        if (still) { this._tip('保护条件仍然存在，不能复位（请先排除故障）'); return false; }
        m.trips = { overspeed: false, loPress: false, htTemp: false, estop: false };
        m.tripT = { overspeed: 0, loPress: 0, htTemp: 0 };
        m.shutdown = { relay: false, solenoid: false, fuelCut: false };
        m.engine.startFail = false;
        m.alarms.forEach(a => {
            if (a.kind === 'trip') { a.active = false; a.ack = true; a.timer = 0; }
        });
        this._tip('安全保护已复位，机组恢复备用');
        return true;
    }

    /** 灯测试 */
    lampTest() {
        this.m.lampTest = true;
        this.m._lampT = 3;
        this._tip('灯测试：全部指示灯点亮 3 s');
    }

    /** 泵起停：group = ht | lt | lo，id = p1 / p2 / att / prim */
    setPump(group, id, on) {
        const m = this.m;
        if (group === 'ht' || group === 'lt') {
            const G = m[group];
            if (id === 'p1') G.pump1 = !!on;
            else if (id === 'p2') G.pump2 = !!on;
        } else if (group === 'lo') {
            if (id === 'att') m.lo.pumpAtt = !!on;
            else if (id === 'prim') m.lo.pumpPrim = !!on;
        }
    }

    togglePump(group, id) {
        const m = this.m;
        if (group === 'ht' || group === 'lt') {
            const G = m[group];
            if (id === 'p1') G.pump1 = !G.pump1;
            else if (id === 'p2') G.pump2 = !G.pump2;
        } else if (group === 'lo') {
            if (id === 'att') m.lo.pumpAtt = !m.lo.pumpAtt;
            else if (id === 'prim') m.lo.pumpPrim = !m.lo.pumpPrim;
        }
    }

    /** 预润滑泵控制方式：MAN（手动起停）/ AUT（自动预润滑） */
    setPrimMode(mode) {
        const m = this.m;
        m.lo.primMode = mode === 'AUT' ? 'AUT' : 'MAN';
        this._tip(`预润滑泵控制方式：${m.lo.primMode === 'AUT' ? 'AUT 自动（停机 / 油压低时自起）' : 'MAN 手动'}`);
    }

    togglePrimMode() {
        this.setPrimMode(this.m.lo.primMode === 'AUT' ? 'MAN' : 'AUT');
    }

    /** 预润滑泵起 / 停（手动方式） */
    startPrimPump() {
        this.m.lo.pumpPrim = true;
        this._tip('预润滑泵起动');
    }

    stopPrimPump() {
        this.m.lo.pumpPrim = false;
        this._tip('预润滑泵停止');
    }

    /** 手动阀开 / 关 */
    toggleValve(key) {
        const sw = this.m.sw;
        if (!(key in sw)) return false;
        sw[key] = !sw[key];
        const nm = VALVE_NAMES[key] || key;
        this._tip(`${nm}：${sw[key] ? '已打开（绿色）' : '已关闭'}`);
        return sw[key];
    }

    setValve(key, on) {
        const sw = this.m.sw;
        if (!(key in sw)) return false;
        sw[key] = !!on;
        return sw[key];
    }

    /** 负荷给定 */
    setLoad(v) {
        this.m.loadTarget = clamp(v, 0, 100);
    }

    stepLoad(dir) {
        this.m.loadTarget = clamp(this.m.loadTarget + (dir > 0 ? 5 : -5), 0, 100);
        this._tip(`负荷给定：${this.m.loadTarget.toFixed(0)} %（实际负荷 ${this.m.engine.load.toFixed(0)} %）`);
    }

    // ═══════════════════════════════════════════════════════════
    //  安保测试工具箱（模拟三路保护信号）
    // ═══════════════════════════════════════════════════════════

    /** 手动泵压模块：接入 / 切除（代替滑油压力传感器） */
    setTestPump(on) {
        this.m.test.pumpOn = !!on;
        this._tip(this.m.test.pumpOn
            ? `手动泵压模块接入：输出 ${this.m.test.pumpPress.toFixed(2)} bar，代替滑油压力传感器`
            : '手动泵压模块切除：恢复真实滑油压力信号');
    }

    /** 手动泵压模块：加压（+1）/ 泄压（−1） */
    stepTestPump(dir) {
        const t = this.m.test;
        t.pumpPress = clamp(t.pumpPress + (dir > 0 ? 0.5 : -0.5), 0, 8);
        this._tip(`泵压模块输出：${t.pumpPress.toFixed(2)} bar`);
    }

    /** 频率发生器：接入 / 切除（代替磁电式转速传感器） */
    setTestFreq(on) {
        this.m.test.freqOn = !!on;
        this._tip(this.m.test.freqOn
            ? `频率发生器接入：${this.m.test.freq.toFixed(0)} Hz（≈ ${this.m.test.freq.toFixed(0)} r/min）`
            : '频率发生器切除：恢复真实转速信号');
    }

    /** 频率发生器：升频（+1）/ 降频（−1），50 Hz 一档 */
    stepTestFreq(dir) {
        const t = this.m.test;
        t.freq = clamp(t.freq + (dir > 0 ? 50 : -50), 0, 2500);
        this._tip(`频率发生器输出：${t.freq.toFixed(0)} Hz（≈ ${t.freq.toFixed(0)} r/min）`);
    }

    /** 电阻箱：接入 / 切除（代替 PT100） */
    setTestRes(on) {
        this.m.test.resOn = !!on;
        this._tip(this.m.test.resOn
            ? `电阻箱接入：${this.m.test.res.toFixed(1)} Ω（≈ ${((this.m.test.res - 100) / 0.385).toFixed(1)} ℃）`
            : '电阻箱切除：恢复 PT100 温度信号');
    }

    /** 电阻箱：加阻（+1）/ 减阻（−1），2 Ω 一档 */
    stepTestRes(dir) {
        const t = this.m.test;
        t.res = clamp(t.res + (dir > 0 ? 2 : -2), 100, 180);
        this._tip(`电阻箱：${t.res.toFixed(1)} Ω（≈ ${((t.res - 100) / 0.385).toFixed(1)} ℃）`);
    }

    /** 干式温度校验炉：接入 / 切除（把 PT100 放入炉膛） */
    setTestOven(on) {
        this.m.test.ovenOn = !!on;
        this._tip(this.m.test.ovenOn
            ? `PT100 已放入校验炉：炉温 ${this.m.test.oven.toFixed(0)} ℃`
            : 'PT100 已取出：恢复冷却水温度信号');
    }

    /** 干式温度校验炉：升温（+1）/ 降温（−1），5 ℃ 一档 */
    stepTestOven(dir) {
        const t = this.m.test;
        t.oven = clamp(t.oven + (dir > 0 ? 5 : -5), 0, 200);
        this._tip(`校验炉炉温：${t.oven.toFixed(0)} ℃`);
    }

    /** 试验工具全部切除（试验结束） */
    clearTestTools() {
        const t = this.m.test;
        t.pumpOn = false;
        t.freqOn = false;
        t.resOn = false;
        t.ovenOn = false;
    }

    // ═══════════════════════════════════════════════════════════
    //  起动空气系统（压缩空气起动）
    // ═══════════════════════════════════════════════════════════
    /** 空压机自动 / 切除 */
    toggleAirComp() {
        const A = this.m.air;
        A.compOn = !A.compOn;
        this._tip(A.compOn
            ? `空压机投入自动：空气瓶 ${A.press.toFixed(1)} bar（低于 24 bar 自动补气）`
            : '空压机已切除：空气瓶不再补气，起动会消耗压缩空气');
    }

    /** 空气瓶充气（试验用） */
    chargeAir() {
        this.m.air.press = this.m.air.max;
        this._tip(`空气瓶已充至 ${this.m.air.max.toFixed(1)} bar`);
    }

    // ═══════════════════════════════════════════════════════════
    //  故障
    // ═══════════════════════════════════════════════════════════
    setFault(key, on) {
        const m = this.m;
        if (!(key in m.faults)) { console.warn('[GensetSafetySolver] 未知故障：', key); return; }
        m.faults[key] = !!on;
        if (!on) {
            if (key === 'govStuck') { m.faultT.govRef = null; m.faultT.gov = 0; }
            // 修复后清除由该故障引起的锁存计时
            if (key === 'speedSensor' || key === 'loPressPt' || key === 'htTempSensor') {
                m.tripT = { overspeed: 0, loPress: 0, htTemp: 0 };
            }
        }
    }

    repairFault(key) { this.setFault(key, false); }

    /** 全部故障复位（故障界面取消勾选时逐项调用 repairFault） */
    clearFaults() {
        Object.keys(this.m.faults).forEach(k => { this.m.faults[k] = false; });
    }

    // ═══════════════════════════════════════════════════════════
    //  工具栏快捷操作
    // ═══════════════════════════════════════════════════════════

    /** 复位到备用状态（保留已设置的故障） */
    resetAll() {
        const faults = { ...this.m.faults };
        this.m = createModel();
        this.m.faults = faults;
        this._initAlarms();
    }

    /** 一键起动：辅助泵 → 预润滑 → 起动 → 带 50 % 负荷 */
    quickStart() {
        const m = this.m;
        m.mode = 'LOCAL';
        m.turningGear = false;
        m.blockHandle = false;
        m.ht.pump1 = true; m.ht.pump2 = false;
        m.lt.pump1 = true; m.lt.pump2 = false;
        m.lo.pumpAtt = true; m.lo.pumpPrim = false;
        m.loadTarget = 50;
        m.engine.running = true;
        m.engine.cranking = 0;
        m.engine.speed = 1500;
        m.engine.load = 50;
        m.engine.startFail = false;
        // 运行工况初值
        m.ht.tempOut = 72.0; m.ht.tempIn = 70.8; m.ht.flow = 40.92; m.ht.press = 2.6;
        m.lt.tempOut = 42.3; m.lt.tempRet = 43.5; m.lt.airOut = 43.05; m.lt.flow = 49.88; m.lt.press = 2.2;
        m.lo.temp = 66.0; m.lo.tempFilter = 64.9; m.lo.tempOut = 66.0;
        m.lo.press = 5.13; m.lo.pressFilter = 4.29; m.lo.flow = 25.64;
        m.exh = 315;
        m.gen.volt = 400; m.gen.freq = 50; m.gen.kw = 150; m.gen.amp = 271; m.gen.breaker = true;
        m.trips = { overspeed: false, loPress: false, htTemp: false, estop: false };
        m.shutdown = { relay: false, solenoid: false, fuelCut: false };
        m.ready = false;
    }

    /** 5 点步进：复位 → 辅助泵 → 预润滑 → 起动 → 带负荷 */
    fiveStep(i) {
        const m = this.m;
        switch (i % 5) {
            case 0:
                this.resetAll();
                this._tip('① 复位：机组备用，辅助泵停');
                break;
            case 1:
                m.ht.pump1 = true; m.lt.pump1 = true;
                this._tip('② 起动高温淡水 / 低温淡水泵');
                break;
            case 2:
                m.lo.pumpAtt = true; m.lo.pumpPrim = false;
                this._tip('③ 预润滑：滑油压力建立');
                break;
            case 3:
                this.startEngine();
                this._tip('④ 机旁起动柴油发电机组');
                break;
            case 4:
                m.loadTarget = 80;
                this._tip('⑤ 加负荷至 80 %');
                break;
            default: break;
        }
    }
}
