import { BaseComponent } from './BaseComponent.js';

/**
 * 常闭按钮仿真组件
 * （Normally Closed Push Button — NC Type）
 *
 * ── 工作原理 ──────────────────────────────────────────────────
 *  常闭（NC）按钮：
 *    未按下时：触点闭合（导通），电路连通
 *    按下时：  触点断开（断路），电路断开
 *    松开后：  触点自动复位（弹回闭合），电路恢复
 *
 *  对比常开（NO）按钮：
 *    NO：平时断开，按下导通
 *    NC：平时导通，按下断开  ← 本组件
 *
 *  典型用途：
 *    - 急停按钮（E-Stop，蘑菇头型常闭）
 *    - 电机停止按钮（STOP，与常开启动配合）
 *    - 安全联锁回路（回路断开即停机）
 *    - 限位开关（常闭型）
 *
 * ── 接触机构 ──────────────────────────────────────────────────
 *  弹簧复位机构：
 *    ┌─────┐      未按下        ┌─────┐    按下时
 *    │     │  ── [COM]●━━━●[NC]   │  ↓  │  ── [COM]●  ●[NC]
 *    └─────┘   触点闭合（通路）   └─────┘   触点断开（断路）
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  wire_r — 公共端（COM）
 *  wire_l  — 常闭端（NC）
 */
export class NormallyClosedPushButton extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(90,  config.width  || 90);
        this.height = Math.max(160, config.height || 160);

        this.type    = 'switch';
        this.special = 'buttonstop';
        this.cache   = 'fixed';

        // ── 参数 ──
        this.buttonColor = config.buttonColor || '#ef5350';   // 按钮颜色（停止按钮通常为红色）
        this.ledColor    = config.ledColor    || '#66bb6a';   // 指示灯颜色（闭合=绿，断开=暗）
        this.label       = config.label       || 'STOP';      // 面板标签

        // ── 状态 ──
        this.pressed    = false;   // 当前是否被按下
        this.isOn   = true;    // NC 触点状态（true=闭合=电路通）
        this._pressAnim = 0;       // 按钮按下动画深度（0~1）
        this._phase     = 0;       // 动画相位（指示灯呼吸）

        // ── 几何 ──
        const cx = this.width / 2;

        // 外壳
        this._housingX = 8;
        this._housingY = 20;
        this._housingW = this.width - 16;
        this._housingH = Math.round(this.height * 0.75);

        // 按钮帽
        this._capCX    = cx;
        this._capCY    = this._housingY + Math.round(this._housingH * 0.28);
        this._capR     = Math.round(this.width * 0.26);

        // 触点示意区（外壳下半部）
        this._contactY = this._housingY + Math.round(this._housingH * 0.56);
        this._contactH = Math.round(this._housingH * 0.38);

        // 接线端子（外壳底部）
        this._termY    = this._housingY + this._housingH;
        this._termComX = Math.round(this.width * 0.32);
        this._termNcX  = Math.round(this.width * 0.68);


        this.config = { id: this.id, buttonColor: this.buttonColor, label: this.label };

        this._init();

        // 端口
        this.addPort(this._termComX-4, this.height - 8, 'l', 'wire', 'p');
        this.addPort(this._termNcX+4,  this.height - 8, 'r',  'wire');
    }

    // ═══════════════════════════════════════════
    _init() {
        this._drawLabel();
        this._drawHousing();
        this._drawContactMechanism();
        this._drawButtonCap();
        this._drawIndicatorLed();
        this._drawTerminals();
        this._drawButtonText();
        this._setupInteraction();
        
    }

    _drawLabel() {
        this.group.add(new Konva.Text({
            x: 0, y: -10, width: this.width,
            text: '常闭按钮 (NC)',
            fontSize: 12, fontStyle: 'bold', fill: '#1a2634', align: 'center',
        }));
    }

    // ── 按钮外壳 ─────────────────────────────
    _drawHousing() {
        const { _housingX: hx, _housingY: hy, _housingW: hw, _housingH: hh } = this;

        // 安装板（金属灰，模拟面板安装孔）
        const mountPlate = new Konva.Rect({
            x: hx - 4, y: hy - 6, width: hw + 8, height: hh + 12,
            fill: '#b0bec5', stroke: '#78909c', strokeWidth: 1.2, cornerRadius: 3,
        });
        // 安装螺孔
        [[hx, hy], [hx+hw, hy], [hx, hy+hh], [hx+hw, hy+hh]].forEach(([bx2, by2]) => {
            this.group.add(new Konva.Circle({ x: bx2, y: by2, radius: 3, fill: '#546e7a' }));
        });

        // 主壳体
        const body = new Konva.Rect({
            x: hx, y: hy, width: hw, height: hh,
            fill: '#37474f', stroke: '#263238', strokeWidth: 1.5, cornerRadius: 4,
        });
        // 壳体高光（顶面）
        this.group.add(new Konva.Rect({
            x: hx + 2, y: hy + 2, width: hw - 4, height: 5,
            fill: 'rgba(255,255,255,0.12)', cornerRadius: [2,2,0,0],
        }));

        // 型号铭牌（壳体下半）
        const npY = this._contactY + this._contactH - 14;
        this.group.add(new Konva.Rect({
            x: hx + 4, y: npY, width: hw - 8, height: 12,
            fill: '#1a2634', cornerRadius: 1,
        }));
        this.group.add(mountPlate, body);
    }

    // ── 触点机构示意（剖面）─────────────────
    _drawContactMechanism() {
        const { _housingX: hx, _housingW: hw } = this;
        const cy2    = this._contactY;
        const ch     = this._contactH - 16;
        const cx2    = this.width / 2;
        const colW   = 18;

        // 触点区背景
        this.group.add(new Konva.Rect({
            x: hx + 4, y: cy2, width: hw - 8, height: ch,
            fill: '#0d1520', stroke: '#1a3040', strokeWidth: 0.8, cornerRadius: 2,
        }));

        // 固定触头（COM，左侧）
        const comX = cx2 - 20;
        this.group.add(new Konva.Rect({ x: comX - colW/2, y: cy2 + 4, width: colW, height: 8, fill: '#c0a020', stroke: '#8a7010', strokeWidth: 0.8, cornerRadius: 1 }));
        this.group.add(new Konva.Line({ points: [comX, cy2+12, comX, cy2+ch-4], stroke: '#c0a020', strokeWidth: 2.5, lineCap: 'round' }));

        // 固定触头（NC，右侧）
        const ncX  = cx2 + 20;
        this.group.add(new Konva.Rect({ x: ncX - colW/2, y: cy2 + 4, width: colW, height: 8, fill: '#c0a020', stroke: '#8a7010', strokeWidth: 0.8, cornerRadius: 1 }));
        this.group.add(new Konva.Line({ points: [ncX, cy2+12, ncX, cy2+ch-4], stroke: '#c0a020', strokeWidth: 2.5, lineCap: 'round' }));

        // 可动桥片（NC 常闭：平时连接 COM-NC）
        this._contactBridge = new Konva.Rect({
            x: comX - colW/2, y: cy2 + 6,
            width: ncX - comX + colW, height: 5,
            fill: '#4fc3f7', stroke: '#0288d1', strokeWidth: 1, cornerRadius: 2,
        });

        // 弹簧（桥片上方）
        this._springGroup = new Konva.Group({ x: cx2, y: cy2 + 2 });
        for (let i = 0; i < 4; i++) {
            this._springGroup.add(new Konva.Line({
                points: [i*4 - 6, 0, i*4 - 4, -4, i*4 - 2, 0],
                stroke: '#78909c', strokeWidth: 1.2, lineCap: 'round', lineJoin: 'round',
            }));
        }

        // 触点状态圆点（COM / NC）
        this._dotCom = new Konva.Circle({ x: comX, y: cy2 + 10, radius: 3.5, fill: '#4fc3f7' });
        this._dotNc  = new Konva.Circle({ x: ncX,  y: cy2 + 10, radius: 3.5, fill: '#4fc3f7' });

        this.group.add(this._contactBridge, this._springGroup, this._dotCom, this._dotNc);

        this._comX = comX; this._ncX = ncX;
        this._contactBaseY = cy2 + 6;
    }

    // ── 按钮帽（可按下）─────────────────────
    _drawButtonCap() {
        const cx2 = this._capCX, cy2 = this._capCY, R = this._capR;
        const col = this.buttonColor;

        // 按钮凹槽（外框）
        this.group.add(new Konva.Circle({ x: cx2, y: cy2, radius: R + 5, fill: '#263238', stroke: '#1a2634', strokeWidth: 1 }));

        // 按钮帽主体（动态Y位置）
        this._capGroup = new Konva.Group({ x: cx2, y: cy2 });

        const cap = new Konva.Circle({ radius: R, fill: col, stroke: this._darken(col), strokeWidth: 2 });
        // 侧面（立体感）
        const side = new Konva.Ellipse({ radiusX: R, radiusY: R*0.18, fill: this._darken(col), y: R*0.08 });

        this._capGroup.add(side, cap);
        this.group.add(this._capGroup);

        // 按钮杆（连接帽与触点机构）
        this._stemLine = new Konva.Line({
            points: [cx2, cy2 + R, cx2, this._contactY],
            stroke: '#607d8b', strokeWidth: 3, lineCap: 'round',
        });
        this.group.add(this._stemLine);
    }

    // ── 指示灯（NC 状态）────────────────────
    _drawIndicatorLed() {
        const cx2 = this._capCX + this._capR + 10;
        const cy2 = this._capCY;

        // LED 外壳
        this.group.add(new Konva.Circle({ x: cx2, y: cy2, radius: 5, fill: '#1a1a1a', stroke: '#333', strokeWidth: 1 }));
        // LED 发光面（动态）
        this._led = new Konva.Circle({ x: cx2, y: cy2, radius: 3.5, fill: '#1a1a1a' });
        this._ledGlow = new Konva.Circle({ x: cx2, y: cy2, radius: 8, fill: 'rgba(0,0,0,0)' });
        this.group.add(this._ledGlow, this._led);

        // 标注
        this.group.add(new Konva.Text({ x: cx2-10, y: cy2+7, width: 20, text: 'NC', fontSize: 7, fill: '#546e7a', align: 'center' }));
        this._ledX = cx2; this._ledY = cy2;
    }

    // ── 接线端子 ─────────────────────────────
    _drawTerminals() {
        const ty   = this._termY;
        const comX = this._termComX;
        const ncX  = this._termNcX;

        // 端子块背景
        this.group.add(new Konva.Rect({
            x: this._housingX, y: ty, width: this._housingW, height: 22,
            fill: '#263238', stroke: '#1a2634', strokeWidth: 1, cornerRadius: [0,0,3,3],
        }));

        // COM 端子
        const tComBlock = new Konva.Rect({ x: comX-14, y: ty+2, width: 20, height: 16, fill: '#37474f', stroke: '#546e7a', strokeWidth: 0.8, cornerRadius: 2 });
        this.group.add(tComBlock);
        this.group.add(new Konva.Line({ points: [comX-4, this._contactY + this._contactH - 16, comX-4, ty+4], stroke: '#c0a020', strokeWidth: 1.5, dash: [3,2] }));

        // NC 端子
        const tNcBlock = new Konva.Rect({ x: ncX-6, y: ty+2, width: 20, height: 16, fill: '#37474f', stroke: '#546e7a', strokeWidth: 0.8, cornerRadius: 2 });
        this.group.add(tNcBlock);
        this.group.add(new Konva.Line({ points: [ncX+4, this._contactY + this._contactH - 16, ncX+4, ty+4], stroke: '#c0a020', strokeWidth: 1.5, dash: [3,2] }));

        // 端子螺丝
        [comX, ncX].forEach(tx => {
            this.group.add(new Konva.Circle({ x: tx, y: ty + 12, radius: 5, fill: '#455a64', stroke: '#37474f', strokeWidth: 0.5 }));
            this.group.add(new Konva.Line({ points: [tx-3, ty+12, tx+3, ty+12], stroke: '#263238', strokeWidth: 1.5 }));
            this.group.add(new Konva.Line({ points: [tx, ty+9, tx, ty+15], stroke: '#263238', strokeWidth: 1.5 }));
        });
    }

    // ── 按钮面板标签 ────────────────────────
    _drawButtonText() {
        const cx2 = this._capCX, cy2 = this._capCY, R = this._capR;

        // 标签背景板
        this.group.add(new Konva.Rect({
            x: cx2 - R, y: cy2 - R - 24,
            width: R * 2, height: 16,
            fill: '#1a2634', cornerRadius: 2,
        }));
        this.group.add(new Konva.Text({
            x: cx2 - R, y: cy2 - R - 22,
            width: R * 2, text: this.label,
            fontSize: 10, fontStyle: 'bold', fill: '#ffffff', align: 'center',
        }));
    }

    // ── 鼠标/触摸交互 ────────────────────────
    _setupInteraction() {
        // 整个按钮帽区域可点击
        const hitZone = new Konva.Circle({
            x: this._capCX, y: this._capCY,
            radius: this._capR + 6,
            fill: 'transparent', listening: true,
        });

        hitZone.on('mousedown touchstart', (e) => {
            e.cancelBubble = true;
            this._setPressed(true);
        });

        const release = () => { this._setPressed(false); };
        window.addEventListener('mouseup', release);
        window.addEventListener('touchend', release);

        this.group.add(hitZone);
    }

    _setPressed(on) {
        this.pressed   = on;
        this.isOn  = !on;   // NC：按下=断开，松开=闭合
        this._refreshCache();
    }

    // ── 工具：颜色加深 ─────────────────────
    _darken(hex) {
        const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
        return `rgb(${Math.round(r*0.65)},${Math.round(g*0.65)},${Math.round(b*0.65)})`;
    }

    // ═══════════════════════════════════════════
    // 集中化 tick（由 consys._tickAll 在 20fps 调用）
    tick(dt) {
        this._tickPhysics(dt);
        this._tickViz();
        this._refreshCache();
    }
    // ── 物理动画 ─────────────────────────────
    _tickPhysics(dt) {
        // 按钮按下深度平滑动画
        const target = this.pressed ? 1 : 0;
        this._pressAnim += (target - this._pressAnim) * Math.min(1, dt * 22);
        this._phase     += dt * 3;
    }

    // ── 可视化更新 ───────────────────────────
    _tickViz() {
        const pressDepth = this._pressAnim;   // 0~1
        const cx2 = this._capCX, cy2 = this._capCY;
        const R   = this._capR;
        const maxDrop = Math.round(R * 0.45);  // 最大按下深度（像素）

        // ── 按钮帽位移 ──
        if (this._capGroup) {
            this._capGroup.y(cy2 + pressDepth * maxDrop);
        }

        // ── 按钮杆更新（帽→触点机构顶） ──
        if (this._stemLine) {
            this._stemLine.points([
                cx2, cy2 + pressDepth * maxDrop + R,
                cx2, this._contactY,
            ]);
        }

        // ── 触点桥片：按下时向下移动（断开） ──
        const bridgeDropPx = pressDepth * 10;  // 桥片下移量
        if (this._contactBridge) {
            this._contactBridge.y(this._contactBaseY + bridgeDropPx);
            // 闭合=蓝色，断开=暗色
            const bridgeColor = pressDepth < 0.4 ? '#4fc3f7' : '#546e7a';
            this._contactBridge.fill(bridgeColor);
            this._contactBridge.stroke(pressDepth < 0.4 ? '#0288d1' : '#37474f');
        }

        // ── 触点圆点颜色 ──
        const dotColor = pressDepth < 0.4 ? '#4fc3f7' : '#37474f';
        if (this._dotCom) this._dotCom.fill(dotColor);
        if (this._dotNc)  this._dotNc.fill(dotColor);

        // ── 弹簧压缩 ──
        if (this._springGroup) {
            this._springGroup.scaleY(1 - pressDepth * 0.35);
            this._springGroup.y(this._contactY + 2 + pressDepth * maxDrop * 0.3);
        }

        // ── 指示 LED ──
        //  NC 闭合（未按下）= 绿灯亮；按下（断路）= 灯灭
        if (this._led) {
            if (pressDepth < 0.4) {
                // 常态：NC 闭合，LED 亮（轻微呼吸）
                const pulse = 0.75 + 0.25 * Math.abs(Math.sin(this._phase));
                this._led.fill(this.ledColor);
                this._led.opacity(pulse);
                if (this._ledGlow) {
                    const c = this.ledColor;
                    const lr = parseInt(c.slice(1,3),16), lg2 = parseInt(c.slice(3,5),16), lb = parseInt(c.slice(5,7),16);
                    this._ledGlow.fill(`rgba(${lr},${lg2},${lb},${0.22*pulse})`);
                }
            } else {
                // 按下：NC 断开，LED 灭
                this._led.fill('#1a1a1a');
                this._led.opacity(1);
                if (this._ledGlow) this._ledGlow.fill('rgba(0,0,0,0)');
            }
        }
    }

    // ═══════════════════════════════════════════
    //  外部接口
    // ═══════════════════════════════════════════

    /** 模拟按下 */
    press() {
        this._setPressed(true);
    }

    /** 模拟松开 */
    release() {
        this._setPressed(false);
    }

    /** 获取当前触点状态 */
    getContactState() {
        return { isOn: this.isOn, pressed: this.pressed };
    }

    /** 气路求解器接口 */
    update(press) {
        if (typeof press === 'number') {
            this._setPressed(press > 0);
        }
        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label: '位号/名称',    key: 'id',          type: 'text'   },
            { label: '按钮标签',     key: 'label',       type: 'text'   },
            { label: '按钮颜色',     key: 'buttonColor', type: 'select',
              options: [
                  { label: '红色（停止）', value: '#ef5350' },
                  { label: '黑色（停止）', value: '#37474f' },
                  { label: '蓝色',        value: '#1565c0' },
                  { label: '黄色',        value: '#f9a825' },
              ]},
        ];
    }

    onConfigUpdate(cfg) {
        this.id          = cfg.id          || this.id;
        this.label       = cfg.label       || this.label;
        this.buttonColor = cfg.buttonColor || this.buttonColor;
        this.config      = { ...this.config, ...cfg };
        this._refreshCache();
    }

    destroy() {
        super.destroy?.();
    }
}