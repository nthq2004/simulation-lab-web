import { BaseComponent } from './BaseComponent.js';

export class SmartAnalogSwitch extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        this._initGroups();

        this.width  = config.width  || 320;
        this.height = config.height || 150;
        this.type = 'smart_switch';
        this.cache = 'fixed';

        this.functions = ['DCA', 'DCV', 'L', 'R', 'C', 'Diode'];
        this.currentFunction = config.function || 'DCA';
        this.position = config.position || 1;

        this._funcBtns = [];
        this._bladeLine = null;
        this._glows = [];

        this._drawStatic();
        this._createDynamic();
        this._bindButtons();

        const rx = Math.max(150, this.width * 0.55);
        const rw = this.width - rx+12 ;
        const sp = rw / 5;

        this.addPort(rx + sp * 1, 0, 't1', 'wire');
        this.addPort(rx + sp * 2, 0, 't2', 'wire');
        this.addPort(rx + sp * 3, 0, 't3', 'wire');
        this.addPort(rx + sp * 4, 0, 't4', 'wire');
        this.addPort(rx + sp * 2.5, this.height, 'com', 'wire', 'p');
        this.addPort(this.width, 100, 'a', 'wire','p');
        this.addPort(this.width, 140, 'b', 'wire');
    }

    _drawStatic() {
        const W = this.width, H = this.height;

        this._staticGroup.add(new Konva.Rect({
            x: 0, y: 0, width: W, height: H,
            fill: '#f5f5f5', stroke: '#ccc', strokeWidth: 2, cornerRadius: 6,
        }));

        this._staticGroup.add(new Konva.Text({
            x: 56, y: 4, text: '智能模拟开关', fontSize: 15,
            fill: '#333', fontStyle: 'bold',align:'center'
        }));

        const divX = 192;
        this._staticGroup.add(new Konva.Line({
            points: [divX, 24, divX, H - 4],
            stroke: '#ddd', strokeWidth: 1, dash: [3, 3],
        }));

        this._staticGroup.add(new Konva.Text({
            x: 4, y: 26, text: '功能选择', fontSize: 14, fill: '#057548',
        }));

        const divW = divX - 16;
        const btnX = 8, btnW = (divW - 4) / 2, btnH = 26, gap = 6;
        const rows = [
            ['DCA', 'DCV'],
            ['L', 'R'],
            ['C', 'Diode'],
        ];
        rows.forEach((row, ri) => {
            row.forEach((fn, ci) => {
                const x = btnX + ci * (btnW + gap);
                const y = 50 + ri * (btnH + gap);
                const isSel = fn === this.currentFunction;
                const bg = new Konva.Rect({
                    x, y, width: btnW, height: btnH,
                    fill: isSel ? '#e67e22' : '#ddd',
                    stroke: '#bbb', strokeWidth: 1, cornerRadius: 4,
                    name: 'func_btn_' + fn,
                });
                const txt = new Konva.Text({
                    x, y: y + 6, width: btnW,
                    text: fn, fontSize: 14, fill: isSel ? '#fff' : '#333',
                    align: 'center', fontStyle: 'bold', name: 'func_txt_' + fn,
                    listening: false,
                });
                this._staticGroup.add(bg, txt);
                this._funcBtns.push({ fn, bg, txt });
            });
        });

        const rx = Math.max(150, W * 0.55), rw = W - rx + 12, sp = rw / 5;
        const tY = Math.round(H * 0.37);
        const bY = Math.round(H * 0.73);
        const comX = rx + sp * 2.5;

        for (let i = 1; i <= 4; i++) {
            const x = rx + sp * i;
            this._staticGroup.add(new Konva.Line({
                points: [x, tY, x, 6],
                stroke: '#fc0808', strokeWidth: 3, dash: [2, 2],
                listening: false,
            }));
        }
        this._staticGroup.add(new Konva.Line({
            points: [comX, bY, comX, H ],
            stroke: '#ed0707', strokeWidth: 3, dash: [2, 2],
            listening: false,
        }));

        for (let i = 1; i <= 4; i++) {
            const x = rx + sp * i;
            this._drawContact(x, tY, '#3c3a3a');
            this._staticGroup.add(new Konva.Text({
                x: x+5 , y: tY - 18, text: 'T' + i,
                fontSize: 12, fill: '#666', fontStyle: 'bold', listening: false,
            }));
        }

        this._drawContact(comX, bY, '#e74c3c');
        this._staticGroup.add(new Konva.Text({
            x: comX - 14, y: bY + 8, text: 'COM',
            fontSize: 11, fill: '#e74c3c', fontStyle: 'bold', listening: false,
        }));

        this._staticGroup.add(new Konva.Text({
            x: W - 16, y: 94, text: 'A', fontSize: 10, fill: '#1f8b4c', listening: false,
        }));
        this._staticGroup.add(new Konva.Text({
            x: W - 16, y: 134, text: 'B', fontSize: 10, fill: '#1f8b4c', listening: false,
        }));
    }

    _drawContact(x, y, color) {
        const R = 7;
        this._staticGroup.add(new Konva.Circle({
            x, y, radius: R,
            fill: color, stroke: '#0e0d0d', strokeWidth: 1,
        }));
        this._staticGroup.add(new Konva.Circle({
            x, y, radius: R * 0.4, fill: '#fff',
        }));
    }

    _createDynamic() {
        const W = this.width, H = this.height;
        const rx = Math.max(150, W * 0.55), rw = W - rx + 12, sp = rw / 5;
        const tY = Math.round(H * 0.37);
        const bY = Math.round(H * 0.73);
        const comX = rx + sp * 2.5;

        this._tPos = [];
        for (let i = 1; i <= 4; i++) {
            this._tPos.push({ x: rx + sp * i, y: tY });
        }
        this._comPos = { x: comX, y: bY };

        this._tPos.forEach((t, i) => {
            const gl = new Konva.Circle({
                x: t.x, y: t.y, radius: 12,
                fill: 'rgba(252, 5, 5, 0.25)',
                visible: (i + 1) === this.position, listening: false,
            });
            this._dynamicGroup.add(gl);
            this._glows.push(gl);
        });

        this._bladeLine = new Konva.Line({
            points: [comX, bY, this._tPos[this.position - 1].x, this._tPos[this.position - 1].y],
            stroke: '#4a9eff', strokeWidth: 3, lineCap: 'round', listening: false,
        });
        this._dynamicGroup.add(this._bladeLine);


    }

    _bindButtons() {
        this._funcBtns.forEach(({ fn }) => {
            const bg = this._staticGroup.findOne('.func_btn_' + fn);
            if (!bg) return;
            bg.on('click tap', () => {
                this._selectFunction(fn);
            });
            bg.on('mouseenter', () => { document.body.style.cursor = 'pointer'; });
            bg.on('mouseleave', () => { document.body.style.cursor = 'default'; });
        });
    }

    _selectFunction(fn) {
        if (fn === this.currentFunction) return;
        this.currentFunction = fn;
        this._funcBtns.forEach(({ fn: f, bg, txt }) => {
            const isSel = f === fn;
            bg.fill(isSel ? '#e67e22' : '#ddd');
            txt.fill(isSel ? '#fff' : '#333');
        });
        this.markDirty();
        if (this.sys) this.sys.requestRedraw();
    }

    getFunction() { return this.currentFunction; }
    getPosition() { return this.position; }

    setPosition(pos) {
        pos = Math.max(1, Math.min(4, parseInt(pos)));
        if (pos === this.position) return;
        this.position = pos;
        if (this._bladeLine && this._tPos && this._comPos) {
            const t = this._tPos[pos - 1];
            this._bladeLine.points([this._comPos.x, this._comPos.y, t.x, t.y]);
        }
        this._glows.forEach((g, i) => {
            g.visible(i + 1 === pos);
        });
        this.markDirty();
    }

    tick(dt) {
        this._refreshIfDirty();
    }

    getConfigFields() {
        return [
            { label: '初始功能', key: 'function', type: 'text' },
            { label: '初始位置(1-4)', key: 'position', type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.function !== undefined) this._selectFunction(cfg.function);
        if (cfg.position !== undefined) this.setPosition(parseInt(cfg.position));
    }

    destroy() {
        super.destroy?.();
    }
}
