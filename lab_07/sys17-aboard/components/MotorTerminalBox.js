import { BaseComponent } from './BaseComponent.js';

export class MotorTerminalBox extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(420, config.width  || 600);
        this.height = Math.max(320, config.height || 440);

        this.type  = 'motor_winding';
        this.cache = 'fixed';
        this._btnClickTime = 0;

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        this.config = {
            id: this.id,
            label:    this.label,
            windingR: this.windingR,
            windingL: this.windingL,
            mutualL:  this.mutualL,
        };

        this.addPort(this._tp.u1.x, this._tp.u1.y, 'u1', 'wire', 'p');
        this.addPort(this._tp.u2.x, this._tp.u2.y, 'u2', 'wire', 'p');
        this.addPort(this._tp.v1.x, this._tp.v1.y, 'v1', 'wire', 'p');
        this.addPort(this._tp.v2.x, this._tp.v2.y, 'v2', 'wire', 'p');
        this.addPort(this._tp.w1.x, this._tp.w1.y, 'w1', 'wire', 'p');
        this.addPort(this._tp.w2.x, this._tp.w2.y, 'w2', 'wire', 'p');
    }

    _recalcGeometry() {
        const W = this.width, H = this.height;
        const pad = 8;

        this._frame = { x: 2, y: 2, w: W - 4, h: H - 4, rx: 6 };

        // 左侧接线盒区 — 45%
        this._boxL = pad;
        this._boxT = 30;
        this._boxW = W * 0.45 - pad * 2;
        this._boxH = H - 80;

        // 右侧绕组区 — 50%
        this._wdL = W * 0.48;
        this._wdT = this._boxT;
        this._wdW = W - this._wdL - pad;
        this._wdH = this._boxH;

        // 接线盒内端子布局
        const bx = this._boxL + this._boxW / 2;
        const by = this._boxT + 20;
        const rowH = this._boxH - 70;
        const halfSpan = this._boxW * 0.33;

        const termY1 = by + rowH * 0.32;
        const termY2 = by + rowH * 0.72;

        this._tp = {};
        this._tp.u1 = { x: bx - halfSpan, y: termY1 };
        this._tp.v1 = { x: bx,             y: termY1 };
        this._tp.w1 = { x: bx + halfSpan, y: termY1 };
        this._tp.w2 = { x: bx - halfSpan, y: termY2 };
        this._tp.u2 = { x: bx,             y: termY2 };
        this._tp.v2 = { x: bx + halfSpan, y: termY2 };

        this._termR = 9;

        // 分色
        this._termColors = {
            u1: '#e03030', u2: '#e03030',
            v1: '#20a030', v2: '#20a030',
            w1: '#2050e0', w2: '#2050e0',
        };
        this._termPhase = {
            u1: 'U', u2: 'U',
            v1: 'V', v2: 'V',
            w1: 'W', w2: 'W',
        };

        // 展开图
        const wcx = this._wdL + this._wdW / 2;
        const wcy = this._wdT + this._wdH * 0.50;
        const wR  = Math.min(this._wdW, this._wdH) * 0.30;

        this._wdCX = wcx;
        this._wdCY = wcy;
        this._wdR  = wR;

        this._phases = [
            { name: 'U', end1: 'U1', end2: 'U2', color: '#e03030', angle: -90, deg: -90 },
            { name: 'V', end1: 'V1', end2: 'V2', color: '#20a030', angle:  30, deg:  30 },
            { name: 'W', end1: 'W1', end2: 'W2', color: '#2050e0', angle: 150, deg: 150 },
        ].map(p => {
            const rad = p.angle * Math.PI / 180;
            const cx = wcx + wR * Math.cos(rad);
            const cy = wcy + wR * Math.sin(rad);
            const outR = wR + 58;
            const inR  = wR - 58;
            return {
                ...p,
                cx, cy,
                ox: wcx + outR * Math.cos(rad),
                oy: wcy + outR * Math.sin(rad),
                ix: wcx + inR  * Math.cos(rad),
                iy: wcy + inR  * Math.sin(rad),
            };
        });

        this._neutralX = wcx;
        this._neutralY = wcy;

        // 按钮
        const bw = Math.min(120, (this._boxW - 10) / 3);
        const bh = 32;
        const btnY = this._boxT + this._boxH + 10;
        this._btnY = [
            { x: this._boxL + 5,           y: btnY, w: bw, h: bh, label: 'Y 接法',    id: 'btnY' },
            { x: this._boxL + bw + 10,     y: btnY, w: bw, h: bh, label: 'Δ 接法',    id: 'btnD' },
            { x: this._boxL + bw * 2 + 15, y: btnY, w: bw, h: bh, label: '清空连线',  id: 'btnClr' },
        ];

        // 状态文字
        this._statusY = btnY + bh + 8;
    }

    _initParameters(config) {
        this.label     = config.label || 'M';
        this.windingR  = config.windingR  !== undefined ? config.windingR  : 2.5;
        this.windingL  = config.windingL  !== undefined ? config.windingL  : 0.082;
        this.mutualL   = config.mutualL   !== undefined ? config.mutualL   : -0.039;
        this.function  = config.function  || '三相绕组接线盒';

        this._connType  = 'none'; // 'none' | 'Y' | 'D' | 'custom'
        this._jumpConn  = [];

        this.phaseCurrents = { u: 0, v: 0, w: 0 };
    }

    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
    }

    // ═══════════════════════════════════════════
    // 静态绘制
    // ═══════════════════════════════════════════

    _drawStaticParts() {
        this._drawFrame();
        this._drawTerminalBox();
        this._drawTerminals();
        this._drawCoils();
        this._drawButtons();
    }

    _drawFrame() {
        const f = this._frame;
        this._staticGroup.add(new Konva.Rect({
            x: f.x, y: f.y, width: f.w, height: f.h,
            fill: '#e0e2ec', stroke: '#b0a898', strokeWidth: 1.5, cornerRadius: f.rx,
        }));
        // 标题栏
        this._staticGroup.add(new Konva.Rect({
            x: f.x + 2, y: f.y + 2, width: f.w - 4, height: 22,
            fill: 'rgba(40,80,180,0.12)', cornerRadius: [f.rx, f.rx, 0, 0],
        }));
        const fs = Math.max(14, this.width * 0.020);
        this._staticGroup.add(new Konva.Text({
            x: f.x + 6, y: f.y + 1,
            text: this.function,
            fontSize: fs, fill: '#0c0c0c',
        }));
    }

    _drawTerminalBox() {
        const { x, y, w, h } = { x: this._boxL, y: this._boxT, w: this._boxW, h: this._boxH };
        // 接线盒面板
        this._staticGroup.add(new Konva.Rect({
            x, y, width: w, height: h,
            fill: '#c8c0a0', stroke: '#908060', strokeWidth: 1.5, cornerRadius: 4,
        }));
        // 内部浅色区
        this._staticGroup.add(new Konva.Rect({
            x: x + 4, y: y + 4, width: w - 8, height: h - 8,
            fill: '#e8e4dc', stroke: '#b0a898', strokeWidth: 0.8, cornerRadius: 2,
        }));
        // 横隔板
        const divY = y + h * 0.52;
        this._staticGroup.add(new Konva.Line({
            points: [x + 8, divY, x + w - 8, divY],
            stroke: '#908060', strokeWidth: 3, lineCap: 'round',
        }));
    }

    _drawTerminals() {
        const R = this._termR;
        const names = ['u1','v1','w1','w2','u2','v2'];
        const labels = { u1:'U1', v1:'V1', w1:'W1', w2:'W2', u2:'U2', v2:'V2' };
        names.forEach(name => {
            const p = this._tp[name];
            const color = this._termColors[name];
            // 黄铜接线柱
            this._staticGroup.add(new Konva.Circle({
                x: p.x, y: p.y, radius: R,
                fillLinearGradientStartPoint: { x: -R, y: -R },
                fillLinearGradientEndPoint:   { x:  R, y:  R },
                fillLinearGradientColorStops: [0, '#9a8030', 0.4, '#e8c050', 0.7, '#f8d870', 1, '#9a8030'],
                stroke: '#7a6028', strokeWidth: 1.2,
            }));
            // 色环
            this._staticGroup.add(new Konva.Circle({
                x: p.x, y: p.y, radius: R * 0.52,
                fill: color, stroke: '#666', strokeWidth: 0.8,
            }));
            // 中心点
            this._staticGroup.add(new Konva.Circle({
                x: p.x, y: p.y, radius: 2.5, fill: '#333',
            }));
            // 标签
            const fs = Math.max(11, this.width * 0.014);
            this._staticGroup.add(new Konva.Text({
                x: p.x - 12, y: p.y + R + 3,
                text: labels[name], fontSize: fs,
                fontStyle: 'bold', fill: color,
            }));
        });
    }

    /** 右侧三相绕组线圈符号 — 绕线绕在矩形铁芯外围 */
    _drawCoils() {
        const coilW = 64, coilH = 24;
        const numTurns = 2, turnSpacing = 3, gap = 8;
        this._phases.forEach(p => {
            const rot = p.deg || 0;
            const grp = new Konva.Group({ x: p.cx, y: p.cy, rotation: rot });
            this._staticGroup.add(grp);

            // 引出线（粗线，从最外匝直接引出）
            const leadStart = coilW/2 + numTurns * turnSpacing;
            const leadEnd   = coilW/2 + 26;
            grp.add(new Konva.Line({
                points: [-leadStart, 0, -leadEnd, 0],
                stroke: p.color, strokeWidth: 3.5, lineCap: 'round',
            }));
            grp.add(new Konva.Line({
                points: [leadStart, 0, leadEnd, 0],
                stroke: p.color, strokeWidth: 3.5, lineCap: 'round',
            }));

            // 4 圈绕线（从内到外逐圈外扩）
            for (let i = 0; i < numTurns; i++) {
                const s = (i + 1) * turnSpacing;
                const hw = coilW/2 + s, hh = coilH/2 + s;

                // 顶部弧线（绕到铁芯前面）
                grp.add(new Konva.Line({
                    points: [-hw, -hh, 0, -hh - 3, hw, -hh],
                    stroke: p.color, strokeWidth: 1.8, tension: 0.4, lineCap: 'round',
                }));
                // 右侧竖线
                grp.add(new Konva.Line({
                    points: [hw, -hh, hw, hh],
                    stroke: p.color, strokeWidth: 1.8, lineCap: 'round',
                }));
                // 底部左段
                grp.add(new Konva.Line({
                    points: [-hw, hh, -gap/2, hh],
                    stroke: p.color, strokeWidth: 1.8, lineCap: 'round',
                }));
                // 底部右段（与左段之间留 gap，体现螺旋绕向）
                grp.add(new Konva.Line({
                    points: [gap/2, hh, hw, hh],
                    stroke: p.color, strokeWidth: 1.8, lineCap: 'round',
                }));
                // 左侧竖线
                grp.add(new Konva.Line({
                    points: [-hw, -hh, -hw, hh],
                    stroke: p.color, strokeWidth: 1.8, lineCap: 'round',
                }));
            }

            // 铁芯（最内层）
            grp.add(new Konva.Rect({
                x: -coilW/2, y: -coilH/2,
                width: coilW, height: coilH,
                fill: '#3a3a4a', stroke: '#889', strokeWidth: 1, cornerRadius: 3,
            }));

            const fs = Math.max(14, this.width * 0.014);
            // 外端标注 (U1/V1/W1)
            this._staticGroup.add(new Konva.Text({
                x: p.ox - 26, y: p.oy +7,
                text: p.end1, fontSize: fs, fontStyle: 'bold', fill: p.color,
            }));
            // 内端标注 (U2/V2/W2)
            this._staticGroup.add(new Konva.Text({
                x: p.ix - 26, y: p.iy - 16,
                text: p.end2, fontSize: fs, fontStyle: 'bold', fill: p.color,
            }));
        });
    }

    _drawButtons() {
        this._btnY.forEach(btn => {
            const color = btn.id === 'btnY' ? '#304080'
                       : btn.id === 'btnD' ? '#805030' : '#606060';
            this._staticGroup.add(new Konva.Rect({
                x: btn.x, y: btn.y, width: btn.w, height: btn.h,
                fill: color, stroke: '#888', strokeWidth: 1, cornerRadius: 4,
            }));
            this._staticGroup.add(new Konva.Text({
                x: btn.x, y: btn.y + 6, width: btn.w,
                text: btn.label,
                fontSize: Math.max(13, this.width * 0.017),
                fill: '#e0e0e0', align: 'center',
            }));
        });
    }

    // ═══════════════════════════════════════════
    // 动态层
    // ═══════════════════════════════════════════

    _createDynamicNodes() {
        this._wdGroup = new Konva.Group({ listening: false });
        this._dynamicGroup.add(this._wdGroup);

        this._statusText = new Konva.Text({
            x: this._wdL, y: this._statusY-30,
            text: '当前接线：无连接',
            fontSize: Math.max(16, this.width * 0.016),
            fill: '#404040', listening: false,
        });
        this._dynamicGroup.add(this._statusText);
    }

    _updateDynamic() {
        this._readConnections();
        this._drawWindingDiagram();
    }

    // ═══════════════════════════════════════════
    // 读取接线拓扑 → 判定接线类型
    // ═══════════════════════════════════════════

    _readConnections() {
        const portId = (name) => `${this.id}_wire_${name}`;
        const ptc = this.sys.voltageSolver.portToCluster;
        const get = (name) => ptc.get(portId(name));

        // 读取 sys.conns 中本组件的所有 wire 连接
        this._jumpConn = this.sys.conns.filter(c =>
            c.type === 'wire' &&
            (c.from.startsWith(this.id) || c.to.startsWith(this.id))
        );

        // 通过簇判定接线模式
        const cu2 = get('u2'), cv2 = get('v2'), cw2 = get('w2');
        const cu1 = get('u1'), cv1 = get('v1'), cw1 = get('w1');

        if (cu2 !== undefined && cv2 !== undefined && cw2 !== undefined &&
            cu2 === cv2 && cv2 === cw2) {
            this._connType = 'Y';
        } else if (cu1 !== undefined && cw2 !== undefined && cu1 === cw2 &&
                   cv1 !== undefined && cu2 !== undefined && cv1 === cu2 &&
                   cw1 !== undefined && cv2 !== undefined && cw1 === cv2) {
            this._connType = 'D';
        } else if (this._jumpConn.length === 0) {
            this._connType = 'none';
        } else {
            this._connType = 'custom';
        }
    }

    /** 右侧绕组接线图动态连接线 */
    _drawWindingDiagram() {
        this._wdGroup.destroyChildren();

        const phases = this._phases;
        const fs = Math.max(12, this.width * 0.015);

        if (this._connType === 'Y') {
            // 尾端汇聚到中性点
            phases.forEach(p => {
                this._wdGroup.add(new Konva.Line({
                    points: [p.ix, p.iy, this._neutralX, this._neutralY],
                    stroke: p.color, strokeWidth: 2.5, lineCap: 'round',
                }));
            });
            // 中性点圆
            this._wdGroup.add(new Konva.Circle({
                x: this._neutralX, y: this._neutralY, radius: 7,
                fillLinearGradientStartPoint: { x: -7, y: -7 },
                fillLinearGradientEndPoint:   { x:  7, y:  7 },
                fillLinearGradientColorStops: [0, '#9a8030', 0.5, '#e8c050', 1, '#9a8030'],
                stroke: '#7a6028', strokeWidth: 1.2,
            }));
            this._wdGroup.add(new Konva.Text({
                x: this._neutralX + 10, y: this._neutralY - 8,
                text: 'N', fontSize: fs, fontStyle: 'bold', fill: '#d4a838',
            }));
            this._statusText.text('当前接线：Y 星形接法');

        } else if (this._connType === 'D') {
            // 三角形：U1→W2, V1→U2, W1→V2
            const tri = [
                { from: phases[0].ox, fy: phases[0].oy, to: phases[2].ix, ty: phases[2].iy, color: phases[0].color },
                { from: phases[1].ox, fy: phases[1].oy, to: phases[0].ix, ty: phases[0].iy, color: phases[1].color },
                { from: phases[2].ox, fy: phases[2].oy, to: phases[1].ix, ty: phases[1].iy, color: phases[2].color },
            ];
            tri.forEach(({ from, fy, to, ty, color }) => {
                this._wdGroup.add(new Konva.Line({
                    points: [from, fy, to, ty],
                    stroke: color, strokeWidth: 2.5, lineCap: 'round',
                }));
                this._wdGroup.add(new Konva.Circle({
                    x: to, y: ty, radius: 4,
                    fill: color, stroke: '#fff', strokeWidth: 0.8,
                }));
            });
            this._statusText.text('当前接线：Δ 三角形接法');

        } else {
            // 自定义：按实际跳线绘制
            let hasAny = false;
            this._jumpConn.forEach(c => {
                const a = this._extractTermName(c.from) || this._extractTermName(c.to);
                const b = this._extractTermName(c.to)   || this._extractTermName(c.from);
                if (!a || !b || a === b) return;
                const pf = this._getPhaseEnd(a);
                const pt = this._getPhaseEnd(b);
                if (!pf || !pt) return;
                hasAny = true;
                this._wdGroup.add(new Konva.Line({
                    points: [pf.x, pf.y, pt.x, pt.y],
                    stroke: '#d4a838', strokeWidth: 2, lineCap: 'round', dash: [6, 3],
                }));
            });
            if (this._connType === 'none') {
                this._statusText.text('当前接线：无连接（六个端子独立）');
            } else {
                this._statusText.text('当前接线：自定义接法');
            }
        }
    }

    _extractTermName(portId) {
        const parts = portId.split('_wire_');
        if (parts.length !== 2) return null;
        const name = parts[1].toLowerCase();
        if (['u1','u2','v1','v2','w1','w2'].includes(name)) return name;
        return null;
    }

    _getPhaseEnd(name) {
        const map = { u1:'ox', u2:'ix', v1:'ox', v2:'ix', w1:'ox', w2:'ix' };
        const phaseMap = { u1:0, u2:0, v1:1, v2:1, w1:2, w2:2 };
        const key = map[name];
        const pi = phaseMap[name];
        if (key === undefined || pi === undefined) return null;
        const p = this._phases[pi];
        return { x: p[key], y: key === 'ox' ? p.oy : p.iy };
    }

    // ═══════════════════════════════════════════
    // 交互绑定
    // ═══════════════════════════════════════════

    _bindInteraction() {
        // 按钮
        this._btnY.forEach(btn => {
            const hit = new Konva.Rect({
                x: btn.x, y: btn.y, width: btn.w, height: btn.h, fill: 'transparent',
            });
            hit.on('click tap', () => this._onButtonClick(btn.id));
            hit.on('mouseenter', () => { document.body.style.cursor = 'pointer'; });
            hit.on('mouseleave', () => { document.body.style.cursor = 'default'; });
            this._interactGroup.add(hit);
        });
    }

    _onButtonClick(btnId) {
        const now = Date.now();
        if (now - this._btnClickTime < 200) return;
        this._btnClickTime = now;

        const portId = (n) => `${this.id}_wire_${n}`;

        if (btnId === 'btnClr') {
            // 删除本组件所有 wire 连接
            const myConns = this.sys.conns.filter(c =>
                c.type === 'wire' &&
                (c.from.startsWith(this.id) || c.to.startsWith(this.id))
            );
            myConns.forEach(c => this.sys.removeConnWithHistory(c));
            return;
        }

        // 先清空现有
        const existing = this.sys.conns.filter(c =>
            c.type === 'wire' &&
            (c.from.startsWith(this.id) || c.to.startsWith(this.id))
        );
        existing.forEach(c => this.sys.removeConnWithHistory(c));

        const conns = btnId === 'btnY'
            ? [
                { from: portId('u2'), to: portId('v2'), type: 'wire' },
                { from: portId('v2'), to: portId('w2'), type: 'wire' },
                { from: portId('w2'), to: portId('u2'), type: 'wire' },
              ]
            : [
                { from: portId('u1'), to: portId('w2'), type: 'wire' },
                { from: portId('v1'), to: portId('u2'), type: 'wire' },
                { from: portId('w1'), to: portId('v2'), type: 'wire' },
              ];

        conns.forEach(c => this.sys.addConnWithHistory(c));
    }

    // ═══════════════════════════════════════════
    // tick
    // ═══════════════════════════════════════════

    tick(dt) {
        this._updateDynamic();
        this.markDirty();
        this._refreshIfDirty();
    }

    // ═══════════════════════════════════════════
    // 公开 API
    // ═══════════════════════════════════════════

    getConfigFields() {
        return [
            { label: '位号/名称',           key: 'label',    type: 'text'   },
            { label: '每相绕组电阻 (Ω)',     key: 'windingR', type: 'number' },
            { label: '每相自感 (H)',         key: 'windingL', type: 'number' },
            { label: '相间互感 (H)',         key: 'mutualL',  type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label    !== undefined) this.label    = cfg.label;
        if (cfg.windingR !== undefined) this.windingR = parseFloat(cfg.windingR);
        if (cfg.windingL !== undefined) this.windingL = parseFloat(cfg.windingL);
        if (cfg.mutualL  !== undefined) this.mutualL  = parseFloat(cfg.mutualL);
        this.config = { ...this.config, ...cfg };
        this._recalcGeometry();
        this._staticGroup.destroyChildren();
        this._dynamicGroup.destroyChildren();
        this._drawStaticParts();
        this._createDynamicNodes();
        this._refreshCache();
    }

    destroy() {
        super.destroy?.();
    }
}
