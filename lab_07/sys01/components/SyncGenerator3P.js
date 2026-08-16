import { BaseComponent } from './BaseComponent.js';

/**
 * SyncGenerator3P.js
 * 船舶主配电板同步发电机组件（三相电源输出，type = 'source_3p'，复用现有求解器 stamp）。
 *
 * 界面布局：左侧为操作台，右侧为发电机本体。
 *   ┌─ 左侧操作台 ─────────────────────────────┐
 *   │  标题 + LCD（频率 / 线电压）              │
 *   │  本地/遥控转换开关                        │
 *   │  绿色起动带灯按钮 + 红色停止带灯按钮      │
 *   │  加速/减速旋钮（瞬时偏转，松手回弹）      │
 *   └──────────────────────────────────────────┘
 *   ┌─ 右侧发电机 ─────────────────────────────┐
 *   │  定子环形 + 三相绕组（120°对称分布）      │
 *   │  中心旋转的两对磁极转子                    │
 *   └──────────────────────────────────────────┘
 *
 * 顶部 4 个端口：u / v / w —— 三相输出端口（有效值 vRms 的对称三相电源），
 *   n —— 中性点端口。
 * 右侧沿右边界垂直排列 6 个电气端口（从上到下）：
 *   rm_start_a / rm_start_b —— 遥控起动（同簇即有效指令）
 *   rm_stop_a  / rm_stop_b  —— 遥控停止（同簇即有效指令，优先级高于起动）
 *   freq_in_p  / freq_in_n  —— 加速/减速指令（正电压加速，负电压减速）
 *
 * 电源参数：相电压有效值 vRms（默认 230V，LCD 同步显示线电压 √3·vRms），
 * 频率 freq（默认 50Hz，范围 freqMin~freqMax），可由调速旋钮/遥控指令积分调节。
 */
export class SyncGenerator3P extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = 334;
        this.height = 240;

        this.type  = 'source_3p';
        this.cache = 'fixed';

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        this.config = {
            id: this.id,
            freq:    this.freq,
            freqMin: this.freqMin,
            freqMax: this.freqMax,
            vRms:    this.vRms,
            ratedPower:   this.ratedPower,
            ratedVoltage: this.ratedVoltage,
            ratedCosPhi:  this.ratedCosPhi,
            isOn:    this.isOn,
            mode:    this.mode,
            freqDroop: this.freqDroop,
            qDroopVar: this.qDroopVar,
            vDroopV:   this.vDroopV,
            avrDelay:  this.avrDelay,
            avrTime:   this.avrTime,
            freqWn:    this._wn,
            freqZeta:  this._zeta,
        };

        this._addPorts();
    }

    _recalcGeometry() {
        this._gen = {
            cx: 247, cy: 140,
            rOuter: 68, rInner: 40,
            rRotor: 39, rWinding: 52,
        };

        this._portX = {
            u: 200, v: 247, w: 293, n: 317,
        };
        // 右侧电气端口（遥控起动/停止、加速/减速指令），圆心落在右边界线上
        const rx = this.width;
        this._portRight = {
            x: rx,
            startA: 36,  startB: 72,
            stopA:  108, stopB:  144,
            fInP:   180, fInN:   216,
        };

        this._ctrl = {
            lcd:   { x: 3, y: 18, w: 152, h: 62 },
            sw:    { x: 78, y: 113 },
            start: { x: 15,  y: 140, w: 57, h: 27 },
            stop:  { x: 85,  y: 140, w: 57, h: 27 },
            knob:  { x: 78, y: 200, r: 20 },
        };
    }

    _initParameters(config) {
        this.freq    = parseFloat(config.freq)    || 50;
        this.freqMin = parseFloat(config.freqMin) || 45;
        this.freqMax = parseFloat(config.freqMax) || 55;
        this.vRms    = parseFloat(config.vRms)    || 230;
        this.rOn     = parseFloat(config.rOn)     || 0.4;
        this.isOn    = config.isOn === true || config.isOn === 'true';
        this.mode    = config.mode || 'local';
        this._manualRate = 1.5;   // 手动旋钮频率变化率 Hz/s
        this._remoteGain = 2.0;   // 遥控电压→频率变化率 Hz/(s·V)
        this._knobDir    = 0;     // 旋钮当前偏转方向（-1/0/+1）
        this._remoteRate = 0;     // 遥控指令引起的频率变化率
        this._rotorAngle = 0;     // 转子累积机械角度

        // 额定参数（铭牌）：额定功率/额定电压(线)/额定功率因数 → 额定电流
        this.ratedPower  = parseFloat(config.ratedPower)  || 400;  // kW
        this.ratedVoltage = parseFloat(config.ratedVoltage) || 400; // 线电压 V
        this.ratedCosPhi = parseFloat(config.ratedCosPhi) || 0.8;
        this._recalcRatedCurrent();

        // 实际输出测量（滑动窗口 RMS，solver 步长 0.5ms，50Hz 周期=40 步）
        this._curBufU = []; this._curBufV = []; this._curBufW = [];
        this._pBuf = [];
        this._rmsI = 0;
        this._pwr = 0;
        this._measWin = parseFloat(config.measWin) || 6;
        this._lastMeasIter = undefined;
        this._prevIsOn = this.isOn;
        this._peers = [];
        this._rOnEff = this.rOn;

        // ── 调差特性参数 ──
        // 频率-有功下垂：满载(ratedPower) 时频率下降 freqDroop Hz（调差率 4%，50×4%=2Hz）
        this.freqDroop = parseFloat(config.freqDroop) || 2;
        // 电压-无功下垂：感性无功达到 qDroopVar(40kvar) 时线电压下降 vDroopV(20V，5%)
        this.qDroopVar = parseFloat(config.qDroopVar) || 40000;
        this.vDroopV   = parseFloat(config.vDroopV)   || 20;
        // AVR 自动电压调节：压降持续 avrDelay 秒后开始补偿，avrTime 秒内恢复原值
        this.avrDelay = parseFloat(config.avrDelay) || 8;
        this.avrTime  = parseFloat(config.avrTime)  || 5;

        // 实际输出量（含调差），供波形/LCD/遥控面板读取
        this._freqOut  = this.freq;
        this._vRmsOut  = this.vRms;
        this._avrTimer = 0;   // 压降持续时间
        this._avrComp  = 0;   // AVR 补偿量 0~1

        // ── 频率动态模型（负荷突变时频率过冲再回落）──
        // 二阶弹簧-阻尼系统：频率向静态下垂目标 f_target 收敛，阻尼比 <1 时产生过冲
        this._freq      = this.freq;                // 实际输出频率（动态）
        this._freqRate  = 0;                        // 频率变化率 df/dt
        this._wn        = parseFloat(config.freqWn)    || 2.5;  // 固有角频率 rad/s（越小转子越"重"）
        this._zeta      = parseFloat(config.freqZeta)  || 0.9; // 阻尼比（<1 有过冲）
    }

    _recalcRatedCurrent() {
        // 三相额定电流：Ie = P / (√3·U·cosφ)
        const denom = Math.sqrt(3) * this.ratedVoltage * this.ratedCosPhi;
        this.ratedCurrent = denom > 0 ? this.ratedPower * 1000 / denom : 0;
    }

    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
    }

    // ─────────────────────────── 静态绘制 ───────────────────────────
    _drawStaticParts() {
        const g = this._gen;

        // 左侧操作台面板
        this._staticGroup.add(new Konva.Rect({
            x: 0, y: 0, width: 157, height: this.height,
            fill: '#e8eef4', stroke: '#1a252f', strokeWidth: 1, cornerRadius: 3,
        }));
        // 右侧发电机面板
        this._staticGroup.add(new Konva.Rect({
            x: 167, y: 0, width: this.width - 167, height: this.height,
            fill: '#dfe7ee', stroke: '#1a252f', strokeWidth: 1, cornerRadius: 3,
        }));

        // 标题
        this._staticGroup.add(new Konva.Text({
            x: 0, y: 2, width: 157,
            text: '同步发电机', fontSize: 12, fontStyle: 'bold',
            fill: '#1a252f', align: 'center',
        }));

        // LCD 背景
        const lcd = this._ctrl.lcd;
        this._staticGroup.add(new Konva.Rect({
            x: lcd.x, y: lcd.y, width: lcd.w, height: lcd.h,
            fill: '#0a0e12', cornerRadius: 2, stroke: '#3a4a55', strokeWidth: 1,
        }));

        // 控制方式开关底座与标签
        this._drawSwitchBase();

        // 按钮底座（圆角凹槽）
        this._staticGroup.add(new Konva.Rect({
            x: this._ctrl.start.x - 2, y: this._ctrl.start.y - 2,
            width: this._ctrl.start.w + 4, height: this._ctrl.start.h + 4,
            fill: '#cdd8e0', cornerRadius: 4,
        }));
        this._staticGroup.add(new Konva.Rect({
            x: this._ctrl.stop.x - 2, y: this._ctrl.stop.y - 2,
            width: this._ctrl.stop.w + 4, height: this._ctrl.stop.h + 4,
            fill: '#cdd8e0', cornerRadius: 4,
        }));
        this._staticGroup.add(new Konva.Text({
            x: this._ctrl.start.x, y: this._ctrl.start.y + this._ctrl.start.h + 2,
            width: this._ctrl.start.w, text: '起动', fontSize: 11,
            fill: '#2e7d32', align: 'center', fontStyle: 'bold',
        }));
        this._staticGroup.add(new Konva.Text({
            x: this._ctrl.stop.x, y: this._ctrl.stop.y + this._ctrl.stop.h + 2,
            width: this._ctrl.stop.w, text: '停止', fontSize: 11,
            fill: '#b71c1c', align: 'center', fontStyle: 'bold',
        }));

        // 调速旋钮刻度盘
        const knob = this._ctrl.knob;
        this._staticGroup.add(new Konva.Circle({
            x: knob.x, y: knob.y, radius: knob.r + 4,
            fill: '#cfd8df', stroke: '#5a6a75', strokeWidth: 1,
        }));
        this._staticGroup.add(new Konva.Text({
            x: knob.x - 40, y: knob.y + knob.r + 4, width: 80,
            text: '减速  ←  加速', fontSize: 11, fill: '#333', align: 'center',
        }));

        // ── 发电机本体：定子 ──
        this._staticGroup.add(new Konva.Ring({
            x: g.cx, y: g.cy,
            innerRadius: g.rInner, outerRadius: g.rOuter,
            fill: '#7a8894', stroke: '#2c3a45', strokeWidth: 1,
        }));
        // 定子通风槽装饰
        for (let a = 0; a < 360; a += 20) {
            const rad = a * Math.PI / 180;
            const rx = g.cx + (g.rInner + 4) * Math.cos(rad);
            const ry = g.cy + (g.rInner + 4) * Math.sin(rad);
            this._staticGroup.add(new Konva.Circle({
                x: rx, y: ry, radius: 1.5, fill: '#56646e',
            }));
        }

        // ── 三相绕组（120° 对称，U红 / V绿 / W蓝 环形线圈）──
        const winding = (angDeg, label, fill, stroke, labelColor) => {
            const rad = angDeg * Math.PI / 180;
            const cx = g.cx + g.rWinding * Math.cos(rad);
            const cy = g.cy + g.rWinding * Math.sin(rad);
            this._staticGroup.add(new Konva.Ring({
                x: cx, y: cy,
                innerRadius: 7, outerRadius: 10,
                fill, stroke, strokeWidth: 1,
            }));
            this._staticGroup.add(new Konva.Text({
                x: cx - 5, y: cy - 3, width: 10,
                text: label, fontSize: 6, fontStyle: 'bold',
                fill: labelColor, align: 'center',
            }));
        };
        winding(90,  'V', '#20a030', '#0f7018', '#064d12');
        winding(210, 'U', '#e02020', '#8a1010', '#7a0000');
        winding(330, 'W', '#2a60d0', '#163a8a', '#0a2a6a');

        // ── 绕组引线 → 顶部端口（颜色与绕组一致）──
        const wire = (pts, color, wd = 2) => {
            this._staticGroup.add(new Konva.Line({
                points: pts, stroke: color, strokeWidth: wd,
                lineCap: 'round', lineJoin: 'round',
            }));
        };
        const topY = g.cy - g.rOuter; // 定子外缘顶部 y
        // V 相（顶部绕组，位于环内 r=52）→ v 端口（绿）
        wire([247, 88, 247, 0], '#20a030');
        // U 相（左下绕组）→ u 端口（红）
        wire([202, 114, 200, topY, 200, 0], '#e02020');
        // W 相（右下绕组）→ w 端口（蓝）
        wire([292, 114, 293, topY, 293, 0], '#2a60d0');
        // 中性线：中心 → n 端口
        wire([g.cx, g.cy, this._portX.n, g.cy, this._portX.n, 0], '#44505a', 1);
        // 定子顶部三个引出孔
        [200, 247, 293].forEach(x => {
            this._staticGroup.add(new Konva.Circle({
                x, y: topY, radius: 2, fill: '#2c3a45',
            }));
        });
        // 中性点标记
        this._staticGroup.add(new Konva.Circle({
            x: g.cx, y: g.cy, radius: 3, fill: '#44505a', stroke: '#222',
        }));
    }

    _drawSwitchBase() {
        const sw = this._ctrl.sw;
        // 底座（宽度 84，高度 29 → 39）
        this._staticGroup.add(new Konva.Rect({
            x: sw.x - 42, y: sw.y - 18, width: 84, height: 39,
            fill: '#cdd8e0', cornerRadius: 4, stroke: '#5a6a75', strokeWidth: 1,
        }));
        // 标签
        this._staticGroup.add(new Konva.Text({
            x: sw.x - 42, y: sw.y - 32, width: 84,
            text: '控制方式', fontSize: 11, fill: '#333', align: 'center',
        }));
        this._staticGroup.add(new Konva.Text({
            x: sw.x - 42, y: sw.y - 15, width: 30,
            text: '本地', fontSize: 11, fill: '#2e7d32', align: 'center', fontStyle: 'bold',
        }));
        this._staticGroup.add(new Konva.Text({
            x: sw.x + 12, y: sw.y - 15, width: 30,
            text: '遥控', fontSize: 11, fill: '#1565c0', align: 'center', fontStyle: 'bold',
        }));
    }

    // ─────────────────────────── 动态节点 ───────────────────────────
    _createDynamicNodes() {
        const g = this._gen;

        // ── 转子（两对磁极，可旋转）──
        this._rotorGroup = new Konva.Group({ x: g.cx, y: g.cy });
        // 转子轴
        this._rotorGroup.add(new Konva.Circle({
            x: 0, y: 0, radius: 7, fill: '#2c3a45', stroke: '#161d23', strokeWidth: 1,
        }));
        // 4 个磁极（上下左右，N/S 交替，径向范围 r≈7~32，不越定子内缘）
        const poles = [
            { x: -5,  y: -32, w: 11, h: 25, c: '#d03030' }, // 上 N
            { x: 7,   y: -5,  w: 25, h: 11, c: '#3060c8' }, // 右 S
            { x: -5,  y: 7,   w: 11, h: 25, c: '#d03030' }, // 下 N
            { x: -32, y: -5,  w: 25, h: 11, c: '#3060c8' }, // 左 S
        ];
        poles.forEach(p => {
            this._rotorGroup.add(new Konva.Rect({
                x: p.x, y: p.y,
                width: p.w, height: p.h,
                fill: p.c, stroke: '#8a1a1a', strokeWidth: 1, cornerRadius: 2,
            }));
        });
        this._rotorGroup.add(new Konva.Circle({
            x: 0, y: 0, radius: 4, fill: '#f5f7fa',
        }));
        this._rotorGroup.rotation(this._rotorAngle);
        this._dynamicGroup.add(this._rotorGroup);

        // ── LCD 动态文本 ──
        const lcd = this._ctrl.lcd;
        this._lcdFreq = new Konva.Text({
            x: lcd.x + 4, y: lcd.y + 2, width: lcd.w - 8,
            text: '', fontSize: 14, fontFamily: 'monospace',fontStyle:'bold',
            fill: '#00ff88', align: 'left',
        });
        this._lcdVolt = new Konva.Text({
            x: lcd.x + 4, y: lcd.y + 22, width: lcd.w - 8,
            text: '', fontSize: 14, fontFamily: 'monospace',fontStyle:'bold',
            fill: '#f4d744', align: 'left',
        });
        this._lcdRated = new Konva.Text({
            x: lcd.x + 4, y: lcd.y + 42, width: lcd.w - 8,
            text: '', fontSize: 14, fontFamily: 'monospace',fontStyle:'bold',
            fill: '#7dd3ff', align: 'left',
        });
        this._dynamicGroup.add(this._lcdFreq, this._lcdVolt, this._lcdRated);

        // ── 带灯按钮 ──
        this._startFace = new Konva.Rect({
            x: this._ctrl.start.x, y: this._ctrl.start.y,
            width: this._ctrl.start.w, height: this._ctrl.start.h,
            fill: '#2ecc71', cornerRadius: 3, stroke: '#1a7a3a', strokeWidth: 1,
        });
        this._stopFace = new Konva.Rect({
            x: this._ctrl.stop.x, y: this._ctrl.stop.y,
            width: this._ctrl.stop.w, height: this._ctrl.stop.h,
            fill: '#e74c3c', cornerRadius: 3, stroke: '#8a1a1a', strokeWidth: 1,
        });
        this._startLed = new Konva.Circle({
            x: this._ctrl.start.x + this._ctrl.start.w - 9, y: this._ctrl.start.y + this._ctrl.start.h / 2,
            radius: 4, fill: '#3a3a3a', stroke: '#222', strokeWidth: 1,
        });
        this._stopLed = new Konva.Circle({
            x: this._ctrl.stop.x + this._ctrl.stop.w - 9, y: this._ctrl.stop.y + this._ctrl.stop.h / 2,
            radius: 4, fill: '#3a3a3a', stroke: '#222', strokeWidth: 1,
        });
        this._dynamicGroup.add(this._startFace, this._stopFace, this._startLed, this._stopLed);

        // ── 调速旋钮指针（垂直向上为 0°）──
        const knob = this._ctrl.knob;
        this._knobPointer = new Konva.Line({
            x: knob.x, y: knob.y,
            points: [0, 0, 0, -knob.r + 5],
            stroke: '#f1f9f5', strokeWidth: 6, lineCap: 'round',
        });
        this._knobPointer.rotation(0);
        this._knobDisk = new Konva.Circle({
            x: knob.x, y: knob.y, radius: knob.r,
            fill: '#7f8c8d', stroke: '#4a5a63', strokeWidth: 1,
            cursor: 'pointer',
        });
        this._knobDisk.hitStrokeWidth(20);
        this._dynamicGroup.add(this._knobDisk, this._knobPointer);

        // ── 控制方式拨杆（旋钮，原尺寸×2）──
        this._switchKnob = new Konva.Group({ x: this._ctrl.sw.x, y: this._ctrl.sw.y+5 });
        this._switchKnob.add(new Konva.Line({
            points: [0, 0, 0, -16], stroke: '#2c3a45', strokeWidth: 6, lineCap: 'round',
        }));
        this._switchKnob.add(new Konva.Circle({
            x: 0, y: 0, radius: 10, fill: '#2c3a45', stroke: '#161d23', strokeWidth: 2,
        }));
        this._switchKnob.rotation(this.mode === 'local' ? -45 : 45);
        this._dynamicGroup.add(this._switchKnob);

        this._updateDisplay();
    }

    // ─────────────────────────── 交互绑定 ───────────────────────────
    _bindInteraction() {
        // 控制方式拨杆：点击切换 本地/遥控
        this._switchKnob.on('click tap', (e) => {
            e.cancelBubble = true;
            this.mode = (this.mode === 'local') ? 'remote' : 'local';
            new Konva.Tween({
                node: this._switchKnob,
                rotation: this.mode === 'local' ? -45 : 45,
                duration: 0.18,
            }).play();
            this.config.mode = this.mode;
            this._updateDisplay();
        });

        // 起动/停止带灯按钮
        const bindBtn = (face, onPress) => {
            let pressed = false;
            face.on('mousedown touchstart', (e) => {
                e.cancelBubble = true;
                if (!pressed) { pressed = true; face.y(face.y() + 1.5); }
                if (this.mode === 'local') onPress();
                this._updateDisplay();
            });
            face.on('mouseup touchend mouseleave', () => {
                if (pressed) { pressed = false; face.y(face.y() - 1.5); }
                this._updateDisplay();
            });
        };
        bindBtn(this._startFace, () => { this.isOn = true; });
        bindBtn(this._stopFace,  () => { this.isOn = false; });

        // 调速旋钮：按下右侧 → +45° 加速；左侧 → -45° 减速；松手回弹
        this._knobDisk.on('mousedown touchstart', (e) => {
            e.cancelBubble = true;
            const pos = this.sys.stage.getPointerPosition();
            const abs = this._knobDisk.getAbsolutePosition();
            this._knobDir = (pos && pos.x > abs.x) ? 1 : -1;
            this._tweenKnob(this._knobDir * 45);

            const onUp = () => {
                this._knobDir = 0;
                this._tweenKnob(0);
                window.removeEventListener('mouseup', onUp);
                window.removeEventListener('touchend', onUp);
            };
            window.addEventListener('mouseup', onUp);
            window.addEventListener('touchend', onUp);
        });
    }

    _tweenKnob(angle) {
        if (this._knobTw) this._knobTw.destroy();
        this._knobTw = new Konva.Tween({
            node: this._knobPointer, rotation: angle, duration: 0.12,
        });
        this._knobTw.play();
    }

    // ─────────────────────────── 端口 ───────────────────────────
    _addPorts() {
        const p = this._portX;
        const r = this._portRight;
        this.addPort(p.u, 0, 'u', 'wire', 'p');
        this.addPort(p.v, 0, 'v', 'wire', 'p');
        this.addPort(p.w, 0, 'w', 'wire', 'p');
        this.addPort(p.n, 0, 'n', 'wire');
        this.addPort(r.x, r.startA, 'rm_start_a', 'wire');
        this.addPort(r.x, r.startB, 'rm_start_b', 'wire');
        this.addPort(r.x, r.stopA,  'rm_stop_a',  'wire');
        this.addPort(r.x, r.stopB,  'rm_stop_b',  'wire');
        this.addPort(r.x, r.fInP,   'freq_in_p',  'wire', 'p');
        this.addPort(r.x, r.fInN,   'freq_in_n',  'wire', 'n');
    }

    // ─────────────────────────── 电源输出 ───────────────────────────
    getPhaseVoltage(phase, time) {
        if (!this.isOn) return 0;
        const vRms = this._vRmsOut || this.vRms;
        const freq = this._freqOut || this.freq;
        const peak = vRms * Math.SQRT2;
        const omega = 2 * Math.PI * freq;
        let offset = 0;
        if (phase === 'v')      offset = -4 * Math.PI / 3;
        else if (phase === 'w') offset = -2 * Math.PI / 3;
        return peak * Math.sin(omega * time + offset);
    }

    getLineVoltage() {
        return Math.sqrt(3) * (this._vRmsOut || this.vRms);
    }

    // ─────────────────────────── 仿真主循环 ───────────────────────────
    tick(dt) {
        const solver = this.sys && this.sys.voltageSolver;
        if (solver) {
            // ── 并联检测：与其它在网运行的同型电源（经导线/合闸开关形成同一导电网络）视为并联 ──
            this._peers = [];
            if (this.isOn) {
                const myU = solver.portToCluster.get(`${this.id}_wire_u`);
                if (myU !== undefined) {
                    // 并查集：导线簇 + 合闸 ACB 主触头（l↔t）构建导电连通图
                    const uf = new Map();
                    const root = (x) => {
                        if (!uf.has(x)) uf.set(x, x);
                        let r = x;
                        while (uf.get(r) !== r) r = uf.get(r);
                        let cur = x;
                        while (uf.get(cur) !== r) { const nx = uf.get(cur); uf.set(cur, r); cur = nx; }
                        return r;
                    };
                    const union = (a, b) => {
                        if (a === undefined || b === undefined) return;
                        const ra = root(a), rb = root(b);
                        if (ra !== rb) uf.set(ra, rb);
                    };
                    const p2c = solver.portToCluster;
                    for (const d of (solver.rawDevices || [])) {
                        if (!d || d.type !== 'ACB' || d._state !== 'on') continue;
                        [['l1','t1'],['l2','t2'],['l3','t3']].forEach(([a, b]) => {
                            union(p2c.get(`${d.id}_wire_${a}`), p2c.get(`${d.id}_wire_${b}`));
                        });
                    }
                    const rMy = root(myU);
                    for (const oid in this.sys.comps) {
                        if (oid === this.id) continue;
                        const oc = this.sys.comps[oid];
                        if (!oc || oc.type !== 'source_3p' || !oc.isOn) continue;
                        const ou = solver.portToCluster.get(`${oid}_wire_u`);
                        if (ou !== undefined && root(ou) === rMy) this._peers.push(oc);
                    }
                }
            }
            // 并联功率分配：调差率(freqDroop)大的机组分担的有功小，等效内阻与 freqDroop 成正比，
            // 使并联各机有功按频差系数反比分配（P_i ∝ 1/freqDroop_i）
            if (this._peers.length > 0) {
                let dSum = this.freqDroop, n = 1;
                for (const p of this._peers) { dSum += p.freqDroop; n++; }
                const dAvg = dSum / n;
                this._rOnEff = this.rOn * (dAvg > 0 ? this.freqDroop / dAvg : 1);
            } else {
                this._rOnEff = this.rOn;
            }
            // 遥控起动/停止：两个端口在同一簇即有效指令
            const a1 = solver.portToCluster.get(`${this.id}_wire_rm_start_a`);
            const a2 = solver.portToCluster.get(`${this.id}_wire_rm_start_b`);
            const b1 = solver.portToCluster.get(`${this.id}_wire_rm_stop_a`);
            const b2 = solver.portToCluster.get(`${this.id}_wire_rm_stop_b`);
            const remoteStart = a1 !== undefined && a1 === a2;
            const remoteStop  = b1 !== undefined && b1 === b2;
            if (this.mode === 'remote') {
                if (remoteStart) this.isOn = true;
                if (remoteStop)  this.isOn = false; // 停止指令优先
            }

            // 加速/减速指令端口：正电压加速、负电压减速
            const cP = solver.portToCluster.get(`${this.id}_wire_freq_in_p`);
            const cN = solver.portToCluster.get(`${this.id}_wire_freq_in_n`);
            if (cP !== undefined && cN !== undefined) {
                const vP = solver.nodeVoltages.get(cP) || 0;
                const vN = solver.nodeVoltages.get(cN) || 0;
                this._remoteRate = this._remoteGain * (vP - vN);
            } else {
                this._remoteRate = 0;
            }

            // ── 实际输出测量：每相电流 = (源电动势 - 相端电压)/内阻，滑窗求三相电流 RMS 与有功功率 ──
            // 状态翻转帧跳过测量：求解器本帧仍按旧 isOn stamp（端口电压未建立），
            // 若立即用新 isOn 计算 (emf - vu)/rOn 会产生瞬态大电流并被滑窗保留。
            if (this.isOn && this.isOn === this._prevIsOn) {
                const advanced = solver.globalIterCount !== this._lastMeasIter;
                this._lastMeasIter = solver.globalIterCount;
                if (advanced) {
                    const getV = (pId) => {
                        const c = solver.portToCluster.get(pId);
                        return c !== undefined ? (solver.nodeVoltages.get(c) || 0) : 0;
                    };
                    const vN = getV(`${this.id}_wire_n`);
                    const emfU = this.getPhaseVoltage('u', solver.currentTime);
                    const emfV = this.getPhaseVoltage('v', solver.currentTime);
                    const emfW = this.getPhaseVoltage('w', solver.currentTime);
                    const vu = getV(`${this.id}_wire_u`) - vN;
                    const vv = getV(`${this.id}_wire_v`) - vN;
                    const vw = getV(`${this.id}_wire_w`) - vN;
                    const rOn = this._rOnEff || this.rOn || 0.01;
                    const iu = (emfU - vu) / rOn;
                    const iv = (emfV - vv) / rOn;
                    const iw = (emfW - vw) / rOn;

                    const win = this._measWin;
                    const push = (arr, v) => { arr.push(v * v); if (arr.length > win) arr.shift(); };
                    push(this._curBufU, iu);
                    push(this._curBufV, iv);
                    push(this._curBufW, iw);
                    // 三相瞬时功率（带符号）：p = u·iu + v·iv + w·iw
                    this._pBuf.push((vu * iu + vv * iv + vw * iw) / 1000);
                    if (this._pBuf.length > win) this._pBuf.shift();

                    const avg = (arr) => Math.sqrt(arr.reduce((a, b) => a + b, 0) / arr.length);
                    const rU = avg(this._curBufU), rV = avg(this._curBufV), rW = avg(this._curBufW);
                    // 显示实际负载相电流（三相中最大相）
                    this._rmsI = Math.max(rU, rV, rW);
                    this._pwr = this._pBuf.reduce((a, b) => a + b, 0) / this._pBuf.length;
                }
            } else {
                this._curBufU.length = this._curBufV.length = this._curBufW.length = 0;
                this._pBuf.length = 0;
                this._rmsI = 0;
                this._pwr = 0;
            }
            // 起动瞬间：若并入正在运行的机组，将频率状态对齐到系统频率，避免相位冲击
            if (this.isOn && !this._prevIsOn && this._peers.length > 0) {
                let fAvg = 0, n = 0;
                for (const p of this._peers) { fAvg += (p._freqOut ?? p.freq) || 0; n++; }
                if (n > 0) { this._freq = fAvg / n; this._freqRate = 0; }
            }
            this._prevIsOn = this.isOn;
        }

        // 频率积分调节（手动旋钮 + 遥控指令叠加），并夹紧到上下限
        const rate = this._knobDir * this._manualRate + this._remoteRate;
        if (rate !== 0 || dt > 0) {
            this.freq = Math.max(this.freqMin, Math.min(this.freqMax, this.freq + rate * dt));
        }

        // ── 调差特性 ──
        // 1) 频率-有功下垂：满载 ratedPower(kW) 时频率下降 freqDroop(2Hz，4%)，频率不自动恢复，等待手动调节
        // 2) 电压-无功下垂 + AVR：感性无功达 qDroopVar(40kvar) 时线电压下降 vDroopV(20V，5%)，
        //    压降持续 avrDelay(3s) 后自动电压调节，avrTime 内逐渐恢复原值
        if (this.isOn) {
            const Pkw = this._pwr;
            let fTarget;
            if (this._peers.length > 0) {
                // 并联运行：统一设定频率（各机设定频率取平均），各机按自身频差系数独立下垂。
                // 稳态时各机频率相同（并联网强制同步），故 (P_i / ratedPower_i) * freqDroop_i 相等，
                // 即有功功率与频差系数成反比：调差率(freqDroop)越大的机组承担的有功越小。
                let fSum = this.freq;
                for (const p of this._peers) fSum += p.freq;
                const fSet = fSum / (this._peers.length + 1);
                fTarget = fSet - (this.ratedPower > 0 ? (Pkw / this.ratedPower) * this.freqDroop : 0);
            } else {
                // 单机运行：仅频率-有功下垂
                fTarget = this.freq - (this.ratedPower > 0 ? (Pkw / this.ratedPower) * this.freqDroop : 0);
            }
            // ── 频率：二阶动态（负荷突降时频率瞬时过冲再回落）──
            const wn = this._wn, zeta = this._zeta;
            const accel = wn * wn * (fTarget - this._freq) - 2 * zeta * wn * this._freqRate;
            this._freqRate += accel * dt;
            this._freq += this._freqRate * dt;
            this._freqOut = this._freq;

            const lineVset = Math.sqrt(3) * this.vRms;
            const S = Math.sqrt(3) * lineVset * this._rmsI;
            const P = Pkw * 1000;
            const Q = Math.sqrt(Math.max(0, S * S - P * P));
            this._qVar = Q;
            const droopV = this.qDroopVar > 0 ? (Q / this.qDroopVar) * this.vDroopV : 0;

            if (droopV > 1) {
                this._avrTimer += dt;
                if (this._avrTimer >= this.avrDelay) {
                    this._avrComp = Math.min(1, this._avrComp + dt / this.avrTime);
                }
            } else {
                this._avrTimer = 0;
                this._avrComp = Math.max(0, this._avrComp - dt / this.avrTime);
            }
            // vDroopV 为线电压降，折算到相电压（/√3）
            this._vRmsOut = this.vRms - (droopV / Math.sqrt(3)) * (1 - this._avrComp);
        } else {
            this._freqOut = this.freq;
            this._freq = this.freq;
            this._freqRate = 0;
            this._vRmsOut = this.vRms;
            this._avrTimer = 0;
            this._avrComp = 0;
            this._qVar = 0;
        }

        // 转子旋转（仅运行时），机械角速度 ∝ 实际输出频率（×3 放大，动画更明显）
        if (this.isOn) {
            this._rotorAngle += (this._freqOut / 50) * 9 * (dt / 0.05);
            this._rotorGroup.rotation(this._rotorAngle % 360);
        }

        this._updateDisplay();
        if (this.sys && typeof this.sys.requestRedraw === 'function') this.sys.requestRedraw();
    }

    _updateDisplay() {
        // LCD 与遥控面板一致：行1 电压/频率，行2 电流/功率，行3 功率因数
        const lineV = this.getLineVoltage();
        const cos = this._rmsI > 0
            ? Math.min(1, Math.max(-1, (this._pwr * 1000) / (Math.sqrt(3) * lineV * this._rmsI)))
            : 0;
        // 电流/功率 >100 去掉小数点，否则保留 1 位小数
        const fmt = (v) => v > 100 ? v.toFixed(0) : v.toFixed(1);
        if (this._lcdFreq) {
            this._lcdFreq.text(this.isOn ? `V ${lineV.toFixed(1)}V  F ${(this._freqOut ?? this.freq).toFixed(1)}Hz` : 'V--  F--');
        }
        if (this._lcdVolt) {
            this._lcdVolt.text(this.isOn ? `I ${fmt(this._rmsI)}A  P ${fmt(this._pwr)}kW` : 'I--  P--');
        }
        if (this._lcdRated) {
            this._lcdRated.text(this.isOn ? `COSφ ${cos.toFixed(2)}` : 'COS--');
        }
        // 带灯按钮：运行→起动灯亮(绿)，停机→停止灯亮(红)
        if (this._startLed) {
            this._startLed.fill(this.isOn ? '#7dffb0' : '#3a3a3a');
        }
        if (this._stopLed) {
            this._stopLed.fill(this.isOn ? '#3a3a3a' : '#ff7d6b');
        }
    }

    // ─────────────────────────── 配置 ───────────────────────────
    getConfigFields() {
        return [
            { label: '初始频率 (Hz)',     key: 'freq',    type: 'number' },
            { label: '相电压有效值 (V)',  key: 'vRms',    type: 'number' },
            { label: '额定功率 (kW)',     key: 'ratedPower',   type: 'number' },
            { label: '额定电压 (V 线)',   key: 'ratedVoltage', type: 'number' },
            { label: '额定功率因数',      key: 'ratedCosPhi',  type: 'number', step: 0.01 },
            { label: '初始状态', key: 'isOn', type: 'select', get: c => c.isOn, options: [
                { label: '停机', value: false },
                { label: '运行', value: true },
            ]},
            { label: '满载频率下垂 (Hz)',   key: 'freqDroop', type: 'number', step: 0.5 },
            { label: '无功下垂基准 (kvar)', key: 'qDroopVar', type: 'number' },
            { label: '最大电压降 (V 线)',   key: 'vDroopV',   type: 'number' },
            { label: 'AVR 恢复延时 (s)',    key: 'avrDelay',  type: 'number' },
            { label: 'AVR 恢复时间 (s)',    key: 'avrTime',   type: 'number' },
            { label: '频率动态频率 (rad/s)', key: 'freqWn',    type: 'number' },
            { label: '阻尼比 (zeta)',       key: 'freqZeta',  type: 'number', step: 0.05 },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.freq    !== undefined) this.freq    = parseFloat(cfg.freq)    || 50;
        if (cfg.freqMin !== undefined) this.freqMin = parseFloat(cfg.freqMin) || 45;
        if (cfg.freqMax !== undefined) this.freqMax = parseFloat(cfg.freqMax) || 55;
        if (cfg.vRms    !== undefined) this.vRms    = parseFloat(cfg.vRms)    || 230;
        if (cfg.ratedPower   !== undefined) { this.ratedPower   = parseFloat(cfg.ratedPower);   this._recalcRatedCurrent(); }
        if (cfg.ratedVoltage !== undefined) { this.ratedVoltage = parseFloat(cfg.ratedVoltage); this._recalcRatedCurrent(); }
        if (cfg.ratedCosPhi  !== undefined) { this.ratedCosPhi  = parseFloat(cfg.ratedCosPhi);  this._recalcRatedCurrent(); }
        if (cfg.isOn    !== undefined) this.isOn    = cfg.isOn === true || cfg.isOn === 'true';
        if (cfg.mode    !== undefined) {
            this.mode = cfg.mode === 'remote' ? 'remote' : 'local';
            if (this._switchKnob) this._switchKnob.rotation(this.mode === 'local' ? -45 : 45);
        }
        if (cfg.freqDroop !== undefined) this.freqDroop = parseFloat(cfg.freqDroop) || 2;
        if (cfg.qDroopVar !== undefined) this.qDroopVar = parseFloat(cfg.qDroopVar) || 40000;
        if (cfg.vDroopV   !== undefined) this.vDroopV   = parseFloat(cfg.vDroopV)   || 20;
        if (cfg.avrDelay  !== undefined) this.avrDelay  = parseFloat(cfg.avrDelay)  || 8;
        if (cfg.avrTime   !== undefined) this.avrTime   = parseFloat(cfg.avrTime)   || 5;
        if (cfg.freqWn    !== undefined) this._wn       = parseFloat(cfg.freqWn)    || 2.5;
        if (cfg.freqZeta  !== undefined) this._zeta     = parseFloat(cfg.freqZeta)  || 0.9;
        this.freq = Math.max(this.freqMin, Math.min(this.freqMax, this.freq));
        this.config = { ...this.config, ...cfg };
        this._updateDisplay();
        if (this.sys && typeof this.sys.requestRedraw === 'function') this.sys.requestRedraw();
    }

    destroy() { super.destroy?.(); }
}
