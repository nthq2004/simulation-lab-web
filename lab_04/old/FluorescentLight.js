import { BaseComponent } from '../BaseComponent.js';

/**
 * 日光灯（荧光灯）仿真组件
 * （Fluorescent Light / Fluorescent Lamp）
 *
 * ── 结构说明 ──────────────────────────────────────────────────
 *
 *  日光灯由以下部分组成：
 *
 *  1. 灯管（Fluorescent Tube）：
 *     - 玻璃管体，两端各有灯丝电极
 *     - 内壁涂荧光粉，充低压汞蒸气和惰性气体
 *     - 工作时产生紫外线激发荧光粉发光
 *     - 仿真：冷态→预热→点亮全过程，含频闪效果
 *
 *  2. 整流器 / 镇流器（Ballast）：
 *     - 串联在电路中，限制电流防止灯管过流
 *     - 铁芯电感线圈结构，外壳为金属矩形盒
 *     - 产生高压脉冲配合启辉器点燃灯管
 *     - 仿真：绘制铁芯线圈纹理，工作时轻微震动效果
 *
 *  3. 启辉器（Starter / Glow Switch）：
 *     - 小型玻璃泡，内含双金属片触点
 *     - 启动时双金属片因放电加热而弯曲闭合，预热灯丝
 *     - 随后冷却断开，产生感应高压脉冲点燃灯管
 *     - 仿真：双金属片动画，启动放电闪烁，启动成功后停止工作
 *
 *  4. 灯座 / 支架（Fixture）：
 *     - 两端灯脚座固定灯管
 *     - 金属反光板提高光效
 *
 * ── 工作时序 ──────────────────────────────────────────────────
 *
 *  上电 → 启辉器放电（0.3s）→ 双金属片闭合（0.1s）→ 灯丝预热（0.5s）
 *       → 双金属片断开 → 镇流器产生高压 → 灯管点燃（0.2s）
 *       → 稳定发光（持续）
 *
 *  失败重试：若首次点火失败（概率10%），重复上述过程，最多3次
 *  超时不亮：3次全失败则显示故障状态
 *
 * ── 动画效果 ──────────────────────────────────────────────────
 *
 *  - 启辉器放电：蓝紫色闪烁（随机频率）
 *  - 灯丝预热：两端电极发橙红色热辉
 *  - 点燃瞬间：全管闪白，然后渐变为正常色温（4000K 暖白）
 *  - 稳定工作：极轻微的 50Hz 频闪（可配置关闭）
 *  - 镇流器振动：工作时轻微抖动（模拟电磁噪声）
 *  - 关灯余辉：缓慢熄灭（100ms）
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  terminal_l  — 火线端（进线）
 *  terminal_n  — 零线端（出线）
 *  terminal_s1 — 启辉器接线端 1
 *  terminal_s2 — 启辉器接线端 2
 */
export class FluorescentLight extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(320, config.width  || 420);
        this.height = Math.max(160, config.height || 220);

        this.type    = 'fluorescent_light';
        this.special = 'none';
        this.cache   = 'fixed';

        this._initGroups();
        // ── 额定参数 ──
        this.ratedVoltage  = config.ratedVoltage  || 220;    // V
        this.ratedPower    = config.ratedPower    || 36;     // W
        this.colorTemp     = config.colorTemp     || 4000;   // K（4000=暖白，6500=冷白）
        this.label         = config.label         || 'EL';
        this.flickerEnable = config.flickerEnable !== false; // 频闪模拟

        // ── 启动状态机 ──
        //  'off'        关闭
        //  'starting'   启动中（启辉器放电）
        //  'preheating' 预热灯丝
        //  'igniting'   点火（高压脉冲）
        //  'on'         正常发光
        //  'fault'      故障（多次点火失败）
        this._state       = 'off';
        this._retryCount  = 0;
        this._maxRetry    = 3;
        this._stateTime   = 0;        // 当前状态已过时间(s)

        // 状态时长（秒）
        this._dur = {
            starting:   0.35,
            preheating: 0.55,
            igniting:   0.25,
        };

        // ── 亮度 / 颜色 ──
        this._brightness  = 0;           // 0~1
        this._flickerVal  = 1;           // 频闪乘数
        this._flickerPhase = 0;

        // ── 启辉器动画 ──
        this._starterFlash  = 0;          // 0~1 放电强度
        this._bimetalAngle  = 0;          // 双金属片角度（0=断开，1=闭合）
        this._lastFlashTs   = 0;
        this._flashInterval = 0.08;       // 放电闪烁间隔

        // ── 镇流器振动 ──
        this._ballastShake  = 0;          // 振幅

        // ── 几何布局 ──
        const W = this.width, H = this.height;

        // 灯架（背板）
        this._fixture = {
            x: W * 0.02, y: H * 0.08,
            w: W * 0.96, h: H * 0.84,
            rx: 5,
        };

        // 反光板
        this._reflector = {
            x: W * 0.04, y: H * 0.10,
            w: W * 0.92, h: H * 0.38,
        };

        // 灯管
        this._tube = {
            x:  W * 0.08, y: H * 0.28,
            w:  W * 0.84, h: H * 0.18,
            rx: H * 0.09,   // 半圆端头
        };

        // 左灯脚座
        this._sockL = {
            x: W * 0.04, y: H * 0.24,
            w: W * 0.06, h: H * 0.26,
        };
        // 右灯脚座
        this._sockR = {
            x: W * 0.90, y: H * 0.24,
            w: W * 0.06, h: H * 0.26,
        };

        // 镇流器（居中偏左下）
        this._ballast = {
            x: W * 0.12, y: H * 0.58,
            w: W * 0.34, h: H * 0.26,
            rx: 3,
        };

        // 启辉器（镇流器右侧）
        this._starter = {
            cx: W * 0.64, cy: H * 0.71,
            r:  Math.min(W * 0.055, H * 0.095),
        };

        // 接线端子区
        this._terminalL = { x: W * 0.07, y: H * 0.92 + 4 };
        this._terminalN = { x: W * 0.93, y: H * 0.92 + 4 };


        this._init();

        // 端口
        this.addPort(
            this._terminalL.x, this._fixture.y + this._fixture.h + 4,
            'terminal_l', 'wire', 'L'
        );
        this.addPort(
            this._terminalN.x, this._fixture.y + this._fixture.h + 4,
            'terminal_n', 'wire', 'N'
        );
        this.addPort(
            this._starter.cx - this._starter.r,
            this._fixture.y + this._fixture.h + 4,
            'terminal_s1', 'wire', 'S1'
        );
        this.addPort(
            this._starter.cx + this._starter.r,
            this._fixture.y + this._fixture.h + 4,
            'terminal_s2', 'wire', 'S2'
        );
    }

    // ═══════════════════════════════════════════
    _init() {
        this._drawFixture();
        this._drawReflector();
        this._drawSockets();
        this._drawBallast();
        this._drawWiring();

        // 动态层
        this._tubeGroup    = new Konva.Group();
        this._starterGroup = new Konva.Group();
        this._glowGroup    = new Konva.Group();
        this._staticGroup.add(this._tubeGroup, this._starterGroup, this._glowGroup);

        this._rebuildTube();
        this._rebuildStarter();
        this._drawLabel();
        this._drawStatusIndicator();
        
    }

    // ── 灯架背板 ─────────────────────────────
    _drawFixture() {
        const f = this._fixture;
        // 主体：金属灰
        this._staticGroup.add(new Konva.Rect({
            x: f.x, y: f.y, width: f.w, height: f.h,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: 0, y: f.h },
            fillLinearGradientColorStops: [
                0,   '#4a4e56',
                0.3, '#5a5e66',
                0.7, '#484c54',
                1,   '#3a3e46',
            ],
            stroke: '#2a2e36', strokeWidth: 1.5,
            cornerRadius: f.rx,
            shadowColor: '#000', shadowBlur: 8, shadowOffsetY: 3, shadowOpacity: 0.4,
        }));
        // 顶部高光条
        this._staticGroup.add(new Konva.Rect({
            x: f.x + 2, y: f.y + 2, width: f.w - 4, height: 4,
            fill: 'rgba(255,255,255,0.10)',
            cornerRadius: [f.rx, f.rx, 0, 0],
        }));
        // 左侧铆钉
        [0.15, 0.50, 0.85].forEach(py => {
            this._staticGroup.add(new Konva.Circle({
                x: f.x + 8, y: f.y + f.h * py,
                radius: 3, fill: '#888', stroke: '#555', strokeWidth: 0.8,
            }));
            this._staticGroup.add(new Konva.Circle({
                x: f.x + f.w - 8, y: f.y + f.h * py,
                radius: 3, fill: '#888', stroke: '#555', strokeWidth: 0.8,
            }));
        });
    }

    // ── 反光板 ───────────────────────────────
    _drawReflector() {
        const r = this._reflector;
        this._staticGroup.add(new Konva.Rect({
            x: r.x, y: r.y, width: r.w, height: r.h,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: 0, y: r.h },
            fillLinearGradientColorStops: [
                0,   '#e8eaec',
                0.4, '#ffffff',
                0.7, '#d8dadc',
                1,   '#c0c2c4',
            ],
            stroke: '#aaa', strokeWidth: 0.5,
        }));
        // 反光板纹路（细横线）
        for (let i = 1; i <= 4; i++) {
            this._staticGroup.add(new Konva.Line({
                points: [r.x, r.y + r.h * (i / 5), r.x + r.w, r.y + r.h * (i / 5)],
                stroke: 'rgba(0,0,0,0.04)', strokeWidth: 0.5,
            }));
        }
    }

    // ── 灯脚座 ───────────────────────────────
    _drawSockets() {
        [this._sockL, this._sockR].forEach(s => {
            // 座体
            this._staticGroup.add(new Konva.Rect({
                x: s.x, y: s.y, width: s.w, height: s.h,
                fillLinearGradientStartPoint: { x: 0, y: 0 },
                fillLinearGradientEndPoint:   { x: s.w, y: 0 },
                fillLinearGradientColorStops: [0, '#3a3a40', 0.5, '#4e4e56', 1, '#3a3a40'],
                stroke: '#222', strokeWidth: 1, cornerRadius: 2,
            }));
            // 插槽（灯脚插入处）
            const slotH = s.h * 0.20;
            this._staticGroup.add(new Konva.Rect({
                x: s.x + s.w * 0.20, y: s.y + s.h * 0.12,
                width: s.w * 0.60, height: slotH,
                fill: '#1a1a20', stroke: '#111', strokeWidth: 0.5, cornerRadius: 1,
            }));
            this._staticGroup.add(new Konva.Rect({
                x: s.x + s.w * 0.20, y: s.y + s.h * 0.68,
                width: s.w * 0.60, height: slotH,
                fill: '#1a1a20', stroke: '#111', strokeWidth: 0.5, cornerRadius: 1,
            }));
        });
    }

    // ── 镇流器 ───────────────────────────────
    _drawBallast() {
        const b = this._ballast;

        // 镇流器外壳（金属盒）
        this._ballastNode = new Konva.Group({ x: 0, y: 0 });

        const shell = new Konva.Rect({
            x: b.x, y: b.y, width: b.w, height: b.h,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: b.w, y: b.h },
            fillLinearGradientColorStops: [
                0,   '#5a5e30',
                0.3, '#72763c',
                0.7, '#5a5e30',
                1,   '#484c28',
            ],
            stroke: '#3a3e20', strokeWidth: 1.5,
            cornerRadius: b.rx,
            shadowColor: '#000', shadowBlur: 4, shadowOffsetY: 2, shadowOpacity: 0.3,
        });
        this._ballastNode.add(shell);

        // 铁芯散热槽纹（横线）
        for (let i = 0; i < 5; i++) {
            const ly = b.y + b.h * 0.15 + i * (b.h * 0.70 / 5);
            this._ballastNode.add(new Konva.Line({
                points: [b.x + 6, ly, b.x + b.w - 6, ly],
                stroke: 'rgba(0,0,0,0.20)', strokeWidth: 1.0,
            }));
        }
        // 铁芯线圈符号（两组波浪弧线）
        const coilY  = b.y + b.h * 0.50;
        const coilX0 = b.x + b.w * 0.15;
        const coilW  = b.w * 0.70;
        const turns  = 6;
        const pts1 = [], pts2 = [];
        for (let i = 0; i <= turns * 20; i++) {
            const t  = i / (turns * 20);
            const cx = coilX0 + t * coilW;
            const cy = coilY + Math.sin(t * turns * Math.PI * 2) * (b.h * 0.12);
            pts1.push(cx, cy - b.h * 0.06);
            pts2.push(cx, cy + b.h * 0.06);
        }
        this._ballastNode.add(new Konva.Line({
            points: pts1, stroke: '#c8b060', strokeWidth: 1.2,
            tension: 0.4, lineCap: 'round',
        }));
        this._ballastNode.add(new Konva.Line({
            points: pts2, stroke: '#c8b060', strokeWidth: 1.2,
            tension: 0.4, lineCap: 'round',
        }));
        // 标签
        this._ballastNode.add(new Konva.Text({
            x: b.x + 4, y: b.y + 3,
            text: 'BALLAST', fontSize: 7, fill: '#a0a060', fontStyle: 'bold',
        }));
        this._ballastNode.add(new Konva.Text({
            x: b.x + 4, y: b.y + b.h - 12,
            text: `${this.ratedPower}W`, fontSize: 7, fill: '#808050',
        }));
        // 接线端子（两侧）
        ['L', 'N'].forEach((lbl, i) => {
            const tx = i === 0 ? b.x - 8 : b.x + b.w + 2;
            const ty = b.y + b.h * 0.35;
            this._ballastNode.add(new Konva.Rect({
                x: tx, y: ty, width: 10, height: b.h * 0.30,
                fill: '#b8982a', stroke: '#8a7020', strokeWidth: 0.8, cornerRadius: 1,
            }));
            this._ballastNode.add(new Konva.Text({
                x: tx, y: ty - 8, text: lbl, fontSize: 7, fill: '#90caf9', fontStyle: 'bold',
            }));
        });

        this._staticGroup.add(this._ballastNode);
    }

    // ── 内部接线示意 ─────────────────────────
    _drawWiring() {
        const b  = this._ballast;
        const s  = this._starter;
        const tL = this._sockL;
        const tR = this._sockR;
        const W  = this.width, H = this.height;

        const wireStyle = { stroke: '#607d8b', strokeWidth: 1.2, opacity: 0.6 };

        // 火线：左端子 → 镇流器左端
        this._staticGroup.add(new Konva.Line({
            points: [
                this._terminalL.x, this._fixture.y + this._fixture.h - 6,
                this._terminalL.x, b.y + b.h * 0.50,
                b.x - 8 + 5, b.y + b.h * 0.50,
            ],
            ...wireStyle,
        }));
        // 镇流器右端 → 左灯脚
        this._staticGroup.add(new Konva.Line({
            points: [
                b.x + b.w + 8, b.y + b.h * 0.50,
                tL.x + tL.w / 2, b.y + b.h * 0.50,
                tL.x + tL.w / 2, tL.y + tL.h * 0.80,
            ],
            ...wireStyle,
        }));
        // 零线：右端子 → 右灯脚
        this._staticGroup.add(new Konva.Line({
            points: [
                this._terminalN.x, this._fixture.y + this._fixture.h - 6,
                this._terminalN.x, tR.y + tR.h * 0.80,
                tR.x + tR.w / 2, tR.y + tR.h * 0.80,
            ],
            ...wireStyle,
        }));
        // 启辉器接线：左灯脚 → 启辉器 → 右灯脚
        this._staticGroup.add(new Konva.Line({
            points: [
                tL.x + tL.w / 2, b.y + b.h * 0.70,
                s.cx - s.r - 4, s.cy,
            ],
            ...wireStyle, stroke: '#78909c',
        }));
        this._staticGroup.add(new Konva.Line({
            points: [
                s.cx + s.r + 4, s.cy,
                tR.x + tR.w / 2, b.y + b.h * 0.70,
                tR.x + tR.w / 2, tR.y + tR.h * 0.80,
            ],
            ...wireStyle, stroke: '#78909c',
        }));
    }

    // ── 灯管（动态重绘）────────────────────
    _rebuildTube() {
        this._tubeGroup.destroyChildren();
        this._glowGroup.destroyChildren();

        const t   = this._tube;
        const bri = this._brightness * this._flickerVal;
        const rx  = t.rx;

        // 灯管玻璃外壳（透明管体）
        const tubeMain = new Konva.Rect({
            x: t.x, y: t.y, width: t.w, height: t.h,
            fill: this._getTubeColor(bri),
            stroke: '#aab0b8', strokeWidth: 1.2,
            cornerRadius: rx,
        });
        this._tubeGroup.add(tubeMain);

        // 玻璃管高光（顶部弧面反射）
        this._tubeGroup.add(new Konva.Rect({
            x: t.x + rx * 0.5, y: t.y + 2,
            width: t.w - rx, height: t.h * 0.28,
            fill: `rgba(255,255,255,${0.12 + bri * 0.25})`,
            cornerRadius: [rx * 0.5, rx * 0.5, 0, 0],
        }));
        // 玻璃管底部阴影
        this._tubeGroup.add(new Konva.Rect({
            x: t.x + rx * 0.5, y: t.y + t.h * 0.70,
            width: t.w - rx, height: t.h * 0.28,
            fill: `rgba(0,0,0,${0.10 + (1 - bri) * 0.15})`,
            cornerRadius: [0, 0, rx * 0.5, rx * 0.5],
        }));

        // 左端灯脚（电极引线）
        this._drawTubeElectrode(t.x + rx * 0.5, t.y, t.h, bri, 'L');
        // 右端灯脚（电极引线）
        this._drawTubeElectrode(t.x + t.w - rx * 0.5, t.y, t.h, bri, 'R');

        // ── 发光辉光层 ──
        if (bri > 0.01) {
            const glowAlpha = bri * 0.45;
            const glowColor = this._getGlowColor(bri);

            // 管外扩散光晕
            this._glowGroup.add(new Konva.Rect({
                x: t.x - 8, y: t.y - 10,
                width: t.w + 16, height: t.h + 20,
                fill: glowColor.replace('ALPHA', String(glowAlpha * 0.5)),
                cornerRadius: rx + 10,
                filters: [],
            }));
            // 反光板照射效果
            this._glowGroup.add(new Konva.Rect({
                x: this._reflector.x, y: this._reflector.y,
                width: this._reflector.w, height: this._reflector.h,
                fill: glowColor.replace('ALPHA', String(glowAlpha * 0.3)),
            }));
            // 向下投光（地面方向）
            const lightY = t.y + t.h;
            this._glowGroup.add(new Konva.Shape({
                sceneFunc: (ctx, shape) => {
                    ctx.beginPath();
                    ctx.moveTo(t.x + t.w * 0.1, lightY);
                    ctx.lineTo(t.x - 20, this._fixture.y + this._fixture.h + 5);
                    ctx.lineTo(t.x + t.w + 20, this._fixture.y + this._fixture.h + 5);
                    ctx.lineTo(t.x + t.w * 0.9, lightY);
                    ctx.closePath();
                    ctx.fillStrokeShape(shape);
                },
                fill: glowColor.replace('ALPHA', String(glowAlpha * 0.18)),
                stroke: 'transparent',
            }));
        }

        // 灯管内部荧光粉涂层效果（细密点纹）
        const dotAlpha = 0.04 + bri * 0.02;
        for (let i = 0; i < 8; i++) {
            this._tubeGroup.add(new Konva.Line({
                points: [
                    t.x + rx + (t.w - rx * 2) * (i / 8), t.y + 3,
                    t.x + rx + (t.w - rx * 2) * (i / 8), t.y + t.h - 3,
                ],
                stroke: `rgba(220,220,200,${dotAlpha})`,
                strokeWidth: 0.6,
            }));
        }
    }

    _drawTubeElectrode(ex, ey, eh, bri, side) {
        // 灯脚金属引线（两根）
        const pinH  = eh * 0.85;
        const pinX1 = side === 'L' ? ex - 4 : ex - 2;
        const pinX2 = side === 'L' ? ex + 2 : ex + 4;
        const pinY  = ey + eh * 0.075;

        [pinX1, pinX2].forEach(px => {
            this._tubeGroup.add(new Konva.Line({
                points: [px, pinY, px, pinY + pinH],
                stroke: '#c8c0a0', strokeWidth: 1.4, lineCap: 'round',
            }));
        });

        // 灯丝（两引脚之间的W形钨丝）
        const fY  = ey + eh * 0.50;
        const fw  = 10;
        const fpts = [
            pinX1,     fY - 3,
            pinX1 + 2, fY + 3,
            (pinX1+pinX2)/2, fY - 3,
            pinX2 - 2, fY + 3,
            pinX2,     fY - 3,
        ];
        // 灯丝加热辉光
        const heatAlpha = this._state === 'preheating' ? 0.7 + Math.sin(Date.now() / 60) * 0.3
                        : this._state === 'on'         ? bri * 0.3
                        : 0;
        if (heatAlpha > 0.05) {
            this._tubeGroup.add(new Konva.Line({
                points: fpts,
                stroke: `rgba(255,140,40,${heatAlpha})`,
                strokeWidth: 4, lineCap: 'round', lineJoin: 'round', tension: 0.3,
            }));
        }
        this._tubeGroup.add(new Konva.Line({
            points: fpts,
            stroke: heatAlpha > 0.3
                ? `rgba(255,200,120,${0.8 + heatAlpha * 0.2})`
                : '#b0a888',
            strokeWidth: 1.5, lineCap: 'round', lineJoin: 'round', tension: 0.3,
        }));
    }

    _getTubeColor(bri) {
        if (bri < 0.01) return 'rgba(200,210,215,0.25)';  // 熄灭：轻透明
        // 冷启动闪光
        if (this._state === 'igniting' && bri > 0.8) {
            return `rgba(240,245,255,${0.5 + bri * 0.4})`;
        }
        // 正常发光颜色（色温影响）
        const warm = this.colorTemp < 4500;
        if (warm) {
            return `rgba(255,252,230,${0.15 + bri * 0.70})`;
        } else {
            return `rgba(235,242,255,${0.15 + bri * 0.70})`;
        }
    }

    _getGlowColor(bri) {
        const warm = this.colorTemp < 4500;
        if (this._state === 'igniting') return `rgba(180,190,255,ALPHA)`;
        return warm
            ? `rgba(255,248,200,ALPHA)`
            : `rgba(220,235,255,ALPHA)`;
    }

    // ── 启辉器（动态重绘）──────────────────
    _rebuildStarter() {
        this._starterGroup.destroyChildren();
        const s   = this._starter;
        const cx  = s.cx, cy = s.cy, r = s.r;
        const isActive = this._state === 'starting' || this._state === 'preheating';

        // 启辉器铝壳（圆柱正视图）
        this._starterGroup.add(new Konva.Ellipse({
            x: cx, y: cy,
            radiusX: r, radiusY: r * 0.55,
            fillLinearGradientStartPoint: { x: -r, y: 0 },
            fillLinearGradientEndPoint:   { x:  r, y: 0 },
            fillLinearGradientColorStops: [
                0,   '#888',
                0.25,'#ccc',
                0.55,'#e8e8e8',
                0.80,'#aaa',
                1,   '#888',
            ],
            stroke: '#666', strokeWidth: 1,
        }));
        // 铝壳顶面
        this._starterGroup.add(new Konva.Ellipse({
            x: cx, y: cy - r * 0.55,
            radiusX: r, radiusY: r * 0.25,
            fill: '#ccc', stroke: '#aaa', strokeWidth: 0.8,
        }));
        // 放电玻璃泡（内部可见）
        this._starterGroup.add(new Konva.Ellipse({
            x: cx, y: cy,
            radiusX: r * 0.62, radiusY: r * 0.35,
            fill: isActive && this._starterFlash > 0.1
                ? `rgba(160,140,255,${this._starterFlash * 0.6})`
                : 'rgba(160,200,220,0.20)',
            stroke: 'rgba(150,180,220,0.50)', strokeWidth: 0.5,
        }));

        // 双金属片（两条，闭合时呈弧形）
        const bmAngle = this._bimetalAngle; // 0=断开，1=闭合
        const bx0 = cx - r * 0.45;
        const bx1 = cx + r * 0.45;
        const gap  = r * 0.28 * (1 - bmAngle);
        const arcH = r * 0.20 * bmAngle;

        // 左片
        this._starterGroup.add(new Konva.Line({
            points: [
                bx0, cy - gap,
                bx0 + (bx1 - bx0) * 0.5, cy - gap - arcH,
                bx1, cy - gap,
            ],
            stroke: '#e8b860', strokeWidth: 1.8,
            tension: 0.5, lineCap: 'round',
        }));
        // 右片
        this._starterGroup.add(new Konva.Line({
            points: [
                bx0, cy + gap,
                bx0 + (bx1 - bx0) * 0.5, cy + gap + arcH,
                bx1, cy + gap,
            ],
            stroke: '#d0a050', strokeWidth: 1.8,
            tension: 0.5, lineCap: 'round',
        }));

        // 放电弧（启动时）
        if (isActive && this._starterFlash > 0.3) {
            for (let i = 0; i < 2; i++) {
                const sx = cx + (Math.random() - 0.5) * r * 0.6;
                this._starterGroup.add(new Konva.Line({
                    points: [
                        bx0 + r * 0.4, cy - gap * 0.5,
                        sx, cy + (Math.random() - 0.5) * gap,
                        bx1 - r * 0.4, cy + gap * 0.5,
                    ],
                    stroke: `rgba(${150 + Math.floor(Math.random()*60)},120,255,${this._starterFlash * 0.9})`,
                    strokeWidth: 0.8 + Math.random() * 0.8,
                    lineCap: 'round', tension: 0.6,
                }));
            }
        }

        // 底部两根接线引脚
        const pinR = r * 0.15;
        [-r * 0.30, r * 0.30].forEach(dx => {
            this._starterGroup.add(new Konva.Line({
                points: [cx + dx, cy + r * 0.55, cx + dx, cy + r * 0.55 + 10],
                stroke: '#b0a888', strokeWidth: 2.0, lineCap: 'round',
            }));
        });

        // 标注
        this._starterGroup.add(new Konva.Text({
            x: cx - r, y: cy + r * 0.55 + 12,
            width: r * 2, text: 'STARTER', fontSize: 6,
            fill: '#78909c', align: 'center', fontStyle: 'bold',
        }));
    }

    // ── 标注 ─────────────────────────────────
    _drawLabel() {
        this._staticGroup.add(new Konva.Text({
            x: 0, y: -16, width: this.width,
            text: `${this.label}  ${this.ratedVoltage}V / ${this.ratedPower}W  ${this.colorTemp}K`,
            fontSize: 9, fontStyle: 'bold', fill: '#546e7a', align: 'center',
        }));
        this._staticGroup.add(new Konva.Text({
            x: this._terminalL.x - 4,
            y: this._fixture.y + this._fixture.h + 5,
            text: 'L', fontSize: 8, fill: '#ef9a9a', fontStyle: 'bold',
        }));
        this._staticGroup.add(new Konva.Text({
            x: this._terminalN.x - 4,
            y: this._fixture.y + this._fixture.h + 5,
            text: 'N', fontSize: 8, fill: '#90caf9', fontStyle: 'bold',
        }));
    }

    // ── 状态指示 ─────────────────────────────
    _drawStatusIndicator() {
        const ix = this._fixture.x + 14;
        const iy = this._fixture.y + this._fixture.h - 10;
        const stateColors = {
            off:        ['#546e7a', '#37474f'],
            starting:   ['#ffa726', '#e65100'],
            preheating: ['#ff7043', '#bf360c'],
            igniting:   ['#ffee58', '#f9a825'],
            on:         ['#66bb6a', '#2e7d32'],
            fault:      ['#ef5350', '#c62828'],
        };
        const [fc, sc] = stateColors[this._state] || stateColors.off;
        this._statusDot = new Konva.Circle({
            x: ix, y: iy, radius: 4,
            fill: fc, stroke: sc, strokeWidth: 0.8,
            shadowColor: fc, shadowBlur: this._state === 'on' ? 6 : 2, shadowOpacity: 0.8,
        });
        const stateText = {
            off: '关', starting: '启', preheating: '热', igniting: '点', on: '亮', fault: '故',
        };
        this._statusText = new Konva.Text({
            x: ix + 7, y: iy - 5,
            text: stateText[this._state] || '?',
            fontSize: 8, fontStyle: 'bold', fill: fc,
        });
        this._staticGroup.add(this._statusDot, this._statusText);
    }

    // ─────────────────────────────────────────
    // 集中化 tick（由 consys._tickAll 在 20fps 调用）
    tick(dt) {
        this._tick(dt, ts);
    
        this._refreshCache();
    }

    _tick(dt, ts) {
        let dirty = false;

        switch (this._state) {
            case 'off':
                if (this._brightness > 0) {
                    this._brightness = Math.max(0, this._brightness - dt * 5);
                    dirty = true;
                }
                this._starterFlash  = 0;
                this._bimetalAngle  = 0;
                this._ballastShake  = 0;
                break;

            case 'starting':
                this._stateTime += dt;
                // 启辉器放电闪烁
                this._lastFlashTs += dt;
                if (this._lastFlashTs >= this._flashInterval) {
                    this._starterFlash  = Math.random() > 0.4 ? 0.5 + Math.random() * 0.5 : 0;
                    this._lastFlashTs   = 0;
                    this._flashInterval = 0.05 + Math.random() * 0.08;
                    dirty = true;
                }
                // 双金属片逐渐弯曲闭合
                this._bimetalAngle = Math.min(1, this._stateTime / this._dur.starting);
                // 灯丝开始微弱预热
                this._brightness = Math.min(0.05, this._brightness + dt * 0.1);
                if (this._stateTime >= this._dur.starting) {
                    this._setState('preheating');
                }
                dirty = true;
                break;

            case 'preheating':
                this._stateTime += dt;
                // 双金属片保持闭合
                this._bimetalAngle = 1;
                // 灯丝逐渐加热（橙红色，_rebuildTube 中用 state 判断）
                this._brightness = 0.05 + Math.sin(this._stateTime * 8) * 0.02;
                this._starterFlash = 0;
                if (this._stateTime >= this._dur.preheating) {
                    this._setState('igniting');
                }
                dirty = true;
                break;

            case 'igniting':
                this._stateTime += dt;
                // 双金属片断开（冷却）
                this._bimetalAngle = Math.max(0, 1 - this._stateTime / (this._dur.igniting * 0.4));
                // 高压脉冲 → 全管短暂强闪白
                const igProg = this._stateTime / this._dur.igniting;
                if (igProg < 0.3) {
                    this._brightness = 0.05 + igProg * 3;  // 急速升亮
                } else {
                    // 随机决定是否点燃成功
                    if (!this._igniteDecided) {
                        this._igniteDecided = true;
                        this._igniteSuccess = Math.random() > (this._retryCount > 0 ? 0.05 : 0.10);
                    }
                    if (this._igniteSuccess) {
                        // 成功：亮度稳定到1
                        this._brightness = Math.min(1, 0.95 + (igProg - 0.3) * 0.7);
                        if (igProg >= 1.0) this._setState('on');
                    } else {
                        // 失败：熄灭，重试
                        this._brightness = Math.max(0, 1 - (igProg - 0.3) * 3);
                        if (igProg >= 1.0) {
                            this._retryCount++;
                            if (this._retryCount >= this._maxRetry) {
                                this._setState('fault');
                            } else {
                                this._setState('starting');
                            }
                        }
                    }
                }
                dirty = true;
                break;

            case 'on':
                this._stateTime += dt;
                this._brightness = 1;
                // 50Hz 频闪（非常轻微）
                if (this.flickerEnable) {
                    this._flickerPhase += dt * Math.PI * 100; // 50Hz * 2π
                    this._flickerVal = 0.96 + 0.04 * Math.abs(Math.sin(this._flickerPhase));
                }
                // 镇流器轻微震动
                this._ballastShake = Math.sin(ts * 0.1) * 0.3;
                this._starterFlash = 0;
                this._bimetalAngle = 0;
                dirty = true;
                break;

            case 'fault':
                this._brightness    = 0;
                this._starterFlash  = 0;
                // 故障状态：轻微间歇性闪烁
                if (Math.random() < 0.01) {
                    this._brightness = 0.1;
                    dirty = true;
                }
                break;
        }

        if (dirty) {
            this._rebuildTube();
            this._rebuildStarter();
            this._updateStatus();
            // 镇流器震动
            if (this._ballastNode) {
                this._ballastNode.offsetY(this._ballastShake);
            }
            this._refreshCache();
        }
    }

    _setState(s) {
        this._state         = s;
        this._stateTime     = 0;
        this._igniteDecided = false;
        this._igniteSuccess = false;
        this._lastFlashTs   = 0;
    }

    _updateStatus() {
        const stateColors = {
            off:        '#546e7a',
            starting:   '#ffa726',
            preheating: '#ff7043',
            igniting:   '#ffee58',
            on:         '#66bb6a',
            fault:      '#ef5350',
        };
        const stateText = {
            off: '关', starting: '启', preheating: '热', igniting: '点', on: '亮', fault: '故',
        };
        const fc = stateColors[this._state] || '#546e7a';
        if (this._statusDot) {
            this._statusDot.fill(fc);
            this._statusDot.stroke(fc);
            this._statusDot.shadowColor(fc);
            this._statusDot.shadowBlur(this._state === 'on' ? 7 : 2);
        }
        if (this._statusText) {
            this._statusText.text(stateText[this._state] || '?');
            this._statusText.fill(fc);
        }
    }

    // ── 交互绑定 ─────────────────────────────
    _bindInteraction() {
        this._tubeGroup.on('click tap', () => this.toggle());
        this._starterGroup.on('click tap', () => {
            // 点击启辉器：手动触发重试
            if (this._state === 'fault') this.turnOn();
        });
        this._tubeGroup.listening(true);
        this._starterGroup.listening(true);
    }

    // ═══════════════════════════════════════════
    /** 开灯 */
    turnOn() {
        if (this._state !== 'off' && this._state !== 'fault') return;
        this._retryCount = 0;
        this._setState('starting');
        this._refreshCache();
    }

    /** 关灯 */
    turnOff() {
        if (this._state === 'off') return;
        this._setState('off');
        this._refreshCache();
    }

    /** 切换 */
    toggle() {
        if (this._state === 'off' || this._state === 'fault') {
            this.turnOn();
        } else {
            this.turnOff();
        }
    }

    /** 查询 */
    isOn()       { return this._state === 'on'; }
    getState()   { return this._state; }
    getBrightness() { return this._brightness; }

    update(state) {
        if (typeof state === 'boolean') {
            state ? this.turnOn() : this.turnOff();
        }
        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label: '位号/名称',         key: 'label',         type: 'text'   },
            { label: '额定电压 (V)',       key: 'ratedVoltage',  type: 'number' },
            { label: '额定功率 (W)',       key: 'ratedPower',    type: 'number' },
            { label: '色温 (K)',           key: 'colorTemp',     type: 'number' },
            { label: '频闪模拟 (1=开)',    key: 'flickerEnable', type: 'number' },
            { label: '最大重试次数',       key: 'maxRetry',      type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        this.label         = cfg.label         || this.label;
        this.ratedVoltage  = parseFloat(cfg.ratedVoltage)  || this.ratedVoltage;
        this.ratedPower    = parseFloat(cfg.ratedPower)    || this.ratedPower;
        this.colorTemp     = parseFloat(cfg.colorTemp)     || this.colorTemp;
        this.flickerEnable = !!parseInt(cfg.flickerEnable);
        this._maxRetry     = parseInt(cfg.maxRetry)        || this._maxRetry;
        this.config        = { ...this.config, ...cfg };
        this._refreshCache();
    }

    destroy() {
        super.destroy?.();
    }
}