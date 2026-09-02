import { BaseComponent } from './BaseComponent.js';

/**
 * Diode - 二极管（视觉组件）
 *
 * 说明：
 * - 本组件在画布上绘制标准的二极管符号（一个指向负极的三角和一条竖线），并提供两个端口用于连线。
 * - 器件参数：`vForward`（导通压降，单位 V）、`rOn`（导通时的小电阻）和 `rOff`（截止时的高电阻）。
 * - 该组件为演示/教学用视觉组件，不包含完整电路仿真；电气行为由上层电路求解器决定，
 *   本组件仅保存导通阈值参数供仿真器参考。
 */

export class Diode extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        this.direction = config.direction;
        this.type = 'diode';
        this.cache = 'fixed';
        
        // 初始化图层组：`_staticGroup`（不常变的视觉）、`_dynamicGroup`（会变的视觉）和 `_interactGroup`
        this._initGroups();

        // 器件电气参数（用于上层电路仿真器）：
        // vForward: 导通压降（V），rOn: 导通时的小电阻（Ω），rOff: 截止时的大电阻（Ω）
        this.vForward = config.vForward || 0.68; // 默认 0.68V（硅二极管近似值）
        this.rOn = 0.5;  // 导通时的近似动态电阻
        this.rOff = 1e8; // 截止时近似为开路的大电阻

        this.config = {id:this.id, vForward:this.vForward};

        // 绘制静态外观与添加端口
        this.initVisuals();
        this.initPorts();

        // 根据方向参数翻转图形（'reverse' 表示旋转 180°）
        if (this.direction === 'reverse') this.group.rotate(180);
    }

    initPorts() {
        // 端口定义：左端为 p（阳极/Anode），右端为 n（阴极/Cathode）
        // 端口类型为 'wire'，上层连线系统会读取这些端口进行电路求解
        this.addPort(-40, 0, 'l', 'wire', 'p');
        this.addPort(40, 0, 'r', 'wire');
    }

    initVisuals() {
        const stroke = '#000000';
        // 绘制引线
        // 左/右引线
        this._staticGroup.add(new Konva.Line({ points: [-40, 0, -15, 0], stroke, strokeWidth: 2 }));
        this._staticGroup.add(new Konva.Line({ points: [15, 0, 40, 0], stroke, strokeWidth: 2 }));

        // 二极管符号：三角形指向负极（表示电流允许方向）
        const triangle = new Konva.Line({
            points: [-15, -15, -15, 15, 15, 0],
            closed: true,
            fill: '#ffffff',
            stroke: stroke,
            strokeWidth: 2
        });

        // 负极的竖线（挡板），通常绘制为较粗的线以示区别
        const bar = new Konva.Line({
            points: [15, -15, 15, 15],
            stroke: stroke,
            strokeWidth: 3
        });

        this._staticGroup.add(triangle, bar);

        this.vfLabel = new Konva.Text({
            x: -35, y: -40, width: 80,
            text: this.vForward.toFixed(3) + 'V',
            fontSize: 12, fill: '#e74c3c', fontStyle: 'bold',
            align: 'center', listening: false,
        });
        // this._dynamicGroup.add(this.vfLabel);
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
            this._updateVfLabel();
            if (this.sys && this.sys.eventBus) {
                this.sys.eventBus.emit('diode:vfChanged', { id: this.id, vForward: cfg.vForward });
            }
        }
        this.config = cfg;
        this._refreshCache();
    }

    _updateVfLabel() {
        // if (this.vfLabel) {
        //     this.vfLabel.text(this.vForward.toFixed(3) + 'V');
        //     this.markDirty();
        // }
    }


    destroy() {
        super.destroy?.();
    }
}
