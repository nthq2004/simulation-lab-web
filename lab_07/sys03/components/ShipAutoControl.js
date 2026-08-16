import { BaseComponent } from './BaseComponent.js';

/**
 * ShipAutoControl 船舶电站自动控制模块
 * 尺寸 287×233，单面板。实现自动起动、自动并车、自动解列、自动调频。
 *
 * 面板布局：
 *  - 标题 + LCD 3 行（在网机组 / 总功率 / 母线电压·频率）
 *  - 状态指示灯：电源、自动模式、各机组运行
 *  - 左旋钮：手动 / 自动转换开关（左=-45°手动，右=+45°自动）
 *  - 右旋钮：备用机组顺序选择开关（左=-45°=1-2-3，右=+45°=2-1-3）
 *
 * 端口：
 *  - 上侧：bus_a / bus_b —— 汇流排采集接口（检测母线是否有电，用于失电自动起动）
 *  - 右侧：p24_p / p24_n —— 24V 电源输入（模块通电后才工作）
 *  - 下侧：comm1_a/comm1_b、comm2_a/comm2_b、comm3_a/comm3_b —— 与各发电机遥控面板的通信接口
 *
 * 控制对象：通过 units 配置关联各发电机（genId）、主开关（qfId）与遥控面板（panelId）。
 * 自动控制模块【不直接驱动发电机/主开关】，而是经通信命令控制遥控面板，
 * 由面板通过既有电气机制（端口短接/电压源）驱动机组：
 *  - 失电自动起动：母线失电时按备用顺序起动第一台机组，建压+储能后合闸
 *  - 自动并车：单机在网且负载超限时，按顺序起动下一台，同步后并入
 *  - 自动解列：多机在网且负载过低时，退出最后并入的机组
 *  - 自动调频：在线机组频率向 50Hz 调节
 */
const PANEL_W = 300;
const PANEL_H = 240;

export class ShipAutoControl extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(200, config.width  || PANEL_W);
        this.height = Math.max(200, config.height || PANEL_H);

        this.type    = 'auto_control';
        this.special = 'AutoControl';
        this.cache   = 'fixed';

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        this.config = {
            id: this.id,
            label:       this.label,
            genIds:      this.genIds.join(','),
            qfIds:       this.qfIds.join(','),
            panelIds:    this.panelIds.join(','),
            auto:        this._auto ? 'auto' : 'manual',
            seq:         this._seq,
            parallelKw:  this.parallelKw,
            decoupleKw:  this.decoupleKw,
        };

        this._addPorts();
    }

    // ═══════════════════════════════════════════
    // 几何计算
    // ═══════════════════════════════════════════

    _recalcGeometry() {
        // LCD：y=26 起，3 行
        this._lcd = { x: 5, y: 26, w: PANEL_W - 10, h: 70 };
        this._lcdRows = [30, 53, 76];

        // 指示灯行（LCD 下方），指示灯大小恢复原尺寸（r=7）
        this._leds = {
            pwr:   { x: 30,  y: 110, r: 7 },
            auto:  { x: 73, y: 110, r: 7 },
            unit1: { x: 116, y: 110, r: 7 },
            unit2: { x: 159, y: 110, r: 7 },
            unit3: { x: 202, y: 110, r: 7 },
        };

        // 两个转换开关旋钮，旋钮大小恢复原尺寸（r=23）
        this._knobMode = { x: 93, y: 170, r: 23 };
        this._knobSeq  = { x: 193, y: 170, r: 23 };

        // 端口坐标
        this._topPorts  = { bus_a: 110, bus_b: 170 };
        this._rightPorts = { p24_p: 100, p24_n: 140 };
        this._bottomPorts = [30, 71, 112, 153, 194, 235];
    }

    // ═══════════════════════════════════════════
    // 参数初始化
    // ═══════════════════════════════════════════

    _initParameters(config) {
        this.label    = config.label || '船舶电站自动控制模块';
        this.function = '船舶电站自动控制模块';

        const genList = String(config.genIds || 'gen1,gen2,gen3').split(',').map(s => s.trim()).filter(Boolean);
        const qfList  = String(config.qfIds  || 'qf1,qf2,qf3').split(',').map(s => s.trim()).filter(Boolean);
        this.genIds = genList;
        this.qfIds  = qfList;
        this.panelIds = String(config.panelIds || '').split(',').map(s => s.trim()).filter(Boolean);

        // 手动/自动
        this._auto = String(config.auto || 'manual') === 'auto';
        // 备用机组顺序：'123' 或 '213'
        this._seq  = String(config.seq || '123') === '213' ? '213' : '123';

        // 并车/解列负载阈值（单机额定功率的百分比）
        this.parallelKw = parseFloat(config.parallelKw) || 80;   // 并车：负载 > 单机额定 80%
        this.decoupleKw = parseFloat(config.decoupleKw) || 30;   // 解列：负载 < 单机额定 30%

        // 供电状态：p24 电压 >1V 连续 3 帧才认为有电
        this._powered    = false;
        this._powerTimer = 0;

        // 母线采集
        this._busPeak    = 0;
        this._busPortLive = false;

        // 控制计时器
        this._startTimer   = {};
        this._syncTimer    = {};
        this._decoupleTimer = 0;   // 低负载累计延时（20s 后解列）
        this._stopTimer     = 0;   // 解列后停机延时（30s 后停机）
        this._decoupleIdx  = -1;   // 正在解列的机组索引（-1 表示无）

        // LCD 采样
        this._sample = { online: [], p: 0, live: false, lineV: 0, freq: 0 };
    }

    // ═══════════════════════════════════════════
    // 初始化
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
            x: 0, y: 10, width: PANEL_W, align: 'center',
            text: '船舶电站自动控制模块', fontSize: 15, fontStyle: 'bold', fill: '#1a252f',
        }));
        // LCD 黑底
        s.add(new Konva.Rect({
            x: this._lcd.x, y: this._lcd.y,
            width: this._lcd.w, height: this._lcd.h,
            fill: '#0a0e12', cornerRadius: 2, stroke: '#3a4a55', strokeWidth: 1,
        }));
        // 指示灯底盘 + 标签（大小恢复原尺寸：底盘 r=10，标签 10px）
        const ledLabels = [
            ['电源', 30], ['自动', 73], ['1#', 116], ['2#', 159], ['3#', 202],
        ];
        ledLabels.forEach(([txt, x]) => {
            s.add(new Konva.Circle({ x, y: this._leds.pwr.y, radius: 10, fill: '#cdd8e0', stroke: '#5a6a75', strokeWidth: 1 }));
            s.add(new Konva.Text({ x: x - 16, y: this._leds.pwr.y + 12, width: 32, align: 'center', text: txt, fontSize: 12, fill: '#333' }));
        });
        // 旋钮底盘
        [this._knobMode, this._knobSeq].forEach(k => {
            s.add(new Konva.Circle({ x: k.x, y: k.y, radius: k.r + 3, fill: '#cfd8df', stroke: '#5a6a75', strokeWidth: 1 }));
        });
        // 旋钮标签（宽度保持，避免两标签重叠）
        s.add(new Konva.Text({ x: this._knobMode.x - 45, y: this._knobMode.y + this._knobMode.r + 4, width: 90, align: 'center', text: '手动← →自动', fontSize: 12, fontStyle: 'bold', fill: '#1a252f' }));
        s.add(new Konva.Text({ x: this._knobSeq.x - 45, y: this._knobSeq.y + this._knobSeq.r + 4, width: 90, align: 'center', text: '顺序1-2-3/2-1-3', fontSize: 12, fontStyle: 'bold', fill: '#1a252f' }));

        // 端口标注（均置于端口上方）
        s.add(new Konva.Text({ x: 115, y: -14, width: 50, align: 'center', text: '母线采集', fontSize: 12, fontStyle: 'bold', fill: '#1a252f' }));
        s.add(new Konva.Text({ x: this.width - 22, y: 110, width: 20, align: 'center', text: '24V', fontSize: 12, fontStyle: 'bold', fill: '#1a252f' }));
        s.add(new Konva.Text({ x: 30, y: this.height - 18, width: PANEL_W - 60, align: 'center', text: '通信接口（至各遥控面板）', fontSize: 12, fill: '#5a6a75' }));

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
        const d = this._dynamicGroup;
        const ui = {};

        // LCD 3 行文字
        const mkLcd = (y) => {
            const t = new Konva.Text({
                x: this._lcd.x + 4, y, fontSize: 16,
                fontFamily: 'monospace', fontStyle: 'bold',
                fill: '#00ff88', text: '',
            });
            d.add(t);
            return t;
        };
        ui.lcd = this._lcdRows.map(mkLcd);

        // 指示灯
        ui.leds = {};
        Object.entries(this._leds).forEach(([k, v]) => {
            const c = new Konva.Circle({ x: v.x, y: v.y, radius: v.r, fill: '#8a8a8a', stroke: '#222', strokeWidth: 1 });
            d.add(c);
            ui.leds[k] = c;
        });

        // 手动/自动 旋钮
        const mkKnob = (x, y, r, initRot) => {
            const g = new Konva.Group({ x, y });
            const disk = new Konva.Circle({ radius: r, fill: '#7f8c8d', stroke: '#4a5a63', strokeWidth: 2 });
            const ptr = new Konva.Line({
                points: [0, 0, 0, -(r - 3)], stroke: '#ffffff', strokeWidth: 3, lineCap: 'round',
            });
            ptr.rotation(initRot);
            g.add(disk, ptr);
            d.add(g);
            return { g, disk, ptr };
        };
        ui.knobMode = mkKnob(this._knobMode.x, this._knobMode.y, this._knobMode.r, this._auto ? 45 : -45);
        ui.knobSeq  = mkKnob(this._knobSeq.x, this._knobSeq.y, this._knobSeq.r, this._seq === '213' ? 45 : -45);

        this._ui = ui;
    }

    // ═══════════════════════════════════════════
    // 交互绑定
    // ═══════════════════════════════════════════

    _bindInteraction() {
        // 手动/自动 转换开关：点击切换
        this._ui.knobMode.disk.on('click tap', (e) => {
            e.cancelBubble = true;
            this._auto = !this._auto;
            this.config.auto = this._auto ? 'auto' : 'manual';
            this._tweenKnob(this._ui.knobMode.ptr, this._auto ? 45 : -45);
        });

        // 备用机组顺序选择开关：点击切换 1-2-3 / 2-1-3
        this._ui.knobSeq.disk.on('click tap', (e) => {
            e.cancelBubble = true;
            this._seq = this._seq === '213' ? '123' : '213';
            this.config.seq = this._seq;
            this._tweenKnob(this._ui.knobSeq.ptr, this._seq === '213' ? 45 : -45);
        });
    }

    _tweenKnob(ptr, angle) {
        if (ptr._tw) ptr._tw.destroy();
        ptr._tw = new Konva.Tween({ node: ptr, rotation: angle, duration: 0.15 });
        ptr._tw.play();
    }

    _touchDirty() {
        this.markDirty();
        if (this.sys && typeof this.sys.requestRedraw === 'function') this.sys.requestRedraw();
    }

    // ═══════════════════════════════════════════
    // 端口
    // ═══════════════════════════════════════════

    _addPorts() {
        const tp = this._topPorts, rp = this._rightPorts;
        // 上侧：母线采集
        this.addPort(tp.bus_a, 2, 'bus_a', 'wire', 'p');
        this.addPort(tp.bus_b, 2, 'bus_b', 'wire');
        // 右侧：24V 电源
        this.addPort(this.width, rp.p24_p, 'p24_p', 'wire', 'p');
        this.addPort(this.width, rp.p24_n, 'p24_n', 'wire');
        // 下侧：3 个通信接口（每面板 2 线，左侧线为 'p'）
        const h = this.height;
        this.addPort(this._bottomPorts[0], h, 'comm1_a', 'wire', 'p');
        this.addPort(this._bottomPorts[1], h, 'comm1_b', 'wire');
        this.addPort(this._bottomPorts[2], h, 'comm2_a', 'wire', 'p');
        this.addPort(this._bottomPorts[3], h, 'comm2_b', 'wire');
        this.addPort(this._bottomPorts[4], h, 'comm3_a', 'wire', 'p');
        this.addPort(this._bottomPorts[5], h, 'comm3_b', 'wire');
    }

    // ═══════════════════════════════════════════
    // 仿真主循环
    // ═══════════════════════════════════════════

    tick(dt) {
        this._sensePower();
        this._senseBus();
        this._sampleUnits();
        this._autoControl(dt);
        this._updateLCD();
        this._updateLeds();
        this.markDirty();
        if (this.sys && typeof this.sys.requestRedraw === 'function') this.sys.requestRedraw();
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

    _senseBus() {
        const solver = this.sys && this.sys.voltageSolver;
        if (!solver) return;
        const v = this.sys.getVoltageBetween(`${this.id}_wire_bus_a`, `${this.id}_wire_bus_b`);
        if (v !== undefined && isFinite(v)) {
            this._busPeak = Math.max(this._busPeak * 0.85, Math.abs(v));
        } else {
            this._busPeak = 0;
        }
        this._busPortLive = this._busPeak > 60;
    }

    _getUnit(genId, qfId, panelId) {
        const gen = genId && this.sys.comps[genId] ? this.sys.comps[genId] : null;
        const qf  = qfId  && this.sys.comps[qfId]  ? this.sys.comps[qfId]  : null;
        const panel = panelId && this.sys.comps[panelId] ? this.sys.comps[panelId] : null;
        if (!gen) return null;
        const qfOn = qf && typeof qf.isClosed === 'function' ? qf.isClosed() : false;
        return {
            genId, qfId, panelId, gen, qf, panel,
            on:    !!gen.isOn,
            qfOn,
            online: !!gen.isOn && qfOn,
            freq:  (gen._freqOut ?? gen.freq) || 0,
            lineV: gen.getLineVoltage ? gen.getLineVoltage() : 0,
            pwr:   gen._pwr || 0,
            charged: qf ? (typeof qf.isCharged === 'function' ? qf.isCharged() : true) : false,
            powered: panel ? (typeof panel.isPowered === 'function' ? panel.isPowered() : true) : true,
        };
    }

    _sampleUnits() {
        const units = [];
        for (let i = 0; i < this.genIds.length; i++) {
            const u = this._getUnit(this.genIds[i], this.qfIds[i], this.panelIds[i]);
            if (u) units.push(u);
        }
        this._units = units;
        const online = units.filter(u => u.online);
        this._sample.online = online;
        this._sample.p = online.reduce((a, u) => a + u.pwr, 0);
        // 母线带电以“在网机组”为准（qf 分闸时母线端口会经 10e9Ω 泄漏感应出非零电压，不能作为判据）
        this._sample.live = online.length > 0;
        if (online.length > 0) {
            this._sample.lineV = online[0].lineV;
            this._sample.freq  = online[0].freq;
        } else {
            this._sample.lineV = 0;
            this._sample.freq  = 0;
        }
    }

    // 备用顺序：返回机组索引数组（从 genIds 中选择）
    _seqOrder() {
        const order = this._seq === '213' ? [1, 0, 2] : [0, 1, 2];
        return order.filter(i => i < this.genIds.length);
    }

    // 单机额定功率（kW）：取第一台在线机组额定值，兜底 400
    _genRated() {
        for (const u of this._units || []) {
            if (u && u.gen && typeof u.gen.ratedPower === 'number' && u.gen.ratedPower > 0) {
                return u.gen.ratedPower;
            }
        }
        return 400;
    }

    _autoControl(dt) {
        if (!this._powered || !this._auto) return;
        const units = this._units || [];
        const online = this._sample.online || [];
        const busLive = this._sample.live;

        // 每帧统一计算各机组命令，未显式设置的机组默认 null（清除残留命令）
        const cmds = new Array(this.genIds.length).fill(null);

        // ── 失电自动起动：母线无电 → 按备用顺序起动第一台可用机组 ──
        if (!busLive) {
            const order = this._seqOrder();
            for (const i of order) {
                const u = units[i];
                if (!u) continue;
                if (u.on) {
                    // 已运行但未合闸：建压+储能完成后合闸
                    if (!(this._startTimer[i] >= 0)) this._startTimer[i] = 0;
                    const ready = u.lineV > 100 && u.freq > 45 && u.freq < 55;
                    if (ready && u.charged) {
                        this._startTimer[i] = (this._startTimer[i] || 0) + dt;
                        if (this._startTimer[i] > 1.2) cmds[i] = 'close';
                    } else {
                        this._startTimer[i] = 0;
                    }
                } else {
                    // 未运行：经面板发起动命令
                    cmds[i] = 'start';
                    this._startTimer[i] = 0;
                }
                break;
            }
        } else {
            // ── 母线有电 ──

            // ── 自动并车：单机在网且负载 > 单机额定 80% → 起动下一台并同步合闸 ──
            if (online.length === 1 && this._sample.p > this.parallelKw / 100 * this._genRated()) {
                const inOnline = new Set(online.map(u => u.genId));
                const order = this._seqOrder();
                for (const i of order) {
                    const u = units[i];
                    if (!u || inOnline.has(u.genId)) continue;
                    if (!u.on) {
                        cmds[i] = 'start';
                        this._syncTimer[i] = 0;
                        break;
                    }
                    // 已运行：同步频率到母线频率（经面板调速）
                    const ref = online[0].freq;
                    const df = ref - u.freq;
                    if (Math.abs(df) < 0.3) {
                        this._syncTimer[i] = (this._syncTimer[i] || 0) + dt;
                        if (this._syncTimer[i] > 2 && u.charged) cmds[i] = 'close';
                    } else {
                        cmds[i] = df > 0 ? 'spd-inc' : 'spd-dec';
                        this._syncTimer[i] = 0;
                    }
                    break;
                }
            }

            // ── 自动解列：多机在网且负载 < 单机额定 30%，延时 20s 解列、再延时 30s 停机 ──
            const decoupling = this._decoupleIdx >= 0;
            const lowLoad = online.length > 1 && this._sample.p < this.decoupleKw / 100 * this._genRated();
            if (!decoupling && lowLoad) {
                this._decoupleTimer += dt;
                if (this._decoupleTimer > 20) {
                    const order = this._seqOrder().slice().reverse();
                    for (const i of order) {
                        const u = units[i];
                        if (!u || !u.online) continue;
                        this._decoupleIdx = i;
                        this._decoupleTimer = 0;
                        this._stopTimer = 0;
                        break;
                    }
                }
            } else if (!decoupling && !lowLoad) {
                // 负载恢复/单机在网：清除解列累计
                this._decoupleTimer = 0;
            }
            if (this._decoupleIdx >= 0) {
                const u = units[this._decoupleIdx];
                if (u && u.on) {
                    if (u.qfOn) {
                        // 发电机仍在运行且已合闸：发解列（分闸）命令
                        cmds[this._decoupleIdx] = 'open';
                    } else {
                        // 已分闸：延时 30s 后停机
                        this._stopTimer += dt;
                        if (this._stopTimer > 30) cmds[this._decoupleIdx] = 'stop';
                    }
                } else {
                    // 已完成解列（机组已停机），清除状态
                    this._decoupleIdx = -1;
                }
            }

            // ── 自动调频：在线机组频率向 50Hz 调节（经面板调速）──
            // 用慢速调速(spd-inc/dec-slow，电压±0.3V)＋宽死区(±0.15Hz)：
            // 快速 bang-bang(±1V)会因频率对设定值响应的滞后产生过冲，
            // 在并联两机间形成 ±0.2Hz 弛豫极限环（设定值同步摆动）。
            // 慢速命令让设定值步进小、过冲可控，freq 收敛到死区内即稳定。
            for (const u of online) {
                const i = this.genIds.indexOf(u.genId);
                if (i < 0 || !u.powered) continue;
                // 正在解列的机组跳过，避免覆盖解列命令
                if (i === this._decoupleIdx) continue;
                const f = u.freq;
                if (f < 49.85) cmds[i] = 'spd-inc-slow';
                else if (f > 50.15) cmds[i] = 'spd-dec-slow';
                else cmds[i] = null;
            }
        }

        // 统一下发命令（面板未通电的机组不发）
        for (let i = 0; i < this.genIds.length; i++) {
            const u = units[i];
            if (!u || !u.panel || typeof u.panel.setCommCmd !== 'function') continue;
            u.panel.setCommCmd(u.powered ? cmds[i] : null);
        }
    }

    _lcdLines() {
        if (!this._powered) return ['--', '--', '--'];
        const online = this._sample.online || [];
        const labels = online.map(u => {
            const idx = this.genIds.indexOf(u.genId);
            return `${idx + 1}#`;
        });
        const live = this._sample.live;
        return [
            live ? `在网:${labels.join(' ') || '无'}` : '母线 失电',
            `总功率 ${this._sample.p > 100 ? this._sample.p.toFixed(0) : this._sample.p.toFixed(1)} kW`,
            live ? `母线 ${this._sample.lineV.toFixed(0)}V ${this._sample.freq.toFixed(1)}Hz` : '母线 失电',
        ];
    }

    _updateLCD() {
        if (!this._ui) return;
        const lines = this._lcdLines();
        this._ui.lcd.forEach((t, i) => t.text(lines[i]));
    }

    _updateLeds() {
        const ui = this._ui;
        if (!ui || !ui.leds) return;
        const on = (led, on) => led.fill(on ? '#ffffff' : '#8a8a8a');
        on(ui.leds.pwr, this._powered);
        on(ui.leds.auto, this._auto);
        for (let i = 0; i < 3; i++) {
            const led = ui.leds['unit' + (i + 1)];
            if (!led) continue;
            const u = (this._units || [])[i];
            on(led, !!(u && u.on));
        }
    }

    // ═══════════════════════════════════════════
    // 公开 API
    // ═══════════════════════════════════════════

    isPowered() { return this._powered; }
    isAuto()    { return this._auto; }
    getSeq()    { return this._seq; }
    getBusLive(){ return this._sample.live; }

    getConfigFields() {
        return [
            { label: '发电机 ID 列表(逗号分隔)', key: 'genIds', type: 'text' },
            { label: '主开关 ID 列表(逗号分隔)', key: 'qfIds',  type: 'text' },
            { label: '遥控面板 ID 列表(逗号分隔)', key: 'panelIds', type: 'text' },
            { label: '初始状态', key: 'auto', type: 'select', get: c => this._auto ? 'auto' : 'manual', options: [
                { label: '手动', value: 'manual' },
                { label: '自动', value: 'auto' },
            ]},
            { label: '备用顺序', key: 'seq', type: 'select', get: c => this._seq, options: [
                { label: '1-2-3', value: '123' },
                { label: '2-1-3', value: '213' },
            ]},
            { label: '并车负载阈值 (单机额定 %)', key: 'parallelKw', type: 'number', step: 5 },
            { label: '解列负载阈值 (单机额定 %)', key: 'decoupleKw', type: 'number', step: 5 },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.genIds !== undefined && typeof cfg.genIds === 'string') {
            this.genIds = cfg.genIds.split(',').map(s => s.trim()).filter(Boolean);
        }
        if (cfg.qfIds !== undefined && typeof cfg.qfIds === 'string') {
            this.qfIds = cfg.qfIds.split(',').map(s => s.trim()).filter(Boolean);
        }
        if (cfg.panelIds !== undefined && typeof cfg.panelIds === 'string') {
            this.panelIds = cfg.panelIds.split(',').map(s => s.trim()).filter(Boolean);
        }
        if (cfg.auto !== undefined) this._auto = String(cfg.auto) === 'auto';
        if (cfg.seq  !== undefined) this._seq  = String(cfg.seq) === '213' ? '213' : '123';
        if (cfg.parallelKw !== undefined) this.parallelKw = parseFloat(cfg.parallelKw);
        if (cfg.decoupleKw !== undefined) this.decoupleKw = parseFloat(cfg.decoupleKw);
        this.config = { ...this.config, ...cfg };
        this.markDirty();
    }
}
