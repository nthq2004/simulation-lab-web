/**
 * diSetPage.js — DI 数字量输入设置页面构建与刷新
 */

import { W, BODY_H, C } from './constants.js';
import { mkBtn, mkToggle } from './utils.js';
import { CANId, CAN_FUNC } from '../CANBUS.js';

export function buildDISetPage(cc) {
    const pg = cc._pages[5];
    const pw = W - 8, ph = BODY_H;
    pg.add(new Konva.Rect({ width: pw, height: ph, fill: C.panel, cornerRadius: 3 }));
    pg.add(new Konva.Text({ x: 8, y: 6, text: '■ DI 数字量输入设置', fontSize: 14, fontFamily: 'Courier New', fontStyle: 'bold', fill: C.green }));

    ['通道', '类型', '当前状态', '计数器', '防抖时间', '复位计数', '报警触发'].forEach((h, i) => {
        pg.add(new Konva.Text({ x: [8, 72, 148, 240, 340, 420, 500][i], y: 30, text: h, fontSize: 12, fontFamily: 'Courier New', fill: C.textDim }));
    });

    const chDefs = [
        { id: 'ch1', label: 'CH1', type: '干接点' },
        { id: 'ch2', label: 'CH2', type: '干接点' },
        { id: 'ch3', label: 'CH3', type: '湿接点' },
        { id: 'ch4', label: 'CH4', type: '湿接点' },
    ];

    cc._diRows = {};
    chDefs.forEach((ch, i) => {
        const y = 50 + i * 60;
        pg.add(new Konva.Rect({ x: 6, y: y - 2, width: pw - 12, height: 52, fill: C.bg, stroke: C.border, strokeWidth: 1, cornerRadius: 2 }));
        pg.add(new Konva.Text({ x: 14, y: y + 20, text: ch.label, fontSize: 11, fontFamily: 'Courier New', fontStyle: 'bold', fill: C.text }));
        pg.add(new Konva.Text({ x: 72, y: y + 20, text: ch.type, fontSize: 10, fontFamily: 'Courier New', fill: C.textDim }));

        const stateDisp = new Konva.Text({ x: 148, y: y + 20, text: 'OFF', fontSize: 11, fontFamily: 'Courier New', fontStyle: 'bold', fill: C.textDim });
        const counterDisp = new Konva.Text({ x: 240, y: y + 20, text: '0', fontSize: 11, fontFamily: 'Courier New', fontStyle: 'bold', fill: C.cyan });
        pg.add(stateDisp, counterDisp);
        pg.add(new Konva.Text({ x: 340, y: y + 20, text: '20ms', fontSize: 10, fontFamily: 'Courier New', fill: C.textDim }));

        // 复位按钮 - 清除计数器
        const resetBtn = mkBtn(pg, '复位', 420, y + 14, C.orange);
        resetBtn.on('click tap', () => {
            // 发送 CAN 命令清除计数 (cmd=0x02, chMask对应当前通道)
            const chIdx = i;
            const chMask = 1 << chIdx;  // 仅清除当前通道
            try {
                cc.sys.canBus.send({
                    id: CANId.encode(CAN_FUNC.DI_CONFIG, 3),  // 节点地址 3
                    extended: false, rtr: false, dlc: 2,
                    data: [0x02, chMask, 0, 0, 0, 0, 0, 0],
                    sender: cc.id, timestamp: Date.now()
                });
                // 乐观UI更新
                cc.data.di[ch.id].counter = 0;
                counterDisp.text('0');
                cc._refreshCache();
            } catch (e) {
                console.warn('计数器清除失败', e);
            }
        });

        // 报警按钮 - 切换触发方式 (ON -> OFF -> NONE -> ON)
        const triggerMap = { 'ON': '闭合报警', 'OFF': '断开报警', 'NONE': '不报警' };
        const reverseTriggerMap = { '闭合报警': 'ON', '断开报警': 'OFF', '不报警': 'NONE' };
        const triggerOrder = ['ON', 'OFF', 'NONE'];

        const currentTrigger = cc.data.di[ch.id].trigger || 'OFF';
        const alarmBtn = mkToggle(pg, triggerMap[currentTrigger], 500, y + 14, 80, 22, false, C.red);

        alarmBtn.on('click tap', () => {
            // 获取当前触发方式
            const currentText = alarmBtn.findOne('Text').text();
            const currentTrigger = reverseTriggerMap[currentText];

            // 循环到下一种方式
            const currentIdx = triggerOrder.indexOf(currentTrigger);
            const nextTrigger = triggerOrder[(currentIdx + 1) % triggerOrder.length];
            const nextText = triggerMap[nextTrigger];

            // 更新本地数据
            cc.data.di[ch.id].trigger = nextTrigger;

            // 发送 CAN 命令更改报警触发方式
            const chIdx = i;
            const chMask = 1 << chIdx;
            const triggerValue = (nextTrigger === 'ON') ? 1 : (nextTrigger === 'NONE' ? 2 : 0);

            try {
                cc.sys.canBus.send({
                    id: CANId.encode(CAN_FUNC.DI_CONFIG, 3),  // 节点地址 3
                    extended: false, rtr: false, dlc: 4,
                    data: [0x01, chMask, chIdx, triggerValue, 0, 0, 0, 0],
                    sender: cc.id, timestamp: Date.now()
                });
            } catch (e) {
                console.warn('报警触发方式更改失败', e);
            }

            // 更新UI
            const btnColor = nextTrigger === 'NONE' ? C.textDim : (nextTrigger === 'ON' ? C.red : C.orange);
            const alarmBtnChildren = alarmBtn.getChildren();
            if (alarmBtnChildren && alarmBtnChildren.length >= 2) {
                alarmBtnChildren[0].fill(btnColor + '33');
                alarmBtnChildren[0].stroke(btnColor);
                alarmBtnChildren[1].text(nextText);
                alarmBtnChildren[1].fill(btnColor);
            }
            cc._refreshCache();
        });

        cc._diRows[ch.id] = { stateDisp, counterDisp, alarmBtn };
    });
    // 初始化参数请求
    setTimeout(() => {
        try {
            const bus = cc.sys?.canBus;
            const diOnline = bus ? bus.isNodeOnline('di') : false;
            if (diOnline && cc.busConnected && !cc.commFault) {
                cc.nodeConfigs.di.available = true;
                cc.nodeConfigs.di.pending = false;
                cc._initDIParams();
            } else {
                cc.nodeConfigs.di.available = false;
                cc.nodeConfigs.di.pending = true;
            }
        } catch (e) { console.warn(e); }
    }, 200);
}

// ── 每 tick 刷新 ──────────────────────────────
export function renderDISetPage(cc) {
    if (!cc._diRows) return;
    const bus = cc.sys?.canBus;
    const diOnline = bus ? bus.isNodeOnline('di') : false;
    const triggerMap = { 'ON': '闭合报警', 'OFF': '断开报警', 'NONE': '不报警' };
    const triggerColors = { 'ON': C.red, 'OFF': C.orange, 'NONE': C.textDim };

    ['ch1', 'ch2', 'ch3', 'ch4'].forEach(id => {
        const d = cc.data.di[id];
        const row = cc._diRows[id];
        if (!d || !row) return;

        if (!diOnline) {
            row.stateDisp.text('---');
            row.stateDisp.fill(C.textDim);
            row.counterDisp.text('---');
            if (row.alarmBtn) {
                row.alarmBtn.findOne('Rect').fill(C.textDim + '22');
                row.alarmBtn.findOne('Rect').stroke(C.textDim);
                row.alarmBtn.findOne('Text').text('--');
                row.alarmBtn.findOne('Text').fill(C.textDim);
            }
        } else {
            row.stateDisp.text(d.fault ? 'FAULT' : (d.state ? ' ON ' : 'OFF'));
            row.stateDisp.fill(d.fault ? C.red : (d.state ? C.green : C.textDim));
            row.counterDisp.text(String(d.counter || 0));

            if (row.alarmBtn) {
                const trigger = d.trigger || 'OFF';
                const btnText = triggerMap[trigger];
                const btnColor = triggerColors[trigger];
                row.alarmBtn.findOne('Rect').fill(btnColor + '33');
                row.alarmBtn.findOne('Rect').stroke(btnColor);
                row.alarmBtn.findOne('Text').text(btnText);
                row.alarmBtn.findOne('Text').fill(btnColor);
            }
        }
    });
}
