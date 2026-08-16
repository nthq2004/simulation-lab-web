// 船舶发电机主开关仿真工程（同步发电机 + 汇流排 + 船用框架式空气断路器）

import { SyncGenerator3P } from '../components/SyncGenerator3P.js';
import { Busbar3P } from '../components/Busbar3P.js';
import { MarineMainsSwitch } from '../components/MarineMainsSwitch.js';
import { MarineElectronicTrip } from '../components/MarineElectronicTrip.js';
import { DCPower } from '../components/DCPower.js';
import { Ground } from '../components/Gnd.js';
import { DiagramThreePhaseACB } from '../components/DiagramThreePhaseACB.js';
import { DiagramStartButton } from '../components/DiagramStartButton.js';
import { DiagramStopButton } from '../components/DiagramStopButton.js';
import { InductionMotor2 } from '../components/InductionMotor2.js';
import { IncandescentLamp } from '../components/IncandescentLamp.js';
import { Multimeter } from '../components/Multimeter.js';
import { MF47Multimeter } from '../components/MF47Multimeter.js';
import { Oscilloscope_tri } from '../components/Osc_tri.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';
import { ElecMeter } from '../components/ElecMeter.js';

// ─────────────────────────────────────────────────────────────────────────
// 故障设置（3 大类，内部随机映射 12 个具体故障）
//
// 原来的 12 个具体故障（内部 enum，保留以备查证/扩展）：
//   #1  uv_coil_open      失压线圈断线          → qf1.setUvCoilOpen
//   #2  uv_stuck          衔铁结构卡死           → qf1.setUvStuck
//   #3  uv_spring         反作用弹簧弹力过大      → qf1.setUvSpring
//   #4  close_coil_open   合闸线圈断线           → qf1.setCloseCoilOpen
//   #5  motor_open        储能电机控制回路断线    → qf1.setMotorOpen
//   #6  store_spring      储能弹簧无法储能        → qf1.setStoreSpring
//   #7  shunt_coil_open   分励线圈断线           → qf1.setShuntCoilOpen
//   #8  shunt_no_act      分励脱扣器不动作        → qf1.setShuntNoAct
//   #9  trip_shaft_stuck  脱扣轴卡死             → qf1.setTripShaftStuck
//   #10 trip_aging        脱扣机构老化           → qf1.setTripAging
//   #11 et_uv_misset      欠压整定失调           → et1.setUvMisSet
//   #12 et_overload_misset 过流整定失调          → et1.setOverloadMisSet
//
// 3 大类故障：
//   1. 主开关合不上闸  → 随机触发 #1~#6 中的一个
//   2. 主开关无法脱扣  → 随机触发 #7~#9 中的一个
//   3. 主开关误跳闸    → 随机触发 #10~#12 中的一个
// ─────────────────────────────────────────────────────────────────────────

function _fcomp(id) {
    const s = window.sys;
    return s && s.comps && s.comps[id] ? s.comps[id] : null;
}

export const FAULT_CONFIGS = {
    sw_no_close: {
        id: 'sw_no_close', name: '1. 主开关合不上闸', system: '主开关',
        items: [
            { comp: 'qf1', flag: '_faultUVCoilOpen',     set: 'setUvCoilOpen'     },
            { comp: 'qf1', flag: '_faultUVStuck',         set: 'setUvStuck'         },
            { comp: 'qf1', flag: '_faultUVSpring',        set: 'setUvSpring'        },
            { comp: 'qf1', flag: '_faultCloseCoilOpen',   set: 'setCloseCoilOpen'   },
            { comp: 'qf1', flag: '_faultMotorOpen',       set: 'setMotorOpen'       },
            { comp: 'qf1', flag: '_faultStoreSpring',     set: 'setStoreSpring'     },
        ],
        check()   { return this.items.some(it => { const c = _fcomp(it.comp); return c && !!c[it.flag]; }); },
        repair()  { this.items.forEach(it => { const c = _fcomp(it.comp); if (c && c[it.set]) c[it.set](false); }); },
        trigger() {
            this.repair();
            const it = this.items[Math.floor(Math.random() * this.items.length)];
            const c = _fcomp(it.comp);
            if (c && c[it.set]) c[it.set](true);
        },
    },
    sw_no_trip: {
        id: 'sw_no_trip', name: '2. 主开关无法脱扣', system: '主开关',
        items: [
            { comp: 'qf1', flag: '_faultShuntCoilOpen',   set: 'setShuntCoilOpen'   },
            { comp: 'qf1', flag: '_faultShuntNoAct',      set: 'setShuntNoAct'      },
            { comp: 'qf1', flag: '_faultTripShaftStuck',  set: 'setTripShaftStuck'  },
        ],
        check()   { return this.items.some(it => { const c = _fcomp(it.comp); return c && !!c[it.flag]; }); },
        repair()  { this.items.forEach(it => { const c = _fcomp(it.comp); if (c && c[it.set]) c[it.set](false); }); },
        trigger() {
            this.repair();
            const it = this.items[Math.floor(Math.random() * this.items.length)];
            const c = _fcomp(it.comp);
            if (c && c[it.set]) c[it.set](true);
        },
    },
    sw_misadjust: {
        id: 'sw_misadjust', name: '3.主开关误跳闸', system: '主开关/电子脱扣器',
        items: [
            { comp: 'qf1', flag: '_faultTripAging',       set: 'setTripAging'       },
            { comp: 'et1', flag: '_faultUvMisSet',        set: 'setUvMisSet'        },
            { comp: 'et1', flag: '_faultOverloadMisSet',  set: 'setOverloadMisSet'  },
        ],
        check()   { return this.items.some(it => { const c = _fcomp(it.comp); return c && !!c[it.flag]; }); },
        repair()  { this.items.forEach(it => { const c = _fcomp(it.comp); if (c && c[it.set]) c[it.set](false); }); },
        trigger() {
            this.repair();
            const it = this.items[Math.floor(Math.random() * this.items.length)];
            const c = _fcomp(it.comp);
            if (c && c[it.set]) c[it.set](true);
        },
    },
};

export const PROJECT_WORKFLOWS = {
    'acb-parts': {
        id: 'acb-parts',
        name: '1. 空气断路器的部件及其功能',
        steps: [
            {
                msg: '1. 识别储能弹簧：请点击主开关中的储能弹簧',
                mode: 'find', target: 'qf1', subTarget: 'store-spring',
            },
            {
                msg: '2. 测试题：储能弹簧的作用',
                mode: 'quiz',
                quizConfig: {
                    question: '框架式空气断路器中储能弹簧的作用是什么？',
                    options: [
                        '储存压缩能量，合闸时释放能量快速推动主触头闭合',
                        '分闸时把动触头与静触头拉开',
                        '为储能电机提供电源',
                        '用于检测主回路的电流大小',
                    ],
                    answer: 0,
                    analysis: '储能弹簧由储能电机压缩储能，合闸时释放储存的能量，使主触头快速可靠闭合，该过程不依赖电源的瞬间容量。',
                },
            },
            {
                msg: '3. 识别合闸线圈：请点击主开关中的合闸线圈',
                mode: 'find', target: 'qf1', subTarget: 'close-coil',
            },
            {
                msg: '4. 测试题：框架式空气断路器的合闸过程',
                mode: 'quiz',
                quizConfig: {
                    question: '框架式空气断路器合闸时，以下过程描述正确的是？',
                    options: [
                        '脱扣轴处于正常位，储能弹簧释放能量，主轴推动动触头与静触头闭合',
                        '合闸线圈得电后脱扣轴立即跳开，断路器保持分闸',
                        '主触头先闭合，再由储能电机反向把弹簧拉开',
                        '失压线圈失电时主轴直接推动动触头合闸',
                    ],
                    answer: 0,
                    analysis: '脱扣轴处于正常位，合闸时储能弹簧先储能，然后释放能量，主轴右移推动三对动触头与静触头闭合，断路器完成合闸。',
                },
            },
            {
                msg: '5. 识别失压脱扣器：请点击主开关中的失压脱扣器',
                mode: 'find', target: 'qf1', subTarget: 'uv-trip',
            },
            {
                msg: '6. 测试题：失压脱扣器的作用',
                mode: 'quiz',
                quizConfig: {
                    question: '失压脱扣器的主要作用是什么？',
                    options: [
                        '当电压过低或失压时自动使断路器分闸，防止欠压运行',
                        '在合闸时为主触头提供闭合动力',
                        '检测短路电流并限制其大小',
                        '为储能电机提供工作电源',
                    ],
                    answer: 0,
                    analysis: '失压脱扣器线圈正常带电时使脱扣轴保持闭锁，当电压降低或消失时线圈失磁，脱扣轴被释放并联动分闸，防止电机等负荷欠电压运行。',
                },
            },
            {
                msg: '7. 识别分励线圈：请点击主开关中的分励线圈',
                mode: 'find', target: 'qf1', subTarget: 'shunt-coil',
            },
            {
                msg: '8. 识别电子脱扣器：请点击电子脱扣器（ET）',
                mode: 'find', target: 'et1',
            },
            {
                msg: '9. 测试题：电子脱扣器的功能',
                mode: 'quiz',
                quizConfig: {
                    question: '电子脱扣器的主要功能是什么？',
                    options: [
                        '实时检测主回路电流/电压，当短路、过载、欠压、逆功率等异常发生时发出脱扣信号使断路器分闸',
                        '仅为断路器提供合闸电源，不影响分闸',
                        '只在手动操作时点亮指示灯',
                        '用于测量发电机的转速',
                    ],
                    answer: 0,
                    analysis: '电子脱扣器通过电流/电压采样与整定值比较，一旦检测到短路、过载、欠压、逆功率等故障即触发脱扣输出，使主开关分闸保护系统。',
                },
            },
            {
                msg: '10. 识别主触头：请点击主开关中的主触头（三极触点）',
                mode: 'find', target: 'qf1', subTarget: 'main-contact',
            },
            {
                msg: '11. 识别辅助触头：请点击主开关中的辅助触头',
                mode: 'find', target: 'qf1', subTarget: 'aux-contact',
            },
            {
                msg: '12. 识别分闸弹簧：请点击主开关中的分闸弹簧',
                mode: 'find', target: 'qf1', subTarget: 'open-spring',
            },
            {
                msg: '13. 测试题：框架式空气断路器的分闸过程',
                mode: 'quiz',
                quizConfig: {
                    question: '框架式空气断路器分闸时，以下过程描述正确的是？',
                    options: [
                        '脱扣轴转动，分闸弹簧释放能量，主轴左移使三对动触头与静触头分离',
                        '储能电机反向转动把主触头拉开',
                        '合闸线圈得电推动主轴继续压紧触头',
                        '电子脱扣器直接熄灭触头间的电弧',
                    ],
                    answer: 0,
                    analysis: '分闸时脱扣轴转动触发，分闸弹簧释放能量拉动主轴左移，三对动触头与静触头分离，断路器完成分闸；灭弧由栅片灭弧装置完成，与储能电机无关。',
                },
            },
        ],
    },
    'acb-ops': {
        id: 'acb-ops',
        name: '2. 主开关储能、合闸、分闸',
        steps: [
            {
                msg: '1. 使用储能手柄为储能弹簧储能',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 300));
                    const qf = this.sys.comps['qf1'];
                    if (!qf) return;
                    // 手动储能：模拟按压储能手柄5次
                    for (let i = 0; i < 5; i++) {
                        qf._handleDown = true;
                        qf._chargeProg = Math.min(5, qf._chargeProg + 1);
                        qf._charged = qf._chargeProg >= 5;
                        await new Promise(r => setTimeout(r, 400));
                        qf._handleDown = false;
                        await new Promise(r => setTimeout(r, 200));
                    }
                },
                check() {
                    const qf = this.sys.comps['qf1'];
                    return qf && qf.isCharged();
                },
            },
            {
                msg: '2. 接通储能电机电源，自动储能',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 300));
                    _autoWire(this.sys);
                    const dc = this.sys.comps['dc_uv'];
                    if (dc) { dc.isOn = true; }
                    const qf = this.sys.comps['qf1'];
                    if (!qf) return;
                    // 储能电机电源已接通（m1/m2 得电），自动储能至满
                    qf._chargeProg = 0; qf._charged = false;
                    await new Promise(r => setTimeout(r, 3000));
                },
                check() {
                    // 储能电机端口 m1/m2 有额定电压 → 电机得电自动储能
                    const sys = this.sys;
                    if (!sys || typeof sys.getVoltageBetween !== 'function') return false;
                    const v = sys.getVoltageBetween('qf1_wire_m1', 'qf1_wire_m2');
                    return v !== undefined && isFinite(v) && Math.abs(v) > 18;
                },
            },
            {
                msg: '3. 断开储能电机电源，按下手动合闸按钮，释放储能弹簧能量',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 300));
                    const sys = this.sys;
                    // 断开储能电机电源：移除 m1/m2 连线
                    sys.conns.filter(c =>
                        c.type === 'wire' && (
                            c.from === 'qf1_wire_m1' || c.to === 'qf1_wire_m1' ||
                            c.from === 'qf1_wire_m2' || c.to === 'qf1_wire_m2'))
                        .forEach(c => sys.connMgr.removeConn(c));
                    const dc = sys.comps['dc_uv'];
                    if (dc) { dc.isOn = true; }
                    const qf = sys.comps['qf1'];
                    if (!qf) return;
                    // 失压线圈有电（脱扣轴正常位）才能合闸成功
                    qf._uvOn = true;
                    qf.tryClose();
                    await new Promise(r => setTimeout(r, 1000));
                },
                check() {
                    // 只检查储能释放状态：储能弹簧能量已释放（储能清空）
                    const qf = this.sys.comps['qf1'];
                    return qf && qf._chargeProg < 1;
                },
            },
            {
                msg: '4. 为失压线圈供电，使脱扣轴回归正常位',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 300));
                    const dc = this.sys.comps['dc_uv'];
                    if (dc) { dc.isOn = true; }
                    const qf = this.sys.comps['qf1'];
                    if (!qf) return;
                    qf._uvOn = true;
                    await new Promise(r => setTimeout(r, 1500));
                },
                check() {
                    const qf = this.sys.comps['qf1'];
                    return qf && qf._uvOn === true;
                },
            },
            {
                msg: '5. 按下手动分闸按钮，观察脱扣轴动作',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 300));
                    const qf = this.sys.comps['qf1'];
                    if (!qf) return;
                    // 按住手动分闸按钮：机械推动脱扣轴，保持按住状态
                    qf._tripPressed = true;
                    qf.tryTrip();
                    await new Promise(r => setTimeout(r, 1500));
                },
                check() {
                    // 手动分闸按钮处于按下状态才通过
                    const qf = this.sys.comps['qf1'];
                    return qf && qf._tripPressed === true;
                },
            },
            {
                msg: '6. 按下分闸按钮，接通分励脱扣器电源，观察脱扣轴动作',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 300));
                    _autoWire(this.sys);
                    const ss = this.sys.comps['ss'];   // 分励脱扣器电源
                    if (ss) ss.setManualOverride(true);
                    await new Promise(r => setTimeout(r, 2500));
                },
                check() {
                    // 分励线圈端口 fla/flb 得电（按下 ss 接通分励脱扣器电源）才通过
                    const sys = this.sys;
                    if (!sys || typeof sys.getVoltageBetween !== 'function') return false;
                    const v = sys.getVoltageBetween('qf1_wire_fla', 'qf1_wire_flb');
                    return v !== undefined && isFinite(v) && Math.abs(v) > 18;
                },
            },
            {
                msg: '7. 按下手动合闸按钮，观察合闸过程',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 300));
                    const dc = this.sys.comps['dc_uv'];
                    if (dc) { dc.isOn = true; }
                    const qf = this.sys.comps['qf1'];
                    if (!qf) return;
                    if (!qf.isCharged()) { qf._chargeProg = 5; qf._charged = true; }
                    qf._uvOn = true;
                    qf.tryClose();
                    await new Promise(r => setTimeout(r, 2000));
                },
                check() {
                    const qf = this.sys.comps['qf1'];
                    return qf && qf.getState() === 'on';
                },
            },
            {
                msg: '8. 按下手动分闸按钮，观察分闸过程',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 300));
                    const qf = this.sys.comps['qf1'];
                    if (!qf) return;
                    qf._tripPressed = true;
                    qf.tryTrip();
                    await new Promise(r => setTimeout(r, 1500));
                    qf._tripPressed = false;
                    await new Promise(r => setTimeout(r, 500));
                },
                check() {
                    const qf = this.sys.comps['qf1'];
                    return qf && qf.getState() === 'off';
                },
            },
            {
                msg: '9. 按下合闸按钮，接通合闸线圈电源，观察合闸过程',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 300));
                    const dc = this.sys.comps['dc_uv'];
                    if (dc) { dc.isOn = true; }
                    const sc = this.sys.comps['sc'];   // 合闸按钮 → 合闸线圈
                    const qf = this.sys.comps['qf1'];
                    if (!qf) return;
                    if (!qf.isCharged()) { qf._chargeProg = 5; qf._charged = true; }
                    qf._uvOn = true;
                    if (sc) sc.setManualOverride(true);   // 合闸线圈得电 → 自动合闸
                    await new Promise(r => setTimeout(r, 2500));
                    if (sc) sc.setManualOverride(false);
                },
                check() {
                    const qf = this.sys.comps['qf1'];
                    return qf && qf.getState() === 'on';
                },
            },
            {
                msg: '10. 测试题：合闸线圈的作用',
                mode: 'quiz',
                quizConfig: {
                    question: '框架式空气断路器中合闸线圈的作用是什么？',
                    options: [
                        '得电后释放储能弹簧的锁扣，使储能弹簧能量推动主轴合闸',
                        '分闸时拉动主轴与动触头分离',
                        '为储能电机提供工作电源',
                        '检测主回路的电流并发出跳闸信号',
                    ],
                    answer: 0,
                    analysis: '合闸线圈得电吸合后，释放储能弹簧的锁扣，储能弹簧储存的能量通过主轴推动三对动触头与静触头闭合，完成合闸。',
                },
            },
        ],
    },
    'acb-no-close': {
        id: 'acb-no-close',
        name: '3. 主开关不能合闸故障判断和排除',
        steps: [
            {
                msg: '1. 触发主开关合不上闸故障（6种故障随机触发1种）',
                mode: 'check',
                async act() {
                    const cfg = this.sys.FAULT_CONFIG['sw_no_close'];
                    if (cfg) cfg.trigger();
                    await new Promise(r => setTimeout(r, 800));
                    this.sys.showFloatingTip('主开关合不上闸故障已触发', 2000);
                },
                async check() {
                    const cfg = this.sys.FAULT_CONFIG['sw_no_close'];
                    if (!cfg) return false;
                    if (!cfg.check()) cfg.trigger();
                    return cfg.check();
                },
            },
            {
                msg: '2. 接线，起动发电机组',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 300));
                    _autoWire(this.sys);
                    const gen = this.sys.comps['gen1'];
                    if (gen) gen.isOn = true;
                    await new Promise(r => setTimeout(r, 1500));
                },
                check() {
                    const gen = this.sys.comps['gen1'];
                    return gen && gen.isOn === true;
                },
            },
            {
                msg: '3. 观察合闸指示，已储能则跳到第5步；若没有储能则手动储能，储能不成功可确定为储能弹簧故障，跳到第10步',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 300));
                    const qf = this.sys.comps['qf1'];
                    if (!qf) return;
                    if (qf.isCharged()) {
                        this.sys.showFloatingTip('已储能，跳到第5步', 2000);
                        return;
                    }
                    // 未储能：模拟转动储能手柄 5 次（同步记录按压次数）
                    this.sys.showFloatingTip('未储能，正在转动储能手柄储能…', 2000);
                    for (let i = 0; i < 5; i++) {
                        qf._handleDown = true;
                        qf._handlePressCount++;
                        if (!qf._faultStoreSpring && qf._chargeProg < 5) qf._chargeProg += 1;
                        qf._charged = qf._chargeProg >= 5;
                        await new Promise(r => setTimeout(r, 300));
                        qf._handleDown = false;
                        await new Promise(r => setTimeout(r, 200));
                    }
                    if (qf.isCharged()) {
                        this.sys.showFloatingTip('手动储能成功', 1500);
                    } else {
                        this.sys.showFloatingTip('转动储能手柄仍无法储能，储能弹簧故障', 2000);
                    }
                },
                async check() {
                    const qf = this.sys.comps['qf1'];
                    if (!qf) return false;
                    if (qf.isCharged()) return true;
                    // 必须已实际转动储能手柄，且储能仍失败（手柄已转、储能无进展）才判定为储能弹簧故障
                    return qf._handlePressCount > 0 && qf._chargeProg < 1;
                },
                async next() {
                    const qf = this.sys.comps['qf1'];
                    if (!qf) return 2;
                    if (qf._faultStoreSpring) return 9;          // 储能弹簧故障 → 第10步
                    if (qf._faultMotorOpen) return 3;            // 储能电机控制回路故障 → 第4步(索引3)
                    if (qf.isCharged()) return 4;                // 已储能 → 第5步(索引4)
                    return 2;
                },
            },
            {
                msg: '4. 手动储能成功，说明是储能电机控制回路故障，跳到第10步',
                mode: 'check',
                async act() {
                    this.sys.showFloatingTip('储能电机控制回路故障已确定，跳到第10步', 2000);
                    await new Promise(r => setTimeout(r, 1500));
                },
                check() {
                    const qf = this.sys.comps['qf1'];
                    return qf && qf._faultMotorOpen && qf.isCharged();
                },
                next: 9,
            },
            {
                msg: '5. 按下遥控合闸按钮，若没有反应（储能不释放），再按手动合闸按钮，合闸成功可确定为合闸回路故障，跳到第10步',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 300));
                    const qf = this.sys.comps['qf1'];
                    const sc = this.sys.comps['sc'];
                    if (!qf) return;
                    // 遥控合闸
                    if (sc) sc.setManualOverride(true);
                    await new Promise(r => setTimeout(r, 1200));
                    if (sc) sc.setManualOverride(false);
                    if (qf._faultCloseCoilOpen) {
                        this.sys.showFloatingTip('遥控合闸无反应、储能未释放，改用手动合闸', 2000);
                        if (!qf.isCharged()) { qf._chargeProg = 5; qf._charged = true; }
                        qf._uvOn = true;
                        qf.tryClose();
                        await new Promise(r => setTimeout(r, 1500));
                        this.sys.showFloatingTip('手动合闸成功 → 合闸回路故障，跳到第10步', 2000);
                    } else {
                        this.sys.showFloatingTip('遥控合闸储能释放但合不上闸', 1500);
                    }
                },
                async check() {
                    const qf = this.sys.comps['qf1'];
                    if (!qf) return false;
                    if (qf._faultCloseCoilOpen) {
                        // 合闸回路故障：已合闸成功（手动合闸）
                        return qf.getState() === 'on';
                    }
                    // 失压类故障：储能被释放但未能合闸（_chargeProg 已清零）
                    return qf._chargeProg < 1 && qf.getState() !== 'on';
                },
                async next() {
                    const qf = this.sys.comps['qf1'];
                    if (!qf) return 4;
                    if (qf._faultCloseCoilOpen) return 9;        // 合闸回路故障 → 第10步
                    return 5;                                    // 失压脱扣器故障 → 第6步(索引5)
                },
            },
            {
                msg: '6. 按下遥控合闸按钮，储能释放，但主开关合不上闸；点击电子脱扣器，观察其正常，可确定为失压脱扣器故障',
                mode: 'find', target: 'et1',
                async act() {
                    this.sys.showFloatingTip('电子脱扣器正常，判定为失压脱扣器故障', 2000);
                    await new Promise(r => setTimeout(r, 1500));
                },
                next: 6,
            },
            {
                msg: '7. 调出数字万用表，旋至 200kΩ 电阻档，切断电源，测量失压线圈电阻，若阻值无穷大（O.L），跳到第10步。',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    const qf = sys.comps['qf1'];
                    const mm = sys.comps['multimeter'];
                    if (!qf) return;
                    // 演示模式：自动调出万用表并切至 2kΩ 档模拟测量
                    if (mm && mm.group && !mm.group.visible()) {
                        sys.toggleInstrumentVisibility('multimeter', true);
                    }
                    if (mm && mm._updateModeByAngle) mm._updateModeByAngle(90);
                    if (qf._faultUVCoilOpen) {
                        sys.showFloatingTip('失压线圈电阻无穷大（O.L）→ 失压线圈回路故障，跳到第10步', 2500);
                    } else {
                        sys.showFloatingTip('失压线圈电阻正常（约 2000Ω）', 2000);
                    }
                    await new Promise(r => setTimeout(r, 1800));
                },
                check() {
                    const sys = this.sys;
                    const mm = sys.comps['multimeter'];
                    const qf = sys.comps['qf1'];
                    if (!mm || !qf) return false;
                    // 1) 必须调出数字万用表
                    if (!(mm.group && mm.group.visible())) return false;
                    // 2) 必须旋至电阻档（200Ω/2kΩ/200kΩ 任一）
                    if (!(mm.mode && mm.mode.startsWith('RES'))) return false;
                    // 3) 必须将红黑表笔接到失压线圈两端（V↔uv1/uv2，COM↔另一端）
                    const vs = sys.voltageSolver;
                    if (!vs || !vs.portToCluster) return false;
                    const mv = vs.portToCluster.get('multimeter_wire_v');
                    const mc = vs.portToCluster.get('multimeter_wire_com');
                    const u1 = vs.portToCluster.get('qf1_wire_uv1');
                    const u2 = vs.portToCluster.get('qf1_wire_uv2');
                    if (mv === undefined || mc === undefined || u1 === undefined || u2 === undefined) return false;
                    const connected = (mv === u1 && mc === u2) || (mv === u2 && mc === u1);
                    if (!connected) return false;
                    // 4) 必须已读到有效测量值（value 由 _updateRES 每帧刷新）
                    if (!(typeof mm.value === 'number' && isFinite(mm.value))) return false;
                    return true;
                },
                async next() {
                    const sys = this.sys;
                    const qf = sys.comps['qf1'];
                    const mm = sys.comps['multimeter'];
                    if (!qf || !mm) return 6;
                    // 失压线圈断线故障 → 实测电阻无穷大（O.L）→ 第10步
                    if (qf._faultUVCoilOpen) return 9;
                    // 线圈未断线：电阻正常（约2000Ω）→ 继续下一步（第8步）
                    return 7;
                },
            },
            {
                msg: '8. 若线圈正常，给失压线圈通电，脱扣器无法复位；用手按压动衔铁，脱扣器复位，可确认是反作用弹簧弹力过大，跳到第10步',
                mode: 'check',
                async act() {
                    const qf = this.sys.comps['qf1'];
                    if (!qf) return;
                    // 演示模式：模拟按压动衔铁
                    qf._uvPressed = true;
                    qf._uvPressCount++;
                    qf._uvPressResult = !qf._faultUVStuck;
                    this.sys.showFloatingTip(qf._uvPressResult
                        ? '手动按压动衔铁后脱扣器复位 → 反作用弹簧弹力过大，跳到第10步'
                        : '手动按压动衔铁，脱扣器无法复位 → 脱扣器卡死', 2000);
                    await new Promise(r => setTimeout(r, 1000));
                    qf._uvPressed = false;
                    await new Promise(r => setTimeout(r, 1000));
                },
                check() {
                    const qf = this.sys.comps['qf1'];
                    // 必须实际按压过动衔铁，且已记录本次按压的复位结果
                    return qf && qf._uvPressCount > 0 && qf._uvPressResult !== null;
                },
                async next() {
                    const qf = this.sys.comps['qf1'];
                    if (!qf) return 7;
                    // 依据实际按压结果判定：按压后脱扣器复位 → 反作用弹簧弹力过大，跳到第10步
                    if (qf._uvPressResult === true) return 9;
                    // 按压后脱扣器无法复位 → 脱扣器卡死 → 第9步(索引8)
                    return 8;
                },
            },
            {
                msg: '9. 若手动按压，脱扣轴也无法复位，可确认失压脱扣器卡死',
                mode: 'check',
                async act() {
                    this.sys.showFloatingTip('失压脱扣器卡死已确定，进入第10步复位故障并重新合闸', 2000);
                    await new Promise(r => setTimeout(r, 1500));
                },
                check() {
                    const qf = this.sys.comps['qf1'];
                    return qf && qf._faultUVStuck;
                },
                next: 9,
            },
            {
                msg: '10. 复位主开关合不上闸故障，重新合闸',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 300));
                    const cfg = this.sys.FAULT_CONFIG['sw_no_close'];
                    if (cfg) cfg.repair();
                    const qf = this.sys.comps['qf1'];
                    if (!qf) return;
                    if (!qf.isCharged()) { qf._chargeProg = 5; qf._charged = true; }
                    const dc = this.sys.comps['dc_uv'];
                    if (dc) dc.isOn = true;
                    qf._uvOn = true;
                    qf.tryClose();
                    await new Promise(r => setTimeout(r, 2000));
                },
                check() {
                    const cfg = this.sys.FAULT_CONFIG['sw_no_close'];
                    const qf = this.sys.comps['qf1'];
                    return cfg && qf && !cfg.check() && qf.getState() === 'on';
                },
            },
            {
                msg: '11. 测试题：船舶发电机主开关无法合闸的检查方法',
                mode: 'quiz',
                quizConfig: {
                    question: '船舶发电机主开关无法合闸时，正确的检查顺序是？',
                    options: [
                        '先看储能指示、再试遥控/手动合闸，最后检查失压脱扣器',
                        '直接拆开主开关检查触头磨损情况',
                        '先检查汇流排绝缘电阻，再更换发电机',
                        '反复多次按合闸按钮直到合闸成功',
                    ],
                    answer: 0,
                    analysis: '主开关无法合闸的检查应按“先判断储能→再区分遥控/手动合闸→最后查失压脱扣器”的顺序进行：看储能是否到位；遥控合闸无反应时试手动合闸判断合闸回路；储能释放仍合不上则检查失压脱扣器，测线圈电阻、通电试验并按压动衔铁，逐步定位故障。',
                },
            },
        ],
    },
    'acb-drawer-ops': {
        id: 'acb-drawer-ops',
        name: '4. 可抽拉式主开关的操作',
        steps: [
            {
                msg: '1. 使用操作手柄，将主开关从连接位（Connected）摇到测试位（Test）：点击主开关左上角工作位圆盘右半侧，连续点击3次切换一档',
                mode: 'check',
                async act() {
                    const qf = this.sys.comps['qf1'];
                    if (!qf) return;
                    // 演示模式：确保分闸，模拟顺时针摇 3 次从连接位切到测试位
                    if (qf.getState() !== 'off') qf.tryTrip();
                    await new Promise(r => setTimeout(r, 300));
                    this.sys.showFloatingTip('正在使用操作手柄将主开关从连接位摇到测试位…', 1800);
                    qf._dialTurn(1); qf._dialTurn(1); qf._dialTurn(1);
                    await new Promise(r => setTimeout(r, 1200));
                },
                check() {
                    const qf = this.sys.comps['qf1'];
                    return qf && qf.getWorkPos() === 1;   // 测试位
                },
                next: 1,
            },
            {
                msg: '2. 测试题：测试位（Test）的特征',
                mode: 'quiz',
                quizConfig: {
                    question: '主开关处于测试位（Test）时，下列描述正确的是？',
                    options: [
                        '主回路与汇流排、发电机断开，控制线圈保持通电，可进行分合闸试验',
                        '主回路保持连接，仅断开控制回路',
                        '主回路与全部控制线圈均断开，可安全检修',
                        '主开关仍带额定电流运行，仅仪表切换量程',
                    ],
                    answer: 0,
                    analysis: '测试位时，主开关本体从连接位摇出，主回路触头与汇流排、发电机母排脱离（不带电），但控制回路保持连接，可通电进行储能、合闸、分闸等动作试验，验证主开关机构与控制功能是否正常。',
                },
            },
            {
                msg: '3. 使用操作手柄，将主开关从测试位（Test）摇到脱开位（Disconnected）：点击工作位圆盘右半侧3次',
                mode: 'check',
                async act() {
                    const qf = this.sys.comps['qf1'];
                    if (!qf) return;
                    this.sys.showFloatingTip('正在将主开关从测试位摇到脱开位…', 1800);
                    qf._dialTurn(1); qf._dialTurn(1); qf._dialTurn(1);
                    await new Promise(r => setTimeout(r, 1200));
                },
                check() {
                    const qf = this.sys.comps['qf1'];
                    return qf && qf.getWorkPos() === 2;   // 脱开位
                },
                next: 3,
            },
            {
                msg: '4. 测试题：脱开位（检修位）的特征',
                mode: 'quiz',
                quizConfig: {
                    question: '主开关处于脱开位（Disconnected，检修位）时，下列描述正确的是？',
                    options: [
                        '主回路与全部控制线圈均断开，主开关完全断电，可抽出检修',
                        '主回路断开，控制线圈仍通电可操作',
                        '主回路与控制回路均保持连接，仅机械锁定',
                        '主开关仍能正常分合闸运行',
                    ],
                    answer: 0,
                    analysis: '脱开位（检修位）时，主开关从开关柜中完全抽出，主回路触头与汇流排、发电机母排断开，同时控制回路、脱扣器线圈等全部断开，主开关完全不带电，方可进行抽出检修、更换触头等维护作业。',
                },
            },
            {
                msg: '5. 将主开关从脱开位（Disconnected）摇到测试位（Test）：点击工作位圆盘左半侧3次（逆时针）',
                mode: 'check',
                async act() {
                    const qf = this.sys.comps['qf1'];
                    if (!qf) return;
                    this.sys.showFloatingTip('正在将主开关从脱开位摇回测试位…', 1800);
                    qf._dialTurn(-1); qf._dialTurn(-1); qf._dialTurn(-1);
                    await new Promise(r => setTimeout(r, 1200));
                },
                check() {
                    const qf = this.sys.comps['qf1'];
                    return qf && qf.getWorkPos() === 1;   // 测试位
                },
                next: 5,
            },
            {
                msg: '6. 将主开关从测试位（Test）摇到连接位（Connected）：点击工作位圆盘左半侧3次（逆时针）',
                mode: 'check',
                async act() {
                    const qf = this.sys.comps['qf1'];
                    if (!qf) return;
                    this.sys.showFloatingTip('正在将主开关从测试位摇回连接位…', 1800);
                    qf._dialTurn(-1); qf._dialTurn(-1); qf._dialTurn(-1);
                    await new Promise(r => setTimeout(r, 1200));
                },
                check() {
                    const qf = this.sys.comps['qf1'];
                    return qf && qf.getWorkPos() === 0;   // 连接位
                },
                next: 6,
            },
            {
                msg: '7. 测试题：连接位（工作位）的特征',
                mode: 'quiz',
                quizConfig: {
                    question: '主开关处于连接位（Connected，工作位）时，下列描述正确的是？',
                    options: [
                        '主回路触头与汇流排、发电机母排可靠接通，控制线圈通电，主开关正常投入运行',
                        '主回路断开，仅控制回路通电',
                        '主回路与控制回路均断开，可抽出检修',
                        '主回路接通但控制回路断电，无法分合闸',
                    ],
                    answer: 0,
                    analysis: '连接位（工作位）时，主开关完全推入开关柜，主回路触头与汇流排、发电机母排可靠接通，同时控制回路通电，主开关处于正常工作状态，可正常进行储能、合闸、分闸及保护动作。',
                },
            },
        ],
    },
};

export const componentConfigs = [
    // ── 主回路：同步发电机 → 主开关 → 汇流排 ──
    { Class: SyncGenerator3P, id: 'gen1', x: 90, y: 700, vRms: 230, freq: 50, isOn: false, label: '同步发电机', ratedPower: 400, ratedVoltage: 400, ratedCosPhi: 0.8, visible: true },
    { Class: MarineMainsSwitch, id: 'qf1', x: -100, y: 220, ratedCtrlVoltage: 24, label: '主开关',  visible: true },
    { Class: MarineElectronicTrip, id: 'et1', x: 700, y: 650, In: 100, Un: 380, phase: '3', cosPhi: 0.8, label: 'ET', visible: true },
    // ── 控制端子共用地 ──
    // 主开关 5 个线圈（储能电机 m / 合闸 c / 失压 uv / 分励 fl / 电子脱扣 et）的负极公共接地
    { Class: Ground, id: 'gnd_qf', x: 560, y: 580, visible: true },
    // 电子脱扣器脱扣输出 t2 与 24V 电源负极 vn 公共接地
    { Class: Ground, id: 'gnd_et', x: 890, y: 640, visible: true },
    // 直流 24V 电源负极接地
    { Class: Ground, id: 'gnd_dc', x: 1050, y: 340, visible: true },
    // 主开关控制按钮：停止按钮（红、NC）、起动按钮（绿、NO）与合闸按钮（绿、NO）
    { Class: DiagramStopButton, id: 'sb', x: 780, y: 360, label: '模拟失压', visible: true },
    { Class: DiagramStartButton, id: 'ss', x: 860, y: 440, label: '分闸', visible: true },
    { Class: DiagramStartButton, id: 'sc', x: 700, y: 280, label: '合闸', visible: true },
    { Class: Busbar3P, id: 'bus1', x: 220, y: 30, tapsPerPhase: 6, label: '汇流排', visible: true },

    // ── 控制电源（DC 24V）：失压脱扣线圈 ──
    { Class: DCPower, id: 'dc_uv', x: 1100, y: 150, voltage: 24, isOn: true, label: '失压脱扣电源', visible: true },

    // ── 汇流排馈出支路 ──
    // 支路1（第7列）：三相空气开关 QF2 → 三相感应电机（Y 接法）
    { Class: DiagramThreePhaseACB, id: 'acb_m', x: 1310, y: 470, initState: 'off', label: 'QF2', ratedVoltage: 380, ratedCurrent: 100, tripCurrent: 10, visible: true },
    { Class: InductionMotor2, id: 'im01', x: 1290, y: 620, visible: true,
        R1: 0.50, Lsigma1: 0.00334, Rc: 300, Lm: 0.0796,
        R2: 0.46, Lsigma2: 0.00334,
        J: 0.12, B: 0.01, polePairs: 2,
        ratedPower: 10, ratedSpeed: 1440,
        simpleModel: true, loadTorque: 20 },
    // 支路2（第8列）：三相空气开关 QF3 → 三盏白炽灯（分别接 L1/L2/L3）
    { Class: DiagramThreePhaseACB, id: 'acb_l', x: 1535, y: 460, initState: 'off', label: 'QF3', ratedVoltage: 380, ratedCurrent: 100, tripCurrent: 10, visible: true },
    { Class: IncandescentLamp, id: 'lamp1', x: 1550, y: 670, coldResistance: 4.84, rotation: 90 },
    { Class: IncandescentLamp, id: 'lamp2', x: 1620, y: 670, coldResistance: 4.84, rotation: 90 },
    { Class: IncandescentLamp, id: 'lamp3', x: 1690, y: 670, coldResistance: 4.84, rotation: 90 },
    { Class: Ground, id: 'gnd_l', x: 1650, y: 870, visible: true },

    { Class: Multimeter, id: 'multimeter', x: 920, y: 100, visible: false },
    { Class: MF47Multimeter, id: 'mf47-panel', x: 1050, y: 150, visible: false },
    { Class: Oscilloscope_tri, id: 'osc', x: 50, y: 50, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 50, y: 50, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 50, y: 50, visible: false },
    { Class: ElecMeter, id: 'elecmeter', x: 50, y: 50, visible: false },
];

// ─── 接线辅助 ───

function _autoWire(sys) {
    sys.conns.length = 0;
    const cons = [
        // ── 主回路：同步发电机 → 主开关 → 汇流排 ──
        { from: 'gen1_wire_u', to: 'qf1_wire_t1', type: 'wire' },
        { from: 'gen1_wire_v', to: 'qf1_wire_t2', type: 'wire' },
        // 第3相（W）串联电子脱扣器电流采样端（I+ → 发电机，I- → 主开关）
        { from: 'gen1_wire_w', to: 'et1_wire_i+', type: 'wire' },
        { from: 'et1_wire_i-', to: 'qf1_wire_t3', type: 'wire' },
        { from: 'qf1_wire_l1', to: 'bus1_wire_l1_1', type: 'wire' },
        { from: 'qf1_wire_l2', to: 'bus1_wire_l2_1', type: 'wire' },
        { from: 'qf1_wire_l3', to: 'bus1_wire_l3_1', type: 'wire' },
        // ── 电子脱扣器：测量第3相相电压（W-N）、24V 供电、脱扣输出接主开关 ET ──
        { from: 'gen1_wire_w', to: 'et1_wire_u+', type: 'wire' },
        { from: 'gen1_wire_n', to: 'et1_wire_u-', type: 'wire' },
        { from: 'dc_uv_wire_p', to: 'et1_wire_vp', type: 'wire' },
        // 直流 24V 电源负极接地
        { from: 'dc_uv_wire_n', to: 'gnd_dc_wire_gnd', type: 'wire' },
        { from: 'et1_wire_t1', to: 'qf1_wire_et1', type: 'wire' },
        // 电子脱扣器脱扣输出负极 t2 → 公共地
        { from: 'et1_wire_t2', to: 'gnd_et_wire_gnd', type: 'wire' },
        // 电子脱扣器 24V 电源负极 vn → 公共地
        { from: 'et1_wire_vn', to: 'gnd_et_wire_gnd', type: 'wire' },
        // ── 支路1：汇流排第7列三相 → QF2 → 感应电机（Y 接法）──
        { from: 'bus1_wire_l1_7', to: 'acb_m_wire_l1', type: 'wire' },
        { from: 'bus1_wire_l2_7', to: 'acb_m_wire_l2', type: 'wire' },
        { from: 'bus1_wire_l3_7', to: 'acb_m_wire_l3', type: 'wire' },
        { from: 'acb_m_wire_t1', to: 'im01_wire_u1', type: 'wire' },
        { from: 'acb_m_wire_t2', to: 'im01_wire_v1', type: 'wire' },
        { from: 'acb_m_wire_t3', to: 'im01_wire_w1', type: 'wire' },
        { from: 'im01_wire_u2', to: 'im01_wire_v2', type: 'wire' },
        { from: 'im01_wire_v2', to: 'im01_wire_w2', type: 'wire' },
        // ── 支路2：汇流排第8列三相 → QF3 → 三盏白炽灯（L1/L2/L3 各一）→ 接地 ──
        { from: 'bus1_wire_l1_8', to: 'acb_l_wire_l1', type: 'wire' },
        { from: 'bus1_wire_l2_8', to: 'acb_l_wire_l2', type: 'wire' },
        { from: 'bus1_wire_l3_8', to: 'acb_l_wire_l3', type: 'wire' },
        { from: 'acb_l_wire_t1', to: 'lamp1_wire_l', type: 'wire' },
        { from: 'acb_l_wire_t2', to: 'lamp2_wire_l', type: 'wire' },
        { from: 'acb_l_wire_t3', to: 'lamp3_wire_l', type: 'wire' },
        { from: 'lamp1_wire_r', to: 'gnd_l_wire_gnd', type: 'wire' },
        { from: 'lamp2_wire_r', to: 'gnd_l_wire_gnd', type: 'wire' },
        { from: 'lamp3_wire_r', to: 'gnd_l_wire_gnd', type: 'wire' },
        // ── 控制回路：DC 24V 正极 → 停止按钮 SB1（常闭 NC）→ 失压脱扣线圈 uv → 公共地
        //    停止按钮用于正常停机：按下断开 → 失压线圈断电 → 主开关分闸
        { from: 'dc_uv_wire_p', to: 'sb_wire_nc4', type: 'wire' },
        { from: 'sb_wire_nc3', to: 'qf1_wire_uv1', type: 'wire' },
        { from: 'qf1_wire_uv2', to: 'gnd_qf_wire_gnd', type: 'wire' },
        // ── 控制回路：DC 24V 正极 → 起动按钮 SB2（常开 NO）→ 分励脱扣线圈 fl → 公共地
        //    按下起动按钮（闭合）→ 分励线圈得电 → 主开关分闸
        { from: 'dc_uv_wire_p', to: 'ss_wire_no2', type: 'wire' },
        { from: 'ss_wire_no1', to: 'qf1_wire_fla', type: 'wire' },
        { from: 'qf1_wire_flb', to: 'gnd_qf_wire_gnd', type: 'wire' },
        // ── 控制回路：DC 24V 正极 → 合闸按钮 SB3（常开 NO）→ 合闸线圈 c1 → 公共地 ──
        //    按下合闸按钮（闭合）→ 合闸线圈得电 → 主开关合闸
        { from: 'dc_uv_wire_p', to: 'sc_wire_no2', type: 'wire' },
        { from: 'sc_wire_no1', to: 'qf1_wire_c1', type: 'wire' },
        // ── 储能电机电源：DC 24V 正极 → 主开关储能电机（m1/m2），负极 → 公共地 ──
        { from: 'dc_uv_wire_p', to: 'qf1_wire_m1', type: 'wire' },
        { from: 'qf1_wire_m2', to: 'gnd_qf_wire_gnd', type: 'wire' },
        // ── 主开关其余线圈负极 → 公共地：合闸线圈 c2、电子脱扣 et2 ──
        { from: 'qf1_wire_c2', to: 'gnd_qf_wire_gnd', type: 'wire' },
        { from: 'qf1_wire_et2', to: 'gnd_qf_wire_gnd', type: 'wire' },
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
    // 起动发电机
    const gen = sys.comps.gen1;
    if (gen) gen.isOn = true;
}

export function fiveStep() {
}
