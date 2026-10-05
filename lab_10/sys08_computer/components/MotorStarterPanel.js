import { BaseComponent } from './BaseComponent.js';
import imgAcb from '../images/acb01.jpg';
import imgFuse from '../images/fuse01.jpg';
import imgContr from '../images/contr01.jpg';
import imgContact from '../images/contact01.jpg';
import imgStart from '../images/start01.jpg';
import imgFr from '../images/fr01.jpg';
import imgTimer from '../images/timer01.jpg';
import imgStop from '../images/stop01.jpg';

/**
 * MotorStarterPanel 电机起动控制箱（纯视觉展示组件）
 * 尺寸 500×650，用于考核。
 *
 * 布局（3×3 格子 + 线槽走线）：
 *  - 顶部标题栏
 *  - 第一列左侧：垂直线槽，内含竖向走线
 *  - 第一行与第二行之间、第二行与第三行之间、第三行下方：三条水平线槽，内含横向走线
 *  - 9 个设备格子：格 1~9 加载实物图片（acb/fuse/contr/contact/空/start/fr/timer/stop）
 *  - 每个设备格子底部向下引出两根导线（红、蓝）接入其下方水平线槽
 *
 * 无端口、不参与电路求解；9 个格子均通过 addClickablePart 注册可点击区域，
 * 供工作流 find 步骤（考核点击识别设备）使用。
 */

const PANEL_W = 550;
const PANEL_H = 750;

// 各格加载的实物图片（格 5 留空）
const CELL_IMAGES = {
    1: imgAcb,
    2: imgFuse,
    3: imgContr,
    4: imgContact,
    5: null,
    6: imgStart,
    7: imgFr,
    8: imgTimer,
    9: imgStop,
};

// 各格可点击部件 id（供工作流 find 步骤识别）
const PART_IDS = {
    1: 'cell-acb',
    2: 'cell-fuse',
    3: 'cell-contr',
    4: 'cell-contact',
    5: 'cell-empty',
    6: 'cell-start',
    7: 'cell-fr',
    8: 'cell-timer',
    9: 'cell-stop',
};

const CELL_W = 166;
const CELL_H = 210;
const DUCT_H = 24;
const COL_GAP = 8;
const TITLE_H = 30;

export class MotorStarterPanel extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(300, config.width  || PANEL_W);
        this.height = Math.max(400, config.height || PANEL_H);

        this.type  = 'starter_panel';
        this.cache = 'fixed';

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        this.config = {
            id: this.id,
            label: this.label,
        };
    }

    // ═══════════════════════════════════════════════════
    // 几何计算
    // ═══════════════════════════════════════════════════

    _recalcGeometry() {
        const W = PANEL_W;
        const H = PANEL_H;

        this._titleRect = { x: 0, y: 0, w: W, h: TITLE_H };

        // 左侧垂直线槽：标题栏以下贯通
        this._leftDuct = { x: 0, y: TITLE_H, w: 22, h: H - TITLE_H };

        // 3 列：x = 26 / 186 / 346（右缘 498）
        this._cols = [26, 26 + CELL_W + COL_GAP, 26 + 2 * (CELL_W + COL_GAP)];
        // 3 行：y = 36 / 240 / 444（行间各含一条 20 高线槽）
        this._rows = [36, 36 + CELL_H + DUCT_H, 36 + 2 * (CELL_H + DUCT_H)];

        this._cells = {};
        for (let r = 0; r < 3; r++) {
            for (let c = 0; c < 3; c++) {
                const n = r * 3 + c + 1;
                this._cells[n] = { x: this._cols[c], y: this._rows[r], w: CELL_W, h: CELL_H };
            }
        }

        // 三条水平线槽：行1下、行2下、行3下（自左侧线槽右缘延伸至面板右缘）
        this._ducts = [
            { x: 24, y: this._rows[0] + CELL_H, w: W - 24, h: DUCT_H },
            { x: 24, y: this._rows[1] + CELL_H, w: W - 24, h: DUCT_H },
            { x: 24, y: this._rows[2] + CELL_H, w: W - 24, h: DUCT_H },
        ];
    }

    // ═══════════════════════════════════════════════════
    // 参数初始化
    // ═══════════════════════════════════════════════════

    _initParameters(config) {
        this.label = config.label || '电机起动控制箱';
    }

    // ═══════════════════════════════════════════════════
    // 初始化
    // ═══════════════════════════════════════════════════

    _init() {
        this._drawStaticParts();
        this._createImageCells();
        this._addClickableParts();
    }

    // ═══════════════════════════════════════════════════
    // 静态部件绘制
    // ═══════════════════════════════════════════════════

    _drawStaticParts() {
        const s = this._staticGroup;

        // 柜体面板
        s.add(new Konva.Rect({
            x: 0, y: 0, width: PANEL_W, height: PANEL_H,
            fill: '#e8eaec', stroke: '#5a6a75', strokeWidth: 2, cornerRadius: 4,
        }));
        // 内层面板
        s.add(new Konva.Rect({
            x: 4, y: 4, width: PANEL_W - 8, height: PANEL_H - 8,
            fill: '#f0f2f4', stroke: '#b0b4b8', strokeWidth: 1,
        }));

        // 标题栏
        s.add(new Konva.Rect({
            x: 4, y: 4, width: PANEL_W - 8, height: TITLE_H - 4,
            fill: '#3a4a55', cornerRadius: [4, 4, 0, 0],
        }));
        s.add(new Konva.Text({
            x: 0, y: 7, width: PANEL_W, align: 'center',
            text: this.label, fontSize: 15, fontStyle: 'bold', fill: '#ffffff',
        }));

        // 左侧竖线槽
        this._drawDuctV(s, this._leftDuct);

        // 三条水平线槽
        this._ducts.forEach(d => this._drawDuctH(s, d));

        // 格子边框 + 向下引出导线
        for (let n = 1; n <= 9; n++) {
            this._drawCell(s, n);
        }
    }

    /**
     * 水平线槽：槽体外框 + 内部槽道 + 横向走线
     */
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

    /**
     * 垂直线槽：槽体外框 + 内部槽道 + 竖向走线
     */
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

    /**
     * 单个设备格：格子边框；有图片的格子从底部向下引出两根导线（红、蓝）至下方线槽
     */
    _drawCell(s, n) {
        const c = this._cells[n];
        s.add(new Konva.Rect({
            x: c.x, y: c.y, width: c.w, height: c.h,
            fill: '#ffffff', stroke: '#9aa4ac', strokeWidth: 1.5,
        }));

        // 格 5 无设备，不引线
        if (!CELL_IMAGES[n]) return;

        // 该格下方的水平线槽
        const duct = this._ducts[Math.min(2, Math.floor((n - 1) / 3))];
        const yTop = c.y + c.h;
        const yBot = duct.y + duct.h / 2;
        const xs = [c.x + c.w * 0.33, c.x + c.w * 0.66];
        const colors = ['#e74c3c', '#3498db'];
        xs.forEach((x, i) => {
            s.add(new Konva.Line({
                points: [x, yTop, x, yBot],
                stroke: colors[i], strokeWidth: 2,
            }));
        });
    }

    // ═══════════════════════════════════════════════════
    // 图片加载（实物图片）
    // ═══════════════════════════════════════════════════

    _createImageCells() {
        this._imgNodes = {};
        for (let n = 1; n <= 9; n++) {
            const file = CELL_IMAGES[n];
            if (!file) continue;
            const c = this._cells[n];
            const r = { x: c.x + 10, y: c.y + 10, w: c.w - 20, h: c.h - 20 };
            const imgNode = new Konva.Image({ x: r.x, y: r.y, width: r.w, height: r.h });
            this._staticGroup.add(imgNode);
            this._imgNodes[n] = { node: imgNode, rect: r };
            this._loadImage(n, file, r);
        }
    }

    _loadImage(n, url, r) {
        const img = new window.Image();
        img.onload = () => {
            const entry = this._imgNodes[n];
            if (!entry) return;
            // 等比缩放，使图片完全填充图片区域并居中
            const scale = Math.min(r.w / img.width, r.h / img.height);
            const iw = img.width * scale;
            const ih = img.height * scale;
            entry.node.image(img);
            entry.node.width(iw);
            entry.node.height(ih);
            entry.node.x(r.x + (r.w - iw) / 2);
            entry.node.y(r.y + (r.h - ih) / 2);
            // 强制刷新 Konva cache 以显示新图片
            this._forceCacheFlush();
        };
        img.src = url;
    }

    // ═══════════════════════════════════════════════════
    // 可点击部件（供工作流 find 步骤）
    // ═══════════════════════════════════════════════════

    _addClickableParts() {
        for (let n = 1; n <= 9; n++) {
            const c = this._cells[n];
            this.addClickablePart(PART_IDS[n], c.x, c.y, c.w, c.h);
        }
    }

    // ═══════════════════════════════════════════════════
    // 配置接口
    // ═══════════════════════════════════════════════════

    getConfigFields() {
        return [];
    }

    onConfigUpdate(newConfig) {
        if (newConfig.label !== undefined && newConfig.label !== this.label) {
            this.label = newConfig.label;
            this._staticGroup.destroyChildren();
            this._drawStaticParts();
            this._createImageCells();
            this._forceCacheFlush();
        }
    }
}
