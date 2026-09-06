// 三相异步电动机功能测试仿真工程

import { ACPower3P } from '../components/ACPower3P.js';
import { InductionMotor } from '../components/InductionMotor.js';
import { Multimeter } from '../components/Multimeter.js';
import { MF47Multimeter } from '../components/MF47Multimeter.js';
import { Oscilloscope_tri } from '../components/Osc_tri.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';
import { ElecMeter } from '../components/ElecMeter.js';
import { DCPower } from '../components/DCPower.js';
import { TsCurveDisplay } from '../components/TsCurveDisplay.js';

export const FAULT_CONFIGS = {};

export const PROJECT_WORKFLOWS = {
    'motor-starting': {
        id: 'motor-starting',
        name: '1. 三相异步电机运行',
        steps: [
            {
                msg: '第 1 步：将三相电源 U-V-W 分别连接至电动机 U1-V1-W1 端子，并将电动机接成 Y 形（U2-V2-W2 短接）。',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    const isShow = this._wfMode === 'show';
                    if (!isShow) { _autoWire(sys, 'motor-starting'); return; }

                    // 1. 先指示接线对象（交流电源 → 电机）
                    await _blinkN(sys, 'ac', 2, {
                        direction: 'right',
                        tip: '操作：将三相电源 U-V-W 连接至电动机端子',
                    });
                    // 2. 逐条连线动画（全新接线，先清空）
                    sys.conns.length = 0;
                    const cons = [
                        { from: 'ac_wire_u', to: 'im01_wire_u1', type: 'wire' },
                        { from: 'ac_wire_v', to: 'im01_wire_v1', type: 'wire' },
                        { from: 'ac_wire_w', to: 'im01_wire_w1', type: 'wire' },
                        { from: 'im01_wire_u2', to: 'im01_wire_v2', type: 'wire' },
                        { from: 'im01_wire_u2', to: 'im01_wire_w2', type: 'wire' },
                    ];
                    const labels = [
                        '连接 U 相 → U1 端子',
                        '连接 V 相 → V1 端子',
                        '连接 W 相 → W1 端子',
                        '短接 U2-V2（Y 形中性点）',
                        '短接 U2-W2（Y 形中性点）',
                    ];
                    await _wireAnimated(sys, cons, labels);
                    // 3. 停顿观察连线结果
                    await new Promise(r => setTimeout(r, 5000));
                },
                check() {
                    const c = (a, b) => this.sys.isPortConnected(a, b);
                    return c('ac_wire_u', 'im01_wire_u1')
                        && c('ac_wire_v', 'im01_wire_v1')
                        && c('ac_wire_w', 'im01_wire_w1')
                        && c('im01_wire_u2', 'im01_wire_v2')
                        && c('im01_wire_u2', 'im01_wire_w2');
                },
            },
            {
                msg: '第 2 步：开启三相电源（220V / 50Hz），观察电动机起动过程和面板显示的起动电流。',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    const isShow = this._wfMode === 'show';
                    const ac = sys.comps['ac'];

                    if (!isShow) {
                        if (ac) ac.onConfigUpdate({ vRms: 220, freq: 50, isOn: true, phaseSeq: 'pos' });
                        return;
                    }

                    // 1. 箭头 + 虚线圆包围交流电源，闪烁 3 次
                    await _blinkN(sys, 'ac', 3, {
                        direction: 'right',
                        tip: '请点击三相电源：开启 220V / 50Hz',
                    });
                    // 2. 执行开启操作
                    if (ac) ac.onConfigUpdate({ vRms: 220, freq: 50, isOn: true, phaseSeq: 'pos' });
                    sys.showFloatingTip('三相电源已开启，电机开始起动', 2000);

                    // 3. 观察：停顿 60s，箭头指向观察对象（电机）
                    const obs = _flashArrow(sys, 'im01', {
                        direction: 'up',
                        color: '#2ecc71',
                        tip: '观察：电机起动过程与面板电流',
                    });
                    await new Promise(r => setTimeout(r, 60000));
                    if (obs) obs.clear();
                },
                check() {
                    const ac = this.sys.comps['ac'];
                    return ac && ac.isOn;
                },
            },
            {
                msg: '第 3 步：将负载转矩调至 60.0 N·m，观察转速和电流随负载增加的变化。',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    const isShow = this._wfMode === 'show';
                    const motor = sys.comps['im01'];
                    const slider = document.getElementById('torqueSlider');
                    const display = document.getElementById('torqueDisplay');

                    if (!isShow) {
                        if (slider) { slider.value = '60'; slider.dispatchEvent(new Event('input')); }
                        return;
                    }

                    // 1. 调出"负载转矩"参数控件并高亮指向被改参数
                    const sliderContainer = document.getElementById('torqueSliderContainer');
                    _flashDOM(sliderContainer || slider, '请调节负载转矩参数', 3);
                    await new Promise(r => setTimeout(r, 1500));

                    // 2. 动态显示修改过程：从当前值逐步增加至 60 N·m
                    const start = motor ? motor.loadTorque : 0;
                    const steps = 12;
                    for (let i = 1; i <= steps; i++) {
                        const val = Math.round((start + (60 - start) * (i / steps)) * 10) / 10;
                        if (slider) {
                            slider.value = String(Math.max(0, Math.min(200, val)));
                            slider.dispatchEvent(new Event('input'));
                        }
                        if (display) display.textContent = val.toFixed(1) + ' N·m';
                        sys.showFloatingTip(`负载转矩：${val.toFixed(1)} N·m`, 700);
                        await new Promise(r => setTimeout(r, 180));
                    }
                    // 最终确保为 60
                    if (slider) { slider.value = '60'; slider.dispatchEvent(new Event('input')); }
                    // 3. 停顿观察转速和电流变化
                    sys.showFloatingTip('观察：负载增大，转速下降、电流增大', 5000);
                    await new Promise(r => setTimeout(r, 20000));
                },
                check() {
                    const motor = this.sys.comps['im01'];
                    return motor && Math.abs(motor.loadTorque - 60) < 3;
                },
            },
            {
                msg: '第 4 步：关闭三相电源，电动机停机。',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    const isShow = this._wfMode === 'show';
                    const ac = sys.comps['ac'];

                    if (!isShow) {
                        if (ac) ac.onConfigUpdate({ isOn: false });
                        return;
                    }

                    // 1. 箭头 + 虚线圆包围三相电源，闪烁 3 次
                    await _blinkN(sys, 'ac', 3, {
                        direction: 'right',
                        tip: '请点击三相电源：关闭',
                    });
                    // 2. 执行关闭
                    if (ac) ac.onConfigUpdate({ isOn: false });
                    sys.showFloatingTip('电源已关闭，电机停车', 2000);

                    // 3. 观察：箭头指向电机，观察停机
                    const obs = _flashArrow(sys, 'im01', {
                        direction: 'up',
                        color: '#2ecc71',
                        tip: '观察：电机转速下降直至停转',
                    });
                    await new Promise(r => setTimeout(r, 15000));
                    if (obs) obs.clear();
                },
                check() {
                    const ac = this.sys.comps['ac'];
                    return ac && !ac.isOn;
                },
            },
            {
                msg: '第 5 步：三相异步电机起动知识',
                mode: 'quiz',
                quizConfig: {
                    question: '三相异步电动机起动瞬间的起动电流通常为额定电流的多少倍？',
                    options: [
                        '1~2 倍',
                        '4~7 倍',
                        '10~15 倍',
                        '20 倍以上',
                    ],
                    answer: 1,
                    analysis: '起动瞬间转子转速为零，转差率 s=1，转子电路阻抗很小，因此起动电流可达额定电流的 4~7 倍。但起动转矩仅为额定转矩的 1~2 倍，这是异步电动机起动的主要特点。',
                },
                async act() {
                    // 展示题目 → 指出正确答案（延时3s）→ 自动关闭（自动演示）
                    const sys = this.sys;
                    const q = {
                        question: '三相异步电动机起动瞬间的起动电流通常为额定电流的多少倍？',
                        options: ['1~2 倍', '4~7 倍', '10~15 倍', '20 倍以上'],
                        answer: 1,
                        analysis: '起动瞬间转差率 s=1，转子电路阻抗很小，起动电流可达额定电流的 4~7 倍。但起动转矩仅为额定转矩的 1~2 倍，这是异步电动机起动的主要特点。',
                    };
                    const parent = sys.container;
                    const mask = document.createElement('div');
                    Object.assign(mask.style, {
                        position: 'absolute', top: '0', left: '0', width: '100%', height: '100%',
                        background: 'rgba(0,0,0,0.55)', zIndex: '100',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'sans-serif',
                    });
                    const box = document.createElement('div');
                    Object.assign(box.style, {
                        background: '#fff', width: '88%', maxWidth: '520px', borderRadius: '12px',
                        padding: '20px', boxShadow: '0 8px 20px rgba(0,0,0,0.3)',
                    });
                    const letters = ['A', 'B', 'C', 'D'];
                    // 先只显示题目和选项（不带正确答案标记）
                    let html = `
                        <div style="color:#1395eb;font-size:15px;font-weight:bold;margin-bottom:4px;">[单选题]</div>
                        <div style="font-weight:bold;margin-bottom:14px;line-height:1.4;">${q.question}</div>`;
                    q.options.forEach((text, i) => {
                        html += `
                        <div data-opt="${i}" style="margin:6px 0;padding:10px 12px;border:2px solid #ddd;
                             border-radius:8px;background:#fcfcfc;font-size:15px;">
                            <span style="font-weight:bold;margin-right:8px;color:#1395eb;">${letters[i]}</span>${text}
                        </div>`;
                    });
                    // 预留解析区域（稍后填入）
                    html += `<div id="quiz-ana" style="display:none;margin-top:14px;padding:12px;font-size:13px;background:#f1f8e9;border-left:4px solid #4caf50;border-radius:4px;color:#555;line-height:1.5;"></div>`;
                    box.innerHTML = html;
                    mask.appendChild(box);
                    parent.appendChild(mask);

                    // 第 1 阶段：展示题目让学员阅读
                    await new Promise(r => setTimeout(r, 3000));

                    // 第 2 阶段：指出正确答案（绿色高亮 + ✅ 标记）
                    const optNodes = box.querySelectorAll('[data-opt]');
                    optNodes[q.answer].style.borderColor = '#4caf50';
                    optNodes[q.answer].style.background = '#e8f5e9';
                    const tag = document.createElement('span');
                    tag.style.cssText = 'color:#2e7d32;font-weight:bold;margin-left:6px;';
                    tag.textContent = '✅ 正确答案';
                    optNodes[q.answer].appendChild(tag);
                    const anaEl = box.querySelector('#quiz-ana');
                    anaEl.style.display = 'block';
                    anaEl.innerHTML = `💡 ${q.analysis}`;

                    // 正确答案延时 3s 后自动关闭
                    await new Promise(r => setTimeout(r, 3000));
                    if (parent.contains(mask)) parent.removeChild(mask);
                    sys.showFloatingTip('✅ 正确答案：4~7 倍', 1500);
                },
            },
        ],
    },

    'rotating-field': {
        id: 'rotating-field',
        name: '2. 旋转磁场的性质',
        steps: [
            {
                msg: '第 1 步：接线并开启三相电源（正序 UVW），观察旋转磁场方向（N-S 红色/黑色半圆的旋转方向）。',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    const isShow = this._wfMode === 'show';
                    const ac = sys.comps['ac'];
                    if (!isShow) {
                        _autoWire(sys, 'rotating-field');
                        if (ac) ac.onConfigUpdate({ vRms: 220, freq: 50, isOn: true, phaseSeq: 'pos' });
                        return;
                    }
                    await _blinkN(sys, 'ac', 2, { direction: 'right', tip: '操作：接线（Y 形）并开启三相电源（正序 UVW）' });
                    sys.conns.length = 0;
                    const cons = [
                        { from: 'ac_wire_u', to: 'im01_wire_u1', type: 'wire' },
                        { from: 'ac_wire_v', to: 'im01_wire_v1', type: 'wire' },
                        { from: 'ac_wire_w', to: 'im01_wire_w1', type: 'wire' },
                        { from: 'im01_wire_u2', to: 'im01_wire_v2', type: 'wire' },
                        { from: 'im01_wire_u2', to: 'im01_wire_w2', type: 'wire' },
                    ];
                    const labels = ['U → U1', 'V → V1', 'W → W1', '短接 U2-V2', '短接 U2-W2'];
                    await _wireAnimated(sys, cons, labels);
                    await _blinkN(sys, 'ac', 3, { direction: 'right', tip: '开启三相电源（正序 UVW）' });
                    if (ac) ac.onConfigUpdate({ vRms: 220, freq: 50, isOn: true, phaseSeq: 'pos' });
                    sys.showFloatingTip('电源已开启，旋转磁场形成', 2000);
                    const obs = _flashArrow(sys, 'im01', { direction: 'up', color: '#2ecc71', tip: '观察：N-S 磁极的旋转方向' });
                    await new Promise(r => setTimeout(r, 5000));
                    if (obs) obs.clear();
                },
                check() {
                    const ac = this.sys.comps['ac'];
                    return ac && ac.isOn && ac.phaseSeq === 'pos';
                },
            },
            {
                msg: '第 2 步：任意调换两根火线的接入顺序（如将 V 相与 W 相对调），重新开启电源，观察旋转磁场方向是否反转。',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    const isShow = this._wfMode === 'show';
                    const ac = sys.comps['ac'];
                    if (!isShow) {
                        if (ac) ac.onConfigUpdate({ isOn: false });
                        sys.conns.length = 0;
                        const cons = [
                            { from: 'ac_wire_u', to: 'im01_wire_u1', type: 'wire' },
                            { from: 'ac_wire_v', to: 'im01_wire_w1', type: 'wire' },
                            { from: 'ac_wire_w', to: 'im01_wire_v1', type: 'wire' },
                            { from: 'im01_wire_u2', to: 'im01_wire_v2', type: 'wire' },
                            { from: 'im01_wire_u2', to: 'im01_wire_w2', type: 'wire' },
                        ];
                        cons.forEach(c => sys.connMgr.addConn(c));
                        sys.redrawAll();
                        if (ac) ac.onConfigUpdate({ isOn: true });
                        return;
                    }
                    await _blinkN(sys, 'ac', 2, { direction: 'right', tip: '操作：调换 V 相与 W 相的接入顺序' });
                    sys.showFloatingTip('先断开 V→V1、W→W1 两根火线', 1800);
                    if (ac) ac.onConfigUpdate({ isOn: false });
                    await new Promise(r => setTimeout(r, 300));
                    await _unwireAnimated(sys, [
                        { from: 'ac_wire_v', to: 'im01_wire_v1', type: 'wire' },
                        { from: 'ac_wire_w', to: 'im01_wire_w1', type: 'wire' },
                    ]);
                    await new Promise(r => setTimeout(r, 400));
                    sys.showFloatingTip('调换：V → W1，W → V1', 1800);
                    await _wireAnimated(sys, [
                        { from: 'ac_wire_v', to: 'im01_wire_w1', type: 'wire' },
                        { from: 'ac_wire_w', to: 'im01_wire_v1', type: 'wire' },
                    ], ['V → W1（对调）', 'W → V1（对调）']);
                    await _blinkN(sys, 'ac', 3, { direction: 'right', tip: '重新开启三相电源' });
                    if (ac) ac.onConfigUpdate({ vRms: 220, freq: 50, isOn: true, phaseSeq: 'pos' });
                    sys.showFloatingTip('电源已重新开启，磁场方向反转', 2000);
                    const obs = _flashArrow(sys, 'im01', { direction: 'up', color: '#2ecc71', tip: '观察：旋转磁场方向是否反转' });
                    await new Promise(r => setTimeout(r, 5000));
                    if (obs) obs.clear();
                },
                check() {
                    const c = (a, b) => this.sys.isPortConnected(a, b);
                    const ac = this.sys.comps['ac'];
                    return ac && ac.isOn
                        && c('ac_wire_v', 'im01_wire_w1')
                        && c('ac_wire_w', 'im01_wire_v1')
                        && !c('ac_wire_v', 'im01_wire_v1')
                        && !c('ac_wire_w', 'im01_wire_w1');
                },
            },
            {
                msg: '第 3 步：恢复正常的接线顺序（U→U1, V→V1, W→W1），并将频率调至 30 Hz，观察旋转磁场转速和转子转速下降。',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    const isShow = this._wfMode === 'show';
                    const ac = sys.comps['ac'];
                    if (!isShow) {
                        sys.conns.length = 0;
                        const cons = [
                            { from: 'ac_wire_u', to: 'im01_wire_u1', type: 'wire' },
                            { from: 'ac_wire_v', to: 'im01_wire_v1', type: 'wire' },
                            { from: 'ac_wire_w', to: 'im01_wire_w1', type: 'wire' },
                            { from: 'im01_wire_u2', to: 'im01_wire_v2', type: 'wire' },
                            { from: 'im01_wire_u2', to: 'im01_wire_w2', type: 'wire' },
                        ];
                        cons.forEach(c => sys.connMgr.addConn(c));
                        if (ac) ac.onConfigUpdate({ freq: 30 });
                        sys.redrawAll();
                        return;
                    }
                    sys.showFloatingTip('恢复正常接线顺序', 1800);
                    await _unwireAnimated(sys, [
                        { from: 'ac_wire_v', to: 'im01_wire_w1', type: 'wire' },
                        { from: 'ac_wire_w', to: 'im01_wire_v1', type: 'wire' },
                    ]);
                    await new Promise(r => setTimeout(r, 400));
                    await _wireAnimated(sys, [
                        { from: 'ac_wire_v', to: 'im01_wire_v1', type: 'wire' },
                        { from: 'ac_wire_w', to: 'im01_wire_w1', type: 'wire' },
                    ], ['V → V1（恢复）', 'W → W1（恢复）']);
                    sys.showFloatingTip('等待正常正转运行', 3000);
                    await new Promise(r => setTimeout(r, 60000));
                    await _setDialogParam(sys, 'ac', 'freq', 30, {
                        tip: '将频率调至 30 Hz，观察转速下降',
                        steps: 12, speed: 180,
                    });
                    const obs = _flashArrow(sys, 'im01', { direction: 'up', color: '#2ecc71', tip: '观察：旋转磁场转速与转子转速下降' });
                    // 等待 20s，转速稳定后再进入下一步
                    await new Promise(r => setTimeout(r, 20000));
                    if (obs) obs.clear();
                },
                check() {
                    const c = (a, b) => this.sys.isPortConnected(a, b);
                    const wireOk = c('ac_wire_u', 'im01_wire_u1')
                               && c('ac_wire_v', 'im01_wire_v1')
                               && c('ac_wire_w', 'im01_wire_w1');
                    const ac = this.sys.comps['ac'];
                    return wireOk && ac && Math.abs(ac.freq - 30) < 0.5;
                },
            },
            {
                msg: '第 4 步：将频率调至 60 Hz，观察旋转磁场转速和转子转速上升。',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    const isShow = this._wfMode === 'show';
                    const ac = sys.comps['ac'];
                    if (!isShow) {
                        if (ac) ac.onConfigUpdate({ freq: 60 });
                        return;
                    }
                    await _blinkN(sys, 'ac', 2, { direction: 'right', tip: '调节频率参数' });
                    await _setDialogParam(sys, 'ac', 'freq', 60, {
                        tip: '将频率调至 60 Hz，观察转速上升',
                        steps: 12, speed: 180,
                    });
                    const obs = _flashArrow(sys, 'im01', { direction: 'up', color: '#2ecc71', tip: '观察：旋转磁场转速与转子转速上升' });
                    // 等待 25s，转速稳定后再进入下一步
                    await new Promise(r => setTimeout(r, 25000));
                    if (obs) obs.clear();
                },
                check() {
                    const ac = this.sys.comps['ac'];
                    return ac && Math.abs(ac.freq - 60) < 0.5;
                },
            },
            {
                msg: '第 5 步：将频率调回 50 Hz，然后将电机极对数由 2 对极改为 4 对极，观察同步转速变化（1500 → 750 rpm）以及定子齿槽和旋转磁极数目的变化。',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    const isShow = this._wfMode === 'show';
                    const ac = sys.comps['ac'];
                    const motor = sys.comps['im01'];
                    if (!isShow) {
                        if (ac) ac.onConfigUpdate({ freq: 50 });
                        if (motor) motor.onConfigUpdate({ polePairs: 4 });
                        return;
                    }
                    await _blinkN(sys, 'ac', 2, { direction: 'right', tip: '调节频率回 50 Hz' });
                    await _setDialogParam(sys, 'ac', 'freq', 50, {
                        tip: '频率调回 50 Hz',
                        steps: 10, speed: 160,
                    });
                    await new Promise(r => setTimeout(r, 10000));
                    // 电机极对数 2 → 4：调出电机参数对话框，动态调节
                    await _blinkN(sys, 'im01', 3, { direction: 'up', tip: '将电机极对数由 2 改为 4' });
                    if (!motor) return;
                    await _setDialogParam(sys, 'im01', 'polePairs', 4, {
                        tip: '电机极对数 2 → 4（电流、磁极随之变化）',
                        steps: 4, speed: 220,
                    });
                    sys.showFloatingTip('极对数改为 4，同步转速减半', 2500);
                    const obs = _flashArrow(sys, 'im01', { direction: 'up', color: '#2ecc71', tip: '观察：同步转速 1500 → 750 rpm，磁极数目变化' });
                    // 等待 20s，转速稳定后再进入下一步
                    await new Promise(r => setTimeout(r, 20000));
                    if (obs) obs.clear();
                },
                check() {
                    const ac = this.sys.comps['ac'];
                    const motor = this.sys.comps['im01'];
                    return ac && motor && Math.abs(ac.freq - 50) < 0.5 && motor.polePairs === 4;
                },
            },
            {
                msg: '第 6 步：旋转磁场知识',
                mode: 'quiz',
                quizConfig: {
                    question: '三相异步电动机旋转磁场的转速（同步转速）与什么因素有关？',
                    options: [
                        '仅与电源频率有关',
                        '仅与电机极对数有关',
                        '与电源频率和电机极对数均有关',
                        '与负载大小有关',
                    ],
                    answer: 2,
                    analysis: '同步转速 n₁ = 60f / p（f 为电源频率，p 为极对数）。改变频率可连续调节同步转速实现调速；改变极对数可实现有级调速；旋转磁场方向由相序决定，任意调换两相即可反转。',
                },
                async act() {
                    const sys = this.sys;
                    const q = {
                        question: '三相异步电动机旋转磁场的转速（同步转速）与什么因素有关？',
                        options: ['仅与电源频率有关', '仅与电机极对数有关', '与电源频率和电机极对数均有关', '与负载大小有关'],
                        answer: 2,
                        analysis: '同步转速 n₁ = 60f / p。改变频率可连续调速，改变极对数可进行有级调速，磁场方向由相序决定。',
                    };
                    const parent = sys.container;
                    const mask = document.createElement('div');
                    Object.assign(mask.style, {
                        position: 'absolute', top: '0', left: '0', width: '100%', height: '100%',
                        background: 'rgba(0,0,0,0.55)', zIndex: '100',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'sans-serif',
                    });
                    const box = document.createElement('div');
                    Object.assign(box.style, {
                        background: '#fff', width: '88%', maxWidth: '520px', borderRadius: '12px',
                        padding: '20px', boxShadow: '0 8px 20px rgba(0,0,0,0.3)',
                    });
                    const letters = ['A', 'B', 'C', 'D'];
                    let html = `
                        <div style="color:#1395eb;font-size:15px;font-weight:bold;margin-bottom:4px;">[单选题]</div>
                        <div style="font-weight:bold;margin-bottom:14px;line-height:1.4;">${q.question}</div>`;
                    q.options.forEach((text, i) => {
                        html += `
                        <div data-opt="${i}" style="margin:6px 0;padding:10px 12px;border:2px solid #ddd;
                             border-radius:8px;background:#fcfcfc;font-size:15px;">
                            <span style="font-weight:bold;margin-right:8px;color:#1395eb;">${letters[i]}</span>${text}
                        </div>`;
                    });
                    html += `<div id="quiz-ana" style="display:none;margin-top:14px;padding:12px;font-size:13px;background:#f1f8e9;border-left:4px solid #4caf50;border-radius:4px;color:#555;line-height:1.5;"></div>`;
                    box.innerHTML = html;
                    mask.appendChild(box);
                    parent.appendChild(mask);
                    await new Promise(r => setTimeout(r, 3000));
                    const optNodes = box.querySelectorAll('[data-opt]');
                    optNodes[q.answer].style.borderColor = '#4caf50';
                    optNodes[q.answer].style.background = '#e8f5e9';
                    const tag = document.createElement('span');
                    tag.style.cssText = 'color:#2e7d32;font-weight:bold;margin-left:6px;';
                    tag.textContent = '✅ 正确答案';
                    optNodes[q.answer].appendChild(tag);
                    const anaEl = box.querySelector('#quiz-ana');
                    anaEl.style.display = 'block';
                    anaEl.innerHTML = `💡 ${q.analysis}`;
                    await new Promise(r => setTimeout(r, 3000));
                    if (parent.contains(mask)) parent.removeChild(mask);
                    sys.showFloatingTip('✅ 正确答案：与电源频率和电机极对数均有关', 1500);
                },
            },
        ],
    },
    'characteristic-test': {
        id: 'characteristic-test',
        name: '3. 三相异步电机特性测试',
        steps: [
            {
                msg: '第 1 步：调出数字功率计，将其电流线圈串联接入 U 相（ac_wire_u → I+ → I- → im01_wire_u1），电压线圈 U+ 短接 I+、U- 接 U2（中性点）。V 相和 W 相直连。',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    const isShow = this._wfMode === 'show';
                    const em = sys.comps['elecmeter'];
                    const motor = sys.comps['im01'];
                    const ac = sys.comps['ac'];
                    const cons = [
                        { from: 'ac_wire_u', to: 'elecmeter_wire_ip', type: 'wire' },
                        { from: 'elecmeter_wire_in', to: 'im01_wire_u1', type: 'wire' },
                        { from: 'elecmeter_wire_up', to: 'elecmeter_wire_ip', type: 'wire' },
                        { from: 'elecmeter_wire_un', to: 'im01_wire_u2', type: 'wire' },
                        { from: 'ac_wire_v', to: 'im01_wire_v1', type: 'wire' },
                        { from: 'ac_wire_w', to: 'im01_wire_w1', type: 'wire' },
                        { from: 'im01_wire_u2', to: 'im01_wire_v2', type: 'wire' },
                        { from: 'im01_wire_u2', to: 'im01_wire_w2', type: 'wire' },
                    ];
                    if (!isShow) {
                        if (em) { em.group.visible(true); em.group.x((em.group.x() || 0) - 200); }
                        sys.conns.length = 0;
                        cons.forEach(c => sys.connMgr.addConn(c));
                        if (motor) motor.loadTorque = 0;
                        if (ac) ac.onConfigUpdate({ vRms: 220, freq: 50, isOn: false, phaseSeq: 'pos' });
                        sys.redrawAll();
                        return;
                    }

                    // 1. 箭头指向“选择仪表”按钮，闪烁 2 次
                    const btn = document.getElementById('btnInstrument');
                    if (btn) {
                        _flashDOM(btn, '点击：打开“选择仪表”菜单', 2);
                        await new Promise(r => setTimeout(r, 2200));
                    }
                    // 2. 调出数字功率计
                    if (em) {
                        sys.toggleInstrumentVisibility('elecmeter', true);
                        sys.showFloatingTip('已调出数字功率计', 1500);
                        // 数字功率计往左移动 200px，防止与电源重叠
                        em.group.x((em.group.x() || 0) - 150);
                        em.group.y((em.group.y() || 0) - 30);
                        await new Promise(r => setTimeout(r, 1200));
                    }
                    if (motor) motor.loadTorque = 0;
                    if (ac) ac.onConfigUpdate({ vRms: 220, freq: 50, isOn: false, phaseSeq: 'pos' });

                    // 3. 删除旧线路（动画）
                    if (sys.conns && sys.conns.length) {
                        await _unwireAnimated(sys, sys.conns.slice());
                    }
                    // 4. 逐条连线动画（电流线圈串联 U 相、电压线圈并联）
                    const labels = [
                        'U 相 → 功率计电流线圈 I+',
                        '电流线圈 I- → 电机 U1',
                        '电压线圈 U+ 短接 I+',
                        '电压线圈 U- 接 U2（中性点）',
                        'V 相直连 V1',
                        'W 相直连 W1',
                        '短接 U2-V2（Y 形）',
                        '短接 U2-W2（Y 形）',
                    ];
                    await _wireAnimated(sys, cons, labels);
                    await new Promise(r => setTimeout(r, 2000));
                },
                check() {
                    const c = (a, b) => this.sys.isPortConnected(a, b);
                    const em = this.sys.comps['elecmeter'];
                    return em && em.group.isVisible()
                        && c('ac_wire_u', 'elecmeter_wire_ip')
                        && c('elecmeter_wire_in', 'im01_wire_u1')
                        && c('elecmeter_wire_up', 'elecmeter_wire_ip')
                        && c('elecmeter_wire_un', 'im01_wire_u2')
                        && c('ac_wire_v', 'im01_wire_v1')
                        && c('ac_wire_w', 'im01_wire_w1')
                        && c('im01_wire_u2', 'im01_wire_v2')
                        && c('im01_wire_u2', 'im01_wire_w2');
                },
            },
            {
                msg: '第 2 步：将负载阻力矩设为 200 N·m（大于起动转矩），接通三相电源（220V/50Hz），电机堵转。观察堵转电流和堵转转矩，二者等于起动瞬间的电流和转矩。',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    const isShow = this._wfMode === 'show';
                    const motor = sys.comps['im01'];
                    const ac = sys.comps['ac'];
                    if (!isShow) {
                        if (motor) motor.loadTorque = 200;
                        if (ac) ac.onConfigUpdate({ vRms: 220, freq: 50, isOn: true, phaseSeq: 'pos' });
                        return;
                    }
                    // 1. 用工具栏转矩滑块设置负载阻力矩 200 N·m（闪烁箭头指向滑块，动态调节）
                    await _animateTorqueSlider(sys, 200, {
                        tip: '设置负载阻力矩 → 200 N·m',
                        steps: 10, speed: 200, wait: 2200,
                    });
                    // 2. 接通三相电源：箭头 + 虚线圈（绕中心）闪烁 3 次，再操作
                    if (ac) {
                        await _blinkN(sys, 'ac', 3, { direction: 'right', tip: '接通三相电源（220V/50Hz）' });
                        ac.onConfigUpdate({ vRms: 220, freq: 50, isOn: true, phaseSeq: 'pos' });
                    }
                    sys.showFloatingTip('电机堵转，观察堵转电流与堵转转矩', 2000);
                    // 3. 设置完成，延时 40s（电流稳定）再到下一步
                    const obs = _flashArrow(sys, 'im01', { direction: 'up', color: '#2ecc71', tip: '观察：电流稳定（堵转电流/转矩）' });
                    await new Promise(r => setTimeout(r, 40000));
                    if (obs) obs.clear();
                },
                check() {
                    const motor = this.sys.comps['im01'];
                    const ac = this.sys.comps['ac'];
                    return motor && ac && motor.loadTorque >= 200 && ac.isOn;
                },
            },
            {
                msg: '第 3 步：空载实验。将负载阻力矩调为 0 N·m，记录面板显示的空载电流、空载转速。',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    const isShow = this._wfMode === 'show';
                    const motor = sys.comps['im01'];
                    if (!isShow) {
                        if (motor) motor.loadTorque = 0;
                        const slider = document.getElementById('torqueSlider');
                        if (slider) { slider.value = '0'; slider.dispatchEvent(new Event('input')); }
                        return;
                    }
                    // 设置负载力矩 0 N・m（动态显示参数修改过程）
                    await _animateTorqueSlider(sys, 0, {
                        tip: '空载实验：负载阻力矩 → 0 N·m',
                        steps: 6, speed: 220, wait: 2200,
                    });
                    sys.showFloatingTip('空载：记录空载电流、空载转速', 2000);
                    // 等待 70s，电流稳定
                    const obs = _flashArrow(sys, 'im01', { direction: 'up', color: '#2ecc71', tip: '观察：电流稳定（空载运行）' });
                    await new Promise(r => setTimeout(r, 70000));
                    if (obs) obs.clear();
                },
                check() {
                    const motor = this.sys.comps['im01'];
                    return motor && Math.abs(motor.loadTorque) < 0.01;
                },
            },
            {
                msg: '第 4 步：额定负载实验。将负载转矩设为 67 N·m，记录面板显示的额定电流、额定转速、额定转矩。',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    const isShow = this._wfMode === 'show';
                    const motor = sys.comps['im01'];
                    if (!isShow) {
                        if (motor) motor.loadTorque = 67;
                        const slider = document.getElementById('torqueSlider');
                        if (slider) { slider.value = '67'; slider.dispatchEvent(new Event('input')); }
                        return;
                    }
                    // 设置负载转矩 67 N・m（动态显示参数修改过程）
                    await _animateTorqueSlider(sys, 67, {
                        tip: '额定负载实验：负载转矩 → 67 N·m',
                        steps: 8, speed: 200, wait: 2200,
                    });
                    sys.showFloatingTip('额定负载：记录额定电流/转速/转矩', 2000);
                    // 等待 50s，电流稳定
                    const obs = _flashArrow(sys, 'im01', { direction: 'up', color: '#2ecc71', tip: '观察：电流稳定（额定运行）' });
                    await new Promise(r => setTimeout(r, 50000));
                    if (obs) obs.clear();
                },
                check() {
                    const motor = this.sys.comps['im01'];
                    return motor && Math.abs(motor.loadTorque - 67) < 0.5;
                },
            },
            {
                msg: '第 5 步：过载能力测试。将负载转矩设为 160 N·m（略小于最大转矩约 165 N·m），观察异步电机仍能稳定运行，体现其过载能力。',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    const isShow = this._wfMode === 'show';
                    const motor = sys.comps['im01'];
                    if (!isShow) {
                        if (motor) motor.loadTorque = 160;
                        const slider = document.getElementById('torqueSlider');
                        if (slider) { slider.value = '160'; slider.dispatchEvent(new Event('input')); }
                        return;
                    }
                    // 设置负载转矩 160 N・m（动态显示参数修改过程）
                    await _animateTorqueSlider(sys, 160, {
                        tip: '过载能力测试：负载转矩 → 160 N·m',
                        steps: 10, speed: 180, wait: 2200,
                    });
                    sys.showFloatingTip('过载运行：电机仍能稳定运行', 2000);
                    // 等待 60s，电流稳定
                    const obs = _flashArrow(sys, 'im01', { direction: 'up', color: '#2ecc71', tip: '观察：电流稳定（过载运行）' });
                    await new Promise(r => setTimeout(r, 60000));
                    if (obs) obs.clear();
                },
                check() {
                    const motor = this.sys.comps['im01'];
                    return motor && Math.abs(motor.loadTorque - 160) < 3;
                },
            },
            {
                msg: '第 6 步：加负载至超过最大转矩。将负载转矩设为 200 N·m（超过最大转矩），观察电机转速迅速下降直至运行中堵转。',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    const isShow = this._wfMode === 'show';
                    const motor = sys.comps['im01'];
                    if (!isShow) {
                        if (motor) motor.loadTorque = 200;
                        const slider = document.getElementById('torqueSlider');
                        if (slider) { slider.value = '200'; slider.dispatchEvent(new Event('input')); }
                        return;
                    }
                    // 设置负载转矩 200 N・m（动态显示参数修改过程）
                    await _animateTorqueSlider(sys, 200, {
                        tip: '加负载至超过最大转矩：负载转矩 → 200 N·m',
                        steps: 10, speed: 180, wait: 2200,
                    });
                    sys.showFloatingTip('超过最大转矩，转速下降直至堵转', 2000);
                    // 等待 60s，电流稳定
                    const obs = _flashArrow(sys, 'im01', { direction: 'up', color: '#e74c3c', tip: '观察：转速迅速下降直至堵转' });
                    await new Promise(r => setTimeout(r, 70000));
                    if (obs) obs.clear();
                },
                check() {
                    const motor = this.sys.comps['im01'];
                    return motor && Math.abs(motor.loadTorque - 198) < 3;
                },
            },
            {
                msg: '第 7 步：特性测试知识',
                mode: 'quiz',
                quizConfig: {
                    question: '三相异步电动机的堵转电流（起动电流）约为额定电流的多少倍？',
                    options: [
                        '1~2 倍',
                        '4~7 倍',
                        '10~15 倍',
                        '20 倍以上',
                    ],
                    answer: 1,
                    analysis: '起动瞬间转子转速为零，转差率 s=1，转子电路阻抗很小，因此堵转（起动）电流可达额定电流的 4~7 倍。堵转转矩即为起动转矩，通常为额定转矩的 1~2 倍。空载时电流主要为励磁分量，功率因数很低。',
                },
                async act() {
                    const sys = this.sys;
                    const q = {
                        question: '三相异步电动机的堵转电流（起动电流）约为额定电流的多少倍？',
                        options: ['1~2 倍', '4~7 倍', '10~15 倍', '20 倍以上'],
                        answer: 1,
                        analysis: '起动瞬间转子转速为零，转差率 s=1，转子电路阻抗很小，因此堵转（起动）电流可达额定电流的 4~7 倍。堵转转矩即为起动转矩，通常为额定转矩的 1~2 倍。空载时电流主要为励磁分量，功率因数很低。',
                    };
                    const parent = sys.container;
                    const mask = document.createElement('div');
                    Object.assign(mask.style, {
                        position: 'absolute', top: '0', left: '0', width: '100%', height: '100%',
                        background: 'rgba(0,0,0,0.55)', zIndex: '100',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'sans-serif',
                    });
                    const box = document.createElement('div');
                    Object.assign(box.style, {
                        background: '#fff', width: '88%', maxWidth: '520px', borderRadius: '12px',
                        padding: '20px', boxShadow: '0 8px 20px rgba(0,0,0,0.3)',
                    });
                    const letters = ['A', 'B', 'C', 'D'];
                    let html = `
                        <div style="color:#1395eb;font-size:15px;font-weight:bold;margin-bottom:4px;">[单选题]</div>
                        <div style="font-weight:bold;margin-bottom:14px;line-height:1.4;">${q.question}</div>`;
                    q.options.forEach((text, i) => {
                        html += `
                        <div data-opt="${i}" style="margin:6px 0;padding:10px 12px;border:2px solid #ddd;
                             border-radius:8px;background:#fcfcfc;font-size:15px;">
                            <span style="font-weight:bold;margin-right:8px;color:#1395eb;">${letters[i]}</span>${text}
                        </div>`;
                    });
                    html += `<div id="quiz-ana" style="display:none;margin-top:14px;padding:12px;font-size:13px;background:#f1f8e9;border-left:4px solid #4caf50;border-radius:4px;color:#555;line-height:1.5;"></div>`;
                    box.innerHTML = html;
                    mask.appendChild(box);
                    parent.appendChild(mask);
                    // 先停留 3s，让学员阅读题目
                    await new Promise(r => setTimeout(r, 3000));
                    // 突出显示正确答案
                    const optNodes = box.querySelectorAll('[data-opt]');
                    optNodes[q.answer].style.borderColor = '#4caf50';
                    optNodes[q.answer].style.background = '#e8f5e9';
                    const tag = document.createElement('span');
                    tag.style.cssText = 'color:#2e7d32;font-weight:bold;margin-left:6px;';
                    tag.textContent = '✅ 正确答案';
                    optNodes[q.answer].appendChild(tag);
                    const anaEl = box.querySelector('#quiz-ana');
                    anaEl.style.display = 'block';
                    anaEl.innerHTML = `💡 ${q.analysis}`;
                    // 再停留 3s
                    await new Promise(r => setTimeout(r, 3000));
                    if (parent.contains(mask)) parent.removeChild(mask);
                    sys.showFloatingTip('✅ 正确答案：4~7 倍', 1500);
                },
            },
        ],
    },

    'starting-params': {
        id: 'starting-params',
        name: '4. 三相异步电机起动方法',
        steps: [
            {
                msg: '第 1 步：调出数字功率计，串联接入 U 相（ac_wire_u → I+ → I- → im01_wire_u1），电压线圈 U+ 短接 I+、U- 接 U2。V 相和 W 相直连，Y 形接法。',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    const isShow = this._wfMode === 'show';
                    const em = sys.comps['elecmeter'];
                    const motor = sys.comps['im01'];
                    const ac = sys.comps['ac'];
                    const cons = [
                        { from: 'ac_wire_u', to: 'elecmeter_wire_ip', type: 'wire' },
                        { from: 'elecmeter_wire_in', to: 'im01_wire_u1', type: 'wire' },
                        { from: 'elecmeter_wire_up', to: 'elecmeter_wire_ip', type: 'wire' },
                        { from: 'elecmeter_wire_un', to: 'im01_wire_u2', type: 'wire' },
                        { from: 'ac_wire_v', to: 'im01_wire_v1', type: 'wire' },
                        { from: 'ac_wire_w', to: 'im01_wire_w1', type: 'wire' },
                        { from: 'im01_wire_u2', to: 'im01_wire_v2', type: 'wire' },
                        { from: 'im01_wire_u2', to: 'im01_wire_w2', type: 'wire' },
                    ];
                    if (!isShow) {
                        if (em) { em.group.visible(true); em.group.x((em.group.x() || 0) - 200); }
                        sys.conns.length = 0;
                        cons.forEach(c => sys.connMgr.addConn(c));
                        if (motor) motor.loadTorque = 0;
                        if (ac) ac.onConfigUpdate({ vRms: 220, freq: 50, isOn: false, phaseSeq: 'pos' });
                        sys.redrawAll();
                        return;
                    }
                    // 1. 箭头指向“选择仪表”按钮，闪烁 2 次
                    const btn = document.getElementById('btnInstrument');
                    if (btn) {
                        _flashDOM(btn, '点击：打开“选择仪表”菜单', 2);
                        await new Promise(r => setTimeout(r, 2200));
                    }
                    // 2. 调出数字功率计，并往左移动 150px 防止与电源重叠
                    if (em) {
                        sys.toggleInstrumentVisibility('elecmeter', true);
                        sys.showFloatingTip('已调出数字功率计', 1500);
                        em.group.x((em.group.x() || 0) - 150);
                        em.group.y((em.group.y() || 0) - 30);                        

                        await new Promise(r => setTimeout(r, 1200));
                    }
                    if (motor) motor.loadTorque = 0;
                    if (ac) ac.onConfigUpdate({ vRms: 220, freq: 50, isOn: false, phaseSeq: 'pos' });
                    // 3. 删除旧线路（动画）
                    if (sys.conns && sys.conns.length) {
                        await _unwireAnimated(sys, sys.conns.slice());
                    }
                    // 4. 逐条连线动画（Y 形接法：电流线圈串联 U 相）
                    const labels = [
                        'U 相 → 功率计电流线圈 I+',
                        '电流线圈 I- → 电机 U1',
                        '电压线圈 U+ 短接 I+',
                        '电压线圈 U- 接 U2（中性点）',
                        'V 相直连 V1',
                        'W 相直连 W1',
                        '短接 U2-V2（Y 形）',
                        '短接 U2-W2（Y 形）',
                    ];
                    await _wireAnimated(sys, cons, labels);
                    await new Promise(r => setTimeout(r, 1500));
                },
                check() {
                    const c = (a, b) => this.sys.isPortConnected(a, b);
                    const em = this.sys.comps['elecmeter'];
                    return em && em.group.isVisible()
                        && c('ac_wire_u', 'elecmeter_wire_ip')
                        && c('elecmeter_wire_in', 'im01_wire_u1')
                        && c('elecmeter_wire_up', 'elecmeter_wire_ip')
                        && c('elecmeter_wire_un', 'im01_wire_u2')
                        && c('ac_wire_v', 'im01_wire_v1')
                        && c('ac_wire_w', 'im01_wire_w1')
                        && c('im01_wire_u2', 'im01_wire_v2')
                        && c('im01_wire_u2', 'im01_wire_w2');
                },
            },
            {
                msg: '第 2 步：将负载阻力矩设为 200 N·m（堵转），接通三相电源（220V/50Hz），观察面板显示的起动电流和起动转矩。',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    const isShow = this._wfMode === 'show';
                    const ac = sys.comps['ac'];
                    if (!isShow) {
                        const motor = sys.comps['im01'];
                        if (motor) motor.loadTorque = 200;
                        if (ac) ac.onConfigUpdate({ vRms: 220, freq: 50, isOn: true, phaseSeq: 'pos' });
                        return;
                    }
                    // 1. 用工具栏转矩滑块设置负载阻力矩 200 N·m（闪烁箭头指向滑块，动态调节）
                    await _animateTorqueSlider(sys, 200, {
                        tip: '设置负载阻力矩 → 200 N·m',
                        steps: 10, speed: 200, wait: 2200,
                    });
                    // 2. 接通三相电源：箭头 + 虚线圈（绕中心）闪烁 3 次，再操作
                    if (ac) {
                        await _blinkN(sys, 'ac', 3, { direction: 'right', tip: '接通三相电源（220V/50Hz）' });
                        ac.onConfigUpdate({ vRms: 220, freq: 50, isOn: true, phaseSeq: 'pos' });
                    }
                    sys.showFloatingTip('电机堵转，观察起动电流与起动转矩', 2000);
                    // 3. 等待 40s，电流稳定后再进入下一步
                    const obs = _flashArrow(sys, 'im01', { direction: 'up', color: '#2ecc71', tip: '观察：起动电流与起动转矩' });
                    await new Promise(r => setTimeout(r, 40000));
                    if (obs) obs.clear();
                },
                check() {
                    const motor = this.sys.comps['im01'];
                    const ac = this.sys.comps['ac'];
                    return motor && ac && motor.loadTorque >= 200 && ac.isOn;
                },
            },
            {
                msg: '第 3 步：将电压降至 110V（保持 50Hz），观察电流和转矩的变化。降压会减小起动电流和起动转矩。',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    const isShow = this._wfMode === 'show';
                    const ac = sys.comps['ac'];
                    if (!isShow) {
                        if (ac) ac.onConfigUpdate({ vRms: 110, freq: 50 });
                        return;
                    }
                    // 调出三相电源参数设置界面，动态降压至 110V
                    await _blinkN(sys, 'ac', 2, { direction: 'right', tip: '调节三相电源电压参数' });
                    await _setDialogParam(sys, 'ac', 'vRms', 110, {
                        tip: '相电压 220 → 110 V（降压起动）',
                        steps: 12, speed: 180,
                    });
                    sys.showFloatingTip('降压 110V，起动电流与起动转矩减小', 2000);
                    // 等待 50s，电流稳定后再进入下一步
                    const obs = _flashArrow(sys, 'im01', { direction: 'up', color: '#2ecc71', tip: '观察：电流与转矩变化' });
                    await new Promise(r => setTimeout(r, 50000));
                    if (obs) obs.clear();
                },
                check() {
                    const ac = this.sys.comps['ac'];
                    return ac && ac.isOn && Math.abs(ac.vRms - 110) < 2;
                },
            },
            {
                msg: '第 4 步：关闭电源，将负载力矩改为 400 N·m，将接法由 Y 形改为 Δ 形（U1-W2、V1-U2、W1-V2），重新接通电源（220V/50Hz），观察电流和转矩的变化。',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    const isShow = this._wfMode === 'show';
                    const ac = sys.comps['ac'];
                    const motor = sys.comps['im01'];
                    if (!isShow) {
                        if (ac) ac.onConfigUpdate({ isOn: false });
                        if (motor) motor.loadTorque = 400;
                        sys.conns.length = 0;
                        const cons = [
                            { from: 'ac_wire_u', to: 'elecmeter_wire_ip', type: 'wire' },
                            { from: 'elecmeter_wire_in', to: 'im01_wire_u1', type: 'wire' },
                            { from: 'elecmeter_wire_up', to: 'elecmeter_wire_ip', type: 'wire' },
                            { from: 'elecmeter_wire_un', to: 'im01_wire_u2', type: 'wire' },
                            { from: 'ac_wire_v', to: 'im01_wire_v1', type: 'wire' },
                            { from: 'ac_wire_w', to: 'im01_wire_w1', type: 'wire' },
                            { from: 'im01_wire_u1', to: 'im01_wire_w2', type: 'wire' },
                            { from: 'im01_wire_v1', to: 'im01_wire_u2', type: 'wire' },
                            { from: 'im01_wire_w1', to: 'im01_wire_v2', type: 'wire' },
                        ];
                        cons.forEach(c => sys.connMgr.addConn(c));
                        if (ac) ac.onConfigUpdate({ isOn: true, vRms: 220, freq: 50 });
                        sys.redrawAll();
                        return;
                    }
                    // 1. 关闭电源
                    if (ac) {
                        await _blinkN(sys, 'ac', 2, { direction: 'right', tip: '关闭三相电源，准备改接 Δ 形' });
                        ac.onConfigUpdate({ isOn: false });
                        await new Promise(r => setTimeout(r, 400));
                    }
                    // 2. 将负载力矩改为 400 N·m（电机参数对话框）
                    await _blinkN(sys, 'im01', 2, { direction: 'up', tip: '调节负载力矩参数' });
                    await _setDialogParam(sys, 'im01', 'loadTorque', 400, {
                        tip: '负载力矩 200 → 400 N·m',
                        steps: 12, speed: 170,
                    });
                    // 3. 删除两条 Y 形短接线（动画）
                    sys.showFloatingTip('拆除 Y 形短接线 U2-V2、U2-W2', 1600);
                    await _unwireAnimated(sys, [
                        { from: 'im01_wire_u2', to: 'im01_wire_v2', type: 'wire' },
                        { from: 'im01_wire_u2', to: 'im01_wire_w2', type: 'wire' },
                    ]);
                    await new Promise(r => setTimeout(r, 400));
                    // 4. 连接 Δ 形（动画）：U1-W2、V1-U2、W1-V2
                    sys.showFloatingTip('改接 Δ 形：U1-W2、V1-U2、W1-V2', 2000);
                    await _wireAnimated(sys, [
                        { from: 'im01_wire_u1', to: 'im01_wire_w2', type: 'wire' },
                        { from: 'im01_wire_v1', to: 'im01_wire_u2', type: 'wire' },
                        { from: 'im01_wire_w1', to: 'im01_wire_v2', type: 'wire' },
                    ], ['U1 - W2（Δ）', 'V1 - U2（Δ）', 'W1 - V2（Δ）']);
                    // 5. 重新接通电源（箭头 + 虚线圈绕中心闪烁 3 次）
                    if (ac) {
                        await _blinkN(sys, 'ac', 3, { direction: 'right', tip: '重新接通三相电源（220V/50Hz）' });
                        ac.onConfigUpdate({ isOn: true, vRms: 220, freq: 50 });
                    }
                    sys.showFloatingTip('Δ 形接法（400 N·m），观察电流与转矩变化', 2000);
                    // 6. 等待 40s，电流稳定后再进入下一步
                    const obs = _flashArrow(sys, 'im01', { direction: 'up', color: '#2ecc71', tip: '观察：Y → Δ 后电流与转矩变化' });
                    await new Promise(r => setTimeout(r, 40000));
                    if (obs) obs.clear();
                },
                check() {
                    const c = (a, b) => this.sys.isPortConnected(a, b);
                    const dOk = c('im01_wire_u1', 'im01_wire_w2')
                            && c('im01_wire_v1', 'im01_wire_u2')
                            && c('im01_wire_w1', 'im01_wire_v2');
                    const noY = !this.sys.isPortConnected('im01_wire_u2', 'im01_wire_v2');
                    const ac = this.sys.comps['ac'];
                    const motor = this.sys.comps['im01'];
                    return dOk && noY && ac && ac.isOn && motor && motor.loadTorque >= 400;
                },
            },
            {
                msg: '第 5 步：将接法还原成Y形（U2-V2、U2-W2），将频率降至 40Hz，电压等比例降至 176V（保持 V/f 比恒定），观察电流和转矩的变化。',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    const isShow = this._wfMode === 'show';
                    const ac = sys.comps['ac'];
                    if (!isShow) {
                        // 还原 Δ → Y：拆除 Δ 三条线，短接 U2-V2、U2-W2
                        sys.conns = sys.conns.filter(c => !(
                            (c.from === 'im01_wire_u1' && c.to === 'im01_wire_w2') ||
                            (c.from === 'im01_wire_w2' && c.to === 'im01_wire_u1') ||
                            (c.from === 'im01_wire_v1' && c.to === 'im01_wire_u2') ||
                            (c.from === 'im01_wire_u2' && c.to === 'im01_wire_v1') ||
                            (c.from === 'im01_wire_w1' && c.to === 'im01_wire_v2') ||
                            (c.from === 'im01_wire_v2' && c.to === 'im01_wire_w1')
                        ));
                        sys.connMgr.addConn({ from: 'im01_wire_u2', to: 'im01_wire_v2', type: 'wire' });
                        sys.connMgr.addConn({ from: 'im01_wire_u2', to: 'im01_wire_w2', type: 'wire' });
                        sys.redrawAll();
                        if (ac) ac.onConfigUpdate({ freq: 40, vRms: 176 });
                        return;
                    }
                    // 1. 动画拆除 Δ 三条线
                    sys.showFloatingTip('拆除 Δ 形接线', 1600);
                    await _unwireAnimated(sys, [
                        { from: 'im01_wire_u1', to: 'im01_wire_w2', type: 'wire' },
                        { from: 'im01_wire_v1', to: 'im01_wire_u2', type: 'wire' },
                        { from: 'im01_wire_w1', to: 'im01_wire_v2', type: 'wire' },
                    ]);
                    await new Promise(r => setTimeout(r, 400));
                    // 2. 动画还原 Y 形短接线
                    sys.showFloatingTip('还原 Y 形短接线：U2-V2、U2-W2', 2000);
                    await _wireAnimated(sys, [
                        { from: 'im01_wire_u2', to: 'im01_wire_v2', type: 'wire' },
                        { from: 'im01_wire_u2', to: 'im01_wire_w2', type: 'wire' },
                    ], ['短接 U2-V2（Y 形）', '短接 U2-W2（Y 形）']);
                    await new Promise(r => setTimeout(r, 20000));

                    // 3. 频率 50 → 40 Hz + 电压等比例降为 176 V
                    await _blinkN(sys, 'ac', 2, { direction: 'right', tip: '调节频率与电压（保持 V/f 恒定）' });
                    await _setDialogParam(sys, 'ac', 'freq', 40, {
                        tip: '频率 50 → 40 Hz',
                        steps: 10, speed: 180,
                    });
                    await _setDialogParam(sys, 'ac', 'vRms', 176, {
                        tip: '电压等比例降为 176 V',
                        steps: 10, speed: 180,
                    });
                    sys.showFloatingTip('Y 形接法 + V/f 恒定：观察电流与转矩变化', 2000);
                    // 等待 40s，电流稳定后再进入下一步
                    const obs = _flashArrow(sys, 'im01', { direction: 'up', color: '#2ecc71', tip: '观察：Y 形 + V/f 恒定后电流与转矩变化' });
                    await new Promise(r => setTimeout(r, 40000));
                    if (obs) obs.clear();
                },
                check() {
                    const c = (a, b) => this.sys.isPortConnected(a, b);
                    const ac = this.sys.comps['ac'];
                    const noDelta = !c('im01_wire_u1', 'im01_wire_w2')
                                 && !c('im01_wire_v1', 'im01_wire_u2');
                    const hasY = c('im01_wire_u2', 'im01_wire_v2')
                              && c('im01_wire_u2', 'im01_wire_w2');
                    return ac && ac.isOn && hasY && noDelta
                        && Math.abs(ac.freq - 40) < 0.5 && Math.abs(ac.vRms - 176) < 2;
                },
            },
            {
                msg: '第 6 步：还原电压 220V、频率 50Hz，将转子电阻 R₂ 由 0.46Ω 增大至 0.92Ω，观察电流和转矩的变化。增大转子电阻可减小起动电流、增大起动转矩。',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    const isShow = this._wfMode === 'show';
                    const ac = sys.comps['ac'];
                    const motor = sys.comps['im01'];
                    if (!isShow) {
                        if (ac) ac.onConfigUpdate({ vRms: 220, freq: 50 });
                        if (motor) motor.onConfigUpdate({ R2: 0.92 });
                        return;
                    }
                    // 1. 还原电压 220V（三相电源参数对话框）
                    await _blinkN(sys, 'ac', 2, { direction: 'right', tip: '还原电压与频率' });
                    await _setDialogParam(sys, 'ac', 'vRms', 220, {
                        tip: '电压 176 → 220 V',
                        steps: 10, speed: 170,
                    });
                    await _setDialogParam(sys, 'ac', 'freq', 50, {
                        tip: '频率 40 → 50 Hz',
                        steps: 10, speed: 170,
                    });
                    await new Promise(r => setTimeout(r, 20000));
                    // 2. 调出电机参数设置界面，动态增大转子电阻 R₂
                    await _blinkN(sys, 'im01', 2, { direction: 'up', tip: '调节转子电阻参数' });
                    await _setDialogParam(sys, 'im01', 'R2', 0.92, {
                        tip: '转子电阻 R₂ 0.46 → 0.92 Ω',
                        steps: 10, speed: 200,
                    });
                    sys.showFloatingTip('增大 R₂：起动电流减小、起动转矩增大', 2000);
                    // 等待 40s，电流稳定后再进入下一步
                    const obs = _flashArrow(sys, 'im01', { direction: 'up', color: '#2ecc71', tip: '观察：电流与转矩变化' });
                    await new Promise(r => setTimeout(r, 40000));
                    if (obs) obs.clear();
                },
                check() {
                    const ac = this.sys.comps['ac'];
                    const motor = this.sys.comps['im01'];
                    return motor && Math.abs(motor.R2 - 0.92) < 0.01
                        && ac && ac.isOn
                        && Math.abs(ac.vRms - 220) < 2
                        && Math.abs(ac.freq - 50) < 0.5;
                },
            },
            {
                msg: '第 7 步：起动参数知识',
                mode: 'quiz',
                quizConfig: {
                    question: '增大转子电阻 R₂ 对三相异步电动机起动性能有何影响？',
                    options: [
                        '起动电流减小，起动转矩增大',
                        '起动电流增大，起动转矩减小',
                        '起动电流和起动转矩均增大',
                        '起动电流和起动转矩均减小',
                    ],
                    answer: 0,
                    analysis: '增大 R₂ 使转子回路总阻抗增加，起动电流减小；同时临界转差率 sₘ = R₂ / (X₁+X₂) 增大，使起动点（s=1）更靠近最大转矩点，因此起动转矩增大。绕线式异步电机正是利用这一原理，通过在转子回路串电阻来改善起动性能。',
                },
                async act() {
                    const sys = this.sys;
                    const q = {
                        question: '增大转子电阻 R₂ 对三相异步电动机起动性能有何影响？',
                        options: ['起动电流减小，起动转矩增大', '起动电流增大，起动转矩减小', '起动电流和起动转矩均增大', '起动电流和起动转矩均减小'],
                        answer: 0,
                        analysis: '增大 R₂ 使转子回路总阻抗增加，起动电流减小；同时临界转差率 sₘ = R₂ / (X₁+X₂) 增大，使起动点（s=1）更靠近最大转矩点，因此起动转矩增大。绕线式异步电机正是利用这一原理，通过在转子回路串电阻来改善起动性能。',
                    };
                    const parent = sys.container;
                    const mask = document.createElement('div');
                    Object.assign(mask.style, {
                        position: 'absolute', top: '0', left: '0', width: '100%', height: '100%',
                        background: 'rgba(0,0,0,0.55)', zIndex: '100',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'sans-serif',
                    });
                    const box = document.createElement('div');
                    Object.assign(box.style, {
                        background: '#fff', width: '88%', maxWidth: '520px', borderRadius: '12px',
                        padding: '20px', boxShadow: '0 8px 20px rgba(0,0,0,0.3)',
                    });
                    const letters = ['A', 'B', 'C', 'D'];
                    let html = `
                        <div style="color:#1395eb;font-size:15px;font-weight:bold;margin-bottom:4px;">[单选题]</div>
                        <div style="font-weight:bold;margin-bottom:14px;line-height:1.4;">${q.question}</div>`;
                    q.options.forEach((text, i) => {
                        html += `
                        <div data-opt="${i}" style="margin:6px 0;padding:10px 12px;border:2px solid #ddd;
                             border-radius:8px;background:#fcfcfc;font-size:15px;">
                            <span style="font-weight:bold;margin-right:8px;color:#1395eb;">${letters[i]}</span>${text}
                        </div>`;
                    });
                    html += `<div id="quiz-ana" style="display:none;margin-top:14px;padding:12px;font-size:13px;background:#f1f8e9;border-left:4px solid #4caf50;border-radius:4px;color:#555;line-height:1.5;"></div>`;
                    box.innerHTML = html;
                    mask.appendChild(box);
                    parent.appendChild(mask);
                    // 先停留 3s，让学员阅读题目
                    await new Promise(r => setTimeout(r, 3000));
                    // 突出显示正确答案
                    const optNodes = box.querySelectorAll('[data-opt]');
                    optNodes[q.answer].style.borderColor = '#4caf50';
                    optNodes[q.answer].style.background = '#e8f5e9';
                    const tag = document.createElement('span');
                    tag.style.cssText = 'color:#2e7d32;font-weight:bold;margin-left:6px;';
                    tag.textContent = '✅ 正确答案';
                    optNodes[q.answer].appendChild(tag);
                    const anaEl = box.querySelector('#quiz-ana');
                    anaEl.style.display = 'block';
                    anaEl.innerHTML = `💡 ${q.analysis}`;
                    // 再停留 3s
                    await new Promise(r => setTimeout(r, 3000));
                    if (parent.contains(mask)) parent.removeChild(mask);
                    sys.showFloatingTip('✅ 正确答案：起动电流减小，起动转矩增大', 1500);
                },
            },
        ],
    },

    'speed-control': {
        id: 'speed-control',
        name: '5. 三相异步电机调速方法',
        steps: [
            {
                msg: '第 1 步：接线（Y 形），设置风机型负载，起动电机（220V/50Hz），观察稳定转速。风机负载阻力矩随转速升高而增大。',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    const isShow = this._wfMode === 'show';
                    const motor = sys.comps['im01'];
                    const ac = sys.comps['ac'];
                    if (!isShow) {
                        _autoWire(sys, 'speed-control');
                        motor.loadType = 'fan';
                        motor.fanK = calcFanK(motor);
                        if (ac) ac.onConfigUpdate({ vRms: 220, freq: 50, isOn: true, phaseSeq: 'pos' });
                        return;
                    }
                    // 1. 动画接线（Y 形）
                    sys.conns.length = 0;
                    sys.showFloatingTip('Y 形接线，连好三相电源', 1600);
                    await _wireAnimated(sys, [
                        { from: 'ac_wire_u', to: 'im01_wire_u1', type: 'wire' },
                        { from: 'ac_wire_v', to: 'im01_wire_v1', type: 'wire' },
                        { from: 'ac_wire_w', to: 'im01_wire_w1', type: 'wire' },
                        { from: 'im01_wire_u2', to: 'im01_wire_v2', type: 'wire' },
                        { from: 'im01_wire_u2', to: 'im01_wire_w2', type: 'wire' },
                    ], ['U → U1', 'V → V1', 'W → W1', '短接 U2-V2（Y 形）', '短接 U2-W2（Y 形）']);
                    if (ac) ac.onConfigUpdate({ vRms: 220, freq: 50, isOn: false, phaseSeq: 'pos' });
                    // 2. 切换负载性质为“风机型”（闪烁箭头指向下拉框）
                    const sel = document.getElementById('loadTypeSelect');
                    if (sel) {
                        const h = _flashDOMArrow(sel, '切换负载性质 → 风机型', 2);
                        await new Promise(r => setTimeout(r, 2200));
                        if (h) h.clear();
                        sel.value = 'fan';
                        sel.dispatchEvent(new Event('change'));
                    }
                    motor.loadType = 'fan';
                    motor.fanK = calcFanK(motor);
                    // 3. 起动电机
                    if (ac) {
                        await _blinkN(sys, 'ac', 3, { direction: 'right', tip: '接通三相电源，起动电机（220V/50Hz）' });
                        ac.onConfigUpdate({ vRms: 220, freq: 50, isOn: true, phaseSeq: 'pos' });
                    }
                    sys.showFloatingTip('风机负载：阻力矩随转速升高而增大', 2000);
                    // 4. 等待转速稳定（风机负载稳定点较高）
                    const obs = _flashArrow(sys, 'im01', { direction: 'up', color: '#2ecc71', tip: '观察：电机稳定转速' });
                    await new Promise(r => setTimeout(r, 70000));
                    if (obs) obs.clear();
                },
                check() {
                    const ac = this.sys.comps['ac'];
                    const motor = this.sys.comps['im01'];
                    return ac && ac.isOn && motor && motor.loadType === 'fan';
                },
            },
            {
                msg: '第 2 步：将电压降至 160 V（保持频率 50Hz），观察转速变化。降压调速属于变转差率调速，转差功率损耗大、效率低。',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    const isShow = this._wfMode === 'show';
                    const ac = sys.comps['ac'];
                    if (!isShow) {
                        if (ac) ac.onConfigUpdate({ vRms: 160 });
                        return;
                    }
                    // 调出三相电源参数设置界面，动态降压至 160V
                    await _blinkN(sys, 'ac', 2, { direction: 'right', tip: '调节三相电源电压参数' });
                    await _setDialogParam(sys, 'ac', 'vRms', 160, {
                        tip: '相电压 220 → 160 V（降压调速）',
                        steps: 12, speed: 170,
                    });
                    sys.showFloatingTip('降压调速：转速下降（变转差率调速，损耗大）', 2000);
                    // 等待转速稳定
                    const obs = _flashArrow(sys, 'im01', { direction: 'up', color: '#2ecc71', tip: '观察：转速变化' });
                    await new Promise(r => setTimeout(r, 50000));
                    if (obs) obs.clear();
                },
                check() {
                    const ac = this.sys.comps['ac'];
                    return ac && ac.isOn && Math.abs(ac.vRms - 160) < 2;
                },
            },
            {
                msg: '第 3 步：恢复电压 220V，切换为恒转矩负载（约 60 N·m），将转子电阻 R₂ 由 0.46Ω 增大至 1.46Ω，观察转速变化。转子串电阻调速仅适用于绕线式异步电机，属于变转差率调速。',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    const isShow = this._wfMode === 'show';
                    const ac = sys.comps['ac'];
                    const motor = sys.comps['im01'];
                    if (!isShow) {
                        if (ac) ac.onConfigUpdate({ vRms: 220 });
                        motor.loadType = 'constant';
                        motor.loadTorque = 60;
                        motor.onConfigUpdate({ R2: 1.46 });
                        return;
                    }
                    // 1. 恢复电压 220V（参数对话框）
                    await _blinkN(sys, 'ac', 2, { direction: 'right', tip: '恢复相电压至 220 V' });
                    await _setDialogParam(sys, 'ac', 'vRms', 220, {
                        tip: '相电压恢复 220 V',
                        steps: 12, speed: 170,
                    });
                    // 2. 切换负载性质为“恒转矩”
                    const sel = document.getElementById('loadTypeSelect');
                    if (sel) {
                        const h = _flashDOMArrow(sel, '切换负载性质 → 恒转矩', 2);
                        await new Promise(r => setTimeout(r, 2200));
                        if (h) h.clear();
                        sel.value = 'constant';
                        sel.dispatchEvent(new Event('change'));
                    }
                    // 3. 负载转矩滑块 → 60 N·m
                    await _animateTorqueSlider(sys, 60, {
                        tip: '设置恒转矩负载 → 60 N·m',
                        steps: 8, speed: 180, wait: 2000,
                    });
                    await new Promise(r => setTimeout(r, 40000));
                    // 4. 转子电阻 R₂ 0.46 → 1.46 Ω（电机参数对话框）
                    await _blinkN(sys, 'im01', 2, { direction: 'up', tip: '调节转子电阻参数' });
                    await _setDialogParam(sys, 'im01', 'R2', 1.46, {
                        tip: '转子电阻 R₂ 0.46 → 1.46 Ω',
                        steps: 10, speed: 190,
                    });
                    sys.showFloatingTip('转子串电阻调速：转速下降（仅限绕线式电机）', 2000);
                    // 5. 等待转速稳定
                    const obs = _flashArrow(sys, 'im01', { direction: 'up', color: '#2ecc71', tip: '观察：转速变化' });
                    await new Promise(r => setTimeout(r, 40000));
                    if (obs) obs.clear();
                },
                check() {
                    const motor = this.sys.comps['im01'];
                    const ac = this.sys.comps['ac'];
                    return ac && ac.isOn && motor
                        && motor.loadType === 'constant'
                        && Math.abs(motor.loadTorque - 60) < 3
                        && Math.abs(motor.R2 - 1.46) < 0.2;
                },
            },
            {
                msg: '第 4 步：恢复转子电阻 R₂ 为 0.46Ω，将磁极对数由 2 变为 4，观察转速变化。变极调速通过改变定子绕组接法改变极对数，实现有级调速，仅适用于笼式异步电机。',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    const isShow = this._wfMode === 'show';
                    const motor = sys.comps['im01'];
                    if (!isShow) {
                        motor.onConfigUpdate({ R2: 0.46, polePairs: 4 });
                        return;
                    }
                    // 1. 恢复转子电阻 R₂ 0.46 Ω
                    await _blinkN(sys, 'im01', 2, { direction: 'up', tip: '恢复转子电阻参数' });
                    await _setDialogParam(sys, 'im01', 'R2', 0.46, {
                        tip: '转子电阻 R₂ 恢复 0.46 Ω',
                        steps: 10, speed: 180,
                    });
                    await new Promise(r => setTimeout(r, 30000));
                    // 2. 磁极对数 2 → 4（变极调速）
                    await _blinkN(sys, 'im01', 2, { direction: 'up', tip: '调节磁极对数（变极调速）' });
                    await _setDialogParam(sys, 'im01', 'polePairs', 4, {
                        tip: '磁极对数 2 → 4（同步转速减半）',
                        steps: 4, speed: 260,
                    });
                    sys.showFloatingTip('变极调速：磁极对数 2→4，同步转速减半', 2000);
                    // 3. 等待转速稳定
                    const obs = _flashArrow(sys, 'im01', { direction: 'up', color: '#2ecc71', tip: '观察：转速约降为一半' });
                    await new Promise(r => setTimeout(r, 50000));
                    if (obs) obs.clear();
                },
                check() {
                    const motor = this.sys.comps['im01'];
                    return motor && Math.abs(motor.R2 - 0.46) < 0.01 && motor.polePairs === 4;
                },
            },
            {
                msg: '第 5 步：恢复磁极对数为 2，将频率降至 40 Hz，电压同步降至 176 V（保持 V/f 比 = 4.4 恒定），观察转速变化。变频调速保持 U/f 恒定可实现恒磁通调速，属于高效调速方式。',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    const isShow = this._wfMode === 'show';
                    const motor = sys.comps['im01'];
                    const ac = sys.comps['ac'];
                    if (!isShow) {
                        motor.onConfigUpdate({ polePairs: 2 });
                        if (ac) ac.onConfigUpdate({ freq: 40, vRms: 176 });
                        return;
                    }
                    // 1. 恢复磁极对数为 2（变极）。由于 polePairs 为步进参数，直接走 API 并闪烁提示
                    await _blinkN(sys, 'im01', 2, { direction: 'up', tip: '磁极对数恢复 2（有级调速）' });
                    motor.onConfigUpdate({ polePairs: 2 });
                    await new Promise(r => setTimeout(r, 40000));
                    // 2. 频率 50 → 40 Hz（恒 V/f 变频调速）
                    await _blinkN(sys, 'ac', 2, { direction: 'right', tip: '调节频率与电压（保持 V/f 恒定）' });
                    await _setDialogParam(sys, 'ac', 'freq', 40, {
                        tip: '频率 50 → 40 Hz',
                        steps: 10, speed: 170,
                    });
                    await _setDialogParam(sys, 'ac', 'vRms', 176, {
                        tip: '电压等比例降为 176 V（V/f 恒定）',
                        steps: 10, speed: 170,
                    });
                    sys.showFloatingTip('变频调速（V/f 恒定）：转差率不变，高速同步转速变化', 2000);
                    // 3. 等待转速稳定
                    const obs = _flashArrow(sys, 'im01', { direction: 'up', color: '#2ecc71', tip: '观察：转速随同步转速下降' });
                    await new Promise(r => setTimeout(r, 30000));
                    if (obs) obs.clear();
                },
                check() {
                    const motor = this.sys.comps['im01'];
                    const ac = this.sys.comps['ac'];
                    return motor && motor.polePairs === 2
                        && ac && ac.isOn
                        && Math.abs(ac.freq - 40) < 0.5
                        && Math.abs(ac.vRms - 176) < 2;
                },
            },
            {
                msg: '第 6 步：将频率升至 60 Hz，电压恢复 220V（V/f 比从 4.4 变为 3.67，主磁通减弱），观察转速变化。弱磁调速可使电机运行在额定转速以上，但转矩能力下降。',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    const isShow = this._wfMode === 'show';
                    const ac = sys.comps['ac'];
                    if (!isShow) {
                        if (ac) ac.onConfigUpdate({ freq: 60, vRms: 220 });
                        return;
                    }
                    // 调出三相电源参数设置界面，频率与电压同步上调（弱磁调速）
                    await _blinkN(sys, 'ac', 2, { direction: 'right', tip: '频率升高，电压上限 220V（弱磁调速）' });
                    await _setDialogParam(sys, 'ac', 'freq', 60, {
                        tip: '频率 40 → 60 Hz',
                        steps: 12, speed: 160,
                    });
                    await _setDialogParam(sys, 'ac', 'vRms', 220, {
                        tip: '电压恢复 220 V（V/f < 4.4，主磁通减弱）',
                        steps: 12, speed: 160,
                    });
                    sys.showFloatingTip('弱磁调速：V/f 降低，转矩能力下降', 2000);
                    // 等待转速稳定
                    const obs = _flashArrow(sys, 'im01', { direction: 'up', color: '#2ecc71', tip: '观察：转速升至额定以上' });
                    await new Promise(r => setTimeout(r, 60000));
                    if (obs) obs.clear();
                },
                check() {
                    const ac = this.sys.comps['ac'];
                    return ac && ac.isOn
                        && Math.abs(ac.freq - 60) < 0.5
                        && Math.abs(ac.vRms - 220) < 2;
                },
            },
            {
                msg: '第 7 步：调速方式知识',
                mode: 'quiz',
                quizConfig: {
                    question: '下列哪种调速方法属于改变同步转速的高效调速方式？',
                    options: [
                        '转子串电阻调速（绕线式电机）',
                        '变频调速（V/f 恒定）',
                        '降压调速',
                        '定子串电抗调速',
                    ],
                    answer: 1,
                    analysis: '变频调速通过改变电源频率 f 改变同步转速 n₀ = 60f/p，保持 U/f 恒定时主磁通不变、转差率不变，无转差功率损耗，属于高效调速方式。转子串电阻、降压、串电抗均属于变转差率调速，转差功率以发热形式损耗在转子回路中，效率较低。',
                },
                async act() {
                    const sys = this.sys;
                    const q = {
                        question: '下列哪种调速方法属于改变同步转速的高效调速方式？',
                        options: ['转子串电阻调速（绕线式电机）', '变频调速（V/f 恒定）', '降压调速', '定子串电抗调速'],
                        answer: 1,
                        analysis: '变频调速通过改变电源频率 f 改变同步转速 n₀ = 60f/p，保持 U/f 恒定时主磁通不变、转差率不变，无转差功率损耗，属于高效调速方式。转子串电阻、降压、串电抗均属于变转差率调速，转差功率以发热形式损耗在转子回路中，效率较低。',
                    };
                    const parent = sys.container;
                    const mask = document.createElement('div');
                    Object.assign(mask.style, {
                        position: 'absolute', top: '0', left: '0', width: '100%', height: '100%',
                        background: 'rgba(0,0,0,0.55)', zIndex: '100',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'sans-serif',
                    });
                    const box = document.createElement('div');
                    Object.assign(box.style, {
                        background: '#fff', width: '88%', maxWidth: '520px', borderRadius: '12px',
                        padding: '20px', boxShadow: '0 8px 20px rgba(0,0,0,0.3)',
                    });
                    const letters = ['A', 'B', 'C', 'D'];
                    let html = `
                        <div style="color:#1395eb;font-size:15px;font-weight:bold;margin-bottom:4px;">[单选题]</div>
                        <div style="font-weight:bold;margin-bottom:14px;line-height:1.4;">${q.question}</div>`;
                    q.options.forEach((text, i) => {
                        html += `
                        <div data-opt="${i}" style="margin:6px 0;padding:10px 12px;border:2px solid #ddd;
                             border-radius:8px;background:#fcfcfc;font-size:15px;">
                            <span style="font-weight:bold;margin-right:8px;color:#1395eb;">${letters[i]}</span>${text}
                        </div>`;
                    });
                    html += `<div id="quiz-ana" style="display:none;margin-top:14px;padding:12px;font-size:13px;background:#f1f8e9;border-left:4px solid #4caf50;border-radius:4px;color:#555;line-height:1.5;"></div>`;
                    box.innerHTML = html;
                    mask.appendChild(box);
                    parent.appendChild(mask);
                    await new Promise(r => setTimeout(r, 3000));
                    const optNodes = box.querySelectorAll('[data-opt]');
                    optNodes[q.answer].style.borderColor = '#4caf50';
                    optNodes[q.answer].style.background = '#e8f5e9';
                    const tag = document.createElement('span');
                    tag.style.cssText = 'color:#2e7d32;font-weight:bold;margin-left:6px;';
                    tag.textContent = '✅ 正确答案';
                    optNodes[q.answer].appendChild(tag);
                    const anaEl = box.querySelector('#quiz-ana');
                    anaEl.style.display = 'block';
                    anaEl.innerHTML = `💡 ${q.analysis}`;
                    await new Promise(r => setTimeout(r, 3000));
                    if (parent.contains(mask)) parent.removeChild(mask);
                    sys.showFloatingTip('✅ 正确答案：变频调速（V/f 恒定）', 1500);
                },
            },
        ],
    },

    'braking-methods': {
        id: 'braking-methods',
        name: '6. 三相异步电机制动方法',
        steps: [
            {
                msg: '第 1 步：接线并起动电机（正序 UVW），使电机达到稳定运行状态。',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    const isShow = this._wfMode === 'show';
                    const ac = sys.comps['ac'];
                    if (!isShow) {
                        _autoWire(sys, 'braking-methods');
                        if (ac) ac.onConfigUpdate({ vRms: 220, freq: 50, isOn: true, phaseSeq: 'pos' });
                        return;
                    }
                    // 1. 动画接线（Y 形）
                    sys.conns.length = 0;
                    sys.showFloatingTip('Y 形接线，连好三相电源', 1600);
                    await _wireAnimated(sys, [
                        { from: 'ac_wire_u', to: 'im01_wire_u1', type: 'wire' },
                        { from: 'ac_wire_v', to: 'im01_wire_v1', type: 'wire' },
                        { from: 'ac_wire_w', to: 'im01_wire_w1', type: 'wire' },
                        { from: 'im01_wire_u2', to: 'im01_wire_v2', type: 'wire' },
                        { from: 'im01_wire_u2', to: 'im01_wire_w2', type: 'wire' },
                    ], ['U → U1', 'V → V1', 'W → W1', '短接 U2-V2（Y 形）', '短接 U2-W2（Y 形）']);
                    if (ac) ac.onConfigUpdate({ vRms: 220, freq: 50, isOn: false, phaseSeq: 'pos' });
                    // 2. 起动电机（箭头+虚线圈闪烁 3 次）
                    if (ac) {
                        await _blinkN(sys, 'ac', 3, { direction: 'right', tip: '接通三相电源（220V/50Hz/正序）' });
                        ac.onConfigUpdate({ vRms: 220, freq: 50, isOn: true, phaseSeq: 'pos' });
                    }
                    // 3. 等待电机达到稳定转速
                    const obs = _flashArrow(sys, 'im01', { direction: 'up', color: '#2ecc71', tip: '观察：电机达到稳定转速' });
                    await new Promise(r => setTimeout(r, 60000));
                    if (obs) obs.clear();
                },
                check() {
                    const ac = this.sys.comps['ac'];
                    return ac && ac.isOn && ac.phaseSeq === 'pos';
                },
            },
            {
                msg: '第 2 步：将三相电源相序切换为负序（UWV），观察电机转速迅速下降。反接制动利用反向旋转磁场产生制动转矩，使电机快速停机。',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    const isShow = this._wfMode === 'show';
                    const ac = sys.comps['ac'];
                    if (!isShow) {
                        if (ac) ac.onConfigUpdate({ phaseSeq: 'neg' });
                        return;
                    }
                    // 切换相序为负序（UWV）：箭头闪烁 + 直接设置（phaseSeq 为选择框，无法动画调值）
                    await _blinkN(sys, 'ac', 3, { direction: 'right', tip: '相序切换为负序（UWV），实施反接制动' });
                    if (ac) ac.onConfigUpdate({ phaseSeq: 'neg' });
                    sys.showFloatingTip('反接制动：反向旋转磁场产生制动转矩', 2000);
                    // 等待电机停转
                    const obs = _flashArrow(sys, 'im01', { direction: 'up', color: '#2ecc71', tip: '观察：转速迅速下降' });
                    await new Promise(r => setTimeout(r, 50000));
                    if (obs) obs.clear();
                },
                check() {
                    const motor = this.sys.comps['im01'];
                    return motor && motor._phaseSeq === -1;
                },
            },
            {
                msg: '第 3 步：恢复正序运行，降低电源频率至 30Hz，观察电机进入再生制动状态，转速下降至接近新同步转速（约 900 rpm）。再生制动将机械能回馈至电网，节能且经济。',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    const isShow = this._wfMode === 'show';
                    const ac = sys.comps['ac'];
                    if (!isShow) {
                        if (ac) ac.onConfigUpdate({ phaseSeq: 'pos', freq: 30 });
                        return;
                    }
                    // 1. 恢复正序
                    await _blinkN(sys, 'ac', 2, { direction: 'right', tip: '恢复正序（UVW），准备再生制动' });
                    if (ac) ac.onConfigUpdate({ phaseSeq: 'pos' });
                    await new Promise(r => setTimeout(r, 60000));
                    // 2. 频率 50 → 30 Hz（再生制动：电机实际转速超过新同步转速，进入发电状态）
                    await _setDialogParam(sys, 'ac', 'freq', 30, {
                        tip: '频率 50 → 30 Hz（再生制动）',
                        steps: 10, speed: 180,
                    });
                    sys.showFloatingTip('再生制动：转速超过新同步转速，机械能回馈电网', 2000);
                    // 3. 等待电机稳定
                    const obs = _flashArrow(sys, 'im01', { direction: 'up', color: '#2ecc71', tip: '观察：转速下降至约 900 rpm' });
                    await new Promise(r => setTimeout(r, 40000));
                    if (obs) obs.clear();
                },
                check() {
                    const motor = this.sys.comps['im01'];
                    const ac = this.sys.comps['ac'];
                    return ac && ac.isOn && motor && motor._phaseSeq === 1 && Math.abs(ac.freq - 30) < 2;
                },
            },
            {
                msg: '第 4 步：恢复正常频率 50Hz，切断交流电源，将直流电源（DC 24V）正极接 U1、负极接 V1，打开直流电源，观察电机能耗制动停车。',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    const isShow = this._wfMode === 'show';
                    const ac = sys.comps['ac'];
                    const dc = sys.comps['dc24v'];
                    if (!isShow) {
                        if (ac) ac.onConfigUpdate({ freq: 50, isOn: false });
                        if (dc) {
                            sys.connMgr.addConn({ from: 'dc24v_wire_p', to: 'im01_wire_u1', type: 'wire' });
                            sys.connMgr.addConn({ from: 'dc24v_wire_n', to: 'im01_wire_v1', type: 'wire' });
                            dc.isOn = true;
                            dc.update();
                        }
                        return;
                    }
                    // 1. 恢复频率 50 Hz + 切断交流电源（箭头闪烁 3 次）
                    if (ac) {
                        await _blinkN(sys, 'ac', 3, { direction: 'right', tip: '恢复正常频率 50Hz，切断交流电源' });
                        ac.onConfigUpdate({ freq: 50, isOn: false });
                    }
                    await new Promise(r => setTimeout(r, 3000));
                    // 2. 动画连接直流电源（DC 24V）：P→U1、N→V1
                    sys.showFloatingTip('接入直流电源：DC 正极→U1，DC 负极→V1', 2000);
                    await _wireAnimated(sys, [
                        { from: 'dc24v_wire_p', to: 'im01_wire_u1', type: 'wire' },
                        { from: 'dc24v_wire_n', to: 'im01_wire_v1', type: 'wire' },
                    ], ['DC 正极 → U1', 'DC 负极 → V1']);
                    // 3. 打开直流电源（箭头+虚线圈闪烁 3 次）
                    if (dc) {
                        await _blinkN(sys, 'dc24v', 3, { direction: 'right', tip: '打开直流电源，实施能耗制动' });
                        dc.isOn = true;
                        dc.update();
                    }
                    sys.showFloatingTip('能耗制动：直流电产生静止磁场，使电机快速停转', 2000);
                    // 4. 等待电机完全停转
                    const obs = _flashArrow(sys, 'im01', { direction: 'up', color: '#2ecc71', tip: '观察：电机停转' });
                    await new Promise(r => setTimeout(r, 30000));
                    if (obs) obs.clear();
                },
                check() {
                    const ac = this.sys.comps['ac'];
                    const dc = this.sys.comps['dc24v'];
                    const motor = this.sys.comps['im01'];
                    if (!ac || !dc || !motor) return false;
                    const c = (a, b) => this.sys.isPortConnected(a, b);
                    return !ac.isOn
                        && dc.isOn
                        && c('dc24v_wire_p', 'im01_wire_u1')
                        && c('dc24v_wire_n', 'im01_wire_v1')
                        && Math.abs(motor.getOmegaM()) < 10;
                },
            },
            {
                msg: '第 5 步：制动方法知识',
                mode: 'quiz',
                quizConfig: {
                    question: '下列哪种制动方式可以将机械能回馈至电网？',
                    options: [
                        '反接制动 — 通过改变相序实现制动',
                        '再生制动 — 电机转速超过同步转速时回馈发电',
                        '能耗制动 — 通入直流电产生静止磁场制动',
                        '以上三种都可以',
                    ],
                    answer: 1,
                    analysis: '再生制动（又称回馈制动）发生在电机实际转速超过同步转速时，电机处于发电状态，将机械能转化为电能回馈至电网，节能且经济。反接制动和能耗制动均将能量消耗在转子电路中。',
                },
                async act() {
                    const sys = this.sys;
                    const q = {
                        question: '下列哪种制动方式可以将机械能回馈至电网？',
                        options: ['反接制动 — 通过改变相序实现制动', '再生制动 — 电机转速超过同步转速时回馈发电', '能耗制动 — 通入直流电产生静止磁场制动', '以上三种都可以'],
                        answer: 1,
                        analysis: '再生制动（又称回馈制动）发生在电机实际转速超过同步转速时，电机处于发电状态，将机械能转化为电能回馈至电网，节能且经济。反接制动和能耗制动均将能量消耗在转子电路中。',
                    };
                    const parent = sys.container;
                    const mask = document.createElement('div');
                    Object.assign(mask.style, {
                        position: 'absolute', top: '0', left: '0', width: '100%', height: '100%',
                        background: 'rgba(0,0,0,0.55)', zIndex: '100',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'sans-serif',
                    });
                    const box = document.createElement('div');
                    Object.assign(box.style, {
                        background: '#fff', width: '88%', maxWidth: '520px', borderRadius: '12px',
                        padding: '20px', boxShadow: '0 8px 20px rgba(0,0,0,0.3)',
                    });
                    const letters = ['A', 'B', 'C', 'D'];
                    let html = `
                        <div style="color:#1395eb;font-size:15px;font-weight:bold;margin-bottom:4px;">[单选题]</div>
                        <div style="font-weight:bold;margin-bottom:14px;line-height:1.4;">${q.question}</div>`;
                    q.options.forEach((text, i) => {
                        html += `
                        <div data-opt="${i}" style="margin:6px 0;padding:10px 12px;border:2px solid #ddd;
                             border-radius:8px;background:#fcfcfc;font-size:15px;">
                            <span style="font-weight:bold;margin-right:8px;color:#1395eb;">${letters[i]}</span>${text}
                        </div>`;
                    });
                    html += `<div id="quiz-ana" style="display:none;margin-top:14px;padding:12px;font-size:13px;background:#f1f8e9;border-left:4px solid #4caf50;border-radius:4px;color:#555;line-height:1.5;"></div>`;
                    box.innerHTML = html;
                    mask.appendChild(box);
                    parent.appendChild(mask);
                    await new Promise(r => setTimeout(r, 3000));
                    const optNodes = box.querySelectorAll('[data-opt]');
                    optNodes[q.answer].style.borderColor = '#4caf50';
                    optNodes[q.answer].style.background = '#e8f5e9';
                    const tag = document.createElement('span');
                    tag.style.cssText = 'color:#2e7d32;font-weight:bold;margin-left:6px;';
                    tag.textContent = '✅ 正确答案';
                    optNodes[q.answer].appendChild(tag);
                    const anaEl = box.querySelector('#quiz-ana');
                    anaEl.style.display = 'block';
                    anaEl.innerHTML = `💡 ${q.analysis}`;
                    await new Promise(r => setTimeout(r, 3000));
                    if (parent.contains(mask)) parent.removeChild(mask);
                    sys.showFloatingTip('✅ 正确答案：再生制动 — 电机转速超过同步转速时回馈发电', 1500);
                },
            },
        ],
    },

    'slip-characteristic': {
        id: 'slip-characteristic',
        name: '7. 三相异步电机转差率特性',
        steps: [
            {
                msg: '第 1 步：接线（Y 形），起动电机（220V/50Hz/正序），观察转差率从 1.00 逐渐下降至接近 0 的起动过程。',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    const isShow = this._wfMode === 'show';
                    const motor = sys.comps['im01'];
                    const ac = sys.comps['ac'];
                    if (!isShow) {
                        _autoWire(sys, 'slip-characteristic');
                        if (ac) ac.onConfigUpdate({ vRms: 220, freq: 50, isOn: true, phaseSeq: 'pos' });
                        return;
                    }
                    sys.conns.length = 0;
                    sys.showFloatingTip('Y 形接线，连好三相电源', 1600);
                    await _wireAnimated(sys, [
                        { from: 'ac_wire_u', to: 'im01_wire_u1', type: 'wire' },
                        { from: 'ac_wire_v', to: 'im01_wire_v1', type: 'wire' },
                        { from: 'ac_wire_w', to: 'im01_wire_w1', type: 'wire' },
                        { from: 'im01_wire_u2', to: 'im01_wire_v2', type: 'wire' },
                        { from: 'im01_wire_u2', to: 'im01_wire_w2', type: 'wire' },
                    ], ['U → U1', 'V → V1', 'W → W1', '短接 U2-V2（Y 形）', '短接 U2-W2（Y 形）']);
                    if (ac) ac.onConfigUpdate({ vRms: 220, freq: 50, isOn: false, phaseSeq: 'pos' });
                    if (ac) {
                        await _blinkN(sys, 'ac', 3, { direction: 'right', tip: '接通三相电源（220V/50Hz/正序）' });
                        ac.onConfigUpdate({ vRms: 220, freq: 50, isOn: true, phaseSeq: 'pos' });
                    }
                    sys.showFloatingTip('起动过程：转差率 s 从 1.00 逐渐趋近 0', 2000);
                    const obs = _flashArrow(sys, 'im01', { direction: 'up', color: '#2ecc71', tip: '观察：转差率下降，电机加速' });
                    await new Promise(r => setTimeout(r, 70000));
                    if (obs) obs.clear();
                },
                check() {
                    const motor = this.sys.comps['im01'];
                    return motor && Math.abs(motor.getOmegaM()) > 140;
                },
            },
            {
                msg: '第 2 步：设置负载阻力矩 200 N·m（恒转矩），观察电机转速迅速下降，转差率从接近 0 上升接近 1.00。',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    const isShow = this._wfMode === 'show';
                    const motor = sys.comps['im01'];
                    if (!isShow) {
                        motor.loadType = 'constant';
                        motor.loadTorque = 200;
                        return;
                    }
                    await _animateTorqueSlider(sys, 200, {
                        tip: '设置恒转矩负载 → 200 N·m（堵转）',
                        steps: 10, speed: 200, wait: 2000,
                    });
                    sys.showFloatingTip('重载堵转：转差率 s → 1.00', 2000);
                    const obs = _flashArrow(sys, 'im01', { direction: 'up', color: '#e74c3c', tip: '观察：转速骤降，s 上升至 1' });
                    await new Promise(r => setTimeout(r, 60000));
                    if (obs) obs.clear();
                },
                check() {
                    const motor = this.sys.comps['im01'];
                    return motor && motor.loadTorque > 190;
                },
            },
            {
                msg: '第 3 步：卸除负载，使电机转速逐渐上升到额定转速。将三相电源相序切换为负序（UWV），观察电机在正向惯性下遇到反向磁场，转差率瞬间大于 1。',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    const isShow = this._wfMode === 'show';
                    const motor = sys.comps['im01'];
                    const ac = sys.comps['ac'];
                    if (!isShow) {
                        motor.loadTorque = 0;
                        motor.loadType = 'constant';
                        if (ac) ac.onConfigUpdate({ phaseSeq: 'neg' });
                        return;
                    }
                    await _animateTorqueSlider(sys, 0, {
                        tip: '卸除负载（转矩 → 0）',
                        steps: 8, speed: 180, wait: 2000,
                    });
                    await new Promise(r => setTimeout(r, 60000));

                    await _blinkN(sys, 'ac', 3, { direction: 'right', tip: '相序切换为负序（UWV），s > 1' });
                    if (ac) ac.onConfigUpdate({ phaseSeq: 'neg' });
                    sys.showFloatingTip('反向磁场：转差率 s > 1（反转制动区）', 2000);
                    const obs = _flashArrow(sys, 'im01', { direction: 'up', color: '#e74c3c', tip: '观察：s > 1，反转制动' });
                    await new Promise(r => setTimeout(r, 30000));
                    if (obs) obs.clear();
                },
                check() {
                    const motor = this.sys.comps['im01'];
                    return motor && motor._phaseSeq === -1;
                },
            },
            {
                msg: '第 4 步：恢复正序运行，转速升高到额定转速。然后降低电源频率至 30Hz，观察电机进入再生制动状态，转差率变为负值（s < 0）。',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    const isShow = this._wfMode === 'show';
                    const ac = sys.comps['ac'];
                    if (!isShow) {
                        if (ac) ac.onConfigUpdate({ phaseSeq: 'pos', freq: 30 });
                        return;
                    }
                    await _blinkN(sys, 'ac', 2, { direction: 'right', tip: '恢复正序（UVW），准备再生制动' });
                    if (ac) ac.onConfigUpdate({ phaseSeq: 'pos' });
                    await new Promise(r => setTimeout(r, 50000));
                    await _setDialogParam(sys, 'ac', 'freq', 30, {
                        tip: '频率 50 → 30 Hz（再生制动）',
                        steps: 10, speed: 180,
                    });
                    sys.showFloatingTip('再生制动：s < 0，机械能回馈电网', 2000);
                    const obs = _flashArrow(sys, 'im01', { direction: 'up', color: '#2ecc71', tip: '观察：s < 0，再生制动' });
                    await new Promise(r => setTimeout(r, 30000));
                    if (obs) obs.clear();
                },
                check() {
                    const motor = this.sys.comps['im01'];
                    const ac = this.sys.comps['ac'];
                    return ac && ac.isOn && motor && motor._phaseSeq === 1 && Math.abs(ac.freq - 30) < 2;
                },
            },
            {
                msg: '第 5 步：恢复 50Hz，电机转速回升。然后设置负载阻力矩 19 N·m（恒转矩），记录此时的电磁转矩 Te 和转差率 s。',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    const isShow = this._wfMode === 'show';
                    const ac = sys.comps['ac'];
                    const motor = sys.comps['im01'];
                    if (!isShow) {
                        if (ac) ac.onConfigUpdate({ freq: 50 });
                        motor.loadType = 'constant';
                        motor.loadTorque = 19;
                        return;
                    }
                    await _setDialogParam(sys, 'ac', 'freq', 50, {
                        tip: '频率恢复 50 Hz',
                        steps: 10, speed: 170,
                    });
                    await new Promise(r => setTimeout(r, 40000));
                    await _animateTorqueSlider(sys, 19, {
                        tip: '设置负载阻力矩 → 19 N·m（s 很小区域）',
                        steps: 8, speed: 180, wait: 2000,
                    });
                    sys.showFloatingTip('低转差率区：记录 Te 和 s，验证 Te ∝ s', 2000);
                    const obs = _flashArrow(sys, 'im01', { direction: 'up', color: '#2ecc71', tip: '观察：高转速、小转差率、小电磁转矩' });
                    await new Promise(r => setTimeout(r, 20000));
                    if (obs) obs.clear();
                },
                check() {
                    const motor = this.sys.comps['im01'];
                    return motor && Math.abs(motor.loadTorque - 19) < 3 && Math.abs(motor.getOmegaM()) > 140;
                },
            },
            {
                msg: '第 6 步：设置负载阻力矩 29 N·m，记录此时的电磁转矩 Te 和转差率 s。',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    const isShow = this._wfMode === 'show';
                    const motor = sys.comps['im01'];
                    if (!isShow) {
                        motor.loadType = 'constant';
                        motor.loadTorque = 29;
                        return;
                    }
                    await _animateTorqueSlider(sys, 29, {
                        tip: '负载阻力矩 19 → 29 N·m',
                        steps: 6, speed: 190, wait: 2000,
                    });
                    sys.showFloatingTip('记录 Te 和 s：Te 随 s 增大而增大', 2000);
                    const obs = _flashArrow(sys, 'im01', { direction: 'up', color: '#2ecc71', tip: '观察：转速略降，Te 上升' });
                    await new Promise(r => setTimeout(r, 20000));
                    if (obs) obs.clear();
                },
                check() {
                    const motor = this.sys.comps['im01'];
                    return motor && Math.abs(motor.loadTorque - 29) < 3 && Math.abs(motor.getOmegaM()) > 140;
                },
            },
            {
                msg: '第 7 步：设置负载阻力矩 39 N·m，记录此时的电磁转矩 Te 和转差率 s。根据以上三组数据验证：（1）电磁转矩取决于负载阻力矩；（2）s 很小时，电磁转矩与 s 成正比。',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    const isShow = this._wfMode === 'show';
                    const motor = sys.comps['im01'];
                    if (!isShow) {
                        motor.loadType = 'constant';
                        motor.loadTorque = 39;
                        return;
                    }
                    await _animateTorqueSlider(sys, 39, {
                        tip: '负载阻力矩 29 → 39 N·m',
                        steps: 6, speed: 190, wait: 2000,
                    });
                    sys.showFloatingTip('第三组数据：验证 Te ∝ s（s < 0.06 区域）', 2000);
                    const obs = _flashArrow(sys, 'im01', { direction: 'up', color: '#2ecc71', tip: '观察：Te 随 s 线性增长，记录数据' });
                    await new Promise(r => setTimeout(r, 20000));
                    if (obs) obs.clear();
                },
                check() {
                    const motor = this.sys.comps['im01'];
                    return motor && Math.abs(motor.loadTorque - 39) < 3 && Math.abs(motor.getOmegaM()) > 140;
                },
            },
            {
                msg: '第 8 步：转差率特性知识',
                mode: 'quiz',
                quizConfig: {
                    question: '当转差率 s 很小时（s < 0.06），电磁转矩 Te 与转差率 s 之间近似呈什么关系？',
                    options: [
                        'Te 与 s 无关，基本恒定',
                        'Te 与 s 成正比（Te ∝ s）',
                        'Te 与 s 成反比（Te ∝ 1/s）',
                        'Te 与 s² 成正比（Te ∝ s²）',
                    ],
                    answer: 1,
                    analysis: '当 s 很小时，等效电路中 R₂/s 远大于其他阻抗项，电磁转矩 Te ≈ 3pU₁²s / (2πf₁R₂)，即 Te 与 s 近似成正比。',
                },
                async act() {
                    const sys = this.sys;
                    const q = {
                        question: '当转差率 s 很小时（s < 0.06），电磁转矩 Te 与转差率 s 之间近似呈什么关系？',
                        options: ['Te 与 s 无关，基本恒定', 'Te 与 s 成正比（Te ∝ s）', 'Te 与 s 成反比（Te ∝ 1/s）', 'Te 与 s² 成正比（Te ∝ s²）'],
                        answer: 1,
                        analysis: '当 s 很小时，等效电路中 R₂/s 远大于其他阻抗项，电磁转矩 Te ≈ 3pU₁²s / (2πf₁R₂)，即 Te 与 s 近似成正比。',
                    };
                    const parent = sys.container;
                    const mask = document.createElement('div');
                    Object.assign(mask.style, {
                        position: 'absolute', top: '0', left: '0', width: '100%', height: '100%',
                        background: 'rgba(0,0,0,0.55)', zIndex: '100',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'sans-serif',
                    });
                    const box = document.createElement('div');
                    Object.assign(box.style, {
                        background: '#fff', width: '88%', maxWidth: '520px', borderRadius: '12px',
                        padding: '20px', boxShadow: '0 8px 20px rgba(0,0,0,0.3)',
                    });
                    const letters = ['A', 'B', 'C', 'D'];
                    let html = `
                        <div style="color:#1395eb;font-size:15px;font-weight:bold;margin-bottom:4px;">[单选题]</div>
                        <div style="font-weight:bold;margin-bottom:14px;line-height:1.4;">${q.question}</div>`;
                    q.options.forEach((text, i) => {
                        html += `
                        <div data-opt="${i}" style="margin:6px 0;padding:10px 12px;border:2px solid #ddd;
                             border-radius:8px;background:#fcfcfc;font-size:15px;">
                            <span style="font-weight:bold;margin-right:8px;color:#1395eb;">${letters[i]}</span>${text}
                        </div>`;
                    });
                    html += `<div id="quiz-ana" style="display:none;margin-top:14px;padding:12px;font-size:13px;background:#f1f8e9;border-left:4px solid #4caf50;border-radius:4px;color:#555;line-height:1.5;"></div>`;
                    box.innerHTML = html;
                    mask.appendChild(box);
                    parent.appendChild(mask);
                    await new Promise(r => setTimeout(r, 3000));
                    const optNodes = box.querySelectorAll('[data-opt]');
                    optNodes[q.answer].style.borderColor = '#4caf50';
                    optNodes[q.answer].style.background = '#e8f5e9';
                    const tag = document.createElement('span');
                    tag.style.cssText = 'color:#2e7d32;font-weight:bold;margin-left:6px;';
                    tag.textContent = '✅ 正确答案';
                    optNodes[q.answer].appendChild(tag);
                    const anaEl = box.querySelector('#quiz-ana');
                    anaEl.style.display = 'block';
                    anaEl.innerHTML = `💡 ${q.analysis}`;
                    await new Promise(r => setTimeout(r, 3000));
                    if (parent.contains(mask)) parent.removeChild(mask);
                    sys.showFloatingTip('✅ 正确答案：Te 与 s 成正比（Te ∝ s）', 1500);
                },
            },
        ],
    },

    'fault-analysis': {
        id: 'fault-analysis',
        name: '8. 三相异步电机常见故障分析',
        steps: [
            {
                msg: '第 1 步：Y 形接线，U 相串入数字功率计测电流，设置恒转矩负载 10 N·m，起动电机（220V/50Hz/正序），观察正常运行时电流。',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    const isShow = this._wfMode === 'show';
                    const ac = sys.comps['ac'];
                    const motor = sys.comps['im01'];
                    const em = sys.comps['elecmeter'];
                    if (!isShow) {
                        sys.conns.length = 0;
                        _wireFaultAnalysis(sys);
                        if (em) { em.group.position({ x: 100, y: 160 }); em.group.visible(true); }
                        if (ac) ac.onConfigUpdate({ vRms: 220, freq: 50, isOn: true, phaseSeq: 'pos' });
                        if (motor) { motor.loadType = 'constant'; motor.loadTorque = 10; }
                        const sel = document.getElementById('loadTypeSelect');
                        if (sel) sel.value = 'constant';
                        const slider = document.getElementById('torqueSlider');
                        if (slider) { slider.value = '10'; slider.dispatchEvent(new Event('input')); }
                        return;
                    }
                    // 1. 调出数字功率计（箭头指向“选择仪表”按钮，闪烁 2 次）
                    const btn = document.getElementById('btnInstrument');
                    if (btn) {
                        _flashDOM(btn, '点击：打开"选择仪表"菜单', 2);
                        await new Promise(r => setTimeout(r, 2200));
                    }
                    if (em) {
                        sys.toggleInstrumentVisibility('elecmeter', true);
                        em.group.position({ x: 100, y: 60 });
                        sys.showFloatingTip('已调出数字功率计（测量 U 相电流）', 1500);
                        await new Promise(r => setTimeout(r, 1200));
                    }
                    // 2. 切换负载为恒转矩 30 N·m
                    if (motor) { motor.loadType = 'constant'; motor.loadTorque = 30; }
                    const sel = document.getElementById('loadTypeSelect');
                    if (sel && sel.value !== 'constant') {
                        sel.value = 'constant';
                        sel.dispatchEvent(new Event('change'));
                    }
                    await _animateTorqueSlider(sys, 10, { tip: '设置恒转矩负载 → 10 N·m', steps: 6, speed: 190, wait: 2000 });
                    // 3. 动画接线（Y 形，含功率计电流串联）
                    sys.conns.length = 0;
                    await _wireAnimated(sys, [
                        { from: 'ac_wire_u', to: 'elecmeter_wire_ip', type: 'wire' },
                        { from: 'elecmeter_wire_in', to: 'im01_wire_u1', type: 'wire' },
                        { from: 'ac_wire_v', to: 'im01_wire_v1', type: 'wire' },
                        { from: 'ac_wire_w', to: 'im01_wire_w1', type: 'wire' },
                        { from: 'im01_wire_u2', to: 'im01_wire_v2', type: 'wire' },
                        { from: 'im01_wire_u2', to: 'im01_wire_w2', type: 'wire' },
                    ], ['U → 功率计 I+', '功率计 I- → U1', 'V → V1', 'W → W1', '短接 U2-V2（Y 形）', '短接 U2-W2（Y 形）']);
                    if (ac) ac.onConfigUpdate({ vRms: 220, freq: 50, isOn: false, phaseSeq: 'pos' });
                    // 4. 起动电机
                    if (ac) {
                        await _blinkN(sys, 'ac', 3, { direction: 'right', tip: '接通三相电源（220V/50Hz/正序）' });
                        ac.onConfigUpdate({ vRms: 220, freq: 50, isOn: true, phaseSeq: 'pos' });
                    }
                    sys.showFloatingTip('观察正常运行电流', 2000);
                    const obs = _flashArrow(sys, 'im01', { direction: 'up', color: '#2ecc71', tip: '观察：正常运行电流' });
                    await new Promise(r => setTimeout(r, 70000));
                    if (obs) obs.clear();
                },
                check() {
                    const motor = this.sys.comps['im01'];
                    const ac = this.sys.comps['ac'];
                    const c = (a, b) => this.sys.isPortConnected(a, b);
                    return ac && ac.isOn
                        && motor && motor.loadType === 'constant' && motor.loadTorque > 5
                        && Math.abs(motor.getOmegaM()) > 140
                        && c('ac_wire_u', 'elecmeter_wire_ip')
                        && c('elecmeter_wire_in', 'im01_wire_u1')
                        && c('im01_wire_u2', 'im01_wire_v2')
                        && c('im01_wire_u2', 'im01_wire_w2');
                },
            },
            {
                msg: '第 2 步：运行中断开 W 相（移除 ac_wire_w → im01_wire_w1 的连线），观察功率计电流变化，注意电机是否停转。',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    const isShow = this._wfMode === 'show';
                    if (!isShow) {
                        sys.conns = sys.conns.filter(c => !(
                            (c.from === 'ac_wire_w' && c.to === 'im01_wire_w1') ||
                            (c.from === 'im01_wire_w1' && c.to === 'ac_wire_w')
                        ));
                        sys.redrawAll();
                        return;
                    }
                    // 动画拆除 W 相连线（缺相故障模拟）
                    sys.showFloatingTip('模拟缺相故障：拆除 W 相连线', 1600);
                    await _unwireAnimated(sys, [
                        { from: 'ac_wire_w', to: 'im01_wire_w1', type: 'wire' },
                    ]);
                    sys.showFloatingTip('⚠ 缺相运行：注意电流增大', 2000);
                    // 等待电机运行观察电流变化（电机仍能靠惯性继续旋转）
                    const obs = _flashArrow(sys, 'im01', { direction: 'up', color: '#e74c3c', tip: '观察：电流增大，电机可能继续运行' });
                    await new Promise(r => setTimeout(r, 20000));
                    if (obs) obs.clear();
                },
                check() {
                    const motor = this.sys.comps['im01'];
                    const c = (a, b) => this.sys.isPortConnected(a, b);
                    return !c('ac_wire_w', 'im01_wire_w1')
                        && motor && Math.abs(motor.getOmegaM()) > 100;
                },
            },
            {
                msg: '第 3 步：断开交流电源，等待电机完全停止，再重新接通电源，观察缺相状态下电机能否起动。',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    const isShow = this._wfMode === 'show';
                    const ac = sys.comps['ac'];
                    if (!isShow) {
                        if (ac) ac.onConfigUpdate({ isOn: false });
                        await new Promise(r => setTimeout(r, 3000));
                        if (ac) ac.onConfigUpdate({ isOn: true });
                        await new Promise(r => setTimeout(r, 1000));
                        return;
                    }
                    // 1. 断开交流电源
                    if (ac) {
                        await _blinkN(sys, 'ac', 2, { direction: 'right', tip: '断开交流电源，等待电机停转' });
                        ac.onConfigUpdate({ isOn: false });
                    }
                    sys.showFloatingTip('等待电机完全停转……', 2500);
                    await _animateTorqueSlider(sys, 200, { tip: '增大负载，加快停机速度', steps: 6, speed: 190, wait: 3000 });
                    await new Promise(r => setTimeout(r, 30000));
                    await _animateTorqueSlider(sys, 0, { tip: '设为空载，观察缺相起动', steps: 6, speed: 190, wait: 3000 });
                    // 2. 重新接通电源（缺相状态）
                    if (ac) {
                        await _blinkN(sys, 'ac', 3, { direction: 'right', tip: '重新接通电源（缺相）' });
                        ac.onConfigUpdate({ isOn: true });
                    }
                    sys.showFloatingTip('缺相起动：起动转矩为 0，电机无法起动', 2000);
                    const obs = _flashArrow(sys, 'im01', { direction: 'up', color: '#e74c3c', tip: '观察：电机停转，无法起动' });
                    await new Promise(r => setTimeout(r, 15000));
                    if (obs) obs.clear();
                },
                check() {
                    const motor = this.sys.comps['im01'];
                    const ac = this.sys.comps['ac'];
                    const c = (a, b) => this.sys.isPortConnected(a, b);
                    return ac && ac.isOn
                        && motor
                        && !c('ac_wire_w', 'im01_wire_w1')
                        && Math.abs(motor.getOmegaM()) < 5;
                },
            },
            {
                msg: '第 4 步：恢复 W 相接线（重新连接 ac_wire_w → im01_wire_w1），起动电机至稳定状态。将电源电压降至 160V，观察电机转速下降和电流增大现象。',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    const isShow = this._wfMode === 'show';
                    const ac = sys.comps['ac'];
                    if (!isShow) {
                        sys.connMgr.addConn({ from: 'ac_wire_w', to: 'im01_wire_w1', type: 'wire' });
                        if (ac) ac.onConfigUpdate({ vRms: 160 });
                        return;
                    }
                    // 1. 动画恢复 W 相连线
                    sys.showFloatingTip('恢复 W 相接线', 1600);
                    await _wireAnimated(sys, [
                        { from: 'ac_wire_w', to: 'im01_wire_w1', type: 'wire' },
                    ], ['W → W1（恢复）']);
                    // 2. 重新起动电机
                    if (ac) {
                        await _blinkN(sys, 'ac', 3, { direction: 'right', tip: '重新接通三相电源（220V/50Hz/正序）' });
                        ac.onConfigUpdate({ vRms: 220, freq: 50, isOn: true, phaseSeq: 'pos' });
                    }
                    sys.showFloatingTip('电机恢复正常运行', 1500);
                    await new Promise(r => setTimeout(r, 60000));
                    // 3. 降压至 160V（参数对话框动画）
                    await _blinkN(sys, 'ac', 2, { direction: 'right', tip: '调节三相电源电压参数' });
                    await _setDialogParam(sys, 'ac', 'vRms', 160, {
                        tip: '相电压 220 → 160 V（欠压运行）',
                        steps: 12, speed: 170,
                    });
                    await _animateTorqueSlider(sys, 200, { tip: '增大负载，欠压下带载运行', steps: 6, speed: 190, wait: 3000 });
                    sys.showFloatingTip('欠压运行：转速下降，电流增大（降压调速）', 2000);
                    const obs = _flashArrow(sys, 'im01', { direction: 'up', color: '#e74c3c', tip: '观察：转速下降、电流增大' });
                    await new Promise(r => setTimeout(r, 50000));
                    if (obs) obs.clear();
                },
                check() {
                    const motor = this.sys.comps['im01'];
                    const ac = this.sys.comps['ac'];
                    const c = (a, b) => this.sys.isPortConnected(a, b);
                    return ac && ac.isOn
                        && Math.abs(ac.vRms - 160) < 3
                        && c('ac_wire_w', 'im01_wire_w1')
                        && c('ac_wire_u', 'elecmeter_wire_ip')
                        && c('elecmeter_wire_in', 'im01_wire_u1')
                        && motor && Math.abs(motor.getOmegaM()) > 100;
                },
            },
            {
                msg: '第 5 步：故障分析知识',
                mode: 'quiz',
                quizConfig: {
                    question: '三相异步电机运行中断开一相（缺相运行）后，以下哪个现象是正确的？',
                    options: [
                        '电机立即停转，无法继续运行',
                        '电机继续运行，但电流显著增大，长时间缺相会烧毁电机',
                        '电机运行不受任何影响，各项参数保持不变',
                        '电机转速反而升高，电流减小',
                    ],
                    answer: 1,
                    analysis: '运行中断开一相后，电机变为单相运行状态，仍能依靠惯性继续旋转。但由于缺少一相电压，定子电流显著增大（可达额定电流 1.5～2 倍），导致电机过热，长时间缺相运行会烧毁电机。同时，电机无法在缺相状态下起动（起动转矩为 0）。',
                },
                async act() {
                    const sys = this.sys;
                    const q = {
                        question: '三相异步电机运行中断开一相（缺相运行）后，以下哪个现象是正确的？',
                        options: ['电机立即停转，无法继续运行', '电机继续运行，但电流显著增大，长时间缺相会烧毁电机', '电机运行不受任何影响，各项参数保持不变', '电机转速反而升高，电流减小'],
                        answer: 1,
                        analysis: '运行中断开一相后，电机变为单相运行状态，仍能依靠惯性继续旋转。但由于缺少一相电压，定子电流显著增大（可达额定电流 1.5～2 倍），导致电机过热，长时间缺相运行会烧毁电机。同时，电机无法在缺相状态下起动（起动转矩为 0）。',
                    };
                    const parent = sys.container;
                    const mask = document.createElement('div');
                    Object.assign(mask.style, {
                        position: 'absolute', top: '0', left: '0', width: '100%', height: '100%',
                        background: 'rgba(0,0,0,0.55)', zIndex: '100',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'sans-serif',
                    });
                    const box = document.createElement('div');
                    Object.assign(box.style, {
                        background: '#fff', width: '88%', maxWidth: '520px', borderRadius: '12px',
                        padding: '20px', boxShadow: '0 8px 20px rgba(0,0,0,0.3)',
                    });
                    const letters = ['A', 'B', 'C', 'D'];
                    let html = `
                        <div style="color:#1395eb;font-size:15px;font-weight:bold;margin-bottom:4px;">[单选题]</div>
                        <div style="font-weight:bold;margin-bottom:14px;line-height:1.4;">${q.question}</div>`;
                    q.options.forEach((text, i) => {
                        html += `
                        <div data-opt="${i}" style="margin:6px 0;padding:10px 12px;border:2px solid #ddd;
                             border-radius:8px;background:#fcfcfc;font-size:15px;">
                            <span style="font-weight:bold;margin-right:8px;color:#1395eb;">${letters[i]}</span>${text}
                        </div>`;
                    });
                    html += `<div id="quiz-ana" style="display:none;margin-top:14px;padding:12px;font-size:13px;background:#f1f8e9;border-left:4px solid #4caf50;border-radius:4px;color:#555;line-height:1.5;"></div>`;
                    box.innerHTML = html;
                    mask.appendChild(box);
                    parent.appendChild(mask);
                    await new Promise(r => setTimeout(r, 3000));
                    const optNodes = box.querySelectorAll('[data-opt]');
                    optNodes[q.answer].style.borderColor = '#4caf50';
                    optNodes[q.answer].style.background = '#e8f5e9';
                    const tag = document.createElement('span');
                    tag.style.cssText = 'color:#2e7d32;font-weight:bold;margin-left:6px;';
                    tag.textContent = '✅ 正确答案';
                    optNodes[q.answer].appendChild(tag);
                    const anaEl = box.querySelector('#quiz-ana');
                    anaEl.style.display = 'block';
                    anaEl.innerHTML = `💡 ${q.analysis}`;
                    await new Promise(r => setTimeout(r, 3000));
                    if (parent.contains(mask)) parent.removeChild(mask);
                    sys.showFloatingTip('✅ 正确答案：电机继续运行，但电流显著增大', 1500);
                },
            },
        ],
    },

    'ts-curve-analysis': {
        id: 'ts-curve-analysis',
        name: '9. 三相异步电机 T-s 特性曲线分析',
        steps: [
            {
                msg: '第 1 步：Y 形接线，设置恒转矩负载 30 N·m。T-s 特性面板显示电机的 T-s 曲线（蓝色虚线）和负载特性线（橙色虚线）。',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    const isShow = this._wfMode === 'show';
                    const motor = sys.comps['im01'];
                    const ac = sys.comps['ac'];
                    const tsc = sys.comps['ts-curve'];
                    if (!isShow) {
                        _autoWire(sys, 'ts-curve-analysis');
                        if (tsc) { tsc.group.position({ x: 850, y: 50 }); tsc.group.visible(true); }
                        if (motor) { motor.loadType = 'constant'; motor.loadTorque = 30; }
                        const slider = document.getElementById('torqueSlider');
                        if (slider) { slider.value = '30'; slider.dispatchEvent(new Event('input')); }
                        const sel = document.getElementById('loadTypeSelect');
                        if (sel) sel.value = 'constant';
                        return;
                    }
                    // 1. 动画接线（Y 形）
                    sys.conns.length = 0;
                    sys.showFloatingTip('Y 形接线，连好三相电源', 1600);
                    await _wireAnimated(sys, [
                        { from: 'ac_wire_u', to: 'im01_wire_u1', type: 'wire' },
                        { from: 'ac_wire_v', to: 'im01_wire_v1', type: 'wire' },
                        { from: 'ac_wire_w', to: 'im01_wire_w1', type: 'wire' },
                        { from: 'im01_wire_u2', to: 'im01_wire_v2', type: 'wire' },
                        { from: 'im01_wire_u2', to: 'im01_wire_w2', type: 'wire' },
                    ], ['U → U1', 'V → V1', 'W → W1', '短接 U2-V2（Y 形）', '短接 U2-W2（Y 形）']);
                    if (ac) ac.onConfigUpdate({ vRms: 220, freq: 50, isOn: false, phaseSeq: 'pos' });
                    // 2. 确认 T-s 曲线面板可见
                    if (tsc) { tsc.group.position({ x: 850, y: 50 }); tsc.group.visible(true); }
                    await new Promise(r => setTimeout(r, 800));
                    // 3. 设置负载 30 N·m
                    const sel = document.getElementById('loadTypeSelect');
                    if (sel && sel.value !== 'constant') {
                        const h = _flashDOMArrow(sel, '负载类型 → 恒转矩', 2);
                        await new Promise(r => setTimeout(r, 2200));
                        if (h) h.clear();
                        sel.value = 'constant';
                        sel.dispatchEvent(new Event('change'));
                    }
                    await _animateTorqueSlider(sys, 30, { tip: '设置恒转矩负载 → 30 N·m', steps: 6, speed: 190, wait: 2000 });
                    sys.showFloatingTip('T-s 面板：蓝色虚线=电机特性，橙色虚线=负载特性', 2000);
                    const obs = _flashArrow(sys, 'im01', { direction: 'up', color: '#2ecc71', tip: '观察：T-s 特性面板' });
                    await new Promise(r => setTimeout(r, 6000));
                    if (obs) obs.clear();
                },
                check() {
                    const motor = this.sys.comps['im01'];
                    const c = (a, b) => this.sys.isPortConnected(a, b);
                    return motor && motor.loadType === 'constant' && motor.loadTorque > 25
                        && c('ac_wire_u', 'im01_wire_u1')
                        && c('ac_wire_v', 'im01_wire_v1')
                        && c('im01_wire_u2', 'im01_wire_v2')
                        && c('im01_wire_u2', 'im01_wire_w2');
                },
            },
            {
                msg: '第 2 步：起动电机（220V/50Hz/正序）。红色点（电机工作点）沿 T-s 曲线移动，蓝色点（负载工作点）沿负载线移动，最终两点在交点处稳定（Te = T负载）。',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    const isShow = this._wfMode === 'show';
                    const ac = sys.comps['ac'];
                    if (!isShow) {
                        if (ac) ac.onConfigUpdate({ vRms: 220, freq: 50, isOn: true, phaseSeq: 'pos' });
                        return;
                    }
                    if (ac) {
                        await _blinkN(sys, 'ac', 3, { direction: 'right', tip: '接通三相电源，起动电机（220V/50Hz/正序）' });
                        ac.onConfigUpdate({ vRms: 220, freq: 50, isOn: true, phaseSeq: 'pos' });
                    }
                    sys.showFloatingTip('红色点（电机）和蓝色点（负载）在交点处稳定', 2000);
                    const obs = _flashArrow(sys, 'im01', { direction: 'up', color: '#2ecc71', tip: '观察：工作点沿 T-s 曲线移至交点' });
                    await new Promise(r => setTimeout(r, 70000));
                    if (obs) obs.clear();
                },
                check() {
                    const motor = this.sys.comps['im01'];
                    return motor && Math.abs(motor.getOmegaM()) > 140;
                },
            },
            {
                msg: '第 3 步：断开电源，将负载类型切换为风机型。T-s 面板上的负载特性线由水平线变为抛物线（风机特性），以虚线显示。',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    const isShow = this._wfMode === 'show';
                    const ac = sys.comps['ac'];
                    const motor = sys.comps['im01'];
                    if (!isShow) {
                        if (ac) ac.onConfigUpdate({ isOn: false });
                        const select = document.getElementById('loadTypeSelect');
                        if (select) { select.value = 'fan'; select.dispatchEvent(new Event('change')); }
                        return;
                    }
                    // 1. 断开交流电源
                    if (ac) {
                        await _blinkN(sys, 'ac', 2, { direction: 'right', tip: '断开交流电源' });
                        ac.onConfigUpdate({ isOn: false });
                    }
                    await new Promise(r => setTimeout(r, 2000));
                    // 2. 切换负载为风机型（闪烁箭头指向下拉框）
                    const select = document.getElementById('loadTypeSelect');
                    if (select) {
                        const h = _flashDOMArrow(select, '负载类型 → 风机型（T-s 面板显示抛物线负载特性）', 2);
                        await new Promise(r => setTimeout(r, 2200));
                        if (h) h.clear();
                        select.value = 'fan';
                        select.dispatchEvent(new Event('change'));
                    }
                    sys.showFloatingTip('风机特性：负载线变为抛物线', 2000);
                    const obs = _flashArrow(sys, 'im01', { direction: 'up', color: '#2ecc71', tip: '观察：负载特性线由水平线变为抛物线' });
                    await new Promise(r => setTimeout(r, 8000));
                    if (obs) obs.clear();
                },
                check() {
                    const ac = this.sys.comps['ac'];
                    const motor = this.sys.comps['im01'];
                    return ac && !ac.isOn && motor && motor.loadType === 'fan';
                },
            },
            {
                msg: '第 4 步：重新接通电源，观察电机在风机负载下起动。红色点沿 T-s 曲线移动，蓝色点沿风机抛物线移动，最终交于新的稳定工作点。',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    const isShow = this._wfMode === 'show';
                    const ac = sys.comps['ac'];
                    if (!isShow) {
                        if (ac) ac.onConfigUpdate({ vRms: 220, freq: 50, isOn: true, phaseSeq: 'pos' });
                        return;
                    }
                    if (ac) {
                        await _blinkN(sys, 'ac', 3, { direction: 'right', tip: '重新接通三相电源，起动电机（风机负载）' });
                        ac.onConfigUpdate({ vRms: 220, freq: 50, isOn: true, phaseSeq: 'pos' });
                    }
                    sys.showFloatingTip('风机负载：红蓝点沿抛物线交于新稳定工作点', 2000);
                    const obs = _flashArrow(sys, 'im01', { direction: 'up', color: '#2ecc71', tip: '观察：工作点沿抛物线移至新交点' });
                    await new Promise(r => setTimeout(r, 60000));
                    if (obs) obs.clear();
                },
                check() {
                    const motor = this.sys.comps['im01'];
                    const ac = this.sys.comps['ac'];
                    return ac && ac.isOn && motor && motor.loadType === 'fan'
                        && Math.abs(motor.getOmegaM()) > 140;
                },
            },
        ],
    },
};

export const componentConfigs = [
    { Class: ACPower3P, id: 'ac', x: 220, y: 80, vRms: 220, freq: 50, isOn: false, phaseSeq: 'pos', visible: true },
    { Class: InductionMotor, id: 'im01', x: 150, y: 320, visible: true,
        R1: 0.50, Lsigma1: 0.00334, Rc: 300, Lm: 0.0796,
        R2: 0.46, Lsigma2: 0.00334,
        J: 0.12, B: 0.01, polePairs: 2,
        ratedPower: 10, ratedSpeed: 1440,
        simpleModel: true, loadTorque: 0 },

    { Class: DCPower, id: 'dc24v', x: 420, y: 80, isOn: false, visible: true },

    { Class: Multimeter, id: 'multimeter', x: 1080, y: 440, visible: false },
    { Class: MF47Multimeter, id: 'mf47-panel', x: 1250, y: 180, visible: false },
    { Class: Oscilloscope_tri, id: 'osc', x: 50, y: 50, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 50, y: 50, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 50, y: 50, visible: false },
    { Class: ElecMeter, id: 'elecmeter', x: 50, y: 50, visible: false },
    { Class: TsCurveDisplay, id: 'ts-curve', x: 950, y: 100, visible: true, quadrants: 1 },
];

// ─── 接线辅助 ───

function _wireY(sys) {
    const cons = [
        { from: 'ac_wire_u', to: 'im01_wire_u1', type: 'wire' },
        { from: 'ac_wire_v', to: 'im01_wire_v1', type: 'wire' },
        { from: 'ac_wire_w', to: 'im01_wire_w1', type: 'wire' },
        { from: 'im01_wire_u2', to: 'im01_wire_v2', type: 'wire' },
        { from: 'im01_wire_u2', to: 'im01_wire_w2', type: 'wire' },
    ];
    cons.forEach(c => sys.connMgr.addConn(c));
}

function _wireDelta(sys) {
    const cons = [
        { from: 'ac_wire_u', to: 'im01_wire_u1', type: 'wire' },
        { from: 'ac_wire_v', to: 'im01_wire_v1', type: 'wire' },
        { from: 'ac_wire_w', to: 'im01_wire_w1', type: 'wire' },
        { from: 'im01_wire_u1', to: 'im01_wire_w2', type: 'wire' },
        { from: 'im01_wire_v1', to: 'im01_wire_u2', type: 'wire' },
        { from: 'im01_wire_w1', to: 'im01_wire_v2', type: 'wire' },
    ];
    cons.forEach(c => sys.connMgr.addConn(c));
}

function _wireFaultAnalysis(sys) {
    const cons = [
        { from: 'ac_wire_u', to: 'elecmeter_wire_ip', type: 'wire' },
        { from: 'elecmeter_wire_in', to: 'im01_wire_u1', type: 'wire' },
        { from: 'ac_wire_v', to: 'im01_wire_v1', type: 'wire' },
        { from: 'ac_wire_w', to: 'im01_wire_w1', type: 'wire' },
        { from: 'im01_wire_u2', to: 'im01_wire_v2', type: 'wire' },
        { from: 'im01_wire_u2', to: 'im01_wire_w2', type: 'wire' },
    ];
    cons.forEach(c => sys.connMgr.addConn(c));
}

function calcFanK(motor) {
    if (!motor) return 0;
    const rp = (motor.ratedPower != null ? motor.ratedPower : 10) * 1000;
    const rs = 1200;
    const omega = rs * Math.PI / 30;
    return rp / (omega * omega * omega);
}

function _autoWire(sys, wfId) {
    sys.conns.length = 0;
    const ac = sys.comps['ac'];
    const motor = sys.comps['im01'];
    if (ac) ac.onConfigUpdate({ vRms: 220, freq: 50, isOn: false, phaseSeq: 'pos' });
    _wireY(sys);
    sys.redrawAll();
}

// ═════════════════════════════════════════════════════════════
// 自动演示辅助函数（操作流程 1 的视觉展示）
// ═════════════════════════════════════════════════════════════

/** 获取组件世界坐标包围盒（相对于舞台） */
function _boxOf(sys, compId) {
    const comp = sys.comps[compId];
    if (!comp || !comp.group) return null;
    return comp.group.getClientRect({ relativeTo: sys.stage });
}

/**
 * 在组件上叠加红色闪烁箭头 + 虚线圆圈标记，并显示浮动提示。
 * 返回清理句柄，用 _clearFlash 移除。
 */
function _flashArrow(sys, compId, opts = {}) {
    const comp = sys.comps[compId];
    const box = _boxOf(sys, compId);
    if (!comp || !comp.group || !box) return null;

    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const direction = opts.direction || 'up';
    const color = opts.color || '#e74c3c';
    const arrowLen = opts.arrowLen || 48;      // 箭头长度固定（不随组件缩放）
    const radius = opts.circleRadius || 30;    // 虚线圆仅绕组件中心（较小）

    // 箭头起点（从外）和终点（虚线圆边上，不穿透圆心）
    let sx, sy, ex, ey;
    if (direction === 'left') {
        sx = cx + radius + arrowLen; ex = cx + radius;
        sy = ey = cy;
    } else if (direction === 'right') {
        sx = cx - radius - arrowLen; ex = cx - radius;
        sy = ey = cy;
    } else if (direction === 'up') {
        sy = cy + radius + arrowLen; ey = cy + radius;
        sx = ex = cx;
    } else { // down
        sy = cy - radius - arrowLen; ey = cy - radius;
        sx = ex = cx;
    }

    // 外层半透明光晕箭头 + 内层实心箭头
    const outer = new Konva.Arrow({
        points: [sx, sy, ex, ey],
        pointerLength: 20, pointerWidth: 18,
        fill: color, stroke: color, strokeWidth: 7,
        opacity: 0.3, listening: false,
    });
    const inner = new Konva.Arrow({
        points: [sx, sy, ex, ey],
        pointerLength: 13, pointerWidth: 10,
        fill: color, stroke: color, strokeWidth: 4,
        opacity: 1, listening: false,
    });

    // 虚线圆圈只绕组件中心（不罩住整个组件）
    const circle = new Konva.Circle({
        x: cx, y: cy,
        radius,
        stroke: color, strokeWidth: 2.5, dash: [6, 4],
        opacity: 0.9, listening: false,
    });

    const group = new Konva.Group({ listening: false });
    group.add(outer, inner, circle);
    sys.layer.add(group);

    // 闪烁：间隔切换可见性
    let visible = true;
    const timer = setInterval(() => {
        visible = !visible;
        group.visible(visible);
        sys.requestRedraw ? sys.requestRedraw() : sys.layer.batchDraw();
    }, 500);

    if (opts.tip) sys.showFloatingTip(opts.tip, 3000);

    return {
        group,
        timer,
        clear() {
            clearInterval(this.timer);
            group.destroy();
            sys.requestRedraw ? sys.requestRedraw() : sys.layer.batchDraw();
        },
    };
}

/** 让箭头闪烁 n 次后自动清除（并返回句柄以便调用方继续等待） */
async function _blinkN(sys, compId, n, opts = {}) {
    const h = _flashArrow(sys, compId, opts);
    if (!h) return null;
    // 闪烁 1 次约 1s（500ms 可见 + 500ms 隐藏）
    await new Promise(r => setTimeout(r, 1000 * n));
    h.clear();
    return h;
}

/**
 * 逐条连线动画（沿从源端口到目标端口逐渐生长的红色连线）。
 * 每接一条停顿一下，配有浮动提示说明当前连接。
 */
async function _wireAnimated(sys, cons, labels) {
    // 注意：这里不清空已有连线，只追加（如需全新接线请先在调用处清空 sys.conns）
    for (let i = 0; i < cons.length; i++) {
        if (labels && labels[i]) sys.showFloatingTip(labels[i], 1500);
        await sys.addConnectionAnimated(cons[i]);
        await new Promise(r => setTimeout(r, 400));
    }
    sys.redrawAll();
}

/**
 * 高亮一个 DOM 参数控件（如负载转矩滑条），用虚线边框 + 闪烁强调。
 * 返回清理句柄。
 */
function _flashDOM(el, tip, times = 3) {
    if (!el) return null;
    const origOutline = el.style.outline;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (tip) {
        const tipEl = document.createElement('div');
        tipEl.style.cssText = 'position:fixed;top:90px;left:50%;transform:translateX(-50%);background:#e74c3c;color:#fff;padding:8px 16px;border-radius:6px;font:600 15px sans-serif;z-index:99999;box-shadow:0 2px 8px rgba(0,0,0,0.3);';
        tipEl.textContent = tip;
        document.body.appendChild(tipEl);
        setTimeout(() => tipEl.remove(), 3000 + 1000 * times);
    }
    el.style.outline = '3px dashed #e74c3c';
    el.style.outlineOffset = '3px';
    let flash = 0;
    const timer = setInterval(() => {
        flash++;
        el.style.outline = (flash % 2 === 1) ? '3px dashed #e74c3c' : '3px solid #ffffff';
        if (flash >= times * 2) {
            clearInterval(timer);
            el.style.outline = origOutline;
        }
    }, 500);
    return {
        clear() {
            clearInterval(timer);
            el.style.outline = origOutline;
        },
    };
}

/**
 * 连线删除动画：将指定连线从一端向另一端逐渐"收缩消失"，
 * 完成后移除实际连线并重绘。返回 Promise。
 * @param {Object} sys - ControlSystem 实例
 * @param {Array} connsToRemove - 待删除连线数组 [{from,to,type}]
 */
async function _unwireAnimated(sys, connsToRemove) {
    for (const conn of connsToRemove) {
        const key = sys.connMgr.connKeyCanonical(conn);
        const node = sys.wireNodes.find(n => n.getAttr && n.getAttr('connKey') === key);
        const pts = node ? node.points() : null;
        if (pts && pts.length >= 4) {
            const overlay = new Konva.Line({
                points: pts,
                stroke: '#e74c3c',
                strokeWidth: 5,
                dash: [8, 6],
                listening: false,
            });
            sys.lineLayer.add(overlay);
            const ax = pts[0], ay = pts[1];
            const bx = pts[pts.length - 2], by = pts[pts.length - 1];
            await new Promise(res => {
                const dur = 550;
                const start = performance.now();
                function step(now) {
                    const t = Math.min(1, (now - start) / dur);
                    const ease = 1 - Math.pow(1 - t, 3);
                    overlay.points([
                        ax + (bx - ax) * ease,
                        ay + (by - ay) * ease,
                        bx, by,
                    ]);
                    overlay.opacity(1 - t);
                    sys.lineLayer.batchDraw();
                    if (t < 1) requestAnimationFrame(step);
                    else { overlay.destroy(); sys.lineLayer.batchDraw(); res(); }
                }
                requestAnimationFrame(step);
            });
            await new Promise(r => setTimeout(r, 150));
        } else {
            // 找不到对应节点，直接移除
            const keys = connsToRemove.map(c => sys.connMgr.connKeyCanonical(c));
            sys.conns = sys.conns.filter(c => !keys.includes(sys.connMgr.connKeyCanonical(c)));
        }
    }
    const keys = connsToRemove.map(c => sys.connMgr.connKeyCanonical(c));
    sys.conns = sys.conns.filter(c => !keys.includes(sys.connMgr.connKeyCanonical(c)));
    sys.redrawAll();
}

/** 在对话框内找到保存按钮并点击，返回是否成功 */
function _clickDialogSave(el) {
    let cur = el;
    while (cur && cur.parentNode) {
        cur = cur.parentNode;
        if (cur.querySelector) {
            const btns = Array.from(cur.querySelectorAll('button'));
            const save = btns.find(b => b.innerText && b.innerText.trim() === '保存');
            if (save) { save.click(); return true; }
        }
        if (cur === document.body) break;
    }
    return false;
}

/**
 * 调出参数设置对话框，高亮并动态调节某个参数，最后点保存。
 * @param {Object} sys - ControlSystem
 * @param {string} compId - 组件 ID
 * @param {string} key - 参数键（对应对话框输入框 id="diag_key"）
 * @param {number} target - 目标值
 * @param {Object} opts - { tip, steps, speed }
 */
async function _setDialogParam(sys, compId, key, target, opts = {}) {
    const comp = sys.comps[compId];
    if (!comp || typeof comp.showConfigDialog !== 'function') {
        comp?.onConfigUpdate?.({ [key]: target });
        return;
    }
    comp.showConfigDialog();
    await new Promise(r => setTimeout(r, 350));
    const input = document.getElementById(`diag_${key}`);
    if (!input) {
        // 对话框未暴露该字段，直接走 API
        comp.onConfigUpdate({ [key]: target });
        return;
    }
    const origBorder = input.style.border;
    const origOutline = input.style.outline;
    input.scrollIntoView({ behavior: 'smooth', block: 'center' });
    input.style.border = '3px solid #e74c3c';
    input.style.outline = '3px solid rgba(231,76,60,0.4)';
    input.style.background = '#fff3f0';
    if (opts.tip) sys.showFloatingTip(opts.tip, 1500);

    // 动态调节过程
    const startVal = parseFloat(input.value) || 0;
    const stepsN = opts.steps || 10;
    for (let i = 1; i <= stepsN; i++) {
        const val = +(startVal + (target - startVal) * (i / stepsN)).toFixed(1);
        input.value = String(val);
        input.dispatchEvent(new Event('input'));
        await new Promise(r => setTimeout(r, opts.speed || 150));
    }
    input.value = String(target);
    input.dispatchEvent(new Event('input'));

    // 点保存
    if (!_clickDialogSave(input)) {
        comp.onConfigUpdate({ [key]: target });
    }
    await new Promise(r => setTimeout(r, 200));
    input.style.border = origBorder;
    input.style.outline = origOutline;
    input.style.background = '';
}

/**
 * 用一个闪烁的 DOM 箭头指向某个工具栏控件（如转矩滑块），并配浮动提示。
 * 返回清理句柄。
 */
function _flashDOMArrow(el, tip, times = 3) {
    if (!el) return null;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const rect = el.getBoundingClientRect();
    const arrow = document.createElement('div');
    arrow.style.cssText = 'position:fixed;left:' + (rect.left + rect.width / 2 - 14)
        + 'px;top:' + (rect.top - 30) + 'px;font-size:28px;color:#e74c3c;font-weight:bold;'
        + 'z-index:99999;pointer-events:none;text-shadow:0 0 8px rgba(231,76,60,0.7);';
    arrow.textContent = '▼';
    document.body.appendChild(arrow);

    let tipEl = null;
    if (tip) {
        tipEl = document.createElement('div');
        tipEl.style.cssText = 'position:fixed;top:86px;left:50%;transform:translateX(-50%);background:#e74c3c;color:#fff;padding:8px 16px;border-radius:6px;font:600 15px sans-serif;z-index:99999;box-shadow:0 2px 8px rgba(0,0,0,0.3);';
        tipEl.textContent = tip;
        document.body.appendChild(tipEl);
    }

    const cleanup = () => { arrow.remove(); tipEl && tipEl.remove(); };
    let flash = 0;
    const timer = setInterval(() => {
        flash++;
        arrow.style.opacity = (flash % 2 === 1) ? '1' : '0.15';
        if (flash >= times * 2) {
            clearInterval(timer);
            cleanup();
        }
    }, 500);
    return {
        clear() { clearInterval(timer); cleanup(); },
    };
}

/**
 * 高亮负载转矩滑条并动态调节其值（动态显示参数修改过程）。
 * 通过 dispatchEvent('input') 触发已有监听器，从而更新 motor.loadTorque。
 * @param {Object} sys - ControlSystem
 * @param {number} target - 目标转矩 (0~200 N·m)
 * @param {Object} opts - { tip, steps, speed, wait, times }
 */
async function _animateTorqueSlider(sys, target, opts = {}) {
    const slider = document.getElementById('torqueSlider');
    const display = document.getElementById('torqueDisplay');
    if (!slider) {
        const motor = sys.comps['im01'];
        if (motor) motor.loadTorque = target;
        return;
    }
    const clamp = v => Math.max(0, Math.min(200, v));
    // 闪烁箭头指向调节滑块（突出调节转矩动画）
    const h = _flashDOMArrow(slider, opts.tip, opts.times || 2);
    if (opts.wait) await new Promise(r => setTimeout(r, opts.wait));
    const startVal = parseFloat(slider.value) || 0;
    const stepsN = opts.steps || 8;
    for (let i = 1; i <= stepsN; i++) {
        const val = clamp(Math.round(startVal + (target - startVal) * (i / stepsN)));
        slider.value = String(val);
        slider.dispatchEvent(new Event('input'));
        if (display) display.textContent = val.toFixed(1) + ' N·m';
        await new Promise(r => setTimeout(r, opts.speed || 180));
    }
    slider.value = String(clamp(target));
    slider.dispatchEvent(new Event('input'));
    if (display) display.textContent = clamp(target).toFixed(1) + ' N·m';
    if (h) h.clear();
}

// ═════════════════════════════════════════════════════════════

export function initSlider(sys) {
    const toolbar = document.getElementById('toolbar');
    const div = document.createElement('div');
    div.id = 'torqueSliderContainer';
    div.style.cssText = 'display:inline-flex;align-items:center;gap:6px;margin-left:12px;';
    div.innerHTML = `
        <span style="font-size:12px;font-weight:bold;">负载性质:</span>
        <select id="loadTypeSelect" style="font-size:12px;padding:1px 4px;">
            <option value="constant">恒转矩</option>
            <option value="fan">风机型</option>
        </select>
        <input type="range" id="torqueSlider" min="0" max="200" value="0" style="width:160px;">
        <span id="torqueDisplay" style="font-size:12px;min-width:65px;">0.0 N·m</span>
    `;
    toolbar.appendChild(div);

    const motor = sys.comps['im01'];
    const slider = document.getElementById('torqueSlider');
    const display = document.getElementById('torqueDisplay');
    const select = document.getElementById('loadTypeSelect');

    select.addEventListener('change', () => {
        if (!motor) return;
        motor.loadType = select.value;
        if (select.value === 'fan') {
            motor._constantTorqueBackup = motor.loadTorque;
            motor.fanK = calcFanK(motor);
            slider.disabled = true;
            slider.style.opacity = '0.5';
        } else {
            slider.disabled = false;
            slider.style.opacity = '1';
            const restore = motor._constantTorqueBackup !== undefined ? motor._constantTorqueBackup : 0;
            motor.loadTorque = restore;
            slider.value = Math.min(200, Math.round(restore));
            display.textContent = restore.toFixed(1) + ' N·m';
            sys.requestRedraw();
        }
        motor.config.loadType = select.value;
        motor.config.loadTorque = motor.loadTorque;
    });

    slider.addEventListener('input', () => {
        if (select.value === 'constant') {
            const val = parseFloat(slider.value);
            display.textContent = val.toFixed(1) + ' N·m';
            if (motor) {
                motor.loadTorque = val;
                motor.config.loadTorque = val;
            }
            sys.requestRedraw();
        }
    });

    // 风机模式下定时更新滑条和显示（20fps，与物理循环同步）
    setInterval(() => {
        if (!motor || motor.loadType !== 'fan') return;
        const t = Math.abs(motor._appliedLoadTorque || 0);
        display.textContent = t.toFixed(1) + ' N·m';
        slider.value = Math.min(200, Math.round(t));
        motor.config.loadTorque = Math.round(t * 10) / 10;
    }, 50);
}

export function applyAllPresets() {
    const sys = this && this.sys ? this.sys : window.sys;
    if (!sys) return;
    _autoWire(sys, sys.currentWorkflowId || 'motor-starting');
}

export async function applyStartSystem() {
    const sys = this && this.sys ? this.sys : window.sys;
    if (!sys) return;
    _autoWire(sys, sys.currentWorkflowId || 'motor-starting');
    const ac = sys.comps['ac'];
    if (ac) ac.onConfigUpdate({ vRms: 220, freq: 50, isOn: true, phaseSeq: 'pos' });
}

export function fiveStep() {}
