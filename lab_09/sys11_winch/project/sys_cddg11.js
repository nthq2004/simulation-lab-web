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

export const FAULT_CONFIGS = {};

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
    { Class: MasterController, id: 'master', x: 1630, y: 30, deviceid: 'LK', label: '主令控制器', initPosition: 3, visible: true },
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
    { Class: Multimeter, id: 'multimeter', x: 460, y: 880, visible: false },
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
