import Konva from 'konva';
import { BaseComponent } from './BaseComponent.js';

/**
 * MF47Multimeter.js — 指针式万用表仿真组件
 *
 * 表头参数：满偏电流 Ig = 46.2 µA，内阻 Rg = 5000 Ω
 *
 * ── 测量功能 / 档位 ─────────────────────────────────────
 *  直流电压 (DCV)  : 10 V / 50 V / 250 V
 *  交流电压 (ACV)  : 50 V / 250 V / 500 V
 *  直流电流 (DCmA) : 50 mA / 500 mA
 *  电阻    (OHM)  : ×10 / ×100 / ×1K / ×10K
 *
 * ── 端口 ────────────────────────────────────────────────
 *  COM  — 公共地（底部中央）
 *  VΩI  — 电压 / 电阻 / 小电流正端（底部右侧）
 *  mA   — 大电流正端（底部左侧）
 *
 * ── 渲染优化 ────────────────────────────────────────────
 *  遵循 KnifeSwitch 渲染策略：
 *  1. 动态节点一次性创建（_createDynamicNodes），每帧仅 in-place
 *     修改属性（rotation / fill / text / visible），不销毁重建。
 *  2. 消除所有 shadow 属性，避免离屏阴影渲染开销。
 *  3. _staticGroup 仅在 init 时 cache() 一次，运行时不刷新。
 *  4. 仅当状态改变时调用 markDirty()，_refreshIfDirty() 在 tick 末尾。
 *
 * ── 物理模型 ────────────────────────────────────────────
 *  • 电压档：偏转 = |V| / V_fs
 *  • 电流档：偏转 = |I| / I_fs
 *  • 电阻档：偏转 = Rmid / (Rmid + Rx)，Rmid = 倍率 × 20 Ω
 *  • 指针动力学：二阶弹簧-阻尼，k=60，b = damping × 2√k
 *
 * ── 可配置参数 ──────────────────────────────────────────
 *  label       : 位号（默认 'PU'）
 *  rangeId     : 初始档位 ID（默认 'DCV50'）
 *  inputValue  : 输入量（V / A / Ω，由仿真平台注入）
 *  damping     : 阻尼系数 0.1~1.5（默认 0.85）
 *  showDigital : 是否显示辅助数字读数（默认 true）
 */

/* ═══════════════════════════════════════════════════════
   常量
════════════════════════════════════════════════════════ */
const Ig = 46.2e-6;   // 满偏电流 A
const Rg = 5000;       // 表头内阻 Ω

/** 全部12个档位定义 */
const RANGES = [
    // ── 直流电压 ─────────────────────────────────────
    { id: 'DCV10', label: '10V', group: 'DCV', fullScale: 10, unit: 'V' },
    { id: 'DCV50', label: '50V', group: 'DCV', fullScale: 50, unit: 'V' },
    { id: 'DCV250', label: '250V', group: 'DCV', fullScale: 250, unit: 'V' },
    // ── 交流电压 ─────────────────────────────────────
    { id: 'ACV50', label: '~50V', group: 'ACV', fullScale: 50, unit: 'V' },
    { id: 'ACV250', label: '~250V', group: 'ACV', fullScale: 250, unit: 'V' },
    { id: 'ACV500', label: '~500V', group: 'ACV', fullScale: 500, unit: 'V' },
    // ── 直流电流 ─────────────────────────────────────
    { id: 'MA50', label: '50mA', group: 'DCmA', fullScale: 0.05, unit: 'A' },
    { id: 'MA500', label: '500mA', group: 'DCmA', fullScale: 0.5, unit: 'A' },
    // ── 电阻 ─────────────────────────────────────────
    { id: 'OHM10', label: '×10', group: 'OHM', multiplier: 10, unit: 'Ω' },
    { id: 'OHM100', label: '×100', group: 'OHM', multiplier: 100, unit: 'Ω' },
    { id: 'OHM1K', label: '×1K', group: 'OHM', multiplier: 1000, unit: 'Ω' },
    { id: 'OHM10K', label: '×10K', group: 'OHM', multiplier: 10000, unit: 'Ω' },
];

/**
 * 旋钮角度映射（从12点顺时针为正，度）
 * ACV 区段在顶部，顺时针依次经过 DCV、DCmA、OHM
 */
const KNOB_ANGLES = {
    'ACV500': 0,
    'ACV250': -30,
    'ACV50': -60,
    'DCV250': -90,
    'DCV50': -120,
    'DCV10': -150,
    'MA500': 180,
    'MA50': 150,
    'OHM10K': 120,
    'OHM1K': 90,
    'OHM100': 60,
    'OHM10': 30
};

/* 指针扫描弧（Konva 坐标，0°=右，顺时针） */
const NEEDLE_START = 0;     // deflection=0 对应角度（左上）
const NEEDLE_SPAN = 180;   // 总扫描范围（°），从左到右扫过上方

/* ═══════════════════════════════════════════════════════
   组件类
════════════════════════════════════════════════════════ */
export class MF47Multimeter extends BaseComponent {

    constructor(config, sys) {
        super(config, sys);

        /* 尺寸（与平台约定保持一致，设最小值保护） */
        this.width = Math.max(200, config.width || 320);
        this.height = Math.max(300, config.height || 480);

        this.type = 'mf47';
        this.special = 'none';
        this.cache = 'fixed';

        /* 初始化三层分组（BaseComponent 提供） */
        this._initGroups();

        /* 几何计算 → 参数初始化 → 绘制 */
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        /* 向平台暴露配置快照 */
        this.config = {
            label: this.label,
            rangeId: this._rangeId,
            inputValue: this._inputValue,
            damping: this._damping,
            showDigital: this._showDigital,
        };

        /* 端口注册（addPort 签名与 KnifeSwitch 一致） */
        this.addPort(this._portCOM.x, this._portCOM.y, 'COM', 'wire');
        this.addPort(this._portVOI.x, this._portVOI.y, 'v', 'wire', 'p');
        this.addPort(this._portMA.x, this._portMA.y, 'mA', 'wire', 'p');
    }

    /* ═══════════════════════════════════════════
       几何计算
    ════════════════════════════════════════════ */

    _recalcGeometry() {
        const W = this.width, H = this.height;

        /* 表盘（上半部分） */
        this._dial = {
            cx: W * 0.50,
            cy: H * 0.35,
            r: W * 0.43,
        };

        /* 旋钮 */
        this._knob = {
            cx: W * 0.50,
            cy: H * 0.625,
            r: W * 0.28,
        };

        /* 端子接线柱 Y 坐标 */
        const termY = H * 0.935;
        this._portCOM = { x: W * 0.50, y: termY };
        this._portVOI = { x: W * 0.78, y: termY };
        this._portMA = { x: W * 0.22, y: termY };

        /* 接线柱显示位置（略高于端口，留出接线空间） */
        this._termY = H * 0.935;
    }

    /* ═══════════════════════════════════════════
       参数初始化
    ════════════════════════════════════════════ */

    _initParameters(config) {
        this.label = config.label ?? '江苏航院';
        this._rangeId = config.rangeId ?? 'ACV500';
        this._inputValue = config.inputValue ?? 0;
        this._damping = config.damping ?? 0.85;
        this._showDigital = config.showDigital ?? true;

        /* 指针物理状态 */
        this._deflection = 0;
        this._velocity = 0;

        /* 缓存当前档位对象 */
        this._range = this._findRange(this._rangeId);
    }

    /* ═══════════════════════════════════════════
       初始化入口
    ════════════════════════════════════════════ */

    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
    }

    /* ═══════════════════════════════════════════
       静态层（仅绘制一次）
    ════════════════════════════════════════════ */

    _drawStaticParts() {
        this._drawShell();
        // this._drawDialFace();
        this._drawScaleArcs();
        this._drawKnobTrack();
        this._drawKnobRangeLabels();
        this._drawTerminalBases();
        // this._drawLabel();
    }

    /* 外壳：青色边框 + 深色面板 */
    _drawShell() {
        const W = this.width, H = this.height;
        this._staticGroup.add(new Konva.Rect({
            x: 0, y: 0, width: W, height: H,
            cornerRadius: 36,
            fill: '#1b1f1f', stroke: '#6b5b4a', strokeWidth: 3,
        }));
        this._staticGroup.add(new Konva.Rect({
            x: 12, y: 12, width: W - 24, height: H - 24,
            cornerRadius: 24,
            fill: '#e8e2d4',
        }));
    }

    /* 表盘底面 + 同心彩弧装饰 */
    _drawDialFace() {
        const { cx, cy, r } = this._dial;

        /* 表盘底面 */
        this._staticGroup.add(new Konva.Arc({
            x: cx, y: cy,
            innerRadius: 0, outerRadius: r,
            angle: 180, rotation: 180,
            fill: '#3a3834', stroke: '#8a8070', strokeWidth: 1.5,
        }));

        /* 同心彩弧（更深沉、工业感） */
        [
            { rFrac: 0.47, wFrac: 0.12, fill: '#8b1a1a' },
            { rFrac: 0.32, wFrac: 0.10, fill: '#1a4a5e' },
            { rFrac: 0.17, wFrac: 0.10, fill: '#c4b696' },
        ].forEach(({ rFrac, wFrac, fill }) => {
            this._staticGroup.add(new Konva.Arc({
                x: cx, y: cy,
                innerRadius: r * (rFrac - wFrac / 2),
                outerRadius: r * (rFrac + wFrac / 2),
                angle: 180, rotation: 180,
                fill,
            }));
        });

        /* 表盘底边直线 */
        this._staticGroup.add(new Konva.Line({
            points: [cx - r, cy, cx + r, cy],
            stroke: '#BDBDBD', strokeWidth: 1,
        }));
    }

    /* 刻度弧线系统 */
    _drawScaleArcs() {
        this._drawMainScale();
        this._drawOhmScale();
        this._drawACVArcs();
    }

    /* 主刻度（0–100，黑色，线性） */
    _drawMainScale() {
        const { cx, cy, r } = this._dial;
        const scaleR = r * 0.89;

        for (let i = 0; i <= 100; i++) {
            const { cos, sin } = this._needleCS(i / 100);
            const isMajor = i % 10 === 0;
            const isMid = i % 5 === 0;
            const len = r * (isMajor ? 0.072 : isMid ? 0.048 : 0.028);

            this._staticGroup.add(new Konva.Line({
                points: [
                    cx + scaleR * cos, cy + scaleR * sin,
                    cx + (scaleR - len) * cos, cy + (scaleR - len) * sin,
                ],
                stroke: '#222',
                strokeWidth: isMajor ? 1.6 : 0.7,
            }));

            if (isMajor) {
                const lr = scaleR - len - r * 0.11;
                this._staticGroup.add(new Konva.Text({
                    x: cx + lr * cos - 10,
                    y: cy + lr * sin - 6,
                    width: 28, height: 12,
                    text: String(i),
                    fontSize: r * 0.11,
                    fontStyle: 'bold',
                    fill: '#1a1a1a',
                    align: 'center',
                    fontFamily: 'Arial',
                }));
            }
        }
    }

    /* 电阻刻度（对数，暗红色，反向：∞在左 0在右） */
    _drawOhmScale() {
        const { cx, cy, r } = this._dial;
        const ohmR = r * 0.93;
        const Rmid_1 = 20;      // ×1 中值（中值对应 deflection=0.5）
        const ticks = [0, 1, 2, 3, 5, 10, 20, 30, 50, 100, 200];

        ticks.forEach(v => {
            const frac = v === 0 ? 1 : Rmid_1 / (Rmid_1 + v);
            const { cos, sin } = this._needleCS(frac);
            const len = r * 0.05;

            this._staticGroup.add(new Konva.Line({
                points: [
                    cx + ohmR * cos, cy + ohmR * sin,
                    cx + (ohmR + len) * cos, cy + (ohmR + len) * sin,
                ],
                stroke: '#8B0000', strokeWidth: 1,
            }));

            const lr = ohmR + len+6 ;
            this._staticGroup.add(new Konva.Text({
                x: cx + lr * cos - 10,
                y: cy + lr * sin - 6,
                width: 20, height: 12,
                text: String(v),
                fontSize: r * 0.12,
                fill: '#8B0000',
                align: 'center',
                fontFamily: 'Arial',
            }));
        });

        /* Ω 符号居中 */
        this._staticGroup.add(new Konva.Text({
            x: cx+20 , y: cy - r * 1.05,
            width: 24, height: 16,
            text: 'Ω',
            fontSize: r * 0.13,
            fontStyle: 'bold',
            fill: '#8B0000',
            align: 'center',
            fontFamily: 'Arial',
        }));
    }

    /* 交流电压弧（绿色，外圈两条条） */
    _drawACVArcs() {
        const { cx, cy, r } = this._dial;
        const defs = [
            { fs: 50, arcR: r * 0.905, label: 'VA' },
            { fs: 250, arcR: r * 0.935, label: 'R' },
        ];

        defs.forEach(({ fs, arcR, label }) => {
            /* 弧折线 */
            const pts = [];
            for (let a = NEEDLE_START; a <= NEEDLE_START + NEEDLE_SPAN; a += 1.5) {
                const rad = a * Math.PI / 180;
                pts.push(cx - arcR * Math.cos(rad), cy - arcR * Math.sin(rad));
            }
            this._staticGroup.add(new Konva.Line({
                points: pts, stroke: '#4a7a4a', strokeWidth: 1.2,
            }));
        });
    }


    /* 旋钮环形轨道 */
    _drawKnobTrack() {
        const { cx, cy, r } = this._knob;
        /* 深色主环 */
        this._staticGroup.add(new Konva.Ring({
            x: cx, y: cy,
            innerRadius: r * 0.82,
            outerRadius: r * 0.98,
            fill: '#2a2826',
        }));

        /* 功能色段弧（工业感低饱和度） */
        const colorSegs = [
            { ids: ['ACV500', 'ACV250', 'ACV50'], color: '#c62828' },
            { ids: ['DCV250', 'DCV50', 'DCV10'], color: '#d4866a' },
            { ids: ['MA500', 'MA50'], color: '#3a8a3a' },
            { ids: ['OHM10K', 'OHM1K', 'OHM100', 'OHM10'], color: '#8aa86a' },
        ];
        colorSegs.forEach(({ ids, color }) => {
            const angles = ids.map(id => KNOB_ANGLES[id]);
            const a1 = Math.min(...angles);
            const a2 = Math.max(...angles);
            const pts = [];
            for (let a = a1; a <= a2; a += 2) {
                const rad = (a - 90) * Math.PI / 180;   // 从12点顺时针转为数学角
                pts.push(cx + r * 0.90 * Math.cos(rad), cy + r * 0.90 * Math.sin(rad));
            }
            if (pts.length >= 4) {
                this._staticGroup.add(new Konva.Line({
                    points: pts, stroke: color,
                    strokeWidth: r * 0.115, lineCap: 'round', lineJoin: 'round',
                }));
            }
        });
    }

    /* 旋钮档位标签及点标（静态文字，高亮由动态层覆盖） */
    _drawKnobRangeLabels() {
        const { cx, cy, r } = this._knob;
        RANGES.forEach(range => {
            const a = KNOB_ANGLES[range.id];
            const rad = (a - 90) * Math.PI / 180;
            const lr = r * 1.15;

            /* 档位文字（暗色，静态） */
            this._staticGroup.add(new Konva.Text({
                x: cx + lr * Math.cos(rad) - 20,
                y: cy + lr * Math.sin(rad) - 7,
                width: 48, height: 14,
                text: range.label,
                fontSize: 14,
                fill: '#080808',
                align: 'center',
                fontFamily: 'Arial',
            }));

            /* 暗点 */
            const pr = r * 0.89;
            this._staticGroup.add(new Konva.Circle({
                x: cx + pr * Math.cos(rad),
                y: cy + pr * Math.sin(rad),
                radius: 2.5, fill: '#090909',
            }));
        });
    }

    /* 接线柱底座（静态圆环 + 标签） */
    _drawTerminalBases() {
        const W = this.width;
        const y = this._termY;
        [
            { x: W * 0.22, label: 'mA', ringFill: '#CC0000' },
            { x: W * 0.50, label: 'COM', ringFill: '#333333' },
            { x: W * 0.78, label: 'V-Ω', ringFill: '#CC0000' },
        ].forEach(({ x, label, ringFill }) => {
            /* 外环 */
            this._staticGroup.add(new Konva.Circle({
                x, y, radius: 13.5,
                fill: '#5a4a3a', stroke: ringFill, strokeWidth: 2.5,
            }));            
            /* 中环 */
            this._staticGroup.add(new Konva.Circle({
                x, y, radius: 11,
                fill: '#9a9080', stroke: '#c0b8a8', strokeWidth: 1.5,
            }));
            /* 内芯 */
            this._staticGroup.add(new Konva.Circle({
                x, y, radius: 7, fill: ringFill,
            }));
            /* 标签 */
            this._staticGroup.add(new Konva.Text({
                x: x - 20, y: y - 28, width: 40,
                text: label,
                fontSize: 14,
                fontStyle: 'bold',
                fill: '#1a1a1a', align: 'center', fontFamily: 'Arial',
            }));
        });
    }

    /* 位号铭牌 */
    _drawLabel() {
        this._staticGroup.add(new Konva.Text({
            x: 0, y: -18, width: this.width,
            text: `${this.label}  MF47`,
            fontSize: Math.max(8, this.width * 0.045),
            fontStyle: 'bold',
            fill: '#c0b8a8', align: 'center', fontFamily: 'Arial',
        }));
    }

    /* ═══════════════════════════════════════════
       动态层（一次性创建，每帧 in-place 更新）
    ════════════════════════════════════════════ */

    _createDynamicNodes() {
        const { cx, cy, r } = this._dial;
        const kn = this._knob;

        /* ── 镜面防视差弧（随指针移动） ── */
        this._mirrorArc = new Konva.Arc({
            x: cx, y: cy,
            innerRadius: r * 0.83, outerRadius: r * 0.87,
            angle: 14, rotation: 0,
            fill: 'rgba(200,195,185,0.35)',
        });
        this._dynamicGroup.add(this._mirrorArc);

        /* ── 指针 ── */
        this._needle = new Konva.Line({
            points: [cx, cy, cx, cy - r * 0.86],
            stroke: '#111', strokeWidth: 1.8, lineCap: 'round',
        });
        this._dynamicGroup.add(this._needle);

        /* ── 轴心圆 ── */
        this._dynamicGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: 4.5, fill: '#555',
        }));
        this._dynamicGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: 2, fill: '#AAA',
        }));

        /* ── 旋钮中心（渐变圆盘） ── */
        this._knobCenter = new Konva.Circle({
            x: kn.cx, y: kn.cy, radius: kn.r * 0.12,
            fillRadialGradientStartPoint: { x: -kn.r * 0.06, y: -kn.r * 0.06 },
            fillRadialGradientEndPoint: { x: 0, y: 0 },
            fillRadialGradientStartRadius: 0,
            fillRadialGradientEndRadius: kn.r * 0.22,
            fillRadialGradientColorStops: [0, '#b0a898', 1, '#4a4440'],
            stroke: '#6a6050', strokeWidth: 1.5,
        });
        this._dynamicGroup.add(this._knobCenter);

        /* ── 旋钮指示线 ── */
        this._knobIndicator = new Konva.Line({
            points: [kn.cx, kn.cy, kn.cx, kn.cy - kn.r * 0.75],
            stroke: '#0c5c03', strokeWidth: 10, lineCap: 'round',
        });
        this._dynamicGroup.add(this._knobIndicator);

        /* ── 当前档位高亮文字（叠在静态标签上方） ── */
        this._rangeLabelHL = new Konva.Text({
            x: kn.cx - 20, y: kn.cy - kn.r * 1.15 - 7,
            width: 48, height: 14,
            text: this._range.label,
            fontSize: 14,
            fill: '#fc0606', align: 'center', fontFamily: 'Arial',
        });
        this._dynamicGroup.add(this._rangeLabelHL);

        /* ── 当前档位高亮点 ── */
        this._rangeDotHL = new Konva.Circle({
            x: kn.cx, y: kn.cy,
            radius: 6, fill: '#FFFFFF',
        });
        this._dynamicGroup.add(this._rangeDotHL);

        /* ── 数字辅助读数 ── */
        this._digitalText = new Konva.Text({
            x: 0, y: this.height * 0.26,
            width: this.width,
            text: '',
            fontSize: 18,
            fontFamily:'bold',
            fill: '#101010', align: 'center', fontFamily: 'Arial',
        });
        this._dynamicGroup.add(this._digitalText);

        /* 初始渲染 */
        this._updateDynamic();
    }

    /** 每帧 in-place 更新动态节点属性，不销毁重建 */
    _updateDynamic() {
        const defl = Math.max(0, Math.min(1, this._deflection));
        const { cx, cy, r } = this._dial;
        const kn = this._knob;

        /* 1) 指针位置 */
        const { cos, sin } = this._needleCS(defl);
        const tipX = cx + r * 0.86 * cos;
        const tipY = cy + r * 0.86 * sin;
        const tailX = cx - r * 0.12 * cos;
        const tailY = cy - r * 0.12 * sin;
        this._needle.points([tailX, tailY, tipX, tipY]);

        /* 2) 镜面弧：跟随指针方向 */
        const needleDir = Math.atan2(sin, cos) * 180 / Math.PI;
        this._mirrorArc.rotation(needleDir - 7);   // 居中显示14°弧

        /* 3) 旋钮指示线 */
        const ka = KNOB_ANGLES[this._rangeId] ?? 0;
        const krad = (ka - 90) * Math.PI / 180;
        const kLen = kn.r * 0.75;
        this._knobIndicator.points([
            kn.cx, kn.cy,
            kn.cx + kLen * Math.cos(krad),
            kn.cy + kLen * Math.sin(krad),
        ]);

        /* 4) 当前档位高亮文字 & 点 */
        const hrad = krad;
        const lr = kn.r * 1.15;
        this._rangeLabelHL.x(kn.cx + lr * Math.cos(hrad) - 20);
        this._rangeLabelHL.y(kn.cy + lr * Math.sin(hrad) - 7);
        this._rangeLabelHL.text(this._range.label);

        const pr = kn.r * 0.90;
        this._rangeDotHL.x(kn.cx + pr * Math.cos(hrad));
        this._rangeDotHL.y(kn.cy + pr * Math.sin(hrad));

        /* 5) 数字辅助读数 */
        this._digitalText.visible(this._showDigital);
        if (this._showDigital) {
            this._digitalText.text(this._buildReadout());
        }
    }

    /* ═══════════════════════════════════════════
       交互绑定
    ════════════════════════════════════════════ */

    _bindInteraction() {
        const kn = this._knob;

        /* 为每个档位创建扇形热区 */
        RANGES.forEach(range => {
            const a = KNOB_ANGLES[range.id];
            const pad = 13;   // 每档 ±13° 热区
            const zone = new Konva.Arc({
                x: kn.cx, y: kn.cy,
                innerRadius: kn.r * 0.28,
                outerRadius: kn.r * 1.25,
                angle: pad * 2,
                /* Konva Arc rotation 从右顺时针；我们的 a 从12点顺时针
                   Konva: a - 90 把12点起的角转为右侧起的角，再减半宽 */
                rotation: a - 90 - pad,
                fill: 'rgba(0,0,0,0)',
                hitStrokeWidth: 0,
                listening: true,
            });

            zone.on('click tap', () => {
                this._setRange(range.id);
                this.emit?.('rangeChanged', { rangeId: range.id });
            });
            zone.on('mouseenter', () => { document.body.style.cursor = 'pointer'; });
            zone.on('mouseleave', () => { document.body.style.cursor = 'default'; });
            this._interactGroup.add(zone);
        });
    }

    /* ═══════════════════════════════════════════
       tick（由平台以固定频率调用，dt 单位秒）
    ════════════════════════════════════════════ */

    tick(dt) {
        /* 根据档位计算输入量 */
        const group = this._range?.group;
        const solver = this.sys?.voltageSolver;

        if (group === 'DCmA') {
            this._inputValue = Math.abs(this.physCurrent || 0);
        } else if (group === 'DCV') {
            this._inputValue = solver?.getPD(`${this.id}_wire_v`, `${this.id}_wire_COM`) || 0;
        } else if (group === 'ACV') {
            const diff = solver?.getPD(`${this.id}_wire_v`, `${this.id}_wire_COM`) || 0;
            if (this._acvMax === undefined) this._acvMax = 0;
            if (this._acvTimer === undefined) this._acvTimer = 0;
            this._acvMax = Math.max(this._acvMax, Math.abs(diff));
            this._acvTimer += dt;
            if (this._acvTimer >= 0.01) {
                this._inputValue = this._acvMax / 1.414;
                this._acvMax = 0;
                this._acvTimer = 0;
            }
        } else if (group === 'OHM') {
            const cCOM = solver?.portToCluster?.get(`${this.id}_wire_COM`);
            const cV = solver?.portToCluster?.get(`${this.id}_wire_v`);
            if (cCOM === undefined || cV === undefined) {
                this._inputValue = 1e9;
            } else {
                const V_measured = (solver.getVoltageAtPort(`${this.id}_wire_COM`) || 0)
                                - (solver.getVoltageAtPort(`${this.id}_wire_v`) || 0);
                const R_int = this.getInputImpedance();
                const V_bat = this._range?.multiplier >= 10000 ? 9 : 1.5;
                if (V_measured > 0.001 && V_measured < V_bat - 0.001) {
                    this._inputValue = V_measured * R_int / (V_bat - V_measured);
                } else if (V_measured <= 0.001) {
                    this._inputValue = 0;
                } else {
                    this._inputValue = 1e9;
                }
            }
        }

        /* 计算目标偏转量 */
        const target = this._computeDeflection(this._inputValue);

        /* 二阶弹簧-阻尼（临界阻尼附近，无过冲） */
        const k = 60;
        const b = this._damping * 2 * Math.sqrt(k);
        const err = target - this._deflection;
        const acc = k * err - b * this._velocity;
        this._velocity += acc * dt;
        this._deflection += this._velocity * dt;
        this._deflection = Math.max(-0.02, Math.min(1.02, this._deflection));

        /* 仅当有实质变化时才重绘 */
        const moving = Math.abs(this._velocity) > 1e-4 ||
            Math.abs(this._deflection - target) > 1e-4;
        if (moving) {
            this._updateDynamic();
            this.markDirty();
        }

        this._refreshIfDirty();
    }

    /* ═══════════════════════════════════════════
       物理计算
    ════════════════════════════════════════════ */

    /** 根据档位和输入量计算偏转量 0~1 */
    _computeDeflection(raw) {
        const r = this._range;
        if (!r) return 0;
        let d = 0;
        switch (r.group) {
            case 'DCV':
            case 'ACV':
                d = Math.abs(raw) / r.fullScale;
                break;
            case 'DCmA':
                d = Math.abs(raw) / r.fullScale;
                break;
            case 'OHM': {
                const Rmid = r.multiplier * 20;
                const Rx = Math.max(0, raw);
                d = Rmid / (Rmid + Rx);
                break;
            }
        }
        return Math.max(0, Math.min(1, d));
    }

    /** 构造数字辅助读数字符串 */
    _buildReadout() {
        const raw = this._inputValue;
        const r = this._range;
        const defl = Math.max(0, Math.min(1, this._deflection));
        switch (r.group) {
            case 'DCV':
            case 'ACV':
                return `${Math.abs(raw).toFixed(3)} ${r.unit}`;
            case 'DCmA':
                return `${(Math.abs(raw) * 1000).toFixed(2)} mA`;
            case 'OHM': {
                const Rmid = r.multiplier * 20;
                const Rx = defl > 0.001 ? Rmid * (1 - defl) / defl : Infinity;
                return Rx > 9e5 ? '∞ Ω' : `${Rx.toFixed(1)} Ω`;
            }
        }
        return '';
    }

    /* ═══════════════════════════════════════════
       辅助
    ════════════════════════════════════════════ */

    /** 由偏转量 (0~1) 求指针方向余弦/正弦（Konva 坐标系，Y 向下） */
    _needleCS(defl) {
        const deg = NEEDLE_START + defl * NEEDLE_SPAN;
        const rad = deg * Math.PI / 180;
        return { cos: -Math.cos(rad), sin: -Math.sin(rad) };
    }

    _findRange(id) {
        return RANGES.find(r => r.id === id) ?? RANGES[5];
    }

    _setRange(id) {
        this._rangeId = id;
        this._range = this._findRange(id);
        this.config.rangeId = id;
        this._updateDynamic();
        this.markDirty();
    }

    /* ═══════════════════════════════════════════
       公开 API
    ════════════════════════════════════════════ */

    /** 设置输入量（由仿真平台注入） */
    setInput(value) {
        this._inputValue = value;
        this.config.inputValue = value;
    }

    /** 切换量程 */
    setRange(rangeId) { this._setRange(rangeId); }

    /** 查询表头等效输入阻抗 Ω */
    getInputImpedance() {
        const r = this._range;
        switch (r.group) {
            case 'DCV': return r.fullScale / Ig;
            case 'ACV': return 1e9;
            case 'DCmA': { const Is = r.fullScale - Ig; return (Ig * Rg) / Is; }
            case 'OHM': return r.multiplier * 20;
        }
    }

    /* ═══════════════════════════════════════════
       配置面板接口
    ════════════════════════════════════════════ */

    getConfigFields() {
        return [
            { label: '位号', key: 'label', type: 'text' },
            {
                label: '量程', key: 'rangeId', type: 'select',
                options: RANGES.map(r => ({ value: r.id, label: r.label }))
            },
            { label: '输入值', key: 'inputValue', type: 'number', step: 0.01 },
            { label: '阻尼系数', key: 'damping', type: 'number', min: 0.1, max: 1.5, step: 0.05 },
            { label: '数字读数', key: 'showDigital', type: 'number', min: 0, max: 1 },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label !== undefined) this.label = cfg.label;
        if (cfg.inputValue !== undefined) this._inputValue = parseFloat(cfg.inputValue);
        if (cfg.damping !== undefined) this._damping = parseFloat(cfg.damping);
        if (cfg.showDigital !== undefined) this._showDigital = !!parseInt(cfg.showDigital);

        if (cfg.rangeId !== undefined && cfg.rangeId !== this._rangeId) {
            this._rangeId = cfg.rangeId;
            this._range = this._findRange(this._rangeId);
        }

        this.config = { ...this.config, ...cfg };

        /* 如果尺寸变化，重算几何并重建静态层 */
        if (cfg.width !== undefined || cfg.height !== undefined) {
            this.width = Math.max(220, cfg.width ?? this.width);
            this.height = Math.max(320, cfg.height ?? this.height);
            this._recalcGeometry();
            this._staticGroup.destroyChildren();
            this._drawStaticParts();
            this._staticGroup.cache();
        }

        /* 重建动态节点以反映档位/标签变化 */
        this._dynamicGroup.destroyChildren();
        this._createDynamicNodes();
        this.markDirty();
    }

    destroy() {
        super.destroy?.();
    }
}
