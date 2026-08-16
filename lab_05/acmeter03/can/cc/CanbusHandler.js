/**
 * canBusHandler.js — CAN 总线通信层
 *
 * 包含：
 *  - onCanReceive()        总线帧接收入口（由 CANBus._dispatch() 调用）
 *  - 各节点上报/回复处理函数  _canHandleXxx()
 *  - 下行指令发送函数         _canSendXxx()
 *  - NMT 网络管理函数         _startAllNodes / _stopAllNodes / _resetAllNodes
 *  - 参数请求函数             _requestNodeConfig()
 *  - AI 参数读取辅助           _initAIParams()
 *
 * CAN 帧 ID 编码规则（本系统）：
 *   CANId.encode(funcCode, nodeAddr)
 *   bit[10:7] = funcCode (4位)    bit[6:0] = nodeAddr (7位)
 *
 * 节点地址分配：
 *   0 中央计算机（主站）
 *   1 AI  2 AO  3 DI  4 DO
 */

import { CANId, CAN_FUNC, CANParser, NMT_CMD, NMT_STATE } from '../CANBUS.js';

// ══════════════════════════════════════════
//  CAN 接收入口
// ══════════════════════════════════════════

export function onCanReceive(cc, frame) {
    //通信状态检查：如果控制器 (cc) 处于通信故障状态 (commFault) 或者总线未连接 (busConnected)，直接返回，不处理任何数据。
    if (cc.commFault || !cc.busConnected) return;
    //帧有效性检查：确保 frame 对象存在，且其 id 是有效的数字类型。
    if (!frame || typeof frame.id !== 'number') return;
    // 提取功能码 (如：AI_REPORT, NMT等)
    const funcCode = CANId.funcCode(frame.id);
    // 提取节点地址 (如：1, 2, 3, 4)
    const nodeAddr = CANId.nodeAddr(frame.id);

    if (funcCode === CAN_FUNC.NMT) return; // 主站不处理自发的 NMT 回环

    //代码使用 switch 语句根据 nodeAddr（节点地址）将消息路由到不同的处理逻辑。
    switch (nodeAddr) {
        case 1:
            //处理模拟量输入的主动上报（可能是周期性数据）。
            if (funcCode === CAN_FUNC.AI_REPORT) canHandleAIReport(cc, frame, nodeAddr);
            // 处理对模拟量输入读取请求的回复。
            else if (funcCode === CAN_FUNC.AI_REPLY) canHandleAIReply(cc, frame, nodeAddr);
            break;
        case 2:
            if (funcCode === CAN_FUNC.AO_STATUS) canHandleAOStatus(cc, frame, nodeAddr);
            else if (funcCode === CAN_FUNC.AO_REPLY) canHandleAOReply(cc, frame, nodeAddr);
            break;
        case 3:
            if (funcCode === CAN_FUNC.DI_REPORT) canHandleDIReport(cc, frame, nodeAddr);
            else if (funcCode === CAN_FUNC.DI_REPLY) canHandleDIReply(cc, frame, nodeAddr);
            break;
        case 4:
            if (funcCode === CAN_FUNC.DO_STATUS) canHandleDOStatus(cc, frame, nodeAddr);
            else if (funcCode === CAN_FUNC.DO_REPLY) canHandleDOReply(cc, frame, nodeAddr);
            break;
    }
}

// ══════════════════════════════════════════
//  接收处理 — AI,它的主要职责是解析从站发来的模拟量数据，进行单位换算，检测硬件故障，并在检测到故障时触发主站的重配置流程。
// ══════════════════════════════════════════

export function canHandleAIReport(cc, frame, nodeAddr) {
    //使用 CANParser 工具将原始的 CAN 帧数据解析为结构化的对象（包含 ch1 到 ch4 的信息）。
    const parsed = CANParser.parseAIReport(frame);
    if (!parsed) return;

    let hasError = false;
    // ch1, ch2: scale=100 (2位小数)；ch3, ch4: scale=10 (1位小数)
    const scaleMap = { ch1: 100, ch2: 100, ch3: 10, ch4: 10 };

    ['ch1', 'ch2', 'ch3', 'ch4'].forEach(id => {
        const ch = parsed[id]; if (!ch) return;
        //特定值判错：0x8000 (两补码表示的 -32768) 代表传感器故障
        if (ch.raw === -32768 || ch.raw === 0x8000) {
            //一旦检测到该值，将该通道的 fault 标记设为 true，并设置全局标志 hasError = true。
            cc.data.ai[id].fault = true;
            hasError = true;
        } else {
            cc.data.ai[id].fault = false;
            //工程单位换算：将原始值 (raw) 除以对应的 scale（不再从 parseAIReport 中获取，而是按通道类型使用）
            const scale = scaleMap[id];
            cc.data.ai[id].value = ch.raw / scale;
        }
    });
    //  如果任意一个通道出现了故障（hasError 为 true），主站会调用 _requestNodeConfig。获取具体的故障信息。
    if (hasError) cc._requestNodeConfig('ai', 0x0A, 0);
    // 更新该节点（节点 1）的最后一次通信时间戳。这通常用于看门狗机制，如果长时间没有收到该节点的数据，主站会判定节点离线。
    cc._canNodeLastSeen[nodeAddr] = Date.now();
}
// ══════════════════════════════════════════
//  节点 1（模拟量输入模块） 的配置与状态查询应答处理函数.与之前的 canHandleAIReport 处理周期性数据不同，这个函数专门处理主站主动查询后的回复。它解析从站返回的配置参数（量程、单位、报警阈值）以及详细的故障/报警状态。
// ══════════════════════════════════════════

export function canHandleAIReply(cc, frame, nodeAddr) {
    if (!frame || frame.data.length < 5) return;
    const cmd = frame.data[0];  // 命令字，决定后续解析逻辑
    const chKeys = ['ch1', 'ch2', 'ch3', 'ch4'];

    // 0x09 — 量程/单位
    if (cmd === 0x09) {
        const chIdx = frame.data[1] & 0x03;  // 通道识别：frame.data[1] 的低 2 位表示通道索引（0-3）。
        const chId = chKeys[chIdx];
        // 使用有符号 16 位整数处理（将两字节转为有符号数）
        const urvRaw = _bytesToInt16(frame.data[2], frame.data[3]);
        const lrvRaw = _bytesToInt16(frame.data[4], frame.data[5]);
        // ch1, ch2: scale=100 (2位小数)；ch3, ch4: scale=10 (1位小数)
        const scale = (chId === 'ch1' || chId === 'ch2') ? 100 : 10;
        const urv = urvRaw / scale;  //量程转换：根据通道类型除以对应的 scale
        const lrv = lrvRaw / scale;
        const unitMap = { 1: 'MPa', 2: 'bar', 3: '°C', 4: 'cm', 5: 'L/min', 6: '%' };
        // 单位映射：通过 unitMap 将数字代码（1, 2, 3...）转换为字符串（'MPa', 'bar', '°C'...）。
        const unit = unitMap[frame.data[6] & 0xFF] || '--';
        if (!cc.data.ai[chId]) cc.data.ai[chId] = {};
        // 状态更新：将解析出的上限 (urv)、下限 (lrv) 和单位存入 cc.data.ai[chId].ranges。
        cc.data.ai[chId].ranges = { urv, lrv, unit };
        cc.data.ai[chId].unit = unit;
        console.log(`[CC] 收到AI 0x09响应 ${chId} urv=${urv} lrv=${lrv} unit=${unit}`);
        // UI 刷新：调用 cc._updateAIRowFromModule 更新界面显示。
        cc._updateAIRowFromModule(chId);
        cc._canNodeLastSeen[nodeAddr] = Date.now();
        return;
    }

    // 0x07 — HH / LL
    if (cmd === 0x07) {
        const chId = chKeys[frame.data[1] & 0x03];
        const hhRaw = _bytesToInt16(frame.data[2], frame.data[3]);
        const llRaw = _bytesToInt16(frame.data[4], frame.data[5]);
        // ch1, ch2: scale=100 (2位小数)；ch3, ch4: scale=10 (1位小数)
        const scale = (chId === 'ch1' || chId === 'ch2') ? 100 : 10;
        const hh = hhRaw / scale;
        const ll = llRaw / scale;
        if (!cc.data.ai[chId]) cc.data.ai[chId] = {};
        if (!cc.data.ai[chId].alarms) cc.data.ai[chId].alarms = {};
        cc.data.ai[chId].alarms.hh = hh;
        cc.data.ai[chId].alarms.ll = ll;
        console.log(`[CC] 收到AI 0x07响应 ${chId} HH=${hh} LL=${ll}`);
        cc._updateAIRowFromModule(chId);
        cc._canNodeLastSeen[nodeAddr] = Date.now();
        return;
    }

    // 0x08 — H / L
    if (cmd === 0x08) {
        const chId = chKeys[frame.data[1] & 0x03];
        const hRaw = _bytesToInt16(frame.data[2], frame.data[3]);
        const lRaw = _bytesToInt16(frame.data[4], frame.data[5]);
        // ch1, ch2: scale=100 (2位小数)；ch3, ch4: scale=10 (1位小数)
        const scale = (chId === 'ch1' || chId === 'ch2') ? 100 : 10;
        const h = hRaw / scale;
        const l = lRaw / scale;
        if (!cc.data.ai[chId]) cc.data.ai[chId] = {};
        if (!cc.data.ai[chId].alarms) cc.data.ai[chId].alarms = {};
        cc.data.ai[chId].alarms.h = h;
        cc.data.ai[chId].alarms.l = l;
        console.log(`[CC] 收到AI 0x08响应 ${chId} H=${h} L=${l}`);
        cc._updateAIRowFromModule(chId);
        cc._canNodeLastSeen[nodeAddr] = Date.now();
        return;
    }

    // 0x0A — 总体报警 / 故障状态
    if (cmd === 0x0A) {
        const faultMap = { 0: 'normal', 1: 'OPEN', 2: 'SHORT', 3: 'OUTRANGE' };
        const faultText = { OPEN: '开路', SHORT: '短路', OUTRANGE: '超量程', normal: 'normal' };
        const alarmText = { LL: '低低限', L: '低限', H: '高限', HH: '高高限', normal: 'normal', FAULT: 'FAULT' };

        chKeys.forEach((chId, idx) => {
            const statusByte = frame.data[idx + 1] || 0;
            const faultCode = statusByte & 0x0F;
            if (!cc.data.ai[chId]) cc.data.ai[chId] = {};

            const faultStatus = faultMap[faultCode] || 'normal';
            cc.data.ai[chId].fault = faultCode !== 0;
            cc.data.ai[chId].faultText = faultText[faultStatus] || 'normal';

            const cached = cc.data.ai[chId] || {};
            const aiMod = cc.sys?.comps?.['ai'] ?? null;
            const val = cached.value ?? aiMod?.channels?.[chId]?.value;
            const almCfg = cached.alarms ?? aiMod?.alarms?.[chId] ?? {};
            const { hh, h, l, ll } = almCfg;

            let alarmCode = 'normal';
            if (cc.data.ai[chId].fault) {
                alarmCode = 'FAULT';
            } else if (val !== undefined && !isNaN(val)) {
                if (hh !== undefined && val >= hh) alarmCode = 'HH';
                else if (h !== undefined && val >= h) alarmCode = 'H';
                else if (ll !== undefined && val <= ll) alarmCode = 'LL';
                else if (l !== undefined && val <= l) alarmCode = 'L';
            }
            cc.data.ai[chId].alarm = alarmText[alarmCode];
        });

        cc._updateAIChannelDisplay?.();
        cc._canNodeLastSeen[nodeAddr] = Date.now();
    }
    if (cmd === 0xEE) {

        const idHex = '0x' + frame.id.toString(16);
        const test = '0x' + frame.data[0].toString(16);
        // 1. 截取从索引 1 开始的所有数据
        const slice = frame.data.slice(1);
        // 2. 找到第一个 0 的位置（字符串结束符）
        const zeroIndex = slice.indexOf(0);
        // 3. 如果找到了 0，就截取到 0 为止；如果没找到（全是有效字符），就保留全部
        const validBytes = zeroIndex !== -1 ? slice.slice(0, zeroIndex) : slice;
        // 4. 转回字符串
        const str = String.fromCharCode(...validBytes);
        cc._appendNetDiagLog(`RX TEST reply-> id=${idHex} addr=${nodeAddr} cmd=${test} 设备ID是：${str}`);
        cc._canNodeLastSeen[nodeAddr] = Date.now();
    }
}

// ══════════════════════════════════════════
//  接收处理 — AO
// ══════════════════════════════════════════

export function canHandleAOStatus(cc, frame, nodeAddr) {
    const parsed = CANParser.parseAOStatus(frame);
    if (!parsed) return;
    const maToPct = (mA100) => Math.max(0, Math.min(100, ((mA100 / 100) - 4) / 16 * 100));
    cc.data.ao.ch1.actual = parsed.ch1mA100 / 100;
    cc.data.ao.ch1.percent = maToPct(parsed.ch1mA100);
    cc.data.ao.ch2.actual = parsed.ch2mA100 / 100;
    cc.data.ao.ch2.percent = maToPct(parsed.ch2mA100);
    cc.data.ao.ch3.actual = parsed.ch3Pct;
    cc.data.ao.ch3.percent = parsed.ch3Pct;
    cc.data.ao.ch4.actual = parsed.ch4Pct;
    cc.data.ao.ch4.percent = parsed.ch4Pct;
    ['ch1', 'ch2', 'ch3', 'ch4'].forEach((id, i) => {
        cc.data.ao[id].fault = !!(parsed.faultByte & (1 << i));
    });
    cc._canNodeLastSeen[nodeAddr] = Date.now();
}

export function canHandleAOReply(cc, frame, nodeAddr) {
    // 处理 AO 回复（参数或安全输出配置）
    // Data[0]: 通道索引 (0-3)
    if (frame.data[0] === 0xEE) {

        const idHex = '0x' + frame.id.toString(16);
        const test = '0x' + frame.data[0].toString(16);
        // 1. 截取从索引 1 开始的所有数据
        const slice = frame.data.slice(1);
        // 2. 找到第一个 0 的位置（字符串结束符）
        const zeroIndex = slice.indexOf(0);
        // 3. 如果找到了 0，就截取到 0 为止；如果没找到（全是有效字符），就保留全部
        const validBytes = zeroIndex !== -1 ? slice.slice(0, zeroIndex) : slice;
        // 4. 转回字符串
        const str = String.fromCharCode(...validBytes);
        cc._appendNetDiagLog(`RX TEST reply-> id=${idHex} addr=${nodeAddr} cmd=${test} 设备ID是：${str}`);
        cc._canNodeLastSeen[nodeAddr] = Date.now();
        return;
    }    
    cc._canNodeLastSeen[nodeAddr] = Date.now();

    if (!frame.data || frame.data.length < 6) return;

    const chIdx = frame.data[0] & 0xFF;
    const chKeys = ['ch1', 'ch2', 'ch3', 'ch4'];
    if (chIdx >= 4) return;

    const chId = chKeys[chIdx];
    if (!cc.data.ao[chId]) cc.data.ao[chId] = {};

    // 判断回复类型：检查 Data[4-5] 是否为 0
    // 如果 Data[4-5] 都是 0，则为安全输出回复；否则为参数回复
    const isSafeOutputReply = (frame.data[4] === 0x00 && frame.data[5] === 0x00);

    if (isSafeOutputReply) {
        // 安全输出配置回复
        // Data[1]: 模式 (0=hold, 1=preset, 2=zero)
        // Data[2-3]: 预设值 × 100
        const mode = frame.data[1] & 0xFF;
        const presetInt = (frame.data[2] << 8) | frame.data[3];
        const modeStr = mode === 0 ? 'hold' : mode === 1 ? 'preset' : 'zero';
        const presetPercent = Math.max(0, Math.min(100, presetInt / 100));

        if (!cc.data.ao[chId].safeOutput) cc.data.ao[chId].safeOutput = {};
        cc.data.ao[chId].safeOutput.mode = modeStr;
        cc.data.ao[chId].safeOutput.presetPercent = presetPercent;
    } else {
        // 参数回复（LRV/URV）
        // Data[1]: 模式 (0=hand, 1=auto, 2=disable)
        // Data[2-3]: LRV × 100
        // Data[4-5]: URV × 100
        const mode = frame.data[1] & 0xFF;
        const lrvInt = (frame.data[2] << 8) | frame.data[3];
        const urvInt = (frame.data[4] << 8) | frame.data[5];
        const modeStr = mode === 0 ? 'hand' : mode === 1 ? 'auto' : 'disable';
        const lrv = Math.max(0, Math.min(100, lrvInt / 100));
        const urv = Math.max(0, Math.min(100, urvInt / 100));

        cc.data.ao[chId].mode = modeStr;
        cc.data.ao[chId].lrv = lrv;
        cc.data.ao[chId].urv = urv;
    }
}

// ══════════════════════════════════════════
//  接收处理 — DI
// ══════════════════════════════════════════

export function canHandleDIReport(cc, frame, nodeAddr) {
    const parsed = CANParser.parseDIReport(frame);
    if (!parsed) return;
    ['ch1', 'ch2', 'ch3', 'ch4'].forEach((id, i) => {
        const newState = parsed[`${id}State`];
        const fault = !!(parsed.faultByte & (1 << i));
        const alarm = !!(parsed.alarmByte & (1 << i));  // 解析报警字节
        if (newState && !cc._diPrevState[id]) {
            cc.data.di[id].counter = (cc.data.di[id].counter || 0) + 1;
        }
        cc._diPrevState[id] = newState;
        cc.data.di[id].state = newState;
        cc.data.di[id].fault = fault;
        cc.data.di[id].alarm = alarm;  // 存储报警状态
    });
    cc._canNodeLastSeen[nodeAddr] = Date.now();
}

export function canHandleDIReply(cc, frame, nodeAddr) {
    // 解析报警触发配置回复
    if (!frame || frame.data.length < 3) return;
    const cmd = frame.data[0];  // 命令字

    // 0x04 — 报警触发方式回复（查询）
    if (cmd === 0x04) {
        const chIdx = frame.data[1];  // 通道索引 (0-3)
        const triggerValue = frame.data[2];  // 触发值 (0=OFF, 1=ON, 2=NONE)
        const chKeys = ['ch1', 'ch2', 'ch3', 'ch4'];

        if (chIdx >= 0 && chIdx < 4) {
            const chId = chKeys[chIdx];
            const triggerMap = { 0: 'OFF', 1: 'ON', 2: 'NONE' };
            const trigger = triggerMap[triggerValue] || 'OFF';

            if (!cc.data.di[chId]) cc.data.di[chId] = {};
            cc.data.di[chId].trigger = trigger;
            console.log(`[CC] 收到DI报警配置回复 ${chId} trigger=${trigger}`);
        }
    }

    // 0x01 — 报警触发方式回复（修改）
    if (cmd === 0x01) {
        const chIdx = frame.data[1];  // 通道索引 (0-3)
        const triggerValue = frame.data[2];  // 触发值 (0=OFF, 1=ON, 2=NONE)
        const chKeys = ['ch1', 'ch2', 'ch3', 'ch4'];

        if (chIdx >= 0 && chIdx < 4) {
            const chId = chKeys[chIdx];
            const triggerMap = { 0: 'OFF', 1: 'ON', 2: 'NONE' };
            const trigger = triggerMap[triggerValue] || 'OFF';

            if (!cc.data.di[chId]) cc.data.di[chId] = {};
            cc.data.di[chId].trigger = trigger;
            console.log(`[CC] 收到DI报警配置修改回复 ${chId} trigger=${trigger}`);
        }
    }
    if (cmd === 0xEE) {
        const idHex = '0x' + frame.id.toString(16);
        const test = '0x' + frame.data[0].toString(16);
        // 1. 截取从索引 1 开始的所有数据
        const slice = frame.data.slice(1);
        // 2. 找到第一个 0 的位置（字符串结束符）
        const zeroIndex = slice.indexOf(0);
        // 3. 如果找到了 0，就截取到 0 为止；如果没找到（全是有效字符），就保留全部
        const validBytes = zeroIndex !== -1 ? slice.slice(0, zeroIndex) : slice;
        // 4. 转回字符串
        const str = String.fromCharCode(...validBytes);
        cc._appendNetDiagLog(`RX TEST reply-> id=${idHex} addr=${nodeAddr} cmd=${test} 设备ID是：${str}`);
    }
    cc._canNodeLastSeen[nodeAddr] = Date.now();
}

// ══════════════════════════════════════════
//  接收处理 — DO
// ══════════════════════════════════════════

export function canHandleDOStatus(cc, frame, nodeAddr) {
    const parsed = CANParser.parseDOStatus(frame);
    if (!parsed) return;
    ['ch1', 'ch2', 'ch3', 'ch4'].forEach((id, i) => {
        cc.data.do[id].state = parsed[`${id}State`];
        cc.data.do[id].fault = !!(parsed.faultByte & (1 << i));
        cc.data.do[id].hold = !!(parsed.holdByte & (1 << i));
    });
    cc._canNodeLastSeen[nodeAddr] = Date.now();
}

export function canHandleDOReply(cc, frame, nodeAddr) {
    cc._canNodeLastSeen[nodeAddr] = Date.now();
    if (!frame || !frame.data || frame.data.length < 4) return;

    const cmd    = frame.data[0];
    const chIdx  = frame.data[1] & 0x03;
    const chKeys = ['ch1', 'ch2', 'ch3', 'ch4'];
    const chId   = chKeys[chIdx];
    if (!chId) return;

    if (!cc.data.do[chId]) cc.data.do[chId] = {};
    const doMod = cc.sys?.comps?.['do'];

    // 0x20 — 通道模式回复
    if (cmd === 0x20) {
        const modeNames = ['hand', 'auto', 'pulse', 'disable'];
        const mode = modeNames[frame.data[2] & 0x03] || 'hand';
        cc.data.do[chId].mode = mode;
        if (doMod?.channels?.[chId]) doMod.channels[chId].mode = mode;
        cc._updateDORowFromModule(chId);
        return;
    }

    // 0x21 — 脉冲参数回复
    if (cmd === 0x21) {
        const onMs  = (frame.data[2] << 8) | frame.data[3];
        const offMs = (frame.data[4] << 8) | frame.data[5];
        const phMs  = (frame.data[6] << 8) | frame.data[7];
        cc.data.do[chId].pulse = { onMs, offMs, phaseMs: phMs };
        if (doMod?.pulseConfig?.[chId]) {
            doMod.pulseConfig[chId].onMs  = onMs;
            doMod.pulseConfig[chId].offMs = offMs;
            doMod.pulseConfig[chId].phaseStart = phMs;
        }
        cc._updateDORowFromModule(chId);
        return;
    }

    // 0x22 — 安全输出模式回复
    if (cmd === 0x22) {
        const safeModes  = ['off', 'hold', 'preset'];
        const safeMode   = safeModes[frame.data[2] & 0x03] || 'off';
        const presetState = !!(frame.data[3] & 0x01);
        cc.data.do[chId].safeMode    = safeMode;
        cc.data.do[chId].presetState = presetState;
        if (doMod?.safeOutput?.[chId]) {
            doMod.safeOutput[chId].mode        = safeMode;
            doMod.safeOutput[chId].presetState = presetState;
        }
        cc._updateDORowFromModule(chId);
        return;
    }

    // 0xEE — 测试回复
    if (cmd === 0xEE) {
        const idHex = '0x' + frame.id.toString(16);
        const slice = frame.data.slice(1);
        const zeroIndex = slice.indexOf(0);
        const validBytes = zeroIndex !== -1 ? slice.slice(0, zeroIndex) : slice;
        const str = String.fromCharCode(...validBytes);
        cc._appendNetDiagLog(`RX TEST reply-> id=${idHex} addr=${nodeAddr} cmd=0xEE 设备ID是：${str}`);
    }
}

// ══════════════════════════════════════════
//  发送函数
// ══════════════════════════════════════════

/** 发送 AO 输出指令（手动通道） */
export function canSendAOCommand(cc) {
    const bus = cc.sys?.canBus;
    if (!bus || cc.commFault || !cc.busConnected) return;
    const [ch1, ch2, ch3, ch4] = ['ch1', 'ch2', 'ch3', 'ch4'].map(id =>
        cc.aoManual[id] ? (cc.aoManualVal[id] ?? 0) : null
    );
    try { bus.sendCommand(cc.id, CAN_FUNC.AO_CMD, 2, CANParser.buildAOCmd(ch1, ch2, ch3, ch4)); } catch (_) { }
}

/** 发送 DO 输出指令（手动通道） */
export function canSendDOCommand(cc) {
    const bus = cc.sys?.canBus;
    if (!bus || cc.commFault || !cc.busConnected) return;
    const [ch1, ch2, ch3, ch4] = ['ch1', 'ch2', 'ch3', 'ch4'].map(id =>
        cc.doManual[id] ? cc.doManualState[id] : undefined
    );
    try { bus.sendCommand(cc.id, CAN_FUNC.DO_CMD, 4, CANParser.buildDOCmd(ch1, ch2, ch3, ch4)); } catch (_) { }
}

/** 发送 NMT 网络管理帧 */
export function canSendNMT(cc, cmd, targetAddr = 0) {
    const bus = cc.sys?.canBus;
    if (!bus || cc.commFault || !cc.busConnected) return;
    try { bus.sendNMT(cc.id, cmd, targetAddr); } catch (_) { }
}

// ══════════════════════════════════════════
//  NMT 网络管理
// ══════════════════════════════════════════

export function startAllNodes(cc) {
    if (!cc.sys?.canBus || !cc.busConnected || cc.commFault) return;
    console.log('[CC] NMT: Starting all nodes...');
    cc.sys.canBus.sendNMT(cc.id, NMT_CMD.START, 0);
    cc.nmtNodeStates.ai = cc.nmtNodeStates.ao = cc.nmtNodeStates.di = cc.nmtNodeStates.do = NMT_STATE.RUN;
}

export function stopAllNodes(cc) {
    if (!cc.sys?.canBus || !cc.busConnected || cc.commFault) return;
    console.log('[CC] NMT: Stopping all nodes...');
    cc.sys.canBus.sendNMT(cc.id, NMT_CMD.STOP, 0);
    cc.nmtNodeStates.ai = cc.nmtNodeStates.ao = cc.nmtNodeStates.di = cc.nmtNodeStates.do = NMT_STATE.STOP;
}

export function resetAllNodes(cc) {
    if (!cc.sys?.canBus || !cc.busConnected || cc.commFault) return;
    console.log('[CC] NMT: Resetting all nodes...');
    cc.sys.canBus.sendNMT(cc.id, NMT_CMD.RESET, 0);
    cc.nmtNodeStates.ai = cc.nmtNodeStates.ao = cc.nmtNodeStates.di = cc.nmtNodeStates.do = NMT_STATE.INIT;
}

export function sendNMTCommand(cc, nodeType, cmd) {
    if (!cc.sys?.canBus || cc.commFault || !cc.busConnected) return;
    const nodeAddrs = { ai: 1, ao: 2, di: 3, do: 4 };
    const addr = nodeAddrs[nodeType]; if (!addr) return;
    console.log(`[CC] NMT: Sending 0x${cmd.toString(16)} to ${nodeType}(addr = ${addr})`);
    cc.sys.canBus.sendNMT(cc.id, cmd, addr);
    if (cmd === NMT_CMD.START) cc.nmtNodeStates[nodeType] = NMT_STATE.RUN;
    else if (cmd === NMT_CMD.STOP) cc.nmtNodeStates[nodeType] = NMT_STATE.STOP;
    else if (cmd === NMT_CMD.RESET) cc.nmtNodeStates[nodeType] = NMT_STATE.INIT;
}

// ══════════════════════════════════════════
//  参数查询
// ══════════════════════════════════════════

/**
 * 向节点发送参数读取请求帧
 * @param {CentralComputer} cc
 * @param {string}  nodeType   'ai' | 'ao' | 'di' | 'do'
 * @param {number}  configCmd  命令字节 (0x07, 0x08, 0x09, 0x0A …)
 * @param {number}  param      附加参数（如通道索引）
 */
export function requestNodeConfig(cc, nodeType, configCmd, param = 0) {
    if (!cc.sys?.canBus) return;
    if (cc.commFault || !cc.busConnected) {
        if (cc.nodeConfigs?.[nodeType]) cc.nodeConfigs[nodeType].pending = true;
        return;
    }
    const funcCodes = { ai: CAN_FUNC.AI_CONFIG, ao: CAN_FUNC.AO_CMD, di: CAN_FUNC.DI_CONFIG, do: CAN_FUNC.DO_CMD };
    const nodeAddrs = { ai: 1, ao: 2, di: 3, do: 4 };
    const funcCode = funcCodes[nodeType];
    const addr = nodeAddrs[nodeType];
    if (!funcCode || !addr) return;
    cc.sys.canBus.send({
        id: CANId.encode(funcCode, addr),
        extended: false, rtr: false, dlc: 8,
        data: [configCmd, param & 0xFF, 0, 0, 0, 0, 0, 0],
        sender: cc.id, timestamp: Date.now(),
    });
}

/** 批量请求 AI 模块所有通道的初始参数 */
export function initAIParams(cc) {
    ['ch1', 'ch2', 'ch3', 'ch4'].forEach((_, idx) => {
        cc._requestNodeConfig('ai', 0x09, idx);
        setTimeout(() => cc._requestNodeConfig('ai', 0x07, idx), 40 + idx * 10);
        setTimeout(() => cc._requestNodeConfig('ai', 0x08, idx), 80 + idx * 10);
    });
    setTimeout(() => cc._requestNodeConfig('ai', 0x0A, 0), 300);
}

/**
 * 辅助方法：将两个字节转为有符号 16 位整数
 * @param {number} b1 高字节
 * @param {number} b2 低字节
 * @returns {number} 有符号 16 位整数值
 */
export function _bytesToInt16(b1, b2) {
    let value = ((b1 << 8) | b2);
    // 如果最高位为 1，则是负数（两补码）
    if (value & 0x8000) {
        value = -(0x10000 - value);
    }
    return value;
}

export function initAOParams(cc) {
    // 初始化时读取AO模块的4个通道的参数（模式、LRV、URV、安全输出配置）
    ['ch1', 'ch2', 'ch3', 'ch4'].forEach((_, idx) => {
        // 发送0x14参数读取请求
        setTimeout(() => {
            cc._requestNodeConfig('ao', 0x14, idx);
        }, 40 + idx * 10);

        // 发送0x15安全输出配置读取请求
        setTimeout(() => {
            cc._requestNodeConfig('ao', 0x15, idx);
        }, 80 + idx * 10);
    });
}

/** 批量请求 DI 模块所有通道的初始参数（报警触发方式） */
export function initDIParams(cc) {
    // 发送 0x04 查询重计：需要阐读每个通道的报警触发配置
    ['ch1', 'ch2', 'ch3', 'ch4'].forEach((_, idx) => {
        setTimeout(() => {
            cc._requestNodeConfig('di', 0x04, idx);  // 0x04: 查询报警配置
        }, 40 + idx * 10);
    });
}

/** 批量请求 DO 模块所有通道的初始参数（模式、脉冲参数、安全输出） */
export function initDOParams(cc) {
    ['ch1', 'ch2', 'ch3', 'ch4'].forEach((_, idx) => {
        setTimeout(() => cc._requestNodeConfig('do', 0x20, idx), 40  + idx * 15); // 通道模式
        setTimeout(() => cc._requestNodeConfig('do', 0x21, idx), 110 + idx * 15); // 脉冲参数
        setTimeout(() => cc._requestNodeConfig('do', 0x22, idx), 180 + idx * 15); // 安全输出
    });
}