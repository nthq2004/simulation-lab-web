/**
 * doPage.js — DO 数字量输出控制页面构建与刷新
 */

import { W, BODY_H, C } from './constants.js';
import { mkToggle } from './utils.js';
import { CANId, CAN_FUNC } from '../CANBUS.js';
import { isModuleAvailable, applyDoModeUI } from './utils.js';

// 模式名：内部值 → 显示文字
const MODE_LABELS = { hand: '手  动', auto: '自  动', pulse: '脉冲模式', disable: '禁  用' };
const MODE_COLORS = { hand: C.yellow, auto: C.green, pulse: C.cyan, disable: C.textDim };
const MODE_SEQ    = ['hand', 'auto', 'pulse', 'disable'];

// 安全输出循环
const SAFE_SEQ = ['off', 'hold', 'preset'];
const SAFE_COLORS = { off: C.textDim, hold: C.yellow, preset: C.orange };

export function buildDOPage(cc) {
    const pg = cc._pages[6];
    const pw = W - 8, ph = BODY_H;
    pg.add(new Konva.Rect({ width: pw, height: ph, fill: C.panel, cornerRadius: 3 }));
    pg.add(new Konva.Text({ x: 8, y: 6, text: '■ DO 数字量输出控制', fontSize: 12, fontFamily: 'Courier New', fontStyle: 'bold', fill: C.purple }));

    ['通道', '类型', '当前状态', '控制模式', '手动手动', '脉冲参数', '安全输出'].forEach((h, i) => {
        pg.add(new Konva.Text({ x: [8, 68, 138, 220, 310, 400, 520][i], y: 24, text: h, fontSize: 11, fontFamily: 'Courier New', fill: C.textDim }));
    });

    const chDefs = [
        { id: 'ch1', label: 'CH1', type: 'RELAY' },
        { id: 'ch2', label: 'CH2', type: 'RELAY' },
        { id: 'ch3', label: 'CH3', type: '24VPNP' },
        { id: 'ch4', label: 'CH4', type: '24VPNP' },
    ];

    cc._doRows = {};

    chDefs.forEach((ch, i) => {
        const y = 40 + i * 60;
        pg.add(new Konva.Rect({ x: 6, y: y - 2, width: pw - 12, height: 52, fill: C.bg, stroke: C.border, strokeWidth: 1, cornerRadius: 2 }));
        pg.add(new Konva.Text({ x: 14, y: y + 16, text: ch.label, fontSize: 12, fontFamily: 'Courier New', fontStyle: 'bold', fill: C.text }));
        pg.add(new Konva.Text({ x: 68, y: y + 16, text: ch.type, fontSize: 11, fontFamily: 'Courier New', fill: C.textDim }));

        // ── 当前状态 ──
        const stateDisp = new Konva.Text({
            x: 138, y: y + 12, width: 80, text: 'OFF',
            fontSize: 16, fontFamily: 'Courier New', fontStyle: 'bold', fill: C.textDim
        });
        pg.add(stateDisp);

        // ── 模式按钮（4 种循环）──
        const modeBtn = mkToggle(pg, '手  动', 220, y + 10, 70, 24, false, C.yellow);

        // ── 手动手动按钮（仅 hand 模式激活）──
        const forceBtn = mkToggle(pg, '手动 OFF', 310, y + 10, 60, 24, false, C.textDim);
        forceBtn.opacity(0.35);

        // ── 脉冲参数按钮（仅 pulse 模式激活）──
        const pulseBtn = mkToggle(pg, '500  500  0', 400, y + 10, 98, 24, false, C.cyan);
        pulseBtn.opacity(0.35);

        // ── 安全输出按钮（循环 off / hold / preset）──
        const safeBtn = mkToggle(pg, 'Safe: off', 520, y + 10, 70, 24, false, C.textDim);

        // ── preset 预设状态按钮（仅 preset 模式才可见）──
        const presetBtn = mkToggle(pg, '预设: OFF', 600, y + 10, 52, 24, false, C.orange);
        presetBtn.visible(false);

        // ── 模式切换逻辑 ──
        modeBtn.on('click tap', () => {
            if (!isModuleAvailable(cc, 'do')) return;
            const doMod = cc.sys.comps['do'];
            if (!doMod) return;
            const cur = doMod.channels?.[ch.id]?.mode || 'hand';
            const next = MODE_SEQ[(MODE_SEQ.indexOf(cur) + 1) % MODE_SEQ.length];
            const modeIdx = MODE_SEQ.indexOf(next);
            // 发送 CAN 0x10 设置模式
            try {
                cc.sys.canBus.send({
                    id: CANId.encode(CAN_FUNC.DO_CMD, 4),
                    extended: false, rtr: false, dlc: 8,
                    data: [0x10, 1 << i, modeIdx & 0xFF, 0, 0, 0, 0, 0],
                    sender: cc.id, timestamp: Date.now()
                });
            } catch (e) { console.warn(e); }
            // 乐观 UI 更新
            if (doMod.channels?.[ch.id]) doMod.channels[ch.id].mode = next;
            if (!cc.data.do[ch.id]) cc.data.do[ch.id] = {};
            cc.data.do[ch.id].mode = next;
            applyDoModeUI(modeBtn, forceBtn, pulseBtn, next, doMod, ch.id);

            // 同步液位控制页面的模式：如果改变的是液位控制输出通道
            if (cc.levelCtrl.outputChannel === ch.id) {
                const newLevelMode = next === 'auto' ? 'AUTO' : 'HAND';
                cc.levelCtrl.simMode = newLevelMode;
                cc.levelCtrl.isManualMode = (newLevelMode === 'HAND');
            }

            cc._refreshCache();
        });

        // ── 手动手动切换 ──
        forceBtn.on('click tap', () => {
            if (!isModuleAvailable(cc, 'do')) return;
            const doMod = cc.sys.comps['do'];
            if (!doMod) return;
            const curMode = doMod.channels?.[ch.id]?.mode || 'hand';
            if (curMode !== 'hand') return;
            const curState = doMod.channels?.[ch.id]?.state ?? false;
            const nextState = !curState;
            // 发送 CAN 0x01 直接输出控制
            const stateMask = nextState ? (1 << i) : 0;
            try {
                cc.sys.canBus.send({
                    id: CANId.encode(CAN_FUNC.DO_CMD, 4),
                    extended: false, rtr: false, dlc: 8,
                    data: [0x01, 1 << i, stateMask, 0, 0, 0, 0, 0],
                    sender: cc.id, timestamp: Date.now()
                });
            } catch (e) { console.warn(e); }
            if (doMod.channels?.[ch.id]) doMod.channels[ch.id].state = nextState;
            const onColor = C.red;
            const forceBtnChildren = forceBtn.getChildren();
            if (forceBtnChildren && forceBtnChildren.length >= 2) {
                forceBtnChildren[0].fill(nextState ? onColor + '33' : C.textDim + '22');
                forceBtnChildren[0].stroke(nextState ? onColor : C.textDim);
                forceBtnChildren[1].text(nextState ? '手动  ON ' : '手动 OFF');
                forceBtnChildren[1].fill(nextState ? onColor : C.textDim);
            }
            cc._refreshCache();
        });

        // ── 脉冲参数弹窗 ──
        pulseBtn.on('click tap', () => {
            if (!isModuleAvailable(cc, 'do')) return;
            const doMod = cc.sys.comps['do'];
            if (!doMod) return;
            const curMode = doMod.channels?.[ch.id]?.mode || 'hand';
            if (curMode !== 'pulse') return;
            const pc = doMod.pulseConfig?.[ch.id] || { onMs: 500, offMs: 500, phaseStart: 0 };
            const input = prompt(
                `设置 ${ch.label} 脉冲参数\n格式：高电平时间(ms) 低电平时间(ms) 相位(ms)\n当前：${pc.onMs}  ${pc.offMs}  ${pc.phaseStart}`,
                `${pc.onMs} ${pc.offMs} ${pc.phaseStart}`
            );
            if (input === null) return;
            const parts = input.trim().split(/\s+/).map(Number);
            if (parts.length < 2 || parts.some(isNaN)) return alert('请输入有效数字，用空格分隔');
            const onMs  = Math.max(50, parts[0]);
            const offMs = Math.max(50, parts[1]);
            const phase = Math.max(0, parts[2] || 0);
            try {
                cc.sys.canBus.send({
                    id: CANId.encode(CAN_FUNC.DO_CMD, 4),
                    extended: false, rtr: false, dlc: 8,
                    data: [
                        0x11, 1 << i,
                        (onMs >> 8) & 0xFF, onMs & 0xFF,
                        (offMs >> 8) & 0xFF, offMs & 0xFF,
                        (phase >> 8) & 0xFF, phase & 0xFF
                    ],
                    sender: cc.id, timestamp: Date.now()
                });
            } catch (e) { console.warn(e); }
            if (doMod.pulseConfig?.[ch.id]) {
                doMod.pulseConfig[ch.id].onMs  = onMs;
                doMod.pulseConfig[ch.id].offMs = offMs;
                doMod.pulseConfig[ch.id].phaseStart = phase;
            }
            pulseBtn.findOne('Text').text(`${onMs}  ${offMs}  ${phase}`);
            cc._refreshCache();
        });

        // ── 安全输出模式切换 ──
        safeBtn.on('click tap', () => {
            if (!isModuleAvailable(cc, 'do')) return;
            const doMod = cc.sys.comps['do'];
            if (!doMod) return;
            const cur = doMod.safeOutput?.[ch.id]?.mode || 'off';
            const next = SAFE_SEQ[(SAFE_SEQ.indexOf(cur) + 1) % SAFE_SEQ.length];
            const modeIdx = SAFE_SEQ.indexOf(next);
            const presMask = doMod.safeOutput?.[ch.id]?.presetState ? (1 << i) : 0;
            try {
                cc.sys.canBus.send({
                    id: CANId.encode(CAN_FUNC.DO_CMD, 4),
                    extended: false, rtr: false, dlc: 8,
                    data: [0x12, 1 << i, modeIdx & 0xFF, presMask, 0, 0, 0, 0],
                    sender: cc.id, timestamp: Date.now()
                });
            } catch (e) { console.warn(e); }
            if (doMod.safeOutput?.[ch.id]) doMod.safeOutput[ch.id].mode = next;
            if (!cc.data.do[ch.id]) cc.data.do[ch.id] = {};
            cc.data.do[ch.id].safeMode = next;
            const sc = SAFE_COLORS[next];
            const safeBtnChildren = safeBtn.getChildren();
            if (safeBtnChildren && safeBtnChildren.length >= 2) {
                safeBtnChildren[0].fill(sc + '33');
                safeBtnChildren[0].stroke(sc);
                safeBtnChildren[1].text(`Safe: ${next}`);
                safeBtnChildren[1].fill(sc);
            }
            presetBtn.visible(next === 'preset');
            cc._refreshCache();
        });

        // ── preset 状态切换 ──
        presetBtn.on('click tap', () => {
            if (!isModuleAvailable(cc, 'do')) return;
            const doMod = cc.sys.comps['do'];
            if (!doMod) return;
            const curPreset = doMod.safeOutput?.[ch.id]?.presetState ?? false;
            const nextPreset = !curPreset;
            const modeIdx = SAFE_SEQ.indexOf(doMod.safeOutput?.[ch.id]?.mode || 'preset');
            const presMask = nextPreset ? (1 << i) : 0;
            try {
                cc.sys.canBus.send({
                    id: CANId.encode(CAN_FUNC.DO_CMD, 4),
                    extended: false, rtr: false, dlc: 8,
                    data: [0x12, 1 << i, modeIdx < 0 ? 2 : modeIdx, presMask, 0, 0, 0, 0],
                    sender: cc.id, timestamp: Date.now()
                });
            } catch (e) { console.warn(e); }
            if (doMod.safeOutput?.[ch.id]) doMod.safeOutput[ch.id].presetState = nextPreset;
            if (!cc.data.do[ch.id]) cc.data.do[ch.id] = {};
            cc.data.do[ch.id].presetState = nextPreset;
            const presetBtnChildren = presetBtn.getChildren();
            if (presetBtnChildren && presetBtnChildren.length >= 2) {
                presetBtnChildren[1].text(nextPreset ? '预设:  ON' : '预设: OFF');
                presetBtnChildren[0].fill(nextPreset ? C.orange + '33' : C.textDim + '22');
                presetBtnChildren[0].stroke(nextPreset ? C.orange : C.textDim);
                presetBtnChildren[1].fill(nextPreset ? C.orange : C.textDim);
            }
            cc._refreshCache();
        });

        cc._doRows[ch.id] = { stateDisp, modeBtn, forceBtn, pulseBtn, safeBtn, presetBtn };
    });

    // ── 初始化：DO 上线后读取参数 ──
    setTimeout(() => {
        try {
            const bus = cc.sys?.canBus;
            const doOnline = bus ? bus.isNodeOnline('do') : false;
            if (doOnline && cc.busConnected && !cc.commFault) {
                cc.nodeConfigs.do.available = true;
                cc.nodeConfigs.do.pending = false;
                cc._initDOParams();
            } else {
                cc.nodeConfigs.do.available = false;
                cc.nodeConfigs.do.pending = true;
            }
        } catch (e) { console.warn(e); }
    }, 200);
}

// ── 每 tick 刷新 ──────────────────────────────
export function renderDOPage(cc) {
    const bus = cc.sys?.canBus;
    const doOnline = bus ? bus.isNodeOnline('do') : false;
    const doMod = cc.sys?.comps?.['do'];

    ['ch1', 'ch2', 'ch3', 'ch4'].forEach(id => {
        const d = cc.data.do[id];
        const row = cc._doRows?.[id];
        if (!d || !row) return;
        if (d.mode === 'disable') return;

        if (!doOnline) {
            row.stateDisp.text('---');
            row.stateDisp.fill(C.textDim);
            row.modeBtn?.findOne('Text')?.fill(C.textDim);
            row.forceBtn?.opacity(0.35);
            row.pulseBtn?.opacity(0.35);
            row.presetBtn?.visible(false);
            return;
        }

        row.stateDisp.text(d.fault ? 'FAULT' : (d.state ? ' ON ' : 'OFF'));
        row.stateDisp.fill(d.fault ? C.red : (d.state ? C.purple : C.textDim));

        const mode = d.mode || doMod?.channels?.[id]?.mode || 'hand';
        const mc = MODE_COLORS[mode] || C.textDim;
        if (row.modeBtn) {
            row.modeBtn.findOne('Rect').fill(mc + '33');
            row.modeBtn.findOne('Rect').stroke(mc);
            row.modeBtn.findOne('Text').text(MODE_LABELS[mode] || mode);
            row.modeBtn.findOne('Text').fill(mc);
        }

        row.forceBtn?.opacity(mode === 'hand' ? 1 : 0.35);
        row.pulseBtn?.opacity(mode === 'pulse' ? 1 : 0.35);

        if (mode === 'pulse' && row.pulseBtn) {
            const pc = doMod?.pulseConfig?.[id] || d.pulse || {};
            const onMs = pc.onMs ?? 500;
            const offMs = pc.offMs ?? 500;
            const phMs = pc.phaseStart ?? 0;
            row.pulseBtn.findOne('Text').text(`${onMs}  ${offMs}  ${phMs}`);
        }

        const safeMode = d.safeMode || doMod?.safeOutput?.[id]?.mode || 'off';
        const sc = SAFE_COLORS[safeMode] || C.textDim;
        if (row.safeBtn) {
            row.safeBtn.findOne('Rect').fill(sc + '33');
            row.safeBtn.findOne('Rect').stroke(sc);
            row.safeBtn.findOne('Text').text(`Safe: ${safeMode}`);
            row.safeBtn.findOne('Text').fill(sc);
        }

        if (row.presetBtn) {
            row.presetBtn.visible(safeMode === 'preset');
            if (safeMode === 'preset') {
                const ps = d.presetState ?? doMod?.safeOutput?.[id]?.presetState ?? false;
                row.presetBtn.findOne('Text').text(ps ? '预设:  ON' : '预设: OFF');
                row.presetBtn.findOne('Rect').fill(ps ? C.orange + '33' : C.textDim + '22');
                row.presetBtn.findOne('Rect').stroke(ps ? C.orange : C.textDim);
                row.presetBtn.findOne('Text').fill(ps ? C.orange : C.textDim);
            }
        }
    });
}
