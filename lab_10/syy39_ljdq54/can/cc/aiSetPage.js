/**
 * aiSetPage.js — AI 模拟量输入设置页面构建与刷新
 */

import { W, BODY_H, C } from './constants.js';
import { CANId, CAN_FUNC } from '../CANBUS.js';
import { isModuleAvailable } from './utils.js';

export function buildAISetPage(cc) {
    const pg = cc._pages[3];
    const pw = W - 8, ph = BODY_H;
    pg.add(new Konva.Rect({ width: pw, height: ph, fill: C.panel, cornerRadius: 3 }));
    pg.add(new Konva.Text({ x: 8, y: 6, text: '■ AI 模拟量输入设置', fontSize: 14, fontFamily: 'Courier New', fontStyle: 'bold', fill: C.blue }));

    const chDefs = [
        { id: 'ch1', label: 'CH1', type: '4-20mA 压力', range: '0~10 bar' },
        { id: 'ch2', label: 'CH2', type: '4-20mA 压力', range: '0~1.0 MPa' },
        { id: 'ch3', label: 'CH3', type: 'PT100 温度', range: '-50~200°C' },
        { id: 'ch4', label: 'CH4', type: 'TC 温度', range: '0~400°C' },
    ];

    cc._aiRows = {};
    chDefs.forEach((ch, i) => {
        const y = 32 + i * 100;
        pg.add(new Konva.Rect({ x: 6, y: y - 2, width: pw - 12, height: 94, fill: C.bg, stroke: C.border, strokeWidth: 1, cornerRadius: 2 }));
        pg.add(new Konva.Text({ x: 14, y: y + 4, text: ch.label + ' ' + ch.type, fontSize: 13, fontFamily: 'Courier New', fontStyle: 'bold', fill: C.blue }));

        // 模式切换按钮组
        const modeGrp = new Konva.Group({ x: 234, y });
        const modeBg = new Konva.Rect({ width: 100, height: 20, fill: '#e2e6f4', stroke: C.border, strokeWidth: 1, cornerRadius: 4 });
        const modeTxt = new Konva.Text({ width: 100, height: 20, text: 'mode: --', align: 'center', verticalAlign: 'middle', fontSize: 11, fontFamily: 'Courier New', fill: C.textDim });
        modeGrp.add(modeBg, modeTxt);
        pg.add(modeGrp);

        // 鼠标进入/离开效果
        modeGrp.on('mouseenter', () => {
            if (isModuleAvailable(cc, 'ai')) {
                modeGrp.getStage().container().style.cursor = 'pointer';
                modeBg.fill('#d4dce8');
            }
        });
        modeGrp.on('mouseleave', () => {
            modeGrp.getStage().container().style.cursor = 'default';
            modeBg.fill(isModuleAvailable(cc, 'ai') ? '#e2e6f4' : C.textDim + '33');
        });

        modeGrp.on('click tap', () => {
            // 检查 AI 模块是否在线且无超时
            if (!isModuleAvailable(cc, 'ai')) return; // 模块离线或超时，禁用按钮

            const ai = cc.sys.comps['ai'];
            if (!ai || !cc.sys || !cc.sys.canBus) return;
            const cur = (ai.channels && ai.channels[ch.id] && ai.channels[ch.id].mode) || 'normal';
            const seq = ['normal', 'disable', 'test'];
            const next = seq[(seq.indexOf(cur) + 1) % seq.length];
            const modeMap = { normal: 0, test: 1, disable: 2 };
            const data = [0x05, i & 0xFF, (modeMap[next] || 0) & 0xFF, 0, 0, 0, 0, 0];
            try {
                if (!cc.data.ai[ch.id]) cc.data.ai[ch.id] = {};
                cc.data.ai[ch.id].mode = next;
                if (ai.channels && ai.channels[ch.id]) ai.channels[ch.id].mode = next;
                modeTxt.text(`Mode: ${next}`);
                modeTxt.fill(next === 'normal' ? C.green : next === 'test' ? C.orange : C.textDim);
                cc._updateAIRowFromModule(ch.id);
            } catch (e) { console.warn('optimistic UI update failed', e); }
            try {
                cc.sys.canBus.send({ id: CANId.encode(CAN_FUNC.AI_CONFIG, 1), extended: false, rtr: false, dlc: 8, data, sender: cc.id, timestamp: Date.now() });
                setTimeout(() => cc._requestNodeConfig('ai', 0x0A, 0), 60);
            } catch (e) { console.warn(e); }
        });

        // 工程量显示
        pg.add(new Konva.Text({ x: 14, y: y + 71, text: '工程量:', fontSize: 12, fontFamily: 'Courier New', fill: C.textDim }));
        // 大小和单位在这里：
        const valDisplay = new Konva.Text({ x: 124, y: y + 71, width: 100, text: '---', fontSize: 13, fontFamily: 'Courier New', fontStyle: 'bold', fill: C.green, align: 'left' });
        pg.add(valDisplay);

        // 量程显示
        const urvText = new Konva.Text({ x: 14, y: y + 51, text: '上限: --', fontSize: 12, fontFamily: 'Courier New', fill: C.textDim });
        const lrvText = new Konva.Text({ x: 124, y: y + 51, text: '下限: --', fontSize: 12, fontFamily: 'Courier New', fill: C.textDim });
        const unitText = new Konva.Text({ x: 234, y: y + 51, text: '单位: --', fontSize: 12, fontFamily: 'Courier New', fill: C.textDim });
        pg.add(urvText, lrvText, unitText);

        // 报警阈值显示
        const hhText = new Konva.Text({ x: 14, y: y + 31, text: 'HH: --', fontSize: 12, fontFamily: 'Courier New', fill: C.textDim });
        const hText = new Konva.Text({ x: 124, y: y + 31, text: 'H: --', fontSize: 12, fontFamily: 'Courier New', fill: C.textDim });
        const lText = new Konva.Text({ x: 234, y: y + 31, text: 'L: --', fontSize: 12, fontFamily: 'Courier New', fill: C.textDim });
        const llText = new Konva.Text({ x: 344, y: y + 31, text: 'LL: --', fontSize: 12, fontFamily: 'Courier New', fill: C.textDim });
        pg.add(hhText, hText, lText, llText);

        // 量程编辑
        urvText.on('click tap', () => {
            if (!isModuleAvailable(cc, 'ai')) return; // 模块离线或超时，禁止修改
            cc._openRangeEditor(ch.id, { urvText, lrvText, unitText });
        });
        lrvText.on('click tap', () => {
            if (!isModuleAvailable(cc, 'ai')) return; // 模块离线或超时，禁止修改
            cc._openRangeEditor(ch.id, { urvText, lrvText, unitText });
        });
        unitText.on('click tap', () => {
            if (!isModuleAvailable(cc, 'ai')) return; // 模块离线或超时，禁止修改
            cc._openRangeEditor(ch.id, { urvText, lrvText, unitText });
        });

        // 量程编辑文本的鼠标效果
        [urvText, lrvText, unitText].forEach(txt => {
            txt.on('mouseenter', () => {
                const bus = cc.sys?.canBus;
                const aiOnline = bus ? bus.isNodeOnline('ai') : false;
                if (aiOnline) {
                    txt.getStage().container().style.cursor = 'pointer';
                    txt.fill(C.blue);
                }
            });
            txt.on('mouseleave', () => {
                txt.getStage().container().style.cursor = 'default';
                txt.fill(C.textDim);
            });
        });

        // 报警编辑文本的鼠标效果
        [hhText, hText, lText, llText].forEach(txt => {
            txt.on('mouseenter', () => {
                if (isModuleAvailable(cc, 'ai')) {
                    txt.getStage().container().style.cursor = 'pointer';
                    txt.fill(C.blue);
                }
            });
            txt.on('mouseleave', () => {
                txt.getStage().container().style.cursor = 'default';
                txt.fill(C.textDim);
            });
        });

        // 工程量写入（test 模式）
        valDisplay.on('click tap', () => {
            const ai = cc.sys.comps['ai'];
            if (!ai || !cc.sys || !cc.sys.canBus) return;
            const chMode = (ai.channels && ai.channels[ch.id] && ai.channels[ch.id].mode) || 'normal';
            if (chMode !== 'test') return;
            const cur = ai.channels[ch.id] ? ai.channels[ch.id].value : 0;
            const v = prompt(`设置 ${ch.label} 测试工程量（当前 ${cur}）:`, String(cur));
            if (v === null) return;
            const num = parseFloat(v);
            if (isNaN(num)) return alert('请输入有效数字');
            const scale = (ch.id === 'ch1' || ch.id === 'ch2') ? 100 : 10;
            let raw = Math.round(num * scale);
            if (raw < 0) raw = (raw + 0x10000) & 0xFFFF;
            const data = [0x06, i & 0xFF, (raw >> 8) & 0xFF, raw & 0xFF, 0, 0, 0, 0];
            try {
                cc.sys.canBus.send({ id: CANId.encode(CAN_FUNC.AI_CONFIG, 1), extended: false, rtr: false, dlc: 8, data, sender: cc.id, timestamp: Date.now() });
                setTimeout(() => cc._requestNodeConfig('ai', 0x09, i), 60);
            } catch (e) { console.warn(e); }
        });

        // 报警阈值编辑
        [hhText, hText, lText, llText].forEach(t => t.on('click tap', () => {
            if (!isModuleAvailable(cc, 'ai')) return; // 模块离线或超时，禁止修改
            cc._openAlarmEditor(ch.id);
        }));

        cc._aiRows[ch.id] = { modeGrp, modeBg, modeTxt, valDisplay, urvText, lrvText, unitText, hhText, hText, lText, llText };
    });

    // 初始化参数请求
    setTimeout(() => {
        try {
            const bus = cc.sys?.canBus;
            const aiOnline = bus ? bus.isNodeOnline('ai') : false;
            if (aiOnline && cc.busConnected && !cc.commFault) {
                cc.nodeConfigs.ai.available = true;
                cc.nodeConfigs.ai.pending = false;
                cc._initAIParams();
            } else {
                cc.nodeConfigs.ai.available = false;
                cc.nodeConfigs.ai.pending = true;
            }
        } catch (e) { console.warn(e); }
    }, 200);
}

// ── 每 tick 刷新 ──────────────────────────────
export function renderAISetPage(cc) {
    if (!cc._aiRows) return;
    const bus = cc.sys?.canBus;
    const aiOnline = bus ? bus.isNodeOnline('ai') : false;

    ['ch1', 'ch2', 'ch3', 'ch4'].forEach(id => {
        const row = cc._aiRows[id];
        const d = cc.data.ai[id];
        if (!row || !d) return;

        const isTimeout = d.hold === true;
        const isAvailable = aiOnline && !isTimeout;

        if (!isAvailable) {
            row.valDisplay.text('---');
            row.valDisplay.fill(C.textDim);

            if (row.modeBg) {
                row.modeBg.fill(C.textDim + '33');
                row.modeBg.stroke(C.textDim);
            }
            if (row.modeTxt) {
                row.modeTxt.fill(C.textDim);
            }

            if (row.urvText) row.urvText.fill(C.textDim);
            if (row.lrvText) row.lrvText.fill(C.textDim);
            if (row.unitText) row.unitText.fill(C.textDim);

            if (row.hhText) row.hhText.fill(C.textDim);
            if (row.hText) row.hText.fill(C.textDim);
            if (row.lText) row.lText.fill(C.textDim);
            if (row.llText) row.llText.fill(C.textDim);
        } else {
            row.valDisplay.text(d.fault ? `${d.faultText}` : `${d.value.toFixed(2)} ${d.unit}`);
            row.valDisplay.fill(d.fault ? C.red : C.green);

            if (row.modeBg) {
                row.modeBg.fill('#e2e6f4');
                row.modeBg.stroke(C.border);
            }
            if (row.modeTxt) {
                let rawMode = d.mode ?? (cc.sys?.comps?.['ai']?.channels?.[id]?.mode) ?? 'normal';
                let modeStr;
                if (typeof rawMode === 'number') {
                    const map = ['normal', 'test', 'disable'];
                    modeStr = map[rawMode] || 'normal';
                } else {
                    modeStr = String(rawMode);
                }
                row.modeTxt.fill(modeStr === 'normal' ? C.green : modeStr === 'test' ? C.orange : C.textDim);
                try { row.modeTxt.text(`Mode: ${modeStr}`); } catch (e) { /* ignore */ }
            }

            if (row.urvText) row.urvText.fill(C.textDim);
            if (row.lrvText) row.lrvText.fill(C.textDim);
            if (row.unitText) row.unitText.fill(C.textDim);

            if (row.hhText) row.hhText.fill(C.textDim);
            if (row.hText) row.hText.fill(C.textDim);
            if (row.lText) row.lText.fill(C.textDim);
            if (row.llText) row.llText.fill(C.textDim);
        }
    });
}
