// 船舶发电机主开关仿真工程（同步发电机 + 汇流排 + 船用框架式空气断路器）

import { SyncGenerator3P } from '../components/SyncGenerator3P.js';
import { Busbar3P } from '../components/Busbar3P.js';
import { MarineMainsSwitch } from '../components/MarineMainsSwitch.js';
import { MarineElectronicTrip } from '../components/MarineElectronicTrip.js';
import { DCPower } from '../components/DCPower.js';
import { Ground } from '../components/Gnd.js';
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
import { RealMegohmMeter } from '../components/RealMegohmMeter.js';
import { DistributionBox } from '../components/DistributionBox.js';
import { ThreePhaseLoad } from '../components/ThreePhaseLoad.js';


export const FAULT_CONFIGS = {
    // ── 1. 主汇流排短路：汇流排第 7 对三相触点（L1/L2/L3）强制合为一簇 ──
    bus_short: {
        id: 'bus_short', name: '1. 主汇流排短路', system: '汇流排',
        check() {
            const s = window.sys;
            return !!(s && s._faultShortGroups && s._faultShortGroups.some(g => g[0] === 'bus1_wire_l1_7'));
        },
        trigger() {
            const s = window.sys;
            if (!s) return;
            if (!s._faultShortGroups) s._faultShortGroups = [];
            const g = ['bus1_wire_l1_7', 'bus1_wire_l2_7', 'bus1_wire_l3_7'];
            s._faultShortGroups = s._faultShortGroups.filter(x => x[0] !== g[0]);
            s._faultShortGroups.push(g);
        },
        repair() {
            const s = window.sys;
            if (!s || !s._faultShortGroups) return;
            s._faultShortGroups = s._faultShortGroups.filter(x => x[0] !== 'bus1_wire_l1_7');
        },
    },
    // ── 2. 重要负载短路：三相可调负载三个输入端口强制合为一簇 ──
    tload_short: {
        id: 'tload_short', name: '2. 重要负载短路', system: '三相可调负载',
        check() {
            const s = window.sys;
            return !!(s && s._faultShortGroups && s._faultShortGroups.some(g => g[0] === 'tload_wire_l1'));
        },
        trigger() {
            const s = window.sys;
            if (!s) return;
            if (!s._faultShortGroups) s._faultShortGroups = [];
            const g = ['tload_wire_l1', 'tload_wire_l2', 'tload_wire_l3'];
            s._faultShortGroups = s._faultShortGroups.filter(x => x[0] !== g[0]);
            s._faultShortGroups.push(g);
        },
        repair() {
            const s = window.sys;
            if (!s || !s._faultShortGroups) return;
            s._faultShortGroups = s._faultShortGroups.filter(x => x[0] !== 'tload_wire_l1');
        },
    },
    // ── 3. 1#发电机调速器故障：频率降到 25Hz，线电压降到 280V ──
    gen_governor_fault: {
        id: 'gen_governor_fault', name: '3. 1#发电机调速器故障', system: '同步发电机',
        check() {
            const c = window.sys && window.sys.comps && window.sys.comps.gen1;
            return !!(c && c._faultGovernor);
        },
        trigger() {
            const c = window.sys && window.sys.comps && window.sys.comps.gen1;
            if (c) { c._faultGovernor = true; c._faultAVR = false; }
        },
        repair() {
            const c = window.sys && window.sys.comps && window.sys.comps.gen1;
            if (c) c._faultGovernor = false;
        },
    },
    // ── 4. 1#发电机调压器故障：线电压降到 200V ──
    gen_avr_fault: {
        id: 'gen_avr_fault', name: '4. 1#发电机调压器故障', system: '同步发电机',
        check() {
            const c = window.sys && window.sys.comps && window.sys.comps.gen1;
            return !!(c && c._faultAVR);
        },
        trigger() {
            const c = window.sys && window.sys.comps && window.sys.comps.gen1;
            if (c) { c._faultAVR = true; c._faultGovernor = false; }
        },
        repair() {
            const c = window.sys && window.sys.comps && window.sys.comps.gen1;
            if (c) c._faultAVR = false;
        },
    },
};

export const PROJECT_WORKFLOWS = {
    'short-fault-detect': {
        id: 'short-fault-detect',
        name: '1. 发电机短路故障的判断和排除',
        steps: [
            // ── 故障①：主汇流排短路 ──
            {
                msg: '1. 接线，起动发电机，合闸供电，起动重要负载，然后触发汇流排短路故障',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    // 1. 接线
                    _autoWire(sys);
                    // 2. 起动发电机
                    const gen = sys.comps['gen1'];
                    if (gen) gen.isOn = true;
                    // 3. 合闸供电（储能后合闸）
                    _qfChargeClose(sys);
                    // 4. 起动重要负载（配电箱三个开关合闸：电机、照明、三相可调负载）
                    const pdb = sys.comps['pdb1'];
                    if (pdb) { pdb.close(0); pdb.close(1); pdb.close(2); }
                    await new Promise(r => setTimeout(r, 2000));
                    // 5. 触发汇流排短路故障
                    const cfg = this.sys.FAULT_CONFIG && this.sys.FAULT_CONFIG['bus_short'];
                    if (cfg) cfg.trigger();
                    this.sys.showFloatingTip('主汇流排短路故障已触发', 1800);
                },
                check() {
                    const sys = this.sys;
                    // 接线完成（主回路连通：发电机→主开关→汇流排→配电箱）
                    const c = (a, b) => sys.isPortConnected(a, b);
                    if (!c('gen1_wire_u', 'qf1_wire_t1')) return false;
                    if (!c('qf1_wire_l1', 'bus1_wire_l1_1')) return false;
                    if (!c('bus1_wire_l1_8', 'pdb1_wire_in1')) return false;
                    // 发电机已起动
                    const gen = sys.comps['gen1'];
                    if (!gen || !gen.isOn) return false;
                    // 重要负载已起动（配电箱三个开关均处于合位）
                    const pdb = sys.comps['pdb1'];
                    const st = pdb ? pdb.getStates() : [];
                    if (st[0] !== 'on' || st[1] !== 'on' || st[2] !== 'on') return false;
                    // 汇流排短路故障已触发
                    const cfg = sys.FAULT_CONFIG && sys.FAULT_CONFIG['bus_short'];
                    return cfg && cfg.check();
                },
            },
            {
                msg: '2. 观察电子脱扣器显示，确认短路故障（点击电子脱扣器）',
                mode: 'find', target: 'et1',
            },
            {
                msg: '3. 断开动力负载和照明负载（电机星形点 U2/V2/W2、白炽灯 r 端及接地脱开）',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    _removeConnPairs(sys, [
                        ['im01_wire_u2', 'im01_wire_v2'],
                        ['im01_wire_v2', 'im01_wire_w2'],
                        ['lamp1_wire_r', 'lamp2_wire_r'],
                        ['lamp2_wire_r', 'lamp3_wire_r'],
                        ['lamp2_wire_r', 'gnd_l_wire_gnd'],
                    ]);
                    await new Promise(r => setTimeout(r, 600));
                    this.sys.showFloatingTip('动力、照明负载已断开', 1500);
                },
                check() {
                    const sys = this.sys;
                    const c = (a, b) => sys.isPortConnected(a, b);
                    if (c('im01_wire_u2', 'im01_wire_v2')) return false;
                    if (c('im01_wire_v2', 'im01_wire_w2')) return false;
                    if (c('lamp1_wire_r', 'lamp2_wire_r')) return false;
                    if (c('lamp2_wire_r', 'lamp3_wire_r')) return false;
                    if (c('lamp2_wire_r', 'gnd_l_wire_gnd')) return false;
                    return true;
                },
            },
            {
                msg: '4. 调出手摇兆欧表，检测干线绝缘电阻(汇流排第2个端子的ab接线柱),短路故障时为 0.',
                mode: 'check',
                act() {
                    const sys = this.sys;
                    sys.toggleInstrumentVisibility('megohm', true);
                    _connectMegohm(sys, 'bus1_wire_l1_2', 'bus1_wire_l2_2');
                    const mg = sys.comps['megohm'];
                    if (mg) { mg._stopValue = null; mg.setCranking(true); }
                },
                check() {
                    const sys = this.sys;
                    const mg = sys.comps['megohm'];
                    if (!mg || !mg.group || !mg.group.visible()) return false;
                    if (!mg.isCranking()) return false;
                    if (!_sameCluster(sys, 'megohm_wire_l', 'bus1_wire_l1_2')) return false;
                    if (!_sameCluster(sys, 'megohm_wire_e', 'bus1_wire_l2_2')) return false;
                    const r = mg.getResistance();
                    return isFinite(r) && r < 0.5;   // 干线短路 → 读数为 0
                },
            },
            {
                msg: '5. 修复短路故障，合闸，恢复供电，恢复负载运行',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    const cfg = sys.FAULT_CONFIG && sys.FAULT_CONFIG['bus_short'];
                    if (cfg) cfg.repair();
                    const mg = sys.comps['megohm'];
                    if (mg) { mg.setCranking(false); }
                    _disconnectMegohm(sys);
                    sys.toggleInstrumentVisibility('megohm', false);
                    // 恢复电机/照明星形接线
                    _addConnPairs(sys, [
                        ['im01_wire_u2', 'im01_wire_v2'],
                        ['im01_wire_v2', 'im01_wire_w2'],
                        ['lamp1_wire_r', 'lamp2_wire_r'],
                        ['lamp2_wire_r', 'lamp3_wire_r'],
                        ['lamp2_wire_r', 'gnd_l_wire_gnd'],
                    ]);
                    const pdb = sys.comps['pdb1'];
                    if (pdb) { pdb.close(0); pdb.close(1); }
                    const et = sys.comps['et1'];
                    if (et && typeof et.reset === 'function') et.reset();
                    _qfChargeClose(sys);
                    await new Promise(r => setTimeout(r, 2500));
                    this.sys.showFloatingTip('主汇流排短路已修复，供电恢复', 1800);
                },
                check() {
                    const sys = this.sys;
                    const cfg = sys.FAULT_CONFIG && sys.FAULT_CONFIG['bus_short'];
                    if (cfg && cfg.check()) return false;
                    const qf = sys.comps['qf1'];
                    if (!qf || qf.getState() !== 'on') return false;
                    const pdb = sys.comps['pdb1'];
                    const st = pdb ? pdb.getStates() : [];
                    return st[0] === 'on' && st[1] === 'on';
                },
            },
            // ── 故障②：重要负载（三相可调负载）短路 ──
            {
                msg: '6. 触发重要负载短路故障，主开关跳闸',
                mode: 'check',
                async act() {
                    const cfg = this.sys.FAULT_CONFIG && this.sys.FAULT_CONFIG['tload_short'];
                    if (cfg) cfg.trigger();
                    this.sys.showFloatingTip('重要负载短路故障已触发，主开关将跳闸', 2000);
                    await new Promise(r => setTimeout(r, 2500));
                },
                check() {
                    const cfg = this.sys.FAULT_CONFIG && this.sys.FAULT_CONFIG['tload_short'];
                    if (!cfg || !cfg.check()) return false;
                    const qf = this.sys.comps['qf1'];
                    return qf && qf.getState() === 'off';
                },
            },
            {
                msg: '7. 使用兆欧表检测干线绝缘电阻（重要负载短路时为 0）',
                mode: 'check',
                act() {
                    const sys = this.sys;
                    sys.toggleInstrumentVisibility('megohm', true);
                    _connectMegohm(sys, 'bus1_wire_l1_2', 'bus1_wire_l2_2');
                    const mg = sys.comps['megohm'];
                    if (mg) { mg._stopValue = null; mg.setCranking(true); }
                },
                check() {
                    const sys = this.sys;
                    const mg = sys.comps['megohm'];
                    if (!mg || !mg.group || !mg.group.visible()) return false;
                    if (!mg.isCranking()) return false;
                    if (!_sameCluster(sys, 'megohm_wire_l', 'bus1_wire_l1_2')) return false;
                    if (!_sameCluster(sys, 'megohm_wire_e', 'bus1_wire_l2_2')) return false;
                    const r = mg.getResistance();
                    return isFinite(r) && r < 0.5;   // 短路 → 读数为 0
                },
            },
            {
                msg: '8. 逐个拉掉负载开关，绝缘电阻恢复正常的那一路即短路支路.',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    const pdb = sys.comps['pdb1'];
                    const mg = sys.comps['megohm'];
                    if (!pdb) return;
                    // 依次拉开关，观察兆欧表读数
                    for (const idx of [0, 1, 2]) {
                        if (pdb.getStates()[idx] !== 'off') pdb.open(idx);
                        await new Promise(r => setTimeout(r, 900));
                        const rr = mg ? mg.getResistance() : Infinity;
                        this.sys.showFloatingTip(`开关${idx + 1}已拉掉，兆欧表读数 ${isFinite(rr) ? rr.toFixed(1) : '∞'} MΩ`, 1200);
                        await new Promise(r => setTimeout(r, 1600));
                    }
                    this.sys.showFloatingTip('判断：开关3（三相可调负载）支路发生短路', 2000);
                },
                check() {
                    const sys = this.sys;
                    const pdb = sys.comps['pdb1'];
                    const mg = sys.comps['megohm'];
                    if (!pdb || !mg || !mg.group || !mg.group.visible() || !mg.isCranking()) return false;
                    // 短路支路（开关3）必须已拉掉，且兆欧表绝缘恢复
                    if (pdb.getStates()[2] !== 'off') return false;
                    if (!_sameCluster(sys, 'megohm_wire_l', 'bus1_wire_l1_2')) return false;
                    if (!_sameCluster(sys, 'megohm_wire_e', 'bus1_wire_l2_2')) return false;
                    const r = mg.getResistance();
                    return !isFinite(r) || r >= 50;   // 已恢复高阻（∞）
                },
            },
            {
                msg: '9. 修复重要负载短路故障，合闸，恢复供电',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    const cfg = sys.FAULT_CONFIG && sys.FAULT_CONFIG['tload_short'];
                    if (cfg) cfg.repair();
                    const mg = sys.comps['megohm'];
                    if (mg) mg.setCranking(false);
                    _disconnectMegohm(sys);
                    sys.toggleInstrumentVisibility('megohm', false);
                    const pdb = sys.comps['pdb1'];
                    if (pdb) { pdb.close(0); pdb.close(1); pdb.close(2); }
                    const et = sys.comps['et1'];
                    if (et && typeof et.reset === 'function') et.reset();
                    _qfChargeClose(sys);
                    await new Promise(r => setTimeout(r, 2500));
                    this.sys.showFloatingTip('重要负载短路已修复，供电恢复', 1800);
                },
                check() {
                    const sys = this.sys;
                    const cfg = this.sys.FAULT_CONFIG && this.sys.FAULT_CONFIG['tload_short'];
                    if (cfg && cfg.check()) return false;
                    const qf = sys.comps['qf1'];
                    return (!qf || qf.getState() !== 'on') ? false : true;
                },
            },
            {
                msg: '10. 测试题：选择性保护设置不当的后果',
                mode: 'quiz',
                quizConfig: {
                    question: '船舶电网中，如果上、下级保护电器的选择性保护（保护配合）设置不当，会导致下列哪种后果？',
                    options: [
                        '某支路发生故障时，上一级保护电器（主开关或更上级）也同时动作，扩大停电范围，造成全船或大范围失电',
                        '故障支路的保护电器更快动作，仅切除故障支路，不影响其他支路供电',
                        '保护电器在故障时完全不动作，设备被烧毁但系统供电不受影响',
                        '保护电器的整定值自动修正，无需人为整定',
                    ],
                    answer: 0,
                    analysis: '选择性保护（保护配合）要求上、下级保护电器之间合理整定：当下级支路发生短路/过载故障时，应由距故障点最近的保护电器先动作切除故障，上级保护不应越级跳闸。若选择性设置不当（如上下级整定值不配合、时间不配合），下级支路故障时上级主开关可能同时或先跳闸，扩大停电范围，导致全船或大范围失电。',
                },
            },
            {
                msg: '11. 测试题：发电机主开关短路跳闸后，应使用什么仪表检查短路',
                mode: 'quiz',
                quizConfig: {
                    question: '发电机主开关因短路保护跳闸后，在查找、确认短路故障点时，通常应使用下列哪种仪表检查？',
                    options: [
                        '兆欧表（绝缘电阻表/摇表），断电后测量干线绝缘电阻，短路时读数接近 0',
                        '万用表交流电压挡，带电测量电压判断短路',
                        '钳形电流表，带电测量电流判断短路',
                        '相位表，测量电压相位判断短路',
                    ],
                    answer: 0,
                    analysis: '主开关短路跳闸后查找故障点应在断电状态下进行，使用兆欧表（绝缘电阻表/摇表）测量干线（汇流排、馈线）的绝缘电阻：正常时绝缘电阻很高（数十 MΩ 以上），短路时读数接近 0。通过逐段、逐支路断开后测量，可快速定位短路支路。带电测量电压或电流不能直接判断绝缘/短路情况，且带电操作存在安全风险。',
                },
            },
        ],
    },

    'overload-detect': {
        id: 'overload-detect',
        name: '2. 发电机过载故障的判断和处理',
        steps: [
            {
                msg: '1. 接线，起动发电机，合闸供电，逐个接通负载',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    _autoWire(sys);
                    const gen = sys.comps['gen1'];
                    if (gen) gen.isOn = true;
                    _qfChargeClose(sys);
                    const pdb = sys.comps['pdb1'];
                    if (pdb) { pdb.close(0); pdb.close(1); pdb.close(2); }
                    const tload = sys.comps['tload'];
                    if (tload) {
                        tload.powerKw = 20;
                        tload._recalcLoad();
                        tload.config.powerKw = 20;
                        tload._loaded = true;
                        tload.config.loaded = true;
                        tload._refresh();
                    }
                    await new Promise(r => setTimeout(r, 2500));
                    this.sys.showFloatingTip('接线完成，发电机起动，合闸供电，负载全部接通', 1800);
                },
                check() {
                    const sys = this.sys;
                    const c = (a, b) => sys.isPortConnected(a, b);
                    if (!c('gen1_wire_u', 'qf1_wire_t1')) return false;
                    if (!c('qf1_wire_l1', 'bus1_wire_l1_1')) return false;
                    if (!c('bus1_wire_l1_8', 'pdb1_wire_in1')) return false;
                    const gen = sys.comps['gen1'];
                    if (!gen || !gen.isOn) return false;
                    const qf = sys.comps['qf1'];
                    if (!qf || qf.getState() !== 'on') return false;
                    const pdb = sys.comps['pdb1'];
                    const st = pdb ? pdb.getStates() : [];
                    if (!(st[0] === 'on' && st[1] === 'on' && st[2] === 'on')) return false;
                    return true;
                },
            },
            {
                msg: '2. 将三相可调负载从60kw逐步调为 80kW，观察自动分级卸载（电子脱扣器过载 5s 卸第1路、10s 卸第2路）',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    const tload = sys.comps['tload'];
                    if (tload) {
                        tload.powerKw = 80;
                        tload._recalcLoad();
                        tload.config.powerKw = 80;
                        tload._loaded = true;
                        tload.config.loaded = true;
                        tload._refresh();
                    }
                    this.sys.showFloatingTip('三相可调负载调至 80kW，观察自动分级卸载', 1800);
                    await new Promise(r => setTimeout(r, 2000));
                },
                check() {
                    const sys = this.sys;
                    const tload = sys.comps['tload'];
                    if (!tload || Math.abs(tload.powerKw - 80) > 1) return false;
                    // 分级卸载已动作：第1路已脱扣（或正在脱扣中）
                    const pdb = sys.comps['pdb1'];
                    const st = pdb ? pdb.getStates() : [];
                    if (st[0] !== 'trip' && st[1] !== 'trip') return false;
                    // 主开关必须保持合闸（分级卸载保住供电）
                    const qf = sys.comps['qf1'];
                    if (!qf || qf.getState() !== 'on') return false;
                    return true;
                },
            },
            {
                msg: '3. 继续增大负载到 110kW，观察发电机过载跳闸过程',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    const tload = sys.comps['tload'];
                    if (tload) {
                        tload.powerKw = 110;
                        tload._recalcLoad();
                        tload.config.powerKw = 110;
                    }
                    this.sys.showFloatingTip('三相可调负载调至 110kW，发电机将过载跳闸', 1800);
                    await new Promise(r => setTimeout(r, 2500));
                },
                check() {
                    const sys = this.sys;
                    const tload = sys.comps['tload'];
                    if (!tload || Math.abs(tload.powerKw - 110) > 1) return false;
                    // 过载跳闸：主开关已分闸
                    const qf = sys.comps['qf1'];
                    if (!qf || qf.getState() === 'on') return false;
                    return true;
                },
            },
            {
                msg: '4. 测试题：发电机单机运行易导致过载的情况是',
                mode: 'quiz',
                quizConfig: {
                    question: '发电机单机运行（未并联）时，下列哪种情况最容易导致过载？',
                    options: [
                        '几台大功率电动机同时直接起动，起动电流大且负载总量超过发电机额定功率',
                        '发电机频率略高于 50Hz',
                        '汇流排电压略高于额定电压',
                        '照明负荷自动切换至备用回路',
                    ],
                    answer: 0,
                    analysis: '单机运行时若同时起动多台大功率电动机，起动电流可达额定电流的 5~7 倍，且多台同时起动使总有功/视在功率超过发电机额定值，电子脱扣器将按过载延时分级卸载，严重时跳闸。',
                },
            },
            {
                msg: '5. 测试题：发电机并联运行时易导致过载的情况是',
                mode: 'quiz',
                quizConfig: {
                    question: '两台及以上发电机并联运行时，下列哪种情况最容易导致某台机组过载？',
                    options: [
                        '并联机组间功率分配不均匀，某台机组承担了超过其额定功率的负荷（如调差率设置不当或一台故障退出后负荷转移）',
                        '发电机电压设置得比额定值高',
                        '负载功率因数变高',
                        '汇流排频率波动',
                    ],
                    answer: 0,
                    analysis: '并联运行时各机组按调差率自动分配负荷。若调差率设置不当、某台机组调速特性差异大，或一台机组故障停机后其负荷全部转移至其余机组，都会造成单机过载。',
                },
            },
            {
                msg: '6. 测试题：自动分级卸载',
                mode: 'quiz',
                quizConfig: {
                    question: '关于发电机自动分级卸载（自动卸载装置），下列说法正确的是？',
                    options: [
                        '发电机过载时，按预定顺序自动切除次要负载，优先保证重要负载供电，避免发电机过载跳闸',
                        '自动分级卸载是发电机短路时的快速保护，瞬时切断全部负载',
                        '自动分级卸载只在发电机并联运行时起作用',
                        '自动分级卸载会直接分闸主开关',
                    ],
                    answer: 0,
                    analysis: '自动分级卸载装置在发电机过载时按设定延时（如 5s、10s）分级切除次要负载（如非重要动力、照明等），保留重要负载，使发电机恢复到不过载状态；若切除后仍过载则最终由电子脱扣器跳闸。',
                },
            },
        ],
    },

    'undervoltage-detect': {
        id: 'undervoltage-detect',
        name: '3. 发电机失压（欠压）故障的判断和处理',
        steps: [
            {
                msg: '1. 接线，起动发电机组，合闸供电，起动重要负载',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    _autoWire(sys);
                    const gen = sys.comps['gen1'];
                    if (gen) gen.isOn = true;
                    _qfChargeClose(sys);
                    const pdb = sys.comps['pdb1'];
                    if (pdb) { pdb.close(0); pdb.close(1); pdb.close(2); }
                    const tload = sys.comps['tload'];
                    if (tload) {
                        tload.powerKw = 20;
                        tload._recalcLoad();
                        tload.config.powerKw = 20;
                        tload._loaded = true;
                        tload.config.loaded = true;
                        tload._refresh();
                    }
                    await new Promise(r => setTimeout(r, 2500));
                    this.sys.showFloatingTip('接线完成，发电机起动，合闸供电，负载全部接通', 1800);
                },
                check() {
                    const sys = this.sys;
                    const c = (a, b) => sys.isPortConnected(a, b);
                    if (!c('gen1_wire_u', 'qf1_wire_t1')) return false;
                    if (!c('qf1_wire_l1', 'bus1_wire_l1_1')) return false;
                    if (!c('bus1_wire_l1_8', 'pdb1_wire_in1')) return false;
                    const gen = sys.comps['gen1'];
                    if (!gen || !gen.isOn) return false;
                    const qf = sys.comps['qf1'];
                    if (!qf || qf.getState() !== 'on') return false;
                    const pdb = sys.comps['pdb1'];
                    const st = pdb ? pdb.getStates() : [];
                    if (!(st[0] === 'on' && st[1] === 'on' && st[2] === 'on')) return false;
                    return true;
                },
            },
            {
                msg: '2. 触发发电机组原动机调速器故障',
                mode: 'check',
                act() {
                    const cfg = this.sys.FAULT_CONFIG && this.sys.FAULT_CONFIG['gen_governor_fault'];
                    if (cfg) cfg.trigger();
                    this.sys.showFloatingTip('原动机调速器故障已触发，频率、电压将下降', 1800);
                },
                check() {
                    const cfg = this.sys.FAULT_CONFIG && this.sys.FAULT_CONFIG['gen_governor_fault'];
                    return cfg && cfg.check();
                },
            },
            {
                msg: '3. 观察PMS或电子脱扣器参数，确认欠压脱扣、调速器故障（频率、电压都偏低，点击脱扣器通过）',
                mode: 'find', target: 'et1',
            },
            {
                msg: '4. 排除故障，复位，起动发电机组，合闸供电，起动重要负载',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    const cfg = sys.FAULT_CONFIG && sys.FAULT_CONFIG['gen_governor_fault'];
                    if (cfg) cfg.repair();
                    const et = sys.comps['et1'];
                    if (et && typeof et.reset === 'function') et.reset();
                    const qf = sys.comps['qf1'];
                    // 主开关已因欠压脱扣分闸，重新起动发电机组、合闸供电、起动负载
                    const gen = sys.comps['gen1'];
                    if (gen) gen.isOn = true;
                    _qfChargeClose(sys);
                    const pdb = sys.comps['pdb1'];
                    if (pdb) { pdb.close(0); pdb.close(1); pdb.close(2); }
                    await new Promise(r => setTimeout(r, 2500));
                    this.sys.showFloatingTip('调速器故障已排除，供电恢复', 1800);
                },
                check() {
                    const sys = this.sys;
                    const cfg = sys.FAULT_CONFIG && sys.FAULT_CONFIG['gen_governor_fault'];
                    if (cfg && cfg.check()) return false;
                    const qf = sys.comps['qf1'];
                    if (!qf || qf.getState() !== 'on') return false;
                    const gen = sys.comps['gen1'];
                    if (!gen || !gen.isOn) return false;
                    const pdb = sys.comps['pdb1'];
                    const st = pdb ? pdb.getStates() : [];
                    if (!(st[0] === 'on' && st[1] === 'on' && st[2] === 'on')) return false;
                    return true;
                },
            },
            {
                msg: '5. 触发发电机调压器故障',
                mode: 'check',
                act() {
                    const cfg = this.sys.FAULT_CONFIG && this.sys.FAULT_CONFIG['gen_avr_fault'];
                    if (cfg) cfg.trigger();
                    this.sys.showFloatingTip('调压器故障已触发，电压将下降', 1800);
                },
                check() {
                    const cfg = this.sys.FAULT_CONFIG && this.sys.FAULT_CONFIG['gen_avr_fault'];
                    return cfg && cfg.check();
                },
            },
            {
                msg: '6. 观察PMS或电子脱扣器参数，确认欠压脱扣、调压器故障（频率正常、电压偏低，点击脱扣器通过）',
                mode: 'find', target: 'et1',
            },
            {
                msg: '7. 测试题：引起发电机欠压故障的原因',
                mode: 'quiz',
                quizConfig: {
                    question: '下列哪种情况会引起发电机失压（欠压）故障？',
                    options: [
                        '原动机调速器故障，转速下降导致发电机频率、电压同时降低',
                        '发电机调压器（AVR）故障，励磁电流异常导致电压下降（频率正常）',
                        '负载短路或大功率负载投入，端电压骤降',
                        '以上均可能引起欠压故障',
                    ],
                    answer: 3,
                    analysis: '引起发电机欠压（失压）故障的常见原因：①原动机（柴油机/汽轮机）调速器故障，转速下降，频率和电压同时降低；②发电机调压器（AVR）故障，励磁电压/电流异常，电压下降而频率基本正常；③负载短路或大功率负载突然投入，发电机端电压骤降。此外还有励磁回路断线、负载功率因数过低等。',
                },
            },
        ],
    },
};

export const componentConfigs = [
    // ── 主回路：同步发电机 → 主开关 → 汇流排 ──
    { Class: SyncGenerator3P, id: 'gen1', x: -10, y: 700, vRms: 230, freq: 50, isOn: false, label: '同步发电机', ratedPower: 80, ratedVoltage: 80, ratedCosPhi: 0.8, rOn: 0.05, avrDelay: 3, avrTime: 5, maxDropV: 80, avrMaxComp: 1, visible: true },
    { Class: MarineMainsSwitch, id: 'qf1', x: -150, y: 220, ratedCtrlVoltage: 24, label: '主开关',  visible: true },
    { Class: MarineElectronicTrip, id: 'et1', x: 600, y: 600, In: 100, Un: 380, phase: '3', cosPhi: 0.8, genId: 'gen1', label: 'ET', shortMult: 4, overloadMult: 1.5, overloadTime: 15, visible: true },
    // ── 控制端子共用地 ──
    // 主开关 5 个线圈（储能电机 m / 合闸 c / 失压 uv / 分励 fl / 电子脱扣 et）的负极公共接地
    { Class: Ground, id: 'gnd_qf', x: 460, y: 580, visible: true },
    // 电子脱扣器脱扣输出 t2 与 24V 电源负极 vn 公共接地
    { Class: Ground, id: 'gnd_et', x: 790, y: 640, visible: true },
    // 直流 24V 电源负极接地
    { Class: Ground, id: 'gnd_dc', x: 850, y: 340, visible: true },
    // 主开关控制按钮：停止按钮（红、NC）、起动按钮（绿、NO）与合闸按钮（绿、NO）
    { Class: DiagramStopButton, id: 'sb', x: 680, y: 360, label: '模拟失压', visible: true },
    { Class: DiagramStartButton, id: 'ss', x: 760, y: 440, label: '分闸', visible: true },
    { Class: DiagramStartButton, id: 'sc', x: 600, y: 280, label: '合闸', visible: true },
    { Class: Busbar3P, id: 'bus1', x: 220, y: 30, tapsPerPhase: 6, label: '汇流排', visible: true },

    // ── 控制电源（DC 24V）：失压脱扣线圈 ──
    { Class: DCPower, id: 'dc_uv', x: 900, y: 150, voltage: 24, isOn: true, label: '失压脱扣电源', visible: true },

    // ── 汇流排馈出支路 ──
    // 支路1：配电箱开关1 → 三相感应电机（Y 接法）
    { Class: InductionMotor2, id: 'im01', x: 1080, y: 680, visible: true,
        R1: 0.50, Lsigma1: 0.00334, Rc: 300, Lm: 0.0796,
        R2: 0.46, Lsigma2: 0.00334,
        J: 0.12, B: 0.01, polePairs: 2,
        ratedPower: 10, ratedSpeed: 1440,
        simpleModel: true, loadTorque: 20 },
    // 支路2：配电箱开关2 → 三盏白炽灯（分别接 L1/L2/L3，r 端星形互联后接地）
    { Class: IncandescentLamp, id: 'lamp1', x: 1330, y: 770, coldResistance: 4.84, rotation: 90 },
    { Class: IncandescentLamp, id: 'lamp2', x: 1400, y: 770, coldResistance: 4.84, rotation: 90 },
    { Class: IncandescentLamp, id: 'lamp3', x: 1470, y: 770, coldResistance: 4.84, rotation: 90 },
    { Class: Ground, id: 'gnd_l', x: 1450, y: 900, visible: true },

    // 支路3：配电箱开关3 → 三相可调负载（星形，中性点 n 接地）
    { Class: ThreePhaseLoad, id: 'tload', x: 1530, y: 650, powerKw: 20, cosPhi: 1, reactive: 'ind', loaded: false, label: '三相可调负载', visible: true },

    { Class: Multimeter, id: 'multimeter', x: 820, y: 100, visible: false },
    { Class: MF47Multimeter, id: 'mf47-panel', x: 950, y: 150, visible: false },
    { Class: Oscilloscope_tri, id: 'osc', x: -50, y: 50, visible: false },
    { Class: SignalGenerator, id: 'sg', x: -50, y: 50, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: -50, y: 50, visible: false },
    { Class: ElecMeter, id: 'elecmeter', x: -50, y: 50, visible: false },
    { Class: RealMegohmMeter, id: 'megohm', x: -50, y: 50, visible: false },

    // ── 低压三相配电箱（取代原 QF2/QF3 空气开关，汇流排供电，出线接电机与照明）──
    { Class: DistributionBox, id: 'pdb1', x: 1200, y: 190, label: '低压配电箱', ratedCurrent: 100, shortDelay: 0.2, overloadK: 4, tripCoilR: 200, initStates: ['off', 'off', 'off'], visible: true },
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
        // ── 支路：配电箱进线（汇流排三相）→ 开关1→电机、开关2→照明 ──
        { from: 'bus1_wire_l1_8', to: 'pdb1_wire_in1', type: 'wire' },
        { from: 'bus1_wire_l2_8', to: 'pdb1_wire_in2', type: 'wire' },
        { from: 'bus1_wire_l3_8', to: 'pdb1_wire_in3', type: 'wire' },
        // 开关1 → 感应电机（Y 接法）
        { from: 'pdb1_wire_sw1_t1', to: 'im01_wire_u1', type: 'wire' },
        { from: 'pdb1_wire_sw1_t2', to: 'im01_wire_v1', type: 'wire' },
        { from: 'pdb1_wire_sw1_t3', to: 'im01_wire_w1', type: 'wire' },
        { from: 'im01_wire_u2', to: 'im01_wire_v2', type: 'wire' },
        { from: 'im01_wire_v2', to: 'im01_wire_w2', type: 'wire' },
        // 开关2 → 三盏白炽灯（L1/L2/L3 各一），r 端星形互联后接地
        { from: 'pdb1_wire_sw2_t1', to: 'lamp1_wire_l', type: 'wire' },
        { from: 'pdb1_wire_sw2_t2', to: 'lamp2_wire_l', type: 'wire' },
        { from: 'pdb1_wire_sw2_t3', to: 'lamp3_wire_l', type: 'wire' },
        // 三盏白炽灯中性点星形连接：r 端互联后共同接地
        { from: 'lamp1_wire_r', to: 'lamp2_wire_r', type: 'wire' },
        { from: 'lamp2_wire_r', to: 'lamp3_wire_r', type: 'wire' },
        { from: 'lamp2_wire_r', to: 'gnd_l_wire_gnd', type: 'wire' },
        // 开关3 → 三相可调负载（星形，中性点 n 接地）
        { from: 'pdb1_wire_sw3_t1', to: 'tload_wire_l1', type: 'wire' },
        { from: 'pdb1_wire_sw3_t2', to: 'tload_wire_l2', type: 'wire' },
        { from: 'pdb1_wire_sw3_t3', to: 'tload_wire_l3', type: 'wire' },
        { from: 'tload_wire_n', to: 'gnd_l_wire_gnd', type: 'wire' },
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
        // ── 电子脱扣器分励脱扣输出 → 低压配电箱分励线圈 ──
        // 过载 5s：第 1 路输出（F1）→ 配电箱开关1 分励脱扣
        { from: 'et1_wire_f1a', to: 'pdb1_wire_sw1_fla', type: 'wire' },
        { from: 'et1_wire_f1b', to: 'pdb1_wire_sw1_flb', type: 'wire' },
        // 过载 10s：第 2 路输出（F2）→ 配电箱开关2 分励脱扣
        { from: 'et1_wire_f2a', to: 'pdb1_wire_sw2_fla', type: 'wire' },
        { from: 'et1_wire_f2b', to: 'pdb1_wire_sw2_flb', type: 'wire' },
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

// ─── 工作流辅助函数 ───

/** 判断两个端口是否处于同一电路簇 */
function _sameCluster(sys, portA, portB) {
    const map = sys.voltageSolver && sys.voltageSolver.portToCluster;
    if (!map) return false;
    const cA = map.get(portA);
    const cB = map.get(portB);
    return cA !== undefined && cA === cB;
}

/** 移除多对连线 */
function _removeConnPairs(sys, pairs) {
    const conns = sys.conns || [];
    pairs.forEach(([a, b]) => {
        conns.filter(c => c.type === 'wire' &&
            ((c.from === a && c.to === b) || (c.from === b && c.to === a)))
            .forEach(c => sys.connMgr.removeConn(c));
    });
    sys.redrawAll();
}

/** 新增多对连线 */
function _addConnPairs(sys, pairs) {
    pairs.forEach(([a, b]) => {
        sys.connMgr.addConn({ from: a, to: b, type: 'wire' });
    });
    sys.redrawAll();
}

/** 兆欧表接线：清除旧连线，L→lPort、E→ePort */
function _connectMegohm(sys, lPort, ePort) {
    const l = 'megohm_wire_l';
    const e = 'megohm_wire_e';
    const conns = sys.conns || [];
    conns.filter(c => c.type === 'wire' &&
        (c.from === l || c.to === l || c.from === e || c.to === e))
        .forEach(c => sys.connMgr.removeConn(c));
    sys.connMgr.addConn({ from: l, to: lPort, type: 'wire' });
    sys.connMgr.addConn({ from: e, to: ePort, type: 'wire' });
    sys.redrawAll();
}

/** 兆欧表拆线 */
function _disconnectMegohm(sys) {
    const l = 'megohm_wire_l';
    const e = 'megohm_wire_e';
    const conns = sys.conns || [];
    conns.filter(c => c.type === 'wire' &&
        (c.from === l || c.to === l || c.from === e || c.to === e))
        .forEach(c => sys.connMgr.removeConn(c));
    sys.redrawAll();
}

/** 主开关储能满后合闸（自动恢复储能电机供电） */
function _qfChargeClose(sys) {
    const qf = sys.comps['qf1'];
    if (!qf) return;
    // 储能电机供电（m1/m2 已有自动储能），若未储能则直接补满
    if (!qf.isCharged()) { qf._chargeProg = 5; qf._charged = true; }
    if (qf.getState() === 'off') qf.tryClose();
}
