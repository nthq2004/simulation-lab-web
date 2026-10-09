// 电动三速锚机（可变极三相异步电动机）仿真工程
// 参照船用三速锚机控制原理图：主回路（左）+ 控制回路（右）+ 主令控制器（右上）
//
// ─── 主回路 ──────────────────────────────────────────────────────────────
//  AC380V(A/B/C) → Q → 1LH/2LH 电流互感器 → [ZC 正转 ∥ FC 反转] → 公共母线
//    ├ 低速：1KR（热继电器）→ 1C → 电机 16D1/2/3（16 极）
//    ├ 中速：2KR（热继电器）→ 2C1 → 电机 8D1/2/3（8 极）；2C2 短接 16D
//    └ 高速：3C → 电机 4D1/2/3（4 极）
//  1LH 副边 → 电流表 A；2LH 副边 → GLJ 过流继电器取样元件
//
// ─── 控制回路 ────────────────────────────────────────────────────────────
//  控制电源：Q.T1 → 1RD → 控制相线 CL；Q.T2 → 2RD → 控制回线 CN
//  控制变压器 TM（原边并接 R1-C1 阻容保护）→ 副边 → KZ 桥式整流 → 直流 DCP/DCN
//  零压继电器 LYJ：CL → Rf → 1KR-NC → 2KR-NC → DJ-NC → AN → LYJ → CN
//      LYJ 常开触点建立使能母线 BUS_E（失压即释放 → 全停机）
//  零位保护：BUS_E → LK1（零位触点）→ KA0 零位继电器，KA0 常开自锁
//      使能输出母线 NX = KA0 线圈 a1
//  方向：NX → LK2 → FC-NC 互锁 → ZC 线圈；NX → LK3 → ZC-NC 互锁 → FC 线圈
//  速度允许：NX → (ZC-NO ∥ FC-NO) → SPD
//  速度：SPD → LK4 → 1C；SPD → LK5 → 2C1 + 2C2；SPD → LK6 → 1SJ 延时 → 3C
//  制动：NX → LK7 → ZDC 制动接触器 → DCP → R → ZDC-NO → [R3 ∥ 3SJ-NO] → ZDQ → DCN
//        R3 + ZL 为制动器放电回路
//  过流：GLJ-NO → 2SJ（延时）→ DJ 中间继电器（自锁）→ DJ-NC 断开 LYJ → 跳闸闭锁
//  时间继电器：1SJ 高速延时投入；2SJ 过流延时；3SJ 制动强励延时

import { DiagramACPower3P } from '../components/DiagramACPower3P.js';
import { DiagramThreePhaseACB } from '../components/DiagramThreePhaseACB.js';
import { VariablePoleMotor } from '../components/VariablePoleMotor.js';
import { DiagramCurrentTransformer } from '../components/DiagramCurrentTransformer.js';
import { Multimeter } from '../components/Multimeter.js';
import { MF47Multimeter } from '../components/MF47Multimeter.js';
import { Oscilloscope_tri } from '../components/Osc_tri.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';
import { ElecMeter } from '../components/ElecMeter.js';
import { RealMegohmMeter } from '../components/RealMegohmMeter.js';
import { TsCurveDisplay } from '../components/TsCurveDisplay.js';
import { SinglePhaseFuse } from '../components/SinglePhaseFuse.js';
import { DiagramStartButton } from '../components/DiagramStartButton.js';
import { Switch } from '../components/Switch.js';
import { Resistor } from '../components/Resistor.js';
import { Capacitor } from '../components/Capacitor.js';
import { Diode } from '../components/Diode.js';
import { BridgeRectifier } from '../components/BridgeRectifier.js';
import { SmallLamp } from '../components/SmallLamp.js';
import { OverCurrentCoil } from '../device/OverCurrentCoil.js';
import { OverCurrentNOContact } from '../device/OverCurrentNOContact.js';
import { ControlTransformer } from '../device/ControlTransformer.js';
import { MainContact } from '../device/MainContact.js';
import { ContactorCoil } from '../device/ContactorCoil.js';
import { AuxNOContact } from '../device/AuxNOContact.js';
import { AuxNCContact } from '../device/AuxNCContact.js';
import { ThermalHeatElement } from '../device/ThermalHeatElement.js';
import { ThermalNCContact } from '../device/ThermalNCContact.js';
import { BrakeActuator } from '../device/BrakeActuator.js';
import { TimeRelayCoil } from '../device/TimeRelayCoil.js';
import { TimeDelayNOContact } from '../device/TimeDelayNOContact.js';
import { TimeDelayNCContact } from '../device/TimeDelayNCContact.js';
import { MasterController } from '../components/MasterController.js';
import { LKAuxContact } from '../device/LKAuxContact.js';

export const FAULT_CONFIGS = {
    // ── 制动回路故障：ZDQ 电磁制动器线圈断线 ─────────────────────────────
    //  注入方式：置组件 _faultCoilOpen。
    //    · stampContactCoils 按 1e12Ω 注入线圈（等效开路）→ 制动回路无电流；
    //    · BrakeActuator.tick 检测到断线后把线圈电压钳为 0 → 设备判定释放；
    //    · 电机侧抱闸检测到 ZDQ 失电 → 抱闸堵转，锚机始终无法松闸起动。
    zdq_coil_open: {
        id: 'zdq_coil_open',
        name: 'ZDQ线圈断线',
        system: '制动回路',
        check()   { const c = window.sys?.comps?.['zdq']; return !!(c && c._faultCoilOpen); },
        trigger() { const c = window.sys?.comps?.['zdq']; if (c) { c._faultCoilOpen = true;  c.markDirty?.(); } },
        repair()  { const c = window.sys?.comps?.['zdq']; if (c) { c._faultCoilOpen = false; c.markDirty?.(); } },
    },
};

export const PROJECT_WORKFLOWS = {
    'key-components': {
        id: 'key-components',
        name: '1. 认识三速锚机电路的关键元器件',
        steps: [
            { mode: 'find', target: 'km1-coil', msg: '1. 正转接触器 ZC：接通起锚（上升）档电源，请点击它的线圈' },
            { mode: 'find', target: 'km2-mc',   msg: '2. 反转接触器 FC：接通抛锚（下降）档电源，请点击它的主触头' },
            { mode: 'find', target: 'c1-coil',  msg: '3. 低速执行元件 1C 接触器：接通 16 极低速绕组，请点击它的线圈' },
            { mode: 'find', target: 'c22-mc',   msg: '4. 双星形短接元件 2C2 接触器：中速时短接 16D1/2/3，请点击它的主触头' },
            { mode: 'find', target: 'c21-coil', msg: '5. 中速执行元件 2C1 接触器：接通 8 极中速绕组，请点击它的线圈' },
            { mode: 'find', target: 'c3-coil',  msg: '6. 高速执行元件 3C 接触器：接通 4 极高速绕组，请点击它的线圈' },
            { mode: 'find', target: 'master', subTarget: 'handle', msg: '7. 主令控制部件：主令控制器（7 档直推手柄），请点击它的手柄' },
            { mode: 'find', target: 'glj-coil', msg: '8. 高速过流检测部件：GLJ 过流继电器，请点击它的测量线圈' },
            { mode: 'find', target: 'dj-nc1',   msg: '9. 高速过流执行部件：DJ 中间继电器，请点击它的常闭触头' },
            { mode: 'find', target: 'fr2',      msg: '10. 中速过载保护部件：2KR 热继电器，请点击它的发热元件' },
            { mode: 'find', target: 'fr-nc',    msg: '11. 低速过载保护器件：1KR 热继电器，请点击它的常闭触头' },
            { mode: 'find', target: 'zdq',      msg: '12. 失电制动部件：ZDQ 电磁制动器，请点击它的线圈' },
            { mode: 'find', target: 'sj1-nc1',  msg: '13. 中高速逐级起动控制部件：1SJ 时间继电器，请点击它的常闭触头' },
            { mode: 'find', target: 'sj2-no1',  msg: '14. 高速起动电流延迟接入监视控制部件：2SJ 时间继电器，请点击它的常开触头' },
            { mode: 'find', target: 'sj3-no1',  msg: '15. 直流电磁铁经济电阻接入控制部件：3SJ 时间继电器，请点击它的常开触头' },
            { mode: 'find', target: 'lyj-no1',  msg: '16. 失压保护和联锁保护关键器件：LYJ 零压继电器，请点击它的常开触头' },
            { mode: 'find', target: 'kz',       msg: '17. 直流电产生关键部件：KZ 桥式整流器，请点击它' },
        ],
    },
};

export const componentConfigs = [
    // ═════════════════════════════════════════════════════════════════════
    // 一、主回路（x 10 ~ 570）
    // ═════════════════════════════════════════════════════════════════════
    { Class: DiagramACPower3P, id: 'ac', x: 250, y: 4, vRms: 220, freq: 50, isOn: true, phaseSeq: 'pos', visible: true },
    { Class: DiagramThreePhaseACB, id: 'acb', x: 260, y: 65, height: 85, initState: 'off', label: 'Q', ratedVoltage: 380, ratedCurrent: 100, tripCurrent: 10, visible: true },

    // 电流互感器 2LH（简化版本，仅用于 GLJ 过流保护取样）
    { Class: DiagramCurrentTransformer, id: 'lh2', x: 480, y: 500, turnsRatio: 20, primaryRated: 100, secondaryRated: 5, rotation: -90, visible: true },
    // 过流继电器 GLJ（复合设备：测量电流的绕组 + 输出触头）
    { Class: OverCurrentCoil, id: 'glj-coil', x: 500, y: 190, deviceid: 'GLJ', ctId: 'lh2',
      ratedCurrent: 75.9, pickupRatio: 0.6, delayTime: 5, senseR: 0.1, visible: true },
    { Class: OverCurrentNOContact, id: 'glj-no1', x: 1115, y: 570, deviceid: 'GLJ', visible: true },

    // 方向接触器：FC（反转，左）| ZC（正转，右）
    { Class: MainContact, id: 'km2-mc', x: 30,  y: 220, height: 85, deviceid: 'FC', visible: true },
    { Class: MainContact, id: 'km1-mc', x: 250, y: 220, height: 85, deviceid: 'ZC', visible: true },

    // 热继电器 1KR（低速）/ 2KR（中速）
    { Class: ThermalHeatElement, id: 'fr', x: 30, y: 400, height: 80, deviceid: '1KR', label: '1KR',
      ratedCurrent: 75.9, tripClass: 20, minTripTime: 4, visible: true },
    { Class: ThermalHeatElement, id: 'fr2', x: 250, y: 400, height: 80, deviceid: '2KR', label: '2KR',
      ratedCurrent: 75.9, tripClass: 20, minTripTime: 4, visible: true },

    // 三速接触器：3C（高速）/ 1C（低速）/ 2C1（中速）/ 2C2（中速短接）
    { Class: MainContact, id: 'c3-mc',  x: 470, y: 550, height: 95, deviceid: '3C',  visible: true },
    { Class: MainContact, id: 'c1-mc',  x: 30,  y: 550, height: 95, deviceid: '1C',  visible: true },
    { Class: MainContact, id: 'c21-mc', x: 250, y: 550, height: 95, deviceid: '2C1', visible: true },
    { Class: MainContact, id: 'c22-mc', x: -10, y: 960, height: 95, deviceid: '2C2', rotation: -90, visible: true },

    // 可变极三相异步电动机
    { Class: VariablePoleMotor, id: 'im01', x: 180, y: 730, visible: true,
      ratedCurrent: 75.9, loadRate: 30, ratedLineVoltage: 380 },

    // ═════════════════════════════════════════════════════════════════════
    // 二、控制电源（x 580 ~ 800）
    // ═════════════════════════════════════════════════════════════════════
    { Class: SinglePhaseFuse, id: 'rd1', x: 600, y: 60,  label: '1RD', ratedCurrent: 5, rotation: -90, visible: true },
    { Class: SinglePhaseFuse, id: 'rd2', x: 600, y: 100, label: '2RD', ratedCurrent: 5, rotation: -90, visible: true },
    { Class: Switch, id: 'lkp', x: 800, y:80, isOn: false, label: 'LK', onLabel: '合', offLabel: '分', visible: true },
    // XD：控制电源指示灯（置于控制开关 LK 右侧）
    { Class: SmallLamp, id: 'xd', x: 960, y: 80, lampColor: 'green', ratedVoltage: 380, resistance: 20000, visible: true },   
    { Class: Resistor, id: 'rf', x: 1390, y: 80, value: 120, visible: true },     
    { Class: ControlTransformer, id: 'tm', x: 850, y: 230, primaryVoltage: 380, secondaryVoltage: 24, rotation:90,visible: true },
    { Class: Resistor, id: 'r1',    x: 730, y: 380, value: 200,  visible: true },
    { Class: Capacitor, id: 'ccap1', x: 830, y: 380, capacitance: 0.47, scale: 0.7, visible: true },
    { Class: BridgeRectifier, id: 'kz', x: 700, y: 460, label: 'ZL', visible: true },
    { Class: Capacitor, id: 'cz', x: 780, y: 650, capacitance: 100, scale: 0.8, visible: true },

    // ═════════════════════════════════════════════════════════════════════
    // 三、控制保护与继电器（x 860 ~ 1120）
    // ═════════════════════════════════════════════════════════════════════

    // AN：常开启动按钮（按下 → LYJ 得电并自锁）
    { Class: DiagramStartButton, id: 'an', x: 1180, y: 150, visible: true, label: 'AN' },
    { Class: ThermalNCContact, id: 'fr-nc',  x: 1090, y: 100, deviceid: '1KR', label: '1KR', visible: true },
    { Class: ThermalNCContact, id: 'fr2-nc', x: 1240, y: 100, deviceid: '2KR', label: '2KR', visible: true },

    // LYJ 零压继电器（复合设备：线圈 + 常开自锁触点）——由原 KA0 改名而来
    { Class: ContactorCoil, id: 'lyj-coil', x: 1390, y: 100, deviceid: 'LYJ', visible: true },
    { Class: AuxNOContact, id: 'lyj-no1', x: 900, y: 100, deviceid: 'LYJ',rotation: 90, visible: true },
    { Class: ContactorCoil, id: 'dj-coil', x: 1390, y: 586, deviceid: 'DJ', visible: true },
    { Class: AuxNCContact, id: 'dj-nc1', x: 1115, y: 475, deviceid: 'DJ', visible: true },
    { Class: AuxNOContact, id: 'dj-no1', x: 1115, y: 525, deviceid: 'DJ', visible: true },    

    // ═════════════════════════════════════════════════════════════════════
    // 四、控制线圈（x 1140 ~ 1360）
    // ═════════════════════════════════════════════════════════════════════
    { Class: AuxNCContact, id: 'km2-nc',  x: 1260, y: 216,  deviceid: 'FC', visible: true },
    { Class: ContactorCoil, id: 'km1-coil', x: 1390, y: 221,  deviceid: 'ZC', visible: true },
    { Class: AuxNCContact, id: 'km1-nc',  x: 1260, y: 267, deviceid: 'ZC', visible: true },
    { Class: ContactorCoil, id: 'km2-coil', x: 1390, y: 272, deviceid: 'FC', visible: true },
    { Class: AuxNOContact, id: 'km1-no1', x: 1230, y: 650, deviceid: 'ZC', visible: true },
    { Class: AuxNOContact, id: 'km2-no1', x: 1230, y: 610, deviceid: 'FC', visible: true },
    { Class: ContactorCoil, id: 'c1-coil',  x: 1390, y: 323, deviceid: '1C',  visible: true },
    // 1C 线圈右侧：3C ,左侧 2C1 / 2C2 常闭触点（低速与中、高速互锁）
    { Class: AuxNCContact, id: 'c3-nc1',  x: 1499, y: 335, deviceid: '3C',  visible: true },
    { Class: AuxNCContact, id: 'c21-nc1', x: 1245, y: 320, deviceid: '2C1', visible: true },
    { Class: AuxNCContact, id: 'c22-nc1', x: 1115, y: 320, deviceid: '2C2', visible: true },

    // 2C1 线圈前面：2C2 常开触点（先短接星点，再投入中速绕组）    
    { Class: ContactorCoil, id: 'c21-coil', x: 1390, y: 373, deviceid: '2C1', visible: true },
    { Class: AuxNCContact, id: 'c1-nc1',  x: 1115, y: 390, deviceid: '1C',  visible: true },    
    { Class: AuxNOContact, id: 'c22-no1', x: 1265, y: 373, deviceid: '2C2', visible: true },
    { Class: ContactorCoil, id: 'c22-coil', x: 1390, y: 424, deviceid: '2C2', visible: true },
    // 3C 线圈
    { Class: AuxNCContact, id: 'c1-nc2',  x: 1499, y: 475, deviceid: '1C',  visible: true }, 
    { Class: ContactorCoil, id: 'c3-coil',  x: 1390, y: 475, deviceid: '3C',  visible: true },
    { Class: AuxNOContact, id: 'c3-no1',  x: 1260, y: 515, deviceid: '3C',  visible: true },

    { Class: ContactorCoil, id: 'zdc-coil', x: 1390, y: 647, deviceid: 'ZDC', visible: true },
    { Class: AuxNOContact, id: 'zdc-no1', x: 1000, y: 880, deviceid: 'ZDC', visible: true },

    // ═════════════════════════════════════════════════════════════════════
    // 五、制动器回路（x 1400 ~ 1660）
    // ═════════════════════════════════════════════════════════════════════
    { Class: Resistor, id: 'rdc', x: 1300, y: 910, value: 50, visible: true },
    { Class: BrakeActuator, id: 'zdq', x: 1399, y:900, deviceid: 'ZDQ', label: 'ZDQ', ratedVoltage: 24, visible: true },
    { Class: Resistor, id: 'r3', x: 1450, y: 975, value: 300, visible: true },
    { Class: Diode, id: 'zl', x: 1580, y: 975, rotation:180,visible: true },

    // ═════════════════════════════════════════════════════════════════════
    // 六、时间继电器（复合设备：线圈与触头分开）
    // ═════════════════════════════════════════════════════════════════════
    // 1SJ：高速延时投入（线圈 + 延时闭合常开触头）
    { Class: TimeRelayCoil, id: 'sj1-coil', x: 1390, y: 708, deviceid: '1SJ', label: '1SJ', mode: 'off', delayTime: 15, ratedVoltage: 24, visible: true },
    // 1SJ 线圈左侧：2C1 常闭触点
    { Class: AuxNCContact, id: 'c21-nc2', x: 1000, y: 708, deviceid: '2C1', visible: true },
    { Class: TimeDelayNCContact, id: 'sj1-nc1', x: 1260, y: 455, deviceid: '1SJ', label: '1SJ', visible: true },
    // 2SJ：过流延时（线圈 + 延时闭合常开触头）
    { Class: TimeRelayCoil, id: 'sj2-coil', x: 1390, y: 768, deviceid: '2SJ', label: '2SJ', mode: 'off', delayTime: 10, ratedVoltage: 24, visible: true },
    // 2SJ 线圈左侧：3C 常闭触点
    { Class: AuxNCContact, id: 'c3-nc2', x: 1000, y: 768, deviceid: '3C', visible: true },
    { Class: TimeDelayNOContact, id: 'sj2-no1', x: 500, y: 255, deviceid: '2SJ', label: '2SJ', rotation: 0,visible: true },
    // 3SJ：制动强励延时（线圈 + 延时闭合常开触头）
    { Class: TimeRelayCoil, id: 'sj3-coil', x: 1390, y: 829, deviceid: '3SJ', label: '3SJ', mode: 'off', delayTime: 5, ratedVoltage: 24, visible: true },
    // 3SJ 线圈左侧：ZDC 常闭触点
    { Class: AuxNCContact, id: 'zdc-nc1', x: 1000, y: 829, deviceid: 'ZDC', visible: true },
    { Class: TimeDelayNOContact, id: 'sj3-no1', x: 1260, y: 930, deviceid: '3SJ', label: '3SJ', visible: true },

    // ═════════════════════════════════════════════════════════════════════
    // 七、主令控制器（x 1540 ~ 1900）
    // ═════════════════════════════════════════════════════════════════════
    { Class: MasterController, id: 'master', x: 1600, y: 30, deviceid: 'LK', label: '主令控制器', initPosition: 3, visible: true },
    { Class: LKAuxContact, id: 'lk1', x: 950, y: 100, deviceid: 'LK', lk: 1, label: 'LK1', visible: true },
    { Class: LKAuxContact, id: 'lk2', x: 950, y: 201, deviceid: 'LK', lk: 2, label: 'LK2', visible: true },
    { Class: LKAuxContact, id: 'lk3', x: 950, y: 262, deviceid: 'LK', lk: 3, label: 'LK3', visible: true },
    { Class: LKAuxContact, id: 'lk4', x: 950, y: 323, deviceid: 'LK', lk: 4, label: 'LK4', visible: true },
    { Class: LKAuxContact, id: 'lk5', x: 950, y: 383, deviceid: 'LK', lk: 5, label: 'LK5', visible: true },
    { Class: LKAuxContact, id: 'lk6', x: 950, y: 475, deviceid: 'LK', lk: 6, label: 'LK6', visible: true },
    { Class: LKAuxContact, id: 'lk7', x: 950, y: 587, deviceid: 'LK', lk: 7, label: 'LK7', visible: true },
    // ═════════════════════════════════════════════════════════════════════
    // 八、仪表（默认隐藏，经工具栏「选择仪表」调出）
    // ═════════════════════════════════════════════════════════════════════
    { Class: Multimeter, id: 'multimeter', x: 460, y: 480, visible: false },
    { Class: MF47Multimeter, id: 'mf47-panel', x: 460, y: 940, visible: false },
    { Class: Oscilloscope_tri, id: 'osc', x: 460, y: 1000, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 460, y: 1060, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 520, y: 880, visible: false },
    { Class: ElecMeter, id: 'elecmeter', x: 520, y: 940, visible: false },
    { Class: RealMegohmMeter, id: 'megohm', x: 520, y: 1000, visible: false },
];

// ─── 接线辅助 ───

function _autoWire(sys) {
    sys.conns.length = 0;
    const W = (from, to) => ({ from, to, type: 'wire' });

    const cons = [
        // ══════════════════ 主供电通路 ══════════════════
        W('ac_wire_u', 'acb_wire_l1'),
        W('ac_wire_v', 'acb_wire_l2'),
        W('ac_wire_w', 'acb_wire_l3'),
        W('acb_wire_t1', 'km1-mc_wire_l1'),
        W('acb_wire_t2', 'km1-mc_wire_l2'),
        W('acb_wire_t3', 'km1-mc_wire_l3'),
        // ══════════════════ 反转路径 ══════════════════
        W('acb_wire_t1', 'km2-mc_wire_l2'),
        W('acb_wire_t2', 'km2-mc_wire_l1'),
        W('acb_wire_t3', 'km2-mc_wire_l3'),
        W('km2-mc_wire_t1', 'km1-mc_wire_t1'),
        W('km2-mc_wire_t2', 'km1-mc_wire_t2'),
        W('km2-mc_wire_t3', 'km1-mc_wire_t3'),
        // 低速支路：母线 → 1KR → 1C → 电机 16D
        W('km1-mc_wire_t1', 'fr_wire_l1'),
        W('km1-mc_wire_t2', 'fr_wire_l2'),
        W('km1-mc_wire_t3', 'fr_wire_l3'),
        W('fr_wire_t1', 'c1-mc_wire_l1'),
        W('fr_wire_t2', 'c1-mc_wire_l2'),
        W('fr_wire_t3', 'c1-mc_wire_l3'),
        W('c1-mc_wire_t1', 'im01_wire_16d1'),
        W('c1-mc_wire_t2', 'im01_wire_16d2'),
        W('c1-mc_wire_t3', 'im01_wire_16d3'),
        // 中速支路：母线 → 2KR → 2C1 → 电机 8D；2C2 短接 16D
        W('km1-mc_wire_t1', 'fr2_wire_l1'),
        W('km1-mc_wire_t2', 'fr2_wire_l2'),
        W('km1-mc_wire_t3', 'fr2_wire_l3'),
        W('fr2_wire_t1', 'c21-mc_wire_l1'),
        W('fr2_wire_t2', 'c21-mc_wire_l2'),
        W('fr2_wire_t3', 'c21-mc_wire_l3'),
        W('c21-mc_wire_t1', 'im01_wire_8d1'),
        W('c21-mc_wire_t2', 'im01_wire_8d2'),
        W('c21-mc_wire_t3', 'im01_wire_8d3'),

        W('c22-mc_wire_t1', 'im01_wire_16d1'),
        W('c22-mc_wire_t2', 'im01_wire_16d2'),
        W('c22-mc_wire_t3', 'im01_wire_16d3'),
        W('c22-mc_wire_l1', 'c22-mc_wire_l2'),
        W('c22-mc_wire_l2', 'c22-mc_wire_l3'),                
        // 高速支路：母线 → 3C → 电机 4D；第3根线传入电流互感器2LH
        W('km1-mc_wire_t1', 'c3-mc_wire_l1'),
        W('km1-mc_wire_t2', 'c3-mc_wire_l2'),
        W('km1-mc_wire_t3', 'lh2_wire_p1'),
        W('lh2_wire_p2', 'c3-mc_wire_l3'),
        W('c3-mc_wire_t1', 'im01_wire_4d1'),
        W('c3-mc_wire_t2', 'im01_wire_4d2'),
        W('c3-mc_wire_t3', 'im01_wire_4d3'),
        // 高速过流保护的测量部分：2LH 副边 → 2SJ延时触点→ GLJ 测量绕组
        W('sj2-no1_wire_com', 'glj-coil_wire_a1'),
        W('lh2_wire_s1', 'sj2-no1_wire_com'),        
        W('sj2-no1_wire_no', 'lh2_wire_s2'),
        W('glj-coil_wire_a2', 'sj2-no1_wire_no'),

        // ══════════════════ 电源指示回路 ══════════════════
        // L2（正转接触器入口）→ 2RD → LK（控制开关）→ XD（指示灯）→ Rf（120Ω）→ 1RD → Q.T3
        W('km1-mc_wire_l2', 'rd2_wire_l'),
        W('rd2_wire_t', 'lkp_wire_l'),
        W('lkp_wire_r', 'xd_wire_l'),
        W('xd_wire_r', 'rf_wire_l'),
        W('rf_wire_r', 'rd1_wire_t'),
        W('rd1_wire_l', 'acb_wire_t3'),

        // ══════════════════ 零压继电器（LYJ）回路 ══════════════════
        // 线圈回路：LK → LK1（零位触点）→ 1KR-NC → 2KR-NC → LYJ 线圈 → 120Ω 电阻右端（=1RD.T）
        W('lkp_wire_r', 'lk1_wire_com'),
        W('lk1_wire_no', 'fr-nc_wire_com'),
        W('fr-nc_wire_nc', 'fr2-nc_wire_com'),
        W('fr2-nc_wire_nc', 'lyj-coil_wire_a1'),
        W('lyj-coil_wire_a2', 'rf_wire_r'),
        // 自锁：LK → LYJ 常开触头 → AN 左端（与 1KR-NC 左端同一节点）
        W('lkp_wire_r', 'lyj-no1_wire_com'),
        W('lyj-no1_wire_no', 'an_wire_no1'),
        W('an_wire_no1', 'fr-nc_wire_com'),
        // AN 并接在 1KR-NC、2KR-NC 两端（按下即旁路热继电器常闭）
        W('an_wire_no2', 'fr2-nc_wire_nc'),

        // ══════════════════ 直流供电回路 ══════════════════
        // 控制变压器一次侧：2RD 右端 → TM.P2；LYJ 常开右端（节点 A）→ TM.P1
        W('rd1_wire_t', 'tm_wire_p2'),
        W('lyj-no1_wire_no', 'tm_wire_p1'),
        // 变压器副边：s2 → 200Ω(R1) → 470nF(C1) → s1
        W('tm_wire_s2', 'r1_wire_l'),
        W('r1_wire_r', 'ccap1_wire_l'),
        W('ccap1_wire_r', 'tm_wire_s1'),
        // 整流器交流侧：200Ω 左端 → KZ.ac1（左）；470nF 右端 → KZ.ac2（右）
        W('r1_wire_l', 'kz_wire_ac1'),
        W('ccap1_wire_r', 'kz_wire_ac2'),
        // 整流器直流侧：KZ.pp（上端）→ 10μF(Cz) 左端；KZ.nn（下端）→ Cz 右端
        W('kz_wire_pp', 'cz_wire_l'),
        W('kz_wire_nn', 'cz_wire_r'),

        // ══════════════════ 方向回路 ══════════════════
        // 正转：LYJ 常开右端（节点 A）→ LK2 → FC 常闭 → ZC 线圈 → LYJ 线圈右端（公共返回节点）
        W('lyj-no1_wire_no', 'lk2_wire_com'),
        W('lk2_wire_no', 'km2-nc_wire_com'),
        W('km2-nc_wire_nc', 'km1-coil_wire_a1'),
        W('km1-coil_wire_a2', 'lyj-coil_wire_a2'),
        // 反转：LYJ 常开右端（节点 A）→ LK3 → ZC 常闭 → FC 线圈 → ZC 线圈右端（公共返回节点）
        W('lk2_wire_com', 'lk3_wire_com'),
        W('lk3_wire_no', 'km1-nc_wire_com'),
        W('km1-nc_wire_nc', 'km2-coil_wire_a1'),
        W('km2-coil_wire_a2', 'km1-coil_wire_a2'),

        // ══════════════════ 速度回路 ══════════════════
        // 低速：节点 A（=LK3 左端）→ LK4 → 2C2 常闭 → 2C1 常闭 → 1C 线圈 → 3C 常闭 → FC 线圈右端（返回节点）
        W('lyj-no1_wire_no', 'lk4_wire_com'),
        W('lk4_wire_no', 'c22-nc1_wire_com'),
        W('c22-nc1_wire_nc', 'c21-nc1_wire_com'),
        W('c21-nc1_wire_nc', 'c1-coil_wire_a1'),
        W('c1-coil_wire_a2', 'c3-nc1_wire_com'),
        W('c3-nc1_wire_nc', 'km2-coil_wire_a2'),
        // 中速：节点 A（=LK4 左端）→ LK5 → 1C 常闭 → 2C2 常开 → 2C1 线圈 → 1C 线圈右端
        W('lk4_wire_com', 'lk5_wire_com'),
        W('lk5_wire_no', 'c1-nc1_wire_com'),
        W('c1-nc1_wire_nc', 'c22-no1_wire_com'),
        W('c22-no1_wire_no', 'c21-coil_wire_a1'),
        W('c21-coil_wire_a2', 'c1-coil_wire_a2'),
        // 1C 常闭右端 → 2C2 线圈 → 2C1 线圈右端
        W('c1-nc1_wire_nc', 'c22-coil_wire_a1'),
        W('c22-coil_wire_a2', 'c21-coil_wire_a2'),
        // 高速：节点 A（=LK5 左端）→ LK6 → DJ 常闭 → 1SJ 常闭 → 3C 线圈 → 1C 常闭 → 3C 常闭右端
        W('lk5_wire_com', 'lk6_wire_com'),
        W('lk6_wire_no', 'dj-nc1_wire_com'),
        W('dj-nc1_wire_nc', 'sj1-nc1_wire_com'),
        W('sj1-nc1_wire_nc', 'c3-coil_wire_a1'),
        W('c3-coil_wire_a2', 'c1-nc2_wire_com'),
        W('c1-nc2_wire_nc', 'c3-nc1_wire_nc'),
        // 3C 常开：左端接 DJ 常闭右端、右端接 3C 线圈左端（3C 自锁）
        W('c3-no1_wire_com', 'dj-nc1_wire_nc'),
        W('c3-no1_wire_no', 'c3-coil_wire_a1'),

        // ══════════════════ 过流保护 DJ 回路 ══════════════════
        // LK6 右端 → GLJ 常开 → DJ 线圈 → 3C 线圈后面那个 1C 常闭（c1-nc2）右端
        W('lk6_wire_no', 'glj-no1_wire_com'),
        W('glj-no1_wire_no', 'dj-coil_wire_a1'),
        W('dj-coil_wire_a2', 'c1-nc2_wire_nc'),
        // DJ 常开与 GLJ 常开并联（两端并接 → DJ 自锁）
        W('dj-no1_wire_com', 'glj-no1_wire_com'),
        W('dj-no1_wire_no', 'glj-no1_wire_no'),

        // ══════════════════ 制动接触器 ZDC 线圈回路 ══════════════════
        // LK6 左端（节点 A）→ LK7 → (ZC 常开 ∥ FC 常开) → ZDC 线圈 → DJ 线圈右端（返回节点）
        W('lk6_wire_com', 'lk7_wire_com'),
        W('lk7_wire_no', 'km2-no1_wire_com'),
        W('km2-no1_wire_no', 'zdc-coil_wire_a1'),
        // ZC 常开与 FC 常开并联
        W('lk7_wire_no', 'km1-no1_wire_com'),
        W('km1-no1_wire_no', 'zdc-coil_wire_a1'),
        W('zdc-coil_wire_a2', 'dj-coil_wire_a2'),

        // ══════════════════ 时间继电器回路（KZ 直流侧供电）══════════════════
        // 1SJ：10μF(Cz) 左端(DC+) → 2C1 常闭 → 1SJ 线圈 → Cz 右端(DC−)
        W('c3-nc2_wire_com', 'c21-nc2_wire_com'),
        W('c21-nc2_wire_nc', 'sj1-coil_wire_a1'),
        W('sj1-coil_wire_a2', 'cz_wire_r'),
        // 2SJ：10μF 左端(DC+) → 3C 常闭 → 2SJ 线圈 → 1SJ 线圈右端
        W('zdc-nc1_wire_com', 'c3-nc2_wire_com'),
        W('c3-nc2_wire_nc', 'sj2-coil_wire_a1'),
        W('sj2-coil_wire_a2', 'sj1-coil_wire_a2'),
        // 3SJ：10μF 左端(DC+) → ZDC 常闭 → 3SJ 线圈 → 2SJ 线圈右端
        W('zdc-no1_wire_com', 'zdc-nc1_wire_com'),
        W('zdc-nc1_wire_nc', 'sj3-coil_wire_a1'),
        W('sj3-coil_wire_a2', 'sj2-coil_wire_a2'),

        // ══════════════════ 制动器回路 ══════════════════
        // DC+ → ZDC 常开 → 50Ω(Rdc) → ZDQ 线圈 → 3SJ 线圈右端（直流回线）
        W('cz_wire_l', 'zdc-no1_wire_com'),
        W('zdc-no1_wire_no', 'rdc_wire_l'),
        W('rdc_wire_r', 'zdq_wire_a1'),
        W('zdq_wire_a2', 'sj3-coil_wire_a2'),
        // 3SJ 常开与 50Ω 电阻并联（延时短接限流电阻 → 制动强励）
        W('rdc_wire_l', 'sj3-no1_wire_com'),
        W('sj3-no1_wire_no', 'rdc_wire_r'),
        // 300Ω(R3) 与二极管(ZL) 串联后并接在 ZDQ 线圈两端（放电回路，二极管反向截止）
        W('zdq_wire_a1', 'r3_wire_l'),
        W('r3_wire_r', 'zl_wire_r'),
        W('zl_wire_l', 'zdq_wire_a2'),
    ];
    cons.forEach(c => sys.connMgr.addConn(c));
    sys.redrawAll();
}

function _powerOn(sys) {
    // 合上电源开关 Q 与控制开关 LK
    const acb = sys.comps['acb'];
    if (acb) acb.close();
    const lkp = sys.comps['lkp'];
    if (lkp && typeof lkp.toggle === 'function' && !lkp.isOn) lkp.toggle();
}

/**
 * 用动画方式接万用表表笔（两根，逐根 ~3s）。
 * 先清除万用表已有的表笔接线，再逐根动画接上。
 * @param {object} sys ControlSystem 实例
 * @param {string} redPort   红表笔接的端口
 * @param {string} blackPort 黑表笔接的端口
 */
async function _probeAnimated(sys, redPort, blackPort) {
    // 清除万用表旧连线（瞬时，不影响动画演示的观感）
    sys.conns = sys.conns.filter(c => !(String(c.from).startsWith('multimeter') || String(c.to).startsWith('multimeter')));
    sys.redrawAll();
    // 逐根动画接线（万用表表笔各 1 根，共 2 根，符合 ≤8 根用动画的要求）
    await sys.connMgr.addConnectionAnimated({ from: 'multimeter_wire_v', to: redPort, type: 'wire' });
    await sys.connMgr.addConnectionAnimated({ from: 'multimeter_wire_com', to: blackPort, type: 'wire' });
    await new Promise(r => setTimeout(r, 1200));
}

// ─── 操作流程 2：控制电路接线（每根线均用动画接入，不受"≤8 根"约定限制）───

const _hasConn = (sys, from, to) => !!sys && sys.conns.some(c =>
    (c.from === from && c.to === to) || (c.from === to && c.to === from));
const _allConn = (sys, pairs) => pairs.every(([f, t]) => _hasConn(sys, f, t));
const _sysOf = (ctx) => (ctx && ctx.sys) ? ctx.sys : (typeof window !== 'undefined' ? window.sys : null);

/** 逐根动画接线：每根线先闪烁箭头指向目标组件，再以动画接上（约 3s/根） */
async function _wireSeq(wf, pairs) {
    const sys = _sysOf(wf);
    if (!sys) return;
    for (const [from, to] of pairs) {
        if (_hasConn(sys, from, to)) continue;
        const compId = String(to).split('_wire_')[0];
        const comp = sys.comps[compId];
        if (comp && comp.group && typeof wf._flashArrow === 'function') {
            try {
                // 用绝对变换把"组件局部中心"换算到画布坐标，正确处理旋转/缩放组件
                const w = comp.width || 0, h = comp.height || 0;
                const c = comp.group.getAbsoluteTransform().point({ x: w / 2, y: h / 2 });
                await wf._flashArrow({ x: c.x, y: c.y }, { on: 400, off: 300, times: 2 });
            } catch (e) { /* 箭头失败不影响接线 */ }
        }
        await sys.connMgr.addConnectionAnimated({ from, to, type: 'wire' });
    }
}

// 各接线步骤：[目标组件, 步骤说明, 端口对列表]
const WIRING_GROUPS = [
    ['acb', '1. 从电源接到空气开关，再接到正转接触器主触头的入口。', [
        ['ac_wire_u', 'acb_wire_l1'], ['ac_wire_v', 'acb_wire_l2'], ['ac_wire_w', 'acb_wire_l3'],
        ['acb_wire_t1', 'km1-mc_wire_l1'], ['acb_wire_t2', 'km1-mc_wire_l2'], ['acb_wire_t3', 'km1-mc_wire_l3'],
    ]],
    ['km2-mc', '2. 空气开关出线接到反转接触器主触头的入口（调换 2 根线序），出口与正转接触器主触头的出口对应相连。', [
        ['acb_wire_t1', 'km2-mc_wire_l2'], ['acb_wire_t2', 'km2-mc_wire_l1'], ['acb_wire_t3', 'km2-mc_wire_l3'],
        ['km2-mc_wire_t1', 'km1-mc_wire_t1'], ['km2-mc_wire_t2', 'km1-mc_wire_t2'], ['km2-mc_wire_t3', 'km1-mc_wire_t3'],
    ]],
    ['fr', '3. 接通低速支路：正/反转接触器主触头出口 → 1KR → 1C → 电机 16D。', [
        ['km1-mc_wire_t1', 'fr_wire_l1'], ['km1-mc_wire_t2', 'fr_wire_l2'], ['km1-mc_wire_t3', 'fr_wire_l3'],
        ['fr_wire_t1', 'c1-mc_wire_l1'], ['fr_wire_t2', 'c1-mc_wire_l2'], ['fr_wire_t3', 'c1-mc_wire_l3'],
        ['c1-mc_wire_t1', 'im01_wire_16d1'], ['c1-mc_wire_t2', 'im01_wire_16d2'], ['c1-mc_wire_t3', 'im01_wire_16d3'],
    ]],
    ['fr2', '4. 接通中速支路：母线 → 2KR → 2C1 → 电机 8D；2C2 短接 16D。', [
        ['km1-mc_wire_t1', 'fr2_wire_l1'], ['km1-mc_wire_t2', 'fr2_wire_l2'], ['km1-mc_wire_t3', 'fr2_wire_l3'],
        ['fr2_wire_t1', 'c21-mc_wire_l1'], ['fr2_wire_t2', 'c21-mc_wire_l2'], ['fr2_wire_t3', 'c21-mc_wire_l3'],
        ['c21-mc_wire_t1', 'im01_wire_8d1'], ['c21-mc_wire_t2', 'im01_wire_8d2'], ['c21-mc_wire_t3', 'im01_wire_8d3'],
        ['c22-mc_wire_t1', 'im01_wire_16d1'], ['c22-mc_wire_t2', 'im01_wire_16d2'], ['c22-mc_wire_t3', 'im01_wire_16d3'],
        ['c22-mc_wire_l1', 'c22-mc_wire_l2'], ['c22-mc_wire_l2', 'c22-mc_wire_l3'],
    ]],
    ['c3-mc', '5. 接通高速支路：母线 → 3C → 电机 4D；第 3 根线串入电流互感器 2LH。', [
        ['km1-mc_wire_t1', 'c3-mc_wire_l1'], ['km1-mc_wire_t2', 'c3-mc_wire_l2'],
        ['km1-mc_wire_t3', 'lh2_wire_p1'], ['lh2_wire_p2', 'c3-mc_wire_l3'],
        ['c3-mc_wire_t1', 'im01_wire_4d1'], ['c3-mc_wire_t2', 'im01_wire_4d2'], ['c3-mc_wire_t3', 'im01_wire_4d3'],
    ]],
    ['glj-coil', '6. 接通高速过流保护的测量部分：2LH 副边 → 2SJ 延时触点 → GLJ 测量绕组。', [
        ['lh2_wire_s1', 'sj2-no1_wire_com'], ['sj2-no1_wire_com', 'glj-coil_wire_a1'],
        ['sj2-no1_wire_no', 'lh2_wire_s2'], ['glj-coil_wire_a2', 'sj2-no1_wire_no'],
    ]],
    ['xd', '7. 接通控制电源指示回路：L2 → 2RD → LK → XD → Rf(120Ω) → 1RD → Q.T3。', [
        ['km1-mc_wire_l2', 'rd2_wire_l'], ['rd2_wire_t', 'lkp_wire_l'], ['lkp_wire_r', 'xd_wire_l'],
        ['xd_wire_r', 'rf_wire_l'], ['rf_wire_r', 'rd1_wire_t'], ['rd1_wire_l', 'acb_wire_t3'],
    ]],
    ['lyj-coil', '8. 接通零压继电器（LYJ）回路（含自锁与应急按钮部分）。', [
        ['lkp_wire_r', 'lk1_wire_com'], ['lk1_wire_no', 'fr-nc_wire_com'],
        ['fr-nc_wire_nc', 'fr2-nc_wire_com'], ['fr2-nc_wire_nc', 'lyj-coil_wire_a1'],
        ['lyj-coil_wire_a2', 'rf_wire_r'], ['lkp_wire_r', 'lyj-no1_wire_com'],
        ['lyj-no1_wire_no', 'an_wire_no1'], ['an_wire_no1', 'fr-nc_wire_com'],
        ['an_wire_no2', 'fr2-nc_wire_nc'],
    ]],
    ['kz', '9. 接通直流供电回路（变压器一次侧/副边、整流器交流侧与直流侧）。', [
        ['rd1_wire_t', 'tm_wire_p2'], ['lyj-no1_wire_no', 'tm_wire_p1'],
        ['tm_wire_s2', 'r1_wire_l'], ['r1_wire_r', 'ccap1_wire_l'], ['ccap1_wire_r', 'tm_wire_s1'],
        ['r1_wire_l', 'kz_wire_ac1'], ['ccap1_wire_r', 'kz_wire_ac2'],
        ['kz_wire_pp', 'cz_wire_l'], ['kz_wire_nn', 'cz_wire_r'],
    ]],
    ['km1-coil', '10. 接通方向控制回路（正转与反转两条支路）。', [
        ['lyj-no1_wire_no', 'lk2_wire_com'], ['lk2_wire_no', 'km2-nc_wire_com'],
        ['km2-nc_wire_nc', 'km1-coil_wire_a1'], ['km1-coil_wire_a2', 'lyj-coil_wire_a2'],
        ['lk2_wire_com', 'lk3_wire_com'], ['lk3_wire_no', 'km1-nc_wire_com'],
        ['km1-nc_wire_nc', 'km2-coil_wire_a1'], ['km2-coil_wire_a2', 'km1-coil_wire_a2'],
    ]],
    ['c1-coil', '11. 接通低速回路：LK4 → 2C2 常闭 → 2C1 常闭 → 1C 线圈 → 3C 常闭 → 返回。', [
        ['lyj-no1_wire_no', 'lk4_wire_com'], ['lk4_wire_no', 'c22-nc1_wire_com'],
        ['c22-nc1_wire_nc', 'c21-nc1_wire_com'], ['c21-nc1_wire_nc', 'c1-coil_wire_a1'],
        ['c1-coil_wire_a2', 'c3-nc1_wire_com'], ['c3-nc1_wire_nc', 'km2-coil_wire_a2'],
    ]],
    ['c21-coil', '12. 接通中速回路（2C1 支路与 2C2 支路）。', [
        ['lk4_wire_com', 'lk5_wire_com'], ['lk5_wire_no', 'c1-nc1_wire_com'],
        ['c1-nc1_wire_nc', 'c22-no1_wire_com'], ['c22-no1_wire_no', 'c21-coil_wire_a1'],
        ['c21-coil_wire_a2', 'c1-coil_wire_a2'], ['c1-nc1_wire_nc', 'c22-coil_wire_a1'],
        ['c22-coil_wire_a2', 'c21-coil_wire_a2'],
    ]],
    ['c3-coil', '13. 接通高速回路：LK6 → DJ 常闭 → 1SJ 常闭 → 3C 线圈 → 1C 常闭 → 3C 常闭右端，并接入自锁。', [
        ['lk5_wire_com', 'lk6_wire_com'], ['lk6_wire_no', 'dj-nc1_wire_com'],
        ['dj-nc1_wire_nc', 'sj1-nc1_wire_com'], ['sj1-nc1_wire_nc', 'c3-coil_wire_a1'],
        ['c3-coil_wire_a2', 'c1-nc2_wire_com'], ['c1-nc2_wire_nc', 'c3-nc1_wire_nc'],
        ['c3-no1_wire_com', 'dj-nc1_wire_nc'], ['c3-no1_wire_no', 'c3-coil_wire_a1'],
    ]],
    ['dj-coil', '14. 接通高速过流保护回路：LK6 右端 → GLJ 常开 → DJ 线圈 → c1-nc2 右端，并自锁。', [
        ['lk6_wire_no', 'glj-no1_wire_com'], ['glj-no1_wire_no', 'dj-coil_wire_a1'],
        ['dj-coil_wire_a2', 'c1-nc2_wire_nc'],
        ['dj-no1_wire_com', 'glj-no1_wire_com'], ['dj-no1_wire_no', 'glj-no1_wire_no'],
    ]],
    ['zdc-coil', '15. 接入 ZDC 线圈回路：LK7 → (ZC 常开 ∥ FC 常开) → ZDC 线圈 → DJ 线圈右端。', [
        ['lk6_wire_com', 'lk7_wire_com'], ['lk7_wire_no', 'km2-no1_wire_com'],
        ['km2-no1_wire_no', 'zdc-coil_wire_a1'], ['lk7_wire_no', 'km1-no1_wire_com'],
        ['km1-no1_wire_no', 'zdc-coil_wire_a1'], ['zdc-coil_wire_a2', 'dj-coil_wire_a2'],
    ]],
    ['sj1-coil', '16. 接入 1SJ 控制回路：→ 2C1 常闭 → 1SJ 线圈 → Cz 右端(DC−)。', [
        ['c3-nc2_wire_com', 'c21-nc2_wire_com'], ['c21-nc2_wire_nc', 'sj1-coil_wire_a1'],
        ['sj1-coil_wire_a2', 'cz_wire_r'],
    ]],
    ['sj2-coil', '17. 接入 2SJ 控制回路：→ 3C 常闭 → 2SJ 线圈 → 1SJ 线圈右端。', [
        ['zdc-nc1_wire_com', 'c3-nc2_wire_com'], ['c3-nc2_wire_nc', 'sj2-coil_wire_a1'],
        ['sj2-coil_wire_a2', 'sj1-coil_wire_a2'],
    ]],
    ['sj3-coil', '18. 接入 3SJ 控制回路：→ ZDC 常闭 → 3SJ 线圈 → 2SJ 线圈右端。', [
        ['zdc-no1_wire_com', 'zdc-nc1_wire_com'], ['zdc-nc1_wire_nc', 'sj3-coil_wire_a1'],
        ['sj3-coil_wire_a2', 'sj2-coil_wire_a2'],
    ]],
    ['zdq', '19. 接入电磁制动器回路（主路径 + 经济电阻并联支路 + 放电回路）。', [
        ['cz_wire_l', 'zdc-no1_wire_com'], ['zdc-no1_wire_no', 'rdc_wire_l'],
        ['rdc_wire_r', 'zdq_wire_a1'], ['zdq_wire_a2', 'sj3-coil_wire_a2'],
        ['rdc_wire_l', 'sj3-no1_wire_com'], ['sj3-no1_wire_no', 'rdc_wire_r'],
        ['zdq_wire_a1', 'r3_wire_l'], ['r3_wire_r', 'zl_wire_r'], ['zl_wire_l', 'zdq_wire_a2'],
    ]],
];

PROJECT_WORKFLOWS['control-wiring'] = {
    id: 'control-wiring',
    name: '2. 三速锚机控制电路的接线',
    steps: WIRING_GROUPS.map(([target, msg, pairs]) => ({
        mode: 'check',
        msg,
        op: [{
            target,
            msg,
            act: async function () { await _wireSeq(this, pairs); },
        }],
        check() { return _allConn(_sysOf(this), pairs); },
    })),
};

// ─── 操作流程 3：低速档运行流程分析 ───

const _z3sleep = (ms) => new Promise(r => setTimeout(r, ms));

/** 组件是否得电（接触器/继电器线圈统一判定） */
const _z3on = (sys, id) => {
    const c = sys && sys.comps[id];
    const d = c && c.deviceRef;
    if (!d) return false;
    if (typeof d.isPickup === 'function') return d.isPickup();
    if (typeof d.isEnergized === 'function') return d.isEnergized();
    return false;
};

/** 主令控制器手柄档位 */
// 主令控制器档位：0=下降3(高速)、1=下降2、2=下降1、3=零位、4=上升1、5=上升2、6=上升3
const ZERO_POS = 3;
const UP1_POS = 4;

/** 主令控制器档位（优先取内部整数 _pos，其次取 position 并取整） */
const _z3handle = (sys) => {
    const m = sys && sys.comps['master'];
    if (!m) return null;
    const p = (m._pos !== undefined) ? m._pos : m.position;
    return (typeof p === 'number') ? Math.round(p) : null;
};

/** 主令控制器辅助触点是否闭合（盒子上的 LK1~LK7） */
const _z3lk = (sys, id) => !!(sys && sys.comps[id] && sys.comps[id]._isClosed);

/** 手柄在零位 ⇔ 零位触点 LK1 闭合 */
const _z3atZero = (sys) => _z3lk(sys, 'lk1');
/** 手柄在"上升1" ⇔ 正转触点 LK2 与低速触点 LK4 同时闭合 */
const _z3atUp1 = (sys) => _z3lk(sys, 'lk2') && _z3lk(sys, 'lk4');

/** 设置开关通断（如控制开关 LK） */
const _z3sw = (sys, id, on) => {
    const s = sys && sys.comps[id];
    if (!s) return;
    if (typeof s.setOn === 'function') { s.setOn(on); return; }
    if (s.isOn !== on && typeof s.toggle === 'function') s.toggle();
};

/** 合上主电路空气开关 Q */
const _z3acb = (sys) => {
    const a = sys && sys.comps['acb'];
    if (!a) return;
    if (typeof a.close === 'function') a.close();
    else if (typeof a.setOn === 'function') a.setOn(true);
};

/** 空气开关是否已合上（不同组件实现字段名不同，做兼容判断） */
const _z3acbOn = (sys) => {
    const a = sys && sys.comps['acb'];
    if (!a) return false;
    if (typeof a.isClosed === 'function') return a.isClosed();
    if (a._isClosed !== undefined) return a._isClosed === true;
    if (a._closed !== undefined) return a._closed === true;
    if (a._state !== undefined) return a._state === 'on';
    return false;
};

PROJECT_WORKFLOWS['low-speed-analysis'] = {
    id: 'low-speed-analysis',
    name: '3. 低速档运行流程分析',
    steps: [
        {
            mode: 'check',
            msg: '1. 自动接线，合上主电路空气开关。',
            op: [
                { type: 'wire', msg: '点击工具栏"自动接线"按钮，自动完成全部主电路与控制电路接线',
                  async act() { const s = _sysOf(this); if (s && s.conns.length === 0) document.getElementById('btnAutoWire')?.click(); await _z3sleep(1200); } },
                { type: 'switch', target: 'acb', msg: '合上主电路空气开关 Q，三相电源接通',
                  async act() { _z3acb(_sysOf(this)); await _z3sleep(1500); } },
            ],
            check() { return _z3acbOn(_sysOf(this)); },
        },
        {
            mode: 'check',
            msg: '2. 合上控制电路电源 LK，观察得电的组件（XD 指示灯亮起；LYJ、1SJ、2SJ、3SJ 同时得电）。',
            op: [
                { type: 'switch', target: 'lkp', msg: '合上控制电路电源开关 LK',
                  async act() { _z3sw(_sysOf(this), 'lkp', true); await _z3sleep(2500); } },
            ],
            check() { const s = _sysOf(this); return !!(s && s.comps['lkp'] && s.comps['lkp'].isOn === true); },
        },
        {
            mode: 'quiz',
            msg: '9. LYJ 得电的关键条件是什么？',
            quizConfig: {
                question: 'LYJ 得电的关键条件是？',
                options: [
                    '主令手柄离开零位、正转（ZC）或反转（FC）接触器得电',
                    '控制电路电源接通且主令控制器手柄在零位',
                    '只要控制电路电源接通',
                    '1SJ 延时到达',
                ],
                answer: 1,
                analysis: 'LYJ（零压继电器）得电的关键条件是：控制电路电源接通且主令控制器手柄在零位。当控制电路电源接通时，LYJ 得电；当主令控制器手柄离开零位时，LYJ 失电。',
            },
        },
        {
            mode: 'check',
            msg: '4. 断开控制电路电源，将主令控制器手柄推到"上升1"，再合上控制电路电源，验证 LYJ 不得电。',
            op: [
                { type: 'switch', target: 'lkp', msg: '断开控制电路电源 LK',
                  async act() { _z3sw(_sysOf(this), 'lkp', false); await _z3sleep(1200); } },
                { type: 'switch', target: 'master', part: 'handle', msg: '把主令控制器手柄推到"上升1"档（脱离零位）',
                  async act() { const s = _sysOf(this); s.comps['master'].setPosition(UP1_POS); await _z3sleep(1500); } },
                { type: 'switch', target: 'lkp', msg: '重新合上控制电路电源 LK',
                  async act() { _z3sw(_sysOf(this), 'lkp', true); await _z3sleep(2500); } },
            ],
            check() {
                const s = _sysOf(this);
                return !!s && !_z3atZero(s) && !_z3on(s, 'lyj-coil') && !!(s.comps['lkp'] && s.comps['lkp'].isOn);
            },
        },
        {
            mode: 'check',
            msg: '5. 将手柄拉回零位，LYJ 得电（零位触点 LK1 闭合，零压继电器吸合自锁）。',
            op: [
                { type: 'switch', target: 'master', part: 'handle', msg: '把手柄拉回"零位"（OFF）',
                  async act() { const s = _sysOf(this); s.comps['master'].setPosition(ZERO_POS); await _z3sleep(2500); } },
            ],
            check() { const s = _sysOf(this); return _z3atZero(s) && _z3on(s, 'lyj-coil'); },
        },
        {
            mode: 'quiz',
            msg: '6. 选择题：主令控制器手柄归零后，LYJ 得电，同时得电的组件有（   ）。',
            quizConfig: {
                question: '主令控制器手柄归零、LYJ 得电后，还有哪些组件同时得电？',
                options: [
                    '1SJ、2SJ、3SJ 三个时间继电器',
                    'ZC、FC 两个方向接触器',
                    '1C、2C1、2C2、3C 四个速度接触器',
                    'ZDC 制动接触器与 1SJ 时间继电器',
                ],
                answer: 0,
                analysis: '手柄归零后只有零位触点 LK1 闭合，LYJ 线圈得电并自锁；此时方向接触器（ZC/FC）、速度接触器（1C/2C1/2C2/3C）都未得电，因为 LK2~LK6 尚未闭合。真正同时得电的是由直流回路供电的 1SJ、2SJ、3SJ 三个时间继电器（初始化得电）：1SJ 断开中/高速起动支路保证逐级起动，2SJ 短接 2LH 副边防止 GLJ 误动作，3SJ 短接制动器经济电阻使制动器快速松闸。',
            },
        },
        {
            mode: 'quiz',
            msg: '7. 测试题：3 个时间继电器初始化时候得电的作用分别是什么？',
            quizConfig: {
                question: '主令手柄回零、LYJ 得电后，1SJ、2SJ、3SJ 三个时间继电器同时得电（初始化），它们各自的作用是？',
                options: [
                    '1SJ 断开高速起动支路，保证按"中速→高速"逐级起动；2SJ 短接电流互感器 2LH 副边，防止 GLJ 误动作；3SJ 短接制动器经济电阻，使制动器快速吸合松闸',
                    '1SJ 短接经济电阻；2SJ 断开中/高速支路；3SJ 短接电流互感器副边',
                    '三个时间继电器都只是延时接通制动器线圈，与起动顺序无关',
                    '1SJ、2SJ、3SJ 分别延时接通低速、中速、高速接触器线圈',
                ],
                answer: 0,
                analysis: '三个时间继电器初始化（得电即动作）：1SJ 的常闭串在中/高速支路里，得电时断开，必须先低速起动、待 1SJ 失电延时到达后才允许中/高速接通，实现逐级起动；2SJ 的触点并接在 2LH 副边（GLJ 测量绕组）两端，得电即短接副边，避免电动机起动大电流经互感器使 GLJ 误动作；3SJ 的常开并接在制动器经济电阻（50Ω）两端，得电即短接电阻，让 ZDQ 线圈得到全电压快速吸合松闸。',
            },
        },
        {
            mode: 'check',
            msg: '8. 将手柄推到"上升1"档，观察得电的组件（ZC 吸合、1C 吸合、ZDC 得电、ZDQ 制动器得电松闸，电机低速运转）。',
            op: [
                { type: 'switch', target: 'master', part: 'handle', msg: '把手柄推到"上升1"档（低速上升）',
                  async act() { const s = _sysOf(this); s.comps['master'].setPosition(UP1_POS); await _z3sleep(4000); } },
            ],
            check() {
                const s = _sysOf(this);
                return _z3atUp1(s) && _z3on(s, 'km1-coil') && _z3on(s, 'c1-coil') && _z3on(s, 'zdc-coil');
            },
        },
        {
            mode: 'quiz',
            msg: '9. 测试题：观察 ZDC，ZDC 得电的关键条件是什么？ZDC 的作用是什么？',
            quizConfig: {
                question: '观察 ZDC（直流电磁制动器控制接触器）的得电情况，它得电的关键条件与作用是？',
                options: [
                    '关键条件：主令手柄离开零位、正转（ZC）或反转（FC）接触器得电；作用：接通 ZDQ 电磁制动器线圈，使制动器松闸，电机才能转动',
                    '关键条件：LYJ 吸合即可；作用：给时间继电器供电',
                    '关键条件：GLJ 动作后自锁；作用：过流时切断主电路',
                    '关键条件：1SJ 延时到达；作用：延迟电动机起动',
                ],
                answer: 0,
                analysis: 'ZDC 线圈回路由 LK7 → (ZC 常开 ∥ FC 常开) → ZDC 线圈 → DJ 线圈右端构成。只有当主令手柄离开零位、方向接触器 ZC 或 FC 吸合后，其常开触点才闭合使 ZDC 得电；ZDC 得电后其常开触点接通 ZDQ 电磁制动器回路，制动器松闸，电动机才能拖动锚机旋转。因此"手柄离开零位 + 方向接触器吸合"是 ZDC 得电的关键条件。',
            },
        },
        {
            mode: 'fill',
            msg: '10. 填空题：3SJ 在锚机工作期间是（   ）状态，它是（   ）类型，它的作用是起动时短接经济电阻，运行时接入经济电阻。',
            fields: [
                { label: '3SJ 在锚机工作期间的状态（有电/失电）', unit: '', answer: '失电',
                  placeholder: '提示：经 5s 断电延时后其常开触点复位' },
                { label: '3SJ 的类型（通电延时/断电延时）', unit: '', answer: '断电延时',
                  placeholder: '提示：线圈失电后才开始计时' },
            ],
        },
    ],
};

// ─── 操作流程 4：中高速档运行流程分析 ───

const UP2_POS = 5;   // 上升2（中速）
const UP3_POS = 6;   // 上升3（高速）

/** 手柄在"上升2"（中速）⇔ LK2(正转) + LK5(中速) 同时闭合 */
const _z4atUp2 = (sys) => _z3lk(sys, 'lk2') && _z3lk(sys, 'lk5');
/** 手柄在"上升3"（高速）⇔ LK2(正转) + LK6(高速) 同时闭合 */
const _z4atUp3 = (sys) => _z3lk(sys, 'lk2') && _z3lk(sys, 'lk6');

PROJECT_WORKFLOWS['mid-high-speed-analysis'] = {
    id: 'mid-high-speed-analysis',
    name: '4. 中高速档运行流程分析',
    steps: [
        {
            mode: 'check',
            msg: '1. 自动接线，合上主电路空气开关，合上控制电路电源开关 LK。',
            op: [
                { type: 'wire', msg: '点击工具栏"自动接线"按钮，自动完成全部接线',
                  async act() { const s = _sysOf(this); if (s && s.conns.length === 0) document.getElementById('btnAutoWire')?.click(); await _z3sleep(1200); } },
                { type: 'switch', target: 'acb', msg: '合上主电路空气开关 Q',
                  async act() { _z3acb(_sysOf(this)); await _z3sleep(1500); } },
                { type: 'switch', target: 'lkp', msg: '合上控制电路电源开关 LK',
                  async act() { _z3sw(_sysOf(this), 'lkp', true); await _z3sleep(2000); } },
            ],
            check() { const s = _sysOf(this); return _z3acbOn(s) && !!(s && s.comps['lkp'] && s.comps['lkp'].isOn === true); },
        },
        {
            mode: 'check',
            msg: '2. 将手柄直接推到"上升2"（中速），观察各组件的得电情况：ZC 吸合、2C2 先吸合、2C1 后吸合、ZDC 得电松闸，电机以 8 极中速运行。',
            op: [
                { type: 'switch', target: 'master', part: 'handle', msg: '把主令控制器手柄直接推到"上升2"档（中速）',
                  async act() { const s = _sysOf(this); s.comps['master'].setPosition(UP2_POS); await _z3sleep(6000); } },
            ],
            check() {
                const s = _sysOf(this);
                return !!s && _z4atUp2(s) && _z3on(s, 'km1-coil') && _z3on(s, 'c22-coil') && _z3on(s, 'c21-coil') && !_z3on(s, 'c3-coil');
            },
        },
        {
            mode: 'quiz',
            msg: '3. 测试题：中速档需要两个接触器的原因是？2C2 和 2C1 为什么要有先后次序？',
            quizConfig: {
                question: '中速档为什么必须由 2C2、2C1 两个接触器配合？它们为什么必须有先后次序？',
                options: [
                    '变极电机中速时既要给 8D 送入三相电源（2C1），又要把 16D1/2/3 短接成星点（2C2），两件事必须由两个接触器分别完成；2C1 线圈串在 2C2 常开触点之后，必须先 2C2 短接、后 2C1 通电，否则绕组极数配置不完整，会出现无旋转磁场或电流过大',
                    '两个接触器是并联冗余，谁先谁后都一样，只是接线方便',
                    '2C1 用于正转、2C2 用于反转，所以必须先方向、后速度',
                    '2C1 给电机送电、2C2 给制动器送电，次序是为了先松闸再起动',
                ],
                answer: 0,
                analysis: '变极调速电机的中速档要同时完成两件事：一是把三相电源接到 8 极绕组端子（8D），二是把原 16 极绕组端子 16D1/2/3 短接成星点，才能形成 8 极旋转磁场。一个接触器只能完成一种通断，所以需要 2C1（送电）与 2C2（短接）两个接触器。电路中 2C1 线圈经 2C2 的常开触点供电，因此顺序固定为"先 2C2 短接、后 2C1 通电"；若顺序颠倒，绕组极数配置不完整，磁场畸变、无旋转磁场或电流过大。',
            },
        },
        {
            mode: 'quiz',
            msg: '4. 测试题：中速运行时 1SJ 将（  ），它的作用是（  ）。',
            quizConfig: {
                question: '中速运行时，1SJ 的状态变化及其作用是？',
                options: [
                    '1SJ 由得电变为失电（断电延时开始计时）；作用是延时到达后接通高速支路，保证中速→高速逐级起动、限制起动电流',
                    '1SJ 由失电变为得电；作用是立即接通高速接触器 3C',
                    '1SJ 一直保持得电不变；作用是短接制动器经济电阻',
                    '1SJ 失电后立即复位；作用是把 2C1 从电路中切除',
                ],
                answer: 0,
                analysis: '1SJ 的线圈经 3C 常闭、2C1 常闭供电，静态（含中速以外各档）都是得电的。中速时 2C1 吸合，其常闭触点打开，1SJ 线圈失电，开始断电延时（约 15s）；延时到达后其常闭触点闭合，才允许 3C 吸合进入高速。这样无论手柄一次推到哪一档，电机都必须先经过低速/中速级，延时逐级起动，避免直接把高速绕组投入电网造成过大起动电流。',
            },
        },
        {
            mode: 'check',
            msg: '5. 将手柄拉回零位，稳定后，将手柄直接推到"上升3"，观察中速到高速的逐级起动过程：2C2→2C1 吸合后，1SJ 失电延时到达，3C 才吸合进入高速。',
            op: [
                { type: 'switch', target: 'master', part: 'handle', msg: '手柄拉回零位，等待各接触器全部复位',
                  async act() { const s = _sysOf(this); s.comps['master'].setPosition(ZERO_POS); await _z3sleep(3000); } },
                { type: 'switch', target: 'master', part: 'handle', msg: '把手柄直接推到"上升3"档（高速），观察逐级起动过程',
                  async act() {
                      const s = _sysOf(this);
                      s.comps['master'].setPosition(UP3_POS);
                      if (typeof this._tipWorkflow === 'function') {
                          this._tipWorkflow('2C2→2C1 已吸合（中速），1SJ 线圈失电开始断电延时，延时到达后 3C 自动吸合进入高速……', 6000);
                      }
                      // 等待 1SJ 断电延时走完、3C 吸合进入高速（约 45~55s）
                      await _z3sleep(55000);
                  } },
            ],
            check() {
                const s = _sysOf(this);
                return !!s && _z4atUp3(s) && _z3on(s, 'km1-coil') &&
                    (_z3on(s, 'c3-coil') || _z3on(s, 'c21-coil') || _z3on(s, 'c22-coil'));
            },
        },
        {
            mode: 'quiz',
            msg: '6. 测试题：进入高速运行时，2SJ 将失电，它的作用是？',
            quizConfig: {
                question: '进入高速运行时 2SJ 将失电，其常开触点的动作及作用是？',
                options: [
                    '2SJ 失电、其常开触点断开，起动期间短接副边防止 GLJ 误动作，起动完成后接入监视',
                    '2SJ 失电后其常开触点闭合，把 2LH 副边短路，退出 GLJ 过流保护',
                    '2SJ 失电后断开高速接触器 3C 的自锁，使电机停机',
                    '2SJ 失电后接通制动器 ZDQ，使锚机抱闸',
                ],
                answer: 0,
                analysis: '2SJ 的常开触点并接在 2LH 副边（GLJ 测量绕组）两端。起动过程中电动机电流很大，若此时 GLJ 已投入，会被起动大电流误判为过流而跳闸。因此 2SJ 在起动阶段（3C 未吸合时经 3C 常闭得电）保持得电、常开触点闭合，把 2LH 副边短路，GLJ 感受不到电流；进入高速运行后 3C 吸合，其常闭触点打开使 2SJ 失电，经约 10s 断电延时后常开触点断开，取消短接，GLJ 才正式投入过流监视。',
            },
        },
    ],
};

// ─── 操作流程 5：三速锚机保护功能分析 ───

/** 轮询等待条件成立（返回是否在超时前成立） */
async function _z5wait(fn, timeoutMs, stepMs = 500) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
        try { if (fn()) return true; } catch (e) { /* 忽略瞬时异常 */ }
        await _z3sleep(stepMs);
    }
    return false;
}

/** 热继电器是否已动作 */
const _z5tripped = (sys, id) => {
    const d = sys && sys.comps[id] && sys.comps[id].deviceRef;
    if (!d) return false;
    if (typeof d.isTripped === 'function') return d.isTripped();
    return d._tripped === true || d.tripped === true;
};

/** 断开 16D2 接线（1C 出口 → 电机 16D2） */
function _z5break16D2(sys) {
    const a = 'c1-mc_wire_t2', b = 'im01_wire_16d2';
    sys.conns = sys.conns.filter(c => !((c.from === a && c.to === b) || (c.from === b && c.to === a)));
    sys.redrawAll();
}

/** 恢复 16D2 接线（动画接线） */
async function _z5fix16D2(sys) {
    if (!_hasConn(sys, 'c1-mc_wire_t2', 'im01_wire_16d2')) {
        await sys.connMgr.addConnectionAnimated({ from: 'c1-mc_wire_t2', to: 'im01_wire_16d2', type: 'wire' });
    }
}

/**
 * 通过参数配置界面修改电机负荷率（严格遵守"参数调整一律走配置界面"）：
 * 弹配置对话框 → 高亮"负荷率"输入框并填值 → 高亮"保存"并点击。
 */
async function _z5setLoad(wf, sys, value) {
    await _demoSetCfg(wf, 'im01', 'loadRate', value, `把电机「负荷率」改为 ${value}%`);
}

/**
 * 通过参数配置界面动态演示参数修改（统一规范，所有参数配置场合都必须这样演）：
 *   ① 弹框前把组件实时属性同步进 config 副本（否则「保存」会把旧值一并回写）
 *   ② comp.showConfigDialog() 弹出参数设置界面
 *   ③ 取 #diag_<key> 输入框 → 闪烁箭头高亮 + 填入新值
 *   ④ 取最后打开的对话框的「保存」按钮 → 闪烁箭头高亮 + 真正 click() 按下
 *   ⑤ 确认对话框已关闭（未关闭则点「关闭/取消」）
 */
async function _demoSetCfg(wf, compId, key, value, tip) {
    const sys = _sysOf(wf);
    const comp = sys && sys.comps[compId];
    if (!comp || typeof comp.showConfigDialog !== 'function') return;
    // ① 同步实时属性 → config 副本
    (comp.getConfigFields ? comp.getConfigFields() : []).forEach(f => {
        if (f.get) return;
        try { const live = comp[f.key]; if (live !== undefined) comp.config[f.key] = live; } catch (e) { /* 只读属性忽略 */ }
    });
    comp.showConfigDialog();                       // ② 弹出参数设置界面
    await _z3sleep(700);

    // ③ 高亮输入框并填值
    const input = document.getElementById('diag_' + key);
    if (input) {
        if (typeof wf._flashDomElement === 'function') await wf._flashDomElement(input, tip || `请把该参数改为 ${value}`, 2400);
        input.value = String(value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // ④ 高亮并真正按下「保存」（对话框按打开顺序追加，取最后一个）
    const saveBtns = [...document.querySelectorAll('button')].filter(b => b.textContent.trim() === '保存');
    const saveBtn = saveBtns[saveBtns.length - 1];
    if (saveBtn) {
        if (typeof wf._flashDomElement === 'function') await wf._flashDomElement(saveBtn, '点击「保存」确认参数修改', 1800);
        saveBtn.click();
        await _z3sleep(600);
    }

    // ⑤ 确认对话框已关闭，未关闭则点「关闭/取消」
    const stillInput = document.getElementById('diag_' + key);
    if (stillInput && stillInput.offsetParent !== null) {
        const closeBtn = [...document.querySelectorAll('button')].find(b => /^(关闭|取消)$/.test(b.textContent.trim()));
        if (closeBtn) {
            if (typeof wf._flashDomElement === 'function') await wf._flashDomElement(closeBtn, '关闭参数对话框', 1500);
            closeBtn.click();
            await _z3sleep(400);
        }
    }

    // 生效兜底：若保存未生效则直接赋值，保证演示不中断
    if (Math.round(parseFloat(comp[key])) !== Math.round(parseFloat(value))) {
        if (typeof comp.onConfigUpdate === 'function') comp.onConfigUpdate({ [key]: value });
        try { comp[key] = value; } catch (e) { /* 只读属性忽略 */ }
    }
}

// 流程 5 的动作记忆（供 check 判定"曾经动作过"）
const _z5done = { k1kr: false, k2kr: false, glj: false };

PROJECT_WORKFLOWS['protection-analysis'] = {
    id: 'protection-analysis',
    name: '5. 三速锚机保护功能分析',
    steps: [
        {
            mode: 'check',
            msg: '1. 自动接线，接通主电路电源，接通控制回路电源。',
            op: [
                { type: 'wire', msg: '点击工具栏"自动接线"按钮，自动完成全部接线',
                  async act() { const s = _sysOf(this); if (s && s.conns.length === 0) document.getElementById('btnAutoWire')?.click(); await _z3sleep(1200); } },
                { type: 'switch', target: 'acb', msg: '合上主电路空气开关 Q',
                  async act() { _z3acb(_sysOf(this)); await _z3sleep(1500); } },
                { type: 'switch', target: 'lkp', msg: '合上控制电路电源开关 LK',
                  async act() { _z3sw(_sysOf(this), 'lkp', true); await _z3sleep(2000); } },
            ],
            check() { const s = _sysOf(this); return _z3acbOn(s) && !!(s && s.comps['lkp'] && s.comps['lkp'].isOn === true); },
        },
        {
            mode: 'check',
            msg: '2. 断开 16D2 接线，将手柄推到"上升1"：电机缺相不能正常起动，等待 1KR 动作后电机停机，随后将手柄复位。',
            op: [
                { type: 'observe', target: 'im01', msg: '断开电机 16D2 的一根接线（1C 出口 → 16D2），制造缺相',
                  async act() { const s = _sysOf(this); _z5break16D2(s); await _z3sleep(1500); } },
                { type: 'switch', target: 'master', part: 'handle', msg: '手柄推到"上升1"（低速），缺相起动失败，1KR 过载动作',
                  async act() {
                      const s = _sysOf(this); s.comps['master'].setPosition(UP1_POS);
                      _z5done.k1kr = await _z5wait(() => _z5tripped(s, 'fr'), 90000);   // 热元件累积较慢，约 50~60s 才脱扣
                      await _z3sleep(1500);
                  } },
                { type: 'switch', target: 'master', part: 'handle', msg: '1KR 动作、电机停机后，将手柄复位到零位',
                  async act() { const s = _sysOf(this); s.comps['master'].setPosition(ZERO_POS); await _z3sleep(2000); } },
            ],
            check() {
                const s = _sysOf(this);
                if (!s) return false;
                // 演练模式下 act() 不会执行，这里现场观测并锁存"1KR 曾动作"
                if (_z5tripped(s, 'fr')) _z5done.k1kr = true;
                return !_hasConn(s, 'c1-mc_wire_t2', 'im01_wire_16d2') && _z5done.k1kr && _z3atZero(s);
            },
        },
        {
            mode: 'check',
            msg: '3. 恢复 16D2 接线，将手柄推到"上升2"（中速），把负载加到 150%，观察过载保护热继电器动作、电机停机；随后手柄复位，并把负载调回 30%。',
            op: [
                { type: 'observe', target: 'im01', msg: '恢复 16D2 接线',
                  async act() { await _z5fix16D2(_sysOf(this)); await _z3sleep(1000); } },
                { type: 'switch', target: 'master', part: 'handle', msg: '手柄推到"上升2"（中速）',
                  async act() { const s = _sysOf(this); s.comps['master'].setPosition(UP2_POS); await _z3sleep(6000); } },
                { type: 'knob', target: 'im01', msg: '打开电机参数配置界面，把负荷率改为 150%',
                  async act() { await _demoSetCfg(this, 'im01', 'loadRate', 150, '把电机「负荷率」改为 150%'); await _z3sleep(1000); } },
                { type: 'observe', target: 'fr2', msg: '观察 2KR（中速支路热继电器）过载动作、电机停机',
                  async act() {
                      const s = _sysOf(this);
                      _z5done.k2kr = await _z5wait(() => _z5tripped(s, 'fr2'), 90000);   // 中速支路 2KR，热元件累积较慢，约 50~60s
                      await _z3sleep(1500);
                  } },
                { type: 'switch', target: 'master', part: 'handle', msg: '电机停机后手柄复位到零位',
                  async act() { const s = _sysOf(this); s.comps['master'].setPosition(ZERO_POS); await _z3sleep(2500); } },
                { type: 'knob', target: 'im01', msg: '在配置界面把负荷率调回 30%',
                  async act() { await _demoSetCfg(this, 'im01', 'loadRate', 30, '把电机「负荷率」改回 30%'); await _z3sleep(1500); } },
            ],
            check() {
                const s = _sysOf(this);
                if (!s) return false;
                // 演练模式只调用 check()：必须现场检测到 2KR（中速支路热继电器）动作并锁存
                if (_z5tripped(s, 'fr2')) _z5done.k2kr = true;
                const im = s.comps['im01'];
                return _hasConn(s, 'c1-mc_wire_t2', 'im01_wire_16d2') && _z5done.k2kr && _z3atZero(s)
                    && !!im && Math.round(im.loadRate) === 30;
            },
        },
        {
            mode: 'check',
            msg: '4. 将手柄推到"上升3"，等待高速运行并进入过流监视状态（1SJ 延时后 3C 吸合；3C 吸合后 2SJ 失电，经延时取消对 2LH 副边的短接，GLJ 正式投入监视）。',
            op: [
                { type: 'switch', target: 'master', part: 'handle', msg: '手柄推到"上升3"（高速），等待逐级起动完成',
                  async act() {
                      const s = _sysOf(this); s.comps['master'].setPosition(UP3_POS);
                      await _z5wait(() => _z3on(s, 'c3-coil'), 70000);      // 等 1SJ 断电延时 → 3C 吸合
                      await _z5wait(() => !_z3lk(s, 'sj2-no1'), 20000);      // 等 2SJ 失电延时 → 取消副边短接
                      await _z3sleep(2000);
                  } },
            ],
            check() {
                const s = _sysOf(this);
                return !!s && _z4atUp3(s) && _z3on(s, 'c3-coil') && !_z3lk(s, 'sj2-no1');
            },
        },
        {
            mode: 'check',
            msg: '5. 将负载加到 80%，观察 GLJ 过流动作（约 5s 延时）：DJ 吸合并自锁，3C 跳开，电机自动退到中速运行（2C1/2C2 保持吸合）。',
            op: [
                { type: 'knob', target: 'im01', msg: '打开电机参数配置界面，把负荷率改为 80%',
                  async act() { await _demoSetCfg(this, 'im01', 'loadRate', 80, '把电机「负荷率」改为 80%'); await _z3sleep(1000); } },
                { type: 'observe', target: 'glj-coil', msg: '观察 GLJ 动作 → DJ 吸合 → 3C 跳开 → 自动退回中速',
                  async act() {
                      const s = _sysOf(this);
                      _z5done.glj = await _z5wait(() => !_z3on(s, 'c3-coil') && _z3on(s, 'dj-coil'), 40000);
                      await _z3sleep(2500);
                  } },
            ],
            check() {
                const s = _sysOf(this);
                if (!s) return false;
                const glj = s.comps['glj-coil'];
                if ((glj && glj._tripped) || (!_z3on(s, 'c3-coil') && _z3on(s, 'dj-coil'))) _z5done.glj = true;
                const im = s.comps['im01'];
                return _z5done.glj && !_z3on(s, 'c3-coil')
                    && (_z3on(s, 'c21-coil') || _z3on(s, 'c22-coil'))
                    && !!im && Math.round(im.loadRate) === 80;
            },
        },
        {
            mode: 'check',
            msg: '6. 降低负载到 30%（GLJ 返回、DJ 复位），将手柄拉到中速档再推到高速挡，恢复高速运行。',
            op: [
                { type: 'knob', target: 'im01', msg: '在配置界面把负荷率降回 30%，GLJ 返回、DJ 复位',
                  async act() { await _demoSetCfg(this, 'im01', 'loadRate', 30, '把电机「负荷率」改回 30%'); await _z3sleep(4000); } },
                { type: 'switch', target: 'master', part: 'handle', msg: '手柄拉到"上升2"（中速）',
                  async act() { const s = _sysOf(this); s.comps['master'].setPosition(UP2_POS); await _z3sleep(3000); } },
                { type: 'switch', target: 'master', part: 'handle', msg: '再推到"上升3"（高速），恢复高速运行',
                  async act() { const s = _sysOf(this); s.comps['master'].setPosition(UP3_POS); await _z5wait(() => _z3on(s, 'c3-coil'), 45000); await _z3sleep(1500); } },
            ],
            check() {
                const s = _sysOf(this);
                const im = s && s.comps['im01'];
                return !!s && _z4atUp3(s) && _z3on(s, 'c3-coil') && !!im && Math.round(im.loadRate) === 30;
            },
        },
    ],
};

// ─── 操作流程 6：制动器松不开故障的处理 ───
// 故障：ZDQ 电磁制动器线圈断线（FAULT_CONFIGS.zdq_coil_open）
// 现象：手柄离零、ZDC 得电后制动回路接通，但 ZDQ 线圈开路无励磁电流 →
//       制动器始终抱闸 → 电机被闸住堵转（负荷率 500%）→ 1KR 过载动作停机。
// 处理：断电用万用表测 ZDQ 线圈电阻（O.L → 判定断线）→ 修复后松闸正常运转。

// 流程 6 的动作记忆（供 check 判定"曾经动作过"）
const _z6done = { k1kr: false, probed: false };

PROJECT_WORKFLOWS['brake-troubleshoot'] = {
    id: 'brake-troubleshoot',
    name: '6. 制动器松不开故障的处理',
    steps: [
        {
            mode: 'check',
            msg: '1. 自动接线，合上主电路空气开关 Q，合上控制电路电源开关 LK。',
            op: [
                { type: 'wire', msg: '点击工具栏"自动接线"按钮，自动完成全部接线',
                  async act() { const s = _sysOf(this); if (s && s.conns.length === 0) document.getElementById('btnAutoWire')?.click(); await _z3sleep(1200); } },
                { type: 'switch', target: 'acb', msg: '合上主电路空气开关 Q',
                  async act() { _z3acb(_sysOf(this)); await _z3sleep(1500); } },
                { type: 'switch', target: 'lkp', msg: '合上控制电路电源开关 LK',
                  async act() { _z3sw(_sysOf(this), 'lkp', true); await _z3sleep(2000); } },
            ],
            check() { const s = _sysOf(this); return _z3acbOn(s) && !!(s && s.comps['lkp'] && s.comps['lkp'].isOn === true); },
        },
        {
            mode: 'check',
            msg: '2. 设置故障：打开「故障设置」界面，勾选「ZDQ线圈断线」，点击「应用设置」。',
            op: [
                { type: 'fault', fault: 'zdq_coil_open',
                  msg: '勾选「ZDQ线圈断线」，点击「应用设置」',
                  async act() { await _z3sleep(300); } },
            ],
            check() { return !!(this.sys && this.sys.FAULT_CONFIG['zdq_coil_open'].check()); },
        },
        {
            mode: 'check',
            msg: '3. 将手柄推到"上升1"，观察：ZC、1C、ZDC 均得电，但 ZDQ 始终"抱闸"不松开，电机被闸住无法转动（堵转）；稍后 1KR 过载动作、电机停机，再将手柄复位。',
            op: [
                { type: 'switch', target: 'master', part: 'handle', msg: '手柄推到"上升1"（低速）',
                  async act() { const s = _sysOf(this); s.comps['master'].setPosition(UP1_POS); await _z3sleep(4000); } },
                { type: 'observe', target: 'zdq', msg: '观察 ZDQ：线圈虽已接入制动回路，却始终显示"抱闸"，制动器未松闸（电机被闸住堵转）',
                  async act() { await _z3sleep(2500); } },
                { type: 'observe', target: 'fr', msg: '电机堵转 → 主回路大电流 → 1KR 热继电器过载动作、电机停机（热元件累积，约需数十秒）',
                  async act() {
                      const s = _sysOf(this);
                      _z6done.k1kr = await _z5wait(() => _z5tripped(s, 'fr'), 90000);
                      await _z3sleep(1500);
                  } },
                { type: 'switch', target: 'master', part: 'handle', msg: '1KR 动作、电机停机后，将手柄复位到零位',
                  async act() { const s = _sysOf(this); s.comps['master'].setPosition(ZERO_POS); await _z3sleep(2000); } },
            ],
            check() {
                const s = _sysOf(this);
                if (!s) return false;
                if (_z5tripped(s, 'fr')) _z6done.k1kr = true;
                return _z6done.k1kr && _z3atZero(s);
            },
        },
        {
            mode: 'check',
            msg: '4. 诊断：调出数字万用表，打到 2kΩ 电阻档，测量 ZDQ 线圈两端（a1–a2）的电阻。',
            op: [
                { type: 'instrument', instrument: 'multimeter',
                  msg: '点击工具栏「选择仪表」，勾选「数字万用表」并关闭界面',
                  // 仪表选择由演示引擎走完整界面流程；此处仅把万用表切到 2kΩ 电阻档
                  async act() {
                      const mm = _sysOf(this)?.comps['multimeter'];
                      if (mm) { mm.setMode && mm.setMode('RES2k'); if (mm.group) mm.group.visible(true); if (mm.update) mm.update(0); }
                      await _z3sleep(400);
                  } },
                { type: 'observe', target: 'multimeter',
                  msg: '红、黑表笔分别接 ZDQ 线圈两端 a1、a2（此时控制回路已因 1KR 动作断电，可安全测阻）',
                  async act() {
                      await _probeAnimated(_sysOf(this), 'zdq_wire_a1', 'zdq_wire_a2');
                      _z6done.probed = true;
                  } },
                { type: 'observe', target: 'multimeter',
                  msg: '读数显示 O.L（超量程／无穷大）→ 判定 ZDQ 线圈内部断线',
                  async act() { await _z3sleep(2500); } },
                { type: 'observe', target: 'multimeter',
                  msg: '测量完毕，拆除表笔并收起万用表',
                  async act() {
                      const s = _sysOf(this);
                      s.conns = s.conns.filter(c => !(String(c.from).startsWith('multimeter') || String(c.to).startsWith('multimeter')));
                      const mm = s.comps['multimeter'];
                      if (mm) { mm.group.visible(false); mm.setMode && mm.setMode('OFF'); }
                      s.redrawAll();
                      await _z3sleep(900);
                  } },
            ],
            check() {
                const s = _sysOf(this);
                if (!s) return false;
                if (_z6done.probed) return true;
                const mm = s.comps['multimeter'];
                const hasWire = (a, b) => s.conns.some(c => c.type === 'wire'
                    && ((c.from === a && c.to === b) || (c.from === b && c.to === a)));
                const probed = (hasWire('multimeter_wire_v', 'zdq_wire_a1') && hasWire('multimeter_wire_com', 'zdq_wire_a2'))
                    || (hasWire('multimeter_wire_v', 'zdq_wire_a2') && hasWire('multimeter_wire_com', 'zdq_wire_a1'));
                return probed || !!(mm && mm.mode === 'RES2k');
            },
        },
        {
            mode: 'quiz',
            msg: '5. 判断题：用万用表断电测量 ZDQ 线圈两端，读数为 O.L（无穷大），说明什么？',
            quizConfig: {
                question: 'ZDQ 制动器"松不开"，断电测得线圈两端电阻为 O.L（无穷大），说明？',
                options: [
                    '线圈内部断线（开路），制动回路无励磁电流，需更换/修复线圈',
                    '线圈短路，电阻几乎为零，应检查电源是否过流',
                    '制动器机械部分卡死，与电气回路无关',
                    '直流控制电源电压不足，应提高整流输出电压',
                ],
                answer: 0,
                analysis: '线圈两端电阻为 O.L（无穷大）说明线圈内部开路（断线），线圈中不可能产生励磁电流，电磁铁不产生吸力，弹簧使制动器保持抱闸，所以锚机"松不开"。若为线圈短路则电阻接近零；机械卡死则电气测量应正常；电源电压不足时测得的是电源异常而非线圈开路。',
            },
        },
        {
            mode: 'check',
            msg: '6. 排除故障：在故障设置界面取消勾选「ZDQ线圈断线」，点击「应用设置」，修复/更换制动器线圈。',
            op: [
                { type: 'fault', fault: 'zdq_coil_open', repair: true,
                  msg: '取消勾选「ZDQ线圈断线」，点击「应用设置」修复故障',
                  async act() { await _z3sleep(300); } },
            ],
            check() { return !(this.sys && this.sys.FAULT_CONFIG['zdq_coil_open'].check()); },
        },
        {
            mode: 'check',
            msg: '7. 恢复验证：待 1KR 冷却复位、LYJ 重新吸合后，手柄推到"上升1"，ZDQ 得电松闸，电机正常低速运转。',
            op: [
                { type: 'switch', target: 'fr', msg: '待 1KR 热继电器冷却自动复位（必要时手动复位）',
                  async act() {
                      const s = _sysOf(this);
                      const fr = s.comps['fr'];
                      if (fr && fr.deviceRef && typeof fr.deviceRef.requestReset === 'function') fr.deviceRef.requestReset();
                      await _z5wait(() => !_z5tripped(s, 'fr'), 30000);
                      await _z3sleep(1200);
                  } },
                { type: 'switch', target: 'master', part: 'handle', msg: '手柄推到"上升1"（低速）',
                  async act() {
                      const s = _sysOf(this); s.comps['master'].setPosition(UP1_POS);
                      await _z5wait(() => _z3on(s, 'zdq'), 15000);
                      await _z3sleep(3000);
                  } },
                { type: 'observe', target: 'im01', msg: '观察 ZDQ 松闸、电机正常低速运转（转速表有读数）',
                  async act() { await _z3sleep(2500); } },
            ],
            check() {
                const s = _sysOf(this);
                const im = s && s.comps['im01'];
                return !!s && _z3atUp1(s) && _z3on(s, 'zdc-coil') && _z3on(s, 'zdq')
                    && !!im && im.rpm > 100 && !im.isBraked();
            },
        },
    ],
};

export function initSlider(_sys) { }

export function applyAllPresets() {
    const sys = this && this.sys ? this.sys : window.sys;
    if (!sys) return;
    _autoWire(sys);
}

export async function applyStartSystem() {
    const sys = this && this.sys ? this.sys : window.sys;
    if (!sys) return;
    _autoWire(sys);
    _powerOn(sys);
}

export function fiveStep() { }
