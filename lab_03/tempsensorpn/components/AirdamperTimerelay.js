import { BaseComponent } from './BaseComponent.js';

/**
 * 空气阻尼式时间继电器仿真组件
 * （Air Damper / Pneumatic Time Relay — JS7-A 系列）
 *
 * ── 核心工作原理 ──────────────────────────────────────────────
 *
 *  空气阻尼式时间继电器（又称气囊式时间继电器）利用空气
 *  通过节流小孔时产生的阻尼来实现时间延迟：
 *
 *  ┌─────────────────────────────────────────────────────────┐
 *  │  得电时序（通电延时型 JS7-2A）：                         │
 *  │                                                         │
 *  │  线圈得电 → 电磁铁吸合衔铁 → 衔铁压弹簧下移             │
 *  │  → 活塞杆与气囊脱扣 → 弹簧推动活塞向上运动              │
 *  │  → 气囊中的空气通过节流孔缓慢排出                       │
 *  │  → 活塞运动速度受气流限制（时间延迟）                    │
 *  │  → 活塞到达顶部 → 触动微动开关 → 延时触点动作           │
 *  │                                                         │
 *  │  失电：电磁铁释放 → 复位弹簧使活塞快速下移（无延时）     │
 *  │  → 触点立即复位                                         │
 *  │                                                         │
 *  │  时间调节：旋转调节螺旋改变节流孔开度                    │
 *  │  开度大 → 空气流速快 → 延时短                           │
 *  │  开度小 → 空气流速慢 → 延时长                           │
 *  └─────────────────────────────────────────────────────────┘
 *
 * ── 内部机械结构详解 ──────────────────────────────────────────
 *
 *  ┌──────────────────────────────────────────────────────┐
 *  │  ① 电磁系统（上部）                                  │
 *  │     ┌─────────────────────────────────────────────┐ │
 *  │     │  铁芯（Core）：E 形硅钢片叠压               │ │
 *  │     │  线圈（Coil）：漆包铜线绕制，AC 220V/380V   │ │
 *  │     │  衔铁（Armature）：可动 E 形铁片            │ │
 *  │     │  短路环（Shading Ring）：消除交流颤动        │ │
 *  │     └─────────────────────────────────────────────┘ │
 *  │                                                      │
 *  │  ② 气囊阻尼系统（中部，核心延时机构）                │
 *  │     ┌─────────────────────────────────────────────┐ │
 *  │     │  橡皮气囊（Rubber Bellows/Diaphragm）       │ │
 *  │     │    材质：合成橡胶（耐油、耐老化）            │ │
 *  │     │    形状：波纹状，允许轴向形变                │ │
 *  │     │  活塞杆（Piston Rod）                        │ │
 *  │     │  节流孔（Orifice）：直径约 0.1~0.3mm        │ │
 *  │     │    孔径决定空气流速 → 决定延时时间           │ │
 *  │     │  调节螺旋（Adjusting Screw）                 │ │
 *  │     │    旋转改变气道截面积                        │ │
 *  │     │  进/排气孔（Air Vent）                       │ │
 *  │     └─────────────────────────────────────────────┘ │
 *  │                                                      │
 *  │  ③ 触点系统（下部）                                  │
 *  │     ┌─────────────────────────────────────────────┐ │
 *  │     │  延时动合触点（Delayed NO）：1 对            │ │
 *  │     │  延时动断触点（Delayed NC）：1 对            │ │
 *  │     │  瞬动触点（Instant NO/NC）：由衔铁直接驱动  │ │
 *  │     │  微动开关（Micro Switch）：感应活塞位置      │ │
 *  │     └─────────────────────────────────────────────┘ │
 *  └──────────────────────────────────────────────────────┘
 *
 * ── JS7-A 系列型号说明 ────────────────────────────────────────
 *
 *  JS7-1A：通电延时，1 副延时触点（NO）
 *  JS7-2A：通电延时，2 副延时触点（NO + NC）
 *  JS7-3A：通电延时，3 副延时触点
 *  JS7-4A：断电延时，2 副延时触点
 *
 *  延时范围：
 *    短时型：0.4s ~ 60s
 *    长时型：0.4s ~ 180s
 *  精度：±10%（温度、湿度影响）
 *  控制电源：AC 36V / 127V / 220V / 380V
 *
 * ── 仿真特性详解 ──────────────────────────────────────────────
 *
 *  1. 电磁铁吸合动画：
 *     - 线圈得电时，衔铁平滑向下吸合（80ms 过程）
 *     - 铁芯磁场辉光（蓝紫色磁感线可视化）
 *     - 短路环高亮（标注其消振作用）
 *
 *  2. 气囊阻尼动画（核心）：
 *     - 橡皮气囊随活塞运动产生波纹形变
 *     - 活塞杆从初始位置缓慢向上移动
 *     - 节流孔处气流粒子动画（空气微粒向外喷射）
 *     - 气囊颜色从自然橡胶色 → 压缩时略变深
 *
 *  3. 活塞行程进度条：
 *     - 侧面竖向进度条显示活塞当前位置（0→延时时间到）
 *     - 颜色：绿→黄→红（接近终点）
 *
 *  4. 延时触点切换：
 *     - 活塞到达顶部瞬间，微动开关弹跳动画
 *     - 延时 NO 闭合、延时 NC 断开
 *     - 触点接触点发橙黄导通辉光
 *     - 切换时产生蓝白微弧光
 *
 *  5. 调节旋钮：
 *     - 可拖动旋转调节延时时间
 *     - 旋钮刻度与延时时间对应
 *     - 旋转方向：顺时针 = 延时变长
 *
 *  6. 断电复位动画：
 *     - 线圈失电，衔铁快速弹起（20ms）
 *     - 活塞被复位弹簧快速下压（100ms）
 *     - 触点立即复位（无延时）
 *
 *  7. 剖面透视效果：
 *     - 气囊区域半透明，可见内部活塞运动
 *     - 节流孔标注（放大镜效果）
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  coil_A1     — 线圈进线端（控制电源）
 *  coil_A2     — 线圈出线端（控制电源）
 *  delay_NO_3  — 延时常开触点（3）公共端
 *  delay_NO_4  — 延时常开触点（4）
 *  delay_NC_5  — 延时常闭触点（5）公共端
 *  delay_NC_6  — 延时常闭触点（6）
 *  inst_NO_1   — 瞬动常开触点（1）
 *  inst_NO_2   — 瞬动常开触点（2）
 */
export class AirDamperTimeRelay extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(180, config.width  || 230);
        this.height = Math.max(300, config.height || 380);

        this.type    = 'air_damper_time_relay';
        this.special = 'none';
        this.cache   = 'fixed';

        // ── 额定参数 ──
        this.label         = config.label         || 'KT';
        this.coilVoltage   = config.coilVoltage   || 220;   // V AC
        this.model         = config.model         || 'JS7-2A';
        // 延时范围：min ~ max（s）
        this.delayMin      = config.delayMin      || 0.4;
        this.delayMax      = config.delayMax      || 60;
        // 当前设定延时（s）
        this.setDelay      = config.setDelay      !== undefined ? config.setDelay : 10;
        // 延时类型：'TON'=通电延时(JS7-1/2/3A) | 'TOF'=断电延时(JS7-4A)
        this.delayType     = config.delayType     || 'TON';

        // ── 内部物理状态 ──
        this._coilOn       = false;   // 线圈是否得电
        // 电磁铁吸合状态（0=释放，1=完全吸合）
        this._armaturePos  = 0;       // 0~1
        this._armatureVel  = 0;       // 速度（用于阻尼弹簧模型）
        // 活塞位置（0=底部初始，1=顶部触发位）
        this._pistonPos    = 0;       // 0~1
        this._pistonVel    = 0;
        // 气囊压缩量（0=自然，1=最大压缩）
        this._bellowsDeform = 0;      // 0~1
        // 延时计时
        this._elapsed      = 0;       // 已计时 s
        this._timing       = false;   // 正在计时中
        this._timingDone   = false;   // 延时时间到
        // 触点状态
        this._delayNO      = false;   // 延时常开（3-4）
        this._delayNC      = true;    // 延时常闭（5-6）
        this._instantNO    = false;   // 瞬动常开（1-2）
        // 气流粒子
        this._airParticles = [];
        // 切换弧光
        this._arcFlash     = 0;
        // 上一帧触点状态（用于检测边沿）
        this._prevDelayNO  = false;
        // 调节旋钮角度（映射延时时间）
        this._knobAngle    = this._delayToKnobAngle(this.setDelay);
        // 全局动画相位
        this._glowPhase    = 0;
        // 操作计数
        this.opsCount      = 0;

        this._lastTs = null;
        this._animId = null;

        // ── 几何布局 ──
        const W = this.width, H = this.height;

        // 外壳
        this._body = {
            x: W * 0.05, y: H * 0.02,
            w: W * 0.90, h: H * 0.88,
            rx: 4,
        };

        // 电磁铁（上部 38%）
        this._magnetRegion = {
            x: W * 0.08, y: H * 0.04,
            w: W * 0.84, h: H * 0.34,
        };

        // E 形铁芯（静止）
        this._core = {
            cx: W * 0.42, cy: H * 0.145,
            w:  W * 0.54, h:  H * 0.12,
        };

        // 线圈（铁芯中柱缠绕区）
        this._coil = {
            cx: W * 0.42,
            y:  H * 0.085,
            w:  W * 0.22, h: H * 0.10,
        };

        // 衔铁（动铁）
        this._armature = {
            cx:     W * 0.42,
            baseY:  H * 0.23,    // 释放位（低）
            closedY:H * 0.205,   // 吸合位（高）
            w:      W * 0.54,
            h:      H * 0.028,
        };

        // 气囊阻尼区（中部 30%）
        this._bellowsRegion = {
            x: W * 0.18, y: H * 0.38,
            w: W * 0.48, h: H * 0.26,
            rx: 4,
        };

        // 活塞杆（在气囊内）
        this._piston = {
            cx:       W * 0.42,
            topY:     H * 0.40,   // 到达顶部（触发位）
            bottomY:  H * 0.62,   // 底部初始位
            w:        W * 0.045,
        };

        // 节流孔（气囊中部）
        this._orifice = {
            cx: W * 0.42,
            cy: H * 0.515,
            r:  W * 0.018,
        };

        // 调节旋钮（气囊区右侧）
        this._knob = {
            cx: W * 0.80,
            cy: H * 0.510,
            r:  W * 0.085,
        };

        // 触点区（下部）
        this._contactRegion = {
            x: W * 0.06, y: H * 0.66,
            w: W * 0.88, h: H * 0.16,
            rx: 3,
        };

        // 延时触点（3-4）
        this._ctDelay = {
            cx: W * 0.30, cy: H * 0.745, w: W * 0.32, h: H * 0.055,
        };
        // 延时常闭触点（5-6）
        this._ctDelayNC = {
            cx: W * 0.30, cy: H * 0.810, w: W * 0.32, h: H * 0.055,
        };
        // 瞬动触点（1-2）
        this._ctInstant = {
            cx: W * 0.75, cy: H * 0.775, w: W * 0.32, h: H * 0.055,
        };

        // 进度条（活塞位置可视化，外壳右侧）
        this._progressBar = {
            x: W * 0.88, y: H * 0.38,
            w: W * 0.06, h: H * 0.26,
            rx: 2,
        };

        // 端子区（底部）
        const termY = this._body.y + this._body.h;
        this._ports = [
            { id: 'coil_A1',    label: 'A1', x: W * 0.12, y: termY },
            { id: 'coil_A2',    label: 'A2', x: W * 0.28, y: termY },
            { id: 'delay_NO_3', label: '3',  x: W * 0.44, y: termY },
            { id: 'delay_NO_4', label: '4',  x: W * 0.56, y: termY },
            { id: 'delay_NC_5', label: '5',  x: W * 0.68, y: termY },
            { id: 'delay_NC_6', label: '6',  x: W * 0.80, y: termY },
        ];

        this._init();

        this._ports.forEach(p => {
            this.addPort(p.x, p.y + 6, p.id, 'wire', p.label);
        });
    }

    // ═══════════════════════════════════════════
    _init() {
        this._drawBody();
        this._drawMagnetStatic();
        this._drawBellowsShell();
        this._drawKnobStatic();
        this._drawContactRegion();
        this._drawTerminals();
        this._drawProgressBarBg();

        // 动态层
        this._magnetDynGroup  = new Konva.Group(); // 衔铁 + 磁场
        this._bellowsDynGroup = new Konva.Group(); // 气囊 + 活塞 + 气流粒子
        this._contactDynGroup = new Konva.Group(); // 触点动态
        this._progressDynGroup= new Konva.Group(); // 进度条
        this._knobDynGroup    = new Konva.Group(); // 旋钮指针

        this.group.add(this._bellowsDynGroup);
        this.group.add(this._magnetDynGroup);
        this.group.add(this._contactDynGroup);
        this.group.add(this._progressDynGroup);
        this.group.add(this._knobDynGroup);

        this._drawLabel();
        this._drawStatusPanel();

        this._rebuildAll();
        this._bindInteraction();
        this._startAnimation();
    }

    // ── 外壳 ─────────────────────────────────
    _drawBody() {
        const b = this._body, W = this.width, H = this.height;

        // 主壳体（黑色酚醛树脂/ABS）
        this.group.add(new Konva.Rect({
            x: b.x, y: b.y, width: b.w, height: b.h,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: b.w, y: b.h },
            fillLinearGradientColorStops: [
                0,   '#2a2a30',
                0.30,'#323238',
                0.65,'#2e2e34',
                1,   '#222228',
            ],
            stroke: '#181820', strokeWidth: 1.5,
            cornerRadius: b.rx,
            shadowColor: '#000', shadowBlur: 14, shadowOffsetY: 4, shadowOpacity: 0.50,
        }));

        // 顶面高光
        this.group.add(new Konva.Rect({
            x: b.x + 2, y: b.y + 2, width: b.w - 4, height: b.h * 0.03,
            fill: 'rgba(255,255,255,0.08)',
            cornerRadius: [b.rx, b.rx, 0, 0],
        }));

        // 上/下分区横线（电磁区与阻尼区、阻尼区与触点区分隔）
        [H * 0.375, H * 0.655].forEach(fy => {
            this.group.add(new Konva.Line({
                points: [b.x + 4, fy, b.x + b.w - 4, fy],
                stroke: 'rgba(255,255,255,0.06)', strokeWidth: 1,
            }));
        });

        // 角螺钉
        [[b.x + 7, b.y + 7], [b.x + b.w - 7, b.y + 7],
         [b.x + 7, b.y + b.h - 7], [b.x + b.w - 7, b.y + b.h - 7]
        ].forEach(([sx, sy]) => {
            this.group.add(new Konva.Circle({ x: sx, y: sy, radius: 3.2, fill: '#484850', stroke: '#28283a', strokeWidth: 0.6 }));
            this.group.add(new Konva.Line({ points: [sx - 2, sy - 2, sx + 2, sy + 2], stroke: '#383848', strokeWidth: 0.8 }));
        });

        // 型号铭牌
        const npY = b.y + b.h * 0.92;
        this.group.add(new Konva.Rect({ x: b.x + b.w * 0.10, y: npY, width: b.w * 0.80, height: H * 0.04, fill: '#181820', stroke: '#0e0e18', strokeWidth: 0.5, cornerRadius: 1 }));
        this.group.add(new Konva.Text({
            x: b.x + b.w * 0.10, y: npY + 2, width: b.w * 0.80,
            text: `${this.model}  ${this.coilVoltage}V  ${this.delayType}`,
            fontSize: 6.5, fill: 'rgba(160,180,200,0.55)',
            align: 'center', fontFamily: 'Courier New',
        }));
    }

    // ── 电磁铁静态部分（铁芯 + 线圈骨架）────
    _drawMagnetStatic() {
        const W = this.width, H = this.height;
        const mr = this._magnetRegion;
        const co = this._core;

        // 电磁区背板（深灰）
        this.group.add(new Konva.Rect({
            x: mr.x, y: mr.y, width: mr.w, height: mr.h,
            fill: '#1e2028', stroke: '#141820', strokeWidth: 0.8, cornerRadius: 2,
        }));

        // E 形铁芯静铁（三柱横梁）
        const coreColor0 = [
            0, '#3a3840', 0.3, '#525058', 0.7, '#484650', 1, '#2e2c36',
        ];
        // 上横梁
        this.group.add(new Konva.Rect({
            x: co.cx - co.w / 2, y: co.cy - co.h / 2,
            width: co.w, height: co.h * 0.22,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: 0, y: co.h * 0.22 },
            fillLinearGradientColorStops: coreColor0,
            stroke: '#20202a', strokeWidth: 0.8,
        }));
        // 下横梁
        this.group.add(new Konva.Rect({
            x: co.cx - co.w / 2, y: co.cy + co.h * 0.28,
            width: co.w, height: co.h * 0.22,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: 0, y: co.h * 0.22 },
            fillLinearGradientColorStops: coreColor0,
            stroke: '#20202a', strokeWidth: 0.8,
        }));
        // 左柱
        this.group.add(new Konva.Rect({
            x: co.cx - co.w / 2, y: co.cy - co.h / 2,
            width: co.w * 0.18, height: co.h,
            fill: '#484650', stroke: '#20202a', strokeWidth: 0.5,
        }));
        // 右柱
        this.group.add(new Konva.Rect({
            x: co.cx + co.w / 2 - co.w * 0.18, y: co.cy - co.h / 2,
            width: co.w * 0.18, height: co.h,
            fill: '#484650', stroke: '#20202a', strokeWidth: 0.5,
        }));

        // 线圈绕组（中柱，橙色漆包线截面）
        const cl = this._coil;
        this.group.add(new Konva.Rect({
            x: cl.cx - cl.w / 2, y: cl.y,
            width: cl.w, height: cl.h,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: cl.w, y: 0 },
            fillLinearGradientColorStops: [
                0, '#3a1a08', 0.15, '#c86020', 0.5, '#e08030',
                0.85, '#c86020', 1, '#3a1a08',
            ],
            stroke: '#281008', strokeWidth: 0.8, cornerRadius: 2,
        }));
        // 绕线细纹
        for (let i = 1; i <= 6; i++) {
            this.group.add(new Konva.Line({
                points: [cl.cx - cl.w / 2 + 2, cl.y + cl.h * (i / 7),
                         cl.cx + cl.w / 2 - 2, cl.y + cl.h * (i / 7)],
                stroke: 'rgba(0,0,0,0.22)', strokeWidth: 0.6,
            }));
        }
        // 短路环标注（铁芯端面）
        [[co.cx - co.w / 2 + co.w * 0.10, co.cy + co.h * 0.42],
         [co.cx + co.w / 2 - co.w * 0.10, co.cy + co.h * 0.42]].forEach(([rx, ry]) => {
            this.group.add(new Konva.Ellipse({
                x: rx, y: ry, radiusX: co.w * 0.06, radiusY: co.h * 0.10,
                fill: 'transparent', stroke: '#c8a030', strokeWidth: 1,
            }));
        });

        // 线圈引线端子（左侧）
        this.group.add(new Konva.Text({
            x: mr.x + 4, y: co.cy - 6,
            text: 'A1 ●', fontSize: 7, fill: '#ffcc80',
            fontFamily: 'Courier New', fontStyle: 'bold',
        }));
        this.group.add(new Konva.Text({
            x: mr.x + 4, y: co.cy + co.h * 0.25,
            text: 'A2 ●', fontSize: 7, fill: '#ffcc80',
            fontFamily: 'Courier New',
        }));
    }

    // ── 气囊外壳（静态骨架）──────────────────
    _drawBellowsShell() {
        const W = this.width, H = this.height;
        const br = this._bellowsRegion;

        // 气囊区背板（橡胶暗色）
        this.group.add(new Konva.Rect({
            x: br.x, y: br.y, width: br.w, height: br.h,
            fill: '#1a1a1e', stroke: '#10101a', strokeWidth: 0.8, cornerRadius: br.rx,
        }));

        // "AIR DAMPER" 标注
        this.group.add(new Konva.Text({
            x: br.x + 4, y: br.y + 3,
            text: 'AIR DAMPER',
            fontSize: 6, fill: 'rgba(120,140,160,0.40)',
            fontFamily: 'Courier New', fontStyle: 'bold',
        }));

        // 节流孔区域（右侧放大标注框）
        const or = this._orifice;
        this.group.add(new Konva.Line({
            points: [or.cx + or.r + 4, or.cy, or.cx + or.r * 5, or.cy - H * 0.04],
            stroke: 'rgba(160,200,140,0.25)', strokeWidth: 0.7,
        }));
        this.group.add(new Konva.Text({
            x: or.cx + or.r * 5 - 4, y: or.cy - H * 0.04 - 12,
            text: '节流孔',
            fontSize: 6.5, fill: 'rgba(120,180,100,0.50)',
            fontFamily: 'Courier New',
        }));
    }

    // ── 调节旋钮静态骨架 ─────────────────────
    _drawKnobStatic() {
        const k = this._knob, W = this.width;

        // 旋钮刻度盘
        this.group.add(new Konva.Circle({
            x: k.cx, y: k.cy, radius: k.r + 4,
            fill: '#1a1a22', stroke: '#28283a', strokeWidth: 0.8,
        }));

        // 刻度线（270° 范围，−135°~+135°）
        for (let i = 0; i <= 12; i++) {
            const frac = i / 12;
            const angDeg = -135 + frac * 270;
            const angRad = angDeg * Math.PI / 180;
            const r0 = k.r + 1, r1 = k.r + (i % 3 === 0 ? 4 : 2);
            this.group.add(new Konva.Line({
                points: [
                    k.cx + Math.cos(angRad) * r0, k.cy + Math.sin(angRad) * r0,
                    k.cx + Math.cos(angRad) * r1, k.cy + Math.sin(angRad) * r1,
                ],
                stroke: i % 3 === 0 ? '#7a8898' : '#3a4858',
                strokeWidth: i % 3 === 0 ? 1.0 : 0.6,
            }));
        }
        // 最小/最大标注
        [[-135, '短'], [135, '长']].forEach(([ang, lbl]) => {
            const r = angRad => angRad;
            const a = ang * Math.PI / 180;
            this.group.add(new Konva.Text({
                x: k.cx + Math.cos(a) * (k.r + 9) - 6,
                y: k.cy + Math.sin(a) * (k.r + 9) - 5,
                width: 12, text: lbl,
                fontSize: 6, fill: '#607080', align: 'center',
                fontFamily: 'Courier New',
            }));
        });
        this.group.add(new Konva.Text({
            x: k.cx - k.r * 1.1, y: k.cy + k.r + 5,
            width: k.r * 2.2, text: '延时调节',
            fontSize: 6.5, fill: '#506070',
            align: 'center', fontFamily: 'Courier New',
        }));
    }

    // ── 触点区背板（静态）────────────────────
    _drawContactRegion() {
        const cr = this._contactRegion;
        this.group.add(new Konva.Rect({
            x: cr.x, y: cr.y, width: cr.w, height: cr.h,
            fill: '#16181e', stroke: '#0e1018', strokeWidth: 0.8, cornerRadius: cr.rx,
        }));
        this.group.add(new Konva.Text({
            x: cr.x + 4, y: cr.y + 2, text: 'CONTACTS',
            fontSize: 6, fill: 'rgba(100,130,160,0.35)',
            fontFamily: 'Courier New', fontStyle: 'bold',
        }));
    }

    // ── 端子区（底部）────────────────────────
    _drawTerminals() {
        const W = this.width, H = this.height;
        const tH = H * 0.040, tW = W * 0.092;
        const b  = this._body;

        this._ports.forEach((p, i) => {
            const tx = p.x - tW / 2, ty = b.y + b.h - tH;
            const gT = this.group;
            gT.add(new Konva.Rect({
                x: tx, y: ty, width: tW, height: tH,
                fillLinearGradientStartPoint: { x: 0, y: 0 },
                fillLinearGradientEndPoint:   { x: tW, y: 0 },
                fillLinearGradientColorStops: [0, '#484e58', 0.3, '#8a9298', 0.6, '#aab2ba', 1, '#484e58'],
                stroke: '#30363e', strokeWidth: 0.7, cornerRadius: 1,
            }));
            gT.add(new Konva.Circle({ x: p.x, y: ty + tH / 2, radius: tW * 0.22, fill: '#8a9298', stroke: '#585e66', strokeWidth: 0.5 }));
            gT.add(new Konva.Line({ points: [p.x - tW * 0.15, ty + tH / 2, p.x + tW * 0.15, ty + tH / 2], stroke: '#404850', strokeWidth: 0.8 }));
            const isCoil = i < 2;
            const col    = isCoil ? '#ffcc80' : (i < 4 ? '#90caf9' : '#a5d6a7');
            gT.add(new Konva.Text({
                x: p.x - 7, y: ty - 11, width: 14, text: p.label,
                fontSize: 8, fill: col, align: 'center', fontStyle: 'bold', fontFamily: 'Courier New',
            }));
        });
        // 分区标注
        const ty0 = this._body.y + this._body.h - H * 0.040 - 16;
        this.group.add(new Konva.Text({ x: this._ports[0].x - 6, y: ty0, text: '线圈', fontSize: 6.5, fill: 'rgba(230,180,80,0.42)', fontFamily: 'Courier New' }));
        this.group.add(new Konva.Text({ x: this._ports[2].x - 6, y: ty0, text: '延时NO(3-4)', fontSize: 6, fill: 'rgba(100,160,210,0.42)', fontFamily: 'Courier New' }));
        this.group.add(new Konva.Text({ x: this._ports[4].x - 6, y: ty0, text: 'NC(5-6)', fontSize: 6, fill: 'rgba(100,190,120,0.42)', fontFamily: 'Courier New' }));
    }

    // ── 进度条背景 ───────────────────────────
    _drawProgressBarBg() {
        const pb = this._progressBar;
        this.group.add(new Konva.Rect({
            x: pb.x, y: pb.y, width: pb.w, height: pb.h,
            fill: '#101018', stroke: '#1e2030', strokeWidth: 0.7, cornerRadius: pb.rx,
        }));
        this.group.add(new Konva.Text({
            x: pb.x - 2, y: pb.y - 11, width: pb.w + 4, text: '行程',
            fontSize: 5.5, fill: 'rgba(100,130,160,0.45)',
            align: 'center', fontFamily: 'Courier New',
        }));
    }

    // ══════════════════════════════════════════
    // ── 动态重绘入口 ──────────────────────────

    _rebuildAll() {
        this._rebuildArmature();
        this._rebuildBellows();
        this._rebuildContacts();
        this._rebuildProgressBar();
        this._rebuildKnob();
        this._updateStatusPanel();
    }

    // ── 衔铁（动态）──────────────────────────
    _rebuildArmature() {
        this._magnetDynGroup.destroyChildren();
        const ar    = this._armature;
        const pos   = this._armaturePos;  // 0=释放，1=吸合
        const coilOn = this._coilOn;
        const gp    = this._glowPhase;

        // 衔铁当前 Y 位置（插值）
        const curY = ar.baseY + (ar.closedY - ar.baseY) * pos;

        // 磁场辉光（线圈通电时蓝紫色磁感线）
        if (coilOn) {
            const gAlpha = 0.15 + pos * 0.20 + Math.sin(gp * 4) * 0.04;
            this._magnetDynGroup.add(new Konva.Ellipse({
                x: ar.cx, y: (curY + this._core.cy) / 2,
                radiusX: ar.w * 0.45, radiusY: Math.abs(curY - this._core.cy) * 0.6,
                fill: `rgba(80,100,200,${gAlpha * 0.35})`,
                stroke: `rgba(100,130,220,${gAlpha * 0.55})`,
                strokeWidth: 1.0,
            }));
        }

        // 衔铁主体（E 形可动铁片）
        // 上横梁
        this._magnetDynGroup.add(new Konva.Rect({
            x: ar.cx - ar.w / 2, y: curY,
            width: ar.w, height: ar.h,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: ar.w, y: 0 },
            fillLinearGradientColorStops: [
                0, '#3a3840', 0.25, '#58565e', 0.55, '#50484e', 0.85, '#3e3c44', 1, '#2a2830',
            ],
            stroke: '#202028', strokeWidth: 0.8,
            shadowColor: coilOn && pos > 0.8 ? 'rgba(80,100,200,0.50)' : 'transparent',
            shadowBlur:  coilOn && pos > 0.8 ? 8 : 0,
            shadowOpacity: 0.7,
        }));
        // 三柱（下延）
        const co = this._core;
        [-1, 0, 1].forEach((dir, idx) => {
            const colX = ar.cx + dir * ar.w * 0.38 - ar.w * 0.07;
            const colH = (curY - co.cy - co.h / 2 + ar.h) * 0.8;
            if (colH > 1) {
                this._magnetDynGroup.add(new Konva.Rect({
                    x: colX, y: curY + ar.h,
                    width: ar.w * 0.14, height: colH,
                    fill: '#484650', stroke: '#202028', strokeWidth: 0.4,
                }));
            }
        });

        // 推杆（衔铁底部→气囊顶部连接）
        const rodTop  = curY + ar.h;
        const rodBot  = this._bellowsRegion.y;
        if (rodBot > rodTop) {
            this._magnetDynGroup.add(new Konva.Rect({
                x: ar.cx - this._piston.w / 2, y: rodTop,
                width: this._piston.w, height: rodBot - rodTop,
                fillLinearGradientStartPoint: { x: -this._piston.w / 2, y: 0 },
                fillLinearGradientEndPoint:   { x:  this._piston.w / 2, y: 0 },
                fillLinearGradientColorStops: [0, '#404858', 0.5, '#606878', 1, '#404858'],
                strokeWidth: 0,
            }));
        }

        // 触点弹片（吸合时瞬动触点动作指示）
        if (pos > 0.5) {
            this._magnetDynGroup.add(new Konva.Line({
                points: [ar.cx + ar.w * 0.30, curY + ar.h * 0.5,
                         ar.cx + ar.w * 0.45, curY + ar.h * 0.5 + 3],
                stroke: 'rgba(200,210,230,0.60)', strokeWidth: 1.5, lineCap: 'round',
            }));
        }
    }

    // ── 气囊阻尼系统（核心动画）──────────────
    _rebuildBellows() {
        this._bellowsDynGroup.destroyChildren();
        const br  = this._bellowsRegion;
        const ps  = this._piston;
        const or  = this._orifice;
        const pos = this._pistonPos;       // 0=底部，1=顶部触发
        const bf  = this._bellowsDeform;   // 气囊形变量
        const gp  = this._glowPhase;
        const W   = this.width, H = this.height;

        // 活塞当前 Y 位置
        const pistonY = ps.bottomY - pos * (ps.bottomY - ps.topY);

        // ── 气囊橡胶体（波纹形变）──
        const bellW  = br.w * 0.70;
        const bellCX = ps.cx;
        const bellY1 = br.y + 4;           // 气囊顶部（固定端）
        const bellY2 = pistonY + H * 0.015; // 气囊底部（随活塞）
        const bellH  = bellY2 - bellY1;
        const waves  = 5;                  // 波纹圈数

        if (bellH > 8) {
            // 气囊波纹（SVG 风格，多段贝塞尔）
            const pts = [bellCX - bellW * 0.18, bellY1];
            for (let i = 0; i <= waves * 4; i++) {
                const t   = i / (waves * 4);
                const y   = bellY1 + t * bellH;
                const wave= Math.sin(t * waves * Math.PI * 2);
                const xOff= wave * (bellW * (0.28 + bf * 0.06));
                pts.push(bellCX + xOff, y);
            }
            pts.push(bellCX + bellW * 0.18, bellY2);

            // 气囊主体（橡胶色）
            const bellFill = `rgba(${Math.round(50 + bf * 20)},${Math.round(45 + bf * 10)},${Math.round(42 + bf * 8)},0.88)`;
            this._bellowsDynGroup.add(new Konva.Line({
                points: pts,
                stroke: bellFill,
                strokeWidth: bellW * 0.55,
                tension: 0.40, lineCap: 'round',
            }));
            // 波纹高光（左侧）
            const hPts = [bellCX - bellW * 0.14, bellY1];
            for (let i = 0; i <= waves * 4; i++) {
                const t = i / (waves * 4);
                const y = bellY1 + t * bellH;
                const wave = Math.sin(t * waves * Math.PI * 2 + Math.PI * 0.3);
                hPts.push(bellCX - bellW * 0.08 + wave * (bellW * 0.10), y);
            }
            this._bellowsDynGroup.add(new Konva.Line({
                points: hPts,
                stroke: 'rgba(120,115,108,0.30)',
                strokeWidth: 2, tension: 0.40,
            }));
        }

        // ── 活塞头 ──
        const pH = H * 0.030;
        this._bellowsDynGroup.add(new Konva.Rect({
            x: bellCX - bellW * 0.45, y: pistonY - pH / 2,
            width: bellW * 0.90, height: pH,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: bellW * 0.90, y: 0 },
            fillLinearGradientColorStops: [0, '#505868', 0.3, '#8090a0', 0.6, '#909aa8', 1, '#505868'],
            cornerRadius: 2,
            stroke: '#303848', strokeWidth: 0.7,
            shadowColor: '#000', shadowBlur: 3, shadowOffsetY: 1, shadowOpacity: 0.4,
        }));
        // 活塞杆
        this._bellowsDynGroup.add(new Konva.Rect({
            x: bellCX - ps.w / 2, y: pistonY + pH / 2,
            width: ps.w, height: ps.bottomY - pistonY - pH / 2 + H * 0.01,
            fillLinearGradientStartPoint: { x: -ps.w / 2, y: 0 },
            fillLinearGradientEndPoint:   { x:  ps.w / 2, y: 0 },
            fillLinearGradientColorStops: [0, '#3a4050', 0.5, '#6070880', 1, '#3a4050'],
            strokeWidth: 0,
        }));

        // ── 节流孔气流粒子 ──
        if (this._timing && pos > 0.05) {
            this._airParticles.forEach(p => {
                const a = Math.min(1, (1 - p.life) * 2);
                this._bellowsDynGroup.add(new Konva.Circle({
                    x: or.cx + p.vx * (1 - p.life) * 20,
                    y: or.cy + p.vy * (1 - p.life) * 20,
                    radius: W * 0.008 * p.life,
                    fill: `rgba(180,210,240,${a * 0.55})`,
                }));
            });
        }

        // 节流孔主体
        this._bellowsDynGroup.add(new Konva.Circle({
            x: or.cx, y: or.cy, radius: or.r,
            fillRadialGradientStartPoint: { x: -or.r * 0.3, y: -or.r * 0.3 },
            fillRadialGradientEndPoint:   { x: 0, y: 0 },
            fillRadialGradientStartRadius: 0,
            fillRadialGradientEndRadius:   or.r,
            fillRadialGradientColorStops: [0, '#303848', 0.6, '#202838', 1, '#101620'],
            stroke: 'rgba(80,110,150,0.55)', strokeWidth: 0.8,
        }));
        // 节流孔进气孔（中心小点）
        this._bellowsDynGroup.add(new Konva.Circle({
            x: or.cx, y: or.cy, radius: or.r * 0.28,
            fill: this._timing
                ? `rgba(120,180,220,${0.40 + Math.sin(gp * 8) * 0.20})`
                : 'rgba(60,80,100,0.30)',
            shadowColor: this._timing ? 'rgba(150,200,255,1)' : 'transparent',
            shadowBlur:  this._timing ? 5 : 0, shadowOpacity: 0.7,
        }));

        // ── 活塞行程提示线（顶部触发位）──
        this._bellowsDynGroup.add(new Konva.Line({
            points: [br.x + 4, ps.topY, br.x + br.w - 4, ps.topY],
            stroke: 'rgba(255,120,40,0.30)', strokeWidth: 0.7, dash: [3, 2],
        }));
        this._bellowsDynGroup.add(new Konva.Text({
            x: br.x + br.w - 28, y: ps.topY - 9,
            text: '触发位', fontSize: 5.5,
            fill: 'rgba(255,120,40,0.45)', fontFamily: 'Courier New',
        }));
    }

    // ── 触点动态 ─────────────────────────────
    _rebuildContacts() {
        this._contactDynGroup.destroyChildren();
        const W = this.width, H = this.height;
        const af = this._arcFlash;

        // 延时 NO 触点（3-4）
        this._drawContactPair(
            this._ctDelay, this._delayNO,
            '延时NO (3-4)', '#90caf9', af
        );
        // 延时 NC 触点（5-6）
        this._drawContactPair(
            this._ctDelayNC, this._delayNC,
            '延时NC (5-6)', '#a5d6a7', af * 0.6
        );
        // 瞬动 NO 触点（1-2）
        this._drawContactPair(
            this._ctInstant, this._instantNO,
            '瞬动NO (1-2)', '#ffcc80', 0
        );
    }

    _drawContactPair(rect, closed, label, color, arcFlash) {
        const g  = this._contactDynGroup;
        const W  = this.width, H = this.height;
        const cw = rect.w, ch = rect.h;
        const cx = rect.cx, cy = rect.cy;

        // 背底
        g.add(new Konva.Rect({
            x: cx - cw / 2, y: cy - ch * 1.1,
            width: cw, height: ch * 2.2,
            fill: '#12141a', stroke: '#1e222e',
            strokeWidth: 0.6, cornerRadius: 2,
        }));

        const staticY = cy - ch * 0.35;
        const movY    = closed ? staticY + H * 0.003 : staticY + H * 0.020;
        const hw      = W * 0.035;

        // 静触头（两侧）
        [-1, 1].forEach(side => {
            const sx = cx + side * cw * 0.30;
            g.add(new Konva.Rect({
                x: sx - hw * 0.5, y: staticY - H * 0.006,
                width: hw, height: H * 0.012,
                fill: '#c0c8d0', stroke: '#909aa0', strokeWidth: 0.4, cornerRadius: 0.5,
            }));
        });

        // 动触桥
        const bCol = closed
            ? { c0: '#909aa0', c1: '#d8e0e8', c2: '#888898' }
            : { c0: '#3c4250', c1: '#606870', c2: '#383e48' };
        g.add(new Konva.Rect({
            x: cx - cw * 0.40, y: movY - H * 0.006,
            width: cw * 0.80, height: H * 0.012,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: cw * 0.80, y: 0 },
            fillLinearGradientColorStops: [0, bCol.c0, 0.5, bCol.c1, 1, bCol.c0],
            cornerRadius: 1, stroke: bCol.c2, strokeWidth: 0.5,
        }));

        // 导通辉光
        if (closed) {
            [-1, 1].forEach(side => {
                g.add(new Konva.Circle({
                    x: cx + side * cw * 0.30, y: staticY,
                    radius: hw * 0.55,
                    fill: `rgba(${color.startsWith('#ff') ? '255,200,80' : '180,220,255'},0.40)`,
                    shadowColor: color, shadowBlur: 5, shadowOpacity: 0.65,
                }));
            });
        }

        // 弧光
        if (arcFlash > 0.1) {
            g.add(new Konva.Circle({
                x: cx - cw * 0.30, y: staticY,
                radius: hw * (1 + arcFlash),
                fill: `rgba(255,240,120,${arcFlash * 0.70})`,
                shadowColor: 'rgba(255,240,120,1)', shadowBlur: 6 * arcFlash, shadowOpacity: 0.85,
            }));
        }

        // 标注
        g.add(new Konva.Text({
            x: cx - cw * 0.55, y: cy + ch * 0.55,
            width: cw * 1.1, text: `${label}  ${closed ? '●闭' : '○开'}`,
            fontSize: 6, fill: closed ? color : 'rgba(60,90,110,0.45)',
            align: 'center', fontFamily: 'Courier New', fontStyle: 'bold',
        }));
    }

    // ── 进度条（活塞行程）─────────────────────
    _rebuildProgressBar() {
        this._progressDynGroup.destroyChildren();
        const pb  = this._progressBar;
        const pos = this._pistonPos;
        const H   = this.height;

        const fillH = pos * (pb.h - 2);
        const r     = Math.round(pos < 0.6 ? pos * 2 * 255 : 255);
        const g     = Math.round(pos < 0.6 ? 255 : (1 - pos) * 2 * 255);

        if (fillH > 0) {
            this._progressDynGroup.add(new Konva.Rect({
                x: pb.x + 1, y: pb.y + pb.h - 1 - fillH,
                width: pb.w - 2, height: fillH,
                fillLinearGradientStartPoint: { x: 0, y: 0 },
                fillLinearGradientEndPoint:   { x: 0, y: fillH },
                fillLinearGradientColorStops: [
                    0, `rgba(${r},${g},20,0.95)`, 1, `rgba(${r},${g},20,0.75)`,
                ],
                cornerRadius: pb.rx,
                shadowColor: `rgba(${r},${g},20,0.60)`,
                shadowBlur: pos > 0.8 ? 5 : 2, shadowOpacity: 0.8,
            }));
        }

        // 百分比文字
        this._progressDynGroup.add(new Konva.Text({
            x: pb.x - 2, y: pb.y + pb.h + 2,
            width: pb.w + 4,
            text: `${Math.round(pos * 100)}%`,
            fontSize: 5.5, fill: `rgba(${r},${g},20,0.70)`,
            align: 'center', fontFamily: 'Courier New',
        }));
    }

    // ── 调节旋钮指针（动态）──────────────────
    _rebuildKnob() {
        this._knobDynGroup.destroyChildren();
        const k   = this._knob;
        const ang = this._knobAngle * Math.PI / 180;

        // 旋钮主体
        const gK = this._knobDynGroup;
        gK.add(new Konva.Circle({
            x: k.cx, y: k.cy, radius: k.r,
            fillRadialGradientStartPoint: { x: -k.r * 0.3, y: -k.r * 0.3 },
            fillRadialGradientEndPoint:   { x: 0, y: 0 },
            fillRadialGradientStartRadius: 0,
            fillRadialGradientEndRadius:   k.r,
            fillRadialGradientColorStops:  [0, '#3e4050', 0.6, '#2a2c3a', 1, '#1e2028'],
            stroke: '#16182a', strokeWidth: 0.8,
            shadowColor: '#000', shadowBlur: 4, shadowOffsetY: 1, shadowOpacity: 0.4,
        }));
        // 防滑纹
        for (let i = 0; i < 8; i++) {
            const a = (i / 8) * Math.PI * 2;
            gK.add(new Konva.Line({
                points: [
                    k.cx + Math.cos(a) * k.r * 0.72, k.cy + Math.sin(a) * k.r * 0.72,
                    k.cx + Math.cos(a) * k.r * 0.92, k.cy + Math.sin(a) * k.r * 0.92,
                ],
                stroke: 'rgba(0,0,0,0.25)', strokeWidth: 1.5,
            }));
        }
        // 指针线
        gK.add(new Konva.Line({
            points: [
                k.cx + Math.cos(ang) * k.r * 0.20, k.cy + Math.sin(ang) * k.r * 0.20,
                k.cx + Math.cos(ang) * k.r * 0.82, k.cy + Math.sin(ang) * k.r * 0.82,
            ],
            stroke: '#d4e040', strokeWidth: 2.0, lineCap: 'round',
        }));
        // 中心圆销
        gK.add(new Konva.Circle({ x: k.cx, y: k.cy, radius: k.r * 0.14, fill: '#9098a0', stroke: '#607080', strokeWidth: 0.6 }));

        // 当前延时时间显示
        gK.add(new Konva.Text({
            x: k.cx - k.r * 1.0, y: k.cy + k.r + 14,
            width: k.r * 2.0,
            text: `${this.setDelay.toFixed(1)} s`,
            fontSize: 7, fill: '#70a0c0', fontStyle: 'bold',
            align: 'center', fontFamily: 'Courier New',
        }));
    }

    // ── 标注 ─────────────────────────────────
    _drawLabel() {
        const W = this.width;
        this.group.add(new Konva.Text({
            x: 0, y: -22, width: W,
            text: `${this.label}  空气阻尼式时间继电器`,
            fontSize: 9, fontStyle: 'bold', fill: '#546e7a',
            align: 'center', fontFamily: 'Arial, sans-serif',
        }));
        this.group.add(new Konva.Text({
            x: 0, y: -10, width: W,
            text: `${this.model}  ${this.coilVoltage}V  ${this.delayType}  ${this.delayMin}~${this.delayMax}s`,
            fontSize: 7, fill: '#3a5a7a',
            align: 'center', fontFamily: 'Courier New',
        }));
    }

    // ── 状态面板 ─────────────────────────────
    _drawStatusPanel() {
        const W  = this.width, H = this.height;
        const b  = this._body;
        const panY = b.y + H * 0.02;

        this._statusPanelGroup = new Konva.Group({ x: 0, y: panY });
        this.group.add(this._statusPanelGroup);

        this._statusPanelGroup.add(new Konva.Rect({
            x: W * 0.68, y: 0, width: W * 0.24, height: H * 0.32,
            fill: '#080e0a', stroke: '#0e1810',
            strokeWidth: 0.7, cornerRadius: 3,
        }));

        // PWR LED
        this._pwrLed = new Konva.Circle({ x: W * 0.76, y: H * 0.038, radius: 3.5, fill: '#1a1a1a', stroke: '#1a1a1a', strokeWidth: 0.6 });
        this._statusPanelGroup.add(this._pwrLed);
        this._statusPanelGroup.add(new Konva.Text({ x: W * 0.80, y: H * 0.030, text: 'PWR', fontSize: 6, fill: 'rgba(150,130,60,0.45)', fontFamily: 'Courier New' }));

        // OUT LED
        this._outLed = new Konva.Circle({ x: W * 0.76, y: H * 0.070, radius: 3.5, fill: '#1a1a1a', stroke: '#1a1a1a', strokeWidth: 0.6 });
        this._statusPanelGroup.add(this._outLed);
        this._statusPanelGroup.add(new Konva.Text({ x: W * 0.80, y: H * 0.062, text: 'OUT', fontSize: 6, fill: 'rgba(50,120,70,0.45)', fontFamily: 'Courier New' }));

        // 计时数值文字
        this._timerText = new Konva.Text({
            x: W * 0.68, y: H * 0.102, width: W * 0.24,
            text: '0.0s', fontSize: 8, fill: 'rgba(0,200,130,0.60)',
            align: 'center', fontStyle: 'bold', fontFamily: 'Courier New',
        });
        this._statusPanelGroup.add(this._timerText);
        this._statusPanelGroup.add(new Konva.Text({
            x: W * 0.68, y: H * 0.136, width: W * 0.24,
            text: '●', fontSize: 6, fill: 'rgba(50,100,130,0.35)',
            align: 'center', fontFamily: 'Courier New',
        }));
    }

    _updateStatusPanel() {
        const coilOn = this._coilOn;
        const outOn  = this._delayNO || this._instantNO;

        if (this._pwrLed) {
            const pwrC = coilOn ? '#ffcc40' : '#2a2010';
            this._pwrLed.fill(pwrC);
            this._pwrLed.stroke(pwrC);
            this._pwrLed.shadowColor(coilOn ? pwrC : 'transparent');
            this._pwrLed.shadowBlur(coilOn ? 6 : 0);
        }
        if (this._outLed) {
            const outC = outOn ? '#40e870' : '#1a2a1a';
            this._outLed.fill(outC);
            this._outLed.stroke(outC);
            this._outLed.shadowColor(outOn ? outC : 'transparent');
            this._outLed.shadowBlur(outOn ? 7 : 0);
        }
        if (this._timerText) {
            this._timerText.text(
                this._timing
                    ? `${this._elapsed.toFixed(1)}s`
                    : this._timingDone
                        ? `✓${this.setDelay}s`
                        : '─ ─'
            );
            this._timerText.fill(
                this._timingDone ? 'rgba(0,255,160,0.75)'
                : this._timing   ? 'rgba(0,200,130,0.60)'
                : 'rgba(0,130,90,0.30)'
            );
        }
    }

    // ═══════════════════════════════════════════
    // ── 物理模型 ─────────────────────────────

    /** 衔铁吸合/释放：弹簧阻尼二阶系统 */
    _updateArmature(dt) {
        const target   = this._coilOn ? 1 : 0;
        const omega0   = this._coilOn ? Math.PI * 8  : Math.PI * 12;  // 吸合慢，释放快
        const zeta     = 0.70;
        const error    = target - this._armaturePos;
        const spring   = omega0 * omega0 * error;
        const damping  = 2 * zeta * omega0 * this._armatureVel;
        this._armatureVel += (spring - damping) * dt;
        this._armaturePos  = Math.max(0, Math.min(1, this._armaturePos + this._armatureVel * dt));

        // 瞬动触点跟随衔铁（吸合超过 50% 时瞬动）
        this._instantNO = this._armaturePos > 0.50;
    }

    /** 活塞气囊阻尼运动（核心延时机构） */
    _updatePiston(dt) {
        if (!this._coilOn) {
            // 失电：活塞快速复位（复位弹簧，无气囊阻尼）
            if (this._pistonPos > 0) {
                this._pistonVel = 0;
                this._pistonPos = Math.max(0, this._pistonPos - dt / 0.12);
                this._elapsed   = 0;
                this._timing    = false;
                if (this._pistonPos === 0) {
                    this._timingDone = false;
                    this._delayNO   = false;
                    this._delayNC   = true;
                }
            }
            this._bellowsDeform = this._pistonPos * 0.6;
            return;
        }

        // 得电且衔铁已吸合（>60%）才开始计时
        if (this._armaturePos < 0.60) return;

        if (this._timingDone) {
            this._pistonPos = 1;
            return;
        }

        // 空气阻尼模型：速度 = f(节流孔开度, 气压差)
        // 节流孔开度决定时间常数（由 setDelay 决定）
        const tau = this.setDelay;  // 延时时间 = 时间常数
        this._pistonPos = Math.min(1, this._pistonPos + dt / tau);
        this._elapsed   = this._pistonPos * this.setDelay;
        this._timing    = this._pistonPos < 1;

        // 气囊形变跟随活塞（反向：活塞升→气囊排气→膨胀）
        this._bellowsDeform = this._pistonPos * 0.70;

        // 气流粒子（每帧随机生成）
        if (this._timing && Math.random() < 0.35) {
            const ang = Math.PI * 1.5 + (Math.random() - 0.5) * 0.8;
            this._airParticles.push({
                vx: Math.cos(ang), vy: Math.sin(ang),
                life: 1,
            });
        }
        this._airParticles = this._airParticles
            .map(p => ({ ...p, life: p.life - dt * 2.5 }))
            .filter(p => p.life > 0);

        // 活塞到达顶部 → 延时时间到
        if (this._pistonPos >= 1 && !this._timingDone) {
            this._timingDone = true;
            this._timing     = false;
            this._arcFlash   = 0.85;
            // 延时触点动作
            this._delayNO    = true;
            this._delayNC    = false;
        }
    }

    // ═══════════════════════════════════════════
    _startAnimation() {
        this._bindInteraction();
        const tick = ts => {
            if (this._lastTs !== null) {
                const dt = Math.min((ts - this._lastTs) / 1000, 0.05);
                this._tickAnimation(dt, ts);
            }
            this._lastTs = ts;
            this._animId = requestAnimationFrame(tick);
        };
        this._animId = requestAnimationFrame(tick);
    }

    _stopAnimation() {
        if (this._animId) { cancelAnimationFrame(this._animId); this._animId = null; }
    }

    _tickAnimation(dt, ts) {
        // 检测触点切换弧光
        const prevNO = this._prevDelayNO;
        this._prevDelayNO = this._delayNO;

        this._updateArmature(dt);
        this._updatePiston(dt);

        if (prevNO !== this._delayNO) this._arcFlash = 0.80;
        this._arcFlash = Math.max(0, this._arcFlash - dt * 8);

        this._glowPhase += dt * 2.2;
        this._rebuildAll();
        this._refreshCache();
    }

    _bindInteraction() {
        // 点击线圈区域切换通断
        const coilHit = new Konva.Rect({
            x: this._coil.cx - this._coil.w,
            y: this._coil.y - 4,
            width: this._coil.w * 2, height: this._coil.h + 8,
            fill: 'transparent',
        });
        this.group.add(coilHit);
        coilHit.on('click tap', () => this.toggleCoil());

        // 旋钮交互（点击递增延时）
        const knobHit = new Konva.Circle({
            x: this._knob.cx, y: this._knob.cy,
            radius: this._knob.r + 4, fill: 'transparent',
        });
        this.group.add(knobHit);
        knobHit.on('click tap', e => {
            const newDelay = this.setDelay < this.delayMax
                ? Math.min(this.delayMax, this.setDelay + Math.max(1, this.setDelay * 0.20))
                : this.delayMin;
            this.setDelayTime(newDelay);
        });
    }

    // ── 辅助：延时时间 → 旋钮角度 ───────────
    _delayToKnobAngle(t) {
        const frac = (t - this.delayMin) / (this.delayMax - this.delayMin);
        return -135 + Math.max(0, Math.min(1, frac)) * 270;  // °
    }

    // ═══════════════════════════════════════════
    // ── 公开 API ─────────────────────────────

    /** 线圈得电 */
    energize() {
        if (this._coilOn) return;
        this._coilOn = true;
        this.opsCount++;
        this._refreshCache();
    }

    /** 线圈失电 */
    deEnergize() {
        if (!this._coilOn) return;
        this._coilOn = false;
        this.opsCount++;
        this._refreshCache();
    }

    /** 切换线圈 */
    toggleCoil() {
        this._coilOn ? this.deEnergize() : this.energize();
    }

    /** 设置延时时间（s），自动更新旋钮角度 */
    setDelayTime(t) {
        this.setDelay   = Math.max(this.delayMin, Math.min(this.delayMax, t));
        this._knobAngle = this._delayToKnobAngle(this.setDelay);
        this._refreshCache();
    }

    /** 手动复位（活塞强制归零） */
    reset() {
        this._pistonPos  = 0;
        this._pistonVel  = 0;
        this._elapsed    = 0;
        this._timing     = false;
        this._timingDone = false;
        this._delayNO    = false;
        this._delayNC    = true;
        this._airParticles = [];
        this._refreshCache();
    }

    isCoilOn()    { return this._coilOn; }
    isDelayNO()   { return this._delayNO; }
    isDelayNC()   { return this._delayNC; }
    isInstantNO() { return this._instantNO; }
    isTimingDone(){ return this._timingDone; }
    getElapsed()  { return this._elapsed; }
    getPistonPos(){ return this._pistonPos; }

    update(state) {
        if (typeof state === 'boolean') {
            state ? this.energize() : this.deEnergize();
        } else if (state && typeof state === 'object') {
            if (state.coil     !== undefined) state.coil ? this.energize() : this.deEnergize();
            if (state.delay    !== undefined) this.setDelayTime(state.delay);
            if (state.reset    === true)      this.reset();
        }
        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label: '位号/名称',               key: 'label',       type: 'text'   },
            { label: '线圈电压 (V)',             key: 'coilVoltage', type: 'number' },
            { label: '型号 (JS7-1/2/3/4A)',     key: 'model',       type: 'text'   },
            { label: '延时类型 (TON/TOF)',        key: 'delayType',   type: 'text'   },
            { label: '延时最小值 (s)',            key: 'delayMin',    type: 'number' },
            { label: '延时最大值 (s)',            key: 'delayMax',    type: 'number' },
            { label: '当前设定延时 (s)',          key: 'setDelay',    type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label       !== undefined) this.label       = cfg.label;
        if (cfg.coilVoltage !== undefined) this.coilVoltage = parseFloat(cfg.coilVoltage);
        if (cfg.model       !== undefined) this.model       = cfg.model;
        if (cfg.delayType   !== undefined) this.delayType   = cfg.delayType;
        if (cfg.delayMin    !== undefined) this.delayMin    = parseFloat(cfg.delayMin);
        if (cfg.delayMax    !== undefined) this.delayMax    = parseFloat(cfg.delayMax);
        if (cfg.setDelay    !== undefined) this.setDelayTime(parseFloat(cfg.setDelay));
        this.config = { ...this.config, ...cfg };
        this._refreshCache();
    }

    destroy() { this._stopAnimation(); super.destroy?.(); }
}