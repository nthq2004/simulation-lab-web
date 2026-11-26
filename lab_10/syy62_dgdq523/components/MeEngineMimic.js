import Konva from 'konva';
import { BaseComponent } from './BaseComponent.js';
import imgMe from '../images/me_engine.png';   // 由 Vite 处理（构建时复制/内联）

/**
 * MeEngineMimic — 主机 ME 气缸与辅助系统（图片版 MIMIC，页 5）
 * ═══════════════════════════════════════════════════════════════
 *  底图：`images/me_engine.png`（原图 1736 × 1028），**等比 contain** 缩放进组件（1560 × 828）。
 *  叠加件的位置一律按**图片像素**锚定（`mx()/my()` 换算），改组件尺寸只改 W/H 即可。
 *
 *  交互/动画：
 *    ① **示功阀**（`indicator-valve`）—— 手动截止阀画法，点击开/关（开＝两个三角填充绿）
 *    ② **缸头起动阀**（`start-valve`）—— 电磁阀画法；与**气动操纵系统页 1 号起动电磁阀
 *       `cv1-pilot` 的线圈同步**：那边得电 → 这边线圈红填充、两个三角绿填充
 *    ③ **辅助鼓风机**（`blower`）—— 叶轮按鼓风机运行状态旋转
 *    ④ **液压动力泵**：右上 `Master`（电动机带动）/ 左侧 `Ctrl`（机带泵），徽标显示「运行 / 停止」
 *    ⑤ 右下角两只**电机控制盒**（辅助鼓风机 / 电动 HPS 动力泵）：
 *       一排 4 只指示灯（电源·运行·过载·压力正常）+ 第二排两只转换开关（电源 OFF/ON、
 *       本地/遥控）与起动/停止按钮。
 *
 *  控制逻辑在 `AC600Solver._stepAuxMachines()`：扫气压力由转速推算（20 rpm ≈ 0.072 MPa），
 *  遥控方式下压力正常 → 鼓风机自动停止；主机 20 rpm 以上机带泵（Ctrl）建压 → 电动泵
 *  （Master）遥控方式自动停止；主机停止时由电动泵提供液压动力（280 bar）。
 *
 *  部件 id（工作流 subTarget / op.part）：
 *    indicator-valve start-valve blower hps-ctrl hps-master scav-box
 *    bl-power bl-mode bl-start bl-stop hp-power hp-mode hp-start hp-stop
 * ═══════════════════════════════════════════════════════════════
 */

// 原图像素尺寸 → 组件坐标（等比 contain 居中）
const IMG_W = 1736, IMG_H = 1028;
const W = 1560, H = 828;
const K = Math.min(W / IMG_W, H / IMG_H);
const OX = (W - IMG_W * K) / 2;
const OY = (H - IMG_H * K) / 2;
const mx = (x) => OX + x * K;
const my = (y) => OY + y * K;

const EDGE = '#1f2a33';
const PIPE = '#5c7688';
const ON = '#2ecc40';            // 导通绿（阀门三角）
const COIL_ON = '#e53935';       // 线圈得电红
/** 指示灯配色：off = 未点亮（暗色）/ on = 点亮（亮色） */
const LAMP_STYLE = {
    power: { off: '#9aa3a9', on: '#ffffff' },   // 电源：灰 → 白
    run: { off: '#1d4a24', on: '#2ecc40' },     // 运行：暗绿 → 亮绿
    over: { off: '#4e1414', on: '#e53935' },    // 过载：暗红 → 亮红
    press: { off: '#4a3f10', on: '#ffe100' },   // 压力正常：暗黄 → 亮黄
};
const C_LAMP_OFF = LAMP_STYLE.power.off;
const BADGE_STOP = '#32508c';   // 泵停止：蓝
const BADGE_RUN = '#2ecc40';    // 泵运行：亮绿
const C_PANEL = '#dfe4e8';
const C_PANEL_EDGE = '#3c4a55';
const C_HEAD = '#31414f';

const TRI_A = 14, TRI_B = 10;    // 截止阀三角（顶点在阀芯中心）

/** 顶点在 (cx,cy)、基边在 ang 方向上的三角形 */
function triPts(cx, cy, ang, a = TRI_A, b = TRI_B) {
    const r = ang * Math.PI / 180;
    const ux = Math.cos(r), uy = Math.sin(r);
    const px = -uy, py = ux;
    const bx = cx + ux * a, by = cy + uy * a;
    return [bx + px * b, by + py * b, bx - px * b, by - py * b, cx, cy];
}

/** 各叠加件的锚点（**图片像素**） */
const A = {
    iv: { x: 822, y: 306 },          // 示功阀（相对原图位置：上移 20 / 左移 25 后再下移 5、右移 8 屏幕像素）
    cv: { x: 446, y: 256 },          // 缸头起动阀：原图阀的阀芯中心（两个三角与之完全重合）
    cvCoil: { x: 444, y: 241 },      // 原图阀上方小方框（线圈）的位置
    fan: { x: 308, y: 675 },         // 辅助鼓风机叶轮（原图风机中心 / 外径 39 px）
    scav: { x: 307, y: 853 },        // 扫气箱
    badgeCtrl: { x: 1484, y: 258, w: 84, h: 54 },       // Ctrl 机带泵徽标（盖掉原图 "50%"）
    badgeMaster: { x: 1603, y: 258, w: 136, h: 54 },    // Master 电动泵徽标（盖掉原图 "Stopped"）
};

export class MeEngineMimic extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.W = W;
        this.H = H;
        this.type = 'me_engine_mimic';
        this.cache = false;              // 动态较多（叶轮旋转 / 指示灯 / 状态文字）

        this._ivOpen = true;             // 示功阀默认**开启**（点击切换开/关）
        this._fanPhase = 0;
        this._lamp = {};
        this._knob = {};
        this._btn = {};
        this._txt = {};

        this._initGroups();
        this._layout();
        this._init();
        this._syncVisuals();

        this.config = { id: this.id, width: this.W, height: this.H };
    }

    _model() {
        return (this.sys && this.sys.ac600) ? this.sys.ac600 : null;
    }

    _pneumatic() {
        return (this.sys && this.sys.comps) ? this.sys.comps['ac600-pneumatic'] : null;
    }

    _tip(msg) {
        if (!this.sys) return;
        if (typeof this.sys._tipPurifier === 'function') this.sys._tipPurifier(msg);
    }

    /** 控制盒位置（右下角，锚定图片右边缘 / 下边缘） */
    _layout() {
        const bottom = my(IMG_H) - 14;
        const hH = 258, wB = 330, wH = 352, gap = 16;
        const left = mx(921) - 35;                  // 鼓风机控制盒左边缘（再左移 35 px，与机身留出间隙）
        this._boxBlower = { x: left, y: bottom - hH, w: wB, h: hH };
        this._boxHps = { x: left + wB + gap, y: bottom - hH, w: wH, h: hH };
    }

    // ═══════════════════════════════════════════════════════════
    //  初始化
    // ═══════════════════════════════════════════════════════════
    _init() {
        this._drawBackground();
        this._drawValves();
        this._drawBlower();
        this._drawPumpBadges();
        this._drawBlowerBox();
        this._drawHpsBox();
        this._bindInteraction();
    }

    _drawBackground() {
        const node = new Konva.Image({
            x: OX, y: OY, width: IMG_W * K, height: IMG_H * K,
            listening: false, image: undefined,
        });
        this._staticGroup.add(node);
        this._imgNode = node;
        const img = new Image();
        img.onload = () => {
            node.image(img);
            this.markDirty();
            this._refreshIfDirty(true);
        };
        img.src = imgMe;
        this._img = img;

        this._staticGroup.add(new Konva.Text({
            x: 88, y: 4, width: 520, fontSize: 20, fontStyle: 'bold',
            fill: '#20303c', text: 'ME主机气缸',
        }));
    }

    // ── ① 示功阀 / ② 缸头起动阀 ──
    _drawValves() {
        const s = this._staticGroup, d = this._dynamicGroup;

        // ══ 示功阀（手动截止阀）══
        const ivx = mx(A.iv.x), ivy = my(A.iv.y);
        this._ivTri = [];
        [180, 0].forEach((ang) => {
            const t = new Konva.Line({
                points: triPts(ivx, ivy, ang), closed: true,
                fill: 'rgba(0,0,0,0)', stroke: EDGE, strokeWidth: 1.8, listening: false,
            });
            d.add(t);
            this._ivTri.push(t);
        });
        // 阀杆 + 手轮（横管：杆朝上）
        s.add(new Konva.Line({ points: [ivx, ivy, ivx, ivy - 19], stroke: EDGE, strokeWidth: 2 }));
        s.add(new Konva.Line({ points: [ivx - 10, ivy - 19, ivx + 10, ivy - 19], stroke: EDGE, strokeWidth: 2, lineCap: 'round' }));
        // 进出口短管
        s.add(new Konva.Line({ points: [ivx - 40, ivy, ivx - TRI_A, ivy], stroke: PIPE, strokeWidth: 5 }));
        s.add(new Konva.Line({ points: [ivx + TRI_A, ivy, ivx + 40, ivy], stroke: PIPE, strokeWidth: 5 }));
        s.add(new Konva.Text({
            x: ivx - 40, y: ivy + 20, width: 80, align: 'center',
            fontSize: 12.5, fill: '#20303c', text: '示功阀',
        }));

        // ══ 缸头起动阀（电磁阀：与原图阀完全重合、同尺寸）══
        // 原图阀：两个三角顶点相交于 (442,256)、半长 17、半高 10.5（图片像素）；上方小方框为线圈
        const cvx = mx(A.cv.x), cvy = my(A.cv.y);
        const apexX = cvx - 2.5;                                    // 两三角交点左移 2.5 px
        const triA = 17 * K, triB = 10.5 * K;                        // 左右对称
        // 白底遮罩：把原图里的阀芯三角与上方小方框擦掉（改由本页动态绘制，避免重影）
        s.add(new Konva.Rect({
            x: mx(423), y: my(233), width: 39 * K, height: 36 * K,
            fill: '#ffffff', listening: false,
        }));
        this._cvTri = [];
        [180, 0].forEach((ang) => {
            const t = new Konva.Line({
                points: triPts(apexX, cvy, ang, triA, triB), closed: true,
                fill: 'rgba(0,0,0,0)', stroke: EDGE, strokeWidth: 1.7, listening: false,
            });
            d.add(t);
            this._cvTri.push(t);
        });
        // 线圈（盖住原图阀上方的小方框；比原框上移 3 px、左移 2 px）
        const coilX = mx(A.cvCoil.x) - 2, coilY = my(A.cvCoil.y) - 3;
        const cw = 13, ch = 9.5;
        this._cvCoil = new Konva.Rect({
            x: coilX - cw / 2, y: coilY - ch / 2, width: cw, height: ch,
            fill: '#ffffff', stroke: EDGE, strokeWidth: 1.8, listening: false,
        });
        d.add(this._cvCoil);
        d.add(new Konva.Line({
            points: [coilX - cw / 2, coilY - ch / 2, coilX + cw / 2, coilY + ch / 2],
            stroke: EDGE, strokeWidth: 1.3, listening: false,
        }));
        // 线圈与阀芯的连线（从线圈底边中点连到两三角的公共交点）
        s.add(new Konva.Line({
            points: [coilX, coilY + ch / 2, apexX, cvy],
            stroke: EDGE, strokeWidth: 1.8,
        }));
    }

    // ── ③ 辅助鼓风机叶轮（5 叶片，与原图风机完全重叠） ──
    _drawBlower() {
        const d = this._dynamicGroup;
        const fx = mx(A.fan.x), fy = my(A.fan.y);
        const R = 39 * K;                         // 原图风机外径（图片 39 px）
        const g = new Konva.Group({ x: fx, y: fy, listening: false });
        // 底色圆：盖掉原图 8 叶静态叶轮，保留外圈轮廓感
        g.add(new Konva.Circle({ radius: R, fill: '#e6e9eb', stroke: '#8d979e', strokeWidth: 1.6 }));
        // 5 片弧形叶片（以圆心对称、每片间隔 72°）
        const blades = new Konva.Group();
        const rOut = R * 0.92, rIn = R * 0.40, sw = 62 * Math.PI / 180;
        for (let i = 0; i < 5; i++) {
            const a0 = (i * 72 - 90) * Math.PI / 180;      // 从正上方开始
            const bl = new Konva.Shape({
                listening: false,
                fill: '#a5b0b7',
                stroke: '#6d7981',
                strokeWidth: 1,
                sceneFunc(ctx) {
                    ctx.beginPath();
                    ctx.arc(0, 0, rOut, a0, a0 + sw, false);            // 外弧
                    ctx.arc(0, 0, rIn, a0 + sw * 0.35, a0, true);       // 内弧（回程）
                    ctx.closePath();
                    ctx.fillStrokeShape(this);
                },
            });
            blades.add(bl);
        }
        g.add(blades);
        g.add(new Konva.Circle({ radius: R * 0.88, stroke: '#7b868d', strokeWidth: 1.4 }));
        g.add(new Konva.Circle({ radius: R * 0.3, fill: '#5a666d', stroke: '#2c343b', strokeWidth: 1.4 }));
        d.add(g);
        this._fanBlades = blades;
    }

    // ── ④ 液压动力泵徽标 ──
    _drawPumpBadges() {
        const d = this._dynamicGroup;
        const mk = (b, color) => {
            const rect = new Konva.Rect({
                x: mx(b.x), y: my(b.y), width: b.w * K, height: b.h * K, cornerRadius: 2,
                fill: color, listening: false,
            });
            d.add(rect);
            const t = new Konva.Text({
                x: mx(b.x), y: my(b.y) + (b.h * K - 16) / 2, width: b.w * K,
                align: 'center', fontSize: 12.5, fontStyle: 'bold',
                fill: '#ffffff', text: '停止',
            });
            d.add(t);
            return { rect, txt: t };
        };
        this._badge = {
            ctrl: mk(A.badgeCtrl, BADGE_STOP),
            master: mk(A.badgeMaster, BADGE_STOP),
        };
    }

    // ── ⑤ 电机控制盒 ──
    _boxFrame(box, title) {
        const s = this._staticGroup;
        s.add(new Konva.Rect({
            x: box.x, y: box.y, width: box.w, height: box.h, cornerRadius: 8,
            fill: C_PANEL, stroke: C_PANEL_EDGE, strokeWidth: 2,
        }));
        s.add(new Konva.Rect({
            x: box.x + 1, y: box.y + 1, width: box.w - 2, height: 26,
            cornerRadius: [7, 7, 0, 0], fill: C_HEAD,
        }));
        s.add(new Konva.Text({
            x: box.x, y: box.y + 3, width: box.w, align: 'center',
            fontSize: 16.5, fontStyle: 'bold', fill: '#ffffff', text: title,
        }));
        s.add(new Konva.Line({
            points: [box.x + 8, box.y + 207, box.x + box.w - 8, box.y + 207],
            stroke: '#9aa6ad', strokeWidth: 1,
        }));
    }

    _lampRow(box, names) {
        const d = this._dynamicGroup;
        const keys = ['power', 'run', 'over', 'press'];
        const colW = box.w / 4;
        const out = {};
        names.forEach((nm, i) => {
            const cx = box.x + colW * i + colW / 2;
            const st = LAMP_STYLE[keys[i]];
            const node = new Konva.Circle({
                x: cx, y: box.y + 54, radius: 14.5,
                fill: st.off, stroke: '#5d666d', strokeWidth: 1.4, listening: false,
            });
            d.add(node);
            this._staticGroup.add(new Konva.Text({
                x: box.x + colW * i, y: box.y + 70, width: colW, align: 'center',
                fontSize: 13, fill: '#20303c', text: nm,
            }));
            out[keys[i]] = { cx, cy: box.y + 52, node };
        });
        return out;
    }

    _selector(box, cx, label, kind) {
        const s = this._staticGroup, d = this._dynamicGroup;
        const cy = box.y + 150;
        // 档位标注：左上 = kind[0]（OFF / 本地）、右上 = kind[1]（ON / 遥控）
        s.add(new Konva.Text({ x: cx - 44, y: cy - 42, width: 36, align: 'right', fontSize: 13, fill: '#4a555e', text: kind[0] }));
        s.add(new Konva.Text({ x: cx + 8, y: cy - 42, width: 40, fontSize: 13, fill: '#4a555e', text: kind[1] }));
        // 旋钮底座（白色外环 + 黑色圆面 + 指示条）
        s.add(new Konva.Circle({
            x: cx, y: cy, radius: 25, fill: '#ffffff', stroke: '#8b939a', strokeWidth: 1.4,
        }));
        const g = new Konva.Group({ x: cx, y: cy, rotation: -45, listening: false });
        g.add(new Konva.Circle({ radius: 20, fill: '#161616', stroke: '#000000', strokeWidth: 1 }));
        g.add(new Konva.Line({ points: [0, 0, 0, -16], stroke: '#ffffff', strokeWidth: 4, lineCap: 'round' }));
        d.add(g);
        // 名称标注放到旋钮下方
        s.add(new Konva.Text({
            x: cx - 50, y: cy + 28, width: 100, align: 'center', fontSize: 13.5, fill: '#20303c', text: label,
        }));
        return { group: g };
    }

    _pushButton(box, cx, color, text) {
        const s = this._staticGroup;
        const cy = box.y + 150;
        s.add(new Konva.Circle({ x: cx, y: cy, radius: 26, fill: '#ffffff', stroke: '#9aa6ad', strokeWidth: 1 }));
        s.add(new Konva.Circle({ x: cx, y: cy, radius: 22.5, fill: color, stroke: '#3c4a55', strokeWidth: 1.2 }));
        s.add(new Konva.Text({
            x: cx - 24, y: cy - 8, width: 48, align: 'center',
            fontSize: 12.5, fontStyle: 'bold', fill: '#ffffff', text,
        }));
    }

    _drawBlowerBox() {
        const box = this._boxBlower;
        this._boxFrame(box, '辅助鼓风机控制盒');
        const row = this._lampRow(box, ['电源', '运行', '过载', '压力正常']);
        Object.keys(row).forEach((k) => { this._lamp['bl.' + k] = row[k]; });
        const cw = box.w / 4;
        this._knob.blPower = this._selector(box, box.x + cw * 0.5, '电源', ['OFF', 'ON']);
        this._knob.blMode = this._selector(box, box.x + cw * 1.5, '控制方式', ['本地', '遥控']);
        this._pushButton(box, box.x + cw * 2.5, '#1faa3c', '起动');
        this._pushButton(box, box.x + cw * 3.5, '#c62828', '停止');
        this._txt.scav = new Konva.Text({
            x: box.x, y: box.y + 230, width: box.w, align: 'center',
            fontSize: 17, fontStyle: 'bold', fill: '#16324a', text: '扫气压力 -- MPa',
        });
        this._dynamicGroup.add(this._txt.scav);
    }

    _drawHpsBox() {
        const box = this._boxHps;
        this._boxFrame(box, '电动 HPS 动力泵控制盒');
        const row = this._lampRow(box, ['电源', '运行', '过载', '压力正常']);
        Object.keys(row).forEach((k) => { this._lamp['hp.' + k] = row[k]; });
        const cw = box.w / 4;
        this._knob.hpPower = this._selector(box, box.x + cw * 0.5, '电源', ['OFF', 'ON']);
        this._knob.hpMode = this._selector(box, box.x + cw * 1.5, '控制方式', ['本地', '遥控']);
        this._pushButton(box, box.x + cw * 2.5, '#1faa3c', '起动');
        this._pushButton(box, box.x + cw * 3.5, '#c62828', '停止');
        this._txt.hyd = new Konva.Text({
            x: box.x, y: box.y + 230, width: box.w, align: 'center',
            fontSize: 17, fontStyle: 'bold', fill: '#16324a', text: '液压油 -- MPa',
        });
        this._dynamicGroup.add(this._txt.hyd);
    }

    // ═══════════════════════════════════════════════════════════
    //  交互
    // ═══════════════════════════════════════════════════════════
    _bindInteraction() {
        const M = () => this._model();
        const ivx = mx(A.iv.x), ivy = my(A.iv.y);
        const cvx = mx(A.cv.x), cvy = my(A.cv.y);
        const fx = mx(A.fan.x), fy = my(A.fan.y);

        // ① 示功阀
        const iv = this.addClickablePart('indicator-valve', ivx - 34, ivy - 26, 68, 58);
        iv.on('click tap', (e) => {
            e.cancelBubble = true;
            this._ivOpen = !this._ivOpen;
            this._tip(this._ivOpen ? '示功阀：打开（可装示功器测取气缸压力示功图）' : '示功阀：关闭');
            this._syncVisuals();
        });

        // ② 缸头起动阀（只作指示，由气动页线圈驱动）
        this.addClickablePart('start-valve', cvx - 38, cvy - 52, 100, 96);

        // ③ 辅助鼓风机
        this.addClickablePart('blower', fx - 32, fy - 32, 64, 64);

        // ④ 液压动力泵（整个泵体 + 徽标）
        this.addClickablePart('hps-ctrl',
            mx(A.badgeCtrl.x) - 6, my(A.badgeCtrl.y) - 92, A.badgeCtrl.w * K + 12, 150);
        this.addClickablePart('hps-master',
            mx(A.badgeMaster.x) - 6, my(A.badgeMaster.y) - 92, A.badgeMaster.w * K + 12, 150);

        // ⑤ 扫气箱（压力测点）
        this.addClickablePart('scav-box',
            mx(A.scav.x) - 80, my(A.scav.y) - 58, 160, 116);

        // ⑥ 鼓风机控制盒
        const b = this._boxBlower, bw = b.w / 4;
        const blPower = this.addClickablePart('bl-power', b.x + bw * 0.5 - 20, b.y + 126, 40, 46);
        blPower.on('click tap', (e) => {
            e.cancelBubble = true;
            const m = M(); if (!m) return;
            const on = m.toggleBlowerPower();
            this._tip(on ? '辅助鼓风机控制盒：电源 ON' : '辅助鼓风机控制盒：电源 OFF');
        });
        const blMode = this.addClickablePart('bl-mode', b.x + bw * 1.5 - 20, b.y + 126, 40, 46);
        blMode.on('click tap', (e) => {
            e.cancelBubble = true;
            const m = M(); if (!m) return;
            m.toggleBlowerMode();
            this._tip(m.blowerMode === 'LOCAL'
                ? '辅助鼓风机：本地控制（用起动/停止按钮）'
                : '辅助鼓风机：遥控（扫气压力大于 0.08 MPa 自动停止）');
        });
        const blStart = this.addClickablePart('bl-start', b.x + bw * 2.5 - 24, b.y + 126, 48, 48);
        blStart.on('click tap', (e) => {
            e.cancelBubble = true;
            const m = M(); if (!m) return;
            if (!m.blowerPower) { this._tip('辅助鼓风机：电源未接通，无法起动'); return; }
            m.blowerStart();
            this._tip(m.blowerMode === 'LOCAL' ? '辅助鼓风机：按下起动按钮' : '辅助鼓风机：遥控方式下扫气压力大于 0.08 MPa 自动停止');
        });
        const blStop = this.addClickablePart('bl-stop', b.x + bw * 3.5 - 24, b.y + 126, 48, 48);
        blStop.on('click tap', (e) => {
            e.cancelBubble = true;
            const m = M(); if (!m) return;
            m.blowerStop();
            this._tip('辅助鼓风机：按下停止按钮');
        });

        // ⑦ 电动 HPS 泵控制盒
        const h = this._boxHps, hw = h.w / 4;
        const hpPower = this.addClickablePart('hp-power', h.x + hw * 0.5 - 20, h.y + 126, 40, 46);
        hpPower.on('click tap', (e) => {
            e.cancelBubble = true;
            const m = M(); if (!m) return;
            const on = m.toggleHpsPower();
            this._tip(on ? '电动 HPS 泵控制盒：电源 ON' : '电动 HPS 泵控制盒：电源 OFF');
        });
        const hpMode = this.addClickablePart('hp-mode', h.x + hw * 1.5 - 20, h.y + 126, 40, 46);
        hpMode.on('click tap', (e) => {
            e.cancelBubble = true;
            const m = M(); if (!m) return;
            m.toggleHpsMode();
            this._tip(m.hpsMode === 'LOCAL'
                ? '电动 HPS 泵：本地控制（用起动/停止按钮）'
                : '电动 HPS 泵：遥控（主机 20 rpm 以上机带泵建压后自动停止）');
        });
        const hpStart = this.addClickablePart('hp-start', h.x + hw * 2.5 - 24, h.y + 126, 48, 48);
        hpStart.on('click tap', (e) => {
            e.cancelBubble = true;
            const m = M(); if (!m) return;
            if (!m.hpsPower) { this._tip('电动 HPS 泵：电源未接通，无法起动'); return; }
            m.hpsStart();
            this._tip(m.hpsMode === 'LOCAL' ? '电动 HPS 泵：按下起动按钮' : '电动 HPS 泵：遥控方式下自动起停');
        });
        const hpStop = this.addClickablePart('hp-stop', h.x + hw * 3.5 - 24, h.y + 126, 48, 48);
        hpStop.on('click tap', (e) => {
            e.cancelBubble = true;
            const m = M(); if (!m) return;
            m.hpsStop();
            this._tip('电动 HPS 泵：按下停止按钮');
        });
    }

    // ═══════════════════════════════════════════════════════════
    //  刷新
    // ═══════════════════════════════════════════════════════════
    _setLamp(key, on) {
        const l = this._lamp[key];
        if (!l || !l.node) return;
        const k = String(key).split('.')[1] || key;
        const st = LAMP_STYLE[k] || LAMP_STYLE.run;
        l.node.fill(on ? st.on : st.off);
    }

    _syncVisuals() {
        const M = this._model();

        // 示功阀
        if (this._ivTri) this._ivTri.forEach((t) => t.fill(this._ivOpen ? ON : 'rgba(0,0,0,0)'));

        // 缸头起动阀：与气动页 1 号起动电磁阀线圈同步
        const p = this._pneumatic();
        const pilot = p && p._mv3Parts && p._mv3Parts['cv1-pilot'];
        const energ = !!(pilot && pilot.shift);
        if (this._cvCoil) this._cvCoil.fill(energ ? COIL_ON : '#ffffff');
        if (this._cvTri) this._cvTri.forEach((t) => t.fill(energ ? ON : 'rgba(0,0,0,0)'));

        if (!M) return;

        // 叶轮
        if (M.blowerRun) this._fanPhase = (this._fanPhase + 6) % 360;
        if (this._fanBlades) this._fanBlades.rotation(this._fanPhase);

        // 鼓风机控制盒
        this._setLamp('bl.power', !!M.blowerPower);
        this._setLamp('bl.run', !!M.blowerRun);
        this._setLamp('bl.over', !!M.blowerOverload);
        this._setLamp('bl.press', !!M.scavOkPress);
        if (this._knob.blPower) this._knob.blPower.group.rotation(M.blowerPower ? 45 : -45);
        if (this._knob.blMode) this._knob.blMode.group.rotation(M.blowerMode === 'LOCAL' ? -45 : 45);
        if (this._txt.scav) {
            this._txt.scav.text(`扫气压力 ${(M.scavPressMPa || 0).toFixed(3)} MPa`);
            this._txt.scav.fill(M.scavOkPress ? '#0a6b2a' : '#16324a');
        }

        // 电动 HPS 泵控制盒
        this._setLamp('hp.power', !!M.hpsPower);
        this._setLamp('hp.run', !!M.hpsRun);
        this._setLamp('hp.over', !!M.hpsOverload);
        this._setLamp('hp.press', (M.hydOil || 0) >= 100);
        if (this._knob.hpPower) this._knob.hpPower.group.rotation(M.hpsPower ? 45 : -45);
        if (this._knob.hpMode) this._knob.hpMode.group.rotation(M.hpsMode === 'LOCAL' ? -45 : 45);
        if (this._txt.hyd) {
            this._txt.hyd.text(`液压油 ${((M.hydOil || 0) / 10).toFixed(1)} MPa`);
            this._txt.hyd.fill(((M.hydOil || 0) >= 100) ? '#0a6b2a' : '#c00000');
        }

        // 泵徽标（停止＝蓝底、运行＝亮绿底）
        if (this._badge) {
            const cOn = !!M.engPumpOk;
            this._badge.ctrl.rect.fill(cOn ? BADGE_RUN : BADGE_STOP);
            this._badge.ctrl.txt.text(cOn ? '运行' : '停止');
            const mOn = !!M.hpsRun;
            this._badge.master.rect.fill(mOn ? BADGE_RUN : BADGE_STOP);
            this._badge.master.txt.text(mOn ? '运行' : '停止');
        }
    }

    tick(dt) {
        this._syncVisuals();
        this.markDirty();
        this._refreshIfDirty();
    }

    getConfigFields() { return []; }
    onConfigUpdate() { }
}
