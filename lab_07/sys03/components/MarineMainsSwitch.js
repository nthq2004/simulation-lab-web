import { BaseComponent } from './BaseComponent.js';

/**
 * MarineMainsSwitch 船用发电机主开关（框架式空气断路器）
 * 尺寸 600×360：左侧 150 控制面板，右侧 450 机械本体。
 * 复用求解器 ACB 类型（stampACBs）—— 合闸注入 0.0001Ω，分闸注入 10e9Ω。
 */
export class MarineMainsSwitch extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(480, config.width  || 600);
        this.height = Math.max(260, config.height || 300);

        this.type    = 'ACB';
        this.special = 'MainsSwitch';
        this.cache   = 'fixed';

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        this.config = {
            id: this.id,
            label:            this.label,
            ratedCtrlVoltage: this.ratedCtrlVoltage,
            initState:        this._state,
            initCharge:       this._charged ? 'on' : 'off',
            initWorkPos:      ['connected', 'test', 'disconnected'][this._workPos],
            animDur:          this._animDur,
            coilResistance:   this._coilResistance,
        };

        // 主回路端口（顶部 L1/L2/L3，底部 T1/T2/T3 + 右侧 ET 电子脱扣接口）
        ['l1', 'l2', 'l3'].forEach((nm, i) => {
            this.addPort(this._staticXs[i], 2, nm, 'wire');
            this.addPort(this._staticXs[i], this.height - 2, ['t1', 't2', 't3'][i], 'wire', 'p');
        });
        // 底部右侧 电子脱扣接口（T1-3 的右边）
        this.addPort(this._etPortXs[0], this.height - 2, 'et1', 'wire', 'p');
        this.addPort(this._etPortXs[1], this.height - 2, 'et2', 'wire');
        // 顶部右侧辅助触点端口（左常闭 nc1/nc2、右常开 no1/no2）
        this._auxPorts.forEach(([id, x]) => {
            this.addPort(x, 2, id, 'wire');
        });
        // 右上 4 对控制接口（储能电机 / 合闸线圈 / 失压脱扣 / 分励）
        this._controlPorts.forEach(([id, y], i) => {
            this.addPort(this._portRightX, y, id, 'wire', i % 2 ? null : 'p');
        });
    }

    // ═══════════════════════════════════════════
    // 几何计算
    // ═══════════════════════════════════════════

    _recalcGeometry() {
        this._divX = 150; // 左控制面板宽度

        // 主回路机械结构（固定 y，内部组件不随高度变化）
        this._shaftY     = 120;
        this._shaftLen   = 135;
        this._shaftOff   = { off: 215, on: 250 }; // 主轴左端 x
        this._contactOffsets = [10, 60, 110];     // 主轴上的 3 对动触点偏移（间距 50）
        this._staticXs   = this._contactOffsets.map(o => this._shaftOff.on + o); // 260/310/360
        this._contactTopY = this._shaftY - 20;    // 100
        this._contactBotY = this._shaftY + 20;    // 140
        this._contactR   = 7;

        // 分闸弹簧：左端固定
        this._openSpringAnchorX = 160;

        // 脱扣轴：右端支点
        this._tripPivot = { x: 580, y: this._shaftY };
        this._tripLen   = 198; // 向左伸出

        // 储能弹簧：水平放置，固定端在右，储能时左端向左延伸（长度增加，振幅不变大）
        this._storeAnchorX = 540;
        this._storeY       = 41;
        this._storeLenOff  = 80;
        this._storeLenOn   = 180;
        this._storeAmp     = 12; // 振幅固定，不随长度增大

        // 失压脱扣器（杠杆绕三角支点）
        this._uvPivot    = { x: 500, y: 135 };
        this._uvLeverLeft  = -100; // 400
        this._uvLeverRight = 60;   // 560
        this._uvSpringAnchor = { x: 560, y: 210 };

        // 控制接口（右缘，重新分布以适配新高度，uv 对贴合失压磁轭高度）
        this._portRightX = 598;
        this._controlPorts = [
            ['m1', 28],  ['m2', 54],
            ['c1', 85], ['c2', 110],
            ['uv1', 165], ['uv2', 195],
            ['fla', 245], ['flb', 275],
        ];
        this._controlLabels = { m: '储能电机', c: '合闸线圈', uv: '失压', fl: '分励' };
        // 底部电子脱扣接口（T1-3 右侧）
        this._etPortXs = [450, 500];
        // 顶部辅助触点：左常开 no1/no2（L1 左侧）、右常闭 nc1/nc2（L3 右侧）
        this._auxPorts = [['no1', 180], ['no2', 220], ['nc1', 400], ['nc2', 440]];
    }

    // ═══════════════════════════════════════════
    // 参数初始化
    // ═══════════════════════════════════════════

    _initParameters(config) {
        this.label              = config.label || 'QF';
        this.function           = '船用发电机主开关';
        this.ratedCtrlVoltage   = config.ratedCtrlVoltage !== undefined ? config.ratedCtrlVoltage : 220;
        this._pickupRatio       = 0.85;
        this._dropoutRatio      = 0.70;
        this._coilResistance    = config.coilResistance !== undefined ? config.coilResistance : 200;
        this._coilR             = { m1: this._coilResistance, c1: this._coilResistance, uv1: this._coilResistance, et1: this._coilResistance };
        this._tripCoilR         = 50; // 分励线圈 fla↔flb
        // 电流控制：各线圈按自身电阻，额定电流的 85% 工作 / 70% 停止
        this._coilOhm = { m: this._coilResistance, c: this._coilResistance, uv: this._coilResistance, et: this._coilResistance, fl: this._tripCoilR };
        this._recalcCurrentThresholds();

        const s = (config.initState || 'off').toLowerCase();
        this._state = s === 'on' ? 'on' : 'off';

        this._animDur       = config.animDur !== undefined ? config.animDur : 0.15;
        this._animating     = false;
        this._animT         = 0;
        this._animMode      = 'none';
        this._animJustEnded = false;
        this._shaftLeft     = this._state === 'on' ? this._shaftOff.on : this._shaftOff.off;
        this._tripAng       = 0;
        this._tripPressed   = false; // 手动分闸按钮按住状态
        this._tripPushAng   = 5;     // 失压脱扣位角度（脱扣转动角度减半）
        this._tripButtonAng = 16;    // 手动分闸按钮机械推动角度（大于脱扣位，按下可见转动）

        // 储能状态
        this._chargeProg = (config.initCharge || 'off').toLowerCase() === 'on' ? 5 : 0;
        this._charged    = this._chargeProg >= 5;
        this._springLen  = this._storeLenOff + (this._chargeProg / 5) * (this._storeLenOn - this._storeLenOff);

        // 工作位（连接/试验/断开），合闸状态下不可切换
        const wp = (config.initWorkPos || 'connected').toLowerCase();
        this._workPos    = wp === 'test' ? 1 : (wp === 'disconnected' ? 2 : 0);
        this._detent     = this._workPos;
        this._clickAcc   = 0;
        this._dialAngle  = this._detent * 90;
        this._dialCur    = this._dialAngle;

        // 失压/手柄/杠杆
        this._uvOn      = false;
        this._handleRot = 0;
        this._handleDown = false;
        this._leverAng  = 6; // 未励磁：杠杆左端上翘（尖三角顶脱扣轴）

        // 线圈电流（直流，直接读取端口电压换算电流）
        this._coilPairs = { m: ['m1', 'm2'], c: ['c1', 'c2'], uv: ['uv1', 'uv2'], fl: ['fla', 'flb'], et: ['et1', 'et2'] };
        this._coilI = {};
        ['m', 'c', 'uv', 'fl', 'et'].forEach(k => {
            this._coilI[k] = 0;
        });

        this.opsCount = config.initOps || 0;
    }

    // 电流阈值：额定电流的 85% 工作 / 70% 停止（各线圈按自身电阻折算）
    _recalcCurrentThresholds() {
        this._pickupI  = {};
        this._dropoutI = {};
        ['m', 'c', 'uv', 'fl', 'et'].forEach(k => {
            const iNom = this.ratedCtrlVoltage / this._coilOhm[k];
            this._pickupI[k]  = iNom * this._pickupRatio;
            this._dropoutI[k] = iNom * this._dropoutRatio;
        });
    }

    // ═══════════════════════════════════════════
    // 主初始化
    // ═══════════════════════════════════════════

    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
    }

    _workPosName() { return ['连接', '试验', '断开'][this._workPos]; }

    // ═══════════════════════════════════════════
    // 静态部件
    // ═══════════════════════════════════════════

    _drawStaticParts() {
        this._drawFrame();
        this._drawNameplate();
        this._drawIndicatorBoxes();
        this._drawButtons();
        this._drawMainCircuitStatic();
        this._drawUVRStatic();
        this._drawControlTerminals();
        this._drawEtTerminals();
        this._drawAuxContactsStatic();
    }

    _drawFrame() {
        const f = this._frame = { x: 2, y: 2, w: this.width - 4, h: this.height - 4 };
        this._staticGroup.add(new Konva.Rect({
            x: f.x, y: f.y, width: f.w, height: f.h,
            fill: '#eef1f8', stroke: '#b0a698', strokeWidth: 1.5, cornerRadius: 6,
        }));
        // 左面板
        this._staticGroup.add(new Konva.Rect({
            x: 2, y: 2, width: this._divX - 4, height: f.h - 4,
            fill: '#dfe3ef', cornerRadius: [6, 0, 0, 6],
        }));
        // 分隔线
        this._staticGroup.add(new Konva.Line({
            points: [this._divX, 8, this._divX, this.height - 8],
            stroke: '#8898b0', strokeWidth: 1.5, dash: [5, 3],
        }));
        // 右面板浅底
        this._staticGroup.add(new Konva.Rect({
            x: this._divX, y: 2, width: this.width - this._divX - 2, height: f.h - 4,
            fill: 'rgba(255,255,255,0.40)',
        }));
    }

    _drawNameplate() {
        this._staticGroup.add(new Konva.Rect({
            x: 8, y: 5, width: this._divX - 16, height: 24, fill: '#3a4a5a', cornerRadius: 3,
        }));
        this._staticGroup.add(new Konva.Text({
            x: 8, y: 8, width: this._divX - 16, align: 'center',
            text: '船用发电机主开关', fontSize: 15, fontStyle: 'bold', fill: '#f0f4f8',
        }));
    }

    _drawIndicatorBoxes() {
        const mk = (x) => {
            this._staticGroup.add(new Konva.Rect({
                x, y: 38, width: 66, height: 36, fill: '#f7f8fa', stroke: '#9aa3ad', strokeWidth: 1, cornerRadius: 3,
            }));
        };
        mk(6);
        mk(78);
        // this._staticGroup.add(new Konva.Text({ x: 6, y: 39, width: 66, align: 'center', text: '合/分闸', fontSize: 11, fill: '#090000' }));
        this._staticGroup.add(new Konva.Text({ x: 78, y: 39, width: 66, align: 'center', text: '储能', fontSize: 11, fill: '#090000' }));
    }

    _drawButtons() {
        const mk = (x, label, color) => {
            this._staticGroup.add(new Konva.Rect({
                x, y: 90, width: 66, height: 26, fill: color, cornerRadius: 4, stroke: '#5a6470', strokeWidth: 1,
            }));
            this._staticGroup.add(new Konva.Text({
                x, y: 96, width: 66, align: 'center', text: label, fontSize: 13, fontStyle: 'bold', fill: '#fff',
            }));
        };
        mk(6, '手动合闸', '#1e7e34');
        mk(78, '手动分闸', '#b3392f');
    }

    _drawMainCircuitStatic() {
        const colors = ['#e03030', '#20a030', '#2050e0'];
        this._staticXs.forEach((x, i) => {
            const c = colors[i];
            // 进线 L（顶部端口 → 上静触点）
            this._staticGroup.add(new Konva.Line({
                points: [x, 8, x, this._contactTopY],
                stroke: c, strokeWidth: 2.5, lineCap: 'round',
            }));
            // 出线 T（下静触点 → 底部端口）
            this._staticGroup.add(new Konva.Line({
                points: [x, this._contactBotY, x, this.height - 8],
                stroke: c, strokeWidth: 2.5, lineCap: 'round',
            }));
            // 上下静触点半圆（凸起朝左，开口朝右）
            [this._contactTopY, this._contactBotY].forEach(cy => {
                this._staticGroup.add(new Konva.Arc({
                    x, y: cy, innerRadius: 0, outerRadius: this._contactR,
                    angle: 180, rotation: 90, fill: c, stroke: '#6a5a28', strokeWidth: 0.8,
                }));
            });
            // 端子标签
            this._staticGroup.add(new Konva.Text({
                x: x - 20, y: 4, text: ['L1', 'L2', 'L3'][i], fontSize: 13, fontStyle: 'bold', fill: c,
            }));
            this._staticGroup.add(new Konva.Text({
                x: x - 20, y: this.height - 18, text: ['T1', 'T2', 'T3'][i], fontSize: 13, fontStyle: 'bold', fill: c,
            }));
        });
    }

    _drawUVRStatic() {
        const pv = this._uvPivot;
        // 三角支点（杠杆下方支撑）
        this._staticGroup.add(new Konva.Line({
            points: [pv.x - 8, pv.y + 12, pv.x, pv.y + 2, pv.x + 8, pv.y + 12],
            closed: true, fill: '#7a7f8a', stroke: '#38404f', strokeWidth: 1,
        }));
        // 电磁铁磁轭（U 形，左右端对准动衔铁 404~460）
        const yx = 404, yy = 150, yw = 56, yh = 60;
        this._staticGroup.add(new Konva.Line({
            points: [yx, yy, yx, yy + yh, yx + yw, yy + yh, yx + yw, yy],
            closed: false, stroke: '#3c4050', strokeWidth: 8, lineCap: 'round', lineJoin: 'round',
        }));
        // 失压线圈绕组（居中于衔铁）
        const cx = 417, cy = 165, cw = 30, ch = 26;
        this._staticGroup.add(new Konva.Rect({
            x: cx, y: cy, width: cw, height: ch, fill: 'rgba(60,40,10,0.50)', stroke: '#705030', strokeWidth: 1.2, cornerRadius: 2,
        }));
        const turns = 6, gap = 2;
        const loopW = (cw - 4 - gap * (turns - 1)) / turns;
        for (let i = 0; i < turns; i++) {
            const x0 = cx + 2 + i * (loopW + gap);
            const x1 = x0 + loopW;
            this._staticGroup.add(new Konva.Line({
                points: [x0, cy + ch - 2, x0, cy + 2, x1, cy + 2, x1, cy + ch - 2],
                closed: true, stroke: i % 2 ? '#b8860b' : '#daa520', strokeWidth: 2, lineCap: 'round', lineJoin: 'round',
            }));
        }
        // 线圈引线 → 右缘失压接口
        const uv1 = this._controlPorts.find(p => p[0] === 'uv1')[1];
        const uv2 = this._controlPorts.find(p => p[0] === 'uv2')[1];
        this._staticGroup.add(new Konva.Line({
            points: [cx + cw / 2, cy, cx + cw / 2, cy - 12, 560, cy - 12, this._portRightX, uv1],
            stroke: '#6a5a28', strokeWidth: 1.5,
        }));
        this._staticGroup.add(new Konva.Line({
            points: [cx + cw / 2, cy + ch, cx + cw / 2, cy + ch + 12, 560, cy + ch + 12, this._portRightX, uv2],
            stroke: '#6a5a28', strokeWidth: 1.5,
        }));
        this._staticGroup.add(new Konva.Text({
            x: pv.x - 40, y: yy + yh + 2, text: '失压脱扣器', fontSize: 12, fill: '#555',fontStyle:'bold',
        }));
        // 分励脱扣线圈：失压线圈下方，同宽（cw）、高为失压线圈的 2/3，中心对准 fla/flb 接口中心，上下接线
        const fch = Math.round(ch * 2 / 3);
        const fla = this._controlPorts.find(p => p[0] === 'fla')[1];
        const flb = this._controlPorts.find(p => p[0] === 'flb')[1];
        const fcy = (fla + flb) / 2 - fch / 2;
        this._staticGroup.add(new Konva.Rect({
            x: cx, y: fcy, width: cw, height: fch, fill: 'rgba(60,40,10,0.50)', stroke: '#705030', strokeWidth: 1.2, cornerRadius: 2,
        }));
        const fTurns = 4, fGap = 2;
        const fLoopW = (cw - 4 - fGap * (fTurns - 1)) / fTurns;
        for (let i = 0; i < fTurns; i++) {
            const x0 = cx + 2 + i * (fLoopW + fGap);
            const x1 = x0 + fLoopW;
            this._staticGroup.add(new Konva.Line({
                points: [x0, fcy + fch - 2, x0, fcy + 2, x1, fcy + 2, x1, fcy + fch - 2],
                closed: true, stroke: i % 2 ? '#b8860b' : '#daa520', strokeWidth: 2, lineCap: 'round', lineJoin: 'round',
            }));
        }
        this._staticGroup.add(new Konva.Line({
            points: [cx + cw / 2, fcy, this._portRightX, fla],
            stroke: '#6a5a28', strokeWidth: 1.5,
        }));
        this._staticGroup.add(new Konva.Line({
            points: [cx + cw / 2, fcy + fch, this._portRightX, flb],
            stroke: '#6a5a28', strokeWidth: 1.5,
        }));
    }

    _drawControlTerminals() {
        this._controlPorts.forEach(([id, y]) => {
            this._staticGroup.add(new Konva.Circle({
                x: this._portRightX, y, radius: 4.5, fill: '#5a5f68', stroke: '#2c3038', strokeWidth: 1,
            }));
        });
        // 储能电机：右侧空心圆环，两端引线到 m1/m2 接口
        const m1 = this._controlPorts.find(p => p[0] === 'm1')[1];
        const m2 = this._controlPorts.find(p => p[0] === 'm2')[1];
        const mcx = this._storeAnchorX + 9, mcy = (m1 + m2) / 2, mr = 9;
        this._staticGroup.add(new Konva.Circle({
            x: mcx, y: mcy, radius: mr, fill: 'rgba(0,0,0,0)', stroke: '#3a4a5a', strokeWidth: 2,
        }));
        // 电机内圆
        this._staticGroup.add(new Konva.Circle({
            x: mcx, y: mcy, radius: mr - 4, fill: 'rgba(0,0,0,0)', stroke: '#3a4a5a', strokeWidth: 1.5,
        }));
        this._staticGroup.add(new Konva.Line({
            points: [mcx, mcy - mr, this._portRightX, m1],
            stroke: '#6a7a8a', strokeWidth: 1.5,
        }));
        this._staticGroup.add(new Konva.Line({
            points: [mcx, mcy + mr, this._portRightX, m2],
            stroke: '#6a7a8a', strokeWidth: 1.5,
        }));
        // 合闸线圈：储能弹簧下方的矩形 + 内部波浪线，左右端引线到 c1/c2 接口
        const c1y = this._controlPorts.find(p => p[0] === 'c1')[1];
        const c2y = this._controlPorts.find(p => p[0] === 'c2')[1];
        const ccy = 70;
        const crx = 479, crw = 42, crh = 18, cry = ccy - crh / 2;
        this._staticGroup.add(new Konva.Rect({
            x: crx, y: cry, width: crw, height: crh,
            fill: '#f4f6f8', stroke: '#5a6470', strokeWidth: 1.5, cornerRadius: 2,
        }));
        this._staticGroup.add(new Konva.Line({
            points: this._zigzagH(crx + 5, crx + crw - 5, ccy, 5),
            stroke: '#a07030', strokeWidth: 2, lineCap: 'round', lineJoin: 'round',
        }));
        // c2 引线：左端先向下到拐点，再斜线与 c1 引线平行接到 c2
        const k1 = (c1y - ccy) / (this._portRightX - (crx + crw));
        const c2KneeY = c2y - k1 * (this._portRightX - crx);
        this._staticGroup.add(new Konva.Line({
            points: [crx, ccy, crx, c2KneeY, this._portRightX, c2y],
            stroke: '#6a7a8a', strokeWidth: 1.5,
        }));
        this._staticGroup.add(new Konva.Line({
            points: [crx + crw, ccy, this._portRightX, c1y],
            stroke: '#6a7a8a', strokeWidth: 1.5,
        }));
        Object.keys(this._controlLabels).forEach(k => {
            const pair = this._controlPorts.find(p => p[0].startsWith(k));
            this._staticGroup.add(new Konva.Text({
                x: this._portRightX - 62, y: pair[1] - 11, width: 54, align: 'right',
                text: this._controlLabels[k], fontSize: 12, fill: '#555',fontStyle:"bold"
            }));
        });
    }

    /** 底部右侧电子脱扣接口（T1-3 右边） */
    _drawEtTerminals() {
        const y = this.height - 2;
        this._etPortXs.forEach((x, i) => {
            this._staticGroup.add(new Konva.Circle({
                x, y, radius: 4.5, fill: '#5a5f68', stroke: '#2c3038', strokeWidth: 1,
            }));
            this._staticGroup.add(new Konva.Text({
                x: x - 7, y: this.height - 16, text: i ? 'ET2' : 'ET1', fontSize: 9, fill: '#5a5f68',
            }));
        });
    }

    /** 辅助触点静态部分（顶部 L 右侧）：左常闭 nc1/nc2、右常开 no1/no2，端口引线 + 静触点 + 内折引线 + 标签 */
    _drawAuxContactsStatic() {
        const y = 22;
        const mk = (x1, x2, label) => {
            [x1, x2].forEach(x => {
                this._staticGroup.add(new Konva.Line({
                    points: [x, 2, x, y], stroke: '#7a6a5a', strokeWidth: 1.5, lineCap: 'round',
                }));
                this._staticGroup.add(new Konva.Circle({
                    x, y, radius: 4, fill: '#c8a020', stroke: '#6a5a28', strokeWidth: 1,
                }));
            });
            // 左端引线向下后向右一点，右端引线向下后向左一点，中间引出动触臂
            this._staticGroup.add(new Konva.Line({
                points: [x1, y, x1, y + 8, x1 + 10, y + 8], stroke: '#7a6a5a', strokeWidth: 1.5, lineCap: 'round', lineJoin: 'round',
            }));
            this._staticGroup.add(new Konva.Line({
                points: [x2, y, x2, y + 8, x2 - 10, y + 8], stroke: '#7a6a5a', strokeWidth: 1.5, lineCap: 'round', lineJoin: 'round',
            }));
            this._staticGroup.add(new Konva.Text({
                x: x1 - 20, y: -12, width: 80, align: 'center', text: label, fontSize: 12, fontStyle: 'bold', fill: '#f40404',
            }));
        };
        mk(400, 440, '常闭');
        mk(180, 220, '常开');
    }

    // ═══════════════════════════════════════════
    // 动态节点
    // ═══════════════════════════════════════════

    _createDynamicNodes() {
        this._createShaft();
        this._createOpenSpring();
        this._createTripShaft();
        this._createStoreSpring();
        this._createUVLever();
        this._createIndicators();
        this._createHandle();
        this._createDial();
        this._createAuxContacts();
    }

    _zigzagH(x0, x1, y, fixedAmp) {
        const pts = [x0, y];
        const turns = 6;
        const dx = x1 - x0;
        const amp = fixedAmp !== undefined ? fixedAmp : Math.max(2.5, dx * 0.14);
        for (let i = 1; i < turns * 2; i++) {
            const t = i / (turns * 2);
            pts.push(x0 + t * dx, y + (i % 2 === 0 ? -amp : amp));
        }
        pts.push(x1, y);
        return pts;
    }

    _zigzagV(x, y0, y1) {
        const pts = [x, y0];
        const turns = 5;
        const dy = y1 - y0;
        const amp = Math.max(2, dy * 0.12);
        for (let i = 1; i < turns * 2; i++) {
            const t = i / (turns * 2);
            pts.push(x + (i % 2 === 0 ? amp : -amp), y0 + t * dy);
        }
        pts.push(x, y1);
        return pts;
    }

    /** 辅助触点动态触桥：左端为转轴，右端为触头，闭合水平、断开右端上翘 */
    _mkAuxBridge(x1, x2, y) {
        const g = new Konva.Group({ x: x1, y, rotation: 0, listening: false });
        g.add(new Konva.Line({
            points: [0, 0, x2 - x1, 0], stroke: '#2f3542', strokeWidth: 4, lineCap: 'round',
        }));
        g.add(new Konva.Circle({
            x: x2 - x1, y: 0, radius: 4.5, fill: '#f0c860', stroke: '#6a5a28', strokeWidth: 1,
        }));
        return g;
    }

    _createAuxContacts() {
        this._ncBridge = this._mkAuxBridge(410, 430, 30); // 常闭触桥（L3 右侧，中间横跨 410→430）
        this._noBridge = this._mkAuxBridge(190, 210, 30); // 常开触桥（L1 左侧，中间横跨 190→210）
        this._dynamicGroup.add(this._ncBridge);
        this._dynamicGroup.add(this._noBridge);
    }

    /** 主轴（可平移）+ 3 对动触点 + 右端朝上钩子 */
    _createShaft() {
        const g = new Konva.Group({
            x: this._shaftLeft, y: this._shaftY, offset: { x: 0, y: this._shaftY }, listening: false,
        });
        g.add(new Konva.Rect({
            x: 0, y: this._shaftY - 3, width: this._shaftLen, height: 6,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint: { x: 0, y: 6 },
            fillLinearGradientColorStops: [0, '#60a0d0', 0.5, '#90c8f0', 1, '#5090c0'],
            stroke: '#3078a0', strokeWidth: 0.8, cornerRadius: 2,
        }));
        this._movingContacts = this._contactOffsets.map((off, i) => {
            const gg = new Konva.Group({ x: off });
            gg.add(new Konva.Line({
                points: [0, this._contactTopY, 0, this._contactBotY],
                stroke: ['#e03030', '#20a030', '#2050e0'][i], strokeWidth: 4, lineCap: 'round',
            }));
            const mkArc = (y) => new Konva.Arc({
                x: 0, y, innerRadius: 0, outerRadius: this._contactR,
                angle: 180, rotation: -90, // 动触点凸起朝右
                fill: this._state === 'on' ? '#f0c860' : '#a09080',
                stroke: '#7a6028', strokeWidth: 0.8,
            });
            const a1 = mkArc(this._contactTopY);
            const a2 = mkArc(this._contactBotY);
            gg.add(a1);
            gg.add(a2);
            g.add(gg);
            return { gg, a1, a2 };
        });
        // 主轴右端朝上钩子（向上、向左）
        g.add(new Konva.Line({
            points: [this._shaftLen, this._shaftY, this._shaftLen, this._shaftY - 9, this._shaftLen - 5, this._shaftY - 9],
            stroke: '#38404f', strokeWidth: 3, lineCap: 'round', lineJoin: 'round',
        }));
        this._shaftGroup = g;
        this._dynamicGroup.add(g);
    }

    _createOpenSpring() {
        this._openSpringLine = new Konva.Line({
            points: this._zigzagH(this._openSpringAnchorX, this._shaftLeft, this._shaftY),
            stroke: '#6090a8', strokeWidth: 3, lineCap: 'round', lineJoin: 'round', listening: false,
        });
        this._dynamicGroup.add(this._openSpringLine);
        // 左端固定点
        this._staticGroup.add(new Konva.Circle({
            x: this._openSpringAnchorX, y: this._shaftY, radius: 4,
            fill: '#3a4a5a', stroke: '#232b38', strokeWidth: 1,
        }));
        // 分闸弹簧标注
        this._staticGroup.add(new Konva.Text({
            x: 138, y: 136, width: 96, align: 'center', text: '分闸弹簧', fontSize: 15, fontStyle: 'bold', fill: '#333',
        }));
    }

    /** 脱扣轴（绕右端支点旋转，左端向下钩子） */
    _createTripShaft() {
        const pv = this._tripPivot;
        const g = new Konva.Group({ x: pv.x, y: pv.y, rotation: this._tripAng, listening: false });
        g.add(new Konva.Line({
            points: [0, 0, -this._tripLen, 0], stroke: '#38404f', strokeWidth: 6, lineCap: 'round',
        }));
        g.add(new Konva.Circle({ x: 0, y: 0, radius: 6, fill: '#8a8f98', stroke: '#38404f', strokeWidth: 1 }));
        // 左端钩子（向下、向右）
        g.add(new Konva.Line({
            points: [-this._tripLen, 0, -this._tripLen, 8, -this._tripLen + 6, 8],
            stroke: '#38404f', strokeWidth: 4, lineCap: 'round', lineJoin: 'round',
        }));
        this._tripGroup = g;
        this._dynamicGroup.add(g);
        // 脱扣轴标注
        this._staticGroup.add(new Konva.Text({
            x: 368, y: 84, width: 100, align: 'center', text: '脱扣轴', fontSize: 15, fontStyle: 'bold', fill: '#333',
        }));
    }

    /** 储能弹簧（水平，固定端右，储能时左端向左延伸，储能后虚线连主轴中心） */
    _createStoreSpring() {
        const left = this._storeAnchorX - this._springLen;
        this._storeSpringLine = new Konva.Line({
            points: this._zigzagH(left, this._storeAnchorX, this._storeY, this._storeAmp),
            stroke: '#d06030', strokeWidth: 3, lineCap: 'round', lineJoin: 'round', listening: false,
        });
        this._chargeDash = new Konva.Line({
            points: [], stroke: '#d06030', strokeWidth: 1.5, dash: [5, 4], listening: false, visible: false,
        });
        this._storeTip = new Konva.Circle({
            x: this._storeAnchorX - this._springLen, y: this._storeY, radius: 4.5,
            fill: '#1a1a1a', stroke: '#333', strokeWidth: 1, listening: false,
        });
        this._dynamicGroup.add(this._storeSpringLine);
        this._dynamicGroup.add(this._chargeDash);
        this._dynamicGroup.add(this._storeTip);
    }

    /** 失压脱扣器：杠杆（绕三角支点）+ 左端尖三角 + 衔铁 + 右端复位弹簧 */
    _createUVLever() {
        const pv = this._uvPivot;
        const g = new Konva.Group({ x: pv.x, y: pv.y, rotation: this._leverAng, listening: false });
        g.add(new Konva.Line({
            points: [this._uvLeverLeft, 0, this._uvLeverRight, 0],
            stroke: '#2f3542', strokeWidth: 5, lineCap: 'round',
        }));
        // 左端尖三角（向上顶脱扣轴）
        g.add(new Konva.Line({
            points: [this._uvLeverLeft, 0, this._uvLeverLeft + 8, -16, this._uvLeverLeft + 16, 0],
            closed: true, fill: '#d0a24a', stroke: '#7a6028', strokeWidth: 1,
        }));
        // 动衔铁（杠杆左端下方，紧贴杠杆）
        g.add(new Konva.Rect({
            x: this._uvLeverLeft + 4, y: 0, width: 56, height: 10,
            fill: '#4a5060', stroke: '#282c3a', strokeWidth: 1,
        }));
        this._uvLeverGroup = g;
        this._dynamicGroup.add(g);

        this._uvSpring = new Konva.Line({
            points: this._zigzagV(this._uvSpringAnchor.x, this._uvPivot.y, this._uvSpringAnchor.y),
            stroke: '#6090a8', strokeWidth: 2.5, lineCap: 'round', lineJoin: 'round', listening: false,
        });
        this._dynamicGroup.add(this._uvSpring);
        // 下端固定点
        this._staticGroup.add(new Konva.Circle({
            x: this._uvSpringAnchor.x, y: this._uvSpringAnchor.y, radius: 4,
            fill: '#3a4a5a', stroke: '#232b38', strokeWidth: 1,
        }));
    }

    _createIndicators() {
        // 合/分闸指示
        this._onOffText = new Konva.Text({
            x: 6, y: 47, width: 66, align: 'center', fontSize: 15, fontStyle: 'bold',
            text: this._state === 'on' ? '合闸 ON' : '分闸 OFF',
            fill: this._state === 'on' ? '#1b8a1b' : '#c0392b', listening: false,
        });
        // 储能指示（弹簧图标恒显，未储能时叠加红色斜线；位于合/分闸指示右侧盒内）
        this._storeIcon = new Konva.Line({
            points: this._zigzagH(88, 134, 56),
            stroke: '#c8a020', strokeWidth: 2.5, lineCap: 'round', lineJoin: 'round', listening: false,
            visible: true,
        });
        this._storeSlash = new Konva.Line({
            points: [84, 72, 138, 44], stroke: '#c0392b', strokeWidth: 2.5,
            lineCap: 'round', listening: false, visible: !this._charged,
        });
        this._dynamicGroup.add(this._onOffText);
        this._dynamicGroup.add(this._storeIcon);
        this._dynamicGroup.add(this._storeSlash);
    }

    /** 储能手柄（默认垂直向上，按下转 180° 至向下，松手还原） */
    _createHandle() {
        this._staticGroup.add(new Konva.Text({ x: 35, y: 207, width: 80, align: 'center', text: '储能手柄', fontSize: 12, fill: '#666' }));
        const g = new Konva.Group({ x: 75, y: 195, rotation: this._handleRot, listening: false });
        g.add(new Konva.Line({ points: [0, 0, 0, -30], stroke: '#8a4a20', strokeWidth: 7, lineCap: 'round' }));
        g.add(new Konva.Circle({ x: 0, y: 0, radius: 7, fill: '#b06a2e', stroke: '#7a4a1c', strokeWidth: 1.5 }));
        this._handleGroup = g;
        this._dynamicGroup.add(g);
    }

    /** 工作位圆盘（点右半顺时针 / 左半逆时针，每 3 次切换一档） */
    _createDial() {
        // 固定刻度盘面
        this._staticGroup.add(new Konva.Circle({ x: 75, y: 252, radius: 24, fill: '#e8eaee', stroke: '#7a7f8a', strokeWidth: 2 }));
        for (let i = 0; i < 4; i++) {
            const a = i * 90 * Math.PI / 180;
            this._staticGroup.add(new Konva.Line({
                points: [75 + Math.cos(a) * 20, 252 + Math.sin(a) * 20, 75 + Math.cos(a) * 24, 252 + Math.sin(a) * 24],
                stroke: '#7a7f8a', strokeWidth: 2, lineCap: 'round',
            }));
        }
        // 旋转指针
        const g = new Konva.Group({ x: 75, y: 252, rotation: this._dialCur, listening: false });
        g.add(new Konva.Line({ points: [0, 0, 0, -16], stroke: '#38404f', strokeWidth: 3.5, lineCap: 'round' }));
        g.add(new Konva.Circle({ x: 0, y: 0, radius: 4, fill: '#38404f' }));
        this._dialGroup = g;
        this._dynamicGroup.add(g);

        this._workPosText = new Konva.Text({
            x: 42, y: 282, width: 66, align: 'center', fontSize: 11, fill: '#333',
            text: this._workPosName(), listening: false,
        });
        this._dynamicGroup.add(this._workPosText);
    }

    // ═══════════════════════════════════════════
    // 交互
    // ═══════════════════════════════════════════

    _bindInteraction() {
        const hover = (h) => {
            h.on('mouseenter', () => { document.body.style.cursor = 'pointer'; });
            h.on('mouseleave', () => { document.body.style.cursor = 'default'; });
        };

        // 储能手柄（按下 → 转动 → 松手还原）
        const handleHit = new Konva.Circle({ x: 75, y: 195, radius: 24, fill: 'transparent' });
        const release = () => {
            if (!this._handleDown) return;
            this._handleDown = false;
        };
        handleHit.on('mousedown touchstart', (e) => {
            e.cancelBubble = true;
            this._handleDown = true;
            if (this._chargeProg < 5) this._chargeProg += 1;
            this._charged = this._chargeProg >= 5;
        });
        handleHit.on('mouseup touchend', release);
        window.addEventListener('mouseup', release);
        window.addEventListener('touchend', release);
        hover(handleHit);
        this._interactGroup.add(handleHit);

        // 工作位圆盘（合闸时不可操作）
        const dialHit = new Konva.Circle({ x: 75, y: 252, radius: 28, fill: 'transparent' });
        dialHit.on('click tap', (e) => {
            e.cancelBubble = true;
            if (this._state === 'on') return;
            const stage = this.group.getStage();
            if (!stage) return;
            const pointer = stage.getPointerPosition();
            if (!pointer) return;
            const tr = this.group.getTransform().copy();
            tr.invert();
            const local = tr.point(pointer);
            this._dialTurn(local.x >= 75 ? 1 : -1);
        });
        hover(dialHit);
        this._interactGroup.add(dialHit);

        // 手动合闸 / 分闸按钮
        const closeHit = new Konva.Rect({ x: 6, y: 90, width: 66, height: 26, fill: 'transparent' });
        closeHit.on('click tap', (e) => { e.cancelBubble = true; this.tryClose(); });
        const openHit = new Konva.Rect({ x: 78, y: 90, width: 66, height: 26, fill: 'transparent' });
        // 手动分闸：按住 → 脱扣轴转动；松开 → 复位；合闸状态按住则机械脱扣分闸
        const openRelease = () => { this._tripPressed = false; };
        openHit.on('mousedown touchstart', (e) => {
            e.cancelBubble = true;
            this._tripPressed = true;
            if (!this._animating && this._state === 'on') this.tryTrip();
        });
        openHit.on('mouseup touchend', openRelease);
        window.addEventListener('mouseup', openRelease);
        window.addEventListener('touchend', openRelease);
        hover(closeHit);
        hover(openHit);
        this._interactGroup.add(closeHit);
        this._interactGroup.add(openHit);
    }

    _dialTurn(dir) {
        if (this._state === 'on') return; // 合闸时工作位不可操作
        const nextDet = this._detent + dir;
        if (nextDet < 0 || nextDet > 2) { this._clickAcc = 0; this._dialAngle = this._detent * 90; return; }
        this._clickAcc += dir;
        this._dialAngle += dir * 30;
        if (Math.abs(this._clickAcc) >= 3) {
            this._clickAcc = 0;
            this._detent = nextDet;
            this._workPos = this._detent;
        }
        this._dialAngle = this._detent * 90;
    }

    // ═══════════════════════════════════════════
    // 状态控制
    // ═══════════════════════════════════════════

    tryClose() {
        if (this._animating || this._state !== 'off') return;
        if (!this._charged) return;   // 未储能不能合闸
        // 只要储能已满即释放能量；失压无电时脱扣轴处于脱扣位，动画结束后分闸弹簧拉回（合闸失败）
        this._startAnim('close');
    }

    tryTrip() {
        if (this._animating || this._state !== 'on') return;
        this._startAnim('open');
    }

    _startAnim(mode) {
        this._animMode = mode;
        this._animT = 0;
        this._animating = true;
        if (mode === 'close') {
            this._chargeProg = 0;   // 释放储能
            this._charged = false;
        }
        this.opsCount++;
    }

    // ═══════════════════════════════════════════
    // 仿真主循环
    // ═══════════════════════════════════════════

    tick(dt) {
        this._sense(dt);
        this._logic(dt);
        this._animate(dt);
        this._updateDynamic();
        if (this.sys && typeof this.sys.requestRedraw === 'function') this.sys.requestRedraw();
    }

    _sense() {
        const solver = this.sys && this.sys.voltageSolver;
        if (!solver) return;
        ['m', 'c', 'uv', 'fl', 'et'].forEach(k => {
            const [a, b] = this._coilPairs[k];
            const v = this.sys.getVoltageBetween(`${this.id}_wire_${a}`, `${this.id}_wire_${b}`);
            if (v !== undefined && isFinite(v)) this._coilI[k] = v / this._coilOhm[k];
        });
        // 失压线圈吸合/释放滞回（直流电流）
        if (!this._uvOn && this._coilI.uv >= this._pickupI.uv) this._uvOn = true;
        else if (this._uvOn && this._coilI.uv < this._dropoutI.uv) this._uvOn = false;
    }

    _logic(dt) {
        // 合闸状态下：失压失电 / 分励通电 / 电子脱扣通电 → 跳闸
        if (this._state === 'on') {
            if (!this._uvOn) { this.tryTrip(); return; }
            if (this._coilI.fl >= this._pickupI.fl) { this.tryTrip(); return; }
            if (this._coilI.et >= this._pickupI.et) { this.tryTrip(); return; }
        }
        // 储能电机通电 → 自动储能
        if (this._coilI.m >= this._pickupI.m && this._chargeProg < 5) {
            this._chargeProg = Math.min(5, this._chargeProg + dt * 2.5);
            this._charged = this._chargeProg >= 5;
        }
        // 合闸线圈通电 → 等效手动合闸
        if (this._coilI.c >= this._pickupI.c) this.tryClose();
    }

    _animate(dt) {
        // 储能弹簧长度跟随储能进度
        const targetLen = this._storeLenOff + (this._chargeProg / 5) * (this._storeLenOn - this._storeLenOff);
        this._springLen += (targetLen - this._springLen) * Math.min(1, dt * 8);

        // 手柄旋转（按下 → 向下，松手 → 向上）
        const hTarget = this._handleDown ? 180 : 0;
        this._handleRot += (hTarget - this._handleRot) * Math.min(1, dt * 10);

        // 工作位圆盘
        this._dialCur += (this._dialAngle - this._dialCur) * Math.min(1, dt * 10);

        // 失压杠杆（励磁 → 左端下压，失磁 → 左端上顶）
        const lTarget = this._uvOn ? -4 : 6;
        this._leverAng += (lTarget - this._leverAng) * Math.min(1, dt * 8);

        // 合/分闸机构动画
        if (this._animating) {
            this._animT += dt / this._animDur;
            const done = this._animT >= 1;
            if (done) this._animT = 1;
            const ease = 0.5 - 0.5 * Math.cos(this._animT * Math.PI);
            if (this._animMode === 'close') {
                // 能量释放：主轴右移、分闸弹簧拉伸，脱扣轴不动
                this._shaftLeft = this._shaftOff.off + (this._shaftOff.on - this._shaftOff.off) * ease;
                if (done) {
                    this._animating = false; this._animJustEnded = true;
                    if (this._uvOn) {
                        this._state = 'on'; // 脱扣轴正常位，合闸保持
                    } else {
                        // 失压无电：脱扣轴处于脱扣位，分闸弹簧拉回，合闸失败（脱扣轴仍不动）
                        this._state = 'off';
                        this._animMode = 'reject';
                        this._animT = 0;
                        this._animating = true;
                    }
                }
            } else if (this._animMode === 'open') {
                // 主动分闸：脱扣轴转到脱扣位并停住（不回弹，避免闪烁）
                this._shaftLeft = this._shaftOff.on + (this._shaftOff.off - this._shaftOff.on) * ease;
                this._tripAng = this._tripPushAng * ease;
                if (done) {
                    this._state = 'off';
                    this._animating = false; this._animJustEnded = true;
                    // 脱扣轴保持在脱扣位，稳态逻辑 tBase 接管
                }
            } else if (this._animMode === 'reject') {
                // 合闸失败：主轴被分闸弹簧拉回，脱扣轴保持脱扣位不动
                this._shaftLeft = this._shaftOff.on + (this._shaftOff.off - this._shaftOff.on) * ease;
                if (done) {
                    this._state = 'off';
                    this._animating = false; this._animJustEnded = true;
                }
            }
        } else {
            // 脱扣轴稳态：失压失磁保持脱扣位；手动分闸按住时机械推动到更大的脱扣角，松开复位
            const tBase = this._uvOn ? 0 : this._tripPushAng;
            const tTarget = this._tripPressed ? this._tripButtonAng : tBase;
            this._tripAng += (tTarget - this._tripAng) * Math.min(1, dt * 16);
        }
    }

    _updateDynamic() {
        const closed = this._state === 'on';

        // 主轴 + 动触点（合闸时绕左端下倾 2°，形成勾住效果）
        this._shaftGroup.x(this._shaftLeft);
        this._shaftGroup.rotation(closed ? 0.5 : 0);
        this._movingContacts.forEach(mc => {
            const f = closed ? '#f0c860' : '#a09080';
            mc.a1.fill(f);
            mc.a2.fill(f);
        });

        // 分闸弹簧
        this._openSpringLine.points(this._zigzagH(this._openSpringAnchorX, this._shaftLeft, this._shaftY));

        // 脱扣轴（合闸时左端下倾 2°，与主轴勾住）
        this._tripGroup.rotation(this._tripAng + (closed ? 2 : 0));

        // 辅助触点：常闭（分闸闭合/合闸断开，断开时向下转动）、常开（分闸断开/合闸闭合）
        this._ncBridge.rotation(closed ? 40 : 0);
        this._noBridge.rotation(closed ? 0 : -40);

        // 储能弹簧（水平，储能时左端向左增长、振幅固定）+ 虚线 + 左端黑点
        const storeLeft = this._storeAnchorX - this._springLen;
        this._storeSpringLine.points(this._zigzagH(storeLeft, this._storeAnchorX, this._storeY, this._storeAmp));
        this._storeTip.position({ x: storeLeft, y: this._storeY });
        const ccx = this._shaftLeft + this._shaftLen / 2;
        this._chargeDash.points([storeLeft, this._storeY, ccx, this._shaftY]);
        this._chargeDash.visible(this._charged);

        // 失压杠杆 + 右端复位弹簧
        this._uvLeverGroup.rotation(this._leverAng);
        const rad = this._leverAng * Math.PI / 180;
        const rEndY = this._uvPivot.y + this._uvLeverRight * Math.sin(rad);
        this._uvSpring.points(this._zigzagV(this._uvSpringAnchor.x, rEndY, this._uvSpringAnchor.y));

        // 指示牌
        this._onOffText.text(closed ? '合闸 ON' : '分闸 OFF');
        this._onOffText.fill(closed ? '#1b8a1b' : '#c0392b');
        const charged = this._chargeProg >= 5;
        this._storeIcon.visible(true);          // 弹簧图标恒显
        this._storeSlash.visible(!charged);     // 未储能时叠加斜线

        // 工作位圆盘（合闸时灰化）
        this._dialGroup.rotation(this._dialCur);
        this._dialGroup.opacity(closed ? 0.45 : 1);
        this._workPosText.text(this._workPosName());

        // 手柄
        this._handleGroup.rotation(this._handleRot);
    }

    // ═══════════════════════════════════════════
    // 公开 API
    // ═══════════════════════════════════════════

    getState()    { return this._state; }
    isClosed()    { return this._state === 'on'; }
    isCharged()   { return this._charged; }
    getWorkPos()  { return this._workPos; }

    update(state) {
        const s = String(state).toLowerCase();
        if (s === 'on' || s === '1') this.tryClose();
        if (s === 'off' || s === '0') this.tryTrip();
        if (s === 'trip') this.tryTrip();
    }

    getConfigFields() {
        return [
            { label: '位号/名称',          key: 'label',              type: 'text' },
            { label: '控制回路额定电压 (V)', key: 'ratedCtrlVoltage',   type: 'number' },
            { label: '初始状态 on/off',    key: 'initState',          type: 'text' },
            { label: '初始储能 on/off',    key: 'initCharge',         type: 'text' },
            { label: '初始工作位 connected/test/disconnected', key: 'initWorkPos', type: 'text' },
            { label: '动作时间 (s)',        key: 'animDur',            type: 'number' },
            { label: '控制线圈电阻 (Ω)',    key: 'coilResistance',     type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label            !== undefined) this.label            = cfg.label;
        if (cfg.ratedCtrlVoltage !== undefined) { this.ratedCtrlVoltage = parseFloat(cfg.ratedCtrlVoltage); this._recalcCurrentThresholds(); }
        if (cfg.animDur          !== undefined) this._animDur         = parseFloat(cfg.animDur);
        if (cfg.coilResistance   !== undefined) { this._coilResistance = parseFloat(cfg.coilResistance); this._coilR = { m1: this._coilResistance, c1: this._coilResistance, uv1: this._coilResistance, et1: this._coilResistance }; this._coilOhm = { m: this._coilResistance, c: this._coilResistance, uv: this._coilResistance, et: this._coilResistance, fl: this._tripCoilR }; this._recalcCurrentThresholds(); }
        if (cfg.initState !== undefined) {
            const want = String(cfg.initState).toLowerCase();
            if (want === 'on' && this._state !== 'on') this.tryClose();
            if (want === 'off' && this._state !== 'off') this.tryTrip();
        }
        if (cfg.initCharge !== undefined) {
            const want = String(cfg.initCharge).toLowerCase();
            if (want === 'on' && !this._charged) { this._chargeProg = 5; this._charged = true; }
            if (want === 'off' && this._charged) { this._chargeProg = 0; this._charged = false; }
        }
        if (cfg.initWorkPos !== undefined) {
            const wp = String(cfg.initWorkPos).toLowerCase();
            this._workPos = wp === 'test' ? 1 : (wp === 'disconnected' ? 2 : 0);
            this._detent = this._workPos;
            this._dialAngle = this._detent * 90;
            this._dialCur = this._dialAngle;
        }
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
