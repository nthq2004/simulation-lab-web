import { BaseComponent } from './BaseComponent.js';

/**
 * N沟道 JFET — 开关模型
 *
 * 引脚：
 *   G (Gate)   — 栅极，左侧
 *   D (Drain)  — 漏极，上侧
 *   S (Source) — 源极，下侧
 *
 * 开关判断（N沟道 JFET，耗尽型）：
 *   导通：Vgs > Vth（默认 Vth = -2 V）
 *     DS 等效电阻 rOn  = 10 Ω
 *   截止：Vgs <= Vth
 *     DS 等效电阻 rOff = 10 MΩ
 *
 * 栅极电流始终为 0。
 */
export class JFET extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        this.type         = 'njfet';
        this.positionType = 'fixed';

        // ---- 开关模型参数 ----
        /** 开启阈值电压 (V)；N沟道 JFET 耗尽型，典型值为负数 */
        this.Vth  = config.Vth  ?? -2.0;
        /** 导通电阻 (Ω) */
        this.rOn  = config.rOn  ?? 10;
        /** 截止电阻 (Ω) */
        this.rOff = config.rOff ?? 10e6;

        this.initPorts();
        this.initVisuals();
    }

    // ------------------------------------------------------------------
    // 端口
    // ------------------------------------------------------------------
    initPorts() {
        this.addPort(-40,  0, 'g', 'wire', 'p');   // 栅极 G
        this.addPort(  0, -40, 'd', 'wire', );  // 漏极 D
        this.addPort(  0,  40, 's', 'wire', );  // 源极 S
    }

    // ------------------------------------------------------------------
    // Konva 图形
    // ------------------------------------------------------------------
    initVisuals() {
        const stroke = '#000000';
        const sw = 3;

        // 外圆
        this.group.add(new Konva.Circle({
            x: 0, y: 0, radius: 28,
            stroke, strokeWidth: sw, fill: '#ffffff'
        }));

        // 栅极引线
        this.group.add(new Konva.Line({
            points: [-40, 0, -12, 0],
            stroke, strokeWidth: sw
        }));

        // 沟道竖线（D–S）
        // this.group.add(new Konva.Line({
        //     points: [0, -20, 0, 20],
        //     stroke, strokeWidth: sw + 1
        // }));

        // 漏极折线：沟道 → 上引出
        this.group.add(new Konva.Line({
            points: [-12, -12, 0, -12, 0, -40],
            stroke, strokeWidth: sw
        }));

        // 源极折线：沟道 → 下引出
        this.group.add(new Konva.Line({
            points: [-12, 12, 0, 12, 0, 40],
            stroke, strokeWidth: sw
        }));

        // 栅控竖线
        this.group.add(new Konva.Line({
            points: [-12, -18, -12, 18],
            stroke, strokeWidth: sw
        }));

        // N沟道箭头（→ 指向沟道）
        this.group.add(new Konva.Line({
            points: [-20, -5, -12, 0, -20, 5],
            closed: false,
            stroke, strokeWidth: sw
        }));

        // 端口标注
        const lbl = { fontSize: 11, fill: '#333333', fontFamily: 'Arial' };
        this.group.add(new Konva.Text({ x: -45, y:  -18, text: 'G', ...lbl }));
        this.group.add(new Konva.Text({ x:   8, y: -45, text: 'D', ...lbl }));
        this.group.add(new Konva.Text({ x:   8, y:  35, text: 'S', ...lbl }));
    }

    // ------------------------------------------------------------------
    // 仿真求解
    // ------------------------------------------------------------------
    /**
     * 根据 Vgs 判断开关状态，返回 DS 等效电阻。
     * @param {number} Vgs
     * @returns {number} 等效电阻 (Ω)
     */
    getDSResistance(Vgs) {
        return Vgs > this.Vth ? this.rOn : this.rOff;
    }

    // ------------------------------------------------------------------
    // 配置面板
    // ------------------------------------------------------------------
    getConfigFields() {
        return [
            { label: '器件名称',          key: 'id',   type: 'text'   },
            { label: '开启阈值 Vth (V)',  key: 'Vth',  type: 'number' },
            { label: '导通电阻 rOn (Ω)',  key: 'rOn',  type: 'number' },
            { label: '截止电阻 rOff (Ω)', key: 'rOff', type: 'number' }
        ];
    }
}