import { BaseComponent } from './BaseComponent.js';

/**
 * VacuumCircuitBreaker 真空断路器
 *
 * 参照船用发电机主开关（MarineMainsSwitch）改造：
 *  - 左侧操作界面（150px 宽）完全一致：名牌、合/分闸指示、储能指示、
 *    手动合闸/分闸按钮、储能手柄、工作位刻度盘。
 *  - 右侧原理界面宽度减半（450 → 225），只画主触头系统：
 *    中间一个真空泡（内含三相主触头），合闸时动触点上移（与上静触头接触），
 *    分闸时动触点下移（分离）。
 *  - 删除常开/常闭辅助触点与电子脱扣器（ET）端口，相关内部机构与引线一律不画。
 *  - 原理界面右侧引出储能 / 合闸线圈 / 失压 / 分励四组控制接口。
 *
 * 端口布局（375×300）：
 *   上方 3 口：L1 / L2 / L3（主回路进线）
 *   下方 3 口：T1 / T2 / T3（主回路出线）
 *   右侧 8 口：m1/m2（储能电机）、c1/c2（合闸线圈）、uv1/uv2（失压）、fla/flb（分励）
 *   电子脱扣器 ET 与辅助触点 no1/no2/nc1/nc2：已删除
 *
 * 复用求解器 ACB 类型（type='ACB'，special='MainsSwitch'，合闸注入 0.0001Ω，分闸注入 10e9Ω）。
 * 逻辑保留：储能（手柄 / 储能接口）、合闸线圈、失压保护、分励跳闸、手动按钮、工作位切换。
 */
export class VacuumCircuitBreaker extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(300, config.width  || 320);
        this.height = Math.max(220, config.height || 255);

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
            genId:            this.genId,
            revPowerKw:       this.revPowerKw,
            revTime:          this.revTime,
        };

        // 主回路端口（顶部 L1/L2/L3，底部 T1/T2/T3）
        ['l1', 'l2', 'l3'].forEach((nm, i) => {
            this.addPort(this._staticXs[i], 2, nm, 'wire');
            this.addPort(this._staticXs[i], this.height - 2, ['t1', 't2', 't3'][i], 'wire', 'p');
        });
        // 右侧 4 对控制接口（储能电机 / 合闸线圈 / 失压脱扣 / 分励）
        this._controlPorts.forEach(([id, y], i) => {
            this.addPort(this._portRightX, y, id, 'wire', i % 2 ? null : 'p');
        });
    }

    // ═══════════════════════════════════════════
    // 几何计算
    // ═══════════════════════════════════════════

    _recalcGeometry() {
        this._divX = 150; // 左控制面板宽度
        const w = this.width, h = this.height;

        // 右侧真空泡：去掉左侧空隙，紧贴分隔线（高度减半）
        this._bottle = {
            x: this._divX + 6,   // 去掉真空泡左边空隙
            y: 46,
            w: 104,
            h: 130,               // 高度较之前减半
        };
        // 三相主触头水平并排（进线 L 在上、出线 T 在下）
        const gap = 34;
        const cx = this._bottle.x + this._bottle.w / 2;
        this._staticXs = [cx - gap, cx, cx + gap]; // 三相列 x
        // 上静触头（三个水平圆面，正视成横线）y —— 接 L 进线
        this._contactTopY = this._bottle.y + 35;
        // 动触头圆面下行的基准点 y（出线接触位置，接 T）
        this._contactBotY = this._bottle.y + this._bottle.h - 30;
        this._contactR = 6;
        // 圆面尺寸（横向椭圆，正视成横线）
        this._discRX = 16;
        this._discRY = 5.5;

        // 动触头：三个水平圆面，装在垂直导电杆顶端，随杆上下移动
        //   合闸位（上移，贴合上静触头） vs 分闸位（下移，分离）—— 触点间距缩短
        this._bladeCloseY = this._contactTopY + 12;                    // 合闸位：贴合上静触头下方
        this._bladeOpenY  = this._contactBotY - 12;                    // 分闸位：下移至出线端上部
        this._bladeLen    = 18;
        this._bladeW      = 5;                                         // 导电杆宽

        // 控制接口（右缘）
        this._portRightX = this.width - 2;
        this._controlPorts = [
            ['m1', 30],  ['m2', 58],
            ['c1', 92], ['c2', 120],
            ['uv1', 154], ['uv2', 182],
            ['fla', 210], ['flb', 236],
        ];
        this._controlLabels = { m: '储能电机', c: '合闸线圈', uv: '失压', fl: '分励' };
    }

    // ═══════════════════════════════════════════
    // 参数初始化
    // ═══════════════════════════════════════════

    _initParameters(config) {
        this.label              = config.label || 'QF';
        this.function           = '真空断路器';
        this.ratedCtrlVoltage   = config.ratedCtrlVoltage !== undefined ? config.ratedCtrlVoltage : 220;
        this._pickupRatio       = 0.85;
        this._dropoutRatio      = 0.70;
        this._coilResistance    = config.coilResistance !== undefined ? config.coilResistance : 200;
        this._uvCoilR           = config.uvCoilR !== undefined ? config.uvCoilR : 2000;
        this._coilR             = { m1: this._coilResistance, c1: this._coilResistance, uv1: this._uvCoilR };
        this._tripCoilR         = 50; // 分励线圈 fla↔flb
        this._coilOhm = { m: this._coilResistance, c: this._coilResistance, uv: this._uvCoilR, fl: this._tripCoilR };
        this._recalcCurrentThresholds();

        // 失压脱扣器故障
        this._faultUVCoilOpen  = false;
        this._faultUVStuck     = false;
        this._faultUVSpring    = false;
        // 合闸线圈 / 储能电机 / 储能弹簧故障
        this._faultCloseCoilOpen = false;
        this._faultMotorOpen     = false;
        this._faultStoreSpring   = false;
        // 分励脱扣器故障
        this._faultShuntCoilOpen = false;
        this._faultShuntNoAct    = false;
        this._faultTripShaftStuck = false;

        // 逆功率保护（发电机主开关电子脱扣，供应急主开关等继承组件使用）
        this.genId      = config.genId || '';
        this.revPowerKw  = config.revPowerKw  !== undefined ? config.revPowerKw : 8;
        this.revTime     = config.revTime     !== undefined ? config.revTime    : 5;
        this._revTimer   = 0;
        this._revTrip    = false;

        // 无电子脱扣器时的简化保护（欠压 / 过载 / 干线短路，供应急主开关等使用）
        this.faultSimpleProtect = config.faultSimpleProtect === true;
        this.uvThreshRatio      = config.uvThreshRatio !== undefined ? config.uvThreshRatio : 0.85;
        this.uvTime             = config.uvTime        !== undefined ? config.uvTime        : 2;
        this.overloadRatio      = config.overloadRatio !== undefined ? config.overloadRatio : 1.2;
        this.overloadTime       = config.overloadTime  !== undefined ? config.overloadTime  : 15;
        this._uvTimer      = 0;
        this._overloadTimer = 0;
        this._uvTrip       = false;
        this._overloadTrip = false;

        const s = (config.initState || 'off').toLowerCase();
        this._state = s === 'on' ? 'on' : 'off';

        this._animDur       = config.animDur !== undefined ? config.animDur : 0.15;
        this._animating     = false;
        this._animT         = 0;
        this._animMode      = 'none';
        // 动触片垂直位置（归一化进度 0=分闸下移 1=合闸上移）
        this._contactT      = this._state === 'on' ? 1 : 0;

        // 储能状态
        this._chargeProg = (config.initCharge || 'off').toLowerCase() === 'on' ? 5 : 0;
        this._charged    = this._chargeProg >= 5;

        // 工作位
        const wp = (config.initWorkPos || 'connected').toLowerCase();
        this._workPos    = wp === 'test' ? 1 : (wp === 'disconnected' ? 2 : 0);
        this._detent     = this._workPos;
        this._clickAcc   = 0;
        this._dialAngle  = this._detent * 90;
        this._dialCur    = this._dialAngle;
        this._savedMains = null;
        this._savedCoils = null;

        // 失压 / 手柄
        this._uvOn          = false;
        this._uvPressed     = false;
        this._uvPressCount  = 0;
        this._uvPressResult = null;
        this._handleRot     = 0;
        this._handleDown    = false;

        // 线圈电流（直流）
        this._coilPairs = { m: ['m1', 'm2'], c: ['c1', 'c2'], uv: ['uv1', 'uv2'], fl: ['fla', 'flb'] };
        this._coilI = {};
        ['m', 'c', 'uv', 'fl'].forEach(k => { this._coilI[k] = 0; });

        this.opsCount = config.initOps || 0;
    }

    _recalcCurrentThresholds() {
        this._pickupI  = {};
        this._dropoutI = {};
        const nom = { m: this._coilResistance, c: this._coilResistance, uv: this._uvCoilR, fl: this._tripCoilR };
        ['m', 'c', 'uv', 'fl'].forEach(k => {
            const iNom = this.ratedCtrlVoltage / nom[k];
            this._pickupI[k]  = iNom * this._pickupRatio;
            this._dropoutI[k] = iNom * this._dropoutRatio;
        });
    }

    _applyCoilR() {
        if (!this._coilR || !this._coilOhm) return;
        const RV = this._faultUVCoilOpen   ? 1e12 : this._uvCoilR;
        const RC = this._faultCloseCoilOpen ? 1e12 : this._coilResistance;
        const RM = this._faultMotorOpen     ? 1e12 : this._coilResistance;
        const RF = this._faultShuntCoilOpen ? 1e12 : this._tripCoilR;
        this._coilR.uv1 = RV; this._coilOhm.uv = RV;
        this._coilR.c1  = RC; this._coilOhm.c  = RC;
        this._coilR.m1  = RM; this._coilOhm.m  = RM;
        this._coilR.fla = RF; this._coilOhm.fl = RF;
    }

    setUvCoilOpen(v)        { this._faultUVCoilOpen = !!v; this._applyCoilR(); }
    setUvStuck(v)           { this._faultUVStuck = !!v; }
    setUvSpring(v)          { this._faultUVSpring = !!v; }
    setCloseCoilOpen(v)     { this._faultCloseCoilOpen = !!v; this._applyCoilR(); }
    setMotorOpen(v)         { this._faultMotorOpen = !!v; this._applyCoilR(); }
    setStoreSpring(v)       { this._faultStoreSpring = !!v; }
    setShuntCoilOpen(v)     { this._faultShuntCoilOpen = !!v; this._applyCoilR(); }
    setShuntNoAct(v)        { this._faultShuntNoAct = !!v; }
    setTripShaftStuck(v)    { this._faultTripShaftStuck = !!v; }

    // ═══════════════════════════════════════════
    // 主初始化
    // ═══════════════════════════════════════════

    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
        this._createClickableParts();
    }

    _createClickableParts() {
        // 真空泡主触头区域（供工作流 find 识别）
        this.addClickablePart('main-contact', this._bottle.x - 8, this._bottle.y - 8, this._bottle.w + 16, this._bottle.h + 16);
    }

    // ═══════════════════════════════════════════
    // 静态部件
    // ═══════════════════════════════════════════

    _drawStaticParts() {
        this._drawFrame();
        this._drawNameplate();
        this._drawIndicatorBoxes();
        this._drawButtons();
        this._drawVacuumBottle();
        this._drawControlTerminals();
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
        // 右面板浅底（宽 225）
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
            text: '真空断路器', fontSize: 15, fontStyle: 'bold', fill: '#f0f4f8',
        }));
    }

    _drawIndicatorBoxes() {
        const mk = (x) => {
            this._staticGroup.add(new Konva.Rect({
                x, y: 32, width: 66, height: 36, fill: '#f7f8fa', stroke: '#9aa3ad', strokeWidth: 1, cornerRadius: 3,
            }));
        };
        mk(6);
        mk(78);
        this._staticGroup.add(new Konva.Text({ x: 78, y: 33, width: 66, align: 'center', text: '储能', fontSize: 11, fill: '#090000' }));
    }

    _drawButtons() {
        const mk = (x, label, color) => {
            this._staticGroup.add(new Konva.Rect({
                x, y: 70, width: 66, height: 26, fill: color, cornerRadius: 4, stroke: '#5a6470', strokeWidth: 1,
            }));
            this._staticGroup.add(new Konva.Text({
                x, y: 76, width: 66, align: 'center', text: label, fontSize: 13, fontStyle: 'bold', fill: '#fff',
            }));
        };
        mk(6, '手动合闸', '#1e7e34');
        mk(78, '手动分闸', '#b3392f');
    }

    /** 真空泡 + 三相主触头系统（进线 L 上、出线 T 下，动触片可上下滑动） */
    _drawVacuumBottle() {
        const s = this._staticGroup;
        const b = this._bottle;
        const colors = ['#e03030', '#20a030', '#2050e0'];

        // 真空泡：垂直胶囊（圆角矩形 + 上下半圆盖）
        s.add(new Konva.Rect({
            x: b.x, y: b.y, width: b.w, height: b.h,
            cornerRadius: [b.w / 2, b.w / 2, b.w / 2, b.w / 2],
            fill: 'rgba(220,232,248,0.55)', stroke: '#5a8090', strokeWidth: 2,
        }));
        // 泡上 "真空泡" 标签
        s.add(new Konva.Text({
            x: b.x, y: b.y + b.h - 18, width: b.w, align: 'center',
            text: '真空泡', fontSize: 12, fontStyle: 'bold', fill: '#4a6a78', listening: false,
        }));

        this._staticXs.forEach((x, i) => {
            const c = colors[i];
            // 进线 L（顶部端口 → 上静触头圆面）
            s.add(new Konva.Line({ points: [x, 8, x, this._contactTopY], stroke: c, strokeWidth: 2.5, lineCap: 'round' }));
            // 出线 T（动触头下行基准点 → 底部端口；下方无静触头，仅导线）
            s.add(new Konva.Line({ points: [x, this._contactBotY, x, this.height - 8], stroke: c, strokeWidth: 2.5, lineCap: 'round' }));
            // 上静触头：三个水平圆面（正视成横线）
            s.add(new Konva.Ellipse({
                x, y: this._contactTopY, radiusX: this._discRX, radiusY: this._discRY,
                fill: '#c8a24a', stroke: '#7a6028', strokeWidth: 0.8,
            }));
            // 端子标签
            s.add(new Konva.Text({ x: x - 20, y: 4, text: ['L1', 'L2', 'L3'][i], fontSize: 13, fontStyle: 'bold', fill: c }));
            s.add(new Konva.Text({ x: x - 20, y: this.height - 18, text: ['T1', 'T2', 'T3'][i], fontSize: 13, fontStyle: 'bold', fill: c }));
        });
    }

    /** 右侧控制端子（储能 / 合闸线圈 / 失压 / 分励）—— 仅画端子圆点 + 标签，内部不画（简化） */
    _drawControlTerminals() {
        this._controlPorts.forEach(([id, y]) => {
            this._staticGroup.add(new Konva.Circle({
                x: this._portRightX, y, radius: 4.5, fill: '#5a5f68', stroke: '#2c3038', strokeWidth: 1,
            }));
        });
        Object.keys(this._controlLabels).forEach(k => {
            const pair = this._controlPorts.find(p => p[0].startsWith(k));
            this._staticGroup.add(new Konva.Text({
                x: this._portRightX - 66, y: pair[1] - 11, width: 56, align: 'right',
                text: this._controlLabels[k], fontSize: 12, fill: '#555', fontStyle: 'bold',
            }));
        });
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

    // ═══════════════════════════════════════════
    // 动态节点
    // ═══════════════════════════════════════════

    _createDynamicNodes() {
        this._createBlades();
        this._createIndicators();
        this._createHandle();
        this._createDial();
    }

    /** 三相动触头：三个水平圆面（正视成横线），装在垂直导电杆顶端。
     *  杆下端伸至出线接触点（下方无静触头），杆/触头随状态整体上下移动。 */
    _createBlades() {
        const g = new Konva.Group({ y: 0, listening: false });
        const colors = ['#e03030', '#20a030', '#2050e0'];
        this._blades = [];
        this._staticXs.forEach((x, i) => {
            const blade = new Konva.Group({ x, y: this._bladeOpenY });
            // 导电杆：从动触头圆面（y=0）向下伸至出线接触点（下方端点固定于 contactBotY）
            const rod = new Konva.Line({
                points: [0, 0, 0, this._contactBotY - this._bladeOpenY],
                stroke: colors[i], strokeWidth: this._bladeW, lineCap: 'round',
            });
            // 动触头圆面（横向椭圆，正视成横线），置于杆顶端
            const disc = new Konva.Ellipse({
                x: 0, y: 0, radiusX: this._discRX, radiusY: this._discRY,
                fill: '#c8a24a', stroke: '#7a6028', strokeWidth: 0.8,
            });
            blade.add(rod);
            blade.add(disc);
            g.add(blade);
            this._blades.push({ blade, rod });
        });
        this._bladesGroup = g;
        this._dynamicGroup.add(g);
    }

    _createIndicators() {
        // 合/分闸指示
        this._onOffText = new Konva.Text({
            x: 6, y: 41, width: 66, align: 'center', fontSize: 15, fontStyle: 'bold',
            text: this._state === 'on' ? '合闸 ON' : '分闸 OFF',
            fill: this._state === 'on' ? '#1b8a1b' : '#c0392b', listening: false,
        });
        // 储能指示（弹簧图标恒显，未储能叠加斜线）
        this._storeIcon = new Konva.Line({
            points: this._zigzagH(88, 134, 52),
            stroke: '#c8a020', strokeWidth: 2.5, lineCap: 'round', lineJoin: 'round', listening: false,
            visible: true,
        });
        this._storeSlash = new Konva.Line({
            points: [84, 68, 138, 40], stroke: '#c0392b', strokeWidth: 2.5,
            lineCap: 'round', listening: false, visible: !this._charged,
        });
        this._dynamicGroup.add(this._onOffText);
        this._dynamicGroup.add(this._storeIcon);
        this._dynamicGroup.add(this._storeSlash);
    }

    /** 储能手柄（默认垂直向上，按下转 180° 至向下，松手还原） */
    _createHandle() {
        this._staticGroup.add(new Konva.Text({ x: 35, y: 152, width: 80, align: 'center', text: '储能手柄', fontSize: 12, fill: '#666' }));
        const g = new Konva.Group({ x: 75, y: 140, rotation: this._handleRot, listening: false });
        g.add(new Konva.Line({ points: [0, 0, 0, -30], stroke: '#8a4a20', strokeWidth: 7, lineCap: 'round' }));
        g.add(new Konva.Circle({ x: 0, y: 0, radius: 7, fill: '#b06a2e', stroke: '#7a4a1c', strokeWidth: 1.5 }));
        this._handleGroup = g;
        this._dynamicGroup.add(g);
    }

    /** 工作位圆盘 */
    _createDial() {
        this._staticGroup.add(new Konva.Circle({ x: 75, y: 198, radius: 24, fill: '#e8eaee', stroke: '#7a7f8a', strokeWidth: 2 }));
        for (let i = 0; i < 4; i++) {
            const a = i * 90 * Math.PI / 180;
            this._staticGroup.add(new Konva.Line({
                points: [75 + Math.cos(a) * 20, 198 + Math.sin(a) * 20, 75 + Math.cos(a) * 24, 198 + Math.sin(a) * 24],
                stroke: '#7a7f8a', strokeWidth: 2, lineCap: 'round',
            }));
        }
        const g = new Konva.Group({ x: 75, y: 198, rotation: this._dialCur, listening: false });
        g.add(new Konva.Line({ points: [0, 0, 0, -16], stroke: '#38404f', strokeWidth: 3.5, lineCap: 'round' }));
        g.add(new Konva.Circle({ x: 0, y: 0, radius: 4, fill: '#38404f' }));
        this._dialGroup = g;
        this._dynamicGroup.add(g);

        this._workPosText = new Konva.Text({
            x: 42, y: 228, width: 66, align: 'center', fontSize: 11, fill: '#333',
            text: this._workPosName(), listening: false,
        });
        this._dynamicGroup.add(this._workPosText);
    }

    _workPosName() { return ['连接', '试验', '断开'][this._workPos]; }

    // ═══════════════════════════════════════════
    // 交互
    // ═══════════════════════════════════════════

    _bindInteraction() {
        const hover = (h) => {
            h.on('mouseenter', () => { document.body.style.cursor = 'pointer'; });
            h.on('mouseleave', () => { document.body.style.cursor = 'default'; });
        };

        // 储能手柄
        const handleHit = new Konva.Circle({ x: 75, y: 140, radius: 24, fill: 'transparent' });
        const release = () => { if (this._handleDown) this._handleDown = false; };
        handleHit.on('mousedown touchstart', (e) => {
            e.cancelBubble = true;
            this._handleDown = true;
            if (!this._faultStoreSpring && this._chargeProg < 5) this._chargeProg += 1;
            this._charged = this._chargeProg >= 5;
        });
        handleHit.on('mouseup touchend', release);
        window.addEventListener('mouseup', release);
        window.addEventListener('touchend', release);
        hover(handleHit);
        this._interactGroup.add(handleHit);

        // 工作位圆盘
        const dialHit = new Konva.Circle({ x: 75, y: 198, radius: 28, fill: 'transparent' });
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
        const closeHit = new Konva.Rect({ x: 6, y: 70, width: 66, height: 26, fill: 'transparent' });
        closeHit.on('click tap', (e) => { e.cancelBubble = true; this.tryClose(); });
        const openHit = new Konva.Rect({ x: 78, y: 70, width: 66, height: 26, fill: 'transparent' });
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
        if (this._state === 'on') return;
        const nextDet = this._detent + dir;
        if (nextDet < 0 || nextDet > 2) { this._clickAcc = 0; this._dialAngle = this._detent * 90; return; }
        this._clickAcc += dir;
        this._dialAngle += dir * 30;
        if (Math.abs(this._clickAcc) >= 3) {
            this._clickAcc = 0;
            this._detent = nextDet;
            this._workPos = this._detent;
            this._syncMainCircuits();
        }
        this._dialAngle = this._detent * 90;
    }

    _syncMainCircuits() {
        const sys = this.sys;
        if (!sys || !sys.conns || !sys.connMgr) return;
        const mainPorts = ['l1', 'l2', 'l3', 't1', 't2', 't3'].map(p => `${this.id}_wire_${p}`);
        const coilPorts = ['m1', 'm2', 'c1', 'c2', 'uv1', 'uv2', 'fla', 'flb'].map(p => `${this.id}_wire_${p}`);
        const isMain = c => c.type === 'wire' && (mainPorts.includes(c.from) || mainPorts.includes(c.to));
        const isCoil = c => c.type === 'wire' && (coilPorts.includes(c.from) || coilPorts.includes(c.to));
        if (this._workPos === 0) {
            this._restoreSaved('_savedMains');
            this._restoreSaved('_savedCoils');
        } else {
            this._saveRemoved('_savedMains', isMain);
            if (this._workPos === 2) this._saveRemoved('_savedCoils', isCoil);
            else this._restoreSaved('_savedCoils');
        }
    }

    _saveRemoved(key, isMatch) {
        const sys = this.sys;
        if (this[key] !== null) return;
        const removed = sys.conns.filter(isMatch);
        if (!removed.length) return;
        this[key] = removed.map(c => ({ ...c }));
        removed.forEach(c => sys.connMgr.removeConn(c));
    }

    _restoreSaved(key) {
        const sys = this.sys;
        if (!this[key] || !this[key].length) return;
        this[key].forEach(c => sys.connMgr.addConn(c));
        this[key] = null;
    }

    // ═══════════════════════════════════════════
    // 状态控制
    // ═══════════════════════════════════════════

    tryClose() {
        if (this._animating || this._state !== 'off') return;
        if (!this._charged) return;
        this._startAnim('close');
    }

    tryTrip() {
        if (this._faultTripShaftStuck) return;
        if (this._animating || this._state !== 'on') return;
        this._startAnim('open');
    }

    _startAnim(mode) {
        this._animMode = mode;
        this._animT = 0;
        this._animating = true;
        if (mode === 'close') {
            this._chargeProg = 0;
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
        ['m', 'c', 'uv', 'fl'].forEach(k => {
            const [a, b] = this._coilPairs[k];
            const v = this.sys.getVoltageBetween(`${this.id}_wire_${a}`, `${this.id}_wire_${b}`);
            if (v !== undefined && isFinite(v)) this._coilI[k] = v / this._coilOhm[k];
        });
        if (this._faultUVCoilOpen) this._coilI.uv = 0;
        if (this._faultShuntCoilOpen) this._coilI.fl = 0;
        if (this._faultUVStuck) {
            this._uvOn = false;
        } else if (this._uvPressed) {
            this._uvOn = true;
        } else if (this._faultUVSpring) {
            this._uvOn = false;
        } else {
            if (!this._uvOn && this._coilI.uv >= this._pickupI.uv) this._uvOn = true;
            else if (this._uvOn && this._coilI.uv < this._dropoutI.uv) this._uvOn = false;
        }
    }

    _logic(dt) {
        if (this._state === 'on') {
            if (!this._uvOn) { this.tryTrip(); return; }
            if (!this._faultShuntNoAct && this._coilI.fl >= this._pickupI.fl) { this.tryTrip(); return; }
            // 逆功率保护（供应急主开关等继承组件使用）
            const gen = (this.genId && this.sys && this.sys.comps) ? this.sys.comps[this.genId] : null;
            if (gen && gen._primeTrip && gen._pwr < -this.revPowerKw) {
                this._revTimer += dt;
                if (this._revTimer >= this.revTime) {
                    this._revTimer = 0;
                    this._revTrip = true;
                    this.tryTrip();
                }
            } else {
                this._revTimer = 0;
            }
            // 无电子脱扣器的简化保护（欠压 / 过载 / 干线短路）
            if (this.faultSimpleProtect) {
                if (this._isBusShort()) {
                    this._uvTimer = 0;
                    this._overloadTimer = 0;
                    this.tryTrip();
                    return;
                }
                const busV = (gen && gen._rmsV !== undefined) ? gen._rmsV
                    : (gen && gen._vRmsOut !== undefined ? gen._vRmsOut : (gen ? gen.vRms : 0));
                if (gen && gen.vRms !== undefined && busV < gen.vRms * this.uvThreshRatio) {
                    this._uvTimer += dt;
                    if (this._uvTimer >= this.uvTime) { this._uvTimer = 0; this._uvTrip = true; this.tryTrip(); return; }
                } else {
                    this._uvTimer = 0;
                }
                if (gen && gen._pwr !== undefined && gen._pwr > gen.ratedPower * this.overloadRatio) {
                    this._overloadTimer += dt;
                    if (this._overloadTimer >= this.overloadTime) { this._overloadTimer = 0; this._overloadTrip = true; this.tryTrip(); return; }
                } else {
                    this._overloadTimer = 0;
                }
            }
        }
        // 储能电机通电 → 自动储能
        if (!this._faultStoreSpring && this._coilI.m >= this._pickupI.m && this._chargeProg < 5) {
            this._chargeProg = Math.min(5, this._chargeProg + dt * 2.5);
            this._charged = this._chargeProg >= 5;
        }
        // 合闸线圈通电 → 等效手动合闸
        if (this._coilI.c >= this._pickupI.c) this.tryClose();
    }

    _isBusShort() {
        const sys = this.sys;
        if (!sys || !sys.comps) return false;
        for (const id in sys.comps) {
            const c = sys.comps[id];
            if (c && c._faultShort) return true;
        }
        return false;
    }

    _animate(dt) {
        // 手柄旋转
        const hTarget = this._handleDown ? 180 : 0;
        this._handleRot += (hTarget - this._handleRot) * Math.min(1, dt * 10);
        // 工作位圆盘
        this._dialCur += (this._dialAngle - this._dialCur) * Math.min(1, dt * 10);

        // 合/分闸机构动画：合闸动触头上移、分闸动触头下移
        if (this._animating) {
            this._animT += dt / this._animDur;
            const done = this._animT >= 1;
            if (done) this._animT = 1;
            const ease = 0.5 - 0.5 * Math.cos(this._animT * Math.PI);
            if (this._animMode === 'close') {
                // 合闸：动触头上移
                this._contactT = ease;
                if (done) {
                    this._animating = false;
                    if (this._uvOn) {
                        this._state = 'on';
                        // 重新合闸视为新会话：逆功率动作标记复位
                        this._revTrip = false;
                    } else {
                        // 失压无电：合闸失败，动触头回落
                        this._state = 'off';
                        this._animMode = 'reject';
                        this._animT = 0;
                        this._animating = true;
                    }
                }
            } else if (this._animMode === 'open') {
                // 分闸：动触头下移
                this._contactT = 1 - ease;
                if (done) {
                    this._state = 'off';
                    this._animating = false;
                    this._revTimer = 0;
                }
            } else if (this._animMode === 'reject') {
                // 合闸失败：动触头回落至分闸位
                this._contactT = 1 - ease;
                if (done) {
                    this._state = 'off';
                    this._animating = false;
                }
            }
        } else {
            // 稳态：动触头按状态渐变（合闸在上、分闸在下）
            const tTarget = this._state === 'on' ? 1 : 0;
            this._contactT += (tTarget - this._contactT) * Math.min(1, dt * 12);
        }
    }

    _updateDynamic() {
        const closed = this._state === 'on';

        // 动触头垂直位移：合闸三杆带动触头上移（贴合上静触头）、分闸下移（分离）
        const y = this._bladeOpenY + (this._bladeCloseY - this._bladeOpenY) * this._contactT;
        // 杆下端固定于出线接触点 contactBotY，杆长度随触头上移而伸长，下移而缩短
        const rodLen = this._contactBotY - y;
        this._blades.forEach(({ blade, rod }) => {
            blade.y(y);
            rod.points([0, 0, 0, rodLen]);
        });
        // 指示牌
        this._onOffText.text(closed ? '合闸 ON' : '分闸 OFF');
        this._onOffText.fill(closed ? '#1b8a1b' : '#c0392b');
        this._storeIcon.visible(true);
        this._storeSlash.visible(!(this._chargeProg >= 5));

        // 工作位圆盘
        this._dialGroup.rotation(this._dialCur);
        this._dialGroup.opacity(closed ? 0.45 : 1);
        this._workPosText.text(this._workPosName());

        // 储能手柄
        this._handleGroup.rotation(this._handleRot);
        this._handleGroup.opacity(closed ? 0.45 : 1);
    }

    // ═══════════════════════════════════════════
    // 公开 API
    // ═══════════════════════════════════════════

    getState()   { return this._state; }
    isClosed()   { return this._state === 'on'; }
    isCharged()  { return this._charged; }
    getWorkPos() { return this._workPos; }
    isRevTrip()  { return this._revTrip; }
    isUvTrip()   { return this._uvTrip; }
    isOverloadTrip() { return this._overloadTrip; }

    update(state) {
        const s = String(state).toLowerCase();
        if (s === 'on' || s === '1') this.tryClose();
        if (s === 'off' || s === '0') this.tryTrip();
        if (s === 'trip') this.tryTrip();
    }

    getConfigFields() {
        return [
            { label: '位号/名称',                 key: 'label',              type: 'text' },
            { label: '对应发电机 ID（逆功率保护用）', key: 'genId',           type: 'text' },
            { label: '控制回路额定电压 (V)',       key: 'ratedCtrlVoltage',   type: 'number' },
            { label: '初始状态 on/off',           key: 'initState',          type: 'text' },
            { label: '初始储能 on/off',           key: 'initCharge',         type: 'text' },
            { label: '初始工作位 connected/test/disconnected', key: 'initWorkPos', type: 'text' },
            { label: '动作时间 (s)',               key: 'animDur',            type: 'number' },
            { label: '控制线圈电阻 (Ω)',           key: 'coilResistance',     type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label            !== undefined) this.label            = cfg.label;
        if (cfg.ratedCtrlVoltage !== undefined) { this.ratedCtrlVoltage = parseFloat(cfg.ratedCtrlVoltage); this._recalcCurrentThresholds(); }
        if (cfg.animDur          !== undefined) this._animDur         = parseFloat(cfg.animDur);
        if (cfg.coilResistance   !== undefined) { this._coilResistance = parseFloat(cfg.coilResistance); this._coilR = { m1: this._coilResistance, c1: this._coilResistance, uv1: this._uvCoilR }; this._coilOhm = { m: this._coilResistance, c: this._coilResistance, uv: this._uvCoilR, fl: this._tripCoilR }; this._recalcCurrentThresholds(); }
        if (cfg.uvCoilR         !== undefined) { this._uvCoilR = parseFloat(cfg.uvCoilR); this._recalcCurrentThresholds(); }
        this._applyCoilR();
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
            this._syncMainCircuits();
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
