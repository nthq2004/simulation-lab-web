// ═══════════════════════════════════════════════════════════════
// 8051 单片机 C 语言编程与调试（示范工程）
//
// 页 1「8051 与上位机」：
//   mcpc   上位机（Keil C51 编程计算机，双击打开集成开发环境）
//   mcu1   8051 单片机（AT89C51 / STC 类，12 MHz）
//   board  开关板（LCD1602 液晶 + 4×4 矩阵键盘）
//
// 演示程序：4×4 键盘输入 → LCD1602 显示的四则运算计算器
//   LCD：数据 P0.0~P0.7，RS=P2.0，E=P2.1
//   键盘：行 P1.0~P1.3，列 P1.4~P1.7
//
// 用法：双击上位机 → 编辑 C 源码 → 编译 → 下载 → 开始调试（单步/断点/运行）
// ═══════════════════════════════════════════════════════════════

import { MCS51 } from '../digital/MCS51.js';
import { MCS51PC } from '../components/MCS51PC.js';
import { MCS51KeypadBoard } from '../components/MCS51KeypadBoard.js';
import { compileC } from '../lib/C51Compiler.js';

// 7 种保留仪表（隐藏，满足平台约定）
import { Multimeter } from '../components/Multimeter.js';
import { MF47Multimeter } from '../components/MF47Multimeter.js';
import { Oscilloscope_tri } from '../components/Osc_tri.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';
import { ElecMeter } from '../components/ElecMeter.js';
import { RealMegohmMeter } from '../components/RealMegohmMeter.js';

const _sysOf = (ctx) => (ctx && ctx.sys) ? ctx.sys : (typeof window !== 'undefined' ? window.sys : null);

// 演示程序：LCD1602 + 4×4 矩阵键盘的四则运算计算器
const DEMO_C = `#include <reg51.h>

sbit RS = P2^0;
sbit E  = P2^1;

long cur;
long acc;
long g_result;
unsigned char op;
unsigned char lastK;
unsigned char fresh;

void delay(unsigned int t) { while (t--); }

void lcdCmd(unsigned char c) { P0 = c; RS = 0; E = 1; delay(2); E = 0; delay(2); }
void lcdData(unsigned char c) { P0 = c; RS = 1; E = 1; delay(2); E = 0; delay(2); }
void lcdInit() { lcdCmd(0x38); lcdCmd(0x0C); lcdCmd(0x06); lcdCmd(0x01); delay(100); }
void lcdGoto(unsigned char a) { lcdCmd(0x80 | a); }

void putLong(long v) {
    unsigned char buf[10];
    unsigned char n;
    if (v < 0) { lcdData('-'); v = -v; }
    n = 0;
    if (v == 0) { lcdData('0'); return; }
    while (v > 0) { buf[n] = '0' + (unsigned char)(v % 10); n = n + 1; v = v / 10; }
    while (n > 0) { n = n - 1; lcdData(buf[n]); }
}

unsigned char scanKey() {
    unsigned char rm[4];
    unsigned char r;
    unsigned char v;
    rm[0] = 0x0E; rm[1] = 0x0D; rm[2] = 0x0B; rm[3] = 0x07;
    for (r = 0; r < 4; r = r + 1) {
        P1 = 0xF0 | rm[r];
        delay(2);
        v = P1 & 0xF0;
        if ((v & 0x10) == 0) return r * 4 + 1;
        if ((v & 0x20) == 0) return r * 4 + 2;
        if ((v & 0x40) == 0) return r * 4 + 3;
        if ((v & 0x80) == 0) return r * 4 + 4;
    }
    return 0;
}

unsigned char keyOf(unsigned char k) {
    if (k == 1) return '7'; if (k == 2) return '8'; if (k == 3) return '9'; if (k == 4) return '+';
    if (k == 5) return '4'; if (k == 6) return '5'; if (k == 7) return '6'; if (k == 8) return '-';
    if (k == 9) return '1'; if (k == 10) return '2'; if (k == 11) return '3'; if (k == 12) return '*';
    if (k == 13) return '0'; if (k == 14) return '/'; if (k == 15) return '='; if (k == 16) return 'C';
    return 0;
}

void showCur() {
    lcdGoto(0x40);
    lcdData(' '); lcdData(' '); lcdData(' '); lcdData(' ');
    lcdGoto(0x40);
    putLong(cur);
}

void main() {
    unsigned char k, ch;
    lcdInit();
    lcdGoto(0x00);
    lcdData('8'); lcdData('0'); lcdData('5'); lcdData('1'); lcdData(' ');
    lcdData('C'); lcdData('a'); lcdData('l'); lcdData('c');
    cur = 0; acc = 0; op = 0; lastK = 0; g_result = 0; fresh = 1;
    while (1) {
        k = scanKey();
        if (k != 0 && k != lastK) {
            ch = keyOf(k);
            if (ch >= '0' && ch <= '9') { if (fresh) { cur = ch - '0'; fresh = 0; } else { cur = cur * 10 + (ch - '0'); } }
            else if (ch == 'C') { cur = 0; acc = 0; op = 0; fresh = 1; }
            else if (ch == '=') {
                if (op == 1) cur = acc + cur;
                else if (op == 2) cur = acc - cur;
                else if (op == 3) cur = acc * cur;
                else if (op == 4) { if (cur != 0) cur = acc / cur; }
                op = 0; acc = 0; fresh = 1; g_result = cur;
            } else {
                acc = cur; cur = 0; fresh = 1;
                if (ch == '+') op = 1; else if (ch == '-') op = 2; else if (ch == '*') op = 3; else op = 4;
            }
            showCur();
            delay(2000);
        }
        lastK = k;
    }
}
`;

export const FAULT_CONFIGS = {};

export const PROJECT_WORKFLOWS = {};

export const PROJECT_PAGES = [
    { id: 0, name: '索引', type: 'index' },
    {
        id: 1, name: '8051 与上位机',
        comps: ['mcpc', 'mcu1', 'board',
            'multimeter', 'mf47-panel', 'osc', 'sg', 'cali', 'elecmeter', 'megohm'],
        desc: '上位机（Keil C51）通过内置 C 子集编译器把 C 源码编译为 8051 机器码并下载到单片机；开关板含 LCD1602 液晶（数据 P0、RS=P2.0、E=P2.1）与 4×4 矩阵键盘（行 P1.0-3、列 P1.4-7）。演示程序为键盘输入的四则运算计算器。',
    },
];

export const componentConfigs = [
    // ── 页 1：上位机 / 单片机 / 开关板 ──
    { Class: MCS51PC, id: 'mcpc', x: 300, y: 150, page: 1, hostname: 'MCU-PC', label: '上位机 (Keil C51)', visible: true },
    { Class: MCS51, id: 'mcu1', x: 760, y: 130, page: 1, label: 'AT89C51', powerOn: true, xtalFreq: 12000000, visible: true },
    { Class: MCS51KeypadBoard, id: 'board', x: 1180, y: 210, page: 1, target: 'mcu1', title: '8051 开关板', visible: true },

    // ── 保留仪表（隐藏）──
    { Class: Multimeter, id: 'multimeter', x: 50, y: 50, page: 1, visible: false },
    { Class: MF47Multimeter, id: 'mf47-panel', x: 50, y: 50, page: 1, visible: false },
    { Class: Oscilloscope_tri, id: 'osc', x: 50, y: 50, page: 1, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 50, y: 50, page: 1, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 50, y: 50, page: 1, visible: false },
    { Class: ElecMeter, id: 'elecmeter', x: 50, y: 50, page: 1, visible: false },
    { Class: RealMegohmMeter, id: 'megohm', x: 50, y: 50, page: 1, visible: false },
];

export function initSlider(sys) {
    if (!sys) return;
    sys._noBlinkHighlight = true;
    sys.pageIndexTitle = '8051 单片机 C 语言编程与调试 · 页面索引';
    _loadDemo(sys);       // 打开工程即下载默认演示程序（P1 计数闪灯）
}

/** 把默认演示程序编译并下载到 mcu1（打开即见 P1 计数闪灯） */
function _loadDemo(sys) {
    const solver = sys.mcs51Solver;
    const mcu = sys.comps && sys.comps['mcu1'];
    if (!solver || !mcu) return;
    const r = compileC(DEMO_C);
    if (r.ok) {
        solver.downloadProgram('mcu1', r.bytes,
            { lineMap: r.lineMap, lineAddrs: r.lineAddrs, symbols: r.symbols },
            { pause: false });
        if (mcu) mcu._cSource = DEMO_C;
    }
}

export function applyAllPresets() {
    const sys = _sysOf(this);
    if (!sys) return;
    sys._noBlinkHighlight = true;
    _loadDemo(sys);
    sys.redrawAll && sys.redrawAll();
}

export async function applyStartSystem() {
    const sys = _sysOf(this);
    if (!sys) return;
    const solver = sys.mcs51Solver;
    if (solver) { try { solver.resetMCU('mcu1'); } catch (e) { /* ignore */ } }
    _loadDemo(sys);
    sys.redrawAll && sys.redrawAll();
}

export function fiveStep() {
    const sys = _sysOf(this);
    if (!sys) return;
    const solver = sys.mcs51Solver;
    if (!solver) return;
    const vals = [0x01, 0x02, 0x04, 0x08, 0x10];
    if (sys._mcs51Step === undefined || sys._mcs51Step >= vals.length) sys._mcs51Step = 0;
    solver.setMemory('mcu1', 0x90 /* P1 */, vals[sys._mcs51Step]);
    sys._mcs51Step = (sys._mcs51Step + 1) % vals.length;
    sys.redrawAll && sys.redrawAll();
}
