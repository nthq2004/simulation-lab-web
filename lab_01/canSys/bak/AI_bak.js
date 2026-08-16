/**
 * AI.js — 模拟量输入模块 (Analog Input Module)
 * 船舶机舱监测报警系统 · CAN 总线架构
 *
 * 硬件规格：
 *   - 2路 4-20mA 电流输入 (CH1, CH2)
 *   - 1路 RTD 热电阻输入 (PT100)
 *   - 1路 TC 热电偶输入 (K型)
 *   - 2路 CAN 总线接口 (CANH / CANL)
 *   - DC 24V 电源接口
 *   - 4路通道运行指示灯 (每通道1个)
 *   - 4个模块状态指示灯：PWR / RUN / FLT / COM
 *   - 4位地址码拨码开关 (SW1~SW4，二进制编码，地址范围 0-15)
 *   - 1个终端电阻使能开关 (120Ω)
 */

import { BaseComponent } from '../components/BaseComponent.js';
import { CAN_FUNC, CANId, NMT_CMD, NMT_STATE } from './CANBUS.js';

// ─────────────────────────────────────────────
//  常量
// ─────────────────────────────────────────────
const W = 200;   // 模块主体宽度
const H = 340;   // 模块主体高度

// 定义4个通道的配置数组，包含ID、标签、类型和在画布上的垂直位置
const CH_CONFIG = [
    { id: 'ch1', label: 'CH1', type: '4-20mA', yPort: 60 },
    { id: 'ch2', label: 'CH2', type: '4-20mA', yPort: 100 },
    { id: 'ch3', label: 'RTD', type: 'RTD', yPort: 140 },
    { id: 'ch4', label: 'TC', type: 'TC', yPort: 180 },
];

// ─────────────────────────────────────────────
//  主类定义：AIModule (模拟量输入模块)
// ─────────────────────────────────────────────
export class AIModule extends BaseComponent {
    /**
     * 构造函数
     * @param {Object} config - 初始化配置对象（可选）
     * @param {Object} sys - 系统环境对象（仿真引擎）
     */
    constructor(config, sys) {
        super(config, sys);

        this.w = W;
        this.h = H;
        this.scale = 1.35;
        this.type = 'AI';
        this.special = 'can';
        this.cache = 'fixed';

        // ── 电源状态和物理连接状态 ──
        this.powerOn = false;
        this.busConnected = false;


        // --- 5种故障状态----
        this.isBreak = false;
        this.commFault = false;
        this.moduleFault = false;
        this.channelFault = false;
        this.sysFault = false;


        // ── 节点地址 (0~15)，由拨码开关决定 ──
        // 如果传入了 config 且包含 nodeAddress，则使用传入值，否则默认为 1
        this.nodeAddress = (config && config.nodeAddress != null) ? config.nodeAddress : 1;

        // ── 终端电阻使能 ──
        this.termEnabled = false;
        this.currentResistance = 1000000;

        // ── 通道数据 ──
        // 存储每个通道的实时数据：工程量(value)、原始值(raw)、故障状态(fault)、类型(type)
        this.channels = {
            ch1: { value: 0, raw: 0, fault: false, faultText: null, mode: 'normal', type: '4-20mA' },
            ch2: { value: 0, raw: 0, fault: false, faultText: null, mode: 'normal', type: '4-20mA' },
            ch3: { value: 0, raw: 1000000, fault: false, faultText: null, mode: 'normal', type: 'RTD' }, // PT100 @ 20°C ≈ 107.7Ω
            ch4: { value: 0, raw: 0, fault: false, faultText: null, mode: 'normal', type: 'TC' }, // K型 @ 20°C ≈ 0.8mV
        };

        // ── 工程量量程配置 ── 定义每个通道的工程量上下限和单位
        this.ranges = {
            ch1: { lrv: 0, urv: 10, unit: 'bar' },
            ch2: { lrv: 0, urv: 1, unit: 'MPa' },
            ch3: { lrv: -50, urv: 200, unit: '°C' },
            ch4: { lrv: 0, urv: 400, unit: '°C' },
        };

        // ── 报警阈值 ──定义每个通道的高高(HH)、高(H)、低(L)、低低(LL)报警值
        this.alarms = {
            ch1: { hh: 9.5, h: 8.5, l: 1, ll: 0.5, status: 'normal' },
            ch2: { hh: 0.9, h: 0.8, l: 0.2, ll: 0.1, status: 'normal' },
            ch3: { hh: 180, h: 150, l: 0, ll: -40, status: 'normal' },
            ch4: { hh: 380, h: 350, l: 10, ll: 5, status: 'normal' },
        };

        // ── 模块状态灯 ──初始化所有指示灯状态为熄灭
        this.ledStatus = { pwr: false, run: false, flt: false, com: false };

        // ── CAN 总线状态 ──
        this.canBusConnected = false;
        // 记录上次发送和接收的时间戳
        this.lastTxTime = 0;
        this.lastRxTime = 0;
        // 发送计数器、接收计时器
        this.txCount = 0;
        this.rxCount = 0;
        // 定义发送间隔为 200 毫秒
        this.txInterval = 200;
        // 通信错误计数器
        this.comErrorCount = 0;


        // ── 内部计时 ──
        // 用于控制 RUN 灯闪烁状态的标志位
        this._runBlink = false;
        // 用于控制 COM 灯闪烁状态的标志位
        this._comBlink = false;
        // 内部滴答计数器（用于闪烁逻辑）
        this._blinkTick = 0;

        // ── NMT 网络管理状态机 ──
        // 节点状态：'init'(初始化) → 'preop'(预运行) → 'run'(运行) → 'stop'(停止) → 'reset'(复位)
        this.nmtState = 'init';
        // 记录最后一次状态变更的时间戳
        this.nmtStateTime = Date.now();
        // 心跳管理：记录最后一次从中央计算机收到广播心跳的时间
        this._lastHeartbeat = 0;
        // 心跳超时时间（ms），默认为 5000ms，可通过 config 设置覆盖
        this.heartbeatTimeout = 10000;

        // ── 初始化 ──
        this._initVisuals();// 调用图形绘制初始化
        this._initPorts();// 调用接线端口初始化
        this._initInteraction();// 调用交互功能初始化
        this._startLoop();// 启动主循环定时器
    }

    // ══════════════════════════════════════════
    //  界面绘制
    // ══════════════════════════════════════════
    _initVisuals() {
        /**
            * 初始化视觉元素
            * 创建缩放组并将所有图形元素添加到组中
        */
        this.scaleGroup = new Konva.Group({ scaleX: this.scale, scaleY: this.scale });
        this.group.add(this.scaleGroup);

        this._drawBody();
        this._drawHeader();
        this._drawChannelRows();    // 绘制通道行
        this._drawStatusLEDs();     // 绘制状态指示灯
        this._drawAddressSwitch();  // 绘制地址拨码开关
        this._drawTermSwitch();    // 绘制终端电阻开关
        this._drawBottomPanel();
        this._drawPortLabels();   // 绘制端口标签
    }

    /** 模块主体外壳 */
    _drawBody() {
        const sg = this.scaleGroup;

        // 左右侧板（安装导轨卡扣）
        const railAttr = { width: 18, height: H, fill: '#9e9e9e', stroke: '#555', strokeWidth: 1.5, cornerRadius: 2 };
        sg.add(new Konva.Rect({ x: -18, y: 0, ...railAttr }));// 添加左侧板
        sg.add(new Konva.Rect({ x: W, y: 0, ...railAttr })); // 添加右侧板

        // 主体面板
        sg.add(new Konva.Rect({
            x: 0, y: 0, width: W, height: H,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint: { x: W, y: 0 },
            fillLinearGradientColorStops: [0, '#2c2c2c', 0.5, '#3a3a3a', 1, '#2c2c2c'],
            stroke: '#222', strokeWidth: 3, cornerRadius: 3
        }));

        // 顶部装饰条
        sg.add(new Konva.Rect({ x: 0, y: 0, width: W, height: 6, fill: '#0055aa', cornerRadius: [3, 3, 0, 0] }));
    }

    /** 标题栏 */
    _drawHeader() {
        const sg = this.scaleGroup;
        // 背景
        sg.add(new Konva.Rect({ x: 4, y: 8, width: W - 8, height: 30, fill: '#111', stroke: '#0055aa', strokeWidth: 1, cornerRadius: 2 }));
        // 型号文字 "AI-4通道"
        sg.add(new Konva.Text({ x: 6, y: 12, text: 'AI-4通道', fontSize: 14, fontFamily: 'Courier New', fontStyle: 'bold', fill: '#00aaff' }));
        // 副标题"ANALOG INPUT MODULE"
        sg.add(new Konva.Text({ x: 6, y: 28, text: 'ANALOG  INPUT  MODULE', fontSize: 7, fill: '#18b70a' }));
        // 节点地址显示（保存引用以便后续更新）---格式化输出：NODE:01 (两位数字)
        this._nodeAddrDisplay = new Konva.Text({ x: 140, y: 14, text: `NODE:${String(this.nodeAddress).padStart(2, '0')}`, fontSize: 10, fontFamily: 'Courier New', fill: '#ffcc00' });
        sg.add(this._nodeAddrDisplay);
    }

    /** 4个通道输入行---包括标签、数值显示、单位、指示灯和报警状态 */
    _drawChannelRows() {
        this._chDisplays = {};  // 用于存储显示元素的引用
        this._chLEDs = {}; // 用于存储通道指示灯的引用
        // 遍历通道配置数组
        CH_CONFIG.forEach((ch, i) => {
            const y = 44 + i * 52;
            const sg = this.scaleGroup;

            // 通道背景框
            sg.add(new Konva.Rect({ x: 4, y, width: W - 8, height: 48, fill: '#0a0a0a', stroke: '#333', strokeWidth: 1, cornerRadius: 2 }));

            // 通道标签(CH1, CH2...)
            sg.add(new Konva.Text({ x: 8, y: y + 4, text: ch.label, fontSize: 10, fontStyle: 'bold', fill: '#f00b0b' }));

            // 输入类型标签(4-20mA, RTD，TC)
            sg.add(new Konva.Text({ x: 8, y: y + 16, text: ch.type, fontSize: 8, fill: '#039540' }));

            // 数值显示区域背景
            const dispBg = new Konva.Rect({ x: 44, y: y + 4, width: 100, height: 38, fill: '#050505', stroke: '#1a4a1a', strokeWidth: 1, cornerRadius: 1 });
            sg.add(dispBg);
            // 工程量数值文本
            const valText = new Konva.Text({
                x: 46, y: y + 8, width: 96, text: '----',
                fontSize: 18, fontFamily: 'Courier New', fontStyle: 'bold',
                fill: '#00ff44', align: 'right'
            });
            // 单位文本
            const unitText = new Konva.Text({
                x: 46, y: y + 30, width: 96, text: '',
                fontSize: 8, fill: '#faf4f4', align: 'right'
            });
            // 将该通道的显示元素存入对象            
            this._chDisplays[ch.id] = { val: valText, unit: unitText, bg: dispBg };
            sg.add(valText, unitText);

            // 通道运行指示灯（圆形）
            const led = new Konva.Circle({ x: 162, y: y + 14, radius: 5, fill: '#222', stroke: '#111', strokeWidth: 1 });
            // 指示灯标签 "RUN"
            const ledLabel = new Konva.Text({ x: 170, y: y + 10, text: 'RUN', fontSize: 7, fill: '#f5eeee' });
            // 存储指示灯引用
            this._chLEDs[ch.id] = led;
            sg.add(led, ledLabel);

            // 报警状态文字
            const almText = new Konva.Text({ x: 162, y: y + 24, text: '----', fontSize: 8, fill: '#555', width: 34, align: 'center' });
            // 存入显示对象，总共存了 文本、单位、背景、报警状态4个子元素。
            this._chDisplays[ch.id].alm = almText;
            sg.add(almText);

            // 原始信号值（小字）
            const rawText = new Konva.Text({ x: 8, y: y + 30, text: '', fontSize: 7, fill: '#06f040' });
            // 存入显示对象，总共存了 文本、单位、背景、报警状态、原始数值5个子元素。
            this._chDisplays[ch.id].raw = rawText;
            sg.add(rawText);
        });
    }

    /** 模块状态指示灯区域 */
    _drawStatusLEDs() {
        const sg = this.scaleGroup;
        const y = 256;
        const defs = [
            { id: 'pwr', label: 'PWR', color: '#00ff00', x: 14 },
            { id: 'run', label: 'RUN', color: '#00ff00', x: 58 },
            { id: 'flt', label: 'ERR', color: '#ff3300', x: 102 },
            { id: 'com', label: 'COM', color: '#00aaff', x: 146 },
        ];

        // 背景条
        sg.add(new Konva.Rect({ x: 4, y: y - 4, width: W - 8, height: 28, fill: '#0a0a0a', stroke: '#333', strokeWidth: 1, cornerRadius: 2 }));
        sg.add(new Konva.Text({ x: 8, y: y - 8, text: '状态指示灯', fontSize: 8, fill: '#f4eded' }));
        // 存储指示灯对象的引用
        this._statusLEDs = {};
        // 遍历定义创建指示灯
        defs.forEach(d => {
            // 圆形灯点
            const dot = new Konva.Circle({ x: d.x + 10, y: y + 10, radius: 5, fill: '#222', stroke: '#111', strokeWidth: 1 });
            // 文字标签，PWR、RUN、ERR、COM
            const txt = new Konva.Text({ x: d.x - 4, y: y + 16, text: d.label, fontSize: 7, fill: '#f8f4f4', width: 28, align: 'center' });
            // 保存引用和颜色配置
            this._statusLEDs[d.id] = { dot, color: d.color };
            sg.add(dot, txt);
        });
    }

    /** 4位地址码拨码开关 SW1~SW4，用于设置节点地址 (0-15) */
    _drawAddressSwitch() {
        const sg = this.scaleGroup;
        const y = 288;
        const swW = 18;
        const swH = 26;
        const gap = 22;
        // 背景框和标题
        sg.add(new Konva.Rect({ x: 4, y: y - 2, width: W - 8, height: 38, fill: '#0a0a0a', stroke: '#333', strokeWidth: 1, cornerRadius: 2 }));
        sg.add(new Konva.Text({ x: 8, y: y - 4, text: '节点地址', fontSize: 8, fill: '#f1ebeb' }));

        // 存储开关对象的引用，用于后续状态更新
        this._swObjs = [];
        // 循环创建 4 个拨码开关 (SW1-SW4)
        for (let i = 0; i < 4; i++) {
            const bitVal = 1 << i; // // 计算位值 (SW1=1, SW2=2, SW3=4, SW4=8)
            const x0 = 14 + i * gap;
            // 判断当前位在 nodeAddress 中是否为 1 (开关是否打开)
            const isOn = (this.nodeAddress & bitVal) !== 0;
            // 开关背景矩形
            const swBg = new Konva.Rect({ x: x0, y: y + 8, width: swW, height: swH, fill: '#1a1a1a', stroke: '#444', strokeWidth: 1, cornerRadius: 2 });
            // 开关旋钮 (根据 isOn 状态决定位置和颜色)
            const knob = new Konva.Rect({ x: x0 + 3, y: isOn ? y + 10 : y + 22, width: swW - 6, height: 10, fill: isOn ? '#ffcc00' : '#333', stroke: '#555', strokeWidth: 1, cornerRadius: 1 });
            // 开关标签 "SW1" 等
            const lbl = new Konva.Text({ x: x0, y: y + 35, text: `SW${i + 1}`, fontSize: 6, fill: '#f4eeee', width: swW, align: 'center' });
            // 位值标签 "1", "2", "4", "8"
            const vLbl = new Konva.Text({ x: x0, y: y + 12, text: bitVal.toString(), fontSize: 6, fill: '#444', width: swW, align: 'center' });
            // ── 交互逻辑：绑定点击事件 ──
            swBg.on('click tap', () => {
                // 获取当前开关状态
                const cur = (this.nodeAddress & bitVal) !== 0;
                // 如果当前是开，就关闭 (按位取反清除该位)
                if (cur) this.nodeAddress &= ~bitVal;
                // 如果当前是关，就开启 (按位或设置该位)
                else this.nodeAddress |= bitVal;
                // 刷新开关视觉,这里开关右边的地址文本也会同步刷新
                this._refreshSwitches();
                // 更新顶部地址显示文本
                this._nodeAddrDisplay.text(`NODE:${String(this.nodeAddress).padStart(2, '0')}`);
                this._refreshCache();
            });
            vLbl.on('click tap', () => {
                // 获取当前开关状态
                const cur = (this.nodeAddress & bitVal) !== 0;
                // 如果当前是开，就关闭 (按位取反清除该位)
                if (cur) this.nodeAddress &= ~bitVal;
                // 如果当前是关，就开启 (按位或设置该位)
                else this.nodeAddress |= bitVal;
                // 刷新开关视觉,这里开关右边的地址文本也会同步刷新
                this._refreshSwitches();
                // 更新顶部地址显示文本
                this._nodeAddrDisplay.text(`NODE:${String(this.nodeAddress).padStart(2, '0')}`);
                this._refreshCache();
            });

            // 存储该开关的图形对象和位值
            this._swObjs.push({ knob, bitVal });
            sg.add(swBg, knob, lbl, vLbl);
        }

        // 十进制地址显示(显示当前地址的十进制值)
        this._addrDecText = new Konva.Text({ x: 110, y: y + 10, text: String(this.nodeAddress), fontSize: 10, fontFamily: 'Courier New', fill: '#ffcc00', width: 30, align: 'left' });
        sg.add(this._addrDecText);
    }

    /** 终端电阻开关 */
    _drawTermSwitch() {
        const sg = this.scaleGroup;
        const x0 = 160, y0 = 288;

        sg.add(new Konva.Text({ x: x0 - 2, y: y0 - 6, text: '终端电阻', fontSize: 8, fill: '#dfd6d6' }));
        // 开关背景
        const termBg = new Konva.Rect({ x: x0 + 2, y: y0 + 8, width: 24, height: 26, fill: '#1a1a1a', stroke: '#444', strokeWidth: 1, cornerRadius: 2 });
        // 开关旋钮 (初始位置在底部，代表关闭)
        this._termKnob = new Konva.Rect({ x: x0 + 5, y: y0 + 22, width: 18, height: 10, fill: '#333', stroke: '#555', strokeWidth: 1, cornerRadius: 1 });
        // 标签文字 "120Ω"
        const termLbl = new Konva.Text({ x: x0, y: y0 + 35, text: '120Ω', fontSize: 6, fill: '#ebe5e5', width: 32, align: 'center' });
        // ── 交互逻辑：绑定点击事件 ──
        termBg.on('click tap', () => {
            // 切换开关状态
            this.termEnabled = !this.termEnabled;
            this.currentResistance = this.termEnabled?120:1000000;
            // 根据状态移动旋钮位置 (y0+10=开, y0+22=关)
            this._termKnob.y(this.termEnabled ? y0 + 10 : y0 + 22);
            // 根据状态改变颜色 (蓝色=开, 灰色=关)
            this._termKnob.fill(this.termEnabled ? '#00aaff' : '#333');
            this._refreshCache();
        });

        sg.add(termBg, this._termKnob, termLbl);
    }

    /** 底部面板（CAN / 电源接线端）*/
    _drawBottomPanel() {
        const sg = this.scaleGroup;
        sg.add(new Konva.Rect({ x: 0, y: H, width: W, height: 20, fill: '#9e9e9e', stroke: '#444', strokeWidth: 1.5 }));

        // CAN1和CAN2标签配置数组
        const labels = [
            { x: 25, text: 'CAN1H' },
            { x: 70, text: 'CAN1L' },
            { x: 115, text: 'CAN2H' },
            { x: 160, text: 'CAN2L' },
        ];
        labels.forEach(l => sg.add(new Konva.Text({ x: l.x, y: H + 5, text: l.text, fontSize: 7, fill: '#222' })));
    }

    /** 接线端口标注（侧边）*/
    _drawPortLabels() {
        const sg = this.scaleGroup;
        // 绘制左侧 4 路通道的 +/- 标签
        CH_CONFIG.forEach((ch, i) => {
            const y = 44 + i * 52 + 14;
            sg.add(new Konva.Text({ x: -40, y: y - 4, text: `${ch.label}+`, fontSize: 7, fill: '#0d05f2' }));
            sg.add(new Konva.Text({ x: -40, y: y + 18, text: `${ch.label}-`, fontSize: 7, fill: '#0d05f2' }));
        });
        // 绘制右侧电源标签
        sg.add(new Konva.Text({ x: W + 2, y: 8, text: 'VCC', fontSize: 7, fill: '#0d05f2' }));
        sg.add(new Konva.Text({ x: W + 2, y: 34, text: 'GND', fontSize: 7, fill: '#0d05f2' }));
    }

    // ══════════════════════════════════════════
    //  接线端口注册
    // ══════════════════════════════════════════
    _initPorts() {
        // 左侧：4路模拟输入，每路 + / -
        CH_CONFIG.forEach((ch, i) => {
            const yBase = 44 + i * 52;
            this.addPort(-18 * this.scale, (yBase + 12) * this.scale, `${ch.id}p`, 'wire', 'p');
            this.addPort(-18 * this.scale, (yBase + 38) * this.scale, `${ch.id}n`, 'wire');
        });

        // 右侧：24V 电源
        this.addPort((W + 18) * this.scale, 10 * this.scale, 'vcc', 'wire', 'p');
        this.addPort((W + 18) * this.scale, 38 * this.scale, 'gnd', 'wire');

        // 底部：CAN 总线
        this.addPort(35 * this.scale, (H + 20) * this.scale, 'can1p', 'wire', 'p');
        this.addPort(80 * this.scale, (H + 20) * this.scale, 'can1n', 'wire');
        this.addPort(125 * this.scale, (H + 20) * this.scale, 'can2p', 'wire', 'p');
        this.addPort(170 * this.scale, (H + 20) * this.scale, 'can2n', 'wire');
    }

    // ══════════════════════════════════════════
    //  交互（拨码开关已在 _drawAddressSwitch 内绑定）
    // ══════════════════════════════════════════
    _initInteraction() {
        // 双击模块重置通信错误计数
        this.scaleGroup.on('dblclick', () => {
            this.comErrorCount = 0;
            this._refreshCache();
        });
    }

    // ══════════════════════════════════════════
    //  主循环--控制模块的核心逻辑更新频率 (100ms/次)
    // ══════════════════════════════════════════
    _startLoop() {
        // 设置定时器，每 100ms 执行一次
        this._loopTimer = setInterval(() => {
            // 检测电源电压 (尝试获取 VCC 和 GND 之间的电压)
            try {
                // powerOn 表示模块电源是否正常
                this.powerOn = !this.isBreak && this.sys.getVoltageBetween(`${this.id}_wire_vcc`, `${this.id}_wire_gnd`) > 18;
                // busConnected 仅表示物理总线端口是否连接
                this.busConnected = this.sys.isPortConnected(`${this.id}_wire_can1p`, 'can_wire_can1p') && this.sys.isPortConnected(`${this.id}_wire_can1n`, 'can_wire_can1n');
            } catch (_) { }
            // 执行单次循环逻辑
            this._tick();
        }, 100);

        // 启动时设置NMT为初始化状态，等待CC的启动命令
        this.nmtState = NMT_STATE.INIT;
        this.nmtStateTime = Date.now();
    }

    // ══════════════════════════════════════════
    //  NMT 状态管理
    // ══════════════════════════════════════════
    /**
     * 处理NMT命令
     * @param {number} cmd - NMT命令代码
     */
    _handleNMT(cmd) {
        if (cmd === NMT_CMD.START) {
            // 启动命令：init/preop → run
            if (this.nmtState === NMT_STATE.INIT || this.nmtState === NMT_STATE.PREOP) {
                this.nmtState = NMT_STATE.RUN;
                this.nmtStateTime = Date.now();
                console.log(`[AI #${this.nodeAddress}] NMT: Starting → ${NMT_STATE.RUN} state`);
            }
        } else if (cmd === NMT_CMD.STOP) {
            // 停止命令：run → stop
            if (this.nmtState === NMT_STATE.RUN) {
                this.nmtState = NMT_STATE.STOP;
                this.nmtStateTime = Date.now();
                console.log(`[AI #${this.nodeAddress}] NMT: Stopping → ${NMT_STATE.STOP} state`);
            }
        } else if (cmd === NMT_CMD.RESET) {
            // 节点复位：任何状态 → init
            this.nmtState = NMT_STATE.INIT;
            this.nmtStateTime = Date.now();
            // 重置通信计数器和时间戳
            this.txCount = 0;
            this.rxCount = 0;
            this.comErrorCount = 0;
            this.lastTxTime = 0;
            this.lastRxTime = 0;
            console.log(`[AI #${this.nodeAddress}] NMT: Resetting → ${NMT_STATE.INIT} state`);
        } else if (cmd === NMT_CMD.RESETCOM) {
            // 通信复位：重置通信统计
            this.comErrorCount = 0;
            this.lastTxTime = 0;
            this.lastRxTime = 0;
            this.txCount = 0;
            this.rxCount = 0;
            console.log(`[AI #${this.nodeAddress}] NMT: Communication reset`);
        }
    }

    /**
     * 检查是否允许发送数据
     * 仅在run状态下允许发送，其他状态下禁止发送
     */
    _isCanTransmit() {
        return this.nmtState === NMT_STATE.RUN;
    }

    _tick() {
        const now = Date.now();
        this._blinkTick = now;

        // 1.如果没电，进入黑屏状态
        if (!this.powerOn) {
            this._renderOff();
            return;
        }


        // 更新电源灯 (常亮)
        this.ledStatus.pwr = true;

        // ── 2. 故障模拟：sysFault（死机）时，模块停止工作 ──
        if (this.sysFault) {
            // 模块死机状态：RUN灯不闪烁，保持暗灭；不处理通道数据；不发送CAN消息
            this.ledStatus.run = false;   // RUN灯熄灭，表示模块崩溃
            this.ledStatus.flt = true;    // FLT灯点亮，表示故障
            this.ledStatus.com = false;   // COM灯熄灭，不再通信
            this._render();
            return;  // 跳过后续所有处理
        }

        // 3.心跳超时检测：如果长时间未收到中央计算机的广播心跳，则从 RUN 降级到 PREOP
        if (now - this._lastHeartbeat > this.heartbeatTimeout) {
            if (this.nmtState === NMT_STATE.RUN) {
                this.nmtState = NMT_STATE.PREOP;
                this.nmtStateTime = Date.now();
                console.log(`[AI #${this.nodeAddress}] Heartbeat lost → ${NMT_STATE.PREOP} state`);
            }
        }



        //4. 更新 RUN 灯（每 500ms 闪烁）
        this._runBlink = (now % 1000) < 500;
        this.ledStatus.run = this._runBlink;

        // 5. 读取各通道原始值（外部可通过 setRaw(ch, val) 注入）
        this._processChannels();

        // 6. CAN 总线发送（仅在run状态下发送）
        if (this._isCanTransmit() && now - this.lastTxTime >= this.txInterval) {
            this._canTransmit();
            this.lastTxTime = now;
        }

        // 7. COM 灯（每次发送后点亮 80ms）
        // 只有物理总线连接且电源正常且通信模块无故障时，才允许 COM 灯闪烁
        this._comBlink = (now - this.lastTxTime) < 80;
        this.ledStatus.com = (!this.busConnected || this.commFault) ? false : this._comBlink;

        // 8.更新 FLT (故障) 灯，后期要更新，flt专门设置输入输出接口模块模块故障。
        this.ledStatus.flt = this.moduleFault || this.commFault || this.sysFault;

        if (this.busConnected && !this.commFault) this.sys.canBus.setNodeOnline(this.id);
        else this.sys.canBus.resetNodeOnline(this.id);
        // 9. 执行渲染更新
        this._render();
    }

    // ══════════════════════════════════════════
    //  通道数据处理
    // ══════════════════════════════════════════
    _processChannels() {
        // ── 故障模拟：moduleFault 时所有通道失效 ──
        if (this.moduleFault) {
            Object.keys(this.channels).forEach(id => {
                this.channels[id].fault = true;
                this.channels[id].faultText = 'OPEN';
                this.channels[id].value = -1;
            });
            return;  // 所有通道故障，不再继续处理
        }

        Object.keys(this.channels).forEach(id => {
            const ch = this.channels[id];
            const rng = this.ranges[id];
            const alm = this.alarms[id];

            // ── 故障模拟：channelFault 时通道1单独失效 ──
            if (this.channelFault && id === 'ch1') {
                ch.fault = true;
                ch.faultText = 'OPEN';
                ch.value = -1;
                return;  // 跳过该通道后续处理
            }

            // 工程量转换
            switch (ch.type) {
                case '4-20mA':
                    // 4-20mA 信号断线/短路判断 (0视为变送器断路，小于 3.8mA视为PT100断路 或 大于 20.5mA 视为短路)
                    if (ch.raw < 3.8 || ch.raw > 20.5) {
                        ch.fault = true;
                        if (ch.raw < 0.1) ch.faultText = 'OPEN';
                        else if (ch.raw > 21) ch.faultText = 'SHORT';
                        else ch.faultText = 'OUTRANGE';
                    } else {
                        ch.fault = false;
                        ch.value = rng.lrv + ((ch.raw - 4) / 16) * (rng.urv - rng.lrv);
                    }
                    break;
                case 'RTD': {
                    // PT100 线性近似: R = 100 * (1 + 0.00385 * T)
                    // => T = (R/100 - 1) / 0.00385
                    const r = ch.raw;
                    if (r < 18.52 || r > 175.86) { // 对应 -210°C ~ 200°C 超限，太小为短路，太大为断路。
                        ch.fault = true;
                        if (ch.raw < 0.2) ch.faultText = 'SHORT';
                        else if (ch.raw > 1000) ch.faultText = 'OPEN';
                        else ch.faultText = 'OUTRANGE';
                    } else {
                        ch.fault = false;
                        ch.value = (r / 100 - 1) / 0.00385;
                    }
                    break;
                }
                case 'TC': {
                    // K型热电偶近似: T(°C) = mV / 0.04 (0~400°C 范围线性近似)
                    const mv = ch.raw;
                    if (mv < -0.1 || mv > 17.0) {
                        ch.fault = true;
                        if (ch.raw < -0.2) ch.faultText = 'OPEN';
                        else ch.faultText = 'OUTRANGE';
                    } else {
                        ch.fault = false;
                        ch.value = mv / 0.04;
                    }
                    break;
                }
            }

            // 限幅（超量程不故障但标记）
            if (!ch.fault) {
                ch.value = Math.max(rng.lrv - (rng.urv - rng.lrv) * 0.05,
                    Math.min(rng.urv + (rng.urv - rng.lrv) * 0.05, ch.value));
            }

            // 报警判断
            if (!ch.fault) {
                const v = ch.value;
                if (v >= alm.hh) alm.status = 'HH';
                else if (v >= alm.h) alm.status = 'H';
                else if (v <= alm.ll) alm.status = 'LL';
                else if (v <= alm.l) alm.status = 'L';
                else alm.status = 'normal';
            } else {
                alm.status = 'FAULT';
            }
        });
    }

    // ══════════════════════════════════════════
    //  CAN 总线通信
    // ══════════════════════════════════════════
    /**
     * 发送 CAN 帧到总线
     * 帧格式（Data 8字节）：
     *   Byte 0-1: CH1 工程量 × 100 (Int16)
     *   Byte 2-3: CH2 工程量 × 100
     *   Byte 4-5: CH3 工程量 × 10  (RTD, 一位小数)
     *   Byte 6-7: CH4 工程量 × 10  (TC)
     * 扩展 ID = (功能码 << 7) | 节点地址
     */

    /**
     * 辅助方法：将有符号 16 位整数转为两个字节（大端序）
     * 用于 CAN 帧数据编码，正确处理负数
     * @param {number} value - 有符号 16 位整数值
     * @returns {Array} [高字节, 低字节]
     */
    _int16ToBytes(value) {
        // 将负数转换为补码表示
        let v = value;
        if (v < 0) {
            v = 0x10000 + v;  // 负数的补码 = 65536 + value
        }
        return [(v >> 8) & 0xFF, v & 0xFF];
    }

    /**
     * 发送 CAN 响应帧（用于配置读取命令的回复）
     * @param {Array} responseData - 8字节的响应数据
     */
    _sendResponse(responseData) {
        if (!this.sys || typeof this.sys.canBus === 'undefined') return;

        // 计算帧 ID：功能码 0x03 (AI 回复)，节点地址
        const frameId = CANId.encode(CAN_FUNC.AI_REPLY, this.nodeAddress & 0x0F);

        // 构造 CAN 帧对象
        const frame = {
            id: frameId,
            extended: false,
            rtr: false,
            dlc: 8,
            data: responseData,
            sender: this.id,
            timestamp: Date.now(),
        };

        try {
            this.sys.canBus.send(frame);
            this.txCount++;
            this.canBusConnected = true;
        } catch (e) {
            this.comErrorCount++;
            this.canBusConnected = false;
            if (this.comErrorCount > 10) {
                this.ledStatus.flt = true;
            }
        }
    }

    _canTransmit() {
        // ── NMT 状态检查：仅在运行状态下才发送数据 ──
        if (!this._isCanTransmit()) {
            return;  // 模块不在运行状态，禁止发送
        }

        // ── 故障/状态检查：仅在物理总线连接、模块有电且通信模块无故障时允许发送 ──
        if (!this.busConnected || !this.powerOn || this.commFault) {
            this.canBusConnected = false;
            this.comErrorCount++;
            if (this.comErrorCount > 10) {
                this.ledStatus.flt = true;  // 通信故障点亮 FLT 灯
            }
            return;  // 不发送任何数据
        }
        // 安全检查：确保系统和总线存在
        if (!this.sys || typeof this.sys.canBus === 'undefined') return;
        // 计算帧 ID：功能码 0x01 (AI 上报)，节点地址
        const frameId = CANId.encode(CAN_FUNC.AI_REPORT, this.nodeAddress & 0x0F);
        // 辅助函数：将数值打包为 16位整数数组 (大端序)
        const pack16 = (v, scale) => {
            if (v === 0x8000) return [0x80, 0x00];
            const raw = Math.round(v * scale);
            return [(raw >> 8) & 0xFF, raw & 0xFF];
        };
        // 构建数据数组--CH1、CH2: 故障时发送 -32768 作为标记，否则发送 value * 100，CH3 、CH4: 保留一位小数 (乘以 10)
        const ch1Fault = this.channels.ch1.fault;
        const ch2Fault = this.channels.ch2.fault;
        const ch3Fault = this.channels.ch3.fault;
        const ch4Fault = this.channels.ch4.fault;
        const data = [
            ...pack16(ch1Fault ? 0x8000 : this.channels.ch1.value, 100),
            ...pack16(ch2Fault ? 0x8000 : this.channels.ch2.value, 100),
            ...pack16(ch3Fault ? 0x8000 : this.channels.ch3.value, 10),
            ...pack16(ch4Fault ? 0x0800 : this.channels.ch4.value, 10),
        ];

        // 构造 CAN 帧对象
        const frame = {
            id: frameId,
            extended: false,
            rtr: false,
            dlc: 8,
            data,
            sender: this.id,
            timestamp: Date.now(),
        };

        try {
            // 调用总线发送方法
            this.sys.canBus.send(frame);
            this.txCount++;// 发送计数 +1
            this.canBusConnected = true; // 标记连接正常
        } catch (e) {
            this.comErrorCount++;
            this.canBusConnected = false;
            if (this.comErrorCount > 10) {
                this.ledStatus.flt = true; // 如果错误过多，点亮 FLT。通信错误和IO模块错误都会引起ERR
            }
        }
    }

    /**
     * 接收 CAN 帧（由 CAN 总线管理器调用，处理来自中央计算机的配置帧）
     * 配置帧 ID = (0x10 << 7) | nodeAddress，Data[0] 为命令字
     *   0x01: 修改报警阈值 (Data[1]=chIdx, Data[2-3]=HH×10, Data[4-5]=LL×10)
     *   0x02: 修改采样周期 (Data[1-2]=ms)
     *   0x03: 请求立即上报
     *   0x04: 设置通道模式 (Data[1]=chIdx, Data[2]=mode)
     *         mode: 0='normal', 1='test', 2='disable'
     *   0x05: 设置工程量 (Data[1]=chIdx, Data[2-3]=value×100)
     *         仅在 test 模式下生效
     */
    onCanReceive(frame) {
        if (!frame) return;
        // 只有物理总线连接、模块有电且通信模块无故障时才处理接收帧
        if (!this.busConnected || !this.powerOn || this.commFault) return;
        // 解析帧 ID
        const { funcCode, nodeAddr } = CANId.decode(frame.id);

        // ── 处理NMT命令（功能码0x00）──
        // NMT是广播命令，所有节点都需要接收
        if (funcCode === CAN_FUNC.NMT) {
            const nmtCmd = frame.data[0];      // NMT命令代码
            const targetAddr = frame.data[1];  // 目标地址（0=所有节点，1-15=特定节点）

            // 检查这个命令是否针对本节点
            if (targetAddr === 0 || targetAddr === this.nodeAddress) {
                this._handleNMT(nmtCmd);
            }
            return;  // NMT命令处理完毕，不继续
        }

        // 处理广播心跳（由 CentralComputer 或 CANBus 的 startHeartbeat 发出）
        // 广播帧 data[0] = 0x05 表示 Operational（运行中）
        if (funcCode === CAN_FUNC.BROADCAST) {
            // 仅处理 Operational 心跳（data[0] === 0x05）
            if (frame.data && frame.data.length > 0 && frame.data[0] === 0x05) {
                this._lastHeartbeat = Date.now();
                // 如果当前在 PREOP 状态，收到心跳则进入 RUN
                if (this.nmtState === NMT_STATE.PREOP || this.nmtState === NMT_STATE.INIT) {
                    this.nmtState = NMT_STATE.RUN;
                    this.nmtStateTime = Date.now();
                    console.log(`[AI #${this.nodeAddress}] Heartbeat received → ${NMT_STATE.RUN} state`);
                }
            }
            return;
        }

        // ── 处理配置命令（功能码0x02）──
        // 检查功能码是否为 AI_CONFIG (0x02) 且节点地址匹配
        if (funcCode !== CAN_FUNC.AI_CONFIG || nodeAddr !== (this.nodeAddress & 0x0F)) return;

        this.lastRxTime = Date.now(); // 更新最后接收时间
        this.rxCount++;  // 接收计数 +1
        this.ledStatus.com = true;   // 点亮通信灯 (由主循环控制熄灭)

        const cmd = frame.data[0];  // 解析子命令字
        switch (cmd) {
            case 0x01: // 修改采样/上报周期
                this.txInterval = Math.max(50, (frame.data[1] << 8) | frame.data[2]);
                break;

            case 0x02: // 立即上报
                this.lastTxTime = 0; // 强制下次 tick 发送
                break;
            case 0x03: { // 修改报警阈值HH和LL
                const chKeys = ['ch1', 'ch2', 'ch3', 'ch4'];
                const chIdx = frame.data[1] & 0x03;   // Data[1]: 通道索引 (0-3)
                const chId = chKeys[chIdx];
                if (chId && this.alarms[chId]) {
                    // Data[2-3]: HH 值 (高位在前)
                    this.alarms[chId].hh = ((frame.data[2] << 8) | frame.data[3]) / 10;
                    // Data[4-5]: LL 值 (高位在前)
                    this.alarms[chId].ll = ((frame.data[4] << 8) | frame.data[5]) / 10;
                }
                break;
            }
            case 0x04: { // 修改报警阈值H和L
                const chKeys = ['ch1', 'ch2', 'ch3', 'ch4'];
                const chIdx = frame.data[1] & 0x03;   // Data[1]: 通道索引 (0-3)
                const chId = chKeys[chIdx];
                if (chId && this.alarms[chId]) {
                    // Data[2-3]: HH 值 (高位在前)
                    this.alarms[chId].h = ((frame.data[2] << 8) | frame.data[3]) / 10;
                    // Data[4-5]: LL 值 (高位在前)
                    this.alarms[chId].l = ((frame.data[4] << 8) | frame.data[5]) / 10;
                }
                break;
            }
            case 0x05: { // 设置通道模式
                const chKeys = ['ch1', 'ch2', 'ch3', 'ch4'];
                const modeMap = { 0: 'normal', 1: 'test', 2: 'disable' };
                const chIdx = frame.data[1] & 0x03;   // Data[1]: 通道索引 (0-3)
                const modeVal = frame.data[2] & 0x03; // Data[2]: 模式值 (0-2)
                const chId = chKeys[chIdx];
                const mode = modeMap[modeVal];
                if (chId && mode) {
                    this.setChannelMode(chId, mode);
                }
                break;
            }
            case 0x06: { // 设置工程量（上位机模式）
                const chKeys = ['ch1', 'ch2', 'ch3', 'ch4'];
                const chIdx = frame.data[1] & 0x03;   // Data[1]: 通道索引 (0-3)
                // Data[2-3]: 工程量值 × 100 (高位在前，有符号)
                const rawValue = ((frame.data[2] << 8) | frame.data[3]);
                // 将有符号16位转换为有符号整数
                const signedValue = rawValue > 32767 ? rawValue - 65536 : rawValue;
                const value = signedValue / 100;
                const chId = chKeys[chIdx];
                if (chId) {
                    this.setValue(chId, value);
                }
                break;
            }
            case 0x07: { // 读取某通道报警 HH 和 LL
                const chKeys = ['ch1', 'ch2', 'ch3', 'ch4'];
                const chIdx = frame.data[1] & 0x03;   // Data[1]: 通道索引 (0-3)
                const chId = chKeys[chIdx];
                if (chId && this.alarms[chId]) {
                    // 构造响应数据：[命令0x07, 通道索引, HH高字节, HH低字节, LL高字节, LL低字节]
                    const hh = Math.round(this.alarms[chId].hh * 10);
                    const ll = Math.round(this.alarms[chId].ll * 10);
                    // 使用辅助函数处理有符号数的编码
                    const [hhH, hhL] = this._int16ToBytes(hh);
                    const [llH, llL] = this._int16ToBytes(ll);
                    const responseData = [
                        0x07,
                        chIdx,
                        hhH,
                        hhL,
                        llH,
                        llL,
                        0, 0
                    ];
                    this._sendResponse(responseData);
                }
                break;
            }
            case 0x08: { // 读取某通道报警 H 和 L
                const chKeys = ['ch1', 'ch2', 'ch3', 'ch4'];
                const chIdx = frame.data[1] & 0x03;   // Data[1]: 通道索引 (0-3)
                const chId = chKeys[chIdx];
                if (chId && this.alarms[chId]) {
                    // 构造响应数据：[命令0x08, 通道索引, H高字节, H低字节, L高字节, L低字节]
                    const h = Math.round(this.alarms[chId].h * 10);
                    const l = Math.round(this.alarms[chId].l * 10);
                    // 使用辅助函数处理有符号数的编码
                    const [hH, hL] = this._int16ToBytes(h);
                    const [lH, lL] = this._int16ToBytes(l);
                    const responseData = [
                        0x08,
                        chIdx,
                        hH,
                        hL,
                        lH,
                        lL,
                        0, 0
                    ];
                    this._sendResponse(responseData);
                }
                break;
            }
            case 0x09: { // 读取某通道上限、下限和单位
                const chKeys = ['ch1', 'ch2', 'ch3', 'ch4'];
                const unitMap = { 'MPa': 1, 'bar': 2, '°C': 3, 'cm': 4, 'L/min': 5, '%': 6 };
                const chIdx = frame.data[1] & 0x03;   // Data[1]: 通道索引 (0-3)
                const chId = chKeys[chIdx];
                if (chId && this.ranges[chId]) {
                    const range = this.ranges[chId];
                    const urv = Math.round(range.urv * 100);    // 上限 × 100
                    const lrv = Math.round(range.lrv * 100);    // 下限 × 100
                    const unitCode = unitMap[range.unit] || 0;  // 单位编码
                    // 使用辅助函数处理有符号数的编码
                    const [urvH, urvL] = this._int16ToBytes(urv);
                    const [lrvH, lrvL] = this._int16ToBytes(lrv);
                    const responseData = [
                        0x09,
                        chIdx,
                        urvH,
                        urvL,
                        lrvH,
                        lrvL,
                        unitCode,
                        0
                    ];
                    this._sendResponse(responseData);
                }
                break;
            }
            case 0x0A: { // 读取所有通道的报警和故障状态
                // 报警编码：LL=1, L=2, H=3, HH=4, normal=0
                // 故障编码：OPEN=1, SHORT=2, OUTRANGE=3, normal=0
                const alarmCodeMap = { 'LL': 1, 'L': 2, 'H': 3, 'HH': 4, 'normal': 0, 'FAULT': 0 };
                const faultCodeMap = { 'OPEN': 1, 'SHORT': 2, 'OUTRANGE': 3, 'normal': 0, };

                const chKeys = ['ch1', 'ch2', 'ch3', 'ch4'];
                const responseData = [0x0A, 0, 0, 0, 0, 0, 0, 0];  // 8字节数据

                chKeys.forEach((chId, idx) => {
                    const ch = this.channels[chId];
                    const alm = this.alarms[chId];

                    // 每个通道占用1个字节：高4位为报警状态，低4位为故障状态
                    let byte = 0;
                    const alarmCode = alarmCodeMap[alm.status] || 0;
                    const faultCode = ch.fault ? (faultCodeMap[ch.faultText] || 0) : 0;
                    byte = (alarmCode << 4) | faultCode;

                    responseData[idx + 1] = byte;  // Data[1-4] 为四个通道状态
                });

                this._sendResponse(responseData);
                break;
            }
            case 0x0B: { // 写入某通道上限、下限和单位（来自上位机）
                const chKeys = ['ch1', 'ch2', 'ch3', 'ch4'];
                const chIdx = frame.data[1] & 0x03;
                const chId = chKeys[chIdx];
                if (chId) {
                    const urvRaw = ((frame.data[2] << 8) | frame.data[3]);
                    const lrvRaw = ((frame.data[4] << 8) | frame.data[5]);
                    const unitCode = frame.data[6] & 0xFF;
                    const unitMapR = { 1: 'MPa', 2: 'bar', 3: '°C', 4: 'cm', 5: 'L/min', 6: '%' };
                    const urv = urvRaw / 100;
                    const lrv = lrvRaw / 100;
                    const unit = unitMapR[unitCode] || '%';
                    this.ranges[chId] = { urv, lrv, unit };
                    // 回复新的量程（使用 0x09 格式响应）
                    const urvOut = Math.round(urv * 100);
                    const lrvOut = Math.round(lrv * 100);
                    const resp = [0x09, chIdx, (urvOut >> 8) & 0xFF, urvOut & 0xFF, (lrvOut >> 8) & 0xFF, lrvOut & 0xFF, unitCode & 0xFF, 0];
                    this._sendResponse(resp);
                }
                break;
            }

        }
    }

    // ══════════════════════════════════════════
    //  渲染更新
    // ══════════════════════════════════════════
    _render() {
        // 更新各通道显示
        CH_CONFIG.forEach(ch => {
            const cData = this.channels[ch.id];  // 当前通道数据:包括4组数据，value,raw,fault和type
            const rng = this.ranges[ch.id];  // 量程：上限、下限和单位
            const alm = this.alarms[ch.id];  // 报警状态：4个限和状态文字
            const disp = this._chDisplays[ch.id]; // 图形显示对象：原始、数值、单位、报警文字
            const led = this._chLEDs[ch.id];   //  运行指示灯
            // 原始信号标注
            const rawUnit = { '4-20mA': 'mA', RTD: 'Ω', TC: 'mV' }[cData.type];

            // 若通道被禁用，清空显示
            if (cData.mode === 'disable') {
                disp.val.text('');
                disp.unit.text('');
                disp.raw.text('');
                disp.alm.text('');
                disp.bg.stroke('#333');
                led.fill('#222');
                return;
            }

            if (cData.fault) {
                disp.val.text(`${cData.faultText}`);  // 图形显示对象1. 显示文字
                disp.val.fill('#ff3300');
                disp.unit.text('');   // 图形显示对象2. 清空单位
                disp.bg.stroke('#f9e103');  // 图形显示对象3. 背景边框变黄
                if (ch.id === 'ch3' && cData.raw > 1000) {
                    disp.raw.text(`---${rawUnit}`);
                } else if (ch.id === 'ch4' && cData.raw < -1) {
                    disp.raw.text(`---${rawUnit}`);
                } else {
                    disp.raw.text(`${cData.raw.toFixed(2)}${rawUnit}`);
                } // 图形显示对象4. 原始值显示断线/短路
                led.fill('#ff3300');   //  运行指示灯
                disp.alm.text('FLT');   //图形显示对象 5. 报警状态显示 FLT
                disp.alm.fill('#ff3300');
            } else {
                const v = cData.value;
                // 温度通道(CH3/CH4)保留1位小数，电流通道保留2位小数
                disp.val.text(v.toFixed(ch.id === 'ch3' || ch.id === 'ch4' ? 1 : 2).padStart(7, ' '));
                disp.unit.text(rng.unit);

                // 报警颜色
                const almColor = { HH: '#ff3300', H: '#ff8800', LL: '#ff3300', L: '#ffcc00', normal: '#00ff44', FAULT: '#ff3300' };
                // 数值颜色
                disp.val.fill(almColor[alm.status] || '#00ff44');
                // 报警时边框变黄/红，正常时为绿色
                disp.bg.stroke(alm.status !== 'normal' ? '#f10e0e' : '#0ae80a');
                // 报警状态文字显示
                disp.alm.text(alm.status === 'normal' ? '----' : alm.status);
                disp.alm.fill(almColor[alm.status] || '#555');


                disp.raw.text(`${cData.raw.toFixed(2)}${rawUnit}`);
                // 通道运行灯 (正常为绿，故障为红，已在上面 if 分支处理)              
                led.fill('#00ff44');
            }
        });

        // 更新模块状态灯 (PWR, RUN, FLT, COM)
        Object.keys(this._statusLEDs).forEach(id => {
            const led = this._statusLEDs[id];
            // 如果状态为真且有对应颜色，则点亮，否则熄灭 (灰色)
            led.dot.fill(this.ledStatus[id] ? led.color : '#222');
        });

        this._refreshCache();
    }

    /** 断电黑屏 */
    _renderOff() {
        CH_CONFIG.forEach(ch => {
            const d = this._chDisplays[ch.id];
            d.val.text('');
            d.unit.text('');
            d.raw.text('');
            d.alm.text('');
            d.bg.stroke('#333');
            this._chLEDs[ch.id].fill('#222');
        });
        // 熄灭所有状态灯
        Object.keys(this._statusLEDs).forEach(id => {
            this._statusLEDs[id].dot.fill('#222');
        });
        this._refreshCache();
    }

    // ══════════════════════════════════════════
    //  拨码开关同步刷新
    // ══════════════════════════════════════════
    _refreshSwitches() {
        this._swObjs.forEach(sw => {
            const isOn = (this.nodeAddress & sw.bitVal) !== 0;
            // const baseY = parseInt(sw.knob.y()) > 300 ? 296 : 284; // 相对定位已在构造时确定
            // 直接用偏移量重算（y 在构造时为 y0+10 或 y0+22，y0=288）
            sw.knob.y(isOn ? 298 : 310);
            sw.knob.fill(isOn ? '#ffcc00' : '#333');
        });
        this._addrDecText.text(String(this.nodeAddress));
    }

    // ══════════════════════════════════════════
    //  公开 API（供仿真引擎调用）
    // ══════════════════════════════════════════

    /**
     * 注入原始信号值
     * @param {string} chId  - 'ch1' | 'ch2' | 'ch3' | 'ch4'
     * @param {number} raw   - 4-20mA 时单位为 mA；RTD 单位为 Ω；TC 单位为 mV
     */
    setRaw(chId, raw) {
        // ── 故障模拟：sysFault（死机）时，模块停止处理任何输入 ──
        if (this.sysFault) {
            return;  // 模块死机，不接收任何新数据
        }

        const ch = this.channels[chId];
        if (ch !== undefined && ch.mode === 'normal') {
            ch.raw = raw;
        }
    }

    /**
     * 直接设置工程量（用于测试或软件仿真）
     * 自动反算 raw 值以保持一致
     * 仅在 test 模式下生效
     */
    setValue(chId, value) {
        const ch = this.channels[chId];
        const rng = this.ranges[chId];
        if (!ch || !rng || ch.mode !== 'test') return;
        ch.value = value;
        ch.fault = false;
        // 反算 raw
        switch (ch.type) {
            case '4-20mA':
                ch.raw = 4 + ((value - rng.lrv) / (rng.urv - rng.lrv)) * 16;
                break;
            case 'RTD':
                ch.raw = 100 * (1 + 0.00385 * value);
                break;
            case 'TC':
                ch.raw = value * 0.04;
                break;
        }
    }


    /** 获取通道工程量（供中央计算机轮询读取）*/
    getChannelValues() {
        return Object.keys(this.channels).reduce((acc, id) => {
            acc[id] = {
                value: this.channels[id].value,
                fault: this.channels[id].fault,
                alarm: this.alarms[id].status,
                unit: this.ranges[id].unit,
                mode: this.channels[id].mode,
            };
            return acc;
        }, {});
    }

    /**
     * 设置通道模式
     * @param {string} chId - 通道ID ('ch1' | 'ch2' | 'ch3' | 'ch4')
     * @param {string} mode - 模式 ('normal' | 'test' | 'disable')
     *   - 'normal': 可以通过 setRaw 注入原始信号
     *   - 'test': 可以通过 setValue 直接设置工程量
     *   - 'disable': 通道不显示
     */
    setChannelMode(chId, mode) {
        const ch = this.channels[chId];
        if (ch !== undefined && ['normal', 'test', 'disable'].includes(mode)) {
            ch.mode = mode;
        }
    }

    /** 销毁模块，清除定时器 */
    destroy() {
        if (this._loopTimer) clearInterval(this._loopTimer);
        super.destroy && super.destroy();
    }
}