import { BaseComponent } from './BaseComponent.js';

/**
 * 密封油柜（Sealed Oil Tank）
 *
 * 集成式油箱组件，包含两个标准截止阀符号：
 *  - 右上进口截止阀（绿色导通/红色截止）→ 液位每秒 +1%
 *  - 右下出口截止阀（绿色导通/红色截止）→ 液位每秒 − 液位% × 0.8%
 *  - 左上 pipe 进口
 *  - 左下 pipe 出口
 */
export class SealedOilTank extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(200, config.width  || 260);
        this.height = Math.max(300, config.height || 420);
        this.type   = 'sealed_oil_tank';
        this.cache  = 'fixed';

        this._initGroups();
        // ── 参数 ──
        this.label     = config.label     || 'TK-101';
        this.capacity  = config.capacity  || 100;        // 额定容量 L
        this.initLevel = config.initLevel || 40;         // 初始液位 %

        // ── 液位状态 ──
        this._manualLevel  = this.initLevel;
        this._displayLevel = this.initLevel;

        // ── 阀门状态 ──
        this._inletOpen  = false;
        this._outletOpen = false;

        // ── 布局 ──
        this._bodyX = 4;
        this._bodyY = 26;
        this._bodyW = this.width - 8;
        this._bodyH = this.height - 44;

        // 液腔（油充满整个空间）
        this._chamX = this._bodyX + 4;
        this._chamY = this._bodyY + 4;
        this._chamW = this._bodyW - 10;
        this._chamH = this._bodyH - 8;

        // 右上进口截止阀（标准截止阀符号）
        this._inValveX = this._bodyX + this._bodyW - 30;
        this._inValveY = this._bodyY + 16;

        // 右下出口截止阀（标准截止阀符号）
        this._outValveX = this._bodyX + this._bodyW - 30;
        this._outValveY = this._bodyY + this._bodyH - 42;

        this._draw();
        this._initPorts();
    }

    // ═══════════════════════════════════════
    //  绘制
    // ═══════════════════════════════════════

    _draw() {
        this._drawLabel();
        this._drawBody();
        this._drawOil();
        this._drawLevelDisplay();
        this._drawInletValve();
        this._drawOutletValve();
    }

    /** 标题栏 */
    _drawLabel() {
        this._staticGroup.add(new Konva.Rect({
            x: 0, y: 0, width: this.width, height: 24,
            fill: '#1a237e', cornerRadius: [4, 4, 0, 0],
        }));
        this._staticGroup.add(new Konva.Text({
            x: 6, y: 2, width: this.width - 12,
            text: `${this.label}  密封油柜`,
            fontSize: 12, fontStyle: 'bold', fill: '#e8eaf6',align:'center'
        }));
        this._staticGroup.add(new Konva.Text({
            x: 6, y: 14, width: this.width - 12,
            text: 'Sealed Oil Tank',
            fontSize: 9.5, fill: '#0ff43d', align: 'center'
        }));
    }

    /** 油箱壳体 */
    _drawBody() {
        const b = { x: this._bodyX, y: this._bodyY, w: this._bodyW, h: this._bodyH };
        // 外壳
        this._staticGroup.add(new Konva.Rect({
            x: b.x, y: b.y, width: b.w, height: b.h,
            fill: '#e8edf2', stroke: '#455a64', strokeWidth: 1.5,
            cornerRadius: [0, 0, 3, 3],
        }));
        // 内腔偏白背景
        this._staticGroup.add(new Konva.Rect({
            x: this._chamX - 2, y: this._chamY - 2,
            width: this._chamW + 4, height: this._chamH + 4,
            fill: 'rgba(255,255,255,0.4)', stroke: '#90a4ae', strokeWidth: 0.5,
        }));
        // 底部法兰
        this._staticGroup.add(new Konva.Rect({
            x: b.x + 20, y: b.y + b.h, width: b.w - 40, height: 10,
            fill: '#607d8b', stroke: '#37474f', strokeWidth: 1, cornerRadius: 2,
        }));
        // 螺栓
        [b.x + 26, b.x + b.w - 26].forEach(cx => {
            this._staticGroup.add(new Konva.Circle({
                x: cx, y: b.y + b.h + 5, radius: 2.5, fill: '#37474f',
            }));
        });
    }

    /** 油液面 */
    _drawOil() {
        this._oilRect = new Konva.Rect({
            x: this._chamX + 2,
            y: this._chamY + this._chamH,
            width: this._chamW - 4,
            height: 0,
            fill: '#d4a12a',
            opacity: 0.75,
        });
        // 油面光泽
        this._oilSheen = new Konva.Rect({
            x: this._chamX + 4,
            y: this._chamY + this._chamH,
            width: 6,
            height: 0,
            fill: 'rgba(255,255,255,0.2)',
            cornerRadius: 1,
        });
        this._staticGroup.add(this._oilRect, this._oilSheen);
    }

    /** 液位数显（油箱体内右下角） */
    _drawLevelDisplay() {
        const dx = this._bodyX + this._bodyW - 54;
        const dy = this._bodyY + this._bodyH - 18;
        const dw = 48;

        this._lcdBg = new Konva.Rect({
            x: dx, y: dy, width: dw, height: 14,
            fill: '#90b928', stroke: '#1a3040', strokeWidth: 0.5, cornerRadius: 1,
        });
        this._lcdText = new Konva.Text({
            x: dx, y: dy + 1, width: dw,
            text: '40.0 %', fontSize: 8, fontFamily: 'Courier New, monospace',
            fontStyle: 'bold', fill: '#66bb6a', align: 'center',
        });
        // this._staticGroup.add(this._lcdBg, this._lcdText);
    }

    /** 绘制标准截止阀符号 */
    _drawStopValve(cx, cy, ref) {
        // 管路短节
        const pipe = new Konva.Rect({
            x: cx - 22, y: cy - 3, width: 44, height: 6,
            fill: '#b0bec5', stroke: '#78909c', strokeWidth: 0.5, cornerRadius: 1,
        });
        // 阀体
        this[ref + 'Body'] = new Konva.Circle({
            x: cx, y: cy, radius: 10,
            fill: '#e8edf2', stroke: '#e74c3c', strokeWidth: 1.2,
        });
        // 阀杆
        this[ref + 'Stem'] = new Konva.Rect({
            x: cx - 1.5, y: cy - 16, width: 3, height: 11,
            fill: '#e74c3c', stroke: '#c0392b', strokeWidth: 0.5,
        });
        // 手柄组（整体旋转以模拟开/关）
        const hg = new Konva.Group({ x: cx, y: cy - 18 });
        this[ref + 'HandleGrp'] = hg;
        // 手柄横杆
        this[ref + 'Handle'] = new Konva.Rect({
            x: -7, y: -2, width: 14, height: 4,
            fill: '#e74c3c', stroke: '#c0392b', strokeWidth: 0.5, cornerRadius: 1,
        });
        // 手柄旋钮
        this[ref + 'Knob'] = new Konva.Circle({
            x: 0, y: 0, radius: 3.5,
            fill: '#e74c3c', stroke: '#c0392b', strokeWidth: 0.5,
        });
        hg.add(this[ref + 'Handle'], this[ref + 'Knob']);
        this._staticGroup.add(pipe, this[ref + 'Body'], this[ref + 'Stem'], hg);
    }

    /** 右上进口截止阀 */
    _drawInletValve() {
        this._drawStopValve(this._inValveX+55, this._inValveY, '_inV');
        // 标签
        this._staticGroup.add(new Konva.Text({
            x: this._inValveX +35, y: this._inValveY + 10, width: 40,
            text: '进口', fontSize: 12, fill: '#09a323', align: 'center',
        }));
        // 点击交互
        this._addValveHit(this._inValveX+55, this._inValveY, '_inV', '_inletOpen');
    }

    /** 右下出口截止阀 */
    _drawOutletValve() {
        this._drawStopValve(this._outValveX+55, this._outValveY, '_outV');
        // 标签
        this._staticGroup.add(new Konva.Text({
            x: this._outValveX +35, y: this._outValveY + 10, width: 40,
            text: '出口', fontSize: 12, fill: '#08d24b', align: 'center',
        }));
        // 点击交互
        this._addValveHit(this._outValveX+55, this._outValveY, '_outV', '_outletOpen');
    }

    /** 阀门点击交互 */
    _addValveHit(cx, cy, ref, stateKey) {
        const hit = new Konva.Rect({
            x: cx - 16, y: cy - 22, width: 32, height: 38,
            fill: 'transparent', listening: true,
        });
        hit.on('click tap', (e) => {
            e.cancelBubble = true;
            this[stateKey] = !this[stateKey];
            this._updateValveVisuals();
        });
        hit.on('mouseenter', () => (document.body.style.cursor = 'pointer'));
        hit.on('mouseleave', () => (document.body.style.cursor = 'default'));
        this._interactGroup.add(hit);
    }

    /** 更新阀门视觉状态 — 绿色导通 / 红色截止 */
    _updateValveVisuals() {
        // 进口阀
        this._setValveColor('_inV', this._inletOpen);
        // 出口阀
        this._setValveColor('_outV', this._outletOpen);
        this._refreshCache();
    }

    _setValveColor(ref, isOpen) {
        const cO = '#4caf50', cC = '#e74c3c';
        const sO = '#388e3c', sC = '#c0392b';
        this[ref + 'Body'].stroke(isOpen ? cO : cC);
        this[ref + 'Stem'].fill(isOpen ? cO : cC);
        this[ref + 'Stem'].stroke(isOpen ? sO : sC);
        this[ref + 'Handle'].fill(isOpen ? cO : cC);
        this[ref + 'Handle'].stroke(isOpen ? sO : sC);
        this[ref + 'Knob'].fill(isOpen ? cO : cC);
        this[ref + 'Knob'].stroke(isOpen ? sO : sC);
        this[ref + 'HandleGrp'].rotation(isOpen ? 90 : 0);
    }

    // ═══════════════════════════════════════
    //  端口
    // ═══════════════════════════════════════

    _initPorts() {
        // 左上 pipe 接口 — 进口
        this.addPort(this._bodyX, this._bodyY + 10, 'hi', 'pipe', 'in');
        // 左下 pipe 接口 — 出口
        this.addPort(this._bodyX, this._bodyY + this._bodyH - 10, 'lo', 'pipe');
    }

    // ═══════════════════════════════════════
    //  动画主循环（20fps）
    // ═══════════════════════════════════════

    tick(dt) {
        this._tickPhysics(dt);
        this._broadcastLevel();
        this._tickOil();
        this._tickDisplay();
        this._refreshCache();
    }

    _tickPhysics(dt) {
        // 进口阀：+1%/s
        if (this._inletOpen) {
            this._manualLevel += 1.0 * dt;
        }
        // 出口截止阀：− 液位% × 0.8%/s（液位越高，压差越大，流速越快）
        if (this._outletOpen) {
            this._manualLevel -= this._manualLevel * 0.008 * dt;
        }
        this._manualLevel = Math.max(0, Math.min(100, this._manualLevel));

        // 一阶平滑显示
        this._displayLevel += (this._manualLevel - this._displayLevel) * Math.min(1, dt * 5);
    }

    /** 将当前液位广播到相连的仪表与滑块 */
    _broadcastLevel() {
        const level = this._displayLevel;
        const sys = this.sys;
        if (!sys) return;

        // 遍历管路连接，找出与油柜 hi+lo 都相连的组件
        const tankId = this.id;
        const hiConnected = new Set();
        const loConnected = new Set();

        sys.conns.forEach(conn => {
            if (conn.type !== 'pipe') return;
            const pair = (a, b) => {
                const aParts = a.split('_pipe_');
                if (aParts.length === 2 && aParts[0] === tankId) {
                    const bParts = b.split('_pipe_');
                    if (bParts.length === 2) {
                        if (aParts[1] === 'hi') hiConnected.add(bParts[0]);
                        if (aParts[1] === 'lo') loConnected.add(bParts[0]);
                    }
                }
            };
            pair(conn.from, conn.to);
            pair(conn.to, conn.from);
        });

        // 仅更新 hi+lo 均连接的组件
        hiConnected.forEach(compId => {
            if (loConnected.has(compId)) {
                const comp = sys.comps[compId];
                if (comp && comp.update) comp.update(level);
            }
        });

        // 同步滑块与显示
        const slider = document.getElementById('levelSlider');
        const display = document.getElementById('levelDisplay');
        if (slider) {
            const cur = parseFloat(slider.value);
            if (Math.abs(cur - level) > 0.1) {
                slider.value = level;
            }
        }
        if (display) {
            display.textContent = level.toFixed(1) + ' %';
        }
    }

    _tickOil() {
        const ch = this._chamH - 4;
        const lh = (this._displayLevel / 100) * ch;
        const top = this._chamY + 2 + ch - lh;

        this._oilRect.y(top);
        this._oilRect.height(lh);

        this._oilSheen.y(top);
        this._oilSheen.height(lh);

        // 油色随液位微变
        const fr = this._displayLevel / 100;
        const r = Math.round(192 + fr * 30);
        const g = Math.round(141 + fr * 40);
        const b = Math.round(32 + fr * 20);
        this._oilRect.fill(`rgb(${r},${g},${b})`);
        this._oilRect.opacity(0.65 + fr * 0.15);
    }

    _tickDisplay() {
        const pct = this._displayLevel;
        if (this._lcdText) {
            this._lcdText.text(`${pct.toFixed(1)} %`);
        }
    }

    // ═══════════════════════════════════════
    //  外部接口
    // ═══════════════════════════════════════

    update(level) {
        if (typeof level === 'number') {
            this._manualLevel = Math.max(0, Math.min(100, level));
        }
        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label: '位号/名称',     key: 'id',         type: 'text'   },
            { label: '额定容量 (L)',   key: 'capacity',   type: 'number' },
            { label: '初始液位 (%)',   key: 'initLevel',  type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        this.id        = cfg.id        || this.id;
        this.capacity  = parseFloat(cfg.capacity)  || this.capacity;
        this.initLevel = parseFloat(cfg.initLevel) ?? this.initLevel;
        this.config    = { ...this.config, ...cfg };
        this._refreshCache();
    }

    destroy() {
        super.destroy?.();
    }
}
