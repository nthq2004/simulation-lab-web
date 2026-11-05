/**
 * levelPage.js — 液位双位控制系统页面构建与刷新
 */

import { W, BODY_H, C } from './constants.js';
import { mkBtn } from './utils.js';
import { CANId, CAN_FUNC } from '../CANBUS.js';

export function buildLevelPage(cc) {
    const pg = cc._pages[7];
    const pw = W - 8, ph = BODY_H;
    pg.add(new Konva.Rect({ width: pw, height: ph, fill: C.panel, cornerRadius: 3 }));
    pg.add(new Konva.Text({ x: 8, y: 6, text: '■ 液位双位控制系统', fontSize: 13, fontFamily: 'Courier New', fontStyle: 'bold', fill: C.cyan }));

    const tkX = 150, tkY = 26, tkW = 100, tkH = 210;
    pg.add(new Konva.Rect({ x: tkX, y: tkY, width: tkW, height: tkH, fill: '#eeeff1', stroke: C.cyan + '66', strokeWidth: 2, cornerRadius: 4 }));

    cc._lvFill = new Konva.Rect({ x: tkX + 2, y: tkY + tkH - 2, width: tkW - 4, height: 0, fill: C.cyan + '77', cornerRadius: [0, 0, 3, 3] });
    pg.add(cc._lvFill);

    // 刻度线 - 使用 cc._lvScaleLines 存储以便动态更新
    cc._lvScaleLines = {};
    [{ l: 'HH', p: 0.80, c: C.red, key: 'HH' }, { l: 'H', p: 0.70, c: C.yellow, key: 'H' },
     { l: 'L', p: 0.30, c: C.yellow, key: 'L' }, { l: 'LL', p: 0.20, c: C.red, key: 'LL' }].forEach(s => {
        const ly = tkY + tkH * (1 - s.p);
        const line = new Konva.Line({ points: [tkX - 6, ly, tkX + tkW + 6, ly], stroke: s.c, strokeWidth: 1, dash: [4, 3] });
        const label = new Konva.Text({ x: tkX + tkW + 8, y: ly - 5, text: s.l, fontSize: 8, fontFamily: 'Courier New', fill: s.c });
        pg.add(line, label);
        cc._lvScaleLines[s.key] = { line, label };
    });

    cc._lvText = new Konva.Text({ x: tkX, y: tkY + tkH + 6, width: tkW, text: '45.0%', fontSize: 13, fontFamily: 'Courier New', fontStyle: 'bold', fill: C.cyan, align: 'center' });
    pg.add(cc._lvText);

    // 管道
    pg.add(new Konva.Rect({ x: tkX - 36, y: tkY + 18, width: 36, height: 12, fill: '#eaf0f5', stroke: C.blue + '66', strokeWidth: 1 }));
    cc._inletFlowBar = new Konva.Rect({ x: tkX - 34, y: tkY + 20, width: 0, height: 8, fill: C.blue + '88' });
    pg.add(cc._inletFlowBar);
    pg.add(new Konva.Text({ x: tkX - 30, y: tkY + 8, text: '进水', fontSize: 9, fontFamily: 'Courier New', fill: C.blue }));

    pg.add(new Konva.Rect({ x: tkX + tkW, y: tkY + tkH - 36, width: 36, height: 12, fill: '#f4f5f7', stroke: C.orange + '66', strokeWidth: 1 }));
    cc._drainFlowBar = new Konva.Rect({ x: tkX + tkW + 2, y: tkY + tkH - 34, width: 35, height: 8, fill: C.orange + '88' });
    pg.add(cc._drainFlowBar);
    pg.add(new Konva.Text({ x: tkX + tkW + 6, y: tkY + tkH - 18, text: '排水', fontSize: 9, fontFamily: 'Courier New', fill: C.orange }));

    // 右侧控制面板
    const cx = 350;
    pg.add(new Konva.Text({ x: cx, y: 12, text: '■ 控制参数', fontSize: 13, fontFamily: 'Courier New', fontStyle: 'bold', fill: C.cyan }));

    // 液位参数编辑（点击可修改）
    cc._lvParamTexts = {};
    cc._lvParamBtns = {};
    [{ label: 'HH报警', key: 'setHH', color: C.red }, { label: 'H  上限', key: 'setH', color: C.yellow },
     { label: 'L  下限', key: 'setL', color: C.yellow }, { label: 'LL报警', key: 'setLL', color: C.red }].forEach((p, i) => {
        const py = 32 + i * 22;
        pg.add(new Konva.Text({ x: cx, y: py, text: p.label + ' :', fontSize: 12, fontFamily: 'Courier New', fill: p.color }));
        const vt = new Konva.Text({ x: cx + 80, y: py, text: `${cc.levelCtrl[p.key]}%`, fontSize: 12, fontFamily: 'Courier New', fill: C.text });
        const btn = mkBtn(pg, '编辑', cx + 130, py-4 , C.textDim);
        pg.add(vt);
        cc._lvParamTexts[p.key] = vt;
        cc._lvParamBtns[p.key] = btn;
    });

    // 通道选择区
    pg.add(new Konva.Text({ x: cx, y: 130, text: '■ 通道选择', fontSize: 13, fontFamily: 'Courier New', fontStyle: 'bold', fill: C.cyan }));
    pg.add(new Konva.Text({ x: cx, y: 152, text: '输入通道(AI):', fontSize: 12, fontFamily: 'Courier New', fill: C.text }));
    cc._inputChBtn1 = mkBtn(pg, 'CH1', cx + 100, 145, cc.levelCtrl.inputChannel === 'ch1' ? C.cyan : C.textDim);
    cc._inputChBtn2 = mkBtn(pg, 'CH2', cx + 160, 145, cc.levelCtrl.inputChannel === 'ch2' ? C.cyan : C.textDim);

    pg.add(new Konva.Text({ x: cx, y: 175, text: '输出通道(DO):', fontSize: 12, fontFamily: 'Courier New', fill: C.text }));
    cc._outputChBtn1 = mkBtn(pg, 'CH1', cx + 100, 171, cc.levelCtrl.outputChannel === 'ch1' ? C.cyan : C.textDim);
    cc._outputChBtn2 = mkBtn(pg, 'CH2', cx + 160, 171, cc.levelCtrl.outputChannel === 'ch2' ? C.cyan : C.textDim);

    pg.add(new Konva.Text({ x: cx, y: 208, text: '■ 执行机构', fontSize: 13, fontFamily: 'Courier New', fontStyle: 'bold', fill: C.cyan }));
    cc._pumpText = new Konva.Text({ x: cx, y: 230, text: '进水泵:  OFF ○', fontSize: 12, fontFamily: 'Courier New', fill: C.textDim });
    cc._lvAlarmText = new Konva.Text({ x: cx, y: 258, text: '● 液位正常', fontSize: 12, fontFamily: 'Courier New', fill: C.green });
    pg.add(cc._pumpText, cc._lvAlarmText);

    // 仿真控制
    cc._simBtn = mkBtn(pg, '控 制:自动', tkX-110, tkY+20, C.cyan);
    cc._startBtn = mkBtn(pg, '进水泵:起动', tkX-110, tkY+60, C.blue);
    cc._stopBtn = mkBtn(pg, '进水泵:停止', tkX-110, tkY+100, C.orange);

    // 液位趋势
    const trX = 50, trY = 280, trW = 570, trH = 150;
    pg.add(new Konva.Rect({ x: trX, y: trY, width: trW, height: trH, fill: C.bg, stroke: C.border, strokeWidth: 1, cornerRadius: 2 }));
    pg.add(new Konva.Text({ x: trX + 3, y: trY + 2, text: '液位趋势图', fontSize: 10, fontFamily: 'Courier New', fill: C.textDim }));
    cc._lvTrendLine = new Konva.Line({ stroke: C.cyan, strokeWidth: 1.5 });
    pg.add(cc._lvTrendLine);
    cc._lvTrendMeta = { x: trX, y: trY, w: trW, h: trH };

    // 绑定事件处理
    initLevelPageEvents(cc);
}

/**
 * 初始化液位页面的事件处理
 */
// ── 每 tick 刷新 ──────────────────────────────
export function renderLevelPage(cc) {
    const lc = cc.levelCtrl;
    const tkX = 150, tkY = 26, tkW = 100, tkH = 210;

    const fillH = Math.round(tkH * lc.level / 100);
    cc._lvFill.y(tkY + tkH - fillH - 2);
    cc._lvFill.height(fillH);
    let fc = C.cyan + '77';
    if (lc.level >= lc.setHH || lc.level <= lc.setLL) fc = C.red + '99';
    else if (lc.level >= lc.setH || lc.level <= lc.setL) fc = C.yellow + '88';
    cc._lvFill.fill(fc);
    cc._lvText.text(`${lc.level.toFixed(1)}%`);

    const params = [
        { key: 'HH', percent: lc.setHH / 100 },
        { key: 'H', percent: lc.setH / 100 },
        { key: 'L', percent: lc.setL / 100 },
        { key: 'LL', percent: lc.setLL / 100 }
    ];
    params.forEach(p => {
        const ly = tkY + tkH * (1 - p.percent);
        if (cc._lvScaleLines[p.key]) {
            cc._lvScaleLines[p.key].line.points([tkX - 6, ly, tkX + tkW + 6, ly]);
            cc._lvScaleLines[p.key].label.y(ly - 5);
        }
    });

    cc._inletFlowBar.width(lc.inletOn ? 32 : 0);
    cc._drainFlowBar.width(32);

    cc._pumpText.text(`进水泵:  ${lc.inletOn ? 'ON ●' : 'OFF ○'}`);
    cc._pumpText.fill(lc.inletOn ? C.blue : C.textDim);

    if (lc.level >= lc.setHH) { cc._lvAlarmText.text('⚠ HH 高高液位报警'); cc._lvAlarmText.fill(C.red); }
    else if (lc.level <= lc.setLL) { cc._lvAlarmText.text('⚠ LL 低低液位报警'); cc._lvAlarmText.fill(C.red); }
    else if (lc.level >= lc.setH) { cc._lvAlarmText.text('△ H  高液位'); cc._lvAlarmText.fill(C.yellow); }
    else if (lc.level <= lc.setL) { cc._lvAlarmText.text('△ L  低液位'); cc._lvAlarmText.fill(C.yellow); }
    else { cc._lvAlarmText.text('● 液位正常'); cc._lvAlarmText.fill(C.green); }

    const isAuto = lc.simMode === 'AUTO';
    cc._simBtn.findOne('Rect').fill(isAuto ? C.cyan + '33' : C.textDim + '22');
    cc._simBtn.findOne('Rect').stroke(isAuto ? C.cyan : C.textDim);
    cc._simBtn.findOne('Text').text(isAuto ? '控制:自动' : '控制:手动');
    cc._simBtn.findOne('Text').fill(isAuto ? C.cyan : C.textDim);

    const p = cc.levelCtrl.inletOn;
    cc._startBtn.findOne('Rect').fill(p ? C.blue + '33' : C.textDim + '22');
    cc._startBtn.findOne('Rect').stroke(p ? C.blue : C.textDim);
    cc._startBtn.findOne('Text').fill(p ? C.blue : C.textDim);

    const s = !p;
    cc._stopBtn.findOne('Rect').fill(s ? C.orange + '33' : C.textDim + '22');
    cc._stopBtn.findOne('Rect').stroke(s ? C.orange : C.textDim);
    cc._stopBtn.findOne('Text').fill(s ? C.orange : C.textDim);

    cc._inputChBtn1.findOne('Rect').fill(lc.inputChannel === 'ch1' ? C.cyan + '33' : C.textDim + '22');
    cc._inputChBtn1.findOne('Rect').stroke(lc.inputChannel === 'ch1' ? C.cyan : C.textDim);
    cc._inputChBtn1.findOne('Text').fill(lc.inputChannel === 'ch1' ? C.cyan : C.textDim);

    cc._inputChBtn2.findOne('Rect').fill(lc.inputChannel === 'ch2' ? C.cyan + '33' : C.textDim + '22');
    cc._inputChBtn2.findOne('Rect').stroke(lc.inputChannel === 'ch2' ? C.cyan : C.textDim);
    cc._inputChBtn2.findOne('Text').fill(lc.inputChannel === 'ch2' ? C.cyan : C.textDim);

    cc._outputChBtn1.findOne('Rect').fill(lc.outputChannel === 'ch1' ? C.cyan + '33' : C.textDim + '22');
    cc._outputChBtn1.findOne('Rect').stroke(lc.outputChannel === 'ch1' ? C.cyan : C.textDim);
    cc._outputChBtn1.findOne('Text').fill(lc.outputChannel === 'ch1' ? C.cyan : C.textDim);

    cc._outputChBtn2.findOne('Rect').fill(lc.outputChannel === 'ch2' ? C.cyan + '33' : C.textDim + '22');
    cc._outputChBtn2.findOne('Rect').stroke(lc.outputChannel === 'ch2' ? C.cyan : C.textDim);
    cc._outputChBtn2.findOne('Text').fill(lc.outputChannel === 'ch2' ? C.cyan : C.textDim);

    ['setHH', 'setH', 'setL', 'setLL'].forEach(key => {
        if (cc._lvParamTexts[key]) {
            cc._lvParamTexts[key].text(`${lc[key]}%`);
        }
    });

    if (cc._levelTrendHistory.length > 1) {
        const m = cc._lvTrendMeta, pts = [];
        cc._levelTrendHistory.forEach((v, i) => {
            pts.push(m.x + i * (m.w / 350), m.y + m.h - (v / 100) * m.h);
        });
        cc._lvTrendLine.points(pts);
    }
}

function initLevelPageEvents(cc) {
    // 参数编辑按钮
    ['setHH', 'setH', 'setL', 'setLL'].forEach(key => {
        if (cc._lvParamBtns[key]) {
            cc._lvParamBtns[key].on('click tap', () => {
                const newVal = prompt(`请输入 ${key} 的值 (0-100):`, `${cc.levelCtrl[key]}`);
                if (newVal !== null && !isNaN(newVal)) {
                    const val = Math.max(0, Math.min(100, parseInt(newVal)));
                    cc.levelCtrl[key] = val;
                }
            });
        }
    });

    // 输入通道选择 (AI ch1/ch2)
    if (cc._inputChBtn1) {
        cc._inputChBtn1.on('click tap', () => {
            cc.levelCtrl.inputChannel = 'ch1';
        });
    }
    if (cc._inputChBtn2) {
        cc._inputChBtn2.on('click tap', () => {
            cc.levelCtrl.inputChannel = 'ch2';
        });
    }

    // 输出通道选择 (DO ch1/ch2)
    if (cc._outputChBtn1) {
        cc._outputChBtn1.on('click tap', () => {
            cc.levelCtrl.outputChannel = 'ch1';
        });
    }
    if (cc._outputChBtn2) {
        cc._outputChBtn2.on('click tap', () => {
            cc.levelCtrl.outputChannel = 'ch2';
        });
    }

    // 模式切换 (自动/手动)
    // ⚠ 本按钮**只**切换液位控制系统自身的控制模式（HAND / AUTO），
    //   绝不去改动 DO 通道的模式 —— 通道模式属于「DO 设置」页的职责：
    //     · DO 通道 = auto → 该通道受外部输入信号（液位等）控制
    //     · DO 通道 = hand → 在「DO 设置」页用该通道的手动按钮直接控制 ON/OFF
    //   只要液位控制系统使用了 DO ch1，ch1 就应保持 auto；否则 ch1 在手动模式下，
    //   液位系统无论自身处于手动还是自动，都无法控制 ch1 的输出。
    if (cc._simBtn) {
        cc._simBtn.on('click tap', () => {
            const isAuto = cc.levelCtrl.simMode === 'AUTO';
            cc.levelCtrl.simMode = isAuto ? 'HAND' : 'AUTO';
            cc.levelCtrl.isManualMode = isAuto;

            if (cc.sys && typeof cc.sys.requestRedraw === 'function') cc.sys.requestRedraw();
        });
    }

    // 启动按钮 (进水泵)
    if (cc._startBtn) {
        cc._startBtn.on('click tap', () => {
            if (cc.levelCtrl.isManualMode || cc.levelCtrl.simMode === 'HAND') {
                cc.levelCtrl.inletOn = true;
            }
        });
    }

    // 停止按钮 (进水泵)
    if (cc._stopBtn) {
        cc._stopBtn.on('click tap', () => {
            if (cc.levelCtrl.isManualMode || cc.levelCtrl.simMode === 'HAND') {
                cc.levelCtrl.inletOn = false;
            }
        });
    }
}

// ── 液位仿真（每 tick 由主循环调用）─────────────
export function simLevel(cc) {
    const lc = cc.levelCtrl;
    if (!lc.simMode) return;

    const inputCh = lc.inputChannel;
    lc.level = cc.data.ai[inputCh].value;

    const outputCh = lc.outputChannel;

    if (lc.simMode === 'AUTO') {
        if (lc.level <= lc.setL) lc.inletOn = true;
        if (lc.level >= lc.setH) lc.inletOn = false;
    } else if (lc.isManualMode) {
    }

    // ── 液位系统能否驱动该 DO 通道，取决于通道自身的模式 ──
    //   DO 通道 = auto → 受外部（液位）信号控制，液位系统写入并驱动输出
    //   DO 通道 = hand → 液位系统一律不得写入，该通道只能在「DO 设置」页
    //                     用该通道的手动按钮控制 ON/OFF
    // 此前这里无条件写 state，导致：① 液位系统无论手动/自动都能控制 ch1；
    // ② 每 100ms 的写入把 DO 设置页手动设置的值覆盖掉，表现为"手动按钮无效"。
    const doMod = cc.sys?.comps?.['do'];
    const chIsAuto = !!(doMod && doMod.channels && doMod.channels[outputCh]
        && doMod.channels[outputCh].mode === 'auto');

    if (chIsAuto) {
        cc.data.do[outputCh].state = lc.inletOn;
        cc.doManual[outputCh] = true;
        cc.doManualState[outputCh] = lc.inletOn;
    } else {
        // DO 通道处于手动模式：液位系统交出该通道的控制权。
        // 若不清理 doManual 标志，auto 阶段留下的 doManual/doManualState
        // 仍会被当作 CC 侧控制权持续下发，压过「DO 设置」页手动按钮的设定值，
        // 表现为"DO 设置页手动操作无效"。
        if (cc.doManual[outputCh]) cc.doManual[outputCh] = false;
    }
    // ch1 处于 hand 模式时不写入：控制权归「DO 设置」页的手动按钮

    cc._levelTrendHistory.push(lc.level);
    if (cc._levelTrendHistory.length > 350) cc._levelTrendHistory.shift();
}
