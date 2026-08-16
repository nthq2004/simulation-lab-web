import { BaseComponent } from './BaseComponent.js';

/**
 * 刀开关（闸刀开关）仿真组件
 * （Knife Switch / Blade Switch）
 *
 * ── 结构说明 ──────────────────────────────────────────────────
 *
 *  刀开关是最基本的手动隔离开关，由以下部分组成：
 *
 *  1. 底座（Base）：黑色绝缘底板，固定所有零件
 *  2. 静触头座（Fixed Contact Post）：两个黄铜立柱，固定在底座上
 *     - 左柱：进线端（A 端）
 *     - 右柱：出线端（B 端）
 *  3. 刀片（Blade / Contact Arm）：黄铜扁条，以左柱为转轴旋转
 *     - 合闸（Closed）：刀片插入右柱的夹口，电路导通
 *     - 分闸（Open）：刀片抬起，电路断开
 *  4. 手柄（Handle）：刀片末端的红色绝缘操作柄
 *  5. 紧固螺钉：底座固定件
 *
 * ── 动作逻辑 ──────────────────────────────────────────────────
 *
 *  分闸：刀片以左柱顶端为转轴，向上抬起约 45°（斜置状态）
 *  合闸：刀片水平落下，插入右柱夹口（水平状态）
 *
 *  动作过程带平滑动画（150ms，正弦缓动）
 *
 * ── 视角说明 ──────────────────────────────────────────────────
 *
 *  参考图片采用等轴测（Isometric）透视，
 *  本组件简化为正视图（Front View）二维仿真，保留所有细节特征：
 *  底座、两柱、刀片、手柄、螺钉、接线端子
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  terminal_a — A 端（进线端，左柱底部）
 *  terminal_b — B 端（出线端，右柱底部）
 */
export class KnifeSwitch extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(160, config.width  || 200);
        this.height = Math.max(120, config.height || 160);

        this.type    = 'knife_switch';
        this.special = 'none';
        this.cache   = 'fixed';

        // ── 额定参数 ──
        this.ratedVoltage = config.ratedVoltage || 380;   // V
        this.ratedCurrent = config.ratedCurrent || 60;    // A
        this.label        = config.label        || 'QS';  // 位号

        // ── 状态 ──
        this._closed      = config.initClosed !== false ? false : true; // 默认断开
        this._animating   = false;
        this._animT       = 0;        // 动画进度 0~1
        this._animDir     = 1;        // +1 = 闭合方向，-1 = 断开方向
        this._animDur     = 0.15;     // s（动画时长）
        this._bladeAngle  = this._closed ? 0 : 45; // °（0=水平=合闸，45=斜置=分闸）

        // 操作计数
        this.opsCount     = config.initOps || 0;

        // ── 几何尺寸（相对 width/height）──
        const W = this.width, H = this.height;

        // 底座
        this._base = {
            x: W*0.05, y: H*0.68,
            w: W*0.90, h: H*0.20,
            rx: 3,
        };

        // 左柱（转轴柱，进线端）
        this._postL = {
            x: W*0.20, y: H*0.30,
            w: W*0.14, h: H*0.38,
        };

        // 右柱（夹口柱，出线端）
        this._postR = {
            x: W*0.66, y: H*0.30,
            w: W*0.14, h: H*0.38,
        };

        // 刀片转轴点（左柱顶端中心）
        this._pivotX = this._postL.x + this._postL.w / 2;
        this._pivotY = this._postL.y + 2;

        // 刀片长度（从转轴到手柄末端）
        this._bladeLen = (this._postR.x + this._postR.w/2 - this._pivotX) * 1.40;
        this._bladeW   = H * 0.065;  // 刀片厚度

        // 手柄长度（占刀片末端 30%）
        this._handleLen  = this._bladeLen * 0.28;
        this._handleW    = this._bladeW * 1.6;

        this._lastTs = null;
        this._animId = null;

        this._init();

        // 端口
        this.addPort(
            this._postL.x + this._postL.w/2,
            this._base.y + this._base.h + 4,
            'terminal_a', 'wire', 'A'
        );
        this.addPort(
            this._postR.x + this._postR.w/2,
            this._base.y + this._base.h + 4,
            'terminal_b', 'wire', 'B'
        );
    }

    // ═══════════════════════════════════════════
    _init() {
        this._drawBase();
        this._drawScrews();
        this._drawPostLeft();
        this._drawPostRight();
        this._drawContactLayer();   // 动态层：刀片 + 手柄
        this._drawLabel();
        this._drawStatusIndicator();
        this._startAnimation();
    }

    // ── 底座 ─────────────────────────────────
    _drawBase() {
        const b = this._base;
        // 底座主体（深灰黑，绝缘板）
        this.group.add(new Konva.Rect({
            x: b.x, y: b.y, width: b.w, height: b.h,
            fill: '#2a2a2e', stroke: '#3a3a40', strokeWidth: 1.5,
            cornerRadius: b.rx, shadowColor: '#000', shadowBlur: 4,
            shadowOffsetY: 2, shadowOpacity: 0.3,
        }));
        // 底座顶面高光
        this.group.add(new Konva.Rect({
            x: b.x+2, y: b.y+2, width: b.w-4, height: b.h*0.25,
            fill: 'rgba(255,255,255,0.06)', cornerRadius: [b.rx,b.rx,0,0],
        }));
        // 底座侧边阴影（立体感）
        this.group.add(new Konva.Rect({
            x: b.x, y: b.y+b.h*0.75, width: b.w, height: b.h*0.25,
            fill: 'rgba(0,0,0,0.25)', cornerRadius: [0,0,b.rx,b.rx],
        }));
    }

    // ── 螺钉 ─────────────────────────────────
    _drawScrews() {
        // 底座上两颗固定螺钉（参考图片位置）
        const b = this._base;
        const screwPositions = [
            { x: this._postL.x + this._postL.w/2, y: b.y + b.h*0.50 },
            { x: this._postR.x + this._postR.w/2, y: b.y + b.h*0.50 },
        ];
        screwPositions.forEach(({ x, y }) => {
            const r = this.width * 0.030;
            // 螺钉外圈
            this.group.add(new Konva.Circle({ x, y, radius: r, fill: '#888', stroke: '#555', strokeWidth: 0.8 }));
            // 一字槽
            this.group.add(new Konva.Line({ points:[x-r*0.6,y, x+r*0.6,y], stroke:'#444', strokeWidth: 1.2, lineCap:'round' }));
            this.group.add(new Konva.Line({ points:[x,y-r*0.6, x,y+r*0.6], stroke:'#444', strokeWidth: 1.2, lineCap:'round' }));
        });
    }

    // ── 左柱（转轴柱）────────────────────────
    _drawPostLeft() {
        this._drawPost(this._postL, true);
    }

    // ── 右柱（夹口柱）────────────────────────
    _drawPostRight() {
        this._drawPost(this._postR, false);
        // 右柱夹口槽（合闸时刀片插入此处）
        const p  = this._postR;
        const sx = p.x + p.w*0.15;
        const sy = p.y + 2;
        const sw = p.w * 0.70;
        const sh = p.h * 0.18;
        this._clampSlot = new Konva.Rect({
            x: sx, y: sy, width: sw, height: sh,
            fill: '#1a1a1a', stroke: '#555', strokeWidth: 0.5,
            cornerRadius: 1,
        });
        this.group.add(this._clampSlot);
    }

    _drawPost(p, isLeft) {
        // 立柱主体（黄铜色）
        const brass = new Konva.Rect({
            x: p.x, y: p.y, width: p.w, height: p.h,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: p.w, y: 0 },
            fillLinearGradientColorStops: [
                0,   '#7a6a30',
                0.25,'#c8a84b',
                0.55,'#e8c86a',
                0.80,'#b89040',
                1,   '#7a6a30',
            ],
            stroke: '#6a5a28', strokeWidth: 1,
            cornerRadius: 2,
        });
        this.group.add(brass);
        // 立柱顶部横档（绕线固定台）
        this.group.add(new Konva.Rect({
            x: p.x - p.w*0.15, y: p.y,
            width: p.w*1.30, height: p.h*0.14,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: p.w*1.30, y: 0 },
            fillLinearGradientColorStops: [0,'#8a7030',0.5,'#d4aa52',1,'#8a7030'],
            stroke: '#6a5a28', strokeWidth: 0.8, cornerRadius: 2,
        }));
        // 接线螺柱（柱底）
        const termY = p.y + p.h - p.h*0.04;
        this.group.add(new Konva.Rect({
            x: p.x+p.w*0.10, y: termY,
            width: p.w*0.80, height: p.h*0.10,
            fill: '#b8982a', stroke: '#8a7020', strokeWidth: 0.8, cornerRadius: 1,
        }));
        // 立柱高光
        this.group.add(new Konva.Line({
            points: [p.x+p.w*0.30, p.y+4, p.x+p.w*0.30, p.y+p.h-8],
            stroke: 'rgba(255,255,255,0.18)', strokeWidth: 2, lineCap: 'round',
        }));
    }

    // ── 动态层：刀片 + 手柄 ──────────────────
    _drawContactLayer() {
        this._contactGroup = new Konva.Group();
        this.group.add(this._contactGroup);
        this._rebuildBlade();
    }

    _rebuildBlade() {
        this._contactGroup.destroyChildren();
        const angle  = this._bladeAngle;  // °，0=水平，45=抬起
        const aRad   = -angle * Math.PI / 180; // 负号：向上为负角
        const px     = this._pivotX;
        const py     = this._pivotY;
        const bLen   = this._bladeLen;
        const bW     = this._bladeW;
        const hLen   = this._handleLen;
        const hW     = this._handleW;
        const closed = angle < 5;

        // ── 刀片（黄铜扁条）──
        // 以转轴为原点，沿 x 轴正方向绘制，然后旋转
        const blade = new Konva.Rect({
            x: 0, y: -bW/2,
            width: bLen - hLen, height: bW,
            fillLinearGradientStartPoint: { x: 0, y: -bW/2 },
            fillLinearGradientEndPoint:   { x: 0, y: bW/2 },
            fillLinearGradientColorStops: [
                0,   '#8a7530',
                0.3, '#d4b050',
                0.55,'#f0cc68',
                0.75,'#c4a040',
                1,   '#8a7530',
            ],
            stroke: '#7a6528', strokeWidth: 0.8,
            cornerRadius: [2, 0, 0, 2],
        });

        // ── 手柄（红色绝缘柄）──
        const handle = new Konva.Rect({
            x: bLen - hLen, y: -hW/2,
            width: hLen, height: hW,
            fill: '#c8220a',
            stroke: '#8a1506', strokeWidth: 0.8,
            cornerRadius: [0, 6, 6, 0],
            shadowColor: '#600', shadowBlur: 3, shadowOpacity: 0.4,
        });
        // 手柄高光
        const handleHL = new Konva.Rect({
            x: bLen - hLen + 4, y: -hW/2 + 2,
            width: hLen - 8, height: hW*0.30,
            fill: 'rgba(255,255,255,0.15)',
            cornerRadius: [0, 4, 0, 0],
        });
        // 手柄末端圆帽
        const endCap = new Konva.Circle({
            x: bLen - hLen/8, y: 0,
            radius: hW*0.52,
            fill: '#b01a06', stroke: '#8a1506', strokeWidth: 0.8,
        });

        // ── 刀片根部固定块（与左柱连接）──
        const root = new Konva.Rect({
            x: -bW*0.3, y: -bW*0.9,
            width: bW*1.6, height: bW*1.8,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: bW*1.6, y: 0 },
            fillLinearGradientColorStops: [0,'#7a6528',0.5,'#d4b050',1,'#7a6528'],
            stroke: '#6a5520', strokeWidth: 0.8, cornerRadius: 2,
        });

        // ── 导通状态发光（合闸时刀片发橙光）──
        if (closed) {
            this._contactGroup.add(new Konva.Rect({
                x: -2, y: -bW/2 - 3,
                width: bLen - hLen + 4, height: bW + 6,
                fill: 'rgba(255,160,30,0.18)',
                cornerRadius: 3,
            }));
        }

        // 组装（以转轴为旋转中心）
        const g = new Konva.Group({ x: px, y: py, rotation: angle * (-1) });
        g.add(blade, handle, handleHL, endCap, root);
        this._contactGroup.add(g);

        // ── 电弧效果（分合闸瞬间）──
        if (this._animating && Math.abs(this._bladeAngle - (this._closed ? 0 : 45)) < 15) {
            this._drawArcEffect(px, py, aRad);
        }

        // ── 右柱夹口高亮（合闸时）──
        if (closed) {
            const p  = this._postR;
            this._contactGroup.add(new Konva.Rect({
                x: p.x+p.w*0.05, y: p.y,
                width: p.w*0.90, height: p.h*0.20,
                fill: 'rgba(255,160,30,0.28)', cornerRadius: 2,
            }));
        }
    }

    _drawArcEffect(px, py, aRad) {
        for (let i = 0; i < 3; i++) {
            const spread = (Math.random()-0.5)*this._bladeW*3;
            this._contactGroup.add(new Konva.Line({
                points: [
                    px + 4, py + spread*0.3,
                    px + this._bladeLen*0.30 + Math.random()*8, py + spread,
                    px + this._bladeLen*0.45, py + spread*0.5,
                ],
                stroke: `rgba(255,${180+Math.round(Math.random()*75)},60,${0.5+Math.random()*0.4})`,
                strokeWidth: 1 + Math.random(),
                lineJoin: 'round', lineCap: 'round',
            }));
        }
    }

    // ── 标注 ─────────────────────────────────
    _drawLabel() {
        // 位号
        this.group.add(new Konva.Text({
            x: 0, y: -16, width: this.width,
            text: `${this.label}  ${this.ratedVoltage}V / ${this.ratedCurrent}A`,
            fontSize: 9, fontStyle: 'bold', fill: '#546e7a', align: 'center',
        }));
        // 端子标注
        this.group.add(new Konva.Text({
            x: this._postL.x - 2, y: this._base.y + this._base.h + 5,
            text: 'A', fontSize: 8, fill: '#ef9a9a', fontStyle: 'bold',
        }));
        this.group.add(new Konva.Text({
            x: this._postR.x + this._postR.w - 8, y: this._base.y + this._base.h + 5,
            text: 'B', fontSize: 8, fill: '#90caf9', fontStyle: 'bold',
        }));
    }

    // ── 状态指示 ─────────────────────────────
    _drawStatusIndicator() {
        // 底座左下角小指示灯
        const ix = this._base.x + 8;
        const iy = this._base.y + this._base.h/2;
        this._statusDot = new Konva.Circle({
            x: ix, y: iy, radius: 4,
            fill: this._closed ? '#66bb6a' : '#ef5350',
            stroke: this._closed ? '#2e7d32' : '#c62828',
            strokeWidth: 0.8,
            shadowColor: this._closed ? '#66bb6a' : '#ef5350',
            shadowBlur: this._closed ? 5 : 2,
            shadowOpacity: 0.8,
        });
        this._statusText = new Konva.Text({
            x: ix + 7, y: iy - 5, text: this._closed ? '合' : '分',
            fontSize: 8, fontStyle: 'bold',
            fill: this._closed ? '#66bb6a' : '#ef5350',
        });
        this.group.add(this._statusDot, this._statusText);
    }

    // ── 点击触发动作 ─────────────────────────
    _bindInteraction() {
        // 手柄可点击
        this._contactGroup.on('click tap', () => this.toggle());
        this._contactGroup.listening(true);
    }

    // ═══════════════════════════════════════════
    _startAnimation() {
        this._bindInteraction();
        const tick = ts => {
            if (this._lastTs !== null) {
                const dt = Math.min((ts - this._lastTs) / 1000, 0.05);
                this._tickAnimation(dt);
            }
            this._lastTs = ts;
            this._animId = requestAnimationFrame(tick);
        };
        this._animId = requestAnimationFrame(tick);
    }

    _stopAnimation() {
        if (this._animId) { cancelAnimationFrame(this._animId); this._animId = null; }
    }

    _tickAnimation(dt) {
        if (!this._animating) return;

        this._animT += dt / this._animDur;
        if (this._animT >= 1) {
            this._animT   = 1;
            this._animating = false;
            this._closed   = this._animDir > 0;
        }

        // 正弦缓动（ease in-out）
        const ease = 0.5 - 0.5 * Math.cos(this._animT * Math.PI);
        // 角度：分闸=45°，合闸=0°
        if (this._animDir > 0) {
            this._bladeAngle = 45 * (1 - ease);  // 45° → 0°（合闸）
        } else {
            this._bladeAngle = 45 * ease;          // 0° → 45°（分闸）
        }

        this._rebuildBlade();
        this._updateStatus();
        this._refreshCache();
    }

    _updateStatus() {
        const c = this._closed || (this._animating && this._animDir > 0 && this._bladeAngle < 15);
        if (this._statusDot) {
            this._statusDot.fill(c ? '#66bb6a' : '#ef5350');
            this._statusDot.stroke(c ? '#2e7d32' : '#c62828');
            this._statusDot.shadowColor(c ? '#66bb6a' : '#ef5350');
            this._statusDot.shadowBlur(c ? 5 : 2);
        }
        if (this._statusText) {
            this._statusText.text(c ? '合' : '分');
            this._statusText.fill(c ? '#66bb6a' : '#ef5350');
        }
    }

    // ═══════════════════════════════════════════
    /** 切换开关状态 */
    toggle() {
        if (this._animating) return;
        this._animDir   = this._closed ? -1 : 1;
        this._animT     = 0;
        this._animating = true;
        this.opsCount++;
        this._refreshCache();
    }

    /** 合闸 */
    close() {
        if (this._closed || this._animating) return;
        this._animDir   = 1;
        this._animT     = 0;
        this._animating = true;
        this.opsCount++;
        this._refreshCache();
    }

    /** 分闸 */
    open() {
        if (!this._closed || this._animating) return;
        this._animDir   = -1;
        this._animT     = 0;
        this._animating = true;
        this.opsCount++;
        this._refreshCache();
    }

    /** 查询当前状态 */
    isClosed()    { return this._closed; }
    isAnimating() { return this._animating; }
    getOpsCount() { return this.opsCount; }

    update(state) {
        if (typeof state === 'boolean') {
            state ? this.close() : this.open();
        }
        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label: '位号/名称',       key: 'label',         type: 'text'   },
            { label: '额定电压 (V)',     key: 'ratedVoltage',  type: 'number' },
            { label: '额定电流 (A)',     key: 'ratedCurrent',  type: 'number' },
            { label: '初始状态（合=1）', key: 'initClosed',    type: 'number' },
            { label: '动作时间 (s)',     key: 'animDur',       type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        this.label        = cfg.label        || this.label;
        this.ratedVoltage = parseFloat(cfg.ratedVoltage) || this.ratedVoltage;
        this.ratedCurrent = parseFloat(cfg.ratedCurrent) || this.ratedCurrent;
        this._animDur     = parseFloat(cfg.animDur)      || this._animDur;
        if (cfg.initClosed !== undefined) {
            const wantClosed = !!parseInt(cfg.initClosed);
            if (wantClosed !== this._closed) this.toggle();
        }
        this.config = { ...this.config, ...cfg };
        this._refreshCache();
    }

    destroy() { this._stopAnimation(); super.destroy?.(); }
}