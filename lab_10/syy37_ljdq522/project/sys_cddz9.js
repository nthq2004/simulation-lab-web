// 铅酸蓄电池充放电仿真工程
// 电路：AC 220V → 开关 → 充放电板 → 12V铅酸蓄电池×2
// 比重计用于测量电解液比重

import { ACPower } from '../components/ACPower.js';
import { Switch } from '../components/Switch.js';
import { ChargeBoard } from '../components/ChargeBoard.js';
import { LeadAcidBattery } from '../components/LeadAcidBattery.js';
import { Hydrometer } from '../components/Hydrometer.js';
import { Multimeter } from '../components/Multimeter.js';
import { MF47Multimeter } from '../components/MF47Multimeter.js';
import { Oscilloscope_tri } from '../components/Osc_tri.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';
import { ElecMeter } from '../components/ElecMeter.js';
import { Resistor } from '../components/Resistor.js';

export const FAULT_CONFIGS = {
    bt_sulfation: {
        id: 'bt_sulfation', name: '硫化', system: '蓄电池',
        check() {
            const bt = window.sys && window.sys.comps && window.sys.comps.bt1;
            return bt && bt._faultSulfation;
        },
        trigger() {
            const bt = window.sys && window.sys.comps && window.sys.comps.bt1;
            if (bt) bt._faultSulfation = true;
        },
        repair() {
            const bt = window.sys && window.sys.comps && window.sys.comps.bt1;
            if (bt) bt._faultSulfation = false;
        },
    },
    bt_lowElectrolyte: {
        id: 'bt_lowElectrolyte', name: '电解液缺失', system: '蓄电池',
        check() {
            const bt = window.sys && window.sys.comps && window.sys.comps.bt1;
            return bt && bt._faultLowElectrolyte;
        },
        trigger() {
            const bt = window.sys && window.sys.comps && window.sys.comps.bt1;
            if (bt) bt._faultLowElectrolyte = true;
        },
        repair() {
            const bt = window.sys && window.sys.comps && window.sys.comps.bt1;
            if (bt) bt._faultLowElectrolyte = false;
        },
    },
};

// ════════════════════════════════════════════════════════════════
// 演示辅助函数（供各步骤 op.act 调用，this 指向 Workflow 实例）
// ════════════════════════════════════════════════════════════════
const _sleep = ms => new Promise(r => setTimeout(r, ms));

// 打开蓄电池的某个注液孔盖（模拟拧开）并记录当前开孔索引
function _openCellCap(bt, idx) {
    if (!bt || !bt._capNodes) return;
    bt._lastOpenIdx = idx;
    const cap = bt._capNodes[idx];
    if (cap && bt._cellCx) cap.to({ x: bt._cellCx[idx] + 24, duration: 0.15 });
}

// 关闭蓄电池的注液孔盖（盖回原位）
function _closeCellCap(bt, idx) {
    if (!bt || !bt._capNodes) return;
    if (bt._lastOpenIdx === idx) bt._lastOpenIdx = -1;
    const cap = bt._capNodes[idx];
    if (cap && bt._cellCx) cap.to({ x: bt._cellCx[idx], duration: 0.15 });
}

// 仅串联两组蓄电池：bt1 负极 → bt2 正极（流程2 第1步只接这一根线）
function _wireSeriesOnly(sys, animated = false) {
    sys.conns.length = 0;
    const conn = { from: 'bt1_wire_cell6_n', to: 'bt2_wire_cell1_p', type: 'wire' };
    if (animated) return sys.addConnectionAnimated(conn);
    sys.connMgr.addConn(conn);
    sys.redrawAll();
}

// 将万用表表笔接到蓄电池组两端（红笔 → bt1 正极，黑笔 → bt2 负极）。
// animated=true 时用动画连接函数逐根绘制，模拟实际接表笔的过程。
async function _connectMeterProbes(sys, animated = false) {
    const want = [
        { from: 'multimeter_wire_v', to: 'bt1_wire_cell1_p', type: 'wire' },
        { from: 'multimeter_wire_com', to: 'bt2_wire_cell6_n', type: 'wire' },
    ];
    if (animated) {
        for (const c of want) {
            const exist = sys.conns.some(x =>
                (x.from === c.from && x.to === c.to) || (x.from === c.to && x.to === c.from));
            if (!exist) {
                await sys.addConnectionAnimated(c);
                await _sleep(400);
            }
        }
        sys.redrawAll();
        return;
    }
    want.forEach(c => {
        const exist = sys.conns.some(x =>
            (x.from === c.from && x.to === c.to) || (x.from === c.to && x.to === c.from));
        if (!exist) sys.connMgr.addConn(c);
    });
    sys.redrawAll();
}

// 断开万用表表笔接线（移除与万用表相关的连线）
function _disconnectMeterProbes(sys) {
    const ids = ['multimeter_wire_v', 'multimeter_wire_com'];
    const targets = sys.conns.filter(c => ids.includes(c.from) || ids.includes(c.to));
    targets.forEach(c => sys.connMgr.removeConn(c));
    sys.redrawAll();
}

// 关闭万用表（隐藏仪表并同步「选择仪表」界面勾选状态）
function _closeMultimeter(sys) {
    if (typeof sys.toggleInstrumentVisibility === 'function') {
        sys.toggleInstrumentVisibility('multimeter', false);
    } else {
        const mm = sys.comps['multimeter'];
        if (mm && mm.group) mm.group.visible(false);
        sys.redrawAll();
    }
}

// 通过「参数设置」对话框动态设置蓄电池初始 SOC：
// 调出参数设置界面 → 高亮「初始 SOC」输入框并填入 → 点击「保存」应用。
async function _setSOCViaConfigDialog(bt, soc, workflow) {
    if (!bt) return;
    bt.showConfigDialog();
    await _sleep(600);
    const input = document.getElementById('diag_initialSOC');
    if (input) {
        input.value = soc;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        if (workflow && workflow._flashDomElement) {
            await workflow._flashDomElement(input, `在「初始 SOC」输入框中填入 ${soc}`, 1500);
        } else {
            await _sleep(1200);
        }
    }
    // 从输入框向上找到直属于容器的配置弹窗（避免被浮动提示等 DOM 干扰）
    const container = bt.sys && bt.sys.container;
    let modal = null;
    if (input && container) {
        modal = input;
        while (modal && modal.parentElement && modal.parentElement !== container) modal = modal.parentElement;
        if (!modal || modal.parentElement !== container) modal = null;
    }
    let saveBtn = null;
    if (modal && modal.querySelectorAll) {
        saveBtn = Array.from(modal.querySelectorAll('button')).find(b => /保存/.test(b.textContent));
    }
    if (saveBtn) {
        if (workflow && workflow._flashDomElement) {
            await workflow._flashDomElement(saveBtn, '点击「保存」应用参数', 1300);
        } else {
            await _sleep(1000);
        }
        saveBtn.click();
    } else if (modal && container) {
        container.removeChild(modal);
    }
    await _sleep(500);
}

// ── 比重计使用动作 ────────────────────────────────────────────

// 将比重计移动到蓄电池指定注液孔正上方（吸管尖端对准孔口）
async function _moveHydrometerToCell(hy, bt, idx, duration = 0.8) {
    if (!hy || !hy.group || !bt || !bt._cellCx) return;
    if (hy._homeX === undefined) { hy._homeX = hy.group.x(); hy._homeY = hy.group.y(); }
    const holeX = bt.group.x() + bt._cellCx[idx];
    const holeY = bt.group.y() + bt._bodyTop + bt._bodyH / 2;
    const tubeLen = Math.max(48, hy.height * 0.165);
    const tipH = Math.max(8, hy.height * 0.03);
    const targetX = holeX - hy._tubeX;
    const targetY = holeY - (hy._rubberY + tubeLen + tipH);
    await new Promise(res => hy.group.to({ x: targetX, y: targetY, duration, onFinish: () => res() }));
    if (hy.sys && hy.sys.redrawAll) hy.sys.redrawAll();
}

// 捏住吸球（按下），排出管内空气
function _pressHydrometerBulb(hy) {
    if (!hy) return;
    hy._bulbPressed = true;
    hy._animating = true;
    hy._filling = false;
}

// 松开吸球：吸取下方已开盖电池的电解液，并过渡到该电池比重
async function _releaseHydrometerBulb(hy) {
    if (!hy) return;
    hy._bulbPressed = false;
    hy._animating = false;
    const bat = typeof hy._findTargetBattery === 'function' ? hy._findTargetBattery() : null;
    if (bat) {
        hy._fillStartSG = hy.getSpecificGravity();
        hy._fillTargetSG = bat.getSpecificGravity() || 1.25;
        hy._filling = true;
    }
    await _sleep(2600);
}

// 移开比重计（回到原位）
async function _moveHydrometerAway(hy, duration = 0.8) {
    if (!hy || !hy.group || hy._homeX === undefined) return;
    await new Promise(res => hy.group.to({ x: hy._homeX, y: hy._homeY, duration, onFinish: () => res() }));
    if (hy.sys && hy.sys.redrawAll) hy.sys.redrawAll();
}

// 排出比重计内的电解液（捏住吸球排空后松开）
async function _drainHydrometer(hy) {
    if (!hy) return;
    hy._bulbPressed = true;
    hy._animating = true;
    hy._filling = false;
    await _sleep(3200);          // 液体随按压排出（_fillProgress 递减）
    hy._fillProgress = 0;        // 确保排空（低帧率下补足）
    hy._bulbPressed = false;
    hy._animating = false;
    await _sleep(300);
}

export const PROJECT_WORKFLOWS = {
    // ── 流程一：铅酸蓄电池充电操作 ──
    'leadacid-charge': {
        id: 'leadacid-charge',
        name: '1.铅酸蓄电池充、放电操作',
        steps: [
            {
                msg: '1. 按电路图接好所有连线：AC 220V → 充放电板 → 两个12V蓄电池串联（24V）；并在第1路输出端并联「开关 + 20Ω电阻」负载支路',
                mode: 'check',
                op: [
                    {
                        type: 'wire',
                        msg: '点击工具栏「自动接线」按钮，自动完成 AC220V → 充放电板 → 蓄电池串联，以及负载支路接线',
                        async act() {
                            await _autoWire(this.sys, true);
                            this.sys.showFloatingTip('主回路与负载支路已自动接线完成', 1600);
                            await _sleep(800);
                        },
                    },
                    {
                        type: 'observe', target: 'cb',
                        msg: '观察充放电板接线：交流进线、CH1 输出接到蓄电池组',
                        async act() { await _sleep(1500); },
                    },
                    {
                        type: 'observe', target: 'bt1',
                        msg: '观察两个 12V 蓄电池首尾串联构成 24V 蓄电池组',
                        async act() { await _sleep(1500); },
                    },
                    {
                        type: 'observe', target: 'load',
                        msg: '观察负载支路：CH1 正极 → 开关 → 20Ω 电阻 → CH1 负极（电阻默认 20Ω）',
                        async act() { await _sleep(1500); },
                    },
                ],
                check() {
                    const exp = [
                        ['ac_wire_p', 'cb_wire_ac_l'],
                        ['ac_wire_n', 'cb_wire_ac_n'],
                        ['cb_wire_ch1_p', 'bt1_wire_cell1_p'],
                        ['bt1_wire_cell6_n', 'bt2_wire_cell1_p'],
                        ['bt2_wire_cell6_n', 'cb_wire_ch1_n'],
                        ['cb_wire_ch1_p', 'sw_wire_l'],
                        ['sw_wire_r', 'load_wire_l'],
                        ['load_wire_r', 'cb_wire_ch1_n'],
                    ];
                    const conns = this.sys.conns;
                    return exp.every(([a, b]) =>
                        conns.some(c => (c.from === a && c.to === b) || (c.from === b && c.to === a))
                    );
                },
            },
            {
                msg: '2. 闭合电源开关，充放电板交流指示灯应变亮',
                mode: 'check',
                op: [
                    {
                        type: 'switch', target: 'ac', part: 'power',
                        msg: '点击交流电源「电源」按钮，闭合电源开关',
                        async act() {
                            const ac = this.sys.comps['ac'];
                            if (ac) { ac.isOn = true; ac.update(); }
                            this.sys.showFloatingTip('电源已闭合，充放电板交流指示灯应点亮', 1800);
                            await _sleep(900);
                        },
                    },
                    {
                        type: 'observe', target: 'cb', part: 'ac-indicator',
                        msg: '观察充放电板「交流电源」指示灯变亮',
                        async act() { await _sleep(1500); },
                    },
                ],
                check() {
                    const ac = this.sys.comps['ac'];
                    return ac && ac.isOn;
                },
            },
            {
                msg: '3. 将充放电板仪表切换开关拨到"I路"，观察CH1的电压和电流数值，默认为浮充模式。',
                mode: 'check',
                op: [
                    {
                        type: 'switch', target: 'cb', part: 'meter-switch',
                        msg: '将充放电板仪表切换开关拨到「I路」',
                        async act() {
                            const cb = this.sys.comps['cb'];
                            if (cb) { cb._meterSwitchPos = -1; cb._updateMeterSwitch(); }
                            this.sys.showFloatingTip('已切到 I路，仪表显示 CH1 的电压与电流', 1800);
                            await _sleep(900);
                        },
                    },
                    {
                        type: 'observe', target: 'cb', part: 'volt-lcd',
                        msg: '观察 CH1 直流电压表/电流表，浮充模式电压约 27V',
                        async act() { await _sleep(1800); },
                    },
                ],
                check() {
                    const cb = this.sys.comps['cb'];
                    return cb && cb._meterSwitchPos === -1;
                },
            },
            {
                msg: '4. 将充放电板CH1切换到"均充"模式，观察充电电压和充电电流变化',
                mode: 'check',
                op: [
                    {
                        type: 'switch', target: 'cb', part: 'ch1-float',
                        msg: '点击 CH1「浮充/均充」开关，从「浮充」切换为「均充」',
                        async act() {
                            const cb = this.sys.comps['cb'];
                            if (cb) { cb._ch1FloatMode = false; cb._updateFloatSwitch('_ch1FloatMode'); }
                            this.sys.showFloatingTip('CH1 已切换到「均充」模式', 1800);
                            await _sleep(900);
                        },
                    },
                    {
                        type: 'observe', target: 'cb', part: 'volt-lcd',
                        msg: '观察充电电压由约 27V 升高到约 28.8V',
                        async act() { await _sleep(1800); },
                    },
                ],
                check() {
                    const cb = this.sys.comps['cb'];
                    return cb && !cb._ch1FloatMode;
                },
            },
            {
                msg: '5. 调整充电电流，将充电电流调整到接近额定值的一半。',
                mode: 'check',
                op: [
                    {
                        type: 'knob', target: 'cb', part: 'ch1-knob',
                        msg: '调节 CH1 电流旋钮，将充电电流调到接近额定值的一半（约 30%）',
                        async act() {
                            const cb = this.sys.comps['cb'];
                            if (cb) {
                                cb._ch1CurrentAdj = 0.3;
                                cb._updateKnob('_ch1CurrentAdj');
                            }
                            this.sys.showFloatingTip('充电电流已调至约额定值的一半', 1800);
                            await _sleep(900);
                        },
                    },
                    {
                        type: 'observe', target: 'cb', part: 'amp-lcd',
                        msg: '观察 CH1 电流表读数接近额定值的一半',
                        async act() { await _sleep(1800); },
                    },
                ],
                check() {
                    const cb = this.sys.comps['cb'];
                    return cb && cb._ch1CurrentAdj >= 0.22 && cb._ch1CurrentAdj <= 0.32;
                },
            },
            {
                msg: '6. 关闭交流电源，合上负荷开关，观察蓄电池放电电压、放电电流',
                mode: 'check',
                op: [
                    {
                        type: 'switch', target: 'ac', part: 'power',
                        msg: '点击交流电源「电源」按钮，关闭交流电源，停止充电',
                        async act() {
                            const ac = this.sys.comps['ac'];
                            if (ac) { ac.isOn = false; ac.update(); }
                            this.sys.showFloatingTip('交流电源已关闭，充电停止', 1800);
                            await _sleep(900);
                        },
                    },
                    {
                        type: 'switch', target: 'sw',
                        msg: '合上负荷开关，接通 20Ω 电阻负载，构成放电回路',
                        async act() {
                            const sw = this.sys.comps['sw'];
                            if (sw) sw.isOn = true;
                            this.sys.showFloatingTip('负荷开关已合上，蓄电池开始放电', 1800);
                            await _sleep(900);
                        },
                    },
                    {
                        type: 'observe', target: 'bt1', part: 'volt',
                        msg: '观察蓄电池放电电压——放电时端电压会低于开路电压并逐渐下降',
                        async act() { await _sleep(1500); },
                    },
                    {
                        type: 'observe', target: 'bt1', part: 'current',
                        msg: '观察蓄电池放电电流——放电电流约为 24V ÷ 20Ω ≈ 1.2A',
                        async act() { await _sleep(1500); },
                    },
                ],
                check() {
                    const ac = this.sys.comps['ac'];
                    const sw = this.sys.comps['sw'];
                    return ac && !ac.isOn && sw && sw.isOn;
                },
            },
            {
                msg: '7. 测试题：铅酸蓄电池充电特性',
                mode: 'quiz',
                quizConfig: {
                    question: '铅酸蓄电池浮充充电和均充充电的主要区别是什么？',
                    options: [
                        '浮充电压高于均充电压',
                        '均充电压高于浮充电压，用于快速充电和活化电池',
                        '浮充用于放电，均充用于充电',
                        '两者没有区别',
                    ],
                    answer: 1,
                    analysis: '浮充充电是在电池充满后以恒定电压（约27V）维持电池容量；均充充电以较高电压（28.8V）进行快速充电，用于补充深放电后的电池容量和消除硫化。',
                },
            },
        ],
    },

    'leadacid-discharge': {
        id: 'leadacid-discharge',
        name: '2.铅酸蓄电池电压与比重测量，判定电池状态',
        steps: [
            {
                msg: '1. 将两组12V蓄电池串联（仅 bt1 负极 → bt2 正极），并将它们的初始容量都设置为0.02，模拟电池电量用光',
                mode: 'check',
                op: [
                    {
                        type: 'wire',
                        msg: '连接串联线：1# 蓄电池负极 → 2# 蓄电池正极（其余暂不接线）',
                        async act() {
                            await _wireSeriesOnly(this.sys, true);
                            this.sys.showFloatingTip('两组蓄电池已串联为 24V', 1500);
                            await _sleep(600);
                        },
                    },
                    {
                        type: 'observe', target: 'bt1', part: 'soc',
                        msg: '调出 1# 蓄电池「参数设置」界面，将「初始 SOC」动态设为 0.02',
                        async act() {
                            const bt1 = this.sys.comps['bt1'];
                            await _setSOCViaConfigDialog(bt1, 0.02, this);
                            this.sys.showFloatingTip('1# 蓄电池 SOC = 0.02（亏电）', 1600);
                            await _sleep(600);
                        },
                    },
                    {
                        type: 'observe', target: 'bt2', part: 'soc',
                        msg: '调出 2# 蓄电池「参数设置」界面，将「初始 SOC」动态设为 0.02',
                        async act() {
                            const bt2 = this.sys.comps['bt2'];
                            await _setSOCViaConfigDialog(bt2, 0.02, this);
                            this.sys.showFloatingTip('2# 蓄电池 SOC = 0.02（亏电）', 1600);
                            await _sleep(600);
                        },
                    },
                ],
                check() {
                    const bt1 = this.sys.comps['bt1'];
                    const bt2 = this.sys.comps['bt2'];
                    const wired = this.sys.conns.some(c =>
                        (c.from === 'bt1_wire_cell6_n' && c.to === 'bt2_wire_cell1_p') ||
                        (c.from === 'bt2_wire_cell1_p' && c.to === 'bt1_wire_cell6_n'));
                    return wired && bt1 && bt2 &&
                        Math.abs(bt1.getSOC() - 0.02) < 0.03 && Math.abs(bt2.getSOC() - 0.02) < 0.03;
                },
            },
            {
                msg: '2. 调出数字式万用表，打到直流200V档，测量蓄电池组电压',
                mode: 'check',
                op: [
                    {
                        type: 'instrument', instrument: 'multimeter',
                        msg: '点击工具栏「选择仪表」，勾选并调出数字万用表',
                        async act() {
                            const mm = this.sys.comps['multimeter'];
                            if (mm) { mm.group.visible(true); this.sys.redrawAll(); }
                            await _sleep(700);
                        },
                    },
                    {
                        type: 'knob', target: 'multimeter', part: 'knob',
                        msg: '将万用表旋钮拨到直流 200V 档（DCV200）',
                        async act() {
                            const mm = this.sys.comps['multimeter'];
                            if (mm) {
                                mm.mode = 'DCV200';
                                if (mm._updateAngleByMode) mm._updateAngleByMode();
                            }
                            this.sys.showFloatingTip('已选择直流 200V 档', 1500);
                            await _sleep(800);
                        },
                    },
                    {
                        type: 'observe', target: 'multimeter', part: 'v',
                        msg: '红表笔接 bt1 正极，黑表笔接 bt2 负极，测量蓄电池组两端电压',
                        async act() {
                            await _connectMeterProbes(this.sys, true);
                            this.sys.showFloatingTip('表笔已接好，正在读取电压', 1500);
                            await _sleep(800);
                        },
                    },
                    {
                        type: 'observe', target: 'multimeter', part: 'lcd',
                        msg: '读取亏电状态蓄电池组电压（应明显低于 24V）',
                        async act() {
                            await _sleep(1200);
                            this.sys.showFloatingTip('亏电电压偏低，说明电池电量不足', 1800);
                            await _sleep(900);
                        },
                    },
                    {
                        type: 'observe', target: 'multimeter', part: 'v',
                        msg: '测量完毕，断开万用表表笔接线',
                        async act() {
                            _disconnectMeterProbes(this.sys);
                            this.sys.showFloatingTip('表笔已断开', 1500);
                            await _sleep(700);
                        },
                    },
                    {
                        type: 'observe', target: 'multimeter', part: 'lcd',
                        msg: '关闭万用表，收回仪表',
                        async act() {
                            _closeMultimeter(this.sys);
                            this.sys.showFloatingTip('万用表已关闭', 1500);
                            await _sleep(700);
                        },
                    },
                ],
                check() {
                    const mm = this.sys.comps['multimeter'];
                    if (!mm || !mm.group.visible()) return false;
                    const exp = [
                        ['multimeter_wire_v', 'bt1_wire_cell1_p'],
                        ['multimeter_wire_com', 'bt2_wire_cell6_n'],
                    ];
                    const conns = this.sys.conns;
                    return exp.every(([a, b]) =>
                        conns.some(c => (c.from === a && c.to === b) || (c.from === b && c.to === a))
                    );
                },
            },
            {
                msg: '3. 打开一个注液孔，使用比重计吸取电解液，读取比重',
                mode: 'check',
                op: [
                    {
                        type: 'observe', target: 'bt1', part: 'cap1',
                        msg: '打开 1# 蓄电池的一个注液孔盖',
                        async act() {
                            _openCellCap(this.sys.comps['bt1'], 0);
                            await _sleep(900);
                        },
                    },
                    {
                        type: 'observe', target: 'hy1', part: 'bulb',
                        msg: '将比重计移动到注液孔上方，吸管对准孔口',
                        async act() {
                            const hy1 = this.sys.comps['hy1'];
                            const bt1 = this.sys.comps['bt1'];
                            await _moveHydrometerToCell(hy1, bt1, 0);
                            await _sleep(500);
                        },
                    },
                    {
                        type: 'observe', target: 'hy1', part: 'bulb',
                        msg: '捏住吸球，排出管内空气',
                        async act() {
                            _pressHydrometerBulb(this.sys.comps['hy1']);
                            await _sleep(900);
                        },
                    },
                    {
                        type: 'observe', target: 'hy1', part: 'scale',
                        msg: '松开吸球，电解液被吸入管中',
                        async act() {
                            await _releaseHydrometerBulb(this.sys.comps['hy1']);
                            await _sleep(300);
                        },
                    },
                    {
                        type: 'observe', target: 'hy1', part: 'scale',
                        msg: '移开比重计，读取比重值（亏电时应低于 1.19）',
                        async act() {
                            const hy1 = this.sys.comps['hy1'];
                            await _moveHydrometerAway(hy1);
                            const sg = hy1 ? hy1.getSpecificGravity() : 1.15;
                            this.sys.showFloatingTip(`比重 ≈ ${sg.toFixed(3)}，低于 1.19，判定为亏电`, 2200);
                            await _sleep(1200);
                        },
                    },
                    {
                        type: 'observe', target: 'hy1', part: 'bulb',
                        msg: '捏住吸球，排出比重计内的电解液',
                        async act() {
                            await _drainHydrometer(this.sys.comps['hy1']);
                            this.sys.showFloatingTip('电解液已排出', 1500);
                            await _sleep(600);
                        },
                    },
                    {
                        type: 'observe', target: 'bt1', part: 'cap1',
                        msg: '关闭蓄电池注液孔盖',
                        async act() {
                            _closeCellCap(this.sys.comps['bt1'], 0);
                            this.sys.showFloatingTip('注液孔盖已盖回', 1500);
                            await _sleep(600);
                        },
                    },
                ],
                check() {
                    const hy1 = this.sys.comps['hy1'];
                    return hy1 && hy1.getSpecificGravity() <= 1.19;
                },
            },
            {
                msg: '4. 将它们的初始容量都设置为0.99，模拟电池充满电',
                mode: 'check',
                op: [
                    {
                        type: 'observe', target: 'bt1', part: 'soc',
                        msg: '调出 1# 蓄电池「参数设置」界面，将「初始 SOC」动态设为 0.99',
                        async act() {
                            const bt1 = this.sys.comps['bt1'];
                            await _setSOCViaConfigDialog(bt1, 0.99, this);
                            this.sys.showFloatingTip('1# 蓄电池 SOC = 0.99（满电）', 1600);
                            await _sleep(600);
                        },
                    },
                    {
                        type: 'observe', target: 'bt2', part: 'soc',
                        msg: '调出 2# 蓄电池「参数设置」界面，将「初始 SOC」动态设为 0.99',
                        async act() {
                            const bt2 = this.sys.comps['bt2'];
                            await _setSOCViaConfigDialog(bt2, 0.99, this);
                            this.sys.showFloatingTip('2# 蓄电池 SOC = 0.99（满电）', 1600);
                            await _sleep(600);
                        },
                    },
                ],
                check() {
                    const bt1 = this.sys.comps['bt1'];
                    const bt2 = this.sys.comps['bt2'];
                    return bt1 && bt2 && Math.abs(bt1.getSOC() - 0.99) < 0.03 && Math.abs(bt2.getSOC() - 0.99) < 0.03;
                },
            },
            {
                msg: '5. 使用数字式万用表，打到直流200V档，测量蓄电池组电压',
                mode: 'check',
                op: [
                    {
                        type: 'instrument', instrument: 'multimeter',
                        msg: '调出数字万用表（若已显示则跳过）',
                        async act() {
                            const mm = this.sys.comps['multimeter'];
                            if (mm) { mm.group.visible(true); this.sys.redrawAll(); }
                            await _sleep(600);
                        },
                    },
                    {
                        type: 'knob', target: 'multimeter', part: 'knob',
                        msg: '将万用表旋钮拨到直流 200V 档（DCV200）',
                        async act() {
                            const mm = this.sys.comps['multimeter'];
                            if (mm) {
                                mm.mode = 'DCV200';
                                if (mm._updateAngleByMode) mm._updateAngleByMode();
                            }
                            this.sys.showFloatingTip('已选择直流 200V 档', 1500);
                            await _sleep(800);
                        },
                    },
                    {
                        type: 'observe', target: 'multimeter', part: 'v',
                        msg: '红表笔接 bt1 正极，黑表笔接 bt2 负极，测量蓄电池组两端电压',
                        async act() {
                            await _connectMeterProbes(this.sys, true);
                            this.sys.showFloatingTip('表笔已接好，正在读取电压', 1500);
                            await _sleep(800);
                        },
                    },
                    {
                        type: 'observe', target: 'multimeter', part: 'lcd',
                        msg: '读取满电状态蓄电池组电压（应接近 24V 及以上）',
                        async act() {
                            await _sleep(1200);
                            this.sys.showFloatingTip('满电电压明显高于亏电状态', 1800);
                            await _sleep(900);
                        },
                    },
                    {
                        type: 'observe', target: 'multimeter', part: 'v',
                        msg: '测量完毕，断开万用表表笔接线',
                        async act() {
                            _disconnectMeterProbes(this.sys);
                            this.sys.showFloatingTip('表笔已断开', 1500);
                            await _sleep(700);
                        },
                    },
                    {
                        type: 'observe', target: 'multimeter', part: 'lcd',
                        msg: '关闭万用表，收回仪表',
                        async act() {
                            _closeMultimeter(this.sys);
                            this.sys.showFloatingTip('万用表已关闭', 1500);
                            await _sleep(700);
                        },
                    },
                ],
                check() {
                    const mm = this.sys.comps['multimeter'];
                    if (!mm || !mm.group.visible()) return false;
                    const exp = [
                        ['multimeter_wire_v', 'bt1_wire_cell1_p'],
                        ['multimeter_wire_com', 'bt2_wire_cell6_n'],
                    ];
                    const conns = this.sys.conns;
                    return exp.every(([a, b]) =>
                        conns.some(c => (c.from === a && c.to === b) || (c.from === b && c.to === a))
                    );
                },
            },
            {
                msg: '6. 打开一个注液孔，使用比重计吸取电解液，读取比重',
                mode: 'check',
                op: [
                    {
                        type: 'observe', target: 'bt1', part: 'cap1',
                        msg: '打开 1# 蓄电池的一个注液孔盖',
                        async act() {
                            _openCellCap(this.sys.comps['bt1'], 0);
                            await _sleep(900);
                        },
                    },
                    {
                        type: 'observe', target: 'hy1', part: 'bulb',
                        msg: '将比重计移动到注液孔上方，吸管对准孔口',
                        async act() {
                            const hy1 = this.sys.comps['hy1'];
                            const bt1 = this.sys.comps['bt1'];
                            await _moveHydrometerToCell(hy1, bt1, 0);
                            await _sleep(500);
                        },
                    },
                    {
                        type: 'observe', target: 'hy1', part: 'bulb',
                        msg: '捏住吸球，排出管内空气',
                        async act() {
                            _pressHydrometerBulb(this.sys.comps['hy1']);
                            await _sleep(900);
                        },
                    },
                    {
                        type: 'observe', target: 'hy1', part: 'scale',
                        msg: '松开吸球，电解液被吸入管中',
                        async act() {
                            await _releaseHydrometerBulb(this.sys.comps['hy1']);
                            await _sleep(300);
                        },
                    },
                    {
                        type: 'observe', target: 'hy1', part: 'scale',
                        msg: '移开比重计，读取比重值（满电时应不低于 1.28）',
                        async act() {
                            const hy1 = this.sys.comps['hy1'];
                            await _moveHydrometerAway(hy1);
                            const sg = hy1 ? hy1.getSpecificGravity() : 1.30;
                            this.sys.showFloatingTip(`比重 ≈ ${sg.toFixed(3)}，不低于 1.28，判定为满电`, 2200);
                            await _sleep(1200);
                        },
                    },
                    {
                        type: 'observe', target: 'hy1', part: 'bulb',
                        msg: '捏住吸球，排出比重计内的电解液',
                        async act() {
                            await _drainHydrometer(this.sys.comps['hy1']);
                            this.sys.showFloatingTip('电解液已排出', 1500);
                            await _sleep(600);
                        },
                    },
                    {
                        type: 'observe', target: 'bt1', part: 'cap1',
                        msg: '关闭蓄电池注液孔盖',
                        async act() {
                            _closeCellCap(this.sys.comps['bt1'], 0);
                            this.sys.showFloatingTip('注液孔盖已盖回', 1500);
                            await _sleep(600);
                        },
                    },
                ],
                check() {
                    const hy1 = this.sys.comps['hy1'];
                    return hy1 && hy1.getSpecificGravity() >= 1.28;
                },
            },
            {
                msg: '7. 测试题：铅酸蓄电池状态判断',
                mode: 'quiz',
                quizConfig: {
                    question: '铅酸蓄电池在亏电（放电）状态和充满电状态相比，开路电压和电解液比重如何变化？',
                    options: [
                        '电压升高，比重升高',
                        '电压降低，比重降低',
                        '电压不变，比重升高',
                        '电压降低，比重不变',
                    ],
                    answer: 1,
                    analysis: '铅酸蓄电池亏电时，开路电压和电解液比重都会较满电时降低。电压和比重是判断电池荷电状态（SOC）的双重指标，两者应同时参考。',
                },
            },
            {
                msg: '8. 测试题：蓄电池操作安全防护',
                mode: 'quiz',
                quizConfig: {
                    question: '操作蓄电池时，为什么要戴防护手套和护目镜？',
                    options: [
                        '电解液是腐蚀性硫酸，防止溅到皮肤、眼睛造成化学灼伤',
                        '为了保持手部和面部清洁，与安全无关',
                        '为了防止蓄电池过充电',
                        '主要是为了美观，符合实验室着装要求',
                    ],
                    answer: 0,
                    analysis: '铅酸蓄电池的电解液是稀硫酸，具有强腐蚀性；充电后期电解液可能沸腾，析出的氢氧气体也可能带出酸雾，在开盖、吸取电解液、测量比重等操作中极易溅出。防护手套和护目镜能有效防止电解液或酸雾灼伤皮肤和眼睛，是最基本的个人防护措施（手套还兼有一定的绝缘作用）。',
                },
            },
        ],
    },
};

export const componentConfigs = [
    // ── 主电路 ──
    { Class: ACPower, id: 'ac', x: 600, y: 2, vRms: 220, freq: 50, isOn: false },
    { Class: Switch, id: 'sw', x: 1200, y: 300, isOn: false },
    { Class: ChargeBoard, id: 'cb', x: 400, y: 220, ch1FloatMode: true, ch2FloatMode: true },
    { Class: LeadAcidBattery, id: 'bt1', x: 250, y: 670, capacity: 56, initialSOC: 0.5, rOn: 0.006, rp: 0.1, cp: 2.3 },
    { Class: LeadAcidBattery, id: 'bt2', x: 750, y: 670, capacity: 56, initialSOC: 0.8, rOn: 0.006, rp: 0.1, cp: 2.3 },
    { Class: Hydrometer, id: 'hy1', x: 1550, y: 200, specificGravity: 1.25 },
    { Class: Resistor, id: 'load', x: 1250, y: 500, value: 20, direction: 'vertical', visible: true },

    // ── 6 种仪表（必须保留） ──
    { Class: Multimeter, id: 'multimeter', x: -50, y: 50, visible: false },
    { Class: MF47Multimeter, id: 'mf47-panel', x: 50, y: 50, visible: false },
    { Class: Oscilloscope_tri, id: 'osc', x: 50, y: 50, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 50, y: 50, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 50, y: 50, visible: false },
    { Class: ElecMeter, id: 'elecmeter', x: 50, y: 50, visible: false },
];

// 一键/自动接线。animated=true 时（自动演示）改用动画连接函数逐条绘制连线。
function _autoWire(sys, animated = false) {
    sys.conns.length = 0;
    const cons = [
        { from: 'ac_wire_p', to: 'cb_wire_ac_l', type: 'wire' },
        { from: 'ac_wire_n', to: 'cb_wire_ac_n', type: 'wire' },
        // 充放电板第1路 → 两个12V蓄电池串联 → 24V
        { from: 'cb_wire_ch1_p', to: 'bt1_wire_cell1_p', type: 'wire' },
        { from: 'bt1_wire_cell6_n', to: 'bt2_wire_cell1_p', type: 'wire' },
        { from: 'bt2_wire_cell6_n', to: 'cb_wire_ch1_n', type: 'wire' },
        // 负载支路：CH1 正极 → 开关 → 20Ω 电阻 → CH1 负极
        { from: 'cb_wire_ch1_p', to: 'sw_wire_l', type: 'wire' },
        { from: 'sw_wire_r', to: 'load_wire_l', type: 'wire' },
        { from: 'load_wire_r', to: 'cb_wire_ch1_n', type: 'wire' },
    ];
    if (animated) {
        // 自动演示：使用动画连接函数，一根一根顺序绘制（每条约3s）
        return (async () => {
            for (const c of cons) {
                await sys.addConnectionAnimated(c);
            }
        })();
    }
    cons.forEach(c => sys.connMgr.addConn(c));
    sys.redrawAll();
}

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
    const ac = sys.comps['ac'];
    if (ac) { ac.isOn = true; ac.update(); }
    const cb = sys.comps['cb'];
    if (cb) { cb._meterSwitchPos = -1; cb._updateMeterSwitch(); }

}

export function fiveStep() { }
