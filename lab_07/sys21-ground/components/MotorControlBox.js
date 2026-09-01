import { BaseComponent } from './BaseComponent.js';
import imgAcb from '../images/acb01.jpg';
import imgAcbClose from '../images/acb01-close.jpg';
import imgFuse from '../images/fuse01.jpg';
import imgContr from '../images/contact01.jpg';
import imgContrClose from '../images/contact01-close.jpg';
import imgStart from '../images/start01.jpg';
import imgFr from '../images/fr01.jpg';
import imgStop from '../images/stop01.jpg';

/**
 * MotorControlBox 电机控制箱（带三维透视外观的打开状态）
 * 尺寸 790×591，纯视觉展示组件。
 *
 * 整体呈"打开一半的柜体"样貌：
 *  - 左上：塑壳断路器（供电开关 QF，参照岸电主开关塑壳样式），下端 3 接线柱各引线 3合1 成黑色电缆
 *  - 中央：安装面板，3×2 设备格（空气开关/保险丝/停止按钮/接触器/热继电器/起动按钮）
 *  - 面板下部：左右两组接线端子（左组电源进线/右组出线，各上下两排 3 柱）+ 右侧 PE 端子组（4 个紧密端子）
 *  - 黑色电缆沿底部伸入，三相火线分接左组下排接线端子
 *  - 右侧：打开一半的门（平行四边形透视模拟三维），靠近下方有保护接地（PE）接线柱
 *
 * 12 个接线端子均为电气端口并参与电路求解（QF 合上时左组下排为 220V 三相电源；
 * 接触器吸合且空气开关闭合时左入口与右上出线同簇）。
 * PE 端子组 4 端口同簇，并与箱体 PE 设备点、门 PE 接线柱经黄绿导线连通。
 * 各设备格、塑壳断路器、PE 接线柱均通过 addClickablePart 注册，
 * 供工作流 find 步骤（考核点击识别设备）使用。
 */

const COMP_W = 790;
const COMP_H = 591;

// 箱体外框（含 3D 顶部斜角偏移）
const BOX = { x: 8, y: 14, w: 774, h: 569 };
const DX = 10, DY = -12;

// 塑壳断路器（供电开关 QF）区域
const QF_X = 22;
const QF_Y = 168;
const QF_W = 106;
const QF_H = 252;

// 中央安装面板
const P_X = 130;
const P_Y = 40;
const P_W = 440;
const P_H = 521;

const TITLE_H = 30;
const CELL_W = 128;
const CELL_H = 170;
const COL_GAP = 7;
const DUCT_H = 20;

// 3×2 格子（行优先）：1 空气开关 2 保险丝 3 停止按钮 / 4 接触器 5 热继电器 6 起动按钮
const CELL_IMAGES = {
    1: imgAcb,
    2: imgFuse,
    3: imgStop,
    4: imgContr,
    5: imgFr,
    6: imgStart,
};
const PART_IDS = {
    1: 'cell-acb',
    2: 'cell-fuse',
    3: 'cell-stop',
    4: 'cell-contr',
    5: 'cell-fr',
    6: 'cell-start',
};
const CELL_NAMES = {
    1: '空气开关', 2: '保险丝', 3: '停止按钮',
    4: '接触器', 5: '热继电器', 6: '起动按钮',
};

// 接线端子区（左右两组 + PE 组）
// 左组=电源进线（上排经槽接空气开关，下排接黑电缆三相）；右组=出线（上排经热继电器槽来，下排对外引出）
const TERM_L_XS = [176, 228, 280];   // 左组三柱 x（间距收窄）
const TERM_R_XS = [324, 376, 428];   // 右组三柱 x（间距收窄）
const TERM_UP_Y = 505;               // 上排 y
const TERM_LOW_Y = 535;              // 下排 y
const TERM_Z_Y = 470;                // 端子区背景顶部
const TERM_Z_H = 91;                 // 端子区高度

// PE 端子组：一排紧密连接的 4 个接线端子（电气端口，4 端口同簇）
const TERM_PE_XS = [468, 492, 516, 540];  // 4 柱 x（紧密连接）
const TERM_PE_Y = 520;                    // PE 组 y（上下两排之间）

// 箱体 PE 设备点（箱体下方）与门 PE 点位置（门 PE 由 _drawDoor 计算）
const PE_BODY_X = 492;
const PE_BODY_Y = COMP_H - 12;

// 右门（打开一半）几何
const DOOR_HINGE_X = 578;
const DOOR_PROJ_W = 203;
const DOOR_TY = 48;
const DOOR_BY = 561;

// 断路器手柄槽/位置（on 上 / off 下 / trip 中间脱扣位）
const QF_HANDLE_OFF = { on: -30, off: 30, trip: 0 };

export class MotorControlBox extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(400, config.width  || COMP_W);
        this.height = Math.max(400, config.height || COMP_H);

        this.type  = 'motor_control_box';
        this.cache = 'fixed';

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        this.config = {
            id: this.id,
            label: this.label,
        };

        this._addPorts();
    }

    // ══════════════════════════════════════════════
    // 几何计算
    // ══════════════════════════════════════════════

    _recalcGeometry() {
        // 格列：自面板左内边开始（左竖槽之后）
        this._cols = [
            P_X + 30,
            P_X + 30 + CELL_W + COL_GAP,
            P_X + 30 + 2 * (CELL_W + COL_GAP),
        ];
        // 行：y=68 / 258（行间含一条 20 高水平走线槽）
        this._rows = [68, 68 + CELL_H + DUCT_H];

        this._cells = {};
        for (let n = 1; n <= 6; n++) {
            const r = Math.floor((n - 1) / 3);
            const c = (n - 1) % 3;
            this._cells[n] = { x: this._cols[c], y: this._rows[r], w: CELL_W, h: CELL_H };
        }

        // 左竖槽：贯通面板
        this._leftDuct = { x: P_X + 4, y: 68, w: 22, h: P_H - 40 };

        // 两条水平槽：行1下、行2下
        this._ducts = [
            { x: P_X + 28, y: this._rows[0] + CELL_H, w: P_W - 30, h: DUCT_H },
            { x: P_X + 28, y: this._rows[1] + CELL_H, w: P_W - 30, h: DUCT_H },
        ];

        // 断路器端子位置
        this._qfCx = QF_X + QF_W * 0.5;
        this._qfInXs  = [QF_X + 14, this._qfCx, QF_X + QF_W - 14];
        this._qfOutXs = [QF_X + 14, this._qfCx, QF_X + QF_W - 14];
        this._qfInTop  = QF_Y + 10;
        this._qfOutBot = QF_Y + QF_H - 8;

        // 门板平行四边形（透视打开三分之二）
        this._doorPts = [
            DOOR_HINGE_X, DOOR_TY,
            DOOR_HINGE_X, DOOR_BY,
            DOOR_HINGE_X + DOOR_PROJ_W, DOOR_BY + 12,
            DOOR_HINGE_X + DOOR_PROJ_W, DOOR_TY - 12,
        ];
    }

    // ══════════════════════════════════════════════
    // 参数初始化
    // ══════════════════════════════════════════════

    _initParameters(config) {
        this.label = config.label || '电机控制箱（打开状态）';
        this._qfState = (config.initQfState || 'on').toLowerCase() === 'on' ? 'on' : 'off';
    }

    /**
     * 电气端口（16 个）：
     *  左组下排 in1/in2/in3  电源进线（QF 合上时 220V 三相）
     *  左组上排 inU/inV/inW  空气开关入口（与下排一一对应内部同簇）
     *  右组上排 outU/outV/outW 热继电器出线（接触器吸合时与左边入口同簇）
     *  右组下排 out1/out2/out3 对外引出（与上排一一对应内部同簇）
     *  PE 组 pe1/pe2/pe3/pe4  保护接地端子（4 端口同簇）
     *  pe_body（箱体 PE 设备点）、pe_door（门 PE 接线柱）与 PE 组同簇
     */
    _addPorts() {
        TERM_L_XS.forEach((tx, i) => {
            this.addPort(tx, TERM_LOW_Y, ['in1', 'in2', 'in3'][i], 'wire');
        });
        TERM_L_XS.forEach((tx, i) => {
            this.addPort(tx, TERM_UP_Y, ['inU', 'inV', 'inW'][i], 'wire');
        });
        TERM_R_XS.forEach((tx, i) => {
            this.addPort(tx, TERM_UP_Y, ['outU', 'outV', 'outW'][i], 'wire');
        });
        TERM_R_XS.forEach((tx, i) => {
            this.addPort(tx, TERM_LOW_Y, ['out1', 'out2', 'out3'][i], 'wire');
        });
        // PE 端子组（4 端口）
        TERM_PE_XS.forEach((tx, i) => {
            this.addPort(tx, TERM_PE_Y, ['pe1', 'pe2', 'pe3', 'pe4'][i], 'wire');
        });
        // 箱体 PE 设备点（箱体下方）
        this.addPort(PE_BODY_X, PE_BODY_Y, 'pe_body', 'wire');
        // 门 PE 接线柱（电气端口，与 PE 组同簇）
        if (this._pe) {
            this.addPort(this._pe.x, this._pe.y, 'pe_door', 'wire');
        }
        // 内部中性点 n（三相电源注入参考；未接线时钳位到地）
        this.addPort(this._qfCx, QF_Y + QF_H + 14, 'n', 'wire', null, 0.25);
    }

    // ══════════════════════════════════════════════
    // 初始化
    // ══════════════════════════════════════════════

    _init() {
        this._drawStaticParts();
        this._createImageCells();
        this._createDynamicNodes();
        this._addClickableParts();
    }

    // ══════════════════════════════════════════════
    // 静态部件
    // ══════════════════════════════════════════════

    _drawStaticParts() {
        this._drawCabinet3D();
        this._drawBreakerStatic();
        this._drawPanelStatic();
        this._drawCable();
        this._drawDoor();
        this._drawPEConnections();
    }

    /**
     * 柜体三维外壳：外框 + 顶部斜角 + 内部深色底（断路器区 / 门区露出的内壁）
     */
    _drawCabinet3D() {
        const s = this._staticGroup;
        // 外框（最外深色描边）
        s.add(new Konva.Rect({
            x: BOX.x, y: BOX.y, width: BOX.w, height: BOX.h,
            fill: '#cfd4da', stroke: '#4a5258', strokeWidth: 2, cornerRadius: 4,
        }));
        // 顶部 3D 斜角面
        s.add(new Konva.Line({
            points: [
                BOX.x, BOX.y,
                BOX.x + BOX.w, BOX.y,
                BOX.x + BOX.w + DX, BOX.y + DY,
                BOX.x + DX, BOX.y + DY,
            ],
            closed: true, fill: '#aab0b6', stroke: '#8a9096', strokeWidth: 1, listening: false,
        }));
        // 顶部高光
        s.add(new Konva.Line({
            points: [BOX.x + 2, BOX.y + 2, BOX.x + BOX.w - 2, BOX.y + 2],
            stroke: 'rgba(255,255,255,0.45)', strokeWidth: 2, listening: false,
        }));
        // 内部背景（箱体后壁浅灰）
        s.add(new Konva.Rect({
            x: BOX.x + 4, y: BOX.y + 4, width: BOX.w - 8, height: BOX.h - 8,
            fill: '#b8bec4', stroke: '#6a7076', strokeWidth: 1,
        }));
        // 左侧断路器区底衬（深色衬条，突出柜内安装条）
        s.add(new Konva.Rect({
            x: BOX.x + 8, y: QF_Y - 60, width: QF_X + QF_W + 18, height: QF_H + 120,
            fill: '#4c555c', stroke: '#333a40', strokeWidth: 1, cornerRadius: 3,
        }));
    }

    /**
     * 塑壳断路器（参照岸电主开关塑壳样式）：3D 外壳 + 面板 + 手柄槽 + 上下端子 + 铭牌
     */
    _drawBreakerStatic() {
        const s = this._staticGroup;
        const x = QF_X, y = QF_Y, w = QF_W, h = QF_H;
        // 壳体 3D：侧面 + 顶面
        s.add(new Konva.Line({
            points: [x + w, y, x + w + 7, y - 7, x + w + 7, y + h - 7, x + w, y + h],
            closed: true, fill: '#7a848c', stroke: '#5c656c', strokeWidth: 1, listening: false,
        }));
        s.add(new Konva.Line({
            points: [x, y, x + 7, y - 7, x + w + 7, y - 7, x + w, y],
            closed: true, fill: '#9aa4ac', stroke: '#79828a', strokeWidth: 1, listening: false,
        }));
        // 正面壳体（塑壳蓝色）
        s.add(new Konva.Rect({
            x, y, width: w, height: h,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint: { x: w, y: 0 },
            fillLinearGradientColorStops: [0, '#2a5a8a', 0.5, '#3a7ab8', 1, '#2a5a8a'],
            stroke: '#1c3c60', strokeWidth: 1.5, cornerRadius: 3,
        }));
        // 外壳顶高光
        s.add(new Konva.Rect({
            x: x + 2, y: y + 2, width: w - 4, height: 6,
            fill: 'rgba(255,255,255,0.20)', cornerRadius: 2, listening: false,
        }));

        // 内面板（中缝）
        const swX = this._qfCx - 30, swY = y + 34, swW = 60, swH = h - 68;
        s.add(new Konva.Rect({
            x: swX, y: swY, width: swW, height: swH,
            fill: '#e8eaec', stroke: '#2c3e50', strokeWidth: 1,
        }));

        // 手柄槽
        const slotX = this._qfCx - 14, slotY = y + 64, slotW = 28, slotH = 96;
        s.add(new Konva.Rect({
            x: slotX, y: slotY, width: slotW, height: slotH,
            fill: '#d2d6da', stroke: '#8a9096', strokeWidth: 1, cornerRadius: 2,
        }));
        // ON / OFF 标识
        s.add(new Konva.Text({
            x: this._qfCx - 10, y: slotY - 18, width: 20, align: 'center',
            text: 'ON', fontSize: 9, fontStyle: 'bold', fill: '#1e7e34', listening: false,
        }));
        s.add(new Konva.Text({
            x: this._qfCx - 10, y: slotY + slotH + 2, width: 20, align: 'center',
            text: 'OFF', fontSize: 9, fontStyle: 'bold', fill: '#b3392f', listening: false,
        }));

        // 进线端子（顶部 L1 L2 L3）
        this._qfInXs.forEach((tx, i) => {
            this._drawBreakerTerminal(tx, y + 8, 'in', ['L1', 'L2', 'L3'][i], ['#e03030', '#20a030', '#2050e0'][i]);
        });
        // 出线端子（底部 T1 T2 T3）
        this._qfOutXs.forEach((tx, i) => {
            this._drawBreakerTerminal(tx, y + h - 8, 'out', ['T1', 'T2', 'T3'][i], ['#e03030', '#20a030', '#2050e0'][i]);
        });
        // 铭牌
        s.add(new Konva.Text({
            x: x + 4, y: y + h - 29, width: w - 8, align: 'center',
            text: 'QF 电源开关', fontSize: 12, fontStyle: 'bold', fill: '#fff',
        }));
    }

    _drawBreakerTerminal(tx, ty, dir, label, color) {
        const s = this._staticGroup;
        const R = 6.5;
        s.add(new Konva.Circle({
            x: tx, y: ty, radius: R,
            fillLinearGradientStartPoint: { x: -R, y: -R },
            fillLinearGradientEndPoint: { x: R, y: R },
            fillLinearGradientColorStops: [0, '#8a7a30', 0.4, '#d4aa52', 0.7, '#e8c86a', 1, '#8a7030'],
            stroke: '#6a5a28', strokeWidth: 1, listening: false,
        }));
        s.add(new Konva.Circle({ x: tx, y: ty, radius: R * 0.38, fill: '#2a1a08', listening: false }));
        const ly = dir === 'in' ? ty - 16 : ty + 16;
        s.add(new Konva.Text({
            x: tx - 12, y: ly, width: 24, align: 'center',
            text: label, fontSize: 8, fontStyle: 'bold', fill: color,
        }));
        // 引线入壳体
        const ly2 = dir === 'in' ? ty + 4 : ty - 4;
        s.add(new Konva.Line({
            points: [tx, ty, tx, ly2], stroke: color, strokeWidth: 1.6, listening: false,
        }));
    }

    /**
     * 中央安装面板：标题栏 + 左竖槽 + 3×2 格 + 两条水平槽 + 端子区
     */
    _drawPanelStatic() {
        const s = this._staticGroup;
        // 面板边框
        s.add(new Konva.Rect({
            x: P_X, y: P_Y, width: P_W, height: P_H,
            fill: '#eef0f2', stroke: '#5a6a75', strokeWidth: 2, cornerRadius: 4,
        }));
        s.add(new Konva.Rect({
            x: P_X + 4, y: P_Y + 4, width: P_W - 8, height: P_H - 8,
            fill: '#f4f6f8', stroke: '#b8bcc0', strokeWidth: 1,
        }));

        // 标题栏
        s.add(new Konva.Rect({
            x: P_X + 4, y: P_Y + 4, width: P_W - 8, height: TITLE_H - 4,
            fill: '#3a4a55', cornerRadius: [4, 4, 0, 0],
        }));
        s.add(new Konva.Text({
            x: P_X, y: P_Y + 8, width: P_W, align: 'center',
            text: this.label, fontSize: 15, fontStyle: 'bold', fill: '#ffffff',
        }));

        // 左竖槽
        this._drawDuctV(s, this._leftDuct);
        // 两条水平槽
        this._ducts.forEach(d => this._drawDuctH(s, d));

        // 设备格边框 + 向下引线
        for (let n = 1; n <= 6; n++) this._drawCell(s, n);

        this._drawTerminalZone(s);
    }

    _drawDuctH(s, d) {
        s.add(new Konva.Rect({
            x: d.x, y: d.y, width: d.w, height: d.h,
            fill: '#c8ccd0', stroke: '#8a949c', strokeWidth: 1,
        }));
        s.add(new Konva.Rect({
            x: d.x + 3, y: d.y + 3, width: d.w - 6, height: d.h - 6,
            fill: '#dfe3e6',
        }));
        const colors = ['#e74c3c', '#3498db', '#2ecc71', '#f1c40f'];
        for (let i = 0; i < colors.length; i++) {
            const y = d.y + 5 + i * 4;
            s.add(new Konva.Line({
                points: [d.x + 6, y, d.x + d.w - 6, y],
                stroke: colors[i], strokeWidth: 1.5,
            }));
        }
    }

    _drawDuctV(s, d) {
        s.add(new Konva.Rect({
            x: d.x, y: d.y, width: d.w, height: d.h,
            fill: '#c8ccd0', stroke: '#8a949c', strokeWidth: 1,
        }));
        s.add(new Konva.Rect({
            x: d.x + 3, y: d.y + 3, width: d.w - 6, height: d.h - 6,
            fill: '#dfe3e6',
        }));
        const colors = ['#e74c3c', '#3498db', '#2ecc71', '#f1c40f'];
        for (let i = 0; i < colors.length; i++) {
            const x = d.x + 5 + i * 4;
            s.add(new Konva.Line({
                points: [x, d.y + 6, x, d.y + d.h - 6],
                stroke: colors[i], strokeWidth: 1.5,
            }));
        }
    }

    _drawCell(s, n) {
        const c = this._cells[n];
        s.add(new Konva.Rect({
            x: c.x, y: c.y, width: c.w, height: c.h,
            fill: '#ffffff', stroke: '#9aa4ac', strokeWidth: 1.5,
        }));
        // 格下标签
        s.add(new Konva.Text({
            x: c.x, y: c.y + c.h - 18, width: c.w, align: 'center',
            text: CELL_NAMES[n], fontSize: 12, fontStyle: 'bold', fill: '#3a4a55',
        }));
        // 该格下方水平槽
        const duct = this._ducts[Math.min(1, Math.floor((n - 1) / 3))];
        const yTop = c.y + c.h;
        const yBot = duct.y + duct.h / 2;
        const xs = [c.x + c.w * 0.3, c.x + c.w * 0.7];
        s.add(new Konva.Line({
            points: [xs[0], yTop, xs[0], yBot], stroke: '#e74c3c', strokeWidth: 2,
        }));
        s.add(new Konva.Line({
            points: [xs[1], yTop, xs[1], yBot], stroke: '#3498db', strokeWidth: 2,
        }));
    }

    /**
     * 接线端子区：两行接线柱（上行 U/V/W 经槽连空气开关，下行 L1/L2/L3 接黑电缆）
     */
    /**
     * 接线端子区：左右两组 + PE 组
     *  左组（电源进线）：下排 L1/L2/L3 ← 黑电缆三相；上排 U/V/W 经走线槽接空气开关入口
     *  右组（出线）：上排 U/V/W ← 热继电器走线槽；下排 L1/L2/L3 对外引出
     *  PE 组（右侧）：一排紧密连接的 4 个保护接地端子（电气端口同簇）
     */
    _drawTerminalZone(s) {
        const zx = P_X + 28;
        const zy = TERM_Z_Y;
        const zw = P_W - 30;
        const zh = TERM_Z_H;
        s.add(new Konva.Rect({
            x: zx, y: zy, width: zw, height: zh,
            fill: '#e6e8ea', stroke: '#9aa4ac', strokeWidth: 1, cornerRadius: 3,
        }));
        // 分区标题与左右组名
        s.add(new Konva.Text({
            x: TERM_L_XS[0], y: zy -12, width: TERM_L_XS[2] - TERM_L_XS[0] + 22, align: 'center',
            text: '电源进线', fontSize: 12, fontStyle: 'bold', fill: '#3a6a8a',
        }));
        s.add(new Konva.Text({
            x: TERM_R_XS[0]-5, y: zy -12, width: TERM_R_XS[2] - TERM_R_XS[0] + 22, align: 'center',
            text: '出线', fontSize: 12, fontStyle: 'bold', fill: '#8a5a3a',
        }));
        s.add(new Konva.Text({
            x: TERM_PE_XS[0]-15, y: zy -12, width: TERM_PE_XS[3] - TERM_PE_XS[0] + 22, align: 'center',
            text: 'PE', fontSize: 12, fontStyle: 'bold', fill: '#4a7a2a',
        }));

        // 走线：左组上排经槽接空气开关（格1），右组上排经槽接热继电器（格5）
        const duct2 = this._ducts[1];
        TERM_L_XS.forEach((tx, i) => {
            const colr = ['#e03030', '#20a030', '#2050e0'][i];
            s.add(new Konva.Line({
                points: [tx, TERM_UP_Y - 16, tx, duct2.y + duct2.h],
                stroke: colr, strokeWidth: 1.5, listening: false,
            }));
        });
        TERM_R_XS.forEach((tx, i) => {
            const colr = ['#e03030', '#20a030', '#2050e0'][i];
            s.add(new Konva.Line({
                points: [tx, TERM_UP_Y - 16, tx, duct2.y + duct2.h],
                stroke: colr, strokeWidth: 1.5, listening: false,
            }));
        });
        // 左组端子（上排 U/V/W 出线 → 空气开关；下排 L1/L2/L3 进线 ← 黑电缆）
        TERM_L_XS.forEach((tx, i) => {
            this._drawTerminalPost(s, tx, TERM_UP_Y, ['U', 'V', 'W'][i], '#2050e0', 'up');
        });
        TERM_L_XS.forEach((tx, i) => {
            this._drawTerminalPost(s, tx, TERM_LOW_Y, ['L1', 'L2', 'L3'][i], '#e03030', 'low');
        });
        // 右组端子（上排 U/V/W ← 热继电器；下排 L1/L2/L3 对外引出）
        TERM_R_XS.forEach((tx, i) => {
            this._drawTerminalPost(s, tx, TERM_UP_Y, ['U', 'V', 'W'][i], '#2050e0', 'up');
        });
        TERM_R_XS.forEach((tx, i) => {
            this._drawTerminalPost(s, tx, TERM_LOW_Y, ['L1', 'L2', 'L3'][i], '#e03030', 'low');
        });
        // PE 端子组：一排紧密连接的 4 个保护接地端子
        TERM_PE_XS.forEach((tx, i) => {
            this._drawPETerminal(s, tx, TERM_PE_Y, ['PE1', 'PE2', 'PE3', 'PE4'][i]);
        });
        // PE 组内部黄绿导线条（紧密连接）
        this._drawPETerminalBar(s, TERM_PE_XS[0], TERM_PE_XS[3]);

        // 格1（空气开关）底部母线色线：左组上排经槽到空气开关的连通强调
        const c1 = this._cells[1];
        const duct1 = this._ducts[0];
        s.add(new Konva.Line({
            points: [c1.x + c1.w * 0.3, c1.y + c1.h, c1.x + c1.w * 0.3, duct1.y],
            stroke: '#2ecc71', strokeWidth: 2,
        }));
        s.add(new Konva.Line({
            points: [c1.x + c1.w * 0.7, c1.y + c1.h, c1.x + c1.w * 0.7, duct1.y],
            stroke: '#f1c40f', strokeWidth: 2,
        }));
        // 格5（热继电器）底部母线色线：右组上排经槽到热继电器的连通强调
        const c5 = this._cells[5];
        s.add(new Konva.Line({
            points: [c5.x + c5.w * 0.3, c5.y + c5.h, c5.x + c5.w * 0.3, duct2.y],
            stroke: '#2ecc71', strokeWidth: 2,
        }));
        s.add(new Konva.Line({
            points: [c5.x + c5.w * 0.7, c5.y + c5.h, c5.x + c5.w * 0.7, duct2.y],
            stroke: '#f1c40f', strokeWidth: 2,
        }));
    }

    /**
     * 单个接线柱：金属立式柱 + 顶部螺丝 + 内竖线，底部出线脚
     */
    _drawTerminalPost(s, tx, ty, label, color, dir) {
        const w = 20, h = 28;
        const x = tx - w / 2, y = ty - h / 2;
        // 金属柱体
        s.add(new Konva.Rect({
            x, y, width: w, height: h,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint: { x: w, y: 0 },
            fillLinearGradientColorStops: [0, '#c8ccd0', 0.5, '#e8eaec', 1, '#a8acb0'],
            stroke: '#6a7076', strokeWidth: 1, cornerRadius: 2,
        }));
        // 顶部螺丝
        const R = 8.5;
        s.add(new Konva.Circle({
            x: tx, y: ty , radius: R,
            fillLinearGradientStartPoint: { x: -R, y: -R },
            fillLinearGradientEndPoint: { x: R, y: R },
            fillLinearGradientColorStops: [0, '#8a7a30', 0.4, '#d4aa52', 0.7, '#e8c86a', 1, '#8a7030'],
            stroke: '#6a5a28', strokeWidth: 0.8,
        }));
        // 接线孔
        s.add(new Konva.Circle({ x: tx, y: ty + 2, radius: 3.4, fill: '#5c656c', stroke: '#333c44', strokeWidth: 0.8 }));
       
        // 标签
        s.add(new Konva.Text({
            x: tx - 24, y: dir === 'up' ? y - 15 : y + h - 1, width: 28, align: 'center',
            text: label, fontSize: 12, fontStyle: 'bold', fill: color,
        }));
        // 底部出线脚
        s.add(new Konva.Line({
            points: [tx, y + h, tx, y + h + (dir === 'low' ? 5 : 0)],
            stroke: color, strokeWidth: 1.4,
        }));
    }

    /**
     * PE 端子：黄绿色外壳的紧密接线端子
     */
    _drawPETerminal(s, tx, ty, label) {
        const w = 16, h = 26;
        const x = tx - w / 2, y = ty - h / 2;
        // 黄绿相间外壳
        // for (let i = 0; i < 4; i++) {
        //     s.add(new Konva.Rect({
        //         x: x, y: y + (i * h) / 4, width: w, height: h / 4,
        //         fill: i % 2 === 0 ? '#f4c542' : '#20a030',
        //         listening: false,
        //     }));
        // }
        s.add(new Konva.Rect({
            x, y, width: w, height: h, fill: 'rgba(0,0,0,0)', stroke: '#4a7a2a', strokeWidth: 1, cornerRadius: 2,
        }));
        // 顶部螺丝
        const R = 9;
        s.add(new Konva.Circle({
            x: tx, y: ty , radius: R,
            fillLinearGradientStartPoint: { x: -R, y: -R },
            fillLinearGradientEndPoint: { x: R, y: R },
            fillLinearGradientColorStops: [0, '#8a7a30', 0.4, '#d4aa52', 0.7, '#e8c86a', 1, '#8a7030'],
            stroke: '#6a5a28', strokeWidth: 0.8,
        }));
        // 接线孔
        s.add(new Konva.Circle({ x: tx, y: ty + 2, radius: 3.4, fill: '#3c4a30', stroke: '#2c3820', strokeWidth: 0.8 }));
        // 标签
        s.add(new Konva.Text({
            x: tx - 14, y: y + h +10, width: 28, align: 'center',
            text: label, fontSize: 12, fontStyle: 'bold', fill: '#4a7a2a',
        }));
    }

    /**
     * PE 端子组内部黄绿导线条（4 端子紧密连接，下方横贯）
     */
    _drawPETerminalBar(s, x0, x1) {
        const y = TERM_PE_Y- 3.5 ;
        const steps = 8;
        const segW = (x1 - x0) / steps;
        for (let i = 0; i < steps; i++) {
            s.add(new Konva.Rect({
                x: x0 + i * segW, y, width: segW, height: 7,
                fill: i % 2 === 0 ? '#f4c542' : '#20a030',
                listening: false,
            }));
        }
    }

    /**
     * 黄绿相间导线（PE 连接线）
     */
    _drawGreenYellowWire(s, pts, width = 6) {
        const dist = Math.abs(pts[pts.length - 2] - pts[0]) + Math.abs(pts[pts.length - 1] - pts[1]);
        const steps = Math.max(8, Math.round(dist / 6));
        for (let i = 0; i < steps; i++) {
            const t0 = i / steps, t1 = (i + 1) / steps;
            const x0 = pts[0] + (pts[2] - pts[0]) * t0, y0 = pts[1] + (pts[3] - pts[1]) * t0;
            const x1 = pts[0] + (pts[2] - pts[0]) * t1, y1 = pts[1] + (pts[3] - pts[1]) * t1;
            s.add(new Konva.Line({
                points: [x0, y0, x1, y1],
                stroke: i % 2 === 0 ? '#f4c542' : '#20a030', strokeWidth: width,
                lineCap: 'round', listening: false,
            }));
        }
    }

    /**
     * 黑色电缆：自 QF 下端 3 个出线接线柱各自向下引线（3合1），沿底部横走，
     * 分三相接左组下排接线端子（电源进线）
     */
    _drawCable() {
        const s = this._staticGroup;
        const cableBottomY = COMP_H - 30;
        const colrs = ['#e03030', '#20a030', '#2050e0'];
        const cx = this._qfCx;               // 黑电缆起始点（QF 正下方中间）
        const startY = QF_Y + QF_H - 8;      // 出线柱底部
        const mergeY = QF_Y + QF_H + 18;     // 三相汇入点（黑电缆顶端）

        // QF 下端 3 个接线柱各自引线，在中间汇入黑色电缆（3合1）：
        // 红(A)、绿(B) 各自斜向，蓝(C) 斜向，全部汇到黑电缆起点 cx 处，
        // 避免两侧相线（红/蓝）垂直引下后悬空不接黑电缆。
        this._qfOutXs.forEach((tx, i) => {
            s.add(new Konva.Line({
                points: [tx, startY, cx, mergeY],
                stroke: colrs[i], strokeWidth: 2, listening: false,
            }));
        });
        // 主电缆：自三相汇入点向下到底部，水平横走到左组下排接线柱下方
        s.add(new Konva.Line({
            points: [cx, mergeY, cx, cableBottomY, TERM_L_XS[2], cableBottomY],
            stroke: '#101010', strokeWidth: 10, lineCap: 'round', listening: false,
        }));
        // 电缆高光
        s.add(new Konva.Line({
            points: [cx, mergeY + 4, cx, cableBottomY - 2, TERM_L_XS[2], cableBottomY - 2],
            stroke: 'rgba(255,255,255,0.35)', strokeWidth: 2, listening: false,
        }));
        // 三相引线（红绿蓝）从电缆分接至左组下排端子底部
        TERM_L_XS.forEach((tx, i) => {
            s.add(new Konva.Line({
                points: [tx, cableBottomY, tx, TERM_LOW_Y + 16],
                stroke: colrs[i], strokeWidth: 2, listening: false,
            }));
        });
        // 电缆进入面板的护套口
        s.add(new Konva.Ellipse({
            x: cx, y: cableBottomY, radiusX: 8, radiusY: 4, fill: '#333a40',
        }));
    }

    /**
     * 右侧打开一半的门（平行四边形透视三维）+ 铰链 + 把手 + 警示 + 保护接地(PE)接线柱
     */
    _drawDoor() {
        const s = this._staticGroup;
        const xh = DOOR_HINGE_X;

        // 门后的箱体内部暗影
        s.add(new Konva.Rect({
            x: xh - 6, y: 30, width: COMP_W - xh + 8, height: DOOR_BY - 30,
            fill: '#525a60', stroke: '#3a4046', strokeWidth: 1,
        }));

        // 门板（平行四边形透视）
        const door = new Konva.Line({
            points: this._doorPts,
            closed: true,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint: { x: DOOR_PROJ_W, y: 0 },
            fillLinearGradientColorStops: [0, '#d5dadd', 1, '#9aa0a6'],
            stroke: '#4a5258', strokeWidth: 1.5,
            listening: false,
        });
        s.add(door);
        // 门板内框线
        s.add(new Konva.Line({
            points: [
                xh + 5, DOOR_TY + 6, xh + 5, DOOR_BY - 6,
                xh + DOOR_PROJ_W - 4, DOOR_BY + 6, xh + DOOR_PROJ_W - 4, DOOR_TY - 6,
            ],
            closed: true, stroke: 'rgba(74,82,88,0.45)', strokeWidth: 1, listening: false,
        }));
        // 门板顶部高光
        s.add(new Konva.Line({
            points: [xh + 3, DOOR_TY + 2, xh + DOOR_PROJ_W - 2, DOOR_TY - 10],
            stroke: 'rgba(255,255,255,0.5)', strokeWidth: 2, listening: false,
        }));

        // 铰链片（上下两枚）
        [DOOR_TY + 40, DOOR_BY - 90].forEach(hy => {
            s.add(new Konva.Rect({
                x: xh - 6, y: hy, width: 18, height: 34,
                fill: '#8a9096', stroke: '#5c656c', strokeWidth: 1, cornerRadius: 2,
            }));
            s.add(new Konva.Circle({ x: xh, y: hy + 8, radius: 1.6, fill: '#3a4046' }));
            s.add(new Konva.Circle({ x: xh, y: hy + 26, radius: 1.6, fill: '#3a4046' }));
        });

        // 门把手（自由边中部）+ 锁孔
        const hx = xh + DOOR_PROJ_W - 8, hyy = (DOOR_TY + DOOR_BY) / 2;
        s.add(new Konva.Rect({
            x: hx, y: hyy - 34, width: 6, height: 68,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint: { x: 6, y: 0 },
            fillLinearGradientColorStops: [0, '#e8eaec', 0.5, '#9aa4ac', 1, '#c8ccd0'],
            stroke: '#6a7076', strokeWidth: 0.8, cornerRadius: 2,
        }));
        s.add(new Konva.Circle({ x: hx + 3, y: hyy + 44, radius: 3, fill: '#5c656c', stroke: '#333c44' }));

        // 警示标志（当心触电，门板中上部）
        const warnY = DOOR_TY + 44;
        const wx = xh + 34;
        s.add(new Konva.Line({
            points: [wx, warnY, wx + 30, warnY, wx + 15, warnY + 26],
            closed: true, fill: '#f4c542', stroke: '#b8860b', strokeWidth: 1,
        }));
        s.add(new Konva.Line({
            points: [wx + 15, warnY + 6, wx + 15, warnY + 16],
            stroke: '#2a1a08', strokeWidth: 2, listening: false,
        }));
        s.add(new Konva.Line({
            points: [wx + 15, warnY + 20, wx + 15, warnY + 21],
            stroke: '#2a1a08', strokeWidth: 2, listening: false,
        }));
        s.add(new Konva.Text({
            x: xh - 118, y: warnY + 30, width: 236, align: 'center',
            text: '当心触电', fontSize: 11, fontStyle: 'bold', fill: '#b8860b',
        }));

        // 门锁开口（把手下方）
        s.add(new Konva.Rect({
            x: xh + 26, y: hyy + 20, width: 28, height: 12,
            fill: '#7a848c', stroke: '#3a4046', strokeWidth: 1, cornerRadius: 2,
        }));

        // 保护接地接线柱（PE，门板靠近下方）
        this._pe = { x: xh + DOOR_PROJ_W / 2 + 8, y: DOOR_BY - 230 };
        const peR = 11;
        // 接线柱
        s.add(new Konva.Circle({
            x: this._pe.x, y: this._pe.y, radius: peR, fill: '#d8dbde', stroke: '#4a5258', strokeWidth: 1.4,
        }));
        // 黄绿接地标志
        // s.add(new Konva.Line({
        //     points: [this._pe.x - peR, this._pe.y - peR, this._pe.x + peR, this._pe.y + peR],
        //     stroke: '#f4c542', strokeWidth: 4, listening: false,
        // }));
        s.add(new Konva.Line({
            points: [this._pe.x - peR, this._pe.y, this._pe.x + peR, this._pe.y],
            stroke: '#20a030', strokeWidth: 4, listening: false,
        }));
        s.add(new Konva.Circle({ x: this._pe.x, y: this._pe.y, radius: 3.4, fill: '#4a5258', stroke: '#2c3238' }));
        s.add(new Konva.Text({
            x: this._pe.x - 26, y: this._pe.y + 10, width: 52, align: 'center',
            text: 'PE 保护接地', fontSize: 9, fontStyle: 'bold', fill: '#4a5258',
        }));
    }

    /**
     * PE 连接：箱体 PE 设备点（箱体下方）+ 黄绿相间导线
     *   PE2 → 箱体 PE 设备点（箱体下方）
     *   PE3 → 门上 PE 接线柱
     */
    _drawPEConnections() {
        const s = this._staticGroup;
        // 箱体 PE 设备点（箱体下方）
        const bx = PE_BODY_X, by = PE_BODY_Y;
        this._peBody = { x: bx, y: by };
        const r = 9;
        s.add(new Konva.Circle({ x: bx, y: by, radius: r, fill: '#d8dbde', stroke: '#4a5258', strokeWidth: 1.4 }));
        // s.add(new Konva.Line({
        //     points: [bx - r, by - r, bx + r, by + r], stroke: '#f4c542', strokeWidth: 3.5, listening: false,
        // }));
        s.add(new Konva.Line({
            points: [bx - r, by, bx + r, by], stroke: '#20a030', strokeWidth: 3.5, listening: false,
        }));
        s.add(new Konva.Circle({ x: bx, y: by, radius: 2.6, fill: '#3a4a30', stroke: '#2c3820', strokeWidth: 0.6 }));
        s.add(new Konva.Text({
            x: bx - 30, y: by + 10, width: 60, align: 'center',
            text: '箱体PE', fontSize: 9, fontStyle: 'bold', fill: '#4a5258',
        }));
        // PE2 → 箱体 PE 设备点
        this._drawGreenYellowWire(s, [TERM_PE_XS[1], TERM_PE_Y, bx, by - 10], 5);
        // PE3 → 门上 PE 接线柱（水平向门延伸）
        if (this._pe) {
            this._drawGreenYellowWire(s, [TERM_PE_XS[2], TERM_PE_Y, this._pe.x, this._pe.y], 5);
        }
    }

    // ══════════════════════════════════════════════
    // 图片加载（设备实物图片）
    // ══════════════════════════════════════════════

    _createImageCells() {
        this._imgNodes = {};
        // 双状态格：空气开关(1) 与 接触器(4)，初始均为"断开/未吸合"
        this._dualStates = { 1: 'open', 4: 'open' };
        this._dualImgs = {
            1: { open: imgAcb, close: imgAcbClose },
            4: { open: imgContr, close: imgContrClose },
        };
        this._loadedDual = { 1: { open: false, close: false }, 4: { open: false, close: false } };
        for (let n = 1; n <= 6; n++) {
            const file = CELL_IMAGES[n];
            if (!file) continue;
            const c = this._cells[n];
            const r = { x: c.x + 8, y: c.y + 6, w: c.w - 16, h: c.h - 24 };
            const imgNode = new Konva.Image({ x: r.x, y: r.y, width: r.w, height: r.h });
            this._staticGroup.add(imgNode);
            this._imgNodes[n] = { node: imgNode, rect: r };
            if (this._dualImgs[n]) {
                this._loadDualImages(n);
            } else {
                this._loadImage(n, file, r);
            }
        }
    }

    /**
     * 预加载双状态格的两张图片，加载完成后按当前状态显示
     */
    _loadDualImages(n) {
        const pair = this._dualImgs[n];
        Object.keys(pair).forEach(k => {
            const url = pair[k];
            const img = new window.Image();
            img.onload = () => {
                // 加载完成后将 Image 对象写回（替换 url），供 _applyDualImage 使用
                this._dualImgs[n][k] = img;
                this._loadedDual[n][k] = true;
                if (this._dualStates[n] === k) this._applyDualImage(n);
            };
            img.src = url;
        });
    }

    /**
     * 按当前状态应用双状态格图片（须待图片加载完成）
     */
    _applyDualImage(n) {
        const entry = this._imgNodes[n];
        if (!entry) return;
        if (!this._loadedDual[n] || !this._loadedDual[n][this._dualStates[n]]) return;
        const img = this._dualImgs[n][this._dualStates[n]];
        const r = entry.rect;
        const scale = Math.min(r.w / img.width, r.h / img.height);
        const iw = img.width * scale;
        const ih = img.height * scale;
        entry.node.image(img);
        entry.node.width(iw);
        entry.node.height(ih);
        entry.node.x(r.x + (r.w - iw) / 2);
        entry.node.y(r.y + (r.h - ih) / 2);
        this._forceCacheFlush();
    }

    /**
     * 空气开关：点击切换合/分闸
     */
    _toggleAcb() {
        this._dualStates[1] = this._dualStates[1] === 'open' ? 'close' : 'open';
        this._applyDualImage(1);
        // 空气开关断开 → 若接触器已吸合则释放
        if (this._dualStates[1] === 'open' && this._dualStates[4] === 'close') {
            this._setContactor('open', '空气开关断开，接触器释放');
        }
    }

    /**
     * 起动按钮：满足合闸条件则接触器吸合
     */
    _pressStart() {
        if (this._qfState !== 'on') {
            this._tip('供电开关未合上，接触器无法吸合');
            return;
        }
        if (this._dualStates[1] !== 'close') {
            this._tip('空气开关未合上，接触器无法吸合');
            return;
        }
        if (this._dualStates[4] === 'close') {
            this._tip('接触器已处于吸合状态');
            return;
        }
        this._setContactor('close', '接触器吸合');
    }

    /**
     * 停止按钮：释放接触器
     */
    _pressStop() {
        this._setContactor('open', '按下停止按钮，接触器释放');
    }

    /**
     * 设置接触器状态（未吸合 open / 吸合 close）
     */
    _setContactor(state, tip) {
        if (this._dualStates[4] === state) return;
        this._dualStates[4] = state;
        this._applyDualImage(4);
        if (tip) this._tip(tip);
    }

    _tip(text) {
        if (this.sys && typeof this.sys.showFloatingTip === 'function') {
            this.sys.showFloatingTip(text, 2000);
        }
    }

    /**
     * 三相交流电源输出（供电开关 QF 合上时）：
     * in1/in2/in3 为相电压 220V 三相，频率 50Hz
     * @param {string} phase - 'in1' | 'in2' | 'in3'
     */
    getPhaseVoltage(phase, time) {
        if (this._qfState !== 'on') return 0;
        const peak = 220 * Math.sqrt(2);
        const omega = 2 * Math.PI * 50;
        let offset = 0;
        if (phase === 'in2') offset = -4 * Math.PI / 3;
        else if (phase === 'in3') offset = -2 * Math.PI / 3;
        return peak * Math.sin(omega * time + offset);
    }

    _loadImage(n, url, r) {
        const img = new window.Image();
        img.onload = () => {
            const entry = this._imgNodes[n];
            if (!entry) return;
            const scale = Math.min(r.w / img.width, r.h / img.height);
            const iw = img.width * scale;
            const ih = img.height * scale;
            entry.node.image(img);
            entry.node.width(iw);
            entry.node.height(ih);
            entry.node.x(r.x + (r.w - iw) / 2);
            entry.node.y(r.y + (r.h - ih) / 2);
            this._forceCacheFlush();
        };
        img.src = url;
    }

    // ══════════════════════════════════════════════
    // 动态节点 + 交互（塑壳断路器手柄）
    // ══════════════════════════════════════════════

    _createDynamicNodes() {
        const slotY = QF_Y + 64;
        const hx = this._qfCx, hy = slotY + 48 + QF_HANDLE_OFF[this._qfState];
        const g = new Konva.Group({ x: hx, y: hy, listening: false });
        g.add(new Konva.Rect({
            x: -12, y: -20, width: 24, height: 40,
            fillLinearGradientStartPoint: { x: 0, y: -20 },
            fillLinearGradientEndPoint: { x: 0, y: 20 },
            fillLinearGradientColorStops: [0, '#1c3c60', 0.5, '#30588a', 1, '#1c3c60'],
            stroke: '#101820', strokeWidth: 1, cornerRadius: 3,
        }));
        g.add(new Konva.Rect({
            x: -9, y: -16, width: 18, height: 5,
            fill: 'rgba(255,255,255,0.28)', cornerRadius: 2, listening: false,
        }));
        this._handle = g;
        this._dynamicGroup.add(g);
    }

    _toggleQf() {
        // 塑壳断路器：合/分闸 + 短路速断保护
        if (this._animating) return;
        const prev = this._qfState;

        // 1) 脱扣态点击 → 复位分闸；否则正常合/分闸切换
        if (prev === 'trip') {
            this._setQfState('off', QF_Y + 64 + 48 + QF_HANDLE_OFF['trip'], QF_Y + 64 + 48 + QF_HANDLE_OFF['off']);
            this._tip('断路器已复位（分闸），请检查入口短路情况后再合闸。');
            return;
        }
        const next = prev === 'on' ? 'off' : 'on';

        // 2) 合闸瞬间检测：入口电源进线任意两相及以上同簇（相间/接地短路）→ 脱扣
        if (next === 'on' && this._isInputPhaseShorted()) {
            this._tripQf('入口电源进线存在两相及以上短接（未拆临时接地线合闸），一合闸即短路，断路器瞬时脱扣（跳闸）！请先拆除接地线再合闸。');
            return;
        }

        // 3) 正常合/分闸
        let tip = '';
        if (prev === 'on' && next === 'off') {
            // 正常分闸：若接触器已吸合则释放
            if (this._dualStates && this._dualStates[4] === 'close') {
                this._setContactor('open', '供电开关断开，接触器释放');
            }
        }
        this._setQfState(next, QF_Y + 64 + 48 + QF_HANDLE_OFF[prev], QF_Y + 64 + 48 + QF_HANDLE_OFF[next]);
        if (tip) this._tip(tip);
    }

    /** 执行脱扣（短路速断）：任意状态 → trip，触点释放 + 提示 */
    _tripQf(tip) {
        const prev = this._qfState;
        if (this._dualStates && this._dualStates[4] === 'close') {
            this._setContactor('open', '');
        }
        this._setQfState('trip', QF_Y + 64 + 48 + QF_HANDLE_OFF[prev], QF_Y + 64 + 48 + QF_HANDLE_OFF['trip']);
        if (tip) this._tip(tip);
    }

    /** 设置 QF 状态并启动手柄动画（from → to，相对手柄槽原点的 y 偏移） */
    _setQfState(state, fromY, toY) {
        this._qfState = state;
        this._animFrom = fromY;
        this._animTo   = toY;
        this._animating = true;
        this._animT = 0;
    }

    /**
     * 检测入口电源进线是否存在相间/接地短路：
     * in1/in2/in3 中任意两相及以上并入同一簇（被临时接地线/导线短接）即视为短路。
     * 低压临时接地线（lv_grounding_lead）内部 p1/p2/p3/gnd 四端口零电阻同簇，
     * 故只要挂线夹住两相及以上即构成相间短路，无需接地端实际接地。
     * 依赖 CircuitSolver 每帧重建的 portToCluster 拓扑结果。
     */
    _isInputPhaseShorted() {
        const solver = this.sys && this.sys.voltageSolver;
        if (!solver || !solver.portToCluster) return false;
        const cs = ['in1', 'in2', 'in3'].map(p => solver.portToCluster.get(`${this.id}_wire_${p}`));
        // 未接线的端口簇为 undefined 或孤立簇，均不构成短路；统计已布线端口的簇
        const present = cs.filter(c => c !== undefined);
        if (present.length < 2) return false;
        // 任意两相同簇 → 相间短路
        const seen = new Set();
        for (const c of present) {
            if (seen.has(c)) return true;
            seen.add(c);
        }
        return false;
    }

    tick(dt) {
        if (this._animating) {
            this._animT += dt / 0.15;
            if (this._animT >= 1) { this._animT = 1; this._animating = false; }
            const ease = 0.5 - 0.5 * Math.cos(this._animT * Math.PI);
            this._handle.y(this._animFrom + (this._animTo - this._animFrom) * ease);
            return;
        }
        // 已合闸运行中：持续监测入口电源进线，一旦出现两相及以上短接（如带电挂临时
        // 接地线）立即短路速断脱扣跳闸
        if (this._qfState === 'on' && this._isInputPhaseShorted()) {
            this._tripQf('电源进线两相及以上已被临时接地线短接，短路保护动作，断路器立即脱扣（跳闸）！请先拆除接地线再合闸。');
        }
    }

    // ══════════════════════════════════════════════
    // 可点击部件（供工作流 find 步骤）
    // ══════════════════════════════════════════════

    _addClickableParts() {
        for (let n = 1; n <= 6; n++) {
            const c = this._cells[n];
            const hit = this.addClickablePart(PART_IDS[n], c.x, c.y, c.w, c.h);
            if (n === 1) {
                // 空气开关：点击切换合/分闸
                hit.on('click tap', (e) => {
                    e.cancelBubble = true;
                    this._toggleAcb();
                });
            } else if (n === 3) {
                // 停止按钮：释放接触器
                hit.on('click tap', (e) => {
                    e.cancelBubble = true;
                    this._pressStop();
                });
            } else if (n === 6) {
                // 起动按钮：满足条件则吸合接触器
                hit.on('click tap', (e) => {
                    e.cancelBubble = true;
                    this._pressStart();
                });
            }
        }
        const qfHit = this.addClickablePart('qf-breaker', QF_X, QF_Y, QF_W, QF_H);
        qfHit.on('click tap', (e) => {
            e.cancelBubble = true;
            this._toggleQf();
        });
        if (this._pe) {
            // 柜门 PE 端子：电气端口点击会拦截热区，放大范围并置顶（门板 door 热区较大）
            const peTermHit = this.addClickablePart('pe-terminal', this._pe.x - 24, this._pe.y - 24, 48, 48, true);
            this._peTermGroup = peTermHit.parent;   // 保存所属 group，便于末尾统一置顶
        }
        // 接线端子排识别区（左组=电源进线，右组=出线，各上下两排）
        this.addClickablePart('term-l-up', TERM_L_XS[0] - 14, TERM_UP_Y - 20, TERM_L_XS[2] - TERM_L_XS[0] + 28, 40);
        this.addClickablePart('term-l-low', TERM_L_XS[0] - 14, TERM_LOW_Y - 20, TERM_L_XS[2] - TERM_L_XS[0] + 28, 40);
        this.addClickablePart('term-r-up', TERM_R_XS[0] - 14, TERM_UP_Y - 20, TERM_R_XS[2] - TERM_R_XS[0] + 28, 40);
        this.addClickablePart('term-r-low', TERM_R_XS[0] - 14, TERM_LOW_Y - 20, TERM_R_XS[2] - TERM_R_XS[0] + 28, 40);
        // PE 端子组（4 个紧密端子）
        this.addClickablePart('term-pe', TERM_PE_XS[0] - 10, TERM_PE_Y - 16, TERM_PE_XS[3] - TERM_PE_XS[0] + 20, 32);
        // PE 接地排（端子下方的黄绿导铜排）
        this.addClickablePart('pe-bar', TERM_PE_XS[0] - 10, TERM_PE_Y - 12, TERM_PE_XS[3] - TERM_PE_XS[0] + 20, 26);
        // 箱体 PE 设备点（电气端口点击会拦截热区，放大范围）——需居上避免被同轴 pe-body 端口旁热区遮挡
        if (this._peBody) {
            this.addClickablePart('pe-body', this._peBody.x - 24, this._peBody.y - 24, 48, 48, true);
        }
        this.addClickablePart('door', DOOR_HINGE_X, DOOR_TY, DOOR_PROJ_W + 10, DOOR_BY - DOOR_TY);
        // 柜门 PE 端子热区置顶（door 热区最后注册、覆盖 PE 端子区域，需再置顶一次）
        if (this._peTermGroup) this._peTermGroup.moveToTop();
    }

    getClickablePartCenter(partId) {
        for (let n = 1; n <= 6; n++) {
            if (PART_IDS[n] === partId) {
                const c = this._cells[n];
                return { x: c.x + c.w / 2, y: c.y + c.h / 2 };
            }
        }
        const gx = this.group ? this.group.x() : 0;
        const gy = this.group ? this.group.y() : 0;
        const rel = {
            'qf-breaker': { x: QF_X + QF_W / 2, y: QF_Y + QF_H / 2 },
            'pe-terminal': this._pe || { x: 0, y: 0 },
            'term-l-up': { x: (TERM_L_XS[0] + TERM_L_XS[2]) / 2, y: TERM_UP_Y },
            'term-l-low': { x: (TERM_L_XS[0] + TERM_L_XS[2]) / 2, y: TERM_LOW_Y },
            'term-r-up': { x: (TERM_R_XS[0] + TERM_R_XS[2]) / 2, y: TERM_UP_Y },
            'term-r-low': { x: (TERM_R_XS[0] + TERM_R_XS[2]) / 2, y: TERM_LOW_Y },
            'term-pe': { x: (TERM_PE_XS[0] + TERM_PE_XS[3]) / 2, y: TERM_PE_Y },
            'pe-bar': { x: (TERM_PE_XS[0] + TERM_PE_XS[3]) / 2, y: TERM_PE_Y + 2 },
            'pe-body': this._peBody || { x: 0, y: 0 },
            'door': { x: DOOR_HINGE_X + DOOR_PROJ_W / 2, y: (DOOR_TY + DOOR_BY) / 2 },
        };
        const p = rel[partId];
        return p ? { x: gx + p.x, y: gy + p.y } : null;
    }

    // ══════════════════════════════════════════════
    // 配置接口
    // ══════════════════════════════════════════════

    getConfigFields() {
        return [
            { label: '面板名称', key: 'label', type: 'text' },
        ];
    }

    onConfigUpdate(newConfig) {
        if (newConfig.label !== undefined && newConfig.label !== this.label) {
            this.label = newConfig.label;
            this._staticGroup.destroyChildren();
            this._recalcGeometry();
            this._drawStaticParts();
            this._createImageCells();
            this._forceCacheFlush();
        }
    }
}