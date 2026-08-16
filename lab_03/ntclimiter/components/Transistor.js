import { BaseComponent } from './BaseComponent.js';

export class Transistor extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        this.type = 'bjt';
        this.subType = 'NPN';
        this.cache = 'fixed'; // 用于静态缓存的特殊标识
        this.scale = config.scale || 1;

        // 核心参数
        this.beta = 100;
        this.vbeOn = 0.7;                 // 导通阈值
        this.vceSat = 0.2;                 // 饱和压降

        this.config = { id: this.id, subType: this.subType, beta: this.beta, };

        this.initVisuals();
        this.initPorts();
    }

    initPorts() {
        this.ports = [];
        const s = this.scale; // 缩放系数

        // 这里的 ID 必须固定，方便 circuitSolver 匹配
        this.addPort(-40 * s, 0, 'b', 'wire', 'b');
        this.addPort(20 * s, -40 * s, 'c', 'wire', 'c');
        this.addPort(20 * s, 40 * s, 'e', 'wire', 'e');
    }

    initVisuals() {
        this.group.destroyChildren();

        const s = this.scale;
        const stroke = '#000000';
        const sw = 2 * s; // 线宽也随缩放调整

        // 1. 外部圆圈
        const circle = new Konva.Circle({
            x: 0, y: 0, radius: 30 * s,
            stroke, strokeWidth: sw, fill: '#ffffff'
        });

        // 2. 基极竖线
        const baseBar = new Konva.Line({
            points: [-10 * s, -15 * s, -10 * s, 15 * s],
            stroke, strokeWidth: 3 * s
        });

        // 3. 引线 (保持逻辑坐标与端口一致)
        const bLine = new Konva.Line({ points: [-40 * s, 0, -10 * s, 0], stroke, strokeWidth: sw });
        const cLine = new Konva.Line({ points: [-10 * s, -8 * s, 20 * s, -25 * s, 20 * s, -40 * s], stroke, strokeWidth: sw });
        const eLine = new Konva.Line({ points: [-10 * s, 8 * s, 20 * s, 25 * s, 20 * s, 40 * s], stroke, strokeWidth: sw });

        // 4. 箭头逻辑
        let arrowPoints;
        if (this.subType === 'NPN') {
            arrowPoints = [2 * s, 16 * s, 15 * s, 23 * s];
        } else {
            arrowPoints = [15 * s, 23 * s, 2 * s, 16 * s];
        }

        const arrow = new Konva.Arrow({
            points: arrowPoints,
            pointerLength: 8 * s,
            pointerWidth: 6 * s,
            fill: stroke,
            stroke: stroke,
            strokeWidth: 1 * s
        });

        this.group.add(circle, baseBar, bLine, cLine, eLine, arrow);
    }

    getCompanionModel(vB, vC, vE) {
        const isNPN = (this.subType === 'NPN');
        const pol = isNPN ? 1 : -1;
        const beta = this.beta || 100;

        const vbe = (vB - vE) * pol;
        const vce = (vC - vE) * pol;

        // --- 1. 基极回路 (BE 结) ---诺顿等效--0.7V的恒压源和0.5欧姆的内阻。
        // 使用简单的线性化模型：Vbe > 0.7V 导通，否则截止
        const V_ON = 0.7;
        const G_ON = 2; // 导通电导
        const gBE = (vbe > V_ON) ? G_ON : 1e-9;
        const iBE = (vbe > V_ON) ? -V_ON * G_ON : 0;

        // --- 2. 软饱和控制 (关键) ---
        // multiplier 在 Vce=0.2V 时约 0.6，Vce=0V 时为 0，VCE越小，放大倍数越小
        // 这种平滑过渡是矩阵收敛的救星
        const saturationMultiplier = Math.tanh(Math.max(0, vce) / 0.2);
        const currentBeta = beta * saturationMultiplier;

        // --- 3. 饱和区锁定 (防止 VC 变负) ---
        // 当 Vce 低于 0.2V 时，开启一个额外的电导把电压拉回来
        const V_SAT = 0.2;
        let gCE_sat = 0;
        if (vbe > V_ON) {
            //放大倍数大，电导越小，对一个的电阻越大。
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
        this.initPorts();
        this._refreshCache();
    }

}