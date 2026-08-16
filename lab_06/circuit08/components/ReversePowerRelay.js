import { BaseComponent } from './BaseComponent.js';

/**
 * ReversePowerRelay — 逆功率继电器（Reverse Power Relay）仿真组件
 *
 * ═══ 工作原理 ════════════════════════════════════════════════════════
 *  逆功率继电器用于发电机保护。当发电机因原动机故障（如汽轮机跳闸、柴油机
 *  熄火）而进入电动机运行状态时，功率反向流动（发电机吸收电网功率），继电
 *  器检测到逆功率并经定时限延时后动作，断开主开关，防止原动机超速。
 *
 *  ── 测量原理 ────────────────────────────────────────────────────────
 *    P = U × I × cosφ
 *    · 电流线圈（I+/I-）串联于发电机输出线路，测量线路电流（0V 电压源法）
 *    · 电压线圈（U+/U-）并联于母线（线-中性线），测量电压
 *    · P > 0  → 发电机向电网输送功率（正功率，显示"正"）
 *    · P < 0  → 发电机吸收电网功率（逆功率，显示逆功率大小）
 *
 *  ── 定时限动作特性 ──────────────────────────────────────────────────
 *    动作值 = 额定功率 × 动作比例（默认 400kW × 8% = 32kW）
 *    延时    t = tMax（默认 10s，固定不变，与逆功率大小无关）
 *    只要逆功率 ≥ 动作值，经固定 10s 后动作。
 *
 *  ── 状态机 ──────────────────────────────────────────────────────────
 *    normal  : 无逆功率（或 < 动作值×0.95 回差）→ NC 闭合、NO 断开
 *    timing  : 逆功率 ≥ 动作值 → 固定倒计时 tMax，NC 闭合、NO 断开
 *    tripped : 倒计时归零 → NC 断开、NO 闭合，TRIP 灯亮，需手动复位
 *
 * ═══ 端口 ════════════════════════════════════════════════════════════
 *  ip  — I+（电流线圈正端，左下方）
 *  in  — I-（电流线圈负端，左下方）
 *  up  — U+（电压线圈正/发电机端，左下方）
 *  un  — U-（电压线圈负端，左下方）
 *  NO  — 常开触点
 *  NC  — 常闭触点
 *  COM — 公共触点
 */
export class ReversePowerRelay extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(180, config.width  || 200);
        this.height = Math.max(240, config.height || 280);

        this.type    = 'relay';
        this.special = 'REV-POWER';
        this.cache   = 'fixed';

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        this.config = {
            ratedPower:  this.ratedPower,
            actionRatio: this.actionRatio,
            tMax:        this.tMax,
        };

        // ── 端口（左侧 4 输入 + 右侧 3 输出） ──────────────────────────
        const pl = this._portInput;
        const po = this._portOutput;
        this.addPort(pl.ip.x, pl.ip.y, 'ip', 'wire', 'p');
        this.addPort(pl.in.x, pl.in.y, 'in', 'wire');
        this.addPort(pl.up.x, pl.up.y, 'up', 'wire', 'p');
        this.addPort(pl.un.x, pl.un.y, 'un', 'wire');
        this.addPort(po.no.x, po.no.y, 'NO', 'wire', 'p');
        this.addPort(po.nc.x, po.nc.y, 'NC', 'wire');
        this.addPort(po.com.x, po.com.y, 'COM', 'wire', 'p');
    }

    // ═══════════════════════════════════════════════════
    // 几何计算
    // ═══════════════════════════════════════════════════

    _recalcGeometry() {
        const W = this.width, H = this.height;

        // 左侧输入端口（圆心靠在左边缘，竖排对称，上方 U+ U-、下方 I+ I-）
        const iX = 0;
        const iGap = (H - 110) / 3;
        const iY0 = 58;
        this._portInput = {
            up: { x: iX,        y: iY0 },
            un: { x: iX,        y: iY0 + iGap },
            ip: { x: iX,        y: iY0 + iGap * 2 },
            in: { x: iX,        y: iY0 + iGap * 3 },
        };

        // 右侧输出端口（圆心靠在右边缘，NO/COM/NC 间距减半、垂直居中对称）
        const oX = W;
        const oGap = 42;
        const oCenter = H * 0.5;
        this._portOutput = {
            no:  { x: oX, y: oCenter - oGap },
            com: { x: oX, y: oCenter },
            nc:  { x: oX, y: oCenter + oGap },
        };

        // 显示面板（加宽，至触点机构左侧）
        this._pane = { x: 30, y: 42, w: 126, h: H - 124 };

        // 右侧触点机构（横向紧凑）
        this._contactCx = W - 26;
        this._contactCy = H * 0.5;

        // 状态 LED 与复位按钮（底部）
        this._led = {
            pwr:  { x: 50, y: H - 26 },
            trip: { x: 100, y: H - 26 },
        };
        this._resetBtn = { x: 138, y: H - 36, w: 48, h: 22 };
    }

    // ═══════════════════════════════════════════════════
    // 参数初始化
    // ═══════════════════════════════════════════════════

    _initParameters(config) {
        // ── 整定参数 ──────────────────────────────────────
        this.ratedPower = config.ratedPower !== undefined ? parseFloat(config.ratedPower) : 400;   // kW
        this.actionRatio = config.actionRatio !== undefined ? parseFloat(config.actionRatio) : 8;   // %
        this.tMax = config.tMax !== undefined ? parseFloat(config.tMax) : 10;                        // s（定时限延时）

        // 动作值（kW）与回差值
        this._actionPow = this.ratedPower * this.actionRatio / 100;
        this._releasePow = this._actionPow * 0.95;

        // 测量符号（方向校准，δ>0 发电机超前应为正功率；若实测相反则置 -1）
        this._sign = config.sign !== undefined ? config.sign : -1;

        // ── 运行状态 ──────────────────────────────────────
        this._state = 'normal';      // normal / timing / tripped
        this._countdown = 0;
        this._elapsed = 0;
        this._avgPower = 0;
        this._instantPower = 0;
        this._physCurrent = 0;

        // 功率滑动平均缓冲（40 帧 = 完整 50Hz 周期 @求解器 0.5ms/帧）
        // 求解器 deltaTime=0.5ms，50Hz 周期 20ms=40 帧，窗口必须覆盖整数个周期
        this._pBuf = new Float64Array(40);
        this._pIdx = 0;
        this._pCount = 0;
        this._pSum = 0;

        // 触点动画
        this._contactAnim = 0;
        this._contactAnimVel = 0;
        this._animTick = 0;
    }

    // ═══════════════════════════════════════════════════
    // 主初始化
    // ═══════════════════════════════════════════════════

    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
    }

    // ═══════════════════════════════════════════════════
    // 静态部件
    // ═══════════════════════════════════════════════════

    _drawStaticParts() {
        this._drawShell();
        this._drawPane();
        this._drawContactStatic();
        this._drawPortLabels();
        this._drawLEDStatic();
        this._drawResetBtnStatic();
    }

    _drawShell() {
        const W = this.width, H = this.height;
        this._staticGroup.add(new Konva.Rect({
            x: 2, y: 2, width: W - 4, height: H - 4,
            fill: '#e8e4da', stroke: '#7a7264', strokeWidth: 2, cornerRadius: 8,
        }));
        this._staticGroup.add(new Konva.Text({
            x: 10, y: 6, text: '逆功率继电器', fontSize: 15, fontStyle: 'bold',
            fill: '#20303c',
        }));
        this._staticGroup.add(new Konva.Text({
            x: W - 60, y: 6, text: 'RP-400', fontSize: 15,
            fill: '#706860',
        }));
    }

    _drawPane() {
        const p = this._pane;
        // 显示面板背景
        this._staticGroup.add(new Konva.Rect({
            x: p.x, y: p.y, width: p.w, height: p.h,
            fill: '#f2efe6', stroke: '#b8b0a0', strokeWidth: 1, cornerRadius: 4,
        }));

        // ── 方向指示条（正 / 逆） ──────────────────────
        const dirW = p.w - 14;
        this._staticGroup.add(new Konva.Rect({
            x: p.x + 7, y: p.y + 8, width: dirW, height: 38,
            fill: '#ffffff', stroke: '#908878', strokeWidth: 1, cornerRadius: 3,
        }));
        this._staticGroup.add(new Konva.Text({
            x: p.x + 11, y: p.y + 16, text: '方向', fontSize: 13,
            fill: '#706860',
        }));

        // ── 功率数值框 ──────────────────────────────────
        this._staticGroup.add(new Konva.Text({
            x: p.x + 7, y: p.y + 56, text: '功率', fontSize: 13,
            fill: '#706860',
        }));
        this._staticGroup.add(new Konva.Rect({
            x: p.x + 7, y: p.y + 72, width: dirW, height: 46,
            fill: '#1a2a3a', stroke: '#0a1520', strokeWidth: 1, cornerRadius: 3,
        }));

        // ── 倒计时框 ────────────────────────────────────
        this._staticGroup.add(new Konva.Text({
            x: p.x + 7, y: p.y + 128, text: '延时', fontSize: 13,
            fill: '#706860',
        }));
        this._staticGroup.add(new Konva.Rect({
            x: p.x + 7, y: p.y + 144, width: dirW, height: 40,
            fill: '#241f1a', stroke: '#0f0c08', strokeWidth: 1, cornerRadius: 3,
        }));
    }

    _drawContactStatic() {
        const cx = this._contactCx;
        const po = this._portOutput;

        // 触点引出线（从端口到机构）
        const leadLen = 12;
        this._staticGroup.add(new Konva.Line({
            points: [po.no.x - leadLen, po.no.y, po.no.x, po.no.y],
            stroke: '#605040', strokeWidth: 2, listening: false,
        }));
        this._staticGroup.add(new Konva.Line({
            points: [po.nc.x - leadLen, po.nc.y, po.nc.x, po.nc.y],
            stroke: '#605040', strokeWidth: 2, listening: false,
        }));
        this._staticGroup.add(new Konva.Line({
            points: [po.com.x - leadLen, po.com.y, po.com.x, po.com.y],
            stroke: '#605040', strokeWidth: 2, listening: false,
        }));

        // 静触点位置（NO 上、NC 下，动触点 COM 在中间）
        const px = cx - 10;
        const noY = po.no.y;
        const ncY = po.nc.y;
        const comY = (noY + ncY) / 2;

        this._noStaticPos = { x: px, y: noY };
        this._ncStaticPos = { x: px, y: ncY };
        this._comStaticPos = { x: cx + 3, y: comY };

        // 静触点圆（NO 绿色描边、NC 红色描边）
        this._staticGroup.add(new Konva.Circle({
            x: px, y: noY, radius: 4, fill: '#e8e0d0',
            stroke: '#20a030', strokeWidth: 2, listening: false,
        }));
        this._staticGroup.add(new Konva.Circle({
            x: px, y: ncY, radius: 4, fill: '#e8e0d0',
            stroke: '#d03020', strokeWidth: 2, listening: false,
        }));

        // 静触点接线
        this._staticGroup.add(new Konva.Line({
            points: [po.no.x - leadLen, po.no.y, px, po.no.y],
            stroke: '#605040', strokeWidth: 2, listening: false,
        }));
        this._staticGroup.add(new Konva.Line({
            points: [po.nc.x - leadLen, po.nc.y, px, po.nc.y],
            stroke: '#605040', strokeWidth: 2, listening: false,
        }));

        // COM 动触点机构（横梁）
        this._staticGroup.add(new Konva.Line({
            points: [cx + 3, comY, po.com.x - leadLen, po.com.y],
            stroke: '#605040', strokeWidth: 2, listening: false,
        }));
        this._staticGroup.add(new Konva.Circle({
            x: cx + 3, y: comY, radius: 3.5, fill: '#c0b8a0',
            stroke: '#706050', strokeWidth: 1.5, listening: false,
        }));

        // 端口编号标签
        this._staticGroup.add(new Konva.Text({
            x: po.no.x - 30, y: po.no.y - 16, text: 'NO', fontSize: 11, fontStyle: 'bold',
            fill: '#208020', listening: false,
        }));
        this._staticGroup.add(new Konva.Text({
            x: po.nc.x - 30, y: po.nc.y - 16, text: 'NC', fontSize: 11, fontStyle: 'bold',
            fill: '#d03020', listening: false,
        }));
        this._staticGroup.add(new Konva.Text({
            x: po.com.x - 30, y: po.com.y - 16, text: 'COM', fontSize: 11, fontStyle: 'bold',
            fill: '#504030', listening: false,
        }));
    }

    _drawPortLabels() {
        const pl = this._portInput;
        const fs = 12;
        this._staticGroup.add(new Konva.Text({
            x: pl.ip.x + 10, y: pl.ip.y - 16, text: 'I+', fontSize: fs, fontStyle: 'bold',
            fill: '#c02020', listening: false,
        }));
        this._staticGroup.add(new Konva.Text({
            x: pl.in.x + 10, y: pl.in.y - 16, text: 'I-', fontSize: fs, fontStyle: 'bold',
            fill: '#202020', listening: false,
        }));
        this._staticGroup.add(new Konva.Text({
            x: pl.up.x + 10, y: pl.up.y - 16, text: 'U+', fontSize: fs, fontStyle: 'bold',
            fill: '#2060c0', listening: false,
        }));
        this._staticGroup.add(new Konva.Text({
            x: pl.un.x + 10, y: pl.un.y - 16, text: 'U-', fontSize: fs, fontStyle: 'bold',
            fill: '#202020', listening: false,
        }));
    }

    _drawLEDStatic() {
        const l = this._led;
        this._staticGroup.add(new Konva.Text({
            x: l.pwr.x - 18, y: l.pwr.y - 22, text: '电源', fontSize: 14,
            width: 36, align: 'center', fill: '#706860', listening: false,
        }));
        this._staticGroup.add(new Konva.Text({
            x: l.trip.x - 18, y: l.trip.y - 22, text: '动作', fontSize: 14,
            width: 36, align: 'center', fill: '#706860', listening: false,
        }));
    }

    _drawResetBtnStatic() {
        const b = this._resetBtn;
        this._staticGroup.add(new Konva.Rect({
            x: b.x, y: b.y, width: b.w, height: b.h,
            fill: '#c8c2b4', stroke: '#8a8272', strokeWidth: 1.5, cornerRadius: 4,
        }));
        this._staticGroup.add(new Konva.Text({
            x: b.x + 4, y: b.y + 4, text: '复位', fontSize: 12, fontStyle: 'bold',
            fill: '#504838', width: b.w - 8, align: 'center', listening: false,
        }));
    }

    // ═══════════════════════════════════════════════════
    // 动态节点（一次创建，tick 中 in-place 更新）
    // ═══════════════════════════════════════════════════

    _createDynamicNodes() {
        const p = this._pane;

        // 方向指示文字
        this._dirText = new Konva.Text({
            x: p.x + 7, y: p.y + 16,
            text: '正', fontSize: 20, fontStyle: 'bold',
            fill: '#20a030', width: p.w - 14, align: 'center', listening: false,
        });
        this._dynamicGroup.add(this._dirText);

        // 功率数字
        this._powerText = new Konva.Text({
            x: p.x + 10, y: p.y + 74,
            text: '0.0', fontSize: 24, fontFamily: 'Courier New', fontStyle: 'bold',
            fill: '#40ffa0', width: p.w - 20, align: 'center', listening: false,
        });
        this._powerTextUnit = new Konva.Text({
            x: p.x + 7, y: p.y + 100, text: 'kW', fontSize: 13,
            fill: '#70d0a0', align: 'center', width: p.w - 14, listening: false,
        });
        this._dynamicGroup.add(this._powerText, this._powerTextUnit);

        // 倒计时数字
        this._cdText = new Konva.Text({
            x: p.x + 10, y: p.y + 150,
            text: '--', fontSize: 18, fontFamily: 'Courier New', fontStyle: 'bold',
            fill: '#ffb040', width: p.w - 20, align: 'center', listening: false,
        });
        this._dynamicGroup.add(this._cdText);

        // LED（电源 / 动作）
        this._ledPwr = new Konva.Circle({
            x: this._led.pwr.x, y: this._led.pwr.y, radius: 5,
            fill: '#101010', listening: false,
        });
        this._ledTrip = new Konva.Circle({
            x: this._led.trip.x, y: this._led.trip.y, radius: 5,
            fill: '#101010', listening: false,
        });
        this._dynamicGroup.add(this._ledPwr, this._ledTrip);

        // 动触臂（COM 簧片）
        this._contactArm = new Konva.Line({
            points: [0, 0, 0, 0],
            stroke: '#403830', strokeWidth: 3, lineCap: 'round', listening: false,
        });
        this._dynamicGroup.add(this._contactArm);
        this._contactDot = new Konva.Circle({
            x: 0, y: 0, radius: 4,
            fill: '#807050', stroke: '#403020', strokeWidth: 1, listening: false,
        });
        this._dynamicGroup.add(this._contactDot);

        this._updateContactVisual();
    }

    // ═══════════════════════════════════════════════════
    // 交互：复位按钮
    // ═══════════════════════════════════════════════════

    _bindInteraction() {
        const b = this._resetBtn;
        this.addClickablePart('reset-btn', b.x, b.y, b.w, b.h);
        // addClickablePart 创建的 Group 无 name，取最后一个交互 Group 的命中层绑定复位
        const groups = this._interactGroup.getChildren();
        const grp = groups[groups.length - 1];
        const hit = grp && grp.getChildren ? grp.getChildren()[1] : null;
        if (hit) {
            hit.on('click tap', (e) => {
                e.cancelBubble = true;
                this.reset();
            });
        }
    }

    // ═══════════════════════════════════════════════════
    // 定时限特性
    // ═══════════════════════════════════════════════════

    /**
     * 定时限延时：固定返回 tMax（s），与逆功率大小无关。
     */
    _calcDelay() {
        return this.tMax;
    }

    // ═══════════════════════════════════════════════════
    // 主循环
    // ═══════════════════════════════════════════════════

    tick(dt) {
        this._animTick += dt;

        // ── 从电路测量瞬时功率（电压 × 电流，滑动平均） ──────
        let v = 0, i = 0;
        if (this.sys && typeof this.sys.getVoltageBetween === 'function') {
            v = this.sys.getVoltageBetween(`${this.id}_wire_up`, `${this.id}_wire_un`);
        }
        if (this.sys && this.sys.voltageSolver) {
            i = this.physCurrent || 0;
        }
        this._physCurrent = i;
        this._instantPower = v * i;

        // 滑动平均（1s 窗口，50Hz 整周期 → 得到有功功率，含符号）
        const buf = this._pBuf;
        this._pSum -= buf[this._pIdx];
        buf[this._pIdx] = this._instantPower;
        this._pSum += buf[this._pIdx];
        this._pIdx = (this._pIdx + 1) % buf.length;
        if (this._pCount < buf.length) this._pCount++;
        const avg = this._pCount > 0 ? (this._pSum / this._pCount) : 0;

        // 单位换算：W → kW，并应用方向符号
        this._avgPower = avg / 1000 * this._sign;

        // ── 状态机 ──────────────────────────────────────────
        const reverseP = -this._avgPower;   // 逆功率为正
        const isReverse = reverseP > this._releasePow;

        if (this._state === 'normal') {
            if (isReverse && reverseP >= this._actionPow) {
                this._state = 'timing';
                this._countdown = this._calcDelay();
            }
        } else if (this._state === 'timing') {
            if (!isReverse) {
                // 逆功率消失 → 复归
                this._state = 'normal';
                this._countdown = 0;
            } else {
                this._countdown -= dt;
                if (this._countdown <= 0) {
                    this._countdown = 0;
                    this._state = 'tripped';
                }
            }
        } else if (this._state === 'tripped') {
            // 保持跳闸状态，需手动复位
        }

        // ── 触点动画 ────────────────────────────────────────
        const target = this._state === 'tripped' ? 1 : 0;
        const diff = target - this._contactAnim;
        if (Math.abs(diff) > 0.001) {
            this._contactAnimVel += diff * 30 * dt;
            this._contactAnimVel *= 0.82;
            this._contactAnim += this._contactAnimVel;
            this._contactAnim = Math.max(0, Math.min(1, this._contactAnim));
        } else {
            this._contactAnim = target;
            this._contactAnimVel = 0;
        }

        this._updateDynamic();
        this.markDirty();
        this._refreshIfDirty();
        if (this.sys && typeof this.sys.requestRedraw === 'function') {
            this.sys.requestRedraw();
        }
    }

    // ═══════════════════════════════════════════════════
    // 动态更新
    // ═══════════════════════════════════════════════════

    _updateDynamic() {
        const reverseP = -this._avgPower;
        const isReverse = reverseP > 1;

        // 方向指示
        if (this._state === 'tripped' || this._state === 'timing') {
            this._dirText.text('逆');
            this._dirText.fill('#d03020');
        } else if (isReverse) {
            this._dirText.text('逆');
            this._dirText.fill('#d03020');
        } else {
            this._dirText.text('正');
            this._dirText.fill('#20a030');
        }

        // 功率显示（正功率显示正向功率；逆功率显示逆功大小）
        const disp = this._state === 'tripped' || this._state === 'timing' || isReverse
            ? reverseP : this._avgPower;
        this._powerText.text(`${disp.toFixed(1)}`);
        this._powerText.fill(this._state === 'tripped' ? '#ff4040' : '#40ffa0');
        this._powerTextUnit.fill(this._state === 'tripped' ? '#ff4040' : '#70d0a0');

        // 倒计时显示
        if (this._state === 'timing') {
            this._cdText.text(`延时 ${this._countdown.toFixed(1)} s`);
        } else if (this._state === 'tripped') {
            this._cdText.text('已动作');
        } else {
            this._cdText.text('--');
        }

        // LED
        const energized = Math.abs(this._avgPower) > 1;
        this._ledPwr.fill(energized ? '#20c020' : '#101010');
        this._ledTrip.fill(this._state === 'tripped' ? '#ff3020' : '#101010');
        if (this._state === 'timing' && Math.sin(this._animTick * 8) > 0) {
            this._ledTrip.fill('#ff8050');
        }

        this._updateContactVisual();
    }

    /** 动触臂（COM）在 NC 与 NO 之间摆动 */
    _updateContactVisual() {
        const no = this._noStaticPos;
        const nc = this._ncStaticPos;
        const com = this._comStaticPos;
        const t = this._contactAnim;

        const mx = nc.x + (no.x - nc.x) * t;
        const my = nc.y + (no.y - nc.y) * t;

        this._contactArm.points([com.x, com.y, mx, my]);
        this._contactDot.position({ x: mx, y: my });
    }

    // ═══════════════════════════════════════════════════
    // 公开 API
    // ═══════════════════════════════════════════════════

    getState()         { return this._state; }
    getPower()         { return this._avgPower; }
    getReversePower()  { return Math.max(0, -this._avgPower); }
    getCountdown()     { return this._state === 'timing' ? this._countdown : 0; }
    isTripped()        { return this._state === 'tripped'; }
    getActionPower()   { return this._actionPow; }

    /** 手动复位（tripped → normal） */
    reset() {
        if (this._state !== 'tripped') return;
        this._state = 'normal';
        this._countdown = 0;
        this._elapsed = 0;
        if (this.sys && typeof this.sys.requestRedraw === 'function') {
            this.sys.requestRedraw();
        }
    }

    // ═══════════════════════════════════════════════════
    // 配置界面
    // ═══════════════════════════════════════════════════

    getConfigFields() {
        return [
            { label: '额定功率 (kW)', key: 'ratedPower', type: 'number' },
            { label: '动作比例 (%)', key: 'actionRatio', type: 'number' },
            { label: '定时限延时 (s)', key: 'tMax', type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.ratedPower !== undefined) this.ratedPower = parseFloat(cfg.ratedPower) || 400;
        if (cfg.actionRatio !== undefined) this.actionRatio = parseFloat(cfg.actionRatio) || 8;
        if (cfg.tMax !== undefined) this.tMax = parseFloat(cfg.tMax) || 10;

        this._actionPow = this.ratedPower * this.actionRatio / 100;
        this._releasePow = this._actionPow * 0.95;

        this.config = { ...this.config, ...cfg };

        this._recalcGeometry();
        this._staticGroup.destroyChildren();
        this._dynamicGroup.destroyChildren();
        this._drawStaticParts();
        this._createDynamicNodes();
        this._refreshCache?.();
    }

    destroy() {
        super.destroy?.();
    }
}
