# -*- coding: utf-8 -*-
import os

base = r"E:\BaiduSyncdisk\03 教学材料\仿真软件制作\网站\lab_07\sys17-aboard"
p = os.path.join(base, "project", "sys_ljdq5-4.js")
s = open(p, encoding="utf-8").read()

# ─────────────────────────────────────────────
# A) 从 _autoWire 中删除岸电箱输入的 4 根线（由学员手动连接）
# ─────────────────────────────────────────────
old_a = """        // ── 岸电回路：简单三相电源 → 岸电箱 → 岸电主开关 ──
        { from: 'shore_in_wire_u', to: 'shorebox1_wire_in1', type: 'wire' },
        { from: 'shore_in_wire_v', to: 'shorebox1_wire_in2', type: 'wire' },
        { from: 'shore_in_wire_w', to: 'shorebox1_wire_in3', type: 'wire' },"""
new_a = """        // ── 岸电回路：岸电箱输入（U/V/W 三线 + N）需学员手动连接，不在此自动接线 ──
        //    （岸电箱输出 → 负序继电器、岸电主开关 仍自动接线）"""
ca = s.count(old_a)
s = s.replace(old_a, new_a)

old_b = """        // 岸电箱 N 船体接线柱 → 岸电电源 N 端口
        { from: 'shorebox1_wire_n', to: 'shore_in_wire_n', type: 'wire' },"""
new_b = """        // （岸电箱 N → 岸电电源 N 由学员在操作流程 2 第 2 步手动连接，不在此自动接线）"""
cb = s.count(old_b)
s = s.replace(old_b, new_b)

# ─────────────────────────────────────────────
# B) 新增流程二：船电转换为岸电供电
# ─────────────────────────────────────────────
old_end = "    },\n};"   # PROJECT_WORKFLOWS 末尾（intro 收尾 + 对象收尾）
new_end = """    },

    // ── 流程二：船电转换为岸电供电 ──
    'shore-power-switch': {
        id: 'shore-power-switch',
        name: '2. 船电转换为岸电供电',
        steps: [
            {
                msg: '1. 自动接线、起动主发电机、合闸供电：将船电侧（同步发电机→主开关→汇流排）接线，起动 1# 主发电机并合上船电主开关，由船电向汇流排供电。',
                mode: 'check',
                act() {
                    const sys = this.sys;
                    if (!sys) return;
                    _autoWire(sys);
                    const g1 = sys.comps['gen1'];
                    if (g1) { g1.freq = 50; g1.isOn = true; }
                    const q1 = sys.comps['qf1'];
                    if (q1) {
                        if (q1.getState() === 'on' && q1.tryTrip) q1.tryTrip();
                        q1._chargeProg = 5; q1._charged = true;
                        if (q1.tryClose) q1.tryClose();
                    }
                },
                check() {
                    const sys = this.sys;
                    const g1 = sys.comps['gen1'];
                    const q1 = sys.comps['qf1'];
                    return !!(g1 && g1.isOn && q1 && q1.getState() === 'on');
                },
            },
            {
                msg: '2. 请手动接通岸电箱输入线（此 4 根线已不在“一键自动连线”中，须学员手动连接）：岸电电源 U/V/W 接岸电箱 in1/in2/in3，岸电电源 N 接岸电箱 N（船体接线柱），然后合上岸电电源（开启岸电输入电源）。',
                mode: 'check',
                act() {
                    const sys = this.sys;
                    if (!sys) return;
                    const add = (a, b) => sys.connMgr.addConn({ from: a, to: b, type: 'wire' });
                    add('shore_in_wire_u', 'shorebox1_wire_in1');
                    add('shore_in_wire_v', 'shorebox1_wire_in2');
                    add('shore_in_wire_w', 'shorebox1_wire_in3');
                    add('shorebox1_wire_n', 'shore_in_wire_n');
                    const sp = sys.comps['shore_in'];
                    if (sp) { sp.isOn = true; sp.phaseSeq = 'pos'; }
                },
                check() {
                    const sys = this.sys;
                    const connected = (a, b) => sys.conns.some(c => (c.from === a && c.to === b) || (c.from === b && c.to === a));
                    const ok = connected('shore_in_wire_u', 'shorebox1_wire_in1')
                            && connected('shore_in_wire_v', 'shorebox1_wire_in2')
                            && connected('shore_in_wire_w', 'shorebox1_wire_in3')
                            && connected('shorebox1_wire_n', 'shore_in_wire_n');
                    const sp = sys.comps['shore_in'];
                    return ok && !!(sp && sp.isOn);
                },
            },
            {
                msg: '3. 转换相序开关（相序1/相序2），观察岸电箱液晶显示的线电压、频率与相序指示灯：确认输出为正相序后，合上岸电箱内的空气开关（断路器）。',
                mode: 'check',
                act() {
                    const sys = this.sys;
                    const sb = sys && sys.comps['shorebox1'];
                    if (!sb) return;
                    sb._knob = 1;                       // 相序1（进线正序时输出为正相序）
                    if (sb._updateSwitchLines) sb._updateSwitchLines();
                    if (sb._knobInd) sb._knobInd.rotation(sb._knobAngle());
                    if (sb.tryCloseBreaker) sb.tryCloseBreaker();
                },
                check() {
                    const sys = this.sys;
                    const sb = sys && sys.comps['shorebox1'];
                    if (!sb) return false;
                    const outPos = (sb._phase === 'pos') !== (sb._knob === 2);
                    return sb._inPowered() && sb.getKnob() !== 0 && outPos && sb.getBreakerOn();
                },
            },
            {
                msg: '4. 测试题：船电与岸电互锁，在接岸电前，主发电机和应急发电机要怎么设置？', mode: 'quiz',
                quizConfig: {
                    question: '在接入岸电之前，为避免船电与岸电非同期并列，主发电机和应急发电机应处于什么状态？',
                    options: [
                        '均切换为手动（或分闸）模式，防止其自动合闸投入电网',
                        '保持自动模式，让其自动跟踪母线电压并网',
                        '只停主发电机，应急发电机保持自动',
                        '不需要任何设置，岸电接入会自动处理',
                    ],
                    answer: 0,
                    analysis: '接入岸电前必须解除船电侧的自动合闸条件：主发电机与应急发电机均应置于手动（或已分闸）状态，使其不会在岸电投入时自动合闸，从而避免船电与岸电非同期并列造成短路、设备损坏等严重事故。',
                },
            },
            {
                msg: '5. 迅速切断船用发电机主开关（1# 主开关分闸/跳闸），再合上岸电主开关（岸电塑壳断路器），实现由岸电向汇流排供电。',
                mode: 'check',
                act() {
                    const sys = this.sys;
                    const q1 = sys && sys.comps['qf1'];
                    const pdb = sys && sys.comps['pdb1'];
                    if (q1 && q1.tryTrip) q1.tryTrip();
                    if (pdb && pdb.close) pdb.close();
                },
                check() {
                    const sys = this.sys;
                    const q1 = sys && sys.comps['qf1'];
                    const pdb = sys && sys.comps['pdb1'];
                    const qfOff = q1 && q1.getState && q1.getState() !== 'on';
                    const pdbOn = pdb && pdb.isClosed && pdb.isClosed();
                    return !!(qfOff && pdbOn);
                },
            },
            {
                msg: '6. 测试题：中线为何接船体柱？', mode: 'quiz',
                quizConfig: {
                    question: '船舶岸电系统中，岸电电源的中线（N）为什么要接到船体接线柱（船体/船壳）？',
                    options: [
                        '船舶电网中性点通过船体（海水）接地，岸电中线接船体柱可使岸电中性点与船体等电位，构成供电回路参考点，并为绝缘故障提供故障电流通路，保障人身与设备安全',
                        '只是为了方便固定导线，没有电气意义',
                        '为了防止岸电频率漂移',
                        '为了让岸电电压升高',
                    ],
                    answer: 0,
                    analysis: '船舶本身是一个以船体（海水）为接地极的浮动电网，其中性点通过船体接地。将岸电中线接至船体接线柱，可把岸电中性点与船体（船电中性点）连接为同一参考电位，既保证单相负载回路完整，又能在发生绝缘/接地故障时提供故障电流通路，保护人员与设备安全。',
                },
            },
        ],
    },
};"""

ce = s.count(old_end)
s = s.replace(old_end, new_end)

with open(p, "w", encoding="utf-8", newline="\n") as f:
    f.write(s)
print("remove-3live=%d, remove-N=%d, workflow-end=%d" % (ca, cb, ce))
print("DONE")
