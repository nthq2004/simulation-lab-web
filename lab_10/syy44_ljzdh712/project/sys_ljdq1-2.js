// ═══════════════════════════════════════════════════════════════
// 电气控制箱故障判断、排查 —— 项目配置
//   · componentConfigs  组件布局（单页工程，全部同屏显示）
//   · FAULT_CONFIGS     故障配置（缺相 / 控制回路断线 / 点动故障）
//   · PROJECT_WORKFLOWS 工作流（最新范式：find + check(op[]) + quiz）
// 约定：
//   · 单页工程：不导出 PROJECT_PAGES，consys.js 不创建 PageManager
//   · 初始化不预接线，仅「自动接线 / 起动系统 / 工作流 op」按需接线
//   · 动作一律模拟真实交互；故障走故障界面、仪表走仪表界面、电源开关走参数配置界面
// ═══════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════
// 一、通用辅助（工作流用）
// ═══════════════════════════════════════════════════════════════

const _sysOf = (ctx) => (ctx && ctx.sys) ? ctx.sys : window.sys;
const _sleep = (ms) => new Promise(r => setTimeout(r, ms));
const _comp = (sys, id) => (sys && sys.comps) ? sys.comps[id] : null;

/** 取部件命中节点（组件用 addClickablePart 或人工登记 _parts 时提供） */
function _partNode(comp, partId) {
    return (comp && typeof comp.getClickablePartNode === 'function')
        ? comp.getClickablePartNode(partId) : null;
}

/** 向部件命中节点派发事件，触发组件自身的点击逻辑（优先真实交互，不直接赋值） */
function _firePart(comp, partId, evtName = 'click') {
    const node = _partNode(comp, partId);
    if (!node || typeof node.fire !== 'function') return false;
    node.fire(evtName, { evt: { button: 0, cancelBubble: false } });
    return true;
}

/** 按下按钮并保持 holdMs 后松开（真实 mousedown → mouseup） */
async function _pressBtn(sys, compId, holdMs = 700) {
    const comp = _comp(sys, compId);
    if (!comp) return false;
    if (_firePart(comp, 'btn', 'mousedown')) {
        await _sleep(holdMs);
        _firePart(comp, 'btn', 'mouseup');
        return true;
    }
    if (typeof comp.setManualOverride === 'function') {   // 兜底：组件未登记命中节点
        comp.setManualOverride(true);
        await _sleep(holdMs);
        comp.setManualOverride(false);
    }
    return false;
}

/** 按住按钮不松开（带电测量时线圈需保持得电） */
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

/** 点击断路器手柄合/分闸，直到达到目标状态 */
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

/** 右键菜单「模拟闭合 / 模拟分闸」：强制主触头吸合或复位（供断电测阻） */
async function _setMcOverride(sys, on = true) {
    const mc = _comp(sys, 'km1-mc');
    if (!mc) return false;
    const dev = mc.deviceRef;
    if (dev && typeof dev.setManualOverride === 'function') {
        dev.setManualOverride(!!on);
    } else {
        console.warn('[sys_ljdq1-2] KM1 主触头缺少 deviceRef，无法模拟闭合/分闸');
    }
    try { mc.tick && mc.tick(0.02); } catch (e) { /* 由仿真循环刷新 */ }
    sys.requestRedraw && sys.requestRedraw();
    await _sleep(700);
    return true;
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

/** 万用表档位（旋钮档位直接置位并同步指针角度） */
async function _setMeterMode(sys, mode) {
    const mm = _comp(sys, 'multimeter');
    if (!mm) return;
    mm.mode = mode;
    if (mm._updateAngleByMode) mm._updateAngleByMode();
    if (mm.update) mm.update(0);
    await _sleep(500);
}

/** 万用表表笔动画接线：先清旧表笔线，再逐根动画接红/黑表笔（≤8 根必须动画） */
async function _probeAnimated(sys, redPort, blackPort) {
    if (!redPort || !blackPort) return;
    sys.conns = sys.conns.filter(c => !(String(c.from).startsWith('multimeter') || String(c.to).startsWith('multimeter')));
    sys.redrawAll();
    await sys.connMgr.addConnectionAnimated({ from: 'multimeter_wire_v', to: redPort, type: 'wire' });
    await sys.connMgr.addConnectionAnimated({ from: 'multimeter_wire_com', to: blackPort, type: 'wire' });
    await _sleep(1200);
}

/** 表笔是否已接在指定两端（不分极性） */
function _probesOn(sys, pa, pb) {
    if (!pa || !pb) return false;
    const c = (a, b) => sys.isPortConnected(a, b);
    return (c('multimeter_wire_v', pa) && c('multimeter_wire_com', pb))
        || (c('multimeter_wire_v', pb) && c('multimeter_wire_com', pa));
}

/**
 * 通过参数配置界面动态演示参数修改（统一规范）：
 *   ① 弹框前把组件实时属性同步进 config 副本  ② 弹框  ③ 高亮 #diag_<key> 并填值
 *   ④ 高亮并真正 click「保存」  ⑤ 未关闭则点关闭  ⑥ 兜底 onConfigUpdate
 */
async function _demoSetCfg(wf, compId, key, value, tip) {
    const sys = _sysOf(wf);
    const comp = sys && sys.comps[compId];
    if (!comp || typeof comp.showConfigDialog !== 'function') return;
    (comp.getConfigFields ? comp.getConfigFields() : []).forEach(f => {
        if (f.get) return;
        try { const live = comp[f.key]; if (live !== undefined) comp.config[f.key] = live; } catch (e) { /* 只读忽略 */ }
    });
    comp.showConfigDialog();
    await _sleep(700);

    const input = document.getElementById('diag_' + key);
    if (input) {
        if (wf && typeof wf._flashDomElement === 'function') {
            await wf._flashDomElement(input, tip || `请把该参数改为 ${value}`, 2400);
        }
        input.value = String(value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    const saveBtns = [...document.querySelectorAll('button')].filter(b => b.textContent.trim() === '保存');
    const saveBtn = saveBtns[saveBtns.length - 1];
    if (saveBtn) {
        if (wf && typeof wf._flashDomElement === 'function') {
            await wf._flashDomElement(saveBtn, '点击「保存」确认参数修改', 1800);
        }
        saveBtn.click();
        await _sleep(600);
    }

    const stillInput = document.getElementById('diag_' + key);
    if (stillInput && stillInput.offsetParent !== null) {
        const closeBtn = [...document.querySelectorAll('button')].find(b => /^(关闭|取消)$/.test(b.textContent.trim()));
        if (closeBtn) closeBtn.click();
        await _sleep(400);
    }

    // 生效兜底：保存未生效时直接同步，保证演示不中断
    const now = comp[key];
    if (String(now) !== String(value)) {
        if (typeof comp.onConfigUpdate === 'function') comp.onConfigUpdate({ [key]: value });
    }
    await _sleep(300);
}

// ═══════════════════════════════════════════════════════════════
// 二、断点定位（按当前故障变体返回测量端口）
// ═══════════════════════════════════════════════════════════════

/** 主电路缺相：整相通路两端（用于先判定哪一相断线） */
function _phaseWholeSpan(sys) {
    const mc = _comp(sys, 'km1-mc');
    if (mc && mc._faultOpenPoles && mc._faultOpenPoles.l3) return ['ac_wire_w', 'im01_wire_w1'];
    return ['ac_wire_u', 'im01_wire_u1'];
}

/** 主电路缺相：断点所在元件两端（用于二分法定位） */
function _phaseBreakSpan(sys) {
    const mc = _comp(sys, 'km1-mc');
    const poor = sys && sys._poorContactPorts;
    if (mc && mc._faultOpenPoles && mc._faultOpenPoles.l3) return ['km1-mc_wire_l3', 'km1-mc_wire_t3'];
    if (poor && poor.has('im01_wire_u1')) return ['fr_wire_t1', 'im01_wire_u1'];
    if (poor && poor.has('ac_wire_u')) return ['ac_wire_u', 'acb_wire_l1'];
    return null;
}

/** 控制电路断路：断点两端（带电查找法） */
function _ctrlBreakSpan(sys) {
    if (_comp(sys, 'fu5')?.isBlown?.()) return ['fu5_wire_l', 'fu5_wire_t'];
    if (_comp(sys, 'km1-coil')?._faultCoilOpen) return ['km1-coil_wire_a1', 'km1-coil_wire_a2'];
    if (sys && sys._poorContactPorts && sys._poorContactPorts.has('sb_wire_nc4')) return ['sb_wire_nc3', 'sb_wire_nc4'];
    return null;
}

/** 线圈是否吸合 */
function _coilPickup(sys) {
    const coil = _comp(sys, 'km1-coil');
    return !!(coil && coil.deviceRef && coil.deviceRef.isPickup && coil.deviceRef.isPickup());
}

// ═══════════════════════════════════════════════════════════════
// 三、故障配置（设置 / 修复均走「故障设置」界面，三选一变体随机）
// ═══════════════════════════════════════════════════════════════

export const FAULT_CONFIGS = {
    // ── 故障一：主电路缺相（3 种可能原因，随机选 1）──
    'phase-loss': {
        id: 'phase-loss',
        name: '主电路缺相',
        system: '主电路',
        check() {
            const sys = window.sys;
            if (!sys) return false;
            const mc = sys.comps['km1-mc'];
            if (mc && mc._faultOpenPoles && mc._faultOpenPoles.l3) return true;
            const poor = sys._poorContactPorts;
            if (poor && (poor.has('im01_wire_u1') || poor.has('ac_wire_u'))) return true;
            return false;
        },
        trigger(fixedVariant) {
            const sys = window.sys;
            if (!sys) return;
            const mc = sys.comps['km1-mc'];
            const poor = (sys._poorContactPorts ??= new Set());
            if (mc) mc._faultOpenPoles = {};
            poor.delete('im01_wire_u1');
            poor.delete('ac_wire_u');
            const variants = [
                () => { if (mc) mc._faultOpenPoles = { l3: true }; },   // ① 接触器主触头 L3-T3 断路
                () => { poor.add('im01_wire_u1'); },                    // ② 电动机 U1 接线柱接触不良
                () => { poor.add('ac_wire_u'); },                       // ③ 电源 U 相出线接触不良
            ];
            if (fixedVariant !== undefined && variants[fixedVariant]) variants[fixedVariant]();
            else variants[Math.floor(Math.random() * variants.length)]();
            sys.requestRedraw && sys.requestRedraw();
        },
        repair() {
            const sys = window.sys;
            if (!sys) return;
            const mc = sys.comps['km1-mc'];
            if (mc) mc._faultOpenPoles = {};
            sys._poorContactPorts?.delete('im01_wire_u1');
            sys._poorContactPorts?.delete('ac_wire_u');
            sys.requestRedraw && sys.requestRedraw();
        },
    },

    // ── 故障二：控制电路断路（3 种可能原因，随机选 1）──
    'control-open': {
        id: 'control-open',
        name: '控制电路断路',
        system: '控制回路',
        check() {
            const sys = window.sys;
            if (!sys) return false;
            if (sys.comps['fu5']?.isBlown?.()) return true;
            if (sys.comps['km1-coil']?._faultCoilOpen) return true;
            if (sys._poorContactPorts && sys._poorContactPorts.has('sb_wire_nc4')) return true;
            return false;
        },
        trigger(fixedVariant) {
            const sys = window.sys;
            if (!sys) return;
            const coil = sys.comps['km1-coil'];
            const poor = (sys._poorContactPorts ??= new Set());
            sys.comps['fu5']?.replace?.(0);
            if (coil) coil._faultCoilOpen = false;
            poor.delete('sb_wire_nc4');
            const variants = [
                () => { sys.comps['fu5']?.blow?.(0); },          // ① 二次侧熔断器 FU5 熔断
                () => { if (coil) coil._faultCoilOpen = true; },   // ② 接触器线圈断路
                () => { poor.add('sb_wire_nc4'); },               // ③ 停止按钮出线接触不良
            ];
            if (fixedVariant !== undefined && variants[fixedVariant]) variants[fixedVariant]();
            else variants[Math.floor(Math.random() * variants.length)]();
            sys.requestRedraw && sys.requestRedraw();
        },
        repair() {
            const sys = window.sys;
            if (!sys) return;
            sys.comps['fu5']?.replace?.(0);
            if (sys.comps['km1-coil']) sys.comps['km1-coil']._faultCoilOpen = false;
            sys._poorContactPorts?.delete('sb_wire_nc4');
            sys.requestRedraw && sys.requestRedraw();
        },
    },

    // ── 故障三：点动运行故障（KM1 自锁常开触头 3 种接触不良，随机选 1）──
    'jog-fault': {
        id: 'jog-fault',
        name: '点动运行故障',
        system: '控制回路',
        check() {
            const sys = window.sys;
            const no1 = sys && sys.comps['km1-no1'];
            return !!(no1 && (no1._faultOpen || no1._faultOpenEnd));
        },
        trigger(fixedVariant) {
            const sys = window.sys;
            if (!sys) return;
            const no1 = sys.comps['km1-no1'];
            if (!no1) return;
            no1._faultOpen = false;
            no1._faultOpenEnd = null;
            const variants = [
                () => { no1._faultOpen = true; },        // ① 触头整体断路
                () => { no1._faultOpenEnd = 'com'; },    // ② COM 端子接触不良
                () => { no1._faultOpenEnd = 'no'; },     // ③ NO 端子接触不良
            ];
            if (fixedVariant !== undefined && variants[fixedVariant]) variants[fixedVariant]();
            else variants[Math.floor(Math.random() * variants.length)]();
            sys.requestRedraw && sys.requestRedraw();
        },
        repair() {
            const sys = window.sys;
            const no1 = sys && sys.comps['km1-no1'];
            if (no1) { no1._faultOpen = false; no1._faultOpenEnd = null; }
            sys && sys.requestRedraw && sys.requestRedraw();
        },
    },
};

// ═══════════════════════════════════════════════════════════════
// 四、工作流（单页工程：无 type:'page' 翻页 op）
//   文字从简：每步只写"操作对象 + 动作 + 期望现象"
// ═══════════════════════════════════════════════════════════════

export const PROJECT_WORKFLOWS = {
    // ── 流程一：主电路缺相——断电查找法 ──
    'phase-loss-poweroff': {
        id: 'phase-loss-poweroff', name: '1. 主电路缺相—断电查找法',
        steps: [
            {
                msg: '第 1 步：设置「主电路缺相」故障。',
                mode: 'check',
                op: [
                    {
                        type: 'fault', fault: 'phase-loss',
                        msg: '勾选「主电路缺相」并点击「应用设置」',
                        async act() { await _sleep(600); },
                    },
                ],
                check() {
                    return FAULT_CONFIGS['phase-loss'].check();
                },
            },
            {
                msg: '第 2 步：接线、合闸、按 SB2，电动机不能正常运转。',
                mode: 'check',
                op: [
                    {
                        type: 'observe', target: 'ac',
                        msg: '按图接线（主回路 + 控制回路，共 25 根）',
                        async act() {
                            const sys = _sysOf(this);
                            sys.conns.length = 0;
                            _autoWire(sys);
                            await _sleep(900);
                        },
                    },
                    {
                        type: 'switch', target: 'acb', part: 'handle',
                        msg: '点击手柄合上 QF',
                        async act() {
                            await _ensureAcb(_sysOf(this), true);
                            await _sleep(700);
                        },
                    },
                    {
                        type: 'btn', target: 'ss', part: 'btn',
                        msg: '按住 SB2 起动',
                        async act() {
                            const sys = _sysOf(this);
                            await _pressBtn(sys, 'ss', 900);
                            await _waitFor(sys, x => _coilPickup(x), 8000, 200);
                            this._s2Pressed = true;
                            await _sleep(1500);
                        },
                    },
                    {
                        type: 'observe', target: 'im01',
                        msg: '观察电动机缺相运行（不转或运转异常）',
                        async act() { await _sleep(2500); },
                    },
                ],
                check() {
                    const sys = _sysOf(this);
                    const c = (a, b) => sys.isPortConnected(a, b);
                    const ac = _comp(sys, 'ac');
                    const acb = _comp(sys, 'acb');
                    const wired = c('acb_wire_t1', 'km1-mc_wire_l1')
                        && c('km1-mc_wire_t3', 'fr_wire_l3')
                        && c('tc_wire_s2', 'sb_wire_nc3')
                        && c('ss_wire_no2', 'km1-coil_wire_a1');
                    return wired && ac && ac.isOn && acb && acb.isClosed()
                        && FAULT_CONFIGS['phase-loss'].check()
                        && (this._s2Pressed || _coilPickup(sys));
                },
            },
            {
                msg: '第 3 步：断电，并强制闭合 KM1 主触头。',
                mode: 'check',
                op: [
                    {
                        type: 'observe', target: 'ac',
                        msg: '右键电源 → 参数配置，把电源开关改为「关闭」',
                        async act() {
                            await _demoSetCfg(this, 'ac', 'isOn', false, '把「电源开关」改为「关闭」，切断三相电源');
                        },
                    },
                    {
                        type: 'observe', target: 'km1-mc',
                        msg: '右键接触器主触头 → 模拟闭合（便于断电测阻）',
                        async act() {
                            await _setMcOverride(_sysOf(this), true);
                        },
                    },
                ],
                check() {
                    const sys = _sysOf(this);
                    const ac = _comp(sys, 'ac');
                    const mc = _comp(sys, 'km1-mc');
                    return ac && !ac.isOn
                        && mc && mc.deviceRef && mc.deviceRef.getManualOverride() === true;
                },
            },
            {
                msg: '第 4 步：万用表 200Ω 档测通路，找出断线相。',
                mode: 'check',
                op: [
                    {
                        type: 'instrument', instrument: 'multimeter', target: 'multimeter',
                        msg: '选择仪表：数字万用表',
                        async act() { await _sleep(500); },
                    },
                    {
                        type: 'observe', target: 'multimeter',
                        msg: '把档位旋钮打到 200Ω',
                        async act() { await _setMeterMode(_sysOf(this), 'RES200'); },
                    },
                    {
                        type: 'observe', target: 'multimeter',
                        ports: ['multimeter_wire_v', 'multimeter_wire_com'],
                        msg: '红、黑表笔跨接该相通路两端（动画接线）',
                        async act() {
                            const sys = _sysOf(this);
                            const span = _phaseWholeSpan(sys);
                            this._span4 = span;
                            await _probeAnimated(sys, span[0], span[1]);
                        },
                    },
                    {
                        type: 'observe', target: 'multimeter',
                        msg: '读数超量程（O.L），该相断线',
                        async act() {
                            const sys = _sysOf(this);
                            const ok = await _waitFor(x => {
                                const mm = _comp(x, 'multimeter');
                                return !!(mm && Math.abs(mm.value || 0) > 5);
                            }, 12000, 250);
                            if (ok) this._s4Open = true;
                            await _sleep(2000);
                        },
                    },
                ],
                check() {
                    const sys = _sysOf(this);
                    const mm = _comp(sys, 'multimeter');
                    if (!mm || !mm.group || !mm.group.visible()) return false;
                    if (mm.mode !== 'RES200') return false;
                    const span = this._span4 || _phaseWholeSpan(sys);
                    if (!_probesOn(sys, span[0], span[1])) return false;
                    if (this._s4Open) return true;
                    return Math.abs(mm.value || 0) > 5;
                },
            },
            {
                msg: '第 5 步：二分法分段测量，锁定断点元件。',
                mode: 'check',
                op: [
                    {
                        type: 'observe', target: 'multimeter',
                        ports: ['multimeter_wire_v', 'multimeter_wire_com'],
                        msg: '表笔移到断线相中间元件的两端',
                        async act() {
                            const sys = _sysOf(this);
                            const span = _phaseBreakSpan(sys);
                            this._span5 = span;
                            if (span) await _probeAnimated(sys, span[0], span[1]);
                        },
                    },
                    {
                        type: 'observe', target: 'multimeter',
                        msg: '该段读数 O.L，断点就在此元件',
                        async act() {
                            const sys = _sysOf(this);
                            const ok = await _waitFor(x => {
                                const mm = _comp(x, 'multimeter');
                                return !!(mm && Math.abs(mm.value || 0) > 5);
                            }, 12000, 250);
                            if (ok) this._s5Locate = true;
                            await _sleep(2000);
                        },
                    },
                ],
                check() {
                    const sys = _sysOf(this);
                    const span = this._span5 || _phaseBreakSpan(sys);
                    if (!span) return false;
                    const mm = _comp(sys, 'multimeter');
                    if (!mm || mm.mode !== 'RES200') return false;
                    if (!_probesOn(sys, span[0], span[1])) return false;
                    if (this._s5Locate) return true;
                    return Math.abs(mm.value || 0) > 5;
                },
            },
            {
                msg: '第 6 步：修复「主电路缺相」，读数回到 0Ω。',
                mode: 'check',
                op: [
                    {
                        type: 'fault', fault: 'phase-loss', repair: true,
                        msg: '取消勾选「主电路缺相」并应用设置',
                        async act() {
                            // 修复前记录表笔所在两端，供 check() 复用
                            this._span6 = _phaseBreakSpan(_sysOf(this));
                            await _sleep(600);
                        },
                    },
                    {
                        type: 'observe', target: 'multimeter',
                        msg: '读数变为接近 0Ω（导通）',
                        async act() {
                            const sys = _sysOf(this);
                            const ok = await _waitFor(x => {
                                const mm = _comp(x, 'multimeter');
                                return !!(mm && Math.abs(mm.value || 0) < 5);
                            }, 12000, 250);
                            if (ok) this._s6Repaired = true;
                            await _sleep(2000);
                        },
                    },
                ],
                check() {
                    const sys = _sysOf(this);
                    const span = this._span6 || this._span5;
                    const mm = _comp(sys, 'multimeter');
                    const repaired = !FAULT_CONFIGS['phase-loss'].check();
                    const onSpan = span ? _probesOn(sys, span[0], span[1]) : false;
                    const zero = mm ? Math.abs(mm.value || 0) < 5 : false;
                    return repaired && (this._s6Repaired || (onSpan && zero));
                },
            },
            {
                msg: '第 7 步：复位 KM1、接通电源，按 SB2 正常起动。',
                mode: 'check',
                op: [
                    {
                        type: 'observe', target: 'km1-mc',
                        msg: '右键接触器主触头 → 模拟分闸复位',
                        async act() { await _setMcOverride(_sysOf(this), false); },
                    },
                    {
                        type: 'observe', target: 'ac',
                        msg: '右键电源 → 参数配置，把电源开关改为「开启」',
                        async act() {
                            await _demoSetCfg(this, 'ac', 'isOn', true, '把「电源开关」改为「开启」，恢复三相电源');
                        },
                    },
                    {
                        type: 'btn', target: 'ss', part: 'btn',
                        msg: '按住 SB2 起动，电动机正常运转',
                        async act() {
                            const sys = _sysOf(this);
                            await _pressBtn(sys, 'ss', 900);
                            await _waitFor(sys, x => {
                                const m = _comp(x, 'im01');
                                return !!(m && m.rpm > 30);
                            }, 15000, 250);
                            await _sleep(1500);
                        },
                    },
                ],
                check() {
                    const sys = _sysOf(this);
                    const mc = _comp(sys, 'km1-mc');
                    const ac = _comp(sys, 'ac');
                    const motor = _comp(sys, 'im01');
                    return mc && mc.deviceRef && mc.deviceRef.getManualOverride() === false
                        && ac && ac.isOn
                        && !FAULT_CONFIGS['phase-loss'].check()
                        && motor && motor.rpm > 30;
                },
            },
            {
                msg: '第 8 步：测试题——断线排查的二分法。',
                mode: 'quiz',
                quizConfig: {
                    question: '用万用表电阻档排查主电路一相断线，二分法分段测量的正确做法是（　）。',
                    options: [
                        '先测电源进线到电机接线柱的整相通断；不通再取中间元件两侧分段测量，逐步缩小范围',
                        '从电机端开始逐个拆下元件分别测量，直到找到断点',
                        '只测电源三相电压，电压正常即可排除断线',
                        '断线一定在电源进线，直接更换电源线',
                    ],
                    answer: 0,
                    analysis: '先测首尾两端；不通则以中间元件（如接触器主触头 L3-T3）为分界点分段测量，前段不通说明断点在前，前段通则断点在后。每次可排除一半，测量次数最少。',
                },
            },
        ],
    },

    // ── 流程二：控制电路断线——带电查找法 ──
    'control-open-energized': {
        id: 'control-open-energized', name: '2. 控制电路断线—带电查找法',
        steps: [
            {
                msg: '第 1 步：设置「控制电路断路」故障。',
                mode: 'check',
                op: [
                    {
                        type: 'fault', fault: 'control-open',
                        msg: '勾选「控制电路断路」并点击「应用设置」',
                        async act() { await _sleep(600); },
                    },
                ],
                check() {
                    return FAULT_CONFIGS['control-open'].check();
                },
            },
            {
                msg: '第 2 步：接线合闸，按 SB2，接触器不吸合。',
                mode: 'check',
                op: [
                    {
                        type: 'observe', target: 'ac',
                        msg: '按图接线（主回路 + 控制回路）',
                        async act() {
                            const sys = _sysOf(this);
                            sys.conns.length = 0;
                            _autoWire(sys);
                            await _sleep(900);
                        },
                    },
                    {
                        type: 'switch', target: 'acb', part: 'handle',
                        msg: '点击手柄合上 QF',
                        async act() {
                            await _ensureAcb(_sysOf(this), true);
                            await _sleep(700);
                        },
                    },
                    {
                        type: 'btn', target: 'ss', part: 'btn',
                        msg: '按住 SB2 起动，观察接触器不吸合',
                        async act() {
                            const sys = _sysOf(this);
                            await _pressBtn(sys, 'ss', 900);
                            this._s2Pressed = true;
                            await _sleep(2000);
                        },
                    },
                ],
                check() {
                    const sys = _sysOf(this);
                    const c = (a, b) => sys.isPortConnected(a, b);
                    const ac = _comp(sys, 'ac');
                    const acb = _comp(sys, 'acb');
                    const wired = c('ac_wire_u', 'acb_wire_l1')
                        && c('tc_wire_s2', 'sb_wire_nc3')
                        && c('ss_wire_no2', 'km1-coil_wire_a1')
                        && c('km1-coil_wire_a2', 'fr-nc_wire_nc');
                    return wired && ac && ac.isOn && acb && acb.isClosed()
                        && !_coilPickup(sys)
                        && FAULT_CONFIGS['control-open'].check();
                },
            },
            {
                msg: '第 3 步：按住 SB2 不放，准备带电测量。',
                mode: 'check',
                op: [
                    {
                        type: 'btn', target: 'ss', part: 'btn',
                        msg: '按住 SB2 保持闭合（等效一直按下）',
                        async act() {
                            _holdBtn(_sysOf(this), 'ss');
                            await _sleep(1200);
                        },
                    },
                ],
                check() {
                    const ss = _comp(_sysOf(this), 'ss');
                    return !!ss && (ss._isPressed === true || ss.getManualOverride() === true);
                },
            },
            {
                msg: '第 4 步：万用表 ACV500 带电测断点两端电压。',
                mode: 'check',
                op: [
                    {
                        type: 'instrument', instrument: 'multimeter', target: 'multimeter',
                        msg: '选择仪表：数字万用表',
                        async act() { await _sleep(500); },
                    },
                    {
                        type: 'observe', target: 'multimeter',
                        msg: '把档位旋钮打到交流 500V（~500V）',
                        async act() { await _setMeterMode(_sysOf(this), 'ACV500'); },
                    },
                    {
                        type: 'observe', target: 'multimeter',
                        ports: ['multimeter_wire_v', 'multimeter_wire_com'],
                        msg: '两表笔跨接控制回路中间元件的两端（动画接线）',
                        async act() {
                            const sys = _sysOf(this);
                            const span = _ctrlBreakSpan(sys);
                            this._span4 = span;
                            if (span) await _probeAnimated(sys, span[0], span[1]);
                        },
                    },
                    {
                        type: 'observe', target: 'multimeter',
                        msg: '读数约 220V，该两端即断点',
                        async act() {
                            const sys = _sysOf(this);
                            const ok = await _waitFor(x => {
                                const mm = _comp(x, 'multimeter');
                                const v = mm ? Math.abs(mm.value || 0) : 0;
                                return v > 100 && v < 420;
                            }, 12000, 250);
                            if (ok) this._s4Volt = true;
                            await _sleep(2000);
                        },
                    },
                ],
                check() {
                    const sys = _sysOf(this);
                    const mm = _comp(sys, 'multimeter');
                    if (!mm || !mm.group || !mm.group.visible()) return false;
                    if (mm.mode !== 'ACV500') return false;
                    const span = this._span4 || _ctrlBreakSpan(sys);
                    if (!span || !_probesOn(sys, span[0], span[1])) return false;
                    if (this._s4Volt) return true;
                    const v = Math.abs(mm.value || 0);
                    return v > 100 && v < 420;
                },
            },
            {
                msg: '第 5 步：松开 SB2，修复故障后重新起动。',
                mode: 'check',
                op: [
                    {
                        type: 'btn', target: 'ss', part: 'btn',
                        msg: '松开 SB2 恢复按钮状态',
                        async act() {
                            _releaseBtn(_sysOf(this), 'ss');
                            await _sleep(900);
                        },
                    },
                    {
                        type: 'fault', fault: 'control-open', repair: true,
                        msg: '取消勾选「控制电路断路」并应用设置',
                        async act() { await _sleep(600); },
                    },
                    {
                        type: 'btn', target: 'ss', part: 'btn',
                        msg: '按住 SB2 起动，接触器吸合、电动机运行',
                        async act() {
                            const sys = _sysOf(this);
                            await _pressBtn(sys, 'ss', 900);
                            await _waitFor(sys, x => {
                                const m = _comp(x, 'im01');
                                return !!(m && m.rpm > 30) && _coilPickup(x);
                            }, 15000, 250);
                            await _sleep(1500);
                        },
                    },
                ],
                check() {
                    const sys = _sysOf(this);
                    const ss = _comp(sys, 'ss');
                    const motor = _comp(sys, 'im01');
                    return !FAULT_CONFIGS['control-open'].check()
                        && ss && ss._isPressed !== true
                        && _coilPickup(sys)
                        && motor && motor.rpm > 30;
                },
            },
            {
                msg: '第 6 步：测试题——带电查找法的判据。',
                mode: 'quiz',
                quizConfig: {
                    question: '控制回路只有一个断点时，用交流电压档带电测量，判断断点的依据是（　）。',
                    options: [
                        '断点两端电压等于电源电压（约 220V），其余正常导通元件两端电压约为 0',
                        '断点两端电压为 0，其余元件两端电压等于电源电压',
                        '回路无电流，各处电压都相同',
                        '必须断电用电阻档测量，带电无法判断',
                    ],
                    answer: 0,
                    analysis: '回路只有一个断点时无电流，正常导通的导线与元件两端电压约为 0；断点两侧一边为 0V、一边为电源电压，故电压差约为电源电压（控制变压器副边 220V），测到即断点。',
                },
            },
        ],
    },

    // ── 流程三：电动机点动——断电查找法 ──
    'jog-fault-finder': {
        id: 'jog-fault-finder', name: '3. 电动机点动—断电查找法',
        steps: [
            {
                msg: '第 1 步：设置「点动运行故障」。',
                mode: 'check',
                op: [
                    {
                        type: 'fault', fault: 'jog-fault',
                        msg: '勾选「点动运行故障」并点击「应用设置」',
                        async act() { await _sleep(600); },
                    },
                ],
                check() {
                    return FAULT_CONFIGS['jog-fault'].check();
                },
            },
            {
                msg: '第 2 步：接线合闸，按 SB2 转动，松开即停。',
                mode: 'check',
                op: [
                    {
                        type: 'observe', target: 'ac',
                        msg: '按图接线（主回路 + 控制回路）',
                        async act() {
                            const sys = _sysOf(this);
                            sys.conns.length = 0;
                            _autoWire(sys);
                            await _sleep(900);
                        },
                    },
                    {
                        type: 'switch', target: 'acb', part: 'handle',
                        msg: '点击手柄合上 QF',
                        async act() {
                            await _ensureAcb(_sysOf(this), true);
                            await _sleep(700);
                        },
                    },
                    {
                        type: 'btn', target: 'ss', part: 'btn',
                        msg: '按住 SB2 起动，电动机转动',
                        async act() {
                            const sys = _sysOf(this);
                            await _pressBtn(sys, 'ss', 2000);
                            await _sleep(600);
                        },
                    },
                    {
                        type: 'observe', target: 'km1-coil',
                        msg: '松开 SB2 后线圈失电、电动机停止（自锁失效）',
                        async act() {
                            const sys = _sysOf(this);
                            await _waitFor(x => !_coilPickup(x), 10000, 250);
                            this._s2Released = true;
                            await _sleep(2500);
                        },
                    },
                ],
                check() {
                    const sys = _sysOf(this);
                    const c = (a, b) => sys.isPortConnected(a, b);
                    const ac = _comp(sys, 'ac');
                    const acb = _comp(sys, 'acb');
                    const wired = c('ac_wire_u', 'acb_wire_l1')
                        && c('tc_wire_s2', 'sb_wire_nc3')
                        && c('ss_wire_no2', 'km1-coil_wire_a1')
                        && c('km1-coil_wire_a2', 'fr-nc_wire_nc');
                    return wired && ac && ac.isOn && acb && acb.isClosed()
                        && !_coilPickup(sys)
                        && FAULT_CONFIGS['jog-fault'].check();
                },
            },
            {
                msg: '第 3 步：断开 QF，强制闭合 KM1，万用表 200Ω。',
                mode: 'check',
                op: [
                    {
                        type: 'switch', target: 'acb', part: 'handle',
                        msg: '点击手柄断开 QF（切断电源）',
                        async act() {
                            await _ensureAcb(_sysOf(this), false);
                            await _sleep(700);
                        },
                    },
                    {
                        type: 'observe', target: 'km1-mc',
                        msg: '右键接触器主触头 → 模拟闭合（自锁触头随之吸合）',
                        async act() { await _setMcOverride(_sysOf(this), true); },
                    },
                    {
                        type: 'instrument', instrument: 'multimeter', target: 'multimeter',
                        msg: '选择仪表：数字万用表',
                        async act() { await _sleep(500); },
                    },
                    {
                        type: 'observe', target: 'multimeter',
                        msg: '把档位旋钮打到 200Ω',
                        async act() { await _setMeterMode(_sysOf(this), 'RES200'); },
                    },
                ],
                check() {
                    const sys = _sysOf(this);
                    const acb = _comp(sys, 'acb');
                    const mc = _comp(sys, 'km1-mc');
                    const mm = _comp(sys, 'multimeter');
                    return acb && !acb.isClosed()
                        && mc && mc.deviceRef && mc.deviceRef.getManualOverride() === true
                        && mm && mm.group && mm.group.visible() && mm.mode === 'RES200';
                },
            },
            {
                msg: '第 4 步：测 KM1 自锁触头 COM-NO，电阻 O.L。',
                mode: 'check',
                op: [
                    {
                        type: 'observe', target: 'multimeter',
                        ports: ['multimeter_wire_v', 'multimeter_wire_com'],
                        msg: '两表笔接自锁常开触头的 COM、NO 两端（动画接线）',
                        async act() {
                            const sys = _sysOf(this);
                            await _probeAnimated(sys, 'km1-no1_wire_com', 'km1-no1_wire_no');
                        },
                    },
                    {
                        type: 'observe', target: 'multimeter',
                        msg: '读数 O.L（超量程），自锁触头即断点',
                        async act() {
                            const sys = _sysOf(this);
                            const ok = await _waitFor(x => {
                                const mm = _comp(x, 'multimeter');
                                return !!(mm && Math.abs(mm.value || 0) > 5);
                            }, 12000, 250);
                            if (ok) this._s4Open = true;
                            await _sleep(2000);
                        },
                    },
                ],
                check() {
                    const sys = _sysOf(this);
                    const mm = _comp(sys, 'multimeter');
                    if (!mm || !mm.group || !mm.group.visible()) return false;
                    if (mm.mode !== 'RES200') return false;
                    if (!_probesOn(sys, 'km1-no1_wire_com', 'km1-no1_wire_no')) return false;
                    if (this._s4Open) return true;
                    return Math.abs(mm.value || 0) > 5;
                },
            },
            {
                msg: '第 5 步：修复故障、复位 KM1，合闸后自锁运行。',
                mode: 'check',
                op: [
                    {
                        type: 'fault', fault: 'jog-fault', repair: true,
                        msg: '取消勾选「点动运行故障」并应用设置',
                        async act() { await _sleep(600); },
                    },
                    {
                        type: 'observe', target: 'km1-mc',
                        msg: '右键接触器主触头 → 模拟分闸复位',
                        async act() { await _setMcOverride(_sysOf(this), false); },
                    },
                    {
                        type: 'switch', target: 'acb', part: 'handle',
                        msg: '点击手柄合上 QF',
                        async act() {
                            await _ensureAcb(_sysOf(this), true);
                            await _sleep(700);
                        },
                    },
                    {
                        type: 'btn', target: 'ss', part: 'btn',
                        msg: '按一下 SB2 再松开，电动机自锁运行',
                        async act() {
                            const sys = _sysOf(this);
                            await _pressBtn(sys, 'ss', 900);
                            await _waitFor(x => _coilPickup(x), 12000, 250);
                            this._s5Lock = true;
                            await _sleep(1500);
                        },
                    },
                ],
                check() {
                    const sys = _sysOf(this);
                    const mc = _comp(sys, 'km1-mc');
                    const acb = _comp(sys, 'acb');
                    const motor = _comp(sys, 'im01');
                    return !FAULT_CONFIGS['jog-fault'].check()
                        && mc && mc.deviceRef && mc.deviceRef.getManualOverride() === false
                        && acb && acb.isClosed()
                        && _coilPickup(sys)
                        && motor && motor.rpm > 30;
                },
            },
            {
                msg: '第 6 步：测试题——点动现象的判别。',
                mode: 'quiz',
                quizConfig: {
                    question: '按下起动按钮电动机转动、松开即停（自锁失效），最可能的故障部位是（　）。',
                    options: [
                        '并联在起动按钮上的接触器常开自锁触头（COM-NO）接触不良',
                        '接触器线圈烧毁断路',
                        '起动按钮损坏，无法闭合',
                        '电源电压过低，接触器吸合后不能保持',
                    ],
                    answer: 0,
                    analysis: '按下时线圈经起动按钮得电；松开后靠并联的常开辅助触头维持通电。该触头接触不良时松开即失电，表现为点动。断电测 COM-NO 两端（触头应吸合）接近 0Ω，若超量程即为断点。',
                },
            },
        ],
    },
};

// ═══════════════════════════════════════════════════════════════
// 五、组件布局（单页，全部同屏；仪表默认隐藏）
// ═══════════════════════════════════════════════════════════════

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
    { Class: DiagramStopButton, id: 'sb', x: 580, y: 200, visible: true, label: 'SB1' },
    { Class: DiagramStartButton, id: 'ss', x: 780, y: 200, visible: true, label: 'SB2' },
    { Class: AuxNOContact, id: 'km1-no1', x: 780, y: 350, deviceid: 'KM1', visible: true },
    { Class: ContactorCoil, id: 'km1-coil', x: 980, y: 200, deviceid: 'KM1', visible: true },
    { Class: ThermalNCContact, id: 'fr-nc', x: 950, y: 100, deviceid: 'FR1', visible: true },

    // 7 种仪表（默认隐藏，经「选择仪表」勾选显示）
    { Class: TsCurveDisplay, id: 'ts-curve', x: 1150, y: 100, visible: false, quadrants: 1 },
    { Class: Multimeter, id: 'multimeter', x: 560, y: 520, visible: false },
    { Class: MF47Multimeter, id: 'mf47-panel', x: 1050, y: 180, visible: false },
    { Class: Oscilloscope_tri, id: 'osc', x: 50, y: 50, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 50, y: 50, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 50, y: 50, visible: false },
    { Class: ElecMeter, id: 'elecmeter', x: 50, y: 50, visible: false },
    { Class: RealMegohmMeter, id: 'megohm', x: 50, y: 50, visible: false },

    // 电机起动控制箱（实物图片展示，用于点击识别设备）
    { Class: MotorStarterPanel, id: 'starter-panel', x: 1180, y: 20, visible: true },
];

// ═══════════════════════════════════════════════════════════════
// 六、接线辅助
// ═══════════════════════════════════════════════════════════════

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
        // 控制回路：副边 s2 → 停止按钮 → [起动按钮 ∥ 常开自锁触头] → 线圈 → 热继常闭 → FU5 → s1
        { from: 'tc_wire_s2', to: 'sb_wire_nc3', type: 'wire' },
        { from: 'sb_wire_nc4', to: 'ss_wire_no1', type: 'wire' },
        { from: 'sb_wire_nc4', to: 'km1-no1_wire_com', type: 'wire' },
        { from: 'ss_wire_no2', to: 'km1-coil_wire_a1', type: 'wire' },
        { from: 'km1-no1_wire_no', to: 'ss_wire_no2', type: 'wire' },
        { from: 'km1-coil_wire_a2', to: 'fr-nc_wire_nc', type: 'wire' },
        { from: 'fr-nc_wire_com', to: 'fu5_wire_t', type: 'wire' },
        { from: 'fu5_wire_l', to: 'tc_wire_s1', type: 'wire' },
    ];
    cons.forEach(c => sys.connMgr.addConn(c));
    sys.redrawAll();
}

/** 合上电源（备用） */
function _powerOn(sys) {
    const acb = _comp(sys, 'acb');
    if (acb) acb.close();
}

// ═══════════════════════════════════════════════════════════════
// 七、工具栏快捷操作
// ═══════════════════════════════════════════════════════════════

export function initSlider(sys) {
    const s = sys || (typeof window !== 'undefined' ? window.sys : null);
    if (!s) return;
    // 自动演示时只保留箭头指示与部件高亮，不闪亮整个组件（平台约定）
    s._noBlinkHighlight = true;
}

export function applyAllPresets(opts) {
    // 平台约定：系统初始化（opts.init）不做预接线，
    // 只有工具栏「自动接线」「起动系统」或工作流 op.act 才按需接线。
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
        case 0: _autoWire(sys); break;                        // ① 按图接线
        case 1: await _ensureAcb(sys, true); break;            // ② 合上 QF
        case 2: await _pressBtn(sys, 'ss', 700); break;        // ③ 按 SB2 起动
        case 3: await _pressBtn(sys, 'sb', 700); break;        // ④ 按 SB1 停止
        case 4: await _ensureAcb(sys, false); break;           // ⑤ 断开 QF
    }
    if (sys.redrawAll) sys.redrawAll();
}
