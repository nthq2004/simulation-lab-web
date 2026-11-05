// ═══════════════════════════════════════════════════════════════
// 空调系统的自动控制、安全保护及故障处理（syy22_conditioner）
//
// 单页布局（1920 × 1080）：
//   · 船舶中央空调系统（AirConditioningSystem）—— 左侧整幅工艺流程图：
//     新风/回风调节风门、自动控制站（过滤段 ΔP / 蒸发器 / 风机 / 开·关按钮）、
//     送风 → 船员舱室、加热盘管 + 加湿器（锅炉蒸汽），以及制冷剂回路：
//     压缩机、滑油分离器、冷凝器（低温冷却淡水）、干燥器&过滤器、回热器、
//     并联两路膨胀阀 A/B（适应不同负载）、充冷剂接口、观察镜、起动延时。
//   · 压缩机操作台（CompressorControlPanel）—— 右上（单压缩机）；
//   · 中央空调控制组件（ACControlPanel）—— 右中（控制模式 / 工况 / 运行方式 / 温度设定 / 室温）；
//   · 安全保护 / 报警（SafetyAlarmPanel）—— 右下（单压缩机 4 路报警）。
//
// 物理求解：AirConditioningSolver（单机 + 舱温/湿度双位控制 + 制热/加湿，R407C 近似）。
// ═══════════════════════════════════════════════════════════════

import { AirConditioningSystem } from '../components/AirConditioningSystem.js';
import { CompressorControlPanel } from '../components/CompressorControlPanel.js';
import { ACControlPanel } from '../components/ACControlPanel.js';
import { SafetyAlarmPanel } from '../components/SafetyAlarmPanel.js';

import { Multimeter } from '../components/Multimeter.js';
import { MF47Multimeter } from '../components/MF47Multimeter.js';
import { Oscilloscope_tri } from '../components/Osc_tri.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';
import { ElecMeter } from '../components/ElecMeter.js';
import { RealMegohmMeter } from '../components/RealMegohmMeter.js';

const _sysOf = (ctx) => (ctx && ctx.sys) ? ctx.sys : window.sys;
const _acs = (ctx) => { const s = _sysOf(ctx); return s && s.comps ? s.comps['acsys'] : null; };
/** 模拟点击某组件的可点击部件（触发组件自身 click 处理逻辑） */
function _clickPart(sys, compId, partId) {
    const c = sys && sys.comps ? sys.comps[compId] : null;
    const n = c && typeof c.getClickablePartNode === 'function' ? c.getClickablePartNode(partId) : null;
    if (n) n.fire('click');
}

/** 反复点击压缩机操作台的手动/自动旋钮，直到达到目标档位 */
function _clickModeUntil(sys, target) {
    const m = sys.acSolver && sys.acSolver.m;
    for (let i = 0; i < 3; i++) {
        if (m && m.comps && m.comps.comp1 && m.comps.comp1.mode === target) break;
        _clickPart(sys, 'cpanel', 'mode');
    }
}

// ═══════════════════════════════════════════════════════════════
// 页面定义
// ═══════════════════════════════════════════════════════════════

const PAGE1_COMPS = [
    'acsys', 'cpanel', 'acpanel', 'alarmpanel',
    'multimeter', 'mf47-panel', 'osc', 'sg', 'cali', 'elecmeter', 'megohm',
];

export const PROJECT_PAGES = [
    { id: 0, name: '索引', type: 'index' },
    {
        id: 1, name: '空调系统的自动控制、安全保护及故障处理',
        comps: PAGE1_COMPS,
        desc: '左侧：船舶中央空调工艺流程（新风/回风、自动控制站、船员舱室、加热/加湿、单压缩机/冷凝器、两路膨胀阀）。右侧：压缩机操作台、中央空调控制组件、安全保护/报警。',
    },
];

// ═══════════════════════════════════════════════════════════════
// 组件配置（1920 × 1080 基准坐标）
// ═══════════════════════════════════════════════════════════════

export const componentConfigs = [
    // 船舶中央空调系统（TEST-MARKER）
    { Class: AirConditioningSystem, id: 'acsys', x: -120, y: 10, page: 1, width: 1310, height: 850, visible: true },

    // 右侧三个面板
    { Class: CompressorControlPanel, id: 'cpanel', x: 1300, y: 10, page: 1, width: 455, height: 415, visible: true },
    { Class: ACControlPanel, id: 'acpanel', x: 1300, y: 430, page: 1, width: 455, height: 310, visible: true },
    { Class: SafetyAlarmPanel, id: 'alarmpanel', x: 1300, y: 744, page: 1, width: 455, height: 286, visible: true },

    // 仪表（默认隐藏，供「选择仪表」调出）
    { Class: Multimeter, id: 'multimeter', x: 1120, y: 200, visible: false },
    { Class: MF47Multimeter, id: 'mf47-panel', x: 1050, y: 150, visible: false },
    { Class: Oscilloscope_tri, id: 'osc', x: 50, y: 50, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 50, y: 50, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 50, y: 50, visible: false },
    { Class: ElecMeter, id: 'elecmeter', x: 50, y: 50, visible: false },
    { Class: RealMegohmMeter, id: 'megohm', x: 50, y: 50, visible: false },
];

// ═══════════════════════════════════════════════════════════════
// 工具栏快捷操作
// ═══════════════════════════════════════════════════════════════

export function initSlider(sys) {
    if (!sys) return;
    sys._noBlinkHighlight = true;
    sys.pageIndexTitle = '空调系统的自动控制、安全保护及故障处理 · 页面索引';
}

/** 一键自动接线：本工程工艺管路已内绘，无需外部接线 */
export function applyAllPresets(opts) {
    if (opts && opts.init) return;
    const sys = _sysOf(this);
    if (sys && sys.redrawAll) sys.redrawAll();
}

/** 启动系统：开通各路截止阀、控制器投入、自动控制站风机起动、新风/回风风门开启、
 *  中央空调控制组件置「制冷 · 自动」，压缩机投入自动控制。 */
export async function applyStartSystem() {
    const sys = _sysOf(this);
    if (!sys) return;

    const acs = sys.comps && sys.comps['acsys'];
    if (acs) {
        // 开通制冷剂与冷却水管路的截止阀（滑油阀保持原状）
        if (typeof acs.setHandValvesBulk === 'function') {
            acs.setHandValvesBulk(true, ['oil1-in', 'oil1-out','dry']);
        }
        if (typeof acs.setDamper === 'function') { acs.setDamper('fresh', true); acs.setDamper('return', true); }
        if (typeof acs.setRoomFan === 'function') acs.setRoomFan('cabin', true);
        if (typeof acs.setController === 'function') acs.setController(true);
    }

    // 中央空调控制组件：制冷 · 自动
    const panel = sys.comps && sys.comps['acpanel'];
    if (panel) { _clickPart(sys, 'acpanel', 'mode-cool'); _clickPart(sys, 'acpanel', 'load-auto'); }

    const solver = sys.acSolver;
    if (solver && solver.m) {
        solver.m.mode = 'cool';                // 起动系统后默认进入「制冷」模式
        solver.m.loadMode = 'auto';
        if (typeof solver.applyModeInit === 'function') solver.applyModeInit('cool');   // 制冷：35℃ / 70%
        solver.m.comps.comp1.mode = 'auto';     // 起动系统后压缩机自动转入「自动」
        solver.m.comps.comp1.manualRun = false;
        solver.m.trip = false;
        solver.m.resetPulse = true;
    }
    sys.redrawAll && sys.redrawAll();
    await new Promise(r => setTimeout(r, 300));
}

/** 5 点步进：演示外界温度（新风/热负荷）阶梯变化 */
export function fiveStep() {
    const sys = _sysOf(this);
    if (!sys || !sys.acSolver) return;
    const steps = [34, 38, 42, 30, 26];
    if (sys._fiveStepIdx === undefined || sys._fiveStepIdx >= steps.length) sys._fiveStepIdx = 0;
    sys.acSolver._params.ambient = steps[sys._fiveStepIdx];
    sys._fiveStepIdx = (sys._fiveStepIdx + 1) % steps.length;
    sys.redrawAll && sys.redrawAll();
}

// ═══════════════════════════════════════════════════════════════
// 故障 / 流程
// ═══════════════════════════════════════════════════════════════

/** 取求解器故障开关对象 */
function _faults() {
    const sys = window.sys;
    const s = sys && sys.acSolver;
    if (!s) return null;
    return s.faults || (s.faults = {});
}

export const FAULT_CONFIGS = {
    // 蒸发器严重结霜：霜层热阻使传热严重恶化 → 制冷量大幅下降，制冷时舱温下降特别慢
    evap_frost: {
        id: 'evap_frost', name: '蒸发器严重结霜', system: '空调系统',
        desc: '蒸发器表面结满厚霜，霜层热阻使传热恶化，制冷量大幅下降：制冷工况下舱温下降特别慢',
        check() { const f = _faults(); return !!(f && f.evapFrost); },
        trigger() { const f = _faults(); if (f) f.evapFrost = true; },
        repair() { const f = _faults(); if (f) f.evapFrost = false; },
    },
    // 蒸汽加热比例阀卡滞不动作：制热工况阀门始终不开 → 舱温不上升
    steam_valve: {
        id: 'steam_valve', name: '蒸汽加热阀不动作', system: '空调系统',
        desc: '蒸汽加热比例电磁阀卡滞，控制器输出再大阀门也不开：制热工况下舱温不上升',
        check() { const f = _faults(); return !!(f && f.steamValve); },
        trigger() { const f = _faults(); if (f) f.steamValve = true; },
        repair() { const f = _faults(); if (f) f.steamValve = false; },
    },
};

export const PROJECT_WORKFLOWS = {
    'ac-know': {
        id: 'ac-know', name: '1. 船舶中央空调系统的认识',
        steps: [
            { msg: '1. 识别压缩机', mode: 'find', target: 'acsys', subTarget: 'comp1' },
            { msg: '2. 识别滑油分离器', mode: 'find', target: 'acsys', subTarget: 'oilsep1' },
            { msg: '3. 识别冷凝器', mode: 'find', target: 'acsys', subTarget: 'cond1' },
            {
                msg: '4. 测试题：冷凝器的作用',
                mode: 'quiz',
                quizConfig: {
                    question: '冷凝器在中央空调制冷系统中的作用是什么？',
                    options: [
                        '节流降压，把高压液态制冷剂减压后送入蒸发器',
                        '把压缩机排出的高温高压制冷剂气体冷却、冷凝成高压液体，并把热量交给低温冷却淡水带走',
                        '储存制冷剂液体并分离其中的气液两相',
                        '过滤制冷剂中的水分和机械杂质',
                    ],
                    answer: 1,
                    analysis: '冷凝器是放热设备：压缩机排出的高温高压过热蒸气在冷凝器中被低温冷却淡水冷却，先降温后冷凝为高压过冷液体，冷凝热量由冷却水带走。节流降压是膨胀阀的作用，储存液体是储液器的作用，除水除杂是干燥过滤器的作用。',
                },
            },
            { msg: '5. 识别回热器', mode: 'find', target: 'acsys', subTarget: 'regen' },
            {
                msg: '6. 测试题：回热器的作用',
                mode: 'quiz',
                quizConfig: {
                    question: '回热器（气液热交换器）在制冷系统中的作用是什么？',
                    options: [
                        '把低压回气进一步降温后送回压缩机',
                        '把制冷剂气体压缩升压',
                        '让高压液态制冷剂与低压回气换热：液体进一步过冷，回气过热，防止压缩机吸入湿蒸气而液击',
                        '分离回气中夹带的润滑油',
                    ],
                    answer: 2,
                    analysis: '回热器使节流前的高压液与蒸发后的低温回气逆向换热：液态制冷剂过冷度增大、单位制冷量提高；回气过热度增大，可避免压缩机吸入湿蒸气造成液击。排气升压靠压缩机，油气分离靠油液分离器。',
                },
            },
            { msg: '7. 识别两路膨胀阀', mode: 'find', target: 'acsys', subTarget: 'exp-a', subTargets: ['exp-a', 'exp-b'] },
            {
                msg: '8. 测试题：两路膨胀阀的作用',
                mode: 'quiz',
                quizConfig: {
                    question: '本系统蒸发器为什么采用两路不同容量的膨胀阀（A / B 并联）？',
                    options: [
                        '为了互为备用，一台阀故障时另一台自动切换',
                        '为了适应不同负荷：轻载只投入小容量阀 A，重载再投入大容量阀 B，使节流供液量与蒸发器负荷相匹配，既避免供液过量又保证充分利用蒸发面积',
                        '两路阀分别控制制冷与制热',
                        '两路阀分别控制新风与回风的温度',
                    ],
                    answer: 1,
                    analysis: '膨胀阀容量固定时，轻载会供液过量（过热度低、易液击），重载又供液不足（过热度高、制冷量不够）。采用大小两只并联膨胀阀按负荷投切：轻载仅开小阀 A，重载再开大阀 B，使节流后的流量与蒸发器负荷相匹配，兼顾低负荷稳定性与高负荷制冷量。',
                },
            },
            { msg: '9. 识别蒸发器', mode: 'find', target: 'acsys', subTarget: 'evap' },
            {
                msg: '10. 测试题：蒸发器的作用',
                mode: 'quiz',
                quizConfig: {
                    question: '蒸发器在中央空调系统中的作用是什么？',
                    options: [
                        '把气态制冷剂冷凝为液体',
                        '把制冷剂气体压缩升压',
                        '对制冷剂进行干燥和过滤',
                        '让低压液态制冷剂在其中汽化吸热，冷却流过的空气，经送风使船员舱室降温',
                    ],
                    answer: 3,
                    analysis: '蒸发器是吸热设备：经膨胀阀节流后的低温低压液体在管内汽化，吸收管外空气的热量，使流经自动控制站的空气降温降湿；风机把冷风经送风管送入船员舱室实现空调降温。冷凝是冷凝器的作用，压缩是压缩机的作用。',
                },
            },
            { msg: '11. 识别自动控制站（点击风机与过滤段）', mode: 'find', target: 'acsys', subTarget: 'fan', subTargets: ['filter', 'fan'] },
            { msg: '12. 识别新风风门与回风风门', mode: 'find', target: 'acsys', subTarget: 'fresh-air', subTargets: ['fresh-air', 'return-air'] },
            { msg: '13. 识别船员舱室', mode: 'find', target: 'acsys', subTarget: 'cabin' },
            { msg: '14. 识别加热盘管与加湿器', mode: 'find', target: 'acsys', subTarget: 'heater', subTargets: ['heater', 'humidifier'] },
            {
                msg: '15. 测试题：加热与加湿控制',
                mode: 'quiz',
                quizConfig: {
                    question: '船舶中央空调在冬季或湿冷环境下如何保持舱室舒适？',
                    options: [
                        '只靠制冷，不需要加热和加湿',
                        '由蒸汽加热盘管（TC 温度控制）对送风加热升温，由加湿器补充送风湿度，与制冷回路共用送风机和风管',
                        '通过关闭新风风门来升温',
                        '通过提高压缩机转速来加热',
                    ],
                    answer: 1,
                    analysis: '中央空调是全年性空气处理：夏季由蒸发器降温除湿（制冷），冬季/湿冷时由锅炉蒸汽加热盘管对送风加热升温（TC 温度控制），并由加湿器补充湿度，二者与制冷回路共用自动控制站的风机与风管，实现舱室温湿度的自动调节。',
                },
            },
            { msg: '16. 识别中央空调控制器的工况选择旋钮', mode: 'find', target: 'acpanel', subTarget: 'mode-cool', subTargets: ['mode-cool', 'load-auto'] },
        ],
    },

    // ── 流程 2：船舶中央空调系统的起动（按操作规程逐步操作） ──
    'ac-start': {
        id: 'ac-start', name: '2. 船舶中央空调系统的起动',
        steps: [
            {
                msg: '1. 开启各路截止阀：冷却水进口、压缩机入口/出口、冷凝器出口、干燥器出口（液态主管阀）',
                mode: 'check',
                op: [
                    { type: 'switch', target: 'acsys', part: 'hv-cw1', msg: '开启冷却水（低温冷却淡水）进口截止阀', act() { _acs(this).setHandValve('cw1', true); } },
                    { type: 'switch', target: 'acsys', part: 'hv-suc1', msg: '开启压缩机入口截止阀', act() { _acs(this).setHandValve('suc1', true); } },
                    { type: 'switch', target: 'acsys', part: 'hv-dis1', msg: '开启压缩机出口截止阀', act() { _acs(this).setHandValve('dis1', true); } },
                    { type: 'switch', target: 'acsys', part: 'hv-cond1-out', msg: '开启冷凝器出口截止阀', act() { _acs(this).setHandValve('cond1-out', true); } },
                    { type: 'switch', target: 'acsys', part: 'hv-liq', msg: '开启液态主管截止阀（观察镜下方）', act() { _acs(this).setHandValve('liq', true); } },
                ],
                check() {
                    const a = this.sys.comps['acsys'];
                    return ['cw1', 'suc1', 'dis1', 'cond1-out', 'liq']
                        .every(id => a.isHandValveOpen(id));
                },
            },
            {
                msg: '2. 开启新风/回风风门，按「开」按钮起动自动控制站风机',
                mode: 'check',
                op: [
                    { type: 'switch', target: 'acsys', part: 'fresh-air', msg: '开启新风风门', act() { _acs(this).setDamper('fresh', true); } },
                    { type: 'switch', target: 'acsys', part: 'return-air', msg: '开启回风风门', act() { _acs(this).setDamper('return', true); } },
                    { type: 'find', target: 'acsys', part: 'fan-on', msg: '按自动控制站风机的「开」按钮，风机起动', act() { _acs(this).setRoomFan('cabin', true); } },
                ],
                check() {
                    const a = this.sys.comps['acsys'];
                    return a.isDamperOpen('fresh') && a.isDamperOpen('return') && a.getRoomFan();
                },
            },
            {
                msg: '3. 投入控制器，选择「制冷」工况与「自动负荷」；并把压缩机操作台转入「自动」',
                mode: 'check',
                op: [
                    { type: 'knob', target: 'acpanel', part: 'mode-cool', msg: '把工况旋钮转到「制冷」', act() { _clickPart(this.sys, 'acpanel', 'mode-cool');
                        const mm = this.sys.acSolver && this.sys.acSolver.m; if (mm && mm.cabin) mm.cabin.stopReached = false; } },
                    { type: 'knob', target: 'acpanel', part: 'load-auto', msg: '把负荷选择开关转到「自动负荷」', act() { _clickPart(this.sys, 'acpanel', 'load-auto'); } },
                    { type: 'knob', target: 'cpanel', part: 'mode', msg: '把压缩机操作台的手动/自动旋钮转到「自动」，压缩机由吸入压力继电器控制起停', act() { _clickModeUntil(this.sys, 'auto'); } },
                ],
                check() {
                    const s = this.sys, m = s.acSolver && s.acSolver.m;
                    return !!(s.comps['acsys'].isControllerOn() && m && m.mode === 'cool'
                        && m.loadMode === 'auto' && m.comps.comp1.mode === 'auto');
                },
            },
            {
                msg: '4. 观察舱室温度自动控制：舱温 ≥ 启动温度时投入制冷，降到停止温度以下时自动停止，如此往复',
                mode: 'check',
                op: [
                    { type: 'observe', target: 'acpanel', part: 'mode-cool', msg: '观察控制组件：工况「制冷」、负荷开关「自动负荷」' },
                    { type: 'observe', target: 'acsys', part: 'evap', msg: '观察蒸发器供液制冷，送风温度下降' },
                    { type: 'observe', target: 'acsys', part: 'cabin', msg: '观察船员舱室温度随送风逐渐下降，降到停止温度以下后停止制冷，舱温再缓升，如此往复' },
                ],
                waitMsg: '等待舱室温度下降到停止温度以下（压缩机自动停止制冷）…',
                waitFor() {
                    const m = this.sys.acSolver && this.sys.acSolver.m;
                    return !!(m && m.cabin && (m.cabin.stopReached || m.cabin.temp <= m.cabin.setStop));
                },
                check() {
                    const m = this.sys.acSolver && this.sys.acSolver.m;
                    return !!(m && m.cabin && (m.cabin.stopReached || m.cabin.temp <= m.cabin.setStop));
                },
            },
            {
                msg: '5. 测试题：舱室温度自动控制原理',
                mode: 'quiz',
                quizConfig: {
                    question: '船员舱室的温度自动控制是怎样实现的？',
                    options: [
                        '由操作人员定时手动开停压缩机，凭经验控制舱温',
                        '舱温高于「启动温度」时温度控制器使压缩机投入制冷、供液电磁阀打开；舱温降到「停止温度」以下时自动停止制冷，舱温回升后再重复，如此往复',
                        '通过连续改变风机转速来精确维持舱温',
                        '由冷却水温度高低控制舱温，与压缩机无关',
                    ],
                    answer: 1,
                    analysis: '本系统为常用的「温度控制器 + 压缩机/供液电磁阀」双位控制：按启动温度/停止温度构成滞环动作，控制器驱动供液电磁阀与压缩机起停，使舱温在设定区间内波动。风机转速一般不变，舱温也不是靠人工或冷却水温度控制。',
                },
            },
            {
                msg: '6. 测试题：两路膨胀阀按负荷自动切换',
                mode: 'quiz',
                quizConfig: {
                    question: '随着负荷升高，两路膨胀阀是如何自动切换的？',
                    options: [
                        '始终两路全开，不随负荷变化',
                        '轻载时只投入小容量阀 A；负荷升到约 50% 以上时再投入大容量阀 B，使总供液量与负荷匹配',
                        '负荷越高关得越多，负荷越低开得越多',
                        '两路阀交替开闭，周期性切换',
                    ],
                    answer: 1,
                    analysis: '两路膨胀阀并联、按负荷投切：轻载工况下小容量阀 A 即可满足供液（供液量小、过热度稳定）；当负荷升高（舱温偏离设定越大、负荷率越高）时再投入大容量阀 B，增大供液量以防蒸发器供液不足。演示中可观察负荷升高时 B 阀投入（绿色指示环亮起）。',
                },
            },
        ],
    },

    // ── 流程 3：船舶中央空调系统故障的判别（以蒸发器严重结霜为例） ──
    'ac-fault': {
        id: 'ac-fault', name: '3. 船舶中央空调系统故障的判别',
        steps: [
            {
                msg: '1. 点击工具栏「起动系统」，使系统进入正常运行状态',
                mode: 'check',
                op: [
                    {
                        type: 'page', page: 1,
                        msg: '先切换到第 1 页：船舶中央空调系统主画面',
                    },
                    {
                        type: 'wire', button: 'btnStartSys',
                        msg: '点击工具栏「起动系统」按钮：自动开启各路截止阀、风门与风机，控制器投入，压缩机自动转入「自动」并投入',
                        flashMs: 2600, holdMs: 1200,
                        async act() {
                            const btn = document.getElementById('btnStartSys');
                            if (btn) btn.click();                    // 模拟真实点击工具栏按钮
                            else await this.sys.applyStartSystem();
                            await new Promise(r => setTimeout(r, 500));
                        },
                    },
                ],
                check() {
                    const s = this.sys, m = s.acSolver && s.acSolver.m;
                    const onPage = s.pageMgr ? s.pageMgr.currentPage === 1 : true;
                    return !!(onPage && m && s.comps['acsys'].isControllerOn() && m.mode === 'cool');
                },
            },
            {
                msg: '2. 观察正常制冷流程：舱温高于启动温度 → 投入制冷，送风温度下降；降到停止温度以下 → 自动停止',
                mode: 'check',
                op: [
                    { type: 'observe', target: 'acsys', part: 'evap', msg: '观察蒸发器供液、蒸发压力正常' },
                    { type: 'observe', target: 'acsys', part: 'cabin', msg: '观察舱室温度随送风下降' },
                ],
                // 自动演示 / 单步演示：必须等到舱温真的降到停止温度以下才继续
                waitMsg: '等待舱室温度下降到停止温度以下（压缩机自动停止制冷）…',
                waitFor() {
                    const m = this.sys.acSolver && this.sys.acSolver.m;
                    return !!(m && m.cabin && (m.cabin.stopReached || m.cabin.temp <= m.cabin.setStop));
                },
                // 演练 / 评估模式同样必须满足该条件，不能一投入制冷就算通过
                check() {
                    const m = this.sys.acSolver && this.sys.acSolver.m;
                    return !!(m && m.cabin && (m.cabin.stopReached || m.cabin.temp <= m.cabin.setStop));
                },
            },
            {
                msg: '3. 通过「故障设置」界面触发「蒸发器严重结霜」故障（霜层热阻使传热恶化）',
                mode: 'check',
                op: [
                    {
                        type: 'fault', fault: 'evap_frost',
                        msg: '在「故障设置」界面勾选「蒸发器严重结霜」并应用',
                        async act() { await new Promise(r => setTimeout(r, 600)); },
                    },
                ],
                check() {
                    const s = this.sys.acSolver;
                    return !!(s && s.faults && s.faults.evapFrost);
                },
            },
            {
                msg: '4. 观察故障现象：等待温度上升，触发制冷动作，供液电磁阀与膨胀阀工作，但蒸发器表面结满厚霜，换热恶化，制冷量大幅下降',
                mode: 'check',
                op: [
                    { type: 'observe', target: 'acsys', part: 'evap', msg: '观察蒸发器：表面结霜、霜层很厚，供液正常但换热量很小' },
                    { type: 'observe', target: 'acpanel', part: 'mode-cool', msg: '观察控制组件：工况「制冷」、负荷「自动」，控制器无故障指示' },
                ],
                check() {
                    const s = this.sys.acSolver, m = s && s.m;
                    return !!(s && s.faults && s.faults.evapFrost && m && (m.expA || m.expB));
                },
            },
            {
                msg: '5. 观察后果：舱温下降特别慢（远低于正常制冷速度），长时间仍降不到停止温度',
                mode: 'check',
                op: [
                    { type: 'observe', target: 'acsys', part: 'cabin', msg: '观察船员舱室温度：长时间只缓慢下降，制冷效果很差' },
                ],
                waitMsg: '观察舱温变化：结霜后制冷量只剩约 1/6，降温速度明显变慢…',
                waitFor() {
                    const m = this.sys.acSolver && this.sys.acSolver.m;
                    return !!(m && m.cabin && m.cabin.frostSlow);
                },
                check() {
                    const m = this.sys.acSolver && this.sys.acSolver.m;
                    return !!(m && m.cabin && m.cabin.frostSlow);
                },
            },
            {
                msg: '6. 通过「故障设置」界面修复「蒸发器严重结霜」故障：除霜后换热恢复，制冷量回升，舱温加快下降',
                mode: 'check',
                op: [
                    {
                        type: 'fault', fault: 'evap_frost', repair: true,
                        msg: '在「故障设置」界面取消勾选「蒸发器严重结霜」并应用，完成除霜、故障排除',
                        async act() { await new Promise(r => setTimeout(r, 600)); },
                    },
                    { type: 'observe', target: 'acsys', part: 'evap', msg: '观察蒸发器：霜层清除，换热恢复正常，制冷效果好转' },
                ],
                check() {
                    const s = this.sys.acSolver, m = s && s.m;
                    return !!(s && s.faults && !s.faults.evapFrost && m && m.cabin && m.cabin.frostSlow === false);
                },
            },
        ],
    },

    // ── 流程 4：船舶中央空调系统安保功能测试（冷却水中断 → 排压过高保护 → 复位重起） ──
    'ac-protect': {
        id: 'ac-protect', name: '4. 船舶中央空调系统安保功能测试',
        steps: [
            {
                msg: '1. 点击工具栏「起动系统」，开启船舶中央空调系统',
                mode: 'check',
                op: [
                    {
                        type: 'page', page: 1,
                        msg: '先切换到第 1 页：船舶中央空调系统主画面',
                    },
                    {
                        type: 'wire', button: 'btnStartSys',
                        msg: '点击工具栏「起动系统」按钮，系统投入正常运行',
                        flashMs: 2600, holdMs: 1200,
                        async act() {
                            const btn = document.getElementById('btnStartSys');
                            if (btn) btn.click();                    // 模拟真实点击工具栏按钮
                            else await this.sys.applyStartSystem();
                            await new Promise(r => setTimeout(r, 500));
                        },
                    },
                ],
                check() {
                    const s = this.sys, m = s.acSolver && s.acSolver.m;
                    const onPage = s.pageMgr ? s.pageMgr.currentPage === 1 : true;
                    return !!(onPage && m && s.comps['acsys'].isControllerOn() && m.mode === 'cool');
                },
            },
            {
                msg: '2. 关闭冷凝器冷却水（低温冷却淡水）进口截止阀，模拟冷却水中断',
                mode: 'check',
                op: [
                    {
                        type: 'switch', target: 'acsys', part: 'hv-cw1',
                        msg: '点击冷却水进口截止阀，将其关闭',
                        act() { _acs(this).setHandValve('cw1', false); },
                    },
                ],
                check() { return !this.sys.comps['acsys'].isHandValveOpen('cw1'); },
            },
            {
                msg: '3. 观察「淡水压力过低」报警；观察压缩机排出压力不断升高，超过停止压力后「排出压力过高」保护动作、压缩机保护停机',
                mode: 'check',
                op: [
                    { type: 'observe', target: 'alarmpanel', part: 'alarm-wplow-1', msg: '① 安保面板「淡水压力过低」报警灯点亮（只报警，不直接停机）' },
                    { type: 'observe', target: 'cpanel', part: 'gauge-pc', msg: '② 观察操作台「出口压力」表：冷却水中断后排出压力持续升高（向保护值逼近）' },
                    { type: 'observe', target: 'alarmpanel', part: 'alarm-hp-1', msg: '③ 排出压力超过停止压力并延时后，「排出压力过高」保护动作，压缩机被迫停机' },
                ],
                waitMsg: '等待压缩机排出压力过高保护动作（观察排压升高直至保护停机）…',
                waitFor() {
                    const m = this.sys.acSolver && this.sys.acSolver.m;
                    return !!(m && m.alarms.comp1.wplow && m.comps.comp1.hpTripped);
                },
                check() {
                    const m = this.sys.acSolver && this.sys.acSolver.m;
                    return !!(m && m.alarms.comp1.wplow && m.comps.comp1.hpTripped && !m.comps.comp1.running);
                },
            },
            {
                msg: '4. 将压缩机转为「手动」（压缩机操作台旋钮）；重新开启冷却水进口截止阀；按安保面板「复位」清除保护锁存',
                mode: 'check',
                op: [
                    {
                        type: 'knob', target: 'cpanel', part: 'mode',
                        msg: '① 把压缩机操作台的手动/自动旋钮转到「手动」（保护停机后须手动复位再起动）',
                        act() { _clickModeUntil(this.sys, 'manual'); },
                    },
                    {
                        type: 'switch', target: 'acsys', part: 'hv-cw1',
                        msg: '② 重新开启冷却水进口截止阀，恢复冷却水',
                        act() { _acs(this).setHandValve('cw1', true); },
                    },
                    {
                        type: 'find', target: 'alarmpanel', part: 'reset',
                        msg: '③ 按安保面板右下角「复位」按钮，清除排出压力过高保护的锁存',
                        act() { this.sys.acSolver.m.resetPulse = true; },
                    },
                ],
                check() {
                    const s = this.sys, m = s.acSolver && s.acSolver.m;
                    return !!(m && m.comps.comp1.mode === 'manual' && s.comps['acsys'].isHandValveOpen('cw1') && !m.comps.comp1.hpTripped);
                },
            },
            {
                msg: '5. 手动起动压缩机，确认运转正常后把压缩机操作台转入「自动」',
                mode: 'check',
                op: [
                    {
                        type: 'find', target: 'cpanel', part: 'start',
                        msg: '① 按压缩机操作台「启动」按钮（手动方式），确认压缩机正常运转、排出压力恢复正常',
                        act() {
                            const s = this.sys, m = s.acSolver && s.acSolver.m;
                            if (m) { m.comps.comp1.mode = 'manual'; m.comps.comp1.manualRun = true; }
                            if (!this._projFlag) this._projFlag = {};
                            this._projFlag.s5Started = true;
                        },
                    },
                    {
                        type: 'knob', target: 'cpanel', part: 'mode',
                        msg: '② 把压缩机操作台的手动/自动旋钮转到「自动」，恢复自动控制',
                        act() { _clickModeUntil(this.sys, 'auto'); },
                    },
                ],
                waitMsg: '等待压缩机手动起动后进入正常运转…',
                waitFor() {
                    const m = this.sys.acSolver && this.sys.acSolver.m;
                    return !!(m && m.comps.comp1.running);
                },
                check() {
                    const m = this.sys.acSolver && this.sys.acSolver.m;
                    if (!m || m.comps.comp1.mode !== 'auto') return false;
                    return !!(m.comps.comp1.running || (this._projFlag && this._projFlag.s5Started));
                },
            },
        ],
    },
};
