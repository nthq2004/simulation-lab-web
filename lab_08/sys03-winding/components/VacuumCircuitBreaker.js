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

        this.width  = Math.max(300, config.width  || 340);
        this.height = Math.max(400, config.height || 420);  // 增加高度以容纳接地开关栏

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

        // 右侧真空泡：去掉左侧空隙，紧贴分隔线；整体下移 30px，
        // 在泡的上、下引线中腾出隔离连接片（一次插头）的安装空间
        this._bottle = {
            x: this._divX + 6,   // 去掉真空泡左边空隙
            y: 76,
            w: 104,
            h: 130,
        };
        // 三相主触头水平并排（进线 L 在上、出线 T 在下）
        const gap = 34;
        const cx = this._bottle.x + this._bottle.w / 2;
        this._staticXs = [cx - gap, cx, cx + gap]; // 三相列 x
        // ══════ 隔离连接片（一次插头）几何 ══════
        // 上、下引线中各开一个断口：连接位（工作位）时连接片桥接接通；
        // 试验位 / 检修位时连接片向右移动 20px，引线断开
        this._isoTopY    = this._bottle.y - 22;              // 上引线断口中心 y
        this._isoBotY    = this._bottle.y + this._bottle.h + 24; // 下引线断口中心 y
        this._isoGapHalf = 9;                                // 断口半间隙（上下端子间距的一半）
        this._isoMoveX   = 20;                               // 试验/检修位连接片右移量
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
        this._controlLabels = { m: '储能电机', c: '合闸线圈', uv: '失压线圈', fl: '分励线圈' };

        // ═══════════════════════════════════════════
        // 接地开关栏几何参数（位于真空断路器下方）
        // ═══════════════════════════════════════════
        this._gsBarY = 280;      // 接地开关栏起始 Y
        this._gsBarH = 120;      // 接地开关栏高度
        
        // 左侧：摇柄插入孔和电磁锁
        this._gsInsertHoleX = 75;   // 摇柄插入孔 X（与上方工作位转换开关中心线对齐）
        this._gsInsertHoleY = 330;  // 摇柄插入孔 Y
        this._gsInsertHoleR = 12;   // 插入孔半径
        
        // 电缆位置（从断路器下端一直向下）
        this._gsCableX = this._staticXs;  // 三根电缆的 X 位置（与断路器三相对齐）
        
        // 接地开关和接地母排（母排在地接开关右边）
        this._gsSwitchX = this._divX + 110;  // 接地开关 X（再左移5px）
        this._gsSwitchWidth = 40;             // 接地开关宽度（缩短）
        this._gsBusX = this.width - 12;      // 接地母排 X（接地开关右侧，最右边）
        this._gsBusTopY = 290;               // 接地母排顶部 Y
        this._gsBusBotY = 380;               // 接地母排底部 Y
        
        // 三个接地开关位置（水平排列，间距30px）
        this._gsSwitchY = [305, 335, 365];   // 三个接地开关 Y（错开）
        
        // 手柄摇动计数（5次闭合，5次断开）
        this._crankTurnCount = 0;
        this._crankTargetTurns = 5;

        // ═══════════════════════════════════════════
        // 柜门几何（覆盖右侧原理区：真空泡 + 接地开关栏，
        // 只露出左侧操作面板 —— 断路器操作面板 + 接地开关左面板）
        // ═══════════════════════════════════════════
        this._door = {
            x: this._divX,             // 从分隔线开始（左面板露出）
            y: 2,
            w: this.width - this._divX - 2,
            h: this.height - 4,
        };
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
        // 柜门状态：0=关闭 1=打开（支持 config.initDoor = 'open'/'closed'）
        this._doorOpen  = (config.initDoor || 'closed').toLowerCase() === 'open';
        this._doorSlide = this._doorOpen ? 1 : 0;
        // 隔离连接片位置进度：0=接入引线（连接位），1=右移20px断开（试验/检修位）
        this._isoT = ((config.initWorkPos || 'connected').toLowerCase() === 'connected') ? 0 : 1;
        // 手动合闸/分闸按钮防护玻璃盖：open=是否已开盖，t=开度（0=盖住 1=完全翻开）
        this._btnCovers = {
            close: { open: false, t: 0 },
            trip:  { open: false, t: 0 },
        };
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

        // ═══════════════════════════════════════════
        // 接地开关栏参数
        // ═══════════════════════════════════════════
        // 电磁锁状态（true=解锁，摇柄可插入）
        this._emLockUnlocked = config.emLockUnlocked !== undefined ? config.emLockUnlocked : false;
        // 摇柄插入状态（true=已插入）
        this._crankInserted = config.crankInserted !== undefined ? config.crankInserted : false;
        // 摇柄旋转角度（用于动画）
        this._crankRotation = 0;
        this._crankCur = 0;  // 摇柄当前平滑旋转角度（动画插值）
        // 摇柄摇动计数（正=顺时针，负=逆时针）
        this._crankTurnCount = 0;
        this._crankTargetTurns = 5;  // 需要摇动5次才能完全闭合/断开
        // 三个接地开关状态（true=闭合，接地）
        this._gsSwitches = config.gsSwitches || [false, false, false];
        // 接地开关动画进度（0=断开，1=闭合）
        this._gsAnimProgress = this._gsSwitches.map(s => s ? 1 : 0);
        // 接地开关默认断开，动触臂逆时针30度
        this._gsDefaultAngle = -22;  // 断开时的角度（逆时针22度）
        this._gsClosedAngle = 0;     // 闭合时的角度
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
        this._drawGroundSwitchBar();  // 绘制接地开关栏
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
            const g = this._isoGapHalf;
            // 进线 L（顶部端口 → 上断口上端；上断口下端 → 上静触头圆面）
            s.add(new Konva.Line({ points: [x, 8, x, this._isoTopY - g], stroke: c, strokeWidth: 2.5, lineCap: 'round' }));
            s.add(new Konva.Line({ points: [x, this._isoTopY + g, x, this._contactTopY], stroke: c, strokeWidth: 2.5, lineCap: 'round' }));
            // 出线 T（动触头下行基准点 → 下断口上端；下断口下端 → 底部端口；下方无静触头，仅导线）
            s.add(new Konva.Line({ points: [x, this._contactBotY, x, this._isoBotY - g], stroke: c, strokeWidth: 2.5, lineCap: 'round' }));
            s.add(new Konva.Line({ points: [x, this._isoBotY + g, x, this.height - 8], stroke: c, strokeWidth: 2.5, lineCap: 'round' }));
            // 断口端子（四个金点：上引线断口上下端、下引线断口上下端）
            [this._isoTopY - g, this._isoTopY + g, this._isoBotY - g, this._isoBotY + g].forEach(ty => {
                s.add(new Konva.Circle({
                    x, y: ty, radius: 3.2, fill: '#c8a24a', stroke: '#7a6028', strokeWidth: 1,
                }));
            });
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
                x: this._portRightX - 63, y: pair[1] + 9, width: 56, align: 'right',
                text: this._controlLabels[k], fontSize: 12, fill: '#555', fontStyle: 'bold',
            }));
        });
    }

    /** 接地开关栏静态部件 */
    _drawGroundSwitchBar() {
        const s = this._staticGroup;
        const colors = ['#e03030', '#20a030', '#2050e0'];
        
        // 接地开关栏背景
        s.add(new Konva.Rect({
            x: 2, y: this._gsBarY, width: this.width - 4, height: this._gsBarH,
            fill: '#f5f5f0', stroke: '#8a8a7a', strokeWidth: 1, cornerRadius: [0, 0, 6, 6],
        }));
        
        // 接地开关栏标题
        s.add(new Konva.Text({
            x: 8, y: this._gsBarY + 5, width: 100, text: '接地开关', 
            fontSize: 12, fontStyle: 'bold', fill: '#333',
        }));
        
        // ── 左侧：摇柄插入孔 ──
        // 插入孔外圈（电磁锁指示）
        s.add(new Konva.Circle({
            x: this._gsInsertHoleX, y: this._gsInsertHoleY, 
            radius: this._gsInsertHoleR + 4,
            fill: '#4a4a4a', stroke: '#2a2a2a', strokeWidth: 2,
        }));
        // 插入孔内圈
        s.add(new Konva.Circle({
            x: this._gsInsertHoleX, y: this._gsInsertHoleY, 
            radius: this._gsInsertHoleR,
            fill: '#1a1a1a', stroke: '#3a3a3a', strokeWidth: 1,
        }));
        // 插入孔中心点
        s.add(new Konva.Circle({
            x: this._gsInsertHoleX, y: this._gsInsertHoleY, 
            radius: 3, fill: '#5a5a5a',
        }));
        
        // 电磁锁标签
        s.add(new Konva.Text({
            x: this._gsInsertHoleX - 30, y: this._gsInsertHoleY + 20,
            width: 60, align: 'center', text: '电磁锁',
            fontSize: 12, fill: '#666',
        }));
        
        // ── 右侧：接地示意图 ──
        // 从断路器下端一直向下的三根电缆（重新绘制覆盖接地开关栏背景，保证视觉连续）
        this._gsCableX.forEach((x, i) => {
            // 垂直线从接地开关栏顶部一直向下到栏底部
            s.add(new Konva.Line({
                points: [x, this._gsBarY, x, this._gsBarY + this._gsBarH],
                stroke: colors[i], strokeWidth: 2.5, lineCap: 'round',
            }));
        });
        
        // 三个接地开关（水平排列）
        this._gsSwitchY.forEach((y, i) => {
            const x = this._gsSwitchX;
            // 开关左侧线（从垂直电缆引出）
            s.add(new Konva.Line({
                points: [this._gsCableX[i], y, x, y],
                stroke: colors[i], strokeWidth: 2.5, lineCap: 'round',
            }));
            // 开关右侧引线（到接地母排）
            s.add(new Konva.Line({
                points: [x + this._gsSwitchWidth, y, this._gsBusX, y],
                stroke: colors[i], strokeWidth: 2.5, lineCap: 'round',
            }));
            // 开关触点（左侧固定）
            s.add(new Konva.Circle({
                x: x, y: y, radius: 4, fill: '#c8a24a', stroke: '#7a6028', strokeWidth: 1,
            }));
            // 开关触点（右侧固定）
            s.add(new Konva.Circle({
                x: x + this._gsSwitchWidth, y: y, radius: 4, fill: '#c8a24a', stroke: '#7a6028', strokeWidth: 1,
            }));
        });
        
        // 接地母排（竖直粗线，最右边）
        s.add(new Konva.Line({
            points: [this._gsBusX, this._gsBusTopY, this._gsBusX, this._gsBusBotY],
            stroke: '#333', strokeWidth: 6, lineCap: 'round',
        }));
        
        // 接地符号
        const gndY = this._gsBusBotY + 5;
        s.add(new Konva.Line({
            points: [this._gsBusX - 15, gndY, this._gsBusX + 15, gndY],
            stroke: '#333', strokeWidth: 3, lineCap: 'round',
        }));
        s.add(new Konva.Line({
            points: [this._gsBusX - 10, gndY + 8, this._gsBusX + 10, gndY + 8],
            stroke: '#333', strokeWidth: 2.5, lineCap: 'round',
        }));
        s.add(new Konva.Line({
            points: [this._gsBusX - 5, gndY + 16, this._gsBusX + 5, gndY + 16],
            stroke: '#333', strokeWidth: 2, lineCap: 'round',
        }));
        
        // 接地母排标签（组件内完整显示）
        s.add(new Konva.Text({
            x: this._gsBusX - 60, y: this._gsBusBotY + 20,
            width: 60, align: 'center', text: '接地母排', 
            fontSize: 10, fill: '#333',
        }));
        
        // 接地开关标签
        this._gsSwitchY.forEach((y, i) => {
            s.add(new Konva.Text({
                x: this._gsSwitchX - 5, y: y - 15,
                width: 50, align: 'center', text: `GS${i + 1}`, 
                fontSize: 10, fill: '#666',
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
        this._createIsolationLinks();        // 隔离连接片（一次插头）
        this._createIndicators();
        this._createHandle();
        this._createDial();
        this._createGroundSwitchDynamics();  // 创建接地开关动态节点
        this._createButtonCoverVisuals();    // 手动按钮防护玻璃盖
        this._drawCabinetDoor();             // 柜门（置于内部图形最上层）
    }

    /** 隔离连接片（一次插头）：每相上、下引线断口各一片。
     *  绝缘手柄水平、位于连接片中央；一条虚线横穿三相手柄表示联动。
     *  连接位（工作位）桥接接通引线；试验位/检修位整体向右移动 20px 断开。
     *  六片与联动虚线置于同一容器组，动画仅 in-place 更新容器 x。 */
    _createIsolationLinks() {
        const g = new Konva.Group({ x: 0, y: 0, listening: false });
        // 联动虚线：横穿三相绝缘手柄（上、下断口各一条），表示三相同步动作
        // （置于连接片下层，随容器组一起平移）
        const x0 = this._staticXs[0], x2 = this._staticXs[2];
        [this._isoTopY, this._isoBotY].forEach(isoY => {
            g.add(new Konva.Line({
                points: [x0 + 4, isoY, x2 + 12, isoY],
                stroke: '#7a8494', strokeWidth: 1.2, dash: [4, 3], listening: false,
            }));
        });
        // 三相 × 上/下断口各一片连接片
        [this._isoTopY, this._isoBotY].forEach(isoY => {
            this._staticXs.forEach(x => {
                const link = new Konva.Group({ x, y: isoY });
                // 竖直铜片：桥接断口上下端子（断口全高 = isoGapHalf*2 = 18）
                link.add(new Konva.Rect({
                    x: -3.5, y: -10, width: 7, height: 20, cornerRadius: 1.5,
                    fill: '#c8a24a', stroke: '#7a6028', strokeWidth: 1,
                }));
                // 绝缘拉手柄：水平状态，位于连接片中央（垂直居中）
                link.add(new Konva.Line({
                    points: [3.5, 0, 12, 0],
                    stroke: '#8a919e', strokeWidth: 3.5, lineCap: 'round',
                }));
                g.add(link);
            });
        });
        this._isoGroup = g;
        this._dynamicGroup.add(g);
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

        // ── 工作位锁定指示（转换开关中心高度、距面板右缘 20px，样式同接地开关电磁锁指示）──
        //   合闸（闭合）：工作位机械联锁无法切换 → 锁定红色
        //   分闸（断开）：可切换试验位/检修位 → 解锁绿色
        const lockedNow = this._state === 'on';
        this._wpLockIndicator = new Konva.Circle({
            x: 130, y: 198, radius: 7,
            fill: lockedNow ? '#c0392b' : '#20a030',
            stroke: '#333', strokeWidth: 1, listening: false,
        });
        this._dynamicGroup.add(this._wpLockIndicator);
        this._wpLockLabel = new Konva.Text({
            x: 110, y: 174, width: 40, align: 'center',
            text: lockedNow ? '锁定' : '解锁',
            fontSize: 12, fontStyle: 'bold',
            fill: lockedNow ? '#c0392b' : '#20a030', listening: false,
        });
        this._dynamicGroup.add(this._wpLockLabel);
        // 工作位闭锁原因提示（转换开关下方；锁定时动态显示：带负荷/接地）
        this._wpLockReasonText = new Konva.Text({
            x: 30, y: 244, width: 90, align: 'center',
            text: '', fontSize: 12, fontStyle: 'bold', fill: '#c0392b', listening: false,
        });
        this._dynamicGroup.add(this._wpLockReasonText);
    }

    _workPosName() { return ['连接', '试验', '检修'][this._workPos]; }

    /** 创建接地开关动态节点（摇柄和接地开关触头） */
    _createGroundSwitchDynamics() {
        const colors = ['#e03030', '#20a030', '#2050e0'];
        
        // ── 摇柄（可旋转，电磁锁控制可见性）──
        this._crankGroup = new Konva.Group({
            x: this._gsInsertHoleX,
            y: this._gsInsertHoleY,
            rotation: this._crankRotation,
            opacity: this._emLockUnlocked ? 1 : 0.3,  // 电磁锁未解锁时虚化
        });
        // 摇柄杆
        this._crankGroup.add(new Konva.Line({
            points: [0, 0, 0, -35],
            stroke: '#8a4a20', strokeWidth: 6, lineCap: 'round',
        }));
        // 摇柄手柄
        this._crankGroup.add(new Konva.Rect({
            x: -8, y: -45, width: 16, height: 12,
            fill: '#b06a2e', stroke: '#7a4a1c', strokeWidth: 1.5, cornerRadius: 2,
        }));
        this._dynamicGroup.add(this._crankGroup);
        
        // ── 电磁锁状态指示（插入孔正右方，与工作位锁定指示同列对齐）──
        this._emLockIndicator = new Konva.Circle({
            x: 130, y: this._gsInsertHoleY,
            radius: 7,
            fill: this._emLockUnlocked ? '#20a030' : '#c0392b',
            stroke: '#333', strokeWidth: 1,
        });
        this._dynamicGroup.add(this._emLockIndicator);
        // 电磁锁状态文字（指示灯上方，同工作位样式）
        this._emLockLabel = new Konva.Text({
            x: 110, y: this._gsInsertHoleY - 24,
            width: 40, align: 'center', text: this._emLockUnlocked ? '解锁' : '锁定',
            fontSize: 12, fontStyle: 'bold', fill: this._emLockUnlocked ? '#20a030' : '#c0392b',
        });
        this._dynamicGroup.add(this._emLockLabel);
        // 电磁锁闭锁原因提示（位于电磁锁正下方；锁定时动态显示：工作位/合闸/开门/线路带电）
        this._emLockReasonText = new Konva.Text({
            x: 30, y: this._gsInsertHoleY + 34, width: 90, align: 'center',
            text: '', fontSize: 12, fontStyle: 'bold', fill: '#c0392b', listening: false,
        });
        this._dynamicGroup.add(this._emLockReasonText);
        
        // ── 接地开关动触头（三个）──
        this._gsSwitchBlades = [];
        this._gsSwitchY.forEach((y, i) => {
            const x = this._gsSwitchX;
            const blade = new Konva.Group({
                x: x,
                y: y,
                rotation: this._gsDefaultAngle,  // 默认断开，逆时针22度
            });
            // 开关刀片
            blade.add(new Konva.Line({
                points: [0, 0, this._gsSwitchWidth, 0],
                stroke: colors[i], strokeWidth: 4, lineCap: 'round',
            }));
            // 刀片端点
            blade.add(new Konva.Circle({
                x: this._gsSwitchWidth, y: 0, radius: 5,
                fill: '#c8a24a', stroke: '#7a6028', strokeWidth: 1,
            }));
            this._dynamicGroup.add(blade);
            this._gsSwitchBlades.push(blade);
        });
        
        // ── 接地开关状态标签 ──
        this._gsStatusTexts = [];
        this._gsSwitchY.forEach((y, i) => {
            const text = new Konva.Text({
                x: this._gsSwitchX + this._gsSwitchWidth + 5, y: y - 8,
                width: 40, text: this._gsSwitches[i] ? '合' : '分',
                fontSize: 10, fontStyle: 'bold',
                fill: this._gsSwitches[i] ? '#20a030' : '#c0392b',
            });
            this._dynamicGroup.add(text);
            this._gsStatusTexts.push(text);
        });
        
        // ── 摇动次数显示 ──
        this._crankCountText = new Konva.Text({
            x: this._gsInsertHoleX - 30, y: this._gsInsertHoleY - 60,
            width: 60, align: 'center', text: '',
            fontSize: 11, fontStyle: 'bold', fill: '#333',
        });
        this._dynamicGroup.add(this._crankCountText);
    }

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
            // 合闸（带负荷）或接地闭合期间：工作位旋钮闭锁
            if (this._state === 'on' || this.isGrounded()) return;
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

        // 按钮防护玻璃盖命中区（位于按钮命中区之上：盖住时拦截按钮点击）
        this._createButtonCoverHits();

        // ═══════════════════════════════════════════
        // 接地开关栏交互
        // ═══════════════════════════════════════════
        
        // 电磁锁按钮（点击切换解锁/锁定状态，位于指示灯处——插入孔正右方）
        const emLockHit = new Konva.Circle({
            x: 130, y: this._gsInsertHoleY, radius: 13,
            fill: 'transparent',
        });
        emLockHit.on('click tap', (e) => {
            e.cancelBubble = true;
            // 联锁①：VCB 在工作位（连接位）→ 电磁锁机械闭锁
            // 联锁④：断路器合闸（带电）→ 电磁锁机械闭锁
            // 联锁③：柜门处于打开状态 → 电磁锁机械闭锁（防开门状态误操作接地开关）
            // 五防·带电闭锁：T1-T3 端口有电压 → 严禁合接地，无法解锁
            if (!this._emLockUnlocked && (this._workPos === 0 || this._state === 'on' || this._doorOpen || this._tSideEnergized())) return;
            this._emLockUnlocked = !this._emLockUnlocked;
            // 如果锁定时摇柄已插入，自动拔出
            if (!this._emLockUnlocked && this._crankInserted) {
                this._crankInserted = false;
            }
        });
        hover(emLockHit);
        this._interactGroup.add(emLockHit);
        
        // 插入孔右边区域（顺时针摇动）
        const insertHoleRight = new Konva.Rect({
            x: this._gsInsertHoleX, y: this._gsInsertHoleY - 20,
            width: 20, height: 40,
            fill: 'transparent',
        });
        insertHoleRight.on('click tap', (e) => {
            e.cancelBubble = true;
            // 五防·带电闭锁：T1-T3 带电期间禁止插入摇柄与摇动接地开关
            if (this._tSideEnergized()) return;
            if (this._emLockUnlocked && this._crankInserted) {
                // 顺时针摇动：增加摇动次数
                if (this._crankTurnCount < this._crankTargetTurns) {
                    this._crankTurnCount++;
                    this._crankRotation += 360;  // 顺时针转动1圈
                    // 更新接地开关状态
                    this._updateGroundSwitchState();
                }
            } else if (this._emLockUnlocked && !this._crankInserted) {
                // 如果电磁锁解锁但摇柄未插入，先插入摇柄
                this._crankInserted = true;
            }
        });
        hover(insertHoleRight);
        this._interactGroup.add(insertHoleRight);
        
        // 插入孔左边区域（逆时针摇动）
        const insertHoleLeft = new Konva.Rect({
            x: this._gsInsertHoleX - 30, y: this._gsInsertHoleY - 20,
            width: 30, height: 40,
            fill: 'transparent',
        });
        insertHoleLeft.on('click tap', (e) => {
            e.cancelBubble = true;
            // 五防·带电闭锁：T1-T3 带电期间禁止摇动接地开关
            if (this._tSideEnergized()) return;
            if (this._emLockUnlocked && this._crankInserted) {
                // 逆时针摇动：减少摇动次数
                if (this._crankTurnCount > 0) {
                    this._crankTurnCount--;
                    this._crankRotation -= 360;  // 逆时针转动1圈
                    // 更新接地开关状态
                    this._updateGroundSwitchState();
                }
            } else if (this._emLockUnlocked && !this._crankInserted) {
                // 如果电磁锁解锁但摇柄未插入，先插入摇柄
                this._crankInserted = true;
            }
        });
        hover(insertHoleLeft);
        this._interactGroup.add(insertHoleLeft);

        // 柜门命中区（置于交互层最上：门关闭时拦截内部所有点击，开门后随门移开）
        this._createDoorHit();
    }

    // ═══════════════════════════════════════════
    // 柜门（覆盖右侧原理区，只露出左侧操作面板）
    // ═══════════════════════════════════════════

    /** 柜门图形：金属门板 + 加强筋 + 铰链 + 把手 + 标牌 + 警示条。
     *  加入 _dynamicGroup 末尾（内部图形最上层），开合动画仅 in-place 更新位置/透明度。 */
    _drawCabinetDoor() {
        const d = this._door;
        const g = new Konva.Group({ x: 0, y: 0, listening: false });
        // 门板主体（金属渐变）
        g.add(new Konva.Rect({
            x: d.x, y: d.y, width: d.w, height: d.h, cornerRadius: 3,
            fillLinearGradientStartPoint: { x: d.x, y: d.y },
            fillLinearGradientEndPoint: { x: d.x + d.w, y: d.y + d.h },
            fillLinearGradientColorStops: [0, '#d8dce4', 0.5, '#c2c8d2', 1, '#aab1bd'],
            stroke: '#6a7280', strokeWidth: 2,
        }));
        // 门板内沿（内嵌边）
        g.add(new Konva.Rect({
            x: d.x + 7, y: d.y + 7, width: d.w - 14, height: d.h - 14, cornerRadius: 2,
            stroke: 'rgba(90,100,115,0.55)', strokeWidth: 1.5,
        }));
        // 上下加强筋（横向凹槽）
        [d.y + d.h * 0.22, d.y + d.h * 0.78].forEach(yy => {
            g.add(new Konva.Rect({
                x: d.x + 12, y: yy - 4, width: d.w - 24, height: 8, cornerRadius: 3,
                fill: 'rgba(120,130,145,0.35)', stroke: 'rgba(80,90,105,0.45)', strokeWidth: 0.8,
            }));
        });
        // 左缘铰链（三个）
        for (let i = 0; i < 3; i++) {
            const hy = d.y + d.h * (0.18 + i * 0.32);
            g.add(new Konva.Rect({
                x: d.x - 3, y: hy - 9, width: 10, height: 18, cornerRadius: 2,
                fill: '#8a919e', stroke: '#5a6270', strokeWidth: 1,
            }));
        }
        // 右侧把手位置（竖向凹槽式）—— 把手固定在柜体上，不随门扇滑走：
        // 门关闭时它是门把手；门打开后仍留在右缘，点击它即可关门
        const hx = d.x + d.w - 26, hyC = d.y + d.h / 2;
        const hg = new Konva.Group({ x: 0, y: 0, listening: false });
        hg.add(new Konva.Rect({
            x: hx, y: hyC - 34, width: 10, height: 68, cornerRadius: 5,
            fill: '#5a6470', stroke: '#3f4854', strokeWidth: 1,
        }));
        hg.add(new Konva.Line({
            points: [hx + 5, hyC - 26, hx + 5, hyC + 26],
            stroke: 'rgba(255,255,255,0.35)', strokeWidth: 2, lineCap: 'round',
        }));
        // "关门"提示（门打开后显示）
        this._doorCloseHint = new Konva.Text({
            x: hx - 64, y: hyC - 16, width: 80, align: 'center',
            text: '点击关门', fontSize: 11, fill: '#4a5560', listening: false,
        });
        this._doorCloseHint.visible(this._doorSlide > 0.6);
        hg.add(this._doorCloseHint);
        this._doorHandleGroup = hg;
        this._dynamicGroup.add(hg);
        // 标牌（顶部）：柜门名称 + 开关提示
        g.add(new Konva.Rect({
            x: d.x + d.w / 2 - 62, y: d.y + 16, width: 124, height: 30, cornerRadius: 3,
            fill: '#3a4a5a', stroke: '#2c3946', strokeWidth: 1,
        }));
        g.add(new Konva.Text({
            x: d.x + d.w / 2 - 62, y: d.y + 20, width: 124, align: 'center',
            text: '开关柜柜门', fontSize: 14, fontStyle: 'bold', fill: '#f0f4f8',
        }));
        // 门中央操作提示（动态：未接地时显示闭锁原因，接地后显示可开门）
        this._doorHintText = new Konva.Text({
            x: d.x, y: d.y + d.h / 2 - 8, width: d.w, align: 'center',
            text: '点击开门', fontSize: 12, fill: '#5a6470', listening: false,
        });
        g.add(this._doorHintText);
        // 底部警示条（黄黑斜纹）
        const wzY = d.y + d.h - 22;
        g.add(new Konva.Rect({
            x: d.x + 8, y: wzY, width: d.w - 16, height: 12, fill: '#2c3038', cornerRadius: 2,
        }));
        g.add(new Konva.Line({
            points: [d.x + 8, wzY + 6, d.x + d.w - 8, wzY + 6],
            stroke: '#f0c020', strokeWidth: 10, dash: [10, 10], lineCap: 'butt',
        }));
        this._doorGroup = g;
        this._doorGroup.opacity(this._doorSlide > 0.98 ? 0.1 : 1);
        this._doorGroup.x(d.w * this._doorSlide);
        this._dynamicGroup.add(g);
    }

    /** 柜门命中区：
     *  · 整门透明矩形 —— 门关闭时拦截内部全部交互，点击开门；
     *    开门后随门平移并禁用监听，内部按钮/摇柄恢复可操作。
     *  · 把手小矩形 —— 门完全打开后启用，点击关门（与整门 hit 互斥）。 */
    _createDoorHit() {
        const d = this._door;
        const closedNow = this._doorSlide < 0.9;
        // 整门命中：点击开门
        const hit = new Konva.Rect({
            x: d.x, y: d.y, width: d.w, height: d.h,
            fill: 'rgba(0,0,0,0.01)', cursor: 'pointer',
        });
        hit.on('click tap', (e) => {
            e.cancelBubble = true;
            this.toggleDoor();
        });
        hit.on('mouseenter', () => { document.body.style.cursor = 'pointer'; });
        hit.on('mouseleave', () => { document.body.style.cursor = 'default'; });
        this._doorHit = hit;
        this._interactGroup.add(hit);
        // 把手命中：门打开后点击关门
        const hx = d.x + d.w - 26, hyC = d.y + d.h / 2;
        const handleHit = new Konva.Rect({
            x: hx - 10, y: hyC - 46, width: 36, height: 96,
            fill: 'rgba(0,0,0,0.01)', cursor: 'pointer',
        });
        handleHit.on('click tap', (e) => {
            e.cancelBubble = true;
            this.toggleDoor();
        });
        handleHit.on('mouseenter', () => { document.body.style.cursor = 'pointer'; });
        handleHit.on('mouseleave', () => { document.body.style.cursor = 'default'; });
        this._doorHandleHit = handleHit;
        this._interactGroup.add(handleHit);
        hit.moveToTop();      // 盖过部件识别热区等既有交互节点
        handleHit.moveToTop();
        // 互斥启用：门关闭 → 整门可点；门打开 → 仅把手可点
        hit.listening(closedNow);
        handleHit.listening(!closedNow);
    }

    /** 切换柜门开/关 */
    toggleDoor() {
        if (this._animating) return; // 分合闸动作中不开门，避免状态混乱
        // 联锁②：接地开关未全部闭合（未可靠接地）→ 柜门闭锁，禁止开启
        // （关门不受限；接地开关闭合后才允许打开柜门）
        if (!this._doorOpen && !this.isGrounded()) return;
        const willOpen = !this._doorOpen;
        this._doorOpen = willOpen;
        // 联锁③：柜门打开 → 接地开关电磁锁立即闭锁、摇柄拔出
        if (willOpen && this._emLockUnlocked) {
            this._emLockUnlocked = false;
            this._crankInserted = false;
        }
        this.opsCount++;
    }

    isDoorOpen() { return !!this._doorOpen; }

    /** 五防·带电检测：T1-T3 端口任一线电压超过阈值即视为线路带电。
     *  只有三相全部无压（|U|≤阈值或未量得电压）才允许操作接地开关。 */
    _tSideEnergized() {
        const sys = this.sys;
        if (!sys || typeof sys.getVoltageBetween !== 'function') return false;
        const th = 5; // V，判电阈值
        const pairs = [['t1', 't2'], ['t2', 't3'], ['t3', 't1']];
        for (const [a, b] of pairs) {
            const v = sys.getVoltageBetween(`${this.id}_wire_${a}`, `${this.id}_wire_${b}`);
            if (typeof v === 'number' && isFinite(v) && Math.abs(v) > th) return true;
        }
        return false;
    }

    // ═══════════════════════════════════════════
    // 手动合闸/分闸按钮防护玻璃盖（防误碰罩）
    //   关盖：拦截按钮点击 → 点一下开盖（向上翻起成小条）
    //   → 再点按钮才生效 → 再点翻起的盖条重新盖上
    // ═══════════════════════════════════════════

    /** 盖子几何常量：与 _drawButtons 的按钮位置对应 */
    static get _COVER_DEFS() { return [['close', 6], ['trip', 78]]; }
    static get _COVER_BOX()  { return { y: 70, w: 66, h: 26, restH: 7, lift: 19 }; };

    /** 盖子视觉（半透明玻璃 + 高光），加入动态层；随 onConfigUpdate 重建 */
    _createButtonCoverVisuals() {
        const box = VacuumCircuitBreaker._COVER_BOX;
        this._coverVisuals = {};
        VacuumCircuitBreaker._COVER_DEFS.forEach(([key, bx]) => {
            const g = new Konva.Group({ x: bx, y: box.y, listening: false });
            const rect = new Konva.Rect({
                x: 0, y: 0, width: box.w, height: box.h, cornerRadius: 4,
                fill: 'rgba(190,214,238,0.42)',
                stroke: 'rgba(110,140,170,0.85)', strokeWidth: 1.2,
            });
            const shine = new Konva.Line({
                points: [7, box.h - 5, box.w * 0.45, 4],
                stroke: 'rgba(255,255,255,0.55)', strokeWidth: 3, lineCap: 'round',
            });
            g.add(rect);
            g.add(shine);
            // 联锁⑤⑥：合闸盖上的闭锁提示（接地闭合→"接地闭锁"；检修位→"检修闭锁"）
            if (key === 'close') {
                this._closeCoverLockText = new Konva.Text({
                    x: 0, y: box.h / 2 - 6, width: box.w, align: 'center',
                    text: '', fontSize: 10, fontStyle: 'bold',
                    fill: '#c0392b', listening: false,
                });
                g.add(this._closeCoverLockText);
            }
            this._dynamicGroup.add(g);
            this._coverVisuals[key] = { group: g, rect, shine };
        });
    }

    /** 盖子命中区：只创建一次（_interactGroup 不随配置重建，引用恒有效）。
     *  尺寸在 _updateDynamic 中随开度同步 —— 开盖后仅剩上方小条，释放按钮区。 */
    _createButtonCoverHits() {
        if (this._coverHits) return;
        const box = VacuumCircuitBreaker._COVER_BOX;
        this._coverHits = {};
        VacuumCircuitBreaker._COVER_DEFS.forEach(([key, bx]) => {
            const hit = new Konva.Rect({
                x: bx, y: box.y, width: box.w, height: box.h,
                fill: 'rgba(0,0,0,0.01)', cursor: 'pointer',
            });
            hit.on('click tap', (e) => {
                e.cancelBubble = true;
                const cv = this._btnCovers[key];
                // 联锁⑤：接地开关闭合 → 合闸按钮盖锁死
                // 联锁⑥：检修位 → 合闸按钮盖锁死（合闸失效）
                if (key === 'close' && !cv.open && (this.isGrounded() || this._workPos === 2)) return;
                cv.open = !cv.open; // 点盖切换：关→开 / 开→关
                this.opsCount++;
            });
            hit.on('mouseenter', () => { document.body.style.cursor = 'pointer'; });
            hit.on('mouseleave', () => { document.body.style.cursor = 'default'; });
            this._interactGroup.add(hit);
            this._coverHits[key] = hit;
        });
    }

    /** 更新接地开关状态（根据摇动次数） */
    _updateGroundSwitchState() {
        // 根据摇动次数计算接地开关状态
        // 摇动次数达到目标次数时，接地开关闭合
        const progress = this._crankTurnCount / this._crankTargetTurns;
        this._gsSwitches = [progress >= 1, progress >= 1, progress >= 1];
    }

    _dialTurn(dir) {
        if (this._state === 'on') return;
        // 五防·防带地线摇车：接地开关闭合期间工作位旋钮整体闭锁，
        // 手车不得摇回连接位（防止带地线就位后解除接地即具备送电条件）
        if (this.isGrounded()) return;
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
        // 联锁①：回到工作位（连接位）→ 接地开关电磁锁自动闭锁、摇柄拔出
        if (this._workPos === 0 && this._emLockUnlocked) {
            this._emLockUnlocked = false;
            this._crankInserted = false;
        }
        const sys = this.sys;
        if (!sys || !sys.conns || !sys.connMgr) return;
        // 主回路隔离由柜内一次插头（隔离连接片）承担：
        //   试验位/检修位时连接片拉开（视觉）+ stamp 层不注入导通导纳（电气），
        //   因此外部主回路连线保持不动，不再摘除/恢复。
        // 此处仅清理历史遗留的主回路缓存；检修位仍断开二次线圈连线。
        this._restoreSaved('_savedMains');
        const coilPorts = ['m1', 'm2', 'c1', 'c2', 'uv1', 'uv2', 'fla', 'flb'].map(p => `${this.id}_wire_${p}`);
        const isCoil = c => c.type === 'wire' && (coilPorts.includes(c.from) || coilPorts.includes(c.to));
        if (this._workPos === 2) this._saveRemoved('_savedCoils', isCoil);
        else this._restoreSaved('_savedCoils');
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
        // 联锁⑤：接地开关处于闭合（线路已接地）→ 禁止合闸，防止带地线合闸
        if (this.isGrounded()) return;
        // 联锁⑥：检修位（一、二次插头全断）→ 合闸操作失效
        if (this._workPos === 2) return;
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
            // 联锁④：合闸操作（手动/遥控）→ 接地开关电磁锁立即闭锁、摇柄拔出
            if (this._emLockUnlocked) {
                this._emLockUnlocked = false;
                this._crankInserted = false;
            }
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
        this._updateDynamic(dt);
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
        // 摇柄平滑旋转（1圈=360° 动画）
        this._crankCur += (this._crankRotation - this._crankCur) * Math.min(1, dt * 6);

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

    _updateDynamic(dt) {
        const closed = this._state === 'on';

        // 动触头垂直位移：合闸三杆带动触头上移（贴合上静触头）、分闸下移（分离）
        const y = this._bladeOpenY + (this._bladeCloseY - this._bladeOpenY) * this._contactT;
        // 杆下端固定于出线接触点 contactBotY，杆长度随触头上移而伸长，下移而缩短
        const rodLen = this._contactBotY - y;
        this._blades.forEach(({ blade, rod }) => {
            blade.y(y);
            rod.points([0, 0, 0, rodLen]);
        });

        // ══════ 隔离连接片（一次插头）联动工作位 ══════
        // 连接位（workPos=0）：连接片桥接引线；试验位(1)/检修位(2)：右移 20px 断开
        const isoTarget = (this._workPos === 0) ? 0 : 1;
        this._isoT += (isoTarget - this._isoT) * Math.min(1, (dt || 0.05) * 8);
        if (Math.abs(this._isoT - isoTarget) < 0.003) this._isoT = isoTarget;
        if (this._isoGroup) this._isoGroup.x(this._isoMoveX * this._isoT);

        // ══════ 手动按钮防护玻璃盖开合动画 ══════
        // 开盖：玻璃向上收起成小条停在按钮上方（铰链在顶部），露出整个按钮
        // 联锁⑤：接地开关闭合 → 强制关上合闸按钮防护盖（按钮闭锁）
        // 联锁⑥：检修位 → 强制关上合闸按钮防护盖（合闸失效）
        const closeCoverLocked = this.isGrounded() || this._workPos === 2;
        if (closeCoverLocked && this._btnCovers.close.open) this._btnCovers.close.open = false;
        if (this._coverVisuals) {
            const box = VacuumCircuitBreaker._COVER_BOX;
            VacuumCircuitBreaker._COVER_DEFS.forEach(([key]) => {
                const cv = this._btnCovers[key];
                const v = this._coverVisuals[key];
                const target = cv.open ? 1 : 0;
                cv.t += (target - cv.t) * Math.min(1, (dt || 0.05) * 10);
                if (Math.abs(cv.t - target) < 0.003) cv.t = target;
                const h = box.h - (box.h - box.restH) * cv.t;   // 26 → 7
                const yOff = -box.lift * cv.t;                  // 向上翻起 19px
                v.rect.y(yOff);
                v.rect.height(h);
                v.shine.visible(cv.t < 0.5);                    // 翻开后高光隐藏
                const hit = this._coverHits && this._coverHits[key];
                if (hit) {                                      // 命中区同步收缩，释放按钮区
                    hit.y(box.y + yOff);
                    hit.height(h);
                }
            });
            // 合闸盖闭锁提示：按原因显示"接地闭锁"/"检修闭锁"
            if (this._closeCoverLockText) {
                const reason = this.isGrounded() ? '接地闭锁' : (this._workPos === 2 ? '检修闭锁' : '');
                this._closeCoverLockText.text(reason);
                this._closeCoverLockText.visible(!!reason);
            }
        }
        // 指示牌
        this._onOffText.text(closed ? '合闸 ON' : '分闸 OFF');
        this._onOffText.fill(closed ? '#1b8a1b' : '#c0392b');
        this._storeIcon.visible(true);
        this._storeSlash.visible(!(this._chargeProg >= 5));

        // 工作位圆盘
        this._dialGroup.rotation(this._dialCur);
        this._dialGroup.opacity(closed ? 0.45 : 1);
        this._workPosText.text(this._workPosName());

        // 工作位锁定指示：合闸（带负荷）或接地闭合（防带地线摇车）→ 锁定红；否则解锁绿
        if (this._wpLockIndicator) {
            const wpLocked = closed || this.isGrounded();
            this._wpLockIndicator.fill(wpLocked ? '#c0392b' : '#20a030');
            this._wpLockLabel.text(wpLocked ? '锁定' : '解锁');
            this._wpLockLabel.fill(wpLocked ? '#c0392b' : '#20a030');
            // 闭锁原因（解锁时不显示）
            if (this._wpLockReasonText) {
                let reason = '';
                if (closed) reason = '合闸闭锁';
                else if (this.isGrounded()) reason = '接地闭锁';
                this._wpLockReasonText.text(reason);
            }
        }

        // 储能手柄
        this._handleGroup.rotation(this._handleRot);
        this._handleGroup.opacity(closed ? 0.45 : 1);

        // ═══════════════════════════════════════════
        // 接地开关栏动态更新
        // ═══════════════════════════════════════════
        
        // 摇柄状态
        this._crankGroup.opacity(this._emLockUnlocked ? 1 : 0.3);
        this._crankGroup.rotation(this._crankCur);
        
        // 电磁锁指示灯
        this._emLockIndicator.fill(this._emLockUnlocked ? '#20a030' : '#c0392b');
        this._emLockLabel.text(this._emLockUnlocked ? '解锁' : '锁定');
        this._emLockLabel.fill(this._emLockUnlocked ? '#20a030' : '#c0392b');
        // 电磁锁闭锁原因（解锁时不显示；按优先级：工作位 > 合闸 > 开门 > 线路带电）
        if (this._emLockReasonText) {
            let reason = '';
            if (!this._emLockUnlocked) {
                if (this._workPos === 0) reason = '工作位闭锁';
                else if (this._state === 'on') reason = '合闸闭锁';
                else if (this._doorOpen) reason = '开门闭锁';
                else if (this._tSideEnergized()) reason = '线路带电';
            }
            this._emLockReasonText.text(reason);
        }
        
        // 接地开关状态
        const progress = this._crankTurnCount / this._crankTargetTurns;
        this._gsSwitchBlades.forEach((blade, i) => {
            // 根据摇动进度计算目标角度
            // 0次摇动：-30度（断开）
            // 5次摇动：0度（闭合）
            const targetAngle = this._gsDefaultAngle + (this._gsClosedAngle - this._gsDefaultAngle) * progress;
            // 平滑动画
            const currentAngle = blade.rotation();
            const newAngle = currentAngle + (targetAngle - currentAngle) * 0.2;
            blade.rotation(newAngle);
            
            // 更新状态标签
            this._gsStatusTexts[i].text(progress >= 1 ? '合' : '分');
            this._gsStatusTexts[i].fill(progress >= 1 ? '#20a030' : '#c0392b');
        });
        
        // 摇动次数显示
        this._crankCountText.text(progress >= 1 ? '' : `${this._crankTurnCount}/${this._crankTargetTurns}`);

        // ═══════════════════════════════════════════
        // 柜门开合动画（向右滑出 + 渐隐）
        // ═══════════════════════════════════════════
        const dTarget = this._doorOpen ? 1 : 0;
        this._doorSlide += (dTarget - this._doorSlide) * Math.min(1, (dt || 0.05) * 6);
        if (Math.abs(this._doorSlide - dTarget) < 0.003) this._doorSlide = dTarget;
        const doorOff = this._door.w * this._doorSlide;
        if (this._doorGroup) {
            this._doorGroup.x(doorOff);
            this._doorGroup.opacity(Math.max(0.08, 1 - this._doorSlide * 1.15));
        }
        if (this._doorHit) {
            // 命中区基准在分隔线 d.x（150），随门开度向右平移；
            // 若误以 0 为基准，门关闭时会盖住整个左侧操作面板
            this._doorHit.x(this._door.x + doorOff);
            // 互斥启用：门基本关闭 → 整门可点（开门）；门基本打开 → 把手可点（关门）
            const doorListening = this._doorSlide < 0.9;
            if (this._doorHit.listening() !== doorListening) {
                this._doorHit.listening(doorListening);
                document.body.style.cursor = 'default';
            }
        }
        if (this._doorHandleHit) {
            const handleListening = this._doorSlide > 0.9;
            if (this._doorHandleHit.listening() !== handleListening) {
                this._doorHandleHit.listening(handleListening);
                document.body.style.cursor = 'default';
            }
        }
        // "点击关门"提示：门基本打开后显示
        if (this._doorCloseHint) this._doorCloseHint.visible(this._doorSlide > 0.6);
        // 联锁②提示：接地开关未闭合 → 门中央显示红色闭锁原因；接地后显示"点击开门"
        if (this._doorHintText) {
            const blocked = !this.isGrounded();
            this._doorHintText.text(blocked ? '柜门闭锁 · 请先合上接地开关' : '点击开门');
            this._doorHintText.fill(blocked ? '#c0392b' : '#5a6470');
        }
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
    /** 接地开关是否全部闭合（T1-T3 对地短接） */
    isGrounded() { return Array.isArray(this._gsSwitches) && this._gsSwitches.length === 3 && this._gsSwitches.every(Boolean); }

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
            { label: '电磁锁初始状态 locked/unlocked', key: 'emLockUnlocked', type: 'text' },
            { label: '摇柄初始状态 inserted/removed', key: 'crankInserted', type: 'text' },
            { label: '柜门初始状态 open/closed', key: 'initDoor', type: 'text' },
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
            this._isoT = (this._workPos === 0) ? 0 : 1; // 连接片位置同步到位
            this._syncMainCircuits();
        }
        // 接地开关栏配置
        if (cfg.emLockUnlocked !== undefined) {
            this._emLockUnlocked = String(cfg.emLockUnlocked).toLowerCase() === 'unlocked';
        }
        if (cfg.crankInserted !== undefined) {
            this._crankInserted = String(cfg.crankInserted).toLowerCase() === 'inserted';
        }
        // 柜门初始状态（直接到位，不做动画）
        if (cfg.initDoor !== undefined) {
            this._doorOpen = String(cfg.initDoor).toLowerCase() === 'open';
            this._doorSlide = this._doorOpen ? 1 : 0;
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
