import { BaseComponent } from './BaseComponent.js';

/**
 * 船舶三灯绝缘指示灯组件（检测母线各相对船体的绝缘状况）
 *
 * ═══ 物理模型（纯测量 + 显示，不参与 MNA stamp）═══════════════
 *  与 ACVoltmeter 同为“读数型”设备：
 *    - 顶部 3 个相端口 l1/l2/l3 并联接母线三相（高阻读取，基本不改变母线电压）
 *    - 底部 1 个地端口 gnd（接船体地）
 *    - 三只白炽灯星形连接：灯一端接相端口，另一端汇聚于星点（内部）
 *    - 每帧用 getVoltageBetween(l_i, gnd) 读取该相对地瞬时电压 → RMS
 *
 * ═══ 绝缘检测逻辑（常开按钮）═══════════════════════════════════
 *  按钮为常开：平时断开（星点悬空，绝缘不参与），三灯按母线电压满亮；
 *  按下闭合（星点经按钮接地）后接入绝缘检测。
 *
 *  三路负载（对应配电箱 pdb1 出线开关 sw1/sw2/sw3）各有三相绝缘电阻，
 *  每相总绝缘 = 所有“开关已闭合”的负载该相绝缘的并联：
 *    R_eff[phase] = 1 / Σ(1/R_load[phase])   （开关断开的负载不参与）
 *  例：三个负载开关均合上，电机 A 相 0.5MΩ ∥ 照明 A 相 0.5MΩ ∥
 *      可调负载 A 相 10MΩ → A 相总绝缘 ≈ 0.48MΩ。
 *
 *  ═══ 亮度-绝缘映射（用户指定）════════════════════════════════
 *    R_eff ≥ 0.1MΩ        → 亮度 1.0（全亮，且各相一样亮）
 *    0.01MΩ ~ 0.1MΩ       → 仍 1.0（尚未开始变暗）
 *    0.001MΩ ~ 0.01MΩ     → 1.0 → 0.75（开始变暗）
 *    10Ω ~ 1kΩ            → 0.75 → 0（明显变暗段）
 *    R_eff < 10Ω          → 0（完全熄灭）
 *  对数刻度分段线性插值（跨数量级平滑）。
 *
 *  ═══ 星点位移增强 ═════════════════════════════════════════════
 *  按下按钮后，三相绝缘不对称产生星点（中性点）位移电压 V_N：
 *    V_N = -(U_a·Y_a + U_b·Y_b + U_c·Y_c) / (Y_a+Y_b+Y_c)，Y_i = 1/R_eff_i
 *  健康相的灯电压会高于相电压 → 亮度略微变亮（上限 1.15）；
 *  故障相自身的亮度衰减由 insFactor 曲线决定（位移不再次压低该相）。
 *
 *  ═══ 灯损坏 ══════════════════════════════════════════════════
 *  损坏的灯恒不亮。常态（按钮未按、星点悬空）下若恰有一盏损坏，
 *  另两盏完好灯串联跨在线电压上 → 亮度 × √3/2 ≈ 0.866（等效电压降低、略暗）；
 *  两盏以上损坏 → 无回路，剩余灯全灭。
 *
 * ═══ 渲染优化 ═════════════════════════════════════════════════
 *  静态部件（面板、端子、星形接线、按钮底座、标签）init 时一次性绘制并缓存；
 *  动态元素（灯热光、RMS 文本、按钮刀片、状态文字）tick 中 in-place 更新；
 *  不使用 shadow；运行时不刷新缓存。
 */

export class InsulationIndicator extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(240, config.width  || 270);
        this.height = Math.max(190, config.height || 210);

        this.type  = 'insul_indic';
        this.cache = 'fixed';

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        this.config = {
            id:     this.id,
            label:  this.label,
            loadInsul: this._loadInsul.map(r => r.slice()),
            lampOK: this._lampOK.slice(),
        };

        // —— 电气端口 ——
        // 顶部三相（接母线，端口中心位于组件顶边），底部地（接船体地，端口中心位于组件底边）
        for (let i = 0; i < 3; i++) {
            this.addPort(this._lampX[i], 0, `l${i + 1}`, 'wire', 'p');
        }
        this.addPort(this._cx, this.height, 'gnd', 'wire', 'p');
    }

    // ═══════════════════════════════════
    // 几何
    // ═══════════════════════════════════
    _recalcGeometry() {
        const W = this.width, H = this.height;
        this._cx = W / 2;

        // 三只灯横向位置（与顶部端口对齐）
        this._lampX = [W * 0.20, W * 0.50, W * 0.80];
        this._lampY = Math.round(H * 0.34);    // 灯中心 y（灯上引线缩短约一半）

        // 星点（三灯汇聚点）
        this._star = { x: this._cx, y: this._lampY + this._lampR() + 14 };

        // 常开检测按钮（竖放，参照 DiagramStartButton）：
        //   上触点（连星点，刀片闭合时搭接）→ 下触点/旋转轴（连 GND），刀片绕轴转动
        //   整个按钮整体下移 25px
        this._btnTopY  = this._star.y + 14 + 25;         // 上触点 y
        this._btnArm   = 34;                             // 刀片臂长（触点间距）
        this._btnAxisY = this._btnTopY + this._btnArm;   // 旋转轴（下触点）y
        // 按钮帽（倒山字，开口朝左）竖放在动触臂左侧；
        //   帽底参数令帽中心线 = 刀片中央（axisY - arm/2），即帽中心与动触臂中心水平
        this._btnHatX     = this._cx - 26;
        this._btnHatBaseY = this._btnAxisY - this._btnArm / 2 + 7;
    }

    _initParameters(config) {
        this.label  = config.label  || '绝缘指示灯';

        // 3 路负载 × 3 相 绝缘电阻（Ω）：load 0=电机, 1=照明, 2=可调；phase 0=A,1=B,2=C
        const def = [[100e6, 100e6, 100e6], [100e6, 100e6, 100e6], [100e6, 100e6, 100e6]];
        if (Array.isArray(config.loadInsul)) {
            for (let ld = 0; ld < 3 && ld < config.loadInsul.length; ld++) {
                if (!Array.isArray(config.loadInsul[ld])) continue;
                for (let ph = 0; ph < 3 && ph < config.loadInsul[ld].length; ph++) {
                    const v = parseFloat(config.loadInsul[ld][ph]);
                    def[ld][ph] = Number.isFinite(v) ? Math.max(0, v) : 100e6;
                }
            }
        }
        this._loadInsul = def;

        this._lampOK = Array.isArray(config.lampOK) && config.lampOK.length === 3
            ? config.lampOK.map(Boolean)
            : [true, true, true];

        this._btnClosed  = false;        // 常开按钮：常态断开
        this._btnLocked  = false;        // 右键模拟锁定闭合
        this._rmsBuffer  = [[], [], []];
        this._rmsWindow  = 200;          // 约 10 个工频周期（50Hz,20fps)
        this._rmsV       = [0, 0, 0];
        this._brightness = [0, 0, 0];
    }

    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
    }

    // ═══════════════════════════════════
    // 静态绘制
    // ═══════════════════════════════════
    _drawStaticParts() {
        const W = this.width, H = this.height;
        const steel = '#2f3b4c', dark = '#1d2733';
        // 内部连线统一亮黄色、加粗为原来的 2 倍
        const wireC = '#ffe23a';

        // —— 金属面板 ——
        this._staticGroup.add(new Konva.Rect({
            x: 1, y: 1, width: W - 2, height: H - 2,
            cornerRadius: 6, fill: steel, stroke: '#101820', strokeWidth: 2,
        }));
        this._staticGroup.add(new Konva.Rect({
            x: 5, y: 5, width: W - 10, height: H - 10,
            cornerRadius: 4, fill: dark, stroke: '#4a5a6e', strokeWidth: 1,
        }));

        // —— 顶部端子（接线柱，中心移到边缘线 y=0，半径 8）——
        for (let i = 0; i < 3; i++) {
            const x = this._lampX[i];
            this._staticGroup.add(new Konva.Circle({
                x, y: 0, radius: 8,
                fillLinearGradientStartPoint: { x: -8, y: -8 },
                fillLinearGradientEndPoint:   { x: 8, y: 8 },
                fillLinearGradientColorStops: [0, '#d8c870', 0.5, '#f0e090', 1, '#b8a858'],
                stroke: '#908030', strokeWidth: 1,
            }));
            // 端子 → 灯 引线
            this._staticGroup.add(new Konva.Line({
                points: [x, 0, x, this._lampY - this._lampR()], stroke: wireC, strokeWidth: 4,
            }));
            // 相标号（左移 15px）
            this._staticGroup.add(new Konva.Text({
                x: x - 29, y: 14, width: 28, text: `L${i + 1}`,
                fontSize: 11, fill: '#ffd76a', fontStyle: 'bold', align: 'center',
            }));
        }

        // —— 三盏灯（静态壳）——
        for (let i = 0; i < 3; i++) {
            this._drawLampShell(i);
        }

        // —— 星形接线：灯底 → 星点 → 按钮 → 地端子 ——
        const star = this._star;
        for (let i = 0; i < 3; i++) {
            this._staticGroup.add(new Konva.Line({
                points: [this._lampX[i], this._lampY + this._lampR(), this._lampX[i], star.y, star.x, star.y],
                stroke: wireC, strokeWidth: 3,
            }));
        }
        this._staticGroup.add(new Konva.Circle({ x: star.x, y: star.y, radius: 3.5, fill: '#e8c86a', stroke: '#908030', strokeWidth: 1 }));

        // 星点 → 上触点（虚线，表示经常开按钮）
        this._staticGroup.add(new Konva.Line({
            points: [star.x, star.y, this._cx, this._btnTopY],
            stroke: wireC, strokeWidth: 3, dash: [4, 3],
        }));

        // —— 竖放常开按钮（参照 DiagramStartButton）——
        // 上静触点（星点侧）
        this._staticGroup.add(new Konva.Circle({
            x: this._cx, y: this._btnTopY, radius: 4,
            fill: '#20a030', stroke: '#908030', strokeWidth: 0.8,
        }));
        // 下静触点 / 旋转轴（地侧）
        this._staticGroup.add(new Konva.Circle({
            x: this._cx, y: this._btnAxisY, radius: 4,
            fill: '#20a030', stroke: '#908030', strokeWidth: 0.8,
        }));
        // 下触点 → 地端子
        this._staticGroup.add(new Konva.Line({
            points: [this._cx, this._btnAxisY, this._cx, H],
            stroke: wireC, strokeWidth: 4,
        }));
        // 按钮帽（倒山字，竖放在动触臂左侧、与刀片中央同高）
        this._drawButtonBase(this._btnHatX, this._btnHatBaseY, '#20a030');
        // 地端子接线柱（中心移到边缘线 y=H，半径 8）
        this._staticGroup.add(new Konva.Circle({
            x: this._cx, y: H, radius: 8,
            fillLinearGradientStartPoint: { x: -8, y: -8 },
            fillLinearGradientEndPoint:   { x: 8, y: 8 },
            fillLinearGradientColorStops: [0, '#d8c870', 0.5, '#f0e090', 1, '#b8a858'],
            stroke: '#908030', strokeWidth: 1,
        }));
        // 地端子标号（左移 15px）
        this._staticGroup.add(new Konva.Text({
            x: this._cx - 35, y: H - 16, width: 40, text: 'GND',
            fontSize: 10, fill: '#ffd76a', fontStyle: 'bold', align: 'center',
        }));

        // —— 面板标题（上移 10px）——
        this._titleText = new Konva.Text({
            x: 0, y: 30, width: W, text: this.label,
            fontSize: 14, fill: '#bcd0e8', fontStyle: 'bold', align: 'center',
        });
        this._staticGroup.add(this._titleText);
    }

    _lampR() { return 19; }

    _drawLampShell(i) {
        const x = this._lampX[i], y = this._lampY;
        const R = this._lampR();
        // 玻璃泡
        this._staticGroup.add(new Konva.Circle({
            x, y, radius: R, fill: '#e8eef4', stroke: '#5a6a7c', strokeWidth: 2,
        }));
        // 灯丝
        this._staticGroup.add(new Konva.Line({
            points: [x - 9, y, x - 5, y - 7, x, y, x + 5, y - 7, x + 9, y],
            stroke: '#888', strokeWidth: 1.5, tension: 0.3,
        }));
    }

    _drawButtonBase(cx, y, color) {
        // 按钮帽：倒山字绕几何中心 (cx, y-7) 旋转，开口朝左（背向动触臂）
        // 形状：左侧竖直长杆 x=cx-7（y-17..y+3，总高 20 = 原 2/3），三条横杆向右伸出，中杆最长
        //   帽中心线 = y-7 与动触臂中央（axisY - arm/2）水平对齐
        this._staticGroup.add(new Konva.Line({
            points: [cx - 7, y - 17, cx - 7, y + 3], stroke: color, strokeWidth: 2.5,
        }));
        this._staticGroup.add(new Konva.Line({
            points: [cx - 7, y - 17, cx + 2, y - 17], stroke: color, strokeWidth: 2,
        }));
        this._staticGroup.add(new Konva.Line({
            points: [cx - 7, y - 7, cx + 7, y - 7], stroke: color, strokeWidth: 2,
        }));
        this._staticGroup.add(new Konva.Line({
            points: [cx - 7, y + 3, cx + 2, y + 3], stroke: color, strokeWidth: 2,
        }));
    }

    // ═══════════════════════════════════
    // 动态节点
    // ═══════════════════════════════════
    _createDynamicNodes() {
        const W = this.width;

        // —— 三只灯的热光 + RMS 电压标签 ——
        this._glow = [];
        this._volLabel = [];
        for (let i = 0; i < 3; i++) {
            const R = this._lampR();
            const glow = new Konva.Circle({
                x: this._lampX[i], y: this._lampY, radius: R + 4,
                fill: '#000000', opacity: 0, listening: false,
            });
            this._dynamicGroup.add(glow);
            this._glow.push(glow);

            const lbl = new Konva.Text({
                x: this._lampX[i] - 32, y: this._lampY + R + 2, width: 64,
                text: '0V', fontSize: 11, fill: '#8fa3bd', align: 'center', listening: false,
            });
            this._dynamicGroup.add(lbl);
            this._volLabel.push(lbl);
        }

        // —— 常开按钮刀片（竖放：绕下触点旋转，常态抬(-22.5°)断开，按下竖直(0°)搭接）——
        const cx = this._cx;
        this._btnBlade = new Konva.Group({ x: cx, y: this._btnAxisY, rotation: -22.5 });
        this._btnBlade.add(new Konva.Line({
            points: [0, 0, 0, -this._btnArm], stroke: '#d03030', strokeWidth: 2.5, lineCap: 'round',
        }));
        this._btnBlade.add(new Konva.Circle({ x: 0, y: -this._btnArm, radius: 3.5, fill: '#e8c86a' }));
        this._btnBlade.add(new Konva.Circle({ x: 0, y: 0, radius: 3.5, fill: '#e8c86a' }));
        this._dynamicGroup.add(this._btnBlade);

        // 按钮帽 → 动触臂中央 的动态虚线（随刀片旋转更新端点；起点为旋转后帽开口端）
        this._btnPlunger = new Konva.Line({
            points: [this._btnHatX + 7, this._btnHatBaseY - 7, cx, this._btnAxisY - this._btnArm / 2],
            stroke: '#20a030', strokeWidth: 1.5, dash: [3, 3], listening: false,
        });
        this._dynamicGroup.add(this._btnPlunger);

        // 状态文字（按钮右侧，竖直居中于按钮区；15px 粗体亮绿）
        this._modeText = new Konva.Text({
            x: cx + 24, y: this._btnTopY - 4, width: W - cx - 32,
            text: '', fontSize: 15, fill: '#35ff5a', fontStyle: 'bold', align: 'left',
            verticalAlign: 'middle', listening: false,
        });
        this._dynamicGroup.add(this._modeText);
    }

    // ═══════════════════════════════════
    // 交互
    // ═══════════════════════════════════
    _bindInteraction() {
        // —— 常开按钮（竖放：平时断开，按下闭合 → 接入绝缘检测）——
        // Hit 区域覆盖左侧帽与刀片（上触点上方 → 旋转轴下方）
        const hitBtn = new Konva.Rect({
            x: this._btnHatX - 20, y: this._btnTopY - 8,
            width: this._cx + 20 - (this._btnHatX - 20),
            height: this._btnAxisY + 12 - (this._btnTopY - 8),
            fill: 'transparent',
        });
        hitBtn.on('mousedown touchstart', (e) => {
            e.cancelBubble = true;
            if (!this._btnLocked) this._setBtnClosed(true);
        });
        hitBtn.on('mouseup touchend', (e) => {
            e.cancelBubble = true;
            if (!this._btnLocked) this._setBtnClosed(false);
        });
        hitBtn.on('mouseenter', () => { document.body.style.cursor = 'pointer'; });
        hitBtn.on('mouseleave', () => {
            document.body.style.cursor = 'default';
            if (this._btnClosed && !this._btnLocked) this._setBtnClosed(false);
        });
        this._interactGroup.add(hitBtn);
    }

    /** 设置按钮闭合状态（常开：true=闭合=绝缘检测） */
    _setBtnClosed(v) {
        this._btnClosed = !!v;
        this._btnBlade.rotation(this._btnClosed ? 0 : -22.5);
        this._updatePlunger();
        this._updateModeText();
        this.markDirty();
        this._refreshIfDirty();
    }

    /** 更新按钮帽 → 动触臂中央 虚线的端点（刀片中点在旋转坐标系下的全局位置） */
    _updatePlunger() {
        if (!this._btnPlunger || !this._btnBlade) return;
        const ang = this._btnBlade.rotation() * Math.PI / 180;
        const half = this._btnArm / 2;
        // 刀片方向为竖直向上（旋转前的局部点为 (0, -half)），绕轴 (0,0) 旋转
        const mx = this._cx + Math.sin(ang) * half;
        const my = this._btnAxisY - Math.cos(ang) * half;
        this._btnPlunger.points([this._btnHatX + 7, this._btnHatBaseY - 7, mx, my]);
    }

    _updateModeText() {
        // 按下按钮 → 显示测量状态；未按 → 试灯状态（不再显示各相绝缘数值）
        this._modeText.text(this._btnClosed ? '测量状态' : '试灯状态');
    }

    _fmtMeg(R) {
        if (R >= 1e6) return (R / 1e6).toFixed(1) + 'MΩ';
        if (R >= 1e3) return (R / 1e3).toFixed(1) + 'kΩ';
        return R.toFixed(0) + 'Ω';
    }

    // ═══════════════════════════════════
    // 状态查询与逻辑
    // ═══════════════════════════════════
    /** 配电箱某路出线开关是否闭合（0 基索引，getSwState） */
    _loadClosed(loadIdx) {
        const pdb = this.sys && this.sys.comps ? this.sys.comps['pdb1'] : null;
        if (pdb && typeof pdb.getSwState === 'function') {
            return pdb.getSwState(loadIdx) === 'on';
        }
        return true; // 无配电箱时视为全部闭合
    }

    /** 某相总绝缘（Ω）：所有开关闭合负载该相绝缘的并联 */
    _effInsul(phase) {
        let denom = 0;
        for (let ld = 0; ld < 3; ld++) {
            if (!this._loadClosed(ld)) continue;   // 开关断开 → 该负载不参与
            const R = this._loadInsul[ld][phase];
            if (R > 1e-3) denom += 1 / R;          // 0 视为短路（导纳无限大）→ 单相主导
            else return 0;                          // 短路绝缘 → 该相总绝缘 0
        }
        return denom > 0 ? 1 / denom : 1e9;         // 全部断开 → 视作 ∞（良好）
    }

    /** 三相总绝缘数组 */
    _effInsuls() {
        return [this._effInsul(0), this._effInsul(1), this._effInsul(2)];
    }

    /**
     * 亮度-绝缘映射（用户指定）：
     *  ≥0.1MΩ → 1.0 恒全亮；0.01M~0.1M → 1.0；0.001M~0.01M → 1.0→0.75；
     *  10Ω~1kΩ → 0.75→0；<10Ω → 0。对数分段线性。
     */
    static insFactor(R) {
        if (R >= 1e5) return 1.0;               // ≥0.1MΩ
        if (R <= 1e1) return 0.0;               // <10Ω 熄灭
        const L = Math.log10(R);
        if (L >= 4) return 1.0;                 // ≥0.01MΩ（10kΩ）
        if (L >= 3) return 0.75 + (L - 3) * 0.25; // 0.001M~0.01M（1kΩ~10kΩ）：0.75→1.0
        return (L - 1) * 0.375;                 // 10Ω~1kΩ：0→0.75
    }

    /**
     * 星点位移增强比（仅按下按钮时使用）。
     * V_N = -(U_a·Y_a+U_b·Y_b+U_c·Y_c)/(Y_a+Y_b+Y_c)，Y_i=1/R_eff_i
     * 返回 [ratio_0, ratio_1, ratio_2]：|U_i+V_N|/|U_i|，仅放大健康相（≥1），
     * 故障相自身比率 <1 时返回 1（亮度衰减交给 insFactor 曲线）。
     */
    _shiftRatios(Reff) {
        const U = 230;
        const pos = [
            { re: U, im: 0 },
            { re: -U / 2, im: -U * Math.sqrt(3) / 2 },
            { re: -U / 2, im: U * Math.sqrt(3) / 2 },
        ];
        const Y = Reff.map(R => (R > 1e3 ? 1 / R : 1 / Math.max(1e-3, R)));
        const SY = Y[0] + Y[1] + Y[2];
        if (SY < 1e-12) return [1, 1, 1];       // 绝缘极好 → 无位移

        let reSum = 0, imSum = 0;
        for (let i = 0; i < 3; i++) {
            reSum += pos[i].re * Y[i];
            imSum += pos[i].im * Y[i];
        }
        const vNre = -reSum / SY, vNim = -imSum / SY;

        return pos.map(p => {
            const re = p.re + vNre, im = p.im + vNim;
            const ratio = Math.sqrt(re * re + im * im) / U;
            return Math.min(1.15, Math.max(1, ratio));
        });
    }

    tick(dt) {
        const sv = this.sys && this.sys.voltageSolver;

        // 1. 读取三相对地瞬时电压 → RMS
        for (let i = 0; i < 3; i++) {
            let vInstant = 0;
            if (sv) {
                const cL = sv.portToCluster.get(`${this.id}_wire_l${i + 1}`);
                const cG = sv.portToCluster.get(`${this.id}_wire_gnd`);
                if (cL !== undefined && cG !== undefined) {
                    vInstant = (sv.nodeVoltages.get(cL) || 0) - (sv.nodeVoltages.get(cG) || 0);
                }
            }
            this._rmsBuffer[i].push(vInstant * vInstant);
            if (this._rmsBuffer[i].length > this._rmsWindow) {
                this._rmsBuffer[i].shift();
            }
            const sumSq = this._rmsBuffer[i].reduce((a, b) => a + b, 0);
            this._rmsV[i] = Math.sqrt(sumSq / this._rmsBuffer[i].length);
        }

        // 2. 计算各相基准亮度（对地电压归一化，230V 满亮）
        const baseVO = this._rmsV.map(v => Math.min(1.4, v / 230));

        // 3. 目标亮度
        const badCount = this._lampOK.filter(ok => !ok).length;
        const Reff = this._effInsuls();
        const ratios = this._btnClosed ? this._shiftRatios(Reff) : [1, 1, 1];

        for (let i = 0; i < 3; i++) {
            const ok = this._lampOK[i];
            let target;
            if (!ok) {
                target = 0;                                       // 灯损坏 → 恒不亮
            } else if (!this._btnClosed) {
                // 常态（星点悬空）：绝缘不参与，三灯按母线电压全亮
                if (badCount === 1) target = baseVO[i] * 0.866;   // 恰有一盏坏：另两盏串联承线电压，略暗
                else if (badCount >= 2) target = 0;               // 两盏以上坏：无回路全灭
                else target = baseVO[i];                          // 全好：满亮
            } else {
                // 绝缘检测：主曲线 insFactor + 星点位移增强（健康相略亮）
                target = baseVO[i] * InsulationIndicator.insFactor(Reff[i]) * ratios[i];
            }
            target = Math.min(1.4, Math.max(0, target));
            this._brightness[i] += (target - this._brightness[i]) * 0.1;

            // 4. 渲染
            if (this._brightness[i] < 0.01) {
                this._glow[i].opacity(0);
            } else {
                const t = Math.min(1, this._brightness[i]);
                const r = Math.min(255, 70 + Math.round(185 * t));
                const g = Math.min(255, 35 + Math.round(220 * t));
                const b = Math.min(255, Math.round(200 * Math.max(0, this._brightness[i] - 0.2) / 1.2));
                this._glow[i].fill(`rgb(${r},${g},${b})`);
                this._glow[i].opacity(0.25 + 0.75 * t);
            }
            this._volLabel[i].text(this._rmsV[i].toFixed(1) + 'V');
        }

        this._updateModeText();
        this.markDirty();
        this._refreshIfDirty();
    }

    // ═══════════════════════════════════
    // 公开 API
    // ═══════════════════════════════════
    /** 设置某负载某相绝缘电阻（Ω）：ld ∈ {0电机,1照明,2可调}，i ∈ {0,1,2} */
    setLoadInsul(ld, i, ohm) {
        ld = Math.max(0, Math.min(2, parseInt(ld) || 0));
        i  = Math.max(0, Math.min(2, parseInt(i) || 0));
        const v = parseFloat(ohm);
        this._loadInsul[ld][i] = Number.isFinite(v) ? Math.max(0, v) : 100e6;
    }

    /** 读取某负载某相绝缘电阻（Ω） */
    getLoadInsul(ld, i) {
        ld = Math.max(0, Math.min(2, parseInt(ld) || 0));
        i  = Math.max(0, Math.min(2, parseInt(i) || 0));
        return this._loadInsul[ld][i];
    }

    /** 读取某相总绝缘（Ω，含开关并联等效） */
    getInsulResistance(i) {
        return this._effInsul(Math.max(0, Math.min(2, parseInt(i) || 0)));
    }

    /** 设置某灯是否完好（false=损坏） */
    setLampOK(i, ok) {
        i = Math.max(0, Math.min(2, parseInt(i) || 0));
        this._lampOK[i] = !!ok;
    }

    /** 常开按钮是否处于闭合（绝缘检测）状态 */
    isButtonClosed() { return this._btnClosed; }

    /** 模拟锁定按钮闭合/断开（右键菜单用） */
    setButtonLocked(v) {
        this._btnLocked = !!v;
        this._setBtnClosed(this._btnLocked);
    }

    getButtonLocked() { return this._btnLocked; }

    /** 读取某相实测对地电压（RMS，V） */
    getPhaseVoltage(i) {
        return this._rmsV[Math.max(0, Math.min(2, parseInt(i) || 0))];
    }

    // ═══════════════════════════════════
    // 配置
    // ═══════════════════════════════════
    static _insulOptions() {
        return [
            { value: 100, label: '100 MΩ（极佳）' },
            { value: 10,  label: '10 MΩ（良好）' },
            { value: 1,   label: '1 MΩ（正常）' },
            { value: 0.1, label: '0.1 MΩ（全亮临界）' },
            { value: 0.05, label: '0.05 MΩ（绝缘低）' },
            { value: 0.001, label: '1 kΩ（明显变暗）' },
            { value: 0,   label: '0（对地短路）' },
        ];
    }

    getConfigFields() {
        const loadNames = ['电机', '照明', '可调负载'];
        const fields = [
            { label: '位号', key: 'id', type: 'text' },
            { label: '名称', key: 'label', type: 'text' },
        ];
        const opts = InsulationIndicator._insulOptions();
        const phases = ['A', 'B', 'C'];
        for (let ld = 0; ld < 3; ld++) {
            for (let ph = 0; ph < 3; ph++) {
                fields.push({
                    label: `${loadNames[ld]} ${phases[ph]} 相绝缘 (MΩ)`,
                    key: `loadInsul_${ld}_${ph}`, type: 'select', options: opts,
                    get: (comp) => comp._loadInsul[ld][ph] / 1e6,   // Ω → MΩ 供下拉回显
                });
            }
        }
        for (let i = 0; i < 3; i++) {
            fields.push({
                label: `L${i + 1} 灯`, key: `lampOK${i}`, type: 'select',
                options: [
                    { value: true,  label: '完好' },
                    { value: false, label: '损坏' },
                ],
                get: (comp) => comp._lampOK[i],
            });
        }
        return fields;
    }

    onConfigUpdate(cfg) {
        if (cfg.id !== undefined) this.id = cfg.id;
        if (cfg.label !== undefined) {
            this.label = cfg.label;
            this._titleText.text(this.label);
        }
        for (let ld = 0; ld < 3; ld++) {
            for (let ph = 0; ph < 3; ph++) {
                const k = `loadInsul_${ld}_${ph}`;
                if (cfg[k] !== undefined) {
                    const v = parseFloat(cfg[k]);
                    this._loadInsul[ld][ph] = v > 0 ? v * 1e6 : 0;   // MΩ → Ω（0 视为短路）
                }
            }
        }
        for (let i = 0; i < 3; i++) {
            if (cfg[`lampOK${i}`] !== undefined)
                this._lampOK[i] = (cfg[`lampOK${i}`] === true || cfg[`lampOK${i}`] === 'true');
        }
        this.config = { ...this.config, ...cfg };
        this.markDirty();
        this._refreshIfDirty();
    }

    // ═══════════════════════════════════
    // 右键菜单
    // ═══════════════════════════════════
    showContextMenu(evt) {
        const oldMenu = document.getElementById('comp-context-menu');
        if (oldMenu) oldMenu.remove();

        const menu = document.createElement('div');
        menu.id = 'comp-context-menu';
        menu.style = `position: fixed; top: ${evt.clientY}px; left: ${evt.clientX}px;
            background: white; border: 1px solid #ccc; border-radius: 4px;
            box-shadow: 2px 2px 10px rgba(0,0,0,0.2); z-index: 10000;
            padding: 5px 0; min-width: 140px; font-family: sans-serif; font-size: 14px;`;

        const createItem = (label, onClick) => {
            const item = document.createElement('div');
            item.innerText = label;
            item.style = 'padding: 8px 15px; cursor: pointer; transition: background 0.2s;';
            item.onmouseenter = () => item.style.background = '#f0f0f0';
            item.onmouseleave = () => item.style.background = 'transparent';
            item.onclick = () => { onClick(); menu.remove(); };
            return item;
        };

        menu.appendChild(createItem('向右旋转 90°', () => this.rotate(90)));
        menu.appendChild(createItem('向左旋转 90°', () => this.rotate(-90)));
        menu.appendChild(createItem('参数设置', () => this.showConfigDialog()));

        const locked = this.getButtonLocked();
        menu.appendChild(createItem(locked ? '解除按钮锁定' : '模拟锁定按钮（持续检测）', () => {
            this.setButtonLocked(!locked);
        }));

        this.sys.container.appendChild(menu);
        const closeMenu = () => { menu.remove(); window.removeEventListener('click', closeMenu); };
        window.addEventListener('click', closeMenu);
    }

    destroy() { super.destroy?.(); }
}