import Konva from 'konva';
import { BaseComponent } from './BaseComponent.js';
import { ac600Of } from '../tools/AC600Solver.js';

/**
 * Ac600PneumaticSystem — 主机气动操纵系统图（起动空气 / 控制空气 / 操纵阀件）
 * ═══════════════════════════════════════════════════════════════
 *  1600 × 800 工艺图（照 MAN B&W AC 600 气动操纵系统图版式）：
 *    左：空压机与干燥器组（虚线框）→ 安全阀组 → 起动空气总管
 *    中上：起动空气 28.3 Bar（83）→ 主起动阀（工作 / 阻塞指示）→ 慢转起动阀（118）
 *          气缸起动阀组 A / B / 92（编号 94 / 93 / 92）与阀 12 / 23
 *    右上：1 号气缸起动阀（06）、阀 26
 *    右：主机转速 68.0 rpm
 *    中下：盘车机（115）Disengaged、控制空气 7.0 Bar、40 L 气瓶、阀 1 / 3 / 58
 *          基于主机负荷的缸套冷却水温度控制（虚线框）
 *
 *  数据全部取自 sys.ac600：
 *    起动机过程中主起动阀"工作"（绿），起动空气压力下降；盘车机合上时显示 Engaged，
 *    控件可点击：主起动阀 / 慢转起动阀 / 盘车机 / 1 号气缸起动阀 / 转速标签。
 *
 *  部件 id：start-air main-valve slow-valve cyl-valve turning-gear ctrl-air rpm-tag bottle valve-58
 * ═══════════════════════════════════════════════════════════════
 */

const W = 1600, H = 800;

const _rect = (o) => new Konva.Rect(Object.assign({ listening: false }, o));
const _text = (o) => new Konva.Text(Object.assign({ listening: false, fontFamily: 'Arial, Microsoft YaHei' }, o));
const _line = (o) => new Konva.Line(Object.assign({ listening: false }, o));
const _circle = (o) => new Konva.Circle(Object.assign({ listening: false }, o));

const C_BG = '#eef1f4';
const C_PIPE = '#2b5f8f';
const C_PIPE_D = '#8ba7c2';
const C_TAG = '#2f7d32';
const C_BOX = '#3a5f86';
const C_BOX_T = '#ffffff';

export class Ac600PneumaticSystem extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.W = W;
        this.H = H;
        this.width = W;
        this.height = H;
        this.type = 'ac600_pneumatic';
        this.cache = 'fixed';

        this.model = ac600Of(sys);
        this._pipes = [];

        this._initGroups();
        this._init();

        this.config = { id: this.id };
    }

    _tip(msg, ms) {
        if (this.sys && this.sys._suppressComponentTips) return;
        if (this.sys && this.sys.showFloatingTip) this.sys.showFloatingTip(msg, ms || 2200);
    }

    _redraw() {
        if (this.sys && this.sys.requestRedraw) this.sys.requestRedraw();
    }

    _init() {
        this._drawStatic();
        this._createDynamic();
        this._bindInteraction();
        this._addDragPlate();
    }

    _addDragPlate() {
        const plate = new Konva.Rect({ x: 0, y: 0, width: W, height: H, fill: 'rgba(0,0,0,0.001)', listening: true });
        this._interactGroup.add(plate);
        plate.moveToBottom();
    }

    // ═══════════════════════════════════════════════════════
    //  图形基元
    // ═══════════════════════════════════════════════════════

    /** 管路（折线） */
    _pipe(s, pts, width = 5, color = C_PIPE) {
        s.add(_line({ points: pts, stroke: color, strokeWidth: width, lineCap: 'round', lineJoin: 'round' }));
    }

    /** 蓝色数值方框（带浅灰标题牌） */
    _valBox(s, x, y, w, h, label, value, key) {
        s.add(_rect({ x, y, width: w, height: h, fill: '#c9d3dc', stroke: '#8fa0b0', strokeWidth: 1.4, cornerRadius: 3 }));
        s.add(_text({ x: x + 4, y: y + 6, width: w - 8, align: 'center', fontSize: 14, fill: '#2a3a48', text: label }));
        s.add(_rect({ x: x + 8, y: y + 28, width: w - 16, height: h - 36, fill: C_BOX, stroke: '#2b4866', strokeWidth: 1.2, cornerRadius: 2 }));
        this._valTxt = this._valTxt || {};
        const t = _text({ x: x + 8, y: y + 34, width: w - 16, align: 'center', fontSize: 16, fontStyle: 'bold', fill: C_BOX_T, text: value });
        this._dynamicGroup.add(t);
        this._valTxt[key] = t;
    }

    /** 绿色编号圆牌 */
    _tag(s, x, y, num) {
        s.add(_rect({ x: x - 18, y: y - 11, width: 36, height: 22, fill: C_TAG, stroke: '#1d4f20', strokeWidth: 1, cornerRadius: 3 }));
        s.add(_text({ x: x - 18, y: y - 8, width: 36, align: 'center', fontSize: 12.5, fill: '#ffffff', text: String(num) }));
    }

    /** 灰色编号圆牌（阀件号） */
    _numTag(s, x, y, num) {
        s.add(_circle({ x, y, radius: 13, fill: '#f4f5f6', stroke: '#7d8894', strokeWidth: 1.4 }));
        s.add(_text({ x: x - 13, y: y - 7, width: 26, align: 'center', fontSize: 11.5, fill: '#2a3a48', text: String(num) }));
    }

    /** 主起动阀 / 慢转起动阀：圆 + 横杆（蝶阀符号） */
    _mainValve(s, cx, cy, R) {
        s.add(_circle({ x: cx, y: cy, radius: R, fill: '#f7f8f9', stroke: C_PIPE, strokeWidth: 3 }));
        s.add(_line({ points: [cx - R, cy, cx + R, cy], stroke: C_PIPE, strokeWidth: 3 }));
        s.add(_line({ points: [cx, cy - R, cx, cy + R], stroke: C_PIPE, strokeWidth: 2, dash: [4, 4] }));
        // 执行机构
        s.add(_rect({ x: cx + R + 4, y: cy - 16, width: 44, height: 32, fill: '#f7f8f9', stroke: C_PIPE, strokeWidth: 2 }));
        s.add(_line({ points: [cx + R, cy, cx + R + 4, cy], stroke: C_PIPE, strokeWidth: 2 }));
    }

    /** 三通/二通换向阀（方框 + 箭头） */
    _dirValve(s, x, y, w, h, arrows) {
        s.add(_rect({ x, y, width: w, height: h, fill: '#f7f8f9', stroke: C_PIPE, strokeWidth: 2 }));
        (arrows || []).forEach(([x1, y1, x2, y2]) => {
            s.add(_line({ points: [x1, y1, x2, y2], stroke: C_PIPE, strokeWidth: 2 }));
        });
    }

    /** 气缸起动阀（圆圈 + 阀杆） */
    _cylValve(s, cx, cy, R, withBox) {
        if (withBox) s.add(_rect({ x: cx - R - 34, y: cy - R - 26, width: (R + 40) * 2, height: (R + 40) * 2, fill: 'rgba(0,0,0,0)', stroke: '#5b7fa3', strokeWidth: 1.6, dash: [6, 4] }));
        s.add(_circle({ x: cx, y: cy, radius: R, fill: '#f7f8f9', stroke: C_PIPE, strokeWidth: 3 }));
        s.add(_line({ points: [cx - R, cy, cx + R, cy], stroke: C_PIPE, strokeWidth: 3 }));
        s.add(_rect({ x: cx - 10, y: cy + R, width: 20, height: 26, fill: '#f7f8f9', stroke: C_PIPE, strokeWidth: 2 }));
    }

    // ═══════════════════════════════════════════════════════
    //  静态图
    // ═══════════════════════════════════════════════════════

    _drawStatic() {
        const s = this._staticGroup;
        s.add(_rect({ x: 0, y: 0, width: W, height: H, fill: C_BG }));

        // ── 空压机 / 干燥器组（虚线框）──
        s.add(_rect({ x: 40, y: 30, width: 420, height: 280, fill: 'rgba(0,0,0,0)', stroke: '#8fa0b0', strokeWidth: 1.6, dash: [8, 6], cornerRadius: 4 }));
        // 两台干燥器
        [110, 300].forEach((cx) => {
            s.add(_rect({ x: cx - 26, y: 70, width: 52, height: 120, fill: '#f7f8f9', stroke: C_PIPE, strokeWidth: 2.4, cornerRadius: 6 }));
            s.add(new Konva.Line({
                points: [cx, 78, cx - 14, 100, cx + 14, 120, cx - 14, 140, cx + 14, 160, cx, 182],
                stroke: C_PIPE, strokeWidth: 1.6, tension: 0,
            }));
        });
        // 安全阀 / 滤器 / 止回阀
        this._dirValve(s, 190, 96, 60, 46, [[196, 119, 244, 119]]);
        this._dirValve(s, 190, 176, 60, 46, [[196, 199, 244, 199]]);
        s.add(_circle({ x: 330, y: 96, radius: 16, fill: '#f7f8f9', stroke: C_PIPE, strokeWidth: 2 }));
        s.add(_line({ points: [316, 82, 344, 110], stroke: C_PIPE, strokeWidth: 2 }));
        s.add(_line({ points: [344, 82, 316, 110], stroke: C_PIPE, strokeWidth: 2 }));
        s.add(_circle({ x: 330, y: 216, radius: 16, fill: '#f7f8f9', stroke: C_PIPE, strokeWidth: 2 }));
        s.add(_line({ points: [316, 202, 344, 230], stroke: C_PIPE, strokeWidth: 2 }));
        s.add(_line({ points: [344, 202, 316, 230], stroke: C_PIPE, strokeWidth: 2 }));
        // 组内管路
        this._pipe(s, [60, 120, 84, 120, 84, 120], 4);
        this._pipe(s, [84, 120, 84, 200], 4);
        this._pipe(s, [84, 120, 250, 120], 4);
        this._pipe(s, [84, 200, 250, 200], 4);
        this._pipe(s, [250, 120, 250, 200], 4);
        this._pipe(s, [250, 120, 330, 120], 4);
        this._pipe(s, [330, 120, 330, 216], 4);
        this._pipe(s, [330, 216, 420, 216], 4);
        // 出口
        this._pipe(s, [460, 216, 560, 216], 6);
        this._pipe(s, [560, 216, 560, 140], 6);
        this._pipe(s, [560, 140, 640, 140], 6);
        s.add(_text({ x: 60, y: 300, width: 380, align: 'center', fontSize: 12.5, fill: '#4a5a68', text: '空压机 / 空气干燥器组（起动空气气源）' }));

        // ── 起动空气 28.3 Bar ──
        this._valBox(s, 640, 62, 210, 96, '起动空气', '28.3 Bar', 'startAir');
        this._tag(s, 604, 96, 83);
        this._pipe(s, [720, 158, 720, 186], 6);
        this._pipe(s, [720, 186, 1000, 186], 6);
        this._pipe(s, [1000, 186, 1000, 120], 6);
        this._pipe(s, [1000, 120, 1032, 120], 6);

        // ── 主起动阀（顶部）──
        this._mainValve(s, 1070, 120, 38);
        s.add(_text({ x: 1010, y: 46, width: 130, align: 'center', fontSize: 13, fill: '#2a3a48', text: '主起动阀' }));
        s.add(_rect({ x: 1150, y: 44, width: 46, height: 22, fill: '#d8dcdd', stroke: '#9aa1a5', strokeWidth: 1.2, cornerRadius: 3 }));
        s.add(_text({ x: 1150, y: 47, width: 46, align: 'center', fontSize: 12, fill: '#2a3a48', text: '工作' }));
        s.add(_rect({ x: 1206, y: 44, width: 46, height: 22, fill: '#d8dcdd', stroke: '#9aa1a5', strokeWidth: 1.2, cornerRadius: 3 }));
        s.add(_text({ x: 1206, y: 47, width: 46, align: 'center', fontSize: 12, fill: '#2a3a48', text: '阻塞' }));

        // 主起动阀后：总管
        this._pipe(s, [1070 + 52, 120, 1180, 120], 6);
        this._pipe(s, [1180, 120, 1180, 700], 6);
        // 慢转起动阀
        this._mainValve(s, 1300, 176, 30);
        s.add(_text({ x: 1266, y: 206, width: 120, align: 'center', fontSize: 12.5, fill: '#2a3a48', text: '慢转起动阀' }));
        this._pipe(s, [1180, 120, 1180, 176], 5);
        this._pipe(s, [1180, 176, 1270, 176], 5);
        this._pipe(s, [1330, 176, 1390, 176], 5);
        this._pipe(s, [1390, 176, 1390, 610], 5);
        // 阀 118
        this._dirValve(s, 1404, 196, 66, 46, [[1412, 219, 1462, 219]]);
        this._numTag(s, 1520, 200, 118);
        this._pipe(s, [1390, 196, 1390, 176], 4);

        // ── 气缸起动阀组 A / B / 92 ──
        s.add(_rect({ x: 1010, y: 226, width: 76, height: 320, fill: '#e3e8ec', stroke: '#9aa8b4', strokeWidth: 1.4 }));
        const cv = [['A', 262, 94], ['B', 386, 93], ['', 510, 92]];
        cv.forEach(([label, y, num]) => {
            if (label) s.add(_text({ x: 1010, y: y - 40, width: 76, align: 'center', fontSize: 13, fill: '#2a3a48', text: label }));
            this._dirValve(s, 1024, y - 20, 48, 60, [[1030, y + 10, 1066, y + 10]]);
            this._numTag(s, 976, y, num);
            this._pipe(s, [1072, y, 1180, y], 5);
        });
        // 阀 12 / 23
        this._dirValve(s, 1216, 246, 90, 52, [[1224, 272, 1298, 272]]);
        this._numTag(s, 1226, 214, 12);
        this._dirValve(s, 1216, 356, 90, 52, [[1224, 382, 1298, 382]]);
        this._numTag(s, 1226, 324, 23);

        // ── 1 号气缸起动阀 ──
        s.add(_rect({ x: 1300, y: 268, width: 280, height: 230, fill: '#eef2f5', stroke: '#5b7fa3', strokeWidth: 1.6 }));
        this._cylValve(s, 1420, 366, 30, false);
        this._tag(s, 1400, 288, '06');
        this._numTag(s, 1340, 366, 26);
        this._dirValve(s, 1310, 340, 56, 50, [[1318, 366, 1358, 366]]);
        s.add(_text({ x: 1424, y: 502, width: 156, align: 'center', fontSize: 12.5, fill: '#2a3a48', text: '1 号气缸起动阀' }));
        this._pipe(s, [1390, 268, 1390, 340], 5);

        // ── 主机转速 ──
        this._valBox(s, 1372, 542, 200, 88, '主机转速', '68.0 rpm', 'rpm');
        this._pipe(s, [1390, 498, 1390, 578], 4);

        // ── 1 号气缸排气阀 / 备用 ──
        s.add(_rect({ x: 250, y: 330, width: 240, height: 150, fill: '#eef2f5', stroke: '#5b7fa3', strokeWidth: 1.6 }));
        s.add(_text({ x: 250, y: 450, width: 240, align: 'center', fontSize: 12.5, fill: '#2a3a48', text: '1 号气缸排气阀' }));
        s.add(_rect({ x: 520, y: 352, width: 46, height: 118, fill: '#f7f8f9', stroke: C_PIPE, strokeWidth: 2 }));
        s.add(_text({ x: 512, y: 474, width: 64, align: 'center', fontSize: 12, fill: '#2a3a48', text: '...2' }));
        s.add(_rect({ x: 610, y: 352, width: 46, height: 118, fill: 'rgba(0,0,0,0)', stroke: '#8fa0b0', strokeWidth: 1.6, dash: [7, 5] }));
        s.add(_text({ x: 602, y: 474, width: 64, align: 'center', fontSize: 12, fill: '#2a3a48', text: '...#' }));
        this._pipe(s, [180, 400, 180, 330], 5);
        this._pipe(s, [180, 330, 1180, 330], 5);

        // ── 缸套冷却水温度控制（虚线框）──
        s.add(_rect({ x: 330, y: 556, width: 470, height: 164, fill: 'rgba(0,0,0,0)', stroke: '#8fa0b0', strokeWidth: 1.6, dash: [8, 6] }));
        s.add(_rect({ x: 420, y: 582, width: 60, height: 40, fill: '#f7f8f9', stroke: C_PIPE, strokeWidth: 2 }));
        s.add(_circle({ x: 520, y: 602, radius: 20, fill: '#f7f8f9', stroke: C_PIPE, strokeWidth: 2 }));
        s.add(_line({ points: [506, 588, 534, 616], stroke: C_PIPE, strokeWidth: 2 }));
        s.add(_rect({ x: 580, y: 572, width: 70, height: 62, fill: '#f7f8f9', stroke: C_PIPE, strokeWidth: 2 }));
        s.add(_circle({ x: 700, y: 602, radius: 28, fill: '#f7f8f9', stroke: C_PIPE, strokeWidth: 2 }));
        s.add(_line({ points: [700, 574, 700, 630], stroke: C_PIPE, strokeWidth: 2 }));
        s.add(_text({ x: 330, y: 644, width: 470, align: 'center', fontSize: 12.5, fill: '#2a3a48', text: '基于主机负荷的缸套冷却水温度控制' }));
        this._pipe(s, [330, 602, 420, 602], 4);
        this._pipe(s, [480, 602, 500, 602], 4);
        this._pipe(s, [540, 602, 580, 602], 4);
        this._pipe(s, [650, 602, 672, 602], 4);

        // ── 盘车机 ──
        this._valBox(s, 1000, 640, 210, 92, '盘车机', 'Disengaged', 'turningGear');
        this._numTag(s, 950, 622, 115);
        this._dirValve(s, 868, 598, 66, 48, [[876, 622, 926, 622]]);
        this._pipe(s, [1180, 700, 1210, 700], 4);

        // ── 控制空气 7.0 Bar ──
        this._valBox(s, 700, 700, 200, 88, '控制空气', '7.0 Bar', 'ctrlAir');
        this._pipe(s, [880, 700, 900, 700], 5);

        // ── 40 L 气瓶 / 阀 1 / 阀 3 ──
        s.add(new Konva.Ellipse({ x: 520, y: 744, radiusX: 60, radiusY: 30, fill: '#f7f8f9', stroke: C_PIPE, strokeWidth: 2.4, listening: false }));
        s.add(_text({ x: 475, y: 735, width: 90, align: 'center', fontSize: 12.5, fill: '#2a3a48', text: '40 L' }));
        this._pipe(s, [580, 744, 700, 744], 4);
        this._pipe(s, [460, 744, 300, 744], 4);
        this._dirValve(s, 236, 718, 64, 52, [[244, 744, 292, 744]]);
        this._numTag(s, 96, 744, 3);
        this._dirValve(s, 120, 718, 64, 52, [[128, 744, 176, 744]]);
        this._numTag(s, 210, 686, 1);
        this._pipe(s, [300, 744, 300, 500], 4);
        this._pipe(s, [300, 500, 1180, 500], 4);

        // ── 阀 58 ──
        this._dirValve(s, 1330, 470, 90, 52, [[1338, 496, 1412, 496]]);
        this._numTag(s, 1338, 440, 58);
        this._pipe(s, [1180, 496, 1330, 496], 4);
        this._pipe(s, [1420, 496, 1390, 496], 4);
    }

    // ═══════════════════════════════════════════════════════
    //  动态
    // ═══════════════════════════════════════════════════════

    _createDynamic() {
        const d = this._dynamicGroup;

        // 主起动阀"工作"灯 / "阻塞"灯
        this._workLamp = _rect({ x: 1150, y: 44, width: 46, height: 22, fill: '#d8dcdd', cornerRadius: 3 });
        d.add(this._workLamp);
        this._blockLamp = _rect({ x: 1206, y: 44, width: 46, height: 22, fill: '#d8dcdd', cornerRadius: 3 });
        d.add(this._blockLamp);
        this._workTxt = _text({ x: 1150, y: 47, width: 46, align: 'center', fontSize: 12, fill: '#2a3a48', text: '工作' });
        d.add(this._workTxt);
        this._blockTxt = _text({ x: 1206, y: 47, width: 46, align: 'center', fontSize: 12, fill: '#2a3a48', text: '阻塞' });
        d.add(this._blockTxt);

        // 起动空气总管带电（起动时蓝色变亮）
        this._livePipe = _line({ points: [720, 186, 1000, 186], stroke: C_PIPE, strokeWidth: 6, opacity: 0, lineCap: 'round' });
        d.add(this._livePipe);

        // 盘车机状态文字（值文本由 _valBox 建好）
        this._gearLamp = _circle({ x: 1210, y: 700, radius: 7, fill: '#3a3f42' });
        d.add(this._gearLamp);
    }

    // ═══════════════════════════════════════════════════════
    //  交互
    // ═══════════════════════════════════════════════════════

    _bindInteraction() {
        const M = this.model;
        const mk = (id, x, y, w, h, onClick) => {
            const hit = this.addClickablePart(id, x, y, w, h);
            if (onClick) hit.on('click tap', (e) => { e.cancelBubble = true; onClick(); this._redraw(); });
            return hit;
        };

        mk('start-air', 640, 62, 210, 96, () => this._tip(`起动空气压力 ${M.startAir.toFixed(1)} Bar（低于 15 Bar 不能起动）`));
        mk('main-valve', 1032, 82, 76, 76, () => {
            this._tip(M.starting ? '主起动阀：工作（起动中，向气缸供起动空气）'
                : (M.mainStartValveOk ? '主起动阀在工作位（图中"工作"灯亮）' : '主起动阀不在工作位 → 起动阻塞'));
        });
        mk('slow-valve', 1270, 146, 60, 60, () => this._tip('慢转起动阀：检修/冲车时不经调速器低速转车'));
        mk('cyl-valve', 1386, 332, 68, 68, () => this._tip('1 号气缸起动阀：按发火顺序由空气分配器控制开启'));
        mk('turning-gear', 1000, 640, 210, 92, () => { M.toggleTurningGear(); this._tip(M.turningGearOut ? '盘车机脱开（可起动）' : '盘车机合上（禁止起动）'); });
        mk('ctrl-air', 700, 700, 200, 88, () => this._tip(`控制空气 ${M.controlAir.toFixed(1)} Bar（供操纵阀件用）`));
        mk('rpm-tag', 1372, 542, 200, 88, () => this._tip(`主机转速 ${M.rpm.toFixed(1)} rpm`));
        mk('bottle', 460, 714, 120, 60, () => this._tip('40 L 控制空气气瓶：稳定控制空气压力'));
        mk('valve-58', 1330, 470, 90, 52, () => this._tip('阀 58：控制空气通断'));
    }

    // ═══════════════════════════════════════════════════════
    //  每帧刷新
    // ═══════════════════════════════════════════════════════

    tick() {
        const M = this.model;
        if (!M) return;
        const vt = this._valTxt || {};

        if (vt.startAir) vt.startAir.text(`${M.startAir.toFixed(1)} Bar`);
        if (vt.rpm) vt.rpm.text(`${M.rpm.toFixed(1)} rpm`);
        if (vt.ctrlAir) vt.ctrlAir.text(`${M.controlAir.toFixed(1)} Bar`);
        if (vt.turningGear) {
            vt.turningGear.text(M.turningGearOut ? 'Disengaged' : 'Engaged');
            vt.turningGear.fill(M.turningGearOut ? '#ffffff' : '#ffd24d');
        }

        // 主起动阀工作 / 阻塞
        const working = M.starting || M.mainStartValveOpen;
        const blocked = M.startBlocked || !M.mainStartValveOk;
        this._workLamp.fill(working ? '#1faa3c' : '#d8dcdd');
        this._blockLamp.fill(blocked ? '#c40000' : '#d8dcdd');
        this._workTxt.fill(working ? '#ffffff' : '#2a3a48');
        this._blockTxt.fill(blocked ? '#ffffff' : '#2a3a48');

        // 起动空气管路在起动时高亮
        this._livePipe.opacity(working ? 0.85 : 0);

        // 盘车机状态灯
        this._gearLamp.fill(M.turningGearOut ? '#1faa3c' : '#c40000');

        this.markDirty();
        this._refreshIfDirty();
        this._redraw();
    }
}
