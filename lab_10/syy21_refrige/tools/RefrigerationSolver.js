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

// 蒸发器化霜电路故障时，降温速率剩余比例（制冷效果变差 → 降温极慢）
// 原为 0.15，再减为 1/4 → 0.0375
const DEFROST_RATE_MUL = 0.15 * 0.25;

// 个别冷库升温速率附加系数（相对全局 heatRateMul）：鱼库 / 肉库再减半；菜库再提高 50%
const HEAT_MUL_BY_ROOM = { veg: 1.125, fish: 0.5, meat: 0.5 };
// 个别冷库降温速率再加倍（相对全局 coolRateMul 的附加系数）：鱼库
const COOL_MUL_BY_ROOM = { fish: 2 };

const ROOM_DEFS = [
    { key: 'dry', name: '干货库', setStart: 8, setStop: 4, init: 7 },
    { key: 'grain', name: '粮库', setStart: 6, setStop: 2, init: 4 },
    { key: 'veg', name: '菜库', setStart: -5, setStop: -7, init: -6.5 },
    { key: 'fish', name: '鱼库', setStart: -14, setStop: -18, init: -15 },
    { key: 'meat', name: '肉库', setStart: -16, setStop: -20, init: -15 },
];

// 回气总管压力（bar）：单库基准随库温/负荷由低到高（肉/鱼 < 菜 < 粮 < 干货）
const ROOM_BASE_P = { fish: 3.6, meat: 3.6, veg: 4.1, grain: 4.5, dry: 4.8 };
// 课程给定的组合表（键为开通库 key 升序拼接）
const HEADER_P_TABLE = {
    'fish': 3.6, 'meat': 3.6, 'veg': 4.1, 'grain': 4.5, 'dry': 4.8,
    'grain|veg': 5.5,   // 菜库 + 粮库
    'dry|grain': 5.8,   // 粮库 + 干货库
    'dry|veg': 5.6,     // 干货库 + 菜库
    'dry|grain|veg': 6.6,   // 干货库 + 粮库 + 菜库
};
/** 由「回路开通」的库组合求回气总管压力：表内组合取给定值，
 *  未列出组合以最暖库（基准最高者）为基准、每多一库 +1.0bar */
function headerPressure(keys) {
    const sorted = keys.slice().sort();
    const hit = HEADER_P_TABLE[sorted.join('|')];
    if (hit !== undefined) return hit;
    let base = 0;
    for (const k of sorted) base = Math.max(base, ROOM_BASE_P[k] || 3.6);
    return base + (sorted.length - 1);
}

export class RefrigerationSolver {
    constructor(sys) {
        this.sys = sys;

        this.m = {
            pe: 0.2, pc: 10.0, te: -3, tc: 40,
            psuc1: 0.1, psuc2: 0.1,
            pdis1: 14.5, pdis2: 14.5,
            tsh: 5, tsc: 3, tsuction: 2, tdischarge: 70, mflow: 0,
            running: false, mode: 'auto', loadPct: 0,
            oilP: 0,
            tcwIn: 30, tcwOut: 30, gw: 3.5, waterP: 0.2,
            rooms: {},
            activeRoom: 'dry', activeComp: 'comp1',
            comps: {
                // mode：每台机各自的手动/自动档位（自动起动系统时一号机自动、二号机保持手动）
                comp1: { running: false, loadPct: 0, manualRun: false, oilLevel: 50, mode: 'manual' },
                comp2: { running: false, loadPct: 0, manualRun: false, oilLevel: 50, mode: 'manual' },
            },
            oilsep: { comp1: 3, comp2: 3 },
            receiver: 50,
            ctrlOn: false,            // 控制器工作状态（默认关闭）
            masterSol: false,
            alarms: {
                comp1: { hp: false, loil: false, oilhi: false, wplow: false },
                comp2: { hp: false, loil: false, oilhi: false, wplow: false },
            },
            trip: false, tripReason: '', resetPulse: false,
        };

        this._params = {
            ambient: 32,
            kEnv: 0.08,        // 每库围护漏热 kW/K（与「每库 18% 负荷」匹配：单机制冷量足以压住单库漏热）
            cRoom: 110,        // 每库热容 kJ/K
            coolRateMul: 2,    // 降温速率倍数（净制冷段再提升 1 倍）
            heatRateMul: 0.5,  // 升温速率倍数（净放热/停机回暖段减半）
            uaEvap: 3.5,       // 蒸发器总传热 kW/K
            uaCond: 6.0,       // 冷凝器传热 kW/K
            qCapMax: 24,       // 两机满负荷总制冷量 kW
            roomLoadPct: 18,   // 单个冷库折算负荷率（%）：1 库 18%、2 库 36% … 5 库 90%
            copBase: 2.8,
            hpTrip: 16.5, wpLow: 0.5,
            oilDiff: 2.0, oilLowDiff: 0.8,
        };

        // 故障开关（由故障设置界面写入）
        this.faults = {
            vegExpValve: false,   // 菜库膨胀阀故障：制冷剂流量极小 → 不能制冷
            defrost: false,       // 蒸发器化霜电路故障：制冷效果变差 → 降温极慢
        };

        this._demand = false;
        this._masterOffTimer = 0;
        this._peClosing = false;
        this._peFrom = 0;
        this._peTimer = 0;
        this._psuc1Closing = false;
        this._psuc1From = 0;
        this._psuc1Timer = 0;
        this._psuc2Closing = false;
        this._psuc2From = 0;
        this._psuc2Timer = 0;
        this._inited = false;
    }

    _ensureInit() {
        if (this._inited) return;
        const m = this.m;
        m.rooms = {};
        ROOM_DEFS.forEach((d, i) => {
            // 若绑定的组件带同名库房配置，则以组件配置为准
            m.rooms[d.key] = {
                name: d.name, temp: d.init, setStart: d.setStart, setStop: d.setStop,
                valve: 0, cooling: false, alarm: false,
                fanOn: true,      // 蒸发器风机（带灯按钮控制：上=起动、下=停止）
                swOn: false,      // 温度开关（库温 > 启动值点亮）
                solOpen: false,   // 供液电磁阀通断（受控制器使能 + 温度开关延时）
                _solTimer: 0,     // 电磁阀随温度开关动作的 1s 延时计时
                loop: false,      // 制冷剂回路是否形成
                // 温度变化速度：自左向右每库递增 10%（最右库升温/降温最快），整体提升到原来的 2 倍
                speed: 2 * Math.pow(1.1, i),
                // 升温速率系数：全局 heatRateMul，菜/鱼/肉库再减半
                heatMul: (this._params.heatRateMul || 1) * (HEAT_MUL_BY_ROOM[d.key] || 1),
                // 降温速率系数：全局 coolRateMul，鱼库再加倍
                coolMul: (this._params.coolRateMul || 1) * (COOL_MUL_BY_ROOM[d.key] || 1),
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
            ['comp1', 'comp2'].forEach(id => {
                const c = m.comps[id];
                c.hpTripped = false; c.loTripped = false;
                c._hpTimer = 0; c._startTimer = 0; c._stopTimer = 0;
            });
            m.resetPulse = false;
        }

        // ── ④ 安全保护 ──
        // 淡水压力低 / 冷却水进口阀关闭：只报警不停机（见第⑩段 a.wplow）；
        // 关闭冷却水后该机排出压力持续上升，最终由排出压力过高保护停机。

        // ── ⑤ 运行判定（每台压缩机） ──
        // 自动模式：压力继电器 —— 入口压力 > 启动压力 → 延时 5s 启动；
        //           < 启动压力−压差 → 延时 6s 停机；滞环区保持原状态
        // 手动模式：由起动/停止按钮（manualRun）决定；排出压力过高保护锁存时强制停机
        ['comp1', 'comp2'].forEach(id => {
            const c = m.comps[id];
            const mode = c.mode || m.mode;   // 每台压缩机可独立手动/自动
            const psuc = (id === 'comp1') ? m.psuc1 : m.psuc2;   // 入口压力（上一帧）
            const startP = (c.startP !== undefined) ? c.startP : 1.8;
            const diffP = (c.diffP !== undefined) ? c.diffP : 0.3;
            let desired;
            if (mode === 'manual') {
                c._startTimer = 0; c._stopTimer = 0;
                desired = !!c.manualRun;
            } else {
                let target;
                if (psuc > startP) target = true;
                else if (psuc < startP - diffP) target = false;
                else target = c.running;     // 滞环区：保持原状态
                if (target === true && !c.running) {
                    c._stopTimer = 0;
                    c._startTimer = (c._startTimer || 0) + dt;   // 高于启动压力：计时
                    desired = c._startTimer >= 5;
                } else if (target === false && c.running) {
                    c._startTimer = 0;
                    c._stopTimer = (c._stopTimer || 0) + dt;     // 低于启动压力−压差：计时
                    desired = c._stopTimer < 6;
                } else {
                    c._startTimer = 0; c._stopTimer = 0;
                    desired = c.running;
                }
            }
            // 保护锁存（排出压力过高 / 滑油液位过低）后强制停机，需复位
            if (m.trip || c.hpTripped || c.loTripped) desired = false;
            c.running = desired;
        });
        m.running = m.comps.comp1.running || m.comps.comp2.running;
        const runningCount = (m.comps.comp1.running ? 1 : 0) + (m.comps.comp2.running ? 1 : 0);
        // 负荷率：每个制冷中的冷库折算 18%（上一帧统计，见 ⑥ 末）：单机 1 库 18%、2 库 36% … 5 库 90%；
        // 双机运行时由运行中的压缩机平均分担
        const demandPct = Math.min(100, (this._nCool || 0) * P.roomLoadPct);
        ['comp1', 'comp2'].forEach(id => {
            const c = m.comps[id];
            const target = (c.running && runningCount) ? demandPct / runningCount : 0;
            c.loadPct = lerp(c.loadPct, target, c.running ? 0.06 : 0.12);
            if (c.loadPct < 0.5) c.loadPct = 0;
        });
        m.loadPct = runningCount ? (m.comps.comp1.loadPct + m.comps.comp2.loadPct) / runningCount : 0;

        // ── ⑥ 各库制冷需求与分配 ──
        // 库内蒸发器风机由带灯按钮控制
        const rsys = comps['refsys'];
        const hv = (id) => (rsys && typeof rsys.isHandValveOpen === 'function') ? rsys.isHandValveOpen(id) : true;

        // 控制器工作状态：仅工作状态才允许控制电磁阀输出
        const ctrlOn = (rsys && typeof rsys.isControllerOn === 'function') ? rsys.isControllerOn() : true;
        m.ctrlOn = ctrlOn;

        // 各库温度开关与供液电磁阀：
        //   温度开关：只受库温控制 —— 库温 > 启动值 → 点亮；< 停止值 → 熄灭；中间滞环保持。
        //             （与控制器是否工作无关）
        //   供液电磁阀：由控制器输出驱动 —— 控制器工作时随温度开关动作（延时 1s）；
        //             控制器不工作时无输出，电磁阀保持关闭。
        for (const k in m.rooms) {
            const r = m.rooms[k];
            r.fanOn = (rsys && typeof rsys.getRoomFan === 'function') ? rsys.getRoomFan(k) : true;
            // 温度开关：只受库温变化控制（滞环），与控制器是否工作无关
            if (r.temp > r.setStart) r.swOn = true;
            else if (r.temp < r.setStop) r.swOn = false;

            // 供液电磁阀：由控制器输出驱动；控制器不工作时无输出、电磁阀保持关闭
            if (!ctrlOn) {
                r.solOpen = false; r._solTimer = 0;
            } else {
                const target = !!r.swOn;
                if (target === r.solOpen) { r._solTimer = 0; }
                else {
                    r._solTimer = (r._solTimer || 0) + dt;
                    if (r._solTimer >= 1) { r.solOpen = target; r._solTimer = 0; }
                }
            }
            r.load = Math.max(0.05, P.kEnv * (P.ambient - r.temp));
        }

        // 总电磁阀（回热器下方供液电磁阀）：任一库电磁阀开启即开启；
        // 全部库电磁阀关闭后延时 1s 关闭；控制器关闭时立即断电
        const anyRoomSol = Object.keys(m.rooms).some(k => m.rooms[k].solOpen);
        if (!ctrlOn) { m.masterSol = false; this._masterOffTimer = 0; }
        else if (anyRoomSol) { m.masterSol = true; this._masterOffTimer = 0; }
        else if (m.masterSol) {
            this._masterOffTimer += dt;
            if (this._masterOffTimer >= 1) { m.masterSol = false; this._masterOffTimer = 0; }
        }

        // 液态制冷剂到达各库供液电磁阀入口：总电磁阀开启，且两压缩机并联任一路径成立
        // （该机进/出口截止阀 + 该机冷凝器出口截止阀开启），且接收器出口、干燥过滤器出口截止阀开启
        const liquidLineOpen = hv('rec-out') && hv('liq-main') && !!m.masterSol;
        const comp1Path = m.comps.comp1.running && hv('suc1') && hv('dis1') && hv('cond1-out');
        const comp2Path = m.comps.comp2.running && hv('suc2') && hv('dis2') && hv('cond2-out');
        const supplyOK = liquidLineOpen && (comp1Path || comp2Path);

        // 故障：菜库膨胀阀故障 → 制冷剂流量极小，该库不能制冷（温度缓慢上升）
        const F = this.faults || (this.faults = {});
        for (const k in m.rooms) {
            const r = m.rooms[k];
            r.loop = supplyOK && r.solOpen && hv('out-' + k);   // 形成制冷剂回路（供液电磁阀 + 出口截止阀）
            r.cooling = r.loop && r.fanOn;                      // 蒸发器风机开启 → 实际制冷
            r.expFault = (k === 'veg') && !!F.vegExpValve;
            if (r.expFault) r.cooling = false;                  // 膨胀阀卡死：无有效制冷剂流量
            r.defrostFault = (k === 'fish') && !!F.defrost;     // 化霜电路故障（仅鱼库）：制冷效果变差
        }

        const flowRooms = [];   // 已形成制冷剂回路的库（供液电磁阀 + 出口截止阀 + 主回路导通）
        const coolRooms = [];   // 实际制冷的库（回路形成 + 蒸发器风机运行）
        const branchKeys = [];  // 回气总管上「通路」的库（供液电磁阀 + 出口截止阀均导通）
        for (const k in m.rooms) {
            const r = m.rooms[k];
            if (r.solOpen && hv('out-' + k)) branchKeys.push(k);
            if (r.loop) flowRooms.push({ key: k, r });
            if (r.cooling) coolRooms.push({ key: k, r });
        }
        const anyBranchOpen = branchKeys.length > 0;
        const flowLoad = flowRooms.reduce((s, o) => s + o.r.load, 0);
        this._nCool = coolRooms.length;   // 下一帧负荷率 = 18% × 制冷中的冷库数

        // ── ⑦ 热力平衡 ──
        const trAvg = this._avgRoomTemp();
        const Qcap = P.qCapMax * runningCount * (m.loadPct / 100);
        // 回气总管压力 = 各回路导通库蒸发压力的代表值：
        // 蒸发温度比库温低 5~10℃（负荷越大温差越大），多库开通时取库温最低者
        // —— 取最低者（而非最高者）才能保证最冷的库也低于蒸发温度、真正制冷；
        //    否则较冷的库（菜/鱼/肉）会落在 te 之下、制冷需求为 0，温度反而上升
        let teTarget;
        if (m.running) {
            if (flowRooms.length) {
                const trMin = Math.min.apply(null, flowRooms.map(o => o.r.temp));
                const loadRatio = clamp(flowLoad / Math.max(1, P.qCapMax), 0, 1);
                // 蒸发温度比最冷库再低 7~12℃：基础温差必须大于最冷库的漏热所需
                // （0.7×ΔT > 0.08×(32−T)，肉库 T=−20 约需 6℃），否则少库运行时低温库
                // 会在停止温度之上找到平衡点、卡住降不下去
                teTarget = trMin - (7 + 5 * loadRatio);
            } else {
                teTarget = -35;                 // 压缩机运行但无供液回路：向低压抽空
            }
        } else {
            teTarget = trAvg;                   // 停机：向平均库温回稳
        }
        m.te = lerp(m.te, clamp(teTarget, -35, 15), 0.05);
        // 回气总管压力：由当前「回路开通」的库组合决定（见 headerPressure）；
        //   全部关闭后由关闭时的值线性降至 0.2bar：
        //     · 所有冷库出口截止阀关闭 → 5s 内降至 0.2bar；
        //     · 其余（如所有供液电磁阀关闭）→ 10s 内降至 0.2bar。
        if (anyBranchOpen) {
            m.pe = headerPressure(branchKeys);
            this._peClosing = false;
        } else {
            const allOutClosed = Object.keys(m.rooms).every(k => !hv('out-' + k));
            const dur = allOutClosed ? 5 : 10;
            if (!this._peClosing) { this._peFrom = m.pe; this._peTimer = 0; this._peClosing = true; }
            this._peTimer += dt;
            const f = Math.min(1, this._peTimer / dur);
            m.pe = this._peFrom + (0.2 - this._peFrom) * f;
        }
        // 压缩机1入口压力：入口截止阀开启时 = 蒸发器输出管路压力 − 0.1bar；
        // 关闭时由关闭前的数值在 10s 内线性下降至 0.1bar
        if (hv('suc1')) {
            m.psuc1 = m.pe - 0.1;
            this._psuc1Closing = false;
        } else {
            if (!this._psuc1Closing) { this._psuc1From = m.psuc1; this._psuc1Timer = 0; this._psuc1Closing = true; }
            this._psuc1Timer += dt;
            const f = Math.min(1, this._psuc1Timer / 10);
            m.psuc1 = this._psuc1From + (0.1 - this._psuc1From) * f;
        }
        // 压缩机2入口压力：同压缩机1
        if (hv('suc2')) {
            m.psuc2 = m.pe - 0.1;
            this._psuc2Closing = false;
        } else {
            if (!this._psuc2Closing) { this._psuc2From = m.psuc2; this._psuc2Timer = 0; this._psuc2Closing = true; }
            this._psuc2Timer += dt;
            const f = Math.min(1, this._psuc2Timer / 10);
            m.psuc2 = this._psuc2From + (0.1 - this._psuc2From) * f;
        }
        // 排气压力：正常 = 压缩机入口压力 + 10bar；冷却水截止阀关闭（断流）且运行时持续上升
        // （趋近 30bar，触发排出压力过高保护）；停机时向入口压力回稳
        ['comp1', 'comp2'].forEach(id => {
            const c = m.comps[id];
            const psuc = (id === 'comp1') ? m.psuc1 : m.psuc2;
            const cwOpen = (id === 'comp1') ? hv('cw1') : hv('cw2');
            let pdis = (id === 'comp1') ? m.pdis1 : m.pdis2;
            if (c.running) pdis = cwOpen ? lerp(pdis, psuc + 10, 0.1) : lerp(pdis, 30, 0.01);
            else pdis = lerp(pdis, psuc, 0.05);
            if (id === 'comp1') m.pdis1 = pdis; else m.pdis2 = pdis;
        });
        m.pc = Math.max(m.pdis1, m.pdis2);   // 系统高压侧（代表值）

        // 各制冷库实际制冷量分配：
        //   ① 机制冷量按各库「漏热负荷」比例**公平分配**（不再按温差分配 —— 否则高温库
        //      温差大、抢走绝大部分冷量，鱼库/肉库等低温库虽已制冷却仍升温）；
        //   ② 单库再受蒸发器自身能力限制（∝ 库温 − 蒸发温度）。
        let coolLoadSum = 0;
        for (const o of coolRooms) coolLoadSum += Math.max(0.05, o.r.load);
        const QeMax = Qcap * 1.1;                 // 机制冷量（含 10% 降温余量）
        let Qe = 0;
        const coolDem = new Map();
        for (const o of coolRooms) {
            const share = (coolLoadSum > 0.001)
                ? Math.max(0.05, o.r.load) / coolLoadSum
                : 1 / coolRooms.length;
            const evapCap = (P.uaEvap / 5) * Math.max(0, o.r.temp - m.te);
            const d = Math.min(QeMax * share, evapCap);
            coolDem.set(o.key, d);
            Qe += d;
        }
        const demSum = Qe;

        const cop = Math.max(1.3, P.copBase * ((m.te + 273.15) / Math.max(5, (m.tc - m.te))));
        const Wcomp = Qe / cop;
        const Qc = Qe + Wcomp;
        const tcwAvg = (m.tcwIn + m.tcwOut) / 2;
        const tcTarget = m.running ? (tcwAvg + 0.4 + Qc / P.uaCond) : m.tcwIn;
        m.tc = lerp(m.tc, clamp(tcTarget, m.tcwIn, 75), 0.05);

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
            // 各库实际制冷量（⑦ 已按漏热公平分配并受单库蒸发器能力限制）
            const cool_i = (demSum > 0.001 && coolDem.has(k)) ? coolDem.get(k) : 0;
            // 净制冷（降温）段速率 ×coolRateMul；净放热（升温）段速率 ×heatRateMul（减半）
            // 故障：蒸发器化霜电路故障 → 蒸发器结霜、换热恶化 → 降温速率仅剩 DEFROST_MUL
            let dT = (r.load - cool_i) * r.speed * dt / P.cRoom;
            if (dT < 0) dT *= (r.coolMul !== undefined ? r.coolMul : (P.coolRateMul || 1))
                * (r.defrostFault ? DEFROST_RATE_MUL : 1);
            else if (dT > 0) dT *= (r.heatMul !== undefined ? r.heatMul : (P.heatRateMul || 1));
            r.temp = clamp(r.temp + dT, -30, 40);
            r.valve = r.solOpen ? clamp(8 + m.loadPct * 0.3, 0, 100) : 0;
            r.alarm = m.trip || (r.temp > r.setStart + 8);
        }

        // ── ⑨ 附属显示量 ──
        // ── 滑油系统（油液分离器液位 / 压缩机滑油液位 / 回油电磁阀）──
        ['comp1', 'comp2'].forEach((id, i) => {
            const c = m.comps[id];
            const n = i + 1;
            let lvl = (m.oilsep[id] !== undefined) ? m.oilsep[id] : 3;
            if (c.oilSolOpen === undefined) c.oilSolOpen = false;

            // ① 压缩机运行时：油气带入分离器，分离器 +6%/min，压缩机滑油 −2%/min
            if (c.running) {
                lvl += (6 / 60) * dt;
                c.oilLevel = clamp(c.oilLevel - (2 / 60) * dt, 0, 100);
            }

            // ② 回油电磁阀：液位升到 20% 接通 → 向压缩机注油（分离器 −1%/s，压缩机 +1/3 %/s）；
            //    液位降到 3% 断开
            if (lvl >= 20) c.oilSolOpen = true;
            else if (lvl <= 3) c.oilSolOpen = false;
            if (c.oilSolOpen) {
                lvl -= 1 * dt;
                c.oilLevel = clamp(c.oilLevel + (1 / 3) * dt, 0, 100);
            }

            // ③ 滑油注入口截止阀打开：压缩机滑油液位 +2%/s
            if (hv('oil' + n + '-in')) c.oilLevel = clamp(c.oilLevel + 2 * dt, 0, 100);
            // ④ 滑油出口截止阀打开：压缩机滑油液位 −1.5%/s
            if (hv('oil' + n + '-out')) c.oilLevel = clamp(c.oilLevel - 1.5 * dt, 0, 100);

            m.oilsep[id] = clamp(lvl, 0, 100);
        });
        // 接收器液位：初始 50%，压缩机起动后随系统负荷下降（负荷 100% 时降到 30%）
        m.receiver = clamp(50 - m.loadPct * 0.20, 30, 50);

        // ── ⑩ 报警与保护 ──
        ['comp1', 'comp2'].forEach(id => {
            const c = m.comps[id], a = m.alarms[id];
            const hpP = (c.hpP !== undefined) ? c.hpP : 22;
            const pdis = (id === 'comp1') ? m.pdis1 : m.pdis2;
            // 排出压力超过停止压力 → 排出压力过高保护（延时 3s 锁存，需复位）
            if (pdis > hpP) {
                c._hpTimer = (c._hpTimer || 0) + dt;
                if (c._hpTimer >= 3) {
                    c.hpTripped = true;
                    if (!m.tripReason) m.tripReason = (id === 'comp1' ? '一号压缩机' : '二号压缩机') + '排出压力过高';
                }
            } else if (!c.hpTripped) {
                c._hpTimer = 0;
            }
            a.hp = !!c.hpTripped;
            // 淡水泵压力低 或 该机冷却水进口截止阀关闭 → 该机「淡水压力过低」报警（只报警不停机）
            a.wplow = (m.waterP < P.wpLow) || !hv(id === 'comp1' ? 'cw1' : 'cw2');
            // 压缩机滑油液位过低（<15%）→ 滑油压力低报警，并触发该机保护停机（锁存）
            a.loil = (c.oilLevel || 0) < 15;
            if (a.loil && !c.loTripped) {
                c.loTripped = true;
                m.tripReason = (id === 'comp1' ? '一号压缩机' : '二号压缩机') + '滑油液位过低';
            }
            const oilLvl = (id === 'comp1' ? m.oilsep.comp1 : m.oilsep.comp2);
            // 分离器滑油液位过高（>30%）→ 滑油分离器液位高
            a.oilhi = oilLvl > 30;
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
