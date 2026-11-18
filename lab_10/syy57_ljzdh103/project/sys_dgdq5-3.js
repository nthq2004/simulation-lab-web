/**
 * 船舶辅锅炉（PLC 控制）仿真项目配置
 * ═══════════════════════════════════════════════════════════════════════════
 *  依据：第六章 图 6-3-18（系统组成）、表 6-3-1（I/O 表）、
 *        图 6-3-19（外部接线）、图 6-3-20/21/22（梯形图 1~27 段）、
 *        图 6-3-23（锅炉运行流程图）、第 215~218 页（操作规程与安全保护）。
 *
 *  页 1：锅炉系统图（汽水 / 燃油 / 燃烧 / 保护元件）+ 机旁操纵台
 *  页 2：CPU（S7-200 SMART SR40 + EM DQ08）与 I/O 端子
 *
 *  说明：CPU 与锅炉系统图分处两页，页面间无法拉真实导线，
 *        故操纵台与过程开关量经 sys.ioBridge（BoilerSolver.applyInputs）写入
 *        PLC 的 I 过程映像，Q 输出回读给锅炉本体与指示灯；
 *        CPU 端子排上实时显示各 I/Q 点的电平，可点击查看地址与用途。
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { BoilerSystemDiagram } from '../components/BoilerSystemDiagram.js';
import { BoilerLocalPanel } from '../components/BoilerLocalPanel.js';
import { BoilerWiringDiagram } from '../components/BoilerWiringDiagram.js';
import { GroundSymbol } from '../components/GroundSymbol.js';
import { PlcInternalMonitor } from '../components/PlcInternalMonitor.js';

import { S7_200_SMART_SR40 } from '../components/S7_200_SMART_SR40.js';
import { S7_200_EM_DQ08 } from '../components/S7200_EM_DQ08.js';
import { STEP7PC } from '../components/STEP7PC.js';

import { Multimeter } from '../components/Multimeter.js';
import { MF47Multimeter } from '../components/MF47Multimeter.js';
import { Oscilloscope_tri } from '../components/Osc_tri.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';
import { ElecMeter } from '../components/ElecMeter.js';
import { RealMegohmMeter } from '../components/RealMegohmMeter.js';

// ═══════════════════════════════════════════════════════════════════════════
//  PLC 程序：教材图 6-3-20 / 6-3-21 / 6-3-22 的梯形图逐段翻译为语句表
//  （S7200Solver 逐扫描解释执行；可在 CPU 组件右键「程序编辑器」查看/修改）
// ═══════════════════════════════════════════════════════════════════════════
const BOILER_PROGRAM = `
// ══════ 程序段 1：超高水位判定 ══════
LD I0.5
= Q0.2

// ══════ 程序段 2：危险低水位判定 ══════
LD I0.6
= Q0.3

// ══════ 程序段 3：1# 给水泵运行控制 ══════
LD I0.0
A I0.4
LD I0.1
OLD
AN Q0.2          // 只有超高水位才封锁给水（防溢流）
= Q0.0

// ══════ 程序段 4：2# 给水泵运行控制 ══════
LD I0.2
A I0.4
LD I0.3
OLD
AN Q0.2          // 只有超高水位才封锁给水（防溢流）
= Q0.1

// ══════ 程序段 5：燃烧起动就绪与停止 ══════
LD I1.6
O I1.7
AN I1.0
LD I0.7
O Q2.1
ALD
= Q2.1

// ══════ 程序段 6：自动安全运行信号组合 / 后扫风 / 风机运行 ══════
LD Q2.1
A I1.1
AN I2.3
AN M0.1
TOF T104, 200
LD Q2.1
A I1.1
AN I2.3
AN M0.1
= M0.2
LD Q2.1
A I1.1
AN I2.3
AN M0.1
LD Q2.1
A T104
OLD
LD Q2.1
A I1.2
OLD
LD Q2.1
A I1.3
OLD
LD Q2.1
A I1.4
OLD
LD Q2.1
A I1.5
OLD
AN Q1.0
= Q0.4

// ══════ 程序段 7：风机压力检测开始时间（20 s）══════
// 注意：A Q0.4 —— 只有风机实际运行时才做风压失压计时。
// 否则自动停炉后的待机状态（Q2.1 仍保持、风机已停）压力为 0，20 s 后会误报风机失压。
LD I1.2
O I1.1
A Q2.1
A Q0.4
TON T108, 200

// ══════ 程序段 8：风机失压检测 ══════
LD T108
O I1.3
O I1.4
O I1.5
O Q1.0
A I2.2
= M0.0
LD T108
O I1.3
O I1.4
O I1.5
O Q1.0
AN M0.0
AN I1.0
A Q2.1
= Q1.0

// ══════ 程序段 9：手动点火变压器运行时间（3 s）══════
LD I1.3
TON T107, 30

// ══════ 程序段 10：手动点火失败时间判定（5 s）══════
LD I1.3
AN Q1.6
A Q2.1
TON T105, 50

// ══════ 程序段 11：燃烧时序控制（风门 / 油泵 / 电磁阀 / 大小火）══════
LD Q0.4
A I1.1
A M0.3
AN Q1.5
LD Q0.4
A I1.3
OLD
LD Q0.4
A I1.4
OLD
= Q1.4
LD Q0.4
A I1.1
A M0.3
AN M0.1
LD Q0.4
A I1.3
AN T105
OLD
LD Q0.4
A I1.4
OLD
LD Q0.4
A I1.5
OLD
= M2.0
LD M2.0
A I1.6
= Q0.5
LD M2.0
A I1.7
= Q0.6
LD Q0.4
A I1.1
A M0.2
A M3.1
LD Q0.4
A I1.3
AN T105
OLD
LD Q0.4
A I1.4
OLD
LD Q0.4
A I1.5
OLD
AN M0.1          // 任一报警（安全停炉）→ 立即切断进油，手动档位同样适用
= M2.1
LD Q0.4
A I1.1
A M3.0
AN M3.1
LD Q0.4
A I1.1
A M2.1
AN M0.4
AN T105
OLD
LD Q0.4
A I1.3
AN T107
OLD
= Q1.1
LD M2.1
= Q1.2
LD M2.1
= Q1.3
LD Q0.4
A I1.1
AN I2.5
A M0.5
LD Q0.4
A I1.5
OLD
= Q1.5
LD Q0.4
A I1.1
AN I2.5
A M0.5
LD Q0.4
A I1.5
OLD
= Q2.2
LD Q0.4
A I1.1
A M0.4
AN Q2.2
LD Q0.4
A I1.4
OLD
= Q2.3

// ══════ 程序段 12：预扫风 36 s / 点火位置 3 s / 点火准备 5 s / 点火 3 s / 小火稳定 20 s ══════
LD Q0.4
A I1.1
A M0.2
TON T101, 360
LD T101
= M0.3
// ① 点火位置：风门电磁铁（Q1.4）已通电 → 小风门，油泵可运行但电磁阀未开
LD Q0.4
A I1.1
A M0.3
TON T109, 30
LD T109
= M3.0
// ② 点火准备：点火变压器通电打火（Q1.1），仍不喷油
LD Q0.4
A I1.1
A M3.0
TON T110, 50
LD T110
= M3.1
LD M3.1
TON T102, 30
LD T102
= M0.4
LD M0.4
TON T103, 200
LD T103
= M0.5

// ══════ 程序段 13：火焰信号判定 ══════
LD I2.4
= Q1.6

// ══════ 程序段 13a：火焰曾建立记忆（用于区分点火失败 / 运行熄火）══════
// 只要出现过火焰信号就置位，停止或重新燃烧准备时复位；
// 故障熄火只在"曾经建立过火焰"之后才判，起动阶段无火则判点火失败（T106）。
LD Q1.6
S M3.2, 1
LD I1.0
O I0.7
R M3.2, 1

// ══════ 程序段 14：故障熄火指示 ══════
LD Q1.3
A M0.4
A M3.2
LD Q1.5
A I1.4
OLD
LD Q1.5
A I1.5
OLD
LD Q2.5
OLD
AN Q1.6
AN I1.0
= Q2.5

// ══════ 程序段 15：点火监视时间设定（8 s）══════
LD M3.1
AN Q1.6
TON T106, 80

// ══════ 程序段 16：点火失败指示 ══════
LD T106
O Q2.4
O T105
AN I1.0
= Q2.4

// ══════ 程序段 17：重油油温过低判定 ══════
LD I2.1
= Q0.7

// ══════ 程序段 18：蒸汽压力过高判定 ══════
LD I2.6
= Q1.7

// ══════ 程序段 19：报警信号组合 ══════
LD Q0.3
O Q0.7
O Q1.0
O Q1.7
O Q2.5
O Q2.4
= M0.1

// ══════ 程序段 20：音响报警 ══════
LD Q0.3
AN M1.0
LD Q0.7
AN M1.1
OLD
LD Q1.0
AN M1.2
OLD
LD Q1.7
AN M1.3
OLD
LD Q2.5
AN M1.4
OLD
LD Q2.4
AN M1.5
OLD
LD Q0.2
AN M1.6
OLD
= Q2.0

// ══════ 程序段 21：水位过低消声 ══════
LD I2.0
O M1.0
A Q0.3
= M1.0

// ══════ 程序段 22：油温过低消声 ══════
LD I2.0
O M1.1
A Q0.7
= M1.1

// ══════ 程序段 23：风机失压消声 ══════
LD I2.0
O M1.2
A Q1.0
= M1.2

// ══════ 程序段 24：蒸汽压力过高消声 ══════
LD I2.0
O M1.3
A Q1.7
= M1.3

// ══════ 程序段 25：故障熄火消声 ══════
LD I2.0
O M1.4
A Q2.5
= M1.4

// ══════ 程序段 26：点火失败消声 ══════
LD I2.0
O M1.5
A Q2.4
= M1.5

// ══════ 程序段 27：超高水位消声 ══════
LD I2.0
O M1.6
A Q0.2
= M1.6
`;

// ═══════════════════════════════════════════════════════════════
// 页面定义（多页面画布）
//   页 0：索引页（DOM 浮层卡片）
//   页 1：锅炉系统图 + 机旁操纵台
//   页 2：CPU（SR40 + EM DQ08）与 I/O 端子
// 所有组件同时创建并参与求解，页面只控制显隐。
// ═══════════════════════════════════════════════════════════════

const INSTRUMENTS = ['multimeter', 'mf47-panel', 'osc', 'sg', 'cali', 'elecmeter', 'megohm'];

export const PROJECT_PAGES = [
    { id: 0, name: '索引', type: 'index' },
    {
        id: 1, name: '锅炉系统图与机旁操纵台',
        comps: ['boiler', 'local', ...INSTRUMENTS],
        desc: '左：汽水 / 燃油 / 燃烧系统图（汽包、炉膛、水位电极、给水泵、重油柜与油泵、加热器、三只电磁阀、双油头、点火变压器、紫外光电管、送风机与风门、风压继电器、三只压力继电器、声光报警）。右：辅锅炉机旁操纵台（总电源开关、燃烧控制六档旋钮、油泵三档开关、1#/2# 给水泵三档开关、燃烧准备 / 停止 / 消声按钮、12 只指示灯）。',
    },
    {
        id: 2, name: 'PLC CPU、I/O 端子与上位机',
        comps: ['plc-1', 'em-dq08', 'step7pc-1', 'wiring', 'ground-1', 'local2', 'm-monitor', ...INSTRUMENTS],
        desc: 'S7-200 SMART CPU SR40（I0.0~I2.7）+ EM DQ08（Q2.0~Q2.7），与教材表 6-3-1 的 I/O 一一对应：端子上实时显示各点电平，可点击查看地址与用途；右键可打开程序编辑器，查看/修改图 6-3-20~22 翻译成的 27 段语句表程序。左为装有 STEP 7-Micro/WIN SMART 的上位机（编程计算机），以太网线接到 CPU 网口，可双击打开编程软件完成查找设备、连接、上传、下载、在线监控与梯形图编程；右为**外部接线图**（图 6-3-19），按表 6-3-1 画出 I0.0~I2.7 与 Q0.0~Q2.7 的开关、触点、线圈与指示灯，实时反映 PLC 的输入/输出状态。操纵与显示集中在第 1 页的「辅锅炉机旁操纵台」；第 2 页另有一台完全同步的镜像操纵台（local2），便于对照 PLC 端子调试。',
    },
];

// ═══════════════════════════════════════════════════════════════
// 组件配置（1920 × 1080 基准坐标）
// ═══════════════════════════════════════════════════════════════

export const componentConfigs = [
    // ── 页 1 ──
    { Class: BoilerSystemDiagram, id: 'boiler', x: -150, y: 10, page: 1, width: 1150, height: 830, timeScale: 1 },
    { Class: BoilerLocalPanel, id: 'local', x: 1096, y: 80, page: 1, width: 540, height: 700 },

    // ── 页 2 ──
    { Class: S7_200_SMART_SR40, id: 'plc-1', x: 1500, y: 320, page: 2, label: 'CPU SR40', mode: 'RUN', program: BOILER_PROGRAM },
    { Class: S7_200_EM_DQ08, id: 'em-dq08', x: 1980, y: 320, page: 2, attachTo: 'plc-1' },
    // 上位机（编程计算机）：以太网口经网线与 CPU 网口相连，ip 与 CPU 同网段
    { Class: STEP7PC, id: 'step7pc-1', x: 1660, y: 180, page: 2, label: '上位机 (STEP7)', hostname: 'STEP7-PC', ip: '192.168.0.2' },
    // 外部接线图（实时 I/O 监视屏）
    { Class: BoilerWiringDiagram, id: 'wiring', x: -160, y: 20, page: 2, width: 630, height: 820 },
    // PLC 内部位监视表（与接线图同高，宽为 1/4）
    { Class: PlcInternalMonitor, id: 'm-monitor', x: 606, y: 20, page: 2, width: 178, height: 820 },

    // 第 2 页镜像操纵台：与第 1 页 'local' 完全同构，
    // 两者都只读写 sys.boilerSolver 的状态，因此操作与显示天然同步（互为镜像）
    { Class: BoilerLocalPanel, id: 'local2', x: 828, y: 60, page: 2, width: 540, height: 700 },

    // 接地符号（CPU 左下角的保护接地 PE）
    { Class: GroundSymbol, id: 'ground-1', x: 1452, y: 786, page: 2, width: 64, height: 64 },


    // ── 7 种标准仪表（默认隐藏，通过「选择仪表」调出）──
    { Class: Multimeter, id: 'multimeter', x: 1240, y: 520, page: 1, visible: false },
    { Class: MF47Multimeter, id: 'mf47-panel', x: 1300, y: 300, page: 1, visible: false },
    { Class: Oscilloscope_tri, id: 'osc', x: 60, y: 300, page: 1, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 60, y: 300, page: 1, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 60, y: 300, page: 1, visible: false },
    { Class: ElecMeter, id: 'elecmeter', x: 60, y: 300, page: 1, visible: false },
    { Class: RealMegohmMeter, id: 'megohm', x: 60, y: 300, page: 1, visible: false },
];

// ═══════════════════════════════════════════════════════════════
// 故障配置（对应教材第 216~218 页的 7 类安全保护 + 2 类辅助故障）
// ═══════════════════════════════════════════════════════════════

const _bs = () => (window.sys && window.sys.boilerSolver) || null;

function _mkFault(id, name, system, key, desc) {
    return {
        id, name, system, desc,
        check() { const s = _bs(); return !!(s && s.getFault(key)); },
        trigger() { const s = _bs(); if (s) s.setFault(key, true); },
        repair() { const s = _bs(); if (s) s.setFault(key, false); },
    };
}

export const FAULT_CONFIGS = {
    flame_sensor: _mkFault('flame_sensor', '火焰监视器故障', '火焰监测',
        'flameSensor', '紫外光电管收不到火焰信号：点火时序内建不起火焰（T106 8 s）→ Q2.4 点火失败；运行中则判故障熄火 Q2.5，切断进油并后扫风。'),
    damper_stuck: _mkFault('damper_stuck', '风门卡死', '送风',
        'damperStuck', '风门衔铁卡在关小位置：风机虽转但风压只能建立到 0.45（合格值 0.6），风压继电器 I2.2 不闭合，20 s（T108）后报风机失压 Q1.0 并停炉；风压不合格时也不允许点火。'),
    oil_temp_low: _mkFault('oil_temp_low', '重油加热器故障', '燃油',
        'oilTempLowFault', '重油加热器停止加热，油温降到 90 ℃ 以下：Q0.7 油温过低报警，且重油雾化不良、点不着火或中途熄火。'),
    over_pressure: _mkFault('over_pressure', '压力继电器故障', '蒸汽',
        'overPressure', '自动起停压力继电器失灵（I2.3 恒为 0）：压力升到 0.70 MPa 也不停炉，继续升到 0.78 MPa 由蒸汽超压继电器 Q1.7 保护；若 I2.6 也被屏蔽，压力一直升到安全阀 0.85 MPa 起跳卸放。'),
};

// ═══════════════════════════════════════════════════════════════
// 演示 / 演练辅助
// ═══════════════════════════════════════════════════════════════

const _sleep = (ms) => new Promise(r => setTimeout(r, ms));
const _sysOf = (ctx) => (ctx && ctx.sys) ? ctx.sys : window.sys;
const _bsOf = (ctx) => { const s = _sysOf(ctx); return (s && s.boilerSolver) || null; };
const _compOf = (ctx, id) => { const s = _sysOf(ctx); return (s && s.comps) ? s.comps[id] : null; };

/** 像真的一样点击某部件节点（触发组件自身的 click 处理，而非直接赋值） */
function _firePart(comp, partId, dir) {
    if (!comp) return false;
    try {
        const n = comp.getClickablePartNode && comp.getClickablePartNode(partId);
        if (n && typeof n.fire === 'function') {
            n.fire('click', dir ? { _dir: dir } : undefined);
            return true;
        }
    } catch (e) { /* ignore */ }
    console.warn('[锅炉流程] 未找到可点击部件：', partId);
    return false;
}

/** 反复点击（旋钮循环换档 / 按钮脉冲）直到条件成立；dir = 1 顺时针 / -1 逆时针 */
async function _clickUntil(comp, partId, pred, maxTimes = 8, gap = 320, dir = 1) {
    for (let i = 0; i < maxTimes; i++) {
        if (pred()) return true;
        _firePart(comp, partId, dir);
        await _sleep(gap);
    }
    return pred();
}

/** 等待条件成立 */
async function _waitFor(cond, timeoutMs = 90000, gapMs = 250) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
        try { if (cond()) return true; } catch (e) { /* ignore */ }
        await _sleep(gapMs);
    }
    try { return !!cond(); } catch (e) { return false; }
}

const _stage = (s) => (s && s.m && s.m.stage) || '停炉';

/** 上位机（Step7）界面实例 */
function _s7(ctx) {
    const pc = _compOf(ctx, 'step7pc-1');
    return (pc && pc._step7UI) ? pc._step7UI : null;
}

/** 点击 STEP7 界面上的按钮：先用闪烁箭头指向该 DOM 元素，再点击 */
async function _s7Click(wf, sel, tip, wait = 600) {
    const ui = _s7(wf);
    const el = (ui && ui._root) ? ui._root.querySelector(sel) : null;
    if (el) {
        try { await wf._flashDomElement(el, tip, 1500); } catch (e) { /* ignore */ }
        el.click();
    } else {
        console.warn('[上位机流程] 未找到 STEP7 界面元素：', sel);
    }
    await _sleep(wait);
}

/** 上位机网线是否已接好（CPU 网口 ↔ 上位机网口） */
function _lanWired(sys) {
    if (!sys || !sys.conns) return false;
    return sys.conns.some(c =>
        (c.from === 'step7pc-1_wire_lan' && c.to === 'plc-1_wire_lan')
        || (c.from === 'plc-1_wire_lan' && c.to === 'step7pc-1_wire_lan'));
}

/** 确保上位机以太网线接通（编程链路的组态前提） */
function _ensureLan(sys) {
    if (!sys || !sys.connMgr || _lanWired(sys)) return;
    sys.connMgr.addConn({ from: 'step7pc-1_wire_lan', to: 'plc-1_wire_lan', type: 'wire' });
    if (sys.renderer && sys.renderer.updateLinePositions) sys.renderer.updateLinePositions();
    if (sys.pageMgr) sys.pageMgr.refresh();
    if (sys.redrawAll) sys.redrawAll();
}

// ═══════════════════════════════════════════════════════════════
// 工作流
// ═══════════════════════════════════════════════════════════════

/** 是否已按过消声：读 PLC 的 M1.0~M1.6 消声记忆位（演练模式下也能判定） */
function _muted(s) {
    const mb = (s && s.mbits) || [];
    for (let i = 0; i < 7; i++) if (mb[8 + i]) return true;
    return false;
}

/** 旋钮换到指定档位：先顺时针点，不到位再逆时针点（两种朝向都覆盖） */
async function _knobTo(ctx, partId, pred, tries = 4) {
    const c = _compOf(ctx, 'local');
    if (!c) return false;
    if (pred()) return true;
    await _clickUntil(c, partId, pred, tries);
    if (!pred()) await _clickUntil(c, partId, pred, tries, 320, -1);
    return pred();
}

/** 是否处于「负荷控制」阶段（小火运行 / 大火运行） */
function _loadStage(s) {
    return !!(s && (s.m.stage === '小火运行' || s.m.stage === '大火运行'));
}

/**
 * 自动起动锅炉直到进入「负荷控制」阶段（流程 3 反复使用）：
 * 合电源 → 选 1# 油泵 → 1# 给水泵手动补水到 60% → 转自动
 * → 燃烧准备 → 燃烧控制旋钮转「自动」→ 等自动时序跑完
 */
async function _autoStartToLoad(ctx) {
    const s = _bsOf(ctx), c = _compOf(ctx, 'local');
    if (!s || !c) return false;
    // 每次起动前先关闭蒸汽主截止阀：锅炉从零负荷起压，便于观察点火与停炉过程
    const bcv = _compOf(ctx, 'boiler');
    if (bcv && bcv._svOpen) {
        _firePart(bcv, 'steam-valve');
        await _sleep(600);
    }
    if (!s.m.power) _firePart(c, 'power');
    await _sleep(300);
    await _clickUntil(c, 'oil-knob', () => s.m.oilPumpKnob === 'p1', 4, 320, -1);
    await _clickUntil(c, 'pump1-knob', () => s.m.pump1Mode === 'manual', 4);
    await _waitFor(() => s.m.level >= 60, 120000);
    await _clickUntil(c, 'pump1-knob', () => s.m.pump1Mode === 'auto', 4, 320, -1);
    await _clickUntil(c, 'btn-prep', () => s.m.out.ready, 4, 500);
    await _clickUntil(c, 'burner-knob', () => s.m.burnerKnob === 'auto', 5, 320, -1);
    const ok = await _waitFor(() => _loadStage(s), 240000);
    if (!ok) return false;
    // 进入负荷控制后打开蒸汽主截止阀，锅炉开始对外供汽
    const bc = _compOf(ctx, 'boiler');
    if (bc && !bc._svOpen) {
        _firePart(bc, 'steam-valve');
        await _sleep(800);
    }
    return true;
}

export const PROJECT_WORKFLOWS = {

    // ─────────────────────────────────────────────────────────
    'boiler-auto': {
        id: 'boiler-auto',
        name: '1. 辅锅炉自动起动与运行',
        steps: [
            {
                msg: '1. 合上「总电源」开关（两档旋钮），控制回路得电。',
                op: [{
                    type: 'switch', target: 'local', part: 'power',
                    msg: '合上总电源开关',
                    async act() {
                        const s = _bsOf(this), c = _compOf(this, 'local');
                        if (s && !s.m.power) _firePart(c, 'power');
                    },
                }],
                check() { const s = _bsOf(this); return !!(s && s.m.power); },
            },
            {
                msg: '2. 把「油泵控制」旋钮从「停止」转到「1#泵」；再把「1# 给水泵」打到「手动」补水，待水位升到 60% 以上后转回「自动」。',
                op: [
                    {
                        type: 'switch', target: 'local', part: 'oil-knob',
                        msg: '把油泵控制旋钮转「1#泵」',
                        async act() {
                            const s = _bsOf(this), c = _compOf(this, 'local');
                            await _clickUntil(c, 'oil-knob', () => s && s.m.oilPumpKnob === 'p1', 4, 320, -1);
                        },
                    },
                    {
                        type: 'switch', target: 'local', part: 'pump1-knob',
                        msg: '把 1# 给水泵打到「手动」补水，水位升到 60% 以上后转回「自动」',
                        async act() {
                            const s = _bsOf(this), c = _compOf(this, 'local');
                            await _clickUntil(c, 'pump1-knob', () => s && s.m.pump1Mode === 'manual', 4);
                            await _waitFor(() => s && s.m.level >= 60, 120000);
                            this._lvlDone = true;
                            await _clickUntil(c, 'pump1-knob', () => s && s.m.pump1Mode === 'auto', 4, 320, -1);
                        },
                    },
                ],
                check() {
                    const s = _bsOf(this);
                    return !!(s && s.m.oilPumpKnob === 'p1' && s.m.pump1Mode === 'auto'
                        && (this._lvlDone || s.m.level >= 60));
                },
            },
            {
                msg: '3. 按下「燃烧准备」按钮（I0.7），PLC 程序段 5 使 Q2.1 起动就绪自锁。',
                op: [{
                    type: 'switch', target: 'local', part: 'btn-prep',
                    msg: '按下机旁操纵台的「燃烧准备」按钮',
                    async act() {
                        const s = _bsOf(this), c = _compOf(this, 'local');
                        await _clickUntil(c, 'btn-prep', () => s && s.m.out.ready, 4, 500);
                    },
                }],
                check() { const s = _bsOf(this); return !!(s && s.m.out.ready); },
            },
            {
                msg: '4. 把「燃烧控制」旋钮转到「自动」，系统进入自动时序。',
                op: [{
                    type: 'switch', target: 'local', part: 'burner-knob',
                    msg: '把燃烧控制旋钮顺时针转到「自动」位置',
                    async act() {
                        const s = _bsOf(this), c = _compOf(this, 'local');
                        await _clickUntil(c, 'burner-knob', () => s && s.m.burnerKnob === 'auto', 5, 320, -1);
                    },
                }],
                check() { const s = _bsOf(this); return !!(s && s.m.burnerKnob === 'auto'); },
            },
            {
                msg: '5. 自动预扫风 36 s（T101）：风机运行、风门全开，把炉膛内残油和可燃气排净。',
                op: [{
                    type: 'observe', target: 'boiler', part: 'furnace',
                    msg: '观察预扫风：风机运行、风门全开，预扫风 36 s',
                    async act() {
                        const s = _bsOf(this);
                        await _waitFor(() => s && s.m.out.fan, 20000);
                        await _waitFor(() => s && s._timer(101).bit, 90000);
                    },
                }],
                check() { const s = _bsOf(this); return !!(s && (s._timer(101).bit || ['点火', '小火稳定', '小火运行', '大火运行'].includes(_stage(s)))); },
            },
            {
                msg: '6. 自动点火 3 s（T102）：点火变压器打火、总电磁阀与 1# 电磁阀打开、风门关小，建立火焰。',
                op: [{
                    type: 'observe', target: 'boiler', part: 'igniter',
                    msg: '点火变压器通电打火，观察炉膛火焰建立',
                    async act() {
                        const s = _bsOf(this);
                        await _waitFor(() => s && s.m.out.flameLamp, 20000);
                        await _sleep(1200);
                    },
                }],
                check() { const s = _bsOf(this); return !!(s && s.m.out.flameLamp); },
            },
            {
                msg: '7. 小火稳定运行 20 s（T103）后自动转入大火：2# 电磁阀打开、双油头供油、风门全开、Q2.2 亮。',
                op: [{
                    type: 'observe', target: 'boiler', part: 'gas-2',
                    msg: '小火稳定 20 s 后 2# 电磁阀打开，转入大火全负荷',
                    async act() {
                        const s = _bsOf(this);
                        await _waitFor(() => s && s.m.out.highFire, 70000);
                    },
                }],
                check() { const s = _bsOf(this); return !!(s && s.m.out.highFire); },
            },
            {
                msg: '8. 蒸汽压力控制：压力升至大小火转换值（0.62 MPa）自动回到小火；升至自动起停上限（0.70 MPa）自动停炉并后扫风 20 s（T104）。',
                op: [{
                    type: 'observe', target: 'boiler', part: 'relay-auto',
                    msg: '观察蒸汽压力升高 → 大小火转换 → 达上限自动停炉与后扫风',
                    async act() {
                        const s = _bsOf(this);
                        await _waitFor(() => s && s.m.pressure >= s.cfg.pHighLow, 120000);
                        await _waitFor(() => s && !s.m.out.fan, 180000);
                        await _sleep(1500);
                    },
                }],
                check() { const s = _bsOf(this); return !!(s && s.m.pressure >= s.cfg.pHighLow); },
            },
            {
                mode: 'quiz',
                msg: '9. 自动时序知识题',
                quizConfig: {
                    question: '锅炉自动起动时，按下「燃烧准备」后风机先进行 36 s 预扫风，其目的是：',
                    options: [
                        '把炉膛内残留的可燃气体和油雾排净，防止点火时炉膛爆炸',
                        '给锅炉提前升压，缩短点火后的升压时间',
                        '检查给水泵能否向锅炉供水',
                        '预热重油，使油温达到雾化要求',
                    ],
                    answer: 0,
                    isMultiple: false,
                    analysis: '预扫风（T101，36 s）用风机把炉膛及烟道内残留的可燃气体、油雾排净，避免点火瞬间爆燃；同时借助风压继电器（20 s 检测，T108）确认风压建立，风压失压则不允许点火。',
                },
            },
        ],
    },

    // ─────────────────────────────────────────────────────────
    'boiler-manual': {
        id: 'boiler-manual',
        name: '2. 手动起动辅锅炉和停炉',
        steps: [
            {
                msg: '1. 合上总电源并选择 1# 油泵；把 1# 给水泵打到「手动」补水，水位升到 60% 以上后转回「自动」；再按下「燃烧准备」使 Q2.1 就绪。',
                op: [
                    {
                        type: 'switch', target: 'local', part: 'power',
                        msg: '合上总电源，油泵控制旋钮转到「1#泵」',
                        async act() {
                            const s = _bsOf(this), c = _compOf(this, 'local');
                            await _clickUntil(c, 'power', () => s && s.m.power, 3);
                            await _clickUntil(c, 'oil-knob', () => s && s.m.oilPumpKnob === 'p1', 4, 320, -1);
                        },
                    },
                    {
                        type: 'switch', target: 'local', part: 'pump1-knob',
                        msg: '把 1# 给水泵打到「手动」补水，水位升到 60% 以上后转回「自动」',
                        async act() {
                            const s = _bsOf(this), c = _compOf(this, 'local');
                            await _clickUntil(c, 'pump1-knob', () => s && s.m.pump1Mode === 'manual', 4);
                            await _waitFor(() => s && s.m.level >= 60, 120000);
                            this._lvlDone = true;
                            await _clickUntil(c, 'pump1-knob', () => s && s.m.pump1Mode === 'auto', 4, 320, -1);
                        },
                    },
                    {
                        type: 'switch', target: 'local', part: 'btn-prep',
                        msg: '按下「燃烧准备」按钮，使 Q2.1 起动就绪',
                        async act() {
                            const s = _bsOf(this), c = _compOf(this, 'local');
                            await _clickUntil(c, 'btn-prep', () => s && s.m.out.ready, 4, 500);
                        },
                    },
                ],
                check() {
                    const s = _bsOf(this);
                    return !!(s && s.m.power && s.m.oilPumpKnob === 'p1' && s.m.pump1Mode === 'auto'
                        && s.m.out.ready && (this._lvlDone || s.m.level >= 60));
                },
            },
            {
                msg: '2. 旋钮转到「扫风」：风机运行，手动预扫风（I1.2）。',
                op: [{
                    type: 'switch', target: 'local', part: 'burner-knob',
                    msg: '把旋钮转到「扫风」，风机运行进行预扫风',
                    async act() {
                        const s = _bsOf(this), c = _compOf(this, 'local');
                        await _clickUntil(c, 'burner-knob', () => s && s.m.burnerKnob === 'sweep', 4);
                        await _waitFor(() => s && s.m.out.fan, 8000);
                        await _sleep(2000);
                    },
                }],
                check() { const s = _bsOf(this); return !!(s && s.m.burnerKnob === 'sweep'); },
            },
            {
                msg: '3. 旋钮转到「点火」：点火变压器通电打火（T107 3 s 后自动断电），总电磁阀与 1# 电磁阀打开。',
                op: [{
                    type: 'switch', target: 'local', part: 'burner-knob',
                    msg: '把旋钮转到「点火」，观察点火变压器打火与火焰建立',
                    async act() {
                        const s = _bsOf(this), c = _compOf(this, 'local');
                        await _clickUntil(c, 'burner-knob', () => s && s.m.burnerKnob === 'ignite', 3);
                        await _waitFor(() => s && s.m.out.flameLamp, 15000);
                    },
                }],
                check() { const s = _bsOf(this); return !!(s && s.m.out.flameLamp); },
            },
            {
                msg: '4. 火焰建立后把旋钮转到「小火」：点火变压器断电，保持小火燃烧。',
                op: [{
                    type: 'switch', target: 'local', part: 'burner-knob',
                    msg: '把旋钮转到「小火」，点火变压器断电、维持小火燃烧',
                    async act() {
                        const s = _bsOf(this), c = _compOf(this, 'local');
                        await _clickUntil(c, 'burner-knob', () => s && s.m.burnerKnob === 'low', 3);
                        await _sleep(1500);
                    },
                }],
                check() { const s = _bsOf(this); return !!(s && s.m.burnerKnob === 'low' && s.m.out.flameLamp); },
            },
            {
                msg: '5. 需要高负荷时旋钮转到「大火」：2# 电磁阀打开，双油头供油、风门全开（I1.5、Q1.5、Q2.2）。',
                op: [{
                    type: 'switch', target: 'local', part: 'burner-knob',
                    msg: '把旋钮转到「大火」，双油头供油、风门全开',
                    async act() {
                        const s = _bsOf(this), c = _compOf(this, 'local');
                        await _clickUntil(c, 'burner-knob', () => s && s.m.burnerKnob === 'high', 3);
                        await _waitFor(() => s && s.m.out.highFire, 20000);
                    },
                }],
                check() { const s = _bsOf(this); return !!(s && s.m.out.highFire); },
            },
            {
                msg: '6. 停炉：按「燃烧停止」按钮（I1.0），Q2.1 断电、进油切断，风机后扫风 20 s（T104）后停炉。',
                op: [{
                    type: 'switch', target: 'local', part: 'btn-stop',
                    msg: '按下「燃烧停止」按钮，观察后扫风 20 s 后风机停止',
                    async act() {
                        const s = _bsOf(this), c = _compOf(this, 'local');
                        await _clickUntil(c, 'btn-stop', () => s && !s.m.out.ready, 3, 500);
                        await _waitFor(() => s && !s.m.out.fan, 90000);
                    },
                }],
                check() { const s = _bsOf(this); return !!(s && !s.m.out.ready); },
            },
            {
                mode: 'quiz',
                msg: '7. 停炉时序知识题',
                quizConfig: {
                    question: '按下「燃烧停止」后风机并不立即停止，而要继续后扫风 20 s，原因是：',
                    options: [
                        '把炉膛内未燃尽的燃油和可燃气抽走，避免再次点火时爆燃或结焦',
                        '给锅炉降压，防止蒸汽压力突然下降',
                        '让给水泵继续向锅炉补水',
                        '让点火变压器继续散热',
                    ],
                    answer: 0,
                    isMultiple: false,
                    analysis: '停炉瞬间炉膛内仍有未燃尽的油雾和可燃气，后扫风（T104，20 s）把它们排出烟囱，避免残油在炉膛结焦或下次点火时爆燃；扫风结束 T104 触点断开，风机停止。',
                },
            },
        ],
    },

    // ─────────────────────────────────────────────────────────
    'boiler-safety': {
        id: 'boiler-safety',
        name: '3. 锅炉安保功能测试',
        steps: [
            {
                msg: '1. 起动前先关闭蒸汽主截止阀，再自动起动锅炉：合电源 → 选 1# 油泵 → 1# 给水泵补水至 60% 后转自动 → 燃烧准备 → 旋钮「自动」，直到锅炉进入「负荷控制」阶段；随后打开蒸汽主截止阀，开始对外供汽。',
                op: [{
                    type: 'switch', target: 'local', part: 'burner-knob',
                    msg: '先关蒸汽阀 → 上电、选泵、补水、燃烧准备，旋钮转「自动」，进入负荷控制后再开蒸汽阀',
                    async act() { await _autoStartToLoad(this); },
                }],
                check() { const s = _bsOf(this), bc = _compOf(this, 'boiler'); return _loadStage(s) && !!(bc && bc._svOpen); },
            },
            {
                msg: '2. 断开紫外光电管（火焰监视器）的一根接线，模拟运行中火焰信号消失：PLC 判「故障熄火」→ 切断进油、后扫风、停炉并报警。',
                op: [{
                    type: 'switch', target: 'boiler', part: 'flame-wire-1',
                    msg: '点击紫外光电管接线把它断开，观察停炉与报警',
                    async act() {
                        const s = _bsOf(this), bc = _compOf(this, 'boiler');
                        if (!s.getFault('flameSensor')) _firePart(bc, 'flame-wire-1');
                        await _waitFor(() => s && (s.m.out.flameOutAlarm || s.m.stage === '停炉'), 120000);
                        this._s2Alarm = true;
                        await _sleep(1500);
                    },
                }],
                check() {
                    const s = _bsOf(this);
                    this._s3Muted = false;                       // 进入本步即复位下一步的"已消声"锁存
                    return !!(this._s2Alarm || (s && (s.m.out.flameOutAlarm || s.getFault('flameSensor'))));
                },
            },
            {
                msg: '3. 确认警报：先按下「消声」按钮确认报警；再把燃烧控制旋钮转回「停止」，把紫外光电管接线重新接好，最后按「燃烧停止」按钮对故障复位。',
                op: [
                    {
                        type: 'switch', target: 'local', part: 'btn-mute',
                        msg: '按下「消声」按钮确认警报：音响停止，指示灯由闪烁转为常亮',
                        async act() {
                            const s = _bsOf(this), c = _compOf(this, 'local');
                            _firePart(c, 'btn-mute');
                            this._s3Muted = true;
                            await _sleep(600);
                            await _waitFor(() => s && !s.m.out.horn, 4000);
                        },
                    },
                    {
                        type: 'switch', target: 'local', part: 'burner-knob',
                        msg: '燃烧控制旋钮转回「停止」',
                        async act() {
                            const s = _bsOf(this);
                            await _knobTo(this, 'burner-knob', () => s && s.m.burnerKnob === 'stop');
                        },
                    },
                    {
                        type: 'switch', target: 'boiler', part: 'flame-wire-1',
                        msg: '把紫外光电管的接线重新接好',
                        async act() {
                            const s = _bsOf(this), bc = _compOf(this, 'boiler');
                            if (s && s.getFault('flameSensor')) {
                                _firePart(bc, 'flame-wire-1');
                                await _sleep(800);
                            }
                        },
                    },
                    {
                        type: 'switch', target: 'local', part: 'btn-stop',
                        msg: '按下「燃烧停止」按钮，复位故障',
                        async act() {
                            const s = _bsOf(this), c = _compOf(this, 'local');
                            await _clickUntil(c, 'btn-stop', () => s && !s.m.out.ready, 3, 500);
                            await _sleep(800);
                        },
                    },
                ],
                check() {
                    const s = _bsOf(this);
                    if (!s) return false;
                    // 判定"已按消声"：消声记忆位 M1.x 置位，或"报警仍在但音响已停"（刚按过消声）
                    if (_muted(s) || (s.m.out.flameOutAlarm && !s.m.out.horn)) this._s3Muted = true;
                    return !!(this._s3Muted && !s.m.out.ready && !s.getFault('flameSensor'));
                },
            },
            {
                msg: '4. 先关闭蒸汽主截止阀，再次自动起动锅炉，直到进入「负荷控制」阶段；随后打开蒸汽主截止阀。',
                op: [{
                    type: 'switch', target: 'local', part: 'burner-knob',
                    msg: '先关蒸汽阀，重复自动起动步骤，进入负荷控制后再开蒸汽阀',
                    async act() { await _autoStartToLoad(this); },
                }],
                check() {
                    const s = _bsOf(this), bc = _compOf(this, 'boiler');
                    this._s5Alarm = false; this._s6Muted = false;            // 复位后续步骤的锁存
                    return _loadStage(s) && !!(bc && bc._svOpen);
                },
            },
            {
                msg: '5. 把 1# 给水泵打到「停止」，再打开排污口截止阀放水：水位以约 1 %/s 下降，一直降到危险低水位（≤20%）→ Q0.3 报警并停炉。',
                op: [
                    {
                        type: 'switch', target: 'local', part: 'pump1-knob',
                        msg: '1# 给水泵打到「停止」，不再补水',
                        async act() {
                            const s = _bsOf(this);
                            await _knobTo(this, 'pump1-knob', () => s && s.m.pump1Mode === 'stop');
                        },
                    },
                    {
                        type: 'switch', target: 'boiler', part: 'blowdown-valve',
                        msg: '打开排污口截止阀，观察水位下降直到危险低水位报警',
                        async act() {
                            const s = _bsOf(this), bc = _compOf(this, 'boiler');
                            if (!bc._bdOpen) _firePart(bc, 'blowdown-valve');
                            await _waitFor(() => s && s.m.out.levelLowAlarm, 240000);
                            this._s5Alarm = true;
                            await _sleep(1500);
                        },
                    },
                ],
                check() {
                    const s = _bsOf(this);
                    if (s && s.m.out.levelLowAlarm) this._s5Alarm = true;   // 轮询锁存
                    return !!(this._s5Alarm);
                },
            },
            {
                msg: '6. 确认警报：先按下「消声」按钮确认报警；再把燃烧控制旋钮转回「停止」，关闭排污口截止阀，1# 给水泵转「手动」补水到 60% 后转「自动」，最后按「燃烧停止」复位报警。',
                op: [
                    {
                        type: 'switch', target: 'local', part: 'btn-mute',
                        msg: '按下「消声」按钮确认警报：音响停止，指示灯由闪烁转为常亮',
                        async act() {
                            const s = _bsOf(this), c = _compOf(this, 'local');
                            _firePart(c, 'btn-mute');
                            this._s6Muted = true;
                            await _sleep(600);
                            await _waitFor(() => s && !s.m.out.horn, 4000);
                        },
                    },
                    {
                        type: 'switch', target: 'local', part: 'burner-knob',
                        msg: '燃烧控制旋钮转回「停止」',
                        async act() {
                            const s = _bsOf(this);
                            await _knobTo(this, 'burner-knob', () => s && s.m.burnerKnob === 'stop');
                        },
                    },
                    {
                        type: 'switch', target: 'boiler', part: 'blowdown-valve',
                        msg: '关闭排污口截止阀',
                        async act() {
                            const bc = _compOf(this, 'boiler');
                            if (bc && bc._bdOpen) {
                                _firePart(bc, 'blowdown-valve');
                                await _sleep(600);
                            }
                        },
                    },
                    {
                        type: 'switch', target: 'local', part: 'pump1-knob',
                        msg: '1# 给水泵转「手动」补水到 60% 以上，再转回「自动」',
                        async act() {
                            const s = _bsOf(this), c = _compOf(this, 'local');
                            await _clickUntil(c, 'pump1-knob', () => s && s.m.pump1Mode === 'manual', 4);
                            await _waitFor(() => s && s.m.level >= 60, 180000);
                            this._lvlDone6 = true;
                            await _clickUntil(c, 'pump1-knob', () => s && s.m.pump1Mode === 'auto', 4, 320, -1);
                        },
                    },
                    {
                        type: 'switch', target: 'local', part: 'btn-stop',
                        msg: '按下「燃烧停止」按钮，复位报警',
                        async act() {
                            const s = _bsOf(this), c = _compOf(this, 'local');
                            await _clickUntil(c, 'btn-stop', () => s && !s.m.out.ready, 3, 500);
                            await _sleep(800);
                        },
                    },
                ],
                check() {
                    const s = _bsOf(this);
                    if (!s) return false;
                    if (_muted(s) || (s.m.out.levelLowAlarm && !s.m.out.horn)) this._s6Muted = true;
                    return !!(this._s6Muted && s.m.burnerKnob === 'stop' && s.m.pump1Mode === 'auto'
                        && (this._lvlDone6 || s.m.level >= 55));
                },
            },
            {
                msg: '7. 先关闭蒸汽主截止阀，第三次自动起动锅炉，直到进入「负荷控制」阶段；随后打开蒸汽主截止阀，确认各项保护试验后锅炉能正常恢复运行。',
                op: [{
                    type: 'switch', target: 'local', part: 'burner-knob',
                    msg: '先关蒸汽阀，重复自动起动步骤，进入负荷控制后再开蒸汽阀',
                    async act() { await _autoStartToLoad(this); },
                }],
                check() { const s = _bsOf(this), bc = _compOf(this, 'boiler'); return _loadStage(s) && !!(bc && bc._svOpen); },
            },
        ],
    },

};

/** 保护试验辅助：清除故障后重新投入自动，等待新的点火时序 */
async function _clickEventuallyReprepare(s, comp) {
    if (!s || !comp) return;
    s.clearFaults();
    // 断开再重新投入，制造一次新的点火过程
    _firePart(comp, 'btn-stop');
    await _sleep(1200);
    _firePart(comp, 'btn-prep');
    await _sleep(1200);
}

// ═══════════════════════════════════════════════════════════════
// 工具栏快捷操作
// ═══════════════════════════════════════════════════════════════

export function initSlider(_sys) {
    // 自动演示时只保留箭头指示，不闪亮整个组件
    _sys._noBlinkHighlight = true;
    _sys.pageIndexTitle = '辅锅炉 PLC 控制仿真 · 页面索引';
}

export function applyAllPresets(ctx) {
    // 约定：电气 / 管路不做预接线（面板与 PLC 之间走虚拟 I/O 桥）。
    // 例外：上位机与 CPU 之间的以太网网线属于"编程链路"，组态时就应存在，
    // 否则双击上位机后「查找设备」找不到 CPU，无法演示连接/下载/上传/监控。
    const sys = (this && this.connMgr) ? this : (this && this.sys);
    if (!sys) return;
    _ensureLan(sys);
}

/**
 * 起动系统（工具栏）：完成合电源、选泵、燃烧准备、旋钮自动，
 * 全程保持 1× 实时速率，让预扫风 → 点火 → 小火 → 大火 各阶段清晰可见。
 */
export async function applyStartSystem() {
    // 注意：本函数由 WorkflowManager 以 .call(this) 调用，this 是 WorkflowManager，
    // 系统实例在 this.sys 上（也兼容直接以 sys 调用的情形）。
    const sys = (this && this.sys) ? this.sys : this;
    const s = sys && sys.boilerSolver;
    if (!s) return;
    const local = sys.comps.local;
    const diagram = sys.comps.boiler;

    _ensureLan(sys);
    s.clearFaults();
    if (!s.m.power) s.togglePower();
    s.setOilPump('p1');
    s.setWaterPump('p1auto');
    s.pressPrep();
    await _sleep(600);
    s.setBurnerKnob('auto');

    // 不加速：固定 1× 实时速率，逐步展示自动起动流程
    // （预扫风 36 s → 点火位置 3 s → 点火准备 5 s → 点火 3 s → 小火 20 s → 大火）
    s.cfg.timeScale = 1;
    if (diagram) diagram._timeScale = 1;
}

/**
 * 5 点步进：停炉 → 预扫风 → 点火 → 小火 → 大火
 * （教学演示用；内部把仿真时间倍率临时提高，便于快速观察各阶段）
 */
export function fiveStep() {
    const sys = (this && this.sys) ? this.sys : this;
    const s = sys && sys.boilerSolver;
    if (!s) return;
    const step = async () => {
        s.clearFaults();
        if (!s.m.power) s.togglePower();
        s.setOilPump('p1');
        s.pressPrep();
        await _sleep(500);
        const oldScale = s.cfg.timeScale;
        s.cfg.timeScale = 20;
        try {
            // ① 停炉
            s.setBurnerKnob('stop');
            s.pressStop();
            await _sleep(1500);
            // ② 预扫风
            s.setBurnerKnob('sweep');
            await _sleep(2500);
            // ③ 点火
            s.setBurnerKnob('ignite');
            await _waitFor(() => s.m.flameOn, 15000);
            // ④ 小火
            s.setBurnerKnob('low');
            await _sleep(2500);
            // ⑤ 大火
            s.setBurnerKnob('high');
            await _sleep(2500);
        } finally {
            s.cfg.timeScale = oldScale || 1;
        }
    };
    step();
}
