/**
 * dialogs.js — 模态对话框
 * 包含 AI 量程编辑器和报警阈值编辑器的 DOM 弹窗逻辑。
 */

import { CANId, CAN_FUNC } from '../CANBUS.js';
import { C } from './constants.js';

// ── 量程 / 单位编辑器 ────────────────────────
/**
 * 打开 AI 通道量程编辑对话框（上限、下限、单位）
 * @param {CentralComputer} cc
 * @param {string}          chId  'ch1'~'ch4'
 * @param {object}          refs  不使用，保留兼容签名
 */
export function openRangeEditor(cc, chId, refs) {
    const ai = cc.sys.comps['ai']; if (!ai) return;
    const range = ai.ranges?.[chId] ?? { urv: 0, lrv: 0, unit: '%' };

    const modal = _makeModal();
    const box = _makeBox(`编辑 ${chId} 量程与单位`);

    const units = ['MPa', 'bar', '°C', 'cm', 'L/min', '%'];
    box.appendChild(_makeRow('上限', '_urv', range.urv));
    box.appendChild(_makeRow('下限', '_lrv', range.lrv));
    box.appendChild(_makeSelectRow('单位', '_unit', units, range.unit));

    const { cancel, save, btnRow } = _makeBtns();
    box.appendChild(btnRow);
    modal.appendChild(box);
    cc.sys.container.appendChild(modal);

    cancel.onclick = () => modal.remove();
    save.onclick = () => {
        const urv = parseFloat(document.getElementById('_urv').value);
        const lrv = parseFloat(document.getElementById('_lrv').value);
        const unit = document.getElementById('_unit').value;
        if (isNaN(urv) || isNaN(lrv)) return alert('请输入有效的数字');

        const unitMap = { 'MPa': 1, 'bar': 2, '°C': 3, 'cm': 4, 'L/min': 5, '%': 6 };
        const chKeys = ['ch1', 'ch2', 'ch3', 'ch4'];
        const chIdx = chKeys.indexOf(chId);
        const scale = (chId === 'ch1' || chId === 'ch2') ? 100 : 10;
        const urvRaw = Math.round(urv * scale) & 0xFFFF;
        const lrvRaw = Math.round(lrv * scale) & 0xFFFF;
        const data = [0x0B, chIdx & 0xFF, (urvRaw >> 8) & 0xFF, urvRaw & 0xFF, (lrvRaw >> 8) & 0xFF, lrvRaw & 0xFF, (unitMap[unit] || 0) & 0xFF, 0];
        try {
            cc.sys.canBus.send({ id: CANId.encode(CAN_FUNC.AI_CONFIG, 1), extended: false, rtr: false, dlc: 8, data, sender: cc.id, timestamp: Date.now() });
            setTimeout(() => cc._requestNodeConfig('ai', 0x09, chIdx), 80);
        } catch (e) { console.warn(e); }
        modal.remove();
    };
}

// ── 报警阈值编辑器 ────────────────────────────
/**
 * 打开 AI 通道报警阈值编辑对话框（HH、H、L、LL）
 * @param {CentralComputer} cc
 * @param {string}          chId
 */
export function openAlarmEditor(cc, chId) {
    const ai = cc.sys.comps['ai']; if (!ai) return;
    const alarms = ai.alarms?.[chId] ?? { hh: 0, h: 0, l: 0, ll: 0 };

    const modal = _makeModal();
    const box = _makeBox(`编辑 ${chId} 报警阈值`);

    box.appendChild(_makeRow('HH', '_hh', alarms.hh));
    box.appendChild(_makeRow('H', '_h', alarms.h));
    box.appendChild(_makeRow('L', '_l', alarms.l));
    box.appendChild(_makeRow('LL', '_ll', alarms.ll));

    const { cancel, save, btnRow } = _makeBtns();
    box.appendChild(btnRow);
    modal.appendChild(box);
    cc.sys.container.appendChild(modal);

    cancel.onclick = () => modal.remove();
    save.onclick = () => {
        const hh = parseFloat(document.getElementById('_hh').value);
        const h = parseFloat(document.getElementById('_h').value);
        const l = parseFloat(document.getElementById('_l').value);
        const ll = parseFloat(document.getElementById('_ll').value);
        if ([hh, h, l, ll].some(v => isNaN(v))) return alert('请输入有效数字');

        const chIdx = ['ch1', 'ch2', 'ch3', 'ch4'].indexOf(chId);
        const scale = (chId === 'ch1' || chId === 'ch2') ? 100 : 10;
        const hhRaw = Math.round(hh * scale) & 0xFFFF;
        const llRaw = Math.round(ll * scale) & 0xFFFF;
        const hRaw = Math.round(h * scale) & 0xFFFF;
        const lRaw = Math.round(l * scale) & 0xFFFF;
        const data1 = [0x03, chIdx & 0xFF, (hhRaw >> 8) & 0xFF, hhRaw & 0xFF, (llRaw >> 8) & 0xFF, llRaw & 0xFF, 0, 0];
        const data2 = [0x04, chIdx & 0xFF, (hRaw >> 8) & 0xFF, hRaw & 0xFF, (lRaw >> 8) & 0xFF, lRaw & 0xFF, 0, 0];
        try {
            cc.sys.canBus.send({ id: CANId.encode(CAN_FUNC.AI_CONFIG, 1), extended: false, rtr: false, dlc: 8, data: data1, sender: cc.id, timestamp: Date.now() });
            setTimeout(() => cc.sys.canBus.send({ id: CANId.encode(CAN_FUNC.AI_CONFIG, 1), extended: false, rtr: false, dlc: 8, data: data2, sender: cc.id, timestamp: Date.now() }), 30);
            setTimeout(() => { cc._requestNodeConfig('ai', 0x07, chIdx); cc._requestNodeConfig('ai', 0x08, chIdx); }, 120);
        } catch (e) { console.warn(e); }
        modal.remove();
    };
}

// ── DOM 工具函数 ──────────────────────────────

function _makeModal() {
    const el = document.createElement('div');
    el.style = 'position:fixed;left:0;top:0;right:0;bottom:0;background:rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;z-index:10000;';
    return el;
}

function _makeBox(title) {
    const el = document.createElement('div');
    el.style = 'background:#fff;padding:16px;border-radius:6px;width:320px;font-family:sans-serif;';
    el.innerHTML = `<h3 style="margin:0 0 8px 0">${title}</h3>`;
    return el;
}

function _makeRow(label, id, val) {
    const row = document.createElement('div');
    row.style = 'margin-bottom:8px;';
    row.innerHTML = `<label style="display:block;font-size:12px;color:#333">${label}</label><input id="${id}" style="width:100%;padding:8px;box-sizing:border-box" value="${val}">`;
    return row;
}

function _makeSelectRow(label, id, options, selected) {
    const row = document.createElement('div');
    row.style = 'margin-bottom:8px;';
    const opts = options.map(u => `<option value="${u}" ${u === selected ? 'selected' : ''}>${u}</option>`).join('');
    row.innerHTML = `<label style="display:block;font-size:12px;color:#333">${label}</label><select id="${id}" style="width:100%;padding:8px;box-sizing:border-box">${opts}</select>`;
    return row;
}

function _makeBtns() {
    const btnRow = document.createElement('div');
    btnRow.style = 'text-align:right;margin-top:10px;';
    const cancel = document.createElement('button');
    cancel.innerText = '取消';
    cancel.style = 'margin-right:8px;padding:6px 10px';
    const save = document.createElement('button');
    save.innerText = '保存';
    save.style = 'padding:6px 10px;background:#1395eb;color:#fff;border:none;border-radius:4px';
    btnRow.appendChild(cancel);
    btnRow.appendChild(save);
    return { cancel, save, btnRow };
}