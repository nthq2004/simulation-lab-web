import { BaseComponent } from './BaseComponent.js';

/**
 * 塞尺（Feeler Gauge / Thickness Gauge）仿真组件
 *
 * 用途：测量圆盘式电磁制动器（DiscElectromagneticBrake）的"工作气隙"。
 * 原理：将不同厚度的薄钢片（塞尺片）插入被测间隙：
 *         - 塞尺片厚度 ≤ 气隙  → 顺利插入
 *         - 塞尺片厚度 > 气隙  → 卡阻（无法插入）
 *       能插入的最大厚度 ≤ 气隙 < 不能插入的最小厚度，从而估计气隙大小。
 *
 * 外观：底部手柄 + 顶部扇形排列的塞尺片（0.3/0.5/0.8/1.0/1.2/1.5mm）。
 * 交互：点击某片选中 → 再点手柄右侧「测量」按钮插入制动器气隙，
 *       结果以彩色文字显示在手柄左侧（顺利插入 / 卡阻）。
 *
 * 端口：无（工具类组件，不参与电路/气路）。
 */
export class FeelerGauge extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(240, config.width  || 300);
        this.height = Math.max(220, config.height || 280);

        this.type  = 'FEELER';
        this.cache = 'fixed';

        // 塞尺片厚度系列（mm）
        this._blades = config.blades || [0.3, 0.5, 0.6, 0.8, 1.0, 1.2, 1.5];
        this._bladeIndex = config.bladeIndex !== undefined
            ? Math.max(0, Math.min(this._blades.length - 1, config.bladeIndex))
            : 3;   // 默认选中 0.8mm

        this._lastResult = null;

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        this.config = {
            id: this.id,
            label:      this.label,
            blades:     this._blades,
            bladeIndex: this._bladeIndex,
        };
    }

    // ═══════════════════════════════════════════
    // 几何尺寸
    // ═══════════════════════════════════════════

    _recalcGeometry() {
        const W = this.width, H = this.height;
        this._frame = { x: 2, y: 2, w: W - 4, h: H - 4, rx: 8 };

        // 底部手柄
        this._bodyH = H * 0.30;
        this._bodyY = H - this._bodyH;

        // 塞尺片扇形枢轴（手柄顶部中心）
        this._pivotX = W / 2;
        this._pivotY = this._bodyY - 2;
        this._bladeLen = this._bodyY - 22;
        this._bladeW = Math.max(4, W * 0.02);

        // 测量按钮（手柄右侧）
        this._btnW = W * 0.22;
        this._btnH = Math.min(30, this._bodyH * 0.52);
        this._btnX = W - this._btnW - 10;
        this._btnY = this._bodyY + (this._bodyH - this._btnH) / 2;

        // 读数 / 结果文字区（手柄左侧）
        this._readoutX = 10;
        this._readoutY = this._bodyY + 10;
        this._resX = 10;
        this._resY = this._bodyY + this._bodyH * 0.50;
        this._resW = this._btnX - 18;
    }

    _initParameters(config) {
        this.label    = config.label    || '塞尺';
        this.function = config.function || '塞尺（测量工作气隙）';
    }

    // ═══════════════════════════════════════════
    // 主初始化
    // ═══════════════════════════════════════════

    _init() {
        this._drawStaticParts();
        this._createBlades();
        this._addClickableParts();
        this._updateDisplay();
    }

    // ═══════════════════════════════════════════
    // 静态部件
    // ═══════════════════════════════════════════

    _drawStaticParts() {
        const f = this._frame;
        this._staticGroup.add(new Konva.Rect({
            x: f.x, y: f.y, width: f.w, height: f.h,
            fill: '#eef1f8', stroke: '#b0a698', strokeWidth: 1.5, cornerRadius: f.rx,
        }));

        // 标题
        this._staticGroup.add(new Konva.Text({
            x: 10, y: 6, text: this.label, fontSize: 15, fontStyle: 'bold', fill: '#303848',
            listening: false,
        }));

        // 手柄外框
        const bx = 6, bw = this.width - 12;
        this._staticGroup.add(new Konva.Rect({
            x: bx, y: this._bodyY, width: bw, height: this._bodyH - 8,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint: { x: 0, y: this._bodyH },
            fillLinearGradientColorStops: [0, '#6a7080', 0.5, '#4a5060', 1, '#3a4048'],
            stroke: '#282c3a', strokeWidth: 1.2, cornerRadius: 4,
        }));

        // 枢轴金属轴
        this._staticGroup.add(new Konva.Circle({
            x: this._pivotX, y: this._pivotY, radius: 6,
            fill: '#c0c8d0', stroke: '#707880', strokeWidth: 1.2, listening: false,
        }));

        // 测量按钮
        const bwBtn = this._btnW, bh = this._btnH;
        this._staticGroup.add(new Konva.Rect({
            x: this._btnX, y: this._btnY, width: bwBtn, height: bh,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint: { x: 0, y: bh },
            fillLinearGradientColorStops: [0, '#f0b060', 0.5, '#e08830', 1, '#c07020'],
            stroke: '#8a5a18', strokeWidth: 1.2, cornerRadius: 4,
        }));
        this._staticGroup.add(new Konva.Text({
            x: this._btnX, y: this._btnY + (bh - 18) / 2, width: bwBtn, align: 'center',
            text: '测量', fontSize: 16, fontStyle: 'bold', fill: '#ffffff', listening: false,
        }));
    }

    // ═══════════════════════════════════════════
    // 动态层：塞尺片扇形 + 读数 + 结果
    // ═══════════════════════════════════════════

    _createBlades() {
        this._bladeGroups = this._blades.map((t, i) => {
            const angle = this._bladeAngle(i);
            const a = angle * Math.PI / 180;
            const len = this._bladeLen * (i === this._bladeIndex ? 1.0 : 0.90);
            const rect = new Konva.Rect({
                x: this._pivotX, y: this._pivotY,
                width: len, height: this._bladeW,
                offsetY: this._bladeW / 2,
                rotation: angle,
                fill: i === this._bladeIndex ? 'rgba(180,210,255,0.95)' : 'rgba(200,210,230,0.55)',
                stroke: i === this._bladeIndex ? '#2050b0' : '#8a94a8',
                strokeWidth: i === this._bladeIndex ? 1.6 : 1,
                cornerRadius: 2,
            });
            const text = new Konva.Text({
                x: this._pivotX + Math.cos(a) * (len * 0.52) - 14,
                y: this._pivotY + Math.sin(a) * (len * 0.52) - 8,
                width: 28, align: 'center',
                text: String(t), fontSize: 11, fontStyle: 'bold',
                fill: i === this._bladeIndex ? '#2050b0' : '#707a90',
            });
            const g = new Konva.Group({ listening: false });
            g.add(rect); g.add(text);
            this._dynamicGroup.add(g);
            return { rect, text, angle };
        });

        this._readoutText = new Konva.Text({
            x: this._readoutX, y: this._readoutY,
            text: '', fontSize: 13, fontStyle: 'bold', fill: '#e8e8e8', listening: false,
        });
        this._dynamicGroup.add(this._readoutText);

        this._resultText = new Konva.Text({
            x: this._resX, y: this._resY, width: this._resW,
            text: '', fontSize: 12, fontStyle: 'bold', fill: '#ffffff',
            wrap: 'word', listening: false,
        });
        this._dynamicGroup.add(this._resultText);
    }

    /** 塞尺片扇形角度（打开向上，中间一片竖直） */
    _bladeAngle(i) {
        const n = this._blades.length;
        return n <= 1 ? -90 : -120 + (i / (n - 1)) * 60;
    }

    // ═══════════════════════════════════════════
    // 交互
    // ═══════════════════════════════════════════

    _addClickableParts() {
        // 每片塞尺片：沿叶片方向的长条热区（点击选中）
        this._blades.forEach((t, i) => {
            const angle = this._bladeAngle(i);
            const hit = new Konva.Rect({
                x: this._pivotX, y: this._pivotY,
                width: this._bladeLen, height: 22, offsetY: 11, rotation: angle,
                fill: 'transparent', cursor: 'pointer',
            });
            hit.on('click tap', (e) => {
                e.cancelBubble = true;
                this.sys.lastClickedId = this.id;
                this.sys.lastClickedPartId = this.id + '/blade_' + i;
                this.setBlade(i);
            });
            hit.on('mouseenter', () => { document.body.style.cursor = 'pointer'; });
            hit.on('mouseleave', () => { document.body.style.cursor = 'default'; });
            this._interactGroup.add(hit);
        });

        // 测量按钮
        const hitBtn = new Konva.Rect({
            x: this._btnX, y: this._btnY, width: this._btnW, height: this._btnH,
            fill: 'transparent', cursor: 'pointer',
        });
        hitBtn.on('click tap', (e) => {
            e.cancelBubble = true;
            this.sys.lastClickedId = this.id;
            this.sys.lastClickedPartId = this.id + '/measure';
            this.measure();
        });
        hitBtn.on('mouseenter', () => { document.body.style.cursor = 'pointer'; });
        hitBtn.on('mouseleave', () => { document.body.style.cursor = 'default'; });
        this._interactGroup.add(hitBtn);
    }

    // ═══════════════════════════════════════════
    // 公开 API
    // ═══════════════════════════════════════════

    getBladeIndex()       { return this._bladeIndex; }
    getBlade()            { return this._blades[this._bladeIndex]; }
    getBlades()           { return this._blades.slice(); }
    getLastResult()       { return this._lastResult; }

    /** 选择塞尺片 */
    setBlade(i) {
        const n = this._blades.length;
        if (i < 0 || i >= n) return;
        if (this._bladeIndex === i) return;
        this._bladeIndex = i;
        this._lastResult = null;
        this._updateDisplay();
    }

    /** 将当前塞尺片插入制动器气隙并判定（可插入 / 卡阻） */
    measure() {
        const sys = this.sys || window.sys;
        const brk = sys && sys.comps ? sys.comps['brk1'] : null;
        const t = this._blades[this._bladeIndex];
        this._lastResult = null;

        if (!brk) {
            this._setResult('未找到制动器 brk1', '#f0b060');
            return;
        }
        if (brk._state === 'on' || (typeof brk.isEnergized === 'function' && brk.isEnergized())) {
            this._setResult('制动器已通电松闸（气隙闭合），请先断电抱闸再测量', '#f0b060');
            return;
        }
        const gap = typeof brk.getAirGap === 'function' ? brk.getAirGap() : brk._airGapMM;
        // 塞尺片严格小于气隙才可插入；等于气隙视为卡阻（紧配合/无法滑入）
        const result = t < gap
            ? { insert: true, blade: t, gap }
            : { insert: false, blade: t, gap };
        this._lastResult = result;
        if (!Array.isArray(this._measureLog)) this._measureLog = [];
        this._measureLog.push(result);
        if (this._measureLog.length > 2) this._measureLog.shift();
        if (result.insert) {
            this._setResult(`塞尺 ${t.toFixed(2)}mm 顺利插入 → 气隙 > ${t.toFixed(2)}mm`, '#7CFF7C');
        } else {
            this._setResult(`塞尺 ${t.toFixed(2)}mm 卡阻 → 气隙 ≤ ${t.toFixed(2)}mm`, '#FF9B9B');
        }
    }

    _setResult(text, color) {
        if (!this._resultText) return;
        this._resultText.text(text);
        this._resultText.fill(color);
        if (this.sys && typeof this.sys.requestRedraw === 'function') this.sys.requestRedraw();
    }

    _updateBladeVisual() {
        if (!this._bladeGroups) return;
        this._bladeGroups.forEach((bg, i) => {
            const sel = i === this._bladeIndex;
            const a = bg.angle * Math.PI / 180;
            const len = this._bladeLen * (sel ? 1.0 : 0.90);
            bg.rect.width(len);
            bg.rect.fill(sel ? 'rgba(180,210,255,0.95)' : 'rgba(200,210,230,0.55)');
            bg.rect.stroke(sel ? '#2050b0' : '#8a94a8');
            bg.rect.strokeWidth(sel ? 1.6 : 1);
            bg.text.x(this._pivotX + Math.cos(a) * (len * 0.52) - 14);
            bg.text.y(this._pivotY + Math.sin(a) * (len * 0.52) - 8);
            bg.text.fill(sel ? '#2050b0' : '#707a90');
        });
    }

    _updateDisplay() {
        this._updateBladeVisual();
        if (this._readoutText) {
            const t = this._blades[this._bladeIndex];
            this._readoutText.text(`当前塞尺片：${t.toFixed(2)} mm`);
        }
        if (this.sys && typeof this.sys.requestRedraw === 'function') this.sys.requestRedraw();
    }

    getConfigFields() {
        return [
            { label: '位号/名称',       key: 'label',      type: 'text'   },
            { label: '默认选中片索引',   key: 'bladeIndex', type: 'number', min: 0, max: Math.max(0, this._blades.length - 1) },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label !== undefined) this.label = cfg.label;
        if (cfg.bladeIndex !== undefined) {
            this._bladeIndex = Math.max(0, Math.min(this._blades.length - 1, parseInt(cfg.bladeIndex, 10)));
        }
        this.config = { ...this.config, ...cfg };
        this._updateDisplay();
    }

    destroy() { super.destroy?.(); }
}
