import Konva from 'konva';
import { BaseComponent } from './BaseComponent.js';

/**
 * EPC60SystemMimic — EPC-60 系统模拟图（P&ID 风格，页 3 右侧）
 *
 * 与第 2 页「S 型分油机系统流程」一一对应：
 *   沉淀柜 → 出口阀 → 供油泵 → 滤器 → 加热器 → MT/PT4 → SV1 三通阀 → 分油机
 *   分油机 → 净油柜 / 回油至沉淀柜；分油机 → SV5 出水 → 接水盘；分油机 → 排渣柜
 *   工作水：SV10（开启水）/ SV15（置换水）/ SV16（关闭水）
 *   控制空气：空气瓶 → 手动阀 → SV4 / SV1 / SV5 执行机构
 *   温度控制：TEMP CTRL 方框 → 蒸汽调节阀 → 加热器
 */
export class EPC60SystemMimic extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.W = Math.max(900, config.width || 1060);
        this.H = Math.max(700, config.height || 760);
        this.type = 'epc60_system_mimic';
        this.special = 'purifier_mimic';
        this.cache = 'fixed';

        this._initGroups();
        // 画面内容整体下移 100px（外框单独绘制，不随之下移）
        this._DY = 100;
        [this._staticGroup, this._dynamicGroup, this._interactGroup].forEach(gr => gr.y(this._DY));
        this._recalcGeometry();
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
        this._syncVisuals();

        this.config = { id: this.id, width: this.W, height: this.H };
    }

    _solver() {
        return this.sys && this.sys.purifierSolver ? this.sys.purifierSolver : null;
    }

    _recalcGeometry() {
        this._geo = {
            chassis: { x: 0, y: 0, w: this.W, h: this.H, r: 10 },
            airBottle: { x: 40, y: -36, w: 58, h: 80 },
            shutoff: { x: 118, y: -18, w: 40, h: 44 },
            sol: {
                // 从左到右：SV1（V1 供油）→ SV5（V5 出水）→ SV4（V4 净油）
                sv1: { cx: 252, cy: 70 },
                sv5: { cx: 392, cy: 70 },
                sv4: { cx: 532, cy: 70 },
            },
            // 压力水柜：置于开启水阀 SV15（x=900）正上方 80px，出口由底部中心引出
            waterTank: { x: 871, y: -62, w: 58, h: 80 },
            // 截止阀改为垂直安装（装在 900 的竖管上，中心 y=59）
            waterShutoff: { x: 880, y: 27, w: 40, h: 44 },
            wsol: {
                sv10: { cx: 840, cy: 118 },
                sv15: { cx: 900, cy: 118 },
                sv16: { cx: 960, cy: 118 },
            },
            tank: { x: 24, y: 300, w: 72, h: 120 },          // 沉淀柜
            clean: { x: 936, y: 296, w: 80, h: 104 },        // 净油柜
            sludge: { x: 700, y: 590, w: 86, h: 33 },        // 排渣柜
            tray: { x: 530, y: 519, w: 48, h: 52 },          // 接水盘
            pump: { cx: 200, cy: 360, r: 28 },
            filter: { x: 262, y: 338, w: 44, h: 44 },
            heater: { x: 336, y: 330, w: 96, h: 60 },
            sep: { cx: 740, cy: 360, r: 48 },
            valves: {
                v1: { x: 574, y: 334, w: 52, h: 52 },
                v4: { x: 866, y: 318, w: 52, h: 46 },
                v5: { x: 635, y: 523, w: 52, h: 46 },
            },
            sensors: {
                mt: { x: 852, y: 340 }, pt4: { x: 794, y: 340 },
                tt1: { x: 460, y: 360 }, tt2: { x: 520, y: 360 }, pt1: { x: 250, y: 360 },
                pt5: { x: 621, y: 546 }, st: { x: 837, y: 428 },
            },
        };
    }

    _label(g, x, y, text, size = 12, fill = '#263238', bold = false, align = 'left', width = 0) {
        const opts = {
            x, y, text, fontSize: size, fontStyle: bold ? 'bold' : 'normal',
            fill, align, fontFamily: 'Arial, "Microsoft YaHei", sans-serif',
        };
        if (width) opts.width = width;
        g.add(new Konva.Text(opts));
    }

    _tag(g, x, y, text) {
        g.add(new Konva.Rect({ x, y, width: 34, height: 20, fill: '#2e7d32', cornerRadius: 2 }));
        this._label(g, x, y + 2, text, 12, '#ffffff', true, 'center', 34);
    }

    _pipe(g, points, color, width = 5) {
        g.add(new Konva.Line({ points, stroke: color, strokeWidth: width, lineCap: 'round', lineJoin: 'round' }));
    }

    _arrow(g, x, y, dir, color) {
        const s = 6;
        const pts = dir === 'right' ? [x - s, y - s, x + s, y, x - s, y + s]
            : dir === 'left' ? [x + s, y - s, x - s, y, x + s, y + s]
                : dir === 'up' ? [x - s, y + s, x, y - s, x + s, y + s]
                    : [x - s, y - s, x, y + s, x + s, y - s];
        g.add(new Konva.Line({ points: pts, closed: true, fill: color }));
    }

    /** 阀门符号：两个三角；actuated 时带 M 方框，manual 时带手轮 */
    _drawValve(g, b, label, opts = {}) {
        const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
        g.add(new Konva.Line({ points: [cx - 16, cy - 10, cx - 16, cy + 10, cx, cy], closed: true, fill: '#ffffff', stroke: '#37474f', strokeWidth: 2 }));
        g.add(new Konva.Line({ points: [cx + 16, cy - 10, cx + 16, cy + 10, cx, cy], closed: true, fill: '#ffffff', stroke: '#37474f', strokeWidth: 2 }));
        g.add(new Konva.Line({ points: [cx, cy - 10, cx, cy - 20], stroke: '#37474f', strokeWidth: 1.6 }));
        if (opts.manual) {
            g.add(new Konva.Line({ points: [cx - 8, cy - 22, cx + 8, cy - 32], stroke: '#37474f', strokeWidth: 2 }));
            g.add(new Konva.Line({ points: [cx - 8, cy - 32, cx + 8, cy - 22], stroke: '#37474f', strokeWidth: 2 }));
        } else {
            g.add(new Konva.Rect({ x: cx + 1, y: cy - 32, width: 18, height: 16, fill: '#eceff1', stroke: '#37474f', strokeWidth: 1.4 }));
            this._label(g, cx + 1, cy - 30, 'M', 10, '#111111', true, 'center', 18);
        }
        if (label) this._label(g, b.x - 6, b.y - 22, label, 12, '#263238', true, 'center', b.w + 12);
    }

    _drawStaticParts() {
        const g = this._staticGroup, G = this._geo, W = this.W, H = this.H;
        // 油/水/排渣管统一用浅色底，流动虚线（深色）更醒目
        const OIL = '#c9a290', WATER = '#8fc4ec', AIR = '#b0b6b6', STEAM = '#8fb2d8', CLEAN = '#e0b784';

        g.add(new Konva.Rect({ x: 0, y: -this._DY, width: W, height: H, cornerRadius: G.chassis.r, fill: '#eef1f0', stroke: '#9aa19d', strokeWidth: 2 }));
        this._label(g, 16, 6 - this._DY, 'EPC-60 SYSTEM MIMIC', 13, '#263238', true);
        this._label(g, 380, 8 - this._DY, '分油机系统模拟图', 20, '#78909c');

        // ── 管线 ──
        // 控制空气
        this._pipe(g, [98, 4, 118, 4], AIR, 4);
        this._pipe(g, [158, 4, 500, 4], AIR, 4);
        this._pipe(g, [216, 4, 216, 70, 236, 70], AIR, 3);
        this._pipe(g, [356, 4, 356, 70, 376, 70], AIR, 3);
        this._pipe(g, [496, 4, 496, 70, 516, 70], AIR, 3);
        // 电磁阀输出 → 各气动阀执行机构的气动接口（虚线）
        {
            const AIRD = '#8f9696';
            const dash = (pts) => g.add(new Konva.Line({
                points: pts, stroke: AIRD, strokeWidth: 2, dash: [6, 5],
                lineCap: 'round', lineJoin: 'round',
            }));
            // SV1 → V1 三通阀气动接口：先向右 20px → 向下 → 向右经回流阀下方 → 在 V1 左侧向下 → 向右接气动接口
            dash([268, 70, 288, 70, 288, 215, 540, 215, 540, 390, 600, 390]);
            // SV5 → V5 气动接口：先向右 20px → 向下 50px → 向右 → 向下
            dash([408, 70, 428, 70, 428, 120, 661, 120, 661, 516]);
            // SV4 → V4 气动接口：向右 → 向下 → 向右 → 向下
            dash([548, 70, 690, 70, 690, 180, 892, 180, 892, 311]);
        }
        // 回油（V1 上口 → 沉淀柜）
        this._pipe(g, [600, 334, 600, 190, 60, 190, 60, 300], OIL, 4);
        // 主进油
        this._pipe(g, [96, 360, 114, 360], OIL, 6);
        this._pipe(g, [146, 360, 172, 360], OIL, 6);
        this._pipe(g, [228, 360, 262, 360], OIL, 6);
        this._pipe(g, [306, 360, 336, 360], OIL, 6);
        this._pipe(g, [432, 360, 574, 360], OIL, 6);
        // V1 出口：向右 20px → 向上 → 向右，与 SV10 出口管道汇合后一同接入分油机入口
        this._pipe(g, [626, 360, 646, 360, 646, 280, 740, 280], OIL, 6);
        // 净油
        this._pipe(g, [780, 340, 936, 340], CLEAN, 5);
        // 出水（分油机 → SV5 → 接水盘）
        this._pipe(g, [716, 408, 716, 546, 578, 546], WATER, 5);
        // 排渣
        this._pipe(g, [740, 408, 740, 590], '#c2a89e', 7);
        // 工作水：水柜（底部中间出口）→ 竖直截止阀 → 总管 → 三只竖直电磁阀 → 分油机
        this._pipe(g, [900, 18, 900, 80], WATER, 5);
        this._pipe(g, [840, 80, 960, 80], WATER, 5);
        this._pipe(g, [840, 80, 840, 109], WATER, 4);
        this._pipe(g, [900, 80, 900, 109], WATER, 4);
        this._pipe(g, [960, 80, 960, 109], WATER, 4);
        // SV10 出口 → 分油机上方
        this._pipe(g, [840, 127, 840, 158, 740, 158, 740, 280], WATER, 4);
        // SV15 出口并入 SV16 出口
        this._pipe(g, [900, 127, 900, 158, 960, 158], WATER, 4);
        // SV16 出口：右 → 下（绕过净油柜右侧）→ 左 → 上（引入分油机内部，排渣管右侧）
        this._pipe(g, [960, 127, 960, 158], WATER, 4);
        this._pipe(g, [960, 158, 1032, 158, 1032, 482, 770, 482, 770, 404], WATER, 4);
        // 蒸汽：入口（电动调节阀 + 截止阀）→ 加热器；凝水（单向阀）→ 出口
        // 蒸汽由下边缘引入、凝水由下边缘引出
        this._pipe(g, [540, 456, 408, 456, 408, 390], STEAM, 4);
        this._pipe(g, [360, 390, 360, 456, 270, 456], STEAM, 4);
        this._label(g, 526, 439, '蒸汽入口', 12, '#546e7a', true);
        this._label(g, 234, 439, '凝水出口', 12, '#546e7a', true);
        // 供油泵并联单向阀回路
        this._pipe(g, [172, 360, 172, 422, 228, 422, 228, 360], OIL, 4);

        // ── 容器 ──
        const T = G.tank;
        g.add(new Konva.Rect({ x: T.x, y: T.y, width: T.w, height: T.h, cornerRadius: 6, fill: '#e8ecea', stroke: '#546e7a', strokeWidth: 2 }));
        g.add(new Konva.Rect({ x: T.x + 6, y: T.y + 6, width: T.w - 12, height: T.h - 12, cornerRadius: 3, fill: '#fbfcfb', stroke: '#b0bec5', strokeWidth: 1 }));
        this._label(g, T.x, T.y - 18, '沉淀柜', 13, '#263238', true, 'center', T.w);
        const C = G.clean;
        g.add(new Konva.Rect({ x: C.x, y: C.y, width: C.w, height: C.h, cornerRadius: 3, fill: '#fff5e6', stroke: '#8d5a12', strokeWidth: 2 }));
        this._label(g, C.x - 8, C.y - 18, '净油柜', 13, '#6d4c11', true, 'center', C.w + 16);
        const SL = G.sludge;
        g.add(new Konva.Rect({ x: SL.x, y: SL.y, width: SL.w, height: SL.h, cornerRadius: 3, fill: '#efe7e2', stroke: '#5d4037', strokeWidth: 2 }));
        this._label(g, SL.x - 8, SL.y + SL.h + 4, '排渣柜', 13, '#4e342e', true, 'center', SL.w + 16);
        const TR = G.tray;
        g.add(new Konva.Line({
            points: [TR.x, TR.y, TR.x, TR.y + TR.h, TR.x + TR.w, TR.y + TR.h, TR.x + TR.w, TR.y],
            stroke: '#0d47a1', strokeWidth: 2.5, fill: '#e3f2fd', closed: true,
        }));
        this._label(g, TR.x - 4, TR.y + TR.h + 4, '接水盘', 13, '#0d47a1', true, 'center', TR.w + 8);
        // 控制空气瓶
        const AB = G.airBottle;
        g.add(new Konva.Rect({ x: AB.x, y: AB.y, width: AB.w, height: AB.h, cornerRadius: 10, fill: '#cfd8dc', stroke: '#546e7a', strokeWidth: 2 }));
        this._label(g, AB.x - 10, AB.y - 16, '控制空气', 13, '#37474f', true, 'center', AB.w + 20);
        this._label(g, AB.x + 2, AB.y + 30, '5~7 bar', 13, '#546e7a', true, 'center', AB.w - 4);

        // ── 泵 / 滤器 / 加热器 ──
        const P = G.pump;
        g.add(new Konva.Circle({ x: P.cx, y: P.cy, radius: 28, fill: '#eceff1', stroke: '#455a64', strokeWidth: 1.5 }));
        this._label(g, P.cx - 40, P.cy - 44, '供油泵', 13, '#37474f', true, 'center', 64);

        const F = G.filter;
        g.add(new Konva.Rect({ x: F.x, y: F.y, width: F.w, height: F.h, cornerRadius: 4, fill: '#b0bec5', stroke: '#455a64', strokeWidth: 2 }));
        for (let i = 0; i < 4; i++) {
            g.add(new Konva.Line({ points: [F.x + 8, F.y + 10 + i * 9, F.x + F.w - 8, F.y + 10 + i * 9], stroke: '#78909c', strokeWidth: 1 }));
        }
        this._label(g, F.x - 6, F.y - 17, '滤器', 13, '#37474f', true, 'center', F.w + 12);

        const HT = G.heater;
        g.add(new Konva.Rect({ x: HT.x, y: HT.y, width: HT.w, height: HT.h, cornerRadius: 6, fill: '#cfd8dc', stroke: '#546e7a', strokeWidth: 2 }));
        g.add(new Konva.Rect({ x: HT.x + 10, y: HT.y + 10, width: HT.w - 20, height: HT.h - 20, cornerRadius: 4, fill: '#e0e0e0', stroke: '#9e9e9e', strokeWidth: 1 }));
        this._label(g, HT.x - 10, HT.y - 18, '加热器', 13, '#37474f', true, 'center', HT.w + 20);

        // ── 空气回路：截止阀（与第 2 页同款）+ 三只电磁阀 ──
        this._drawShutoffStatic(g, G.shutoff);
        Object.entries(G.sol).forEach(([id, p]) => {
            const { cx, cy } = p;
            this._label(g, cx - 20, cy - 54, id.toUpperCase(), 13, '#111111', true, 'right', 34);
            this._label(g, cx + 22, cy - 16, id === 'sv4' ? 'V4' : (id === 'sv1' ? 'V1' : 'V5'), 13, '#37474f', true, 'center', 22);
        });

        // ── 工艺阀 V1 / V4 / V5：与第 2 页同款（动态层绘制） ──
        // 水柜 + 截止阀 + 三只竖直电磁阀（标号在动态层上方）
        {
            const WT = G.waterTank;
            g.add(new Konva.Rect({ x: WT.x, y: WT.y, width: WT.w, height: WT.h, cornerRadius: 10, fill: '#e3f2fd', stroke: '#1565c0', strokeWidth: 2 }));
            this._label(g, WT.x - 6, WT.y - 16, '压力水柜', 13, '#0d47a1', true, 'center', WT.w + 12);
            this._label(g, WT.x + 2, WT.y + 8, '2~8 bar', 13, '#01579b', true, 'center', WT.w - 4);
            this._drawShutoffStatic(g, G.waterShutoff, true);
            Object.entries(G.wsol).forEach(([id, p]) => {
                this._label(g, p.cx - 36, p.cy + 13, id.toUpperCase(), 13, '#0d47a1', true, 'right', 32);
            });
        }


        // ── 分油机本体 ──
        this._drawSeparatorStatic(g);

        // ── 传感器 ──
        this._valNodes = {};
        const SN = G.sensors;
        this._valNodes.mt = this._sensor(g, SN.mt.x, SN.mt.y, 'MT', true);
        this._valNodes.pt4 = this._sensor(g, SN.pt4.x, SN.pt4.y, 'PT4', true);
        this._valNodes.tt1 = this._sensor(g, SN.tt1.x, SN.tt1.y, 'TT1', true, false, 46, 15);
        this._valNodes.tt2 = this._sensor(g, SN.tt2.x, SN.tt2.y, 'TT2', true, false, 46, 15);
        this._valNodes.pt1 = this._sensor(g, SN.pt1.x, SN.pt1.y, 'PT1', true, false, 46);
        this._valNodes.pt5 = this._sensor(g, SN.pt5.x, SN.pt5.y, 'PT5', true);
        this._valNodes.st = this._sensor(g, SN.st.x, SN.st.y, 'ST', false, true);
        // ST 竖直引线指向电机端盖（无箭头）
        g.add(new Konva.Line({ points: [SN.st.x, SN.st.y - 18, SN.st.x, SN.st.y - 36], stroke: '#37474f', strokeWidth: 2 }));

        // ── 管线数值 ──
        this._lineTexts = {};
        const lineDefs = [
            // 回流管流量标签已按要求删除
        ];
        lineDefs.forEach(([id, x, y, txt]) => {
            const t = new Konva.Text({ x, y, text: txt, fontSize: 11, fill: '#1b5e20', fontFamily: 'Consolas, monospace' });
            this._dynamicGroup.add(t);
            this._lineTexts[id] = t;
        });

        // 管线号

        this._label(g, 16, H - 120, '棕：燃油/净油   蓝：工作水/出水   深蓝：蒸汽   灰：控制空气   绿标：管线号', 15, '#78909c');
    }

    /** 截止阀（与第 2 页同款）：手轮 + 阀杆 + 标注；蝶形阀体在动态层着色 */
    _drawShutoffStatic(g, b, vertical = false) {
        const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
        if (vertical) {
            // 竖直安装：阀杆与手轮朝向左侧
            g.add(new Konva.Line({ points: [cx, cy, cx - 21, cy], stroke: '#37474f', strokeWidth: 2 }));
            g.add(new Konva.Line({ points: [cx - 23, cy - 10, cx - 23, cy + 10], stroke: '#37474f', strokeWidth: 3, lineCap: 'round' }));
        } else {
            g.add(new Konva.Line({ points: [cx, cy, cx, cy - 21], stroke: '#37474f', strokeWidth: 2 }));
            g.add(new Konva.Line({ points: [cx - 10, cy - 23, cx + 10, cy - 23], stroke: '#37474f', strokeWidth: 3, lineCap: 'round' }));
        }
    }

    _sensor(g, x, y, label, above = false, boxBelow = false, lead = 26, r = 18, boxDy = 0) {
        const cy = above ? y - lead - r : y;
        if (above) g.add(new Konva.Line({ points: [x, y, x, cy + r], stroke: '#37474f', strokeWidth: 1.6 }));
        g.add(new Konva.Circle({ x, y: cy, radius: r, fill: '#ffffff', stroke: '#37474f', strokeWidth: 2 }));
        this._label(g, x - 18, cy - 6, label, 13, '#263238', true, 'center', 36);
        // 液晶显示框：黑底 + 粗体亮绿数字
        const by = (boxBelow ? cy + r + 6 : cy - r - 22) + boxDy;
        g.add(new Konva.Rect({ x: x - 25, y: by, width: 50, height: 17, cornerRadius: 2, fill: '#111111', stroke: '#2b2b2b', strokeWidth: 1 }));
        const t = new Konva.Text({
            x: x - 25, y: by + 1, width: 50, height: 16, text: '', fontSize: 15, fontStyle: 'bold',
            align: 'center', fill: '#6dff9a', fontFamily: 'Consolas, monospace',
        });
        this._dynamicGroup.add(t);
        // 记录传感器几何：供热区登记与演示箭头定位（id 取标签小写：pt1/tt1/pt4/mt/pt5/st）
        if (!this._sensorBoxes) this._sensorBoxes = {};
        this._sensorBoxes[String(label).toLowerCase()] = { x, cy, r, by, bh: 17 };
        return t;
    }

    _drawSeparatorStatic(g) {
        const S = this._geo.sep, cx = S.cx, cy = S.cy;
        g.add(new Konva.Rect({ x: cx - 46, y: cy + 42, width: 92, height: 14, rx: 3, fill: '#607d8b', stroke: '#37474f', strokeWidth: 1.5 }));
        g.add(new Konva.Line({
            points: [cx - 36, cy - 4, cx - 26, cy - 48, cx + 26, cy - 48, cx + 36, cy - 4, cx + 36, cy + 42, cx - 36, cy + 42],
            closed: true, fill: '#f7f7f7', stroke: '#546e7a', strokeWidth: 2,
        }));
        g.add(new Konva.Arc({ x: cx, y: cy - 48, innerRadius: 0, outerRadius: 26, angle: 180, rotation: 180, fill: '#e6e9ea', stroke: '#546e7a', strokeWidth: 1.6 }));
        // 电机
        g.add(new Konva.Rect({ x: cx + 38, y: cy + 2, width: 50, height: 40, cornerRadius: 6, fill: '#3949ab', stroke: '#1a237e', strokeWidth: 2 }));
        g.add(new Konva.Rect({ x: cx + 88, y: cy + 10, width: 12, height: 22, cornerRadius: 3, fill: '#5c6bc0', stroke: '#1a237e', strokeWidth: 1.5 }));
        // 排渣箭头
        g.add(new Konva.Line({ points: [cx, cy + 48, cx, cy + 48], stroke: '#6d4c41', strokeWidth: 7 }));
        g.add(new Konva.Line({ points: [cx - 11, cy + 74, cx + 11, cy + 74, cx, cy + 94], closed: true, fill: '#6d4c41' }));
        this._label(g, cx - 40, cy + 58, 'S 936', 12, '#0f07f3', true, 'center', 80);
    }

    _createDynamicNodes() {
        const d = this._dynamicGroup, G = this._geo, S = G.sep;

        // 供油泵叶轮（运行时旋转）
        this._impeller = new Konva.Group({ x: G.pump.cx, y: G.pump.cy });
        for (let i = 0; i < 3; i++) {
            this._impeller.add(new Konva.Line({
                points: [0, 0, 16, -6], stroke: '#455a64', strokeWidth: 4, lineCap: 'round', rotation: i * 120,
            }));
        }
        d.add(this._impeller);

        // ── 分离筒内液体：水封（左右窄矩形）/ 置换水 / 油（与程序阶段联动）──
        {
            const cx = S.cx, cy = S.cy;
            const yT = cy - 22, hh = 52;
            const mk = (fill, op) => new Konva.Rect({ x: cx, y: yT, width: 0, height: hh, fill, opacity: op });
            this._liqSealL = mk('#1565c0', 0.85);
            this._liqSealR = mk('#1565c0', 0.85);
            this._liqProcL = mk('#4fc3f7', 0.8);
            this._liqProcR = mk('#4fc3f7', 0.8);
            this._liqOilL = mk('#c48b2c', 0.85);
            this._liqOilR = mk('#c48b2c', 0.85);
            d.add(this._liqSealL, this._liqSealR, this._liqProcL, this._liqProcR, this._liqOilL, this._liqOilR);
            this._liq = { seal: 0, proc: 0, oOuter: 31, oInner: 31 };
        }

        this._disc = new Konva.Group({ x: S.cx, y: S.cy + 4 });
        for (let i = -3; i <= 3; i++) this._disc.add(new Konva.Line({ points: [-28, i * 8, 28, i * 8], stroke: '#90a4ae', strokeWidth: 1.2 }));
        d.add(this._disc);

        // 电机中心「运行」指示灯：运行绿灯亮，停止熄灭
        // 电机外形（静态层）：(cx+38, cy+2) 起 50×40 → 中心 (cx+63, cy+22)
        {
            const mx = S.cx + 63, my = S.cy + 22;
            this._runRing = new Konva.Circle({ x: mx, y: my, radius: 11, stroke: '#0b3d18', strokeWidth: 1.5, fill: 'transparent' });
            this._runLamp = new Konva.Circle({ x: mx, y: my, radius: 6, fill: '#2b2f2f', stroke: '#455a64', strokeWidth: 1.5 });
        }
        d.add(this._runRing, this._runLamp);

        this._heaterGlow = new Konva.Rect({ x: G.heater.x + 3, y: G.heater.y + 3, width: G.heater.w - 6, height: G.heater.h - 6, fill: '#ff9800', opacity: 0, cornerRadius: 3 });
        d.add(this._heaterGlow);

        // ── 活动排渣底盘（分油机底座上方、分离筒内，可变形）──
        // 未变形：直线 → 排渣口打开；变形：两端翘起（如照片）→ 压紧密封排渣口
        {
            const cx = S.cx, cy = S.cy;
            // 密封水：变形时在底盘左下、右下角落聚集
            this._azSealL = new Konva.Line({ points: [], closed: true, fill: '#4fc3f7', opacity: 0.92, stroke: '#0288d1', strokeWidth: 0.8 });
            this._azSealR = new Konva.Line({ points: [], closed: true, fill: '#4fc3f7', opacity: 0.92, stroke: '#0288d1', strokeWidth: 0.8 });
            // 开启水：底盘上部中央
            this._azOpen = new Konva.Rect({ x: cx - 18, y: cy + 32, width: 36, height: 0, fill: '#64b5f6', opacity: 0.9, stroke: '#1e88e5', strokeWidth: 0.8 });
            // 底盘本体
            this._azDisc = new Konva.Line({ points: [], stroke: '#37474f', strokeWidth: 3, lineCap: 'round', lineJoin: 'round' });
            d.add(this._azSealL, this._azSealR, this._azOpen, this._azDisc);
            this._az = { seal: 0, open: 0 };   // seal: 密封水/变形量 0~1；open: 开启水 0~1
            this._drawAzDisc();                 // 初始：直线（排渣口打开）
        }

        // 油柜液位（与第 2 页 _setTank 一致：按百分比填充 + 显示 x.x%）
        this._tankFills = {};
        [
            ['dirty', { x: G.tank.x + 6, y: G.tank.y + 6, w: G.tank.w - 12, h: G.tank.h - 12 }, '#c48b2c'],
            ['clean', { x: G.clean.x + 5, y: G.clean.y + 5, w: G.clean.w - 10, h: G.clean.h - 10 }, '#2e7d32'],
            ['sludge', { x: G.sludge.x + 4, y: G.sludge.y + 4, w: G.sludge.w - 8, h: G.sludge.h - 8 }, '#6d4c41'],
        ].forEach(([id, b, color]) => {
            const fill = new Konva.Rect({ x: b.x, y: b.y + b.h, width: b.w, height: 0, cornerRadius: 2, fill: color, opacity: 0.75 });
            d.add(fill);
            this._tankFills[id] = { fill, x: b.x, y: b.y, h: b.h };
        });
        this._tankPcts = {
            dirty: new Konva.Text({ x: G.tank.x - 4, y: G.tank.y + G.tank.h + 4, width: G.tank.w + 8, height: 16, text: '0.0%', fontSize: 15, align: 'center', fill: '#37474f', fontFamily: 'Consolas, monospace' }),
            clean: new Konva.Text({ x: G.clean.x - 4, y: G.clean.y + G.clean.h + 4, width: G.clean.w + 8, height: 16, text: '0.0%', fontSize: 15, align: 'center', fill: '#37474f', fontFamily: 'Consolas, monospace' }),
            sludge: new Konva.Text({ x: G.sludge.x + G.sludge.w + 6, y: G.sludge.y + 10, text: '0.0%', fontSize: 15, fill: '#37474f', fontFamily: 'Consolas, monospace' }),
        };
        Object.values(this._tankPcts).forEach(t => d.add(t));

        // 水截止阀蝶形阀体（竖直管路：上、下两个三角）
        {
            const b = G.waterShutoff, cx = b.x + b.w / 2, cy = b.y + b.h / 2, hw = 16, hh = 11;
            const t1 = new Konva.Line({ points: [cx - hh, cy - hw, cx + hh, cy - hw, cx, cy], closed: true, fill: '#ffffff', stroke: '#b71c1c', strokeWidth: 2 });
            const t2 = new Konva.Line({ points: [cx - hh, cy + hw, cx + hh, cy + hw, cx, cy], closed: true, fill: '#ffffff', stroke: '#b71c1c', strokeWidth: 2 });
            d.add(t1, t2);
            this._wShutoff = { left: t1, right: t2 };
        }

        // 竖直电磁阀：上下三角 + 右侧线圈
        this._wSolDyn = {};
        Object.entries(G.wsol).forEach(([id, p]) => {
            const cx = p.cx, cy = p.cy;
            const dx = 9, dy = 9;                       // 原 14 / 13 × 2/3
            const coilW = 14, coilH = 14;               // 正方形线圈
            const stemLen = 9;
            const stem = new Konva.Line({ points: [cx, cy, cx + dx + stemLen, cy], stroke: '#111111', strokeWidth: 2 });
            const top = new Konva.Line({ points: [cx - dx, cy - dy, cx + dx, cy - dy, cx, cy], closed: true, fill: '#9e9e9e', stroke: '#111111', strokeWidth: 2 });
            const bottom = new Konva.Line({ points: [cx - dx, cy + dy, cx + dx, cy + dy, cx, cy], closed: true, fill: '#9e9e9e', stroke: '#111111', strokeWidth: 2 });
            const coil = new Konva.Rect({ x: cx + dx + stemLen, y: cy - coilH / 2, width: coilW, height: coilH, fill: '#ffffff', stroke: '#111111', strokeWidth: 2 });
            const diag = new Konva.Line({ points: [cx + dx + stemLen + 2, cy + coilH / 2 - 3, cx + dx + stemLen + coilW - 2, cy - coilH / 2 + 3], stroke: '#111111', strokeWidth: 1.6 });
            d.add(stem, top, bottom, coil, diag);
            this._wSolDyn[id] = { coil, top, bottom };
        });

        // 截止阀蝶形阀体（开绿 / 关白+红边）
        {
            const b = G.shutoff, cx = b.x + b.w / 2, cy = b.y + b.h / 2, hw = 16, hh = 11;
            const t1 = new Konva.Line({ points: [cx - hw, cy - hh, cx - hw, cy + hh, cx, cy], closed: true, fill: '#ffffff', stroke: '#b71c1c', strokeWidth: 2 });
            const t2 = new Konva.Line({ points: [cx + hw, cy - hh, cx + hw, cy + hh, cx, cy], closed: true, fill: '#ffffff', stroke: '#b71c1c', strokeWidth: 2 });
            d.add(t1, t2);
            this._shutoff = { left: t1, right: t2 };
        }

        // 电磁阀：线圈框 + 连杆 + 左右三角 + 下部排气三角
        this._solDyn = {};
        Object.entries(G.sol).forEach(([id, p]) => {
            const { cx, cy } = p;
            const dx = 16, dy = 9;                       // 原 24 / 14 × 2/3
            const stemLen = 13;                          // 线圈到阀芯连线，长度减半
            const coilW = 29, coilH = 17;                // 原 44×26 × 2/3
            const stem = new Konva.Line({ points: [cx, cy - dy - stemLen, cx, cy], stroke: '#111111', strokeWidth: 2 });
            const left = new Konva.Line({ points: [cx - dx, cy - dy, cx - dx, cy + dy, cx, cy], closed: true, fill: '#9e9e9e', stroke: '#111111', strokeWidth: 2 });
            const right = new Konva.Line({ points: [cx + dx, cy - dy, cx + dx, cy + dy, cx, cy], closed: true, fill: '#9e9e9e', stroke: '#111111', strokeWidth: 2 });
            const bottom = new Konva.Line({ points: [cx - 10, cy + 20, cx + 10, cy + 20, cx, cy], closed: true, fill: '#c8c8c8', stroke: '#111111', strokeWidth: 2 });
            const coil = new Konva.Rect({ x: cx - coilW / 2, y: cy - dy - stemLen - coilH, width: coilW, height: coilH, fill: '#ffffff', stroke: '#111111', strokeWidth: 2 });
            const diag = new Konva.Line({ points: [cx - coilW / 2 + 2, cy - dy - stemLen - coilH + 2, cx + coilW / 2 - 2, cy - dy - stemLen - 2], stroke: '#111111', strokeWidth: 1.8 });
            d.add(stem, left, right, bottom, coil, diag);
            this._solDyn[id] = { coil, left, right, bottom };
        });

        // ── 手动截止阀（第 2 页 _drawHandValveDyn 同款）：出口阀 / 回流阀 / 蒸汽截止阀 ──
        this._handMimic = {};
        [['outlet', 130, 360, '出口阀'], ['return', 420, 190, '回流阀'], ['steam', 500, 456, '']].forEach(([id, x, y, label]) => {
            const hw = 16, hh = 11;
            const t1 = new Konva.Line({ points: [x - hw, y - hh, x - hw, y + hh, x, y], closed: true, fill: '#ffffff', stroke: '#b71c1c', strokeWidth: 2 });
            const t2 = new Konva.Line({ points: [x + hw, y - hh, x + hw, y + hh, x, y], closed: true, fill: '#ffffff', stroke: '#b71c1c', strokeWidth: 2 });
            const stem = new Konva.Line({ points: [x, y, x, y - 21], stroke: '#37474f', strokeWidth: 2 });
            const wheel = new Konva.Line({ points: [x - 10, y - 23, x + 10, y - 23], stroke: '#37474f', strokeWidth: 3, lineCap: 'round' });
            d.add(t1, t2, stem, wheel);
            if (label) this._label(d, x - 34, y - 42, label, 13, '#37474f', false, 'center', 68);
            this._handMimic[id] = { t1, t2, x, y };
        });

        // ── 蒸汽电动调节阀（第 2 页 _drawMotorValve 同款）──
        {
            const x = 448, y = 456, hw = 14, hh = 10;
            const t1 = new Konva.Line({ points: [x - hw, y - hh, x - hw, y + hh, x, y], closed: true, fill: '#ffffff', stroke: '#263238', strokeWidth: 2.5 });
            const t2 = new Konva.Line({ points: [x + hw, y - hh, x + hw, y + hh, x, y], closed: true, fill: '#ffffff', stroke: '#263238', strokeWidth: 2.5 });
            const stem = new Konva.Line({ points: [x, y, x, y - 24], stroke: '#263238', strokeWidth: 2 });
            const box = new Konva.Rect({ x: x - 10, y: y - 38, width: 20, height: 14, cornerRadius: 2, fill: '#eceff1', stroke: '#263238', strokeWidth: 1.5 });
            const mTxt = new Konva.Text({ x: x - 10, y: y - 36, width: 20, text: 'M', fontSize: 10, align: 'center', fill: '#111', fontStyle: 'bold', fontFamily: 'Arial' });
            const openText = new Konva.Text({ x: x - 6, y: y - 59, width: 40, text: '0%', fontSize: 16, align: 'left', fill: '#2e7d32', fontFamily: 'Consolas, monospace' });
            d.add(t1, t2, stem, box, mTxt, openText);
            this._label(d, x - 40, y + 14, '电动调节阀', 13, '#546e7a', false, 'center', 80);
            this._motorValve = { t1, t2, box, mTxt, openText };
        }

        // ── 单向阀（泵并联 + 凝水出口，第 2 页 _drawCheckValveDyn 同款）──
        this._checkMimic = {};
        [['pump', 200, 422, true], ['steam', 306, 456, false]].forEach(([id, x, y, withSpring]) => {
            const hw = 14, hh = 10;
            const left = new Konva.Line({ points: [x - hw, y - hh, x - hw, y + hh, x, y], closed: true, fill: '#9e9e9e', stroke: '#b71c1c', strokeWidth: 2 });
            const right = new Konva.Line({ points: [x + hw, y - hh, x + hw, y + hh, x, y], closed: true, fill: '#ffffff', stroke: '#b71c1c', strokeWidth: 2 });
            d.add(left, right);
            if (withSpring) {
                // 复位弹簧
                d.add(new Konva.Line({
                    points: [x, y, x - 5, y - 5, x + 5, y - 10, x - 5, y - 15, x + 5, y - 20, x - 5, y - 25, x, y - 30],
                    stroke: '#e65100', strokeWidth: 2, lineCap: 'round',
                }));
            }
            this._checkMimic[id] = { left, right };
        });

        // ── 三通阀 V1（与第 2 页 _drawV1Valve 同款）──
        {
            const b = G.valves.v1, cx = b.x + b.w / 2, cy = b.y + b.h / 2;
            const hw = 26, hh = 13;
            this._v1Top = new Konva.Line({ points: [cx - 13, cy - 26, cx + 13, cy - 26, cx, cy], closed: true, fill: '#ffffff', stroke: '#263238', strokeWidth: 3, lineJoin: 'round' });
            this._v1Left = new Konva.Line({ points: [cx - hw, cy - hh, cx - hw, cy + hh, cx, cy], closed: true, fill: '#2e7d32', stroke: '#263238', strokeWidth: 3, lineJoin: 'round' });
            this._v1Right = new Konva.Line({ points: [cx + hw, cy - hh, cx + hw, cy + hh, cx, cy], closed: true, fill: '#ffffff', stroke: '#263238', strokeWidth: 3, lineJoin: 'round' });
            const arcY = cy + 19;
            this._v1Arc = new Konva.Path({ x: cx, y: arcY, data: 'M -11 0 A 11 11 0 0 0 11 0 Z', fill: '#ffffff', stroke: '#263238', strokeWidth: 3, lineJoin: 'round' });
            const stem = new Konva.Line({ points: [cx, cy, cx, arcY], stroke: '#263238', strokeWidth: 3 });
            d.add(this._v1Top, this._v1Left, this._v1Right, stem, this._v1Arc);
            this._label(d, cx - 30, arcY + 22, '三通阀 V1', 13, '#37474f', true, 'center', 60);
        }

        // ── 气动阀 V4（气关）/ V5（气开）：蝶形阀体 + 弧形膜头 ──
        this._actMimic = {};
        [['v4', 'V4'], ['v5', 'V5']].forEach(([id, label]) => {
            const b = G.valves[id], x = b.x + b.w / 2, y = b.y + b.h / 2, hw = 16, hh = 13;
            const t1 = new Konva.Line({ points: [x - hw, y - hh, x - hw, y + hh, x, y], closed: true, fill: '#ffffff', stroke: '#263238', strokeWidth: 3, lineJoin: 'round' });
            const t2 = new Konva.Line({ points: [x + hw, y - hh, x + hw, y + hh, x, y], closed: true, fill: '#ffffff', stroke: '#263238', strokeWidth: 3, lineJoin: 'round' });
            const stemTop = y - 19;      // 与三通阀 V1 的执行接口连杆长度一致（19px）
            const stem = new Konva.Line({ points: [x, y, x, stemTop], stroke: '#263238', strokeWidth: 3 });
            const arc = new Konva.Path({ x, y: stemTop, data: 'M -11 0 A 11 11 0 0 1 11 0 Z', fill: '#ffffff', stroke: '#263238', strokeWidth: 3, lineJoin: 'round' });
            d.add(t1, t2, stem, arc);
            this._label(d, x - 22, y + hh + 4, label, 13, '#263238', true, 'center', 44);
            this._actMimic[id] = { t1, t2, arc };
        });

        const mkFlow = (points, color, width = 3) => {
            const line = new Konva.Line({ points, stroke: color, strokeWidth: width, dash: [9, 11], dashOffset: 0, opacity: 0 });
            d.add(line);
            return line;
        };
        this._oilFlow = mkFlow([96, 360, 130, 360, 172, 360, 228, 360, 262, 360, 306, 360, 336, 360, 432, 360, 574, 360], '#c05600', 4);
        this._sepFlow = mkFlow([626, 360, 646, 360, 646, 280, 740, 280], '#c05600', 4);
        this._returnFlow = mkFlow([600, 334, 600, 190, 60, 190, 60, 300], '#8d3200', 4);
        this._cleanFlow = mkFlow([780, 340, 936, 340], '#c05600', 4);
        this._waterDropFlow = mkFlow([900, 18, 900, 80], '#1565c0', 3);
        // 截止阀接在总管中间（x=900）：左侧管段向左流、右侧管段向右流
        this._waterFlowL = mkFlow([900, 80, 840, 80], '#1565c0', 3);
        this._waterFlowR = mkFlow([900, 80, 960, 80], '#1565c0', 3);
        this._waterFlow2 = mkFlow([840, 127, 840, 158, 740, 158, 740, 280], '#1565c0', 3);
        this._waterFlow3 = mkFlow([900, 127, 900, 158, 960, 158], '#1565c0', 3);
        this._waterFlow4 = mkFlow([960, 158, 1032, 158, 1032, 482, 770, 482, 770, 404], '#1565c0', 3);
        this._drainFlow = mkFlow([716, 408, 716, 546, 578, 546], '#1565c0', 3);
        this._sludgeFlow = mkFlow([740, 408, 740, 590], '#5d4037', 4);
        this._steamFlow = mkFlow([540, 456, 408, 456, 408, 390], '#ff3d00', 3);
        this._steamFlow2 = mkFlow([360, 390, 360, 456, 270, 456], '#ff3d00', 3);

    }

    getClickablePartCenter(partId) {
        const p = this._parts && this._parts[partId];
        if (!p) return null;
        const pt = this.group.getAbsoluteTransform().point({ x: p.x + p.w / 2, y: p.y + p.h / 2 + (this._DY || 0) });
        return { x: pt.x, y: pt.y };
    }

    _clearPartBg(hit) {
        try {
            const p = hit && hit.getParent && hit.getParent();
            const bg = p && p.getChildren && p.getChildren()[0];
            if (bg && typeof bg.fill === 'function') bg.fill('rgba(0,0,0,0)');
        } catch (e) { /* ignore */ }
    }

    _bindInteraction() {
        const G = this._geo;
        const bind = (id, x, y, w, h) => {
            const hit = this.addClickablePart(id, x, y, w, h, true);
            hit.on('click tap', () => this._control(id));
            this._clearPartBg(hit);
            return hit;
        };
        Object.entries(G.valves).forEach(([id, b]) => bind(id, b.x - 6, b.y - 40, b.w + 12, b.h + 50));
        Object.entries(G.sol).forEach(([id, p]) => bind(id, p.cx - 20, p.cy - 46, 40, 70));
        Object.entries(G.wsol).forEach(([id, p]) => bind(id, p.cx - 14, p.cy - 12, 58, 28));
        bind('water-inlet', 900 - 26, 49 - 26, 52, 52);
        bind('air-inlet', G.shutoff.x, G.shutoff.y - 30, G.shutoff.w, G.shutoff.h + 34);
        bind('pump', G.pump.cx - G.pump.r, G.pump.cy - G.pump.r, G.pump.r * 2, G.pump.r * 2);
        bind('heater', G.heater.x, G.heater.y, G.heater.w, G.heater.h);
        Object.entries(this._handMimic || {}).forEach(([id, v]) => bind(id, v.x - 20, v.y - 32, 40, 48));
        bind('separator', G.sep.cx - 40, G.sep.cy - 52, 140, 100);
        bind('motor-valve', 432, 414, 32, 60);          // 蒸汽电动调节阀（M 执行机构 + 阀体）
        // 传感器：热区覆盖「表圈 + 下方/上方液晶框」整体，箭头指向其中
        Object.entries(this._sensorBoxes || {}).forEach(([id, b]) => {
            const top = Math.min(b.cy - b.r, b.by) - 4;
            const bot = Math.max(b.cy + b.r, b.by + b.bh) + 4;
            bind(id, b.x - b.r - 4, top, (b.r + 4) * 2, bot - top);
        });
    }

    _control(id) {
        const s = this._solver();
        if (!s) return;
        const m = s.m;
        const tip = (t) => { if (this.sys && this.sys._tipPurifier) this.sys._tipPurifier(t); };

        // ── 认识/观察类部件：点击只显示说明与当前读数，不改变状态 ──
        if (id === 'separator') {
            tip(`分离筒 S 936：转速 ${Math.round(m.bowl.speed)} r/min；${m.bowl.waterSeal ? '水封已建立' : '水封未建立'}；${m.bowl.closed ? '排渣口已关闭（底盘变形密封）' : '排渣口打开'}`);
            return;
        }
        if (id === 'motor-valve') {
            tip('蒸汽电动调节阀：由温度控制器按油温偏差自动调节开度（0~100%），不设手动操作');
            return;
        }
        if (this._sensorBoxes && this._sensorBoxes[id]) {
            const txt = {
                pt1: `进油压力 ${m.feed.pressure.toFixed(2)} MPa`,
                tt1: `进油温度 ${m.feed.temp.toFixed(1)} ℃`,
                tt2: `进油温度 ${m.feed.temp.toFixed(1)} ℃`,
                pt4: `净油出口压力 ${m.oil.outletPressure.toFixed(2)} MPa`,
                mt: m.oil.mtOn ? `净油水分 ${m.oil.waterContent.toFixed(1)} pF` : '净油水分：需进入 Ti65 水分检查后才显示',
                pt5: `排水压力 ${m.water.outletPressure.toFixed(2)} MPa`,
                st: `转速 ${Math.round(m.bowl.speed)} r/min`,
            }[id] || '';
            tip(`传感器 ${String(id).toUpperCase()}：${txt}`);
            return;
        }

        // ── 手动阀 / 水气总阀 / 工艺阀：与第 2 页一致，任何控制模式都能操作 ──
        if (id === 'air-inlet') { s.toggleAirMain(); this._syncVisuals(); return; }
        if (id === 'water-inlet') { s.toggleWaterMain(); this._syncVisuals(); return; }
        if (id === 'outlet') { s.setManualValve('dirty-outlet', !m.feed.dirtyValveOpen); this._syncVisuals(); return; }
        if (id === 'return') { s.setManualValve('return', !m.feed.returnValveOpen); this._syncVisuals(); return; }
        if (id === 'steam') { s.toggleSteamValve(); this._syncVisuals(); return; }
        if (id === 'v1') { s.toggleValve('v1'); this._syncVisuals(); return; }
        if (id === 'v5') { s.toggleValve('v5'); this._syncVisuals(); return; }
        if (['sv10', 'sv15', 'sv16'].includes(id)) { s.toggleValve(id); this._syncVisuals(); return; }

        // ── 供油泵 / 加热器：HAND 位手动控制（与第 2 页 _manualPump/_manualHeater 一致）──
        if (id === 'pump') {
            if (!m.local) { tip('AUTO/EPC 方式下供油泵由控制器控制；请把机旁控制模式打到 HAND'); return; }
            s.toggleFeedPump(); this._syncVisuals(); return;
        }
        if (id === 'heater') {
            if (!m.local) { tip('AUTO/EPC 方式下加热器由控制器控制；请把机旁控制模式打到 HAND'); return; }
            s.toggleHeater(); this._syncVisuals(); return;
        }

        // ── 其余（V4 净油阀、SV1/SV4/SV5 先导阀、分油机、传感器）：调试模式下可操作 ──
        if (!m.debugMode) { tip('当前为监视模式；调试模式下可操作 V4、SV1/SV4/SV5 与分油机'); return; }
        if (id === 'v4') m.oil.outletValveOpen = !m.oil.outletValveOpen;
        else if (id === 'sv1') s.toggleValve('v1');
        else if (id === 'sv4') s.setValve('sv4', !m.feed.sv4);
        else if (id === 'sv5') s.toggleValve('v5');
        this._syncVisuals();
    }

    /** 分离筒内液体目标状态：按 EPC 程序阶段/步骤给出水封、置换水、油层的内外边界 */
    _bowlLiquidTargets(m) {
        const HW = 31, SEAL0 = 8, P = m.params || {};
        const c01 = (v) => Math.max(0, Math.min(1, v || 0));
        const tg = { seal: 0, proc: 0, oOuter: HW, oInner: HW };
        if (!m.prog) return tg;
        const t = m.timerT || 0;
        if (m.phase === 2) {
            if (m.step === 3) {
                // Ti59 置换水：从两边向中心注满
                tg.proc = HW * c01(m.bowl.fill);
            } else if (m.step === 4) {
                // Ti60 排渣：筒内水在这段时间内全部排掉（向两边退去）
                tg.proc = HW * (1 - c01(t / (P.Ti60 || 5)));
            } else if (m.step >= 7) {
                // Ti63 建立水封：左右两边出现窄矩形水封
                tg.seal = SEAL0 * c01(m.bowl.sealForm);
            }
        } else if (m.phase === 3) {
            tg.seal = SEAL0;
            if (m.step >= 4) {
                // Ti68 分油：水封厚度随水分增长，12 pF 时加倍；V5 排水降到 6 pF 后恢复
                tg.seal = SEAL0 * (1 + c01(((m.oil.waterContent || 0) - 6) / 6));
            }
            // 油层从「水封内边缘」开始 —— 必须先确定水封厚度，否则加厚部分会被油盖住
            tg.oOuter = tg.seal;
            if (m.step === 0) {
                // Ti64 进油：从水封往中心扩展，慢慢注满油
                tg.oInner = tg.seal + (HW - tg.seal) * c01(t / (P.Ti64 || 8));
            } else {
                tg.oInner = HW;
            }
        } else if (m.phase === 4) {
            if (m.step === 0) {
                // Ti70 停油、出油口开：油只剩靠近水封层的一薄层
                const f = c01(t / (P.Ti70 || 10));
                tg.seal = SEAL0;
                tg.oOuter = SEAL0;
                tg.oInner = HW - (HW - SEAL0 - 5) * f;
            } else if (m.step === 1) {
                // Ti71 进水、水封不断变厚，油被挤成中央一薄层
                const f = c01(m.bowl.fill);
                tg.seal = SEAL0 + 14 * f;
                tg.oOuter = tg.seal + (HW - 5 - tg.seal) * f;
                tg.oInner = (tg.seal + 5) + (HW - tg.seal - 5) * f;
            } else if (m.step === 2 || m.step === 3) {
                // Ti72 全部油被置换，筒内充满水
                tg.seal = SEAL0;
                tg.proc = HW - SEAL0;
            }
        } else if (m.phase === 5 && m.step === 1) {
            // Ti82 停机置换出油：筒内同样充满水，油被排出
            tg.seal = SEAL0;
            tg.proc = HW - SEAL0;
        }
        return tg;
    }

    /** 绘制分离筒内液体 */
    _drawBowlLiquids() {
        const S = this._geo.sep, cx = S.cx, cy = S.cy;
        const L = this._liq, HW = 31, yT = cy - 22, hh = 52;
        const put = (node, x, w) => {
            node.x(x); node.y(yT); node.height(hh);
            node.width(Math.max(0, w));
            node.visible(w > 0.4);
        };
        put(this._liqSealL, cx - HW, L.seal);
        put(this._liqSealR, cx + HW - L.seal, L.seal);
        put(this._liqProcL, cx - HW + L.seal, L.proc);
        put(this._liqProcR, cx + HW - L.seal - L.proc, L.proc);
        // 油层外边界不得压到水封 / 置换水上（防止水封加厚时被油色覆盖）
        const oOut = Math.max(L.oOuter, L.seal + L.proc);
        const oIn = Math.max(oOut, L.oInner);
        const ow = Math.max(0, oIn - oOut);
        put(this._liqOilL, cx - HW + oOut, ow);
        put(this._liqOilR, cx + HW - oIn, ow);
    }

    /** 活动排渣底盘：直（未变形，排渣口开）↔ 弯（变形，密封排渣口） */
    _drawAzDisc() {
        const S = this._geo.sep, cx = S.cx, cy = S.cy;
        const az = this._az || { seal: 0, open: 0 };
        const y0 = cy + 32, hw = 32, lift = 16 * az.seal;
        // 底盘：seal=0 时四点共线（直线）；seal=1 时两端翘起成浅槽
        this._azDisc.points([
            cx - hw, y0 - lift,
            cx - 16, y0,
            cx + 16, y0,
            cx + hw, y0 - lift,
        ]);
        // 密封水（左下 / 右下角落）
        const sy = cy + 40, up = 20 * az.seal;
        this._azSealL.points([cx - 35, sy, cx - 35, sy - up, cx - 20, sy - up * 0.55, cx - 20, sy]);
        this._azSealR.points([cx + 35, sy, cx + 35, sy - up, cx + 20, sy - up * 0.55, cx + 20, sy]);
        const sv = az.seal > 0.02;
        this._azSealL.visible(sv);
        this._azSealR.visible(sv);
        // 开启水（底盘上部中央）
        const oh = 14 * az.open;
        this._azOpen.y(y0 - oh);
        this._azOpen.height(oh);
        this._azOpen.visible(az.open > 0.02);
    }

    _syncVisuals() {
        const s = this._solver();
        const m = s ? s.m : null;
        if (!m) return;
        const setVal = (node, text) => { if (node) node.text(text); };

        // 每帧时间步（用于排渣底盘的水层/变形过程）
        const nowT = (typeof performance !== 'undefined' ? performance.now() : Date.now());
        const dt = this._lastT ? Math.min(0.25, Math.max(0, (nowT - this._lastT) / 1000)) : 0;
        this._lastT = nowT;
        if (!this._az) this._az = { seal: 0, open: 0 };
        {
            const az = this._az;
            if (m.water.sv15) {
                // SV15 通电：上部中央聚集开启水；密封水 3 s 内泄漏完 → 底盘还原、排渣口打开
                az.open = Math.min(1, az.open + dt / 0.5);
                az.seal = Math.max(0, az.seal - dt / 3);
            } else {
                // SV15 断电：开启水 5 s 内泄漏完（为下次密封做准备）
                az.open = Math.max(0, az.open - dt / 5);
                // SV16 通电：左下 / 右下 5 s 内聚集密封水层 → 底盘变形密封
                if (m.water.sv16) az.seal = Math.min(1, az.seal + dt / 5);
            }
            this._drawAzDisc();
        }
        // 分离筒内液体（水封 / 置换水 / 油）
        {
            const tg = this._bowlLiquidTargets(m);
            if (!this._liq) this._liq = { seal: 0, proc: 0, oOuter: 31, oInner: 31 };
            const L = this._liq;
            const kk = dt > 0.0001 ? Math.min(1, dt * 4) : 1;
            L.seal += (tg.seal - L.seal) * kk;
            L.proc += (tg.proc - L.proc) * kk;
            L.oOuter += (tg.oOuter - L.oOuter) * kk;
            L.oInner += (tg.oInner - L.oInner) * kk;
            if (L.oOuter > L.oInner) L.oOuter = L.oInner;
            this._drawBowlLiquids();
        }

        setVal(this._valNodes.mt, !m.oil.mtOn ? '0.0' : (m.faults.transducer ? 'NC' : m.oil.waterContent.toFixed(1)));
        setVal(this._valNodes.pt4, m.oil.outletPressure.toFixed(2));
        setVal(this._valNodes.pt1, m.feed.pressure.toFixed(2));
        setVal(this._valNodes.tt1, m.feed.temp.toFixed(1));
        setVal(this._valNodes.tt2, m.feed.temp.toFixed(1));
        setVal(this._valNodes.pt5, m.water.outletPressure.toFixed(2));
        setVal(this._valNodes.st, String(Math.round(m.bowl.speed)));

        // 油柜液位
        [['dirty', m.oil.dirty], ['clean', m.oil.clean], ['sludge', m.sludge.tank]].forEach(([id, pct]) => {
            const t = this._tankFills && this._tankFills[id];
            if (!t) return;
            const p = Math.max(0, Math.min(100, Number(pct) || 0));
            const hh = t.h * p / 100;
            t.fill.y(t.y + (t.h - hh));
            t.fill.height(hh);
            if (this._tankPcts[id]) this._tankPcts[id].text(`${p.toFixed(1)}%`);
        });

        if (this._lineTexts.feedP) this._lineTexts.feedP.text(`P ${m.feed.pressure.toFixed(2)}`);
        if (this._lineTexts.cleanG) this._lineTexts.cleanG.text(`G ${(m.feed.flow * 0.98).toFixed(2)}`);
        if (this._lineTexts.sludgeG) this._lineTexts.sludgeG.text(`G ${m.bowl.discharge > 0 ? '1.20' : '0.00'}`);
        if (this._lineTexts.tempT) this._lineTexts.tempT.text(`T ${m.feed.temp.toFixed(1)}`);
        if (this._lineTexts.waterP) this._lineTexts.waterP.text(`P ${(m.water.supply * 0.12).toFixed(2)}`);
        if (this._lineTexts.outG) this._lineTexts.outG.text(`G ${m.water.drain ? '0.30' : '0.00'}`);

        if (this._wShutoff) {
            const op = !!m.water.mainOpen;
            this._wShutoff.left.fill(op ? '#2e7d32' : '#ffffff');
            this._wShutoff.right.fill(op ? '#2e7d32' : '#ffffff');
            this._wShutoff.left.stroke(op ? '#1b5e20' : '#b71c1c');
            this._wShutoff.right.stroke(op ? '#1b5e20' : '#b71c1c');
        }
        if (this._wSolDyn) {
            const wOn = { sv10: !!m.water.sv10, sv15: !!m.water.sv15, sv16: !!m.water.sv16 };
            Object.entries(this._wSolDyn).forEach(([id, n]) => {
                const on = wOn[id];
                n.coil.fill(on ? '#e53935' : '#ffffff');
                n.top.fill(on ? '#2e7d32' : '#ffffff');
                n.bottom.fill(on ? '#2e7d32' : '#ffffff');
            });
        }
        if (this._shutoff) {
            const op = !!m.water.airMainOpen;
            this._shutoff.left.fill(op ? '#2e7d32' : '#ffffff');
            this._shutoff.right.fill(op ? '#2e7d32' : '#ffffff');
            this._shutoff.left.stroke(op ? '#1b5e20' : '#b71c1c');
            this._shutoff.right.stroke(op ? '#1b5e20' : '#b71c1c');
        }
        // 控制空气：主电源接通且分离程序已投入（起动程序/分油/排渣/停机）才送气
        const progActive = m.state === 'START_SEQ' || m.state === 'SEPARATION'
            || m.state === 'DISCHARGE' || m.state === 'STOPPING';
        const airOn = !!m.mainPower && progActive;
        const solOn = {
            sv4: airOn && !m.oil.outletValveOpen,     // V4 气关阀：有气即关
            sv1: airOn && !!m.feed.valveOpen,         // V1 供油
            sv5: airOn && !!m.water.drain,            // V5 排水
        };
        Object.entries(this._solDyn).forEach(([id, n]) => {
            const on = solOn[id];
            n.coil.fill(on ? '#e53935' : '#ffffff');       // 通电线圈红色
            n.left.fill(on ? '#2e7d32' : '#ffffff');       // 通电左右通（绿）；断电左口白色
            n.right.fill(on ? '#2e7d32' : '#9e9e9e');      // 断电右口灰色（与下部排气相通）
            n.bottom.fill(on ? '#ffffff' : '#c8c8c8');     // 断电：右→下通大气
        });

        // 手动截止阀：开绿 / 关白+红边
        if (this._handMimic) {
            const st = { outlet: !!m.feed.dirtyValveOpen, return: !!m.feed.returnValveOpen, steam: !!m.feed.steamValveOpen };
            Object.entries(this._handMimic).forEach(([id, v]) => {
                const op = st[id];
                v.t1.fill(op ? '#2e7d32' : '#ffffff');
                v.t2.fill(op ? '#2e7d32' : '#ffffff');
                v.t1.stroke(op ? '#1b5e20' : '#b71c1c');
                v.t2.stroke(op ? '#1b5e20' : '#b71c1c');
            });
        }
        // 蒸汽电动调节阀：投入时 M 红、有开度阀体绿，右侧显示开度
        if (this._motorValve) {
            const sv = this._motorValve;
            const ctrlOn = !!(m.feed.heaterOn && m.mainPower);
            const openPct = Math.max(0, Math.min(100, m.tempCtrl ? m.tempCtrl.valve : 0));
            const vOpen = ctrlOn && openPct > 0.5;
            sv.box.fill(ctrlOn ? '#e53935' : '#eceff1');
            sv.mTxt.fill(ctrlOn ? '#ffffff' : '#111111');
            sv.t1.fill(vOpen ? '#2e7d32' : '#ffffff');
            sv.t2.fill(vOpen ? '#2e7d32' : '#ffffff');
            sv.openText.text(`${Math.round(openPct)}%`);
        }
        // 单向阀：导通时右侧三角绿
        if (this._checkMimic) {
            const pumpOk = !!(m.feed.pumpOn && m.mainPower && m.feed.checkOpen);
            const steamOk = !!(m.feed.steamValveOpen && m.feed.heaterOn && m.mainPower);
            this._checkMimic.pump.right.fill(pumpOk ? '#2e7d32' : '#ffffff');
            this._checkMimic.steam.right.fill(steamOk ? '#2e7d32' : '#ffffff');
        }
        // 三通阀 V1：供油 = 左/右绿 + 弧形室蓝；回油 = 左/上绿
        if (this._v1Left) {
            const feeding = !!m.feed.valveOpen;
            this._v1Left.fill('#2e7d32');
            if (feeding) {
                this._v1Right.fill('#2e7d32'); this._v1Top.fill('#ffffff'); this._v1Arc.fill('#1e88e5');
            } else {
                this._v1Right.fill('#ffffff'); this._v1Top.fill('#2e7d32'); this._v1Arc.fill('#ffffff');
            }
        }
        // 气动阀 V4 气关 / V5 气开：膜头有气=蓝，阀体导通=绿
        if (this._actMimic) {
            [['v4', solOn.sv4, !solOn.sv4], ['v5', solOn.sv5, solOn.sv5]].forEach(([id, air, open]) => {
                const v = this._actMimic[id];
                if (!v) return;
                v.arc.fill(air ? '#1e88e5' : '#ffffff');
                v.t1.fill(open ? '#2e7d32' : '#ffffff');
                v.t2.fill(open ? '#2e7d32' : '#ffffff');
            });
        }

        // 分油机运行灯：电机运行或分离筒仍在升速/惰走时亮绿灯
        {
            const running = !!(m.mainPower && (m.motor.on || m.bowl.speed > 100));
            this._runLamp.fill(running ? '#28e05a' : '#2b2f2f');
            this._runLamp.stroke(running ? '#a5ffc4' : '#455a64');
            this._runRing.stroke(running ? '#1b7f3a' : '#0b3d18');
            this._runRing.fill(running ? 'rgba(40,224,90,0.18)' : 'transparent');
        }

        const pumpOn = !!(m.feed.pumpOn && m.mainPower);
        this._impPhase = ((this._impPhase || 0) + (pumpOn ? 7 : 0)) % 360;
        if (this._impeller) this._impeller.rotation(this._impPhase);
        this._disc.rotation((m.bowl.discRot * 12) % 360);
        this._heaterGlow.opacity(m.feed.heaterOn ? 0.35 + 0.2 * Math.sin((performance.now ? performance.now() : Date.now()) / 300) : 0);

        // 泵起动后油只走「吸入段 + 回流」；V1 转到供油位并有进油流量时才流向分油机
        const suctionOn = pumpOn && (m.feed.flow > 0.02 || (m.feed.returnFlow || 0) > 0.02 || (m.feed.checkFlow || 0) > 0.02);
        this._oilFlow.opacity(suctionOn ? 0.95 : 0);
        this._sepFlow.opacity((m.feed.valveOpen && m.feed.flow > 0.02) ? 0.95 : 0);
        this._returnFlow.opacity((m.feed.returnFlow || 0) > 0.02 ? 0.95 : 0);
        this._cleanFlow.opacity((m.oil.outletValveOpen && m.feed.flow > 0.02) ? 0.9 : 0);
        this._waterDropFlow.opacity(m.water.mainOpen ? 0.9 : 0);
        this._waterFlowL.opacity(m.water.mainOpen ? 0.9 : 0);
        this._waterFlowR.opacity(m.water.mainOpen ? 0.9 : 0);
        this._waterFlow2.opacity(m.water.sv10 ? 0.9 : 0);
        this._waterFlow3.opacity(m.water.sv15 ? 0.9 : 0);
        this._waterFlow4.opacity(m.water.sv16 ? 0.9 : 0);
        this._drainFlow.opacity(m.water.drain ? 0.9 : 0);
        this._sludgeFlow.opacity(m.bowl.discharge > 0 ? 0.95 : 0);
        this._steamFlow.opacity(m.feed.heaterOn && m.feed.steamValveOpen ? 0.85 : 0);
        this._steamFlow2.opacity(m.feed.heaterOn && m.feed.steamValveOpen ? 0.85 : 0);
        const off = ((performance.now ? performance.now() : Date.now()) / 40) % 20;   // 按时间推进，泵起动即有流动
        [this._oilFlow, this._sepFlow, this._returnFlow, this._cleanFlow, this._waterDropFlow, this._waterFlowL, this._waterFlowR, this._waterFlow2, this._waterFlow3, this._waterFlow4, this._drainFlow, this._sludgeFlow, this._steamFlow, this._steamFlow2]
            .forEach(l => l.dashOffset(-off));

        if (this.sys && this.sys.requestRedraw) this.sys.requestRedraw();
    }

    tick() {
        this._syncVisuals();
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

export default EPC60SystemMimic;
