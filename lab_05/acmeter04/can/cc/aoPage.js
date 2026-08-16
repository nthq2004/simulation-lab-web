/**
 * aoPage.js — AO 模拟量输出控制页面构建与刷新
 */

import { W, BODY_H, C } from './constants.js';
import { CANId, CAN_FUNC } from '../CANBUS.js';
import { isModuleAvailable } from './utils.js';

export function buildAOPage(cc) {
    const pg = cc._pages[4];
    const pw = W - 8, ph = BODY_H;
    pg.add(new Konva.Rect({ width: pw, height: ph, fill: C.panel, cornerRadius: 3 }));
    pg.add(new Konva.Text({ x: 8, y: 6, text: '■ AO 模拟量输出控制', fontSize: 12, fontFamily: 'Courier New', fontStyle: 'bold', fill: C.orange }));

    const chDefs = [
        { id: 'ch1', label: 'CH1', type: '4-20mA' },
        { id: 'ch2', label: 'CH2', type: '4-20mA' },
        { id: 'ch3', label: 'CH3', type: 'PWM' },
        { id: 'ch4', label: 'CH4', type: 'PWM' },
    ];

    cc._aoRows = {};
    const sliderTrackW = 400;

    chDefs.forEach((ch, i) => {
        const y = 24 + i * 100;  // 增加行间距为 120px 以容纳安全输出配置
        pg.add(new Konva.Rect({ x: 6, y, width: pw - 12, height: 95, fill: C.bg, stroke: C.border, strokeWidth: 1, cornerRadius: 2 }));
        pg.add(new Konva.Text({ x: 14, y: y + 6, text: `${ch.label}  [${ch.type}]`, fontSize: 12, fontFamily: 'Courier New', fontStyle: 'bold', fill: C.orange }));

        const curVal = new Konva.Text({ x: 14, y: y + 66, text: '工程值：4.00mA', fontSize: 12, fontFamily: 'Courier New', fill: C.text });
        pg.add(curVal);

        // ── 三模式开关：hand / auto / disable ──
        const modeGrp = new Konva.Group({ x: 0.6 * pw, y: y + 4 });
        const modeBg = new Konva.Rect({ width: 100, height: 20, fill: '#e2e6f4', stroke: C.border, strokeWidth: 1, cornerRadius: 4 });
        const modeTxt = new Konva.Text({ width: 100, height: 20, text: 'mode: disable', align: 'center', verticalAlign: 'middle', fontSize: 12, fontFamily: 'Courier New', fill: C.textDim });
        modeGrp.add(modeBg, modeTxt);
        pg.add(modeGrp);
        const applyVal = (clamped) => {
            const pct = Math.round((clamped / sliderTrackW) * 100);
            cc.aoManualVal[ch.id] = pct;
            thumb.x(clamped);
            fillRect.width(clamped);
            valLabel.text(`${pct}%`);

            // 通过 CAN 总线发送输出指令（而不是直接调用 setOutput）
            // 只发送当前通道的值，其他通道保持 0xFFFF（Hold）
            const pctInt = Math.round(pct * 10);  // 百分比 × 100
            const chIdx = i;  // ch1=0, ch2=1, ch3=2, ch4=3

            // 初始化所有通道为 Hold（0xFFFF）
            const data = [0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF];

            // 仅设置当前通道
            const bytePos = chIdx * 2;
            data[bytePos] = (pctInt >> 8) & 0xFF;
            data[bytePos + 1] = pctInt & 0xFF;

            try {
                cc.sys.canBus.send({
                    id: CANId.encode(CAN_FUNC.AO_CMD, 2),  // 节点地址 2（AO模块）
                    extended: false, rtr: false, dlc: 8, data,
                    sender: cc.id, timestamp: Date.now()
                });
            } catch (e) {
                console.warn('输出指令发送失败', e);
            }
            cc._refreshCache();
        };

        modeGrp.on('mouseenter', () => {
            if (isModuleAvailable(cc, 'ao')) {
                modeGrp.getStage().container().style.cursor = 'pointer';
                modeBg.fill('#d4dce8');
            }
        });
        modeGrp.on('mouseleave', () => {
            modeGrp.getStage().container().style.cursor = 'default';
            modeBg.fill(isModuleAvailable(cc, 'ao') ? '#e2e6f4' : C.textDim + '33');
        });

        modeGrp.on('click tap', () => {
            if (!isModuleAvailable(cc, 'ao')) return;
            const ao = cc.sys.comps['ao'];
            if (!ao || !ao.channels || !ao.channels[ch.id]) return;

            const cur = ao.channels[ch.id].mode || 'disable';
            const seq = ['hand', 'auto', 'disable'];
            const next = seq[(seq.indexOf(cur) + 1) % seq.length];

            // 发送 CAN 配置指令（扩展命令 0x12 = 模式设置）
            const modeMap = { hand: 0, auto: 1, disable: 2 };
            const data = [0x12, i & 0xFF, modeMap[next] & 0xFF, 0, 0, 0, 0, 0];
            try {
                cc.sys.canBus.send({
                    id: CANId.encode(CAN_FUNC.AO_CMD, 2),  // 节点地址 2（AO模块）
                    extended: false, rtr: false, dlc: 8, data,
                    sender: cc.id, timestamp: Date.now()
                });
                // 乐观UI更新
                if (!cc.data.ao[ch.id]) cc.data.ao[ch.id] = {};
                cc.data.ao[ch.id].mode = next;
                modeTxt.text(`Mode: ${next}`);
                modeTxt.fill(next === 'hand' ? C.yellow : next === 'auto' ? C.green : C.textDim);
                sliderGrp.opacity(next === 'hand' ? 1 : 0.01);
                if (next === 'disable') {
                    applyVal(0); // 禁用时手动输出 0
                }

                // 同步温度控制页面的模式：如果改变的是温度控制输出通道
                if (cc.tempCtrl.outputChannel === ch.id) {
                    const newTempMode = next === 'auto' ? 'AUTO' : 'HAND';
                    cc.tempCtrl.simMode = newTempMode;
                    cc.tempCtrl.isManualMode = (newTempMode === 'HAND');
                }

                // 延时读取以同步参数
                setTimeout(() => {
                    cc._requestNodeConfig('ao', 0x14, i);
                }, 200);
            } catch (e) {
                console.warn('模式切换失败', e);
            }
            cc._refreshCache();
        });

        // ── LRV/URV 显示和编辑 ──
        const lrvText = new Konva.Text({ x: 14, y: y + 38, text: 'LRV: 0%', fontSize: 12, fontFamily: 'Courier New', fill: C.textDim });
        const urvText = new Konva.Text({ x: 114, y: y + 38, text: 'URV: 100%', fontSize: 12, fontFamily: 'Courier New', fill: C.textDim });
        pg.add(lrvText, urvText);

        lrvText.on('click tap', () => {
            if (!isModuleAvailable(cc, 'ao')) return;
            const ao = cc.sys.comps['ao'];
            if (!ao || !ao.ranges || !ao.ranges[ch.id]) return;
            const v = prompt(`设置 ${ch.label} LRV（下限，当前 ${ao.ranges[ch.id].lrv}）:`, String(ao.ranges[ch.id].lrv));
            if (v === null) return;
            const num = parseFloat(v);
            if (isNaN(num)) return alert('请输入有效数字');
            const lrv = Math.max(0, Math.min(100, num));
            const urv = ao.ranges[ch.id].urv;

            const lrvInt = Math.round(lrv * 100);
            const urvInt = Math.round(urv * 100);
            const data = [0x13, i & 0xFF, (lrvInt >> 8) & 0xFF, lrvInt & 0xFF, (urvInt >> 8) & 0xFF, urvInt & 0xFF, 0, 0];
            try {
                cc.sys.canBus.send({
                    id: CANId.encode(CAN_FUNC.AO_CMD, 2),
                    extended: false, rtr: false, dlc: 8, data,
                    sender: cc.id, timestamp: Date.now()
                });
                if (!cc.data.ao[ch.id]) cc.data.ao[ch.id] = {};
                cc.data.ao[ch.id].lrv = lrv;
                lrvText.text(`LRV: ${lrv}%`);

                setTimeout(() => {
                    cc._requestNodeConfig('ao', 0x14, i);
                }, 200);
            } catch (e) {
                console.warn('LRV 设置失败', e);
            }
            cc._refreshCache();
        });

        urvText.on('click tap', () => {
            if (!isModuleAvailable(cc, 'ao')) return;
            const ao = cc.sys.comps['ao'];
            if (!ao || !ao.ranges || !ao.ranges[ch.id]) return;
            const v = prompt(`设置 ${ch.label} URV（上限，当前 ${ao.ranges[ch.id].urv}）:`, String(ao.ranges[ch.id].urv));
            if (v === null) return;
            const num = parseFloat(v);
            if (isNaN(num)) return alert('请输入有效数字');
            const urv = Math.max(0, Math.min(100, num));
            const lrv = ao.ranges[ch.id].lrv;

            const lrvInt = Math.round(lrv * 100);
            const urvInt = Math.round(urv * 100);
            const data = [0x13, i & 0xFF, (lrvInt >> 8) & 0xFF, lrvInt & 0xFF, (urvInt >> 8) & 0xFF, urvInt & 0xFF, 0, 0];
            try {
                cc.sys.canBus.send({
                    id: CANId.encode(CAN_FUNC.AO_CMD, 2),
                    extended: false, rtr: false, dlc: 8, data,
                    sender: cc.id, timestamp: Date.now()
                });
                if (!cc.data.ao[ch.id]) cc.data.ao[ch.id] = {};
                cc.data.ao[ch.id].urv = urv;
                urvText.text(`URV: ${urv}%`);

                setTimeout(() => {
                    cc._requestNodeConfig('ao', 0x14, i);
                }, 200);
            } catch (e) {
                console.warn('URV 设置失败', e);
            }
            cc._refreshCache();
        });

        // LRV/URV 文本鼠标效果
        [lrvText, urvText].forEach(txt => {
            txt.on('mouseenter', () => {
                if (isModuleAvailable(cc, 'ao')) {
                    txt.getStage().container().style.cursor = 'pointer';
                    txt.fill(C.blue);
                }
            });
            txt.on('mouseleave', () => {
                txt.getStage().container().style.cursor = 'default';
                txt.fill(C.textDim);
            });
        });

        // ── 滑块（hand 模式下可用）──
        const sliderGrp = new Konva.Group({ x: 154, y: y + 72, opacity: 1 });
        const trackRect = new Konva.Rect({ width: sliderTrackW, height: 6, fill: C.gridLine, stroke: C.border, strokeWidth: 1, cornerRadius: 3 });
        const fillRect = new Konva.Rect({ width: 0, height: 6, fill: C.orange, cornerRadius: 3 });
        const thumb = new Konva.Circle({ x: 0, y: 3, radius: 7, fill: C.orange, stroke: C.bg, strokeWidth: 2 });
        const valLabel = new Konva.Text({ x: sliderTrackW + 10, y: -2, text: '0%', fontSize: 10, fontFamily: 'Courier New', fill: C.orange });

        sliderGrp.add(trackRect, fillRect, thumb, valLabel);
        pg.add(sliderGrp);

        thumb.draggable(true);
        thumb.dragBoundFunc(pos => {
            // 检查是否为 hand 模式，不是则禁止拖动
            const ao = cc.sys.comps['ao'];
            if (!ao || !ao.channels || !ao.channels[ch.id] || ao.channels[ch.id].mode !== 'hand') {
                return { x: thumb.getAbsolutePosition().x, y: thumb.getAbsolutePosition().y };
            }

            const absGroupX = sliderGrp.getAbsolutePosition().x;
            const localX = pos.x - absGroupX;
            const clamped = Math.max(0, Math.min(sliderTrackW + 200, localX));
            return { x: clamped + absGroupX, y: thumb.getAbsolutePosition().y };
        });

        thumb.on('dragmove', () => {
            const ao = cc.sys.comps['ao'];
            if (ao && ao.channels && ao.channels[ch.id] && ao.channels[ch.id].mode === 'hand') {
                // 相对于 sliderGrp 的本地坐标
                const localX = thumb.x();
                applyVal(localX);
            }
        });

        // ── 安全输出配置显示和编辑 ──
        const safeModeText = new Konva.Text({ x: 214, y: y + 38, text: 'Safe: hold', fontSize: 12, fontFamily: 'Courier New', fill: C.textDim });
        pg.add(safeModeText);

        const safePresetText = new Konva.Text({ x: 314, y: y + 38, text: '', fontSize: 12, fontFamily: 'Courier New', fill: C.textDim });
        pg.add(safePresetText);

        // 模式切换事件
        safeModeText.on('click tap', () => {
            if (!isModuleAvailable(cc, 'ao')) return;
            const ao = cc.sys.comps['ao'];
            if (!ao || !ao.safeOutput || !ao.safeOutput[ch.id]) return;
            const safeOut = ao.safeOutput[ch.id];

            const curMode = safeOut.mode || 'hold';
            let presetVal = safeOut.presetPercent || 0;

            // 循环切换模式：hold → zero → preset
            const modeSeq = ['hold', 'preset', 'zero'];
            const nextMode = modeSeq[(modeSeq.indexOf(curMode) + 1) % modeSeq.length];

            const modeMap = { hold: 0, preset: 1, zero: 2 };
            const presetInt = Math.round(presetVal * 100);
            const data = [0x16, i & 0xFF, modeMap[nextMode] & 0xFF,
                (presetInt >> 8) & 0xFF, presetInt & 0xFF, 0, 0, 0];
            try {
                cc.sys.canBus.send({
                    id: CANId.encode(CAN_FUNC.AO_CMD, 2),
                    extended: false, rtr: false, dlc: 8, data,
                    sender: cc.id, timestamp: Date.now()
                });
                if (!cc.data.ao[ch.id]) cc.data.ao[ch.id] = {};
                if (!cc.data.ao[ch.id].safeOutput) cc.data.ao[ch.id].safeOutput = {};
                cc.data.ao[ch.id].safeOutput.mode = nextMode;
                cc.data.ao[ch.id].safeOutput.presetPercent = presetVal;

                safeModeText.text(`Safe: ${nextMode}`);
                safePresetText.text(nextMode === 'preset' ? `[${presetVal}%]` : '');

                setTimeout(() => {
                    cc._requestNodeConfig('ao', 0x15, i);
                }, 200);
            } catch (e) {
                console.warn('安全输出设置失败', e);
            }
            cc._refreshCache();
        });

        // 预设值修改事件（仅 preset 模式可用）
        safePresetText.on('click tap', () => {
            if (!isModuleAvailable(cc, 'ao')) return;
            const ao = cc.sys.comps['ao'];
            if (!ao || !ao.safeOutput || !ao.safeOutput[ch.id]) return;
            const safeOut = ao.safeOutput[ch.id];

            if (safeOut.mode !== 'preset') return;

            let presetVal = safeOut.presetPercent || 0;
            const input = prompt(`修改 ${ch.label} 预设值（0-100%）:`, String(presetVal));
            if (input === null) return;
            const num = parseFloat(input);
            if (isNaN(num)) return alert('请输入有效数字');
            presetVal = Math.max(0, Math.min(100, num));

            const modeMap = { hold: 0, preset: 1, zero: 2 };
            const presetInt = Math.round(presetVal * 100);
            const data = [0x16, i & 0xFF, modeMap['preset'] & 0xFF,
                (presetInt >> 8) & 0xFF, presetInt & 0xFF, 0, 0, 0];
            try {
                cc.sys.canBus.send({
                    id: CANId.encode(CAN_FUNC.AO_CMD, 2),
                    extended: false, rtr: false, dlc: 8, data,
                    sender: cc.id, timestamp: Date.now()
                });
                if (!cc.data.ao[ch.id]) cc.data.ao[ch.id] = {};
                if (!cc.data.ao[ch.id].safeOutput) cc.data.ao[ch.id].safeOutput = {};
                cc.data.ao[ch.id].safeOutput.presetPercent = presetVal;
                safePresetText.text(`[${presetVal}%]`);

                setTimeout(() => {
                    cc._requestNodeConfig('ao', 0x15, i);
                }, 200);
            } catch (e) {
                console.warn('预设值修改失败', e);
            }
            cc._refreshCache();
        });

        // 模式文本框鼠标效果
        safeModeText.on('mouseenter', () => {
            if (isModuleAvailable(cc, 'ao')) {
                safeModeText.getStage().container().style.cursor = 'pointer';
                safeModeText.fill(C.blue);
            }
        });
        safeModeText.on('mouseleave', () => {
            safeModeText.getStage().container().style.cursor = 'default';
            safeModeText.fill(C.textDim);
        });

        // 预设值文本框鼠标效果
        safePresetText.on('mouseenter', () => {
            if (isModuleAvailable(cc, 'ao')) {
                const ao = cc.sys.comps['ao'];
                if (ao && ao.safeOutput && ao.safeOutput[ch.id] && ao.safeOutput[ch.id].mode === 'preset') {
                    safePresetText.getStage().container().style.cursor = 'pointer';
                    safePresetText.fill(C.blue);
                }
            }
        });
        safePresetText.on('mouseleave', () => {
            safePresetText.getStage().container().style.cursor = 'default';
            safePresetText.fill(C.textDim);
        });

        cc._aoRows[ch.id] = { curVal, modeGrp, modeBg, modeTxt, lrvText, urvText, safeModeText, safePresetText, sliderGrp, fillRect, thumb, valLabel };
    });
}

// ── 每 tick 刷新 ──────────────────────────────
export function renderAOPage(cc) {
    const bus = cc.sys?.canBus;
    const aoOnline = bus ? bus.isNodeOnline('ao') : false;
    const ao = cc.sys.comps['ao'];

    ['ch1', 'ch2', 'ch3', 'ch4'].forEach(id => {
        const d = cc.data.ao[id];
        const row = cc._aoRows[id];
        if (!d || !row) return;

        if (!aoOnline) {
            row.curVal.text('工程值：---');
            row.curVal.fill(C.textDim);
            row.modeTxt.text('mode: --');
            row.modeTxt.fill(C.textDim);
            row.lrvText.text('LRV: --');
            row.urvText.text('URV: --');
            row.safeModeText.text('Safe: --');
            row.safeModeText.fill(C.textDim);
            row.safePresetText.text('');
            row.safePresetText.fill(C.textDim);
        } else {
            const isMa = d.type === '4-20mA';
            row.curVal.text(d.fault ? 'FAULT' : `工程值： ${isMa ? `${(d.actual ?? 4).toFixed(2)} mA` : `${(d.actual ?? 0).toFixed(0)}% PWM`}`);
            row.curVal.fill(d.fault ? C.red : C.text);

            if (ao && ao.channels && ao.channels[id]) {
                const mode = ao.channels[id].mode || 'disable';
                row.modeTxt.text(`Mode: ${mode}`);
                row.modeTxt.fill(mode === 'hand' ? C.yellow : mode === 'auto' ? C.green : C.textDim);
            }

            if (ao && ao.ranges && ao.ranges[id]) {
                const rng = ao.ranges[id];
                row.lrvText.text(`LRV: ${rng.lrv}%`);
                row.urvText.text(`URV: ${rng.urv}%`);
            }

            if (d.safeOutput) {
                const { mode, presetPercent } = d.safeOutput;
                row.safeModeText.text(`Safe: ${mode}`);
                row.safeModeText.fill(C.textDim);
                row.safePresetText.text(mode === 'preset' ? `[${presetPercent}%]` : '');
                row.safePresetText.fill(C.textDim);
            } else if (ao && ao.safeOutput && ao.safeOutput[id]) {
                const { mode, presetPercent } = ao.safeOutput[id];
                row.safeModeText.text(`Safe: ${mode}`);
                row.safeModeText.fill(C.textDim);
                row.safePresetText.text(mode === 'preset' ? `[${presetPercent}%]` : '');
                row.safePresetText.fill(C.textDim);
            }
        }
    });
}
