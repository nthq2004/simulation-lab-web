import { MarineMainsSwitch } from './MarineMainsSwitch.js';

/**
 * EmergencyMainsSwitch 应急发电机主开关（框架式空气断路器）
 *
 * 基于 MarineMainsSwitch（船用发电机主开关），仅保留左侧操作面板，
 * 删除右侧机械原理图界面与电子脱扣器（ET1/ET2）。
 * 端口布局（260×320）：
 *   上方 3 口：L1 / L2 / L3（主回路进线）
 *   下方 3 口：T1 / T2 / T3（主回路出线）
 *   左侧 8 口：m1/m2（储能电机）、c1/c2（合闸线圈）、uv1/uv2（失压）、fla/flb（分励）
 *   右侧 4 口：no1/no2（常开）、nc1/nc2（常闭）辅助触点
 *   电子脱扣器 ET1/ET2：删除
 *
 * 复用父类全部逻辑（储能/合闸/分闸/失压/分励/逆功率/简化保护），
 * 仅覆写绘制、动态节点、端口布局与交互热区。
 */
export class EmergencyMainsSwitch extends MarineMainsSwitch {
    constructor(config, sys) {
        super({ ...config, width: 260, height: 320 }, sys);
        // 父类按"船用发电机主开关"布局添加了端口（含 ET），
        // 清理后按应急发电机主开关布局重新添加。
        this.ports.forEach(p => {
            try { if (p && p.node && typeof p.node.destroy === 'function') p.node.destroy(); } catch (e) { /* ignore */ }
        });
        this.ports = [];
        this._addPorts();
    }

    // ═══════════════════════════════════════════
    // 几何：尺寸 + 端口布局（覆盖父类右侧布局）
    // ═══════════════════════════════════════════

    _recalcGeometry() {
        super._recalcGeometry();

        this.width  = 185; // 仅保留操作面板(150) + 右侧辅助端口带(35)，删掉原右侧原理图空白
        this.height = 320;
        this._divX  = 150; // 左操作面板宽度

        // 主回路端口（顶 L / 底 T 共用 x，面板内对称分布，间距 50）
        this._staticXs = [45, 95, 145];

        // 电子脱扣器端口删除
        this._etPortXs = [];

        // 左侧 8 控制端口（沿左边界垂直排列）
        this._portRightX = 0;
        this._controlPorts = [
            ['m1', 44],  ['m2', 80],
            ['c1', 116], ['c2', 152],
            ['uv1', 188], ['uv2', 224],
            ['fla', 260], ['flb', 296],
        ];
        this._controlLabels = { m: '储能电机', c: '合闸线圈', uv: '失压', fl: '分励' };

        // 右侧辅助触点（常开/常闭）：三元组 [id, x 占位, y]，整体下移
        this._auxPorts = [
            ['no1', 0, 80],  ['no2', 0, 130],
            ['nc1', 0, 200], ['nc2', 0, 250],
        ];
    }

    // ═══════════════════════════════════════════
    // 端口（构造中清理父类端口后调用）
    // ═══════════════════════════════════════════

    _addPorts() {
        // 上方 L1/L2/L3（主回路进线）
        ['l1', 'l2', 'l3'].forEach((nm, i) => {
            this.addPort(this._staticXs[i], 2, nm, 'wire');
        });
        // 下方 T1/T2/T3（主回路出线）
        ['t1', 't2', 't3'].forEach((nm, i) => {
            this.addPort(this._staticXs[i], this.height - 2, nm, 'wire', 'p');
        });
        // 左侧 8 控制端口（储能电机 / 合闸线圈 / 失压 / 分励）
        this._controlPorts.forEach(([id, y], i) => {
            this.addPort(0, y, id, 'wire', i % 2 ? null : 'p');
        });
        // 右侧辅助触点（常开 no1/no2、常闭 nc1/nc2）
        this._auxPorts.forEach(([id, , y]) => {
            this.addPort(this.width, y, id, 'wire');
        });
    }

    // ═══════════════════════════════════════════
    // 静态绘制（仅左侧操作面板 + 端子标签）
    // ═══════════════════════════════════════════

    _drawStaticParts() {
        this._drawFrame();
        this._drawNameplate();
        this._drawIndicatorBoxes();
        this._drawButtons();
        this._drawAuxContactsStatic();
        this._drawTerminalLabels();
    }

    /** 右侧辅助触点静态部分（竖着形式）：上下静触头圆点 + 端口直角引线
     *  （上端口→上静触头、下端口→下静触头，垂直排列；触头臂缩短，多出长度画引线） */
    _drawAuxContactsStatic() {
        const s = this._staticGroup;
        const W = this.width;
        const sx = W - 14; // 静触点 x（右侧带内）
        // 每组触点：y1=上端口、y2=下端口；静触头间距 30（刀片长），中点居中，上下各留 10px 引线
        const mk = (y1, y2, color) => {
            const yMid = (y1 + y2) / 2;
            const top = yMid - 15, bot = yMid + 15;
            // 上静触头（小圆点）
            s.add(new Konva.Circle({ x: sx, y: top, radius: 4, fill: color, stroke: '#908030', strokeWidth: 0.8 }));
            // 下静触头（小圆点）
            s.add(new Konva.Circle({ x: sx, y: bot, radius: 4, fill: color, stroke: '#908030', strokeWidth: 0.8 }));
            // 端口引线：上端口 → 上静触头（水平后垂直）；下端口 → 下静触头（水平后垂直）
            s.add(new Konva.Line({ points: [W, y1, sx, y1, sx, top], stroke: color, strokeWidth: 2, lineJoin: 'round' }));
            s.add(new Konva.Line({ points: [W, y2, sx, y2, sx, bot], stroke: color, strokeWidth: 2, lineJoin: 'round' }));
        };
        // NO 常开（no1=80 / no2=130）
        mk(80, 130, '#20a030');
        // NC 常闭（nc1=200 / nc2=250）
        mk(200, 250, '#e03030');
    }

    _drawFrame() {
        const f = { x: 2, y: 2, w: this.width - 4, h: this.height - 4 };
        // 整体框架
        this._staticGroup.add(new Konva.Rect({
            x: f.x, y: f.y, width: f.w, height: f.h,
            fill: '#eef1f8', stroke: '#b0a698', strokeWidth: 1.5, cornerRadius: 6,
        }));
        // 左操作面板
        this._staticGroup.add(new Konva.Rect({
            x: 2, y: 2, width: this._divX - 4, height: f.h - 4,
            fill: '#dfe3ef', cornerRadius: [6, 0, 0, 6],
        }));
        // 分隔线
        this._staticGroup.add(new Konva.Line({
            points: [this._divX, 8, this._divX, this.height - 8],
            stroke: '#8898b0', strokeWidth: 1.5, dash: [5, 3],
        }));
    }

    _drawNameplate() {
        this._staticGroup.add(new Konva.Rect({
            x: 8, y: 5, width: this._divX - 16, height: 24, fill: '#3a4a5a', cornerRadius: 3,
        }));
        this._staticGroup.add(new Konva.Text({
            x: 8, y: 8, width: this._divX - 16, align: 'center',
            text: '应急发电机主开关', fontSize: 15, fontStyle: 'bold', fill: '#f0f4f8',
        }));
    }

    /** 端子标签：顶部 L1/L2/L3、底部 T1/T2/T3、右侧常开/常闭 */
    _drawTerminalLabels() {
        const colors = ['#e03030', '#20a030', '#2050e0'];
        // 顶部进线 L 标签
        this._staticXs.forEach((x, i) => {
            this._staticGroup.add(new Konva.Text({
                x: x - 14, y: 4, width: 28, align: 'center',
                text: ['L1', 'L2', 'L3'][i], fontSize: 13, fontStyle: 'bold', fill: colors[i],
            }));
            // 底部出线 T 标签
            this._staticGroup.add(new Konva.Text({
                x: x - 14, y: this.height - 18, width: 28, align: 'center',
                text: ['T1', 'T2', 'T3'][i], fontSize: 13, fontStyle: 'bold', fill: colors[i],
            }));
        });
        // 右侧辅助触点标签（常开在上、常闭在下，竖排于静触点左侧）
        this._staticGroup.add(new Konva.Text({ x: this.width - 52, y: 94, text: '常', fontSize: 11, fontStyle: 'bold', fill: '#f40404' }));
        this._staticGroup.add(new Konva.Text({ x: this.width - 52, y: 105, text: '开', fontSize: 11, fontStyle: 'bold', fill: '#f40404' }));
        this._staticGroup.add(new Konva.Text({ x: this.width - 52, y: 214, text: '常', fontSize: 11, fontStyle: 'bold', fill: '#f40404' }));
        this._staticGroup.add(new Konva.Text({ x: this.width - 52, y: 225, text: '闭', fontSize: 11, fontStyle: 'bold', fill: '#f40404' }));
    }

    // ═══════════════════════════════════════════
    // 动态节点（仅左侧操作界面：指示灯/储能手柄/工作位刻度盘）
    // ═══════════════════════════════════════════

    _createDynamicNodes() {
        this._createIndicators(); // 合/分闸 + 储能指示（父类方法，位于左面板内）
        this._createHandle();     // 储能手柄（父类方法）
        this._createDial();       // 工作位刻度盘（父类方法）
        this._createAuxContacts(); // 右侧 NO/NC 辅助触点触桥
    }

    /** 右侧辅助触点动态触桥（竖着形式）：原点在下静触头，垂直向上延伸（短臂 30px）；
     *  刀片线 + 金色动触点半圆；随主开关状态开合 */
    _createAuxContacts() {
        const sx = this.width - 14; // 静触点 x
        const mkBlade = (yBase, len) => {
            const g = new Konva.Group({ x: sx, y: yBase, rotation: 0, listening: false });
            g.add(new Konva.Line({ points: [0, 0, 0, -len], stroke: '#e03030', strokeWidth: 2.5, lineCap: 'round' }));
            g.add(new Konva.Arc({ x: 0, y: -len, innerRadius: 0, outerRadius: 4, angle: 180, rotation: -90, fill: '#e8c86a', stroke: '#e03030', strokeWidth: 1.5 }));
            this._dynamicGroup.add(g);
            return g;
        };
        // NO 常开：no1(80)/no2(130)，刀片绕下静触头 (sx,120) 垂直向上（长 30）—— 分闸左偏、合闸闭合
        this._noBridge = mkBlade(120, 30);
        // NC 常闭：nc1(200)/nc2(250)，刀片绕下静触头 (sx,240) 垂直向上（长 30）—— 分闸闭合、合闸左偏断开
        this._ncBridge = mkBlade(240, 30);
    }

    // ═══════════════════════════════════════════
    // 动态更新（仅左侧节点；右侧机械节点已删除）
    // ═══════════════════════════════════════════

    _updateDynamic() {
        const closed = this._state === 'on';

        // 辅助触点（竖着、向左偏转）：
        //   NO 常开：分闸初始左偏（-25°）、合闸向右摆回垂直闭合（0°）
        //   NC 常闭：分闸垂直闭合（0°）、合闸向左偏断开（-25°）
        if (this._noBridge) this._noBridge.rotation(closed ? 0 : -25);
        if (this._ncBridge) this._ncBridge.rotation(closed ? -25 : 0);

        // 指示牌
        this._onOffText.text(closed ? '合闸 ON' : '分闸 OFF');
        this._onOffText.fill(closed ? '#1b8a1b' : '#c0392b');
        this._storeIcon.visible(true);
        this._storeSlash.visible(!(this._chargeProg >= 5));

        // 工作位圆盘（合闸时灰化）
        this._dialGroup.rotation(this._dialCur);
        this._dialGroup.opacity(closed ? 0.45 : 1);
        this._workPosText.text(this._workPosName());

        // 储能手柄
        this._handleGroup.rotation(this._handleRot);
    }

    // ═══════════════════════════════════════════
    // 部件识别热区
    // ═══════════════════════════════════════════
    // 注意：父类操作交互（合闸/分闸按钮、储能手柄、工作位刻度盘）的 hit 区域
    // 已由 _bindInteraction 创建。此处**不再添加任何热区**——addClickablePart
    // 的热区 hit 监听 click tap 且 cancelBubble，且 z 序位于交互层最上，
    // 会拦截按钮/手柄/刻度盘的同名点击事件（储能手柄用 mousedown 不受影响，
    // 但合闸按钮的 click 会被吞掉导致"储好能量却合不了闸"）。
    _createClickableParts() {
        // 空实现：不添加部件热区，保证操作面板交互正常
    }
}
