import { BaseComponent } from './BaseComponent.js';

/**
 * N沟道 JFET（结型场效应晶体管）仿真组件
 *
 * 引脚定义：
 *   G (Gate)   — 栅极，左侧
 *   D (Drain)  — 漏极，上侧
 *   S (Source) — 源极，下侧
 *
 * 直流模型（Shockley 方程，夹断区 + 恒流区）：
 *   夹断条件：Vgs <= Vp（Vp < 0）
 *     Id = 0
 *   线性区（Vds < Vgs - Vp）：
 *     Id = Idss * [2*(Vgs/Vp - 1)*Vds/Vp - (Vds/Vp)^2]   （近似简化）
 *   饱和区（Vds >= Vgs - Vp）：
 *     Id = Idss * (1 - Vgs/Vp)^2
 */
export class NJFET extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        this.type  = 'njfet';
        this.positionType = 'fixed';

        // ---- 器件参数 ----
        /** 零偏漏极饱和电流 (A)，Vgs=0 时 */
        this.Idss = config.Idss ?? 10e-3;   // 默认 10 mA
        /** 夹断电压 (V)，N沟道为负值，如 -4 V */
        this.Vp   = config.Vp   ?? -4.0;
        /** 沟道调制系数 λ (1/V)，0 表示忽略 */
        this.lambda = config.lambda ?? 0;

        this.initPorts();
        this.initVisuals();
    }

    // ------------------------------------------------------------------
    // 端口布局
    // ------------------------------------------------------------------
    initPorts() {
        // 栅极 G — 左侧水平引出
        this.addPort(-40, 0,   'l', 'wire', 'g');
        // 漏极 D — 上方垂直引出
        this.addPort(0,  -40,  'u', 'wire', 'd');
        // 源极 S — 下方垂直引出
        this.addPort(0,   40,  'd', 'wire', 's');
    }

    // ------------------------------------------------------------------
    // Konva 图形（参照原理图符号绘制）
    // ------------------------------------------------------------------
    initVisuals() {
        const stroke = '#000000';
        const sw     = 2;       // strokeWidth

        /* ① 外圆 */
        this.group.add(new Konva.Circle({
            x: 0, y: 0, radius: 28,
            stroke, strokeWidth: sw,
            fill: '#ffffff'
        }));

        /* ② 栅极水平引线：左边缘 → 圆内竖线左侧 */
        this.group.add(new Konva.Line({
            points: [-40, 0, -12, 0],
            stroke, strokeWidth: sw
        }));

        /* ③ 沟道竖线（源-漏方向，x=0 处） */
        this.group.add(new Konva.Line({
            points: [0, -20, 0, 20],
            stroke, strokeWidth: sw + 1
        }));

        /* ④ 漏极水平短横线（连接竖线与漏极引线） */
        this.group.add(new Konva.Line({
            points: [0, -12, 0, -12],   // 仅占位；下面用折线表达
            stroke, strokeWidth: sw
        }));
        // 漏极连接线：沟道 → 上引出
        this.group.add(new Konva.Line({
            points: [-8, -12, 0, -12, 0, -40],
            stroke, strokeWidth: sw
        }));

        /* ⑤ 源极连接线：沟道 → 下引出 */
        this.group.add(new Konva.Line({
            points: [-8, 12, 0, 12, 0, 40],
            stroke, strokeWidth: sw
        }));

        /* ⑥ 栅极水平短横（接触沟道左侧，表示栅控） */
        this.group.add(new Konva.Line({
            points: [-12, -18, -12, 18],
            stroke, strokeWidth: sw
        }));

        /* ⑦ N沟道箭头：从栅极指向沟道（→ 方向，表示 N 沟道） */
        // 箭头尖端在 x=-8，y=0 处，水平向右
        const arrowLen = 10;
        const arrowHalf = 5;
        this.group.add(new Konva.Line({
            points: [
                -12, 0,
                -8,  0
            ],
            stroke, strokeWidth: sw
        }));
        this.group.add(new Konva.Line({
            points: [
                -8 - arrowLen, -arrowHalf,
                -8,             0,
                -8 - arrowLen,  arrowHalf
            ],
            closed: false,
            fill: stroke,
            stroke, strokeWidth: sw
        }));

        /* ⑧ 标注文字 */
        const labelStyle = { fontSize: 11, fill: '#333333', fontFamily: 'Arial' };
        this.group.add(new Konva.Text({ x: -52, y: -8,  text: 'G', ...labelStyle }));
        this.group.add(new Konva.Text({ x:   6, y: -38, text: 'D', ...labelStyle }));
        this.group.add(new Konva.Text({ x:   6, y:  28, text: 'S', ...labelStyle }));
    }

    // ------------------------------------------------------------------
    // 直流工作点求解（供仿真引擎调用）
    // 返回 { Id } — 流经漏-源的电流 (A)
    // ------------------------------------------------------------------
    /**
     * @param {number} Vgs  栅-源电压 (V)
     * @param {number} Vds  漏-源电压 (V)
     * @returns {number}    漏极电流 Id (A)，定义为从 D 流向 S
     */
    calcId(Vgs, Vds) {
        const { Idss, Vp, lambda } = this;

        // 夹断区
        if (Vgs <= Vp) return 0;

        const Vov = Vgs - Vp;   // 过驱动电压（Vov > 0 for N-ch JFET in active）

        // 线性区（可变电阻区）
        if (Vds < Vov) {
            return Idss / (Vp * Vp) * (2 * (Vgs - Vp) * Vds - Vds * Vds)
                   * (1 + lambda * Vds);
        }

        // 饱和区（恒流区）
        return Idss * Math.pow(1 - Vgs / Vp, 2) * (1 + lambda * Vds);
    }

    /**
     * 仿真引擎调用接口：给定各节点电位，返回各端口电流贡献。
     * 约定正方向：电流流入端口为正。
     *
     * @param {{ g: number, d: number, s: number }} voltages  各端口节点电压
     * @returns {{ g: number, d: number, s: number }}          各端口电流 (A)
     */
    solve(voltages) {
        const Vgs = voltages.g - voltages.s;
        const Vds = voltages.d - voltages.s;

        const Id = this.calcId(Vgs, Vds);

        return {
            g:  0,    // 栅极无直流电流（JFET 栅极反偏结，近似为 0）
            d: -Id,   // 漏极电流流出节点（贡献为负）
            s:  Id    // 源极电流流入节点
        };
    }

    // ------------------------------------------------------------------
    // 配置面板字段
    // ------------------------------------------------------------------
    getConfigFields() {
        return [
            { label: '器件名称',             key: 'id',     type: 'text'   },
            { label: '饱和电流 Idss (A)',    key: 'Idss',   type: 'number' },
            { label: '夹断电压 Vp (V)',      key: 'Vp',     type: 'number' },
            { label: '沟道调制系数 λ (1/V)', key: 'lambda', type: 'number' }
        ];
    }
}