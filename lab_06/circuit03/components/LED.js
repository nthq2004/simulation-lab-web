import { BaseComponent } from './BaseComponent.js';

export class LED extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        this.direction = config.direction;
        this.type = 'led';
        this._initGroups();

        this.vForward = config.vForward || 2.0;
        this.rOn = 0.5;
        this.rOff = 1e8;

        this.config = {id:this.id, vForward:this.vForward};

        this.initVisuals();
        this.initPorts();

        if (this.direction === 'reverse') this.group.rotate(180);
    }

    initPorts() {
        this.addPort(-40, 0, 'l', 'wire', 'p');
        this.addPort(40, 0, 'r', 'wire');
    }

    initVisuals() {
        const stroke = '#000000';
        this._staticGroup.add(new Konva.Line({ points: [-40, 0, -15, 0], stroke, strokeWidth: 2 }));
        this._staticGroup.add(new Konva.Line({ points: [15, 0, 40, 0], stroke, strokeWidth: 2 }));

        this._triangle = new Konva.Line({
            points: [-15, -15, -15, 15, 15, 0],
            closed: true,
            fill: '#ffffff',
            stroke: stroke,
            strokeWidth: 2
        });
        this._dynamicGroup.add(this._triangle);

        const bar = new Konva.Line({
            points: [15, -15, 15, 15],
            stroke: stroke,
            strokeWidth: 3
        });

        const arrow1 = new Konva.Line({
            points: [30, -6, 38, -14, 30, -14],
            closed: true,
            fill: '#2ecc71',
            stroke: stroke,
            strokeWidth: 1.5
        });

        const arrow2 = new Konva.Line({
            points: [28, 0, 36, -8, 28, -8],
            closed: true,
            fill: '#2ecc71',
            stroke: stroke,
            strokeWidth: 1.5
        });

        this._staticGroup.add(bar, arrow1, arrow2);

        this.paramLabel = new Konva.Text({
            x: -35, y: -40, width: 80,
            text: this.vForward.toFixed(1) + 'V',
            fontSize: 12, fill: '#e74c3c', fontStyle: 'bold',
            align: 'center', listening: false,
        });
    }

    tick(dt) {
        const solver = this.sys?.voltageSolver;
        if (solver) {
            const cA = solver.portToCluster.get(`${this.id}_wire_l`);
            const cK = solver.portToCluster.get(`${this.id}_wire_r`);
            if (cA !== undefined && cK !== undefined) {
                const vFwd = (solver.nodeVoltages.get(cA) || 0)
                           - (solver.nodeVoltages.get(cK) || 0);
                this._triangle.fill(vFwd > 1.0 ? '#2ecc71' : '#ffffff');
            }
        }
        this.markDirty();
        this._refreshIfDirty();
    }

    getConfigFields() {
        return [
            { label: '器件名称', key: 'id', type: 'text' },
            { label: '导通压降 (V)', key: 'vForward', type: 'number' }
        ];
    }
    onConfigUpdate(cfg) {
        if (cfg.id !== undefined) {
            this.id = cfg.id;
        }
        if (cfg.vForward !== undefined) {
            this.vForward = cfg.vForward;
            this._updateLabel();
        }
        this.config = cfg;
        this._refreshCache();
    }

    _updateLabel() {
    }

    destroy() {
        super.destroy?.();
    }
}
