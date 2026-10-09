
import { Multimeter } from '../components/Multimeter.js';
import { MF47Multimeter } from '../components/MF47Multimeter.js';
import { Oscilloscope_tri } from '../components/Osc_tri.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';
import { ElecMeter } from '../components/ElecMeter.js';
import { RealMegohmMeter } from '../components/RealMegohmMeter.js';
import { PPEPanel } from '../components/PPEPanel.js';



export const FAULT_CONFIGS = {

};

export const PROJECT_WORKFLOWS = {
    // ══════════════════════════════════════════════════════════════
    // 认识与识别个人防护用品
    // 在『ppe-panel』个人防护用品展示面板上操作
    // ══════════════════════════════════════════════════════════════
    'ppe-intro': {
        id: 'ppe-intro',
        name: '1.认识个人防护用品',
        steps: [
            // ── 步骤 1：绝缘手套 ──
            {
                msg: '第 1 步：点击识别【绝缘手套】',
                mode: 'find',
                target: 'ppe-panel',
                subTarget: 'cell-gloves',
                async act() {
                    this.sys.showFloatingTip('绝缘手套：由绝缘橡胶制成，用于隔离手部与带电体、防止触电。'
                        + '特点：耐压等级高、柔韧耐磨；使用前须检查有无破损、气泡并进行充气试验；操作 1000V 以上电压时必须佩戴。', 8000);
                    await new Promise(r => setTimeout(r, 8000));
                },
            },
            {
                msg: '测试题：绝缘手套的主要作用是什么？',
                mode: 'quiz',
                quizConfig: {
                    question: '绝缘手套的主要作用是什么？',
                    options: [
                        '防止手部划伤',
                        '隔离手部与带电体，防止触电',
                        '使手部保持干燥',
                        '在冬天为手部保暖',
                    ],
                    answer: 1,
                    analysis: '绝缘手套由绝缘橡胶制成，用于隔离手部与带电体，防止操作高压电气设备时发生触电事故。',
                },
            },
            // ── 步骤 2：绝缘靴 ──
            {
                msg: '第 2 步：点击识别【绝缘靴】',
                mode: 'find',
                target: 'ppe-panel',
                subTarget: 'cell-shoes',
                async act() {
                    this.sys.showFloatingTip('绝缘靴（绝缘鞋）：用于隔离人体与大地，与绝缘手套配合形成两道保护。'
                        + '特点：鞋底厚实耐压、防滑耐磨；在高压带电作业、配电室巡视等场合必须穿着，防止因跨步电压触电。', 8000);
                    await new Promise(r => setTimeout(r, 8000));
                },
            },
            {
                msg: '测试题：绝缘靴的作用是？',
                mode: 'quiz',
                quizConfig: {
                    question: '绝缘靴的主要作用是？',
                    options: [
                        '防滑防水',
                        '隔离人体与大地，防止触电',
                        '保护脚踝不受外伤',
                        '方便在油污地面行走',
                    ],
                    answer: 1,
                    analysis: '绝缘靴用于隔离人体与大地，配合绝缘手套形成保护，防止因接触带电体或地电位升高而触电。',
                },
            },
            // ── 步骤 3：护目镜 ──
            {
                msg: '第 3 步：点击识别【护目镜】',
                mode: 'find',
                target: 'ppe-panel',
                subTarget: 'cell-glasses',
                async act() {
                    this.sys.showFloatingTip('护目镜：用于保护眼睛免受飞溅物、电弧光、强光及粉尘的伤害。'
                        + '特点：镜片采用抗冲击、防紫外线的材料；进行会产生电弧、火花或飞溅物的电气作业时必须佩戴。', 8000);
                    await new Promise(r => setTimeout(r, 8000));
                },
            },
            {
                msg: '测试题：护目镜主要保护身体的哪个部位？',
                mode: 'quiz',
                quizConfig: {
                    question: '护目镜主要用于保护人体的哪个部位？',
                    options: [
                        '手部',
                        '头部',
                        '眼睛',
                        '呼吸道',
                    ],
                    answer: 2,
                    analysis: '护目镜用以保护眼睛，防止电弧光、飞溅物、强光等对眼睛造成伤害。',
                },
            },
            // ── 步骤 4：防护服 ──
            {
                msg: '第 4 步：点击识别【防护服】',
                mode: 'find',
                target: 'ppe-panel',
                subTarget: 'cell-clothes',
                async act() {
                    this.sys.showFloatingTip('防护服：用于防止电弧烧伤、化学品飞溅及粉尘污染，是带电作业人员的基本防护装备。'
                        + '特点：面料具有阻燃、耐高温、防电弧性能；进行高压电气带电作业时穿着，可降低电弧闪络灼伤风险。', 8000);
                    await new Promise(r => setTimeout(r, 8000));
                },
            },
            {
                msg: '测试题：关于防护服的特点正确的是？',
                mode: 'quiz',
                quizConfig: {
                    question: '下列关于防护服特点的说法，正确的是？',
                    options: [
                        '防护服只能防雨',
                        '防护服面料具有阻燃、耐高温、防电弧性能',
                        '防护服仅用于防寒',
                        '进行低压作业时无需考虑防护服的阻燃性能',
                    ],
                    answer: 1,
                    analysis: '防护服面料具有阻燃、耐高温、防电弧性能，是带电作业人员防止电弧灼伤的基本防护装备。',
                },
            },
            // ── 步骤 5：安全帽 ──
            {
                msg: '第 5 步：点击识别【安全帽】',
                mode: 'find',
                target: 'ppe-panel',
                subTarget: 'cell-hat',
                async act() {
                    this.sys.showFloatingTip('安全帽：用于保护头部免受坠落物、碰撞及触电的伤害。'
                        + '特点：外壳坚硬、内衬吸能减震、帽衬与帽壳间留有缓冲空间；进入作业现场必须正确佩戴并系紧下颏带。', 8000);
                    await new Promise(r => setTimeout(r, 8000));
                },
            },
            {
                msg: '测试题：安全帽的主要功能是？',
                mode: 'quiz',
                quizConfig: {
                    question: '安全帽主要用于防护什么？',
                    options: [
                        '保护手部',
                        '保护脚部',
                        '保护头部免受坠落物和碰撞伤害',
                        '防止眼睛进灰',
                    ],
                    answer: 2,
                    analysis: '安全帽用于保护头部免受坠落物、碰撞的伤害，进入作业现场必须佩戴。',
                },
            },
            // ── 步骤 6：绝缘垫 ──
            {
                msg: '第 6 步：点击识别【绝缘垫】',
                mode: 'find',
                target: 'ppe-panel',
                subTarget: 'cell-mat',
                async act() {
                    this.sys.showFloatingTip('绝缘垫：铺设在地面上，用于隔离人体与大地，防止操作时因接触带电体或地电位升高而触电。'
                        + '特点：由绝缘橡胶制成、耐压等级高、表面防滑；常用于配电室、高压开关柜操作通道等场所的地面铺设。', 8000);
                    await new Promise(r => setTimeout(r, 8000));
                },
            },
            {
                msg: '测试题：绝缘垫通常铺设在哪里？',
                mode: 'quiz',
                quizConfig: {
                    question: '绝缘垫通常铺设在哪里？',
                    options: [
                        '配电室、高压开关柜操作通道的地面',
                        '办公室天花板',
                        '设备外壳内部',
                        '窗户玻璃上',
                    ],
                    answer: 0,
                    analysis: '绝缘垫铺设于配电室、高压开关柜操作通道等场所，用于隔离人体与大地，防止触电。',
                },
            },
            // ── 步骤 7：综合测试 ──
            {
                msg: '综合测试题：在高压带电作业时需佩戴的防护用品？',
                mode: 'quiz',
                quizConfig: {
                    question: '在高压电气带电作业时，必须穿戴的防护用品是？',
                    isMultiple: true,
                    options: [
                        '绝缘手套',
                        '绝缘靴',
                        '护目镜',
                        '普通拖鞋',
                    ],
                    answer: [0, 1, 2],
                    analysis: '高压带电作业时须穿戴绝缘手套、绝缘靴以隔离带电体与大地，同时佩戴护目镜防护电弧光，确保人身安全。',
                },
            },
            {
                msg: '综合测试题：绝缘手套使用前的检查要点？',
                mode: 'quiz',
                quizConfig: {
                    question: '绝缘手套使用前应进行的检查包括？',
                    isMultiple: true,
                    options: [
                        '检查有无破损、气泡',
                        '进行充气试验',
                        '核对耐压等级',
                        '直接使用不用检查',
                    ],
                    answer: [0, 1, 2],
                    analysis: '绝缘手套使用前须检查有无破损、气泡，进行充气试验，并核对耐压等级，确认合格后方可使用。',
                },
            },
        ],
    },
};

export const componentConfigs = [
 
    // ── 测量仪表（隐藏，按需显示）──
    { Class: Multimeter, id: 'multimeter', x: 500, y: 100, visible: false },
    { Class: MF47Multimeter, id: 'mf47-panel', x: 650, y: 100, visible: false },
    { Class: Oscilloscope_tri, id: 'osc', x: 50, y: 50, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 50, y: 50, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 50, y: 50, visible: false },
    { Class: ElecMeter, id: 'elecmeter', x: 50, y: 50, visible: false },
    // ── 手摇式兆欧表（摇表，2500V 型；隐藏，测试绝缘时按需调出）──
    { Class: RealMegohmMeter, id: 'megohm', x: 200, y: 50, voltage: 2500, label: '手摇兆欧表(2500V)', visible: false },
    // ── 个人防护用品展示面板 ──
    { Class: PPEPanel, id: 'ppe-panel', x: 100, y: 50, visible: true },
];

// ─── 接线辅助 ───

const _sleep = ms => new Promise(r => setTimeout(r, ms));



function _autoWire(sys) {
    sys.conns.length = 0;
    const cons = [];
    cons.forEach(c => sys.connMgr.addConn(c));
    sys.redrawAll();
}

export function initSlider(_sys) {
}

export function applyAllPresets() {
    const sys = this && this.sys ? this.sys : window.sys;
    if (!sys) return;
    _autoWire(sys);
}

export async function applyStartSystem() {
    const sys = this && this.sys ? this.sys : window.sys;
    if (!sys) return;
 
}

export function fiveStep() {
}
