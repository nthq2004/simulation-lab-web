import { BaseComponent } from './BaseComponent.js';

export class OpAmp extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        // 仿真属性
        this.sourceVolt =config.source|| 15;
        this.gain = config.gain || 1000000;

        this.vPosLimit = this.sourceVolt - 1.5;               // 内部正轨限幅
        this.vNegLimit = -this.vPosLimit;              // 内部负轨限幅
        this.type = 'amplifier';
        this.cache = 'fixed'; // 固定增益

        this.config = { id: this.id, gain: this.gain, sourceVolt: this.sourceVolt };
        this.initVisuals();
        this.initPorts();


    }

    initPorts() {
        // --- 仅添加逻辑引脚 (仿真可用) ---
        // 根据 OP07 引脚图位置定义坐标
        this.addPort(-57.5 * this.scale, -15 * this.scale, 'n', 'wire');  // 引脚 2
        this.addPort(-57.5 * this.scale, 15 * this.scale, 'p', 'wire', 'p');   // 引脚 3
        this.addPort(57.5 * this.scale, 15 * this.scale, 'OUT', 'wire', 'p');    // 引脚 6
    }

    initVisuals() {
        const colors = {
            body: '#ffffff',
            stroke: '#000000',
            pin: '#2c3e50',
            internalWire: '#7f8c8d'
        };

        // 1. 芯片外壳 (矩形)
        const body = new Konva.Rect({
            x: -50 * this.scale, y: -60 * this.scale,
            width: 100 * this.scale, height: 120 * this.scale,
            fill: colors.body,
            stroke: colors.stroke,
            strokeWidth: 2 * this.scale,
            cornerRadius: 4 * this.scale
        });
        this.group.add(body);
        // 2. 引脚 1 标识点
        const notch = new Konva.Circle({
            x: -38 * this.scale, y: -48 * this.scale, radius: 4 * this.scale, fill: colors.stroke
        });

        // 3. 绘制 8 个引脚 (全视觉还原)
        // 左侧: 1, 2, 3, 4 | 右侧: 8, 7, 6, 5
        const pinPositions = [
            { x: -65 * this.scale, y: -45 * this.scale, label: '1', name: '' },
            { x: -65 * this.scale, y: -15 * this.scale, label: '2', name: '' },
            { x: -65 * this.scale, y: 15 * this.scale, label: '3', name: '' },
            { x: -65 * this.scale, y: 45 * this.scale, label: '4', name: `-${this.sourceVolt}V` },
            { x: 50 * this.scale, y: -45 * this.scale, label: '8', name: '' },
            { x: 50 * this.scale, y: -15 * this.scale, label: '7', name: `+${this.sourceVolt}V` },
            { x: 50 * this.scale, y: 15 * this.scale, label: '6', name: '' },
            { x: 50 * this.scale, y: 45 * this.scale, label: '5', name: '' }
        ];

        pinPositions.forEach(pos => {
            // 绘制引脚金属片
            this.group.add(new Konva.Rect({
                x: pos.x, y: pos.y - 5 * this.scale,
                width: 15 * this.scale, height: 10 * this.scale,
                fill: '#bdc3c7',
                stroke: colors.stroke,
                strokeWidth: 1 * this.scale
            }));
            // 绘制引脚编号
            this.group.add(new Konva.Text({
                x: pos.x > 0 ? pos.x + 18 * this.scale : pos.x - 12 * this.scale,
                y: pos.y - 4 * this.scale,
                text: pos.label,
                fontSize: 10 * this.scale,
                fill: '#7f8c8d'
            }));
            // 绘制功能文字标注
        });

        this.negVolt = new Konva.Text({
            x: -45 * this.scale,
            y: 40 * this.scale,
            text: `-${this.sourceVolt}V`,
            fontSize: 12 * this.scale,
            align: 'left'
        });

        this.posVolt = new Konva.Text({
            x: 20 * this.scale,
            y: -19 * this.scale,
            text: `+${this.sourceVolt}V`,
            fontSize: 12 * this.scale,
            align: 'right'
        });
        this.group.add(this.negVolt, this.posVolt);

        // 4. 内部运放三角形符号 (中心位置调整)
        const triangle = new Konva.Line({
            points: [-18 * this.scale, -29 * this.scale, -18 * this.scale, 29 * this.scale, 22 * this.scale, 0],
            closed: true,
            stroke: colors.stroke,
            strokeWidth: 2 * this.scale
        });

        // 5. 内部引线 (仅连接逻辑引脚 2, 3, 6)
        const wires = [
            { pts: [-18 * this.scale, -15 * this.scale, -50 * this.scale, -15 * this.scale], color: colors.internalWire }, // To Pin 2
            { pts: [-18 * this.scale, 15 * this.scale, -50 * this.scale, 15 * this.scale], color: colors.internalWire },   // To Pin 3
            { pts: [22 * this.scale, 0, 50 * this.scale, 15 * this.scale], color: colors.internalWire }       // To Pin 6
        ];

        wires.forEach(w => {
            this.group.add(new Konva.Line({
                points: w.pts,
                stroke: w.color,
                strokeWidth: 3.2 * this.scale,
                dash: [3, 2]
            }));
        });

        // 6. 核心文本与符号
        const title = new Konva.Text({
            x: -22 * this.scale, y: -55 * this.scale, text: 'OP07',
            fontSize: 14 * this.scale, fontStyle: 'bold'
        });
        const symMinus = new Konva.Text({ x: -15 * this.scale, y: -24 * this.scale, text: '-', fontSize: 18 * this.scale });
        const symPlus = new Konva.Text({ x: -15 * this.scale, y: 8 * this.scale, text: '+', fontSize: 14 * this.scale });
        const symOut = new Konva.Text({ x: -8 * this.scale, y: -8 * this.scale, text: 'out', fontSize: 14 * this.scale });

        this.group.add(triangle, title, symMinus, symPlus, symOut, notch);



    }

    updateSource() {
        if (this.negVolt && this.posVolt) {
            this.negVolt.text(`-${this.sourceVolt}V`);
            this.posVolt.text(`+${this.sourceVolt}V`);

            // 更新限幅值
            this.vPosLimit = this.sourceVolt - 1.5;
            this.vNegLimit = -this.vPosLimit;
        }
    }
    getConfigFields() {
        return [
            { label: '器件名称', key: 'id', type: 'text' },
            { label: '开环增益 (A)', key: 'gain', type: 'number' },
            { label: '电源电压（正负对称）', key: 'sourceVolt', type: 'number' },
        ];
    }

    onConfigUpdate(newConfig) {
        this.config = newConfig;
        this.gain = parseInt(newConfig.gain) || 1e6;
        this.sourceVolt = parseInt(newConfig.sourceVolt);
        this.id = newConfig.id;
        this.updateSource();
        this._refreshCache();
    }
}