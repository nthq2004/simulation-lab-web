import { BaseComponent } from './BaseComponent.js';

/**
 * 起动按钮（Start Push Button）仿真组件
 *
 * ═══ 渲染优化原则 ═══════════════════════════════════════════
 *  1. 动态元素（按钮帽压下量、触桥位移、弹簧压缩、接触高光）
 *     全部使用 in-place 更新，不重建节点
 *  2. 消除所有 shadow 属性，避免离屏阴影渲染
 *  3. 静态部件（面板外框、底座、接线柱、铭牌）仅 init 时缓存
 *  4. 按压电弧在独立 _arcGroup 中重建，不干扰主体节点
 * ═══════════════════════════════════════════════════════════
 *
 * ── 左半区：按钮实体仿真（侧视截面图）─────────────────────
 *
 *  安装面板（灰色铁板，带圆形开孔）
 *  │
 *  ├─ 按钮帽（绿色圆顶，蘑菇形）
 *  │    • 静止：凸出面板约 10px（弹起状态）
 *  │    • 按下：与面板齐平，压缩约 8px
 *  │    • 圆顶高光：左上角白色弧形（立体感）
 *  │    • 帽沿：深绿色环形边缘
 *  │
 *  ├─ 按钮柄（圆柱，连接帽与触点机构）
 *  │    • 随按钮帽同步向下位移
 *  │
 *  ├─ 复位弹簧（线圈弹簧，按下时压缩，松开时伸展）
 *  │    • 动态绘制锯齿弹簧线
 *  │    • 弹簧两端连接：上端=按钮柄底面，下端=底座顶面
 *  │
 *  ├─ 触点机构（底座内，截面图）
 *  │    ├─ 常开（NO）触点 × 1组（起动按钮，E型，绿色）
 *  │    │    上静触头（固定）
 *  │    │    可动触桥（随按钮柄位移，按下=闭合，弹起=断开）
 *  │    │    下静触头（固定）
 *  │    └─ 可选常闭（NC）触点 × 1组（按下=断开，弹起=闭合）
 *  │
 *  └─ 底座（灰色绝缘塑料，螺纹接线端）
 *       接线柱 1、2（常开）标注在左半区底部外侧
 *
 * ── 右半区：电路原理图（IEC 60617）──────────────────────
 *
 *  ┌─ 常开（NO）触点符号（主体）──────────────────────────┐
 *  │  端子 1（上）、端子 2（下）                           │
 *  │  静触头横线（上方固定端）                             │
 *  │  可动触桥斜线：                                       │
 *  │    • 弹起：斜线偏离静触头（断开，间隙可见）           │
 *  │    • 按下：斜线与静触头对齐（闭合，绿色接触高光）      │
 *  │  按下过程：触桥从断开位逐渐旋转至闭合位               │
 *  │  操作线（从触桥向左引出的斜箭头线，IEC 操作符号）      │
 *  └──────────────────────────────────────────────────────┘
 *  ┌─ 操作机构符号（IEC 按钮标识）──────────────────────┐
 *  │  向下箭头 + 横线（手动按压操作符号）               │
 *  └──────────────────────────────────────────────────┘
 *
 *  联动线：按钮柄底端 → 原理图触桥，虚线标注机械联动
 *
 * ── 状态机 ────────────────────────────────────────────────
 *  'idle'    → 弹起，NO 断开
 *  'pressed' → 按下，NO 闭合（松开自动弹起）
 *
 *  • 鼠标/触摸 按下（mousedown/touchstart）→ 进入 pressed
 *  • 鼠标/触摸 松开（mouseup/touchend）    → 返回 idle
 *  • 动画：按下约 0.06s，弹起约 0.10s，正弦缓动
 *
 * ── 端口 ─────────────────────────────────────────────────
 *  no1  — NO 常开端子 1（上/左）
 *  no2  — NO 常开端子 2（下/右）
 *
 * ── 可配置参数 ────────────────────────────────────────────
 *  label       : 位号（默认 'SB'）
 *  buttonText  : 按钮铭牌文字（默认 '起动'）
 *  pressTravel : 按下行程 px（默认 8）
 *  pressTime   : 按下动画时间 s（默认 0.06）
 *  releaseTime : 弹起动画时间 s（默认 0.10）
 */
export class StartButton extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(240, config.width  || 300);
        this.height = Math.max(180, config.height || 220);

        this.type    = 'PUSHBUTTON';
        this.special = 'START-BTN';
        this.cache   = 'fixed';

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        this.config = {
            label:       this.label,
            buttonText:  this.buttonText,
            pressTravel: this._pressTravel,
            pressTime:   this._pressTime,
            releaseTime: this._releaseTime,
        };

        // ── 端口 ─────────────────────────────────
        this.addPort(this._noPortA.x, this._noPortA.y, 'no1', 'wire');
        this.addPort(this._noPortB.x, this._noPortB.y, 'no2', 'wire', 'p');
    }

    // ═══════════════════════════════════════════
    // 几何尺寸计算
    // ═══════════════════════════════════════════

    _recalcGeometry() {
        const W = this.width, H = this.height;

        // 左右分割
        this._divX = W * 0.48;
        this._frame = { x: 2, y: 2, w: W - 4, h: H - 4, rx: 6 };

        // ══ 左侧：按钮实体区 ═══════════════════════
        const LP  = 10;
        const LW  = this._divX - LP * 2;
        const LCX = LP + LW / 2;   // 左侧中心 X（按钮轴线）

        // 安装面板
        const panelTop = H * 0.22;
        const panelH   = H * 0.14;
        this._panelRect = {
            x: LP + LW * 0.10, y: panelTop,
            w: LW * 0.80,      h: panelH, rx: 3,
        };
        // 面板开孔半径（按钮帽穿孔）
        this._panelHoleR = Math.max(10, LW * 0.22);
        this._panelHoleCX = LCX;
        this._panelHoleCY = panelTop + panelH / 2;

        // 按钮帽（圆形截面）
        this._btnCapR   = this._panelHoleR - 1;  // 帽半径（略小于开孔）
        this._btnCapBaseY = this._panelHoleCY;    // 帽圆心基准 Y（弹起时）
        this._pressTravel = config => config; // 临时，initParams 再赋值

        // 按钮柄（矩形，帽下方）
        this._stemW   = this._btnCapR * 0.55;
        this._stemTop = this._panelHoleCY + this._btnCapR * 0.40;
        this._stemBot = panelTop + panelH + H * 0.10;

        // 底座（触点机构盒）
        const baseTop = this._stemBot + H * 0.04;
        const baseH   = H * 0.28;
        this._baseRect = {
            x: LP + LW * 0.06, y: baseTop,
            w: LW * 0.88,      h: baseH, rx: 4,
        };

        // 触点在底座内的位置（截面图：上下静触头 + 可动触桥）
        const noStaticTopY = baseTop + baseH * 0.22;
        const noStaticBotY = baseTop + baseH * 0.78;
        const noMidY       = (noStaticTopY + noStaticBotY) / 2;
        this._noStaticTopY = noStaticTopY;
        this._noStaticBotY = noStaticBotY;
        this._noMidY       = noMidY;

        // 触桥宽度
        this._noTouchW = LW * 0.35;
        this._noTouchCX = LCX;

        // 弹起时触桥偏离量（向上偏离上静触头）
        this._bridgeOpenDY = -(H * 0.07);

        // 复位弹簧区域
        this._springTopY = this._stemBot;
        this._springBotY = baseTop;
        this._springCX   = LCX;

        // 接线柱（底座外侧下方）
        const termY = baseTop + baseH + 10;
        this._leftTermPos  = { x: LP + LW * 0.28, y: termY };
        this._rightTermPos = { x: LP + LW * 0.72, y: termY };

        // ══ 右侧：原理图区 ═════════════════════════
        const RP  = 10;
        const RX  = this._divX + RP;
        const RW  = W - this._divX - RP * 2;
        const RCX = RX + RW / 2;

        // 触点符号纵向布局
        const schTop = H * 0.10;
        const schBot = H * 0.88;
        const schMid = (schTop + schBot) / 2;

        // 端子 1（上）& 端子 2（下）
        this._schTerm1Y   = schTop + (schBot - schTop) * 0.18;
        this._schTerm2Y   = schTop + (schBot - schTop) * 0.82;
        this._schCX       = RCX;

        // IEC 静触头位置（端子 1 下方一段）
        this._schStaticY  = this._schTerm1Y + (this._schTerm2Y - this._schTerm1Y) * 0.30;
        // 触桥基准 Y（弹起时偏上，按下时落至静触头）
        this._schBridgeBaseY  = this._schStaticY + (this._schTerm2Y - this._schStaticY) * 0.55;
        this._schBridgeOpenDY = -(this._schTerm2Y - this._schStaticY) * 0.22;

        // 操作机构符号（位于触点左侧）
        this._schOpX = RCX - RW * 0.30;
        this._schOpY = this._schStaticY - 10;

        // 端口（组件外部连线点）
        this._noPortA = { x: RCX, y: 2 };
        this._noPortB = { x: RCX, y: H - 2 };

        // 端子半径
        this._termR = Math.max(3.5, W * 0.014);
    }

    // ═══════════════════════════════════════════
    // 参数初始化
    // ═══════════════════════════════════════════

    _initParameters(config) {
        this.label       = config.label      || 'SB';
        this.buttonText  = config.buttonText || '起动';
        this.function    = config.function   || '起动按钮';

        this._pressTravel  = config.pressTravel  !== undefined ? config.pressTravel  : 8;
        this._pressTime    = config.pressTime    !== undefined ? config.pressTime    : 0.06;
        this._releaseTime  = config.releaseTime  !== undefined ? config.releaseTime  : 0.10;

        // 状态：'idle' | 'pressed'
        this._state      = 'idle';

        // 动画
        this._animating  = false;
        this._animT      = 0;
        this._animDur    = this._releaseTime;
        this._pressRatio = 0;       // 0=完全弹起，1=完全按下
        this._pressFrom  = 0;
        this._pressTo    = 0;
        this._animJustEnded = false;

        // 按下状态跟踪（鼠标/触摸持续按住）
        this._pointerDown = false;

        // 电弧帧
        this._arcFrames = 0;

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

    /** 外框 */
    _drawFrame() {
        const f = this._frame;
        this._staticGroup.add(new Konva.Rect({
            x: f.x, y: f.y, width: f.w, height: f.h,
            fill: '#dfe2ee', stroke: '#b0a8a0', strokeWidth: 1.5, cornerRadius: f.rx,
        }));
        // 顶部绿色色条
        this._staticGroup.add(new Konva.Rect({
            x: f.x + 2, y: f.y + 2, width: f.w - 4, height: f.h * 0.065,
            fill: 'rgba(30,160,60,0.20)', cornerRadius: [f.rx, f.rx, 0, 0],
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

    /** 分割线 */
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

        // 面板主体（用 Shape 挖孔实现）
        this._staticGroup.add(new Konva.Shape({
            sceneFunc(ctx, shape) {
                ctx.beginPath();
                // 外矩形（顺时针）
                ctx.moveTo(r.x, r.y);
                ctx.lineTo(r.x + r.w, r.y);
                ctx.lineTo(r.x + r.w, r.y + r.h);
                ctx.lineTo(r.x, r.y + r.h);
                ctx.closePath();
                // 圆孔（逆时针挖空）
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

        // 开孔装饰环（螺纹安装环）
        this._staticGroup.add(new Konva.Circle({
            x: hX, y: hY, radius: hR + 3,
            fill: 'none', stroke: '#c0c8d0', strokeWidth: 1.5,
        }));
        this._staticGroup.add(new Konva.Circle({
            x: hX, y: hY, radius: hR + 6,
            fill: 'none', stroke: '#8090a0', strokeWidth: 0.8,
        }));
    }

    /** 底座（绝缘塑料盒） */
    _drawBase() {
        const b = this._baseRect;
        this._staticGroup.add(new Konva.Rect({
            x: b.x, y: b.y, width: b.w, height: b.h,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: 0, y: b.h },
            fillLinearGradientColorStops: [0, '#3a3e4a', 0.5, '#484c5a', 1, '#363a46'],
            stroke: '#282c38', strokeWidth: 1.2, cornerRadius: b.rx,
        }));
        // 底座顶面高光
        this._staticGroup.add(new Konva.Rect({
            x: b.x + 2, y: b.y + 2, width: b.w - 4, height: b.h * 0.12,
            fill: 'rgba(255,255,255,0.06)', cornerRadius: [b.rx, b.rx, 0, 0],
        }));
        // "NO" 标注
        const fs = Math.max(8, this.width * 0.022);
        this._staticGroup.add(new Konva.Text({
            x: b.x + 4, y: b.y + 4,
            text: 'NO', fontSize: fs, fontStyle: 'bold', fill: '#20c050',
        }));
    }

    /** 底座内静触头横线（上下各一根，固定） */
    _drawStaticContacts() {
        const cx  = this._noTouchCX;
        const hw  = this._noTouchW / 2 + 4;

        // 上静触头
        this._staticGroup.add(new Konva.Line({
            points: [cx - hw, this._noStaticTopY, cx + hw, this._noStaticTopY],
            stroke: '#30b050', strokeWidth: 3, lineCap: 'round',
        }));
        // 下静触头
        this._staticGroup.add(new Konva.Line({
            points: [cx - hw, this._noStaticBotY, cx + hw, this._noStaticBotY],
            stroke: '#30b050', strokeWidth: 3, lineCap: 'round',
        }));

        // 接触银点（静触头端面）
        [this._noStaticTopY, this._noStaticBotY].forEach(sy => {
            this._staticGroup.add(new Konva.Circle({
                x: cx, y: sy, radius: 3.5,
                fill: '#d8d8e0', stroke: '#a0a0a8', strokeWidth: 0.8,
            }));
        });
    }

    /** 接线柱（底座下方） */
    _drawTerminals() {
        const fs = Math.max(8, this.width * 0.022);
        [
            { pos: this._leftTermPos,  name: '1', color: '#20c050' },
            { pos: this._rightTermPos, name: '2', color: '#20c050' },
        ].forEach(({ pos, name, color }) => {
            // 接线柱
            this._drawTermPost(pos, color);
            this._staticGroup.add(new Konva.Text({
                x: pos.x - 6, y: pos.y + this._termR + 2,
                text: name, fontSize: fs, fontStyle: 'bold', fill: color,
            }));
            // 从接线柱向底座内引线
            this._staticGroup.add(new Konva.Line({
                points: [pos.x, pos.y - this._termR, pos.x, this._baseRect.y + this._baseRect.h],
                stroke: color, strokeWidth: 1.8,
            }));
        });

        // 底座内两极连线（至上下静触头）
        this._staticGroup.add(new Konva.Line({
            points: [
                this._leftTermPos.x,  this._baseRect.y + this._baseRect.h,
                this._leftTermPos.x,  this._noStaticTopY,
                this._noTouchCX - this._noTouchW / 2 - 4, this._noStaticTopY,
            ],
            stroke: '#20c050', strokeWidth: 1.8, lineJoin: 'round',
        }));
        this._staticGroup.add(new Konva.Line({
            points: [
                this._rightTermPos.x, this._baseRect.y + this._baseRect.h,
                this._rightTermPos.x, this._noStaticBotY,
                this._noTouchCX + this._noTouchW / 2 + 4, this._noStaticBotY,
            ],
            stroke: '#20c050', strokeWidth: 1.8, lineJoin: 'round',
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

    /** 右侧原理图静态部件 */
    _drawSchematicStatic() {
        const px  = this._schCX;
        const fs  = Math.max(9, this.width * 0.024);

        // 端子 1（上）接线柱
        this._drawTermPost({ x: px, y: this._schTerm1Y }, '#20c050');
        this._staticGroup.add(new Konva.Text({
            x: px - 6, y: this._schTerm1Y - this._termR - fs - 2,
            text: '1', fontSize: fs, fontStyle: 'bold', fill: '#20c050',
        }));
        // 端子 1 到上边端口线
        this._staticGroup.add(new Konva.Line({
            points: [px, this._schTerm1Y - this._termR, px, 2],
            stroke: '#20c050', strokeWidth: 2.5,
        }));
        // 端子 1 到静触头连线
        this._staticGroup.add(new Konva.Line({
            points: [px, this._schTerm1Y + this._termR, px, this._schStaticY],
            stroke: '#20c050', strokeWidth: 2,
        }));

        // 端子 2（下）接线柱
        this._drawTermPost({ x: px, y: this._schTerm2Y }, '#20c050');
        this._staticGroup.add(new Konva.Text({
            x: px - 6, y: this._schTerm2Y + this._termR + 2,
            text: '2', fontSize: fs, fontStyle: 'bold', fill: '#20c050',
        }));
        // 端子 2 到下边端口线
        this._staticGroup.add(new Konva.Line({
            points: [px, this._schTerm2Y + this._termR, px, this.height - 2],
            stroke: '#20c050', strokeWidth: 2.5,
        }));
        // 端子 2 到触桥底端连线（常开，出线侧）
        this._staticGroup.add(new Konva.Line({
            points: [px, this._schBridgeBaseY + 12, px, this._schTerm2Y - this._termR],
            stroke: '#20c050', strokeWidth: 2,
        }));

        // 上静触头横线
        this._staticGroup.add(new Konva.Line({
            points: [px - 12, this._schStaticY, px + 12, this._schStaticY],
            stroke: '#20c050', strokeWidth: 3, lineCap: 'round',
        }));

        // IEC 操作机构符号（手动按压箭头 + 横线）
        const opX  = this._schOpX;
        const opY  = this._schOpY;
        // 操作横线（表示可操作的外力）
        this._staticGroup.add(new Konva.Line({
            points: [opX - 12, opY, opX + 12, opY],
            stroke: '#80a0c0', strokeWidth: 2, lineCap: 'round',
        }));
        // 向下箭头（表示按压方向）
        this._staticGroup.add(new Konva.Line({
            points: [opX, opY, opX, opY + 10],
            stroke: '#80a0c0', strokeWidth: 2, lineCap: 'round',
        }));
        this._staticGroup.add(new Konva.Line({
            points: [opX - 4, opY + 6, opX, opY + 11, opX + 4, opY + 6],
            stroke: '#80a0c0', strokeWidth: 2, lineCap: 'round', lineJoin: 'round',
        }));
        // "NO" 文字标注
        this._staticGroup.add(new Konva.Text({
            x: px + 16, y: (this._schStaticY + this._schBridgeBaseY) / 2 - 6,
            text: 'NO', fontSize: fs - 1, fontStyle: 'bold', fill: '#20c050',
        }));
        // 操作线（从触桥到操作符号的斜连线，IEC标准）
        this._staticGroup.add(new Konva.Line({
            points: [opX, opY + 11, px, this._schStaticY + 5],
            stroke: '#80a0c0', strokeWidth: 1.2, dash: [3, 3],
        }));
    }

    /** 位号铭牌 */
    _drawPanelLabel() {
        // 按钮上方铭牌文字
        const bR  = this._btnCapR;
        const bCY = this._btnCapBaseY;
        const fs  = Math.max(10, this.width * 0.028);
        this._staticGroup.add(new Konva.Rect({
            x: this._panelHoleCX - bR * 1.2,
            y: bCY - bR - 28,
            width: bR * 2.4, height: 18, rx: 3,
            fill: '#1e4020', stroke: '#3a6030', strokeWidth: 1,
        }));
        this._staticGroup.add(new Konva.Text({
            x: this._panelHoleCX - bR * 1.2,
            y: bCY - bR - 26,
            width: bR * 2.4,
            text: this.buttonText,
            fontSize: fs - 1, fontStyle: 'bold', fill: '#60e080', align: 'center',
        }));
        // 位号
        this._staticGroup.add(new Konva.Text({
            x: 12, y: this.height - 20,
            text: this.label,
            fontSize: Math.max(12, this.width * 0.032),
            fontStyle: 'bold', fill: '#60c080',
        }));
    }

    // ═══════════════════════════════════════════
    // 动态层（一次性创建，每帧 in-place 更新）
    // ═══════════════════════════════════════════

    _createDynamicNodes() {
        this._createButtonCap();       // 绿色按钮帽
        this._createButtonStem();      // 按钮柄
        this._createSpring();          // 复位弹簧
        this._createInternalBridge();  // 底座内动触桥
        this._createSchBridge();       // 原理图触桥
        this._createLinkLine();        // 联动虚线
        this._createContactGlow();     // 接触高光
        this._arcGroup = new Konva.Group({ listening: false });
        this._dynamicGroup.add(this._arcGroup);
    }

    /**
     * 绿色圆顶按钮帽
     * pressRatio=0 → 弹起（帽圆心在 btnCapBaseY - pressTravel）
     * pressRatio=1 → 按下（帽圆心在 btnCapBaseY）
     */
    _createButtonCap() {
        const r   = this._btnCapR;
        const px  = this._panelHoleCX;
        const travel = this._pressTravel || 8;
        const cy  = this._btnCapBaseY - travel * (1 - this._pressRatio);

        // 帽主体（椭圆，绿色渐变）
        this._btnCapBody = new Konva.Ellipse({
            x: px, y: cy,
            radiusX: r, radiusY: r * 0.52,
            fillLinearGradientStartPoint: { x: -r, y: -r * 0.52 },
            fillLinearGradientEndPoint:   { x:  r, y:  r * 0.52 },
            fillLinearGradientColorStops: [
                0,   '#30d060',
                0.25,'#50e880',
                0.55,'#28c050',
                0.80,'#1e9040',
                1,   '#16702e',
            ],
            stroke: '#148030', strokeWidth: 1.5,
        });
        this._dynamicGroup.add(this._btnCapBody);

        // 帽沿（深绿色环）
        this._btnCapRim = new Konva.Ellipse({
            x: px, y: this._panelHoleCY,
            radiusX: r + 1, radiusY: r * 0.20,
            fillLinearGradientStartPoint: { x: -r, y: 0 },
            fillLinearGradientEndPoint:   { x:  r, y: 0 },
            fillLinearGradientColorStops: [0, '#104020', 0.5, '#206030', 1, '#104020'],
            stroke: '#0c2818', strokeWidth: 1,
        });
        this._dynamicGroup.add(this._btnCapRim);

        // 帽顶高光（弧形白色高光，左上角）
        this._btnCapHighlight = new Konva.Arc({
            x: px - r * 0.25, y: cy - r * 0.15,
            innerRadius: r * 0.30, outerRadius: r * 0.50,
            angle: 140, rotation: -130,
            fill: 'rgba(255,255,255,0.30)',
            listening: false,
        });
        this._dynamicGroup.add(this._btnCapHighlight);

        // 帽顶文字（小图标，仅在帽较大时显示）
        this._btnCapText = new Konva.Text({
            x: px - r * 0.90, y: cy - r * 0.28,
            width: r * 1.80, height: r * 0.56,
            text: '▼',
            fontSize: Math.max(8, r * 0.45),
            fill: 'rgba(10,40,20,0.45)',
            align: 'center', verticalAlign: 'middle',
            listening: false,
        });
        this._dynamicGroup.add(this._btnCapText);

        this._btnCapCY_base = this._btnCapBaseY;
    }

    /** 按钮柄（从帽底到底座顶的圆柱） */
    _createButtonStem() {
        const px     = this._panelHoleCX;
        const sw     = this._stemW;
        const travel = this._pressTravel || 8;

        // 柄主体
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

        // 柄下端推板（连接弹簧的圆形凸台）
        this._btnStemBottom = new Konva.Ellipse({
            x: px,
            y: this._stemBot - travel * (1 - this._pressRatio),
            radiusX: sw * 0.90, radiusY: sw * 0.35,
            fill: '#6a7080', stroke: '#404850', strokeWidth: 0.8,
            listening: false,
        });
        this._dynamicGroup.add(this._btnStemBottom);
    }

    /** 复位弹簧（锯齿折线，动态压缩/伸展） */
    _createSpring() {
        const travel = this._pressTravel || 8;
        const topY   = this._springTopY - travel * (1 - this._pressRatio);
        const botY   = this._springBotY;
        const cx     = this._springCX;

        this._springLine = new Konva.Line({
            points: this._makeSpringPoints(cx, topY, botY),
            stroke: '#7090b0', strokeWidth: 1.5,
            lineCap: 'round', lineJoin: 'round', listening: false,
        });
        this._dynamicGroup.add(this._springLine);
    }

    _makeSpringPoints(cx, topY, botY) {
        const pts   = [cx, topY];
        const span  = botY - topY;
        if (span <= 0) return [cx, topY, cx, botY];
        const turns = 7;
        const amp   = Math.max(3, span * 0.12);
        for (let i = 0; i <= turns * 2; i++) {
            const t = i / (turns * 2);
            pts.push(
                cx + (i % 2 === 0 ? amp : -amp),
                topY + t * span
            );
        }
        pts.push(cx, botY);
        return pts;
    }

    /** 底座内可动触桥（矩形铜桥，随按钮柄上下） */
    _createInternalBridge() {
        const cx    = this._noTouchCX;
        const bw    = this._noTouchW;
        const bh    = 6;
        const travel = this._pressTravel || 8;

        // 触桥中心 Y：
        //   弹起(ratio=0)：noMidY + bridgeOpenDY（偏上，不接触上静触头）
        //   按下(ratio=1)：noMidY（居中，同时接触上下静触头）
        const midY = this._noMidY
            + this._bridgeOpenDY * (1 - this._pressRatio);

        this._internalBridge = new Konva.Rect({
            x: cx - bw / 2, y: midY - bh / 2,
            width: bw, height: bh,
            fillLinearGradientStartPoint: { x: -bw / 2, y: 0 },
            fillLinearGradientEndPoint:   { x:  bw / 2, y: 0 },
            fillLinearGradientColorStops: [0, '#8a7030', 0.3, '#d4a848', 0.6, '#f0c860', 1, '#8a7030'],
            stroke: '#7a6028', strokeWidth: 0.8, cornerRadius: 2, listening: false,
        });
        this._dynamicGroup.add(this._internalBridge);

        // 触桥两端银色接触点
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
    }

    /**
     * 原理图动触桥（IEC 常开触点符号中的可动部分）
     *
     * IEC 60617 常开触点：
     *   静触头：上方一条横线
     *   可动触桥：从左下角出发，斜向右上到达静触头
     *   断开：触桥右端低于静触头（斜线未接触横线）
     *   闭合：触桥右端恰好接触静触头横线
     *
     * 触桥旋转中心：左端（anchored at ncStaticLX, schBridgeBaseY）
     * 闭合角度：约 -30°（逆时针上抬）
     * 断开角度：约 -50°（下沉偏离）
     */
    _createSchBridge() {
        const px      = this._schCX;
        const staticY = this._schStaticY;
        const baseY   = this._schBridgeBaseY;

        // 触桥左锚点（固定）
        const anchorX = px - 18;
        const anchorY = baseY;

        // 触桥长度
        const bLen = 36;

        // 断开角度（斜线右端低于静触头）
        const angleOpen   = -35 * Math.PI / 180;  // 弹起时（断开）
        const angleClosed = -58 * Math.PI / 180;  // 按下时（闭合，右端恰好抵达静触头）

        const angle = angleOpen + (angleClosed - angleOpen) * this._pressRatio;
        const rx    = anchorX + bLen * Math.cos(angle);
        const ry    = anchorY + bLen * Math.sin(angle);

        this._schAnchorX = anchorX;
        this._schAnchorY = anchorY;
        this._schBridgeLen = bLen;
        this._schAngleOpen   = angleOpen;
        this._schAngleClosed = angleClosed;

        // 可动触桥线
        this._schBridgeLine = new Konva.Line({
            points: [anchorX, anchorY, rx, ry],
            stroke: '#28c050', strokeWidth: 3, lineCap: 'round',
        });
        this._dynamicGroup.add(this._schBridgeLine);

        // 左锚点（固定铰链）
        this._schAnchorCircle = new Konva.Circle({
            x: anchorX, y: anchorY, radius: 4,
            fill: '#1e8040', stroke: '#106030', strokeWidth: 1,
        });
        this._dynamicGroup.add(this._schAnchorCircle);

        // 右端接触点（闭合时与静触头重合）
        this._schBridgeEnd = new Konva.Circle({
            x: rx, y: ry, radius: 4,
            fill: '#d8e8d0', stroke: '#60a070', strokeWidth: 0.8,
        });
        this._dynamicGroup.add(this._schBridgeEnd);

        // 断开间隙虚线（仅断开时显示）
        this._schGapLine = new Konva.Line({
            points: [rx, ry, px, staticY],
            stroke: 'rgba(80,180,100,0.45)',
            strokeWidth: 1.2, dash: [3, 3],
            visible: this._pressRatio < 0.90, listening: false,
        });
        this._dynamicGroup.add(this._schGapLine);

        // 断开间隙距离标注
        this._schGapText = new Konva.Text({
            x: px + 16, y: (staticY + ry) / 2 - 6,
            text: '断开',
            fontSize: Math.max(8, this.width * 0.020),
            fill: 'rgba(80,180,100,0.70)',
            visible: this._pressRatio < 0.60, listening: false,
        });
        this._dynamicGroup.add(this._schGapText);
    }

    /** 联动虚线：按钮柄底端 → 原理图触桥锚点 */
    _createLinkLine() {
        const travel   = this._pressTravel || 8;
        const stemBotY = this._stemBot - travel * (1 - this._pressRatio);
        const stemBotX = this._panelHoleCX;

        this._linkLine = new Konva.Line({
            points: [stemBotX, stemBotY, this._schAnchorX, this._schAnchorY],
            stroke: 'rgba(80,160,220,0.40)', strokeWidth: 1.2,
            dash: [5, 4], lineCap: 'round', listening: false,
        });
        this._dynamicGroup.add(this._linkLine);
    }

    /** 接触高光（闭合时） */
    _createContactGlow() {
        const px = this._schCX;

        // 原理图侧高光
        this._schGlow = new Konva.Circle({
            x: px, y: this._schStaticY,
            radius: 8, fill: 'rgba(60,220,100,0.35)',
            visible: this._pressRatio > 0.85, listening: false,
        });
        this._dynamicGroup.add(this._schGlow);

        // 内部触点侧高光
        this._intGlow = new Konva.Circle({
            x: this._noTouchCX, y: this._noMidY + this._bridgeOpenDY * (1 - this._pressRatio),
            radius: 10, fill: 'rgba(60,220,100,0.25)',
            visible: this._pressRatio > 0.85, listening: false,
        });
        this._dynamicGroup.add(this._intGlow);
    }

    // ═══════════════════════════════════════════
    // 动态更新（每帧 in-place）
    // ═══════════════════════════════════════════

    _updateDynamic() {
        const ratio  = this._pressRatio;
        const travel = this._pressTravel || 8;

        // 1) 按钮帽（Y 随 ratio 下沉）
        const capCY = this._btnCapCY_base - travel * (1 - ratio);
        this._btnCapBody.y(capCY);
        this._btnCapHighlight.x(this._panelHoleCX - this._btnCapR * 0.25);
        this._btnCapHighlight.y(capCY - this._btnCapR * 0.15);
        this._btnCapText.y(capCY - this._btnCapR * 0.28);
        // 按下时帽色变深（模拟受压）
        const lighten = 1 - ratio * 0.22;
        this._btnCapBody.fillLinearGradientColorStops([
            0,   `rgba(${Math.round(48*lighten)},${Math.round(208*lighten)},${Math.round(96*lighten)},1)`,
            0.25,`rgba(${Math.round(80*lighten)},${Math.round(232*lighten)},${Math.round(128*lighten)},1)`,
            0.55,`rgba(${Math.round(40*lighten)},${Math.round(192*lighten)},${Math.round(80*lighten)},1)`,
            0.80,`rgba(${Math.round(30*lighten)},${Math.round(144*lighten)},${Math.round(64*lighten)},1)`,
            1,   `rgba(${Math.round(22*lighten)},${Math.round(112*lighten)},${Math.round(46*lighten)},1)`,
        ]);

        // 2) 按钮柄
        const stemTopY = this._stemTop - travel * (1 - ratio);
        this._btnStem.y(stemTopY);
        const stemBotY = this._stemBot - travel * (1 - ratio);
        this._btnStemBottom.y(stemBotY);

        // 3) 复位弹簧（随柄底端压缩）
        const springTopY = this._springTopY - travel * (1 - ratio);
        this._springLine.points(
            this._makeSpringPoints(this._springCX, springTopY, this._springBotY)
        );
        // 弹簧颜色：按下=受力蓝，弹起=松弛灰
        this._springLine.stroke(ratio > 0.5 ? '#a0c0e0' : '#7090b0');

        // 4) 内部触桥
        const bridgeMidY = this._noMidY + this._bridgeOpenDY * (1 - ratio);
        this._internalBridge.y(bridgeMidY - 3);
        this._internalContactTop.y(bridgeMidY - 3);
        this._internalContactBot.y(bridgeMidY + 3);

        // 5) 原理图触桥（角度插值）
        const angle = this._schAngleOpen + (this._schAngleClosed - this._schAngleOpen) * ratio;
        const rx    = this._schAnchorX + this._schBridgeLen * Math.cos(angle);
        const ry    = this._schAnchorY + this._schBridgeLen * Math.sin(angle);
        this._schBridgeLine.points([this._schAnchorX, this._schAnchorY, rx, ry]);
        this._schBridgeEnd.x(rx);
        this._schBridgeEnd.y(ry);

        // 断开间隙
        const isOpen = ratio < 0.90;
        this._schGapLine.points([rx, ry, this._schCX, this._schStaticY]);
        this._schGapLine.visible(isOpen && ratio < 0.85);
        this._schGapText.y((this._schStaticY + ry) / 2 - 6);
        this._schGapText.visible(ratio < 0.45);

        // 6) 联动虚线
        this._linkLine.points([
            this._panelHoleCX, stemBotY,
            this._schAnchorX, this._schAnchorY,
        ]);
        this._linkLine.stroke(`rgba(80,160,220,${0.20 + ratio * 0.40})`);

        // 7) 接触高光
        const inContact = ratio > 0.85;
        this._schGlow.visible(inContact);
        this._intGlow.visible(inContact);
        this._intGlow.y(bridgeMidY);

        // 8) 电弧（接通瞬间）
        this._arcGroup.destroyChildren();
        if (this._arcFrames > 0) {
            this._drawContactArc();
        }
    }

    /** 接通瞬间小电弧 */
    _drawContactArc() {
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
                stroke: `rgba(120,255,120,${0.5 + Math.random() * 0.4})`,
                strokeWidth: 1 + Math.random(),
                lineCap: 'round', lineJoin: 'round', listening: false,
            }));
        }
    }

    // ═══════════════════════════════════════════
    // 交互绑定（mousedown/mouseup 持续按压模式）
    // ═══════════════════════════════════════════

    _bindInteraction() {
        // 按钮帽交互区（圆形热区，覆盖整个帽+柄区域）
        const hitR = this._btnCapR + 6;
        const hitCX = this._panelHoleCX;
        const hitCY = this._btnCapBaseY;

        const hitArea = new Konva.Circle({
            x: hitCX, y: hitCY,
            radius: hitR + this._stemBot - hitCY,
            fill: 'transparent',
        });

        // 按下
        hitArea.on('mousedown touchstart', (e) => {
            e.cancelBubble = true;
            this._startPress();
        });

        // 松开（注册在 stage 上，防止鼠标移出后未释放）
        const onUp = () => {
            if (this._pointerDown) this._startRelease();
        };

        // 注册全局松开事件（在 stage 上监听）
        const stageListener = () => {
            if (this._pointerDown) this._startRelease();
        };
        hitArea.on('mouseup touchend mouseleave', onUp);

        // 鼠标进入变指针
        hitArea.on('mouseenter', () => { document.body.style.cursor = 'pointer'; });
        hitArea.on('mouseleave', () => { document.body.style.cursor = 'default'; });

        this._interactGroup.add(hitArea);
    }

    _startPress() {
        if (this._pointerDown) return;
        this._pointerDown  = true;
        this._state        = 'pressed';
        this._pressFrom    = this._pressRatio;
        this._pressTo      = 1;
        this._animT        = 0;
        this._animDur      = this._pressTime;
        this._animating    = true;
        this.opsCount++;
    }

    _startRelease() {
        if (!this._pointerDown) return;
        this._pointerDown  = false;
        this._state        = 'idle';
        this._pressFrom    = this._pressRatio;
        this._pressTo      = 0;
        this._animT        = 0;
        this._animDur      = this._releaseTime;
        this._animating    = true;
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
                // 接通瞬间触发电弧
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
    press() {
        if (!this._pointerDown) this._startPress();
    }

    /** 模拟松开（程序控制） */
    release() {
        if (this._pointerDown) this._startRelease();
    }

    /** 脉冲（按下后自动弹起，持续 durationS 秒） */
    pulse(durationS = 0.3) {
        this.press();
        setTimeout(() => this.release(), durationS * 1000);
    }

    getState()    { return this._state; }
    isPressed()   { return this._state === 'pressed'; }
    isClosed()    { return this._pressRatio > 0.85; }
    getOpsCount() { return this.opsCount; }

    update(state) {
        const v = String(state).toLowerCase();
        if (v === '1' || v === 'press')   this.press();
        if (v === '0' || v === 'release') this.release();
    }

    getConfigFields() {
        return [
            { label: '位号/名称',       key: 'label',       type: 'text'   },
            { label: '铭牌文字',         key: 'buttonText',  type: 'text'   },
            { label: '按下行程 (px)',    key: 'pressTravel', type: 'number' },
            { label: '按下时间 (s)',     key: 'pressTime',   type: 'number' },
            { label: '弹起时间 (s)',     key: 'releaseTime', type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label       !== undefined) this.label       = cfg.label;
        if (cfg.buttonText  !== undefined) this.buttonText  = cfg.buttonText;
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
