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
 * ── 端口 ─────────────────────────────────────────────────────
 *  wire_l — 常闭端（NC）
 *  wire_r — 公共端（COM）
 *
 * ── 本平台适配 ────────────────────────────────────────────────
 *  · 静态图形绘制到 _staticGroup（一次性位图缓存），动态图形绘制到 _dynamicGroup；
 *  · 动画统一由 consys._tickAll 调用的 tick(dt) 驱动（in-place 更新，不重建节点）。
 */
export class NormallyClosedPushButton extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.type    = 'switch';
        this.special = 'buttonstop';
        this.cache   = 'fixed';

        // 规范顺序：_initGroups → _recalcGeometry → _initParameters → _init
        this._initGroups();
        this._recalcGeometry(config);
        this._initParameters(config);

        this.config = { id: this.id, buttonColor: this.buttonColor, label: this.label };

        this._init();

        // 端口
        this.addPort(this._termComX - 4, this.height - 8, 'l', 'wire', 'p');
        this.addPort(this._termNcX + 4,  this.height - 8, 'r', 'wire');
    }

    // ═══════════════════════════════════════════
    _recalcGeometry(config) {
        this.width  = Math.max(90,  config.width  || 90);
        this.height = Math.max(160, config.height || 160);

        const cx = this.width / 2;
        this._housingX = 8;
        this._housingY = 20;
        this._housingW = this.width - 16;
        this._housingH = Math.round(this.height * 0.75);
        this._capCX    = cx;
        this._capCY    = this._housingY + Math.round(this._housingH * 0.28);
        this._capR     = Math.round(this.width * 0.26);
        this._contactY = this._housingY + Math.round(this._housingH * 0.56);
        this._contactH = Math.round(this._housingH * 0.38);
        this._termY    = this._housingY + this._housingH;
        this._termComX = Math.round(this.width * 0.32);
        this._termNcX  = Math.round(this.width * 0.68);
    }

    _initParameters(config) {
        // ── 参数 ──
        this.buttonColor = config.buttonColor || '#ef5350';
        this.ledColor    = config.ledColor    || '#66bb6a';
        this.label       = config.label       || 'STOP';

        // ── 状态 ──
        this.pressed    = false;
        this.isOn       = true;    // NC 触点：true=闭合
        this._pressAnim = 0;
        this._phase     = 0;
    }

    // ═══════════════════════════════════════════
    // 注意：各 draw 方法同时向 _staticGroup/_dynamicGroup 添加节点，
    // 且创建顺序影响 z-order（灯/触点/按钮帽需按序叠放），故此处保持固定调用顺序。
    _init() {
        this._drawLabel();
        this._drawHousing();
        this._drawContactMechanism();
        this._drawButtonCap();
        this._drawIndicatorLed();
        this._drawTerminals();
        this._drawButtonText();
        this._bindInteraction();
    }

    _bindInteraction() {
        this._setupInteraction();
    }

    _drawLabel() {
        this._staticGroup.add(new Konva.Text({
            x: 0, y: -10, width: this.width,
            text: '常闭按钮 (NC)',
            fontSize: 12, fontStyle: 'bold', fill: '#1a2634', align: 'center',
        }));
    }

    // ── 按钮外壳 ─────────────────────────────
    _drawHousing() {
        const { _housingX: hx, _housingY: hy, _housingW: hw, _housingH: hh } = this;
        const sg = this._staticGroup;

        const mountPlate = new Konva.Rect({
            x: hx - 4, y: hy - 6, width: hw + 8, height: hh + 12,
            fill: '#b0bec5', stroke: '#78909c', strokeWidth: 1.2, cornerRadius: 3,
        });
        sg.add(mountPlate);
        [[hx, hy], [hx + hw, hy], [hx, hy + hh], [hx + hw, hy + hh]].forEach(([bx2, by2]) => {
            sg.add(new Konva.Circle({ x: bx2, y: by2, radius: 3, fill: '#546e7a' }));
        });

        const body = new Konva.Rect({
            x: hx, y: hy, width: hw, height: hh,
            fill: '#37474f', stroke: '#263238', strokeWidth: 1.5, cornerRadius: 4,
        });
        sg.add(body);
        sg.add(new Konva.Rect({
            x: hx + 2, y: hy + 2, width: hw - 4, height: 5,
            fill: 'rgba(255,255,255,0.12)', cornerRadius: [2, 2, 0, 0],
        }));

        const npY = this._contactY + this._contactH - 14;
        sg.add(new Konva.Rect({ x: hx + 4, y: npY, width: hw - 8, height: 12, fill: '#1a2634', cornerRadius: 1 }));
    }

    // ── 触点机构示意（剖面）─────────────────
    _drawContactMechanism() {
        const { _housingX: hx, _housingW: hw } = this;
        const sg = this._staticGroup, dg = this._dynamicGroup;
        const cy2 = this._contactY;
        const ch  = this._contactH - 16;
        const cx2 = this.width / 2;
        const colW = 18;

        sg.add(new Konva.Rect({
            x: hx + 4, y: cy2, width: hw - 8, height: ch,
            fill: '#0d1520', stroke: '#1a3040', strokeWidth: 0.8, cornerRadius: 2,
        }));

        const comX = cx2 - 20;
        sg.add(new Konva.Rect({ x: comX - colW / 2, y: cy2 + 4, width: colW, height: 8, fill: '#c0a020', stroke: '#8a7010', strokeWidth: 0.8, cornerRadius: 1 }));
        sg.add(new Konva.Line({ points: [comX, cy2 + 12, comX, cy2 + ch - 4], stroke: '#c0a020', strokeWidth: 2.5, lineCap: 'round' }));

        const ncX = cx2 + 20;
        sg.add(new Konva.Rect({ x: ncX - colW / 2, y: cy2 + 4, width: colW, height: 8, fill: '#c0a020', stroke: '#8a7010', strokeWidth: 0.8, cornerRadius: 1 }));
        sg.add(new Konva.Line({ points: [ncX, cy2 + 12, ncX, cy2 + ch - 4], stroke: '#c0a020', strokeWidth: 2.5, lineCap: 'round' }));

        // 可动桥片（NC 常闭：平时连接 COM-NC）
        this._contactBridge = new Konva.Rect({
            x: comX - colW / 2, y: cy2 + 6,
            width: ncX - comX + colW, height: 5,
            fill: '#4fc3f7', stroke: '#0288d1', strokeWidth: 1, cornerRadius: 2,
        });

        this._springGroup = new Konva.Group({ x: cx2, y: cy2 + 2 });
        for (let i = 0; i < 4; i++) {
            this._springGroup.add(new Konva.Line({
                points: [i * 4 - 6, 0, i * 4 - 4, -4, i * 4 - 2, 0],
                stroke: '#78909c', strokeWidth: 1.2, lineCap: 'round', lineJoin: 'round',
            }));
        }

        this._dotCom = new Konva.Circle({ x: comX, y: cy2 + 10, radius: 3.5, fill: '#4fc3f7' });
        this._dotNc  = new Konva.Circle({ x: ncX,  y: cy2 + 10, radius: 3.5, fill: '#4fc3f7' });

        dg.add(this._contactBridge, this._springGroup, this._dotCom, this._dotNc);

        this._comX = comX; this._ncX = ncX;
        this._contactBaseY = cy2 + 6;
    }

    // ── 按钮帽（可按下）─────────────────────
    _drawButtonCap() {
        const cx2 = this._capCX, cy2 = this._capCY, R = this._capR;
        const col = this.buttonColor;
        const sg = this._staticGroup, dg = this._dynamicGroup;

        sg.add(new Konva.Circle({ x: cx2, y: cy2, radius: R + 5, fill: '#263238', stroke: '#1a2634', strokeWidth: 1 }));

        this._capGroup = new Konva.Group({ x: cx2, y: cy2 });
        const cap = new Konva.Circle({ radius: R, fill: col, stroke: this._darken(col), strokeWidth: 2 });
        const side = new Konva.Ellipse({ radiusX: R, radiusY: R * 0.18, fill: this._darken(col), y: R * 0.08 });
        this._capGroup.add(side, cap);
        dg.add(this._capGroup);

        this._stemLine = new Konva.Line({
            points: [cx2, cy2 + R, cx2, this._contactY],
            stroke: '#607d8b', strokeWidth: 3, lineCap: 'round',
        });
        dg.add(this._stemLine);
    }

    // ── 指示灯（NC 状态）────────────────────
    _drawIndicatorLed() {
        const cx2 = this._capCX + this._capR + 10;
        const cy2 = this._capCY;
        const sg = this._staticGroup, dg = this._dynamicGroup;

        sg.add(new Konva.Circle({ x: cx2, y: cy2, radius: 5, fill: '#1a1a1a', stroke: '#333', strokeWidth: 1 }));
        this._led = new Konva.Circle({ x: cx2, y: cy2, radius: 3.5, fill: '#1a1a1a' });
        this._ledGlow = new Konva.Circle({ x: cx2, y: cy2, radius: 8, fill: 'rgba(0,0,0,0)' });
        dg.add(this._ledGlow, this._led);

        sg.add(new Konva.Text({ x: cx2 - 10, y: cy2 + 7, width: 20, text: 'NC', fontSize: 7, fill: '#546e7a', align: 'center' }));
        this._ledX = cx2; this._ledY = cy2;
    }

    // ── 接线端子 ─────────────────────────────
    _drawTerminals() {
        const sg = this._staticGroup;
        const ty   = this._termY;
        const comX = this._termComX;
        const ncX  = this._termNcX;

        sg.add(new Konva.Rect({
            x: this._housingX, y: ty, width: this._housingW, height: 22,
            fill: '#263238', stroke: '#1a2634', strokeWidth: 1, cornerRadius: [0, 0, 3, 3],
        }));

        sg.add(new Konva.Rect({ x: comX - 14, y: ty + 2, width: 20, height: 16, fill: '#37474f', stroke: '#546e7a', strokeWidth: 0.8, cornerRadius: 2 }));
        sg.add(new Konva.Line({ points: [comX - 4, this._contactY + this._contactH - 16, comX - 4, ty + 4], stroke: '#c0a020', strokeWidth: 1.5, dash: [3, 2] }));

        sg.add(new Konva.Rect({ x: ncX - 6, y: ty + 2, width: 20, height: 16, fill: '#37474f', stroke: '#546e7a', strokeWidth: 0.8, cornerRadius: 2 }));
        sg.add(new Konva.Line({ points: [ncX + 4, this._contactY + this._contactH - 16, ncX + 4, ty + 4], stroke: '#c0a020', strokeWidth: 1.5, dash: [3, 2] }));

        [comX, ncX].forEach(tx => {
            sg.add(new Konva.Circle({ x: tx, y: ty + 12, radius: 5, fill: '#455a64', stroke: '#37474f', strokeWidth: 0.5 }));
            sg.add(new Konva.Line({ points: [tx - 3, ty + 12, tx + 3, ty + 12], stroke: '#263238', strokeWidth: 1.5 }));
            sg.add(new Konva.Line({ points: [tx, ty + 9, tx, ty + 15], stroke: '#263238', strokeWidth: 1.5 }));
        });
    }

    // ── 按钮面板标签 ────────────────────────
    _drawButtonText() {
        const cx2 = this._capCX, cy2 = this._capCY, R = this._capR;
        const sg = this._staticGroup;

        sg.add(new Konva.Rect({
            x: cx2 - R, y: cy2 - R - 24,
            width: R * 2, height: 16,
            fill: '#1a2634', cornerRadius: 2,
        }));
        sg.add(new Konva.Text({
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

        const release = () => { if (this.pressed) this._setPressed(false); };
        window.addEventListener('mouseup', release);
        window.addEventListener('touchend', release);

        this._interactGroup.add(hitZone);
    }

    _setPressed(on) {
        this.pressed = on;
        this.isOn = !on;   // NC：按下=断开，松开=闭合
        this.markDirty();
        this._refreshIfDirty(true);
    }

    // ── 工具：颜色加深 ─────────────────────
    _darken(hex) {
        const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
        return `rgb(${Math.round(r * 0.65)},${Math.round(g * 0.65)},${Math.round(b * 0.65)})`;
    }

    // ═══════════════════════════════════════════
    //  集中化动画 tick（由 consys._tickAll 20fps 调用）
    // ═══════════════════════════════════════════
    tick(dt) {
        this._tickPhysics(dt);
        this._tickViz();
        this.markDirty();
        this._refreshIfDirty();
    }

    _tickPhysics(dt) {
        const target = this.pressed ? 1 : 0;
        this._pressAnim += (target - this._pressAnim) * Math.min(1, dt * 22);
        this._phase     += dt * 3;
    }

    _tickViz() {
        const pressDepth = this._pressAnim;
        const cx2 = this._capCX, cy2 = this._capCY;
        const R   = this._capR;
        const maxDrop = Math.round(R * 0.45);

        if (this._capGroup) this._capGroup.y(cy2 + pressDepth * maxDrop);
        if (this._stemLine) {
            this._stemLine.points([cx2, cy2 + pressDepth * maxDrop + R, cx2, this._contactY]);
        }

        const bridgeDropPx = pressDepth * 10;
        if (this._contactBridge) {
            this._contactBridge.y(this._contactBaseY + bridgeDropPx);
            const bridgeColor = pressDepth < 0.4 ? '#4fc3f7' : '#546e7a';
            this._contactBridge.fill(bridgeColor);
            this._contactBridge.stroke(pressDepth < 0.4 ? '#0288d1' : '#37474f');
        }

        const dotColor = pressDepth < 0.4 ? '#4fc3f7' : '#37474f';
        if (this._dotCom) this._dotCom.fill(dotColor);
        if (this._dotNc)  this._dotNc.fill(dotColor);

        if (this._springGroup) {
            this._springGroup.scaleY(1 - pressDepth * 0.35);
            this._springGroup.y(this._contactY + 2 + pressDepth * maxDrop * 0.3);
        }

        if (this._led) {
            if (pressDepth < 0.4) {
                const pulse = 0.75 + 0.25 * Math.abs(Math.sin(this._phase));
                this._led.fill(this.ledColor);
                this._led.opacity(pulse);
                if (this._ledGlow) {
                    const c = this.ledColor;
                    const lr = parseInt(c.slice(1, 3), 16), lg2 = parseInt(c.slice(3, 5), 16), lb = parseInt(c.slice(5, 7), 16);
                    this._ledGlow.fill(`rgba(${lr},${lg2},${lb},${0.22 * pulse})`);
                }
            } else {
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
    press() { this._setPressed(true); }

    /** 模拟松开 */
    release() { this._setPressed(false); }

    /** 获取当前触点状态 */
    getContactState() { return { isOn: this.isOn, pressed: this.pressed }; }

    /** 气路/电路求解器接口 */
    update(press) {
        if (typeof press === 'number') this._setPressed(press > 0);
        this._refreshIfDirty(true);
    }

    /** 供自动演示箭头定位按钮帽/指示灯中心（画布世界坐标） */
    getClickablePartCenter(partId) {
        const abs = this.group.getAbsolutePosition();
        if (partId === 'btn') return { x: abs.x + this._capCX, y: abs.y + this._capCY };
        if (partId === 'led') return { x: abs.x + this._ledX, y: abs.y + this._ledY };
        if (partId === 'contact') return { x: abs.x + this.width / 2, y: abs.y + this._contactY + this._contactH / 2 };
        return { x: abs.x + this.width / 2, y: abs.y + this.height / 2 };
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
              ] },
        ];
    }

    onConfigUpdate(cfg) {
        this.id          = cfg.id          || this.id;
        this.label       = cfg.label       || this.label;
        this.buttonColor = cfg.buttonColor || this.buttonColor;
        this.config      = { ...this.config, ...cfg };
        this.markDirty();
        this._refreshIfDirty(true);
    }
}
