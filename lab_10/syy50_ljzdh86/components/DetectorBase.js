import { BaseComponent } from './BaseComponent.js';
import { CANId, CAN_FUNC, NMT_CMD, NMT_STATE, CAN_TICK_INTERVAL } from '../can/CANBUS.js';

/**
 * DetectorBase — 火灾探测/报警器件基类（CAN 总线节点）
 *
 * 作为可寻址探测回路设备，向上与各子类共用：
 *   · 供电端口 vcc(p)/gnd，总线端口 can1p(p)/can1n；
 *   · CAN 节点行为：NMT 管理、心跳、周期上报、被控制器隔离；
 *   · 视觉：底座 + 探头 + 状态指示灯（绿=正常 / 红=火警 / 黄=隔离 / 橙=故障）。
 *
 * 子类仅需提供 TYPE / LABEL / 探头外观即可（见 SmokeDetector 等）。
 * 遵循新组件模板：`_initGroups → _recalcGeometry → _initParameters → _init`，最后 addPort。
 */
export class DetectorBase extends BaseComponent {
    // 子类覆盖：探测器类型标识（供 CANBus._inferSubscriptions 识别）
    static TYPE = 'Detector';
    static LABEL = '探测器';
    static ACCENT = '#e74c3c';   // 探头主色

    constructor(config, sys) {
        super(config, sys);

        this.type    = this.constructor.TYPE;
        this.special = 'can';
        this.isDetector = true;   // 供地址写入器识别探测器
        this.cache   = 'fixed';

        this._initGroups();
        this._recalcGeometry(config);
        this._initParameters(config);
        this._init();

        this.config = {
            id: this.id, label: this.label, scale: this.scale,
            nodeAddress: this.nodeAddress, loop: this.loop, zone: this.zone,
        };

        // 端口：CAN 总线接口置于上方（向上与总线连接器引出端口相接），总线供电
        this.addPort(this.W / 2 - 16, 0, 'can1p', 'wire', 'p');
        this.addPort(this.W / 2 + 16, 0, 'can1n', 'wire');
    }

    // ═══════════════════════════════════════════════════════
    // 几何 / 参数
    // ═══════════════════════════════════════════════════════

    _recalcGeometry(_config) {
        // 宽度与高度相对原设计均增加 1/2（120×130 → 180×195）
        this.W = 180;
        this.H = 195;
        this._cx = this.W / 2;
        this._cy = this.H * 0.40;   // 圆盘中心
        this._R  = this.W * 0.43;   // 圆盘外径
    }

    _initParameters(config) {
        this.label       = config.label || this.constructor.LABEL;
        this.nodeAddress = (config.nodeAddress !== undefined) ? config.nodeAddress : 1;
        this.loop        = config.loop || 1;      // 所属 CAN 回路（1/2）
        this.zone        = config.zone || 1;      // 所属防区 ZONE（1~4）

        // CAN 节点状态
        this.powerOn        = false;
        this.busConnected   = false;
        this.commFault      = false;
        this.nmtState       = NMT_STATE.INIT;
        this._lastHeartbeat = 0;
        this.heartbeatTimeout = 5000;
        this.txInterval     = 200;
        this.lastTxTime     = 0;
        this.txCount        = 0;
        this.rxCount        = 0;

        // 探测状态
        this.alarming     = false;  // 火警（= 人工触发 或 外部激励）
        this._manualAlarm = false;  // 人工/测试触发的火警（锁存，须复位/再次点击清除）
        this.stimulus     = false;  // 外部激励（打火机/烟雾/热风）：信号消失即自动撤销报警
        this.isolated  = false;   // 被控制器隔离
        this.fault     = false;   // 器件/线路故障
        this._acc      = 0;
        this._blink    = 0;
    }

    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
    }

    // ═══════════════════════════════════════════════════════
    // 静态部件
    // ═══════════════════════════════════════════════════════

    _drawStaticParts() {
        const g = this._staticGroup;
        const cx = this._cx, cy = this._cy, R = this._R;
        const accent = this.constructor.ACCENT;

        // 顶部安装底座（承接上方 CAN 总线接口）
        g.add(new Konva.Rect({
            x: cx - 34, y: 0, width: 68, height: 16,
            fill: '#e3e7e9', stroke: '#b0bec5', strokeWidth: 1.5, cornerRadius: 4,
        }));
        g.add(new Konva.Line({ points: [cx - 8, 0, cx - 8, 13], stroke: '#90a4ae', strokeWidth: 2, listening: false }));
        g.add(new Konva.Line({ points: [cx + 8, 0, cx + 8, 13], stroke: '#90a4ae', strokeWidth: 2, listening: false }));

        // 圆盘侧壁（3D：径向渐变，右下偏暗，左上高光）
        g.add(new Konva.Circle({
            x: cx, y: cy, radius: R,
            fillRadialGradientStartPoint: { x: cx - R * 0.32, y: cy - R * 0.38 },
            fillRadialGradientStartRadius: 0,
            fillRadialGradientEndPoint: { x: cx, y: cy },
            fillRadialGradientEndRadius: R,
            fillRadialGradientColorStops: [0, '#ffffff', 0.5, '#f0f3f4', 0.82, '#dde3e5', 1, '#b4bfc3'],
            stroke: '#97a5aa', strokeWidth: 1.5,
        }));
        // 下缘厚度（暗环，增强立体感）
        g.add(new Konva.Arc({
            x: cx, y: cy, innerRadius: R * 0.88, outerRadius: R, angle: 180, rotation: 0,
            fill: 'rgba(120,135,140,0.22)', listening: false,
        }));

        // 进烟栅格环（一圈小竖条）
        const nSlot = 20;
        for (let i = 0; i < nSlot; i++) {
            const a = (i / nSlot) * Math.PI * 2;
            const r1 = R * 0.5, r2 = R * 0.66;
            g.add(new Konva.Line({
                points: [cx + Math.cos(a) * r1, cy + Math.sin(a) * r1, cx + Math.cos(a) * r2, cy + Math.sin(a) * r2],
                stroke: '#9aa7ac', strokeWidth: 4, lineCap: 'round', listening: false,
            }));
        }

        // 中央感应穹顶（3D 高光）
        g.add(new Konva.Circle({
            x: cx, y: cy, radius: R * 0.5,
            fillRadialGradientStartPoint: { x: cx - R * 0.2, y: cy - R * 0.26 },
            fillRadialGradientStartRadius: 0,
            fillRadialGradientEndPoint: { x: cx, y: cy },
            fillRadialGradientEndRadius: R * 0.5,
            fillRadialGradientColorStops: [0, '#ffffff', 0.62, '#f8fbfb', 1, '#e1e7e9'],
            stroke: '#c4cdcf', strokeWidth: 1,
        }));
        // 顶部光泽弧
        g.add(new Konva.Arc({
            x: cx, y: cy, innerRadius: R * 0.24, outerRadius: R * 0.44, angle: 150, rotation: 195,
            stroke: 'rgba(255,255,255,0.9)', strokeWidth: 7, lineCap: 'round', listening: false,
        }));
        // 类型图形（感烟金属网 / 感光紫外管 / 感温温度计）
        this._drawTypeGlyph(g, cx, cy, accent);

        // 类型色环（细微区分感烟/感温/感光）
        g.add(new Konva.Circle({
            x: cx, y: cy, radius: R * 0.5 + 3, stroke: accent, strokeWidth: 1.5, opacity: 0.55, listening: false,
        }));

        // 名称 / 回路·防区
        g.add(new Konva.Text({
            x: 0, y: this.H - 26, width: this.W, text: this.label,
            fontSize: 13, fontStyle: 'bold', fill: '#263238', align: 'center',
        }));
        g.add(new Konva.Text({
            x: 0, y: this.H - 10, width: this.W,
            text: this.nodeAddress == null ? '未设置地址' : `LOOP${this.loop} · ZONE${this.zone} · #${this.nodeAddress}`,
            fontSize: 10, fill: '#78909c', align: 'center',
        }));
    }

    /** 子类可覆盖：探头类型图形（本设计统一为圆盘，默认不绘制） */
    _drawTypeGlyph(_g, _cx, _cy, _accent) { /* 保留接口 */ }

    _createDynamicNodes() {
        const d = this._dynamicGroup;
        const cx = this._cx, cy = this._cy, R = this._R;
        // 状态指示灯（圆盘右侧）
        this._led = new Konva.Circle({
            x: cx + R * 0.62, y: cy, radius: 7,
            fill: '#37474f', stroke: '#263238', strokeWidth: 1,
        });
        d.add(this._led);
        this._stateText = new Konva.Text({
            x: 0, y: cy + R + 1, width: this.W, text: '',
            fontSize: 11, fontStyle: 'bold', fill: '#455a64', align: 'center',
        });
        d.add(this._stateText);
        this._ledOn = false;
    }

    _bindInteraction() {
        const cx = this._cx, cy = this._cy, R = this._R;
        // 整体（供演示箭头指示）
        this.addClickablePart('body', cx - R, cy - R, R * 2, R * 2);
        // 中央感应区：点击触发（再次点击清除火灾条件）
        this.addClickablePart('test', cx - 26, cy - 26, 52, 52, true);
        const hit = this.getClickablePartNode('test');
        if (hit) hit.on('click tap', (e) => { e.cancelBubble = true; this.toggle(); });
    }

    // ═══════════════════════════════════════════════════════
    // 对外 API
    // ═══════════════════════════════════════════════════════

    /** 触发报警（人工/测试，锁存；手动报警按钮即按此实现） */
    trigger() {
        this._manualAlarm = true;
        this._syncAlarm();
    }

    /** 火警条件消失（探测器恢复正常，控制器须 RESET 才清除锁存指示） */
    clearFire() {
        this._manualAlarm = false;
        this.stimulus = false;
        this._syncAlarm();
    }

    /** 外部激励（打火机火焰/烟雾/热风）：信号消失后自动撤销探测器报警 */
    setStimulus(on) {
        this.stimulus = !!on;
        this._syncAlarm();
    }

    /** 重算火警状态：人工锁存 或 外部激励 */
    _syncAlarm() {
        this.alarming = this._manualAlarm || this.stimulus;
        if (this.sys && this.sys.redrawAll) this.sys.redrawAll();
    }

    /** 点击测试部件：触发 ↔ 清除 */
    toggle() { if (this.alarming) this.clearFire(); else this.trigger(); }

    /** 复位本器件 */
    reset() { this._manualAlarm = false; this.stimulus = false; this._syncAlarm(); }

    setAlarm(on) { this._manualAlarm = !!on; this.stimulus = false; this._syncAlarm(); }
    setIsolated(on) { this.isolated = !!on; }
    setFault(on) { this.fault = !!on; }

    /** 由地址写入器写入地址（并同步回路/防区） */
    setNodeAddress(addr, loop, zone) {
        this.nodeAddress = addr;
        if (loop !== undefined && loop !== null) this.loop = loop;
        if (zone !== undefined && zone !== null) this.zone = zone;
        // 刷新静态标签（LOOP/ZONE/#addr 或 未设置地址）
        this._staticGroup.destroyChildren();
        this._drawStaticParts();
        this._forceCacheFlush(true);
        // 重新挂载 CAN 节点（刷新订阅，使其能接收本地址的配置/隔离帧）
        const bus = this.sys && this.sys.canBus;
        if (bus && typeof bus.detach === 'function' && typeof bus.attach === 'function') {
            try { bus.detach(this.id); bus.attach(this); } catch (e) { /* ignore */ }
        }
        if (this.sys && this.sys.redrawAll) this.sys.redrawAll();
    }

    /** 是否已设置地址 */
    isConfigured() { return this.nodeAddress != null; }
    isAlarming() { return this.alarming; }
    getStatus() {
        return {
            id: this.id, type: this.type, loop: this.loop, zone: this.zone,
            nodeAddress: this.nodeAddress, alarm: this.alarming,
            isolated: this.isolated, fault: this.fault,
            online: this.powerOn && this.busConnected && !this.commFault,
        };
    }

    // ═══════════════════════════════════════════════════════
    // CAN 节点
    // ═══════════════════════════════════════════════════════

    tick(dt) {
        this._acc += (dt || 0.05) * 1000;
        if (this._acc >= CAN_TICK_INTERVAL) {
            this._acc = 0;
            this._tick();
        }
        this._updateVisuals(dt);
        this.markDirty();
        this._refreshIfDirty();
    }

    _tick() {
        const p = `${this.id}_wire_`;
        // 接在总线上（CANH/CANL 接入）且总线得电：回路供电由火灾报警控制器内部电源提供
        this.busConnected = this.sys.isOnCanBus(`${p}can1p`) && this.sys.isOnCanBus(`${p}can1n`);
        this.powerOn = this.busConnected && !!(this.sys && this.sys._fireLoopPowered);

        if (!this.powerOn) {
            this.nmtState = NMT_STATE.INIT;
            this.sys.canBus && this.sys.canBus.resetNodeOnline(this.id);
            return;
        }
        if (this.commFault) {
            this.sys.canBus && this.sys.canBus.resetNodeOnline(this.id);
            return;
        }

        // 心跳超时：RUN → PREOP
        const now = Date.now();
        if (this.nmtState === NMT_STATE.RUN && this._lastHeartbeat
            && (now - this._lastHeartbeat) > this.heartbeatTimeout) {
            this.nmtState = NMT_STATE.PREOP;
        }

        // 周期上报
        if (this.nmtState === NMT_STATE.RUN && (now - this.lastTxTime) >= this.txInterval) {
            this.lastTxTime = now;
            this._canTransmit();
        }

        if (this.sys.canBus) {
            if (this.powerOn && this.busConnected && this.nmtState === NMT_STATE.RUN && !this.commFault && this.nodeAddress != null) {
                this.sys.canBus.setNodeOnline(this.id);
            } else {
                this.sys.canBus.resetNodeOnline(this.id);
            }
        }
    }

    _isCanTransmit() { return this.nodeAddress != null && this.nmtState === NMT_STATE.RUN && !this.commFault && !!this.busConnected; }

    _canTransmit() {
        if (!this.sys.canBus || !this._isCanTransmit()) return false;
        const statusByte = (this.alarming ? 0x01 : 0) | (this.isolated ? 0x02 : 0) | (this.fault ? 0x04 : 0);
        const frame = {
            id: CANId.encode(CAN_FUNC.FUNC_REPORT, this.nodeAddress),
            extended: false, rtr: false, dlc: 8,
            data: [statusByte, this.loop & 0xFF, this.zone & 0xFF, (this.constructor.TYPE_CODE || 0) & 0xFF, 0, 0, 0, 0],
            sender: this.id, timestamp: Date.now(),
        };
        const ok = this.sys.canBus.send(frame);
        if (ok !== false) { this.txCount++; }
        return ok !== false;
    }

    onCanReceive(frame) {
        if (!frame) return;
        let dec;
        try { dec = CANId.decode(frame.id); } catch (e) { return; }
        const { funcCode, nodeAddr } = dec;
        const isNmtOrBc = funcCode === CAN_FUNC.NMT || funcCode === CAN_FUNC.BROADCAST;
        if (!isNmtOrBc && (!this.busConnected || this.commFault)) return;

        this.rxCount++;
        if (funcCode === CAN_FUNC.NMT) {
            if (nodeAddr === 0 || nodeAddr === this.nodeAddress) this._handleNMT((frame.data && frame.data[0]) || 0);
            return;
        }
        if (funcCode === CAN_FUNC.BROADCAST) {
            if (frame.data && frame.data[0] === 0x05) {
                this._lastHeartbeat = Date.now();
                if (this.nmtState !== NMT_STATE.RUN && !this.commFault) this.nmtState = NMT_STATE.RUN;
            }
            return;
        }
        if (funcCode === CAN_FUNC.FUNC_CONFIG && nodeAddr === this.nodeAddress) {
            const cmd = (frame.data && frame.data[0]) || 0;
            if (cmd === 0x30) this.isolated = true;        // 隔离
            else if (cmd === 0x31) this.isolated = false;  // 解除隔离
            else if (cmd === 0x32) { this._manualAlarm = false; this.stimulus = false; this._syncAlarm(); }  // 复位火警
        }
    }

    _handleNMT(cmd) {
        switch (cmd) {
            case NMT_CMD.START: this.nmtState = NMT_STATE.RUN; break;
            case NMT_CMD.STOP: this.nmtState = NMT_STATE.STOP; break;
            case NMT_CMD.RESET: this.nmtState = NMT_STATE.INIT; this.commFault = false; this.alarming = false; break;
            case NMT_CMD.RESETCOM: this.txCount = 0; this.rxCount = 0; break;
            default: break;
        }
    }

    // ═══════════════════════════════════════════════════════
    // 视觉
    // ═══════════════════════════════════════════════════════

    _updateVisuals(dt) {
        this._blink += (dt || 0.05) * 1000;
        const blinkOn = Math.floor(this._blink / 400) % 2 === 0;

        let color = '#37474f', text = '离线', flash = false;
        if (this.nodeAddress == null) {
            color = '#90a4ae'; text = '未设地址';
        } else if (!this.powerOn || !this.busConnected || this.nmtState !== NMT_STATE.RUN) {
            color = '#37474f'; text = this.powerOn ? '通信中断' : '离线';
        } else if (this.fault) {
            color = '#ff9800'; text = '故障';
        } else if (this.isolated) {
            color = '#f4c430'; text = '已隔离';
        } else if (this.alarming) {
            color = '#ff2020'; text = '火警'; flash = true;
        } else {
            color = '#25d425'; text = '正常';
        }
        const on = flash ? blinkOn : true;
        this._led.fill(on ? color : '#263238');
        this._stateText.text(text);
        this._stateText.fill(color);
        this._ledOn = on;
    }

    // ═══════════════════════════════════════════════════════
    // 配置
    // ═══════════════════════════════════════════════════════

    getConfigFields() {
        return [
            { label: '器件名称 (ID)', key: 'id', type: 'text' },
            { label: '名称/位号', key: 'label', type: 'text' },
            { label: '节点地址 (0~15)', key: 'nodeAddress', type: 'number', min: 0, max: 15 },
            { label: 'CAN 回路 (1/2)', key: 'loop', type: 'number', min: 1, max: 2 },
            { label: '防区 ZONE (1~4)', key: 'zone', type: 'number', min: 1, max: 4 },
        ];
    }

    onConfigUpdate(newConfig) {
        if (newConfig.id) this.id = newConfig.id;
        if (newConfig.label !== undefined) this.label = newConfig.label;
        if (newConfig.nodeAddress !== undefined) this.nodeAddress = Math.max(0, Math.min(15, parseInt(newConfig.nodeAddress) || 0));
        if (newConfig.loop !== undefined) this.loop = Math.max(1, Math.min(2, parseInt(newConfig.loop) || 1));
        if (newConfig.zone !== undefined) this.zone = Math.max(1, Math.min(4, parseInt(newConfig.zone) || 1));
        this.config = { ...this.config, ...newConfig };
        // 位置标签需重绘
        this._staticGroup.destroyChildren();
        this._drawStaticParts();
        this._forceCacheFlush(true);
    }

    destroy() { super.destroy?.(); }
}

export default DetectorBase;
