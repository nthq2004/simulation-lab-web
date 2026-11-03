import { BaseComponent } from './BaseComponent.js';

/**
 * Monitor - 过程监视器组件（曲线 + 报警面板）
 *
 * 功能：
 * - 在一个面板上绘制 PV/SV/OUT 曲线并展示多条报警信息；
 * - 支持报警延时、报警去抖、逐条独立消音与确认，以及蜂鸣器提示（浏览器 AudioContext）；
 * - 报警触发流程：外部把故障对象传入 `update(data)` → `processFaults` 做去抖/延时 → `triggerAlarm` 入队；
 * - 端口：顶部预留两个线端用于信号总线连接（`b1`/`a1`）。
 *
 * 遵循新组件规范（BaseComponent 模板）：
 *   构造函数 `_initGroups → _recalcGeometry → _initParameters → _init`；
 *   `_init` 内 `_drawStaticParts` + `_createDynamicNodes` + `_bindInteraction`；
 *   静态件位图缓存一次，动态件（曲线/报警文字/按钮）in-place 更新，不刷新缓存、无阴影。
 */
export class Monitor extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.type = 'monitor';
        this.cache = 'fixed';

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        this.config = { id: this.id };

        // 顶部信号端口（用于连接外部信号总线）
        this.addPort(this.w / 2 - 20, 0, 'b1', 'wire');
        this.addPort(this.w / 2 + 20, 0, 'a1', 'wire', 'p');
    }

    // ═══════════════════════════════════════════════════════════
    // 几何 / 参数
    // ═══════════════════════════════════════════════════════════

    _recalcGeometry() {
        this.w = 420;
        this.h = 320;
    }

    _initParameters() {
        // 曲线历史数据与绘制粒度控制
        this.history = [];
        this.maxDataPoints = 400;

        // --- 报警队列与显示管理 ---
        // activeAlarms 存放当前未确认/历史报警，按时间倒序（新报警插入头部）
        // 每个报警对象示例：{ id, text, confirmed, muted, timestamp, isPhysicalActive }
        this.activeAlarms = [];
        this.alarmIdCounter = 0;
        this.flashState = true;
        this.maxAlarmLines = 5;

        // --- 延时/去抖管理（故障需持续存在一段时间才触发报警） ---
        this.faultTimers = {};
        this.alarmDelay = 3000;

        // 故障映射表：外部故障代码 → 面板显示文本
        this.faultMap = {
            transmitter: {
                'OPEN': '温度变送器输出断路',
                'SHORT': 'PT100 传感器短路',
                'BURNOUT': 'PT100 传感器断路',
                'TX_SHORT': '变送器短路',
                'LOOP_BREAK': 'PID输入回路开路',
            },
            ovenTemp: '烘箱温度过高(HH)',
            pidOutput1: 'PID输出回路1断路',
            pidOutput2: 'PID输出回路2断路',
            communication: 'RS485通信故障',
        };

        this.audioCtx = null;
        this._tickAcc = 0;
        this._feedAcc = 0;
    }

    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
    }

    // ═══════════════════════════════════════════════════════════
    // 静态部件
    // ═══════════════════════════════════════════════════════════

    _drawStaticParts() {
        const w = this.w, h = this.h;

        // 面板框
        this._staticGroup.add(new Konva.Rect({
            width: w, height: h, fill: '#2c3e50', stroke: '#7f8c8d', strokeWidth: 4, cornerRadius: 5,
        }));

        // 1. 绘图区
        this._staticGroup.add(new Konva.Rect({ x: 10, y: 10, width: 400, height: 180, fill: '#000' }));

        // 2. 报警显示区（5 条，静态底行；文字在动态组）
        // 3. 控制按钮外壳 + 指示灯底座（按钮命中区在动态组）
        this._staticGroup.add(new Konva.Rect({ x: 345, y: 200, width: 60, height: 32, fill: '#f39c12', cornerRadius: 4, stroke: '#1a252f' }));
        this._staticGroup.add(new Konva.Text({ x: 345, y: 200, width: 60, height: 32, text: '消音', align: 'center', verticalAlign: 'middle', fill: '#fff', fontStyle: 'bold', listening: false }));
        this._staticGroup.add(new Konva.Rect({ x: 345, y: 240, width: 60, height: 32, fill: '#27ae60', cornerRadius: 4, stroke: '#1a252f' }));
        this._staticGroup.add(new Konva.Text({ x: 345, y: 240, width: 60, height: 32, text: '确认', align: 'center', verticalAlign: 'middle', fill: '#fff', fontStyle: 'bold', listening: false }));

        this._staticGroup.add(new Konva.Circle({ x: 355, y: 295, radius: 8, fill: '#333' }));
        this._staticGroup.add(new Konva.Path({
            x: 380, y: 295, data: 'M0 0 L8 -8 L8 8 Z M10 -4 Q13 0 10 4',
            stroke: '#7f8c8d', scale: { x: 1.2, y: 1.2 },
        }));

        // 可识别部件：消音 / 确认按钮、报警显示区
        this.addClickablePart('mute', 345, 200, 60, 32);
        this.addClickablePart('ack', 345, 240, 60, 32);
        this.addClickablePart('alarm-area', 10, 196, 330, 110);
    }

    // ═══════════════════════════════════════════════════════════
    // 动态节点（in-place 更新）
    // ═══════════════════════════════════════════════════════════

    _createDynamicNodes() {
        // 曲线图层：SV/PV/OUT 等，线条对象在 updatePlot 中设置 points
        this.svLine = new Konva.Line({ stroke: '#00ff00', strokeWidth: 2, dash: [8, 8] });
        this.pvLine = new Konva.Line({ stroke: '#ff0000', strokeWidth: 2 });
        this.out1Line = new Konva.Line({ stroke: 'hsl(58, 98%, 50%)', strokeWidth: 1.5 });
        this.out2Line = new Konva.Line({ stroke: 'hsl(199, 96%, 64%)', strokeWidth: 1.5 });
        this._dynamicGroup.add(this.pvLine, this.svLine, this.out1Line, this.out2Line);

        // 报警文字行
        this.alarmLines = [];
        for (let i = 0; i < this.maxAlarmLines; i++) {
            const t = new Konva.Text({ x: 15, y: 200 + i * 22, fontSize: 13, fontFamily: 'monospace', text: '' });
            this.alarmLines.push(t);
            this._dynamicGroup.add(t);
        }

        // 按钮命中区 + 指示灯（in-place 更新）
        this.btnMute = new Konva.Group({ x: 345, y: 200, name: 'button', cursor: 'pointer' });
        this.btnAck = new Konva.Group({ x: 345, y: 240, name: 'button', cursor: 'pointer' });
        this.btnMute.add(new Konva.Rect({ width: 60, height: 32, fill: 'transparent' }));
        this.btnAck.add(new Konva.Rect({ width: 60, height: 32, fill: 'transparent' }));
        this.alarmLed = new Konva.Circle({ x: 355, y: 295, radius: 8, fill: '#333' });
        this.buzzerIcon = new Konva.Path({
            x: 380, y: 295, data: 'M0 0 L8 -8 L8 8 Z M10 -4 Q13 0 10 4',
            stroke: '#7f8c8d', scale: { x: 1.2, y: 1.2 },
        });
        this._interactGroup.add(this.btnMute, this.btnAck, this.alarmLed, this.buzzerIcon);
    }

    _bindInteraction() {
        this.btnMute.on('mousedown', () => this.btnMuteFunc());
        this.btnAck.on('mousedown', () => this.btnAckFunc());
    }

    // ═══════════════════════════════════════════════════════════
    // 动态更新
    // ═══════════════════════════════════════════════════════════

    tick(dt) {
        // 0.5s 节拍：报警闪烁
        this._tickAcc = (this._tickAcc || 0) + dt;
        if (this._tickAcc >= 0.5) { this._tickAcc = 0; this.flashState = !this.flashState; }

        // 0.1s 节拍：采集趋势/报警数据（PWM 方波清晰）
        this._feedAcc = (this._feedAcc || 0) + dt;
        if (this._feedAcc >= 0.1) {
            this._feedAcc = 0;
            this._feedFromSystem();
        }
        this._refreshIfDirty();
    }

    /**
     * 通过 RS485 接线发现并采集所连 PID 的监控数据（不硬编码组件 id）。
     * 未接 RS485（或对端非 PID）时不显示任何数据。
     */
    _feedFromSystem() {
        const pid = this._findWiredPid();
        if (!pid) {
            // 无连接 → 显示“无效数据”，不绘制曲线
            this._clearPlot();
            this.update({ pv: null });
            return;
        }

        // 报警数据同样由所连 PID 的状态推导（不硬编码）：
        //  · 传感器短路/欠量程：回路电流低于 4mA 零点（PT100 短路）→ pid.pi1Short
        //  · 传感器断路（输入回路电流会掉到近 0）：pid.pi1Open
        //  · 传感器断路（变送器上冲超量程 >21.6mA）：pid.pi1Over —— 此时抑制温度 HH 报警
        //  · 变送器短路（回路电流上冲 >30mA）：pid.pi1TxShort —— 同样抑制温度 HH 报警
        //  · 温度超限：PID 的 PV 超过其报警上限 HH（仅在非超量程/变送器短路时判定）
        const hh = (pid.alarm && pid.alarm.HH !== undefined) ? pid.alarm.HH : Infinity;
        const overRange = !!pid.pi1Over;
        const txShort = !!pid.pi1TxShort;
        const fault = {
            transmitter: txShort ? 'TX_SHORT'
                : (pid.pi1Short ? 'SHORT'
                : (overRange ? 'BURNOUT'
                : (pid.pi1Open ? 'OPEN' : null))),
            ovenTemp: (!(overRange || txShort) && pid.PV > hh) ? true : null,
        };

        this.update({
            pv: pid.PV,
            sv: pid.SV,
            // 黄线 = CH1 实际输出值（0~100%，随输出回路故障归零）；
            // 蓝线 = CH2 冷却 PWM 瞬时波形（通=100、断=0）
            out1: (pid.heatPWM || 0) * 100,
            out2: pid.coolInstantOn ? 100 : 0,
            fault,
        });
    }

    /** 扫描连线池，找出与本机 a1/b1 相连的对端 PID 实例 */
    _findWiredPid() {
        const sys = this.sys;
        if (!sys || !Array.isArray(sys.conns)) return null;
        const myPorts = [`${this.id}_wire_a1`, `${this.id}_wire_b1`];
        for (const c of sys.conns) {
            for (const my of myPorts) {
                const other = (c.from === my) ? c.to : (c.to === my ? c.from : null);
                if (!other) continue;
                const oid = other.includes('_wire_') ? other.split('_wire_')[0] : other.split('_')[0];
                const comp = sys.comps && sys.comps[oid];
                if (comp && comp.type === 'PID') return comp;
            }
        }
        return null;
    }

    /** 清空趋势曲线（无连接时） */
    _clearPlot() {
        this.history.length = 0;
        this.pvLine.points([]);
        this.svLine.points([]);
        this.out1Line.points([]);
        this.out2Line.points([]);
    }

    btnAckFunc() {
        this.activeAlarms.forEach(a => {
            if (!a.isPhysicalActive && !a.confirmed) a.confirmed = true;
        });
    }

    btnMuteFunc() {
        this.activeAlarms.forEach(a => {
            if (!a.confirmed) a.muted = true;
        });
    }

    handleAudio() {
        const hasFlashingAlarm = this.activeAlarms.some(a => !a.confirmed && !a.muted);
        if (hasFlashingAlarm && this.flashState) {
            if (!this.audioCtx) this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            if (this.audioCtx.state === 'suspended') this.audioCtx.resume();
            const osc = this.audioCtx.createOscillator();
            const gain = this.audioCtx.createGain();
            osc.frequency.setValueAtTime(1000, this.audioCtx.currentTime);
            gain.gain.setValueAtTime(0.05, this.audioCtx.currentTime);
            osc.connect(gain);
            gain.connect(this.audioCtx.destination);
            osc.start();
            osc.stop(this.audioCtx.currentTime + 0.1);
        }
    }

    update(data) {
        if (data.pv === null) {
            this.alarmLines.forEach((l, i) => l.text(i === 0 ? '无效数据' : ''));
            return;
        }
        this.updatePlot(data);        // 1. 曲线
        this.processFaults(data.fault); // 2. 报警解析与滚动
        this.renderAlarms();          // 3. 渲染
        this.markDirty();
        this._refreshIfDirty();
    }

    updatePlot(data) {
        this.history.push({ pv: data.pv / 100, sv: data.sv / 100, out1: data.out1 / 100, out2: data.out2 / 100 });
        if (this.history.length > this.maxDataPoints) this.history.shift();

        // 曲线映射到绘图区（x:10..410, y:10..190）；极端值（如输入电流 0mA / 96mA
        // 对应的 PV 远低于/高于量程）限制在绘图区上下边缘内，避免越出屏幕。
        const mapY = (v) => {
            const y = 190 - ((v - (-0.1)) / 1.2) * 170;
            return Math.max(10, Math.min(190, y));
        };
        const ptsPV = [], ptsSV = [], ptsOUT1 = [], ptsOUT2 = [];
        this.history.forEach((d, i) => {
            const x = 10 + i * (400 / this.maxDataPoints);
            ptsPV.push(x, mapY(d.pv));
            ptsSV.push(x, mapY(d.sv));
            ptsOUT1.push(x, mapY(d.out1));
            ptsOUT2.push(x, mapY(d.out2));
        });
        this.pvLine.points(ptsPV);
        this.svLine.points(ptsSV);
        this.out1Line.points(ptsOUT1);
        this.out2Line.points(ptsOUT2);
    }

    processFaults(faultObj) {
        const now = Date.now();
        const detectedTexts = [];
        if (faultObj.transmitter) detectedTexts.push(this.faultMap.transmitter[faultObj.transmitter]);
        if (faultObj.ovenTemp) detectedTexts.push(this.faultMap.ovenTemp);
        if (faultObj.pidOutput1) detectedTexts.push(this.faultMap.pidOutput1);
        if (faultObj.pidOutput2) detectedTexts.push(this.faultMap.pidOutput2);
        if (faultObj.communication) detectedTexts.push(this.faultMap.communication);

        const allPossibleFaults = [
            ...Object.values(this.faultMap.transmitter),
            this.faultMap.ovenTemp,
            this.faultMap.pidOutput1,
            this.faultMap.pidOutput2,
            this.faultMap.communication,
        ];

        allPossibleFaults.forEach(txt => {
            const isPhysicallyPresent = detectedTexts.includes(txt);
            if (isPhysicallyPresent) {
                if (!this.faultTimers[txt]) this.faultTimers[txt] = now;
                else if (now - this.faultTimers[txt] >= this.alarmDelay) this.triggerAlarm(txt);
            } else {
                delete this.faultTimers[txt];
            }
        });

        this.activeAlarms.forEach(a => {
            if (!a.confirmed) a.isPhysicalActive = detectedTexts.includes(a.text);
        });
        if (this.activeAlarms.length > this.maxAlarmLines) {
            this.activeAlarms = this.activeAlarms.slice(0, this.maxAlarmLines);
        }
    }

    triggerAlarm(txt) {
        const existing = this.activeAlarms.find(a => a.text === txt && !a.confirmed);
        if (!existing) {
            this.activeAlarms.unshift({
                id: ++this.alarmIdCounter,
                text: txt,
                confirmed: false,
                muted: false,
                isPhysicalActive: true,
                timestamp: new Date().toLocaleTimeString('zh-CN', { hour12: false }).slice(0, 5),
            });
        }
    }

    renderAlarms() {
        this.alarmLines.forEach((line, i) => {
            const alarm = this.activeAlarms[i];
            if (alarm) {
                const statusFlag = alarm.isPhysicalActive ? '[ACT]' : '[CLR]';
                line.text(`${alarm.timestamp} ${statusFlag} ${alarm.text}`);
                if (!alarm.confirmed) {
                    if (!alarm.isPhysicalActive) {
                        // 物理已恢复、仅待确认：琥珀色常亮，不再闪红，避免误认为故障仍在
                        line.fill('#f1c40f');
                    } else if (!alarm.muted) {
                        line.fill(this.flashState ? '#ff0000' : '#ffffff');
                    } else {
                        line.fill('#ff0000');
                    }
                } else {
                    line.fill('#2ecc71');
                }
            } else {
                line.text(i === 0 && this.activeAlarms.length === 0 ? '系统工作正常' : '');
                line.fill('#2ecc71');
            }
        });

        const hasFlashingAlarm = this.activeAlarms.some(a => !a.confirmed && !a.muted);
        const hasUnconfirmed = this.activeAlarms.some(a => !a.confirmed);

        if (hasFlashingAlarm) {
            this.alarmLed.fill(this.flashState ? '#ff0000' : '#690606');
            this.buzzerIcon.stroke(this.flashState ? '#ff0000' : '#7f8c8d');
        } else if (hasUnconfirmed) {
            this.alarmLed.fill('#ea3d29');
            this.buzzerIcon.stroke('#7f8c8d');
        } else {
            this.alarmLed.fill('#690606');
            this.buzzerIcon.stroke('#7f8c8d');
        }
    }

    // ═══════════════════════════════════════════════════════════
    // 配置
    // ═══════════════════════════════════════════════════════════

    // ── 可识别部件中心（供自动演示箭头精确定位）──
    getClickablePartCenter(partId) {
        const node = {
            mute: this.btnMute, ack: this.btnAck,
            'alarm-area': (this.alarmLines && this.alarmLines[0]) || null,
        }[partId];
        if (node) { const c = this.getNodeCenter(node); if (c) return c; }
        return super.getClickablePartCenter(partId);
    }

    getConfigFields() {
        return [{ label: '器件名称 (ID)', key: 'id', type: 'text' }];
    }

    onConfigUpdate(cfg) {
        if (cfg.id) this.id = cfg.id;
        this.config = { ...this.config, id: this.id };
    }

    destroy() {
        super.destroy?.();
    }
}

export default Monitor;
