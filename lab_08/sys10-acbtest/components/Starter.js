import { BaseComponent } from './BaseComponent.js';

export class Starter extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        this.width = 60;
        this.height = 100;
        this.type = 'starter';
        this.cache = 'fixed';
        this.scale = config.scale || 1.5;
        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();
        this.config = { id: this.id, glowOnTime: this._glowOnTime, closedTime: this._closedTime, strikeVoltage: this._strikeVoltage };
        this.addPort(-20, 80, 'l', 'wire');
        this.addPort(20, 80, 'r', 'wire');
    }
    _recalcGeometry() {
        const s = this.scale || 1;
        this._W = this.width * s;
        this._H = this.height * s;
    }
    _initParameters(config) {
        this._state = 'idle';
        this._timer = 0;
        this._glowIntensity = 0;
        this._contactPos = 0;
        this._contactClosed = false;
        this._cycleCount = 0;
        this._closedSinceStrike = false;
        this._prevState = 'idle';
        this._glowOnTime = config.glowOnTime ?? 5;
        this._closedTime = config.closedTime ?? 20;
        this._strikeVoltage = config.strikeVoltage ?? 150;
        this._peakV = 0;
        this._zeroTimer = 0;
        this._faultContactStuck = false;
        this._faultOpen = false;
    }
    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
    }
    _drawStaticParts() {
        const s = this.scale || 1;
        const W = this._W;
        const H = this._H;

        // 透明点击区域（拖拽支持）
        this._interactGroup.add(new Konva.Rect({
            x: -W / 2, y: -H / 2, width: W, height: H, fill: 'transparent',
        }));

        const shell = new Konva.Rect({
            x: -W / 2, y: -H / 2, width: W, height: H,
            fill: '#d5dbdb', stroke: '#95a5a6', strokeWidth: 1.5,
            cornerRadius: [8, 8, 3, 3], listening: false,
        });
        this._staticGroup.add(shell);
        const capLine = new Konva.Line({
            points: [-W / 2, -H / 2 + 14 * s, W / 2, -H / 2 + 14 * s],
            stroke: '#95a5a6', strokeWidth: 0.8, listening: false,
        });
        this._staticGroup.add(capLine);
        // 电气端口到电极上端的连接线（红色）
        const connL = new Konva.Line({
            points: [-20, 80, -10 * s, -22 * s],
            stroke: '#e74c3c', strokeWidth: 1.2, lineCap: 'round', listening: false,
        });
        const connR = new Konva.Line({
            points: [20, 80, 10 * s, -22 * s],
            stroke: '#e74c3c', strokeWidth: 1.2, lineCap: 'round', listening: false,
        });

        const neonBg = new Konva.Circle({
            x: 0, y: -6 * s, radius: 20 * s,
            fill: '#fdf2e9', stroke: '#ccc', strokeWidth: 1, listening: false,
        });
        this._staticGroup.add(neonBg);
        this._staticGroup.add(connL, connR);
        const electrodeL = new Konva.Line({
            points: [-10 * s, -22 * s, -5 * s, 0],
            stroke: '#666', strokeWidth: 3, lineCap: 'round', listening: false,
        });
        const electrodeR = new Konva.Line({
            points: [10 * s, -22 * s, 5 * s, 0],
            stroke: '#666', strokeWidth: 3, lineCap: 'round', listening: false,
        });
        this._staticGroup.add(electrodeL, electrodeR);

        // 氖泡上方的小电容器（纯视觉，不参与电路）— 极板水平并排放置，绿色连线接至电极顶端
        const capY = -30 * s;
        const pw = 3.5 * s, ph = 16 * s;
        const cpL = new Konva.Rect({ x: -8 * s, y: capY - ph , width: pw, height: ph, fill: '#c0392b', listening: false });
        const cpR = new Konva.Rect({ x: 4.5 * s, y: capY - ph , width: pw, height: ph, fill: '#c0392b', listening: false });
        const wireL = new Konva.Line({ points: [-12 * s + pw / 2, capY + ph / 2, -30 * s, -36 * s], stroke: '#27ae60', strokeWidth: 1.2, lineCap: 'round', listening: false });
        const wireR = new Konva.Line({ points: [8 * s + pw / 2, capY + ph / 2, 30 * s, -36 * s], stroke: '#27ae60', strokeWidth: 1.2, lineCap: 'round', listening: false });
        this._staticGroup.add(cpL, cpR, wireL, wireR);

    }
    _createDynamicNodes() {
        this._neonGlow = new Konva.Circle({
            x: 0, y: -6 * (this.scale || 1),
            radius: 18 * (this.scale || 1),
            fill: '#000000', opacity: 0, listening: false,
        });
        this._dynamicGroup.add(this._neonGlow);
        this._contactLine = new Konva.Line({
            points: [0, 0, 0, 0],
            stroke: '#c0392b', strokeWidth: 1.5, lineCap: 'round', listening: false,
        });
        this._dynamicGroup.add(this._contactLine);
        this._stateLabel = new Konva.Text({
            x: -24, y: 28, width: 48,
            text: '', fontSize: 15, fill: '#2c3e50', fontFamily: 'Arial',fontstyle:'bold',
            align: 'center', listening: false,
        });
        this._dynamicGroup.add(this._stateLabel);
    }
    tick(dt) {
        this._prevState = this._state;

        if (this._faultContactStuck) {
            this._state = 'closed';
            this._contactClosed = true;
            this._glowIntensity *= 0.9;
            this._contactPos = 1;
            this._updateVisuals();
            this.markDirty();
            this._refreshIfDirty();
            return;
        }
        if (this._faultOpen) {
            this._state = 'idle';
            this._contactClosed = false;
            this._glowIntensity *= 0.95;
            this._contactPos *= 0.9;
            this._updateVisuals();
            this.markDirty();
            this._refreshIfDirty();
            return;
        }

        const rawV = this.sys.getVoltageBetween(this.id + '_wire_l', this.id + '_wire_r') || 0;
        const absV = Math.abs(rawV);
        // 峰值保持（快起慢衰），用于交流有效值判断
        this._peakV = Math.max(absV, this._peakV * 0.92);
        let effectiveV = this._peakV / Math.SQRT2;

        // 连续低电压计时（检测真实掉电而非零交叉）
        if (effectiveV < 5) {
            this._zeroTimer += dt;
        } else {
            this._zeroTimer = 0;
        }
        const powerLost = this._zeroTimer > 0.5;

        switch (this._state) {
            case 'idle':
                if (effectiveV > this._strikeVoltage) { this._state = 'glowing'; this._timer = 0; }
                break;
            case 'glowing':
                this._timer += dt;
                if (this._timer >= this._glowOnTime) { this._state = 'closed'; this._timer = 0; }
                if (powerLost ) { this._state = 'idle'; this._timer = 0; }
                break;
            case 'closed':
                this._timer += dt;
                if (this._timer >= this._closedTime) { 
                    this._peakV = 0;
                    effectiveV =0;
                    this._state = 'cooling';
                    this._closedSinceStrike = true; 
                    this._timer = 0; }
                break;
            case 'cooling':
                this._timer += dt;
               
                if (this._timer >= 0.05) {
                    this._state = 'idle';
                    this._timer = 0;
                }
                break;
        }

        if (powerLost) this._closedSinceStrike = false;
        if (this._state === 'glowing') {
            this._glowIntensity += (0.7 + 0.3 * Math.sin(this._timer * 8) - this._glowIntensity) * 0.1;
            this._contactPos *= 0.95; this._contactClosed = false;
        } else if (this._state === 'closed') {
            this._glowIntensity *= 0.9;
            this._contactPos += (1 - this._contactPos) * 0.15; this._contactClosed = true;
        } else {
            this._glowIntensity *= 0.95; this._contactPos *= 0.9; this._contactClosed = false;
        }
        this._updateVisuals();
        this.markDirty();
        this._refreshIfDirty();
    }
    _updateVisuals() {
        const s = this.scale || 1;
        if (this._glowIntensity > 0.01) {
            const t = Math.min(1, this._glowIntensity);
            const r = Math.min(255, 200 + Math.round(55 * t));
            const g = Math.min(255, 40 + Math.round(30 * t));
            this._neonGlow.fill('rgb(' + r + ',' + g + ',30)');
            this._neonGlow.opacity(0.3 + 0.5 * t);
        } else {
            this._neonGlow.opacity(0);
        }
        const contactY = 6 * s * (1 - this._contactPos);
        const contactLen = 8 * s;
        this._contactLine.points([-contactLen / 2, contactY + 2 * s, contactLen / 2, contactY]);
        this._contactLine.stroke(this._contactClosed ? '#27ae60' : '#c0392b');
        this._contactLine.strokeWidth(this._contactClosed ? 2 : 1.5);
        switch (this._state) {
            case 'idle': this._stateLabel.text('待机'); this._stateLabel.fill('#7f8c8d'); break;
            case 'glowing': this._stateLabel.text('辉光'); this._stateLabel.fill('#e67e22'); break;
            case 'closed': this._stateLabel.text('接通'); this._stateLabel.fill('#27ae60'); break;
            case 'cooling': this._stateLabel.text('断开'); this._stateLabel.fill('#c0392b'); break;
        }
    }
    getResistance() {
        if (this._faultContactStuck) return 0.01;
        if (this._faultOpen) return 10e6;
        return this._state === 'closed' ? 0.01 : 10e6;
    }
    getConfigFields() {
        return [
            { label: '器件名称', key: 'id', type: 'text' },
            { label: '辉光时间 (s)', key: 'glowOnTime', type: 'number', step: 0.1 },
            { label: '接通时间 (s)', key: 'closedTime', type: 'number', step: 0.1 },
            { label: '启辉电压 (V)', key: 'strikeVoltage', type: 'number', step: 1 },
        ];
    }
    onConfigUpdate(cfg) {
        if (cfg.id !== undefined) this.id = cfg.id;
        if (cfg.glowOnTime !== undefined) this._glowOnTime = cfg.glowOnTime;
        if (cfg.closedTime !== undefined) this._closedTime = cfg.closedTime;
        if (cfg.strikeVoltage !== undefined) this._strikeVoltage = cfg.strikeVoltage;
        this.config = { ...this.config, ...cfg };
        this.markDirty();
        this._refreshIfDirty();
    }
    destroy() { super.destroy?.(); }
}