import { BaseComponent } from './BaseComponent.js';

/**
 * RefrigerationSystem —— 制冷系统（整幅工艺流程，按参考图重绘）
 *
 * 关键造型：
 *   · 回热器：窄立式壳，右上斜口接回流制冷剂气体，右下斜口经「筒型气液分离筒」回压缩机入口；
 *   · 冷库制冷剂入口在【右上】（水平进入，非顶部）；
 *   · 库内电磁阀 = 上「线圈」+ 下「截止阀」形式；膨胀阀为特殊节流造型（区别于截止阀）；
 *   · 蒸发器内绘制风扇叶（离心叶轮）。
 *
 * 主管路（细线 + 箭头）：供液/回气/冷却水/滑油；库内为粗管路。
 */
export class RefrigerationSystem extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.W = 1250; this.H = 850;
        this.type = 'refrigeration_system';
        this.special = 'refrigerant';
        this.cache = 'fixed';

        this.THIN = '#ee5cee';
        this.MAG = '#e600e6';
        this.PUR = '#8e3fb5';
        this.WAT = '#2b7fc4';
        this.OIL = '#f2a30f';
        this.TW = 3;
        this.TK = 8;

        this.rooms = [
            { key: 'dry', name: '干货库', cx: 255 },
            { key: 'grain', name: '粮库', cx: 510 },
            { key: 'veg', name: '菜库', cx: 765 },
            { key: 'fish', name: '鱼库', cx: 1020 },
            { key: 'meat', name: '肉库', cx: 1275 },
        ];

        this._initGroups();
        this._handValves = {};      // 手动截止阀状态（默认关断）
        this._solenoids = {};       // 电磁阀状态（由控制器驱动显示）
        this._fanOn = {};           // 各库蒸发器风机（默认运行；由带灯按钮控制）
        this._ctrlOn = false;       // 控制器工作状态（默认关闭；点击控制器框切换）
        this._drawTop();
        this._drawHeaders();
        this._drawLeftColumn();
        this._drawRooms();
        this._drawMachines();
        this._drawValves();
        this._drawTags();
        this._drawDynamic();
        this._registerParts();

        const s = 1250 / 1390;
        this.group.scale({ x: s, y: 850 / 945 });

        this.config = { id: this.id, width: this.W, height: this.H };
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

    _text(x, y, w, s, size, fill, align, weight) {
        this._staticGroup.add(new Konva.Text({
            x, y, width: w || 0, text: s, fontSize: size || 12,
            fontStyle: weight ? 'bold' : 'normal', fill: fill || '#37474f',
            align: align || 'left', fontFamily: 'Arial',
        }));
    }

    _arrow(x, y, angle, color, size) {
        size = size || 6;
        const g = new Konva.Group({ x, y, rotation: angle });
        g.add(new Konva.Line({ points: [size, 0, -size * 0.8, -size * 0.9, -size * 0.8, size * 0.9], fill: color, stroke: color, strokeWidth: 1, closed: true }));
        this._staticGroup.add(g);
    }

    _flowArrow(x, y) {
        this._staticGroup.add(new Konva.Line({ points: [x - 18, y - 9, x - 18, y + 9, x, y, x - 18, y - 9], stroke: '#5aa9e6', strokeWidth: 3, fill: '#e8f3fb', closed: true }));
    }

    /** 方框交叉阀（蝶阀/电磁阀体） */
    _vSquare(x, y, color, s, rot) {
        s = s || 1; rot = rot || 0;
        const g = new Konva.Group({ x, y, rotation: rot });
        g.add(new Konva.Rect({ x: -11 * s, y: -11 * s, width: 22 * s, height: 22 * s, stroke: color, strokeWidth: 2, fill: '#ffffff' }));
        g.add(new Konva.Line({ points: [-11 * s, -11 * s, 11 * s, 11 * s], stroke: color, strokeWidth: 2 }));
        g.add(new Konva.Line({ points: [-11 * s, 11 * s, 11 * s, -11 * s], stroke: color, strokeWidth: 2 }));
        this._staticGroup.add(g);
    }

    /**
     * 截止阀（手动）：与电磁阀同形，仅顶部线圈改为手柄（T 形横杆）
     * 可点击切换通断；默认关断（阀体白色），导通时阀体绿色填充。
     * @param {string} id 阀门标识（供状态查询与点击切换）
     */
    _vHand(id, x, y, color, s, rot) {
        s = s || 1; rot = rot || 0;
        const g = new Konva.Group({ x, y, rotation: rot });
        const hw = 15 * s, hh = 12 * s;
        g.add(new Konva.Rect({ x: -hw, y: -5, width: 2 * hw, height: 10, fill: '#ffffff' }));   // 遮挡管道
        const t1 = new Konva.Line({ points: [-hw, -hh, -hw, hh, 0, 0, -hw, -hh], fill: '#ffffff', stroke: color, strokeWidth: 2, closed: true });
        const t2 = new Konva.Line({ points: [hw, -hh, hw, hh, 0, 0, hw, -hh], fill: '#ffffff', stroke: color, strokeWidth: 2, closed: true });
        g.add(t1, t2);
        g.add(new Konva.Line({ points: [0, 0, 0, -22 * s], stroke: color, strokeWidth: 2 }));
        g.add(new Konva.Line({ points: [-10 * s, -24 * s, 10 * s, -24 * s], stroke: color, strokeWidth: 3, lineCap: 'round' }));
        this._dynamicGroup.add(g);

        if (!this._handValves) this._handValves = {};
        this._handValves[id] = { group: g, bodies: [t1, t2], open: false };

        // 命中区（可点击切换通断）
        const hit = this.addClickablePart('hv-' + id, x - 20 * s, y - 20 * s, 40 * s, 40 * s);
        if (hit) hit.on('click tap', () => this.toggleHandValve(id));
        return g;
    }

    /**
     * 电磁阀：蝶形阀体（左右两三角尖端相对）+ 阀杆 + 线圈方框（内含斜线）
     * rot：0=水平管 90=垂直管
     */
    /**
     * 电磁阀：蝶形阀体 + 阀杆 + 线圈方框（内含斜线）
     * 导通时：线圈红色加粗外框 + 淡红色填充，阀体亮绿色填充。
     * @param {string} id 阀门标识（状态由控制器/求解器驱动）
     */
    _vSolenoid(id, x, y, color, s, rot) {
        s = s || 1; rot = rot || 0;
        const g = new Konva.Group({ x, y, rotation: rot });
        const hw = 15 * s, hh = 12 * s;
        g.add(new Konva.Rect({ x: -hw, y: -5, width: 2 * hw, height: 10, fill: '#ffffff' }));   // 遮挡管道
        // 蝶形阀体（两只三角，尖端相对）
        const b1 = new Konva.Line({ points: [-hw, -hh, -hw, hh, 0, 0, -hw, -hh], fill: '#ffffff', stroke: color, strokeWidth: 2, closed: true });
        const b2 = new Konva.Line({ points: [hw, -hh, hw, hh, 0, 0, hw, -hh], fill: '#ffffff', stroke: color, strokeWidth: 2, closed: true });
        g.add(b1, b2);
        // 阀杆
        g.add(new Konva.Line({ points: [0, 0, 0, -22 * s], stroke: color, strokeWidth: 2 }));
        // 线圈（方框 + 斜线）
        const coil = new Konva.Rect({ x: -9 * s, y: -38 * s, width: 18 * s, height: 16 * s, fill: '#ffffff', stroke: color, strokeWidth: 2 });
        const diag = new Konva.Line({ points: [-9 * s, -22 * s, 9 * s, -38 * s], stroke: color, strokeWidth: 2 });
        g.add(coil, diag);
        this._dynamicGroup.add(g);

        if (!this._solenoids) this._solenoids = {};
        this._solenoids[id] = { bodies: [b1, b2], coil, diag, color, on: false };
        return g;
    }

    // ── 阀门状态控制 ──────────────────────────────────────

    /** 切换手动截止阀通断（点击阀体时调用） */
    toggleHandValve(id) {
        const v = this._handValves && this._handValves[id];
        if (!v) return;
        this.setHandValve(id, !v.open);
    }

    /** 设置手动截止阀状态：导通时阀体绿色填充 */
    setHandValve(id, open) {
        const v = this._handValves && this._handValves[id];
        if (!v) return;
        v.open = !!open;
        const f = v.open ? '#00c853' : '#ffffff';
        v.bodies.forEach(b => b.fill(f));
        if (this.sys && this.sys.requestRedraw) this.sys.requestRedraw();
    }

    /** 取手动截止阀是否导通 */
    isHandValveOpen(id) {
        const v = this._handValves && this._handValves[id];
        return !!(v && v.open);
    }

    /** 批量设置手动截止阀通断（except 中的 id 跳过，保持不变） */
    setHandValvesBulk(open, except) {
        const ex = new Set(except || []);
        Object.keys(this._handValves || {}).forEach(id => {
            if (ex.has(id)) return;
            this.setHandValve(id, open);
        });
    }

    /** 设置电磁阀状态：导通时线圈红色加粗外框 + 淡红填充、阀体亮绿 */
    setSolenoid(id, on) {
        const v = this._solenoids && this._solenoids[id];
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

    // ── 控制器（温度控制器）工作状态 ──────────────────────

    /** 控制器是否处于工作状态（默认关闭） */
    isControllerOn() { return !!this._ctrlOn; }

    /** 设置控制器工作状态：工作时控制器框填充亮绿色背景 */
    setController(on) {
        this._ctrlOn = !!on;
        if (this._ctrlBox) this._ctrlBox.fill(this._ctrlOn ? '#00e83a' : '#f4f6f7');
        if (this.sys && this.sys.requestRedraw) this.sys.requestRedraw();
    }

    /** 点击控制器框切换工作/关闭 */
    toggleController() { this.setController(!this._ctrlOn); }

    // ── 冷库蒸发器风机（带灯按钮）──────────────────────────

    /** 取某库蒸发器风机是否运行（默认运行） */
    getRoomFan(key) { return this._fanOn[key] !== false; }

    /** 设置某库蒸发器风机运行/停机（点击带灯按钮时调用） */
    setRoomFan(key, on) {
        this._fanOn[key] = !!on;
        const rn = this._roomNodes && this._roomNodes.find(n => n.key === key);
        if (rn) {
            rn.green.fill(on ? '#00e83a' : '#0b3d0b');
            rn.red.fill(on ? '#3d0b0b' : '#ff2020');
        }
        if (this.sys && this.sys.requestRedraw) this.sys.requestRedraw();
    }

    /** 膨胀阀（热力膨胀阀造型；整体缩放为原尺寸的 1/2） */
    _vExp(x, y) {
        const g = new Konva.Group({ x, y });
        g.scale({ x: 0.5, y: 0.5 });
        const gray = '#9e9e9e', grayD = '#7d7d7d', fit = '#c9c9c9';
        // 两侧管道接头（螺纹块）
        g.add(new Konva.Rect({ x: -42, y: -12, width: 12, height: 24, fill: fit, stroke: '#8a8a8a', strokeWidth: 1 }));
        g.add(new Konva.Rect({ x: 30, y: -12, width: 12, height: 24, fill: fit, stroke: '#8a8a8a', strokeWidth: 1 }));
        g.add(new Konva.Rect({ x: -38, y: -9, width: 2, height: 18, fill: '#b0b0b0' }));
        g.add(new Konva.Rect({ x: 36, y: -9, width: 2, height: 18, fill: '#b0b0b0' }));
        // 遮挡管道（加高，缩放后仍能盖住管道）
        g.add(new Konva.Rect({ x: -30, y: -15, width: 60, height: 30, fill: gray }));
        // 竖直阀体
        g.add(new Konva.Rect({ x: -14, y: -32, width: 28, height: 52, fill: gray }));
        // 底部接口
        g.add(new Konva.Rect({ x: -10, y: 20, width: 20, height: 6, fill: grayD }));
        // 顶部法兰盖
        g.add(new Konva.Rect({ x: -26, y: -34, width: 52, height: 4, fill: grayD }));
        g.add(new Konva.Line({ points: [-26, -34, 26, -34, 19, -42, -19, -42], fill: grayD, stroke: grayD, strokeWidth: 1, closed: true }));
        // 斜毛细管
        g.add(new Konva.Line({ points: [12, -20, 32, -40], stroke: grayD, strokeWidth: 4, lineCap: 'round' }));
        // 青色 Exp 标牌
        g.add(new Konva.Rect({ x: -24, y: -13, width: 48, height: 26, fill: '#00e5e5', stroke: '#00c4c4', strokeWidth: 1, cornerRadius: 2 }));
        g.add(new Konva.Text({ x: -24, y: -9, width: 48, text: 'Exp', fontSize: 22, fill: '#111111', align: 'center', fontFamily: 'Arial' }));
        this._staticGroup.add(g);
    }

    _tube(x, y, w, h, vertical) {
        const g = this._staticGroup;
        g.add(new Konva.Rect({ x, y, width: w, height: h, fill: '#c2c8ce', stroke: '#6d747a', strokeWidth: 2, cornerRadius: vertical ? w / 2 : h / 2 }));
        g.add(new Konva.Rect({ x: x + 3, y: y + 3, width: vertical ? w - 6 : w * 0.5, height: vertical ? h * 0.5 : h - 6, fill: 'rgba(255,255,255,0.28)', cornerRadius: 4 }));
    }

    /** 风扇叶（离心叶轮：多片弯叶 + 轮毂） */
    _fan(cx, cy, r, group) {
        const g = group || this._staticGroup;
        const n = 11;
        for (let i = 0; i < n; i++) {
            g.add(new Konva.Path({
                x: cx, y: cy, rotation: (360 / n) * i,
                data: `M 0 -5 Q ${r * 0.55} ${-r * 0.38} ${r * 0.62} ${-r * 0.98} Q ${r * 0.34} ${-r * 0.72} 0 -5 Z`,
                fill: '#8a9aa0', stroke: '#5b727a', strokeWidth: 1,
            }));
        }
        g.add(new Konva.Circle({ x: cx, y: cy, radius: r * 0.30, fill: '#5b727a', stroke: '#3d525a', strokeWidth: 1 }));
    }

    // ═══════════════════════════════════════════════════════
    // 顶部
    // ═══════════════════════════════════════════════════════

    _drawTop() {
        // 绿色外框（套在控制器框外）
        this._staticGroup.add(new Konva.Rect({ x: 23, y: 8, width: 114, height: 55, stroke: '#27ae60', strokeWidth: 2, cornerRadius: 3 }));
        // 控制器框（加粗）：动态节点，工作状态填充亮绿色背景（点击框体切换工作/关闭）
        this._ctrlBox = new Konva.Rect({ x: 30, y: 15, width: 100, height: 41, fill: '#f4f6f7', stroke: '#5f656b', strokeWidth: 3 });
        this._ctrlLabel = new Konva.Text({ x: 30, y: 26, width: 100, text: '控制器', fontSize: 15, fontStyle: 'bold', fill: '#2c3e50', align: 'center', fontFamily: 'Arial' });
        this._dynamicGroup.add(this._ctrlBox, this._ctrlLabel);

        // 两条水平虚线：自控制器右侧 1/3、2/3 高度引出
        this._line([130, 29, 1360, 29], '#95a5a6', 1.5, [7, 4]);
        this._line([130, 42, 1360, 42], '#95a5a6', 1.5, [7, 4]);
        // 左侧虚线：自控制器左侧 1/2 高度引出
        // 控制器 → 回热器下方电磁阀（原左侧多余阀及其虚线已删除）
        this._line([30, 35, 18, 35, 18, 400, 20, 400], '#95a5a6', 1.5, [7, 4]);

        // 供液主管（细线 + 箭头）：自回热器顶部直接往右
        this._thin([58, 67, 1415, 67], this.THIN);
        this.rooms.forEach(r => this._arrow(r.cx, 67, 0, this.THIN, 6));
    }

    // ═══════════════════════════════════════════════════════
    // 回气总管（细线 + 箭头）
    // ═══════════════════════════════════════════════════════

    _drawHeaders() {
        // 回气总管（气态，紫）：左端接回热器右上口，右端止于肉库出口（不再向右伸出）
        this._thin([130, 360, 1295, 360], this.PUR);
        [200, 460, 720, 980, 1240].forEach(x => this._arrow(x, 360, 180, this.PUR, 6));
    }

    // ═══════════════════════════════════════════════════════
    // 左列：回热器（窄长壳 + 上下法兰 + 右上/右下斜口）+ 气液分离筒
    // ═══════════════════════════════════════════════════════

    _drawLeftColumn() {
        const g = this._staticGroup, M = this.MAG;

        // ── 回热器：高瘦窄壳（上下对称）──
        this._tube(40, 130, 40, 165, true);
        // 内部折流填料（斜向短筋）
        for (let i = 0; i < 8; i++) {
            const y = 150 + i * 18;
            g.add(new Konva.Line({ points: [46, y, 74, y + 6], stroke: '#8e3fb5', strokeWidth: 2.5 }));
        }
        g.add(new Konva.Rect({ x: 33, y: 121, width: 54, height: 9, fill: '#8d9298', stroke: '#5f656b', strokeWidth: 1.5 }));
        g.add(new Konva.Rect({ x: 33, y: 295, width: 54, height: 9, fill: '#8d9298', stroke: '#5f656b', strokeWidth: 1.5 }));
        // 上、下对称法兰连接块
        g.add(new Konva.Rect({ x: 36, y: 109, width: 48, height: 12, fill: '#a8adb3', stroke: '#5f656b', strokeWidth: 1.5, cornerRadius: 3 }));
        g.add(new Konva.Rect({ x: 36, y: 304, width: 48, height: 12, fill: '#a8adb3', stroke: '#5f656b', strokeWidth: 1.5, cornerRadius: 3 }));
        // 右上斜口（回流的制冷剂气体入口，气态）
        this._line([80, 150, 100, 143], this.PUR, 7);
        // 右下斜口（经气液分离筒回压缩机入口，气态）
        this._line([80, 274, 98, 282], this.PUR, 7);
        this._text(20, 106, 100, '回热器', 13, '#37474f', 'center', true);

        // ── 气液分离筒（立式圆筒，仅顶部左/右两个接口；整体下移 20px）──
        g.add(new Konva.Rect({ x: 130, y: 405, width: 72, height: 95, fill: '#bcbfc3', stroke: '#6d747a', strokeWidth: 2, cornerRadius: 16 }));
        g.add(new Konva.Rect({ x: 137, y: 412, width: 20, height: 81, fill: 'rgba(255,255,255,0.22)', cornerRadius: 10 }));
        this._text(120, 506, 110, '气液分离筒', 12, '#37474f', 'center', true);

        // ── 视液镜（观察镜） / 干燥&过滤 / 接收器（整体再下移 40px）──
        g.add(new Konva.Circle({ x: 58, y: 480, radius: 28, fill: '#b8bcc0', stroke: '#5f656b', strokeWidth: 2 }));
        g.add(new Konva.Circle({ x: 58, y: 480, radius: 14, fill: '#16a085', stroke: '#0e6655', strokeWidth: 2 }));

        this._tube(30, 630, 55, 90, true);
        for (let i = 0; i < 4; i++) g.add(new Konva.Line({ points: [37, 644 + i * 20, 78, 644 + i * 20], stroke: '#90a4ae', strokeWidth: 3 }));
        this._text(-10, 724, 135, '干燥&过滤', 12, '#37474f', 'center', true);

        // ── 接收器（筒体 + 顶部接管 + 青色液位数字框 + 液位视窗/刻度）──
        this._tube(210, 790, 70, 115, true);
        g.add(new Konva.Rect({ x: 235, y: 776, width: 20, height: 16, fill: '#8d9298', stroke: '#5f656b', strokeWidth: 1.5, cornerRadius: 3 }));
        g.add(new Konva.Rect({ x: 232, y: 812, width: 36, height: 20, fill: '#00e5e5', stroke: '#00c4c4', strokeWidth: 1, cornerRadius: 2 }));
        g.add(new Konva.Rect({ x: 220, y: 838, width: 24, height: 56, fill: '#20262b', stroke: '#111', strokeWidth: 1.5, cornerRadius: 2 }));
        [0, 50, 100].forEach(v => g.add(new Konva.Text({ x: 248, y: 838 + (100 - v) * 0.52 - 5, text: String(v), fontSize: 8, fill: '#37474f' })));
        this._text(190, 908, 130, '接收器', 12, '#37474f', 'center', true);

        // ── 管路 ──
        // 干燥&过滤底 → 下引；分两支：制冷剂注入口（经截止阀）、接接收器出口（经截止阀）
        this._thin([57, 720, 57, 800], M);
        this._thin([57, 745, 152, 745], M);        // 支路①：制冷剂注入口
        this._thin([57, 800, 228, 800], M);        // 支路②：接接收器左侧出口（伸入筒体圆角内，避免悬空）
        // 制冷剂注入口接头
        g.add(new Konva.Rect({ x: 152, y: 736, width: 8, height: 18, fill: '#c9c9c9', stroke: '#8a8a8a', strokeWidth: 1 }));
        g.add(new Konva.Line({ points: [163, 736, 163, 754], stroke: '#8a8a8a', strokeWidth: 3 }));
        this._text(150, 758, 60, '注入口', 12, '#37474f', 'center', true);
        // 管道在视液镜处断开，不穿过观察镜
        this._thin([58, 630, 58, 508], M);
        this._thin([58, 452, 58, 316], M);
        // 回热器顶（上出）→ 直接往右接供液主管
        this._thin([58, 109, 58, 67], this.THIN);
        // 回气总管 → 回热器右上斜口（入口，气流向左进回热器）
        this._thin([100, 143, 130, 143, 130, 360], this.PUR);
        this._arrow(116, 143, 180, this.PUR, 6);
        // 回热器右下斜口 → 沿左侧下行 → 水平段上移 15px → 再向下接入分离筒左上口
        this._thin([98, 282, 108, 282, 108, 390, 148, 390, 148, 405], this.PUR);
        // 气液分离筒【右上接口】→ 向上 → 向右 → 吸气总管；两机入口在总管对应点下引
        this._thin([184, 405, 184, 390, 220, 390], this.PUR);
        this._thin([220, 390, 830, 390, 830, 520], this.PUR);   // 二号机入口管路
        this._thin([270, 390, 270, 520], this.PUR);              // 一号机入口（与二号机同位置：距左缘 30px）
    }

    // ═══════════════════════════════════════════════════════
    // 冷库
    // ═══════════════════════════════════════════════════════

    _drawRooms() {
        const g = this._staticGroup, M = this.MAG, P = this.PUR;
        this.rooms.forEach(r => {
            const x0 = r.cx - 110, y0 = 80, w = 220, h = 250;
            g.add(new Konva.Rect({ x: x0, y: y0, width: w, height: h, fill: '#cdeef2', stroke: '#5b8a92', strokeWidth: 1.6, cornerRadius: 4 }));
            this._text(x0, y0 + 6, w, r.name, 15, '#0d47a1', 'center', true);

            // 控制虚线：左侧虚线移到库左边缘与左侧管道之间的空隙；右侧在 2/3 处
            this._line([x0 + 15, 29, x0 + 15, y0 + 24], '#95a5a6', 1.5, [6, 4]);
            this._line([x0 + 147, 42, x0 + 147, y0 - 6], '#95a5a6', 1.5, [6, 4]);
            // 温度开关引线（悬空挂于虚线末端）；开关本体为动态节点（见 _drawDynamic）
            g.add(new Konva.Line({ points: [x0 + 15, y0 + 38, x0 + 15, y0 + 46], stroke: '#7f8c8d', strokeWidth: 2 }));

            // 制冷剂引入：细管在两库之间的空隙下引 → 库右上 → 库内粗管往左
            this._thin([x0 + 245, 67, x0 + 245, y0 + 32, x0 + 210, y0 + 32], this.THIN);
            this._thick([x0 + 210, y0 + 32, x0 + 30, y0 + 32], M);
            this._thick([x0 + 30, y0 + 32, x0 + 30, y0 + 83], M);
            // 一分为二：上端与入口同色（品红）
            this._thick([x0 + 30, y0 + 83, x0 + 130, y0 + 83], M);
            this._thick([x0 + 130, y0 + 83, x0 + 130, y0 + 155], M);
            this._thick([x0 + 30, y0 + 83, x0 + 30, y0 + 155], M);
            // 下端（旁通阀下端 / 蒸发器出口）保持紫色
            this._thick([x0 + 130, y0 + 155, x0 + 130, y0 + 210], P);
            this._thick([x0 + 30, y0 + 155, x0 + 30, y0 + 210], P);
            this._thick([x0 + 30, y0 + 210, x0 + 130, y0 + 210], P);
            this._thick([x0 + 130, y0 + 210, x0 + 130, y0 + 250], P);
            this._thin([x0 + 130, y0 + 250, x0 + 130, 360], P);
            // 膨胀阀最后绘制，压在管道之上（避免被管道遮挡）
            this._vExp(x0 + 77, y0 + 32);

            // 蒸发器外壳（风扇以下截掉）
            g.add(new Konva.Rect({ x: x0 + 93, y: y0 + 98, width: 77, height: 94, fill: '#f3f6f7', stroke: '#7aa7b0', strokeWidth: 1.4, cornerRadius: 4 }));
            this._text(x0 + 93, y0 + 101, 77, '蒸发器', 12, '#37474f', 'center', true);
        });
    }

    // ═══════════════════════════════════════════════════════
    // 动力设备
    // ═══════════════════════════════════════════════════════

    _drawCompressor(x, y) {
        // 尺寸缩小为原来的 2/3（用缩放组，内部仍按 300×130 绘制）
        const grp = new Konva.Group({ x, y, scaleX: 2 / 3, scaleY: 2 / 3 });
        const w = 300, h = 130;
        grp.add(new Konva.Rect({ x: 0, y: 0, width: w, height: h, fill: '#b8bcc0', stroke: '#6d747a', strokeWidth: 2, cornerRadius: 6 }));
        grp.add(new Konva.Rect({ x: 12, y: 26, width: 150, height: 78, fill: '#9aa0a6', stroke: '#5f656b', strokeWidth: 2, cornerRadius: 8 }));
        for (let i = 0; i < 6; i++) grp.add(new Konva.Line({ points: [22 + i * 22, 32, 22 + i * 22, 98], stroke: '#7f858b', strokeWidth: 4 }));
        grp.add(new Konva.Rect({ x: 172, y: 16, width: 116, height: 98, fill: '#8d9298', stroke: '#5f656b', strokeWidth: 2, cornerRadius: 8 }));
        grp.add(new Konva.Rect({ x: 182, y: 32, width: 30, height: 72, fill: '#20262b', stroke: '#111', strokeWidth: 2, cornerRadius: 3 }));
        [0, 50, 100].forEach(v => grp.add(new Konva.Text({ x: 216, y: 32 + (100 - v) * 0.72 - 5, width: 20, text: String(v), fontSize: 10, fill: '#37474f' })));
        this._staticGroup.add(grp);
    }

    _drawOilSeparator(x, y) {
        const g = this._staticGroup, w = 55, h = 115;
        this._tube(x, y, w, h, true);
        // 顶部青色液位数字框
        g.add(new Konva.Rect({ x: x + w / 2 - 16, y: y - 15, width: 32, height: 16, fill: '#00e5e5', stroke: '#00c4c4', strokeWidth: 1, cornerRadius: 2 }));
        // 液位视窗（黑底）
        g.add(new Konva.Rect({ x: x + 10, y: y + 16, width: 22, height: 84, fill: '#20262b', stroke: '#111', strokeWidth: 1.5, cornerRadius: 2 }));
        // 刻度
        [0, 50, 100].forEach(v => g.add(new Konva.Text({ x: x + 34, y: y + 16 + (100 - v) * 0.84 - 5, text: String(v), fontSize: 8, fill: '#37474f' })));
    }

    _drawCondenser(x, y, w, h) {
        // 尺寸缩小为原来的 2/3
        const grp = new Konva.Group({ x, y, scaleX: 2 / 3, scaleY: 2 / 3 });
        grp.add(new Konva.Rect({ x: 0, y: 0, width: w, height: h, fill: '#b0b6bc', stroke: '#5f656b', strokeWidth: 2, cornerRadius: 26 }));
        grp.add(new Konva.Rect({ x: -8, y: 14, width: 18, height: h - 28, fill: '#8d9298', stroke: '#5f656b', strokeWidth: 1.5, cornerRadius: 4 }));
        grp.add(new Konva.Rect({ x: w - 10, y: 14, width: 18, height: h - 28, fill: '#8d9298', stroke: '#5f656b', strokeWidth: 1.5, cornerRadius: 4 }));
        grp.add(new Konva.Rect({ x: w / 2 - 32, y: -26, width: 64, height: 30, fill: '#b0b6bc', stroke: '#5f656b', strokeWidth: 2, cornerRadius: 6 }));
        grp.add(new Konva.Rect({ x: w / 2 - 32, y: h - 4, width: 64, height: 30, fill: '#b0b6bc', stroke: '#5f656b', strokeWidth: 2, cornerRadius: 6 }));
        this._staticGroup.add(grp);
    }

    /** 滑油注入口/出口接头（两根短竖条） */
    _oilPort(x, y) {
        const g = this._staticGroup;
        g.add(new Konva.Rect({ x: x - 9, y: y - 8, width: 6, height: 16, fill: '#f2a30f', stroke: '#b8860b', strokeWidth: 1 }));
        g.add(new Konva.Line({ points: [x - 1, y - 9, x - 1, y + 9], stroke: '#b8860b', strokeWidth: 3 }));
    }

    _drawMachines() {
        const M = this.MAG, TH = this.THIN;
        this._drawCompressor(240, 520);
        this._text(240, 501, 200, '一号压缩机', 13, '#2c3e50', 'center', true);
        this._drawCompressor(800, 520);
        this._text(800, 501, 200, '二号压缩机', 13, '#2c3e50', 'center', true);

        this._drawOilSeparator(575, 430);
        this._text(640, 438, 200, '一号油液分离器', 12, '#37474f', 'left', true);
        this._drawOilSeparator(1135, 430);
        this._text(1200, 438, 200, '二号油液分离器', 12, '#37474f', 'left', true);

        this._drawCondenser(597, 680, 250, 100);
        this._text(480, 715, 120, '一号冷凝器', 13, '#2c3e50', 'center', true);
        this._drawCondenser(1167, 665, 220, 100);
        this._text(1322, 690, 66, '二号冷凝器', 13, '#2c3e50', 'left', true);

        // （原冷却水系统的流向箭头已随水路一并删除）

        // 压缩机出口 → 截止阀 → 油分离器【左侧输入口】
        this._thin([390, 520, 390, 445, 575, 445], this.PUR);
        this._thin([950, 520, 950, 445, 1135, 445], this.PUR);
        // 油分离器【右侧输出口】→ 往右 → 往下 → 直接接入冷凝器顶部
        this._thin([630, 470, 680, 470, 680, 663], this.PUR);
        this._thin([1190, 470, 1240, 470, 1240, 648], this.PUR);
        // 滑油：油分离器底部 → 向下 30px → 向左（水平段装电磁阀）→ 压缩机右边缘靠下接口
        this._thin([602, 545, 602, 575, 440, 575], this.OIL);
        this._thin([1162, 545, 1162, 575, 1000, 575], this.OIL);
        // 滑油注入口 / 出口（压缩机下方，紧凑布置，各带截止阀）
        // 注入口管路左端直接接在接头竖条（x=179）上，确保连通
        this._thin([179, 650, 285, 650, 285, 607], this.OIL);
        this._oilPort(180, 650);
        this._text(150, 631, 78, '滑油注入口', 13, '#37474f', 'center', true);
        this._thin([370, 607, 370, 650, 435, 650], this.OIL);
        this._text(448, 631, 70, '滑油出口', 13, '#37474f', 'center', true);
        this._thin([739, 650, 845, 650, 845, 607], this.OIL);
        this._oilPort(740, 650);
        this._thin([930, 607, 930, 650, 995, 650], this.OIL);
        this._text(1008, 631, 70, '滑油出口', 13, '#37474f', 'center', true);

        // 冷却水：一号冷凝器右侧、二号冷凝器左侧接入
        // 侧接口（识别为 18×72、缩放 2/3 的灰色短管）上边缘/下边缘分别接出水、进水
        // 一号机：接口 y 689.3~737.3（组件 y=680）；二号机：接口 y 674.3~722.3（组件 y=665）
        this._thin([767, 692, 890, 692, 890, 765], this.WAT);    // 一号机冷却水出口（接接口上边缘，不合流，向下）
        this._thin([1163, 677, 1010, 677, 1010, 765], this.WAT); // 二号机冷却水出口（接接口上边缘，不合流，向下）
        this._thin([767, 735, 850, 735, 850, 830], this.WAT);    // 一号机冷却水进口（接接口下边缘）
        this._thin([1163, 720, 1050, 720, 1050, 830], this.WAT); // 二号机冷却水进口（接接口下边缘）
        this._thin([775, 830, 1050, 830], this.WAT);             // 自低温冷却淡水系统（进水汇合，左侧保留一半引入段）
        this._arrow(890, 730, 90, this.WAT, 6);                  // 出水向下箭头
        this._arrow(1010, 730, 90, this.WAT, 6);
        this._arrow(810, 735, 180, this.WAT, 6);                 // 进水向内箭头（一号机 ←）
        this._arrow(1110, 720, 0, this.WAT, 6);                  // 进水向内箭头（二号机 →）
        this._text(812, 836, 200, '自低温冷却淡水系统', 14, '#1565c0', 'center', true);

        // 冷凝器出口 → 各自截止阀 → 两路合流 → 接收器右侧入口
        this._thin([680, 764, 680, 870], M);
        this._thin([1240, 749, 1240, 870], M);
        this._thin([279, 870, 1240, 870], M);   // 接收器右侧入口：止于筒体右边缘（x=280），不再插入内部
    }

    // ═══════════════════════════════════════════════════════
    // 阀门
    // ═══════════════════════════════════════════════════════

    _drawValves() {
        const M = this.MAG, P = this.PUR, O = this.OIL, W = this.WAT, BL = '#37474f';

        // 库内：供液电磁阀 / 旁通阀 / 出口截止阀
        this.rooms.forEach(r => {
            const x0 = r.cx - 110, y0 = 80;
            this._vSolenoid('sup-' + r.key, x0 + 147, y0 + 32, BL, 0.85, 0);  // 供液电磁阀（库宽 2/3 处）
            this._vHand('byp-' + r.key, x0 + 30, y0 + 155, P, 0.9, 90);        // 旁通截止阀（与蒸发器中部对齐）
            this._vHand('out-' + r.key, x0 + 130, y0 + 230, M, 0.9, 90);       // 出口截止阀
        });

        this._vSolenoid('liq', 58, 400, P, 1, -90);  // 回热器下方的供液电磁阀（线圈朝左，接控制器虚线）
        this._vHand('liq-main', 58, 560, P, 1, 90);       // 视液镜下方的截止阀（干燥&过滤之上）
        this._vHand('suc1', 270, 455, P, 0.9, 90);        // 一号压缩机入口截止阀
        this._vHand('suc2', 830, 455, P, 0.9, 90);        // 二号压缩机入口截止阀
        this._vHand('oil1-in', 240, 650, O, 0.9, 0);      // 一号机滑油注入口截止阀
        this._vHand('oil1-out', 400, 650, O, 0.9, 0);     // 一号机滑油出口截止阀
        this._vHand('oil2-in', 800, 650, O, 0.9, 0);      // 二号机滑油注入口截止阀
        this._vHand('oil2-out', 960, 650, O, 0.9, 0);     // 二号机滑油出口截止阀
        this._vHand('cw1', 850, 785, W, 1, 90);           // 一号机冷却水进口截止阀（竖直管）
        this._vHand('cw2', 1050, 785, W, 1, 90);          // 二号机冷却水进口截止阀（竖直管）
        this._vHand('dis1', 480, 445, M, 1, 0);           // 一号压缩机出口截止阀
        this._vHand('dis2', 1040, 445, M, 1, 0);          // 二号压缩机出口截止阀
        this._vSolenoid('oil-sol1', 520, 575, O, 0.9, 0); // 油分下方油管电磁阀（水平段）
        this._vSolenoid('oil-sol2', 1080, 575, O, 0.9, 0);
        this._vHand('chg', 110, 745, M, 0.9, 0);          // 制冷剂注入口截止阀
        this._vHand('rec-out', 140, 800, M, 0.9, 0);      // 接收器出口截止阀
        this._vHand('cond1-out', 680, 800, M, 1, 90);     // 一号冷凝器出口截止阀
        this._vHand('cond2-out', 1240, 800, M, 1, 90);    // 二号冷凝器出口截止阀
    }

    _drawTags() {
        // 回热器右上管道（回气总管）压力：各蒸发器出口汇合压力，动态显示
        this._suctionPTag = new Konva.Text({
            x: 140, y: 345, width: 90, text: 'P 0.20', fontSize: 15,
            fontStyle: 'bold', fill: '#1565c0', align: 'left', fontFamily: 'Arial',
        });
        this._dynamicGroup.add(this._suctionPTag);
        // 压缩机入口压力（动态）：入口截止阀开启 = 蒸发器输出管路压力；关闭降至约 0.1bar
        this._psuc1Tag = new Konva.Text({
            x: 280, y: 485, width: 90, text: 'P 0.10', fontSize: 15,
            fontStyle: 'bold', fill: '#1565c0', align: 'left', fontFamily: 'Arial',
        });
        this._dynamicGroup.add(this._psuc1Tag);
        // 压缩机入口压力（动态）：入口截止阀开启 = 蒸发器输出管路压力；关闭降至约 0.1bar
        this._psuc2Tag = new Konva.Text({
            x: 820, y: 485, width: 90, text: 'P 0.10', fontSize: 15,
            fontStyle: 'bold', fill: '#1565c0', align: 'left', fontFamily: 'Arial',
        });
        this._dynamicGroup.add(this._psuc2Tag);
        // 压缩机排气压力（动态）：正常 = 入口压力 + 10bar，冷却水断流且运行时升至约 30bar
        this._pdis1Tag = new Konva.Text({
            x: 400, y: 420, width: 90, text: 'P 14.50', fontSize: 15,
            fontStyle: 'bold', fill: '#1565c0', align: 'left', fontFamily: 'Arial',
        });
        this._dynamicGroup.add(this._pdis1Tag);
        // 压缩机排气压力（动态）：规则同 1 号机出口
        this._pdis2Tag = new Konva.Text({
            x: 960, y: 420, width: 90, text: 'P 11.00', fontSize: 15,
            fontStyle: 'bold', fill: '#1565c0', align: 'left', fontFamily: 'Arial',
        });
        this._dynamicGroup.add(this._pdis2Tag);
    }

    // ═══════════════════════════════════════════════════════
    // 动态节点
    // ═══════════════════════════════════════════════════════

    _drawDynamic() {
        const d = this._dynamicGroup;
        this._roomNodes = [];
        this.rooms.forEach(r => {
            const x0 = r.cx - 110, y0 = 80;
            const fan = new Konva.Group({ x: x0 + 132, y: y0 + 152 });
            fan.add(new Konva.Circle({ radius: 34, fill: '#d9e6ea', stroke: '#4a7c86', strokeWidth: 2 }));
            const n = 12;
            for (let i = 0; i < n; i++) {
                fan.add(new Konva.Path({
                    x: 0, y: 0, rotation: (360 / n) * i,
                    data: 'M 0 -4 C 13 -8 20 -18 19 -31 C 10 -24 3 -13 0 -4 Z',
                    fill: '#8a9aa0', stroke: '#5b727a', strokeWidth: 1,
                }));
            }
            fan.add(new Konva.Circle({ radius: 9, fill: '#5b727a', stroke: '#3d525a', strokeWidth: 1 }));
            d.add(fan);
            // 蒸发器风机【带灯按钮】：上=起动，下=停止
            const bezelOn = new Konva.Circle({ x: x0 + 198, y: y0 + 118, radius: 19, fill: '#eef3f5', stroke: '#8fa3ad', strokeWidth: 2 });
            const bezelOff = new Konva.Circle({ x: x0 + 198, y: y0 + 158, radius: 19, fill: '#eef3f5', stroke: '#8fa3ad', strokeWidth: 2 });
            const green = new Konva.Circle({ x: x0 + 198, y: y0 + 118, radius: 13, fill: '#0b3d0b', stroke: '#08300b', strokeWidth: 2 });
            const red = new Konva.Circle({ x: x0 + 198, y: y0 + 158, radius: 13, fill: '#3d0b0b', stroke: '#300808', strokeWidth: 2 });
            const tText = new Konva.Text({ x: x0 + 118, y: y0 + 58, width: 110, text: 'T --.--', fontSize: 14, fontStyle: 'bold', fill: '#102a43', fontFamily: 'monospace' });
            // 温度开关本体（动态）：库温 > 启动值时点亮（亮绿色）
            const sw = new Konva.Rect({ x: x0 + 9, y: y0 + 24, width: 12, height: 14, fill: '#ecf0f1', stroke: '#7f8c8d', strokeWidth: 2, cornerRadius: 2 });
            d.add(bezelOn, bezelOff, green, red, tText, sw);
            this._roomNodes.push({ fan, green, red, tText, sw, key: r.key });

            // 按钮命中区：上「起动」→ 风机运行；下「停止」→ 风机停机
            const hitOn = this.addClickablePart('fan-on-' + r.key, x0 + 177, y0 + 97, 42, 42);
            if (hitOn) hitOn.on('click tap', () => this.setRoomFan(r.key, true));
            const hitOff = this.addClickablePart('fan-off-' + r.key, x0 + 177, y0 + 137, 42, 42);
            if (hitOff) hitOff.on('click tap', () => this.setRoomFan(r.key, false));
        });

        this._oil1 = new Konva.Rect({ x: 361, y: 541, width: 20, height: 48, fill: '#f2a30f', cornerRadius: 2 });
        this._run1 = new Konva.Circle({ x: 403, y: 563, radius: 8, fill: '#0b3d0b', stroke: '#08300b', strokeWidth: 2 });
        d.add(this._oil1, this._run1);
        this._oil2 = new Konva.Rect({ x: 921, y: 541, width: 20, height: 48, fill: '#f2a30f', cornerRadius: 2 });
        this._run2 = new Konva.Circle({ x: 963, y: 563, radius: 8, fill: '#0b3d0b', stroke: '#08300b', strokeWidth: 2 });
        d.add(this._oil2, this._run2);

        this._os1 = new Konva.Rect({ x: 587, y: 446, width: 18, height: 84, fill: '#f2a30f', cornerRadius: 2 });
        this._os2 = new Konva.Rect({ x: 1147, y: 446, width: 18, height: 84, fill: '#f2a30f', cornerRadius: 2 });
        d.add(this._os1, this._os2);
        this._os1Text = new Konva.Text({ x: 575, y: 418, width: 55, text: '10', fontSize: 12, fontStyle: 'bold', fill: '#111111', align: 'center', fontFamily: 'monospace' });
        this._os2Text = new Konva.Text({ x: 1135, y: 418, width: 55, text: '10', fontSize: 12, fontStyle: 'bold', fill: '#111111', align: 'center', fontFamily: 'monospace' });
        d.add(this._os1Text, this._os2Text);

        this._recv = new Konva.Rect({ x: 222, y: 842, width: 20, height: 52, fill: '#bfc7cc', cornerRadius: 2 });
        this._recvText = new Konva.Text({ x: 232, y: 812, width: 36, text: '60', fontSize: 14, fontStyle: 'bold', fill: '#111111', align: 'center', fontFamily: 'monospace' });
        d.add(this._recv, this._recvText);

        this._cond1T = new Konva.Text({ x: 560, y: 715, width: 240, text: 'T 30.2', fontSize: 16, fontStyle: 'bold', fill: '#1b5e20', align: 'center', fontFamily: 'monospace' });
        this._cond2T = new Konva.Text({ x: 1125, y: 700, width: 230, text: 'T 30.2', fontSize: 16, fontStyle: 'bold', fill: '#1b5e20', align: 'center', fontFamily: 'monospace' });
        d.add(this._cond1T, this._cond2T);
    }

    _registerParts() {
        const ctrl = this.addClickablePart('controller', 30, 15, 100, 41);
        if (ctrl) ctrl.on('click tap', () => this.toggleController());
        this.addClickablePart('comp1', 240, 520, 200, 87);
        this.addClickablePart('comp2', 800, 520, 200, 87);
        this.rooms.forEach(r => this.addClickablePart('evap-' + r.key, r.cx - 17, 178, 77, 94));
        this.addClickablePart('cond1', 597, 680, 167, 67);
        this.addClickablePart('cond2', 1167, 665, 147, 67);
        this.addClickablePart('regen', 33, 109, 54, 207);
        this.addClickablePart('oilsep_acc', 130, 405, 72, 95);
        this.addClickablePart('receiver', 210, 790, 70, 115);
        this.addClickablePart('dryer', 30, 630, 55, 90);
    }

    // ═══════════════════════════════════════════════════════
    // 求解器回写
    // ═══════════════════════════════════════════════════════

    acceptModel(m) {
        this._roomNodes.forEach(rn => {
            const r = m.rooms && m.rooms[rn.key];
            if (!r) return;
            rn.tText.text('T ' + r.temp.toFixed(2));
            // 带灯按钮：风机运行 → 上（起动）亮绿、下（停止）暗红；停机 → 上暗绿、下亮红
            rn.green.fill(r.fanOn ? '#00e83a' : '#0b3d0b');
            rn.red.fill(r.fanOn ? '#3d0b0b' : '#ff2020');
            // 温度开关：库温高于启动值点亮（亮绿色）
            if (rn.sw) rn.sw.fill(r.swOn ? '#00e83a' : '#ecf0f1');
            // 供液电磁阀随该库是否供液导通
            this.setSolenoid('sup-' + rn.key, !!r.solOpen);
        });

        // 控制器框：工作状态填充亮绿色背景
        if (this._ctrlBox) this._ctrlBox.fill(m.ctrlOn ? '#00e83a' : '#f4f6f7');

        // 主管路电磁阀：总供液阀随总供液状态、油分油管阀随对应压缩机运行
        this.setSolenoid('liq', !!m.masterSol);
        this.setSolenoid('oil-sol1', !!(m.comps && m.comps.comp1 && m.comps.comp1.running));
        this.setSolenoid('oil-sol2', !!(m.comps && m.comps.comp2 && m.comps.comp2.running));

        const c1 = m.comps && m.comps.comp1, c2 = m.comps && m.comps.comp2;
        if (c1) { this._run1.fill(c1.running ? '#00e83a' : '#0b3d0b'); const h = 48 * (c1.oilLevel / 100); this._oil1.height(h); this._oil1.y(589 - h); }
        if (c2) { this._run2.fill(c2.running ? '#00e83a' : '#0b3d0b'); const h = 48 * (c2.oilLevel / 100); this._oil2.height(h); this._oil2.y(589 - h); }
        if (m.oilsep) {
            const h1 = 84 * ((m.oilsep.comp1 || 0) / 100);
            this._os1.height(Math.max(4, h1)); this._os1.y(530 - Math.max(4, h1));
            this._os1Text.text(String(Math.round(m.oilsep.comp1 || 0)));
            const h2 = 84 * ((m.oilsep.comp2 || 0) / 100);
            this._os2.height(Math.max(4, h2)); this._os2.y(530 - Math.max(4, h2));
            this._os2Text.text(String(Math.round(m.oilsep.comp2 || 0)));
        }
        if (m.receiver !== undefined) {
            const h = 52 * (m.receiver / 100);
            this._recv.height(h); this._recv.y(894 - h);
            this._recvText.text(String(Math.round(m.receiver)));
        }
        if (this._cond1T) this._cond1T.text('T ' + (m.running ? m.tc : m.tcwIn).toFixed(1));
        if (this._cond2T) this._cond2T.text('T ' + (m.running ? m.tc : m.tcwIn).toFixed(1));
        // 压力动态标签（单位 bar）
        if (this._suctionPTag && m.pe !== undefined) this._suctionPTag.text('P ' + m.pe.toFixed(2));
        if (this._psuc1Tag && m.psuc1 !== undefined) this._psuc1Tag.text('P ' + m.psuc1.toFixed(2));
        if (this._psuc2Tag && m.psuc2 !== undefined) this._psuc2Tag.text('P ' + m.psuc2.toFixed(2));
        if (this._pdis1Tag && m.pdis1 !== undefined) this._pdis1Tag.text('P ' + m.pdis1.toFixed(2));
        if (this._pdis2Tag && m.pdis2 !== undefined) this._pdis2Tag.text('P ' + m.pdis2.toFixed(2));
    }

    tick(dt) {
        const m = this.sys && this.sys.refrigSolver ? this.sys.refrigSolver.m : null;
        this._roomNodes && this._roomNodes.forEach(rn => {
            const r = m && m.rooms && m.rooms[rn.key];
            if (r && r.fanOn) rn.fan.rotation((rn.fan.rotation() + 240 * dt) % 360);
        });
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

export default RefrigerationSystem;
