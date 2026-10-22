import { BaseComponent } from './BaseComponent.js';

export class SteeringStatusPanel extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.W = Math.max(600, config.width || 747);
        this.H = Math.max(460, config.height || 573);
        this.type = 'steering_status_panel';
        this.special = 'steering_panel';
        this.cache = 'fixed';

        this._initGroups();
        this._recalcGeometry();
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
        this._syncVisuals();

        this.config = { id: this.id, width: this.W, height: this.H };
    }

    _recalcGeometry() {
        const W = this.W, H = this.H;
        this._geo = {
            chassis: { x: 0, y: 0, w: W, h: H, r: 18 },
            bezel: { x: 18, y: 12, w: W - 36, h: 438, r: 9 },
            screen: { x: 32, y: 24, w: W - 64, h: 414 },
            header: {
                headingLabel: { x: 255, y: 36 },
                headingBox: { x: 330, y: 30, w: 100, h: 30 },
                headingText: { x: 330, y: 34, w: 100 },
                rudderLabel: { x: 452, y: 36 },
                scale: { x: 480, w: 192, y: 64 },
                pLabel: { x: 460, y: 76 },
                sLabel: { x: 686, y: 76 },
            },
            panels: {
                ship: { x: 35, y: 100, w: 250, h: 214 },
                me: { x: 460, y: 100, w: 250, h: 214 },
                prop: { x: 460, y: 322, w: 250, h: 112 },
            },
            rows: {
                shipY: 132, meY: 132, propY: 358, step: 30, valueH: 18,
                shipLabelX: 40, shipValueX: 168, shipUnitX: 242,
                meLabelX: 478, meValueX: 606, meUnitX: 682,
                propLabelX: 478, propValueX: 606, propUnitX: 682,
                shipValueW: 70, valueW: 72,
            },
            hull: { cx: 370, cy: 200 },
            speed: {
                labelX: 264, labelY: 340,
                boxX: 342, boxY: 332, boxW: 64, boxH: 26,
                textX: 342, textY: 335,
                knotsX: 411, knotsY: 343,
            },
            bottom: {
                x: 18, y: 458, w: W - 36, h: 102, r: 6,
                logoX: 48, logoY: 474, logoW: 64, logoH: 68,
                offX: 590, onX: 680, labelY: 466,
                powerCx: 650, powerCy: 505, powerR: 30, powerInnerR: 22,
                lampX: 598, lampY: 520,
                part: { x: 610, y: 470, w: 80, h: 76 },
            },
            screenDim: { x: 20, y: 18, w: W - 40, h: 426 },
        };
    }

    _label(g, x, y, text, size = 12, fill = '#263238', bold = false, align = 'left', width = 0) {
        const opts = {
            x, y, text, fontSize: size,
            fontStyle: bold ? 'bold' : 'normal',
            fill, align, fontFamily: 'Arial, sans-serif',
        };
        if (width) opts.width = width;
        g.add(new Konva.Text(opts));
    }

    _line(g, points, color = '#455a64', width = 1) {
        g.add(new Konva.Line({ points, stroke: color, strokeWidth: width, lineCap: 'round' }));
    }

    _valueBox(g, x, y, w, h = 18) {
        g.add(new Konva.Rect({
            x, y, width: w, height: h, fill: '#f4f5f4',
            stroke: '#8a8d8a', strokeWidth: 1, cornerRadius: 1,
        }));
    }

    _drawPanel(g, x, y, w, h, title) {
        g.add(new Konva.Rect({
            x, y, width: w, height: h, fill: 'rgba(235,236,235,0.55)',
            stroke: '#ffffff', strokeWidth: 2.2,
        }));
        this._label(g, x + 8, y + 5, title, 15, '#111111', true);
    }

    _drawStaticParts() {
        const g = this._staticGroup, G = this._geo;

        g.add(new Konva.Rect({
            x: G.chassis.x, y: G.chassis.y, width: G.chassis.w, height: G.chassis.h, cornerRadius: G.chassis.r,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint: { x: G.chassis.w, y: G.chassis.h },
            fillLinearGradientColorStops: [0, '#686b6b', 0.45, '#4b4e4f', 1, '#3c3f40'],
            stroke: '#262829', strokeWidth: 2.5,
        }));

        g.add(new Konva.Rect({
            x: G.bezel.x, y: G.bezel.y, width: G.bezel.w, height: G.bezel.h, cornerRadius: G.bezel.r,
            fill: '#b9bcbc', stroke: '#202222', strokeWidth: 2.5,
        }));
        g.add(new Konva.Rect({
            x: G.screen.x, y: G.screen.y, width: G.screen.w, height: G.screen.h, cornerRadius: 2,
            fill: '#c9cbca', stroke: '#8d908f', strokeWidth: 1.6,
        }));

        this._label(g, G.header.headingLabel.x, G.header.headingLabel.y, 'Heading:', 14, '#111', true);
        this._label(g, G.header.rudderLabel.x, G.header.rudderLabel.y, 'Rudder:', 14, '#111', true);

        this._valueBox(g, G.header.headingBox.x, G.header.headingBox.y, G.header.headingBox.w, G.header.headingBox.h);
        const sc = G.header.scale;
        g.add(new Konva.Line({ points: [sc.x, sc.y, sc.x + sc.w, sc.y], stroke: '#2f3336', strokeWidth: 2 }));
        for (let v = -40; v <= 40; v += 5) {
            const x = sc.x + (v + 40) / 80 * sc.w;
            const major = v % 10 === 0;
            g.add(new Konva.Line({
                points: [x, sc.y, x, sc.y + (major ? 10 : 6)],
                stroke: '#313638', strokeWidth: major ? 1.4 : 1,
            }));
            if (major) this._label(g, x - 10, sc.y + 13, String(Math.abs(v)), 10, '#333', false, 'center', 20);
        }
        this._label(g, G.header.pLabel.x, G.header.pLabel.y, 'P', 10, '#b71c1c', true);
        this._label(g, G.header.sLabel.x, G.header.sLabel.y, 'S', 10, '#1b5e20', true);

        this._drawPanel(g, G.panels.ship.x, G.panels.ship.y, G.panels.ship.w, G.panels.ship.h, 'SHIP CONDITIONS');
        this._drawPanel(g, G.panels.me.x, G.panels.me.y, G.panels.me.w, G.panels.me.h, 'M/E CONDITIONS');
        this._drawPanel(g, G.panels.prop.x, G.panels.prop.y, G.panels.prop.w, G.panels.prop.h, 'PROPELLER CONDITIONS');

        const R = G.rows;
        const shipRows = [
            ['Dead Weight', '%'], ['Ship Fouling', '%'], ['Wind Force', 'm/sec'],
            ['Wind Direction', 'deg'], ['Ambient Air Temp', '°C'], ['Sea Water Temp', '°C'],
        ];
        shipRows.forEach((r, i) => {
            const y = R.shipY + i * R.step;
            this._label(g, R.shipLabelX, y + 2, r[0], 12, '#1a1a1a');
            this._valueBox(g, R.shipValueX, y, R.shipValueW, R.valueH);
            this._label(g, R.shipUnitX, y + 3, r[1], 11, '#1a1a1a');
        });

        const meRows = [
            ['M/E Speed', 'rpm'], ['M/E Fuel Index', '%'], ['M/E Load', '%'],
            ['M/E Power', 'kW'], ['M/E Shaft Torque', 'kN·m'], ['M/E Fuel', 'g/kW·h'],
        ];
        meRows.forEach((r, i) => {
            const y = R.meY + i * R.step;
            this._label(g, R.meLabelX, y + 2, r[0], 12, '#1a1a1a');
            this._valueBox(g, R.meValueX, y, R.valueW, R.valueH);
            this._label(g, R.meUnitX, y + 3, r[1], 10, '#1a1a1a');
        });

        const propRows = [
            ['Propeller', 'kN'], ['Ship Hull Drag', 'kN'], ['Propeller Drag Torque', 'kN·m'],
        ];
        propRows.forEach((r, i) => {
            const y = R.propY + i * R.step;
            this._label(g, R.propLabelX, y + 2, r[0], 12, '#1a1a1a');
            this._valueBox(g, R.propValueX, y, R.valueW, R.valueH);
            this._label(g, R.propUnitX, y + 3, r[1], 10, '#1a1a1a');
        });

        const hull = new Konva.Group({ x: G.hull.cx, y: G.hull.cy });
        hull.add(new Konva.Line({
            points: [0, -104, 56, -48, 66, 36, 62, 96, 40, 112, -40, 112, -62, 96, -66, 36, -56, -48],
            closed: true, stroke: '#8a8d8c', strokeWidth: 1.8, fill: 'rgba(190,192,191,0.28)',
            lineJoin: 'round',
        }));
        hull.add(new Konva.Line({ points: [-64, 0, 64, 0], stroke: '#9b9e9d', strokeWidth: 1, dash: [5, 4] }));
        hull.add(new Konva.Line({ points: [-66, 56, 66, 56], stroke: '#9b9e9d', strokeWidth: 1, dash: [5, 4] }));
        g.add(hull);

        const S = G.speed;
        this._label(g, S.labelX, S.labelY, 'Ship Speed:', 13, '#1a1a1a');
        this._valueBox(g, S.boxX, S.boxY, S.boxW, S.boxH);
        this._label(g, S.knotsX, S.knotsY, 'Knots', 12, '#1a1a1a');

        const B = G.bottom;
        g.add(new Konva.Rect({
            x: B.x, y: B.y, width: B.w, height: B.h, cornerRadius: B.r,
            fill: '#303233', stroke: '#171818', strokeWidth: 2.5,
        }));
        g.add(new Konva.Rect({
            x: B.logoX, y: B.logoY, width: B.logoW, height: B.logoH,
            fill: '#b71c1c', stroke: '#7f0f0f', strokeWidth: 1.5,
        }));
        this._label(g, B.logoX + 5, B.logoY + 8, 'K', 18, '#ffd54f', true, 'center', B.logoW - 10);
        this._label(g, B.logoX + 5, B.logoY + 30, 'KONGSBERG', 7, '#ffd54f', true, 'center', B.logoW - 10);
        this._label(g, B.offX, B.labelY, '关', 13, '#eceff1', false, 'center', 30);
        this._label(g, B.onX, B.labelY, '开', 13, '#eceff1', false, 'center', 30);
        g.add(new Konva.Circle({ x: B.powerCx, y: B.powerCy, radius: B.powerR, fill: '#111213', stroke: '#8b8f90', strokeWidth: 2.5 }));
        g.add(new Konva.Circle({ x: B.powerCx, y: B.powerCy, radius: B.powerInnerR, fill: '#242729', stroke: '#555', strokeWidth: 1.2 }));
    }

    _createDynamicNodes() {
        const d = this._dynamicGroup, G = this._geo, R = G.rows;

        this._headingText = new Konva.Text({
            x: G.header.headingText.x, y: G.header.headingText.y, width: G.header.headingText.w,
            text: '117.2 °', fontSize: 25,
            fontStyle: 'bold', fill: '#111', align: 'center', fontFamily: 'Consolas, monospace',
        });
        d.add(this._headingText);

        this._rudderPointer = new Konva.Line({
            points: [0, -4, 0, 15], stroke: '#c62828', strokeWidth: 2.6, lineCap: 'round',
        });
        this._rudderPointer.position({ x: G.header.scale.x + G.header.scale.w / 2, y: G.header.scale.y - 2 });
        d.add(this._rudderPointer);

        this._shipValues = [];
        const addRow = (x, y, w) => {
            const t = new Konva.Text({
                x, y, width: w, text: '--', fontSize: 12, fill: '#111',
                align: 'right', fontFamily: 'Consolas, monospace',
            });
            d.add(t);
            return t;
        };
        for (let i = 0; i < 6; i++) this._shipValues.push(addRow(R.shipValueX, R.shipY + 2 + i * R.step, R.shipValueW - 2));
        this._meValues = [];
        for (let i = 0; i < 6; i++) this._meValues.push(addRow(R.meValueX, R.meY + 2 + i * R.step, R.valueW - 2));
        this._propValues = [];
        for (let i = 0; i < 3; i++) this._propValues.push(addRow(R.propValueX, R.propY + 2 + i * R.step, R.valueW - 2));

        this._speedText = new Konva.Text({
            x: G.speed.textX, y: G.speed.textY, width: G.speed.boxW,
            text: '16.1', fontSize: 20, fontStyle: 'bold',
            fill: '#111', align: 'center', fontFamily: 'Consolas, monospace',
        });
        d.add(this._speedText);

        this._powerKnob = new Konva.Group({ x: G.bottom.powerCx, y: G.bottom.powerCy });
        this._powerKnob.add(new Konva.Rect({
            x: -5, y: -22, width: 10, height: 20, fill: '#e8e8e8', cornerRadius: 2,
        }));
        d.add(this._powerKnob);

        this._powerLamp = new Konva.Circle({
            x: G.bottom.lampX, y: G.bottom.lampY, radius: 4,
            fill: '#3b0d0d', stroke: '#111', strokeWidth: 1,
        });
        d.add(this._powerLamp);

        this._screenDim = new Konva.Rect({
            x: G.screenDim.x, y: G.screenDim.y, width: G.screenDim.w, height: G.screenDim.h,
            fill: '#000000', cornerRadius: 3, listening: false,
        });
        d.add(this._screenDim);
    }

    _bindInteraction() {
        const p = this._geo.bottom.part;
        this.addClickablePart('power', p.x, p.y, p.w, p.h, true).on('click tap', () => {
            const s = this._solver();
            if (s) s.toggleDisplayPower();
            this._syncVisuals();
        });
    }

    _solver() {
        return this.sys && this.sys.steerSolver ? this.sys.steerSolver : null;
    }

    _syncVisuals() {
        const s = this._solver();
        const m = s ? s.m : null;
        const on = !!(m && m.displayPower);

        this._screenDim.visible(!on);
        this._powerLamp.fill(on ? '#25e04a' : '#3b0d0d');
        this._powerKnob.rotation(on ? 42 : -42);

        if (!m) return;

        this._headingText.text(m.heading.toFixed(1) + ' °');
        const sc = this._geo.header.scale;
        const px = sc.x + (Math.max(-40, Math.min(40, m.displayRudder)) + 40) / 80 * sc.w;
        this._rudderPointer.position({ x: px, y: sc.y - 2 });

        const ship = [
            '100.0', '0.0', m.windForce.toFixed(1), m.windDir.toFixed(1),
            m.ambient.toFixed(1), m.seaWater.toFixed(1),
        ];
        this._shipValues.forEach((t, i) => t.text(ship[i]));

        const me = [
            m.engine.rpm.toFixed(1), m.engine.fuelIndex.toFixed(1), m.engine.load.toFixed(1),
            m.engine.power.toFixed(1), m.engine.torque.toFixed(1), m.engine.fuelRate.toFixed(1),
        ];
        this._meValues.forEach((t, i) => t.text(me[i]));

        const prop = [
            m.propeller.thrust.toFixed(1), m.propeller.hullDrag.toFixed(1), m.propeller.torque.toFixed(1),
        ];
        this._propValues.forEach((t, i) => t.text(prop[i]));

        this._speedText.text(m.speed.toFixed(1));

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

export default SteeringStatusPanel;
