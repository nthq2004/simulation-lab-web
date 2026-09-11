import { BaseComponent } from './BaseComponent.js';

export class CoolingSys extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.W = 320;
        this.H = 400;
        this.type = 'CoolingSys';
        this.cache = 'fixed';

        this._initGroups();

        this.mode = 'local';
        this.running = false;
        this.power = 0;
        this.targetPower = 0;
        this.temperature = config.initTemp !== undefined ? config.initTemp : 0;
        this._crankAngle = 0;

        this._drawShell();
        this._drawControlPanel();
        this._drawRefrigerationCycle();
        this._drawPorts();

        this.config = { id: this.id };
    }

    tick(dt) {
        this._tickAcc = (this._tickAcc || 0) + dt;
        if (this._tickAcc < 0.05) return;
        this._tickAcc = 0;

        if (this.mode === 'remote') {
            const connected = this.sys.isPortConnected(`${this.id}_wire_l`, `${this.id}_wire_r`);
            this.targetPower = connected ? 1.0 : 0;
            this.running = this.targetPower > 0;
        }

        const lerpSpeed = this.targetPower > this.power ? 0.25 : 0.12;
        this.power += (this.targetPower - this.power) * lerpSpeed * 0.2;
        if (this.power < 0.01) this.power = 0;

        if (this.running) {
            this.temperature -= 0.2 * dt;
            this.temperature = Math.max(-18, this.temperature);
            this._crankAngle += this.power * 180 * dt;
        } else {
            this.temperature += 0.1 * dt;
            this.temperature = Math.min(20, this.temperature);
        }

        this._lcdTemp.text(this.temperature.toFixed(1) + '°C');

        // 温控测试滑块激活时不更新 WT1226
        const sc = document.getElementById('tempSliderContainer');
        if (!sc || sc.style.display === 'none') {
            const wt = this.sys.comps['wt'];
            if (wt && wt.update) wt.update(this.temperature);
        }

        this._updateVisuals();
    }

    _updateVisuals() {
        const rad = this._crankAngle * Math.PI / 180;
        const travel = Math.sin(rad) * 12;
        this._compPiston.y(this._compPistonOrigin + travel);
        this._compRod.points([0, 0, -Math.cos(rad) * 6, -30 + travel]);
        const running = this.running;
        this._onBtn.fill(running ? '#00ff00' : '#006400');
        this._offBtn.fill(running ? '#8b0000' : '#ff0000');

        // 压缩机运行动画：内圈旋转 + 颜色变化
        const angle = this._crankAngle % 360;
        this._compInner.rotation(running ? angle : 0);
        this._compOuter.fill(running ? '#dc3545' : '#6c757d');
        this._compInner.fill(running ? '#ff6b35' : '#495057');

        this._updateFlowArrows(rad, running);

        if (this.sys && this.sys.requestRedraw) this.sys.requestRedraw();
    }

    _updateFlowArrows(rad, running) {
        const speed = running ? 3 : 0;
        this._flowArrows.forEach(arrow => {
            if (arrow.visible()) {
                const offset = (arrow.dashOffset() || 0) - speed;
                arrow.dashOffset(offset);
                arrow.stroke(running ? '#ff6b35' : '#4a7db5');
                arrow.strokeWidth(running ? 3.5 : 3);
            }
        });
    }

    _syncKnobRotation() {
        if (this._modeKnob) {
            new Konva.Tween({ node: this._modeKnob, duration: 0.2, rotation: this.mode === 'local' ? -45 : 45 }).play();
        }
    }

    set mode(val) {
        this._mode = val;
        this._syncKnobRotation();
    }

    get mode() {
        return this._mode;
    }

    _drawShell() {
        this._staticGroup.add(new Konva.Rect({
            width: this.W, height: this.H,
            fill: '#e8e8e8', stroke: '#333', strokeWidth: 2, cornerRadius: 6
        }));
    }

    _drawControlPanel() {
        const cx = this.W / 2; // center of component = 160

        // 第1行：旋钮、起动、停止（对称分布）
        const row1Y = 45;
        const spacing = 85;
        const knobX = cx - spacing;
        const startX = cx;
        const stopX = cx + spacing;

        const panel = new Konva.Group({ x: 0, y: 0 });

        // 1. 模式转换旋钮
        this._modeKnob = new Konva.Group({ x: knobX, y: row1Y, cursor: 'pointer' });
        this._modeKnob.add(new Konva.Circle({ radius: 20, fill: '#555', stroke: '#222', strokeWidth: 1.5 }));
        const knobInd = new Konva.Rect({ x: -2.5, y: -20, width: 5, height: 17, fill: '#fff', cornerRadius: 1 });
        this._modeKnob.add(knobInd);
        this._modeKnob.rotation(this.mode === 'local' ? -45 : 45);

        this._modeKnob.on('click', () => {
            this.mode = this.mode === 'local' ? 'remote' : 'local';
            this._syncKnobRotation();
            this.targetPower = 0;
            this.running = false;
        });

        panel.add(new Konva.Text({ x: knobX - 40, y: row1Y - 24, text: 'LOC', fontSize: 12, fontStyle: 'bold' }));
        panel.add(new Konva.Text({ x: knobX + 14, y: row1Y - 24, text: 'REM', fontSize: 12, fontStyle: 'bold' }));
        panel.add(this._modeKnob);

        // 2. 起动按钮
        const onGroup = new Konva.Group({ x: startX, y: row1Y });
        this._onBtn = new Konva.Circle({ radius: 18, fill: '#006400', stroke: '#000', strokeWidth: 1.5, cursor: 'pointer' });
        onGroup.add(this._onBtn);
        onGroup.add(new Konva.Text({ x: -10, y: 21, text: '起动', fontSize: 12, fontStyle: 'bold' }));
        onGroup.on('click', () => {
            if (this.mode === 'local') {
                this.running = true;
                this.targetPower = 1.0;
            }
        });
        panel.add(onGroup);

        // 3. 停止按钮
        const offGroup = new Konva.Group({ x: stopX, y: row1Y });
        this._offBtn = new Konva.Circle({ radius: 18, fill: '#dc3545', stroke: '#000', strokeWidth: 1.5, cursor: 'pointer' });
        offGroup.add(this._offBtn);
        offGroup.add(new Konva.Text({ x: -10, y: 21, text: '停止', fontSize: 12, fontStyle: 'bold' }));
        offGroup.on('click', () => {
            if (this.mode === 'local') {
                this.running = false;
                this.targetPower = 0;
            }
        });
        panel.add(offGroup);

        this._interactGroup.add(panel);

        // 4. LCD 显示屏（下方居中）
        const lw = 130, lh = 40;
        const lcdY = row1Y + 50;
        const lx = cx - lw / 2;

        this._staticGroup.add(new Konva.Rect({
            x: lx - 3, y: lcdY, width: lw + 6, height: lh + 6,
            fill: '#222', stroke: '#111', strokeWidth: 2, cornerRadius: 4
        }));
        this._staticGroup.add(new Konva.Rect({
            x: lx, y: lcdY + 3, width: lw, height: lh - 3,
            fill: '#1a3a1a', stroke: '#0d2e0d', strokeWidth: 1, cornerRadius: 2
        }));
        this._staticGroup.add(new Konva.Text({
            x: lx, y: lcdY + 1, width: lw,
            text: '温度', fontSize: 13, fill: '#4db84d',
            align: 'center', fontFamily: 'monospace'
        }));

        this._lcdTemp = new Konva.Text({
            x: lx, y: lcdY + 18, width: lw,
            text: '20.0\u00b0C', fontSize: 20, fontStyle: 'bold', fill: '#39ff39',
            align: 'center', fontFamily: 'monospace'
        });
        this._dynamicGroup.add(this._lcdTemp);
    }

    _drawRefrigerationCycle() {
        const box = new Konva.Group({ x: 15, y: 175 });

        const bw = this.W - 30, bh = this.H - 190;

        box.add(new Konva.Rect({
            width: bw, height: bh, fill: '#f5f5f0',
            stroke: '#666', strokeWidth: 1.5, cornerRadius: 4
        }));

        const cx = bw / 2, cy = bh / 2;

        const compX = cx, compY = 25;
        const condX = bw - 55, condY = cy;
        const thrX = cx, thrY = bh - 30;
        const evapX = 55, evapY = cy;

        this._flowArrows = [];

        const addArrowLine = (pts, color) => {
            const line = new Konva.Line({
                points: pts, stroke: color || '#4a7db5',
                strokeWidth: 3, lineCap: 'round', dash: [6, 4],
                dashOffset: 0
            });
            box.add(line);
            this._flowArrows.push(line);
        };

        // 管路接至冷凝器和蒸发器的中央高度
        addArrowLine([compX + 22, compY, condX - 35, compY, condX - 35, condY]);
        addArrowLine([condX, condY + 22, condX, thrY - 22, thrX, thrY - 22]);
        addArrowLine([thrX, thrY + 22, evapX + 35, thrY + 22, evapX + 35, evapY]);
        addArrowLine([evapX, evapY - 22, evapX, compY, compX - 22, compY]);

        // 在冷凝器和蒸发器连接处画小圆表示接口
        const portR = 5;
        box.add(new Konva.Circle({ x: condX - 35, y: condY, radius: portR, fill: '#b87333', stroke: '#8b5a2b', strokeWidth: 1 }));
        box.add(new Konva.Circle({ x: condX, y: condY + 22, radius: portR, fill: '#b87333', stroke: '#8b5a2b', strokeWidth: 1 }));
        box.add(new Konva.Circle({ x: evapX + 35, y: evapY, radius: portR, fill: '#b87333', stroke: '#8b5a2b', strokeWidth: 1 }));
        box.add(new Konva.Circle({ x: evapX, y: evapY - 22, radius: portR, fill: '#b87333', stroke: '#8b5a2b', strokeWidth: 1 }));

        const compGroup = new Konva.Group({ x: compX, y: compY });
        this._compOuter = new Konva.Circle({ radius: 22, fill: '#6c757d', stroke: '#333', strokeWidth: 2 });
        this._compInner = new Konva.Circle({ radius: 14, fill: '#495057', stroke: '#222', strokeWidth: 1 });
        compGroup.add(this._compOuter, this._compInner);
        this._compPiston = new Konva.Rect({ x: -8, y: -30, width: 16, height: 18, fill: '#adb5bd', stroke: '#333', cornerRadius: 2 });
        this._compPistonOrigin = -30;
        this._compRod = new Konva.Line({ points: [0, 0, 0, -30], stroke: '#888', strokeWidth: 4, lineCap: 'round' });
        compGroup.add(this._compPiston, this._compRod);
        compGroup.add(new Konva.Text({ x: -16, y: 26, text: '压缩机', fontSize: 13, fontStyle: 'bold', fill: '#333' }));
        box.add(compGroup);

        const condGroup = new Konva.Group({ x: condX, y: condY });
        for (let i = 0; i < 4; i++) {
            condGroup.add(new Konva.Line({
                points: [-35, -20 + i * 13, 35, -20 + i * 13],
                stroke: '#dc3545', strokeWidth: 4, lineCap: 'round'
            }));
        }
        condGroup.add(new Konva.Line({ points: [-35, -20, -35, 22], stroke: '#dc3545', strokeWidth: 3 }));
        condGroup.add(new Konva.Line({ points: [35, -20, 35, 22], stroke: '#dc3545', strokeWidth: 3 }));
        condGroup.add(new Konva.Text({ x: -42, y: 30, text: '冷凝器', fontSize: 13, fontStyle: 'bold', fill: '#333' }));
        box.add(condGroup);

        const thrGroup = new Konva.Group({ x: thrX, y: thrY });
        thrGroup.add(new Konva.Line({
            points: [-18, -12, 18, -12, 0, 12],
            fill: '#ffc107', stroke: '#856404', strokeWidth: 2, closed: true
        }));
        thrGroup.add(new Konva.Line({ points: [0, -12, 0, -22], stroke: '#666', strokeWidth: 2 }));
        thrGroup.add(new Konva.Line({ points: [0, 12, 0, 22], stroke: '#666', strokeWidth: 2 }));
        thrGroup.add(new Konva.Text({ x: 12, y: 0, text: '节流元件', fontSize: 13, fontStyle: 'bold', fill: '#333' }));
        box.add(thrGroup);

        const evapGroup = new Konva.Group({ x: evapX, y: evapY });
        for (let i = 0; i < 4; i++) {
            evapGroup.add(new Konva.Line({
                points: [-35, -20 + i * 13, 35, -20 + i * 13],
                stroke: '#17a2b8', strokeWidth: 4, lineCap: 'round'
            }));
        }
        evapGroup.add(new Konva.Line({ points: [-35, -20, -35, 22], stroke: '#17a2b8', strokeWidth: 3 }));
        evapGroup.add(new Konva.Line({ points: [35, -20, 35, 22], stroke: '#17a2b8', strokeWidth: 3 }));
        evapGroup.add(new Konva.Text({ x: -16, y: 30, text: '蒸发器', fontSize: 13, fontStyle: 'bold', fill: '#333' }));
        box.add(evapGroup);

        this.group.add(box);
    }

    _drawPorts() {
        // 电气端口改到左侧边缘
        this.addPort(0, 70, 'l', 'wire','p');
        this.addPort(0, 120, 'r', 'wire');
    }

    destroy() {
        super.destroy?.();
    }
}
