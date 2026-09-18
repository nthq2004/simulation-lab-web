/**
 * JSZ3N 断电延时继电器组件。
 *
 * 该组件用于仿真一种断电延时继电器：线圈通电时继电器立即吸合并保持输出，
 * 线圈断电后进入设定的延时阶段，延时结束后触点释放并恢复待机状态。
 *
 * 主要功能包括：
 * 1. 绘制继电器面板、0~30 秒延时刻度盘、指针、线圈和端子接点示意图；
 * 2. 通过线圈两端电压判断继电器的通电、断电和释放过程；
 * 3. 通过状态机维护“待机、断电延时中、输出”三种工作状态；
 * 4. 使用动态指示灯、进度弧线和触点动画反映当前继电器状态；
 * 5. 支持鼠标滚轮、点击和拖动调节延时时间，并支持配置面板更新参数。
 */
import { BaseComponent } from './BaseComponent.js';

export class JSZ3N extends BaseComponent {
    constructor(config, sys) {
        // 调用父类构造函数，初始化组件基础属性、系统引用和 Konva 容器。
        super(config, sys);

        // 限制组件的最小尺寸，避免面板、刻度盘和端子布局发生重叠。
        this.width = Math.max(380, config.width || 420);
        this.height = Math.max(240, config.height || 280);

        // 标记该组件属于继电器，并进一步标识其为时间控制类器件。
        this.type = 'relay';
        this.special = 'time';
        // 启用固定缓存，使静态面板图形不必在每一帧重复构建。
        this.cache = 'fixed';

        // 按统一生命周期初始化图层、几何参数、运行参数和图形节点。
        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        // 保存当前配置快照，便于外部配置面板读取和更新。
        this.config = {
            id: this.id,
            delayTime: this.delayTime,
            coilResistance: this._coilResistance,
        };

        // 取得端子圆盘的中心和半径，用于计算实际端口坐标。
        const cr = this._termCircleR;
        const cx = this._termCircleCx;
        const cy = this._termCircleCy;

        // 将端子编号、端子名称和角度转换为组件可连接的电气端口。
        this._termDefs.forEach(([n, portName, ang]) => {
            const rad = ang * Math.PI / 180;
            const px = cx + cr * Math.cos(rad);
            const py = cy + cr * Math.sin(rad);
            this.addPort(px, py, portName, 'wire', portName === 'l' || portName === 'r' ? 'p' : null);
        });
    }

    _recalcGeometry() {
        // 根据组件宽高重新计算面板分隔线、刻度盘和端子圆盘的位置。
        const W = this.width, H = this.height;
        this._divX = W * 0.48;
        this._frame = { x: 2, y: 2, w: W - 4, h: H - 4, rx: 8 };

        // 左侧刻度盘采用面板左半区的中心位置，并根据可用空间确定最大半径。
        const lCx = this._divX / 2;
        const lCy = H * 0.49;
        const lMaxR = Math.max(lCx * 0.9, lCy * 0.55, (H - lCy) * 0.55);
        this._dialCx = lCx;
        this._dialCy = lCy;
        this._dialR = Math.max(60, lMaxR);

        // 刻度盘从 135 度开始，沿 270 度范围对应 0~30 秒。
        this._dialStartAngle = 135;
        this._dialSweep = 270;

        // 分别定义主刻度和副刻度的长度，增强时间读数层次。
        this._majorTickLen = 12;
        this._minorTickLen = 6;

        // 右侧端子圆盘根据剩余面板空间计算中心和最大半径。
        const rLeft = this._divX + 15;
        const rRight = W - 15;
        const rWidth = rRight - rLeft;
        this._termCircleCx = (rLeft + rRight) / 2;
        this._termCircleCy = H / 2;
        this._termCircleR = Math.min(rWidth * 0.44, H * 0.40, 110);

        // 定义 8 个接线端子的编号、端口名称和圆周角度。
        this._termDefs = [
            [1, 'com_b', 112.5],
            [2, 'l', 157.5],
            [3, 'no_b', 202.5],
            [4, 'nc_b', 247.5],
            [5, 'nc_a', 292.5],
            [6, 'no_a', 337.5],
            [7, 'r', 22.5],
            [8, 'com_a', 67.5],
        ];

        // 计算电源灯、输出灯的显示位置及统一半径。
        this._ledPowerX = lCx - 30;
        this._ledOutputX = lCx + 30;
        this._ledY = H - 28;
        this._ledR = 6;
    }

    _initParameters(config) {
        // 读取延时时间并限制在 0~30 秒范围内，默认延时为 10 秒。
        this.delayTime = config.delayTime !== undefined ? parseFloat(config.delayTime) : 10;
        this.delayTime = Math.max(0, Math.min(30, this.delayTime));
        // 保存线圈电阻参数，供组件配置和后续仿真扩展使用。
        this._coilResistance = config.coilResistance || 2000;
        // 初始状态为待机，尚未发生通电或断电延时。
        this._state = 'idle';
        // 记录断电延时阶段已经经过的时间。
        this._elapsed = 0;
        // 对线圈电压做平滑处理，减少瞬时电压波动造成的状态抖动。
        this._vAvg = 0;
        // 吸合和释放电压分别作为通电、断电判断阈值。
        this._pickupV = 160;
        this._releaseV = 40;
        // 动画计时器用于驱动延时状态下的指示灯闪烁。
        this._animTick = 0;
        // 保存上一次动态显示参数，避免不必要地重算进度弧线。
        this._san = null;
    }

    _init() {
        // 先绘制静态图形，再创建动态节点，最后绑定用户交互。
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
    }

    _drawStaticParts() {
        // 绘制继电器外框、标题、左侧背景和中间分隔线。
        const f = this._frame;
        this._staticGroup.add(new Konva.Rect({
            x: f.x, y: f.y, width: f.w, height: f.h,
            fill: '#f0ece4', stroke: '#b8a898', strokeWidth: 1.5, cornerRadius: f.rx,
        }));
        this._staticGroup.add(new Konva.Text({
            x: 28, y: -18, text: 'JSZ3N 断电延时继电器', fontSize: 16, fontStyle: 'bold', fill: '#202838',
        }));
        this._staticGroup.add(new Konva.Rect({
            x: f.x + 2, y: f.y + 2, width: this._divX - f.x - 2, height: f.h - 4,
            fill: '#f5f2ea', cornerRadius: [f.rx, 0, 0, f.rx],
        }));
        this._staticGroup.add(new Konva.Line({
            points: [this._divX, 10, this._divX, this.height - 10],
            stroke: '#b0a898', strokeWidth: 1.5, dash: [5, 3],
        }));

        // 在静态图层中分别绘制时间设定盘和端子接点示意图。
        this._drawDialStatic();
        this._drawTerminalCircle();
    }

    _drawDialStatic() {
        // 生成刻度盘轨迹、外边框、主副刻度和时间单位文字。
        const cx = this._dialCx, cy = this._dialCy, R = this._dialR;
        const startA = this._dialStartAngle;
        const sweep = this._dialSweep;

        const steps = 80;
        const trackPts = [];
        const midR = R - 7;
        const startRad = startA * Math.PI / 180;
        // 沿圆弧采样多个点，生成平滑的刻度盘背景轨迹。
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const a = startRad + sweep * t * Math.PI / 180;
            trackPts.push(cx + midR * Math.cos(a), cy + midR * Math.sin(a));
        }
        this._staticGroup.add(new Konva.Line({
            points: trackPts, stroke: '#e0d8cc', strokeWidth: 16,
            lineCap: 'round', listening: false,
        }));

        const borderPts = [];
        // 使用相同角度范围绘制刻度盘外边框。
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const a = startRad + sweep * t * Math.PI / 180;
            borderPts.push(cx + R * Math.cos(a), cy + R * Math.sin(a));
        }
        this._staticGroup.add(new Konva.Line({
            points: borderPts, stroke: '#c8b8a0', strokeWidth: 3,
            lineCap: 'round', listening: false,
        }));

        // 逐秒生成刻度，每 5 秒生成一条较长主刻度并显示数字。
        for (let s = 0; s <= 30; s++) {
            const frac = s / 30;
            const ang = (startA + frac * this._dialSweep) * Math.PI / 180;
            const isMajor = s % 5 === 0;
            const tickLen = isMajor ? this._majorTickLen : this._minorTickLen;
            const rInner = R - 7;
            const x1 = cx + rInner * Math.cos(ang);
            const y1 = cy + rInner * Math.sin(ang);
            const x2 = cx + (rInner - tickLen) * Math.cos(ang);
            const y2 = cy + (rInner - tickLen) * Math.sin(ang);

            this._staticGroup.add(new Konva.Line({
                points: [x1, y1, x2, y2],
                stroke: '#504030', strokeWidth: isMajor ? 2 : 1,
                lineCap: 'round', listening: false,
            }));

            if (isMajor) {
                const lr = rInner - tickLen - 15;
                this._staticGroup.add(new Konva.Text({
                    x: cx + lr * Math.cos(ang) - 8,
                    y: cy + lr * Math.sin(ang) - 7,
                    text: String(s), fontSize: 12, fill: '#403020',
                    listening: false,
                }));
            }
        }

        this._staticGroup.add(new Konva.Text({
            x: cx - 8, y: cy + R * 0.55, text: '秒', fontSize: 12,
            fill: '#504030', listening: false,
        }));

        this._staticGroup.add(new Konva.Text({
            x: cx - 25, y: cy - R - 30, text: '延时设定', fontSize: 13,
            fill: '#504030', listening: false,
        }));

        this._staticGroup.add(new Konva.Text({
            x: cx - 20, y: cy - R - 14, text: '0 ~ 30', fontSize: 12,
            fill: '#706050', listening: false,
        }));

        const dR = R * 0.22;
        // 绘制中心旋钮及其内侧圆点，形成可交互旋钮的视觉主体。
        const dGrad = [0, '#908878', 0.3, '#c8c0b0', 0.7, '#b8b0a0', 1, '#706858'];
        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: dR,
            fillLinearGradientStartPoint: { x: -dR, y: -dR },
            fillLinearGradientEndPoint: { x: dR, y: dR },
            fillLinearGradientColorStops: dGrad,
            stroke: '#605040', strokeWidth: 2,
        }));
        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: dR * 0.15,
            fill: '#d0c8b8', stroke: '#807060', strokeWidth: 1,
        }));
    }

    _drawTerminalCircle() {
        // 绘制右侧端子圆盘，并在圆周上标出各端子编号和触点类型。
        const cx = this._termCircleCx, cy = this._termCircleCy, R = this._termCircleR;

        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: R,
            stroke: '#a09080', strokeWidth: 1.5, fill: '#ece8e0',
            listening: false,
        }));

        // 根据端子定义计算位置；常开端子使用单独颜色进行区分。
        this._termDefs.forEach(([num, portName, ang]) => {
            const rad = ang * Math.PI / 180;
            const px = cx + R * Math.cos(rad);
            const py = cy + R * Math.sin(rad);

            const isNO = num === 3 || num === 6;
            this._staticGroup.add(new Konva.Circle({
                x: px, y: py, radius: 10,
                fill: isNO ? '#f0c0b8' : '#d0c8b8',
                stroke: isNO ? '#d04020' : '#605040', strokeWidth: 2,
                listening: false,
            }));
            this._staticGroup.add(new Konva.Circle({
                x: px, y: py, radius: 4,
                fill: isNO ? '#c03020' : '#302818', listening: false,
            }));

            const lOff = 18;
            const lx = px + lOff * Math.cos(rad);
            const ly = py + lOff * Math.sin(rad);
            this._staticGroup.add(new Konva.Text({
                x: lx - 7, y: ly - 8,
                text: String(num), fontSize: 14, fontStyle: 'bold',
                fill: isNO ? '#d03020' : '#202020', listening: false,
            }));
        });

        // 端子圆盘内部继续补充线圈和触点结构示意。
        this._drawCoilSymbol();
        this._drawContactSymbols();
    }

    _drawCoilSymbol() {
        // 绘制 220V 线圈及其与 2、7 号端子的连接线路。
        const cx = this._termCircleCx, cy = this._termCircleCy, R = this._termCircleR;
        const H = this.height;

        const a2 = 157.5 * Math.PI / 180;
        const x2 = cx + R * Math.cos(a2);
        const y2 = cy + R * Math.sin(a2);

        const a7 = 22.5 * Math.PI / 180;
        const x7 = cx + R * Math.cos(a7);
        const y7 = cy + R * Math.sin(a7);

        const bottomY = H - 20;
        const coilW = 52;
        const coilH = 20;
        const coilY = bottomY - coilH;
        const coilLeft = cx - coilW / 2;
        const coilRight = cx + coilW / 2;

        // 绘制线圈左侧引线。
        this._staticGroup.add(new Konva.Line({
            points: [x2, y2, x2, bottomY, coilLeft, bottomY],
            stroke: '#605040', strokeWidth: 2, lineJoin: 'round', listening: false,
        }));

        // 绘制线圈外框。
        this._staticGroup.add(new Konva.Rect({
            x: coilLeft, y: coilY + coilH / 2, width: coilW, height: coilH,
            fill: '#f8f4ec', stroke: '#605040', strokeWidth: 2, cornerRadius: 4,
            listening: false,
        }));

        // 生成线圈内部的波形线，增强线圈符号的辨识度。
        const wave = this._genWave(coilLeft + 8, coilY + coilH, coilRight - 8, coilY + coilH, 4, 2.5);
        // 绘制线圈右侧引线并接回 7 号端子。
        this._staticGroup.add(new Konva.Line({
            points: wave, stroke: '#202020', strokeWidth: 2,
            lineCap: 'round', listening: false,
        }));

        this._staticGroup.add(new Konva.Line({
            points: [coilRight, bottomY, x7, bottomY, x7, y7],
            stroke: '#605040', strokeWidth: 2, lineJoin: 'round', listening: false,
        }));

        this._staticGroup.add(new Konva.Text({
            x: cx - 80, y: bottomY + 4,
            text: '线圈 220V~', fontSize: 12, fill: '#b02020',
            listening: false,
        }));
    }

    _drawContactSymbols() {
        // 绘制常闭、常开和公共触点的静态线路，并记录动态触臂所需的关键坐标。
        const cx = this._termCircleCx, cy = this._termCircleCy, R = this._termCircleR;

        const mkPt = (a, r) => ({
            x: cx + r * Math.cos(a),
            y: cy + r * Math.sin(a),
        });

        const p5 = mkPt(292.5 * Math.PI / 180, R);
        const p6 = mkPt(337.5 * Math.PI / 180, R);
        const p8 = mkPt(67.5 * Math.PI / 180, R);
        const p1 = mkPt(112.5 * Math.PI / 180, R);

        const vX = p5.x;
        const pivotY = cy - 15;
        const armLen = 14;

        const ncX = vX - armLen;
        const noX = vX + armLen;

        // NC path: terminal 5 → left → down → NC static contact
        this._staticGroup.add(new Konva.Line({
            points: [vX, p5.y, ncX, p5.y, ncX, pivotY],
            stroke: '#605040', strokeWidth: 2, lineJoin: 'round', listening: false,
        }));
        this._staticGroup.add(new Konva.Circle({
            x: ncX, y: pivotY, radius: 4,
            fill: '#d0c8b8', stroke: '#605040', strokeWidth: 1.5, listening: false,
        }));

        // NO path: terminal 6 → left → down → NO static contact
        this._staticGroup.add(new Konva.Line({
            points: [p6.x, p6.y, noX, p6.y, noX, pivotY],
            stroke: '#605040', strokeWidth: 2, lineJoin: 'round', listening: false,
        }));
        this._staticGroup.add(new Konva.Circle({
            x: noX, y: pivotY, radius: 4,
            fill: '#d0c8b8', stroke: '#605040', strokeWidth: 1.5, listening: false,
        }));

        // COM path: terminal 8 → up → pivot point
        this._staticGroup.add(new Konva.Line({
            points: [p8.x, p8.y, vX, pivotY + 50],
            stroke: '#605040', strokeWidth: 2, listening: false,
        }));
        this._staticGroup.add(new Konva.Circle({
            x: vX, y: pivotY + 50, radius: 3.5,
            fill: '#706050', stroke: '#504030', strokeWidth: 1.5, listening: false,
        }));

        this._ncContactPos = { x: ncX, y: pivotY };
        this._noContactPos = { x: noX, y: pivotY };
        this._comPivotPos = { x: vX, y: pivotY + 50 };

        // COM labels
        this._staticGroup.add(new Konva.Text({
            x: p8.x + 12, y: p8.y + 4,
            text: 'COM', fontSize: 11, fontStyle: 'bold', fill: '#605040',
            listening: false,
        }));
        this._staticGroup.add(new Konva.Text({
            x: p1.x - 40, y: p1.y + 4,
            text: 'COM', fontSize: 11, fontStyle: 'bold', fill: '#605040',
            listening: false,
        }));

        const offR = R + 24;

        const no3 = mkPt(202.5 * Math.PI / 180, offR);
        this._staticGroup.add(new Konva.Text({
            x: no3.x + 5 - 10, y: no3.y - 23,
            text: 'NO', fontSize: 13, fontStyle: 'bold', fill: '#208020',
            listening: false,
        }));
        const no6 = mkPt(337.5 * Math.PI / 180, offR);
        this._staticGroup.add(new Konva.Text({
            x: no6.x - 15 - 10, y: no6.y - 23,
            text: 'NO', fontSize: 13, fontStyle: 'bold', fill: '#208020',
            listening: false,
        }));

        const nc4 = mkPt(247.5 * Math.PI / 180, offR);
        this._staticGroup.add(new Konva.Text({
            x: nc4.x + 10, y: nc4.y - 8,
            text: 'NC', fontSize: 13, fontStyle: 'bold', fill: '#e03030',
            listening: false,
        }));
        const nc5 = mkPt(292.5 * Math.PI / 180, offR);
        this._staticGroup.add(new Konva.Text({
            x: nc5.x - 40 + 10, y: nc5.y - 8,
            text: 'NC', fontSize: 13, fontStyle: 'bold', fill: '#e03030',
            listening: false,
        }));
    }

    _genWave(x1, y1, x2, y2, amp, cycles) {
        // 按起点、终点、振幅和周期生成线圈符号使用的正弦波点列。
        const pts = [];
        const dx = x2 - x1;
        const dy = y2 - y1;
        const steps = Math.max(20, Math.round(cycles * 16));
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            pts.push(x1 + dx * t, y1 + dy * t + amp * Math.sin(t * cycles * 2 * Math.PI));
        }
        return pts;
    }


    _createDynamicNodes() {
        // 创建运行时需要更新的指针、指示灯、状态文本、进度弧和接点动画节点。
        this._needle = new Konva.Line({
            points: [0, 0, 0, 0],
            stroke: '#e02020', strokeWidth: 3, lineCap: 'round',
            listening: false,
        });
        this._dynamicGroup.add(this._needle);

        this._powerLed = new Konva.Circle({
            x: this._ledPowerX, y: this._ledY, radius: this._ledR,
            fill: '#103010', stroke: '#205020', strokeWidth: 1,
            listening: false,
        });
        this._dynamicGroup.add(this._powerLed);
        this._powerLabel = new Konva.Text({
            x: this._ledPowerX - 12, y: this._ledY + this._ledR + 3,
            text: '电源', fontSize: 12, fill: '#406040',
            listening: false,
        });
        this._dynamicGroup.add(this._powerLabel);

        this._outputLed = new Konva.Circle({
            x: this._ledOutputX, y: this._ledY, radius: this._ledR,
            fill: '#301010', stroke: '#502020', strokeWidth: 1,
            listening: false,
        });
        this._dynamicGroup.add(this._outputLed);
        this._outputLabel = new Konva.Text({
            x: this._ledOutputX - 12, y: this._ledY + this._ledR + 3,
            text: '输出', fontSize: 12, fill: '#504040',
            listening: false,
        });
        this._dynamicGroup.add(this._outputLabel);

        this._stateText = new Konva.Text({
            x: this._dialCx - 12, y: this._dialCy + this._dialR * 0.9,
            text: '', fontSize: 14, fill: '#607080',
            listening: false,
        });
        this._dynamicGroup.add(this._stateText);

        this._progressArc = new Konva.Line({
            points: [], stroke: '#20a030', strokeWidth: 4,
            lineCap: 'round', listening: false,
            visible: false,
        });
        this._dynamicGroup.add(this._progressArc);

        this._contactArm = new Konva.Line({
            points: [0, 0, 0, 0],
            stroke: '#d04020', strokeWidth: 2.5, lineCap: 'round',
            listening: false,
        });
        this._dynamicGroup.add(this._contactArm);

        this._springL = new Konva.Line({
            points: [0, 0, 0, 0],
            stroke: '#d04020', strokeWidth: 2, lineCap: 'round',
            listening: false,
        });
        this._dynamicGroup.add(this._springL);
        this._springR = new Konva.Line({
            points: [0, 0, 0, 0],
            stroke: '#d04020', strokeWidth: 2, lineCap: 'round',
            listening: false,
        });
        this._dynamicGroup.add(this._springR);
        this._hookL = new Konva.Line({
            points: [0, 0, 0, 0],
            stroke: '#d04020',
            strokeWidth: 2,
            lineCap: 'round',
            lineJoin: 'round',
            listening: false,
        });
        this._dynamicGroup.add(this._hookL);

        // 接点动画从释放位置开始，速度用于实现平滑的弹簧式过渡。
        this._contactAnim = 0;
        this._contactAnimVel = 0;

        this._updateNeedle();
        this._updateLEDs();
        this._updateContactVisual();
    }

    _updateNeedle() {
        // 将延时时间映射为刻度盘角度，并更新指针的起点和终点。
        const frac = this.delayTime / 30;
        const ang = (this._dialStartAngle + frac * this._dialSweep) * Math.PI / 180;
        const R = this._dialR;
        const cx = this._dialCx, cy = this._dialCy;
        const innerR = R * 0.25;
        const outerR = R - 9;

        this._needle.points([
            cx + innerR * Math.cos(ang + Math.PI),
            cy + innerR * Math.sin(ang + Math.PI),
            cx + outerR * Math.cos(ang),
            cy + outerR * Math.sin(ang),
        ]);
    }

    _updateLEDs() {
        // 电源灯反映线圈是否通电，输出灯反映输出或断电延时过程。
        const energized = this._vAvg > this._pickupV;
        const output = this._state === 'output' || this._state === 'delay';

        this._powerLed.fill(energized ? '#20c020' : '#103010');
        this._powerLabel.fill(energized ? '#30d030' : '#406040');

        const blink = this._state === 'delay' && Math.sin(this._animTick * 6) > 0;

        if (this._state === 'output') {
            this._outputLed.fill('#ff3020');
            this._outputLabel.fill('#ff4030');
        } else if (blink) {
            this._outputLed.fill('#ff2000');
            this._outputLabel.fill('#d05030');
        } else {
            this._outputLed.fill('#301010');
            this._outputLabel.fill('#504040');
        }
    }

    _updateDynamic() {
        // 根据状态和已经过时间更新进度弧、状态文字及触点动画目标位置。
        const st = this._state;
        const et = this._elapsed;

        const _dirty = !this._san || this._san.st !== st || Math.abs(this._san.et - et) > 0.01 || this._san.dt !== this.delayTime;
        // 只有状态、延时进度或设定时间发生明显变化时才重算进度弧线。
        if (_dirty) {
            this._san = { st, et, dt: this.delayTime };
            this._progressArc.visible(st === 'delay');
            if (st === 'delay' && this.delayTime > 0) {
                const frac = Math.min(1, et / this.delayTime);
                const cx = this._dialCx, cy = this._dialCy;
                const R = this._dialR - 5;
                const startA = this._dialStartAngle;
                const endA = startA + frac * this._dialSweep;
                const steps = 30;
                const pts = [];
                const startRad = startA * Math.PI / 180;
                const endRad = endA * Math.PI / 180;
                for (let i = 0; i <= steps; i++) {
                    const t = i / steps;
                    const a = startRad + (endRad - startRad) * t;
                    pts.push(cx + R * Math.cos(a), cy + R * Math.sin(a));
                }
                this._progressArc.points(pts);
            }

            const stateMap = {
                idle: '待机',
                delay: '断电延时中',
                output: '输出',
            };
            this._stateText.text(stateMap[st] || '');

            // 输出状态和断电延时状态都保持触点吸合方向，待机状态恢复释放方向。
            if (st === 'output' || st === 'delay') {
                this._contactAnimTarget = 1;
            } else {
                this._contactAnimTarget = 0;
            }
        }

        this._updateContactVisual();
        this._updateLEDs();
    }

    _updateContactVisual() {

    // 根据接点动画进度，在常闭触点和常开触点之间插值移动动触点。

    const nc = this._ncContactPos;
    const no = this._noContactPos;
    const pov = this._comPivotPos;
    const t = this._contactAnim;
    //--------------------------------------
    // 1. 动触点位置
    //--------------------------------------
    const mx =
        nc.x + (no.x - nc.x) * t;
    const my =
        nc.y + (no.y - nc.y) * t;
    //--------------------------------------
    // 2. 动触臂
    //--------------------------------------
    this._contactArm.points([
        pov.x,
        pov.y,
        mx,
        my
    ]);
    //--------------------------------------
    // 3. 动触臂方向
    //--------------------------------------
    let dx = mx - pov.x;
    let dy = my - pov.y;
    let len = Math.sqrt(
        dx * dx +
        dy * dy
    );
    // 当触臂长度过小时无法稳定计算单位向量，直接保留当前图形。
    if(len < 0.001)
        return;
    let ux = dx / len;
    let uy = dy / len;
    //--------------------------------------
    // 4. 法向量
    //--------------------------------------
    let vx = -uy;
    let vy = ux;
    // 调整法向量方向，保证弹簧始终绘制在触臂左侧。
    if(vx > 0)
    {
        vx = -vx;
        vy = -vy;
    }
    //--------------------------------------
    // 5. 簧片起点
    //--------------------------------------
    // 将簧片起点放在触臂靠近动触点的一侧。
    const startRatio = 0.55;
    const sx =
        pov.x + dx * startRatio;
    const sy =
        pov.y + dy * startRatio;
    //--------------------------------------
    // 6. 簧片长度
    //--------------------------------------
    const springLength = 18;
    const spread = 3;
    //--------------------------------------
    // 7. 两根直线
    //--------------------------------------
    const l1x1 =
        sx + ux * spread;
    const l1y1 =
        sy + uy * spread;
    const l1x2 =
        sx + ux * spread
           + vx * springLength;
    const l1y2 =
        sy + uy * spread
           + vy * springLength;
    const l2x1 =
        sx - ux * spread;
    const l2y1 =
        sy - uy * spread;
    const l2x2 =
        sx - ux * spread
           + vx * springLength;
    const l2y2 =
        sy - uy * spread
           + vy * springLength;
    this._springL.points([
        l1x1,
        l1y1,
        l1x2,
        l1y2
    ]);
    this._springR.points([
        l2x1,
        l2y1,
        l2x2,
        l2y2
    ]);
    //--------------------------------------
    // 8. 弧形接在两根簧片尾端并向两侧展开
    //--------------------------------------
    const points = [];
    const segments = 20;
    const sideExtend = 5;
    const bend = 10;
    const baseExtend = 9;
    const ax1 = l1x2 + ux * sideExtend;
    const ay1 = l1y2 + uy * sideExtend;
    const ax2 = l2x2 - ux * sideExtend;
    const ay2 = l2y2 - uy * sideExtend;
    for (let i = 0; i <= segments; i++) {
        const k = i / segments;
        const x = ax1 + (ax2 - ax1) * k;
        const y = ay1 + (ay2 - ay1) * k;
        const offset = baseExtend - Math.sin(Math.PI * k) * bend;
        points.push(x + vx * offset, y + vy * offset);
    }
    this._hookL.points(points);
}

    _bindInteraction() {
        // 在旋钮中心创建透明交互区域，支持滚轮、拖动和左右点击调节延时时间。
        const cx = this._dialCx, cy = this._dialCy;
        const knobHit = new Konva.Circle({
            x: cx, y: cy, radius: this._dialR * 0.35,
            draggable: true, fill: 'transparent',
        });
        // 每次调节半秒，并将结果限制到刻度盘的有效范围。
        const step = 0.5;
        const clamp = (v) => Math.max(0, Math.min(30, Math.round(v / step) * step));

        knobHit.on('wheel', (e) => {
            // 滚轮向上增加延时，向下减少延时，同时阻止事件继续传递。
            e.evt.preventDefault();
            e.evt.stopPropagation();
            this.delayTime = clamp(this.delayTime + (e.evt.deltaY < 0 ? step : -step));
            this._redrawDynamic();
        });

        const origX = cx, origY = cy;
        let dragY = 0, dragAccum = 0;
        knobHit.on('dragstart', (e) => {
            // 拖动开始时清零累计位移，后续按垂直位移换算时间步数。
            dragY = knobHit.getStage().getPointerPosition().y;
            dragAccum = 0;
            e.cancelBubble = true;
        });
        knobHit.on('dragmove', (e) => {
            // 拖动过程中每积累 10 像素就改变一个半秒步长，并将旋钮固定在原位。
            e.cancelBubble = true;
            const curY = knobHit.getStage().getPointerPosition().y;
            const dy = origY - curY;
            dragAccum += dy;
            const s = Math.round(dragAccum / 10);
            if (s !== 0) {
                this.delayTime = clamp(this.delayTime + s * step);
                this._redrawDynamic();
                dragAccum -= s * 10;
            }
            knobHit.position({ x: origX, y: origY });
        });
        knobHit.on('dragend', (e) => {
            e.cancelBubble = true;
            knobHit.position({ x: origX, y: origY });
        });

        knobHit.on('mousedown touchstart', (e) => {
            // 点击旋钮左侧减少时间，点击右侧增加时间。
            const pos = knobHit.getRelativePointerPosition();
            if (pos.x < 0) {
                this.delayTime = clamp(this.delayTime - step);
            } else {
                this.delayTime = clamp(this.delayTime + step);
            }
            this._redrawDynamic();
            e.cancelBubble = true;
        });
        knobHit.on('mouseenter', () => { document.body.style.cursor = 'pointer'; });
        knobHit.on('mouseleave', () => { document.body.style.cursor = 'default'; });
        this._interactGroup.add(knobHit);
    }

    tick(dt) {
        // 每个仿真步读取线圈电压并进行平滑，作为断电延时状态机的输入。
        if (this.sys && typeof this.sys.getVoltageBetween === 'function') {
            const vInst = Math.abs(this.sys.getVoltageBetween(
                `${this.id}_wire_l`,
                `${this.id}_wire_r`
            ));
            this._vAvg = this._vAvg * 0.92 + (isFinite(vInst) ? vInst : 0) * 0.08;
        } else {
            this._vAvg *= 0.9;
        }
        // 累计动画时间，用于断电延时阶段的输出灯闪烁。
        this._animTick += dt;

        // 使用不同阈值区分通电和断电，形成迟滞，避免电压临界值附近反复切换。
        const energized = this._vAvg > this._pickupV;
        const deenergized = this._vAvg < this._releaseV;

        // 断电延时继电器的状态机：通电立即输出，断电后延时，延时结束回到待机。
        if (this._state === 'idle') {
            if (energized) {
                this._state = 'output';
                this._elapsed = 0;
            }
        } else if (this._state === 'output') {
            if (deenergized) {
                this._state = 'delay';
                this._elapsed = 0;
            }
        } else if (this._state === 'delay') {
            if (energized) {
                this._state = 'output';
                this._elapsed = 0;
            } else {
                this._elapsed += dt;
                if (this._elapsed >= this.delayTime) {
                    this._state = 'idle';
                    this._elapsed = 0;
                }
            }
        }

        // 使用带阻尼的插值让触点平滑移动到目标位置，而不是瞬间跳变。
        const target = this._contactAnimTarget !== undefined ? this._contactAnimTarget : 0;
        const diff = target - this._contactAnim;
        if (Math.abs(diff) > 0.001) {
            this._contactAnimVel += diff * 30 * dt;
            this._contactAnimVel *= 0.82;
            this._contactAnim += this._contactAnimVel;
            this._contactAnim = Math.max(0, Math.min(1, this._contactAnim));
        } else {
            this._contactAnim = target;
            this._contactAnimVel = 0;
        }

        // 刷新动态节点并请求系统重绘当前组件。
        this._updateDynamic();
        this.markDirty();
        this._refreshIfDirty();
        if (this.sys && typeof this.sys.requestRedraw === 'function') {
            this.sys.requestRedraw();
        }
    }

    _redrawDynamic() {
        // 参数变化后立即刷新指针、状态图形和画布显示。
        this._updateNeedle();
        this._updateDynamic();
        if (this.sys && typeof this.sys.requestRedraw === 'function') {
            this.sys.requestRedraw();
        }
    }

    getConfigFields() {
        // 配置面板公开延时时间这一核心参数，并限制输入范围和步进值。
        return [
            { label: '延时时间 (s)', key: 'delayTime', type: 'number', min: 0, max: 30, step: 0.5 },
        ];
    }

    onConfigUpdate(cfg) {
        // 接收外部配置更新，校正延时时间后同步配置快照和动态显示。
        if (cfg.delayTime !== undefined) {
            this.delayTime = Math.max(0, Math.min(30, parseFloat(cfg.delayTime)));
        }
        this.config = { ...this.config, delayTime: this.delayTime };
        this._redrawDynamic();
        this._refreshCache?.();
    }

    // 销毁组件时调用父类清理逻辑，释放图形和交互资源。
    destroy() { super.destroy?.(); }
}
