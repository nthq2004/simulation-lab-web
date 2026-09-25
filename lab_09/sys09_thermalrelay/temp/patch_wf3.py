# -*- coding: utf-8 -*-
import os

base = r"E:\BaiduSyncdisk\03 教学材料\仿真软件制作\网站\lab_07\sys17-aboard"
p = os.path.join(base, "project", "sys_ljdq5-4.js")
s = open(p, encoding="utf-8").read()

old_end = "    },\n};"  # PROJECT_WORKFLOWS 末尾（流程二收尾 + 对象收尾）

new_end = """    },

    // ── 流程三：岸电切换为船电供电 ──
    'shore-to-ship-switch': {
        id: 'shore-to-ship-switch',
        name: '3. 岸电切换为船电供电',
        steps: [
            {
                msg: '1. 自动接线并接通岸电：将岸电电源 U/V/W 接岸电箱 in1/in2/in3，岸电电源 N 接岸电箱 N（船体接线柱），并合上岸电电源（开启岸电输入电源）。',
                mode: 'check',
                act() {
                    const sys = this.sys;
                    if (!sys) return;
                    _autoWire(sys);
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
                msg: '2. 转换相序开关（相序1/相序2），确认输出为正相序后，合上岸电箱内的空气开关（断路器）。',
                mode: 'check',
                act() {
                    const sys = this.sys;
                    const sb = sys && sys.comps['shorebox1'];
                    if (!sb) return;
                    sb._knob = 1;
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
                msg: '3. 合上岸电主开关（岸电塑壳断路器），由岸电向汇流排供电。',
                mode: 'check',
                act() {
                    const sys = this.sys;
                    const pdb = sys && sys.comps['pdb1'];
                    if (pdb && pdb.close) pdb.close();
                },
                check() {
                    const sys = this.sys;
                    const pdb = sys && sys.comps['pdb1'];
                    return !!(pdb && pdb.isClosed && pdb.isClosed());
                },
            },
            {
                msg: '4. 起动船舶主发电机（1# 同步发电机运行），再尝试合上船电主开关——因岸电互锁，合闸应失败。',
                mode: 'check',
                act() {
                    const sys = this.sys;
                    const g1 = sys && sys.comps['gen1'];
                    const q1 = sys && sys.comps['qf1'];
                    if (g1) { g1.freq = 50; g1.isOn = true; }
                    if (q1) {
                        q1._chargeProg = 5; q1._charged = true;
                        if (q1.tryClose) q1.tryClose();   // 受岸电互锁，应无法保持合闸
                    }
                },
                check() {
                    const sys = this.sys;
                    const g1 = sys && sys.comps['gen1'];
                    const q1 = sys && sys.comps['qf1'];
                    const genOn = g1 && g1.isOn;
                    const qfNotClosed = q1 && q1.getState && q1.getState() !== 'on';
                    return !!(genOn && qfNotClosed);
                },
            },
            {
                msg: '5. 测试题：岸电供电时，船舶主发电机合闸失败的原因。', mode: 'quiz',
                quizConfig: {
                    question: '在岸电供电期间，试图合上船舶主发电机主开关却失败，其主要原因是什么？',
                    options: [
                        '岸电主开关合闸后其常闭辅助触头断开，切断了船电主开关的失压脱扣线圈电源，使船电主开关失压脱扣而无法合闸（电气联锁保证只能一台供电）',
                        '船舶主发电机没有起动，所以当然合不上',
                        '岸电电压太低，导致船电主开关拒动',
                        '汇流排上没有电，所以合不上',
                    ],
                    answer: 0,
                    analysis: '系统设有船电/岸电电气联锁：岸电主开关合闸到位后，其常闭辅助触头断开，切断船电主开关失压脱扣线圈的供电，使船电主开关因失压脱扣而合不上（或合上后随即跳闸），从而保证岸电与船电不会同时向电网供电。',
                },
            },
            {
                msg: '6. 切断岸电（分闸岸电主开关），再合上船舶发电机主开关，恢复由船电向汇流排供电。',
                mode: 'check',
                act() {
                    const sys = this.sys;
                    const q1 = sys && sys.comps['qf1'];
                    const pdb = sys && sys.comps['pdb1'];
                    if (pdb && pdb.open) pdb.open();      // 切断岸电
                    if (q1) {
                        q1._chargeProg = 5; q1._charged = true;
                        if (q1.tryClose) q1.tryClose();   // 岸电已断，联锁解除，可合闸
                    }
                },
                check() {
                    const sys = this.sys;
                    const q1 = sys && sys.comps['qf1'];
                    const pdb = sys && sys.comps['pdb1'];
                    const shoreOff = pdb && pdb.isClosed && !pdb.isClosed();
                    const qfOn = q1 && q1.getState && q1.getState() === 'on';
                    return !!(shoreOff && qfOn);
                },
            },
        ],
    },
};"""

ce = s.count(old_end)
s = s.replace(old_end, new_end)

with open(p, "w", encoding="utf-8", newline="\n") as f:
    f.write(s)
print("workflow-end=%d" % ce)
print("DONE")
