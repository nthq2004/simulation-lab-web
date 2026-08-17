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
            syncScopeId:      this.syncScopeId,
            phaseMin:         this.phaseMin,
            phaseMax:         this.phaseMax,
            freqDiffMax:      this.freqDiffMax,
            genId:            this.genId,
            revPowerKw:       this.revPowerKw,
            revTime:          this.revTime,
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
        this._uvCoilR           = config.uvCoilR !== undefined ? config.uvCoilR : 2000; // 失压线圈正常电阻
        this._coilR             = { m1: this._coilResistance, c1: this._coilResistance, uv1: this._uvCoilR, et1: this._coilResistance };
        this._tripCoilR         = 50; // 分励线圈 fla↔flb
        // 电流控制：各线圈按自身电阻，额定电流的 85% 工作 / 70% 停止
        this._coilOhm = { m: this._coilResistance, c: this._coilResistance, uv: this._uvCoilR, et: this._coilResistance, fl: this._tripCoilR };
        this._recalcCurrentThresholds();
        // 失压脱扣器故障
        this._faultUVCoilOpen  = false; // 失压线圈断线（电阻无穷大）
        this._faultUVStuck     = false; // 衔铁结构卡死（通电/手动均无法吸合）
        this._faultUVSpring    = false; // 反作用弹簧弹力过大（通电无法吸合，手动可吸合）

        // 其余故障
        this._faultCloseCoilOpen = false; // 合闸线圈断线（电阻无穷大）
        this._faultMotorOpen     = false; // 储能电机控制回路断线（电阻无穷大）
        this._faultStoreSpring   = false; // 储能弹簧无法储能

        // 分励脱扣器故障
        this._faultShuntCoilOpen = false; // 分励线圈断线（电阻无穷大）
        this._faultShuntNoAct    = false; // 分励脱扣器不动作（线圈得电也不跳闸）

        // 脱扣轴故障 + 振动触发
        this._faultTripShaftStuck = false; // 脱扣轴卡死（任何脱扣动作均无法使脱扣轴转动）
        this._faultTripAging      = false; // 脱扣机构老化（振动 30~60s 后使脱扣钩滑动而脱扣）
        this._vibrating           = false; // 持续振动状态
        this._vibPhase            = 0;      // 当前小幅振动脉冲的相位（s）
        this._vibPulseT           = 0;      // 下一次振动脉冲的倒计时（s）
        this._agingDelay          = 0;      // 老化脱扣延迟剩余时间（s）

        // ── 非同期/频差并车保护（并车保护）──
        // syncScopeId 为空时不启用（兼容旧工程）。
        // genId：本主开关对应的发电机 id（用于排除"本机机组"，避免把本机误判为"其它在网机组"）
        // 合闸瞬间满足以下任一条件即视为危险并车，立即触发全船主开关跳闸：
        //   1) 相位差落在 [phaseMin, phaseMax]（非同期）；
        //   2) 频差 |fGen−fBus| > freqDiffMax（freqDiffMax<=0 时不启用该项）。
        // 保护只跳开主开关，发电机保持运行（空载），可调速后重新并车。
        this.genId      = config.genId || '';
        this.syncScopeId = config.syncScopeId || '';
        this.phaseMin    = config.phaseMin    !== undefined ? config.phaseMin : 60;   // 非同期相位差下界(°)
        this.phaseMax    = config.phaseMax    !== undefined ? config.phaseMax : 270;  // 非同期相位差上界(°)
        this.freqDiffMax = config.freqDiffMax !== undefined ? config.freqDiffMax : 0; // 允许最大频差(Hz)，<=0 不启用

        // ── 逆功率保护（发电机主开关电子脱扣）──
        // 本开关所联发电机处于"原动机故障拖转"状态（gen._primeTrip）且输出逆功率
        // 超过 revPowerKw 时开始计时，持续 revTime 秒后跳闸（只跳本机主开关，
        // 发电机不停机、其它主开关不受影响）。仅 _primeTrip 时启用——低频并车等
        // 单纯的显示逆功率（物理功率仍为正）不触发本保护。
        this.revPowerKw  = config.revPowerKw  !== undefined ? config.revPowerKw : 8; // 逆功率定值 kW
        this.revTime     = config.revTime     !== undefined ? config.revTime    : 5; // 动作延时 s
        this._revTimer   = 0;    // 逆功率超定值持续时间（s）
        this._revTrip    = false; // 逆功率保护是否已动作（供教学 check 用）

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
        // 工作位切换时摘除的主回路/线圈连线缓存（非连接位暂存，切回时回插）
        this._savedMains = null;
        this._savedCoils = null;

        // 失压/手柄/杠杆
        this._uvOn      = false;
        this._uvPressed = false; // 手动按下动衔铁 → 强制吸合（无视弹簧弹力）
        this._uvPressCount = 0;  // 动衔铁按压次数（诊断用：检测学员是否实际按压过动衔铁）
        this._uvPressResult = null; // 最近一次按压后脱扣器是否复位（true=复位成功）
        this._handleRot = 0;
        this._handleDown = false;
        this._handlePressCount = 0; // 储能手柄按压次数（诊断用：检测是否手动转动过手柄）
        this._leverAng  = 6; // 未励磁：杠杆左端上翘（尖三角顶脱扣轴）

        // 线圈电流（直流，直接读取端口电压换算电流）
        this._coilPairs = { m: ['m1', 'm2'], c: ['c1', 'c2'], uv: ['uv1', 'uv2'], fl: ['fla', 'flb'], et: ['et1', 'et2'] };
        this._coilI = {};
        ['m', 'c', 'uv', 'fl', 'et'].forEach(k => {
            this._coilI[k] = 0;
        });

        this.opsCount = config.initOps || 0;
    }

    // 电流阈值：额定电流的 85% 工作 / 70% 停止（各线圈按自身标称电阻折算）
    _recalcCurrentThresholds() {
        this._pickupI  = {};
        this._dropoutI = {};
        // 阈值基于标称电阻（断线等故障不改变基准；断线时线圈电流降为 0，自然低于阈值）
        const nom = { m: this._coilResistance, c: this._coilResistance, uv: this._uvCoilR, et: this._coilResistance, fl: this._tripCoilR };
        ['m', 'c', 'uv', 'fl', 'et'].forEach(k => {
            const iNom = this.ratedCtrlVoltage / nom[k];
            this._pickupI[k]  = iNom * this._pickupRatio;
            this._dropoutI[k] = iNom * this._dropoutRatio;
        });
    }

    /** 各线圈电阻：断线 → 无穷大；正常 → 标称值（失压 2000Ω，其余 200Ω）。
     *  注意：仅修改 _coilOhm/_coilR，不重算电流阈值（阈值固定按标称电阻）。 */
    _applyCoilR() {
        if (!this._coilR || !this._coilOhm) return;
        const RV = this._faultUVCoilOpen   ? 1e12 : this._uvCoilR;
        const RC = this._faultCloseCoilOpen ? 1e12 : this._coilResistance;
        const RM = this._faultMotorOpen     ? 1e12 : this._coilResistance;
        const RF = this._faultShuntCoilOpen ? 1e12 : this._tripCoilR; // 分励线圈 fla↔flb
        this._coilR.uv1 = RV; this._coilOhm.uv = RV;
        this._coilR.c1  = RC; this._coilOhm.c  = RC;
        this._coilR.m1  = RM; this._coilOhm.m  = RM;
        this._coilR.fla = RF; this._coilOhm.fl = RF;
    }

    /** 失压线圈断线故障：通电无法吸合，万用表测得无穷大电阻 */
    setUvCoilOpen(v) {
        this._faultUVCoilOpen = !!v;
        this._applyCoilR();
    }

    /** 衔铁结构卡死：通电无法吸合、手动按压也无法吸合 */
    setUvStuck(v) {
        this._faultUVStuck = !!v;
    }

    /** 反作用弹簧弹力过大：通电无法吸合，手动按压可吸合 */
    setUvSpring(v) {
        this._faultUVSpring = !!v;
    }

    /** 合闸线圈断线故障：合闸线圈通电无电流，无法自动合闸 */
    setCloseCoilOpen(v) {
        this._faultCloseCoilOpen = !!v;
        this._applyCoilR();
    }

    /** 储能电机控制回路断线故障：储能电机不转，无法自动储能（手动储能仍可） */
    setMotorOpen(v) {
        this._faultMotorOpen = !!v;
        this._applyCoilR();
    }

    /** 储能弹簧无法储能：无论手动或电动储能均无效 */
    setStoreSpring(v) {
        this._faultStoreSpring = !!v;
    }

    /** 分励线圈断线故障：分励线圈通电无电流，无法实现电动分闸 */
    setShuntCoilOpen(v) {
        this._faultShuntCoilOpen = !!v;
        this._applyCoilR();
    }

    /** 分励脱扣器不动作故障：线圈得电但不联动脱扣轴，分闸失效 */
    setShuntNoAct(v) {
        this._faultShuntNoAct = !!v;
    }

    /** 脱扣轴卡死：任何脱扣原因均无法使脱扣轴转动分闸 */
    setTripShaftStuck(v) {
        this._faultTripShaftStuck = !!v;
    }

    /** 脱扣机构老化：振动后 90~180s 内脱扣钩滑动而脱扣 */
    setTripAging(v) {
        this._faultTripAging = !!v;
        if (!v) this._agingDelay = 0; // 取消老化故障则清空延迟
    }

    /** 触发/复位振动（开关）：置位后进入持续振动状态（每约 3s 产生一两个小幅晃动脉冲），
     *  再次调用则复位停止；若存在脱扣机构老化故障，置位时随机延迟 30~60s 后触发脱扣 */
    triggerVibration() {
        if (this._vibrating) {
            // 复位停止振动
            this._vibrating = false;
            this._agingDelay = 0;   // 停振同时取消老化脱扣倒计时
            this.group.offset({ x: 0, y: 0 });
            return;
        }
        this._vibrating = true;
        this._vibPulseT = 0;      // 立即开始第一个振动脉冲
        this._vibPhase  = 0;
        // 老化脱扣倒计时由 _logic 统一武装（振动+老化+合闸时自动初始化 30~60s）
    }

    /** 自定义右键菜单项 */
    getContextMenuItems() {
        return [
            { label: this._vibrating ? '停止振动' : '触发振动', onClick: () => this.triggerVibration() },
        ];
    }

    // ═══════════════════════════════════════════
    // 主初始化
    // ═══════════════════════════════════════════

    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
        this._createClickableParts();
    }

    /**
     * 部件识别热区（供工作流 find 模式点击识别）
     */
    _createClickableParts() {
        // 储能弹簧（水平，固定端右，x≈360~540, y≈41）
        this.addClickablePart('store-spring', 355, 25, 190, 32);
        // 合闸线圈（储能弹簧下方，x≈479, y≈61, 42×18）
        this.addClickablePart('close-coil', 475, 58, 50, 25);
        // 失压脱扣器（磁轭 x≈404~460, y≈150~210）
        this.addClickablePart('uv-trip', 400, 145, 65, 70);
        // 分励线圈（失压线圈下方，x≈417, y≈252）
        this.addClickablePart('shunt-coil', 412, 248, 40, 24);
        // 主触头（三对动触点 x≈260/310/360, y≈100~140）
        this.addClickablePart('main-contact', 250, 92, 125, 55);
        // 辅助触头（顶部常开 180~220 与常闭 400~440 区域）
        this.addClickablePart('aux-contact', 170, 16, 280, 22);
        // 分闸弹簧（左端固定 x≈160，沿主轴到 x≈250）
        this.addClickablePart('open-spring', 150, 100, 110, 40);

        // ── 失压脱扣器动衔铁按压交互（置于最后，位于最上层）──
        const uvHitBg = new Konva.Rect({
            x: 398, y: 118, width: 70, height: 34,
            fill: 'rgba(0, 180, 0, 0.03)', stroke: null, listening: false,
        });
        const uvHitArea = new Konva.Rect({
            x: 398, y: 118, width: 70, height: 34,
            fill: 'rgba(0, 0, 0, 0)', stroke: null, listening: true, cursor: 'pointer',
        });
        const uvRelease = () => {
            if (!this._uvPressed) return;
            this._uvPressed = false;
        };
        uvHitArea.on('mousedown touchstart', (e) => {
            e.cancelBubble = true;
            this._uvPressed = true; // 按下即强制吸合，无视反作用弹簧弹力
            this._uvPressCount++;   // 记录实际按压次数（诊断用）
            // 记录本次按压后脱扣器能否复位（卡死→无法复位；反作用弹簧过大→按压可复位）
            this._uvPressResult = !this._faultUVStuck;
        });
        uvHitArea.on('mouseup touchend mouseleave', uvRelease);
        window.addEventListener('mouseup', uvRelease);
        window.addEventListener('touchend', uvRelease);
        // 点击顺带识别为「失压脱扣器」部件（find 判定依赖 lastClickedPartId）
        uvHitArea.on('click tap', (e) => {
            e.cancelBubble = true;
            this.sys.lastClickedId = this.id;
            this.sys.lastClickedPartId = this.id + '/uv-trip';
        });
        uvHitArea.on('mouseenter', () => { uvHitBg.fill('rgba(0, 180, 0, 0.10)'); this.sys.layer.batchDraw(); });
        uvHitArea.on('mouseleave', () => { uvHitBg.fill('rgba(0, 180, 0, 0.03)'); this.sys.layer.batchDraw(); });
        const uvHit = new Konva.Group({});
        uvHit.add(uvHitBg);
        uvHit.add(uvHitArea);
        this._interactGroup.add(uvHit);
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
            this._handlePressCount++;   // 记录一次手动储能操作
            // 储能弹簧损坏 → 手动按压也不储能
            if (!this._faultStoreSpring && this._chargeProg < 5) this._chargeProg += 1;
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
            this._syncMainCircuits();
        }
        this._dialAngle = this._detent * 90;
    }

    /**
     * 工作位切换时同步主回路与线圈连线：
     * 连接位(0)：恢复主回路与线圈连线；
     * 试验位(1)：断开主回路（L1-3 与汇流排、T1-3 与发电机/脱扣器），线圈保持；
     * 断开位(2)：主回路 + 全部线圈均断开。反向切回时自动恢复缓存连线。
     */
    _syncMainCircuits() {
        const sys = this.sys;
        if (!sys || !sys.conns || !sys.connMgr) return;
        const mainPorts = ['l1', 'l2', 'l3', 't1', 't2', 't3']
            .map(p => `${this.id}_wire_${p}`);
        const coilPorts = ['m1', 'm2', 'c1', 'c2', 'uv1', 'uv2', 'fla', 'flb', 'et1', 'et2']
            .map(p => `${this.id}_wire_${p}`);
        const isMain = c => c.type === 'wire' && (
            mainPorts.includes(c.from) || mainPorts.includes(c.to));
        const isCoil = c => c.type === 'wire' && (
            coilPorts.includes(c.from) || coilPorts.includes(c.to));

        if (this._workPos === 0) {
            // 连接位：恢复主回路与线圈
            this._restoreSaved('_savedMains');
            this._restoreSaved('_savedCoils');
        } else {
            // 非连接位：主回路一律断开（试验/断开位均摘除）
            this._saveRemoved('_savedMains', isMain);
            if (this._workPos === 2) {
                // 断开位：线圈一并断开
                this._saveRemoved('_savedCoils', isCoil);
            } else {
                // 试验位：线圈恢复（从断开位切回时）
                this._restoreSaved('_savedCoils');
            }
        }
    }

    /** 缓存并移除满足条件的连线（若已缓存则不重复操作） */
    _saveRemoved(key, isMatch) {
        const sys = this.sys;
        if (this[key] !== null) return;
        const removed = sys.conns.filter(isMatch);
        if (!removed.length) return;
        this[key] = removed.map(c => ({ ...c }));
        removed.forEach(c => sys.connMgr.removeConn(c));
    }

    /** 恢复缓存连线并清空缓存 */
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
        if (!this._charged) return;   // 未储能不能合闸
        // 只要储能已满即释放能量；失压无电时脱扣轴处于脱扣位，动画结束后分闸弹簧拉回（合闸失败）
        this._startAnim('close');
    }

    tryTrip() {
        // 脱扣轴卡死：任何脱扣动作均无法使脱扣轴转动分闸
        if (this._faultTripShaftStuck) return;
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
    // 非同期合闸保护（并车保护）
    // ═══════════════════════════════════════════

    /**
     * 自动同期（并车冲击抑制）：
     * 并联合闸接通瞬间，若待并机已满足同期条件（相位差处于允许区、
     * 频差不越限），立即将其相位偏移 / 波形频率 / 输出电压对齐到在网机组。
     * 由于本模型电源电动势为 ωt+φ 解析式，相位与频率一致即处处同相 → 合闸
     * 瞬间无相位差冲击（几百安培的来源），也无并网后持续环流。
     * 非同期合闸（相位差 60°~270° 或频差 >freqDiffMax）时不做对齐，
     * 保留真实非同期相位差，交由 _checkOutOfSyncClose() 触发保护跳闸。
     */
    _autoSyncIncoming() {
        if (!this.genId || !this.sys || !this.sys.comps) return;
        const gen = this.sys.comps[this.genId];
        if (!gen || gen.type !== 'source_3p' || !gen.isOn) return;
        // 母线已在网机组（leader，排除本机所联发电机）
        let leader = null;
        for (const id in this.sys.comps) {
            const c = this.sys.comps[id];
            if (c.type === 'source_3p' && c.isOn && c.id !== this.genId) { leader = c; break; }
        }
        if (!leader) return; // 首台投入：无并车对象，无需同期
        // 同期条件复核：相位差必须处于允许区（不在 [phaseMin, phaseMax]）
        if (this.syncScopeId && this.sys.comps[this.syncScopeId]) {
            const sc = this.sys.comps[this.syncScopeId];
            if (typeof sc._phaseDiff === 'number') {
                const deg = sc._phaseDiff * 180 / Math.PI;
                if (deg >= this.phaseMin && deg <= this.phaseMax) return; // 非同期：不对齐
            }
            if (this.freqDiffMax > 0 && typeof sc._fGen === 'number' && typeof sc._fBus === 'number') {
                if (Math.abs(sc._fGen - sc._fBus) > this.freqDiffMax) return; // 频差越限：不对齐
            }
        }
        // 对齐：相位偏移、波形物理频率（getPhaseVoltage 用 this.freq）、显示频率、输出电压
        gen._phaseShift = leader._phaseShift || 0;
        if (isFinite(leader.freq))       gen.freq = leader.freq;
        if (isFinite(leader._freq))      gen._freq = leader._freq;
        if (isFinite(leader._freqRate))  gen._freqRate = leader._freqRate;
        if (isFinite(leader._vRmsOut)) {
            gen._vRmsOut = leader._vRmsOut;
            gen._avrComp   = leader._avrComp || 0;
            gen._avrTimer  = leader._avrTimer || 0;
        }
    }

    /**
     * 合闸完成瞬间调用。
     * 仅当属于"并联投入"（母线已带电、存在其它在网机组）时检查并车条件：
     *   - 同步表测得的相位差（待并机 − 母线，0~360°）落在 [phaseMin, phaseMax]；
     *   - 频差 |fGen − fBus| 超过 freqDiffMax（freqDiffMax>0 时启用）。
     * 任一越界即视为危险并车 → 立即触发全船主开关跳闸（发电机不停机）。
     */
    _checkOutOfSyncClose() {
        if (!this.syncScopeId || !this.sys || !this.sys.comps) return;
        // 首台投入（无其它在网机组 / 无其它合闸主开关）不构成"同期"，不检查。
        // 注意排除本机所联发电机（genId），否则首台合闸时本机正在运行会被误判为"其它机组"，
        // 从而用同步表残留相位差（待并机停机/未接入时保留旧值）误触发全船跳闸。
        let othersOn = false;
        for (const id in this.sys.comps) {
            const c = this.sys.comps[id];
            if (!c || c === this) continue;
            // 仅算"其它发电机主开关"（带 genId 的 MarineMainsSwitch），
            // 排除负载/母联开关（如 acb_l）与其它无关 ACB。
            if (c.type === 'ACB' && c.genId && c._state === 'on') { othersOn = true; break; }
            if (c.type === 'source_3p' && c.isOn && c.id !== this.genId) { othersOn = true; break; }
        }
        if (!othersOn) return;
        const sc = this.sys.comps[this.syncScopeId];
        if (!sc) return;
        let reason = '';
        // 1) 相位差越界（非同期并车）
        if (typeof sc._phaseDiff === 'number') {
            const deg = sc._phaseDiff * 180 / Math.PI;   // [0, 360)
            if (deg >= this.phaseMin && deg <= this.phaseMax) {
                reason = `相位差 ${Math.round(deg)}° 越界`;
            }
        }
        // 2) 频差越界（freqDiffMax<=0 时不检查）
        if (!reason && this.freqDiffMax > 0
            && typeof sc._fGen === 'number' && typeof sc._fBus === 'number') {
            const df = sc._fGen - sc._fBus;
            if (Math.abs(df) > this.freqDiffMax) {
                reason = `频差 ${df.toFixed(2)}Hz 越限（允许 ±${this.freqDiffMax}Hz）`;
            }
        }
        if (reason) this._tripAllBreakers(reason);
    }

    /**
     * 全船跳闸保护动作：所有合闸主开关自动分闸（跳闸）。
     * 注意：发电机不停机——频差/相位差过大并车只切除主回路，
     * 原动机仍在运行（空载），可重新调速后再次并车。
     */
    _tripAllBreakers(reason) {
        const sys = this.sys;
        if (!sys || !sys.comps) return;
        const openList = [];
        for (const id in sys.comps) {
            const c = sys.comps[id];
            if (!c) continue;
            // 只跳闸"发电机主开关"（带 genId 的 MarineMainsSwitch）。
            // 不能按 type==='ACB' 全匹配——会把负载/母联开关（如 acb_l）一并分闸，
            // 导致跳闸后照明负载支路离线，即使重新合闸母线也带不起灯。
            if (c.type === 'ACB' && c.genId && c._state === 'on') openList.push(c);
        }
        openList.forEach(t => { t._startAnim('open'); });
        if (typeof console !== 'undefined') {
            console.warn(`[并车保护] ${reason}，触发全船主开关跳闸（发电机保持运行）`);
        }
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
        // 失压线圈吸合判定（滞回）；先处理故障状态
        // 断线：线圈无电流（电阻无穷大）→ 通电无法吸合
        if (this._faultUVCoilOpen) this._coilI.uv = 0;
        if (this._faultShuntCoilOpen) this._coilI.fl = 0; // 分励线圈断线：无电流，无法电动分闸
        if (this._faultUVStuck) {
            // 衔铁结构卡死：通电无法吸合、手动按压也无法吸合
            this._uvOn = false;
        } else if (this._uvPressed) {
            // 手动按下动衔铁 → 强制吸合（无视反作用弹簧弹力）
            this._uvOn = true;
        } else if (this._faultUVSpring) {
            // 反作用弹簧弹力过大：通电无法吸合（仅手动按压可吸合）
            this._uvOn = false;
        } else if (this._faultUVCoilOpen) {
            // 线圈断线：通电无法吸合
            this._uvOn = false;
        } else {
            if (!this._uvOn && this._coilI.uv >= this._pickupI.uv) this._uvOn = true;
            else if (this._uvOn && this._coilI.uv < this._dropoutI.uv) this._uvOn = false;
        }
    }

    _logic(dt) {
        // 合闸状态下：失压失电 / 分励通电 / 电子脱扣通电 → 跳闸
        if (this._state === 'on') {
            if (!this._uvOn) { this.tryTrip(); return; }
            // 分励脱扣器不动作故障：线圈得电也不联动脱扣，跳闸失效
            if (!this._faultShuntNoAct && this._coilI.fl >= this._pickupI.fl) { this.tryTrip(); return; }
            if (this._coilI.et >= this._pickupI.et) { this.tryTrip(); return; }
            // 脱扣机构老化：处于振动状态即武装 30~60s 随机延迟倒计时，到时脱扣
            // （倒计时归零后若 tryTrip 暂时失败，下一帧会重新武装，直到真正跳闸）
            if (this._faultTripAging && this._vibrating && this._agingDelay <= 0) {
                this._agingDelay = 30 + Math.random() * 30;
            }
            if (this._agingDelay > 0) {
                this._agingDelay -= dt;
                if (this._agingDelay <= 0) {
                    this._agingDelay = 0;
                    this.tryTrip();
                }
            }
            // ── 逆功率保护 ──
            // 本机发电机原动机故障拖转（_primeTrip）且输出逆功率超定值 → 延时跳闸。
            // 其它情况下（含低频并车显示逆功率，物理 _pwr 仍为正）不触发、不累计。
            const gen = (this.genId && this.sys && this.sys.comps) ? this.sys.comps[this.genId] : null;
            if (gen && gen._primeTrip && gen._pwr < -this.revPowerKw) {
                this._revTimer += dt;
                if (this._revTimer >= this.revTime) {
                    this._revTimer = 0;
                    this._revTrip = true;
                    this.tryTrip();
                    if (typeof console !== 'undefined') {
                        console.warn(`[逆功率保护] ${this.id} 逆功率 ${Math.abs(gen._pwr).toFixed(1)}kW 持续 ${this.revTime}s，跳闸`);
                    }
                }
            } else {
                this._revTimer = 0;
            }
        }
        // 储能电机通电 → 自动储能（储能弹簧损坏则无法储能）
        if (!this._faultStoreSpring && this._coilI.m >= this._pickupI.m && this._chargeProg < 5) {
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

        // 振动：持续振动状态，每约 3s 产生一两个小幅晃动脉冲
        if (this._vibrating) {
            if (this._vibPulseT <= 0) {
                // 开始一个新的振动脉冲（一两个小幅晃动，约 0.3s）
                this._vibPhase = 0;
                this._vibPulseT = 10 + Math.random() * 0.5; // 脉冲间隔 10~10.5s
            }
            this._vibPulseT -= dt;
            this._vibPhase += dt;
            const t = this._vibPhase;
            // 前 0.3s 内做一两个小幅晃动（正弦包络 0→1→0），之后归于静止等待下一脉冲
            const env = t < 0.3 ? Math.sin(t / 0.3 * Math.PI) : 0;
            const a = 1.8 * env;
            const dx = Math.sin(t * 30) * a; // 0.3s 内约 1.4 圈 → 一两个完整晃动
            const dy = Math.cos(t * 26) * a;
            this.group.offset({ x: dx, y: dy });
        } else {
            this.group.offset({ x: 0, y: 0 });
        }

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
                        // 自动同期：满足同期条件时先对齐待并机相位/频率/电压，
                        // 消除合闸冲击电流；非同期合闸不对齐，走下方保护跳闸。
                        this._autoSyncIncoming();
                        // 并联合闸瞬间检查相位差：非同期（相位差越界）立即触发全船跳闸
                        this._checkOutOfSyncClose();
                        // 重新合闸视为新会话：逆功率保护动作标记复位
                        this._revTrip = false;
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
                    this._revTimer = 0; // 分闸清除逆功率计时
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
            // 脱扣轴稳态：失压失磁 / 分励通电 / 电子脱扣通电 保持脱扣位；手动分闸按住时机械推动到更大的脱扣角，松开复位
            let tTarget;
            if (this._faultTripShaftStuck) {
                // 脱扣轴卡死：轴无法转动，恒保持原位
                tTarget = 0;
            } else {
                const tHoldTrip = !this._uvOn
                    || (!this._faultShuntNoAct && this._coilI.fl >= this._pickupI.fl)
                    || this._coilI.et >= this._pickupI.et;
                const tBase = tHoldTrip ? this._tripPushAng : 0;
                tTarget = this._tripPressed ? this._tripButtonAng : tBase;
            }
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
            { label: '对应发电机 ID（并车保护用）', key: 'genId', type: 'text' },
            { label: '控制回路额定电压 (V)', key: 'ratedCtrlVoltage',   type: 'number' },
            { label: '初始状态 on/off',    key: 'initState',          type: 'text' },
            { label: '初始储能 on/off',    key: 'initCharge',         type: 'text' },
            { label: '初始工作位 connected/test/disconnected', key: 'initWorkPos', type: 'text' },
            { label: '动作时间 (s)',        key: 'animDur',            type: 'number' },
            { label: '控制线圈电阻 (Ω)',    key: 'coilResistance',     type: 'number' },
            { label: '同步表 ID（非同期保护，留空不启用）', key: 'syncScopeId', type: 'text' },
            { label: '非同期相位差下界 (°)', key: 'phaseMin',          type: 'number' },
            { label: '非同期相位差上界 (°)', key: 'phaseMax',          type: 'number' },
            { label: '允许最大频差 (Hz)，0=不启用', key: 'freqDiffMax', type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label            !== undefined) this.label            = cfg.label;
        if (cfg.ratedCtrlVoltage !== undefined) { this.ratedCtrlVoltage = parseFloat(cfg.ratedCtrlVoltage); this._recalcCurrentThresholds(); }
        if (cfg.animDur          !== undefined) this._animDur         = parseFloat(cfg.animDur);
        if (cfg.coilResistance   !== undefined) { this._coilResistance = parseFloat(cfg.coilResistance); this._coilR = { m1: this._coilResistance, c1: this._coilResistance, uv1: this._coilResistance, et1: this._coilResistance }; this._coilOhm = { m: this._coilResistance, c: this._coilResistance, uv: this._coilResistance, et: this._coilResistance, fl: this._tripCoilR }; this._recalcCurrentThresholds(); }
        if (cfg.syncScopeId  !== undefined) this.syncScopeId = String(cfg.syncScopeId);
        if (cfg.phaseMin     !== undefined) this.phaseMin = parseFloat(cfg.phaseMin);
        if (cfg.phaseMax     !== undefined) this.phaseMax = parseFloat(cfg.phaseMax);
        if (cfg.freqDiffMax  !== undefined) this.freqDiffMax = parseFloat(cfg.freqDiffMax);
        if (cfg.uvCoilR         !== undefined) { this._uvCoilR = parseFloat(cfg.uvCoilR); this._recalcCurrentThresholds(); }
        this._applyCoilR(); // 失压/合闸/储能电机的独立电阻（标称值或断线无穷大）
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
