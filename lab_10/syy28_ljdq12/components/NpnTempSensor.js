/**
 * NpnTempSensor.js
 * NPN 型晶体管温度传感器（注释版）
 *
 * 功能概述：
 * - 在电路仿真中作为简单的 NPN 晶体管模型，用于示范基极-发射极电压随温度的变化
 *   并通过 `getCompanionModel` 输出用于电路求解器的等效小信号参数。
 * - 提供视觉表示（Konva 绘图）和界面可配置项（面积比、Vbe0、Beta）。
 *
 * 设计要点：
 * - `areaRatio` (面积比) 用于模拟不同晶体管尺寸导致的 Vbe 偏移。
 * - `getVbeOn()` 根据 `sys.globalTemp` 修正 Vbe 的温度系数与面积相关项。
 * - `getCompanionModel(vB,vC,vE)` 返回一组内部参数：gBE、iBE、beta（考虑饱和修正）、gCE_sat 等，
 *   供电路网表的伴随模型（companion model）使用，便于与线性求解器集成。
 *
 * 注意：注释仅为文档说明，未改变原有逻辑。
 */
import { BaseComponent } from './BaseComponent.js';

export class NpnTempSensor extends BaseComponent {
    /**
     * 构造函数
     * @param {object} config - 组件配置（可包含 areaRatio, vbe0, beta）
     * @param {object} sys - 系统上下文（包含 globalTemp、渲染/重绘方法等）
     *
     * 初始化要点：
     * - 设置类型标识 (`type='bjt'`, `subType='NPN'`) 以便系统识别为晶体管类元件。
     * - `cache='fixed'` 表示可以对静态部分做缓存以提升渲染效率。
     * - 温度相关参数：`vbe0` 为 25°C 时的基极-发射极电压近似值，`vbeTC` 为温度系数（V/°C）。
     */
    constructor(config, sys) {
        super(config, sys);
        this.type = 'bjt';
        this.subType = 'NPN';
        this.cache = 'fixed';

        this._initGroups();
        // 温度传感参数（可由配置覆盖）
        this.areaRatio = config.areaRatio || 1; // 面积比（用于 Vbe 的对数项修正）
        this.vbe0 = config.vbe0 || 0.65; // 25°C 下的典型 Vbe
        this.vbeTC = -0.002; // Vbe 的温度系数 (V/°C)，负值表示随温度升高 Vbe 降低
        this.beta = config.beta || 200; // 直流放大倍数
        this.vceSat = 0.2; // 饱和电压的估计

        this.config = {
            id: this.id,
            areaRatio: this.areaRatio,
            vbe0: this.vbe0,
            beta: this.beta
        };

        // 初始化视觉与端口布局
        this.initVisuals();
        this.initPorts();
    }

    /**
     * 初始化端口
     * - 基极 `b` 在左侧，集电极 `c` 和发射极 `e` 在右上/右下，符合常见符号布局
     */
    initPorts() {
        const s = this.scale;
        this.addPort(-40 * s, 0, 'b', 'wire', 'b');
        this.addPort(20 * s, -40 * s, 'c', 'wire', 'c');
        this.addPort(20 * s, 40 * s, 'e', 'wire', 'e');
    }

    /**
     * 绘制元件的静态视觉部分（仅作展示）
     * - 使用 `_staticGroup` 绘制不会频繁改变的图形：外框、引脚、箭头和面积标签
     */
    initVisuals() {
        this.group.destroyChildren();
        const s = this.scale;
        const stroke = '#000000';
        const sw = 2 * s;

        // 圆形外框表示器件封装
        this._staticGroup.add(new Konva.Circle({
            x: 0, y: 0, radius: 30 * s,
            stroke, strokeWidth: sw, fill: '#ffffff'
        }));

        // 基极竖线（左侧）
        this._staticGroup.add(new Konva.Line({
            points: [-10 * s, -15 * s, -10 * s, 15 * s],
            stroke, strokeWidth: 3 * s
        }));

        // 三个引线（基极/集电极/发射极）
        this._staticGroup.add(new Konva.Line({ points: [-40 * s, 0, -10 * s, 0], stroke, strokeWidth: sw }));
        this._staticGroup.add(new Konva.Line({ points: [-10 * s, -8 * s, 20 * s, -25 * s, 20 * s, -40 * s], stroke, strokeWidth: sw }));
        this._staticGroup.add(new Konva.Line({ points: [-10 * s, 8 * s, 20 * s, 25 * s, 20 * s, 40 * s], stroke, strokeWidth: sw }));

        // NPN 箭头（表示发射极方向）
        this._staticGroup.add(new Konva.Arrow({
            points: [2 * s, 16 * s, 15 * s, 23 * s],
            pointerLength: 8 * s, pointerWidth: 6 * s,
            fill: stroke, stroke: stroke, strokeWidth: 1 * s
        }));

        // 面积比标签（用于区分器件尺寸）
        this.areaLabel = new Konva.Text({
            x: 25 * s, y: -10 * s,
            text: `×${this.areaRatio}`,
            fontSize: 11 * s, fill: '#e74c3c', fontStyle: 'bold'
        });
        this._staticGroup.add(this.areaLabel);
    }

    /**
     * 计算开启时的基极-发射极电压 Vbe_on（考虑温度与面积效应）
     * - 使用热电压 Vt = kT/q；面积比通过对数项修正 Vbe
     * - 若系统中未提供温度（`sys.globalTemp`），返回默认 `vbe0`
     */
    getVbeOn() {
        if (!this.sys || this.sys.globalTemp === undefined) {
            return this.vbe0;
        }
        const T = this.sys.globalTemp; // 摄氏度
        const Vt = 8.617e-5 * (273 + T); // k_B/q * (T_kelvin)
        const areaCorrection = Vt * Math.log(this.areaRatio); // 面积比修正项
        return this.vbe0 + (T - 25) * this.vbeTC - areaCorrection;
    }

    /**
     * 伴随模型（companion model）
     * - 输入：基极/集电极/发射极电压 vB, vC, vE
     * - 通过简单启用判断与饱和修正，输出小信号导纳/电流近似值，供电路求解器使用。
     *
     * 返回对象结构示例：{ internal: { gBE, iBE, beta, gCE_sat, pol, V_SAT } }
     * 字段说明：
     * - gBE: 基-射结的小信号导纳（开启时为 G_ON，否则为很小的漏导纳）
     * - iBE: 基极结的等效偏置电流源项（用于线性化）
     * - beta: 当前有效放大系数（考虑 vce 引起的饱和衰减）
     * - gCE_sat: 饱和时的集电极-发射极导纳修正
     */
    getCompanionModel(vB, vC, vE) {
        const pol = 1;
        const beta = this.beta || 200;

        const vbe = (vB - vE) * pol;
        const vce = (vC - vE) * pol;

        const V_ON = this.getVbeOn();
        const G_ON = 0.01; // 导通时的近似导纳
        const gBE = (vbe > V_ON && vbe > 0) ? G_ON : 1e-9; // 非线性开关：关断时导纳很小
        const iBE = (vbe > V_ON && vbe > 0) ? -V_ON * G_ON : 0; // 线性化电流源项

        // 简单的饱和修正：vce 越小，beta 越衰减；使用 tanh 平滑过渡
        const saturationMultiplier = Math.tanh(Math.max(0, vce) / 0.2);
        const currentBeta = beta * saturationMultiplier;

        let gCE_sat = 0;
        if (vbe > V_ON) {
            gCE_sat = G_ON * (1 - saturationMultiplier);
        }
        if (vce < 0 && vbe > V_ON) gCE_sat += 100; // 反向 vce 且 BE 导通时增强导通，截止时保持反向阻断

        return {
            internal: { gBE, iBE, beta: currentBeta, gCE_sat, pol, V_SAT: 0.2 }
        };
    }

    /**
     * 返回用于配置面板显示的字段描述
     */
    getConfigFields() {
        return [
            { label: '器件名称', key: 'id', type: 'text' },
            { label: '面积比', key: 'areaRatio', type: 'select', options: [
                { label: '1 (Q1)', value: 1 },
                { label: '8 (Q2)', value: 8 }
            ]},
            { label: 'Vbe0 @25°C (V)', key: 'vbe0', type: 'number' },
            { label: '放大倍数 Beta', key: 'beta', type: 'number' }
        ];
    }

    /**
     * 当用户在配置面板更新参数时调用
     * - 将配置应用到组件并刷新视觉与端口
     */
    onConfigUpdate(newConfig) {
        this.config = newConfig;
        this.id = newConfig.id;
        this.areaRatio = parseInt(newConfig.areaRatio) || 1;
        this.vbe0 = parseFloat(newConfig.vbe0) || 0.65;
        this.beta = parseInt(newConfig.beta) || 200;
        this.initVisuals();
        this.initPorts();
        this._refreshCache();
    }


    destroy() {
        super.destroy?.();
    }
}
