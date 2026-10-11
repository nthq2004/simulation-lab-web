// T568B 网线制作仿真工程
// 工艺链：剥外皮 → 解绞排线 → 剪齐 → 插入水晶头 → 压接 → 测线仪检测
//
// 核心组件：T568BCableBench（自包含「制作工位」复合组件）
//   bench.jacket     外皮／护套          bench.pairs   4 对双绞线
//   bench.core-<c>   8 根线芯（调色板）   bench.slot-N  1~8 号排列槽位
//   bench.rj45       水晶头              bench.pin-N   8 个金脚
//   bench.tool-stripper / tool-cutter / tool-crimper / reset
//   bench.tester     测线仪              bench.led-N   8 个指示灯
//
// 线序（第 1~8 脚）：T568B = 白橙 橙 白绿 蓝 白蓝 绿 白棕 棕

import { T568BCableBench } from '../components/T568BCableBench.js';
import { CableTypesBench } from '../components/CableTypesBench.js';
import { Multimeter } from '../components/Multimeter.js';
import { MF47Multimeter } from '../components/MF47Multimeter.js';
import { Oscilloscope_tri } from '../components/Osc_tri.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';
import { ElecMeter } from '../components/ElecMeter.js';
import { RealMegohmMeter } from '../components/RealMegohmMeter.js';

const _bench = () => (typeof window !== 'undefined' && window.sys) ? window.sys.comps['bench'] : null;
const _sleep = (ms) => new Promise(r => setTimeout(r, ms));

const CORE_NAME = { wo: '白橙', o: '橙', wg: '白绿', g: '绿', b: '蓝', wb: '白蓝', wbr: '白棕', br: '棕' };
const ORDER_T568B = ['wo', 'o', 'wg', 'b', 'wb', 'g', 'wbr', 'br'];

// ─── 故障配置（经工具栏「故障设置」界面注入 / 修复）───
export const FAULT_CONFIGS = {
    't568b-order': {
        id: 't568b-order', name: '网线线序错误（4、6 脚互换）', system: '网线',
        check() { const b = _bench(); return !!b && b.getFault() === 'order'; },
        trigger() { const b = _bench(); if (b) b.setFault('order'); },
        repair() { const b = _bench(); if (b && b.getFault() === 'order') b.setFault(null); },
    },
    't568b-open': {
        id: 't568b-open', name: '网线断路（第 3 脚芯线未压接）', system: '网线',
        check() { const b = _bench(); return !!b && b.getFault() === 'open'; },
        trigger() { const b = _bench(); if (b) b.setFault('open'); },
        repair() { const b = _bench(); if (b && b.getFault() === 'open') b.setFault(null); },
    },
    't568b-short': {
        id: 't568b-short', name: '网线短路（5、6 脚芯线搭接）', system: '网线',
        check() { const b = _bench(); return !!b && b.getFault() === 'short'; },
        trigger() { const b = _bench(); if (b) b.setFault('short'); },
        repair() { const b = _bench(); if (b && b.getFault() === 'short') b.setFault(null); },
    },
};

export const PROJECT_WORKFLOWS = {};

export const componentConfigs = [
    // ═════════════════════════════════════════════════════════════════════
    // 一、T568B 网线制作工位
    // ═════════════════════════════════════════════════════════════════════
    { Class: T568BCableBench, id: 'bench', x: 40, y: 6, standard: 'T568B', stripLength: 20, visible: true },

    // ═════════════════════════════════════════════════════════════════════
    // 二、三种常用线缆对比台（网线 / 光纤 / 同轴电缆，3D 立体效果）
    // ═════════════════════════════════════════════════════════════════════
    { Class: CableTypesBench, id: 'cables', x: 40, y: 40, visible: false },

    // ═════════════════════════════════════════════════════════════════════
    // 三、仪表（默认隐藏，经工具栏「选择仪表」调出）
    // ═════════════════════════════════════════════════════════════════════
    { Class: Multimeter, id: 'multimeter', x: 40, y: 740, visible: false },
    { Class: MF47Multimeter, id: 'mf47-panel', x: 40, y: 800, visible: false },
    { Class: Oscilloscope_tri, id: 'osc', x: 40, y: 860, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 40, y: 920, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 100, y: 740, visible: false },
    { Class: ElecMeter, id: 'elecmeter', x: 100, y: 800, visible: false },
    { Class: RealMegohmMeter, id: 'megohm', x: 100, y: 860, visible: false },
];

// ═════════════════════════════════════════════════════════════════════════
// 流程 1：认识网线与 T568B 线序
// ═════════════════════════════════════════════════════════════════════════
PROJECT_WORKFLOWS['t568b-intro'] = {
    id: 't568b-intro',
    name: '1. 认识网线与 T568B 线序',
    steps: [
        { mode: 'find', target: 'bench', subTarget: 'jacket', msg: '1. 网线外皮（护套）：保护内部线对，制作时需先剥去约 20mm，请点击它' },
        { mode: 'find', target: 'bench', subTarget: 'pairs', msg: '2. 4 对双绞线：橙、绿、蓝、棕四对，每对由一根纯色和一根白色彩条线绞合而成，请点击它' },
        { mode: 'find', target: 'bench', subTarget: 'rj45', msg: '3. RJ45 水晶头（8P8C）：网线的连接器，请点击它' },
        { mode: 'find', target: 'bench', subTarget: 'tool-stripper', msg: '4. 剥线钳：用于剥去网线外皮，请点击它' },
        { mode: 'find', target: 'bench', subTarget: 'tool-cutter', msg: '5. 剪线钳：用于把按序排好的线芯剪齐，请点击它' },
        { mode: 'find', target: 'bench', subTarget: 'tool-crimper', msg: '6. 网线钳：用于压接水晶头，请点击它' },
        { mode: 'find', target: 'bench', subTarget: 'tester', msg: '7. 测线仪：制作完成后用于检测线序与通断，请点击它' },
    ],
};

// ═════════════════════════════════════════════════════════════════════════
// 流程 2：制作 T568B 直通线
// ═════════════════════════════════════════════════════════════════════════
const MAKE_STEPS = [];

MAKE_STEPS.push({
    mode: 'check',
    msg: '1. 点击「剥线钳」，剥去约 20mm 外皮，露出 4 对共 8 根线芯。',
    op: [{
        type: 'btn', target: 'bench', part: 'tool-stripper',
        msg: '点击「剥线钳」剥去外皮',
        act() { const b = _bench(); if (b) b.stripJacket(); },
    }],
    check() { const b = _bench(); return !!b && b.getStage() !== 'idle'; },
});

ORDER_T568B.forEach((c, i) => {
    const pin = i + 1;
    MAKE_STEPS.push({
        mode: 'check',
        msg: `${pin + 1}. 按 T568B 线序选择「${CORE_NAME[c]}」线芯，放入第 ${pin} 号槽位。`,
        op: [
            {
                type: 'switch', target: 'bench', part: 'core-' + c,
                msg: `选择${CORE_NAME[c]}线芯`,
                act() { const b = _bench(); if (b) b.selectCore(c); },
            },
            {
                type: 'switch', target: 'bench', part: 'slot-' + pin,
                msg: `放入第 ${pin} 号槽位（${CORE_NAME[c]}）`,
                act() { const b = _bench(); if (b) b.placeCore(pin); },
            },
        ],
        check() { const b = _bench(); return !!b && b.getSlots()[pin - 1] === c; },
    });
});

MAKE_STEPS.push({
    mode: 'check',
    msg: '10. 点击「剪线钳」，把排好序的线芯剪齐（保留约 12mm）。',
    op: [{
        type: 'btn', target: 'bench', part: 'tool-cutter',
        msg: '点击「剪线钳」剪齐线芯',
        act() { const b = _bench(); if (b) b.trimCores(); },
    }],
    check() {
        const s = _bench() && _bench().getStage();
        return s === 'trimmed' || s === 'inserted' || s === 'crimped' || s === 'tested';
    },
});

MAKE_STEPS.push({
    mode: 'check',
    msg: '11. 把线芯插入水晶头，确认外皮压在卡扣内。',
    op: [{
        type: 'observe', target: 'bench', part: 'rj45',
        msg: '点击「水晶头」插入线芯',
        act() { const b = _bench(); if (b) b.insertIntoRj45(); },
    }],
    check() {
        const s = _bench() && _bench().getStage();
        return s === 'inserted' || s === 'crimped' || s === 'tested';
    },
});

MAKE_STEPS.push({
    mode: 'check',
    msg: '12. 用「网线钳」压接水晶头，使金脚刺入线芯导通。',
    op: [{
        type: 'btn', target: 'bench', part: 'tool-crimper',
        msg: '点击「网线钳」压接水晶头',
        act() { const b = _bench(); if (b) b.crimp(); },
    }],
    check() {
        const s = _bench() && _bench().getStage();
        return s === 'crimped' || s === 'tested';
    },
});

MAKE_STEPS.push({
    mode: 'check',
    msg: '13. 点击「测线仪」检测：8 个指示灯应 1→8 依次点亮，表示线序与通断合格。',
    op: [{
        type: 'observe', target: 'bench', part: 'tester',
        msg: '点击「测线仪」检测线序与通断',
        async act() { const b = _bench(); if (b) b.runTest(); await _sleep(2600); },
    }],
    check() { const b = _bench(); return !!b && b.isPass(); },
});

PROJECT_WORKFLOWS['t568b-make'] = {
    id: 't568b-make',
    name: '2. 制作 T568B 直通线',
    steps: MAKE_STEPS,
};

// ═════════════════════════════════════════════════════════════════════════
// 流程 3：测线判读与故障排查
// ═════════════════════════════════════════════════════════════════════════

/** 通过参数配置界面修改线序标准（走配置界面：弹框 → 改值 → 点保存） */
async function _demoSetStandard(wf, value, tip) {
    const comp = _bench();
    if (!comp || typeof comp.showConfigDialog !== 'function') return;
    // ① 同步实时属性 → config 副本
    (comp.getConfigFields ? comp.getConfigFields() : []).forEach(f => {
        if (f.get) return;
        try { const live = comp[f.key]; if (live !== undefined) comp.config[f.key] = live; } catch (e) { /* 只读忽略 */ }
    });
    comp.showConfigDialog();
    await _sleep(700);

    // ② 高亮并设置标准
    const input = document.getElementById('diag_standard');
    if (input) {
        if (typeof wf._flashDomElement === 'function') await wf._flashDomElement(input, tip || `把线序标准改为 ${value}`, 2400);
        input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // ③ 高亮并真正点击「保存」
    const saveBtns = [...document.querySelectorAll('button')].filter(b => b.textContent.trim() === '保存');
    const saveBtn = saveBtns[saveBtns.length - 1];
    if (saveBtn) {
        if (typeof wf._flashDomElement === 'function') await wf._flashDomElement(saveBtn, '点击「保存」确认线序标准', 1800);
        saveBtn.click();
        await _sleep(600);
    }

    // ④ 生效兜底
    if (comp.standard !== value && typeof comp.onConfigUpdate === 'function') comp.onConfigUpdate({ standard: value });
}

PROJECT_WORKFLOWS['t568b-fault'] = {
    id: 't568b-fault',
    name: '3. 测线判读与故障排查',
    steps: [
        {
            mode: 'check',
            msg: '1. 准备阶段：一键制备一根合格的 T568B 直通线，并用测线仪确认合格。',
            op: [
                {
                    type: 'observe', target: 'bench',
                    msg: '一键制备合格网线（复位后按 T568B 直接压接完成）',
                    async act() { const b = _bench(); if (b) { b.autoBuild(); } await _sleep(1200); },
                },
                {
                    type: 'observe', target: 'bench', part: 'tester',
                    msg: '点击「测线仪」检测，确认合格（1→8 依次点亮）',
                    async act() { const b = _bench(); if (b) b.runTest(); await _sleep(2600); },
                },
            ],
            check() { const b = _bench(); return !!b && b.isPass(); },
        },
        {
            mode: 'quiz',
            msg: '2. 选择题：T568B 直通线的线序（第 1~8 脚）是（   ）。',
            quizConfig: {
                question: 'T568B 直通线的线序（第 1~8 脚）是？',
                options: [
                    '白橙、橙、白绿、蓝、白蓝、绿、白棕、棕',
                    '白绿、绿、白橙、蓝、白蓝、橙、白棕、棕',
                    '白橙、橙、白绿、绿、蓝、白蓝、白棕、棕',
                    '橙、白橙、蓝、白绿、白蓝、绿、棕、白棕',
                ],
                answer: 0,
                analysis: 'T568B 线序为：1 白橙、2 橙、3 白绿、4 蓝、5 白蓝、6 绿、7 白棕、8 棕。其中第 4、5、6 脚是「蓝、白蓝、绿」，蓝对（蓝/白蓝）夹在中间，绿线在第 6 脚——这正是与按线对聚拢顺序（白绿、绿）最易混淆之处。选项 2 是 T568A 线序，选项 3 是把绿线误放到第 4 脚。',
            },
        },
        {
            mode: 'check',
            msg: '3. 通过工具栏「故障设置」，设置「网线线序错误（4、6 脚互换）」故障。',
            op: [{
                type: 'fault', fault: 't568b-order',
                msg: '设置故障：网线线序错误（4、6 脚互换）',
                async act() { await _sleep(600); },
            }],
            check() { const b = _bench(); return !!b && b.getFault() === 'order'; },
        },
        {
            mode: 'check',
            msg: '4. 再次点击「测线仪」检测，观察不合格现象：第 4、6 脚指示灯变红。',
            op: [{
                type: 'observe', target: 'bench', part: 'tester',
                msg: '点击「测线仪」重新检测',
                async act() { const b = _bench(); if (b) b.runTest(); await _sleep(2600); },
            }],
            check() { const b = _bench(); return !!b && !!b.getTestResult() && !b.isPass(); },
        },
        {
            mode: 'quiz',
            msg: '5. 选择题：测线仪显示第 4、6 脚异常，说明发生了什么？',
            quizConfig: {
                question: '测线仪显示第 4、6 脚指示灯异常，最可能的原因是？',
                options: [
                    '线序排错：第 4、6 脚的线芯位置放反了',
                    '整根网线的外皮没有剥干净',
                    '测线仪电池没电了',
                    '水晶头没压紧导致全部线芯断路',
                ],
                answer: 0,
                analysis: '测线仪按脚位逐个导通检测，若只有第 4、6 脚异常而其余正常，说明这两脚的线芯接反了（常见于把绿线误放在第 4 脚、蓝线误放在第 6 脚）。若是未压紧，通常会出现多脚甚至全部断路；若是外皮未剥净，线芯根本无法排布。',
            },
        },
        {
            mode: 'check',
            msg: '6. 通过工具栏「故障设置」，取消勾选并应用，修复线序故障。',
            op: [{
                type: 'fault', fault: 't568b-order', repair: true,
                msg: '修复故障：取消勾选并应用',
                async act() { await _sleep(600); },
            }],
            check() { const b = _bench(); return !!b && b.getFault() === null; },
        },
        {
            mode: 'check',
            msg: '7. 修复后再次用「测线仪」检测，8 个指示灯应恢复 1→8 依次点亮，判定合格。',
            op: [{
                type: 'observe', target: 'bench', part: 'tester',
                msg: '点击「测线仪」复测，确认恢复正常',
                async act() { const b = _bench(); if (b) b.runTest(); await _sleep(2600); },
            }],
            check() { const b = _bench(); return !!b && b.isPass(); },
        },
        {
            mode: 'check',
            msg: '8. 打开「T568B 网线制作工位」的参数配置界面，把线序标准改为 T568A，观察同一根网线被判为不合格。',
            op: [{
                type: 'knob', target: 'bench',
                msg: '在参数配置界面把线序标准改为 T568A 并保存',
                async act() { await _demoSetStandard(this, 'T568A', '把线序标准改为 T568A'); 
                    const b = _bench(); if (b) b.runTest(); await _sleep(2600); },
            }],
            check() {
                const b = _bench();
                return !!b && b.standard === 'T568A' && !!b.getTestResult() && !b.isPass();
            },
        },
        {
            mode: 'check',
            msg: '9. 把线序标准改回 T568B，恢复合格判定（收尾）。',
            op: [{
                type: 'knob', target: 'bench',
                msg: '在参数配置界面把线序标准改回 T568B 并保存',
                async act() { await _demoSetStandard(this, 'T568B', '把线序标准改回 T568B');
                    const b = _bench(); if (b) b.runTest(); await _sleep(2600); },
            }],
            check() { const b = _bench(); return !!b && b.standard === 'T568B' && b.isPass(); },
        },
        {
            mode: 'fill',
            msg: '10. 填空题：T568B 线序中，第 3 脚是（   ）线，第 5 脚是（   ）线。',
            fields: [
                { label: '第 3 脚线色', unit: '', answer: '白绿',
                  placeholder: '提示：绿色线对中的彩条线' },
                { label: '第 5 脚线色', unit: '', answer: '白蓝',
                  placeholder: '提示：蓝色线对中的彩条线' },
            ],
        },
    ],
};

// ═════════════════════════════════════════════════════════════════════════
// 流程 4：认识三种线缆并测试其用途与特点
// ═════════════════════════════════════════════════════════════════════════
const _cables = () => (typeof window !== 'undefined' && window.sys) ? window.sys.comps['cables'] : null;

PROJECT_WORKFLOWS['cable-types'] = {
    id: 'cable-types',
    name: '4. 认识三种线缆并测试其用途与特点',
    steps: [
        // ── 前置：勾选工具栏「通信电缆」复选框，调出线缆对比台 ──
        {
            mode: 'check',
            msg: '1. 勾选工具栏「通信电缆」复选框，调出线缆对比台（工作台）。',
            op: [{
                type: 'instrument', checkbox: 'cableChk',
                msg: '勾选工具栏「通信电缆」复选框，调出线缆对比台',
                async act() { await _sleep(400); },
            }],
            check() { const cb = document.getElementById('cableChk'); return !!(cb && cb.checked); },
        },

        // ── 认识三种线缆与连接件 ──
        { mode: 'find', target: 'cables', subTarget: 'cable-utp', msg: '2. 双绞线网线：由 4 对相互绞合的导线构成，请点击它' },
        { mode: 'find', target: 'cables', subTarget: 'rj45-left', msg: '3. 网线两端的水晶头（RJ45 连接器）：压接线芯、插入网口，请点击它' },
        { mode: 'find', target: 'cables', subTarget: 'cable-fiber', msg: '4. 光纤（光缆）：以光信号传输数据，请点击它' },
        { mode: 'find', target: 'cables', subTarget: 'fiber-left', msg: '5. 光纤两端的 SC 插接头：连接光模块／光端机，请点击它' },
        { mode: 'find', target: 'cables', subTarget: 'cable-coax', msg: '6. 同轴电缆：内导体与外导体共轴，请点击它' },
        { mode: 'find', target: 'cables', subTarget: 'coax-left', msg: '7. 同轴电缆两端的 BNC 插接件：用于射频与视频信号连接，请点击它' },

        // ── 测试题：特点与用途 ──
        {
            mode: 'quiz',
            msg: '8. 选择题：双绞线网线的结构特点与主要用途是（   ）。',
            quizConfig: {
                question: '双绞线网线（UTP）的结构特点与主要用途是？',
                options: [
                    '两根导线相互绞合抵消干扰，两端压接 RJ45 水晶头；用于局域网／以太网布线',
                    '内外导体共轴、屏蔽性好；用于有线电视与视频信号',
                    '以光信号传输、带宽极大；用于骨干网与长距离链路',
                    '由单根铜线外包绝缘层构成，无屏蔽，用于电力传输',
                ],
                answer: 0,
                analysis: '双绞线把两根导线按一定节距绞合，使两线感应的干扰相互抵消，成本低、柔软易施工、可现场压接 RJ45 水晶头，是最常见的局域网／以太网布线介质（100M／1000M／2.5G，单段最长 100m）。选项 2 是网线「按线对」的绞合原理之外的误区，选项 3 是光纤，选项 4 描述的是普通单芯导线。',
            },
        },
        {
            mode: 'quiz',
            msg: '9. 选择题：光纤最突出的特点是（   ）。',
            quizConfig: {
                question: '与网线、同轴电缆相比，光纤最突出的特点是？',
                options: [
                    '带宽极大、损耗极低、抗电磁干扰、传输距离远',
                    '线径最粗、机械强度最高，可直接用螺丝压接',
                    '利用电流传输，可与电力线共用',
                    '价格最低、最容易现场制作接头',
                ],
                answer: 0,
                analysis: '光纤用光信号而非电信号传输：频带极宽、衰减小，单模光纤可达数十公里；光信号不受电磁干扰、不产生电磁泄漏。它的缺点是接头需专用熔接／研磨设备、不能过度弯折，因此选项 2、4 描述的特点与光纤实际相反。',
            },
        },
        {
            mode: 'quiz',
            msg: '10. 选择题：同轴电缆的特性阻抗与主要用途是（   ）。',
            quizConfig: {
                question: '同轴电缆的特性阻抗与主要用途是？',
                options: [
                    '常用特性阻抗 75Ω（视频）／50Ω（射频）；用于有线电视、视频监控与射频信号传输',
                    '特性阻抗 100Ω；用于以太网数据传输',
                    '没有固定阻抗；只能传输直流电',
                    '特性阻抗 600Ω；用于电话语音',
                ],
                answer: 0,
                analysis: '同轴电缆由内导体、绝缘层、外导体（编织网）和外护套同心套叠而成，屏蔽性好、特性阻抗稳定。视频／有线电视系统常用 75Ω，射频与仪器常用 50Ω。100Ω 是双绞线的标称阻抗，600Ω 是电话线路的古老标准。',
            },
        },

        // ── 填空题：归纳三种线缆的关键特点 ──
        {
            mode: 'fill',
            msg: '11. 填空题：光纤抗（   ）干扰且传输距离（   ）；同轴电缆常用特性阻抗为（   ）Ω。',
            fields: [
                { label: '光纤抗什么干扰', unit: '', answer: '电磁', placeholder: '两字' },
                { label: '传输距离（远/近）', unit: '', answer: ['远', '长'], placeholder: '与网线相比' },
                { label: '同轴常用阻抗', unit: 'Ω', answer: '75', placeholder: '视频系统常用值' },
            ],
        },
    ],
};

export function initSlider(_sys) { }

export function applyAllPresets() { }

export async function applyStartSystem() {
    const b = _bench(); if (b) { b.autoBuild(); } await _sleep(1200); 
 }

export function fiveStep() { }
