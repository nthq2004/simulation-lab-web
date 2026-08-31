import { BaseComponent } from './BaseComponent.js';

/**
 * 三相异步电动机（Three-Phase Induction Motor）仿真组件
 *
 * ═══ 渲染优化原则 ═══════════════════════════════════════════
 *  1. 动态元素（转子旋转、旋转磁场、绕组连接线、状态指示）
 *     全部使用 in-place 更新，不重建节点
 *  2. 消除所有 shadow 属性，避免离屏阴影渲染
 *  3. 静态部件（定子外框、铁心齿槽、轴承、铭牌）仅 init 时缓存
 *  4. 转子辐条在动态组 _rotorGroup 中整体旋转
 * ═══════════════════════════════════════════════════════════
 *
 * ── 左半区：电机横剖面（Cross-Section View）──────────────────
 *
 *  外壳（机座）：深灰色铸铁圆环，带散热筋（径向条纹）
 *  │
 *  ├─ 定子铁心：叠片硅钢圆环，内侧均布 24 个齿槽
 *  │    槽内绕组线圈（6组，每相2组，按120°间隔分布）
 *  │    U相：红色（0°,180°）
 *  │    V相：绿色（120°,300°）
 *  │    W相：蓝色（240°,60°）
 *  │    导线截面：每槽显示数个圆形截面（进/出用 ●/○ 区分）
 *  │
 *  ├─ 气隙（Air Gap）：定转子之间的细环形空间
 *  │    旋转磁场可视化：6个弧形磁通线，随转子一起旋转
 *  │    颜色随当前主导相变化（红/绿/蓝交替）
 *  │
 *  ├─ 转子铁心：笼型转子（Squirrel Cage）
 *  │    实心圆盘（深色），均布 16 根导条（金色辐条）
 *  │    转轴（中心实心圆）
 *  │    整体绕中心匀速旋转（可配置转速）
 *  │    旋转方向：顺时针（可配置）
 *  │
 *  ├─ 轴承（左右两个，截面图）：小圆圈表示滚珠
 *  │
 *  └─ 状态叠层：转速/转向文字，运行/停止颜色指示
 *
 * ── 右半区：三相绕组接线图 ────────────────────────────────
 *
 *  三相绕组 U、V、W 用梯形/矩形线圈符号表示
 *  每相绕组两个端头（首端 U1/V1/W1，尾端 U2/V2/W2）
 *
 *  ┌─ 星形接法（Y 接）─────────────────────────────────────┐
 *  │  U2、V2、W2 三尾端汇接至中性点（N），画出三叉星形     │
 *  │  U1/V1/W1 三首端引出到 L1/L2/L3 接线柱              │
 *  │  中性点显示金色汇流圆圈                               │
 *  └──────────────────────────────────────────────────────┘
 *  ┌─ 三角形接法（Δ 接）───────────────────────────────────┐
 *  │  U1→W2、V1→U2、W1→V2 首尾相接形成三角形环路          │
 *  │  三个顶点引出 L1/L2/L3 接线柱                        │
 *  │  三角形用实线勾勒，三顶点有金色节点圆                  │
 *  └──────────────────────────────────────────────────────┘
 *
 *  切换动画：点击"Y/Δ切换"按钮 → 接线图淡出/淡入，
 *  同时接线柱连接线重新布线（0.25s 过渡动画）
 *
 *  端口：
 *    l1, l2, l3 → 三相进线（右侧引出）
 *    pe         → 保护接地（PE端子）
 *
 * ── 状态机 ────────────────────────────────────────────────
 *  'stop'    → 转子静止，磁场消失，绕组灰色
 *  'run'     → 转子旋转，旋转磁场可视化，绕组彩色
 *
 *  接法：'Y'（星形）| 'D'（三角形）
 *
 * ── 端口 ─────────────────────────────────────────────────
 *  l1, l2, l3 — 三相电源进线端（右侧面板）
 *  pe         — 保护接地端
 *
 * ── 可配置参数 ────────────────────────────────────────────
 *  label        : 位号（默认 'M'）
 *  poles        : 极数（默认 4，即2对极）
 *  ratedPower   : 额定功率 kW（默认 4.0）
 *  ratedVoltage : 额定电压 V（默认 380）
 *  ratedCurrent : 额定电流 A（默认 8.8）
 *  ratedSpeed   : 额定转速 rpm（默认 1440）
 *  connection   : 接法 'Y'|'D'（默认 'Y'）
 *  initState    : 初始状态 'run'|'stop'（默认 'stop'）
 */
export class ThreePhaseMotor extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(380, config.width  || 540);
        this.height = Math.max(260, config.height || 380);

        this.type    = 'MOTOR';
        this.special = '3P-INDUCTION-MOTOR';
        this.cache   = 'fixed';

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        this.config = {
            id: this.id,
            label:        this.label,
            poles:        this.poles,
            ratedPower:   this.ratedPower,
            ratedVoltage: this.ratedVoltage,
            ratedCurrent: this.ratedCurrent,
            ratedSpeed:   this.ratedSpeed,
            connection:   this._connection,
            initState:    this._state,
        };

        // 端口
        this.addPort(this._portL1.x, this._portL1.y, 'l1', 'wire', 'p');
        this.addPort(this._portL2.x, this._portL2.y, 'l2', 'wire', 'p');
        this.addPort(this._portL3.x, this._portL3.y, 'l3', 'wire', 'p');
        this.addPort(this._portPE.x,  this._portPE.y,  'pe',  'wire', 'n');
    }

    // ═══════════════════════════════════════════
    // 几何尺寸计算
    // ═══════════════════════════════════════════

    _recalcGeometry() {
        const W = this.width, H = this.height;

        this._divX = W * 0.50;
        this._frame = { x: 2, y: 2, w: W - 4, h: H - 4, rx: 6 };

        // ══ 左侧：横剖面区 ═══════════════════════
        const LCX = this._divX * 0.50;
        const LCY = H * 0.40;

        // 各圆环半径
        const maxR = Math.min(this._divX * 0.46, H * 0.42);
        this._rFrame   = maxR;           // 外壳外径
        this._rHousing = maxR - 6;       // 外壳内径（机座）
        this._rStator  = maxR - 14;      // 定子铁心外径
        this._rSlot    = maxR - 26;      // 定子槽底（线圈外径）
        this._rAirGap  = maxR - 32;      // 气隙外径（定子内径）
        this._rRotor   = maxR - 40;      // 转子外径
        this._rShaft   = maxR * 0.12;    // 转轴半径

        this._motorCX  = LCX;
        this._motorCY  = LCY;

        // 定子槽数
        this._slotCount = 24;
        // 转子导条数
        this._barCount  = 16;

        // ── 右侧：绕组接线图区 ═════════════════════
        const RP   = 6;
        const RX   = this._divX + RP;
        const RW   = W - this._divX - RP * 2;
        const RCX  = RX + RW * 0.50;
        const RCY  = H * 0.58;

        this._wdCX = RCX;
        this._wdCY = RCY;
        this._wdR  = Math.min(RW * 0.26, H * 0.19);  // 绕组布局半径

        // 三相绕组位置（120°间隔，V在上，U左下，W右下）
        const phases = [
            { name: 'U', angle: 150, color: '#e03030', label1: 'U1', label2: 'U2', rotation: -30 },
            { name: 'V', angle: -90, color: '#20a030', label1: 'V1', label2: 'V2', rotation: 90 },
            { name: 'W', angle:  30, color: '#2050e0', label1: 'W1', label2: 'W2', rotation: 30 },
        ];
        this._phases = phases.map(p => {
            const rad = p.angle * Math.PI / 180;
            return {
                ...p,
                // 绕组线圈中心
                cx: RCX + this._wdR * Math.cos(rad),
                cy: RCY + this._wdR * Math.sin(rad),
                // 首端（朝外，到引出线末端 ）
                x1: RCX + (this._wdR + 40) * Math.cos(rad),
                y1: RCY + (this._wdR + 40) * Math.sin(rad),
                // 尾端（朝内，到引出线末端）
                x2: RCX + (this._wdR - 40) * Math.cos(rad),
                y2: RCY + (this._wdR - 40) * Math.sin(rad),
            };
        });

        // 中性点（Y接时汇聚点）
        this._neutralX = RCX;
        this._neutralY = RCY;

        // 接线柱（上端，与绕组首端对齐以实现垂直接线）
        const termY  = this._frame.y + 22;
        const headRad = this._wdR + 40;
        const cos30 = Math.cos(30 * Math.PI / 180);
        this._terminals = [
            { x: RCX - headRad * cos30, y: termY, name: 'L1', color: '#e03030' },
            { x: RCX,                    y: termY, name: 'L2', color: '#20a030' },
            { x: RCX + headRad * cos30, y: termY, name: 'L3', color: '#2050e0' },
        ];

        // PE 端子（右侧中部）
        this._termPE = { x: W - 20, y: RCY+100 };

        // 端口位置（L1/L2/L3 上端，PE 右侧）
        this._portL1 = { x: this._terminals[0].x, y: 2 };
        this._portL2 = { x: this._terminals[1].x, y: 2 };
        this._portL3 = { x: this._terminals[2].x, y: 2 };
        this._portPE = { x: W - 2, y: this._termPE.y };

        this._termR = Math.max(4, W * 0.012);

        // 切换按钮
        this._switchBtnRect = {
            x: RX, y: H - 38, w: RW * 0.45, h: 30, rx: 4,
        };
        // 运行按钮
        this._runBtnRect = {
            x: RX + RW * 0.52, y: H - 38, w: RW * 0.45, h: 30, rx: 4,
        };
    }

    // ═══════════════════════════════════════════
    // 参数初始化
    // ═══════════════════════════════════════════

    _initParameters(config) {
        this.label        = config.label        || 'M';
        this.poles        = config.poles        !== undefined ? config.poles        : 4;
        this.ratedPower   = config.ratedPower   !== undefined ? config.ratedPower   : 4.0;
        this.ratedVoltage = config.ratedVoltage !== undefined ? config.ratedVoltage : 380;
        this.ratedCurrent = config.ratedCurrent !== undefined ? config.ratedCurrent : 8.8;
        this.ratedSpeed   = config.ratedSpeed   !== undefined ? config.ratedSpeed   : 1440;
        this.function     = config.function     || '三相异步电动机';

        this._connection  = (config.connection || 'Y').toUpperCase() === 'D' ? 'D' : 'Y';
        const s = (config.initState || 'stop').toLowerCase();
        this._state       = s === 'run' ? 'run' : 'stop';

        // 转子旋转角（rad）
        this._rotorAngle  = 0;
        // 旋转磁场角（略超前转子，体现转差率）
        this._fieldAngle  = 0;
        // 磁场色相（0~1，循环变化，控制相色）
        this._fieldPhase  = 0;

        // 转速（rad/s）= ratedSpeed * 2π / 60
        this._omega = this.ratedSpeed * 2 * Math.PI / 60;

        // 接线切换动画
        this._switchAnim   = false;
        this._switchT      = 0;
        this._switchDur    = 0.25;
        this._switchAlpha  = 1.0;  // 淡出淡入用
        this._switchPhase  = 'in'; // 'out' | 'in'
        this._switchTarget = this._connection;

        // 启停动画（转速渐变）
        this._currentOmega = this._state === 'run' ? this._omega : 0;
        this._targetOmega  = this._currentOmega;
        this._accelT       = 0;
        this._accelDur     = 1.5;  // 启动时间 1.5s
        this._decelDur     = 0.8;

        // 各相对 PE 绝缘电阻（Ω）
        this.uohm = config.uohm ?? 20e6;
        this.vohm = config.vohm ?? 20e6;
        this.wohm = config.wohm ?? 20e6;

        this.opsCount = config.initOps || 0;
    }

    // ═══════════════════════════════════════════
    // 主初始化
    // ═══════════════════════════════════════════

    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
    }

    // ═══════════════════════════════════════════
    // 静态部件
    // ═══════════════════════════════════════════

    _drawStaticParts() {
        this._drawFrame();
        this._drawDivider();
        this._drawHousing();
        this._drawStator();
        this._drawStatorSlotWires();
        this._drawBearings();
        this._drawSchematicStatic();
        this._drawTerminalPosts();
        this._drawButtons();
        this._drawMotorLabel();
    }

    _drawFrame() {
        const f = this._frame;
        this._staticGroup.add(new Konva.Rect({
            x: f.x, y: f.y, width: f.w, height: f.h,
            fill: '#e0e2ec', stroke: '#b0a898', strokeWidth: 1.5, cornerRadius: f.rx,
        }));
        this._staticGroup.add(new Konva.Rect({
            x: f.x + 2, y: f.y + 2, width: f.w - 4, height: f.h * 0.055,
            fill: 'rgba(40,80,180,0.14)', cornerRadius: [f.rx, f.rx, 0, 0],
        }));
        this._staticGroup.add(new Konva.Text({
            x: f.x + 4, y: f.y - 18,
            text: this.function,
            fontSize: Math.max(16, this.width * 0.020), fill: '#0c0c0c',
        }));
        // 左侧浅色背景
        this._staticGroup.add(new Konva.Rect({
            x: f.x + 2, y: f.y + 2,
            width: this._divX - f.x - 2, height: f.h - 4,
            fill: '#f5f2e8', cornerRadius: [f.rx, 0, 0, f.rx],
        }));
    }

    _drawDivider() {
        this._staticGroup.add(new Konva.Line({
            points: [this._divX, this._frame.y + 8, this._divX, this._frame.y + this._frame.h - 8],
            stroke: '#b0a898', strokeWidth: 1.2, dash: [5, 3],
        }));
    }

    /** 外壳机座（带散热筋） */
    _drawHousing() {
        const cx = this._motorCX, cy = this._motorCY;
        const rO = this._rFrame, rI = this._rHousing;

        // 外壳圆环
        this._staticGroup.add(new Konva.Ring({
            x: cx, y: cy,
            innerRadius: rI, outerRadius: rO,
            fillLinearGradientStartPoint: { x: -rO, y: -rO },
            fillLinearGradientEndPoint:   { x:  rO, y:  rO },
            fillLinearGradientColorStops: [
                0,   '#c0c0c8',
                0.25,'#d8d8e0',
                0.5, '#c8c8d0',
                0.75,'#d8d8e0',
                1,   '#c0c0c8',
            ],
            stroke: '#909090', strokeWidth: 1.5,
        }));

        // 散热筋（径向矩形，均布 16 根）
        const ribCount = 16;
        for (let i = 0; i < ribCount; i++) {
            const a  = (i / ribCount) * Math.PI * 2;
            const x1 = cx + rO * Math.cos(a);
            const y1 = cy + rO * Math.sin(a);
            const x2 = cx + (rO + 5) * Math.cos(a);
            const y2 = cy + (rO + 5) * Math.sin(a);
            this._staticGroup.add(new Konva.Line({
                points: [x1, y1, x2, y2],
                stroke: '#a0a0a8', strokeWidth: 3, lineCap: 'round',
            }));
        }

        // 区域说明
        const fs = Math.max(12, this.width * 0.016);
        this._staticGroup.add(new Konva.Text({
            x: cx - 18, y: cy + rO + 8,
            text: '机座/外壳',
            fontSize: fs, fill: '#606060',
        }));
    }

    /** 定子铁心（带齿槽） */
    _drawStator() {
        const cx = this._motorCX, cy = this._motorCY;
        const rS = this._rStator, rAG = this._rAirGap;

        // 定子铁心圆环
        this._staticGroup.add(new Konva.Ring({
            x: cx, y: cy,
            innerRadius: rAG, outerRadius: rS,
            fillLinearGradientStartPoint: { x: -rS, y: 0 },
            fillLinearGradientEndPoint:   { x:  rS, y: 0 },
            fillLinearGradientColorStops: [
                0,   '#b0b0b8',
                0.3, '#c8c8d0',
                0.5, '#d0d0d8',
                0.7, '#c8c8d0',
                1,   '#b0b0b8',
            ],
            stroke: '#909098', strokeWidth: 0.8,
        }));

        // 定子齿槽（24 槽，等分）
        const slotCount = this._slotCount;
        for (let i = 0; i < slotCount; i++) {
            const a   = (i / slotCount) * Math.PI * 2 - Math.PI / slotCount;
            const a1  = a - Math.PI / slotCount * 0.35;
            const a2  = a + Math.PI / slotCount * 0.35;

            // 槽开口线（从铁心内径向外辐射的两条边）
            const pts = [
                cx + rAG * Math.cos(a1), cy + rAG * Math.sin(a1),
                cx + this._rSlot * Math.cos(a1), cy + this._rSlot * Math.sin(a1),
                cx + this._rSlot * Math.cos(a2), cy + this._rSlot * Math.sin(a2),
                cx + rAG * Math.cos(a2), cy + rAG * Math.sin(a2),
            ];
            this._staticGroup.add(new Konva.Line({
                points: pts, closed: true,
                fill: '#e8e4dc',
                stroke: '#b0a898', strokeWidth: 0.5,
            }));
        }
    }

    /**
     * 定子槽内绕组导线截面
     * 24槽 / 6组 = 每相各占4槽（每相2个线圈，每线圈占2槽）
     * U相（红）：槽 0,1,12,13
     * V相（绿）：槽 8,9,20,21
     * W相（蓝）：槽 16,17,4,5
     */
    _drawStatorSlotWires() {
        const cx = this._motorCX, cy = this._motorCY;
        const slotCount = this._slotCount;

        const phaseSlots = [
            { color: '#e03030', slots: [0, 1, 12, 13] },  // U 相
            { color: '#20a030', slots: [8, 9, 20, 21] },  // V 相
            { color: '#2050e0', slots: [16,17,  4,  5] },  // W 相
        ];

        phaseSlots.forEach(({ color, slots }) => {
            slots.forEach((si, idx) => {
                const a    = (si / slotCount) * Math.PI * 2;
                const rMid = (this._rSlot + this._rAirGap) / 2 + 4;
                const wx   = cx + rMid * Math.cos(a);
                const wy   = cy + rMid * Math.sin(a);
                const r    = Math.max(3, (this._rSlot - this._rAirGap) * 0.22);

                // 外圈
                this._staticGroup.add(new Konva.Circle({
                    x: wx, y: wy, radius: r,
                    fill: idx < 2 ? color : 'none',
                    stroke: color, strokeWidth: 2.8,
                }));
                // 进线（●）用实心，出线（○）用空心+中心点
                if (idx >= 2) {
                    this._staticGroup.add(new Konva.Circle({
                        x: wx, y: wy, radius: r * 0.46,
                        fill: color,
                    }));
                }
            });
        });
    }

    /** 轴承（两个，截面圆形示意） */
    _drawBearings() {
        const cx = this._motorCX, cy = this._motorCY;
        const rS = this._rShaft;

        // 轴承外圈
        [{ dx: -this._rAirGap * 0.50, dy: 0 },
         { dx:  this._rAirGap * 0.50, dy: 0 }].forEach(({ dx, dy }) => {
            const bx = cx + dx, by = cy + dy;
            this._staticGroup.add(new Konva.Ring({
                x: bx, y: by,
                innerRadius: rS + 2, outerRadius: rS + 8,
                fill: '#e0e4e8', stroke: '#b0b0b8', strokeWidth: 0.8,
            }));
            // 滚珠（6个）
            for (let k = 0; k < 6; k++) {
                const ba = (k / 6) * Math.PI * 2;
                const br = rS + 5;
                this._staticGroup.add(new Konva.Circle({
                    x: bx + br * Math.cos(ba), y: by + br * Math.sin(ba),
                    radius: 2.2, fill: '#e8ecf0', stroke: '#909898', strokeWidth: 0.5,
                }));
            }
        });
    }

    /** 右侧绕组接线图静态部件（线圈符号、标注） */
    _drawSchematicStatic() {
        const fs = Math.max(15, this.width * 0.019);

        this._phases.forEach(p => {
            const cx = p.cx, cy = p.cy;
            const coilW = 50, coilH = 16;
            const rot = p.rotation || 0;

            // 线圈符号用独立 Group 旋转，标注文字保持水平
            const coilGrp = new Konva.Group({ x: cx, y: cy, rotation: rot });
            this._staticGroup.add(coilGrp);

            // 两端引出线
            const leadLen = 14;
            coilGrp.add(new Konva.Line({
                points: [-coilW / 2, 0, -coilW / 2 - leadLen, 0],
                stroke: p.color, strokeWidth: 2, lineCap: 'round',
            }));
            coilGrp.add(new Konva.Line({
                points: [coilW / 2, 0, coilW / 2 + leadLen, 0],
                stroke: p.color, strokeWidth: 2, lineCap: 'round',
            }));

            coilGrp.add(new Konva.Rect({
                x: -coilW / 2, y: -coilH / 2,
                width: coilW, height: coilH,
                fill: 'rgba(30,40,60,0.75)',
                stroke: p.color, strokeWidth: 1.5,
                cornerRadius: 2,
            }));

            for (let k = 0; k < 3; k++) {
                const ax = -coilW / 2 + coilW / 3 * (k + 0.5);
                coilGrp.add(new Konva.Arc({
                    x: ax, y: 0,
                    innerRadius: 0, outerRadius: coilH * 0.34,
                    angle: 180, rotation: 0,
                    fill: p.color, opacity: 0.80,
                }));
            }

            // 首端标注（U1/V1/W1，不旋转）
            const lx1 = p.x1, ly1 = p.y1;
            this._staticGroup.add(new Konva.Text({
                x: lx1 - 26, y: ly1 ,
                text: p.label1,
                fontSize: fs, fontStyle: 'bold', fill: p.color,
            }));

            // 尾端标注（U2/V2/W2，不旋转）
            const lx2 = p.x2, ly2 = p.y2;
            this._staticGroup.add(new Konva.Text({
                x: lx2 - 16, y: ly2 - 6,
                text: p.label2,
                fontSize: fs, fontStyle: 'bold', fill: p.color,
            }));
        });
    }

    /** 接线柱（L1/L2/L3/PE，位于上端） */
    _drawTerminalPosts() {
        const fs = Math.max(15, this.width * 0.018);

        this._terminals.forEach(t => {
            this._drawTermPost({ x: t.x, y: t.y }, t.color);
            this._staticGroup.add(new Konva.Text({
                x: t.x - 25, y: t.y - 16,
                text: t.name, fontSize: fs, fontStyle: 'bold', fill: t.color,
            }));
            // 引出到上端口
            this._staticGroup.add(new Konva.Line({
                points: [t.x, t.y - this._termR, t.x, 2],
                stroke: t.color, strokeWidth: 2.5,
            }));
        });

        // PE 端子（黄绿色，右侧下部）
        const peColor = '#85884a';
        this._drawTermPost({ x: this._termPE.x, y: this._termPE.y }, peColor);
        this._staticGroup.add(new Konva.Text({
            x: this._termPE.x - 34, y: this._termPE.y - 7,
            text: 'PE', fontSize: 15, fontStyle: 'bold', fill: peColor,
        }));
        this._staticGroup.add(new Konva.Line({
            points: [this._termPE.x + this._termR, this._termPE.y, this.width - 2, this._termPE.y],
            stroke: peColor, strokeWidth: 2,
        }));
    }

    _drawTermPost(pos, color) {
        const R = this._termR, { x, y } = pos;
        this._staticGroup.add(new Konva.Circle({
            x, y, radius: R,
            fillLinearGradientStartPoint: { x: -R, y: -R },
            fillLinearGradientEndPoint:   { x:  R, y:  R },
            fillLinearGradientColorStops: [0, '#7a6a30', 0.4, '#d4aa52', 0.7, '#e8c86a', 1, '#8a7030'],
            stroke: '#6a5a28', strokeWidth: 1,
        }));
        this._staticGroup.add(new Konva.Circle({
            x, y, radius: R * 0.38, fill: '#2a1a08', stroke: '#5a4a20', strokeWidth: 0.6,
        }));
    }

    /** Y/Δ 切换按钮 + 运行/停止按钮 */
    _drawButtons() {
        const sb = this._switchBtnRect;
        const rb = this._runBtnRect;
        const fs = Math.max(15, this.width * 0.018);

        // Y/Δ 切换按钮
        this._staticGroup.add(new Konva.Rect({
            x: sb.x, y: sb.y, width: sb.w, height: sb.h,
            fill: '#303860', stroke: '#5060a0', strokeWidth: 1.2, cornerRadius: sb.rx,
        }));
        this._staticGroup.add(new Konva.Text({
            x: sb.x, y: sb.y + 4, width: sb.w,
            text: '切换 Y / Δ 接法',
            fontSize: fs, fill: '#a0b8e0', align: 'center',
        }));

        // 运行/停止 按钮（文字在 _createDynamicNodes 中创建以便动态更新）
        this._staticGroup.add(new Konva.Rect({
            x: rb.x, y: rb.y, width: rb.w, height: rb.h,
            fill: '#1a3020', stroke: '#306040', strokeWidth: 1.2, cornerRadius: rb.rx,
        }));
    }

    /** 电机铭牌（左侧底部） */
    _drawMotorLabel() {
        const cx   = this._motorCX;
        const cy   = this._motorCY;
        const rO   = this._rFrame;
        const npW  = this._divX * 0.75;
        const npH  = 36;
        const npX  = cx - npW / 2;
        const npY  = cy + rO + 14;
        const fs   = Math.max(15, this.width * 0.016);

        this._staticGroup.add(new Konva.Rect({
            x: npX, y: npY+10, width: npW, height: 2*npH,
            fill: '#c8c0a0', stroke: '#908060', strokeWidth: 1, cornerRadius: 2,
        }));
        this._staticGroup.add(new Konva.Text({
            x: npX + 4, y: npY + 15,
            text: `${this.label}  ${this.ratedPower}kW  ${this.poles}P`,
            fontSize: fs, fontStyle: 'bold', fill: '#2a2010',
        }));
        this._staticGroup.add(new Konva.Text({
            x: npX + 4, y: npY + fs + 22,
            text: `${this.ratedVoltage}V  ${this.ratedCurrent}A  ${this.ratedSpeed}rpm`,
            fontSize: fs, fill: '#4a3820',
        }));
        this._staticGroup.add(new Konva.Text({
            x: npX + 4, y: npY + fs * 2 + 29,
            text: `cos φ=0.85  η=90%  IP54`,
            fontSize: fs, fill: '#6a5840',
        }));
    }

    // ═══════════════════════════════════════════
    // 动态层（一次性创建，每帧 in-place 更新）
    // ═══════════════════════════════════════════

    _createDynamicNodes() {
        this._createAirGapField();    // 旋转磁场弧线
        this._createRotor();          // 转子（整体旋转组）
        this._createShaft();          // 转轴（静态，覆盖在转子上）
        this._createWiringDiagram();  // 接线图（Y/Δ动态）
        this._createRunIndicator();   // 运行状态指示
        this._createRunBtnText();     // 运行/停止按钮文字（动态更新）
    }

    /** 气隙旋转磁场可视化（6根弧形磁力线） */
    _createAirGapField() {
        this._fieldGroup = new Konva.Group({ listening: false });
        this._fieldArcs  = [];

        for (let k = 0; k < 6; k++) {
            const arc = new Konva.Arc({
                x: this._motorCX, y: this._motorCY,
                innerRadius: this._rAirGap + 1,
                outerRadius: this._rAirGap + 7,
                angle: 28,
                rotation: k * 60,
                fill: k % 3 === 0 ? 'rgba(220,60,60,0.55)'
                    : k % 3 === 1 ? 'rgba(60,180,60,0.55)'
                    :                'rgba(60,100,230,0.55)',
                visible: this._state === 'run',
                listening: false,
            });
            this._fieldGroup.add(arc);
            this._fieldArcs.push(arc);
        }
        this._dynamicGroup.add(this._fieldGroup);
    }

    /** 笼型转子（导条辐条 + 转子铁心） */
    _createRotor() {
        this._rotorGroup = new Konva.Group({
            x: this._motorCX, y: this._motorCY,
            rotation: this._rotorAngle * 180 / Math.PI,
            listening: false,
        });

        // 转子铁心圆盘
        this._rotorGroup.add(new Konva.Circle({
            x: 0, y: 0, radius: this._rRotor,
            fillLinearGradientStartPoint: { x: -this._rRotor, y: -this._rRotor },
            fillLinearGradientEndPoint:   { x:  this._rRotor, y:  this._rRotor },
            fillLinearGradientColorStops: [
                0,   '#b8b8c0',
                0.35,'#d0d0d8',
                0.65,'#c8c8d0',
                1,   '#b0b0b8',
            ],
            stroke: '#909098', strokeWidth: 1,
        }));

        // 转子导条（笼型，16根金色辐条）
        const barCount = this._barCount;
        const rO       = this._rRotor;
        const barR     = Math.max(2.5, rO * 0.055);

        for (let k = 0; k < barCount; k++) {
            const a  = (k / barCount) * Math.PI * 2;
            const br = rO - barR - 1;
            this._rotorGroup.add(new Konva.Circle({
                x: br * Math.cos(a), y: br * Math.sin(a),
                radius: barR,
                fillLinearGradientStartPoint: { x: -barR, y: -barR },
                fillLinearGradientEndPoint:   { x:  barR, y:  barR },
                fillLinearGradientColorStops: [0, '#9a8030', 0.4, '#e8c050', 0.7, '#f8d870', 1, '#9a8030'],
                stroke: '#7a6028', strokeWidth: 0.6,
            }));
        }

        // 端环连接线（两圈细圆环，模拟端环截面）
        this._rotorGroup.add(new Konva.Ring({
            x: 0, y: 0,
            innerRadius: rO - barR * 2.8,
            outerRadius: rO - barR * 1.0,
            fill: 'rgba(180,150,40,0.25)',
            stroke: 'rgba(200,170,50,0.40)', strokeWidth: 0.8,
        }));

        this._dynamicGroup.add(this._rotorGroup);
    }

    /** 转轴（覆盖在转子中心，静态） */
    _createShaft() {
        const rS = this._rShaft;
        // 轴截面（银色）
        this._shaftCircle = new Konva.Circle({
            x: this._motorCX, y: this._motorCY,
            radius: rS,
            fillLinearGradientStartPoint: { x: -rS, y: -rS },
            fillLinearGradientEndPoint:   { x:  rS, y:  rS },
            fillLinearGradientColorStops: [0, '#c0c4c8', 0.4, '#e0e4e8', 0.6, '#d0d4d8', 1, '#c0c4c8'],
            stroke: '#909898', strokeWidth: 1,
            listening: false,
        });
        this._dynamicGroup.add(this._shaftCircle);

        // 键槽（轴上的矩形槽）
        const ksW = rS * 0.40, ksH = rS * 0.90;
        this._shaftKeyway = new Konva.Rect({
            x: this._motorCX - ksW / 2,
            y: this._motorCY - rS,
            width: ksW, height: ksH,
            fill: '#909898', stroke: '#a0a0a8', strokeWidth: 0.5,
        });
        this._dynamicGroup.add(this._shaftKeyway);

        // 中心点
        this._dynamicGroup.add(new Konva.Circle({
            x: this._motorCX, y: this._motorCY,
            radius: rS * 0.22, fill: '#888890',
        }));

        // 转速文字（转子旁）
        this._speedText = new Konva.Text({
            x: this._motorCX  -22,
            y: this._motorCY + 22,
            text: '0 rpm',
            fontSize: Math.max(15, this.width * 0.017),
            fill: '#60c880', listening: false,
        });
        this._dynamicGroup.add(this._speedText);

        // 转向箭头（弧线箭头，顺时针）
        this._dirArrow = new Konva.Arc({
            x: this._motorCX, y: this._motorCY,
            innerRadius: this._rRotor + 6,
            outerRadius: this._rRotor + 12,
            angle: 240, rotation: -210,
            fill: 'rgba(10, 196, 72, 0.5)',
            visible: false, listening: false,
        });
        this._dynamicGroup.add(this._dirArrow);

        // 箭头尖（小三角）
        this._dirArrowHead = new Konva.Line({
            points: [0, 0, 0, 0, 0, 0],
            fill: 'rgba(244, 7, 23, 0.7)',
            stroke: 'rgba(118, 27, 6, 0.7)',
            strokeWidth: 3, closed: true,
            visible: false, listening: false,
        });
        this._dynamicGroup.add(this._dirArrowHead);
    }

    /**
     * 接线图动态部分
     * 包含：
     *   Y接：三根汇流线（首端→接线柱，尾端→中性点）
     *   Δ接：三角形三条边（首尾相接环路）
     *   中性点圆（Y接）/ 三角形顶点圆（Δ接）
     */
    _createWiringDiagram() {
        this._wiringGroup = new Konva.Group({
            opacity: 1, listening: false,
        });
        this._dynamicGroup.add(this._wiringGroup);

        this._drawWiringForConnection(this._connection);
    }

    /** 根据接法绘制接线图到 _wiringGroup */
    _drawWiringForConnection(conn) {
        this._wiringGroup.destroyChildren();

        const phases = this._phases;
        const termColors = ['#e03030', '#20a030', '#2050e0'];

        if (conn === 'Y') {
            // ── 星形接法 ──────────────────────────────
            // 首端连接线（首端 → 上端接线柱）
            phases.forEach((p, i) => {
                const t = this._terminals[i];
                const termEdge = t.y - this._termR;
                // 接线柱与绕组首端对齐，均为垂直线
                this._wiringGroup.add(new Konva.Line({
                    points: [p.x1, p.y1, t.x, termEdge],
                    stroke: p.color, strokeWidth: 2, lineCap: 'round', lineJoin: 'round',
                }));
                // 首端节点圆
                this._wiringGroup.add(new Konva.Circle({
                    x: p.x1, y: p.y1, radius: 4,
                    fill: p.color, stroke: 'rgba(255,255,255,0.3)', strokeWidth: 0.8,
                }));
            });

            // 尾端汇流线（尾端 → 中性点）
            phases.forEach(p => {
                this._wiringGroup.add(new Konva.Line({
                    points: [p.x2, p.y2, this._neutralX, this._neutralY],
                    stroke: p.color, strokeWidth: 2, lineCap: 'round',
                }));
            });

            // 中性点圆（金色）
            this._wiringGroup.add(new Konva.Circle({
                x: this._neutralX, y: this._neutralY, radius: 7,
                fillLinearGradientStartPoint: { x: -7, y: -7 },
                fillLinearGradientEndPoint:   { x:  7, y:  7 },
                fillLinearGradientColorStops: [0, '#9a8030', 0.5, '#e8c050', 1, '#9a8030'],
                stroke: '#7a6028', strokeWidth: 1.2,
            }));
            // 中性点标注 N
            this._wiringGroup.add(new Konva.Text({
                x: this._neutralX + 9, y: this._neutralY - 7,
                text: 'N', fontSize: Math.max(9, this.width * 0.019),
                fontStyle: 'bold', fill: '#d4a838',
            }));

            // Y 接大字标注
            this._wiringGroup.add(new Konva.Text({
                x: this._divX + 10, y: this.height - 62,
                text: 'Y 星形接法',
                fontSize: Math.max(15, this.width * 0.020),
                fontStyle: 'bold', fill: '#7090c0',
            }));

        } else {
            // ── 三角形接法 ────────────────────────────
            // Δ 接法：U1→W2, V1→U2, W1→V2
            // 连接顺序：首端连接前一相尾端，形成环路
            //   顶点位置 = 各相绕组首端（直接用首端作为三角形顶点）
            const triPts = [
                { x: phases[0].x1, y: phases[0].y1, color: termColors[0] },  // U首 → L1
                { x: phases[1].x1, y: phases[1].y1, color: termColors[1] },  // V首 → L2
                { x: phases[2].x1, y: phases[2].y1, color: termColors[2] },  // W首 → L3
            ];

            // 尾端融入顶点（首尾相接）：用折线连接尾端→下一相首端
            // U2 → V首, V2 → W首, W2 → U首（形成三角形内边）
            const innerConns = [
                { from: phases[0].x2, fy: phases[0].y2, to: phases[1].x1, ty: phases[1].y1, color: phases[0].color },
                { from: phases[1].x2, fy: phases[1].y2, to: phases[2].x1, ty: phases[2].y1, color: phases[1].color },
                { from: phases[2].x2, fy: phases[2].y2, to: phases[0].x1, ty: phases[0].y1, color: phases[2].color },
            ];

            // 绘制三角形三条边（尾端→首端弧线）
            innerConns.forEach(({ from, fy, to, ty, color }) => {
                // 找到中点，略微弯曲（quadratic bezier 经过中性点方向）
                const mx = (from + to) / 2 + (this._neutralX - (from + to) / 2) * 0.15;
                const my = (fy + ty)  / 2 + (this._neutralY - (fy + ty)  / 2) * 0.15;

                // 用折线近似（简洁清晰）
                this._wiringGroup.add(new Konva.Line({
                    points: [from, fy, to, ty],
                    stroke: color, strokeWidth: 2,
                    lineCap: 'round', lineJoin: 'round',
                }));
                // 连接节点
                this._wiringGroup.add(new Konva.Circle({
                    x: to, y: ty, radius: 4,
                    fill: color, stroke: 'rgba(255,255,255,0.3)', strokeWidth: 0.8,
                }));
            });

            // 三顶点到上端接线柱的连线
            triPts.forEach((tp, i) => {
                const t = this._terminals[i];
                const termEdge = t.y - this._termR;
                this._wiringGroup.add(new Konva.Line({
                    points: [tp.x, tp.y, t.x, termEdge],
                    stroke: tp.color, strokeWidth: 2, lineCap: 'round', lineJoin: 'round',
                }));
                // 顶点金色节点圆
                this._wiringGroup.add(new Konva.Circle({
                    x: tp.x, y: tp.y, radius: 5,
                    fillLinearGradientStartPoint: { x: -5, y: -5 },
                    fillLinearGradientEndPoint:   { x:  5, y:  5 },
                    fillLinearGradientColorStops: [0, '#9a8030', 0.5, '#e8c050', 1, '#9a8030'],
                    stroke: '#7a6028', strokeWidth: 1,
                }));
            });

            // Δ 接大字标注
            this._wiringGroup.add(new Konva.Text({
                x: this._divX + 10, y: this.height - 62,
                text: 'Δ 三角形接法',
                fontSize: Math.max(15, this.width * 0.020),
                fontStyle: 'bold', fill: '#c09050',
            }));
        }
    }

    /** 运行状态指示灯 + 旋转方向标注 */
    _createRunIndicator() {
        const cx = this._motorCX, cy = this._motorCY;
        const rO = this._rFrame;
        const fs = Math.max(14, this.width * 0.018);

        // 左侧顶部状态LED
        this._stateLed = new Konva.Circle({
            x: cx, y: cy - rO - 12,
            radius: 6,
            fill: this._state === 'run' ? '#20ee40' : '#b0c8b8',
            stroke: '#809888', strokeWidth: 2, listening: false,
        });
        this._dynamicGroup.add(this._stateLed);

        this._stateText = new Konva.Text({
            x: cx + 9, y: cy - rO - 18,
            text: this._state === 'run' ? '运行' : '停止',
            fontSize: fs, fontStyle: 'bold',
            fill: this._state === 'run' ? '#209040' : '#606060',
            listening: false,
        });
        this._dynamicGroup.add(this._stateText);

        // 接法标注（左侧面板内）
        this._connText = new Konva.Text({
            x: cx - rO, y: cy - rO - 18,
            text: this._connection === 'Y' ? '☆ Y接' : '△ Δ接',
            fontSize: 16, fontStyle: 'bold',
            fill: this._connection === 'Y' ? '#08f624' : '#f12b08',
            listening: false,
        });
        this._dynamicGroup.add(this._connText);
    }

    /** 运行/停止按钮文字（动态组，每帧更新） */
    _createRunBtnText() {
        const rb = this._runBtnRect;
        const fs = Math.max(15, this.width * 0.018);
        this._runBtnText = new Konva.Text({
            x: rb.x, y: rb.y + 4, width: rb.w,
            text: this._state === 'run' ? '■ 停止' : '▶ 运行',
            fontSize: fs, fill: this._state === 'run' ? '#e06040' : '#40d060', align: 'center',
        });
        this._dynamicGroup.add(this._runBtnText);
    }

    // ═══════════════════════════════════════════
    // 动态更新（每帧 in-place）
    // ═══════════════════════════════════════════

    _updateDynamic() {
        const running  = this._state === 'run';
        const omega    = this._currentOmega;
        const speedRPM = Math.round(omega * 60 / (2 * Math.PI));

        // 1) 转子旋转
        this._rotorGroup.rotation(this._rotorAngle * 180 / Math.PI);

        // 2) 旋转磁场（比转子超前，体现转差）
        this._fieldGroup.visible(running && omega > 0.5);
        if (running) {
            const fa = this._fieldAngle * 180 / Math.PI;
            const phaseColors = [
                `rgba(220,60,60,${0.40 + 0.30 * Math.sin(this._fieldPhase)})`,
                `rgba(60,180,60,${0.40 + 0.30 * Math.sin(this._fieldPhase + 2.09)})`,
                `rgba(60,100,230,${0.40 + 0.30 * Math.sin(this._fieldPhase + 4.19)})`,
            ];
            this._fieldArcs.forEach((arc, k) => {
                arc.rotation(fa + k * 60);
                arc.fill(phaseColors[k % 3]);
            });
        }

        // 3) 转速/转向显示
        this._speedText.text(`${speedRPM} rpm`);
        this._speedText.fill(running ? '#209040' : '#707070');

        this._dirArrow.visible(running && omega > 1);
        this._dirArrowHead.visible(running && omega > 1);
        if (running && omega > 1) {
            // 箭头尖（在弧末端画小三角）
            const aEnd = (-210 + 240) * Math.PI / 180;
            const r    = this._rRotor + 8;
            const ax   = this._motorCX + r * Math.cos(aEnd);
            const ay   = this._motorCY + r * Math.sin(aEnd);
            const aTan = aEnd + Math.PI / 2;
            const aSize = 5;
            this._dirArrowHead.points([
                ax + aSize * Math.cos(aTan), ay + aSize * Math.sin(aTan),
                ax - aSize * Math.cos(aTan), ay - aSize * Math.sin(aTan),
                ax + aSize * Math.cos(aEnd), ay + aSize * Math.sin(aEnd),
            ]);
        }

        // 4) 状态 LED
        this._stateLed.fill(running ? '#20ee40' : '#b0c8b8');
        this._stateText.text(running ? '运行' : '停止');
        this._stateText.fill(running ? '#209040' : '#606060');

        // 5) 接法标注
        this._connText.text(this._connection === 'Y' ? '☆ Y接' : '△ Δ接');
        this._connText.fill(this._connection === 'Y' ? '#181ff0' : '#f52b1c');

        // 6) 运行/停止按钮文字
        this._runBtnText.text(running ? '■ 停止' : '▶ 运行');
        this._runBtnText.fill(running ? '#e06040' : '#40d060');

        // 7) 接线图淡出淡入
        this._wiringGroup.opacity(this._switchAlpha);
    }

    // ═══════════════════════════════════════════
    // 交互绑定
    // ═══════════════════════════════════════════

    _bindInteraction() {
        // Y/Δ 切换按钮
        const sb = this._switchBtnRect;
        const switchHit = new Konva.Rect({
            x: sb.x, y: sb.y, width: sb.w, height: sb.h, fill: 'transparent',
        });
        switchHit.on('click tap', () => {
            if (this._switchAnim) return;
            this._startConnectionSwitch(this._connection === 'Y' ? 'D' : 'Y');
        });
        switchHit.on('mouseenter', () => { document.body.style.cursor = 'pointer'; });
        switchHit.on('mouseleave', () => { document.body.style.cursor = 'default'; });
        this._interactGroup.add(switchHit);

        // 运行/停止按钮
        const rb = this._runBtnRect;
        const runHit = new Konva.Rect({
            x: rb.x, y: rb.y, width: rb.w, height: rb.h, fill: 'transparent',
        });
        runHit.on('click tap', () => {
            this._state === 'run' ? this.stop() : this.start();
        });
        runHit.on('mouseenter', () => { document.body.style.cursor = 'pointer'; });
        runHit.on('mouseleave', () => { document.body.style.cursor = 'default'; });
        this._interactGroup.add(runHit);
    }

    _startConnectionSwitch(target) {
        this._switchTarget = target;
        this._switchAnim   = true;
        this._switchT      = 0;
        this._switchPhase  = 'out';
    }

    // ═══════════════════════════════════════════
    // tick（20fps）
    // ═══════════════════════════════════════════

    tick(dt) {
        // 1) 启停加速度
        const omegaDiff = this._targetOmega - this._currentOmega;
        if (Math.abs(omegaDiff) > 0.5) {
            const dur = this._targetOmega > this._currentOmega ? this._accelDur : this._decelDur;
            this._currentOmega += (this._omega / dur) * dt * Math.sign(omegaDiff);
            if (Math.sign(this._currentOmega - this._targetOmega) !== Math.sign(omegaDiff)) {
                this._currentOmega = this._targetOmega;
            }
        }

        // 2) 转子角度累积（视觉慢速，上限 π rad/s ≈ 30rpm，便于观察）
        const visualOmega = Math.min(this._currentOmega, Math.PI);
        this._rotorAngle += visualOmega * dt;
        // 磁场角度（比转子快约5%，体现转差率）
        this._fieldAngle  = this._rotorAngle * 1.05;
        this._fieldPhase += dt * visualOmega * 0.10;

        // 3) 接线切换动画
        if (this._switchAnim) {
            this._switchT += dt / (this._switchDur * 0.5);
            if (this._switchPhase === 'out') {
                this._switchAlpha = 1 - this._switchT;
                if (this._switchT >= 1) {
                    // 淡出完成 → 切换接法 → 开始淡入
                    this._connection   = this._switchTarget;
                    this._drawWiringForConnection(this._connection);
                    this._switchPhase  = 'in';
                    this._switchT      = 0;
                    this._switchAlpha  = 0;
                }
            } else {
                this._switchAlpha = this._switchT;
                if (this._switchT >= 1) {
                    this._switchAlpha = 1;
                    this._switchAnim  = false;
                }
            }
        }

        this._updateDynamic();
        this.markDirty();
        this._refreshIfDirty();
    }

    // ═══════════════════════════════════════════
    // 公开 API
    // ═══════════════════════════════════════════

    /** 启动电机 */
    start() {
        if (this._state === 'run') return;
        this._state       = 'run';
        this._targetOmega = this._omega;
        this.opsCount++;
    }

    /** 停止电机 */
    stop() {
        if (this._state === 'stop') return;
        this._state       = 'stop';
        this._targetOmega = 0;
        this.opsCount++;
    }

    /** 切换接法 */
    switchConnection(conn) {
        const c = String(conn).toUpperCase();
        if (c !== 'Y' && c !== 'D') return;
        if (c === this._connection) return;
        this._startConnectionSwitch(c);
    }

    /** 设置转速（运行时有效） */
    setSpeed(rpm) {
        this.ratedSpeed   = rpm;
        this._omega       = rpm * 2 * Math.PI / 60;
        if (this._state === 'run') this._targetOmega = this._omega;
    }

    getState()      { return this._state; }
    getConnection() { return this._connection; }
    getSpeedRPM()   { return Math.round(this._currentOmega * 60 / (2 * Math.PI)); }
    isRunning()     { return this._state === 'run'; }
    getOpsCount()   { return this.opsCount; }

    update(state) {
        const v = String(state).toLowerCase();
        if (v === 'run'  || v === '1') this.start();
        if (v === 'stop' || v === '0') this.stop();
        if (v === 'y') this.switchConnection('Y');
        if (v === 'd') this.switchConnection('D');
    }

    getConfigFields() {
        return [
            { label: '位号/名称',       key: 'label',        type: 'text'   },
            { label: '极数',             key: 'poles',        type: 'number' },
            { label: '额定功率 (kW)',    key: 'ratedPower',   type: 'number' },
            { label: '额定电压 (V)',     key: 'ratedVoltage', type: 'number' },
            { label: '额定电流 (A)',     key: 'ratedCurrent', type: 'number' },
            { label: '额定转速 (rpm)',   key: 'ratedSpeed',   type: 'number' },
            { label: '接法 Y/D',         key: 'connection',   type: 'text'   },
            { label: '初始状态 run/stop',key: 'initState',    type: 'text'   },
            { label: 'U 相对地电阻 (Ω)', key: 'uohm',         type: 'number' },
            { label: 'V 相对地电阻 (Ω)', key: 'vohm',         type: 'number' },
            { label: 'W 相对地电阻 (Ω)', key: 'wohm',         type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label        !== undefined) this.label        = cfg.label;
        if (cfg.poles        !== undefined) this.poles        = parseInt(cfg.poles);
        if (cfg.ratedPower   !== undefined) this.ratedPower   = parseFloat(cfg.ratedPower);
        if (cfg.ratedVoltage !== undefined) this.ratedVoltage = parseFloat(cfg.ratedVoltage);
        if (cfg.ratedCurrent !== undefined) this.ratedCurrent = parseFloat(cfg.ratedCurrent);
        if (cfg.ratedSpeed   !== undefined) this.setSpeed(parseFloat(cfg.ratedSpeed));
        if (cfg.connection   !== undefined) this.switchConnection(cfg.connection);
        if (cfg.initState    !== undefined) this.update(cfg.initState);
        if (cfg.uohm !== undefined) this.uohm = parseFloat(cfg.uohm);
        if (cfg.vohm !== undefined) this.vohm = parseFloat(cfg.vohm);
        if (cfg.wohm !== undefined) this.wohm = parseFloat(cfg.wohm);
        this.config = { ...this.config, ...cfg };
        this._recalcGeometry();
        this._staticGroup.destroyChildren();
        this._dynamicGroup.destroyChildren();
        this._drawStaticParts();
        this._createDynamicNodes();
        this._refreshCache();
    }

    destroy() { super.destroy?.(); }
}
