import { BaseComponent } from './BaseComponent.js';

/**
 * PIR 红外感应开关（Motion Sensor Switch）仿真组件
 *
 * ── 结构说明 ──────────────────────────────────────────────────
 *
 *  PIR 感应开关是一种被动红外自动开关，由以下部分组成：
 *
 *  1. 外壳面板（Housing）：米白色方形塑料面板，带凸出圆形传感器区
 *  2. 菲涅耳透镜罩（Fresnel Lens Dome）：中央半球形半透明乳白罩，
 *     内置 PIR 传感器芯片，用于聚焦人体红外热辐射
 *  3. 传感器芯片（PIR Sensor）：透镜罩内可见的深色方形芯片
 *  4. 凹陷圆环台（Sensor Mount Ring）：面板上的圆形内凹台阶，
 *     托起菲涅耳透镜罩
 *  5. 品牌 Logo / 文字（右下角）
 *  6. 底部接线端子（Terminals）：L（相线进）、N（零线）、L'（出线）
 *     带红色线鼻接线盒
 *
 * ── 工作原理 ──────────────────────────────────────────────────
 *
 *  感应到人体移动（triggerMotion()）→ 立即合闸（输出接通）
 *  合闸后若在 holdTime 秒内无新感应 → 倒计时结束后自动分闸
 *  再次感应到移动 → 重置倒计时
 *
 * ── 状态机 ────────────────────────────────────────────────────
 *
 *  IDLE     : 无感应，输出断开，透镜蓝色待机光
 *  TRIGGERED: 感应中，输出接通，透镜橙色暖光 + 绿色检测环
 *  HOLDING  : 感应消失，保持接通，倒计时 holdTime 秒，透镜黄色
 *  COOLDOWN : 分闸后短暂冷却（500ms），防止抖动重触发
 *
 * ── 动画效果 ──────────────────────────────────────────────────
 *
 *  触发时：透镜发光脉冲 + 扫描波纹从透镜向外扩散
 *  保持倒计时：透镜外圈弧形进度条（橙色 → 红色）
 *  分闸时：透镜渐暗动画（200ms 缓动）
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  terminal_l  — L  相线进线
 *  terminal_n  — N  零线
 *  terminal_lo — L' 相线出线（受控输出）
 *
 * ── 可配置参数 ────────────────────────────────────────────────
 *  holdTime    : 断开延时（秒），默认 30 s，范围 1～3600 s
 *  sensitivity : 灵敏度档位 HIGH / MEDIUM / LOW
 *  ratedVoltage: 额定电压（V）
 *  ratedCurrent: 额定电流（A）
 *  label       : 位号
 */
export class PIRSwitch extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(150, config.width  || 190);
        this.height = Math.max(150, config.height || 190);

        this.type    = 'pir_switch';
        this.special = 'none';
        this.cache   = 'fixed';

        this._initGroups();
        // ── 额定参数 ──
        this.ratedVoltage = config.ratedVoltage || 220;
        this.ratedCurrent = config.ratedCurrent || 10;
        this.label        = config.label        || 'KP';
        this.sensitivity  = config.sensitivity  || 'HIGH'; // HIGH / MEDIUM / LOW

        // ── 延时参数 ──
        // holdTime：检测到人体后，最后一次感应消失到自动断开的延时（秒）
        this.holdTime     = parseFloat(config.holdTime) || 30;

        // ── 状态机 ──
        // 'IDLE' | 'TRIGGERED' | 'HOLDING' | 'COOLDOWN'
        this._state       = 'IDLE';
        this._holdRemain  = 0;     // 保持倒计时剩余秒
        this._coolRemain  = 0;     // 冷却剩余秒
        this._closed      = false; // 输出触点状态
        this.opsCount     = config.initOps || 0;

        // ── 动画状态 ──
        this._glowAlpha   = 0.0;   // 透镜光晕强度 0~1
        this._rippleR     = 0;     // 扫描波纹半径
        this._rippleAlpha = 0;
        this._pulsePhase  = 0;     // 脉冲相位（TRIGGERED 时持续跳动）

        // ── 几何尺寸 ──
        const W = this.width, H = this.height;

        this._housing = {
            x: W*0.04, y: H*0.04,
            w: W*0.92, h: H*0.80,
            rx: 8,
        };

        // 圆形传感器台（面板中央圆形内凹区）
        const hx = this._housing.x, hy = this._housing.y;
        const hw = this._housing.w, hh = this._housing.h;
        this._sensorRingR = Math.min(hw, hh) * 0.36;
        this._sensorCX    = hx + hw / 2;
        this._sensorCY    = hy + hh / 2 - hh * 0.04;

        // 菲涅耳透镜罩半径
        this._lensR = this._sensorRingR * 0.62;

        // 接线端子区
        this._terminalArea = {
            x: W*0.04, y: H*0.85,
            w: W*0.92, h: H*0.10,
        };
        this._termL  = { x: W*0.22 };
        this._termN  = { x: W*0.50 };
        this._termLo = { x: W*0.78 };


        this._init();

        // ── 注册端口 ──
        const tyBottom = this._terminalArea.y + this._terminalArea.h + 4;
        this.addPort(this._termL.x,  tyBottom, 'terminal_l',  'wire', 'L');
        this.addPort(this._termN.x,  tyBottom, 'terminal_n',  'wire', 'N');
        this.addPort(this._termLo.x, tyBottom, 'terminal_lo', 'wire', "L'");
    }

    // ═══════════════════════════════════════════
    _init() {
        this._drawHousing();
        this._drawScrews();
        this._drawSensorRing();
        this._drawTerminalArea();
        this._drawBrandText();
        this._drawLabel();
        this._rebuildDynamic();

        this._drawStatusPanel();
        
    }

    // ── 外壳 ─────────────────────────────────
    _drawHousing() {
        const b = this._housing;
        // 阴影
        this._staticGroup.add(new Konva.Rect({
            x: b.x+3, y: b.y+3, width: b.w, height: b.h,
            fill: 'rgba(0,0,0,0.16)', cornerRadius: b.rx+1,
        }));
        // 主体
        this._staticGroup.add(new Konva.Rect({
            x: b.x, y: b.y, width: b.w, height: b.h,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: b.w, y: b.h },
            fillLinearGradientColorStops: [0,'#f2f0ec',0.4,'#eae8e2',0.75,'#dedad4',1,'#ccc8c2'],
            stroke: '#b0aca6', strokeWidth: 1.2,
            cornerRadius: b.rx,
        }));
        // 顶面高光
        this._staticGroup.add(new Konva.Rect({
            x: b.x+2, y: b.y+2, width: b.w*0.55, height: b.h*0.14,
            fill: 'rgba(255,255,255,0.30)', cornerRadius: [b.rx,0,0,0],
        }));
        // 内凹边框（面板内嵌感）
        this._staticGroup.add(new Konva.Rect({
            x: b.x+b.w*0.05, y: b.y+b.h*0.05,
            width: b.w*0.90, height: b.h*0.90,
            fill: 'rgba(0,0,0,0.03)',
            stroke: 'rgba(0,0,0,0.08)', strokeWidth: 1,
            cornerRadius: b.rx-2,
        }));
    }

    // ── 四角螺钉 ─────────────────────────────
    _drawScrews() {
        const b = this._housing;
        const r = this.width * 0.022;
        const ox = b.w*0.12, oy = b.h*0.10;
        [
            { x: b.x+ox,       y: b.y+oy },
            { x: b.x+b.w-ox,   y: b.y+oy },
            { x: b.x+ox,       y: b.y+b.h-oy },
            { x: b.x+b.w-ox,   y: b.y+b.h-oy },
        ].forEach(({ x, y }) => {
            this._staticGroup.add(new Konva.Circle({
                x, y, radius: r,
                fillRadialGradientStartPoint: { x:-r*0.3, y:-r*0.3 },
                fillRadialGradientEndPoint:   { x:0, y:0 },
                fillRadialGradientStartRadius: 0,
                fillRadialGradientEndRadius:   r,
                fillRadialGradientColorStops:  [0,'#d8d4ce',1,'#a8a49e'],
                stroke: '#909090', strokeWidth: 0.7,
            }));
            this._staticGroup.add(new Konva.Line({ points:[x-r*0.55,y, x+r*0.55,y], stroke:'#707070', strokeWidth:0.9, lineCap:'round' }));
            this._staticGroup.add(new Konva.Line({ points:[x,y-r*0.55, x,y+r*0.55], stroke:'#707070', strokeWidth:0.9, lineCap:'round' }));
        });
    }

    // ── 圆形传感器台（静态底层） ──────────────
    _drawSensorRing() {
        const cx = this._sensorCX, cy = this._sensorCY;
        const rr = this._sensorRingR;

        // 外圆凹槽（渐变形成立体内凹感）
        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: rr + 4,
            fillRadialGradientStartPoint: { x: -rr*0.2, y: -rr*0.2 },
            fillRadialGradientEndPoint:   { x: 0, y: 0 },
            fillRadialGradientStartRadius: rr*0.5,
            fillRadialGradientEndRadius:   rr + 4,
            fillRadialGradientColorStops: [0,'#dedad4',1,'#c0bbb5'],
            stroke: '#a8a49e', strokeWidth: 1.2,
        }));

        // 内圆台阶底面（深色内凹）
        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: rr,
            fillRadialGradientStartPoint: { x: 0, y: 0 },
            fillRadialGradientEndPoint:   { x: 0, y: 0 },
            fillRadialGradientStartRadius: 0,
            fillRadialGradientEndRadius:   rr,
            fillRadialGradientColorStops: [0,'#c8c4be',0.5,'#b8b4ae',1,'#a0a09a'],
            stroke: '#909090', strokeWidth: 0.5,
        }));

        // 内凹环形阴影（立体感）
        this._staticGroup.add(new Konva.Arc({
            x: cx, y: cy,
            innerRadius: rr*0.88, outerRadius: rr,
            angle: 360,
            fill: 'rgba(0,0,0,0.12)',
        }));

        // 透镜托台（稍小一圈，凸起台阶）
        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: this._lensR + 5,
            fill: '#d0ccc6',
            stroke: '#b0aca6', strokeWidth: 0.8,
        }));
    }

    // ── 动态层：透镜 + 光效 + 波纹 + 进度弧 ─
    _rebuildDynamic() {
        this._dynamicGroup.destroyChildren();

        const cx = this._sensorCX, cy = this._sensorCY;
        const lr = this._lensR;
        const sr = this._sensorRingR;
        const st = this._state;
        const ga = this._glowAlpha;

        // ── 透镜底色 ──
        // 根据状态选择透镜配色
        let lensColor0, lensColor1;
        if (st === 'TRIGGERED') {
            lensColor0 = '#b0e0ff';
            lensColor1 = '#80c8f0';
        } else if (st === 'HOLDING') {
            lensColor0 = '#d0d8c0';
            lensColor1 = '#b0bca0';
        } else {
            lensColor0 = '#c8d0d8';
            lensColor1 = '#a0aab4';
        }
        this._dynamicGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: lr,
            fillRadialGradientStartPoint: { x: -lr*0.3, y: -lr*0.3 },
            fillRadialGradientEndPoint:   { x: 0, y: 0 },
            fillRadialGradientStartRadius: 0,
            fillRadialGradientEndRadius:   lr,
            fillRadialGradientColorStops:  [0, lensColor0, 1, lensColor1],
            stroke: '#8090a0', strokeWidth: 0.8,
        }));

        // ── 菲涅耳透镜同心环纹（半透明纹理）──
        for (let i = 1; i <= 4; i++) {
            const rr = lr * i / 4.5;
            this._dynamicGroup.add(new Konva.Circle({
                x: cx, y: cy, radius: rr,
                fill: 'transparent',
                stroke: 'rgba(255,255,255,0.12)',
                strokeWidth: 0.8,
            }));
        }

        // ── 透镜内 PIR 芯片（深色方块，中心偏下）──
        const chipS = lr * 0.38;
        this._dynamicGroup.add(new Konva.Rect({
            x: cx - chipS/2, y: cy - chipS/2 + lr*0.06,
            width: chipS, height: chipS,
            fill: '#1a2028', stroke: '#304050', strokeWidth: 0.6,
            cornerRadius: 2,
        }));
        // 芯片反光点
        this._dynamicGroup.add(new Konva.Circle({
            x: cx - chipS*0.18, y: cy - chipS*0.18 + lr*0.06,
            radius: chipS*0.10,
            fill: 'rgba(255,255,255,0.22)',
        }));

        // ── 透镜顶部高光（半球感）──
        this._dynamicGroup.add(new Konva.Ellipse({
            x: cx - lr*0.15, y: cy - lr*0.38,
            radiusX: lr*0.42, radiusY: lr*0.18,
            fill: 'rgba(255,255,255,0.22)',
            rotation: -15,
        }));

        // ── 状态光晕叠层 ──
        if (ga > 0.02) {
            let glowC;
            if (st === 'TRIGGERED') glowC = `rgba(255,140,30,${ga*0.55})`;
            else if (st === 'HOLDING') glowC = `rgba(255,200,50,${ga*0.40})`;
            else glowC = `rgba(80,160,255,${ga*0.25})`;

            this._dynamicGroup.add(new Konva.Circle({
                x: cx, y: cy, radius: lr * 0.88,
                fill: glowC,
            }));

            // 外晕扩散到传感器环
            this._dynamicGroup.add(new Konva.Circle({
                x: cx, y: cy, radius: sr * 0.80,
                fill: 'transparent',
                stroke: st === 'TRIGGERED'
                    ? `rgba(255,140,30,${ga*0.35})`
                    : `rgba(255,200,50,${ga*0.25})`,
                strokeWidth: 6,
            }));
        }

        // ── 触发检测环（TRIGGERED：绿色脉冲环）──
        if (st === 'TRIGGERED') {
            const pulse = 0.5 + 0.5 * Math.sin(this._pulsePhase);
            this._dynamicGroup.add(new Konva.Circle({
                x: cx, y: cy,
                radius: lr + 6 + pulse * 4,
                fill: 'transparent',
                stroke: `rgba(80,220,80,${0.55 + pulse*0.35})`,
                strokeWidth: 2,
                shadowColor: '#50e050',
                shadowBlur:  8,
                shadowOpacity: 0.7,
            }));
        }

        // ── 保持倒计时弧形进度条（HOLDING）──
        if (st === 'HOLDING' && this.holdTime > 0) {
            const prog  = this._holdRemain / this.holdTime; // 1→0
            const arcDeg = 360 * prog;
            // 底环（灰）
            this._dynamicGroup.add(new Konva.Arc({
                x: cx, y: cy,
                innerRadius: sr - 5,
                outerRadius: sr - 1,
                angle: 360, rotation: -90,
                fill: 'rgba(0,0,0,0.12)',
            }));
            // 进度弧（橙→红）
            if (arcDeg > 1) {
                const orangeRatio = prog;
                const r = Math.round(255);
                const g = Math.round(120 * orangeRatio);
                this._dynamicGroup.add(new Konva.Arc({
                    x: cx, y: cy,
                    innerRadius: sr - 5,
                    outerRadius: sr - 1,
                    angle: arcDeg, rotation: -90,
                    fill: `rgba(${r},${g},20,0.85)`,
                    shadowColor: `rgb(${r},${g},20)`,
                    shadowBlur: 5, shadowOpacity: 0.6,
                }));
            }
            // 倒计时数字
            const secs = Math.ceil(this._holdRemain);
            const txt  = secs >= 60
                ? `${Math.floor(secs/60)}m${secs%60 < 10?'0':''}${secs%60}s`
                : `${secs}s`;
            this._dynamicGroup.add(new Konva.Text({
                x: cx - 20, y: cy + lr*0.55,
                width: 40, text: txt,
                fontSize: 9, fontStyle: 'bold',
                fill: prog > 0.35 ? '#e08000' : '#cc2020',
                align: 'center',
            }));
        }

        // ── 扫描纹波（触发瞬间）──
        if (this._rippleR > 0 && this._rippleAlpha > 0.02) {
            this._dynamicGroup.add(new Konva.Circle({
                x: cx, y: cy, radius: this._rippleR,
                fill: 'transparent',
                stroke: `rgba(255,160,40,${this._rippleAlpha})`,
                strokeWidth: 2,
            }));
            this._dynamicGroup.add(new Konva.Circle({
                x: cx, y: cy, radius: this._rippleR * 0.65,
                fill: 'transparent',
                stroke: `rgba(255,160,40,${this._rippleAlpha*0.5})`,
                strokeWidth: 1.2,
            }));
        }

        // ── IDLE 待机蓝色指示点 ──
        if (st === 'IDLE' || st === 'COOLDOWN') {
            const idlePulse = 0.4 + 0.6 * Math.abs(Math.sin(this._pulsePhase * 0.4));
            this._dynamicGroup.add(new Konva.Circle({
                x: cx, y: cy - lr*0.55,
                radius: 3,
                fill: `rgba(60,140,255,${idlePulse})`,
                shadowColor: '#3c8cff',
                shadowBlur: 5, shadowOpacity: 0.8,
            }));
        }

        // ── 触发 PIR 区域的点击交互 ──
        this._dynamicGroup.add(new Konva.Circle({
            x: cx, y: cy,
            radius: this._sensorRingR,
            fill: 'transparent',
        }));
        this._dynamicGroup.on('click tap', () => this.triggerMotion());
        this._dynamicGroup.on('mouseenter', () => {
            const stage = this._dynamicGroup.getStage?.();
            if (stage) stage.container().style.cursor = 'crosshair';
        });
        this._dynamicGroup.on('mouseleave', () => {
            const stage = this._dynamicGroup.getStage?.();
            if (stage) stage.container().style.cursor = 'default';
        });
        this._dynamicGroup.listening(true);
    }

    // ── 接线端子区 ────────────────────────────
    _drawTerminalArea() {
        const ta = this._terminalArea;
        this._staticGroup.add(new Konva.Rect({
            x: ta.x, y: ta.y, width: ta.w, height: ta.h,
            fill: '#d0ccc6', stroke: '#a0a09a', strokeWidth: 0.8,
            cornerRadius: 2,
        }));
        const termY = ta.y + ta.h / 2;
        [
            { x: this._termL.x,  label: 'L',  color: '#e53935' },
            { x: this._termN.x,  label: 'N',  color: '#1565c0' },
            { x: this._termLo.x, label: "L'", color: '#e53935' },
        ].forEach(({ x, label, color }) => {
            const r = this.width * 0.030;
            this._staticGroup.add(new Konva.Circle({ x, y: termY, radius: r, fill: '#383838', stroke: '#888', strokeWidth: 0.8 }));
            this._staticGroup.add(new Konva.Rect({
                x: x-r*0.55, y: termY+r*0.55, width: r*1.1, height: r*0.9,
                fill: color, cornerRadius: 1,
            }));
            this._staticGroup.add(new Konva.Text({
                x: x-6, y: ta.y-11, text: label,
                fontSize: 7.5, fill: '#505050', fontStyle: 'bold',
            }));
        });
    }

    // ── 品牌文字（右下角）────────────────────
    _drawBrandText() {
        const b = this._housing;
        this._staticGroup.add(new Konva.Text({
            x: b.x + b.w*0.58, y: b.y + b.h*0.86,
            text: '超波', fontSize: 8,
            fill: '#aaa9a6', fontStyle: 'italic',
        }));
    }

    // ── 标注 ─────────────────────────────────
    _drawLabel() {
        this._staticGroup.add(new Konva.Text({
            x: 0, y: -18, width: this.width,
            text: `${this.label}  ${this.ratedVoltage}V / ${this.ratedCurrent}A`,
            fontSize: 9, fontStyle: 'bold', fill: '#546e7a', align: 'center',
        }));
        // 延时参数标注（面板底部）
        this._delayText = new Konva.Text({
            x: 0, y: this._housing.y + this._housing.h - 18,
            width: this.width,
            text: `延时 ${this._formatTime(this.holdTime)}`,
            fontSize: 8, fill: '#909090', align: 'center',
        });
        this._staticGroup.add(this._delayText);
    }

    // ── 状态面板（右下角指示灯 + 文字）─────
    _drawStatusPanel() {
        const b  = this._housing;
        const ix = b.x + b.w - 14;
        const iy = b.y + b.h*0.14;

        this._statusDot = new Konva.Circle({
            x: ix, y: iy, radius: 4,
            fill: '#ef5350', stroke: '#c62828', strokeWidth: 0.8,
            shadowColor: '#ef5350', shadowBlur: 2, shadowOpacity: 0.7,
        });
        this._statusText = new Konva.Text({
            x: ix - 24, y: iy - 5,
            text: 'OFF', fontSize: 7.5, fontStyle: 'bold',
            fill: '#ef5350',
        });
        this._staticGroup.add(this._statusDot, this._statusText);
    }

    _updateStatusPanel() {
        const on = this._closed;
        const st = this._state;
        let dotColor, dotStroke, label;
        if (st === 'TRIGGERED') { dotColor = '#66bb6a'; dotStroke = '#2e7d32'; label = '触发'; }
        else if (st === 'HOLDING')  { dotColor = '#ffb300'; dotStroke = '#e65100'; label = '保持'; }
        else if (st === 'COOLDOWN') { dotColor = '#42a5f5'; dotStroke = '#1565c0'; label = '冷却'; }
        else                        { dotColor = '#ef5350'; dotStroke = '#c62828'; label = 'OFF'; }

        if (this._statusDot) {
            this._statusDot.fill(dotColor);
            this._statusDot.stroke(dotStroke);
            this._statusDot.shadowColor(dotColor);
            this._statusDot.shadowBlur(on ? 7 : 2);
        }
        if (this._statusText) {
            this._statusText.text(label);
            this._statusText.fill(dotColor);
        }
    }

    // ── 主循环 ────────────────────────────────
    // 集中化 tick（由 consys._tickAll 在 20fps 调用）
    tick(dt) {
        this._tick(dt);
    
        this._refreshCache();
    }
    _tick(dt) {
        this._pulsePhase += dt * 3.5;

        // ── 状态机更新 ──
        if (this._state === 'TRIGGERED') {
            // 保持触发状态（需外部持续调用 triggerMotion 或等自然超时）
            // 触发后若无新触发信号，自动转入 HOLDING
            this._triggerTimer = (this._triggerTimer || 0) + dt;
            // 感应持续时间窗口（模拟 PIR 保持触发约 2s）
            if (this._triggerTimer > 2.0) {
                this._enterHolding();
            }
            // 脉冲光晕
            this._glowAlpha = 0.6 + 0.25 * Math.sin(this._pulsePhase);

            // 纹波消退
            if (this._rippleR > 0) {
                this._rippleR     += dt * this._sensorRingR * 1.8;
                this._rippleAlpha -= dt * 1.2;
                if (this._rippleAlpha < 0) { this._rippleAlpha = 0; this._rippleR = 0; }
            }

        } else if (this._state === 'HOLDING') {
            this._holdRemain -= dt;
            // 光晕随倒计时减弱
            this._glowAlpha = Math.max(0.15, 0.55 * (this._holdRemain / this.holdTime));

            if (this._holdRemain <= 0) {
                this._enterIdle();
            }

        } else if (this._state === 'COOLDOWN') {
            this._coolRemain -= dt;
            this._glowAlpha  = Math.max(0, this._glowAlpha - dt * 1.5);
            if (this._coolRemain <= 0) {
                this._state    = 'IDLE';
                this._glowAlpha = 0;
            }

        } else { // IDLE
            this._glowAlpha = Math.max(0, this._glowAlpha - dt * 2.0);
        }

        this._rebuildDynamic();
        this._updateStatusPanel();
        this._refreshCache();
    }

    // ── 进入保持状态 ─────────────────────────
    _enterHolding() {
        this._state       = 'HOLDING';
        this._holdRemain  = this.holdTime;
        this._glowAlpha   = 0.55;
    }

    // ── 进入空闲（分闸）──────────────────────
    _enterIdle() {
        this._state       = 'COOLDOWN';
        this._coolRemain  = 0.5;
        this._closed      = false;
        this.opsCount++;
        // 触发分闸事件
        this._emitEvent?.('open');
        this._refreshCache();
    }

    // ── 格式化延时时间显示 ────────────────────
    _formatTime(s) {
        if (s < 60) return `${s}s`;
        if (s < 3600) return `${Math.floor(s/60)}m${s%60 > 0 ? (s%60)+'s' : ''}`;
        return `${Math.floor(s/3600)}h${Math.floor((s%3600)/60) > 0 ? Math.floor((s%3600)/60)+'m' : ''}`;
    }

    // ═══════════════════════════════════════════
    /**
     * 触发人体感应
     * 在仿真中：点击面板触发；实际系统中由 PIR 中断/MQTT 信号调用
     */
    triggerMotion() {
        if (this._state === 'COOLDOWN') return; // 冷却中忽略

        if (this._state === 'IDLE') {
            // 新触发：合闸
            this._closed      = true;
            this._triggerTimer = 0;
            this._state        = 'TRIGGERED';
            this._glowAlpha    = 0.85;
            this._rippleR      = this._lensR;
            this._rippleAlpha  = 0.90;
            this.opsCount++;
            this._emitEvent?.('close');
        } else if (this._state === 'HOLDING') {
            // 重新感应：重置倒计时，回到 TRIGGERED
            this._state        = 'TRIGGERED';
            this._triggerTimer = 0;
            this._glowAlpha    = 0.85;
            this._rippleR      = this._lensR;
            this._rippleAlpha  = 0.80;
        } else if (this._state === 'TRIGGERED') {
            // 已触发：重置触发计时
            this._triggerTimer = 0;
        }
        this._refreshCache();
    }

    /** 强制立即断开（外部命令） */
    forceOpen() {
        this._enterIdle();
        this._state = 'IDLE';
    }

    /** 强制立即接通 */
    forceClose() {
        this.triggerMotion();
    }

    /** 查询输出状态 */
    isClosed()    { return this._closed; }
    getState()    { return this._state; }
    getOpsCount() { return this.opsCount; }

    update(state) {
        if (typeof state === 'boolean') {
            state ? this.forceClose() : this.forceOpen();
        }
        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label: '位号/名称',            key: 'label',        type: 'text'   },
            { label: '额定电压 (V)',          key: 'ratedVoltage', type: 'number' },
            { label: '额定电流 (A)',          key: 'ratedCurrent', type: 'number' },
            { label: '断开延时 (s)',          key: 'holdTime',     type: 'number' },
            { label: '灵敏度 HIGH/MEDIUM/LOW',key: 'sensitivity',  type: 'text'   },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label)        this.label        = cfg.label;
        if (cfg.ratedVoltage) this.ratedVoltage = parseFloat(cfg.ratedVoltage) || this.ratedVoltage;
        if (cfg.ratedCurrent) this.ratedCurrent = parseFloat(cfg.ratedCurrent) || this.ratedCurrent;
        if (cfg.sensitivity)  this.sensitivity  = cfg.sensitivity.toUpperCase();

        if (cfg.holdTime !== undefined) {
            const ht = parseFloat(cfg.holdTime);
            if (ht > 0) {
                this.holdTime = ht;
                if (this._delayText) {
                    this._delayText.text(`延时 ${this._formatTime(this.holdTime)}`);
                }
            }
        }
        this.config = { ...this.config, ...cfg };
        this._refreshCache();
    }

    destroy() {
        super.destroy?.();
    }
}