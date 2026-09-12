import { BaseComponent } from './BaseComponent.js';

/**
 * RealTransistor — 真实外观小功率三极管（TO-92 封装）
 *
 * 电路特性完全参照 Transistor.js：
 * - NPN type, beta=100, vbeOn=0.7V, vceSat=0.2V
 * - 提供 getCompanionModel() 供 CircuitSolver 调用
 *
 * 外观仿真实物 TO-92 封装：
 * - 黑色环氧树脂半圆柱体
 * - 平面侧印字标记
 * - 3 根引脚呈三角排列
 */
export class RealTransistor extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        this._initGroups();
        this.type = 'bjt';
        this.subType = config.subType || 'NPN';
        this.cache = 'fixed';

        this.beta = config.beta || 100;
        this.vbeOn = 0.7;                 // 发射结导通压降（B-E）
        this.vbcOn = config.vbcOn || 0.62; // 集电结导通压降（B-C），略低于 VBE 以便万用表区分 C/E
        this.vceSat = 0.2;
        // 测试标志：为真时隐藏 B/C/E 引脚标签，供考核/测试使用
        this.testFlag = config.testFlag || false;

        this.config = { id: this.id, subType: this.subType, beta: this.beta, vbeOn: this.vbeOn, vbcOn: this.vbcOn, testFlag: this.testFlag };

        this.initVisuals();
        this.initPorts();
    }

    initPorts() {
        this.ports = [];
        this.addPort(60, 0, 'b', 'wire', 'b');
        this.addPort(30, -60, 'c', 'wire', 'c');
        this.addPort(30, 60, 'e', 'wire', 'e');
    }

    initVisuals() {
        this._staticGroup.destroyChildren();
        this._dynamicGroup.destroyChildren();
        this._interactGroup.destroyChildren();
        const s = 1;
        const pinColor = '#bcc6cf';
        const pinDark = '#8a9299';

        // 引脚（先画在底层）：长度加倍，B 从右侧引出
        const bLead = new Konva.Line({
            points: [22, 0, 60, 0],
            stroke: pinColor, strokeWidth: 3, lineCap: 'round'
        });
        const cLead = new Konva.Line({
            points: [12, -18, 30, -60],
            stroke: pinColor, strokeWidth: 3, lineCap: 'round'
        });
        const eLead = new Konva.Line({
            points: [12, 18, 30, 60],
            stroke: pinColor, strokeWidth: 3, lineCap: 'round'
        });

        // 主体：TO-92 半圆柱壳体（正面视图呈矩形，顶部略带圆弧）
        const body = new Konva.Path({
            data: 'M-22,-22 L22,-22 Q28,-22 28,-16 L28,16 Q28,22 22,22 L-22,22 Q-28,22 -28,16 L-28,-16 Q-28,-22 -22,-22 Z',
            fillLinearGradientStartPoint: { x: -28, y: -22 },
            fillLinearGradientEndPoint: { x: 28, y: 22 },
            fillLinearGradientColorStops: [
                0, '#2a2a2a',
                0.4, '#1a1a1a',
                0.6, '#1a1a1a',
                1, '#333333'
            ],
            stroke: '#555',
            strokeWidth: 1,
            shadowColor: '#000',
            shadowBlur: 8,
            shadowOffset: { x: 3, y: 3 },
            shadowOpacity: 0.25,
        });

        // 平面侧（左侧平面区域，比右侧暗）
        const flatSide = new Konva.Rect({
            x: -28, y: -22, width: 18, height: 44,
            fill: '#0d0d0d',
            stroke: 'transparent',
            strokeWidth: 0,
        });
        // 用裁剪或直接半透明叠加
        flatSide.opacity(0.5);

        // 顶部圆角高光
        const highlight = new Konva.Path({
            data: 'M-18,-20 L18,-20 Q24,-20 24,-16 L24,-10 L-24,-10 L-24,-16 Q-24,-20 -18,-20 Z',
            fill: 'rgba(255,255,255,0.06)',
            stroke: 'transparent',
        });

        // 标记面：丝印文字（模拟印字）
        const markBg = new Konva.Rect({
            x: -18, y: -10, width: 28, height: 16,
            fill: '#1a1a1a',
            cornerRadius: 1,
        });

        const modelText = new Konva.Text({
            x: -17, y: -10, width: 28,
            text: '9013',
            fontSize: 10, fontFamily: 'Arial',
            fill: '#c8c8c8', align: 'center',
        });

        const markBg2 = new Konva.Rect({
            x: -18, y: 0, width: 28, height: 6,
            fill: '#1a1a1a',
            cornerRadius: 1,
        });
        const modelText2 = new Konva.Text({
            x: -17, y: 2, width: 28,
            text: 'NPN',
            fontSize: 10, fontFamily: 'Arial',
            fill: '#c8c8c8', align: 'center',
        });

        // 引脚标注文字（靠近引脚末端）
        const lblStyle = { fontSize: 12, fill: '#c0392b', fontFamily: 'Arial', fontStyle: 'bold' };
        const bLbl = new Konva.Text({ x: 42, y: -13, text: 'B', ...lblStyle });
        const cLbl = new Konva.Text({ x: 14, y: -72, text: 'C', ...lblStyle });
        const eLbl = new Konva.Text({ x: 39, y: 60, text: 'E', ...lblStyle });

        this._staticGroup.add(bLead, cLead, eLead, body, flatSide, highlight,
            markBg, modelText, markBg2, modelText2,
            bLbl, cLbl, eLbl);

        this._testLabels = [bLbl, cLbl, eLbl];
        this._applyTestFlag();
    }

    _applyTestFlag() {
        const nodes = this._testLabels || [];
        nodes.forEach(n => { if (n) n.visible(!this.testFlag); });
    }

    setTestFlag(v) {
        v = !!v;
        if (this.testFlag === v) return;
        this.testFlag = v;
        this._applyTestFlag();
        this._refreshCache();
    }

    getCompanionModel(vB, vC, vE) {
        const isNPN = (this.subType === 'NPN');
        const pol = isNPN ? 1 : -1;
        const beta = this.beta || 100;

        const vbe = (vB - vE) * pol;
        const vce = (vC - vE) * pol;

        const V_ON = this.vbeOn || 0.7;
        const G_ON = 2;
        let gBE = (vbe > V_ON) ? G_ON : 1e-9;
        let iBE = (vbe > V_ON) ? -V_ON * G_ON : 0;

        // BE 开路故障：BE 结始终高阻
        if (this._faultBEOpen) {
            gBE = 1e-12;
            iBE = 0;
        }

        const saturationMultiplier = Math.tanh(Math.max(0, vce) / 0.2);
        const currentBeta = beta * saturationMultiplier;

        const V_SAT = 0.2;
        let gCE_sat = 0;
        if (vbe > V_ON && !this._faultBEOpen) {
            gCE_sat = G_ON * (1 - saturationMultiplier);
        }
        // 反向 vce 保护：仅当 BE 结导通时加强导通，截止时保持真实反向阻断（供指针表反接测量区分 C/E）
        if (vce < 0 && vbe > V_ON) gCE_sat += 100;

        // CE 击穿故障：CE 间始终低阻导通
        if (this._faultCEShort) {
            gCE_sat += 100;
        }

        return {
            internal: { gBE, iBE, beta: currentBeta, gCE_sat, pol, V_SAT }
        };
    }

    getConfigFields() {
        return [
            { label: '器件名称', key: 'id', type: 'text' },
            { label: '放大倍数 (Beta)', key: 'beta', type: 'number' },
            {
                label: '类型', key: 'subType', type: 'select', options: [
                    { label: 'NPN', value: 'NPN' },
                    { label: 'PNP', value: 'PNP' }]
            }];
    }

    onConfigUpdate(newConfig) {
        this.config = newConfig;
        this.id = newConfig.id;
        this.subType = newConfig.subType;
        this.beta = newConfig.beta;
        if (newConfig.testFlag !== undefined) this.testFlag = !!newConfig.testFlag;
        this.initVisuals();
        this.initPorts();
        this._refreshCache();
    }

    destroy() {
        super.destroy?.();
    }
}
