import Konva from 'konva';
import { BaseComponent } from './BaseComponent.js';

/**
 * PurifierLocalPanel — 分油机机旁控制箱
 * 主电源转换开关、控制方式转换开关（HAND / EPC）、起动/停止、应急停止、供油泵、加热器、工作水/空气压力、振动、报警。
 */
export class PurifierLocalPanel extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.W = Math.max(420, config.width || 500);
        this.H = Math.max(680, config.height || 812);
        this.type = 'purifier_local_panel';
        this.special = 'purifier_local';
        this.cache = 'fixed';

        this._lampTestUntil = 0;
        this._lampTestHeld = false;
        this._lampReleaseAt = 0;

        this._initGroups();
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
        const W = this.W, H = this.H;
        this._geo = {
            chassis: { x: 0, y: 0, w: W, h: H, r: 12 },
            bezel: { x: 12, y: 12, w: W - 24, h: H - 24, r: 7 },
            ammeter: { cx: 112, cy: 138, r: 62 },
            main: { x: 63, y: 209, w: 74, h: 74 },
            local: { x: 253, y: 209, w: 74, h: 74 },
            emergency: { x: 330, y: 120, r: 34 },
            pumpStart: { x: 30, y: 306, w: 84, h: 56 },
            pumpStop: { x: 122, y: 306, w: 84, h: 56 },
            heatStart: { x: 214, y: 306, w: 84, h: 56 },
            heatStop: { x: 306, y: 306, w: 84, h: 56 },
            motStart: { x: 30, y: 392, w: 84, h: 56 },
            motStop: { x: 122, y: 392, w: 84, h: 56 },
            progStart: { x: 214, y: 392, w: 84, h: 56 },
            progStop: { x: 306, y: 392, w: 84, h: 56 },
            waterGauge: { cx: 112, cy: 570, r: 61 },
            airGauge: { cx: 312, cy: 570, r: 61 },
            alarmLamp: { x: 30, y: 672, w: 84, h: 56 },
            lampTest: { x: 168, y: 672, w: 84, h: 56 },
            reset: { x: 306, y: 672, w: 84, h: 56 },
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

    _drawGauge(g, cx, cy, r, max, labels, unit, color = '#37474f') {
        g.add(new Konva.Circle({ x: cx, y: cy, radius: r, fill: '#f2f4f2', stroke: '#7c8280', strokeWidth: 2 }));
        for (let i = 0; i <= 10; i++) {
            const a = (-135 + (i / 10) * 270) * Math.PI / 180;
            const x1 = cx + Math.sin(a) * (r - 12);
            const y1 = cy - Math.cos(a) * (r - 12);
            const x2 = cx + Math.sin(a) * (r - 6);
            const y2 = cy - Math.cos(a) * (r - 6);
            g.add(new Konva.Line({ points: [x1, y1, x2, y2], stroke: '#37474f', strokeWidth: i % 2 === 0 ? 2 : 1 }));
            if (i % 2 === 0) {
                const lx = cx + Math.sin(a) * (r - 25);
                const ly = cy - Math.cos(a) * (r - 25);
                this._label(g, lx - 18, ly - 10, String(Math.round(max * i / 10)), 13, '#37474f', false, 'center', 36);
            }
        }
        this._label(g, cx - 75, cy - r - 18, labels, 13, '#455a64', true, 'center', 150);
    }

    _drawStaticParts() {
        const g = this._staticGroup, G = this._geo, W = this.W, H = this.H;

        g.add(new Konva.Rect({
            x: 0, y: 0, width: W, height: H, cornerRadius: G.chassis.r,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint: { x: W, y: H },
            fillLinearGradientColorStops: [0, '#6e7374', 0.5, '#4a4f50', 1, '#343839'],
            stroke: '#202323', strokeWidth: 2.5,
        }));
        g.add(new Konva.Rect({
            x: G.bezel.x, y: G.bezel.y, width: G.bezel.w, height: G.bezel.h, cornerRadius: G.bezel.r,
            fill: '#c4c8c8', stroke: '#1f2222', strokeWidth: 2,
        }));
        g.add(new Konva.Rect({
            x: 24, y: 24, width: W - 48, height: H - 48, cornerRadius: 4,
            fill: '#eef0ee', stroke: '#8d9491', strokeWidth: 1.5,
        }));

        this._label(g, 34, 34, '分油机机旁控制箱', 15, '#263238', true);

        // 电流表
        const A = G.ammeter;
        g.add(new Konva.Circle({ x: A.cx, y: A.cy, radius: A.r, fill: '#f8f8f6', stroke: '#546e7a', strokeWidth: 2 }));
        for (let i = 0; i <= 6; i++) {
            const a = (-120 + (i / 6) * 240) * Math.PI / 180;
            const x1 = A.cx + Math.sin(a) * (A.r - 14);
            const y1 = A.cy - Math.cos(a) * (A.r - 14);
            const x2 = A.cx + Math.sin(a) * (A.r - 5);
            const y2 = A.cy - Math.cos(a) * (A.r - 5);
            g.add(new Konva.Line({ points: [x1, y1, x2, y2], stroke: '#37474f', strokeWidth: 1.5 }));
            const lx = A.cx + Math.sin(a) * (A.r - 22);
            const ly = A.cy - Math.cos(a) * (A.r - 22);
            this._label(g, lx - 12, ly - 6, String(i * 5), 13, '#37474f', false, 'center', 24);
        }

        // 指示灯标签
        this._label(g, 216, 90, 'POWER', 13, '#455a64', true);
        this._label(g, 216, 130, 'RUN', 13, '#455a64', true);
        this._label(g, 216, 170, 'TRIP', 13, '#455a64', true);

        // 主电源 / 控制模式 转换旋钮
        const mcx = G.main.x + 37, mcy = G.main.y + 37;
        const lcx = G.local.x + 37, lcy = G.local.y + 37;
        this._drawKnobBase(g, mcx, mcy, 33);
        this._drawKnobBase(g, lcx, lcy, 33);
        // 档位标注
        this._label(g, mcx - 56, mcy - 32, 'OFF', 9, '#37474f', true, 'right', 26);
        this._label(g, mcx + 30, mcy - 32, 'ON', 9, '#37474f', true, 'left', 26);
        this._label(g, lcx - 66, lcy - 6, 'HAND', 9, '#37474f', true, 'right', 28);
        this._label(g, lcx - 16, lcy - 46, 'EPC', 9, '#37474f', true, 'center', 32);
        this._label(g, lcx + 38, lcy - 6, 'AUTO', 9, '#37474f', true, 'left', 34);
        // 静态中文标注
        this._label(g, G.main.x + 34 - 40, G.main.y + 78, '主电源', 13, '#263238', true, 'center', 80);
        this._label(g, G.local.x + 34 - 55, G.local.y + 78, '控制模式', 13, '#263238', true, 'center', 110);

        // 应急停止（移到面板右上方）
        g.add(new Konva.Circle({ x: G.emergency.x, y: G.emergency.y, radius: G.emergency.r, fill: '#c62828', stroke: '#5c0d0d', strokeWidth: 3 }));
        g.add(new Konva.Circle({ x: G.emergency.x, y: G.emergency.y, radius: G.emergency.r - 9, fill: '#e53935', stroke: '#7f1010', strokeWidth: 1 }));
        this._label(g, G.emergency.x - 54, G.emergency.y + G.emergency.r + 7, 'EMER STOP', 15, '#455a64', true, 'center', 108);

        // 第一行：供油泵 / 加热器 起停按钮
        this._btnLampPump = this._drawPushButton(g, G.pumpStart, '供油泵起动', '#1b5e20', true);
        this._drawPushButton(g, G.pumpStop, '供油泵停止', '#b71c1c');
        this._btnLampHeater = this._drawPushButton(g, G.heatStart, '加热器起动', '#1b5e20', true);
        this._drawPushButton(g, G.heatStop, '加热器停止', '#b71c1c');

        // 第二行：分油机电机 起停 + 分离程序 起停（I / O）
        this._btnLampMotor = this._drawPushButton(g, G.motStart, '电机起动', '#1b5e20', true);
        this._drawPushButton(g, G.motStop, '电机停止', '#b71c1c');
        this._drawSquareButton(g, G.progStart, 'I', '分离起动', '#1b5e20');
        this._drawSquareButton(g, G.progStop, 'O', '分离停止', '#b71c1c');

        // 压力表
        this._drawGauge(g, G.waterGauge.cx, G.waterGauge.cy, G.waterGauge.r, 10, 'OPERATING WATER', 'bar');
        this._drawGauge(g, G.airGauge.cx, G.airGauge.cy, G.airGauge.r, 10, 'CONTROL AIR', 'bar');

        // 报警灯（圆形，与圆形按钮同尺寸）+ 试灯 / 报警复位（通用圆形按钮）
        const AL = G.alarmLamp;
        const acx = AL.x + AL.w / 2, acy = AL.y + 26;
        g.add(new Konva.Circle({
            x: acx, y: acy, radius: 26,
            fillLinearGradientStartPoint: { x: acx, y: acy - 26 },
            fillLinearGradientEndPoint: { x: acx, y: acy + 26 },
            fillLinearGradientColorStops: [0, '#e4e7e7', 0.5, '#b9bebe', 1, '#8f9595'],
            stroke: '#7f8585', strokeWidth: 1.5,
        }));
        this._label(g, AL.x, AL.y + 58, '报警灯', 12, '#263238', true, 'center', AL.w);
        this._drawPushButton(g, G.lampTest, '试灯', '#78909c');
        this._drawPushButton(g, G.reset, '报警复位', '#546e7a');
    }

    // 旋钮底座：白色外框 + 黑色填充（白色指示条在动态层）
    _drawKnobBase(g, cx, cy, R) {
        g.add(new Konva.Circle({ x: cx, y: cy, radius: R, fill: '#ffffff', stroke: '#9aa0a0', strokeWidth: 1.2 }));
        g.add(new Konva.Circle({ x: cx, y: cy, radius: R - 7, fill: '#141414', stroke: '#000000', strokeWidth: 1 }));
    }

    // 圆形按钮：金属外圈 + 彩色圆面；lamp=true 时整个圆面即为指示灯（动态着色）
    _drawPushButton(g, b, text, color, lamp) {
        const cx = b.x + b.w / 2, cy = b.y + 26, R = 26;
        g.add(new Konva.Circle({
            x: cx, y: cy, radius: R,
            fillLinearGradientStartPoint: { x: cx, y: cy - R },
            fillLinearGradientEndPoint: { x: cx, y: cy + R },
            fillLinearGradientColorStops: [0, '#e4e7e7', 0.5, '#b9bebe', 1, '#8f9595'],
            stroke: '#7f8585', strokeWidth: 1.5,
        }));
        const face = new Konva.Circle({ x: cx, y: cy, radius: R - 5, fill: color, stroke: '#0b0b0b', strokeWidth: 1 });
        if (lamp) this._dynamicGroup.add(face); else g.add(face);
        this._label(g, b.x, b.y + 58, text, 12, '#263238', true, 'center', b.w);
        return face;
    }

    // 方形 I / O 按钮：金属外框 + 彩色方面，标注在按钮下方
    _drawSquareButton(g, b, letter, cn, color) {
        const S = 42, x = b.x + (b.w - S) / 2, y = b.y + 7;
        g.add(new Konva.Rect({
            x, y, width: S, height: S, cornerRadius: 7,
            fillLinearGradientStartPoint: { x, y },
            fillLinearGradientEndPoint: { x, y: y + S },
            fillLinearGradientColorStops: [0, '#e4e7e7', 0.5, '#b9bebe', 1, '#8f9595'],
            stroke: '#7f8585', strokeWidth: 1.5,
        }));
        g.add(new Konva.Rect({ x: x + 5, y: y + 5, width: S - 10, height: S - 10, cornerRadius: 3, fill: color, stroke: '#0b0b0b', strokeWidth: 1 }));
        this._label(g, x, y + 9, letter, 20, '#ffffff', true, 'center', S);
        this._label(g, b.x, b.y + 58, cn, 12, '#263238', true, 'center', b.w);
    }

    _createDynamicNodes() {
        const d = this._dynamicGroup, G = this._geo;

        // 电流表指针
        this._ampNeedle = new Konva.Group({ x: G.ammeter.cx, y: G.ammeter.cy, rotation: -120 });
        this._ampNeedle.add(new Konva.Line({ points: [0, 8, 0, -G.ammeter.r + 18], stroke: '#c62828', strokeWidth: 2.5, lineCap: 'round' }));
        this._ampNeedle.add(new Konva.Circle({ x: 0, y: 0, radius: 5, fill: '#37474f' }));
        d.add(this._ampNeedle);
        this._ampText = new Konva.Text({
            x: G.ammeter.cx - 46, y: G.ammeter.cy + 36, width: 92, height: 24,
            text: '0.0 A', fontSize: 16, align: 'center', fill: '#263238', fontFamily: 'Consolas, monospace',
        });
        d.add(this._ampText);

        // 指示灯
        this._ledPower = new Konva.Circle({ x: 200, y: 96, radius: 6, fill: '#2b2f2f', stroke: '#111', strokeWidth: 1 });
        this._ledRun = new Konva.Circle({ x: 200, y: 136, radius: 6, fill: '#2b2f2f', stroke: '#111', strokeWidth: 1 });
        this._ledTrip = new Konva.Circle({ x: 200, y: 176, radius: 6, fill: '#2b2f2f', stroke: '#111', strokeWidth: 1 });
        d.add(this._ledPower, this._ledRun, this._ledTrip);

        // 转换开关手柄（白色拨杆，随位置旋转）
        const mkKnob = (b, R) => {
            const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
            const handle = new Konva.Group({ x: cx, y: cy, rotation: -45 });
            // 白色空心指示条（如图：横贯旋钮面的长条轮廓）
            // 白色空心长条（横贯旋钮面）
            handle.add(new Konva.Rect({
                x: -4, y: -(R - 6), width: 8, height: (R - 6) * 2,
                cornerRadius: 4, fill: 'rgba(0,0,0,0)', stroke: '#ffffff', strokeWidth: 2,
            }));
            // 长条一端内的实心小白块，指示当前档位方向
            handle.add(new Konva.Rect({
                x: -2, y: -(R - 12), width: 4, height: 11,
                cornerRadius: 1, fill: '#ffffff',
            }));
            d.add(handle);
            return { cx, cy, R, handle };
        };
        this._mainSw = mkKnob(G.main, 33);
        this._localSw = mkKnob(G.local, 33);

        // 按钮状态灯


        // 压力表指针与数值
        this._waterNeedle = new Konva.Group({ x: G.waterGauge.cx, y: G.waterGauge.cy, rotation: -135 });
        this._waterNeedle.add(new Konva.Line({ points: [0, 6, 0, -G.waterGauge.r + 16], stroke: '#c62828', strokeWidth: 2.5 }));
        d.add(this._waterNeedle);
        this._waterText = new Konva.Text({
            x: G.waterGauge.cx - 50, y: G.waterGauge.cy + 68, width: 100, height: 24,
            text: '0.0 bar', fontSize: 18, align: 'center', fill: '#263238', fontFamily: 'Consolas, monospace',
        });
        d.add(this._waterText);

        this._airNeedle = new Konva.Group({ x: G.airGauge.cx, y: G.airGauge.cy, rotation: -135 });
        this._airNeedle.add(new Konva.Line({ points: [0, 6, 0, -G.airGauge.r + 16], stroke: '#c62828', strokeWidth: 2.5 }));
        d.add(this._airNeedle);
        this._airText = new Konva.Text({
            x: G.airGauge.cx - 50, y: G.airGauge.cy + 68, width: 100, height: 24,
            text: '0.0 bar', fontSize: 18, align: 'center', fill: '#263238', fontFamily: 'Consolas, monospace',
        });
        d.add(this._airText);

        // 报警灯（圆形，与按钮同尺寸；灯面在动态层，随报警闪烁）
        const AL = G.alarmLamp;
        this._alarmLamp = new Konva.Circle({
            x: AL.x + AL.w / 2, y: AL.y + 26, radius: 21,
            fill: '#3a0b0b', stroke: '#0b0b0b', strokeWidth: 1,
        });
        d.add(this._alarmLamp);
        // 报警文字：三个按钮下方整行，12 px
        this._alarmText = new Konva.Text({
            x: 34, y: 752, width: 352, height: 44,
            text: '', fontSize: 12, fill: '#b71c1c',
            fontFamily: 'Arial, "Microsoft YaHei", sans-serif',
        });
        d.add(this._alarmText);

    }

    _bindInteraction() {
        const G = this._geo;
        this.addClickablePart('main-power', G.main.x, G.main.y, G.main.w, G.main.h, true)
            .on('click tap', (e) => {
                const s = this._solver(); if (!s) return;
                // 两档：右半区顺时针 OFF→ON，左半区逆时针 ON→OFF
                s.toggleMainPower();
                this._syncVisuals();
            });
        this.addClickablePart('local-remote', G.local.x, G.local.y, G.local.w, G.local.h, true)
            .on('click tap', (e) => {
                const s = this._solver(); if (!s) return;
                const dir = this._switchDir(e && e.target);
                s.cycleCtrlMode(dir);
                this._syncVisuals();
            });
        const bindBtn = (id, box, fn) => this.addClickablePart(id, box.x, box.y, box.w, box.h, true)
            .on('click tap', () => { const s = this._solver(); if (!s) return; fn(s); this._syncVisuals(); });
        bindBtn('pump-start', G.pumpStart, s => s.localPump(true));
        bindBtn('pump-stop', G.pumpStop, s => s.localPump(false));
        bindBtn('heater-start', G.heatStart, s => s.localHeater(true));
        bindBtn('heater-stop', G.heatStop, s => s.localHeater(false));
        bindBtn('start', G.motStart, s => s.localMotorStart());
        bindBtn('stop', G.motStop, s => s.localMotorStop());
        bindBtn('prog-start', G.progStart, s => s.localProgramStart());
        bindBtn('prog-stop', G.progStop, s => s.localProgramStop());
        this.addClickablePart('emergency', G.emergency.x - G.emergency.r, G.emergency.y - G.emergency.r, G.emergency.r * 2, G.emergency.r * 2, true)
            .on('click tap', () => {
                const s = this._solver(); if (!s) return;
                if (s.m.emergency) { s.resetEmergency(); } else { s.emergencyStop(); }
                this._syncVisuals();
            });
        this.addClickablePart('reset', G.reset.x, G.reset.y, G.reset.w, G.reset.h, true)
            .on('click tap', () => { const s = this._solver(); if (s) s.pressAlarmReset(); this._syncVisuals(); });
        // 试灯：按住不放 → 全部指示灯常亮；松手恢复原状
        const lampNode = this.addClickablePart('lamp-test', G.lampTest.x, G.lampTest.y, G.lampTest.w, G.lampTest.h, true);
        lampNode.on('mousedown touchstart', () => this._setLampTest(true));
        lampNode.on('mouseup touchend', () => {
            this._lampReleaseAt = (performance.now ? performance.now() : Date.now());
            this._setLampTest(false);
        });
        // 程序化（演示/工作流）的单击才短促点亮；真实按压松手后的 click 不闪
        lampNode.on('click tap', () => {
            const t = performance.now ? performance.now() : Date.now();
            if (this._lampTestHeld) return;
            if (t - (this._lampReleaseAt || 0) < 600) return;   // 真实按压松手后的 click：不再闪一下
            this._lampTestUntil = t + 400;                       // 仅程序化单击（演示/演练）短促点亮
            this._syncVisuals();
            if (this.sys && this.sys.requestRedraw) this.sys.requestRedraw();
        });
    }

    /** 试灯按钮按下 / 松开 */
    _setLampTest(on) {
        this._lampTestHeld = !!on;
        if (on) this._lampTestUntil = 0;                  // 按住时只用 held 状态，避免残留延时点亮
        if (on && !this._lampUpBound) {
            this._lampUpBound = true;
            const up = () => {
                this._lampReleaseAt = (performance.now ? performance.now() : Date.now());
                this._setLampTest(false);
            };
            window.addEventListener('mouseup', up, true);
            window.addEventListener('touchend', up, true);
            window.addEventListener('blur', up, true);
        }
        this._syncVisuals();
        if (this.sys && this.sys.requestRedraw) this.sys.requestRedraw();
    }

    // 判断点击落在旋钮左半区(-1)还是右半区(+1)
    _switchDir(node) {
        try {
            const stage = node && node.getStage && node.getStage();
            const ptr = stage && stage.getPointerPosition && stage.getPointerPosition();
            if (!ptr) return 1;
            const local = node.getAbsoluteTransform().copy().invert().point(ptr);
            const w = node.width ? node.width() : 0;
            return local.x >= w / 2 ? 1 : -1;
        } catch (err) {
            return 1;
        }
    }

    _syncVisuals() {
        const s = this._solver();
        const m = s ? s.m : null;
        if (!m) return;
        const G = this._geo;

        this._ampNeedle.rotation(-120 + clamp(m.motor.current / 30, 0, 1) * 240);
        this._ampText.text(`${m.motor.current.toFixed(1)} A`);
        this._ampText.fill(m.motor.current > 18 ? '#c62828' : '#263238');
        this._ampText.fill(m.motor.current > 18 ? '#c62828' : '#263238');

        this._ledPower.fill(m.mainPower ? '#27e05a' : '#2b2f2f');
        this._ledRun.fill(m.motor.on ? '#27e05a' : '#2b2f2f');
        this._ledTrip.fill(m.motor.trip || m.emergency ? '#ff2d2d' : '#2b2f2f');

        // 主电源：左上 OFF / 右上 ON
        this._mainSw.handle.rotation(m.mainPower ? 45 : -45);
        // 控制模式：左 HAND / 上 EPC / 右 AUTO
        const cm = m.ctrlMode || (m.local ? 'HAND' : 'EPC');
        // 档位：左 HAND(-90°) / 上 EPC(0°) / 右 AUTO(+90°)
        this._localSw.handle.rotation(cm === 'HAND' ? -90 : (cm === 'EPC' ? 0 : 90));

        // 带灯按钮：整个按钮面亮起 / 熄灭
        const setLamp = (face, on) => {
            if (!face) return;
            face.fill(on ? '#3ddc6d' : '#1b5e20');
            face.stroke(on ? '#c8ffda' : '#0b0b0b');
        };
        setLamp(this._btnLampPump, !!(m.feed.pumpOn && m.mainPower));
        setLamp(this._btnLampHeater, !!(m.feed.heaterOn && m.mainPower));
        setLamp(this._btnLampMotor, !!m.motor.on);

        this._waterNeedle.rotation(-135 + clamp(m.water.supply / 10, 0, 1) * 270);
        this._waterText.text(`${m.water.supply.toFixed(1)} bar`);
        this._waterText.fill(m.water.supply < 2 ? '#c62828' : '#263238');

        this._airNeedle.rotation(-135 + clamp(m.water.air / 10, 0, 1) * 270);
        this._airText.text(`${m.water.air.toFixed(1)} bar`);
        this._airText.fill(m.water.air < 5 ? '#c62828' : '#263238');

        const now = performance.now ? performance.now() : Date.now();
        const held = !!this._lampTestHeld;                       // 按住试灯：常亮
        const test = held || now < this._lampTestUntil;          // 程序单击：短促点亮
        const flash = Math.floor(now / 350) % 2;
        const lit = held ? true : !!flash;
        this._alarmLamp.fill(m.alarmActive ? (m.alarmAck ? '#ff2d2d' : (flash ? '#ff2d2d' : '#3a0b0b')) : '#3a0b0b');
        if (test) this._alarmLamp.fill(lit ? '#ffb300' : '#3a0b0b');

        // 试灯：机旁控制箱上所有指示灯一起点亮（POWER/RUN/TRIP + 带灯按钮 + 报警灯）
        if (test) {
            const on = lit;
            this._ledPower.fill(on ? '#27e05a' : '#2b2f2f');
            this._ledRun.fill(on ? '#27e05a' : '#2b2f2f');
            this._ledTrip.fill(on ? '#ff2d2d' : '#2b2f2f');
            [this._btnLampPump, this._btnLampHeater, this._btnLampMotor].forEach(f => {
                if (!f) return;
                f.fill(on ? '#3ddc6d' : '#1b5e20');
                f.stroke(on ? '#c8ffda' : '#0b0b0b');
            });
            this._alarmLamp.fill(on ? '#ffb300' : '#3a0b0b');
        }

        const active = m.alarms.find(a => a.active);
        this._alarmText.text(active ? `${active.ack ? '' : '[未确认] '}${active.code} ${active.text}` : '');

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

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export default PurifierLocalPanel;
