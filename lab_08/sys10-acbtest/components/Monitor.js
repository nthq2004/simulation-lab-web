import { BaseComponent } from './BaseComponent.js';

/**
 * Monitor - 过程监视器组件（曲线+报警面板）
 *
 * 功能：
 * - 在一个面板上绘制 PV/SV/OUT 曲线并展示多条报警信息。
 * - 支持报警延时、报警去抖、逐条独立消音与确认，以及蜂鸣器提示（浏览器 AudioContext）。
 * - 报警触发流程：外部把故障对象传入 `update(data)` -> `processFaults` 做去抖/延时 -> `triggerAlarm` 入队。
 * - 端口：顶部预留两个线端用于信号总线连接（`b1`/`a1`）。
 *
 * 备注：本组件以教学/演示为主，报警文本与延时逻辑可按需调整。
 */

export class Monitor extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        // 基本元信息与缓存策略
        this.type = 'monitor';
        this.cache = 'fixed';
        this._initGroups();
        this.w = 420;
        this.h = 320;

        // 曲线历史数据与绘制粒度控制
        this.history = [];
        this.maxDataPoints = 400;

        // --- 报警队列与显示管理 ---
        // activeAlarms 存放当前未确认/历史报警，按时间倒序（新报警插入头部）
        // 每个报警对象示例：{ id, text, confirmed, muted, timestamp, isPhysicalActive }
        this.activeAlarms = [];
        this.alarmIdCounter = 0;
        this.flashState = true; // 闪烁状态，用于视觉闪烁
        this.maxAlarmLines = 5; // 面板最多显示行数

        // --- 延时/去抖管理（故障需要持续存在一段时间才触发报警） ---
        this.faultTimers = {}; // 记录故障开始时间
        this.alarmDelay = 3000; // 延时 ms（此处为 3s）

        // 故障映射表：外部故障代码 -> 面板显示文本
        this.faultMap = {
            transmitter: {
                'OPEN': "温度变送器输入断路",
                'SHORT': "温度变送器输入短路",
                'LOOP_BREAK': "PID输入回路开路"
            },
            ovenTemp: "柴油机出口水温度过高(HH)",
            pidOutput1:  "PID输出回路1断路",
            pidOutput2:  "PID输出回路2断路",
            communication: "RS485通信故障"
        };

        // 音频上下文用于蜂鸣器提示（按需创建）
        this.audioCtx = null;
        this.initUI();
        this.initInteraction();

        // 顶部信号端口（用于连接外部信号总线）
        this.addPort(this.w / 2 - 20, 0, 'b1', 'wire');
        this.addPort(this.w / 2 + 20, 0, 'a1', 'wire', 'p');
    }

    /**
     * 集中化 tick 动画（20fps）
     * 原始 setInterval 周期 500ms，使用累加器保持原定时
     */
    tick(dt) {
        this._tickAcc = (this._tickAcc || 0) + dt;
        if (this._tickAcc < 0.5) return;
        this._tickAcc = 0;
        this.flashState = !this.flashState;
    
        this._refreshCache();
    }

    destroy() {
        super.destroy?.();
    }

    initUI() {
        const frame = new Konva.Rect({
            width: this.w, height: this.h,
            fill: '#2c3e50', stroke: '#7f8c8d', strokeWidth: 4, cornerRadius: 5
        });

        // 1. 绘图区 (高度压缩至 160 以留出 5 条文字空间)
        const plotBg = new Konva.Rect({
            x: 10, y: 10, width: 400, height: 180, fill: '#000'
        });

        // 曲线图层：SV/PV/OUT 等，线条对象会在 updatePlot 中设置 points
        this.svLine = new Konva.Line({ stroke: '#00ff00', strokeWidth: 2, dash: [8, 8] });
        this.pvLine = new Konva.Line({ stroke: '#ff0000', strokeWidth: 2 });
        this.out1Line = new Konva.Line({ stroke: 'hsl(58, 98%, 50%)', strokeWidth: 1.5 });   
        this.out2Line = new Konva.Line({ stroke: 'hsl(199, 96%, 64%)', strokeWidth: 1.5 });        
        this._staticGroup.add(frame, plotBg, this.pvLine, this.svLine, this.out1Line,this.out2Line);
        // 2. 报警显示区 (5 条)
        this.alarmLines = [];
        for (let i = 0; i < this.maxAlarmLines; i++) {
            const t = new Konva.Text({
                x: 15, y: 200 + i * 22,
                fontSize: 13, fontFamily: 'monospace',
                text: ""
            });
            this.alarmLines.push(t);
            this._staticGroup.add(t);
        }

        // 3. 控制排 (按钮垂直堆叠在指示灯上方)
        this.btnMute = this.createButton("消音", 345, 200, '#f39c12');
        this.btnAck = this.createButton("确认", 345, 240, '#27ae60');

        this.alarmLed = new Konva.Circle({ x: 355, y: 295, radius: 8, fill: '#333' });
        this.buzzerIcon = new Konva.Path({
            x: 380, y: 295, data: 'M0 0 L8 -8 L8 8 Z M10 -4 Q13 0 10 4',
            stroke: '#7f8c8d', scale: { x: 1.2, y: 1.2 }
        });

        this._staticGroup.add(this.btnMute, this.btnAck, this.alarmLed, this.buzzerIcon);
    }

    createButton(txt, x, y, color) {
        const g = new Konva.Group({ x, y, name: 'button', cursor: 'pointer' });
        const r = new Konva.Rect({ width: 60, height: 32, fill: color, cornerRadius: 4, stroke: '#1a252f' });
        const t = new Konva.Text({ width: 60, height: 32, text: txt, align: 'center', verticalAlign: 'middle', fill: '#fff', fontStyle: 'bold' });
        g.add(r, t);
        return g;
    }

    btnAckFunc() {

        this.activeAlarms.forEach(a => {

            if (!a.isPhysicalActive && !a.confirmed) {
                a.confirmed = true;
            }

        });
    }

    btnMuteFunc() {

        this.activeAlarms.forEach(a => {
            if (!a.confirmed) {
                a.muted = true;
            }
        });
    }
    initInteraction() {
        // this.btnMute.on('mousedown', () => {
        //     // this.isMuted = true;
        // });
        this.btnMute.on('mousedown', () => {
            this.btnMuteFunc();
        });
        // 修改后的确认逻辑
        this.btnAck.on('mousedown', () => {
            this.btnAckFunc();
        });
    }

    handleAudio() {

        const hasFlashingAlarm = this.activeAlarms.some(
            a => !a.confirmed && !a.muted
        );

        if (hasFlashingAlarm && this.flashState) {

            if (!this.audioCtx)
                this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();

            if (this.audioCtx.state === 'suspended')
                this.audioCtx.resume();

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
            this.alarmLines.forEach((l, i) => l.text(i === 0 ? "无效数据" : ""));
            return;
        }

        // 1. 曲线逻辑
        this.updatePlot(data);

        // 2. 报警解析与滚动逻辑
        this.processFaults(data.fault);

        // 3. 渲染
        this.renderAlarms();
        this._refreshCache();
    }

    updatePlot(data) {
        this.history.push({ pv: data.pv / 100, sv: data.sv / 100, out1: data.out1 / 100 ,out2: data.out2 / 100});
        if (this.history.length > this.maxDataPoints) this.history.shift();

        const mapY = (v) => 190 - ((v - (-0.1)) / 1.2) * 170;
        const ptsPV = [], ptsSV = [], ptsOUT1 = [],ptsOUT2 = [];

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
        if (faultObj.transmitter) detectedTexts.push(this.faultMap.transmitter[faultObj.transmitter]);  //faultObj.transmitter可能值
        if (faultObj.ovenTemp) detectedTexts.push(this.faultMap.ovenTemp);
        if (faultObj.pidOutput1) detectedTexts.push(this.faultMap.pidOutput1);
        if (faultObj.pidOutput2) detectedTexts.push(this.faultMap.pidOutput2);        
        if (faultObj.communication) detectedTexts.push(this.faultMap.communication);

        // 1. 处理延时逻辑与计时器清理
        // 遍历 faultMap 中的所有可能故障文本（扁平化处理）
        const allPossibleFaults = [
            ...Object.values(this.faultMap.transmitter),
            this.faultMap.ovenTemp,
            this.faultMap.pidOutput1,
            this.faultMap.pidOutput2,            
            this.faultMap.communication
        ];

        allPossibleFaults.forEach(txt => {
            const isPhysicallyPresent = detectedTexts.includes(txt);

            if (isPhysicallyPresent) {
                // 故障出现：首次记录开始时间，随后检查是否超过延时阈值触发报警
                if (!this.faultTimers[txt]) {
                    this.faultTimers[txt] = now;
                } else {
                    const duration = now - this.faultTimers[txt];
                    if (duration >= this.alarmDelay) {
                        // 超过延时阈值后触发报警（避免瞬时抖动误报）
                        this.triggerAlarm(txt);
                    }
                }
            } else {
                // 故障清除：移除计时器以便下次重新计时
                delete this.faultTimers[txt];
            }
        });

        // 2. 更新现有报警的物理活跃状态 (用于渲染 [ACT] / [CLR])
        this.activeAlarms.forEach(a => {
            if (!a.confirmed) {
                a.isPhysicalActive = detectedTexts.includes(a.text);
            }
        });

        if (this.activeAlarms.length > this.maxAlarmLines) {
            this.activeAlarms = this.activeAlarms.slice(0, this.maxAlarmLines);
        }
    }

    // 将报警触发逻辑独立出来
    triggerAlarm(txt) {
        // 检查是否已经存在该故障的“未确认”实例
        const existing = this.activeAlarms.find(a => a.text === txt && !a.confirmed);

        if (!existing) {  //新的报警插入在第一条显示。
            this.activeAlarms.unshift({
                id: ++this.alarmIdCounter,   // 唯一ID
                text: txt,
                confirmed: false,
                muted: false,               // ✅ 每条独立消音
                isPhysicalActive: true,
                timestamp: new Date().toLocaleTimeString('zh-CN', { hour12: false }).slice(0, 5)
            });
        }
    }

    renderAlarms() {

        this.alarmLines.forEach((line, i) => {
            const alarm = this.activeAlarms[i];
            if (alarm) {
                // 状态文字显示
                const statusFlag = alarm.isPhysicalActive ? "[ACT]" : "[CLR]";
                line.text(`${alarm.timestamp} ${statusFlag} ${alarm.text}`);

                if (!alarm.confirmed) {
                    // 未确认状态：
                    // 如果物理故障还在，显示红色（或闪烁）
                    // 如果物理故障消失但未确认，同样显示红色（或闪烁），提示需要确认
                    // const color = (shouldFlash && !this.flashState) ? '#ffffff' : '#ff0000';
                    // line.fill(this.isMuted ? '#ff0000' : color);
                    // ✅ 每条独立闪烁判断
                    if (!alarm.muted) {
                        const color = this.flashState ? '#ff0000' : '#ffffff';
                        line.fill(color);
                    } else {
                        line.fill('#ff0000'); // 消音后常亮红
                    }
                } else {
                    // 已确认（只有物理故障消失后才能进入此状态）：显示绿色历史
                    line.fill('#2ecc71');
                }
            } else {
                line.text(i === 0 && this.activeAlarms.length === 0 ? "系统工作正常" : "");
                line.fill('#2ecc71');
            }
        });

        // 指示灯逻辑：只要有未确认的（无论物理故障是否还在），指示灯就响应
        // const ledOn = (shouldFlash && this.flashState) || (hasUnconfirmed && this.isMuted);
        // this.alarmLed.fill(ledOn ? '#ff0000' : (hasUnconfirmed ? '#c0392b' : '#690606'));
        // this.buzzerIcon.stroke(shouldFlash && this.flashState ? '#ff0000' : '#7f8c8d');
        // ===== 指示灯逻辑 =====

        const hasFlashingAlarm = this.activeAlarms.some(
            a => !a.confirmed && !a.muted
        );

        const hasUnconfirmed = this.activeAlarms.some(
            a => !a.confirmed
        );

        if (hasFlashingAlarm) {
            this.alarmLed.fill(this.flashState ? '#ff0000' : '#690606');
            this.buzzerIcon.stroke(this.flashState ? '#ff0000' : '#7f8c8d');
        }
        else if (hasUnconfirmed) {
            this.alarmLed.fill('#ea3d29'); // 常亮红
            this.buzzerIcon.stroke('#7f8c8d');
        }
        else {
            this.alarmLed.fill('#690606');
            this.buzzerIcon.stroke('#7f8c8d');
        }
    }

    // NOTE: 显示更新后可选择调用 handleAudio() 来播放蜂鸣器提示
}