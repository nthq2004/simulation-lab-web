# -*- coding: utf-8 -*-
import os

base = r"E:\BaiduSyncdisk\03 教学材料\仿真软件制作\网站\lab_07\sys17-aboard"

# ─────────────────────────────────────────────
# 1) ShorePowerBox.js
# ─────────────────────────────────────────────
p1 = os.path.join(base, "components", "ShorePowerBox.js")
s1 = open(p1, encoding="utf-8").read()

# LCD：空格分隔 -> 逗号分隔（一行，字号保持 16）
c1 = s1.count("'---V ---Hz'")
s1 = s1.replace("'---V ---Hz'", "'---V,---Hz'")
c2 = s1.count("}V ${this._freq}Hz")
s1 = s1.replace("}V ${this._freq}Hz", "}V,${this._freq}Hz")

# 在 _bindInteraction 末尾追加两个部件识别热区（addClickablePart，须在透明整板之后以保持置顶）
old_block = """        btnHit(0, () => this.tryCloseBreaker(), 'btn-close');
        btnHit(1, () => this.tryOpenBreaker(), 'btn-open');
    }

    // ═══════════════════════════════
    // tick"""
new_block = """        btnHit(0, () => this.tryCloseBreaker(), 'btn-close');
        btnHit(1, () => this.tryOpenBreaker(), 'btn-open');

        // ── 部件识别热区（供工作流“识别”步骤使用，须置于透明整板之后以置顶）──
        // 相序指示灯（左面板三圆灯区域）
        this.addClickablePart('phase-lamps', 6, 74, 152, 46);
        // 空气开关（右原理区刀片式断路器及输出端子区域）
        this.addClickablePart('breaker', 198, 215, 84, 103);
    }

    // ═══════════════════════════════
    // tick"""
c3 = s1.count(old_block)
s1 = s1.replace(old_block, new_block)

with open(p1, "w", encoding="utf-8", newline="\n") as f:
    f.write(s1)
print(
    "ShorePowerBox.js: comaa-replace=%d, freq-replace=%d, part-block=%d" % (c1, c2, c3)
)

# ─────────────────────────────────────────────
# 2) sys_ljdq5-4.js  — 新增工作流程
# ─────────────────────────────────────────────
p2 = os.path.join(base, "project", "sys_ljdq5-4.js")
s2 = open(p2, encoding="utf-8").read()

old_wf = "export const PROJECT_WORKFLOWS = {\n\n};"
new_wf = """export const PROJECT_WORKFLOWS = {
    // ── 流程：船舶岸电接入系统认识 ──
    'shore-power-intro': {
        id: 'shore-power-intro',
        name: '1. 船舶岸电接入系统认识',
        steps: [
            {
                msg: '1. 请点击识别岸电箱面板上的「相序指示灯」（电源 / 正序 / 负序 三盏灯）',
                mode: 'find', target: 'shorebox1', subTarget: 'phase-lamps',
            },
            {
                msg: '2. 请点击识别岸电箱内的「空气开关」（刀片式断路器及输出端子）',
                mode: 'find', target: 'shorebox1', subTarget: 'breaker',
            },
            {
                msg: '3. 请点击识别「负序继电器」',
                mode: 'find', target: 'neg1',
            },
            {
                msg: '4. 请点击识别「岸电主开关」',
                mode: 'find', target: 'pdb1',
            },
            {
                msg: '5. 测试题：如何确保岸电和船电不同时供电？', mode: 'quiz',
                quizConfig: {
                    question: '船舶靠港接用岸电时，如何确保岸电（岸电电源）与船电（船舶发电机）不会同时向电网供电？',
                    options: [
                        '采用电气联锁：岸电主开关合闸后自动切断船电主开关的失压脱扣线圈电源，使其无法合闸；反之亦然，二者只能有一台合闸',
                        '完全依靠值班人员手动操作，不需要任何联锁保护',
                        '为提高供电可靠性，岸电与船电可同时合闸供电',
                        '岸电与船电是否同时供电没有影响，可以随意操作',
                    ],
                    answer: 0,
                    analysis: '岸电与船电互为备用电源，必须通过电气联锁保证二者不能同时合闸，否则会造成非同期并列、短路等严重事故。岸电主开关合闸时其常闭辅助触头断开，切断船电主开关失压脱扣线圈回路，使船电主开关不能合闸；船电主开关合闸时同样联锁岸电主开关。',
                },
            },
            {
                msg: '6. 测试题：负序继电器的作用', mode: 'quiz',
                quizConfig: {
                    question: '在船舶岸电接入系统中，负序继电器的主要作用是什么？',
                    options: [
                        '检测岸电相序，当相序为负序（错相）时其常闭触点断开，切断岸电主开关控制回路，防止错相供电损坏设备',
                        '检测岸电电压高低，电压过低时发出报警',
                        '检测岸电频率，频率偏离 50Hz 时使主开关跳闸',
                        '测量岸电电流大小并显示在面板上',
                    ],
                    answer: 0,
                    analysis: '负序继电器用于监视岸电的相序。当岸电相序正确（正序）时其常闭触点闭合，允许岸电主开关合闸；当相序接反（负序）时触点断开，阻止岸电接入，避免因相序错误导致船舶电动机反转等事故。',
                },
            },
        ],
    },
};"""
c4 = s2.count(old_wf)
s2 = s2.replace(old_wf, new_wf)

with open(p2, "w", encoding="utf-8", newline="\n") as f:
    f.write(s2)
print("sys_ljdq5-4.js: workflow-block=%d" % c4)

# ─────────────────────────────────────────────
# 3) Workflow.js  — 为部件演示提示补充中文名
# ─────────────────────────────────────────────
p3 = os.path.join(base, "tools", "Workflow.js")
s3 = open(p3, encoding="utf-8").read()
old_pn = """            var partNames = {
                'pos-plate': '正极板（PbO₂）', 'neg-plate': '负极板（Pb）', 'separator': '隔板',
                'rectifier': '整流模块', 'inverter': '逆变模块', 'battery': '储能模块（蓄电池组）', 'staticSwitch': '静态开关',
            };"""
new_pn = """            var partNames = {
                'pos-plate': '正极板（PbO₂）', 'neg-plate': '负极板（Pb）', 'separator': '隔板',
                'rectifier': '整流模块', 'inverter': '逆变模块', 'battery': '储能模块（蓄电池组）', 'staticSwitch': '静态开关',
                'phase-lamps': '相序指示灯', 'breaker': '空气开关（断路器）',
            };"""
c5 = s3.count(old_pn)
s3 = s3.replace(old_pn, new_pn)
with open(p3, "w", encoding="utf-8", newline="\n") as f:
    f.write(s3)
print("Workflow.js: partNames-block=%d" % c5)

print("DONE")
