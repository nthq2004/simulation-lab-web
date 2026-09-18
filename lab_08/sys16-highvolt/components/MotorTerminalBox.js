/**
 * MotorTerminalBox 三相电机接线盒组件。
 *
 * 该组件用于仿真三相异步电动机的接线盒与绕组展开图，直观展示 U、V、W 三相绕组的
 * 六个出线端（U1/U2、V1/V2、W1/W2）以及星形（Y）和三角形（Δ）两种典型接法。
 *
 * 主要功能：
 * 1. 左侧绘制接线盒面板和六个带相色标识的黄铜接线柱；
 * 2. 右侧绘制三相绕组展开图，并动态显示 Y 接法、Δ 接法或自定义跳线；
 * 3. 通过读取系统连线拓扑自动判定当前接线类型；
 * 4. 提供“Y 接法”“Δ 接法”“清空连线”三个按钮，一键生成或清除接线；
 * 5. 保存每相绕组电阻、自感和相间互感等电气参数，供电机模型使用。
 */
import { BaseComponent } from './BaseComponent.js';

export class MotorTerminalBox extends BaseComponent {
    constructor(config, sys) {
        // 调用父类构造函数，初始化组件公共属性、系统引用和 Konva 图层。
        super(config, sys);

        // 限制组件最小尺寸，保证接线盒与绕组展开图都有足够的绘制空间。
        this.width  = Math.max(420, config.width  || 600);
        this.height = Math.max(320, config.height || 440);

        // 设置组件类型，供仿真系统识别为电机绕组接线盒。
        this.type  = 'motor_winding';
        // 启用固定缓存，减少静态面板的重复绘制开销。
        this.cache = 'fixed';
        // 记录上一次按钮点击时间，用于实现按钮防抖。
        this._btnClickTime = 0;

        // 按统一生命周期初始化图层、几何布局、参数和图形节点。
        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        // 保存配置快照，便于配置面板读取和状态同步。
        this.config = {
            id: this.id,
            label:    this.label,
            windingR: this.windingR,
            windingL: this.windingL,
            mutualL:  this.mutualL,
        };

        // 依据端子布局坐标创建六个电气端口，分别对应三相绕组的首末端。
        this.addPort(this._tp.u1.x, this._tp.u1.y, 'u1', 'wire', 'p');
        this.addPort(this._tp.u2.x, this._tp.u2.y, 'u2', 'wire', 'p');
        this.addPort(this._tp.v1.x, this._tp.v1.y, 'v1', 'wire', 'p');
        this.addPort(this._tp.v2.x, this._tp.v2.y, 'v2', 'wire', 'p');
        this.addPort(this._tp.w1.x, this._tp.w1.y, 'w1', 'wire', 'p');
        this.addPort(this._tp.w2.x, this._tp.w2.y, 'w2', 'wire', 'p');
    }

    _recalcGeometry() {
        // 根据组件宽高重新计算外框、接线盒区、绕组区和按钮的布局。
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

        // 接线盒内端子布局：两行三列，分别对应三相的首端和末端。
        const bx = this._boxL + this._boxW / 2;
        const by = this._boxT + 20;
        const rowH = this._boxH - 70;
        const halfSpan = this._boxW * 0.33;

        const termY1 = by + rowH * 0.32;
        const termY2 = by + rowH * 0.72;

        // 记录六个端子的坐标，供绘制、端口创建和箭头定位使用。
        this._tp = {};
        this._tp.u1 = { x: bx - halfSpan, y: termY1 };
        this._tp.v1 = { x: bx,             y: termY1 };
        this._tp.w1 = { x: bx + halfSpan, y: termY1 };
        this._tp.w2 = { x: bx - halfSpan, y: termY2 };
        this._tp.u2 = { x: bx,             y: termY2 };
        this._tp.v2 = { x: bx + halfSpan, y: termY2 };

        // 接线柱半径。
        this._termR = 9;

        // 分色：U 相红色、V 相绿色、W 相蓝色，便于区分三相。
        this._termColors = {
            u1: '#e03030', u2: '#e03030',
            v1: '#20a030', v2: '#20a030',
            w1: '#2050e0', w2: '#2050e0',
        };
        // 记录每个端子所属的相别。
        this._termPhase = {
            u1: 'U', u2: 'U',
            v1: 'V', v2: 'V',
            w1: 'W', w2: 'W',
        };

        // 展开图：以绕组区中心为圆心，三相绕组按 120 度均匀分布。
        const wcx = this._wdL + this._wdW / 2;
        const wcy = this._wdT + this._wdH * 0.50;
        const wR  = Math.min(this._wdW, this._wdH) * 0.30;

        this._wdCX = wcx;
        this._wdCY = wcy;
        this._wdR  = wR;

        // 定义三相绕组的名称、首末端标识、颜色和摆放角度，并计算内外端点坐标。
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

        // 中性点位于绕组区中心，Y 接法时三相尾端汇聚于此。
        this._neutralX = wcx;
        this._neutralY = wcy;

        // 按钮：Y 接法、Δ 接法、清空连线，横向排列在接线盒下方。
        const bw = Math.min(120, (this._boxW - 10) / 3);
        const bh = 32;
        const btnY = this._boxT + this._boxH + 10;
        this._btnY = [
            { x: this._boxL + 5,           y: btnY, w: bw, h: bh, label: 'Y 接法',    id: 'btnY' },
            { x: this._boxL + bw + 10,     y: btnY, w: bw, h: bh, label: 'Δ 接法',    id: 'btnD' },
            { x: this._boxL + bw * 2 + 15, y: btnY, w: bw, h: bh, label: '清空连线',  id: 'btnClr' },
        ];

        // 状态文字位于按钮下方。
        this._statusY = btnY + bh + 8;
    }

    _initParameters(config) {
        // 读取位号、每相绕组电阻、自感和相间互感等电气参数。
        this.label     = config.label || 'M';
        this.windingR  = config.windingR  !== undefined ? config.windingR  : 2.5;
        this.windingL  = config.windingL  !== undefined ? config.windingL  : 0.082;
        this.mutualL   = config.mutualL   !== undefined ? config.mutualL   : -0.039;
        this.function  = config.function  || '三相绕组接线盒';

        // 当前接线类型：无连接、星形、三角形或自定义。
        this._connType  = 'none'; // 'none' | 'Y' | 'D' | 'custom'
        // 保存本组件相关的跳线连接列表。
        this._jumpConn  = [];

        // 记录三相电流，供电机模型或显示使用。
        this.phaseCurrents = { u: 0, v: 0, w: 0 };
    }

    _init() {
        // 依次绘制静态图形、创建动态节点并绑定按钮交互。
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
    }

    // ═══════════════════════════════════════════
    // 静态绘制
    // ═══════════════════════════════════════════

    _drawStaticParts() {
        // 静态部分由外框、接线盒、端子、绕组线圈和按钮组成。
        this._drawFrame();
        this._drawTerminalBox();
        this._drawTerminals();
        this._drawCoils();
        this._drawButtons();
    }

    _drawFrame() {
        // 绘制组件外框和顶部标题栏。
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
        // 标题字号随组件宽度自适应。
        const fs = Math.max(14, this.width * 0.020);
        this._staticGroup.add(new Konva.Text({
            x: f.x + 6, y: f.y + 1,
            text: this.function,
            fontSize: fs, fill: '#0c0c0c',
        }));
    }

    _drawTerminalBox() {
        // 绘制接线盒面板、内部浅色区和中间横隔板。
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
        // 横隔板：将首端行与末端行分隔开。
        const divY = y + h * 0.52;
        this._staticGroup.add(new Konva.Line({
            points: [x + 8, divY, x + w - 8, divY],
            stroke: '#908060', strokeWidth: 3, lineCap: 'round',
        }));
    }

    _drawTerminals() {
        // 逐个绘制六个接线柱，包括黄铜柱体、相色环、中心点和端子标签。
        const R = this._termR;
        const names = ['u1','v1','w1','w2','u2','v2'];
        const labels = { u1:'U1', v1:'V1', w1:'W1', w2:'W2', u2:'U2', v2:'V2' };
        names.forEach(name => {
            const p = this._tp[name];
            const color = this._termColors[name];
            // 黄铜接线柱：使用线性渐变模拟金属质感。
            this._staticGroup.add(new Konva.Circle({
                x: p.x, y: p.y, radius: R,
                fillLinearGradientStartPoint: { x: -R, y: -R },
                fillLinearGradientEndPoint:   { x:  R, y:  R },
                fillLinearGradientColorStops: [0, '#9a8030', 0.4, '#e8c050', 0.7, '#f8d870', 1, '#9a8030'],
                stroke: '#7a6028', strokeWidth: 1.2,
            }));
            // 色环：用相色标识该端子所属相别。
            this._staticGroup.add(new Konva.Circle({
                x: p.x, y: p.y, radius: R * 0.52,
                fill: color, stroke: '#666', strokeWidth: 0.8,
            }));
            // 中心点
            this._staticGroup.add(new Konva.Circle({
                x: p.x, y: p.y, radius: 2.5, fill: '#333',
            }));
            // 标签：显示端子名称，字号随组件宽度自适应。
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
        // 每相绕组由铁芯、多圈绕线和两端引出线组成，并按相别角度旋转摆放。
        const coilW = 64, coilH = 24;
        const numTurns = 2, turnSpacing = 3, gap = 8;
        this._phases.forEach(p => {
            const rot = p.deg || 0;
            // 为每相绕组创建独立分组，便于整体旋转到指定角度。
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
        // 绘制三个操作按钮，并根据按钮用途使用不同底色。
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
        // 动态绕组图使用独立分组，刷新时可整体清空重建。
        this._wdGroup = new Konva.Group({ listening: false });
        this._dynamicGroup.add(this._wdGroup);

        // 状态文字用于显示当前接线类型。
        this._statusText = new Konva.Text({
            x: this._wdL, y: this._statusY-30,
            text: '当前接线：无连接',
            fontSize: Math.max(16, this.width * 0.016),
            fill: '#404040', listening: false,
        });
        this._dynamicGroup.add(this._statusText);
    }

    _updateDynamic() {
        // 先读取最新接线拓扑，再据此重绘绕组接线图。
        this._readConnections();
        this._drawWindingDiagram();
    }

    // ═══════════════════════════════════════════
    // 读取接线拓扑 → 判定接线类型
    // ═══════════════════════════════════════════

    _readConnections() {
        // 通过系统电压求解器的端口簇映射判断哪些端子被导线连接在一起。
        const portId = (name) => `${this.id}_wire_${name}`;
        const ptc = this.sys.voltageSolver.portToCluster;
        const get = (name) => ptc.get(portId(name));

        // 读取 sys.conns 中本组件的所有 wire 连接
        this._jumpConn = this.sys.conns.filter(c =>
            c.type === 'wire' &&
            (c.from.startsWith(this.id) || c.to.startsWith(this.id))
        );

        // 通过簇判定接线模式：三相尾端同簇为 Y，首尾交叉同簇为 Δ，其余按跳线数区分。
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
        // 每次刷新先清空旧的动态连线，再按当前接线类型重绘。
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
            // 中性点圆：使用金色渐变模拟接线柱。
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
                // 绘制每条首尾交错连接线。
                this._wdGroup.add(new Konva.Line({
                    points: [from, fy, to, ty],
                    stroke: color, strokeWidth: 2.5, lineCap: 'round',
                }));
                // 在连接终点处绘制小圆点，表示接线位置。
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
                // 从连线两端提取端子名称。
                const a = this._extractTermName(c.from) || this._extractTermName(c.to);
                const b = this._extractTermName(c.to)   || this._extractTermName(c.from);
                // 跳过无效或自连接的连线。
                if (!a || !b || a === b) return;
                // 将端子名称换算为绕组图中的坐标。
                const pf = this._getPhaseEnd(a);
                const pt = this._getPhaseEnd(b);
                if (!pf || !pt) return;
                hasAny = true;
                // 使用金色虚线表示用户自定义跳线。
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
        // 从端口 ID 中解析出端子名称，仅接受合法的六个绕组端子。
        const parts = portId.split('_wire_');
        if (parts.length !== 2) return null;
        const name = parts[1].toLowerCase();
        if (['u1','u2','v1','v2','w1','w2'].includes(name)) return name;
        return null;
    }

    _getPhaseEnd(name) {
        // 将端子名称映射到绕组图上的具体端点坐标。
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
        // 为每个按钮创建透明点击区域，并绑定点击与鼠标指针样式。
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
        // 按钮防抖：200 毫秒内重复点击直接忽略。
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

        // 根据按钮选择生成 Y 接法（尾端相连）或 Δ 接法（首尾交错相连）的连线。
        const conns = btnId === 'btnY'
            ? [
                { from: portId('u2'), to: portId('v2'), type: 'wire' },
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
        // 每个仿真步重新读取接线状态并更新绕组展开图，再刷新显示。
        this._updateDynamic();
        this.markDirty();
        this._refreshIfDirty();
    }

    // ═══════════════════════════════════════════
    // 公开 API
    // ═══════════════════════════════════════════

    getConfigFields() {
        // 配置面板开放位号、每相绕组电阻、自感和相间互感四项参数。
        return [
            { label: '位号/名称',           key: 'label',    type: 'text'   },
            { label: '每相绕组电阻 (Ω)',     key: 'windingR', type: 'number' },
            { label: '每相自感 (H)',         key: 'windingL', type: 'number' },
            { label: '相间互感 (H)',         key: 'mutualL',  type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        // 逐项更新电机绕组参数，其余字段保持不变。
        if (cfg.label    !== undefined) this.label    = cfg.label;
        if (cfg.windingR !== undefined) this.windingR = parseFloat(cfg.windingR);
        if (cfg.windingL !== undefined) this.windingL = parseFloat(cfg.windingL);
        if (cfg.mutualL  !== undefined) this.mutualL  = parseFloat(cfg.mutualL);
        // 合并配置并重新计算布局，重建静态和动态图形以应用新的参数显示。
        this.config = { ...this.config, ...cfg };
        this._recalcGeometry();
        this._staticGroup.destroyChildren();
        this._dynamicGroup.destroyChildren();
        this._drawStaticParts();
        this._createDynamicNodes();
        this._refreshCache();
    }

    /* 返回部件中心的世界坐标（供工作流箭头定位） */
    getClickablePartCenter(partId) {
        // 返回接线盒整体中心或指定端子的世界坐标，供演示箭头定位使用。
        const gx = this.group.x(), gy = this.group.y();
        if (partId === 'box') return { x: gx + this.width / 2, y: gy + this.height / 2 };
        const p = this._tp[partId];
        if (p) return { x: gx + p.x, y: gy + p.y };
        return null;
    }

    destroy() {
        // 调用父类销毁逻辑，释放组件图形和资源。
        super.destroy?.();
    }
}
