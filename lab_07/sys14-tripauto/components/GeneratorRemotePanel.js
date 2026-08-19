import { BaseComponent } from './BaseComponent.js';

/**
 * GeneratorRemotePanel 发电机组遥控面板
 * 尺寸 205×288，单面板。
 * 自上而下：
 *  - 3 行 LCD（线电压/频率、电流/有功功率、功率因数）
 *  - 主开关遥控圆形带灯按钮（CLOSE 合闸 / OPEN 分闸，灯占整个圆面）
 *  - 发电机操作：START/STOP 圆钮 + RUNNING 运行灯 + 调速旋钮
 *
 * 端口：
 *  - 上侧：open_a/open_b（分闸指令）、close_a/close_b（合闸指令）
 *  - 左侧：start_a/start_b（遥控起动）、stop_a/stop_b（遥控停止）、spd_p/spd_n（调速输出）
 *  - 下侧：p24_p/p24_n（24V 电源输入）
 *
 * 求解器类型 gen_remote_panel：
 *  - START/STOP 按住时内部短接 start/stop 端口对（拓扑 union）
 *  - 面板通电（p24 电压 >1V 连续 3 帧）后：
 *      调速电压源 spd_p→spd_n = -1/0/+1V（旋钮减速/中立/加速）
 *      合闸按下时 close_a→close_b 输出 24V；分闸按下时 open_a→open_b 输出 24V
 *  - LCD 直接读取 gen 组件（sys.comps[genId]）状态
 */

const PANEL_W = 210;   // 面板宽
const PANEL_H = 240;   // 组件高

export class GeneratorRemotePanel extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(180, config.width  || PANEL_W);
        this.height = Math.max(180, config.height || PANEL_H);

        this.type    = 'gen_remote_panel';
        this.special = 'RemoteGenPanel';
        this.cache   = 'fixed';

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        this.config = {
            id: this.id,
            label: this.label,
            genId: this.genId,
            qfId:  this.qfId,
        };

        this._addPanelPorts();
    }

    // ═══════════════════════════════════════════
    // 几何计算
    // ═══════════════════════════════════════════

    _recalcGeometry() {
        // LCD：y=16 起，3 行
        this._lcd = { x: 8, y: 30, w: PANEL_W - 16, h: 58 };
        this._lcdRows = [34, 52, 70];

        // 三排控件中心：排1 合闸/分闸，排2 起动/停止，排3 运行灯+READY灯/调速旋钮
        this._btnClose = { x: 58,  y: 112,  r: 17 };
        this._btnOpen  = { x: 152, y: 112,  r: 17 };
        this._btnStart = { x: 58,  y: 155, r: 17 };
        this._btnStop  = { x: 152, y: 155, r: 17 };
        // 运行灯（原半径 17，按需求缩小为原来的一半 → r 8.5），其右侧并列 READY FOR START 灯（同样大小）
        this._runLed   = { x: 54,  y: 199, r: 8.5 };
        this._readyLed = { x: 96,  y: 199, r: 8.5 };
        this._knob     = { x: 152, y: 199, r: 17 };

        // 端口坐标（顶部 close 端口位于合闸按钮上方，open 端口位于分闸按钮上方）
        this._topPorts = { close_a: 30, close_b: 70, open_a: 115, open_b: 155 };
        // 左端口三组分别对齐三排按钮
        this._leftPorts = { start_a: 100, start_b: 120, stop_a: 150, stop_b: 170, spd_p: 200, spd_n: 220 };
        // 底部电源端口居中
        this._bottomPorts = { p24_p: 85, p24_n: 125 };
        // 右侧通信端口（与船舶电站自动控制模块的接口）
        this._rightPorts = { com_a: 100, com_b: 150 };
    }

    // ═══════════════════════════════════════════
    // 参数初始化
    // ═══════════════════════════════════════════

    _initParameters(config) {
        this.label    = config.label || '发电机组遥控面板';
        this.function = '发电机组遥控面板';

        this.genId = config.genId !== undefined ? config.genId : '';
        this.qfId  = config.qfId  !== undefined ? config.qfId  : '';

        // ── 合闸联锁条件配置（不配置则保持无条件合闸，兼容旧工程）──
        // busId     ：汇流排组件 id（用于判断"电网是否有电"，如 'bus1'；空则不启用联锁）
        // syncSelId ：同步表选择开关组件 id（如 'sync_sel'）
        // selPos    ：本机在同步表选择开关上的档位（1~4），如 1号机=2、2号机=3
        this.busId    = config.busId    || '';
        this.syncSelId = config.syncSelId || '';
        this.selPos   = parseInt(config.selPos) || 0;
        // 合闸允许标志（tick 中更新）：false 时手动/通信合闸指令均不输出
        this._closePermit = true;
        // 电网"有电"滑窗峰值检测：瞬时值会周期性过零，不能用单帧瞬时值判断；
        // 记录采样峰值，仅当连续多帧大幅低于峰值才视为电网掉电（峰值归零重判）
        this._busLivePeak = 0;   // 汇流排电压采样峰值（绝对值）
        this._busDeadFrames = 0; // 连续低于峰值的帧数

        // 供电状态：p24 电压 >1V 连续 3 帧才认为有电
        this._powered = false;
        this._powerTimer = 0;

        // 操作状态（用户手动交互）
        this._userStartPressed = false;
        this._userStopPressed  = false;
        this._userClosePressed = false;
        this._userOpenPressed  = false;
        this._userSpdVolt      = 0;
        this._openPressedPrev  = false;   // 分闸按钮边沿检测（按压瞬间冻结解列前快照）

        // 合闸按钮按压动作检测：无论联锁是否放行，按下"合闸"按钮即计数。
        // 教学流程用（如"联锁封锁"步骤须先产生合闸动作才能通过）。
        this._closeAttempts       = 0;     // 合闸按钮按压次数（自上次复位起）
        this._userClosePressedPrev = false; // 上一帧按压状态（检测 false→true 边沿）

        // 实际控制状态（tick 中由手动状态与通信命令合成）
        this._startPressed = false;
        this._stopPressed  = false;
        this._closePressed = false;
        this._openPressed  = false;
        this._spdVolt      = 0;

        // 自动控制模块通信命令（经右侧 com_a/com_b 通信端口下发）
        this._commCmd = null;

        // LCD 采样（求解迭代变化时才刷新）
        this._lastSolverIter = undefined;
        this._sample = null;   // { on, lineV, freq, I, P, cos, qfOn }
    }

    // ═══════════════════════════════════════════
    // 初始化
    // ═══════════════════════════════════════════

    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
        // READY FOR START 指示灯可点击部件（教学流程 find 步骤"点击该灯即可跳过"）
        this.addClickablePart('ready-led', this._readyLed.x - 12, this._readyLed.y - 12, 24, 24);
    }

    // ═══════════════════════════════════════════
    // 静态部件
    // ═══════════════════════════════════════════

    _drawStaticParts() {
        const s = this._staticGroup;

        // 面板（浅灰蓝底 + 深描边）
        s.add(new Konva.Rect({
            x: 0, y: 0, width: PANEL_W, height: this.height,
            fill: '#e8eef4', stroke: '#1a252f', strokeWidth: 1, cornerRadius: 3,
        }));
        s.add(new Konva.Rect({
            x: 3, y: 3, width: PANEL_W - 6, height: this.height - 6,
            fill: '#dfe7ee', cornerRadius: 2, stroke: '#5a6a75', strokeWidth: 1,
        }));
        // 标题
        s.add(new Konva.Text({
            x: 0, y: 12, width: PANEL_W, align: 'center',
            text: this.label, fontSize: 16, fontStyle: 'bold', fill: '#1a252f',
        }));
        // LCD 黑底
        s.add(new Konva.Rect({
            x: this._lcd.x, y: this._lcd.y,
            width: this._lcd.w, height: this._lcd.h,
            fill: '#0a0e12', cornerRadius: 2, stroke: '#3a4a55', strokeWidth: 1,
        }));
        // 合闸/分闸 圆形按钮底盘
        [this._btnClose, this._btnOpen].forEach(b => {
            s.add(new Konva.Circle({ x: b.x, y: b.y, radius: b.r + 3, fill: '#cdd8e0', stroke: '#5a6a75', strokeWidth: 1 }));
        });
        // START / STOP 圆钮底盘
        [this._btnStart, this._btnStop].forEach(b => {
            s.add(new Konva.Circle({ x: b.x, y: b.y, radius: b.r + 3, fill: '#cdd8e0', stroke: '#5a6a75', strokeWidth: 1 }));
        });
        // RUNNING 运行灯底盘
        s.add(new Konva.Circle({ x: this._runLed.x, y: this._runLed.y, radius: this._runLed.r + 4, fill: '#cdd8e0', stroke: '#5a6a75', strokeWidth: 1 }));
        s.add(new Konva.Text({ x: this._runLed.x - 15, y: this._runLed.y + this._runLed.r + 6, width: 30, align: 'center', text: '运行', fontSize: 12, fontStyle: 'bold', fill: '#1a252f' }));
        // READY FOR START 指示灯底盘（运行灯右侧，与运行灯同大小）
        s.add(new Konva.Circle({ x: this._readyLed.x, y: this._readyLed.y, radius: this._readyLed.r + 4, fill: '#cdd8e0', stroke: '#5a6a75', strokeWidth: 1 }));
        s.add(new Konva.Text({ x: this._readyLed.x - 40, y: this._readyLed.y + this._readyLed.r - 40, width: 80, align: 'center', text: 'READY FOR', fontSize: 10, fontStyle: 'bold', fill: '#1a252f' }));
        s.add(new Konva.Text({ x: this._readyLed.x - 27, y: this._readyLed.y + this._readyLed.r - 30, width: 54, align: 'center', text: 'START', fontSize: 10, fontStyle: 'bold', fill: '#1a252f' }));
        // 调速旋钮底盘
        s.add(new Konva.Circle({ x: this._knob.x, y: this._knob.y, radius: this._knob.r + 3, fill: '#cfd8df', stroke: '#5a6a75', strokeWidth: 1 }));
        s.add(new Konva.Text({ x: this._knob.x - 26, y: this._knob.y + this._knob.r + 4, width: 52, align: 'center', text: '调速', fontSize: 11, fill: '#333' }));
        // 顶部端口标注（面板外上方，合闸/分闸端口对各自居中）
        s.add(new Konva.Text({ x: 41, y: -10, width: 24, align: 'center', text: '合闸', fontSize: 11, fontStyle: 'bold', fill: '#1a252f' }));
        s.add(new Konva.Text({ x: 126, y: -10, width: 24, align: 'center', text: '分闸', fontSize: 11, fontStyle: 'bold', fill: '#1a252f' }));
        // 左侧端口标签
        s.add(new Konva.Text({ x: 10, y: this._leftPorts.start_a + 4, text: '起动', fontSize: 11, fill: '#5a6a75' }));
        s.add(new Konva.Text({ x: 10, y: this._leftPorts.stop_a+ 4, text: '停止', fontSize: 11, fill: '#5a6a75' }));
        s.add(new Konva.Text({ x: 10, y: this._leftPorts.spd_p + 4, text: '调速', fontSize: 12, fill: '#5a6a75' }));
        // 底部电源标签（居中于两个电源端口之间）
        s.add(new Konva.Text({ x: 94, y: this.height - 16, text: '电源', fontSize: 11, fill: '#5a6a75' }));
        // 右侧通信端口标注（面板外右侧，垂直居中）
        s.add(new Konva.Text({ x: PANEL_W - 20, y: 113, width: 18, align: 'center', text: '通', fontSize: 12, fontStyle: 'bold', fill: '#1a252f' }));
        s.add(new Konva.Text({ x: PANEL_W - 20, y: 128, width: 18, align: 'center', text: '信', fontSize: 12, fontStyle: 'bold', fill: '#1a252f' }));
        if (this.cache === 'fixed') {
            try {
                const r = this._staticGroup.getClientRect({ relativeTo: this._staticGroup });
                if (r && r.width > 0 && r.height > 0) {
                    this._staticGroup.cache({
                        x: r.x, y: r.y, width: Math.ceil(r.width), height: Math.ceil(r.height),
                    });
                }
            } catch (e) { /* ignore */ }
        }
    }

    // ═══════════════════════════════════════════
    // 动态节点
    // ═══════════════════════════════════════════

    _createDynamicNodes() {
        this._ui = this._createUI();
    }

    _createUI() {
        const d = this._dynamicGroup;
        const ui = {};

        // LCD 3 行文字
        const mkLcd = (y) => {
            const t = new Konva.Text({
                x: this._lcd.x + 6, y, fontSize: 14,
                fontFamily: 'monospace', fontStyle: 'bold',
                fill: '#00ff88', text: '',
            });
            d.add(t);
            return t;
        };
        ui.lcd = this._lcdRows.map(mkLcd);

        // CLOSE / OPEN 圆形带灯按钮（灯 = 整圆）
        ui.closeFace = this._mkCircleBtn(d, this._btnClose, '合闸', '#1d8a4e', '#166a3a', '#2ecc71');
        ui.openFace  = this._mkCircleBtn(d, this._btnOpen, '分闸', '#922b21', '#7a1f18', '#e74c3c');

        // START / STOP 圆钮
        ui.startFace = this._mkCircleBtn(d, this._btnStart, '起动', '#2e7d32', '#1d5f26');
        ui.stopFace  = this._mkCircleBtn(d, this._btnStop, '停止', '#922b21', '#7a1f18');

        // RUNNING 运行灯（初始灰色，点亮后白色）
        const runLed = new Konva.Circle({ x: this._runLed.x, y: this._runLed.y, radius: this._runLed.r, fill: '#8a8a8a', stroke: '#222', strokeWidth: 1 });
        d.add(runLed);
        ui.runLed = runLed;

        // READY FOR START 指示灯（初始灰色，满足条件后点亮绿色）
        const readyLed = new Konva.Circle({ x: this._readyLed.x, y: this._readyLed.y, radius: this._readyLed.r, fill: '#8a8a8a', stroke: '#222', strokeWidth: 1 });
        d.add(readyLed);
        ui.readyLed = readyLed;

        // 调速旋钮（瞬时偏转回弹）
        const knobG = new Konva.Group({ x: this._knob.x, y: this._knob.y });
        const knobDisk = new Konva.Circle({ radius: this._knob.r, fill: '#7f8c8d', stroke: '#4a5a63', strokeWidth: 2 });
        const knobPtr = new Konva.Line({
            points: [0, 0, 0, -(this._knob.r - 3)], stroke: '#ffffff', strokeWidth: 2.5, lineCap: 'round',
        });
        knobG.add(knobDisk, knobPtr);
        d.add(knobG);
        ui.knobPtr = knobPtr;
        ui.knobDisk = knobDisk;

        // 交互绑定
        const hold = (node, onDown, onUp) => {
            node.on('mousedown touchstart', (e) => { e.cancelBubble = true; onDown(); });
            node.on('mouseup touchend mouseleave', () => { onUp(); });
        };
        // 部件标记：按下按钮时顺带记录 lastClickedPartId（供工作流 find 识别，不拦截交互）
        const mark = (partId) => {
            if (this.sys) {
                this.sys.lastClickedId = this.id;
                this.sys.lastClickedPartId = this.id + '/' + partId;
            }
        };
        hold(ui.closeFace.g, () => { this._userClosePressed = true; mark('btn-close'); }, () => { this._userClosePressed = false; });
        hold(ui.openFace.g,  () => { this._userOpenPressed = true;  mark('btn-open');  }, () => { this._userOpenPressed  = false; });
        hold(ui.startFace.g, () => { this._userStartPressed = true; mark('btn-start'); }, () => { this._userStartPressed = false; });
        hold(ui.stopFace.g,  () => { this._userStopPressed = true;  mark('btn-stop');  }, () => { this._userStopPressed  = false; });

        ui.knobDisk.on('mousedown touchstart', (e) => {
            e.cancelBubble = true;
            const pos = this.sys.stage.getPointerPosition();
            const abs = knobG.getAbsolutePosition();
            const dir = (pos && pos.x > abs.x) ? 1 : -1;
            this._userSpdVolt = dir;
            const onUp = () => {
                this._userSpdVolt = 0;
                window.removeEventListener('mouseup', onUp);
                window.removeEventListener('touchend', onUp);
            };
            window.addEventListener('mouseup', onUp);
            window.addEventListener('touchend', onUp);
        });

        return ui;
    }

    _mkCircleBtn(d, def, label, base, dark, lit) {
        const g = new Konva.Group({ x: def.x, y: def.y });
        const face = new Konva.Circle({
            radius: def.r, fill: base, stroke: '#1a252f', strokeWidth: 1,
        });
        const txt = new Konva.Text({
            x: -def.r, y: -def.r, width: def.r * 2, height: def.r * 2,
            align: 'center', verticalAlign: 'middle',
            text: label, fontSize: 12, fontStyle: 'bold', fill: '#ffffff',
        });
        g.add(face, txt);
        d.add(g);
        face._base = base;
        face._dark = dark;
        face._lit  = lit || base;
        return { g, face, txt, dark, lit: lit || base };
    }

    _bindInteraction() { /* 交互已在 _createUI 绑定 */ }

    _touchDirty() {
        this.markDirty();
        if (this.sys && typeof this.sys.requestRedraw === 'function') this.sys.requestRedraw();
    }

    // ═══════════════════════════════════════════
    // 端口
    // ═══════════════════════════════════════════

    _addPanelPorts() {
        const tp = this._topPorts, lp = this._leftPorts, bp = this._bottomPorts, rp = this._rightPorts;
        const h = this.height - 2;
        this.addPort(tp.open_a, 2, 'open_a',  'wire', 'p');
        this.addPort(tp.open_b, 2, 'open_b',  'wire');
        this.addPort(tp.close_a, 2, 'close_a', 'wire', 'p');
        this.addPort(tp.close_b, 2, 'close_b', 'wire');
        this.addPort(2, lp.start_a, 'start_a', 'wire');
        this.addPort(2, lp.start_b, 'start_b', 'wire');
        this.addPort(2, lp.stop_a, 'stop_a', 'wire');
        this.addPort(2, lp.stop_b, 'stop_b', 'wire');
        this.addPort(2, lp.spd_p, 'spd_p', 'wire', 'p');
        this.addPort(2, lp.spd_n, 'spd_n', 'wire', 'n');
        this.addPort(bp.p24_p, h, 'p24_p', 'wire', 'p');
        this.addPort(bp.p24_n, h, 'p24_n', 'wire');
        this.addPort(PANEL_W - 2, rp.com_a, 'com_a', 'wire', 'p');
        this.addPort(PANEL_W - 2, rp.com_b, 'com_b', 'wire', 'n');
    }

    // ═══════════════════════════════════════════
    // 仿真主循环
    // ═══════════════════════════════════════════

    tick(dt) {
        // 合闸按钮按压边沿计数（false→true 记为一次按压动作）
        if (this._userClosePressed && !this._userClosePressedPrev) this._closeAttempts++;
        this._userClosePressedPrev = this._userClosePressed;

        this._sensePower();
        this._synthesizeCommand();
        // 分闸按钮按压瞬间：冻结关联发电机及其并联伙伴的"解列前"显示状态，
        // 供 SyncGenerator3P 解列分支做等效设定复位（避免断线过渡帧污染基准）。
        if (this._openPressed && !this._openPressedPrev) {
            const g = (this.genId && this.sys && this.sys.comps) ? this.sys.comps[this.genId] : null;
            if (g && typeof g.freezeDecouple === 'function') g.freezeDecouple();
        }
        this._openPressedPrev = this._openPressed;
        this._sampleGen();
        this._updateLCD();
        this._updateButtons();
        this._updateKnobs();
        this.markDirty();
        if (this.sys && typeof this.sys.requestRedraw === 'function') this.sys.requestRedraw();
    }

    // 由手动状态与自动控制模块通信命令合成实际控制状态（手动优先）
    _synthesizeCommand() {
        const c = this._commCmd;
        this._startPressed = this._userStartPressed || c === 'start';
        this._stopPressed  = this._userStopPressed  || c === 'stop';
        // 合闸联锁：允许 = 电网无电（直接允许） ∨ 电网有电且同步表选择开关在本机档位
        this._closePermit  = this._calcClosePermit();
        this._closePressed = this._closePermit && (this._userClosePressed || c === 'close');
        this._openPressed  = this._userOpenPressed  || c === 'open';
        if (this._userSpdVolt !== 0) {
            this._spdVolt = this._userSpdVolt;
        } else if (c === 'spd-inc') {
            this._spdVolt = 1;
        } else if (c === 'spd-dec') {
            this._spdVolt = -1;
        } else if (c === 'spd-inc-slow') {
            this._spdVolt = 0.3;
        } else if (c === 'spd-dec-slow') {
            this._spdVolt = -0.3;
        } else {
            this._spdVolt = 0;
        }
    }

    // ── 合闸联锁辅助 ────────────────────────────────────────────
    // 电网是否有电：汇流排线电压滑窗峰值超过阈值（>120V，380V 系统正常瞬时峰值约 600V）
    // 视为有电。未配置 busId 时视为"无电"（不联锁，保持无条件合闸）。
    //
    // 采用滑窗峰值而非单帧瞬时值：50Hz 正弦线电压瞬时值周期性过零，
    // 若用单帧判断，用户长按合闸时会撞上瞬时 <100V 的帧导致联锁被短暂绕过。
    _busPowered() {
        if (!this.busId || !this.sys || !this.sys.getVoltageBetween) return false;
        const p1 = `${this.busId}_wire_l1_1`, p2 = `${this.busId}_wire_l2_1`;
        try {
            const v = this.sys.getVoltageBetween(p1, p2);
            if (typeof v === 'number' && isFinite(v)) {
                const a = Math.abs(v);
                if (a > this._busLivePeak * 0.15) {
                    // 采样幅值与峰值同量级 → 电网仍在正常供电（过零帧很快回升）
                    this._busDeadFrames = 0;
                } else {
                    this._busDeadFrames++;
                }
                if (a > this._busLivePeak) this._busLivePeak = a;
                // 连续约 0.4s（8 帧）采样均大幅低于峰值 → 电网已掉电，峰值归零重新判断
                if (this._busDeadFrames > 8) {
                    this._busLivePeak = 0;
                    this._busDeadFrames = 0;
                }
                return this._busLivePeak > 120;
            }
        } catch (e) { /* ignore */ }
        return false;
    }

    // 同步表选择开关当前档位（1~4）；未配置 syncSelId 返回 0
    _syncSelector() {
        if (!this.syncSelId || !this.sys || !this.sys.comps) return 0;
        const sel = this.sys.comps[this.syncSelId];
        if (sel && typeof sel.getPosition === 'function') return sel.getPosition();
        return 0;
    }

    // 合闸允许条件
    _calcClosePermit() {
        // 未配置联锁（无 busId 或 selPos）→ 始终允许（兼容旧工程）
        if (!this.busId || !this.selPos) return true;
        // 电网无电 → 允许（无需选择开关）
        if (!this._busPowered()) return true;
        // 电网有电 → 必须同步表选择开关转到本机编号档位
        return this._syncSelector() === this.selPos;
    }

    _sensePower() {
        const solver = this.sys && this.sys.voltageSolver;
        if (!solver) return;
        const v = this.sys.getVoltageBetween(`${this.id}_wire_p24_p`, `${this.id}_wire_p24_n`);
        if (v !== undefined && isFinite(v) && v > 1) {
            this._powerTimer = Math.min(3, this._powerTimer + 1);
        } else {
            this._powerTimer = 0;
        }
        this._powered = this._powerTimer >= 3;
    }

    _sampleGen() {
        const solver = this.sys && this.sys.voltageSolver;
        if (!solver || solver.globalIterCount === this._lastSolverIter) return;
        this._lastSolverIter = solver.globalIterCount;
        this._sample = this._snapshot(this.genId, this.qfId);
    }

    // 直接读取发电机显示参数（与发电机本体 LCD 同源同值），保证两处显示一致
    _snapshot(genId, qfId) {
        const gen = genId && this.sys.comps[genId] ? this.sys.comps[genId] : null;
        if (!gen) return null;
        // 优先使用发电机统一接口（电压采用实测端子电压、含功率因数），与本体 LCD 数据源一致
        let s = null;
        if (typeof gen.getDisplayParams === 'function') {
            s = gen.getDisplayParams();
        } else {
            // 后备兼容：未实现 getDisplayParams 的老发电机，按设定值读取
            s = {
                on:    !!gen.isOn,
                lineV: gen.getLineVoltage ? gen.getLineVoltage() : 0,
                freq:  (gen._freqOut ?? gen.freq) || 0,
                I:     gen._rmsI || 0,
                P:     gen._pwr || 0,
                cos:   gen._rmsI > 0 ? Math.min(1, Math.max(-1, (gen._pwr * 1000) / (Math.sqrt(3) * (s && s.lineV || 1) * gen._rmsI))) : 0,
            };
        }
        s = { ...s };
        const qf = qfId && this.sys.comps[qfId] ? this.sys.comps[qfId] : null;
        if (qf && typeof qf._state === 'string') s.qfOn = qf._state === 'on';
        return s;
    }

    _lcdLines(s) {
        if (!s) return ['--', '--', '--'];
        if (!s.on) return ['V--  F--', 'I--  P--', 'COS--'];
        return [
            `V ${s.lineV.toFixed(1)}V  F ${s.freq.toFixed(1)}Hz`,
            `I ${s.I > 100 ? s.I.toFixed(0) : s.I.toFixed(1)}A  P ${s.P > 100 ? s.P.toFixed(0) : s.P.toFixed(1)}kW`,
            `COSφ ${s.cos.toFixed(2)}`,
        ];
    }

    _updateLCD() {
        if (!this._ui) return;
        const lines = this._powered ? this._lcdLines(this._sample) : ['--', '--', '--'];
        this._ui.lcd.forEach((t, i) => t.text(lines[i]));
    }

    _updateButtons() {
        const ui = this._ui;
        if (!ui) return;
        const s = this._sample;
        const qfOn = s ? s.qfOn : null;
        // 合闸：未合闸暗绿，合闸亮绿（按下更暗）
        ui.closeFace.face.fill(this._closePressed ? ui.closeFace.face._dark : (qfOn ? ui.closeFace.face._lit : ui.closeFace.face._base));
        // 分闸：已运行未合闸亮红，其它情况暗红
        ui.openFace.face.fill(this._openPressed ? ui.openFace.face._dark : (s && s.on && qfOn === false ? ui.openFace.face._lit : ui.openFace.face._base));
        // 起动/停止：按下变暗
        ui.startFace.face.fill(this._startPressed ? ui.startFace.face._dark : ui.startFace.face._base);
        ui.stopFace.face.fill(this._stopPressed ? ui.stopFace.face._dark : ui.stopFace.face._base);
        // 运行灯：初始灰色，点亮后白色
        ui.runLed.fill(s && s.on ? '#ffffff' : '#8a8a8a');

        // READY FOR START 灯：面板 24V 供电正常 + 遥控位 + 无原动机故障（超速/滑油低压/水温高）+ 发电机未运行
        // 即"可以安全起动"状态；不供电、运行中或故障时熄灭（灰色）
        let ready = false;
        const gen = (this.genId && this.sys && this.sys.comps) ? this.sys.comps[this.genId] : null;
        if (gen && this._powered) {
            let f = null;
            if (typeof gen.getEngineFaults === 'function') f = gen.getEngineFaults();
            ready = gen.mode === 'remote' && !gen.isOn
                && (!f || (!f.overspeed && !f.oilPress && !f.coolantTemp));
        }
        ui.readyLed.fill(ready ? '#7dffb0' : '#8a8a8a');
    }

    _updateKnobs() {
        if (!this._ui || !this._ui.knobPtr) return;
        const ptr = this._ui.knobPtr;
        const target = this._spdVolt * 45;
        if (ptr._tw) ptr._tw.destroy();
        ptr._tw = new Konva.Tween({ node: ptr, rotation: target, duration: 0.12 });
        ptr._tw.play();
    }

    // ═══════════════════════════════════════════
    // 公开 API
    // ═══════════════════════════════════════════

    isPowered() { return this._powered; }
    getSpdVolt() { return this._spdVolt; }
    isStartPressed() { return this._startPressed; }
    isStopPressed()  { return this._stopPressed; }
    isClosePressed() { return this._closePressed; }
    isOpenPressed()  { return this._openPressed; }
    // 合闸是否被允许（供联锁条件检测 / 工作流 check 步骤使用）
    isClosePermitted() { return this._closePermit; }

    // 自动控制模块通信命令接口（经右侧 com_a/com_b 通信端口下发）
    setCommCmd(cmd) { this._commCmd = cmd || null; }
    getCommCmd()    { return this._commCmd; }

    getConfigFields() {
        return [
            { label: '发电机 ID', key: 'genId', type: 'text' },
            { label: '主开关 ID', key: 'qfId', type: 'text' },
            { label: '汇流排 ID（电网检测，留空不联锁）', key: 'busId', type: 'text' },
            { label: '同步表选择开关 ID', key: 'syncSelId', type: 'text' },
            { label: '本机档位（1~4）', key: 'selPos', type: 'number', min: 0, max: 4, step: 1 },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.genId !== undefined) this.genId = cfg.genId;
        if (cfg.qfId  !== undefined) this.qfId  = cfg.qfId;
        if (cfg.busId    !== undefined) this.busId    = cfg.busId;
        if (cfg.syncSelId !== undefined) this.syncSelId = cfg.syncSelId;
        if (cfg.selPos   !== undefined) this.selPos   = parseInt(cfg.selPos) || 0;
        this.config.genId = this.genId;
        this.config.qfId  = this.qfId;
        this.markDirty();
    }
}
