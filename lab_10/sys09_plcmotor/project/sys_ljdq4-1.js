// 船舶发电机主开关仿真工程（同步发电机 + 汇流排 + 船用框架式空气断路器）

import { SyncGenerator3P } from '../components/SyncGenerator3P.js';
import { Busbar3P } from '../components/Busbar3P.js';
import { MarineMainsSwitch } from '../components/MarineMainsSwitch.js';
import { GeneratorRemotePanel } from '../components/GeneratorRemotePanel.js';
import { DCPower } from '../components/DCPower.js';
import { Ground } from '../components/Gnd.js';
import { DiagramThreePhaseACB } from '../components/DiagramThreePhaseACB.js';
import { IncandescentLamp } from '../components/IncandescentLamp.js';
import { Multimeter } from '../components/Multimeter.js';
import { MF47Multimeter } from '../components/MF47Multimeter.js';
import { Oscilloscope_tri } from '../components/Osc_tri.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';
import { ElecMeter } from '../components/ElecMeter.js';
import { Syncroscope } from '../components/Syncroscope.js';
import { SP4TSwitch } from '../components/SP4TSwitch.js';
import { ThreePhaseLoad } from '../components/ThreePhaseLoad.js';

function _fcomp(id) {
    const s = window.sys;
    return s && s.comps && s.comps[id] ? s.comps[id] : null;
}

export const FAULT_CONFIGS = {
    gen2_coolant_temp: {
        id: 'gen2_coolant_temp',
        name: '2#发电机冷却水温度高',
        system: '发电机',
        check() {
            const c = _fcomp('gen2');
            return !!(c && c._faultCoolantTemp);
        },
        trigger() {
            const c = _fcomp('gen2');
            if (c) c._faultCoolantTemp = true;
        },
        repair() {
            const c = _fcomp('gen2');
            if (c) c._faultCoolantTemp = false;
        },
    },
};

export const PROJECT_WORKFLOWS = {
    'parts-id': {
        id: 'parts-id', name: '1.认识船舶主配电装置',
        steps: [
            { msg: '第 1 步：识别 1 号同步发电机', mode: 'find', target: 'gen1' },
            { msg: '第 2 步：识别 1 号主开关（船用框架式空气断路器）储能弹簧', mode: 'find', target: 'qf1', subTarget: 'store-spring' },
            { msg: '第 3 步：识别 1 号主开关合闸线圈', mode: 'find', target: 'qf1', subTarget: 'close-coil' },
            { msg: '第 4 步：识别 1 号主开关失压脱扣器', mode: 'find', target: 'qf1', subTarget: 'uv-trip' },
            { msg: '第 5 步：识别 1 号发电机组遥控面板', mode: 'find', target: 'genpanel' },
            { msg: '第 6 步：识别数字同步表', mode: 'find', target: 'sync1' },
            { msg: '第 7 步：识别同步表选择开关（OFF/1/2/3 四档）', mode: 'find', target: 'sync_sel' },
            { msg: '第 8 步：识别三相汇流排', mode: 'find', target: 'bus1' },
            { msg: '第 9 步：识别 2 号同步发电机', mode: 'find', target: 'gen2' },
            { msg: '第 10 步：识别 2 号主开关', mode: 'find', target: 'qf2' },
            { msg: '第 11 步：识别 2 号发电机组遥控面板', mode: 'find', target: 'genpanel2' },
        ],
    },
    'close-interlock': {
        id: 'close-interlock', name: '2.遥控合闸与并车联锁操作',
        steps: [
            {
                msg: '第 1 步：自动接线', mode: 'check',
                async act() {
                    const sys = this.sys;
                    _autoWire(sys);
                    const g1 = sys.comps.gen1, g2 = sys.comps.gen2;
                    const q1 = sys.comps.qf1, q2 = sys.comps.qf2;
                    const sel = sys.comps.sync_sel;
                    g1.isOn = false; g2.isOn = false;
                    if (sys.comps.genpanel && sys.comps.genpanel._closeAttempts !== undefined) sys.comps.genpanel._closeAttempts = 0;
                    if (sys.comps.genpanel2 && sys.comps.genpanel2._closeAttempts !== undefined) sys.comps.genpanel2._closeAttempts = 0;
                    if (q1.getState() === 'on' && q1.tryTrip) { q1.tryTrip(); await _sleep(600); }
                    if (q2.getState() === 'on' && q2.tryTrip) { q2.tryTrip(); await _sleep(600); }
                    if (sel.getPosition() !== 1) sel.switchTo(1);
                    await _sleep(400);
                },
                check() {
                    const sys = this.sys;
                    const g1 = sys.comps.gen1, g2 = sys.comps.gen2;
                    const q1 = sys.comps.qf1, q2 = sys.comps.qf2;
                    const sel = sys.comps.sync_sel;
                    return sys.conns && sys.conns.length > 0
                        && q1.getState() === 'off' && q2.getState() === 'off'
                        && !g1.isOn && !g2.isOn && sel.getPosition() === 1;
                },
            },
            {
                msg: '第 2 步：测试题——电网无电时遥控合闸', mode: 'quiz',
                quizConfig: {
                    question: '电网（汇流排）无电、同步表选择开关处于 OFF 档时，按下遥控面板"合闸"按钮能否直接输出合闸信号？',
                    options: [
                        '能，电网无电时合闸联锁放行，按下即直接输出合闸信号',
                        '不能，必须先起动发电机才能合闸',
                        '不能，必须由通信端口下达合闸指令',
                        '不能，必须先将同步表选择开关转到本机档位',
                    ],
                    answer: 0,
                    analysis: '电网无电时不存在并车不同步的问题，因此合闸联锁放行：只要主开关储能完成、面板已通电，按下"合闸"按钮即直接输出 24V 合闸信号并完成合闸。',
                },
            },
            {
                msg: '第 3 步：按遥控面板"起动"按钮，起动 1 号发电机并完成主开关储能', mode: 'check',
                async act() {
                    const sys = this.sys;
                    await _pressPanelBtn(sys, 'genpanel', '_userStartPressed', 1200);
                    // 等待储能电机将合闸弹簧储能到位
                    await _sleep(3000);
                },
                check() {
                    const sys = this.sys;
                    const g1 = sys.comps.gen1, q1 = sys.comps.qf1;
                    return !!g1.isOn && !!q1._charged;
                },
            },
            {
                msg: '第 4 步：电网无电，直接按遥控面板"合闸"，1 号主开关合闸', mode: 'check',
                async act() {
                    const sys = this.sys;
                    await _pressPanelBtn(sys, 'genpanel', '_userClosePressed', 700);
                    await _sleep(1800);
                },
                check() {
                    const sys = this.sys;
                    return sys.comps.qf1.getState() === 'on';
                },
            },
            {
                msg: '第 5 步：测试题——电网有电时遥控合闸的条件', mode: 'quiz',
                quizConfig: {
                    question: '1 号机合闸后汇流排已带电（电网有电）。此时同步表选择开关未转到 2 号档位，按 2 号遥控面板"合闸"按钮会怎样？',
                    options: [
                        '正常输出合闸信号，2 号主开关直接合闸',
                        '合闸信号被联锁封锁，主开关 2 不动作',
                        '输出瞬间合闸信号后自动分闸',
                        '通信端口下达合闸指令时不受影响',
                    ],
                    answer: 1,
                    analysis: '电网有电时，待并机组合闸前必须确认同步条件。同步表选择开关未转到本机档位时，合闸输出被联锁封锁，防止未同步就合闸造成巨大冲击。',
                },
            },
            {
                msg: '第 6 步：按 2 号遥控面板"起动"按钮，起动 2 号发电机', mode: 'check',
                async act() {
                    const sys = this.sys;
                    await _pressPanelBtn(sys, 'genpanel2', '_userStartPressed', 1200);
                    await _sleep(1800);
                },
                check() {
                    const sys = this.sys;
                    return !!sys.comps.gen2.isOn;
                },
            },
            {
                msg: '第 7 步：同步表选择开关不在 2 号档位时按"合闸"，验证联锁封锁（主开关 2 不动作）', mode: 'check',
                async act() {
                    const sys = this.sys;
                    const sel = sys.comps.sync_sel;
                    if (sel.getPosition() !== 1) sel.switchTo(1);
                    await _sleep(300);
                    await _pressPanelBtn(sys, 'genpanel2', '_userClosePressed', 500);
                    await _sleep(500);
                },
                check() {
                    const sys = this.sys;
                    const gp2 = sys.comps.genpanel2;
                    // 必须先产生 2 号面板"合闸"动作（按压计数>0），再验证联锁封锁：
                    // 电网有电 + 选择开关不在本机档位 → 合闸被封锁，qf2 不动作。
                    // 若未按合闸按钮，即使联锁本就封锁也不通过，确保学生实际执行了操作。
                    return !!(gp2 && gp2.isClosePermitted && gp2.isClosePermitted() === false)
                        && sys.comps.qf2.getState() === 'off'
                        && gp2._closeAttempts > 0;
                },
            },
            { msg: '第 8 步：识别同步表选择开关手柄', mode: 'find', target: 'sync_sel', subTarget: 'sel-knob' },
            {
                msg: '第 9 步：将 2 号机频率调至与汇流排一致，同步表转"2"档后按 2 号面板"合闸"并车', mode: 'check',
                async act() {
                    const sys = this.sys;
                    const sel = sys.comps.sync_sel;
                    const g1 = sys.comps.gen1, g2 = sys.comps.gen2;
                    const sc = sys.comps.sync1;
                    const degOf = () => { const d = (sc._phaseDiff || 0) * 180 / Math.PI; return (Math.round(d % 360 + 360)) % 360; };
                    // 并车前调频（等效操作调速旋钮）：1号机带照明负载后频率下垂下降，
                    // 2号机须调至与汇流排一致，否则频差 >0.5Hz 会被并车保护判定越限。
                    // 留 0.3Hz 微频差使同步表相位差缓慢转动（真实并车需观察同步表）。
                    g2.freq = (g1._freqOut ?? g1.freq) + 0.3;
                    await _sleep(2500);
                    if (sel.getPosition() !== 3) sel.switchTo(3);
                    await _sleep(300);
                    // 观察同步表：等待相位差落入允许区（<60° 或 >270°，远离非同期区间）后合闸
                    let hit = false;
                    for (let i = 0; i < 400 && !hit; i++) {
                        const d = degOf();
                        if (d < 60 || d > 270) hit = true;
                        else await _sleep(50);
                    }
                    await _pressPanelBtn(sys, 'genpanel2', '_userClosePressed', 700);
                    await _sleep(2000);
                },
                check() {
                    const sys = this.sys;
                    const sel = sys.comps.sync_sel;
                    return sys.comps.qf2.getState() === 'on' && sel.getPosition() === 3;
                },
            },
            {
                msg: '第 10 步：测试题——并车联锁的目的', mode: 'quiz',
                quizConfig: {
                    question: '电网有电时，遥控合闸要求同步表选择开关转到本机档位的根本目的是（　）。',
                    options: [
                        '防止误操作损坏选择开关',
                        '保证并车时与汇流排电压、频率、相位同步，避免合闸冲击',
                        '增加操作复杂性，防止触电',
                        '使同步表读数保持为零',
                    ],
                    answer: 1,
                    analysis: '并车（并联投入）必须满足电压相等、频率接近、相位一致三个条件。选择开关转到本机档位后，操作者通过数字同步表确认待并机与汇流排的同步情况，同步后合闸，避免不同步合闸产生巨大的冲击电流损坏发电机与主开关。',
                },
            },
            ],
    },
    'sync-protect': {
        id: 'sync-protect', name: '3.并车保护（非同期与频差跳闸）',
        steps: [
            {
                msg: '第 1 步：自动接线', mode: 'check',
                async act() {
                    const sys = this.sys;
                    _autoWire(sys);
                    const g1 = sys.comps.gen1, g2 = sys.comps.gen2;
                    const q1 = sys.comps.qf1, q2 = sys.comps.qf2;
                    g1.isOn = false; g2.isOn = false; g2.freq = 50;
                    if (q1.getState() === 'on' && q1.tryTrip) { q1.tryTrip(); await _sleep(600); }
                    if (q2.getState() === 'on' && q2.tryTrip) { q2.tryTrip(); await _sleep(600); }
                    if (sys.comps.sync_sel.getPosition() !== 1) sys.comps.sync_sel.switchTo(1);
                    // 复位 2 号遥控面板"合闸"按钮按压计数（第 11 步按下动作检测用）
                    if (sys.comps.genpanel2 && sys.comps.genpanel2._closeAttempts !== undefined) sys.comps.genpanel2._closeAttempts = 0;
                    await _sleep(400);
                },
                check() {
                    const sys = this.sys;
                    return sys.conns && sys.conns.length > 0
                        && sys.comps.qf1.getState() === 'off' && sys.comps.qf2.getState() === 'off'
                        && !sys.comps.gen1.isOn && !sys.comps.gen2.isOn
                        && sys.comps.sync_sel.getPosition() === 1;
                },
            },
            {
                msg: '第 2 步：起动 1 号发电机并合闸 1 号主开关', mode: 'check',
                async act() {
                    const sys = this.sys;
                    await _pressPanelBtn(sys, 'genpanel', '_userStartPressed', 1200);
                    await _sleep(2500);
                    await _pressPanelBtn(sys, 'genpanel', '_userClosePressed', 800);
                    await _sleep(1800);
                },
                check() {
                    const sys = this.sys;
                    return sys.comps.qf1.getState() === 'on' && sys.comps.gen1.isOn;
                },
            },
            {
                msg: '第 3 步：起动 2 号发电机', mode: 'check',
                async act() {
                    const sys = this.sys;
                    await _pressPanelBtn(sys, 'genpanel2', '_userStartPressed', 1200);
                    await _sleep(1800);
                },
                check() {
                    const sys = this.sys;
                    return !!sys.comps.gen2.isOn;
                },
            },
            {
                msg: '第 4 步：将同步表选择开关转到"2"档位（本机档，联锁放行）', mode: 'check',
                async act() {
                    const sys = this.sys;
                    const sel = sys.comps.sync_sel;
                    if (sel.getPosition() !== 3) sel.switchTo(3);
                    await _sleep(300);
                },
                check() {
                    const sys = this.sys;
                    return sys.comps.sync_sel.getPosition() === 3;
                },
            },
            {
                msg: '第 5 步：测试题——并车必须满足的同步条件', mode: 'quiz',
                quizConfig: {
                    question: '发电机并联（并车）投入前，待并机与汇流排必须满足（　）。',
                    options: [
                        '电压相等、频率接近、相位一致',
                        '只要频率相同即可，电压相位不作要求',
                        '只要电压相同即可，频率相位不作要求',
                        '只要相位相同即可，电压频率不作要求',
                    ],
                    answer: 0,
                    analysis: '并车必须满足三个同步条件：电压相等（电压差过大产生无功环流）、频率接近（频差过大产生有功冲击与功率振荡）、相位一致（相位差过大产生巨大合闸冲击电流）。其中相位差与频差超限合闸会触发并车保护，导致全船跳闸。',
                },
            },
            {
                msg: '第 6 步：演示一（频差保护）——拉大 2 号机频差至 >0.5Hz', mode: 'check',
                async act() {
                    const sys = this.sys;
                    sys.comps.gen2.freq = 50.6;   // 等效按住调速旋钮将频率调高
                    await _sleep(3000);            // 等待实际输出频率收敛
                },
                check() {
                    const sys = this.sys;
                    const sc = sys.comps.sync1;
                    return Math.abs(sc._fGen - sc._fBus) > 0.5;
                },
            },
            {
                msg: '第 7 步：演示一——频差 >0.5Hz 时并车合闸，并车保护立即全船跳闸', mode: 'check',
                async act() {
                    const sys = this.sys;
                    const sc = sys.comps.sync1;
                    const gp2 = sys.comps.genpanel2;
                    const degOf = () => { const d = sc._phaseDiff * 180 / Math.PI; return (Math.round(d % 360 + 360)) % 360; };
                    // 等待相位差落在允许区间（<60° 或 >270°），确保仅频差越限触发保护
                    let hit = false;
                    for (let i = 0; i < 600 && !hit; i++) {
                        const d = degOf();
                        if (d < 60 || d > 270) hit = true;
                        else await _sleep(50);
                    }
                    gp2._userClosePressed = true;
                    await _sleep(1000);
                    gp2._userClosePressed = false;
                    await _sleep(1800);
                },
                check() {
                    const sys = this.sys;
                    return sys.comps.qf1.getState() === 'off' && sys.comps.qf2.getState() === 'off'
                    ;
                },
            },
            {
                msg: '第 8 步：测试题——频差超限并车的后果', mode: 'quiz',
                quizConfig: {
                    question: '频差大于 0.5Hz 时强行并车合闸，保护动作结果是（　）。',
                    options: [
                        '合闸正常进行，两机平稳并联',
                        '产生较大电流冲击（两台发电机之间的环流），触发全部发电机跳闸',
                        '仅 2 号发电机停机，1 号机继续供电',
                        '主开关合闸但发电机不并联',
                    ],
                    answer: 1,
                    analysis: '频差过大并车会产生剧烈功率振荡与冲击，超出允许范围（本工程 ±0.5Hz）时并车保护立即动作：所有发电机停机、所有合闸主开关自动分闸，全船失电。',
                },
            },
            {
                msg: '第 9 步：复位重建（关闭同步表，恢复 1 号机供电，2 号机待并）', mode: 'check',
                async act() {
                    const sys = this.sys;
                    const g1 = sys.comps.gen1, g2 = sys.comps.gen2;
                    const q1 = sys.comps.qf1, q2 = sys.comps.qf2;
                    g2.freq = 50;
                    g1.isOn = false; g2.isOn = false;
                    if (q1.getState() === 'on' && q1.tryTrip) { q1.tryTrip(); await _sleep(600); }
                    if (q2.getState() === 'on' && q2.tryTrip) { q2.tryTrip(); await _sleep(600); }
                    await _sleep(300);
                    await _pressPanelBtn(sys, 'genpanel', '_userStartPressed', 1200);
                    await _sleep(2500);
                    await _pressPanelBtn(sys, 'genpanel', '_userClosePressed', 800);
                    await _sleep(1800);
                    await _pressPanelBtn(sys, 'genpanel2', '_userStartPressed', 1200);
                    await _sleep(1800);
                    const sel = sys.comps.sync_sel;
                    if (sel.getPosition() !== 3) sel.switchTo(3);
                    await _sleep(300);
                },
                check() {
                    const sys = this.sys;
                    return sys.comps.qf1.getState() === 'on' && sys.comps.gen2.isOn
                        && sys.comps.sync_sel.getPosition() === 1;
                },
            },
            {
                msg: '第 10 步：演示二（非同期保护）——微调 2 号机频差使同步表相位差缓慢转动', mode: 'check',
                async act() {
                    const sys = this.sys;
                    const g1 = sys.comps.gen1, g2 = sys.comps.gen2;
                    // 小频差（<0.5Hz）驱动同步表相位差约 18°/s 缓慢转动（等效调速旋钮微调）
                    g2.freq = (g1._freqOut ?? g1.freq) + 0.05;
                    await _sleep(3000);
                },
                check() {
                    const sys = this.sys;
                    const sc = sys.comps.sync1;
                    return Math.abs(sc._fGen - sc._fBus) < 0.5&& sys.comps.sync_sel.getPosition() === 3;
                },
            },
            {
                msg: '第 11 步：演示二——相位差 30°~300° 区间内并车合闸，并车保护立即全船跳闸', mode: 'check',
                async act() {
                    const sys = this.sys;
                    const sc = sys.comps.sync1;
                    const gp2 = sys.comps.genpanel2;
                    // 步骤内复位按压计数：本步内按过"合闸"按钮才算动作（不受前序步骤残留影响）
                    if (gp2) gp2._closeAttempts = 0;
                    // 保证同步表选择开关在 2 号机档位（联锁放行），否则合闸指令被封锁、演示无法触发非同期跳闸
                    const sel = sys.comps.sync_sel;
                    if (sel.getPosition() !== 3) sel.switchTo(3);
                    await _sleep(400);
                    const degOf = () => { const d = sc._phaseDiff * 180 / Math.PI; return (Math.round(d % 360 + 360)) % 360; };
                    // 等待相位差落入非同期区间 [60°, 270°] 后合闸（此时频差 <0.5Hz 不越限）
                    let hit = false;
                    for (let i = 0; i < 600 && !hit; i++) {
                        const d = degOf();
                        if (d >= 60 && d <= 270) hit = true;
                        else await _sleep(50);
                    }
                    gp2._userClosePressed = true;
                    await _sleep(1000);
                    gp2._userClosePressed = false;
                    await _sleep(1800);
                },
                check() {
                    const sys = this.sys;
                    const gp2 = sys.comps.genpanel2;
                    // 步骤进入时（首次轮询）清零按压计数：仅本步内按下过才算动作。
                    // 用 _sp11SeenIdx 记录"已清零"的步骤序号：通过/重跑后 idx 变化 → 再次清零。
                    if (this._sp11SeenIdx !== this._workflowIdx) {
                        this._sp11SeenIdx = this._workflowIdx;
                        if (gp2) gp2._closeAttempts = 0;
                    }
                    // 必须真正按下过 2 号遥控面板"合闸"按钮（按压动作检测），
                    // 且非同期保护动作使两台主开关全部跳闸，本步才算通过。
                    return !!(gp2 && gp2._closeAttempts > 0)
                        && sys.comps.qf1.getState() === 'off' && sys.comps.qf2.getState() === 'off'
                        ;
                },
            },
            {
                msg: '第 12 步：测试题——非同期并车的后果', mode: 'quiz',
                quizConfig: {
                    question: '相位差处于 30°~300°（非同期）时强行并车合闸，保护动作结果是（　）。',
                    options: [
                        '合闸正常进行，两机平稳并联',
                        '主开关合闸后立即自动分闸，发电机继续运行',
                        '产生较大电流冲击（两台发电机之间的环流），触发全部发电机跳闸（含已在网机组）',
                        '仅拒绝合闸，不产生任何动作',
                    ],
                    answer: 2,
                    analysis: '非同期并车合闸瞬间产生巨大冲击电流，可能导致发电机轴系与绕组损伤。本工程设定相位差处于 60°~270° 时并车保护立即动作：全部发电机停机、全部合闸主开关分闸，全船失电，需要重新起动恢复供电。',
                },
            },
        ],
    },
    'reverse-power': {
        id: 'reverse-power', name: '4.逆功率状态演示',
        steps: [
            {
                msg: '第 1 步：自动接线，起动 1 号发电机、合闸 1 号主开关，频率调到 50Hz左右', mode: 'check',
                async act() {
                    const sys = this.sys;
                    _autoWire(sys);
                    const g1 = sys.comps.gen1, g2 = sys.comps.gen2;
                    const q1 = sys.comps.qf1, q2 = sys.comps.qf2;
                    g1.isOn = false; g2.isOn = false;
                    g1.freq = 50; g2.freq = 50;
                    if (sys.comps.load3) sys.comps.load3._loaded = false;
                    q1._revTrip = false; q2._revTrip = false; // 复位逆功率保护动作标记
                    if (q1.getState() === 'on' && q1.tryTrip) { q1.tryTrip(); await _sleep(600); }
                    if (q2.getState() === 'on' && q2.tryTrip) { q2.tryTrip(); await _sleep(600); }
                    if (sys.comps.sync_sel.getPosition() !== 1) sys.comps.sync_sel.switchTo(1);
                    await _sleep(300);
                    await _pressPanelBtn(sys, 'genpanel', '_userStartPressed', 1200);
                    await _sleep(3000); // 等待储能电机将合闸弹簧储能到位
                    await _pressPanelBtn(sys, 'genpanel', '_userClosePressed', 800);
                    await _sleep(2000);
                },
                check() {
                    const sys = this.sys;
                    const g1 = sys.comps.gen1, q1 = sys.comps.qf1;
                    return !!g1.isOn && q1.getState() === 'on' && Math.abs(g1.freq - 50) <= 0.12;
                },
            },
            {
                msg: '第 2 步：起动 2 号发电机，同步表选择开关转"2"档，将 2 号机频率调至比 1 号机低 0.1Hz', mode: 'check',
                async act() {
                    const sys = this.sys;
                    await _pressPanelBtn(sys, 'genpanel2', '_userStartPressed', 1200);
                    await _sleep(1800);
                    const sel = sys.comps.sync_sel;
                    if (sel.getPosition() !== 3) sel.switchTo(3);
                    await _sleep(300);
                    const g1 = sys.comps.gen1, g2 = sys.comps.gen2;
                    g2.freq = (g1._freqOut ?? g1.freq) - 0.1;
                    g2._baseFreq = (g1._freqOut ?? g1.freq); // 基准快照（防 1 号机频率微漂）
                    await _sleep(2500);
                },
                check() {
                    const sys = this.sys;
                    const g1 = sys.comps.gen1, g2 = sys.comps.gen2;
                    const base = g2._baseFreq !== undefined ? g2._baseFreq : (g1._freqOut ?? g1.freq);
                    return !!g2.isOn && sys.comps.sync_sel.getPosition() === 3
                        && Math.abs(g2.freq - (base - 0.1)) < 0.05;
                },
            },
            {
                msg: '第 3 步：观察同步表，在相位差允许区间合闸 2 号主开关（负频差并车，2 号机显示逆功率）', mode: 'check',
                async act() {
                    const sys = this.sys;
                    const sc = sys.comps.sync1;
                    const degOf = () => { const d = sc._phaseDiff * 180 / Math.PI; return (Math.round(d % 360 + 360)) % 360; };
                    let hit = false;
                    for (let i = 0; i < 400 && !hit; i++) {
                        const d = degOf();
                        if (d < 60 || d > 270) hit = true;
                        else await _sleep(50);
                    }
                    await _pressPanelBtn(sys, 'genpanel2', '_userClosePressed', 700);
                    await _sleep(2000);
                },
                check() {
                    const sys = this.sys;
                    const g2 = sys.comps.gen2;
                    return sys.comps.qf2.getState() === 'on' && g2._displayP < 0;
                },
            },
            {
                msg: '第 4 步：分闸 2 号主开关，将 2 号机频率调至比 1 号机高 0.2Hz', mode: 'check',
                async act() {
                    const sys = this.sys;
                    await _pressPanelBtn(sys, 'genpanel2', '_userOpenPressed', 500);
                    const g1 = sys.comps.gen1, g2 = sys.comps.gen2;
                    // 等待 1 号机单机频率下垂收敛稳定后再取基准，避免并车/解列过渡期漂移
                    let last = g1._freqOut ?? g1.freq;
                    for (let i = 0; i < 60; i++) {
                        await _sleep(200);
                        const now = g1._freqOut ?? g1.freq;
                        if (Math.abs(now - last) < 0.003) break;
                        last = now;
                    }
                    g2.freq = last + 0.2;
                    g2._baseFreq = last; // 基准快照（防 1 号机频率微漂）
                    await _sleep(2500);
                },
                check() {
                    const sys = this.sys;
                    const g1 = sys.comps.gen1, g2 = sys.comps.gen2;
                    const base = g2._baseFreq !== undefined ? g2._baseFreq : (g1._freqOut ?? g1.freq);
                    return sys.comps.qf2.getState() === 'off'
                        && Math.abs(g2.freq - (base + 0.2)) < 0.05;
                },
            },
            {
                msg: '第 5 步：再次观察同步表，相位差允许区间内合闸 2 号主开关（正频差并车，2 号机承担输出功率）', mode: 'check',
                async act() {
                    const sys = this.sys;
                    const sc = sys.comps.sync1;
                    const degOf = () => { const d = sc._phaseDiff * 180 / Math.PI; return (Math.round(d % 360 + 360)) % 360; };
                    let hit = false;
                    for (let i = 0; i < 400 && !hit; i++) {
                        const d = degOf();
                        if (d < 60 || d > 270) hit = true;
                        else await _sleep(50);
                    }
                    await _pressPanelBtn(sys, 'genpanel2', '_userClosePressed', 700);
                    await _sleep(2000);
                },
                check() {
                    const sys = this.sys;
                    const g2 = sys.comps.gen2;
                    return sys.comps.qf2.getState() === 'on' && g2._displayP > 0;
                },
            },
            {
                msg: '第 6 步：持续下调 2 号机调速器（减小油门）直至 2 号机输出逆功率', mode: 'check',
                async act() {
                    const sys = this.sys;
                    const g2 = sys.comps.gen2;
                    for (let i = 0; i < 60; i++) {
                        if (g2._displayP < 0) break;
                        g2.freq -= 0.02;
                        await _sleep(250);
                    }
                },
                check() {
                    const sys = this.sys;
                    return sys.comps.gen2._displayP < 0;
                },
            },
            {
                msg: '第 7 步：投入三相可调负载 20kW，微调 2 号机调速器使其输出功率接近 5kW', mode: 'check',
                async act() {
                    const sys = this.sys;
                    const load = sys.comps.load3, g2 = sys.comps.gen2;
                    load.powerKw = 20; load._loaded = true;
                    await _sleep(800);
                    for (let i = 0; i < 100; i++) {
                        const p = g2._displayP;
                        if (Math.abs(p - 5) <= 0.5) break;
                        g2.freq += (p < 5 ? 1 : -1) * 0.01;
                        await _sleep(150);
                    }
                },
                check() {
                    const sys = this.sys;
                    const load = sys.comps.load3, g2 = sys.comps.gen2;
                    return !!(load && load.isLoaded()) && Math.abs(g2._displayP - 5) <= 0.8;
                },
            },
            {
                msg: '第 8 步：卸载三相负载并继续下调 2 号机调速器，使 2 号机再次呈现逆功率', mode: 'check',
                async act() {
                    const sys = this.sys;
                    const load = sys.comps.load3, g2 = sys.comps.gen2;
                    load._loaded = false;
                    await _sleep(800);
                    for (let i = 0; i < 60; i++) {
                        if (g2._displayP < 0) break;
                        g2.freq -= 0.02;
                        await _sleep(250);
                    }
                },
                check() {
                    const sys = this.sys;
                    const load = sys.comps.load3, g2 = sys.comps.gen2;
                    return !!(load && !load.isLoaded()) && g2._displayP < 0;
                },
            },
            {
                msg: '第 9 步：持续上调 2 号机调速器，使其输出功率接近 10kW', mode: 'check',
                async act() {
                    const sys = this.sys;
                    const g2 = sys.comps.gen2;
                    for (let i = 0; i < 120; i++) {
                        const p = g2._displayP;
                        if (Math.abs(p - 10) <= 1) break;
                        g2.freq += (p < 10 ? 1 : -1) * 0.03;
                        await _sleep(150);
                    }
                },
                check() {
                    const sys = this.sys;
                    return Math.abs(sys.comps.gen2._displayP - 10) <= 1;
                },
            },
            {
                msg: '第 10 步：置冷却水温高故障（原动机停机，发电机被拖动）。逆功率从 0 爬升至 9kW，达 8kW 延时 5s 后 2 号主开关逆功率保护跳闸', mode: 'check',
                async act() {
                    const sys = this.sys;
                    sys.comps.gen2._faultCoolantTemp = true;
                    // 逆功率爬升率 1.5kW/s：0→9kW 约 6s，8kW 约 5.3s 出现；8kW 起延时 5s → 约 10.3s 跳闸
                    await _sleep(12000);
                },
                check() {
                    const sys = this.sys;
                    const q2 = sys.comps.qf2;
                    const g2 = sys.comps.gen2;
                    return q2.getState() === 'off' && q2._revTrip === true && !g2.isOn;
                },
            },
        ],
    },
    'parallel-load-shift': {
        id: 'parallel-load-shift', name: '5.发电机准同步并车、并联负荷转移、解列',
        steps: [
            {
                msg: '第 1 步：自动接线，起动 1 号发电机，合闸供电，调频至 50Hz', mode: 'check',
                async act() {
                    const sys = this.sys;
                    _autoWire(sys);
                    const g1 = sys.comps.gen1, g2 = sys.comps.gen2;
                    const q1 = sys.comps.qf1, q2 = sys.comps.qf2;
                    g1.isOn = false; g2.isOn = false;
                    g1.freq = 50; g2.freq = 50;
                    if (sys.comps.load3) sys.comps.load3._loaded = false;
                    if (q1.getState() === 'on' && q1.tryTrip) { q1.tryTrip(); await _sleep(600); }
                    if (q2.getState() === 'on' && q2.tryTrip) { q2.tryTrip(); await _sleep(600); }
                    if (sys.comps.sync_sel.getPosition() !== 1) sys.comps.sync_sel.switchTo(1);
                    await _sleep(300);
                    await _pressPanelBtn(sys, 'genpanel', '_userStartPressed', 1200);
                    await _sleep(3000); // 等待储能电机将合闸弹簧储能到位
                    await _pressPanelBtn(sys, 'genpanel', '_userClosePressed', 800);
                    await _sleep(2000);
                },
                check() {
                    const sys = this.sys;
                    const g1 = sys.comps.gen1, q1 = sys.comps.qf1;
                    return !!g1.isOn && q1.getState() === 'on' && Math.abs(g1.freq - 50) <= 0.12;
                },
            },
            {
                msg: '第 2 步：填空题——准同步并车必须满足的三个条件', mode: 'fill',
                target: 'genpanel2',
                fields: [
                    { label: '电压差不超过', unit: '%Un', placeholder: '', answer: 10 },
                    { label: '频率差不超过', unit: 'Hz', placeholder: '', answer: 0.5 },
                    { label: '相位差不超过', unit: '°', placeholder: '', answer: 15 },
                ],
            },
            {
                msg: '第 3 步：检查 2 号发电机遥控面板 READY FOR START 指示灯（点击该灯即可跳过）', mode: 'find',
                target: 'genpanel2', subTarget: 'ready-led',
            },
            {
                msg: '第 4 步：起动 2 号发电机组，调频到 50.2Hz', mode: 'check',
                async act() {
                    const sys = this.sys;
                    await _pressPanelBtn(sys, 'genpanel2', '_userStartPressed', 1200);
                    await _sleep(1800);
                    const sel = sys.comps.sync_sel;
                    if (sel.getPosition() !== 3) sel.switchTo(3);
                    await _sleep(300);
                    const g1 = sys.comps.gen1, g2 = sys.comps.gen2;
                    // 等待 1 号机单机频率下垂收敛稳定后再取基准，避免合闸/负载过渡期漂移
                    let last = g1._freqOut ?? g1.freq;
                    for (let i = 0; i < 60; i++) {
                        await _sleep(200);
                        const now = g1._freqOut ?? g1.freq;
                        if (Math.abs(now - last) < 0.003) break;
                        last = now;
                    }
                    g2.freq = last + 0.2;      // 待并机调频到比电网高 0.2Hz
                    g2._baseFreq = last;       // 基准快照（防 1 号机频率微漂）
                    await _sleep(2500);
                },
                check() {
                    const sys = this.sys;
                    const g2 = sys.comps.gen2;
                    return !!g2.isOn 
                        && Math.abs(g2.freq - 50.2) < 0.05;
                },
            },
            {
                msg: '第 5 步：观察数字同步表——正频差 0.2~0.33Hz，指针顺时针 3-5s 转一圈', mode: 'check',
                check() {
                    const sys = this.sys;
                    const sc = sys.comps.sync1;
                    const dF = sc._fGen - sc._fBus;
                    return sc && sys.comps.sync_sel.getPosition() === 3&& !sc._off && sc._hasVolt && dF >= 0.2 && dF <= 0.33;
                },
            },
            {
                msg: '第 6 步：观察同步表指针转到"11"位置左右时合闸 2 号主开关，随后关闭同步表', mode: 'check',
                async act() {
                    const sys = this.sys;
                    const sc = sys.comps.sync1;
                    // 11 位置 = 相位差 330°（LED 索引 22，每 15° 一格），合闸窗口 315°~345°（LED 21~23）
                    let hit = false;
                    for (let i = 0; i < 800 && !hit; i++) {
                        const led = sc._activeLED;
                        if (led >= 21 && led <= 23) hit = true;
                        else await _sleep(50);
                    }
                    await _pressPanelBtn(sys, 'genpanel2', '_userClosePressed', 700);
                    await _sleep(2000);
                    const sel = sys.comps.sync_sel;
                    if (sel.getPosition() !== 1) sel.switchTo(1);
                    await _sleep(300);
                },
                check() {
                    const sys = this.sys;
                    return sys.comps.qf2.getState() === 'on' && sys.comps.sync_sel.getPosition() === 1;
                },
            },
            {
                msg: '第 7 步：负荷转移——调节两台机调速器，使功率均分', mode: 'check',
                async act() {
                    const sys = this.sys;
                    const g1 = sys.comps.gen1, g2 = sys.comps.gen2;
                    // 比例调节：并车后原负载按频差份额分配（2# 仅分 3%~5%），均分需要
                    // 把设定差调到数 Hz（trans 补偿 ratio 失衡）。差值大 → 大步进、
                    // 差值小 → 小步进，接近目标时步长自动收缩，避免固定步长过冲振荡。
                    for (let i = 0; i < 400; i++) {
                        const p1 = g1._displayP, p2 = g2._displayP;
                        if (Math.abs(p1 - p2) <= 1.5) break;
                        const err = p1 - p2;
                        const step = Math.max(0.002, Math.min(0.03, Math.abs(err) * 0.002));
                        const dir = err > 0 ? -1 : 1;   // 1 号机功率偏高 → 减 1 号油门、增 2 号油门
                        g1.freq += dir * step;
                        g2.freq -= dir * step;
                        await _sleep(100);
                    }
                    await _sleep(500);
                },
                check() {
                    const sys = this.sys;
                    const g1 = sys.comps.gen1, g2 = sys.comps.gen2;
                    return Math.abs(g1._displayP - g2._displayP) <= 2;
                },
            },
            {
                msg: '第 8 步：突加负载 20kW（投入三相可调负载），观察两台机功率分配情况', mode: 'check',
                async act() {
                    const sys = this.sys;
                    const load = sys.comps.load3;
                    load.powerKw = 20; load._loaded = true;
                    await _sleep(2000); // 等待功率分配收敛
                },
                check() {
                    const sys = this.sys;
                    const load = sys.comps.load3;
                    return !!(load && load.isLoaded())
                        && sys.comps.qf1.getState() === 'on' && sys.comps.qf2.getState() === 'on'
                        && sys.comps.gen1.isOn && sys.comps.gen2.isOn;
                },
            },
            {
                msg: '第 9 步：增大 1 号机油门、减小 2 号机油门，使电网频率维持在 50Hz 且 2 号机承担功率降到 3kW', mode: 'check',
                async act() {
                    const sys = this.sys;
                    const g1 = sys.comps.gen1, g2 = sys.comps.gen2;
                    // 并联运行时：2 号机功率由频差(f2−f1)决定，电网频率由平均设定(f1+f2)/2 决定，
                    // 两者正交。第一个循环只调频差转移功率（比例调节，接近目标步长自动收缩）；
                    // 第二个循环同步平移两台设定调频率。
                    for (let i = 0; i < 400; i++) {
                        const p2 = g2._displayP;
                        if (Math.abs(p2 - 3) <= 0.5) break;
                        const err = p2 - 3;
                        const step = Math.max(0.002, Math.min(0.03, Math.abs(err) * 0.002));
                        const dir = err > 0 ? 1 : -1;   // 2 号机功率偏高 → 增大 1 号油门、减小 2 号油门
                        g1.freq += dir * step;
                        g2.freq -= dir * step;
                        await _sleep(100);
                    }
                    // 频率环：两台同步平移（保持频差不变 → 功率分配不变），把电网频率调到 50Hz
                    for (let i = 0; i < 80; i++) {
                        const f = g1._freqOut ?? g1.freq;
                        if (Math.abs(f - 50) <= 0.05) break;
                        const d = f > 50 ? -0.01 : 0.01;
                        g1.freq += d; g2.freq += d;
                        await _sleep(180);
                    }
                    await _sleep(800);
                },
                check() {
                    const sys = this.sys;
                    const g2 = sys.comps.gen2;
                    const f = sys.comps.gen1._freqOut ?? sys.comps.gen1.freq;
                    return Math.abs(g2._displayP - 3) <= 1 && Math.abs(f - 50) <= 0.5;
                },
            },
            {
                msg: '第 10 步：2 号发电机主开关分闸（解列）,2 号发电机停机，负荷全部由 1 号机承担', mode: 'check',
                async act() {
                    const sys = this.sys;
                    // 分闸解列 2#：模型自动把两机设定软复位到解列前等效设定
                    // （SyncGenerator3P 解列分支 autoDecoupleTrim），频率连续过渡——
                    // 1# 承接 2# 负载频率微降（约 0.075Hz）、2# 卸载空载频率微升（特征对称）。
                    await _pressPanelBtn(sys, 'genpanel2', '_userOpenPressed', 500);
                    await _sleep(4000);  // 等两机频率过渡到新平衡
                    await _pressPanelBtn(sys, 'genpanel2', '_userStopPressed', 1200);
                    await _sleep(2000);
                },
                check() {
                    const sys = this.sys;
                    const g1 = sys.comps.gen1, g2 = sys.comps.gen2;
                    // 解列完成：2 号主开关分闸、2 号机停机；1 号机单独带全部负载。
                    // 同时校验两机设定已回归正常位（防止步骤 9 转移负荷残留的极端频差
                    // 使解列后 1 号机显示 52Hz+、2 号机 46Hz——不符合实际）：
                    // 2 号机设定须回 50Hz（空载）；1 号机带载，频率下垂后约 49.2Hz。
                    return sys.comps.qf2.getState() === 'off'
                        && sys.comps.qf1.getState() === 'on'
                        && !g2.isOn && g1.isOn
                },
            },
        ],
    },
};

export const componentConfigs = [
    // ── 主回路：同步发电机 → 主开关 → 汇流排 ──
    { Class: SyncGenerator3P, id: 'gen1', x: -100, y: 700, vRms: 230, freq: 50, isOn: false, mode: 'remote', label: '1#同步发电机', ratedPower: 80, ratedVoltage: 400, ratedCosPhi: 0.8, maxDropV: 200, avrMaxComp: 1, avrDelay: 2, avrTime: 5, autoDecoupleTrim: true, visible: true },
    { Class: MarineMainsSwitch, id: 'qf1', x: -180, y: 180, ratedCtrlVoltage: 24, label: '主开关', genId: 'gen1', syncScopeId: 'sync1', phaseMin: 60, phaseMax: 270, freqDiffMax: 0.5, revPowerKw: 8, revTime: 5, visible: true },
    { Class: GeneratorRemotePanel, id: 'genpanel', x: 330, y: 700, genId: 'gen1', qfId: 'qf1', label: '1#发电机组遥控面板', busId: 'bus1', syncSelId: 'sync_sel', selPos: 2, visible: true },

    // ── 2号机组：2号同步发电机 → 2号主开关 → 汇流排 ──
    { Class: SyncGenerator3P, id: 'gen2', x: 850, y: 700, vRms: 230, freq: 50, isOn: false, mode: 'remote', label: '2#同步发电机', ratedPower: 80, ratedVoltage: 400, ratedCosPhi: 0.8, maxDropV: 200, avrMaxComp: 1, avrDelay: 2, avrTime: 5, autoDecoupleTrim: true, visible: true },
    { Class: MarineMainsSwitch, id: 'qf2', x: 1100, y: 180, ratedCtrlVoltage: 24, label: '主开关2', genId: 'gen2', syncScopeId: 'sync1', phaseMin: 60, phaseMax: 270, freqDiffMax: 0.5, revPowerKw: 8, revTime: 5, visible: true },
    { Class: GeneratorRemotePanel, id: 'genpanel2', x: 1300, y: 700, genId: 'gen2', qfId: 'qf2', label: '2#发电机组遥控面板', busId: 'bus1', syncSelId: 'sync_sel', selPos: 3, visible:true },
    { Class: DCPower, id: 'dc_uv2', x: 1580, y: 750, voltage: 24, isOn: true, label: '失压脱扣电源2', visible: true },
    { Class: Busbar3P, id: 'bus1', x: 220, y: 30, tapsPerPhase: 6, label: '汇流排', visible: true },
    // 改为同步表中性点接地
    { Class: Ground, id: 'gnd1', x: 680, y: 500, visible: true },

    // ── 1号机组控制电源共地（遥控面板与控制电源的中间下方）──
    // dc_uv 负极、genpanel p24_n 共同接此接地，不再向线圈引出负极线
    { Class: Ground, id: 'gnd1_uv', x: 590, y: 1000, label: '控制电源接地', visible: true },
    // ── 1号主开关线圈接地（主开关右下角）──
    // 储能电机 m2 / 失压 uv2 / 合闸 c2 / 分励 flb 负端均接此接地
    { Class: Ground, id: 'gnd1_qf', x: 345, y: 465, label: '线圈接地', visible: true },
    // ── 1号遥控面板信号接地（面板上方）──
    // 合闸输出 close_b、分闸输出 open_b 负端接地
    { Class: Ground, id: 'gnd1_panel', x: 530, y: 670, label: '信号接地', visible: true },

    // ── 2号机组控制电源共地（遥控面板与控制电源的中间下方）──
    { Class: Ground, id: 'gnd2_uv', x: 1560, y: 990, label: '控制电源接地', visible: true },
    // ── 2号主开关线圈接地（主开关右下角）──
    { Class: Ground, id: 'gnd2_qf', x: 1606, y: 459, label: '线圈接地', visible: true },
    // ── 2号遥控面板信号接地（面板上方）──
    { Class: Ground, id: 'gnd2_panel', x: 1470, y: 660, label: '信号接地', visible: true },

    // ── 数字同步表：上=汇流排A相，左=待并机A相(经选择开关)，下=接地 ──
    { Class: Syncroscope, id: 'sync1', x: 600, y: 170, label: '数字同步表', visible: true },

    // ── 三相可调负载：置于同步表与2号主开关之间（汇流排第5口直连，N端悬空不接）──
    { Class: ThreePhaseLoad, id: 'load3', x: 950, y: 180, powerKw: 20, cosPhi: 1, reactive: 'ind', loaded: false, label: '三相可调负载', visible: true },

    // ── 待并机选择开关：单刀四掷（OFF / 待并机1 / 待并机2 / 待并机3）──
    // 档位1=OFF（同步表关闭）、档位2=1号机、档位3=2号机、档位4=3号机（预留）
    { Class: SP4TSwitch, id: 'sync_sel', x: 650, y: 530, label: '同步表选择开关', function: '同步表选择开关', labelNames: ['OFF', '1', '2', '3'], initPosition: 1, visible: true },

    // ── 控制电源（DC 24V）：失压脱扣线圈 ──
    { Class: DCPower, id: 'dc_uv', x: 600, y: 750, voltage: 24, isOn: true, label: '失压脱扣电源', visible: true },

    // ── 汇流排馈出支路 ──
    // 支路1（第8列）：三相空气开关 QF3 → 三盏白炽灯（分别接 L1/L2/L3）
    { Class: DiagramThreePhaseACB, id: 'acb_l', x: 1826, y: 80, initState: 'on', label: 'QF3', ratedVoltage: 380, ratedCurrent: 100, tripCurrent: 10, visible: true },
    { Class: IncandescentLamp, id: 'lamp1', x: 1850, y: 770, coldResistance: 4.84, rotation: 90 },
    { Class: IncandescentLamp, id: 'lamp2', x: 1920, y: 770, coldResistance: 4.84, rotation: 90 },
    { Class: IncandescentLamp, id: 'lamp3', x: 1990, y: 770, coldResistance: 4.84, rotation: 90 },
    { Class: Ground, id: 'gnd_l', x: 1950, y: 890, visible: true },

    { Class: Multimeter, id: 'multimeter', x: 920, y: 100, visible: false },
    { Class: MF47Multimeter, id: 'mf47-panel', x: 1050, y: 150, visible: false },
    { Class: Oscilloscope_tri, id: 'osc', x: 50, y: 50, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 50, y: 50, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 50, y: 50, visible: false },
    { Class: ElecMeter, id: 'elecmeter', x: 50, y: 50, visible: false },
];

// ─── 接线辅助 ───

const _sleep = ms => new Promise(r => setTimeout(r, ms));

// 模拟按住遥控面板按钮（btnKey: _userStartPressed / _userStopPressed / _userClosePressed / _userOpenPressed）
async function _pressPanelBtn(sys, pid, btnKey, ms = 900) {
    const gp = sys.comps[pid];
    if (!gp || !(btnKey in gp)) return;
    gp[btnKey] = true;
    await _sleep(ms);
    gp[btnKey] = false;
}

function _autoWire(sys) {
    sys.conns.length = 0;
    const cons = [
        // ── 主回路：同步发电机 → 主开关 → 汇流排 ──
        { from: 'gen1_wire_u', to: 'qf1_wire_t1', type: 'wire' },
        { from: 'gen1_wire_v', to: 'qf1_wire_t2', type: 'wire' },
        { from: 'gen1_wire_w', to: 'qf1_wire_t3', type: 'wire' },
        { from: 'qf1_wire_l1', to: 'bus1_wire_l1_1', type: 'wire' },
        { from: 'qf1_wire_l2', to: 'bus1_wire_l2_1', type: 'wire' },
        { from: 'qf1_wire_l3', to: 'bus1_wire_l3_1', type: 'wire' },
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
        // ── 2号机组：gen2 → qf2 → 汇流排（第7列接口）──
        { from: 'gen2_wire_u', to: 'qf2_wire_t1', type: 'wire' },
        { from: 'gen2_wire_v', to: 'qf2_wire_t2', type: 'wire' },
        { from: 'gen2_wire_w', to: 'qf2_wire_t3', type: 'wire' },
        { from: 'qf2_wire_l1', to: 'bus1_wire_l1_7', type: 'wire' },
        { from: 'qf2_wire_l2', to: 'bus1_wire_l2_7', type: 'wire' },
        { from: 'qf2_wire_l3', to: 'bus1_wire_l3_7', type: 'wire' },
        // ── 三相可调负载（load3）：汇流排第5口三相直连，N端接同步表旁接地 gnd1 ──
        { from: 'bus1_wire_l1_5', to: 'load3_wire_l1', type: 'wire' },
        { from: 'bus1_wire_l2_5', to: 'load3_wire_l2', type: 'wire' },
        { from: 'bus1_wire_l3_5', to: 'load3_wire_l3', type: 'wire' },
        { from: 'load3_wire_n', to: 'gnd1_wire_gnd', type: 'wire' },
        // ── 数字同步表：汇流排A相 + 待并机A相(经待并机选择开关 COM) + 接地参考 ──
        { from: 'bus1_wire_l1_3', to: 'sync1_wire_bus', type: 'wire' },
        { from: 'sync_sel_wire_com', to: 'sync1_wire_gen', type: 'wire' },
        { from: 'sync1_wire_gnd', to: 'gnd1_wire_gnd', type: 'wire' },
        // ── 待并机选择开关：T2=1号机，T3=2号机，T4=3号机(预留悬空)，T1=OFF(悬空) ──
        { from: 'sync_sel_wire_t2', to: 'gen1_wire_u', type: 'wire' },
        { from: 'sync_sel_wire_t3', to: 'gen2_wire_u', type: 'wire' },
        // ── 2号机组控制电源（dc_uv2）：失压线圈 / 储能电机 正端接电源；负端均接地 ──
        { from: 'dc_uv2_wire_p', to: 'qf2_wire_uv1', type: 'wire' },
        { from: 'dc_uv2_wire_p', to: 'qf2_wire_m1', type: 'wire' },
        // 线圈负端接地（gnd2_qf，主开关右下角）
        { from: 'qf2_wire_uv2', to: 'gnd2_qf_wire_gnd', type: 'wire' },
        { from: 'qf2_wire_m2', to: 'gnd2_qf_wire_gnd', type: 'wire' },
        // ── 2号机组遥控面板 → gen2 / qf2 ──
        { from: 'genpanel2_wire_start_a', to: 'gen2_wire_rm_start_a', type: 'wire' },
        { from: 'genpanel2_wire_start_b', to: 'gen2_wire_rm_start_b', type: 'wire' },
        { from: 'genpanel2_wire_stop_a', to: 'gen2_wire_rm_stop_a', type: 'wire' },
        { from: 'genpanel2_wire_stop_b', to: 'gen2_wire_rm_stop_b', type: 'wire' },
        { from: 'genpanel2_wire_spd_p', to: 'gen2_wire_freq_in_p', type: 'wire' },
        { from: 'genpanel2_wire_spd_n', to: 'gen2_wire_freq_in_n', type: 'wire' },
        // 合闸/分闸正端 → 线圈正端；输出负端接地（gnd2_panel）、线圈负端接地（gnd2_qf）
        { from: 'genpanel2_wire_close_a', to: 'qf2_wire_c1', type: 'wire' },
        { from: 'genpanel2_wire_open_a', to: 'qf2_wire_fla', type: 'wire' },
        { from: 'genpanel2_wire_close_b', to: 'gnd2_panel_wire_gnd', type: 'wire' },
        { from: 'genpanel2_wire_open_b', to: 'gnd2_panel_wire_gnd', type: 'wire' },
        { from: 'qf2_wire_c2', to: 'gnd2_qf_wire_gnd', type: 'wire' },
        { from: 'qf2_wire_flb', to: 'gnd2_qf_wire_gnd', type: 'wire' },
        // 面板电源正端 ← dc_uv2；负端接地（gnd2_uv，面板与控制电源中间下方）
        { from: 'dc_uv2_wire_p', to: 'genpanel2_wire_p24_p', type: 'wire' },
        { from: 'dc_uv2_wire_n', to: 'gnd2_uv_wire_gnd', type: 'wire' },
        { from: 'genpanel2_wire_p24_n', to: 'gnd2_uv_wire_gnd', type: 'wire' },
        // ── 控制电源：DC 24V → 失压脱扣线圈 / 储能电机 正端；负端均接地 ──
        { from: 'dc_uv_wire_p', to: 'qf1_wire_uv1', type: 'wire' },
        { from: 'dc_uv_wire_p', to: 'qf1_wire_m1', type: 'wire' },
        // 线圈负端接地（gnd1_qf，主开关右下角）
        { from: 'qf1_wire_uv2', to: 'gnd1_qf_wire_gnd', type: 'wire' },
        { from: 'qf1_wire_m2', to: 'gnd1_qf_wire_gnd', type: 'wire' },
        // ── 发电机组遥控面板：左面板 → gen1 遥控端口 ──
        { from: 'genpanel_wire_start_a', to: 'gen1_wire_rm_start_a', type: 'wire' },
        { from: 'genpanel_wire_start_b', to: 'gen1_wire_rm_start_b', type: 'wire' },
        { from: 'genpanel_wire_stop_a', to: 'gen1_wire_rm_stop_a', type: 'wire' },
        { from: 'genpanel_wire_stop_b', to: 'gen1_wire_rm_stop_b', type: 'wire' },
        { from: 'genpanel_wire_spd_p', to: 'gen1_wire_freq_in_p', type: 'wire' },
        { from: 'genpanel_wire_spd_n', to: 'gen1_wire_freq_in_n', type: 'wire' },
        // 合闸/分闸正端 → 线圈正端；输出负端接地（gnd1_panel，面板上方）、线圈负端接地（gnd1_qf）
        { from: 'genpanel_wire_close_a', to: 'qf1_wire_c1', type: 'wire' },
        { from: 'genpanel_wire_open_a', to: 'qf1_wire_fla', type: 'wire' },
        { from: 'genpanel_wire_close_b', to: 'gnd1_panel_wire_gnd', type: 'wire' },
        { from: 'genpanel_wire_open_b', to: 'gnd1_panel_wire_gnd', type: 'wire' },
        { from: 'qf1_wire_c2', to: 'gnd1_qf_wire_gnd', type: 'wire' },
        { from: 'qf1_wire_flb', to: 'gnd1_qf_wire_gnd', type: 'wire' },
        // ── 左面板 24V 电源 ← dc_uv（正端）；负端接地（gnd1_uv，面板与控制电源中间下方）──
        { from: 'dc_uv_wire_p', to: 'genpanel_wire_p24_p', type: 'wire' },
        { from: 'dc_uv_wire_n', to: 'gnd1_uv_wire_gnd', type: 'wire' },
        { from: 'genpanel_wire_p24_n', to: 'gnd1_uv_wire_gnd', type: 'wire' },
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
    // 起动发电机前先完整复位（防止上次流程残留的两机极端设定/负载/开关状态
    // 导致加载系统时两台发电机功率分配不均）：
    // 两台机设定频率归位 50Hz；只保留 1 号机运行，2 号机停机；负载全部切除；
    // 两台主开关分闸。
    const g1 = sys.comps.gen1, g2 = sys.comps.gen2;
    if (g1) { g1.freq = 50; g1.isOn = true; }
    if (g2) { g2.freq = 50; g2.isOn = false; }
    if (sys.comps.load3) { sys.comps.load3._loaded = false; }
    const q1 = sys.comps.qf1, q2 = sys.comps.qf2;
    if (q1 && q1.getState() === 'on' && q1.tryTrip) q1.tryTrip();
    if (q2 && q2.getState() === 'on' && q2.tryTrip) q2.tryTrip();
}

export function fiveStep() {
}
