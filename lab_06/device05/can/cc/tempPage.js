/**
 * tempPage.js — 温度控制系统页面构建与刷新
 */

import { W, BODY_H, C } from './constants.js';
import { mkBtn, mkToggle } from './utils.js';
import { CANId, CAN_FUNC } from '../CANBUS.js';

export function buildTempPage(cc) {
    const pg = cc._pages[8];
    const pw = W - 8, ph = BODY_H;
    pg.add(new Konva.Rect({ width: pw, height: ph, fill: C.panel, cornerRadius: 3 }));
    pg.add(new Konva.Text({ x: 8, y: 6, text: '■ 温度控制系统', fontSize: 13, fontFamily: 'Courier New', fontStyle: 'bold', fill: C.red }));

    // ── 左侧控制面板 ──
    const lx = 28, ly = 24, lh = 120;

    // 蒸汽阀控制模式按钮
    cc._steamModeBtn = mkToggle(pg, '模式:自动', lx + 8, ly + 8, 84, 22, false, C.green);

    // 手动增大按钮
    cc._steamIncBtn = mkBtn(pg, '增 大  +', lx + 20, ly + 38, C.blue);

    // 手动减少按钮
    cc._steamDecBtn = mkBtn(pg, '减 少  -', lx + 20, ly + 68, C.orange);

    // ── 中间显示区 ──
    const mx = 165, my = 24;

    // 温度计
    const thX = mx, thY = my, thW = 40, thH = 200;
    pg.add(new Konva.Rect({ x: thX, y: thY, width: thW, height: thH, fill: '#0a0808', stroke: C.red + '55', strokeWidth: 1, cornerRadius: 4 }));
    cc._thermFill = new Konva.Rect({ x: thX + 3, y: thY + thH - 3, width: thW - 6, height: 0, fill: C.red + '99', cornerRadius: [0, 0, 2, 2] });
    pg.add(cc._thermFill);

    // 温度刻度
    for (let t = 0; t <= 200; t += 40) {
        const gy = thY + thH - 2 - (t / 200) * (thH - 4);
        pg.add(new Konva.Line({ points: [thX - 4, gy, thX, gy], stroke: C.textDim, strokeWidth: 1 }));
        pg.add(new Konva.Text({ x: thX - 28, y: gy - 4, text: `${t}°`, fontSize: 9, fontFamily: 'Courier New', fill: C.textDim }));
    }
    cc._tempValueLabel = new Konva.Text({ x: thX, y: thY + thH + 5, width: thW, text: '25°C', fontSize: 12, fontFamily: 'Courier New', fill: C.red, align: 'center', fontStyle: 'bold' });
    pg.add(cc._tempValueLabel);

    // 蒸汽阀开度显示
    cc._valveOpenLabel = new Konva.Text({ x: mx - 120, y: my + 100, text: '阀开: 0%', fontSize: 14, fontFamily: 'Courier New', fill: C.green, fontStyle: 'bold' });
    pg.add(cc._valveOpenLabel);

    // ── 右侧控制参数 ──
    const cx = 280;
    pg.add(new Konva.Text({ x: cx, y: 12, text: '■ 控制参数', fontSize: 13, fontFamily: 'Courier New', fontStyle: 'bold', fill: C.cyan }));

    // PID 参数显示和编辑
    cc._pidParams = {};
    [
        { label: '设定值 SV', key: 'sv', unit: '°C', color: C.green, editable: true },
        { label: '测量值 PV', key: 'pv', unit: '°C', color: C.red, editable: false },
    ].forEach((p, i) => {
        const py = 32 + i * 20;
        pg.add(new Konva.Text({ x: cx, y: py, text: p.label + ' :', fontSize: 12, fontFamily: 'Courier New', fill: p.color }));
        const vt = new Konva.Text({ x: cx + 100, y: py, text: '---', fontSize: 12, fontFamily: 'Courier New', fontStyle: 'bold', fill: p.color });
        pg.add(vt);
        cc._pidParams[p.key] = vt;

        // 可编辑参数点击弹出修改框
        if (p.editable && vt) {
            vt.on('click tap', () => {
                const cur = cc.tempCtrl[p.key] ?? 0;
                const input = prompt(`修改 ${p.label}（当前 ${cur}${p.unit}）:`, String(cur));
                if (input === null) return;
                const num = parseFloat(input);
                if (isNaN(num)) return alert('请输入有效数字');
                cc.tempCtrl[p.key] = num;
                vt.text(`${num}${p.unit}`);
                // 同步发送到 CAN 总线（PID 参数设置命令）
                try {
                    const bus = cc.sys?.canBus;
                    if (bus && cc.busConnected && !cc.commFault) {
                        bus.send({
                            id: CANId.encode(CAN_FUNC.AO_CMD, 2),
                            extended: false, rtr: false, dlc: 8,
                            data: [0x17, p.key === 'sv' ? 0 : 0, 0, 0, 0, 0, 0, 0],
                            sender: cc.id, timestamp: Date.now(),
                        });
                    }
                } catch (_) { }
                cc._refreshCache();
            });
            // 鼠标效果
            vt.on('mouseenter', () => { vt.getStage().container().style.cursor = 'pointer'; vt.fill(C.blue); });
            vt.on('mouseleave', () => { vt.getStage().container().style.cursor = 'default'; vt.fill(p.color); });
        }
    });
    [
        { label: '比例 P', key: 'p', unit: '', color: C.green, editable: true },
        { label: '积分 I', key: 'i', unit: '', color: C.green, editable: true },
        { label: '微分 D', key: 'd', unit: '', color: C.green, editable: true }
    ].forEach((p, i) => {
        const py = 32 + i * 20;
        pg.add(new Konva.Text({ x: cx + 200, y: py, text: p.label + ' :', fontSize: 12, fontFamily: 'Courier New', fill: p.color }));
        const vt = new Konva.Text({ x: cx + 300, y: py, text: '---', fontSize: 12, fontFamily: 'Courier New', fontStyle: 'bold', fill: p.color });
        pg.add(vt);
        cc._pidParams[p.key] = vt;

        // 可编辑参数点击弹出修改框
        if (p.editable && vt) {
            vt.on('click tap', () => {
                const cur = cc.tempCtrl[p.key] ?? 0;
                const input = prompt(`修改 ${p.label}（当前 ${cur}${p.unit}）:`, String(cur));
                if (input === null) return;
                const num = parseFloat(input);
                if (isNaN(num)) return alert('请输入有效数字');
                cc.tempCtrl[p.key] = num;
                vt.text(`${num}${p.unit}`);
                cc._refreshCache();
            });
            // 鼠标效果
            vt.on('mouseenter', () => { vt.getStage().container().style.cursor = 'pointer'; vt.fill(C.blue); });
            vt.on('mouseleave', () => { vt.getStage().container().style.cursor = 'default'; vt.fill(p.color); });
        }
    });
    // 通道选择区
    pg.add(new Konva.Text({ x: cx, y: 100, text: '■ 通道选择', fontSize: 13, fontFamily: 'Courier New', fontStyle: 'bold', fill: C.cyan }));
    pg.add(new Konva.Text({ x: cx, y: 122, text: '输入通道(AI):', fontSize: 11, fontFamily: 'Courier New', fill: C.text }));
    cc._tempInputChBtn = mkBtn(pg, 'CH3', cx + 100, 116, C.cyan);

    pg.add(new Konva.Text({ x: cx, y: 144, text: '输出通道(AO):', fontSize: 11, fontFamily: 'Courier New', fill: C.text }));
    cc._tempOutputChBtn1 = mkBtn(pg, 'CH1', cx + 100, 142, cc.tempCtrl.outputChannel === 'ch1' ? C.cyan : C.textDim);
    cc._tempOutputChBtn2 = mkBtn(pg, 'CH2', cx + 160, 142, cc.tempCtrl.outputChannel === 'ch2' ? C.cyan : C.textDim);

    pg.add(new Konva.Text({ x: cx, y: 180, text: '■ 执行机构', fontSize: 13, fontFamily: 'Courier New', fontStyle: 'bold', fill: C.cyan }));
    cc._steamValveText = new Konva.Text({ x: cx, y: 202, text: '电动调节阀: 0%', fontSize: 12, fontFamily: 'Courier New', fill: C.green });
    pg.add(cc._steamValveText);

    cc._tempAlarmText = new Konva.Text({ x: cx, y: 230, text: '● 温度正常', fontSize: 12, fontFamily: 'Courier New', fill: C.green });
    pg.add(cc._tempAlarmText);

    // 趋势图
    const trY = 260, trW = pw - 16, trH = ph - trY - 8;
    pg.add(new Konva.Rect({ x: 6, y: trY, width: trW, height: trH, fill: C.bg, stroke: C.border, strokeWidth: 1, cornerRadius: 2 }));
    pg.add(new Konva.Text({ x: 10, y: trY + 2, text: 'PV ─   SV - -   OUT ···', fontSize: 10, fontFamily: 'Courier New', fill: C.textDim }));
    [0.25, 0.5, 0.75].forEach(f => {
        const gy = trY + trH * (1 - f);
        pg.add(new Konva.Line({ points: [6, gy, 6 + trW, gy], stroke: C.gridLine, strokeWidth: 1 }));
    });
    cc._tPV = new Konva.Line({ stroke: C.red, strokeWidth: 1.5 });
    cc._tSV = new Konva.Line({ stroke: C.green, strokeWidth: 1.5, dash: [6, 4] });
    cc._tOUT = new Konva.Line({ stroke: C.yellow, strokeWidth: 3, dash: [2, 2] });
    pg.add(cc._tPV, cc._tSV, cc._tOUT);
    cc._tempTrendMeta = { x: 6, y: trY, w: trW, h: trH };

    // 初始化事件处理
    initTempPageEvents(cc);
}

/**
 * 初始化温度控制页面的事件处理
 */
function initTempPageEvents(cc) {
    // 蒸汽阀模式切换（类似液位控制）
    if (cc._steamModeBtn) {
        cc._steamModeBtn.on('click tap', () => {
            const isAuto = cc.tempCtrl.simMode === 'AUTO';
            const newSimMode = isAuto ? 'HAND' : 'AUTO';
            cc.tempCtrl.simMode = newSimMode;
            cc.tempCtrl.isManualMode = isAuto;

            // 更新按钮显示
            const isM = newSimMode === 'HAND';
            cc._steamModeBtn.findOne('Rect').fill(isM ? C.yellow + '33' : C.green + '22');
            cc._steamModeBtn.findOne('Rect').stroke(isM ? C.yellow : C.green);
            cc._steamModeBtn.findOne('Text').text(isM ? '模式:手动' : '模式:自动');
            cc._steamModeBtn.findOne('Text').fill(isM ? C.yellow : C.green);

            // 同步 AO 模块模式（通过 CAN 总线）
            const outputCh = cc.tempCtrl.outputChannel;
            const chIdx = outputCh === 'ch1' ? 0 : outputCh === 'ch2' ? 1 : 0;
            const modeValue = isAuto ? 0 : 1; // 0 = hand, 1 = auto
            const newMode = isAuto ? 'hand' : 'auto';

            try {
                const bus = cc.sys?.canBus;
                if (bus && cc.busConnected && !cc.commFault) {
                    bus.send({
                        id: CANId.encode(CAN_FUNC.AO_CMD, 4),
                        extended: false, rtr: false, dlc: 8,
                        data: [0x10, chIdx, modeValue, 0, 0, 0, 0, 0],
                        sender: cc.id, timestamp: Date.now(),
                    });
                }
            } catch (_) { }

            // 同步 AO 模块数据结构
            const aoMod = cc.sys?.comps?.['ao'];
            if (aoMod && aoMod.channels) {
                if (aoMod.channels[outputCh]) {
                    aoMod.channels[outputCh].mode = newMode;
                }
            }
            if (!cc.data.ao[outputCh]) {
                cc.data.ao[outputCh] = {};
            }
            cc.data.ao[outputCh].mode = newMode;
            cc._refreshCache();
        });
    }

    // 手动增大按钮
    if (cc._steamIncBtn) {
        cc._steamIncBtn.on('click tap', () => {
            if (cc.tempCtrl.isManualMode || cc.tempCtrl.simMode === 'HAND') {
                cc.tempCtrl.valveOpen = Math.min(100, cc.tempCtrl.valveOpen + 1);
            }
        });
    }

    // 手动减少按钮
    if (cc._steamDecBtn) {
        cc._steamDecBtn.on('click tap', () => {
            if (cc.tempCtrl.isManualMode || cc.tempCtrl.simMode === 'HAND') {
                cc.tempCtrl.valveOpen = Math.max(0, cc.tempCtrl.valveOpen - 1);
            }
        });
    }

    // 输出通道选择
    if (cc._tempOutputChBtn1) {
        cc._tempOutputChBtn1.on('click tap', () => {
            cc.tempCtrl.outputChannel = 'ch1';
        });
    }
    if (cc._tempOutputChBtn2) {
        cc._tempOutputChBtn2.on('click tap', () => {
            cc.tempCtrl.outputChannel = 'ch2';
        });
    }
}

// ── 每 tick 刷新 ──────────────────────────────
export function renderTempPage(cc) {
    const tc = cc.tempCtrl;

    const maxT = 200, thH = 200, thY = 24;
    const fillH = Math.round(Math.min(1, tc.pv / maxT) * (thH - 4));
    cc._thermFill.y(thY + thH - 2 - fillH);
    cc._thermFill.height(fillH);
    const tc_ = tc.pv > 150 ? C.red : (tc.pv > 100 ? C.yellow : C.blue);
    cc._thermFill.fill(tc_ + '99');
    cc._tempValueLabel.text(`${tc.pv.toFixed(1)}°C`);
    cc._tempValueLabel.fill(tc_);

    cc._valveOpenLabel.text(`阀开: ${tc.valveOpen.toFixed(1)}%`);

    cc._pidParams.sv.text(`${tc.sv.toFixed(0)}°C`);
    cc._pidParams.pv.text(`${tc.pv.toFixed(0)}°C`);
    cc._pidParams.p.text(`${tc.p.toFixed(2)}`);
    cc._pidParams.i.text(`${tc.i.toFixed(2)}`);
    cc._pidParams.d.text(`${tc.d.toFixed(2)}`);

    cc._tempOutputChBtn1.findOne('Rect').fill(tc.outputChannel === 'ch1' ? C.cyan + '33' : C.textDim + '22');
    cc._tempOutputChBtn1.findOne('Rect').stroke(tc.outputChannel === 'ch1' ? C.cyan : C.textDim);
    cc._tempOutputChBtn1.findOne('Text').fill(tc.outputChannel === 'ch1' ? C.cyan : C.textDim);

    cc._tempOutputChBtn2.findOne('Rect').fill(tc.outputChannel === 'ch2' ? C.cyan + '33' : C.textDim + '22');
    cc._tempOutputChBtn2.findOne('Rect').stroke(tc.outputChannel === 'ch2' ? C.cyan : C.textDim);
    cc._tempOutputChBtn2.findOne('Text').fill(tc.outputChannel === 'ch2' ? C.cyan : C.textDim);

    cc._steamValveText.text(`电动调节阀: ${tc.valveOpen.toFixed(1)}%`);

    const alarmColor = tc.pv > tc.highAlarm ? C.red : (tc.pv < tc.lowAlarm ? C.yellow : C.green);
    const alarmText = tc.pv > tc.highAlarm ? '△ 高温报警' : (tc.pv < tc.lowAlarm ? '▽ 低温报警' : '● 温度正常');
    cc._tempAlarmText.text(alarmText);
    cc._tempAlarmText.fill(alarmColor);

    const isHand = tc.simMode === 'HAND';
    cc._steamModeBtn.findOne('Rect').fill(isHand ? C.yellow + '33' : C.green + '22');
    cc._steamModeBtn.findOne('Rect').stroke(isHand ? C.yellow : C.green);
    cc._steamModeBtn.findOne('Text').text(isHand ? '模式:手动' : '模式:自动');
    cc._steamModeBtn.findOne('Text').fill(isHand ? C.yellow : C.green);

    if (tc.history.length > 1) {
        const m = cc._tempTrendMeta, pts_pv = [], pts_sv = [], pts_out = [];
        tc.history.forEach((d, i) => {
            const x = m.x + i * (m.w / tc.maxHist);
            pts_pv.push(x, m.y + m.h - (d.pv / maxT) * m.h);
            pts_sv.push(x, m.y + m.h - (d.sv / maxT) * m.h);
            pts_out.push(x, m.y + m.h - (d.out / 100) * m.h);
        });
        cc._tPV.points(pts_pv);
        cc._tSV.points(pts_sv);
        cc._tOUT.points(pts_out);
    }
}

// ── 温度仿真（每 tick 由主循环调用）─────────────
export function simTemp(cc) {
    const tc = cc.tempCtrl;

    const inputCh = tc.inputChannel;
    if (cc.data.ai[inputCh]) {
        tc.pv = cc.data.ai[inputCh].value;
    }

    const outputCh = tc.outputChannel;
    if (tc.simMode === 'AUTO') {
        // 获取当前时间（秒）
        const now = performance.now ? performance.now() : Date.now();
        const dt = tc._lastPidTime !== undefined ? Math.min(0.1, (now - tc._lastPidTime) / 1000) : 0.05;
        tc._lastPidTime = now;

        // 防止 dt 过小或无效
        const validDt = Math.max(0.01, Math.min(0.1, dt));

        // 计算偏差
        const err = tc.sv - tc.pv;

        // ----- 比例项 (P) -----
        const p_out = err * tc.p;

        // ----- 积分项 (I) -----
        // 积分限幅，防止积分饱和
        const iMax = 50;   // 积分项最大输出限制
        const iMin = -50;

        // 累积偏差（带积分限幅）
        let i_out = 0;
        if (tc.i > 1) {
            tc._integral = (tc._integral || 0) + err * validDt * (1 / tc.i);
            tc._integral = Math.max(iMin, Math.min(iMax, tc._integral));
            i_out = tc._integral;
        } else {
            i_out = 0;
        }


        // ----- 微分项 (D) -----
        // 计算偏差变化率 (防止突变噪声，可加滤波)
        let derivative = 0;
        if (tc._lastErr !== undefined && validDt > 0.01) {
            derivative = (err - tc._lastErr) / validDt;
        }
        const d_out = Math.max(iMin, Math.min(iMax, derivative * tc.d/4));
        tc._lastErr = err;

        // ----- PID 总输出 -----
        // 基础输出 50% 作为中心点（对应阀门中位）
        let pidOutput = 50 + p_out + i_out + d_out;

        // 输出限幅 0-100%
        pidOutput = Math.max(0, Math.min(100, pidOutput));

        // 抗积分饱和（积分回卷）：当输出饱和时停止积分累积
        if ((pidOutput >= 99.5 && err > 0) || (pidOutput <= 0.5 && err < 0)) {
            // 输出饱和，保持积分值不变
            tc._integral = tc._integral - err * validDt;
            tc._integral = Math.max(iMin, Math.min(iMax, tc._integral));
        }

        tc.out = pidOutput;
        tc.valveOpen = tc.out;

    } else if (tc.simMode === 'HAND' && tc.isManualMode) {
        tc.out = tc.valveOpen;
    }

    if (cc.data.ao[outputCh]) {
        cc.data.ao[outputCh].percent = tc.out;
        cc.data.ao[outputCh].actual = 4 + (tc.out / 100) * 16;
    }

    try {
        const bus = cc.sys?.canBus;
        if (bus && cc.busConnected && !cc.commFault) {
            const chIdx = outputCh === 'ch1' ? 0 : 1;
            const pctInt = Math.round(tc.out * 10);
            const data = [0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF];
            const bytePos = chIdx * 2;
            data[bytePos] = (pctInt >> 8) & 0xFF;
            data[bytePos + 1] = pctInt & 0xFF;
            bus.send({
                id: CANId.encode(CAN_FUNC.AO_CMD, 2),
                extended: false, rtr: false, dlc: 8, data,
                sender: cc.id, timestamp: Date.now()
            });
        }
    } catch (_) { }

    tc.history.push({ pv: tc.pv, sv: tc.sv, out: tc.out });
    if (tc.history.length > tc.maxHist) tc.history.shift();
}
