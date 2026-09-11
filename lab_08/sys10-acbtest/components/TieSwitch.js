import { DiagramThreePhaseACB } from './DiagramThreePhaseACB.js';

/**
 * TieSwitch 联络开关（母联开关，三相）
 *
 * 外观与 DiagramThreePhaseACB（三相空气断路器原理图）一致：
 * 刀闸叶片 + 上下静触点 + L/T 端子 + 过流脱扣。
 *
 * 与空气断路器的区别：
 *   1) 不能手动操纵 —— 移除点击刀片合/分闸的交互；
 *   2) 右侧端口带上下三个线圈：
 *        · 分励线圈 fla/flb（最上）：通电 → 跳闸（trip）；
 *        · 失压线圈 uv1/uv2（中间）：得电允许合闸；失电 → 跳闸；
 *        · 合闸线圈 c1/c2（最下）：通电 → 合闸（close）；
 *      均由外加控制信号（端口电压差）驱动，电气逻辑同 MarineMainsSwitch。
 *   3) trip 后无需手动复位：合闸线圈再次通电可直接从 trip 合闸。
 *
 * 几何：高度增加（默认 200），中间刀片大小不变（锁定 35.2），
 *       两端引线长度加倍（≈原 2 倍），右边宽度比默认宽 10px、左边加宽 5px。
 *
 * 端口布局：
 *   顶部：l1/l2/l3（主回路进线）   底部：t1/t2/t3（主回路出线）
 *   左侧：nc1/nc2（常闭辅助触点，随主开关状态变化）
 *   右侧：fla/flb（分励）、uv1/uv2（失压）、c1/c2（合闸）三对线圈
 */
export class TieSwitch extends DiagramThreePhaseACB {
    constructor(config, sys) {
        // 高度增加（默认 200），右边宽度 +10px、左边加宽 5px（总 +15px）
        super({ ...config, width: (config.width || 150) + 15, height: config.height || 200 }, sys);

        // 左侧常闭辅助触点端口
        this.addPort(this._ncPort1.x, this._ncPort1.y, 'nc1', 'wire');
        this.addPort(this._ncPort2.x, this._ncPort2.y, 'nc2', 'wire');
        // 右侧控制端口：分励线圈（上）+ 失压线圈（中）+ 合闸线圈（下）
        this.addPort(this._portFla.x, this._portFla.y, 'fla', 'wire');
        this.addPort(this._portFlb.x, this._portFlb.y, 'flb', 'wire');
        this.addPort(this._portUv1.x, this._portUv1.y, 'uv1', 'wire');
        this.addPort(this._portUv2.x, this._portUv2.y, 'uv2', 'wire');
        this.addPort(this._portC1.x,  this._portC1.y,  'c1',  'wire');
        this.addPort(this._portC2.x,  this._portC2.y,  'c2',  'wire');

        this.config = {
            ...this.config,
            closeCoilR:       this._closeCoilR,
            uvCoilR:          this._uvCoilR,
            ratedCtrlVoltage: this.ratedCtrlVoltage,
        };
    }

    // ═══════════════════════════════════════════
    // 几何：右侧端口带（分励 + 失压 + 合闸线圈）
    // ═══════════════════════════════════════════

    _recalcGeometry() {
        super._recalcGeometry();

        const W = this.width, H = this.height;
        // 中间开关（刀片/触头）大小不变：锁定为默认高度 120 下的刀片长度（≈35.2）
        const baseH = 120;
        const fixedBlade = baseH * 0.44 * 2 / 3;
        this._bladeLen = fixedBlade;
        this._contactInY = (H - fixedBlade) / 2;
        this._contactOutY = (H + fixedBlade) / 2;

        // 左侧常闭辅助触点带：主回路极位整体右移，腾出左侧空间
        const leftBand = 28;
        const coilW = 20;
        this._poleXs = Array.from({ length: 3 }, (_, i) => leftBand + (W - leftBand - coilW) * (i + 0.45) / 3);
        // 上下 6 个主回路端口需随极位右移同步更新（否则与引线错位）
        this._portL = this._poleXs.map(px => ({ x: px, y: 2 }));
        this._portT = this._poleXs.map(px => ({ x: px, y: H - 2 }));

        // 左侧常闭辅助触点（nc1 上 / nc2 下，垂直排列）
        this._ncPort1 = { x: 0, y: H * 0.42 };
        this._ncPort2 = { x: 0, y: H * 0.58 };
        this._ncSta1  = { x: 14, y: H * 0.42 };
        this._ncSta2  = { x: 14, y: H * 0.58 };

        // 右侧端口带：三对线圈均匀分布（H=200 时：fla=30/55、uv1=92/117、c1=154/179）
        // 分励（上）→ 失压（中）→ 合闸（下），线圈长度约 19px（原 13.2 增长约 5px）
        this._portFla = { x: W - 2, y: H * 0.15 };
        this._portFlb = { x: W - 2, y: H * 0.275 };
        this._portUv1 = { x: W - 2, y: H * 0.46 };
        this._portUv2 = { x: W - 2, y: H * 0.585 };
        this._portC1  = { x: W - 2, y: H * 0.77 };
        this._portC2  = { x: W - 2, y: H * 0.895 };
    }

    // ═══════════════════════════════════════════
    // 参数：线圈电流阈值（额定控制电压 / 线圈电阻 × 85% 吸合）
    // ═══════════════════════════════════════════

    _initParameters(config) {
        super._initParameters(config);

        this.ratedCtrlVoltage = config.ratedCtrlVoltage !== undefined ? config.ratedCtrlVoltage : 24; // V
        this._closeCoilR      = config.closeCoilR      !== undefined ? config.closeCoilR      : 200;  // 合闸线圈电阻 Ω
        this._uvCoilR         = config.uvCoilR         !== undefined ? config.uvCoilR         : 2000; // 失压线圈电阻 Ω
        // 分励线圈电阻沿用父类 _tripCoilR（默认 50Ω）

        this._coilOhm = { fl: this._tripCoilR, uv: this._uvCoilR, c: this._closeCoilR };
        this._coilI   = { fl: 0, uv: 0, c: 0 };
        this._pickupI = {};
        this._dropoutI = {};
        this._uvOn    = false; // 失压线圈吸合标志
        this._recalcThresholds();
    }

    /** 重新计算线圈吸合/释放阈值 */
    _recalcThresholds() {
        ['fl', 'uv', 'c'].forEach(k => {
            const R = this._coilOhm[k];
            const Irated = R > 0 ? this.ratedCtrlVoltage / R : 0;
            this._pickupI[k]  = Irated * 0.85; // 85% 吸合
            this._dropoutI[k] = Irated * 0.75; // 75% 释放（滞回）
        });
    }

    // ═══════════════════════════════════════════
    // 静态绘制：分励线圈 + 失压线圈 + 合闸线圈（右侧端口带）
    // ═══════════════════════════════════════════

    _drawStaticParts() {
        super._drawStaticParts();
        this._drawAuxContactsStatic();
        this._drawCoil(this._portFla, this._portFlb, '分励');
        this._drawCoil(this._portUv1, this._portUv2, '失压');
        this._drawCoil(this._portC1,  this._portC2,  '合闸');
    }

    /** 左侧常闭辅助触点静态部分：静触点圆点 + 端口引线 + 竖排「常闭」标签 */
    _drawAuxContactsStatic() {
        const s = this._staticGroup;
        const c1 = this._ncSta1, c2 = this._ncSta2;
        // 静触点（上下两个）
        [c1, c2].forEach(p => {
            s.add(new Konva.Circle({ x: p.x, y: p.y, radius: 4, fill: '#c8a020', stroke: '#6a5a28', strokeWidth: 1 }));
        });
        // 端口 → 静触点 引线
        s.add(new Konva.Line({ points: [0, this._ncPort1.y, c1.x, c1.y], stroke: '#7a6a5a', strokeWidth: 1.5, lineCap: 'round' }));
        s.add(new Konva.Line({ points: [0, this._ncPort2.y, c2.x, c2.y], stroke: '#7a6a5a', strokeWidth: 1.5, lineCap: 'round' }));
        // 竖排「常闭」标签（静触点右侧）
        const ly = (c1.y + c2.y) / 2 - 9;
        s.add(new Konva.Text({ x: -18, y: ly-2, text: '常', fontSize: 12, fontStyle: 'bold', fill: '#f40404' }));
        s.add(new Konva.Text({ x: -18, y: ly + 12, text: '闭', fontSize: 12, fontStyle: 'bold', fill: '#f40404' }));
    }

    /** 右侧线圈符号：上下两端口之间画垂直波浪线圈 + 引线 + 标签 */
    _drawCoil(pa, pb, label) {
        const coilCX = this.width - 16;
        const top = pa.y + 3, bot = pb.y - 3;
        const coilH = bot - top;
        const halfW = Math.max(3, this.width * 0.03);
        const loops = 4;

        const pts = [];
        const steps = loops * 16;
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const y = top + t * coilH;
            const x = coilCX + halfW * Math.cos(t * loops * Math.PI * 2);
            pts.push(x, y);
        }
        this._staticGroup.add(new Konva.Line({
            points: pts,
            stroke: '#4a3828', strokeWidth: 1.2,
            tension: 0.3, listening: false,
        }));
        // 引线：线圈 → 上下端口
        this._staticGroup.add(new Konva.Line({
            points: [coilCX + halfW, top, pa.x, pa.y],
            stroke: '#6a5a28', strokeWidth: 1.5, listening: false,
        }));
        this._staticGroup.add(new Konva.Line({
            points: [coilCX + halfW, bot, pb.x, pb.y],
            stroke: '#6a5a28', strokeWidth: 1.5, listening: false,
        }));
        // 标签（线圈右侧）
        this._staticGroup.add(new Konva.Text({
            x: this.width - 34, y: (pa.y + pb.y) / 2 - 24,
            width: 30, align: 'center',
            text: label, fontSize: 12, fill: '#f50505', fontStyle: 'bold', listening: false,
        }));
    }

    // ═══════════════════════════════════════════
    // 交互：不能手动操纵（覆写为空，移除点击刀片合/分闸）
    // ═══════════════════════════════════════════

    _bindInteraction() {
        // 联络开关由外加信号（分励/失压/合闸线圈）控制，不可手动操纵
    }

    // ═══════════════════════════════════════════
    // 仿真主循环：继承动画/过流脱扣 + 线圈驱动
    // ═══════════════════════════════════════════

    tick(dt) {
        this._senseCoils();
        super.tick(dt);
    }

    _createDynamicNodes() {
        super._createDynamicNodes();
        this._createAuxContacts();
    }

    /** 左侧常闭辅助触点动态触桥：原点在下静触点，向上延伸；分闸闭合、合闸断开 */
    _createAuxContacts() {
        const c1 = this._ncSta1, c2 = this._ncSta2;
        const g = new Konva.Group({ x: c2.x, y: c2.y, rotation: 0, listening: false });
        g.add(new Konva.Line({ points: [0, 0, 0, -(c2.y - c1.y)], stroke: '#2f3542', strokeWidth: 4, lineCap: 'round' }));
        g.add(new Konva.Circle({ x: 0, y: -(c2.y - c1.y), radius: 4.5, fill: '#f0c860', stroke: '#6a5a28', strokeWidth: 1 }));
        this._dynamicGroup.add(g);
        this._ncBridge = g;
    }

    _updateDynamic() {
        super._updateDynamic();
        if (this._ncBridge) {
            // NC 常闭辅助触点：分闸（off/trip）闭合 0°；合闸（on）断开 25°
            const closed = !this._animating && this._state === 'on';
            this._ncBridge.rotation(closed ? 25 : 0);
        }
    }

    /** 线圈检测：分励通电→跳闸；失压失电→跳闸；失压得电+合闸线圈通电→合闸 */
    _senseCoils() {
        const solver = this.sys && this.sys.voltageSolver;
        if (!solver) return;
        [['fl', 'fla', 'flb'], ['uv', 'uv1', 'uv2'], ['c', 'c1', 'c2']].forEach(([k, a, b]) => {
            const v = this.sys.getVoltageBetween(`${this.id}_wire_${a}`, `${this.id}_wire_${b}`);
            this._coilI[k] = (v !== undefined && isFinite(v)) ? v / this._coilOhm[k] : 0;
        });
        // 失压线圈吸合判定（滞回）
        if (!this._uvOn && this._coilI.uv >= this._pickupI.uv) this._uvOn = true;
        else if (this._uvOn && this._coilI.uv < this._dropoutI.uv) this._uvOn = false;

        // 分励通电 → 跳闸（合闸状态有效；trip 状态不重复触发）
        if (this._coilI.fl >= this._pickupI.fl && this._state === 'on') {
            this.trip();
        }
        // 失压失电 → 跳闸（合闸状态有效）
        if (!this._uvOn && this._state === 'on') {
            this.trip();
        }
        // 失压得电 + 合闸线圈通电 → 合闸（off 或 trip 均可直接合闸）
        if (this._uvOn && this._coilI.c >= this._pickupI.c && this._state !== 'on') {
            this.close();
        }
    }

    // ═══════════════════════════════════════════
    // 合闸：允许从 trip 状态直接合闸（无需手动复位）
    // ═══════════════════════════════════════════

    close() {
        if (this._animating || this._state === 'on') return;
        this._animDur = this.config.animDur || 0.10;
        this._startAnim('on');
    }

    // ═══════════════════════════════════════════
    // 配置对话框
    // ═══════════════════════════════════════════

    getConfigFields() {
        return [
            ...super.getConfigFields().filter(f => f.key !== 'tripCoilR'),
            { label: '控制回路额定电压 (V)', key: 'ratedCtrlVoltage', type: 'number' },
            { label: '分励线圈电阻 (Ω)',      key: 'tripCoilR',        type: 'number' },
            { label: '失压线圈电阻 (Ω)',      key: 'uvCoilR',          type: 'number' },
            { label: '合闸线圈电阻 (Ω)',      key: 'closeCoilR',       type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.ratedCtrlVoltage !== undefined) { this.ratedCtrlVoltage = parseFloat(cfg.ratedCtrlVoltage); this._recalcThresholds(); }
        if (cfg.tripCoilR !== undefined)        { this._tripCoilR = parseFloat(cfg.tripCoilR); this._coilOhm.fl = this._tripCoilR; this._recalcThresholds(); }
        if (cfg.uvCoilR !== undefined)          { this._uvCoilR = parseFloat(cfg.uvCoilR); this._coilOhm.uv = this._uvCoilR; this._recalcThresholds(); }
        if (cfg.closeCoilR !== undefined)       { this._closeCoilR = parseFloat(cfg.closeCoilR); this._coilOhm.c = this._closeCoilR; this._recalcThresholds(); }
        super.onConfigUpdate(cfg);
    }
}
