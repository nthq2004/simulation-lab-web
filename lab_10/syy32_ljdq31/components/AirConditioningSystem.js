import { BaseComponent } from './BaseComponent.js';

/**
 * AirConditioningSystem —— 船舶中央空调系统（整幅工艺流程，按参考图重绘）
 *
 * 空气侧：新风 + 回风 →（调节风门）→ 自动控制站（过滤段 ΔP / 蒸发器 / 离心风机 / 开·关按钮）
 *         → 送风（加热盘管 / 加湿器）→ 船员舱室 → 回风
 * 制冷剂侧：压缩机 → 滑油分离器 → 冷凝器（低温冷却淡水，带放气）→ 干燥器&过滤器（旁通阀）
 *         → 回热器 → 并联两路膨胀阀（A 小容量 / B 大容量，按负荷投切）→ 蒸发器 → 回气 → 压缩机
 * 另有：充冷剂接口、观察镜、起动延时（Delay）、控制器（虚线控制各风门 / 膨胀阀 / TC）。
 *
 * 求解器：AirConditioningSolver。状态经 acceptModel(m) 回写。
 */
export class AirConditioningSystem extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.W = 1250; this.H = 850;
        this.type = 'air_conditioning_system';
        this.special = 'refrigerant';
        this.cache = 'fixed';

        this.THIN  = '#ee5cee';
        this.MAG   = '#e600e6';
        this.PUR   = '#8e3fb5';
        this.WAT   = '#2b7fc4';
        this.OIL   = '#f2a30f';
        this.STEAM = '#12b0c9';
        this.AIR   = '#5aa9e6';
        this.TW = 3; this.TK = 8;

        this._initGroups();
        this._handValves = {};        // 手动截止阀状态（默认关断）
        this._solenoids = {};         // 电磁阀状态（由控制器驱动）
        this._dampers = {};           // 调节风门状态（新风 / 回风）
        this._fanOn = false;          // 自动控制站风机（默认停机；开/关按钮控制）
        this._ctrlOn = false;         // 控制器工作状态（默认关闭）
        this._expOpen = { a: false, b: false };   // 两路膨胀阀投切状态

        this._drawTop();
        this._drawAirStation();
        this._drawCabin();
        this._drawHeatHumid();
        this._drawControllers();
        this._drawTempRelay();
        this._drawLeftColumn();
        this._drawMachines();
        this._drawValves();
        this._drawTags();
        this._drawDynamic();
        this._registerParts();
        this._compensateLeftOffset();

        this.config = { id: this.id, width: this.W, height: this.H };
    }

    /**
     * 左侧裁剪补偿。
     * 本工程配置文件中的 acsys 位置可能被外部同步进程回写为负 x（如 -150），
     * 导致控制器 / 回热器等左侧内容被画布左边界裁掉。此处按组件实际 x 做内部补偿，
     * 使绘制内容始终落在画布内（配置 x=0 时不做任何补偿）。
     */
    _compensateLeftOffset() {
        let applied = 0;
        const apply = () => {
            if (!this.group) return;
            const gx = this.group.x();
            // 仅在组件被置于画布左侧之外（x<0）时补偿；x>=0 时撤销任何已有补偿
            const want = gx < 0 ? -gx : 0;
            const dx = want - applied;
            if (!dx) return;
            this._staticGroup.x(this._staticGroup.x() + dx);
            this._dynamicGroup.x(this._dynamicGroup.x() + dx);
            this._interactGroup.x(this._interactGroup.x() + dx);
            Object.keys(this._parts || {}).forEach(k => { this._parts[k].x += dx; });
            (this.ports || []).forEach(p => { if (p.node) p.node.x(p.node.x() + dx); else p.x += dx; });
            applied += dx;
        };
        apply();
        // 组件位置由 ControlSystem.init 在构造之后设置，故再延后一拍执行
        setTimeout(apply, 0);
    }

    // ═══════════════════════════════════════════════════════
    // 绘制工具
    // ═══════════════════════════════════════════════════════

    _thin(pts, color, dash) { this._line(pts, color, this.TW, dash); }
    _thick(pts, color) { this._line(pts, color, this.TK); }

    _line(points, color, width, dash) {
        this._staticGroup.add(new Konva.Line({
            points, stroke: color, strokeWidth: width, lineCap: 'round', lineJoin: 'round',
            ...(dash ? { dash } : {}),
        }));
    }

    /** 风管（灰管；w 为管宽，默认 18） */
    _duct(points, w) {
        w = w || 18;
        this._line(points, '#b9c2c8', w);
        this._line(points, '#dfe6ea', w * 0.66);
    }

    _text(x, y, w, s, size, fill, align, weight) {
        this._staticGroup.add(new Konva.Text({
            x, y, width: w || 0, text: s, fontSize: size || 12,
            fontStyle: weight ? 'bold' : 'normal', fill: fill || '#37474f',
            align: align || 'left', fontFamily: 'Arial',
        }));
    }

    /** 增减按钮（控制器用） */
    _drawArrowBtn(g, x, y, up) {
        g.add(new Konva.Rect({ x, y, width: 24, height: 14, fill: '#b0bec5', stroke: '#607d8b', strokeWidth: 1, cornerRadius: 2 }));
        g.add(new Konva.Line({ points: up ? [x + 7, y + 10, x + 12, y + 4, x + 17, y + 10] : [x + 7, y + 4, x + 12, y + 10, x + 17, y + 4], stroke: '#263238', strokeWidth: 2 }));
    }

    _arrow(x, y, angle, color, size) {
        size = size || 6;
        const g = new Konva.Group({ x, y, rotation: angle });
        g.add(new Konva.Line({ points: [size, 0, -size * 0.8, -size * 0.9, -size * 0.8, size * 0.9], fill: color, stroke: color, strokeWidth: 1, closed: true }));
        this._staticGroup.add(g);
    }

    _tube(x, y, w, h, vertical) {
        const g = this._staticGroup;
        g.add(new Konva.Rect({ x, y, width: w, height: h, fill: '#c2c8ce', stroke: '#6d747a', strokeWidth: 2, cornerRadius: vertical ? w / 2 : h / 2 }));
        g.add(new Konva.Rect({ x: x + 3, y: y + 3, width: vertical ? w - 6 : w * 0.5, height: vertical ? h * 0.5 : h - 6, fill: 'rgba(255,255,255,0.28)', cornerRadius: 4 }));
    }

    /** 离心风机（电机 + 隔板 + 蜗壳 + 叶轮轮毂 + 出口格栅 + 出口法兰） */
    _fanUnit(cx, cy) {
        const g = this._staticGroup;
        // 电机（左侧梯形）
        g.add(new Konva.Line({ points: [cx - 92, cy - 22, cx - 52, cy - 34, cx - 52, cy + 34, cx - 92, cy + 22], closed: true, fill: '#d9eef2', stroke: '#6fa8b8', strokeWidth: 1.5 }));
        // 隔板（电机与蜗壳之间）
        g.add(new Konva.Rect({ x: cx - 52, y: cy - 42, width: 8, height: 84, fill: '#9fb8bf', stroke: '#5b727a', strokeWidth: 1 }));
        // 蜗壳（左缘内凹进风、右侧平直出风）
        g.add(new Konva.Path({ x: cx, y: cy, data: 'M -40 -48 C -26 -16 -26 16 -40 48 L 40 48 L 40 -48 Z', fill: '#cfe9ee', stroke: '#5b8a92', strokeWidth: 1.5, lineJoin: 'round' }));
        // 叶轮轮毂
        g.add(new Konva.Circle({ x: cx, y: cy, radius: 20, fill: '#22c55e', stroke: '#166534', strokeWidth: 2 }));
        // 出口格栅（水平条）
        for (let i = -3; i <= 3; i++) g.add(new Konva.Line({ points: [cx + 46, cy + i * 9, cx + 76, cy + i * 9], stroke: '#8d9298', strokeWidth: 3.5 }));
        // 出口法兰
        g.add(new Konva.Rect({ x: cx + 75, y: cy - 34, width: 9, height: 68, fill: '#d9eef2', stroke: '#6fa8b8', strokeWidth: 1.5 }));
    }

    /** 离心风机叶轮 */
    _fanSymbol(cx, cy, r) {
        const g = this._staticGroup;
        g.add(new Konva.Circle({ x: cx, y: cy, radius: r + 8, fill: '#e8f1f5', stroke: '#4a7c86', strokeWidth: 2 }));
        const n = 12;
        for (let i = 0; i < n; i++) {
            g.add(new Konva.Path({
                x: cx, y: cy, rotation: (360 / n) * i,
                data: `M 0 -5 Q ${r * 0.55} ${-r * 0.38} ${r * 0.62} ${-r * 0.98} Q ${r * 0.34} ${-r * 0.72} 0 -5 Z`,
                fill: '#8a9aa0', stroke: '#5b727a', strokeWidth: 1,
            }));
        }
        g.add(new Konva.Circle({ x: cx, y: cy, radius: r * 0.30, fill: '#5b727a', stroke: '#3d525a', strokeWidth: 1 }));
    }

    /**
     * 截止阀（手动）：蝶形阀体 + 手柄。点击切换通断；默认关断（白），导通绿色。
     */
    _vHand(id, x, y, color, s, rot) {
        s = s || 1; rot = rot || 0;
        const g = new Konva.Group({ x, y, rotation: rot });
        const hw = 15 * s, hh = 12 * s;
        g.add(new Konva.Rect({ x: -hw, y: -5, width: 2 * hw, height: 10, fill: '#ffffff' }));
        const t1 = new Konva.Line({ points: [-hw, -hh, -hw, hh, 0, 0, -hw, -hh], fill: '#ffffff', stroke: color, strokeWidth: 2, closed: true });
        const t2 = new Konva.Line({ points: [hw, -hh, hw, hh, 0, 0, hw, -hh], fill: '#ffffff', stroke: color, strokeWidth: 2, closed: true });
        g.add(t1, t2);
        g.add(new Konva.Line({ points: [0, 0, 0, -22 * s], stroke: color, strokeWidth: 2 }));
        g.add(new Konva.Line({ points: [-10 * s, -24 * s, 10 * s, -24 * s], stroke: color, strokeWidth: 3, lineCap: 'round' }));
        this._dynamicGroup.add(g);

        this._handValves[id] = { group: g, bodies: [t1, t2], open: false };
        const hit = this.addClickablePart('hv-' + id, x - 20 * s, y - 20 * s, 40 * s, 40 * s);
        if (hit) hit.on('click tap', () => this.toggleHandValve(id));
        return g;
    }

    /** 电磁阀：蝶形阀体 + 阀杆 + 线圈 */
    _vSolenoid(id, x, y, color, s, rot) {
        s = s || 1; rot = rot || 0;
        const g = new Konva.Group({ x, y, rotation: rot });
        const hw = 15 * s, hh = 12 * s;
        g.add(new Konva.Rect({ x: -hw, y: -5, width: 2 * hw, height: 10, fill: '#ffffff' }));
        const b1 = new Konva.Line({ points: [-hw, -hh, -hw, hh, 0, 0, -hw, -hh], fill: '#ffffff', stroke: color, strokeWidth: 2, closed: true });
        const b2 = new Konva.Line({ points: [hw, -hh, hw, hh, 0, 0, hw, -hh], fill: '#ffffff', stroke: color, strokeWidth: 2, closed: true });
        g.add(b1, b2);
        g.add(new Konva.Line({ points: [0, 0, 0, -22 * s], stroke: color, strokeWidth: 2 }));
        const coil = new Konva.Rect({ x: -9 * s, y: -38 * s, width: 18 * s, height: 16 * s, fill: '#ffffff', stroke: color, strokeWidth: 2 });
        const diag = new Konva.Line({ points: [-9 * s, -22 * s, 9 * s, -38 * s], stroke: color, strokeWidth: 2 });
        g.add(coil, diag);
        this._dynamicGroup.add(g);

        this._solenoids[id] = { bodies: [b1, b2], coil, diag, color, on: false };
        return g;
    }

    /** 比例电磁阀（开度可调）：阀体 + 线圈 + 斜向可调箭头；阀体随开度填充 */
    _vPropValve(id, x, y, color, s) {
        s = s || 1;
        const g = new Konva.Group({ x, y });
        const hw = 13 * s, hh = 10 * s;
        g.add(new Konva.Rect({ x: -hw, y: -5, width: 2 * hw, height: 10, fill: '#ffffff' }));
        const b1 = new Konva.Line({ points: [-hw, -hh, -hw, hh, 0, 0, -hw, -hh], fill: '#ffffff', stroke: color, strokeWidth: 2, closed: true });
        const b2 = new Konva.Line({ points: [hw, -hh, hw, hh, 0, 0, hw, -hh], fill: '#ffffff', stroke: color, strokeWidth: 2, closed: true });
        g.add(b1, b2);
        g.add(new Konva.Line({ points: [0, 0, 0, -24 * s], stroke: color, strokeWidth: 2 }));
        // 线圈（内含斜线）
        g.add(new Konva.Rect({ x: -10 * s, y: -40 * s, width: 20 * s, height: 16 * s, fill: '#ffffff', stroke: color, strokeWidth: 2 }));
        g.add(new Konva.Line({ points: [-7 * s, -24 * s, 7 * s, -40 * s], stroke: color, strokeWidth: 2 }));
        // 开度可调指示（双向箭头）
        g.add(new Konva.Line({ points: [-9 * s, -48 * s, 9 * s, -48 * s], stroke: '#e53935', strokeWidth: 2 }));
        g.add(new Konva.Line({ points: [-6 * s, -45.5 * s, -9 * s, -48 * s, -6 * s, -50.5 * s], stroke: '#e53935', strokeWidth: 1.6 }));
        g.add(new Konva.Line({ points: [6 * s, -45.5 * s, 9 * s, -48 * s, 6 * s, -50.5 * s], stroke: '#e53935', strokeWidth: 1.6 }));
        // 放动态层：开度变化时填充可即时刷新
        this._dynamicGroup.add(g);
        if (!this._propValves) this._propValves = {};
        this._propValves[id] = { bodies: [b1, b2] };
    }

    /** 热力膨胀阀（节流造型，整体缩放 0.5） */
    _vExp(id, x, y, tag, rot) {
        const g = new Konva.Group({ x, y, rotation: rot || 0 });
        g.scale({ x: 0.5, y: 0.5 });
        const gray = '#9e9e9e', grayD = '#7d7d7d', fit = '#c9c9c9';
        g.add(new Konva.Rect({ x: -42, y: -12, width: 12, height: 24, fill: fit, stroke: '#8a8a8a', strokeWidth: 1 }));
        g.add(new Konva.Rect({ x: 30, y: -12, width: 12, height: 24, fill: fit, stroke: '#8a8a8a', strokeWidth: 1 }));
        g.add(new Konva.Rect({ x: -30, y: -15, width: 60, height: 30, fill: gray }));
        g.add(new Konva.Rect({ x: -14, y: -32, width: 28, height: 52, fill: gray }));
        g.add(new Konva.Rect({ x: -10, y: 20, width: 20, height: 6, fill: grayD }));
        g.add(new Konva.Rect({ x: -26, y: -34, width: 52, height: 4, fill: grayD }));
        g.add(new Konva.Line({ points: [-26, -34, 26, -34, 19, -42, -19, -42], fill: grayD, stroke: grayD, strokeWidth: 1, closed: true }));
        g.add(new Konva.Line({ points: [12, -20, 32, -40], stroke: grayD, strokeWidth: 4, lineCap: 'round' }));
        const label = tag || 'Exp';
        g.add(new Konva.Rect({ x: -24, y: -13, width: 48, height: 26, fill: '#00e5e5', stroke: '#00c4c4', strokeWidth: 1, cornerRadius: 2 }));
        g.add(new Konva.Text({ x: -24, y: -9, width: 48, text: label, fontSize: 20, fill: '#111111', align: 'center', fontFamily: 'Arial' }));
        this._staticGroup.add(g);
        // 投切指示环（动态）：投入时亮绿
        const ring = new Konva.Circle({ x, y: y - 8, radius: 30, stroke: '#00e83a', strokeWidth: 3, visible: false });
        this._dynamicGroup.add(ring);
        this._expOpen[id] = false;
        if (!this._expRings) this._expRings = {};
        this._expRings[id] = ring;
    }

    /** 调节风门（方框 + 斜叶片 + 位置指示箭头）；开启时方框填充亮绿色 */
    _vDamper(id, x, y, rot) {
        const g = new Konva.Group({ x, y, rotation: rot || 0 });
        const rect = new Konva.Rect({ x: -13, y: -13, width: 26, height: 26, stroke: '#37474f', strokeWidth: 2, fill: '#ffffff' });
        g.add(rect);
        const blade = new Konva.Line({ points: [-9, 9, 9, -9], stroke: '#37474f', strokeWidth: 3 });
        g.add(blade);
        g.add(new Konva.Line({ points: [17, -7, 17, 7], stroke: '#37474f', strokeWidth: 1.5 }));
        g.add(new Konva.Line({ points: [14, -4, 17, -8, 20, -4], stroke: '#37474f', strokeWidth: 1.5 }));
        g.add(new Konva.Text({ x: 22, y: -7, text: '0', fontSize: 10, fill: '#37474f', fontFamily: 'Arial' }));
        this._dynamicGroup.add(g);
        this._dampers[id] = { group: g, rect, blade, open: false };
        return g;
    }

    // ── 阀门 / 风门 / 膨胀阀 状态控制 ──────────────────────

    toggleHandValve(id) {
        const v = this._handValves[id];
        if (!v) return;
        this.setHandValve(id, !v.open);
    }

    setHandValve(id, open) {
        const v = this._handValves[id];
        if (!v) return;
        v.open = !!open;
        const f = v.open ? '#00c853' : '#ffffff';
        v.bodies.forEach(b => b.fill(f));
        if (this.sys && this.sys.requestRedraw) this.sys.requestRedraw();
    }

    isHandValveOpen(id) {
        const v = this._handValves[id];
        return !!(v && v.open);
    }

    /** 批量设置手动截止阀（except 中的 id 保持不变） */
    setHandValvesBulk(open, except) {
        const ex = new Set(except || []);
        Object.keys(this._handValves).forEach(id => { if (!ex.has(id)) this.setHandValve(id, open); });
    }

    setSolenoid(id, on) {
        const v = this._solenoids[id];
        if (!v || v.on === !!on) return;
        v.on = !!on;
        const bodyFill = v.on ? '#00e83a' : '#ffffff';
        v.bodies.forEach(b => b.fill(bodyFill));
        v.coil.fill(v.on ? '#ffd9d9' : '#ffffff');
        v.coil.stroke(v.on ? '#e53935' : v.color);
        v.coil.strokeWidth(v.on ? 4 : 2);
        v.diag.stroke(v.on ? '#e53935' : v.color);
        if (this.sys && this.sys.requestRedraw) this.sys.requestRedraw();
    }

    /** 两路膨胀阀投切（投入：绿色指示环 + 阀体亮起） */
    setExValve(id, on) {
        this._expOpen[id] = !!on;
        const ring = this._expRings && this._expRings[id];
        if (ring) ring.visible(!!on);
        if (this.sys && this.sys.requestRedraw) this.sys.requestRedraw();
    }
    isExValveOpen(id) { return !!this._expOpen[id]; }

    /** 调节风门开度（true=开：叶片转位并填充亮绿色） */
    setDamper(id, open) {
        const d = this._dampers[id];
        if (!d) return;
        d.open = !!open;
        d.blade.rotation(open ? 0 : 90);
        if (d.rect) d.rect.fill(d.open ? '#00e83a' : '#ffffff');   // 开启：亮绿色
        if (this.sys && this.sys.requestRedraw) this.sys.requestRedraw();
    }
    isDamperOpen(id) { const d = this._dampers[id]; return !!(d && d.open); }

    /** 点击风门切换开 / 关 */
    toggleDamper(id) {
        const d = this._dampers[id];
        if (!d) return;
        this.setDamper(id, !d.open);
    }

    // ── 控制器 ──
    isControllerOn() { return !!this._ctrlOn; }
    setController(on) {
        this._ctrlOn = !!on;
        if (this._ctrlBox) this._ctrlBox.fill(this._ctrlOn ? '#00e83a' : '#f4f6f7');
        if (this.sys && this.sys.requestRedraw) this.sys.requestRedraw();
    }
    /** 点击控制器框切换工作/关闭（制冷/制热工况下锁定不可切换；关工况下与加热/加湿互锁） */
    toggleController() {
        const m = this.sys && this.sys.acSolver ? this.sys.acSolver.m : null;
        if (m && m.ctl && m.ctl.lock) return;
        const on = this.isControllerOn();
        if (!on && m && m.ctl) { m.ctl.heat.active = false; m.ctl.humid.active = false; }
        this.setController(!on);
    }

    // ── 自动控制站风机（开 / 关带灯按钮）──
    getRoomFan() { return this._fanOn; }
    setRoomFan(_key, on) {
        this._fanOn = !!on;
        if (this._fanNodes) {
            this._fanNodes.green.fill(on ? '#00e83a' : '#0b3d0b');
            this._fanNodes.red.fill(on ? '#3d0b0b' : '#ff2020');
        }
        if (this.sys && this.sys.requestRedraw) this.sys.requestRedraw();
    }

    // ═══════════════════════════════════════════════════════
    // 顶部：控制器 + 新风 / 回风 + 风管
    // ═══════════════════════════════════════════════════════

    _drawTop() {
        // ── 风管先画（随后被混风筒 / 站体覆盖端头，形成「连通」的接口效果）──
        // 新风风管（入口开敞，位于混风筒左边中央）
        this._duct([180, 287, 250, 287], 27);
        this._staticGroup.add(new Konva.Line({ points: [168, 271, 180, 275, 180, 299, 168, 303], closed: true, fill: '#cfd6da', stroke: '#9aa4ab', strokeWidth: 1.5 }));
        this._text(160, 238, 60, '新风', 13, '#1565c0', 'left', true);

        // 回风风管（自船员舱室顶部 → 上行 → 左行 → 进入混风筒右边上部）
        this._duct([1145, 220, 1145, 175, 297, 175], 27);
        this._text(1158, 171, 90, '回风', 13, '#1565c0', 'left', true);
        this._arrow(1145, 197, -90, this.AIR, 6);   // 出口中部向上的回风箭头

        // 混风管（混风筒右边中间 → 自动控制站）
        this._duct([297, 287, 330, 287], 27);
        this._arrow(322, 287, 0, this.AIR, 6);

        // 混风筒（高度向下增大到原来的两倍；覆盖风管端头形成连通）
        this._tube(250, 140, 47, 294, true);
        this._text(250, 438, 60, '混风筒', 11, '#37474f', 'center', true);

        // 风门（置于动态层，浮于风管之上）
        this._vDamper('fresh', 215, 287, 0);
        this._vDamper('return', 350, 175, 0);

        // 控制器框（再往上增高 10px；文字增大 3px）
        this._staticGroup.add(new Konva.Rect({ x: 23, y: -4, width: 114, height: 52, stroke: '#27ae60', strokeWidth: 2, cornerRadius: 3 }));
        this._ctrlBox = new Konva.Rect({ x: 30, y: 0, width: 100, height: 42, fill: '#f4f6f7', stroke: '#5f656b', strokeWidth: 3 });
        this._ctrlLabel = new Konva.Text({ x: 30, y: 12, width: 100, text: '制冷控制器', fontSize: 15, fontStyle: 'bold', fill: '#2c3e50', align: 'center', fontFamily: 'Arial' });
        this._dynamicGroup.add(this._ctrlBox, this._ctrlLabel);

        // 控制虚线：
        //   左    → 观察镜上方电磁阀（总供液电磁阀）线圈
        //   右侧 3 根统一从控制器外框引出、位置对称：上 → 温度继电器；中 → 第 2 根管道电磁阀；下 → 第 1 根管道电磁阀
        this._line([23, 22, 10, 22, 10, 380, 19, 380], '#95a5a6', 1.5, [7, 4]);
        this._line([137, 6, 584, 6, 584, 160], '#95a5a6', 1.5, [7, 4]);
        this._line([137, 22, 330, 22, 330, 76], '#95a5a6', 1.5, [7, 4]);
        this._line([137, 38, 285, 38, 285, 42], '#95a5a6', 1.5, [7, 4]);
    }

    // ═══════════════════════════════════════════════════════
    // 自动控制站（过滤段 / 蒸发器 / 风机 / 开·关）
    // ═══════════════════════════════════════════════════════

    _drawAirStation() {
        const g = this._staticGroup;
        // 粗送风管（先画，随后被站体右壁覆盖端头，形成连通接口）
        this._duct([985, 335, 1090, 335], 27);
        this._arrow(1040, 335, 0, this.AIR, 6);
        this._text(1025, 357, 60, '送风', 12, '#1565c0', 'center', true);

        // 站体（整体下移 80px）
        g.add(new Konva.Rect({ x: 330, y: 210, width: 660, height: 250, fill: '#c7e8dc', stroke: '#3f8f77', strokeWidth: 2, cornerRadius: 4 }));
        this._text(336, 216, 220, '自动控制站', 15, '#0d5c46', 'left', true);

        // ① 过滤器（两片滤网）
        g.add(new Konva.Rect({ x: 370, y: 235, width: 26, height: 205, fill: '#e9eef0', stroke: '#7a8b90', strokeWidth: 1.6, cornerRadius: 3 }));
        g.add(new Konva.Rect({ x: 406, y: 235, width: 26, height: 205, fill: '#e9eef0', stroke: '#7a8b90', strokeWidth: 1.6, cornerRadius: 3 }));
        for (let i = 0; i < 7; i++) {
            g.add(new Konva.Line({ points: [374, 250 + i * 28, 392, 250 + i * 28], stroke: '#90a4ae', strokeWidth: 3 }));
            g.add(new Konva.Line({ points: [410, 250 + i * 28, 428, 250 + i * 28], stroke: '#90a4ae', strokeWidth: 3 }));
        }
        this._text(368, 442, 80, '过滤器', 12, '#37474f', 'center', true);

        // ② 蒸发器（两根管道，分别由电磁阀 + 膨胀阀控制）
        g.add(new Konva.Rect({ x: 480, y: 235, width: 120, height: 205, fill: '#f3f6f7', stroke: '#7aa7b0', strokeWidth: 1.6, cornerRadius: 4 }));
        this._text(492, 243, 96, '蒸发器', 13, '#37474f', 'center', true);

        // 蒸发器结霜指示（故障「蒸发器严重结霜」时显示：霜层白色覆盖 + 雪花标识）
        const frost = new Konva.Group({ x: 480, y: 235, visible: false });
        frost.add(new Konva.Rect({
            x: 0, y: 0, width: 120, height: 205, cornerRadius: 4,
            fill: 'rgba(236,247,255,0.92)', stroke: '#b3d9f2', strokeWidth: 1.5,
        }));
        for (let i = 0; i < 9; i++) {   // 霜层结晶纹理
            const yy = 14 + i * 22;
            frost.add(new Konva.Line({ points: [6, yy, 36, yy - 8, 66, yy + 6, 96, yy - 6, 114, yy], stroke: '#9fd0ee', strokeWidth: 2.5, lineCap: 'round' }));
        }
        frost.add(new Konva.Text({ x: 0, y: 86, width: 120, text: '❄ 结霜', fontSize: 16, fill: '#1976d2', align: 'center', fontFamily: 'Arial' }));
        frost.add(new Konva.Text({ x: 0, y: 108, width: 120, text: '换热恶化', fontSize: 11, fill: '#1976d2', align: 'center', fontFamily: 'Arial' }));
        this._dynamicGroup.add(frost);
        this._frostOverlay = frost;

        // ③ 蒸汽加热器
        g.add(new Konva.Rect({ x: 680, y: 235, width: 40, height: 205, fill: '#fde8e8', stroke: '#c0392b', strokeWidth: 1.6, cornerRadius: 3 }));
        for (let i = 0; i < 7; i++) g.add(new Konva.Line({ points: [682, 250 + i * 28, 718, 250 + i * 28], stroke: '#c0392b', strokeWidth: 3 }));
        this._text(640, 442, 80, '蒸汽加热器', 11, '#b71c1c', 'center', true);

        // ④ 蒸汽加湿器
        g.add(new Konva.Rect({ x: 750, y: 235, width: 40, height: 205, fill: '#e3f6fb', stroke: '#0e7490', strokeWidth: 1.6, cornerRadius: 3 }));
        for (let i = 0; i < 6; i++) g.add(new Konva.Circle({ x: 770, y: 260 + i * 36, radius: 6, fill: '#7fd7ea', stroke: '#0e7490', strokeWidth: 1 }));
        this._text(720, 442, 80, '蒸汽加湿器', 11, '#0e7490', 'center', true);

        // ⑤ 风机（离心式：电机 + 隔板 + 蜗壳 + 叶轮 + 出口格栅）
        this._fanUnit(900, 335);
        this._text(865, 297, 60, '风机', 13, '#37474f', 'center', true);
    }

    // ═══════════════════════════════════════════════════════
    // 船员舱室
    // ═══════════════════════════════════════════════════════

    _drawCabin() {
        const g = this._staticGroup;
        // 船员舱室（宽度减半；底部与自动控制站底部对齐 y=460，多余高度截掉）
        g.add(new Konva.Rect({ x: 1090, y: 220, width: 110, height: 240, fill: '#9ad9c9', stroke: '#3f8f77', strokeWidth: 2, cornerRadius: 6 }));
        this._text(1096, 228, 98, '船员舱室', 14, '#0d5c46', 'center', true);
    }

    // ═══════════════════════════════════════════════════════
    // 加热 / 加湿（送风段，锅炉蒸汽）
    // ═══════════════════════════════════════════════════════

    _drawHeatHumid() {
        const g = this._staticGroup, S = this.STEAM;
        // 加热蒸汽管（独立，位置在上方；自中心引入蒸汽加热器）
        this._thin([1250, 60, 700, 60], S);
        this._thin([700, 60, 700, 235], S);
        // 加湿蒸汽管（当前的管道，供蒸汽加湿器；自中心引入）
        this._thin([1250, 125, 770, 125], S);
        this._thin([770, 125, 770, 235], S);
        this._text(1100, 44, 130, '来自锅炉蒸汽系统', 12, '#0e7490', 'left', true);
        this._text(655, 36, 90, '加热蒸汽', 11, '#b71c1c', 'right', true);
        this._text(815, 100, 90, '加湿蒸汽', 11, '#0e7490', 'left', true);
        this._arrow(1000, 60, 180, S, 6);
        this._arrow(1000, 125, 180, S, 6);
        // 水平管上的比例电磁阀（开度可调）：上管（左移 30px）、下管距左 2/3 处
        this._vPropValve('prv-heat', 843, 60, S, 0.9);
        this._vPropValve('prv-humid', 1140, 125, S, 0.9);
        // 冷凝水：自加热器 / 加湿器中心引出、汇合后至锅炉蒸汽系统
        this._thin([700, 440, 700, 475], S, [8, 4]);
        this._thin([770, 440, 770, 475], S, [8, 4]);
        this._thin([700, 475, 1250, 475], S, [8, 4]);
        this._text(1090, 492, 130, '至锅炉蒸汽系统', 12, '#0e7490', 'left', true);
    }

    // ═══════════════════════════════════════════════════════
    // 加热 / 加湿控制器（串级控制）+ 温湿度传感器 + 控制虚线
    // ═══════════════════════════════════════════════════════

    /** 温湿度传感器（风管上的小圆标记；温度亮红、湿度亮蓝） */
    _sensor(x, y, label, color) {
        const g = this._staticGroup;
        g.add(new Konva.Circle({ x, y, radius: 7, fill: color || '#ffffff', stroke: '#37474f', strokeWidth: 1.4 }));
        g.add(new Konva.Text({ x: x - 8, y: y - 8, width: 16, text: label, fontSize: 12, fontStyle: 'bold', fill: '#ffffff', align: 'center', fontFamily: 'Arial' }));
    }

    _drawControllers() {
        // 控制器箱体放在动态层：激活时改变填充色可即时刷新（静态层已位图缓存）
        const d = this._dynamicGroup;
        // ── 加热控制器（无标签、宽度减小、文本框宽度减半；左移 30px）──
        this._heatBox = new Konva.Rect({ x: 870, y: 2, width: 90, height: 50, fill: '#eef1f2', stroke: '#5f7178', strokeWidth: 1.5, cornerRadius: 3 });
        d.add(this._heatBox);
        d.add(new Konva.Rect({ x: 878, y: 6, width: 28, height: 32, fill: '#ffffff', stroke: '#546e7a', strokeWidth: 1, cornerRadius: 2 }));
        d.add(new Konva.Text({ x: 908, y: 13, width: 14, text: '℃', fontSize: 13, fill: '#37474f', fontFamily: 'Arial' }));
        this._drawArrowBtn(d, 928, 6, true);
        this._drawArrowBtn(d, 928, 26, false);
        // ── 加湿控制器（再右移 60px）──
        this._humidBox = new Konva.Rect({ x: 1020, y: 70, width: 90, height: 44, fill: '#eef1f2', stroke: '#5f7178', strokeWidth: 1.5, cornerRadius: 3 });
        d.add(this._humidBox);
        d.add(new Konva.Rect({ x: 1028, y: 74, width: 28, height: 30, fill: '#ffffff', stroke: '#546e7a', strokeWidth: 1, cornerRadius: 2 }));
        d.add(new Konva.Text({ x: 1058, y: 80, width: 14, text: '%', fontSize: 13, fill: '#37474f', fontFamily: 'Arial' }));
        this._drawArrowBtn(d, 1078, 74, true);
        this._drawArrowBtn(d, 1078, 92, false);

        // ── 温湿度传感器（温度亮红 / 湿度亮蓝）──
        this._sensor(1000, 175, 'T', '#ff2020');
        this._sensor(1040, 175, 'H', '#2196f3');
        this._sensor(1010, 335, 'T', '#ff2020');
        this._sensor(1060, 335, 'H', '#2196f3');

        // ── 控制虚线（引往传感器的末段均垂直向下）──
        // 加热控制器：左 → 比例阀线圈；右（上）→ 送风温度传感器，右（下）→ 回风温度传感器
        this._line([870, 31, 852, 31], '#95a5a6', 1.4, [6, 4]);
        this._line([960, 14, 1010, 14, 1010, 335], '#95a5a6', 1.4, [6, 4]);
        this._line([960, 38, 1000, 38, 1000, 175], '#95a5a6', 1.4, [6, 4]);
        // 加湿控制器：右 → 比例阀线圈；下 → 回风/送风湿度传感器（自对应位置直接向下引出）
        this._line([1110, 96, 1131, 96], '#95a5a6', 1.4, [6, 4]);
        this._line([1040, 114, 1040, 175], '#95a5a6', 1.4, [6, 4]);
        this._line([1060, 114, 1060, 335], '#95a5a6', 1.4, [6, 4]);
    }

    // ═══════════════════════════════════════════════════════
    // 温度继电器（贴于蒸发器第 2 入口管右侧、回风管内部）
    // ═══════════════════════════════════════════════════════

    _drawTempRelay() {
        const g = this._staticGroup;
        // 温度继电器：箱体与「T」为动态节点（高于启动温度激活，亮绿色填充）
        this._text(580, 150, 90, '温度继电器', 11, '#37474f', 'center', true);
    }

    // ═══════════════════════════════════════════════════════
    // 左列：回热器 / 观察镜 / 干燥器&过滤器 / 充冷剂接口
    // ═══════════════════════════════════════════════════════

    _drawLeftColumn() {
        const g = this._staticGroup, M = this.MAG, P = this.PUR;

        // 回热器（窄立式壳 + 折流填料 + 上下法兰）
        this._tube(40, 150, 40, 170, true);
        for (let i = 0; i < 8; i++) g.add(new Konva.Line({ points: [46, 168 + i * 18, 74, 174 + i * 18], stroke: '#8e3fb5', strokeWidth: 2.5 }));
        g.add(new Konva.Rect({ x: 33, y: 141, width: 54, height: 9, fill: '#8d9298', stroke: '#5f656b', strokeWidth: 1.5 }));
        g.add(new Konva.Rect({ x: 33, y: 320, width: 54, height: 9, fill: '#8d9298', stroke: '#5f656b', strokeWidth: 1.5 }));
        this._text(12, 126, 120, '回热器', 13, '#37474f', 'center', true);
        // 上出（液） / 右上口（气入） / 右下口（气出）
        this._thin([60, 141, 60, 69], this.THIN);
        this._line([80, 180, 100, 172], P, 7);
        this._line([80, 292, 100, 300], P, 7);

        // 观察镜（上移 30px）
        g.add(new Konva.Circle({ x: 58, y: 470, radius: 28, fill: '#b8bcc0', stroke: '#5f656b', strokeWidth: 2 }));
        g.add(new Konva.Circle({ x: 58, y: 470, radius: 14, fill: '#16a085', stroke: '#0e6655', strokeWidth: 2 }));
        this._text(28, 504, 70, '观察镜', 12, '#37474f', 'center', true);

        // 干燥器 & 过滤器
        this._tube(30, 610, 55, 95, true);
        for (let i = 0; i < 4; i++) g.add(new Konva.Line({ points: [37, 624 + i * 20, 78, 624 + i * 20], stroke: '#90a4ae', strokeWidth: 3 }));
        this._text(-5, 708, 130, '干燥器&过滤器', 12, '#37474f', 'center', true);

        // 充冷剂接口
        g.add(new Konva.Rect({ x: 150, y: 742, width: 9, height: 18, fill: '#c9c9c9', stroke: '#8a8a8a', strokeWidth: 1 }));
        g.add(new Konva.Line({ points: [162, 742, 162, 760], stroke: '#8a8a8a', strokeWidth: 3 }));
        this._text(140, 764, 70, '充冷剂接口', 12, '#37474f', 'center', true);

        // 管路：干燥器底 → 下引 → 充冷剂接口（经阀）
        this._thin([57, 705, 57, 751, 150, 751], M);
        // 干燥器顶 → 观察镜 → 回热器（液态主管）；观察镜上移后，截止阀移到其下方
        this._thin([57, 610, 57, 498], M);
        this._thin([57, 442, 57, 320], M);
    }

    // ═══════════════════════════════════════════════════════
    // 动力设备：压缩机 / 滑油分离器 / 冷凝器 + 管路
    // ═══════════════════════════════════════════════════════

    _drawRadialCompressor(cx, cy, s) {
        s = s || 1;
        const g = this._staticGroup;
        const root = new Konva.Group({ x: cx, y: cy, scaleX: s, scaleY: s });
        root.add(new Konva.Circle({ x: 0, y: 0, radius: 80, fill: '#cfd4d8', stroke: '#6d747a', strokeWidth: 2 }));
        for (let i = 0; i < 6; i++) {
            const a = -90 + i * 60;
            const grp = new Konva.Group({ rotation: a });
            grp.add(new Konva.Rect({ x: -22, y: -84, width: 44, height: 48, fill: '#e23b3b', stroke: '#8f1f1f', strokeWidth: 1.5, cornerRadius: 8 }));
            grp.add(new Konva.Circle({ x: 0, y: -58, radius: 7, fill: '#2e7d32', stroke: '#1b5e20', strokeWidth: 1 }));
            root.add(grp);
        }
        root.add(new Konva.Circle({ x: 0, y: 0, radius: 40, fill: '#b8bcc0', stroke: '#5f656b', strokeWidth: 2 }));
        root.add(new Konva.Circle({ x: 0, y: 0, radius: 16, fill: '#39d353', stroke: '#1b7a30', strokeWidth: 1.5 }));
        g.add(root);
    }

    /** 储液罐（接收器，参照制冷系统）：立式筒体 + 青色液位数字框 + 液位视窗 */
    _drawReceiver() {
        const g = this._staticGroup;
        // 筒体（下移 30px、宽度减 20px；无顶部接管矩形）
        this._tube(416, 728, 44, 118, true);
        // 青色液位数字框
        g.add(new Konva.Rect({ x: 420, y: 734, width: 36, height: 20, fill: '#00e5e5', stroke: '#00c4c4', strokeWidth: 1, cornerRadius: 2 }));
        // 液位视窗
        g.add(new Konva.Rect({ x: 426, y: 762, width: 24, height: 36, fill: '#20262b', stroke: '#111', strokeWidth: 1.5, cornerRadius: 2 }));
        [0, 50, 100].forEach(v => g.add(new Konva.Text({ x: 452, y: 798 - v * 0.36 - 5, text: String(v), fontSize: 8, fill: '#37474f' })));
        this._text(396, 850, 84, '接收器', 12, '#37474f', 'center', true);
    }

    _drawMachines() {
        const M = this.MAG, P = this.PUR, W = this.WAT;
        const COND_S = 2 / 3, COND_X = 620, COND_Y = 620, COND_W = 310;   // 冷凝器：缩为 2/3、宽减 30px、再左移 60px
        const cpX = COND_X + (COND_W / 2) * COND_S;                        // 冷凝器上/下接管中心 x

        // 压缩机（缩为 2/3；整体下移 50px）
        this._drawRadialCompressor(285, 650, 2 / 3);
        this._text(305, 637, 120, '压缩机', 14, '#2c3e50', 'center', true);

        // 滑油分离器（宽高缩为 4/5；整体下移 50px）
        this._tube(480, 525, 44, 94, true);
        this._staticGroup.add(new Konva.Rect({ x: 486, y: 538, width: 18, height: 72, fill: '#20262b', stroke: '#111', strokeWidth: 1.5, cornerRadius: 2 }));
        this._text(455, 630, 130, '滑油分离器', 12, '#37474f', 'center', true);

        // 冷凝器（卧式壳管，缩为 2/3）
        const grp = new Konva.Group({ x: COND_X, y: COND_Y, scaleX: COND_S, scaleY: COND_S });
        grp.add(new Konva.Rect({ x: 0, y: 0, width: COND_W, height: 92, fill: '#b0b6bc', stroke: '#5f656b', strokeWidth: 2, cornerRadius: 26 }));
        grp.add(new Konva.Rect({ x: -8, y: 14, width: 18, height: 64, fill: '#8d9298', stroke: '#5f656b', strokeWidth: 1.5, cornerRadius: 4 }));
        grp.add(new Konva.Rect({ x: COND_W - 10, y: 14, width: 18, height: 64, fill: '#8d9298', stroke: '#5f656b', strokeWidth: 1.5, cornerRadius: 4 }));
        // 上入口 / 下出口（对称的小矩形接管，随宽度居中）
        grp.add(new Konva.Rect({ x: COND_W / 2 - 28, y: -22, width: 56, height: 26, fill: '#b0b6bc', stroke: '#5f656b', strokeWidth: 2, cornerRadius: 6 }));
        grp.add(new Konva.Rect({ x: COND_W / 2 - 28, y: 88, width: 56, height: 26, fill: '#b0b6bc', stroke: '#5f656b', strokeWidth: 2, cornerRadius: 6 }));
        this._staticGroup.add(grp);
        this._text(596, 684, 100, '冷凝器', 14, '#2c3e50', 'center', true);

        // 冷却水（低温冷却淡水系统）：上=出口（向右箭头，标注在上），下=进口（向左箭头，标注在下）
        const cwx = COND_X + (COND_W + 8) * COND_S;   // 接冷凝器右端盖
        this._thin([cwx, 633, 1050, 633], W);
        this._thin([cwx, 667, 1050, 667], W);
        this._arrow(1015, 633, 0, W, 6);     // 出口：向右
        this._arrow(1015, 667, 180, W, 6);   // 入口：向左
        this._text(920, 613, 140, '去低温冷却淡水系统', 12, '#1565c0', 'center', true);
        this._text(920, 675, 140, '来自低温冷却淡水系统', 12, '#1565c0', 'center', true);

        // ── 制冷剂管路 ──
        // 压缩机排气 → 滑油分离器（整体下移 50px）
        this._thin([285, 595, 285, 555, 480, 555], P);
        // 滑油分离器顶 → 冷凝器顶（入口）
        this._thin([502, 525, 502, 500, cpX, 500, cpX, 606], P);
        // 冷凝器底（出口）→ 下 → 左行 → 上行接干燥器底，并与制冷剂主入口管线相交
        this._thin([cpX, 696, cpX, 802, 57, 802, 57, 751], M);
        // 储液罐（管道中间）
        this._drawReceiver();
        // 回气：蒸发器两根出口管（对准入口 1/3、2/3 处）→ 汇合（水平管下移 10px）→ 回热器【右上口】（气入）
        this._thin([520, 440, 520, 472], P);
        this._thin([560, 440, 560, 472], P);
        this._thin([520, 472, 560, 472], P);                    // 两根出口汇合
        this._thin([520, 472, 160, 472, 160, 172, 100, 172], P);
        // 回热器【右下口】（气出）→ 下 → 压缩机入口截止阀 → 压缩机（水平段下移 25px）
        this._thin([100, 300, 130, 300, 130, 495, 245, 495, 245, 612], P);
        // 液态：回热器顶 → 向上 → 向右引出两根管道（各带电磁阀 + 膨胀阀）
        this._thin([60, 141, 60, 69], M);
        this._thin([60, 69, 560, 69], M);       // 第 1 根（上）→ 蒸发器右边入口
        this._thin([60, 69, 60, 102], M);
        this._thin([60, 102, 520, 102], M);     // 第 2 根（下）→ 蒸发器左边入口
        this._thin([560, 69, 560, 235], M);
        this._thin([520, 102, 520, 235], M);

        // 滑油回油：分离器底 → 下 → 左 → 压缩机底部（整体下移 50px）
        this._thin([502, 619, 502, 720, 280, 720, 280, 708], this.OIL);
        // 滑油注入口（压缩机正左方，经水平截止阀接入，紧凑）
        this._thin([150, 650, 227, 650], this.OIL);
        this._staticGroup.add(new Konva.Rect({ x: 142, y: 642, width: 10, height: 16, fill: '#f2a30f', stroke: '#b8860b', strokeWidth: 1 }));
        this._text(95, 624, 120, '滑油注入口', 12, '#37474f', 'center', true);
        // 滑油出口（左下，经垂直截止阀向下引出，紧凑）
        this._thin([244, 691, 244, 765], this.OIL);
        this._staticGroup.add(new Konva.Rect({ x: 236, y: 757, width: 16, height: 10, fill: '#f2a30f', stroke: '#b8860b', strokeWidth: 1 }));
        this._text(258, 746, 90, '滑油出口', 12, '#37474f', 'left', true);
    }

    // ═══════════════════════════════════════════════════════
    // 阀门
    // ═══════════════════════════════════════════════════════

    _drawValves() {
        const M = this.MAG, P = this.PUR, W = this.WAT, O = this.OIL, BL = '#37474f';
        const S = this.STEAM;

        this._vHand('suc1', 245, 550, P, 0.9, 90);        // 压缩机入口截止阀
        this._vHand('dis1', 400, 555, P, 0.9, 0);         // 压缩机出口截止阀
        this._vHand('cond1-out', 723.3, 748, M, 1, 90);   // 冷凝器出口截止阀
        this._vHand('dry', 140, 751, M, 0.9, 0);          // 干燥器出口截止阀
        this._vHand('liq', 57, 550, M, 0.9, 90);          // 液态主管截止阀（移至观察镜下方）
        this._vHand('oil1-in', 192, 650, O, 0.8, 0);       // 滑油注入口截止阀（水平）
        this._vHand('oil1-out', 244, 728, O, 0.8, 90);     // 滑油出口截止阀（垂直向下引出）
        this._vHand('cw1', 900, 667, W, 0.9, 0);          // 冷却水进口截止阀（左移 30px）

        // 蒸发器两路：每根管各由一组（电磁阀 + 膨胀阀）控制
        this._vSolenoid('sol-a', 285, 69, this.THIN, 0.7, 0);     // 第 1 根管电磁阀 → 右边入口
        this._vExp('exp-a', 415, 69, 'Exp', 0);                   // 第 1 根管膨胀阀
        this._vSolenoid('sol-b', 330, 102, this.THIN, 0.7, 0);    // 第 2 根管电磁阀 → 左边入口
        this._vExp('exp-b', 455, 102, 'Exp', 0);                  // 第 2 根管膨胀阀

        // 电磁阀
        this._vSolenoid('liq', 57, 380, P, 1, -90);        // 总供液电磁阀（控制器驱动）
        this._vSolenoid('oil1', 400, 720, O, 0.9, 0);      // 回油电磁阀
    }

    // ═══════════════════════════════════════════════════════
    // 动态读数标注
    // ═══════════════════════════════════════════════════════

    _drawTags() {
        const d = this._dynamicGroup;
        const mk = (x, y, txt, fill, size) => {
            const t = new Konva.Text({ x, y, width: 120, text: txt, fontSize: size || 13, fontStyle: 'bold', fill: fill || '#1565c0', align: 'left', fontFamily: 'monospace' });
            d.add(t); return t;
        };
        this._freshTag = mk(172, 320, 'T 32.0\nH 60%', null, 11); // 新风 T/H
        this._supplyTag = mk(860, 250, 'T 18.0  H 50%');      // 送风 T/H
        this._cabinTag = mk(1100, 310, 'T 24.0\nH 55%', null, 15); // 舱室 T/H（字体增大 4px）
        this._peTag = mk(492, 260, 'P 4.00');                 // 蒸发压力
        this._oilsepTag = mk(475, 510, '10', '#111111');      // 油分液位
        this._condTag = mk(702, 642, 'T 36.0');               // 冷凝温度（置于冷凝器中心）
        this._psucTag = mk(185, 566, 'P 3.90');               // 吸气压力（入口截止阀左下）
        this._pdisTag = mk(320, 532, 'P 13.9');               // 排气压力
    }

    // ═══════════════════════════════════════════════════════
    // 动态节点
    // ═══════════════════════════════════════════════════════

    _drawDynamic() {
        const d = this._dynamicGroup;

        // 开 / 关 带灯按钮（风机下方；左移 40px）
        const bezelOn = new Konva.Circle({ x: 870, y: 410, radius: 20, fill: '#eef3f5', stroke: '#8fa3ad', strokeWidth: 2 });
        const bezelOff = new Konva.Circle({ x: 930, y: 410, radius: 20, fill: '#eef3f5', stroke: '#8fa3ad', strokeWidth: 2 });
        const green = new Konva.Circle({ x: 870, y: 410, radius: 14, fill: '#0b3d0b', stroke: '#08300b', strokeWidth: 2 });
        const red = new Konva.Circle({ x: 930, y: 410, radius: 14, fill: '#3d0b0b', stroke: '#300808', strokeWidth: 2 });
        d.add(bezelOn, bezelOff, green, red);
        this._fanNodes = { green, red };
        this._staticGroup.add(new Konva.Text({ x: 850, y: 436, width: 40, text: '开', fontSize: 13, fontStyle: 'bold', fill: '#1b5e20', align: 'center' }));
        this._staticGroup.add(new Konva.Text({ x: 910, y: 436, width: 40, text: '关', fontSize: 13, fontStyle: 'bold', fill: '#b71c1c', align: 'center' }));
        // 风机叶轮（动态旋转；位于蜗壳中心轮毂内）
        this._fanRotor = new Konva.Group({ x: 900, y: 335 });
        for (let i = 0; i < 8; i++) {
            this._fanRotor.add(new Konva.Path({
                x: 0, y: 0, rotation: (360 / 8) * i,
                data: 'M 0 -3 C 7 -5 11 -11 10 -17 C 4 -12 1 -7 0 -3 Z',
                fill: '#0f7a3d', stroke: '#0b5c2e', strokeWidth: 1,
            }));
        }
        this._fanRotor.add(new Konva.Circle({ radius: 4, fill: '#0b5c2e' }));
        this._fanRotor.visible(false);
        d.add(this._fanRotor);

        // 运行指示灯
        this._runLamp = new Konva.Circle({ x: 285, y: 650, radius: 12, fill: '#0b3d0b', stroke: '#08300b', strokeWidth: 2 });
        d.add(this._runLamp);

        // 油分液位柱 / 压缩机滑油液位 / 储液罐液位
        this._oilsepBar = new Konva.Rect({ x: 489, y: 538, width: 14, height: 72, fill: '#f2a30f', cornerRadius: 2 });
        d.add(this._oilsepBar);
        this._compOilBar = new Konva.Rect({ x: 180, y: 680, width: 14, height: 48, fill: '#f2a30f', cornerRadius: 2 });
        d.add(this._compOilBar);
        this._compOilTag = new Konva.Text({ x: 168, y: 694, width: 100, text: '滑油 50%', fontSize: 11, fontStyle: 'bold', fill: '#7a4a00', align: 'center', fontFamily: 'monospace' });
        d.add(this._compOilTag);

        // 储液罐（接收器）液位
        this._recvBar = new Konva.Rect({ x: 428, y: 764, width: 20, height: 32, fill: '#bfc7cc', cornerRadius: 2 });
        d.add(this._recvBar);
        this._recvText = new Konva.Text({ x: 420, y: 738, width: 36, text: '45', fontSize: 12, fontStyle: 'bold', fill: '#111111', align: 'center', fontFamily: 'monospace' });
        d.add(this._recvText);

        // 加热 / 加湿 状态指示
        this._heatLamp = new Konva.Rect({ x: 680, y: 235, width: 40, height: 205, fill: 'rgba(255,60,60,0.28)', cornerRadius: 3, visible: false });
        this._humidLamp = new Konva.Rect({ x: 750, y: 235, width: 40, height: 205, fill: 'rgba(60,180,240,0.28)', cornerRadius: 3, visible: false });
        d.add(this._heatLamp, this._humidLamp);

        // 温度继电器（箱体 + 「T」；高于启动温度激活时亮绿色填充）
        this._trelayBox = new Konva.Rect({ x: 573, y: 160, width: 22, height: 15, fill: '#ffffff', stroke: '#37474f', strokeWidth: 1.6, cornerRadius: 3 });
        d.add(this._trelayBox);
        d.add(new Konva.Text({ x: 564, y: 160, width: 38, text: 'T', fontSize: 14, fontStyle: 'bold', fill: '#37474f', align: 'center', fontFamily: 'Arial' }));
        // 加热 / 加湿控制器：目标值文本框 + 比例阀开度标注
        this._heatCtlVal = new Konva.Text({ x: 878, y: 13, width: 28, text: '24', fontSize: 16, fontStyle: 'bold', fill: '#102a43', align: 'center', fontFamily: 'monospace' });
        this._humidCtlVal = new Konva.Text({ x: 1028, y: 80, width: 28, text: '60', fontSize: 16, fontStyle: 'bold', fill: '#102a43', align: 'center', fontFamily: 'monospace' });
        this._prvHeatTag = new Konva.Text({ x: 815, y: 72, width: 56, text: '开度 0%', fontSize: 10, fontStyle: 'bold', fill: '#1565c0', align: 'center', fontFamily: 'monospace' });
        this._prvHumidTag = new Konva.Text({ x: 1112, y: 138, width: 56, text: '开度 0%', fontSize: 10, fontStyle: 'bold', fill: '#1565c0', align: 'center', fontFamily: 'monospace' });
        d.add(this._heatCtlVal, this._humidCtlVal, this._prvHeatTag, this._prvHumidTag);
    }

    _registerParts() {
        const ctrl = this.addClickablePart('controller', 30, 0, 100, 42);
        if (ctrl) ctrl.on('click tap', () => this.toggleController());
        this.addClickablePart('trelay', 573, 160, 22, 15);
        // 蒸汽比例电磁阀（开度可调）
        this.addClickablePart('prv-heat', 828, 10, 32, 62);
        this.addClickablePart('prv-humid', 1125, 75, 32, 62);

        // 加热 / 加湿控制器（点击箱体切换激活；＋ / － 调整目标值）
        const hb = this.addClickablePart('heatctl', 870, 2, 90, 50);
        if (hb) hb.on('click tap', () => this._toggleCtl('heat'));
        const hu = this.addClickablePart('heatctl-up', 928, 6, 24, 14);
        if (hu) hu.on('click tap', () => this._bumpCtl('heat', +1));
        const hd = this.addClickablePart('heatctl-dn', 928, 26, 24, 14);
        if (hd) hd.on('click tap', () => this._bumpCtl('heat', -1));
        const mb = this.addClickablePart('humidctl', 1020, 70, 90, 44);
        if (mb) mb.on('click tap', () => this._toggleCtl('humid'));
        const mu = this.addClickablePart('humidctl-up', 1078, 74, 24, 14);
        if (mu) mu.on('click tap', () => this._bumpCtl('humid', +1));
        const md = this.addClickablePart('humidctl-dn', 1078, 92, 24, 14);
        if (md) md.on('click tap', () => this._bumpCtl('humid', -1));

        this.addClickablePart('comp1', 225, 590, 120, 120);
        this.addClickablePart('oilsep1', 480, 525, 44, 94);
        this.addClickablePart('cond1', 620, 620, 207, 61);
        this.addClickablePart('receiver', 416, 728, 44, 118);
        this.addClickablePart('regen', 33, 141, 54, 190);
        this.addClickablePart('dryer', 30, 610, 55, 95);
        this.addClickablePart('charge', 145, 735, 45, 40);
        this.addClickablePart('evap', 480, 235, 120, 205);
        this.addClickablePart('filter', 370, 235, 62, 205);
        this.addClickablePart('fan', 850, 290, 130, 96);
        this.addClickablePart('cabin', 1090, 220, 110, 240);
        this.addClickablePart('heater', 680, 235, 40, 205);
        this.addClickablePart('humidifier', 750, 235, 40, 205);
        // 新风 / 回风调节风门：点击切换开（亮绿）/ 关
        const dFresh = this.addClickablePart('fresh-air', 195, 265, 45, 45);
        if (dFresh) dFresh.on('click tap', () => this.toggleDamper('fresh'));
        const dRet = this.addClickablePart('return-air', 328, 153, 45, 45);
        if (dRet) dRet.on('click tap', () => this.toggleDamper('return'));

        // 开 / 关 按钮命中区（左移 40px）
        const hitOn = this.addClickablePart('fan-on', 848, 388, 44, 44);
        if (hitOn) hitOn.on('click tap', () => this.setRoomFan('cabin', true));
        const hitOff = this.addClickablePart('fan-off', 908, 388, 44, 44);
        if (hitOff) hitOff.on('click tap', () => this.setRoomFan('cabin', false));

        // 蒸发器两路（电磁阀 + 膨胀阀）
        this.addClickablePart('exp-a', 390, 45, 50, 50);
        this.addClickablePart('exp-b', 430, 78, 50, 50);
    }

    // ── 加热 / 加湿控制器操作 ──
    _ctlModel() { return (this.sys && this.sys.acSolver) ? this.sys.acSolver.m.ctl : null; }

    /** 比例电磁阀阀体填充：开度 > 30% 亮绿，随开度减小颜色变淡 */
    _setPropFill(id, v) {
        const pv = this._propValves && this._propValves[id];
        if (!pv) return;
        const a = Math.max(0, Math.min(1, (v || 0) / 30));
        const fill = (a <= 0) ? '#ffffff' : 'rgba(0,232,58,' + a.toFixed(2) + ')';
        pv.bodies.forEach(b => b.fill(fill));
    }

    /** 点击控制器箱体：激活 / 退出（激活时箱体亮绿色背景填充）
     *  制冷/制热工况下锁定不可切换；关工况下与制冷控制器互锁 */
    _toggleCtl(k) {
        const c = this._ctlModel(); if (!c || !c[k]) return;
        if (c.lock) return;
        const turningOn = !c[k].active;
        if (turningOn) this.setController(false);      // 互锁：关掉制冷控制器
        c[k].active = turningOn;
        if (this.sys && this.sys.requestRedraw) this.sys.requestRedraw();
    }

    /** 调整控制器目标值（温度 1℃ / 湿度 1%） */
    _bumpCtl(k, d) {
        const c = this._ctlModel(); if (!c || !c[k]) return;
        const lo = (k === 'heat') ? 10 : 20, hi = (k === 'heat') ? 45 : 95;
        const v = Math.round((c[k].target + d) * 10) / 10;
        c[k].target = Math.max(lo, Math.min(hi, v));
        if (this.sys && this.sys.requestRedraw) this.sys.requestRedraw();
    }

    // ═══════════════════════════════════════════════════════
    // 求解器回写
    // ═══════════════════════════════════════════════════════

    acceptModel(m) {
        if (!m) return;
        const r1 = (v) => (v == null ? '--' : Number(v).toFixed(1));
        if (this._freshTag && m.fresh) this._freshTag.text('T ' + r1(m.fresh.temp) + '  H ' + Math.round(m.fresh.rh || 0) + '%');
        if (this._supplyTag && m.supply) this._supplyTag.text('T ' + r1(m.supply.temp) + '  H ' + Math.round(m.supply.rh || 0) + '%');
        if (this._cabinTag && m.cabin) this._cabinTag.text('T ' + r1(m.cabin.temp) + '\nH ' + Math.round(m.cabin.rh || 0) + '%');

        if (this._peTag) {
            const pv = (m.peOut != null) ? m.peOut : m.pe;
            this._peTag.text('P ' + (pv != null ? pv.toFixed(2) : '0.00'));
        }
        if (this._psucTag) this._psucTag.text('P ' + (m.psuc1 != null ? m.psuc1.toFixed(2) : '0.00'));
        if (this._pdisTag) this._pdisTag.text('P ' + (m.pdis1 != null ? m.pdis1.toFixed(2) : '0.00'));
        if (this._condTag) this._condTag.text('T ' + r1(m.tc));
        if (this._oilsepTag && m.oilsep) this._oilsepTag.text(String(Math.round(m.oilsep.comp1 || 0)));

        // 控制器
        if (this._ctrlBox) this._ctrlBox.fill(m.ctrlOn ? '#00e83a' : '#f4f6f7');

        // 蒸发器结霜指示（故障状态由求解器故障开关驱动）
        if (this._frostOverlay) {
            const fr = this.sys && this.sys.acSolver && this.sys.acSolver.faults;
            this._frostOverlay.visible(!!(fr && fr.evapFrost));
        }

        // 风机按钮
        const fanOn = !!m.fanOn;
        if (this._fanNodes) {
            this._fanNodes.green.fill(fanOn ? '#00e83a' : '#0b3d0b');
            this._fanNodes.red.fill(fanOn ? '#3d0b0b' : '#ff2020');
        }
        if (this._fanRotor) this._fanRotor.visible(fanOn);

        // 膨胀阀 / 电磁阀
        this.setExValve('exp-a', !!m.expA);
        this.setExValve('exp-b', !!m.expB);
        this.setSolenoid('liq', !!m.masterSol);
        this.setSolenoid('sol-a', !!m.expA);               // 蒸发器回路 A 电磁阀
        this.setSolenoid('sol-b', !!m.expB);               // 蒸发器回路 B 电磁阀
        this.setSolenoid('oil1', !!(m.comps && m.comps.comp1 && m.comps.comp1.oilSolOpen));

        // 运行灯 / 滑油
        const c1 = m.comps && m.comps.comp1;
        if (c1 && this._runLamp) {
            this._runLamp.fill(c1.running ? '#00e83a' : '#0b3d0b');
            const h = 48 * ((c1.oilLevel || 0) / 100);
            this._compOilBar.height(Math.max(3, h));
            this._compOilBar.y(708 - Math.max(3, h));
            if (this._compOilTag) this._compOilTag.text('滑油 ' + Math.round(c1.oilLevel || 0) + '%');
        }
        if (m.oilsep && this._oilsepBar) {
            const h = 72 * ((m.oilsep.comp1 || 0) / 100);
            this._oilsepBar.height(Math.max(3, h));
            this._oilsepBar.y(610 - Math.max(3, h));
        }
        if (m.receiver !== undefined && this._recvBar) {
            const h = 32 * (m.receiver / 100);
            this._recvBar.height(Math.max(3, h));
            this._recvBar.y(796 - Math.max(3, h));
            if (this._recvText) this._recvText.text(String(Math.round(m.receiver)));
        }

        // 加热 / 加湿控制器（激活亮绿色背景；目标值；比例阀开度）
        if (m.ctl) {
            const hc = m.ctl.heat, hm = m.ctl.humid;
            if (this._heatBox) this._heatBox.fill(hc.active ? '#00e83a' : '#eef1f2');
            if (this._humidBox) this._humidBox.fill(hm.active ? '#00e83a' : '#eef1f2');
            if (this._heatCtlVal) this._heatCtlVal.text(String(Math.round(hc.target)));
            if (this._humidCtlVal) this._humidCtlVal.text(String(Math.round(hm.target)));
            if (this._prvHeatTag) this._prvHeatTag.text('开度 ' + Math.round(hc.valve || 0) + '%');
            if (this._prvHumidTag) this._prvHumidTag.text('开度 ' + Math.round(hm.valve || 0) + '%');
            // 比例阀阀体随开度填充：开度 > 30% 亮绿，随开度减小颜色变淡
            this._setPropFill('prv-heat', hc.valve || 0);
            this._setPropFill('prv-humid', hm.valve || 0);
        }

        // 温度继电器：高于启动温度激活（亮绿），低于停止温度不激活（滞环保持）
        if (m.cabin && this._trelayBox) {
            if (this._tRelayOn === undefined) this._tRelayOn = false;
            if (m.cabin.temp > m.cabin.setStart) this._tRelayOn = true;
            else if (m.cabin.temp < m.cabin.setStop) this._tRelayOn = false;
            this._trelayBox.fill(this._tRelayOn ? '#00e83a' : '#ffffff');
        }

        // 加热 / 加湿指示
        if (this._heatLamp) this._heatLamp.visible(!!m.heating);
        if (this._humidLamp) this._humidLamp.visible(!!m.humidifying);
    }

    tick(dt) {
        const m = this.sys && this.sys.acSolver ? this.sys.acSolver.m : null;
        if (this._fanRotor && m && m.fanOn) {
            this._fanRotor.rotation((this._fanRotor.rotation() + 240 * dt) % 360);
        }
        this._refreshIfDirty();
    }

    getConfigFields() {
        return [
            { label: '器件名称 (ID)', key: 'id', type: 'text' },
            { label: '宽度', key: 'width', type: 'number' },
            { label: '高度', key: 'height', type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.id) this.id = cfg.id;
        this.config = { ...this.config, ...cfg };
        if (this.sys && this.sys.requestRedraw) this.sys.requestRedraw();
    }
}

export default AirConditioningSystem;
