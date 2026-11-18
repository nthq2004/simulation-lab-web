/**
 * FuelSupplySolver — FCM 燃油供油单元 + EPC-50B 控制器过程模型
 * ═══════════════════════════════════════════════════════════════════════════
 *  依据：第六章第二节《燃油供油单元自动控制系统》
 *    · 图 6-2-1 组成原理图（HFO/DO 日用柜 → 转换阀 CV → 供油泵 SPB →
 *      自动滤器 AFB（带压差开关 PDS）→ 流量/压力变送器 FT/PT →
 *      带脱气的混合筒（浮子开关 LS、脱气阀）→ 循环泵 CPB →
 *      蒸汽加热器 SHS（调节阀 SRV）→ PT/TT/VT20 → 主机，压力控制阀返回日用柜）
 *    · 第三部分：燃油黏度控制系统（Pr19/Pr20/Pr30/Pr35、Fa30/Fa31 温升斜坡、
 *      Fa25~Fa28 PI 参数、TT/VT 指示灯）
 *    · 第四部分：综合控制（DO/HFO 转换、泵运行/备用 Pr1/Pr2、滤器自动冲洗、
 *      脱气自动控制、远程控制）
 *    · 第五部分：参数管理（Pr23/Pr30/Pr32 等）与故障一览表 6-2-3
 *
 *  说明：本模型只做教学级过程仿真 —— 温度按温升速率斜坡推进（可加速），
 *  黏度由油温与油品按指数曲线换算，泵/滤器/脱气按文中所述的联锁与定时逻辑运行。
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

/** HFO 油品等级：各自「12 cSt」对应的温度（油品号越大越稠，同温度下黏度越高） */
export const HFO_GRADE_T = { 1: 120, 2: 135, 3: 150 };
export const HFO_GRADE_CN = { 1: '油品1（120℃@12cSt）', 2: '油品2（135℃@12cSt）', 3: '油品3（150℃@12cSt）' };
/** HFO 黏度—温度曲线（按油品等级平移）：ν = 12 · e^(−0.033·(T − T等级)) */
const viscHFO = (T, grade = 2) => 12 * Math.exp(-0.0152 * (T - (HFO_GRADE_T[grade] || 135)));
/** DO 黏度—温度曲线（40 ℃ = 10 cSt，70 ℃ ≈ 7 cSt） */
const viscDO = (T) => 10 * Math.exp(-0.01189 * (T - 40));

/** 泵工作方式档位（四档，与本地面板选择开关一致） */
export const PUMP_MODES = ['MAN', 'STOP', 'EPC', 'REM'];
export const PUMP_MODE_CN = { MAN: 'MAN（手动）', STOP: 'STOP（停止）', EPC: 'EPC（自动）', REM: 'REM（远程）' };
export const FILTER_MODES = ['DRAIN', 'MAN', 'STOP', 'AUTO'];

const AMBIENT = 30;
/** 控制死区：偏差在该范围内保持调节阀开度不变（抑制 SRV 高频 +/- 动作） */
const SRV_STEP = 0.5;      // 电动调节阀每个脉冲的开度增量（%）
const SRV_PULSE_DT = 0.1;  // 脉冲间隔（s）→ 最大行程 5 %/s
const DEADBAND_T = 1.0;    // 温度 ±1.0 ℃
const DEADBAND_V = 0.5;    // 黏度 ±0.5 cSt

function mkPump(id, name, kind) {
    return {
        id, name, kind,            // kind: 'supply' | 'circ'
        mode: 'STOP',              // MAN / STOP / EPC / REM
        mainSwitch: false,         // 本地 MAIN SWITCH
        aux: false,                // 辅助电压指示
        on: false,
        current: 0,
        fault: false,
        overload: false,
        startDelay: 0,
        runtime: 0,
    };
}

function createModel() {
    return {
        clock: 0,
        mainPower: true,         // 控制箱总电源（本仿真默认已送电）
        epcPower: true,          // OP 面板 / EPC-50B 电源（始终带电）
        procOn: false,           // START/STOP：工艺投入

        oilMode: 'DO',           // 当前燃油模式 DO / HFO（默认三通阀在 DO 位）
        ctrlKind: 'TEMP',        // Pr19：TEMP / VISC（DO 模式默认温度控制）
        pendingMode: null,       // 待确认的转换目标
        pendingProc: null,       // 待确认的 START/STOP（true=起动 / false=停止）
        changing: false,
        changeT: 0,

        cv: 'DO',                // 三通转换阀实际位置（默认 DO）
        cvPos: 0,                // 转换阀 HFO 侧开度 0~100 %
        cvSwitching: false,      // 阀正在动作（行程 10 s）
        cvT: 0, cvFrom: 0, cvTo: 0,
        prog: { active: false, sp: 0, target: 0, dir: 1 },   // 程序升温/降温
        prevKind: 'TEMP',        // 换油前控制方式（灯逻辑用）
        lamp: { tt: 'on', vt: 'off', hfo: 'off', do: 'on' },   // 指示灯：on 常亮 / blink 闪烁 / off 灭
        mix: 0.139,              // 1 = 全 HFO，0 = 全 DO（初值使 60℃→12 cSt、70℃≈10 cSt）

        oil: {
            temp: 60,                // 混油筒初始油温 60 ℃
            visc: 12,                // 混油筒初始黏度 12 cSt（60 ℃ 混合油）
            spBuildT: 0,             // 供油侧建压计时（泵起动后 3 s 才开始建压）
            cpBuildT: 0,             // 循环侧建压计时
            ttVal: 0,                // TT 测量值（无流动时为 0）
            vtVal: 0,                // VT 测量值（无流动时为 0）
            flow: 0,
            demand: 40,          // 主机消耗百分比（教学固定值）
            supplyPress: 0,
            circPress: 0,
            dp: 0.02,
        },

        heater: {
            regMode: 'MAN',      // 调节阀 MAN / EPC（默认 MAN）
            power: 0,            // 0~100 %
            manualPower: 96,     // MAN 方式下的加热量（DECR/INCR 设定；96 + 伴行 4 = 开度 100 %）
            shs: 100,            // 蒸汽调节阀开度 %（电关型：未投入/失电时全开）
            tracing: 1,          // 加热伴行 0 / 1（默认 1）
            stage: 'OFF',
        },

        ctrl: { kind: 'VISC', sp: 20, stage: 'OFF', integral: 0, rampLimit: 0 },

        pumps: {
            sp1: mkPump('sp1', '1 号供油泵', 'supply'),
            sp2: mkPump('sp2', '2 号供油泵', 'supply'),
            cp1: mkPump('cp1', '1 号循环泵', 'circ'),
            cp2: mkPump('cp2', '2 号循环泵', 'circ'),
        },
        pumpCtl: 'EPC',          // EPC PUMP CONTROL 旋钮：LOCAL / EPC
        switchover: { supply: false, circ: false },
        manualValves: { sp1: false, sp2: false, cp1: false, cp2: false, sh1: false, sh2: false },   // 各支路手动截止阀：默认全关（起动系统时开启）
        steamSV: { sh1: false, sh2: false },  // 两台加热器进汽手动截止阀：默认全关
        ftValves: { in: false, by: true },       // FT 进口阀（默认断开）/ 旁通阀（默认闭合=导通）
        ftPath: 'bypass',      // 当前油路：'ft' 走 FT / 'bypass' 走旁通 / 'blocked' 两阀全关
        vtValves: { in: true, par: false },  // 与 VT 串联的进口阀（默认导通）/ 与 VT 并联的截止阀（默认截止）
        vtPath: 'vt',          // VT 回路：'vt' / 'bypass' / 'both' / 'blocked'
        tankTemps: { hfo: 70, do: 40 },   // 两日用柜的油温（固定）
        tank: { level: 50, temp: 60, press: 0.45 },   // 混油筒：液位 %、油温 ℃、筒内油压 MPa（由液位决定）
        engineLoad: 50,        // 柴油机负荷 0~100 %（默认 50%）
        tankCtrl: '',          // 液位联锁状态：'stop' 高位停泵 / 'start' 低位起泵
        strainerSel: 'af',        // 滤器手动三通转换阀同步选位：'mf'=手动滤器(上) / 'af'=自动滤器(下)

        filter: {
            mode: 'STOP',        // MAN / STOP / AUTO
            mainSwitch: false,
            flushing: false,
            flushT: 0,
            nextIn: 120,
            dp: 0.02,
            pds: false,
            flushKind: 'drain',  // 本次冲洗性质：'clean' 清洗（压差/手动） / 'drain' 周期性卸放
            overload: false,
        },

        dea: { valve: false, level: 62, t: 0, alarm: false },

        params: {
            Pr1: 12, Pr2: 12,
            Pr10: 1, Pr11: 0.15,
            Pr19: 'VISC', Pr20: 12, Pr23: 0.99, Pr24: 2,   // Pr20：黏度设定；Pr24：HFO 油品等级 1/2/3
            Pr30: 135, Pr32: 90, Pr35: 70,   // Pr30：当前油品对应的目标温度（随 Pr24 变化）；Pr35：DO 温度定值设定
            Fa8: 30, Fa9: 6, Fa10: 1, Fa11: 5,
            Fa14: 30, Fa16: 80, Fa17: 1200,
            Fa21: 2, Fa22: 8,
            Fa25: 12, Fa26: 40, Fa27: 8, Fa28: 30,
            Fa30: 60, Fa31: 60,  // Fa30：HFO 温升速率；Fa31：程序升/降温速率（均 60 ℃/min，加快仿真）
        },

        faults: {
            vt: false, tt: false, cv: false, srv: false,
            pump1: false, pump2: false, cp1: false, power: false, filter: false,
        },

        alarms: [],
        alarmActive: false,
        t: {},                   // 各类延时定时器
        bootT: 0,                // 失电恢复延时计数
        infoPage: 0,
    };
}

export class FuelSupplySolver {
    constructor(sys) {
        this.sys = sys;
        this.cfg = {
            timeScale: 1,        // 全局时间倍率
            heatAccel: 30,       // 温升加速（教学用：把 Fa30 的 ℃/min 放大 30 倍）
        };
        this.m = createModel();
        /** 供油泵 / 循环泵停机等待起动的序号（Fa10 间隔） */
        this._startQueue = 0;
    }

    _tip(msg) {
        if (this.sys && typeof this.sys._tipPurifier === 'function') this.sys._tipPurifier(msg);
    }

    // ═══════════════════════════════════════════════════════════
    //  参数
    // ═══════════════════════════════════════════════════════════
    getParam(key) { return this.m.params[key]; }

    setParam(key, val) {
        const m = this.m;
        if (!(key in m.params)) return false;
        if (key === 'Pr19') {
            const v = (String(val).toUpperCase() === 'TEMP') ? 'TEMP' : 'VISC';
            m.params.Pr19 = v;
            m.ctrlKind = v;
            this._tip(`Pr19 = ${v}：HFO 模式下按${v === 'TEMP' ? '温度' : '黏度'}定值控制`);
            return true;
        }
        if (key === 'Pr24') {
            const v = Number(val);
            if (![1, 2, 3].includes(v)) return false;
            m.params.Pr24 = v;
            // Pr30 = 当前油品对应的目标温度（12 cSt 对应温度 120 / 135 / 150 ℃）
            m.params.Pr30 = HFO_GRADE_T[v];
            this._tip(`Pr24 = ${v}：HFO ${HFO_GRADE_CN[v]}；Pr30 自动更新为 ${m.params.Pr30} ℃`);
            return true;
        }
        if (key === 'Pr1' || key === 'Pr2') {
            const allow = [1, 2, 12, 21];
            const v = Number(val);
            if (!allow.includes(v)) return false;
            m.params[key] = v;
            this.resetSwitchover(key === 'Pr1' ? 'supply' : 'circ');
            this._tip(`${key} = ${v}：${this._planText(key)}`);
            return true;
        }
        const v = Number(val);
        if (!Number.isFinite(v)) return false;
        m.params[key] = v;
        if (key === 'Pr30' || key === 'Pr35' || key === 'Pr20') {
            this._tip(`${key} = ${v}`);
        }
        return true;
    }

    _planText(key) {
        const v = String(this.m.params[key]);
        const n = key === 'Pr1' ? '供油泵' : '循环泵';
        return ({
            '1': `${n}：只对 1 号机发控制命令（2 号停止）`,
            '2': `${n}：只对 2 号机发控制命令（1 号停止）`,
            '12': `${n}：1# 主用、2# 备用（显示 1(2)）`,
            '21': `${n}：2# 主用、1# 备用（显示 2(1)）`,
        })[v] || '';
    }

    // ═══════════════════════════════════════════════════════════
    //  电源与工艺投停
    // ═══════════════════════════════════════════════════════════
    setMainPower(on) {
        const m = this.m;
        on = !!on;
        if (m.mainPower === on) return;
        m.mainPower = on;
        if (!on) {
            m.epcPower = false;
            m.procOn = false;
            Object.values(m.pumps).forEach(p => { p.on = false; p.current = 0; });
            m.heater.power = 0;
        } else {
            m.bootT = m.params.Fa11;
        }
    }

    setEpcPower(on) {
        const m = this.m;
        on = !!on;
        m.epcPower = on;
        if (!on) {
            m.procOn = false;
            Object.values(m.pumps).forEach(p => { if (p.mode === 'EPC' || p.mode === 'REM') { p.on = false; p.current = 0; } });
            m.heater.power = 0;
        } else {
            m.bootT = m.params.Fa11;
        }
    }

    setProc(on) {
        const m = this.m;
        on = !!on;
        if (on && !m.epcPower) { this._tip('请先合上 EPC-50B 的 POWER SWITCH'); return false; }
        m.procOn = on;
        if (on) {
            m.bootT = 0;      // 面板常带电，无失电恢复延时
            // 每次起动都从 Pr1/Pr2 的主泵重新开始（清除上次遗留的备用投入状态）
            m.t.sw_supply = 0; m.t.sw_circ = 0;
            this.resetSwitchover('supply');
            this.resetSwitchover('circ');
            this._tip('工艺投入：供油泵、循环泵按 Pr1/Pr2 起动，加热器投入自动控制');
        } else {
            this._tip('工艺停止：泵停止、加热器切除，控制器仍监视参数');
        }
        return true;
    }

    // ═══════════════════════════════════════════════════════════
    //  泵：本地开关 / 选择开关
    // ═══════════════════════════════════════════════════════════
    setPumpMainSwitch(id, on) {
        const p = this.m.pumps[id];
        if (!p) return false;
        p.mainSwitch = !!on;
        if (!p.mainSwitch) { p.on = false; p.current = 0; }
        return true;
    }

    setPumpMode(id, mode) {
        const p = this.m.pumps[id];
        if (!p || !PUMP_MODES.includes(mode)) return false;
        p.mode = mode;
        if (mode === 'STOP') { p.on = false; p.current = 0; }
        this._tip(`${p.name} 选择开关：${PUMP_MODE_CN[mode]}`);
        return true;
    }

    /** 旋钮顺时针/逆时针换档（到端点不循环） */
    cyclePumpMode(id, dir = 1) {
        const p = this.m.pumps[id];
        if (!p) return false;
        const i = PUMP_MODES.indexOf(p.mode);
        const next = clamp(i + (dir > 0 ? 1 : -1), 0, PUMP_MODES.length - 1);
        if (next === i) {
            this._tip(`${p.name} 选择开关已在端点「${PUMP_MODES[i]}」`);
            return false;
        }
        return this.setPumpMode(id, PUMP_MODES[next]);
    }

    cycleFilterMode(dir = 1) {
        const f = this.m.filter;
        const i = FILTER_MODES.indexOf(f.mode);
        const next = clamp(i + (dir > 0 ? 1 : -1), 0, FILTER_MODES.length - 1);
        if (next === i) return false;
        f.mode = FILTER_MODES[next];
        this._tip(`自动滤器选择开关：${f.mode}`);
        return true;
    }

    /** 手动开/关泵支路竖置截止阀（true=导通） */
    toggleBranchValve(id) {
        const m = this.m;
        if (!m.manualValves || !(id in m.manualValves)) return false;
        m.manualValves[id] = !m.manualValves[id];
        const name = m.pumps[id] ? m.pumps[id].name : (id === 'sh1' ? '1 号加热器' : id === 'sh2' ? '2 号加热器' : id);
        this._tip(`${name} 支路手动截止阀：${m.manualValves[id] ? '打开（导通）' : '关闭'}`);
        return m.manualValves[id];
    }

    /** FT 进口阀 / 旁通阀（串联进口阀+FT，旁通阀与之并联）：手动开/关 */
    toggleFtValve(k) {
        const m = this.m;
        if (!m.ftValves || !(k in m.ftValves)) return false;
        m.ftValves[k] = !m.ftValves[k];
        this._tip(`FT ${k === 'in' ? '进口阀' : '旁通阀'}：${m.ftValves[k] ? '导通' : '断开'}`);
        return m.ftValves[k];
    }

    /** VT 回路进口阀 / 并联阀（手动截止阀）：开/关 */
    toggleVtValve(k) {
        const m = this.m;
        if (!m.vtValves || !(k in m.vtValves)) return false;
        m.vtValves[k] = !m.vtValves[k];
        this._tip(`VT 回路${k === 'in' ? '进口阀' : '并联阀'}：${m.vtValves[k] ? '导通' : '断开'}`);
        return m.vtValves[k];
    }

    /** 滤器分叉/汇合两只手动三通转换阀（同步动作）：切换在用滤器支路 */
    toggleStrainer3w() {
        const m = this.m;
        m.strainerSel = (m.strainerSel === 'mf') ? 'af' : 'mf';
        this._tip(`滤器手动三通阀（分叉+汇合，同步）：切至 ${m.strainerSel === 'mf' ? '手动滤器 MF（上支路）' : '自动滤器 AF（下支路）'}`);
        return m.strainerSel;
    }

    setFilterMainSwitch(on) {
        const f = this.m.filter;
        f.mainSwitch = !!on;
        if (!on) f.flushing = false;
        return true;
    }

    /** 直接指定滤器方式（DRAIN / MAN / STOP / AUTO） */
    setFilterMode(mode) {
        if (!FILTER_MODES.includes(mode)) return false;
        const f = this.m.filter;
        f.mode = mode;
        if (mode !== 'AUTO') f.flushing = false;
        this._tip(`自动滤器选择开关：${mode}`);
        return true;
    }

    /** 按 START/STOP：弹出确认（+=yes / -=no） */
    requestProcToggle() {
        const m = this.m;
        if (m.pendingProc !== null) { this._tip('请先确认 START/STOP'); return false; }
        m.pendingProc = !m.procOn;
        this._tip(m.pendingProc ? 'START？ +=yes  -=no' : 'STOP？ +=yes  -=no');
        return true;
    }

    /** 确认 START/STOP：yes=true 执行，false 取消 */
    answerProcToggle(yes) {
        const m = this.m;
        if (m.pendingProc === null) return false;
        const target = m.pendingProc;
        m.pendingProc = null;
        if (!yes) { this._tip('已取消'); return false; }
        this.setProc(target);
        return true;
    }

    setPumpCtlMode(mode) {
        const m = this.m;
        m.pumpCtl = (mode === 'LOCAL') ? 'LOCAL' : 'EPC';
        this._tip(m.pumpCtl === 'EPC'
            ? 'EPC PUMP CONTROL 置于 EPC：各泵按 Pr1/Pr2 由 EPC-50B 自动控制'
            : 'EPC PUMP CONTROL 置于 LOCAL：泵只由本地选择开关（MAN）直接控制');
        return true;
    }

    cyclePumpCtl(dir = 1) {
        const m = this.m;
        const order = ['LOCAL', 'EPC'];
        const i = order.indexOf(m.pumpCtl);
        const next = clamp(i + (dir > 0 ? 1 : -1), 0, 1);
        if (next === i) return false;
        return this.setPumpCtlMode(order[next]);
    }

    // ── 泵的运行计划（Pr1 / Pr2）──
    pumpPlan(kind) {
        const key = kind === 'supply' ? 'Pr1' : 'Pr2';
        const v = String(this.m.params[key]);
        const map = {
            '1': { primary: 'sp1', standby: null },
            '2': { primary: 'sp2', standby: null },
            '12': { primary: 'sp1', standby: 'sp2' },
            '21': { primary: 'sp2', standby: 'sp1' },
        };
        const raw = map[v] || map['12'];
        const fix = (id) => id ? (kind === 'supply' ? id : id.replace('sp', 'cp')) : null;
        return { primary: fix(raw.primary), standby: fix(raw.standby) };
    }

    resetSwitchover(kind) {
        this.m.switchover[kind] = false;
    }

    // ═══════════════════════════════════════════════════════════
    //  加热 / 调节阀
    // ═══════════════════════════════════════════════════════════
    setRegValveMode(mode) {
        const h = this.m.heater;
        const prev = h.regMode;
        h.regMode = (mode === 'MAN') ? 'MAN' : 'EPC';
        if (prev !== 'MAN' && h.regMode === 'MAN') {
            // 无扰切换：手动量从当前实际开度接续（不会跳变）
            h.manualPower = clamp((h.shs || 0) - (h.tracing ? 4 : 0), 0, 100);
        }
        this._tip(h.regMode === 'MAN'
            ? 'REGULATING VALVE 置于 MAN：用 DECR / INCR 旋钮手动增减加热量'
            : 'REGULATING VALVE 置于 EPC：加热量由 EPC-50B 自动调节');
        return true;
    }

    nudgeHeat(dir) {
        const h = this.m.heater;
        if (h.regMode !== 'MAN') {
            this._tip('调节阀在 EPC 位，手动增减旋钮无效；请先选择 MAN');
            return false;
        }
        // 一次点动 = 一个 0.5% 开度变化
        h.shs = clamp((h.shs || 0) + (dir > 0 ? SRV_STEP : -SRV_STEP), 0, 100);
        h.manualPower = clamp(h.shs - (h.tracing ? 4 : 0), 0, 100);
        h.effPower = h.shs;
        this._tip(`MAN 手动：调节阀开度 ${h.shs.toFixed(1)} %（DECR/INCR 每次 0.5%）`);
        return true;
    }

    /** 按住 DECR/INCR：开始连续增减开度（松手由 endHeat 停止，开度保持） */
    beginHeat(dir) {
        const h = this.m.heater;
        if (h.regMode !== 'MAN') {
            this._tip('调节阀在 EPC 位，手动增减旋钮无效；请先选择 MAN');
            return false;
        }
        this._heatDir = dir > 0 ? 1 : -1;
        return true;
    }

    endHeat() {
        this._heatDir = 0;
    }

    setHeatTracing(v) {
        this.m.heater.tracing = (Number(v) ? 1 : 0);
        this._tip(`HEATING TRACING = ${this.m.heater.tracing}`);
        return true;
    }

    // ═══════════════════════════════════════════════════════════
    //  DO / HFO 转换
    // ═══════════════════════════════════════════════════════════
    requestModeChange() {
        const m = this.m;
        if (!m.epcPower) { this._tip('请先合上 EPC-50B 电源'); return false; }
        m.pendingMode = (m.cv === 'HFO') ? 'DO' : 'HFO';
        this._tip(`液晶屏提示：Change oil mode? +=yes -=no（目标 ${m.pendingMode}）`);
        return true;
    }

    cancelModeChange() {
        if (this.m.pendingMode) this._tip('已取消燃油模式转换');
        this.m.pendingMode = null;
    }

    answerModeChange(yes) {
        const m = this.m;
        if (!m.pendingMode) return false;
        if (!yes) { this.cancelModeChange(); return false; }
        const target = m.pendingMode;
        m.pendingMode = null;
        this.setOilMode(target);
        return true;
    }

    setOilMode(mode) {
        const m = this.m;
        mode = (mode === 'DO') ? 'DO' : 'HFO';
        if (m.oilMode === mode) return;
        m.prevKind = (m.oilMode === 'HFO') ? (m.params.Pr19 === 'VISC' ? 'VISC' : 'TEMP') : 'TEMP';
        m.oilMode = mode;
        m.cv = mode;
        // 电磁转换阀：行程 10 s（期间显示 HFO 侧开度）
        m.cvSwitching = true;
        m.cvT = 0;
        m.cvFrom = m.cvPos || 0;
        m.cvTo = (mode === 'HFO') ? 100 : 0;
        m.prog.active = false;         // 阀到位后才开始程序升温/降温
        m.changing = true;
        m.changeT = 0;
        if (mode === 'DO') {
            m.ctrlKind = 'TEMP';       // DO 模式自动选温度控制
            this._tip('转换阀 CV 切到 DO：柴油模式，自动选择温度控制（TT 指示灯）');
        } else {
            m.ctrlKind = m.params.Pr19; // HFO 模式按 Pr19
            this._tip(`转换阀 CV 切到 HFO：重油模式，按 Pr19=${m.params.Pr19} 控制`);
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  报警
    // ═══════════════════════════════════════════════════════════
    _raise(code, text) {
        const m = this.m;
        let a = m.alarms.find(x => x.code === code);
        if (!a) {
            a = { code, text, active: true, ack: false, t: m.clock };
            m.alarms.push(a);
            if (m.alarms.length > 32) m.alarms.shift();   // CPU 只存最后 32 次报警
        } else {
            if (!a.active) a.ack = false;      // 报警消失后再出现 → 视为新事件，重新闪烁
            a.active = true;
            a.text = text;
        }
    }

    _clear(code) {
        const a = this.m.alarms.find(x => x.code === code);
        if (a) a.active = false;
    }

    /**
     * 重算报警灯：
     *  · 有未确认报警（无论故障是否仍在）→ 闪烁
     *  · 全部已确认但记录仍在（含故障已消失的情况）→ 常亮，必须再按复位才熄灭
     *  · 无报警记录 → 熄灭
     */
    _refreshAlarmLamp() {
        const m = this.m;
        m.alarmActive = m.alarms.some(a => a.active && !a.ack);
        m.alarmLamp = m.alarms.some(a => !a.ack) ? 'blink'
            : (m.alarms.length ? 'on' : 'off');
    }

    pressAlarmReset() {
        const m = this.m;
        const active = m.alarms.filter(a => a.active);
        if (!active.length) {
            m.alarms = [];
            this._refreshAlarmLamp();
            this._tip('当前无报警');
            return 'none';
        }
        if (active.some(a => !a.ack)) {
            active.forEach(a => { a.ack = true; });
            m.alarms = m.alarms.filter(a => a.active);   // 已消失的报警一并清掉
            this._refreshAlarmLamp();
            this._tip('报警已确认（故障仍在则灯常亮；再按一次可清除已消失的报警）');
            return 'ack';
        }
        m.alarms = m.alarms.filter(a => a.active);
        this._refreshAlarmLamp();
        this._tip('已复位并清除历史报警');
        return 'reset';
    }

    setFault(key, on) {
        const m = this.m;
        if (!(key in m.faults)) return false;
        m.faults[key] = !!on;
        if (!on) return true;
        if (key === 'pump1') m.pumps.sp1.fault = true;
        if (key === 'pump2') m.pumps.sp2.fault = true;
        if (key === 'cp1') m.pumps.cp1.fault = true;
        if (key === 'filter') m.filter.dp = Math.max(m.filter.dp, 0.12);
        return true;
    }

    repairFault(key) {
        const m = this.m;
        if (!(key in m.faults)) return false;
        m.faults[key] = false;
        if (key === 'pump1') m.pumps.sp1.fault = false;
        if (key === 'pump2') m.pumps.sp2.fault = false;
        if (key === 'cp1') m.pumps.cp1.fault = false;
        if (key === 'filter') m.filter.dp = 0.03;
        if (key === 'power') this.resetSwitchover('supply');
        if (key === 'cv') this._clear('A 70');
        if (key === 'srv') this._clear('A 82');
        return true;
    }

    // ═══════════════════════════════════════════════════════════
    //  主循环
    // ═══════════════════════════════════════════════════════════
    solve(dtRaw) {
        const dt = Math.min(0.25, Math.max(0, dtRaw)) * (this.cfg.timeScale || 1);
        const m = this.m;
        if (dt <= 0) return;
        m.clock += dt;
        this._updatePower(dt);
        this._updatePumps(dt);
        this._updateFlows(dt);
        this._updateTank(dt);
        this._updateHeater(dt);
        this._updateOil(dt);
        this._updateFilter(dt);
        this._updateDea(dt);
        this._updateMode(dt);
        this._updateLamps();
        this._updateAlarms(dt);
        this._refreshAlarmLamp();
    }

    _updatePower(dt) {
        const m = this.m;
        // EPC-50B 面板默认带电（不依赖各泵 / 滤器的 MAIN SWITCH）；
        // 各泵由自身 MAIN SWITCH 送电，自动滤器 MAIN SWITCH 只给自清洗滤器供电。
        m.mainPower = true;
        m.epcPower = true;
        m.bootT = Math.max(0, m.bootT - dt);
        // 电源故障：全部泵失电
        if (m.faults.power) {
            Object.values(m.pumps).forEach(p => { p.on = false; p.current = 0; });
        }
    }

    _updatePumps(dt) {
        const m = this.m;
        const ids = ['sp1', 'sp2', 'cp1', 'cp2'];
        const booted = m.mainPower && m.epcPower && m.bootT <= 0;

        ids.forEach((id, idx) => {
            const p = m.pumps[id];
            p.aux = !!(p.mainSwitch && m.mainPower);
            // 支路手动截止阀关闭 → 该泵无法供油，停泵
            if (m.manualValves && m.manualValves[id] === false) {   // 支路截止阀关闭 → 该泵停运
                p.on = false;
                p.current = 0;
                p.startDelay = 0;
                return;
            }
            if (p.fault || p.overload || m.faults.power || !p.mainSwitch || !m.mainPower) {
                p.on = false;
                p.current = 0;
                p.startDelay = 0;
                return;
            }

            let want = false;
            if (p.mode === 'MAN') {
                want = true;
            } else if (p.mode === 'STOP') {
                want = false;
            } else {
                // EPC / REM：由 EPC-50B 按 Pr1 / Pr2 选择运行与备用
                if (m.pumpCtl !== 'EPC' || !m.epcPower || !m.procOn || !booted) {
                    want = false;
                } else {
                    want = this._autoRun(id);
                    // 混油筒液位联锁：高位停泵 / 低位按 Pr1 起泵
                    if (p.kind === 'supply' && m.tank) {
                        if (m.tankCtrl === 'stop') want = false;
                        else if (m.tankCtrl === 'start') want = (id === this.pumpPlan('supply').primary);
                    }
                }
            }

            // 起动间隔：按 Fa10 依次起动（每台泵错开一个 Fa10）
            if (want && !p.on) {
                if (p.startDelay <= 0) {
                    const plan = this.pumpPlan(p.kind);
                    const order = (p.id === plan.primary) ? 0 : 1;
                    const switching = !!(m.switchover && m.switchover[p.kind]);
                    p.startDelay = switching ? 0 : (order * (m.params.Fa10 || 1) + idx * 0.15);
                }
                p.startDelay -= dt;
                if (p.startDelay > 0) return;   // 等待起动
                p.startDelay = 0;
                p.on = true;
            } else if (!want) {
                p.on = false;
                p.startDelay = 0;
            }

            p.current = p.on ? (p.kind === 'supply' ? 6.8 : 9.5) : 0;
            if (p.on) p.runtime += dt;
        });

        // ── 备用泵自动切换（Pr 设定备用 + 主泵故障 / 压力低）──
        this._standbyLogic('supply', dt);
        this._standbyLogic('circ', dt);
    }

    /** EPC 自动方式下某台泵是否应运行（含备用切换） */
    _autoRun(id) {
        const m = this.m;
        const p = m.pumps[id];
        const plan = this.pumpPlan(p.kind);
        const sw = m.switchover[p.kind];
        if (id === plan.primary) {
            if (p.fault || p.overload) return false;
            if (!plan.standby) return true;
            return !sw;
        }
        if (plan.standby && id === plan.standby) {
            if (p.fault || p.overload) return false;
            if (!plan.standby) return false;
            return sw;
        }
        return false;
    }

    _standbyLogic(kind, dt) {
        const m = this.m;
        const plan = this.pumpPlan(kind);
        if (!plan.standby) { m.switchover[kind] = false; return; }
        const pri = m.pumps[plan.primary];
        const stb = m.pumps[plan.standby];
        const tkey = `sw_${kind}`;
        const code = kind === 'supply' ? 'A 56' : 'A 57';

        // 已切换：压力恢复后解除报警（可复位）
        if (m.switchover[kind]) {
            const pressOk = kind === 'supply'
                ? ((m.oil.supplyPress || 0) > Math.max(0.1, (m.params.Pr11 || 0.15)))
                : ((m.oil.circPress || 0) > 0.35);
            if (pressOk) this._clear(code);
            return;
        }

        const p = kind === 'supply' ? (m.oil.supplyPress || 0) : (m.oil.circPress || 0);
        // 泵起动后的 3 s 建压期内不判低压（否则每次起泵都会误报）
        const building = kind === 'supply'
            ? ((m.oil.spBuildT || 0) > 0 && (m.oil.spBuildT || 0) < 3)
            : ((m.oil.cpBuildT || 0) > 0 && (m.oil.cpBuildT || 0) < 3);
        // ① 压力低报警：PT1 / PT2 < 0.05 MPa（与是否切换无关）
        const pLowAlarm = !building && p < 0.05;
        // ② 备用泵触发条件
        const pressLow = !building && (kind === 'supply' ? (pri.on && p < (m.params.Pr11 || 0.15)) : (pri.on && p < 0.35));
        const priFail = pri.fault || pri.overload;
        const lvOk = !m.tank || m.tank.level < 50;          // 供油侧：液位≥50% 属高位联锁停泵
        const manualStop = kind === 'supply'
            ? (!pri.on && pLowAlarm && lvOk)                  // 供油：需 PT1<0.05 且液位<50%
            : (!pri.on && pLowAlarm);                         // 循环：只看 PT2<0.05

        if (m.procOn && pLowAlarm) {
            this._raise(code, kind === 'supply'
                ? `供油压力低（PT1 ${p.toFixed(2)} MPa < 0.05）`
                : `循环压力低（PT2 ${p.toFixed(2)} MPa < 0.05）`);
        }

        if (!m.procOn || !m.epcPower) {      // 未投入工艺：不判压力、不累积计时
            m.t[tkey] = 0;
            return;
        }

        if (pressLow || priFail || manualStop) {
            m.t[tkey] = (m.t[tkey] || 0) + dt;
            const need = priFail ? 3.0 : (m.params.Fa9 || 6);
            if (m.t[tkey] >= need && m.procOn && m.epcPower) {
                m.switchover[kind] = true;
                this._raise(code, kind === 'supply'
                    ? `供油泵出口压力低，${stb.name} 自动投入（备用）`
                    : `循环泵压力低，${stb.name} 自动投入（备用）`);
                this._tip(`${pri.name} ${priFail ? '故障' : (pressLow ? '压力低' : '已停机且无压力')} → ${stb.name} 自动投入运行`);
            }
        } else {
            m.t[tkey] = 0;
            if (!(m.procOn && pLowAlarm)) this._clear(code);
        }
    }

    _updateFlows(dt) {
        const m = this.m;
        const spOn = ['sp1', 'sp2'].filter(id => m.pumps[id].on).length;
        const cpOn = ['cp1', 'cp2'].filter(id => m.pumps[id].on).length;
        // 滤器脏堵降低流量
        const flowF = clamp(1 - (m.filter.dp - 0.02) / 0.22, 0.45, 1);
        // 泵起动后延迟 3 s 才开始建压（建压过程本身仍有一阶滞后）
        m.oil.spBuildT = spOn > 0 ? Math.min(3, (m.oil.spBuildT || 0) + dt) : 0;
        m.oil.cpBuildT = cpOn > 0 ? Math.min(3, (m.oil.cpBuildT || 0) + dt) : 0;
        const spReady = spOn > 0 && m.oil.spBuildT >= 3;
        const cpReady = cpOn > 0 && m.oil.cpBuildT >= 3;

        // 压力按一阶滞后逼近目标：泵停 → 快速失压（τ≈0.8 s）；泵起 → 稍慢建立（τ≈1.2 s）
        const pSp = spReady ? (spOn > 1 ? 0.72 : 0.60) : 0;
        const tauSp = spOn ? 1.2 : 0.8;
        m.oil.supplyPress += (pSp - m.oil.supplyPress) * (1 - Math.exp(-dt / tauSp));
        m.oil.flow = spOn ? (spOn > 1 ? 3.2 : 2.8) * flowF : 0;
        // PT2：循环泵运行（无故障）时 = 混油筒压力 + 0.5 MPa；不运行 = 0
        const pCp = cpReady ? ((m.tank.press || 0) + 0.5) : 0;
        const tauCp = cpOn ? 1.2 : 0.8;
        m.oil.circPress += (pCp - m.oil.circPress) * (1 - Math.exp(-dt / tauCp));
        m.oil.circFlow = cpOn ? (cpOn > 1 ? 3.4 : 3.0) : 0;   // 循环油路流量（仅循环泵运行时也存在）

        // ── FT 进口阀与旁通阀：进口阀关闭 → 走旁通（FT 流量为 0）；两阀全关 → 油路不通 ──
        const fv = m.ftValves || { in: true, by: false };
        // 两阀全开 → 两条并联支路流量均分；仅进口阀开 → 全走 FT；仅旁通阀开 → 全走旁通
        m.ftPath = (fv.in && fv.by) ? 'both'
            : (fv.in ? 'ft' : (fv.by ? 'bypass' : 'blocked'));
        if (m.ftPath === 'blocked') m.oil.flow = 0;                  // 油路不通，流量为零
        m.oil.ftFlow = m.ftPath === 'ft' ? m.oil.flow
            : (m.ftPath === 'both' ? m.oil.flow * 0.5 : 0);          // FT 只能测到流经它的油（并联时均分）

        // ── VT 回路：进口阀 + VT + 单向阀，与并联阀互为旁通（两阀全开均分、全关不通）──
        const vv = m.vtValves || { in: true, par: false };
        m.vtPath = (vv.in && vv.par) ? 'both'
            : (vv.in ? 'vt' : (vv.par ? 'bypass' : 'blocked'));
        m.oil.vtFlow = m.vtPath === 'vt' ? m.oil.flow
            : (m.vtPath === 'both' ? m.oil.flow * 0.5 : 0);
        // 滤器压差随流量（缓慢积垢，教学尺度）
        if (spOn && !(m.filter.flushing && m.filter.flushKind === 'drain'))   // 卸放期间压差不增长
            m.filter.dp = clamp(m.filter.dp + 0.0006 * (m.oil.flow / 2.8) * dt, 0.02, 0.25);

        // （PT2 只与混油筒压力 + 循环泵运行状态有关，不再按流量二次打折）
    }

    _updateHeater(dt) {
        const m = this.m, p = m.params, h = m.heater, c = m.ctrl;
        const flowF = clamp(m.oil.flow / 2.8, 0, 1);

        // ── 决定控制类型与设定值 ──
        let kind, sp, rampLimit;
        if (m.prog && m.prog.active) {
            kind = 'TEMP'; sp = m.prog.sp; rampLimit = m.prog.sp;   // 转换期间：程序温度
        } else if (m.oilMode === 'DO') {
            kind = 'TEMP'; sp = p.Pr35; rampLimit = p.Pr35 - 3;
        } else if (p.Pr19 === 'TEMP') {
            kind = 'TEMP'; sp = p.Pr30; rampLimit = p.Pr30 - 3;
        } else {
            kind = 'VISC'; sp = p.Pr20; rampLimit = p.Pr30;
        }
        c.kind = kind; c.sp = sp; c.rampLimit = rampLimit;

        // 手动增减（按住 DECR/INCR）：缓慢连续调节（4 %/s），松手立即停止并保持开度
        // 单击走 nudgeHeat()，每次固定 0.5 %
        if (h.regMode === 'MAN' && this._heatDir) {
            h.manualPower = clamp(h.manualPower + this._heatDir * 4 * dt, 0, 100);
        }

        if (!m.mainPower || !m.epcPower) {
            h.power = 0; c.stage = 'OFF'; c.integral = 0; c.trim = 0;
        } else if (h.regMode === 'MAN') {
            // MAN 位：开度完全由 DECR/INCR 设定，程序不得干预（工艺未投入也保持）
            c.stage = m.procOn ? 'MANUAL' : 'MANUAL/OFF';
            h.power = clamp(h.manualPower + (h.tracing ? 4 : 0), 0, 100);
        } else if (!m.procOn) {
            h.power = 0; c.stage = 'OFF'; c.integral = 0; c.trim = 0;
        } else {
            const pv = (kind === 'VISC') ? m.oil.visc : m.oil.temp;
            const needRamp = (kind === 'VISC') ? (m.oil.temp < rampLimit - 0.3) : (m.oil.temp < rampLimit - 0.3);
            if (needRamp) {
                c.stage = 'RAMP';
                h.power = flowF > 0.05 ? 100 : 0;
                c.integral = 0; c.trim = 0;
            } else {
                c.stage = 'HOLD';
                const err = (kind === 'TEMP') ? (sp - pv) : (pv - sp);
                const dead = (kind === 'TEMP') ? DEADBAND_T : DEADBAND_V;

                // ① 把设定值折算成“目标温度 spT”
                //    TEMP：直接用设定温度；VISC：按当前黏温斜率把黏度偏差换成温度偏差
                let spT = sp;
                if (kind === 'VISC') {
                    // 主目标固定为 Pr30（当前油品对应温度），黏度偏差折算成温度后只做 ±10 ℃ 修正
                    const viscAt = (T) => Math.max(1.2,
                        m.mix * viscHFO(T, m.params.Pr24) + (1 - m.mix) * viscDO(T));
                    // 斜率必须按“当前油温”求（pv 在 VISC 模式是黏度，不能直接代入温度）
                    const tSlope = m.oil.temp;
                    const dVdT = (viscAt(tSlope + 0.5) - viscAt(tSlope - 0.5));   // <0，cSt/℃
                    const dTvisc = (pv - sp) / Math.max(0.02, -dVdT);              // 黏度偏差 → 温度偏差
                    spT = clamp(p.Pr30 + clamp(dTvisc, -15, 15), AMBIENT, 165);
                }

                // ② 前馈：按本模型的热平衡直接算出“维持 spT 所需功率”
                //    出口温度 ≈ 筒温 + (功率/100)·90  →  功率 = (spT − 筒温)/90·100
                const ff = clamp(((spT - m.tank.temp) / 100) * 100, 0, 100);

                // ③ 小增益积分修正（限幅 ±12%），只在死区外缓慢累积 —— 消除大幅振荡与积分饱和
                if (Math.abs(err) <= dead) {
                    c.stage = 'HOLD(死区)';                        // 死区内保持，不积分
                    h.power = clamp(ff + (c.trim || 0), 0, 100);
                } else {
                    // 修正增益与蒸汽比例带 Fa25 成反比：比例带越小 → 同样偏差给出的阀位变化越大
                    const pbK = 12 / clamp(Number(p.Fa25) || 12, 4, 60);
                    c.trim = clamp((c.trim || 0) + err * 0.05 * pbK * dt, -12, 12);
                    h.power = clamp(ff + c.trim, 0, 100);
                }
            }
        }

        // 本系统无电加热器：加热量全部由蒸汽调节阀给出，开度 1:1 对应加热量
        const eff = clamp(h.power, 0, 100);

        // ── 执行机构：脉冲式电动调节阀，开度只能按 0.5% 步进（不会突变）──
        let targetShs = eff;
        // 电关型：失电 → 弹簧复位全开；工艺未投入且调节阀在 EPC 位 → 也全开。
        // 调节阀打到 MAN 时一律以手动量为准，程序不再改动开度。
        if (!m.mainPower || !m.epcPower) targetShs = 100;
        else if (!m.procOn && h.regMode !== 'MAN') targetShs = 100;
        c.pulseT = (c.pulseT || 0) + dt;
        if (c.pulseT >= SRV_PULSE_DT) {
            c.pulseT -= SRV_PULSE_DT;
            if (!m.faults.srv) {                                  // 卡死故障：阀位不再跟随指令
                if (targetShs > h.shs + SRV_STEP / 2) h.shs = Math.min(100, h.shs + SRV_STEP);
                else if (targetShs < h.shs - SRV_STEP / 2) h.shs = Math.max(0, h.shs - SRV_STEP);
            }
        }
        // 指令要求动作（偏差 ≥2%）但阀位不动 → 卡死报警；否则解除
        const srvCmd = Math.abs(targetShs - h.shs);
        h.srvStuck = !!(m.faults.srv && srvCmd >= 2);
        if (h.srvStuck) this._raise('A 82', '调节阀 SRV 没反应（卡死）'); else this._clear('A 82');
        h.effPower = h.shs;                        // 实际投入热量 = 阀位（%）

        // ── 两台加热器进汽截止阀：可用台数折算实际投入热量（0 / 50% / 100%）──
        const svv = m.steamSV || { sh1: true, sh2: true };
        const capN = (svv.sh1 !== false ? 1 : 0) + (svv.sh2 !== false ? 1 : 0);
        h.capFactor = capN / 2;
        h.effPower = eff;                      // 显示/控制用指令功率（不折算）

        c.stage = c.stage || 'OFF';
        if (h.regMode === 'MAN' && m.procOn) c.stage = 'MANUAL';
    }

    /** 混油筒液位：柜→混油筒的进油使液位上升，柴油机耗油使液位下降（两条独立油路） */
    _updateTank(dt) {
        const m = this.m;
        if (!m.tank) return;
        const spOn = ['sp1', 'sp2'].some(id => m.pumps[id].on);   // 供油泵运行
        const cpOn = ['cp1', 'cp2'].some(id => m.pumps[id].on);   // 往柴油机的循环泵运行
        const load = (m.engineLoad == null ? 50 : m.engineLoad) / 100;
        let rate = 0;                                             // %/s
        if (spOn && m.ftPath !== 'blocked') rate += 5 / 60;       // 供油泵运行：每分钟 +5%
        if (cpOn && m.vtPath !== 'blocked') rate -= (5 / 60) * load;   // 循环泵运行且柴油机能进油：按负荷耗油
        m.tank.level = clamp(m.tank.level + rate * dt, 0, 100);
        m.oil.tankLevel = m.tank.level;
        // 筒内油压由液位高度决定（与 PT1 供油压力无关）：50% → 0.45 MPa，80% → 0.65 MPa
        m.tank.press = 0.45 + (m.tank.level - 50) * (0.65 - 0.45) / 30;

        // 液位联锁（带回差）：
        //   ≥80% → 停止发出泵起动信号（供油泵停）；
        //   高位停机保持到液位回落到 ≤50% 才恢复发出起动信号；
        //   ≤30% → 主动发出起动信号（按 Pr1 选泵）
        const lv = m.tank.level;
        let ctrl;
        if (lv >= 80) ctrl = 'stop';
        else if ((m.tankCtrl || '') === 'stop') ctrl = (lv <= 50) ? '' : 'stop';   // 保持停机直到 50%
        else ctrl = (lv <= 30) ? 'start' : '';
        if (ctrl !== m.tankCtrl) {
            if (ctrl === 'stop') this._tip('混油筒液位高（≥80%）→ 停止发出泵起动信号，供油泵停机');
            else if (ctrl === 'start') {
                const plan = this.pumpPlan('supply');
                this._tip(`混油筒液位低（≤30%）→ 发出起动信号：按 Pr1 起动 ${plan.primary === 'sp1' ? '1' : '2'} 号供油泵`);
            } else if ((m.tankCtrl || '') === 'stop') {
                this._tip('混油筒液位已回落到 50% → 恢复发出泵起动信号');
            }
            m.tankCtrl = ctrl;
        }
    }

    _updateOil(dt) {
        const m = this.m, p = m.params, h = m.heater;
        if (!m.tank.temp && m.tank.temp !== 0) m.tank.temp = m.oil.temp;

        // ── 转换阀行程（10 s） ──
        if (m.cvSwitching) {
            m.cvT = (m.cvT || 0) + dt;
            const t = Math.min(1, m.cvT / 10);
            // 三通阀卡死故障：阀位不跟随指令（只有换油动作时才暴露）
            if (!m.faults.cv) m.cvPos = m.cvFrom + (m.cvTo - m.cvFrom) * t;
            if (t >= 1) {
                m.cvSwitching = false;
                if (Math.abs(m.cvPos - m.cvTo) > 5) {
                    // 动作指令已发出但阀位没切换 → 报 A 70，取消本次换油
                    this._raise('A 70', '三通阀 CV 故障（阀位未切换）');
                    m.cvPos = m.cvFrom;
                    m.oilMode = (m.cvFrom > 50) ? 'HFO' : 'DO';
                    m.cv = m.oilMode;
                    m.ctrlKind = (m.oilMode === 'DO') ? 'TEMP' : p.Pr19;
                    m.changing = false;
                    m.prog.active = false;
                    this._tip('三通阀动作无响应（A 70）→ 换油取消，保持原油品');
                } else {
                    m.cvPos = m.cvTo;
                    this._clear('A 70');        // 本次动作正常完成 → 清除三通阀故障报警
                    // 阀到位 → 进入程序升温 / 降温
                    const target = (m.oilMode === 'HFO') ? (p.Pr30 - 3) : p.Pr35;
                    m.prog = { active: true, sp: m.oil.temp, target, dir: target >= m.oil.temp ? 1 : -1 };
                    this._tip(`转换阀到位（${m.cvPos.toFixed(0)}%）→ 开始程序${m.prog.dir > 0 ? '升温' : '降温'}，目标 ${target} ℃`);
                }
            }
        }

        // ── 程序升 / 降温（速率 Fa31 ℃/min）──
        if (m.prog && m.prog.active) {
            const rate = ((m.oilMode === 'HFO' ? (p.Fa30 || 60) : (p.Fa31 || 60))) / 60;   // ℃/s
            m.prog.sp += m.prog.dir * rate * dt;
            if ((m.prog.dir > 0 && m.prog.sp >= m.prog.target) ||
                (m.prog.dir < 0 && m.prog.sp <= m.prog.target)) {
                m.prog.sp = m.prog.target;
                if (Math.abs(m.oil.temp - m.prog.target) < 1.0) {
                    m.prog.active = false;
                    m.changing = false;
                    this._tip(m.oilMode === 'HFO'
                        ? '程序升温完成 → 转换完成，进入定值控制'
                        : '程序降温完成 → 转换完成，进入温度定值控制');
                }
            }
        }

        const circOn = !!(m.pumps.cp1.on || m.pumps.cp2.on);
        const heating = (h.effPower || 0) > 5 && m.procOn && m.mainPower;   // 伴行加热(4%)不算投入

        // 油品过渡（仅在换油过程中改变比例）
        // 油品比例跟随转换阀实际开度（阀行程 10 s，混合再滞后约 20 s）
        m.mix = approach(m.mix, (m.cvPos || 0) / 100, dt, 1 / 12);   // 混合油约 1 min 内被置换完毕
        if (m.cv === 'HFO' && m.mix > 0.995) m.mix = 1;      // 归位，避免残差
        if (m.cv === 'DO' && m.mix < 0.005) m.mix = 0;

        // ── ① 加热器出口油温（TT / VT 的测量点）──
        // 目标温度 = 混油筒温度 + 加热温升（随加热功率）；热惯性约 25 s
        // ── 两台加热器并联：按燃油/蒸汽截止阀统计各支路份额，出口为混合温度 ──
        //   · 燃油阀开 → 该支路有油流动；蒸汽阀开 → 该支路被加热，否则油"旁通"（不升温）
        const fv = m.manualValves || {}, svv2 = m.steamSV || {};
        const fuelBranch = ['sh1', 'sh2'].filter(k => fv[k] !== false);
        const hotBranch = fuelBranch.filter(k => svv2[k] !== false);
        const hotShare = fuelBranch.length ? hotBranch.length / fuelBranch.length : 0;
        const riseUnit = (heating && hotShare > 0) ? (h.effPower / 100) * 100 : 0;   // 100% 开度 → 100 ℃
        const rise = riseUnit * hotShare;                    // 未加热支路的油混入后按份额摊薄
        const target = Math.min(160, m.tank.temp + rise);
        const tau = circOn ? 25 : 60;
        if (m.cvSwitching) {
            // 转换阀动作中（10 s）：油温保持不变，等阀到位后再进入程序升/降温
        } else if (m.prog && m.prog.active) {
            // 程序升/降温阶段：出口温度按程序曲线走（速率 Fa31 ℃/min）
            m.oil.temp = clamp(m.prog.sp, AMBIENT, 165);
        } else {
            m.oil.temp += (target - m.oil.temp) * (1 - Math.exp(-dt / tau));
            m.oil.temp = clamp(m.oil.temp, AMBIENT, 165);
        }

        // ── ② 混油筒温度 ──
        if (m.changing) {
            // 换油：新油进入，筒温向来油温度靠拢
            const inT = m.cv === 'HFO' ? m.tankTemps.hfo : m.tankTemps.do;
            m.tank.temp += (inT - m.tank.temp) * (1 - Math.exp(-dt / 45));
            m.changeT += dt;
            const done = m.cv === 'HFO' ? m.mix > 0.96 : m.mix < 0.04;
            if (done || m.changeT > 60) m.changing = false;
        } else {
            // 混油筒热平衡：高温回油掺混带入热量 − 对机舱空气散热
            const loadF = (m.engineLoad == null ? 50 : m.engineLoad) / 100;
            const returnF = 0.6 - 0.35 * loadF;                  // 负荷越低，回流比例越大
            let dT = 0;
            if (heating && circOn) dT += (m.oil.temp - m.tank.temp) * 0.0006 * (0.6 + returnF);
            dT -= (m.tank.temp - AMBIENT) * (1 / 60) / 40;        // 70 ℃ 时约 1 ℃/min
            m.tank.temp += dT * dt;
        }
        m.tank.temp = clamp(m.tank.temp, AMBIENT, 165);

        // ── ③ 黏度：按测量点油温与油品比例换算 ──
        const vh = viscHFO(m.oil.temp, m.params.Pr24);
        const vd = viscDO(m.oil.temp);
        m.oil.visc = Math.max(1.2, m.mix * vh + (1 - m.mix) * vd);

        // ── ④ HFO 油品周期波动：每 2 min 正常 + 2 min 波动 ──
        //    波动期内黏度在 Pr30 对应温度上由 12 逐渐升到 13 cSt，2 min 后回到 12
        if (m.oilMode === 'HFO' && m.procOn) {
            m.t.fluctT = (m.t.fluctT || 0) + dt;
            const ph = m.t.fluctT % 240;              // 0~120 正常，120~240 波动
            const inF = ph >= 120;
            const k = inF ? (ph - 120) / 120 : 0;     // 0 → 1 逐渐增大
            m.oil.fluct = inF ? k : 0;
            if (inF) m.oil.visc *= (1 + k * (13 - 12) / 12);   // 12 cSt 时最多 +1 cSt
        } else {
            m.t.fluctT = 0;
            m.oil.fluct = 0;
        }

        // ── ④ TT / VT 测量值：只有燃油在流动时才能测到 ──
        const flowing = circOn && (m.oil.circFlow || 0) > 0.1 && (m.vtPath || 'vt') !== 'blocked';
        m.oil.ttVal = flowing ? m.oil.temp : 0;
        m.oil.vtVal = (flowing && (m.vtPath === 'vt' || m.vtPath === 'both')) ? m.oil.visc : 0;
        // 传感器故障：数值失效（界面显示 ***），VT 故障时自动改为温度定值控制
        m.oil.ttBad = !!m.faults.tt;
        m.oil.vtBad = !!m.faults.vt;
        if (m.faults.vt && m.params.Pr19 !== 'TEMP') {
            m.params.Pr19 = 'TEMP';
            m.ctrlKind = 'TEMP';
            this._tip('VT 黏度传感器故障（A 42）→ 自动切换为温度定值控制（Pr19 = TEMP）');
        }
    }

    /** 加热器进汽手动截止阀（两台独立） */
    toggleHeaterSV(k) {
        const m = this.m;
        if (!m.steamSV || !(k in m.steamSV)) return false;
        m.steamSV[k] = !m.steamSV[k];
        const n = Object.values(m.steamSV).filter(Boolean).length;
        this._tip(`${k === 'sh1' ? '1' : '2'} 号加热器进汽截止阀：${m.steamSV[k] ? '导通' : '关闭'}（可用加热器 ${n}/2）`);
        return m.steamSV[k];
    }

    /** 日用柜状态：温度与按油品等级换算的黏度 */
    tankState(k) {
        const m = this.m;
        const T = (m.tankTemps && m.tankTemps[k]) || (k === 'hfo' ? 70 : 40);
        const visc = k === 'hfo' ? viscHFO(T, m.params.Pr24) : viscDO(T);
        return { temp: T, visc };
    }

    /** 柴油机负荷调节（0~100 %） */
    setEngineLoad(v) {
        const m = this.m;
        const prev = m.engineLoad == null ? 50 : m.engineLoad;
        m.engineLoad = Math.round(clamp(Number(v) || 0, 0, 100));
        if (m.engineLoad !== prev) this._tip(`柴油机负荷：${prev}% → ${m.engineLoad}%`);
        return m.engineLoad;
    }

    /** 自动滤器：PDS 压差开关、手动/自动清洗、周期性卸放 */
    _updateFilter(dt) {
        const m = this.m, f = m.filter, p = m.params;

        // PDS 压差开关（带回差）：>0.09 MPa 闭合（红色），<0.03 MPa 断开
        if (f.dp >= 0.09) f.pds = true;
        else if (f.dp <= 0.03) f.pds = false;
        // 报警单独判定：ΔP ≥ 0.12 MPa 才报 A 55
        if (f.dp >= 0.12) this._raise('A 55', '滤器压差高（PDS 脏堵报警）'); else this._clear('A 55');
        f.overload = !!m.faults.filter;

        const powered = !!(f.mainSwitch && m.mainPower);
        const clean = !m.faults.filter;          // 故障（真脏堵）时冲洗不能消除压差

        // 放残位：卸放，压差不变
        if (f.mode === 'DRAIN') {
            f.flushing = powered;
            f.flushKind = 'drain';
            return;
        }
        // 手动位：供电即清洗，压差下降
        if (f.mode === 'MAN') {
            f.flushing = powered;
            f.flushKind = 'clean';
            if (f.flushing && clean) f.dp = Math.max(0.02, f.dp - 0.015 * dt);
            return;
        }

        // 自动位：压差开关闭合 或 到达冲洗间隔（Fa21）→ 起动
        const canFlush = f.mode === 'AUTO' && powered && m.epcPower && m.procOn;
        if (f.flushing) {
            if (clean && f.flushKind === 'clean') f.dp = Math.max(0.02, f.dp - 0.015 * dt);
            f.flushT -= dt;
            const done = f.flushKind === 'clean' ? (f.dp <= 0.03) : (f.flushT <= 0);
            if (done) {
                f.flushing = false;
                if (clean) f.dp = 0.022;
                m.t.flushCount = (m.t.flushCount || 0) + 1;
            }
        } else if (canFlush) {
            f.nextIn -= dt;
            if (f.pds || f.nextIn <= 0) {
                f.flushing = true;
                f.flushKind = f.pds ? 'clean' : 'drain';
                f.flushT = p.Fa22;
                f.nextIn = Math.max(0.2, p.Fa21) * 60;
                this._tip(f.pds
                    ? '压差开关闭合（脏堵）→ 自动滤器起动清洗（放残阀打开）'
                    : '自动滤器周期性卸放（放残阀打开）');
            }
        }
    }

    _updateDea(dt) {
        const m = this.m, d = m.dea;
        const running = m.oil.flow > 0.5 && m.procOn;
        if (running) d.level = clamp(d.level - 0.55 * dt, 0, 100);
        if (d.valve) d.level = clamp(d.level + 2.2 * dt, 0, 100);
        if (!d.valve && d.level < 25) {
            d.valve = true;
            this._tip('混合筒浮子开关检测到气多油少 → 脱气阀打开，气体放回 HFO 日用柜');
        } else if (d.valve && d.level > 65) {
            d.valve = false;
        }
        d.t = d.valve ? d.t + dt : 0;
        d.alarm = d.t > 120;
        if (d.alarm) this._raise('A 58', '脱气超时（混合筒空气过多）'); else this._clear('A 58');
        if (!m.mainPower) d.valve = false;
    }

    /** TT / VT 指示灯：on 常亮 / blink 闪烁 / off 灭 */
    _updateLamps() {
        const m = this.m;
        const switching = !!(m.cvSwitching || (m.prog && m.prog.active));
        const hfoVisc = (m.params.Pr19 === 'VISC');
        const srcVisc = (m.prevKind === 'VISC');
        let tt, vt;
        if (m.oilMode === 'HFO') {
            if (switching) { tt = 'on'; vt = hfoVisc ? 'blink' : 'off'; }
            else { tt = hfoVisc ? 'off' : 'on'; vt = hfoVisc ? 'on' : 'off'; }
        } else {
            if (switching) { tt = 'blink'; vt = srcVisc ? 'on' : 'off'; }
            else { tt = 'on'; vt = 'off'; }
        }
        // HFO / DO 指示灯：只在转换阀动作的 10 s 内"目标灯闪、原灯常亮"；
        // 阀到位后（含程序升降温期间）目标灯即转常亮
        let hfo, doL;
        if (m.cvSwitching) { hfo = (m.oilMode === 'HFO') ? 'blink' : 'on'; doL = (m.oilMode === 'DO') ? 'blink' : 'on'; }
        else { hfo = (m.oilMode === 'HFO') ? 'on' : 'off'; doL = (m.oilMode === 'DO') ? 'on' : 'off'; }
        m.lamp = { tt, vt, hfo, do: doL };
    }

    _updateMode(dt) {
        const m = this.m;
        // 加热器故障 / 油温低于 Fa14 → 自动安排转换到柴油
        const low = m.oil.temp < (m.params.Fa14 || 30);
        if (m.oilMode === 'HFO' && m.faults.srv && low && m.procOn) {
            m.t.toDO = (m.t.toDO || 0) + dt;
            if (m.t.toDO > 120) {
                m.t.toDO = 0;
                this.setOilMode('DO');
                this._raise('A 80', '转换到 DO 模式（温度低 / 加热故障）');
            }
        } else {
            m.t.toDO = 0;
        }
        // 消耗量持续高于 Fa16 → 自动转换为 HFO
        const demand = m.oil.demand;
        if (m.oilMode === 'DO' && m.procOn && m.params.Fa17 > 0 &&
            demand >= (m.params.Fa16 || 80)) {
            m.t.toHFO = (m.t.toHFO || 0) + dt;
            if (m.t.toHFO > 120) {
                m.t.toHFO = 0;
                this.setOilMode('HFO');
                this._tip('燃油消耗量持续高于 Fa16 → 自动转换到 HFO');
            }
        } else {
            m.t.toHFO = 0;
        }
    }

    _updateAlarms(dt) {
        const m = this.m, p = m.params;
        const run = m.mainPower && m.epcPower && m.procOn;
        const delay = (key, cond, need, code, text) => {
            if (cond) {
                m.t[key] = (m.t[key] || 0) + dt;
                if (m.t[key] >= need) this._raise(code, text);
            } else {
                m.t[key] = 0;
                this._clear(code);
            }
        };

        // 黏度 / 温度（报警延时 Fa8）
        const fa8 = Math.max(1, p.Fa8 || 30);
        const holdStage = String(m.ctrl.stage || '').startsWith('HOLD');   // 兼容 'HOLD(死区)'
        if (run && m.ctrl.kind === 'VISC' && holdStage) {
            delay('vhi', m.oil.visc > p.Pr20 * 1.18, fa8, 'A 40', `黏度高 ${m.oil.visc.toFixed(1)} cSt`);
            delay('vlo', m.oil.visc < p.Pr20 * 0.82, fa8, 'A 41', `黏度低 ${m.oil.visc.toFixed(1)} cSt`);
        } else {
            m.t.vhi = 0; m.t.vlo = 0;
            this._clear('A 40'); this._clear('A 41');
        }
        const spT = (m.oilMode === 'DO') ? p.Pr35 : p.Pr30;
        delay('thi', run && m.oil.temp > spT + 15, fa8, 'A 50', `温度高 ${m.oil.temp.toFixed(1)} ℃`);
        // 低温报警在加热斜坡（程序升温）期间无效，进入定值控制后才有效
        // HFO 低温报警：油温低于 Pr32 即报（程序升温/降温过程中屏蔽，避免升温途中误报）
        const inProg = !!(m.prog && m.prog.active);
        delay('tlo', run && m.oilMode === 'HFO' && !inProg && m.ctrl.stage !== 'OFF' && m.oil.temp < p.Pr32,
            fa8, 'A 51', `温度低 ${m.oil.temp.toFixed(1)} ℃（Pr32 = ${p.Pr32}）`);
        delay('slow', run && m.ctrl.stage === 'RAMP' && m.oil.flow > 0.3 && m.oil.temp < 60, 90, 'A 52', '温度慢反应（升温过慢）');

        // 传感器 / 执行器故障
        if (m.faults.vt) this._raise('A 42', '黏度传感器 VT 故障'); else { this._clear('A 42'); this._clear('W 49'); }
        if (m.faults.tt) this._raise('A 53', '温度传感器 TT 故障'); else { this._clear('A 53'); this._clear('W 58'); }
        if (m.faults.power) this._raise('A 87', '电源故障'); else this._clear('A 87');
        // 切换模式时传感器故障告警（W75）
        if (m.pendingMode && (m.faults.vt || m.faults.tt)) this._raise('W 75', '转换控制模式（Pr19），传感器失效');
        else this._clear('W 75');
    }

    // ═══════════════════════════════════════════════════════════
    //  复位 / 快捷操作
    // ═══════════════════════════════════════════════════════════
    resetAll() {
        const keep = this.cfg;
        this.m = createModel();
        this.cfg = keep;
        this._tip('供油单元已复位');
    }

    /** 工具栏「起动系统」：电源 + 自动方式 + 泵按 Pr 起动 + 加热自动 */
    quickStart() {
        const m = this.m;
        m.mainPower = true;
        m.epcPower = true;
        m.bootT = 0;
        Object.values(m.pumps).forEach(p => {
            p.mainSwitch = true;
            p.mode = 'EPC';
            // 注意：不清除故障 —— 起动系统只负责投电/投自动，故障需在「故障设置」里修复
        });
        // ① 先开启手动截止阀：各泵入口 + 1 号加热器（SH2 保持备用，两阀不打开）
        ['sp1', 'sp2', 'cp1', 'cp2', 'sh1'].forEach(k => { if (m.manualValves && k in m.manualValves) m.manualValves[k] = true; });
        if (m.steamSV) m.steamSV.sh1 = true;

        m.filter.mainSwitch = true;
        m.filter.mode = 'AUTO';
        m.filter.nextIn = 20;
        m.pumpCtl = 'EPC';
        m.heater.regMode = 'EPC';
        m.procOn = true;
        m.oilMode = m.oilMode || 'HFO';
        m.cv = m.oilMode;
        m.ctrlKind = m.oilMode === 'DO' ? 'TEMP' : m.params.Pr19;
        this._tip('系统快速投用：开启泵入口与 SH1 截止阀（SH2 备用）→ 泵按 Pr1/Pr2 自动运行 → 加热投入黏度控制');
    }

    /** 工具栏「5 点步进」：停 → 手动起泵 → 手动加热 → 转 HFO → 自动控制 */
    fiveStep(idx) {
        const m = this.m;
        switch (idx) {
            case 0:
                m.procOn = false;
                Object.values(m.pumps).forEach(p => { p.mode = 'STOP'; p.on = false; });
                this._tip('① 停止工艺');
                break;
            case 1:
                m.mainPower = true; m.epcPower = true; m.bootT = 0;
                ['sp1', 'sp2', 'cp1', 'cp2', 'sh1'].forEach(k => { if (k in m.manualValves) m.manualValves[k] = true; });
                m.steamSV.sh1 = true;
                Object.values(m.pumps).forEach(p => { p.mainSwitch = true; p.mode = 'MAN'; });
                this._tip('② 手动方式起动全部油泵');
                break;
            case 2:
                m.heater.regMode = 'MAN';
                m.heater.manualPower = 60;
                m.procOn = true;
                this._tip('③ 手动加热（调节阀 MAN，加热量 60 %）');
                break;
            case 3:
                this.setOilMode('HFO');
                this._tip('④ 转换到 HFO（转换阀切到重油）');
                break;
            case 4:
                Object.values(m.pumps).forEach(p => { p.mode = 'EPC'; });
                m.heater.regMode = 'EPC';
                m.filter.mainSwitch = true;
                m.filter.mode = 'AUTO';
                m.pumpCtl = 'EPC';
                this._tip('⑤ 转入 EPC 自动控制（Pr1/Pr2 运行备用）');
                break;
            default: break;
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  显示辅助
    // ═══════════════════════════════════════════════════════════
    stateText() {
        const m = this.m;
        if (!m.mainPower) return 'Powerof';
        if (!m.epcPower) return 'Standby';
        if (m.pendingMode) return 'Change?';
        if (m.pendingProc !== null) return m.pendingProc ? 'Start?' : 'Stop?';
        if (m.changing) return 'Changng';
        const alarm = (m.alarms || []).find(a => a.active && !a.ack);
        if (alarm) return alarm.code;            // 有未确认报警：主画面显示报警号
        if (!m.procOn) return 'Stop';
        if (m.ctrl.stage === 'RAMP') return 'Heating';
        if (m.ctrl.stage === 'MANUAL') return 'Manual';
        return m.ctrl.kind === 'VISC' ? 'Visc ctl' : 'Temp ctl';
    }

    /** TT / VT 指示灯状态：'off' | 'blink' | 'on' */
    ledState() {
        const m = this.m;
        if (!m.epcPower) return { tt: 'off', vt: 'off' };
        if (m.oilMode === 'DO') {
            return { tt: m.ctrl.stage === 'RAMP' ? 'blink' : 'on', vt: 'off' };
        }
        if (m.ctrl.kind === 'TEMP') {
            return { tt: m.ctrl.stage === 'RAMP' ? 'blink' : 'on', vt: 'off' };
        }
        // 黏度控制
        if (m.ctrl.stage === 'RAMP') return { tt: 'on', vt: 'off' };
        return { tt: 'off', vt: 'on' };
    }

    /** 供 INFO 区显示的 4 行（PROCESS INFO 键翻页） */
    infoLines(page) {
        const m = this.m, p = m.params;
        const pages = [
            () => [
                `MODE  ${m.oilMode} / ${m.ctrl.kind}`,
                `OIL   ${m.oilMode === 'DO' ? 'DO' : 'HFO ' + (m.params.Pr24 === 1 ? 'G1' : m.params.Pr24 === 3 ? 'G3' : 'G2')}`,
                `TEMP  ${(m.oil.ttBad ? '***' : (m.oil.ttVal || 0).toFixed(1))} C`,      // 取 TT 实测值（故障 ***）
                `VISC  ${(m.oil.vtBad ? '***' : (m.oil.vtVal || 0).toFixed(1))} cSt`,    // 取 VT 实测值（故障 ***）
                `FLOW  ${(m.oil.ftFlow || 0).toFixed(2)} m3/h`,  // 取 FT 实测值
            ],
            () => [
                `SP1   ${this._pumpText('sp1')}`,
                `SP2   ${this._pumpText('sp2')}`,
                `CP1   ${this._pumpText('cp1')}`,
                `CP2   ${this._pumpText('cp2')}`,
            ],
            () => [
                `DP    ${m.filter.dp.toFixed(3)} MPa`,
                `FLUSH ${m.filter.flushing ? Math.ceil(m.filter.flushT) + ' s' : '--'}`,
                `DEAER ${m.dea.valve ? 'OPEN' : 'CLOSED'} ${m.dea.level.toFixed(0)}%`,
                `CV    ${m.cv}`,
            ],
            () => [
                `Pr20  ${p.Pr20} cSt`,
                `Pr30  ${p.Pr30} C`,
                `Pr1/2 ${p.Pr1}/${p.Pr2}`,
                `HEAT  ${Math.round(m.heater.effPower || 0)} %`,
            ],
        ];
        const i = ((page || 0) % pages.length + pages.length) % pages.length;
        return pages[i]();
    }

    infoPageCount() { return 4; }

    _pumpText(id) {
        const p = this.m.pumps[id];
        if (p.fault) return 'FAULT';
        if (p.on) return `RUN ${p.current.toFixed(1)}A`;
        if (!p.mainSwitch) return 'NO VOLT';
        if (p.mode === 'STOP') return 'STOP';
        return `${p.mode} STBY`;
    }

    /** 泵/阀状态文字（组件提示用） */
    pumpTip(id) {
        const p = this.m.pumps[id];
        return `${p.name}：选择开关 ${p.mode}，主开关 ${p.mainSwitch ? 'ON' : 'OFF'}，`
            + `${p.on ? `运行（${p.current.toFixed(1)} A）` : '停止'}`;
    }
}

export default FuelSupplySolver;
