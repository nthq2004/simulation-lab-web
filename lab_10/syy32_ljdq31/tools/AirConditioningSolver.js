/**
 * AirConditioningSolver —— 船舶中央空调物理求解器（单压缩机 + 单舱室）
 *
 * 工程：空调系统的自动控制、安全保护及故障处理（syy22_conditioner）
 *
 * 空气侧：新风 + 回风混合 → 过滤段（ΔP）→ 蒸发器 → 风机 → 送风（加热盘管 / 加湿器）
 *         → 船员舱室 → 回风。
 * 制冷剂侧：压缩机 → 滑油分离器 → 冷凝器（低温冷却淡水）→ 干燥器&过滤器 →
 *         回热器 → 并联两路膨胀阀（A 小容量 / B 大容量，按负荷投切）→ 蒸发器 → 回气 → 压缩机。
 *
 * 控制：舱室温度双位（启动/停止温度滞环）、相对湿度双位（加湿起停）、
 *      制冷 / 制热 / 关 三工况；压缩机手动 / 自动 / 负荷三档；
 *      两路膨胀阀按负荷自动切换（<50% 仅小容量阀，≥50% 再投入大容量阀）。
 *
 * 20fps 逐步松弛；结果经 AirConditioningSystem.acceptModel(m) 回写。
 */

import { satTemp, satPress } from './RefrigerationSolver.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const lerp = (a, b, f) => a + (b - a) * f;

export class AirConditioningSolver {
    constructor(sys) {
        this.sys = sys;

        this.m = {
            // 空气侧
            fresh: { temp: 32, rh: 70 },
            supply: { temp: 20, rh: 55 },
            cabin: {
                temp: 26, rh: 55,
                setStart: 24, setStop: 22, setRh: 60, setRhStop: 65,
                coolDemand: false, heatDemand: false, stopReached: false, frostSlow: false,
                swCool: false, swHeat: false, rhOn: false,
            },
            dp: 0,

            // 制冷剂侧
            pe: 4.0, pc: 14.0, te: 2, tc: 36, peOut: 4.0,
            psuc1: 3.9, pdis1: 13.9,
            running: false, loadPct: 0,
            oilP: 0,
            tcwIn: 32, tcwOut: 32, gw: 3.5, waterP: 2.5,

            // 控制
            mode: 'off',           // 工况：off / cool / heat
            loadMode: 'manual',    // 负荷选择开关（手动 / 自动负荷）：仅指示，不参与控制
            ctrlOn: false,
            expA: false, expB: false,
            masterSol: false, hotgas: false,
            fanOn: false,
            heating: false, humidifying: false, heatValve: 0,
            // 加热 / 加湿控制器（串级控制；默认不激活，激活后由控制器驱动蒸汽比例阀开度）
            // lock：制冷 / 制热工况下三个控制器锁定、不可手动切换
            ctl: {
                lock: false,
                heat: { active: false, target: 24, valve: 0, supplySet: 24, kp: 2.0 },
                humid: { active: false, target: 60, valve: 0, supplySet: 55, kp: 1.0 },
            },

            comps: {
                comp1: {
                    running: false, loadPct: 0, manualRun: false, oilLevel: 60,
                    mode: 'manual', startP: 3.5, diffP: 0.5, hpP: 18,
                    hpTripped: false, loTripped: false, oilSolOpen: false,
                    _startTimer: 0, _stopTimer: 0, _hpTimer: 0,
                },
            },
            oilsep: { comp1: 10 },
            receiver: 50,
            alarms: { comp1: { hp: false, loil: false, oilhi: false, wplow: false } },
            trip: false, tripReason: '', resetPulse: false,
        };

        this._params = {
            ambient: 34,        // 外界温度（新风取此值）
            kEnv: 0.30,         // 舱室围护漏热 kW/K
            cRoom: 150,         // 舱室热容 kJ/K
            qCapMax: 30,        // 满负荷制冷量 kW
            qHeatMax: 45,       // 满负荷加热量 kW（升温更快）
            copBase: 3.0,
            uaCond: 8.0,
            hpTrip: 16.5, wpLow: 0.5,
            oilDiff: 2.0,
        };

        // 故障开关（由故障设置界面写入）
        this.faults = {
            evapFrost: false,   // 蒸发器严重结霜：霜层热阻使传热恶化 → 制冷量大幅下降、舱温下降特别慢
            steamValve: false,  // 蒸汽加热比例阀卡滞不动作 → 制热工况阀门始终不开、舱温不上升
        };

        this._inited = false;
        this._lastMode = null;
    }

    /**
     * 工况初始化：设定外界（新风）/ 送风 / 船员舱室的温度与湿度。
     *   关：28℃ / 65%；制冷：35℃ / 70%；制热：12℃ / 50%。
     * 工况切换（含起动系统）时自动调用。
     */
    applyModeInit(mode) {
        const P = this._params, m = this.m;
        const T = (mode === 'cool') ? 35 : (mode === 'heat') ? 12 : 28;
        const H = (mode === 'cool') ? 70 : (mode === 'heat') ? 50 : 65;
        P.ambient = T;
        P.freshRh = H;
        if (m.fresh) { m.fresh.temp = T; m.fresh.rh = H; }
        if (m.supply) { m.supply.temp = T; m.supply.rh = H; }
        if (m.cabin) { m.cabin.temp = T; m.cabin.rh = H; m.cabin.stopReached = false; m.cabin.frostSlow = false; }
        // 制冷 / 制热工况：自动开启自动控制站风机
        if (mode === 'cool' || mode === 'heat') {
            const acs = (this.sys && this.sys.comps) ? this.sys.comps['acsys'] : null;
            if (acs && typeof acs.setRoomFan === 'function') acs.setRoomFan('cabin', true);
        }
        this._coolT = 0;             // 制冷除湿曲线重新计时
        this._lastMode = mode;
    }

    _ensureInit() {
        if (this._inited) return;
        // 初始舱温略高于启动温度，便于演示制冷投入
        this.m.cabin.temp = 28;
        this.m.cabin.rh = 55;
        this._inited = true;
    }

    solve(dt) {
        this._ensureInit();
        const m = this.m, P = this._params, comps = this.sys.comps || {};
        const acs = comps['acsys'];
        const c1 = m.comps.comp1;
        const F = this.faults || (this.faults = {});

        // 工况切换 → 按工况重新初始化空气参数（新风 / 送风 / 船员舱室）
        if (this._lastMode !== m.mode) this.applyModeInit(m.mode);

        // ── ① 读取组件控制状态 ──
        m.ctrlOn = (acs && typeof acs.isControllerOn === 'function') ? acs.isControllerOn() : true;
        m.fanOn = (acs && typeof acs.getRoomFan === 'function') ? acs.getRoomFan() : false;
        const hv = (id) => (acs && typeof acs.isHandValveOpen === 'function') ? acs.isHandValveOpen(id) : true;

        // ── ①b 三个控制器联动（由中央空调控制器工况决定）──
        //   制冷：制冷控制器激活，加热/加湿不工作；制热：加热/加湿激活，制冷不工作；两工况均锁定、不可手动切换。
        //   关：三个控制器可手动切换，但制冷控制器与加热/加湿互锁。
        if (m.mode === 'cool') {
            m.ctrlOn = true; m.ctl.heat.active = false; m.ctl.humid.active = false; m.ctl.lock = true;
        } else if (m.mode === 'heat') {
            m.ctrlOn = false; m.ctl.heat.active = true; m.ctl.humid.active = true; m.ctl.lock = true;
        } else {
            m.ctl.lock = false;
            if (m.ctrlOn) { m.ctl.heat.active = false; m.ctl.humid.active = false; }
            else if (m.ctl.heat.active || m.ctl.humid.active) m.ctrlOn = false;
        }
        if (acs && typeof acs.setController === 'function' && acs.isControllerOn() !== m.ctrlOn) acs.setController(m.ctrlOn);

        // 新风风门：新风量随风门开度
        const freshOpen = (acs && typeof acs.isDamperOpen === 'function')
            ? acs.isDamperOpen('fresh') : true;

        // 冷却水（低温冷却淡水系统）
        const cwOpen = hv('cw1');
        if (cwOpen) { m.waterP = lerp(m.waterP, 2.5, 0.15); m.gw = 3.5; }
        else { m.waterP = lerp(m.waterP, 0.2, 0.15); m.gw = 0.0; }

        // ── ② 复位 ──
        if (m.resetPulse) {
            m.trip = false; m.tripReason = '';
            m.alarms = { comp1: { hp: false, loil: false, oilhi: false, wplow: false } };
            c1.hpTripped = false; c1.loTripped = false;
            c1._hpTimer = 0; c1._startTimer = 0; c1._stopTimer = 0;
            if (m.cabin) { m.cabin.stopReached = false; m.cabin.frostSlow = false; }
            m.resetPulse = false;
        }

        // ── ③ 舱室温度双位控制（工况：制冷 / 制热 / 关）──
        const cab = m.cabin;
        if (m.mode === 'cool') {
            const wasDemand = cab.coolDemand;
            if (cab.temp >= cab.setStart) cab.coolDemand = true;
            else if (cab.temp <= cab.setStop) cab.coolDemand = false;
            // 锁存「本轮制冷已降到停止温度以下」：温度恰好越过阈值后立即回升，
            // 瞬时越限很容易被 500ms 轮询的流程判定漏掉，用标记保证判定可靠
            if (wasDemand && !cab.coolDemand) cab.stopReached = true;
            cab.heatDemand = false;
        } else if (m.mode === 'heat') {
            if (cab.temp <= cab.setStart) cab.heatDemand = true;
            else if (cab.temp >= cab.setStop) cab.heatDemand = false;
            cab.coolDemand = false;
        } else {
            cab.coolDemand = false; cab.heatDemand = false;
        }
        cab.swCool = !!cab.coolDemand;
        cab.swHeat = !!cab.heatDemand;

        // 加热 / 加湿由各自的控制器（串级）驱动，见 ⑥b / ⑥c

        // ── ④ 制冷需求 / 膨胀阀投入（与压缩机运行无关，先建立蒸发压力）──
        const demand = (m.mode === 'cool') && cab.coolDemand;
        const supplyPath = demand && hv('suc1') && hv('dis1');
        const span = Math.max(2, cab.setStart - cab.setStop + 4);
        const demandPct = demand ? clamp(35 + (cab.temp - cab.setStart) / span * 60, 20, 100) : 0;
        // 供液电磁阀 / 两路膨胀阀投入：控制器工作 + 有制冷需求 + 截止阀开启
        const expOn = !!m.ctrlOn && supplyPath;
        // 控制器逻辑：加热控制器激活时，温差 > 8℃ 投入两路输出电磁阀；温差 < 8℃ 仅投下边管路；
        //             未激活时按舱温负荷投切。总回路电磁阀：任一输出电磁阀工作即接通。
        let wantA, wantB;
        if (m.ctl.heat.active) {
            const dT = Math.abs(m.ctl.heat.target - cab.temp);
            wantA = dT > 8;
            wantB = true;
        } else {
            wantA = true;
            wantB = demandPct >= 50;
        }
        m.expA = expOn && wantA;                  // 上管膨胀阀（→ 蒸发器右边入口）
        m.expB = expOn && wantB;                  // 下管膨胀阀（→ 蒸发器左边入口）
        m.masterSol = m.expA || m.expB;
        m.hotgas = c1.running && c1.loadPct > 0 && c1.loadPct < 25;

        // ── ⑤ 压缩机运行判定（手动 / 自动 由压缩机操作台控制）──
        const needCool = supplyPath;
        const psuc = m.psuc1;
        let desired;
        if (c1.mode === 'manual') {
            c1._startTimer = 0; c1._stopTimer = 0;
            desired = !!c1.manualRun;
        } else {
            // 自动：压力继电器（入口压力高于启动压力 → 延时启动；低于启动压力−压差 → 延时停机）
            const startP = c1.startP, diffP = c1.diffP;
            let target;
            if (!needCool) target = false;
            else if (psuc > startP) target = true;
            else if (psuc < startP - diffP) target = false;
            else target = c1.running;
            if (target === true && !c1.running) {
                c1._stopTimer = 0; c1._startTimer = (c1._startTimer || 0) + dt;
                desired = c1._startTimer >= 4;
            } else if (target === false && c1.running) {
                c1._startTimer = 0; c1._stopTimer = (c1._stopTimer || 0) + dt;
                desired = c1._stopTimer < 5;
            } else {
                c1._startTimer = 0; c1._stopTimer = 0;
                desired = c1.running;
            }
        }
        if (m.trip || c1.hpTripped || c1.loTripped) desired = false;
        c1.running = desired;
        m.running = c1.running;

        // ── ⑥ 压缩机负荷率（按舱温偏离设定的程度）──
        let loadTarget = 0;
        if (c1.running) loadTarget = demandPct;
        c1.loadPct = lerp(c1.loadPct, loadTarget, c1.running ? 0.06 : 0.12);
        if (c1.loadPct < 0.5) c1.loadPct = 0;
        m.loadPct = c1.loadPct;

        // ── ⑥b 加热控制器（串级控制：回风温度 → 送风温度给定 → 蒸汽比例阀开度）──
        const HC = m.ctl.heat;
        if (HC.active) {
            // 一次控制：由给定值与回风温度（= 船员舱室温度）之差算出送风温度给定；
            // 送风温度高于设定温度，偏差越大送风温度越高（用于快速升温），且不超过 45℃
            const delta = clamp((HC.target - cab.temp) * HC.kp, -20, 40);
            HC.supplySet = clamp(cab.temp + delta, cab.temp - 8, 45);
            // 二次控制：由送风温度给定与实际送风温度之差决定阀开度
            HC.valve = clamp((HC.supplySet - m.supply.temp) * 18, 0, 100);
            // 蒸汽加热比例阀卡滞不动作：控制器给定再大，阀始终不开 → 制热时温度不上升
            if (F.steamValve) HC.valve = 0;
        } else HC.valve = 0;
        m.heating = HC.valve > 1;
        m.heatValve = HC.valve;

        // ── ⑥c 加湿控制器（串级控制：回风湿度 → 送风湿度给定 → 蒸汽比例阀开度）──
        const HMC = m.ctl.humid;
        if (HMC.active) {
            const delta = clamp((HMC.target - cab.rh) * HMC.kp, -35, 35);
            HMC.supplySet = clamp(cab.rh + delta, 0, 95);
            HMC.valve = clamp((HMC.supplySet - m.supply.rh) * 7, 0, 100);   // 送风湿度差 5% → 开度约 20%
        } else HMC.valve = 0;
        m.humidifying = HMC.valve > 1;

        // ── ⑦ 制冷剂热力状态 ──
        // 蒸发器严重结霜：霜层热阻使传热严重恶化 → 制冷量系数降到约 1/6（舱温下降特别慢）
        const frostK = F.evapFrost ? 0.16 : 1.0;
        const effCool = (m.expA || m.expB) && c1.running;
        // 蒸发温度：比舱温低 8~14℃（负荷越大温差越大）；无供液时向舱温回稳
        const teTarget = (m.expA || m.expB) ? (cab.temp - (8 + 6 * (demandPct / 100))) : cab.temp;
        m.te = lerp(m.te, clamp(teTarget, -10, 20), 0.05);
        m.pe = (m.expA || m.expB) ? clamp(satPress(m.te), 1.5, 8) : lerp(m.pe, 1.2, 0.03);
        // 蒸发器输出压力：两路同时工作时为 pe，仅一路工作时减半
        m.peOut = (m.expA && m.expB) ? m.pe : ((m.expA || m.expB) ? m.pe / 2 : m.pe);

        // 吸气压力：入口截止阀开启时 = 蒸发压力 − 0.1
        m.psuc1 = hv('suc1') ? (m.pe - 0.1) : lerp(m.psuc1, 0.1, 0.03);

        // 排气压力：冷却水正常 = 吸气 + 10；断流时持续上升趋近 30bar
        if (c1.running) m.pdis1 = cwOpen ? lerp(m.pdis1, m.psuc1 + 10, 0.1) : lerp(m.pdis1, 30, 0.01);
        else m.pdis1 = lerp(m.pdis1, m.psuc1, 0.05);
        m.pc = m.pdis1;

        // 冷凝温度
        const tcwAvg = (m.tcwIn + m.tcwOut) / 2;
        const Qc = m.running ? P.qCapMax * (c1.loadPct / 100) * 1.25 : 0;
        const tcTarget = m.running ? (tcwAvg + 4 + Qc / P.uaCond) : m.tcwIn;
        m.tc = lerp(m.tc, clamp(tcTarget, m.tcwIn, 75), 0.05);
        const cp = 4.187, gwKg = Math.max(0.001, m.gw) * 1000 / 3600;
        m.tcwOut = m.running ? clamp(m.tcwIn + Qc / (gwKg * cp), m.tcwIn, m.tcwIn + 18) : lerp(m.tcwOut, m.tcwIn, 0.1);
        m.oilP = m.running ? (m.pe + P.oilDiff) : 0;

        // ── ⑧ 空气侧温度 / 湿度 ──
        m.fresh.temp = P.ambient;
        m.fresh.rh = (P.freshRh !== undefined) ? P.freshRh : 70;
        // 混合温度：新风（若风门关则全部回风）与回风按比例
        const freshRatio = freshOpen ? 0.35 : 0.0;
        const mixedTemp = freshRatio * m.fresh.temp + (1 - freshRatio) * cab.temp;
        let supplyTemp = mixedTemp;
        if (effCool) supplyTemp -= (14 + 6 * (c1.loadPct / 100)) * (m.fanOn ? 1 : 0.3) * frostK;
        if (m.heating) supplyTemp += 10 * (m.heatValve / 100);
        m.supply.temp = lerp(m.supply.temp, supplyTemp, 0.08);
        // 送风湿度：加湿器提升
        let supplyRh = freshRatio * m.fresh.rh + (1 - freshRatio) * cab.rh;
        supplyRh += 18 * ((m.ctl.humid.valve || 0) / 100);   // 加湿效果与阀开度成正比
        if (m.mode === 'cool') {
            // 制冷模式：送风湿度随蒸发器除湿按时间曲线逐渐下降
            //   0~3min：70% → 60%；随后 10min：60% → 50%（之后维持 50%）
            this._coolT = (this._coolT || 0) + dt;
            const t = this._coolT;
            const prof = (t <= 180) ? 70 - (10 / 180) * t
                : (t <= 780) ? 60 - (10 / 600) * (t - 180)
                : 50;
            m.supply.rh = clamp(prof, 50, 70);
        } else {
            this._coolT = 0;
            m.supply.rh = clamp(lerp(m.supply.rh, supplyRh, 0.08), 10, 95);
        }

        // ── ⑨ 舱室温度 / 湿度积分 ──
        const Qcool = (effCool && m.fanOn) ? P.qCapMax * (c1.loadPct / 100) * frostK : 0;
        const Qheat = m.heating ? P.qHeatMax * (m.heatValve / 100) : 0;
        const Qenv = P.kEnv * (P.ambient - cab.temp);      // 漏热（外界向舱内）
        const Qair = m.fanOn ? (Qcool > 0 ? -(mixedTemp - (supplyTemp)) * 0.4 : 0) : 0;
        const dT = (Qenv + Qheat - Qcool + Qair) * dt / P.cRoom;
        cab.temp = clamp(cab.temp + dT, 10, 45);
        // 结霜后制冷能力大幅下降 → 舱温下降速度极慢（用于流程判别「降温特别慢」）
        // 正常制冷约 -0.15℃/s；结霜后仅约 -0.02~-0.03℃/s。判定后锁存，故障排除即清除。
        const coolRate = dt > 0 ? (dT / dt) : 0;
        if (F.evapFrost && m.mode === 'cool' && effCool && m.fanOn && coolRate > -0.06) cab.frostSlow = true;
        else if (!F.evapFrost) cab.frostSlow = false;
        // 湿度：加湿器提升，否则向送风湿度缓变
        if (m.humidifying) cab.rh = clamp(cab.rh + 4 * ((m.ctl.humid.valve || 0) / 100) * dt, 20, 90);   // 加湿速率与阀开度成正比（整体放慢）
        else cab.rh = lerp(cab.rh, m.supply.rh, 0.01);

        // 过滤段差压：与风量（风机运行）相关，积尘/阻力正常
        m.dp = m.fanOn ? lerp(m.dp, 0.18, 0.1) : lerp(m.dp, 0.0, 0.1);

        // ── ⑩ 滑油系统 ──
        let lvl = (m.oilsep.comp1 !== undefined) ? m.oilsep.comp1 : 10;
        if (c1.running) {
            lvl += (5 / 60) * dt;
            c1.oilLevel = clamp(c1.oilLevel - (1.5 / 60) * dt, 0, 100);
        }
        if (lvl >= 22) c1.oilSolOpen = true;
        else if (lvl <= 4) c1.oilSolOpen = false;
        if (c1.oilSolOpen) { lvl -= 0.8 * dt; c1.oilLevel = clamp(c1.oilLevel + 0.3 * dt, 0, 100); }
        if (hv('oil1-in')) c1.oilLevel = clamp(c1.oilLevel + 2 * dt, 0, 100);
        if (hv('oil1-out')) c1.oilLevel = clamp(c1.oilLevel - 1.5 * dt, 0, 100);
        m.oilsep.comp1 = clamp(lvl, 0, 100);

        // 储液罐（接收器）液位：满液约 50%，随负荷升高略降
        m.receiver = clamp(50 - m.loadPct * 0.20, 25, 60);

        // ── ⑪ 报警与保护 ──
        const a = m.alarms.comp1;
        // 排出压力过高（延时 3s 锁存，需复位）
        if (m.pdis1 > c1.hpP) {
            c1._hpTimer = (c1._hpTimer || 0) + dt;
            if (c1._hpTimer >= 3) { c1.hpTripped = true; if (!m.tripReason) m.tripReason = '压缩机排出压力过高'; }
        } else if (!c1.hpTripped) c1._hpTimer = 0;
        a.hp = !!c1.hpTripped;
        // 淡水压力过低（只报警不停机）
        a.wplow = (m.waterP < P.wpLow) || !cwOpen;
        // 滑油液位过低 → 保护停机（锁存）
        a.loil = (c1.oilLevel || 0) < 15;
        if (a.loil && !c1.loTripped) { c1.loTripped = true; m.tripReason = '压缩机滑油液位过低'; }
        // 油分液位过高
        a.oilhi = m.oilsep.comp1 > 30;

        this._writeBack();
    }

    _writeBack() {
        const comps = this.sys.comps || {};
        Object.values(comps).forEach(c => {
            if (c && c.type === 'air_conditioning_system' && typeof c.acceptModel === 'function') {
                c.acceptModel(this.m);
            }
        });
    }

    reset() { this._inited = false; }
}

export default AirConditioningSolver;
