import { BaseComponent } from './BaseComponent.js';

export class SinglePhaseFuse extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(30, config.width  || 40);
        this.height = Math.max(80, config.height || 120);

        this.type    = '1p-fuse';
        this.special = 'fuse';
        this.cache   = 'fixed';

        this._poleCount = 1;

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        this.config = {
            label:        this.label,
            ratedVoltage: this.ratedVoltage,
            ratedCurrent: this.ratedCurrent,
            fuseType:     this.fuseType,
            initState:    this._states[0],
        };

        this.addPort(this._portL.x, this._portL.y, 'l', 'wire', 'p');
        this.addPort(this._portT.x, this._portT.y, 't', 'wire');
    }

    _recalcGeometry() {
        const W = this.width, H = this.height;

        this._cx    = W * 0.50;
        this._inY   = H * 0.18;
        this._outY  = H * 0.82;
        this._boxCY = (this._inY + this._outY) / 2;
        this._boxW  = Math.max(12, W * 0.64);
        this._boxH  = H * 0.48;
        this._boxTop  = this._boxCY - this._boxH / 2;
        this._boxBot  = this._boxCY + this._boxH / 2;
        this._termR   = Math.max(3, W * 0.036);

        this._portL = { x: this._cx, y: 2 };
        this._portT = { x: this._cx, y: H - 2 };
    }

    _initParameters(config) {
        this.ratedVoltage = config.ratedVoltage !== undefined ? config.ratedVoltage : 220;
        this.ratedCurrent = config.ratedCurrent !== undefined ? config.ratedCurrent : 16;
        this.label        = config.label    || 'FU';
        this.fuseType     = config.fuseType || 'RT18-16';

        const s = (config.initState || 'ok').toLowerCase();
        this._states = [s === 'blown' ? 'blown' : 'ok'];

        this._blowAnim   = [0];
        this._blowFrames = 8;
        this._arcFrames  = [0];
        this.opsCount    = config.initOps || 0;
    }

    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
    }

    _drawStaticParts() {
        this._drawSchematicStatic();
    }

    _drawSchematicStatic() {
        const px = this._cx;
        const poleColor = '#c06820';
        const fs = Math.max(10, this.width * 0.036);

        // 引线：端口 → 接线柱 → IEC 方框
        this._staticGroup.add(new Konva.Line({
            points: [px, 2, px, this._boxTop],
            stroke: poleColor, strokeWidth: 2,
        }));
        this._staticGroup.add(new Konva.Line({
            points: [px, this._boxBot, px, this.height - 2],
            stroke: poleColor, strokeWidth: 2,
        }));

        this._drawTerminalPost({ x: px, y: this._inY }, poleColor);

        this._drawTerminalPost({ x: px, y: this._outY }, poleColor);

        this._staticGroup.add(new Konva.Rect({
            x: px - this._boxW / 2, y: this._boxTop,
            width: this._boxW, height: this._boxH,
            fill: 'rgba(245,240,225,0.85)',
            stroke: poleColor, strokeWidth: 1.5, cornerRadius: 2,
        }));
    }

    _drawTerminalPost(pos, color) {
        const R = this._termR, { x, y } = pos;
        this._staticGroup.add(new Konva.Circle({
            x, y, radius: R,
            fillLinearGradientStartPoint: { x: -R, y: -R },
            fillLinearGradientEndPoint:   { x:  R, y:  R },
            fillLinearGradientColorStops: [0, '#7a6a30', 0.4, '#d4aa52', 0.7, '#e8c86a', 1, '#8a7030'],
            stroke: '#6a5a28', strokeWidth: 1,
        }));
        this._staticGroup.add(new Konva.Circle({
            x, y, radius: R * 0.38, fill: '#2a1a08', stroke: '#5a4a20', strokeWidth: 0.6,
        }));
    }

    _createDynamicNodes() {
        this._createSchematicFuseWires();
        this._arcGroup = new Konva.Group({ listening: false });
        this._dynamicGroup.add(this._arcGroup);
    }

    _createSchematicFuseWires() {
        const px   = this._cx;
        const state = this._states[0];
        const poleColor = '#c06820';
        const boxTop  = this._boxTop, boxBot = this._boxBot;
        const boxMidY = (boxTop + boxBot) / 2;
        const bW = this._boxW;

        const wireGroup = new Konva.Group({ visible: state === 'ok', listening: false });
        wireGroup.add(new Konva.Line({
            points: [px, boxTop + 3, px, boxMidY - bW * 0.45],
            stroke: poleColor, strokeWidth: 2, lineCap: 'round',
        }));
        const wavePts = [];
        for (let s = 0; s <= 6; s++) {
            const t = s / 6;
            wavePts.push(
                px + Math.sin(t * Math.PI * 2) * bW * 0.20,
                (boxMidY - bW * 0.45) + t * bW * 0.90
            );
        }
        wireGroup.add(new Konva.Line({
            points: wavePts, stroke: poleColor, strokeWidth: 2,
            lineCap: 'round', lineJoin: 'round', tension: 0.3,
        }));
        wireGroup.add(new Konva.Line({
            points: [px, boxMidY + bW * 0.45, px, boxBot - 3],
            stroke: poleColor, strokeWidth: 2, lineCap: 'round',
        }));
        this._dynamicGroup.add(wireGroup);
        this._schFuseWire = wireGroup;

        const breakGroup = new Konva.Group({ visible: state === 'blown', listening: false });
        breakGroup.add(new Konva.Line({
            points: [px, boxTop + 3, px, boxMidY - bW * 0.60],
            stroke: '#808088', strokeWidth: 2, lineCap: 'round',
        }));
        breakGroup.add(new Konva.Line({
            points: [px, boxMidY + bW * 0.60, px, boxBot - 3],
            stroke: '#808088', strokeWidth: 2, lineCap: 'round',
        }));
        const xS = bW * 0.28;
        [[-xS, -xS, xS, xS], [xS, -xS, -xS, xS]].forEach(pts => {
            breakGroup.add(new Konva.Line({
                points: [px + pts[0], boxMidY + pts[1], px + pts[2], boxMidY + pts[3]],
                stroke: '#ff4030', strokeWidth: 2, lineCap: 'round',
            }));
        });
        breakGroup.add(new Konva.Circle({
            x: px, y: boxMidY, radius: bW * 0.18,
            fill: 'rgba(255,80,20,0.30)',
        }));
        this._dynamicGroup.add(breakGroup);
        this._schFuseBreak = breakGroup;
    }

    _updateDynamic() {
        const blown = this._states[0] === 'blown';
        this._schFuseWire.visible(!blown);
        this._schFuseBreak.visible(blown);

        this._arcGroup.destroyChildren();
        this._arcFrames.forEach((f, i) => {
            if (f > 0) this._drawBlowArc(this._arcGroup, i);
        });
    }

    _drawBlowArc(group, poleIdx) {
        const px = this._cx;
        const midY = (this._boxTop + this._boxBot) / 2;
        group.add(new Konva.Circle({
            x: px, y: midY,
            radius: this._boxW * 0.35 * (0.6 + Math.random() * 0.5),
            fill: `rgba(255,200,80,${0.3 + Math.random() * 0.3})`, listening: false,
        }));
    }

    _bindInteraction() {
        const hitArea = new Konva.Rect({
            x: this._cx - this._boxW / 2 - 4, y: this._boxTop - 4,
            width: this._boxW + 8, height: this._boxH + 8,
            fill: 'transparent',
        });
        hitArea.on('click tap', () => {
            this._states[0] === 'ok' ? this.blow(0) : this.replace(0);
        });
        hitArea.on('mouseenter', () => { document.body.style.cursor = 'pointer'; });
        hitArea.on('mouseleave', () => { document.body.style.cursor = 'default'; });
        this._interactGroup.add(hitArea);
    }

    tick(dt) {
        let dirty = false;
        this._blowAnim.forEach((f, i) => { if (f > 0) { this._blowAnim[i]--; dirty = true; } });
        this._arcFrames.forEach((f, i) => { if (f > 0) { this._arcFrames[i]--; dirty = true; } });
        if (dirty) { this._updateDynamic(); this.markDirty(); }
        this._refreshIfDirty();
    }

    blow(pole = 0) {
        pole = Math.max(0, Math.min(this._poleCount - 1, parseInt(pole)));
        if (this._states[pole] === 'blown') return;
        this._states[pole]    = 'blown';
        this._blowAnim[pole]  = this._blowFrames;
        this._arcFrames[pole] = 5;
        this.opsCount++;
        this._updateDynamic();
        this.markDirty();
    }

    replace(pole = 0) {
        pole = Math.max(0, Math.min(this._poleCount - 1, parseInt(pole)));
        if (this._states[pole] === 'ok') return;
        this._states[pole] = 'ok';
        this._blowAnim[pole]  = 0;
        this._arcFrames[pole] = 0;
        this.opsCount++;
        this._updateDynamic();
        this.markDirty();
    }

    getState()    { return this._states[0]; }
    isBlown()     { return this._states[0] === 'blown'; }
    getOpsCount() { return this.opsCount; }

    update(state) {
        const v = String(state).toLowerCase();
        if (v === 'blown' || v === '0') this.blow(0);
        else this.replace(0);
    }

    getConfigFields() {
        return [
            { label: '位号/名称',    key: 'label',        type: 'text'   },
            { label: '额定电压 (V)', key: 'ratedVoltage', type: 'number' },
            { label: '额定电流 (A)', key: 'ratedCurrent', type: 'number' },
            { label: '熔断器型号',   key: 'fuseType',     type: 'text'   },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label        !== undefined) this.label        = cfg.label;
        if (cfg.ratedVoltage !== undefined) this.ratedVoltage = parseFloat(cfg.ratedVoltage);
        if (cfg.ratedCurrent !== undefined) this.ratedCurrent = parseFloat(cfg.ratedCurrent);
        if (cfg.fuseType     !== undefined) this.fuseType     = cfg.fuseType;
        this.config = { ...this.config, ...cfg };
        this._recalcGeometry();
        this._staticGroup.destroyChildren();
        this._dynamicGroup.destroyChildren();
        this._drawStaticParts();
        this._createDynamicNodes();
        this._refreshCache();
    }

    destroy() { super.destroy?.(); }
}
