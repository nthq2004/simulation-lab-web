import { BaseComponent } from './BaseComponent.js';

/**
 * 船用框架式空气断路器（发电机主开关）仿真组件
 *
 * ═══ 布局 ════════════════════════════════════════════════════════════
 *  左 1/3：操作面板
 *    - 储能指示牌（LED + 文字）
 *    - 合/分闸指示牌（LED + 文字）
 *    - 手动合闸按钮（绿色）
 *    - 手动分闸按钮（红色，兼复位）
 *    - 储能手柄（转动储能）
 *    - 摇出位置选择：连接位 / 试验位 / 脱扣位（三按钮）
 *  右 2/3：主开关内部结构 + 电气接口
 *    - 3 极主触头（L1/L2/L3 上进线 → T1/T2/T3 下出线，参照三相接触器触桥）
 *    - 辅触头（NO 一组、NC 一组）
 *    - 主轴（水平，合闸偏右 / 分闸偏左，触桥联动）
 *    - 分闸弹簧（主轴左侧，合闸时拉长 / 分闸时收缩拉回主轴）
 *    - 合闸弹簧（储能弹簧）+ 锁住机构（储能拉出、锁钩扣住，合闸释放）
 *    - 脱扣轴（主轴右侧，绕右下支点转动，顺时针转动释放主轴）
 *    - 脱扣器三个：分励(SH)、失压(UV)、过流(OC)，撞针顶脱扣轴
 *    - 右边界控制端子带：储能电机(M+/M-)、合闸线圈(X/Y)、失压(UV1/UV2)、
 *      分励(SH1/SH2)、过流(OC1/OC2)、辅触头(NO/NC 各两端口)
 *
 * ═══ 状态机 ════════════════════════════════════════════════════════════
 *  主触头  _state    : 'open' | 'closed'
 *  储能    _charged  : boolean
 *  摇出    _rackPos  : 'connected' | 'test' | 'disconnected'
 *  脱扣锁存 _tripLock : boolean（失压/过流脱扣后需复位）
 *
 *  合闸条件：已储能 + 无脱扣锁存
 *  分闸方式：手动分闸按钮 / 分励线圈带电 / 失压线圈欠压 / 过流线圈带电
 *
 * ═══ 电气行为 ════════════════════════════════════════════════════════════
 *  主触头 L-T：仅「连接位 + 合闸」时导通（DeviceStamps.stampMainsSwitch）
 *  控制回路：储能电机/合闸/分励/过流/失压检测仅在非「脱扣位」时启用
 *  失压检测：主开关合闸运行期间，失压线圈电压低于阈值即脱扣（立即）
 *  过流检测：过流线圈接口带电即脱扣（外部触发，不做内部电流检测）
 *
 * 端口：l1/l2/l3、t1/t2/t3、mp/mn、x/y、uv1/uv2、sh1/sh2、oc1/oc2、
 *       no_a/no_b、nc_a/nc_b
 */
export class MarineMainsSwitch extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(480, config.width  || 760);
        this.height = Math.max(360, config.height || 360);

        this.type    = 'gen_acb';
        this.special = 'MARINE-MAINS-SWITCH';
        this.cache   = 'fixed';

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        this.config = {
            label:          this.label,
            ratedVoltage:   this.ratedVoltage,
            ratedCurrent:   this.ratedCurrent,
            initState:      this._state,
            initRack:       this._rackPos,
            animDur:        this._animDur,
            ctrlRated:      this._ctrlRated,
            uvThresholdPct: this._uvThresholdPct,
            ctrlDetectV:    this._ctrlDetectV,
        };

        // ── 主触头端口（顶部接汇流排，底部接发电机）──
        this._g.mainPoleXs.forEach((px, i) => {
            this.addPort(px, 0, ['l1', 'l2', 'l3'][i], 'wire');
            this.addPort(px, this.height, ['t1', 't2', 't3'][i], 'wire', 'p');
        });
        // ── 控制端子带（右侧边缘，去掉 NO/NC，仅 8 个端子）──
        const terms = ['mp', 'mn', 'x', 'y', 'uv1', 'uv2', 'sh1', 'sh2', 'oc1', 'oc2'];
        terms.forEach((pid, i) => {
            this.addPort(this.width - 3, this._g.termYs[i], pid, 'wire');
        });
        this.update();
    }

    // ═══════════════════════════════════════════
    // 几何尺寸计算
    // ═══════════════════════════════════════════

_recalcGeometry() {
        const W = this.width, H = this.height;
        const g = this._g = {};

        g.divX = W * 0.34;                    // 左右分隔线
        g.frame = { x: 2, y: 2, w: W - 4, h: H - 4, rx: 6 };

        // ── 右侧区域：去掉控制端子带宽度 ──
        const rightX0 = g.divX + 12;
        const rightX1 = W - 90;                // 预留控制端子带
        const rightMidX = (rightX0 + rightX1) / 2;

        // ── 左半侧：分闸弹簧 + 主轴 + 3主触头 ──
        g.schemX0 = rightX0 + 10;
        g.schemX1 = rightMidX - 10;
        const mainSpan = g.schemX1 - g.schemX0 - 20;
        g.mainPoleXs = [0, 1, 2].map(i => g.schemX0 + 10 + mainSpan * (i + 0.5) / 3);

        // ── 主轴（水平，位于左半侧中线）──
        g.spindleY = H * 0.30;
        g.spindleOpenX = g.schemX0 + 20;
        g.spindleCloseX = g.schemX1 - 20;
        g.openDX = 22;                        // 触桥分闸偏移
        g.closedGap = -8;                     // 触桥合闸间隙

        // ── 静触点位置 ──
        g.mainTopY = g.spindleY - 42;
        g.mainBotY = g.spindleY + 42;

        // ── 分闸弹簧（主轴左侧，固定点 → 主轴左端）──
        g.springFix = { x: g.schemX0 - 8, y: g.spindleY };

        // ── 合闸弹簧（储能弹簧，主轴上方，右端固定在中线）──
        g.closeSpringY = g.spindleY - 60;
        g.closeSpringFix = { x: rightMidX - 10, y: g.closeSpringY };
        g.springActUncharged = g.spindleCloseX + 30;
        g.springActCharged   = g.spindleCloseX - 20;

        // ── 右半侧：脱扣轴 + 脱扣器 ──
        g.tripPivot = { x: rightMidX + 60, y: g.spindleY + 50 };
        g.tripLen = 56;
        g.tripRotMax = 26;

        g.tripDevY = g.spindleY + 100;
        const tripSpan = rightX1 - rightMidX - 20;
        g.tripDevX = {
            shunt: rightMidX + 10 + tripSpan * 0.20,
            uv:    rightMidX + 10 + tripSpan * 0.50,
            oc:    rightMidX + 10 + tripSpan * 0.80,
        };
        g.strikerUp = 14;

        // ── 控制端子带 ──
        g.termYs = [];
        const n = 10;
        for (let i = 0; i < n; i++) {
            g.termYs.push(20 + i * ((H - 40) / (n - 1)));
        }

        // ── 左侧面板控件几何（紧凑布局）──
        const panelPad = 10;
        g.panel = { x: 10, y: 10, w: g.divX - 20, h: H - 20, rx: 4 };
        g.panelCX = g.panel.x + g.panel.w / 2;

        // 指示牌：已储能 / 合闸指示 并列一排
        g.ledRowY = g.panel.y + 28;
        g.energyLed = { x: g.panelCX - 60, y: g.ledRowY };
        g.closeLed  = { x: g.panelCX + 20, y: g.ledRowY };

        // 按钮：合闸 / 分闸 并列一排
        g.btnRowY = g.panel.y + 70;
        g.btnClose = { x: g.panelCX - 65, y: g.btnRowY, w: 44, h: 44 };
        g.btnOpen  = { x: g.panelCX + 20, y: g.btnRowY, w: 44, h: 44 };

        // 储能手柄
        g.chargeHandle = { x: g.panelCX, y: g.panel.y + 135, r: 20 };

        // 摇出位置三按钮（底部）
        g.rackBtns = ['connected', 'test', 'disconnected'].map((k, i) => ({
            key: k, y: g.panel.y + 170 + i * 32,
        }));

        g.labelPos = { x: 0, y: -18, w: W };
    }

    // ═══════════════════════════════════════════
    // 参数初始化
    // ═══════════════════════════════════════════

    _initParameters(config) {
        this.label         = config.label || 'QF';
        this.ratedVoltage  = config.ratedVoltage !== undefined ? config.ratedVoltage : 400;
        this.ratedCurrent  = config.ratedCurrent !== undefined ? config.ratedCurrent : 1600;
        this.function      = config.function || '船用框架式空气断路器';

        this._state        = (config.initState || 'open').toLowerCase() === 'closed' ? 'closed' : 'open';
        this._charged      = !!config.initCharged;
        this._rackPos      = config.initRack || 'connected';
        this._tripLock     = false;

        this._animDur      = config.animDur !== undefined ? config.animDur : 0.38;
        this._animating    = false;
        this._animT        = 0;
        this._animFromX = this._animToX = this._spindleX =
            this._state === 'closed' ? this._g.spindleCloseX : this._g.spindleOpenX;
        this._animFromRot = this._animToRot = this._tripRot = 0;
        this._animFromSpring = this._animToSpring = this._springAct =
            this._charged ? this._g.springActCharged : this._g.springActUncharged;

        // 控制电压额定值与阈值
        this._ctrlRated      = config.ctrlRated !== undefined ? config.ctrlRated : 220;
        this._uvThresholdPct = config.uvThresholdPct !== undefined ? config.uvThresholdPct : 0.85;
        this._ctrlDetectV    = config.ctrlDetectV !== undefined ? config.ctrlDetectV : 120;
        this._shuntDetectV   = config.shuntDetectV !== undefined ? config.shuntDetectV : 40;
        this._ocDetectV      = config.ocDetectV !== undefined ? config.ocDetectV : 40;
        this._uvThreshold    = this._ctrlRated * this._uvThresholdPct;

        // 线圈/电机电阻（供 stampMainsSwitch 使用）
        this._motorR      = config.motorR      !== undefined ? config.motorR      : 10;
        this._closeCoilR  = config.closeCoilR  !== undefined ? config.closeCoilR  : 50;
        this._uvCoilR     = config.uvCoilR     !== undefined ? config.uvCoilR     : 120;
        this._shuntCoilR  = config.shuntCoilR  !== undefined ? config.shuntCoilR  : 50;
        this._ocCoilR     = config.ocCoilR     !== undefined ? config.ocCoilR     : 200;

        // 失压检测 RMS 缓冲（40 点）
        this._uvBuf = new Array(40).fill(0);
        this._uvBufIdx = 0;
        this._uvBufSum = 0;
        this._uvBufCount = 0;
        this._uvRms = 0;

        // 分励/过流滤波（连续帧计数）
        this._shuntFrames = 0;
        this._ocFrames = 0;

        // 合闸后延迟失压检测
        this._closedFrames = 0;

        this._strikerAnim = 0;                 // 撞针动画进度 0..1
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
        this._drawPanelStatic();
        this._drawSchematicStatic();
        this._drawTripDevices();
        this._drawTerminalStrips();
        this._drawLabel();
    }

    _drawFrame() {
        const f = this._frame = this._g.frame;
        this._staticGroup.add(new Konva.Rect({
            x: f.x, y: f.y, width: f.w, height: f.h,
            fill: '#dfe2ea', stroke: '#9aa0ae', strokeWidth: 1.5, cornerRadius: f.rx,
        }));
        this._staticGroup.add(new Konva.Line({
            points: [this._g.divX, f.y + 8, this._g.divX, f.y + f.h - 8],
            stroke: '#8898b0', strokeWidth: 1.5, dash: [6, 4],
        }));
    }

    // ── 左侧操作面板静态 ────────────────────────
    _drawPanelStatic() {
        const p = this._g.panel;
        // 面板壳体（浅灰蓝）
        this._staticGroup.add(new Konva.Rect({
            x: p.x, y: p.y, width: p.w, height: p.h,
            fill: '#e8ecf2', stroke: '#9aa0ae', strokeWidth: 1.2, cornerRadius: p.rx,
        }));
        // 面板标题条
        this._staticGroup.add(new Konva.Rect({
            x: p.x, y: p.y, width: p.w, height: 24,
            fill: 'rgba(60,110,180,0.18)', cornerRadius: [p.rx, p.rx, 0, 0],
        }));
        this._staticGroup.add(new Konva.Text({
            x: p.x, y: p.y + 4, width: p.w, text: '操作面板',
            fontSize: 11, fontStyle: 'bold', fill: '#3a4a5c', align: 'center',
        }));

        // 指示牌背景框：已储能 / 合闸指示 并列
        const ledLabels = ['已储能', '合闸指示'];
        const ledXs = [this._g.energyLed.x - 44, this._g.closeLed.x - 44];
        ledLabels.forEach((t, i) => {
            this._staticGroup.add(new Konva.Rect({
                x: ledXs[i], y: this._g.ledRowY - 12, width: 88, height: 28,
                fill: '#fff', stroke: '#aab4c0', strokeWidth: 1, cornerRadius: 3,
            }));
            this._staticGroup.add(new Konva.Text({
                x: ledXs[i], y: this._g.ledRowY - 10, width: 88,
                text: t, fontSize: 9, fill: '#506070', align: 'center',
            }));
        });

        // 按钮背景框：合闸 / 分闸 并列
        const btnLabels = ['手动合闸', '手动分闸'];
        const btnXs = [this._g.btnClose.x, this._g.btnOpen.x];
        btnLabels.forEach((t, i) => {
            this._staticGroup.add(new Konva.Text({
                x: btnXs[i], y: this._g.btnRowY + 4, width: 44,
                text: t, fontSize: 9, fill: i === 0 ? '#1a6a2a' : '#a02020',
                align: 'center', fontStyle: 'bold',
            }));
        });

        // 储能手柄标签
        this._staticGroup.add(new Konva.Text({
            x: p.x + 6, y: this._g.chargeHandle.y + 26, width: p.w - 12,
            text: '储能手柄', fontSize: 9, fill: '#3a3e44', align: 'center',
        }));

        // 摇出位置标签
        this._staticGroup.add(new Konva.Text({
            x: p.x + 6, y: this._g.rackBtns[0].y - 12, width: p.w - 12,
            text: '主开关摇出位置', fontSize: 9, fill: '#3a3e44', align: 'center', fontStyle: 'bold',
        }));

        // 摇出滑轨示意（底部）
        const railY = this._g.panel.y + this._g.panel.h - 12;
        this._staticGroup.add(new Konva.Line({
            points: [p.x + 6, railY, p.x + p.w - 6, railY],
            stroke: '#88909e', strokeWidth: 2,
        }));
    }

    // ── 右侧原理图区静态 ────────────────────────
    _drawSchematicStatic() {
        const g = this._g;
        const mainColors = ['#e03030', '#20a030', '#2050e0'];

        // 主触头三极：上进线（到顶部端口）+ 下出线（到底部端口）+ 静触点
        g.mainPoleXs.forEach((px, i) => {
            const color = mainColors[i];
            const topName = ['L1', 'L2', 'L3'][i];
            const botName = ['T1', 'T2', 'T3'][i];

            // 进线 / 出线
            this._staticGroup.add(new Konva.Line({
                points: [px, g.mainTopY - 12, px, 0], stroke: color, strokeWidth: 3, lineCap: 'round',
            }));
            this._staticGroup.add(new Konva.Line({
                points: [px, g.mainBotY + 12, px, this.height], stroke: color, strokeWidth: 3, lineCap: 'round',
            }));
            // 静触点（上 = 朝向下的半圆，下 = 朝上的半圆）
            this._staticGroup.add(new Konva.Arc({
                x: px, y: g.mainTopY, innerRadius: 0, outerRadius: 7,
                angle: 180, rotation: 180, fill: color, stroke: '#5a4a28', strokeWidth: 0.8,
            }));
            this._staticGroup.add(new Konva.Arc({
                x: px, y: g.mainBotY, innerRadius: 0, outerRadius: 7,
                angle: 180, rotation: 0, fill: color, stroke: '#5a4a28', strokeWidth: 0.8,
            }));
            // 端名
            this._staticGroup.add(new Konva.Text({
                x: px - 12, y: -16, text: topName, fontSize: 10, fontStyle: 'bold', fill: color,
            }));
            this._staticGroup.add(new Konva.Text({
                x: px - 12, y: this.height - 2, text: botName, fontSize: 10, fontStyle: 'bold', fill: color,
            }));
        });

        // 区域标注
        this._staticGroup.add(new Konva.Text({
            x: g.divX + 6, y: g.spindleY - 78, text: '主触头', fontSize: 11,
            fontStyle: 'bold', fill: '#3a4a5c',
        }));
    }

    // ── 脱扣器（分励/失压/过流）静态壳体 ─────────
    _drawTripDevices() {
        const g = this._g;
        const devs = [
            { key: 'shunt', label: '分励', color: '#a03030', port: 'SH1·SH2' },
            { key: 'uv',    label: '失压', color: '#b07010', port: 'UV1·UV2' },
            { key: 'oc',    label: '过流', color: '#2040a0', port: 'OC1·OC2' },
        ];
        devs.forEach(d => {
            const cx = g.tripDevX[d.key];
            const cy = g.tripDevY;
            // 壳体
            this._staticGroup.add(new Konva.Rect({
                x: cx - 22, y: cy - 8, width: 44, height: 30,
                fill: '#f4f4f6', stroke: d.color, strokeWidth: 1.5, cornerRadius: 3,
            }));
            // 电磁铁线圈
            for (let i = 0; i < 3; i++) {
                this._staticGroup.add(new Konva.Line({
                    points: [cx - 8, cy - 4 + i * 7, cx + 8, cy + 1 + i * 7],
                    stroke: '#6a5a28', strokeWidth: 1, tension: 0.4,
                }));
            }
            // 标签
            this._staticGroup.add(new Konva.Text({
                x: cx - 20, y: cy + 20, text: d.label, fontSize: 9, fontStyle: 'bold', fill: d.color,
            }));
            this._staticGroup.add(new Konva.Text({
                x: cx - 20, y: cy + 31, text: d.port, fontSize: 8, fill: '#708090',
            }));
            this._tripDevMeta = this._tripDevMeta || {};
            this._tripDevMeta[d.key] = { cx, color: d.color };
        });
    }

    // ── 右侧控制端子带（8 个端子）──────────────────────────
    _drawTerminalStrips() {
        const g = this._g;
        const terms = [
            ['mp',   'M+  储能电机'], ['mn',  'M-'],
            ['x',    'X   合闸线圈'], ['y',   'Y'],
            ['uv1',  'UV1 失压线圈'], ['uv2', 'UV2'],
            ['sh1',  'SH1 分励线圈'], ['sh2', 'SH2'],
            ['oc1',  'OC1 过流线圈'], ['oc2', 'OC2'],
        ];
        // 端子带背景
        this._staticGroup.add(new Konva.Rect({
            x: this.width - 86, y: 10, width: 78, height: this.height - 20,
            fill: '#eef0f4', stroke: '#aab4c0', strokeWidth: 1, cornerRadius: 3,
        }));
        this._staticGroup.add(new Konva.Text({
            x: this.width - 84, y: 14, text: '控制电路接口', fontSize: 9,
            fontStyle: 'bold', fill: '#3a4a5c',
        }));
        terms.forEach(([pid, label], i) => {
            const y = g.termYs[i];
            this._staticGroup.add(new Konva.Text({
                x: this.width - 80, y: y - 4, text: label, fontSize: 8, fill: '#40506a',
            }));
        });
    }

    _drawLabel() {
        this._staticGroup.add(new Konva.Text({
            x: 0, y: -18, width: this.width, text: `${this.function}  ${this.label}`,
            fontSize: Math.max(13, this.width * 0.022),
            fill: '#3a4a5c', fontStyle: 'bold', align: 'center',
        }));
    }

    // ═══════════════════════════════════════════
    // 动态层
    // ═══════════════════════════════════════════

    _createDynamicNodes() {
        this._createSpindle();
        this._createOpenSpring();
        this._createCloseSpring();
        this._createTripAxis();
        this._createMainBridges();
        this._createStrikers();
        this._createPanelLeds();
        this._createRackIndicators();
    }

    // 主轴（水平粗杆，合闸偏右 / 分闸偏左）
    _createSpindle() {
        const g = this._g;
        this._spindleGroup = new Konva.Group({ x: this._spindleX, y: g.spindleY, listening: false });
        this._spindleGroup.add(new Konva.Rect({
            x: -12, y: -4, width: g.spindleCloseX - g.spindleOpenX + 24, height: 8,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint: { x: 0, y: 8 },
            fillLinearGradientColorStops: [0, '#60a0d0', 0.5, '#90c8f0', 1, '#5090c0'],
            stroke: '#3078a0', strokeWidth: 0.8, cornerRadius: 2,
        }));
        // 右侧扣爪（被脱扣轴钩住的凸起）
        this._spindleGroup.add(new Konva.Rect({
            x: g.spindleCloseX - g.spindleOpenX - 4, y: -9, width: 8, height: 18,
            fill: '#7a8a9a', stroke: '#40505f', strokeWidth: 0.8, cornerRadius: 2,
        }));
        this._dynamicGroup.add(this._spindleGroup);
    }

    // 分闸弹簧（主轴左侧：固定点 → 主轴左端）
    _createOpenSpring() {
        const g = this._g;
        this._openSpring = new Konva.Line({
            points: this._makeSpringPoints(g.springFix.x, this._spindleX - 12, g.springFix.y),
            stroke: '#c06050', strokeWidth: 3, lineCap: 'round', lineJoin: 'round',
            listening: false,
        });
        this._dynamicGroup.add(this._openSpring);
    }

    // 合闸弹簧（储能弹簧，主轴上方：右端固定 → 活动端）
    _createCloseSpring() {
        const g = this._g;
        const y = g.closeSpringY;
        this._closeSpring = new Konva.Line({
            points: this._makeSpringPoints(this._springAct, g.closeSpringFix.x, y),
            stroke: '#b8860b', strokeWidth: 3, lineCap: 'round', lineJoin: 'round',
            listening: false,
        });
        // 锁钩（储能时扣住活动端）
        this._lockHook = new Konva.Rect({
            x: this._springAct - 4, y: y - 8, width: 8, height: 10,
            fill: '#606878', stroke: '#303a48', strokeWidth: 0.8, cornerRadius: 2,
            listening: false,
        });
        // 储能弹簧滑轨（背景）
        this._staticGroup.add(new Konva.Line({
            points: [g.spindleOpenX - 20, y, g.closeSpringFix.x, y],
            stroke: '#aab4c0', strokeWidth: 1, dash: [3, 3],
        }));
        this._dynamicGroup.add(this._closeSpring, this._lockHook);
    }

    // 脱扣轴（右下支点，绕轴旋转；顺时针转动释放主轴）
    _createTripAxis() {
        const g = this._g;
        this._tripAxis = new Konva.Group({
            x: g.tripPivot.x, y: g.tripPivot.y,
            rotation: this._tripRot, listening: false,
        });
        // 支点
        this._tripAxis.add(new Konva.Circle({
            x: 0, y: 0, radius: 6, fill: '#505a68', stroke: '#2a3038', strokeWidth: 1,
        }));
        // 脱扣杆（向上扣住主轴）
        this._tripAxis.add(new Konva.Line({
            points: [0, 0, 0, -g.tripLen], stroke: '#a03030', strokeWidth: 5, lineCap: 'round',
        }));
        // 杆端钩
        this._tripAxis.add(new Konva.Line({
            points: [0, -g.tripLen, -8, -g.tripLen + 8], stroke: '#a03030', strokeWidth: 4, lineCap: 'round',
        }));
        this._dynamicGroup.add(this._tripAxis);
    }

    // 主触头触桥（3 个，挂在主轴上，随主轴偏移）
    _createMainBridges() {
        const g = this._g;
        this._mainBridges = g.mainPoleXs.map((px, i) => {
            const color = ['#e03030', '#20a030', '#2050e0'][i];
            return this._createBridge(px, g.spindleY, color, 5.5, false, 34);
        });
    }

    // 辅触头触桥（已移除）

    // 单个触桥（竖直杆 + 上下半圆触点）
    _createBridge(cx, cy, color, dotR, isNC, half) {
        const g = new Konva.Group({ y: cy, x: 0, listening: false });
        const rod = new Konva.Line({
            points: [cx, -half, cx, half], stroke: '#d4a848', strokeWidth: 3, lineCap: 'round',
        });
        const top = new Konva.Arc({
            x: cx, y: -half, innerRadius: 0, outerRadius: dotR,
            angle: 180, rotation: isNC ? 90 : -90,
            fill: '#a09080', stroke: '#7a6028', strokeWidth: 0.8,
        });
        const bot = new Konva.Arc({
            x: cx, y: half, innerRadius: 0, outerRadius: dotR,
            angle: 180, rotation: isNC ? 90 : -90,
            fill: '#a09080', stroke: '#7a6028', strokeWidth: 0.8,
        });
        g.add(rod, top, bot);
        this._dynamicGroup.add(g);
        return { g, cx, rod, top, bot, dotR, isNC, half };
    }

    // 脱扣器撞针（动作时上移）
    _createStrikers() {
        this._strikers = {};
        ['shunt', 'uv', 'oc'].forEach(key => {
            const meta = this._tripDevMeta[key];
            const tip = new Konva.Circle({
                x: meta.cx, y: this._g.tripDevY - 14, radius: 3,
                fill: meta.color, visible: false, listening: false,
            });
            const pin = new Konva.Rect({
                x: meta.cx - 2, y: this._g.tripDevY - 20, width: 4, height: 12,
                fill: meta.color, visible: false, listening: false,
            });
            this._dynamicGroup.add(tip, pin);
            this._strikers[key] = { tip, pin, y0: this._g.tripDevY - 20 };
        });
    }

    // 左侧面板 LED（储能/分合闸指示）
    _createPanelLeds() {
        const g = this._g;
        this._energyLed = new Konva.Circle({
            x: g.energyLed.x, y: g.energyLed.y, radius: 7, listening: false,
            fill: this._charged ? '#f0b020' : '#5a5a60',
            stroke: '#2a2a30', strokeWidth: 1,
        });
        this._energyLedText = new Konva.Text({
            x: g.energyLed.x + 12, y: g.energyLed.y - 5,
            text: this._charged ? '已储能' : '未储能',
            fontSize: 10, fontStyle: 'bold', listening: false,
            fill: this._charged ? '#f0b020' : '#6a7078',
        });
        this._closeLed = new Konva.Circle({
            x: g.closeLed.x, y: g.closeLed.y, radius: 7, listening: false,
            fill: this._state === 'closed' ? '#20e030' : '#b02020',
            stroke: '#2a2a30', strokeWidth: 1,
        });
        this._closeLedText = new Konva.Text({
            x: g.closeLed.x + 12, y: g.closeLed.y - 5,
            text: this._state === 'closed' ? '合闸' : '分闸',
            fontSize: 10, fontStyle: 'bold', listening: false,
            fill: this._state === 'closed' ? '#20a030' : '#c02020',
        });
        this._dynamicGroup.add(this._energyLed, this._energyLedText, this._closeLed, this._closeLedText);
    }

    // 摇出位置指示灯（三个小灯）
    _createRackIndicators() {
        this._rackLeds = {};
        const g = this._g;
        const labels = { connected: '连接位', test: '试验位', disconnected: '脱扣位' };
        const colors = { connected: '#20a030', test: '#e0a020', disconnected: '#c02020' };
        g.rackBtns.forEach(btn => {
            const led = new Konva.Circle({
                x: g.panel.x + 14, y: btn.y, radius: 5, listening: false,
                fill: btn.key === this._rackPos ? colors[btn.key] : '#7a8088',
            });
            const txt = new Konva.Text({
                x: g.panel.x + 26, y: btn.y - 6, text: labels[btn.key], fontSize: 10,
                fontStyle: 'bold', listening: false,
                fill: btn.key === this._rackPos ? '#1a2a3a' : '#8a9098',
            });
            this._dynamicGroup.add(led, txt);
            this._rackLeds[btn.key] = { led, txt, color: colors[btn.key] };
        });
    }

    _makeSpringPoints(x0, x1, y) {
        const pts = [x0, y];
        const dx = x1 - x0;
        const turns = 7;
        const amp = Math.max(2.5, Math.abs(dx) * 0.12);
        for (let i = 0; i <= turns * 2; i++) {
            const t = i / (turns * 2);
            const x = x0 + t * dx;
            const yOff = (i % 2 === 0) ? -amp : amp;
            pts.push(x, y + yOff);
        }
        pts.push(x1, y);
        return pts;
    }

    // ═══════════════════════════════════════════
    // 动态更新（每帧 in-place）
    // ═══════════════════════════════════════════

    _updateDynamic() {
        const g = this._g;
        const t = Math.max(0, Math.min(1,
            (this._spindleX - g.spindleOpenX) / (g.spindleCloseX - g.spindleOpenX)));

        // 1) 主轴位置
        this._spindleGroup.x(this._spindleX);

        // 2) 分闸弹簧（固定点 → 主轴左端）
        this._openSpring.points(this._makeSpringPoints(g.springFix.x, this._spindleX - 12, g.springFix.y));

        // 3) 合闸弹簧 + 锁钩
        const y = g.closeSpringY;
        this._closeSpring.points(this._makeSpringPoints(this._springAct, g.closeSpringFix.x, y));
        this._lockHook.x(this._springAct - 4);
        this._lockHook.fill(this._charged ? '#f0a020' : '#606878');

        // 4) 脱扣轴旋转
        this._tripAxis.rotation(this._tripRot);

        // 5) 主触头触桥（合闸 → 触点闭合）
        const mainOff = g.closedGap * t + g.openDX * (1 - t);
        this._mainBridges.forEach(b => {
            this._placeBridge(b, mainOff, t > 0.5);
        });

        // 6) 脱扣器撞针
        const strikerVis = this._strikerAnim > 0.01;
        ['shunt', 'uv', 'oc'].forEach(key => {
            const s = this._strikers[key];
            const meta = this._tripDevMeta[key];
            const dy = this._strikerAnim * g.strikerUp;
            s.tip.visible(strikerVis);
            s.pin.visible(strikerVis);
            s.pin.y(s.y0 - dy);
            s.tip.y(g.tripDevY - 14 - dy);
            s.pin.fill(meta.color);
        });

        // 7) 面板 LED
        this._energyLed.fill(this._charged ? '#f0b020' : '#5a5a60');
        this._energyLedText.text(this._charged ? '已储能' : '未储能');
        this._energyLedText.fill(this._charged ? '#f0b020' : '#6a7078');
        const closed = this._state === 'closed';
        this._closeLed.fill(closed ? '#20e030' : '#b02020');
        this._closeLedText.text(closed ? '合闸' : '分闸');
        this._closeLedText.fill(closed ? '#20a030' : '#c02020');
    }

    _placeBridge(b, off, isClosed) {
        const x = b.cx + off;
        b.rod.points([x, -b.half, x, b.half]);
        b.top.x(x);
        b.top.y(-b.half);
        b.bot.x(x);
        b.bot.y(b.half);
        const fill = isClosed ? '#f0c860' : '#a09080';
        b.top.fill(fill);
        b.bot.fill(fill);
    }

    // ═══════════════════════════════════════════
    // 交互绑定
    // ═══════════════════════════════════════════

    _bindInteraction() {
        const g = this._g;

        // 手动合闸按钮（左侧）
        const closeBtn = new Konva.Circle({
            x: g.btnClose.x + g.btnClose.w / 2, y: g.btnClose.y + g.btnClose.h / 2,
            radius: 22, fill: '#2a9a3a', stroke: '#1a6a2a', strokeWidth: 2, cursor: 'pointer',
        });
        closeBtn.on('click tap', (e) => { e.cancelBubble = true; this.close(); });
        this._interactGroup.add(closeBtn);
        this.addClickablePart('close-btn', g.btnClose.x, g.btnClose.y, g.btnClose.w, g.btnClose.h);

        // 手动分闸按钮（右侧，兼复位）
        const openBtn = new Konva.Circle({
            x: g.btnOpen.x + g.btnOpen.w / 2, y: g.btnOpen.y + g.btnOpen.h / 2,
            radius: 22, fill: '#c03030', stroke: '#901c1c', strokeWidth: 2, cursor: 'pointer',
        });
        openBtn.on('click tap', (e) => {
            e.cancelBubble = true;
            if (this._tripLock) { this.reset(); return; }
            this.open();
        });
        this._interactGroup.add(openBtn);
        this.addClickablePart('open-btn', g.btnOpen.x, g.btnOpen.y, g.btnOpen.w, g.btnOpen.h);

        // 储能手柄（点击储能）
        const handle = new Konva.Circle({
            x: g.chargeHandle.x, y: g.chargeHandle.y, radius: g.chargeHandle.r,
            fillLinearGradientStartPoint: { x: -g.chargeHandle.r, y: -g.chargeHandle.r },
            fillLinearGradientEndPoint: { x: g.chargeHandle.r, y: g.chargeHandle.r },
            fillLinearGradientColorStops: [0, '#aab4c0', 0.5, '#6a7480', 1, '#505a66'],
            stroke: '#303840', strokeWidth: 1.5, cursor: 'pointer',
        });
        handle.on('click tap', (e) => { e.cancelBubble = true; this.charge(); });
        this._interactGroup.add(handle);
        this.addClickablePart('charge-handle', g.chargeHandle.x - g.chargeHandle.r, g.chargeHandle.y - g.chargeHandle.r, g.chargeHandle.r * 2, g.chargeHandle.r * 2);

        // 摇出位置三按钮
        const labels = { connected: '连接位', test: '试验位', disconnected: '脱扣位' };
        g.rackBtns.forEach(btn => {
            const hit = new Konva.Rect({
                x: g.panel.x, y: btn.y - 12, width: g.panel.w, height: 24,
                fill: 'transparent', cursor: 'pointer',
            });
            hit.on('click tap', (e) => {
                e.cancelBubble = true;
                this.setRackPos(btn.key);
            });
            this._interactGroup.add(hit);
            this.addClickablePart(`rack-${btn.key}`, g.panel.x, btn.y - 12, g.panel.w, 24);
        });
    }

    // ═══════════════════════════════════════════
    // tick（20fps）
    // ═══════════════════════════════════════════

    tick(dt) {
        this._tickAnimation(dt);
        this._detectControlVoltages(dt);

        // 自动清理提示文字
        if (this._noticeText && this._noticeShowTime && Date.now() > this._noticeShowTime) {
            this._noticeText.destroy();
            this._noticeText = null;
            this._noticeShowTime = null;
            this.markDirty();
        }

        if (this._animating || this._strikerAnim > 0.001) {
            this._updateDynamic();
            this.markDirty();
        }
        this._refreshIfDirty();
    }

    /** 控制回路电压检测（仅在非「脱扣位」启用） */
    _detectControlVoltages(dt) {
        if (this._rackPos === 'disconnected') return;

        const getV = (a, b) => Math.abs(this.sys.getVoltageBetween(`${this.id}_wire_${a}`, `${this.id}_wire_${b}`) || 0);

        // 储能电机 M+ / M-
        if (!this._charged && getV('mp', 'mn') > this._ctrlDetectV) this.charge();

        // 合闸线圈 X / Y（需已储能，逻辑在 close() 内校验）
        if (this._state === 'open' && !this._animating && getV('x', 'y') > this._ctrlDetectV) this.close();

        // 分励脱扣线圈 SH1 / SH2（连续 3 帧超阈值）
        if (getV('sh1', 'sh2') > this._shuntDetectV) {
            if (++this._shuntFrames >= 3) { this._shuntFrames = 0; this.trip('shunt'); }
        } else {
            this._shuntFrames = 0;
        }

        // 过流脱扣线圈 OC1 / OC2（连续 3 帧超阈值）
        if (getV('oc1', 'oc2') > this._ocDetectV) {
            if (++this._ocFrames >= 3) { this._ocFrames = 0; this.trip('overcurrent'); }
        } else {
            this._ocFrames = 0;
        }

        // 失压脱扣线圈 UV1 / UV2（合闸运行期间失压立即脱扣，RMS 滤波）
        if (this._state === 'closed' && this._closedFrames > 20) {
            const inst = getV('uv1', 'uv2');
            const i2 = inst * inst;
            const old = this._uvBuf[this._uvBufIdx];
            this._uvBuf[this._uvBufIdx] = i2;
            this._uvBufSum = this._uvBufSum - old + i2;
            this._uvBufIdx = (this._uvBufIdx + 1) % 40;
            if (this._uvBufCount < 40) this._uvBufCount++;
            this._uvRms = Math.sqrt(this._uvBufSum / Math.max(1, this._uvBufCount));
            if (this._uvBufCount >= 40 && this._uvRms < this._uvThreshold) {
                this.trip('undervoltage');
            }
        } else {
            this._uvBufCount = 0;
            this._uvBufSum = 0;
            this._uvRms = 0;
            this._uvBuf.fill(0);
        }

        if (this._state === 'closed') this._closedFrames++;
        else this._closedFrames = 0;
    }

    /** 状态插值动画 */
    _tickAnimation(dt) {
        if (!this._animating) return;
        this._animT += dt / this._animDur;
        if (this._animT >= 1) {
            this._animT = 1;
            this._animating = false;
            this._spindleX = this._animToX;
            this._tripRot = this._animToRot;
            this._springAct = this._animToSpring;
            this._strikerAnim = this._strikerTarget;
            return;
        }
        const ease = 0.5 - 0.5 * Math.cos(this._animT * Math.PI);
        this._spindleX = this._animFromX + (this._animToX - this._animFromX) * ease;
        this._tripRot = this._animFromRot + (this._animToRot - this._animFromRot) * ease;
        this._springAct = this._animFromSpring + (this._animToSpring - this._animFromSpring) * ease;
        this._strikerAnim = this._strikerFrom + (this._strikerTarget - this._strikerFrom) * ease;
    }

    _startAnim(fromX, toX, fromRot, toRot, fromSpring, toSpring, dur, strikerTarget = 0) {
        this._animFromX = fromX;
        this._animToX = toX;
        this._animFromRot = fromRot;
        this._animToRot = toRot;
        this._animFromSpring = fromSpring;
        this._animToSpring = toSpring;
        this._strikerFrom = this._strikerAnim;
        this._strikerTarget = strikerTarget;
        this._animT = 0;
        this._animDur = dur;
        this._animating = true;
        this._updateDynamic();
    }

    // ═══════════════════════════════════════════
    // 公开 API（动作）
    // ═══════════════════════════════════════════

    /** 储能：拉出储能弹簧并由锁钩扣住 */
    charge() {
        if (this._animating || this._charged) return;
        this._charged = true;
        this._startAnim(
            this._spindleX, this._spindleX,
            this._tripRot, this._tripRot,
            this._springAct, this._g.springActCharged,
            0.32
        );
    }

    /** 合闸：需已储能 + 无脱扣锁存 */
    close() {
        if (this._state === 'closed' || this._animating) return false;
        if (!this._charged) {
            this._flashNotice('未储能，请先储能！');
            return false;
        }
        if (this._tripLock) {
            this._flashNotice('脱扣锁存，请先复位！');
            return false;
        }
        this._charged = false;
        this._state = 'closed';
        this.opsCount++;
        this._startAnim(
            this._spindleX, this._g.spindleCloseX,
            this._tripRot, 0,
            this._springAct, this._g.springActUncharged,
            this.config.animDur || 0.38,
            0
        );
        return true;
    }

    /** 手动分闸（不锁存） */
    open() {
        if (this._state === 'open' || this._animating) return;
        this._state = 'open';
        this.opsCount++;
        this._startAnim(
            this._spindleX, this._g.spindleOpenX,
            this._tripRot, this._g.tripRotMax,
            this._springAct, this._springAct,
            (this.config.animDur || 0.38) * 0.85,
            0
        );
    }

    /** 脱扣（type: 'shunt' | 'undervoltage' | 'overcurrent' | 'manual'） */
    trip(type = 'manual') {
        if (this._state === 'open' || this._animating) return;
        if (type !== 'manual') {
            this._tripLock = true;
        }
        this._tripSource = type;
        this._state = 'open';
        this.opsCount++;
        this._startAnim(
            this._spindleX, this._g.spindleOpenX,
            this._tripRot, this._g.tripRotMax,
            this._springAct, this._springAct,
            0.42,
            1
        );
    }

    /** 复位脱扣锁存 */
    reset() {
        this._tripLock = false;
    }

    /** 切换摇出位置 */
    setRackPos(pos) {
        if (!['connected', 'test', 'disconnected'].includes(pos)) return;
        this._rackPos = pos;
        this._updateRackLeds();
        this.markDirty();
    }

    _updateRackLeds() {
        const g = this._g;
        const labels = { connected: '连接位', test: '试验位', disconnected: '脱扣位' };
        Object.keys(this._rackLeds).forEach(key => {
            const active = key === this._rackPos;
            this._rackLeds[key].led.fill(active ? this._rackLeds[key].color : '#7a8088');
            this._rackLeds[key].txt.fill(active ? '#1a2a3a' : '#8a9098');
        });
    }

    /** 短暂提示文字（未储能等） */
    _flashNotice(msg) {
        if (this._noticeText) this._noticeText.destroy();
        const p = this._g.panel;
        this._noticeText = new Konva.Text({
            x: p.x, y: p.y + p.h - 30, width: p.w,
            text: msg, fontSize: 10, fontStyle: 'bold',
            fill: '#c03030', align: 'center', listening: false,
        });
        this._interactGroup.add(this._noticeText);
        this._noticeShowTime = Date.now() + 2500; // 2.5秒后自动消失
        this.markDirty();
    }

    getState()      { return this._state; }
    isClosed()      { return this._state === 'closed'; }
    isCharged()     { return this._charged; }
    isTrippedLock() { return this._tripLock; }
    getTripSource() { return this._tripSource || null; }
    getRackPos()    { return this._rackPos; }
    getOpsCount()   { return this.opsCount; }

    update(state) {
        const s = String(state).toLowerCase();
        if (s === 'closed' || s === 'close' || s === 'on') this.close();
        if (s === 'open' || s === 'off') this.open();
        if (s === 'charge') this.charge();
        if (s === 'trip') this.trip('manual');
        if (s === 'reset') this.reset();
    }

    getConfigFields() {
        return [
            { label: '位号/名称',           key: 'label',          type: 'text'   },
            { label: '额定电压 (V)',         key: 'ratedVoltage',   type: 'number' },
            { label: '额定电流 (A)',         key: 'ratedCurrent',   type: 'number' },
            { label: '初始状态 open/closed',  key: 'initState',     type: 'text'   },
            { label: '初始摇出位置',          key: 'initRack',      type: 'text'   },
            { label: '动作时间 (s)',         key: 'animDur',        type: 'number' },
            { label: '控制电压额定 (V)',      key: 'ctrlRated',      type: 'number' },
            { label: '失压阈值比',           key: 'uvThresholdPct', type: 'number' },
            { label: '储能/合闸检测电压 (V)', key: 'ctrlDetectV',   type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label !== undefined) this.label = cfg.label;
        if (cfg.ratedVoltage !== undefined) this.ratedVoltage = parseFloat(cfg.ratedVoltage);
        if (cfg.ratedCurrent !== undefined) this.ratedCurrent = parseFloat(cfg.ratedCurrent);
        if (cfg.animDur !== undefined) this._animDur = parseFloat(cfg.animDur);
        if (cfg.ctrlRated !== undefined) this._ctrlRated = parseFloat(cfg.ctrlRated);
        if (cfg.uvThresholdPct !== undefined) {
            this._uvThresholdPct = parseFloat(cfg.uvThresholdPct);
            this._uvThreshold = this._ctrlRated * this._uvThresholdPct;
        }
        if (cfg.ctrlDetectV !== undefined) this._ctrlDetectV = parseFloat(cfg.ctrlDetectV);
        if (cfg.initState !== undefined) {
            const want = cfg.initState.toLowerCase();
            if (want === 'closed' && this._state !== 'closed') this.close();
            if (want === 'open' && this._state !== 'open') this.open();
        }
        if (cfg.initRack !== undefined) this.setRackPos(cfg.initRack);
        this.config = { ...this.config, ...cfg };
        this.markDirty();
    }

    destroy() {
        super.destroy?.();
    }
}
