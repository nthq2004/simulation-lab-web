
import { DiagramACPower3P } from '../components/DiagramACPower3P.js';
import { DiagramThreePhaseACB } from '../components/DiagramThreePhaseACB.js';
import { InductionMotor2 } from '../components/InductionMotor2.js';
import { Multimeter } from '../components/Multimeter.js';
import { MF47Multimeter } from '../components/MF47Multimeter.js';
import { Oscilloscope_tri } from '../components/Osc_tri.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';
import { ElecMeter } from '../components/ElecMeter.js';
import { RealMegohmMeter } from '../components/RealMegohmMeter.js';
import { TsCurveDisplay } from '../components/TsCurveDisplay.js';
import { SinglePhaseFuse } from '../components/SinglePhaseFuse.js';
import { DiagramStopButton } from '../components/DiagramStopButton.js';
import { DiagramStartButton } from '../components/DiagramStartButton.js';

import { ControlTransformer } from '../device/ControlTransformer.js';
import { MainContact } from '../device/MainContact.js';
import { ContactorCoil } from '../device/ContactorCoil.js';
import { AuxNOContact } from '../device/AuxNOContact.js';
import { ThermalHeatElement } from '../device/ThermalHeatElement.js';
import { ThermalNCContact } from '../device/ThermalNCContact.js';
import { MotorStarterPanel } from '../components/MotorStarterPanel.js';
import { AuxNCContact } from '../device/AuxNCContact.js';
import { TimeRelayCoil } from '../device/TimeRelayCoil.js';
import { TimeDelayNOContact } from '../device/TimeDelayNOContact.js';
import { TimeDelayNCContact } from '../device/TimeDelayNCContact.js';

// ═══════════════════════════════════════════════════════════════
// 通用辅助（工作流用）
// ═══════════════════════════════════════════════════════════════

const _sysOf = (ctx) => (ctx && ctx.sys) ? ctx.sys : window.sys;
const _sleep = (ms) => new Promise(r => setTimeout(r, ms));
const _comp = (sys, id) => (sys && sys.comps) ? sys.comps[id] : null;

/** 取部件命中节点（组件用 addClickablePart 或人工登记 _parts 时提供） */
function _partNode(comp, partId) {
    return (comp && typeof comp.getClickablePartNode === 'function')
        ? comp.getClickablePartNode(partId) : null;
}

/** 向部件命中节点派发事件，触发组件自身的点击逻辑（优先用真实交互，不用赋值） */
function _firePart(comp, partId, evtName = 'click') {
    const node = _partNode(comp, partId);
    if (!node || typeof node.fire !== 'function') return false;
    node.fire(evtName, { evt: { button: 0, cancelBubble: false } });
    return true;
}

/** 按下按钮并保持 holdMs 后松开（真实 mousedown → mouseup，触发组件自身刀片/推杆动作） */
async function _pressBtn(sys, compId, holdMs = 600) {
    const comp = _comp(sys, compId);
    if (!comp) return false;
    if (_firePart(comp, 'btn', 'mousedown')) {
        await _sleep(holdMs);
        _firePart(comp, 'btn', 'mouseup');
        return true;
    }
    // 兜底：部件未登记命中节点时用组件公开 API
    if (typeof comp.setManualOverride === 'function') {
        comp.setManualOverride(true);
        await _sleep(holdMs);
        comp.setManualOverride(false);
    }
    return false;
}

/** 按下按钮不松开（测量类步骤需要按钮保持按下状态） */
function _holdBtn(sys, compId) {
    const comp = _comp(sys, compId);
    if (!comp) return false;
    if (_firePart(comp, 'btn', 'mousedown')) return true;
    if (typeof comp.setManualOverride === 'function') { comp.setManualOverride(true); return true; }
    return false;
}

/** 松开按钮 */
function _releaseBtn(sys, compId) {
    const comp = _comp(sys, compId);
    if (!comp) return false;
    if (_firePart(comp, 'btn', 'mouseup')) return true;
    if (typeof comp.setManualOverride === 'function') { comp.setManualOverride(false); return true; }
    return false;
}

/** 点击断路器触头合/分闸，直到状态达到目标（点击受阻时用组件公开方法兜底） */
async function _ensureAcb(sys, on = true) {
    const comp = _comp(sys, 'acb');
    if (!comp) return false;
    const want = on ? 'on' : 'off';
    for (let i = 0; i < 6; i++) {
        if (comp.getState() === want) return true;
        if (!comp.isAnimating || !comp.isAnimating()) {
            if (!_firePart(comp, 'handle')) {
                if (want === 'on') comp.close(); else comp.open();
            }
        }
        await _sleep(420);
    }
    return comp.getState() === want;
}

/** 轮询等待条件成立 */
async function _waitFor(sys, cond, timeoutMs = 20000, intervalMs = 250) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
        try { if (cond(sys)) return true; } catch (e) { /* ignore */ }
        await _sleep(intervalMs);
    }
    try { return !!cond(sys); } catch (e) { return false; }
}

// ═══════════════════════════════════════════════════════════════
// 故障配置
// ═══════════════════════════════════════════════════════════════

export const FAULT_CONFIGS = {
    km1coil_a1_poor: {
        id: 'km1coil_a1_poor',
        name: '接触器线圈 A1 端子接触不良',
        system: '控制回路',
        check()  { return window.sys?._poorContactPorts?.has('km1-coil_wire_a1'); },
        trigger() { (window.sys._poorContactPorts ??= new Set()).add('km1-coil_wire_a1'); },
        repair() { window.sys._poorContactPorts?.delete('km1-coil_wire_a1'); },
    },
    km1no1_com_poor: {
        id: 'km1no1_com_poor',
        name: '辅助常开 COM 端子接触不良',
        system: '控制回路',
        check()  { return window.sys?._poorContactPorts?.has('km1-no1_wire_com'); },
        trigger() { (window.sys._poorContactPorts ??= new Set()).add('km1-no1_wire_com'); },
        repair() { window.sys._poorContactPorts?.delete('km1-no1_wire_com'); },
    },
};

// ═══════════════════════════════════════════════════════════════
// 工作流（单页工程：不使用 type:'page' 的翻页 op）
// 文字原则：每步只写"操作对象 + 动作 + 期望现象"，1~2 句，不展开原理
// ═══════════════════════════════════════════════════════════════

export const PROJECT_WORKFLOWS = {
    'read-circuit': {
        id: 'read-circuit', name: '1.读懂电气控制图',
        steps: [
            {
                msg: '第 1 步：按图完成主回路与控制回路接线。',
                mode: 'check',
                op: [
                    {
                        type: 'observe', target: 'ac',
                        msg: '主回路接线：电源 → QF → KM1 → FR → 电动机（14 根）',
                        async act() {
                            const sys = _sysOf(this);
                            sys.conns.length = 0;
                            _autoWire(sys);
                            await _sleep(800);
                        },
                    },
                    {
                        type: 'observe', target: 'tc',
                        msg: '控制回路接线：FU4 → TC → SB1 → SB2∥KM1 → 线圈 → FR → FU5（11 根）',
                        async act() { await _sleep(1200); },
                    },
                ],
                check() {
                    const c = (a, b) => _sysOf(this).isPortConnected(a, b);
                    return c('ac_wire_u', 'acb_wire_l1')
                        && c('acb_wire_t1', 'km1-mc_wire_l1')
                        && c('km1-mc_wire_t3', 'fr_wire_l3')
                        && c('fr_wire_t1', 'im01_wire_u1')
                        && c('tc_wire_s2', 'sb_wire_nc3')
                        && c('sb_wire_nc4', 'ss_wire_no1')
                        && c('ss_wire_no2', 'km1-coil_wire_a1');
                },
            },
            { msg: '第 2 步：识别接触器线圈 KM1。', mode: 'find', target: 'km1-coil' },
            { msg: '第 3 步：识别接触器主触头 KM1。', mode: 'find', target: 'km1-mc' },
            { msg: '第 4 步：识别接触器常开辅助触头 KM1（自锁）。', mode: 'find', target: 'km1-no1' },
            { msg: '第 5 步：识别接触器常闭辅助触头 KM1。', mode: 'find', target: 'km1-nc' },
            { msg: '第 6 步：识别断路器（空气开关）QF。', mode: 'find', target: 'acb' },
            { msg: '第 7 步：识别熔断器 FU4、FU5（任选其一）。', mode: 'find', target: ['fu4', 'fu5'] },
            { msg: '第 8 步：识别热继电器发热元件 FR。', mode: 'find', target: 'fr' },
            { msg: '第 9 步：识别热继电器常闭触头 FR。', mode: 'find', target: 'fr-nc' },
            { msg: '第 10 步：识别时间继电器线圈 KT1。', mode: 'find', target: 'kt-coil' },
            { msg: '第 11 步：识别起动按钮 SB2（常开）。', mode: 'find', target: 'ss' },
            { msg: '第 12 步：识别停止按钮 SB1（常闭）。', mode: 'find', target: 'sb' },
            { msg: '第 13 步：识别控制变压器 TC。', mode: 'find', target: 'tc' },
            {
                msg: '第 14 步：测试题——控制变压器的作用。',
                mode: 'quiz',
                quizConfig: {
                    question: '在电动机连续控制线路中，控制变压器 TC 的主要作用是（　）。',
                    options: [
                        '把 380V 降到 220V 供控制回路，并把控制回路与主电路隔离',
                        '把交流电变成直流电供接触器线圈使用',
                        '提高控制回路电压，使接触器吸合更可靠',
                        '限制电动机的起动电流',
                    ],
                    answer: 0,
                    analysis: '一次侧接 380V 主电路、二次侧输出 220V，降低按钮与线圈的对地电压，同时使控制回路与主电路电气隔离。',
                },
            },
        ],
    },
    'logic-explained': {        id: 'logic-explained', name: '2.解释控制逻辑关系',
        steps: [
            {
                msg: '第 1 步：按图接线，合上断路器 QF。',
                mode: 'check',
                op: [
                    {
                        type: 'observe', target: 'ac',
                        msg: '按图接线（主回路 + 控制回路）',
                        async act() {
                            const sys = _sysOf(this);
                            sys.conns.length = 0;
                            _autoWire(sys);
                            await _sleep(800);
                        },
                    },
                    {
                        type: 'switch', target: 'acb', part: 'handle',
                        msg: '点击断路器触头，合上 QF',
                        async act() {
                            const sys = _sysOf(this);
                            await _ensureAcb(sys, true);
                            await _sleep(900);
                        },
                    },
                ],
                check() {
                    const sys = _sysOf(this);
                    const c = (a, b) => sys.isPortConnected(a, b);
                    const acb = _comp(sys, 'acb');
                    return c('ac_wire_u', 'acb_wire_l1')
                        && c('acb_wire_t1', 'km1-mc_wire_l1')
                        && c('km1-mc_wire_t3', 'fr_wire_l3')
                        && c('fr_wire_t1', 'im01_wire_u1')
                        && c('tc_wire_s2', 'sb_wire_nc3')
                        && c('sb_wire_nc4', 'ss_wire_no1')
                        && c('ss_wire_no2', 'km1-coil_wire_a1')
                        && acb && acb.getState() === 'on';
                },
            },
            {
                msg: '第 2 步：按下起动按钮 SB2，观察线圈得电、主触头闭合、常开触头自锁。',
                mode: 'check',
                op: [
                    {
                        type: 'btn', target: 'ss', part: 'btn',
                        msg: '按住 SB2 起动',
                        async act() {
                            const sys = _sysOf(this);
                            await _pressBtn(sys, 'ss', 800);
                            await _sleep(1200);
                        },
                    },
                    {
                        type: 'observe', target: 'km1-mc',
                        msg: '松开 SB2，观察接触器保持吸合（自锁）',
                        async act() {
                            const sys = _sysOf(this);
                            await _waitFor(sys, x => {
                                const coil = _comp(x, 'km1-coil');
                                return !!(coil && coil.deviceRef && coil.deviceRef.isPickup());
                            }, 8000, 200);
                            await _sleep(1500);
                        },
                    },
                ],
                check() {
                    const sys = _sysOf(this);
                    const coil = _comp(sys, 'km1-coil');
                    const mc = _comp(sys, 'km1-mc');
                    const no1 = _comp(sys, 'km1-no1');
                    return coil && coil.deviceRef && coil.deviceRef.isPickup()
                        && mc && mc.deviceRef && mc.deviceRef.getContactClosed()
                        && no1 && no1.deviceRef && no1.deviceRef.getContactClosed();
                },
            },
            {
                msg: '第 3 步：按下停止按钮 SB1，观察线圈失电、触头全部复位。',
                mode: 'check',
                op: [
                    {
                        type: 'btn', target: 'sb', part: 'btn',
                        msg: '按住 SB1 停止',
                        async act() {
                            const sys = _sysOf(this);
                            await _pressBtn(sys, 'sb', 800);
                            await _sleep(1200);
                        },
                    },
                    {
                        type: 'observe', target: 'km1-mc',
                        msg: '观察主触头与自锁触头断开、电动机停转',
                        async act() {
                            const sys = _sysOf(this);
                            await _waitFor(sys, x => {
                                const coil = _comp(x, 'km1-coil');
                                return !!(coil && coil.deviceRef && !coil.deviceRef.isPickup());
                            }, 8000, 200);
                            await _sleep(1500);
                        },
                    },
                ],
                check() {
                    const sys = _sysOf(this);
                    const coil = _comp(sys, 'km1-coil');
                    const mc = _comp(sys, 'km1-mc');
                    const no1 = _comp(sys, 'km1-no1');
                    return coil && coil.deviceRef && !coil.deviceRef.isPickup()
                        && mc && mc.deviceRef && !mc.deviceRef.getContactClosed()
                        && no1 && no1.deviceRef && !no1.deviceRef.getContactClosed();
                },
            },
            { msg: '第 4 步：识别接触器常开辅助触头 KM1。', mode: 'find', target: 'km1-no1' },
            { msg: '第 5 步：识别接触器常闭辅助触头 KM1。', mode: 'find', target: 'km1-nc' },
            {
                msg: '第 6 步：测试题——主电路与控制电路的逻辑关系。',
                mode: 'quiz',
                quizConfig: {
                    question: '在电机连续控制电路中，主电路与控制电路的逻辑关系是（　）。',
                    options: [
                        '主电路与控制电路相互独立，无任何联系',
                        '控制电路通过接触器线圈控制主触头通断，以弱电控制强电',
                        '主电路直接控制接触器线圈的得电与失电',
                        '控制电路必须先断电，主电路才能工作',
                    ],
                    answer: 1,
                    analysis: '按钮与线圈串联组成控制电路，线圈得电/失电带动主触头通断主电路，实现以小控大。',
                },
            },
        ],
    },
    'panel-parts': {
        id: 'panel-parts', name: '3.电机控制箱实物识别',
        steps: [
            { msg: '第 1 步：识别控制箱中的空气开关。', mode: 'find', target: 'starter-panel', subTarget: 'cell-acb' },
            { msg: '第 2 步：识别控制箱中的接触器。', mode: 'find', target: 'starter-panel', subTarget: 'cell-contact' },
            { msg: '第 3 步：识别控制箱中的热继电器。', mode: 'find', target: 'starter-panel', subTarget: 'cell-fr' },
            { msg: '第 4 步：识别控制箱上的起动按钮（绿色）。', mode: 'find', target: 'starter-panel', subTarget: 'cell-start' },
            { msg: '第 5 步：识别控制箱上的停止按钮（红色）。', mode: 'find', target: 'starter-panel', subTarget: 'cell-stop' },
            { msg: '第 6 步：识别控制箱中的熔断器。', mode: 'find', target: 'starter-panel', subTarget: 'cell-fuse' },
            { msg: '第 7 步：识别控制箱中的时间继电器。', mode: 'find', target: 'starter-panel', subTarget: 'cell-timer' },
            {
                msg: '第 8 步：测量接触器线圈电压（交流 500V 档，约 220V）。',
                mode: 'check',
                op: [
                    {
                        type: 'observe', target: 'ac',
                        msg: '按图接线',
                        async act() {
                            const sys = _sysOf(this);
                            sys.conns.length = 0;
                            _autoWire(sys);
                            await _sleep(800);
                        },
                    },
                    {
                        type: 'switch', target: 'acb', part: 'handle',
                        msg: '合上 QF',
                        async act() {
                            const sys = _sysOf(this);
                            await _ensureAcb(sys, true);
                            await _sleep(800);
                        },
                    },
                    {
                        type: 'btn', target: 'ss', part: 'btn',
                        msg: '按住 SB2，保持线圈得电',
                        async act() {
                            const sys = _sysOf(this);
                            _holdBtn(sys, 'ss');
                            await _waitFor(sys, x => {
                                const coil = _comp(x, 'km1-coil');
                                return !!(coil && coil.deviceRef && coil.deviceRef.isPickup());
                            }, 8000, 200);
                            await _sleep(800);
                        },
                    },
                    {
                        type: 'instrument', instrument: 'multimeter', target: 'multimeter',
                        msg: '选择仪表：数字万用表，切到 ACV500 档',
                        async act() {
                            const sys = _sysOf(this);
                            const mm = _comp(sys, 'multimeter');
                            if (mm) {
                                mm.mode = 'ACV500';
                                if (mm._updateAngleByMode) mm._updateAngleByMode();
                                if (mm.group) mm.group.visible(true);
                                if (mm.update) mm.update(0);
                            }
                            await _sleep(400);
                        },
                    },
                    {
                        type: 'observe', target: 'multimeter', ports: ['multimeter_wire_v', 'km1-coil_wire_a2'],
                        msg: '红表笔接 A2、黑表笔接 A1（动画接线）',
                        async act() {
                            await _probeAnimated(_sysOf(this), 'km1-coil_wire_a2', 'km1-coil_wire_a1');
                        },
                    },
                    {
                        type: 'observe', target: 'multimeter',
                        msg: '读数约 220V，读完松开 SB2',
                        async act() {
                            const sys = _sysOf(this);
                            const ok = await _waitFor(x => {
                                const m = _comp(x, 'multimeter');
                                const v = m ? Math.abs(m.value || 0) : 0;
                                return v > 100 && v < 1000;
                            }, 10000, 200);
                            if (ok) this._s8Volt = true;   // 记录本轮确实测到（松开按钮后读数会消失）
                            await _sleep(2000);
                            _releaseBtn(sys, 'ss');
                            await _sleep(400);
                        },
                    },
                ],
                check() {
                    const sys = _sysOf(this);
                    const mm = _comp(sys, 'multimeter');
                    if (!mm || !mm.group || !mm.group.visible()) return false;
                    const c = (a, b) => sys.isPortConnected(a, b);
                    if (!(c('multimeter_wire_v', 'km1-coil_wire_a2') && c('multimeter_wire_com', 'km1-coil_wire_a1'))) return false;
                    if (!(mm.mode || '').startsWith('ACV')) return false;
                    if (this._s8Volt) return true;
                    const v = Math.abs(mm.value || 0);
                    return v > 100 && v < 1000;
                },
            },
        ],
    },
};

export const componentConfigs = [
    { Class: DiagramACPower3P, id: 'ac', x: 80, y: 30, vRms: 220, freq: 50, isOn: true, phaseSeq: 'pos', visible: true },
    { Class: DiagramThreePhaseACB, id: 'acb', x: 80, y: 140, height: 105, initState: 'off', label: 'QF', ratedVoltage: 380, ratedCurrent: 100, tripCurrent: 10, visible: true },
    { Class: MainContact, id: 'km1-mc', x: 70, y: 350, height: 105, deviceid: 'KM1', visible: true },
    { Class: ThermalHeatElement, id: 'fr', x: 70, y: 540, height: 100, deviceid: 'FR1', ratedCurrent: 100, tripClass: 20, visible: true },
    { Class: InductionMotor2, id: 'im01', x: 40, y: 700, visible: true,
        R1: 0.50, Lsigma1: 0.00334, Rc: 300, Lm: 0.0796,
        R2: 0.46, Lsigma2: 0.00334,
        J: 0.12, B: 0.01, polePairs: 2,
        ratedPower: 10, ratedSpeed: 1440,
        simpleModel: true, loadTorque: 20 },

    // 控制回路：熔断器 → 控制变压器 → 停止按钮 → 起动按钮 → 线圈 → 熔断器 → 回到变压器
    { Class: SinglePhaseFuse, id: 'fu4', x: 280, y: 150, label: 'FU4', ratedCurrent: 5, rotation: -90, visible: true },
    { Class: ControlTransformer, id: 'tc', x: 420, y: 110, primaryVoltage: 380, secondaryVoltage: 220, visible: true },
    { Class: SinglePhaseFuse, id: 'fu5', x: 580, y: 160, label: 'FU5', ratedCurrent: 5, rotation: -90, visible: true },
    { Class: DiagramStopButton, id: 'sb', x: 580, y: 200, visible: true ,label:'SB1'},
    { Class: DiagramStartButton, id: 'ss', x: 780, y: 200, visible: true ,label:'SB2'},
    { Class: AuxNOContact, id: 'km1-no1', x: 780, y: 350, deviceid: 'KM1', visible: true },
    { Class: ContactorCoil, id: 'km1-coil', x: 980, y: 200, deviceid: 'KM1', visible: true },
    { Class: ThermalNCContact, id: 'fr-nc', x: 950, y: 100, deviceid: 'FR1', visible: true },

    { Class: TsCurveDisplay, id: 'ts-curve', x: 1150, y: 100, visible: false, quadrants: 1 },
    { Class: Multimeter, id: 'multimeter', x: 880, y: 440, visible: false },    
    { Class: MF47Multimeter, id: 'mf47-panel', x: 1050, y: 180, visible: false },
    { Class: Oscilloscope_tri, id: 'osc', x: 50, y: 50, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 50, y: 50, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 50, y: 50, visible: false },
    { Class: ElecMeter, id: 'elecmeter', x: 50, y: 50, visible: false },
    { Class: RealMegohmMeter, id: 'megohm', x: 50, y: 50, visible: false },

    // 电机起动控制箱（实物图片展示，用于考核点击识别设备）
    { Class: MotorStarterPanel, id: 'starter-panel', x: 1180, y: 20, visible: true },

    // 接触器常闭辅助触点 + 时间继电器（位于电机右侧）
    { Class: AuxNCContact, id: 'km1-nc', x: 300, y: 700, deviceid: 'KM1', visible: true },
    { Class: TimeRelayCoil, id: 'kt-coil', x: 470, y: 700, deviceid: 'KT1', label: 'KT1', delayTime: 5, visible: true },
    { Class: TimeDelayNOContact, id: 'kt-no', x: 300, y: 820, deviceid: 'KT1', label: 'KT1', visible: true },
    { Class: TimeDelayNCContact, id: 'kt-nc', x: 470, y: 820, deviceid: 'KT1', label: 'KT1', visible: true },
];

// ─── 接线辅助 ───

function _autoWire(sys) {
    sys.conns.length = 0;
    const cons = [
        // 主回路：电源 → 断路器 → 接触器主触头 → 热继电器发热元件 → 电动机
        { from: 'ac_wire_u', to: 'acb_wire_l1', type: 'wire' },
        { from: 'ac_wire_v', to: 'acb_wire_l2', type: 'wire' },
        { from: 'ac_wire_w', to: 'acb_wire_l3', type: 'wire' },
        { from: 'acb_wire_t1', to: 'km1-mc_wire_l1', type: 'wire' },
        { from: 'acb_wire_t2', to: 'km1-mc_wire_l2', type: 'wire' },
        { from: 'acb_wire_t3', to: 'km1-mc_wire_l3', type: 'wire' },
        { from: 'km1-mc_wire_t1', to: 'fr_wire_l1', type: 'wire' },
        { from: 'km1-mc_wire_t2', to: 'fr_wire_l2', type: 'wire' },
        { from: 'km1-mc_wire_t3', to: 'fr_wire_l3', type: 'wire' },
        { from: 'fr_wire_t1', to: 'im01_wire_u1', type: 'wire' },
        { from: 'fr_wire_t2', to: 'im01_wire_v1', type: 'wire' },
        { from: 'fr_wire_t3', to: 'im01_wire_w1', type: 'wire' },
        { from: 'im01_wire_u2', to: 'im01_wire_v2', type: 'wire' },
        { from: 'im01_wire_v2', to: 'im01_wire_w2', type: 'wire' },
        // 控制回路：L3 → FU4 → 变压器一次侧 → 经接触器主触头 → L2
        { from: 'acb_wire_t3', to: 'fu4_wire_l', type: 'wire' },
        { from: 'fu4_wire_t', to: 'tc_wire_p1', type: 'wire' },
        { from: 'km1-mc_wire_l2', to: 'tc_wire_p2', type: 'wire' },
        // 控制回路：变压器副边下端(s2) → 停止按钮 → [起动按钮 ∥ 常开触点] → 线圈 → FU5 → 副边上端(s1)
        { from: 'tc_wire_s2',  to: 'sb_wire_nc3', type: 'wire' },
        // 停止按钮输出 → 并联支路
        { from: 'sb_wire_nc4', to: 'ss_wire_no1', type: 'wire' },
        { from: 'sb_wire_nc4', to: 'km1-no1_wire_com', type: 'wire' },
        // 并联支路汇合 → 线圈
        { from: 'ss_wire_no2', to: 'km1-coil_wire_a1', type: 'wire' },
        { from: 'km1-no1_wire_no', to: 'ss_wire_no2', type: 'wire' },
        // 线圈 → 热继电器常闭触点 → FU5 → 副边上端
        { from: 'km1-coil_wire_a2', to: 'fr-nc_wire_nc', type: 'wire' },
        { from: 'fr-nc_wire_com', to: 'fu5_wire_t', type: 'wire' },
        { from: 'fu5_wire_l', to: 'tc_wire_s1', type: 'wire' },
    ];
    cons.forEach(c => sys.connMgr.addConn(c));
    sys.redrawAll();
}

/** 万用表表笔动画接线：先清掉旧表笔线，再逐根动画接红/黑表笔（≤8 根必须用动画接线） */
async function _probeAnimated(sys, redPort, blackPort) {
    sys.conns = sys.conns.filter(c => !(String(c.from).startsWith('multimeter') || String(c.to).startsWith('multimeter')));
    sys.redrawAll();
    await sys.connMgr.addConnectionAnimated({ from: 'multimeter_wire_v', to: redPort, type: 'wire' });
    await sys.connMgr.addConnectionAnimated({ from: 'multimeter_wire_com', to: blackPort, type: 'wire' });
    await _sleep(1200);
}

// ═══════════════════════════════════════════════════════════════
// 工具栏快捷操作
// ═══════════════════════════════════════════════════════════════

export function initSlider(sys) {
    const s = sys || (typeof window !== 'undefined' ? window.sys : null);
    if (!s) return;
    // 自动演示时只保留箭头指示与部件高亮，不闪亮整个组件（平台约定）
    s._noBlinkHighlight = true;
}

export function applyAllPresets(opts) {
    // 平台约定：系统初始化时（opts.init）不做任何预接线，
    // 只有工具栏「自动接线」、「起动系统」或工作流 op.act 才按需接线。
    if (opts && opts.init) return;
    const sys = _sysOf(this);
    if (!sys) return;
    _autoWire(sys);
}

export async function applyStartSystem() {
    const sys = _sysOf(this);
    if (!sys) return;
    _autoWire(sys);
    await _sleep(600);
    await _ensureAcb(sys, true);
    if (sys.redrawAll) sys.redrawAll();
}

/** 5 点步进：接线 → 合闸 → 起动 → 停止 → 分闸（每次点击前进一步） */
export async function fiveStep() {
    const sys = _sysOf(this);
    if (!sys) return;
    if (sys._fiveStepIdx === undefined) sys._fiveStepIdx = 0;
    const idx = sys._fiveStepIdx % 5;
    sys._fiveStepIdx = idx + 1;
    switch (idx) {
        case 0: _autoWire(sys); break;                       // ① 按图接线
        case 1: await _ensureAcb(sys, true); break;           // ② 合上 QF
        case 2: await _pressBtn(sys, 'ss', 700); break;       // ③ 按 SB2 起动
        case 3: await _pressBtn(sys, 'sb', 700); break;       // ④ 按 SB1 停止
        case 4: await _ensureAcb(sys, false); break;          // ⑤ 断开 QF
    }
    if (sys.redrawAll) sys.redrawAll();
}
