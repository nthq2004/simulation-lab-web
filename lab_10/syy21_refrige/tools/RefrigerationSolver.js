/**
 * RefrigerationSolver —— 制冷循环物理求解器（2 台压缩机 + 5 个冷库）
 *
 * 工程：制冷系统的自动控制、安全保护及故障处理（syy21_refrige）
 *
 * 回路：两台压缩机并联于同一吸气总管；每台压缩机排出经各自油液分离器 →
 *       各自冷凝器（壳管式，低温冷却淡水冷却）；冷凝液汇入接收器 → 干燥&过滤
 *       → 回热器 → 5 个冷库膨胀阀 → 各库蒸发器 → 回气总管 → 压缩机。
 *
 * 制冷剂：R407C（近似饱和特性，R407C_P/T 查表）。
 * 库房：干货库 dry / 粮库 grain / 菜库 veg / 鱼库 fish / 肉库 meat。
 *
 * 20fps 逐步松弛；结果回写 RefrigerationSystem 组件与各面板（读 model）。
 */

const R407C_P = [1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0, 5.5, 6.0,
    7.0, 8.0, 9.0, 10.0, 11.0, 12.0, 13.0, 14.0, 15.0, 16.0, 17.0, 18.0];
const R407C_T = [-51, -42, -34, -27, -20, -14, -8, -3, 2, 6.5, 11,
    19.5, 27.5, 35, 42, 48.5, 54.5, 60.5, 66, 71, 76, 81, 86];

export function satTemp(P) {
    if (!(P > 0)) return R407C_T[0];
    const n = R407C_P.length;
    if (P <= R407C_P[0]) return R407C_T[0];
    if (P >= R407C_P[n - 1]) return R407C_T[n - 1];
    for (let i = 0; i < n - 1; i++) {
        if (P >= R407C_P[i] && P <= R407C_P[i + 1]) {
            const f = (P - R407C_P[i]) / (R407C_P[i + 1] - R407C_P[i]);
            return R407C_T[i] + f * (R407C_T[i + 1] - R407C_T[i]);
        }
    }
    return R407C_T[n - 1];
}

export function satPress(T) {
    const n = R407C_T.length;
    if (T <= R407C_T[0]) return R407C_P[0];
    if (T >= R407C_T[n - 1]) return R407C_P[n - 1];
    for (let i = 0; i < n - 1; i++) {
        if (T >= R407C_T[i] && T <= R407C_T[i + 1]) {
            const f = (T - R407C_T[i]) / (R407C_T[i + 1] - R407C_T[i]);
            return R407C_P[i] + f * (R407C_P[i + 1] - R407C_P[i]);
        }
    }
    return R407C_P[n - 1];
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const lerp = (a, b, f) => a + (b - a) * f;

const ROOM_DEFS = [
    { key: 'dry', name: '干货库', setStart: 6, setStop: 1, init: 5 },
    { key: 'grain', name: '粮库', setStart: 6, setStop: 1, init: 6 },
    { key: 'veg', name: '菜库', setStart: 6, setStop: 1, init: 3 },
    { key: 'fish', name: '鱼库', setStart: 6, setStop: 1, init: 7 },
    { key: 'meat', name: '肉库', setStart: -16, setStop: -20, init: -20 },
];

export class RefrigerationSolver {
    constructor(sys) {
        this.sys = sys;

        this.m = {
            pe: 4.6, pc: 10.0, te: -3, tc: 40,
            tsh: 5, tsc: 3, tsuction: 2, tdischarge: 70, mflow: 0,
            running: false, mode: 'auto', loadPct: 0,
            oilP: 0,
            tcwIn: 30, tcwOut: 30, gw: 3.5, waterP: 0.2,
            rooms: {},
            activeRoom: 'dry', activeComp: 'comp1',
            comps: {
                comp1: { running: false, loadPct: 0, manualRun: false, oilLevel: 70 },
                comp2: { running: false, loadPct: 0, manualRun: false, oilLevel: 70 },
            },
            oilsep: { comp1: 40, comp2: 25 },
            receiver: 45,
            alarms: {
                comp1: { hp: false, loil: false, oilhi: false, wplow: false },
                comp2: { hp: false, loil: false, oilhi: false, wplow: false },
            },
            trip: false, tripReason: '', resetPulse: false,
        };

        this._params = {
            ambient: 32,
            kEnv: 0.10,        // 每库围护漏热 kW/K
            cRoom: 110,        // 每库热容 kJ/K
            uaEvap: 3.5,       // 蒸发器总传热 kW/K
            uaCond: 6.0,       // 冷凝器传热 kW/K
            qCapMax: 24,       // 两机满负荷总制冷量 kW
            copBase: 2.8,
            hpTrip: 16.5, wpLow: 0.5,
            oilDiff: 2.0, oilLowDiff: 0.8,
        };

        this._demand = false;
        this._inited = false;
    }

    _ensureInit() {
        if (this._inited) return;
        const m = this.m;
        m.rooms = {};
        ROOM_DEFS.forEach(d => {
            // 若绑定的组件带同名库房配置，则以组件配置为准
            m.rooms[d.key] = {
                name: d.name, temp: d.init, setStart: d.setStart, setStop: d.setStop,
                valve: 0, cooling: false, alarm: false,
                fanOn: true,      // 蒸发器风机（带灯按钮控制：上=起动、下=停止）
            };
        });
        this._inited = true;
    }

    solve(dt) {
        this._ensureInit();
        const m = this.m, P = this._params, comps = this.sys.comps || {};

        // ── ① 控制输入（操作台） ──
        const panel = comps['cpanel'];
        if (panel) m.mode = panel.mode || m.mode;

        const pump = comps['cwpump'];
        if (pump) {
            const pumpOn = !!pump.pumpOn;
            m.waterP = lerp(m.waterP, pumpOn ? 2.5 : 0.2, 0.15);
            m.gw = pumpOn ? 3.5 : 0.0;
        } else {
            // 无独立淡水泵组件时，默认冷却水系统正常投用
            m.waterP = 2.5;
            m.gw = 3.5;
        }

        // ── ② 温控逻辑（滞环） ──
        let anyAbove = false, allBelow = true;
        for (const k in m.rooms) {
            const r = m.rooms[k];
            if (r.temp >= r.setStart) anyAbove = true;
            if (r.temp > r.setStop) allBelow = false;
        }
        if (anyAbove) this._demand = true;
        else if (allBelow) this._demand = false;

        // ── ③ 复位 ──
        if (m.resetPulse) {
            m.trip = false; m.tripReason = '';
            m.alarms = { comp1: { hp: false, loil: false, oilhi: false, wplow: false }, comp2: { hp: false, loil: false, oilhi: false, wplow: false } };
            m.resetPulse = false;
        }

        // ── ④ 安全保护（跳闸锁存） ──
        if (m.pc > P.hpTrip) { m.trip = true; m.tripReason = '排出压力过高'; }
        if (m.waterP < P.wpLow) { m.trip = true; m.tripReason = '淡水压力过低'; }

        // ── ⑤ 运行判定（每台压缩机） ──
        ['comp1', 'comp2'].forEach(id => {
            const c = m.comps[id];
            let desired = (m.mode === 'manual') ? c.manualRun : this._demand;
            if (m.trip) desired = false;
            c.running = desired;
            c.loadPct = lerp(c.loadPct, c.running ? 100 : 0, c.running ? 0.06 : 0.12);
            if (c.loadPct < 0.5) c.loadPct = 0;
        });
        m.running = m.comps.comp1.running || m.comps.comp2.running;
        const runningCount = (m.comps.comp1.running ? 1 : 0) + (m.comps.comp2.running ? 1 : 0);
        m.loadPct = runningCount ? (m.comps.comp1.loadPct + m.comps.comp2.loadPct) / runningCount : 0;

        // ── ⑥ 各库制冷需求与分配 ──
        // 库内蒸发器风机由带灯按钮控制；风机停机则该库不制冷（供液电磁阀随之关闭）
        const rsys = comps['refsys'];
        let totalLoad = 0;
        for (const k in m.rooms) {
            const r = m.rooms[k];
            r.fanOn = (rsys && typeof rsys.getRoomFan === 'function') ? rsys.getRoomFan(k) : true;
            r.cooling = m.running && r.fanOn && (r.temp > r.setStop);
            r.load = Math.max(0.05, P.kEnv * (P.ambient - r.temp));
            if (r.cooling) totalLoad += r.load;
        }

        // ── ⑦ 热力平衡 ──
        const trAvg = this._avgRoomTemp();
        const Qcap = P.qCapMax * runningCount * (m.loadPct / 100);
        const teTarget = m.running ? (trAvg - Qcap / P.uaEvap) : trAvg;
        m.te = lerp(m.te, clamp(teTarget, -35, 15), 0.05);
        m.pe = satPress(m.te);
        const Qe = clamp(P.uaEvap * (trAvg - m.te), 0, Qcap * 1.1);

        const cop = Math.max(1.3, P.copBase * ((m.te + 273.15) / Math.max(5, (m.tc - m.te))));
        const Wcomp = Qe / cop;
        const Qc = Qe + Wcomp;
        const tcwAvg = (m.tcwIn + m.tcwOut) / 2;
        const tcTarget = m.running ? (tcwAvg + 0.4 + Qc / P.uaCond) : m.tcwIn;
        m.tc = lerp(m.tc, clamp(tcTarget, m.tcwIn, 75), 0.05);
        m.pc = satPress(m.tc);

        const cp = 4.187;
        const gwKg = Math.max(0.001, m.gw) * 1000 / 3600;
        m.tcwOut = m.running ? clamp(m.tcwIn + Qc / (gwKg * cp), m.tcwIn, m.tcwIn + 15) : lerp(m.tcwOut, m.tcwIn, 0.1);

        m.tsuction = m.te + m.tsh;
        m.tdischarge = m.running ? clamp(m.tc + 25 + 6 * (m.pc / Math.max(1, m.pe) - 1) * 4, m.tc + 10, 120) : m.tcwIn;
        m.mflow = Qe > 0 ? Qe / 180 : 0;
        m.oilP = m.running ? (m.pe + P.oilDiff) : 0;

        // ── ⑧ 库温积分 ──
        for (const k in m.rooms) {
            const r = m.rooms[k];
            const cool_i = (r.cooling && totalLoad > 0.001) ? Qe * (r.load / totalLoad) : 0;
            r.temp = clamp(r.temp + (r.load - cool_i) * dt / P.cRoom, -30, 40);
            r.valve = r.cooling ? clamp(8 + m.loadPct * 0.3, 0, 100) : 0;
            r.alarm = m.trip || (r.temp > r.setStart + 8);
        }

        // ── ⑨ 附属显示量 ──
        m.oilsep.comp1 = clamp(30 + m.comps.comp1.loadPct * 0.55, 0, 92);
        m.oilsep.comp2 = clamp(20 + m.comps.comp2.loadPct * 0.55, 0, 92);
        m.receiver = clamp(40 + m.loadPct * 0.3, 0, 90);

        // ── ⑩ 报警 ──
        ['comp1', 'comp2'].forEach(id => {
            const c = m.comps[id], a = m.alarms[id];
            a.hp = m.pc > P.hpTrip;
            a.wplow = m.waterP < P.wpLow;
            a.loil = c.running && (m.oilP - m.pe) < P.oilLowDiff;
            a.oilhi = (id === 'comp1' ? m.oilsep.comp1 : m.oilsep.comp2) > 85;
        });

        this._writeBack();
    }

    _avgRoomTemp() {
        const keys = Object.keys(this.m.rooms);
        if (!keys.length) return 8;
        let s = 0; keys.forEach(k => s += this.m.rooms[k].temp);
        return s / keys.length;
    }

    _writeBack() {
        const comps = this.sys.comps || {};
        const m = this.m;
        Object.values(comps).forEach(c => {
            if (c && c.type === 'refrigeration_system' && typeof c.acceptModel === 'function') {
                c.acceptModel(m);
            }
        });
    }

    reset() { this._inited = false; }
}

export default RefrigerationSolver;
