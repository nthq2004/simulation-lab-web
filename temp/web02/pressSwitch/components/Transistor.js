import { BaseComponent } from './BaseComponent.js';

export class Transistor extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        this.type = 'bjt';
        this.subType = 'NPN';

        // 核心参数
        this.beta = 100;
        this.vbeOn = 0.7;                 // 导通阈值
        this.vceSat = 0.2;                 // 饱和压降

        this.config = { id: this.id, subType: this.subType, beta: this.beta, };

        this.initVisuals();
        this.initPorts();
    }

    initPorts() {
        this.addPort(-40, 0, 'b', 'wire', 'b');
        this.addPort(20, -40, 'c', 'wire', 'c');
        this.addPort(20, 40, 'e', 'wire', 'e');
    }

    initVisuals() {
        // 清除旧图形
        this.group.destroyChildren();

        const stroke = '#000000';
        const sw = 2;

        // 1. 外部圆圈
        const circle = new Konva.Circle({
            x: 0, y: 0, radius: 30, stroke, strokeWidth: sw, fill: '#ffffff'
        });

        // 2. 基极竖线
        const baseBar = new Konva.Line({
            points: [-10, -15, -10, 15], stroke, strokeWidth: 3
        });

        // 3. 引线
        const bLine = new Konva.Line({ points: [-40, 0, -10, 0], stroke, strokeWidth: sw });
        const cLine = new Konva.Line({ points: [-10, -8, 20, -25, 20, -40], stroke, strokeWidth: sw });
        const eLine = new Konva.Line({ points: [-10, 8, 20, 25, 20, 40], stroke, strokeWidth: sw });

        // 4. 发射极箭头逻辑
        let arrowPoints;
        if (this.subType === 'NPN') {
            // NPN: 箭头在发射极线段上，指向外 (20, 25)
            arrowPoints = [2, 16, 15, 23];
        } else {
            // PNP: 箭头在发射极线段上，指向内 (-10, 8)
            arrowPoints = [15, 23, 2, 16];
        }

        const arrow = new Konva.Arrow({
            points: arrowPoints,
            pointerLength: 8,
            pointerWidth: 6,
            fill: stroke,
            stroke: stroke,
            strokeWidth: 1
        });

        this.group.add(circle, baseBar, bLine, cLine, eLine, arrow);

        // 强制图层重绘
        if (this.sys && this.sys.layer) {
            this.sys.layer.batchDraw();
        }
    }
getCompanionModel(vB, vC, vE) {
    const isNPN = (this.subType === 'NPN');
    const pol = isNPN ? 1 : -1;
    const beta = this.beta || 100;

    const vbe = (vB - vE) * pol;
    const vce = (vC - vE) * pol;

    // --- 1. 基极回路 (BE 结) ---
    // 使用简单的线性化模型：Vbe > 0.7V 导通，否则截止
    const V_ON = 0.7;
    const G_ON = 2; // 导通电导
    const gBE = (vbe > V_ON) ? G_ON : 1e-9;
    const iBE = (vbe > V_ON) ? -V_ON * G_ON : 0;

    // --- 2. 软饱和控制 (关键) ---
    // multiplier 在 Vce=0.2V 时约 0.6，Vce=0V 时为 0
    // 这种平滑过渡是矩阵收敛的救星
    const saturationMultiplier = Math.tanh(Math.max(0, vce) / 0.2);
    const currentBeta = beta * saturationMultiplier;

    // --- 3. 饱和区锁定 (防止 VC 变负) ---
    // 当 Vce 低于 0.2V 时，开启一个额外的电导把电压拉回来
    const V_SAT = 0.2;
    let gCE_sat = 0;
    if (vbe > V_ON) {
        gCE_sat = G_ON * (1 - saturationMultiplier);
    }
    // 极端情况：如果 VC 真的变负了，强制用超大电导顶住
    if (vce < 0) gCE_sat += 100;

    return {
        internal: { gBE, iBE, beta: currentBeta, gCE_sat, pol, V_SAT }
    };
}
    getConfigFields() {
        return [
            { label: '器件名称', key: 'id', type: 'text' },
            { label: '放大倍数 (Beta)', key: 'beta', type: 'number' },
            {
                label: '类型 (NPN/PNP)', key: 'subType', type: 'select', options: [
                    { label: 'NPN', value: 'NPN' },
                    { label: 'PNP', value: 'PNP' }]
            }];
    }

    onConfigUpdate(newConfig) {
        this.config = newConfig;
        this.id = newConfig.id;
        this.subType = newConfig.subType;
        this.beta = newConfig.beta;
        this.initVisuals();
        this.sys.layer.batchDraw();
    }
}