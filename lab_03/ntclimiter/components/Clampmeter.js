import { BaseComponent } from './BaseComponent.js';

/**
 * 钳形电流表仿真组件
 * （Clamp Meter / Clamp Ammeter）
 *
 * ── 工作原理（电流互感器原理）──────────────────────────────────
 *
 *  钳形电流表是一种电磁感应式测量仪器，无需断开被测线路即可测量电流。
 *
 *  1. 结构组成：
 *     - 开合式铁芯（可张开的磁性铁芯钳口）
 *     - 二次线圈（绕在铁芯上，N₂ 匝）
 *     - 测量机构（电流表头）
 *
 *  2. 电流互感器原理：
 *     被测导线相当于一匝一次线圈（N₁=1）：
 *       N₁ × I₁ = N₂ × I₂
 *       I₁ = N₂ × I₂ / N₁ = N₂ × I₂
 *     测量线圈中的感应电流 I₂ 通过电流表显示，
 *     再乘以变流比 N₂ 即得被测电流 I₁。
 *
 *  3. 电磁感应过程：
 *     被测导线电流 I₁ → 在铁芯中产生交变磁通 Φ：
 *       Φ = μ₀ × N₁ × I₁ × A / l_m
 *     二次线圈感应 EMF：
 *       E₂ = N₂ × dΦ/dt = N₂ × ω × Φ_m × cos(ωt)
 *     二次电流：
 *       I₂ = E₂ / (R₂ + Z_meter)
 *     显示值：
 *       I₁_measured = I₂ × N₂（近似，忽略励磁电流误差）
 *
 *  4. 误差来源：
 *     ① 励磁误差：铁芯励磁电流不为零（约0.5~2%）
 *     ② 磁路气隙误差：钳口闭合不紧密导致气隙增大→磁阻增大→误差↑
 *     ③ 频率误差：标准校准频率50/60Hz
 *     ④ 外磁场干扰：相邻载流导线产生的磁场
 *
 *  5. 测量注意事项：
 *     - 钳口必须完全闭合，否则误差极大
 *     - 被测导线置于铁芯中央，减少偏心误差
 *     - 每次只套入单根导线（三相可分相测量）
 *     - 不可测量直流（需使用霍尔钳形表）
 *
 * ── 仿真特性 ──────────────────────────────────────────────────
 *  ① 钳口可操作（点击/拖拽触发扳手打开/闭合）
 *  ② 可将线路导线放入钳口（拖拽或点击套入）
 *  ③ 磁场线可视化（铁芯内磁通流动动画）
 *  ④ 指针式表头 + 数字显示（双重）
 *  ⑤ 量程切换（10/50/100/500A）
 *  ⑥ 气隙误差模拟（钳口未完全闭合时误差增大）
 *  ⑦ 多路线路（可切换测量不同相电流）
 *  ⑧ 波形显示（感应电流实时波形）
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  wire_com  — COM 端（公共）
 *  wire_v    — 电压测量端（兼用）
 *  pipe_line — 被测线路穿入点（模拟导线套入钳口）
 */
export class ClampMeter extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(260, config.width  || 300);
        this.height = Math.max(480, config.height || 560);

        this.type    = 'clamp_meter';
        this.special = 'none';
        this.cache   = 'fixed';

        // ── 量程 ──
        this.ranges     = [10, 50, 100, 500];   // A
        this.rangeIdx   = config.rangeIdx ?? 1;  // 默认50A量程
        this.Irange     = this.ranges[this.rangeIdx];
        this.N2         = config.N2 || 2000;     // 二次线圈匝数

        // ── 被测线路参数 ──
        this.lineFreq   = config.lineFreq   || 50;   // Hz
        this.lineVoltage= config.lineVoltage|| 380;  // V（三相）
        this.phases = [
            { label: 'A相', I: config.IA ?? 30, color: '#ef5350' },
            { label: 'B相', I: config.IB ?? 28, color: '#66bb6a' },
            { label: 'C相', I: config.IC ?? 25, color: '#42a5f5' },
        ];
        this.selectedPhase = config.selectedPhase ?? 0;  // 当前测量哪根导线

        // ── 状态 ──
        this.jawOpen     = false;   // 钳口是否打开
        this._jawAngle   = 0;       // 钳口开合角度（0=完全闭合，1=完全打开）
        this._jawTarget  = 0;       // 目标角度
        this.wireInJaw   = false;   // 导线是否在钳口内
        this.measuredI   = 0;       // 当前测量电流 A（有效值）
        this._measSmooth = 0;       // 平滑显示值
        this.gapError    = 1.0;     // 气隙误差系数（1.0=无误差，<1=有误差）

        // ── 指针状态 ──
        this._needleAngle = 0;      // 指针当前角度（0~1，0=左端，1=满偏）
        this._needleVel   = 0;
        this._needleK     = 30;
        this._needleDamp  = 10;

        // ── 动画 ──
        this._phase       = 0;
        this._fluxPhase   = 0;
        this._wavePhase   = 0;

        // ── 波形缓冲 ──
        this._wavLen  = 200;
        this._wavI    = new Float32Array(this._wavLen).fill(0);
        this._wavAcc  = 0;

        // ── 几何布局 ──
        const margin = 12;

        // 仪表主体（下部，表盘/显示/按键）
        this._bodyX    = margin;
        this._bodyY    = Math.round(this.height * 0.38);
        this._bodyW    = this.width - margin * 2;
        this._bodyH    = this.height - this._bodyY - margin;

        // 钳头部分（上部，铁芯钳口）
        this._headX    = margin + Math.round(this._bodyW * 0.12);
        this._headY    = margin;
        this._headW    = this._bodyW - Math.round(this._bodyW * 0.24);
        this._headH    = this._bodyY - margin - 4;

        // 铁芯钳口圆形（中心）
        this._jawCX    = this._headX + this._headW / 2;
        this._jawCY    = Math.round(this.height * 0.22);
        this._jawR     = Math.round(Math.min(this._headW, this._headH) * 0.38);
        this._coreW    = Math.round(this._jawR * 0.45);  // 铁芯截面宽度

        // 表盘区（仪表体上半）
        this._meterCX  = margin + this._bodyW / 2;
        this._meterCY  = this._bodyY + Math.round(this._bodyH * 0.32);
        this._meterR   = Math.round(Math.min(this._bodyW * 0.40, this._bodyH * 0.28));

        // 数字显示区
        this._dispX    = margin + 6;
        this._dispY    = this._meterCY + this._meterR + 10;
        this._dispW    = this._bodyW - 12;
        this._dispH    = 36;

        // 控制面板（底部）
        this._ctrlX    = margin + 4;
        this._ctrlY    = this._dispY + this._dispH + 8;
        this._ctrlW    = this._bodyW - 8;
        this._ctrlH    = this.height - this._ctrlY - margin - 8;

        // 波形区（底部）
        this._wavX     = this._ctrlX;
        this._wavY     = this._ctrlY + Math.round(this._ctrlH * 0.50);
        this._wavW     = this._ctrlW;
        this._wavH     = this._ctrlH - Math.round(this._ctrlH * 0.50);

        this._lastTs   = null;
        this._animId   = null;
        this.knobs     = {};

        this.config = {
            id: this.id, rangeIdx: this.rangeIdx,
            selectedPhase: this.selectedPhase,
        };

        this._init();

        const cx2 = this.width / 2;
        this.addPort(this._bodyX + this._bodyW * 0.28, this.height - margin, 'com',  'wire', 'COM');
        this.addPort(this._bodyX + this._bodyW * 0.72, this.height - margin, 'v',    'wire', 'V/Ω');
        this.addPort(this._jawCX, margin, 'line', 'pipe', '线路');
    }

    // ═══════════════════════════════════════════
    _init() {
        this._drawLabel();
        this._drawBody();
        this._drawJawBase();
        this._drawJawMoving();
        this._drawCoreDetail();
        this._drawFluxLayer();
        this._drawWireInJaw();
        this._drawMeterFace();
        this._drawNeedle();
        this._drawDigitalDisplay();
        this._drawControlPanel();
        this._drawWaveform();
        this._drawJawTrigger();
        this._startAnimation();
    }

    _drawLabel() {
        this.group.add(new Konva.Text({
            x: 0, y: -22, width: this.width,
            text: '钳形电流表（Clamp Meter）— 点击扳机开合钳口',
            fontSize: 12, fontStyle: 'bold', fill: '#1a2634', align: 'center',
        }));
    }

    // ── 仪表主体外壳 ─────────────────────────
    _drawBody() {
        const { _bodyX: bx, _bodyY: by, _bodyW: bw, _bodyH: bh } = this;

        // 外壳主色（深灰/黑色工业外观）
        const body = new Konva.Rect({ x: bx, y: by, width: bw, height: bh, fill: '#1c2027', stroke: '#0a0d12', strokeWidth: 2, cornerRadius: [4,4,8,8] });
        // 侧面纹理（防滑纹）
        for (let i = 6; i < bh-4; i += 5) {
            this.group.add(new Konva.Line({ points: [bx+1, by+i, bx+5, by+i], stroke: '#2a3040', strokeWidth: 2.5, opacity: 0.6 }));
            this.group.add(new Konva.Line({ points: [bx+bw-1, by+i, bx+bw-5, by+i], stroke: '#2a3040', strokeWidth: 2.5, opacity: 0.6 }));
        }
        // 正面深色区（LCD + 按键区）
        const face = new Konva.Rect({ x: bx+6, y: by+6, width: bw-12, height: bh-12, fill: '#141820', stroke: '#0d1018', strokeWidth: 0.5, cornerRadius: 4 });
        // 顶部连接处（钳头颈部）
        const neck = new Konva.Rect({ x: bx + bw*0.15, y: by-20, width: bw*0.70, height: 24, fill: '#1c2027', stroke: '#0a0d12', strokeWidth: 1.5, cornerRadius: [3,3,0,0] });

        // 端子（底部）
        [0.28, 0.72].forEach((xRatio, i) => {
            const tx = bx + bw * xRatio;
            const ty = by + bh - 18;
            this.group.add(new Konva.Rect({ x: tx-8, y: ty, width: 16, height: 18, fill: i===0?'#1a1a1a':'#c8a000', stroke: '#0a0a0a', strokeWidth: 1, cornerRadius: [1,1,0,0] }));
            this.group.add(new Konva.Circle({ x: tx, y: ty+8, radius: 5, fill: '#2a2a2a', stroke: '#555', strokeWidth: 1 }));
            this.group.add(new Konva.Text({ x: tx-12, y: by+bh-10, width: 24, text: i===0?'COM':'V/Ω', fontSize: 7.5, fill: i===0?'#666':'#c8a000', align: 'center' }));
        });

        this.group.add(neck, body, face);
    }

    // ── 铁芯钳口（固定部分 - 下半环）────────
    _drawJawBase() {
        const cx = this._jawCX, cy = this._jawCY, R = this._jawR, cw = this._coreW;

        // 铁芯固定下半环（C形，从底部到侧面）
        // 铁芯横截面：方形，带叠片纹理
        // 下半部铁芯（固定）：从 270°（正下）到 90°（正上，左侧）约 270° 弧度
        const startAngle = 90;    // 从右上开始（gap 在右上方）
        const endAngle   = 270;   // 到右下结束

        // 铁芯外环（深灰，叠片铁）
        this._coreFixed = new Konva.Arc({ x: cx, y: cy, innerRadius: R - cw, outerRadius: R, angle: 180, rotation: startAngle-90, fill: '#2a3040', stroke: '#1a2030', strokeWidth: 1.5 });
        // 铁芯内高光
        this.group.add(new Konva.Arc({ x: cx, y: cy, innerRadius: R-cw+2, outerRadius: R-cw+6, angle: 178, rotation: startAngle-90, fill: 'rgba(100,150,200,0.08)' }));

        // 铁芯叠片纹
        for (let i = 0; i < 18; i++) {
            const a = ((startAngle + i * 10) - 90) * Math.PI / 180;
            const r1 = R-cw, r2 = R;
            this.group.add(new Konva.Line({
                points: [cx+r1*Math.cos(a), cy+r1*Math.sin(a), cx+r2*Math.cos(a), cy+r2*Math.sin(a)],
                stroke: 'rgba(0,0,0,0.25)', strokeWidth: 0.8,
            }));
        }

        // 下半环端面（两端截面）
        [[startAngle-90, 'left'], [(startAngle+180)-90, 'right']].forEach(([a_deg, side]) => {
            const a = a_deg * Math.PI / 180;
            const fx = cx + (R-cw/2) * Math.cos(a);
            const fy = cy + (R-cw/2) * Math.sin(a);
            this.group.add(new Konva.Circle({ x: fx, y: fy, radius: cw/2+1, fill: '#3a4a60', stroke: '#1a2030', strokeWidth: 1 }));
        });

        this.group.add(this._coreFixed);
    }

    // ── 活动上半钳口（可开合）────────────────
    _drawJawMoving() {
        const cx = this._jawCX, cy = this._jawCY, R = this._jawR, cw = this._coreW;

        this._jawGroup = new Konva.Group({ x: cx, y: cy });

        // 上半铁芯弧（固定于 jawGroup，随旋转打开）
        const upperCore = new Konva.Arc({ innerRadius: R-cw, outerRadius: R, angle: 180, rotation: 90-90, fill: '#2a3040', stroke: '#1a2030', strokeWidth: 1.5 });

        // 上半叠片纹
        for (let i = 0; i < 18; i++) {
            const a = ((90 + i * 10) - 90) * Math.PI / 180;  // 从90°到270°
            const r1 = R-cw, r2 = R;
            this._jawGroup.add(new Konva.Line({
                points: [r1*Math.cos(a), r1*Math.sin(a), r2*Math.cos(a), r2*Math.sin(a)],
                stroke: 'rgba(0,0,0,0.25)', strokeWidth: 0.8,
            }));
        }

        // 上半截面（端面）
        for (let i = 0; i < 2; i++) {
            const a = ((90 + i * 180) - 90) * Math.PI / 180;
            const fx = (R-cw/2)*Math.cos(a), fy = (R-cw/2)*Math.sin(a);
            this._jawGroup.add(new Konva.Circle({ x: fx, y: fy, radius: cw/2+1, fill: '#3a4a60', stroke: '#1a2030', strokeWidth: 1 }));
        }

        // 铰接轴（左侧固定点）
        this._jawGroup.add(new Konva.Circle({ x: -R, y: 0, radius: 5, fill: '#c8a000', stroke: '#8a7000', strokeWidth: 1.5 }));

        this._jawGroup.add(upperCore);
        this.group.add(this._jawGroup);
    }

    // ── 铁芯细节（绕组+连接到仪表体）───────
    _drawCoreDetail() {
        const cx = this._jawCX, cy = this._jawCY, R = this._jawR, cw = this._coreW;

        // 二次线圈（绕在铁芯上，右侧可见几匝）
        const coilX = cx + R - cw*0.5, coilY = cy;
        const coilR = cw * 0.35;
        for (let i = 0; i < 4; i++) {
            const cy3 = coilY + (i-1.5) * coilR * 2.2;
            this.group.add(new Konva.Ellipse({ x: coilX, y: cy3, radiusX: 4, radiusY: coilR, fill: 'none', stroke: '#c0a020', strokeWidth: 2, opacity: 0.7 }));
        }
        this.group.add(new Konva.Text({ x: coilX-12, y: cy + R*0.55, width: 24, text: `N₂\n${this.N2}匝`, fontSize: 7, fill: '#c0a020', align: 'center', lineHeight: 1.3 }));

        // 铁芯连接到仪表体的导管
        const neckX = this._bodyX + this._bodyW * 0.15, neckY = this._bodyY - 20;
        const neckW = this._bodyW * 0.70;
        this.group.add(new Konva.Line({
            points: [cx - R + cw*0.5, cy, neckX, neckY+24, neckX+neckW*0.15, neckY+24],
            stroke: '#2a3040', strokeWidth: cw*0.8, lineCap: 'round', lineJoin: 'round',
        }));
        this.group.add(new Konva.Line({
            points: [cx + R - cw*0.5, cy, neckX+neckW, neckY+24, neckX+neckW*0.85, neckY+24],
            stroke: '#2a3040', strokeWidth: cw*0.8, lineCap: 'round', lineJoin: 'round',
        }));

        // 互感器比例标注
        this.group.add(new Konva.Text({ x: cx-30, y: cy+R+8, width: 60, text: `1:${this.N2}\n互感器`, fontSize: 7.5, fill: '#4a6a8a', align: 'center', lineHeight: 1.3 }));
    }

    // ── 磁通可视化层 ─────────────────────────
    _drawFluxLayer() {
        this._fluxGroup = new Konva.Group();
        this.group.add(this._fluxGroup);
    }

    // ── 被测导线（钳口内）────────────────────
    _drawWireInJaw() {
        const cx = this._jawCX, cy = this._jawCY;

        // 导线（仅钳口完全闭合且 wireInJaw=true 时显示）
        this._wireGroup = new Konva.Group({ x: cx, y: cy });

        // 导线截面（圆形，黄色铜导体）
        this._wireCross  = new Konva.Circle({ radius: 4.5, fill: '#c8a000', stroke: '#8a7000', strokeWidth: 1, visible: false });
        // 导线绝缘层
        this._wireInsul  = new Konva.Circle({ radius: 7.5, fill: 'none', stroke: '#c84040', strokeWidth: 2, visible: false });
        // 导线延伸线（上下穿过钳口）
        this._wireLineUp  = new Konva.Line({ points: [0, -this._jawR*0.5, 0, -18], stroke: '#c84040', strokeWidth: 5, visible: false, lineCap: 'round' });
        this._wireLineDown= new Konva.Line({ points: [0, this._jawR*0.5, 0, 18], stroke: '#c84040', strokeWidth: 5, visible: false, lineCap: 'round' });

        // 电流方向符号（·/×）
        this._currentSymbol = new Konva.Text({ x: -5, y: -7, text: '·', fontSize: 14, fontStyle: 'bold', fill: '#ffd54f', visible: false });

        this._wireGroup.add(this._wireLineUp, this._wireLineDown, this._wireInsul, this._wireCross, this._currentSymbol);
        this.group.add(this._wireGroup);

        // 导线标注（相位）
        this._wireLabel = new Konva.Text({ x: cx+12, y: cy-8, text: '', fontSize: 8.5, fontStyle: 'bold', fill: '#ef9a9a', visible: false });
        this.group.add(this._wireLabel);
    }

    // ── 指针式表盘 ───────────────────────────
    _drawMeterFace() {
        const cx = this._meterCX, cy = this._meterCY, R = this._meterR;

        // 表盘背景
        this.group.add(new Konva.Circle({ x: cx, y: cy, radius: R+4, fill: '#1a2030', stroke: '#0d1020', strokeWidth: 1.5 }));
        const face = new Konva.Circle({ x: cx, y: cy, radius: R, fill: '#e8ddb8' });
        this.group.add(face);

        // 刻度弧范围：-60°~+60°（相对于正上方）
        this._arcStartDeg = 210;  // 左端（0A）
        this._arcEndDeg   = 330;  // 右端（满量程）
        this._arcSpanDeg  = this._arcEndDeg - this._arcStartDeg;

        // 刻度线
        const nMaj = 10, nMin = 50;
        for (let i = 0; i <= nMin; i++) {
            const ratio = i / nMin;
            const deg   = this._arcStartDeg + ratio * this._arcSpanDeg;
            const rad   = (deg - 90) * Math.PI / 180;
            const isMaj = (i % (nMin/nMaj) === 0);
            const r1    = R*0.82, r2 = isMaj ? R*0.94 : R*0.89;
            this.group.add(new Konva.Line({
                points: [cx+r1*Math.cos(rad), cy+r1*Math.sin(rad), cx+r2*Math.cos(rad), cy+r2*Math.sin(rad)],
                stroke: '#3a2000', strokeWidth: isMaj ? 1.5 : 0.7,
            }));
            if (isMaj) {
                const lr = R * 0.99;
                const ratio_v = i / nMin;
                const label = Math.round(ratio_v * this.Irange);
                this._iRangeLabels = this._iRangeLabels || [];
                const lbl = new Konva.Text({ x: cx+lr*Math.cos(rad)-10, y: cy+lr*Math.sin(rad)-5, width: 20, text: label+'', fontSize: 8, fontStyle: 'bold', fill: '#3a2000', align: 'center' });
                this._iRangeLabels.push(lbl);
                this.group.add(lbl);
            }
        }

        // 单位标注
        this._rangeUnitText = new Konva.Text({ x: cx-20, y: cy-R*0.55, width: 40, text: 'A', fontSize: 12, fontStyle: 'bold', fill: '#5a3000', align: 'center' });
        this._rangeIText    = new Konva.Text({ x: cx-20, y: cy-R*0.38, width: 40, text: `${this.Irange}A`, fontSize: 9, fill: '#c05a00', align: 'center' });

        // 表盘玻璃反光
        this.group.add(new Konva.Ellipse({ x: cx-R*0.2, y: cy-R*0.3, radiusX: R*0.22, radiusY: R*0.10, fill: 'rgba(255,255,255,0.28)' }));

        this.group.add(this._rangeUnitText, this._rangeIText);
    }

    // ── 指针 ─────────────────────────────────
    _drawNeedle() {
        const cx = this._meterCX, cy = this._meterCY, R = this._meterR;

        this._needleGroup = new Konva.Group({ x: cx, y: cy });
        this._needleGroup.add(new Konva.Circle({ radius: R*0.07, fill: '#1a1000', stroke: '#0a0500', strokeWidth: 1 }));
        this._needleGroup.add(new Konva.Line({ points: [0,0,-R*0.75,0], stroke: '#0a0500', strokeWidth: 1.5, lineCap: 'round' }));
        this._needleGroup.add(new Konva.Line({ points: [0,0,R*0.15,0], stroke: '#c8a000', strokeWidth: 3, lineCap: 'round' }));
        this._needleGroup.add(new Konva.Circle({ radius: R*0.04, fill: '#c05a00', stroke: '#8a3a00', strokeWidth: 0.8 }));
        this.group.add(this._needleGroup);
    }

    // ── 数字显示区 ───────────────────────────
    _drawDigitalDisplay() {
        const dx = this._dispX, dy = this._dispY, dw = this._dispW, dh = this._dispH;

        const bg = new Konva.Rect({ x: dx, y: dy, width: dw, height: dh, fill: '#0a1a08', stroke: '#1a3010', strokeWidth: 1, cornerRadius: 3 });
        this._dispI   = new Konva.Text({ x: dx+4, y: dy+4, width: dw-40, text: '---', fontSize: 18, fontFamily: 'Courier New, monospace', fontStyle: 'bold', fill: '#33ff66', align: 'right' });
        this._dispUnit= new Konva.Text({ x: dx+dw-38, y: dy+8, width: 34, text: 'A', fontSize: 13, fontFamily: 'Courier New, monospace', fill: '#33cc55' });
        this._dispFreq= new Konva.Text({ x: dx+4, y: dy+dh-12, width: dw/2, text: `${this.lineFreq}Hz`, fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#226611', align: 'left' });
        this._dispPhase= new Konva.Text({ x: dx+dw/2, y: dy+dh-12, width: dw/2, text: this.phases[this.selectedPhase].label, fontSize: 8, fontFamily: 'Courier New, monospace', fill: this.phases[this.selectedPhase].color, align: 'right' });
        this.group.add(bg, this._dispI, this._dispUnit, this._dispFreq, this._dispPhase);
    }

    // ── 控制面板 ─────────────────────────────
    _drawControlPanel() {
        const px = this._ctrlX, py = this._ctrlY, pw = this._ctrlW, ch = Math.round(this._ctrlH * 0.45);

        const bg = new Konva.Rect({ x: px, y: py, width: pw, height: ch, fill: '#0d1018', stroke: '#1a2030', strokeWidth: 1, cornerRadius: 4 });
        this.group.add(new Konva.Text({ x: px+4, y: py+2, width: pw-8, text: '量程  /  测量相', fontSize: 8, fill: '#4a6a8a', align: 'center' }));

        // 量程按钮
        const rBtnW = (pw-10) / this.ranges.length;
        this._rangeBtns = [];
        this.ranges.forEach((r, i) => {
            const bx = px+5+i*(rBtnW+2), by = py+14;
            const isAct = i === this.rangeIdx;
            const btn = new Konva.Rect({ x: bx, y: by, width: rBtnW, height: 14, fill: isAct?'#1a3a20':'#0d1820', stroke: isAct?'#33cc55':'#1a2030', strokeWidth: 1, cornerRadius: 2 });
            const lbl = new Konva.Text({ x: bx, y: by+3, width: rBtnW, text: r+'A', fontSize: 8, fill: isAct?'#33cc55':'#4a5a6a', align: 'center' });
            btn.on('click tap', () => {
                this.rangeIdx = i; this.Irange = r;
                this._updateRangeDisplay();
                this._rangeBtns.forEach((b, j) => {
                    b.btn.fill(j===i?'#1a3a20':'#0d1820');
                    b.btn.stroke(j===i?'#33cc55':'#1a2030');
                    b.lbl.fill(j===i?'#33cc55':'#4a5a6a');
                });
            });
            this._rangeBtns.push({ btn, lbl });
            this.group.add(btn, lbl);
        });

        // 相序选择
        const pBtnW = (pw-10) / 3;
        this._phaseBtns = [];
        this.phases.forEach((ph, i) => {
            const bx = px+5+i*(pBtnW+2), by = py+32;
            const isAct = i === this.selectedPhase;
            const btn = new Konva.Rect({ x: bx, y: by, width: pBtnW, height: 14, fill: isAct?'#1a1a08':'#0d1018', stroke: isAct?ph.color:'#1a2030', strokeWidth: 1, cornerRadius: 2 });
            const lbl = new Konva.Text({ x: bx, y: by+3, width: pBtnW, text: ph.label, fontSize: 8, fill: isAct?ph.color:'#4a5a6a', align: 'center' });
            btn.on('click tap', () => {
                this.selectedPhase = i;
                this._phaseBtns.forEach((b, j) => {
                    const pjAct = j===i;
                    b.btn.fill(pjAct?'#1a1a08':'#0d1018');
                    b.btn.stroke(pjAct?this.phases[j].color:'#1a2030');
                    b.lbl.fill(pjAct?this.phases[j].color:'#4a5a6a');
                });
                if (this._dispPhase) {
                    this._dispPhase.text(this.phases[i].label);
                    this._dispPhase.fill(ph.color);
                }
            });
            this._phaseBtns.push({ btn, lbl });
            this.group.add(btn, lbl);
        });

        this.group.add(bg);

        // 导线电流调节（被测电流设定）
        const adjY = py + ch + 4;
        const adjH = Math.round(this._ctrlH * 0.48) - ch - 8;
        if (adjH < 12) return;
        const adjBg = new Konva.Rect({ x: px, y: adjY, width: pw, height: adjH, fill: '#0d1018', stroke: '#1a2030', strokeWidth: 1, cornerRadius: 4 });
        this.group.add(new Konva.Text({ x: px+4, y: adjY+2, width: pw-8, text: '各相电流调节', fontSize: 8, fill: '#4a6a8a', align: 'center' }));

        this.phases.forEach((ph, i) => {
            const barY = adjY + 14 + i * Math.round((adjH-14)/3);
            const barW = pw - 50;
            this.group.add(new Konva.Text({ x: px+4, y: barY+2, text: ph.label, fontSize: 7.5, fill: ph.color }));
            this.group.add(new Konva.Rect({ x: px+26, y: barY+2, width: barW, height: 8, fill: '#0a0a10', cornerRadius: 2 }));
            const bar = new Konva.Rect({ x: px+26, y: barY+2, width: (ph.I/500)*barW, height: 8, fill: ph.color, cornerRadius: 2, opacity: 0.7 });
            this._phBarRefs = this._phBarRefs || [];
            this._phBarRefs.push({ bar, barX: px+26, barW });
            const valTxt = new Konva.Text({ x: px+26+barW+2, y: barY+2, width: 20, text: ph.I+'', fontSize: 7.5, fontFamily: 'Courier New, monospace', fill: ph.color });
            this._phValTexts = this._phValTexts || [];
            this._phValTexts.push(valTxt);

            // 拖拽调节
            const hitBar = new Konva.Rect({ x: px+26, y: barY-2, width: barW, height: 14, fill: 'transparent', listening: true });
            const phIdx = i;
            hitBar.on('mousedown touchstart click tap', e => {
                const stage = this.group.getStage?.();
                const pos = stage?.getPointerPosition?.() ?? { x: e.evt?.clientX ?? 0 };
                const relX = pos.x - (this.group.x?.()??0) - (px+26);
                const ratio = Math.max(0, Math.min(1, relX/barW));
                this.phases[phIdx].I = Math.round(ratio * 500);
            });
            this.group.add(adjBg, bar, hitBar, valTxt);
        });
    }

    // ── 波形区 ───────────────────────────────
    _drawWaveform() {
        const { _wavX: wx, _wavY: wy, _wavW: ww, _wavH: wh } = this;
        if (wh < 14) return;

        const bg = new Konva.Rect({ x: wx, y: wy, width: ww, height: wh, fill: '#020810', stroke: '#1a2030', strokeWidth: 1, cornerRadius: 4 });
        const titleBg = new Konva.Rect({ x: wx, y: wy, width: ww, height: 12, fill: '#0a1018', cornerRadius: [4,4,0,0] });
        this.group.add(new Konva.Text({ x: wx+4, y: wy+1, width: ww-8, text: 'i(t) 感应电流波形', fontSize: 8, fill: '#33cc55', align: 'center' }));

        const midY = wy + wh/2;
        this.group.add(new Konva.Line({ points: [wx+2, midY, wx+ww-2, midY], stroke: 'rgba(100,200,100,0.15)', strokeWidth: 0.5 }));
        this._wLineI = new Konva.Line({ points: [], stroke: '#33ff66', strokeWidth: 1.5, lineJoin: 'round' });

        this._wavMidY = midY;
        this.group.add(bg, titleBg, this._wLineI);
    }

    // ── 扳机（触发钳口开合）──────────────────
    _drawJawTrigger() {
        const cx = this._jawCX, cy = this._jawCY;
        const R  = this._jawR;

        // 扳机（右侧，桔色按钮）
        const trigX = cx + R + 12, trigY = cy - 14;
        this._trigBtn = new Konva.Rect({ x: trigX, y: trigY, width: 22, height: 28, fill: '#e8740a', stroke: '#c05a00', strokeWidth: 1.5, cornerRadius: [2,2,4,4] });
        this._trigGroup = new Konva.Group({ x: trigX + 11, y: trigY + 14 });
        this._trigGroup.add(new Konva.Rect({ x: -9, y: -12, width: 18, height: 24, fill: 'transparent' }));
        this._trigArrow = new Konva.Line({ points: [0,-4,0,4], stroke: '#f5f0e8', strokeWidth: 2, lineCap: 'round' });
        this._trigGroup.add(this._trigArrow);
        this.group.add(new Konva.Text({ x: trigX-4, y: trigY+30, width: 30, text: '扳机', fontSize: 7.5, fill: '#c05a00' }));

        // 点击事件
        this._trigBtn.on('click tap', () => this._toggleJaw());
        this._trigBtn.on('mouseenter', () => this._trigBtn.fill('#ffa040'));
        this._trigBtn.on('mouseleave', () => this._trigBtn.fill('#e8740a'));
        this.group.add(this._trigBtn, this._trigGroup);

        // 钳口区域也可点击（套入/取出导线）
        const jawHit = new Konva.Circle({ x: cx, y: cy, radius: R*0.55, fill: 'transparent', listening: true });
        jawHit.on('click tap', () => {
            if (!this.jawOpen) return;
            this.wireInJaw = !this.wireInJaw;
            this._refreshCache();
        });
        this.group.add(jawHit);
    }

    _toggleJaw() {
        this.jawOpen   = !this.jawOpen;
        this._jawTarget = this.jawOpen ? 1 : 0;
        if (!this.jawOpen) this.wireInJaw = false;
        this._refreshCache();
    }

    _updateRangeDisplay() {
        if (this._rangeIText) this._rangeIText.text(`${this.Irange}A`);
    }

    // ═══════════════════════════════════════════
    _startAnimation() {
        const tick = ts => {
            if (this._lastTs !== null) {
                const dt = Math.min((ts - this._lastTs) / 1000, 0.05);
                this._tickJaw(dt);
                this._tickMeasurement(dt);
                this._tickNeedle(dt);
                this._tickFlux(dt);
                this._tickWaveform(dt);
                this._tickDisplay();
            }
            this._lastTs = ts;
            this._refreshCache();
            this._animId = requestAnimationFrame(tick);
        };
        this._animId = requestAnimationFrame(tick);
    }

    _stopAnimation() { if (this._animId) { cancelAnimationFrame(this._animId); this._animId = null; } }

    // ── 钳口开合动画 ─────────────────────────
    _tickJaw(dt) {
        // 平滑过渡
        this._jawAngle += (this._jawTarget - this._jawAngle) * Math.min(1, dt * 12);

        // 旋转上半钳口（绕左端铰接点旋转）
        if (this._jawGroup) {
            // 铰接点在 cx - R 处（相对 cx,cy 坐标系为 -R, 0）
            // 旋转角度：0=闭合，最大约 -35°（向上打开）
            const maxOpenDeg = -38;
            const openDeg = this._jawAngle * maxOpenDeg;
            // 绕 (-_jawR, 0) 旋转
            const cx = this._jawCX, cy = this._jawCY, R = this._jawR;
            const pivotX = cx - R, pivotY = cy;
            const rad = openDeg * Math.PI / 180;
            this._jawGroup.x(pivotX + (cx - pivotX)*Math.cos(rad) - (cy - pivotY)*Math.sin(rad));
            this._jawGroup.y(pivotY + (cx - pivotX)*Math.sin(rad) + (cy - pivotY)*Math.cos(rad));
            this._jawGroup.rotation(openDeg);
        }

        // 气隙误差：开口越大，误差越大
        this.gapError = Math.max(0.01, 1 - this._jawAngle * 0.99);

        // 导线可见性
        const wireVisible = this.wireInJaw && this._jawAngle < 0.1;
        [this._wireCross, this._wireInsul, this._wireLineUp, this._wireLineDown, this._currentSymbol].forEach(e => {
            if (e) e.visible(wireVisible);
        });
        if (this._wireLabel) {
            this._wireLabel.visible(wireVisible);
            const ph = this.phases[this.selectedPhase];
            this._wireLabel.text(ph.label + ' ' + ph.I + 'A');
            this._wireLabel.fill(ph.color);
        }
    }

    // ── 测量计算 ─────────────────────────────
    _tickMeasurement(dt) {
        const ph = this.phases[this.selectedPhase];
        const I_true = ph.I;  // 被测导线真实电流 A（有效值）

        if (this.wireInJaw && this._jawAngle < 0.05) {
            // 导线在钳口内且完全闭合
            const measuredI = I_true * this.gapError;
            this._measSmooth += (measuredI - this._measSmooth) * Math.min(1, dt * 6);
            this.measuredI = this._measSmooth;
        } else if (this.wireInJaw && this._jawAngle > 0.0) {
            // 钳口开着，无法准确测量
            this.measuredI = 0;
            this._measSmooth = 0;
        } else {
            // 无导线
            this.measuredI = 0;
            this._measSmooth += (0 - this._measSmooth) * Math.min(1, dt * 4);
        }

        // 指针目标
        this._needleTarget = Math.min(1, this.measuredI / this.Irange);

        // 波形（实时 i(t)）
        const omega = 2 * Math.PI * this.lineFreq;
        this._wavePhase += omega * dt;
        this._phase     += dt * 3;
        this._fluxPhase += dt * (2 * Math.PI * this.lineFreq) * 2;

        // 相位电流瞬时值
        const I_peak = I_true * Math.sqrt(2);
        this._iInst = this.wireInJaw ? I_peak * Math.sin(this._wavePhase) * this.gapError : 0;
    }

    // ── 指针阻尼弹簧 ─────────────────────────
    _tickNeedle(dt) {
        const spring = this._needleK * (this._needleTarget - this._needleAngle);
        const damping= this._needleDamp * this._needleVel;
        const acc    = (spring - damping) / 0.5;
        this._needleVel  += acc * dt;
        this._needleAngle+= this._needleVel * dt;
        this._needleAngle = Math.max(0, Math.min(1.02, this._needleAngle));

        if (this._needleGroup) {
            const deg = this._arcStartDeg + this._needleAngle * this._arcSpanDeg;
            this._needleGroup.rotation(deg - 90);
        }
    }

    // ── 磁通可视化 ───────────────────────────
    _tickFlux(dt) {
        this._fluxGroup.destroyChildren();

        if (!this.wireInJaw || this._jawAngle > 0.1 || this.measuredI < 0.5) return;

        const cx = this._jawCX, cy = this._jawCY, R = this._jawR, cw = this._coreW;
        const nParticles = 6;
        const ph = this.phases[this.selectedPhase];
        const fluxCol = ph.color;

        // 铁芯内磁通粒子（沿铁芯中线圆弧流动）
        for (let i = 0; i < nParticles; i++) {
            const t = ((this._fluxPhase * 0.08 + i / nParticles) % 1 + 1) % 1;
            // 铁芯中线半径
            const midR = R - cw / 2;
            const deg  = 90 + t * 360;  // 顺时针（当电流为正时）
            const rad  = (deg - 90) * Math.PI / 180;
            const pAlpha = 0.4 + 0.4 * Math.abs(Math.sin(this._fluxPhase + i));
            this._fluxGroup.add(new Konva.Circle({
                x: cx + midR * Math.cos(rad), y: cy + midR * Math.sin(rad),
                radius: 3.5, fill: fluxCol, opacity: pAlpha * Math.min(1, this.measuredI / 10),
            }));
        }

        // 磁力线方向箭头（铁芯中轴上）
        const midR = R - cw/2;
        const arrowAngle = (90 + this._fluxPhase * 0.08 * 360) % 360;
        const arRad = (arrowAngle - 90) * Math.PI / 180;
        const ax  = cx + midR * Math.cos(arRad), ay  = cy + midR * Math.sin(arRad);
        const ta  = arRad + Math.PI/2;  // 切线方向
        const arrowAlpha = Math.min(0.7, this.measuredI / this.Irange * 0.7);
        this._fluxGroup.add(new Konva.Arrow({ points: [ax, ay, ax + 10*Math.cos(ta), ay + 10*Math.sin(ta)], stroke: `rgba(255,213,79,${arrowAlpha})`, fill: `rgba(255,213,79,${arrowAlpha})`, strokeWidth: 1.5, pointerLength: 4, pointerWidth: 4 }));

        // 导线电流符号（·/×交替）
        if (this._currentSymbol) {
            const sym = this._iInst >= 0 ? '·' : '×';
            this._currentSymbol.text(sym);
            this._currentSymbol.fill(ph.color);
        }
    }

    // ── 波形 ─────────────────────────────────
    _tickWaveform(dt) {
        if (!this._wLineI) return;
        this._wavAcc += 1.4 * dt * this._wavLen;
        const steps = Math.floor(this._wavAcc); this._wavAcc -= steps;
        for (let i = 0; i < steps; i++) {
            this._wavI = new Float32Array([...this._wavI.slice(1), this._iInst]);
        }

        const wx = this._wavX+2, ww = this._wavW-4, n = this._wavLen, dx = ww/n;
        const iMax = Math.max(1, this.Irange * Math.sqrt(2));
        const amp  = (this._wavH - 14) / 2 * 0.85;
        const pts  = [];
        for (let i = 0; i < n; i++) {
            pts.push(wx+i*dx, this._wavMidY-(this._wavI[i]/iMax)*amp);
        }
        this._wLineI.points(pts);
    }

    // ── 显示刷新 ─────────────────────────────
    _tickDisplay() {
        const I = this.measuredI;
        const status = !this.wireInJaw ? '---' : this._jawAngle > 0.05 ? '~~~' : I.toFixed(I >= 100 ? 1 : I >= 10 ? 2 : 3);

        if (this._dispI) {
            this._dispI.text(status);
            this._dispI.fill(!this.wireInJaw ? '#336633' : this._jawAngle > 0.05 ? '#ccaa00' : I > this.Irange * 0.9 ? '#ff4444' : '#33ff66');
        }

        // 状态标注（钳口/测量）
        const stateMsg = this.jawOpen ? '⬤ 钳口已开  点击钳口区域套入导线' : this.wireInJaw ? `⬤ 测量中 [${this.phases[this.selectedPhase].label}]` : '⬤ 待测 — 点扳机开口，导线穿入';
        if (this._dispFreq) this._dispFreq.text(stateMsg.slice(0, 24));

        // 更新电流调节条
        if (this._phBarRefs) {
            this.phases.forEach((ph, i) => {
                const { bar, barX, barW } = this._phBarRefs[i];
                bar.width((ph.I/500)*barW);
                if (this._phValTexts && this._phValTexts[i]) this._phValTexts[i].text(ph.I+'');
            });
        }
    }

    // ═══════════════════════════════════════════
    openJaw()  { this.jawOpen = true;  this._jawTarget = 1; }
    closeJaw() { this.jawOpen = false; this._jawTarget = 0; if (!this.jawOpen) this.wireInJaw = false; }

    setPhaseI(phaseIdx, I) {
        if (phaseIdx >= 0 && phaseIdx < 3) {
            this.phases[phaseIdx].I = Math.max(0, I);
        }
        this._refreshCache();
    }

    update(I) {
        if (typeof I === 'number') this.setPhaseI(this.selectedPhase, I);
        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label: '位号/名称',      key: 'id',            type: 'text'   },
            { label: '量程索引(0-3)',   key: 'rangeIdx',      type: 'number' },
            { label: 'A相电流 (A)',    key: 'IA',            type: 'number' },
            { label: 'B相电流 (A)',    key: 'IB',            type: 'number' },
            { label: 'C相电流 (A)',    key: 'IC',            type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        this.id           = cfg.id           || this.id;
        this.rangeIdx     = Math.max(0, Math.min(3, parseInt(cfg.rangeIdx) ?? this.rangeIdx));
        this.Irange       = this.ranges[this.rangeIdx];
        if (cfg.IA !== undefined) this.phases[0].I = parseFloat(cfg.IA) || this.phases[0].I;
        if (cfg.IB !== undefined) this.phases[1].I = parseFloat(cfg.IB) || this.phases[1].I;
        if (cfg.IC !== undefined) this.phases[2].I = parseFloat(cfg.IC) || this.phases[2].I;
        this.config = { ...this.config, ...cfg };
        this._updateRangeDisplay();
        this._refreshCache();
    }

    destroy() { this._stopAnimation(); super.destroy?.(); }
}