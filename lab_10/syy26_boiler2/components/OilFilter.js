import { BaseComponent } from './BaseComponent.js';

/**
 * OilFilter — 滑油滤器（手动滤器 / 自清洗滤器）
 *
 * 简单功能（教学用）：
 *   · 进出口压差初始 0.01 MPa，每 riseInterval（默认 300s = 5min）增加 0.01 MPa；
 *   · 自清洗型（mode='selfclean'）：压差 ≥ 0.09 MPa 起动自动清洗，
 *     之后每 cleanInterval（默认 60s）压差下降 0.01 MPa，压差 < 0.03 MPa 停止清洗；
 *   · 手动型（mode='manual'）：只升不降，压差 ≥ 0.09 MPa 判定为「堵塞」。
 *
 * 流体端口：入口 i（右侧，来自第 4 三通）、出口 o（左侧，去第 5 三通）；
 * 管路流动方向为「右→左」。求解器按 `inP - 压差` 穿透（见 PneumaticSolver）。
 *
 * 遵循组件模板；动态节点 in-place 更新，不使用 shadow 三件套。
 */
export class OilFilter extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.W = Math.max(110, config.width || 133);   // 原 200 × 2/3
        this.H = Math.max(70, config.height || 80);    // 原 120 × 2/3

        this.type = 'oilFilter';
        this.special = 'oilfilter';
        this.cache = 'fixed';

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        this.config = {
            id: this.id, label: this.label, mode: this.mode,
            diffPressure: this.diffPressure, riseInterval: this.riseInterval, cleanInterval: this.cleanInterval,
        };

        // 入口在右（来自三通）、出口在左（去三通）
        this.addPort(this.W - 12, this._cy, 'i', 'pipe', 'in');
        this.addPort(12, this._cy, 'o', 'pipe');
    }

    // ═══════════════════════════════════════════════════════
    // 几何 / 参数
    // ═══════════════════════════════════════════════════════

    _recalcGeometry() {
        this._cy = this.H / 2;
    }

    _initParameters(config) {
        this.label = config.label || '滑油滤器';
        this.mode = config.mode || 'manual';            // manual | selfclean
        this.diffPressure = config.diffPressure !== undefined ? parseFloat(config.diffPressure) : 0.01; // MPa
        this.riseInterval = config.riseInterval !== undefined ? parseFloat(config.riseInterval) : 300;  // s，每 5min +0.01
        this.cleanInterval = config.cleanInterval !== undefined ? parseFloat(config.cleanInterval) : 60; // s，每 1min -0.01
        this._riseAcc = 0;
        this._cleanAcc = 0;
        this.cleaning = false;
    }

    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
    }

    // ═══════════════════════════════════════════════════════
    // 静态部件
    // ═══════════════════════════════════════════════════════

    _drawStaticParts() {
        const g = this._staticGroup;
        const bx = 22, by = 16, bw = this.W - 44, bh = this.H - 40;

        // 接管
        g.add(new Konva.Rect({ x: 0, y: this._cy - 8, width: 26, height: 16, fill: '#9aa3a8', stroke: '#7a8288', strokeWidth: 1 }));
        g.add(new Konva.Rect({ x: this.W - 26, y: this._cy - 8, width: 26, height: 16, fill: '#9aa3a8', stroke: '#7a8288', strokeWidth: 1 }));

        // 滤器壳体
        g.add(new Konva.Rect({ x: bx, y: by, width: bw, height: bh, fill: '#f0efe8', stroke: '#6b7280', strokeWidth: 2, cornerRadius: 6 }));
        // 滤网
        for (let i = 1; i < 6; i++) {
            const x = bx + (bw / 6) * i;
            g.add(new Konva.Line({ points: [x, by + 6, x, by + bh - 6], stroke: '#b9c0c6', strokeWidth: 2, listening: false }));
        }

        // 压差表底
        g.add(new Konva.Rect({ x: this.W / 2 - 46, y: -2, width: 92, height: 20, fill: '#1a1a1a', stroke: '#7f8c8d', strokeWidth: 1, cornerRadius: 3 }));

        // 名称
        g.add(new Konva.Text({
            x: 0, y: this.H - 16, width: this.W, text: this.label,
            fontSize: 13, fontStyle: 'bold', fill: '#2c3e50', align: 'center', listening: false,
        }));
    }

    // ═══════════════════════════════════════════════════════
    // 动态节点
    // ═══════════════════════════════════════════════════════

    _createDynamicNodes() {
        const d = this._dynamicGroup;

        this._dpText = new Konva.Text({
            x: this.W / 2 - 46, y: 0, width: 92, text: 'ΔP 0.01',
            fontSize: 13, fontFamily: 'Courier New', fontStyle: 'bold',
            fill: '#00ff00', align: 'center', listening: false,
        });
        d.add(this._dpText);

        this._statusText = new Konva.Text({
            x: 0, y: this.H - 34, width: this.W, text: '正常',
            fontSize: 12, fontStyle: 'bold', fill: '#27ae60', align: 'center', listening: false,
        });
        d.add(this._statusText);

        this._housing = new Konva.Rect({
            x: 22, y: 16, width: this.W - 44, height: this.H - 40,
            stroke: '#6b7280', strokeWidth: 2, cornerRadius: 6,
            fill: 'rgba(255,0,0,0)', listening: false,
        });
        d.add(this._housing);
    }

    _bindInteraction() {
        this.addClickablePart('body', 22, 16, this.W - 44, this.H - 40);
        this.addClickablePart('gauge', this.W / 2 - 46, -2, 92, 20);
    }

    // ═══════════════════════════════════════════════════════
    // tick：压差时间模型
    // ═══════════════════════════════════════════════════════

    tick(dt) {
        this._tickAcc = (this._tickAcc || 0) + dt;
        if (this._tickAcc < 0.2) { this.sys.requestRedraw(); return; }
        const step = this._tickAcc;
        this._tickAcc = 0;

        // 压差缓慢上升（每 riseInterval +0.01 MPa）
        this._riseAcc += step;
        while (this.riseInterval > 0 && this._riseAcc >= this.riseInterval) {
            this._riseAcc -= this.riseInterval;
            this.diffPressure = Math.min(0.2, this.diffPressure + 0.01);
        }

        // 自清洗
        if (this.mode === 'selfclean') {
            if (!this.cleaning && this.diffPressure >= 0.09) {
                this.cleaning = true;
                this._cleanAcc = 0;
            }
            if (this.cleaning) {
                this._cleanAcc += step;
                while (this.cleanInterval > 0 && this._cleanAcc >= this.cleanInterval) {
                    this._cleanAcc -= this.cleanInterval;
                    this.diffPressure = Math.max(0, this.diffPressure - 0.01);
                    if (this.diffPressure < 0.03) { this.cleaning = false; this._cleanAcc = 0; break; }
                }
            }
        }

        this._updateDynamic();
        this.sys.requestRedraw();
    }

    _updateDynamic() {
        const dp = this.diffPressure;
        if (this._dpText) {
            this._dpText.text('ΔP ' + dp.toFixed(2));
            this._dpText.fill(dp >= 0.09 ? '#ff3300' : (this.cleaning ? '#00d0ff' : '#00ff00'));
        }
        const clog = dp >= 0.09;
        if (this._statusText) {
            if (this.cleaning) { this._statusText.text('自动清洗中…'); this._statusText.fill('#00a0d0'); }
            else if (clog) { this._statusText.text(this.mode === 'selfclean' ? '待清洗' : '堵塞'); this._statusText.fill('#c0392b'); }
            else { this._statusText.text('正常'); this._statusText.fill('#27ae60'); }
        }
        if (this._housing) this._housing.fill(clog && !this.cleaning ? 'rgba(231,76,60,0.18)' : (this.cleaning ? 'rgba(0,160,208,0.15)' : 'rgba(255,0,0,0)'));
    }

    // ═══════════════════════════════════════════════════════
    // 公开 API
    // ═══════════════════════════════════════════════════════

    getDiffPressure() { return this.diffPressure; }

    setDiffPressure(p) {
        this.diffPressure = Math.max(0, parseFloat(p) || 0);
        this._updateDynamic();
    }

    /** 复位滤器（压差回 0.01、停止清洗） */
    reset() {
        this.diffPressure = 0.01;
        this.cleaning = false;
        this._riseAcc = 0;
        this._cleanAcc = 0;
        this._updateDynamic();
    }

    /** 是否处于堵塞状态（压差 ≥ 0.09） */
    isClogged() { return this.diffPressure >= 0.09; }

    /** 局部坐标 → 舞台绝对坐标 */
    _toAbs(x, y) {
        try { return this.group.getAbsoluteTransform().point({ x, y }); }
        catch (e) { return { x: this.group.x() + x, y: this.group.y() + y }; }
    }

    getClickablePartCenter(partId) {
        switch (partId) {
            case 'body':  return this._toAbs(this.W / 2, this._cy);
            case 'gauge': return this._toAbs(this.W / 2, 8);
            case 'i':     return this._toAbs(this.W - 12, this._cy);
            case 'o':     return this._toAbs(12, this._cy);
            default:      return null;
        }
    }

    getConfigFields() {
        return [
            { label: '器件名称 (ID)', key: 'id', type: 'text' },
            { label: '位号/名称', key: 'label', type: 'text' },
            {
                label: '滤器型式', key: 'mode', type: 'select',
                options: [
                    { label: '手动滤器', value: 'manual' },
                    { label: '自清洗滤器', value: 'selfclean' },
                ],
            },
            { label: '初始压差 (MPa)', key: 'diffPressure', type: 'number' },
            { label: '升压周期 (s)', key: 'riseInterval', type: 'number' },
            { label: '清洗周期 (s)', key: 'cleanInterval', type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.id) this.id = cfg.id;
        if (cfg.label !== undefined) this.label = cfg.label;
        if (cfg.mode !== undefined) this.mode = (cfg.mode === 'selfclean') ? 'selfclean' : 'manual';
        if (cfg.diffPressure !== undefined) this.diffPressure = Math.max(0, parseFloat(cfg.diffPressure) || 0);
        if (cfg.riseInterval !== undefined) this.riseInterval = parseFloat(cfg.riseInterval) || 300;
        if (cfg.cleanInterval !== undefined) this.cleanInterval = parseFloat(cfg.cleanInterval) || 60;
        this.config = { ...this.config, ...cfg };
        this._updateDynamic();
    }

    destroy() { super.destroy?.(); }
}

export default OilFilter;
