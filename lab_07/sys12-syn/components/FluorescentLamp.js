import { BaseComponent } from './BaseComponent.js';

export class FluorescentLamp extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width = 473;
        this.height = 79;

        this.type = 'fluorescent_lamp';
        this.cache = 'fixed';

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        this.config = {
            id: this.id,
            filamentR: this.filamentR,
            gapOnR: this.gapOnR,
        };
        const s = this.scale || 1;
        this.addPort(-this._W / 2 - 10 * s, -16 * s, 'left_a', 'wire');
        this.addPort(-this._W / 2 - 10 * s, 16 * s, 'left_b', 'wire');
        this.addPort(this._W / 2 + 10 * s, -16 * s, 'right_a', 'wire');
        this.addPort(this._W / 2 + 10 * s, 16 * s, 'right_b', 'wire');
    }

    _recalcGeometry() {
        const s = this.scale || 1;
        this._W = this.width * s;
        this._H = this.height * s;
        this._tubeW = this._W - 15 * s;
        this._tubeH = 28 * s;
        this._endCapW = 18 * s;
    }

    _initParameters(config) {
        this.filamentR = config.filamentR || 200;
        this.gapOnR = config.gapOnR || 220;
        this._state = 'idle';
        this._strikeV = 420;
        this._vAcrossGap = 0;
        this._filamentGlow = 0;
        this._tubeGlow = 0;
        this._startupTimer = 0;
        this._flickerPhase = 0;
        this._gapPeakV = 0;
        this._peakFilamentV = 0;
        this._offTimer = 0;
        this._faultAged = false;
    }

    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
    }

    _drawStaticParts() {
        const s = this.scale || 1;
        const W = this._W;
        const H = this._H;
        const tw = this._tubeW;
        const th = this._tubeH;
        const ecw = this._endCapW;

        // 透明点击区域（拖拽支持）
        this._interactGroup.add(new Konva.Rect({
            x: -W / 2, y: -H / 2, width: W, height: H, fill: 'transparent',
        }));

        const bg = new Konva.Rect({
            x: -W / 2, y: -H / 2, width: W, height: H,
            fill: '#f0f0f0', listening: false,
        });
        this._staticGroup.add(bg);

        const tube = new Konva.Rect({
            x: -tw / 2, y: -th / 2, width: tw, height: th,
            fill: '#f5f0e8', stroke: '#bbb', strokeWidth: 1.2,
            cornerRadius: 4, listening: false,
        });
        this._staticGroup.add(tube);

        const capL = new Konva.Rect({
            x: -tw / 2 - ecw, y: -th / 2 - 2,
            width: ecw, height: th + 4,
            fill: '#95a5a6', stroke: '#7f8c8d', strokeWidth: 1,
            cornerRadius: 3, listening: false,
        });
        const capR = new Konva.Rect({
            x: tw / 2, y: -th / 2 - 2,
            width: ecw, height: th + 4,
            fill: '#95a5a6', stroke: '#7f8c8d', strokeWidth: 1,
            cornerRadius: 3, listening: false,
        });
        this._staticGroup.add(capL, capR);

        for (const side of [-1, 1]) {
            const cx = side * (tw / 2 + ecw / 2);
            const pin1 = new Konva.Circle({ x: cx, y: -th / 4 - 2, radius: 3 * s, fill: '#bdc3c7', stroke: '#7f8c8d', strokeWidth: 1, listening: false });
            const pin2 = new Konva.Circle({ x: cx, y: th / 4 + 2, radius: 3 * s, fill: '#bdc3c7', stroke: '#7f8c8d', strokeWidth: 1, listening: false });
            this._staticGroup.add(pin1, pin2);
        }

        const drawVerticalFilament = (cx, cy) => {
            const pts = [];
            for (let i = 0; i < 9; i++) {
                const offsetY = -16 * s + i * 4 * s;
                pts.push(cx + (i % 2 === 0 ? -2 * s : 2 * s), cy + offsetY);
            }
            const line = new Konva.Line({ points: pts, stroke: '#888', strokeWidth: 1.5 * s, tension: 0.3, listening: false });
            this._staticGroup.add(line);
        };
        drawVerticalFilament(-W / 2 + 11 * s, 0);
        drawVerticalFilament(W / 2 - 11 * s, 0);
    }

    _createDynamicNodes() {
        const s = this.scale || 1;
        this._leftFilamentGlow = new Konva.Circle({
            x: -this._W / 2 + 11 * s, y: 0, radius: 0, fill: '#ff4400', opacity: 0, listening: false,
        });
        this._dynamicGroup.add(this._leftFilamentGlow);
        this._rightFilamentGlow = new Konva.Circle({
            x: this._W / 2 - 11 * s, y: 0, radius: 0, fill: '#ff4400', opacity: 0, listening: false,
        });
        this._dynamicGroup.add(this._rightFilamentGlow);

        this._tubeGlowNode = new Konva.Rect({
            x: -this._tubeW / 2, y: -this._tubeH / 2, width: this._tubeW, height: this._tubeH,
            fill: '#000000', opacity: 0, cornerRadius: 4, listening: false,
        });
        this._dynamicGroup.add(this._tubeGlowNode);

        this._stateLabel = new Konva.Text({
            x: -36, y: 20, width: 80,
            text: '', fontSize: 15, fill: '#2c3e50', fontFamily: 'Arial', fontStyle: 'bold',
            align: 'center', listening: false,
        });
        this._dynamicGroup.add(this._stateLabel);
    }

    setState(newState) {
        if (this._state === newState) return;
        this._state = newState;
        this.markDirty();
    }

    tick(dt) {
        const gapV = this.sys.getVoltageBetween(
            `${this.id}_wire_left_b`, `${this.id}_wire_right_b`
        ) || 0;
        this._vAcrossGap = gapV;
        const absV = Math.abs(gapV);
        this._gapPeakV = Math.max(absV, this._gapPeakV * 0.92);
        const effectiveGapV = this._gapPeakV / Math.SQRT2;

        if (this._faultAged) {
            this._state = 'idle';
            this._tubeGlow = 0;
        }

        if (this._state === 'idle' || this._state === 'preheat') {
            if (effectiveGapV >= this._strikeV && !this._faultAged) {
                this._state = 'on';
                this._startupTimer = 0;
            }
        }

        if (this._state === 'on') {
            if (effectiveGapV < 10) {
                this._offTimer += dt;
                if (this._offTimer > 0.3) { this._state = 'idle'; this._offTimer = 0; }
            } else {
                this._offTimer = 0;
            }
            this._startupTimer += dt;
            this._flickerPhase += dt * 30;
            const flicker = this._startupTimer < 0.3
                ? 0.3 + 0.7 * Math.abs(Math.sin(this._flickerPhase))
                : 1.0;
            this._tubeGlow += (flicker - this._tubeGlow) * 0.1;
            this._filamentGlow *= 0.9;
        } else {
            this._tubeGlow *= 0.95;
            const filamentV = Math.abs(this.sys.getVoltageBetween(
                `${this.id}_wire_left_a`, `${this.id}_wire_left_b`
            ) || 0);
            const peakFilament = Math.max(filamentV, this._peakFilamentV * 0.9) || filamentV;
            this._peakFilamentV = peakFilament;
            const targetFilament = peakFilament > 5 ? Math.min(1, peakFilament / 50) : 0;
            this._filamentGlow += (targetFilament - this._filamentGlow) * 0.1;
        }

        this._updateVisuals();
        this.markDirty();
        this._refreshIfDirty();
    }

    _updateVisuals() {
        if (this._tubeGlow > 0.1) {
            const t = Math.min(1, this._tubeGlow);
            const r = Math.min(255, 40 + Math.round(215 * t));
            const g = Math.min(255, 100 + Math.round(155 * t));
            const b = 255;
            this._tubeGlowNode.fill(`rgb(${r},${g},${b})`);
            this._tubeGlowNode.opacity(0.35 + 0.55 * t);
            this._leftFilamentGlow.opacity(0);
            this._rightFilamentGlow.opacity(0);
            this._stateLabel.text('已点亮');
            this._stateLabel.fill('#27ae60');
        } else if (this._filamentGlow > 0.1) {
            const t = Math.min(1, this._filamentGlow);
            const r = 255;
            const g = Math.round(60 * (1 - t));
            const s = this.scale || 1;
            const color = `rgb(${r},${g},0)`;
            const radius = 12 * s;
            const opacity = 0.4 + 0.5 * t;
            this._leftFilamentGlow.fill(color);
            this._leftFilamentGlow.radius(radius);
            this._leftFilamentGlow.opacity(opacity);
            this._rightFilamentGlow.fill(color);
            this._rightFilamentGlow.radius(radius);
            this._rightFilamentGlow.opacity(opacity);
            this._tubeGlowNode.opacity(0);
            this._stateLabel.text('预热中');
            this._stateLabel.fill('#e67e22');
        } else {
            this._leftFilamentGlow.opacity(0);
            this._rightFilamentGlow.opacity(0);
            this._tubeGlowNode.opacity(0);
            this._stateLabel.text('待机');
            this._stateLabel.fill('#7f8c8d');
        }
    }

    getConfigFields() {
        return [
            { label: '器件名称', key: 'id', type: 'text' },
            { label: '灯丝电阻 (\u03a9)', key: 'filamentR', type: 'number' },
            { label: '导通电阻 (\u03a9)', key: 'gapOnR', type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.id !== undefined) this.id = cfg.id;
        if (cfg.filamentR !== undefined) this.filamentR = cfg.filamentR;
        if (cfg.gapOnR !== undefined) this.gapOnR = cfg.gapOnR;
        this.config = { ...this.config, ...cfg };
        this.markDirty();
        this._refreshIfDirty();
    }

    destroy() {
        super.destroy?.();
    }
}