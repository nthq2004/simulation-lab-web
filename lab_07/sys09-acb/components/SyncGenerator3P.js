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
            maxDropV:  this.maxDropV,
            avrMaxComp: this.avrMaxComp,
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
        // 遥控电压→频率变化率 Hz/(s·V)。不宜过大：调速指令为 bang-bang（并车/自动调频），
        // 过快的响应与面板指令延时叠加会产生±1Hz 频率极限环，导致无法并车。
        // 0.6 Hz/s 下同步能稳定收敛（此前 2.0 会使 df 持续振荡、qf2 无法合闸）。
        this._remoteGain = parseFloat(config.remoteGain) || 0.6;
        this._knobDir    = 0;     // 旋钮当前偏转方向（-1/0/+1）
        this._remoteRate = 0;     // 遥控指令引起的频率变化率
        this._rotorAngle = 0;     // 转子累积机械角度

        // 额定参数（铭牌）：额定功率/额定电压(线)/额定功率因数 → 额定电流
        this.ratedPower  = parseFloat(config.ratedPower)  || 400;  // kW
        this.ratedVoltage = parseFloat(config.ratedVoltage) || 400; // 线电压 V
        this.ratedCosPhi = parseFloat(config.ratedCosPhi) || 0.8;
        this._recalcRatedCurrent();

        // 实际输出测量（滑动窗口 RMS）
        // 关键时序：solver.update() 每物理 tick(50ms) 只推进 currentTime += 0.5ms，
        // 而测量每 tick 推 1 个瞬时样本 → 样本间隔恰为 0.5ms。
        // 50Hz 周期 = 20ms = 40 样本。窗口必须覆盖整数个完整周期，
        // 否则 RMS 随窗口相位滑动剧烈波动（24 样本=12ms=0.6 周期 → 电流/无功/
        // 功率因数 ±10% 跳变）。measWin=40 覆盖恰好 1 个整周期 → RMS 精确稳定。
        this._curBufU = []; this._curBufV = []; this._curBufW = [];
        this._pBuf = [];
        this._rmsI = 0;
        this._pwr = 0;
        // 端子电压实测（滑窗 RMS）：与电子脱扣器测量保持同步
        this._vBufU = []; this._vBufV = []; this._vBufW = [];
        this._rmsV = 0;
        this._measWin = parseFloat(config.measWin) || 40;
        this._lastMeasIter = undefined;
        this._prevIsOn = this.isOn;
        this._peers = [];
        this._lastPeerCnt = 0;
        this._rOnEff = this.rOn;
        this._phaseShift = 0;   // 并联相位偏移（弧度）：并车时对齐到系统相位
        this._peerFreq = null;  // 并联集群共享频率（本机参与集群控制后同步）

        // ── 调差特性参数 ──
        // 频率-有功下垂：满载(ratedPower) 时频率下降 freqDroop Hz（调差率 4%，50×4%=2Hz）
        this.freqDroop = parseFloat(config.freqDroop) || 2;
        // 电压-无功下垂：感性无功达到 qDroopVar(40kvar) 时线电压下降 vDroopV(10V，2.5%)
        // （vDroopV 由 20V 减半为 10V：加 350kW 满载负载时母线电压降约减半）
        this.qDroopVar = parseFloat(config.qDroopVar) || 40000;
        this.vDroopV   = parseFloat(config.vDroopV)   || 10;
        // AVR 自动电压调节：压降持续 avrDelay 秒后开始补偿，avrTime 秒内恢复原值
        this.avrDelay = parseFloat(config.avrDelay) || 8;
        this.avrTime  = parseFloat(config.avrTime)  || 5;
        // AVR 闭环最大可补偿的线电压降（V）：阻性/感性负载的内阻分压均可恢复
        this.maxDropV = parseFloat(config.maxDropV) || 40;
        // AVR 最大补偿比例（0~1）：限制最大升压，避免重载/起动瞬间补偿过头导致电压过冲
        this.avrMaxComp = parseFloat(config.avrMaxComp) !== undefined ? parseFloat(config.avrMaxComp) : 0.7;

        // 实际输出量（含调差），供波形/LCD/遥控面板读取
        this._freqOut  = this.freq;
        this._vRmsOut  = this.vRms;
        this._avrTimer = 0;   // 压降持续时间
        this._avrComp  = 0;   // AVR 补偿量 0~1
        this._errFilt  = 0;   // 端子电压误差低通滤波值（相电压）

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
        return peak * Math.sin(omega * time + offset + this._phaseShift);
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
            // 并联功率分配：内阻均分（调差率分配）。
            // 调差率(freqDroop)大的机组分担的有功小，等效内阻与 freqDroop 成正比，
            // 使并联各机有功按频差系数反比分配（P_i ∝ 1/freqDroop_i）。
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
                // 节点电压可能为 NaN（并网冲击瞬态），NaN 会污染遥控频率设定值
                this._remoteRate = (isFinite(vP) && isFinite(vN)) ? this._remoteGain * (vP - vN) : 0;
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
                    // 并网冲击帧过滤：合闸瞬间（peer 数刚变化）本机相位尚未对齐，
                    // 求解器会把两电源接在极端相位差上，产生物理上不可能的巨幅瞬态电流。
                    // 这类样本不进入测量窗，避免污染 RMS/功率显示。
                    const inSurgeFrame = this._peers.length > 0 && this._lastPeerCnt === 0;
                    const iMax = this.ratedCurrent * 6;
                    const sane = (v) => !inSurgeFrame && Math.abs(v) < iMax;
                    const push = (arr, v) => { arr.push(v * v); if (arr.length > win) arr.shift(); };
                    if (sane(iu) && sane(iv) && sane(iw)) {
                        push(this._curBufU, iu);
                        push(this._curBufV, iv);
                        push(this._curBufW, iw);
                        // 端子电压同步采样（与电流同窗口），RMS 后供 LCD 显示
                        push(this._vBufU, vu);
                        push(this._vBufV, vv);
                        push(this._vBufW, vw);
                        // 三相瞬时功率（带符号）：p = u·iu + v·iv + w·iw
                        this._pBuf.push((vu * iu + vv * iv + vw * iw) / 1000);
                        if (this._pBuf.length > win) this._pBuf.shift();
                    }

                    const avg = (arr) => arr.length > 0 ? Math.sqrt(arr.reduce((a, b) => a + b, 0) / arr.length) : 0;
                    const rU = avg(this._curBufU), rV = avg(this._curBufV), rW = avg(this._curBufW);
                    // 显示实际负载相电流（三相中最大相）
                    this._rmsI = Math.max(rU, rV, rW);
                    // 端子相电压 RMS：三相平均（与电子脱扣器测量一致）
                    this._rmsV = (avg(this._vBufU) + avg(this._vBufV) + avg(this._vBufW)) / 3;
                    // 缓冲为空（起动/并网清窗后测量帧被过滤）时不能算 0/0=NaN
                    this._pwr = this._pBuf.length > 0 ? this._pBuf.reduce((a, b) => a + b, 0) / this._pBuf.length : 0;
                }
            } else {
                this._curBufU.length = this._curBufV.length = this._curBufW.length = 0;
                this._vBufU.length = this._vBufV.length = this._vBufW.length = 0;
                this._pBuf.length = 0;
                this._rmsI = 0;
                this._pwr = 0;
                this._rmsV = 0;
            }
            // 起动瞬间/并网瞬间：本机与在网机组建立连接（0→N peer）时，
            // 将频率与相位对齐到集群主机。本模型电动势相位为 ω·t 解析式，
            // 只要各机频率严格相等且相位偏移一致，相位即处处相等 → 零环流。
            // （注意：不能把 follower 的相位算成 (ω_l-ω_s)·t0 的固定偏置——那会留下
            //  永久相位差；必须直接复制主机的 freq 与 shift，二者都相同则相位恒等。）
            if (this.isOn && this._peers.length > 0 && this._lastPeerCnt === 0) {
                let leader = this;
                for (const p of this._peers) if (p.id < leader.id) leader = p;
                if (leader !== this) {
                    this._phaseShift = leader._phaseShift || 0;
                    this._freq = leader._freq;
                    this._freqRate = leader._freqRate;
                    // 并联机组挂同一母线，端子电压必须一致：复制主机输出电动势幅值，
                    // 避免本机因并网前空载电压偏高/偏低造成电压差 → 环流。
                    if (isFinite(leader._vRmsOut)) {
                        this._vRmsOut = leader._vRmsOut;
                        this._avrComp = leader._avrComp || 0;
                        this._avrTimer = leader._avrTimer || 0;
                        this._qVar = leader._qVar || 0;
                    }
                }
                // 并网冲击电流已进入所有在网机组的测量窗，统一清空避免污染显示
                this._curBufU.length = this._curBufV.length = this._curBufW.length = 0;
                this._pBuf.length = 0;
                for (const p of this._peers) {
                    if (p._curBufU) p._curBufU.length = p._curBufV.length = p._curBufW.length = 0;
                    if (p._pBuf) p._pBuf.length = 0;
                }
            }
            this._lastPeerCnt = this._peers.length;
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
            // 下垂用功率限幅：并网冲击/测量窗口混入瞬态大值会使调差率项爆发式偏离，
            // 进而频率发散、相位旋转加剧（正反馈）。物理调速器输出有限幅，这里将
            // 参与下垂计算的功率夹在 ±2×额定功率内，保证最大下垂偏移 ≤ 2×freqDroop。
            const clampP = (p) => Math.max(-2 * p.ratedPower, Math.min(2 * p.ratedPower, p._pwr));
            const Pkw = clampP(this);
            let fTarget;
            let leader = null;
            if (this._peers.length > 0) {
                // 并联运行：各机按同一目标频率调节（基于系统总负荷统一下垂），保证各机频率完全一致。
                // 物理上并联网会通过同步转矩强制各机同频（相位锁定），本模型源电动势为 ω·t 解析式，
                // 故必须让各机频率严格相等，否则相位持续漂移 → 环流冲击 → 数值爆炸。
                // 各机有功分配由内阻调差实现（_rOnEff ∝ freqDroop，见上文），此处不再按单机下垂。
                leader = this;
                for (const p of this._peers) if (p.id < leader.id) leader = p;
                // 下垂基准用"空载设定频率"this.freq（旋钮/遥控调频目标），
                // 不能用当前动态频率 _freq：否则基准本身随下垂下降，每帧再减下垂 → 频率持续下滑。
                let fSum = this.freq, n = 1, Ptot = Pkw, Prated = this.ratedPower, dSum = this.freqDroop;
                for (const p of this._peers) {
                    fSum += p.freq; n++;
                    Ptot += clampP(p); Prated += p.ratedPower; dSum += p.freqDroop;
                }
                const fSet = fSum / n;
                const dAvg = dSum / n;
                fTarget = fSet - (Prated > 0 ? (Ptot / Prated) * dAvg : 0);
            } else {
                // 单机运行：仅频率-有功下垂
                fTarget = this.freq - (this.ratedPower > 0 ? (Pkw / this.ratedPower) * this.freqDroop : 0);
            }
            // ── 频率：二阶动态（负荷突降时频率瞬时过冲再回落）──
            const wn = this._wn, zeta = this._zeta;
            // 防御：任何一次异常把 _freq/_freqRate 污染为 NaN 后，+= 运算永远无法自愈，
            // 频率一旦 NaN 会随从机复制扩散到整个并网集群。此处强制复位。
            if (!isFinite(this._freq) || !isFinite(this._freqRate)) {
                this._freq = this.freq;
                this._freqRate = 0;
            }
            const accel = wn * wn * (fTarget - this._freq) - 2 * zeta * wn * this._freqRate;
            this._freqRate += accel * dt;
            this._freq += this._freqRate * dt;
            this._freqOut = this._freq;
            // 从机严格跟随主机频率（保持并联集群严格同频）。
            // 注意：相位偏移(_phaseShift)只在并网瞬间对齐一次，这里不可覆盖，
            // 否则会撤销并网时算好的相位对齐，导致相位差重新积累 → 环流爆炸。
            if (leader && leader !== this) {
                this._freq = leader._freq;
                this._freqRate = leader._freqRate;
                this._freqOut = leader._freq;
            }

            const lineVset = Math.sqrt(3) * this.vRms;
            // 无功计算限幅：S 中的 _rmsI 若混入并网冲击瞬态大值，Q 会爆炸 → droopV 爆炸 →
            // _vRmsOut 变为巨幅负值 → 电动势爆炸（正反馈）。用电流上限封住 S。
            // 注意限幅必须取额定电流：若取 2.5×，并网瞬间 _rmsI≈2000A 仍会把 Q 推到
            // 800kvar、droopV→400V，_vRmsOut 被夹到 0.5vRms=115V → 本机电动势塌到
            // 另一半 → 机组间出现 ~115V 电压差 → 环流持续数秒（负反馈被 AVR 缓慢恢复）。
            const Ilimit = this.ratedCurrent;
            const S = Math.sqrt(3) * lineVset * Math.min(this._rmsI, Ilimit);
            const P = Pkw * 1000;
            const Q = Math.sqrt(Math.max(0, S * S - P * P));
            this._qVar = Q;

            // ── AVR 闭环：以实测端子电压 _rmsV 为准（含内阻分压）──
            // 端子相电压实测值；若尚未采到（起动/空载清窗）回退设定值，避免误触发。
            const termV = this._rmsV > 0 ? this._rmsV : this.vRms;
            // 实测压降（相）：设定空载相电压 - 实测端子相电压。正值表示带载后端子电压偏低，
            // 既包含无功下垂，也包含阻性负载在内阻 rOn 上的有功分压。
            const dropPh = this.vRms - termV;

            // ── 记忆型积分（死区 + 低通 + 对称速率，无过冲）──
            // 欠压(dropPh>死区)→补偿量慢速上升；过压(dropPh<-死区)→对称回落；
            // 达标(死区内)→保持当前补偿（记忆型，消除稳态误差且不过冲）。
            // 误差先低通滤波，滤除 _rmsV 测量窗口的抖动与滞后。
            this._errFilt = (this._errFilt || 0) + (dropPh - (this._errFilt || 0)) * Math.min(1, dt / 1.0);
            const db = 0.5;   // 死区（V，相电压）
            const maxC = this.avrMaxComp || 0.7;  // 补偿量上限（防起动瞬间过冲）
            const rate = (1 / (this.avrTime * 1.5)) * dt;  // 每帧最大变化量（放缓防过冲）
            if (this._errFilt > db) {
                this._avrTimer += dt;
                if (this._avrTimer >= this.avrDelay) {
                    this._avrComp = Math.min(maxC, this._avrComp + rate);
                }
            } else if (this._errFilt < -db) {
                this._avrTimer = 0;
                this._avrComp = Math.max(0, this._avrComp - rate);
            }
            // 死区内（|err|<0.5V）：保持当前补偿量，不增不减
            // 输出相电压 = 空载电压 + 补偿升压（抵消内阻/无功分压，使端子恢复 vRms）。
            // 补偿上限 maxDropV(线电压) 折算到相电压 /√3，夹在 0.5vRms~1.3vRms 防并网冲击。
            this._vRmsOut = Math.max(0.5 * this.vRms, Math.min(1.3 * this.vRms,
                this.vRms + (this.maxDropV / Math.sqrt(3)) * this._avrComp));
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
        // 电压使用实测端子值（与电子脱扣器同步）；未测到前回退到设定值
        const lineV = this._rmsV > 0 ? Math.sqrt(3) * this._rmsV : this.getLineVoltage();
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
            { label: 'AVR 最大补偿压降 (V线)', key: 'maxDropV', type: 'number' },
            { label: 'AVR 最大补偿比例 (0~1)', key: 'avrMaxComp', type: 'number', step: 0.05 },
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
        if (cfg.maxDropV  !== undefined) this.maxDropV  = parseFloat(cfg.maxDropV)  || 40;
        if (cfg.avrMaxComp !== undefined) this.avrMaxComp = parseFloat(cfg.avrMaxComp);
        if (cfg.freqWn    !== undefined) this._wn       = parseFloat(cfg.freqWn)    || 2.5;
        if (cfg.freqZeta  !== undefined) this._zeta     = parseFloat(cfg.freqZeta)  || 0.9;
        this.freq = Math.max(this.freqMin, Math.min(this.freqMax, this.freq));
        this.config = { ...this.config, ...cfg };
        this._updateDisplay();
        if (this.sys && typeof this.sys.requestRedraw === 'function') this.sys.requestRedraw();
    }

    destroy() { super.destroy?.(); }
}
