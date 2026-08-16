import { BaseComponent } from './BaseComponent.js';

/**
 * 速度继电器仿真组件
 * （Speed Relay / Centrifugal Relay）
 *
 * ── 工作原理（电磁感应式）────────────────────────────────────
 *
 *  速度继电器是一种将机械转速信号转换为电气开关信号的传感器，
 *  广泛用于三相异步电动机的反接制动控制（制动到低速时自动切除电源）。
 *
 *  1. 结构组成：
 *     ① 转子（永磁体或感应转子）：固定在被测转轴上，随轴旋转
 *     ② 定子（绕组铁芯）：固定，相对转子可小角度摆动
 *     ③ 弹簧：提供复位力矩，抵抗定子摆动
 *     ④ 触点机构：由定子带动的常开/常闭触点
 *
 *  2. 工作原理：
 *     转子旋转 → 产生旋转磁场 → 在定子中感应涡流
 *     → 涡流在磁场中受力（安培力）→ 产生驱动定子偏转的力矩 T_em
 *     T_em = K × φ² × n（正比于转速 n）
 *
 *     弹簧力矩 T_spring = K_s × θ（正比于偏转角）
 *
 *     平衡时：K × φ² × n = K_s × θ
 *     → 偏转角 θ ∝ n（转速越高，偏转越大）
 *
 *  3. 触点动作：
 *     正转（正向旋转）：
 *       转速 n > n_act（动作转速）→ 定子向正方向偏转 → 正转触点闭合
 *     反转（反向旋转）：
 *       |n| > n_act → 定子向反方向偏转 → 反转触点闭合
 *
 *     复位：
 *       转速 n < n_reset（复位转速）→ 弹簧复位 → 触点断开
 *       通常 n_reset < n_act（迟滞区，防止抖动）
 *
 *  4. 典型参数（JY1 型）：
 *     动作转速：~140 r/min（0°~3600 r/min 对应偏转 0°~最大）
 *     复位转速：~100 r/min
 *     触点容量：3A  AC380V
 *
 *  5. 在电动机反接制动中的应用：
 *     电机正向运行 → 速度继电器正转触点闭合 → 制动控制电路准备好
 *     按停止按钮 → 反接两相电源 → 电机开始制动
 *     转速降至 ~100 r/min → 速度继电器触点断开 → 切除反接电源 → 停机
 *
 * ── 组件结构 ──────────────────────────────────────────────────
 *  ① 转子截面图（永磁体，随转速旋转，带旋转速度可视化）
 *  ② 定子铁芯截面（可左右摆动）
 *  ③ 弹簧机构（定子两侧弹簧）
 *  ④ 触点机构（正转 NO/NC，反转 NO/NC，共四个触点）
 *  ⑤ 转速调节器（滑块，可双向调节正负转速）
 *  ⑥ 力矩平衡可视化（电磁力矩 vs 弹簧力矩）
 *  ⑦ 磁力线动画（随转子旋转）
 *  ⑧ 触点状态 LED 指示
 *  ⑨ 速度-偏转角特性曲线（含动作/复位迟滞线）
 *  ⑩ 实时参数显示（转速、偏转角、各触点状态）
 *
 * ── 触点端口 ─────────────────────────────────────────────────
 *  wire_fw_no  — 正转常开接点（Forward NO）
 *  wire_fw_nc  — 正转常闭接点（Forward NC）
 *  wire_fw_com — 正转公共端（Forward COM）
 *  wire_rv_no  — 反转常开接点（Reverse NO）
 *  wire_rv_nc  — 反转常闭接点（Reverse NC）
 *  wire_rv_com — 反转公共端（Reverse COM）
 *  pipe_shaft  — 被测转轴输入
 */
export class SpeedRelay extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(400, config.width  || 480);
        this.height = Math.max(360, config.height || 420);

        this.type    = 'speed_relay';
        this.special = 'none';
        this.cache   = 'fixed';

        // ── 继电器参数 ──
        this.nAct     = config.nAct    || 140;    // 动作转速 r/min
        this.nReset   = config.nReset  || 100;    // 复位转速 r/min
        this.nMax     = config.nMax    || 1500;   // 最大测量转速 r/min
        this.Km       = config.Km      || 1.5;    // 电磁力矩系数
        this.Ks       = config.Ks      || 1.0;    // 弹簧力矩系数
        this.maxAngle = config.maxAngle|| 25;     // 最大偏转角度 °

        // ── 状态 ──
        this.speed         = config.initSpeed ?? 0;    // 当前转速 r/min（正=正转，负=反转）
        this._manualSpeed  = config.initSpeed ?? 0;
        this._displaySpeed = 0;      // 平滑显示转速

        // 定子偏转角（°，正=正转方向，负=反转方向）
        this.deflectionAngle = 0;
        this._deflAngleSmooth= 0;

        // 触点状态
        this.fwNO   = false;   // 正转常开（断开=false, 闭合=true）
        this.fwNC   = true;    // 正转常闭（正常=true闭合）
        this.rvNO   = false;   // 反转常开
        this.rvNC   = true;    // 反转常闭

        // 内部迟滞状态
        this._fwTriggered = false;
        this._rvTriggered = false;

        // ── 动画 ──
        this._rotorAngle  = 0;     // 转子旋转角度 rad
        this._phase       = 0;
        this._vortexPhase = 0;     // 涡流粒子相位
        this._statOrAngle = 0;     // 定子当前摆动角 °（动画用）

        // ── 波形缓冲 ──
        this._wavLen      = 220;
        this._wavN        = new Float32Array(this._wavLen).fill(0);   // 转速
        this._wavD        = new Float32Array(this._wavLen).fill(0);   // 偏转角
        this._wavAcc      = 0;

        // ── 几何布局 ──
        // 机构截面图（左侧）
        this._mechCX   = Math.round(this.width * 0.28);
        this._mechCY   = Math.round(this.height * 0.38);
        this._rotorR   = Math.round(Math.min(this.width * 0.14, this.height * 0.22));
        this._statorR  = Math.round(this._rotorR * 1.6);  // 定子外径

        // 触点机构（右侧）
        this._contactX = Math.round(this.width * 0.56);
        this._contactY = Math.round(this.height * 0.06);
        this._contactW = Math.round(this.width * 0.20);
        this._contactH = Math.round(this.height * 0.58);

        // 特性曲线（右上）
        this._curveX   = this._contactX + this._contactW + 12;
        this._curveY   = this._contactY;
        this._curveW   = this.width - this._curveX - 8;
        this._curveH   = Math.round(this.height * 0.40);

        // LCD 仪表（右中）
        this._lcdX     = this._curveX;
        this._lcdY     = this._curveY + this._curveH + 8;
        this._lcdW     = this._curveW;
        this._lcdH     = Math.round(this.height * 0.22);

        // 调速器（底部）
        this._sliderX  = 8;
        this._sliderY  = Math.round(this.height * 0.74);
        this._sliderW  = this.width - 16;
        this._sliderH  = Math.round(this.height * 0.24);

        // 波形区（调速器下方）
        this._wavX     = this._sliderX;
        this._wavY     = Math.round(this.height * 0.84);
        this._wavW     = this._sliderW;
        this._wavH     = this.height - this._wavY - 6;

        this.knobs     = {};

        this.config = {
            id: this.id, nAct: this.nAct, nReset: this.nReset,
            nMax: this.nMax, initSpeed: this.speed,
        };

        this._init();

        // 端口
        const cx2 = this._contactX + this._contactW / 2;
        const portY = this._contactY;
        this.addPort(this.width, portY + this._contactH*0.10, 'fw_com', 'wire', 'FW-COM');
        this.addPort(this.width, portY + this._contactH*0.22, 'fw_no',  'wire', 'FW-NO');
        this.addPort(this.width, portY + this._contactH*0.34, 'fw_nc',  'wire', 'FW-NC');
        this.addPort(this.width, portY + this._contactH*0.58, 'rv_com', 'wire', 'RV-COM');
        this.addPort(this.width, portY + this._contactH*0.70, 'rv_no',  'wire', 'RV-NO');
        this.addPort(this.width, portY + this._contactH*0.82, 'rv_nc',  'wire', 'RV-NC');
        this.addPort(this._mechCX, this._mechCY + this._statorR + 10, 'shaft', 'pipe', '轴');
    }

    // ═══════════════════════════════════════════
    _init() {
        this._drawLabel();
        this._drawHousing();
        this._drawStator();
        this._drawRotor();
        this._drawSprings();
        this._drawMagFieldLayer();
        this._drawVortexLayer();
        this._drawContactMechanism();
        this._drawSpeedTorqueCurve();
        this._drawLCDPanel();
        this._drawSpeedSlider();
        this._drawWaveform();
        this._setupSliderDrag();
        
    }

    _drawLabel() {
        this.group.add(new Konva.Text({
            x: 0, y: -22, width: this.width,
            text: '速度继电器（Speed Relay）— 拖拽滑块调节转速',
            fontSize: 12, fontStyle: 'bold', fill: '#1a2634', align: 'center',
        }));
    }

    // ── 外壳 ─────────────────────────────────
    _drawHousing() {
        const cx = this._mechCX, cy = this._mechCY, R = this._statorR;
        // 外壳圆形
        this.group.add(new Konva.Circle({ x: cx, y: cy, radius: R+14, fill: '#37474f', stroke: '#263238', strokeWidth: 2.5 }));
        for (let i = 0; i < 4; i++) {
            const a = (i/4)*Math.PI*2 + Math.PI/4;
            this.group.add(new Konva.Circle({ x: cx+(R+10)*Math.cos(a), y: cy+(R+10)*Math.sin(a), radius: 5.5, fill: '#263238', stroke: '#1a2634', strokeWidth: 0.5 }));
        }
        this.group.add(new Konva.Circle({ x: cx, y: cy, radius: R, fill: '#0d1a28' }));
        // 轴孔标注
        this.group.add(new Konva.Text({ x: cx-R, y: cy-R-22, width: R*2, text: '速度继电器（截面图）', fontSize: 9, fontStyle: 'bold', fill: '#546e7a', align: 'center' }));
        this.group.add(new Konva.Text({ x: cx-R-14, y: cy, text: '←正转', fontSize: 8, fill: '#66bb6a' }));
        this.group.add(new Konva.Text({ x: cx+R+2, y: cy, text: '反转→', fontSize: 8, fill: '#ffa726' }));
    }

    // ── 定子（可摆动）────────────────────────
    _drawStator() {
        const cx = this._mechCX, cy = this._mechCY, R = this._statorR, rR = this._rotorR;

        this._statorGroup = new Konva.Group({ x: cx, y: cy });

        // 定子铁芯（U形，中间空出转子位置）
        const statorBody = new Konva.Ring({ innerRadius: rR+4, outerRadius: R-2, fill: '#546e7a', stroke: '#37474f', strokeWidth: 1 });
        // 叠片纹
        for (let i = 0; i < 20; i++) {
            const a = (i/20)*Math.PI*2;
            this._statorGroup.add(new Konva.Line({
                points: [(rR+4)*Math.cos(a), (rR+4)*Math.sin(a), (R-3)*Math.cos(a), (R-3)*Math.sin(a)],
                stroke: 'rgba(0,0,0,0.12)', strokeWidth: 0.7,
            }));
        }
        // 定子绕组（两极）
        for (let p = 0; p < 2; p++) {
            const poleA = p * Math.PI;
            for (let t = -4; t <= 4; t++) {
                const a = poleA + t * 0.08;
                const r1 = rR+5, r2 = R-4;
                this._statorGroup.add(new Konva.Line({
                    points: [r1*Math.cos(a), r1*Math.sin(a), r2*Math.cos(a), r2*Math.sin(a)],
                    stroke: p===0?'rgba(239,154,154,0.7)':'rgba(144,202,249,0.7)', strokeWidth: 2,
                }));
            }
        }
        // 极性标记
        this._statorGroup.add(new Konva.Text({ x: -(rR+R)/2-10, y: -6, width: 20, text: 'N', fontSize: 11, fontStyle: 'bold', fill: '#ef9a9a', align: 'center' }));
        this._statorGroup.add(new Konva.Text({ x: (rR+R)/2-10, y: -6, width: 20, text: 'S', fontSize: 11, fontStyle: 'bold', fill: '#90caf9', align: 'center' }));

        // 定子偏转角指示弧
        this._statorArc = new Konva.Arc({ innerRadius: R-2, outerRadius: R+2, angle: 0, fill: '#ffd54f', rotation: -90, opacity: 0.8 });
        this._statorGroup.add(this._statorArc);

        this._statorGroup.add(statorBody);
        this.group.add(this._statorGroup);
    }

    // ── 转子（永磁体，旋转）─────────────────
    _drawRotor() {
        const cx = this._mechCX, cy = this._mechCY, R = this._rotorR;

        this._rotorGroup = new Konva.Group({ x: cx, y: cy });

        // 转子铁芯
        this._rotorGroup.add(new Konva.Circle({ radius: R, fill: '#455a64', stroke: '#37474f', strokeWidth: 1.5 }));

        // 永磁体（N/S 两极，弧形）
        for (let i = 0; i < 2; i++) {
            const isN = i === 0;
            const pA = i * Math.PI;
            const magArc = new Konva.Arc({ innerRadius: R*0.42, outerRadius: R*0.88, angle: 160, rotation: pA*180/Math.PI - 80 - 90, fill: isN?'#ef5350':'#42a5f5', stroke: isN?'#c62828':'#1565c0', strokeWidth: 1, opacity: 0.9 });
            this._rotorGroup.add(magArc);
            const mR = (R*0.42+R*0.88)/2;
            const mA = (pA - Math.PI/2) * 180/Math.PI;
            const mRad = pA - Math.PI/2;
            this._rotorGroup.add(new Konva.Text({ x: mR*Math.cos(mRad)-5, y: mR*Math.sin(mRad)-6, text: isN?'N':'S', fontSize: 10, fontStyle: 'bold', fill: '#fff', width: 10, align: 'center' }));
        }

        // 轴
        this._rotorGroup.add(new Konva.Circle({ radius: R*0.15, fill: '#1a2634', stroke: '#263238', strokeWidth: 1.5 }));
        this._rotorGroup.add(new Konva.Circle({ x: -R*0.15, y: -R*0.15, radius: R*0.08, fill: 'rgba(255,255,255,0.18)' }));

        this.group.add(this._rotorGroup);

        // 轴延伸
        this.group.add(new Konva.Rect({ x: cx-4, y: cy+R+6, width: 8, height: 16, fill: '#78909c', stroke: '#546e7a', strokeWidth: 1 }));
        this.group.add(new Konva.Text({ x: cx-12, y: cy+R+24, width: 24, text: '转轴', fontSize: 7.5, fill: '#546e7a', align: 'center' }));
    }

    // ── 弹簧（定子复位弹簧）─────────────────
    _drawSprings() {
        const cx = this._mechCX, cy = this._mechCY, R = this._statorR;
        // 左右两个弹簧图示（定子两侧）
        this._springGroups = [];
        for (let s = 0; s < 2; s++) {
            const side = s === 0 ? -1 : 1;
            const spX  = cx + side * (R + 18);
            const spY  = cy;
            const spGrp = new Konva.Group({ x: spX, y: spY });
            // 弹簧形状
            for (let i = 0; i < 5; i++) {
                spGrp.add(new Konva.Line({ points: [0, i*6-15, side*8, i*6-12, 0, i*6-9], stroke: '#90a4ae', strokeWidth: 1.5, lineJoin: 'round', lineCap: 'round' }));
            }
            // 弹簧两端固定块
            spGrp.add(new Konva.Rect({ x: -5, y: -18, width: 10, height: 4, fill: '#546e7a' }));
            spGrp.add(new Konva.Rect({ x: -5, y: 15, width: 10, height: 4, fill: '#546e7a' }));
            this._springGroups.push(spGrp);
            this.group.add(spGrp);
        }
        this.group.add(new Konva.Text({ x: cx-R-40, y: cy+R*0.6, text: '弹簧', fontSize: 8, fill: '#78909c' }));
    }

    // ── 磁力线层（随转子旋转）────────────────
    _drawMagFieldLayer() {
        this._magGroup = new Konva.Group();
        this.group.add(this._magGroup);
    }

    // ── 涡流粒子层 ───────────────────────────
    _drawVortexLayer() {
        this._vortexGroup = new Konva.Group();
        this.group.add(this._vortexGroup);
    }

    // ── 触点机构（四组触点：正/反 × NO/NC）──
    _drawContactMechanism() {
        const { _contactX: cx2, _contactY: cy2, _contactW: cw, _contactH: ch } = this;

        const bg = new Konva.Rect({ x: cx2, y: cy2, width: cw, height: ch, fill: '#0d1520', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 4 });
        const titleBg = new Konva.Rect({ x: cx2, y: cy2, width: cw, height: 14, fill: '#0a1a28', cornerRadius: [4,4,0,0] });
        this.group.add(new Konva.Text({ x: cx2+2, y: cy2+2, width: cw-4, text: '触点机构', fontSize: 8.5, fontStyle: 'bold', fill: '#80cbc4', align: 'center' }));

        // 定子连杆（从截面图延伸到触点板）
        this._statorLinkLine = new Konva.Line({ points: [this._mechCX+this._statorR, this._mechCY, cx2+4, cy2+ch/2], stroke: '#80a0b4', strokeWidth: 2, dash: [4,3], opacity: 0.6 });
        this.group.add(this._statorLinkLine);

        // 触点板（共用推杆，随定子偏转移动）
        this._contactBarGroup = new Konva.Group({ x: cx2 + cw/2, y: cy2 + ch/2 });
        this._contactBar = new Konva.Rect({ x: -4, y: -ch*0.38, width: 8, height: ch*0.76, fill: '#37474f', stroke: '#263238', strokeWidth: 1, cornerRadius: 2 });
        this._contactBarGroup.add(this._contactBar);

        // 四组触点绘制
        const contactDefs = [
            { id: 'fwNO',  label: 'FW-NO', type: 'NO', side: 'fw', y: -ch*0.22, color: '#66bb6a' },
            { id: 'fwNC',  label: 'FW-NC', type: 'NC', side: 'fw', y: -ch*0.06, color: '#ef9a9a' },
            { id: 'rvNO',  label: 'RV-NO', type: 'NO', side: 'rv', y:  ch*0.10, color: '#ffa726' },
            { id: 'rvNC',  label: 'RV-NC', type: 'NC', side: 'rv', y:  ch*0.26, color: '#90caf9' },
        ];

        this._contactLeds = {};
        this._contactDots = {};

        contactDefs.forEach(({ id, label, type, side, y, color }) => {
            const gy = cy2 + ch/2 + y;

            // 固定触点（右侧）
            const fixedX  = cx2 + cw - 14;
            const fixedY  = gy;
            this.group.add(new Konva.Rect({ x: fixedX-3, y: fixedY-6, width: 6, height: 12, fill: '#c0a020', stroke: '#8a7010', strokeWidth: 0.8, cornerRadius: 1 }));
            this.group.add(new Konva.Line({ points: [fixedX, fixedY-6, fixedX, cy2+14], stroke: color, strokeWidth: 1.5, dash: [3,2], opacity: 0.5 }));

            // 可动触点（连在推杆上，弹性臂）
            const movDot = new Konva.Circle({ x: fixedX-12, y: fixedY, radius: 4.5, fill: '#c0a020', stroke: '#8a7010', strokeWidth: 0.8 });
            const movArm = new Konva.Line({ points: [cx2+cw/2+4, y, fixedX-12, 0], stroke: '#90a4ae', strokeWidth: 2.5, lineCap: 'round' });
            this._contactBarGroup.add(movArm);
            this._contactBarGroup.add(new Konva.Circle({ x: fixedX-12-cx2-cw/2, y, radius: 4.5, fill: '#c0a020', stroke: '#8a7010', strokeWidth: 0.8 }));

            // LED 状态指示
            const ledX = cx2 + 8, ledY = gy;
            const led  = new Konva.Circle({ x: ledX, y: ledY, radius: 5.5, fill: '#1a1a1a', stroke: '#333', strokeWidth: 1 });
            const lbl  = new Konva.Text({ x: ledX+8, y: ledY-5, text: label, fontSize: 8, fontStyle: 'bold', fill: '#37474f' });
            const stateText = new Konva.Text({ x: cx2+cw-50, y: ledY-5, width: 36, text: type==='NC'?'闭合':'断开', fontSize: 8, fontFamily: 'Courier New, monospace', fill: type==='NC'?'#66bb6a':'#37474f', align: 'right' });

            this._contactLeds[id]   = { led, color, stateText };
            this.group.add(led, lbl, stateText);
        });

        this.group.add(bg, titleBg, this._contactBarGroup);

        // 分隔线（正/反转组之间）
        const divY = cy2 + ch/2;
        this.group.add(new Konva.Line({ points: [cx2+4, divY, cx2+cw-4, divY], stroke: '#1a3040', strokeWidth: 1, dash: [4,3] }));
        this.group.add(new Konva.Text({ x: cx2+2, y: divY-10, width: cw-4, text: '—— 正转触点 ——', fontSize: 7.5, fill: '#66bb6a', align: 'center' }));
        this.group.add(new Konva.Text({ x: cx2+2, y: divY+3, width: cw-4, text: '—— 反转触点 ——', fontSize: 7.5, fill: '#ffa726', align: 'center' }));
    }

    // ── 速度-偏转角特性曲线 ──────────────────
    _drawSpeedTorqueCurve() {
        const { _curveX: cx2, _curveY: cy2, _curveW: cw, _curveH: ch } = this;

        const bg = new Konva.Rect({ x: cx2, y: cy2, width: cw, height: ch, fill: '#010d18', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 4 });
        const titleBg = new Konva.Rect({ x: cx2, y: cy2, width: cw, height: 13, fill: '#0a1a28', cornerRadius: [4,4,0,0] });
        this.group.add(new Konva.Text({ x: cx2+4, y: cy2+2, width: cw-8, text: 'n-θ 特性（迟滞回路）', fontSize: 8, fontStyle: 'bold', fill: '#80cbc4', align: 'center' }));

        // 坐标系
        const ox = cx2+12, oy = cy2+ch/2, aw = cw-18, ah = (ch-22)/2;
        // 零点横线（n=0分界）
        this.group.add(new Konva.Line({ points: [ox, oy, ox+aw, oy], stroke: '#37474f', strokeWidth: 1 }));
        // 纵轴
        this.group.add(new Konva.Line({ points: [ox, cy2+13, ox, cy2+ch-6], stroke: '#37474f', strokeWidth: 1 }));
        // 轴标签
        this.group.add(new Konva.Text({ x: ox-8, y: cy2+13, text: 'θ', fontSize: 8, fill: '#ffd54f' }));
        this.group.add(new Konva.Text({ x: cx2+cw-14, y: oy+2, text: 'n', fontSize: 8, fill: '#80cbc4' }));
        this.group.add(new Konva.Text({ x: ox+2, y: cy2+13, text: '+正转', fontSize: 7, fill: '#66bb6a' }));
        this.group.add(new Konva.Text({ x: ox+2, y: cy2+ch-14, text: '−反转', fontSize: 7, fill: '#ffa726' }));

        // 正转特性线（正斜率）
        const nActX = ox + (this.nAct/this.nMax)*aw;
        const nResX = ox + (this.nReset/this.nMax)*aw;
        const fullX = ox + aw;
        const fullY_up = oy - ah + 4;

        // 上升曲线（达到动作转速前斜率大，之后钳制）
        this.group.add(new Konva.Line({ points: [ox, oy, nActX, oy-ah*0.6, fullX, fullY_up], stroke: '#66bb6a', strokeWidth: 1.5, lineJoin: 'round', opacity: 0.7 }));
        // 下降曲线（迟滞）
        this.group.add(new Konva.Line({ points: [fullX, fullY_up, nResX, oy-ah*0.35, ox, oy], stroke: '#66bb6a', strokeWidth: 1, dash: [4,3], lineJoin: 'round', opacity: 0.45 }));

        // 反转特性（镜像，向下）
        this.group.add(new Konva.Line({ points: [ox, oy, nActX, oy+ah*0.6, fullX, oy+ah-4], stroke: '#ffa726', strokeWidth: 1.5, lineJoin: 'round', opacity: 0.7 }));
        this.group.add(new Konva.Line({ points: [fullX, oy+ah-4, nResX, oy+ah*0.35, ox, oy], stroke: '#ffa726', strokeWidth: 1, dash: [4,3], lineJoin: 'round', opacity: 0.45 }));

        // n_act / n_reset 标注
        this.group.add(new Konva.Line({ points: [nActX, cy2+13, nActX, cy2+ch-6], stroke: 'rgba(239,83,80,0.35)', strokeWidth: 1, dash: [3,2] }));
        this.group.add(new Konva.Text({ x: nActX-8, y: cy2+14, text: 'n_a', fontSize: 7, fill: '#ef9a9a' }));
        this.group.add(new Konva.Line({ points: [nResX, cy2+13, nResX, cy2+ch-6], stroke: 'rgba(255,167,38,0.30)', strokeWidth: 1, dash: [3,2] }));
        this.group.add(new Konva.Text({ x: nResX-8, y: cy2+14, text: 'n_r', fontSize: 7, fill: '#ffa726' }));

        // 工作点（动态）
        this._workPointUp   = new Konva.Circle({ x: ox, y: oy, radius: 5, fill: '#66bb6a', stroke: '#2e7d32', strokeWidth: 1 });
        this._workPointDown = new Konva.Circle({ x: ox, y: oy, radius: 5, fill: '#ffa726', stroke: '#e65100', strokeWidth: 1, visible: false });
        this._curveOX = ox; this._curveOY = oy; this._curveAW = aw; this._curveAH = ah;

        this.group.add(bg, titleBg, this._workPointUp, this._workPointDown);
    }

    // ── LCD 仪表 ─────────────────────────────
    _drawLCDPanel() {
        const lx = this._lcdX, ly = this._lcdY, lw = this._lcdW, lh = this._lcdH;

        const bg = new Konva.Rect({ x: lx, y: ly, width: lw, height: lh, fill: '#020c14', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 4 });
        const titleBg = new Konva.Rect({ x: lx, y: ly, width: lw, height: 13, fill: '#0a1a28', cornerRadius: [4,4,0,0] });
        this.group.add(new Konva.Text({ x: lx+4, y: ly+2, width: lw-8, text: '参数显示', fontSize: 8, fontStyle: 'bold', fill: '#80cbc4', align: 'center' }));

        this._lcdN    = new Konva.Text({ x: lx+4, y: ly+16, width: lw-8, text: 'n = 0 r/min', fontSize: 12, fontFamily: 'Courier New, monospace', fontStyle: 'bold', fill: '#4dd0e1', align: 'center' });
        this._lcdTheta= new Konva.Text({ x: lx+4, y: ly+33, width: lw-8, text: 'θ = 0.0°', fontSize: 10, fontFamily: 'Courier New, monospace', fill: '#ffd54f', align: 'center' });
        this._lcdState= new Konva.Text({ x: lx+4, y: ly+50, width: lw-8, text: '● 静止', fontSize: 9, fontStyle: 'bold', fill: '#66bb6a', align: 'center' });

        this.group.add(bg, titleBg, this._lcdN, this._lcdTheta, this._lcdState);
    }

    // ── 速度调节滑块（双向，含正负方向）──────
    _drawSpeedSlider() {
        const { _sliderX: sx, _sliderY: sy, _sliderW: sw, _sliderH: sh } = this;

        const bg = new Konva.Rect({ x: sx, y: sy, width: sw, height: sh, fill: '#020c14', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 4 });
        const titleBg = new Konva.Rect({ x: sx, y: sy, width: sw, height: 13, fill: '#0a1a28', cornerRadius: [4,4,0,0] });
        this.group.add(new Konva.Text({ x: sx+4, y: sy+2, width: sw-8, text: '转速调节（向右=正转，向左=反转）', fontSize: 8, fontStyle: 'bold', fill: '#ffd54f', align: 'center' }));

        // 进度条（双向，0在中央）
        const barX = sx+8, barY = sy+20, barW = sw-16, barH = 14;
        const midX = barX + barW/2;

        // 背景轨道
        this.group.add(new Konva.Rect({ x: barX, y: barY, width: barW, height: barH, fill: '#0d2030', cornerRadius: 3 }));
        // 零点线
        this.group.add(new Konva.Line({ points: [midX, barY-3, midX, barY+barH+3], stroke: '#37474f', strokeWidth: 1.5 }));
        // 正转区标注（右侧）
        this.group.add(new Konva.Text({ x: midX+4, y: barY-10, text: '→ 正转', fontSize: 7.5, fill: '#66bb6a' }));
        // 反转区标注（左侧）
        this.group.add(new Konva.Text({ x: barX, y: barY-10, text: '反转 ←', fontSize: 7.5, fill: '#ffa726' }));

        // 正转填充（从中心向右）
        this._speedBarFwd = new Konva.Rect({ x: midX, y: barY, width: 0, height: barH, fill: '#66bb6a', cornerRadius: [0,3,3,0], opacity: 0.8 });
        // 反转填充（从中心向左）
        this._speedBarRev = new Konva.Rect({ x: midX, y: barY, width: 0, height: barH, fill: '#ffa726', cornerRadius: [3,0,0,3], opacity: 0.8 });

        // 滑块指示点
        this._speedSlider = new Konva.Circle({ x: midX, y: barY+barH/2, radius: 9, fill: '#ffd54f', stroke: '#c0a020', strokeWidth: 1.5 });
        this._speedSlider.add?.(new Konva.Circle({ x: -3, y: -3, radius: 3, fill: 'rgba(255,255,255,0.4)' }));

        // 动作/复位线标注
        const nActRatio = this.nAct / this.nMax;
        const nActXFwd  = midX + nActRatio * barW/2;
        const nActXRev  = midX - nActRatio * barW/2;
        this.group.add(new Konva.Line({ points: [nActXFwd, barY-2, nActXFwd, barY+barH+2], stroke: 'rgba(239,83,80,0.5)', strokeWidth: 1, dash: [2,2] }));
        this.group.add(new Konva.Line({ points: [nActXRev, barY-2, nActXRev, barY+barH+2], stroke: 'rgba(239,83,80,0.5)', strokeWidth: 1, dash: [2,2] }));
        this.group.add(new Konva.Text({ x: nActXFwd-8, y: barY+barH+3, width: 16, text: `${this.nAct}`, fontSize: 7, fill: '#ef9a9a', align: 'center' }));

        // 数值显示
        this._speedValText = new Konva.Text({ x: barX, y: barY+barH+16, width: barW, text: 'n = 0 r/min', fontSize: 10, fontFamily: 'Courier New, monospace', fontStyle: 'bold', fill: '#ffd54f', align: 'center' });

        // 快速预设按钮
        const presets = [
            { v: 0, label: '停止' },
            { v: 100, label: '+100' },
            { v: 140, label: '+140' },
            { v: 400, label: '+400' },
            { v: 1000, label: '+1000' },
            { v: -140, label: '-140' },
        ];
        const btnW = (sw-12) / presets.length;
        const btnY2 = sy + sh - 18;
        presets.forEach(({ v, label }, i) => {
            const bx = sx+6+i*(btnW+2);
            const col = v > this.nAct ? '#66bb6a' : v < -this.nAct ? '#ffa726' : v === 0 ? '#37474f' : '#ffd54f';
            const btn = new Konva.Rect({ x: bx, y: btnY2, width: btnW, height: 14, fill: '#0d2030', stroke: '#1a3040', strokeWidth: 1, cornerRadius: 2 });
            const lbl = new Konva.Text({ x: bx, y: btnY2+3, width: btnW, text: label, fontSize: 8, fill: col, align: 'center' });
            btn.on('click tap', () => { this._manualSpeed = v; });
            btn.on('mouseenter', () => btn.fill('#1a3a2a'));
            btn.on('mouseleave', () => btn.fill('#0d2030'));
            this.group.add(btn, lbl);
        });

        this._barX = barX; this._barW = barW; this._barMidX = midX;
        this._barY = barY; this._barH = barH;

        this.group.add(bg, titleBg, this._speedBarFwd, this._speedBarRev, this._speedSlider, this._speedValText);
    }

    // ── 波形区 ───────────────────────────────
    _drawWaveform() {
        const { _wavX: wx, _wavY: wy, _wavW: ww, _wavH: wh } = this;
        if (wh < 14) return;

        const bg = new Konva.Rect({ x: wx, y: wy, width: ww, height: wh, fill: '#010d18', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 4 });
        const titleBg = new Konva.Rect({ x: wx, y: wy, width: ww, height: 12, fill: '#0a1a28', cornerRadius: [4,4,0,0] });
        this.group.add(new Konva.Text({ x: wx+4, y: wy+1, width: ww-8, text: 'n(t) 转速曲线  ── θ(t) 偏转角曲线', fontSize: 8, fill: '#80cbc4', align: 'center' }));

        const midY = wy + wh/2;
        this.group.add(new Konva.Line({ points: [wx+2, midY, wx+ww-2, midY], stroke: 'rgba(100,200,200,0.12)', strokeWidth: 0.5, dash: [4,3] }));
        this._wLineN  = new Konva.Line({ points: [], stroke: '#4dd0e1', strokeWidth: 1.6, lineJoin: 'round' });
        this._wLineD  = new Konva.Line({ points: [], stroke: '#ffd54f', strokeWidth: 1.4, lineJoin: 'round' });

        this.group.add(new Konva.Text({ x: wx+4, y: wy+12+4, text: 'n', fontSize: 8, fill: '#4dd0e1' }));
        this.group.add(new Konva.Text({ x: wx+4, y: midY+4, text: 'θ', fontSize: 8, fill: '#ffd54f' }));
        this._wavMidN = wy + wh*0.28;
        this._wavMidD = midY + wh*0.24;

        this.group.add(bg, titleBg, this._wLineN, this._wLineD);
    }

    // ── 拖拽调速 ─────────────────────────────
    _setupSliderDrag() {
        const hitZone = new Konva.Rect({ x: this._barX-4, y: this._barY-4, width: this._barW+8, height: this._barH+8, fill: 'transparent', listening: true });
        hitZone.on('mousedown touchstart click tap', e => {
            const stage = this.group.getStage?.();
            const pos   = stage?.getPointerPosition?.() ?? { x: e.evt?.clientX ?? e.clientX ?? 0 };
            const relX  = pos.x - (this.group.x?.()??0) - this._barMidX;
            const ratio = Math.max(-1, Math.min(1, relX / (this._barW/2)));
            this._manualSpeed = Math.round(ratio * this.nMax);
        });
        const mv = e => {
            const stage = this.group.getStage?.();
            const pos   = stage?.getPointerPosition?.() ?? { x: e.clientX ?? 0 };
            const relX  = pos.x - (this.group.x?.()??0) - this._barMidX;
            const ratio = Math.max(-1, Math.min(1, relX / (this._barW/2)));
            this._manualSpeed = Math.round(ratio * this.nMax);
        };
        const up = () => { this._sliderDrag = false; };
        hitZone.on('mousedown touchstart', () => {
            this._sliderDrag = true;
            window.addEventListener('mousemove', mv);
            window.addEventListener('touchmove', mv, { passive: true });
            window.addEventListener('mouseup', up);
            window.addEventListener('touchend', up);
        });
        this.group.add(hitZone);
    }

    // ═══════════════════════════════════════════
    // 集中化 tick（由 consys._tickAll 在 20fps 调用）
    tick(dt) {
        this._tickPhysics(dt);
        this._tickMechViz(dt);
        this._tickContactViz();
        this._tickCurvePoint();
        this._tickWaveform(dt);
        this._tickDisplay();
        this._refreshCache();
    }


    // ── 物理计算 ─────────────────────────────
    _tickPhysics(dt) {
        // 转速平滑追踪
        this._displaySpeed += (this._manualSpeed - this._displaySpeed) * Math.min(1, dt * 5);
        this.speed = this._displaySpeed;
        const n = this.speed;
        const absN = Math.abs(n);

        // 电磁力矩（正比于转速²，方向取决于转向）
        const T_em = this.Km * (n / this.nMax) * (absN / this.nMax) * this.maxAngle;

        // 弹簧复位力矩
        const T_spring = -this.Ks * this._deflAngleSmooth;

        // 偏转角（准稳态近似：T_em + T_spring = 0）
        const targetAngle = T_em / this.Ks;
        const clampedTarget = Math.max(-this.maxAngle, Math.min(this.maxAngle, targetAngle));
        this._deflAngleSmooth += (clampedTarget - this._deflAngleSmooth) * Math.min(1, dt * 8);
        this.deflectionAngle = this._deflAngleSmooth;

        // 转子旋转
        const omega = n / 60 * 2 * Math.PI;
        this._rotorAngle += omega * dt;
        this._phase      += dt * 3;
        this._vortexPhase+= dt * Math.max(1, absN / 20);

        // 触点逻辑（带迟滞）
        if (n > 0) {
            // 正转
            if (!this._fwTriggered && absN >= this.nAct) {
                this._fwTriggered = true;
            } else if (this._fwTriggered && absN < this.nReset) {
                this._fwTriggered = false;
            }
            this._rvTriggered = false;
        } else if (n < 0) {
            // 反转
            if (!this._rvTriggered && absN >= this.nAct) {
                this._rvTriggered = true;
            } else if (this._rvTriggered && absN < this.nReset) {
                this._rvTriggered = false;
            }
            this._fwTriggered = false;
        } else {
            this._fwTriggered = false;
            this._rvTriggered = false;
        }

        // 更新触点状态
        this.fwNO = this._fwTriggered;    // 正转 NO：动作时闭合
        this.fwNC = !this._fwTriggered;   // 正转 NC：动作时断开
        this.rvNO = this._rvTriggered;    // 反转 NO：动作时闭合
        this.rvNC = !this._rvTriggered;   // 反转 NC：动作时断开
    }

    // ── 机构可视化 ───────────────────────────
    _tickMechViz(dt) {
        // 转子旋转
        if (this._rotorGroup) this._rotorGroup.rotation(this._rotorAngle * 180/Math.PI);

        // 定子摆动
        if (this._statorGroup) this._statorGroup.rotation(this.deflectionAngle);

        // 定子偏转弧（指示偏转方向和大小）
        if (this._statorArc) {
            const arcAngle = Math.abs(this.deflectionAngle) * 2;
            this._statorArc.angle(arcAngle);
            const arcStart = this.deflectionAngle >= 0 ? -90 : -90 - arcAngle;
            this._statorArc.rotation(arcStart);
            this._statorArc.fill(this.deflectionAngle >= 0 ? '#66bb6a' : '#ffa726');
        }

        // 触点板推杆位移（跟随定子偏转）
        if (this._contactBarGroup) {
            const shift = this.deflectionAngle / this.maxAngle * 20;  // 最大位移20px
            this._contactBarGroup.y(this._contactY + this._contactH/2 + shift);
        }

        // 弹簧压缩/伸展动画
        if (this._springGroups) {
            this._springGroups.forEach((sg, i) => {
                const compression = (i===0 ? 1 : -1) * this.deflectionAngle / this.maxAngle;
                sg.scaleY(1 - compression * 0.12);
            });
        }

        // 磁力线（转子磁场）
        this._magGroup.destroyChildren();
        const cx = this._mechCX, cy = this._mechCY;
        const nLines = 8;
        const absN = Math.abs(this.speed);
        if (absN > 10) {
            const fieldIntensity = Math.min(0.8, absN / this.nMax * 0.8 + 0.1);
            for (let i = 0; i < nLines; i++) {
                const a = this._rotorAngle + (i/nLines)*Math.PI*2;
                const rStart = this._rotorR+3, rEnd = this._statorR-4;
                const col = Math.cos(a - this._rotorAngle) > 0 ? '#ef9a9a' : '#90caf9';
                this._magGroup.add(new Konva.Line({ points: [cx+rStart*Math.cos(a), cy+rStart*Math.sin(a), cx+rEnd*Math.cos(a), cy+rEnd*Math.sin(a)], stroke: col, strokeWidth: 1.8, opacity: fieldIntensity*0.55 }));
            }
        }

        // 涡流粒子（在定子铁芯中）
        this._vortexGroup.destroyChildren();
        if (absN > 30) {
            const vortexIntensity = Math.min(0.8, absN/500);
            const nVortex = 4;
            const statorR = (this._rotorR + this._statorR) / 2;
            for (let i = 0; i < nVortex; i++) {
                const t = ((this._vortexPhase*0.15 + i/nVortex) % 1 + 1) % 1;
                const vAngle = t*Math.PI*2 + this._statorGroup.rotation()*Math.PI/180;
                const vx = cx + statorR*Math.cos(vAngle), vy = cy + statorR*Math.sin(vAngle);
                this._vortexGroup.add(new Konva.Circle({ x: vx, y: vy, radius: 3, fill: `rgba(255,213,79,${vortexIntensity*(1-t)})` }));
            }
        }
    }

    // ── 触点可视化 ───────────────────────────
    _tickContactViz() {
        const states = { fwNO: this.fwNO, fwNC: this.fwNC, rvNO: this.rvNO, rvNC: this.rvNC };
        const pulse = 0.5 + 0.5 * Math.abs(Math.sin(this._phase * 3));

        Object.entries(this._contactLeds || {}).forEach(([id, { led, color, stateText }]) => {
            const closed = states[id];
            led.fill(closed ? color : '#1a1a1a');
            if (closed) {
                // 动作时 LED 脉冲
                const r = parseInt(color.slice(1,3),16), g = parseInt(color.slice(3,5),16), b = parseInt(color.slice(5,7),16);
                led.fill(`rgba(${r},${g},${b},${0.5+pulse*0.5})`);
            }
            stateText.text(closed ? '●闭合' : '○断开');
            stateText.fill(closed ? color : '#37474f');
        });
    }

    // ── 特性曲线工作点 ───────────────────────
    _tickCurvePoint() {
        const n = this.speed;
        const theta = this.deflectionAngle;
        const { _curveOX: ox, _curveOY: oy, _curveAW: aw, _curveAH: ah } = this;

        const nRatio = Math.min(1, Math.abs(n) / this.nMax);
        const tRatio = Math.min(1, Math.abs(theta) / this.maxAngle);
        const nx = ox + nRatio * (aw-2);
        const ny_up   = oy - tRatio * (ah-4);
        const ny_down = oy + tRatio * (ah-4);

        if (n >= 0) {
            this._workPointUp.x(nx);   this._workPointUp.y(ny_up);   this._workPointUp.visible(true);
            this._workPointDown.visible(false);
        } else {
            this._workPointDown.x(nx); this._workPointDown.y(ny_down); this._workPointDown.visible(true);
            this._workPointUp.visible(false);
        }
    }

    // ── 波形 ─────────────────────────────────
    _tickWaveform(dt) {
        if (!this._wLineN) return;
        this._wavAcc += 1.3*dt*this._wavLen;
        const steps = Math.floor(this._wavAcc); this._wavAcc -= steps;
        for (let i = 0; i < steps; i++) {
            this._wavN = new Float32Array([...this._wavN.slice(1), this.speed]);
            this._wavD = new Float32Array([...this._wavD.slice(1), this.deflectionAngle]);
        }

        const wx = this._wavX+3, ww = this._wavW-6;
        const n2 = this._wavLen, dx = ww/n2;
        const aN = (this._wavH-12)*0.22, aD = (this._wavH-12)*0.20;

        const nPts=[], dPts=[];
        for (let i = 0; i < n2; i++) {
            const x = wx+i*dx;
            nPts.push(x, this._wavMidN-(this._wavN[i]/this.nMax)*aN);
            dPts.push(x, this._wavMidD-(this._wavD[i]/this.maxAngle)*aD);
        }
        if (this._wLineN) this._wLineN.points(nPts);
        if (this._wLineD) this._wLineD.points(dPts);
    }

    // ── 显示刷新 ─────────────────────────────
    _tickDisplay() {
        const n = this.speed, theta = this.deflectionAngle;
        const absN = Math.abs(n);

        if (this._lcdN) {
            const col = n === 0 ? '#37474f' : n > 0 ? '#4dd0e1' : '#ffa726';
            this._lcdN.text(`n = ${n > 0?'+':''}${Math.round(n)} r/min`);
            this._lcdN.fill(col);
        }
        if (this._lcdTheta) this._lcdTheta.text(`θ = ${theta.toFixed(1)}°`);
        if (this._lcdState) {
            const st = n === 0 ? '● 静止' : absN < this.nAct ? `◐ 低速 (n<${this.nAct})` : n > 0 ? `▶ 正转触点闭合 ${Math.round(n)}r` : `◀ 反转触点闭合 ${Math.round(n)}r`;
            const sc = n === 0 ? '#37474f' : absN < this.nAct ? '#ffd54f' : n > 0 ? '#66bb6a' : '#ffa726';
            this._lcdState.text(st); this._lcdState.fill(sc);
        }

        // 滑块更新
        if (this._speedBarFwd || this._speedBarRev) {
            const ratio = Math.max(-1, Math.min(1, this.speed / this.nMax));
            const halfW = this._barW / 2;
            if (ratio >= 0) {
                this._speedBarFwd?.width(ratio * halfW);
                this._speedBarFwd?.x(this._barMidX);
                this._speedBarRev?.width(0);
            } else {
                const absRatio = Math.abs(ratio);
                this._speedBarRev?.width(absRatio * halfW);
                this._speedBarRev?.x(this._barMidX - absRatio * halfW);
                this._speedBarFwd?.width(0);
            }
        }
        if (this._speedSlider) this._speedSlider.x(this._barMidX + (this.speed / this.nMax) * this._barW/2);
        if (this._speedValText) {
            const col = n === 0 ? '#666' : n > 0 ? '#66bb6a' : '#ffa726';
            this._speedValText.text(`n = ${n > 0?'+':''}${Math.round(n)} r/min`);
            this._speedValText.fill(col);
        }
    }

    // ═══════════════════════════════════════════
    update(speed) {
        if (typeof speed === 'number') this._manualSpeed = speed;
        this._refreshCache();
    }

    setSpeed(rpm) { this.update(rpm); }

    getConfigFields() {
        return [
            { label: '位号/名称',          key: 'id',       type: 'text'   },
            { label: '动作转速 n_act (r/min)', key: 'nAct', type: 'number' },
            { label: '复位转速 n_reset (r/min)', key: 'nReset', type: 'number' },
            { label: '最大转速 n_max (r/min)',   key: 'nMax',  type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        this.id     = cfg.id     || this.id;
        this.nAct   = parseFloat(cfg.nAct)   || this.nAct;
        this.nReset = parseFloat(cfg.nReset) || this.nReset;
        this.nMax   = parseFloat(cfg.nMax)   || this.nMax;
        this.config = { ...this.config, ...cfg };
        this._refreshCache();
    }

    destroy() {
        super.destroy?.();
    }
}