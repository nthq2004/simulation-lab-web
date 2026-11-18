// ═══════════════════════════════════════════════════════════════
// 制冷系统的自动控制、安全保护及故障处理（syy21_refrige）
//
// 单页布局（1920 × 1080）：
//   · 制冷系统（RefrigerationSystem）—— 左侧整幅工艺流程图：5 个冷库
//     （干货库/粮库/菜库/鱼库/肉库）、回热器、两台压缩机、两台油液分离器、
//     两台冷凝器、干燥&过滤、接收器，及各管路与 P/T/G 标注；
//   · 压缩机控制（CompressorControlPanel）—— 右上；
//   · 温度设置（TempSettingPanel）—— 右中；
//   · 安保报警（SafetyAlarmPanel）—— 右下。
//
// 物理求解：RefrigerationSolver（2 机 5 库，R407C 近似）。
// 报警本期只做显示与复位（不注入可设置故障）。
// ═══════════════════════════════════════════════════════════════

import { RefrigerationSystem } from '../components/RefrigerationSystem.js';
import { CompressorControlPanel } from '../components/CompressorControlPanel.js';
import { TempSettingPanel } from '../components/TempSettingPanel.js';
import { SafetyAlarmPanel } from '../components/SafetyAlarmPanel.js';

import { Multimeter } from '../components/Multimeter.js';
import { MF47Multimeter } from '../components/MF47Multimeter.js';
import { Oscilloscope_tri } from '../components/Osc_tri.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';
import { ElecMeter } from '../components/ElecMeter.js';
import { RealMegohmMeter } from '../components/RealMegohmMeter.js';

const _sysOf = (ctx) => (ctx && ctx.sys) ? ctx.sys : window.sys;

// ═══════════════════════════════════════════════════════════════
// 页面定义
// ═══════════════════════════════════════════════════════════════

const PAGE1_COMPS = [
    'refsys', 'cpanel', 'temppanel', 'alarmpanel',
    'multimeter', 'mf47-panel', 'osc', 'sg', 'cali', 'elecmeter', 'megohm',
];

export const PROJECT_PAGES = [
    { id: 0, name: '索引', type: 'index' },
    {
        id: 1, name: '制冷系统的自动控制、安全保护及故障处理',
        comps: PAGE1_COMPS,
        desc: '左侧：制冷系统工艺流程（5 个冷库蒸发器、回热器、两台压缩机/油液分离器/冷凝器、干燥&过滤、接收器）。右侧：压缩机操作台、冷库温度设定、安全保护/报警。',
    },
];

// ═══════════════════════════════════════════════════════════════
// 组件配置（1920 × 1080 基准坐标）
// ═══════════════════════════════════════════════════════════════

export const componentConfigs = [
    // 制冷系统（左侧整幅工艺流程图，1250 × 850）
    { Class: RefrigerationSystem, id: 'refsys', x: -150, y: 10, page: 1, width: 1250, height: 850, visible: true },

    // 右侧三个面板
    { Class: CompressorControlPanel, id: 'cpanel', x: 1320, y: 10, page: 1, width: 455, height: 415, activeComp: 'comp1', visible: true },
    { Class: TempSettingPanel, id: 'temppanel', x: 1320, y: 375, page: 1, width: 455, height: 285, visible: true },
    { Class: SafetyAlarmPanel, id: 'alarmpanel', x: 1320, y: 700, page: 1, width: 455, height: 300, visible: true },

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
    sys.pageIndexTitle = '制冷系统的自动控制、安全保护及故障处理 · 页面索引';
}

/** 一键自动接线：本工程工艺管路已内绘，无需外部接线 */
export function applyAllPresets(opts) {
    if (opts && opts.init) return;
    const sys = _sysOf(this);
    if (sys && sys.redrawAll) sys.redrawAll();
}

/** 启动系统：操作台置自动、两机投入自动控制；默认开启制冷剂管路与冷却水管路的手动截止阀，
 *  不改动冷库旁通阀、压缩机滑油注入/出口截止阀，制冷剂注入截止阀保持关闭） */
export async function applyStartSystem() {
    const sys = _sysOf(this);
    if (!sys) return;
    // 自动起动系统：仅一号机投入自动，二号机保持手动（不自动投入）
    const panel = sys.comps && sys.comps['cpanel'];
    if (panel) {
        if (panel.settings) {
            panel.settings.comp1.mode = 'auto';
            panel.settings.comp2.mode = 'manual';
        }
        panel.activeComp = 'comp1';
        panel._syncVisuals && panel._syncVisuals();
    }
    const refsys = sys.comps && sys.comps['refsys'];
    if (refsys && typeof refsys.setHandValvesBulk === 'function') {
        // 仅开启制冷剂管路、冷却水管路的截止阀；旁通阀、滑油阀保持原状，制冷剂注入阀保持关闭
        refsys.setHandValvesBulk(true, [
            'chg', 'byp-dry', 'byp-grain', 'byp-veg', 'byp-fish', 'byp-meat',
            'oil1-in', 'oil1-out', 'oil2-in', 'oil2-out',
        ]);
    }
    // 控制器投入工作状态（否则电磁阀无输出、制冷不生效）
    if (refsys && typeof refsys.setController === 'function') refsys.setController(true);
    const s = sys.refrigSolver;
    if (s && s.m) {
        s.m.mode = 'manual';
        s.m.comps.comp1.mode = 'auto';      // 一号机自动
        s.m.comps.comp2.mode = 'manual';    // 二号机保持手动（不自动投入）
        s.m.comps.comp1.manualRun = false;
        s.m.comps.comp2.manualRun = false;
        s.m.trip = false;
        s.m.resetPulse = true;
    }
    sys.redrawAll && sys.redrawAll();
    await new Promise(r => setTimeout(r, 300));
}

/** 5 点步进：演示环境温度（热负荷）阶梯变化 */
export function fiveStep() {
    const sys = _sysOf(this);
    if (!sys || !sys.refrigSolver) return;
    const steps = [28, 32, 36, 40, 32];
    if (sys._fiveStepIdx === undefined || sys._fiveStepIdx >= steps.length) sys._fiveStepIdx = 0;
    sys.refrigSolver._params.ambient = steps[sys._fiveStepIdx];
    sys._fiveStepIdx = (sys._fiveStepIdx + 1) % steps.length;
    sys.redrawAll && sys.redrawAll();
}

// ═══════════════════════════════════════════════════════════════
// 故障 / 流程（本期留空：报警只做显示与复位）
// ═══════════════════════════════════════════════════════════════

/** 取求解器故障开关对象 */
function _faults() {
    const sys = window.sys;
    const s = sys && sys.refrigSolver;
    if (!s) return null;
    return s.faults || (s.faults = {});
}

export const FAULT_CONFIGS = {
    // 菜库膨胀阀故障：阀口堵塞/卡死 → 制冷剂流量极小 → 该库不能制冷、温度缓慢上升
    veg_expvalve: {
        id: 'veg_expvalve', name: '菜库膨胀阀故障', system: '制冷系统',
        check() { const f = _faults(); return !!(f && f.vegExpValve); },
        trigger() { const f = _faults(); if (f) f.vegExpValve = true; },
        repair() { const f = _faults(); if (f) f.vegExpValve = false; },
    },
    // 蒸发器化霜电路故障（鱼库）：蒸发器结霜、换热恶化 → 制冷效果变差、降温极慢
    fish_defrost: {
        id: 'fish_defrost', name: '鱼库蒸发器化霜电路故障', system: '制冷系统',
        check() { const f = _faults(); return !!(f && f.defrost); },
        trigger() { const f = _faults(); if (f) f.defrost = true; },
        repair() { const f = _faults(); if (f) f.defrost = false; },
    },
};

export const PROJECT_WORKFLOWS = {
    'refrig-know': {
        id: 'refrig-know', name: '1. 船舶冷库制冷系统的认识',
        steps: [
            { msg: '1. 识别 1# 压缩机（点击画面中的一号压缩机）', mode: 'find', target: 'refsys', subTarget: 'comp1' },
            { msg: '2. 识别 1# 油液分离器（点击一号油液分离器筒体）', mode: 'find', target: 'refsys', subTarget: 'oilsep1' },
            { msg: '3. 识别 1# 冷凝器（点击一号冷凝器）', mode: 'find', target: 'refsys', subTarget: 'cond1' },
            {
                msg: '4. 测试题：冷凝器的作用',
                mode: 'quiz',
                quizConfig: {
                    question: '冷凝器在制冷系统中的作用是什么？',
                    options: [
                        '节流降压，把高压液态制冷剂减压后送入蒸发器',
                        '把压缩机排出的高温高压制冷剂气体冷却、冷凝成高压液体，并把热量交给冷却水带走',
                        '储存制冷剂液体并分离其中的气液两相',
                        '过滤制冷剂中的水分和机械杂质',
                    ],
                    answer: 1,
                    analysis: '冷凝器是放热设备：压缩机排出的高温高压过热蒸气在冷凝器中被冷却水（本系统为低温冷却淡水）冷却，先降温后冷凝为高压过冷液体，冷凝热量由冷却水带走。节流降压是膨胀阀的作用，储存液体是接收器的作用，除水除杂是干燥过滤器的作用。',
                },
            },
            { msg: '5. 识别接收器（储液器）', mode: 'find', target: 'refsys', subTarget: 'receiver' },
            { msg: '6. 识别回热器', mode: 'find', target: 'refsys', subTarget: 'regen' },
            {
                msg: '7. 测试题：回热器的作用',
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
            { msg: '8. 识别膨胀阀（干货库）', mode: 'find', target: 'refsys', subTarget: 'exp-dry' },
            {
                msg: '9. 测试题：膨胀阀的作用',
                mode: 'quiz',
                quizConfig: {
                    question: '热力膨胀阀在制冷系统中的作用是什么？',
                    options: [
                        '对高压液态制冷剂节流降压，并按回气过热度自动调节进入蒸发器的供液量',
                        '提高制冷剂压力，便于冷凝放热',
                        '储存制冷剂液体，稳定系统供液',
                        '使制冷剂与冷却水换热',
                    ],
                    answer: 0,
                    analysis: '膨胀阀是节流机构：高压液体经阀口节流后压力、温度大幅下降，成为低温低压汽液两相流进入蒸发器；同时根据感温包测得的回气过热度自动开大/关小阀口，使供液量与蒸发器负荷相匹配，既保证蒸发器充分利用又防止压缩机液击。',
                },
            },
            { msg: '10. 识别蒸发器（干货库）', mode: 'find', target: 'refsys', subTarget: 'evap-dry' },
            {
                msg: '11. 测试题：蒸发器的作用',
                mode: 'quiz',
                quizConfig: {
                    question: '蒸发器在制冷系统中的作用是什么？',
                    options: [
                        '把气态制冷剂冷凝为液体',
                        '把制冷剂气体压缩升压',
                        '对制冷剂进行干燥和过滤',
                        '让低压液态制冷剂在其中汽化吸热，带走库内空气的热量，实现制冷降温',
                    ],
                    answer: 3,
                    analysis: '蒸发器是吸热设备：经膨胀阀节流后的低温低压液体在管内汽化，吸收管外冷库空气的热量，使库温下降；风机强制空气流过蒸发器表面以强化换热。冷凝是冷凝器的作用，压缩是压缩机的作用。',
                },
            },
            { msg: '12. 识别气液分离器', mode: 'find', target: 'refsys', subTarget: 'oilsep_acc' },
            { msg: '13. 识别温度继电器（干货库）', mode: 'find', target: 'refsys', subTarget: 'tsw-dry' },
            { msg: '14. 识别电磁阀（干货库）', mode: 'find', target: 'refsys', subTarget: 'sol-dry' },
            { msg: '15. 识别高低压继电器（点击压缩机操作台的进口压力表）', mode: 'find', target: 'cpanel', subTarget: 'gauge-pe', subTargets: ['gauge-pe', 'gauge-pc'] },
            { msg: '16. 识别油压差继电器（点击压缩机操作台的滑油差压表）', mode: 'find', target: 'cpanel', subTarget: 'gauge-oilP' },
        ],
    },

    // ── 流程 2：船舶冷库制冷系统的起动（按操作规程逐步操作） ──
    'refrig-start': {
        id: 'refrig-start', name: '2. 船舶冷库制冷系统的起动',
        steps: [
            {
                msg: '1. 观察润滑油油位、储液罐液位；开启各冷库蒸发器风机；开启两台冷凝器冷却水入口截止阀',
                mode: 'check',
                op: [
                    { type: 'observe', target: 'refsys', part: 'comp1', msg: '观察 1# 压缩机滑油液位（视镜内油位），应在 30%~70% 之间' },
                    { type: 'observe', target: 'refsys', part: 'receiver', msg: '观察接收器（储液罐）液位，应在 30%~50% 之间' },
                    { type: 'find', target: 'refsys', part: 'fan-on-dry', msg: '按「干货库」蒸发器风机的起动按钮', act() { this.sys.comps['refsys'].setRoomFan('dry', true); } },
                    { type: 'find', target: 'refsys', part: 'fan-on-grain', msg: '按「粮库」蒸发器风机的起动按钮', act() { this.sys.comps['refsys'].setRoomFan('grain', true); } },
                    { type: 'find', target: 'refsys', part: 'fan-on-veg', msg: '按「菜库」蒸发器风机的起动按钮', act() { this.sys.comps['refsys'].setRoomFan('veg', true); } },
                    { type: 'find', target: 'refsys', part: 'fan-on-fish', msg: '按「鱼库」蒸发器风机的起动按钮', act() { this.sys.comps['refsys'].setRoomFan('fish', true); } },
                    { type: 'find', target: 'refsys', part: 'fan-on-meat', msg: '按「肉库」蒸发器风机的起动按钮', act() { this.sys.comps['refsys'].setRoomFan('meat', true); } },
                    { type: 'switch', target: 'refsys', part: 'hv-cw1', msg: '开启 1# 冷凝器冷却水进口截止阀', act() { this.sys.comps['refsys'].setHandValve('cw1', true); } },
                    { type: 'switch', target: 'refsys', part: 'hv-cw2', msg: '开启 2# 冷凝器冷却水进口截止阀', act() { this.sys.comps['refsys'].setHandValve('cw2', true); } },
                ],
                check() {
                    const rs = this.sys.comps['refsys'];
                    const fans = ['dry', 'grain', 'veg', 'fish', 'meat'].every(k => rs.getRoomFan(k));
                    return fans && rs.isHandValveOpen('cw1') && rs.isHandValveOpen('cw2');
                },
            },
            {
                msg: '2. 开启压缩机入口、出口截止阀；开启冷凝器出口截止阀、储液罐出口截止阀、干燥过滤器出口截止阀',
                mode: 'check',
                op: [
                    { type: 'switch', target: 'refsys', part: 'hv-suc1', msg: '开启 1# 压缩机入口截止阀', act() { this.sys.comps['refsys'].setHandValve('suc1', true); } },
                    { type: 'switch', target: 'refsys', part: 'hv-dis1', msg: '开启 1# 压缩机出口截止阀', act() { this.sys.comps['refsys'].setHandValve('dis1', true); } },
                    { type: 'switch', target: 'refsys', part: 'hv-suc2', msg: '开启 2# 压缩机入口截止阀', act() { this.sys.comps['refsys'].setHandValve('suc2', true); } },
                    { type: 'switch', target: 'refsys', part: 'hv-dis2', msg: '开启 2# 压缩机出口截止阀', act() { this.sys.comps['refsys'].setHandValve('dis2', true); } },
                    { type: 'switch', target: 'refsys', part: 'hv-cond1-out', msg: '开启 1# 冷凝器出口截止阀', act() { this.sys.comps['refsys'].setHandValve('cond1-out', true); } },
                    { type: 'switch', target: 'refsys', part: 'hv-cond2-out', msg: '开启 2# 冷凝器出口截止阀', act() { this.sys.comps['refsys'].setHandValve('cond2-out', true); } },
                    { type: 'switch', target: 'refsys', part: 'hv-rec-out', msg: '开启接收器（储液罐）出口截止阀', act() { this.sys.comps['refsys'].setHandValve('rec-out', true); } },
                    { type: 'switch', target: 'refsys', part: 'hv-liq-main', msg: '开启干燥过滤器出口截止阀', act() { this.sys.comps['refsys'].setHandValve('liq-main', true); } },
                ],
                check() {
                    const rs = this.sys.comps['refsys'];
                    return ['suc1', 'dis1', 'suc2', 'dis2', 'cond1-out', 'cond2-out', 'rec-out', 'liq-main']
                        .every(id => rs.isHandValveOpen(id));
                },
            },
            {
                msg: '3. 开启各冷库出口截止阀',
                mode: 'check',
                op: [
                    { type: 'switch', target: 'refsys', part: 'hv-out-dry', msg: '开启干货库出口截止阀', act() { this.sys.comps['refsys'].setHandValve('out-dry', true); } },
                    { type: 'switch', target: 'refsys', part: 'hv-out-grain', msg: '开启粮库出口截止阀', act() { this.sys.comps['refsys'].setHandValve('out-grain', true); } },
                    { type: 'switch', target: 'refsys', part: 'hv-out-veg', msg: '开启菜库出口截止阀', act() { this.sys.comps['refsys'].setHandValve('out-veg', true); } },
                    { type: 'switch', target: 'refsys', part: 'hv-out-fish', msg: '开启鱼库出口截止阀', act() { this.sys.comps['refsys'].setHandValve('out-fish', true); } },
                    { type: 'switch', target: 'refsys', part: 'hv-out-meat', msg: '开启肉库出口截止阀', act() { this.sys.comps['refsys'].setHandValve('out-meat', true); } },
                ],
                check() {
                    const rs = this.sys.comps['refsys'];
                    return ['dry', 'grain', 'veg', 'fish', 'meat'].every(k => rs.isHandValveOpen('out-' + k));
                },
            },
            {
                msg: '4. 观察各库温度继电器设定值与状态；开启控制器，观察各库电磁阀的工作状态',
                mode: 'check',
                op: [
                    { type: 'observe', target: 'refsys', part: 'tsw-dry', msg: '观察干货库温度继电器（设定值见「温度设置」面板），库温高于启动值时开关接通' },
                    { type: 'observe', target: 'refsys', part: 'tsw-meat', msg: '观察肉库温度继电器状态' },
                    { type: 'switch', target: 'refsys', part: 'controller', msg: '开启控制器（点击控制器框），控制器才有电磁阀输出', act() { this.sys.comps['refsys'].setController(true); } },
                    { type: 'observe', target: 'refsys', part: 'sol-dry', msg: '观察干货库供液电磁阀：控制器已投入，温度开关接通时电磁阀导通（线圈红框、阀体亮绿）' },
                ],
                check() {
                    return !!this.sys.comps['refsys'].isControllerOn();
                },
            },
            {
                msg: '5. 观察压缩机入口压力，手动开启 1# 压缩机',
                mode: 'check',
                op: [
                    { type: 'observe', target: 'cpanel', part: 'gauge-pe', msg: '观察压缩机操作台的进口压力表（入口压力应高于启动压力值）', act() {
                        const s = this.sys, m = s.refrigSolver && s.refrigSolver.m;
                        if (m) m.comps.comp1.mode = 'manual';
                        const p = s.comps['cpanel'];
                        if (p && p.settings) { p.settings.comp1.mode = 'manual'; if (p._syncVisuals) p._syncVisuals(); }
                    } },
                    { type: 'find', target: 'cpanel', part: 'start', msg: '按下 1# 压缩机的「起动」按钮（手动方式）', act() {
                        const s = this.sys, m = s.refrigSolver && s.refrigSolver.m;
                        if (m) { m.comps.comp1.mode = 'manual'; m.comps.comp1.manualRun = true; }
                        const p = s.comps['cpanel'];
                        if (p && p.settings) { p.settings.comp1.mode = 'manual'; if (p._syncVisuals) p._syncVisuals(); }
                    } },
                ],
                check() {
                    const m = this.sys.refrigSolver && this.sys.refrigSolver.m;
                    return !!(m && m.comps.comp1.running);
                },
            },
            {
                msg: '6. 将压缩机工作模式转为「自动」',
                mode: 'check',
                op: [
                    { type: 'switch', target: 'cpanel', part: 'mode', msg: '把 1# 压缩机的手动/自动旋钮转到「自动」（自动起动后由入口压力继电器控制起停）', act() {
                        const s = this.sys, m = s.refrigSolver && s.refrigSolver.m;
                        if (m) m.comps.comp1.mode = 'auto';
                        const p = s.comps['cpanel'];
                        if (p && p.settings) { p.settings.comp1.mode = 'auto'; if (p._syncVisuals) p._syncVisuals(); }
                    } },
                ],
                check() {
                    const m = this.sys.refrigSolver && this.sys.refrigSolver.m;
                    return !!(m && m.comps.comp1.mode === 'auto');
                },
            },
            {
                msg: '7. 测试题：各个冷库温度自动控制原理',
                mode: 'quiz',
                quizConfig: {
                    question: '各冷库的温度自动控制是怎样实现的？',
                    options: [
                        '由操作人员定时到库内手动开闭供液电磁阀，凭经验控制库温',
                        '由冷却水温度高低控制库温，与电磁阀无关',
                        '库温高于「启动温度」时温度继电器（温度开关）接通，控制器使该库供液电磁阀通电打开、蒸发器供液制冷；库温降到「停止温度」以下时温度开关断开、电磁阀断电关闭停止供液，库温回升后再重复，如此往复',
                        '通过连续改变压缩机转速来精确维持库温',
                    ],
                    answer: 2,
                    analysis: '本系统为冷库常用的「温度继电器 + 供液电磁阀」双位控制：温度开关按启动值/停止值构成的滞环动作（库温 > 启动值接通、< 停止值断开，中间保持），信号送到控制器；控制器再驱动该库的供液电磁阀通断，从而控制蒸发器的供液与停供，使库温在设定区间内波动。压缩机转速不变，库温也不是靠人工或冷却水温度控制。',
                },
            },
            {
                msg: '8. 测试题：压缩机自动起停工作原理',
                mode: 'quiz',
                quizConfig: {
                    question: '压缩机在「自动」方式下是如何自动起停的？',
                    options: [
                        '由定时器按固定时间间隔起停',
                        '由压缩机的吸入口压力控制：入口压力高于「启动压力」并延时后自动启动；入口压力低于「启动压力 − 压差」并延时后自动停机，中间滞环区保持原状态',
                        '由库温直接控制压缩机接触器，与压力无关',
                        '由冷却水进口阀的开闭直接控制起停',
                    ],
                    answer: 1,
                    analysis: '自动方式是压力继电器双位控制：入口压力升到启动压力以上（说明各库蒸发器有制冷剂蒸发、需要抽气）延时约 5s 自动启动；入口压力降到（启动压力 − 压差）以下（蒸发量减小、冷量充足）延时约 6s 自动停机，两者之间为滞环死区、保持原状态。此外还有排出压力过高、滑油压力过低/液位过低、淡水压力过低等保护信号可强制停机。',
                },
            },
        ],
    },
    // ── 流程 3：船舶冷库制冷系统故障的判别（以菜库膨胀阀故障为例） ──
    'refrig-fault': {
        id: 'refrig-fault', name: '3. 船舶冷库制冷系统故障的判别',
        steps: [
            {
                msg: '1. 点击工具栏「起动系统」，使系统进入正常运行状态',
                mode: 'check',
                op: [
                    {
                        // 工具栏按钮用 type:'wire' + button 指定（引擎会闪烁箭头指向该 DOM 按钮）
                        type: 'wire', button: 'btnStartSys',
                        msg: '点击工具栏「起动系统」按钮：自动开启各路截止阀、控制器投入、1# 压缩机自动投入',
                        flashMs: 2600, holdMs: 1200,
                        async act() { await this.sys.applyStartSystem(); await new Promise(r => setTimeout(r, 500)); },
                    },
                ],
                check() {
                    const s = this.sys, m = s.refrigSolver && s.refrigSolver.m, rs = s.comps['refsys'];
                    return !!(m && m.running && rs && rs.isControllerOn());
                },
            },
            {
                msg: '2. 观察菜库正常制冷流程：库温升到 −5℃ 以上 → 温度开关接通、供液电磁阀开启制冷；降到 −7℃ 以下 → 电磁阀自动关闭停止供液，库温开始回升',
                mode: 'check',
                op: [
                    { type: 'observe', target: 'refsys', part: 'tsw-veg', msg: '观察菜库温度继电器：库温 > −5℃ 时开关接通（点亮）' },
                    { type: 'observe', target: 'refsys', part: 'sol-veg', msg: '观察菜库供液电磁阀：温度开关接通后电磁阀通电（线圈红框、阀体亮绿），蒸发器供液制冷' },
                    { type: 'observe', target: 'refsys', part: 'evap-veg', msg: '库温降到 −7℃ 以下后电磁阀自动关闭、停止供液，库温再缓慢回升，如此往复' },
                ],
                waitMsg: '等待菜库温度下降到 −7℃ 以下（电磁阀自动关闭）…',
                waitFor() {
                    const m = this.sys.refrigSolver && this.sys.refrigSolver.m;
                    const r = m && m.rooms && m.rooms.veg;
                    return !!(r && r.temp <= r.setStop);
                },
                check() {
                    const m = this.sys.refrigSolver && this.sys.refrigSolver.m;
                    const r = m && m.rooms && m.rooms.veg;
                    // 已降温到停止值 −7℃ 以下、且电磁阀随之关闭 → 说明完成了一个正常制冷周期
                    return !!(r && r.temp <= r.setStop && !r.solOpen);
                },
            },
            {
                msg: '3. 通过「故障设置」界面触发菜库膨胀阀故障（阀口堵塞，制冷剂流量极少）',
                mode: 'check',
                op: [
                    {
                        type: 'fault', fault: 'veg_expvalve',
                        msg: '在「故障设置」界面勾选「菜库膨胀阀故障」并应用',
                        async act() { await new Promise(r => setTimeout(r, 600)); },
                    },
                ],
                check() {
                    const s = this.sys.refrigSolver;
                    return !!(s && s.faults && s.faults.vegExpValve);
                },
            },
            {
                msg: '4. 等待菜库库温回升到 −5℃ 以上：可观察到供液电磁阀已通电（触点闭合），但因膨胀阀故障制冷剂流量极少，库温继续上升、始终不制冷',
                mode: 'check',
                op: [
                    { type: 'observe', target: 'refsys', part: 'sol-veg', msg: '电磁阀已通电导通（阀体亮绿），但库温不降反升 → 判断为膨胀阀供液故障' },
                    { type: 'observe', target: 'refsys', part: 'evap-veg', msg: '蒸发器无有效制冷剂流量，换热面温度不低，库温持续上升' },
                ],
                waitMsg: '等待菜库温度回升到 −5℃ 以上、供液电磁阀通电…',
                waitFor() {
                    const m = this.sys.refrigSolver && this.sys.refrigSolver.m;
                    const r = m && m.rooms && m.rooms.veg;
                    // 库温已高于启动值 −5℃ 且电磁阀已通电（触点闭合）
                    return !!(r && r.temp > r.setStart && r.solOpen);
                },
                check() {
                    const m = this.sys.refrigSolver && this.sys.refrigSolver.m;
                    const r = m && m.rooms && m.rooms.veg;
                    return !!(r && r.temp > r.setStart && r.solOpen && !r.cooling);
                },
            },
            {
                msg: '5. 通过「故障设置」界面修复菜库膨胀阀故障：制冷恢复，库温开始下降',
                mode: 'check',
                op: [
                    {
                        type: 'fault', fault: 'veg_expvalve', repair: true,
                        msg: '在「故障设置」界面取消勾选「菜库膨胀阀故障」并应用，故障排除',
                        async act() { await new Promise(r => setTimeout(r, 600)); },
                    },
                ],
                waitMsg: '等待菜库温度回升到 −5℃ 以上（膨胀阀故障现象观察完整）…',
                waitFor() {
                    const m = this.sys.refrigSolver && this.sys.refrigSolver.m;
                    const r = m && m.rooms && m.rooms.veg;
                    return !!(r && r.temp > r.setStart);
                },
                check() {
                    const s = this.sys, s2 = s.refrigSolver, m = s2 && s2.m;
                    const r = m && m.rooms && m.rooms.veg;
                    return !!(s2 && s2.faults && !s2.faults.vegExpValve && r && r.cooling);
                },
            },
        ],
    },
    // ── 流程 4：船舶冷库制冷系统安保功能测试（冷却水中断 → 排压过高保护 → 复位重起） ──
    'refrig-protect': {
        id: 'refrig-protect', name: '4. 船舶冷库制冷系统安保功能测试',
        steps: [
            {
                msg: '1. 点击工具栏「起动系统」，开启船舶冷库制冷系统',
                mode: 'check',
                op: [
                    {
                        type: 'wire', button: 'btnStartSys',
                        msg: '点击工具栏「起动系统」按钮，系统投入正常运行',
                        flashMs: 2600, holdMs: 1200,
                        async act() { await this.sys.applyStartSystem(); await new Promise(r => setTimeout(r, 500)); },
                    },
                ],
                check() {
                    const s = this.sys, m = s.refrigSolver && s.refrigSolver.m, rs = s.comps['refsys'];
                    return !!(m && m.running && rs && rs.isControllerOn());
                },
            },
            {
                msg: '2. 关闭 1# 冷凝器冷却水进口截止阀（模拟 1# 冷却水中断）',
                mode: 'check',
                op: [
                    {
                        type: 'switch', target: 'refsys', part: 'hv-cw1',
                        msg: '点击 1# 冷却水进口截止阀，将其关闭',
                        act() { this.sys.comps['refsys'].setHandValve('cw1', false); },
                    },
                ],
                check() { return !this.sys.comps['refsys'].isHandValveOpen('cw1'); },
            },
            {
                msg: '3. 观察「淡水压力过低」报警；观察 1# 压缩机排出压力不断升高，超过停止压力后「排出压力过高」保护动作，压缩机保护停机',
                mode: 'check',
                op: [
                    { type: 'observe', target: 'alarmpanel', part: 'alarm-wplow-1', msg: '① 安保面板「一号压缩机异常 · 淡水压力过低」报警灯点亮（只报警，不直接停机）' },
                    { type: 'observe', target: 'cpanel', part: 'gauge-pc', msg: '② 观察操作台「出口压力」表：冷却水中断后排出压力持续升高（向保护值逼近）' },
                    { type: 'observe', target: 'alarmpanel', part: 'alarm-hp-1', msg: '③ 排出压力超过停止压力并延时后，「排出压力过高」保护动作，1# 压缩机被迫停机' },
                ],
                waitMsg: '等待 1# 压缩机排出压力过高保护动作（观察排压力升高直至保护停机）…',
                waitFor() {
                    const m = this.sys.refrigSolver && this.sys.refrigSolver.m;
                    return !!(m && m.alarms.comp1.wplow && m.comps.comp1.hpTripped);
                },
                check() {
                    const m = this.sys.refrigSolver && this.sys.refrigSolver.m;
                    return !!(m && m.alarms.comp1.wplow && m.comps.comp1.hpTripped && !m.comps.comp1.running);
                },
            },
            {
                msg: '4. 将 1# 压缩机模式转为「手动」；重新合上 1# 冷却水进口截止阀；按「复位」清除保护锁存',
                mode: 'check',
                op: [
                    {
                        type: 'switch', target: 'cpanel', part: 'mode',
                        msg: '① 把 1# 压缩机的手动/自动旋钮转到「手动」（保护停机后须手动复位再起动）',
                        act() {
                            const s = this.sys, m = s.refrigSolver && s.refrigSolver.m;
                            if (m) { m.comps.comp1.mode = 'manual'; m.comps.comp1.manualRun = false; }
                            const p = s.comps['cpanel'];
                            if (p && p.settings) { p.settings.comp1.mode = 'manual'; if (p._syncVisuals) p._syncVisuals(); }
                        },
                    },
                    {
                        type: 'switch', target: 'refsys', part: 'hv-cw1',
                        msg: '② 重新合上 1# 冷却水进口截止阀，恢复冷却水',
                        act() { this.sys.comps['refsys'].setHandValve('cw1', true); },
                    },
                    {
                        type: 'find', target: 'alarmpanel', part: 'reset',
                        msg: '③ 按安保面板右下角「复位」按钮，清除排出压力过高保护的锁存',
                        act() { this.sys.refrigSolver.m.resetPulse = true; },
                    },
                ],
                check() {
                    const s = this.sys, m = s.refrigSolver && s.refrigSolver.m;
                    return !!(m && m.comps.comp1.mode === 'manual'
                        && s.comps['refsys'].isHandValveOpen('cw1')
                        && !m.comps.comp1.hpTripped);
                },
            },
            {
                msg: '5. 手动起动 1# 压缩机，确认运转正常后把模式转为「自动」',
                mode: 'check',
                op: [
                    {
                        type: 'find', target: 'cpanel', part: 'start',
                        msg: '① 按 1# 压缩机「起动」按钮（手动方式），确认压缩机正常运转、排出压力恢复正常',
                        act() {
                            const s = this.sys, m = s.refrigSolver && s.refrigSolver.m;
                            if (m) { m.comps.comp1.mode = 'manual'; m.comps.comp1.manualRun = true; }
                            const p = s.comps['cpanel'];
                            if (p && p.settings) { p.settings.comp1.mode = 'manual'; if (p._syncVisuals) p._syncVisuals(); }
                            if (!this._projFlag) this._projFlag = {};
                            this._projFlag.s5Started = true;   // 记录本轮已手动起动过（切自动后可能随压力逻辑停机）
                        },
                    },
                    {
                        type: 'switch', target: 'cpanel', part: 'mode',
                        msg: '② 把 1# 压缩机旋钮转到「自动」，恢复自动控制',
                        act() {
                            const s = this.sys, m = s.refrigSolver && s.refrigSolver.m;
                            if (m) m.comps.comp1.mode = 'auto';
                            const p = s.comps['cpanel'];
                            if (p && p.settings) { p.settings.comp1.mode = 'auto'; if (p._syncVisuals) p._syncVisuals(); }
                        },
                    },
                ],
                waitMsg: '等待 1# 压缩机手动起动后进入正常运转…',
                waitFor() {
                    const m = this.sys.refrigSolver && this.sys.refrigSolver.m;
                    return !!(m && m.comps.comp1.running);
                },
                check() {
                    const m = this.sys.refrigSolver && this.sys.refrigSolver.m;
                    if (!m || m.comps.comp1.mode !== 'auto') return false;
                    return !!(m.comps.comp1.running || (this._projFlag && this._projFlag.s5Started));
                },
            },
        ],
    },
};
