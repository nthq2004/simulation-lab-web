import { BaseComponent } from './BaseComponent.js';

export class Capacitor extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.type = 'capacitor';
        this.cache = 'fixed';
        this.capacitance = config.capacitance*1e-6 || 10e-6; 
        this.vLast = 0;       
        this.physCurrent = 0; 
        
        // 极板电容通常对称，引脚设在左右两侧或上下
        // 这里设为水平排列：左(正) 右(负)
        this.addPort(-40, 0, 'l', 'wire'); // 正极以 p 结尾，触发红色连线
        this.addPort(40, 0, 'r', 'wire');  

        this.initVisuals();
        if(config.direction = 'vertical')this.group.rotate(90);
    }

    initVisuals() {
        const theme = {
            stroke: '#2c3e50', // 极板和引线颜色
            strokeWidth: 3,
            labelColor: '#34495e'
        };

        // 1. 左侧引线
        const leadL = new Konva.Line({
            points: [-40, 0, -6, 0],
            stroke: theme.stroke,
            strokeWidth: theme.strokeWidth,
        });

        // 2. 右侧引线
        const leadR = new Konva.Line({
            points: [6, 0, 40, 0],
            stroke: theme.stroke,
            strokeWidth: theme.strokeWidth,
        });

        // 3. 左极板
        const plateL = new Konva.Line({
            points: [-6, -20, -6, 20],
            stroke: theme.stroke,
            strokeWidth: 4,
            lineCap: 'round'
        });

        // 4. 右极板
        const plateR = new Konva.Line({
            points: [6, -20, 6, 20],
            stroke: theme.stroke,
            strokeWidth: 4,
            lineCap: 'round'
        });

        // 5. 容量文字标签 (放在极板上方)
        this.label = new Konva.Text({
            x: -40,
            y: -35,
            text: this.formatCapacitance(this.capacitance),
            fontSize: 12,
            fontStyle: 'bold',
            fill: theme.labelColor,
            align: 'center',
            width: 80
        });

        // 将所有组件添加到组
        this.group.add(leadL, leadR, plateL, plateR, this.label);

        // 增加一个透明的点击区域（Hit Area），方便用户在画布上选中
        const hitArea = new Konva.Rect({
            x: -40, y: -25,
            width: 80, height: 50,
            fill: 'transparent'
        });
        this.group.add(hitArea);
    }

    // 保持你原有的 formatCapacitance 逻辑
    formatCapacitance(farads) {
        if (farads >= 1) return farads.toFixed(1) + ' F';
        if (farads >= 1e-3) return (farads * 1e3).toFixed(1) + ' mF';
        if (farads >= 1e-6) return (farads * 1e6).toFixed(1) + ' uF';
        if (farads >= 1e-9) return (farads * 1e9).toFixed(1) + ' nF';
        return (farads * 1e12).toFixed(1) + ' pF';
    }

    getCompanionModel(deltaTime) {
        const gEq = this.capacitance / deltaTime;
        const iEq = gEq * this.vLast;
        return { gEq, iEq };
    }

    updateState(vL, vR) {
        this.vLast = vL - vR;
    }

    calculatePhysicalCurrent(vL, vR, deltaTime) {
        if (deltaTime <= 0) return 0;
        const gEq = this.capacitance / deltaTime;
        this.physCurrent = gEq * ((vL - vR) - this.vLast);
    }
    getConfigFields() {
        return [
            { label: '名称', key: 'id', type: 'text' },
            { label: '电容值', key: 'capacitance', type: 'number' },
        ];
    }
    onConfigUpdate(newConfig) {
        this.config = newConfig;
        this.id =newConfig.id;
        this.capacitance = parseFloat(newConfig.capacitance)*1e-6;
        this.label.text(this.formatCapacitance(this.capacitance));
        this._refreshCache();
    }
}