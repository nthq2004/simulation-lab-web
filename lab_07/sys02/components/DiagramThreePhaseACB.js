import { BaseComponent } from './BaseComponent.js';

export class DiagramThreePhaseACB extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(120, config.width  || 150);
        this.height = Math.max(90,  config.height || 120);

        this.type    = 'ACB';
        this.special = '3P-ACB';
        this.cache   = 'fixed';

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        this.config = {
            id: this.id,
            label:        this.label,
            ratedVoltage: this.ratedVoltage,
            ratedCurrent: this.ratedCurrent,
            tripCurrent:  this.tripCurrent,
            initState:    this._state,
            animDur:      this._animDur,
            tripCoilR:    this._tripCoilR,
        };

        this.addPort(this._portL[0].x, this._portL[0].y, 'l1', 'wire');
        this.addPort(this._portL[1].x, this._portL[1].y, 'l2', 'wire');
        this.addPort(this._portL[2].x, this._portL[2].y, 'l3', 'wire');
        this.addPort(this._portT[0].x, this._portT[0].y, 't1', 'wire', 'p');
        this.addPort(this._portT[1].x, this._portT[1].y, 't2', 'wire', 'p');
        this.addPort(this._portT[2].x, this._portT[2].y, 't3', 'wire', 'p');
        // this.addPort(this._portFla.x, this._portFla.y, 'fla', 'wire');
        // this.addPort(this._portFlb.x, this._portFlb.y, 'flb', 'wire');
    }

    _recalcGeometry() {
        const W = this.width, H = this.height;

        this._frame = { x: 2, y: 2, w: W - 4, h: H - 4, rx: 4 };

        const rPad = 3;
        const coilW = 20;
        const availW = W - rPad - coilW;

        this._poleXs = Array.from({ length: 3 }, (_, i) =>
            rPad + availW * (i + 0.45) / 3
        );

        this._lineInY  = H * 0.18;
        this._lineOutY = H * 0.82;
        // 上下静触点间距缩至原 2/3（对称分布于组件中心）
        this._bladeLen = H * 0.44 * 2 / 3;
        this._contactInY = (H - this._bladeLen) / 2;
        this._contactOutY = (H + this._bladeLen) / 2;
        this._contactR = Math.max(3, W * 0.018);

        this._bladeLen = this._contactOutY - this._contactInY;

        this._bladeAngles = {
            on:   0,
            off:  -45,
            trip: -22.5,
        };

        this._xSize = Math.max(5, W * 0.035);

        this._portL = this._poleXs.map(px => ({ x: px, y: 2 }));
        this._portT = this._poleXs.map(px => ({ x: px, y: H - 2 }));
        this._portFla = { x: W - 2, y: H * 0.32 };
        this._portFlb = { x: W - 2, y: H * 0.68 };

        this._labelPos = { x: 0, y: -16, w: W };
    }

    _initParameters(config) {
        this.ratedVoltage = config.ratedVoltage !== undefined ? config.ratedVoltage : 380;
        this.ratedCurrent = config.ratedCurrent !== undefined ? config.ratedCurrent : 100;
        this.tripCurrent  = config.tripCurrent  !== undefined ? config.tripCurrent  : 10;
        this.label        = config.label        || 'QF';
        this.function     = config.function     || '三相空气断路器';

        const initState = (config.initState || 'off').toLowerCase();
        this._state       = ['on', 'off', 'trip'].includes(initState) ? initState : 'off';
        this._prevState   = this._state;

        this._animating   = false;
        this._animT       = 0;
        this._animFromAng = this._bladeAngles[this._state];
        this._animToAng   = this._bladeAngles[this._state];
        this._curBladeAng = this._bladeAngles[this._state];

        this._animDur       = config.animDur !== undefined ? config.animDur : 0.10;
        this._animJustEnded = false;

        this._iBuf = [new Array(40).fill(0), new Array(40).fill(0), new Array(40).fill(0)];
        this._iBufSum = [0, 0, 0];
        this._iBufIdx = 0;
        this._iBufCount = 0;
        this._iRms = [0, 0, 0];

        this.opsCount = config.initOps || 0;
        this._tripCoilR = config.tripCoilR !== undefined ? config.tripCoilR : 50;
    }

    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
    }

    _drawStaticParts() {
        this._drawFrame();
        this._drawSchematicStatic();
        this._drawTripCoil();
    }

    _drawFrame() {
        const f = this._frame;
        this._staticGroup.add(new Konva.Rect({
            x: f.x, y: f.y, width: f.w, height: f.h,
            fill: '#f5f6f8',
            stroke: '#9098a8',
            strokeWidth: 1.2,
            cornerRadius: f.rx,
        }));
    }

    _drawSchematicStatic() {
        this._poleXs.forEach((px, i) => {
            const poleName = ['L1', 'L2', 'L3'][i];
            const outName  = ['T1', 'T2', 'T3'][i];
            const color    = ['#e03030', '#20a030', '#2050e0'][i];
            const txOff    = this._contactR + 3;

            this._staticGroup.add(new Konva.Line({
                points: [px, 2, px, this._contactInY],
                stroke: color, strokeWidth: 2,
            }));
            this._staticGroup.add(new Konva.Line({
                points: [px, this._contactOutY, px, this.height - 2],
                stroke: color, strokeWidth: 2,
            }));

            this._staticGroup.add(new Konva.Circle({
                x: px, y: this._contactOutY,
                radius: this._contactR,
                fill: '#e8c86a', stroke: color, strokeWidth: 1.5,
            }));

            this._drawXSymbolOnContact(px, this._contactInY, color);

            this._staticGroup.add(new Konva.Text({
                x: px + txOff, y: this._contactInY - 7,
                text: poleName, fontSize: 12, fontStyle: 'bold', fill: color,
            }));
            this._staticGroup.add(new Konva.Text({
                x: px + txOff, y: this._contactOutY - 7,
                text: outName, fontSize: 12, fontStyle: 'bold', fill: color,
            }));
        });
    }

    _drawXSymbolOnContact(px, y, color) {
        const hs = this._xSize * 0.5;
        this._staticGroup.add(new Konva.Line({
            points: [px - hs, y - hs, px + hs, y + hs],
            stroke: color, strokeWidth: 2.4,
            listening: false,
        }));
        this._staticGroup.add(new Konva.Line({
            points: [px - hs, y + hs, px + hs, y - hs],
            stroke: color, strokeWidth: 2.4,
            listening: false,
        }));
    }

    _drawTripCoil() {
        // const W = this.width, H = this.height;
        // const coilCX = this._portFla.x - 16;
        // const coilTop = this._portFla.y + 5;
        // const coilBot = this._portFlb.y - 5;
        // const coilH = coilBot - coilTop;
        // const halfW = Math.max(4, W * 0.035);
        // const loops = 5;

        // const pts = [];
        // const steps = loops * 16;
        // for (let i = 0; i <= steps; i++) {
        //     const t = i / steps;
        //     const y = coilTop + t * coilH;
        //     const x = coilCX + halfW * Math.cos(t * loops * Math.PI * 2);
        //     pts.push(x, y);
        // }
        // this._staticGroup.add(new Konva.Line({
        //     points: pts,
        //     stroke: '#4a3828', strokeWidth: 1.2,
        //     tension: 0.3, listening: false,
        // }));

        // this._staticGroup.add(new Konva.Line({
        //     points: [coilCX + halfW, coilTop, this._portFla.x, this._portFla.y],
        //     stroke: '#6a5a28', strokeWidth: 1.5, listening: false,
        // }));
        // this._staticGroup.add(new Konva.Line({
        //     points: [coilCX + halfW, coilBot, this._portFlb.x, this._portFlb.y],
        //     stroke: '#6a5a28', strokeWidth: 1.5, listening: false,
        // }));
    }

    _createDynamicNodes() {
        this._createBladeGroups();
    }

    _createBladeGroups() {
        this._bladeGroups = this._poleXs.map((px, i) => {
            const color = ['#e03030', '#20a030', '#2050e0'][i];
            const g = new Konva.Group({
                x: px,
                y: this._contactOutY,
                rotation: this._curBladeAng,
            });

            g.add(new Konva.Line({
                points: [0, 0, 0, -this._bladeLen],
                stroke: color, strokeWidth: Math.max(2.5, this.width * 0.016),
                lineCap: 'round',
                listening: false,
            }));

            g.add(new Konva.Circle({
                x: 0, y: 0,
                radius: this._contactR * 1.4,
                fill: '#e8c86a',
                stroke: color, strokeWidth: 1.5,
                listening: false,
            }));

            this._dynamicGroup.add(g);
            return g;
        });

        this._contactGlows = this._poleXs.map((px, i) => {
            const glows = [];
            [this._contactInY, this._contactOutY].forEach(cy => {
                const g = new Konva.Circle({
                    x: px, y: cy,
                    radius: this._contactR * 2.2,
                    fill: 'rgba(80,220,80,0.30)',
                    visible: this._state === 'on',
                    listening: false,
                });
                this._dynamicGroup.add(g);
                glows.push(g);
            });
            return glows;
        });
    }

    _updateDynamic() {
        this._bladeGroups.forEach(g => g.rotation(this._curBladeAng));

        const closed = !this._animating && this._state === 'on';
        this._contactGlows.forEach(glows => {
            glows.forEach(g => g.visible(closed));
        });
    }

    _bindInteraction() {
        const hitArea = new Konva.Rect({
            x: this._frame.x,
            y: this._frame.y,
            width: this._frame.w,
            height: this._frame.h,
            fill: 'transparent',
        });

        hitArea.on('click tap', (e) => {
            if (this._animating) return;
            if (e.evt?.button !== 0) return;
            const stage = this.group.getStage();
            if (!stage) return;
            const pointer = stage.getPointerPosition();
            if (!pointer) return;

            const tr = this.group.getTransform().copy();
            tr.invert();
            const local = tr.point(pointer);

            const dy = local.y - this.height / 2;
            if (this._state === 'off') {
                this.close();
            } else if (this._state === 'on') {
                this.open();
            } else if (this._state === 'trip') {
                this._resetToOff();
            }
        });

        hitArea.on('mouseenter', () => { document.body.style.cursor = 'pointer'; });
        hitArea.on('mouseleave', () => { document.body.style.cursor = 'default'; });

        this._interactGroup.add(hitArea);
    }

    tick(dt) {
        this._tickAnimation(dt);
        this._updateRMS();
        this._checkOvercurrentTrip();

        if (this._animating || this._animJustEnded) {
            this._animJustEnded = false;
            this._updateDynamic();
            this.markDirty();
        }
        this._refreshIfDirty();
    }

    _tickAnimation(dt) {
        if (!this._animating) return;

        this._animT += dt / this._animDur;
        if (this._animT >= 1) {
            this._animT         = 1;
            this._animating     = false;
            this._animJustEnded = true;
            this._curBladeAng   = this._animToAng;
        }

        const ease = 0.5 - 0.5 * Math.cos(this._animT * Math.PI);
        this._curBladeAng = this._animFromAng + (this._animToAng - this._animFromAng) * ease;
    }

    _updateRMS() {
        const pc = this.phaseCurrents;
        if (!pc) return;
        const inst = [pc.l1 || 0, pc.l2 || 0, pc.l3 || 0];
        for (let i = 0; i < 3; i++) {
            const i2 = inst[i] * inst[i];
            const old = this._iBuf[i][this._iBufIdx];
            this._iBuf[i][this._iBufIdx] = i2;
            this._iBufSum[i] = this._iBufSum[i] - old + i2;
        }
        this._iBufIdx = (this._iBufIdx + 1) % 40;
        if (this._iBufCount < 40) this._iBufCount++;
        if (this._iBufCount >= 40) {
            for (let i = 0; i < 3; i++) {
                this._iRms[i] = Math.sqrt(this._iBufSum[i] / 40);
            }
        }
    }

    _checkOvercurrentTrip() {
        if (this._state !== 'on') return;
        if (this._iBufCount < 40) return;
        const threshold = this.tripCurrent * this.ratedCurrent;
        for (let i = 0; i < 3; i++) {
            if (this._iRms[i] > threshold) {
                this.trip();
                return;
            }
        }
    }

    _startAnim(toState) {
        this._animFromAng  = this._curBladeAng;
        this._animToAng    = this._bladeAngles[toState];
        this._animT        = 0;
        this._animating    = true;
        this._state        = toState;
        this.opsCount++;
    }

    _resetToOff() {
        this._animDur = 0.15;
        this._startAnim('off');
    }

    close() {
        if (this._animating || this._state !== 'off') return;
        this._animDur = this.config.animDur || 0.10;
        this._startAnim('on');
    }

    open() {
        if (this._animating || this._state !== 'on') return;
        this._animDur = this.config.animDur || 0.10;
        this._startAnim('off');
    }

    trip() {
        if (this._state === 'trip') return;
        this._animDur = 0.06;
        this._startAnim('trip');
    }

    getState()     { return this._state; }
    isClosed()     { return this._state === 'on'; }
    isTripped()    { return this._state === 'trip'; }
    isAnimating()  { return this._animating; }
    getOpsCount()  { return this.opsCount; }

    update(state) {
        const s = String(state).toLowerCase();
        if (s === 'on'   || s === '1') this.close();
        if (s === 'off'  || s === '0') this.open();
        if (s === 'trip')              this.trip();
    }

    getConfigFields() {
        return [
            { label: '位号/名称',          key: 'label',        type: 'text'   },
            { label: '额定电压 (V)',        key: 'ratedVoltage', type: 'number' },
            { label: '额定电流 (A)',        key: 'ratedCurrent', type: 'number' },
            { label: '脱扣倍数 (×In)',      key: 'tripCurrent',  type: 'number' },
            { label: '初始状态 on/off/trip',key: 'initState',    type: 'text'   },
            { label: '动作时间 (s)',         key: 'animDur',      type: 'number' },
            { label: '分励线圈电阻 (Ω)',     key: 'tripCoilR',    type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label        !== undefined) this.label        = cfg.label;
        if (cfg.ratedVoltage !== undefined) this.ratedVoltage = parseFloat(cfg.ratedVoltage);
        if (cfg.ratedCurrent !== undefined) this.ratedCurrent = parseFloat(cfg.ratedCurrent);
        if (cfg.tripCurrent  !== undefined) this.tripCurrent  = parseFloat(cfg.tripCurrent);
        if (cfg.animDur      !== undefined) this._animDur     = parseFloat(cfg.animDur);
        if (cfg.tripCoilR    !== undefined) this._tripCoilR   = parseFloat(cfg.tripCoilR);

        if (cfg.initState !== undefined) {
            const want = cfg.initState.toLowerCase();
            if (['on', 'off', 'trip'].includes(want) && want !== this._state) {
                this.update(want);
            }
        }

        this.config = { ...this.config, ...cfg };
        this._recalcGeometry();
        this._staticGroup.destroyChildren();
        this._dynamicGroup.destroyChildren();
        this._drawStaticParts();
        this._createDynamicNodes();
        this._refreshCache();
    }

    destroy() {
        super.destroy?.();
    }
}
