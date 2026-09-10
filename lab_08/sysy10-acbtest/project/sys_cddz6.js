// 断路器保护特性测试工程
// 由"断路器保护特性测试仪"为被试主开关提供一次大电流 / 二次模拟电流与可调线电压，
// 电子脱扣器（经 CT/PT 或直接注入）动作使主开关跳闸，测试仪测量并显示跳闸时间。
// 同步发电机已移至左上角，孤立备用，不再接线。

import { SyncGenerator3P } from '../components/SyncGenerator3P.js';
import { MarineMainsSwitch } from '../components/MarineMainsSwitch.js';
import { MarineElectronicTrip } from '../components/MarineElectronicTrip.js';
import { DiagramCurrentTransformer } from '../components/DiagramCurrentTransformer.js';
import { DiagramPotentialTransformer } from '../components/DiagramPotentialTransformer.js';
import { BreakerProtectionTester } from '../components/BreakerProtectionTester.js';
import { ThreePhaseLoad } from '../components/ThreePhaseLoad.js';
import { DCPower } from '../components/DCPower.js';
import { Ground } from '../components/Gnd.js';
import { Multimeter } from '../components/Multimeter.js';
import { MF47Multimeter } from '../components/MF47Multimeter.js';
import { Oscilloscope_tri } from '../components/Osc_tri.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';
import { ElecMeter } from '../components/ElecMeter.js';

// 故障配置（暂时清空，后续按需补充）
export const FAULT_CONFIGS = {};

// ═══════════════════════════════════════════════════════════════════
// 操作流程
// ═══════════════════════════════════════════════════════════════════

export const PROJECT_WORKFLOWS = {
    'primary-current-test': {
        id: 'primary-current-test',
        name: '1. 一次大电流故障实验',
        steps: [
            {
                msg: '1. 自动接线，合上主开关',
                mode: 'check',
                op: [
                    { type: 'wire', msg: '点击工具栏"自动接线"按钮完成接线' },
                    { type: 'switch', target: 'qf1', msg: '储能后合上主开关' },
                ],
                async act() {
                    const sys = this.sys;
                    _autoWire(sys);
                    sys.showFloatingTip('已自动接线', 1500);
                    await _sleep(800);
                    await _qfChargeClose(sys, 'qf1');
                },
                check() {
                    const q = this.sys.comps.qf1;
                    return !!(q && q.getState() === 'on');
                },
            },
            {
                msg: '2. 将一次电流调到 140A，点击"一次 起动"，触发过载，观察液晶屏直到显示跳闸时间',
                mode: 'check',
                op: [
                    { type: 'knob', target: 'tester1', part: 'primaryI', msg: '调节"一次电流"旋钮到 140A',
                      async act() {
                          const t = this.sys.comps.tester1;
                          t.primaryI = t._snap('primaryI', 140);
                          t._updateKnobs();
                          this.sys.showFloatingTip('一次电流已设为 140A（过载）', 1500);
                          await _sleep(800);
                      } },
                    { type: 'btn', target: 'tester1', part: 'btn-p-start', msg: '点击"一次 起动"按钮，注入一次电流',
                      async act() {
                          this.sys.comps.tester1._startPrimary();
                          await _sleep(500);
                      } },
                    { type: 'observe', target: 'tester1', part: 'lcd', msg: '观察液晶屏，等待显示跳闸时间',
                      async act() {
                          await _waitUntil(() => this.sys.comps.tester1._pTripTime !== null, 40000);
                      } },
                ],
                check() {
                    const t = this.sys.comps.tester1;
                    if (!t || t.primaryI !== 140) return false;     // 一次电流已整定为 140A
                    if (!t._primaryOn) return false;                // 本次已按下"一次 起动"（未停止）
                    if (!t._pOutputSeen) return false;              // 本次已真正输出一次电流
                    if (t._pTripTime === null) return false;        // 已测得跳闸时间
                    return /跳闸时间/.test(t._lcdLine2.text());     // 液晶屏已显示跳闸时间
                },
            },
            {
                msg: '3. 点击"一次 停止"，复位电子脱扣器，重新合上主开关',
                mode: 'check',
                op: [
                    { type: 'btn', target: 'tester1', part: 'btn-p-stop', msg: '点击"一次 停止"按钮',
                      async act() {
                          this.sys.comps.tester1._stopPrimary();
                          await _sleep(500);
                      } },
                    { type: 'observe', target: 'et1', part: 'lcd', msg: '复位电子脱扣器',
                      async act() {
                          const et = this.sys.comps.et1;
                          if (et && et.reset) et.reset();
                          this.sys.showFloatingTip('电子脱扣器已复位', 1500);
                          await _sleep(800);
                      } },
                    { type: 'switch', target: 'qf1', msg: '重新合上主开关',
                      async act() {
                          await _qfChargeClose(this.sys, 'qf1');
                      } },
                ],
                check() {
                    const q = this.sys.comps.qf1, et = this.sys.comps.et1;
                    return !!(q && q.getState() === 'on') && !(et && et.isTripped());
                },
            },
            {
                msg: '4. 将一次电流调到 300A，点击"一次 起动"，触发短路，观察液晶屏直到显示跳闸时间',
                mode: 'check',
                op: [
                    { type: 'knob', target: 'tester1', part: 'primaryI', msg: '调节"一次电流"旋钮到 300A',
                      async act() {
                          const t = this.sys.comps.tester1;
                          t.primaryI = t._snap('primaryI', 300);
                          t._pTripTime = null; t._pOutputSeen = false; t._pTiming = false; t._pElapsed = 0;
                          t._updateKnobs();
                          this.sys.showFloatingTip('一次电流已设为 300A（短路）', 1500);
                          await _sleep(800);
                      } },
                    { type: 'btn', target: 'tester1', part: 'btn-p-start', msg: '点击"一次 起动"按钮，注入一次电流',
                      async act() {
                          this.sys.comps.tester1._startPrimary();
                          await _sleep(500);
                      } },
                    { type: 'observe', target: 'tester1', part: 'lcd', msg: '观察液晶屏，等待显示跳闸时间',
                      async act() {
                          await _waitUntil(() => this.sys.comps.tester1._pTripTime !== null, 20000);
                      } },
                ],
                check() {
                    const t = this.sys.comps.tester1;
                    if (!t || t.primaryI !== 300) return false;     // 一次电流已整定为 300A
                    if (!t._primaryOn) return false;                // 本次已按下"一次 起动"（未停止）
                    if (!t._pOutputSeen) return false;              // 本次已真正输出一次电流
                    if (t._pTripTime === null) return false;        // 已测得跳闸时间
                    return /跳闸时间/.test(t._lcdLine2.text());     // 液晶屏已显示跳闸时间
                },
            },
            {
                msg: '5. 测试题：一次大电流测试的作用',
                mode: 'quiz',
                quizConfig: {
                    question: '一次大电流测试（一次注入法）的主要作用是？',
                    options: [
                        '测量主开关主回路的绝缘电阻',
                        '向主开关主回路注入可控大电流，实际检验其过载 / 短路保护特性与跳闸时间',
                        '校准电子脱扣器的电压测量精度',
                        '检查主开关储能电机的转速',
                    ],
                    answer: 1,
                    analysis: '一次大电流测试由断路器保护特性测试仪向主开关主回路注入可控三相大电流，'
                        + '电流经电流互感器采样送入电子脱扣器，使脱扣器按整定值动作，从而实测主开关在过载、'
                        + '短路等故障下的动作电流与跳闸时间，验证其保护特性是否符合要求。',
                },
            },
        ],
    },
};

export const componentConfigs = [
    // ── 同步发电机：移至左上角，孤立备用，不再接线 ──
    { Class: SyncGenerator3P, id: 'gen1', x: -800, y: -500, vRms: 230, freq: 50, isOn: false, mode: 'local', label: '1#同步发电机（备用）', ratedPower: 80, ratedVoltage: 400, ratedCosPhi: 0.8, maxDropV: 200, avrMaxComp: 1, avrDelay: 2, avrTime: 5, autoDecoupleTrim: true, visible: true },

    // ── 被试主开关 ──
    { Class: MarineMainsSwitch, id: 'qf1', x: 180, y: 80, ratedCtrlVoltage: 24, label: '主开关', genId: 'gen1', phaseMin: 60, phaseMax: 270, freqDiffMax: 0.5, revPowerKw: 8, revTime: 5, faultSimpleProtect: false, visible: true },

    // ── 断路器保护特性测试仪 ──
    { Class: BreakerProtectionTester, id: 'tester1', x: -150, y: 580, label: '断路器保护特性测试仪', primaryI: 0, secondaryI: 0, secondaryPhase: 0, lineV: 400, visible: true },

    // ── 电子脱扣器：采集 CT 副边电流 + PT 副边电压，脱扣输出驱动主开关 ET 接口 ──
    { Class: MarineElectronicTrip, id: 'et1', x: 600, y: 600, In: 100, Un: 400, phase: '3', cosPhi: 1, ctRatio: 20, ptRatio: 2.31, shortMult: 2, overloadMult: 1.2, label: '电子脱扣器', visible: true },

    // ── 电流互感器（简化原理图版）：原边串入一次电流回路 W 相 ──
    { Class: DiagramCurrentTransformer, id: 'ct1', x: 400, y: 520, turnsRatio: 20, primaryRated: 100, secondaryRated: 5, label: '电流互感器', visible: true },
    // ── 电压互感器（简化原理图版）：原边接测试仪可调线电压（400/100） ──
    { Class: DiagramPotentialTransformer, id: 'pt1', x: 400, y: 680, turnsRatio: 4, primaryRated: 400, secondaryRated: 100, label: '电压互感器', visible: true },

    // ── 控制电源（DC 24V）：主开关线圈 / 电子脱扣器 / 测试仪供电 ──
    { Class: DCPower, id: 'dc_uv', x: 1100, y: 350, voltage: 24, isOn: true, label: '控制电源 24V', visible: true },

    // ── 线圈接地：电源负极与各线圈负端共用 ──
    { Class: Ground, id: 'gnd1_qf', x: 1000, y: 500, label: '线圈接地', visible: true },

    // ── 必需保留的 6 种仪表（默认隐藏）──
    { Class: Multimeter, id: 'multimeter', x: 920, y: 100, visible: false },
    { Class: MF47Multimeter, id: 'mf47-panel', x: 1050, y: 150, visible: false },
    { Class: Oscilloscope_tri, id: 'osc', x: 50, y: 50, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 50, y: 50, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 50, y: 50, visible: false },
    { Class: ElecMeter, id: 'elecmeter', x: 50, y: 50, visible: false },
];

// ─── 流程辅助 ───

const _sleep = ms => new Promise(r => setTimeout(r, ms));

// 轮询等待条件成立（100ms 间隔，超时返回 false）
async function _waitUntil(fn, timeout = 40000) {
    for (let i = 0, n = Math.ceil(timeout / 100); i < n; i++) {
        if (fn()) return true;
        await _sleep(100);
    }
    return false;
}

// 主开关储能后合闸
async function _qfChargeClose(sys, qfId) {
    const q = sys.comps[qfId];
    if (!q || q.getState() === 'on') return;
    q._chargeProg = 5;
    q._charged = true;
    await _sleep(200);
    if (q.tryClose) q.tryClose();
    await _waitUntil(() => q.getState() === 'on', 8000);
}

// ─── 接线辅助 ───

function _autoWire(sys) {
    sys.conns.length = 0;
    const cons = [
        // ── 一次电流回路：测试仪输出 → 主开关进线 T1/T2/T3（W 相串 CT 原边）──
        { from: 'tester1_wire_out1', to: 'qf1_wire_t1', type: 'wire' },
        { from: 'tester1_wire_out2', to: 'qf1_wire_t2', type: 'wire' },
        { from: 'tester1_wire_out3', to: 'ct1_wire_p1', type: 'wire' },
        { from: 'ct1_wire_p2', to: 'qf1_wire_t3', type: 'wire' },
        // 测试仪回流 → 主开关出线 L1/L2/L3（经主触头形成一次电流回路）
        { from: 'tester1_wire_r1', to: 'qf1_wire_l1', type: 'wire' },
        { from: 'tester1_wire_r2', to: 'qf1_wire_l2', type: 'wire' },
        { from: 'tester1_wire_r3', to: 'qf1_wire_l3', type: 'wire' },

        // ── 电流互感器副边 → 电子脱扣器电流采样端（一次测试；二次测试时改接测试仪 iout1/iout2）──
        { from: 'ct1_wire_s1', to: 'et1_wire_i+', type: 'wire' },
        { from: 'et1_wire_i-', to: 'ct1_wire_s2', type: 'wire' },

        // ── 测试仪可调线电压 → 电压互感器原边；PT 副边 → 电子脱扣器电压采样端 ──
        { from: 'tester1_wire_vout1', to: 'pt1_wire_p1', type: 'wire' },
        { from: 'tester1_wire_vout2', to: 'pt1_wire_p2', type: 'wire' },
        { from: 'pt1_wire_s1', to: 'et1_wire_u+', type: 'wire' },
        { from: 'et1_wire_u-', to: 'pt1_wire_s2', type: 'wire' },

        // ── 测试仪 ← 主开关常开辅助触点（用于检测跳闸、停止计时）──
        { from: 'tester1_wire_no_in1', to: 'qf1_wire_no1', type: 'wire' },
        { from: 'tester1_wire_no_in2', to: 'qf1_wire_no2', type: 'wire' },

        // ── 电子脱扣器工作电源（DC 24V），负极共地 ──
        { from: 'dc_uv_wire_p', to: 'et1_wire_vp', type: 'wire' },
        { from: 'et1_wire_vn', to: 'gnd1_qf_wire_gnd', type: 'wire' },

        // ── 测试仪 24V 电源（接通后测试仪才工作）──
        { from: 'dc_uv_wire_p', to: 'tester1_wire_p24_p', type: 'wire' },
        { from: 'tester1_wire_p24_n', to: 'gnd1_qf_wire_gnd', type: 'wire' },

        // ── 电子脱扣器脱扣输出 → 主开关 ET 接口（脱扣时 t1-t2 输出 24V）──
        { from: 'et1_wire_t1', to: 'qf1_wire_et1', type: 'wire' },
        { from: 'et1_wire_t2', to: 'qf1_wire_et2', type: 'wire' },

        // ── 控制电源（DC 24V）：失压脱扣线圈 / 储能电机 正端；线圈负端共地 ──
        { from: 'dc_uv_wire_p', to: 'qf1_wire_uv1', type: 'wire' },
        { from: 'dc_uv_wire_p', to: 'qf1_wire_m1', type: 'wire' },
        { from: 'qf1_wire_uv2', to: 'gnd1_qf_wire_gnd', type: 'wire' },
        { from: 'qf1_wire_m2', to: 'gnd1_qf_wire_gnd', type: 'wire' },
        { from: 'dc_uv_wire_n', to: 'gnd1_qf_wire_gnd', type: 'wire' },
    ];
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
    _autoWire(sys);
    // 同步发电机已孤立备用；系统测试电源由断路器保护特性测试仪提供。
    // 主开关保持在分闸状态，等待学员合闸后开始测试。
    const q1 = sys.comps.qf1;
    if (q1 && q1.getState() === 'on' && q1.tryTrip) q1.tryTrip();
}

export function fiveStep() {
}
