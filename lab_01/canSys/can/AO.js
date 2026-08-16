/**
 * AO.js — 模拟量输出模块 (Analog Output Module)
 * 船舶机舱监测报警系统 · CAN 总线架构
 *
 * 硬件规格：
 *   - 2路 4-20mA 电流输出 (CH1, CH2)
 *   - 2路 PWM 输出 (CH3, CH4)
 *   - CAN 总线接口 (CANH / CANL)
 *   - DC 24V 电源接口
 *   - 4路通道运行指示灯 (每通道1个)
 *   - 4个模块状态指示灯：PWR / RUN / FLT / COM
 *   - 4位地址码拨码开关 (SW1~SW4，二进制编码，地址范围 0-15)
 *   - 1个终端电阻使能开关 (120Ω)
 */

import { BaseComponent } from '../components/BaseComponent.js';
import { CAN_FUNC, CANId, NMT_CMD, NMT_STATE } from './CANBUS.js';

// ─────────────────────────────────────────────
//  常量
// ─────────────────────────────────────────────
const W = 200;
const H = 340;

const CH_CONFIG = [
    { id: 'ch1', label: 'CH1', type: '4-20mA', yPort: 60  },
    { id: 'ch2', label: 'CH2', type: '4-20mA', yPort: 100 },
    { id: 'ch3', label: 'CH3', type: 'PWM',    yPort: 140 },
    { id: 'ch4', label: 'CH4', type: 'PWM',    yPort: 180 },
];

// CAN 总线帧 ID 功能码 0x02 = AO
const CAN_FUNC_AO = 0x02;

// PWM 可视化更新周期 (ms)
const PWM_RENDER_INTERVAL = 50;

// ─────────────────────────────────────────────
//  主类
// ─────────────────────────────────────────────
export class AOModule extends BaseComponent {

    constructor(config, sys) {
        super(config, sys);

        this.w = W;
        this.h = H;
        this.scale = 1.35;
        this.type  = 'AO';
        this.cache = 'fixed';

        // ── 电源状态 ──
        this.powerOn = false;

        // ── 节点地址 (0~15) ──
        this.nodeAddress = (config && config.nodeAddress != null) ? config.nodeAddress : 2;

        // ── 终端电阻使能 ──
        this.termEnabled = false;

        // ── 通道输出数据 ──
        // percent: 0~100% 设定值；actual: 实际输出物理量；fault: 输出回路故障
        this.channels = {
            ch1: { type: '4-20mA', percent: 0, actual: 4.0,  fault: false, hold: false },
            ch2: { type: '4-20mA', percent: 0, actual: 4.0,  fault: false, hold: false },
            ch3: { type: 'PWM',    percent: 0, actual: 0,    fault: false, hold: false,
                   frequency: 1000, pwmPhase: 0, instantOn: false },
            ch4: { type: 'PWM',    percent: 0, actual: 0,    fault: false, hold: false,
                   frequency: 1000, pwmPhase: 0, instantOn: false },
        };

        // ── 量程/单位配置（供工程量显示使用）──
        this.ranges = {
            ch1: { lrv: 0, urv: 100, unit: '%'  },
            ch2: { lrv: 0, urv: 100, unit: '%'  },
            ch3: { lrv: 0, urv: 100, unit: '%'  },
            ch4: { lrv: 0, urv: 100, unit: '%'  },
        };

        // ── 安全输出配置（通信超时后的保持策略）──
        // mode: 'hold'=保持最后值, 'preset'=转到预设值, 'zero'=归零
        this.safeOutput = {
            ch1: { mode: 'hold', presetPercent: 0 },
            ch2: { mode: 'hold', presetPercent: 0 },
            ch3: { mode: 'zero', presetPercent: 0 },
            ch4: { mode: 'zero', presetPercent: 0 },
        };

        // ── 模块状态灯 ──
        this.ledStatus = { pwr: false, run: false, flt: false, com: false };

        // ── CAN 总线状态 ──
        this.canBusConnected = false;
        this.lastRxTime   = 0;
        this.lastTxTime   = 0;   // 状态回报
        this.txCount      = 0;
        this.rxCount      = 0;
        this.txInterval   = 500; // ms，状态回报周期
        this.comErrorCount = 0;
        this.comTimeout   = 2000; // ms，超时触发安全输出

        // ── 内部计时 ──
        this._runBlink   = false;
        this._blinkTick  = 0;
        this._lastPwmTick = 0;

        // ── NMT 网络管理状态机 ──
        this.nmtState = NMT_STATE.INIT;
        this.nmtStateTime = Date.now();

        // ── 初始化 ──
        this._initVisuals();
        this._initPorts();
        this._initInteraction();
        this._startLoop();
    }

    // ══════════════════════════════════════════
    //  界面绘制
    // ══════════════════════════════════════════
    _initVisuals() {
        this.scaleGroup = new Konva.Group({ scaleX: this.scale, scaleY: this.scale });
        this.group.add(this.scaleGroup);

        this._drawBody();
        this._drawHeader();
        this._drawChannelRows();
        this._drawStatusLEDs();
        this._drawAddressSwitch();
        this._drawTermSwitch();
        this._drawBottomPanel();
        this._drawPortLabels();
    }

    _drawBody() {
        const sg = this.scaleGroup;

        // 左右侧板（导轨卡扣）
        const railAttr = { width: 18, height: H, fill: '#9e9e9e', stroke: '#555', strokeWidth: 1.5, cornerRadius: 2 };
        sg.add(new Konva.Rect({ x: -18, y: 0, ...railAttr }));
        sg.add(new Konva.Rect({ x: W,   y: 0, ...railAttr }));

        // 主体面板（AO 模块用橙色顶条区分）
        sg.add(new Konva.Rect({
            x: 0, y: 0, width: W, height: H,
            fillLinearGradientStartPoint:  { x: 0, y: 0 },
            fillLinearGradientEndPoint:    { x: W, y: 0 },
            fillLinearGradientColorStops:  [0, '#2c2c2c', 0.5, '#3a3a3a', 1, '#2c2c2c'],
            stroke: '#222', strokeWidth: 3, cornerRadius: 3
        }));

        // 顶部装饰条（橙色，与 AI 蓝色形成视觉区分）
        sg.add(new Konva.Rect({ x: 0, y: 0, width: W, height: 6, fill: '#cc5500', cornerRadius: [3, 3, 0, 0] }));
    }

    _drawHeader() {
        const sg = this.scaleGroup;
        sg.add(new Konva.Rect({ x: 4, y: 8, width: W - 8, height: 30, fill: '#111', stroke: '#cc5500', strokeWidth: 1, cornerRadius: 2 }));
        sg.add(new Konva.Text({ x: 6, y: 12, text: 'AO-4通道', fontSize: 14, fontFamily: 'Courier New', fontStyle: 'bold', fill: '#ff8833' }));
        sg.add(new Konva.Text({ x: 6, y: 28, text: 'ANALOG  OUTPUT  MODULE', fontSize: 7, fill: '#11872b' }));
        this._nodeAddrDisplay = new Konva.Text({ x: 128, y: 14, text: `NODE:${String(this.nodeAddress).padStart(2,'0')}`, fontSize: 10, fontFamily: 'Courier New', fill: '#ffcc00' });
        sg.add(this._nodeAddrDisplay);
    }

    _drawChannelRows() {
        this._chDisplays = {};
        this._chLEDs     = {};

        CH_CONFIG.forEach((ch) => {
            const y  = 44 + CH_CONFIG.indexOf(ch) * 52;
            const sg = this.scaleGroup;

            // 通道背景框
            sg.add(new Konva.Rect({ x: 4, y, width: W - 8, height: 48, fill: '#0a0a0a', stroke: '#333', strokeWidth: 1, cornerRadius: 2 }));

            // 通道标签
            sg.add(new Konva.Text({ x: 8, y: y + 4, text: ch.label, fontSize: 10, fontStyle: 'bold', fill: '#aaa' }));

            // 输出类型标签
            sg.add(new Konva.Text({ x: 8, y: y + 16, text: ch.type, fontSize: 8, fill: '#21a54d' }));

            // 数值显示区域（输出值）
            const dispBg = new Konva.Rect({ x: 44, y: y + 4, width: 100, height: 38, fill: '#050505', stroke: '#2a2a00', strokeWidth: 1, cornerRadius: 1 });
            sg.add(dispBg);

            const valText = new Konva.Text({
                x: 46, y: y + 8, width: 96, text: '----',
                fontSize: 18, fontFamily: 'Courier New', fontStyle: 'bold',
                fill: '#ffaa00', align: 'right'
            });
            const unitText = new Konva.Text({ x: 46, y: y + 30, width: 96, text: '', fontSize: 8, fill: '#f7eeee', align: 'right' });
            this._chDisplays[ch.id] = { val: valText, unit: unitText, bg: dispBg };
            sg.add(valText, unitText);

            // PWM 通道额外绘制占空比进度条
            if (ch.type === 'PWM') {
                const barBg  = new Konva.Rect({ x: 44, y: y + 4, width: 100, height: 4, fill: '#111' });
                const barFg  = new Konva.Rect({ x: 44, y: y + 4, width: 0,   height: 4, fill: '#ff6600' });
                this._chDisplays[ch.id].barBg = barBg;
                this._chDisplays[ch.id].barFg = barFg;
                sg.add(barBg, barFg);
            }

            // 通道运行指示灯
            const led = new Konva.Circle({ x: 162, y: y + 14, radius: 5, fill: '#222', stroke: '#111', strokeWidth: 1 });
            const ledLabel = new Konva.Text({ x: 170, y: y + 10, text: 'OUT', fontSize: 7, fill: '#f1e5e5' });
            this._chLEDs[ch.id] = led;
            sg.add(led, ledLabel);

            // 状态文字（HOLD / SAFE / ---- 等）
            const statusText = new Konva.Text({ x: 162, y: y + 24, text: '----', fontSize: 8, fill: '#555', width: 34, align: 'center' });
            this._chDisplays[ch.id].status = statusText;
            sg.add(statusText);

            // 物理输出值小字
            const physText = new Konva.Text({ x: 8, y: y + 30, text: '', fontSize: 7, fill: '#1ef40b' });
            this._chDisplays[ch.id].phys = physText;
            sg.add(physText);
        });
    }

    _drawStatusLEDs() {
        const sg   = this.scaleGroup;
        const y    = 256;
        const defs = [
            { id: 'pwr', label: 'PWR', color: '#00ff00', x: 14  },
            { id: 'run', label: 'RUN', color: '#00ff00', x: 58  },
            { id: 'flt', label: 'FLT', color: '#ff3300', x: 102 },
            { id: 'com', label: 'COM', color: '#00aaff', x: 146 },
        ];

        sg.add(new Konva.Rect({ x: 4, y: y - 4, width: W - 8, height: 28, fill: '#0a0a0a', stroke: '#333', strokeWidth: 1, cornerRadius: 2 }));
        sg.add(new Konva.Text({ x: 8, y: y - 8, text: '状态指示灯', fontSize: 8, fill: '#f7f1f1' }));

        this._statusLEDs = {};
        defs.forEach(d => {
            const dot = new Konva.Circle({ x: d.x+10, y: y + 10, radius: 5, fill: '#222', stroke: '#111', strokeWidth: 1 });
            const txt = new Konva.Text({ x: d.x - 4, y: y + 16, text: d.label, fontSize: 7, fill: '#f8f1f1', width: 28, align: 'center' });
            this._statusLEDs[d.id] = { dot, color: d.color };
            sg.add(dot, txt);
        });
    }

    _drawAddressSwitch() {
        const sg  = this.scaleGroup;
        const y   = 288;
        const swW = 18;
        const swH = 26;
        const gap = 22;

        sg.add(new Konva.Rect({ x: 4, y: y - 2, width: W - 8, height: 38, fill: '#0a0a0a', stroke: '#333', strokeWidth: 1, cornerRadius: 2 }));
        sg.add(new Konva.Text({ x: 8, y: y - 4, text: '节点地址', fontSize: 8, fill: '#f1ecec' }));

        this._swObjs = [];
        for (let i = 0; i < 4; i++) {
            const bitVal = 1 << i;
            const x0     = 14 + i * gap;
            const isOn   = (this.nodeAddress & bitVal) !== 0;

            const swBg = new Konva.Rect({ x: x0, y: y + 8, width: swW, height: swH, fill: '#1a1a1a', stroke: '#444', strokeWidth: 1, cornerRadius: 2 });
            const knob = new Konva.Rect({ x: x0 + 3, y: isOn ? y + 10 : y + 22, width: swW - 6, height: 10, fill: isOn ? '#ffcc00' : '#333', stroke: '#555', strokeWidth: 1, cornerRadius: 1 });
            const lbl  = new Konva.Text({ x: x0, y: y + 35, text: `SW${i + 1}`, fontSize: 6, fill: '#f1e8e8', width: swW, align: 'center' });
            const vLbl = new Konva.Text({ x: x0, y: y + 8,  text: bitVal.toString(), fontSize: 6, fill: '#444', width: swW, align: 'center' });

            swBg.on('click tap', () => {
                if (this.nodeAddress & bitVal) this.nodeAddress &= ~bitVal;
                else                           this.nodeAddress |=  bitVal;
                this._refreshSwitches();
                this._nodeAddrDisplay.text(`NODE:${String(this.nodeAddress).padStart(2,'0')}`);
                this._refreshCache();
            });

            this._swObjs.push({ knob, bitVal, y0: y });
            sg.add(swBg, knob, lbl, vLbl);
        }

        this._addrDecText = new Konva.Text({ x: 78, y: y + 10, text: String(this.nodeAddress), fontSize: 10, fontFamily: 'Courier New', fill: '#ffcc00', width: 30, align: 'right' });
        sg.add(this._addrDecText);
    }

    _drawTermSwitch() {
        const sg = this.scaleGroup;
        const x0 = 160, y0 = 288;

        sg.add(new Konva.Text({ x: x0-2, y: y0 - 6, text: '终端电阻', fontSize: 8, fill: '#f7eded' }));
        const termBg   = new Konva.Rect({ x: x0 + 2, y: y0 + 8, width: 24, height: 26, fill: '#1a1a1a', stroke: '#444', strokeWidth: 1, cornerRadius: 2 });
        this._termKnob = new Konva.Rect({ x: x0 + 5, y: y0 + 22, width: 18, height: 10, fill: '#333', stroke: '#555', strokeWidth: 1, cornerRadius: 1 });
        const termLbl  = new Konva.Text({ x: x0, y: y0 + 35, text: '120Ω', fontSize: 6, fill: '#f9f2f2', width: 32, align: 'center' });

        termBg.on('click tap', () => {
            this.termEnabled = !this.termEnabled;
            this._termKnob.y(this.termEnabled ? y0 + 10 : y0 + 22);
            this._termKnob.fill(this.termEnabled ? '#00aaff' : '#333');
            this._refreshCache();
        });

        sg.add(termBg, this._termKnob, termLbl);
    }

    _drawBottomPanel() {
        const sg = this.scaleGroup;
        sg.add(new Konva.Rect({ x: 0, y: H, width: W, height: 20, fill: '#9e9e9e', stroke: '#444', strokeWidth: 1.5 }));
        const labels = [
            { x: 25,   text: 'CAN1H' },
            { x: 70,  text: 'CAN1L' },
            { x: 115,  text: 'CAN2H'  },
            { x: 160, text: 'CAN2L'  },
        ];
        labels.forEach(l => sg.add(new Konva.Text({ x: l.x, y: H + 5, text: l.text, fontSize: 7, fill: '#222' })));
    }

    _drawPortLabels() {
        const sg = this.scaleGroup;
        CH_CONFIG.forEach((ch, i) => {
            const y = 44 + i * 52 + 14;
            sg.add(new Konva.Text({ x: -40, y:y-4,      text: `${ch.label}+`, fontSize: 7, fill: '#0d05f2' }));
            sg.add(new Konva.Text({ x: -40, y: y + 18, text: `${ch.label}-`, fontSize: 7, fill: '#0d05f2' }));
        });
        sg.add(new Konva.Text({ x: W + 2, y: 8, text: 'VCC', fontSize: 7, fill: '#0d05f2' }));
        sg.add(new Konva.Text({ x: W + 2, y: 34, text: 'GND', fontSize: 7, fill: '#0d05f2' }));
    }

    // ══════════════════════════════════════════
    //  接线端口注册
    // ══════════════════════════════════════════
    _initPorts() {
        // 左侧：4路模拟输出，每路 + / -
        CH_CONFIG.forEach((ch, i) => {
            const yBase = 44 + i * 52;
            this.addPort(-18 * this.scale, (yBase + 12) * this.scale, `${ch.id}p`, 'wire', 'p');
            this.addPort(-18 * this.scale, (yBase + 38) * this.scale, `${ch.id}n`, 'wire');
        });

        // 右侧：24V 电源
        this.addPort((W + 18) * this.scale, 10 * this.scale, 'vcc', 'wire', 'p');
        this.addPort((W + 18) * this.scale, 38 * this.scale, 'gnd', 'wire');

        // 底部：CAN 总线
        this.addPort(35  * this.scale, (H + 20) * this.scale, 'can1h', 'wire', 'p');
        this.addPort(80  * this.scale, (H + 20) * this.scale, 'can1l', 'wire');
        this.addPort(125 * this.scale, (H + 20) * this.scale, 'can2h', 'wire','p');
        this.addPort(170 * this.scale, (H + 20) * this.scale, 'can2l', 'wire');
    }

    // ══════════════════════════════════════════
    //  交互
    // ══════════════════════════════════════════
    _initInteraction() {
        // 双击重置通信错误并清除安全输出锁定
        this.scaleGroup.on('dblclick', () => {
            this.comErrorCount = 0;
            Object.keys(this.channels).forEach(id => { this.channels[id].hold = false; });
            this._refreshCache();
        });
    }

    // ══════════════════════════════════════════
    //  主循环
    // ══════════════════════════════════════════
    _startLoop() {
        this._loopTimer = setInterval(() => {
            try {
                this.powerOn = this.sys.getVoltageBetween(`${this.id}_wire_vcc`, `${this.id}_wire_gnd`) ===0;
            } catch (_) { /* 未连线时由 setPower() 控制 */ }

            this._tick();
        }, 50); // 50ms 以保证 PWM 可视化流畅
        
        // 启动时设置NMT为初始化状态
        this.nmtState = NMT_STATE.INIT;
        this.nmtStateTime = Date.now();
    }

    // ══════════════════════════════════════════
    //  NMT 状态管理
    // ══════════════════════════════════════════
    /**
     * 处理NMT命令
     */
    _handleNMT(cmd) {
        if (cmd === NMT_CMD.START) {
            if (this.nmtState === NMT_STATE.INIT || this.nmtState === NMT_STATE.PREOP) {
                this.nmtState = NMT_STATE.RUN;
                this.nmtStateTime = Date.now();
                console.log(`[AO #${this.nodeAddress}] NMT: Starting → ${NMT_STATE.RUN} state`);
            }
        } else if (cmd === NMT_CMD.STOP) {
            if (this.nmtState === NMT_STATE.RUN) {
                this.nmtState = NMT_STATE.STOP;
                this.nmtStateTime = Date.now();
                console.log(`[AO #${this.nodeAddress}] NMT: Stopping → ${NMT_STATE.STOP} state`);
            }
        } else if (cmd === NMT_CMD.RESET) {
            this.nmtState = NMT_STATE.INIT;
            this.nmtStateTime = Date.now();
            this.txCount = 0;
            this.rxCount = 0;
            this.comErrorCount = 0;
            this.lastTxTime = 0;
            this.lastRxTime = 0;
            console.log(`[AO #${this.nodeAddress}] NMT: Resetting → ${NMT_STATE.INIT} state`);
        } else if (cmd === NMT_CMD.RESETCOM) {
            this.comErrorCount = 0;
            this.lastTxTime = 0;
            this.lastRxTime = 0;
            this.txCount = 0;
            this.rxCount = 0;
            console.log(`[AO #${this.nodeAddress}] NMT: Communication reset`);
        }
    }

    /**
     * 检查是否允许发送数据
     */
    _isCanTransmit() {
        return this.nmtState === NMT_STATE.RUN;
    }

    _tick() {
        const now = Date.now();
        this._blinkTick = now;

        if (!this.powerOn) {
            this._renderOff();
            return;
        }

        // 电源灯常亮
        this.ledStatus.pwr = true;

        // RUN 灯 500ms 闪烁
        this._runBlink = (now % 1000) < 500;
        this.ledStatus.run = this._runBlink;

        // 通信超时检测 → 安全输出
        const comAge = now - this.lastRxTime;
        if (this.lastRxTime > 0 && comAge > this.comTimeout) {
            this._applySafeOutput();
            this.ledStatus.flt = true;
        }

        // 更新各通道物理输出
        this._updateOutputs(now);

        // 状态回报（心跳帧）- 仅在RUN状态下发送
        if (this._isCanTransmit() && now - this.lastTxTime >= this.txInterval) {
            this._canTransmitStatus();
            this.lastTxTime = now;
        }

        // COM 灯在最近 80ms 内有收发时点亮
        this.ledStatus.com = (now - this.lastRxTime < 80) || (now - this.lastTxTime < 80);

        // 故障灯
        const anyFault = Object.values(this.channels).some(c => c.fault);
        if (anyFault) this.ledStatus.flt = true;

        this._render();
    }

    // ══════════════════════════════════════════
    //  输出更新
    // ══════════════════════════════════════════
    _updateOutputs(now) {
        const dt = (now - this._lastPwmTick) / 1000; // 秒
        this._lastPwmTick = now;

        Object.keys(this.channels).forEach(id => {
            const ch = this.channels[id];
            const pct = Math.max(0, Math.min(100, ch.percent)); // 0~100%

            if (ch.type === '4-20mA') {
                // 线性映射：0% → 4mA，100% → 20mA
                ch.actual = 4 + (pct / 100) * 16;
                // 回路断线检测（实际电流 < 3.8mA 时判故障，仿真里直接用 percent<0 触发）
                ch.fault = false;

            } else if (ch.type === 'PWM') {
                // PWM 相位累加
                const period = 1 / Math.max(1, ch.frequency); // 秒/周期
                ch.pwmPhase += dt;
                if (ch.pwmPhase >= period) ch.pwmPhase -= period;
                ch.actual      = pct;
                ch.instantOn   = ch.pwmPhase < (period * pct / 100);
                ch.fault       = false;
            }
        });
    }

    // ══════════════════════════════════════════
    //  安全输出（通信超时）
    // ══════════════════════════════════════════
    _applySafeOutput() {
        Object.keys(this.channels).forEach(id => {
            const ch   = this.channels[id];
            const safe = this.safeOutput[id];
            if (ch.hold) return; // 已进入安全状态，不重复设置
            switch (safe.mode) {
                case 'hold':    /* 保持当前值，不修改 ch.percent */ break;
                case 'preset':  ch.percent = safe.presetPercent;  break;
                case 'zero':    ch.percent = 0;                   break;
            }
            ch.hold = true;
        });
    }

    // ══════════════════════════════════════════
    //  CAN 总线通信
    // ══════════════════════════════════════════

    /**
     * 接收来自中央计算机的输出指令帧
     * 指令帧 ID = (0x20 << 7) | nodeAddress
     * Data 格式（8字节）：
     *   Byte 0-1: CH1 输出百分比 × 100 (Int16, 0~10000)
     *   Byte 2-3: CH2 输出百分比 × 100
     *   Byte 4-5: CH3 PWM 占空比 × 100
     *   Byte 6-7: CH4 PWM 占空比 × 100
     * 特殊值 0xFFFF = 保持当前输出（Hold 命令）
     */
    onCanReceive(frame) {
        if (!frame) return;

        // 解析帧 ID
        const { funcCode, nodeAddr } = CANId.decode(frame.id);
        
        // ── 处理NMT命令 ──
        if (funcCode === CAN_FUNC.NMT) {
            const nmtCmd = frame.data[0];
            const targetAddr = frame.data[1];
            if (targetAddr === 0 || targetAddr === this.nodeAddress) {
                this._handleNMT(nmtCmd);
            }
            return;
        }
        
        // ── 处理配置命令 ──
        const expectedId = (0x20 << 7) | (this.nodeAddress & 0x0F);
        if (frame.id !== expectedId) return;

        this.lastRxTime = Date.now();
        this.rxCount++;
        this.ledStatus.com = true;

        const chKeys = ['ch1', 'ch2', 'ch3', 'ch4'];
        chKeys.forEach((id, i) => {
            const raw = (frame.data[i * 2] << 8) | frame.data[i * 2 + 1];
            if (raw === 0xFFFF) return; // Hold：保持当前输出

            const pct = raw / 100;
            this.channels[id].percent = Math.max(0, Math.min(100, pct));
            this.channels[id].hold    = false; // 收到有效指令，解除安全锁定
        });

        // 扩展命令帧（DLC=9 时 Byte8 为命令字）
        if (frame.dlc >= 9) {
            const cmd = frame.data[8];
            if (cmd === 0x10) {
                // 批量归零
                chKeys.forEach(id => { this.channels[id].percent = 0; this.channels[id].hold = false; });
            } else if (cmd === 0x11) {
                // 修改 PWM 频率（Data[9-10] = Hz for CH3, Data[11-12] = Hz for CH4）
                if (frame.dlc >= 13) {
                    this.channels.ch3.frequency = (frame.data[9]  << 8) | frame.data[10];
                    this.channels.ch4.frequency = (frame.data[11] << 8) | frame.data[12];
                }
            }
        }
    }

    /**
     * 向中央计算机发送状态回报帧（心跳 + 实际输出值）
     * 回报帧 ID = (CAN_FUNC_AO << 7) | nodeAddress
     * Data（8字节）：
     *   Byte 0-1: CH1 实际电流 × 100 (如 820 = 8.20mA)
     *   Byte 2-3: CH2 实际电流 × 100
     *   Byte 4:   CH3 实际占空比（0~100）
     *   Byte 5:   CH4 实际占空比（0~100）
     *   Byte 6:   故障位 [bit0=ch1, bit1=ch2, bit2=ch3, bit3=ch4, bit4=comTimeout]
     *   Byte 7:   保留
     */
    _canTransmitStatus() {
        if (!this.sys || typeof this.sys.canBus === 'undefined') return;

        const frameId  = (CAN_FUNC_AO << 7) | (this.nodeAddress & 0x0F);
        const ch1mA100 = Math.round(this.channels.ch1.actual * 100);
        const ch2mA100 = Math.round(this.channels.ch2.actual * 100);
        const faultByte =
            (this.channels.ch1.fault ? 0x01 : 0) |
            (this.channels.ch2.fault ? 0x02 : 0) |
            (this.channels.ch3.fault ? 0x04 : 0) |
            (this.channels.ch4.fault ? 0x08 : 0) |
            (this.comErrorCount > 0  ? 0x10 : 0);

        const data = [
            (ch1mA100 >> 8) & 0xFF, ch1mA100 & 0xFF,
            (ch2mA100 >> 8) & 0xFF, ch2mA100 & 0xFF,
            Math.round(this.channels.ch3.actual) & 0xFF,
            Math.round(this.channels.ch4.actual) & 0xFF,
            faultByte,
            0x00,
        ];

        try {
            this.sys.canBus.send({ id: frameId, extended: false, rtr: false, dlc: 8, data, sender: this.id, timestamp: Date.now() });
            this.txCount++;
            this.canBusConnected = true;
        } catch (e) {
            this.comErrorCount++;
            this.canBusConnected = false;
        }
    }

    // ══════════════════════════════════════════
    //  渲染更新
    // ══════════════════════════════════════════
    _render() {
        CH_CONFIG.forEach(ch => {
            const cData = this.channels[ch.id];
            const disp  = this._chDisplays[ch.id];
            const led   = this._chLEDs[ch.id];

            if (!this.powerOn || cData.fault) {
                disp.val.text(cData.fault ? ' FAULT' : '');
                disp.val.fill('#ff3300');
                disp.unit.text('');
                disp.bg.stroke('#550000');
                disp.phys.text(cData.fault ? 'OPEN LOOP' : '');
                disp.status.text(cData.fault ? 'FLT' : '');
                disp.status.fill('#ff3300');
                led.fill(cData.fault ? '#ff3300' : '#222');
                if (ch.type === 'PWM' && disp.barFg) disp.barFg.width(0);
                return;
            }

            const pct = cData.percent;

            if (ch.type === '4-20mA') {
                disp.val.text(pct.toFixed(1).padStart(6, ' '));
                disp.unit.text('%');
                disp.phys.text(`${cData.actual.toFixed(2)} mA`);
                disp.val.fill(pct > 0.1 ? '#ffaa00' : '#444');
                disp.bg.stroke(pct > 0.1 ? '#2a2a00' : '#1a1a1a');
                led.fill(pct > 0.1 ? '#ffaa00' : '#222');

            } else if (ch.type === 'PWM') {
                disp.val.text(pct.toFixed(1).padStart(6, ' '));
                disp.unit.text('%');
                disp.phys.text(`${cData.frequency}Hz ${cData.instantOn ? '●ON' : '○OF'}`);
                // PWM 进度条
                if (disp.barFg) disp.barFg.width(Math.round(pct / 100 * 100));
                const pwmColor = cData.instantOn ? '#ff6600' : '#663300';
                disp.val.fill(pct > 0.1 ? pwmColor : '#444');
                disp.bg.stroke(pct > 0.1 ? '#2a1800' : '#1a1a1a');
                led.fill(cData.instantOn ? '#ff6600' : (pct > 0.1 ? '#442200' : '#222'));
            }

            // HOLD / 正常状态标注
            disp.status.text(cData.hold ? 'HOLD' : '----');
            disp.status.fill(cData.hold ? '#ffcc00' : '#555');
        });

        // 模块状态灯
        Object.keys(this._statusLEDs).forEach(id => {
            const led = this._statusLEDs[id];
            led.dot.fill(this.ledStatus[id] ? led.color : '#222');
        });

        this._refreshCache();
    }

    _renderOff() {
        CH_CONFIG.forEach(ch => {
            const d = this._chDisplays[ch.id];
            d.val.text('');
            d.unit.text('');
            d.phys.text('');
            d.status.text('');
            d.bg.stroke('#333');
            this._chLEDs[ch.id].fill('#222');
            if (ch.type === 'PWM' && d.barFg) d.barFg.width(0);
        });
        Object.keys(this._statusLEDs).forEach(id => this._statusLEDs[id].dot.fill('#222'));
        Object.keys(this.channels).forEach(id => {
            this.channels[id].actual   = ch => ch.type === '4-20mA' ? 4.0 : 0;
            this.channels[id].instantOn = false;
        });
        this._refreshCache();
    }

    // ══════════════════════════════════════════
    //  拨码开关同步刷新
    // ══════════════════════════════════════════
    _refreshSwitches() {
        this._swObjs.forEach(sw => {
            const isOn = (this.nodeAddress & sw.bitVal) !== 0;
            sw.knob.y(isOn ? sw.y0 + 10 : sw.y0 + 22);
            sw.knob.fill(isOn ? '#ffcc00' : '#333');
        });
        this._addrDecText.text(String(this.nodeAddress));
    }

    // ══════════════════════════════════════════
    //  公开 API
    // ══════════════════════════════════════════

    /**
     * 直接设置通道输出百分比（供测试/手动仿真使用）
     * @param {string} chId    - 'ch1' | 'ch2' | 'ch3' | 'ch4'
     * @param {number} percent - 0~100
     */
    setOutput(chId, percent) {
        if (this.channels[chId] !== undefined) {
            this.channels[chId].percent = Math.max(0, Math.min(100, percent));
            this.channels[chId].hold    = false;
        }
    }

    /**
     * 设置 PWM 通道频率
     * @param {string} chId - 'ch3' | 'ch4'
     * @param {number} hz   - 频率 (Hz)
     */
    setPwmFrequency(chId, hz) {
        if (this.channels[chId] && this.channels[chId].type === 'PWM') {
            this.channels[chId].frequency = Math.max(1, hz);
        }
    }

    /**
     * 配置安全输出策略
     * @param {string} chId - 通道 id
     * @param {string} mode - 'hold' | 'preset' | 'zero'
     * @param {number} [presetPercent=0]
     */
    setSafeOutput(chId, mode, presetPercent = 0) {
        if (this.safeOutput[chId]) {
            this.safeOutput[chId].mode          = mode;
            this.safeOutput[chId].presetPercent = presetPercent;
        }
    }

    /** 外部注入电源状态 */
    setPower(on) { this.powerOn = on; }

    /** 获取所有通道实际输出（供仿真引擎读取驱动负载）*/
    getChannelOutputs() {
        return Object.keys(this.channels).reduce((acc, id) => {
            const ch = this.channels[id];
            acc[id] = {
                type:      ch.type,
                percent:   ch.percent,
                actual:    ch.actual,
                instantOn: ch.instantOn,
                fault:     ch.fault,
                hold:      ch.hold,
            };
            return acc;
        }, {});
    }

    /** 销毁模块 */
    destroy() {
        if (this._loopTimer) clearInterval(this._loopTimer);
        super.destroy && super.destroy();
    }
}