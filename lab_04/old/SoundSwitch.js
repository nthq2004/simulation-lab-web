import { BaseComponent } from './BaseComponent.js';

/**
 * 声控开关（Sound-Activated Switch）仿真组件
 *
 * ── 结构说明 ──────────────────────────────────────────────────
 *
 *  声控开关通过麦克风检测环境声音，自动控制电路通断，由以下部分组成：
 *
 *  1. 外壳面板（Housing）：米白色方形塑料面板，带斜角倒边
 *  2. 金属圆形旋钮盖（Knob Cover）：中央不锈钢拉丝镀铬圆形金属罩，
 *     内置麦克风拾音孔（三条竖向声孔）
 *  3. 麦克风声孔（Mic Slots）：金属盖中央三条竖向细长槽，用于拾音
 *  4. LED 状态指示灯（LED Indicator）：金属盖正下方的小矩形橙色/绿色指示窗
 *  5. 品牌文字（右下角）
 *  6. 底部接线端子：L（相线进）、N（零线）、L'（相线出）
 *
 * ── 工作原理 ──────────────────────────────────────────────────
 *
 *  检测到声音（triggerSound()）→ 立即合闸
 *  合闸后从最后一次声音触发起，倒计时 holdTime 秒后自动分闸
 *  在倒计时期间再次检测到声音 → 重置倒计时
 *
 * ── 状态机 ────────────────────────────────────────────────────
 *
 *  IDLE     : 无声音，输出断开，LED 熄灭
 *  ACTIVE   : 检测到声音，输出接通，LED 亮绿，金属盖橙光晕
 *  HOLDING  : 声音消失，保持接通倒计时，LED 橙色，弧形进度条
 *  COOLDOWN : 断开后短暂冷却（300ms）防重触发
 *
 * ── 动画效果 ──────────────────────────────────────────────────
 *
 *  触发时：金属盖发光脉冲 + 声波涟漪向外扩散（模拟声波）
 *  ACTIVE：麦克风声孔周期性亮条（模拟声音波动）
 *  HOLDING：外圈弧形进度条（绿→橙→红）倒计时
 *  分闸：光晕渐灭（200ms 缓动）
 *
 * ── 仿真交互 ──────────────────────────────────────────────────
 *
 *  点击金属旋钮盖 → 模拟声音触发（triggerSound）
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  terminal_l  — L  相线进线
 *  terminal_n  — N  零线
 *  terminal_lo — L' 相线出线（受控输出）
 *
 * ── 可配置参数 ────────────────────────────────────────────────
 *  holdTime     : 断开延时（秒），默认 60s，范围 1～3600s
 *  sensitivity  : 灵敏度 HIGH / MEDIUM / LOW（影响触发阈值仿真显示）
 *  ratedVoltage : 额定电压（V）
 *  ratedCurrent : 额定电流（A）
 *  label        : 位号
 */
export class SoundSwitch extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(150, config.width  || 190);
        this.height = Math.max(150, config.height || 190);

        this.type    = 'sound_switch';
        this.special = 'none';
        this.cache   = 'fixed';

        this._initGroups();
        // ── 额定参数 ──
        this.ratedVoltage = config.ratedVoltage || 220;
        this.ratedCurrent = config.ratedCurrent || 10;
        this.label        = config.label        || 'KS';
        this.sensitivity  = (config.sensitivity || 'HIGH').toUpperCase();

        // ── 延时参数 ──
        this.holdTime = Math.max(1, parseFloat(config.holdTime) || 60);

        // ── 状态机 ──
        this._state      = 'IDLE';   // IDLE | ACTIVE | HOLDING | COOLDOWN
        this._closed     = false;
        this._holdRemain = 0;
        this._coolRemain = 0;
        this.opsCount    = config.initOps || 0;

        // ── 动画状态 ──
        this._glowAlpha    = 0;
        this._pulsePhase   = 0;
        this._ripples      = [];     // 声波涟漪列表 [{r, alpha}]
        this._soundBars    = [0,0,0]; // 三条声孔亮度

        // ── 几何尺寸 ──
        const W = this.width, H = this.height;

        this._housing = {
            x: W*0.04, y: H*0.04,
            w: W*0.92, h: H*0.80,
            rx: 8,
        };

        const hx = this._housing.x, hy = this._housing.y;
        const hw = this._housing.w, hh = this._housing.h;

        // 金属旋钮盖（中央圆形）
        this._knobR  = Math.min(hw, hh) * 0.30;
        this._knobCX = hx + hw / 2;
        this._knobCY = hy + hh / 2 - hh * 0.04;

        // LED 指示灯（金属盖正下方）
        this._ledX = hx + hw / 2;
        this._ledY = this._knobCY + this._knobR + 14;

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
        this._drawKnobBase();     // 静态金属底层
        this._drawTerminalArea();
        this._drawBrandText();
        this._drawLabel();
        this._rebuildDynamic();

        this._drawLED();
        this._drawStatusPanel();
        
    }

    // ── 外壳 ─────────────────────────────────
    _drawHousing() {
        const b = this._housing;
        // 阴影
        this._staticGroup.add(new Konva.Rect({
            x: b.x+3, y: b.y+3, width: b.w, height: b.h,
            fill: 'rgba(0,0,0,0.15)', cornerRadius: b.rx+1,
        }));
        // 主体（米白色渐变）
        this._staticGroup.add(new Konva.Rect({
            x: b.x, y: b.y, width: b.w, height: b.h,
            fillLinearGradientStartPoint: { x:0, y:0 },
            fillLinearGradientEndPoint:   { x:b.w, y:b.h },
            fillLinearGradientColorStops: [0,'#f4f2ee',0.4,'#eceae4',0.75,'#e0ddd8',1,'#ccc9c2'],
            stroke: '#b2aea8', strokeWidth: 1.2,
            cornerRadius: b.rx,
        }));
        // 顶面高光
        this._staticGroup.add(new Konva.Rect({
            x: b.x+2, y: b.y+2, width: b.w*0.55, height: b.h*0.14,
            fill: 'rgba(255,255,255,0.32)', cornerRadius: [b.rx,0,0,0],
        }));
        // 内嵌凹槽
        this._staticGroup.add(new Konva.Rect({
            x: b.x+b.w*0.05, y: b.y+b.h*0.05,
            width: b.w*0.90, height: b.h*0.90,
            fill: 'rgba(0,0,0,0.03)',
            stroke: 'rgba(0,0,0,0.07)', strokeWidth: 1,
            cornerRadius: b.rx-2,
        }));
    }

    // ── 四角螺钉 ─────────────────────────────
    _drawScrews() {
        const b = this._housing;
        const r = this.width * 0.022;
        const ox = b.w*0.12, oy = b.h*0.10;
        [
            { x: b.x+ox,      y: b.y+oy },
            { x: b.x+b.w-ox,  y: b.y+oy },
            { x: b.x+ox,      y: b.y+b.h-oy },
            { x: b.x+b.w-ox,  y: b.y+b.h-oy },
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

    // ── 金属旋钮盖（静态底层） ─────────────────
    _drawKnobBase() {
        const cx = this._knobCX, cy = this._knobCY, r = this._knobR;

        // 外环底座（凸台）
        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy+2, radius: r+4,
            fill: 'rgba(0,0,0,0.18)',
        }));
        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: r+4,
            fillLinearGradientStartPoint: { x:-r, y:-r },
            fillLinearGradientEndPoint:   { x:r, y:r },
            fillLinearGradientColorStops: [0,'#c8c8c8',0.3,'#e8e8e8',0.6,'#d0d0d0',1,'#a8a8a8'],
            stroke: '#909090', strokeWidth: 1.5,
        }));

        // 金属盖主体（拉丝不锈钢效果）
        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: r,
            fillLinearGradientStartPoint: { x:-r, y:-r },
            fillLinearGradientEndPoint:   { x:r, y:r },
            fillLinearGradientColorStops: [
                0,   '#b8babe',
                0.15,'#d8dadc',
                0.30,'#e8eaec',
                0.45,'#f0f2f4',
                0.55,'#e0e2e4',
                0.70,'#c8cacc',
                0.85,'#b0b2b4',
                1,   '#989a9c',
            ],
            stroke: '#808284', strokeWidth: 1,
        }));

        // 拉丝纹理（细横线组）
        for (let i = -6; i <= 6; i++) {
            const yy = cy + i * (r * 0.14);
            const hw = Math.sqrt(Math.max(0, r*r - (yy-cy)*(yy-cy))) * 0.92;
            if (hw < 2) continue;
            this._staticGroup.add(new Konva.Line({
                points: [cx-hw, yy, cx+hw, yy],
                stroke: 'rgba(255,255,255,0.07)',
                strokeWidth: 0.7,
            }));
        }

        // 顶部弧面高光
        this._staticGroup.add(new Konva.Ellipse({
            x: cx - r*0.12, y: cy - r*0.42,
            radiusX: r*0.55, radiusY: r*0.22,
            fill: 'rgba(255,255,255,0.28)',
            rotation: -10,
        }));

        // 边缘暗边（立体感）
        this._staticGroup.add(new Konva.Arc({
            x: cx, y: cy,
            innerRadius: r*0.90, outerRadius: r,
            angle: 200, rotation: 60,
            fill: 'rgba(0,0,0,0.12)',
        }));
    }

    // ── 动态层：声孔 + 光效 + 涟漪 + 进度弧 ──
    _rebuildDynamic() {
        this._dynamicGroup.destroyChildren();

        const cx = this._knobCX, cy = this._knobCY, r = this._knobR;
        const st = this._state;
        const ga = this._glowAlpha;

        // ── 状态光晕（金属盖背光） ──
        if (ga > 0.02) {
            let gc;
            if (st === 'ACTIVE')   gc = `rgba(255,140,30,${ga*0.50})`;
            else if (st === 'HOLDING') gc = `rgba(255,190,40,${ga*0.40})`;
            else                   gc = `rgba(80,180,255,${ga*0.20})`;

            this._dynamicGroup.add(new Konva.Circle({
                x: cx, y: cy, radius: r*0.85,
                fill: gc,
            }));
            // 外晕
            this._dynamicGroup.add(new Konva.Circle({
                x: cx, y: cy, radius: r*1.15,
                fill: 'transparent',
                stroke: gc,
                strokeWidth: 8,
            }));
        }

        // ── 三条麦克风声孔（竖向细槽）──
        const slotH   = r * 0.72;
        const slotW   = r * 0.10;
        const slotGap = r * 0.20;
        const slotY   = cy - slotH / 2 + r*0.06;
        const slots   = [-slotGap, 0, slotGap]; // 三列 X 偏移

        slots.forEach((dx, i) => {
            const sx = cx + dx - slotW/2;
            // 声孔槽底（深色凹陷）
            this._dynamicGroup.add(new Konva.Rect({
                x: sx, y: slotY, width: slotW, height: slotH,
                fill: '#1e2428', stroke: '#303438', strokeWidth: 0.5,
                cornerRadius: slotW/2,
            }));
            // 声孔亮条（声音活跃时随振幅亮起）
            const barH = slotH * this._soundBars[i];
            if (barH > 2) {
                const barColor = st === 'ACTIVE'
                    ? `rgba(255,180,60,${0.5 + this._soundBars[i]*0.45})`
                    : `rgba(120,200,255,${this._soundBars[i]*0.40})`;
                this._dynamicGroup.add(new Konva.Rect({
                    x: sx+1, y: slotY + slotH - barH,
                    width: slotW-2, height: barH,
                    fill: barColor,
                    cornerRadius: (slotW-2)/2,
                    shadowColor: barColor,
                    shadowBlur:  3, shadowOpacity: 0.8,
                }));
            }
        });

        // ── 声波涟漪 ──
        this._ripples.forEach(rip => {
            if (rip.alpha < 0.02) return;
            this._dynamicGroup.add(new Konva.Circle({
                x: cx, y: cy, radius: rip.r,
                fill: 'transparent',
                stroke: st === 'ACTIVE' || st === 'HOLDING'
                    ? `rgba(255,160,40,${rip.alpha})`
                    : `rgba(80,160,255,${rip.alpha})`,
                strokeWidth: 1.5,
            }));
        });

        // ── HOLDING 倒计时弧形进度条 ──
        if (st === 'HOLDING' && this.holdTime > 0) {
            const prog   = this._holdRemain / this.holdTime; // 1→0
            const arcDeg = 360 * prog;
            // 底环
            this._dynamicGroup.add(new Konva.Arc({
                x: cx, y: cy,
                innerRadius: r+2, outerRadius: r+6,
                angle: 360, rotation: -90,
                fill: 'rgba(0,0,0,0.15)',
            }));
            // 进度弧（绿→橙→红）
            if (arcDeg > 1) {
                const rr = Math.round(255);
                const gg = Math.round(180 * prog);
                this._dynamicGroup.add(new Konva.Arc({
                    x: cx, y: cy,
                    innerRadius: r+2, outerRadius: r+6,
                    angle: arcDeg, rotation: -90,
                    fill: `rgba(${rr},${gg},20,0.88)`,
                    shadowColor: `rgb(${rr},${gg},20)`,
                    shadowBlur: 5, shadowOpacity: 0.6,
                }));
            }
            // 倒计时数字（金属盖正下方）
            const secs = Math.ceil(this._holdRemain);
            const txt  = secs >= 60
                ? `${Math.floor(secs/60)}m${secs%60 < 10?'0':''}${secs%60}s`
                : `${secs}s`;
            this._dynamicGroup.add(new Konva.Text({
                x: cx - 22, y: cy + r + 8,
                width: 44, text: txt,
                fontSize: 9, fontStyle: 'bold',
                fill: prog > 0.4 ? '#d08000' : '#cc2020',
                align: 'center',
            }));
        }

        // ── ACTIVE 脉冲环 ──
        if (st === 'ACTIVE') {
            const pulse = 0.5 + 0.5 * Math.sin(this._pulsePhase * 1.5);
            this._dynamicGroup.add(new Konva.Circle({
                x: cx, y: cy, radius: r + 7 + pulse * 4,
                fill: 'transparent',
                stroke: `rgba(255,200,60,${0.35 + pulse*0.45})`,
                strokeWidth: 2,
                shadowColor: '#ffcc30',
                shadowBlur:  7, shadowOpacity: 0.7,
            }));
        }

        // ── IDLE 待机呼吸点 ──
        if (st === 'IDLE') {
            const bp = 0.3 + 0.5 * Math.abs(Math.sin(this._pulsePhase * 0.35));
            this._dynamicGroup.add(new Konva.Circle({
                x: cx, y: cy + r*0.55,
                radius: 2.5,
                fill: `rgba(80,160,255,${bp})`,
                shadowColor: '#50a0ff',
                shadowBlur: 4, shadowOpacity: 0.7,
            }));
        }

        // ── 交互层（透明可点击圆） ──
        const hitCircle = new Konva.Circle({
            x: cx, y: cy, radius: r + 6,
            fill: 'transparent',
        });
        hitCircle.on('click tap', () => this.triggerSound());
        hitCircle.on('mouseenter', () => {
            const stage = hitCircle.getStage?.();
            if (stage) stage.container().style.cursor = 'pointer';
        });
        hitCircle.on('mouseleave', () => {
            const stage = hitCircle.getStage?.();
            if (stage) stage.container().style.cursor = 'default';
        });
        this._dynamicGroup.add(hitCircle);
        this._dynamicGroup.listening(true);
    }

    // ── LED 指示灯（固定层，状态由 _updateLED 更新）──
    _drawLED() {
        const lw = this.width * 0.072, lh = this.width * 0.030;
        const lx = this._ledX - lw/2, ly = this._ledY - lh/2;
        // 指示灯底框
        this._staticGroup.add(new Konva.Rect({
            x: lx-1, y: ly-1, width: lw+2, height: lh+2,
            fill: '#909090', cornerRadius: 3,
        }));
        // 指示灯主体
        this._ledRect = new Konva.Rect({
            x: lx, y: ly, width: lw, height: lh,
            fill: '#303030', cornerRadius: 2,
        });
        this._staticGroup.add(this._ledRect);
    }

    _updateLED() {
        if (!this._ledRect) return;
        const st = this._state;
        let color;
        if (st === 'ACTIVE')       color = '#50e050';   // 绿色：检测中
        else if (st === 'HOLDING') color = '#ffaa20';   // 橙色：保持中
        else if (st === 'COOLDOWN')color = '#4090ff';   // 蓝色：冷却
        else                       color = '#303030';   // 熄灭
        this._ledRect.fill(color);
        if (st !== 'IDLE') {
            this._ledRect.shadowColor(color);
            this._ledRect.shadowBlur(st === 'ACTIVE' ? 8 : 5);
            this._ledRect.shadowOpacity(0.85);
        } else {
            this._ledRect.shadowBlur(0);
        }
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
            this._staticGroup.add(new Konva.Rect({ x: x-r*0.55, y: termY+r*0.55, width: r*1.1, height: r*0.9, fill: color, cornerRadius: 1 }));
            this._staticGroup.add(new Konva.Text({ x: x-6, y: ta.y-11, text: label, fontSize: 7.5, fill: '#505050', fontStyle: 'bold' }));
        });
    }

    // ── 品牌文字 ─────────────────────────────
    _drawBrandText() {
        const b = this._housing;
        this._staticGroup.add(new Konva.Text({
            x: b.x+b.w*0.60, y: b.y+b.h*0.87,
            text: 'SNE', fontSize: 8,
            fill: '#aaa9a6', fontStyle: 'italic',
        }));
    }

    // ── 标注（位号、额定参数、延时）─────────
    _drawLabel() {
        this._staticGroup.add(new Konva.Text({
            x: 0, y: -18, width: this.width,
            text: `${this.label}  ${this.ratedVoltage}V / ${this.ratedCurrent}A`,
            fontSize: 9, fontStyle: 'bold', fill: '#546e7a', align: 'center',
        }));
        this._delayLabel = new Konva.Text({
            x: 0,
            y: this._housing.y + this._housing.h - 18,
            width: this.width,
            text: `延时 ${this._formatTime(this.holdTime)}`,
            fontSize: 8, fill: '#909090', align: 'center',
        });
        this._staticGroup.add(this._delayLabel);
    }

    // ── 状态面板（右下角小指示文字）─────────
    _drawStatusPanel() {
        const b = this._housing;
        this._statusDot = new Konva.Circle({
            x: b.x+b.w-12, y: b.y+b.h*0.12, radius: 4,
            fill: '#303030', stroke: '#606060', strokeWidth: 0.8,
        });
        this._statusText = new Konva.Text({
            x: b.x+b.w-38, y: b.y+b.h*0.12-5,
            text: 'IDLE', fontSize: 7.5, fontStyle: 'bold', fill: '#707070',
        });
        this._staticGroup.add(this._statusDot, this._statusText);
    }

    _updateStatusPanel() {
        const st = this._state;
        const map = {
            IDLE:     { color: '#606060', label: 'IDLE' },
            ACTIVE:   { color: '#50e050', label: '声控' },
            HOLDING:  { color: '#ffaa20', label: '保持' },
            COOLDOWN: { color: '#4090ff', label: '冷却' },
        };
        const { color, label } = map[st] || map.IDLE;
        if (this._statusDot)  { this._statusDot.fill(color); this._statusDot.shadowColor(color); this._statusDot.shadowBlur(st !== 'IDLE' ? 6 : 0); }
        if (this._statusText) { this._statusText.text(label); this._statusText.fill(color); }
        this._updateLED();
    }

    // ── 主循环 ────────────────────────────────
    // 集中化 tick（由 consys._tickAll 在 20fps 调用）
    tick(dt) {
        this._tick(dt);
    
        this._refreshCache();
    }
    _tick(dt) {
        this._pulsePhase += dt * 4.0;

        // ── 状态机 ──
        if (this._state === 'ACTIVE') {
            this._activeTimer = (this._activeTimer || 0) + dt;
            // 模拟 PIR/声音感应持续窗口约 1.5s
            if (this._activeTimer > 1.5) this._enterHolding();

            // 光晕脉冲
            this._glowAlpha = 0.65 + 0.28 * Math.sin(this._pulsePhase);

            // 声孔亮条随机抖动（模拟声波波动）
            this._soundBars = this._soundBars.map((v, i) => {
                const target = 0.3 + 0.7 * Math.abs(Math.sin(this._pulsePhase * (1.0 + i*0.3)));
                return v + (target - v) * 0.3;
            });

        } else if (this._state === 'HOLDING') {
            this._holdRemain -= dt;
            this._glowAlpha   = Math.max(0.12, 0.50 * (this._holdRemain / this.holdTime));

            // 声孔缓慢降低
            this._soundBars = this._soundBars.map(v => Math.max(0, v - dt * 0.6));

            if (this._holdRemain <= 0) this._enterIdle();

        } else if (this._state === 'COOLDOWN') {
            this._coolRemain -= dt;
            this._glowAlpha   = Math.max(0, this._glowAlpha - dt * 2.5);
            this._soundBars   = [0,0,0];
            if (this._coolRemain <= 0) { this._state = 'IDLE'; this._glowAlpha = 0; }

        } else { // IDLE
            this._glowAlpha = Math.max(0, this._glowAlpha - dt * 2.0);
            this._soundBars = [0,0,0];
        }

        // ── 涟漪更新 ──
        const maxR = this._knobR * 2.2;
        this._ripples = this._ripples
            .map(rip => ({ r: rip.r + dt * maxR * 1.4, alpha: rip.alpha - dt * 1.1 }))
            .filter(rip => rip.alpha > 0.02);

        this._rebuildDynamic();
        this._updateStatusPanel();
        this._refreshCache();
    }

    _enterHolding() {
        this._state      = 'HOLDING';
        this._holdRemain = this.holdTime;
        this._glowAlpha  = 0.50;
    }

    _enterIdle() {
        this._state      = 'COOLDOWN';
        this._coolRemain = 0.30;
        this._closed     = false;
        this.opsCount++;
        this._emitEvent?.('open');
        this._refreshCache();
    }

    _formatTime(s) {
        s = Math.round(s);
        if (s < 60)   return `${s}s`;
        if (s < 3600) return `${Math.floor(s/60)}m${s%60 > 0 ? (s%60)+'s' : ''}`;
        return `${Math.floor(s/3600)}h${Math.floor((s%3600)/60) > 0 ? Math.floor((s%3600)/60)+'m' : ''}`;
    }

    // ═══════════════════════════════════════════
    /**
     * 声音触发
     * 仿真中：点击金属旋钮盖触发；
     * 实际系统中：由麦克风 ADC 阈值检测信号、MQTT、IO 中断调用
     */
    triggerSound() {
        if (this._state === 'COOLDOWN') return;

        if (this._state === 'IDLE') {
            this._closed     = true;
            this._activeTimer = 0;
            this._state      = 'ACTIVE';
            this._glowAlpha  = 0.90;
            this.opsCount++;
            this._emitEvent?.('close');
            // 发射两圈声波涟漪
            this._ripples.push({ r: this._knobR * 0.5, alpha: 0.85 });
            this._ripples.push({ r: this._knobR * 0.2, alpha: 0.60 });

        } else if (this._state === 'HOLDING') {
            // 在保持期间再次触发 → 重置倒计时，回到 ACTIVE
            this._state       = 'ACTIVE';
            this._activeTimer  = 0;
            this._glowAlpha   = 0.90;
            this._ripples.push({ r: this._knobR * 0.4, alpha: 0.75 });

        } else if (this._state === 'ACTIVE') {
            // 已激活中 → 重置激活计时（延长触发窗口）
            this._activeTimer = 0;
            this._ripples.push({ r: this._knobR * 0.3, alpha: 0.55 });
        }

        this._refreshCache();
    }

    /** 强制立即断开 */
    forceOpen() {
        this._enterIdle();
        this._state = 'IDLE';
        this._soundBars = [0,0,0];
    }

    /** 强制立即接通（等同声音触发） */
    forceClose() { this.triggerSound(); }

    /** 查询输出状态 */
    isClosed()    { return this._closed; }
    getState()    { return this._state; }
    getOpsCount() { return this.opsCount; }

    update(state) {
        if (typeof state === 'boolean') state ? this.forceClose() : this.forceOpen();
        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label: '位号/名称',              key: 'label',        type: 'text'   },
            { label: '额定电压 (V)',            key: 'ratedVoltage', type: 'number' },
            { label: '额定电流 (A)',            key: 'ratedCurrent', type: 'number' },
            { label: '断开延时 (s)',            key: 'holdTime',     type: 'number' },
            { label: '灵敏度 HIGH/MEDIUM/LOW',  key: 'sensitivity',  type: 'text'   },
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
                this._delayLabel?.text(`延时 ${this._formatTime(this.holdTime)}`);
            }
        }
        this.config = { ...this.config, ...cfg };
        this._refreshCache();
    }

    destroy() {
        super.destroy?.();
    }
}