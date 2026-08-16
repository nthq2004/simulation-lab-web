import { BaseComponent } from './BaseComponent.js';

/**
 * 停止按钮（Stop Push Button）仿真组件
 *
 * ═══ 渲染优化原则 ═══════════════════════════════════════════
 *  1. 动态元素（按钮帽压下量、触桥位移、弹簧压缩、接触高光）
 *     全部使用 in-place 更新，不重建节点
 *  2. 消除所有 shadow 属性，避免离屏阴影渲染
 *  3. 静态部件（面板外框、底座、接线柱、铭牌）仅 init 时缓存
 *  4. 断开电弧在独立 _arcGroup 中重建，不干扰主体节点
 * ═══════════════════════════════════════════════════════════
 *
 * ── 与起动按钮的核心区别 ──────────────────────────────────
 *  1. 按钮帽：红色（停止色），帽沿深红
 *  2. 触点类型：常闭（NC）— 弹起=闭合（通路），按下=断开（断路）
 *  3. IEC 电路符号：NC 常闭触点符号
 *       静触头横线（上方）+ 触桥斜线带斜头（常闭标记）
 *       弹起：触桥右端紧贴静触头（闭合，红色高光）
 *       按下：触桥右端旋转下落，远离静触头（断开，间隙可见）
 *  4. 端子编号：3（上）/ 4（下），IEC 停止按钮标准编号
 *  5. 颜色主题：红色系（#e03020 主色，深红边框）
 *
 * ── 左半区：按钮实体仿真（侧视截面图）─────────────────────
 *
 *  安装面板（灰色铁板，带圆形开孔）
 *  │
 *  ├─ 按钮帽（红色圆顶，蘑菇形）
 *  │    • 静止：凸出面板（弹起状态，NC 触点闭合）
 *  │    • 按下：帽顶下沉约 8px（NC 触点断开）
 *  │    • 圆顶高光：左上角白色弧形（立体感）
 *  │    • 帽沿：深红色环形边缘
 *  │
 *  ├─ 按钮柄（圆柱，连接帽与触点机构）
 *  │    • 随按钮帽同步向下位移
 *  │
 *  ├─ 复位弹簧（线圈弹簧，按下时压缩，松开时伸展）
 *  │    • 动态绘制锯齿弹簧线
 *  │    • 按下时弹簧压缩（匝间距缩小，颜色变蓝受力色）
 *  │
 *  ├─ 触点机构（底座内，截面图）
 *  │    NC 常闭触点 × 1组（红色）：
 *  │      上静触头（固定）
 *  │      可动触桥（弹起=桥与两端静触头接触=闭合；
 *  │               按下=桥上移偏离下静触头=断开）
 *  │      下静触头（固定）
 *  │    弹起时：触桥居中，上下均接触 → 闭合（红色高光）
 *  │    按下时：触桥上抬，脱离下静触头 → 断开（间隙可见）
 *  │
 *  └─ 底座（深色绝缘塑料）
 *       接线柱 3、4（常闭）
 *
 * ── 右半区：电路原理图（IEC 60617）──────────────────────
 *
 *  ┌─ 常闭（NC）触点符号 ─────────────────────────────────┐
 *  │  端子 3（上）、端子 4（下）                           │
 *  │  上静触头横线（固定端，带斜头常闭标记）               │
 *  │  可动触桥斜线：                                       │
 *  │    • 弹起：斜线右端紧贴静触头 → 闭合（红色高光）      │
 *  │    • 按下：斜线右端向下旋转脱离 → 断开（间隙标注）    │
 *  │  断开过程：触桥从闭合位逐渐旋转至断开位（约25°）      │
 *  │  操作线（斜箭头 + 横线，IEC 手动按压操作符号）         │
 *  └──────────────────────────────────────────────────────┘
 *
 *  联动线：按钮柄底端 → 原理图触桥锚点，虚线表示机械联动
 *
 * ── 状态机 ────────────────────────────────────────────────
 *  'idle'    → 弹起，NC 闭合（正常停止回路通路）
 *  'pressed' → 按下，NC 断开（触发停止信号）
 *
 *  • mousedown/touchstart → pressed（NC 断开）
 *  • mouseup/touchend     → idle（NC 重新闭合）
 *  • 动画：按下 0.06s，弹起 0.10s，正弦缓动
 *
 * ── 端口 ─────────────────────────────────────────────────
 *  nc3  — NC 常闭端子 3（上）
 *  nc4  — NC 常闭端子 4（下）
 *
 * ── 可配置参数 ────────────────────────────────────────────
 *  label       : 位号（默认 'SB'）
 *  buttonText  : 铭牌文字（默认 '停止'）
 *  pressTravel : 按下行程 px（默认 8）
 *  pressTime   : 按下动画时间 s（默认 0.06）
 *  releaseTime : 弹起动画时间 s（默认 0.10）
 */
export class StopButton extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(240, config.width  || 300);
        this.height = Math.max(180, config.height || 220);

        this.type    = 'PUSHBUTTON';
        this.special = 'STOP-BTN';
        this.cache   = 'fixed';

        // 颜色主题（红色）
        this._btnColor   = '#e03020';
        this._btnColorHi = '#f85040';
        this._btnColorLo = '#801808';
        this._btnColorMd = '#c02010';
        this._btnColorRm = '#601008';
        this._themeColor = '#e03020';
        this._themeGlow  = 'rgba(240,60,40,0.35)';
        this._themeWire  = '#e03020';

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        this.config = {
            id: this.id,
            label:       this.label,
            buttonText:  this.buttonText,
            pressTravel: this._pressTravel,
            pressTime:   this._pressTime,
            releaseTime: this._releaseTime,
        };

        // ── 端口 ─────────────────────────────────
        this.addPort(this._ncPortA.x, this._ncPortA.y, 'nc3', 'wire');
        this.addPort(this._ncPortB.x, this._ncPortB.y, 'nc4', 'wire', 'p');
    }

    // ═══════════════════════════════════════════
    // 几何尺寸计算
    // ═══════════════════════════════════════════

    _recalcGeometry() {
        const W = this.width, H = this.height;

        this._divX  = W * 0.48;
        this._frame = { x: 2, y: 2, w: W - 4, h: H - 4, rx: 6 };

        // ══ 左侧：按钮实体区 ═══════════════════════
        const LP  = 10;
        const LW  = this._divX - LP * 2;
        const LCX = LP + LW / 2;

        // 安装面板
        const panelTop = H * 0.22;
        const panelH   = H * 0.14;
        this._panelRect = {
            x: LP + LW * 0.10, y: panelTop,
            w: LW * 0.80, h: panelH, rx: 3,
        };
        this._panelHoleR  = Math.max(10, LW * 0.22);
        this._panelHoleCX = LCX;
        this._panelHoleCY = panelTop + panelH / 2;

        // 按钮帽
        this._btnCapR     = this._panelHoleR - 1;
        this._btnCapBaseY = this._panelHoleCY;

        // 按钮柄
        this._stemW   = this._btnCapR * 0.55;
        this._stemTop = this._panelHoleCY + this._btnCapR * 0.40;
        this._stemBot = panelTop + panelH + H * 0.10;

        // 底座
        const baseTop = this._stemBot + H * 0.04;
        const baseH   = H * 0.28;
        this._baseRect = {
            x: LP + LW * 0.06, y: baseTop,
            w: LW * 0.88, h: baseH, rx: 4,
        };

        // NC 触点（底座内）
        // NC: 弹起=闭合，按下=断开（触桥上抬脱离下静触头）
        const ncStaticTopY = baseTop + baseH * 0.22;
        const ncStaticBotY = baseTop + baseH * 0.78;
        const ncMidY       = (ncStaticTopY + ncStaticBotY) / 2;
        this._ncStaticTopY = ncStaticTopY;
        this._ncStaticBotY = ncStaticBotY;
        this._ncMidY       = ncMidY;
        this._ncTouchW     = LW * 0.35;
        this._ncTouchCX    = LCX;

        // NC 触桥：弹起(ratio=0)=居中(闭合), 按下(ratio=1)=上抬(断开)
        // 上抬量：使触桥脱离下静触头
        this._bridgeOpenDY = -(H * 0.07);   // 按下时触桥上移量（负=向上）

        // 弹簧区域
        this._springTopY = this._stemBot;
        this._springBotY = baseTop;
        this._springCX   = LCX;

        // 接线柱
        const termY = baseTop + baseH + 10;
        this._leftTermPos  = { x: LP + LW * 0.28, y: termY };
        this._rightTermPos = { x: LP + LW * 0.72, y: termY };

        // ══ 右侧：原理图区 ═════════════════════════
        const RP  = 10;
        const RX  = this._divX + RP;
        const RW  = W - this._divX - RP * 2;
        const RCX = RX + RW / 2;

        this._schTerm3Y   = H * 0.10 + (H * 0.78) * 0.18;
        this._schTerm4Y   = H * 0.10 + (H * 0.78) * 0.82;
        this._schCX       = RCX;

        // NC 符号静触头（端子 3 下方）
        this._schStaticY      = this._schTerm3Y + (this._schTerm4Y - this._schTerm3Y) * 0.30;
        // 触桥锚点 Y（左锚点固定）
        this._schBridgeBaseY  = this._schStaticY + (this._schTerm4Y - this._schStaticY) * 0.50;

        // 角度定义（NC 触桥，弹起=闭合，按下=断开）
        // 闭合角度：右端正好接触静触头横线
        // 断开角度：右端旋转向下离开（顺时针，angle 正值增大）
        this._schAngleClosed = -58 * Math.PI / 180;  // 闭合（弹起时）
        this._schAngleOpen   = -35 * Math.PI / 180;  // 断开（按下时，右端下落）

        // 操作符号位置
        this._schOpX = RCX - RW * 0.30;
        this._schOpY = this._schStaticY - 10;

        // 端口
        this._ncPortA = { x: RCX, y: 2 };
        this._ncPortB = { x: RCX, y: H - 2 };

        this._termR = Math.max(3.5, W * 0.014);
    }

    // ═══════════════════════════════════════════
    // 参数初始化
    // ═══════════════════════════════════════════

    _initParameters(config) {
        this.label       = config.label      || 'SB';
        this.buttonText  = config.buttonText || '停止';
        this.function    = config.function   || '停止按钮';

        this._pressTravel  = config.pressTravel  !== undefined ? config.pressTravel  : 8;
        this._pressTime    = config.pressTime    !== undefined ? config.pressTime    : 0.06;
        this._releaseTime  = config.releaseTime  !== undefined ? config.releaseTime  : 0.10;

        this._state       = 'idle';
        this._animating   = false;
        this._animT       = 0;
        this._animDur     = this._releaseTime;
        this._pressRatio  = 0;    // 0=完全弹起(NC闭合), 1=完全按下(NC断开)
        this._pressFrom   = 0;
        this._pressTo     = 0;
        this._animJustEnded = false;
        this._pointerDown   = false;
        this._arcFrames     = 0;

        this.opsCount = config.initOps || 0;
    }

    // ═══════════════════════════════════════════
    // 主初始化
    // ═══════════════════════════════════════════

    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
    }

    // ═══════════════════════════════════════════
    // 静态部件
    // ═══════════════════════════════════════════

    _drawStaticParts() {
        this._drawFrame();
        this._drawDivider();
        this._drawPanel();
        this._drawBase();
        this._drawStaticContacts();
        this._drawTerminals();
        this._drawSchematicStatic();
        this._drawPanelLabel();
    }

    _drawFrame() {
        const f = this._frame;
        this._staticGroup.add(new Konva.Rect({
            x: f.x, y: f.y, width: f.w, height: f.h,
            fill: '#e2dee8', stroke: '#b0a8a0', strokeWidth: 1.5, cornerRadius: f.rx,
        }));
        // 顶部红色色条
        this._staticGroup.add(new Konva.Rect({
            x: f.x + 2, y: f.y + 2, width: f.w - 4, height: f.h * 0.065,
            fill: 'rgba(200,40,20,0.20)', cornerRadius: [f.rx, f.rx, 0, 0],
        }));
        this._staticGroup.add(new Konva.Text({
            x: f.x + 4, y: f.y - 15,
            text: this.function,
            fontSize: Math.max(11, this.width * 0.030), fill: '#5a6a7a',
        }));
        // 左侧深色背景
        this._staticGroup.add(new Konva.Rect({
            x: f.x + 2, y: f.y + 2,
            width: this._divX - f.x - 2, height: f.h - 4,
            fill: '#2a2e3a', cornerRadius: [f.rx, 0, 0, f.rx],
        }));
    }

    _drawDivider() {
        this._staticGroup.add(new Konva.Line({
            points: [this._divX, this._frame.y + 8, this._divX, this._frame.y + this._frame.h - 8],
            stroke: '#8090a8', strokeWidth: 1.2, dash: [5, 3],
        }));
        const fs = Math.max(8, this.width * 0.020);
        this._staticGroup.add(new Konva.Text({
            x: 12, y: this._frame.y + 5,
            text: '按钮实体（侧视截面）', fontSize: fs, fill: '#90a8c0',
        }));
        this._staticGroup.add(new Konva.Text({
            x: this._divX + 6, y: this._frame.y + 5,
            text: '电路符号（IEC 60617）', fontSize: fs, fill: '#7a8898',
        }));
    }

    /** 安装面板（带开孔） */
    _drawPanel() {
        const r  = this._panelRect;
        const hR = this._panelHoleR;
        const hX = this._panelHoleCX;
        const hY = this._panelHoleCY;

        // 面板主体（挖圆孔）
        this._staticGroup.add(new Konva.Shape({
            sceneFunc(ctx, shape) {
                ctx.beginPath();
                ctx.moveTo(r.x, r.y);
                ctx.lineTo(r.x + r.w, r.y);
                ctx.lineTo(r.x + r.w, r.y + r.h);
                ctx.lineTo(r.x, r.y + r.h);
                ctx.closePath();
                ctx.moveTo(hX + hR, hY);
                ctx.arc(hX, hY, hR, 0, Math.PI * 2, true);
                ctx.closePath();
                ctx.fillStrokeShape(shape);
            },
            fillLinearGradientStartPoint: { x: 0, y: r.y },
            fillLinearGradientEndPoint:   { x: 0, y: r.y + r.h },
            fillLinearGradientColorStops: [0, '#9098a8', 0.5, '#b0b8c8', 1, '#8090a0'],
            stroke: '#607080', strokeWidth: 1.2,
        }));

        // 安装螺纹环
        this._staticGroup.add(new Konva.Circle({
            x: hX, y: hY, radius: hR + 3,
            fill: 'none', stroke: '#c0c8d0', strokeWidth: 1.5,
        }));
        this._staticGroup.add(new Konva.Circle({
            x: hX, y: hY, radius: hR + 6,
            fill: 'none', stroke: '#8090a0', strokeWidth: 0.8,
        }));
    }

    /** 底座 */
    _drawBase() {
        const b = this._baseRect;
        this._staticGroup.add(new Konva.Rect({
            x: b.x, y: b.y, width: b.w, height: b.h,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: 0, y: b.h },
            fillLinearGradientColorStops: [0, '#3a3e4a', 0.5, '#484c5a', 1, '#363a46'],
            stroke: '#282c38', strokeWidth: 1.2, cornerRadius: b.rx,
        }));
        this._staticGroup.add(new Konva.Rect({
            x: b.x + 2, y: b.y + 2, width: b.w - 4, height: b.h * 0.12,
            fill: 'rgba(255,255,255,0.06)', cornerRadius: [b.rx, b.rx, 0, 0],
        }));
        const fs = Math.max(8, this.width * 0.022);
        this._staticGroup.add(new Konva.Text({
            x: b.x + 4, y: b.y + 4,
            text: 'NC', fontSize: fs, fontStyle: 'bold', fill: '#e03020',
        }));
    }

    /** 底座内静触头（上下各一根，固定） */
    _drawStaticContacts() {
        const cx  = this._ncTouchCX;
        const hw  = this._ncTouchW / 2 + 4;
        const C   = this._themeWire;

        // 上静触头
        this._staticGroup.add(new Konva.Line({
            points: [cx - hw, this._ncStaticTopY, cx + hw, this._ncStaticTopY],
            stroke: C, strokeWidth: 3, lineCap: 'round',
        }));
        // 下静触头
        this._staticGroup.add(new Konva.Line({
            points: [cx - hw, this._ncStaticBotY, cx + hw, this._ncStaticBotY],
            stroke: C, strokeWidth: 3, lineCap: 'round',
        }));
        // 静触头银点
        [this._ncStaticTopY, this._ncStaticBotY].forEach(sy => {
            this._staticGroup.add(new Konva.Circle({
                x: cx, y: sy, radius: 3.5,
                fill: '#d8d8e0', stroke: '#a0a0a8', strokeWidth: 0.8,
            }));
        });
    }

    /** 接线柱 */
    _drawTerminals() {
        const fs = Math.max(8, this.width * 0.022);
        const C  = this._themeWire;

        [
            { pos: this._leftTermPos,  name: '3' },
            { pos: this._rightTermPos, name: '4' },
        ].forEach(({ pos, name }) => {
            this._drawTermPost(pos, C);
            this._staticGroup.add(new Konva.Text({
                x: pos.x - 6, y: pos.y + this._termR + 2,
                text: name, fontSize: fs, fontStyle: 'bold', fill: C,
            }));
            this._staticGroup.add(new Konva.Line({
                points: [pos.x, pos.y - this._termR, pos.x, this._baseRect.y + this._baseRect.h],
                stroke: C, strokeWidth: 1.8,
            }));
        });

        // 底座内连线（至上下静触头）
        const C2 = this._themeWire;
        this._staticGroup.add(new Konva.Line({
            points: [
                this._leftTermPos.x, this._baseRect.y + this._baseRect.h,
                this._leftTermPos.x, this._ncStaticTopY,
                this._ncTouchCX - this._ncTouchW / 2 - 4, this._ncStaticTopY,
            ],
            stroke: C2, strokeWidth: 1.8, lineJoin: 'round',
        }));
        this._staticGroup.add(new Konva.Line({
            points: [
                this._rightTermPos.x, this._baseRect.y + this._baseRect.h,
                this._rightTermPos.x, this._ncStaticBotY,
                this._ncTouchCX + this._ncTouchW / 2 + 4, this._ncStaticBotY,
            ],
            stroke: C2, strokeWidth: 1.8, lineJoin: 'round',
        }));
    }

    _drawTermPost(pos, color) {
        const R = this._termR, { x, y } = pos;
        this._staticGroup.add(new Konva.Circle({
            x, y, radius: R,
            fillLinearGradientStartPoint: { x: -R, y: -R },
            fillLinearGradientEndPoint:   { x:  R, y:  R },
            fillLinearGradientColorStops: [0, '#7a6a30', 0.4, '#d4aa52', 0.7, '#e8c86a', 1, '#8a7030'],
            stroke: '#6a5a28', strokeWidth: 1,
        }));
        this._staticGroup.add(new Konva.Circle({
            x, y, radius: R * 0.38, fill: '#2a1a08', stroke: '#5a4a20', strokeWidth: 0.6,
        }));
    }

    /** 右侧原理图静态部件（NC 触点符号） */
    _drawSchematicStatic() {
        const px = this._schCX;
        const C  = this._themeWire;
        const fs = Math.max(9, this.width * 0.024);

        // 端子 3（上）
        this._drawTermPost({ x: px, y: this._schTerm3Y }, C);
        this._staticGroup.add(new Konva.Text({
            x: px - 6, y: this._schTerm3Y - this._termR - fs - 2,
            text: '3', fontSize: fs, fontStyle: 'bold', fill: C,
        }));
        this._staticGroup.add(new Konva.Line({
            points: [px, this._schTerm3Y - this._termR, px, 2],
            stroke: C, strokeWidth: 2.5,
        }));
        this._staticGroup.add(new Konva.Line({
            points: [px, this._schTerm3Y + this._termR, px, this._schStaticY],
            stroke: C, strokeWidth: 2,
        }));

        // 端子 4（下）
        this._drawTermPost({ x: px, y: this._schTerm4Y }, C);
        this._staticGroup.add(new Konva.Text({
            x: px - 6, y: this._schTerm4Y + this._termR + 2,
            text: '4', fontSize: fs, fontStyle: 'bold', fill: C,
        }));
        this._staticGroup.add(new Konva.Line({
            points: [px, this._schTerm4Y + this._termR, px, this.height - 2],
            stroke: C, strokeWidth: 2.5,
        }));
        this._staticGroup.add(new Konva.Line({
            points: [px, this._schBridgeBaseY + 12, px, this._schTerm4Y - this._termR],
            stroke: C, strokeWidth: 2,
        }));

        // 上静触头横线（NC 触点，上方固定端）
        this._staticGroup.add(new Konva.Line({
            points: [px - 12, this._schStaticY, px + 12, this._schStaticY],
            stroke: C, strokeWidth: 3, lineCap: 'round',
        }));

        // IEC 常闭符号附加斜线（常闭预压头，从静触头横线左上角斜向右下）
        // 表示触点在自然状态已经闭合（预压弹簧保持接触）
        this._staticGroup.add(new Konva.Line({
            points: [px - 12, this._schStaticY - 6, px + 8, this._schStaticY + 4],
            stroke: C, strokeWidth: 1.5, lineCap: 'round', opacity: 0.75,
        }));

        // "NC" 标注
        this._staticGroup.add(new Konva.Text({
            x: px + 16,
            y: (this._schStaticY + this._schBridgeBaseY) / 2 - 6,
            text: 'NC', fontSize: fs - 1, fontStyle: 'bold', fill: C,
        }));

        // IEC 操作机构符号（手动按压：横线 + 向下箭头）
        const opX = this._schOpX, opY = this._schOpY;
        this._staticGroup.add(new Konva.Line({
            points: [opX - 12, opY, opX + 12, opY],
            stroke: '#b08090', strokeWidth: 2, lineCap: 'round',
        }));
        this._staticGroup.add(new Konva.Line({
            points: [opX, opY, opX, opY + 10],
            stroke: '#b08090', strokeWidth: 2, lineCap: 'round',
        }));
        this._staticGroup.add(new Konva.Line({
            points: [opX - 4, opY + 6, opX, opY + 11, opX + 4, opY + 6],
            stroke: '#b08090', strokeWidth: 2, lineCap: 'round', lineJoin: 'round',
        }));
        // 操作线（从触桥到操作符号的虚线）
        this._staticGroup.add(new Konva.Line({
            points: [opX, opY + 11, px, this._schStaticY + 5],
            stroke: '#b08090', strokeWidth: 1.2, dash: [3, 3],
        }));
    }

    /** 铭牌 & 位号 */
    _drawPanelLabel() {
        const bR  = this._btnCapR;
        const bCY = this._btnCapBaseY;
        const fs  = Math.max(10, this.width * 0.028);

        // 铭牌背景（深红色）
        this._staticGroup.add(new Konva.Rect({
            x: this._panelHoleCX - bR * 1.2,
            y: bCY - bR - 28,
            width: bR * 2.4, height: 18, rx: 3,
            fill: '#401010', stroke: '#601818', strokeWidth: 1,
        }));
        this._staticGroup.add(new Konva.Text({
            x: this._panelHoleCX - bR * 1.2,
            y: bCY - bR - 26,
            width: bR * 2.4,
            text: this.buttonText,
            fontSize: fs - 1, fontStyle: 'bold', fill: '#ff6050', align: 'center',
        }));
        // 位号
        this._staticGroup.add(new Konva.Text({
            x: 12, y: this.height - 20,
            text: this.label,
            fontSize: Math.max(12, this.width * 0.032),
            fontStyle: 'bold', fill: '#e06050',
        }));
    }

    // ═══════════════════════════════════════════
    // 动态层
    // ═══════════════════════════════════════════

    _createDynamicNodes() {
        this._createButtonCap();
        this._createButtonStem();
        this._createSpring();
        this._createInternalBridge();
        this._createSchBridge();
        this._createLinkLine();
        this._createContactGlow();
        this._arcGroup = new Konva.Group({ listening: false });
        this._dynamicGroup.add(this._arcGroup);
    }

    /** 红色圆顶按钮帽 */
    _createButtonCap() {
        const r      = this._btnCapR;
        const px     = this._panelHoleCX;
        const travel = this._pressTravel;
        const cy     = this._btnCapBaseY - travel * (1 - this._pressRatio);

        this._btnCapBody = new Konva.Ellipse({
            x: px, y: cy,
            radiusX: r, radiusY: r * 0.52,
            fillLinearGradientStartPoint: { x: -r, y: -r * 0.52 },
            fillLinearGradientEndPoint:   { x:  r, y:  r * 0.52 },
            fillLinearGradientColorStops: [
                0,   '#f05040',
                0.20,'#ff6850',
                0.50,'#e03020',
                0.78,'#b01808',
                1,   '#801008',
            ],
            stroke: '#601008', strokeWidth: 1.5,
        });
        this._dynamicGroup.add(this._btnCapBody);

        // 帽沿（深红色环）
        this._btnCapRim = new Konva.Ellipse({
            x: px, y: this._panelHoleCY,
            radiusX: r + 1, radiusY: r * 0.20,
            fillLinearGradientStartPoint: { x: -r, y: 0 },
            fillLinearGradientEndPoint:   { x:  r, y: 0 },
            fillLinearGradientColorStops: [0, '#400808', 0.5, '#601010', 1, '#400808'],
            stroke: '#300808', strokeWidth: 1,
        });
        this._dynamicGroup.add(this._btnCapRim);

        // 帽顶高光（左上角弧形）
        this._btnCapHighlight = new Konva.Arc({
            x: px - r * 0.25, y: cy - r * 0.15,
            innerRadius: r * 0.30, outerRadius: r * 0.50,
            angle: 140, rotation: -130,
            fill: 'rgba(255,255,255,0.28)',
            listening: false,
        });
        this._dynamicGroup.add(this._btnCapHighlight);

        // 帽顶停止图标
        this._btnCapIcon = new Konva.Rect({
            x: px - r * 0.28, y: cy - r * 0.28,
            width: r * 0.56, height: r * 0.56,
            fill: 'rgba(40,0,0,0.35)',
            cornerRadius: 2, listening: false,
        });
        this._dynamicGroup.add(this._btnCapIcon);

        this._btnCapCY_base = this._btnCapBaseY;
    }

    /** 按钮柄 */
    _createButtonStem() {
        const px     = this._panelHoleCX;
        const sw     = this._stemW;
        const travel = this._pressTravel;

        this._btnStem = new Konva.Rect({
            x: px - sw / 2,
            y: this._stemTop - travel * (1 - this._pressRatio),
            width: sw,
            height: this._stemBot - this._stemTop,
            fillLinearGradientStartPoint: { x: -sw / 2, y: 0 },
            fillLinearGradientEndPoint:   { x:  sw / 2, y: 0 },
            fillLinearGradientColorStops: [0, '#404850', 0.4, '#6a7080', 0.6, '#585e68', 1, '#404850'],
            stroke: '#303840', strokeWidth: 0.8,
            cornerRadius: 2, listening: false,
        });
        this._dynamicGroup.add(this._btnStem);

        this._btnStemBottom = new Konva.Ellipse({
            x: px,
            y: this._stemBot - travel * (1 - this._pressRatio),
            radiusX: sw * 0.90, radiusY: sw * 0.35,
            fill: '#6a7080', stroke: '#404850', strokeWidth: 0.8,
            listening: false,
        });
        this._dynamicGroup.add(this._btnStemBottom);
    }

    /** 复位弹簧 */
    _createSpring() {
        const travel = this._pressTravel;
        const topY   = this._springTopY - travel * (1 - this._pressRatio);
        const botY   = this._springBotY;

        this._springLine = new Konva.Line({
            points: this._makeSpringPoints(this._springCX, topY, botY),
            stroke: '#7090b0', strokeWidth: 1.5,
            lineCap: 'round', lineJoin: 'round', listening: false,
        });
        this._dynamicGroup.add(this._springLine);
    }

    _makeSpringPoints(cx, topY, botY) {
        const span = botY - topY;
        if (span <= 0) return [cx, topY, cx, botY];
        const pts  = [cx, topY];
        const amp  = Math.max(3, span * 0.12);
        const turns = 7;
        for (let i = 0; i <= turns * 2; i++) {
            const t = i / (turns * 2);
            pts.push(cx + (i % 2 === 0 ? amp : -amp), topY + t * span);
        }
        pts.push(cx, botY);
        return pts;
    }

    /**
     * 底座内可动触桥（NC 型）
     * ratio=0 弹起：触桥居中，接触上下静触头 → 闭合
     * ratio=1 按下：触桥上抬，脱离下静触头  → 断开
     */
    _createInternalBridge() {
        const cx    = this._ncTouchCX;
        const bw    = this._ncTouchW;
        const bh    = 6;
        // NC 逻辑：弹起(ratio=0)=居中闭合，按下(ratio=1)=上移断开
        const midY  = this._ncMidY + this._bridgeOpenDY * this._pressRatio;

        this._internalBridge = new Konva.Rect({
            x: cx - bw / 2, y: midY - bh / 2,
            width: bw, height: bh,
            fillLinearGradientStartPoint: { x: -bw / 2, y: 0 },
            fillLinearGradientEndPoint:   { x:  bw / 2, y: 0 },
            fillLinearGradientColorStops: [0, '#8a7030', 0.3, '#d4a848', 0.6, '#f0c860', 1, '#8a7030'],
            stroke: '#7a6028', strokeWidth: 0.8, cornerRadius: 2, listening: false,
        });
        this._dynamicGroup.add(this._internalBridge);

        this._internalContactTop = new Konva.Circle({
            x: cx, y: midY - bh / 2,
            radius: 3.5, fill: '#e0e0e8', stroke: '#a0a0a8', strokeWidth: 0.8,
            listening: false,
        });
        this._internalContactBot = new Konva.Circle({
            x: cx, y: midY + bh / 2,
            radius: 3.5, fill: '#e0e0e8', stroke: '#a0a0a8', strokeWidth: 0.8,
            listening: false,
        });
        this._dynamicGroup.add(this._internalContactTop);
        this._dynamicGroup.add(this._internalContactBot);

        // 断开间隙标注线（底部间隙，ratio>0 时显示）
        this._intGapLine = new Konva.Line({
            points: [cx - 10, midY + bh / 2, cx + 10, midY + bh / 2,
                     cx,     this._ncStaticBotY],
            stroke: 'rgba(220,60,40,0.45)', strokeWidth: 1, dash: [2, 3],
            visible: this._pressRatio > 0.10, listening: false,
        });
        this._dynamicGroup.add(this._intGapLine);
    }

    /**
     * 原理图 NC 触桥
     * ratio=0：闭合角度（触桥右端贴合静触头）
     * ratio=1：断开角度（触桥右端旋转下落，脱离静触头）
     *
     * NC 触桥与 NO 触桥的旋转方向相同（右端均从上→下）
     * 但 NC 初始状态是"闭合"（右端在上，贴近静触头）
     * 按下时右端下落→断开（ratio 从 0 增大到 1）
     */
    _createSchBridge() {
        const px = this._schCX;

        const anchorX = px - 18;
        const anchorY = this._schBridgeBaseY;
        const bLen    = 36;

        this._schAnchorX   = anchorX;
        this._schAnchorY   = anchorY;
        this._schBridgeLen = bLen;

        // 当前角度（ratio=0 → 闭合角，ratio=1 → 断开角）
        const angle = this._schAngleClosed
            + (this._schAngleOpen - this._schAngleClosed) * this._pressRatio;
        const rx = anchorX + bLen * Math.cos(angle);
        const ry = anchorY + bLen * Math.sin(angle);

        // 可动触桥线（红色）
        this._schBridgeLine = new Konva.Line({
            points: [anchorX, anchorY, rx, ry],
            stroke: this._themeWire, strokeWidth: 3, lineCap: 'round',
        });
        this._dynamicGroup.add(this._schBridgeLine);

        // 左锚点铰链圆
        this._schAnchorCircle = new Konva.Circle({
            x: anchorX, y: anchorY, radius: 4,
            fill: '#901010', stroke: '#600808', strokeWidth: 1,
        });
        this._dynamicGroup.add(this._schAnchorCircle);

        // 右端接触点
        this._schBridgeEnd = new Konva.Circle({
            x: rx, y: ry, radius: 4,
            fill: '#e8d0d0', stroke: '#a06060', strokeWidth: 0.8,
        });
        this._dynamicGroup.add(this._schBridgeEnd);

        // 断开间隙虚线（按下=断开时显示）
        this._schGapLine = new Konva.Line({
            points: [rx, ry, px, this._schStaticY],
            stroke: 'rgba(220,60,40,0.50)',
            strokeWidth: 1.2, dash: [3, 3],
            visible: this._pressRatio > 0.10, listening: false,
        });
        this._dynamicGroup.add(this._schGapLine);

        // 断开状态标注
        this._schGapText = new Konva.Text({
            x: px + 16, y: (this._schStaticY + ry) / 2 - 6,
            text: '断开',
            fontSize: Math.max(8, this.width * 0.020),
            fill: 'rgba(220,60,40,0.75)',
            visible: this._pressRatio > 0.45, listening: false,
        });
        this._dynamicGroup.add(this._schGapText);

        // 闭合状态标注
        this._schClosedText = new Konva.Text({
            x: px + 16, y: this._schStaticY - 8,
            text: '闭合',
            fontSize: Math.max(8, this.width * 0.020),
            fill: 'rgba(220,60,40,0.75)',
            visible: this._pressRatio < 0.10, listening: false,
        });
        this._dynamicGroup.add(this._schClosedText);
    }

    /** 联动虚线 */
    _createLinkLine() {
        const travel   = this._pressTravel;
        const stemBotY = this._stemBot - travel * (1 - this._pressRatio);

        this._linkLine = new Konva.Line({
            points: [this._panelHoleCX, stemBotY, this._schAnchorX, this._schAnchorY],
            stroke: 'rgba(200,80,60,0.35)', strokeWidth: 1.2,
            dash: [5, 4], lineCap: 'round', listening: false,
        });
        this._dynamicGroup.add(this._linkLine);
    }

    /** 接触高光（NC 弹起=闭合时显示） */
    _createContactGlow() {
        const px = this._schCX;

        // 原理图侧（闭合时红色高光）
        this._schGlow = new Konva.Circle({
            x: px, y: this._schStaticY,
            radius: 8, fill: 'rgba(240,60,40,0.35)',
            visible: this._pressRatio < 0.15, listening: false,
        });
        this._dynamicGroup.add(this._schGlow);

        // 内部触点侧（闭合时显示）
        this._intGlow = new Konva.Circle({
            x: this._ncTouchCX, y: this._ncMidY,
            radius: 10, fill: 'rgba(240,60,40,0.22)',
            visible: this._pressRatio < 0.15, listening: false,
        });
        this._dynamicGroup.add(this._intGlow);
    }

    // ═══════════════════════════════════════════
    // 动态更新（每帧 in-place）
    // ═══════════════════════════════════════════

    _updateDynamic() {
        const ratio  = this._pressRatio;
        const travel = this._pressTravel;

        // 1) 按钮帽（按下时下沉）
        const capCY = this._btnCapCY_base - travel * (1 - ratio);
        this._btnCapBody.y(capCY);
        this._btnCapHighlight.x(this._panelHoleCX - this._btnCapR * 0.25);
        this._btnCapHighlight.y(capCY - this._btnCapR * 0.15);
        this._btnCapIcon.x(this._panelHoleCX - this._btnCapR * 0.28);
        this._btnCapIcon.y(capCY - this._btnCapR * 0.28);

        // 按下时帽色变深
        const dk = 1 - ratio * 0.22;
        this._btnCapBody.fillLinearGradientColorStops([
            0,   `rgba(${Math.round(240*dk)},${Math.round(80*dk)},${Math.round(64*dk)},1)`,
            0.20,`rgba(${Math.round(255*dk)},${Math.round(104*dk)},${Math.round(80*dk)},1)`,
            0.50,`rgba(${Math.round(224*dk)},${Math.round(48*dk)},${Math.round(32*dk)},1)`,
            0.78,`rgba(${Math.round(176*dk)},${Math.round(24*dk)},${Math.round(8*dk)},1)`,
            1,   `rgba(${Math.round(128*dk)},${Math.round(16*dk)},${Math.round(8*dk)},1)`,
        ]);

        // 2) 按钮柄
        const stemTopY = this._stemTop - travel * (1 - ratio);
        this._btnStem.y(stemTopY);
        const stemBotY = this._stemBot - travel * (1 - ratio);
        this._btnStemBottom.y(stemBotY);

        // 3) 复位弹簧
        const springTopY = this._springTopY - travel * (1 - ratio);
        this._springLine.points(
            this._makeSpringPoints(this._springCX, springTopY, this._springBotY)
        );
        this._springLine.stroke(ratio > 0.5 ? '#e09080' : '#7090b0');

        // 4) 内部触桥（NC：ratio=0 居中闭合，ratio=1 上移断开）
        const bridgeMidY = this._ncMidY + this._bridgeOpenDY * ratio;
        this._internalBridge.y(bridgeMidY - 3);
        this._internalContactTop.y(bridgeMidY - 3);
        this._internalContactBot.y(bridgeMidY + 3);

        // 内部断开间隙线（ratio>0 时显示，指向下静触头）
        this._intGapLine.visible(ratio > 0.10);
        this._intGapLine.points([
            this._ncTouchCX - 10, bridgeMidY + 3,
            this._ncTouchCX + 10, bridgeMidY + 3,
            this._ncTouchCX,      this._ncStaticBotY,
        ]);

        // 5) 原理图触桥（NC：ratio=0 闭合角，ratio=1 断开角）
        const angle = this._schAngleClosed
            + (this._schAngleOpen - this._schAngleClosed) * ratio;
        const rx = this._schAnchorX + this._schBridgeLen * Math.cos(angle);
        const ry = this._schAnchorY + this._schBridgeLen * Math.sin(angle);
        this._schBridgeLine.points([this._schAnchorX, this._schAnchorY, rx, ry]);
        this._schBridgeEnd.x(rx);
        this._schBridgeEnd.y(ry);

        // 断开间隙
        const isOpen = ratio > 0.10;
        this._schGapLine.points([rx, ry, this._schCX, this._schStaticY]);
        this._schGapLine.visible(isOpen);
        this._schGapText.y((this._schStaticY + ry) / 2 - 6);
        this._schGapText.visible(ratio > 0.45);
        this._schClosedText.visible(ratio < 0.10);

        // 6) 联动虚线
        this._linkLine.points([
            this._panelHoleCX, stemBotY,
            this._schAnchorX, this._schAnchorY,
        ]);
        this._linkLine.stroke(`rgba(200,80,60,${0.18 + ratio * 0.40})`);

        // 7) 接触高光（弹起=闭合状态，ratio<0.15 时显示）
        const isClosed = ratio < 0.15;
        this._schGlow.visible(isClosed);
        this._intGlow.visible(isClosed);
        this._intGlow.y(bridgeMidY);

        // 8) 断开电弧
        this._arcGroup.destroyChildren();
        if (this._arcFrames > 0) {
            this._drawBreakArc();
        }
    }

    /** 断开瞬间小电弧（NC 断开时，红色调） */
    _drawBreakArc() {
        const px = this._schCX;
        const sy = this._schStaticY;
        for (let k = 0; k < 4; k++) {
            const ox = (Math.random() - 0.5) * 10;
            const oy = (Math.random() - 0.5) * 6;
            this._arcGroup.add(new Konva.Line({
                points: [
                    px + ox, sy + oy - 4,
                    px + ox + (Math.random() - 0.5) * 5, sy + oy,
                    px + ox, sy + oy + 4,
                ],
                stroke: `rgba(255,${100 + Math.round(Math.random() * 80)},60,${0.5 + Math.random() * 0.4})`,
                strokeWidth: 1 + Math.random(),
                lineCap: 'round', lineJoin: 'round', listening: false,
            }));
        }
    }

    // ═══════════════════════════════════════════
    // 交互绑定
    // ═══════════════════════════════════════════

    _bindInteraction() {
        const hitR  = this._btnCapR + 6;
        const hitCX = this._panelHoleCX;
        const hitCY = this._btnCapBaseY;

        const hitArea = new Konva.Circle({
            x: hitCX, y: hitCY,
            radius: hitR + this._stemBot - hitCY,
            fill: 'transparent',
        });

        hitArea.on('mousedown touchstart', (e) => {
            e.cancelBubble = true;
            this._startPress();
        });

        const onUp = () => {
            if (this._pointerDown) this._startRelease();
        };
        hitArea.on('mouseup touchend mouseleave', onUp);
        hitArea.on('mouseenter', () => { document.body.style.cursor = 'pointer'; });
        hitArea.on('mouseleave', () => { document.body.style.cursor = 'default'; });

        this._interactGroup.add(hitArea);
    }

    _startPress() {
        if (this._pointerDown) return;
        this._pointerDown = true;
        this._state       = 'pressed';
        this._pressFrom   = this._pressRatio;
        this._pressTo     = 1;
        this._animT       = 0;
        this._animDur     = this._pressTime;
        this._animating   = true;
        this.opsCount++;
    }

    _startRelease() {
        if (!this._pointerDown) return;
        this._pointerDown = false;
        this._state       = 'idle';
        this._pressFrom   = this._pressRatio;
        this._pressTo     = 0;
        this._animT       = 0;
        this._animDur     = this._releaseTime;
        this._animating   = true;
    }

    // ═══════════════════════════════════════════
    // tick（20fps）
    // ═══════════════════════════════════════════

    tick(dt) {
        if (this._animating) {
            this._animT += dt / this._animDur;
            if (this._animT >= 1) {
                this._animT         = 1;
                this._animating     = false;
                this._animJustEnded = true;
                this._pressRatio    = this._pressTo;
                // NC 断开瞬间触发电弧（按下时 ratio 到 1）
                if (this._pressTo === 1) this._arcFrames = 4;
            } else {
                const ease = 0.5 - 0.5 * Math.cos(this._animT * Math.PI);
                this._pressRatio = this._pressFrom + (this._pressTo - this._pressFrom) * ease;
            }
        }

        if (this._arcFrames > 0) this._arcFrames--;

        const needUpdate = this._animating || this._arcFrames > 0 || this._animJustEnded;
        if (needUpdate) {
            this._animJustEnded = false;
            this._updateDynamic();
            this.markDirty();
        }
        this._refreshIfDirty();
    }

    // ═══════════════════════════════════════════
    // 公开 API
    // ═══════════════════════════════════════════

    /** 模拟按下（程序控制） */
    press()   { if (!this._pointerDown) this._startPress(); }

    /** 模拟松开（程序控制） */
    release() { if (this._pointerDown) this._startRelease(); }

    /** 脉冲：按下后自动弹起 */
    pulse(durationS = 0.3) {
        this.press();
        setTimeout(() => this.release(), durationS * 1000);
    }

    getState()    { return this._state; }
    isPressed()   { return this._state === 'pressed'; }
    isClosed()    { return this._pressRatio < 0.15; }   // NC: 弹起时闭合
    isOpen()      { return this._pressRatio > 0.85; }   // NC: 按下时断开
    getOpsCount() { return this.opsCount; }

    update(state) {
        const v = String(state).toLowerCase();
        if (v === '1' || v === 'press')   this.press();
        if (v === '0' || v === 'release') this.release();
    }

    getConfigFields() {
        return [
            { label: '位号/名称',    key: 'label',       type: 'text'   },
            { label: '铭牌文字',      key: 'buttonText',  type: 'text'   },
            { label: '按下行程 (px)', key: 'pressTravel', type: 'number' },
            { label: '按下时间 (s)',  key: 'pressTime',   type: 'number' },
            { label: '弹起时间 (s)',  key: 'releaseTime', type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label       !== undefined) this.label        = cfg.label;
        if (cfg.buttonText  !== undefined) this.buttonText   = cfg.buttonText;
        if (cfg.pressTravel !== undefined) this._pressTravel = parseFloat(cfg.pressTravel);
        if (cfg.pressTime   !== undefined) this._pressTime   = parseFloat(cfg.pressTime);
        if (cfg.releaseTime !== undefined) this._releaseTime = parseFloat(cfg.releaseTime);
        this.config = { ...this.config, ...cfg };
        this._recalcGeometry();
        this._staticGroup.destroyChildren();
        this._dynamicGroup.destroyChildren();
        this._drawStaticParts();
        this._createDynamicNodes();
        this._refreshCache();
    }

    destroy() { super.destroy?.(); }
}
