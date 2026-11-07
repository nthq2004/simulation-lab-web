import Konva from 'konva';
import { BaseComponent } from './BaseComponent.js';

/**
 * BoilerSystemDiagram — 辅锅炉（D 型立式水管锅炉）汽水 / 燃油 / 燃烧系统图
 * ═══════════════════════════════════════════════════════════════════════════
 *  锅炉本体按《D型立式水管锅炉模拟图.svg》重绘（等比缩放 0.72、偏移 30,30）：
 *    · 上部：汽包壳体（穹顶 + 筒体，金属渐变）、汽空间蒸汽团、红色波浪水位线
 *    · 中部：立式水管束（16 根）、左右电极室（HH / H / L / LL 四个水位电极、两根电极杆、
 *            上下均衡管）
 *    · 下部：燃烧室壳体（炉衬 + 火焰）、燃烧器（红色本体 + 双油头喷油器 + 燃油截止阀）、
 *            风道、点火电极与点火变压器、排污管与排污阀、支腿与底座
 *    · 右上：给水管路（单向阀）；左上：蒸汽出口
 *  外围设备（重油柜 / 油泵 / 加热器 / 电磁阀 / 给水泵 / 送风机 / 风门 / 风压继电器 /
 *  压力表 / 三只压力继电器 / 声光报警 / 运行参数）沿用本系统工程配置。
 *
 *  动态量来自 sys.boilerSolver：水位（汽包 + 电极室 + 四个电极）、火焰、烟气、
 *  泵与风机叶轮、风门、电磁阀、点火火花、压力表指针、继电器灯、声光报警、读数。
 * ═══════════════════════════════════════════════════════════════════════════
 */

// SVG → 组件坐标映射（锅炉部件按 4/5 缩放：0.72×0.8 = 0.576，并以锅炉中心对齐原位）
const S = 0.576, OX = 237.7, OY = 102.6;
const X = (x) => x * S + OX;
const Y = (y) => y * S + OY;
const W2 = (w) => w * S;

export class BoilerSystemDiagram extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.W = Math.max(900, config.width || 1150);
        this.H = Math.max(700, config.height || 830);
        this.type = 'boiler_system';
        this.special = 'boiler_diagram';
        this.cache = 'fixed';
        this._timeScale = config.timeScale || 1;
        this._t0 = performance.now ? performance.now() : Date.now();

        this._initGroups();
        this._recalcGeometry();
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();

        this.config = { id: this.id, width: this.W, height: this.H, timeScale: this._timeScale };
    }

    _solver() { return (this.sys && this.sys.boilerSolver) ? this.sys.boilerSolver : null; }

    // ═══════════════════════════════════════════════════════════
    //  几何（组件坐标）
    // ═══════════════════════════════════════════════════════════
    _recalcGeometry() {
        const G = {
            frame: { x: 0, y: 0, w: this.W, h: this.H, r: 10 },

            // ── 锅炉本体（SVG 映射）──
            shell: { x: X(590), y: Y(174), w: W2(316), h: Y(601) - Y(174) },   // 汽包壳体
            waterTop: Y(300), waterBottom: Y(596),                             // 汽包水位范围
            tube: { x0: X(598), y: Y(329), w: W2(12), h: Y(595) - Y(329), step: W2(19), n: 16 },
            furnace: { x: X(579), y: Y(600), w: W2(340), h: Y(834) - Y(600) }, // 燃烧室壳体
            liner: { x: X(621), y: Y(635), w: W2(257), h: Y(793) - Y(635) },   // 炉衬
            stack: { x: X(704), y: Y(62), w: W2(78), h: Y(174) - Y(62) },      // 烟囱
            base: { x: X(548), y: Y(933), w: W2(418), h: W2(25) },

            // ── 电极室 ──
            // 电极室：宽度为原 2 倍（右缘仍与汽包均衡管对齐）
            ele: { x: X(472) - W2(91), y: Y(329), w: W2(91) * 2, h: Y(589) - Y(329) },

            // ── 燃烧器 / 点火 / 排污 ──
            burner: { x: X(360), y: Y(660), w: W2(120), h: W2(76) },
            nozzle: { x: X(474), y: Y(674), w: W2(105), h: W2(48) },
            ignitTf: { x: X(816), y: Y(839), w: W2(102), h: W2(82) },
            // 排污：炉膛右下引出 → 向右 → 向下 → 竖直排污截止阀 → 排污口
            blowdown: { x: X(919), y: Y(802), valveX: 845, valveTop: 611, valveBot: 641, arrowY: 660 },

            // ── 蒸汽 / 给水（与外围设备连接点）──
            // 蒸汽主管：锅炉右上角 → 向上 → 向右（主截止阀 + 负荷调节旋钮）
            steamMain: { x: 712, y: 212, upY: 154, endX: 938, valveX: 800, knobX: 886, knobR: 23, vHalfW: 18, vHalfH: 15 },
            feed: { y: Y(350), startX: X(920), endX: X(1317) - 50, valveX: X(1170) - 40 },

            // ── 外围设备 ──
            tank: { x: 18, y: 76, w: 75, h: 90, r: 8 },            // 重油柜
            tank2: { x: 101, y: 76, w: 75, h: 90, r: 8 },          // 轻油柜
            threeWay: { cx: 97, cy: 215, w: 30, h: 30 },           // 手动三通阀
            oilPump1: { cx: 45, cy: 330, r: 21 },
            oilPump2: { cx: 150, cy: 330, r: 21 },
            heater: { x: 37, y: 417, w: 120, h: 60, r: 8 },
            oilTempRelay: { x: 37, y: 490, w: 130, h: 58 },        // 油温继电器
            gasMain: { x: 200, y: 434, w: 34, h: 26 },             // 总电磁阀（两只支路阀之间）
            gas1: { x: 325, y: 492, w: 34, h: 26 },                // 1#（下路中央 → 燃烧器左侧）
            gas2: { x: 328, y: 377, w: 34, h: 26 },                // 2#（上路中央 → 燃烧器顶部）
            fuelY: 505,

            fan: { cx: 170, cy: 632, r: 30 },
            damper: { cx: 280, cy: 560, r: 21 },
            airRelay: { x: 320, y: 598, w: 130, h: 58 },

            feedTank: { x: 520, y: 716, w: 130, h: 100, r: 8 },  // 锅炉供水箱
            wpump1: { cx: 940, cy: 617, r: 20 },
            wpump2: { cx: 1000, cy: 617, r: 20 },
            feedRiserX: 970,

            glassGauge: { x: 788, y: 318, w: 14, h: 124 },   // 玻璃水位计（汽包右边缘）
            gauge: { cx: 508, cy: 166, r: 47 },
            relayBox: { x: 640, y: 6, w: 360, h: 74 },
        };
        // 电极室内部与 4 根「左进右下悬空」电极（HH / H / L / LL）
        {
            const EL = G.ele;
            G.eleInner = { x: EL.x + 8, y: EL.y + 12, w: EL.w - 16, h: EL.h - 24 };
            G.eleWaterTop = G.eleInner.y + 8;
            G.eleWaterBottom = G.eleInner.y + G.eleInner.h;   // 直接到内腔底，不留缝
            // 4 根电极：左壁接口 → 向右 → 向下悬空，端头按水位继电器阈值定位
            const span = G.eleWaterBottom - G.eleWaterTop;
            const tipOf = (thr) => G.eleWaterBottom - span * (thr / 100);
            const sv0 = this._solver();
            const c0 = (sv0 && sv0.cfg) || {};
            const thrOf = (k, dft) => (typeof c0[k] === 'number' ? c0[k] : dft);
            G.electrodes = [
                { key: 'HH', thrKey: 'levelOverHigh', thr: thrOf('levelOverHigh', 85), entryY: EL.y + 20, x: EL.x + 82, tip: tipOf(thrOf('levelOverHigh', 85)) },
                { key: 'H', thrKey: 'levelHighSet', thr: thrOf('levelHighSet', 70), entryY: EL.y + 40, x: EL.x + 60, tip: tipOf(thrOf('levelHighSet', 70)) },
                { key: 'L', thrKey: 'levelLowSet', thr: thrOf('levelLowSet', 35), entryY: EL.y + 60, x: EL.x + 38, tip: tipOf(thrOf('levelLowSet', 35)) },
                { key: 'LL', thrKey: 'levelDangerLow', thr: thrOf('levelDangerLow', 20), entryY: EL.y + 80, x: EL.x + 16, tip: tipOf(thrOf('levelDangerLow', 20)) },
            ];
        }
        // 压力继电器：4 只横向分布（双位下限 / 双位上限 / 自动停炉 / 蒸汽超压）
        {
            const RB = G.relayBox;
            const gap = 4, cw = (RB.w - 12 - gap * 3) / 4;   // 4 格等分
            G.relays = [
                { key: 'hlLow', name: '双位下限', addr: 'I2.5', val: '0.50' },
                { key: 'hlHigh', name: '双位上限', addr: 'I2.5', val: '0.62' },
                { key: 'stop', name: '自动停炉', addr: 'I2.3', val: '0.70' },
                { key: 'over', name: '蒸汽超压', addr: 'I2.6', val: '0.78' },
            ].map((r, i) => ({ ...r, x: RB.x + 6 + i * (cw + gap), y: RB.y + 24, w: cw, h: 44 }));
        }
        this._geo = G;
    }

    _label(g, x, y, text, size = 12, fill = '#263238', bold = false, align = 'left', width = 0) {
        const o = {
            x, y, text, fontSize: size, fill, align,
            fontStyle: bold ? 'bold' : 'normal',
            fontFamily: 'Arial, "Microsoft YaHei", sans-serif',
        };
        if (width) o.width = width;
        g.add(new Konva.Text(o));
        return o;
    }

    /** SVG 路径（自动按映射缩放/平移） */
    _path(g, d, opt = {}) {
        const p = new Konva.Path({
            data: d, x: OX, y: OY, scaleX: S, scaleY: S,
            fill: opt.fill || undefined,
            stroke: opt.stroke || undefined,
            strokeWidth: opt.sw !== undefined ? opt.sw : undefined,
            lineJoin: 'round', lineCap: 'round',
            opacity: opt.opacity !== undefined ? opt.opacity : 1,
            dash: opt.dash || undefined,
        });
        g.add(p);
        return p;
    }

    /** 标注气泡（SVG call 样式） */
    _callout(g, x, y, w, h, lines, opt = {}) {
        const box = new Konva.Rect({
            x, y, width: w, height: h, cornerRadius: 10,
            fill: opt.fill || '#edf7ff', stroke: opt.stroke || '#0751a0', strokeWidth: opt.sw || 1.8,
        });
        g.add(box);
        const n = lines.length;
        lines.forEach((t, i) => {
            this._label(g, x, y + h / 2 - (n * 13) / 2 + i * 15 + 2, t, opt.size || 11.5,
                opt.color || '#071b2d', false, 'center', w);
        });
        return box;
    }

    // ═══════════════════════════════════════════════════════════
    //  静态图
    // ═══════════════════════════════════════════════════════════
    _drawStaticParts() {
        const g = this._staticGroup, G = this._geo;

        g.add(new Konva.Rect({
            x: 0, y: 0, width: this.W, height: this.H,
            cornerRadius: G.frame.r, fill: '#ffffff', stroke: '#90a4ae', strokeWidth: 2,
        }));
        this._label(g, 20, 12, '辅锅炉（D 型立式水管锅炉）模拟图', 18, '#1b3a4b', true);
        this._label(g, 20, 36, '蒸发量 1500 kg/h ｜ 工作压力 0.7 MPa ｜ 全自动（PLC）控制', 13, '#607d8b');

        // ══════════ 1. 汽包壳体（穹顶 + 筒体） ══════════
        this._path(g, 'M590 320 C590 220 665 174 745 174 C830 174 906 220 906 320 L906 601 L590 601Z', {
            fill: 'url(#none)', stroke: '#202a31', sw: 4,
        });
        // 金属渐变（用 Konva 渐变填充覆盖）——改画一个同形状的渐变填充体
        const sh = G.shell;
        g.add(new Konva.Path({
            data: 'M590 320 C590 220 665 174 745 174 C830 174 906 220 906 320 L906 601 L590 601Z',
            x: OX, y: OY, scaleX: S, scaleY: S,
            fillLinearGradientStartPoint: { x: 590, y: 0 },
            fillLinearGradientEndPoint: { x: 906, y: 0 },
            fillLinearGradientColorStops: [0, '#777f87', 0.22, '#eef3f6', 0.55, '#9ca6ae', 0.82, '#f5f7f8', 1, '#68727b'],
        }));
        // 高光弧 + 内部汽水着色
        this._path(g, 'M606 318 C606 232 669 190 747 190 C827 190 890 232 890 318', { stroke: '#f8fbfc', sw: 9 });
        this._path(g, 'M606 317 Q748 300 890 317 L890 601 L606 601Z', { fill: '#0a6eae', opacity: 0.16 });
        // 汽空间蒸汽团
        g.add(new Konva.Group({ x: OX, y: OY, scaleX: S, scaleY: S, opacity: 0.92 }));
        [[687, 253, 48, 30], [744, 239, 62, 39], [809, 255, 56, 31], [755, 277, 100, 28]].forEach(([cx, cy, rx, ry]) => {
            this._staticGroup.add(new Konva.Ellipse({
                x: X(cx), y: Y(cy), radiusX: W2(rx), radiusY: W2(ry),
                fill: '#f8fafb', stroke: '#e2e7ea', strokeWidth: 1.2,
            }));
        });

        // ══════════ 2. 立式水管束 ══════════
        for (let i = 0; i < G.tube.n; i++) {
            const x = G.tube.x0 + i * G.tube.step;
            g.add(new Konva.Rect({
                x, y: G.tube.y, width: G.tube.w, height: G.tube.h, cornerRadius: 4,
                fillLinearGradientStartPoint: { x, y: G.tube.y },
                fillLinearGradientEndPoint: { x, y: G.tube.y + G.tube.h },
                fillLinearGradientColorStops: [0, '#55d8ff', 1, '#007acb'],
                stroke: '#003d69', strokeWidth: 1.4,
            }));
        }

        // ══════════ 3. 燃烧室壳体 + 炉衬 ══════════
        this._path(g, 'M579 600 L919 600 L919 817 Q919 834 901 834 L598 834 Q579 834 579 817Z', {
            fill: '#8f989f', stroke: '#202a31', sw: 4,
        });
        const FR = G.furnace, LN = G.liner;
        g.add(new Konva.Rect({
            x: FR.x + W2(28), y: FR.y + W2(21), width: FR.w - W2(54), height: FR.h - W2(50),
            cornerRadius: 40, fill: '#272d31', stroke: '#111a20', strokeWidth: 2.5,
        }));
        g.add(new Konva.Rect({
            x: LN.x, y: LN.y, width: LN.w, height: LN.h,
            cornerRadius: 36, fill: '#4d1b08', stroke: '#e0a04d', strokeWidth: 2,
        }));

        // ══════════ 4. 烟囱 + 顶部烟帽 ══════════
        const ST = G.stack;
        g.add(new Konva.Rect({
            x: ST.x, y: ST.y, width: ST.w, height: ST.h, cornerRadius: 3,
            fillLinearGradientStartPoint: { x: ST.x, y: ST.y },
            fillLinearGradientEndPoint: { x: ST.x + ST.w, y: ST.y },
            fillLinearGradientColorStops: [0, '#777f87', 0.22, '#eef3f6', 0.55, '#9ca6ae', 0.82, '#f5f7f8', 1, '#68727b'],
            stroke: '#222b31', strokeWidth: 2.5,
        }));
        this._path(g, 'M694 64 L792 64 L782 48 L704 48Z', { fill: '#9ca6ae', stroke: '#202a31', sw: 3 });

        // ══════════ 5. 蒸汽主管（左移至烟囱与出口中间，上移；主截止阀 + 负荷旋钮）══════════
        const SP = G.steamMain;
        const vY = SP.upY;
        // 立管 + 左段横管（止于主截止阀左端）
        g.add(new Konva.Line({
            points: [SP.x, SP.y, SP.x, vY, SP.valveX - SP.vHalfW, vY],
            stroke: '#df291a', strokeWidth: 8, lineJoin: 'round', lineCap: 'butt',
        }));
        // 右段横管（自阀右端起）
        g.add(new Konva.Line({
            points: [SP.valveX + SP.vHalfW, vY, SP.endX, vY],
            stroke: '#df291a', strokeWidth: 8, lineJoin: 'round', lineCap: 'butt',
        }));
        // 末端箭头（至蒸汽用户）
        g.add(new Konva.Line({
            points: [SP.endX + 12, vY, SP.endX, vY - 6, SP.endX, vY + 6], closed: true,
            fill: '#e52216', stroke: '#e52216', strokeWidth: 1,
        }));
        // 蒸汽主截止阀的阀体在动态层（可开/关，开时绿色填充）
        this._label(g, SP.valveX - 42, vY + 20, '蒸汽阀', 12, '#8f130b', true, 'center', 90);
        // 引压细管：自蒸汽阀左侧引出，向上进入压力继电器箱
        g.add(new Konva.Line({
            points: [SP.valveX - SP.vHalfW - 26, vY, SP.valveX - SP.vHalfW - 26, G.relayBox.y + G.relayBox.h],
            stroke: '#c0392b', strokeWidth: 2.4, lineJoin: 'round', lineCap: 'butt',
        }));
        // 负荷调节旋钮（金属外圈 + 鼓形盘面 + 高光环 + 轴帽；指针与读数在动态层）
        const KR = SP.knobR;
        // 外圈金属环
        g.add(new Konva.Circle({
            x: SP.knobX, y: vY, radius: KR + 4,
            fillLinearGradientStartPoint: { x: SP.knobX - KR, y: vY - KR },
            fillLinearGradientEndPoint: { x: SP.knobX + KR, y: vY + KR },
            fillLinearGradientColorStops: [0, '#f7f9fa', 0.42, '#ccd5db', 0.58, '#9ea8af', 1, '#6c757c'],
            stroke: '#4a5359', strokeWidth: 1.6,
        }));
        // 盘面（径向渐变做出鼓形立体感）
        g.add(new Konva.Circle({
            x: SP.knobX, y: vY, radius: KR,
            fillRadialGradientStartPoint: { x: SP.knobX - KR * 0.35, y: vY - KR * 0.45 },
            fillRadialGradientStartRadius: 0,
            fillRadialGradientEndPoint: { x: SP.knobX - KR * 0.35, y: vY - KR * 0.45 },
            fillRadialGradientEndRadius: KR * 1.55,
            fillRadialGradientColorStops: [0, '#fdfefe', 0.34, '#c6d0d6', 0.7, '#7f8990', 1, '#4e575d'],
            stroke: '#39424a', strokeWidth: 1.4,
        }));
        // 盘面内高光环
        g.add(new Konva.Circle({ x: SP.knobX, y: vY, radius: KR - 7, stroke: '#e9eff3', strokeWidth: 1 }));
        // 中心轴帽
        g.add(new Konva.Circle({
            x: SP.knobX, y: vY, radius: 5,
            fillLinearGradientStartPoint: { x: SP.knobX - 5, y: vY - 5 },
            fillLinearGradientEndPoint: { x: SP.knobX + 5, y: vY + 5 },
            fillLinearGradientColorStops: [0, '#ffffff', 1, '#8a949b'],
            stroke: '#39424a', strokeWidth: 1,
        }));
        for (let i = 0; i <= 4; i++) {
            const a = (-135 + (i / 4) * 270) * Math.PI / 180;
            g.add(new Konva.Line({
                points: [SP.knobX + Math.sin(a) * (SP.knobR + 3), vY - Math.cos(a) * (SP.knobR + 3),
                         SP.knobX + Math.sin(a) * (SP.knobR + 7), vY - Math.cos(a) * (SP.knobR + 7)],
                stroke: '#546e7a', strokeWidth: 1.4,
            }));
        }
        this._label(g, SP.knobX-36, vY + SP.knobR + 8, '负荷调节', 12, '#263238', true, 'center', 76);
        this._label(g, SP.endX + 16, vY - 8, '至蒸汽用户', 13, '#8f130b', true, 'left', 90);

        // ══════════ 6. 给水管路（单向阀） ══════════
        const FD = G.feed;
        g.add(new Konva.Line({ points: [FD.startX, FD.y, FD.valveX - 15, FD.y], stroke: '#087bc8', strokeWidth: 5, lineCap: 'round' }));
        g.add(new Konva.Line({ points: [FD.valveX + 15, FD.y, FD.endX - 10, FD.y], stroke: '#087bc8', strokeWidth: 5, lineCap: 'round' }));
        // 给水入口箭头
        g.add(new Konva.Line({
            points: [FD.endX - 14, FD.y, FD.endX, FD.y - 6, FD.endX, FD.y + 6], closed: true,
            fill: '#0879dc', stroke: '#0879dc', strokeWidth: 1,
        }));

        // ══════════ 7. 电极室（4 个水位电极，自左壁接入） ══════════
        const EL = G.ele, EI = G.eleInner;
        g.add(new Konva.Rect({
            x: EL.x, y: EL.y, width: EL.w, height: EL.h, cornerRadius: 6,
            fillLinearGradientStartPoint: { x: EL.x, y: EL.y },
            fillLinearGradientEndPoint: { x: EL.x + EL.w, y: EL.y },
            fillLinearGradientColorStops: [0, '#777f87', 0.3, '#eef3f6', 0.7, '#9ca6ae', 1, '#68727b'],
            stroke: '#26323a', strokeWidth: 2.5,
        }));
        g.add(new Konva.Rect({
            x: EI.x, y: EI.y, width: EI.w, height: EI.h, cornerRadius: 4,
            fill: '#e8f5fb', stroke: '#26323a', strokeWidth: 1.5,
        }));
        // 均衡管（电极室 ↔ 汽包）：上、下各一根
        g.add(new Konva.Line({ points: [EL.x + EL.w, Y(350), G.shell.x, Y(350)], stroke: '#68747c', strokeWidth: 7 }));
        g.add(new Konva.Line({ points: [EL.x + EL.w, Y(572), G.shell.x, Y(572)], stroke: '#68747c', strokeWidth: 7 }));
        // 4 根电极从左侧接入（名称标注在左壁外侧），电极本体在动态层（浸水变绿）
        G.electrodes.forEach(e => {
            this._label(g, EL.x - 34, e.entryY - 6, e.key, 12, '#082e70', true, 'right', 26);
        });

        // ══════════ 8. 燃烧器（红色本体 + 双油头喷油器 + 燃油阀） ══════════
        const BN = G.burner, NZ = G.nozzle;
        g.add(new Konva.Rect({
            x: BN.x, y: BN.y, width: BN.w, height: BN.h, cornerRadius: 8,
            fillLinearGradientStartPoint: { x: BN.x, y: BN.y },
            fillLinearGradientEndPoint: { x: BN.x, y: BN.y + BN.h },
            fillLinearGradientColorStops: [0, '#ff8270', 0.5, '#e51e0d', 1, '#9f1008'],
            stroke: '#252d32', strokeWidth: 2.5,
        }));
        g.add(new Konva.Rect({
            x: NZ.x, y: NZ.y, width: NZ.w, height: NZ.h, cornerRadius: 3,
            fill: '#b8c0c6', stroke: '#26323a', strokeWidth: 2,
        }));
        // 燃油管路 + 截止阀
        const fy = G.fuelY;
        g.add(new Konva.Line({ points: [G.gas1.x + G.gas1.w, fy, BN.x, fy], stroke: '#e5a900', strokeWidth: 6.5 }));
        g.add(new Konva.Line({ points: [BN.x + BN.w, fy, NZ.x, fy], stroke: '#e5a900', strokeWidth: 6.5 }));

        // ══════════ 9. 送风管道（风机 → 燃烧器下左 1/4 处的进风口） ══════════
        const AIR = { x: X(360) + W2(30), y: Y(736) };     // 燃烧器底边 1/4 处（自左起）
        g.add(new Konva.Line({
            points: [G.fan.cx, G.fan.cy - G.fan.r, G.fan.cx, Y(785), AIR.x, Y(785), AIR.x, AIR.y - 8],
            stroke: '#4fc3f7', strokeWidth: 8, lineJoin: 'round', lineCap: 'butt',
        }));
        // 进风口（燃烧器下侧开口）
        g.add(new Konva.Rect({
            x: AIR.x - 12, y: AIR.y - 9, width: 24, height: 9, cornerRadius: 2,
            fill: '#4fc3f7', stroke: '#01579b', strokeWidth: 1.4,
        }));

        // ══════════ 9b. 紫外光电管（火焰监视器）+ 接线端子 ══════════
        const FS = { x: 538, y: 562, w: 33, h: 20 };       // 装于燃烧室左下角
        g.add(new Konva.Rect({
            x: FS.x, y: FS.y, width: FS.w, height: FS.h, cornerRadius: 4,
            fillLinearGradientStartPoint: { x: FS.x, y: FS.y },
            fillLinearGradientEndPoint: { x: FS.x, y: FS.y + FS.h },
            fillLinearGradientColorStops: [0, '#cfd8dc', 1, '#78909c'],
            stroke: '#263238', strokeWidth: 1.8,
        }));
        // 感光窗口（伸入炉膛）
        g.add(new Konva.Rect({
            x: FS.x + FS.w - 5, y: FS.y + 5, width: 6, height: FS.h - 10,
            fill: '#3949ab', stroke: '#1a237e', strokeWidth: 1,
        }));
        // 两个接线柱
        G.fsPosts = [FS.y + 5, FS.y + 17];
        G.fsPosts.forEach(y => {
            g.add(new Konva.Line({ points: [FS.x, y, FS.x - 8, y], stroke: '#546e7a', strokeWidth: 2 }));
            g.add(new Konva.Circle({ x: FS.x - 9, y, radius: 2.6, fill: '#ffd54f', stroke: '#8d6e63', strokeWidth: 1.2 }));
        });
        // 一对接线端子：24V、PLC I2.4
        G.fsTerms = [{ y: FS.y - 1, txt: '24V' }, { y: FS.y + 11, txt: 'I2.4' }];
        G.fsTerms.forEach((t, i) => {
            const is24 = t.txt === '24V';
            g.add(new Konva.Rect({
                x: 470, y: t.y, width: 24, height: 12, cornerRadius: 2,
                fill: is24 ? '#ef5350' : '#eceff1', stroke: '#546e7a', strokeWidth: 1.4,
            }));
            this._label(g, 426, t.y - 2, t.txt, 12, is24 ? '#d32f2f' : '#263238', true, 'right', 42);
        });
        this._label(g, 520, 588, '紫外光电管', 13, '#37474f', true);

        // ══════════ 10. 点火电极 + 点火变压器 ══════════
        g.add(new Konva.Line({ points: [X(718), Y(744), X(718), Y(808)], stroke: '#242a30', strokeWidth: 4.5 }));
        g.add(new Konva.Line({ points: [X(754), Y(744), X(754), Y(808)], stroke: '#242a30', strokeWidth: 4.5 }));
        const IT = G.ignitTf;
        g.add(new Konva.Rect({ x: IT.x, y: IT.y, width: IT.w, height: IT.h, cornerRadius: 5, fill: '#aeb7bd', stroke: '#202a31', strokeWidth: 2.5 }));
        // 闪电符号
        this._path(g, 'M864 851 L847 884 L864 884 L852 909 L887 873 L869 873Z', { fill: '#ffdc00', stroke: '#202a31', sw: 2 });
        // 点火电缆
        g.add(new Konva.Line({ points: [X(754), Y(804), X(790), Y(835), IT.x, IT.y + W2(26)], stroke: '#d82a1b', strokeWidth: 3 }));
        g.add(new Konva.Line({ points: [X(718), Y(804), X(718), Y(820), IT.x + W2(20), IT.y + W2(60)], stroke: '#d82a1b', strokeWidth: 3 }));

        // ══════════ 11. 排污管 + 竖直排污截止阀 ══════════
        const BD = G.blowdown;
        // 进口：炉膛右下 → 右 → 直下进阀
        g.add(new Konva.Line({
            points: [BD.x, BD.y, BD.valveX, BD.y, BD.valveX, BD.valveTop],
            stroke: '#6c777e', strokeWidth: 7, lineJoin: 'round', lineCap: 'round',
        }));
        // 阀下只引出一段很短的垂直箭头（排污口方向）
        g.add(new Konva.Line({ points: [BD.valveX, BD.valveBot, BD.valveX, BD.arrowY], stroke: '#087bc8', strokeWidth: 5 }));
        g.add(new Konva.Line({
            points: [BD.valveX, BD.arrowY + 9, BD.valveX - 6, BD.arrowY - 2, BD.valveX + 6, BD.arrowY - 2], closed: true,
            fill: '#0879dc', stroke: '#0879dc', strokeWidth: 1,
        }));

        // ══════════ 12. 支腿 + 底座 ══════════
        this._path(g, 'M609 833 L609 933 L651 933 L651 833 M865 833 L865 933 L907 933 L907 833', {
            fill: '#9ca6ae', stroke: '#26323a', sw: 3,
        });
        const BS = G.base;
        g.add(new Konva.Rect({
            x: BS.x, y: BS.y, width: BS.w, height: BS.h,
            fillLinearGradientStartPoint: { x: BS.x, y: BS.y },
            fillLinearGradientEndPoint: { x: BS.x, y: BS.y + BS.h },
            fillLinearGradientColorStops: [0, '#cbd3d8', 1, '#7b858c'],
            stroke: '#202a31', strokeWidth: 2.5,
        }));

        // ══════════ 13. 标注（气泡） ══════════
        this._callout(g, 600, 92, 84, 30, ['烟囱']);
        g.add(new Konva.Line({ points: [642, 122, 648, 134], stroke: '#24313a', strokeWidth: 1.4 }));
        this._callout(g, 830, 226, 96, 30, ['进水截止阀']);
        g.add(new Konva.Line({ points: [878, 256, 872, 282], stroke: '#24313a', strokeWidth: 1.4 }));
        this._callout(g, 938, 258, 96, 30, ['给水入口']);
        g.add(new Konva.Line({ points: [980, 288, 952, 300], stroke: '#24313a', strokeWidth: 1.4 }));
        this._callout(g, 336, 228, 118, 44, ['电极室', '（水位测量）']);
        g.add(new Konva.Line({ points: [454, 262, 492, 290], stroke: '#24313a', strokeWidth: 1.4 }));
        this._callout(g, X(817), Y(423), W2(126), W2(52), ['水管束']);
        this._callout(g, 492, 446, 72, 26, ['燃烧器']);
        this._callout(g, X(655), Y(872), W2(127), W2(50), ['点火电极']);
        this._callout(g, X(767), Y(966), W2(167), W2(50), ['点火变压器']);
        this._callout(g, 776, 520, 84, 30, ['排污口']);
        g.add(new Konva.Line({ points: [818, 550, 818, 562], stroke: '#24313a', strokeWidth: 1.4 }));
        // 引出细线
        const thin = { stroke: '#24313a', sw: 1.6 };
        this._path(g, 'M817 449 L758 472', thin);
        this._path(g, 'M718 872 L718 814', thin);
        this._path(g, 'M850 966 L866 922', thin);

        // ══════════ 14. 外围设备 ══════════
        // ── 燃油系统 ─────────────────────────────────────────────
        // 重油柜 / 轻油柜 → 手动三通阀 → 双支路（入口截止阀 + 油泵）→ 汇合
        // → 重油加热器 → 总电磁阀 → 一分为二（下：1# 电磁阀→燃烧器左侧；上：2# 电磁阀→燃烧器顶部）
        const TK = G.tank, TK2 = G.tank2, TW = G.threeWay, HT = G.heater;
        const OIL = '#5d4037', OILW = 3.6;
        // 两个油柜
        [[TK, '重油柜'], [TK2, '轻油柜']].forEach(([t, name]) => {
            g.add(new Konva.Rect({ x: t.x, y: t.y, width: t.w, height: t.h, cornerRadius: t.r, fill: '#ffffff', stroke: '#5d4037', strokeWidth: 2 }));
            this._label(g, t.x + 4, t.y + 5, name, 15, '#4e342e', true, 'left', t.w - 8);
            g.add(new Konva.Rect({ x: t.x + 4, y: t.y + t.h - 30, width: t.w - 8, height: 26, fill: '#d7ccc8', opacity: 0.6, cornerRadius: 3 }));
        });
        // 柜底下中出油 → 三通阀左右接口
        g.add(new Konva.Line({
            points: [TK.x + TK.w / 2, TK.y + TK.h, TK.x + TK.w / 2, TW.cy, TW.cx - TW.w / 2, TW.cy],
            stroke: OIL, strokeWidth: OILW, lineJoin: 'round',
        }));
        g.add(new Konva.Line({
            points: [TK2.x + TK2.w / 2, TK2.y + TK2.h, TK2.x + TK2.w / 2, TW.cy, TW.cx + TW.w / 2, TW.cy],
            stroke: OIL, strokeWidth: OILW, lineJoin: 'round',
        }));
        // 手动三通阀：左/右/下三个三角（阀体三角在动态层，可切换阀位）+ 顶部手柄
        g.add(new Konva.Line({ points: [TW.cx, TW.cy, TW.cx, TW.cy - 22], stroke: '#37474f', strokeWidth: 2.4 }));
        g.add(new Konva.Line({ points: [TW.cx - 12, TW.cy - 22, TW.cx + 12, TW.cy - 22], stroke: '#37474f', strokeWidth: 2.4 }));
        this._label(g, TW.cx - 40, TW.cy - 42, '手动三通阀', 15, '#37474f', true, 'center', 80);
        // 三通阀下端 → 一分为二
        g.add(new Konva.Line({ points: [TW.cx, TW.cy + TW.h / 2, TW.cx, 252], stroke: OIL, strokeWidth: OILW }));
        g.add(new Konva.Line({ points: [G.oilPump1.cx, 252, G.oilPump2.cx, 252], stroke: OIL, strokeWidth: OILW }));
        // 两条相同支路：入口截止阀 + 油泵
        [[G.oilPump1, '1#油泵'], [G.oilPump2, '2#油泵']].forEach(([p, name]) => {
            const vy = 276;
            g.add(new Konva.Line({ points: [p.cx, 252, p.cx, vy], stroke: OIL, strokeWidth: OILW }));
            g.add(new Konva.Line({ points: [p.cx, vy + 18, p.cx, p.cy - p.r], stroke: OIL, strokeWidth: OILW }));
            g.add(new Konva.Circle({ x: p.cx, y: p.cy, radius: p.r, fill: '#ffffff', stroke: '#5d4037', strokeWidth: 2 }));
            this._label(g, p.cx - 5, p.cy + p.r + 4, name, 15, '#4e342e', true, 'center', 68);
        });
        // 两泵出口汇合 → 加热器入口
        g.add(new Konva.Line({
            points: [G.oilPump1.cx, G.oilPump1.cy + G.oilPump1.r, G.oilPump1.cx, 382,
                     G.oilPump2.cx, 382, G.oilPump2.cx, G.oilPump2.cy + G.oilPump2.r],
            stroke: OIL, strokeWidth: OILW, lineJoin: 'round',
        }));
        g.add(new Konva.Line({ points: [TW.cx, 382, TW.cx, HT.y], stroke: OIL, strokeWidth: OILW }));
        // 重油加热器
        g.add(new Konva.Rect({ x: HT.x, y: HT.y, width: HT.w, height: HT.h, cornerRadius: HT.r, fill: '#fff8e1', stroke: '#ef6c00', strokeWidth: 2 }));
        this._label(g, HT.x + 8, HT.y + 5, '重油加热器', 12, '#e65100', true, 'left', 60);
        for (let i = 0; i < 3; i++) {
            const yy = HT.y + 28 + i * 11;
            g.add(new Konva.Line({ points: [HT.x + 12, yy, HT.x + HT.w - 12, yy], stroke: '#ffb74d', strokeWidth: 2.6 }));
        }
        // 加热器出口 → 总电磁阀（总电磁阀轴线位于两只支路电磁阀之间）
        const MAIN_Y = G.gasMain.y + G.gasMain.h / 2;   // 447
        const UP_Y = G.gas2.y + G.gas2.h / 2;           // 390（上路电磁阀轴线）
        g.add(new Konva.Line({ points: [HT.x + HT.w, MAIN_Y, G.gasMain.x, MAIN_Y], stroke: OIL, strokeWidth: OILW }));
        // 总电磁阀后一分为二
        const SPLIT_X = 254;
        g.add(new Konva.Line({ points: [G.gasMain.x + G.gasMain.w, MAIN_Y, SPLIT_X, MAIN_Y], stroke: OIL, strokeWidth: OILW }));
        // 下路：向下 → 1# 电磁阀 → 燃烧器左侧
        g.add(new Konva.Line({ points: [SPLIT_X, MAIN_Y, SPLIT_X, G.fuelY, G.gas1.x, G.fuelY], stroke: OIL, strokeWidth: OILW, lineJoin: 'round' }));
        g.add(new Konva.Line({ points: [G.gas1.x + G.gas1.w, G.fuelY, G.burner.x, G.fuelY], stroke: OIL, strokeWidth: OILW }));
        // 上路：向上 → 2# 电磁阀 → 向右 → 向下进燃烧器顶部（新入口）
        g.add(new Konva.Line({ points: [SPLIT_X, MAIN_Y, SPLIT_X, UP_Y, G.gas2.x, UP_Y], stroke: OIL, strokeWidth: OILW, lineJoin: 'round' }));
        g.add(new Konva.Line({
            points: [G.gas2.x + G.gas2.w, UP_Y, 450, UP_Y, 450, G.burner.y + 2],
            stroke: OIL, strokeWidth: OILW, lineJoin: 'round',
        }));
        g.add(new Konva.Rect({ x: 444, y: G.burner.y - 2, width: 12, height: 7, cornerRadius: 2, fill: '#ffb300', stroke: '#8d6e63', strokeWidth: 1.2 }));
        // 油温继电器（参照风压继电器：指示灯 + 名称 + 地址）+ 取温管接到总电磁阀阀前 10px
        const TR = G.oilTempRelay;
        g.add(new Konva.Rect({ x: TR.x, y: TR.y, width: TR.w, height: TR.h, cornerRadius: 4, fill: '#fff3e0', stroke: '#ef6c00', strokeWidth: 1.8 }));
        this._label(g, TR.x + 24, TR.y + 5, '油温继电器', 12, '#e65100', true);
        this._label(g, TR.x + 8, TR.y + 30, 'I2.1（＜90℃ 动作）', 12, '#bf360c');
        g.add(new Konva.Line({
            points: [TR.x + TR.w, TR.y + 29, G.gasMain.x - 10, TR.y + 29, G.gasMain.x - 10, G.gasMain.y + G.gasMain.h / 2],
            stroke: '#bf360c', strokeWidth: 2.4, lineJoin: 'round',
        }));
        g.add(new Konva.Circle({ x: G.gasMain.x - 10, y: G.gasMain.y + G.gasMain.h / 2, radius: 3, fill: '#bf360c' }));

        // 三个电磁阀
        [[G.gasMain, '总', 'Q1.2'], [G.gas1, '1#', 'Q1.3'], [G.gas2, '2#', 'Q1.5']].forEach(([v, name, addr]) => {
            const cx = v.x + v.w / 2, cy = v.y + v.h / 2;
            // 阀体：与截止阀同形的左右对顶三角
            // 阀体三角在动态层（通电绿色填充），此处只画阀杆
            // 阀杆自阀芯中心向上引出
            g.add(new Konva.Line({ points: [cx, cy, cx, cy - 18], stroke: '#0b0b0b', strokeWidth: 2.2 }));
            this._label(g, v.x - 10, v.y + v.h + 3, name + '电磁阀', 12, '#455a64', false, 'center', v.w + 20);
        });

        // 送风机 + 风门 + 风压继电器
        const FAN = G.fan;
        g.add(new Konva.Circle({ x: FAN.cx, y: FAN.cy, radius: FAN.r, fill: '#ffffff', stroke: '#0277bd', strokeWidth: 2 }));
        g.add(new Konva.Circle({ x: FAN.cx, y: FAN.cy, radius: FAN.r - 6, fill: '#e1f5fe', stroke: '#4fc3f7', strokeWidth: 1 }));
        this._label(g, FAN.cx + FAN.r + 6, FAN.cy - 12, '风机', 12.5, '#01579b', true, 'left', 68);
        this._label(g, FAN.cx + FAN.r + 6, FAN.cy + 2, 'Q0.4', 12.5, '#0277bd', false, 'left', 68);
        const DM = G.damper;
        g.add(new Konva.Circle({ x: DM.cx, y: DM.cy, radius: DM.r, fill: '#ffffff', stroke: '#0277bd', strokeWidth: 1.8 }));
        this._label(g, DM.cx - 18, DM.cy + DM.r + 4, '风门', 12, '#01579b', true);
        this._label(g, DM.cx - 18, DM.cy + DM.r + 20, 'Q1.4', 12, '#0277bd');
        // 风门电磁线圈（位于风门上方，通电红色填充）
        g.add(new Konva.Line({ points: [DM.cx, DM.cy - DM.r - 5, DM.cx, DM.cy - DM.r], stroke: '#546e7a', strokeWidth: 3 }));
        const AR = G.airRelay;
        g.add(new Konva.Rect({ x: AR.x, y: AR.y, width: AR.w, height: AR.h, cornerRadius: 4, fill: '#f1f8e9', stroke: '#7cb342', strokeWidth: 1.8 }));
        this._label(g, AR.x + 24, AR.y + 5, '风压继电器', 12, '#33691e', true);
        this._label(g, AR.x + 8, AR.y + 30, 'I2.2（风压正常）', 12, '#558b2f');
        // 取压管：自继电器顶部接到风门下游水平送风管的中点
        {
            const tapX = (G.damper.cx + G.damper.r + AIR.x) / 2;
            g.add(new Konva.Line({
                points: [tapX, AR.y, tapX, Y(785) + 4],
                stroke: '#78909c', strokeWidth: 3, lineCap: 'butt',
            }));
            g.add(new Konva.Circle({ x: tapX, y: Y(785), radius: 3, fill: '#0277bd' }));
        }

        // ── 锅炉供水：供水箱（左侧冷凝水 / 淡水两路进水）→ 右下 1/4 出水 →
        //    向右向上到两支路中央 → 一分为二（给水泵 + 单向阀）→ 汇合 → 上升 → 左接锅炉进水截止阀 ──
        const WA = '#00897b', WAW = 5;
        const FT = G.feedTank;
        const SPX = G.wpump1.cx + 30;                // 两支路中央（920）
        const SPY = 672;                             // 分流横管高度
        const MGY = 526;                             // 两支路汇合高度（单向阀出口管加长 20）
        const RZ = G.feedRiserX;
        // 水箱
        g.add(new Konva.Rect({ x: FT.x, y: FT.y, width: FT.w, height: FT.h, cornerRadius: FT.r, fill: '#ffffff', stroke: '#00695c', strokeWidth: 2 }));
        this._label(g, FT.x + 6, FT.y + 5, '锅炉供水箱', 12, '#004d40', true, 'left', FT.w - 12);
        g.add(new Konva.Rect({ x: FT.x + 4, y: FT.y + FT.h - 38, width: FT.w - 8, height: 34, fill: '#b2dfdb', opacity: 0.7, cornerRadius: 3 }));
        // 左侧两路进水：冷凝水 / 淡水（各经一个截止阀）
        [[FT.y + 30, '冷凝水'], [FT.y + 80, '淡水']].forEach(([iy, name]) => {
            const vx = 470;
            g.add(new Konva.Line({ points: [388, iy, FT.x, iy], stroke: WA, strokeWidth: WAW }));
            // 进箱箭头
            g.add(new Konva.Line({ points: [FT.x - 12, iy, FT.x, iy - 6, FT.x, iy + 6], closed: true, fill: WA, stroke: WA }));
            this._label(g, 386, iy - 20, name, 12, '#004d40', true, 'left', 80);
        });
        // 出水：水箱右下 1/4 处引出 → 向右 → 向上到两支路中央
        const OVY = FT.y + FT.h * 0.75, OVC = FT.x + FT.w + 50;
        g.add(new Konva.Line({ points: [FT.x + FT.w, OVY, OVC - 14, OVY], stroke: WA, strokeWidth: WAW }));
        g.add(new Konva.Line({
            points: [OVC + 14, OVY, SPX, OVY, SPX, SPY],
            stroke: WA, strokeWidth: WAW, lineJoin: 'round',
        }));
        // 一分为二
        g.add(new Konva.Line({ points: [G.wpump1.cx, SPY, G.wpump2.cx, SPY], stroke: WA, strokeWidth: WAW }));
        // 两条相同支路：给水泵 → 单向阀
        [[G.wpump1, '1# 给水泵'], [G.wpump2, '2# 给水泵']].forEach(([p, name], i) => {
            const cyv = 564;
            // 入口 / 出口管只画到圆的边缘
            g.add(new Konva.Line({ points: [p.cx, SPY, p.cx, p.cy - p.r], stroke: WA, strokeWidth: WAW, lineCap: 'butt' }));
            g.add(new Konva.Line({ points: [p.cx, p.cy + p.r, p.cx, cyv + 12], stroke: WA, strokeWidth: WAW, lineCap: 'butt' }));
            g.add(new Konva.Line({ points: [p.cx, cyv - 12, p.cx, MGY], stroke: WA, strokeWidth: WAW, lineCap: 'butt' }));
            // 泵体后画，压住管口
            g.add(new Konva.Circle({ x: p.cx, y: p.cy, radius: p.r, fill: '#ffffff', stroke: '#00695c', strokeWidth: 2 }));
            if (i === 0) this._label(g, p.cx - 72, p.cy - 28, name, 13, '#004d40', true, 'left', 72);
            else this._label(g, p.cx + 16, p.cy - 28, name, 13, '#004d40', true, 'left', 72);
        });
        // 汇合横管 + 自两支路正中向上引出 → 左接锅炉进水管道
        g.add(new Konva.Line({ points: [G.wpump1.cx, MGY, G.wpump2.cx, MGY], stroke: WA, strokeWidth: WAW }));
        g.add(new Konva.Line({
            points: [RZ, MGY, RZ, G.feed.y, G.feed.endX, G.feed.y],
            stroke: WA, strokeWidth: WAW, lineJoin: 'round',
        }));

        // 蒸汽压力表：管路自锅炉左上斜向上引出，接入压力表下部（读数在动态层）
        const PG = G.gauge;
        g.add(new Konva.Line({
            points: [PG.cx, PG.cy + PG.r, PG.cx, PG.cy + PG.r + 46, G.shell.x + 34, PG.cy + PG.r + 46],
            stroke: '#c0392b', strokeWidth: 5, lineJoin: 'round', lineCap: 'butt',
        }));
        g.add(new Konva.Circle({ x: PG.cx, y: PG.cy, radius: PG.r, fill: '#ffffff', stroke: '#37474f', strokeWidth: 2 }));
        for (let i = 0; i <= 8; i++) {
            const a = (-135 + (i / 8) * 270) * Math.PI / 180;
            const x1 = PG.cx + Math.sin(a) * (PG.r - 8);
            const y1 = PG.cy - Math.cos(a) * (PG.r - 8);
            const x2 = PG.cx + Math.sin(a) * (PG.r - 2);
            const y2 = PG.cy - Math.cos(a) * (PG.r - 2);
            g.add(new Konva.Line({ points: [x1, y1, x2, y2], stroke: '#37474f', strokeWidth: i % 2 === 0 ? 1.6 : 0.8 }));
            if (i % 2 === 0) {
                this._label(g, PG.cx + Math.sin(a) * (PG.r - 20) - 12, PG.cy - Math.cos(a) * (PG.r - 20) - 7,
                    (i / 8).toFixed(1), 11, '#455a64', false, 'center', 24);
            }
        }

        // 安全阀（弹簧式，装于烟囱左侧 / 压力表接管之间的汽包穹顶上）
        {
            const SV = { x: 604, y: 224, base: 224 - 24 };   // y=汽包接口，base=阀座（短管加长到 24）
            g.add(new Konva.Line({ points: [SV.x, SV.y, SV.x, SV.base], stroke: '#68747c', strokeWidth: 7 }));
            // 阀座横线 + 弹簧（阀体三角在动态层，卸放时变红）
            g.add(new Konva.Line({ points: [SV.x - 13, SV.base, SV.x + 13, SV.base], stroke: '#17232b', strokeWidth: 2.2 }));
            g.add(new Konva.Line({
                points: [SV.x, SV.base - 22, SV.x, SV.base - 28, SV.x + 10, SV.base - 34, SV.x - 10, SV.base - 42,
                         SV.x + 10, SV.base - 50, SV.x, SV.base - 56],
                stroke: '#17232b', strokeWidth: 1.8, lineJoin: 'round',
            }));
            G.safetyValve = SV;
            this._label(g, SV.x + 14, SV.y + 2, '安全阀', 9, '#37474f', true);
        }

        // 压力继电器：4 只横向分布
        const RB = G.relayBox;
        g.add(new Konva.Rect({ x: RB.x, y: RB.y, width: RB.w, height: RB.h, cornerRadius: 5, fill: '#f1f8e9', stroke: '#7cb342', strokeWidth: 1.8 }));
        this._label(g, RB.x + 6, RB.y + 2, '压力继电器（设定值 MPa）', 12, '#33691e', true);
        G.relays.forEach(it => {
            g.add(new Konva.Rect({ x: it.x, y: it.y, width: it.w, height: it.h, cornerRadius: 3, fill: '#ffffff', stroke: '#aed581', strokeWidth: 1.2 }));
            this._label(g, it.x + 16, it.y + 2, it.name, 12, '#37474f', true, 'left', it.w - 18);
            this._label(g, it.x + 10, it.y + 24, it.val, 12, '#1b5e20', true, 'left', 42);
            this._label(g, it.x + it.w - 30, it.y + 24, it.addr, 12, '#7f8c8d', false, 'right', 26);
        });
    }

    // ═══════════════════════════════════════════════════════════
    //  动态图
    // ═══════════════════════════════════════════════════════════
    _createDynamicNodes() {
        const d = this._dynamicGroup, G = this._geo;

        // 汽包水位（填充 + 红色波浪水位线）
        this._shellWater = new Konva.Rect({
            x: G.shell.x + W2(16), y: G.waterTop, width: G.shell.w - W2(32), height: 40,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint: { x: 0, y: 200 },
            fillLinearGradientColorStops: [0, '#55d8ff', 1, '#007acb'],
            opacity: 0.50,
        });
        d.add(this._shellWater);

        const wave = [];
        for (let i = 0; i <= 6; i++) wave.push(i * W2(52), (i % 2 === 0) ? -3 : 3);
        this._waterLine = new Konva.Line({
            points: wave, x: G.shell.x + W2(8), y: G.waterTop,
            stroke: '#ef4b32', strokeWidth: 2.6,
        });
        d.add(this._waterLine);

        // 玻璃水位计（汽包右边缘）
        {
            const GG = G.glassGauge;
            const edgeX = G.shell.x + G.shell.w;
            // 上下连通管（汽包 → 玻璃管）
            d.add(new Konva.Line({ points: [edgeX, GG.y + 12, GG.x + GG.w / 2, GG.y + 12], stroke: '#68747c', strokeWidth: 6 }));
            d.add(new Konva.Line({ points: [edgeX, GG.y + GG.h - 12, GG.x + GG.w / 2, GG.y + GG.h - 12], stroke: '#68747c', strokeWidth: 6 }));
            // 管壳
            d.add(new Konva.Rect({
                x: GG.x, y: GG.y, width: GG.w, height: GG.h, cornerRadius: 7,
                fill: '#f2fbff', stroke: '#78909c', strokeWidth: 1.6,
            }));
            // 上下端盖
            d.add(new Konva.Rect({ x: GG.x - 2, y: GG.y - 3, width: GG.w + 4, height: 6, cornerRadius: 3, fill: '#b0bec5', stroke: '#546e7a', strokeWidth: 1.2 }));
            d.add(new Konva.Rect({ x: GG.x - 2, y: GG.y + GG.h - 3, width: GG.w + 4, height: 6, cornerRadius: 3, fill: '#b0bec5', stroke: '#546e7a', strokeWidth: 1.2 }));
        }

        // 玻璃水位计水位
        this._glassWater = new Konva.Rect({
            x: G.glassGauge.x + 3, y: G.glassGauge.y + 10, width: G.glassGauge.w - 6, height: 40,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint: { x: 0, y: 120 },
            fillLinearGradientColorStops: [0, '#55d8ff', 1, '#007acb'],
        });
        d.add(this._glassWater);
        // 玻璃管高光 / 刻度 / 标注（画在水柱之上）
        {
            const GG = G.glassGauge;
            d.add(new Konva.Line({ points: [GG.x + 3.5, GG.y + 8, GG.x + 3.5, GG.y + GG.h - 8], stroke: '#ffffff', strokeWidth: 2 }));
            for (let i = 1; i < 6; i++) {
                const yy = GG.y + i * (GG.h / 6);
                d.add(new Konva.Line({ points: [GG.x + GG.w, yy, GG.x + GG.w + 6, yy], stroke: '#90a4ae', strokeWidth: 1.2 }));
            }
            this._glassTxt = new Konva.Text({
                x: GG.x + 22, y: GG.y + GG.h / 2 - 36, width: 90, text: '56%', fontSize: 16, align: 'left',
                fill: '#0277bd', fontStyle: 'bold', fontFamily: 'Arial, "Microsoft YaHei", sans-serif',
            });
            d.add(this._glassTxt);
            d.add(new Konva.Text({
                x: GG.x + 22, y: GG.y + GG.h / 2 - 8, width: 90, text: '玻璃水位计', fontSize: 12, align: 'left',
                fill: '#263238', fontStyle: 'bold', fontFamily: 'Arial, "Microsoft YaHei", sans-serif',
            }));
        }

        // 电极室水位
        this._eleWater = new Konva.Rect({
            x: G.eleInner.x + 2, y: G.eleInner.y + G.eleInner.h * 0.45,
            width: G.eleInner.w - 4, height: G.eleInner.h * 0.55,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint: { x: 0, y: 160 },
            fillLinearGradientColorStops: [0, '#55d8ff', 1, '#007acb'],
            opacity: 0.85,
        });
        d.add(this._eleWater);

        // 4 根电极：自左壁接口向右、再向下悬空在电极室内（浸没时变绿）
        this._electrodes = G.electrodes.map(e => {
            const line = new Konva.Line({
                points: [G.ele.x, e.entryY, e.x, e.entryY, e.x, e.tip],
                stroke: '#1b2830', strokeWidth: 3, lineCap: 'round', lineJoin: 'round',
            });
            const tip = new Konva.Circle({ x: e.x, y: e.tip, radius: 3.6, fill: '#aeb8bf', stroke: '#202a31', strokeWidth: 1 });
            d.add(line, tip);
            return { line, tip, def: e };
        });

        // 火焰（SVG 双层火焰）
        // 火焰组以火根中心 (754, 789.5) 为缩放原点：小火缩小时不跑位
        this._flameGroup = new Konva.Group({
            x: X(754), y: Y(789.5), offset: { x: 754, y: 789.5 }, scaleX: S, scaleY: S,
        });
        this._flameOuter = new Konva.Path({
            data: 'M650 783 Q626 748 660 709 Q658 679 682 657 Q683 698 700 708 Q704 667 727 641 Q723 700 746 713 Q757 676 779 653 Q779 703 799 713 Q812 681 834 674 Q823 722 852 751 L858 790 L650 790Z',
            fillLinearGradientStartPoint: { x: 0, y: 640 },
            fillLinearGradientEndPoint: { x: 0, y: 790 },
            fillLinearGradientColorStops: [0, '#fff34c', 0.5, '#ff8a00', 1, '#d92700'],
            opacity: 0.9,
        });
        this._flameInner = new Konva.Path({
            data: 'M690 789 Q675 751 706 724 Q706 704 720 688 Q721 730 741 744 Q753 710 768 696 Q765 744 790 757 Q804 731 817 725 Q811 766 831 789Z',
            fill: '#fff45a', opacity: 0.95,
        });
        this._flameGroup.add(this._flameOuter, this._flameInner);
        d.add(this._flameGroup);

        // 烟囱上方烟团
        this._smoke = [];
        [[714, 35, 20], [741, 24, 25], [768, 33, 22], [790, 18, 18]].forEach(([cx, cy, r], i) => {
            const c = new Konva.Circle({ x: X(cx), y: Y(cy), radius: W2(r), fill: '#dfe3e6', opacity: 0 });
            d.add(c);
            this._smoke.push({ node: c, phase: i / 4, baseR: W2(r) });
        });

        // 泵与风机叶轮
        const mkImpeller = (cx, cy, r, n = 4) => {
            const gg = new Konva.Group({ x: cx, y: cy });
            for (let i = 0; i < n; i++) {
                gg.add(new Konva.Line({ points: [0, 0, r * 0.7, 0], stroke: '#37474f', strokeWidth: 3, lineCap: 'round', rotation: i * (360 / n) }));
            }
            gg.add(new Konva.Circle({ x: 0, y: 0, radius: 3, fill: '#37474f' }));
            d.add(gg);
            return gg;
        };
        // 给水泵：圆内三角形（运行时三角填充绿色）
        this._wpTri = [G.wpump1, G.wpump2].map(p => {
            const tri = new Konva.Line({
                points: [p.cx, p.cy - p.r * 0.65,
                         p.cx - p.r * 0.48, p.cy + p.r * 0.34,
                         p.cx + p.r * 0.48, p.cy + p.r * 0.34],
                closed: true, fill: '#ffffff', stroke: '#00695c', strokeWidth: 2, lineJoin: 'round',
            });
            d.add(tri);
            return tri;
        });
        this._impFan = mkImpeller(G.fan.cx, G.fan.cy, G.fan.r - 5, 3);   // 风机 3 叶片

        // 风门挡板
        const DM = G.damper;
        this._damperPlate = new Konva.Rect({
            x: DM.cx - 2.5, y: DM.cy - DM.r + 2, width: 5, height: DM.r * 2 - 4,
            fill: '#0277bd', cornerRadius: 2, rotation: 20,
        });
        this._damperPlate.offsetY((DM.r * 2 - 4) / 2);
        this._damperPlate.y(DM.cy - (DM.r - 2) + ((DM.r * 2 - 4) / 2));
        d.add(this._damperPlate);

        // 手动截止阀（水箱两路进水 / 水箱出水 / 锅炉进水）：点击开 / 关，开时阀体绿色
        this._mvOpen = [true, true, true, true];
        const mvDef = [
            { x: 470, y: G.feedTank.y + 30, up: true },
            { x: 470, y: G.feedTank.y + 80, up: true },
            { x: G.feedTank.x + G.feedTank.w + 50, y: G.feedTank.y + G.feedTank.h * 0.75, up: false },
            { x: G.feed.valveX, y: G.feed.y, up: true },
        ];
        this._mvParts = mvDef.map(vv => {
            const { x: vx, y: vy } = vv;
            const tri1 = new Konva.Line({ points: [vx - 14, vy - 11, vx - 14, vy + 11, vx, vy], closed: true, fill: '#e0f2f1', stroke: '#0b3d36', strokeWidth: 1.7 });
            const tri2 = new Konva.Line({ points: [vx + 14, vy - 11, vx + 14, vy + 11, vx, vy], closed: true, fill: '#e0f2f1', stroke: '#0b3d36', strokeWidth: 1.7 });
            const sy = vv.up ? -18 : 18;
            const stem = new Konva.Line({ points: [vx, vy, vx, vy + sy], stroke: '#0b3d36', strokeWidth: 2 });
            const bar = new Konva.Line({ points: [vx - 10, vy + sy, vx + 10, vy + sy], stroke: '#0b3d36', strokeWidth: 2 });
            d.add(tri1, tri2, stem, bar);
            return { tri1, tri2, stem, bar };
        });

        // 支路单向阀：上三角灰色；下三角导通绿色、不导通白色；两三角尖重叠
        this._cvDown = [G.wpump1, G.wpump2].map(p => {
            const cyv = 564;
            const up = new Konva.Line({ points: [p.cx - 12, cyv - 12, p.cx + 12, cyv - 12, p.cx, cyv], closed: true, fill: '#b0bec5', stroke: '#0b3d36', strokeWidth: 1.7 });
            const dn = new Konva.Line({ points: [p.cx - 12, cyv + 12, p.cx + 12, cyv + 12, p.cx, cyv], closed: true, fill: '#ffffff', stroke: '#0b3d36', strokeWidth: 1.7 });
            d.add(up, dn);
            return dn;
        });

        // 安全阀阀体：主三角（向上）+ 左侧向右三角，卸放时红色
        {
            const SV = G.safetyValve;
            this._safetyTris = [
                new Konva.Line({ points: [SV.x - 13, SV.base, SV.x + 13, SV.base, SV.x, SV.base - 22], closed: true, fill: '#e8eef2', stroke: '#17232b', strokeWidth: 2 }),
                new Konva.Line({ points: [SV.x - 28, SV.base - 34, SV.x - 28, SV.base - 10, SV.x, SV.base - 22], closed: true, fill: '#e8eef2', stroke: '#17232b', strokeWidth: 2 }),
            ];
            d.add(this._safetyTris[0], this._safetyTris[1]);
        }

        // 三个电磁阀阀体（通电时绿色填充）
        this._gasTris = [G.gasMain, G.gas1, G.gas2].map(v => {
            const cx = v.x + v.w / 2, cy = v.y + v.h / 2, hw = v.w / 2;
            const a = new Konva.Line({ points: [cx - hw, cy - 10, cx - hw, cy + 10, cx, cy], closed: true, fill: '#e4eaee', stroke: '#0b0b0b', strokeWidth: 2, lineJoin: 'miter' });
            const b = new Konva.Line({ points: [cx + hw, cy - 10, cx + hw, cy + 10, cx, cy], closed: true, fill: '#e4eaee', stroke: '#0b0b0b', strokeWidth: 2, lineJoin: 'miter' });
            d.add(a, b);
            return [a, b];
        });

        // 电磁线圈（通电红色填充）
        this._coils = [G.gasMain, G.gas1, G.gas2].map(v => {
            const cx = v.x + v.w / 2, cy = v.y + v.h / 2;
            const body = new Konva.Rect({
                x: cx - 10, y: cy - 32, width: 20, height: 14, cornerRadius: 2,
                fill: '#ffffff', stroke: '#0b0b0b', strokeWidth: 1.8,
            });
            d.add(body);
            // 线圈内画一根对角线
            d.add(new Konva.Line({
                points: [cx - 9, cy - 31, cx + 9, cy - 19],
                stroke: '#0b0b0b', strokeWidth: 1.4,
            }));
            return body;
        });

        // 点火火花（电极尖端之间：外层发光 + 内层电弧，逐帧随机锯齿）
        this._sparkGrp = new Konva.Group({ visible: false });
        this._sparkGlow = new Konva.Line({ points: [0, 0, 1, 1], stroke: '#ffea00', strokeWidth: 8, opacity: 0.3, lineCap: 'round', lineJoin: 'round' });
        this._spark = new Konva.Line({ points: [0, 0, 1, 1], stroke: '#ffffff', strokeWidth: 2.4, lineCap: 'round', lineJoin: 'round' });
        this._sparkGrp.add(this._sparkGlow, this._spark);
        d.add(this._sparkGrp);

        // 压力表指针
        this._needle = new Konva.Group({ x: G.gauge.cx, y: G.gauge.cy, rotation: -135 });
        this._needle.add(new Konva.Line({ points: [0, 6, 0, -G.gauge.r + 10], stroke: '#c62828', strokeWidth: 2.2, lineCap: 'round' }));
        this._needle.add(new Konva.Circle({ x: 0, y: 0, radius: 3, fill: '#37474f' }));
        d.add(this._needle);

        // 压力表读数（动态标注：xx MPa）
        this._gaugeTxt = new Konva.Text({
            x: G.gauge.cx - 52, y: G.gauge.cy - G.gauge.r - 24, width: 104, text: '0.00 MPa',
            fontSize: 13, align: 'center', fill: '#263238', fontStyle: 'bold',
            fontFamily: 'Arial, "Microsoft YaHei", sans-serif',
        });
        d.add(this._gaugeTxt);

        // 重油加热器后的燃油温度读数
        this._oilTempTxt = new Konva.Text({
            x: G.heater.x + 68, y: G.heater.y + 6, width: 54, text: '108℃',
            fontSize: 12, fill: '#e65100', fontStyle: 'bold',
            fontFamily: 'Arial, "Microsoft YaHei", sans-serif',
        });
        d.add(this._oilTempTxt);

        // 油温继电器指示灯
        this._oilTempLamp = new Konva.Circle({
            x: G.oilTempRelay.x + 13, y: G.oilTempRelay.y + 14, radius: 5, fill: '#00e676',
        });
        d.add(this._oilTempLamp);

        // 风压继电器指示灯
        this._airLamp = new Konva.Circle({
            x: G.airRelay.x + 13, y: G.airRelay.y + 14, radius: 5, fill: '#37474f',
        });
        d.add(this._airLamp);

        // 风门电磁线圈（通电红色填充）
        this._coil = new Konva.Rect({
            x: G.damper.cx - 14, y: G.damper.cy - G.damper.r - 21, width: 28, height: 16,
            cornerRadius: 3, fill: '#cfd8dc', stroke: '#37474f', strokeWidth: 1.6,
        });
        d.add(this._coil);

        // I2.4（火焰信号）接线端子：高电平时红色填充
        this._i24Term = new Konva.Rect({
            x: 470, y: G.fsTerms[1].y, width: 24, height: 12, cornerRadius: 2,
            fill: '#eceff1', stroke: '#546e7a', strokeWidth: 1.4,
        });
        d.add(this._i24Term);

        // 继电器指示灯（4 只，横向）
        this._relayLamps = G.relays.map(it => {
            const c = new Konva.Circle({ x: it.x + 9, y: it.y + 11, radius: 5, fill: '#37474f' });
            d.add(c);
            return c;
        });

        // 火焰监视器接线（默认连通，点击可断开 → 无火焰信号）
        this._fsBroken = [false, false];
        this._fsWires = G.fsPosts.map((py, i) => {
            const x0 = 494, x1 = 529, mid = (x0 + x1) / 2;
            const segL = new Konva.Line({ points: [x0, py, mid - 7, py], stroke: '#1e88e5', strokeWidth: 2.4, lineCap: 'round' });
            const segR = new Konva.Line({ points: [mid + 7, py, x1, py], stroke: '#1e88e5', strokeWidth: 2.4, lineCap: 'round' });
            const bridge = new Konva.Line({ points: [mid - 7, py, mid + 7, py], stroke: '#1e88e5', strokeWidth: 2.4, lineCap: 'round' });
            d.add(segL, segR, bridge);
            return { segL, segR, bridge };
        });

        // 手动三通阀阀体三角（默认右位通：下 + 右 两个三角绿色）
        const TW = G.threeWay;
        this._twPos = 'right';                     // right | left
        this._twTriL = new Konva.Line({ points: [TW.cx - 15, TW.cy - 10, TW.cx - 15, TW.cy + 10, TW.cx, TW.cy], closed: true, fill: '#f5f7f8', stroke: '#37474f', strokeWidth: 1.8 });
        this._twTriR = new Konva.Line({ points: [TW.cx + 15, TW.cy - 10, TW.cx + 15, TW.cy + 10, TW.cx, TW.cy], closed: true, fill: '#f5f7f8', stroke: '#37474f', strokeWidth: 1.8 });
        this._twTriB = new Konva.Line({ points: [TW.cx - 10, TW.cy + 15, TW.cx + 10, TW.cy + 15, TW.cx, TW.cy], closed: true, fill: '#f5f7f8', stroke: '#37474f', strokeWidth: 1.8 });
        d.add(this._twTriL, this._twTriR, this._twTriB);

        // 两条支路的入口截止阀（可手动开/关，开时阀体绿色）
        this._ovOpen = [true, true];        // 入口截止阀默认接通（起动系统即有油）
        this._ovParts = [G.oilPump1, G.oilPump2].map(p => {
            const vy = 276;
            const tri1 = new Konva.Line({ points: [p.cx - 11, vy, p.cx + 11, vy, p.cx, vy + 9], closed: true, fill: '#eceff1', stroke: '#37474f', strokeWidth: 1.7 });
            const tri2 = new Konva.Line({ points: [p.cx - 11, vy + 18, p.cx + 11, vy + 18, p.cx, vy + 9], closed: true, fill: '#eceff1', stroke: '#37474f', strokeWidth: 1.7 });
            const stem = new Konva.Line({ points: [p.cx, vy + 9, p.cx + 21, vy + 9], stroke: '#37474f', strokeWidth: 2 });
            const bar = new Konva.Line({ points: [p.cx + 21, vy + 2, p.cx + 21, vy + 16], stroke: '#37474f', strokeWidth: 2 });
            d.add(tri1, tri2, stem, bar);
            return { tri1, tri2, stem, bar };
        });

        // 油泵内部双圆（运行时绿色）
        this._oilInners = [G.oilPump1, G.oilPump2].map(p => {
            const c1 = new Konva.Circle({ x: p.cx, y: p.cy - 10, radius: 11, fill: '#ffffff', stroke: '#5d4037', strokeWidth: 1.6 });
            const c2 = new Konva.Circle({ x: p.cx, y: p.cy + 10, radius: 11, fill: '#ffffff', stroke: '#5d4037', strokeWidth: 1.6 });
            d.add(c1, c2);
            return [c1, c2];
        });

        // 油流虚线：油柜 → 三通阀 → 支路截止阀 → 油泵 → 加热器 → 总电磁阀 → 分路
        const mkFlow = () => {
            const l = new Konva.Line({
                points: [0, 0, 1, 1], stroke: '#ff8f00', strokeWidth: 3, dash: [9, 7],
                opacity: 0, lineJoin: 'round', lineCap: 'round',
            });
            d.add(l);
            l.moveToBottom();          // 压在静态层之上、动态符号（阀体/线圈/泵内圆）之下
            return l;
        };
        this._flowA = mkFlow();       // 油柜 → 三通阀 → 分支 → 截止阀
        this._flowB = mkFlow();       // 泵出口 → 汇合 → 加热器入口
        this._flowC1 = mkFlow();      // 加热器出口 → 总电磁阀入口
        this._flowC2 = mkFlow();      // 总电磁阀出口 → 分叉点
        this._flowLo1 = mkFlow();     // 分叉 → 下路 1# 电磁阀
        this._flowLo2 = mkFlow();     // 1# 电磁阀 → 燃烧器左侧
        this._flowHi1 = mkFlow();     // 分叉 → 上路 2# 电磁阀
        this._flowHi2 = mkFlow();     // 2# 电磁阀 → 燃烧器顶部
        this._waterFlow = new Konva.Line({
            points: [0, 0, 1, 1], stroke: '#26c6da', strokeWidth: 3.5, dash: [10, 8], opacity: 0, lineJoin: 'round',
        });
        d.add(this._waterFlow);
        this._waterFlow2 = new Konva.Line({
            points: [0, 0, 1, 1], stroke: '#26c6da', strokeWidth: 3.5, dash: [10, 8], opacity: 0, lineJoin: 'round',
        });
        d.add(this._waterFlow2);

        // 排污截止阀（普通截止阀：上下对顶三角形 + 横杆与末端竖杆手柄），导通时阀体填充绿色
        const BD = G.blowdown;
        const vMid = (BD.valveTop + BD.valveBot) / 2;
        this._bdOpen = false;
        this._bdTri1 = new Konva.Line({
            points: [BD.valveX - 13, BD.valveTop, BD.valveX + 13, BD.valveTop, BD.valveX, vMid],
            closed: true, fill: '#e4eaee', stroke: '#0b0b0b', strokeWidth: 2.4, lineJoin: 'miter',
        });
        this._bdTri2 = new Konva.Line({
            points: [BD.valveX - 13, BD.valveBot, BD.valveX + 13, BD.valveBot, BD.valveX, vMid],
            closed: true, fill: '#e4eaee', stroke: '#0b0b0b', strokeWidth: 2.4, lineJoin: 'miter',
        });
        this._bdStem = new Konva.Line({
            points: [BD.valveX, vMid, BD.valveX + 30, vMid], stroke: '#0b0b0b', strokeWidth: 3, lineCap: 'butt',
        });
        this._bdBar = new Konva.Line({
            points: [BD.valveX + 30, vMid - 15, BD.valveX + 30, vMid + 15], stroke: '#0b0b0b', strokeWidth: 3, lineCap: 'butt',
        });
        d.add(this._bdTri1, this._bdTri2, this._bdStem, this._bdBar);

        // 蒸汽主截止阀（阀体 + 向上 T 形手柄；开时绿色填充）
        const SPK = G.steamMain;
        const svMid = SPK.upY;
        this._svOpen = false;
        this._svTri1 = new Konva.Line({
            points: [SPK.valveX - SPK.vHalfW, svMid - SPK.vHalfH, SPK.valveX - SPK.vHalfW, svMid + SPK.vHalfH, SPK.valveX, svMid],
            closed: true, fill: '#e4eeea', stroke: '#0b0b0b', strokeWidth: 2.4, lineJoin: 'miter',
        });
        this._svTri2 = new Konva.Line({
            points: [SPK.valveX + SPK.vHalfW, svMid - SPK.vHalfH, SPK.valveX + SPK.vHalfW, svMid + SPK.vHalfH, SPK.valveX, svMid],
            closed: true, fill: '#e4eeea', stroke: '#0b0b0b', strokeWidth: 2.4, lineJoin: 'miter',
        });
        this._svStem = new Konva.Line({ points: [SPK.valveX, svMid, SPK.valveX, svMid - 22], stroke: '#0b0b0b', strokeWidth: 2.8 });
        this._svBar = new Konva.Line({ points: [SPK.valveX - 16, svMid - 22, SPK.valveX + 16, svMid - 22], stroke: '#0b0b0b', strokeWidth: 2.8 });
        d.add(this._svTri1, this._svTri2, this._svStem, this._svBar);

        // 负荷调节旋钮（默认 10%）：指针 + 数值
        this._load = 50;                        // 默认负荷 50%（设定值）
        this._applyLoadDemand();                // 阀默认关闭 → 实际负荷 0
        this._loadPtr = new Konva.Group({
            x: SPK.knobX, y: SPK.upY, rotation: -135 + (this._load / 100) * 270,
        });
        // 指示条：贯通旋钮的长条 + 端部红色指示块
        this._loadPtr.add(new Konva.Rect({
            x: -2.5, y: -(SPK.knobR - 8), width: 5, height: SPK.knobR - 16, cornerRadius: 2.5,
            fill: '#f7fbfd', stroke: '#39424a', strokeWidth: 0.8,
        }));
        this._loadPtr.add(new Konva.Rect({
            x: -3.5, y: -(SPK.knobR - 2), width: 7, height: 7, cornerRadius: 2, fill: '#d32f2f',
        }));
        d.add(this._loadPtr);
        this._loadTxt = new Konva.Text({
            x: SPK.knobX - 40, y: SPK.upY - SPK.knobR - 23, width: 80, text: `${this._load}%`, fontSize: 16,
            align: 'center', fill: '#c62828', fontStyle: 'bold', fontFamily: 'Arial, "Microsoft YaHei", sans-serif',
        });
        d.add(this._loadTxt);

        // 默认状态：油泵入口截止阀、给水各截止阀均为「接通」
        this._refreshOilValves();
        this._refreshWaterValves();

        this._txtTop = new Konva.Text({
            x: 700, y: 10, width: 430, text: '停炉', fontSize: 15, align: 'right',
            fill: '#1b3a4b', fontStyle: 'bold', fontFamily: 'Arial, "Microsoft YaHei", sans-serif',
        });
        d.add(this._txtTop);
    }

    _bindInteraction() {
        const G = this._geo;
        const reg = (id, x, y, w, h) => {
            const node = this.addClickablePart(id, x, y, w, h, true);
            node.on('click tap', () => { if (this.sys) this.sys.lastClickedPartId = this.id + '/' + id; });
            return node;
        };
        reg('boiler', G.shell.x, G.shell.y, G.shell.w, G.shell.h);
        reg('furnace', G.furnace.x, G.furnace.y, G.furnace.w, G.furnace.h);
        reg('stack', G.stack.x, G.stack.y, G.stack.w, G.stack.h);
        reg('electrode', G.ele.x, G.ele.y, G.ele.w, G.ele.h);
        reg('burner', G.burner.x, G.burner.y, G.burner.w + G.nozzle.w, G.burner.h);
        reg('igniter', G.ignitTf.x, G.ignitTf.y, G.ignitTf.w, G.ignitTf.h);
        reg('oil-tank', G.tank.x, G.tank.y, G.tank.w, G.tank.h);
        reg('oil-tank-2', G.tank2.x, G.tank2.y, G.tank2.w, G.tank2.h);
        reg('feed-tank', G.feedTank.x, G.feedTank.y, G.feedTank.w, G.feedTank.h);

        reg('oil-pump-1', G.oilPump1.cx - G.oilPump1.r, G.oilPump1.cy - G.oilPump1.r, G.oilPump1.r * 2, G.oilPump1.r * 2);
        reg('oil-pump-2', G.oilPump2.cx - G.oilPump2.r, G.oilPump2.cy - G.oilPump2.r, G.oilPump2.r * 2, G.oilPump2.r * 2);
        reg('oil-heater', G.heater.x, G.heater.y, G.heater.w, G.heater.h);
        reg('gas-main', G.gasMain.x, G.gasMain.y, G.gasMain.w, G.gasMain.h);
        reg('gas-1', G.gas1.x, G.gas1.y, G.gas1.w, G.gas1.h);
        reg('gas-2', G.gas2.x, G.gas2.y, G.gas2.w, G.gas2.h);
        reg('fan', G.fan.cx - G.fan.r, G.fan.cy - G.fan.r, G.fan.r * 2, G.fan.r * 2);
        reg('damper', G.damper.cx - G.damper.r, G.damper.cy - G.damper.r, G.damper.r * 2, G.damper.r * 2);
        reg('air-relay', G.airRelay.x, G.airRelay.y, G.airRelay.w, G.airRelay.h);
        reg('water-pump-1', G.wpump1.cx - G.wpump1.r, G.wpump1.cy - G.wpump1.r, G.wpump1.r * 2, G.wpump1.r * 2);
        reg('water-pump-2', G.wpump2.cx - G.wpump2.r, G.wpump2.cy - G.wpump2.r, G.wpump2.r * 2, G.wpump2.r * 2);
        reg('pressure-gauge', G.gauge.cx - G.gauge.r, G.gauge.cy - G.gauge.r, G.gauge.r * 2, G.gauge.r * 2);
        const SPK = G.steamMain;
        // 负荷旋钮：按住上半部向右拖（或下半部向左拖）负荷增大，反向减小
        const knobHit = this.addClickablePart('load-knob', SPK.knobX - SPK.knobR, SPK.upY - SPK.knobR, SPK.knobR * 2, SPK.knobR * 2, true);
        this._bindLoadDrag(knobHit);
        // 蒸汽主截止阀：点击开 / 关
        this.addClickablePart('steam-valve', SPK.valveX - SPK.vHalfW, SPK.upY - SPK.vHalfH - 26, SPK.vHalfW * 2, SPK.vHalfH * 2 + 30, true)
            .on('click tap', (e) => {
                e.cancelBubble = true;
                this._svOpen = !this._svOpen;
                this._applyLoadDemand();
                if (this.sys && typeof this.sys.showFloatingTip === 'function') {
                    this.sys.showFloatingTip(
                        this._svOpen
                            ? `蒸汽主截止阀：已开启（实际负荷 ${this._load}%）`
                            : '蒸汽主截止阀：已关闭（实际负荷 0%）', 2200);
                }
            });
        const BDP = G.blowdown;
        this.addClickablePart('blowdown-valve', BDP.valveX - 16, BDP.valveTop - 6, 62, (BDP.valveBot - BDP.valveTop) + 12, true)
            .on('click tap', (e) => {
                e.cancelBubble = true;
                this._toggleBlowdown();
            });
        // 两条支路的入口截止阀：点击开 / 关
        [G.oilPump1, G.oilPump2].forEach((p, i) => {
            this.addClickablePart(`oil-valve-${i + 1}`, p.cx - 14, 272, 42, 26, true)
                .on('click tap', (e) => {
                    e.cancelBubble = true;
                    this._toggleOilValve(i);
                });
        });
        // 手动三通阀：点击切换左位 / 右位
        this.addClickablePart('three-way-valve', G.threeWay.cx - 17, G.threeWay.cy - 25, 34, 44, true)
            .on('click tap', (e) => {
                e.cancelBubble = true;
                this._toggleThreeWay();
            });
        // 手动截止阀：水箱两路进水 / 水箱出水 / 锅炉进水
        const mvPos = [
            { id: 'wv-condensate', x: 470, y: G.feedTank.y + 30 },
            { id: 'wv-freshwater', x: 470, y: G.feedTank.y + 80 },
            { id: 'wv-tank-out', x: G.feedTank.x + G.feedTank.w + 50, y: G.feedTank.y + G.feedTank.h * 0.75 },
            { id: 'wv-boiler-in', x: G.feed.valveX, y: G.feed.y },
        ];
        mvPos.forEach((v, i) => {
            this.addClickablePart(v.id, v.x - 16, v.y - 24, 32, 48, true)
                .on('click tap', (e) => {
                    e.cancelBubble = true;
                    this._toggleWaterValve(i);
                });
        });
        this._refreshWaterValves();
        this._refreshThreeWay();
        this._refreshOilValves();          // 默认两路入口截止阀开启（绿色）

        // 火焰监视器接线：点击断开 / 恢复（模拟点火失败或中途熄火）
        G.fsPosts.forEach((py, i) => {
            this.addClickablePart(`flame-wire-${i + 1}`, 490, py - 7, 44, 14, true)
                .on('click tap', (e) => {
                    e.cancelBubble = true;
                    this._toggleFlameWire(i);
                });
        });
        ['relay-hl-low', 'relay-hl-high', 'relay-auto', 'relay-over'].forEach((id, i) => {
            const it = G.relays[i];
            reg(id, it.x, it.y, it.w, it.h);
        });
    }

    /** 负荷调节旋钮：设定蒸汽负荷百分比（0~100%，1% 连续可调） */
    _setLoad(p) {
        const v = Math.max(0, Math.min(100, Math.round(p)));      // 1% 连续变化
        if (v === this._load) return;
        this._load = v;
        const SPK = this._geo.steamMain;
        if (this._loadPtr) this._loadPtr.rotation(-135 + (this._load / 100) * 270);
        if (this._loadTxt) this._loadTxt.text(`${this._load}%`);
        this._applyLoadDemand();
        if (this.sys && typeof this.sys.showFloatingTip === 'function') {
            this.sys.showFloatingTip(`蒸汽负荷：${this._load}%`, 1500);
        }
        if (this.sys && typeof this.sys.requestRedraw === 'function') this.sys.requestRedraw();
    }

    /**
     * 负荷 → 用汽量（MPa/s）。设计点：
     *   · 小火热负荷（默认 0.0030）与 30% 负荷平衡
     *   · 大火热负荷（默认 0.0045）与 80% 负荷平衡
     * 0% 时为 0，30% 与 80% 之间线性过渡，80% 以上按同一斜率外延。
     */
    _demandForLoad(loadPct, cfg) {
        const L = Math.max(0, Math.min(100, loadPct));
        const low = (cfg && cfg.heatLow) || 0.0030;
        const full = (cfg && cfg.heatFull) || 0.0045;
        if (L <= 30) return low * L / 30;
        const slope = (full - low) / 50;
        if (L <= 80) return low + slope * (L - 30);
        return full + slope * (L - 80);
    }

    /**
     * 实际负荷率 → 用汽量：
     *   · 蒸汽主截止阀关闭 → 实际负荷 0（不对外供汽）→ demand = 0
     *   · 蒸汽主截止阀打开 → 实际负荷 = 负荷调节旋钮设定值
     */
    _applyLoadDemand() {
        const s = this._solver();
        if (!s || !s.cfg) return;
        s.cfg.demand = this._svOpen ? this._demandForLoad(this._load, s.cfg) : 0;
    }

    /** 负荷旋钮拖动：上半部向右 / 下半部向左 → 负荷增大，反向则减小 */
    _bindLoadDrag(hit) {
        if (!hit) return;
        const stage = this.sys && this.sys.stage;
        if (!stage) return;
        const SPK = this._geo.steamMain;
        const cx = SPK.knobX, cy = SPK.upY;

        // 指针相对盘心的角度：0° = 正上，顺时针为正
        const angleOf = (p) => {
            const inv = this.group.getAbsoluteTransform().copy().invert();
            const q = inv.point(p);
            return Math.atan2(q.x - cx, -(q.y - cy)) * 180 / Math.PI;
        };

        const start = (e) => {
            if (e && e.cancelBubble !== undefined) e.cancelBubble = true;
            const p = stage.getPointerPosition();
            if (!p) return;
            // 拖旋钮时禁止整张系统图跟着平移
            if (this.group.draggable()) { this.group.draggable(false); this._knobDragLocked = true; }
            // 以「指针实际角度」为累加量（-135°~+135° 对应 0~100%），到端点即停住
            this._drag = { last: angleOf(p), ang: -135 + (this._load / 100) * 270 };
            stage.on('mousemove.loadknob', move);
            stage.on('mouseup.loadknob', up);
            stage.on('touchmove.loadknob', move);
            stage.on('touchend.loadknob', up);
        };

        const move = () => {
            const p = stage.getPointerPosition();
            if (!p || !this._drag) return;
            const a = angleOf(p);
            let d = a - this._drag.last;
            while (d > 180) d -= 360;
            while (d < -180) d += 360;
            this._drag.last = a;
            // 累加到指针角度并限位在 -135°~+135°：到头就停，不会从 0 跳到 100
            this._drag.ang = Math.max(-135, Math.min(135, this._drag.ang + d));
            // 指针全行程 270° 对应 100%，顺时针（角度增大）= 负荷增大
            this._setLoad((this._drag.ang + 135) / 2.7);
        };

        const up = () => {
            stage.off('mousemove.loadknob');
            stage.off('mouseup.loadknob');
            stage.off('touchmove.loadknob');
            stage.off('touchend.loadknob');
            if (this._knobDragLocked) { this.group.draggable(true); this._knobDragLocked = false; }
            this._drag = null;
        };

        hit.on('mousedown touchstart', start);
    }

    /**
     * 油流虚线：按实际通路逐段显示
     *   油柜(由三通阀左右位决定) → 三通阀 → 分到运行泵所在支路 → 入口截止阀 → 油泵
     *   → 汇合 → 加热器 → 总电磁阀 → 分叉 →（1# 电磁阀→燃烧器左侧 / 2# 电磁阀→燃烧器顶部）
     */
    _updateOilFlow(out, dt) {
        if (!this._flowA) return;
        const G = this._geo, tw = G.threeWay;
        const useRight = this._twPos === 'right';
        const tank = useRight ? G.tank2 : G.tank;
        const portX = useRight ? tw.cx + tw.w / 2 : tw.cx - tw.w / 2;
        const pumpIdx = out.oilPump1 ? 0 : (out.oilPump2 ? 1 : -1);
        const pump = pumpIdx === 0 ? G.oilPump1 : (pumpIdx === 1 ? G.oilPump2 : null);
        const valveOk = pumpIdx >= 0 ? this._ovOpen[pumpIdx] !== false : false;
        const bx = pump ? pump.cx : G.oilPump1.cx;
        const MAIN_Y = G.gasMain.y + G.gasMain.h / 2;
        const upY = G.gas2.y + G.gas2.h / 2;
        const on = !!pump && valveOk && !!out.gasMain;

        // A：柜底 → 三通阀 → 分支 → 截止阀 → 泵入口
        this._flowA.points([
            tank.x + tank.w / 2, tank.y + tank.h,
            tank.x + tank.w / 2, tw.cy,
            portX, tw.cy,
            tw.cx, tw.cy,
            tw.cx, 252,
            bx, 252,
            bx, pump ? pump.cy - pump.r : 309,
        ]);
        // B：泵出口 → 汇合 → 加热器入口
        this._flowB.points([bx, pump ? pump.cy + pump.r : 351, bx, 382, tw.cx, 382, tw.cx, G.heater.y]);
        // C：加热器出口 → 总电磁阀 → 分叉点
        this._flowC1.points([G.heater.x + G.heater.w, MAIN_Y, G.gasMain.x, MAIN_Y]);
        this._flowC2.points([G.gasMain.x + G.gasMain.w, MAIN_Y, 254, MAIN_Y]);
        // 下路 / 上路
        this._flowLo1.points([254, MAIN_Y, 254, G.fuelY, G.gas1.x, G.fuelY]);
        this._flowLo2.points([G.gas1.x + G.gas1.w, G.fuelY, G.burner.x, G.fuelY]);
        this._flowHi1.points([254, MAIN_Y, 254, upY, G.gas2.x, upY]);
        this._flowHi2.points([G.gas2.x + G.gas2.w, upY, 450, upY, 450, G.burner.y]);

        const mainOn = on;
        const loOn = on && !!out.gas1;
        const hiOn = on && !!out.gas2;
        const set = (n, v) => {
            n.opacity(v ? 0.95 : 0);
            if (v) n.dashOffset((n.dashOffset() || 0) - dt * 40);
        };
        set(this._flowA, mainOn);
        set(this._flowB, mainOn);
        set(this._flowC1, mainOn);
        set(this._flowC2, mainOn);
        set(this._flowLo1, loOn);
        set(this._flowLo2, loOn);
        set(this._flowHi1, hiOn);
        set(this._flowHi2, hiOn);
    }

    /** 支路入口截止阀：手动开 / 关（开时阀体绿色） */
    _toggleOilValve(i) {
        this._ovOpen[i] = !this._ovOpen[i];
        const sv = this._solver();
        if (sv && Array.isArray(sv.oilValves)) sv.oilValves[i] = this._ovOpen[i];
        this._refreshOilValves();
        if (this.sys && typeof this.sys.showFloatingTip === 'function') {
            this.sys.showFloatingTip(`${i + 1}# 油路入口截止阀：${this._ovOpen[i] ? '已开启' : '已关闭'}`, 1800);
        }
        if (this.sys && typeof this.sys.requestRedraw === 'function') this.sys.requestRedraw();
    }

    _refreshOilValves() {
        if (!this._ovParts) return;
        this._ovParts.forEach((v, i) => {
            const on = this._ovOpen[i];
            [v.tri1, v.tri2].forEach(t => {
                t.fill(on ? '#00e676' : '#eceff1');
                t.stroke(on ? '#1b5e20' : '#37474f');
            });
            v.stem.stroke(on ? '#1b5e20' : '#37474f');
            v.bar.stroke(on ? '#1b5e20' : '#37474f');
        });
    }

    /** 手动截止阀（给水系统）：开 / 关（开时阀体绿色） */
    _toggleWaterValve(i) {
        this._mvOpen[i] = !this._mvOpen[i];
        this._refreshWaterValves();
        const names = ['冷凝水进口截止阀', '淡水进口截止阀', '水箱出水截止阀', '锅炉进水截止阀'];
        if (this.sys && typeof this.sys.showFloatingTip === 'function') {
            this.sys.showFloatingTip(`${names[i]}：${this._mvOpen[i] ? '已开启' : '已关闭'}`, 1800);
        }
        if (this.sys && typeof this.sys.requestRedraw === 'function') this.sys.requestRedraw();
    }

    _refreshWaterValves() {
        if (!this._mvParts) return;
        this._mvParts.forEach((v, i) => {
            const on = this._mvOpen[i];
            [v.tri1, v.tri2].forEach(t => {
                t.fill(on ? '#00e676' : '#eceff1');
                t.stroke(on ? '#1b5e20' : '#0b3d36');
            });
            v.stem.stroke(on ? '#1b5e20' : '#0b3d36');
            v.bar.stroke(on ? '#1b5e20' : '#0b3d36');
        });
    }

    /** 手动三通阀：切换左位 / 右位（连通的阀位两个三角绿色） */
    _toggleThreeWay() {
        this._twPos = this._twPos === 'right' ? 'left' : 'right';
        this._refreshThreeWay();
        if (this.sys && typeof this.sys.showFloatingTip === 'function') {
            this.sys.showFloatingTip(`手动三通阀：${this._twPos === 'right' ? '右位通（轻油柜供油）' : '左位通（重油柜供油）'}`, 2000);
        }
        if (this.sys && typeof this.sys.requestRedraw === 'function') this.sys.requestRedraw();
    }

    _refreshThreeWay() {
        if (!this._twTriL) return;
        const on = '#00e676', off = '#f5f7f8';
        const rightOn = this._twPos === 'right';
        this._twTriB.fill(on); this._twTriB.stroke('#1b5e20');
        this._twTriR.fill(rightOn ? on : off); this._twTriR.stroke(rightOn ? '#1b5e20' : '#37474f');
        this._twTriL.fill(rightOn ? off : on); this._twTriL.stroke(rightOn ? '#37474f' : '#1b5e20');
        this._twTriB.strokeWidth(1.8);
    }

    /** 火焰监视器接线：断开 / 恢复（断开 → 无火焰信号，模拟点火失败或中途熄火） */
    _toggleFlameWire(i) {
        this._fsBroken[i] = !this._fsBroken[i];
        this._syncFlameWires(true);
    }

    _syncFlameWires(tip) {
        const open = this._fsBroken.some(Boolean);
        this._fsWires.forEach((w, i) => {
            const br = this._fsBroken[i];
            w.bridge.visible(!br);
            const col = br ? '#b0bec5' : '#1e88e5';
            w.segL.stroke(col);
            w.segR.stroke(col);
        });
        const s = this._solver();
        if (s && typeof s.setFault === 'function') s.setFault('flameSensor', open);
        if (tip && this.sys && typeof this.sys.showFloatingTip === 'function') {
            this.sys.showFloatingTip(open
                ? '火焰监视器接线断开：无火焰信号（起动中＝点火失败，运行中＝中途熄火）'
                : '火焰监视器接线已恢复', 2400);
        }
        if (this.sys && typeof this.sys.requestRedraw === 'function') this.sys.requestRedraw();
    }

    /** 排污截止阀：手动开 / 关（图中标注"常闭"，点击可手动开启排污） */
    _toggleBlowdown() {
        this._bdOpen = !this._bdOpen;
        const sv = this._solver();
        if (sv && sv.m) sv.m.blowdown = !!this._bdOpen;     // 排污导通 → 水位下降
        if (this.sys && typeof this.sys.showFloatingTip === 'function') {
            this.sys.showFloatingTip(this._bdOpen ? '排污截止阀：手动开启（排污中）' : '排污截止阀：已关闭（常闭）', 2000);
        }
        if (this.sys && typeof this.sys.requestRedraw === 'function') this.sys.requestRedraw();
    }

    // ═══════════════════════════════════════════════════════════
    //  每帧刷新
    // ═══════════════════════════════════════════════════════════
    tick() {
        const s = this._solver();
        if (!s) return;
        const m = s.m, out = m.out || {}, cfg = s.cfg, G = this._geo;
        const now = performance.now ? performance.now() : Date.now();
        const dt = Math.min(0.2, (now - this._t0) / 1000);
        this._t0 = now;
        const t = now / 1000;
        const lv = Math.max(0, Math.min(1, m.level / 100));

        // ── 汽包水位 ──
        const wy = G.waterBottom - (G.waterBottom - G.waterTop) * lv;
        this._shellWater.y(wy);
        this._shellWater.height(Math.max(0, G.waterBottom - wy));
        this._waterLine.y(wy);

        // ── 玻璃水位计（与左侧电极室水位取同一高度）──
        if (this._glassTxt) this._glassTxt.text(`${(m.level || 0).toFixed(0)}%`);
        if (this._glassWater) {
            const GG = G.glassGauge;
            const ey0 = G.eleWaterBottom - (G.eleWaterBottom - G.eleWaterTop) * lv;   // 同电极室
            const gy = Math.max(GG.y + 4, ey0);
            this._glassWater.y(gy);
            this._glassWater.height(Math.max(0, GG.y + GG.h - 4 - gy));
        }

        // ── 电极室水位 ──
        const ey = G.eleWaterBottom - (G.eleWaterBottom - G.eleWaterTop) * lv;
        this._eleWater.y(ey);
        this._eleWater.height(Math.max(0, G.eleWaterBottom - ey));
        // 电极阈值随参数设置实时刷新（水位 % → 画布 y）
        this._electrodes.forEach(e => {
            const thr = (cfg && typeof cfg[e.def.thrKey] === 'number') ? cfg[e.def.thrKey] : e.def.thr;
            const raw = G.eleWaterBottom - (G.eleWaterBottom - G.eleWaterTop) * (thr / 100);
            const tip = Math.max(e.def.entryY + 6, Math.min(G.eleWaterBottom - 4, raw));
            if (Math.abs(tip - e.def.tip) > 0.5) {
                e.def.tip = tip;
                e.line.points([G.ele.x, e.def.entryY, e.def.x, e.def.entryY, e.def.x, tip]);
                e.tip.y(tip);
            }
        });

        this._electrodes.forEach(e => {
            const wet = ey <= e.def.tip;
            e.line.stroke(wet ? '#00c853' : '#1b2830');
            e.tip.fill(wet ? '#00c853' : '#aeb8bf');
            e.tip.stroke(wet ? '#00701a' : '#202a31');
        });

        // ── 火焰 ──
        const fl = Math.max(0, Math.min(1, m.flame));
        if (fl > 0.02) {
            // 摆动：大小火一致，幅度取原小火幅度的 2/3
            const flick = 1 + (Math.sin(t * 17) * 0.06 + Math.sin(t * 29) * 0.04) * (1 / 6);
            const sizeK = out.gas2 ? 1 : 0.5;      // 小火：火焰高度、宽度减半
            this._flameGroup.visible(true);
            this._flameGroup.scale({ x: S * (0.55 + 0.45 * fl) * flick * sizeK, y: S * fl * sizeK });
            this._flameGroup.opacity(0.45 + 0.55 * fl);
        } else {
            this._flameGroup.visible(false);
        }

        // ── 烟气 ──
        const burning = fl > 0.5;
        this._smoke.forEach((p, i) => {
            p.phase = (p.phase + dt * 0.20) % 1;
            const ph = p.phase;
            p.node.y(Y(48) - ph * 44);
            p.node.x(X(714 + i * 26) + Math.sin(ph * 6 + i) * 6);
            p.node.radius(p.baseR * (0.7 + ph * 0.8));
            p.node.opacity(burning ? (1 - ph) * 0.6 : 0);
        });

        // ── 泵 / 风机 ──
        const spin = (node, on) => { if (on) node.rotation((node.rotation() + dt * 480) % 360); };
        if (this._wpTri) {
            this._wpTri.forEach((t, i) => t.fill((i === 0 ? out.waterPump1 : out.waterPump2) ? '#00e676' : '#ffffff'));
        }
        // ── 入口截止阀状态与求解器同步（复位系统后自动恢复接通）──
        if (Array.isArray(s.oilValves) && this._ovParts
            && (s.oilValves[0] !== this._ovOpen[0] || s.oilValves[1] !== this._ovOpen[1])) {
            this._ovOpen = [s.oilValves[0] !== false, s.oilValves[1] !== false];
            this._refreshOilValves();
        }

        // 油泵：运行时两个内圆绿色
        if (this._oilInners) {
            this._oilInners.forEach((cs, i) => {
                const on = i === 0 ? out.oilPump1 : out.oilPump2;
                cs.forEach(c => {
                    c.fill(on ? '#00e676' : '#ffffff');
                    c.stroke(on ? '#2e7d32' : '#5d4037');
                });
            });
        }
        spin(this._impFan, out.fan);

        // ── 燃油温度读数 / 油温继电器（I2.1）──
        if (this._oilTempTxt) this._oilTempTxt.text(`${(m.oilTemp || 0).toFixed(0)}℃`);
        // I2.1 = (油温 < 90 ℃)：接点闭合 → 指示灯亮（红）；油温回到 ≥90 ℃ 复位 → 熄灭
        if (this._oilTempLamp) {
            this._oilTempLamp.fill((m.oilTemp || 0) < (cfg.oilTempLow || 90) ? '#e53935' : '#37474f');
        }

        // ── 风压继电器指示灯（I2.2 风压正常）──
        if (this._airLamp) this._airLamp.fill(m.airPressureOk ? '#00e676' : '#37474f');

        // ── 支路单向阀：下三角导通（绿）/ 不导通（白）──
        if (this._cvDown) {
            this._cvDown.forEach((dn, i) => dn.fill((i === 0 ? out.waterPump1 : out.waterPump2) ? '#00e676' : '#ffffff'));
        }

        // ── 风门电磁线圈 / 火焰信号 I2.4 ──
        if (this._coil) this._coil.fill(out.damperClosed ? '#e53935' : '#cfd8dc');
        if (this._i24Term) {
            const hot = !!m.flameOn && !this._fsBroken.some(Boolean);
            this._i24Term.fill(hot ? '#ef5350' : '#eceff1');
        }

        // ── 风门 / 电磁阀 / 火花 ──
        // 风门卡死故障：挡板停在关小位置不动
        const stuck = !!(s.faults && s.faults.damperStuck);
        this._damperPlate.rotation(stuck ? 12 : (out.damperClosed ? 12 : 60));   // 通电=小风门，断电=大风门
        if (this._coils) {
            this._coils.forEach((n, i) => n.fill([out.gasMain, out.gas1, out.gas2][i] ? '#e53935' : '#ffffff'));
        }
        if (out.igniter) {
            const sx = X(718), ex = X(754), sy = 555;
            const pts = [sx, sy];
            for (let i = 1; i < 4; i++) {
                pts.push(sx + ((ex - sx) * i) / 4, sy + (Math.random() - 0.5) * 10);
            }
            pts.push(ex, sy);
            this._spark.points(pts);
            this._sparkGlow.points(pts);
            this._sparkGrp.visible(Math.random() > 0.3);
            this._sparkGlow.opacity(0.2 + Math.random() * 0.4);
        } else {
            this._sparkGrp.visible(false);
        }
        // ── 安全阀：卸放（压力 > 1.05 MPa）时阀体变红 ──
        if (this._safetyTris) {
            const op = !!m.safetyOpen;
            this._safetyTris.forEach(t => t.fill(op ? '#ef5350' : '#e8eef2'));
        }

        // 电磁阀阀体：通电绿色填充
        if (this._gasTris) {
            this._gasTris.forEach((ts, i) => {
                const on = [out.gasMain, out.gas1, out.gas2][i];
                ts.forEach(nd => {
                    nd.fill(on ? '#00e676' : '#e4eaee');
                    nd.stroke(on ? '#1b5e20' : '#0b0b0b');
                });
            });
        }

        // ── 实际负荷折算（阀位 × 旋钮设定）──
        this._applyLoadDemand();
        // ── 排污阀位同步（导通 → 水位按 1 %/s 下降）──
        if (s.m) s.m.blowdown = !!this._bdOpen;

        // ── 压力表 / 阶段 ──
        this._needle.rotation(-135 + Math.min(1, m.pressure / 1.0) * 270);
        if (this._gaugeTxt) this._gaugeTxt.text(`${Math.max(0, m.pressure || 0).toFixed(2)} MPa`);
        this._txtTop.text((m.stage || '停炉') + (m.countdown && m.countdown !== '—' ? `  ${m.countdown}` : ''));

        // ── 压力继电器指示灯（4 只）──
        G.relays.forEach((it, i) => {
            const p = m.pressure;
            let on = false;
            if (it.key === 'hlLow') on = p <= cfg.pHighLowLower;
            else if (it.key === 'hlHigh') on = p >= cfg.pHighLow;
            else if (it.key === 'stop') on = p >= cfg.pUpper;
            else on = p >= cfg.pOver;
            const lamp = this._relayLamps[i];
            if (lamp) lamp.fill(on ? (it.key === 'over' ? '#e53935' : '#ffb300') : '#37474f');
        });

        // ── 蒸汽主截止阀：开时阀体绿色 ──
        if (this._svTri1) {
            const on = this._svOpen;
            this._svTri1.fill(on ? '#00e676' : '#e4eeea');
            this._svTri2.fill(on ? '#00e676' : '#e4eeea');
            this._svTri1.stroke(on ? '#1b5e20' : '#0b0b0b');
            this._svTri2.stroke(on ? '#1b5e20' : '#0b0b0b');
            this._svStem.stroke(on ? '#1b5e20' : '#0b0b0b');
            this._svBar.stroke(on ? '#1b5e20' : '#0b0b0b');
        }

        // ── 排污截止阀（手动）：导通时阀体填充绿色 ──
        if (this._bdTri1) {
            const on = this._bdOpen;
            this._bdTri1.fill(on ? '#00e676' : '#e4eeea');
            this._bdTri2.fill(on ? '#00e676' : '#e4eeea');
            this._bdTri1.stroke(on ? '#1b5e20' : '#0b0b0b');
            this._bdTri2.stroke(on ? '#1b5e20' : '#0b0b0b');
            this._bdStem.stroke(on ? '#1b5e20' : '#0b0b0b');
            this._bdBar.stroke(on ? '#1b5e20' : '#0b0b0b');
        }

        // ── 油流 / 水流 ──
        this._updateOilFlow(out, dt);
        {
            const FT = G.feedTank, RZ = G.feedRiserX;
            const pump = out.waterPump1 ? G.wpump1 : (out.waterPump2 ? G.wpump2 : null);
            const running = !!pump;
            if (pump) {
                const ovy = FT.y + FT.h * 0.75;
                this._waterFlow.points([
                    FT.x + FT.w, ovy, G.wpump1.cx + 30, ovy, G.wpump1.cx + 30, 672,
                    pump.cx, 672, pump.cx, pump.cy - pump.r,
                ]);
                this._waterFlow2.points([pump.cx, pump.cy + pump.r, pump.cx, 526, RZ, 526, RZ, G.feed.y, G.feed.endX, G.feed.y]);
            }
            this._waterFlow.opacity(running ? 0.9 : 0);
            this._waterFlow2.opacity(running ? 0.9 : 0);
            if (running) {
                this._waterFlow.dashOffset((this._waterFlow.dashOffset() || 0) - dt * 46);
                this._waterFlow2.dashOffset((this._waterFlow2.dashOffset() || 0) - dt * 46);
            }
        }

        // ── 火焰监视器接线：故障被外部清除时自动恢复接线 ──
        if (this._fsWires && this._fsBroken.some(Boolean)
            && !(typeof s.getFault === 'function' && s.getFault('flameSensor'))) {
            this._fsBroken = [false, false];
            this._syncFlameWires(false);
        }

        this._refreshIfDirty();
    }

    getConfigFields() {
        return [
            { label: '器件名称 (ID)', key: 'id', type: 'text', get: c => c.id },
            { label: '宽度', key: 'width', type: 'number', get: c => c.W },
            { label: '高度', key: 'height', type: 'number', get: c => c.H },
            { label: '仿真时间倍率 (1~20)', key: 'timeScale', type: 'number', get: c => c._timeScale },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.timeScale !== undefined) {
            this._timeScale = Math.max(1, Math.min(20, Number(cfg.timeScale) || 1));
            const s = this._solver();
            if (s) s.cfg.timeScale = this._timeScale;
        }
        this.config = { ...this.config, ...cfg };
        if (this.sys && this.sys.requestRedraw) this.sys.requestRedraw();
    }
}

export default BoilerSystemDiagram;
