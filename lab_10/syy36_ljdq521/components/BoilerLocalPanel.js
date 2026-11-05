import Konva from 'konva';
import { BaseComponent } from './BaseComponent.js';

/**
 * BoilerLocalPanel — 辅锅炉机旁操纵台（第 1 页右半部分）
 * ═══════════════════════════════════════════════════════════════════════════
 *  依据教材 图 6-3-18 的"机旁操纵台"、图 6-3-19 接线图中的操作元件：
 *    · 总电源开关（两档旋钮）
 *    · 燃烧控制旋钮（停止 / 扫风 / 自动 / 点火 / 小火 / 大火，六档不循环）
 *    · 油泵控制旋钮（停止 / 1# 泵 / 2# 泵）
 *    · 给水泵开关（停止 / 1# 自动 / 1# 手动 / 2# 自动 / 2# 手动）
 *    · 按钮：燃烧准备（I0.7）、燃烧停止（I1.0）、消声（I2.0）
 *    · 指示灯：起动就绪、火焰、小火、大火、风机失压、蒸汽超压、
 *              水位过高、水位过低、油温过低、点火失败、故障熄火、音响报警
 *    · 就地仪表与显示：蒸汽压力表、压力 / 水位 / 油温数字显示、运行阶段与倒计时
 *    · 报警窗：首出报警与消声状态
 *
 *  控制逻辑全部在 PLC 程序里；面板只产生开关量并显示 Q 输出。
 * ═══════════════════════════════════════════════════════════════════════════
 */
export class BoilerLocalPanel extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.W = Math.max(500, config.width || 540);
        this.H = Math.max(620, config.height || 700);
        this.type = 'boiler_local_panel';
        this.special = 'boiler_local';
        this.cache = 'fixed';

        this._initGroups();
        this._recalcGeometry();
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
        this._syncVisuals();

        this.config = { id: this.id, width: this.W, height: this.H };
    }

    _solver() { return (this.sys && this.sys.boilerSolver) ? this.sys.boilerSolver : null; }

    _tip(msg) {
        if (this.sys && typeof this.sys.showFloatingTip === 'function') this.sys.showFloatingTip(msg, 2200);
    }

    _recalcGeometry() {
        this._geo = {
            chassis: { x: 0, y: 0, w: this.W, h: this.H, r: 14 },
            // 第一行：总电源 / 油泵控制 / 1# 给水泵 / 2# 给水泵（间距收紧）
            power: { cx: 82, cy: 140, R: 31 },
            oil: { cx: 198, cy: 140, R: 31 },
            pump1: { cx: 314, cy: 140, R: 31 },
            pump2: { cx: 430, cy: 140, R: 31 },
            // 第二行：燃烧控制旋钮（左） + 三个按钮（右）
            burner: { cx: 130, cy: 292, R: 46 },
            btnPrep: { x: 225, y: 259, w: 90, h: 66 },
            btnStop: { x: 323, y: 259, w: 90, h: 66 },
            btnMute: { x: 421, y: 259, w: 90, h: 66 },
            // 状态指示区（4 列）：安保 / 时序 / 运行状态 / 柱状图
            status: { y: 384, rowPitch: 24, lampR: 6 },
            colSafe: { x: 28, w: 124 },
            colSeq: { x: 156, w: 124 },
            colRun: { x: 284, w: 90 },
            colBar: { x: 376, w: 140 },
            bars: { y0: 434, y1: 614, xLevel: 392, xPress: 452, w: 30 },
        };
    }

    _label(g, x, y, text, size = 12, fill = '#263238', bold = false, align = 'left', width = 0) {
        const o = {
            x, y, text, fontSize: size, fill, align,
            fontStyle: bold ? 'bold' : 'normal',
            fontFamily: 'Arial, "Microsoft YaHei", sans-serif',
        };
        if (width) o.width = width;
        g.add(new Konva.Text(o));
    }

    // 旋钮底座（AGENTS 规范：白色外框 + 黑色圆面）
    _drawKnobBase(g, cx, cy, R) {
        g.add(new Konva.Circle({ x: cx, y: cy, radius: R, fill: '#ffffff', stroke: '#9aa0a0', strokeWidth: 1.2 }));
        g.add(new Konva.Circle({ x: cx, y: cy, radius: R - 7, fill: '#141414', stroke: '#000000', strokeWidth: 1 }));
    }

    /** 档位标注：angle 为与竖直方向的夹角（度，负 = 左） */
    _knobMark(g, cx, cy, R, angle, text, size = 12, pad = 8) {
        const a = angle * Math.PI / 180;
        const r = R + pad;
        const x = cx + Math.sin(a) * r;
        const y = cy - Math.cos(a) * r;
        const w = 34;
        g.add(new Konva.Text({
            x: x - w / 2, y: y - 8, width: w, text, fontSize: size, align: 'center',
            fill: '#37474f', fontStyle: 'bold', fontFamily: 'Arial, "Microsoft YaHei", sans-serif',
        }));
    }

    _drawStaticParts() {
        const g = this._staticGroup, G = this._geo, W = this.W, H = this.H;

        // 箱体
        g.add(new Konva.Rect({
            x: 0, y: 0, width: W, height: H, cornerRadius: G.chassis.r,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint: { x: W, y: H },
            fillLinearGradientColorStops: [0, '#6e7374', 0.5, '#4a4f50', 1, '#343839'],
            stroke: '#202323', strokeWidth: 2.5,
        }));
        g.add(new Konva.Rect({ x: 12, y: 12, width: W - 24, height: H - 24, cornerRadius: 8, fill: '#c4c8c8', stroke: '#1f2222', strokeWidth: 2 }));
        g.add(new Konva.Rect({ x: 24, y: 24, width: W - 48, height: H - 48, cornerRadius: 4, fill: '#eef0ee', stroke: '#8d9491', strokeWidth: 1.5 }));

        this._label(g, 40, 34, '辅锅炉机旁操纵台', 16, '#263238', true);
        this._label(g, 40, 58, 'PLC 控制 · 燃烧控制 / 油泵 / 给水泵选择与状态指示', 13, '#546e7a');

        // ── 第一行：总电源（两档）／油泵（三档）／给水泵 1#、2#（各三档）──
        const P = G.power;
        this._drawKnobBase(g, P.cx, P.cy, P.R);
        this._knobMark(g, P.cx, P.cy-5, P.R, -45, '断开', 12);
        this._knobMark(g, P.cx, P.cy-5, P.R, 45, '合上', 12);
        this._label(g, P.cx - 50, P.cy + P.R + 9, '总电源', 13, '#263238', true, 'center', 100);

        const O = G.oil;
        this._drawKnobBase(g, O.cx, O.cy, O.R);
        this._knobMark(g, O.cx-6, O.cy, O.R, -90, '1#泵', 12);
        this._knobMark(g, O.cx, O.cy, O.R, 0, '停止', 12);
        this._knobMark(g, O.cx+6, O.cy, O.R, 90, '2#泵', 12);
        this._label(g, O.cx - 50, O.cy + O.R + 9, '油泵控制', 13, '#263238', true, 'center', 100);

        [[G.pump1, '1# 给水泵'], [G.pump2, '2# 给水泵']].forEach(([WP, name]) => {
            this._drawKnobBase(g, WP.cx, WP.cy, WP.R);
            this._knobMark(g, WP.cx-6, WP.cy, WP.R, -90, '自动', 12);
            this._knobMark(g, WP.cx, WP.cy, WP.R, 0, '停止', 12);
            this._knobMark(g, WP.cx+6, WP.cy, WP.R, 90, '手动', 12);
            this._label(g, WP.cx - 50, WP.cy + WP.R + 9, name, 13, '#263238', true, 'center', 100);
        });

        // ── 第二行：燃烧控制旋钮（六档，顺时针：自动→停止→扫风→点火→小火→大火）──
        const B = G.burner;
        this._drawKnobBase(g, B.cx, B.cy, B.R);
        const burnerMarks = [
            ['自动', -45], ['停止', 0], ['扫风', 45],
            ['点火', 90], ['小火', 135], ['大火', 180],
        ];
        burnerMarks.forEach(([txt, ang]) => this._knobMark(g, B.cx, B.cy, B.R-5, ang, txt, 12, 20));
        this._label(g, B.cx - 120, B.cy + B.R - 12, '燃烧控制', 15, '#263238', true, 'right', 80);

        // ── 按钮 ──
        const mkBtn = (box, text, color, sub) => {
            const cx = box.x + box.w / 2, cy = box.y + 26, R = 24;
            g.add(new Konva.Circle({
                x: cx, y: cy, radius: R,
                fillLinearGradientStartPoint: { x: cx, y: cy - R },
                fillLinearGradientEndPoint: { x: cx, y: cy + R },
                fillLinearGradientColorStops: [0, '#e4e7e7', 0.5, '#b9bebe', 1, '#8f9595'],
                stroke: '#7f8585', strokeWidth: 1.5,
            }));
            g.add(new Konva.Circle({ x: cx, y: cy, radius: R - 5, fill: color, stroke: '#0b0b0b', strokeWidth: 1 }));
            this._label(g, box.x, box.y + 56, text, 13, '#263238', true, 'center', box.w);
            if (sub) this._label(g, box.x, box.y + 72, sub, 12, '#607d8b', false, 'center', box.w);
        };
        mkBtn(G.btnPrep, '燃烧准备', '#2e7d32', 'I0.7');
        mkBtn(G.btnStop, '燃烧停止', '#c62828', 'I1.0');
        mkBtn(G.btnMute, '消  声', '#f9a825', 'I2.0');

        // ── 状态指示区（3 列灯 + 1 列柱状图）──
        this._columns().forEach(cd => {
            const h = 26 + cd.rows.length * G.status.rowPitch + 8;
            g.add(new Konva.Rect({
                x: cd.x, y: G.status.y, width: cd.w, height: h, cornerRadius: 5,
                fill: '#f7f9fa', stroke: '#b0bec5', strokeWidth: 1.2,
            }));
            this._label(g, cd.x + 6, G.status.y + 3, cd.title, 13, cd.titleColor || cd.color, true, 'left', cd.w - 10);
            cd.rows.forEach(([, name], i) => {
                const cy = G.status.y + 26 + i * G.status.rowPitch + G.status.lampR;
                this._label(g, cd.x + 25, cy - 7, name, 12, '#37474f', false, 'left', cd.w - 28);
            });
        });

        // 第 4 列：水位 / 蒸汽压力柱状图
        const BAR = G.bars, CB = G.colBar;
        const boxH = 26 + 4 * G.status.rowPitch + 8;
        g.add(new Konva.Rect({
            x: CB.x, y: G.status.y, width: CB.w, height: boxH + 130, cornerRadius: 5,
            fill: '#f7f9fa', stroke: '#b0bec5', strokeWidth: 1.2,
        }));
        this._label(g, CB.x + 6, G.status.y + 5, '水位 / 汽压', 13, '#1565c0', true, 'left', CB.w - 10);
        [[BAR.xLevel, '水位 %'], [BAR.xPress, '汽压 MPa']].forEach(([bx, txt]) => {
            g.add(new Konva.Rect({ x: bx, y: BAR.y0, width: BAR.w, height: BAR.y1 - BAR.y0, cornerRadius: 2, fill: '#ffffff', stroke: '#90a4ae', strokeWidth: 1.2 }));
            for (let k = 1; k < 4; k++) {
                const yy = BAR.y1 - (BAR.y1 - BAR.y0) * k / 4;
                g.add(new Konva.Line({ points: [bx, yy, bx + BAR.w, yy], stroke: '#cfd8dc', strokeWidth: 1 }));
            }
            this._label(g, bx - 15, BAR.y1 + 4, txt, 12, '#546e7a', false, 'center', BAR.w + 30);
        });
    }

    /** 三列指示灯定义：[键, 名称, 判定函数] */
    _columns() {
        const anyAlarm = (m) => (m.alarms || []).length > 0;
        return [
            {
                key: 'safe', title: '燃烧器安全停炉', color: '#ff1744',
                x: this._geo.colSafe.x, w: this._geo.colSafe.w,
                rows: [
                    ['flameOut', '熄火保护', (m, o) => o.flameOutAlarm, '#ff1744'],
                    ['igniteFail', '点火失败', (m, o) => o.igniteFailAlarm, '#ff1744'],
                    ['levelLow', '水位过低', (m, o) => o.levelLowAlarm, '#ff1744'],
                    ['levelHigh', '水位过高', (m, o) => o.levelHighAlarm, '#ff1744'],
                    ['overPressure', '蒸汽压力过高', (m, o) => o.overPressureAlarm, '#ff1744'],
                    ['fanFail', '雾化空气压力低', (m, o) => o.fanFailAlarm, '#ff1744'],
                    ['oilTemp', '油温过低', (m, o) => o.oilTempAlarm, '#ff1744'],
                ],
            },
            {
                key: 'seq', title: '燃烧器操作程序', color: '#00e676', titleColor: '#1b5e20',
                x: this._geo.colSeq.x, w: this._geo.colSeq.w,
                rows: [
                    ['safeStop', '安全停炉', (m) => anyAlarm(m), '#ff1744'],
                    ['stop', '停止', (m) => m.stage === '停炉', '#ff1744'],
                    ['postPurge', '后扫风', (m) => m.stage === '后扫风', '#00e676'],
                    ['purge', '预扫风', (m) => m.stage === '预扫风', '#00e676'],
                    ['ignPos', '点火位置', (m) => m.stage === '点火位置', '#00e676'],
                    ['ignPrep', '点火准备', (m) => m.stage === '点火准备', '#00e676'],
                    ['ignite', '点火', (m) => m.stage === '点火', '#00e676'],
                    ['stable', '火焰稳定', (m) => m.stage === '小火稳定', '#00e676'],
                    ['load', '负荷控制', (m) => m.stage === '小火运行' || m.stage === '大火运行', '#00e676'],
                ],
            },
            {
                key: 'run', title: '运行状态', color: '#00e676', titleColor: '#1b5e20',
                x: this._geo.colRun.x, w: this._geo.colRun.w,
                rows: [
                    ['ready', '起动就绪', (m, o) => o.ready, '#00e676'],
                    ['lowFire', '小火', (m, o) => o.lowFire, '#00e676'],
                    ['highFire', '大火', (m, o) => o.highFire, '#00e676'],
                    ['alarm', '报警', (m, o) => anyAlarm(m) || o.horn, '#ff1744'],
                ],
            },
        ];
    }

    _createDynamicNodes() {
        const d = this._dynamicGroup, G = this._geo;

        // 旋钮手柄
        const mkHandle = (cx, cy, R) => {
            const h = new Konva.Group({ x: cx, y: cy, rotation: 0 });
            h.add(new Konva.Rect({
                x: -4, y: -(R - 6), width: 8, height: (R - 6) * 2,
                cornerRadius: 4, fill: 'rgba(0,0,0,0)', stroke: '#ffffff', strokeWidth: 2,
            }));
            h.add(new Konva.Rect({ x: -2, y: -(R - 12), width: 4, height: 11, cornerRadius: 1, fill: '#ffffff' }));
            d.add(h);
            return h;
        };
        this._hPower = mkHandle(G.power.cx, G.power.cy, G.power.R);
        this._hBurner = mkHandle(G.burner.cx, G.burner.cy, G.burner.R);
        this._hOil = mkHandle(G.oil.cx, G.oil.cy, G.oil.R);
        this._hPump1 = mkHandle(G.pump1.cx, G.pump1.cy, G.pump1.R);
        this._hPump2 = mkHandle(G.pump2.cx, G.pump2.cy, G.pump2.R);

        // 指示灯（按三列生成）
        this._lamps = {};
        this._columns().forEach(cd => {
            cd.rows.forEach(([key], i) => {
                const cy = G.status.y + 26 + i * G.status.rowPitch + G.status.lampR;
                const c = new Konva.Circle({
                    x: cd.x + 13, y: cy, radius: G.status.lampR,
                    fill: '#2b2f2f', stroke: '#111', strokeWidth: 1,
                });
                d.add(c);
                this._lamps[`${cd.key}.${key}`] = c;
            });
        });

        // 第 4 列：柱状条 + 数值
        const B = G.bars;
        this._barLevel = new Konva.Rect({ x: B.xLevel, y: B.y1, width: B.w, height: 0, fill: '#29b6f6', stroke: '#0277bd', strokeWidth: 1 });
        this._barPress = new Konva.Rect({ x: B.xPress, y: B.y1, width: B.w, height: 0, fill: '#ef5350', stroke: '#b71c1c', strokeWidth: 1 });
        d.add(this._barLevel, this._barPress);
        this._barLevelTxt = new Konva.Text({
            x: B.xLevel - 10, y: B.y0 - 20, width: B.w + 20, text: '56%', fontSize: 11, align: 'center',
            fill: '#0277bd', fontStyle: 'bold', fontFamily: 'Arial, "Microsoft YaHei", sans-serif',
        });
        this._barPressTxt = new Konva.Text({
            x: B.xPress - 12, y: B.y0 - 20, width: B.w + 24, text: '0.55', fontSize: 11, align: 'center',
            fill: '#b71c1c', fontStyle: 'bold', fontFamily: 'Arial, "Microsoft YaHei", sans-serif',
        });
        d.add(this._barLevelTxt, this._barPressTxt);


        // 按钮按压高亮
        this._btnGlow = {};
        [['prep', G.btnPrep], ['stop', G.btnStop], ['mute', G.btnMute]].forEach(([k, b]) => {
            const g2 = new Konva.Circle({ x: b.x + b.w / 2, y: b.y + 26, radius: 26, fill: '#ffffff', opacity: 0, listening: false });
            d.add(g2);
            this._btnGlow[k] = g2;
        });
    }

    _switchDir(node, evt) {
        // 工作流可显式指定方向：node.fire('click', { _dir: -1 })
        if (evt && typeof evt._dir === 'number') return evt._dir > 0 ? 1 : -1;
        // 自动演示 / 工作流的合成点击没有指针位置：直接按顺时针处理，
        // 避免 stage.getPointerPosition() 在无指针时打印 Konva 警告。
        if (!evt || !evt.evt || typeof evt.evt.clientX !== 'number') return 1;
        try {
            const stage = node && node.getStage && node.getStage();
            const ptr = stage && stage.getPointerPosition && stage.getPointerPosition();
            if (!ptr) return 1;
            const local = node.getAbsoluteTransform().copy().invert().point(ptr);
            const w = node.width ? node.width() : 0;
            return local.x >= w / 2 ? 1 : -1;
        } catch (e) {
            return 1;
        }
    }

    _flashBtn(key) {
        const n = this._btnGlow[key];
        if (!n) return;
        n.opacity(0.55);
        n.to({ opacity: 0, duration: 0.45 });
    }

    _bindInteraction() {
        const G = this._geo;

        // 总电源（两档）
        this.addClickablePart('power', G.power.cx - G.power.R, G.power.cy - G.power.R, G.power.R * 2, G.power.R * 2, true)
            .on('click tap', () => {
                const s = this._solver(); if (!s) return;
                const on = s.togglePower();
                this._tip(on ? '总电源：合上' : '总电源：断开');
                this._syncVisuals();
            });

        // 燃烧控制（六档）
        this.addClickablePart('burner-knob', G.burner.cx - G.burner.R, G.burner.cy - G.burner.R, G.burner.R * 2, G.burner.R * 2, true)
            .on('click tap', (e) => {
                const s = this._solver(); if (!s) return;
                s.cycleBurnerKnob(this._switchDir(e && e.target, e)); this._syncVisuals();
            });

        // 油泵控制（三档）
        this.addClickablePart('oil-knob', G.oil.cx - G.oil.R, G.oil.cy - G.oil.R, G.oil.R * 2, G.oil.R * 2, true)
            .on('click tap', (e) => {
                const s = this._solver(); if (!s) return;
                s.cycleOilPump(this._switchDir(e && e.target, e)); this._syncVisuals();
            });

        // 给水泵 1# / 2#（各三档：自动 / 停止 / 手动）
        [[G.pump1, 1], [G.pump2, 2]].forEach(([WP, no]) => {
            this.addClickablePart(`pump${no}-knob`, WP.cx - WP.R, WP.cy - WP.R, WP.R * 2, WP.R * 2, true)
                .on('click tap', (e) => {
                    const s = this._solver(); if (!s) return;
                    s.cyclePump(no, this._switchDir(e && e.target, e)); this._syncVisuals();
                });
        });

        // 三个按钮
        this.addClickablePart('btn-prep', G.btnPrep.x, G.btnPrep.y, G.btnPrep.w, G.btnPrep.h, true)
            .on('click tap', () => {
                const s = this._solver(); if (!s) return;
                s.pressPrep(); this._flashBtn('prep'); this._syncVisuals();
            });
        this.addClickablePart('btn-stop', G.btnStop.x, G.btnStop.y, G.btnStop.w, G.btnStop.h, true)
            .on('click tap', () => {
                const s = this._solver(); if (!s) return;
                s.pressStop(); this._flashBtn('stop'); this._syncVisuals();
            });
        this.addClickablePart('btn-mute', G.btnMute.x, G.btnMute.y, G.btnMute.w, G.btnMute.h, true)
            .on('click tap', () => {
                const s = this._solver(); if (!s) return;
                s.pressMute();
                this._tip('消声：音响报警停止，报警指示灯保持点亮');
                this._flashBtn('mute'); this._syncVisuals();
            });

        // 指示灯区 / 显示区 / 报警窗（供演示箭头定位）
        this.addClickablePart('lamps', 24, G.status.y - 4, 496, 300);
    }

    _syncVisuals() {
        const s = this._solver();
        if (!s) return;
        const m = s.m, out = m.out || {}, now = performance.now ? performance.now() : Date.now();

        // 旋钮角度（与档位标注角度一一对应）
        const burnerAng = { auto: -45, stop: 0, sweep: 45, ignite: 90, low: 135, high: 180 };
        const oilAng = { p1: -90, stop: 0, p2: 90 };
        const pumpAng = { auto: -90, stop: 0, manual: 90 };
        this._hPower.rotation(m.power ? 45 : -45);
        this._hBurner.rotation(burnerAng[m.burnerKnob] !== undefined ? burnerAng[m.burnerKnob] : 0);
        this._hOil.rotation(oilAng[m.oilPumpKnob] !== undefined ? oilAng[m.oilPumpKnob] : 0);
        if (this._hPump1) this._hPump1.rotation(pumpAng[m.pump1Mode] !== undefined ? pumpAng[m.pump1Mode] : 0);
        if (this._hPump2) this._hPump2.rotation(pumpAng[m.pump2Mode] !== undefined ? pumpAng[m.pump2Mode] : 0);

        // 指示灯：三列（安保闪烁红、时序与运行状态常绿/蓝）；总电源断开时全灭
        // 故障/报警灯：未消声时闪烁，按过消声后转为常亮；故障消失即熄灭
        const powered = !!m.power;
        const blink = (Math.floor(now / 320) % 2) === 0;
        const alarms = m.alarms || [];
        const ackMap = {};
        alarms.forEach(a => { ackMap[a.id] = !!a.ack; });
        const ALARM_KEYS = ['levelHigh', 'levelLow', 'oilTemp', 'fanFail', 'overPressure', 'flameOut', 'igniteFail'];
        this._columns().forEach(cd => {
            cd.rows.forEach(([key, , pred, col]) => {
                const n = this._lamps[`${cd.key}.${key}`];
                if (!n) return;
                const color = col || cd.color;
                let on = false;
                try { on = powered && !!pred(m, out); } catch (e) { on = false; }
                const allAcked = alarms.length > 0 && alarms.every(a => a.ack);
                const acked = ALARM_KEYS.includes(key) ? !!ackMap[key]
                    : (key === 'alarm' || key === 'safeStop') ? allAcked : false;
                const lit = on && (color !== '#ff1744' || acked || blink);   // 已消声 → 常亮
                n.fill(lit ? color : '#2b2f2f');
            });
        });

        // 柱状图：水位（0~100%）/ 蒸汽压力（0~1.0 MPa）
        const BR = this._geo.bars;
        const span = BR.y1 - BR.y0;
        const lvPct = powered ? Math.max(0, Math.min(100, m.level || 0)) : 0;
        if (this._barLevel) {
            const h = span * lvPct / 100;
            this._barLevel.y(BR.y1 - h);
            this._barLevel.height(h);
        }
        if (this._barLevelTxt) this._barLevelTxt.text(powered ? `${lvPct.toFixed(0)}%` : '—');
        const pv = powered ? Math.max(0, Math.min(1, m.pressure || 0)) : 0;
        if (this._barPress) {
            const h = span * pv;
            this._barPress.y(BR.y1 - h);
            this._barPress.height(h);
        }
        if (this._barPressTxt) this._barPressTxt.text(powered ? `${(m.pressure || 0).toFixed(2)}` : '—');

        if (this.sys && this.sys.requestRedraw) this.sys.requestRedraw();
    }

    tick() { this._syncVisuals(); this._refreshIfDirty(); }

    /** 读取 PLC 程序里某个定时器的设定值（秒） */
    _timerSec(prog, no) {
        const m = prog.match(new RegExp(`(?:TON|TOF|TONR)\\s+T${no},\\s*(\\d+)`));
        return m ? Number(m[1]) / 10 : 0;
    }

    getConfigFields() {
        const s = this._solver();
        const cfg = (s && s.cfg) || {};
        const plc = this.sys && this.sys.comps && this.sys.comps['plc-1'];
        const prog = (plc && plc._programText) || '';
        return [
            // ── 水位（%）──
            { label: '水位 HH 超高电极 (%)', key: 'levelOverHigh', type: 'number', get: () => cfg.levelOverHigh },
            { label: '水位 H 高水位电极 (%)', key: 'levelHighSet', type: 'number', get: () => cfg.levelHighSet },
            { label: '水位 L 低水位电极 (%)', key: 'levelLowSet', type: 'number', get: () => cfg.levelLowSet },
            { label: '水位 LL 危险低水位 (%)', key: 'levelDangerLow', type: 'number', get: () => cfg.levelDangerLow },
            // ── 压力（MPa）──
            { label: '双位上限（转小火）(MPa)', key: 'pHighLow', type: 'number', get: () => cfg.pHighLow },
            { label: '双位下限（转大火）(MPa)', key: 'pHighLowLower', type: 'number', get: () => cfg.pHighLowLower },
            { label: '自动停炉设定值 (MPa)', key: 'pUpper', type: 'number', get: () => cfg.pUpper },
            { label: '自动恢复（重新起动）(MPa)', key: 'pLower', type: 'number', get: () => cfg.pLower },
            { label: '超压保护设定值 (MPa)', key: 'pOver', type: 'number', get: () => cfg.pOver },
            { label: '安全阀开启压力 (MPa)', key: 'pSafety', type: 'number', get: () => cfg.pSafety },
            // ── 时间（s）──
            { label: '预扫风时间 T101 (s)', key: 'tPurge', type: 'number', get: () => this._timerSec(prog, 101) },
            { label: '后扫风时间 T104 (s)', key: 'tPostPurge', type: 'number', get: () => this._timerSec(prog, 104) },
            { label: '小火稳定时间 T103 (s)', key: 'tLowFire', type: 'number', get: () => this._timerSec(prog, 103) },
        ];
    }

    onConfigUpdate(cfg) {
        const s = this._solver();
        const c = s && s.cfg;
        const num = (k) => {
            if (cfg[k] === undefined || cfg[k] === '') return undefined;
            const v = Number(cfg[k]);
            return Number.isFinite(v) ? v : undefined;
        };
        if (c) {
            const LV = ['levelDangerLow', 'levelLowSet', 'levelHighSet', 'levelOverHigh'];
            LV.forEach(k => { const v = num(k); if (v !== undefined) c[k] = Math.max(0, Math.min(100, v)); });
            const PV = ['pHighLowLower', 'pHighLow', 'pLower', 'pUpper', 'pOver', 'pSafety'];
            PV.forEach(k => { const v = num(k); if (v !== undefined) c[k] = Math.max(0, Math.min(1.2, v)); });
        }
        // 时间参数：改写 PLC 程序里的定时器预设值并重新装载程序
        const plc = this.sys && this.sys.comps && this.sys.comps['plc-1'];
        if (plc && plc._programText) {
            let prog = plc._programText, changed = false;
            [['tPurge', 101], ['tPostPurge', 104], ['tLowFire', 103]].forEach(([k, no]) => {
                const sec = num(k);
                if (sec === undefined) return;
                const ticks = Math.max(10, Math.min(3000, Math.round(sec * 10)));
                const next = prog.replace(new RegExp(`((?:TON|TOF|TONR)\\s+T${no},\\s*)\\d+`), `$1${ticks}`);
                if (next !== prog) { prog = next; changed = true; }
            });
            if (changed) {
                plc._programText = prog;
                if (this.sys.s7200Solver) this.sys.s7200Solver.reloadProgram('plc-1');
            }
        }
        this.config = { ...this.config, ...cfg };
        if (this.sys && this.sys.requestRedraw) this.sys.requestRedraw();
    }
}

export default BoilerLocalPanel;
