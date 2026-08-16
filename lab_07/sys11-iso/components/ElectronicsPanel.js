import { BaseComponent } from './BaseComponent.js';
import imgResistor from '../images/01-1resistor.jpg';
import imgCapacitor from '../images/01-2capcitor.jpg';
import imgDiode from '../images/01-3diode.jpg';
import imgTransistor from '../images/01-4transistor.jpg';
import imgScr from '../images/01-5thyristor.jpg';
import imgInductor from '../images/01-6lenz.jpg';

/**
 * ElectronicsPanel 电子元器件面板（纯视觉展示组件）
 * 尺寸 800×720，3 行 2 列，用于加载对应的元器件实物图片。
 *
 * 布局（2 列 × 3 行）：
 *  - 顶部标题栏
 *  - 第 1 行：电阻、电容
 *  - 第 2 行：二极管、三极管
 *  - 第 3 行：晶闸管、电感
 *
 * 无端口、不参与电路求解；6 个格子均通过 addClickablePart 注册可点击区域，
 * 供工作流 find 步骤（考核点击识别元器件）使用。
 */

const PANEL_W = 800;
const PANEL_H = 720;
const TITLE_H = 34;
const PAD = 12;
const GAP = 10;

// 6 个格子（行优先）对应加载的实物图片
const CELL_IMAGES = [
    imgResistor,   imgCapacitor,   // 第 1 行
    imgDiode,      imgTransistor,  // 第 2 行
    imgScr,        imgInductor,    // 第 3 行
];

// 各格可点击部件 id（供工作流 find 步骤识别）
const PART_IDS = [
    'cell-resistor',
    'cell-capacitor',
    'cell-diode',
    'cell-transistor',
    'cell-scr',
    'cell-inductor',
];

const CELL_W = (PANEL_W - PAD * 2 - GAP) / 2;
const CELL_H = (PANEL_H - TITLE_H - PAD * 2 - GAP * 2) / 3;

export class ElectronicsPanel extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(300, config.width  || PANEL_W);
        this.height = Math.max(300, config.height || PANEL_H);

        this.type  = 'elec_panel';
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

        this._cols = [PAD, PAD + CELL_W + GAP];
        this._rows = [
            TITLE_H + PAD,
            TITLE_H + PAD + CELL_H + GAP,
            TITLE_H + PAD + 2 * (CELL_H + GAP),
        ];

        this._cells = [];
        for (let i = 0; i < 6; i++) {
            const r = Math.floor(i / 2);
            const c = i % 2;
            this._cells.push({ x: this._cols[c], y: this._rows[r], w: CELL_W, h: CELL_H });
        }
    }

    // ═══════════════════════════════════════════════════
    // 参数初始化
    // ═══════════════════════════════════════════════════

    _initParameters(config) {
        this.label = config.label || '电子元器件面板';
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

        // 面板壳体
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
            text: this.label, fontSize: 16, fontStyle: 'bold', fill: '#ffffff',
        }));

        // 各器件格子边框
        this._cells.forEach((c, i) => {
            s.add(new Konva.Rect({
                x: c.x, y: c.y, width: c.w, height: c.h,
                fill: '#ffffff', stroke: '#9aa4ac', strokeWidth: 1.5,
                cornerRadius: 2,
            }));
        });
    }

    // ═══════════════════════════════════════════════════
    // 图片加载（元器件实物图片）
    // ═══════════════════════════════════════════════════

    _createImageCells() {
        this._imgNodes = {};
        for (let i = 0; i < 6; i++) {
            const c = this._cells[i];
            const r = { x: c.x + 8, y: c.y + 8, w: c.w - 16, h: c.h - 16 };
            const imgNode = new Konva.Image({ x: r.x, y: r.y, width: r.w, height: r.h });
            this._staticGroup.add(imgNode);
            this._imgNodes[i] = { node: imgNode, rect: r };
            this._loadImage(i, CELL_IMAGES[i], r);
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
        this._cells.forEach((c, i) => {
            this.addClickablePart(PART_IDS[i], c.x, c.y, c.w, c.h);
        });
    }

    // ═══════════════════════════════════════════════════
    // 配置接口
    // ═══════════════════════════════════════════════════

    getConfigFields() {
        return [
            { label: '面板名称', key: 'label', type: 'text' },
        ];
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
